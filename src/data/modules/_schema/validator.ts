/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scenario Validator · 「基于剧本游戏模式」模组数据校验器
 *
 * 职责(对齐 .docs/scenario-schema.md §13 与 scenario.ts 顶部注释):
 *
 *   1. 把 yaml parse 出来的 snake_case JSON 转成 scenario.ts 的 camelCase 类型
 *   2. 类型/枚举/必填字段校验
 *   3. 跨节点引用完整性(scene/npc/clue/flag/ending id 必须有声明)
 *   4. 场景图连通性:从 hook.startScene BFS,所有非孤立场景必须可达
 *   5. 终局可达性:每个 ending 的 trigger flag 至少有一条理论可达路径
 *      (来源 = clue.unlocks.flags / timeline.effects.setFlags / flags.initial)
 *   6. timeline 必须按 (gameDay, hour) 升序排列
 *   7. 技能名校验:走 cocSkills.ts SKILL_REGISTRY_ALL
 *   8. 骰子公式校验:走 lib/diceFormula.ts(只解析,不真投)
 *
 * 资产文件存在性 **不在** 本文件做(本文件是浏览器/Node 同构的纯逻辑)。
 * 资产存在性由 scripts/validate-modules.ts 在 Node 端用 fs.existsSync 校验,
 * 该脚本会在 build 前把 yaml + asset path 喂给本 validator,再做磁盘检查。
 *
 * 不抛错;失败收集到 issues[],由调用方决定打印/中断。
 */

import { findSkill } from "../../cocSkills";
import { findOccupation, getOccupations } from "../../cocOccupations";
import { findWeapon } from "../../cocWeapons";
import { rollDiceFormula } from "../../../lib/diceFormula";
import type {
  Clue,
  ClueDiscovery,
  Difficulty,
  Ending,
  EndingRewards,
  EndingSanRewardCondition,
  EndingTrigger,
  Era,
  FiresWhen,
  Flag,
  FlagWritableBy,
  GlobalFreedom,
  NarrativeStyle,
  NarrativeStyleFrame,
  NarrativeStyleFreedom,
  Npc,
  NpcAttitude,
  NpcCombat,
  NpcRole,
  NpcStats,
  PresetInvestigator,
  PresetInvestigatorAttributes,
  Scenario,
  ScenarioDifficultyTier,
  ScenarioEndKind,
  ScenarioHook,
  ScenarioHookOccupationVariant,
  ScenarioMeta,
  Scene,
  SceneExit,
  TimelineEvent,
  TimelinePrerequisite,
} from "./scenario";
import { SCENARIO_SCHEMA_VERSION } from "./scenario";

// ============================================================================
// Public API
// ============================================================================

export interface ValidationIssue {
  /** JSON 路径,如 `scenes[2].frame.exits[0].requiredClue` */
  path: string;
  /** 给作者看的中文说明 */
  message: string;
}

export type ValidationResult =
  | { ok: true; scenario: Scenario; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[]; warnings: ValidationIssue[] };

/**
 * 校验入口。`raw` 是 yaml parse 出来的对象(snake_case)。
 *
 * 通过时返回 camelCase 的 Scenario 与 warnings;失败时返回 issues + warnings。
 * 调用方:
 *   - 模组 module.ts 在 import yaml 后立刻调,失败 throw
 *   - scripts/validate-modules.ts 把所有模组遍历一遍,失败退出 1
 */
export function validateScenario(raw: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const push = (path: string, message: string) => issues.push({ path, message });
  const warn = (path: string, message: string) => warnings.push({ path, message });

  if (!isPlainObject(raw)) {
    push("$root", "scenario yaml 顶层必须是对象。");
    return { ok: false, issues, warnings };
  }

  // 顶层 schema_version
  const schemaVersion = raw["schema_version"];
  if (schemaVersion !== SCENARIO_SCHEMA_VERSION) {
    push(
      "schema_version",
      `schema_version 必须是 ${SCENARIO_SCHEMA_VERSION},收到 ${JSON.stringify(schemaVersion)}。`,
    );
    // 继续校验,让作者一次看到尽量多的错
  }

  const meta = parseMeta(raw["meta"], "meta", push);
  const hook = parseHook(raw["hook"], "hook", push, warn);
  const scenes = parseScenes(raw["scenes"], "scenes", push, warn);
  const npcs = parseNpcs(raw["npcs"], "npcs", push);
  const clues = parseClues(raw["clues"], "clues", push, warn);
  const timeline = parseTimeline(raw["timeline"], "timeline", push);
  const flags = parseFlags(raw["flags"], "flags", push);
  const endings = parseEndings(raw["endings"], "endings", push);
  const globalFreedom = parseGlobalFreedom(raw["global_freedom"], "global_freedom", push);
  const globalForbidden = parseStringArray(
    raw["global_forbidden"],
    "global_forbidden",
    push,
    /*optional*/ true,
  );
  const narrativeStyle = parseNarrativeStyle(
    raw["narrative_style"],
    "narrative_style",
    push,
    warn,
  );
  const presetInvestigators = parsePresetInvestigators(
    raw["preset_investigators"],
    "preset_investigators",
    push,
  );

  // 早退:任一顶层节点彻底解析失败就不再做引用完整性
  if (!meta || !hook || !scenes || !npcs || !clues || !timeline || !flags || !endings) {
    return { ok: false, issues, warnings };
  }

  // 跨节点完整性
  validateReferences(
    { meta, hook, scenes, npcs, clues, timeline, flags, endings, presetInvestigators },
    push,
    warn,
  );

  if (issues.length > 0) {
    return { ok: false, issues, warnings };
  }

  const scenario: Scenario = {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    meta,
    hook,
    scenes,
    npcs,
    clues,
    timeline,
    flags,
    endings,
    globalFreedom,
    globalForbidden,
    narrativeStyle,
    presetInvestigators,
  };
  return { ok: true, scenario, warnings };
}

// ============================================================================
// 共享解析工具
// ============================================================================

type Issue = (path: string, message: string) => void;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function parseStringArray(
  value: unknown,
  path: string,
  push: Issue,
  optional: boolean,
): string[] | undefined {
  if (value === undefined || value === null) {
    if (!optional) push(path, `必填字段。`);
    return optional ? undefined : [];
  }
  const arr = asArray(value);
  if (!arr) {
    push(path, `必须是字符串数组。`);
    return optional ? undefined : [];
  }
  const out: string[] = [];
  arr.forEach((item, idx) => {
    if (typeof item !== "string") {
      push(`${path}[${idx}]`, `必须是字符串,收到 ${typeof item}。`);
    } else {
      out.push(item);
    }
  });
  return out;
}

function parseInteger(
  value: unknown,
  path: string,
  push: Issue,
  opts: { min?: number; max?: number } = {},
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    push(path, `必须是整数,收到 ${JSON.stringify(value)}。`);
    return 0;
  }
  if (opts.min !== undefined && value < opts.min) {
    push(path, `不能小于 ${opts.min},收到 ${value}。`);
  }
  if (opts.max !== undefined && value > opts.max) {
    push(path, `不能大于 ${opts.max},收到 ${value}。`);
  }
  return value;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseGameTime(value: unknown, path: string, push: Issue): string {
  if (typeof value !== "string" || !HHMM_RE.test(value)) {
    push(path, `必须是 24h 制 "HH:MM",收到 ${JSON.stringify(value)}。`);
    return "00:00";
  }
  return value;
}

function parseDifficulty(value: unknown, path: string, push: Issue): Difficulty {
  if (value === "regular" || value === "hard" || value === "extreme") return value;
  push(path, `必须是 regular | hard | extreme,收到 ${JSON.stringify(value)}。`);
  return "regular";
}

function parseDiceFormula(
  value: unknown,
  path: string,
  push: Issue,
  optional = false,
): string | undefined {
  if (value === undefined || value === null) {
    if (!optional) push(path, `必填字段。`);
    return undefined;
  }
  // 允许 number(纯数字静态值)
  const formula = typeof value === "number" ? String(value) : value;
  if (typeof formula !== "string") {
    push(path, `骰子公式必须是字符串或数字,收到 ${typeof value}。`);
    return undefined;
  }
  const parsed = rollDiceFormula(formula);
  if (!parsed.isValid) {
    push(path, `骰子公式 "${formula}" 无法解析(支持 NdM[+const][/divisor] 与纯数字)。`);
  }
  return formula;
}

// ============================================================================
// §2 meta
// ============================================================================

function parseMeta(value: unknown, path: string, push: Issue): ScenarioMeta | null {
  if (!isPlainObject(value)) {
    push(path, `必须是对象。`);
    return null;
  }
  const id = isNonEmptyString(value["id"]) ? value["id"] : (push(`${path}.id`, `必填且非空。`), "");
  const title = isNonEmptyString(value["title"])
    ? value["title"]
    : (push(`${path}.title`, `必填且非空。`), "");

  const eraRaw = value["era"];
  const era: Era =
    eraRaw === "1920s" || eraRaw === "modern" || eraRaw === "other"
      ? eraRaw
      : (push(`${path}.era`, `必须是 1920s | modern | other。`), "modern");
  const eraNote = typeof value["era_note"] === "string" ? value["era_note"] : undefined;
  if (era === "other" && !isNonEmptyString(eraNote)) {
    push(`${path}.era_note`, `era=other 时 era_note 必填。`);
  }

  const language = isNonEmptyString(value["language"]) ? value["language"] : "zh-CN";

  const diffRaw = value["difficulty"];
  const difficulty: ScenarioDifficultyTier =
    diffRaw === "入门" || diffRaw === "标准" || diffRaw === "高强度" || diffRaw === "致命"
      ? diffRaw
      : (push(`${path}.difficulty`, `必须是 入门 | 标准 | 高强度 | 致命。`), "标准");

  const tags = parseStringArray(value["tags"], `${path}.tags`, push, /*optional*/ false) ?? [];

  const cover = typeof value["cover"] === "string" ? value["cover"] : undefined;

  const startTime = parseStartTime(value["start_time"], `${path}.start_time`, push);

  const synopsisMd = isNonEmptyString(value["synopsis_md"])
    ? value["synopsis_md"]
    : (push(`${path}.synopsis_md`, `必填且非空。`), "");
  const authorCreditsMd =
    typeof value["author_credits_md"] === "string" ? value["author_credits_md"] : undefined;

  const recommendedOccupationsRaw = parseStringArray(
    value["recommended_occupations"],
    `${path}.recommended_occupations`,
    push,
    /*optional*/ false,
  );
  const recommendedOccupations = recommendedOccupationsRaw ?? [];
  if (recommendedOccupations.length === 0) {
    push(
      `${path}.recommended_occupations`,
      `必填,至少 1 项;每项必须能在 cocOccupations.ts 对应 era 表里命中(中文名或 id)。`,
    );
  }

  return {
    id,
    title,
    era,
    eraNote,
    language,
    difficulty,
    tags,
    cover,
    startTime,
    synopsisMd,
    authorCreditsMd,
    recommendedOccupations,
  };
}

