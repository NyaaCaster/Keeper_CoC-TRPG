/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 虫佛 · 模组入口
 *
 * 由 vite-plugin-yaml 把 scenario.yaml import 成对象,经 validator 校验后
 * 导出 camelCase 的 Scenario 实例。任何 import 本文件的地方都拿到的是已校验的数据。
 */

import rawScenario from "./scenario.yaml";
import { validateScenario } from "../_schema/validator";
import type { Scenario } from "../_schema/scenario";

const result = validateScenario(rawScenario);
if (result.ok === false) {
  const lines = result.issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
  throw new Error(`[scenario:false-buddha] 校验失败,这不应发生(prebuild 已校验过):\n${lines}`);
}
if (result.warnings.length > 0) {
  console.warn(
    `[scenario:false-buddha] 校验通过但有 ${result.warnings.length} 条 warning:`,
    result.warnings,
  );
}

export const scenario: Scenario = result.scenario;
export default scenario;
