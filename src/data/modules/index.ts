/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 模组注册表 · 「基于剧本游戏模式」可选模组清单
 *
 * 加新模组时:
 *   1. 在 modules/<id>/ 下放 scenario.yaml + module.ts(模板见 one-nest-of-trouble/module.ts)
 *   2. 在本文件 import 并加进 MODULE_REGISTRY
 *   3. validator 在 prebuild 自动扫描所有模组目录,会发现新增项
 */

import oneNestOfTrouble from "./one-nest-of-trouble/module";
import tsumasakiKidan from "./tsumasaki-kidan/module";
import manteiaDaughters from "./manteia-daughters/module";
import type { Scenario } from "./_schema/scenario";

export const MODULE_REGISTRY: Record<string, Scenario> = {
  [oneNestOfTrouble.meta.id]: oneNestOfTrouble,
  [tsumasakiKidan.meta.id]: tsumasakiKidan,
  [manteiaDaughters.meta.id]: manteiaDaughters,
};

export function getModuleById(id: string): Scenario | undefined {
  return MODULE_REGISTRY[id];
}

export function listModules(): Scenario[] {
  return Object.values(MODULE_REGISTRY);
}
