/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scenario Runtime · 「基于剧本游戏模式」运行时上下文装配器
 *
 * 职责:
 *   1. 把 Scenario(模组数据)+ ScenarioState(玩家进度)切片成当前回合的 prompt 注入块
 *   2. 只塞当前需要的窗口 —— 当前场景 frame+freedom、相邻 1 跳场景、在场 NPC、
 *      未发现/已发现线索、终局条件、narrative_style —— 预算 1.5~3k token
 *   3. 不依赖 React / DOM,可在浏览器与 Node 测试中复用
 *
 * 不在本文件做的事:
 *   - 校验 scenarioActions(在 App.tsx 的 applyKeeperResponse 做)
 *   - 维护 elapsedMinutes / triggeredTimelineIds(由 saveManager 持久化、App.tsx 推进)
 *   - 解析 yaml(由 module.ts import 时调 validator)
 */

import type {
  Clue,
  NarrativeStyle,
  Npc,
  Scenario,
  ScenarioEndKind,
  Scene,
  SceneExit,
} from "../data/modules/_schema/scenario";
import type { ScenarioActions, ScenarioState } from "../types";

// ============================================================================
// Public API
// ============================================================================

/**
 * 拼成 KP prompt 的 [剧本模式上下文] 注入块。返回值会被 App.tsx 拼到
 * SYSTEM_INSTRUCTION 之后、动态 instructions 之前。
 *
 * 设计哲学:每回合只暴露玩家此刻"理论上能感知到"的信息——
 * - 当前场景的全部三槽(frame + freedom + forbidden)
 * - 相邻 1 跳场景仅暴露 title 与 hook 一句(避免剧透)
 * - NPC 只暴露当前在场或当前场景默认在场的 public_persona;secret 仅当 unlock 已触发时附加
 * - 已发现的 clue 暴露 reveal 摘要;未发现但 location 匹配当前场景的 clue 仅给 KP 视角的发现条件
 * - 终局条件清单(只列 trigger flag 状态,不列 epilogue,LLM 不需要看)
 *
 * 不返回 narrativeStyle —— 那个由 buildNarrativeStyleBlock 单独拼,
 * 因为风格指导在所有场景里都一样,放在场景外层更合适。
 */
