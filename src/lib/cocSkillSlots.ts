/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 角色卡创建期"槽位 → 技能 sheet"中间层。
 *
 * 数据流：
 *   职业模板 OccupationSkillRef[]  ─展开→  SlotConstraint[8] (职业槽约束)
 *   玩家在槽里挑技能/分支          ─→     SlotState[8] + SlotState[4] (兴趣)
 *   槽位状态                       ─折叠→  CharacterSheet.skills 名值对
 *
 * 关键约定：
 * - 闪避 / 母语 / 信用评级**不进槽位、也不进 sheet.skills**（基本信息层）。
 * - 克苏鲁神话固定 0、cthulhuOnly: true，玩家创建期不可见、不可选。
 * - 同一技能 / 分支不能在多个槽位重复（UI 红字提示，但不强阻拦提交，提交时取最大值）。
 * - 提交时分支技能输出格式："父名(分支名)"，例如 "艺术/手艺(摄影)" / "火器(手枪)"。
 */

import {
  SKILL_REGISTRY_ALL,
  SkillDefinition,
  SkillBranchDefinition,
  OccupationSkillRef,
  findSkill,
  findBranch,
  isSkillSelectable,
} from "../data/cocSkills";
import { OccupationTemplate } from "../data/cocOccupations";
import type { CharacterAttributes, CharacterSkills } from "../types";

// =============================================================================
// 类型
// =============================================================================

/** 单个槽位的"允许范围"约束（来自职业模板，或自由槽）。 */
export type SlotConstraint =
  | { kind: "fixedSkill"; skillId: string }                       // 固定单一技能
  | { kind: "fixedBranch"; parentId: string; branchId: string }   // 固定具体分支
  | { kind: "anyBranchOf"; parentId: string }                     // 父类 + 任一分支
  | { kind: "oneOf"; options: SlotConstraint[] }                  // 多选其一
  | { kind: "free" };                                              // 自由（自定 N / 兴趣槽）

/** 槽位里被选中的技能。 */
export type SkillSelection =
  | { kind: "skill"; skillId: string }
  | { kind: "branch"; parentId: string; branchId: string };

/** 槽位完整状态（约束 + 当前选择 + 分配点数）。 */
export interface SlotState {
  /** 约束类型；undefined = 兴趣槽（隐式 free）。 */
  constraint: SlotConstraint;
  /** 当前选择；未选时 undefined。 */
  picked?: SkillSelection;
  /** 玩家额外分配的点数（不含 base）。 */
  pointsAllocated: number;
}

/** 整张草稿（8 职业槽 + 4 兴趣槽）。 */
export interface SkillSheetDraft {
  occupation: SlotState[];
  interest: SlotState[];
}

/** picker 候选项的统一表示。 */
export interface SkillCandidate {
  selection: SkillSelection;
  nameZh: string;
  nameEn: string;
  base: number;
}

// =============================================================================
// 1. 职业模板展开成槽位约束
// =============================================================================

/**
 * 把 OccupationSkillRef[] 展开成 SlotConstraint[]。
 * - freeSlot { count: N } → N 个独立的 { kind: "free" }。
 * - 其他 ref 保持 1:1 映射。
 *
 * 总长度等于 countOccupationSlots(template)，应 ≤ 8。
 */
export function expandOccupationSlots(template: OccupationTemplate): SlotConstraint[] {
  const out: SlotConstraint[] = [];
  for (const ref of template.coreSkills) {
    if (ref.kind === "freeSlot") {
      for (let i = 0; i < ref.count; i++) out.push({ kind: "free" });
      continue;
    }
    out.push(refToConstraint(ref));
  }
  return out;
}