function parseStartTime(
  value: unknown,
  path: string,
  push: Issue,
): { gameDay: number; hour: string } {
  if (!isPlainObject(value)) {
    push(path, `必须是 { game_day, hour } 对象。`);
    return { gameDay: 1, hour: "00:00" };
  }
  return {
    gameDay: parseInteger(value["game_day"], `${path}.game_day`, push, { min: 1 }),
    hour: parseGameTime(value["hour"], `${path}.hour`, push),
  };
}

// ============================================================================
// §3 hook
// ============================================================================

function parseHook(
  value: unknown,
  path: string,
  push: Issue,
  warn: Issue,
): ScenarioHook | null {
  if (!isPlainObject(value)) {
    push(path, `必须是对象。`);
    return null;
  }
  const startScene = isNonEmptyString(value["start_scene"])
    ? value["start_scene"]
    : (push(`${path}.start_scene`, `必填且非空。`), "");
  const prologueMd = isNonEmptyString(value["prologue_md"])
    ? value["prologue_md"]
    : (push(`${path}.prologue_md`, `必填且非空。`), "");
  const callToActionMd = isNonEmptyString(value["call_to_action_md"])
    ? value["call_to_action_md"]
    : (push(`${path}.call_to_action_md`, `必填且非空。`), "");

  const defaultInitialClues = value["default_initial_clues"];
  const defaultInitialCluesArr =
    defaultInitialClues === undefined
      ? undefined
      : parseStringArray(defaultInitialClues, `${path}.default_initial_clues`, push, true);

  // occupation_variants:Record<occupationKey, { call_to_action_md, initial_clues? }>
  let occupationVariants: Record<string, ScenarioHookOccupationVariant> | undefined;
  const variantsRaw = value["occupation_variants"];
  if (variantsRaw !== undefined && variantsRaw !== null) {
    if (!isPlainObject(variantsRaw)) {
      push(`${path}.occupation_variants`, `必须是 { occupation: { call_to_action_md, initial_clues? } } 对象。`);
    } else {
      occupationVariants = {};
      for (const [occKey, entry] of Object.entries(variantsRaw)) {
        const ep = `${path}.occupation_variants.${occKey}`;
        if (!isPlainObject(entry)) {
          push(ep, `必须是对象。`);
          continue;
        }
        const cta = isNonEmptyString(entry["call_to_action_md"])
          ? entry["call_to_action_md"]
          : (push(`${ep}.call_to_action_md`, `必填且非空。`), "");
        const initRaw = entry["initial_clues"];
        const initialClues =
          initRaw === undefined
            ? undefined
            : parseStringArray(initRaw, `${ep}.initial_clues`, push, true);
        occupationVariants[occKey] = { callToActionMd: cta, initialClues };
      }
      if (Object.keys(occupationVariants).length === 0) {
        warn(`${path}.occupation_variants`, `声明了 occupation_variants 但为空对象,等同于未声明。`);
        occupationVariants = undefined;
      }
    }
  }

  return {
    startScene,
    prologueMd,
    callToActionMd,
    defaultInitialClues: defaultInitialCluesArr,
    occupationVariants,
  };
}

// ============================================================================
// §4 scenes
// ============================================================================

function parseScenes(
  value: unknown,
  path: string,
  push: Issue,
  warn: Issue,
): Scene[] | null {
  const arr = asArray(value);
  if (!arr) {
    push(path, `必须是数组。`);
    return null;
  }
  if (arr.length === 0) {
    push(path, `至少需要一个场景。`);
    return null;
  }
  const out: Scene[] = [];
  arr.forEach((item, idx) => {
    const scene = parseScene(item, `${path}[${idx}]`, push, warn);
    if (scene) out.push(scene);
  });
  return out;
}

function parseScene(value: unknown, path: string, push: Issue, warn: Issue): Scene | null {
  if (!isPlainObject(value)) {
    push(path, `场景必须是对象。`);
    return null;
  }
  const id = isNonEmptyString(value["id"]) ? value["id"] : (push(`${path}.id`, `必填且非空。`), "");
  const title = isNonEmptyString(value["title"])
    ? value["title"]
    : (push(`${path}.title`, `必填且非空。`), "");

  const frameRaw = value["frame"];
  if (!isPlainObject(frameRaw)) {
    push(`${path}.frame`, `必须是对象。`);
    return null;
  }

  const summaryMd = isNonEmptyString(frameRaw["summary_md"])
    ? frameRaw["summary_md"]
    : (push(`${path}.frame.summary_md`, `必填且非空。`), "");
  const facts = parseStringArray(frameRaw["facts"], `${path}.frame.facts`, push, false) ?? [];
  const kpSecretMd =
    typeof frameRaw["kp_secret_md"] === "string" ? frameRaw["kp_secret_md"] : undefined;
  const exits = parseSceneExits(frameRaw["exits"], `${path}.frame.exits`, push);
  const npcsPresent =
    parseStringArray(frameRaw["npcs_present"], `${path}.frame.npcs_present`, push, false) ?? [];
  const availableClues =
    parseStringArray(frameRaw["available_clues"], `${path}.frame.available_clues`, push, false) ?? [];

  const assetsRaw = frameRaw["assets"];
  let assets: Scene["frame"]["assets"];
  if (assetsRaw !== undefined) {
    if (!isPlainObject(assetsRaw)) {
      push(`${path}.frame.assets`, `必须是对象。`);
    } else {
      const map = typeof assetsRaw["map"] === "string" ? assetsRaw["map"] : undefined;
      const ambient =
        typeof assetsRaw["ambient_image"] === "string" ? assetsRaw["ambient_image"] : undefined;
      assets = { map, ambientImage: ambient };
    }
  }

  // freedom (optional)
  const freedomRaw = value["freedom"];
  let freedom: Scene["freedom"];
  if (freedomRaw !== undefined) {
    if (!isPlainObject(freedomRaw)) {
      push(`${path}.freedom`, `必须是对象。`);
    } else {
      const moodTags = parseStringArray(freedomRaw["mood_tags"], `${path}.freedom.mood_tags`, push, true);
      const sensoryRaw = freedomRaw["sensory_palette"];
      let sensoryPalette: Scene["freedom"] extends infer F
        ? F extends { sensoryPalette?: infer S }
          ? S
          : never
        : never;
      if (sensoryRaw !== undefined) {
        if (!isPlainObject(sensoryRaw)) {
          push(`${path}.freedom.sensory_palette`, `必须是对象。`);
        } else {
          sensoryPalette = {
            sight: typeof sensoryRaw["sight"] === "string" ? sensoryRaw["sight"] : undefined,
            sound: typeof sensoryRaw["sound"] === "string" ? sensoryRaw["sound"] : undefined,
            smell: typeof sensoryRaw["smell"] === "string" ? sensoryRaw["smell"] : undefined,
            touch: typeof sensoryRaw["touch"] === "string" ? sensoryRaw["touch"] : undefined,
            taste: typeof sensoryRaw["taste"] === "string" ? sensoryRaw["taste"] : undefined,
          };
        }
      }
      const improvisableProps = parseStringArray(
        freedomRaw["improvisable_props"],
        `${path}.freedom.improvisable_props`,
        push,
        true,
      );
      const npcActionHintsRaw = freedomRaw["npc_action_hints"];
      let npcActionHints: Record<string, string[]> | undefined;
      if (npcActionHintsRaw !== undefined) {
        if (!isPlainObject(npcActionHintsRaw)) {
          push(`${path}.freedom.npc_action_hints`, `必须是 { npcId: string[] } 对象。`);
        } else {
          npcActionHints = {};
          for (const [npcId, hints] of Object.entries(npcActionHintsRaw)) {
            const arr = parseStringArray(
              hints,
              `${path}.freedom.npc_action_hints.${npcId}`,
              push,
              false,
            );
            if (arr) npcActionHints[npcId] = arr;
          }
        }
      }
      freedom = { moodTags, sensoryPalette, improvisableProps, npcActionHints };
    }
  }

  const forbidden = parseStringArray(value["forbidden"], `${path}.forbidden`, push, true);

  void warn; // 留给后续可能的"场景没有出口"等软警告
  return {
    id,
    title,
    frame: {
      summaryMd,
      facts,
      kpSecretMd,
      exits,
      npcsPresent,
      availableClues,
      assets,
    },
    freedom,
    forbidden,
  };
}

function parseSceneExits(value: unknown, path: string, push: Issue): SceneExit[] {
  if (value === undefined) return [];
  const arr = asArray(value);
  if (!arr) {
    push(path, `必须是数组。`);
    return [];
  }
  const out: SceneExit[] = [];
  arr.forEach((item, idx) => {
    const exit = parseSceneExit(item, `${path}[${idx}]`, push);
    if (exit) out.push(exit);
  });
  return out;
}