export function buildScenarioContextBlock(
  scenario: Scenario,
  state: ScenarioState,
): string {
  const sceneById = new Map(scenario.scenes.map((s) => [s.id, s]));
  const npcById = new Map(scenario.npcs.map((n) => [n.id, n]));
  const clueById = new Map(scenario.clues.map((c) => [c.id, c]));
  const flagById = new Map(scenario.flags.map((f) => [f.id, f]));

  const currentScene = sceneById.get(state.currentSceneId);
  if (!currentScene) {
    return `\n\n=== [剧本模式·上下文异常] ===\n当前场景 id "${state.currentSceneId}" 不在模组 ${scenario.meta.id} 的 scenes 中。请保持 scenarioActions 为 null,narrative 仅做最克制的过场,等待玩家或前端修正。\n`;
  }

  const lines: string[] = [];
  lines.push("\n\n=== [剧本模式·当前回合上下文] ===");
  lines.push(`模组:${scenario.meta.title}(id=${scenario.meta.id})`);
  lines.push(formatEraAnchorLine(scenario));
  lines.push(
    `时间锚点:第 ${scenario.meta.startTime.gameDay} 天 ${scenario.meta.startTime.hour} + 已推进 ${state.elapsedMinutes} 分钟`,
  );
  lines.push(`已访问场景:${state.visitedSceneIds.length} 个`);

  // -------- 开局勾子:hook.prologueMd + callToActionMd + startScene --------
  // 这是模组开局"为什么调查员此刻在这里、被托去查什么、手里捏着什么"的唯一来源。
  // 第一回合 narrative 必须以本块为起点(配合 SYSTEM_INSTRUCTION 节 12.11);
  // 中后期回合也保留可见,作为 NPC 动机/玩家委托关系的不变参照。
  const hook = scenario.hook;
  const isFirstTurn =
    state.visitedSceneIds.length <= 1 &&
    state.elapsedMinutes === 0 &&
    state.discoveredClueIds.length <= (scenario.hook.defaultInitialClues?.length ?? 0);
  lines.push(
    `\n--- [剧本模式·开局勾子] ${isFirstTurn ? "**第一回合必须以此为起点**" : "(供后续场景引用,不得改写)"} ---`,
  );
  lines.push(`起始场景:${hook.startScene}`);
  if (hook.prologueMd?.trim()) {
    lines.push(`【hook.prologue 调查员是怎么被卷进来的】\n${hook.prologueMd.trim()}`);
  }
  if (hook.callToActionMd?.trim()) {
    lines.push(`【hook.call_to_action 第一回合开场时玩家此刻的物理位置 / 手中物件】\n${hook.callToActionMd.trim()}`);
  }
  if (hook.defaultInitialClues?.length) {
    lines.push(`【hook.default_initial_clues 开局即拥有的线索】 ${hook.defaultInitialClues.join(", ")}`);
  }

  // -------- 当前场景:frame 全暴露 + freedom 全暴露 + forbidden 全暴露 --------
  lines.push(`\n--- 当前场景:${currentScene.title}(id=${currentScene.id})---`);
  lines.push(`【frame.summary 必须遵守】\n${currentScene.frame.summaryMd.trim()}`);
  if (currentScene.frame.facts.length > 0) {
    lines.push(
      `【frame.facts 离散事实,任一回合都不可违反】\n${currentScene.frame.facts.map((f) => `  - ${f}`).join("\n")}`,
    );
  }
  // KP 视角秘密:必须由 unlock 条件确认才暴露(MVP 简化:只看场景关联的 clue 是否已发现)
  if (currentScene.frame.kpSecretMd) {
    const sceneSecretsUnlocked = clueUnlocksLinkSecret(
      scenario,
      state,
      currentScene.id,
    );
    if (sceneSecretsUnlocked) {
      lines.push(
        `【frame.kp_secret 已解锁】\n${currentScene.frame.kpSecretMd.trim()}`,
      );
    }
  }

  // 出口
  if (currentScene.frame.exits.length > 0) {
    lines.push(`【frame.exits 合法出口(其它走法一律视为非法跳转)】`);
    for (const exit of currentScene.frame.exits) {
      lines.push(`  - ${formatExit(exit)}`);
    }
  } else {
    lines.push(`【frame.exits 无固定出口】当前场景没有声明合法出口,sceneTransition 必须为 null。`);
  }

  // freedom 全部
  const freedom = currentScene.freedom;
  if (freedom) {
    const fparts: string[] = [];
    if (freedom.moodTags?.length) fparts.push(`mood: ${freedom.moodTags.join(" / ")}`);
    if (freedom.sensoryPalette) {
      const sp = freedom.sensoryPalette;
      const sparts = [
        sp.sight && `视:${sp.sight}`,
        sp.sound && `听:${sp.sound}`,
        sp.smell && `嗅:${sp.smell}`,
        sp.touch && `触:${sp.touch}`,
        sp.taste && `味:${sp.taste}`,
      ].filter(Boolean);
      if (sparts.length) fparts.push(`五感语料: ${sparts.join(" | ")}`);
    }
    if (freedom.improvisableProps?.length) {
      fparts.push(`可临时编入物件: ${freedom.improvisableProps.join(" / ")}`);
    }
    if (freedom.npcActionHints) {
      const hintLines = Object.entries(freedom.npcActionHints).map(
        ([npcId, hints]) => `    ${npcById.get(npcId)?.name ?? npcId}: ${hints.join(" / ")}`,
      );
      if (hintLines.length) fparts.push(`NPC 行为提示:\n${hintLines.join("\n")}`);
    }
    if (fparts.length) {
      lines.push(`【freedom 可挑用,不必全用】\n  ${fparts.join("\n  ")}`);
    }
  }

  if (currentScene.forbidden?.length) {
    lines.push(
      `【scene.forbidden 红线,任一违反都会被认定脱稿】\n${currentScene.forbidden.map((f) => `  - ${f}`).join("\n")}`,
    );
  }

  // -------- 相邻场景:仅暴露 title + 1 句 summary --------
  const neighborIds = currentScene.frame.exits.map((e) => e.to);
  const neighbors = neighborIds
    .map((id) => sceneById.get(id))
    .filter((s): s is Scene => Boolean(s));
  if (neighbors.length) {
    lines.push(`\n--- 相邻场景(仅作钩子,玩家未到达前不得直接描述其内部细节)---`);
    for (const n of neighbors) {
      const oneLineSummary = n.frame.summaryMd.replace(/\s+/g, " ").trim().slice(0, 60);
      lines.push(`  - ${n.title}(id=${n.id}): ${oneLineSummary}…`);
    }
  }

  // -------- NPC:在场的 public_persona,secret 仅在 unlock 已触发时附加 --------
  const presentNpcs = collectPresentNpcs(currentScene, scenario.npcs, state);
  if (presentNpcs.length) {
    lines.push(`\n--- 在场 NPC ---`);
    for (const npc of presentNpcs) {
      const attitude = state.npcAttitude[npc.id] ?? npc.initialAttitude;
      lines.push(
        `  - ${npc.name}(id=${npc.id}, 角色=${npc.role}, 当前态度=${attitude})`,
      );
      lines.push(`    [public_persona]\n      ${npc.frame.publicPersonaMd.trim().replace(/\n/g, "\n      ")}`);
      if (npc.frame.secretMd && state.unlockedSecretIds.includes(npc.id)) {
        lines.push(`    [secret 已解锁]\n      ${npc.frame.secretMd.trim().replace(/\n/g, "\n      ")}`);
      }
      if (npc.frame.voiceGuidelines.length) {
        lines.push(`    [voice 必须遵守] ${npc.frame.voiceGuidelines.join(" / ")}`);
      }
      if (npc.freedom?.catchphrases?.length) {
        lines.push(`    [catchphrases 可挑用] ${npc.freedom.catchphrases.join(" / ")}`);
      }
      if (npc.forbidden?.length) {
        lines.push(`    [forbidden] ${npc.forbidden.join(" / ")}`);
      }
    }
  }

  // -------- 当前场景的线索 --------
  const sceneClues = currentScene.frame.availableClues
    .map((cid) => clueById.get(cid))
    .filter((c): c is Clue => Boolean(c));
  if (sceneClues.length) {
    lines.push(`\n--- 当前场景关联线索(KP 视角)---`);
    for (const clue of sceneClues) {
      const found = state.discoveredClueIds.includes(clue.id);
      if (found) {
        lines.push(`  - [已发现] ${clue.title}(id=${clue.id})`);
        lines.push(`    reveal: ${clue.frame.revealMd.trim().slice(0, 80)}…`);
      } else {
        lines.push(`  - [未发现] ${clue.title}(id=${clue.id})`);
        lines.push(`    discovery: ${formatDiscovery(clue)}`);
        if (clue.forbidden?.length) {
          lines.push(`    forbidden: ${clue.forbidden.join(" / ")}`);
        }
      }
    }
  }

  // -------- 已发现线索短摘(跨场景) --------
  const offSceneFoundClues = state.discoveredClueIds
    .map((cid) => clueById.get(cid))
    .filter((c): c is Clue => Boolean(c) && c.frame.locationScene !== currentScene.id);
  if (offSceneFoundClues.length) {
    lines.push(`\n--- 已发现的跨场景线索(玩家可能引用)---`);
    for (const clue of offSceneFoundClues) {
      lines.push(`  - ${clue.title}(id=${clue.id}, 来自 ${clue.frame.locationScene})`);
    }
  }

  // -------- 终局条件清单 --------
  if (scenario.endings.length) {
    lines.push(`\n--- 终局条件清单(scenarioActions.endingProposed 时核对)---`);
    for (const ending of scenario.endings) {
      lines.push(
        `  - ${ending.title}(id=${ending.id}, kind=${ending.frame.scenarioEndKind}, priority=${ending.priority})`,
      );
      const triggerStatus = ending.triggers.map((t) => {
        const cur = state.endingFlags[t.flag] ?? flagById.get(t.flag)?.initial ?? false;
        const ok = cur === t.value;
        return `${t.flag}=${t.value}${ok ? "✓" : "✗"}(当前 ${cur})`;
      });
      lines.push(`    triggers(全 ✓ 才可下发): ${triggerStatus.join(" AND ")}`);
    }
  }

  // -------- global_freedom / global_forbidden --------
  if (scenario.globalFreedom) {
    const gf = scenario.globalFreedom;
    const gfparts: string[] = [];
    if (gf.eraAtmosphereMd) gfparts.push(`时代氛围:\n${gf.eraAtmosphereMd.trim()}`);
    if (gf.languageRegister) gfparts.push(`语言风格:${gf.languageRegister}`);
    if (gf.npcDefaultDialect) gfparts.push(`NPC 默认口音:${gf.npcDefaultDialect}`);
    if (gfparts.length) {
      lines.push(`\n--- global_freedom(整本模组通用语料)---\n${gfparts.join("\n")}`);
    }
  }
  if (scenario.globalForbidden?.length) {
    lines.push(
      `\n--- global_forbidden(整本模组红线)---\n${scenario.globalForbidden.map((f) => `  - ${f}`).join("\n")}`,
    );
  }

  return lines.join("\n");
}

