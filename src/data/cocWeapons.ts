/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CoC 7e 武器表（按口径合并版，见 .docs/coc-weapons.md）。
 *
 * 关键约定：
 * - 单一 `WEAPON_REGISTRY_ALL`，时代差异通过 `era: "1920s" | "modern" | "any"` 表达
 *   （与 cocSkills 表 era 过滤同模式）。`any` = 跨代通用（拳脚 / 投掷 / 弓 / 重机枪等）。
 * - skillRef 仅用 OccupationSkillRef 中的 `skill` / `branch` 两种 kind，对接合并表里的
 *   单技能（投掷 = `throw`）或多分支（火器(手枪) / 格斗(斗殴) / 格斗(剑) / ...）。
 * - 散弹枪伤害与射程是"近 / 中 / 远"三档字符串，由战斗规则按距离衰减，本表仅原样存储。
 * - 创建期 ammo = maxAmmo 自动写入；近战 / 投掷武器 maxAmmo = 0。
 * - DB 加成口径：melee = 加 DB，thrown = 加 ½DB，firearm = 不加 DB。
 *   通过 `damage.addDB` / `damage.halfDB` 标记，让战斗结算端用 cocRules.appendDamageBonus 处理。
 */

import type { OccupationSkillRef } from "./cocSkills";

export type WeaponEra = "1920s" | "modern" | "any";

export interface WeaponDamage {
  /** 主伤害公式，例如 "1D3" / "1D10+2" / "4D6 / 2D6 / 1D6"（散弹三档）/ "特殊"。 */
  formula: string;
  /** 近战武器：true → 战斗结算时加 DB。 */
  addDB?: boolean;
  /** 投掷 / 弓：true → 战斗结算时加 ½DB（弩 = false，机械蓄力）。 */
  halfDB?: boolean;
}

export interface WeaponDefinition {
  id: string;
  nameZh: string;
  nameEn: string;
  era: WeaponEra;
  /** 关联技能或分支（仅用 skill / branch 两种 kind）。 */
  skillRef: OccupationSkillRef;
  damage: WeaponDamage;
  /** 射程描述串（"触及" / "15m" / "STR×3m" / 散弹三档 "10m / 20m / 50m"）。 */
  range: string;
  /** 每轮攻击次数（"1" / "2" / "1(3)" / "1/2" / "1 或 2"）。 */
  attacks: string;
  /** 装弹数；近战 / 投掷 / 单发投掷物 = 0 或 1。 */
  maxAmmo: number;
  /** 故障值（命中骰 ≥ 此值卡壳），可省略表示几乎不卡。 */
  malfunction?: number;
  notes?: string;
}

// =============================================================================
// 简写 helper
// =============================================================================

const sk = (id: string): OccupationSkillRef => ({ kind: "skill", id });
const br = (parentId: string, branchId: string): OccupationSkillRef => ({
  kind: "branch",
  parentId,
  branchId,
});

const FIGHT_BRAWL = br("fighting", "fighting-brawl");
const FIGHT_SWORD = br("fighting", "fighting-sword");
const FIGHT_AXE = br("fighting", "fighting-axe");
const FIGHT_CLUB = br("fighting", "fighting-club");
const FIGHT_WHIP = br("fighting", "fighting-whip");
const FIGHT_CHAINSAW = br("fighting", "fighting-chainsaw");

const FIRE_HANDGUN = br("firearms", "firearms-handgun");
const FIRE_RIFLE = br("firearms", "firearms-rifle");
const FIRE_SMG = br("firearms", "firearms-smg");
const FIRE_HEAVY = br("firearms", "firearms-heavy");
const FIRE_BOW = br("firearms", "firearms-bow");
const FIRE_FLAME = br("firearms", "firearms-flamethrower");

const THROW_SKILL = sk("throw");

// =============================================================================
// 数据：单一合并表
// =============================================================================

