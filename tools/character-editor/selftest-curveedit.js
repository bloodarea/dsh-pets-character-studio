/*
 * selftest-curveedit.js —— curve-edit.js 的纯函数自检（Node / 浏览器共用）
 * 依赖：curve-edit.js（globalThis.SpineCurveEdit）；可选 spine-core.js（采样逐位对照）、
 *       Node 下读 references/spine-rigs/spineboy-pro-42/spineboy-pro.json 做真实数据往返。
 * 输出：globalThis.__selftestCurveEditResult = {passed, failed, total, skipped, cases, failures, notes}
 * 覆盖：分量上下文/默认值 · curve 编码解析 · 段信息 · 采样（与 spine-core 逐位对照）· 整轨求值 ·
 *       折线采样 · setSegmentType（整段/分量语义）· 控制点写入与手柄夹取 · 轨道校验 · 真实 curve 数据。
 */
(function (global) {
  "use strict";

  var result = {
    passed: 0,
    failed: 0,
    total: 0,
    skipped: 0,
    cases: {},
    failures: [],
    notes: [],
    startedAt: new Date().toISOString(),
  };
  var currentCase = "(global)";

  function fmt(v) {
    if (typeof v === "number") {
      if (!isFinite(v)) return String(v);
      return Math.abs(v) >= 1e-4 && Math.abs(v) < 1e6 ? String(Math.round(v * 1e6) / 1e6) : v.toExponential(6);
    }
    if (Array.isArray(v)) return "[" + v.map(fmt).join(", ") + "]";
    if (v && typeof v === "object") return JSON.stringify(v);
    return String(v);
  }
  function record(pass, name, expected, actual, detail) {
    result.total++;
    var c = result.cases[currentCase] || (result.cases[currentCase] = { passed: 0, failed: 0 });
    if (pass) {
      result.passed++;
      c.passed++;
      return true;
    }
    result.failed++;
    c.failed++;
    result.failures.push({
      case: currentCase,
      name: name,
      expected: expected === undefined ? null : expected,
      actual: actual === undefined ? null : actual,
      detail: detail || "",
    });
    return false;
  }
  function ok(name, cond, detail) {
    return record(!!cond, name, "truthy", cond, detail);
  }
  function eq(name, actual, expected) {
    return record(actual === expected, name, expected, actual);
  }
  function near(name, actual, expected, tol) {
    var t = tol === undefined ? 1e-6 : tol;
    var pass = typeof actual === "number" && isFinite(actual) && Math.abs(actual - expected) <= t;
    return record(pass, name, expected, actual, "tol=" + t);
  }
  function deepEq(name, actual, expected) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    return record(a === b, name, b, a);
  }
  function skip(name, detail) {
    result.skipped++;
    result.notes.push({ name: name, detail: detail || "" });
  }
  function section(name) {
    currentCase = name;
  }
  function snap(v) {
    return JSON.stringify(v);
  }

  /* ---------------- 依赖加载 ---------------- */
  var nodeMods = null;
  if (typeof process !== "undefined" && process.versions && process.versions.node) {
    try {
      if (typeof process.getBuiltinModule === "function") {
        nodeMods = { fs: process.getBuiltinModule("node:fs"), module: process.getBuiltinModule("node:module"), cwd: process.cwd() };
      }
    } catch (e) {
      nodeMods = null;
    }
  }
  var C = global.SpineCurveEdit;
  var core = global.SpineCore;
  if (nodeMods) {
    var cwd = nodeMods.cwd.replace(/[\\/]+$/, "");
    var cands = [cwd + "/tools/character-editor/curve-edit.js", cwd + "/curve-edit.js"];
    var req = null;
    try {
      req = nodeMods.module.createRequire(cwd + "/selftest-curveedit-loader.js");
    } catch (e) {
      req = null;
    }
    if (!C && req) {
      for (var ci = 0; ci < cands.length; ci++) {
        try {
          if (nodeMods.fs.existsSync(cands[ci])) {
            req(cands[ci]);
            C = global.SpineCurveEdit;
            break;
          }
        } catch (e) {
          /* ignore */
        }
      }
    }
    if (!core && req) {
      try {
        req(cwd + "/tools/character-editor/spine-core.js");
        core = global.SpineCore;
      } catch (e) {
        core = null;
      }
    }
  }

  if (!C) {
    record(false, "curve-edit.js 已加载（globalThis.SpineCurveEdit）", "存在", null);
    global.__selftestCurveEditResult = result;
    return;
  }

  /* ---------------- 夹具 ---------------- */
  var ROT = [
    { time: 0, value: 0 },
    { time: 0.5, value: 10, curve: [0.6, 3, 0.8, 7] },
    { time: 1, value: 0 },
  ];
  var TRA = [
    { time: 0, x: 0, y: 0 },
    { time: 1, x: 10, y: -10, curve: [1.3, 3, 1.7, -3, 1.4, -4, 1.6, -8] },
    { time: 2, x: 0, y: 0 },
  ];
  var STEP = [
    { time: 0, value: 0, curve: "stepped" },
    { time: 1, value: 5 },
  ];
  var TRA_STEP = [
    { time: 0, x: 0, y: 0, curve: "stepped" },
    { time: 1, x: 1, y: 1 },
  ];
  var CROSSED = [
    { time: 0, value: 0, curve: [0.9, 1, 0.2, 4] },
    { time: 1, value: 5 },
  ];
  var EXTRA = [
    { time: 0, value: 0, note: "keep", tag: 7 },
    { time: 1, value: 5, curve: [0.2, 1, 0.4, 2], keep: true },
    { time: 2, value: 9 },
  ];
  var PARTIAL = [{ time: 0 }, { time: 1, x: 2, y: 3 }];

  /* ------------------------------------------------------------------ */
  section("curve-edit / 模块与常量");
  eq("API_VERSION", C.API_VERSION, 1);
  deepEq("段类型", C.SEGMENT_TYPES.slice(), ["linear", "stepped", "bezier"]);
  ok("段类型冻结", Object.isFrozen(C.SEGMENT_TYPES));
  eq("BEZIER_SEGMENTS = 9（18 个采样数）", C.BEZIER_SEGMENTS, 9);
  eq("componentCount rotate", C.componentCount("rotate"), 1);
  eq("componentCount translate", C.componentCount("translate"), 2);
  eq("componentCount scale", C.componentCount("scale"), 2);
  eq("componentCount shear", C.componentCount("shear"), 2);
  eq("componentCount unknown", C.componentCount("nope"), 0);
  ["segmentInfo", "setSegmentType", "setControlPoints", "sampleSegment", "graphSamples", "valueAt", "handlesOf", "applyHandleDrag", "validateTrackKeys", "curveValues"].forEach(function (n) {
    eq("导出 " + n, typeof C[n], "function");
  });

  /* ------------------------------------------------------------------ */
  section("curve-edit / 上下文与分量推断");
  var sRot = C.segmentInfo({ time: 0 }, 0, { time: 1 }, { field: "rotate" });
  ok("无字段 key + field=rotate 可解析", sRot && sRot.ok === true);
  eq("rotate 缺值默认 0", sRot.value1, 0);
  var sScale = C.segmentInfo({ time: 0 }, 0, { time: 1, x: 2, y: 3 }, { field: "scale" });
  eq("scale 缺值默认 1（官方 readTimeline2 default=1）", sScale.value1, 1);
  eq("scale 下一 key 取值", sScale.value2, 2);
  var sTra = C.segmentInfo({ time: 0 }, 0, { time: 1, x: 2, y: 3 }, { field: "translate" });
  eq("translate 缺值默认 0", sTra.value1, 0);
  var sNoCtx = C.segmentInfo({ time: 0 }, 0, { time: 1 });
  ok("无 field 且无法推断 → UNKNOWN_COMPONENTS", sNoCtx.ok === false && sNoCtx.reason === "UNKNOWN_COMPONENTS");
  var sComp = C.segmentInfo({ time: 0 }, 0, { time: 1 }, { components: 2 });
  ok("显式 components=2 可解析", sComp && sComp.ok === true);
  near("translate x 分量读 x", C.segmentInfo(TRA[1], 0, TRA[2], { field: "translate" }).value1, 10);
  near("translate y 分量读 y", C.segmentInfo(TRA[1], 1, TRA[2], { field: "translate" }).value1, -10);
  var sIdx = C.segmentInfo(TRA[1], 2, TRA[2], { field: "translate" });
  ok("valueIndex 越界 → VALUE_INDEX", sIdx.ok === false && sIdx.reason === "VALUE_INDEX");
  var cvField = C.curveValues(TRA[1], { field: "translate" });
  eq("curveValues 支持 opts.field", cvField.ok && cvField.values.length, 2);

  /* ------------------------------------------------------------------ */
  section("curve-edit / curve 编码解析");
  var cvNone = C.curveValues({ time: 0, value: 1 });
  ok("缺 curve = linear", cvNone.ok && cvNone.type === "linear" && cvNone.hasCurveField === false);
  var cvStep = C.curveValues({ time: 0, value: 1, curve: "stepped" });
  ok("stepped 字符串", cvStep.ok && cvStep.type === "stepped");
  var cvBez = C.curveValues(ROT[1], 1);
  ok("数组 = bezier", cvBez.ok && cvBez.type === "bezier");
  deepEq("分量 0 的 4 个控制点", cvBez.values[0], [0.6, 3, 0.8, 7]);
  var cvTwo = C.curveValues(TRA[1], 2);
  deepEq("分量 1 偏移 = valueIndex<<2", cvTwo.values[1], [1.4, -4, 1.6, -8]);
  var cvShort = C.curveValues({ time: 0, value: 1, curve: [1, 2, 3] });
  ok("数组长度不足 → CURVE_LENGTH", cvShort.ok === false && cvShort.reason === "CURVE_LENGTH");
  var cvBadType = C.curveValues({ time: 0, value: 1, curve: "x" });
  ok("非 stepped/数组 → CURVE_TYPE", cvBadType.ok === false && cvBadType.reason === "CURVE_TYPE");
  var cvNaN = C.curveValues({ time: 0, value: 1, curve: [0.2, 1, NaN, 2] });
  ok("控制点 NaN → CURVE_NON_FINITE", cvNaN.ok === false && cvNaN.reason === "CURVE_NON_FINITE");
  var cvCross = C.curveValues(CROSSED[0], 1);
  ok("cx1>cx2 可解析且标 crossed", cvCross.ok && cvCross.crossed === true);
  var cvTwoShort = C.curveValues({ time: 0, x: 0, y: 0, curve: [1, 2, 3, 4] });
  ok("双分量需 8 个数", cvTwoShort.ok === false && cvTwoShort.reason === "CURVE_LENGTH");

  /* ------------------------------------------------------------------ */
  section("curve-edit / segmentInfo");
  var segLin = C.segmentInfo(ROT[0], 0, ROT[1], { field: "rotate" });
  ok("linear 段", segLin.ok && segLin.type === "linear");
  near("linear 段 v1", segLin.value1, 0);
  near("linear 段 v2", segLin.value2, 10);
  var segBez = C.segmentInfo(ROT[1], 0, ROT[2], { field: "rotate" });
  ok("bezier 段", segBez.ok && segBez.type === "bezier");
  deepEq("bezier 控制点", [segBez.cx1, segBez.cy1, segBez.cx2, segBez.cy2], [0.6, 3, 0.8, 7]);
  ok("bezier 段无 crossed", segBez.crossed === false);
  var segCrossed = C.segmentInfo(CROSSED[0], 0, CROSSED[1], { field: "rotate" });
  ok("交叉控制点标 crossed", segCrossed.crossed === true);
  var segStep = C.segmentInfo(STEP[0], 0, STEP[1], { field: "rotate" });
  ok("stepped 段", segStep.ok && segStep.type === "stepped");
  ok("单分量 stepped 不标共享", segStep.steppedShared === false);
  var segStep2 = C.segmentInfo(TRA_STEP[0], 0, TRA_STEP[1], { field: "translate" });
  ok("双分量 stepped 标 steppedShared", segStep2.steppedShared === true);
  eq("末 key（无 nextKey）→ null", C.segmentInfo(ROT[2], 0, null, { field: "rotate" }), null);
  ok("非法 key → INVALID_KEY", C.segmentInfo(null, 0, ROT[1], { field: "rotate" }).ok === false);
  ok("nextKey 非法 → INVALID_NEXT_KEY", C.segmentInfo(ROT[0], 0, 5, { field: "rotate" }).reason === "INVALID_NEXT_KEY");

  /* ------------------------------------------------------------------ */
  section("curve-edit / 采样（与 spine-core 逐位对照）");
  near("linear 中点", C.sampleSegment(ROT, 0, 0, 0.25, { field: "rotate" }).value, 5, 1e-9);
  near("linear 起点", C.sampleSegment(ROT, 0, 0, 0, { field: "rotate" }).value, 0, 1e-9);
  near("linear 终点", C.sampleSegment(ROT, 0, 0, 0.5, { field: "rotate" }).value, 10, 1e-9);
  near("stepped 取前值（段内）", C.sampleSegment(STEP, 0, 0, 0.9, { field: "rotate" }).value, 0, 1e-12);
  near("bezier 起点 = v1", C.sampleSegment(ROT, 1, 0, 0.5, { field: "rotate" }).value, 10, 1e-9);
  near("bezier 终点 = v2", C.sampleSegment(ROT, 1, 0, 1, { field: "rotate" }).value, 0, 1e-9);
  var bezMid = C.sampleSegment(ROT, 1, 0, 0.75, { field: "rotate" }).value;
  ok("bezier 中点有限", isFinite(bezMid));
  ok("bezier 中点落在两端之间", bezMid > 0 && bezMid < 10);
  ok("末 key 采样拒绝", C.sampleSegment(ROT, 2, 0, 1, { field: "rotate" }).ok === false);
  ok("非数组拒绝", C.sampleSegment(null, 0, 0, 0, { field: "rotate" }).reason === "KEYS_NOT_ARRAY");
  if (core && typeof core.sampleTrack === "function") {
    var maxDiff = 0;
    for (var si = 0; si <= 20; si++) {
      var st = 0.5 + (0.5 * si) / 20;
      var ours = C.sampleSegment(ROT, 1, 0, st, { field: "rotate" }).value;
      var theirs = core.sampleTrack(ROT, st, ["value"], [0])[0];
      maxDiff = Math.max(maxDiff, Math.abs(ours - theirs));
    }
    near("rotate bezier 21 点与 spine-core 逐位一致", maxDiff, 0, 1e-12);
    var maxTra = 0;
    for (var ti = 0; ti <= 20; ti++) {
      var tt = 1 + ti / 20;
      var ox = C.sampleSegment(TRA, 1, 0, tt, { field: "translate" }).value;
      var oy = C.sampleSegment(TRA, 1, 1, tt, { field: "translate" }).value;
      var th = core.sampleTrack(TRA, tt, ["x", "y"], [0, 0]);
      maxTra = Math.max(maxTra, Math.abs(ox - th[0]), Math.abs(oy - th[1]));
    }
    near("translate x/y bezier 21 点与 spine-core 逐位一致", maxTra, 0, 1e-12);
    near("scale 默认值参与采样（缺 x/y 时 1）", core.sampleTrack([{ time: 0 }, { time: 1, x: 2, y: 3 }], 0.5, ["x", "y"], [1, 1])[0], 1.5, 1e-6);
    result.notes.push({ name: "采样对照", detail: "curve-edit 与 spine-core 采样逐位一致（rotate 21 点 maxDiff=" + maxDiff + "，translate maxDiff=" + maxTra + "）" });
  } else {
    skip("采样与 spine-core 对照", "SpineCore 未加载");
  }

  /* ------------------------------------------------------------------ */
  section("curve-edit / valueAt 与 graphSamples");
  near("首 key 之前返回默认 0", C.valueAt(ROT, 0, -1, { field: "rotate" }).value, 0, 1e-12);
  var before = C.valueAt(ROT, 0, -1, { field: "rotate" });
  ok("首 key 之前标 before", before.before === true);
  near("段内求值", C.valueAt(ROT, 0, 0.25, { field: "rotate" }).value, 5, 1e-9);
  near("末 key 之后返回末值", C.valueAt(ROT, 0, 99, { field: "rotate" }).value, 0, 1e-12);
  ok("末 key 之后标 after", C.valueAt(ROT, 0, 99, { field: "rotate" }).after === true);
  near("stepped 整轨：末 key 前取前值", C.valueAt(STEP, 0, 0.999, { field: "rotate" }).value, 0, 1e-12);
  near("stepped 整轨：末 key 处取末值", C.valueAt(STEP, 0, 1, { field: "rotate" }).value, 5, 1e-12);
  near("scale 轨首 key 前默认 1", C.valueAt([{ time: 1, x: 2, y: 3 }], 0, 0, { field: "scale" }).value, 1, 1e-12);
  ok("空轨道拒绝", C.valueAt([], 0, 0, { field: "rotate" }).ok === false);
  var gs = C.graphSamples(ROT, 0, { samplesPerSegment: 4, field: "rotate" });
  ok("graphSamples ok", gs.ok === true);
  eq("段数 = key 数 - 1", gs.segments.length, 2);
  eq("每段 5 点（含端点）", gs.segments[0].points.length, 5);
  eq("去重后整轨点数 = 5 + 4", gs.points.length, 9);
  near("折线首点时间", gs.points[0].time, 0, 1e-9);
  near("折线末点时间", gs.points[gs.points.length - 1].time, 1, 1e-9);
  ok("每段带类型", gs.segments[0].type === "linear" && gs.segments[1].type === "bezier");
  var gsOne = C.graphSamples([{ time: 0.5, value: 7 }], 0, { field: "rotate" });
  ok("单 key 轨道无段但给点", gsOne.ok === true && gsOne.segments.length === 0 && gsOne.points.length === 1);
  near("单 key 点取该 key 值", gsOne.points[0].value, 7, 1e-9);
  ok("空轨道 graphSamples 拒绝", C.graphSamples([], 0, { field: "rotate" }).ok === false);

  /* ------------------------------------------------------------------ */
  section("curve-edit / setSegmentType");
  var rotSnap = snap(ROT);
  var linComp = C.setSegmentType(ROT, 1, 0, "linear", { field: "rotate" });
  ok("分量级 linear ok", linComp.ok === true);
  deepEq("linear 写共线控制点（不截短数组）", linComp.value[1].curve, [0.666667, 6.666667, 0.833333, 3.333333]);
  eq("linear 后数组长度仍 4", linComp.value[1].curve.length, 4);
  ok("linear 标 collinearized", linComp.collinearized === true);
  var linAll = C.setSegmentType(ROT, 1, 0, "linear", { field: "rotate", componentWide: true });
  ok("整段 linear 删除 curve 字段", linAll.ok && linAll.value[1].curve === undefined && linAll.componentWide === true);
  var bezOne = C.setSegmentType(ROT, 0, 0, "bezier", { field: "rotate" });
  ok("linear→bezier ok", bezOne.ok === true);
  deepEq("默认控制点 1/3、2/3", bezOne.value[0].curve, [0.166667, 3.333333, 0.333333, 6.666667]);
  ok("标 paddedComponents", bezOne.paddedComponents === true);
  var bezKeep = C.setSegmentType(ROT, 1, 0, "bezier", { field: "rotate" });
  deepEq("已是 bezier 时保留原控制点", bezKeep.value[1].curve, [0.6, 3, 0.8, 7]);
  ok("标 keptExisting", bezKeep.keptExisting === true);
  var traLinear = C.setSegmentType(TRA, 1, 0, "linear", { field: "translate" });
  deepEq("双分量：x 分量写共线", traLinear.value[1].curve.slice(0, 4), [1.333333, 6.666667, 1.666667, 3.333333]);
  deepEq("双分量：y 分量原文保留", traLinear.value[1].curve.slice(4), [1.4, -4, 1.6, -8]);
  near("双分量：x 分量写共线（cy1）", traLinear.value[1].curve[1], 6.666667, 1e-6);
  eq("双分量：数组长度不变（8）", traLinear.value[1].curve.length, 8);
  var stepNoWide = C.setSegmentType(TRA, 1, 0, "stepped", { field: "translate" });
  ok("stepped 遇其它分量 bezier → 需 componentWide", stepNoWide.ok === false && stepNoWide.reason === "STEPPED_REQUIRES_COMPONENT_WIDE");
  ok("给出 needsComponentWide", stepNoWide.needsComponentWide === true);
  var stepWide = C.setSegmentType(TRA, 1, 0, "stepped", { field: "translate", componentWide: true });
  ok("componentWide 整段 stepped ok", stepWide.ok && stepWide.value[1].curve === "stepped" && stepWide.componentWide === true);
  var bezOnStep = C.setSegmentType(TRA_STEP, 0, 0, "bezier", { field: "translate" });
  ok("stepped→bezier 需 componentWide", bezOnStep.ok === false && bezOnStep.reason === "STEPPED_SHARED_UNSUPPORTED");
  var bezOnStepWide = C.setSegmentType(TRA_STEP, 0, 0, "bezier", { field: "translate", componentWide: true });
  ok("componentWide 整段转 bezier ok", bezOnStepWide.ok && Array.isArray(bezOnStepWide.value[0].curve) && bezOnStepWide.value[0].curve.length === 8);
  var stepFromLinear = C.setSegmentType(ROT, 0, 0, "stepped", { field: "rotate" });
  ok("单分量 linear→stepped ok", stepFromLinear.ok && stepFromLinear.value[0].curve === "stepped");
  var linFromStep = C.setSegmentType(stepFromLinear.value, 0, 0, "linear", { field: "rotate" });
  ok("stepped→linear 单分量 ok", linFromStep.ok && linFromStep.value[0].curve === undefined);
  var lastKeyReject = C.setSegmentType(ROT, 2, 0, "linear", { field: "rotate" });
  ok("末 key 拒绝 LAST_KEY_NO_SEGMENT", lastKeyReject.ok === false && lastKeyReject.reason === "LAST_KEY_NO_SEGMENT");
  var badType = C.setSegmentType(ROT, 0, 0, "wobble", { field: "rotate" });
  ok("未知类型拒绝", badType.ok === false && badType.reason === "SEGMENT_TYPE");
  var unknownComp = C.setSegmentType([{ time: 0 }, { time: 1 }], 0, 0, "linear");
  ok("无法推断分量拒绝", unknownComp.ok === false && unknownComp.reason === "UNKNOWN_COMPONENTS");
  var unknownCompCtx = C.setSegmentType([{ time: 0 }, { time: 1 }], 0, 0, "linear", { components: 1 });
  ok("显式 components 可放行", unknownCompCtx.ok === true);
  var extraBez = C.setSegmentType(EXTRA, 0, 0, "bezier", { field: "rotate" });
  ok("未知字段 note/tag 原样保留", extraBez.value[0].note === "keep" && extraBez.value[0].tag === 7);
  ok("其它 key 未知字段保留", extraBez.value[1].keep === true);
  ok("setSegmentType 不改入参", snap(ROT) === rotSnap && snap(TRA) === snap(TRA));

  /* ------------------------------------------------------------------ */
  section("curve-edit / setControlPoints 与手柄");
  var traSnap = snap(TRA);
  var cp = C.setControlPoints(ROT, 0, 0, { cx1: 0.1, cy1: 1, cx2: 0.4, cy2: 9 }, { field: "rotate" });
  ok("setControlPoints ok", cp.ok === true);
  deepEq("写回 4 个控制点", cp.value[0].curve, [0.1, 1, 0.4, 9]);
  var cpRange = C.setControlPoints(ROT, 0, 0, { cx1: -1, cy1: 0, cx2: 0.4, cy2: 0 }, { field: "rotate" });
  ok("cx 越界拒绝", cpRange.ok === false && cpRange.reason === "CX_OUT_OF_RANGE");
  var cpOrder = C.setControlPoints(ROT, 0, 0, { cx1: 0.4, cy1: 0, cx2: 0.1, cy2: 0 }, { field: "rotate" });
  ok("cx1>cx2 拒绝（T16 裁定 3）", cpOrder.ok === false && cpOrder.reason === "CX_ORDER");
  var cpNaN = C.setControlPoints(ROT, 0, 0, { cx1: 0.1, cy1: Infinity, cx2: 0.4, cy2: 0 }, { field: "rotate" });
  ok("非有限拒绝", cpNaN.ok === false && cpNaN.reason === "POINTS_NON_FINITE");
  var cpF32a = C.setControlPoints(ROT, 0, 0, { cx1: 0.1, cy1: Number.MAX_VALUE, cx2: 0.4, cy2: 0 }, { field: "rotate" });
  ok("cy=MAX_VALUE 超出 float32 拒绝", cpF32a.ok === false && cpF32a.reason === "POINTS_NOT_F32");
  var cpF32b = C.setControlPoints(ROT, 0, 0, { cx1: 0.1, cy1: 1e39, cx2: 0.4, cy2: 0 }, { field: "rotate" });
  ok("cy=1e39 超出 float32 拒绝", cpF32b.ok === false && cpF32b.reason === "POINTS_NOT_F32");
  var cpF32c = C.setControlPoints(ROT, 0, 0, { cx1: 0.1, cy1: 3.4e38, cx2: 0.4, cy2: -3.4e38 }, { field: "rotate" });
  ok("f32 上界内仍接受（±3.4e38）", cpF32c.ok === true);
  var segF32 = C.setSegmentType([{ time: 0, value: 0 }, { time: 1, value: 1e39 }], 0, 0, "bezier", { field: "rotate" });
  ok("默认控制点超出 float32 拒绝", segF32.ok === false && segF32.reason === "CONTROL_POINTS_NOT_F32");
  var vF32 = C.validateTrackKeys([{ time: 0, value: 1e39 }, { time: 1, value: 1 }], 0, { field: "rotate" });
  ok("值超出 float32 报 error", vF32.ok === false && vF32.issues.some(function (i) { return i.code === "KEY_VALUE_NOT_F32"; }));
  ok(
    "导出 isF32Representable",
    typeof C.isF32Representable === "function" && C.isF32Representable(3.4e38) === true && C.isF32Representable(1e39) === false && C.isF32Representable(NaN) === false
  );
  ok("末 key 拒绝", C.setControlPoints(ROT, 2, 0, { cx1: 0.1, cy1: 0, cx2: 0.4, cy2: 0 }, { field: "rotate" }).reason === "LAST_KEY_NO_SEGMENT");
  var cpTra = C.setControlPoints(TRA, 1, 1, { cx1: 1.4, cy1: -5, cx2: 1.6, cy2: -9 }, { field: "translate" });
  deepEq("双分量只改目标分量（y）", cpTra.value[1].curve.slice(4), [1.4, -5, 1.6, -9]);
  deepEq("双分量 x 原样保留", cpTra.value[1].curve.slice(0, 4), [1.3, 3, 1.7, -3]);
  var cpPartial = C.setControlPoints(PARTIAL, 0, 0, { cx1: 0.2, cy1: 1, cx2: 0.6, cy2: 2 }, { field: "translate" });
  ok("缺 x/y 的 key 按 field 补数组", cpPartial.ok && cpPartial.value[0].curve.length === 8);
  deepEq("补出的 y 分量是共线（默认 0→3）", cpPartial.value[0].curve.slice(4), [0.333333, 1, 0.666667, 2]);
  ok("setControlPoints 不改入参", snap(ROT) === rotSnap && snap(TRA) === traSnap);
  var hLin = C.handlesOf(ROT, 0, 0, { field: "rotate" });
  ok("linear 段无手柄", hLin.ok && hLin.type === "linear" && hLin.c1 === null && hLin.c2 === null);
  var hBez = C.handlesOf(ROT, 1, 0, { field: "rotate" });
  deepEq("bezier 手柄 c1", [hBez.c1.time, hBez.c1.value], [0.6, 3]);
  deepEq("bezier 手柄 c2", [hBez.c2.time, hBez.c2.value], [0.8, 7]);
  ok("末 key 无手柄", C.handlesOf(ROT, 2, 0, { field: "rotate" }).ok === false);
  var dragC1 = C.applyHandleDrag(ROT, 1, 0, "c1", { time: 99, value: 999 }, { field: "rotate" });
  ok("c1 拖出右界被夹取", dragC1.ok && dragC1.value[1].curve[0] === 0.8);
  near("c1 cy 不限幅（写入 999）", dragC1.value[1].curve[1], 999, 1e-6);
  var dragC2 = C.applyHandleDrag(ROT, 1, 0, "c2", { time: -5, value: -999 }, { field: "rotate" });
  ok("c2 拖出左界被夹取到 cx1", dragC2.ok && dragC2.value[1].curve[2] === 0.6);
  near("c2 cy 不限幅（写入 -999）", dragC2.value[1].curve[3], -999, 1e-6);
  ok("linear 段拖柄拒绝 NOT_BEZIER", C.applyHandleDrag(ROT, 0, 0, "c1", { time: 0.1, value: 1 }, { field: "rotate" }).reason === "NOT_BEZIER");
  ok("非法手柄名拒绝", C.applyHandleDrag(ROT, 1, 0, "c3", { time: 0.6, value: 1 }, { field: "rotate" }).reason === "HANDLE_WHICH");
  ok("applyHandleDrag 不改入参", snap(ROT) === rotSnap);

  /* ------------------------------------------------------------------ */
  section("curve-edit / validateTrackKeys");
  var vClean = C.validateTrackKeys(ROT, 0, { field: "rotate" });
  ok("干净轨道 ok", vClean.ok === true && vClean.issues.length === 0);
  var vOrder = C.validateTrackKeys([{ time: 1, value: 0 }, { time: 0, value: 1 }], 0, { field: "rotate" });
  ok("乱序时间报 error", vOrder.ok === false && vOrder.issues.some(function (i) { return i.code === "KEY_OUT_OF_ORDER" && i.severity === "error"; }));
  var vDup = C.validateTrackKeys([{ time: 0, value: 0 }, { time: 0, value: 1 }], 0, { field: "rotate" });
  ok("重复时间报 error", vDup.ok === false && vDup.issues.some(function (i) { return i.code === "KEY_DUPLICATE_TIME"; }));
  var vLast = C.validateTrackKeys(ROT.concat([{ time: 2, value: 3, curve: [0.1, 0, 0.9, 1] }]), 0, { field: "rotate" });
  ok("末 key 带 curve 只 warn", vLast.ok === true && vLast.issues.some(function (i) { return i.code === "LAST_KEY_HAS_CURVE" && i.severity === "warn"; }));
  var vShort = C.validateTrackKeys([{ time: 0, value: 0, curve: [1, 2, 3] }, { time: 1, value: 1 }], 0, { field: "rotate" });
  ok("curve 长度错报 error", vShort.ok === false && vShort.issues.some(function (i) { return i.code === "CURVE_LENGTH"; }));
  var vNaN = C.validateTrackKeys([{ time: 0, value: NaN }, { time: 1, value: 1 }], 0, { field: "rotate" });
  ok("值 NaN 报 error", vNaN.ok === false && vNaN.issues.some(function (i) { return i.code === "KEY_VALUE_NON_FINITE"; }));
  var vCross = C.validateTrackKeys(CROSSED, 0, { field: "rotate" });
  ok("cx 交叉只 warn", vCross.ok === true && vCross.issues.some(function (i) { return i.code === "CX_CROSSED" && i.severity === "warn"; }));
  ok("非数组拒绝", C.validateTrackKeys(null, 0).ok === false);
  ok("空数组拒绝", C.validateTrackKeys([], 0).ok === false);
  var vUnknown = C.validateTrackKeys([{ time: 0 }, { time: 1 }], 0);
  ok("无法推断分量报 error", vUnknown.ok === false && vUnknown.issues.some(function (i) { return i.code === "UNKNOWN_COMPONENTS"; }));
  ok("带 field 上下文即通过", C.validateTrackKeys([{ time: 0 }, { time: 1 }], 0, { field: "scale" }).ok === true);

  /* ------------------------------------------------------------------ */
  section("curve-edit / 真实 spineboy curve 数据（Node）");
  var rawPath = nodeMods ? nodeMods.cwd.replace(/[\\/]+$/, "") + "/references/spine-rigs/spineboy-pro-42/spineboy-pro.json" : null;
  var realOk = false;
  if (!nodeMods) {
    skip("真实 spineboy curve 往返", "需要 Node + 仓库根 cwd");
  } else if (!nodeMods.fs.existsSync(rawPath)) {
    skip("真实 spineboy curve 往返", "未找到 spineboy-pro.json");
  } else {
    var raw = JSON.parse(nodeMods.fs.readFileSync(rawPath, "utf8"));
    var found = [];
    for (var an = 0; an < Object.keys(raw.animations).length; an++) {
      var animName = Object.keys(raw.animations)[an];
      var bones = raw.animations[animName].bones || {};
      for (var bn = 0; bn < Object.keys(bones).length; bn++) {
        var boneName = Object.keys(bones)[bn];
        for (var fi = 0; fi < 3; fi++) {
          var field = ["rotate", "translate", "scale"][fi];
          var keys = bones[boneName][field];
          if (!Array.isArray(keys) || !keys.length) continue;
          var hasCurve = keys.some(function (k) { return Array.isArray(k.curve) && k.curve.length; });
          if (!hasCurve) continue;
          if (found.some(function (f) { return f.anim === animName; })) continue;
          found.push({ anim: animName, bone: boneName, field: field, keys: keys });
        }
      }
    }
    ok("找到 ≥3 条真实 curve 轨道（来自不同动画）", found.length >= 3, "found=" + found.length);
    var worst = 0;
    var worstName = found.length ? found[0].anim + "/" + found[0].bone + "/" + found[0].field : null;
    for (var fi2 = 0; fi2 < Math.min(4, found.length); fi2++) {
      var t = found[fi2];
      var comps = C.componentCount(t.field);
      var localWorst = 0;
      for (var ki = 0; ki < t.keys.length - 1; ki++) {
        var seg = C.segmentInfo(t.keys[ki], 0, t.keys[ki + 1], { field: t.field });
        if (!seg || !seg.ok) {
          record(false, "真实段可解析 " + t.anim + "/" + t.bone + "/" + t.field + "#" + ki, "ok", seg && seg.reason);
          continue;
        }
        if (comps > 1) {
          var seg2 = C.segmentInfo(t.keys[ki], 1, t.keys[ki + 1], { field: t.field });
          if (!seg2 || !seg2.ok) record(false, "真实段 y 分量可解析", "ok", seg2 && seg2.reason);
        }
      }
      var cvv = C.validateTrackKeys(t.keys, 0, { field: t.field });
      ok("真实轨道校验通过（" + t.anim + "/" + t.field + "）", cvv.ok === true, JSON.stringify(cvv.issues.slice(0, 2)));
      /* 采样与 spine-core 逐位对照 */
      if (core && typeof core.sampleTrack === "function") {
        var fields = t.field === "rotate" ? ["value"] : ["x", "y"];
        var defs = t.field === "scale" ? [1, 1] : [0, 0];
        var maxD = 0;
        for (var ki2 = 0; ki2 < t.keys.length - 1; ki2++) {
          for (var s2 = 0; s2 <= 10; s2++) {
            var time2 = t.keys[ki2].time + ((t.keys[ki2 + 1].time - t.keys[ki2].time) * s2) / 10;
            var got = core.sampleTrack(t.keys, time2, fields, defs);
            for (var ci2 = 0; ci2 < comps; ci2++) {
              var mine = C.sampleSegment(t.keys, ki2, ci2, time2, { field: t.field });
              if (mine.ok) maxD = Math.max(maxD, Math.abs(mine.value - got[ci2]));
            }
          }
        }
        if (maxD > worst) {
          worst = maxD;
          worstName = t.anim + "/" + t.bone + "/" + t.field;
        }
      }
      /* 写回幂等：读出控制点再写回两次，结果一致 */
      var curveIdx = -1;
      for (var kj = 0; kj < t.keys.length; kj++) if (Array.isArray(t.keys[kj].curve) && t.keys[kj].curve.length) { curveIdx = kj; break; }
      if (curveIdx >= 0 && curveIdx < t.keys.length - 1) {
        var h = C.handlesOf(t.keys, curveIdx, 0, { field: t.field });
        var w1 = C.setControlPoints(t.keys, curveIdx, 0, { cx1: h.c1.time, cy1: h.c1.value, cx2: h.c2.time, cy2: h.c2.value }, { field: t.field });
        var w2 = C.setControlPoints(w1.value, curveIdx, 0, { cx1: h.c1.time, cy1: h.c1.value, cx2: h.c2.time, cy2: h.c2.value }, { field: t.field });
        ok("真实 curve 写回幂等（" + t.anim + "/" + t.field + "）", w1.ok && w2.ok && snap(w1.value) === snap(w2.value));
        ok("写回保留数组长度", w1.value[curveIdx].curve.length === t.keys[curveIdx].curve.length);
      }
      ok("真实轨道入参未被修改（" + t.anim + "/" + t.field + "）", snap(t.keys) === snap(found[fi2].keys));
    }
    realOk = true;
    result.notes.push({ name: "真实 curve 对照", detail: "4 条轨道逐段 11 点与 spine-core 采样对照 maxDiff=" + worst + "（" + worstName + "）" });
    near("真实 curve 采样与 spine-core 逐位一致", worst, 0, 1e-12);
  }
  void realOk;

  global.__selftestCurveEditResult = result;
  if (typeof window !== "undefined") window.__selftestCurveEditResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
