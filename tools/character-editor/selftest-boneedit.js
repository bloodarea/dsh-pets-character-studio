/*
 * selftest-boneedit.js —— bone-edit.js 的纯函数自检（Node / 浏览器共用）
 * 依赖：bone-edit.js（globalThis.SpineBoneEdit）
 * 输出：globalThis.__selftestBoneEditResult = {passed, failed, total, cases, failures}
 * 覆盖：矩阵 / 平移不变量（父级旋转、非均匀缩放、世界轴约束）/ 旋转（90°、跨 ±180、吸附、零半径）
 *       缩放（等比、单轴、零距离、世界单轴闸门）/ 附件 delta / gizmo 几何与命中 / 骨骼拾取
 *       世界↔屏幕换算 / World 旋转与单轴缩放的禁用闸门（父级非均匀缩放必须 ok:false）
 */
(function (global) {
  "use strict";

  var B = global.SpineBoneEdit;
  var result = {
    passed: 0,
    failed: 0,
    total: 0,
    cases: {},
    failures: [],
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
  function section(name) {
    currentCase = name;
  }

  if (!B) {
    record(false, "bone-edit.js 已加载", "SpineBoneEdit", null);
    global.__selftestBoneEditResult = result;
    return;
  }

  /* ==========================================================================
   * 测试用矩阵与工具
   * ====================================================================== */
  function rot(deg) {
    var r = (deg * Math.PI) / 180;
    return { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), tx: 0, ty: 0 };
  }
  function scaleMat(sx, sy) {
    return { a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 };
  }
  function composed(parent, local) {
    return B.mul(parent, local);
  }
  function worldDelta(parent, dx, dy) {
    return B.applyVec(parent, dx, dy);
  }
  function drag(startLocal, parent, dx, dy) {
    return B.translateFromDrag({
      startX: startLocal[0],
      startY: startLocal[1],
      startWorld: { x: 0, y: 0 },
      world: { x: dx, y: dy },
      parentWorld: parent,
      space: "parent",
      axis: null,
    });
  }

  /* 一组父级矩阵：单位 / 旋转 30° / 旋转 -75° / 非均匀缩放 / 旋转+非均匀 / 均匀缩放 */
  var PARENTS = {
    identity: B.identity(),
    rot30: composed(rot(30), B.identity()),
    rotNeg75: composed(rot(-75), B.identity()),
    nonuniform: scaleMat(2, 0.5),
    rotNonuniform: composed(rot(37), scaleMat(1.7, 0.6)),
    uniform: scaleMat(1.6, 1.6),
    translated: { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: -50 },
  };
  var PARENT_KEYS = ["identity", "rot30", "rotNeg75", "nonuniform", "rotNonuniform", "uniform", "translated"];

  /* ==========================================================================
   * 1. 矩阵
   * ====================================================================== */
  section("矩阵");
  (function () {
    var I = B.identity();
    eq("identity.a", I.a, 1);
    eq("identity.d", I.d, 1);
    eq("identity.tx", I.tx, 0);

    var m = B.mul(PARENTS.rot30, scaleMat(2, 3));
    near("mul 后线性列长 = scaleX*parentScale", Math.hypot(m.a, m.b), 2, 1e-9);
    near("mul 平移 (含 parent.tx)", m.tx, 0, 1e-9);

    var r = B.mul(rot(30), rot(-30));
    near("R(30)·R(-30) = I：a", r.a, 1, 1e-12);
    near("R(30)·R(-30) = I：b", r.b, 0, 1e-12);

    var inv = B.invert(PARENTS.rotNonuniform);
    ok("非均匀+旋转可逆", !!inv);
    var back = B.mul(PARENTS.rotNonuniform, inv);
    near("H·H⁻¹ = I：a", back.a, 1, 1e-9);
    near("H·H⁻¹ = I：d", back.d, 1, 1e-9);
    near("H·H⁻¹ = I：b", back.b, 0, 1e-9);
    near("H·H⁻¹ = I：tx", back.tx, 0, 1e-9);

    eq("退化矩阵不可逆", B.invert(scaleMat(0, 1)), null);
    eq("null 不可逆", B.invert(null), null);
    eq("非数字矩阵不可逆", B.invert({ a: 1, b: 0, c: 0, d: NaN, tx: 0, ty: 0 }), null);

    var pt = B.apply({ a: 2, b: 0, c: 0, d: 3, tx: 10, ty: 20 }, 1, 1);
    eq("apply.x", pt.x, 12);
    eq("apply.y", pt.y, 23);
    var vec = B.applyVec({ a: 2, b: 0, c: 0, d: 3, tx: 10, ty: 20 }, 1, 1);
    eq("applyVec.x（忽略平移）", vec.x, 2);
    eq("applyVec.y（忽略平移）", vec.y, 3);

    near("rotationOf(rot30)", B.rotationOf(rot(30)), 30, 1e-9);
    near("rotationOf(rot-170) 归一", B.rotationOf(rot(-170)), -170, 1e-9);
    near("rotationOf(均匀缩放不改变角)", B.rotationOf(scaleMat(3, 3)), 0, 1e-9);
    ok("rotationOf(非矩阵) = NaN", !isFinite(B.rotationOf(null)));

    near("wrap180(190) = -170", B.wrap180(190), -170, 1e-9);
    near("wrap180(-180) = 180", B.wrap180(-180), 180, 1e-9);
    near("wrap180(540) = 180", B.wrap180(540), 180, 1e-9);
    near("wrap180(-540) = 180", B.wrap180(-540), 180, 1e-9);

    var lin = B.linearFrom(90, 2, 3);
    near("linearFrom(90,2,3).a = 0", lin.a, 0, 1e-12);
    near("linearFrom(90,2,3).b = 2", lin.b, 2, 1e-12);
    near("linearFrom(90,2,3).c = -3", lin.c, -3, 1e-12);
  })();

  /* ==========================================================================
   * 2. 平移
   * ====================================================================== */
  section("平移");
  (function () {
    /* 不变量：世界增量由父级线性的局部增量生成时，反算必须精确回到同一局部坐标 */
    PARENT_KEYS.forEach(function (key) {
      var P = PARENTS[key];
      var start = [3, -2];
      var dl = [7.5, -4.25];
      var wd = worldDelta(P, dl[0], dl[1]);
      var got = drag(start, P, wd.x, wd.y);
      ok("平移反算成功 [" + key + "]", got.ok === true, JSON.stringify(got));
      near("平移不变量 x [" + key + "]", got.x, start[0] + dl[0], 1e-9);
      near("平移不变量 y [" + key + "]", got.y, start[1] + dl[1], 1e-9);
    });

    var noParent = B.translateFromDrag({
      startX: 0,
      startY: 0,
      startWorld: { x: 1, y: 2 },
      world: { x: 4, y: -3 },
      parentWorld: null,
      space: "parent",
    });
    eq("无父级：局部增量 = 世界增量 x", noParent.x, 3);
    eq("无父级：局部增量 = 世界增量 y", noParent.y, -5);

    /* 父级旋转 90°：世界 +X 对应父级局部 -Y */
    var rot90 = composed(rot(90), B.identity());
    var a = drag([0, 0], rot90, 10, 0);
    near("父级旋转 90°：world(+10,0) → local(0,-10) x", a.x, 0, 1e-9);
    near("父级旋转 90°：world(+10,0) → local(0,-10) y", a.y, -10, 1e-9);

    /* 轴约束（parent 空间）：只有世界 X 方向位移时，局部 Y 必须为 0 */
    var bx = B.translateFromDrag({
      startX: 5,
      startY: 5,
      startWorld: { x: 0, y: 0 },
      world: { x: 10, y: 3 },
      parentWorld: PARENTS.rot30,
      space: "parent",
      axis: "x",
    });
    ok("轴约束 x 成功", bx.ok === true);
    eq("轴约束 x：局部 y 不变", bx.y, 5);

    var by = B.translateFromDrag({
      startX: 5,
      startY: 5,
      startWorld: { x: 0, y: 0 },
      world: { x: 3, y: 10 },
      parentWorld: PARENTS.rot30,
      space: "parent",
      axis: "y",
    });
    eq("轴约束 y：局部 x 不变", by.x, 5);

    /* 轴约束（world 空间）：世界 X 约束下世界 Y 位移被砍掉 */
    var wx = B.translateFromDrag({
      startX: 0,
      startY: 0,
      startWorld: { x: 0, y: 0 },
      world: { x: 10, y: 10 },
      parentWorld: PARENTS.rot30,
      space: "world",
      axis: "x",
    });
    var expectWx = B.applyVec(B.invert(PARENTS.rot30), 10, 0);
    near("world 轴约束 x：等效于世界(+10,0)", wx.x, expectWx.x, 1e-9);
    near("world 轴约束 x：等效于世界(+10,0) y", wx.y, expectWx.y, 1e-9);

    var wy = B.translateFromDrag({
      startX: 0,
      startY: 0,
      startWorld: { x: 0, y: 0 },
      world: { x: 10, y: 10 },
      parentWorld: PARENTS.rot30,
      space: "world",
      axis: "y",
    });
    var expectWy = B.applyVec(B.invert(PARENTS.rot30), 0, 10);
    near("world 轴约束 y：等效于世界(0,+10)", wy.x, expectWy.x, 1e-9);

    /* 吸附：整单位取整 */
    var snap = B.translateFromDrag({
      startX: 0,
      startY: 0,
      startWorld: { x: 0, y: 0 },
      world: { x: 2.4, y: -3.6 },
      parentWorld: null,
      space: "parent",
      snapUnit: 1,
    });
    eq("吸附到 1 单位 x", snap.x, 2);
    eq("吸附到 1 单位 y", snap.y, -4);

    var snapHalf = B.translateFromDrag({
      startX: 0,
      startY: 0,
      startWorld: { x: 0, y: 0 },
      world: { x: 2.4, y: -3.6 },
      parentWorld: null,
      space: "parent",
      snapUnit: 0.5,
    });
    near("吸附到 0.5 单位 x", snapHalf.x, 2.5, 1e-12);
    near("吸附到 0.5 单位 y", snapHalf.y, -3.5, 1e-12);

    /* 失败路径 */
    var bad = B.translateFromDrag({ startX: NaN, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 1, y: 1 } });
    eq("startX 非法 → ok:false", bad.ok, false);
    eq("startX 非法 → reason", bad.reason, "START_INVALID");
    var badPoint = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: Infinity, y: 1 } });
    eq("world 非有限 → POINT_INVALID", badPoint.reason, "POINT_INVALID");
    var singular = B.translateFromDrag({
      startX: 0,
      startY: 0,
      startWorld: { x: 0, y: 0 },
      world: { x: 1, y: 1 },
      parentWorld: scaleMat(0, 1),
    });
    eq("父级退化 → PARENT_SINGULAR", singular.reason, "PARENT_SINGULAR");
    ok("失败结果不含 NaN 坐标", singular.x === undefined && singular.y === undefined);
  })();

  /* ==========================================================================
   * 3. 旋转
   * ====================================================================== */
  section("旋转");
  (function () {
    var pivot = { x: 0, y: 0 };
    var r90 = B.rotateFromDrag({
      startRotation: 0,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 0, y: 10 },
      parentWorld: null,
      space: "parent",
    });
    ok("旋转 90° 成功", r90.ok === true);
    near("旋转 90°：rotation", r90.rotation, 90, 1e-9);
    near("旋转 90°：deltaDeg", r90.deltaDeg, 90, 1e-9);

    var back = B.rotateFromDrag({
      startRotation: 90,
      pivotWorld: pivot,
      startWorld: { x: 0, y: 10 },
      world: { x: 10, y: 0 },
      parentWorld: null,
      space: "parent",
    });
    near("旋转回 0°", back.rotation, 0, 1e-9);

    /* 跨 ±180：从 170° 转到 -170°，最短路是 +20° */
    var wrapUp = B.rotateFromDrag({
      startRotation: 170,
      pivotWorld: pivot,
      startWorld: B.apply(rot(170), 10, 0),
      world: B.apply(rot(-170), 10, 0),
      parentWorld: null,
      space: "parent",
    });
    near("跨 ±180：结果保持多圈语义（170+20=190）", wrapUp.rotation, 190, 1e-6);
    near("跨 ±180：最短路 +20°", wrapUp.deltaDeg, 20, 1e-6);

    var wrapDown = B.rotateFromDrag({
      startRotation: -170,
      pivotWorld: pivot,
      startWorld: B.apply(rot(-170), 10, 0),
      world: B.apply(rot(170), 10, 0),
      parentWorld: null,
      space: "parent",
    });
    near("跨 ±180（反向）：最短路 -20°", wrapDown.deltaDeg, -20, 1e-6);
    near("跨 ±180（反向）：结果 -190（多圈语义）", wrapDown.rotation, -190, 1e-6);

    var full = B.rotateFromDrag({
      startRotation: 0,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: -10, y: 0 },
      parentWorld: null,
      space: "parent",
    });
    near("180° 不产生 NaN", full.rotation, 180, 1e-9);

    /* 父级旋转/非均匀缩放不改变角差（线性映射的角差性质） */
    ["rot30", "rotNonuniform", "nonuniform"].forEach(function (key) {
      var P = PARENTS[key];
      var s = B.apply(P, 10, 0);
      var w = B.apply(rot(90), 10, 0);
      var w2 = B.apply(P, w.x, w.y);
      var got = B.rotateFromDrag({
        startRotation: 20,
        pivotWorld: pivot,
        startWorld: s,
        world: w2,
        parentWorld: P,
        space: "parent",
      });
      near("父级 " + key + " 下旋转 90° 仍成立", got.rotation, 110, 1e-6);
    });

    var snap = B.rotateFromDrag({
      startRotation: 0,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 10 * Math.cos(0.21), y: 10 * Math.sin(0.21) },
      parentWorld: null,
      space: "parent",
      snapDeg: 15,
    });
    near("旋转吸附到 15°", snap.rotation, 15, 1e-6);

    var snapOff = B.rotateFromDrag({
      startRotation: 0,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 10 * Math.cos(0.21), y: 10 * Math.sin(0.21) },
      parentWorld: null,
      space: "parent",
      snapDeg: 0,
    });
    near("snapDeg=0 不吸附", snapOff.rotation, (0.21 * 180) / Math.PI, 1e-6);

    var zero = B.rotateFromDrag({
      startRotation: 0,
      pivotWorld: pivot,
      startWorld: { x: 0, y: 0 },
      world: { x: 10, y: 0 },
      parentWorld: null,
      space: "parent",
    });
    eq("起点在轴心 → RADIUS_ZERO", zero.reason, "RADIUS_ZERO");
    eq("起点在轴心 → ok:false", zero.ok, false);

    var zeroEnd = B.rotateFromDrag({
      startRotation: 0,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 0, y: 0 },
      parentWorld: null,
      space: "parent",
    });
    eq("终点在轴心 → RADIUS_ZERO", zeroEnd.reason, "RADIUS_ZERO");

    var badStart = B.rotateFromDrag({ startRotation: NaN, pivotWorld: pivot, startWorld: { x: 1, y: 0 }, world: { x: 0, y: 1 } });
    eq("startRotation 非法 → START_INVALID", badStart.reason, "START_INVALID");
    var badPivot = B.rotateFromDrag({ startRotation: 0, pivotWorld: null, startWorld: { x: 1, y: 0 }, world: { x: 0, y: 1 } });
    eq("pivot 缺失 → POINT_INVALID", badPivot.reason, "POINT_INVALID");

    /* 契约 §4.3：不把结果强制夹到 [-180,180]，保留多圈语义 */
    var multi = B.rotateFromDrag({
      startRotation: 350,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 10 * Math.cos(0.5), y: 10 * Math.sin(0.5) },
      parentWorld: null,
      space: "parent",
    });
    near("多圈：r0=350 + ~28.6° 不夹到 -180..180", multi.rotation, 350 + (0.5 * 180) / Math.PI, 1e-6);
    ok("多圈结果 > 180", multi.rotation > 180);
    ok("多圈结果 > 360（未被夹回单圈）", multi.rotation > 360);

    var multi2 = B.rotateFromDrag({
      startRotation: 720,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 0, y: 10 },
      parentWorld: null,
      space: "parent",
    });
    near("已有多圈旋转继续累加", multi2.rotation, 810, 1e-6);

    /* 契约 §4.3：World 旋转在反射父级下角差反号 */
    var reflectX = { a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 0 }; // det = -1
    var reflectRot = B.rotateFromDrag({
      startRotation: 0,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 0, y: 10 },
      parentWorld: reflectX,
      space: "world",
    });
    ok("反射父级下 World 旋转可用（相似变换）", reflectRot.ok === true, JSON.stringify(reflectRot));
    near("反射父级：世界 +90° → 骨 -90°", reflectRot.rotation, -90, 1e-6);

    var noReflect = B.rotateFromDrag({
      startRotation: 0,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 0, y: 10 },
      parentWorld: scaleMat(2, 2),
      space: "world",
    });
    near("等比无反射：世界 +90° → 骨 +90°", noReflect.rotation, 90, 1e-6);

    /* 契约 §4.3：H 非相似时 World 旋转必须 ok:false，且零写入（不返回 rotation） */
    var worldBlocked = B.rotateFromDrag({
      startRotation: 12,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 0, y: 10 },
      parentWorld: scaleMat(2, 0.5),
      space: "world",
    });
    eq("父级非均匀 → World 旋转 ok:false", worldBlocked.ok, false);
    eq("父级非均匀 → 错误码", worldBlocked.reason, "WORLD_ROTATE_UNSUPPORTED");
    ok("拒绝时给出可读原因", typeof worldBlocked.reasonText === "string" && worldBlocked.reasonText.length > 0);
    ok("拒绝时零写入（无 rotation 字段）", worldBlocked.rotation === undefined);
    var parentStillOk = B.rotateFromDrag({
      startRotation: 12,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 0, y: 10 },
      parentWorld: scaleMat(2, 0.5),
      space: "parent",
    });
    ok("同一父级下 Parent 旋转仍可用", parentStillOk.ok === true);
    near("同一父级下 Parent 旋转仍为 +90°", parentStillOk.rotation, 102, 1e-6);
  })();

  /* ==========================================================================
   * 4. 缩放
   * ====================================================================== */
  section("缩放");
  (function () {
    var pivot = { x: 0, y: 0 };
    var up = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 20, y: 0 },
      uniform: true,
    });
    ok("等比放大成功", up.ok === true);
    near("等比放大 factor=2", up.factor, 2, 1e-9);
    near("等比放大 scaleX", up.scaleX, 2, 1e-9);
    near("等比放大 scaleY", up.scaleY, 2, 1e-9);

    var down = B.scaleFromDrag({
      startScaleX: 2,
      startScaleY: 2,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 5, y: 0 },
      uniform: true,
    });
    near("等比缩小 scaleX = 1", down.scaleX, 1, 1e-9);

    var startLocal1 = { rotation: 0, scaleX: 1, scaleY: 1 };
    var axisX = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 30, y: 0 },
      axis: "x",
      boneWorld: B.identity(),
      startLocal: startLocal1,
    });
    near("单轴 x 缩放", axisX.scaleX, 3, 1e-9);
    near("单轴 x 缩放不改 y", axisX.scaleY, 1, 1e-9);

    var axisY = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 0, y: 10 },
      world: { x: 0, y: 25 },
      axis: "y",
      boneWorld: B.identity(),
      startLocal: startLocal1,
    });
    near("单轴 y 缩放", axisY.scaleY, 2.5, 1e-9);
    near("单轴 y 缩放不改 x", axisY.scaleX, 1, 1e-9);

    var snapStep = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 12.3, y: 0 },
      uniform: true,
      snapStep: 0.25,
    });
    near("缩放吸附到 0.25 步长", snapStep.factor, 1.25, 1e-9);

    var clampMin = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 0.001, y: 0 },
      uniform: true,
      minScale: 0.05,
    });
    near("低于下限被夹到 minScale", clampMin.scaleX, 0.05, 1e-9);

    var zeroStart = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 0, y: 0 },
      world: { x: 10, y: 0 },
    });
    eq("起点距离为 0 → START_DISTANCE_ZERO", zeroStart.reason, "START_DISTANCE_ZERO");
    eq("起点距离为 0 → ok:false", zeroStart.ok, false);

    var zeroEnd = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 0, y: 0 },
    });
    eq("终点距离为 0 → DISTANCE_INVALID", zeroEnd.reason, "DISTANCE_INVALID");

    var nanEnd = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: NaN, y: 0 },
    });
    eq("终点 NaN → POINT_INVALID", nanEnd.reason, "POINT_INVALID");

    var worldAxis = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 20, y: 0 },
      space: "world",
      axis: "x",
    });
    eq("world 单轴缩放必须显式拒绝", worldAxis.reason, "WORLD_AXIS_SCALE_UNSUPPORTED");

    var worldUniform = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 20, y: 0 },
      space: "world",
      uniform: true,
      axis: "x",
    });
    near("world 等比缩放可用", worldUniform.factor, 2, 1e-9);

    /* 契约 §4.4：单轴倍率取骨本地轴基上的分量比（不是半径比）。
       正交方向移动不得改变倍率。 */
    var startLocal0 = { rotation: 0, scaleX: 1, scaleY: 1 };
    var perp = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 10, y: 9 },
      axis: "x",
      boneWorld: B.identity(),
      startLocal: startLocal0,
    });
    ok("正交移动到轴外不改变本轴倍率", perp.ok === true);
    near("正交移动 fx = 1", perp.factor, 1, 1e-9);
    near("正交移动 scaleX 不变", perp.scaleX, 1, 1e-9);

    var along = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 20, y: -40 },
      axis: "x",
      boneWorld: B.identity(),
      startLocal: startLocal0,
    });
    near("沿本地 X 移动 2 倍 → fx = 2（忽略 Y 分量）", along.factor, 2, 1e-9);

    /* 骨自身旋转 90°：世界 X 方向对应骨本地 -Y 轴 → 轴基定位必须由 L0 参与 */
    var rotBone = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 30, y: 0 },
      axis: "y",
      boneWorld: B.identity(),
      startLocal: { rotation: 90, scaleX: 1, scaleY: 1 },
    });
    near("骨旋转 90°：世界 X 拖动命中本地 Y 轴 → fy = 3", rotBone.factor, 3, 1e-9);
    near("骨旋转 90°：scaleY = 3", rotBone.scaleY, 3, 1e-9);
    near("骨旋转 90°：scaleX 不变", rotBone.scaleX, 1, 1e-9);

    /* 父级非均匀缩放参与轴基：H=diag(2,0.5)，骨无旋转，沿世界 X 的本地量被放大 2 倍 */
    var parentAxis = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 30, y: 0 },
      axis: "x",
      boneWorld: scaleMat(2, 0.5),
      startLocal: startLocal0,
    });
    near("父级 diag(2,0.5)：h0=P⁻¹·v0=5、h=P⁻¹·v=15 → fx = 3（父级缩放只参与一次）", parentAxis.factor, 3, 1e-9);
    var parentAxisIdentity = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 30, y: 0 },
      axis: "x",
      boneWorld: B.identity(),
      startLocal: startLocal0,
    });
    near("对照：H=I 时同一起止点也是 fx = 3", parentAxisIdentity.factor, 3, 1e-9);

    var missingLocal = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 20, y: 0 },
      axis: "x",
      boneWorld: B.identity(),
    });
    eq("缺 startLocal → 轴缩放拒绝", missingLocal.reason, "START_LOCAL_MISSING");
    eq("缺 startLocal → ok:false", missingLocal.ok, false);
    ok("拒绝时零写入（无 scaleX）", missingLocal.scaleX === undefined);

    var zeroBase = B.scaleFromDrag({
      startScaleX: 1,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 0, y: 10 },
      world: { x: 0, y: 20 },
      axis: "x",
      boneWorld: B.identity(),
      startLocal: startLocal0,
    });
    eq("轴基分量为 0 → AXIS_BASE_ZERO", zeroBase.reason, "AXIS_BASE_ZERO");

    /* 契约 §4.4：原 scale = 0 的轴拒绝（不要把 0 当 1） */
    var zeroScale = B.scaleFromDrag({
      startScaleX: 0,
      startScaleY: 1,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 20, y: 0 },
      axis: "x",
      boneWorld: B.identity(),
      startLocal: { rotation: 0, scaleX: 0, scaleY: 1 },
    });
    eq("原 scaleX = 0 → AXIS_DEGENERATE", zeroScale.reason, "AXIS_DEGENERATE");

    var nearZero = B.scaleFromDrag({
      startScaleX: 0.001,
      startScaleY: 0.001,
      pivotWorld: pivot,
      startWorld: { x: 10, y: 0 },
      world: { x: 20, y: 0 },
      uniform: true,
    });
    near("等比近零被夹到 minScale", nearZero.scaleX, 0.01, 1e-9);
    ok("夹紧不下探到 0", nearZero.scaleX > 0);
  })();

  /* ==========================================================================
   * 5. 附件 delta
   * ====================================================================== */
  section("附件");
  (function () {
    var boneWorld = composed(rot(90), B.identity());
    var world = B.applyVec(boneWorld, 5, 5);
    var got = B.attachmentDelta({
      attachment: { x: 1, y: 2 },
      boneWorld: boneWorld,
      startWorld: { x: 0, y: 0 },
      world: world,
    });
    ok("附件 delta 成功", got.ok === true);
    near("附件 delta x（骨局部）", got.x, 6, 1e-9);
    near("附件 delta y（骨局部）", got.y, 7, 1e-9);

    var noMove = B.attachmentDelta({
      attachment: { x: 3, y: 4 },
      boneWorld: boneWorld,
      startWorld: { x: 10, y: 10 },
      world: { x: 10, y: 10 },
    });
    near("零位移不改附件", noMove.x, 3, 1e-9);
    near("零位移不改附件 y", noMove.y, 4, 1e-9);

    var badAtt = B.attachmentDelta({ attachment: null, boneWorld: boneWorld, startWorld: { x: 0, y: 0 }, world: { x: 1, y: 1 } });
    eq("附件缺失 → ATTACHMENT_INVALID", badAtt.reason, "ATTACHMENT_INVALID");

    var axisAtt = B.attachmentDelta({
      attachment: { x: 0, y: 0 },
      boneWorld: B.identity(),
      startWorld: { x: 0, y: 0 },
      world: { x: 7, y: 9 },
      axis: "x",
    });
    eq("附件轴约束 y 不变", axisAtt.y, 0);

    var singularBone = B.attachmentDelta({
      attachment: { x: 0, y: 0 },
      boneWorld: scaleMat(0, 0),
      startWorld: { x: 0, y: 0 },
      world: { x: 1, y: 1 },
    });
    eq("骨矩阵退化 → PARENT_SINGULAR", singularBone.reason, "PARENT_SINGULAR");
  })();

  /* ==========================================================================
   * 6. gizmo 几何与命中
   * ====================================================================== */
  section("gizmo");
  (function () {
    var g = B.gizmoGeometry({ pivotScreen: { x: 100, y: 200 }, angleRad: 0, zoom: 1, sizeCss: 46 });
    eq("center.x", g.center.x, 100);
    eq("center.y", g.center.y, 200);
    near("axisX.x", g.axisX.x, 146, 1e-9);
    near("axisX.y", g.axisX.y, 200, 1e-9);
    near("axisY.x", g.axisY.x, 100, 1e-9);
    near("axisY.y", g.axisY.y, 246, 1e-9);
    near("ringRadius = 0.62 * 46", g.ringRadius, 28.52, 1e-9);
    near("scaleHandle 沿 X 轴（契约 §4.4：柄沿操作轴绘制） x", g.scaleHandle.x, 100 + 46 * 0.82, 1e-9);
    near("scaleHandle 沿 X 轴 y", g.scaleHandle.y, 200, 1e-9);
    near("scaleHandleY 沿 Y 轴 x", g.scaleHandleY.x, 100, 1e-9);
    near("scaleHandleY 沿 Y 轴 y", g.scaleHandleY.y, 200 + 46 * 0.82, 1e-9);

    /* 双轴角度分开给：X 朝右(0)、Y 朝下(π/2) 的显式轴基 */
    var gAxes = B.gizmoGeometry({ pivotScreen: { x: 0, y: 0 }, axisXAngleRad: 0, axisYAngleRad: Math.PI / 2, zoom: 1, sizeCss: 46 });
    near("显式轴 X.x", gAxes.axisX.x, 46, 1e-9);
    near("显式轴 X.y", gAxes.axisX.y, 0, 1e-9);
    near("显式轴 Y.x", gAxes.axisY.x, 0, 1e-9);
    near("显式轴 Y.y", gAxes.axisY.y, 46, 1e-9);

    /* 父级旋转 90° 的轴基：X 轴朝上（屏幕角 -π/2），不得画到 -X 一侧 */
    var gParent = B.gizmoGeometry({ pivotScreen: { x: 0, y: 0 }, axisXAngleRad: B.axisAngleOf(0, 1), axisYAngleRad: B.axisAngleOf(-1, 0), zoom: 1, sizeCss: 46 });
    near("父级 90°：X 轴朝上 y", gParent.axisX.y, -46, 1e-9);
    near("父级 90°：X 轴不偏到左右 x", gParent.axisX.x, 0, 1e-9);
    near("父级 90°：Y 轴朝左 x", gParent.axisY.x, -46, 1e-9);
    ok("父级 90°：X 柄在正方向（y<0，不是 +X 一侧）", gParent.axisX.y < 0);

    var g2 = B.gizmoGeometry({ pivotScreen: { x: 0, y: 0 }, angleRad: 0, zoom: 2, sizeCss: 46 });
    near("zoom=2 手柄长度翻倍", g2.axisX.x, 92, 1e-9);

    var g90 = B.gizmoGeometry({ pivotScreen: { x: 0, y: 0 }, angleRad: Math.PI / 2, zoom: 1, sizeCss: 46 });
    near("屏幕角 90°：axisX 朝下 x", g90.axisX.x, 0, 1e-9);
    near("屏幕角 90°：axisX 朝下 y", g90.axisX.y, 46, 1e-9);
    near("屏幕角 90°：axisY 朝左 x", g90.axisY.x, -46, 1e-9);

    var gDefault = B.gizmoGeometry({ pivotScreen: { x: 0, y: 0 } });
    near("默认尺寸 46", gDefault.axisX.x, 46, 1e-9);
    var gBadZoom = B.gizmoGeometry({ pivotScreen: { x: 0, y: 0 }, zoom: 0 });
    near("zoom=0 回落为 1", gBadZoom.axisX.x, 46, 1e-9);

    var hit = B.hitGizmo({ point: { x: 100, y: 200 }, geometry: g, tolerancePx: 7, tool: "translate" });
    eq("命中中心", hit, "center");
    eq("命中 X 轴", B.hitGizmo({ point: { x: 132, y: 202 }, geometry: g, tool: "translate" }), "x");
    eq("命中 Y 轴", B.hitGizmo({ point: { x: 98, y: 232 }, geometry: g, tool: "translate" }), "y");
    eq("轴外返回 null", B.hitGizmo({ point: { x: 60, y: 60 }, geometry: g, tool: "translate" }), null);
    /* 128.5 = 100 + ringRadius(28.52)：这一点**同时**落在旋转环与 X 轴上，是几何交集。
       translate 工具此时返回 'x'（轴优先），rotate 工具返回 'rotate' —— 由 tool 分流，不靠容差硬凑。 */
    eq("环与 X 轴的交点：translate 取 X 轴", B.hitGizmo({ point: { x: 128.5, y: 200 }, geometry: g, tolerancePx: 3, tool: "translate" }), "x");
    eq("translate 工具不把环当命中（环上非轴点）", B.hitGizmo({ point: { x: 120.15, y: 220.15 }, geometry: g, tolerancePx: 3, tool: "translate" }), null);
    eq("rotate 工具命中旋转环", B.hitGizmo({ point: { x: 128.5, y: 200 }, geometry: g, tolerancePx: 3, tool: "rotate" }), "rotate");
    eq("rotate 工具轴外不命中", B.hitGizmo({ point: { x: 146, y: 200 }, geometry: g, tolerancePx: 3, tool: "rotate" }), null);
    eq("scale 工具命中 X 手柄", B.hitGizmo({ point: { x: 137.72, y: 200 }, geometry: g, tool: "scale" }), "scale");
    eq("scale 工具命中 Y 手柄", B.hitGizmo({ point: { x: 100, y: 237.72 }, geometry: g, tool: "scale" }), "scale");
    eq("scale 工具远离返回 null", B.hitGizmo({ point: { x: 300, y: 300 }, geometry: g, tool: "scale" }), null);
    eq("中心优先于轴", B.hitGizmo({ point: { x: 101, y: 201 }, geometry: g, tool: "translate" }), "center");
    eq("点在几何外 → null", B.hitGizmo({ point: { x: 1000, y: 1000 }, geometry: g, tool: "translate" }), null);
    eq("非法点 → null", B.hitGizmo({ point: { x: NaN, y: 0 }, geometry: g }), null);
    eq("缺失 geometry → null", B.hitGizmo({ point: { x: 0, y: 0 }, geometry: null }), null);
    eq("非法 tool 回落 translate", B.hitGizmo({ point: { x: 132, y: 200 }, geometry: g, tool: "bogus" }), "x");
  })();

  /* ==========================================================================
   * 7. 骨骼拾取
   * ====================================================================== */
  section("骨骼拾取");
  (function () {
    /* 根在 (0,0)；A 在 (100,0) 父=根；B 在 (100,100) 父=A */
    var bones = [
      { index: 0, world: { tx: 0, ty: 0 }, screen: { x: 0, y: 0 }, parentIndex: -1 },
      { index: 1, world: { tx: 100, ty: 0 }, screen: { x: 100, y: 0 }, parentIndex: 0 },
      { index: 2, world: { tx: 100, ty: 100 }, screen: { x: 100, y: 100 }, parentIndex: 1 },
    ];
    var hitA = B.boneHitTest({ bones: bones, point: { x: 101, y: 1 }, jointTolPx: 8, lineTolPx: 5 });
    ok("命中关节 A", !!hitA);
    eq("命中关节 A 的 index", hitA.index, 1);
    eq("命中的是 joint 层", hitA.part, "joint");
    ok("距离有值且非 NaN", isFinite(hitA.distance));

    var hitRoot = B.boneHitTest({ bones: bones, point: { x: -2, y: 2 }, jointTolPx: 8, lineTolPx: 5 });
    eq("命中根关节", hitRoot.index, 0);

    /* joint 优先：点更靠近线段 A-B 的起点，但仍在 A 的 jointTol 内 → 取 A 的 joint */
    var jointWins = B.boneHitTest({ bones: bones, point: { x: 103, y: 3 }, jointTolPx: 8, lineTolPx: 12 });
    eq("joint 优先于 line", jointWins.part, "joint");
    eq("joint 优先取最近关节", jointWins.index, 1);

    /* 线段层：离关节都远，但贴着根→A 的连线 */
    var line = B.boneHitTest({ bones: bones, point: { x: 50, y: 3 }, jointTolPx: 8, lineTolPx: 5 });
    ok("命中线段", !!line);
    eq("线段层 index = 子骨 A", line.index, 1);
    eq("线段层 part", line.part, "line");
    near("线段距离", line.distance, 3, 1e-9);

    var lineB = B.boneHitTest({ bones: bones, point: { x: 103, y: 50 }, jointTolPx: 8, lineTolPx: 5 });
    eq("命中 A→B 垂直线段", lineB.index, 2);

    var miss = B.boneHitTest({ bones: bones, point: { x: 500, y: 500 }, jointTolPx: 8, lineTolPx: 5 });
    eq("超距返回 null", miss, null);

    /* 退化骨（零长）不应产生 NaN 或异常 */
    var degenerate = B.boneHitTest({
      bones: [
        { index: 0, screen: { x: 10, y: 10 }, parentIndex: -1 },
        { index: 1, screen: { x: 10, y: 10 }, parentIndex: 0 },
      ],
      point: { x: 10, y: 10 },
      jointTolPx: 4,
      lineTolPx: 4,
    });
    ok("退化骨命中关节且无 NaN", !!degenerate && isFinite(degenerate.distance));

    var noScreen = B.boneHitTest({
      bones: [{ index: 0, world: { tx: NaN, ty: NaN }, parentIndex: -1 }],
      point: { x: 0, y: 0 },
    });
    eq("无有效坐标的骨被跳过", noScreen, null);

    var badPoint = B.boneHitTest({ bones: bones, point: { x: NaN, y: 0 } });
    eq("非法点 → null", badPoint, null);

    var noBones = B.boneHitTest({ bones: [], point: { x: 0, y: 0 } });
    eq("空骨表 → null", noBones, null);

    /* 没有 screen 时回落 world 坐标（集成方可能只传 world） */
    var worldOnly = B.boneHitTest({
      bones: [
        { index: 0, world: { tx: 0, ty: 0 }, parentIndex: -1 },
        { index: 1, world: { tx: 20, ty: 0 }, parentIndex: 0 },
      ],
      point: { x: 20, y: 1 },
      jointTolPx: 3,
      lineTolPx: 3,
    });
    eq("world 回落作为屏幕坐标", worldOnly.index, 1);
  })();

  /* ==========================================================================
   * 8. 世界↔屏幕
   * ====================================================================== */
  section("世界↔屏幕");
  (function () {
    var s = B.worldToScreen({ x: 10, y: 20, zoom: 2, tx: 100, ty: 200 });
    eq("worldToScreen.x", s.x, 120);
    eq("worldToScreen.y（Y 翻转）", s.y, 160);
    var w = B.screenToWorld({ x: s.x, y: s.y, zoom: 2, tx: 100, ty: 200 });
    near("往返 x", w.x, 10, 1e-9);
    near("往返 y", w.y, 20, 1e-9);

    [0.62, 1, 2].forEach(function (z) {
      var p = B.worldToScreen({ x: 123.5, y: -45.25, zoom: z, tx: 7, ty: -3 });
      var q = B.screenToWorld({ x: p.x, y: p.y, zoom: z, tx: 7, ty: -3 });
      near("缩放 " + z + " 下往返 x", q.x, 123.5, 1e-9);
      near("缩放 " + z + " 下往返 y", q.y, -45.25, 1e-9);
    });

    var ang = B.screenAngleOf(B.identity(), 1);
    near("单位世界矩阵屏幕角 = 0（局部 +X 朝屏幕右）", ang, 0, 1e-12);
    var ang90 = B.screenAngleOf(B.linearFrom(90, 1, 1), 1);
    near("世界 rot(90)：局部 +X 指向世界 +Y → 屏幕朝上 = -π/2（修复：此前误为 +π/2）", ang90, -Math.PI / 2, 1e-9);
    var angRot = B.screenAngleOf(composed(rot(30), B.identity()), 1);
    near("世界 30° → 屏幕 -30°", angRot, (-30 * Math.PI) / 180, 1e-9);
    near("axisAngleOf 世界(1,0) → 0", B.axisAngleOf(1, 0), 0, 1e-12);
    near("axisAngleOf 世界(0,1) → -π/2（朝上）", B.axisAngleOf(0, 1), -Math.PI / 2, 1e-12);
    near("axisAngleOf 世界(-1,0) → π（朝左）", B.axisAngleOf(-1, 0), Math.PI, 1e-12);
  })();

  /* ==========================================================================
   * 9. World 旋转 / 单轴缩放闸门
   * ====================================================================== */
  section("World 闸门");
  (function () {
    eq("无父级可 World 旋转", B.canWorldRotate(null).ok, true);
    eq("单位父级可 World 旋转", B.canWorldRotate(B.identity()).ok, true);
    eq("父级纯旋转可 World 旋转", B.canWorldRotate(rot(33)).ok, true);
    eq("父级等比缩大可 World 旋转", B.canWorldRotate(scaleMat(2.5, 2.5)).ok, true);
    eq("父级等比+旋转可 World 旋转", B.canWorldRotate(composed(rot(40), scaleMat(1.4, 1.4))).ok, true);
    eq("父级仅平移可 World 旋转", B.canWorldRotate(PARENTS.translated).ok, true);

    var bad = B.canWorldRotate(scaleMat(2, 0.5));
    eq("父级非均匀缩放 → 拒绝", bad.ok, false);
    eq("父级非均匀缩放 → 错误码", bad.code, "WORLD_ROTATE_UNSUPPORTED");
    ok("拒绝时给出可读原因", typeof bad.reason === "string" && bad.reason.indexOf("斜切") >= 0);
    ok("拒绝时报告比例", isFinite(bad.ratio) && bad.ratio > 3.9);

    eq("父级旋转+非均匀 → 拒绝", B.canWorldRotate(PARENTS.rotNonuniform).ok, false);
    var singular = B.canWorldRotate(scaleMat(0, 1));
    eq("父级退化 → 拒绝", singular.ok, false);

    var sim = B.parentSimilarity(scaleMat(3, 3));
    eq("parentSimilarity 等比 → similar", sim.similar, true);
    var sim2 = B.parentSimilarity(scaleMat(3, 1));
    eq("parentSimilarity 非等比 → not similar", sim2.similar, false);
    ok("parentSimilarity 给出 ortho/ratio", isFinite(sim2.ortho) && isFinite(sim2.ratio));

    eq("轴对齐父级可 World 单轴缩放(x)", B.canWorldAxisScale(B.identity(), "x").ok, true);
    eq("缩放父级可 World 单轴缩放(y)", B.canWorldAxisScale(scaleMat(2, 0.5), "y").ok, true);
    var axisBad = B.canWorldAxisScale(rot(20), "x");
    eq("父级带旋转 → World 单轴缩放拒绝", axisBad.ok, false);
    eq("父级带旋转 → 错误码", axisBad.code, "WORLD_AXIS_SCALE_UNSUPPORTED");
    eq("父级带剪切 → 拒绝", B.canWorldAxisScale({ a: 1, b: 0, c: 0.4, d: 1, tx: 0, ty: 0 }, "y").ok, false);

    eq("可逆父级可 World 等比缩放", B.canWorldUniformScale(PARENTS.rotNonuniform).ok, true);
    eq("退化父级不可 World 等比缩放", B.canWorldUniformScale(scaleMat(0, 2)).ok, false);

    /* 真实 rig 场景：idle 的 hips 是 scale 轨道，0.125s 已非均匀（1.002225 / 1.003115）
       → 其子骨（spine/chest/head/tail-1…）在 World 旋转下必须被拒绝；父级无旋转时单轴缩放仍可解。 */
    var hipsAtIdle = composed(rot(0), scaleMat(1.002225, 1.003115));
    eq("真实 rig idle@0.125s 的 hips：World 旋转被拒绝", B.canWorldRotate(hipsAtIdle).ok, false);
    eq("真实 rig idle@0.125s 的 hips：World 单轴缩放仍可解", B.canWorldAxisScale(hipsAtIdle, "x").ok, true);
    var hipsAt0 = composed(rot(0), scaleMat(1, 1));
    eq("idle@0s 的 hips 是等比：World 旋转可用", B.canWorldRotate(hipsAt0).ok, true);
  })();

  /* ==========================================================================
   * 10. 契约别名与默认容差
   * ====================================================================== */
  section("契约别名");
  (function () {
    eq("PARENT_SINGULAR → EDIT_PARENT_SINGULAR", B.editCode("PARENT_SINGULAR"), "EDIT_PARENT_SINGULAR");
    eq("WORLD_ROTATE_UNSUPPORTED 别名", B.editCode("WORLD_ROTATE_UNSUPPORTED"), "EDIT_WORLD_ROTATE_UNSUPPORTED");
    eq("WORLD_AXIS_SCALE_UNSUPPORTED 别名", B.editCode("WORLD_AXIS_SCALE_UNSUPPORTED"), "EDIT_WORLD_AXIS_SCALE_UNSUPPORTED");
    eq("AXIS_DEGENERATE → EDIT_AFFINE_UNREPRESENTABLE", B.editCode("AXIS_DEGENERATE"), "EDIT_AFFINE_UNREPRESENTABLE");
    eq("AXIS_BASE_ZERO → EDIT_AFFINE_UNREPRESENTABLE", B.editCode("AXIS_BASE_ZERO"), "EDIT_AFFINE_UNREPRESENTABLE");
    eq("START_DISTANCE_ZERO → EDIT_SCALE_DEGENERATE", B.editCode("START_DISTANCE_ZERO"), "EDIT_SCALE_DEGENERATE");
    eq("未知码原样返回", B.editCode("SOMETHING_ELSE"), "SOMETHING_ELSE");
    ok("EDIT_CODES 已导出", !!B.EDIT_CODES && typeof B.EDIT_CODES === "object");
    eq("拾取半径在契约 9~12px 区间内", B.DEFAULT_HIT_TOL >= 9 && B.DEFAULT_HIT_TOL <= 12, true);
    eq("关节容差在契约 9~12px 区间内", B.DEFAULT_JOINT_TOL >= 9 && B.DEFAULT_JOINT_TOL <= 12, true);
    ok("线段容差小于关节容差", B.DEFAULT_LINE_TOL < B.DEFAULT_JOINT_TOL);

    /* 默认容差是屏幕常量：不随 zoom 变化（契约「缩放画布不改变可点击尺寸」） */
    var g = B.gizmoGeometry({ pivotScreen: { x: 100, y: 200 }, angleRad: 0, zoom: 1 });
    var gZoomed = B.gizmoGeometry({ pivotScreen: { x: 100, y: 200 }, angleRad: 0, zoom: 2 });
    eq("默认容差命中（zoom=1）", B.hitGizmo({ point: { x: 132, y: 202 }, geometry: g }), "x");
    eq("同一屏幕点（zoom=2）仍按屏幕常量命中 Y 轴", B.hitGizmo({ point: { x: 96, y: 228 }, geometry: gZoomed }), "y");
    eq("gizmo 长度随 zoom 变化", Math.round(gZoomed.axisX.x - 100), 92);
    eq("屏幕常量下距中心 12px 仍落在 X 轴", B.hitGizmo({ point: { x: 112, y: 200 }, geometry: g }), "x");

    var bones = [
      { index: 0, screen: { x: 0, y: 0 }, parentIndex: -1 },
      { index: 1, screen: { x: 100, y: 0 }, parentIndex: 0 },
    ];
    eq("默认关节容差 10px 内可命中", B.boneHitTest({ bones: bones, point: { x: 109, y: 0 } }).index, 1);
    eq("默认关节容差之外不命中关节", B.boneHitTest({ bones: bones, point: { x: 112, y: 0 }, lineTolPx: 1 }), null);
  })();

  section("P1·Local 平移");
  (function () {
    var R90 = rot(90);
    var L0id = { rotation: 0, scaleX: 1, scaleY: 1 };
    /* 父级旋转 90°、骨无自身旋转：W = H·L0 = rot90 */
    var W90 = composed(R90, B.localLinear(L0id));
    near("H=rot90：W.colX = (0,1)", W90.a, 0, 1e-12);
    near("H=rot90：W.colY = (-1,0)", W90.c, -1, 1e-12);

    var free = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 0, y: 10 }, parentWorld: R90, space: "local", startLocal: L0id, axis: null });
    ok("Local free ok", free.ok === true);
    near("Local free：世界 +Y → 父级 x +10", free.x, 10, 1e-9);
    near("Local free：y 不变", free.y, 0, 1e-9);
    eq("Local free 与 parent 逐位一致（x）", free.x, B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 0, y: 10 }, parentWorld: R90, space: "parent" }).x);

    var ax = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 10, y: 10 }, parentWorld: R90, space: "local", startLocal: L0id, axis: "x" });
    ok("Local 轴 X：ok", ax.ok === true);
    near("Local 轴 X：沿骨 +X（世界 +Y）→ 父级 x = 10", ax.x, 10, 1e-9);
    near("Local 轴 X：父级 y = 0", ax.y, 0, 1e-9);
    var ay = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 10, y: 10 }, parentWorld: R90, space: "local", startLocal: L0id, axis: "y" });
    /* 拖拽在骨局部 Y 上的分量是 -10 → 沿 -骨Y 走；A⁻¹W = I ⇒ 父级 (0,-10) */
    near("Local 轴 Y：父级 x = 0", ay.x, 0, 1e-9);
    near("Local 轴 Y：父级 y = -10（取拖拽的骨 Y 分量）", ay.y, -10, 1e-9);
    var mvY0 = B.applyVec(R90, ay.x, ay.y);
    near("不变量：局部 Y 拖拽的世界位移平行骨 +Y（叉积 0）", mvY0.x * W90.d - mvY0.y * W90.c, 0, 1e-9);

    /* 不变量：Local 轴约束下，世界位移必须平行于 W.colX */
    var mvX = B.applyVec(R90, ax.x, ax.y);
    /* cross(v, colX) = v.x*W.b - v.y*W.a */
    near("不变量：Local 轴 X 世界位移平行骨 +X（叉积 0）", mvX.x * W90.b - mvX.y * W90.a, 0, 1e-9);
    /* 世界位移用 A（真实父级世界线性）作用在存储的父级增量上 */

    /* 非均匀 + 骨自身旋转/缩放：Local free 必须与 parent 逐位一致 */
    var Hnu = composed(rot(20), scaleMat(2, 0.5));
    var L0nu = { rotation: 35, scaleX: 1.3, scaleY: 0.8 };
    var Wnu = composed(Hnu, B.localLinear(L0nu));
    var f1 = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 3, y: -7 }, parentWorld: Hnu, space: "local", startLocal: L0nu });
    var p1 = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 3, y: -7 }, parentWorld: Hnu, space: "parent" });
    near("非均匀父级 Local free（x） == parent", f1.x, p1.x, 1e-9);
    near("非均匀父级 Local free（y） == parent", f1.y, p1.y, 1e-9);
    var axNu = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 3, y: -7 }, parentWorld: Hnu, space: "local", startLocal: L0nu, axis: "x" });
    /* 世界位移 = A · Δparent（A = Hnu = 真实父级） */
    var mvNu = B.applyVec(Hnu, axNu.x, axNu.y);
    near("非均匀：Local 轴 X 世界位移平行 W.colX", mvNu.x * Wnu.b - mvNu.y * Wnu.a, 0, 1e-9);
    ok("非均匀：Local 轴 X 与 free 不同（确实做了约束）", Math.abs(axNu.y - f1.y) > 1e-9);

    /* 反射父级：仍可精确 */
    var Hmir = scaleMat(-1, 1);
    var axMir = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 4, y: 4 }, parentWorld: Hmir, space: "local", startLocal: L0id, axis: "x" });
    ok("反射父级 Local 轴 X：ok", axMir.ok === true);
    near("反射父级：父级 x = -4（镜像）", axMir.x, -4, 1e-9);
    near("反射父级：父级 y = 0", axMir.y, 0, 1e-9);

    /* onlyTranslation：H=I ⇒ Local 轴基 = L0（不带父级旋转） */
    var L0sh = { rotation: 0, scaleX: 1, scaleY: 1, shearX: 30 };
    var otFree = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 5, y: 0 }, parentWorld: R90, inherit: "onlyTranslation", space: "local", startLocal: L0sh });
    ok("onlyTranslation Local free：ok", otFree.ok === true);
    /* H=I（轴基=L0）但**回父级存储用 A⁻¹**：A=rot90 ⇒ 父级增量 = rot(-90)(5,0) = (0,-5) */
    near("onlyTranslation：Local free 回父级用 A⁻¹（x）", otFree.x, 0, 1e-9);
    near("onlyTranslation：Local free 回父级用 A⁻¹（y）", otFree.y, -5, 1e-9);
    /* 顾问给的判据例：A=diag(2,1)、H=I、W=I、世界(10,0) → 局部 (5,0)，不能是 (10,0) */
    var adv = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 10, y: 0 }, parentWorld: scaleMat(2, 1), inherit: "onlyTranslation", space: "local", startLocal: { rotation: 0, scaleX: 1, scaleY: 1 } });
    near("顾问判据：A=diag(2,1)+onlyTranslation+W=I → 局部 x = 5", adv.x, 5, 1e-12);
    near("顾问判据：局部 y = 0", adv.y, 0, 1e-12);
    ok("顾问判据：确实不是 10（用 H⁻¹ 回写会算成 10）", Math.abs(adv.x - 10) > 1e-9);
    var otAx = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 0, y: 7 }, parentWorld: R90, inherit: "onlyTranslation", space: "local", startLocal: L0sh, axis: "x" });
    var L0shLin = B.localLinear(L0sh);
    var otMv = B.applyVec(L0shLin, otAx.x, otAx.y);
    near("onlyTranslation：轴约束沿含 shear 的骨 +X（叉积 0）", otMv.x * L0shLin.b - otMv.y * L0shLin.a, 0, 1e-9);
    var otParent = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 5, y: 0 }, parentWorld: R90, inherit: "onlyTranslation", space: "parent" });
    near("onlyTranslation：parent 空间 Jacobian 仍用真实 P（x）", otParent.x, B.applyVec(B.invert(R90), 5, 0).x, 1e-9);

    /* 退化：骨轴基奇异（scaleX=0）→ 显式拒绝，绝不写坏 */
    var sing = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 1, y: 1 }, parentWorld: R90, space: "local", startLocal: { rotation: 0, scaleX: 0, scaleY: 1 } });
    eq("Local 轴基奇异 → ok:false", sing.ok, false);
    eq("Local 轴基奇异 → LOCAL_BASIS_SINGULAR", sing.reason, "LOCAL_BASIS_SINGULAR");
    ok("拒绝时不产出 x/y", sing.x === undefined && sing.y === undefined);
    var snapLoc = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 3, y: 0 }, parentWorld: B.identity(), space: "local", startLocal: L0id, axis: "x", snapUnit: 5 });
    eq("Local + snapUnit 5：x 取整 5", snapLoc.x, 5);
    var stored = B.translateFromDrag({ startX: 100, startY: -50, startWorld: { x: 0, y: 0 }, world: { x: 4, y: 0 }, parentWorld: B.identity(), space: "local", startLocal: L0id, axis: "x" });
    near("Local：起点被累加（仍是父级局部存储）", stored.x, 104, 1e-9);
    near("Local：deltaLocal 与起点一致", stored.deltaLocal.x, 4, 1e-9);
    var badParent = B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 1, y: 1 }, parentWorld: scaleMat(0, 1), space: "local", startLocal: L0id });
    eq("Local + 奇异父级 → PARENT_SINGULAR", badParent.reason, "PARENT_SINGULAR");
  })();

  section("P1·旋转（父级 H⁻¹ 取角差）");
  (function () {
    /* 顾问反例：H=diag(2,1)，世界角 26.565° 对应局部 45° */
    var H = scaleMat(2, 1);
    var mid = B.rotateFromDrag({ startRotation: 0, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 2, y: 0 }, world: { x: Math.SQRT2, y: Math.SQRT1_2 }, parentWorld: H, space: "parent" });
    near("diag(2,1)：中间点父级角差 = 45°", mid.deltaDeg, 45, 1e-9);
    var worldAng = (Math.atan2(Math.SQRT1_2, Math.SQRT2) * 180) / Math.PI;
    near("diag(2,1)：世界角确实是 26.565°（≠ 局部）", worldAng, 26.56505117707799, 1e-9);
    ok("diag(2,1)：局部角差 ≠ 世界角差（修正前会算错）", Math.abs(mid.deltaDeg - worldAng) > 1);
    var quarter = B.rotateFromDrag({ startRotation: 0, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 2, y: 0 }, world: { x: 0, y: 1 }, parentWorld: H, space: "parent" });
    near("diag(2,1)：父级 +90°", quarter.deltaDeg, 90, 1e-9);

    /* 相似父级下 parent 与 world 一致 */
    var Rs = composed(rot(-40), scaleMat(1.5, 1.5));
    var pRot = B.rotateFromDrag({ startRotation: 12, pivotWorld: { x: 5, y: 5 }, startWorld: { x: 15, y: 5 }, world: { x: 5, y: 15 }, parentWorld: Rs, space: "parent" });
    var wRot = B.rotateFromDrag({ startRotation: 12, pivotWorld: { x: 5, y: 5 }, startWorld: { x: 15, y: 5 }, world: { x: 5, y: 15 }, parentWorld: Rs, space: "world" });
    near("相似父级：parent 与 world 角差一致", pRot.deltaDeg, wRot.deltaDeg, 1e-9);
    near("相似父级：parent 角差 = 世界 90°", pRot.deltaDeg, 90, 1e-9);

    /* Local 与 Parent 同口径（都用 H） */
    var lRot = B.rotateFromDrag({ startRotation: 12, pivotWorld: { x: 5, y: 5 }, startWorld: { x: 15, y: 5 }, world: { x: 5, y: 15 }, parentWorld: H, space: "local" });
    near("Local 旋转 == Parent 旋转（同一 H 口径）", lRot.deltaDeg, quarter.deltaDeg, 1e-12);
    eq("旋转返回 space 标记", lRot.space, "local");

    /* onlyTranslation：H=I ⇒ 角差 = 世界角差 */
    var otRot = B.rotateFromDrag({ startRotation: 0, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 2, y: 0 }, world: { x: Math.SQRT2, y: Math.SQRT1_2 }, parentWorld: H, inherit: "onlyTranslation", space: "parent" });
    near("onlyTranslation：H=I ⇒ 父级角差 = 世界角差", otRot.deltaDeg, worldAng, 1e-9);

    /* 非均匀 + 反射：similarity gate 在 world 分支生效 */
    var badWorld = B.rotateFromDrag({ startRotation: 0, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 2, y: 0 }, world: { x: 0, y: 1 }, parentWorld: H, space: "world" });
    eq("world+非均匀 → 拒绝", badWorld.ok, false);
    eq("world+非均匀 → WORLD_ROTATE_UNSUPPORTED", badWorld.reason, "WORLD_ROTATE_UNSUPPORTED");
    var mirror = scaleMat(-1, 1);
    var mirRot = B.rotateFromDrag({ startRotation: 0, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 1, y: 0 }, world: { x: 0, y: 1 }, parentWorld: mirror, space: "world" });
    ok("反射+world：ok", mirRot.ok === true);
    near("反射+world：角差反号 = -90", mirRot.deltaDeg, -90, 1e-9);
    var mirParent = B.rotateFromDrag({ startRotation: 0, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 1, y: 0 }, world: { x: 0, y: 1 }, parentWorld: mirror, space: "parent" });
    near("反射+parent：H⁻¹ 已含反射 ⇒ -90", mirParent.deltaDeg, -90, 1e-9);

    /* 多圈保留：r0=350 再转 20° → 370（不夹到 10） */
    var multi = B.rotateFromDrag({ startRotation: 350, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 1, y: 0 }, world: { x: Math.cos(Math.PI / 9), y: Math.sin(Math.PI / 9) }, parentWorld: B.identity(), space: "parent" });
    near("多圈：r0=350 + 20° → 370", multi.rotation, 370, 1e-9);
    var multiLocal = B.rotateFromDrag({ startRotation: 350, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 1, y: 0 }, world: { x: Math.cos(Math.PI / 9), y: Math.sin(Math.PI / 9) }, parentWorld: B.identity(), space: "local" });
    near("多圈：Local 同样保留 370", multiLocal.rotation, 370, 1e-9);

    /* 退化与奇异 */
    var zero = B.rotateFromDrag({ startRotation: 0, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 0, y: 0 }, world: { x: 1, y: 0 }, parentWorld: B.identity() });
    eq("起点在 pivot → RADIUS_ZERO", zero.reason, "RADIUS_ZERO");
    var sing = B.rotateFromDrag({ startRotation: 0, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 1, y: 0 }, world: { x: 0, y: 1 }, parentWorld: scaleMat(0, 1), space: "parent" });
    eq("奇异父级 + parent → PARENT_SINGULAR", sing.reason, "PARENT_SINGULAR");
    var snapRot = B.rotateFromDrag({ startRotation: 0, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 1, y: 0 }, world: { x: Math.cos(0.82), y: Math.sin(0.82) }, parentWorld: B.identity(), space: "parent", snapDeg: 15 });
    eq("snapDeg 15：47° → 45°", snapRot.deltaDeg, 45);
  })();

  section("P1·Local 缩放（含 shear 轴基）");
  (function () {
    var pivot = { x: 0, y: 0 };
    var R90 = rot(90);
    var rotBone = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: pivot, startWorld: { x: 10, y: 0 }, world: { x: 30, y: 0 }, axis: "y", boneWorld: B.identity(), startLocal: { rotation: 90, scaleX: 1, scaleY: 1 } });
    near("P0 兼容：boneWorld 仍按 H 解释（fy=3）", rotBone.factor, 3, 1e-9);
    var newEntry = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: pivot, startWorld: { x: 10, y: 0 }, world: { x: 30, y: 0 }, axis: "y", parentWorld: B.identity(), startLocal: { rotation: 90, scaleX: 1, scaleY: 1 } });
    near("新入口 parentWorld：与 P0 结果一致（fy=3）", newEntry.factor, rotBone.factor, 1e-12);
    var otScale = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: pivot, startWorld: { x: 10, y: 0 }, world: { x: 30, y: 0 }, axis: "y", parentWorld: R90, inherit: "onlyTranslation", startLocal: { rotation: 90, scaleX: 1, scaleY: 1 } });
    near("onlyTranslation：H=I ⇒ 轴基 = L0（fy=3）", otScale.factor, 3, 1e-9);
    /* normal（H=A=rot90）与 onlyTranslation（H=I）在同样输入下必须给出不同几何 */
    var normalScale = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: pivot, startWorld: { x: 10, y: 0 }, world: { x: 30, y: 0 }, axis: "y", parentWorld: R90, startLocal: { rotation: 0, scaleX: 1, scaleY: 1 } });
    var otScale2 = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: pivot, startWorld: { x: 10, y: 0 }, world: { x: 30, y: 0 }, axis: "y", parentWorld: R90, inherit: "onlyTranslation", startLocal: { rotation: 0, scaleX: 1, scaleY: 1 } });
    near("normal + 父级 rot90：轴基含父级旋转 ⇒ B0⁻¹ 投影比 3", normalScale.factor, 3, 1e-9);
    eq("onlyTranslation：H=I ⇒ 起点垂直骨 Y 轴 → AXIS_BASE_ZERO（与 normal 可区分）", otScale2.reason, "AXIS_BASE_ZERO");
    eq("onlyTranslation：确实被拒绝", otScale2.ok, false);

    /* shear 必须进入轴基：与忽略 shear 的旧 linearFrom 结果不同 */
    var L0sh = { rotation: 20, scaleX: 1, scaleY: 1, shearX: 35 };
    var B0sh = B.localLinear(L0sh);
    var B0noshear = B.linearFrom(L0sh.rotation, 1, 1);
    ok("localLinear 与 linearFrom 在 shear≠0 时不同", Math.abs(B0sh.a - B0noshear.a) > 1e-3);
    near("localLinear 对齐 spine-core：a=cos(r+shearX)", B0sh.a, Math.cos(((20 + 35) * Math.PI) / 180), 1e-12);
    near("localLinear 对齐 spine-core：c=cos(r+90+shearY)", B0sh.c, Math.cos(((20 + 90) * Math.PI) / 180), 1e-12);
    var v0 = { x: 1.4, y: 0.9 };
    var v1 = { x: 2.1, y: 1.1 };
    var shRes = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: pivot, startWorld: v0, world: v1, axis: "x", parentWorld: B.identity(), startLocal: L0sh });
    var invSh = B.invert(B0sh);
    var h0 = { x: invSh.a * v0.x + invSh.c * v0.y, y: invSh.b * v0.x + invSh.d * v0.y };
    var h1 = { x: invSh.a * v1.x + invSh.c * v1.y, y: invSh.b * v1.x + invSh.d * v1.y };
    near("shear 轴基：fx 等于 B0⁻¹ 投影比（含 shear）", shRes.factor, h1.x / h0.x, 1e-9);
    /* Y 轴同样用含 shear 的基；忽略 shear 的基会给出不同倍率（证明修复必要） */
    var shResY = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: pivot, startWorld: v0, world: v1, axis: "y", parentWorld: B.identity(), startLocal: L0sh });
    near("shear 轴基：fy 等于 B0⁻¹ 投影比（含 shear）", shResY.factor, h1.y / h0.y, 1e-9);
    var noSh = B.invert(B0noshear);
    var n0 = { x: noSh.a * v0.x + noSh.c * v0.y, y: noSh.b * v0.x + noSh.d * v0.y };
    var n1 = { x: noSh.a * v1.x + noSh.c * v1.y, y: noSh.b * v1.x + noSh.d * v1.y };
    ok("忽略 shear 会给出不同倍率（证明修复必要）", Math.abs(n1.y / n0.y - shResY.factor) > 1e-6);

    /* 非均匀父级 + shear：仍与独立投影一致 */
    var Hnu = composed(rot(25), scaleMat(1.8, 0.6));
    var nuRes = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: pivot, startWorld: v0, world: v1, axis: "y", parentWorld: Hnu, startLocal: L0sh });
    var Bnu = B.mul(Hnu, B0sh);
    var invNu = B.invert(Bnu);
    var q0 = { x: invNu.a * v0.x + invNu.c * v0.y, y: invNu.b * v0.x + invNu.d * v0.y };
    var q1 = { x: invNu.a * v1.x + invNu.c * v1.y, y: invNu.b * v1.x + invNu.d * v1.y };
    near("非均匀+shear：fy 等于独立投影比", nuRes.factor, q1.y / q0.y, 1e-9);
    near("非均匀+shear：scaleX 不变", nuRes.scaleX, 1, 1e-12);
    var locRes = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: pivot, startWorld: v0, world: v1, axis: "y", parentWorld: Hnu, startLocal: L0sh, space: "local" });
    near("scale local == parent（轴基同源）", locRes.factor, nuRes.factor, 1e-12);

    /* 拒绝路径 */
    var missingLocal = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: pivot, startWorld: { x: 10, y: 0 }, world: { x: 20, y: 0 }, axis: "x", boneWorld: B.identity() });
    eq("缺 startLocal → START_LOCAL_MISSING", missingLocal.reason, "START_LOCAL_MISSING");
    eq("缺 startLocal → ok:false", missingLocal.ok, false);
    var zeroAxis = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: pivot, startWorld: { x: 10, y: 0 }, world: { x: 20, y: 0 }, axis: "x", parentWorld: B.identity(), startLocal: { rotation: 0, scaleX: 0, scaleY: 1 } });
    eq("scaleX=0 且拖 X 轴 → AXIS_DEGENERATE", zeroAxis.reason, "AXIS_DEGENERATE");
    var perpBase = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: pivot, startWorld: { x: 0, y: 10 }, world: { x: 0, y: 20 }, axis: "x", parentWorld: B.identity(), startLocal: { rotation: 0, scaleX: 1, scaleY: 1 } });
    eq("起点垂直于轴 → AXIS_BASE_ZERO", perpBase.reason, "AXIS_BASE_ZERO");
    var wAxis = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: pivot, startWorld: { x: 10, y: 0 }, world: { x: 20, y: 0 }, axis: "x", space: "world", parentWorld: B.identity(), startLocal: { rotation: 0, scaleX: 1, scaleY: 1 } });
    eq("world 单轴 → WORLD_AXIS_SCALE_UNSUPPORTED", wAxis.reason, "WORLD_AXIS_SCALE_UNSUPPORTED");
    var uniformShear = B.scaleFromDrag({ startScaleX: 1, startScaleY: 2, pivotWorld: pivot, startWorld: { x: 3, y: 4 }, world: { x: 6, y: 8 }, uniform: true, parentWorld: Hnu, startLocal: L0sh });
    near("等比：距离比 2 → scaleX 2", uniformShear.scaleX, 2, 1e-9);
    near("等比：scaleY 4", uniformShear.scaleY, 4, 1e-9);
  })();

  section("P1·Pose aim");
  (function () {
    var pv = { x: 10, y: 20 };
    var L0 = { rotation: 0, scaleX: 1, scaleY: 1, shearX: 0 };
    function aim(point, opt) {
      var o = opt || {};
      return B.aimRotation({
        startRotation: o.r0 === undefined ? 0 : o.r0,
        pivotWorld: pv,
        pointWorld: { x: pv.x + point[0], y: pv.y + point[1] },
        parentWorld: o.parent,
        inherit: o.inherit,
        startLocal: o.local || L0,
        snapDeg: o.snapDeg,
      });
    }
    var qI = aim([10, 0]);
    near("象限 I（+X）：rotation 0", qI.rotation, 0, 1e-9);
    near("象限 I：deltaDeg 0", qI.deltaDeg, 0, 1e-9);
    var qII = aim([0, 10]);
    near("象限 II（+Y）：rotation 90", qII.rotation, 90, 1e-9);
    var qIII = aim([-10, 0]);
    near("象限 III（-X）：rotation 180", qIII.rotation, 180, 1e-9);
    var qIV = aim([0, -10]);
    near("象限 IV（-Y）：rotation -90", qIV.rotation, -90, 1e-9);
    ok("aim 只返回 rotation，不动 x/y", qI.x === undefined && qI.y === undefined);
    near("aim 返回 angleDeg", qII.angleDeg, 90, 1e-9);

    /* 跨 ±180：取离 r0 最近的等价角 */
    var cross = aim([Math.cos((-170 * Math.PI) / 180) * 10, Math.sin((-170 * Math.PI) / 180) * 10], { r0: 170 });
    near("跨 ±180：r0=170 目标 -170 → rotation 190", cross.rotation, 190, 1e-6);
    near("跨 ±180：deltaDeg +20", cross.deltaDeg, 20, 1e-6);
    var cross2 = aim([Math.cos((179 * Math.PI) / 180) * 10, Math.sin((179 * Math.PI) / 180) * 10], { r0: -179 });
    near("跨 ±180（反向）：deltaDeg -2", cross2.deltaDeg, -2, 1e-6);
    near("跨 ±180（反向）：等价角保持 ≡179 (mod 360)", (((cross2.rotation - 179) % 360) + 360) % 360, 0, 1e-6);
    /* |scaleX|≈0：+X 列退化 → 拒绝（顾问要求） */
    var zeroSx = aim([10, 0], { local: { rotation: 0, scaleX: 0, scaleY: 1, shearX: 0 } });
    eq("|scaleX|≈0 → AXIS_DEGENERATE", zeroSx.reason, "AXIS_DEGENERATE");
    eq("|scaleX|≈0 → ok:false", zeroSx.ok, false);
    var multi = aim([0, 10], { r0: 730 });
    near("多圈保留：r0=730 目标 90 → 810", multi.rotation, 810, 1e-9);
    ok("多圈：不被夹到 (-180,180]", Math.abs(multi.rotation) > 360);

    /* 父级旋转 / 非均匀 / onlyTranslation */
    var pr = aim([0, 10], { parent: rot(30) });
    near("父级 rot30：世界 90° → 父级 60°", pr.rotation, 60, 1e-9);
    var nu = aim([2, 1], { parent: scaleMat(2, 1) });
    near("父级 diag(2,1)：世界 (2,1) → 父级 45°", nu.rotation, 45, 1e-9);
    var ot = aim([2, 1], { parent: scaleMat(2, 1), inherit: "onlyTranslation" });
    near("onlyTranslation：H=I ⇒ 直接用世界角 26.565°", ot.rotation, 26.56505117707799, 1e-9);

    /* shear / scaleX<0 修正 */
    var sh = aim([0, 10], { local: { rotation: 0, scaleX: 1, scaleY: 1, shearX: 25 } });
    near("shearX=25：r* = 90 - 25 = 65", sh.rotation, 65, 1e-9);
    var flip = aim([0, 10], { local: { rotation: 0, scaleX: -1, scaleY: 1, shearX: 0 } });
    near("scaleX<0：+X 列反 180° ⇒ r* = -90", flip.rotation, -90, 1e-9);
    var flip2 = aim([10, 0], { local: { rotation: 0, scaleX: -2, scaleY: 1, shearX: 10 }, r0: 170 });
    near("scaleX<0 + shear：r* = -190，取近 r0 ⇒ 170", flip2.rotation, 170, 1e-9);

    /* snapDeg */
    var snapped = aim([Math.cos(0.82) * 10, Math.sin(0.82) * 10], { snapDeg: 15 });
    eq("snapDeg 15：47° → 45°", snapped.deltaDeg, 45);

    /* 退化与非法 */
    var deg = aim([0, 0]);
    eq("point≈pivot → AIM_DEGENERATE", deg.reason, "AIM_DEGENERATE");
    eq("point≈pivot → ok:false", deg.ok, false);
    var bad = B.aimRotation({ startRotation: 0, pivotWorld: pv, parentWorld: B.identity() });
    eq("缺 pointWorld → POINT_INVALID", bad.reason, "POINT_INVALID");
    var badStart = B.aimRotation({ pivotWorld: pv, pointWorld: { x: 1, y: 1 } });
    eq("缺 startRotation → START_INVALID", badStart.reason, "START_INVALID");
    var sing = aim([10, 0], { parent: scaleMat(0, 1) });
    eq("奇异父级 → PARENT_SINGULAR", sing.reason, "PARENT_SINGULAR");

    /* aimTipOf */
    var tip = B.aimTipOf({ parentWorld: B.identity(), startLocal: L0, pivotWorld: pv, length: 50 });
    near("aimTipOf：rotation 0 ⇒ tip.x = pivot.x + 50", tip.x, 60, 1e-9);
    near("aimTipOf：tip.y 不变", tip.y, 20, 1e-9);
    eq("aimTipOf：长度来源 bone", tip.usedLengthSource, "bone");
    var tip90 = B.aimTipOf({ parentWorld: B.identity(), startLocal: { rotation: 90, scaleX: 1, scaleY: 1 }, pivotWorld: pv, length: 50 });
    near("aimTipOf：rotation 90 ⇒ 沿世界 +Y", tip90.y, 70, 1e-9);
    var tipScale = B.aimTipOf({ parentWorld: B.identity(), startLocal: { rotation: 0, scaleX: 2, scaleY: 1 }, pivotWorld: pv, length: 50 });
    near("aimTipOf：scaleX=2 ⇒ 视觉长度 100", tipScale.x, 110, 1e-9);
    var tipShear = B.aimTipOf({ parentWorld: B.identity(), startLocal: { rotation: 0, scaleX: 1, scaleY: 1, shearX: 30 }, pivotWorld: pv, length: 50 });
    near("aimTipOf：shear 进入 +X 方向（cos30）", tipShear.x, pv.x + 50 * Math.cos(Math.PI / 6), 1e-9);
    near("aimTipOf：shear 进入 +X 方向（sin30）", tipShear.y, pv.y + 50 * Math.sin(Math.PI / 6), 1e-9);
    var tipChild = B.aimTipOf({ parentWorld: B.identity(), startLocal: L0, pivotWorld: pv, childWorld: { tx: 60, ty: 20 } });
    eq("aimTipOf：缺 length → 用子骨距离（source=child）", tipChild.usedLengthSource, "child");
    near("aimTipOf：子骨距离反算本地 length = 50", tipChild.length, 50, 1e-9);
    var tipChildScaled = B.aimTipOf({ parentWorld: B.identity(), startLocal: { rotation: 0, scaleX: 2, scaleY: 1 }, pivotWorld: pv, childWorld: { tx: 110, ty: 20 } });
    near("aimTipOf：子骨距离 / |W.colX| = 50（scaleX 已计入）", tipChildScaled.length, 50, 1e-9);
    var tipLeaf = B.aimTipOf({ parentWorld: B.identity(), startLocal: L0, pivotWorld: pv });
    eq("aimTipOf：叶骨无 length 无子骨 → source=none", tipLeaf.usedLengthSource, "none");
    eq("aimTipOf：叶骨 length 0（由调用方给显示长度）", tipLeaf.length, 0);
    eq("aimTipOf：叶骨标记 degenerate", tipLeaf.degenerate, true);
    var tipParent = B.aimTipOf({ parentWorld: rot(90), startLocal: L0, pivotWorld: pv, length: 10 });
    near("aimTipOf：父级 rot90 ⇒ 沿世界 +Y", tipParent.y, 30, 1e-9);
    var tipOt = B.aimTipOf({ parentWorld: rot(90), inherit: "onlyTranslation", startLocal: L0, pivotWorld: pv, length: 10 });
    near("aimTipOf：onlyTranslation ⇒ 父级旋转不影响 +X", tipOt.x, 20, 1e-9);
    near("aimTipOf：dirX/dirY 为单位向量", Math.hypot(tip90.dirX, tip90.dirY), 1, 1e-9);
    var tipSing = B.aimTipOf({ parentWorld: B.identity(), startLocal: { rotation: 0, scaleX: 0, scaleY: 1 }, pivotWorld: pv, length: 10 });
    eq("aimTipOf：|W.colX|=0 → LOCAL_BASIS_SINGULAR", tipSing.reason, "LOCAL_BASIS_SINGULAR");
  })();

  section("P1·继承基与兼容");
  (function () {
    var A = composed(rot(40), scaleMat(1.4, 0.9));
    var nb = B.inheritBasis(A, undefined);
    eq("inheritBasis 缺省 = normal", nb.inherit, "normal");
    near("inheritBasis normal：H = A（a）", nb.H.a, A.a, 1e-12);
    near("inheritBasis normal：H = A（tx 也保留）", nb.H.tx, A.tx, 1e-12);
    var otb = B.inheritBasis(A, "onlyTranslation");
    eq("inheritBasis onlyTranslation 标记", otb.inherit, "onlyTranslation");
    near("inheritBasis onlyTranslation：H = I（a）", otb.H.a, 1, 1e-12);
    near("inheritBasis onlyTranslation：H = I（c）", otb.H.c, 0, 1e-12);
    near("inheritBasis onlyTranslation：A 仍是真实父级（a）", otb.A.a, A.a, 1e-12);
    var nullb = B.inheritBasis(null, "normal");
    near("inheritBasis(null)：A = I", nullb.A.a, 1, 1e-12);
    ok("inheritBasis normal：supported", nb.supported === true);
    ok("inheritBasis onlyTranslation：supported", otb.supported === true);
    var ns = B.inheritBasis(A, "noScale");
    eq("inheritBasis noScale：supported=false（不按 normal 伪验收）", ns.supported, false);
    eq("inheritBasis noScale：inherit 原样回传", ns.inherit, "noScale");
    near("inheritBasis noScale：A 仍是真实父级", ns.A.a, A.a, 1e-12);
    var nrr = B.inheritBasis(A, "noRotationOrReflection");
    eq("inheritBasis noRotationOrReflection：supported=false", nrr.supported, false);
    eq("未支持 inherit → 平移拒绝", B.translateFromDrag({ startX: 0, startY: 0, startWorld: { x: 0, y: 0 }, world: { x: 1, y: 1 }, parentWorld: A, inherit: "noScale", space: "local", startLocal: { rotation: 0, scaleX: 1, scaleY: 1 } }).reason, "INHERIT_UNSUPPORTED");
    eq("未支持 inherit → 旋转拒绝", B.rotateFromDrag({ startRotation: 0, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 1, y: 0 }, world: { x: 0, y: 1 }, parentWorld: A, inherit: "noScaleOrReflection" }).reason, "INHERIT_UNSUPPORTED");
    eq("未支持 inherit → 缩放拒绝", B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 1, y: 0 }, world: { x: 2, y: 0 }, axis: "x", parentWorld: A, inherit: "noScale", startLocal: { rotation: 0, scaleX: 1, scaleY: 1 } }).reason, "INHERIT_UNSUPPORTED");
    eq("未支持 inherit → aim 拒绝", B.aimRotation({ startRotation: 0, pivotWorld: { x: 0, y: 0 }, pointWorld: { x: 1, y: 0 }, parentWorld: A, inherit: "noScale", startLocal: { shearX: 0, scaleX: 1 } }).reason, "INHERIT_UNSUPPORTED");
    eq("未支持 inherit → aimTipOf 拒绝", B.aimTipOf({ parentWorld: A, inherit: "noScale", startLocal: { rotation: 0, scaleX: 1, scaleY: 1 }, pivotWorld: { x: 0, y: 0 }, length: 10 }).reason, "INHERIT_UNSUPPORTED");
    eq("EDIT_CODES 含 INHERIT_UNSUPPORTED", B.editCode("INHERIT_UNSUPPORTED"), "EDIT_INHERIT_UNSUPPORTED");
    var W = B.boneWorldLinear(A, { rotation: 15, scaleX: 1.2, scaleY: 0.7, shearX: 8 });
    var Wexp = B.mul(A, B.localLinear({ rotation: 15, scaleX: 1.2, scaleY: 0.7, shearX: 8 }));
    near("boneWorldLinear = H·localLinear（a）", W.a, Wexp.a, 1e-12);
    near("boneWorldLinear = H·localLinear（b）", W.b, Wexp.b, 1e-12);
    ok("新导出齐备", typeof B.localLinear === "function" && typeof B.inheritBasis === "function" && typeof B.boneWorldLinear === "function" && typeof B.aimRotation === "function" && typeof B.aimTipOf === "function");

    /* 旧 API 不传 space/inherit 行为不变 */
    var deltas = [[3, 4], [-7, 2], [0, -5], [12.5, -3.25]];
    var parentsX = [B.identity(), composed(rot(33), scaleMat(1.7, 0.6)), scaleMat(-1.5, 2)];
    for (var i = 0; i < deltas.length; i++) {
      for (var j = 0; j < parentsX.length; j++) {
        var oldRes = B.translateFromDrag({ startX: 1, startY: 2, startWorld: { x: 0, y: 0 }, world: { x: deltas[i][0], y: deltas[i][1] }, parentWorld: parentsX[j] });
        var exp = B.applyVec(B.invert(parentsX[j]), deltas[i][0], deltas[i][1]);
        near("旧 API 平移不变（x）", oldRes.x, 1 + exp.x, 1e-12);
        near("旧 API 平移不变（y）", oldRes.y, 2 + exp.y, 1e-12);
      }
    }
    var oldRot = B.rotateFromDrag({ startRotation: 10, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 5, y: 0 }, world: { x: 0, y: 5 }, parentWorld: composed(rot(20), scaleMat(1.3, 1.3)) });
    near("旧 API 旋转（相似父级）不变", oldRot.deltaDeg, 90, 1e-9);
    var oldScale = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 4, y: 0 }, world: { x: 10, y: 0 }, axis: "x", boneWorld: B.identity(), startLocal: { rotation: 0, scaleX: 1, scaleY: 1 } });
    near("旧 API 缩放（boneWorld 作 H）不变", oldScale.factor, 2.5, 1e-9);
    var oldUniform = B.scaleFromDrag({ startScaleX: 1, startScaleY: 1, pivotWorld: { x: 0, y: 0 }, startWorld: { x: 3, y: 4 }, world: { x: 6, y: 8 }, uniform: true });
    near("旧 API 等比不变", oldUniform.factor, 2, 1e-12);

    /* gizmo：axesAngleRad 别名 */
    var g1 = B.gizmoGeometry({ pivotScreen: { x: 0, y: 0 }, axisXAngleRad: 0, axisYAngleRad: Math.PI / 2, zoom: 1, sizeCss: 46 });
    var g2 = B.gizmoGeometry({ pivotScreen: { x: 0, y: 0 }, axesAngleRad: { x: 0, y: Math.PI / 2 }, zoom: 1, sizeCss: 46 });
    near("axesAngleRad 别名 == axisX/YAngleRad（axisX.x）", g2.axisX.x, g1.axisX.x, 1e-12);
    near("axesAngleRad 别名 == axisX/YAngleRad（axisY.y）", g2.axisY.y, g1.axisY.y, 1e-12);
    near("axesAngleRad 别名 == scaleHandleY.x", g2.scaleHandleY.x, g1.scaleHandleY.x, 1e-12);
    eq("axesAngleRad 命中 X 手柄", B.hitGizmo({ point: { x: 46, y: 0 }, geometry: g2, tool: "scale" }), "scale");
    var g3 = B.gizmoGeometry({ pivotScreen: { x: 0, y: 0 }, angleRad: Math.PI / 2, zoom: 1, sizeCss: 46 });
    near("旧 angleRad π/2 ⇒ Y 轴 = π（朝 -X）", g3.axisY.x, -46, 1e-9);
    near("旧 angleRad π/2 ⇒ Y 轴 y ≈ 0", g3.axisY.y, 0, 1e-9);
    var g4 = B.gizmoGeometry({ pivotScreen: { x: 0, y: 0 }, angleRad: 0, axesAngleRad: { x: Math.PI / 2, y: Math.PI }, zoom: 1, sizeCss: 46 });
    near("axesAngleRad 优先于 angleRad（x 向）", g4.axisX.x, 0, 1e-9);
    near("axesAngleRad 优先于 angleRad（y 向）", g4.axisX.y, 46, 1e-9);
  })();

  /* ==========================================================================
   * P2-03 轴心补偿（compensateMove / compensatePivot / boneChainWorlds）
   * ====================================================================== */
  function mkBone(name, parentIndex, vals) {
    var b = { name: name, parentIndex: parentIndex, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, inherit: "normal" };
    if (vals) for (var k in vals) b[k] = vals[k];
    return b;
  }
  function cloneBones(list) {
    return list.map(function (b) {
      var o = {};
      for (var k in b) o[k] = b[k];
      return o;
    });
  }
  /** 三级链：root(rot90) → mid(非均匀 2×0.5 + shear) → c1/c2（直接子骨）+ gc（孙代） */
  function chainRig() {
    return [
      mkBone("root", -1, { x: 5, y: 3, rotation: 90 }),
      mkBone("mid", 0, { x: 2, y: -1, rotation: 20, scaleX: 2, scaleY: 0.5, shearX: 3 }),
      mkBone("c1", 1, { x: 7, y: 4, rotation: -35, scaleX: 1.2, scaleY: 0.8 }),
      mkBone("c2", 1, { x: -3, y: 9, rotation: 12 }),
      mkBone("gc", 2, { x: 1.5, y: 2.5, rotation: 5 }),
    ];
  }
  function worldErrOf(changes) {
    var m = 0;
    for (var i = 0; i < changes.length; i++) m = Math.max(m, changes[i].error);
    return m;
  }

  section("P2-03·世界链求值");
  (function () {
    var rig = chainRig();
    var w = B.boneChainWorlds(rig);
    ok("boneChainWorlds：ok", w.ok === true);
    var m1 = B.mul(
      B.boneLocalMatrix({ x: 5, y: 3, rotation: 90 }),
      B.boneLocalMatrix({ x: 2, y: -1, rotation: 20, scaleX: 2, scaleY: 0.5, shearX: 3 })
    );
    near("世界链 mid.a == 手工 mul", w.worlds[1].a, m1.a, 1e-12);
    near("世界链 mid.b == 手工 mul", w.worlds[1].b, m1.b, 1e-12);
    near("世界链 mid.c == 手工 mul", w.worlds[1].c, m1.c, 1e-12);
    near("世界链 mid.d == 手工 mul", w.worlds[1].d, m1.d, 1e-12);
    near("世界链 mid.tx == 手工 mul", w.worlds[1].tx, m1.tx, 1e-12);
    near("世界链 mid.ty == 手工 mul", w.worlds[1].ty, m1.ty, 1e-12);
    near("根骨世界 tx = 局部 x", w.worlds[0].tx, 5, 1e-12);
    near("根骨世界 ty = 局部 y", w.worlds[0].ty, 3, 1e-12);
    eq("直接子骨 = mid 的两个", B.directChildrenOf(rig, 1).join(","), "2,3");
    eq("孙代不算直接子骨", B.directChildrenOf(rig, 2).join(","), "4");
    eq("祖先链 = mid→root", B.ancestorIndicesOf(rig, 1).join(","), "0");
    eq("根骨无祖先", B.ancestorIndicesOf(rig, 0).length, 0);
    eq("inheritModeOf normal", B.inheritModeOf("normal").mode, "normal");
    eq("inheritModeOf undefined ⇒ normal", B.inheritModeOf(undefined).mode, "normal");
    ok("inheritModeOf onlyTranslation supported", B.inheritModeOf("onlyTranslation").supported === true);
    ok("inheritModeOf noScale 不支持", B.inheritModeOf("noScale").supported === false);
    /* onlyTranslation 的世界：只继承父级平移 */
    var ot = [mkBone("a", -1, { x: 10, y: 0, rotation: 90 }), mkBone("b", 0, { x: 3, y: 0, rotation: 0, inherit: "onlyTranslation" })];
    var wot = B.boneChainWorlds(ot);
    near("onlyTranslation：世界线性 = 自身局部线性（a）", wot.worlds[1].a, 1, 1e-12);
    near("onlyTranslation：平移仍走父矩阵（tx）", wot.worlds[1].tx, 10, 1e-12);
    near("onlyTranslation：平移仍走父矩阵（ty）", wot.worlds[1].ty, 3, 1e-12);
    var cyc = [mkBone("x", 1), mkBone("y", 0)];
    eq("环 → BONE_CYCLE", B.boneChainWorlds(cyc).reason, "BONE_CYCLE");
    eq("父索引越界 → PARENT_INDEX_INVALID", B.boneChainWorlds([mkBone("x", 7)]).reason, "PARENT_INDEX_INVALID");
    eq("bones 非数组 → BONES_INVALID", B.boneChainWorlds(null).reason, "BONES_INVALID");
  })();

  section("P2-03·compensateMove 基本不变量");
  (function () {
    var rig = chainRig();
    var before = cloneBones(rig);
    var res = B.compensateMove({ bones: rig, boneIndex: 1, delta: { x: 4, y: -2.5 }, mode: "children" });
    ok("compensateMove：ok", res.ok === true);
    eq("changes 只含直接子骨两项", res.changes.length, 2);
    eq("changes[0] 是 c1", res.changes[0].boneIndex, 2);
    eq("changes[1] 是 c2", res.changes[1].boneIndex, 3);
    near("selfChange.x = 原值 + delta", res.selfChange.x, 6, 1e-12);
    near("selfChange.y = 原值 + delta", res.selfChange.y, -3.5, 1e-12);
    ok("子骨世界位置不变（error ≤ 1e-12）", worldErrOf(res.changes) <= 1e-12);
    near("maxError 极小", res.maxError, 0, 1e-12);
    ok("子骨补偿非零（dx/dy 至少一个变）", res.changes[0].dx !== 0 || res.changes[1].dx !== 0);
    near("子骨补偿 = −u（x，逐项）", res.changes[0].dx, -res.u.x, 1e-12);
    near("子骨补偿 = −u（y，逐项）", res.changes[0].dy, -res.u.y, 1e-12);
    near("c1 局部 x = 原值 − u.x", res.changes[0].x, 7 - res.u.x, 1e-12);
    near("c1 局部 y = 原值 − u.y", res.changes[0].y, 4 - res.u.y, 1e-12);
    ok("孙代不在 changes（随子骨自动保持）", res.changes.every(function (c) { return c.boneIndex !== 4; }));
    /* 入参不变 */
    eq("入参数组长度未变", rig.length, before.length);
    eq("入参 mid.x 未变", rig[1].x, before[1].x);
    eq("入参 mid.y 未变", rig[1].y, before[1].y);
    eq("入参 c1.x 未变", rig[2].x, before[2].x);
    eq("入参 c2.y 未变", rig[3].y, before[3].y);
    eq("入参 root.rotation 未变", rig[0].rotation, before[0].rotation);
    ok("limitations 非空且提到直接子骨", res.limitations.length >= 3 && res.limitations.join(" ").indexOf("直接子骨") >= 0);
    /* 幂等：delta = 0 零改动 */
    var zero = B.compensateMove({ bones: rig, boneIndex: 1, delta: { x: 0, y: 0 }, mode: "childrenAndAttachments" });
    ok("delta=0：ok", zero.ok === true);
    eq("delta=0：changes 为空", zero.changes.length, 0);
    eq("delta=0：attachmentChanges 为空", zero.attachmentChanges.length, 0);
    eq("delta=0：idempotent 标记", zero.diagnostics.idempotent, true);
    near("delta=0：pivotAfter == pivotBefore", zero.pivotAfter.x, zero.pivotBefore.x, 1e-12);
    /* 世界位移自洽 */
    var dWorld = B.worldDeltaOfLocal(rig, 1, { x: 4, y: -2.5 });
    near("Δworld 与返回一致（x）", res.deltaWorld.x, dWorld.x, 1e-12);
    near("Δworld 与返回一致（y）", res.deltaWorld.y, dWorld.y, 1e-12);
    near("pivotAfter = pivotBefore + Δworld（x）", res.pivotAfter.x, res.pivotBefore.x + dWorld.x, 1e-12);
    near("pivotAfter = pivotBefore + Δworld（y）", res.pivotAfter.y, res.pivotBefore.y + dWorld.y, 1e-12);
    /* 纯函数/确定性 */
    var again = B.compensateMove({ bones: chainRig(), boneIndex: 1, delta: { x: 4, y: -2.5 }, mode: "children" });
    eq("两次调用结果完全一致", JSON.stringify(again.changes), JSON.stringify(res.changes));
  })();

  section("P2-03·父级旋转/非均匀/反射/斜切均可解");
  (function () {
    var cases = [
      { name: "父级 rot90 + 非均匀 2×0.5", bones: chainRig(), idx: 1, delta: { x: 3, y: 6 } },
      { name: "父级反射 (-1.5, 2)", bones: [mkBone("r", -1, {}), mkBone("p", 0, { x: 1, y: 2, rotation: 25, scaleX: -1.5, scaleY: 2 }), mkBone("k", 1, { x: 4, y: -2 })], idx: 1, delta: { x: -2, y: 3 } },
      { name: "父级带 shear 的非相似线性", bones: chainRig(), idx: 0, delta: { x: 1.25, y: -0.75 } },
      { name: "非均匀负缩放父级", bones: [mkBone("r", -1, { scaleX: 2, scaleY: -0.5 }), mkBone("k", 0, { x: 3, y: 1, rotation: 40 })], idx: 0, delta: { x: 2, y: 2 } },
    ];
    for (var i = 0; i < cases.length; i++) {
      var c = cases[i];
      var res = B.compensateMove({ bones: c.bones, boneIndex: c.idx, delta: c.delta, mode: "children" });
      ok(c.name + "：可解（ok）", res.ok === true);
      ok(c.name + "：子骨世界位置不变", res.ok && worldErrOf(res.changes) <= 1e-9);
      if (res.ok) ok(c.name + "：maxError ≤ 1e-9", res.maxError <= 1e-9);
    }
    /* 非均匀父级下的显式数值核对（不靠自比较）：选中骨局部线性含 2×0.5 */
    var rig = chainRig();
    var res2 = B.compensateMove({ bones: rig, boneIndex: 1, delta: { x: 1, y: 1 }, mode: "children" });
    var Lmid = B.linearFrom(0, 1, 1);
    var invL = B.invert(B.localLinear({ rotation: 20, scaleX: 2, scaleY: 0.5, shearX: 3 }));
    var uExp = B.applyVec(invL, 1, 1);
    near("非均匀选中骨：u = L0⁻¹·delta（x）", res2.u.x, uExp.x, 1e-12);
    near("非均匀选中骨：u = L0⁻¹·delta（y）", res2.u.y, uExp.y, 1e-12);
    /* shear 参与（选中骨带 shear）时仍精确 */
    var rig2 = chainRig();
    rig2[1].shearY = -7;
    var res3 = B.compensateMove({ bones: rig2, boneIndex: 1, delta: { x: 2.5, y: 1.5 }, mode: "children" });
    ok("shearY 参与：ok", res3.ok === true);
    ok("shearY 参与：世界不变", res3.ok && worldErrOf(res3.changes) <= 1e-12);
    ok("linearFrom 仍可用（回归）", Lmid.a === 1);
  })();

  section("P2-03·mode 差异与附件补偿");
  (function () {
    var rig = chainRig();
    var atts = [
      { index: 11, boneIndex: 1, name: "arm_l", type: "region", x: 4, y: 2 },
      { index: 12, boneIndex: 1, name: "arm_r", type: "region", x: -3, y: 6 },
      { index: 13, boneIndex: 1, name: "mesh_x", type: "mesh", x: 1, y: 1 },
      { index: 14, boneIndex: 2, name: "other_bone", type: "region", x: 0, y: 0 },
      { index: 15, boneIndex: 1, name: "legacy_no_type", x: 2, y: -1 },
    ];
    var none = B.compensateMove({ bones: rig, boneIndex: 1, delta: { x: 2, y: 2 }, mode: "none" });
    eq("mode=none：changes 空", none.changes.length, 0);
    eq("mode=none：attachmentChanges 空", none.attachmentChanges.length, 0);
    ok("mode=none：仍算出 selfChange", Math.abs(none.selfChange.x - 4) < 1e-12);
    var kids = B.compensateMove({ bones: rig, boneIndex: 1, delta: { x: 2, y: 2 }, mode: "children", attachments: atts });
    eq("mode=children：两子骨仍补偿", kids.changes.length, 2);
    eq("mode=children：附件不补偿", kids.attachmentChanges.length, 0);
    eq("mode=children：非 region 附件仍记跳过", kids.skippedAttachments.length, 1);
    var all = B.compensateMove({ bones: rig, boneIndex: 1, delta: { x: 2, y: 2 }, mode: "childrenAndAttachments", attachments: atts });
    ok("mode=childrenAndAttachments：ok", all.ok === true);
    eq("只补偿命中骨且为 region（含 type 缺省）的附件", all.attachmentChanges.length, 3);
    eq("附件 index 原样回传", all.attachmentChanges.map(function (a) { return a.index; }).sort().join(","), "11,12,15");
    eq("非 region 附件跳过并记 issue", all.skippedAttachments.length, 1);
    eq("跳过 issue 码", all.issues.length && all.issues[0].code, "ATTACHMENT_NOT_REGION");
    ok("附件世界位置不变", all.attachmentChanges.every(function (a) { return a.error <= 1e-12; }));
    near("附件补偿 = −u（att 4,2）", all.attachmentChanges[0].x, 4 - all.u.x, 1e-12);
    ok("非命中骨的附件不出现", all.attachmentChanges.every(function (a) { return a.index !== 14; }));
    /* 子骨集合可裁剪 */
    var one = B.compensateMove({ bones: rig, boneIndex: 1, delta: { x: 2, y: 2 }, mode: "children", childIndices: [3] });
    eq("childIndices 裁剪：只补偿指定子骨", one.changes.length, 1);
    eq("childIndices 裁剪：命中 c2", one.changes[0].boneIndex, 3);
    eq("未补偿子骨不写入 changes", one.changes.filter(function (c) { return c.boneIndex === 2; }).length, 0);
    /* onlyTranslation 子骨也精确（补偿只依赖父级世界线性） */
    var otRig = [mkBone("p", -1, { x: 1, y: 2, rotation: 33, scaleX: 1.7, scaleY: 0.6 }), mkBone("k", 0, { x: 4, y: -2, rotation: 10, inherit: "onlyTranslation" })];
    var otRes = B.compensateMove({ bones: otRig, boneIndex: 0, delta: { x: 3, y: -1 }, mode: "children" });
    ok("onlyTranslation 子骨：ok", otRes.ok === true);
    ok("onlyTranslation 子骨：世界不变", otRes.ok && worldErrOf(otRes.changes) <= 1e-12);
    /* onlyTranslation 选中骨（世界线性不继承）也精确 */
    var otSelf = [mkBone("p", -1, { x: 1, y: 2, rotation: 33, scaleX: 1.7, scaleY: 0.6 }), mkBone("s", 0, { x: 2, y: 3, inherit: "onlyTranslation" }), mkBone("k", 1, { x: 5, y: 1, rotation: 8 })];
    var otSelfRes = B.compensateMove({ bones: otSelf, boneIndex: 1, delta: { x: -2, y: 4 }, mode: "children" });
    ok("onlyTranslation 选中骨：ok", otSelfRes.ok === true);
    ok("onlyTranslation 选中骨：子骨世界不变", otSelfRes.ok && worldErrOf(otSelfRes.changes) <= 1e-12);
  })();

  section("P2-03·不可解情形拒绝（不写坏数据）");
  (function () {
    var zeroScale = [mkBone("p", -1, {}), mkBone("s", 0, { x: 1, y: 1, scaleX: 0, scaleY: 1 }), mkBone("k", 1, { x: 2, y: 2 })];
    var r1 = B.compensateMove({ bones: zeroScale, boneIndex: 1, delta: { x: 1, y: 1 }, mode: "children" });
    eq("选中骨 scaleX=0 → COMPENSATE_SINGULAR", r1.reason, "COMPENSATE_SINGULAR");
    eq("奇异拒绝带契约码", r1.code, "EDIT_COMPENSATE_UNREPRESENTABLE");
    eq("奇异拒绝不返回 changes", r1.changes, undefined);
    var zeroScaleY = [mkBone("s", -1, { scaleY: 0 }), mkBone("k", 0, { x: 2, y: 2 })];
    eq("选中骨 scaleY=0 → COMPENSATE_SINGULAR", B.compensateMove({ bones: zeroScaleY, boneIndex: 0, delta: { x: 1, y: 0 } }).reason, "COMPENSATE_SINGULAR");
    var badInh = [mkBone("p", -1, { inherit: "noScale" }), mkBone("s", 0, { x: 1, y: 1 }), mkBone("k", 1, { x: 2, y: 2 })];
    var r2 = B.compensateMove({ bones: badInh, boneIndex: 1, delta: { x: 1, y: 1 }, mode: "children" });
    eq("祖先 inherit=noScale → INHERIT_UNSUPPORTED", r2.reason, "INHERIT_UNSUPPORTED");
    eq("拒绝带违规骨索引", r2.inheritBoneIndex, 0);
    var badChild = [mkBone("p", -1, {}), mkBone("s", 0, { x: 1, y: 1 }), mkBone("k", 1, { x: 2, y: 2, inherit: "noRotationOrReflection" })];
    eq("子骨 inherit 不支持 → INHERIT_UNSUPPORTED", B.compensateMove({ bones: badChild, boneIndex: 1, delta: { x: 1, y: 1 }, mode: "children" }).reason, "INHERIT_UNSUPPORTED");
    var selfBad = [mkBone("s", -1, { inherit: "noScaleOrReflection" }), mkBone("k", 0, { x: 1, y: 1 })];
    eq("选中骨 inherit 不支持 → INHERIT_UNSUPPORTED", B.compensateMove({ bones: selfBad, boneIndex: 0, delta: { x: 1, y: 1 } }).reason, "INHERIT_UNSUPPORTED");
    eq("bones 非数组 → BONES_INVALID", B.compensateMove({ bones: null, boneIndex: 0, delta: { x: 1, y: 0 } }).reason, "BONES_INVALID");
    eq("boneIndex 越界 → BONE_INDEX_INVALID", B.compensateMove({ bones: chainRig(), boneIndex: 99, delta: { x: 1, y: 0 } }).reason, "BONE_INDEX_INVALID");
    eq("boneIndex 非整数 → BONE_INDEX_INVALID", B.compensateMove({ bones: chainRig(), boneIndex: 1.5, delta: { x: 1, y: 0 } }).reason, "BONE_INDEX_INVALID");
    eq("delta 缺失 → DELTA_INVALID", B.compensateMove({ bones: chainRig(), boneIndex: 1 }).reason, "DELTA_INVALID");
    eq("delta NaN → DELTA_INVALID", B.compensateMove({ bones: chainRig(), boneIndex: 1, delta: { x: NaN, y: 0 } }).reason, "DELTA_INVALID");
    eq("环 → BONE_CYCLE", B.compensateMove({ bones: [mkBone("x", 1), mkBone("y", 0)], boneIndex: 0, delta: { x: 1, y: 0 } }).reason, "BONE_CYCLE");
    var failRes = B.compensateMove({ bones: zeroScale, boneIndex: 1, delta: { x: 1, y: 1 } });
    ok("失败也返回 limitations（不静默）", Array.isArray(failRes.limitations) && failRes.limitations.length > 0);
    ok("失败也返回 issues 数组", Array.isArray(failRes.issues));
    eq("失败不返回 changes（调用方不能误写）", failRes.changes, undefined);
  })();

  section("P2-03·compensatePivot 轴心重定位");
  (function () {
    var rig = chainRig();
    var w0 = B.boneChainWorlds(rig).worlds;
    var target = { x: w0[1].tx + 12.5, y: w0[1].ty - 7.25 };
    var res = B.compensatePivot({ bones: rig, boneIndex: 1, targetWorld: target, mode: "children" });
    ok("compensatePivot：ok", res.ok === true);
    near("轴心落到目标世界点（x）", res.pivotAfter.x, target.x, 1e-9);
    near("轴心落到目标世界点（y）", res.pivotAfter.y, target.y, 1e-9);
    near("worldDelta 与目标一致（x）", res.worldDelta.x, 12.5, 1e-9);
    near("worldDelta 与目标一致（y）", res.worldDelta.y, -7.25, 1e-9);
    near("世界位移误差 ≈ 0", res.diagnostics.worldDeltaError, 0, 1e-9);
    ok("子骨世界位置不变", worldErrOf(res.changes) <= 1e-9);
    var invPar = B.invert(w0[0]);
    var expDelta = B.applyVec(invPar, 12.5, -7.25);
    near("delta = P⁻¹·Δworld（x）", res.delta.x, expDelta.x, 1e-12);
    near("delta = P⁻¹·Δworld（y）", res.delta.y, expDelta.y, 1e-12);
    near("选中骨 rotation 不变（未进 changes）", rig[1].rotation, 20, 1e-12);
    var rootRes = B.compensatePivot({ bones: chainRig(), boneIndex: 0, worldDelta: { x: 3, y: -4 }, mode: "children" });
    ok("根骨：ok", rootRes.ok === true);
    near("根骨 delta = 世界位移（x）", rootRes.delta.x, 3, 1e-12);
    near("根骨 delta = 世界位移（y）", rootRes.delta.y, -4, 1e-12);
    ok("根骨：子骨世界不变", worldErrOf(rootRes.changes) <= 1e-12);
    var pivAtt = B.compensatePivot({
      bones: chainRig(), boneIndex: 1, worldDelta: { x: -6, y: 2.5 }, mode: "childrenAndAttachments",
      attachments: [{ index: 21, boneIndex: 1, name: "a", type: "region", x: 1.5, y: -2.5 }],
    });
    eq("轴心重定位 + 附件补偿", pivAtt.attachmentChanges.length, 1);
    near("附件世界不变（数值）", pivAtt.attachmentChanges[0].error, 0, 1e-12);
    /* 不可解 */
    var singParent = [mkBone("p", -1, { scaleX: 0, scaleY: 1 }), mkBone("s", 0, { x: 1, y: 1 }), mkBone("k", 1, { x: 2, y: 2 })];
    var rp = B.compensatePivot({ bones: singParent, boneIndex: 1, worldDelta: { x: 5, y: 0 } });
    eq("父级奇异 → PARENT_SINGULAR", rp.reason, "PARENT_SINGULAR");
    eq("父级奇异带契约码", rp.code, "EDIT_PARENT_SINGULAR");
    eq("缺 targetWorld/worldDelta → POINT_INVALID", B.compensatePivot({ bones: chainRig(), boneIndex: 1 }).reason, "POINT_INVALID");
    eq("targetWorld NaN → POINT_INVALID", B.compensatePivot({ bones: chainRig(), boneIndex: 1, targetWorld: { x: NaN, y: 0 } }).reason, "POINT_INVALID");
    eq("compensatePivot 也做 boneIndex 校验", B.compensatePivot({ bones: chainRig(), boneIndex: -1, worldDelta: { x: 1, y: 1 } }).reason, "BONE_INDEX_INVALID");
    var pivZero = B.compensatePivot({ bones: chainRig(), boneIndex: 1, worldDelta: { x: 0, y: 0 }, mode: "childrenAndAttachments" });
    ok("轴心重定位 delta=0：ok", pivZero.ok === true);
    eq("轴心重定位 delta=0：零改动", pivZero.changes.length, 0);
    /* 入参不变 */
    var rigP = chainRig();
    var beforeP = cloneBones(rigP);
    B.compensatePivot({ bones: rigP, boneIndex: 1, worldDelta: { x: 4, y: 4 } });
    eq("compensatePivot 入参 mid.x 未变", rigP[1].x, beforeP[1].x);
    eq("compensatePivot 入参 c1.y 未变", rigP[2].y, beforeP[2].y);
    ok("P2-03 新导出齐备", typeof B.compensateMove === "function" && typeof B.compensatePivot === "function" && typeof B.boneChainWorlds === "function" && typeof B.boneLocalMatrix === "function" && typeof B.localDeltaOfWorld === "function");
  })();

  global.__selftestBoneEditResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