/**
 * narrative_style 单独成块,因为风格指导在所有场景里都一样,放外层更合适。
 * 仅当模组声明了 narrative_style 时返回非空字符串。
 */
export function buildNarrativeStyleBlock(narrativeStyle: NarrativeStyle | undefined): string {
  if (!narrativeStyle) return "";
  const lines: string[] = ["\n\n=== [剧本模式·叙事文风指导] ==="];

  const f = narrativeStyle.frame;
  if (f) {
    const fparts: string[] = [];
    if (f.pov) fparts.push(`pov: ${f.pov}`);
    if (f.tense) fparts.push(`tense: ${f.tense}`);
    if (fparts.length) lines.push(`【frame 必须遵守】 ${fparts.join(" | ")}`);
    if (f.forbiddenPhrasings?.length) {
      lines.push(
        `【frame.forbidden_phrasings 元描述红线】\n${f.forbiddenPhrasings.map((x) => `  - ${x}`).join("\n")}`,
      );
    }
  }

  const fr = narrativeStyle.freedom;
  if (fr) {
    if (fr.sentencePacingMd) {
      lines.push(`【freedom.sentence_pacing】\n${fr.sentencePacingMd.trim()}`);
    }
    if (fr.vocabularyRegister) {
      lines.push(`【freedom.vocabulary_register】 ${fr.vocabularyRegister}`);
    }
    if (fr.metaphorPalette?.length) {
      lines.push(
        `【freedom.metaphor_palette 可挑用】\n${fr.metaphorPalette.map((x) => `  - ${x}`).join("\n")}`,
      );
    }
    if (fr.referenceWorks?.length) {
      lines.push(
        `【freedom.reference_works 同温层参考(禁直接引用)】 ${fr.referenceWorks.join(" / ")}`,
      );
    }
    if (fr.sampleParagraphMd) {
      lines.push(`【freedom.sample_paragraph 范本(对齐口吻,不要照抄)】\n${fr.sampleParagraphMd.trim()}`);
    }
  }

  return lines.join("\n");
}

