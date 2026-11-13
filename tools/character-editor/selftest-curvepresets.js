/*
 * selftest-curvepresets.js —— curve-presets.js 的纯函数自检（Node / 浏览器共用）
 * 依赖：curve-presets.js（globalThis.SpineCurvePresets）
 * 输出：globalThis.__selftestCurvePresetsResult = {passed, failed, total, skipped, cases, failures, notes}
 * 覆盖：预设清单 / 归一化→绝对换算 / 反向值域 / 多分量平铺 / 非法段 / 反查预设 / 描述文本。
 */
(function (global) {
  "use strict";

  var result = { passed: 0, failed: 0, total: 0, skipped: 0, cases: {}, failures: [], notes: [], startedAt: new Date().toISOString() };
  var currentCase = "(global)";

  function record(pass, name, expected, actual, detail) {
    result.total++;
    var c = result.cases[currentCase] || (result.cases[currentCase] = { passed: 0, failed: 0 });
    if (pass) { result.passed++; c.passed++; return true; }
    result.failed++; c.failed++;
    result.failures.push({ case: currentCase, name: name, expected: expected === undefined ? null : expected, actual: actual === undefined ? null : actual, detail: detail || "" });
    return false;
  }
  function ok(name, cond, detail) { return record(!!cond, name, "truthy", cond, detail); }
  function eq(name, actual, expected) { return record(actual === expected, name, expected, actual); }
  function near(name, actual, expected, tol) {
    var t = tol === undefined ? 1e-6 : tol;
    return record(typeof actual === "number" && isFinite(actual) && Math.abs(actual - expected) <= t, name, expected, actual, "tol=" + t);
  }
  function deepEq(name, actual, expected) {
    var a = JSON.stringify(actual), b = JSON.stringify(expected);
    return record(a === b, name, b, a);
  }
  function section(name) { currentCase = name; }

  var P = global.SpineCurvePresets;
  if (!P) {
    result.total++; result.failed++;
    result.failures.push({ case: "(load)", name: "SpineCurvePresets 未加载", expected: "object", actual: typeof P, detail: "" });
    global.__selftestCurvePresetsResult = result;
    if (typeof window !== "undefined") window.__selftestCurvePresetsResult = result;
    return;
  }

  /* ================================================================== *
   * 1. 预设清单
   * ================================================================== */
  section("清单：8 个预设与字段");

  var list = P.listPresets();
  eq("预设数量 8", list.length, 8);
  ok("linear 在清单里", list.some(function (p) { return p.id === "linear"; }));
  ok("easeInOut 在清单里", list.some(function (p) { return p.id === "easeInOut"; }));
  ok("每个预设都有中文标签", list.every(function (p) { return typeof p.label === "string" && p.label.length > 0; }));
  ok("每个预设都有 4 个归一化控制点", list.every(function (p) { return typeof p.points.x1 === "number" && typeof p.points.y2 === "number"; }));
  eq("linear 不过冲", P.presetOf("linear").over, false);
  eq("backOut 过冲", P.presetOf("backOut").over, true);
  eq("backIn 过冲", P.presetOf("backIn").over, true);
  eq("未知预设返回 null", P.presetOf("nope"), null);
  eq("非字符串返回 null", P.presetOf(42), null);

  /* ================================================================== *
   * 2. 归一化 → 绝对换算
   * ================================================================== */
  section("换算：归一化控制点 → 段内绝对坐标");

  var lin = P.applyPreset({ preset: "linear", time1: 0, time2: 1, value1: 0, value2: 100 });
  eq("linear.ok", lin.ok, true);
  near("linear cx1 = 1/3", lin.curve[0], 0.333333, 1e-5);
  near("linear cy1 = 100/3", lin.curve[1], 33.333333, 1e-4);
  near("linear cx2 = 2/3", lin.curve[2], 0.666667, 1e-5);
  near("linear cy2 = 200/3", lin.curve[3], 66.666667, 1e-4);

  var eio = P.applyPreset({ preset: "easeInOut", time1: 0, time2: 1, value1: 0, value2: 100 });
  near("easeInOut cx1 = 0.42", eio.curve[0], 0.42, 1e-9);
  near("easeInOut cy1 = 0", eio.curve[1], 0, 1e-9);
  near("easeInOut cx2 = 0.58", eio.curve[2], 0.58, 1e-9);
  near("easeInOut cy2 = 100", eio.curve[3], 100, 1e-9);

  /* 时间不从 0 起：控制点必须跟着平移 */
  var shifted = P.applyPreset({ preset: "easeInOut", time1: 2, time2: 3, value1: 0, value2: 100 });
  near("平移后 cx1 = 2 + 0.42", shifted.curve[0], 2.42, 1e-9);
  near("平移后 cx2 = 2 + 0.58", shifted.curve[2], 2.58, 1e-9);

  /* 值域不从 0 起：控制点按 (v2-v1) 缩放后加 v1 */
  var vshift = P.applyPreset({ preset: "easeInOut", time1: 0, time2: 1, value1: 50, value2: 150 });
  near("值平移后 cy1 = 50", vshift.curve[1], 50, 1e-9);
  near("值平移后 cy2 = 150", vshift.curve[3], 150, 1e-9);

  /* 值反向（v2 < v1）：进度映射必须用负的 dv */
  var rev = P.applyPreset({ preset: "easeInOut", time1: 0, time2: 1, value1: 100, value2: 0 });
  near("反向值 cy1 = 100", rev.curve[1], 100, 1e-9);
  near("反向值 cy2 = 0", rev.curve[3], 0, 1e-9);
  var revLinear = P.applyPreset({ preset: "linear", time1: 0, time2: 1, value1: 100, value2: 0 });
  near("反向 linear cy1 = 100 - 100/3", revLinear.curve[1], 66.666667, 1e-4);

  /* 过冲：y 会越出 [v1,v2] */
  var back = P.applyPreset({ preset: "backOut", time1: 0, time2: 1, value1: 0, value2: 100 });
  eq("backOut.over", back.over, true);
  ok("backOut 的 cy1 超过 v2（过冲）", back.curve[1] > 100);
  var backIn = P.applyPreset({ preset: "backIn", time1: 0, time2: 1, value1: 0, value2: 100 });
  ok("backIn 的 cy2 低于 v1（反向预备）", backIn.curve[3] < 0);

  /* ================================================================== *
   * 3. 非法段
   * ================================================================== */
  section("非法：未知预设 / 非有限数 / 时间不递增");

  eq("未知预设 → ok:false", P.applyPreset({ preset: "nope", time1: 0, time2: 1, value1: 0, value2: 1 }).ok, false);
  eq("未知预设错误码", P.applyPreset({ preset: "nope", time1: 0, time2: 1, value1: 0, value2: 1 }).issues[0].code, "PRESET_UNKNOWN");
  eq("非有限数 → ok:false", P.applyPreset({ preset: "linear", time1: 0, time2: NaN, value1: 0, value2: 1 }).ok, false);
  eq("时间相等 → ok:false（没有可插值区间）", P.applyPreset({ preset: "linear", time1: 1, time2: 1, value1: 0, value2: 1 }).ok, false);
  eq("时间倒序 → ok:false", P.applyPreset({ preset: "linear", time1: 2, time2: 1, value1: 0, value2: 1 }).ok, false);
  eq("时间不递增的错误码", P.applyPreset({ preset: "linear", time1: 2, time2: 1, value1: 0, value2: 1 }).issues[0].code, "PRESET_TIME_ORDER");
  eq("失败时 curve 为 null", P.applyPreset({ preset: "nope", time1: 0, time2: 1, value1: 0, value2: 1 }).curve, null);

  /* ================================================================== *
   * 4. 多分量
   * ================================================================== */
  section("多分量：translate/scale 的 4N 平铺");

  var multi = P.applyPresetMulti({ preset: "easeInOut", time1: 0, time2: 1, from: [0, 0], to: [100, -100] });
  eq("两分量 → 8 个数", multi.curve.length, 8);
  near("分量 0 的 cx1", multi.curve[0], 0.42, 1e-9);
  near("分量 0 的 cy2", multi.curve[3], 100, 1e-9);
  near("分量 1 的 cx1（时间相同）", multi.curve[4], 0.42, 1e-9);
  near("分量 1 的 cy2（值为 -100）", multi.curve[7], -100, 1e-9);

  eq("长度不等 → ok:false", P.applyPresetMulti({ preset: "linear", time1: 0, time2: 1, from: [0], to: [1, 2] }).ok, false);
  eq("空数组 → ok:false", P.applyPresetMulti({ preset: "linear", time1: 0, time2: 1, from: [], to: [] }).ok, false);
  eq("缺数组 → ok:false", P.applyPresetMulti({ preset: "linear", time1: 0, time2: 1 }).ok, false);
  eq("单分量 → 4 个数", P.applyPresetMulti({ preset: "linear", time1: 0, time2: 1, from: [0], to: [10] }).curve.length, 4);
  var multiOver = P.applyPresetMulti({ preset: "backOut", time1: 0, time2: 1, from: [0, 0], to: [10, 10] });
  eq("任一分量过冲 → over=true", multiOver.over, true);

  /* ================================================================== *
   * 5. 反查
   * ================================================================== */
  section("反查：绝对控制点 → 最近的预设");

  var m1 = P.matchPreset({ time1: 0, time2: 1, value1: 0, value2: 100, cx1: lin.curve[0], cy1: lin.curve[1], cx2: lin.curve[2], cy2: lin.curve[3] });
  eq("反查 linear.ok", m1.ok, true);
  eq("反查出 linear", m1.preset, "linear");
  ok("linear 误差极小", m1.distance < 1e-4);

  var m2 = P.matchPreset({ time1: 0, time2: 1, value1: 0, value2: 100, cx1: eio.curve[0], cy1: eio.curve[1], cx2: eio.curve[2], cy2: eio.curve[3] });
  eq("反查出 easeInOut", m2.preset, "easeInOut");

  var mShift = P.matchPreset({ time1: 5, time2: 8, value1: -20, value2: 40, cx1: 5 + 0.42 * 3, cy1: -20, cx2: 5 + 0.58 * 3, cy2: 40 });
  eq("平移缩放后仍能反查出 easeInOut", mShift.preset, "easeInOut");

  var mOdd = P.matchPreset({ time1: 0, time2: 1, value1: 0, value2: 100, cx1: 0.1, cy1: 0.9, cx2: 0.2, cy2: 0.1 });
  eq("奇怪曲线不硬认某个预设", mOdd.preset, null);
  ok("但仍给出最近候选", typeof mOdd.nearest === "string" && mOdd.nearest.length > 0);
  ok("候选按距离升序", mOdd.candidates[0].distance <= mOdd.candidates[1].distance);

  var mFlat = P.matchPreset({ time1: 0, time2: 1, value1: 50, value2: 50, cx1: 0.42, cy1: 50, cx2: 0.58, cy2: 50 });
  eq("值轴退化时标记 reduced", mFlat.reduced, true);
  eq("值轴退化只用 x 比较，仍能认出 easeInOut", mFlat.preset, "easeInOut");

  eq("缺分量 → ok:false", P.matchPreset({ time1: 0, time2: 1, value1: 0, value2: 100 }).ok, false);
  eq("时间不递增 → ok:false", P.matchPreset({ time1: 1, time2: 1, value1: 0, value2: 100, cx1: 0.3, cy1: 0, cx2: 0.6, cy2: 100 }).ok, false);

  /* ================================================================== *
   * 6. 描述
   * ================================================================== */
  section("描述：中文标签与过冲提示");

  ok("linear 描述含「线性」", /线性/.test(P.describePreset("linear")));
  ok("backOut 描述含过冲提示", /过冲/.test(P.describePreset("backOut")));
  ok("未知预设的描述可读", /未知预设/.test(P.describePreset("nope")));
  ok("可显式关闭过冲提示", !/过冲/.test(P.describePreset("backOut", { over: false })));

  result.finishedAt = new Date().toISOString();
  result.notes.push({ name: "覆盖面", detail: "清单/换算/反向值域/非法/多分量/反查/描述 共 " + result.total + " 条断言" });
  global.__selftestCurvePresetsResult = result;
  if (typeof window !== "undefined") window.__selftestCurvePresetsResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
