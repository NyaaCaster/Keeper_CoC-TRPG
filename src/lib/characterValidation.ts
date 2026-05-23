/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 调查员角色卡严格校验器 — 与 .docs/character-dictionary.yaml 对齐。
 *
 * 主要用例：「上传角色卡图片」导入流程，对解出来的 JSON payload 做硬性校验，
 * 任何字典表偏差（缺字段、八维越界、技能键名不在合并表里、派生值与公式不一致等）
 * 都直接拒绝。让玩家在导出端修正源头，避免数据腐烂渗入存档。
 *
 * 不做任何"自动归一化 / 兜底改写"——这是给上传环节的，不应静默改玩家数据。
 */

import type { CharacterSheet } from "../types";
import {
  computeDamageBonusAndBuild,
  computeMov,
  dodgeOf,
  maxSanLimitOf,
  startingCashOf,
} from "./cocRules";
import { parseSkillName } from "./cocSkillSlots";

export interface ValidationIssue {
  /** 字典表节序号 / 字段路径，例：'character_sheet.attributes.str' */
  path: string;
  /** 给玩家看的中文说明。 */
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** 校验通过时的规整 sheet（仅做了 number 截断 / 删除创建期非法字段，不改语义）。 */
  sheet?: CharacterSheet;
}

const ATTR_KEYS = ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"] as const;

const ALLOWED_GENDER = new Set(["男", "女", "未详"]);
const ALLOWED_BACKGROUND = new Set(["1920s", "modern"]);
const ALLOWED_MADNESS = new Set([null, "bout", "temporary", "indefinite"]);

/**
 * 严格校验角色卡 JSON。返回 issues 列表，ok = issues.length === 0。
 * 不抛错；调用方负责把 issues 渲染成红字。
 */