function parseSceneExit(value: unknown, path: string, push: Issue): SceneExit | null {
  if (!isPlainObject(value)) {
    push(path, `出口必须是对象。`);
    return null;
  }
  const to = isNonEmptyString(value["to"]) ? value["to"] : (push(`${path}.to`, `必填。`), "");
  const label = isNonEmptyString(value["label"])
    ? value["label"]
    : (push(`${path}.label`, `必填。`), "");
  const condition = value["condition"];

  switch (condition) {
    case "free":
      return { to, condition: "free", label };
    case "requires-clue": {
      const requiredClue = isNonEmptyString(value["required_clue"])
        ? value["required_clue"]
        : (push(`${path}.required_clue`, `requires-clue 必须配 required_clue。`), "");
      return { to, condition: "requires-clue", requiredClue, label };
    }
    case "requires-flag": {
      const requiredFlag = isNonEmptyString(value["required_flag"])
        ? value["required_flag"]
        : (push(`${path}.required_flag`, `requires-flag 必须配 required_flag。`), "");
      const requiredValue = value["required_value"];
      if (typeof requiredValue !== "boolean") {
        push(`${path}.required_value`, `必须是 true | false。`);
      }
      return {
        to,
        condition: "requires-flag",
        requiredFlag,
        requiredValue: requiredValue === true,
        label,
      };
    }
    case "requires-skill": {
      const requiredSkill = isNonEmptyString(value["required_skill"])
        ? value["required_skill"]
        : (push(`${path}.required_skill`, `requires-skill 必须配 required_skill。`), "");
      const difficulty = parseDifficulty(value["difficulty"], `${path}.difficulty`, push);
      const onFailure = value["on_failure_consequence"];
      let onFailureConsequence: string | undefined;
      if (onFailure !== undefined && onFailure !== null) {
        if (typeof onFailure !== "string") {
          push(`${path}.on_failure_consequence`, `必须是 "<channel>:<formula>" 字符串。`);
        } else {
          onFailureConsequence = onFailure;
          validateConsequenceString(onFailure, `${path}.on_failure_consequence`, push);
        }
      }
      return {
        to,
        condition: "requires-skill",
        requiredSkill,
        difficulty,
        label,
        onFailureConsequence,
      };
    }
    default:
      push(`${path}.condition`, `必须是 free | requires-clue | requires-flag | requires-skill。`);
      return null;
  }
}

function validateConsequenceString(value: string, path: string, push: Issue) {
  const m = /^(hp|san|mp):(.+)$/.exec(value);
  if (!m) {
    push(path, `格式必须是 "<channel>:<formula>",channel ∈ {hp,san,mp}。`);
    return;
  }
  const formula = m[2];
  const parsed = rollDiceFormula(formula);
  if (!parsed.isValid) {
    push(path, `骰子公式 "${formula}" 无法解析。`);
  }
}

// ============================================================================
// §5 npcs
// ============================================================================

function parseNpcs(value: unknown, path: string, push: Issue): Npc[] | null {
  const arr = asArray(value);
  if (!arr) {
    push(path, `必须是数组(可空)。`);
    return null;
  }
  const out: Npc[] = [];
  arr.forEach((item, idx) => {
    const npc = parseNpc(item, `${path}[${idx}]`, push);
    if (npc) out.push(npc);
  });
  return out;
}

function parseNpc(value: unknown, path: string, push: Issue): Npc | null {
  if (!isPlainObject(value)) {
    push(path, `NPC 必须是对象。`);
    return null;
  }
  const id = isNonEmptyString(value["id"]) ? value["id"] : (push(`${path}.id`, `必填且非空。`), "");
  const name = isNonEmptyString(value["name"])
    ? value["name"]
    : (push(`${path}.name`, `必填且非空。`), "");

  const role = parseNpcRole(value["role"], `${path}.role`, push);
  const initialLocation = isNonEmptyString(value["initial_location"])
    ? value["initial_location"]
    : (push(`${path}.initial_location`, `必填,引用一个 scene id。`), "");
  const initialAttitude = parseNpcAttitude(value["initial_attitude"], `${path}.initial_attitude`, push);

  const frameRaw = value["frame"];
  if (!isPlainObject(frameRaw)) {
    push(`${path}.frame`, `必须是对象。`);
    return null;
  }

  const publicPersonaMd = isNonEmptyString(frameRaw["public_persona_md"])
    ? frameRaw["public_persona_md"]
    : (push(`${path}.frame.public_persona_md`, `必填且非空。`), "");
  const secretMd =
    typeof frameRaw["secret_md"] === "string" ? frameRaw["secret_md"] : undefined;
  const secretUnlockTrigger = isNonEmptyString(frameRaw["secret_unlock_trigger"])
    ? frameRaw["secret_unlock_trigger"]
    : undefined;
  if (secretMd && !secretUnlockTrigger) {
    push(`${path}.frame.secret_unlock_trigger`, `声明了 secret_md 就必须配 secret_unlock_trigger。`);
  }

  const stats = parseNpcStats(frameRaw["stats"], `${path}.frame.stats`, push);
  const combat = parseNpcCombat(frameRaw["combat"], `${path}.frame.combat`, push);
  const voiceGuidelines =
    parseStringArray(frameRaw["voice_guidelines"], `${path}.frame.voice_guidelines`, push, false) ??
    [];

  const freedomRaw = value["freedom"];
  let freedom: Npc["freedom"];
  if (freedomRaw !== undefined) {
    if (!isPlainObject(freedomRaw)) {
      push(`${path}.freedom`, `必须是对象。`);
    } else {
      freedom = {
        improvisableQuirks: parseStringArray(
          freedomRaw["improvisable_quirks"],
          `${path}.freedom.improvisable_quirks`,
          push,
          true,
        ),
        catchphrases: parseStringArray(
          freedomRaw["catchphrases"],
          `${path}.freedom.catchphrases`,
          push,
          true,
        ),
      };
    }
  }

  const forbidden = parseStringArray(value["forbidden"], `${path}.forbidden`, push, true);

  return {
    id,
    name,
    role,
    initialLocation,
    initialAttitude,
    frame: {
      publicPersonaMd,
      secretMd,
      secretUnlockTrigger,
      stats,
      combat,
      voiceGuidelines,
    },
    freedom,
    forbidden,
  };
}

function parseNpcRole(value: unknown, path: string, push: Issue): NpcRole {
  if (
    value === "平民" ||
    value === "盟友" ||
    value === "对立" ||
    value === "反派" ||
    value === "中立"
  )
    return value;
  push(path, `必须是 平民 | 盟友 | 对立 | 反派 | 中立。`);
  return "中立";
}

function parseNpcAttitude(value: unknown, path: string, push: Issue): NpcAttitude {
  if (
    value === "hostile" ||
    value === "wary" ||
    value === "neutral" ||
    value === "friendly" ||
    value === "trusting"
  )
    return value;
  push(path, `必须是 hostile | wary | neutral | friendly | trusting。`);
  return "neutral";
}

function parseNpcStats(value: unknown, path: string, push: Issue): NpcStats {
  if (!isPlainObject(value)) {
    push(path, `必须是对象。`);
    return {
      str: 0, con: 0, siz: 0, dex: 0, app: 0,
      int: 0, pow: 0, edu: 0, hp: 0, mp: 0, san: 0,
    };
  }
  const k = (key: keyof NpcStats) =>
    parseInteger(value[key], `${path}.${key}`, push, { min: 0 });
  return {
    str: k("str"), con: k("con"), siz: k("siz"), dex: k("dex"), app: k("app"),
    int: k("int"), pow: k("pow"), edu: k("edu"),
    hp: k("hp"), mp: k("mp"), san: k("san"),
  };
}

function parseNpcCombat(value: unknown, path: string, push: Issue): NpcCombat | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    push(path, `必须是对象。`);
    return undefined;
  }
  const weapon = isNonEmptyString(value["weapon"])
    ? value["weapon"]
    : (push(`${path}.weapon`, `必填。`), "");
  const damageFormula =
    parseDiceFormula(value["damage_formula"], `${path}.damage_formula`, push, false) ?? "0";
  const skillValue = parseInteger(value["skill_value"], `${path}.skill_value`, push, {
    min: 0,
    max: 100,
  });
  return { weapon, damageFormula, skillValue };
}

// ============================================================================
// §6 clues
// ============================================================================

function parseClues(
  value: unknown,
  path: string,
  push: Issue,
  warn: Issue,
): Clue[] | null {
  const arr = asArray(value);
  if (!arr) {
    push(path, `必须是数组(可空)。`);
    return null;
  }
  const out: Clue[] = [];
  arr.forEach((item, idx) => {
    const clue = parseClue(item, `${path}[${idx}]`, push, warn);
    if (clue) out.push(clue);
  });
  return out;
}