/**
 * 给 ScenarioState 一个干净的初始值,基于模组 hook + flags。
 * 切到 scenario-based 模式时由前端调一次。
 */
export function initialScenarioState(scenario: Scenario): ScenarioState {
  const endingFlags: Record<string, boolean> = {};
  for (const flag of scenario.flags) {
    endingFlags[flag.id] = flag.initial;
  }
  const npcAttitude: Record<string, ScenarioState["npcAttitude"][string]> = {};
  for (const npc of scenario.npcs) {
    npcAttitude[npc.id] = npc.initialAttitude;
  }
  return {
    moduleId: scenario.meta.id,
    currentSceneId: scenario.hook.startScene,
    visitedSceneIds: [scenario.hook.startScene],
    discoveredClueIds: [...(scenario.hook.defaultInitialClues ?? [])],
    unlockedSecretIds: [],
    npcAttitude,
    endingFlags,
    elapsedMinutes: 0,
    triggeredTimelineIds: [],
  };
}

// ============================================================================
// 内部工具
// ============================================================================

/**
 * 把 meta.era 拍成一行硬时代锚点,提示 KP 严格按时代调用物件/语言/技术。
 * 与 keeperPrompt.ts 节 12.10 的"时代锚点(era)硬约束"配套——本行是被 12.10
 * 引用的"上下文里的『时代锚点』那一行"。
 */
function formatEraAnchorLine(scenario: Scenario): string {
  const era = scenario.meta.era;
  switch (era) {
    case "1920s":
      return `时代锚点:1920s(经典 CoC 时代)— 仅允许 1920s 及以前的物件/技术/语言;禁止手机、互联网、GPS、监控、即时通讯、现代医疗设备等 1925 年后量产物件。详见 KP 铁律 12.10。`;
    case "modern":
      return `时代锚点:modern(现代)— 允许手机、互联网、GPS、监控、机动车、即时通讯、现代医疗;古董元素仅作为"旧物"语境出现。详见 KP 铁律 12.10。`;
    case "other":
      return `时代锚点:other(自定义)— eraNote: ${scenario.meta.eraNote ?? "(未填,按全模组散文语境推断)"}。详见 KP 铁律 12.10。`;
  }
}

function formatExit(exit: SceneExit): string {
  switch (exit.condition) {
    case "free":
      return `→ ${exit.to}(${exit.label}, free)`;
    case "requires-clue":
      return `→ ${exit.to}(${exit.label}, 需已发现 ${exit.requiredClue})`;
    case "requires-flag":
      return `→ ${exit.to}(${exit.label}, 需 ${exit.requiredFlag}=${exit.requiredValue})`;
    case "requires-skill":
      return `→ ${exit.to}(${exit.label}, 需当回合 ${exit.requiredSkill} 投骰 ${exit.difficulty} 成功${
        exit.onFailureConsequence ? `, 失败后果 ${exit.onFailureConsequence}` : ""
      })`;
  }
}