function refToConstraint(ref: Exclude<OccupationSkillRef, { kind: "freeSlot" }>): SlotConstraint {
  if (ref.kind === "skill") return { kind: "fixedSkill", skillId: ref.id };
  if (ref.kind === "branch") return { kind: "fixedBranch", parentId: ref.parentId, branchId: ref.branchId };
  if (ref.kind === "anyBranchOf") return { kind: "anyBranchOf", parentId: ref.parentId };
  // oneOf：递归（7e 数据里 oneOf 只嵌一层非 freeSlot 的 ref）
  return {
    kind: "oneOf",
    options: ref.options.map((o) =>
      o.kind === "freeSlot"
        ? ({ kind: "free" } as SlotConstraint)
        : refToConstraint(o as Exclude<OccupationSkillRef, { kind: "freeSlot" }>),
    ),
  };
}

/** 自拟职业 / 兴趣槽的"全自由"约束工厂。 */
export function freeSlotsArray(count: number): SlotConstraint[] {
  return Array.from({ length: count }, () => ({ kind: "free" } as SlotConstraint));
}

// =============================================================================
// 2. 候选项查询（picker 用）
// =============================================================================

/**
 * 返回某槽位约束在指定 era 下的候选项列表。
 *
 * - fixedSkill / fixedBranch：单元素列表（玩家不可改）
 * - anyBranchOf：父类下所有 era 适用分支
 * - oneOf：递归收集所有选项的候选
 * - free：全标准技能集 + 多分支父类的全部分支（玩家自由选）
 */
export function getSlotCandidates(constraint: SlotConstraint, era: "1920s" | "modern"): SkillCandidate[] {
  switch (constraint.kind) {
    case "fixedSkill": {
      const sk = findSkill(constraint.skillId);
      return sk ? [{ selection: { kind: "skill", skillId: sk.id }, nameZh: sk.nameZh, nameEn: sk.nameEn, base: sk.base }] : [];
    }
    case "fixedBranch": {
      const br = findBranch(constraint.parentId, constraint.branchId);
      const parent = findSkill(constraint.parentId);
      if (!br || !parent) return [];
      return [
        {
          selection: { kind: "branch", parentId: parent.id, branchId: br.id },
          nameZh: `${parent.nameZh}(${br.nameZh})`,
          nameEn: `${parent.nameEn} (${br.nameEn})`,
          base: br.base,
        },
      ];
    }
    case "anyBranchOf": {
      const parent = findSkill(constraint.parentId);
      if (!parent || !parent.branches) return [];
      return parent.branches
        .filter((b) => !b.eraOnly || b.eraOnly === era)
        .map((b) => ({
          selection: { kind: "branch", parentId: parent.id, branchId: b.id },
          nameZh: `${parent.nameZh}(${b.nameZh})`,
          nameEn: `${parent.nameEn} (${b.nameEn})`,
          base: b.base,
        }));
    }
    case "oneOf": {
      const seen = new Set<string>();
      const out: SkillCandidate[] = [];
      for (const opt of constraint.options) {
        for (const c of getSlotCandidates(opt, era)) {
          const key = selectionKey(c.selection);
          if (!seen.has(key)) {
            seen.add(key);
            out.push(c);
          }
        }
      }
      return out;
    }
    case "free":
      return getAllStandardCandidates(era);
  }
}

/**
 * 全标准技能集（创建期对玩家可见的所有项）。
 * 单技能直接加；多分支父类展开所有分支；克苏鲁神话排除。
 */
export function getAllStandardCandidates(era: "1920s" | "modern"): SkillCandidate[] {
  const out: SkillCandidate[] = [];
  for (const sk of SKILL_REGISTRY_ALL) {
    if (!isSkillSelectable(sk, era)) continue;
    if (sk.branches && sk.branches.length > 0) {
      for (const b of sk.branches) {
        if (b.eraOnly && b.eraOnly !== era) continue;
        out.push({
          selection: { kind: "branch", parentId: sk.id, branchId: b.id },
          nameZh: `${sk.nameZh}(${b.nameZh})`,
          nameEn: `${sk.nameEn} (${b.nameEn})`,
          base: b.base,
        });
      }
    } else {
      out.push({ selection: { kind: "skill", skillId: sk.id }, nameZh: sk.nameZh, nameEn: sk.nameEn, base: sk.base });
    }
  }
  return out;
}

