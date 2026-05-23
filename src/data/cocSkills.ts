/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CoC 7e 标准技能表（1920s + modern 合并版）。
 *
 * 设计取舍（详见 .docs/skill-1920s.md / skill-modern.md 的 91% 重叠分析）：
 * - 单一 SKILL_REGISTRY_ALL，所有技能与分支按字母 / 字典序排列；
 *   时代差异通过 `eraOnly` 字段精确标记，前端按 era 过滤。
 * - 36 项通用技能两代通用，2 项（计算机使用 / 电子学）modern 独占。
 * - 多分支父类作为单条技能存在；分支独立成长，每个分支可有独立 base。
 *
 * 关键约定：
 * - 闪避 / 母语 / 信用评级**不进技能表**（详见 cocRules.ts 的 dodgeOf / motherTongueValue
 *   以及 CharacterSheet 的 motherTongue / creditRating 基本信息字段）。
 * - 克苏鲁神话进表但 cthulhuOnly: true，前端创建期不给玩家勾选。
 * - 多分支父类 base 表示"玩家自由声明分支"时的默认基础值（Art/Craft = 05、
 *   Science = 01、Survival = 10、Language(Other) = 01；Firearms / Fighting / Drive
 *   不允许自由分支，父类 base 仅用于占位、不应直接对玩家暴露）。
 */

/** 技能在多分支体系下的归类。`single` = 不分支的通用技能。 */
export type SkillCategory =
  | "single"
  | "artCraft"
  | "science"
  | "firearms"
  | "fighting"
  | "survival"
  | "languageOther"
  | "drive"
  | "pilot";

export interface SkillDefinition {
  id: string;
  nameZh: string;
  nameEn: string;
  base: number;
  category: SkillCategory;
  branches?: SkillBranchDefinition[];
  cthulhuOnly?: boolean;
  eraOnly?: "1920s" | "modern";
  notes?: string;
}

export interface SkillBranchDefinition {
  parentId: string;
  id: string;
  nameZh: string;
  nameEn: string;
  base: number;
  eraOnly?: "1920s" | "modern";
  userDefined?: boolean;
  notes?: string;
}

export interface SkillRegistry {
  era: "1920s" | "modern";
  skills: SkillDefinition[];
}

export type OccupationSkillRef =
  | { kind: "skill"; id: string }
  | { kind: "anyBranchOf"; parentId: string }
  | { kind: "branch"; parentId: string; branchId: string }
  | { kind: "oneOf"; options: OccupationSkillRef[] }
  | { kind: "freeSlot"; count: number };

// =============================================================================
// 数据：合并表
// =============================================================================

/** 父类 Art/Craft 的常见分支。 */
const BRANCHES_ART_CRAFT: SkillBranchDefinition[] = [
  { parentId: "art-craft", id: "art-craft-acting",      nameZh: "表演",          nameEn: "Acting",            base: 5 },
  { parentId: "art-craft", id: "art-craft-fine-art",    nameZh: "美术",          nameEn: "Fine Art",          base: 5 },
  { parentId: "art-craft", id: "art-craft-photography", nameZh: "摄影",          nameEn: "Photography",       base: 5 },
  { parentId: "art-craft", id: "art-craft-writing",     nameZh: "写作",          nameEn: "Writing",           base: 5 },
  { parentId: "art-craft", id: "art-craft-instrument",  nameZh: "乐器",          nameEn: "Instrument",        base: 5 },
  { parentId: "art-craft", id: "art-craft-cooking",     nameZh: "烹饪",          nameEn: "Cooking",           base: 5 },
  { parentId: "art-craft", id: "art-craft-carpentry",   nameZh: "木工",          nameEn: "Carpentry",         base: 5 },
  { parentId: "art-craft", id: "art-craft-locksmith",   nameZh: "制锁",          nameEn: "Locksmithing",      base: 5 },
  { parentId: "art-craft", id: "art-craft-drafting",    nameZh: "制图 / 技术绘图", nameEn: "Drafting",          base: 5 },
  { parentId: "art-craft", id: "art-craft-forgery",     nameZh: "伪造",          nameEn: "Forgery",           base: 5 },
  { parentId: "art-craft", id: "art-craft-agriculture", nameZh: "农艺",          nameEn: "Agriculture",       base: 5, eraOnly: "1920s" },
  { parentId: "art-craft", id: "art-craft-graphic",     nameZh: "平面设计",      nameEn: "Graphic Design",    base: 5, eraOnly: "modern" },
  { parentId: "art-craft", id: "art-craft-video-edit",  nameZh: "视频剪辑",      nameEn: "Video Editing",     base: 5, eraOnly: "modern" },
];