function parseClue(value: unknown, path: string, push: Issue, _warn: Issue): Clue | null {
  if (!isPlainObject(value)) {
    push(path, `clue 必须是对象。`);
    return null;
  }
  const id = isNonEmptyString(value["id"]) ? value["id"] : (push(`${path}.id`, `必填。`), "");
  const title = isNonEmptyString(value["title"])
    ? value["title"]
    : (push(`${path}.title`, `必填。`), "");

  const frameRaw = value["frame"];
  if (!isPlainObject(frameRaw)) {
    push(`${path}.frame`, `必须是对象。`);
    return null;
  }
  const locationScene = isNonEmptyString(frameRaw["location_scene"])
    ? frameRaw["location_scene"]
    : (push(`${path}.frame.location_scene`, `必填。`), "");
  const discovery = parseClueDiscovery(frameRaw["discovery"], `${path}.frame.discovery`, push);
  const revealMd = isNonEmptyString(frameRaw["reveal_md"])
    ? frameRaw["reveal_md"]
    : (push(`${path}.frame.reveal_md`, `必填。`), "");
  const kpNoteMd =
    typeof frameRaw["kp_note_md"] === "string" ? frameRaw["kp_note_md"] : undefined;

  const unlocksRaw = frameRaw["unlocks"];
  let unlocks: Clue["frame"]["unlocks"];
  if (unlocksRaw !== undefined) {
    if (!isPlainObject(unlocksRaw)) {
      push(`${path}.frame.unlocks`, `必须是对象。`);
    } else {
      unlocks = {
        secrets: parseStringArray(unlocksRaw["secrets"], `${path}.frame.unlocks.secrets`, push, true),
        scenes: parseStringArray(unlocksRaw["scenes"], `${path}.frame.unlocks.scenes`, push, true),
        flags: parseStringArray(unlocksRaw["flags"], `${path}.frame.unlocks.flags`, push, true),
      };
    }
  }

  const asset = typeof frameRaw["asset"] === "string" ? frameRaw["asset"] : undefined;

  const freedomRaw = value["freedom"];
  let freedom: Clue["freedom"];
  if (freedomRaw !== undefined) {
    if (!isPlainObject(freedomRaw)) {
      push(`${path}.freedom`, `必须是对象。`);
    } else {
      freedom = {
        sensoryWhenFoundMd:
          typeof freedomRaw["sensory_when_found_md"] === "string"
            ? freedomRaw["sensory_when_found_md"]
            : undefined,
        redHerringsAllowed: parseStringArray(
          freedomRaw["red_herrings_allowed"],
          `${path}.freedom.red_herrings_allowed`,
          push,
          true,
        ),
      };
    }
  }

  const forbidden = parseStringArray(value["forbidden"], `${path}.forbidden`, push, true);

  return {
    id,
    title,
    frame: {
      locationScene,
      discovery,
      revealMd,
      kpNoteMd,
      unlocks,
      asset,
    },
    freedom,
    forbidden,
  };
}

function parseClueDiscovery(value: unknown, path: string, push: Issue): ClueDiscovery {
  if (!isPlainObject(value)) {
    push(path, `必须是对象。`);
    return { method: "auto-on-enter" };
  }
  const method = value["method"];
  switch (method) {
    case "skill": {
      const skill = isNonEmptyString(value["skill"])
        ? value["skill"]
        : (push(`${path}.skill`, `method=skill 必须配 skill id。`), "");
      const difficulty = parseDifficulty(value["difficulty"], `${path}.difficulty`, push);
      return { method: "skill", skill, difficulty };
    }
    case "flag": {
      const conditionFlag = isNonEmptyString(value["condition_flag"])
        ? value["condition_flag"]
        : (push(`${path}.condition_flag`, `method=flag 必须配 condition_flag。`), "");
      return { method: "flag", conditionFlag };
    }
    case "npc-give": {
      const giverNpc = isNonEmptyString(value["giver_npc"])
        ? value["giver_npc"]
        : (push(`${path}.giver_npc`, `method=npc-give 必须配 giver_npc。`), "");
      const conditionFlag = isNonEmptyString(value["condition_flag"])
        ? value["condition_flag"]
        : undefined;
      return { method: "npc-give", giverNpc, conditionFlag };
    }
    case "auto-on-enter":
      return { method: "auto-on-enter" };
    default:
      push(`${path}.method`, `必须是 skill | flag | npc-give | auto-on-enter。`);
      return { method: "auto-on-enter" };
  }
}

// ============================================================================
// §7 timeline
// ============================================================================

function parseTimeline(
  value: unknown,
  path: string,
  push: Issue,
): TimelineEvent[] | null {
  const arr = asArray(value);
  if (!arr) {
    push(path, `必须是数组(可空)。`);
    return null;
  }
  const out: TimelineEvent[] = [];
  arr.forEach((item, idx) => {
    const ev = parseTimelineEvent(item, `${path}[${idx}]`, push);
    if (ev) out.push(ev);
  });
  // 升序校验:按 (gameDay, hour) 严格升序
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1].firesWhen;
    const cur = out[i].firesWhen;
    if (compareFiresWhen(prev, cur) > 0) {
      push(`${path}[${i}].fires_when`, `timeline 必须按 (game_day, hour) 升序。`);
      break;
    }
  }
  return out;
}

function compareFiresWhen(a: FiresWhen, b: FiresWhen): number {
  if (a.gameDay !== b.gameDay) return a.gameDay - b.gameDay;
  return a.hour.localeCompare(b.hour);
}

function parseTimelineEvent(
  value: unknown,
  path: string,
  push: Issue,
): TimelineEvent | null {
  if (!isPlainObject(value)) {
    push(path, `事件必须是对象。`);
    return null;
  }
  const id = isNonEmptyString(value["id"]) ? value["id"] : (push(`${path}.id`, `必填。`), "");
  const title = isNonEmptyString(value["title"])
    ? value["title"]
    : (push(`${path}.title`, `必填。`), "");

  const firesWhenRaw = value["fires_when"];
  let firesWhen: FiresWhen = { gameDay: 1, hour: "00:00" };
  if (!isPlainObject(firesWhenRaw)) {
    push(`${path}.fires_when`, `必须是 { game_day, hour }。`);
  } else {
    firesWhen = {
      gameDay: parseInteger(firesWhenRaw["game_day"], `${path}.fires_when.game_day`, push, {
        min: 1,
      }),
      hour: parseGameTime(firesWhenRaw["hour"], `${path}.fires_when.hour`, push),
    };
  }

  const forced = value["forced"];
  if (typeof forced !== "boolean") {
    push(`${path}.forced`, `必须是 true | false。`);
  }

  const prerequisites = parseTimelinePrerequisites(
    value["prerequisites"],
    `${path}.prerequisites`,
    push,
  );

  const once = value["once"];
  const onceParsed = once === undefined ? undefined : Boolean(once);

  const frameRaw = value["frame"];
  if (!isPlainObject(frameRaw)) {
    push(`${path}.frame`, `必须是对象。`);
    return null;
  }
  const narrativeSeedMd = isNonEmptyString(frameRaw["narrative_seed_md"])
    ? frameRaw["narrative_seed_md"]
    : (push(`${path}.frame.narrative_seed_md`, `必填。`), "");

  const effectsRaw = frameRaw["effects"];
  let effects: TimelineEvent["frame"]["effects"];
  if (effectsRaw !== undefined) {
    if (!isPlainObject(effectsRaw)) {
      push(`${path}.frame.effects`, `必须是对象。`);
    } else {
      effects = {};
      // setFlags
      const setFlagsRaw = effectsRaw["set_flags"];
      if (setFlagsRaw !== undefined) {
        const flagsArr = asArray(setFlagsRaw);
        if (!flagsArr) {
          push(`${path}.frame.effects.set_flags`, `必须是数组。`);
        } else {
          effects.setFlags = [];
          flagsArr.forEach((entry, idx) => {
            if (!isPlainObject(entry)) {
              push(`${path}.frame.effects.set_flags[${idx}]`, `必须是 { flag, value }。`);
              return;
            }
            const flag = isNonEmptyString(entry["flag"]) ? entry["flag"] : "";
            if (!flag) push(`${path}.frame.effects.set_flags[${idx}].flag`, `必填。`);
            const v = entry["value"];
            if (typeof v !== "boolean")
              push(`${path}.frame.effects.set_flags[${idx}].value`, `必须是 true | false。`);
            effects!.setFlags!.push({ flag, value: v === true });
          });
        }
      }
      effects.unlockScenes = parseStringArray(
        effectsRaw["unlock_scenes"],
        `${path}.frame.effects.unlock_scenes`,
        push,
        true,
      );
      effects.unlockClues = parseStringArray(
        effectsRaw["unlock_clues"],
        `${path}.frame.effects.unlock_clues`,
        push,
        true,
      );
      const fst = effectsRaw["force_scene_transition"];
      if (fst !== undefined && fst !== null) {
        if (!isNonEmptyString(fst)) {
          push(`${path}.frame.effects.force_scene_transition`, `必须是 scene id 字符串。`);
        } else {
          effects.forceSceneTransition = fst;
        }
      }
      // npcRelocate
      const relocateRaw = effectsRaw["npc_relocate"];
      if (relocateRaw !== undefined) {
        const arr = asArray(relocateRaw);
        if (!arr) {
          push(`${path}.frame.effects.npc_relocate`, `必须是数组。`);
        } else {
          effects.npcRelocate = [];
          arr.forEach((entry, idx) => {
            if (!isPlainObject(entry)) {
              push(`${path}.frame.effects.npc_relocate[${idx}]`, `必须是 { npc, to }。`);
              return;
            }
            const npc = isNonEmptyString(entry["npc"]) ? entry["npc"] : "";
            const to = isNonEmptyString(entry["to"]) ? entry["to"] : "";
            if (!npc) push(`${path}.frame.effects.npc_relocate[${idx}].npc`, `必填。`);
            if (!to) push(`${path}.frame.effects.npc_relocate[${idx}].to`, `必填。`);
            effects!.npcRelocate!.push({ npc, to });
          });
        }
      }
      // sanCheck
      const sanRaw = effectsRaw["san_check"];
      if (sanRaw !== undefined) {
        if (!isPlainObject(sanRaw)) {
          push(`${path}.frame.effects.san_check`, `必须是 { loss, reason }。`);
        } else {
          const lossRaw = sanRaw["loss"];
          if (!isPlainObject(lossRaw)) {
            push(`${path}.frame.effects.san_check.loss`, `必须是 { success, fail }。`);
          } else {
            const success = parseDiceFormula(
              lossRaw["success"],
              `${path}.frame.effects.san_check.loss.success`,
              push,
              false,
            );
            const fail = parseDiceFormula(
              lossRaw["fail"],
              `${path}.frame.effects.san_check.loss.fail`,
              push,
              false,
            );
            const reason = isNonEmptyString(sanRaw["reason"])
              ? sanRaw["reason"]
              : (push(`${path}.frame.effects.san_check.reason`, `必填。`), "");
            effects.sanCheck = {
              loss: {
                success: typeof success === "string" && /^\d+$/.test(success) ? Number(success) : success ?? "0",
                fail: fail ?? "0",
              },
              reason,
            };
          }
        }
      }
    }
  }

  const freedomRaw = value["freedom"];
  let freedom: TimelineEvent["freedom"];
  if (freedomRaw !== undefined) {
    if (!isPlainObject(freedomRaw)) {
      push(`${path}.freedom`, `必须是对象。`);
    } else {
      freedom = {
        atmosphereMd:
          typeof freedomRaw["atmosphere_md"] === "string"
            ? freedomRaw["atmosphere_md"]
            : undefined,
      };
    }
  }

  const forbidden = parseStringArray(value["forbidden"], `${path}.forbidden`, push, true);

  return {
    id,
    title,
    firesWhen,
    forced: forced === true,
    prerequisites,
    once: onceParsed,
    frame: { narrativeSeedMd, effects },
    freedom,
    forbidden,
  };
}

