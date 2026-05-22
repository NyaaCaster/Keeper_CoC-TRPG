/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { CharacterSheet, CharacterAttributes, CharacterSkills, ApiSettings } from "../types";
import { TEMPLATE_PRESETS } from "../data/presets";
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
  Download
} from "lucide-react";

interface CharacterCreatorProps {
  onComplete: (character: CharacterSheet, features: { typemoon: boolean; scp: boolean }) => void;
  apiSettings: ApiSettings;
}

// Preset Investigators
const CLASSIC_PRESETS: Omit<CharacterSheet, "background">[] = [
  {
    name: "赫尔辛·阿契博尔德 (Helsing)",
    occupation: "时钟塔·现代魔术学科研究员",
    gender: "男",
    age: 26,
    attributes: { str: 45, con: 55, siz: 50, dex: 65, app: 70, int: 80, pow: 75, edu: 85, luck: 60 },
    skills: { "神秘学": 80, "图书馆使用": 75, "侦查": 60, "心理学": 50, "聆听": 50, "拉丁语": 65, "手枪": 20, "克苏鲁神话": 0 },
    hp: 10, maxHp: 10, mp: 15, maxMp: 15, san: 75, maxSan: 75, maxSanLimit: 99, mythos: 0
  },
  {
    name: "卡特外勤特工 (Agent Carter)",
    occupation: "SCP基金会外勤机动特遣队 (MTF)",
    gender: "女",
    age: 31,
    attributes: { str: 75, con: 70, siz: 65, dex: 70, app: 50, int: 70, pow: 60, edu: 60, luck: 55 },
    skills: { "手枪": 75, "侦查": 70, "心理学": 45, "潜行": 65, "聆听": 60, "神秘学": 35, "急救": 50, "克苏鲁神话": 0 },
    hp: 13, maxHp: 13, mp: 12, maxMp: 12, san: 60, maxSan: 60, maxSanLimit: 99, mythos: 0
  },
  {
    name: "柳濑真一 (Prof. Yanase)",
    occupation: "密斯卡托尼克大学民俗考古学家",
    gender: "男",
    age: 52,
    attributes: { str: 40, con: 50, siz: 60, dex: 55, app: 60, int: 75, pow: 80, edu: 80, luck: 70 },
    skills: { "考古学": 75, "历史": 75, "图书馆使用": 70, "神秘学": 60, "侦查": 55, "聆听": 50, "说服": 55, "克苏鲁神话": 0 },
    hp: 11, maxHp: 11, mp: 16, maxMp: 16, san: 80, maxSan: 80, maxSanLimit: 99, mythos: 0
  }
];

// Preset description descriptions to display when reviewing classical presets
const PRESET_OVERVIEWS: Record<string, string> = {
  "赫尔辛·阿契博尔德 (Helsing)": "毕业于伦敦时钟塔的精锐新秀魔术学者，专精于高维以太通道判定和魔术刻印修复，因追查远东地区的狂乱根源而开始搜集非自然异化样本。",
  "卡特外勤特工 (Agent Carter)": "来自SCP基金会机动特遣队 (MTF) 的特级探员，多次参与特异收容失效现场营救。意志如钢，配有精良武器，能在最极端的深渊中保持理性开火。",
  "柳濑真一 (Prof. Yanase)": "著名民俗学及考古学家，毕生致力于考据大洋洲古神庙和禁忌教典。经验博大精深，拥有非凡的古代文献解读直觉与神秘事物抗性。"
};

