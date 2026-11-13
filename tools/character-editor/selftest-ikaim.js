/*
 * selftest-ikaim.js —— ik-aim.js 纯函数自检
 * 依赖：ik-aim.js（globalThis.SpineIkAim）、可选 spine-core（改名/重父级后官方可加载性）。
 * 输出：globalThis.__selftestIkAimResult = {passed, failed, total, cases, failures, notes}
 */
(function (global) {
  "use strict";

  var result = { passed: 0, failed: 0, total: 0, skipped: 0, cases: {}, failures: [], notes: [], startedAt: new Date().toISOString() };
  var currentCase = "(global)";
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
    result.failures.push({ case: currentCase, name: name, expected: expected === undefined ? null : expected, actual: actual === undefined ? null : actual, detail: detail || "" });
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
    return record(typeof actual === "number" && Math.abs(actual - expected) <= t, name, expected, actual, "tol=" + t);
  }
  function deepEq(name, actual, expected) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    return record(a === b, name, b, a);
  }
  function deepPair(name, a1, a2, e1, e2) {
    return record(a1 === e1 && a2 === e2, name, [e1, e2], [a1, a2]);
  }
  function section(name) {
    currentCase = name;
  }
  function snap(v) {
    return JSON.stringify(v);
  }
  function codeOf(res) {
    return res && res.issues && res.issues.length ? res.issues[0].code : null;
  }
  function issueHas(res, code) {
    return !!(res && res.issues && res.issues.some(function (i) { return i.code === code; }));
  }

  var nodeMods = null;
  if (typeof process !== "undefined" && process.versions && process.versions.node && typeof process.getBuiltinModule === "function") {
    try { nodeMods = { fs: process.getBuiltinModule("node:fs"), module: process.getBuiltinModule("node:module"), cwd: process.cwd() }; } catch (e) { nodeMods = null; }
  }
  var IK = global.SpineIkAim;
  var core = global.SpineCore;
  if (nodeMods) {
    var cwd = nodeMods.cwd.replace(/[\\/]+$/, "");
    var req = null;
    try { req = nodeMods.module.createRequire(cwd + "/selftest-ikaim-loader.js"); } catch (e) { req = null; }
    if (req) {
      if (!IK) { try { req(cwd + "/tools/character-editor/ik-aim.js"); IK = global.SpineIkAim; } catch (e) { IK = null; } }
      if (!core) { try { req(cwd + "/tools/character-editor/spine-core.js"); core = global.SpineCore; } catch (e) { core = null; } }
    }
  }
  if (!IK) {
    record(false, "ik-aim.js 已加载（globalThis.SpineIkAim）", "存在", null);
    global.__selftestIkAimResult = result;
    return;
  }

  /* ---------------- 夹具 ---------------- */
  var IDENT = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  function chainOpts(opts) {
    var o = opts || {};
    var parent = Object.assign({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 }, o.parent || {});
    var child = Object.assign({ x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, length: 100 }, o.child || {});
    var parentWorld = Object.assign({}, IDENT, { tx: parent.x, ty: parent.y }, o.parentWorld || {});
    var grandWorld = Object.assign({}, IDENT, o.grandWorld || {});
    return Object.assign({ parent: parent, child: child, parentWorld: parentWorld, grandWorld: grandWorld }, o.rest || {});
  }

  /* ------------------------------------------------------------------ */
  section("ik-aim / 矩阵工具");
  var m0 = IK.localMatrix({ x: 3, y: 4, rotation: 0, scaleX: 2, scaleY: 1, shearX: 0, shearY: 0 });
  near("localMatrix θ=0 a=2", m0.a, 2, 1e-12);
  near("localMatrix θ=0 b=0", m0.b, 0, 1e-12);
  near("localMatrix θ=0 c=0", m0.c, 0, 1e-12);
  near("localMatrix θ=0 d=1", m0.d, 1, 1e-12);
  deepEq("localMatrix 平移", [m0.tx, m0.ty], [3, 4]);
  var m90 = IK.localMatrix({ rotation: 90, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 });
  near("localMatrix θ=90 → a≈0", m90.a, 0, 1e-12);
  near("localMatrix θ=90 → b≈1", m90.b, 1, 1e-12);
  var moved = IK.applyMat({ a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 }, 1, 2);
  deepEq("applyMat 平移", [moved.x, moved.y], [11, 22]);
  var back = IK.invApply({ a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 }, 11, 22);
  deepEq("invApply 往返", [back.x, back.y], [1, 2]);
  eq("invApply 奇异矩阵 → null", IK.invApply({ a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 }, 1, 1), null);
  var mul = IK.mulMat({ a: 2, b: 0, c: 0, d: 2, tx: 5, ty: 0 }, { a: 1, b: 0, c: 0, d: 1, tx: 1, ty: 0 });
  deepEq("mulMat 缩放+平移", [mul.a, mul.tx, mul.ty], [2, 7, 0]);
  var wChain = IK.setupWorldOf({ bones: [{ name: "root", x: 10, y: 0, rotation: 0, length: 10 }, { name: "a", parent: "root", x: 5, y: 0, rotation: 0 }] }, "a");
  near("setupWorldOf 链式平移", wChain.tx, 15, 1e-9);
  ok("setupWorldOf 未知骨 → null", IK.setupWorldOf({ bones: [] }, "nope") === null);

  /* ------------------------------------------------------------------ */
  section("ik-aim / solveTwoBone");
  var s1 = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: 150, y: 0 } } }));
  ok("可达目标 ok", s1.ok === true, JSON.stringify(s1.issues));
  near("tip 命中目标 x", s1.tipWorld.x, 150, 1e-6);
  near("tip 命中目标 y", s1.tipWorld.y, 0, 1e-6);
  eq("rotations 长度 2", s1.rotations.length, 2);
  eq("outOfReach=false", s1.outOfReach, false);
  near("链长 l1=100", s1.chainLengths[0], 100, 1e-9);
  near("链长 l2=100", s1.chainLengths[1], 100, 1e-9);
  ok("deltaDeg 在 ±180 内", Math.abs(s1.deltaDeg[0]) <= 180 && Math.abs(s1.deltaDeg[1]) <= 180);

  var sQ1 = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: 80, y: 60 } } }));
  near("第一象限命中 x", sQ1.tipWorld.x, 80, 1e-6);
  near("第一象限命中 y", sQ1.tipWorld.y, 60, 1e-6);
  var sQ2 = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: -40, y: 70 } } }));
  near("第二象限命中 x", sQ2.tipWorld.x, -40, 1e-6);
  near("第二象限命中 y", sQ2.tipWorld.y, 70, 1e-6);
  var sQ3 = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: -60, y: -50 } } }));
  near("第三象限命中 x", sQ3.tipWorld.x, -60, 1e-6);
  near("第三象限命中 y", sQ3.tipWorld.y, -50, 1e-6);
  var sQ4 = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: 30, y: -90 } } }));
  near("第四象限命中 x", sQ4.tipWorld.x, 30, 1e-6);
  near("第四象限命中 y", sQ4.tipWorld.y, -90, 1e-6);

  var sPos = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: 30, y: -90 }, bendPositive: true } }));
  var sNeg = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: 30, y: -90 }, bendPositive: false } }));
  ok("bendPositive 影响子骨角符号", Math.sign(sPos.rotations[1]) !== Math.sign(sNeg.rotations[1]) || Math.abs(sPos.rotations[1] - sNeg.rotations[1]) > 1);
  near("bendPositive=false 仍命中 x", sNeg.tipWorld.x, 30, 1e-6);
  near("bendPositive=false 仍命中 y", sNeg.tipWorld.y, -90, 1e-6);

  var sMix0 = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: 80, y: 60 }, mix: 0 } }));
  near("mix=0 父骨角不变", sMix0.rotations[0], 0, 1e-12);
  near("mix=0 子骨角不变", sMix0.rotations[1], 0, 1e-12);
  near("mix=0 delta 为 0", sMix0.deltaDeg[0], 0, 1e-12);
  var sMix1 = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: 80, y: 60 }, mix: 1 } }));
  var sMixHalf = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: 80, y: 60 }, mix: 0.5 } }));
  near("mix=0.5 父角 = 全量一半", sMixHalf.rotations[0], sMix1.rotations[0] * 0.5, 1e-9);
  near("mix=0.5 子角 = 全量一半", sMixHalf.rotations[1], sMix1.rotations[1] * 0.5, 1e-9);

  var sFar = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: 500, y: 0 } } }));
  ok("够不到目标时 ok 且 outOfReach=true", sFar.ok === true && sFar.outOfReach === true);
  ok("够不到给 IK_TARGET_OUT_OF_REACH", issueHas(sFar, "IK_TARGET_OUT_OF_REACH"));
  near("够不到时 tip 在 x 轴链长处", sFar.tipWorld.x, 200, 1e-6);
  var sStretch = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: 500, y: 0 }, stretch: true } }));
  ok("stretch 时给出拉伸系数 > 1", sStretch.stretchScale > 1, "k=" + sStretch.stretchScale);
  near("stretch 系数 = 距离/(l1+l2)", sStretch.stretchScale, 500 / 200, 1e-9);
  var sFold = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: 0, y: 0 } } }));
  ok("目标在父原点（折叠极限）可解", sFold.ok === true);
  near("折叠极限 tip 回到父原点", Math.hypot(sFold.tipWorld.x, sFold.tipWorld.y), 0, 1e-6);

  var sNonUniform = IK.solveTwoBone(chainOpts({ parent: { scaleX: 2, scaleY: 1 }, rest: { targetWorld: { x: 150, y: 0 } } }));
  eq("非均匀父缩放 → NON_UNIFORM_PARENT", codeOf(sNonUniform), "NON_UNIFORM_PARENT");
  var sZeroLen = IK.solveTwoBone(chainOpts({ child: { length: 0 }, rest: { targetWorld: { x: 150, y: 0 } } }));
  eq("子骨零长 → CHILD_LENGTH_ZERO", codeOf(sZeroLen), "CHILD_LENGTH_ZERO");
  eq("缺矩阵 → MATRIX_REQUIRED", codeOf(IK.solveTwoBone({ parent: {}, child: { length: 1 }, targetWorld: { x: 1, y: 1 } })), "MATRIX_REQUIRED");
  eq("目标非法 → TARGET_INVALID", codeOf(IK.solveTwoBone(Object.assign(chainOpts({}), { targetWorld: { x: NaN, y: 0 } }))), "TARGET_INVALID");
  eq("缺骨 → BONES_REQUIRED", codeOf(IK.solveTwoBone({})), "BONES_REQUIRED");
  var sDegen = IK.solveTwoBone(chainOpts({ child: { x: 0, y: 0 }, rest: { targetWorld: { x: 100, y: 0 } } }));
  eq("父子原点重合 → DEGENERATE_CHAIN", codeOf(sDegen), "DEGENERATE_CHAIN");
  var sSingular = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: 150, y: 0 }, grandWorld: { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 } } }));
  eq("祖父矩阵奇异 → SINGULAR_GRAND_PARENT", codeOf(sSingular), "SINGULAR_GRAND_PARENT");
  var sNegScale = IK.solveTwoBone(chainOpts({ parent: { scaleX: -1, scaleY: -1 }, rest: { targetWorld: { x: 150, y: 0 } } }));
  ok("父骨负缩放仍可解", sNegScale.ok === true);
  var sSoft = IK.solveTwoBone(chainOpts({ rest: { targetWorld: { x: 180, y: 10 }, softness: 0.5 } }));
  ok("softness>0 仍返回 ok", sSoft.ok === true);
  var sInputs = chainOpts({ rest: { targetWorld: { x: 80, y: 60 } } });
  var sSnap = snap(sInputs);
  IK.solveTwoBone(sInputs);
  ok("solveTwoBone 不改入参", snap(sInputs) === sSnap);
  var sAim = IK.solveTwoBone(chainOpts({ child: { x: 50, y: 30, length: 80 }, rest: { targetWorld: { x: 100, y: 80 } } }));
  near("子骨有 y 偏移时仍命中 x", sAim.tipWorld.x, 100, 1e-6);
  near("子骨有 y 偏移时仍命中 y", sAim.tipWorld.y, 80, 1e-6);
  var sOffsetParent = IK.solveTwoBone(chainOpts({ parent: { x: 20, y: 10 }, rest: { targetWorld: { x: 170, y: 10 } } }));
  near("父骨有局部偏移时命中 x", sOffsetParent.tipWorld.x, 170, 1e-6);
  near("父骨有局部偏移时命中 y", sOffsetParent.tipWorld.y, 10, 1e-6);
  var fk = IK.solveChainFABRIK({});
  ok("FABRIK 显式 NOT_IMPLEMENTED", fk.ok === false && fk.reason === "NOT_IMPLEMENTED");

  /* ------------------------------------------------------------------ */
  section("ik-aim / 骨架结构操作");
  function model() {
    return {
      skeleton: { spine: "4.2.22" },
      bones: [
        { name: "root" },
        { name: "torso", parent: "root", x: 0, y: 10, rotation: 5, length: 40 },
        { name: "arm_l", parent: "torso", x: 40, y: 0, rotation: 20, length: 30 },
        { name: "hand_l", parent: "arm_l", x: 30, y: 0, rotation: -10, length: 12 },
        { name: "arm_r", parent: "torso", x: -40, y: 0, rotation: -20, length: 30 },
      ],
      slots: [{ name: "s1", bone: "arm_l", attachment: "a1" }, { name: "s2", bone: "hand_l" }],
      ik: [{ name: "ik1", bones: ["arm_l", "hand_l"], target: "torso", mix: 1 }],
      transform: [{ name: "tc1", bones: ["arm_r"], target: "torso", mixRotate: 0.5 }],
      path: [{ name: "pc1", bones: ["arm_r"], target: "s1" }],
      skins: [{ name: "default", attachments: { s1: { a1: { type: "region", path: "r1", width: 10, height: 10 } } } }],
      animations: { idle: { bones: { arm_l: { rotate: [{ time: 0, value: 1 }] } } } },
    };
  }
  var M0 = model();
  var M0snap = snap(M0);

  var created = IK.createBone(M0, { name: "tail", parent: "torso", x: 10, y: -5, rotation: 15, length: 25 });
  ok("createBone ok", created.ok === true, JSON.stringify(created.issues));
  eq("新骨追加在末尾", created.value.bones[created.value.bones.length - 1].name, "tail");
  eq("新骨 parent 正确", created.value.bones[created.value.bones.length - 1].parent, "torso");
  eq("新骨索引返回", created.index, 5);
  ok("createBone 不改入参", snap(M0) === M0snap);
  eq("重名 → BONE_NAME_DUPLICATE", codeOf(IK.createBone(M0, { name: "torso" })), "BONE_NAME_DUPLICATE");
  eq("空名 → BONE_NAME_REQUIRED", codeOf(IK.createBone(M0, { name: "" })), "BONE_NAME_REQUIRED");
  eq("父骨不存在 → BONE_PARENT_MISSING", codeOf(IK.createBone(M0, { name: "x", parent: "ghost" })), "BONE_PARENT_MISSING");
  eq("非有限字段 → BONE_FIELD_NUMBER", codeOf(IK.createBone(M0, { name: "x", x: NaN })), "BONE_FIELD_NUMBER");
  eq("未知 inherit → BONE_INHERIT", codeOf(IK.createBone(M0, { name: "x", inherit: "wobble" })), "BONE_INHERIT");
  ok("合法 inherit 通过", IK.createBone(M0, { name: "x", inherit: "noScale" }).ok === true);
  ok("未知字段保留（模型级）", IK.createBone(Object.assign(model(), { customField: 7 }), { name: "z" }).value.customField === 7);

  var renamed = IK.renameBone(M0, { from: "torso", to: "spine" });
  ok("renameBone ok", renamed.ok === true);
  eq("骨名已改", renamed.value.bones[1].name, "spine");
  eq("子骨 parent 同步", renamed.value.bones[2].parent, "spine");
  eq("远端子骨 parent 保持", renamed.value.bones[3].parent, "arm_l");
  eq("slot.bone 同步", renamed.value.slots[0].bone, "arm_l");
  eq("ik.bones 同步（父）", renamed.value.ik[0].bones[0], "arm_l");
  eq("ik.target 同步", renamed.value.ik[0].target, "spine");
  eq("transform.target 同步", renamed.value.transform[0].target, "spine");
  eq("path.target（槽名）不随骨改名而改", renamed.value.path[0].target, "s1");
  ok("updated 列出路径", renamed.updated.indexOf("bones[2].parent") >= 0 && renamed.updated.indexOf("ik.ik1.target") >= 0);
  deepEq("skins 顶点索引未被改名影响", renamed.value.skins, M0.skins);
  ok("renameBone 不改入参", snap(M0) === M0snap);
  eq("改名到已存在骨 → BONE_NAME_DUPLICATE", codeOf(IK.renameBone(M0, { from: "torso", to: "arm_l" })), "BONE_NAME_DUPLICATE");
  eq("改名源不存在 → BONE_NOT_FOUND", codeOf(IK.renameBone(M0, { from: "ghost", to: "x" })), "BONE_NOT_FOUND");
  eq("改名目标为空 → RENAME_TO_REQUIRED", codeOf(IK.renameBone(M0, { from: "torso", to: "" })), "RENAME_TO_REQUIRED");
  var renamedChain = IK.renameBone(M0, { from: "arm_l", to: "arm_l2" });
  eq("改名后 ik.bones[0] 同步", renamedChain.value.ik[0].bones[0], "arm_l2");
  eq("改名后 slots 同步", renamedChain.value.slots[0].bone, "arm_l2");
  eq("改名后 transform.bones 同步", renamedChain.value.transform[0].bones[0], "arm_r");
  eq("改名后 path.bones 同步", renamedChain.value.path[0].bones[0], "arm_r");
  ok("改名后动画轨键名同步迁移（不再需手工处理）", renamedChain.value.animations.idle.bones.arm_l2 !== undefined && renamedChain.value.animations.idle.bones.arm_l === undefined);

  /* ------------------------------------------------------------------ */
  section("ik-aim / renameBone 迁移动画轨（T30）");
  function animModel() {
    return {
      bones: [{ name: "root" }, { name: "a", parent: "root", length: 10 }, { name: "b", parent: "root", length: 10 }],
      slots: [{ name: "s1", bone: "a", attachment: "r1" }],
      ik: [{ name: "ik1", bones: ["a"], target: "b" }],
      transform: [{ name: "tc1", bones: ["a"], target: "b" }],
      path: [{ name: "pc1", bones: ["a"], target: "s1" }],
      skins: [{ name: "default", attachments: { s1: { r1: { type: "region", path: "r1", width: 4, height: 4 } } } }],
      animations: {
        idle: {
          bones: {
            a: { rotate: [{ time: 0, value: 10, tag: "src" }, { time: 0.5, value: 20 }], translate: [{ time: 0, x: 5, y: 6 }], shearYOnly: 7 },
          },
        },
        walk: { bones: { a: { rotate: [{ time: 1, value: 30 }] } } },
      },
      license: { keep: true },
    };
  }
  var AM = animModel();
  var AMsnap = snap(AM);
  var mv = IK.renameBone(AM, { from: "a", to: "a2" });
  ok("renameBone 迁移 ok", mv.ok === true);
  ok("单动画骨轨已改名", mv.value.animations.idle.bones.a2 !== undefined && mv.value.animations.idle.bones.a === undefined);
  ok("多动画都迁移", mv.value.animations.walk.bones.a2 !== undefined && mv.value.animations.walk.bones.a === undefined);
  eq("轨道内容保真（rotate[0].value）", mv.value.animations.idle.bones.a2.rotate[0].value, 10);
  eq("轨道未知字段保真（key 内 tag）", mv.value.animations.idle.bones.a2.rotate[0].tag, "src");
  eq("骨袋未知字段保真（shearYOnly）", mv.value.animations.idle.bones.a2.shearYOnly, 7);
  ok("updated 列出每个迁移路径", mv.updated.indexOf("animations.idle.bones.a2") >= 0 && mv.updated.indexOf("animations.walk.bones.a2") >= 0);
  ok("入参不变", snap(AM) === AMsnap);
  ok("迁移后 validateSkeleton 无 ANIM_BONE_ORPHAN", !issueHas(IK.validateSkeleton(mv.value), "ANIM_BONE_ORPHAN"));
  ok("迁移后 validateSkeleton 仍 ok", IK.validateSkeleton(mv.value).ok === true);
  eq("非动画字段保留", mv.value.license.keep, true);

  /* 合并：目标已有轨道 */
  function mergeModel() {
    var m = animModel();
    /* 目标骨名 b 不存在于 bones[]，但存在孤儿动画轨 → 正是合并场景（否则会被 BONE_NAME_DUPLICATE 拒绝） */
    m.bones = m.bones.filter(function (x) { return x.name !== "b"; });
    m.ik = [{ name: "ik1", bones: ["a"], target: "a" }];
    m.transform = [{ name: "tc1", bones: ["a"], target: "a" }];
    m.path = [{ name: "pc1", bones: ["a"], target: "s1" }];
    m.animations.idle.bones.b = {
      rotate: [{ time: 0, value: -5, keep: 1 }, { time: 0.75, value: 99 }],
      translate: [{ time: 0, x: -1, y: -2 }],
      scale: [{ time: 0, x: 2, y: 2 }],
      customTgt: "yes",
    };
    m.animations.idle.bones.a.customSrcOnly = "ok";
    m.animations.idle.bones.a.customTgt = "no";
    return m;
  }
  var MG = mergeModel();
  var mergeSnap = snap(MG);
  var merged = IK.renameBone(MG, { from: "a", to: "b" });
  ok("合并改名 ok", merged.ok === true, JSON.stringify(merged.issues.slice(0, 2)));
  var mb = merged.value.animations.idle.bones.b;
  eq("rotate 合并后取时间并集", JSON.stringify(mb.rotate.map(function (k) { return k.time; })), JSON.stringify([0, 0.5, 0.75]));
  eq("同刻 rotate 来源值覆盖目标值", mb.rotate[0].value, 10);
  eq("同刻 rotate 目标未知字段保留", mb.rotate[0].keep, 1);
  eq("translate 同刻合并（来源值覆盖、目标未知字段保留）", mb.translate.length, 1);
  deepPair("translate 同刻值来自来源", mb.translate[0].x, mb.translate[0].y, 5, 6);
  eq("scale 只来自目标（来源无）", mb.scale.length, 1);
  eq("未知字段冲突保留目标值", mb.customTgt, "yes");
  eq("来源未知字段带入", mb.customSrcOnly, "ok");
  ok("报 MERGED_ANIMATION_TRACK", issueHas(merged, "MERGED_ANIMATION_TRACK"));
  eq("mergedAnimationKeys 计数（rotate@0 + translate@0 两个同刻）", merged.mergedAnimationKeys, 2);
  ok("入参不变（合并）", snap(MG) === mergeSnap);
  ok("合并后无孤儿", !issueHas(IK.validateSkeleton(merged.value), "ANIM_BONE_ORPHAN"));
  ok("合并后 validateSkeleton 仍 ok", IK.validateSkeleton(merged.value).ok === true);
  var fieldConflict = (function () {
    var m = animModel();
    m.bones = m.bones.filter(function (x) { return x.name !== "b"; });
    m.ik = [{ name: "ik1", bones: ["a"], target: "a" }];
    m.transform = [{ name: "tc1", bones: ["a"], target: "a" }];
    m.path = [{ name: "pc1", bones: ["a"], target: "s1" }];
    m.animations.idle.bones.b = { translate: [{ time: 0, x: 1 }], customX: "tgt" };
    m.animations.idle.bones.a.customX = "src";
    return IK.renameBone(m, { from: "a", to: "b" });
  })();
  ok("未知字段冲突 → MERGED_ANIMATION_FIELD_CONFLICT", issueHas(fieldConflict, "MERGED_ANIMATION_FIELD_CONFLICT"));
  eq("未知字段冲突保留目标值", fieldConflict.value.animations.idle.bones.b.customX, "tgt");

  /* ------------------------------------------------------------------ */
  section("ik-aim / path 约束 target 是槽名（T31）");
  function pathModel() {
    return {
      bones: [{ name: "root" }, { name: "b1", parent: "root", length: 10 }, { name: "b2", parent: "b1", length: 10 }],
      slots: [{ name: "s1", bone: "b1" }, { name: "s3", bone: "b2" }],
      ik: [{ name: "ik1", bones: ["b1", "b2"], target: "b2" }],
      transform: [{ name: "tc1", bones: ["b1"], target: "root" }],
      path: [{ name: "pc1", bones: ["b1"], target: "s3" }],
    };
  }
  var PM = pathModel();
  var pmRes = IK.validateSkeleton(PM);
  ok("path target=槽 s3 不再误报（Lead 场景）", pmRes.ok === true, JSON.stringify(pmRes.issues));
  ok("不报 CONSTRAINT_TARGET_MISSING", !issueHas(pmRes, "CONSTRAINT_TARGET_MISSING"));
  ok("不报 CONSTRAINT_TARGET_SLOT_MISSING", !issueHas(pmRes, "CONSTRAINT_TARGET_SLOT_MISSING"));
  var badSlot = pathModel();
  badSlot.path[0].target = "ghostSlot";
  ok("path target 槽不存在 → CONSTRAINT_TARGET_SLOT_MISSING", issueHas(IK.validateSkeleton(badSlot), "CONSTRAINT_TARGET_SLOT_MISSING"));
  ok("槽缺失用槽专属 code（不是骨 code）", !issueHas(IK.validateSkeleton(badSlot), "CONSTRAINT_TARGET_MISSING"));
  eq("槽缺失是 error（ok=false）", IK.validateSkeleton(badSlot).ok, false);
  var boneAsSlot = pathModel();
  boneAsSlot.path[0].target = "root"; /* root 是骨名但不是槽名 */
  ok("path target 指向骨名而非槽 → 仍报槽缺失", issueHas(IK.validateSkeleton(boneAsSlot), "CONSTRAINT_TARGET_SLOT_MISSING"));
  var badIk = pathModel();
  badIk.ik[0].target = "ghostBone";
  ok("ik target 仍按骨校验", issueHas(IK.validateSkeleton(badIk), "CONSTRAINT_TARGET_MISSING"));
  var badTc = pathModel();
  badTc.transform[0].target = "ghostBone";
  ok("transform target 仍按骨校验", issueHas(IK.validateSkeleton(badTc), "CONSTRAINT_TARGET_MISSING"));

  var renamedPath = IK.renameBone(PM, { from: "b1", to: "b1x" });
  ok("renameBone ok", renamedPath.ok === true);
  eq("path.target（槽名）不随骨改名而改", renamedPath.value.path[0].target, "s3");
  deepEq("path.bones 仍更新", renamedPath.value.path[0].bones, ["b1x"]);
  deepEq("ik.bones 更新", renamedPath.value.ik[0].bones, ["b1x", "b2"]);
  deepEq("transform.bones 更新", renamedPath.value.transform[0].bones, ["b1x"]);
  ok("改名后 validateSkeleton 仍 ok", IK.validateSkeleton(renamedPath.value).ok === true);
  var boneNameAsPathTarget = pathModel();
  boneNameAsPathTarget.path[0].target = "b1";
  var renamedBoneTarget = IK.renameBone(boneNameAsPathTarget, { from: "b1", to: "b1x" });
  eq("path.target 恰好等于被改名骨名时也不改（槽语义）", renamedBoneTarget.value.path[0].target, "b1");
  var refsPath = IK.referencesTo(PM, "b1");
  ok("referencesTo 含 path.bones", refsPath.indexOf("path.pc1.bones") >= 0);
  ok("referencesTo 不含 path.target（槽引用）", refsPath.every(function (r) { return r.indexOf("path.pc1.target") < 0; }));

  /* ------------------------------------------------------------------ */
  section("ik-aim / validateSkeleton 动画孤儿检测（T30）");
  var orphanModel = {
    bones: [{ name: "root" }],
    slots: [{ name: "s1", bone: "root" }],
    ik: [{ name: "ik1", bones: ["root"], target: "root" }],
    animations: {
      idle: {
        bones: { ghost: { rotate: [{ time: 0, value: 1 }] } },
        slots: { ghostSlot: { attachment: [{ time: 0, name: null }] } },
        ik: { ghostIk: [] },
        transform: { ghostTc: [] },
        path: { ghostPc: {} },
      },
    },
  };
  var orphanRes = IK.validateSkeleton(orphanModel);
  ok("ANIM_BONE_ORPHAN 抓出", issueHas(orphanRes, "ANIM_BONE_ORPHAN"));
  ok("ANIM_SLOT_ORPHAN 抓出", issueHas(orphanRes, "ANIM_SLOT_ORPHAN"));
  ok("ANIM_CONSTRAINT_ORPHAN 抓出（ik）", orphanRes.issues.some(function (i) { return i.code === "ANIM_CONSTRAINT_ORPHAN" && i.path.indexOf(".ik.") >= 0; }));
  ok("ANIM_CONSTRAINT_ORPHAN 抓出（transform/path）", orphanRes.issues.filter(function (i) { return i.code === "ANIM_CONSTRAINT_ORPHAN"; }).length >= 3);
  eq("孤儿是 warning：ok 仍为 true", orphanRes.ok, true);
  eq("warningCount 统计", orphanRes.warningCount, orphanRes.issues.filter(function (i) { return i.severity === "warning"; }).length);
  ok("孤儿 issue 带动画名与骨名", orphanRes.issues.some(function (i) { return i.code === "ANIM_BONE_ORPHAN" && i.message.indexOf("idle") >= 0 && i.message.indexOf("ghost") >= 0; }));
  var hardError = IK.validateSkeleton({ bones: [{ name: "root" }], slots: [{ name: "s1", bone: "ghost" }], animations: { idle: { bones: { ghost: { rotate: [] } } } } });
  eq("真错误仍使 ok=false", hardError.ok, false);
  ok("警告与错误并存时都列出", hardError.warningCount >= 1 && hardError.issues.some(function (i) { return i.code === "SLOT_BONE_MISSING"; }));
  ok("合法动画不报孤儿", !issueHas(IK.validateSkeleton({ bones: [{ name: "root" }], slots: [{ name: "s1", bone: "root" }], ik: [{ name: "ik1", bones: ["root"], target: "root" }], animations: { idle: { bones: { root: { rotate: [{ time: 0, value: 1 }] } }, slots: { s1: {} }, ik: { ik1: [] } } } }), "ANIM_BONE_ORPHAN"));

  var worldBefore = IK.setupWorldOf(M0, "hand_l");
  var rep = IK.reparentBone(M0, { boneName: "hand_l", newParent: "torso", keepWorld: true });
  ok("reparentBone keepWorld ok", rep.ok === true, JSON.stringify(rep.issues));
  eq("新父已写入", rep.value.bones[3].parent, "torso");
  var worldAfter = IK.setupWorldOf(rep.value, "hand_l");
  var dw = Math.max(
    Math.abs(worldBefore.a - worldAfter.a),
    Math.abs(worldBefore.b - worldAfter.b),
    Math.abs(worldBefore.c - worldAfter.c),
    Math.abs(worldBefore.d - worldAfter.d),
    Math.abs(worldBefore.tx - worldAfter.tx),
    Math.abs(worldBefore.ty - worldAfter.ty)
  );
  near("keepWorld 世界矩阵不变（≤1e-6）", dw, 0, 1e-6);
  eq("返回 requiresAnimationReview", rep.requiresAnimationReview, true);
  ok("reparent 不改入参", snap(M0) === M0snap);
  var repNoWorld = IK.reparentBone(M0, { boneName: "hand_l", newParent: "torso", keepWorld: false });
  eq("keepWorld=false 只改 parent", repNoWorld.value.bones[3].parent, "torso");
  eq("keepWorld=false 局部值不变", repNoWorld.value.bones[3].x, 30);
  eq("自挂 → REPARENT_SELF", codeOf(IK.reparentBone(M0, { boneName: "torso", newParent: "torso" })), "REPARENT_SELF");
  eq("挂到后代 → REPARENT_CYCLE", codeOf(IK.reparentBone(M0, { boneName: "torso", newParent: "hand_l" })), "REPARENT_CYCLE");
  eq("新父不存在 → BONE_PARENT_MISSING", codeOf(IK.reparentBone(M0, { boneName: "hand_l", newParent: "ghost" })), "BONE_PARENT_MISSING");
  eq("骨不存在 → BONE_NOT_FOUND", codeOf(IK.reparentBone(M0, { boneName: "ghost", newParent: "torso" })), "BONE_NOT_FOUND");
  ok("挂到根（newParent=null）可用", IK.reparentBone(M0, { boneName: "hand_l", newParent: null, keepWorld: true }).ok === true);

  var refs = IK.referencesTo(M0, "arm_l");
  ok("referencesTo 抓到槽/约束/动画引用", refs.indexOf("slots[0].bone") >= 0 && refs.indexOf("animations.idle.bones.arm_l") >= 0);
  var delRef = IK.deleteBone(M0, { name: "arm_l" });
  eq("删被引用骨 → DELETE_BONE_REFERENCED", codeOf(delRef), "DELETE_BONE_REFERENCED");
  ok("拒绝时给出引用清单", Array.isArray(delRef.references) && delRef.references.length >= 2);
  var delChild = IK.deleteBone(M0, { name: "torso" });
  eq("删有子骨的骨 → 仍拒绝（列出子骨引用）", codeOf(delChild), "DELETE_BONE_REFERENCED");
  ok("子骨引用出现在清单", delChild.references.some(function (r) { return r.indexOf("parent") >= 0; }));
  var delFreeModel = { bones: [{ name: "root" }, { name: "free" }], slots: [], skins: [{ name: "default", attachments: {} }], animations: {} };
  var delOk = IK.deleteBone(delFreeModel, { name: "free" });
  ok("未被引用且无加权网格 → 允许删除", delOk.ok === true && delOk.value.bones.length === 1);
  eq("返回 removedIndex", delOk.removedIndex, 1);
  var weightedModel = {
    bones: [{ name: "root" }, { name: "free" }],
    slots: [],
    skins: [{ name: "default", attachments: { s: { m: { type: "mesh", uvs: [0, 0, 1, 0, 1, 1], vertices: [1, 0, 0, 0, 1, 1, 10, 0, 1, 2, 1, 0, 0, 0.5, 2, 10, 10, 0.5], triangles: [0, 1, 2] } } } }],
    animations: {},
  };
  ok("hasWeightedVertices 识别加权网格", IK.hasWeightedVertices(weightedModel) === true);
  var delWeighted = IK.deleteBone(weightedModel, { name: "free" });
  eq("有加权网格 → DELETE_REQUIRES_WEIGHT_REMAP", codeOf(delWeighted), "DELETE_REQUIRES_WEIGHT_REMAP");
  ok("刚体 mesh 不误判", IK.hasWeightedVertices({ skins: [{ name: "d", attachments: { s: { m: { type: "mesh", uvs: [0, 0, 1, 0], vertices: [0, 0, 1, 1], triangles: [0, 1] } } } }] }) === false);

  var vClean = IK.validateSkeleton(M0);
  ok("validateSkeleton 干净模型 ok", vClean.ok === true, JSON.stringify(vClean.issues));
  ok("槽引用缺失骨被抓", issueHas(IK.validateSkeleton({ bones: [{ name: "root" }], slots: [{ name: "s", bone: "ghost" }] }), "SLOT_BONE_MISSING"));
  ok("重名被抓", issueHas(IK.validateSkeleton({ bones: [{ name: "a" }, { name: "a" }] }), "BONE_NAME_DUPLICATE"));
  ok("父骨缺失被抓", issueHas(IK.validateSkeleton({ bones: [{ name: "a", parent: "ghost" }] }), "BONE_PARENT_MISSING"));
  ok("环被抓", issueHas(IK.validateSkeleton({ bones: [{ name: "a", parent: "b" }, { name: "b", parent: "a" }] }), "BONE_CYCLE"));
  ok("IK 链非父子被抓", issueHas(IK.validateSkeleton({ bones: [{ name: "a" }, { name: "b", parent: "c" }, { name: "c", parent: "a" }], ik: [{ name: "ik1", bones: ["a", "b"], target: "a" }] }), "IK_CHAIN_NOT_PARENT"));
  ok("约束 target 缺失被抓", issueHas(IK.validateSkeleton({ bones: [{ name: "a" }], ik: [{ name: "ik1", bones: ["a"], target: "ghost" }] }), "CONSTRAINT_TARGET_MISSING"));
  ok("IK 缺 bones 被抓", issueHas(IK.validateSkeleton({ bones: [{ name: "a" }], ik: [{ name: "ik1", target: "a" }] }), "IK_BONES_REQUIRED"));
  ok("对象键形式的约束也能校验", issueHas(IK.validateSkeleton({ bones: [{ name: "a" }], ik: { ik1: { bones: ["a"], target: "ghost" } } }), "CONSTRAINT_TARGET_MISSING"));
  ok("非模型 → MODEL_INVALID", issueHas(IK.validateSkeleton({}), "MODEL_INVALID"));
  ok("createBone 后 validateSkeleton 仍 ok", IK.validateSkeleton(created.value).ok === true);
  ok("renameBone 后 validateSkeleton 仍 ok", IK.validateSkeleton(renamed.value).ok === true);
  ok("reparentBone(keepWorld) 会破坏 IK 链并被抓出", issueHas(IK.validateSkeleton(rep.value), "IK_CHAIN_NOT_PARENT"));
  var repSafe = IK.reparentBone(M0, { boneName: "arm_r", newParent: "root", keepWorld: true });
  ok("reparent 非 IK 链骨后 validateSkeleton 仍 ok", repSafe.ok === true && IK.validateSkeleton(repSafe.value).ok === true);

  /* 官方可加载性（若 spine-core 可用） */
  if (core) {
    var atlasRes = core.parseAtlas("tex.png\nsize: 64, 64\nr1\nbounds: 0, 0, 16, 16\n");
    if (atlasRes.ok) {
      var parseRenamed = core.parseModel(renamed.value, atlasRes.value, { skin: "default" });
      ok("改名后模型可被 spine-core 解析（引用一致）", parseRenamed.ok === true, JSON.stringify((parseRenamed.issues || []).slice(0, 2)));
      ok(
        "解析态骨索引已更新",
        parseRenamed.ok === true && parseRenamed.value.boneIndex.get("spine") !== undefined && parseRenamed.value.boneIndex.get("torso") === undefined
      );
      var parseCreated = core.parseModel(created.value, atlasRes.value, { skin: "default" });
      ok("新建骨后模型可被 spine-core 解析", parseCreated.ok === true, JSON.stringify((parseCreated.issues || []).slice(0, 2)));
    } else {
      result.skipped++;
      result.notes.push({ name: "官方可加载性", detail: "atlas 解析失败，跳过" });
    }
  } else {
    result.skipped++;
    result.notes.push({ name: "官方可加载性", detail: "SpineCore 未加载，跳过" });
  }

  global.__selftestIkAimResult = result;
  if (typeof window !== "undefined") window.__selftestIkAimResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);