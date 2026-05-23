/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import { CharacterSheet, CharacterAttributes, CharacterSkills, ApiSettings, LogEntry, MythicEncounters, InventoryEntry } from "../types";
import { TEMPLATE_PRESETS } from "../data/presets";
import { getOccupations, findOccupation } from "../data/cocOccupations";
import { dodgeOf, motherTongueValue, startingCashOf, livingStandardOf, livingStandardLabel, refreshCombatDerived } from "../lib/cocRules";
import { getWeaponList, findWeapon, describeWeapon } from "../data/cocWeapons";
import {
  SkillSheetDraft,
  SlotConstraint,
  SlotState,
  SkillSelection,
  computePointPools,
  spentInSlots,
  expandOccupationSlots,
  customOccupationConstraints,
  emptyDraft,
  draftToSkills,
  distributeSkillsToDraft,
  findDuplicateSelections,
  getSlotCandidates,
  selectionKey,
  baseOfSelection,
  nameOfSelection,
  finalValueOfSlot,
  describeConstraint,
  INTEREST_SLOT_COUNT,
} from "../lib/cocSkillSlots";
import { randomizeSkillDraft, legalizeDraft } from "../lib/cocSkillRandomizer";
import { validateCharacterSheet } from "../lib/characterValidation";
import { downloadCharacterCard } from "../lib/characterCardRender";
import { AnimatePresence, motion } from "motion/react";
import {
  Sparkles,
  HelpCircle,
  Shield,
  FileText,
  Check,
  BookOpen,
  User,
  RotateCcw,
  ArrowLeft,
  Heart,
  Zap,
  Eye,
  Activity,
  Compass,
  AlertCircle,
  Upload,
  X,
  FileUp,
  Download,
  Home
} from "lucide-react";

interface CharacterCreatorProps {
  onComplete: (character: CharacterSheet, features: { typemoon: boolean; scp: boolean }) => void;
  onBackToStart: () => void;
  apiSettings: ApiSettings;
  onAddLog?: (
    draft:
      | Omit<LogEntry, "id" | "timestamp">
      | Array<Omit<LogEntry, "id" | "timestamp">>,
  ) => void;
}

// Preset Investigators
// 创建期可选的调查员预设来自 src/data/presets.ts (TEMPLATE_PRESETS)。
// 旧版 CLASSIC_PRESETS / PRESET_OVERVIEWS 未在此组件被引用，已移除。

