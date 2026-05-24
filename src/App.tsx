/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  CharacterSheet,
  ChatMessage,
  ClueItem,
  RollRequest,
  SanityCheckRequest,
  RollResult,
  KeeperResponse,
  LogEntry,
  GameMode,
  ScenarioState,
} from "./types";
import CharacterCreator from "./components/CharacterCreator";
import RollDiceModal from "./components/RollDiceModal";
import EffectRollModal from "./components/EffectRollModal";
import MadnessIntCheckModal from "./components/MadnessIntCheckModal";
import CharacterSheetPanel from "./components/CharacterSheetPanel";
import CluesNotebook, { ImageViewer } from "./components/CluesNotebook";
import {
  Shield,
  MessageSquare,
  BookOpen,
  RotateCcw,
  Database,
  Sparkles,
  Send,
  HelpCircle,
  AlertCircle,
  Dices,
  Compass,
  Eye,
  User,
  Settings,
  Image as ImageIcon,
  Loader2,
  ZoomIn,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import StartScreen from "./components/StartScreen";
import MarkdownText from "./components/MarkdownText";
import {
  saveGame,
  generateTimestamp,
  downloadSaveAsJson,
  getAllSaves,
} from "./lib/saveManager";
import { loadApiSettings, isApiConfigured } from "./lib/apiSettings";
import ApiSettingsPanel from "./components/ApiSettingsPanel";
import { ConsoleLogPanel } from "./components/ConsoleLogPanel";
import { rollDiceFormula, DiceFormulaResult } from "./lib/diceFormula";
import { clampSanityLayers } from "./lib/cocRules";
import { findWeapon } from "./data/cocWeapons";
import { dispatchLlm, humanizeLlmError } from "./lib/llmClient";
import {
  SYSTEM_INSTRUCTION,
  loadDynamicInstructions,
  buildKeeperContext,
  buildElementSandboxLimiter,
  buildCombatDerivedBlock,
  buildInventoryBlock,
  buildScenarioModeBlock,
  sanitizeKeeperResponse,
} from "./lib/keeperPrompt";
import { KEEPER_RESPONSE_SCHEMA } from "./lib/llmSchemas";
import SettingsPanel from "./components/SettingsPanel";
import { WebGameSave, ApiSettings } from "./types";
import type {
  GameMode,
  ScenarioState,
  ScenarioActions,
} from "./types";
import { getModuleById } from "./data/modules";
import {
  buildScenarioContextBlock,
  buildNarrativeStyleBlock,
  applyScenarioActions,
  initialScenarioState,
} from "./lib/scenarioRuntime";
import type { RollContext as RollContextForScenario } from "./lib/scenarioRuntime";
import type { Scenario } from "./data/modules/_schema/scenario";
import { getImagePublicPrefix } from "./lib/publicConfig";
import {
  isLatestKeeperRollRequest,
  findPendingTailRollRequest,
  buildCancellationReport,
} from "./lib/rollCancellation";

/** 二阶段效果骰队列项 — 详见 .docs/two-stage-roll.md。 */
type EffectKind = "damage" | "heal" | "mpCost" | "sanLoss";
interface PendingEffectItem {
  kind: EffectKind;
  formula: string;
  evaluated: DiceFormulaResult;
}
const EFFECT_LABEL: Record<EffectKind, string> = {
  damage: "伤害值",
  heal: "治疗量",
  mpCost: "魔力消耗",
  sanLoss: "理智损失",
};
const EFFECT_VERB: Record<EffectKind, string> = {
  damage: "扣减 HP",
  heal: "恢复 HP",
  mpCost: "扣减 MP",
  sanLoss: "扣减 SAN",
};

/**
 * 单回合"垂死"的局部 1d10 命运代价(规则 9 救起分支)。
 * 与全局 luckBurn 不同——这是前端在 dying 状态下硬规则强制扣的"命运赎金",
 * 用来防止 LLM 永远救人导致玩家无任何代价。LUC 不足时直接 dead,不再走救起。
 */
function rollD10(): number {
  return 1 + Math.floor(Math.random() * 10);
}

/** 推断当前会话的终局态(从最后一条 keeper 消息的 parsedResponse.scenarioEnd 派生)。 */
function deriveScenarioStatus(
  messages: ChatMessage[],
): "dying" | "dead" | "insane" | "victory" | "ambiguous" | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.sender !== "keeper") continue;
    const end = m.parsedResponse?.scenarioEnd;
    if (end?.kind === "dead") return "dead";
    if (end?.kind === "insane") return "insane";
    if (end?.kind === "dying") return "dying";
    if (end?.kind === "victory") return "victory";
    if (end?.kind === "ambiguous") return "ambiguous";
    return null;
  }
  return null;
}

/**
 * 终局闸前端硬规则裁决(规则 9)。返回本回合 keeper 响应应该被覆盖成的 scenarioEnd。
 * - 非 dying 上下文 + HP 正常 → null
 * - 非 dying 上下文 + HP 归零 + 单次伤害 ≥ maxHp → dead(一次性致命)
 * - 非 dying 上下文 + HP 归零 + 单次伤害 < maxHp → dying(单回合垂死窗口)
 * - dying 上下文 + finalHp ≥ 1 → null(LLM 选择了救起)
 * - dying 上下文 + finalHp ≤ 0 → dead(单回合裁决,不允许 LLM 拖到第二个 dying 回合)
 */
function computeScenarioEnd(
  before: CharacterSheet,
  finalHp: number,
  damageMagnitude: number,
  prevStatus: "dying" | "dead" | "insane" | "victory" | "ambiguous" | null,
): KeeperResponse["scenarioEnd"] {
  // victory/ambiguous/dead/insane 已是终局态,直接保留(不会再扣血)
  if (prevStatus === "dead" || prevStatus === "insane" || prevStatus === "victory" || prevStatus === "ambiguous") {
    return { kind: prevStatus };
  }
  if (prevStatus === "dying") {
    if (finalHp >= 1) return null;
    return { kind: "dead" };
  }
  if (before.hp <= 0) return null;
  if (finalHp > 0) return null;
  if (damageMagnitude >= before.maxHp) return { kind: "dead" };
  return { kind: "dying" };
}

/**
 * 疯狂表(规则 10) — 1d10 表项与简短叙事代号。表项编号与 7e KRB p.158 一致。
 */
const MADNESS_TABLE: { id: number; name: string; brief: string }[] = [
  { id: 1, name: "失忆", brief: "她忽然记不起自己怎么会出现在这里" },
  { id: 2, name: "心理性残障", brief: "她突然短暂失明 / 失聪 / 一侧肢体不听使唤" },
  { id: 3, name: "狂暴攻击", brief: "她不分敌我地袭击身边最近的目标" },
  { id: 4, name: "偏执", brief: "她确信周围所有人都在密谋害她" },
  { id: 5, name: "关键人物错认", brief: "她把现场某人错认为背景里的故人" },
  { id: 6, name: "昏厥", brief: "她膝盖一软,世界向后退去" },
  { id: 7, name: "恐慌逃离", brief: "她不顾一切转身逃跑,丢下所有物品" },
  { id: 8, name: "歇斯底里", brief: "她爆发为大笑、大哭或尖叫,无法停止" },
  { id: 9, name: "获得恐惧症", brief: "她对眼前某具体物件产生不可遏制的恐惧" },
  { id: 10, name: "获得狂躁症", brief: "她对某具体物件产生不可遏制的强迫执念" },
];

/** 1-10 表项查询;越界回退到 1。 */
function lookupMadness(id: number) {
  return MADNESS_TABLE.find((m) => m.id === id) ?? MADNESS_TABLE[0];
}

/** 默认空 sanityState — 旧存档迁移时回填用,避免 undefined 解构报错。 */
const DEFAULT_SANITY_STATE: NonNullable<CharacterSheet["sanityState"]> = {
  episodeSanLoss: 0,
  madness: null,
};