function formatDiscovery(clue: Clue): string {
  const d = clue.frame.discovery;
  switch (d.method) {
    case "skill":
      return `skill ${d.skill} (${d.difficulty})`;
    case "flag":
      return `flag ${d.conditionFlag} 满足时自动获得`;
    case "npc-give":
      return `由 ${d.giverNpc} 交付${d.conditionFlag ? `(条件 flag ${d.conditionFlag})` : ""}`;
    case "auto-on-enter":
      return `进入场景即自动入册`;
  }
}

/**
 * MVP 简化版"在场 NPC"集合:取场景默认 npcsPresent + state.npcAttitude 已记录的同场 NPC。
 * Phase 2 不维护 npcCurrentLocation,默认走场景声明 + initialLocation == currentSceneId 的 NPC。
 */
function collectPresentNpcs(
  scene: Scene,
  allNpcs: Npc[],
  _state: ScenarioState,
): Npc[] {
  const ids = new Set(scene.frame.npcsPresent);
  for (const n of allNpcs) {
    if (n.initialLocation === scene.id) ids.add(n.id);
  }
  return allNpcs.filter((n) => ids.has(n.id));
}

/**
 * 当前场景里,有没有任何已发现的 clue 在 unlocks.scenes 含本场景或其它指向"暴露 kpSecret"的语义?
 * MVP 实现:只要玩家发现过一条以本场景为 location 的 clue,就视为本场景的 kpSecret 已解锁。
 * 这是一个粗糙但保守的近似——更细致的解锁条件留 V2(届时引入显式 unlocks.sceneSecrets 字段)。
 */
function clueUnlocksLinkSecret(
  scenario: Scenario,
  state: ScenarioState,
  sceneId: string,
): boolean {
  for (const cid of state.discoveredClueIds) {
    const clue = scenario.clues.find((c) => c.id === cid);
    if (!clue) continue;
    if (clue.frame.locationScene === sceneId) return true;
    if (clue.frame.unlocks?.scenes?.includes(sceneId)) return true;
  }
  return false;
}

// ============================================================================
// applyScenarioActions · 校验 + 落账 + 反向标记
// ============================================================================

/**
 * 玩家最近一次掷骰摘要,App.tsx 在调用 applyScenarioActions 前从消息流派生。
 * - skill: 技能 id(SKILL_REGISTRY_ALL 的 key,与 Clue/Exit 的 requiredSkill 同口径)
 * - difficulty: 玩家本次实际投出的难度等级
 * - successType: 投骰结果
 *
 * 不传 ⇒ 当前回合没有可信的玩家投骰,所有 method=skill 的 clueDiscovered 一律拒绝。
 */
export interface RollContext {
  skill: string;
  difficulty: "regular" | "hard" | "extreme";
  successType:
    | "critical"
    | "extreme"
    | "hard"
    | "regular"
    | "failure"
    | "fumble";
}

export interface ApplyScenarioActionsResult {
  /** 落账后的下一帧 ScenarioState;若所有动作都被拒,等于入参 prevState */
  nextState: ScenarioState;
  /** 注入消息流的反向标记/正向标记串(每条一行 system 消息) */
  systemMarkers: string[];
  /**
   * 由 endingProposed 全 trigger 满足后自动写出的 scenarioEnd。
   * App.tsx 收到后合并到 finalScenarioEnd 链路(优先级低于 dead/insane/dying 闸,但
   * 高于 LLM 自行下发的 scenarioEnd)。
   */
  autoEnding: { kind: ScenarioEndKind; epilogue?: string } | null;
}

/**
 * 校验并落账剧本动作。所有合法性逻辑在此集中,App.tsx 只负责把入参组装好、
 * 把 result.nextState 写到 setScenarioState、把 systemMarkers 推到消息流。
 *
 * 设计原则:
 * - **拒绝单元**而非全部回滚:5 个动作里有 1 个非法,只回注那一条 [...·拒绝];
 *   剩余 4 条若合法仍然落账。
 * - **顺序固定**:sceneTransition → clueDiscovered → flagSet → endingProposed → timeAdvance。
 *   sceneTransition 先于 clueDiscovered 是因为 clue 校验依赖"玩家此刻已在新场景"的语义。
 * - **不可见副作用**:本函数纯函数,不调 setMessages / setScenarioState,App.tsx 拿到结果再 setState。
 */