export function validateCharacterSheet(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const push = (path: string, message: string) => issues.push({ path, message });

  if (!input || typeof input !== "object") {
    return { ok: false, issues: [{ path: "$root", message: "角色卡 payload 不是合法对象。" }] };
  }
  const sheet = input as Partial<CharacterSheet> & Record<string, unknown>;

  // ---- 1. 基础信息 ----
  if (typeof sheet.name !== "string" || !sheet.name.trim()) push("name", "缺少角色姓名（name）。");
  if (typeof sheet.occupation !== "string" || !sheet.occupation.trim()) push("occupation", "缺少职业（occupation）。");
  if (typeof sheet.gender !== "string" || !ALLOWED_GENDER.has(sheet.gender)) {
    push("gender", `gender 必须是 "男" / "女" / "未详" 之一，收到 "${String(sheet.gender)}"。`);
  }
  if (typeof sheet.age !== "number" || !Number.isInteger(sheet.age) || sheet.age < 10 || sheet.age > 100) {
    push("age", `age 必须是 [10, 100] 的整数，收到 ${String(sheet.age)}。`);
  }
  if (typeof sheet.background !== "string" || !ALLOWED_BACKGROUND.has(sheet.background)) {
    push("background", `background 必须是 "1920s" / "modern"，收到 "${String(sheet.background)}"。`);
  }
  const era = (sheet.background as "1920s" | "modern" | undefined) ?? "1920s";

  for (const key of ["identity", "nationality", "residence", "motherTongue", "backgroundStory"] as const) {
    if (sheet[key] !== undefined && typeof sheet[key] !== "string") {
      push(key, `${key} 必须是字符串或缺省。`);
    }
  }
  if (sheet.creditRating !== undefined) {
    const cr = sheet.creditRating;
    if (typeof cr !== "number" || !Number.isFinite(cr) || cr < 0 || cr > 99 || !Number.isInteger(cr)) {
      push("creditRating", `creditRating 必须是 [0, 99] 的整数，收到 ${String(cr)}。`);
    }
  }
  if (sheet.avatar !== undefined && typeof sheet.avatar !== "string") {
    push("avatar", "avatar 必须是字符串（base64 data URI）或缺省。");
  }

  // ---- 2. 八维属性 ----
  const attrs = sheet.attributes as unknown as Record<string, number> | undefined;
  if (!attrs || typeof attrs !== "object") {
    push("attributes", "缺少 attributes 八维属性对象。");
  } else {
    for (const k of ATTR_KEYS) {
      const v = attrs[k];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 99) {
        push(`attributes.${k}`, `${k.toUpperCase()} 必须是 [1, 99] 整数，收到 ${String(v)}。`);
      }
    }
  }

  // ---- 3. 技能（键名必须能 parseSkillName 解析）----
  const skills = sheet.skills as Record<string, unknown> | undefined;
  if (!skills || typeof skills !== "object") {
    push("skills", "缺少 skills 技能字典。");
  } else {
    if (!("克苏鲁神话" in skills)) push("skills.克苏鲁神话", "skills 必须包含 \"克苏鲁神话\": 0。");
    else if (skills["克苏鲁神话"] !== 0) push("skills.克苏鲁神话", `创建期 \"克苏鲁神话\" 必须为 0，收到 ${String(skills["克苏鲁神话"])}。`);

    for (const [name, val] of Object.entries(skills)) {
      if (name === "克苏鲁神话") continue;
      if (typeof val !== "number" || !Number.isFinite(val) || val < 0 || val > 99) {
        push(`skills["${name}"]`, `技能值必须是 [0, 99] 数字，收到 ${String(val)}。`);
        continue;
      }
      // 排除字典表明确不入 skills 的项
      if (name === "闪避" || name === "母语" || name === "信用评级") {
        push(`skills["${name}"]`, `"${name}" 不应出现在 skills 字典里（参见字典表第 5 节 excluded_from_skills）。`);
        continue;
      }
      const sel = parseSkillName(name, era);
      if (!sel) {
        const hint = suggestSkillName(name);
        push(`skills["${name}"]`, `技能键名 "${name}" 不在合并表中（era=${era}）。${hint}`);
      }
    }
  }

  // ---- 4. 派生数值（与公式严格一致）----
  if (attrs && ATTR_KEYS.every((k) => typeof attrs[k] === "number")) {
    const con = attrs.con as number, siz = attrs.siz as number, pow = attrs.pow as number;
    const expectedHp = Math.floor((con + siz) / 10);
    const expectedMp = Math.floor(pow / 5);
    const expectedSan = pow;
    if (sheet.maxHp !== expectedHp) push("maxHp", `maxHp 应为 floor((CON+SIZ)/10)=${expectedHp}，收到 ${String(sheet.maxHp)}。`);
    if (sheet.hp !== expectedHp) push("hp", `创建期 hp 应等于 maxHp=${expectedHp}，收到 ${String(sheet.hp)}。`);
    if (sheet.maxMp !== expectedMp) push("maxMp", `maxMp 应为 floor(POW/5)=${expectedMp}，收到 ${String(sheet.maxMp)}。`);
    if (sheet.mp !== expectedMp) push("mp", `创建期 mp 应等于 maxMp=${expectedMp}，收到 ${String(sheet.mp)}。`);
    if (sheet.maxSan !== expectedSan) push("maxSan", `maxSan 应为 POW=${expectedSan}，收到 ${String(sheet.maxSan)}。`);
    if (sheet.san !== expectedSan) push("san", `创建期 san 应等于 maxSan=${expectedSan}，收到 ${String(sheet.san)}。`);
  }
  if (typeof sheet.mythos !== "number" || sheet.mythos !== 0) {
    push("mythos", `创建期 mythos 必须为 0，收到 ${String(sheet.mythos)}。`);
  }
  const expectedSanLimit = maxSanLimitOf((sheet.mythos as number) ?? 0);
  if (sheet.maxSanLimit !== expectedSanLimit) {
    push("maxSanLimit", `maxSanLimit 应为 99 - mythos = ${expectedSanLimit}，收到 ${String(sheet.maxSanLimit)}。`);
  }

  // ---- 5. combatDerived（与 cocRules 一致）----
  if (attrs && ATTR_KEYS.every((k) => typeof attrs[k] === "number") && typeof sheet.age === "number") {
    const cd = sheet.combatDerived as CharacterSheet["combatDerived"];
    if (!cd || typeof cd !== "object") {
      push("combatDerived", "缺少 combatDerived 派生战斗值快照。");
    } else {
      const { db: expDb, build: expBuild } = computeDamageBonusAndBuild((attrs.str as number) + (attrs.siz as number));
      const expMov = computeMov(attrs.str as number, attrs.dex as number, attrs.siz as number, sheet.age as number);
      const expDodge = dodgeOf(attrs.dex as number);
      if (cd.build !== expBuild) push("combatDerived.build", `Build 应为 ${expBuild}，收到 ${String(cd.build)}。`);
      if (cd.mov !== expMov) push("combatDerived.mov", `MOV 应为 ${expMov}，收到 ${String(cd.mov)}。`);
      if (cd.dodge !== expDodge) push("combatDerived.dodge", `Dodge 应为 floor(DEX/2)=${expDodge}，收到 ${String(cd.dodge)}。`);
      if (!cd.db || cd.db.flat !== expDb.flat || cd.db.dice !== expDb.dice || cd.db.display !== expDb.display) {
        push("combatDerived.db", `DB 应为 ${JSON.stringify(expDb)}，收到 ${JSON.stringify(cd.db)}。`);
      }
    }
  }

  // ---- 6. cashBalance ----
  if (typeof sheet.creditRating === "number" && (era === "1920s" || era === "modern")) {
    const expectedCash = startingCashOf(sheet.creditRating, era);
    if (sheet.cashBalance !== expectedCash) {
      push("cashBalance", `cashBalance 应为 startingCashOf(CR=${sheet.creditRating}, era=${era})=${expectedCash}，收到 ${String(sheet.cashBalance)}。`);
    }
  }

  // ---- 7. mythicEncounters（创建期 4 类空容器）----
  const me = sheet.mythicEncounters as CharacterSheet["mythicEncounters"];
  if (!me || typeof me !== "object") {
    push("mythicEncounters", "缺少 mythicEncounters；创建期应为 { tomes: [], spells: [], artifacts: [], entities: [] }。");
  } else {
    for (const k of ["tomes", "spells", "artifacts", "entities"] as const) {
      const arr = (me as any)[k];
      if (!Array.isArray(arr)) push(`mythicEncounters.${k}`, `${k} 必须是数组。`);
      else if (arr.length !== 0) push(`mythicEncounters.${k}`, `创建期 ${k} 必须为空数组，收到长度 ${arr.length}。`);
    }
  }

  // ---- 8. inventory（长度恒为 8，每槽合法）----
  const inv = sheet.inventory;
  if (!Array.isArray(inv)) {
    push("inventory", "缺少 inventory；创建期应为长度 8 的数组（空槽 = { kind: \"item\", text: \"\" }）。");
  } else {
    if (inv.length !== 8) push("inventory.length", `inventory 长度必须为 8，收到 ${inv.length}。`);
    inv.forEach((slot: any, i) => {
      if (!slot || typeof slot !== "object") {
        push(`inventory[${i}]`, "槽位必须是对象。");
        return;
      }
      if (slot.kind === "item") {
        if (typeof slot.text !== "string") push(`inventory[${i}].text`, "item 槽 text 必须是字符串。");
      } else if (slot.kind === "weapon") {
        if (typeof slot.weaponId !== "string" || !slot.weaponId) push(`inventory[${i}].weaponId`, "weapon 槽必须有非空 weaponId。");
        if (typeof slot.ammo !== "number" || slot.ammo < 0) push(`inventory[${i}].ammo`, "weapon 槽 ammo 必须是非负整数。");
      } else {
        push(`inventory[${i}].kind`, `inventory kind 必须是 "item" / "weapon"，收到 "${String(slot.kind)}"。`);
      }
    });
  }

  // ---- 9. sanityState（创建期默认）----
  const ss = sheet.sanityState as CharacterSheet["sanityState"];
  if (!ss || typeof ss !== "object") {
    push("sanityState", "缺少 sanityState；创建期应为 { episodeSanLoss: 0, madness: null }。");
  } else {
    if (ss.episodeSanLoss !== 0) push("sanityState.episodeSanLoss", `创建期 episodeSanLoss 必须为 0，收到 ${String(ss.episodeSanLoss)}。`);
    if (!ALLOWED_MADNESS.has(ss.madness as any)) push("sanityState.madness", `madness 取值非法：${String(ss.madness)}。`);
    if (ss.madness !== null) push("sanityState.madness", `创建期 madness 必须为 null，收到 ${String(ss.madness)}。`);
  }

  return issues.length === 0
    ? { ok: true, issues: [], sheet: sheet as CharacterSheet }
    : { ok: false, issues };
}