function parseTimelinePrerequisites(
  value: unknown,
  path: string,
  push: Issue,
): TimelinePrerequisite[] | undefined {
  if (value === undefined || value === null) return undefined;
  const arr = asArray(value);
  if (!arr) {
    push(path, `必须是数组。`);
    return undefined;
  }
  const out: TimelinePrerequisite[] = [];
  arr.forEach((entry, idx) => {
    if (!isPlainObject(entry)) {
      push(`${path}[${idx}]`, `必须是对象。`);
      return;
    }
    const kind = entry["kind"];
    if (kind === "flag") {
      const flag = isNonEmptyString(entry["flag"]) ? entry["flag"] : "";
      if (!flag) push(`${path}[${idx}].flag`, `kind=flag 必须配 flag。`);
      const v = entry["value"];
      if (typeof v !== "boolean") push(`${path}[${idx}].value`, `必须是 true | false。`);
      out.push({ kind: "flag", flag, value: v === true });
    } else if (kind === "clue") {
      const clue = isNonEmptyString(entry["clue"]) ? entry["clue"] : "";
      if (!clue) push(`${path}[${idx}].clue`, `kind=clue 必须配 clue。`);
      out.push({ kind: "clue", clue });
    } else {
      push(`${path}[${idx}].kind`, `必须是 flag | clue。`);
    }
  });
  return out;
}

// ============================================================================
// §8 flags / §9 endings / §10 globalFreedom
// ============================================================================

function parseFlags(value: unknown, path: string, push: Issue): Flag[] | null {
  const arr = asArray(value);
  if (!arr) {
    push(path, `必须是数组。`);
    return null;
  }
  const out: Flag[] = [];
  arr.forEach((item, idx) => {
    const p = `${path}[${idx}]`;
    if (!isPlainObject(item)) {
      push(p, `必须是对象。`);
      return;
    }
    const id = isNonEmptyString(item["id"]) ? item["id"] : (push(`${p}.id`, `必填。`), "");
    const title = isNonEmptyString(item["title"])
      ? item["title"]
      : (push(`${p}.title`, `必填。`), "");
    const initial = item["initial"];
    if (typeof initial !== "boolean") push(`${p}.initial`, `必须是 true | false。`);
    const descriptionMd =
      typeof item["description_md"] === "string" ? item["description_md"] : undefined;

    const rawWritableBy = item["writable_by"];
    let writableBy: Flag["writableBy"] | undefined;
    if (rawWritableBy !== undefined) {
      const arrWb = asArray(rawWritableBy);
      if (!arrWb) {
        push(`${p}.writable_by`, `必须是数组。`);
      } else {
        const allowed: ReadonlySet<string> = new Set([
          "clue-unlocks",
          "timeline-effects",
          "scenario-actions",
        ]);
        const collected: FlagWritableBy[] = [];
        arrWb.forEach((v, vi) => {
          if (typeof v !== "string" || !allowed.has(v)) {
            push(
              `${p}.writable_by[${vi}]`,
              `必须是 'clue-unlocks' | 'timeline-effects' | 'scenario-actions' 之一。`,
            );
            return;
          }
          collected.push(v as FlagWritableBy);
        });
        if (collected.length > 0) writableBy = collected;
      }
    }

    out.push({ id, title, initial: initial === true, descriptionMd, writableBy });
  });
  return out;
}

function parseEndings(value: unknown, path: string, push: Issue): Ending[] | null {
  const arr = asArray(value);
  if (!arr) {
    push(path, `必须是数组。`);
    return null;
  }
  if (arr.length === 0) {
    push(path, `至少需要一个结局。`);
    return null;
  }
  const out: Ending[] = [];
  arr.forEach((item, idx) => {
    const ending = parseEnding(item, `${path}[${idx}]`, push);
    if (ending) out.push(ending);
  });
  // 必须至少一个 victory/ambiguous
  const hasGood = out.some(
    (e) =>
      e.frame.scenarioEndKind === "victory" || e.frame.scenarioEndKind === "ambiguous",
  );
  if (!hasGood) {
    push(path, `endings 至少需要一个 victory 或 ambiguous 结局。`);
  }
  return out;
}

function parseEnding(value: unknown, path: string, push: Issue): Ending | null {
  if (!isPlainObject(value)) {
    push(path, `结局必须是对象。`);
    return null;
  }
  const id = isNonEmptyString(value["id"]) ? value["id"] : (push(`${path}.id`, `必填。`), "");
  const title = isNonEmptyString(value["title"])
    ? value["title"]
    : (push(`${path}.title`, `必填。`), "");

  const triggersRaw = value["triggers"];
  const triggers: EndingTrigger[] = [];
  if (!Array.isArray(triggersRaw) || triggersRaw.length === 0) {
    push(`${path}.triggers`, `必须是非空数组(AND 逻辑)。`);
  } else {
    triggersRaw.forEach((entry, idx) => {
      const tp = `${path}.triggers[${idx}]`;
      if (!isPlainObject(entry)) {
        push(tp, `必须是 { flag, value }。`);
        return;
      }
      const flag = isNonEmptyString(entry["flag"]) ? entry["flag"] : "";
      if (!flag) push(`${tp}.flag`, `必填。`);
      const v = entry["value"];
      if (typeof v !== "boolean") push(`${tp}.value`, `必须是 true | false。`);
      triggers.push({ flag, value: v === true });
    });
  }

  const priority = parseInteger(value["priority"], `${path}.priority`, push);

  const frameRaw = value["frame"];
  if (!isPlainObject(frameRaw)) {
    push(`${path}.frame`, `必须是对象。`);
    return null;
  }
  const epilogueMd = isNonEmptyString(frameRaw["epilogue_md"])
    ? frameRaw["epilogue_md"]
    : (push(`${path}.frame.epilogue_md`, `必填。`), "");
  const sanRewardRaw = frameRaw["san_reward"];
  let sanReward: string | number | undefined;
  if (sanRewardRaw !== undefined && sanRewardRaw !== null) {
    const formula = parseDiceFormula(sanRewardRaw, `${path}.frame.san_reward`, push, true);
    if (formula !== undefined) {
      sanReward = /^\d+$/.test(formula) ? Number(formula) : formula;
    }
  }
  const experiencePhase = frameRaw["experience_phase"];
  const rewards = parseEndingRewards(frameRaw["rewards"], `${path}.frame.rewards`, push);
  if (rewards && (sanReward !== undefined || experiencePhase !== undefined)) {
    push(
      `${path}.frame`,
      `rewards 与旧字段 san_reward / experience_phase 不能并存——rewards 已是结构化新字段,请只保留一种(推荐 rewards)。`,
    );
  }
  const scenarioEndKind = parseScenarioEndKind(
    frameRaw["scenario_end_kind"],
    `${path}.frame.scenario_end_kind`,
    push,
  );

  const freedomRaw = value["freedom"];
  let freedom: Ending["freedom"];
  if (freedomRaw !== undefined) {
    if (!isPlainObject(freedomRaw)) {
      push(`${path}.freedom`, `必须是对象。`);
    } else {
      freedom = {
        atmosphereMd:
          typeof freedomRaw["atmosphere_md"] === "string"
            ? freedomRaw["atmosphere_md"]
            : undefined,
      };
    }
  }

  const forbidden = parseStringArray(value["forbidden"], `${path}.forbidden`, push, true);

  return {
    id,
    title,
    triggers,
    priority,
    frame: {
      epilogueMd,
      sanReward,
      experiencePhase: experiencePhase === undefined ? undefined : Boolean(experiencePhase),
      rewards,
      scenarioEndKind,
    },
    freedom,
    forbidden,
  };
}

function parseEndingRewards(
  value: unknown,
  path: string,
  push: Issue,
): EndingRewards | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    push(path, `必须是对象。`);
    return undefined;
  }

  const skillGrowthRaw = value["skill_growth"];
  if (typeof skillGrowthRaw !== "boolean") {
    push(`${path}.skill_growth`, `必填,必须是 true | false。`);
  }

  let sanRewardFormula: string | number | undefined;
  const sanRaw = value["san_reward_formula"];
  if (sanRaw !== undefined && sanRaw !== null) {
    const formula = parseDiceFormula(sanRaw, `${path}.san_reward_formula`, push, true);
    if (formula !== undefined) {
      sanRewardFormula = /^\d+$/.test(formula) ? Number(formula) : formula;
    }
  }

  let sanRewardConditions: EndingSanRewardCondition[] | undefined;
  const condsRaw = value["san_reward_conditions"];
  if (condsRaw !== undefined && condsRaw !== null) {
    const arr = asArray(condsRaw);
    if (!arr) {
      push(`${path}.san_reward_conditions`, `必须是数组。`);
    } else {
      sanRewardConditions = [];
      arr.forEach((entry, idx) => {
        const ep = `${path}.san_reward_conditions[${idx}]`;
        if (!isPlainObject(entry)) {
          push(ep, `必须是对象。`);
          return;
        }
        const label = isNonEmptyString(entry["label"])
          ? entry["label"]
          : (push(`${ep}.label`, `必填,玩家可见的奖励名称。`), "");
        const flag =
          entry["flag"] === undefined
            ? undefined
            : isNonEmptyString(entry["flag"])
              ? entry["flag"]
              : (push(`${ep}.flag`, `必须是 flag id 字符串。`), undefined);
        const formulaParsed = parseDiceFormula(entry["formula"], `${ep}.formula`, push, false);
        const formula =
          formulaParsed === undefined
            ? "0"
            : /^\d+$/.test(formulaParsed)
              ? Number(formulaParsed)
              : formulaParsed;
        sanRewardConditions!.push({ label, flag, formula });
      });
    }
  }

  let cashReward: number | undefined;
  if (value["cash_reward"] !== undefined && value["cash_reward"] !== null) {
    cashReward = parseInteger(value["cash_reward"], `${path}.cash_reward`, push, { min: 0 });
  }

  return {
    skillGrowth: skillGrowthRaw === true,
    sanRewardFormula,
    sanRewardConditions,
    cashReward,
  };
}

