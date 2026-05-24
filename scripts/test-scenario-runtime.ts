/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * scenarioRuntime · applyScenarioActions 端到端冒烟测试
 *
 * 不依赖测试框架与浏览器,直接 tsx 跑。Phase 2.6 的"端到端跑通「一窝麻烦」"用例:
 *   1. 从 hook.start_scene 出发,走完 windsor → dorm → 拿 GPS → exterior → main-hall → ...
 *      → lair → boss → ending,沿路触发的合法 scenarioActions 都必须成功落账
 *   2. 故意构造若干非法动作,必须命中对应的 [...·拒绝] 反向标记
 *
 * 失败时进程 exit 1。CI / 人工 `tsx scripts/test-scenario-runtime.ts` 都能接。
 *
 * 注意:
 *   - 本脚本绕过 vite-plugin-yaml,直接用 js-yaml 读模组,再过 validateScenario,
 *     这与 module.ts 的运行时路径等价。
 *   - 用 lastRollContextRef 模拟 App.tsx 在玩家投骰后写入的 RollContext。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import yaml from "js-yaml";
import { validateScenario } from "../src/data/modules/_schema/validator.ts";
import {
  applyScenarioActions,
  initialScenarioState,
  type RollContext,
} from "../src/lib/scenarioRuntime.ts";
import type { Scenario } from "../src/data/modules/_schema/scenario.ts";
import type { ScenarioActions, ScenarioState } from "../src/types.ts";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const YAML_PATH = path.resolve(
  __dirname,
  "../src/data/modules/one-nest-of-trouble/scenario.yaml",
);

function loadScenario(): Scenario {
  const raw = yaml.load(fs.readFileSync(YAML_PATH, "utf8"));
  const result = validateScenario(raw);
  if (result.ok === false) {
    const lines = result.issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
    throw new Error(`scenario validation failed:\n${lines}`);
  }
  return result.scenario;
}