export function applyScenarioActions(
  actions: ScenarioActions | null | undefined,
  prevState: ScenarioState,
  scenario: Scenario,
  rollContext: RollContext | null,
): ApplyScenarioActionsResult {
  const result: ApplyScenarioActionsResult = {
    nextState: prevState,
    systemMarkers: [],
    autoEnding: null,
  };
  if (!actions) return result;

  const sceneById = new Map(scenario.scenes.map((s) => [s.id, s]));
  const clueById = new Map(scenario.clues.map((c) => [c.id, c]));
  const flagById = new Map(scenario.flags.map((f) => [f.id, f]));
  const endingById = new Map(scenario.endings.map((e) => [e.id, e]));

  let working: ScenarioState = prevState;

  // ------- 1. sceneTransition -------
  if (actions.sceneTransition) {
    const { toSceneId, reason } = actions.sceneTransition;
    const currentScene = sceneById.get(working.currentSceneId);
    const targetScene = sceneById.get(toSceneId);
    const exit = currentScene?.frame.exits.find((e) => e.to === toSceneId);

    if (!currentScene) {
      result.systemMarkers.push(
        `[场景非法·拒绝] 当前场景 id "${working.currentSceneId}" 不在模组中,不处理本回合 sceneTransition。下一回合请只输出叙事,不要再下发场景跳转。`,
      );
    } else if (!targetScene) {
      result.systemMarkers.push(
        `[场景非法·拒绝] 目标场景 id "${toSceneId}" 不在模组中。当前场景 ${currentScene.title} 的合法出口仅限 frame.exits 列出的 to。下一回合 narrative 不要描写到达任何新场景,sceneTransition 必须为 null 或重选合法出口。`,
      );
    } else if (!exit) {
      const legal = currentScene.frame.exits.map((e) => `${e.to}(${e.label})`).join(" / ") || "无";
      result.systemMarkers.push(
        `[场景非法·拒绝] 从 ${currentScene.title} 不能直接跳到 ${targetScene.title}——合法出口仅:${legal}。下一回合请把玩家叙事性地拉回当前场景,或挑一条合法 exit 重新下发 sceneTransition。`,
      );
    } else if (!checkExitGate(exit, working, rollContext)) {
      result.systemMarkers.push(
        formatExitGateRejection(exit, currentScene.title, targetScene.title),
      );
    } else {
      working = {
        ...working,
        currentSceneId: toSceneId,
        visitedSceneIds: working.visitedSceneIds.includes(toSceneId)
          ? working.visitedSceneIds
          : [...working.visitedSceneIds, toSceneId],
      };
      result.systemMarkers.push(
        `[场景切换] ${currentScene.title} → ${targetScene.title}${
          reason ? `(${reason})` : ""
        }。后续叙事以新场景的 frame 为准,旧场景的细节不可再描写为"眼前"。`,
      );
    }
  }

  // ------- 2. clueDiscovered -------
  if (actions.clueDiscovered) {
    const { clueId, method } = actions.clueDiscovered;
    const clue = clueById.get(clueId);
    const sceneAfter = sceneById.get(working.currentSceneId);

    if (!clue) {
      result.systemMarkers.push(
        `[线索非法·拒绝] 线索 id "${clueId}" 不在模组中。下一回合 clueDiscovered 必须为 null 或重选有效 id。`,
      );
    } else if (working.discoveredClueIds.includes(clueId)) {
      result.systemMarkers.push(
        `[线索非法·拒绝] 线索 ${clue.title}(id=${clueId})已发现过,不重复入册。下一回合不要再下发同一条线索。`,
      );
    } else if (!sceneAfter || clue.frame.locationScene !== sceneAfter.id) {
      result.systemMarkers.push(
        `[线索条件未满足·拒绝] 线索 ${clue.title} 的 locationScene = ${clue.frame.locationScene},而当前场景是 ${sceneAfter?.id ?? "未知"}。线索必须在其归属场景被发现。下一回合先用合法 sceneTransition 进入对应场景,再下发 clueDiscovered。`,
      );
    } else if (clue.frame.discovery.method !== method) {
      result.systemMarkers.push(
        `[线索条件未满足·拒绝] 线索 ${clue.title} 的发现 method 是 ${clue.frame.discovery.method},不是 ${method}。下一回合按 frame.discovery 重选 method。`,
      );
    } else if (!checkClueDiscoveryGate(clue, working, rollContext)) {
      result.systemMarkers.push(formatClueDiscoveryRejection(clue, working, rollContext));
    } else {
      const nextDiscovered = [...working.discoveredClueIds, clueId];
      const nextUnlockedSecrets = clue.frame.unlocks?.secrets
        ? Array.from(new Set([...working.unlockedSecretIds, ...clue.frame.unlocks.secrets]))
        : working.unlockedSecretIds;
      const nextEndingFlags = { ...working.endingFlags };
      if (clue.frame.unlocks?.flags) {
        for (const fid of clue.frame.unlocks.flags) {
          if (flagById.has(fid)) nextEndingFlags[fid] = true;
        }
      }
      working = {
        ...working,
        discoveredClueIds: nextDiscovered,
        unlockedSecretIds: nextUnlockedSecrets,
        endingFlags: nextEndingFlags,
      };
      const unlockNote = clue.frame.unlocks
        ? formatClueUnlockSummary(clue.frame.unlocks)
        : "";
      result.systemMarkers.push(
        `[线索发现] ${clue.title}(id=${clueId})已入册${unlockNote ? `;${unlockNote}` : ""}。下一回合可以引用此线索的 reveal 内容。`,
      );
    }
  }

  // ------- 3. flagSet[] -------
  if (actions.flagSet && actions.flagSet.length > 0) {
    const nextEndingFlags = { ...working.endingFlags };
    let mutated = false;
    for (const entry of actions.flagSet) {
      const flag = flagById.get(entry.flagId);
      if (!flag) {
        result.systemMarkers.push(
          `[Flag 非法·拒绝] flag id "${entry.flagId}" 不在模组中,不写入。下一回合 flagSet 必须为 null 或重选有效 id。`,
        );
        continue;
      }
      const writableBy = flag.writableBy ?? ["clue-unlocks", "timeline-effects"];
      if (!writableBy.includes("scenario-actions")) {
        result.systemMarkers.push(
          `[Flag 非法·拒绝] flag ${flag.title}(id=${entry.flagId})的 writableBy 不含 "scenario-actions",此 flag 只能由 clue-unlocks / timeline-effects 写入。下一回合不要尝试用 flagSet 改它。`,
        );
        continue;
      }
      nextEndingFlags[entry.flagId] = entry.value;
      mutated = true;
      result.systemMarkers.push(
        `[Flag 设定] ${flag.title}(${entry.flagId})= ${entry.value}${
          entry.reason ? `(${entry.reason})` : ""
        }。`,
      );
    }
    if (mutated) {
      working = { ...working, endingFlags: nextEndingFlags };
    }
  }

  // ------- 4. endingProposed -------
  if (actions.endingProposed) {
    const { endingId } = actions.endingProposed;
    const ending = endingById.get(endingId);
    if (!ending) {
      result.systemMarkers.push(
        `[终幕条件未达成·拒绝] ending id "${endingId}" 不在模组中。下一回合 endingProposed 必须为 null 或重选有效 id。`,
      );
    } else {
      const unmet: string[] = [];
      for (const t of ending.triggers) {
        const cur = working.endingFlags[t.flag] ?? flagById.get(t.flag)?.initial ?? false;
        if (cur !== t.value) unmet.push(`${t.flag}=${t.value}(当前 ${cur})`);
      }
      if (unmet.length > 0) {
        result.systemMarkers.push(
          `[终幕条件未达成·拒绝] ending ${ending.title}(id=${endingId})尚有 trigger 未满足:${unmet.join(", ")}。下一回合不要下发 endingProposed,继续推进剧情。`,
        );
      } else {
        result.autoEnding = {
          kind: ending.frame.scenarioEndKind,
          epilogue: ending.frame.epilogueMd,
        };
        result.systemMarkers.push(
          `[终幕条件已满足] ending ${ending.title}(id=${endingId},kind=${ending.frame.scenarioEndKind})触发,前端已写入 scenarioEnd。本回合 narrative 应当承接 epilogue 的精神,但克系基调不可松。`,
        );
      }
    }
  }

  // ------- 5. timeAdvance -------
  if (actions.timeAdvance) {
    const { minutes, reason } = actions.timeAdvance;
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
      result.systemMarkers.push(
        `[时间推进非法·拒绝] timeAdvance.minutes 必须是 ≥ 0 的整数,收到 ${minutes}。下一回合不要推进时间或修正格式。`,
      );
    } else if (minutes > 0) {
      const intMinutes = Math.floor(minutes);
      working = {
        ...working,
        elapsedMinutes: working.elapsedMinutes + intMinutes,
      };
      result.systemMarkers.push(
        `[时间推进] +${intMinutes} 分钟${reason ? `(${reason})` : ""},累计已推进 ${working.elapsedMinutes} 分钟。`,
      );
    }
  }

  result.nextState = working;
  return result;
}

