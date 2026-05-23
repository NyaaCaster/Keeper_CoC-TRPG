/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 老存档兜底:从运行期 CharacterSheet 现算一份合规的"创建期快照"。
 *
 * 仅用于跑团中点击「下载调查员角色卡」时,sheet 上没有 creationSnapshot 的情况
 * (该字段是后期才引入的)。理想状态是入场时已存好 snapshot,这是退路。
 *
 * 由于运行时无法还原"职业奖励前的真实技能值",此处只能把超 99 的技能 clamp 到 99,
 * 这会丢失"运行期增长"的信息但能保证导出物通过 .docs/character-dictionary.yaml 校验。
 */

import type { CharacterSheet, InventoryEntry, MythicEncounters } from "../types";
import { maxSanLimitOf, refreshCombatDerived, startingCashOf } from "./cocRules";

const EMPTY_MYTHIC: MythicEncounters = { tomes: [], spells: [], artifacts: [], entities: [] };

function padInventory(inv: InventoryEntry[] | undefined): InventoryEntry[] {
  const src = Array.isArray(inv) ? inv.slice(0, 8) : [];
  while (src.length < 8) src.push({ kind: "item", text: "" });
  return src;
}

function clampSkills(skills: CharacterSheet["skills"]): CharacterSheet["skills"] {
  const out: CharacterSheet["skills"] = {};
  for (const [k, v] of Object.entries(skills || {})) {
    if (k === "克苏鲁神话") {
      out[k] = 0;
      continue;
    }
    const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0;
    out[k] = Math.max(0, Math.min(99, n));
  }
  if (!("克苏鲁神话" in out)) out["克苏鲁神话"] = 0;
  return out;
}

/**
 * 把任意运行期 sheet 重建为合规创建期 sheet。
 *
 * 字段来源策略:
 * - 基础信息(name / occupation / 八维属性 / identity 等):原样保留
 * - HP / MP / SAN:重置为 max
 * - mythos:归 0,maxSanLimit 重算为 99 - mythos
 * - sanityState:固定 { episodeSanLoss: 0, madness: null }
 * - mythicEncounters:四类空数组
 * - inventory:对齐 8 槽
 * - cashBalance:由 startingCashOf 现算
 * - combatDerived:refreshCombatDerived 重算
 * - 技能值:clamp 到 [0, 99]
 * - creationSnapshot:剥离,避免递归嵌套
 */
export function rebuildCreationSnapshot(sheet: CharacterSheet): CharacterSheet {
  const con = sheet.attributes.con;
  const siz = sheet.attributes.siz;
  const pow = sheet.attributes.pow;
  const maxHp = Math.floor((con + siz) / 10);
  const maxMp = Math.floor(pow / 5);
  const maxSan = pow;
  const cr = typeof sheet.creditRating === "number" ? Math.max(0, Math.min(99, Math.floor(sheet.creditRating))) : 0;

  const base: CharacterSheet = {
    ...sheet,
    hp: maxHp,
    maxHp,
    mp: maxMp,
    maxMp,
    san: maxSan,
    maxSan,
    mythos: 0,
    maxSanLimit: maxSanLimitOf(0),
    skills: clampSkills(sheet.skills),
    mythicEncounters: { ...EMPTY_MYTHIC },
    inventory: padInventory(sheet.inventory),
    cashBalance: startingCashOf(cr, sheet.background),
    creditRating: cr,
    sanityState: { episodeSanLoss: 0, madness: null },
  };
  delete (base as { creationSnapshot?: CharacterSheet }).creationSnapshot;
  return refreshCombatDerived(base);
}