/** 拼一段简短的"你是不是想用 X？"提示，提升纠错体验。 */
function suggestSkillName(name: string): string {
  const trimmed = name.trim();
  // 父类后缀的常见错写：闪避 / 敏捷 / 意志力 / 母语 等
  const aliasHints: Record<string, string> = {
    "闪避": "应作为 combatDerived.dodge 派生值，不写入 skills。",
    "敏捷": "DEX 已是属性，不存在同名技能。",
    "意志力": "POW 已是属性，不存在同名技能。",
    "母语": "母语技能值由 EDU 派生现算，不写入 skills。",
    "信用评级": "creditRating 是基本信息字段，不写入 skills。",
    "博物学": "应改为 \"博物\"。",
    "拉丁语": "应改为 \"其他语种(拉丁语)\"。",
    "法语": "应改为 \"其他语种(法语)\"。",
    "德语": "应改为 \"其他语种(德语)\"。",
    "汉语": "应改为 \"其他语种(汉语)\"。",
    "日语": "应改为 \"其他语种(日语)\"。",
    "希腊语": "应改为 \"其他语种(希腊语)\"。",
    "西班牙语": "应改为 \"其他语种(西班牙语)\"。",
    "阿拉伯语": "应改为 \"其他语种(阿拉伯语)\"。",
    "化学": "应改为 \"科学(化学)\"。",
    "物理": "应改为 \"科学(物理学)\"。",
    "物理学": "应改为 \"科学(物理学)\"。",
    "生物学": "应改为 \"科学(生物学)\"。",
    "法医学": "应改为 \"科学(法医学)\"。",
    "天文学": "应改为 \"科学(天文学)\"。",
    "手枪": "应改为 \"火器(手枪)\"。",
    "步枪/霰弹枪": "应改为 \"火器(步枪 / 霰弹枪)\"。",
    "步枪": "应改为 \"火器(步枪 / 霰弹枪)\"。",
    "重型武器": "应改为 \"火器(重武器)\"。",
    "斗殴": "应改为 \"格斗(斗殴)\"。",
    "棍棒": "应改为 \"格斗(棍棒)\"。",
    "剑": "应改为 \"格斗(剑)\"。",
    "话术": "应改为 \"快速交谈\"。",
    "骑乘": "应改为 \"骑术\"。",
    "开锁": "应改为 \"锁匠\"。",
    "摄影": "应改为 \"艺术/手艺(摄影)\"。",
    "写作": "应改为 \"艺术/手艺(写作)\"。",
    "驾驶": "驾驶必须指定分支，例 \"驾驶(汽车)\" / \"驾驶(飞机)\"。",
    "求生": "求生必须指定分支，例 \"求生(极地)\"。",
    "生存": "应改为 \"求生(<分支>)\"。",
  };
  if (aliasHints[trimmed]) return `提示：${aliasHints[trimmed]}`;
  if (/^其他语言\(/.test(trimmed)) return "提示：前缀应为 \"其他语种\" 而非 \"其他语言\"。";
  return "请参照 .docs/character-dictionary.yaml 第 5 节 skills.registry 校正键名。";
}