function checkExitGate(
  exit: SceneExit,
  state: ScenarioState,
  rollContext: RollContext | null,
): boolean {
  switch (exit.condition) {
    case "free":
      return true;
    case "requires-clue":
      return state.discoveredClueIds.includes(exit.requiredClue);
    case "requires-flag":
      return (state.endingFlags[exit.requiredFlag] ?? false) === exit.requiredValue;
    case "requires-skill":
      if (!rollContext) return false;
      if (rollContext.skill !== exit.requiredSkill) return false;
      return isSuccessAtLeast(rollContext, exit.difficulty);
  }
}

function formatExitGateRejection(
  exit: SceneExit,
  fromTitle: string,
  toTitle: string,
): string {
  switch (exit.condition) {
    case "free":
      return `[场景非法·拒绝] ${fromTitle} → ${toTitle} 是自由出口理论上应通过,但发生了未知校验失败。`;
    case "requires-clue":
      return `[场景条件未满足·拒绝] ${fromTitle} → ${toTitle} 需先发现线索 ${exit.requiredClue}。下一回合先把这条线索的发现路径走通,再考虑 sceneTransition。`;
    case "requires-flag":
      return `[场景条件未满足·拒绝] ${fromTitle} → ${toTitle} 需 flag ${exit.requiredFlag} = ${exit.requiredValue}。下一回合不要直接跳过去,先让对应 flag 满足。`;
    case "requires-skill":
      return `[场景条件未满足·拒绝] ${fromTitle} → ${toTitle} 需玩家本回合声明 ${exit.requiredSkill} 并以 ${exit.difficulty} 难度成功。请下一回合重新引导玩家发起这次声明。`;
  }
}