function parseScenarioEndKind(value: unknown, path: string, push: Issue): ScenarioEndKind {
  if (
    value === "victory" ||
    value === "ambiguous" ||
    value === "dead" ||
    value === "insane"
  )
    return value;
  push(path, `必须是 victory | ambiguous | dead | insane。`);
  return "ambiguous";
}

function parseGlobalFreedom(
  value: unknown,
  path: string,
  push: Issue,
): GlobalFreedom | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    push(path, `必须是对象。`);
    return undefined;
  }
  return {
    eraAtmosphereMd:
      typeof value["era_atmosphere_md"] === "string" ? value["era_atmosphere_md"] : undefined,
    languageRegister:
      typeof value["language_register"] === "string" ? value["language_register"] : undefined,
    npcDefaultDialect:
      typeof value["npc_default_dialect"] === "string" ? value["npc_default_dialect"] : undefined,
  };
}

// ----------------------------------------------------------------------------
// §11 narrative_style:模组叙事文风
// ----------------------------------------------------------------------------

const NARRATIVE_SAMPLE_SOFT_LIMIT = 200;

function parseNarrativeStyle(
  value: unknown,
  path: string,
  push: Issue,
  warn: Issue,
): NarrativeStyle | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    push(path, `必须是对象。`);
    return undefined;
  }

  const out: NarrativeStyle = {};

  // frame:全是软约束,只校验类型,值是自由字符串
  const rawFrame = value["frame"];
  if (rawFrame !== undefined && rawFrame !== null) {
    if (!isPlainObject(rawFrame)) {
      push(`${path}.frame`, `必须是对象。`);
    } else {
      const frame: NarrativeStyleFrame = {};
      if (rawFrame["pov"] !== undefined) {
        if (typeof rawFrame["pov"] !== "string") {
          push(`${path}.frame.pov`, `必须是字符串。`);
        } else {
          frame.pov = rawFrame["pov"];
        }
      }
      if (rawFrame["tense"] !== undefined) {
        if (typeof rawFrame["tense"] !== "string") {
          push(`${path}.frame.tense`, `必须是字符串。`);
        } else {
          frame.tense = rawFrame["tense"];
        }
      }
      if (rawFrame["forbidden_phrasings"] !== undefined) {
        const arr = parseStringArray(
          rawFrame["forbidden_phrasings"],
          `${path}.frame.forbidden_phrasings`,
          push,
          /*optional*/ true,
        );
        if (arr) frame.forbiddenPhrasings = arr;
      }
      out.frame = frame;
    }
  }

  // freedom:同样全是软约束
  const rawFreedom = value["freedom"];
  if (rawFreedom !== undefined && rawFreedom !== null) {
    if (!isPlainObject(rawFreedom)) {
      push(`${path}.freedom`, `必须是对象。`);
    } else {
      const freedom: NarrativeStyleFreedom = {};
      if (rawFreedom["sentence_pacing_md"] !== undefined) {
        if (typeof rawFreedom["sentence_pacing_md"] !== "string") {
          push(`${path}.freedom.sentence_pacing_md`, `必须是字符串。`);
        } else {
          freedom.sentencePacingMd = rawFreedom["sentence_pacing_md"];
        }
      }
      if (rawFreedom["vocabulary_register"] !== undefined) {
        if (typeof rawFreedom["vocabulary_register"] !== "string") {
          push(`${path}.freedom.vocabulary_register`, `必须是字符串。`);
        } else {
          freedom.vocabularyRegister = rawFreedom["vocabulary_register"];
        }
      }
      if (rawFreedom["metaphor_palette"] !== undefined) {
        const arr = parseStringArray(
          rawFreedom["metaphor_palette"],
          `${path}.freedom.metaphor_palette`,
          push,
          /*optional*/ true,
        );
        if (arr) freedom.metaphorPalette = arr;
      }
      if (rawFreedom["reference_works"] !== undefined) {
        const arr = parseStringArray(
          rawFreedom["reference_works"],
          `${path}.freedom.reference_works`,
          push,
          /*optional*/ true,
        );
        if (arr) freedom.referenceWorks = arr;
      }
      if (rawFreedom["sample_paragraph_md"] !== undefined) {
        const sample = rawFreedom["sample_paragraph_md"];
        if (typeof sample !== "string") {
          push(`${path}.freedom.sample_paragraph_md`, `必须是字符串。`);
        } else {
          freedom.sampleParagraphMd = sample;
          // 软警告:示范段落不应过长(一段范本 > 十条规则,但太长会喧宾夺主)
          if (sample.length > NARRATIVE_SAMPLE_SOFT_LIMIT) {
            warn(
              `${path}.freedom.sample_paragraph_md`,
              `示范段落长度 ${sample.length} 字超过软上限 ${NARRATIVE_SAMPLE_SOFT_LIMIT} 字,建议精简(一段好范本 > 十条抽象规则)。`,
            );
          }
        }
      }
      out.freedom = freedom;
    }
  }

  return out;
}

// ----------------------------------------------------------------------------
// §12 preset_investigators:模组自带预设 PC
// ----------------------------------------------------------------------------

const PRESET_ATTR_KEYS: (keyof PresetInvestigatorAttributes)[] = [
  "str",
  "con",
  "siz",
  "dex",
  "app",
  "int",
  "pow",
  "edu",
];

function parsePresetInvestigators(
  value: unknown,
  path: string,
  push: Issue,
): PresetInvestigator[] | undefined {
  if (value === undefined || value === null) return undefined;
  const arr = asArray(value);
  if (!arr) {
    push(path, `必须是数组(可省略)。`);
    return undefined;
  }
  const out: PresetInvestigator[] = [];
  arr.forEach((item, idx) => {
    const pc = parsePresetInvestigator(item, `${path}[${idx}]`, push);
    if (pc) out.push(pc);
  });
  return out;
}

function parsePresetInvestigator(
  value: unknown,
  path: string,
  push: Issue,
): PresetInvestigator | null {
  if (!isPlainObject(value)) {
    push(path, `预设 PC 必须是对象。`);
    return null;
  }
  const id = isNonEmptyString(value["id"]) ? value["id"] : (push(`${path}.id`, `必填,kebab-case 全模组唯一。`), "");
  const name = isNonEmptyString(value["name"])
    ? value["name"]
    : (push(`${path}.name`, `必填且非空。`), "");
  const age = parseInteger(value["age"], `${path}.age`, push, { min: 1, max: 120 });
  const gender = isNonEmptyString(value["gender"])
    ? value["gender"]
    : (push(`${path}.gender`, `必填且非空(剧本预设需完整身份信息,LLM 不会覆盖)。`), "");
  const nationality = isNonEmptyString(value["nationality"])
    ? value["nationality"]
    : (push(`${path}.nationality`, `必填且非空(剧本预设需完整国籍信息,LLM 不会覆盖)。`), "");
  const identity = isNonEmptyString(value["identity"])
    ? value["identity"]
    : (push(`${path}.identity`, `必填且非空(剧本预设需完整角色身份描述,LLM 不会覆盖)。`), "");
  const occupation = isNonEmptyString(value["occupation"])
    ? value["occupation"]
    : (push(`${path}.occupation`, `必填,中文职业名或 occupation id。`), "");

  // attributes:全部必填,创角期 [15, 90](edu 上限 99)
  const attrsRaw = value["attributes"];
  let attributes: PresetInvestigatorAttributes = {
    str: 0, con: 0, siz: 0, dex: 0, app: 0, int: 0, pow: 0, edu: 0,
  };
  if (!isPlainObject(attrsRaw)) {
    push(`${path}.attributes`, `必须是对象,八项基础属性全部必填。`);
  } else {
    PRESET_ATTR_KEYS.forEach((key) => {
      const max = key === "edu" ? 99 : 90;
      const v = parseInteger(attrsRaw[key], `${path}.attributes.${key}`, push, {
        min: 15,
        max,
      });
      attributes[key] = v;
    });
  }

  // sanity / luck / creditRating
  const sanity = parseInteger(value["sanity"], `${path}.sanity`, push, { min: 0, max: 99 });
  const luck = parseInteger(value["luck"], `${path}.luck`, push, { min: 0, max: 99 });
  const creditRating = parseInteger(
    value["credit_rating"],
    `${path}.credit_rating`,
    push,
    { min: 0, max: 99 },
  );

  // skills:Record<string, number>,值 ∈ [0, 90]
  const skillsRaw = value["skills"];
  const skills: Record<string, number> = {};
  if (skillsRaw === undefined || skillsRaw === null) {
    push(`${path}.skills`, `必填(可空对象 {}),作者刻意定值的技能;留空走职业模板兜底。`);
  } else if (!isPlainObject(skillsRaw)) {
    push(`${path}.skills`, `必须是 { 技能名: 数值 } 对象。`);
  } else {
    for (const [skillName, sv] of Object.entries(skillsRaw)) {
      if (typeof sv !== "number" || !Number.isInteger(sv)) {
        push(`${path}.skills.${skillName}`, `必须是整数,收到 ${JSON.stringify(sv)}。`);
        continue;
      }
      if (sv < 0 || sv > 90) {
        push(`${path}.skills.${skillName}`, `RAW 创角期技能值必须 ∈ [0, 90],收到 ${sv}。`);
      }
      skills[skillName] = sv;
    }
  }

  const overviewMd = isNonEmptyString(value["overview_md"])
    ? value["overview_md"]
    : (push(`${path}.overview_md`, `必填,显示在选择卡上的简介。`), "");
  const backgroundStoryMd =
    typeof value["background_story_md"] === "string" ? value["background_story_md"] : undefined;
  const portrait = typeof value["portrait"] === "string" ? value["portrait"] : undefined;
  const birthplace = typeof value["birthplace"] === "string" ? value["birthplace"] : undefined;
  const residence = typeof value["residence"] === "string" ? value["residence"] : undefined;

  const weapons = value["weapons"] === undefined
    ? undefined
    : parseStringArray(value["weapons"], `${path}.weapons`, push, /*optional*/ true);

  let cashBalance: number | undefined;
  if (value["cash_balance"] !== undefined && value["cash_balance"] !== null) {
    cashBalance = parseInteger(value["cash_balance"], `${path}.cash_balance`, push, { min: 0 });
  }

  return {
    id,
    name,
    age,
    gender,
    nationality,
    identity,
    occupation,
    attributes,
    sanity,
    luck,
    creditRating,
    skills,
    overviewMd,
    backgroundStoryMd,
    portrait,
    birthplace,
    residence,
    weapons,
    cashBalance,
  };
}

