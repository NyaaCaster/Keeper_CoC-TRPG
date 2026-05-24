/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Validator 自测 — 不依赖测试框架,直接 tsx 跑。
 *
 * 用例:
 *   1. .docs/scenario-schema.md §12 的最小样例 → 必须 ok=true
 *   2. 一组故意构造的失败样例,每个用例必须命中**指定的 issue path 关键字**
 *
 * 失败时进程 exit 1,CI / 人工 `npm run test:validator` 都能接。
 */

import yaml from "js-yaml";
import { validateScenario, type ValidationResult } from "../src/data/modules/_schema/validator";

let failures = 0;
const tests: Array<{ name: string; run: () => void }> = [];

function test(name: string, run: () => void) {
  tests.push({ name, run });
}

function loadYaml(src: string): unknown {
  return yaml.load(src);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function expectOk(result: ValidationResult): asserts result is Extract<ValidationResult, { ok: true }> {
  if (result.ok === false) {
    throw new Error(
      `expected ok=true; got issues:\n${result.issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n")}`,
    );
  }
}

function expectFail(result: ValidationResult, pathSubstring: string) {
  if (result.ok !== false) {
    throw new Error(
      `expected ok=false (looking for path containing "${pathSubstring}") but got ok=true`,
    );
  }
  const hit = result.issues.find((i) => i.path.includes(pathSubstring));
  if (!hit) {
    throw new Error(
      `expected an issue with path containing "${pathSubstring}", got:\n${result.issues
        .map((i) => `  - ${i.path}: ${i.message}`)
        .join("\n")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 用例 1:最小样例(§12)必须通过
// ---------------------------------------------------------------------------

const MINIMAL_YAML = `
schema_version: 1

meta:
  id: minimal-demo
  title: 最小演示
  era: modern
  language: zh-CN
  recommended_investigators: { min: 1, max: 1 }
  expected_hours: { min: 1, max: 1 }
  difficulty: 入门
  tags: [演示]
  start_time: { game_day: 1, hour: "12:00" }
  synopsis_md: 用于校验器测试的最小模组。
  recommended_occupations: [私家侦探]

hook:
  start_scene: scene.room
  prologue_md: 你站在一间陌生的房间里。
  call_to_action_md: 房门紧闭,你必须找到出去的方法。

scenes:
  - id: scene.room
    title: 陌生的房间
    frame:
      summary_md: 一间四壁空白的房间,中央有张桌子。
      facts: [桌上有把钥匙, 房门反锁]
      exits: []
      npcs_present: []
      available_clues: [clue.key]
    freedom:
      mood_tags: [疑惑]
      sensory_palette: { sight: 灰白墙面, sound: 自己的呼吸 }
    forbidden: [不要凭空创造新出口]

npcs: []

clues:
  - id: clue.key
    title: 桌上的钥匙
    frame:
      location_scene: scene.room
      discovery: { method: auto-on-enter }
      reveal_md: 你拿起一把铜钥匙。
      unlocks: { flags: [flag.has-key] }

timeline: []

flags:
  - id: flag.has-key
    title: 持有钥匙
    initial: false

endings:
  - id: ending.escape
    title: 逃出生天
    triggers: [{ flag: flag.has-key, value: true }]
    priority: 1
    frame:
      epilogue_md: 你打开门,走入光明。
      scenario_end_kind: victory
`;

test("minimal sample (schema doc §12) passes", () => {
  const result = validateScenario(loadYaml(MINIMAL_YAML));
  expectOk(result);
  assert(result.scenario.meta.id === "minimal-demo", "meta.id 转换错");
  assert(result.scenario.scenes.length === 1, "scenes 数量错");
  assert(result.scenario.endings[0].frame.scenarioEndKind === "victory", "scenarioEndKind 错");
});

// ---------------------------------------------------------------------------
// 用例 2:故意失败 —— 用克隆 + 篡改的方式构造
// ---------------------------------------------------------------------------

function cloneMinimal(): Record<string, unknown> {
  // js-yaml 每次 load 都会返回新对象,不需要 deep clone
  return loadYaml(MINIMAL_YAML) as Record<string, unknown>;
}

test("schema_version 不匹配", () => {
  const raw = cloneMinimal();
  raw["schema_version"] = 999;
  expectFail(validateScenario(raw), "schema_version");
});

test("meta.era=other 但缺 era_note", () => {
  const raw = cloneMinimal();
  (raw["meta"] as Record<string, unknown>)["era"] = "other";
  expectFail(validateScenario(raw), "meta.era_note");
});

test("hook.start_scene 引用不存在的场景", () => {
  const raw = cloneMinimal();
  (raw["hook"] as Record<string, unknown>)["start_scene"] = "scene.nowhere";
  expectFail(validateScenario(raw), "hook.start_scene");
});

test("场景出口引用不存在的 clue", () => {
  const raw = cloneMinimal();
  const scenes = raw["scenes"] as Record<string, unknown>[];
  const frame = scenes[0]["frame"] as Record<string, unknown>;
  frame["exits"] = [
    {
      to: "scene.room",
      condition: "requires-clue",
      required_clue: "clue.does-not-exist",
      label: "门",
    },
  ];
  expectFail(validateScenario(raw), "required_clue");
});

test("requires-skill 用了未注册的技能", () => {
  const raw = cloneMinimal();
  // 加一个目标场景,让 to 引用不会先报错
  (raw["scenes"] as Record<string, unknown>[]).push({
    id: "scene.cliff",
    title: "悬崖",
    frame: {
      summary_md: "悬崖。",
      facts: ["陡峭"],
      exits: [],
      npcs_present: [],
      available_clues: [],
    },
  });
  const frame = (raw["scenes"] as Record<string, unknown>[])[0]["frame"] as Record<
    string,
    unknown
  >;
  frame["exits"] = [
    {
      to: "scene.cliff",
      condition: "requires-skill",
      required_skill: "TotallyFakeSkill",
      difficulty: "regular",
      label: "攀爬",
    },
  ];
  expectFail(validateScenario(raw), "required_skill");
});

test("clue.discovery.skill 用了未注册的技能", () => {
  const raw = cloneMinimal();
  const clues = raw["clues"] as Record<string, unknown>[];
  const frame = clues[0]["frame"] as Record<string, unknown>;
  frame["discovery"] = { method: "skill", skill: "NotASkill", difficulty: "hard" };
  expectFail(validateScenario(raw), "discovery.skill");
});

test("npc.combat.damage_formula 不可解析", () => {
  const raw = cloneMinimal();
  (raw["npcs"] as Record<string, unknown>[]).push({
    id: "npc.test",
    name: "测试",
    role: "中立",
    initial_location: "scene.room",
    initial_attitude: "neutral",
    frame: {
      public_persona_md: "测试 NPC。",
      stats: {
        str: 50, con: 50, siz: 50, dex: 50, app: 50,
        int: 50, pow: 50, edu: 50, hp: 10, mp: 10, san: 50,
      },
      combat: {
        weapon: "拳头",
        damage_formula: "this is not a formula",
        skill_value: 50,
      },
      voice_guidelines: ["普通"],
    },
  });
  expectFail(validateScenario(raw), "damage_formula");
});

test("timeline 不按时间升序", () => {
  const raw = cloneMinimal();
  raw["timeline"] = [
    {
      id: "tl.late",
      title: "晚的事件",
      fires_when: { game_day: 2, hour: "10:00" },
      forced: true,
      frame: { narrative_seed_md: "晚。" },
    },
    {
      id: "tl.early",
      title: "早的事件",
      fires_when: { game_day: 1, hour: "10:00" },
      forced: true,
      frame: { narrative_seed_md: "早。" },
    },
  ];
  expectFail(validateScenario(raw), "fires_when");
});

test("timeline 时间早于 meta.start_time", () => {
  const raw = cloneMinimal();
  raw["timeline"] = [
    {
      id: "tl.too-early",
      title: "早于开局",
      fires_when: { game_day: 1, hour: "08:00" }, // 开局 12:00
      forced: true,
      frame: { narrative_seed_md: "...", },
    },
  ];
  expectFail(validateScenario(raw), "fires_when");
});

test("ending 引用不可达的 flag", () => {
  const raw = cloneMinimal();
  // 加一个 flag 但没人能写它为 true
  (raw["flags"] as Record<string, unknown>[]).push({
    id: "flag.unreachable",
    title: "不可达",
    initial: false,
  });
  const endings = raw["endings"] as Record<string, unknown>[];
  endings.push({
    id: "ending.bad",
    title: "不可达结局",
    triggers: [{ flag: "flag.unreachable", value: true }],
    priority: 5,
    frame: { epilogue_md: "...", scenario_end_kind: "ambiguous" },
  });
  expectFail(validateScenario(raw), "endings[1].triggers[0]");
});

test("没有任何 victory/ambiguous 结局", () => {
  const raw = cloneMinimal();
  const endings = raw["endings"] as Record<string, unknown>[];
  (endings[0] as { frame: { scenario_end_kind: string } }).frame.scenario_end_kind = "dead";
  expectFail(validateScenario(raw), "endings");
});

test("HH:MM 格式错误", () => {
  const raw = cloneMinimal();
  (raw["meta"] as { start_time: { hour: string } }).start_time.hour = "25:99";
  expectFail(validateScenario(raw), "start_time.hour");
});

test("孤儿场景产生 warning(不致命)", () => {
  const raw = cloneMinimal();
  (raw["scenes"] as Record<string, unknown>[]).push({
    id: "scene.orphan",
    title: "孤岛",
    frame: {
      summary_md: "无人能至。",
      facts: ["孤立"],
      exits: [],
      npcs_present: [],
      available_clues: [],
    },
  });
  const result = validateScenario(raw);
  expectOk(result); // 不致命
  const hit = result.warnings.find((w) => w.message.includes("scene.orphan"));
  if (!hit) {
    throw new Error(
      `expected a warning about scene.orphan, got:\n${result.warnings
        .map((w) => `  - ${w.path}: ${w.message}`)
        .join("\n")}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 用例 3:writable_by: [scenario-actions] 让 ending 通过可达性
// ---------------------------------------------------------------------------

test("flag 标 writable_by:[scenario-actions] 后 ending 视为可达", () => {
  const raw = cloneMinimal();
  // 加一个没有任何 clue/timeline 来源的 flag,但声明它由 scenarioActions 写入
  (raw["flags"] as Record<string, unknown>[]).push({
    id: "flag.runtime-only",
    title: "运行时写入的 flag",
    initial: false,
    writable_by: ["scenario-actions"],
  });
  // 加一个 ending,触发条件就是这个 flag = true
  (raw["endings"] as Record<string, unknown>[]).push({
    id: "ending.runtime-victory",
    title: "运行时胜利",
    triggers: [{ flag: "flag.runtime-only", value: true }],
    priority: 5,
    frame: { epilogue_md: "...", scenario_end_kind: "victory" },
  });
  const result = validateScenario(raw);
  expectOk(result);
  // 还应该确认 writableBy 被正确解析到 scenario 对象上
  const flag = result.scenario.flags.find((f) => f.id === "flag.runtime-only");
  if (!flag || !flag.writableBy?.includes("scenario-actions")) {
    throw new Error(`expected flag.runtime-only.writableBy to include "scenario-actions"`);
  }
});

test("flag 不带 writable_by 且无来源时,ending 不可达", () => {
  const raw = cloneMinimal();
  (raw["flags"] as Record<string, unknown>[]).push({
    id: "flag.dangling",
    title: "无来源的 flag",
    initial: false,
    // 没有 writable_by
  });
  (raw["endings"] as Record<string, unknown>[]).push({
    id: "ending.dangling",
    title: "不可达结局",
    triggers: [{ flag: "flag.dangling", value: true }],
    priority: 5,
    frame: { epilogue_md: "...", scenario_end_kind: "victory" },
  });
  expectFail(validateScenario(raw), "endings[1].triggers[0]");
});

test("flag.writable_by 包含非法枚举值", () => {
  const raw = cloneMinimal();
  (raw["flags"] as Record<string, unknown>[]).push({
    id: "flag.bad",
    title: "枚举错的 flag",
    initial: false,
    writable_by: ["llm-magic"],
  });
  expectFail(validateScenario(raw), "writable_by");
});

// ---------------------------------------------------------------------------
// 用例 4:narrative_style(§11)
// ---------------------------------------------------------------------------

test("narrative_style 完整结构通过且字段被解析到 camelCase", () => {
  const raw = cloneMinimal();
  raw["narrative_style"] = {
    frame: {
      pov: "第二人称",
      tense: "现在时",
      forbidden_phrasings: ["不要写'调查员投出了检定'", "不要破第四面墙"],
    },
    freedom: {
      sentence_pacing_md: "探索铺长句,袭击切短句。",
      vocabulary_register: "现代口语",
      metaphor_palette: ["旧胶片", "冷柜白光"],
      reference_works: ["《克莉丝汀》"],
      sample_paragraph_md: "门吱呀一声推开。",
    },
  };
  const result = validateScenario(raw);
  expectOk(result);
  const ns = result.scenario.narrativeStyle;
  if (!ns?.frame || !ns.freedom) {
    throw new Error("expected narrativeStyle.frame and freedom to be parsed");
  }
  assert(ns.frame.pov === "第二人称", "pov 错");
  assert(ns.frame.tense === "现在时", "tense 错");
  assert(ns.frame.forbiddenPhrasings?.length === 2, "forbiddenPhrasings 错");
  assert(ns.freedom.vocabularyRegister === "现代口语", "vocabularyRegister 错");
  assert(ns.freedom.metaphorPalette?.[0] === "旧胶片", "metaphorPalette 错");
  assert(ns.freedom.referenceWorks?.[0] === "《克莉丝汀》", "referenceWorks 错");
  assert(ns.freedom.sampleParagraphMd === "门吱呀一声推开。", "sampleParagraphMd 错");
});

test("narrative_style 缺省时 scenario.narrativeStyle 为 undefined", () => {
  const raw = cloneMinimal();
  // 不设 narrative_style
  const result = validateScenario(raw);
  expectOk(result);
  if (result.scenario.narrativeStyle !== undefined) {
    throw new Error("expected narrativeStyle to be undefined when not provided");
  }
});

test("narrative_style.freedom.sample_paragraph_md 超过 200 字产生 warning", () => {
  const raw = cloneMinimal();
  const longSample = "这是一段刻意写得很长的示范段落用于触发软警告。".repeat(20);
  raw["narrative_style"] = {
    freedom: { sample_paragraph_md: longSample },
  };
  const result = validateScenario(raw);
  expectOk(result); // 不致命
  const hit = result.warnings.find(
    (w) =>
      w.path.includes("narrative_style") && w.message.includes("超过软上限"),
  );
  if (!hit) {
    throw new Error(
      `expected a warning about sample_paragraph_md length, got:\n${result.warnings
        .map((w) => `  - ${w.path}: ${w.message}`)
        .join("\n")}`,
    );
  }
});

test("narrative_style 顶层不是对象时报错", () => {
  const raw = cloneMinimal();
  raw["narrative_style"] = "not an object";
  expectFail(validateScenario(raw), "narrative_style");
});

test("narrative_style.frame.forbidden_phrasings 元素不是字符串时报错", () => {
  const raw = cloneMinimal();
  raw["narrative_style"] = {
    frame: { forbidden_phrasings: ["合法", 42] },
  };
  expectFail(validateScenario(raw), "forbidden_phrasings");
});

test("narrative_style.freedom.sample_paragraph_md 不是字符串时报错", () => {
  const raw = cloneMinimal();
  raw["narrative_style"] = {
    freedom: { sample_paragraph_md: 12345 },
  };
  expectFail(validateScenario(raw), "sample_paragraph_md");
});

// ---------------------------------------------------------------------------
// §12 recommended_occupations + preset_investigators
// ---------------------------------------------------------------------------

test("meta.recommended_occupations 缺失必报错", () => {
  const raw = cloneMinimal();
  delete (raw["meta"] as Record<string, unknown>)["recommended_occupations"];
  expectFail(validateScenario(raw), "recommended_occupations");
});

test("meta.recommended_occupations 名字不在 era 表里必报错", () => {
  const raw = cloneMinimal();
  (raw["meta"] as Record<string, unknown>)["recommended_occupations"] = ["不存在的职业"];
  expectFail(validateScenario(raw), "recommended_occupations");
});

test("meta.recommended_occupations 用 occupation id 也能命中", () => {
  const raw = cloneMinimal();
  (raw["meta"] as Record<string, unknown>)["recommended_occupations"] = [
    "private-investigator-modern",
  ];
  const result = validateScenario(raw);
  expectOk(result);
});

test("preset_investigators 缺省时通过", () => {
  const raw = cloneMinimal();
  const result = validateScenario(raw);
  expectOk(result);
  assert(
    result.scenario.presetInvestigators === undefined,
    "presetInvestigators 缺省应为 undefined",
  );
});

test("preset_investigators 完整结构通过且字段被解析为 camelCase", () => {
  const raw = cloneMinimal();
  raw["preset_investigators"] = [
    {
      id: "pc.demo",
      name: "演示调查员",
      age: 32,
      gender: "女",
      occupation: "私家侦探",
      attributes: {
        str: 60, con: 60, siz: 55, dex: 65, app: 55,
        int: 75, pow: 60, edu: 70,
      },
      sanity: 60,
      luck: 55,
      credit_rating: 40,
      skills: { "侦查": 70, "心理学": 60 },
      overview_md: "久经街头的女侦探。",
      background_story_md: "在波士顿做了十年案子。",
      cash_balance: 120,
    },
  ];
  const result = validateScenario(raw);
  expectOk(result);
  assert(
    Array.isArray(result.scenario.presetInvestigators) &&
      result.scenario.presetInvestigators.length === 1,
    "presetInvestigators 长度应为 1",
  );
  const pc = result.scenario.presetInvestigators![0];
  assert(pc.id === "pc.demo", "id 应原样保留");
  assert(pc.creditRating === 40, "credit_rating 应转为 creditRating");
  assert(pc.backgroundStoryMd?.includes("十年"), "background_story_md 应转为 backgroundStoryMd");
  assert(pc.cashBalance === 120, "cash_balance 应转为 cashBalance");
});

test("preset_investigators.attributes 越界报错", () => {
  const raw = cloneMinimal();
  raw["preset_investigators"] = [
    {
      id: "pc.bad-attr",
      name: "数值越界",
      age: 30,
      occupation: "私家侦探",
      attributes: {
        str: 5, con: 60, siz: 55, dex: 65, app: 55,
        int: 75, pow: 60, edu: 70,
      },
      sanity: 60, luck: 55, credit_rating: 40,
      skills: {},
      overview_md: "测试越界",
    },
  ];
  expectFail(validateScenario(raw), "attributes.str");
});

test("preset_investigators.skills 数值越界报错", () => {
  const raw = cloneMinimal();
  raw["preset_investigators"] = [
    {
      id: "pc.bad-skill",
      name: "技能越界",
      age: 30,
      occupation: "私家侦探",
      attributes: {
        str: 50, con: 60, siz: 55, dex: 65, app: 55,
        int: 75, pow: 60, edu: 70,
      },
      sanity: 60, luck: 55, credit_rating: 40,
      skills: { "侦查": 95 },
      overview_md: "测试技能越界",
    },
  ];
  expectFail(validateScenario(raw), "skills.侦查");
});

test("preset_investigators.occupation 不在 era 表里报错", () => {
  const raw = cloneMinimal();
  raw["preset_investigators"] = [
    {
      id: "pc.bad-occ",
      name: "职业越界",
      age: 30,
      occupation: "完全不存在的职业",
      attributes: {
        str: 50, con: 60, siz: 55, dex: 65, app: 55,
        int: 75, pow: 60, edu: 70,
      },
      sanity: 60, luck: 55, credit_rating: 40,
      skills: {},
      overview_md: "测试职业不存在",
    },
  ];
  expectFail(validateScenario(raw), "occupation");
});

test("preset_investigators.sanity 超过 pow*5 报错", () => {
  const raw = cloneMinimal();
  raw["preset_investigators"] = [
    {
      id: "pc.bad-san",
      name: "SAN 越界",
      age: 30,
      occupation: "私家侦探",
      attributes: {
        str: 50, con: 60, siz: 55, dex: 65, app: 55,
        int: 75, pow: 15, edu: 70,
      },
      sanity: 99, luck: 55, credit_rating: 40,
      skills: {},
      overview_md: "测试 SAN 越界",
    },
  ];
  expectFail(validateScenario(raw), "sanity");
});

test("preset_investigators id 重复报错", () => {
  const raw = cloneMinimal();
  const sample = {
    id: "pc.same",
    name: "甲",
    age: 30,
    occupation: "私家侦探",
    attributes: {
      str: 50, con: 60, siz: 55, dex: 65, app: 55,
      int: 75, pow: 60, edu: 70,
    },
    sanity: 60, luck: 55, credit_rating: 40,
    skills: {},
    overview_md: "重复 id 测试",
  };
  raw["preset_investigators"] = [sample, { ...sample, name: "乙" }];
  expectFail(validateScenario(raw), "preset_investigators");
});

// ---------------------------------------------------------------------------
// 跑
// ---------------------------------------------------------------------------

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

console.log(`Running ${tests.length} validator self-tests...\n`);
for (const t of tests) {
  try {
    t.run();
    console.log(`  ${GREEN}✓${RESET} ${t.name}`);
  } catch (e) {
    failures++;
    console.log(`  ${RED}✗${RESET} ${t.name}`);
    console.log(`    ${DIM}${(e as Error).message.replace(/\n/g, "\n    ")}${RESET}`);
  }
}
console.log();
if (failures > 0) {
  console.log(`${RED}${failures} test(s) failed.${RESET}`);
  process.exit(1);
}
console.log(`${GREEN}All ${tests.length} tests passed.${RESET}`);