export default function App() {
  const initialMode =
    (sessionStorage.getItem("keeper_app_mode") as any) || "start";
  const initialSaveId = sessionStorage.getItem("keeper_active_save_id");
  const saves = initialSaveId ? getAllSaves() : [];
  const initialSave = initialSaveId
    ? saves.find((s) => s.id === initialSaveId)
    : null;

  // Game states
  const [appMode, setAppMode] = useState<"start" | "creation" | "game">(
    initialMode,
  );
  const [activeSaveId, setActiveSaveId] = useState<string | null>(
    initialSave ? initialSave.id : null,
  );
  const [saveTimestamp, setSaveTimestamp] = useState<string>(
    initialSave ? initialSave.timestamp : "",
  );
  const [gameModuleName, setGameModuleName] = useState<string>(
    initialSave ? initialSave.moduleName : "克苏鲁的呼唤神秘冒险",
  );

  const [character, setCharacter] = useState<CharacterSheet | null>(
    initialSave ? initialSave.character : null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialSave ? initialSave.messages : [],
  );
  const [clues, setClues] = useState<ClueItem[]>(
    initialSave ? initialSave.clues : [],
  );
  const [enabledFeatures, setEnabledFeatures] = useState<{
    typemoon: boolean;
    scp: boolean;
  }>(initialSave ? initialSave.enabledFeatures : { typemoon: true, scp: true });

  // 剧本模式状态。老存档 / llm-generated 模式下 gameMode = "llm-generated",scenarioState 为空。
  // Phase 2 暂不暴露 UI 入口,切到 scenario-based 需要手改存档 JSON。
  const [gameMode, setGameMode] = useState<GameMode>(
    initialSave?.gameMode ?? "llm-generated",
  );
  const [scenarioState, setScenarioState] = useState<ScenarioState | null>(
    initialSave?.scenarioState ?? null,
  );
  const activeScenario: Scenario | null =
    gameMode === "scenario-based" && scenarioState
      ? getModuleById(scenarioState.moduleId) ?? null
      : null;

  // UI states
  const [inputText, setInputText] = useState<string>("");
  const [isKeeperLoading, setIsKeeperLoading] = useState<boolean>(false);
  const [showConfigPanel, setShowConfigPanel] = useState<
    "sheet" | "notebook" | null
  >(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showApiSettings, setShowApiSettings] = useState<boolean>(false);
  const [showConsoleLog, setShowConsoleLog] = useState<boolean>(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => loadApiSettings());

  // Ring buffer for console logs — cap at 500 entries to avoid render slowdowns.
  const addLog = React.useCallback(
    (
      draft:
        | Omit<LogEntry, "id" | "timestamp">
        | Array<Omit<LogEntry, "id" | "timestamp">>,
    ) => {
      const drafts = Array.isArray(draft) ? draft : [draft];
      if (drafts.length === 0) return;
      setLogs((prev) => {
        const now = Date.now();
        const incoming: LogEntry[] = drafts.map((d, i) => ({
          ...d,
          id: `log_${now}_${i}_${Math.random().toString(36).slice(2, 7)}`,
          timestamp: now + i,
        }));
        const next = [...prev, ...incoming];
        if (next.length <= 500) return next;
        return next.slice(next.length - 500);
      });
    },
    [],
  );

  // Inject ids/timestamps into server-returned _serverLogs and push them in.
  const ingestServerLogs = React.useCallback(
    (entries: unknown) => {
      if (!Array.isArray(entries) || entries.length === 0) return;
      const sanitized = entries
        .filter((e) => e && typeof e === "object")
        .map((e: any) => ({
          direction: (e.direction as LogEntry["direction"]) ?? "info",
          content: typeof e.content === "string" ? e.content : "",
          meta: e.meta,
        }));
      addLog(sanitized);
    },
    [addLog],
  );

  // Active Interactive Requests
  const [activeRoll, setActiveRoll] = useState<RollRequest | null>(null);
  const [activeSanity, setActiveSanity] = useState<SanityCheckRequest | null>(
    null,
  );
  const [pendingKeeperResponse, setPendingKeeperResponse] =
    useState<KeeperResponse | null>(null);

  // 对话中即兴 sceneImage 的状态:正在生成的 message id 集合 + 全屏预览中的 sceneImage
  const [generatingSceneImageMsgIds, setGeneratingSceneImageMsgIds] = useState<
    Set<string>
  >(new Set());
  const [scenePreview, setScenePreview] = useState<{
    messageId: string;
  } | null>(null);

  // Variable values changes animations trackers
  const [hpDiff, setHpDiff] = useState<number>(0);
  const [sanDiff, setSanDiff] = useState<number>(0);
  const [mpDiff, setMpDiff] = useState<number>(0);
  const [luckDiff, setLuckDiff] = useState<number>(0);

  /**
   * 疯狂态 INT 检定挂起态(规则 10 A 路径)。SAN 单次扣 ≥ 5 触发,
   * 弹出复用 RollDiceModal 的紫红主题检定;onResolve 后由 finalizer 处理后效。
   * 与 pendingEffectRoll 同级,但视觉上独立。
   */
  const [pendingMadnessCheck, setPendingMadnessCheck] = useState<{
    targetValue: number; // 调查员 INT 当前值
    onResolve: (passed: boolean) => void;
  } | null>(null);

  /**
   * 二阶段效果骰挂起态。技能判定 modal 关闭后，若需要再掷一次"效果公式"
   * （SAN 失败的 1d6、武器伤害等），由调用方 setPendingEffectRoll 推一份描述。
   * EffectRollModal 演完动画后调用 onResolve(diceResult)，业务侧再扣属性、回报 KP。
   */
  const [pendingEffectRoll, setPendingEffectRoll] = useState<{
    label: string;
    formula: string;
    result: DiceFormulaResult;
    theme?: "sanity" | "default";
    onResolve: (result: DiceFormulaResult) => void;
  } | null>(null);

  // Scenery parameters from keeper
  const [currentLocation, setCurrentLocation] =
    useState<string>("古木教堂的隐秘密道");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  /**
   * 剧本模式专用:玩家最近一次成功投出的判定结果。
   * 由 handleRollComplete / handleKeeperRollComplete 在投骰收尾时刷新,
   * 由 applyKeeperResponse 内的 applyScenarioActions 读取以校验
   * sceneTransition 的 requires-skill 出口与 clueDiscovered 的 method=skill 条件。
   * 一旦消费过(无论接受还是拒绝),由 applyKeeperResponse 自行清空,避免跨回合复用。
   */
  const lastRollContextRef = useRef<RollContextForScenario | null>(null);

  // Scroll to bottom of message thread
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isKeeperLoading]);

  // Handle game launcher start with chosen Investigator
  const handleGameStart = (
    chosenChar: CharacterSheet,
    features: { typemoon: boolean; scp: boolean },
    context: { gameMode: GameMode; scenario?: Scenario },
  ) => {
    // 入口处一次性深拷贝一份「创建期不可变快照」。运行期 setCharacter 不再触碰
    // creationSnapshot 字段；调查员档案 → 下载调查员角色卡 渲染的就是这份原貌。
    // 嵌套约束：snapshot 内部不再持有 creationSnapshot（截断递归）。
    const snapshotSource: CharacterSheet = { ...chosenChar };
    delete (snapshotSource as { creationSnapshot?: CharacterSheet }).creationSnapshot;
    const creationSnapshot: CharacterSheet = JSON.parse(JSON.stringify(snapshotSource));
    const charWithSnapshot: CharacterSheet = { ...chosenChar, creationSnapshot };
    setCharacter(charWithSnapshot);
    setEnabledFeatures(features);
    setAppMode("game");

    // 剧本模式 vs LLM 自由模式的初始化分流
    const isScenario = context.gameMode === "scenario-based" && context.scenario;
    let initialScenarioStateForKeeper: ScenarioState | null = null;
    if (isScenario) {
      const scenario = context.scenario!;
      setGameMode("scenario-based");
      const initState = initialScenarioState(scenario);
      initialScenarioStateForKeeper = initState;
      setScenarioState(initState);
      const startScene = scenario.scenes.find((s) => s.id === scenario.hook.startScene);
      setCurrentLocation(startScene?.title || scenario.meta.title);
      setGameModuleName(scenario.meta.title);
    } else {
      setGameMode("llm-generated");
      setScenarioState(null);
      setCurrentLocation("游戏准备舱 (调查室)");
      setGameModuleName("克苏鲁的呼唤神秘冒险");
    }

    const newSaveId = `save_${Date.now()}`;
    const newTimestamp = generateTimestamp();
    setActiveSaveId(newSaveId);
    setSaveTimestamp(newTimestamp);

    const activeMods = ["【固件】经典CoC"];
    if (features.typemoon) activeMods.push("【附加】Type-MOON要素");
    if (features.scp) activeMods.push("【附加】SCP要素");

    const initialSystemMsg: ChatMessage = {
      id: "sys_init_0",
      sender: "system",
      timestamp: new Date().toLocaleTimeString(),
      text: `已成功创建调查员档案：\n- **姓名** ↬ ${chosenChar.name}\n- **职业** ↬ ${chosenChar.occupation}\n- **生命(HP)** ↬ ${chosenChar.hp}/${chosenChar.maxHp} | **理智(SAN)** ↬ ${chosenChar.san}/${chosenChar.maxSan} | **幸运** ↬ ${chosenChar.attributes.luck}%\n- **内容模块** ↬ ${activeMods.join(", ")}\n\n联结世界已加载。正在为您秘密连接守密人(Keeper)...`,
    };

    setMessages([initialSystemMsg]);
    // 把这次发车应当使用的 scenario 上下文显式传给 triggerKeeperNarration,
    // 避免读到 setGameMode/setScenarioState 还没提交的旧 state。
    triggerKeeperNarration(
      [initialSystemMsg],
      chosenChar,
      features,
      isScenario
        ? {
            gameMode: "scenario-based",
            scenario: context.scenario!,
            scenarioState: initialScenarioStateForKeeper!,
          }
        : { gameMode: "llm-generated", scenario: null, scenarioState: null },
    );
  };

  // Send player speech or automated roll outcome back to keeper
  const handleSendPlayerMessage = async (
    textToSend: string,
    isSystemReport: boolean = false,
  ) => {
    if (!textToSend.trim() || isKeeperLoading) return;
    // CoC 7e 严格合规：SAN 检定挂起期间，玩家不可推进剧情。系统回报例外（SAN 检定结束后会以 system 身份发回）。
    if (activeSanity && !isSystemReport) return;
    // 规则 10:INT 检定 modal 挂起期间也不允许玩家发声(系统回报除外)
    if (pendingMadnessCheck && !isSystemReport) return;

    // 终局闸:dead / insane / victory / ambiguous 状态封盘——玩家所有输入(包括 system 回报)都不再推进 LLM。
    const currentStatus = deriveScenarioStatus(messages);
    if (
      currentStatus === "dead" ||
      currentStatus === "insane" ||
      currentStatus === "victory" ||
      currentStatus === "ambiguous"
    ) return;

    // [sys_test] 测试命令拦截 — 不入消息流、不入日志、不调 LLM
    if (!isSystemReport && textToSend.trim().startsWith("[sys_test]")) {
      const cmd = textToSend.trim().slice("[sys_test]".length).trim();
      runSysTestCommand(cmd);
      setInputText("");
      return;
    }

    // 放弃声明判定(详见 .docs/roll-cancellation.md 第三节铁律):
    // 当前 messages 队尾若是带未消费 rollRequest 的 keeper 消息,且本次新消息**不是**
    // 由"投完骰"流程注入的 system 回报(投完骰已通过方案A清空 rollRequest 字段),
    // 那就视为玩家撤回了行为意图 — 在新消息之前注入 [放弃声明] system 标记。
    // 该回报与玩家新消息合并进入同一次 LLM 调用,不再单独触发新调用。
    const cancellationMsgs: ChatMessage[] = [];
    const pendingTail = findPendingTailRollRequest(messages);
    if (pendingTail && pendingTail.parsedResponse?.rollRequest) {
      const rr = pendingTail.parsedResponse.rollRequest;
      // 原 rollRequest 留在历史卡片上(派生函数会把它渲染为"已错过"),不清空字段 —
      // 玩家"放弃了什么"在历史里仍要可见。
      cancellationMsgs.push({
        id: `sys_cancel_${Date.now()}`,
        sender: "system",
        timestamp: new Date().toLocaleTimeString(),
        text: buildCancellationReport(rr.skillName, rr.reason),
      });
    }

    const playerMsg: ChatMessage = {
      id: `player_${Date.now()}`,
      sender: isSystemReport ? "system" : "player",
      timestamp: new Date().toLocaleTimeString(),
      text: textToSend,
    };

    // 终局闸:dying 状态下,玩家本次发言即"遗言/挣扎"窗口结束,
    // 接下来 LLM 必须二选一(救起 / 死亡)。在玩家消息后追加一条系统提示,
    // 由 buildKeeperContext 透传给 LLM。规则 9 已经在 SYSTEM_INSTRUCTION 里展开,
    // 这里只放精简提示,触发 LLM 进入二选一模式。
    const dyingGateMsgs: ChatMessage[] = [];
    if (currentStatus === "dying") {
      const luc = character?.attributes.luck ?? 0;
      dyingGateMsgs.push({
        id: `sys_dying_gate_${Date.now()}`,
        sender: "system",
        timestamp: new Date().toLocaleTimeString(),
        text: `[终局闸] 调查员处于 dying 状态(剩余 LUC = ${luc})。本回合 KP 必须二选一并严格执行(详见 SYSTEM_INSTRUCTION 规则 9):\n① 救起:scenarioEnd 设为 null;characterUpdates.hpChange 给一个 ≥ 1 的正整数把 HP 拉回 ≥ 1;narrative 写叙事性救起(被路人/反派/巧合救起,不能原地满血复活);gameState.currentLocation 必须改成与原致命场景不同的物理地点;叙事上必须包含代价(俘虏/欠人情/丢物/被注视)。LUC 已由前端扣除 1d10 不需再扣。\n② 死亡:scenarioEnd = { kind: "dead", epilogue: "<150-300 字 Markdown 死亡尾声>" };narrative 写 80-150 字临终感官记忆;其它字段全部 null。\n禁止维持 dying / 继续战斗 / 拖到下一回合再投 CON。`,
      });
    }

    // 规则 10 疯狂干涉:在玩家消息进入 LLM 前,把当前疯狂态注入为 system 标记,
    // 让 LLM 按规则 10 曲解玩家声明。bout/temporary/indefinite 三态对应三套提示。
    const madnessGateMsgs: ChatMessage[] = [];
    const sanityState = character?.sanityState ?? null;
    if (sanityState && sanityState.madness) {
      const t = lookupMadness(sanityState.boutRoll ?? 1);
      let madnessText = "";
      if (sanityState.madness === "bout") {
        madnessText = `[疯狂干涉·急性发作 · 表项 #${t.id} ${t.name} · 仅本回合] ${t.brief}。规则 10 铁律:你必须接管玩家本次声明,按表项 #${t.id} ${t.name} 改写为对应行为,玩家声明的技能动作不得真正生效;narrative 渲染本次发作;禁止下发 rollRequest/sanityCheck;keeperRoll/sceneImage/clue 必须与发作行为相关。本回合结束后该急性态自动解除转入临时疯狂。`;
      } else if (sanityState.madness === "temporary") {
        madnessText = `[疯狂干涉·临时疯狂 · 起源表项 #${t.id} ${t.name} · 剩余 ${sanityState.temporaryTurnsRemaining ?? 0} 个守密人回合] 调查员仍在精神浑浊期。规则 10 铁律:narrative 持续渗透症状(${t.brief});玩家声明的 rollRequest 默认升一级 difficulty 或挂 1 penalty(只在症状直接干扰时);允许轻度感官错觉(她以为听到/看到),但禁止幻觉成为真实线索;禁止下发 sanityCheck。`;
      } else if (sanityState.madness === "indefinite") {
        madnessText = `[疯狂干涉·不定期疯狂 · 起源表项 #${t.id} ${t.name} · 持续整个模组] 调查员的精神已永久(本剧本范围内)失常。规则 10 铁律:每回合 narrative 必须渗透症状(${t.brief});rollRequest 默认挂 1 penalty;只有当本回合剧情中发生明确的心理治疗事件(NPC 医生介入 / Psychotherapy 技能成功 / 长期休养)且你判断治疗合理时,才可下发 madnessRecover: true 解除;禁止因玩家说"我冷静下来"就解除;禁止下发 sanityCheck。`;
      }
      if (madnessText) {
        madnessGateMsgs.push({
          id: `sys_madness_gate_${Date.now()}`,
          sender: "system",
          timestamp: new Date().toLocaleTimeString(),
          text: madnessText,
        });
      }
    }

    // 玩家发声消耗 1 个 bout 回合;temporary 在 keeper 回合结束时递减(applyKeeperResponse)。
    if (sanityState?.madness === "bout") {
      // bout 持续 1 个玩家输入回合 — 这次发声后立刻清零。
      // 这里我们标记为"已经触发过",keeper 回合结束时由 advanceMadnessAfterKeeper 转 temporary。
      setCharacter((prev) => prev ? {
        ...prev,
        sanityState: prev.sanityState ? { ...prev.sanityState, boutTurnsRemaining: 0 } : prev.sanityState,
      } : prev);
    }

    const updated = [...messages, ...cancellationMsgs, playerMsg, ...dyingGateMsgs, ...madnessGateMsgs];
    setMessages(updated);
    setInputText("");

    // Trigger Keeper Call
    triggerKeeperNarration(updated, character!, enabledFeatures);
  };

  /**
   * [sys_test] 测试命令派发器 — 直接构造 RollRequest / SanityCheckRequest 触发对应 modal。
   * 测试 modal 完成后由 onComplete sentinel (request.testForce) 检出，跳过所有游戏副作用。
   */
  const runSysTestCommand = (cmd: string) => {
    if (activeRoll || activeSanity) return; // 已有 modal 在场不重复触发
    switch (cmd) {
      case "roll":
        setActiveRoll({
          skillName: "侦查",
          targetValue: 60,
          difficulty: "regular",
          reason: "[测试] 普通投骰",
          testForce: {},
        });
        return;
      case "roll_win":
        setActiveRoll({
          skillName: "侦查",
          targetValue: 60,
          difficulty: "regular",
          reason: "[测试] 必定普通成功",
          testForce: { total: 50, successType: "regular" },
        });
        return;
      case "roll_crit":
        setActiveRoll({
          skillName: "侦查",
          targetValue: 60,
          difficulty: "regular",
          reason: "[测试] 必定大成功",
          testForce: { total: 1, successType: "critical" },
        });
        return;
      case "roll_fumble":
        setActiveRoll({
          skillName: "侦查",
          targetValue: 60,
          difficulty: "regular",
          reason: "[测试] 必定大失败",
          testForce: { total: 100, successType: "fumble" },
        });
        return;
      case "roll_fail":
        // 闪避是战斗骰，路径合规但被战斗白名单挡住——命运博弈按钮应不出现。
        setActiveRoll({
          skillName: "闪避",
          targetValue: 60,
          difficulty: "regular",
          reason: "[测试] 必定失败 · 战斗骰路径（命运博弈应不出现）",
          testForce: { total: 75, successType: "failure" },
        });
        return;
      case "roll_fail_gamble":
        setActiveRoll({
          skillName: "侦查",
          targetValue: 60,
          difficulty: "regular",
          reason: "[测试] 必定失败 · 命运博弈可用",
          testForce: { total: 75, successType: "failure" },
        });
        return;
      case "san":
        setActiveSanity({
          lossOnSuccess: "0",
          lossOnFailure: "1d6",
          reason: "[测试] SAN 检定 (真实随机 · 命运博弈应不出现)",
        });
        setActiveRoll({
          skillName: "理智意志 (SAN)",
          targetValue: character?.san ?? 60,
          difficulty: "regular",
          reason: "[测试] SAN 检定 · 真实随机",
          testForce: {},
        });
        return;
      case "san_success":
        setActiveSanity({
          lossOnSuccess: "0",
          lossOnFailure: "1d6",
          reason: "[测试] SAN 检定 · 强制成功（应展示 0 损失，不弹效果骰）",
        });
        setActiveRoll({
          skillName: "理智意志 (SAN)",
          targetValue: character?.san ?? 60,
          difficulty: "regular",
          reason: "[测试] SAN 强制成功",
          testForce: { total: 1, successType: "regular" },
        });
        return;
      case "san_fail":
        setActiveSanity({
          lossOnSuccess: "0",
          lossOnFailure: "1d6",
          reason: "[测试] SAN 检定 · 强制失败（应弹 1d6 效果骰浮窗）",
        });
        setActiveRoll({
          skillName: "理智意志 (SAN)",
          targetValue: character?.san ?? 60,
          difficulty: "regular",
          reason: "[测试] SAN 强制失败",
          testForce: { total: 99, successType: "failure" },
        });
        return;
      case "damage":
        runEffectRollTest("damage", "1d6");
        return;
      case "heal":
        runEffectRollTest("heal", "1d3");
        return;
      case "mp_cost":
        runEffectRollTest("mpCost", "1d4");
        return;
      case "damage_static":
        // 静态公式不弹浮窗,但仍演示 hpDiff 浮字,验证 isStatic 分流
        runEffectRollTest("damage", "5");
        return;
      case "damage_full":
        // 全链路:闪避失败判定 modal → 自动接 1d6+1 伤害效果骰浮窗
        setActiveRoll({
          skillName: "闪避",
          targetValue: 60,
          difficulty: "regular",
          reason: "[测试] 全链路 · 闪避失败 → 1d6+1 伤害效果骰",
          testForce: {
            total: 75,
            successType: "failure",
            chainEffect: { kind: "damage", formula: "1d6+1" },
          },
        });
        return;
      case "clue_image":
        // 带 prompt 的线索 → 笔记本应展示图框 + 占位 + 放大镜入口。
        setClues((prev) => [
          ...prev,
          {
            id: `clue_test_${Date.now()}`,
            title: "[测试] 沾血的祭坛拓印",
            type: "marking",
            description:
              "一张被反复折叠过的描图纸,拓下了石质祭坛侧面的环形铭文。" +
              "纸面还残留着深褐色的指印,环中心是一个倒五角,符号之间嵌着" +
              "看不懂的螺旋楔形。",
            prompt:
              "A folded sheet of tracing paper showing a circular ritual " +
              "inscription rubbed off a stone altar, dried blood-brown " +
              "fingerprints around the edges, an inverted pentagram at the " +
              "center surrounded by spiral cuneiform sigils, candlelit warm " +
              "shadows, weathered paper texture, gothic occult atmosphere, " +
              "cinematic close-up photo, ultra-detailed, grim Lovecraftian " +
              "rendering",
            discoveredAt: currentLocation,
            read: false,
          },
        ]);
        return;
      case "clue_text":
        // 不带 prompt 的纯文字线索 → 笔记本详情视图应**完全不渲染图框**,
        // 只显示标题 + 描述。
        setClues((prev) => [
          ...prev,
          {
            id: `clue_test_${Date.now()}`,
            title: "[测试] 殡仪馆账册第 七 页摘录",
            type: "note",
            description:
              "1923 年 11 月 4 日 · 入殓四具,均为夜间送达,未登记委托人姓名。" +
              "经手人: H. 莫里斯。备注栏: 无表征 / 无表征 / 颅骨缺失 / 无表征。" +
              "本页底部有铅笔注语: 「H 不肯交付钥匙,我去后院查过,土是新的。」",
            discoveredAt: currentLocation,
            read: false,
          },
        ]);
        return;
      case "scene_image": {
        // 对话内即兴 sceneImage 占位 — 在聊天里追加一条仅含 sceneImage 字段的 keeper 消息,
        // 走完整链路: 显示图像按钮 → 画图 → 缩略图 → 全屏预览 → 收录线索 → 笔记本档案。
        const id = `keeper_test_${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id,
            sender: "keeper",
            timestamp: new Date().toLocaleTimeString(),
            text: "[测试] 你的目光不由自主地停在祭坛侧面那道深刻的螺旋纹路上,符号边缘还残留着深褐色的渍迹。",
            sceneImage: {
              caption: "祭坛石板上深刻的螺旋符号,边缘残留着深褐色的渍迹",
              type: "marking",
              prompt:
                "A close-up of an ancient stone altar's side face, deeply " +
                "carved spiral cuneiform glyph dominant in the frame, " +
                "edges crusted with dried blood-brown residue, candlelit " +
                "warm shadows, weathered stone texture, gothic Lovecraftian " +
                "atmosphere, cinematic shallow depth of field, ultra-detailed",
            },
          },
        ]);
        return;
      }
      case "cancel_card": {
        // 放弃声明完整链路 — 在聊天里追加一条带 rollRequest 字段的 keeper 消息,
        // 用以验证三件事:
        //   (1) 初始队尾 → 卡片应渲染为金色 active 态、按钮可点;
        //   (2) 玩家随便发一句新消息 → 该卡片应自动变灰、按钮 disabled、文案改"已错过";
        //   (3) 触发上一步同时,前端会向 LLM 注入 [放弃声明] system 消息(测试模式由
        //       handleSendPlayerMessage 入口的 findPendingTailRollRequest 派生注入)。
        // 注:点"我再想想"暂离 modal 不应触发 (2)/(3),只有发新消息才算。
        const id = `keeper_test_${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id,
            sender: "keeper",
            timestamp: new Date().toLocaleTimeString(),
            text: "[测试] 走廊深处某扇半掩的门后传来极轻微的滴水声,像有什么东西在那片黑暗里慢慢滴落。",
            parsedResponse: {
              narrative: "",
              rollRequest: {
                skillName: "聆听",
                targetValue: 65,
                difficulty: "regular",
                reason: "[测试] 试图分辨滴水声背后是否还有别的声响",
              },
              gameState: {
                moduleName: gameModuleName,
                currentLocation: currentLocation,
              },
            } as KeeperResponse,
          },
        ]);
        return;
      }
      default:
        // 未知命令静默忽略，保持"测试通道不入消息"的承诺
        return;
    }
  };

  /**
   * [sys_test] 效果骰测试通道 — 直接构造 pendingEffectRoll 或同步走 diff 浮字。
   * 测试模式不真扣属性,只演动画+浮字,方便反复验证二阶段流水线。
   */
  const runEffectRollTest = (kind: EffectKind, formula: string) => {
    if (pendingEffectRoll) return;
    const evaluated = rollDiceFormula(formula);
    const showDiff = (value: number) => {
      if (value <= 0) return;
      switch (kind) {
        case "damage":
          setHpDiff(-value);
          setTimeout(() => setHpDiff(0), 3000);
          return;
        case "heal":
          setHpDiff(value);
          setTimeout(() => setHpDiff(0), 3000);
          return;
        case "mpCost":
          setMpDiff(-value);
          setTimeout(() => setMpDiff(0), 3000);
          return;
        case "sanLoss":
          setSanDiff(-value);
          setTimeout(() => setSanDiff(0), 3000);
          return;
      }
    };

    if (evaluated.isStatic) {
      showDiff(evaluated.total);
      return;
    }
    setPendingEffectRoll({
      label: `${EFFECT_LABEL[kind]} [测试]`,
      formula,
      result: evaluated,
      theme: kind === "sanLoss" ? "sanity" : "default",
      onResolve: (resolved) => {
        setPendingEffectRoll(null);
        showDiff(resolved.total);
      },
    });
  };

  const triggerKeeperNarration = async (
    currentHistory: ChatMessage[],
    activeChar: CharacterSheet,
    featuresToUse: { typemoon: boolean; scp: boolean } = enabledFeatures,
    scenarioOverride?: {
      gameMode: GameMode;
      scenario: Scenario | null;
      scenarioState: ScenarioState | null;
    },
  ) => {
    setIsKeeperLoading(true);

    const startedAt = Date.now();
    const tmEnabled = featuresToUse?.typemoon !== false;
    const scpEnabled = featuresToUse?.scp !== false;
    // 闭包陷阱:刚 setGameMode/setScenarioState 还没提交时,直接读组件 state 仍是旧值。
    // scenarioOverride 让调用方显式传入此次发车应当使用的 scenario 上下文(创角入场首调时必传)。
    const effectiveGameMode = scenarioOverride?.gameMode ?? gameMode;
    const effectiveScenario = scenarioOverride?.scenario ?? activeScenario;
    const effectiveScenarioState = scenarioOverride?.scenarioState ?? scenarioState;
    let lastUserText: string | undefined;
    let lastSystemInstructionLength: number | undefined;

    try {
      const dynamicInstructions = await loadDynamicInstructions();
      const scenarioBlock =
        effectiveGameMode === "scenario-based" && effectiveScenario && effectiveScenarioState
          ? buildScenarioModeBlock() +
            buildScenarioContextBlock(effectiveScenario, effectiveScenarioState) +
            buildNarrativeStyleBlock(effectiveScenario.narrativeStyle)
          : "";
      const systemInstruction =
        SYSTEM_INSTRUCTION +
        dynamicInstructions +
        buildElementSandboxLimiter(tmEnabled, scpEnabled) +
        buildCombatDerivedBlock(activeChar) +
        buildInventoryBlock(activeChar) +
        scenarioBlock;
      const userText = buildKeeperContext(currentHistory);
      lastUserText = userText;
      lastSystemInstructionLength = systemInstruction.length;

      addLog({
        direction: "request",
        content: `LLM dispatch → ${apiSettings.llm.provider} ${apiSettings.llm.model || "(default)"}`,
        meta: {
          provider: apiSettings.llm.provider,
          model: apiSettings.llm.model,
          msgCount: currentHistory.length,
          features: { typemoon: tmEnabled, scp: scpEnabled },
          gameMode: effectiveGameMode,
          scenarioId: effectiveScenario?.meta.id,
          systemInstructionLength: systemInstruction.length,
          userTextLength: userText.length,
          temperature: 0.85,
          topP: 0.95,
          schemaPresent: true,
          systemInstruction,
          userText,
        },
      });

      const textOutput = await dispatchLlm({
        apiSettings,
        systemInstruction,
        userText,
        schema: KEEPER_RESPONSE_SCHEMA,
        temperature: 0.85,
        topP: 0.95,
      });

      const keeperData: KeeperResponse = JSON.parse(textOutput);
      sanitizeKeeperResponse(keeperData);

      addLog({
        direction: "response",
        content: `LLM dispatch ← narrative ${(keeperData.narrative || "").length} chars`,
        meta: {
          durationMs: Date.now() - startedAt,
          provider: apiSettings.llm.provider,
          model: apiSettings.llm.model,
          responseLength: textOutput.length,
          narrativeLength: (keeperData.narrative || "").length,
          narrativePreview: (keeperData.narrative || "").slice(0, 400),
          hasRollRequest: !!keeperData.rollRequest,
          hasKeeperRoll: !!keeperData.keeperRoll,
          hasSanityCheck: !!keeperData.sanityCheck,
          hasClue: !!keeperData.clue,
          hasSceneImage: !!keeperData.sceneImage,
          hasNpcDialogue: !!keeperData.npcDialogue,
          hasGameState: !!keeperData.gameState,
          hasScenarioEnd: !!keeperData.scenarioEnd,
          hasCharacterUpdates: !!keeperData.characterUpdates,
          hasScenarioActions: !!(keeperData as any).scenarioActions,
          rawResponse: textOutput,
          keeperData,
        },
      });

      if (keeperData.keeperRoll) {
        setPendingKeeperResponse(keeperData);
        setActiveRoll({
          skillName: keeperData.keeperRoll.skillName,
          targetValue: keeperData.keeperRoll.targetValue,
          difficulty: keeperData.keeperRoll.difficulty,
          reason: keeperData.keeperRoll.reason,
          isKeeperRoll: true,
          isSecret: keeperData.keeperRoll.isSecret,
          bonus: keeperData.keeperRoll.bonus,
          penalty: keeperData.keeperRoll.penalty,
        });
      } else {
        applyKeeperResponse(keeperData);
      }
    } catch (error: any) {
      console.error(error);
      const friendly = humanizeLlmError(error);
      const stackPreview = typeof error?.stack === "string" ? error.stack.slice(0, 1500) : undefined;
      const httpStatus = error?.status ?? error?.response?.status;
      const httpBody = typeof error?.body === "string" ? error.body.slice(0, 4000) : undefined;
      addLog({
        direction: "error",
        content: `LLM dispatch exception · ${error?.name || "Error"}${httpStatus ? ` HTTP ${httpStatus}` : ""}`,
        meta: {
          durationMs: Date.now() - startedAt,
          provider: apiSettings.llm.provider,
          model: apiSettings.llm.model,
          gameMode: effectiveGameMode,
          scenarioId: effectiveScenario?.meta.id,
          friendlyMessage: friendly,
          errorName: error?.name,
          errorMessage: error?.message,
          errorStatus: httpStatus,
          errorBody: httpBody,
          errorStack: stackPreview,
          systemInstructionLength: lastSystemInstructionLength,
          userTextLength: lastUserText?.length,
          userTextPreview: lastUserText?.slice(0, 1200),
          msgCount: currentHistory.length,
          features: { typemoon: tmEnabled, scp: scpEnabled },
        },
      });
      const errCard: ChatMessage = {
        id: `err_${Date.now()}`,
        sender: "system",
        timestamp: new Date().toLocaleTimeString(),
        text: `【异常低语阻断】⚠️ ${friendly || "连接终点异常失效，请检查您的 API 配置。"}`,
        retryable: true,
        retryHistorySnapshot: currentHistory,
        retryFeatures: { typemoon: tmEnabled, scp: scpEnabled },
      };
      setMessages((prev) => [...prev, errCard]);
    } finally {
      setIsKeeperLoading(false);
    }
  };

  /**
   * 重发上次失败的 LLM 调用。
   * 触发源:用户点击错误卡上的"重新生成"按钮。
   * - errMsgId: 失败的 system 卡 id,用于把它从 messages 里抹掉
   * - snapshot: catch 时保存的 history 快照(失败那一刻 LLM 应当看到的对话)
   * - features: catch 时保存的 typemoon/scp 开关
   * 防重入:isKeeperLoading 为真时直接 return。
   */
  const handleKeeperRetry = (
    errMsgId: string,
    snapshot: ChatMessage[],
    features: { typemoon: boolean; scp: boolean },
  ) => {
    if (isKeeperLoading) return;
    if (!character) return;
    setMessages((prev) => prev.filter((x) => x.id !== errMsgId));
    triggerKeeperNarration(snapshot, character, features);
  };

  /**
   * 规则 10 SAN 影响裁决(纯函数,不写 state)。
   * 给定 SAN 损失值与角色当前状态,计算下一刻 sanityState 与待办 sideEffects。
   * 优先级:C(insane) > B(indefinite) > A(INT 检定 → bout/temporary)。
   * - sanLoss <= 0 → 无副作用(回血或无变化)
   * - finalSan === 0 → triggerInsane(终局闸 insane)
   * - episodeSanLoss + sanLoss >= currentSan / 5(取整,且 ≥ 1) → triggerIndefinite
   * - sanLoss >= 5 → triggerIntCheck(让调用方弹 INT 检定 modal)
   */
  const computeSanityImpact = (
    char: CharacterSheet,
    sanLoss: number,
    finalSan: number,
  ): {
    nextSanityState: NonNullable<CharacterSheet["sanityState"]>;
    triggerInsane: boolean;
    triggerIndefinite: boolean;
    triggerIntCheck: boolean;
  } => {
    const prev = char.sanityState ?? DEFAULT_SANITY_STATE;
    const next = { ...prev };

    if (sanLoss <= 0) {
      return {
        nextSanityState: next,
        triggerInsane: false,
        triggerIndefinite: false,
        triggerIntCheck: false,
      };
    }

    next.episodeSanLoss = (prev.episodeSanLoss ?? 0) + sanLoss;

    // C 路径:SAN 归零 → 永久疯狂终局
    if (finalSan === 0) {
      return {
        nextSanityState: next,
        triggerInsane: true,
        triggerIndefinite: false,
        triggerIntCheck: false,
      };
    }

    // B 路径:本模组累计 ≥ 当前 SAN 的 1/5(向下取整,最低阈值 1)→ 不定期疯狂
    // 注意:规则原文用"每日"但 7e KRB 也接受"每个剧本/调查段"作为 episode,
    //   单人桌没有日历,本游戏以模组为 episode。
    const indefiniteThreshold = Math.max(1, Math.floor(char.san / 5));
    const alreadyIndefinite = prev.madness === "indefinite";
    if (!alreadyIndefinite && next.episodeSanLoss >= indefiniteThreshold) {
      next.madness = "indefinite";
      next.boutRoll = next.boutRoll ?? (1 + Math.floor(Math.random() * 10));
      next.indefiniteAnchor = {
        moduleName: gameModuleName,
        turnId: `turn_${Date.now()}`,
      };
      return {
        nextSanityState: next,
        triggerInsane: false,
        triggerIndefinite: true,
        triggerIntCheck: false,
      };
    }

    // A 路径:单次 ≥ 5 触发 INT 检定(由调用方弹 modal,通过则进 bout/temporary)
    if (sanLoss >= 5) {
      return {
        nextSanityState: next,
        triggerInsane: false,
        triggerIndefinite: false,
        triggerIntCheck: true,
      };
    }

    return {
      nextSanityState: next,
      triggerInsane: false,
      triggerIndefinite: false,
      triggerIntCheck: false,
    };
  };

  /**
   * INT 检定通过后的处理(规则 10 A 通过路径):
   * 急性发作(bout) 1 个玩家输入回合,然后转 temporary 1d6 个 keeper 回合。
   * 同时给 +1 mythos 作为"理解了不可名状"的奖励,自动调低 maxSanLimit。
   * 调用方需要先在外部滚好 boutRoll(1-10),保证 setState 与回报文本一致。
   */
  const enterBoutFromIntCheck = (boutRoll: number, temporaryTurns: number) => {
    setCharacter((prev) => {
      if (!prev) return prev;
      const sanityState = prev.sanityState ?? DEFAULT_SANITY_STATE;
      // 阶段 10.7b：mythos +1 后由 clampSanityLayers 统一收敛 maxSanLimit / maxSan / san。
      const clamped = clampSanityLayers({
        mythos: prev.mythos + 1,
        maxSan: prev.maxSan,
        san: prev.san,
        maxSanLimit: prev.maxSanLimit,
      });
      return {
        ...prev,
        mythos: clamped.mythos,
        maxSanLimit: clamped.maxSanLimit,
        maxSan: clamped.maxSan,
        san: clamped.san,
        sanityState: {
          ...sanityState,
          madness: "bout",
          boutRoll,
          boutTurnsRemaining: 1,
          temporaryTurnsRemaining: temporaryTurns,
        },
      };
    });
  };

  /**
   * 每个 keeper 回合完成后递减疯狂状态机。
   * - bout(boutTurnsRemaining 已在玩家发声时清零)→ 转 temporary,清空 boutTurnsRemaining
   * - temporary → temporaryTurnsRemaining -= 1,归 0 时清零 madness/boutRoll/temporaryTurnsRemaining
   * - indefinite → 不递减(等 madnessRecover 或模组终结清零)
   * 同时:返回一个"是否需要在下一轮注入 [疯狂干涉·临时疯狂解除] 提示"的标记给调用方。
   */
  const advanceMadnessAfterKeeper = (recoverByLLM: boolean): { announceRecover: boolean } => {
    let announceRecover = false;
    setCharacter((prev) => {
      if (!prev?.sanityState) return prev;
      const ss = prev.sanityState;

      // LLM 下发 madnessRecover 解除 indefinite(C 路径)
      if (recoverByLLM && ss.madness === "indefinite") {
        return {
          ...prev,
          sanityState: {
            ...ss,
            madness: null,
            boutRoll: undefined,
            indefiniteAnchor: undefined,
          },
        };
      }

      if (ss.madness === "bout") {
        // 玩家发声已经把 boutTurnsRemaining 清零;这里 keeper 回合结束转 temporary。
        return {
          ...prev,
          sanityState: {
            ...ss,
            madness: "temporary",
            boutTurnsRemaining: undefined,
            // temporaryTurnsRemaining 已经在 enterBoutFromIntCheck 时滚好,不重复滚
          },
        };
      }

      if (ss.madness === "temporary") {
        const remaining = (ss.temporaryTurnsRemaining ?? 0) - 1;
        if (remaining <= 0) {
          announceRecover = true;
          return {
            ...prev,
            sanityState: {
              ...ss,
              madness: null,
              boutRoll: undefined,
              temporaryTurnsRemaining: undefined,
            },
          };
        }
        return {
          ...prev,
          sanityState: {
            ...ss,
            temporaryTurnsRemaining: remaining,
          },
        };
      }

      return prev;
    });
    return { announceRecover };
  };

  const applyKeeperResponse = (
    keeperData: KeeperResponse,
    keeperRollReport?: string,
  ) => {
    // 派生当前会话的"上一回合"终局态——用于判断 LLM 当前是否身处 dying 救起回合。
    const prevStatus = deriveScenarioStatus(messages);

    // Check for GameState updates
    if (keeperData.gameState) {
      if (keeperData.gameState.moduleName) {
        setGameModuleName(keeperData.gameState.moduleName);
      }
      setCurrentLocation(keeperData.gameState.currentLocation || "未知禁区");
    }

    // 终局闸:dying / dead 硬规则护栏(规则 9)。
    // 我们在 characterUpdates 之前先快照角色,在结算之后判断 HP/maxHp 阈值,
    // 并强制覆盖 LLM 的 scenarioEnd——LLM 只负责叙事,触发权归前端。
    const beforeChar = character!;
    let scenarioEndOverride: KeeperResponse["scenarioEnd"] = null;

    // 阶段 10.7a：现金 / 弹药变动 LogEntry,在 characterUpdates 块里收集,
    // 在下方 newMsgs 初始化后统一插入(置于 keeperRollReport 之后,主 keeper 消息之前)。
    const cashAmmoLog: string[] = [];

    // Check for Character Attributes updates (HP / SAN / MP)
    if (keeperData.characterUpdates) {
      const updates = keeperData.characterUpdates;

      // 公式字段优先:同类属性的整数字段被对应公式覆盖时跳过(详见 .docs/two-stage-roll.md 第四节)
      const skipHpChange = !!(updates.hpDamageFormula || updates.hpHealFormula);
      const skipMpChange = !!updates.mpCostFormula;
      const skipSanChange = !!updates.sanLossFormula;

      let finalHp = character!.hp;
      let finalMp = character!.mp;
      let finalSan = character!.san;
      let finalMythos = character!.mythos;
      let finalMaxSan = character!.maxSan;

      if (updates.hpChange && !skipHpChange) {
        finalHp = Math.max(
          0,
          Math.min(character!.maxHp, character!.hp + updates.hpChange),
        );
        setHpDiff(updates.hpChange);
        setTimeout(() => setHpDiff(0), 3000);
      }

      if (updates.mpChange && !skipMpChange) {
        finalMp = Math.max(
          0,
          Math.min(character!.maxMp, character!.mp + updates.mpChange),
        );
        setMpDiff(updates.mpChange);
        setTimeout(() => setMpDiff(0), 3000);
      }

      if (updates.sanChange && !skipSanChange) {
        // 仅做"不超过当前 maxSan + 不低于 0"的简单边界处理。
        // mythos 引发的硬上限收敛由后续 clampSanityLayers 统一负责。
        finalSan = Math.max(
          0,
          Math.min(character!.maxSan, character!.san + updates.sanChange),
        );
        setSanDiff(updates.sanChange);
        setTimeout(() => setSanDiff(0), 3000);
      }

      if (updates.sanitySkillGain) {
        finalMythos = character!.mythos + updates.sanitySkillGain;
      }

      // 阶段 10.7a：现金 / 弹药 KP 工具结算。
      // 走与 hp/mp/san 同一通道，但下游不再承接 sanityImpact / 终局闸,所以单独计算
      // finalCash / nextInventory + 一次性收集 LogEntry,在 setCharacter 时合并写入。
      const prevCash = typeof character!.cashBalance === "number" ? character!.cashBalance : 0;
      let finalCash = prevCash;
      const cashSetGiven = typeof updates.cashSetTo === "number" && Number.isFinite(updates.cashSetTo);
      const cashDeltaGiven = typeof updates.cashChange === "number" && Number.isFinite(updates.cashChange);
      if (cashSetGiven) {
        const target = Math.max(0, Math.floor(updates.cashSetTo!));
        finalCash = target;
        cashAmmoLog.push(`[现金变动] 现金余额重置：${prevCash} → ${finalCash}。`);
      } else if (cashDeltaGiven && updates.cashChange !== 0) {
        const delta = Math.floor(updates.cashChange!);
        const raw = prevCash + delta;
        finalCash = Math.max(0, raw);
        const overdraft = raw < 0 ? `（透支 ${Math.abs(raw)} 已钳到 0）` : "";
        const sign = delta > 0 ? "+" : "";
        cashAmmoLog.push(`[现金变动] ${sign}${delta} → 现金余额 ${prevCash} → ${finalCash}${overdraft}。`);
      }

      const prevInventory = character!.inventory ?? [];
      let nextInventory = prevInventory;
      if (Array.isArray(updates.ammoUpdates) && updates.ammoUpdates.length > 0) {
        const draftInv = prevInventory.slice();
        for (const upd of updates.ammoUpdates) {
          if (!upd || typeof upd.slotIndex !== "number") continue;
          const idx = Math.floor(upd.slotIndex);
          if (idx < 0 || idx >= draftInv.length) continue;
          const entry = draftInv[idx];
          if (!entry || entry.kind !== "weapon") continue;
          const w = findWeapon(entry.weaponId);
          if (!w || w.maxAmmo <= 0) continue;

          const setGiven = typeof upd.ammoSetTo === "number" && Number.isFinite(upd.ammoSetTo);
          const deltaGiven = typeof upd.ammoDelta === "number" && Number.isFinite(upd.ammoDelta);
          if (!setGiven && !deltaGiven) continue;

          const prevAmmo = entry.ammo;
          let nextAmmo = prevAmmo;
          if (setGiven) {
            nextAmmo = Math.max(0, Math.min(w.maxAmmo, Math.floor(upd.ammoSetTo!)));
            cashAmmoLog.push(`[弹药变动] [槽 ${idx}] ${w.nameZh} 弹药重置：${prevAmmo}/${w.maxAmmo} → ${nextAmmo}/${w.maxAmmo}。`);
          } else {
            const d = Math.floor(upd.ammoDelta!);
            if (d === 0) continue;
            const raw = prevAmmo + d;
            nextAmmo = Math.max(0, Math.min(w.maxAmmo, raw));
            const sign = d > 0 ? "+" : "";
            const note = raw < 0 ? "（已耗尽）" : raw > w.maxAmmo ? "（已封顶）" : "";
            cashAmmoLog.push(`[弹药变动] [槽 ${idx}] ${w.nameZh} ${sign}${d} → ${prevAmmo}/${w.maxAmmo} → ${nextAmmo}/${w.maxAmmo}${note}。`);
          }
          if (nextAmmo !== prevAmmo) {
            draftInv[idx] = { ...entry, ammo: nextAmmo };
          }
        }
        nextInventory = draftInv;
      }

      // 规则 10 SAN 影响裁决(整数路径) — 在 setCharacter 之前先算好 sanityState,
      // 避免 setCharacter 多次覆盖。triggerIntCheck 时 modal 在异步处理,但此时
      // sanityState 已经反映"扣减事实"(episodeSanLoss 累计),通过的话再补 madness。
      let pendingSanImpact:
        | ReturnType<typeof computeSanityImpact>
        | null = null;
      let nextSanityState = character!.sanityState ?? DEFAULT_SANITY_STATE;
      if (!skipSanChange && updates.sanChange !== undefined && updates.sanChange < 0) {
        const sanLoss = Math.abs(updates.sanChange);
        pendingSanImpact = computeSanityImpact(beforeChar, sanLoss, finalSan);
        nextSanityState = pendingSanImpact.nextSanityState;
      }

      // 阶段 10.7b：三层钳制 maxSanLimit → maxSan → san，由 cocRules.clampSanityLayers 单点收敛。
      // mythos 上涨（sanitySkillGain）→ maxSanLimit 下降 → 必要时压低 maxSan / san；
      // 仅 sanChange 路径时 mythos 不变，dependencies 无副作用。
      const clamped = clampSanityLayers({
        mythos: finalMythos,
        maxSan: finalMaxSan,
        san: finalSan,
        maxSanLimit: character!.maxSanLimit,
      });

      const nextCharState = {
        ...character!,
        hp: finalHp,
        mp: finalMp,
        san: clamped.san,
        maxSan: clamped.maxSan,
        mythos: clamped.mythos,
        maxSanLimit: clamped.maxSanLimit,
        sanityState: nextSanityState,
        cashBalance: finalCash,
        inventory: nextInventory,
      };

      setCharacter(nextCharState);

      // 终局闸:整数字段路径 — 同步结算完毕,立刻按 HP 阈值判定终局态。
      // 公式字段路径(下方 formulaQueue)结算在 runEffectRollQueue 异步进行,
      // 那条路的判定需要在 applyEffectItem(damage)完成后单独触发,见 onEffectQueueResolved。
      if (!skipHpChange && updates.hpChange !== undefined && updates.hpChange < 0) {
        const damageMagnitude = Math.abs(updates.hpChange);
        scenarioEndOverride = computeScenarioEnd(
          beforeChar,
          finalHp,
          damageMagnitude,
          prevStatus,
        );
      }

      // 规则 10:整数路径 sanChange 触发的疯狂裁决用 inline 模式(不发回报,
      // 仅追加 system 消息让下一轮 LLM 看到 + 可能弹 INT 检定 modal)。
      // insane 触发时会同时把 scenarioEnd 改写,优先级高于下面的 dying/dead 终局闸。
      if (pendingSanImpact && (
        pendingSanImpact.triggerInsane ||
        pendingSanImpact.triggerIndefinite ||
        pendingSanImpact.triggerIntCheck
      )) {
        finalizeSanityImpact("[SAN 整数扣减]", beforeChar, pendingSanImpact, "inline");
        if (pendingSanImpact.triggerInsane) {
          // SAN=0 优先于其它终局态;覆盖之前可能算出的 dying。
          scenarioEndOverride = { kind: "insane" };
        }
      }

      // 二阶段效果骰:收集公式字段,串行演投,演完汇总回报 KP。
      const formulaQueue: PendingEffectItem[] = [];
      if (updates.hpDamageFormula) {
        formulaQueue.push({
          kind: "damage",
          formula: updates.hpDamageFormula,
          evaluated: rollDiceFormula(updates.hpDamageFormula),
        });
      }
      if (updates.hpHealFormula) {
        formulaQueue.push({
          kind: "heal",
          formula: updates.hpHealFormula,
          evaluated: rollDiceFormula(updates.hpHealFormula),
        });
      }
      if (updates.mpCostFormula) {
        formulaQueue.push({
          kind: "mpCost",
          formula: updates.mpCostFormula,
          evaluated: rollDiceFormula(updates.mpCostFormula),
        });
      }
      if (updates.sanLossFormula) {
        formulaQueue.push({
          kind: "sanLoss",
          formula: updates.sanLossFormula,
          evaluated: rollDiceFormula(updates.sanLossFormula),
        });
      }
      if (formulaQueue.length > 0) {
        // 终局闸/疯狂裁决基线:把"应用 characterUpdates 整数字段之后"的 HP/SAN 快照传进去。
        // 真正影响是 hpDamageFormula / sanLossFormula 累计扣的部分,baseline.beforeHp/SAN 是这些公式开始之前的值。
        runEffectRollQueue(formulaQueue, [], {
          beforeHp: finalHp,
          maxHp: beforeChar.maxHp,
          beforeSan: finalSan,
          beforeChar,
        });
      }
    }

    const newMsgs: ChatMessage[] = [];

    // 终局闸:dying 救起回合的 1d10 LUC 命运代价(规则 9 救起分支)。
    // 若 LLM 在 dying 上下文里选择了救起(prevStatus === "dying" && scenarioEndOverride === null),
    // 前端在此处强制扣 1d10 LUC,作为命运在还人情的代价。LUC 不足 → 直接 dead。
    let luckSacrificeReport: string | null = null;
    if (prevStatus === "dying" && scenarioEndOverride === null) {
      const cost = rollD10();
      const currentLuck = beforeChar.attributes.luck;
      if (currentLuck < cost) {
        // 命运无可挥霍——救起失败,降级为 dead。
        scenarioEndOverride = { kind: "dead" };
        luckSacrificeReport = `[终局闸·命运赎金] 救起需消耗 1d10 = ${cost} 点幸运,但当前 LUC 仅 ${currentLuck} 点不足支付。命运不再眷顾,救起失败。`;
      } else {
        const nextLuck = currentLuck - cost;
        // 在 setCharacter 之外再 patch 一次 LUC(整数路径已 setCharacter 过一次,这里追加幸运扣减)
        setCharacter((prev) => prev ? {
          ...prev,
          attributes: { ...prev.attributes, luck: nextLuck },
        } : prev);
        setLuckDiff(-cost);
        setTimeout(() => setLuckDiff(0), 3000);
        luckSacrificeReport = `[终局闸·命运赎金] 调查员被叙事性救起,命运的代价已支付:1d10 = ${cost} 点幸运被永久扣除(剩余 LUC = ${nextLuck})。`;
      }
    }
    if (luckSacrificeReport) {
      newMsgs.push({
        id: `sys_luck_sacrifice_${Date.now()}`,
        sender: "system",
        timestamp: new Date().toLocaleTimeString(),
        text: luckSacrificeReport,
      });
    }

    // Prior narrative roll report (Keeper action text) if provided
    if (keeperRollReport) {
      newMsgs.push({
        id: `sys_keeper_roll_${Date.now()}`,
        sender: "system",
        timestamp: new Date().toLocaleTimeString(),
        text: keeperRollReport,
      });
    }

    // 阶段 10.7a：现金 / 弹药变动逐条 LogEntry,排在 keeper 主消息前,
    // 让玩家先看到面板会怎么动,再看 KP 的叙事。
    if (cashAmmoLog.length > 0) {
      const baseTs = Date.now();
      cashAmmoLog.forEach((line, i) => {
        newMsgs.push({
          id: `sys_cash_ammo_${baseTs}_${i}`,
          sender: "system",
          timestamp: new Date().toLocaleTimeString(),
          text: line,
        });
      });
    }

    // ---------- 剧本模式:scenarioActions 校验 + 落账 + 反向标记 ----------
    // 仅当 gameMode === "scenario-based" 且持有合法 scenario + scenarioState 时才处理;
    // llm-generated 模式下 LLM 不应下发本字段,即使下了也直接忽略。
    let scenarioAutoEnding:
      | { kind: "victory" | "ambiguous" | "dead" | "insane"; epilogue?: string }
      | null = null;
    if (
      gameMode === "scenario-based" &&
      activeScenario &&
      scenarioState &&
      keeperData.scenarioActions
    ) {
      const scenarioResult = applyScenarioActions(
        keeperData.scenarioActions,
        scenarioState,
        activeScenario,
        lastRollContextRef.current,
      );
      // 一次性消费 — 无论接受/拒绝都清空,避免跨回合的"幽灵骰"复用
      lastRollContextRef.current = null;

      if (scenarioResult.nextState !== scenarioState) {
        setScenarioState(scenarioResult.nextState);
      }
      if (scenarioResult.systemMarkers.length > 0) {
        const baseTs = Date.now();
        scenarioResult.systemMarkers.forEach((line, i) => {
          newMsgs.push({
            id: `sys_scenario_${baseTs}_${i}`,
            sender: "system",
            timestamp: new Date().toLocaleTimeString(),
            text: line,
          });
        });
      }
      scenarioAutoEnding = scenarioResult.autoEnding;
    }

    // Create main message card with KeeperResponse
    const snapshotModuleName =
      keeperData.gameState?.moduleName || gameModuleName;
    const snapshotLocation =
      keeperData.gameState?.currentLocation || currentLocation;

    // 终局闸:scenarioEndOverride 优先级最高(HP/SAN 硬规则护栏),
    // 其次是剧本模式 scenarioActions.endingProposed 校验通过自动写出的 scenarioAutoEnding,
    // 最后才是 LLM 在 keeperData.scenarioEnd 里自行下发的(llm-generated 模式主路径)。
    const finalScenarioEnd =
      scenarioEndOverride ?? scenarioAutoEnding ?? keeperData.scenarioEnd ?? null;
    const isTerminalKind = finalScenarioEnd && (
      finalScenarioEnd.kind === "dead" ||
      finalScenarioEnd.kind === "dying" ||
      finalScenarioEnd.kind === "insane" ||
      finalScenarioEnd.kind === "victory" ||
      finalScenarioEnd.kind === "ambiguous"
    );
    const sealedKeeperData: KeeperResponse = isTerminalKind
      ? {
          narrative: keeperData.narrative,
          gameState: keeperData.gameState,
          scenarioEnd: finalScenarioEnd,
          rollRequest: null,
          keeperRoll: null,
          sanityCheck: null,
          clue: null,
          sceneImage: null,
          characterUpdates: keeperData.characterUpdates ?? null,
          // dying 单回合垂死还需要 npc 临终对白;其它终局态(dead/insane/victory/ambiguous)不需要
          npcDialogue: finalScenarioEnd!.kind === "dying" ? keeperData.npcDialogue ?? null : null,
        }
      : { ...keeperData, scenarioEnd: finalScenarioEnd };

    newMsgs.push({
      id: `keeper_${Date.now()}`,
      sender: "keeper",
      timestamp: new Date().toLocaleTimeString(),
      text: sealedKeeperData.narrative,
      parsedResponse: sealedKeeperData,
      model: apiSettings.llm.model || apiSettings.llm.provider,
      moduleName: snapshotModuleName,
      location: snapshotLocation,
      sceneImage: sealedKeeperData.sceneImage
        ? {
            caption: sealedKeeperData.sceneImage.caption,
            type: sealedKeeperData.sceneImage.type,
            prompt: sealedKeeperData.sceneImage.prompt,
          }
        : undefined,
    });

    // 终局闸:dying 状态下,在玩家"遗言"消息发出后(handleSendPlayerMessage 入口)
    // 注入下一轮的 [终局闸 dying] 系统提示;dead/insane 不需要此提示因为后续无 LLM 调用。
    // 这里我们把"是否注入 dying 提示"标记到一条延迟生效的 system 消息里:
    // 改为更直接的做法 — handleSendPlayerMessage 派发时根据 deriveScenarioStatus 自行注入。

    setMessages((prev) => [...prev, ...newMsgs]);

    // 终局态(dead / insane / victory / ambiguous)→ 跳过所有 modal 触发,直接 return。
    if (
      finalScenarioEnd?.kind === "dead" ||
      finalScenarioEnd?.kind === "insane" ||
      finalScenarioEnd?.kind === "victory" ||
      finalScenarioEnd?.kind === "ambiguous"
    ) {
      setActiveRoll(null);
      setActiveSanity(null);
      return;
    }
    // 终局态(dying)→ 同样不弹任何 modal,但保留输入框给玩家发送遗言。
    if (finalScenarioEnd?.kind === "dying") {
      setActiveRoll(null);
      setActiveSanity(null);
      return;
    }

    // Handle roll triggers or Sanity check triggers in response
    // ALWAYS clear active roll state so player can click to trigger manually
    setActiveRoll(null);

    if (sealedKeeperData.sanityCheck) {
      // CoC 7e 严格合规：SAN 冲击是不可回避的——直接弹 modal，不走聊天卡片按钮。
      setActiveSanity(sealedKeeperData.sanityCheck);
      setActiveRoll({
        skillName: "理智意志 (SAN)",
        targetValue: character!.san,
        difficulty: "regular",
        reason: sealedKeeperData.sanityCheck.reason,
      });
    } else {
      setActiveSanity(null);
    }

    // Handle custom discovered CLUES items visually and add to local Notebook.
    // 注意:这里只把线索登记进档案,**不主动**请求画图;真正的画图调用延迟到玩家
    // 在调查笔记本中首次点击放大镜时按需触发(见 requestClueImage)。
    if (sealedKeeperData.clue) {
      const cluePayload = sealedKeeperData.clue;
      const nextClueItem: ClueItem = {
        id: `clue_${Date.now()}`,
        title: cluePayload.title,
        type: cluePayload.type,
        description: cluePayload.description,
        prompt: cluePayload.prompt,
        discoveredAt: sealedKeeperData.gameState?.currentLocation || currentLocation,
        read: false,
      };
      setClues((p) => [...p, nextClueItem]);
    }

    // 规则 10:keeper 回合应用完毕后递减疯狂状态机。
    // - bout(boutTurnsRemaining=0)→ temporary
    // - temporary → -1,归 0 时清零(announceRecover=true 时下一轮注入解除提示)
    // - indefinite + LLM 下发 madnessRecover → 清零
    // - 终局态(dead/insane/dying)不递减:dead/insane 已封盘;dying 只剩 1 回合,递减无意义
    if (!isTerminalKind) {
      const recoverByLLM = !!keeperData.madnessRecover;
      const { announceRecover } = advanceMadnessAfterKeeper(recoverByLLM);
      if (announceRecover) {
        // 注入"临时疯狂解除"提示,下一轮 LLM 自然读到
        const t = lookupMadness(beforeChar.sanityState?.boutRoll ?? 1);
        setMessages((prev) => [
          ...prev,
          {
            id: `sys_madness_recover_${Date.now()}`,
            sender: "system",
            timestamp: new Date().toLocaleTimeString(),
            text: `[疯狂干涉·临时疯狂解除] 调查员重新清醒,但 #${t.id} ${t.name} 的余韵留下来了。下一回合 narrative 可以淡淡呼应一下解除——但克系叙事不会真正让人康复,不要写成"她终于康复了"。`,
          },
        ]);
      }
      if (recoverByLLM && beforeChar.sanityState?.madness === "indefinite") {
        const t = lookupMadness(beforeChar.sanityState.boutRoll ?? 1);
        setMessages((prev) => [
          ...prev,
          {
            id: `sys_madness_indefinite_recover_${Date.now()}`,
            sender: "system",
            timestamp: new Date().toLocaleTimeString(),
            text: `[疯狂干涉·不定期疯狂解除确认] 前端已收到 madnessRecover: true,调查员从不定期疯狂中暂时压制了 #${t.id} ${t.name} 的症状。后续回合不再要求渗透症状,但可以在叙事上留有余响。`,
          },
        ]);
      }
    }
  };

  // 按需触发:玩家在调查笔记本中首次点击放大镜时,由 CluesNotebook 调用此函数
  // 发起画图请求。成功后通过 setClues 把 imageUrl 落到对应条目上。
  // 防御:无 prompt 的线索属于纯文字条目,守密人没下发画图请求,直接拒绝。
  const requestClueImage = async (clue: ClueItem): Promise<boolean> => {
    if (clue.imageUrl) return true;
    if (!clue.prompt) return false;

    const startedAt = Date.now();
    addLog({
      direction: "request",
      content: `POST /api/image/generate-clue → "${clue.title}"`,
      meta: {
        url: "/api/image/generate-clue",
        clueId: clue.id,
        type: clue.type,
        promptPreview: (clue.prompt || "").slice(0, 200),
      },
    });

    try {
      const resp = await fetch("/api/image/generate-clue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: clue.prompt,
          title: clue.title,
          type: clue.type,
          apiSettings,
        }),
      });

      if (resp.ok) {
        const body = await resp.json();
        ingestServerLogs(body?._serverLogs);
        const prefix = getImagePublicPrefix();
        if (
          body.success &&
          typeof body.imageUrl === "string" &&
          prefix &&
          body.imageUrl.startsWith(prefix)
        ) {
          addLog({
            direction: "response",
            content: `POST /api/image/generate-clue ← imageUrl ok`,
            meta: { durationMs: Date.now() - startedAt, imageUrl: body.imageUrl },
          });
          setClues((prev) =>
            prev.map((c) =>
              c.id === clue.id ? { ...c, imageUrl: body.imageUrl } : c,
            ),
          );
          return true;
        } else if (body.success) {
          addLog({
            direction: "error",
            content: `POST /api/image/generate-clue ← rejected non-whitelisted imageUrl`,
            meta: { durationMs: Date.now() - startedAt, imageUrl: String(body.imageUrl).slice(0, 200) },
          });
          console.warn(
            "[clue-image] rejected non-whitelisted imageUrl:",
            String(body.imageUrl).slice(0, 80),
          );
        } else {
          addLog({
            direction: "error",
            content: `POST /api/image/generate-clue ← success=false`,
            meta: { durationMs: Date.now() - startedAt, error: body?.error },
          });
        }
      } else {
        let bodyText = "";
        try {
          const json = await resp.clone().json();
          ingestServerLogs(json?._serverLogs);
          bodyText = JSON.stringify(json).slice(0, 400);
        } catch {
          try { bodyText = (await resp.text()).slice(0, 400); } catch {}
        }
        addLog({
          direction: "error",
          content: `POST /api/image/generate-clue ← HTTP ${resp.status}`,
          meta: { status: resp.status, durationMs: Date.now() - startedAt, body: bodyText },
        });
      }
    } catch (e: any) {
      addLog({
        direction: "error",
        content: `POST /api/image/generate-clue exception`,
        meta: { durationMs: Date.now() - startedAt, message: e?.message },
      });
      console.warn("Occult sketch generation failed:", e);
    }
    return false;
  };

  // 对话中即兴 sceneImage 的画图请求 — 玩家点"显示图像"时触发,
  // 与 requestClueImage 共享后端 /api/image/generate-clue,但回写到 messages[].sceneImage.imageUrl
  // 而非 clues。这样占位卡片"显示图像 → 缩略图"的状态切换由 messages 状态驱动。
  const requestSceneImage = async (messageId: string): Promise<boolean> => {
    const target = messages.find((m) => m.id === messageId);
    const scene = target?.sceneImage;
    if (!scene) return false;
    if (scene.imageUrl) return true;
    if (!scene.prompt) return false;
    if (generatingSceneImageMsgIds.has(messageId)) return false;

    setGeneratingSceneImageMsgIds((s) => {
      const next = new Set(s);
      next.add(messageId);
      return next;
    });

    const startedAt = Date.now();
    addLog({
      direction: "request",
      content: `POST /api/image/generate-clue (sceneImage) → "${scene.caption}"`,
      meta: {
        url: "/api/image/generate-clue",
        messageId,
        type: scene.type,
        promptPreview: (scene.prompt || "").slice(0, 200),
      },
    });

    try {
      const resp = await fetch("/api/image/generate-clue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: scene.prompt,
          title: scene.caption,
          type: scene.type,
          apiSettings,
        }),
      });

      if (resp.ok) {
        const body = await resp.json();
        ingestServerLogs(body?._serverLogs);
        const prefix = getImagePublicPrefix();
        if (
          body.success &&
          typeof body.imageUrl === "string" &&
          prefix &&
          body.imageUrl.startsWith(prefix)
        ) {
          addLog({
            direction: "response",
            content: `POST /api/image/generate-clue (sceneImage) ← imageUrl ok`,
            meta: { durationMs: Date.now() - startedAt, imageUrl: body.imageUrl },
          });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId && m.sceneImage
                ? { ...m, sceneImage: { ...m.sceneImage, imageUrl: body.imageUrl } }
                : m,
            ),
          );
          return true;
        } else if (body.success) {
          addLog({
            direction: "error",
            content: `POST /api/image/generate-clue (sceneImage) ← rejected non-whitelisted imageUrl`,
            meta: { durationMs: Date.now() - startedAt, imageUrl: String(body.imageUrl).slice(0, 200) },
          });
        } else {
          addLog({
            direction: "error",
            content: `POST /api/image/generate-clue (sceneImage) ← success=false`,
            meta: { durationMs: Date.now() - startedAt, error: body?.error },
          });
        }
      } else {
        let bodyText = "";
        try {
          const json = await resp.clone().json();
          ingestServerLogs(json?._serverLogs);
          bodyText = JSON.stringify(json).slice(0, 400);
        } catch {
          try { bodyText = (await resp.text()).slice(0, 400); } catch {}
        }
        addLog({
          direction: "error",
          content: `POST /api/image/generate-clue (sceneImage) ← HTTP ${resp.status}`,
          meta: { status: resp.status, durationMs: Date.now() - startedAt, body: bodyText },
        });
      }
    } catch (e: any) {
      addLog({
        direction: "error",
        content: `POST /api/image/generate-clue (sceneImage) exception`,
        meta: { durationMs: Date.now() - startedAt, message: e?.message },
      });
    } finally {
      setGeneratingSceneImageMsgIds((s) => {
        if (!s.has(messageId)) return s;
        const next = new Set(s);
        next.delete(messageId);
        return next;
      });
    }
    return false;
  };

  // 玩家在 sceneImage 全屏预览里点"收录线索"时:把 sceneImage 提升为正式的 ClueItem,
  // 复用 caption/type/imageUrl,并在 message.sceneImage 上记录 savedAsClueId 以禁用重复登记。
  const saveSceneImageAsClue = (messageId: string): string | null => {
    const target = messages.find((m) => m.id === messageId);
    const scene = target?.sceneImage;
    if (!scene) return null;
    if (scene.savedAsClueId) return scene.savedAsClueId;

    const clueId = `clue_${Date.now()}`;
    const discoveredAt =
      target?.location || currentLocation || "未知地点";
    const nextClue: ClueItem = {
      id: clueId,
      title: scene.caption.slice(0, 40) || "未命名图像",
      type: scene.type,
      description: scene.caption,
      prompt: scene.prompt,
      imageUrl: scene.imageUrl,
      discoveredAt,
      read: false,
    };
    setClues((p) => [...p, nextClue]);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.sceneImage
          ? { ...m, sceneImage: { ...m.sceneImage, savedAsClueId: clueId } }
          : m,
      ),
    );
    addLog({
      direction: "info",
      content: `sceneImage saved as clue → "${nextClue.title}"`,
      meta: { messageId, clueId, type: scene.type },
    });
    return clueId;
  };

  // Dice roll complete callback from specialized Roll Modal.
  // 投完即清空对应 keeper 消息上的 rollRequest 字段(方案A) — 这是 .docs/roll-cancellation.md
  // 第六节"成功投骰即清空 rollRequest 字段(消费证据)"的实现:与放弃判定的派生逻辑互补,
  // 让"投完后历史卡片不再显示 REQUIRES DESTINY ROLL"和"未投骰且不再队尾的卡片显示已错过"
  // 在派生层完全自洽。
  const handleRollComplete = (result: RollResult, messageReport: string) => {
    if (activeRoll) {
      lastRollContextRef.current = {
        skill: activeRoll.skillName,
        difficulty: activeRoll.difficulty,
        successType: result.successType,
      };
    }
    setActiveRoll(null);
    setMessages((prev) => {
      // 找到队尾那条带 rollRequest 的 keeper 消息(即玩家刚刚投的那条),清空其 rollRequest
      const tail = prev[prev.length - 1];
      if (
        tail &&
        tail.sender === "keeper" &&
        tail.parsedResponse?.rollRequest
      ) {
        const cleared: ChatMessage = {
          ...tail,
          parsedResponse: {
            ...tail.parsedResponse,
            rollRequest: null,
          },
        };
        return [...prev.slice(0, -1), cleared];
      }
      return prev;
    });
    handleSendPlayerMessage(messageReport, true);
  };

  // Keeper's automatic roll complete callback
  const handleKeeperRollComplete = (
    result: RollResult,
    messageReport: string,
  ) => {
    setActiveRoll(null);
    if (pendingKeeperResponse) {
      applyKeeperResponse(pendingKeeperResponse, messageReport);
      setPendingKeeperResponse(null);
    }
  };

  // Sanity check complete callback
  const handleSanityCheckComplete = (result: RollResult) => {
    const sanityReq = activeSanity!;
    setActiveSanity(null);
    setActiveRoll(null);

    const lossFormula =
      result.successType !== "failure" && result.successType !== "fumble"
        ? sanityReq.lossOnSuccess
        : sanityReq.lossOnFailure;

    const isSuccess = result.successType !== "failure" && result.successType !== "fumble";
    const evaluated = rollDiceFormula(lossFormula);

    // 静态公式（"0" / 纯数字）→ 没有悬念，沿用旧同步路径，不弹效果骰
    if (evaluated.isStatic) {
      applySanityLoss(result, lossFormula, evaluated, isSuccess);
      return;
    }

    // 动态公式（含 NdM）→ 弹 EffectRollModal，演完动画再统一应用
    setPendingEffectRoll({
      label: "理智损失",
      formula: lossFormula,
      result: evaluated,
      theme: "sanity",
      onResolve: (resolved) => {
        setPendingEffectRoll(null);
        applySanityLoss(result, lossFormula, resolved, isSuccess);
      },
    });
  };

  /**
   * 把 SAN 损失实际写入角色,跑规则 10 SAN 影响裁决,并回报 KP。
   * 静态/动态公式两条路径共用此出口。
   *
   * 流程:
   *   1. 应用 SAN 扣减 + 写 sanityState(triggerInsane/Indefinite 同步到 nextSanityState)
   *   2. 若 triggerInsane → 强制注入 scenarioEnd: insane,发回报后封盘,return
   *   3. 若 triggerIntCheck → 弹 INT 检定 modal,modal onResolve 时再发回报(把"通过/失败 → 进入 bout/平安"追加到 reportMsg)
   *   4. 若都不触发 → 直接发回报
   */
  const applySanityLoss = (
    checkResult: RollResult,
    lossFormula: string,
    evaluated: DiceFormulaResult,
    isSuccess: boolean,
  ) => {
    const rolledLoss = evaluated.total;
    const beforeChar = character!;
    const finalSan = Math.max(0, beforeChar.san - rolledLoss);
    setSanDiff(-rolledLoss);
    setTimeout(() => setSanDiff(0), 3000);

    const impact = computeSanityImpact(beforeChar, rolledLoss, finalSan);

    setCharacter({
      ...beforeChar,
      san: finalSan,
      sanityState: impact.nextSanityState,
    });

    let stateStr = "理智受到剧烈压迫，脑叶产生诡异轰鸣";
    if (rolledLoss === 0) {
      stateStr = "意志在绝望中维持了坚韧，未受到创伤";
    }

    const breakdown = evaluated.dice
      ? ` (公式 ${lossFormula}，骰点 [${evaluated.rolls.join(", ")}]${evaluated.constant ? ` ${evaluated.constant >= 0 ? "+" : ""}${evaluated.constant}` : ""}${evaluated.divisor > 1 ? ` ÷${evaluated.divisor}` : ""})`
      : ` (公式 ${lossFormula})`;

    const baseReport = `[系统的理智SAN值判定 - 意志: 投出 ${checkResult.total} / 目标 ${checkResult.targetValue} (${isSuccess ? "成功" : "失败"}) -> 扣减 SAN 值 ${rolledLoss} 点${breakdown}。当前理智值：${finalSan}/${beforeChar.maxSan}。\n异常行为状态：${stateStr}]`;

    finalizeSanityImpact(baseReport, beforeChar, impact);
  };

  /**
   * SAN 影响后效集中处理 — 给 applySanityLoss / 整数路径 sanChange / 公式路径 sanLoss 共用。
   * 根据 impact.trigger* 字段决定:封盘(insane)/ 注入 indefinite 提示 / 弹 INT modal / 直接回报。
   *
   * - mode = "report":有 baseReport 需要回报给 LLM(SAN 检定路径 + 公式 sanLossFormula 路径)
   * - mode = "inline":发生在 applyKeeperResponse 内部(整数 sanChange),不发回报,
   *   只把疯狂态变更追加成 system 消息进 messages,等玩家下一回合发声时被一并带给 LLM
   */
  const finalizeSanityImpact = (
    baseReport: string,
    beforeChar: CharacterSheet,
    impact: ReturnType<typeof computeSanityImpact>,
    mode: "report" | "inline" = "report",
  ) => {
    const dispatchReport = (text: string) => {
      if (mode === "report") {
        handleSendPlayerMessage(text, true);
      } else {
        // inline:仅追加进 messages,等下一轮 LLM 自然读到
        setMessages((prev) => [
          ...prev,
          {
            id: `sys_madness_inline_${Date.now()}`,
            sender: "system",
            timestamp: new Date().toLocaleTimeString(),
            text,
          },
        ]);
      }
    };

    // C 路径:SAN=0 → insane 终局
    if (impact.triggerInsane) {
      // patch 队尾 keeper 消息的 scenarioEnd: insane 并抹除其它字段
      setMessages((prev) => {
        const tail = prev[prev.length - 1];
        if (!tail || tail.sender !== "keeper" || !tail.parsedResponse) {
          return [
            ...prev,
            {
              id: `sys_insane_${Date.now()}`,
              sender: "system",
              timestamp: new Date().toLocaleTimeString(),
              text: `[终局闸] 调查员 SAN 归零,精神被吞噬,永久疯狂。本回合只能输出:narrative(精神崩塌的最后一幕,80-150 字) + scenarioEnd { kind: "insane", epilogue (150-300 字) }。其它字段全部 null。`,
            },
          ];
        }
        const patched: ChatMessage = {
          ...tail,
          parsedResponse: {
            ...tail.parsedResponse,
            scenarioEnd: { kind: "insane" },
            rollRequest: null,
            keeperRoll: null,
            sanityCheck: null,
            clue: null,
            sceneImage: null,
          },
        };
        return [...prev.slice(0, -1), patched];
      });
      const finalReport = `${baseReport}\n\n[终局闸] 上述 SAN 损失结算后调查员进入 insane 状态(SAN=0)。`;
      dispatchReport(finalReport);
      return;
    }

    // B 路径:不定期疯狂
    if (impact.triggerIndefinite) {
      const t = lookupMadness(impact.nextSanityState.boutRoll ?? 1);
      const finalReport = `${baseReport}\n\n[疯狂干涉·不定期疯狂触发] 本模组累计 SAN 损失已达到 ⌊当前 SAN / 5⌋ 阈值,调查员进入不定期疯狂(起源症状 #${t.id} ${t.name})。后续每一回合 narrative 都需渗透该症状,详见规则 10。`;
      dispatchReport(finalReport);
      return;
    }

    // A 路径:单次 SAN 损失 ≥ 5,弹 INT 检定 modal
    if (impact.triggerIntCheck) {
      const intValue = beforeChar.attributes.int;
      setPendingMadnessCheck({
        targetValue: intValue,
        onResolve: (passed) => {
          setPendingMadnessCheck(null);
          if (passed) {
            const boutRoll = 1 + Math.floor(Math.random() * 10);
            const temporaryTurns = 1 + Math.floor(Math.random() * 6);
            enterBoutFromIntCheck(boutRoll, temporaryTurns);
            const t = lookupMadness(boutRoll);
            const finalReport = `${baseReport}\n\n[疯狂干涉·急性发作触发] INT 检定通过(理解了不可名状),调查员进入急性发作(表项 #${t.id} ${t.name},持续 1 个玩家输入回合),之后转为临时疯狂(剩余 ${temporaryTurns} 个守密人回合)。同时 +1 克苏鲁神话技能,maxSanLimit 自动下调。`;
            dispatchReport(finalReport);
          } else {
            const finalReport = `${baseReport}\n\n[疯狂干涉·INT 检定失败] 调查员的心智在最后一刻封闭了,没能"理解"眼前的恐怖,反而保住了清醒。无后效。`;
            dispatchReport(finalReport);
          }
        },
      });
      return;
    }

    // 无任何疯狂态触发 → 直接回报(inline 模式无需做任何事)
    if (mode === "report") {
      handleSendPlayerMessage(baseReport, true);
    }
  };

  /**
   * 二阶段效果骰队列处理:把 KP 在同一回合下发的多个效果公式串行演投,
   * 静态公式同步结算,动态公式逐个弹 EffectRollModal,全部演完后汇总回报 KP。
   * 详见 .docs/two-stage-roll.md 第 6 / 7 节。
   */
  const runEffectRollQueue = (
    queue: PendingEffectItem[],
    resolved: PendingEffectItem[],
    /**
     * 终局闸基线 — applyKeeperResponse 调用时通过 beforeChar 把"应用 characterUpdates 之前
     * 的角色快照"传进来。runEffectRollQueue 在最终回报时,据此 + resolved damage 总值
     * 计算 finalHp,并按规则 9 决定 dying/dead。
     * 不传(handleSendPlayerMessage 直接调用等场景) → 不做终局闸触发。
     */
    terminalGateBaseline?: { beforeHp: number; maxHp: number; beforeSan: number; beforeChar: CharacterSheet },
  ) => {
    if (queue.length === 0) {
      if (resolved.length > 0) {
        // 终局闸:公式字段路径完成时检测总 damage 是否把 HP 打到 ≤ 0。
        let triggeredKind: "dying" | "dead" | null = null;
        if (terminalGateBaseline) {
          const totalDamage = resolved
            .filter((r) => r.kind === "damage")
            .reduce((s, r) => s + (r.evaluated.total || 0), 0);
          if (totalDamage > 0) {
            const finalHp = Math.max(0, terminalGateBaseline.beforeHp - totalDamage);
            if (finalHp <= 0 && terminalGateBaseline.beforeHp > 0) {
              triggeredKind = totalDamage >= terminalGateBaseline.maxHp ? "dead" : "dying";
            }
          }
        }

        let reportMsg = formatEffectQueueReport(resolved);
        if (triggeredKind) {
          // patch 队尾 keeper 消息的 parsedResponse.scenarioEnd 与抹除其它字段
          setMessages((prev) => {
            const tail = prev[prev.length - 1];
            if (!tail || tail.sender !== "keeper" || !tail.parsedResponse) return prev;
            const patched: ChatMessage = {
              ...tail,
              parsedResponse: {
                ...tail.parsedResponse,
                scenarioEnd: { kind: triggeredKind! },
                rollRequest: null,
                keeperRoll: null,
                sanityCheck: null,
                clue: null,
                sceneImage: null,
              },
            };
            return [...prev.slice(0, -1), patched];
          });
          reportMsg += `\n\n[终局闸] 上述伤害结算后调查员进入 ${triggeredKind} 状态。`;
          // 终局闸 dying/dead 优先级高于疯狂裁决,直接回报 return
          handleSendPlayerMessage(reportMsg, true);
          return;
        }

        // 规则 10 SAN 影响裁决:公式路径累计 sanLoss 总值,过 finalize 走 INT 检定 / indefinite / insane
        if (terminalGateBaseline) {
          const totalSanLoss = resolved
            .filter((r) => r.kind === "sanLoss")
            .reduce((s, r) => s + (r.evaluated.total || 0), 0);
          if (totalSanLoss > 0) {
            const beforeChar = terminalGateBaseline.beforeChar;
            const finalSan = Math.max(0, terminalGateBaseline.beforeSan - totalSanLoss);
            const impact = computeSanityImpact(beforeChar, totalSanLoss, finalSan);
            // 注意:applyEffectItem 已经把 SAN 写入 character,但 sanityState 还没改 —
            // 这里 patch sanityState 单独写入。
            setCharacter((prev) => prev ? {
              ...prev,
              sanityState: impact.nextSanityState,
            } : prev);
            finalizeSanityImpact(reportMsg, beforeChar, impact);
            return;
          }
        }

        handleSendPlayerMessage(reportMsg, true);
      }
      return;
    }

    const [head, ...rest] = queue;

    if (head.evaluated.isStatic) {
      applyEffectItem(head);
      runEffectRollQueue(rest, [...resolved, head], terminalGateBaseline);
      return;
    }

    setPendingEffectRoll({
      label: EFFECT_LABEL[head.kind],
      formula: head.formula,
      result: head.evaluated,
      theme: head.kind === "sanLoss" ? "sanity" : "default",
      onResolve: (resolvedDice) => {
        setPendingEffectRoll(null);
        const final = { ...head, evaluated: resolvedDice };
        applyEffectItem(final);
        runEffectRollQueue(rest, [...resolved, final], terminalGateBaseline);
      },
    });
  };

  /** 把单个效果骰结果写进角色并触发 diff 浮字。0 值跳过扣属性,但仍计入汇总报告。 */
  const applyEffectItem = (item: PendingEffectItem) => {
    const value = item.evaluated.total;
    if (value <= 0) return;

    setCharacter((prev) => {
      if (!prev) return prev;
      switch (item.kind) {
        case "damage":
          return { ...prev, hp: Math.max(0, prev.hp - value) };
        case "heal":
          return { ...prev, hp: Math.min(prev.maxHp, prev.hp + value) };
        case "mpCost":
          return { ...prev, mp: Math.max(0, prev.mp - value) };
        case "sanLoss":
          return { ...prev, san: Math.max(0, prev.san - value) };
      }
    });

    switch (item.kind) {
      case "damage":
        setHpDiff(-value);
        setTimeout(() => setHpDiff(0), 3000);
        return;
      case "heal":
        setHpDiff(value);
        setTimeout(() => setHpDiff(0), 3000);
        return;
      case "mpCost":
        setMpDiff(-value);
        setTimeout(() => setMpDiff(0), 3000);
        return;
      case "sanLoss":
        setSanDiff(-value);
        setTimeout(() => setSanDiff(0), 3000);
        return;
    }
  };

  /** 汇总效果骰队列结果为一条 system 消息,回报给 KP 让它在下回合 narrative 中接住。 */
  const formatEffectQueueReport = (items: PendingEffectItem[]): string => {
    const lines = items.map((it) => {
      const v = it.evaluated.total;
      const breakdown = it.evaluated.dice
        ? `公式 ${it.formula},骰点 [${it.evaluated.rolls.join(", ")}]${it.evaluated.constant ? ` ${it.evaluated.constant >= 0 ? "+" : ""}${it.evaluated.constant}` : ""}${it.evaluated.divisor > 1 ? ` ÷${it.evaluated.divisor}` : ""} = ${v}`
        : `公式 ${it.formula} = ${v}`;
      const verb = EFFECT_VERB[it.kind];
      return `- ${EFFECT_LABEL[it.kind]}:${breakdown},${verb} ${v} 点`;
    });
    return `[效果骰汇报]\n${lines.join("\n")}`;
  };


  useEffect(() => {
    if (
      appMode === "game" &&
      activeSaveId &&
      character &&
      messages.length > 0
    ) {
      saveGame({
        id: activeSaveId,
        moduleName: gameModuleName,
        timestamp: saveTimestamp,
        lastUpdated: Date.now(),
        messages,
        character,
        clues,
        enabledFeatures,
        currentLocation,
        gameMode,
        scenarioState: scenarioState ?? undefined,
      });
    }
  }, [
    appMode,
    activeSaveId,
    gameModuleName,
    saveTimestamp,
    character,
    messages,
    clues,
    enabledFeatures,
    currentLocation,
    gameMode,
    scenarioState,
  ]);

  useEffect(() => {
    sessionStorage.setItem("keeper_app_mode", appMode);
  }, [appMode]);

  useEffect(() => {
    if (activeSaveId) {
      sessionStorage.setItem("keeper_active_save_id", activeSaveId);
    } else {
      sessionStorage.removeItem("keeper_active_save_id");
    }
  }, [activeSaveId]);

  const markClueRead = (id: string) => {
    setClues((prev) =>
      prev.map((c) => (c.id === id && !c.read ? { ...c, read: true } : c)),
    );
  };

  const hasUnreadClue = clues.some((c) => !c.read);

  const handleDownloadSave = () => {
    if (appMode === "game" && activeSaveId && character) {
      const saveObj: WebGameSave = {
        id: activeSaveId,
        moduleName: gameModuleName,
        timestamp: saveTimestamp,
        lastUpdated: Date.now(),
        messages,
        character,
        clues,
        enabledFeatures,
        currentLocation,
      };
      downloadSaveAsJson(saveObj);
    }
  };

  const handleExitInvestigation = () => {
    setShowExitConfirm(true);
  };

  const confirmExitInvestigation = () => {
    setActiveSaveId(null);
    setCharacter(null);
    setMessages([]);
    setClues([]);
    setAppMode("start");
    setShowExitConfirm(false);
  };

  const handleLoadGame = (save: WebGameSave) => {
    setActiveSaveId(save.id);
    setSaveTimestamp(save.timestamp);
    setGameModuleName(save.moduleName);
    setCharacter(save.character);
    setMessages(save.messages);
    setClues(save.clues);
    setEnabledFeatures(save.enabledFeatures);
    setCurrentLocation(save.currentLocation || "未知禁区");
    setAppMode("game");
  };

  return (
    <div
      id="application-container"
      className="w-screen h-screen bg-[#0d0e10] flex select-none overflow-hidden text-gray-200"
    >
      {/* Background Flickering candle light effect */}
      <div
        className="absolute inset-0 bg-radial from-orange-950/5 to-transparent pointer-events-none z-0 mix-blend-color-dodge animate-pulse"
        style={{ animationDuration: "4s" }}
      />

      {appMode === "start" ? (
        <StartScreen
          onNewGame={() => setAppMode("creation")}
          onLoadGame={handleLoadGame}
          onOpenApiSettings={() => setShowApiSettings(true)}
          apiConfigured={isApiConfigured(apiSettings)}
        />
      ) : appMode === "creation" ? (
        <div
          id="setup-launcher-screen"
          className="w-full h-full flex flex-col items-center justify-start py-8 px-4 overflow-y-auto custom-scrollbar z-10"
        >
          <CharacterCreator
            onComplete={handleGameStart}
            onBackToStart={() => setAppMode("start")}
            apiSettings={apiSettings}
            onAddLog={addLog}
          />
        </div>
      ) : (
        /* Main Interactive Game Board View */
        <div
          id="game-board-layout"
          className="w-full h-full flex flex-col md:flex-row relative z-10 overflow-hidden"
        >
          {/* Active Overlay for SAN loss static CRT lines */}
          {sanDiff < 0 && (
            <div
              id="san-loss-screen-glitch"
              className="fixed inset-0 bg-purple-950/15 pointer-events-none z-50 animate-glitch"
            />
          )}

          {/* Left panel: Narrative feed / Chat body */}
          <div className="flex-1 height-full flex flex-col bg-[#0e1011] border-r border-[#c1a067]/15 relative overflow-hidden">
            {/* Header Status Bar (Project link + Quick Actions) */}
            <div className="h-14 bg-[#131516] border-b border-gray-950 px-4 flex items-center justify-between shadow-md">
              <a
                href="https://github.com/NyaaCaster/Keeper_CoC-TRPG"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[#10b981]/80 hover:text-[#10b981] transition-colors group"
                title="查看 GitHub 仓库"
              >
                <svg
                  className="w-5 h-5 shrink-0 group-hover:drop-shadow-[0_0_4px_rgba(16,185,129,0.6)] transition-[filter]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" fill="currentColor" />
                </svg>
                <span className="text-xs font-mono font-bold tracking-widest">
                  CoC·TRPG
                </span>
              </a>

              <div className="flex items-center gap-2">
                {/* Character Sidebar Toggle Shortcut */}
                <button
                  id="toggle-sheet-btn"
                  type="button"
                  onClick={() =>
                    setShowConfigPanel(
                      showConfigPanel === "sheet" ? null : "sheet",
                    )
                  }
                  className={`p-1 px-2 border rounded transition-all ${
                    showConfigPanel === "sheet"
                      ? "bg-[#c1a067]/20 border-[#c1a067] text-[#c1a067]"
                      : "bg-black/40 border-gray-800 text-gray-400 hover:text-gray-200"
                  }`}
                  title="调查员面板"
                  aria-label="调查员面板"
                >
                  <User className="w-3.5 h-3.5" />
                </button>

                {/* Clue Panel Toggle Shortcut */}
                <button
                  id="toggle-notebook-btn"
                  type="button"
                  onClick={() =>
                    setShowConfigPanel(
                      showConfigPanel === "notebook" ? null : "notebook",
                    )
                  }
                  className={`p-1 px-2 border rounded transition-all relative ${
                    showConfigPanel === "notebook"
                      ? "bg-[#c1a067]/20 border-[#c1a067] text-[#c1a067]"
                      : "bg-black/40 border-gray-800 text-gray-400 hover:text-gray-200"
                  }`}
                  title="线索册"
                  aria-label="线索册"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  {hasUnreadClue && (
                    <span
                      className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#10b981] animate-pulse"
                      title="有未阅读的线索"
                      aria-label="有未阅读的线索"
                    />
                  )}
                </button>

                {/* Unified Settings entry */}
                <button
                  id="settings-btn"
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className={`p-1 px-2 border rounded transition-all ${
                    showSettings
                      ? "bg-[#c1a067]/20 border-[#c1a067] text-[#c1a067]"
                      : "bg-black/40 border-gray-800 text-gray-400 hover:text-gray-200"
                  }`}
                  title="设置"
                  aria-label="设置"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Conversation Timeline Log */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5 custom-scrollbar bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-[#131517]/40 via-[#0e1011] to-[#0d0e10]">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.sender === "player" ? "justify-end" : m.sender === "system" ? "justify-center" : "justify-start"}`}
                >
                  {m.sender === "system" ? (
                    /* SYSTEM / ROLL EVENTS BANNER */
                    <div
                      id={`msg-${m.id}`}
                      className="w-full max-w-2xl bg-black/60 border border-gray-900 rounded p-3 text-xs text-gray-400 border-l-4 border-l-[#c1a067] font-mono leading-relaxed shadow-inner"
                    >
                      <MarkdownText text={m.text} />
                      {m.retryable && m.retryHistorySnapshot && m.retryFeatures && (
                        <div className="mt-2 pt-2 border-t border-gray-800 flex justify-end">
                          <button
                            type="button"
                            disabled={isKeeperLoading}
                            onClick={() =>
                              handleKeeperRetry(m.id, m.retryHistorySnapshot!, m.retryFeatures!)
                            }
                            className="px-3 py-1 text-[11px] font-mono text-coc-gold border border-coc-gold/40 rounded hover:bg-coc-gold/10 hover:border-coc-gold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            {isKeeperLoading ? "重连中…" : "↻ 重新生成"}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : m.sender === "player" ? (
                    /* PLAYER DIALOGUE */
                    <div
                      id={`msg-${m.id}`}
                      className="max-w-xl bg-[#c1a067]/10 border border-[#c1a067]/45 rounded-lg rounded-tr-none p-3.5 text-xs text-gray-100 font-sans shadow-lg leading-relaxed shadow-yellow-500/5"
                    >
                      <div className="font-semibold text-[#c1a067] mb-1 font-sans text-right">
                        调查员: {character?.name}
                      </div>
                      <div className="whitespace-pre-wrap font-sans">
                        {m.text}
                      </div>
                    </div>
                  ) : (
                    /* KEEPER / GM STORY NARRATIVE */
                    <div
                      id={`msg-${m.id}`}
                      className="w-full max-w-3xl bg-[#141617]/50 border border-[#c1a067]/10 rounded-lg p-5 shadow-2xl space-y-4"
                    >
                      {/* Avatar descriptor */}
                      <div className="border-b border-[#c1a067]/10 pb-2 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Dices className="w-4 h-4 text-[#c1a067]" />
                          <span className="text-xs font-bold text-[#c1a067] uppercase tracking-widest font-mono">
                            KEEPER 守密人
                          </span>
                          <span className="text-[10px] text-gray-650 font-mono">
                            {m.timestamp}
                          </span>
                          {m.model && (
                            <span
                              className="text-[10px] font-mono text-[#10b981] border border-[#10b981]/40 bg-[#10b981]/10 px-1.5 py-0.5 rounded tracking-wider truncate max-w-[14rem]"
                              title={`生成模型 · ${m.model}`}
                            >
                              {m.model}
                            </span>
                          )}
                        </div>

                        {(m.moduleName || m.location) && (
                          <div className="flex items-center gap-1.5 text-[11px] font-mono tracking-wider text-[#c1a067]/80">
                            <Compass className="w-3 h-3 text-[#c1a067]/70 shrink-0" />
                            <span className="truncate">
                              {m.moduleName ? `[${m.moduleName}] ` : ""}
                              {(m.location || "").toUpperCase()}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Main prose */}
                      <MarkdownText
                        text={m.text}
                        className="typewriter-text text-sm select-text leading-relaxed font-sans text-gray-300"
                      />

                      {/* NPC Specific Dialogue display */}
                      {m.parsedResponse?.npcDialogue && (
                        <div
                          id={`npc-dialogue-box-${m.id}`}
                          className="bg-[#c1a067]/5 border-l-2 border-l-[#c1a067] p-3 rounded text-xs"
                        >
                          <span className="font-bold text-[#c1a067] block mb-1">
                            【角色对话】{m.parsedResponse.npcDialogue.name}:
                          </span>
                          <span className="text-gray-300 italic font-sans font-medium">
                            " {m.parsedResponse.npcDialogue.text} "
                          </span>
                        </div>
                      )}

                      {/* 终局闸:dying 状态横幅 — 单回合垂死,告知玩家本回合只能输入纯叙事遗言。 */}
                      {m.parsedResponse?.scenarioEnd?.kind === "dying" && (
                        <div
                          id={`scenario-dying-box-${m.id}`}
                          className="border border-red-900/60 bg-red-950/30 p-4 rounded mt-2"
                        >
                          <div className="text-[10px] uppercase font-mono tracking-widest text-red-400 mb-1">
                            ✦ 垂死 / DYING ✦
                          </div>
                          <div className="text-xs text-red-200/90 font-sans leading-relaxed">
                            调查员的视野正在变窄。这是最后的窗口——可以留下遗言或一次徒劳的挣扎,
                            但已无法再声明任何技能。下一回合,守密人将裁决救起或死亡。
                          </div>
                        </div>
                      )}

                      {/* 终局闸:dead / insane / victory / ambiguous 状态尾声 — 渲染 epilogue,封盘。 */}
                      {(m.parsedResponse?.scenarioEnd?.kind === "dead" ||
                        m.parsedResponse?.scenarioEnd?.kind === "insane" ||
                        m.parsedResponse?.scenarioEnd?.kind === "victory" ||
                        m.parsedResponse?.scenarioEnd?.kind === "ambiguous") && (() => {
                        const endKind = m.parsedResponse!.scenarioEnd!.kind;
                        // 颜色与文案按 kind 分:坏结局 = 红;victory = 暖金;ambiguous = 灰蓝。
                        const theme =
                          endKind === "victory"
                            ? { border: "border-amber-700/70", glow: "shadow-amber-900/30", title: "text-amber-300", divider: "border-amber-900/40", footer: "text-amber-700/70" }
                            : endKind === "ambiguous"
                              ? { border: "border-slate-600/70", glow: "shadow-slate-900/40", title: "text-slate-300", divider: "border-slate-800/50", footer: "text-slate-500" }
                              : { border: "border-red-950/80", glow: "shadow-red-950/40", title: "text-red-500", divider: "border-red-950/40", footer: "text-gray-600" };
                        const headerLabel =
                          endKind === "insane"
                            ? "━━━ 调查员精神被吞噬 / MIND CONSUMED ━━━"
                            : endKind === "dead"
                              ? "━━━ 调查员档案 · 已封存 / CASE CLOSED ━━━"
                              : endKind === "victory"
                                ? "━━━ 调查员从恐怖中归来 / VICTORY ━━━"
                                : "━━━ 真相悬而未决 / AMBIGUOUS END ━━━";
                        const footerLabel =
                          endKind === "insane"
                            ? "她依然在呼吸,但已经不是她了。请新建调查员或加载其它存档。"
                            : endKind === "dead"
                              ? "幕已落下。请从档案库新建调查员或加载其它存档。"
                              : endKind === "victory"
                                ? "调查员活着回来了——但夜里依然不敢关灯。本次模组结束。"
                                : "故事走到了尽头,答案没有给完。本次模组结束。";
                        return (
                          <div
                            id={`scenario-${endKind}-box-${m.id}`}
                            className={`border ${theme.border} bg-black/70 p-5 rounded mt-2 shadow-inner ${theme.glow}`}
                          >
                            <div className={`text-[10px] uppercase tracking-widest ${theme.title} mb-2 text-center font-mono`}>
                              {headerLabel}
                            </div>
                            {m.parsedResponse!.scenarioEnd!.epilogue ? (
                              <MarkdownText
                                text={m.parsedResponse!.scenarioEnd!.epilogue!}
                                className="text-sm text-gray-300 italic leading-relaxed font-sans"
                              />
                            ) : (
                              <div className="text-xs text-gray-500 italic font-sans text-center">
                                (没有尾声留下来。)
                              </div>
                            )}
                            <div className={`mt-3 pt-3 border-t ${theme.divider} text-[10px] ${theme.footer} font-mono text-center`}>
                              {footerLabel}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Discovered item card visual directly within message */}
                      {m.parsedResponse?.clue && (
                        <div
                          id="clue-secured-card"
                          className="border border-dashed border-[#c1a067]/40 p-4 bg-black/50 rounded flex items-center justify-between gap-4 mt-2"
                        >
                          <div>
                            <span className="text-[10px] uppercase font-mono tracking-widest text-[#c1a067] block mb-1">
                              ★ 找到线索 / DISCOVERED EVIDENCE ★
                            </span>
                            <h4 className="text-sm font-black text-gray-100">
                              {m.parsedResponse.clue.title}
                            </h4>
                            <p className="text-xs text-gray-500 font-sans mt-0.5 max-w-md">
                              {m.parsedResponse.clue.description}
                            </p>
                          </div>
                          <div>
                            <button
                              id="view-clue-shortcut-btn"
                              type="button"
                              onClick={() => setShowConfigPanel("notebook")}
                              className="px-3 py-1.5 bg-black border border-[#c1a067]/30 hover:border-[#c1a067]/90 text-xs text-[#c1a067] rounded font-semibold transition"
                            >
                              翻阅调查本
                            </button>
                          </div>
                        </div>
                      )}

                      {/* In-chat sceneImage placeholder card — 显示图像 → 缩略图 → 全屏预览 → 收录线索 */}
                      {m.sceneImage && (
                        <div
                          id="scene-image-card"
                          className="border border-dashed border-[#10b981]/35 p-3 bg-black/45 rounded mt-2 flex flex-col gap-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <ImageIcon className="w-4 h-4 text-[#10b981] shrink-0" />
                              <span className="text-[10px] uppercase font-mono tracking-widest text-[#10b981]">
                                视觉勾子 / VISUAL ANCHOR
                              </span>
                            </div>
                            {m.sceneImage.savedAsClueId && (
                              <span className="text-[10px] font-mono text-[#10b981]/70 px-2 py-0.5 border border-[#10b981]/30 rounded">
                                已收录
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-300 italic font-sans">
                            " {m.sceneImage.caption} "
                          </p>

                          {m.sceneImage.imageUrl ? (
                            <button
                              type="button"
                              onClick={() =>
                                setScenePreview({ messageId: m.id })
                              }
                              className="relative group rounded overflow-hidden border border-[#10b981]/25 bg-black w-full max-h-[180px] flex items-center justify-center hover:border-[#10b981]/60 transition"
                            >
                              <img
                                src={m.sceneImage.imageUrl}
                                alt={m.sceneImage.caption}
                                referrerPolicy="no-referrer"
                                className="object-cover w-full max-h-[180px]"
                              />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                <ZoomIn className="w-7 h-7 text-white" />
                              </div>
                            </button>
                          ) : (
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[10px] font-mono text-gray-500">
                                图像尚未生成
                              </span>
                              <button
                                type="button"
                                disabled={generatingSceneImageMsgIds.has(m.id)}
                                onClick={() => {
                                  void requestSceneImage(m.id);
                                }}
                                className="px-3 py-1.5 bg-black border border-[#10b981]/35 hover:border-[#10b981]/90 text-xs text-[#10b981] rounded font-semibold transition flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-wait"
                              >
                                {generatingSceneImageMsgIds.has(m.id) ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    生成中…
                                  </>
                                ) : (
                                  <>
                                    <ZoomIn className="w-3.5 h-3.5" />
                                    显示图像
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Action trigger: Required Skill Roll Button.
                          失效判定:卡片不再是 messages 队尾即视为已放弃,详见 .docs/roll-cancellation.md */}
                      {m.parsedResponse?.rollRequest && (() => {
                        const isActive = isLatestKeeperRollRequest(m, messages);
                        return (
                        <div
                          id="roll-request-banner"
                          className={`bg-[#1c1a17] border p-4 rounded-lg flex items-center justify-between gap-4 mt-4 ${
                            isActive
                              ? "border-amber-950 animate-pulse"
                              : "border-gray-800 opacity-50 grayscale"
                          }`}
                        >
                          <div>
                            <div className={`text-[10px] uppercase font-mono tracking-widest ${
                              isActive ? "text-[#c1a067]" : "text-gray-500"
                            }`}>
                              {isActive ? "REQUIRES DESTINY ROLL" : "ROLL MISSED · 已错过"}
                            </div>
                            <div
                              id="roll-request-desc"
                              className="text-xs text-gray-300 font-sans mt-0.5"
                            >
                              请尝试通过进行一次{" "}
                              <span className={`font-semibold ${
                                isActive ? "text-[#c1a067]" : "text-gray-500"
                              }`}>
                                {m.parsedResponse.rollRequest.skillName}
                              </span>{" "}
                              判定。({m.parsedResponse.rollRequest.reason})
                            </div>
                          </div>
                          <button
                            id="roll-prompt-action-btn"
                            type="button"
                            disabled={!isActive || !!activeSanity}
                            onClick={() =>
                              setActiveRoll(m.parsedResponse!.rollRequest!)
                            }
                            title={isActive ? undefined : "本次声明已被新的对话打断,无法再投骰"}
                            className={`text-xs font-bold px-4 py-2 rounded-full flex items-center gap-1.5 font-sans transition-all disabled:cursor-not-allowed ${
                              isActive
                                ? "bg-gradient-to-r from-[#c1a067] to-[#dcb77c] text-black hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100"
                                : "bg-gray-800 text-gray-500 border border-gray-700"
                            }`}
                          >
                            <Dices className="w-4 h-4" />
                            {isActive
                              ? `投掷 D100 (${m.parsedResponse.rollRequest.targetValue}%)`
                              : "已错过"}
                          </button>
                        </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              ))}

              {isKeeperLoading && (
                <div
                  id="chat-keeper-typing-indicator"
                  className="flex justify-start"
                >
                  <div className="bg-[#141617]/50 border border-gray-900 rounded-lg p-4 max-w-md w-full flex items-center gap-3">
                    <img
                      src="https://picsum.photos/seed/creepy/100/100?blur=4"
                      alt="Typing..."
                      className="w-8 h-8 rounded-full border border-red-500/20 object-cover opacity-50 pointer-events-none"
                      referrerPolicy="no-referrer"
                    />
                    <div>
                      <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
                        守密人正在撰写现场低语 ...
                      </div>
                      <div className="flex gap-1.5 mt-2">
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-[#c1a067] animate-bounce"
                          style={{ animationDelay: "0ms" }}
                        />
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-[#c1a067] animate-bounce"
                          style={{ animationDelay: "150ms" }}
                        />
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-[#c1a067] animate-bounce"
                          style={{ animationDelay: "300ms" }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Bottom dialogue user prompt input console.
                玩家明骰挂起期间禁用输入与发送(详见 .docs/roll-cancellation.md 第四节);
                keeperRoll 不阻塞(暗骰阻塞会破暗骰、明骰动画很快无干预权);
                SAN 路径已由 activeSanity 兜底;
                终局闸 dead → 输入完全锁死;dying → 输入仍开放允许玩家发遗言。 */}
            <div className="p-4 bg-[#111314] border-t border-gray-950 z-10 flex gap-2">
              {(() => {
                const playerRollPending =
                  !!activeRoll &&
                  !activeRoll.isKeeperRoll &&
                  !activeRoll.skillName.includes("SAN");
                const scenarioStatus = deriveScenarioStatus(messages);
                const inputDisabled =
                  isKeeperLoading ||
                  !!activeSanity ||
                  playerRollPending ||
                  scenarioStatus === "dead" ||
                  scenarioStatus === "insane" ||
                  scenarioStatus === "victory" ||
                  scenarioStatus === "ambiguous";
                const sendDisabled = inputDisabled || !inputText.trim();
                return (
                  <>
              <input
                id="main-player-chat-input"
                type="text"
                disabled={inputDisabled}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSendPlayerMessage(inputText);
                  }
                }}
                placeholder={
                  isKeeperLoading
                    ? "守密人沉浸叙述中，请稍候..."
                    : scenarioStatus === "dead"
                      ? "【调查员档案已封存】幕已落下,故事到此为止..."
                      : scenarioStatus === "insane"
                        ? "【精神被吞噬】她依然在呼吸,但认不出镜中那张脸了..."
                        : scenarioStatus === "victory"
                          ? "【模组已通关】她从这场不可名状的恐怖中全身而退——但夜里依然不敢关灯..."
                          : scenarioStatus === "ambiguous"
                            ? "【模组终结】她合上笔记本,知道自己永远不会再回到那里..."
                            : scenarioStatus === "dying"
                              ? "【垂死之际】请输入您的遗言或最后挣扎(纯叙事,无法声明技能)..."
                              : activeSanity
                                ? "【理智冲击降临】请先完成理智检定，理智冲击不可回避..."
                                : playerRollPending
                                  ? "【判定挂起中】请投骰，或点 'X 我再想想' 退出查看面板/线索册"
                                  : "叙言你的侦查与侦测意图（如：我拿出魔术提灯、潜行走前去检查...）"
                }
                className="flex-1 bg-black/50 border border-gray-800 rounded px-4 py-2.5 text-sm placeholder-gray-650 focus:outline-[#c1a067]/40 focus:outline-1 focus:border-[#c1a067] text-gray-200 outline-none disabled:opacity-40"
              />
              <button
                id="main-player-send-btn"
                type="button"
                disabled={sendDisabled}
                onClick={() => handleSendPlayerMessage(inputText)}
                className="px-5 bg-black hover:bg-neutral-900 border border-gray-800 hover:border-[#c1a067] transition text-gray-300 font-semibold text-xs uppercase rounded flex items-center justify-center disabled:opacity-30"
                title="发送"
                aria-label="发送"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Right Floating collapsible configuration sub-panel (Sheet vs Notebook) */}
          <div
            className={`
            ${showConfigPanel === null ? "hidden md:flex" : "flex absolute top-14 bottom-0 left-0 right-0 z-40 md:static"}
            md:w-[350px] w-full border-[#c1a067]/15 md:border-l bg-[#121415] overflow-hidden flex-col md:h-full shrink-0
          `}
          >
            <AnimatePresence mode="wait">
              {showConfigPanel === "notebook" ? (
                <motion.div
                  key="notebook"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="w-full h-full"
                >
                  <CluesNotebook
                    clues={clues}
                    onMarkClueRead={markClueRead}
                    onRequestClueImage={requestClueImage}
                  />
                </motion.div>
              ) : (
                /* Defaults to active Character sheet dashboard */
                <motion.div
                  key="sheet"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="w-full h-full"
                >
                  <CharacterSheetPanel
                    sheet={character!}
                    hpDiff={hpDiff}
                    sanDiff={sanDiff}
                    mpDiff={mpDiff}
                    luckDiff={luckDiff}
                    onSkillIntentDraft={(skill, val) => {
                      if (isKeeperLoading) return;
                      // SAN 挂起期间，禁止"声明意图"的预填动作；查看属性/技能仍可。
                      if (activeSanity) return;
                      // 终局闸:任意终局 kind(dying/dead/insane/victory/ambiguous)下都不允许声明技能。
                      const status = deriveScenarioStatus(messages);
                      if (status !== null) return;
                      // 规则 10:bout 急性发作期不允许声明技能(玩家声明会被 LLM 接管曲解);
                      // temporary / indefinite 允许声明,但 LLM 会在下发 rollRequest 时自行加 penalty。
                      if (character?.sanityState?.madness === "bout") return;
                      const draft = `我想用【${skill}】(${val}%) 来`;
                      setInputText((prev) => (prev.trim() ? `${prev.trimEnd()} ${draft}` : draft));
                      requestAnimationFrame(() => {
                        const el = document.getElementById("main-player-chat-input") as HTMLInputElement | null;
                        if (el) {
                          el.focus();
                          const len = el.value.length;
                          try { el.setSelectionRange(len, len); } catch { /* ignore */ }
                        }
                      });
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Core dynamic modal trigger for dice animations */}
          <AnimatePresence>
            {activeRoll && (
              <RollDiceModal
                key="modal_dice_check"
                request={activeRoll}
                isSanityCheck={activeRoll.skillName.includes("SAN")}
                isKeeperRoll={activeRoll.isKeeperRoll}
                isSecret={activeRoll.isSecret}
                currentLuck={character?.attributes.luck ?? 0}
                onLuckSpend={(cost) => {
                  // [sys_test] 测试模式：燃运只演示动画 + 浮字，不真的扣 LUC，方便反复测试
                  if (activeRoll.testForce) {
                    setLuckDiff(-cost);
                    setTimeout(() => setLuckDiff(0), 3000);
                    return;
                  }
                  if (!character) return;
                  const nextLuck = Math.max(0, character.attributes.luck - cost);
                  setCharacter({
                    ...character,
                    attributes: { ...character.attributes, luck: nextLuck },
                  });
                  setLuckDiff(-cost);
                  setTimeout(() => setLuckDiff(0), 3000);
                }}
                sanityMeta={
                  activeSanity
                    ? { lossOnSuccess: activeSanity.lossOnSuccess, lossOnFailure: activeSanity.lossOnFailure }
                    : undefined
                }
                onComplete={(result, outcomeMessage) => {
                  // [sys_test] 测试模式：跳过所有游戏副作用（不扣属性、不回报 KP、不入消息流），
                  // 但 SAN 检定仍然演示二阶段效果骰浮窗，让用户看清动画。
                  if (activeRoll.testForce) {
                    const isSanTest = activeRoll.skillName.includes("SAN") && activeSanity;
                    if (isSanTest) {
                      const isSuccess = result.successType !== "failure" && result.successType !== "fumble";
                      const lossFormula = isSuccess ? activeSanity!.lossOnSuccess : activeSanity!.lossOnFailure;
                      const evaluated = rollDiceFormula(lossFormula);
                      setActiveRoll(null);
                      setActiveSanity(null);
                      if (evaluated.isStatic) {
                        // 没有悬念，扣浮字看一下就行
                        if (evaluated.total > 0) {
                          setSanDiff(-evaluated.total);
                          setTimeout(() => setSanDiff(0), 3000);
                        }
                        return;
                      }
                      setPendingEffectRoll({
                        label: "理智损失 [测试]",
                        formula: lossFormula,
                        result: evaluated,
                        theme: "sanity",
                        onResolve: (resolved) => {
                          setPendingEffectRoll(null);
                          // 测试模式：演示浮字但不真扣 SAN
                          setSanDiff(-resolved.total);
                          setTimeout(() => setSanDiff(0), 3000);
                        },
                      });
                      return;
                    }
                    // 全链路 sentinel:判定 modal 关掉后自动接效果骰浮窗(测试模式不真扣属性)
                    const chain = activeRoll.testForce.chainEffect;
                    setActiveRoll(null);
                    setActiveSanity(null);
                    if (chain) {
                      runEffectRollTest(chain.kind, chain.formula);
                    }
                    return;
                  }
                  if (activeRoll.isKeeperRoll) {
                    handleKeeperRollComplete(result, outcomeMessage);
                  } else if (activeRoll.skillName.includes("SAN")) {
                    handleSanityCheckComplete(result);
                  } else {
                    handleRollComplete(result, outcomeMessage);
                  }
                }}
                onCancel={
                  activeRoll.testForce
                    ? () => { setActiveRoll(null); setActiveSanity(null); }
                    : activeRoll.skillName.includes("SAN")
                      ? undefined
                      : () => setActiveRoll(null)
                }
              />
            )}

            {pendingEffectRoll && (
              <EffectRollModal
                key="modal_effect_roll"
                label={pendingEffectRoll.label}
                formulaDisplay={pendingEffectRoll.formula}
                result={pendingEffectRoll.result}
                theme={pendingEffectRoll.theme}
                onResolve={pendingEffectRoll.onResolve}
              />
            )}

            {/* 规则 10:INT 检定 modal — SAN 单次扣 ≥ 5 时触发,通过 = 进急性发作。 */}
            {pendingMadnessCheck && (
              <MadnessIntCheckModal
                key="modal_madness_int_check"
                targetValue={pendingMadnessCheck.targetValue}
                sanLoss={Math.abs(sanDiff) || 5}
                onResolve={(passed) => pendingMadnessCheck.onResolve(passed)}
              />
            )}

            {scenePreview && (() => {
              const previewMsg = messages.find(
                (m) => m.id === scenePreview.messageId,
              );
              const scene = previewMsg?.sceneImage;
              if (!scene?.imageUrl) {
                return null;
              }
              return (
                <ImageViewer
                  key="scene_image_viewer"
                  imageUrl={scene.imageUrl}
                  title={scene.caption}
                  onClose={() => setScenePreview(null)}
                  onSaveAsClue={() => saveSceneImageAsClue(scenePreview.messageId)}
                  alreadySavedAsClue={!!scene.savedAsClueId}
                />
              );
            })()}

            {showExitConfirm && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans"
              >
                <motion.div
                  initial={{ scale: 0.95 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0.95 }}
                  className="bg-[#181a1c] border border-gray-800 rounded-lg p-6 max-w-sm w-full shadow-2xl relative"
                >
                  <h3 className="text-xl font-bold text-red-500 mb-2 font-mono">
                    退出调查
                  </h3>
                  <p className="text-gray-300 text-sm mb-6">
                    确定要退出当前的调查吗？进度已自动保留在你的记录中。
                  </p>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setShowExitConfirm(false)}
                      className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition-colors"
                    >
                      取消 (Cancel)
                    </button>
                    <button
                      onClick={confirmExitInvestigation}
                      className="px-4 py-2 bg-red-900/80 hover:bg-red-700 border border-red-800 text-white font-bold text-sm rounded transition-colors"
                    >
                      确认退出
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <ApiSettingsPanel
        isOpen={showApiSettings}
        onClose={() => setShowApiSettings(false)}
        onSaved={(s) => setApiSettings(s)}
        initial={apiSettings}
      />

      <ConsoleLogPanel
        isOpen={showConsoleLog}
        onClose={() => setShowConsoleLog(false)}
        logs={logs}
        onClearLogs={() => setLogs([])}
      />

      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onOpenApiSettings={() => setShowApiSettings(true)}
        onDownloadSave={handleDownloadSave}
        onExitInvestigation={handleExitInvestigation}
        onOpenConsoleLog={() => setShowConsoleLog(true)}
        canDownload={appMode === "game" && !!activeSaveId && !!character}
        canExit={appMode === "game"}
      />
    </div>
  );
}
