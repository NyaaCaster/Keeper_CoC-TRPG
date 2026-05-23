/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 随机宿命技能分配器（阶段 8）。
 *
 * 输入：当前职业模板的槽位约束 + 八维属性 + 年代 → 输出合法的 SkillSheetDraft。
 *
 * 算法分两步（对应 .docs/character-card-current.md 五.4 流程）：
 *
 *   ① 选 picked：
 *      - fixedSkill / fixedBranch  → 直接锁
 *      - anyBranchOf / oneOf       → 在候选集里随机一个，尽量避开已被其他槽选过
 *      - free（职业自定 N 槽）      → 从全标准技能集里随机一个，避开已选
 *      - 兴趣槽（永远 free）        → 从全标准技能集里随机 4 个，避开"职业 8 项 + 之前的兴趣"
 *
 *   ② 分配点数：双池独立（职业 = EDU×4，兴趣 = INT×2）。每槽 cap = 99 − base。
 *      用近似正态权重（两次 rand 求和 ≈ 三角分布）按比例切池，floor 后剩余按权重降序贪心补到 cap，
 *      避免"全堆 1 项 / 全平均"两个极端。
 *
 * 复用关系：
 *   - randomizeSkillDraft → 一键全随机（"随机宿命技能分配"按钮）
 *   - legalizeDraft       → 把 distributeSkillsToDraft 的中间结果合法化（generate-stats 用）：
 *                           保留已 picked 的槽，给空槽随机补，所有点数按池规则重新分配
 *
 * 该模块**不**写 sheet.skills，输出仍是 SkillSheetDraft；UI 通过 setSkillDraft 接住，玩家仍可手动微调。
 */

import {
  INTEREST_SLOT_COUNT,
  SkillSheetDraft,
  SlotConstraint,
  SlotState,
  SkillSelection,
  baseOfSelection,
  computePointPools,
  getAllStandardCandidates,
  getSlotCandidates,
  selectionKey,
} from "./cocSkillSlots";
import type { CharacterAttributes } from "../types";

// =============================================================================
// 1. 单池贪心加权分配
// =============================================================================

/**
 * 把 `pool` 个点数按近似正态权重分到 N 个槽上，单槽不超过 caps[i]。
 *
 * - 权重 = rng()+rng() + 0.05（Bates-2 ≈ 三角分布，集中度比纯均匀高一截）
 * - 第一轮按 floor(weight / total × pool) 分配，并对每个槽 clamp 到 cap
 * - 第二轮按权重降序贪心把 remaining 补到尚未到 cap 的槽
 * - 若 caps 总和 < pool，剩余无处可放则丢弃（CoC 7e 没有"溢出转兴趣池"的规定）
 *
 * 纯函数，无副作用；rng 默认 Math.random，便于测试时注入种子。
 */
export function allocatePool(
  caps: number[],
  pool: number,
  rng: () => number = Math.random,
): number[] {
  const n = caps.length;
  if (n === 0) return [];
  if (pool <= 0) return new Array(n).fill(0);

  const weights = new Array(n).fill(0).map(() => rng() + rng() + 0.05);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const totalCap = caps.reduce((a, b) => a + Math.max(0, b), 0);
  const distributable = Math.min(pool, totalCap);

  const result = new Array(n).fill(0);
  let used = 0;
  for (let i = 0; i < n; i++) {
    const cap = Math.max(0, caps[i]);
    const target = Math.floor((weights[i] / totalWeight) * distributable);
    const give = Math.min(target, cap);
    result[i] = give;
    used += give;
  }

  let remaining = distributable - used;
  if (remaining > 0) {
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => weights[b] - weights[a],
    );
    let safety = remaining + n;
    while (remaining > 0 && safety-- > 0) {
      let placed = false;
      for (const idx of order) {
        if (result[idx] < Math.max(0, caps[idx])) {
          result[idx] += 1;
          remaining -= 1;
          placed = true;
          if (remaining === 0) break;
        }
      }
      if (!placed) break;
    }
  }

  return result;
}

// =============================================================================
// 2. 单约束的随机选择
// =============================================================================