export default function CharacterCreator({ onComplete, apiSettings }: CharacterCreatorProps) {
  // 3-step preparation flow: 1 = Choose Era & Generate Module Outline, 2 = Select / Customize PC, 3 = Double verify Dossier & Module Intro
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Era Choice state
  const [selectedEra, setSelectedEra] = useState<"1920s" | "modern">("modern");

  // Content Modules Toggle States
  const [featureTypeMoon, setFeatureTypeMoon] = useState<boolean>(true);
  const [featureScp, setFeatureScp] = useState<boolean>(true);

  // Dynamic generated Module Outline
  const [moduleOutline, setModuleOutline] = useState<{
    title: string;
    intro: string;
    recommendedOccupations: string[];
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
  const [customOccupation, setCustomOccupation] = useState("民间神秘事件调查员");
  const [customGender, setCustomGender] = useState("男");
  const [customAge, setCustomAge] = useState<number>(30);
  const [customOverview, setCustomOverview] = useState("");
  const [customAttrs, setCustomAttrs] = useState<CharacterAttributes>({
    str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50
  });
  const [customSkills, setCustomSkills] = useState<CharacterSkills>({
    "侦查": 50, "聆听": 40, "图书馆使用": 40, "神秘学": 30, "心理学": 30, "手枪": 20, "潜行": 25, "说服": 25, "格斗(斗殴)": 25
  });

  const [isRolling, setIsRolling] = useState(false);
  const [isGeneratingStats, setIsGeneratingStats] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Result Character State (for Steps 2 and 3)
  const [reviewCharacter, setReviewCharacter] = useState<CharacterSheet | null>(null);

  const [importError, setImportError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

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
      const selected = moduleOutline.presets.map((p) => {
        if (typeof p === "string") {
          // Find matching predefined template
          const found = TEMPLATE_PRESETS.find(item => item.name === p || item.name.includes(p) || p.includes(item.name));
          if (found) {
            return {
              ...found,
              overview: found.backgroundText || "资深的前线秘仪探求者，协助解析现场古怪迹象。"
            };
          }
          return null;
        } else if (p && typeof p === "object") {
          // Object fallback
          const pObj = p as any;
          const calculatedHp = Math.floor(((pObj.attributes?.con || 50) + (pObj.attributes?.siz || 50)) / 10);
          const calculatedMp = Math.floor((pObj.attributes?.pow || 50) / 5);
          const calculatedSan = pObj.attributes?.pow || 50;

          // Safe skills parser: maps Array<{name: string, value: number}> to Record<string, number>
          let skillsObj: Record<string, number> = {};
          if (pObj.skills && Array.isArray(pObj.skills)) {
            pObj.skills.forEach((s: any) => {
              if (s && typeof s === "object" && s.name && s.value !== undefined) {
                skillsObj[s.name] = Number(s.value);
              } else if (typeof s === "string") {
                skillsObj[s] = 40;
              }
            });
          } else if (pObj.skills && typeof pObj.skills === "object") {
            skillsObj = pObj.skills;
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
        }
        return null;
      }).filter((x): x is (CharacterSheet & { overview?: string }) => x !== null);

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

  // Helper inside click to construct PNG and add JSON payload
  const handleDownloadCharacterCard = async () => {
    if (!reviewCharacter) return;
    setIsDownloading(true);

    try {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Unable to create canvas 2D context.");
      }

      // Draw beautiful stylized background
      ctx.fillStyle = "#121415";
      ctx.fillRect(0, 0, 400, 400);

      const radGradient = ctx.createRadialGradient(200, 200, 40, 200, 200, 280);
      radGradient.addColorStop(0, "#1f2224");
      radGradient.addColorStop(0.5, "#131516");
      radGradient.addColorStop(1, "#070809");
      ctx.fillStyle = radGradient;
      ctx.fillRect(0, 0, 400, 400);

      // Card frame golden details
      ctx.strokeStyle = "#c1a067";
      ctx.lineWidth = 2;
      ctx.strokeRect(12, 12, 376, 376);

      ctx.strokeStyle = "rgba(193, 160, 103, 0.25)";
      ctx.lineWidth = 1;
      ctx.strokeRect(18, 18, 364, 364);

      // Corner triangles or brackets
      const drawBracket = (x: number, y: number, hSign: number, vSign: number) => {
        ctx.strokeStyle = "#c1a067";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + hSign * 25, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + vSign * 25);
        ctx.stroke();
      };
      drawBracket(12, 12, 1, 1);
      drawBracket(388, 12, -1, 1);
      drawBracket(12, 388, 1, -1);
      drawBracket(388, 388, -1, -1);

      // Decorative center top emblem representation
      ctx.fillStyle = "#c1a067";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText("✥ KEEPER INVESTIGATOR SECURE DOSSIER ✥", 200, 36);

      // Circular avatar rendering & async wait for visual image if set
      const drawAvatarCircle = async () => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(200, 108, 44, 0, Math.PI * 2);
        ctx.fillStyle = "#0c0d0e";
        ctx.fill();
        ctx.strokeStyle = "#c1a067";
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();

        if (reviewCharacter.avatar) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = reviewCharacter.avatar;
          await new Promise<void>((resolveImg) => {
            img.onload = () => {
              ctx.save();
              ctx.beginPath();
              ctx.arc(200, 108, 42, 0, Math.PI * 2);
              ctx.clip();
              ctx.drawImage(img, 158, 66, 84, 84);
              ctx.restore();
              resolveImg();
            };
            img.onerror = () => {
              // fallback
              ctx.fillStyle = "#c1a067";
              ctx.font = "bold 32px sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(reviewCharacter.name.trim().charAt(0).toUpperCase(), 200, 109);
              resolveImg();
            };
          });
        } else {
          ctx.fillStyle = "#c1a067";
          ctx.font = "bold 32px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(reviewCharacter.name.trim().charAt(0).toUpperCase(), 200, 109);
        }
      };

      await drawAvatarCircle();

      // Text Fields Configuration
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 17px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(reviewCharacter.name, 200, 185);

      ctx.fillStyle = "#c1a067";
      ctx.font = "bold 11px sans-serif";
      const occStr = `${reviewCharacter.occupation}  |  ${reviewCharacter.gender || "男"} • ${reviewCharacter.age || 30}岁`;
      ctx.fillText(occStr, 200, 206);

      // Separation Line
      ctx.strokeStyle = "rgba(193, 160, 103, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(60, 222);
      ctx.lineTo(340, 222);
      ctx.stroke();

      // Separation central diamond mark
      ctx.fillStyle = "#c1a067";
      ctx.beginPath();
      ctx.moveTo(200, 218);
      ctx.lineTo(204, 222);
      ctx.lineTo(200, 226);
      ctx.lineTo(196, 222);
      ctx.fill();

      // HP/MP/SAN metrics display text
      ctx.font = "bold 11px monospace";
      ctx.fillStyle = "#f87171"; // Red
      ctx.fillText(`HP: ${reviewCharacter.hp}/${reviewCharacter.maxHp}`, 95, 246);

      ctx.fillStyle = "#60a5fa"; // Blue
      ctx.fillText(`MP: ${reviewCharacter.mp}/${reviewCharacter.maxMp}`, 200, 246);

      ctx.fillStyle = "#34d399"; // Green
      ctx.fillText(`SAN: ${reviewCharacter.san}`, 305, 246);

      // Attributes lines
      ctx.fillStyle = "#9ca3af";
      ctx.font = "9.5px monospace";
      ctx.fillText(
        `STR:${reviewCharacter.attributes.str} CON:${reviewCharacter.attributes.con} SIZ:${reviewCharacter.attributes.siz} DEX:${reviewCharacter.attributes.dex} APP:${reviewCharacter.attributes.app}`,
        200,
        278
      );
      ctx.fillText(
        `INT:${reviewCharacter.attributes.int} POW:${reviewCharacter.attributes.pow} EDU:${reviewCharacter.attributes.edu} LUCK:${reviewCharacter.attributes.luck}`,
        200,
        296
      );

      // Skill tags displays of first 3 customized skills
      let displaySkills = "SKILLS: ";
      const filteredSortedSkills = Object.entries(reviewCharacter.skills)
        .filter(([sk]) => sk !== "克苏鲁神话")
        .slice(0, 3)
        .map(([sk, val]) => `${sk}(${val}%)`);
      displaySkills += filteredSortedSkills.length > 0 ? filteredSortedSkills.join(" | ") : "常规探查学者";

      ctx.fillStyle = "#f3f4f6";
      ctx.font = "10.5px sans-serif";
      ctx.fillText(displaySkills, 200, 326);

      // Aesthetic Bottom text stamp
      ctx.fillStyle = "rgba(193, 160, 103, 0.35)";
      ctx.font = "italic 9px monospace";
      ctx.fillText(`CHRONOS SYSTEM SIGNATURE • TYPE-MOON & FOUNDATION DUAL COOPERATION`, 200, 355);

      // Capture the basic image bytes from Canvas as PNG blob
      const basePngBlob = await new Promise<Blob>((resBlob) => {
        canvas.toBlob((b) => resBlob(b || new Blob()), "image/png");
      });

      const arrayBuffer = await basePngBlob.arrayBuffer();
      const basePngBytes = new Uint8Array(arrayBuffer);

      // Let's bundle structural JSON values
      const jsonPayloadString = JSON.stringify(reviewCharacter);
      const encoder = new TextEncoder();
      const markerBytes = encoder.encode("KEEPER_CHARACTER_CARD_UTF8_PAYLOAD:");
      const jsonPayloadBytes = encoder.encode(jsonPayloadString);

      // Combine array binary: [PNG BYTES] + [MARKER_BYTES] + [JSON_PAYLOAD_BYTES]
      const totalCombinedCardBytes = new Uint8Array(basePngBytes.length + markerBytes.length + jsonPayloadBytes.length);
      totalCombinedCardBytes.set(basePngBytes, 0);
      totalCombinedCardBytes.set(markerBytes, basePngBytes.length);
      totalCombinedCardBytes.set(jsonPayloadBytes, basePngBytes.length + markerBytes.length);

      // Assemble download trigger
      const finishedCardBlob = new Blob([totalCombinedCardBytes], { type: "image/png" });
      const dlLinkUrl = URL.createObjectURL(finishedCardBlob);

      const triggerAnchor = document.createElement("a");
      triggerAnchor.href = dlLinkUrl;
      triggerAnchor.download = `${reviewCharacter.name}_investigator_sheet.png`;
      triggerAnchor.click();

      // Revoke memory allocations after download
      setTimeout(() => URL.revokeObjectURL(dlLinkUrl), 400);

    } catch (e: any) {
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
      const importedPC = JSON.parse(decodedPayloadString) as CharacterSheet;

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
          // Extract the circular avatar (x: 158, y: 66, w: 84, h: 84) from the 400x400 card dynamically with canvas
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
                  // Crop the circular avatar region and draw it scaled slightly larger for optimal resolution
                  tempCtx.drawImage(img, 158, 66, 84, 84, 0, 0, 120, 120);
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
        setCustomOccupation(importedPC.occupation);
        setCustomGender(importedPC.gender || "男");
        setCustomAge(importedPC.age || 30);
        setCustomAttrs({ ...importedPC.attributes });

        const filteredSkills = { ...importedPC.skills };
        delete (filteredSkills as any)["克苏鲁神话"];
        setCustomSkills(filteredSkills);

        setCustomAvatar(cleanAvatar);

        if (importedPC.background) {
          setSelectedEra(importedPC.background as "1920s" | "modern");
        }

        // Direct skip to confirmation step
        setReviewCharacter(importedPC);
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

  const updateSkill = (skill: string, value: number) => {
    const limValue = Math.max(1, Math.min(99, value));
    setCustomSkills(prev => ({
      ...prev,
      [skill]: limValue
    }));
  };

  // Generate Module Outline via the user-configured LLM provider
  const generateModuleOutline = async () => {
    setIsGeneratingModule(true);
    setModuleGenerationError(null);

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
        throw new Error("HTTP connection error or API issue when generating module outline.");
      }

      const resData = await response.json();
      if (resData.success && resData.data) {
        setModuleOutline(resData.data);
      } else {
        throw new Error(resData.error || "获取模组信息失败");
      }
    } catch (err: any) {
      console.error("Failed to generate module outline:", err);
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
        throw new Error("HTTP connection error or API issue when generating attributes.");
      }

      const resData = await response.json();
      if (resData.success && resData.data) {
        const charData = resData.data;
        if (charData.name && !customName.trim()) {
          setCustomName(charData.name);
        }
        if (charData.occupation) {
          setCustomOccupation(charData.occupation);
        }
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
          setCustomSkills(mappedSkills);
        }
      } else {
        throw new Error(resData.error || "获取属性失败");
      }
    } catch (err: any) {
      console.error("Failed to generate character stats:", err);
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
    const finalChar: CharacterSheet = {
      ...preset,
      background: selectedEra,
      avatar: customAvatar || undefined
    } as any;
    setReviewCharacter(finalChar);
    setCurrentStep(3);
  };

  // Custom -> Proceed to review
  const handleCreateCustom = () => {
    const finalName = customName.trim() || "无名调查员";
    const calculatedHp = Math.floor((customAttrs.con + customAttrs.siz) / 10);
    const calculatedMp = Math.floor(customAttrs.pow / 5);
    const calculatedSan = customAttrs.pow;

    const newChar: CharacterSheet = {
      name: finalName,
      occupation: customOccupation || "非主流秘仪学者",
      gender: customGender,
      age: customAge,
      background: selectedEra,
      attributes: { ...customAttrs },
      skills: { ...customSkills, "克苏鲁神话": 0 },
      hp: calculatedHp,
      maxHp: calculatedHp,
      mp: calculatedMp,
      maxMp: calculatedMp,
      san: calculatedSan,
      maxSan: calculatedSan,
      maxSanLimit: 99,
      mythos: 0,
      avatar: customAvatar || undefined
    };

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
                    {moduleOutline.title}
                  </h3>
                </div>

                <div className="text-sm leading-relaxed text-gray-300 font-sans space-y-2">
                  <span className="text-[10px] text-gray-400 font-mono tracking-widest block uppercase">前言/背景低语 (No-Spoiler Intro)</span>
                  <p className="bg-black/30 p-4 border-l-2 border-[#c1a067] rounded-r italic text-gray-350 select-text">
                    {moduleOutline.intro}
                  </p>
                </div>

                {/* Suggested occupations label */}
                <div className="pt-2">
                  <span className="text-[10px] text-gray-400 font-mono tracking-widest block uppercase mb-1.5">契合本模组推荐PC职业方向 (Suggested PC Occupations)</span>
                  <div className="flex flex-wrap gap-2">
                    {moduleOutline.recommendedOccupations.map((job) => (
                      <span key={job} className="text-xs bg-[#c1a067]/10 text-[#c1a067] border border-[#c1a067]/30 px-2.5 py-1 rounded font-normal font-sans shadow-sm">
                        {job}
                      </span>
                    ))}
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
                    《{moduleOutline.title}》
                  </span>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-400 font-mono tracking-widest block uppercase">模组前言 / 深渊背景低语 :</span>
                  <div className="text-xs leading-relaxed text-gray-300 italic pl-3 border-l-2 border-[#c1a067]/60 py-1 bg-black/25 pr-2 select-text font-serif leading-normal whitespace-pre-line">
                    {moduleOutline.intro}
                  </div>
                </div>
                <div className="flex items-center flex-wrap gap-1.5 pt-1.5 text-[11px] text-gray-400 border-t border-gray-900/40">
                  <span className="font-semibold text-gray-300 font-sans flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-[#c1a067]" />
                    <span>契合本案 PC 职业推荐:</span>
                  </span>
                  {moduleOutline.recommendedOccupations.map((job) => (
                    <span key={job} className="bg-black/50 text-[#c1a067] px-2 py-0.5 rounded font-medium border border-gray-800/80 font-sans text-[11px]">
                      {job}
                    </span>
                  ))}
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
              <div className="p-3 bg-red-950/40 border border-red-800/50 rounded flex items-center gap-2 text-xs text-red-300 font-sans">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <span>{importError}</span>
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
                    <label className="block text-xs font-semibold text-[#c1a067] uppercase tracking-wider mb-2">角色职业（自拟/智能大纲参考）</label>
                    <input 
                      id="custom-occupation-input"
                      type="text"
                      value={customOccupation}
                      onChange={(e) => setCustomOccupation(e.target.value)}
                      placeholder="例如: SCP特工 / 圣堂教会代行老兵 / 本地探长"
                      className="w-full bg-black/40 border border-gray-800 rounded p-2.5 text-gray-200 placeholder-gray-650 focus:outline-none focus:border-[#c1a067] text-sm font-sans"
                    />
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
                </div>

                {/* Skill panel custom adjustments */}
                <div className="bg-[#181a1c] border border-gray-800 p-5 rounded-lg space-y-4 font-sans">
                  <h4 className="text-sm font-semibold text-[#c1a067] border-b border-gray-800 pb-2">自定义技能掌握 (增删技能百分比点数)</h4>
                  <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-4 text-xs">
                    {Object.entries(customSkills).map(([skill, val]) => {
                      const numVal = val as number;
                      return (
                        <div key={skill} className="flex items-center justify-between bg-black/30 p-2.5 border border-gray-850 rounded">
                          <span className="font-semibold text-gray-400">{skill}</span>
                          <div className="flex items-center gap-2">
                            <button 
                              type="button"
                              onClick={() => updateSkill(skill, numVal - 5)} 
                              className="w-6 h-6 bg-black border border-gray-800 text-gray-300 rounded hover:bg-[#c1a067]/10 flex items-center justify-center font-bold"
                            >
                              -
                            </button>
                            <input 
                              type="text" 
                              value={numVal} 
                              onChange={(e) => updateSkill(skill, parseInt(e.target.value) || 0)} 
                              className="w-10 text-center font-mono font-bold text-gray-200 bg-transparent"
                            />
                            <span className="text-gray-500 font-mono">%</span>
                            <button 
                              type="button"
                              onClick={() => updateSkill(skill, numVal + 5)} 
                              className="w-6 h-6 bg-black border border-gray-800 text-gray-300 rounded hover:bg-[#c1a067]/10 flex items-center justify-center font-bold"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
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
                <div className="space-y-4">
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

                  <div className="space-y-1 bg-black/30 p-3 rounded.lg border border-gray-850 text-xs text-gray-300 leading-relaxed font-sans">
                    <span className="text-[9px] font-mono font-bold text-[#c1a067] block uppercase border-b border-gray-800 pb-1 mb-1.5">
                      模组不剧透序幕 (Background Hint)
                    </span>
                    <div className="italic text-gray-350 select-text max-h-[160px] overflow-y-auto pr-1">
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
