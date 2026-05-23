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
} from "./types";
import CharacterCreator from "./components/CharacterCreator";
import RollDiceModal from "./components/RollDiceModal";
import EffectRollModal from "./components/EffectRollModal";
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
import SettingsPanel from "./components/SettingsPanel";
import { WebGameSave, ApiSettings } from "./types";
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
  ) => {
    setCharacter(chosenChar);
    setEnabledFeatures(features);
    setAppMode("game");
    setCurrentLocation("游戏准备舱 (调查室)");

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
      text: `已成功创建调查员档案：\n- **姓名** ↬ ${chosenChar.name}\n- **职业** ↬ ${chosenChar.occupation}\n- **生命(HP)** ↬ ${chosenChar.hp}/${chosenChar.maxHp} | **理智(SAN)** ↬ ${chosenChar.san}/${chosenChar.maxSanLimit} | **幸运** ↬ ${chosenChar.attributes.luck}%\n- **内容模块** ↬ ${activeMods.join(", ")}\n\n联结世界已加载。正在为您秘密连接守密人(Keeper)...`,
    };

    setMessages([initialSystemMsg]);
    triggerKeeperNarration([initialSystemMsg], chosenChar, features);
  };

  // Perform auto save
  const doSaveGame = (st: {
    messages: ChatMessage[];
    clues: ClueItem[];
    char: CharacterSheet;
    loc: string;
    tS: string;
    sId: string;
    mName: string;
  }) => {
    if (!st.sId) return;
    const saveObj: WebGameSave = {
      id: st.sId,
      moduleName: st.mName,
      timestamp: st.tS,
      lastUpdated: Date.now(),
      messages: st.messages,
      character: st.char,
      clues: st.clues,
      enabledFeatures,
      currentLocation: st.loc,
    };
    saveGame(saveObj);
  };

  // Send player speech or automated roll outcome back to keeper
  const handleSendPlayerMessage = async (
    textToSend: string,
    isSystemReport: boolean = false,
  ) => {
    if (!textToSend.trim() || isKeeperLoading) return;
    // CoC 7e 严格合规：SAN 检定挂起期间，玩家不可推进剧情。系统回报例外（SAN 检定结束后会以 system 身份发回）。
    if (activeSanity && !isSystemReport) return;

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

    const updated = [...messages, ...cancellationMsgs, playerMsg];
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
  ) => {
    setIsKeeperLoading(true);

    const startedAt = Date.now();
    addLog({
      direction: "request",
      content: `POST /api/keeper/chat → ${apiSettings.llm.provider} ${apiSettings.llm.model || "(default)"}`,
      meta: {
        url: "/api/keeper/chat",
        msgCount: currentHistory.length,
        features: {
          typemoon: featuresToUse?.typemoon !== false,
          scp: featuresToUse?.scp !== false,
        },
      },
    });

    try {
      const response = await fetch("/api/keeper/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: currentHistory,
          features: {
            typemoon: featuresToUse?.typemoon !== false,
            scp: featuresToUse?.scp !== false,
          },
          apiSettings,
        }),
      });

      if (!response.ok) {
        let bodyText = "";
        try { bodyText = await response.text(); } catch {}
        addLog({
          direction: "error",
          content: `POST /api/keeper/chat ← HTTP ${response.status}`,
          meta: { status: response.status, durationMs: Date.now() - startedAt, body: bodyText.slice(0, 400) },
        });
        throw new Error("与守密人虚无连接断开，请检查网络或刷新");
      }

      const raw = await response.json();
      ingestServerLogs(raw?._serverLogs);
      if (!raw.success || !raw.data) {
        addLog({
          direction: "error",
          content: `POST /api/keeper/chat ← invalid payload`,
          meta: { durationMs: Date.now() - startedAt, error: raw?.error },
        });
        throw new Error(raw.error || "守密人低语失败，返回格式有误");
      }

      const keeperData: KeeperResponse = raw.data;
      addLog({
        direction: "response",
        content: `POST /api/keeper/chat ← narrative ${(keeperData.narrative || "").length} chars`,
        meta: {
          durationMs: Date.now() - startedAt,
          hasRollRequest: !!keeperData.rollRequest,
          hasKeeperRoll: !!keeperData.keeperRoll,
          hasSanityCheck: !!keeperData.sanityCheck,
          hasClue: !!keeperData.clue,
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
      addLog({
        direction: "error",
        content: `POST /api/keeper/chat exception`,
        meta: { durationMs: Date.now() - startedAt, message: error?.message },
      });
      const errCard: ChatMessage = {
        id: `err_${Date.now()}`,
        sender: "system",
        timestamp: new Date().toLocaleTimeString(),
        text: `【异常低语阻断】⚠️ ${error.message || "连接终点异常失效，请检查您的 API 配置。"}`,
      };
      setMessages((prev) => [...prev, errCard]);
    } finally {
      setIsKeeperLoading(false);
    }
  };

  const applyKeeperResponse = (
    keeperData: KeeperResponse,
    keeperRollReport?: string,
  ) => {
    // Check for GameState updates
    if (keeperData.gameState) {
      if (keeperData.gameState.moduleName) {
        setGameModuleName(keeperData.gameState.moduleName);
      }
      setCurrentLocation(keeperData.gameState.currentLocation || "未知禁区");
    }

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
      let finalMaxSanLimit = character!.maxSanLimit;

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
        finalSan = Math.max(
          0,
          Math.min(character!.maxSanLimit, character!.san + updates.sanChange),
        );
        setSanDiff(updates.sanChange);
        setTimeout(() => setSanDiff(0), 3000);
      }

      if (updates.sanitySkillGain) {
        finalMythos = character!.mythos + updates.sanitySkillGain;
        finalMaxSanLimit = Math.max(0, 99 - finalMythos);
        finalSan = Math.min(finalSan, finalMaxSanLimit);
      }

      const nextCharState = {
        ...character!,
        hp: finalHp,
        mp: finalMp,
        san: finalSan,
        mythos: finalMythos,
        maxSanLimit: finalMaxSanLimit,
      };

      setCharacter(nextCharState);

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
        runEffectRollQueue(formulaQueue, []);
      }
    }

    const newMsgs: ChatMessage[] = [];

    // Prior narrative roll report (Keeper action text) if provided
    if (keeperRollReport) {
      newMsgs.push({
        id: `sys_keeper_roll_${Date.now()}`,
        sender: "system",
        timestamp: new Date().toLocaleTimeString(),
        text: keeperRollReport,
      });
    }

    // Create main message card with KeeperResponse
    const snapshotModuleName =
      keeperData.gameState?.moduleName || gameModuleName;
    const snapshotLocation =
      keeperData.gameState?.currentLocation || currentLocation;
    newMsgs.push({
      id: `keeper_${Date.now()}`,
      sender: "keeper",
      timestamp: new Date().toLocaleTimeString(),
      text: keeperData.narrative,
      parsedResponse: keeperData,
      model: apiSettings.llm.model || apiSettings.llm.provider,
      moduleName: snapshotModuleName,
      location: snapshotLocation,
      sceneImage: keeperData.sceneImage
        ? {
            caption: keeperData.sceneImage.caption,
            type: keeperData.sceneImage.type,
            prompt: keeperData.sceneImage.prompt,
          }
        : undefined,
    });

    setMessages((prev) => [...prev, ...newMsgs]);

    // Handle roll triggers or Sanity check triggers in response
    // ALWAYS clear active roll state so player can click to trigger manually
    setActiveRoll(null);

    if (keeperData.sanityCheck) {
      // CoC 7e 严格合规：SAN 冲击是不可回避的——直接弹 modal，不走聊天卡片按钮。
      setActiveSanity(keeperData.sanityCheck);
      setActiveRoll({
        skillName: "理智意志 (SAN)",
        targetValue: character!.san,
        difficulty: "regular",
        reason: keeperData.sanityCheck.reason,
      });
    } else {
      setActiveSanity(null);
    }

    // Handle custom discovered CLUES items visually and add to local Notebook.
    // 注意:这里只把线索登记进档案,**不主动**请求画图;真正的画图调用延迟到玩家
    // 在调查笔记本中首次点击放大镜时按需触发(见 requestClueImage)。
    if (keeperData.clue) {
      const cluePayload = keeperData.clue;
      const nextClueItem: ClueItem = {
        id: `clue_${Date.now()}`,
        title: cluePayload.title,
        type: cluePayload.type,
        description: cluePayload.description,
        prompt: cluePayload.prompt,
        discoveredAt: keeperData.gameState?.currentLocation || currentLocation,
        read: false,
      };
      setClues((p) => [...p, nextClueItem]);
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

  /** 把 SAN 损失实际写入角色并回报 KP — 抽出来给"静态/动态公式"两条路径共用。 */
  const applySanityLoss = (
    checkResult: RollResult,
    lossFormula: string,
    evaluated: DiceFormulaResult,
    isSuccess: boolean,
  ) => {
    const rolledLoss = evaluated.total;
    const nextSan = Math.max(0, character!.san - rolledLoss);
    setSanDiff(-rolledLoss);
    setTimeout(() => setSanDiff(0), 3000);

    setCharacter({
      ...character!,
      san: nextSan,
    });

    let stateStr = "理智受到剧烈压迫，脑叶产生诡异轰鸣";
    if (rolledLoss === 0) {
      stateStr = "意志在绝望中维持了坚韧，未受到创伤";
    } else if (rolledLoss >= 5) {
      stateStr =
        "【临时性精神失常 (Temporary Insanity)】：你目睹了超出三维常识之物，大脑防御崩溃！陷入了短暂的狂乱幻想、歇斯底里！";
    }

    const breakdown = evaluated.dice
      ? ` (公式 ${lossFormula}，骰点 [${evaluated.rolls.join(", ")}]${evaluated.constant ? ` ${evaluated.constant >= 0 ? "+" : ""}${evaluated.constant}` : ""}${evaluated.divisor > 1 ? ` ÷${evaluated.divisor}` : ""})`
      : ` (公式 ${lossFormula})`;

    const reportMsg = `[系统的理智SAN值判定 - 意志: 投出 ${checkResult.total} / 目标 ${checkResult.targetValue} (${isSuccess ? "成功" : "失败"}) -> 扣减 SAN 值 ${rolledLoss} 点${breakdown}。当前理智值：${nextSan}/${character!.maxSanLimit}。\n异常行为状态：${stateStr}]`;

    handleSendPlayerMessage(reportMsg, true);
  };

  /**
   * 二阶段效果骰队列处理:把 KP 在同一回合下发的多个效果公式串行演投,
   * 静态公式同步结算,动态公式逐个弹 EffectRollModal,全部演完后汇总回报 KP。
   * 详见 .docs/two-stage-roll.md 第 6 / 7 节。
   */
  const runEffectRollQueue = (
    queue: PendingEffectItem[],
    resolved: PendingEffectItem[],
  ) => {
    if (queue.length === 0) {
      if (resolved.length > 0) {
        const reportMsg = formatEffectQueueReport(resolved);
        handleSendPlayerMessage(reportMsg, true);
      }
      return;
    }

    const [head, ...rest] = queue;

    if (head.evaluated.isStatic) {
      applyEffectItem(head);
      runEffectRollQueue(rest, [...resolved, head]);
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
        runEffectRollQueue(rest, [...resolved, final]);
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
                SAN 路径已由 activeSanity 兜底。 */}
            <div className="p-4 bg-[#111314] border-t border-gray-950 z-10 flex gap-2">
              {(() => {
                const playerRollPending =
                  !!activeRoll &&
                  !activeRoll.isKeeperRoll &&
                  !activeRoll.skillName.includes("SAN");
                const inputDisabled =
                  isKeeperLoading || !!activeSanity || playerRollPending;
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