export default function CharacterCreator({ onComplete, onBackToStart, apiSettings, onAddLog }: CharacterCreatorProps) {
  // 3-step preparation flow: 1 = Choose Era & Generate Module Outline, 2 = Select / Customize PC, 3 = Double verify Dossier & Module Intro
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Era Choice state
  const [selectedEra, setSelectedEra] = useState<"1920s" | "modern">("modern");

  // Content Modules Toggle States
  const [featureTypeMoon, setFeatureTypeMoon] = useState<boolean>(true);
  const [featureScp, setFeatureScp] = useState<boolean>(true);

  // Dynamic generated Module Outline
  // 字段全部按可选处理：上游 LLM(尤其非 Gemini 路径)偶尔会丢字段或输出 Markdown，
  // 渲染处必须用可选链 + 数组守卫，避免整棵组件树因 undefined.map 白屏。
  const [moduleOutline, setModuleOutline] = useState<{
    title?: string;
    intro?: string;
    recommendedOccupations?: string[];
    presets?: {
      name: string;
      occupation: string;
      gender?: string;
      age?: number;
      overview: string;
      attributes: CharacterAttributes;
      skills: CharacterSkills;
    }[];
  } | null>(null);
  const [isGeneratingModule, setIsGeneratingModule] = useState(false);
  const [moduleGenerationError, setModuleGenerationError] = useState<string | null>(null);

  // Character creation mode
  const [mode, setMode] = useState<"choose" | "custom">("choose");
  const [selectedPresetIndex, setSelectedPresetIndex] = useState<number>(0);

  // PC Avatar upload (Base64)
  const [customAvatar, setCustomAvatar] = useState<string>("");

  // Custom Character Form State
  const [customName, setCustomName] = useState("");
  // 阶段 6：职业改为"标准模板 id 下拉 + 自由文本兜底"。空字符串 = 走 customOccupationFreeText。
  const [customOccupationId, setCustomOccupationId] = useState<string>("");
  const [customOccupationFreeText, setCustomOccupationFreeText] = useState<string>("民间神秘事件调查员");
  const [customIdentity, setCustomIdentity] = useState("");
  const [customNationality, setCustomNationality] = useState("");
  const [customResidence, setCustomResidence] = useState("");
  const [customMotherTongue, setCustomMotherTongue] = useState("");
  const [customCreditRating, setCustomCreditRating] = useState<number>(50);
  const [customGender, setCustomGender] = useState("男");
  const [customAge, setCustomAge] = useState<number>(30);
  const [customOverview, setCustomOverview] = useState("");
  const [customAttrs, setCustomAttrs] = useState<CharacterAttributes>({
    str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50
  });
  // 阶段 7：技能区改为槽位草稿 (8 职业槽 + 4 兴趣槽)
  const [skillDraft, setSkillDraft] = useState<SkillSheetDraft>(() => emptyDraft(customOccupationConstraints()));

  // 阶段 9：装备槽（House Rule：8 槽随身上限，详见 .docs/character-card-current.md 第 5 节）
  const INVENTORY_SLOT_COUNT = 8;
  const emptyInventory = (): InventoryEntry[] =>
    Array.from({ length: INVENTORY_SLOT_COUNT }, () => ({ kind: "item" as const, text: "" }));
  const [inventory, setInventory] = useState<InventoryEntry[]>(() => emptyInventory());

  // 切换 era 时把"被独占在另一个 era 的武器槽"重置为空物品（兼容性兜底）
  useEffect(() => {
    setInventory((prev) =>
      prev.map((e) => {
        if (e.kind !== "weapon") return e;
        const w = findWeapon(e.weaponId);
        if (!w || w.era === "any" || w.era === selectedEra) return e;
        return { kind: "item", text: "" };
      }),
    );
  }, [selectedEra]);

  const [isRolling, setIsRolling] = useState(false);
  const [isGeneratingStats, setIsGeneratingStats] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Result Character State (for Steps 2 and 3)
  const [reviewCharacter, setReviewCharacter] = useState<CharacterSheet | null>(null);

  const [importError, setImportError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // 阶段 7：派生当前职业模板的槽位约束（自拟职业 = 8 个 free 槽）。
  const occupationConstraints: SlotConstraint[] = useMemo(() => {
    if (customOccupationId) {
      const tpl = findOccupation(selectedEra, customOccupationId);
      if (tpl) return expandOccupationSlots(tpl);
    }
    return customOccupationConstraints();
  }, [customOccupationId, selectedEra]);

  // 当职业 / 年代变化导致约束变更时，重置职业槽（保留兴趣槽）。
  // 比较"约束签名"避免在初始 mount + 同一职业之间反复重置。
  const constraintSignature = useMemo(
    () => JSON.stringify(occupationConstraints),
    [occupationConstraints],
  );
  useEffect(() => {
    setSkillDraft((prev) => ({
      occupation: occupationConstraints.map((c) => {
        // 固定槽（fixedSkill / fixedBranch）自动锁定 picked，玩家不可改
        if (c.kind === "fixedSkill") {
          return { constraint: c, picked: { kind: "skill", skillId: c.skillId }, pointsAllocated: 0 };
        }
        if (c.kind === "fixedBranch") {
          return { constraint: c, picked: { kind: "branch", parentId: c.parentId, branchId: c.branchId }, pointsAllocated: 0 };
        }
        return { constraint: c, pointsAllocated: 0 };
      }),
      interest: prev.interest,
    }));
    // 仅在 constraintSignature 变化时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constraintSignature]);

  const pointPools = useMemo(() => computePointPools(customAttrs), [customAttrs]);
  const occSpent = useMemo(() => spentInSlots(skillDraft.occupation), [skillDraft.occupation]);
  const intSpent = useMemo(() => spentInSlots(skillDraft.interest), [skillDraft.interest]);
  const duplicateKeys = useMemo(() => findDuplicateSelections(skillDraft), [skillDraft]);

  // Get active presets list: either the dynamically generated templates or classical fallback presets
  const activePresets = React.useMemo(() => {
    const eraPresets = TEMPLATE_PRESETS.filter(p => {
      if (p.background !== selectedEra) return false;
      const isTM = p.occupation.includes("时钟塔") || p.occupation.includes("代行者") || 
                   (p.backgroundText && (p.backgroundText.includes("时钟塔") || p.backgroundText.includes("魔术") || p.backgroundText.includes("代行者")));
      const isSCP = p.occupation.includes("基金会") || p.occupation.includes("SCP") || 
                    (p.backgroundText && (p.backgroundText.includes("基金会") || p.backgroundText.includes("SCP") || p.backgroundText.includes("收容")));
      if (isTM && !featureTypeMoon) return false;
      if (isSCP && !featureScp) return false;
      return true;
    });

    if (moduleOutline?.presets && moduleOutline.presets.length > 0) {
      const selected = moduleOutline.presets.map((pObj) => {
        if (!pObj || typeof pObj !== "object") return null;

        const calculatedHp = Math.floor(((pObj.attributes?.con || 50) + (pObj.attributes?.siz || 50)) / 10);
        const calculatedMp = Math.floor((pObj.attributes?.pow || 50) / 5);
        const calculatedSan = pObj.attributes?.pow || 50;

        // Safe skills parser: maps Array<{name: string, value: number}> to Record<string, number>
        let skillsObj: Record<string, number> = {};
        const rawSkills: any = (pObj as any).skills;
        if (Array.isArray(rawSkills)) {
          rawSkills.forEach((s: any) => {
            if (s && typeof s === "object" && s.name && s.value !== undefined) {
              skillsObj[s.name] = Number(s.value);
            } else if (typeof s === "string") {
              skillsObj[s] = 40;
            }
          });
        } else if (rawSkills && typeof rawSkills === "object") {
          skillsObj = rawSkills;
        } else {
          skillsObj = { "神秘学": 60, "侦查": 60, "聆听": 50 };
        }

        return {
          name: pObj.name,
          occupation: pObj.occupation,
          gender: pObj.gender || "男",
          age: pObj.age || 30,
          overview: pObj.overview || "此调查员被调遣协作对峙未知异常。",
          attributes: pObj.attributes || { str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50 },
          skills: skillsObj,
          hp: calculatedHp,
          maxHp: calculatedHp,
          mp: calculatedMp,
          maxMp: calculatedMp,
          san: calculatedSan,
          maxSan: calculatedSan,
          maxSanLimit: 99,
          mythos: 0,
          background: selectedEra
        };
      }).filter((x): x is CharacterSheet & { overview: string } => x !== null);

      if (selected.length > 0) {
        return selected;
      }
    }
    
    // Fallback constants from selected era
    return eraPresets.slice(0, 3).map(p => ({
      ...p,
      overview: p.backgroundText || "资深的前线秘仪探求者，屡次协助收容或发掘星神崇拜设施迹象。"
    }));
  }, [moduleOutline?.presets, selectedEra]);

  // 创建期 「深渊复核 → 下载调查员角色卡」 入口。运行期入口在 CharacterDossierPanel 里直接
  // 调 downloadCharacterCard(sheet.creationSnapshot ?? sheet)；两者共享同一渲染模块。
  const handleDownloadCharacterCard = async () => {
    if (!reviewCharacter) return;
    setIsDownloading(true);
    try {
      await downloadCharacterCard(reviewCharacter);
    } catch (e) {
      console.error("Failure compiling downloadable investigator card representation:", e);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleImportCharacterCard = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "image/png") {
      setImportError("导入失败：只能上传符合 CoC 年代标准的 PNG 格式角色卡文件。");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(buffer);
      const decoder = new TextDecoder("utf-8");

      // Finding exact identifier sequence marker
      const marker = "KEEPER_CHARACTER_CARD_UTF8_PAYLOAD:";
      const markerBytes = new TextEncoder().encode(marker);

      let foundIndex = -1;
      for (let i = 0; i < uint8.length - markerBytes.length; i++) {
        let isMatch = true;
        for (let j = 0; j < markerBytes.length; j++) {
          if (uint8[i + j] !== markerBytes[j]) {
            isMatch = false;
            break;
          }
        }
        if (isMatch) {
          foundIndex = i;
          break;
        }
      }

      if (foundIndex === -1) {
        setImportError("校验未通过：该 PNG 图片并非本项目系统导出的有效调查员角卡，或已被第三方压缩过滤插件拦截损毁。");
        return;
      }

      const jsonPayloadBytes = uint8.subarray(foundIndex + markerBytes.length);
      const decodedPayloadString = decoder.decode(jsonPayloadBytes);
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(decodedPayloadString);
      } catch {
        setImportError("解析失败：该 PNG 末尾的 JSON payload 无法解码。请重新由系统的「下载调查员角色卡」按钮导出后再尝试。");
        return;
      }

      // 严格校验 — 与 .docs/character-dictionary.yaml 对齐。任何偏差直接拒绝。
      const validation = validateCharacterSheet(parsedPayload);
      if (!validation.ok) {
        const lines = validation.issues.slice(0, 12).map((i) => `• [${i.path}] ${i.message}`);
        const more = validation.issues.length > 12 ? `\n...其余 ${validation.issues.length - 12} 处偏差略。` : "";
        setImportError(
          `角色卡校验未通过（共 ${validation.issues.length} 处不符字典表）：\n${lines.join("\n")}${more}\n\n请在导出端按 .docs/character-dictionary.yaml 第 1–10 节规范修正后重试。`,
        );
        return;
      }
      const importedPC = validation.sheet!;

      // Extract image itself, converting into custom base64 avatar context
      const fileReader = new FileReader();
      fileReader.onload = async () => {
        const imageBase64Data = fileReader.result as string;

        // Try to keep the embedded avatar from JSON if it looks like a clean independent asset,
        // otherwise crop the 158x66 (84x84) avatar region of the card dynamically.
        let cleanAvatar = "";
        if (
          importedPC.avatar && 
          importedPC.avatar.startsWith("data:") && 
          importedPC.avatar !== imageBase64Data &&
          !importedPC.avatar.includes("CHRONOS SYSTEM")
        ) {
          cleanAvatar = importedPC.avatar;
        }

        if (!cleanAvatar) {
          // 按图片实际尺寸推断头像区域：
          //  - 新卡 (512×768)：中心 (256,150)，半径 56  → 源矩形 (200,94,112,112)
          //  - 旧卡 (400×400)：中心 (200,108)，半径 42 → 源矩形 (158,66,84,84)
          // 若两者都不匹配，按图像最小边的中心方形回退。
          cleanAvatar = await new Promise<string>((resolveCrop) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              try {
                const tempCanvas = document.createElement("canvas");
                tempCanvas.width = 120;
                tempCanvas.height = 120;
                const tempCtx = tempCanvas.getContext("2d");
                if (tempCtx) {
                  let sx: number, sy: number, sw: number, sh: number;
                  if (img.naturalWidth === 512 && img.naturalHeight === 768) {
                    sx = 200; sy = 94; sw = 112; sh = 112;
                  } else if (img.naturalWidth === 400 && img.naturalHeight === 400) {
                    sx = 158; sy = 66; sw = 84; sh = 84;
                  } else {
                    const side = Math.min(img.naturalWidth, img.naturalHeight);
                    sx = (img.naturalWidth - side) / 2;
                    sy = (img.naturalHeight - side) / 2;
                    sw = side; sh = side;
                  }
                  tempCtx.drawImage(img, sx, sy, sw, sh, 0, 0, 120, 120);
                  resolveCrop(tempCanvas.toDataURL("image/png"));
                  return;
                }
              } catch (e) {
                console.error("Error cropping avatar region from character card:", e);
              }
              resolveCrop(imageBase64Data); // Fallback to raw card
            };
            img.onerror = () => {
              resolveCrop(imageBase64Data);
            };
            img.src = imageBase64Data;
          });
        }

        importedPC.avatar = cleanAvatar;

        // Populate step 2 states in case they want to revert or tune
        setCustomName(importedPC.name);
        // 阶段 6：尝试匹配标准职业模板 id；匹配不到则把整字符串作为自由文本回填
        {
          const occRaw = importedPC.occupation || "";
          const era = (importedPC.background as "1920s" | "modern") || selectedEra;
          const matched = getOccupations(era).find((o) => o.id === occRaw || o.nameZh === occRaw);
          if (matched) {
            setCustomOccupationId(matched.id);
            setCustomOccupationFreeText("");
          } else {
            setCustomOccupationId("");
            setCustomOccupationFreeText(occRaw || "民间神秘事件调查员");
          }
        }
        setCustomIdentity(importedPC.identity || "");
        setCustomNationality(importedPC.nationality || "");
        setCustomResidence(importedPC.residence || "");
        setCustomMotherTongue(importedPC.motherTongue || "");
        setCustomCreditRating(typeof importedPC.creditRating === "number" ? importedPC.creditRating : 50);
        setCustomGender(importedPC.gender || "男");
        setCustomAge(importedPC.age || 30);
        setCustomAttrs({ ...importedPC.attributes });

        const filteredSkills = { ...importedPC.skills };
        delete (filteredSkills as any)["克苏鲁神话"];
        // 阶段 7：把名值字典平摊到职业 / 兴趣槽。
        // 注意：occupationConstraints 来自 useMemo，可能仍是上一次 era / 职业 id 对应的版本，
        // 此处用导入卡的 occupation 模板重新解析（若匹配不到模板则走 8 free 槽）。
        {
          const occRaw = importedPC.occupation || "";
          const eraImported = (importedPC.background as "1920s" | "modern") || selectedEra;
          const matchedTpl = getOccupations(eraImported).find((o) => o.id === occRaw || o.nameZh === occRaw);
          const constraints = matchedTpl ? expandOccupationSlots(matchedTpl) : customOccupationConstraints();
          setSkillDraft(distributeSkillsToDraft(filteredSkills, constraints, eraImported));
        }

        setCustomAvatar(cleanAvatar);

        if (importedPC.background) {
          setSelectedEra(importedPC.background as "1920s" | "modern");
        }

        // Direct skip to confirmation step
        setReviewCharacter(refreshCombatDerived(importedPC));
        setImportError(null);
        setCurrentStep(3);
      };
      fileReader.readAsDataURL(file);

    } catch (err: any) {
      console.error(err);
      setImportError("解析外部导入卡片错误：由于异位星界风暴干扰，该流段已被判定受损。");
    }
  };

  // Roll single standard attribute (CoC 7th values)
  const roll3d6 = () => (Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1) * 5;
  const roll2d6plus6 = () => (Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1 + 6) * 5;

  const rollStats = () => {
    setIsRolling(true);
    let counter = 0;
    const interval = setInterval(() => {
      setCustomAttrs({
        str: roll3d6(),
        con: roll3d6(),
        siz: roll2d6plus6(),
        dex: roll3d6(),
        app: roll3d6(),
        int: roll2d6plus6(),
        pow: roll3d6(),
        edu: roll2d6plus6(),
        luck: roll3d6(),
      });
      counter++;
      if (counter > 10) {
        clearInterval(interval);
        setIsRolling(false);
      }
    }, 60);
  };

  // 阶段 7 · 槽位编辑 helpers
  const updateOccupationSlot = (idx: number, patch: Partial<SlotState>) => {
    setSkillDraft((prev) => {
      const next = prev.occupation.slice();
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, occupation: next };
    });
  };
  const updateInterestSlot = (idx: number, patch: Partial<SlotState>) => {
    setSkillDraft((prev) => {
      const next = prev.interest.slice();
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, interest: next };
    });
  };
  const setSlotPicked = (kind: "occupation" | "interest", idx: number, picked: SkillSelection | undefined) => {
    const updater = kind === "occupation" ? updateOccupationSlot : updateInterestSlot;
    updater(idx, { picked, pointsAllocated: 0 });
  };
  const setSlotPoints = (kind: "occupation" | "interest", idx: number, points: number) => {
    const clamped = Math.max(0, Math.min(99, Math.floor(points || 0)));
    const updater = kind === "occupation" ? updateOccupationSlot : updateInterestSlot;
    updater(idx, { pointsAllocated: clamped });
  };

  // Generate Module Outline via the user-configured LLM provider
  const generateModuleOutline = async () => {
    setIsGeneratingModule(true);
    setModuleGenerationError(null);

    const startedAt = Date.now();
    const pushServerLogs = (raw: any) => {
      if (!onAddLog || !Array.isArray(raw?._serverLogs)) return;
      onAddLog(
        raw._serverLogs
          .filter((e: any) => e && typeof e === "object")
          .map((e: any) => ({
            direction: (e.direction as LogEntry["direction"]) ?? "info",
            content: typeof e.content === "string" ? e.content : "",
            meta: e.meta,
          })),
      );
    };
    onAddLog?.({
      direction: "request",
      content: `POST /api/keeper/generate-module-outline → ${apiSettings.llm.provider} ${apiSettings.llm.model || "(default)"}`,
      meta: { era: selectedEra, typemoon: featureTypeMoon, scp: featureScp },
    });

    try {
      const response = await fetch("/api/keeper/generate-module-outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          era: selectedEra,
          typemoon: featureTypeMoon,
          scp: featureScp,
          apiSettings
        })
      });

      if (!response.ok) {
        let bodyText = "";
        let upstreamMsg = "";
        try {
          const json = await response.clone().json();
          pushServerLogs(json);
          bodyText = JSON.stringify(json).slice(0, 400);
          upstreamMsg = typeof json?.error === "string" ? json.error : "";
        } catch {
          try { bodyText = (await response.text()).slice(0, 400); } catch {}
        }
        onAddLog?.({
          direction: "error",
          content: `POST /api/keeper/generate-module-outline ← HTTP ${response.status}`,
          meta: { status: response.status, durationMs: Date.now() - startedAt, body: bodyText },
        });
        throw new Error(upstreamMsg || `生成模组失败 (HTTP ${response.status})`);
      }

      const resData = await response.json();
      pushServerLogs(resData);
      if (resData.success && resData.data) {
        onAddLog?.({
          direction: "response",
          content: `POST /api/keeper/generate-module-outline ← outline ok`,
          meta: { durationMs: Date.now() - startedAt, moduleName: resData.data?.moduleName },
        });
        // 规整 outline：模型偶尔会丢字段或把数组写成字符串，做最小兜底再入 state，
        // 避免渲染层 .map(undefined) 直接整页白屏。
        const raw = resData.data;
        setModuleOutline({
          title: typeof raw?.title === "string" ? raw.title : "",
          intro: typeof raw?.intro === "string" ? raw.intro : "",
          recommendedOccupations: Array.isArray(raw?.recommendedOccupations)
            ? raw.recommendedOccupations.filter((s: any) => typeof s === "string")
            : [],
          presets: Array.isArray(raw?.presets) ? raw.presets : [],
        });
      } else {
        onAddLog?.({
          direction: "error",
          content: `POST /api/keeper/generate-module-outline ← invalid payload`,
          meta: { durationMs: Date.now() - startedAt, error: resData?.error },
        });
        throw new Error(resData.error || "获取模组信息失败");
      }
    } catch (err: any) {
      console.error("Failed to generate module outline:", err);
      onAddLog?.({
        direction: "error",
        content: `POST /api/keeper/generate-module-outline exception`,
        meta: { durationMs: Date.now() - startedAt, message: err?.message },
      });
      setModuleGenerationError(err.message || "由于未知的异度力场干扰，模组生成失败。请重试。");
    } finally {
      setIsGeneratingModule(false);
    }
  };

  // Generate Stats from Overview via the user-configured LLM provider
  const generateStatsFromOverview = async () => {
    if (!customOverview.trim()) return;
    setIsGeneratingStats(true);
    setGenerationError(null);

    const startedAt = Date.now();
    const pushServerLogs = (raw: any) => {
      if (!onAddLog || !Array.isArray(raw?._serverLogs)) return;
      onAddLog(
        raw._serverLogs
          .filter((e: any) => e && typeof e === "object")
          .map((e: any) => ({
            direction: (e.direction as LogEntry["direction"]) ?? "info",
            content: typeof e.content === "string" ? e.content : "",
            meta: e.meta,
          })),
      );
    };
    onAddLog?.({
      direction: "request",
      content: `POST /api/keeper/generate-stats → ${apiSettings.llm.provider} ${apiSettings.llm.model || "(default)"}`,
      meta: { era: selectedEra, name: customName || undefined, descPreview: (customOverview || "").slice(0, 160) },
    });

    try {
      const response = await fetch("/api/keeper/generate-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: customOverview,
          era: selectedEra,
          name: customName,
          apiSettings
        })
      });

      if (!response.ok) {
        let bodyText = "";
        try {
          const json = await response.clone().json();
          pushServerLogs(json);
          bodyText = JSON.stringify(json).slice(0, 400);
        } catch {
          try { bodyText = (await response.text()).slice(0, 400); } catch {}
        }
        onAddLog?.({
          direction: "error",
          content: `POST /api/keeper/generate-stats ← HTTP ${response.status}`,
          meta: { status: response.status, durationMs: Date.now() - startedAt, body: bodyText },
        });
        throw new Error("HTTP connection error or API issue when generating attributes.");
      }

      const resData = await response.json();
      pushServerLogs(resData);
      if (resData.success && resData.data) {
        onAddLog?.({
          direction: "response",
          content: `POST /api/keeper/generate-stats ← stats ok`,
          meta: { durationMs: Date.now() - startedAt, occupation: resData.data?.occupation, skillsCount: Array.isArray(resData.data?.skills) ? resData.data.skills.length : undefined },
        });
        const charData = resData.data;
        if (charData.name && !customName.trim()) {
          setCustomName(charData.name);
        }
        if (charData.occupation) {
          // 阶段 6：LLM 输出的职业字符串先尝试匹配模板 id / 中文名，匹配不到则作为自由文本
          const occRaw = String(charData.occupation || "").trim();
          const matched = getOccupations(selectedEra).find((o) => o.id === occRaw || o.nameZh === occRaw);
          if (matched) {
            setCustomOccupationId(matched.id);
            setCustomOccupationFreeText("");
          } else {
            setCustomOccupationId("");
            setCustomOccupationFreeText(occRaw);
          }
        }
        if (typeof charData.identity === "string") setCustomIdentity(charData.identity);
        if (typeof charData.nationality === "string") setCustomNationality(charData.nationality);
        if (typeof charData.residence === "string") setCustomResidence(charData.residence);
        if (typeof charData.motherTongue === "string") setCustomMotherTongue(charData.motherTongue);
        if (typeof charData.creditRating === "number") setCustomCreditRating(Math.max(0, Math.min(99, Math.floor(charData.creditRating))));
        if (charData.attributes) {
          setCustomAttrs({
            str: charData.attributes.str || 50,
            con: charData.attributes.con || 50,
            siz: charData.attributes.siz || 50,
            dex: charData.attributes.dex || 50,
            app: charData.attributes.app || 50,
            int: charData.attributes.int || 50,
            pow: charData.attributes.pow || 50,
            edu: charData.attributes.edu || 50,
            luck: charData.attributes.luck || 50
          });
        }
        if (charData.skills && Array.isArray(charData.skills)) {
          const mappedSkills: CharacterSkills = {};
          charData.skills.forEach((s: { name: string; value: number }) => {
            if (s.name && s.value) {
              mappedSkills[s.name] = s.value;
            }
          });
          // 阶段 7：LLM 回填要按"当前选择的职业"来落槽位，未选职业 = 8 free 槽。
          // 此处直接用最新的 customOccupationId（charData.occupation 已经在前面写入 state）。
          const tplOccId =
            (typeof charData.occupation === "string" &&
              getOccupations(selectedEra).find(
                (o) => o.id === charData.occupation || o.nameZh === charData.occupation,
              )?.id) ||
            customOccupationId;
          const matchedTpl = tplOccId ? findOccupation(selectedEra, tplOccId) : undefined;
          const constraints = matchedTpl ? expandOccupationSlots(matchedTpl) : customOccupationConstraints();
          // 阶段 8：LLM 输出的"技能偏好"先落 picked 槽，点数交本地分配器按 EDU×4 / INT×2 双池合法切分。
          const llmAttrs = charData.attributes
            ? {
                str: charData.attributes.str || 50,
                con: charData.attributes.con || 50,
                siz: charData.attributes.siz || 50,
                dex: charData.attributes.dex || 50,
                app: charData.attributes.app || 50,
                int: charData.attributes.int || 50,
                pow: charData.attributes.pow || 50,
                edu: charData.attributes.edu || 50,
                luck: charData.attributes.luck || 50,
              }
            : customAttrs;
          const distributed = distributeSkillsToDraft(mappedSkills, constraints, selectedEra);
          setSkillDraft(legalizeDraft(distributed, llmAttrs, selectedEra));
        }
      } else {
        onAddLog?.({
          direction: "error",
          content: `POST /api/keeper/generate-stats ← invalid payload`,
          meta: { durationMs: Date.now() - startedAt, error: resData?.error },
        });
        throw new Error(resData.error || "获取属性失败");
      }
    } catch (err: any) {
      console.error("Failed to generate character stats:", err);
      onAddLog?.({
        direction: "error",
        content: `POST /api/keeper/generate-stats exception`,
        meta: { durationMs: Date.now() - startedAt, message: err?.message },
      });
      setGenerationError(err.message || "生成属性失败，请稍后重试。");
    } finally {
      setIsGeneratingStats(false);
    }
  };

  // Avatar file picker handler
  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCustomAvatar(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Preset -> Proceed to review
  const handleSelectPreset = () => {
    const preset = activePresets[selectedPresetIndex] || activePresets[0];
    // 字典表第 1 节 / 第 9 节 / 第 7 节 / 第 10 节：所有创建期字段必须落在 sheet 上。
    // presets.ts 已对齐字典表，此处只补齐 era 切换 / avatar / 派生字段。
    const presetCR = typeof (preset as CharacterSheet).creditRating === "number"
      ? (preset as CharacterSheet).creditRating!
      : 0;
    const presetInventory: InventoryEntry[] = Array.isArray((preset as CharacterSheet).inventory)
      && (preset as CharacterSheet).inventory!.length === 8
      ? (preset as CharacterSheet).inventory!.map((e) =>
          e.kind === "weapon"
            ? { kind: "weapon" as const, weaponId: e.weaponId, ammo: e.ammo }
            : { kind: "item" as const, text: e.text },
        )
      : Array.from({ length: 8 }, () => ({ kind: "item" as const, text: "" }));
    const presetMythic: MythicEncounters = (preset as CharacterSheet).mythicEncounters ?? {
      tomes: [], spells: [], artifacts: [], entities: [],
    };
    const finalChar: CharacterSheet = {
      ...(preset as CharacterSheet),
      background: selectedEra,
      avatar: customAvatar || (preset as CharacterSheet).avatar || undefined,
      backgroundStory: (preset as any).overview ?? (preset as any).backgroundText ?? (preset as CharacterSheet).backgroundStory,
      mythicEncounters: presetMythic,
      inventory: presetInventory,
      cashBalance: startingCashOf(presetCR, selectedEra),
      sanityState: { episodeSanLoss: 0, madness: null },
    };
    setReviewCharacter(refreshCombatDerived(finalChar));
    setCurrentStep(3);
  };

  // Custom -> Proceed to review
  const handleCreateCustom = () => {
    const finalName = customName.trim() || "无名调查员";
    const calculatedHp = Math.floor((customAttrs.con + customAttrs.siz) / 10);
    const calculatedMp = Math.floor(customAttrs.pow / 5);
    const calculatedSan = customAttrs.pow;

    // 阶段 6：职业 = 选中模板的中文名 / 否则自由文本兜底
    const selectedOccTemplate = customOccupationId ? findOccupation(selectedEra, customOccupationId) : undefined;
    const finalOccupation = selectedOccTemplate?.nameZh || customOccupationFreeText.trim() || "非主流秘仪学者";

    const finalCreditRating = Number.isFinite(customCreditRating)
      ? Math.max(0, Math.min(99, Math.floor(customCreditRating)))
      : 0;

    const baseChar: CharacterSheet = {
      name: finalName,
      occupation: finalOccupation,
      gender: customGender,
      age: customAge,
      background: selectedEra,
      attributes: { ...customAttrs },
      skills: draftToSkills(skillDraft),
      hp: calculatedHp,
      maxHp: calculatedHp,
      mp: calculatedMp,
      maxMp: calculatedMp,
      san: calculatedSan,
      maxSan: calculatedSan,
      maxSanLimit: 99,
      mythos: 0,
      avatar: customAvatar || undefined,
      backgroundStory: customOverview.trim() || undefined,
      // 阶段 6 新增基本信息字段（全部 optional，空串不写入）
      identity: customIdentity.trim() || undefined,
      nationality: customNationality.trim() || undefined,
      residence: customResidence.trim() || undefined,
      motherTongue: customMotherTongue.trim() || undefined,
      creditRating: finalCreditRating,
      // 神秘接触：创建期空，KP 在游戏中下发
      mythicEncounters: { tomes: [], spells: [], artifacts: [], entities: [] } satisfies MythicEncounters,
      // 阶段 9 装备槽：8 槽随身，空槽 = { kind:"item", text:"" } 占位
      inventory: inventory.map((e) =>
        e.kind === "weapon"
          ? { kind: "weapon" as const, weaponId: e.weaponId, ammo: e.ammo }
          : { kind: "item" as const, text: e.text },
      ),
      // 阶段 10：现金运行时余额初值 = 起始现金派生值
      cashBalance: startingCashOf(finalCreditRating, selectedEra),
      // 字典表第 10 节：疯狂状态机创建期默认
      sanityState: { episodeSanLoss: 0, madness: null },
    };

    // 阶段 10：派生战斗值快照（DB / Build / MOV / Dodge）写入持久化
    const newChar = refreshCombatDerived(baseChar);

    setReviewCharacter(newChar);
    setCurrentStep(3);
  };

  const handleLaunchScenario = () => {
    if (reviewCharacter) {
      onComplete(reviewCharacter, { typemoon: featureTypeMoon, scp: featureScp });
    }
  };

  return (
    <div id="character-creator-root" className="w-full max-w-4xl mx-auto bg-[#121415]/95 border border-[#c1a067]/45 rounded-lg shadow-2xl p-6 md:p-8 backdrop-blur text-gray-200 font-sans select-none my-6">

      {/* Top-bar: Return to start screen (available across all three preparation steps) */}
      <div className="flex items-center justify-between mb-4">
        <button
          id="back-to-start-btn"
          type="button"
          onClick={onBackToStart}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-black/40 border border-[#c1a067]/30 text-[#c1a067]/80 hover:text-[#c1a067] hover:border-[#c1a067]/70 hover:bg-[#c1a067]/10 text-xs font-sans rounded transition active:scale-95"
        >
          <Home className="w-3.5 h-3.5" />
          <span>返回首页</span>
        </button>
        <span className="text-[10px] text-gray-500 font-mono tracking-widest uppercase">
          KEEPER · INVESTIGATOR PREPARATION
        </span>
      </div>

      {/* 3 Steps Progress bar */}
      <div id="preparation-steps-indicator" className="grid grid-cols-3 gap-2 mb-8 border-b border-[#c1a067]/10 pb-4 text-center font-sans">
        <div className={`p-2 rounded text-xs tracking-wider transition-all duration-300 ${currentStep === 1 ? "bg-[#c1a067]/20 border border-[#c1a067] text-[#c1a067] font-semibold" : "text-gray-500"}`}>
          <div className="text-[10px] font-mono mb-1 uppercase">STEP 01</div>
          <span>历史帷幕 (年代与模组)</span>
        </div>
        <div className={`p-2 rounded text-xs tracking-wider transition-all duration-300 ${currentStep === 2 ? "bg-[#c1a067]/20 border border-[#c1a067] text-[#c1a067] font-semibold" : "text-gray-500"}`}>
          <div className="text-[10px] font-mono mb-1 uppercase">STEP 02</div>
          <span>建立档案 (调查员PC选择)</span>
        </div>
        <div className={`p-2 rounded text-xs tracking-wider transition-all duration-300 ${currentStep === 3 ? "bg-[#c1a067]/20 border border-[#c1a067] text-[#c1a067] font-semibold" : "text-gray-500"}`}>
          <div className="text-[10px] font-mono mb-1 uppercase">STEP 03</div>
          <span>深渊复核 (开启探索)</span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        
        {/* ======================================= STEP 1: ERA AND MODULE GENERATION ======================================= */}
        {currentStep === 1 && (
          <motion.div
            key="step-1-era"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            <div className="text-center mb-6">
              <h2 className="font-sans text-3xl font-semibold tracking-wider text-[#c1a067] uppercase">
                - 历史帷幕：选择模组背景年代 -
              </h2>
              <p className="text-gray-400 text-xs tracking-widest font-mono mt-2">
                CHOOSE ERA / KEEPER DRAFTING MYSTERIOUS MODULE CONFIG
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button 
                id="era-1920s-btn"
                type="button"
                onClick={() => { setSelectedEra("1920s"); setModuleOutline(null); }}
                className={`p-4 rounded border text-left transition relative overflow-hidden ${
                  selectedEra === "1920s" 
                    ? "bg-[#c1a067]/15 border-[#c1a067] text-[#c1a067]" 
                    : "bg-black/40 border-[#c1a067]/20 hover:border-[#c1a067]/60"
                }`}
              >
                <div className="text-base font-semibold mb-1 flex items-center gap-1.5 font-sans">
                  <span>1920年代：爵士乐与黄金狂热</span>
                </div>
                <div className="text-xs text-gray-400 leading-relaxed font-sans">
                  古老、迷雾笼罩的维多利亚式庄园、飞驰的蒸汽列车和布满铁锈的密斯卡托尼克古老馆藏。魔术名门在暗地中密谋唤醒根源，而危险的克苏鲁教徒在沼泽中血腥祭祀，氛围腐朽、深邃。
                </div>
                {selectedEra === "1920s" && (
                  <span className="absolute bottom-2 right-2 text-[10px] uppercase font-mono tracking-widest border border-[#c1a067] px-1 text-[#c1a067] bg-black">SELECTED</span>
                )}
              </button>

              <button 
                id="era-modern-btn"
                type="button"
                onClick={() => { setSelectedEra("modern"); setModuleOutline(null); }}
                className={`p-4 rounded border text-left transition relative overflow-hidden ${
                  selectedEra === "modern" 
                    ? "bg-[#c1a067]/15 border-[#c1a067] text-[#c1a067]" 
                    : "bg-black/40 border-[#c1a067]/20 hover:border-[#c1a067]/60"
                }`}
              >
                <div className="text-base font-semibold mb-1 flex items-center gap-1.5 font-sans">
                  <span>21世纪现代：信息高墙与深渊</span>
                </div>
                <div className="text-xs text-gray-400 leading-relaxed font-sans">
                  SCP基金会在世界暗角用钢筋与磁场进行钢铁收容；时钟塔的现代魔术科（El-Melloi）借数字网络解析太古教典。在遍布监控、霓虹闪烁的城市角落，神秘开始失控漫溢。
                </div>
                {selectedEra === "modern" && (
                  <span className="absolute bottom-2 right-2 text-[10px] uppercase font-mono tracking-widest border border-[#c1a067] px-1 text-[#c1a067] bg-black">SELECTED</span>
                )}
              </button>
            </div>

            {/* Content Module Settings */}
            <div className="bg-black/35 border border-[#c1a067]/15 p-5 rounded-lg space-y-4">
              <div className="border-b border-[#c1a067]/10 pb-2">
                <h4 className="text-sm font-semibold text-[#c1a067] font-sans flex items-center gap-1.5">
                  <Shield className="w-4 h-4" /> TRPG 内容模块库载入配置 (Content Module Options)
                </h4>
                <p className="text-[10px] text-gray-500 font-mono tracking-wider mt-0.5 uppercase">
                  Select which expansion lore elements to load into background sandbox
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Classic CoC */}
                <div className="flex items-center gap-3 p-3 bg-black/40 border border-[#c1a067]/10 rounded select-none opacity-85">
                  <input
                    type="checkbox"
                    checked
                    disabled
                    id="checkbox-classic-coc"
                    className="w-4 h-4 rounded border-gray-600 bg-black text-[#c1a067] focus:ring-[#c1a067] cursor-not-allowed"
                  />
                  <label htmlFor="checkbox-classic-coc" className="cursor-not-allowed text-left">
                    <span className="text-xs font-bold text-gray-200 block">【固件】经典CoC</span>
                    <span className="text-[10px] text-gray-400 block whitespace-nowrap">经典克苏鲁属性、检定及疯狂法则(不可关闭)</span>
                  </label>
                </div>

                {/* Type-MOON */}
                <button
                  type="button"
                  id="toggle-typemoon-module"
                  onClick={() => {
                    setFeatureTypeMoon(!featureTypeMoon);
                    setModuleOutline(null);
                  }}
                  className={`flex items-center gap-3 p-3 border rounded text-left transition select-none ${
                    featureTypeMoon 
                      ? "bg-[#c1a067]/5 border-[#c1a067]/40 text-[#c1a067]" 
                      : "bg-black/20 border-neutral-800 opacity-60 text-gray-400"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={featureTypeMoon}
                    readOnly
                    className="w-4 h-4 rounded border-gray-600 text-[#c1a067] focus:ring-[#c1a067] pointer-events-none"
                  />
                  <div>
                    <span className="text-xs font-bold block">【附加】Type-MOON要素</span>
                    <span className="text-[10px] text-gray-400 block">融合时钟塔魔术、圣堂代行者和秘仪理论</span>
                  </div>
                </button>

                {/* SCP Foundation */}
                <button
                  type="button"
                  id="toggle-scp-module"
                  onClick={() => {
                    setFeatureScp(!featureScp);
                    setModuleOutline(null);
                  }}
                  className={`flex items-center gap-3 p-3 border rounded text-left transition select-none ${
                    featureScp 
                      ? "bg-[#c1a067]/5 border-[#c1a067]/40 text-[#c1a067]" 
                      : "bg-black/20 border-neutral-800 opacity-60 text-gray-400"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={featureScp}
                    readOnly
                    className="w-4 h-4 rounded border-gray-600 text-[#c1a067] focus:ring-[#c1a067] pointer-events-none"
                  />
                  <div>
                    <span className="text-xs font-bold block">【附加】SCP要素</span>
                    <span className="text-[10px] text-gray-400 block">融合SCP基金会特别外勤、Site站点与异常收容</span>
                  </div>
                </button>
              </div>
            </div>

            {/* If no module outline generated yet, show the generate button */}
            {!moduleOutline ? (
              <div className="text-center pt-6 decoration-transparent">
                <button
                  id="generate-module-btn"
                  type="button"
                  onClick={generateModuleOutline}
                  disabled={isGeneratingModule}
                  className="px-10 py-3.5 bg-[#c1a067] text-black font-semibold tracking-wider rounded transition-all hover:bg-[#d5b57d] active:scale-95 text-sm uppercase shadow-lg shadow-[#c1a067]/20 disabled:opacity-40 flex items-center gap-2 mx-auto"
                >
                  <Sparkles className={`w-4 h-4 ${isGeneratingModule ? "animate-spin" : ""}`} />
                  {isGeneratingModule ? "守密人(KP)正沙盘推演模组大纲..." : "确认年代并架构模组大纲"}
                </button>
                {moduleGenerationError && (
                  <p className="text-red-400 text-xs mt-3 flex items-center justify-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {moduleGenerationError}
                  </p>
                )}
              </div>
            ) : (
              /* Generated Module Outline (Non-spoiler review) */
              <motion.div 
                id="generated-module-review-card"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#181a1c] border border-[#c1a067]/30 p-5 rounded-lg space-y-4 font-sans relative"
              >
                <div className="absolute top-3 right-3 text-[10px] font-mono text-[#c1a067]/70 uppercase tracking-widest border border-[#c1a067]/20 px-2 py-0.5 bg-black/40 rounded">
                  Keeper Module Drafted
                </div>

                <div className="border-b border-[#c1a067]/15 pb-2.5">
                  <span className="text-[10px] text-gray-400 font-mono tracking-widest block uppercase">模组标题 (Module Title)</span>
                  <h3 className="text-xl font-bold text-[#c1a067] mt-0.5 font-sans">
                    {moduleOutline.title || "(标题缺失)"}
                  </h3>
                </div>

                <div className="text-sm leading-relaxed text-gray-300 font-sans space-y-2">
                  <span className="text-[10px] text-gray-400 font-mono tracking-widest block uppercase">前言/背景低语 (No-Spoiler Intro)</span>
                  <p className="bg-black/30 p-4 border-l-2 border-[#c1a067] rounded-r italic text-gray-350 select-text">
                    {moduleOutline.intro || "(前言缺失,可重新生成)"}
                  </p>
                </div>

                {/* Suggested occupations label */}
                <div className="pt-2">
                  <span className="text-[10px] text-gray-400 font-mono tracking-widest block uppercase mb-1.5">契合本模组推荐PC职业方向 (Suggested PC Occupations)</span>
                  <div className="flex flex-wrap gap-2">
                    {Array.isArray(moduleOutline.recommendedOccupations) && moduleOutline.recommendedOccupations.length > 0 ? (
                      moduleOutline.recommendedOccupations.map((job) => (
                        <span key={job} className="text-xs bg-[#c1a067]/10 text-[#c1a067] border border-[#c1a067]/30 px-2.5 py-1 rounded font-normal font-sans shadow-sm">
                          {job}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-gray-500 italic font-sans">(模型未给出推荐职业，可重新生成或自由选择)</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row justify-end items-center gap-3 pt-4 border-t border-[#c1a067]/10">
                  <button
                    id="regenerate-module-outline-btn"
                    type="button"
                    onClick={generateModuleOutline}
                    disabled={isGeneratingModule}
                    className="flex items-center gap-1.5 px-4 py-2 bg-black border border-[#c1a067]/40 text-[#c1a067] font-sans text-xs rounded hover:bg-[#c1a067]/15 transition active:scale-95 disabled:opacity-40"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isGeneratingModule ? "animate-spin" : ""}`} /> 重新生成模组
                  </button>

                  <button
                    id="approve-step-1-btn"
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="flex items-center gap-1.5 px-6 py-2 bg-[#c1a067] text-black font-bold font-sans text-xs rounded hover:bg-[#d5b57d] transition active:scale-95"
                  >
                    <span>满意大纲，建立调查员卡片</span>
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* ======================================= STEP 2: CHARACTER CREATION & SELECTION ======================================= */}
        {currentStep === 2 && (
          <motion.div
            key="step-2-creator"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            {/* Form Header */}
            <div className="text-center mb-6">
              <h2 className="font-sans text-3xl font-semibold tracking-wider text-[#c1a067] uppercase">
                - 调查员档案建立 -
              </h2>
              <p className="text-gray-400 text-xs tracking-widest font-mono mt-2">
                ESTABLISH PL / PC CHARACTER SHEET AND ATTRIBUTE SELECTION
              </p>
            </div>

            {/* Current Module Context Reference Bar (Provides Background Whispers for PC Creation) */}
            {moduleOutline && (
              <div id="module-context-reference" className="bg-[#181a1c] border border-[#c1a067]/30 p-4 rounded-lg font-sans space-y-3.5 shadow-lg">
                <div className="flex items-center gap-2 justify-between border-b border-gray-800/80 pb-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-[#c1a067]" />
                    <span className="text-xs font-bold text-[#c1a067] uppercase tracking-wider font-sans">正在参阅当前模组背景情报 (Reference Dossier)</span>
                  </div>
                  <span className="text-[10px] font-mono bg-[#c1a067]/10 text-[#c1a067] px-2.5 py-0.5 rounded border border-[#c1a067]/35 uppercase tracking-wide">
                    《{moduleOutline.title || "未命名模组"}》
                  </span>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-400 font-mono tracking-widest block uppercase">模组前言 / 深渊背景低语 :</span>
                  <div className="text-xs leading-relaxed text-gray-300 italic pl-3 border-l-2 border-[#c1a067]/60 py-1 bg-black/25 pr-2 select-text font-serif leading-normal whitespace-pre-line">
                    {moduleOutline.intro || "(前言缺失)"}
                  </div>
                </div>
                <div className="flex items-center flex-wrap gap-1.5 pt-1.5 text-[11px] text-gray-400 border-t border-gray-900/40">
                  <span className="font-semibold text-gray-300 font-sans flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-[#c1a067]" />
                    <span>契合本案 PC 职业推荐:</span>
                  </span>
                  {Array.isArray(moduleOutline.recommendedOccupations) && moduleOutline.recommendedOccupations.length > 0 ? (
                    moduleOutline.recommendedOccupations.map((job) => (
                      <span key={job} className="bg-black/50 text-[#c1a067] px-2 py-0.5 rounded font-medium border border-gray-800/80 font-sans text-[11px]">
                        {job}
                      </span>
                    ))
                  ) : (
                    <span className="text-gray-500 italic">(无推荐)</span>
                  )}
                </div>
              </div>
            )}

            {/* Mode Selector */}
            <div className="flex justify-center gap-1 border-b border-[#c1a067]/10 pb-4 mb-6">
              <button
                id="mode-choose-btn"
                type="button"
                onClick={() => setMode("choose")}
                className={`flex items-center gap-2 px-6 py-2 border-b-2 text-sm transition font-medium ${
                  mode === "choose" 
                    ? "border-[#c1a067] text-[#c1a067] bg-white/5" 
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                <FileText className="w-4 h-4" /> 选择预设经典调查员 (Classic PCs)
              </button>
              <button
                id="mode-custom-btn"
                type="button"
                onClick={() => setMode("custom")}
                className={`flex items-center gap-2 px-6 py-2 border-b-2 text-sm transition font-medium ${
                  mode === "custom" 
                    ? "border-[#c1a067] text-[#c1a067] bg-white/5" 
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                <User className="w-4 h-4" /> 自主缔结专属卡片 (Custom PC)
              </button>
            </div>

            {/* Investigator Card Loader - Import PNG Sheet */}
            <div className="bg-[#181a1c] border border-dashed border-[#c1a067]/30 p-4 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-4 font-sans shadow-md">
              <div className="flex items-center gap-3">
                <FileUp className="w-8 h-8 text-[#c1a067] shrink-0" />
                <div>
                  <h4 className="text-xs font-bold text-[#c1a067] uppercase tracking-wider">导入已有并导出的调查员卡片 (.png)</h4>
                  <p className="text-[10px] text-gray-400 mt-0.5">上传本项目专属导出的 PNG 角色卡以还原完整的属性、生命、San值、技能树与专属照片</p>
                </div>
              </div>
              <div>
                <label className="cursor-pointer flex items-center gap-2 px-5 py-2.5 bg-[#c1a067]/10 hover:bg-[#c1a067]/20 border border-[#c1a067] text-[#c1a067] text-xs font-bold tracking-wider font-sans rounded transition duration-200 uppercase">
                  <FileUp className="w-4 h-4" />
                  <span>上传角色卡图片</span>
                  <input 
                    id="import-character-card-file"
                    type="file"
                    accept="image/png"
                    onChange={handleImportCharacterCard}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {importError && (
              <div className="p-3 bg-red-950/40 border border-red-800/50 rounded flex items-start gap-2 text-xs text-red-300 font-sans">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <span className="whitespace-pre-wrap leading-relaxed">{importError}</span>
              </div>
            )}

            {/* Avatar Upload Container (Globally available for step 2) */}
            <div className="bg-[#181a1c]/80 border border-gray-800 p-4 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-4 font-sans">
              <div className="flex items-center gap-3">
                {customAvatar ? (
                  <div className="relative w-14 h-14 bg-black/60 rounded-full border border-[#c1a067] overflow-hidden group">
                    <img src={customAvatar} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    <button
                      type="button"
                      onClick={() => setCustomAvatar("")}
                      className="absolute inset-0 bg-black/80 text-red-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-200"
                      title="清除头像"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <div className="w-14 h-14 bg-black/40 border border-[#c1a067]/20 rounded-full flex items-center justify-center text-gray-500">
                    <User className="w-7 h-7 text-gray-600" />
                  </div>
                )}
                <div>
                  <h4 className="text-xs font-bold text-[#c1a067] uppercase tracking-wider">上传调查员肖像证件照</h4>
                  <p className="text-[10px] text-gray-500 mt-0.5">本地存储在会话级别，不涉及对端隐私数据存储，未上传时自动以名字首字呈现</p>
                </div>
              </div>

              <div>
                <label className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-black hover:bg-[#c1a067]/10 border border-[#c1a067]/50 text-[#c1a067] text-xs font-sans rounded transition duration-200">
                  <Upload className="w-3.5 h-3.5" />
                  <span>上传肖像图片 (JPG/PNG)</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleAvatarFileChange} 
                    className="hidden" 
                  />
                </label>
              </div>
            </div>

            {/* SUB-FORMS */}
            {mode === "choose" ? (
              /* PRESET SELECTION PANEL */
              <motion.div 
                key="presets-subflow"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6 animate-none"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {activePresets.map((preset, index) => (
                    <div 
                      id={`preset-${index}-card`}
                      key={preset.name + "-" + index}
                      onClick={() => setSelectedPresetIndex(index)}
                      className={`p-4 rounded cursor-pointer border transition hover:bg-black/40 text-left relative flex flex-col justify-between ${
                        selectedPresetIndex === index 
                          ? "border-[#c1a067] bg-black/60 shadow-[0_0_15px_rgba(193,160,103,0.15)]" 
                          : "border-transparent bg-[#1a1c1d]/50"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] text-[#c1a067] font-mono uppercase tracking-wider">PRESET INVESTIGATOR</span>
                          {selectedPresetIndex === index && <Check className="w-3.5 h-3.5 text-[#c1a067]" />}
                        </div>
                        <div className="text-md font-bold text-gray-100 line-clamp-1">{preset.name}</div>
                        <div className="flex items-center gap-1.5 text-xs text-[#c1a067] font-sans mt-0.5 mb-2 line-clamp-1">
                          <span>{preset.occupation}</span>
                          <span className="text-gray-600">•</span>
                          <span className="text-gray-350">{preset.gender || "男"} · {preset.age || 30}岁</span>
                        </div>
                        
                        {(preset as any).overview && (
                          <div className="text-[10px] text-gray-400 font-sans italic line-clamp-3 leading-relaxed mb-3 bg-black/30 p-2 rounded border border-gray-900 leading-normal select-text">
                            {(preset as any).overview}
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="space-y-1 mb-3 bg-black/25 p-1.5 rounded text-[10.5px] font-sans">
                          <div className="flex justify-between text-gray-400">
                            <span>HP: <span className="text-red-400 font-semibold">{preset.hp}</span></span>
                            <span>MP: <span className="text-blue-400 font-semibold">{preset.mp}</span></span>
                            <span>SAN: <span className="text-green-400 font-semibold">{preset.san}</span></span>
                            <span>LUC: <span className="text-yellow-400 font-semibold">{(preset.attributes as any).luck}</span></span>
                          </div>
                        </div>

                        <div className="text-xs text-gray-450 space-y-0.5 font-sans border-t border-gray-800/60 pt-2">
                          <div className="text-[#c1a067]/80 text-[9px] font-mono tracking-widest uppercase mb-1 font-bold">精要技术特长</div>
                          {Object.entries(preset.skills).filter(([s]) => s !== "克苏鲁神话").slice(0, 3).map(([s, val]) => (
                            <div key={s} className="flex justify-between items-center text-[10.5px]">
                              <span>• {s}</span>
                              <span className="font-mono text-gray-350 font-semibold">{val}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Detailed display card */}
                <div className="bg-[#181a1c] border border-gray-800 p-5 rounded-lg grid grid-cols-1 md:grid-cols-2 gap-6 font-sans">
                  <div>
                    <h4 className="text-sm font-semibold text-[#c1a067] mb-2 font-sans border-b border-gray-800 pb-1">调查员属性基础值</h4>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {[
                        { label: "力量 STR", val: activePresets[selectedPresetIndex]?.attributes.str || 50 },
                        { label: "体质 CON", val: activePresets[selectedPresetIndex]?.attributes.con || 50 },
                        { label: "体型 SIZ", val: activePresets[selectedPresetIndex]?.attributes.siz || 50 },
                        { label: "敏捷 DEX", val: activePresets[selectedPresetIndex]?.attributes.dex || 50 },
                        { label: "外貌 APP", val: activePresets[selectedPresetIndex]?.attributes.app || 50 },
                        { label: "智力 INT", val: activePresets[selectedPresetIndex]?.attributes.int || 50 },
                        { label: "意志 POW", val: activePresets[selectedPresetIndex]?.attributes.pow || 50 },
                        { label: "教育 EDU", val: activePresets[selectedPresetIndex]?.attributes.edu || 50 },
                        { label: "幸运 LUCK", val: activePresets[selectedPresetIndex]?.attributes.luck || 50 }
                      ].map((attr) => (
                        <div key={attr.label} className="bg-black/30 p-2 rounded text-center">
                          <div className="text-[10px] text-gray-400">{attr.label}</div>
                          <div className="text-sm font-mono font-bold text-gray-200 mt-1">{attr.val}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-[#c1a067] mb-2 font-sans border-b border-gray-800 pb-1">专业技能面板</h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-gray-300">
                      {Object.entries(activePresets[selectedPresetIndex]?.skills || {}).filter(([s]) => s !== "克苏鲁神话").map(([s, val]) => (
                        <div key={s} className="flex justify-between items-center bg-black/20 px-2 py-1 rounded">
                          <span className="text-gray-400 font-sans">{s}</span>
                          <span className="font-mono font-bold text-[#c1a067]">{val}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-700 text-xs font-sans rounded"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> 返回修改模组年代
                  </button>

                  <button 
                    id="presets-submit-btn"
                    type="button"
                    onClick={handleSelectPreset}
                    className="px-10 py-3 bg-[#c1a067] text-black font-semibold tracking-wider rounded transition-all hover:bg-[#d5b57d] active:scale-95 text-xs uppercase shadow-lg shadow-[#c1a067]/20"
                  >
                    确认角色数据并下一步
                  </button>
                </div>
              </motion.div>
            ) : (
              /* CUSTOM PC SETUP DESIGN */
              <motion.div 
                key="custom-subflow"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div className="grid grid-cols-4 max-md:grid-cols-2 max-sm:grid-cols-1 gap-4">
                  <div className="col-span-1 max-md:col-span-2 max-sm:col-span-1">
                    <label className="block text-xs font-semibold text-[#c1a067] uppercase tracking-wider mb-2">角色名称</label>
                    <input
                      id="custom-name-input"
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="填写名字（如：安德森 / 时臣）..."
                      className="w-full bg-black/40 border border-gray-800 rounded p-2.5 text-gray-200 placeholder-gray-650 focus:outline-none focus:border-[#c1a067] text-sm font-sans"
                    />
                  </div>
                  <div className="col-span-1 max-md:col-span-2 max-sm:col-span-1">
                    <label className="block text-xs font-semibold text-[#c1a067] uppercase tracking-wider mb-2">
                      角色职业（{customOccupationId ? "标准模板" : "自拟"}）
                    </label>
                    <select
                      id="custom-occupation-select"
                      value={customOccupationId}
                      onChange={(e) => setCustomOccupationId(e.target.value)}
                      className="w-full bg-[#161719] border border-gray-800 rounded p-2.5 text-gray-200 focus:outline-none focus:border-[#c1a067] text-sm font-sans"
                    >
                      <option value="">— 自拟（使用下方文本） —</option>
                      {getOccupations(selectedEra).map((occ) => (
                        <option key={occ.id} value={occ.id}>{occ.nameZh}</option>
                      ))}
                    </select>
                    {!customOccupationId && (
                      <input
                        id="custom-occupation-freetext"
                        type="text"
                        value={customOccupationFreeText}
                        onChange={(e) => setCustomOccupationFreeText(e.target.value)}
                        placeholder="例如: SCP特工 / 圣堂教会代行老兵 / 本地探长"
                        className="mt-1.5 w-full bg-black/40 border border-gray-800 rounded p-2.5 text-gray-200 placeholder-gray-650 focus:outline-none focus:border-[#c1a067] text-sm font-sans"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#c1a067] uppercase tracking-wider mb-2">性别</label>
                    <select
                      id="custom-gender-select"
                      value={customGender}
                      onChange={(e) => setCustomGender(e.target.value)}
                      className="w-full bg-[#161719] border border-gray-800 rounded p-2.5 text-gray-200 focus:outline-none focus:border-[#c1a067] text-sm font-sans"
                    >
                      <option value="男">男 (Male)</option>
                      <option value="女">女 (Female)</option>
                      <option value="未详">未详 (Unknown)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#c1a067] uppercase tracking-wider mb-2">年龄</label>
                    <input
                      id="custom-age-input"
                      type="number"
                      min={10}
                      max={100}
                      value={customAge}
                      onChange={(e) => setCustomAge(parseInt(e.target.value) || 30)}
                      className="w-full bg-black/40 border border-gray-800 rounded p-2.5 text-gray-200 focus:outline-none focus:border-[#c1a067] text-sm font-sans font-mono"
                    />
                  </div>
                </div>

                {/* 阶段 6 新增：身份 / 国籍 / 居住地 / 母语 / 信用评级 */}
                <div className="grid grid-cols-5 max-lg:grid-cols-3 max-sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#c1a067] uppercase tracking-wider mb-2">角色身份</label>
                    <input
                      id="custom-identity-input"
                      type="text"
                      value={customIdentity}
                      onChange={(e) => setCustomIdentity(e.target.value)}
                      placeholder="自由文本"
                      className="w-full bg-black/40 border border-gray-800 rounded p-2.5 text-gray-200 placeholder-gray-650 focus:outline-none focus:border-[#c1a067] text-sm font-sans"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#c1a067] uppercase tracking-wider mb-2">国籍</label>
                    <input
                      id="custom-nationality-input"
                      type="text"
                      value={customNationality}
                      onChange={(e) => setCustomNationality(e.target.value)}
                      placeholder="如：英国 / 中国"
                      className="w-full bg-black/40 border border-gray-800 rounded p-2.5 text-gray-200 placeholder-gray-650 focus:outline-none focus:border-[#c1a067] text-sm font-sans"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#c1a067] uppercase tracking-wider mb-2">居住地</label>
                    <input
                      id="custom-residence-input"
                      type="text"
                      value={customResidence}
                      onChange={(e) => setCustomResidence(e.target.value)}
                      placeholder="自由文本"
                      className="w-full bg-black/40 border border-gray-800 rounded p-2.5 text-gray-200 placeholder-gray-650 focus:outline-none focus:border-[#c1a067] text-sm font-sans"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#c1a067] uppercase tracking-wider mb-2">母语</label>
                    <input
                      id="custom-mother-tongue-input"
                      type="text"
                      value={customMotherTongue}
                      onChange={(e) => setCustomMotherTongue(e.target.value)}
                      placeholder={`如：英语（基础值 ${customAttrs.edu}）`}
                      className="w-full bg-black/40 border border-gray-800 rounded p-2.5 text-gray-200 placeholder-gray-650 focus:outline-none focus:border-[#c1a067] text-sm font-sans"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#c1a067] uppercase tracking-wider mb-2">信用评级 (0–99)</label>
                    <input
                      id="custom-credit-rating-input"
                      type="number"
                      min={0}
                      max={99}
                      value={customCreditRating}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        setCustomCreditRating(Number.isFinite(v) ? Math.max(0, Math.min(99, v)) : 0);
                      }}
                      className="w-full bg-black/40 border border-gray-800 rounded p-2.5 text-gray-200 focus:outline-none focus:border-[#c1a067] text-sm font-sans font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#c1a067] uppercase tracking-wider mb-2 flex items-center justify-between">
                    <span>角色概述 / 生平背景</span>
                    <span className="text-[10px] text-[#c1a067]/70 font-normal">输入设定，让 Keeper 智能自动分配 CoC 规则数值</span>
                  </label>
                  <textarea 
                    id="custom-overview-textarea"
                    value={customOverview}
                    onChange={(e) => setCustomOverview(e.target.value)}
                    placeholder="请输入角色的背景简要、长相、携带物或家族。例如：'一名退役的圣堂教会黑色代行者，在一次针对死徒的清剿中负伤。性格冷酷沉稳，体魄强健，擅长近身格斗，并随身配有一把秘银短枪。退役后开始作为SCP基金会的临时雇员提供顾问。'"
                    rows={4}
                    className="w-full bg-black/40 border border-gray-800 rounded p-2.5 text-gray-200 placeholder-gray-650 focus:outline-none focus:border-[#c1a067] text-sm leading-relaxed font-sans resize-none"
                  />
                </div>

                {generationError && (
                  <div className="p-3 bg-red-950/40 border border-red-800/50 rounded flex items-center gap-2 text-xs text-red-300">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <span>{generationError}</span>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    id="generate-stats-from-overview-btn"
                    type="button"
                    onClick={generateStatsFromOverview}
                    disabled={isGeneratingStats || !customOverview.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#c1a067]/10 border border-[#c1a067]/60 text-[#c1a067] font-sans text-xs rounded hover:bg-[#c1a067]/20 transition active:scale-95 disabled:opacity-40"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isGeneratingStats ? "animate-spin" : ""}`} />
                    {isGeneratingStats ? "KP 正按大纲裁定属性中..." : "根据概述生成数值并分配"}
                  </button>
                </div>

                {/* Manual stats controls */}
                <div className="bg-[#181a1c] border border-gray-800 p-5 rounded-lg space-y-4 font-sans">
                  <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                    <span className="text-sm font-semibold text-[#c1a067]">八维属性精密特调（CoC 基准值）</span>
                    <button
                      id="roll-stats-btn"
                      type="button"
                      onClick={rollStats}
                      disabled={isRolling}
                      className="flex items-center gap-1.5 px-3 py-1 bg-black border border-[#c1a067]/40 text-[#c1a067] font-mono text-xs rounded hover:bg-[#c1a067]/15 transition active:scale-95 disabled:opacity-50"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${isRolling ? "animate-spin" : ""}`} /> 随机宿命投骰 (3D6 Roll)
                    </button>
                  </div>

                  <div className="grid grid-cols-3 max-sm:grid-cols-2 gap-3 text-xs">
                    {[
                      { field: "str", label: "力量 STR", desc: "肌肉、推进重物能力" },
                      { field: "con", label: "体质 CON", desc: "抵抗极寒和负面抗性" },
                      { field: "siz", label: "体型 SIZ", desc: "体格、影响最大HP" },
                      { field: "dex", label: "敏捷 DEX", desc: "反应、敏捷度及先攻" },
                      { field: "app", label: "外貌 APP", desc: "社交印象与惊艳度" },
                      { field: "int", label: "智力 INT", desc: "分析力、记忆力与灵感" },
                      { field: "pow", label: "意志 POW", desc: "心智精神、防御力及SAN" },
                      { field: "edu", label: "教育 EDU", desc: "经验阅历、技能点广度" },
                      { field: "luck", label: "幸运 LUCK", desc: "厄运化解，危机判定" }
                    ].map((item) => {
                      const key = item.field as keyof CharacterAttributes;
                      return (
                        <div key={item.field} className="bg-black/40 border border-gray-850 p-2 rounded relative">
                          <div className="text-[10px] text-[#c1a067] font-semibold">{item.label}</div>
                          <input 
                            id={`custom-attr-${key}`}
                            type="number"
                            value={customAttrs[key]}
                            onChange={(e) => {
                              const v = Math.max(15, Math.min(99, parseInt(e.target.value) || 50));
                              setCustomAttrs(prev => ({ ...prev, [key]: v }));
                            }}
                            className="w-full bg-transparent text-lg font-mono text-gray-200 mt-1 focus:outline-none font-bold text-center"
                          />
                          <div className="text-[9px] text-gray-500 font-sans mt-0.5 text-center">{item.desc}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-3 gap-3 bg-black/40 p-3 rounded border border-gray-800 text-xs">
                    <div className="text-center">
                      <span className="text-gray-400 block">生命值 HP (CON+SIZ/10):</span>
                      <span className="font-mono text-red-400 text-sm font-semibold">{Math.floor((customAttrs.con + customAttrs.siz) / 10)}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-gray-400 block">魔法值 MP (POW/5):</span>
                      <span className="font-mono text-blue-400 text-sm font-semibold">{Math.floor(customAttrs.pow / 5)}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-gray-400 block">理智值 SAN:</span>
                      <span className="font-mono text-emerald-300 text-sm font-semibold">{customAttrs.pow}</span>
                    </div>
                  </div>

                  {/* 阶段 6 新增派生层：闪避（DEX/2）+ 母语（EDU）+ 信用评级 */}
                  <div className="grid grid-cols-3 gap-3 bg-black/40 p-3 rounded border border-gray-800 text-xs">
                    <div className="text-center">
                      <span className="text-gray-400 block">闪避 Dodge (DEX/2):</span>
                      <span className="font-mono text-cyan-300 text-sm font-semibold">{dodgeOf(customAttrs.dex)}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-gray-400 block">母语 (EDU):</span>
                      <span className="font-mono text-amber-200 text-sm font-semibold">{motherTongueValue(customAttrs.edu)}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-gray-400 block">信用评级:</span>
                      <span className="font-mono text-[#c1a067] text-sm font-semibold">{customCreditRating}</span>
                    </div>
                  </div>

                  {/* 阶段 9 派生：起始现金 + 生活水准（CR 派生，创建期不可调） */}
                  <div className="grid grid-cols-2 gap-3 bg-black/40 p-3 rounded border border-gray-800 text-xs">
                    <div className="text-center">
                      <span className="text-gray-400 block">
                        起始现金 (CR × {selectedEra === "modern" ? "$20" : "$1"}):
                      </span>
                      <span className="font-mono text-[#c1a067] text-sm font-semibold">
                        ${startingCashOf(customCreditRating, selectedEra)}
                      </span>
                      <span className="text-[9px] text-gray-500 font-sans block mt-0.5">
                        CR {customCreditRating} × {selectedEra === "modern" ? "$20" : "$1"}
                      </span>
                    </div>
                    <div className="text-center">
                      <span className="text-gray-400 block">生活水准:</span>
                      <span className="font-mono text-amber-200 text-sm font-semibold">
                        {livingStandardLabel(livingStandardOf(customCreditRating))}
                      </span>
                      <span className="text-[9px] text-gray-500 font-sans block mt-0.5">
                        资产 / 不动产由 KP 维护
                      </span>
                    </div>
                  </div>

                  {/* 神秘接触占位：创建期空，KP 在游戏中通过神话事件下发 */}
                  <details className="bg-black/30 rounded border border-gray-850 text-xs font-sans">
                    <summary className="cursor-pointer px-3 py-2 text-[#c1a067]/80 hover:text-[#c1a067] select-none flex items-center justify-between">
                      <span>◎ 神秘接触档案 (Mythic Encounters)</span>
                      <span className="text-[10px] text-gray-500 font-mono">创建期为空 · KP 下发</span>
                    </summary>
                    <div className="px-3 py-2.5 grid grid-cols-2 max-sm:grid-cols-1 gap-2 text-[10px] text-gray-500 leading-relaxed">
                      <div>· 神话著作：未接触</div>
                      <div>· 习得法术：未掌握</div>
                      <div>· 神器器物：未持有</div>
                      <div>· 接触实体：无记录</div>
                    </div>
                  </details>
                </div>

                {/* 阶段 7：槽位化技能区 */}
                <div className="bg-[#181a1c] border border-gray-800 p-5 rounded-lg space-y-4 font-sans">
                  <div className="flex items-center justify-between border-b border-gray-800 pb-2 gap-3 flex-wrap">
                    <h4 className="text-sm font-semibold text-[#c1a067]">技能分配（职业槽 8 + 兴趣槽 4）</h4>
                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        id="randomize-skills-btn"
                        type="button"
                        onClick={() =>
                          setSkillDraft(
                            randomizeSkillDraft(occupationConstraints, customAttrs, selectedEra),
                          )
                        }
                        className="flex items-center gap-1.5 px-3 py-1 bg-black border border-[#c1a067]/40 text-[#c1a067] font-mono text-xs rounded hover:bg-[#c1a067]/15 transition active:scale-95"
                      >
                        <Sparkles className="w-3.5 h-3.5" /> 随机宿命技能分配
                      </button>
                      <div className="flex items-center gap-3 text-[11px] font-mono">
                        <span className={occSpent > pointPools.occupation ? "text-red-400" : "text-gray-400"}>
                          职业池: <span className="text-gray-200">{occSpent}</span> / {pointPools.occupation}
                        </span>
                        <span className="text-gray-600">·</span>
                        <span className={intSpent > pointPools.interest ? "text-red-400" : "text-gray-400"}>
                          兴趣池: <span className="text-gray-200">{intSpent}</span> / {pointPools.interest}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-relaxed">
                    职业池 = EDU × 4 = {customAttrs.edu} × 4 = {pointPools.occupation}；兴趣池 = INT × 2 = {customAttrs.int} × 2 = {pointPools.interest}。
                    每槽分配的点数为<strong className="text-[#c1a067]/90">额外加成</strong>，槽位最终值 = 技能基础值 + 该槽位分配点数。
                  </p>

                  {/* 职业槽 */}
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wider text-gray-500">
                      职业槽 · {customOccupationId ? findOccupation(selectedEra, customOccupationId)?.nameZh : "自拟（全自由）"}
                    </div>
                    {skillDraft.occupation.map((slot, idx) => (
                      <SlotRow
                        key={`occ-${idx}-${constraintSignature.length}`}
                        slot={slot}
                        era={selectedEra}
                        slotLabel={`职业 #${idx + 1}`}
                        constraintHint={describeConstraint(slot.constraint)}
                        candidates={getSlotCandidates(slot.constraint, selectedEra)}
                        isDuplicate={!!slot.picked && duplicateKeys.has(selectionKey(slot.picked))}
                        onPick={(sel) => setSlotPicked("occupation", idx, sel)}
                        onPoints={(p) => setSlotPoints("occupation", idx, p)}
                      />
                    ))}
                  </div>

                  {/* 兴趣槽 */}
                  <div className="space-y-2 pt-2 border-t border-gray-850">
                    <div className="text-[11px] uppercase tracking-wider text-gray-500">兴趣槽 · 全自由（INT × 2 池）</div>
                    {skillDraft.interest.map((slot, idx) => (
                      <SlotRow
                        key={`int-${idx}`}
                        slot={slot}
                        era={selectedEra}
                        slotLabel={`兴趣 #${idx + 1}`}
                        constraintHint="自由"
                        candidates={getSlotCandidates(slot.constraint, selectedEra)}
                        isDuplicate={!!slot.picked && duplicateKeys.has(selectionKey(slot.picked))}
                        onPick={(sel) => setSlotPicked("interest", idx, sel)}
                        onPoints={(p) => setSlotPoints("interest", idx, p)}
                      />
                    ))}
                  </div>

                  {duplicateKeys.size > 0 && (
                    <div className="text-[11px] text-amber-400/80 leading-relaxed">
                      ⚠ 有重复选择的技能（红框标记）。提交时会取最大值合并，不会重复加点；建议手动调整以充分利用槽位。
                    </div>
                  )}
                </div>

                {/* 阶段 9：装备与随身物品（House Rule 8 槽，武器 / 物品共用） */}
                <div className="bg-[#181a1c] border border-gray-800 p-5 rounded-lg space-y-4 font-sans">
                  <div className="flex items-center justify-between border-b border-gray-800 pb-2 gap-3 flex-wrap">
                    <h4 className="text-sm font-semibold text-[#c1a067]">装备与随身物品（武器 / 物品 8 槽）</h4>
                    <div className="text-[11px] font-mono text-gray-400">
                      已用: <span className="text-gray-200">
                        {inventory.filter((e) => (e.kind === "weapon") || (e.kind === "item" && e.text.trim() !== "")).length}
                      </span> / {INVENTORY_SLOT_COUNT}
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-relaxed">
                    随身上限 8 槽（House Rule，CoC 7e 原版无此限制）。武器与物品共用配额；空槽位不需要填写。
                    武器栏只显示名称，伤害 / 射程 / 装弹 / 故障值由数据表派生；创建期 ammo 自动写入最大值，跑团时由 KP 维护。
                  </p>
                  <div className="space-y-2">
                    {inventory.map((entry, idx) => (
                      <InventorySlotRow
                        key={`inv-${idx}`}
                        index={idx}
                        entry={entry}
                        era={selectedEra}
                        onChange={(next) =>
                          setInventory((prev) => prev.map((e, i) => (i === idx ? next : e)))
                        }
                      />
                    ))}
                  </div>
                </div>

                <div className="flex justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-700 text-xs font-sans rounded"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> 返回修改年代样式
                  </button>

                  <button 
                    id="custom-create-submit-btn"
                    type="button"
                    onClick={handleCreateCustom}
                    disabled={isRolling || isGeneratingStats}
                    className="px-10 py-3 bg-[#c1a067] text-black font-semibold tracking-wider rounded transition-all hover:bg-[#d5b57d] active:scale-95 text-xs uppercase shadow-lg shadow-[#c1a067]/20 disabled:opacity-50"
                  >
                    确认自定义PC并下一步
                  </button>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* ======================================= STEP 3: BOTH MODULE & CHARACTER VERIFICATION ======================================= */}
        {currentStep === 3 && reviewCharacter && (
          <motion.div
            key="step-3-confirmation"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            <div className="text-center mb-6">
              <span className="text-[#c1a067] font-mono font-semibold tracking-widest text-[10px] uppercase px-2.5 py-1 bg-[#c1a067]/5 border border-[#c1a067]/20 rounded-full mb-3 inline-block">
                FINAL EXPERIMENT DOSSIER VERIFICATION
              </span>
              <h2 className="font-sans text-3xl font-bold tracking-widest text-[#c1a067] uppercase drop-shadow-[0_0_8px_rgba(193,160,103,0.15)]">
                - 事件与调查员档案总确认 -
              </h2>
              <p className="text-gray-400 text-xs font-mono mt-2">
                VERIFY THE CO-FABRICATED CONTEXT AND CHARACTER CARD BEFORE LAUNCH
              </p>
            </div>

            {/* Side-by-Side Review Grid */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
              
              {/* Left Column: Module Details */}
              <div className="md:col-span-4 bg-[#141617] border border-[#c1a067]/20 rounded-lg p-5 flex flex-col justify-between font-sans">
                <div className="space-y-4 flex flex-col flex-1 min-h-0">
                  <div className="border-b border-gray-800 pb-2">
                    <span className="text-[10px] text-[#c1a067]/60 font-mono tracking-wider uppercase block">背景时空 · 年代纪元</span>
                    <span className="text-xs font-bold text-gray-200 uppercase mt-0.5 block">
                      {reviewCharacter.background === "1920s" ? "🕰 1920年代爵士旧日" : "📡 21世纪现代霓虹高墙"}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-gray-400 font-mono block">架构模组标题</span>
                    <div className="text-md font-bold text-[#c1a067] mt-1 font-sans">
                      {moduleOutline?.title || "《未解明之超自然重合事件》"}
                    </div>
                  </div>

                  <div className="space-y-1 bg-black/30 p-3 rounded.lg border border-gray-850 text-xs text-gray-300 leading-relaxed font-sans flex flex-col flex-1 min-h-0">
                    <span className="text-[9px] font-mono font-bold text-[#c1a067] block uppercase border-b border-gray-800 pb-1 mb-1.5">
                      模组不剧透序幕 (Background Hint)
                    </span>
                    <div className="italic text-gray-350 select-text overflow-y-auto custom-scrollbar pr-1 flex-1 min-h-0">
                      {moduleOutline?.intro || "在世界阴暗潮湿的边缘，不可名状之神秘开始剧烈渗透，时钟塔与SCP基金会的目光都已被这诡谲的核心场景吸引。"}
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3.5 border-t border-gray-800 text-[10px] text-gray-500 font-sans space-y-1">
                  <div>主持人: Keeper (简称 KP)</div>
                  <div>玩家角色: Player Character (简称 PC)</div>
                  <div>正在载入深渊会话通道...</div>
                </div>
              </div>

              {/* Right Column: Complete Investigator Sheet Verification */}
              <div className="md:col-span-8 bg-[#161819] border border-[#c1a067]/20 rounded-lg p-5 font-sans relative overflow-hidden flex flex-col justify-between shadow-lg">
                
                {/* Visual Header / Avatar Banner */}
                <div className="flex flex-col sm:flex-row items-center gap-4 bg-black/45 border border-gray-850 p-4 rounded-lg mb-4">
                  {reviewCharacter.avatar ? (
                    <img src={reviewCharacter.avatar} className="w-16 h-16 rounded-full border border-[#c1a067] object-cover bg-black/20" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-[#c1a067]/15 border border-[#c1a067]/30 flex items-center justify-center font-bold text-[#c1a067] text-2xl font-sans">
                      {reviewCharacter.name.trim().charAt(0).toUpperCase()}
                    </div>
                  )}

                  <div className="text-center sm:text-left">
                    <h3 className="text-lg font-bold text-gray-100 flex items-center gap-1.5 justify-center sm:justify-start">
                      {reviewCharacter.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1 justify-center sm:justify-start font-sans">
                      <div className="text-xs text-[#c1a067] bg-[#c1a067]/10 px-2.5 py-0.5 rounded">
                        {reviewCharacter.occupation}
                      </div>
                      <div className="text-xs text-gray-400 bg-gray-900 px-2.5 py-0.5 rounded border border-gray-800">
                        性别: <span className="text-[#c1a067] font-medium">{reviewCharacter.gender || "男"}</span>
                      </div>
                      <div className="text-xs text-gray-400 bg-gray-900 px-2.5 py-0.5 rounded border border-gray-800">
                        年龄: <span className="text-[#c1a067] font-medium">{reviewCharacter.age || 30} 岁</span>
                      </div>
                      {reviewCharacter.identity && (
                        <div className="text-xs text-gray-400 bg-gray-900 px-2.5 py-0.5 rounded border border-gray-800">
                          身份: <span className="text-[#c1a067] font-medium">{reviewCharacter.identity}</span>
                        </div>
                      )}
                      {reviewCharacter.nationality && (
                        <div className="text-xs text-gray-400 bg-gray-900 px-2.5 py-0.5 rounded border border-gray-800">
                          国籍: <span className="text-[#c1a067] font-medium">{reviewCharacter.nationality}</span>
                        </div>
                      )}
                      {reviewCharacter.residence && (
                        <div className="text-xs text-gray-400 bg-gray-900 px-2.5 py-0.5 rounded border border-gray-800">
                          居住地: <span className="text-[#c1a067] font-medium">{reviewCharacter.residence}</span>
                        </div>
                      )}
                      {reviewCharacter.motherTongue && (
                        <div className="text-xs text-gray-400 bg-gray-900 px-2.5 py-0.5 rounded border border-gray-800">
                          母语: <span className="text-[#c1a067] font-medium">{reviewCharacter.motherTongue} ({motherTongueValue(reviewCharacter.attributes.edu)})</span>
                        </div>
                      )}
                      {typeof reviewCharacter.creditRating === "number" && (
                        <div className="text-xs text-gray-400 bg-gray-900 px-2.5 py-0.5 rounded border border-gray-800">
                          信用评级: <span className="text-[#c1a067] font-medium">{reviewCharacter.creditRating}</span>
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">
                      {mode === "choose" ? "经典预设角色卡模板" : "自定义构建的调查员角色设定卡"}
                    </p>
                  </div>
                </div>

                {/* Quantitative statistics panel */}
                <div className="space-y-4">
                  
                  {/* Visual Vitals Bar */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-[#1c1415] border border-red-950/40 p-2 text-center rounded">
                      <div className="flex items-center justify-center gap-1 text-xs text-red-400 font-sans">
                        <Heart className="w-3.5 h-3.5 text-red-500 fill-current" />
                        HP 生命
                      </div>
                      <div className="font-mono text-base font-bold mt-1 text-red-400">
                        {reviewCharacter.hp} <span className="text-xs text-red-650">/{reviewCharacter.maxHp}</span>
                      </div>
                    </div>

                    <div className="bg-[#14181f] border border-blue-950/40 p-2 text-center rounded">
                      <div className="flex items-center justify-center gap-1 text-xs text-blue-400 font-sans">
                        <Zap className="w-3.5 h-3.5 text-blue-500 fill-current" />
                        MP 魔法
                      </div>
                      <div className="font-mono text-base font-bold mt-1 text-blue-400">
                        {reviewCharacter.mp} <span className="text-xs text-blue-650">/{reviewCharacter.maxMp}</span>
                      </div>
                    </div>

                    <div className="bg-[#121915] border border-emerald-900/30 p-2 text-center rounded">
                      <div className="flex items-center justify-center gap-1 text-xs text-emerald-400 font-sans">
                        <Eye className="w-3.5 h-3.5 text-emerald-500 fill-current" />
                        SAN 理智值
                      </div>
                      <div className="font-mono text-base font-bold mt-1 text-emerald-400">
                        {reviewCharacter.san} <span className="text-xs text-emerald-600">/99</span>
                      </div>
                    </div>
                  </div>

                  {/* Attributes Grid */}
                  <div>
                    <h4 className="text-[10px] font-semibold text-[#c1a067] mb-2 font-sans tracking-wider uppercase border-b border-[#c1a067]/10 pb-1">
                      ◎ 八维属性基础(D100)
                    </h4>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                      {[
                        { l: "力量 STR", v: reviewCharacter.attributes.str },
                        { l: "体质 CON", v: reviewCharacter.attributes.con },
                        { l: "体型 SIZ", v: reviewCharacter.attributes.siz },
                        { l: "敏捷 DEX", v: reviewCharacter.attributes.dex },
                        { l: "外貌 APP", v: reviewCharacter.attributes.app },
                        { l: "智力 INT", v: reviewCharacter.attributes.int },
                        { l: "意志 POW", v: reviewCharacter.attributes.pow },
                        { l: "教育 EDU", v: reviewCharacter.attributes.edu },
                        { l: "幸运 LUCK", v: reviewCharacter.attributes.luck }
                      ].map((item) => (
                        <div key={item.l} className="bg-black/45 p-1.5 rounded text-center border border-gray-850">
                          <span className="text-[9px] text-gray-500 block leading-tight">{item.l}</span>
                          <span className="text-sm font-mono font-bold text-gray-300 block mt-0.5">{item.v}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Skills Grid */}
                  <div>
                    <h4 className="text-[10px] font-semibold text-[#c1a067] mb-2 font-sans tracking-wider uppercase border-b border-[#c1a067]/10 pb-1">
                      ◎ 已掌握特长技能及技能成功概率
                    </h4>
                    <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-2 text-xs">
                      {Object.entries(reviewCharacter.skills).map(([sk, val]) => (
                        <div key={sk} className="flex justify-between items-center bg-black/20 px-2.5 py-1.5 rounded border border-gray-850/60">
                          <span className="text-gray-300 font-sans">
                            <span className="text-[#c1a067] mr-1">•</span>{sk}
                          </span>
                          <span className="font-mono font-bold text-[#c1a067]">{val}%</span>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>

              </div>

            </div>

            {/* Action Group */}
            <div className="flex flex-col sm:flex-row justify-center items-center gap-4 pt-5 border-t border-[#c1a067]/10">
              <button
                id="dossier-back-btn"
                type="button"
                onClick={() => setCurrentStep(2)}
                className="flex items-center gap-2 px-6 py-2.5 bg-black/40 border border-[#c1a067]/40 text-[#c1a067] font-semibold text-xs tracking-wider rounded transition-all hover:bg-[#c1a067]/10 active:scale-95 uppercase font-sans"
              >
                <ArrowLeft className="w-4 h-4" /> 返回重整调查员
              </button>

              <button
                id="dossier-download-btn"
                type="button"
                onClick={handleDownloadCharacterCard}
                disabled={isDownloading}
                className="flex items-center gap-2 px-6 py-2.5 bg-black/80 border border-[#c1a067] text-[#c1a067] font-semibold text-xs tracking-wider rounded transition-all hover:bg-[#c1a067]/10 active:scale-95 uppercase font-sans disabled:opacity-50"
              >
                <Download className={`w-4 h-4 ${isDownloading ? "animate-bounce" : ""}`} />
                {isDownloading ? "正在编译角色卡..." : "下载调查员角色卡 (.png)"}
              </button>

              <button
                id="dossier-launch-btn"
                type="button"
                onClick={handleLaunchScenario}
                className="flex items-center gap-2 px-10 py-3 bg-[#c1a067] text-black font-semibold text-sm tracking-wider rounded transition-all hover:bg-[#d5b57d] active:scale-95 uppercase shadow-xl shadow-[#c1a067]/20 font-sans"
              >
                确认无误，启动探索模组 <Shield className="w-4 h-4 animate-pulse" />
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}

// =============================================================================
// 阶段 7：槽位行子组件（select + 数字输入；外部样式与本组件其他控件保持一致）
// =============================================================================

interface SlotRowProps {
  slot: SlotState;
  era: "1920s" | "modern";
  slotLabel: string;
  constraintHint: string;
  candidates: ReturnType<typeof getSlotCandidates>;
  isDuplicate: boolean;
  onPick: (sel: SkillSelection | undefined) => void;
  onPoints: (points: number) => void;
}

function SlotRow({ slot, slotLabel, constraintHint, candidates, isDuplicate, onPick, onPoints }: SlotRowProps) {
  const pickedKey = slot.picked ? selectionKey(slot.picked) : "";
  const base = slot.picked ? baseOfSelection(slot.picked) : 0;
  const final = slot.picked ? finalValueOfSlot(slot) : 0;
  const isFixed = candidates.length === 1 && (slot.constraint.kind === "fixedSkill" || slot.constraint.kind === "fixedBranch");

  return (
    <div
      className={`grid grid-cols-12 gap-2 items-center bg-black/30 p-2 rounded border ${
        isDuplicate ? "border-red-700/60" : "border-gray-850"
      } text-xs`}
    >
      <div className="col-span-2 max-sm:col-span-12 text-[10px] text-gray-500 font-mono uppercase tracking-wider">
        <div>{slotLabel}</div>
        <div className="text-[#c1a067]/60 normal-case mt-0.5 truncate" title={constraintHint}>{constraintHint}</div>
      </div>
      <div className="col-span-6 max-sm:col-span-8">
        <select
          value={pickedKey}
          onChange={(e) => {
            const k = e.target.value;
            if (!k) return onPick(undefined);
            const found = candidates.find((c) => selectionKey(c.selection) === k);
            onPick(found?.selection);
          }}
          disabled={isFixed}
          className="w-full bg-[#161719] border border-gray-800 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-[#c1a067] text-xs font-sans disabled:opacity-80 disabled:cursor-not-allowed"
        >
          {!isFixed && <option value="">— 未选 —</option>}
          {candidates.map((c) => (
            <option key={selectionKey(c.selection)} value={selectionKey(c.selection)}>
              {c.nameZh}（{c.base}）
            </option>
          ))}
        </select>
      </div>
      <div className="col-span-2 max-sm:col-span-2 flex items-center gap-1">
        <span className="text-gray-500 font-mono text-[10px]">+</span>
        <input
          type="number"
          min={0}
          max={99}
          value={slot.pointsAllocated}
          onChange={(e) => onPoints(parseInt(e.target.value) || 0)}
          disabled={!slot.picked}
          className="w-full bg-black/40 border border-gray-800 rounded px-1.5 py-1 text-center font-mono text-gray-200 focus:outline-none focus:border-[#c1a067] text-xs disabled:opacity-40"
        />
      </div>
      <div className="col-span-2 max-sm:col-span-2 text-right font-mono text-[11px]">
        {slot.picked ? (
          <>
            <span className="text-gray-500">{base}+{slot.pointsAllocated}=</span>
            <span className="text-[#c1a067] font-semibold">{final}</span>
          </>
        ) : (
          <span className="text-gray-700">—</span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// 阶段 9：装备槽行（左下拉切类型；右侧物品自由文本 / 武器名下拉）
// =============================================================================

interface InventorySlotRowProps {
  index: number;
  entry: InventoryEntry;
  era: "1920s" | "modern";
  onChange: (next: InventoryEntry) => void;
}

function InventorySlotRow({ index, entry, era, onChange }: InventorySlotRowProps) {
  const weaponList = useMemo(() => getWeaponList(era), [era]);
  const weapon = entry.kind === "weapon" ? findWeapon(entry.weaponId) : undefined;

  return (
    <div className="grid grid-cols-12 gap-2 items-center bg-black/30 p-2 rounded border border-gray-850 text-xs">
      <div className="col-span-1 max-sm:col-span-2 text-[10px] text-gray-500 font-mono uppercase tracking-wider text-center">
        #{index + 1}
      </div>
      <div className="col-span-2 max-sm:col-span-4">
        <select
          value={entry.kind}
          onChange={(e) => {
            const kind = e.target.value as "item" | "weapon";
            if (kind === entry.kind) return;
            if (kind === "item") onChange({ kind: "item", text: "" });
            else {
              const first = weaponList[0];
              if (!first) return;
              onChange({ kind: "weapon", weaponId: first.id, ammo: first.maxAmmo });
            }
          }}
          className="w-full bg-[#161719] border border-gray-800 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-[#c1a067] text-xs font-sans"
        >
          <option value="item">物品</option>
          <option value="weapon">武器</option>
        </select>
      </div>
      <div className="col-span-9 max-sm:col-span-6">
        {entry.kind === "item" ? (
          <input
            type="text"
            value={entry.text}
            onChange={(e) => onChange({ kind: "item", text: e.target.value })}
            placeholder="物品 / 工具 / 重要个人物件"
            className="w-full bg-[#161719] border border-gray-800 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-[#c1a067] text-xs font-sans placeholder:text-gray-700"
          />
        ) : (
          <div className="space-y-1">
            <select
              value={entry.weaponId}
              onChange={(e) => {
                const w = findWeapon(e.target.value);
                if (!w) return;
                onChange({ kind: "weapon", weaponId: w.id, ammo: w.maxAmmo });
              }}
              className="w-full bg-[#161719] border border-gray-800 rounded px-2 py-1.5 text-gray-200 focus:outline-none focus:border-[#c1a067] text-xs font-sans"
            >
              {weaponList.map((w) => (
                <option key={w.id} value={w.id}>{w.nameZh}</option>
              ))}
            </select>
            {weapon && (
              <div className="text-[10px] text-gray-500 font-mono px-1">
                {describeWeapon(weapon)}
                {weapon.malfunction && weapon.malfunction < 100 ? ` · 故障 ${weapon.malfunction}+` : ""}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