// =============================================================================
// 3. 选择 / 槽位辅助
// =============================================================================

/** 选择的稳定 key（用于去重 / 比较 / Map 索引）。 */
export function selectionKey(sel: SkillSelection): string {
  if (sel.kind === "skill") return `S:${sel.skillId}`;
  return `B:${sel.parentId}/${sel.branchId}`;
}

/** 查 selection 对应的 base（从合并表）。 */
export function baseOfSelection(sel: SkillSelection): number {
  if (sel.kind === "skill") return findSkill(sel.skillId)?.base ?? 0;
  return findBranch(sel.parentId, sel.branchId)?.base ?? 0;
}

/** 查 selection 对应的中文名（"父(分支)" 或 单名）。
 *  父 / 分支 nameZh 中的空白被剥除，作为 sheet.skills 的紧凑 key 形式
 *  （字典表 key_pattern：例 "艺术/手艺(摄影)" 对应 UI label "艺术 / 手艺"）。 */
export function nameOfSelection(sel: SkillSelection): string {
  const stripWs = (s: string) => s.replace(/\s+/g, "");
  if (sel.kind === "skill") return findSkill(sel.skillId)?.nameZh ?? sel.skillId;
  const p = stripWs(findSkill(sel.parentId)?.nameZh ?? sel.parentId);
  const b = stripWs(findBranch(sel.parentId, sel.branchId)?.nameZh ?? sel.branchId);
  return `${p}(${b})`;
}

/** 当前槽位最终值 = base + pointsAllocated。 */
export function finalValueOfSlot(slot: SlotState): number {
  if (!slot.picked) return 0;
  return baseOfSelection(slot.picked) + slot.pointsAllocated;
}

/** 创建空槽（picked 未设、点数 0）。 */
export function makeEmptySlot(constraint: SlotConstraint): SlotState {
  return { constraint, pointsAllocated: 0 };
}

// =============================================================================
// 4. 点池
// =============================================================================

export interface PointPools {
  occupation: number;   // EDU × 4
  interest: number;     // INT × 2
}

export function computePointPools(attrs: CharacterAttributes): PointPools {
  return {
    occupation: attrs.edu * 4,
    interest: attrs.int * 2,
  };
}

/** 单池消耗（仅累加 pointsAllocated）。 */
export function spentInSlots(slots: SlotState[]): number {
  return slots.reduce((acc, s) => acc + Math.max(0, s.pointsAllocated), 0);
}

// =============================================================================
// 5. 折叠槽位 → CharacterSheet.skills
// =============================================================================

/**
 * 把草稿折叠成 sheet.skills 名值字典。
 * - 同名重复时取最大值（兴趣 / 职业槽误选同技能时的兜底）。
 * - 跳过 picked 为空的槽。
 * - 自动写入 "克苏鲁神话": 0。
 */
export function draftToSkills(draft: SkillSheetDraft): CharacterSkills {
  const out: CharacterSkills = {};
  const allSlots = [...draft.occupation, ...draft.interest];
  for (const slot of allSlots) {
    if (!slot.picked) continue;
    const name = nameOfSelection(slot.picked);
    const value = finalValueOfSlot(slot);
    if (name in out) {
      out[name] = Math.max(out[name] as number, value);
    } else {
      out[name] = value;
    }
  }
  out["克苏鲁神话"] = 0;
  return out;
}

// =============================================================================
// 6. 重复检测 / 槽位间冲突
// =============================================================================

/** 返回所有重复出现的 selectionKey 集合。UI 用红字标记。 */
export function findDuplicateSelections(draft: SkillSheetDraft): Set<string> {
  const counter = new Map<string, number>();
  for (const slot of [...draft.occupation, ...draft.interest]) {
    if (!slot.picked) continue;
    const k = selectionKey(slot.picked);
    counter.set(k, (counter.get(k) ?? 0) + 1);
  }
  const dup = new Set<string>();
  for (const [k, n] of counter) if (n > 1) dup.add(k);
  return dup;
}