let failures = 0;
const tests: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void) {
  tests.push({ name, run });
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertHasMarker(markers: string[], substring: string) {
  if (!markers.some((m) => m.includes(substring))) {
    throw new Error(
      `expected a marker containing "${substring}", got:\n${markers.map((m) => `  - ${m}`).join("\n")}`,
    );
  }
}

function assertNoMarker(markers: string[], substring: string) {
  const hit = markers.find((m) => m.includes(substring));
  if (hit) throw new Error(`unexpected marker:\n  - ${hit}`);
}

const scenario = loadScenario();

// ---------------------------------------------------------------------------
// 用例 1:合法主线 happy path —— windsor → dorm → 拿 GPS → exterior → main-hall
//                            → victims-room → water-bath → lair → boss → ending
// ---------------------------------------------------------------------------

test("happy path: windsor → ending.victory-rescue", () => {
  let s: ScenarioState = initialScenarioState(scenario);
  assert(s.currentSceneId === "scene.windsor-college", "起手必须在 windsor-college");
  assert(s.elapsedMinutes === 0, "起手 elapsedMinutes 必须 0");

  // 1) windsor → clarence-dorm (free 出口)
  let r = applyScenarioActions(
    { sceneTransition: { toSceneId: "scene.clarence-dorm" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[场景切换]");
  s = r.nextState;
  assert(s.currentSceneId === "scene.clarence-dorm", "1) 应在宿舍");

  // 2) 在宿舍发现 GPS 笔记本(skill spot-hidden, regular)
  const rollSpot: RollContext = {
    skill: "spot-hidden",
    difficulty: "regular",
    successType: "regular",
  };
  r = applyScenarioActions(
    { clueDiscovered: { clueId: "clue.gps-notebook", method: "skill" } },
    s,
    scenario,
    rollSpot,
  );
  assertHasMarker(r.systemMarkers, "[线索发现]");
  s = r.nextState;
  assert(s.discoveredClueIds.includes("clue.gps-notebook"), "2) gps-notebook 必须入册");
  assert(s.endingFlags["flag.found-gps"] === true, "2) clue.unlocks.flags 必须 propagate");

  // 3a) dorm → windsor(回校园,dorm 唯一出口)
  r = applyScenarioActions(
    { sceneTransition: { toSceneId: "scene.windsor-college" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[场景切换]");
  s = r.nextState;

  // 3b) windsor → asylum-exterior(requires-clue: clue.gps-notebook)
  r = applyScenarioActions(
    { sceneTransition: { toSceneId: "scene.asylum-exterior" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[场景切换]");
  s = r.nextState;

  // 4) exterior → main-hall(free)
  r = applyScenarioActions(
    {
      sceneTransition: { toSceneId: "scene.asylum-main-hall" },
      timeAdvance: { minutes: 30, reason: "驾车前往" },
    },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[场景切换]");
  assertHasMarker(r.systemMarkers, "[时间推进]");
  s = r.nextState;
  assert(s.elapsedMinutes === 30, "4) elapsedMinutes 必须累加到 30");

  // 5) main-hall 触发 first-corpse(auto-on-enter,可不依赖 roll)
  r = applyScenarioActions(
    { clueDiscovered: { clueId: "clue.first-corpse", method: "auto-on-enter" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[线索发现]");
  s = r.nextState;
  assert(s.discoveredClueIds.includes("clue.first-corpse"), "5) first-corpse 入册");

  // 6) main-hall → victims-room(free)
  r = applyScenarioActions(
    { sceneTransition: { toSceneId: "scene.asylum-victims-room" } },
    s,
    scenario,
    null,
  );
  s = r.nextState;

  // 7) 在 victims-room 摄像机录像(skill computer-use, regular)→ flag.found-camera
  const rollComputer: RollContext = {
    skill: "computer-use",
    difficulty: "regular",
    successType: "hard",
  };
  r = applyScenarioActions(
    { clueDiscovered: { clueId: "clue.video-camera", method: "skill" } },
    s,
    scenario,
    rollComputer,
  );
  assertHasMarker(r.systemMarkers, "[线索发现]");
  s = r.nextState;
  assert(s.endingFlags["flag.found-camera"] === true, "7) flag.found-camera 必须由 unlocks.flags 置 true");

  // 8) 没回到 main-hall 就不能直接走 water-bath。先回 main-hall。
  r = applyScenarioActions(
    { sceneTransition: { toSceneId: "scene.asylum-main-hall" } },
    s,
    scenario,
    null,
  );
  s = r.nextState;

  // 9) main-hall → water-bath(requires-flag: flag.found-camera = true)
  r = applyScenarioActions(
    { sceneTransition: { toSceneId: "scene.water-bath-room" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[场景切换]");
  s = r.nextState;
  assert(s.currentSceneId === "scene.water-bath-room", "9) 应已进入水浴室");

  // 10) water-bath:track(regular)发现血迹 clue.tracking-blood
  const rollTrack: RollContext = {
    skill: "track",
    difficulty: "regular",
    successType: "regular",
  };
  r = applyScenarioActions(
    { clueDiscovered: { clueId: "clue.tracking-blood", method: "skill" } },
    s,
    scenario,
    rollTrack,
  );
  assertHasMarker(r.systemMarkers, "[线索发现]");
  s = r.nextState;

  // 11) water-bath → lair(requires-clue: clue.tracking-blood)
  r = applyScenarioActions(
    { sceneTransition: { toSceneId: "scene.lair" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[场景切换]");
  s = r.nextState;

  // 12) 进 lair 自动获得 alex-personal-effects → 解锁 alex secret + flag.met-dog-man
  r = applyScenarioActions(
    { clueDiscovered: { clueId: "clue.alex-personal-effects", method: "auto-on-enter" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[线索发现]");
  s = r.nextState;
  assert(
    s.unlockedSecretIds.includes("npc.kyle-alexander"),
    "12) clue.unlocks.secrets 必须解锁 npc.kyle-alexander",
  );
  assert(s.endingFlags["flag.met-dog-man"] === true, "12) flag.met-dog-man 必须置 true");

  // 13) Boss 战胜利 + 救出亚历山大 — flagSet[]
  r = applyScenarioActions(
    {
      flagSet: [
        { flagId: "flag.boss-defeated", value: true, reason: "梅德拉倒下" },
        { flagId: "flag.alex-rescued", value: true, reason: "把亚历山大抬出" },
      ],
    },
    s,
    scenario,
    null,
  );
  assert(
    r.systemMarkers.filter((m) => m.startsWith("[Flag 设定]")).length === 2,
    "13) 两条 flagSet 都应落账",
  );
  s = r.nextState;
  assert(s.endingFlags["flag.boss-defeated"] === true, "13) boss-defeated 必须 true");
  assert(s.endingFlags["flag.alex-rescued"] === true, "13) alex-rescued 必须 true");

  // 14) endingProposed: ending.victory-rescue
  r = applyScenarioActions(
    { endingProposed: { endingId: "ending.victory-rescue" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[终幕条件已满足]");
  assert(r.autoEnding !== null, "14) autoEnding 不能为 null");
  assert(r.autoEnding!.kind === "victory", "14) autoEnding.kind 必须 victory");
  assert(
    typeof r.autoEnding!.epilogue === "string" && r.autoEnding!.epilogue.length > 0,
    "14) epilogue 必须有内容",
  );
});

// ---------------------------------------------------------------------------
// 用例 2:非法 sceneTransition —— 跨场景跳转不在 exits 列表
// ---------------------------------------------------------------------------

test("非法 sceneTransition: windsor 直接跳 lair", () => {
  const s = initialScenarioState(scenario);
  const r = applyScenarioActions(
    { sceneTransition: { toSceneId: "scene.lair" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[场景非法·拒绝]");
  assert(r.nextState === s, "拒绝时 state 不能变");
  assert(r.autoEnding === null, "拒绝时 autoEnding 必须 null");
});

// ---------------------------------------------------------------------------
// 用例 3:requires-clue 闸 — windsor → exterior 没拿 GPS 就拒绝
// ---------------------------------------------------------------------------

test("requires-clue 闸: windsor → exterior 缺 gps-notebook", () => {
  const s = initialScenarioState(scenario);
  const r = applyScenarioActions(
    { sceneTransition: { toSceneId: "scene.asylum-exterior" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[场景条件未满足·拒绝]");
  assert(r.nextState === s, "拒绝时 state 不能变");
});

// ---------------------------------------------------------------------------
// 用例 4:requires-flag 闸 — main-hall → water-bath 没看摄像机就拒绝
// ---------------------------------------------------------------------------

test("requires-flag 闸: main-hall → water-bath 缺 found-camera", () => {
  let s = initialScenarioState(scenario);
  // 先走到 main-hall(经过 dorm + GPS + 回 windsor + exterior)
  const rollSpot: RollContext = { skill: "spot-hidden", difficulty: "regular", successType: "regular" };
  s = applyScenarioActions({ sceneTransition: { toSceneId: "scene.clarence-dorm" } }, s, scenario, null).nextState;
  s = applyScenarioActions({ clueDiscovered: { clueId: "clue.gps-notebook", method: "skill" } }, s, scenario, rollSpot).nextState;
  s = applyScenarioActions({ sceneTransition: { toSceneId: "scene.windsor-college" } }, s, scenario, null).nextState;
  s = applyScenarioActions({ sceneTransition: { toSceneId: "scene.asylum-exterior" } }, s, scenario, null).nextState;
  s = applyScenarioActions({ sceneTransition: { toSceneId: "scene.asylum-main-hall" } }, s, scenario, null).nextState;
  assert(s.currentSceneId === "scene.asylum-main-hall", "前置:已在 main-hall");

  // 缺 flag.found-camera 时应被拒
  const r = applyScenarioActions(
    { sceneTransition: { toSceneId: "scene.water-bath-room" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[场景条件未满足·拒绝]");
  assert(r.nextState === s, "拒绝时 state 不变");
});

// ---------------------------------------------------------------------------
// 用例 5:clue 投骰失败 —— spot-hidden 投了 failure,gps-notebook 不给入册
// ---------------------------------------------------------------------------

test("clue skill gate: spot-hidden failure 拒绝 gps-notebook", () => {
  let s = initialScenarioState(scenario);
  s = applyScenarioActions({ sceneTransition: { toSceneId: "scene.clarence-dorm" } }, s, scenario, null).nextState;
  const failRoll: RollContext = { skill: "spot-hidden", difficulty: "regular", successType: "failure" };
  const r = applyScenarioActions(
    { clueDiscovered: { clueId: "clue.gps-notebook", method: "skill" } },
    s,
    scenario,
    failRoll,
  );
  assertHasMarker(r.systemMarkers, "[线索条件未满足·拒绝]");
  assert(r.nextState === s, "拒绝时 state 不变");
  assert(r.nextState.discoveredClueIds.length === s.discoveredClueIds.length, "线索没入册");
});

// ---------------------------------------------------------------------------
// 用例 6:clue method 不匹配 —— gps-notebook 实际 method=skill,LLM 报 auto-on-enter 必拒
// ---------------------------------------------------------------------------

test("clue method mismatch: gps-notebook ≠ auto-on-enter", () => {
  let s = initialScenarioState(scenario);
  s = applyScenarioActions({ sceneTransition: { toSceneId: "scene.clarence-dorm" } }, s, scenario, null).nextState;
  const r = applyScenarioActions(
    { clueDiscovered: { clueId: "clue.gps-notebook", method: "auto-on-enter" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[线索条件未满足·拒绝]");
});

// ---------------------------------------------------------------------------
// 用例 7:flag writableBy 闸 —— flag.found-gps 不允许 scenario-actions 写
// ---------------------------------------------------------------------------

test("flag writableBy: flag.found-gps 拒绝 scenario-actions 写入", () => {
  const s = initialScenarioState(scenario);
  const r = applyScenarioActions(
    { flagSet: [{ flagId: "flag.found-gps", value: true }] },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[Flag 非法·拒绝]");
  assert(r.nextState.endingFlags["flag.found-gps"] === false, "原 flag 不能被改");
});

// ---------------------------------------------------------------------------
// 用例 8:endingProposed trigger 不齐 —— alex-rescued 未置 true 时拒绝
// ---------------------------------------------------------------------------

test("ending trigger 不齐: ending.victory-rescue 缺 alex-rescued 必拒", () => {
  const s: ScenarioState = {
    ...initialScenarioState(scenario),
    endingFlags: {
      ...initialScenarioState(scenario).endingFlags,
      "flag.boss-defeated": true,
      // alex-rescued 故意保持 false
    },
  };
  const r = applyScenarioActions(
    { endingProposed: { endingId: "ending.victory-rescue" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[终幕条件未达成·拒绝]");
  assert(r.autoEnding === null, "trigger 不齐时 autoEnding 必须 null");
});

// ---------------------------------------------------------------------------
// 用例 9:per-unit reject —— 一回合下发 5 通道,2 合法 + 3 非法,合法的应单独落账
// ---------------------------------------------------------------------------

test("per-unit reject: 合法+非法混合时各自处理", () => {
  let s = initialScenarioState(scenario);
  // 把状态推到 main-hall(合法)
  const rollSpot: RollContext = { skill: "spot-hidden", difficulty: "regular", successType: "regular" };
  s = applyScenarioActions({ sceneTransition: { toSceneId: "scene.clarence-dorm" } }, s, scenario, null).nextState;
  s = applyScenarioActions({ clueDiscovered: { clueId: "clue.gps-notebook", method: "skill" } }, s, scenario, rollSpot).nextState;
  s = applyScenarioActions({ sceneTransition: { toSceneId: "scene.windsor-college" } }, s, scenario, null).nextState;
  s = applyScenarioActions({ sceneTransition: { toSceneId: "scene.asylum-exterior" } }, s, scenario, null).nextState;
  s = applyScenarioActions({ sceneTransition: { toSceneId: "scene.asylum-main-hall" } }, s, scenario, null).nextState;

  const mixed: ScenarioActions = {
    // 合法:进 victims-room
    sceneTransition: { toSceneId: "scene.asylum-victims-room" },
    // 非法:此 clue 在另一场景(此回合 sceneTransition 已先把玩家挪到 victims-room,first-corpse 在 main-hall)
    clueDiscovered: { clueId: "clue.first-corpse", method: "auto-on-enter" },
    // 合法:推 5 分钟
    timeAdvance: { minutes: 5, reason: "穿过血迹走过去" },
    // 非法:flag.found-gps 不可写
    flagSet: [{ flagId: "flag.found-gps", value: false }],
    // 非法:终幕条件没达
    endingProposed: { endingId: "ending.victory-rescue" },
  };
  const r = applyScenarioActions(mixed, s, scenario, null);

  // 合法 sceneTransition 落账
  assert(r.nextState.currentSceneId === "scene.asylum-victims-room", "合法 sceneTransition 必须落账");
  // 非法 clue:locationScene 不匹配(first-corpse 在 main-hall,但当前已是 victims-room)
  assertHasMarker(r.systemMarkers, "[线索条件未满足·拒绝]");
  // 合法 timeAdvance 落账
  assert(r.nextState.elapsedMinutes === 5, "timeAdvance 必须独立落账,即便其他通道有拒绝");
  // 非法 flag
  assertHasMarker(r.systemMarkers, "[Flag 非法·拒绝]");
  // 非法 ending
  assertHasMarker(r.systemMarkers, "[终幕条件未达成·拒绝]");
  // autoEnding 必须 null(因为 ending 被拒)
  assert(r.autoEnding === null, "被拒的 ending 不能产生 autoEnding");
});

// ---------------------------------------------------------------------------
// 用例 10:timeAdvance 非法 —— 负数与小数(经 floor)
// ---------------------------------------------------------------------------

test("timeAdvance: 负数拒绝,小数 floor", () => {
  const s = initialScenarioState(scenario);
  const r1 = applyScenarioActions({ timeAdvance: { minutes: -10 } }, s, scenario, null);
  assertHasMarker(r1.systemMarkers, "[时间推进非法·拒绝]");
  assert(r1.nextState.elapsedMinutes === 0, "负数不能改 elapsedMinutes");

  const r2 = applyScenarioActions({ timeAdvance: { minutes: 7.9 } }, s, scenario, null);
  assertHasMarker(r2.systemMarkers, "[时间推进]");
  assert(r2.nextState.elapsedMinutes === 7, "小数应 floor 为整数 7");
});

// ---------------------------------------------------------------------------
// 用例 11:已发现线索不重复 —— 第二次下发同一条 clue 必拒
// ---------------------------------------------------------------------------

test("已发现线索不重复: gps-notebook 二次下发必拒", () => {
  let s = initialScenarioState(scenario);
  const roll: RollContext = { skill: "spot-hidden", difficulty: "regular", successType: "regular" };
  s = applyScenarioActions({ sceneTransition: { toSceneId: "scene.clarence-dorm" } }, s, scenario, null).nextState;
  s = applyScenarioActions({ clueDiscovered: { clueId: "clue.gps-notebook", method: "skill" } }, s, scenario, roll).nextState;

  const r = applyScenarioActions(
    { clueDiscovered: { clueId: "clue.gps-notebook", method: "skill" } },
    s,
    scenario,
    roll,
  );
  assertHasMarker(r.systemMarkers, "[线索非法·拒绝]");
});

// ---------------------------------------------------------------------------
// 用例 12:requires-skill 出口 —— 不存在的钩子(本模组无 requires-skill 出口)
//          这里用反向方式验证:gate 函数对不存在的 condition 不会 throw
// ---------------------------------------------------------------------------

test("rollContext = null:method=skill 的 clue 必拒(无可信投骰)", () => {
  let s = initialScenarioState(scenario);
  s = applyScenarioActions({ sceneTransition: { toSceneId: "scene.clarence-dorm" } }, s, scenario, null).nextState;
  const r = applyScenarioActions(
    { clueDiscovered: { clueId: "clue.gps-notebook", method: "skill" } },
    s,
    scenario,
    null,
  );
  assertHasMarker(r.systemMarkers, "[线索条件未满足·拒绝]");
});

// ---------------------------------------------------------------------------
// 跑测
// ---------------------------------------------------------------------------

console.log(`▶ scenario runtime smoke tests · ${tests.length} cases · module=${scenario.meta.id}`);
for (const t of tests) {
  try {
    t.run();
    console.log(`  ✓ ${t.name}`);
  } catch (e) {
    failures += 1;
    console.error(`  ✗ ${t.name}\n    ${(e as Error).message}`);
  }
}
console.log(`▶ ${tests.length - failures}/${tests.length} passed${failures > 0 ? ` · ${failures} failed` : ""}`);
if (failures > 0) process.exit(1);