function pickRandomSelection(
  c: SlotConstraint,
  era: "1920s" | "modern",
  rng: () => number,
  used: Set<string>,
): SkillSelection | undefined {
  switch (c.kind) {
    case "fixedSkill":
      return { kind: "skill", skillId: c.skillId };
    case "fixedBranch":
      return { kind: "branch", parentId: c.parentId, branchId: c.branchId };
    case "anyBranchOf":
    case "oneOf": {
      const cands = getSlotCandidates(c, era);
      if (cands.length === 0) return undefined;
      const fresh = cands.filter((x) => !used.has(selectionKey(x.selection)));
      const pool = fresh.length > 0 ? fresh : cands;
      return pool[Math.floor(rng() * pool.length)].selection;
    }
    case "free": {
      const cands = getAllStandardCandidates(era);
      const fresh = cands.filter((x) => !used.has(selectionKey(x.selection)));
      if (fresh.length === 0) return undefined;
      return fresh[Math.floor(rng() * fresh.length)].selection;
    }
  }
}

// =============================================================================
// 3. 合法化（共享给随机一键 + LLM 接入）
// =============================================================================

/**
 * 把任意 draft 合法化：
 *   - 保留所有已 picked 的槽（不重选）
 *   - 给空 picked 槽按约束随机选（避开已用 selectionKey）
 *   - 重置所有 pointsAllocated，按 EDU×4 / INT×2 双池重新走 allocatePool
 *
 * 这是 randomizeSkillDraft 与 generate-stats 接入合法分配器的共享内核。
 */
export function legalizeDraft(
  draft: SkillSheetDraft,
  attrs: CharacterAttributes,
  era: "1920s" | "modern",
  rng: () => number = Math.random,
): SkillSheetDraft {
  const used = new Set<string>();
  for (const slot of [...draft.occupation, ...draft.interest]) {
    if (slot.picked) used.add(selectionKey(slot.picked));
  }

  const occupation: SlotState[] = draft.occupation.map((s) => {
    let picked = s.picked;
    if (!picked) {
      picked = pickRandomSelection(s.constraint, era, rng, used);
      if (picked) used.add(selectionKey(picked));
    }
    return { constraint: s.constraint, picked, pointsAllocated: 0 };
  });

  const interest: SlotState[] = draft.interest.map((s) => {
    let picked = s.picked;
    const constraint: SlotConstraint = { kind: "free" };
    if (!picked) {
      picked = pickRandomSelection(constraint, era, rng, used);
      if (picked) used.add(selectionKey(picked));
    }
    return { constraint, picked, pointsAllocated: 0 };
  });

  const pools = computePointPools(attrs);
  // CoC 7e RAW: 创角阶段任何技能不得超过 90% (Investigator Handbook · Step 4)。
  const occCaps = occupation.map((s) =>
    s.picked ? Math.max(0, 90 - baseOfSelection(s.picked)) : 0,
  );
  const intCaps = interest.map((s) =>
    s.picked ? Math.max(0, 90 - baseOfSelection(s.picked)) : 0,
  );
  const occPoints = allocatePool(occCaps, pools.occupation, rng);
  const intPoints = allocatePool(intCaps, pools.interest, rng);
  occPoints.forEach((p, i) => {
    occupation[i].pointsAllocated = p;
  });
  intPoints.forEach((p, i) => {
    interest[i].pointsAllocated = p;
  });
  return { occupation, interest };
}

// =============================================================================
// 4. 主入口
// =============================================================================

/**
 * 一键合法分配：返回 8 职业槽（按 occupationConstraints 顺序）+ 4 兴趣槽（永远 free）。
 *
 * - 同一技能不会跨槽重复（fixedSkill / fixedBranch 锁定的特例除外）
 * - 兴趣槽避开"已被职业槽选中的"
 * - 点数池按 EDU×4（职业） / INT×2（兴趣）独立分配
 * - 单槽 final ≤ 99；不会低于 base（pointsAllocated ≥ 0）
 */
export function randomizeSkillDraft(
  occupationConstraints: SlotConstraint[],
  attrs: CharacterAttributes,
  era: "1920s" | "modern",
  rng: () => number = Math.random,
): SkillSheetDraft {
  const emptyDraft: SkillSheetDraft = {
    occupation: occupationConstraints.map((c) => ({ constraint: c, pointsAllocated: 0 })),
    interest: Array.from({ length: INTEREST_SLOT_COUNT }, () => ({
      constraint: { kind: "free" } as SlotConstraint,
      pointsAllocated: 0,
    })),
  };
  return legalizeDraft(emptyDraft, attrs, era, rng);
}
