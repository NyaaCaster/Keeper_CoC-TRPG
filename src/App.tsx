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
import CharacterSheetPanel from "./components/CharacterSheetPanel";
import CluesNotebook from "./components/CluesNotebook";
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
import SettingsPanel from "./components/SettingsPanel";
import { WebGameSave, ApiSettings } from "./types";
import { getImagePublicPrefix } from "./lib/publicConfig";

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

  // Variable values changes animations trackers
  const [hpDiff, setHpDiff] = useState<number>(0);
  const [sanDiff, setSanDiff] = useState<number>(0);
  const [mpDiff, setMpDiff] = useState<number>(0);

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

    const playerMsg: ChatMessage = {
      id: `player_${Date.now()}`,
      sender: isSystemReport ? "system" : "player",
      timestamp: new Date().toLocaleTimeString(),
      text: textToSend,
    };

    const updated = [...messages, playerMsg];
    setMessages(updated);
    setInputText("");

    // Trigger Keeper Call
    triggerKeeperNarration(updated, character!, enabledFeatures);
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
      let finalHp = character!.hp;
      let finalMp = character!.mp;
      let finalSan = character!.san;
      let finalMythos = character!.mythos;
      let finalMaxSanLimit = character!.maxSanLimit;

      if (updates.hpChange) {
        finalHp = Math.max(
          0,
          Math.min(character!.maxHp, character!.hp + updates.hpChange),
        );
        setHpDiff(updates.hpChange);
        setTimeout(() => setHpDiff(0), 3000);
      }

      if (updates.mpChange) {
        finalMp = Math.max(
          0,
          Math.min(character!.maxMp, character!.mp + updates.mpChange),
        );
        setMpDiff(updates.mpChange);
        setTimeout(() => setMpDiff(0), 3000);
      }

      if (updates.sanChange) {
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

    // Handle custom discovered CLUES items visually and add to local Notebook
    if (keeperData.clue) {
      const cluePayload = keeperData.clue;

      // Request Imagen image for the clue in background
      const nextClueItem: ClueItem = {
        id: `clue_${Date.now()}`,
        title: cluePayload.title,
        type: cluePayload.type,
        description: cluePayload.description,
        prompt: cluePayload.prompt,
        discoveredAt: keeperData.gameState?.currentLocation || currentLocation,
        read: false,
      };

      // Try to generate clue photo with imagen asynchronously to avoid blocking chat narrative flow!
      triggerClueImageGeneration(nextClueItem);
    }
  };

  // Asynchronous wrapper for generating clue photography visual cards
  const triggerClueImageGeneration = async (clue: ClueItem) => {
    // Temporarily add with no image to list
    setClues((p) => [...p, clue]);

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
      console.warn(
        "Occult sketch generation failed asynchronously, clue stays as procedural card:",
        e,
      );
    }
  };

  // Dice roll complete callback from specialized Roll Modal
  const handleRollComplete = (result: RollResult, messageReport: string) => {
    setActiveRoll(null);
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

    let lossFormula =
      result.successType !== "failure" && result.successType !== "fumble"
        ? sanityReq.lossOnSuccess
        : sanityReq.lossOnFailure;

    // Roll loss points
    const rolledLoss = parseAndRollDice(lossFormula);

    const nextSan = Math.max(0, character!.san - rolledLoss);
    setSanDiff(-rolledLoss);
    setTimeout(() => setSanDiff(0), 3000);

    const updatedChar = {
      ...character!,
      san: nextSan,
    };
    setCharacter(updatedChar);

    // Build the report text
    let stateStr = "理智受到剧烈压迫，脑叶产生诡异轰鸣";
    if (rolledLoss === 0) {
      stateStr = "意志在绝望中维持了坚韧，未受到创伤";
    } else if (rolledLoss >= 5) {
      stateStr =
        "【临时性精神失常 (Temporary Insanity)】：你目睹了超出三维常识之物，大脑防御崩溃！陷入了短暂的狂乱幻想、歇斯底里！";
    }

    const reportMsg = `[系统的理智SAN值判定 - 意志: 投出 ${result.total} / 目标 ${result.targetValue} (${result.successType === "failure" || result.successType === "fumble" ? "失败" : "成功"}) -> 扣减 SAN 值 ${rolledLoss} 点 (公式 ${lossFormula})。当前理智值：${nextSan}/${character!.maxSanLimit}。\n异常行为状态：${stateStr}]`;

    handleSendPlayerMessage(reportMsg, true);
  };

  const parseAndRollDice = (formula: string): number => {
    const f = formula.trim().toLowerCase();
    if (!f || f === "0") return 0;
    if (/^\d+$/.test(f)) return parseInt(f);

    const match = f.match(/^(\d+)d(\d+)$/);
    if (match) {
      const num = parseInt(match[1]);
      const sides = parseInt(match[2]);
      let sum = 0;
      for (let i = 0; i < num; i++) {
        sum += Math.floor(Math.random() * sides) + 1;
      }
      return sum;
    }
    return 1;
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

                      {/* Action trigger: Required Skill Roll Button */}
                      {m.parsedResponse?.rollRequest && (
                        <div
                          id="roll-request-banner"
                          className="bg-[#1c1a17] border border-amber-950 p-4 rounded-lg flex items-center justify-between gap-4 mt-4 animate-pulse"
                        >
                          <div>
                            <div className="text-[10px] uppercase text-[#c1a067] font-mono tracking-widest">
                              REQUIRES DESTINY ROLL
                            </div>
                            <div
                              id="roll-request-desc"
                              className="text-xs text-gray-300 font-sans mt-0.5"
                            >
                              请尝试通过进行一次{" "}
                              <span className="font-semibold text-[#c1a067]">
                                {m.parsedResponse.rollRequest.skillName}
                              </span>{" "}
                              判定。({m.parsedResponse.rollRequest.reason})
                            </div>
                          </div>
                          <button
                            id="roll-prompt-action-btn"
                            type="button"
                            disabled={!!activeSanity}
                            onClick={() =>
                              setActiveRoll(m.parsedResponse!.rollRequest!)
                            }
                            className="bg-gradient-to-r from-[#c1a067] to-[#dcb77c] text-black hover:scale-105 active:scale-95 transition-all text-xs font-bold px-4 py-2 rounded-full flex items-center gap-1.5 font-sans disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100"
                          >
                            <Dices className="w-4 h-4" /> 投掷 D100 (
                            {m.parsedResponse.rollRequest.targetValue}%)
                          </button>
                        </div>
                      )}
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

            {/* Bottom dialogue user prompt input console */}
            <div className="p-4 bg-[#111314] border-t border-gray-950 z-10 flex gap-2">
              <input
                id="main-player-chat-input"
                type="text"
                disabled={isKeeperLoading || !!activeSanity}
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
                      : activeRoll
                        ? "【强制检定状态】：请在上面点击掷骰子投点，以继续生成故事"
                        : "叙言你的侦查与侦测意图（如：我拿出魔术提灯、潜行走前去检查...）"
                }
                className="flex-1 bg-black/50 border border-gray-800 rounded px-4 py-2.5 text-sm placeholder-gray-650 focus:outline-[#c1a067]/40 focus:outline-1 focus:border-[#c1a067] text-gray-200 outline-none disabled:opacity-40"
              />
              <button
                id="main-player-send-btn"
                type="button"
                disabled={isKeeperLoading || !!activeSanity || !inputText.trim()}
                onClick={() => handleSendPlayerMessage(inputText)}
                className="px-5 bg-black hover:bg-neutral-900 border border-gray-800 hover:border-[#c1a067] transition text-gray-300 font-semibold text-xs uppercase rounded flex items-center justify-center disabled:opacity-30"
                title="发送"
                aria-label="发送"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
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
                  <CluesNotebook clues={clues} onMarkClueRead={markClueRead} />
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
                sanityMeta={
                  activeSanity
                    ? { lossOnSuccess: activeSanity.lossOnSuccess, lossOnFailure: activeSanity.lossOnFailure }
                    : undefined
                }
                onComplete={(result, outcomeMessage) => {
                  if (activeRoll.isKeeperRoll) {
                    handleKeeperRollComplete(result, outcomeMessage);
                  } else if (activeRoll.skillName.includes("SAN")) {
                    handleSanityCheckComplete(result);
                  } else {
                    handleRollComplete(result, outcomeMessage);
                  }
                }}
                onCancel={
                  activeRoll.skillName.includes("SAN")
                    ? undefined
                    : () => setActiveRoll(null)
                }
              />
            )}

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