// =============================================================================
// 7. 名值对 → 草稿（PNG 导入 / LLM 回填用）
// =============================================================================

/**
 * 把 sheet.skills 名值字典平摊到槽位，作为 distributor。
 *
 * 算法：
 *   1. 解析每个 (name → value)：先精确匹配标准技能 nameZh；
 *      若失败再尝试 "父(分支)" 形式拆分；都失败则丢弃（不进任何槽）。
 *   2. 优先填职业槽：满足 fixedSkill / fixedBranch 约束的精确匹配优先；
 *      然后是 anyBranchOf / oneOf；最后是 free 槽。
 *   3. 职业槽满后流向兴趣槽（4 个 free 槽）。
 *   4. points = max(0, value - base)，多余点数允许，不在此函数中校验池上限。
 *   5. "克苏鲁神话"始终跳过（创建期不可分配）。
 *
 * 该函数是"尽力而为"——超过 12 槽的部分会丢弃，UI 应在调用前提示玩家。
 */
export function distributeSkillsToDraft(
  skills: CharacterSkills,
  occupationConstraints: SlotConstraint[],
  era: "1920s" | "modern",
): SkillSheetDraft {
  const draft: SkillSheetDraft = {
    occupation: occupationConstraints.map(makeEmptySlot),
    interest: freeSlotsArray(4).map(makeEmptySlot),
  };

  const entries = Object.entries(skills).filter(([n]) => n !== "克苏鲁神话");

  for (const [name, value] of entries) {
    const sel = parseSkillName(name, era);
    if (!sel) continue;
    const base = baseOfSelection(sel);
    const points = Math.max(0, (typeof value === "number" ? value : 0) - base);

    const placed = tryPlaceInOccupationSlot(draft, sel, points, era) || tryPlaceInInterestSlot(draft, sel, points);
    if (!placed) continue; // 12 槽用满，丢弃多余
  }

  return draft;
}

function tryPlaceInOccupationSlot(
  draft: SkillSheetDraft,
  sel: SkillSelection,
  points: number,
  era: "1920s" | "modern",
): boolean {
  // 第一轮：精确约束（fixedSkill / fixedBranch 的恰好匹配）
  for (const slot of draft.occupation) {
    if (slot.picked) continue;
    if (constraintMatchesExactly(slot.constraint, sel)) {
      slot.picked = sel;
      slot.pointsAllocated = points;
      return true;
    }
  }
  // 第二轮：模糊约束（anyBranchOf / oneOf）
  for (const slot of draft.occupation) {
    if (slot.picked) continue;
    if (constraintAccepts(slot.constraint, sel, era)) {
      slot.picked = sel;
      slot.pointsAllocated = points;
      return true;
    }
  }
  // 第三轮：free 槽
  for (const slot of draft.occupation) {
    if (slot.picked) continue;
    if (slot.constraint.kind === "free") {
      slot.picked = sel;
      slot.pointsAllocated = points;
      return true;
    }
  }
  return false;
}

function tryPlaceInInterestSlot(draft: SkillSheetDraft, sel: SkillSelection, points: number): boolean {
  for (const slot of draft.interest) {
    if (slot.picked) continue;
    slot.picked = sel;
    slot.pointsAllocated = points;
    return true;
  }
  return false;
}

function constraintMatchesExactly(c: SlotConstraint, sel: SkillSelection): boolean {
  if (c.kind === "fixedSkill" && sel.kind === "skill") return c.skillId === sel.skillId;
  if (c.kind === "fixedBranch" && sel.kind === "branch") return c.parentId === sel.parentId && c.branchId === sel.branchId;
  return false;
}