/** 父类 Science 的常见分支。 */
const BRANCHES_SCIENCE: SkillBranchDefinition[] = [
  { parentId: "science", id: "science-astronomy",      nameZh: "天文学",   nameEn: "Astronomy",        base: 1 },
  { parentId: "science", id: "science-biology",        nameZh: "生物学",   nameEn: "Biology",          base: 1 },
  { parentId: "science", id: "science-botany",         nameZh: "植物学",   nameEn: "Botany",           base: 1 },
  { parentId: "science", id: "science-chemistry",      nameZh: "化学",     nameEn: "Chemistry",        base: 1 },
  { parentId: "science", id: "science-cryptography",   nameZh: "密码学",   nameEn: "Cryptography",     base: 1 },
  { parentId: "science", id: "science-engineering",    nameZh: "工程学",   nameEn: "Engineering",      base: 1 },
  { parentId: "science", id: "science-geology",        nameZh: "地质学",   nameEn: "Geology",          base: 1 },
  { parentId: "science", id: "science-mathematics",    nameZh: "数学",     nameEn: "Mathematics",      base: 1 },
  { parentId: "science", id: "science-meteorology",    nameZh: "气象学",   nameEn: "Meteorology",      base: 1 },
  { parentId: "science", id: "science-pharmacy",       nameZh: "药学",     nameEn: "Pharmacy",         base: 1 },
  { parentId: "science", id: "science-physics",        nameZh: "物理学",   nameEn: "Physics",          base: 1 },
  { parentId: "science", id: "science-zoology",        nameZh: "动物学",   nameEn: "Zoology",          base: 1 },
  { parentId: "science", id: "science-computer",       nameZh: "计算机科学", nameEn: "Computer Science", base: 1, eraOnly: "modern" },
  { parentId: "science", id: "science-forensics",      nameZh: "法医学",   nameEn: "Forensics",        base: 1, eraOnly: "modern" },
  { parentId: "science", id: "science-genetics",       nameZh: "遗传学",   nameEn: "Genetics",         base: 1, eraOnly: "modern" },
];

/** 父类 Firearms 的标准分支（两代基础值与列表完全相同）。 */
const BRANCHES_FIREARMS: SkillBranchDefinition[] = [
  { parentId: "firearms", id: "firearms-handgun",      nameZh: "手枪",       nameEn: "Handgun",         base: 20 },
  { parentId: "firearms", id: "firearms-rifle",        nameZh: "步枪 / 霰弹枪", nameEn: "Rifle / Shotgun", base: 25 },
  { parentId: "firearms", id: "firearms-smg",          nameZh: "冲锋枪",     nameEn: "Submachine Gun",  base: 15 },
  { parentId: "firearms", id: "firearms-heavy",        nameZh: "重武器",     nameEn: "Heavy Weapons",   base: 10 },
  { parentId: "firearms", id: "firearms-bow",          nameZh: "弓",         nameEn: "Bow",             base: 15 },
  { parentId: "firearms", id: "firearms-flamethrower", nameZh: "火焰喷射器", nameEn: "Flamethrower",    base: 10 },
];