export const WEAPON_REGISTRY_ALL: WeaponDefinition[] = [
  // ---------- 近战 · 格斗(斗殴) / 棍棒 / 鞭 ----------
  { id: "fist",            nameZh: "拳头",          nameEn: "Fist/Punch",    era: "any", skillRef: FIGHT_BRAWL, damage: { formula: "1D3", addDB: true },     range: "触及", attacks: "1", maxAmmo: 0 },
  { id: "kick",            nameZh: "踢腿",          nameEn: "Kick",          era: "any", skillRef: FIGHT_BRAWL, damage: { formula: "1D3", addDB: true },     range: "触及", attacks: "1", maxAmmo: 0 },
  { id: "headbutt",        nameZh: "头槌",          nameEn: "Head Butt",     era: "any", skillRef: FIGHT_BRAWL, damage: { formula: "1D4", addDB: true },     range: "触及", attacks: "1", maxAmmo: 0 },
  { id: "grapple",         nameZh: "擒抱",          nameEn: "Grapple",       era: "any", skillRef: FIGHT_BRAWL, damage: { formula: "特殊" },                  range: "触及", attacks: "1", maxAmmo: 0, notes: "按 7e 战斗章节擒抱规则结算" },
  { id: "small-club",      nameZh: "警棍 / 短棒",   nameEn: "Small Club",    era: "any", skillRef: FIGHT_BRAWL, damage: { formula: "1D6", addDB: true },     range: "触及", attacks: "1", maxAmmo: 0 },
  { id: "large-club",      nameZh: "大棒 / 铁管",   nameEn: "Large Club",    era: "any", skillRef: FIGHT_CLUB,  damage: { formula: "1D8", addDB: true },     range: "触及", attacks: "1", maxAmmo: 0 },
  { id: "whip",            nameZh: "鞭子",          nameEn: "Whip",          era: "any", skillRef: FIGHT_WHIP,  damage: { formula: "1D3", halfDB: true },    range: "3m",   attacks: "1", maxAmmo: 0 },
  { id: "brass-knuckles",  nameZh: "指虎",          nameEn: "Brass Knuckles",era: "any", skillRef: FIGHT_BRAWL, damage: { formula: "1D3+1", addDB: true },   range: "触及", attacks: "1", maxAmmo: 0 },
  { id: "garrote",         nameZh: "钢丝绞索",      nameEn: "Garrote",       era: "any", skillRef: FIGHT_BRAWL, damage: { formula: "特殊" },                  range: "触及", attacks: "1", maxAmmo: 0, notes: "按 7e 擒抱 / 持续伤害规则结算" },

  // ---------- 近战 · 锐器 / 链锯 ----------
  { id: "knife-small",     nameZh: "小刀 / 匕首",   nameEn: "Small Knife",   era: "any",    skillRef: FIGHT_BRAWL,    damage: { formula: "1D4",     addDB: true }, range: "触及", attacks: "1", maxAmmo: 0 },
  { id: "knife-medium",    nameZh: "中型刀",        nameEn: "Medium Knife",  era: "any",    skillRef: FIGHT_SWORD,    damage: { formula: "1D4+2",   addDB: true }, range: "触及", attacks: "1", maxAmmo: 0 },
  { id: "knife-large",     nameZh: "大型刀 / 砍刀", nameEn: "Large Knife",   era: "any",    skillRef: FIGHT_SWORD,    damage: { formula: "1D8",     addDB: true }, range: "触及", attacks: "1", maxAmmo: 0 },
  { id: "sword",           nameZh: "剑 / 马刀",     nameEn: "Sword/Saber",   era: "any",    skillRef: FIGHT_SWORD,    damage: { formula: "1D8+1",   addDB: true }, range: "触及", attacks: "1", maxAmmo: 0 },
  { id: "axe-hand",        nameZh: "短斧",          nameEn: "Hand Axe",      era: "any",    skillRef: FIGHT_AXE,      damage: { formula: "1D6+1",   addDB: true }, range: "触及", attacks: "1", maxAmmo: 0 },
  { id: "axe-battle",      nameZh: "战斧 / 大斧",   nameEn: "Battle Axe",    era: "any",    skillRef: FIGHT_AXE,      damage: { formula: "1D8+2",   addDB: true }, range: "触及", attacks: "1", maxAmmo: 0 },
  { id: "chainsaw",        nameZh: "链锯",          nameEn: "Chainsaw",      era: "modern", skillRef: FIGHT_CHAINSAW, damage: { formula: "2D8" },                  range: "触及", attacks: "1", maxAmmo: 0, notes: "不加 DB（机械动力）" },

  // ---------- 投掷 · 弓 / 十字弓 ----------
  { id: "thrown-rock",     nameZh: "投掷石块 / 砖", nameEn: "Thrown Rock",     era: "any", skillRef: THROW_SKILL, damage: { formula: "1D4",     halfDB: true }, range: "STR×3m", attacks: "1",   maxAmmo: 0 },
  { id: "thrown-knife",    nameZh: "飞刀",          nameEn: "Thrown Knife",    era: "any", skillRef: THROW_SKILL, damage: { formula: "1D4",     halfDB: true }, range: "STR×3m", attacks: "1",   maxAmmo: 0 },
  { id: "spear-thrown",    nameZh: "标枪 / 短矛",   nameEn: "Spear (Thrown)",  era: "any", skillRef: THROW_SKILL, damage: { formula: "1D8",     halfDB: true }, range: "STR×3m", attacks: "1",   maxAmmo: 0 },
  { id: "bow",             nameZh: "弓",            nameEn: "Bow",             era: "any", skillRef: FIRE_BOW,    damage: { formula: "1D6+1",   halfDB: true }, range: "30m",    attacks: "1",   maxAmmo: 1 },
  { id: "crossbow",        nameZh: "十字弓",        nameEn: "Crossbow",        era: "any", skillRef: FIRE_BOW,    damage: { formula: "1D8+2" },                 range: "50m",    attacks: "1/2", maxAmmo: 1, notes: "不加 DB（机械蓄力）" },

  // ---------- 手枪 1920s（按口径合并 4 档） ----------
  { id: "pistol-small-1920s",   nameZh: ".22 / .25 自动手枪",       nameEn: "Small Auto (.22/.25)",      era: "1920s", skillRef: FIRE_HANDGUN, damage: { formula: "1D6"     }, range: "10m", attacks: "2",    maxAmmo: 6, malfunction: 100 },
  { id: "pistol-medium-1920s",  nameZh: ".32 / .380 自动手枪",      nameEn: "Medium Auto (.32/.380)",    era: "1920s", skillRef: FIRE_HANDGUN, damage: { formula: "1D8"     }, range: "15m", attacks: "2",    maxAmmo: 8, malfunction: 100 },
  { id: "revolver-38-1920s",    nameZh: ".38 警用左轮",             nameEn: ".38 Revolver",              era: "1920s", skillRef: FIRE_HANDGUN, damage: { formula: "1D10"    }, range: "15m", attacks: "1(3)", maxAmmo: 6, malfunction: 100 },
  { id: "pistol-heavy-1920s",   nameZh: ".44 / .45 自动 / 长型柯尔特",nameEn: "Heavy Auto (.44/.45)",     era: "1920s", skillRef: FIRE_HANDGUN, damage: { formula: "1D10+2"  }, range: "15m", attacks: "1",    maxAmmo: 7, malfunction: 100 },

  // ---------- 手枪 modern ----------
  { id: "pistol-small-modern",  nameZh: "小口径自动手枪 (.22/.25)", nameEn: "Small Auto",                era: "modern", skillRef: FIRE_HANDGUN, damage: { formula: "1D6"     }, range: "10m", attacks: "2",    maxAmmo: 7,  malfunction: 100 },
  { id: "pistol-9mm",           nameZh: "9mm 自动手枪 (格洛克 17 等)",nameEn: "9mm Auto (Glock 17)",      era: "modern", skillRef: FIRE_HANDGUN, damage: { formula: "1D10"    }, range: "15m", attacks: "3",    maxAmmo: 17, malfunction: 100 },
  { id: "revolver-357",         nameZh: ".357 马格南左轮",          nameEn: ".357 Magnum Revolver",      era: "modern", skillRef: FIRE_HANDGUN, damage: { formula: "1D8+1D4" }, range: "15m", attacks: "1(3)", maxAmmo: 6,  malfunction: 100 },
  { id: "pistol-heavy-modern",  nameZh: "大口径自动手枪 (.44/.45/沙鹰)", nameEn: "Heavy Auto (.44/.45)", era: "modern", skillRef: FIRE_HANDGUN, damage: { formula: "1D10+2"  }, range: "15m", attacks: "1",    maxAmmo: 8,  malfunction: 100 },

  // ---------- 步枪 ----------
  { id: "rifle-bolt-1920s",     nameZh: ".30 栓动步枪 / 卡宾枪",   nameEn: "Bolt-Action Rifle",          era: "1920s", skillRef: FIRE_RIFLE, damage: { formula: "2D6+4"  }, range: "110m", attacks: "1", maxAmmo: 5,  malfunction: 100 },
  { id: "rifle-22-any",         nameZh: ".22 步枪",                nameEn: ".22 Rifle",                  era: "any",    skillRef: FIRE_RIFLE, damage: { formula: "1D6+1"  }, range: "30m",  attacks: "1", maxAmmo: 6,  malfunction: 100 },
  { id: "rifle-semi-modern",    nameZh: "半自动步枪 (M1 / 民用 AR)", nameEn: "Semi-Auto Rifle",          era: "modern", skillRef: FIRE_RIFLE, damage: { formula: "2D6+3"  }, range: "90m",  attacks: "2", maxAmmo: 10, malfunction: 100 },
  { id: "rifle-50",             nameZh: ".50 大口径步枪 / 反器材", nameEn: ".50 Rifle",                  era: "any",    skillRef: FIRE_RIFLE, damage: { formula: "2D10+4" }, range: "150m", attacks: "1", maxAmmo: 5,  malfunction: 100 },

  // ---------- 散弹枪 ----------
  { id: "shotgun-double-1920s", nameZh: "双管散弹枪（短管）",      nameEn: "Double-Barrel Shotgun",      era: "1920s", skillRef: FIRE_RIFLE, damage: { formula: "4D6 / 2D6 / 1D6" }, range: "10m / 20m / 50m", attacks: "1 或 2", maxAmmo: 2, malfunction: 100, notes: "近 / 中 / 远三档伤害与射程" },
  { id: "shotgun-pump-any",     nameZh: "泵动散弹枪 (温彻斯特 1897 / 雷明顿 870)", nameEn: "Pump Shotgun", era: "any", skillRef: FIRE_RIFLE, damage: { formula: "4D6 / 2D6 / 1D6" }, range: "10m / 20m / 50m", attacks: "1",    maxAmmo: 5, malfunction: 100, notes: "近 / 中 / 远三档伤害与射程" },
  { id: "shotgun-semi-modern",  nameZh: "半自动战斗散弹枪 (贝内利 M4 / SPAS-12)", nameEn: "Semi-Auto Shotgun", era: "modern", skillRef: FIRE_RIFLE, damage: { formula: "4D6 / 2D6 / 1D6" }, range: "10m / 20m / 50m", attacks: "2", maxAmmo: 8, malfunction: 100, notes: "近 / 中 / 远三档伤害与射程" },

  // ---------- 冲锋 / 突击 ----------
  { id: "smg-thompson",         nameZh: "汤普森冲锋枪",            nameEn: "Thompson SMG",               era: "1920s", skillRef: FIRE_SMG,   damage: { formula: "1D10+2" }, range: "20m",  attacks: "1(3)", maxAmmo: 30, malfunction: 96 },
  { id: "smg-mp5",              nameZh: "MP5 / 现代冲锋枪",        nameEn: "MP5 (Modern SMG)",           era: "modern", skillRef: FIRE_SMG,   damage: { formula: "1D10"    }, range: "20m",  attacks: "1(3)", maxAmmo: 30, malfunction: 100 },
  { id: "assault-ak47",         nameZh: "AK-47 / AKM",              nameEn: "AK-47",                      era: "modern", skillRef: FIRE_RIFLE, damage: { formula: "2D6+1"   }, range: "90m",  attacks: "1(3)", maxAmmo: 30, malfunction: 96 },
  { id: "assault-m16",          nameZh: "M16 / M4 / AR-15",         nameEn: "M16/AR-15",                  era: "modern", skillRef: FIRE_RIFLE, damage: { formula: "2D6"     }, range: "100m", attacks: "1(3)", maxAmmo: 30, malfunction: 100 },

  // ---------- 重武器与爆炸物 ----------
  { id: "mg-heavy",             nameZh: "重机枪 (.30 / .50)",       nameEn: "Heavy Machine Gun",          era: "any", skillRef: FIRE_HEAVY,  damage: { formula: "2D6+4"     }, range: "150m",   attacks: "1(10)", maxAmmo: 100, malfunction: 96 },
  { id: "flamethrower",         nameZh: "火焰喷射器",               nameEn: "Flamethrower",                era: "any", skillRef: FIRE_FLAME,  damage: { formula: "2D6 燃烧" },   range: "15m",    attacks: "1",     maxAmmo: 10,  malfunction: 100, notes: "持续燃烧按 7e 战斗章节处理" },
  { id: "grenade-frag",         nameZh: "手雷 / 碎片手榴弹",        nameEn: "Frag Grenade",                era: "any", skillRef: THROW_SKILL, damage: { formula: "4D10 (3m 内)" }, range: "STR×3m", attacks: "1",   maxAmmo: 1,   malfunction: 100, notes: "范围杀伤按 7e 战斗章节处理" },
  { id: "bazooka",              nameZh: "火箭筒 / RPG",             nameEn: "Bazooka/RPG",                 era: "any", skillRef: FIRE_HEAVY,  damage: { formula: "6D6 + 燃烧" }, range: "100m",   attacks: "1",     maxAmmo: 1,   malfunction: 99 },
];

// =============================================================================
// 对外 API
// =============================================================================

/** 按时代过滤可见武器（era === "any" 总是可见）。 */
export function getWeaponList(era: "1920s" | "modern"): WeaponDefinition[] {
  return WEAPON_REGISTRY_ALL.filter((w) => w.era === "any" || w.era === era);
}

/** 按 id 查武器（O(n) 顺序扫描；表小于 50 条不需要建索引）。 */
export function findWeapon(id: string): WeaponDefinition | undefined {
  return WEAPON_REGISTRY_ALL.find((w) => w.id === id);
}

/** 武器条目的中文 + 数据小字摘要（UI 槽位副信息行用）。 */
export function describeWeapon(w: WeaponDefinition): string {
  const parts = [w.damage.formula];
  if (w.damage.addDB) parts.push("+DB");
  else if (w.damage.halfDB) parts.push("+½DB");
  parts.push(w.range);
  if (w.maxAmmo > 0) parts.push(`弹 ${w.maxAmmo}`);
  return parts.join(" · ");
}
