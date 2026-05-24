/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 模组校验入口 — 由 `npm run validate:modules` / `prebuild` 调用。
 *
 * 流程:
 *   1. 扫描 `src/data/modules/*\/scenario.yaml`
 *   2. yaml.load → 喂给 validator.ts:validateScenario(raw)
 *   3. 通过后再做 Node-only 检查:
 *        - meta.id === 目录名
 *        - cover / scene assets / clue.asset 文件存在
 *   4. 任意一个模组 issues 非空 → 退出 1
 *
 * 警告(warnings)只打印不退出,作者可酌情修。
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

import { validateScenario, type ValidationIssue } from "../src/data/modules/_schema/validator";
import type { Scenario } from "../src/data/modules/_schema/scenario";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const MODULES_DIR = resolve(REPO_ROOT, "src/data/modules");

// 颜色:简陋,够看。Windows 终端默认支持 ANSI(Win10+)。
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

interface ModuleReport {
  moduleId: string;          // 目录名
  yamlPath: string;          // 相对仓库根
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
  scenario?: Scenario;
}

function listModuleDirs(): string[] {
  if (!existsSync(MODULES_DIR)) return [];
  return readdirSync(MODULES_DIR)
    .filter((name) => !name.startsWith("_") && !name.startsWith(".") && name !== "index.ts")
    .map((name) => join(MODULES_DIR, name))
    .filter((p) => statSync(p).isDirectory());
}

function checkAssets(
  scenario: Scenario,
  moduleDir: string,
  issues: ValidationIssue[],
) {
  const check = (rel: string | undefined, path: string) => {
    if (!rel) return;
    const abs = resolve(moduleDir, rel);
    if (!existsSync(abs)) {
      issues.push({ path, message: `资产文件不存在: ${rel}(查找路径: ${abs})。` });
    }
  };
  check(scenario.meta.cover, "meta.cover");
  scenario.scenes.forEach((scene, i) => {
    check(scene.frame.assets?.map, `scenes[${i}].frame.assets.map`);
    check(scene.frame.assets?.ambientImage, `scenes[${i}].frame.assets.ambient_image`);
  });
  scenario.clues.forEach((clue, i) => {
    check(clue.frame.asset, `clues[${i}].frame.asset`);
  });
}

function validateOne(moduleDir: string): ModuleReport {
  const dirName = basename(moduleDir);
  const yamlPath = join(moduleDir, "scenario.yaml");
  const relYamlPath = `src/data/modules/${dirName}/scenario.yaml`;
  const report: ModuleReport = {
    moduleId: dirName,
    yamlPath: relYamlPath,
    issues: [],
    warnings: [],
  };
  if (!existsSync(yamlPath)) {
    report.issues.push({ path: "$file", message: `缺少 scenario.yaml(${yamlPath})。` });
    return report;
  }
  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(yamlPath, "utf-8"));
  } catch (e) {
    report.issues.push({ path: "$yaml", message: `yaml 解析失败: ${(e as Error).message}` });
    return report;
  }
  const result = validateScenario(raw);
  if (result.ok === false) {
    report.issues = result.issues;
    report.warnings = result.warnings;
    return report;
  }
  report.warnings = result.warnings;
  // 目录名 == meta.id
  if (result.scenario.meta.id !== dirName) {
    report.issues.push({
      path: "meta.id",
      message: `meta.id "${result.scenario.meta.id}" 必须等于目录名 "${dirName}"。`,
    });
  }
  // 资产存在性
  checkAssets(result.scenario, moduleDir, report.issues);
  if (report.issues.length === 0) {
    report.scenario = result.scenario;
  }
  return report;
}

function printIssues(label: string, color: string, issues: ValidationIssue[]) {
  if (issues.length === 0) return;
  console.log(`  ${color}${label} (${issues.length}):${RESET}`);
  for (const it of issues) {
    console.log(`    ${color}•${RESET} ${DIM}${it.path}${RESET} — ${it.message}`);
  }
}

function main() {
  const dirs = listModuleDirs();
  if (dirs.length === 0) {
    console.log(`${YELLOW}No modules found under ${MODULES_DIR}.${RESET}`);
    console.log(`${DIM}(Phase 1 阶段尚未转写任何模组,本次校验跳过。)${RESET}`);
    process.exit(0);
  }

  console.log(`${CYAN}Validating ${dirs.length} module(s) under ${MODULES_DIR}...${RESET}\n`);

  let hasFatal = false;
  for (const dir of dirs) {
    const report = validateOne(dir);
    const status = report.issues.length === 0 ? `${GREEN}OK${RESET}` : `${RED}FAIL${RESET}`;
    console.log(`[${status}] ${report.moduleId}  ${DIM}(${report.yamlPath})${RESET}`);
    printIssues("ERRORS", RED, report.issues);
    printIssues("warnings", YELLOW, report.warnings);
    if (report.issues.length > 0) hasFatal = true;
    console.log();
  }

  if (hasFatal) {
    console.log(`${RED}validate:modules failed.${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}All modules valid.${RESET}`);
}

main();