function checkClueDiscoveryGate(
  clue: Clue,
  state: ScenarioState,
  rollContext: RollContext | null,
): boolean {
  const d = clue.frame.discovery;
  switch (d.method) {
    case "auto-on-enter":
      return true;
    case "flag":
      return (state.endingFlags[d.conditionFlag] ?? false) === true;
    case "npc-give":
      if (!d.conditionFlag) return true;
      return (state.endingFlags[d.conditionFlag] ?? false) === true;
    case "skill":
      if (!rollContext) return false;
      if (rollContext.skill !== d.skill) return false;
      return isSuccessAtLeast(rollContext, d.difficulty);
  }
}

function formatClueDiscoveryRejection(
  clue: Clue,
  _state: ScenarioState,
  rollContext: RollContext | null,
): string {
  const d = clue.frame.discovery;
  switch (d.method) {
    case "auto-on-enter":
      return `[线索条件未满足·拒绝] 线索 ${clue.title} 的 method=auto-on-enter 未通过校验,不应发生。`;
    case "flag":
      return `[线索条件未满足·拒绝] 线索 ${clue.title} 需 flag ${d.conditionFlag}=true 才会浮出。下一回合不要尝试发现,先把该 flag 推进。`;
    case "npc-give":
      return `[线索条件未满足·拒绝] 线索 ${clue.title} 由 ${d.giverNpc} 交付${
        d.conditionFlag ? `,且条件 flag ${d.conditionFlag} 必须为 true` : ""
      };当前条件未满足,不入册。`;
    case "skill": {
      if (!rollContext) {
        return `[线索条件未满足·拒绝] 线索 ${clue.title} 需玩家以 ${d.skill}(${d.difficulty})成功投骰才能发现,但当前回合没有可信投骰。请下一回合重新引导玩家发起 ${d.skill} 声明。`;
      }
      if (rollContext.skill !== d.skill) {
        return `[线索条件未满足·拒绝] 线索 ${clue.title} 要求 ${d.skill} 成功,玩家本回合投的是 ${rollContext.skill}。`;
      }
      return `[线索条件未满足·拒绝] 线索 ${clue.title} 要求 ${d.skill} ≥ ${d.difficulty} 等级成功,当前结果 ${rollContext.successType} 不足。`;
    }
  }
}

function formatClueUnlockSummary(unlocks: NonNullable<Clue["frame"]["unlocks"]>): string {
  const parts: string[] = [];
  if (unlocks.secrets?.length) parts.push(`解锁 NPC secret: ${unlocks.secrets.join(", ")}`);
  if (unlocks.scenes?.length) parts.push(`新可达场景: ${unlocks.scenes.join(", ")}`);
  if (unlocks.flags?.length) parts.push(`置 flag true: ${unlocks.flags.join(", ")}`);
  return parts.join(";");
}

const RANK_ORDER: Record<RollContext["successType"], number> = {
  fumble: -1,
  failure: 0,
  regular: 1,
  hard: 2,
  extreme: 3,
  critical: 4,
};

function isSuccessAtLeast(
  ctx: RollContext,
  required: "regular" | "hard" | "extreme",
): boolean {
  const rank = RANK_ORDER[ctx.successType];
  if (required === "regular") return rank >= RANK_ORDER.regular;
  if (required === "hard") return rank >= RANK_ORDER.hard;
  return rank >= RANK_ORDER.extreme;
}
