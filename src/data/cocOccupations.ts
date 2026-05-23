/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CoC 7e 标准职业模板（1920s / modern）。
 *
 * 关键约定（与 .docs/occupation-list.md 对齐）：
 * - 1920s 与 modern 共有的职业**不去重**，两张表分别列一份。
 * - "信用评级 / 母语 / 闪避"不出现在职业模板里——前两者是基本信息层字段，
 *   闪避是派生战斗值。
 * - 每条职业的 coreSkills 解析后总数（含 freeSlot 的 count、oneOf 计 1）必须 ≤ 8。
 * - occupationPointFormula 第一阶段统一用 `EDU × 4` 兜底；后续如要给不同职业差异化
 *   （律师 EDU×2+APP×2 等）再扩，本文件**不**预先猜测。
 *
 * 数据落入策略：
 * - id 形如 `<slug>-1920s` / `<slug>-modern`，避免两表同名职业 id 冲突。
 * - coreSkills 用 OccupationSkillRef 五种 kind 结构化"任一/或/×N/自定 N"等表达式。
 * - 不在备注里抄文档原话，UI 需要简介时再补 description。
 */

import type { OccupationSkillRef } from "./cocSkills";

export interface OccupationPointFormula {
  terms: Array<{ attr: "str" | "con" | "siz" | "dex" | "app" | "int" | "pow" | "edu" | "luck"; mult: number }>;
  max?: number;
}

export interface OccupationTemplate {
  id: string;
  nameZh: string;
  nameEn: string;
  era: "1920s" | "modern";
  coreSkills: OccupationSkillRef[];
  occupationPointFormula: OccupationPointFormula;
  description?: string;
  notes?: string;
}

/** 默认职业点池公式：EDU × 4（阶段 4/5 统一兜底）。 */
export const DEFAULT_OCCUPATION_POINT_FORMULA: OccupationPointFormula = {
  terms: [{ attr: "edu", mult: 4 }],
};

// =============================================================================
// 简写 helper —— 让数据条目尽量短，专注于"职业 → 技能"的映射本身
// =============================================================================

const s = (id: string): OccupationSkillRef => ({ kind: "skill", id });
const any = (parentId: string): OccupationSkillRef => ({ kind: "anyBranchOf", parentId });
const br = (parentId: string, branchId: string): OccupationSkillRef => ({ kind: "branch", parentId, branchId });
const oneOf = (...options: OccupationSkillRef[]): OccupationSkillRef => ({ kind: "oneOf", options });
const free = (count: number): OccupationSkillRef => ({ kind: "freeSlot", count });

// =============================================================================
// 表一 · 1920s 时代职业（43 条）
// =============================================================================

