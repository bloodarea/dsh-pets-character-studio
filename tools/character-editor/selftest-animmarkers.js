/*
 * selftest-animmarkers.js —— anim-markers.js 的纯函数自检（Node / 浏览器共用）
 * 依赖：anim-markers.js（globalThis.SpineAnimMarkers）
 * 输出：globalThis.__selftestAnimMarkersResult = {passed, failed, total, skipped, cases, failures, notes}
 * 覆盖：规范化（时间/名称/颜色/时长越界）/ 帧↔秒换算 / 增删改 / 重复拒绝 /
 *       区间查询 / 最近标记 / 整份校验（坏项跳过）/ 上限 / 摘要。
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
    var t = tol === undefined ? 1e-9 : tol;
    return record(typeof actual === "number" && isFinite(actual) && Math.abs(actual - expected) <= t, name, expected, actual, "tol=" + t);
  }
  function deepEq(name, actual, expected) {
    var a = JSON.stringify(actual), b = JSON.stringify(expected);
    return record(a === b, name, b, a);
  }
  function section(name) { currentCase = name; }

  var M = global.SpineAnimMarkers;
  if (!M) {
    result.total++; result.failed++;
    result.failures.push({ case: "(load)", name: "SpineAnimMarkers 未加载", expected: "object", actual: typeof M, detail: "" });
    global.__selftestAnimMarkersResult = result;
    if (typeof window !== "undefined") window.__selftestAnimMarkersResult = result;
    return;
  }

  /* ================================================================== *
   * 1. 规范化
   * ================================================================== */
  section("规范化：时间 / 名称 / 颜色");

  var n1 = M.normalizeMarker({ time: 0.5, name: "抬手" }, { duration: 3.5 });
  eq("基本标记 ok", n1.ok, true);
  near("时间保留", n1.marker.time, 0.5, 1e-9);
  eq("名称保留", n1.marker.name, "抬手");
  eq("默认颜色", n1.marker.color, "#f0b429");

  eq("名称去首尾空格", M.normalizeMarker({ time: 0, name: "  抬手  " }).marker.name, "抬手");
  eq("空名称拒绝", M.normalizeMarker({ time: 0, name: "" }).ok, false);
  eq("全空格名称拒绝", M.normalizeMarker({ time: 0, name: "   " }).ok, false);
  eq("空名称错误码", M.normalizeMarker({ time: 0, name: "" }).issues[0].code, "MARKER_NAME_EMPTY");
  eq("超长名称拒绝", M.normalizeMarker({ time: 0, name: new Array(70).join("a") }).ok, false);
  eq("超长名称错误码", M.normalizeMarker({ time: 0, name: new Array(70).join("a") }).issues[0].code, "MARKER_NAME_TOO_LONG");

  eq("时间非数拒绝", M.normalizeMarker({ time: NaN, name: "x" }).ok, false);
  eq("时间非数错误码", M.normalizeMarker({ time: NaN, name: "x" }).issues[0].code, "MARKER_TIME_INVALID");
  eq("负时间拒绝", M.normalizeMarker({ time: -1, name: "x" }).ok, false);
  eq("负时间错误码", M.normalizeMarker({ time: -1, name: "x" }).issues[0].code, "MARKER_TIME_NEGATIVE");
  eq("超时长拒绝", M.normalizeMarker({ time: 5, name: "x" }, { duration: 3.5 }).ok, false);
  eq("超时长错误码", M.normalizeMarker({ time: 5, name: "x" }, { duration: 3.5 }).issues[0].code, "MARKER_TIME_OVER_DURATION");
  eq("恰好等于时长允许", M.normalizeMarker({ time: 3.5, name: "x" }, { duration: 3.5 }).ok, true);
  eq("无 duration 时不检查上限", M.normalizeMarker({ time: 999, name: "x" }).ok, true);

  eq("颜色转小写", M.normalizeMarker({ time: 0, name: "x", color: "#FF0000" }).marker.color, "#ff0000");
  eq("非法颜色拒绝", M.normalizeMarker({ time: 0, name: "x", color: "red" }).ok, false);
  eq("非法颜色错误码", M.normalizeMarker({ time: 0, name: "x", color: "red" }).issues[0].code, "MARKER_COLOR_INVALID");
  eq("三位缩写颜色拒绝", M.normalizeMarker({ time: 0, name: "x", color: "#f00" }).ok, false);
  eq("空颜色回落默认", M.normalizeMarker({ time: 0, name: "x", color: "" }).marker.color, "#f0b429");

  /* ================================================================== *
   * 2. 帧 ↔ 秒
   * ================================================================== */
  section("换算：帧 ↔ 秒（改 fps 不移动秒位置）");

  eq("toFrame(0.5, 30) = 15", M.toFrame(0.5, 30), 15);
  near("fromFrame(15, 30) = 0.5", M.fromFrame(15, 30), 0.5, 1e-9);
  eq("toFrame 四舍五入", M.toFrame(0.5167, 30), 16);
  eq("fps 非法回落 30", M.toFrame(0.5, 0), 15);
  eq("fps 超上限夹到 240", M.toFrame(1, 9999), 240);
  ok("toFrame 非数返回 NaN", isNaN(M.toFrame(NaN, 30)));
  /* 注意：帧是整数，秒→帧→秒必然有量化误差（1.234s @60fps → 74 帧 → 1.2333s）。
     这不是缺陷，是「帧是显示/操作坐标」的必然结果 —— 所以标记的**秒位置**是真值，
     改 fps 只改 frame 显示值，不移动秒（见 anim-markers 的 toFrame 注释）。 */
  near("秒→帧→秒 在 60fps 下误差不超过半帧", M.fromFrame(M.toFrame(1.234, 60), 60), 1.234, 0.5 / 60 + 1e-9);
  eq("同一秒在 30fps 下帧号", M.toFrame(1.234, 30), 37);
  eq("同一秒在 60fps 下帧号翻倍", M.toFrame(1.234, 60), 74);

  /* ================================================================== *
   * 3. 增删改
   * ================================================================== */
  section("增删改：排序 / 重复拒绝 / 定位删除");

  var a = M.addMarker([], { time: 1.0, name: "B" }, { duration: 3.5 });
  eq("add ok", a.ok, true);
  eq("add 返回 index", a.index, 0);
  var b = M.addMarker(a.list, { time: 0.5, name: "A" }, { duration: 3.5 });
  eq("add 后按时间升序", b.list[0].name, "A");
  eq("add 后第二条是 B", b.list[1].name, "B");
  eq("add 不改入参（原列表仍 1 条）", a.list.length, 1);

  var dup = M.addMarker(b.list, { time: 0.5, name: "A" }, { duration: 3.5 });
  eq("同刻同名 → 拒绝", dup.ok, false);
  eq("重复错误码", dup.issues[0].code, "MARKER_DUPLICATE");
  eq("重复时列表不变", dup.list.length, 2);
  var sameTime = M.addMarker(b.list, { time: 0.5, name: "A2" }, { duration: 3.5 });
  eq("同刻不同名 → 允许", sameTime.ok, true);

  var rmByIndex = M.removeMarker(b.list, 0);
  eq("按 index 删除 ok", rmByIndex.ok, true);
  eq("删除后剩 1 条", rmByIndex.list.length, 1);
  eq("删掉的是 A", rmByIndex.removed.name, "A");
  var rmByTime = M.removeMarker(b.list, { time: 0.5, name: "A" });
  eq("按 time+name 删除 ok", rmByTime.ok, true);
  eq("找不到 → ok:false", M.removeMarker(b.list, { time: 9, name: "Z" }).ok, false);
  eq("找不到错误码", M.removeMarker(b.list, { time: 9, name: "Z" }).issues[0].code, "MARKER_NOT_FOUND");
  eq("越界 index → ok:false", M.removeMarker(b.list, 99).ok, false);

  var up = M.updateMarker(b.list, 0, { name: "A改" }, { duration: 3.5 });
  eq("改名 ok", up.ok, true);
  eq("改名生效", up.marker.name, "A改");
  /* 注意：updateMarker 基于**传入的 list**，不是上一次的结果。b.list = [A(0.5), B(1.0)]。
     把 index 0（A）的时间改到 2.0s 后，顺序应为 B(1.0) → A(2.0)。 */
  var upTime = M.updateMarker(b.list, 0, { time: 2.0 }, { duration: 3.5 });
  eq("改时间后重新排序：最后一条是被改的 A", upTime.list[upTime.list.length - 1].name, "A");
  eq("改时间后重新排序：B 升到第一", upTime.list[0].name, "B");
  near("被改的 A 时间已是 2.0", upTime.list[1].time, 2.0, 1e-9);
  near("改名不动时间（仍在 0.5s）", up.list[0].time, 0.5, 1e-9);
  var upBad = M.updateMarker(b.list, 0, { name: "" }, { duration: 3.5 });
  eq("改成空名 → 拒绝", upBad.ok, false);
  eq("改越界 index → 拒绝", M.updateMarker(b.list, 9, { name: "x" }).ok, false);

  /* 改成与另一条重复也要拒绝 */
  var three = M.addMarker(b.list, { time: 0.5, name: "A" }, { duration: 3.5 }).list;
  var toDup = M.updateMarker(three, 1, { time: 0.5, name: "A" }, { duration: 3.5 });
  eq("改成同刻同名 → 拒绝", toDup.ok, false);

  /* ================================================================== *
   * 4. 查询
   * ================================================================== */
  section("查询：区间 / 最近 / 上限");

  var list = M.addMarker(M.addMarker([], { time: 0, name: "start" }, { duration: 3.5 }).list, { time: 1.75, name: "mid" }, { duration: 3.5 }).list;
  eq("区间含端点", M.markersInRange(list, 0, 1.75).length, 2);
  eq("区间只含中间", M.markersInRange(list, 1, 2).length, 1);
  eq("区间反序也正确", M.markersInRange(list, 1.75, 0).length, 2);
  eq("空区间", M.markersInRange(list, 2.5, 3).length, 0);

  eq("最近标记（精确命中）", M.nearestMarker(list, 1.75).name, "mid");
  eq("最近标记（靠近 start）", M.nearestMarker(list, 0.2).name, "start");
  eq("空列表返回 null", M.nearestMarker([], 1), null);
  eq("非数时间返回 null", M.nearestMarker(list, NaN), null);

  var many = [];
  for (var i = 0; i < M.MAX_MARKERS; i++) many.push({ time: (i % 100) / 100, name: "m" + i, color: "#f0b429" });
  eq("达到上限后拒绝", M.addMarker(many, { time: 0, name: "extra" }).ok, false);
  eq("上限错误码", M.addMarker(many, { time: 0, name: "extra" }).issues[0].code, "MARKER_LIMIT");

  /* ================================================================== *
   * 5. 整份校验
   * ================================================================== */
  section("整份校验：坏项跳过而不是整份丢弃");

  var mixed = M.validateList([
    { time: 1, name: "good1" },
    { time: NaN, name: "bad" },
    { time: 0.5, name: "good2" },
    { time: 2, name: "" },
  ], { duration: 3.5 });
  eq("坏项被跳过", mixed.list.length, 2);
  eq("保留的是好的两条", mixed.list[0].name, "good2");
  eq("整份不 ok（有坏项）", mixed.ok, false);
  ok("报告坏项原因", mixed.issues.length >= 2);
  ok("坏项路径可定位", /markers\[1\]/.test(mixed.issues[0].path));

  var clean = M.validateList([{ time: 1, name: "a" }], { duration: 3.5 });
  eq("全好时 ok", clean.ok, true);
  eq("非数组返回空列表", M.validateList(null).list.length, 0);

  /* ================================================================== *
   * 6. 摘要
   * ================================================================== */
  section("摘要：状态栏文本");

  eq("空列表摘要", M.summaryLine([]), "没有动作标记");
  ok("非空摘要含数量", /2 个标记/.test(M.summaryLine(list)));
  ok("非空摘要含名称", /start/.test(M.summaryLine(list)));
  ok("超过 3 个时用「等」", /等/.test(M.summaryLine([{ time: 0, name: "a" }, { time: 1, name: "b" }, { time: 2, name: "c" }, { time: 3, name: "d" }])));

  result.finishedAt = new Date().toISOString();
  result.notes.push({ name: "覆盖面", detail: "规范化/换算/增删改/查询/整份校验/摘要 共 " + result.total + " 条断言" });
  global.__selftestAnimMarkersResult = result;
  if (typeof window !== "undefined") window.__selftestAnimMarkersResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