/** 父类 Fighting 的标准分支。modern 独占链锯。 */
const BRANCHES_FIGHTING: SkillBranchDefinition[] = [
  { parentId: "fighting", id: "fighting-brawl",     nameZh: "斗殴",       nameEn: "Brawl",       base: 25 },
  { parentId: "fighting", id: "fighting-sword",     nameZh: "剑",         nameEn: "Sword",       base: 20 },
  { parentId: "fighting", id: "fighting-axe",       nameZh: "斧",         nameEn: "Axe",         base: 15 },
  { parentId: "fighting", id: "fighting-spear",     nameZh: "长矛",       nameEn: "Spear",       base: 20 },
  { parentId: "fighting", id: "fighting-whip",      nameZh: "鞭",         nameEn: "Whip",        base: 5 },
  { parentId: "fighting", id: "fighting-chain",     nameZh: "锁链",       nameEn: "Chain",       base: 5 },
  { parentId: "fighting", id: "fighting-flail",     nameZh: "链枷",       nameEn: "Flail",       base: 10 },
  { parentId: "fighting", id: "fighting-club",      nameZh: "棍棒",       nameEn: "Club",        base: 25 },
  { parentId: "fighting", id: "fighting-thrown",    nameZh: "镖 / 飞刀",  nameEn: "Thrown Blade",base: 10 },
  { parentId: "fighting", id: "fighting-chainsaw", nameZh: "链锯",       nameEn: "Chainsaw",    base: 10, eraOnly: "modern" },
];

/**
 * 父类 Drive 的标准分支。1920s 含汽车 + 马车；modern 含汽车 + 卡车 / 船 / 飞机 / 直升机。
 *
 * 注意：modern 表里"驾驶（飞机）"基础值 01 与火器表的"飞行员"父类（pilot）有概念重叠；
 * 这里按 .docs/skill-modern.md 原表保留在 drive 父类下，未来如果要拆 pilot 父类再调整。
 */
const BRANCHES_DRIVE: SkillBranchDefinition[] = [
  { parentId: "drive", id: "drive-auto",       nameZh: "汽车",        nameEn: "Auto",        base: 20 },
  { parentId: "drive", id: "drive-carriage",   nameZh: "马车",        nameEn: "Carriage",    base: 20, eraOnly: "1920s" },
  { parentId: "drive", id: "drive-truck",      nameZh: "卡车 / 重型卡", nameEn: "Heavy Truck", base: 1,  eraOnly: "modern" },
  { parentId: "drive", id: "drive-boat",       nameZh: "船",          nameEn: "Boat",        base: 1,  eraOnly: "modern" },
  { parentId: "drive", id: "drive-aircraft",   nameZh: "飞机",        nameEn: "Aircraft",    base: 1 },
  { parentId: "drive", id: "drive-helicopter", nameZh: "直升机",      nameEn: "Helicopter",  base: 1,  eraOnly: "modern" },
];

/** 父类 Survival 的常见分支。文档没给基础值差异，统一沿用父类 10。 */
const BRANCHES_SURVIVAL: SkillBranchDefinition[] = [
  { parentId: "survival", id: "survival-desert",   nameZh: "沙漠", nameEn: "Desert",   base: 10 },
  { parentId: "survival", id: "survival-sea",      nameZh: "海洋", nameEn: "Sea",      base: 10 },
  { parentId: "survival", id: "survival-arctic",   nameZh: "极地", nameEn: "Arctic",   base: 10 },
  { parentId: "survival", id: "survival-mountain", nameZh: "山地", nameEn: "Mountain", base: 10 },
  { parentId: "survival", id: "survival-jungle",   nameZh: "丛林", nameEn: "Jungle",   base: 10 },
  { parentId: "survival", id: "survival-plains",   nameZh: "平原", nameEn: "Plains",   base: 10 },
];

/**
 * 父类 Language(Other) 的常见分支占位。语言种类几乎无穷，UI 应允许玩家自由声明
 * `userDefined: true` 的分支；这里只列几条最常见的便于下拉默认有内容。
 */
const BRANCHES_LANGUAGE_OTHER: SkillBranchDefinition[] = [
  { parentId: "language-other", id: "lang-latin",   nameZh: "拉丁语",     nameEn: "Latin",   base: 1 },
  { parentId: "language-other", id: "lang-french",  nameZh: "法语",       nameEn: "French",  base: 1 },
  { parentId: "language-other", id: "lang-german",  nameZh: "德语",       nameEn: "German",  base: 1 },
  { parentId: "language-other", id: "lang-spanish", nameZh: "西班牙语",   nameEn: "Spanish", base: 1 },
  { parentId: "language-other", id: "lang-arabic",  nameZh: "阿拉伯语",   nameEn: "Arabic",  base: 1 },
  { parentId: "language-other", id: "lang-greek",   nameZh: "希腊语",     nameEn: "Greek",   base: 1 },
  { parentId: "language-other", id: "lang-chinese", nameZh: "汉语",       nameEn: "Chinese", base: 1 },
  { parentId: "language-other", id: "lang-japanese",nameZh: "日语",       nameEn: "Japanese",base: 1 },
];