// ============================================================================
// 跨节点引用与可达性
// ============================================================================

interface CollectedScenario {
  meta: ScenarioMeta;
  hook: ScenarioHook;
  scenes: Scene[];
  npcs: Npc[];
  clues: Clue[];
  timeline: TimelineEvent[];
  flags: Flag[];
  endings: Ending[];
  presetInvestigators?: PresetInvestigator[];
}

function validateReferences(s: CollectedScenario, push: Issue, warn: Issue) {
  // ---- id 全局唯一(各节点表内) ----
  checkUniqueIds(s.scenes.map((x) => x.id), "scenes", push);
  checkUniqueIds(s.npcs.map((x) => x.id), "npcs", push);
  checkUniqueIds(s.clues.map((x) => x.id), "clues", push);
  checkUniqueIds(s.flags.map((x) => x.id), "flags", push);
  checkUniqueIds(s.endings.map((x) => x.id), "endings", push);
  checkUniqueIds(s.timeline.map((x) => x.id), "timeline", push);

  const sceneIds = new Set(s.scenes.map((x) => x.id));
  const npcIds = new Set(s.npcs.map((x) => x.id));
  const clueIds = new Set(s.clues.map((x) => x.id));
  const flagIds = new Set(s.flags.map((x) => x.id));

  // ---- hook ----
  if (!sceneIds.has(s.hook.startScene)) {
    push("hook.start_scene", `引用未声明的 scene "${s.hook.startScene}"。`);
  }
  if (s.hook.defaultInitialClues) {
    s.hook.defaultInitialClues.forEach((cid, i) => {
      if (!clueIds.has(cid)) {
        push(`hook.default_initial_clues[${i}]`, `引用未声明的 clue "${cid}"。`);
      }
    });
  }
  if (s.hook.occupationVariants) {
    // 收集 era 表里允许的 occupation 集(id + 中文名)做命中检查
    const recommendedSet = new Set<string>(s.meta.recommendedOccupations);
    for (const [occKey, variant] of Object.entries(s.hook.occupationVariants)) {
      const vp = `hook.occupation_variants.${occKey}`;
      // 软警告:variant key 应当出现在 recommended_occupations 中,否则玩家选择
      // 该职业时无法触发该变体
      if (!recommendedSet.has(occKey)) {
        warn(
          vp,
          `key "${occKey}" 未出现在 meta.recommended_occupations 中,玩家选择该职业时不会命中此变体。`,
        );
      }
      // initial_clues 引用必须存在
      variant.initialClues?.forEach((cid, ci) => {
        if (!clueIds.has(cid)) {
          push(`${vp}.initial_clues[${ci}]`, `引用未声明的 clue "${cid}"。`);
        }
      });
    }
  }

  // ---- scenes ----
  s.scenes.forEach((scene, i) => {
    const sp = `scenes[${i}]`;
    scene.frame.exits.forEach((exit, j) => {
      const ep = `${sp}.frame.exits[${j}]`;
      if (!sceneIds.has(exit.to)) {
        push(`${ep}.to`, `引用未声明的 scene "${exit.to}"。`);
      }
      if (exit.condition === "requires-clue" && !clueIds.has(exit.requiredClue)) {
        push(`${ep}.required_clue`, `引用未声明的 clue "${exit.requiredClue}"。`);
      }
      if (exit.condition === "requires-flag" && !flagIds.has(exit.requiredFlag)) {
        push(`${ep}.required_flag`, `引用未声明的 flag "${exit.requiredFlag}"。`);
      }
      if (exit.condition === "requires-skill") {
        if (!findSkill(exit.requiredSkill)) {
          push(`${ep}.required_skill`, `"${exit.requiredSkill}" 不在 SKILL_REGISTRY_ALL 中。`);
        }
      }
    });
    scene.frame.npcsPresent.forEach((nid, j) => {
      if (!npcIds.has(nid)) {
        push(`${sp}.frame.npcs_present[${j}]`, `引用未声明的 npc "${nid}"。`);
      }
    });
    scene.frame.availableClues.forEach((cid, j) => {
      if (!clueIds.has(cid)) {
        push(`${sp}.frame.available_clues[${j}]`, `引用未声明的 clue "${cid}"。`);
      }
    });
  });

  // ---- npcs ----
  s.npcs.forEach((npc, i) => {
    const np = `npcs[${i}]`;
    if (!sceneIds.has(npc.initialLocation)) {
      push(`${np}.initial_location`, `引用未声明的 scene "${npc.initialLocation}"。`);
    }
    if (npc.frame.secretUnlockTrigger) {
      const t = npc.frame.secretUnlockTrigger;
      if (!clueIds.has(t) && !flagIds.has(t)) {
        push(
          `${np}.frame.secret_unlock_trigger`,
          `必须引用一个已声明的 clue 或 flag,"${t}" 不存在。`,
        );
      }
    }
  });

  // ---- clues ----
  s.clues.forEach((clue, i) => {
    const cp = `clues[${i}]`;
    if (!sceneIds.has(clue.frame.locationScene)) {
      push(`${cp}.frame.location_scene`, `引用未声明的 scene "${clue.frame.locationScene}"。`);
    }
    const d = clue.frame.discovery;
    if (d.method === "skill" && !findSkill(d.skill)) {
      push(`${cp}.frame.discovery.skill`, `"${d.skill}" 不在 SKILL_REGISTRY_ALL 中。`);
    }
    if (d.method === "flag" && !flagIds.has(d.conditionFlag)) {
      push(`${cp}.frame.discovery.condition_flag`, `引用未声明的 flag "${d.conditionFlag}"。`);
    }
    if (d.method === "npc-give") {
      if (!npcIds.has(d.giverNpc)) {
        push(`${cp}.frame.discovery.giver_npc`, `引用未声明的 npc "${d.giverNpc}"。`);
      }
      if (d.conditionFlag && !flagIds.has(d.conditionFlag)) {
        push(
          `${cp}.frame.discovery.condition_flag`,
          `引用未声明的 flag "${d.conditionFlag}"。`,
        );
      }
    }
    const u = clue.frame.unlocks;
    if (u) {
      u.secrets?.forEach((nid, j) => {
        if (!npcIds.has(nid))
          push(`${cp}.frame.unlocks.secrets[${j}]`, `引用未声明的 npc "${nid}"。`);
      });
      u.scenes?.forEach((sid, j) => {
        if (!sceneIds.has(sid))
          push(`${cp}.frame.unlocks.scenes[${j}]`, `引用未声明的 scene "${sid}"。`);
      });
      u.flags?.forEach((fid, j) => {
        if (!flagIds.has(fid))
          push(`${cp}.frame.unlocks.flags[${j}]`, `引用未声明的 flag "${fid}"。`);
      });
    }
  });

  // ---- timeline ----
  s.timeline.forEach((ev, i) => {
    const tp = `timeline[${i}]`;
    if (
      ev.firesWhen.gameDay < s.meta.startTime.gameDay ||
      (ev.firesWhen.gameDay === s.meta.startTime.gameDay &&
        ev.firesWhen.hour < s.meta.startTime.hour)
    ) {
      push(`${tp}.fires_when`, `早于 meta.start_time,事件不可能触发。`);
    }
    ev.prerequisites?.forEach((pre, j) => {
      const pp = `${tp}.prerequisites[${j}]`;
      if (pre.kind === "flag" && !flagIds.has(pre.flag)) {
        push(`${pp}.flag`, `引用未声明的 flag "${pre.flag}"。`);
      }
      if (pre.kind === "clue" && !clueIds.has(pre.clue)) {
        push(`${pp}.clue`, `引用未声明的 clue "${pre.clue}"。`);
      }
    });
    const eff = ev.frame.effects;
    if (eff) {
      eff.setFlags?.forEach((sf, j) => {
        if (!flagIds.has(sf.flag))
          push(`${tp}.frame.effects.set_flags[${j}].flag`, `引用未声明的 flag "${sf.flag}"。`);
      });
      eff.unlockScenes?.forEach((sid, j) => {
        if (!sceneIds.has(sid))
          push(`${tp}.frame.effects.unlock_scenes[${j}]`, `引用未声明的 scene "${sid}"。`);
      });
      eff.unlockClues?.forEach((cid, j) => {
        if (!clueIds.has(cid))
          push(`${tp}.frame.effects.unlock_clues[${j}]`, `引用未声明的 clue "${cid}"。`);
      });
      if (eff.forceSceneTransition && !sceneIds.has(eff.forceSceneTransition)) {
        push(
          `${tp}.frame.effects.force_scene_transition`,
          `引用未声明的 scene "${eff.forceSceneTransition}"。`,
        );
      }
      eff.npcRelocate?.forEach((rel, j) => {
        if (!npcIds.has(rel.npc))
          push(`${tp}.frame.effects.npc_relocate[${j}].npc`, `引用未声明的 npc "${rel.npc}"。`);
        if (!sceneIds.has(rel.to))
          push(`${tp}.frame.effects.npc_relocate[${j}].to`, `引用未声明的 scene "${rel.to}"。`);
      });
    }
  });

  // ---- endings ----
  s.endings.forEach((end, i) => {
    end.triggers.forEach((t, j) => {
      if (!flagIds.has(t.flag)) {
        push(`endings[${i}].triggers[${j}].flag`, `引用未声明的 flag "${t.flag}"。`);
      }
    });
    // rewards.sanRewardConditions[*].flag 必须引用合法 flag
    end.frame.rewards?.sanRewardConditions?.forEach((cond, j) => {
      if (cond.flag && !flagIds.has(cond.flag)) {
        push(
          `endings[${i}].frame.rewards.san_reward_conditions[${j}].flag`,
          `引用未声明的 flag "${cond.flag}"。`,
        );
      }
    });
  });

  // ---- 场景图连通性 ----
  if (sceneIds.has(s.hook.startScene)) {
    const reachable = bfsReachableScenes(s);
    s.scenes.forEach((scene, i) => {
      if (!reachable.has(scene.id)) {
        warn(
          `scenes[${i}].id`,
          `场景 "${scene.id}" 从 hook.start_scene 无法到达(忽略 requires-* 条件后)。可能是孤儿场景。`,
        );
      }
    });
  }

  // ---- 结局可达性 ----
  // 所有 trigger 中的 flag 必须存在"理论可达"的写入来源:
  // initial = true 直接算可达;clue.unlocks.flags / timeline.effects.setFlags / flag.writableBy 都算可达写入。
  const writableFlags = collectWritableFlags(s);
  s.endings.forEach((end, i) => {
    end.triggers.forEach((t, j) => {
      if (!flagIds.has(t.flag)) return; // 已被前面的引用校验报错
      const sources = writableFlags.get(t.flag);
      if (!sources || !sources.has(t.value)) {
        push(
          `endings[${i}].triggers[${j}]`,
          `没有任何来源能把 flag "${t.flag}" 设为 ${t.value};该结局不可达。` +
            `(可在 flags 表里给该 flag 加 writable_by: [scenario-actions] 声明它由 LLM 运行时写入)`,
        );
      }
    });
  });

  // ---- meta.recommended_occupations:必须能在对应 era 表里命中 ----
  // (era === "other" 时不做命中检查,作者自由声明)
  if (s.meta.era === "1920s" || s.meta.era === "modern") {
    const eraOccs = getOccupations(s.meta.era);
    s.meta.recommendedOccupations.forEach((occ, i) => {
      const hit =
        findOccupation(s.meta.era as "1920s" | "modern", occ) ??
        eraOccs.find((o) => o.nameZh === occ);
      if (!hit) {
        push(
          `meta.recommended_occupations[${i}]`,
          `"${occ}" 不在 cocOccupations.ts 的 ${s.meta.era} 表里(中文名或 id 任一即可)。`,
        );
      }
    });
  }

  // ---- preset_investigators ----
  if (s.presetInvestigators && s.presetInvestigators.length > 0) {
    // id 全模组唯一
    checkUniqueIds(
      s.presetInvestigators.map((p) => p.id),
      "preset_investigators",
      push,
    );
    // 每张卡:occupation 必须能命中 era;weapons 必须命中且 era 兼容
    s.presetInvestigators.forEach((pc, i) => {
      const pp = `preset_investigators[${i}]`;
      // occupation
      if (s.meta.era === "1920s" || s.meta.era === "modern") {
        const eraOccs = getOccupations(s.meta.era);
        const hit =
          findOccupation(s.meta.era as "1920s" | "modern", pc.occupation) ??
          eraOccs.find((o) => o.nameZh === pc.occupation);
        if (!hit) {
          push(
            `${pp}.occupation`,
            `"${pc.occupation}" 不在 cocOccupations.ts 的 ${s.meta.era} 表里。`,
          );
        }
      }
      // skills:键必须是合法技能(顶级 id 或顶级中文名;分支可写 "父类(分支名)" 形式,
      // 这里只校验顶级,分支命名约定较灵活,避免误报)
      Object.keys(pc.skills).forEach((skillName) => {
        const byId = findSkill(skillName);
        // 兼容中文写法:在 SKILL_REGISTRY_ALL 里查 nameZh / 子分支父类的 nameZh
        // 简化:直接放过中文键(分支命名"父类(分支)"格式无统一,留给运行时落卡时再校验)
        if (!byId && /^[a-z0-9-]+$/.test(skillName)) {
          push(
            `${pp}.skills.${skillName}`,
            `id 形式 "${skillName}" 不在 SKILL_REGISTRY_ALL 中(允许中文名,但 kebab id 必须命中)。`,
          );
        }
      });
      // weapons
      pc.weapons?.forEach((wid, wi) => {
        const w = findWeapon(wid);
        if (!w) {
          push(`${pp}.weapons[${wi}]`, `"${wid}" 不在 cocWeapons.ts 中。`);
          return;
        }
        if (w.era !== "any" && w.era !== s.meta.era) {
          push(
            `${pp}.weapons[${wi}]`,
            `武器 "${wid}" era=${w.era},与模组 era=${s.meta.era} 不兼容。`,
          );
        }
      });
      // 派生数值合理性软检查:sanity ≤ pow * 5(7e RAW,允许已损耗后低于上限)
      if (pc.sanity > pc.attributes.pow * 5) {
        push(
          `${pp}.sanity`,
          `sanity (${pc.sanity}) 超过 pow*5 (${pc.attributes.pow * 5});7e 创角期 SAN 上限 = pow*5。`,
        );
      }
    });
  }
}