export const OCCUPATIONS_1920S: OccupationTemplate[] = [
  // 古董商：估价、艺术/手艺(任一)、历史、图书馆使用、其他语种、聆听、侦查
  { id: "antiquarian-1920s", nameZh: "古董商", nameEn: "Antiquarian", era: "1920s",
    coreSkills: [s("appraise"), any("art-craft"), s("history"), s("library-use"), any("language-other"), s("listen"), s("spot-hidden")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 艺术家：艺术/手艺(任一)、历史 或 博物 或 神秘学、其他语种、心理学、聆听、侦查、自定 1
  { id: "artist-1920s", nameZh: "艺术家", nameEn: "Artist", era: "1920s",
    coreSkills: [any("art-craft"), oneOf(s("history"), s("natural-world"), s("occult")), any("language-other"), s("psychology"), s("listen"), s("spot-hidden"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 运动员：攀爬、跳跃、格斗(斗殴)、骑术 或 游泳、投掷、心理学、聆听
  { id: "athlete-1920s", nameZh: "运动员", nameEn: "Athlete", era: "1920s",
    coreSkills: [s("climb"), s("jump"), br("fighting", "fighting-brawl"), oneOf(s("ride"), s("swim")), s("throw"), s("psychology"), s("listen")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 作家：艺术(写作)、历史、图书馆使用、其他语种、心理学、自定 1
  { id: "author-1920s", nameZh: "作家", nameEn: "Author", era: "1920s",
    coreSkills: [br("art-craft", "art-craft-writing"), s("history"), s("library-use"), any("language-other"), s("psychology"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 神职人员：会计、历史、图书馆使用、聆听、其他语种、心理学、说服
  { id: "clergy-1920s", nameZh: "神职人员", nameEn: "Clergy", era: "1920s",
    coreSkills: [s("accounting"), s("history"), s("library-use"), s("listen"), any("language-other"), s("psychology"), s("persuade")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 罪犯：锁匠 或 妙手、乔装、格斗(斗殴) 或 火器(手枪)、潜行、心理学、聆听、侦查
  { id: "criminal-1920s", nameZh: "罪犯", nameEn: "Criminal", era: "1920s",
    coreSkills: [oneOf(s("locksmith"), s("sleight-of-hand")), s("disguise"), oneOf(br("fighting", "fighting-brawl"), br("firearms", "firearms-handgun")), s("stealth"), s("psychology"), s("listen"), s("spot-hidden")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 纨绔子弟：艺术/手艺(任一)、火器(任一)、其他语种、骑术、说服、自定 2
  { id: "dilettante-1920s", nameZh: "纨绔子弟", nameEn: "Dilettante", era: "1920s",
    coreSkills: [any("art-craft"), any("firearms"), any("language-other"), s("ride"), s("persuade"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 医师：急救、医学、其他语种(拉丁)、心理学、科学(生物学)、科学(药学)、自定 1
  { id: "doctor-1920s", nameZh: "医师", nameEn: "Doctor of Medicine", era: "1920s",
    coreSkills: [s("first-aid"), s("medicine"), br("language-other", "lang-latin"), s("psychology"), br("science", "science-biology"), br("science", "science-pharmacy"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 流浪汉：攀爬、跳跃、聆听、博物、潜行、自定 2
  { id: "drifter-1920s", nameZh: "流浪汉", nameEn: "Drifter", era: "1920s",
    coreSkills: [s("climb"), s("jump"), s("listen"), s("natural-world"), s("stealth"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 工程师：艺术/手艺(技术绘图)、电气维修、图书馆使用、机械维修、操作重型机械、科学(工程学 或 物理学)、自定 1
  { id: "engineer-1920s", nameZh: "工程师", nameEn: "Engineer", era: "1920s",
    coreSkills: [br("art-craft", "art-craft-drafting"), s("electrical-repair"), s("library-use"), s("mechanical-repair"), s("operate-heavy-machinery"), oneOf(br("science", "science-engineering"), br("science", "science-physics")), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 艺人：艺术/手艺(表演)、乔装、聆听、心理学、说服、自定 2
  { id: "entertainer-1920s", nameZh: "艺人", nameEn: "Entertainer", era: "1920s",
    coreSkills: [br("art-craft", "art-craft-acting"), s("disguise"), s("listen"), s("psychology"), s("persuade"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 农夫：艺术/手艺(农业)、驾驶(汽车 或 马车)、急救、机械维修、博物、操作重型机械、追踪
  { id: "farmer-1920s", nameZh: "农夫", nameEn: "Farmer", era: "1920s",
    coreSkills: [br("art-craft", "art-craft-agriculture"), oneOf(br("drive", "drive-auto"), br("drive", "drive-carriage")), s("first-aid"), s("mechanical-repair"), s("natural-world"), s("operate-heavy-machinery"), s("track")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 警探：艺术/手艺(表演)、火器(手枪)、法律、聆听、心理学、说服、侦查、追踪
  { id: "police-detective-1920s", nameZh: "警探", nameEn: "Police Detective", era: "1920s",
    coreSkills: [br("art-craft", "art-craft-acting"), br("firearms", "firearms-handgun"), s("law"), s("listen"), s("psychology"), s("persuade"), s("spot-hidden"), s("track")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 警员：火器(手枪 或 霰弹枪)、急救、格斗(斗殴)、法律、心理学、说服、侦查
  { id: "police-officer-1920s", nameZh: "警员", nameEn: "Police Officer", era: "1920s",
    coreSkills: [oneOf(br("firearms", "firearms-handgun"), br("firearms", "firearms-rifle")), s("first-aid"), br("fighting", "fighting-brawl"), s("law"), s("psychology"), s("persuade"), s("spot-hidden")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 私家侦探：艺术/手艺(摄影)、乔装、法律、图书馆使用、心理学、侦查、潜行
  { id: "private-investigator-1920s", nameZh: "私家侦探", nameEn: "Private Investigator", era: "1920s",
    coreSkills: [br("art-craft", "art-craft-photography"), s("disguise"), s("law"), s("library-use"), s("psychology"), s("spot-hidden"), s("stealth")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 记者：艺术/手艺(摄影)、历史、图书馆使用、其他语种、心理学、说服
  { id: "journalist-1920s", nameZh: "记者", nameEn: "Journalist", era: "1920s",
    coreSkills: [br("art-craft", "art-craft-photography"), s("history"), s("library-use"), any("language-other"), s("psychology"), s("persuade")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 律师：会计、法律、图书馆使用、其他语种、心理学、说服
  { id: "lawyer-1920s", nameZh: "律师", nameEn: "Lawyer", era: "1920s",
    coreSkills: [s("accounting"), s("law"), s("library-use"), any("language-other"), s("psychology"), s("persuade")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 图书管理员：会计、图书馆使用、其他语种 ×2、自定 2
  { id: "librarian-1920s", nameZh: "图书管理员", nameEn: "Librarian", era: "1920s",
    coreSkills: [s("accounting"), s("library-use"), any("language-other"), any("language-other"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 军官：会计、火器(任一)、急救、领导力(说服)、导航、心理学
  // 注：领导力在 7e 标准技能里没有独立条目，按文档以"说服"代之
  { id: "military-officer-1920s", nameZh: "军官", nameEn: "Military Officer", era: "1920s",
    coreSkills: [s("accounting"), any("firearms"), s("first-aid"), s("persuade"), s("navigate"), s("psychology")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA,
    notes: "原表'领导力'对应 7e 通用规则中以说服替代;若日后扩 leadership 技能,在此条改 id。" },
  // 传教士：艺术/手艺、急救、机械维修、医学、博物、其他语种、说服
  { id: "missionary-1920s", nameZh: "传教士", nameEn: "Missionary", era: "1920s",
    coreSkills: [any("art-craft"), s("first-aid"), s("mechanical-repair"), s("medicine"), s("natural-world"), any("language-other"), s("persuade")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 音乐家：艺术/手艺(乐器)、历史 或 博物、聆听、心理学、说服、自定 2
  { id: "musician-1920s", nameZh: "音乐家", nameEn: "Musician", era: "1920s",
    coreSkills: [br("art-craft", "art-craft-instrument"), oneOf(s("history"), s("natural-world")), s("listen"), s("psychology"), s("persuade"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 神秘学家：人类学、历史、图书馆使用、其他语种、神秘学、心理学、自定 1
  { id: "occultist-1920s", nameZh: "神秘学家", nameEn: "Occultist", era: "1920s",
    coreSkills: [s("anthropology"), s("history"), s("library-use"), any("language-other"), s("occult"), s("psychology"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 超心理学家：人类学、考古学、历史、图书馆使用、其他语种、神秘学、心理学
  { id: "parapsychologist-1920s", nameZh: "超心理学家", nameEn: "Parapsychologist", era: "1920s",
    coreSkills: [s("anthropology"), s("archaeology"), s("history"), s("library-use"), any("language-other"), s("occult"), s("psychology")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 飞行员：电气维修、机械维修、导航、操作重型机械、科学(天文学)、驾驶(飞机)、自定 1
  // 注：1920s 飞机驾驶用 drive-aircraft 占位 (modern era 才默认开放)；这里强制借用同一分支 id。
  { id: "pilot-1920s", nameZh: "飞行员", nameEn: "Pilot", era: "1920s",
    coreSkills: [s("electrical-repair"), s("mechanical-repair"), s("navigate"), s("operate-heavy-machinery"), br("science", "science-astronomy"), br("drive", "drive-aircraft"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA,
    notes: "原表'驾驶(飞机)'借用 drive-aircraft 分支 id,该分支 modern 限定;UI 解析时需对此职业放宽过滤。" },
  // 教授:图书馆使用、其他语种 ×2、心理学、自定 3
  { id: "professor-1920s", nameZh: "教授", nameEn: "Professor", era: "1920s",
    coreSkills: [s("library-use"), any("language-other"), any("language-other"), s("psychology"), free(3)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 销售员:会计、艺术/手艺、心理学、说服、自定 2
  { id: "salesperson-1920s", nameZh: "销售员", nameEn: "Salesperson", era: "1920s",
    coreSkills: [s("accounting"), any("art-craft"), s("psychology"), s("persuade"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 科学家:艺术/手艺(技术绘图)、图书馆使用、其他语种、心理学、科学(主)、科学(副 ×2)
  // 主/副 都用 anyBranchOf 表达,玩家在 UI 里实际选三项不同分支
  { id: "scientist-1920s", nameZh: "科学家", nameEn: "Scientist", era: "1920s",
    coreSkills: [br("art-craft", "art-craft-drafting"), s("library-use"), any("language-other"), s("psychology"), any("science"), any("science"), any("science")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 士兵:攀爬 或 游泳、火器(任一)、急救、格斗(斗殴)、潜行、求生
  { id: "soldier-1920s", nameZh: "士兵", nameEn: "Soldier", era: "1920s",
    coreSkills: [oneOf(s("climb"), s("swim")), any("firearms"), s("first-aid"), br("fighting", "fighting-brawl"), s("stealth"), any("survival")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 部族成员:攀爬 或 游泳、格斗(任一)、博物、心理学、潜行、求生、投掷、追踪
  { id: "tribe-member-1920s", nameZh: "部族成员", nameEn: "Tribe Member", era: "1920s",
    coreSkills: [oneOf(s("climb"), s("swim")), any("fighting"), s("natural-world"), s("psychology"), s("stealth"), any("survival"), s("throw"), s("track")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 狂信者:历史、聆听、说服、心理学、潜行、自定 3
  { id: "zealot-1920s", nameZh: "狂信者", nameEn: "Zealot", era: "1920s",
    coreSkills: [s("history"), s("listen"), s("persuade"), s("psychology"), s("stealth"), free(3)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 大狩猎者:火器(步枪)、博物、聆听、潜行、追踪、求生、急救
  { id: "big-game-hunter-1920s", nameZh: "大狩猎者", nameEn: "Big Game Hunter", era: "1920s",
    coreSkills: [br("firearms", "firearms-rifle"), s("natural-world"), s("listen"), s("stealth"), s("track"), any("survival"), s("first-aid")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 拳击手/摔角手:格斗(斗殴 或 摔跤)、聆听、心理学、跳跃、自定 2
  // 注:摔跤在合并表里没有独立分支,统一以 fighting-brawl 表达
  { id: "boxer-1920s", nameZh: "拳击手/摔角手", nameEn: "Boxer / Wrestler", era: "1920s",
    coreSkills: [br("fighting", "fighting-brawl"), s("listen"), s("psychology"), s("jump"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA,
    notes: "原表'摔跤'分支并入 fighting-brawl;若后续拆出 fighting-wrestle 分支,改 oneOf。" },
  // 私酒贩:会计、电气维修、火器(手枪)、机械维修、驾驶(汽车)、自定 2
  { id: "bootlegger-1920s", nameZh: "私酒贩", nameEn: "Bootlegger", era: "1920s",
    coreSkills: [s("accounting"), s("electrical-repair"), br("firearms", "firearms-handgun"), s("mechanical-repair"), br("drive", "drive-auto"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 管家/私人侍者:会计、艺术/手艺(任一)、聆听、其他语种、心理学、说服
  { id: "butler-1920s", nameZh: "管家 / 私人侍者", nameEn: "Butler / Valet", era: "1920s",
    coreSkills: [s("accounting"), any("art-craft"), s("listen"), any("language-other"), s("psychology"), s("persuade")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 司机:电气维修、聆听、机械维修、导航、心理学、驾驶(汽车)、自定 1
  { id: "chauffeur-1920s", nameZh: "司机", nameEn: "Chauffeur", era: "1920s",
    coreSkills: [s("electrical-repair"), s("listen"), s("mechanical-repair"), s("navigate"), s("psychology"), br("drive", "drive-auto"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 牛仔:火器(步枪)、博物、骑术、追踪、跳跃、求生、投掷
  { id: "cowboy-1920s", nameZh: "牛仔", nameEn: "Cowboy", era: "1920s",
    coreSkills: [br("firearms", "firearms-rifle"), s("natural-world"), s("ride"), s("track"), s("jump"), any("survival"), s("throw")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 探险家:攀爬、急救、历史、博物、导航、其他语种、骑术、求生
  { id: "explorer-1920s", nameZh: "探险家", nameEn: "Explorer", era: "1920s",
    coreSkills: [s("climb"), s("first-aid"), s("history"), s("natural-world"), s("navigate"), any("language-other"), s("ride"), any("survival")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 赌徒:会计、艺术/手艺(表演)、聆听、心理学、说服、妙手、侦查
  { id: "gambler-1920s", nameZh: "赌徒", nameEn: "Gambler", era: "1920s",
    coreSkills: [s("accounting"), br("art-craft", "art-craft-acting"), s("listen"), s("psychology"), s("persuade"), s("sleight-of-hand"), s("spot-hidden")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 黑帮/暴徒:火器(手枪 或 冲锋枪)、驾驶(汽车)、格斗(斗殴)、心理学、潜行、自定 1
  { id: "gangster-1920s", nameZh: "黑帮 / 暴徒", nameEn: "Gangster", era: "1920s",
    coreSkills: [oneOf(br("firearms", "firearms-handgun"), br("firearms", "firearms-smg")), br("drive", "drive-auto"), br("fighting", "fighting-brawl"), s("psychology"), s("stealth"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 江湖郎中:会计、艺术/手艺(表演)、乔装、聆听、心理学、说服、妙手
  { id: "mountebank-1920s", nameZh: "江湖郎中", nameEn: "Mountebank", era: "1920s",
    coreSkills: [s("accounting"), br("art-craft", "art-craft-acting"), s("disguise"), s("listen"), s("psychology"), s("persuade"), s("sleight-of-hand")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 摄影师:艺术/手艺(摄影)、化学、潜行、心理学、侦查、自定 1
  { id: "photographer-1920s", nameZh: "摄影师", nameEn: "Photographer", era: "1920s",
    coreSkills: [br("art-craft", "art-craft-photography"), br("science", "science-chemistry"), s("stealth"), s("psychology"), s("spot-hidden"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 禁酒探员:法律、火器(手枪)、心理学、说服、侦查、潜行、急救
  { id: "prohibition-agent-1920s", nameZh: "禁酒探员", nameEn: "Prohibition Agent", era: "1920s",
    coreSkills: [s("law"), br("firearms", "firearms-handgun"), s("psychology"), s("persuade"), s("spot-hidden"), s("stealth"), s("first-aid")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 间谍:艺术/手艺(伪装 或 摄影)、乔装、火器(手枪)、聆听、其他语种、心理学、潜行、侦查
  { id: "spy-1920s", nameZh: "间谍", nameEn: "Spy", era: "1920s",
    coreSkills: [oneOf(br("art-craft", "art-craft-forgery"), br("art-craft", "art-craft-photography")), s("disguise"), br("firearms", "firearms-handgun"), s("listen"), any("language-other"), s("psychology"), s("stealth"), s("spot-hidden")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
];

// =============================================================================
// 表二 · 现代职业（39 条）
// =============================================================================

export const OCCUPATIONS_MODERN: OccupationTemplate[] = [
  // 古董商：估价、艺术/手艺(任一)、历史、图书馆使用、其他语种、聆听、侦查
  { id: "antiquarian-modern", nameZh: "古董商", nameEn: "Antiquarian", era: "modern",
    coreSkills: [s("appraise"), any("art-craft"), s("history"), s("library-use"), any("language-other"), s("listen"), s("spot-hidden")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 艺术家：艺术/手艺(任一)、历史 或 博物 或 神秘学、其他语种、心理学、聆听、侦查、自定 1
  { id: "artist-modern", nameZh: "艺术家", nameEn: "Artist", era: "modern",
    coreSkills: [any("art-craft"), oneOf(s("history"), s("natural-world"), s("occult")), any("language-other"), s("psychology"), s("listen"), s("spot-hidden"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 运动员：攀爬、跳跃、格斗(斗殴)、骑术 或 游泳、投掷、心理学、聆听
  { id: "athlete-modern", nameZh: "运动员", nameEn: "Athlete", era: "modern",
    coreSkills: [s("climb"), s("jump"), br("fighting", "fighting-brawl"), oneOf(s("ride"), s("swim")), s("throw"), s("psychology"), s("listen")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 作家：艺术(写作)、历史、图书馆使用、其他语种、心理学、自定 1
  { id: "author-modern", nameZh: "作家", nameEn: "Author", era: "modern",
    coreSkills: [br("art-craft", "art-craft-writing"), s("history"), s("library-use"), any("language-other"), s("psychology"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 神职人员：会计、历史、图书馆使用、聆听、其他语种、心理学、说服
  { id: "clergy-modern", nameZh: "神职人员", nameEn: "Clergy", era: "modern",
    coreSkills: [s("accounting"), s("history"), s("library-use"), s("listen"), any("language-other"), s("psychology"), s("persuade")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 计算机程序员：计算机使用、电子学、图书馆使用、其他语种、科学(数学 或 计算机)、自定 1
  { id: "computer-programmer-modern", nameZh: "计算机程序员", nameEn: "Computer Programmer", era: "modern",
    coreSkills: [s("computer-use"), s("electronics"), s("library-use"), any("language-other"), oneOf(br("science", "science-mathematics"), br("science", "science-computer")), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 计算机技师：计算机使用、电子学、电气维修、图书馆使用、机械维修、科学(电子)、自定 1
  // 注：文档"科学(电子)"在合并表里没有独立分支，按 modern 独占的 science-computer 兜底
  { id: "computer-technician-modern", nameZh: "计算机技师", nameEn: "Computer Technician", era: "modern",
    coreSkills: [s("computer-use"), s("electronics"), s("electrical-repair"), s("library-use"), s("mechanical-repair"), br("science", "science-computer"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 罪犯：锁匠 或 妙手、乔装、格斗(斗殴) 或 火器(手枪)、潜行、心理学、聆听、侦查
  { id: "criminal-modern", nameZh: "罪犯", nameEn: "Criminal", era: "modern",
    coreSkills: [oneOf(s("locksmith"), s("sleight-of-hand")), s("disguise"), oneOf(br("fighting", "fighting-brawl"), br("firearms", "firearms-handgun")), s("stealth"), s("psychology"), s("listen"), s("spot-hidden")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 医师：急救、医学、其他语种(拉丁)、心理学、科学(生物学)、科学(药学)、自定 1
  { id: "doctor-modern", nameZh: "医师", nameEn: "Doctor of Medicine", era: "modern",
    coreSkills: [s("first-aid"), s("medicine"), br("language-other", "lang-latin"), s("psychology"), br("science", "science-biology"), br("science", "science-pharmacy"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 司机（modern Driver）：聆听、机械维修、导航、心理学、侦查、驾驶(汽车)、自定 1
  { id: "driver-modern", nameZh: "司机", nameEn: "Driver", era: "modern",
    coreSkills: [s("listen"), s("mechanical-repair"), s("navigate"), s("psychology"), s("spot-hidden"), br("drive", "drive-auto"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 工程师：艺术/手艺(技术绘图)、电气维修、图书馆使用、机械维修、操作重型机械、科学(工程学 或 物理学)、自定 1
  { id: "engineer-modern", nameZh: "工程师", nameEn: "Engineer", era: "modern",
    coreSkills: [br("art-craft", "art-craft-drafting"), s("electrical-repair"), s("library-use"), s("mechanical-repair"), s("operate-heavy-machinery"), oneOf(br("science", "science-engineering"), br("science", "science-physics")), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 艺人：艺术/手艺(表演)、乔装、聆听、心理学、说服、自定 2
  { id: "entertainer-modern", nameZh: "艺人", nameEn: "Entertainer", era: "modern",
    coreSkills: [br("art-craft", "art-craft-acting"), s("disguise"), s("listen"), s("psychology"), s("persuade"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 联邦特工：计算机使用、火器(手枪)、急救、聆听、心理学、说服、侦查、追踪
  { id: "federal-agent-modern", nameZh: "联邦特工", nameEn: "Federal Agent", era: "modern",
    coreSkills: [s("computer-use"), br("firearms", "firearms-handgun"), s("first-aid"), s("listen"), s("psychology"), s("persuade"), s("spot-hidden"), s("track")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 黑客：计算机使用、电子学、电气维修、图书馆使用、其他语种、心理学、自定 1
  { id: "hacker-modern", nameZh: "黑客", nameEn: "Hacker", era: "modern",
    coreSkills: [s("computer-use"), s("electronics"), s("electrical-repair"), s("library-use"), any("language-other"), s("psychology"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 私家侦探：艺术/手艺(摄影)、乔装、法律、图书馆使用、心理学、侦查、潜行
  { id: "private-investigator-modern", nameZh: "私家侦探", nameEn: "Private Investigator", era: "modern",
    coreSkills: [br("art-craft", "art-craft-photography"), s("disguise"), s("law"), s("library-use"), s("psychology"), s("spot-hidden"), s("stealth")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 警探：艺术/手艺(表演)、火器(手枪)、法律、聆听、心理学、说服、侦查、追踪
  { id: "police-detective-modern", nameZh: "警探", nameEn: "Police Detective", era: "modern",
    coreSkills: [br("art-craft", "art-craft-acting"), br("firearms", "firearms-handgun"), s("law"), s("listen"), s("psychology"), s("persuade"), s("spot-hidden"), s("track")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 警员：火器(手枪 或 霰弹枪)、急救、格斗(斗殴)、法律、心理学、说服、侦查
  { id: "police-officer-modern", nameZh: "警员", nameEn: "Police Officer", era: "modern",
    coreSkills: [oneOf(br("firearms", "firearms-handgun"), br("firearms", "firearms-rifle")), s("first-aid"), br("fighting", "fighting-brawl"), s("law"), s("psychology"), s("persuade"), s("spot-hidden")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 记者：艺术/手艺(摄影)、历史、图书馆使用、其他语种、心理学、说服
  { id: "journalist-modern", nameZh: "记者", nameEn: "Journalist", era: "modern",
    coreSkills: [br("art-craft", "art-craft-photography"), s("history"), s("library-use"), any("language-other"), s("psychology"), s("persuade")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 律师：会计、法律、图书馆使用、其他语种、心理学、说服
  { id: "lawyer-modern", nameZh: "律师", nameEn: "Lawyer", era: "modern",
    coreSkills: [s("accounting"), s("law"), s("library-use"), any("language-other"), s("psychology"), s("persuade")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 实验室技师：计算机使用、其他语种、科学(主)、科学(副)、电子学、图书馆使用、自定 1
  // 注：文档"科学(主) + 科学(副)"用 freeSlot(2) 让玩家自由挑两个 science 分支；这里折成 anyBranchOf x2 显式
  { id: "lab-technician-modern", nameZh: "实验室技师", nameEn: "Lab Technician", era: "modern",
    coreSkills: [s("computer-use"), any("language-other"), any("science"), any("science"), s("electronics"), s("library-use"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 图书管理员：会计、图书馆使用、其他语种 ×2、自定 2
  { id: "librarian-modern", nameZh: "图书管理员", nameEn: "Librarian", era: "modern",
    coreSkills: [s("accounting"), s("library-use"), any("language-other"), any("language-other"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 媒体名人：艺术/手艺(表演)、心理学、说服、聆听、其他语种、自定 1
  { id: "media-personality-modern", nameZh: "媒体名人", nameEn: "Media Personality", era: "modern",
    coreSkills: [br("art-craft", "art-craft-acting"), s("psychology"), s("persuade"), s("listen"), any("language-other"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 军官：会计、火器(任一)、急救、领导力(说服)、导航、心理学
  // 注：文档"领导力(说服)"在合并表里没有独立"领导力"技能，按 7e 惯例折成 persuade
  { id: "military-officer-modern", nameZh: "军官", nameEn: "Military Officer", era: "modern",
    coreSkills: [s("accounting"), any("firearms"), s("first-aid"), s("persuade"), s("navigate"), s("psychology")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 音乐家：艺术/手艺(乐器)、历史 或 博物、聆听、心理学、说服、自定 2
  { id: "musician-modern", nameZh: "音乐家", nameEn: "Musician", era: "modern",
    coreSkills: [br("art-craft", "art-craft-instrument"), oneOf(s("history"), s("natural-world")), s("listen"), s("psychology"), s("persuade"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 护士：急救、医学、心理学、聆听、说服、科学(生物学)、自定 1
  { id: "nurse-modern", nameZh: "护士", nameEn: "Nurse", era: "modern",
    coreSkills: [s("first-aid"), s("medicine"), s("psychology"), s("listen"), s("persuade"), br("science", "science-biology"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 神秘学家：人类学、历史、图书馆使用、其他语种、神秘学、心理学、自定 1
  { id: "occultist-modern", nameZh: "神秘学家", nameEn: "Occultist", era: "modern",
    coreSkills: [s("anthropology"), s("history"), s("library-use"), any("language-other"), s("occult"), s("psychology"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 超心理学家：人类学、考古学、历史、图书馆使用、其他语种、神秘学、心理学
  { id: "parapsychologist-modern", nameZh: "超心理学家", nameEn: "Parapsychologist", era: "modern",
    coreSkills: [s("anthropology"), s("archaeology"), s("history"), s("library-use"), any("language-other"), s("occult"), s("psychology")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 飞行员：电气维修、机械维修、导航、操作重型机械、科学(天文学)、驾驶(飞机)、自定 1
  { id: "pilot-modern", nameZh: "飞行员", nameEn: "Pilot", era: "modern",
    coreSkills: [s("electrical-repair"), s("mechanical-repair"), s("navigate"), s("operate-heavy-machinery"), br("science", "science-astronomy"), br("drive", "drive-aircraft"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 教授：图书馆使用、其他语种 ×2、心理学、自定 3
  { id: "professor-modern", nameZh: "教授", nameEn: "Professor", era: "modern",
    coreSkills: [s("library-use"), any("language-other"), any("language-other"), s("psychology"), free(3)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 销售员：会计、艺术/手艺、心理学、说服、自定 2
  { id: "salesperson-modern", nameZh: "销售员", nameEn: "Salesperson", era: "modern",
    coreSkills: [s("accounting"), any("art-craft"), s("psychology"), s("persuade"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 科学家（modern）：艺术/手艺(技术绘图)、计算机使用、其他语种、心理学、科学(主)、科学(副 ×2)
  { id: "scientist-modern", nameZh: "科学家", nameEn: "Scientist", era: "modern",
    coreSkills: [br("art-craft", "art-craft-drafting"), s("computer-use"), any("language-other"), s("psychology"), any("science"), any("science"), any("science")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 士兵：攀爬 或 游泳、火器(任一)、急救、格斗(斗殴)、潜行、求生
  { id: "soldier-modern", nameZh: "士兵", nameEn: "Soldier", era: "modern",
    coreSkills: [oneOf(s("climb"), s("swim")), any("firearms"), s("first-aid"), br("fighting", "fighting-brawl"), s("stealth"), any("survival")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 间谍：艺术/手艺(摄影 或 伪装)、乔装、火器(手枪)、聆听、其他语种、心理学、潜行、侦查
  // 注：合并表 art-craft 没有"伪装"分支，按文档原话保留摄影分支
  { id: "spy-modern", nameZh: "间谍", nameEn: "Spy / Intelligence Agent", era: "modern",
    coreSkills: [br("art-craft", "art-craft-photography"), s("disguise"), br("firearms", "firearms-handgun"), s("listen"), any("language-other"), s("psychology"), s("stealth"), s("spot-hidden")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 特技人：艺术/手艺(任一)、攀爬、急救、格斗(斗殴)、跳跃、心理学、自定 1
  { id: "stuntman-modern", nameZh: "特技人", nameEn: "Stuntman", era: "modern",
    coreSkills: [any("art-craft"), s("climb"), s("first-aid"), br("fighting", "fighting-brawl"), s("jump"), s("psychology"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 卡车司机：电气维修、聆听、机械维修、导航、操作重型机械、心理学、驾驶(汽车)
  { id: "truck-driver-modern", nameZh: "卡车司机", nameEn: "Truck Driver", era: "modern",
    coreSkills: [s("electrical-repair"), s("listen"), s("mechanical-repair"), s("navigate"), s("operate-heavy-machinery"), s("psychology"), br("drive", "drive-truck")],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 流浪汉：攀爬、跳跃、聆听、博物、潜行、自定 2
  { id: "drifter-modern", nameZh: "流浪汉", nameEn: "Drifter", era: "modern",
    coreSkills: [s("climb"), s("jump"), s("listen"), s("natural-world"), s("stealth"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 拳击手/摔角手：格斗(斗殴 或 摔跤)、聆听、心理学、跳跃、自定 2
  // 注：合并表 fighting 没有"摔跤"独立分支，按 brawl 兜底
  { id: "boxer-modern", nameZh: "拳击手/摔角手", nameEn: "Boxer / Wrestler", era: "modern",
    coreSkills: [br("fighting", "fighting-brawl"), s("listen"), s("psychology"), s("jump"), free(2)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 摄影师：艺术/手艺(摄影)、化学、潜行、心理学、侦查、自定 1
  { id: "photographer-modern", nameZh: "摄影师", nameEn: "Photographer", era: "modern",
    coreSkills: [br("art-craft", "art-craft-photography"), br("science", "science-chemistry"), s("stealth"), s("psychology"), s("spot-hidden"), free(1)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
  // 狂信者：历史、聆听、说服、心理学、潜行、自定 3
  { id: "zealot-modern", nameZh: "狂信者", nameEn: "Zealot", era: "modern",
    coreSkills: [s("history"), s("listen"), s("persuade"), s("psychology"), s("stealth"), free(3)],
    occupationPointFormula: DEFAULT_OCCUPATION_POINT_FORMULA },
];

// =============================================================================
// 查询 helpers
// =============================================================================

export function getOccupations(era: "1920s" | "modern"): OccupationTemplate[] {
  return era === "1920s" ? OCCUPATIONS_1920S : OCCUPATIONS_MODERN;
}

export function findOccupation(era: "1920s" | "modern", id: string): OccupationTemplate | undefined {
  return getOccupations(era).find((o) => o.id === id);
}

/**
 * 计算某职业模板"核心技能槽位总数"(含 freeSlot 的 count、oneOf 计 1)。
 * 用于阶段 4/5 的数据自检:必须 ≤ 8。
 */
export function countOccupationSlots(template: OccupationTemplate): number {
  return template.coreSkills.reduce((sum, ref) => {
    if (ref.kind === "freeSlot") return sum + ref.count;
    return sum + 1;
  }, 0);
}