/**
 * 全量合并技能表。两代通用项不带 eraOnly；时代独占项与时代独占分支自带 eraOnly。
 *
 * 排序：先按 category 分组（single → artCraft → science → firearms → fighting →
 * drive → survival → languageOther），category 内按中文笔画 / 字母大致整齐即可。
 */
export const SKILL_REGISTRY_ALL: SkillDefinition[] = [
  // ---- single (通用技能) ----
  { id: "accounting",         nameZh: "会计",     nameEn: "Accounting",     base: 5,  category: "single" },
  { id: "anthropology",       nameZh: "人类学",   nameEn: "Anthropology",   base: 1,  category: "single" },
  { id: "appraise",           nameZh: "估价",     nameEn: "Appraise",       base: 5,  category: "single" },
  { id: "archaeology",        nameZh: "考古学",   nameEn: "Archaeology",    base: 1,  category: "single" },
  { id: "charm",              nameZh: "魅惑",     nameEn: "Charm",          base: 15, category: "single" },
  { id: "climb",              nameZh: "攀爬",     nameEn: "Climb",          base: 20, category: "single" },
  { id: "computer-use",       nameZh: "计算机使用", nameEn: "Computer Use",  base: 5,  category: "single", eraOnly: "modern" },
  { id: "cthulhu-mythos",     nameZh: "克苏鲁神话", nameEn: "Cthulhu Mythos", base: 0,  category: "single", cthulhuOnly: true,
    notes: "不能通过经验成长，仅遭遇神话事件加点。" },
  { id: "disguise",           nameZh: "乔装",     nameEn: "Disguise",       base: 5,  category: "single" },
  { id: "electrical-repair",  nameZh: "电气维修", nameEn: "Electrical Repair", base: 10, category: "single" },
  { id: "electronics",        nameZh: "电子学",   nameEn: "Electronics",    base: 1,  category: "single", eraOnly: "modern" },
  { id: "fast-talk",          nameZh: "快速交谈", nameEn: "Fast Talk",      base: 5,  category: "single" },
  { id: "first-aid",          nameZh: "急救",     nameEn: "First Aid",      base: 30, category: "single" },
  { id: "history",            nameZh: "历史",     nameEn: "History",        base: 5,  category: "single" },
  { id: "intimidate",         nameZh: "恐吓",     nameEn: "Intimidate",     base: 15, category: "single" },
  { id: "jump",               nameZh: "跳跃",     nameEn: "Jump",           base: 20, category: "single" },
  { id: "law",                nameZh: "法律",     nameEn: "Law",            base: 5,  category: "single" },
  { id: "library-use",        nameZh: "图书馆使用", nameEn: "Library Use",  base: 20, category: "single" },
  { id: "listen",             nameZh: "聆听",     nameEn: "Listen",         base: 20, category: "single" },
  { id: "locksmith",          nameZh: "锁匠",     nameEn: "Locksmith",      base: 1,  category: "single" },
  { id: "mechanical-repair",  nameZh: "机械维修", nameEn: "Mechanical Repair", base: 10, category: "single" },
  { id: "medicine",           nameZh: "医学",     nameEn: "Medicine",       base: 1,  category: "single" },
  { id: "natural-world",      nameZh: "博物",     nameEn: "Natural World",  base: 10, category: "single" },
  { id: "navigate",           nameZh: "导航",     nameEn: "Navigate",       base: 10, category: "single" },
  { id: "occult",             nameZh: "神秘学",   nameEn: "Occult",         base: 5,  category: "single" },
  { id: "operate-heavy-machinery", nameZh: "操作重型机械", nameEn: "Operate Heavy Machinery", base: 1, category: "single" },
  { id: "persuade",           nameZh: "说服",     nameEn: "Persuade",       base: 10, category: "single" },
  { id: "psychology",         nameZh: "心理学",   nameEn: "Psychology",     base: 10, category: "single" },
  { id: "psychoanalysis",     nameZh: "精神分析", nameEn: "Psychoanalysis", base: 1,  category: "single" },
  { id: "ride",               nameZh: "骑术",     nameEn: "Ride",           base: 5,  category: "single" },
  { id: "sleight-of-hand",    nameZh: "妙手",     nameEn: "Sleight of Hand", base: 10, category: "single" },
  { id: "spot-hidden",        nameZh: "侦查",     nameEn: "Spot Hidden",    base: 25, category: "single" },
  { id: "stealth",            nameZh: "潜行",     nameEn: "Stealth",        base: 20, category: "single" },
  { id: "swim",               nameZh: "游泳",     nameEn: "Swim",           base: 20, category: "single" },
  { id: "throw",              nameZh: "投掷",     nameEn: "Throw",          base: 20, category: "single" },
  { id: "track",              nameZh: "追踪",     nameEn: "Track",          base: 10, category: "single" },

  // ---- 多分支父类 ----
  { id: "art-craft",      nameZh: "艺术 / 手艺", nameEn: "Art/Craft",       base: 5,  category: "artCraft",      branches: BRANCHES_ART_CRAFT },
  { id: "science",        nameZh: "科学",       nameEn: "Science",         base: 1,  category: "science",        branches: BRANCHES_SCIENCE },
  { id: "firearms",       nameZh: "火器",       nameEn: "Firearms",        base: 0,  category: "firearms",       branches: BRANCHES_FIREARMS,
    notes: "父类不直接打钩；子分支基础值差异较大（手枪 20 / 步枪 25 / 冲锋枪 15 等）。" },
  { id: "fighting",       nameZh: "格斗",       nameEn: "Fighting",        base: 0,  category: "fighting",       branches: BRANCHES_FIGHTING,
    notes: "父类不直接打钩；子分支基础值差异较大（斗殴 25 / 棍棒 25 / 长矛 20 等）。" },
  { id: "drive",          nameZh: "驾驶",       nameEn: "Drive",           base: 0,  category: "drive",          branches: BRANCHES_DRIVE,
    notes: "父类不直接打钩；具体载具按分支查值。" },
  { id: "survival",       nameZh: "求生",       nameEn: "Survival",        base: 10, category: "survival",       branches: BRANCHES_SURVIVAL },
  { id: "language-other", nameZh: "其他语种",   nameEn: "Language (Other)", base: 1, category: "languageOther",  branches: BRANCHES_LANGUAGE_OTHER,
    notes: "玩家可自由声明新分支（任意语言），由 KP 裁定。" },
];