function checkUniqueIds(ids: string[], path: string, push: Issue) {
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (id && seen.has(id)) {
      push(`${path}[${i}].id`, `id "${id}" 重复。`);
    } else if (id) {
      seen.add(id);
    }
  });
}

/**
 * BFS 从 hook.startScene 出发,**忽略 requires-* 条件**遍历可达场景。
 * 这是"理论可达性"——前端运行时还会按 condition 实际放行,但 schema 层面只关心是否有边。
 *
 * 同时把 timeline.effects.unlockScenes / forceSceneTransition / clue.unlocks.scenes
 * 视为额外的"事件传送门"边,从能解锁它的源场景往目标场景接一条隐边。简化处理:
 *   - timeline 的 unlock/transition 全部从 startScene 接(只要剧本能开演就有机会触发)
 *   - clue.unlocks.scenes 从 clue.locationScene 接(玩家必须先到 clue 所在场景)
 */
function bfsReachableScenes(s: CollectedScenario): Set<string> {
  const adj = new Map<string, Set<string>>();
  const ensure = (k: string) => {
    if (!adj.has(k)) adj.set(k, new Set());
    return adj.get(k)!;
  };
  const sceneIds = new Set(s.scenes.map((x) => x.id));

  // 显式 exits
  s.scenes.forEach((scene) => {
    scene.frame.exits.forEach((exit) => {
      if (sceneIds.has(exit.to)) ensure(scene.id).add(exit.to);
    });
  });
  // clue.unlocks.scenes:locationScene → unlocked
  s.clues.forEach((clue) => {
    clue.frame.unlocks?.scenes?.forEach((sid) => {
      if (sceneIds.has(clue.frame.locationScene) && sceneIds.has(sid)) {
        ensure(clue.frame.locationScene).add(sid);
      }
    });
  });
  // timeline:从 startScene 接隐边到 unlock/transition 目标
  s.timeline.forEach((ev) => {
    ev.frame.effects?.unlockScenes?.forEach((sid) => {
      if (sceneIds.has(sid)) ensure(s.hook.startScene).add(sid);
    });
    if (ev.frame.effects?.forceSceneTransition && sceneIds.has(ev.frame.effects.forceSceneTransition)) {
      ensure(s.hook.startScene).add(ev.frame.effects.forceSceneTransition);
    }
  });

  const reachable = new Set<string>();
  const queue: string[] = [s.hook.startScene];
  reachable.add(s.hook.startScene);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return reachable;
}

/**
 * 收集每个 flag 可能被写入的值(true / false)。
 * 来源:
 *   - flags.initial(只算它的 initial 值这一种状态)
 *   - clue.unlocks.flags(只能写 true,因为 schema 没有"清除 flag"语义)
 *   - timeline.effects.setFlags(可以写 true 或 false)
 *   - flag.writableBy 包含 'scenario-actions'(运行时 LLM 通道,Phase 2 落地;
 *     校验阶段视为 true 和 false 都可达)
 */
function collectWritableFlags(s: CollectedScenario): Map<string, Set<boolean>> {
  const map = new Map<string, Set<boolean>>();
  const add = (flag: string, v: boolean) => {
    if (!map.has(flag)) map.set(flag, new Set());
    map.get(flag)!.add(v);
  };
  s.flags.forEach((f) => {
    add(f.id, f.initial);
    if (f.writableBy?.includes("scenario-actions")) {
      add(f.id, true);
      add(f.id, false);
    }
  });
  s.clues.forEach((c) => c.frame.unlocks?.flags?.forEach((f) => add(f, true)));
  s.timeline.forEach((ev) =>
    ev.frame.effects?.setFlags?.forEach((sf) => add(sf.flag, sf.value)),
  );
  return map;
}