/** 约束是否接受该选择（含 anyBranchOf / oneOf / free 的宽松匹配）。 */
export function constraintAccepts(c: SlotConstraint, sel: SkillSelection, era: "1920s" | "modern"): boolean {
  switch (c.kind) {
    case "fixedSkill":
      return sel.kind === "skill" && sel.skillId === c.skillId;
    case "fixedBranch":
      return sel.kind === "branch" && sel.parentId === c.parentId && sel.branchId === c.branchId;
    case "anyBranchOf":
      return sel.kind === "branch" && sel.parentId === c.parentId;
    case "oneOf":
      return c.options.some((o) => constraintAccepts(o, sel, era));
    case "free":
      return true;
  }
}

/**
 * 解析 sheet.skills 里的中文名为 SkillSelection。
 * - 精确匹配 nameZh（单技能）
 * - 解析 "父(分支)" 形式（如 "火器(手枪)" / "艺术/手艺(摄影)"）
 *   父名既允许"火器"也允许"艺术/手艺"等含斜杠的形式
 * - 解析失败返回 undefined
 */
export function parseSkillName(name: string, era: "1920s" | "modern"): SkillSelection | undefined {
  const trimmed = name.trim();
  const stripWs = (s: string) => s.replace(/\s+/g, "");
  const compact = stripWs(trimmed);
  // 单技能精确匹配（限制对 era 可见、非克苏鲁神话）。父子 nameZh 中可能带空白，
  // 这里采用"去空白后等价"比较，与 nameOfSelection 输出口径一致。
  const direct = SKILL_REGISTRY_ALL.find(
    (s) => stripWs(s.nameZh) === compact && (!s.eraOnly || s.eraOnly === era) && !s.cthulhuOnly && (!s.branches || s.branches.length === 0),
  );
  if (direct) return { kind: "skill", skillId: direct.id };

  // "父(分支)" 形式
  const m = trimmed.match(/^(.+?)\((.+?)\)$/);
  if (m) {
    const parentZh = stripWs(m[1]);
    const branchZh = stripWs(m[2]);
    const parent = SKILL_REGISTRY_ALL.find((s) => stripWs(s.nameZh) === parentZh && s.branches);
    if (parent && parent.branches) {
      const branch = parent.branches.find((b) => stripWs(b.nameZh) === branchZh && (!b.eraOnly || b.eraOnly === era));
      if (branch) return { kind: "branch", parentId: parent.id, branchId: branch.id };
    }
  }

  return undefined;
}

// =============================================================================
// 8. 兴趣 / 自定义槽位约束工厂
// =============================================================================

export const INTEREST_SLOT_COUNT = 4;
export const OCCUPATION_SLOT_COUNT = 8;

/** 自拟职业（无模板）的"全自由 8 槽"约束。 */
export function customOccupationConstraints(): SlotConstraint[] {
  return freeSlotsArray(OCCUPATION_SLOT_COUNT);
}

/** 空草稿（兴趣槽永远 4 个 free，职业槽长度按 constraints 给）。 */
export function emptyDraft(occupationConstraints: SlotConstraint[]): SkillSheetDraft {
  return {
    occupation: occupationConstraints.map(makeEmptySlot),
    interest: freeSlotsArray(INTEREST_SLOT_COUNT).map(makeEmptySlot),
  };
}

// =============================================================================
// 9. 槽位约束的中文渲染（UI label）
// =============================================================================

/** 一行简短描述某约束的允许范围（UI 标签）。 */
export function describeConstraint(c: SlotConstraint): string {
  switch (c.kind) {
    case "fixedSkill": {
      const sk = findSkill(c.skillId);
      return sk ? sk.nameZh : c.skillId;
    }
    case "fixedBranch": {
      const p = findSkill(c.parentId)?.nameZh ?? c.parentId;
      const b = findBranch(c.parentId, c.branchId)?.nameZh ?? c.branchId;
      return `${p}(${b})`;
    }
    case "anyBranchOf": {
      const p = findSkill(c.parentId)?.nameZh ?? c.parentId;
      return `${p}(任一)`;
    }
    case "oneOf":
      return c.options.map(describeConstraint).join(" 或 ");
    case "free":
      return "自定";
  }
}

export type { SkillDefinition, SkillBranchDefinition };