// =============================================================================
// 查询 helpers
// =============================================================================

/**
 * 按年代过滤合并表，返回该年代下可用的技能与分支视图。
 *
 * - 顶级技能：丢弃 `eraOnly` 与目标 era 不符的项。
 * - 分支：对保留下来的多分支父类，剪掉其分支里 `eraOnly` 与目标 era 不符的条目。
 * - 父类本身没有 eraOnly、但**所有标准分支都被剪光**的极端情况下仍保留父类
 *   （允许玩家自由声明 userDefined 分支）。
 */
export function getSkillRegistry(era: "1920s" | "modern"): SkillRegistry {
  const skills = SKILL_REGISTRY_ALL
    .filter((s) => !s.eraOnly || s.eraOnly === era)
    .map((s) => {
      if (!s.branches) return s;
      const branches = s.branches.filter((b) => !b.eraOnly || b.eraOnly === era);
      return { ...s, branches };
    });
  return { era, skills };
}

/** 按 id 在合并表里查一项技能（不区分 era；调用方自行做时代校验）。 */
export function findSkill(id: string): SkillDefinition | undefined {
  return SKILL_REGISTRY_ALL.find((s) => s.id === id);
}

/** 按 (parentId, branchId) 在合并表里查一项分支。 */
export function findBranch(parentId: string, branchId: string): SkillBranchDefinition | undefined {
  return findSkill(parentId)?.branches?.find((b) => b.id === branchId);
}

/**
 * 该技能是否对玩家在创建期可见 / 可勾选。
 * cthulhuOnly = true 的项（克苏鲁神话）始终对创建期不可见。
 */
export function isSkillSelectable(skill: SkillDefinition, era: "1920s" | "modern"): boolean {
  if (skill.cthulhuOnly) return false;
  if (skill.eraOnly && skill.eraOnly !== era) return false;
  return true;
}
