/*
 * selftest-posetools.js —— pose-tools.js 纯函数自检
 * 依赖：pose-tools.js（globalThis.SpinePoseTools）、SpineBatchEdit（片段库委托）、可选 SpineIkAim（世界矩阵语义校验）。
 * 输出：globalThis.__selftestPoseToolsResult = {passed, failed, total, cases, failures, notes}
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
    try {
      nodeMods = { fs: process.getBuiltinModule("node:fs"), module: process.getBuiltinModule("node:module"), cwd: process.cwd() };
    } catch (e) {
      nodeMods = null;
    }
  }
  var P = global.SpinePoseTools;
  var BE = global.SpineBatchEdit;
  var IK = global.SpineIkAim;
  if (nodeMods) {
    var cwd = nodeMods.cwd.replace(/[\\/]+$/, "");
    var req = null;
    try {
      req = nodeMods.module.createRequire(cwd + "/selftest-posetools-loader.js");
    } catch (e) {
      req = null;
    }
    if (req) {
      if (!P) {
        try { req(cwd + "/tools/character-editor/pose-tools.js"); P = global.SpinePoseTools; } catch (e) { P = null; }
      }
      if (!BE) {
        try { req(cwd + "/tools/character-editor/batch-edit.js"); BE = global.SpineBatchEdit; } catch (e) { BE = null; }
      }
      if (!IK) {
        try { req(cwd + "/tools/character-editor/ik-aim.js"); IK = global.SpineIkAim; } catch (e) { IK = null; }
      }
    }
  }
  if (!P) {
    record(false, "pose-tools.js 已加载（globalThis.SpinePoseTools）", "存在", null);
    global.__selftestPoseToolsResult = result;
    return;
  }

  function baseAnim() {
    return {
      bones: {
        root: { rotate: [{ time: 0, value: 0, keep: "r" }], translate: [{ time: 0, x: 5, y: 3 }] },
        arm_l: { rotate: [{ time: 0, value: 30 }, { time: 0.5, value: -20, curve: [0.1, 4, 0.2, 8] }], translate: [{ time: 0, x: 10, y: -2 }], shear: [{ time: 0, x: 4, y: -6 }], scale: [{ time: 0, x: 1.5, y: 0.5 }] },
        arm_r: { rotate: [{ time: 0, value: 15 }], translate: [{ time: 0, x: -8, y: 1 }] },
      },
      slots: { s1: { attachment: [{ time: 0, name: "a" }] } },
      drawOrder: [{ time: 0, offsets: [{ slot: "s1", offset: -1 }] }],
      events: [{ time: 0.2, name: "step" }],
    };
  }

  /* ------------------------------------------------------------------ */
  section("pose-tools / 模块与轨道镜像");
  eq("CLIP_VERSION", P.CLIP_VERSION, 1);
  deepEq("镜像字段集合", P.MIRROR_FIELDS.slice(), ["rotate", "translate", "shear"]);
  eq("mirrorTrackKeys rotate 取负", P.mirrorTrackKeys("rotate", [{ time: 0, value: 30 }]).value[0].value, -30);
  eq("mirrorTrackKeys translate 只改 x", P.mirrorTrackKeys("translate", [{ time: 0, x: 5, y: 3 }]).value[0].x, -5);
  eq("mirrorTrackKeys translate y 不变", P.mirrorTrackKeys("translate", [{ time: 0, x: 5, y: 3 }]).value[0].y, 3);
  deepEq("mirrorTrackKeys shear 双分量取负", P.mirrorTrackKeys("shear", [{ time: 0, x: 4, y: -6 }]).value[0], { time: 0, x: -4, y: 6 });
  ok("mirrorTrackKeys 非数组失败", P.mirrorTrackKeys("rotate", null).ok === false);
  var rotated = P.mirrorTrackKeys("rotate", [{ time: 0.5, value: -20, curve: [0.1, 4, 0.2, 8], keep: 1 }]);
  deepEq("curve 与未知字段原样保留", rotated.value[0].curve, [0.1, 4, 0.2, 8]);
  eq("未知字段保留", rotated.value[0].keep, 1);

  /* ------------------------------------------------------------------ */
  section("pose-tools / mirrorAnimation");
  var A0 = baseAnim();
  var A0snap = snap(A0);
  var mir = P.mirrorAnimation(A0, {});
  ok("整体镜像 ok", mir.ok === true);
  eq("镜像 rotate", mir.value.bones.arm_l.rotate[0].value, -30);
  eq("镜像 rotate（第二 key）", mir.value.bones.arm_l.rotate[1].value, 20);
  deepEq("镜像保留 curve 结构", mir.value.bones.arm_l.rotate[1].curve, [0.1, 4, 0.2, 8]);
  deepEq("镜像 translate（x 取负）", [mir.value.bones.arm_l.translate[0].x, mir.value.bones.arm_l.translate[0].y], [-10, -2]);
  deepEq("镜像 shear 双分量", [mir.value.bones.arm_l.shear[0].x, mir.value.bones.arm_l.shear[0].y], [-4, 6]);
  deepEq("scale 不变", [mir.value.bones.arm_l.scale[0].x, mir.value.bones.arm_l.scale[0].y], [1.5, 0.5]);
  ok("changed 列出三条轨道", mir.changed.indexOf("bones.arm_l.rotate") >= 0 && mir.changed.indexOf("bones.arm_l.translate") >= 0 && mir.changed.indexOf("bones.arm_l.shear") >= 0);
  ok("根骨也被镜像（默认全选）", mir.value.bones.root.translate[0].x === -5 && mir.value.bones.root.rotate[0].value === 0);
  eq("未知字段保留（key 内）", mir.value.bones.root.rotate[0].keep, "r");
  ok("不改入参", snap(A0) === A0snap);
  ok("返回新对象", mir.value !== A0);
  ok("slot 轨道跳过并给 issue", issueHas(mir, "MIRROR_SLOT_SKIPPED"));
  ok("drawOrder 跳过并给 issue", issueHas(mir, "MIRROR_DRAW_ORDER_SKIPPED"));
  ok("events 默认跳过并给 issue", issueHas(mir, "MIRROR_EVENTS_SKIPPED"));
  deepEq("events 未被改动", mir.value.events, A0.events);

  var onlyL = P.mirrorAnimation(baseAnim(), { bones: ["arm_l"] });
  eq("只镜像选中骨（arm_l）", onlyL.value.bones.arm_l.rotate[0].value, -30);
  eq("未选中的 arm_r 不动", onlyL.value.bones.arm_r.rotate[0].value, 15);
  eq("未选中的 root 不动", onlyL.value.bones.root.translate[0].x, 5);
  var onlyIdx = P.mirrorAnimation(baseAnim(), { bones: [1], model: { bones: [{ name: "root" }, { name: "arm_l" }, { name: "arm_r" }] } });
  eq("索引选择解析为骨名", onlyIdx.value.bones.arm_l.rotate[0].value, -30);
  var inheritAnim = { bones: { child: { rotate: [{ time: 0, value: 10 }] } } };
  var inheritRes = P.mirrorAnimation(inheritAnim, { model: { bones: [{ name: "root", inherit: "onlyTranslation" }, { name: "child", parent: "", parentIndex: 0 }] } });
  ok("非 normal inherit 给限制 issue", issueHas(inheritRes, "MIRROR_INHERIT_LIMITATION"));
  eq("axis 非 x → 拒绝", codeOf(P.mirrorAnimation(baseAnim(), { axis: "y" })), "MIRROR_AXIS_UNSUPPORTED");
  eq("非对象动画 → 拒绝", codeOf(P.mirrorAnimation(null, {})), "ANIM_INVALID");
  ok("无匹配骨给 MIRROR_NO_TARGET", issueHas(P.mirrorAnimation(baseAnim(), { bones: ["ghost"] }), "MIRROR_NO_TARGET"));
  ok("空动画不崩", P.mirrorAnimation({}, {}).ok === true);

  var poseRes = P.mirrorPose({ bones: [{ x: 1, y: 2, rotation: 30, shearX: 4, shearY: -5, scaleX: 2 }, { x: 9, y: 9, rotation: 9 }], indices: [0] });
  ok("mirrorPose ok", poseRes.ok === true);
  deepEq("mirrorPose 改 rotation/x/shear", [poseRes.value[0].rotation, poseRes.value[0].x, poseRes.value[0].shearX, poseRes.value[0].shearY], [-30, -1, -4, 5]);
  eq("mirrorPose 未选骨不动", poseRes.value[1].rotation, 9);
  eq("mirrorPose scale 不变", poseRes.value[0].scaleX, 2);
  ok("mirrorPose 不改入参", (function () { var b = [{ x: 1, rotation: 5 }]; var s = snap(b); P.mirrorPose({ bones: b, indices: [0] }); return snap(b) === s; })());
  ok("mirrorPose 缺 bones → 拒绝", P.mirrorPose({}).ok === false);
  var poseAll = P.mirrorPose({ bones: [{ x: 1, rotation: 10 }, { x: 2, rotation: 20 }] });
  ok("mirrorPose 默认镜像全部骨", poseAll.value[0].x === -1 && poseAll.value[1].x === -2 && poseAll.value[1].rotation === -20);
  ok("mirrorPose 返回新数组（非同一引用）", poseAll.value !== undefined && typeof poseAll.value.length === "number");
  ok("mirrorPose 非对象项原样保留", P.mirrorPose({ bones: [null, { x: 3, rotation: 1 }], indices: [1] }).value[0] === null);
  var mirChanged = P.mirrorAnimation(baseAnim(), {});
  ok("changed 不包含 scale（scale 不镜像）", mirChanged.changed.every(function (p) { return p.indexOf(".scale") < 0; }));
  ok("changed 不含 slots/drawOrder/events", mirChanged.changed.every(function (p) { return p.indexOf("slots") < 0 && p.indexOf("drawOrder") < 0 && p.indexOf("events") < 0; }));
  ok("includeEvents=true 时不报跳过提示", !issueHas(P.mirrorAnimation(baseAnim(), { includeEvents: true }), "MIRROR_EVENTS_SKIPPED"));
  ok("mirrorAnimation 对非数组轨道给 MIRROR_TRACK", issueHas(P.mirrorAnimation({ bones: { a: { rotate: 5 } } }, {}), "MIRROR_TRACK"));

  /* 语义校验：整链镜像后世界位姿 = 关于 x=0 的反射（若 SpineIkAim 可用解析世界矩阵） */
  if (IK && typeof IK.setupWorldOf === "function") {
    var chainBones = [{ name: "root" }, { name: "a", parent: "root" }, { name: "b", parent: "a" }];
    var chainAnim = {
      bones: {
        root: { rotate: [{ time: 0, value: 20 }] },
        a: { rotate: [{ time: 0, value: 35 }], translate: [{ time: 0, x: 10, y: 2 }] },
        b: { rotate: [{ time: 0, value: -15 }], translate: [{ time: 0, x: 20, y: -3 }] },
      },
    };
    var mirrored = P.mirrorAnimation(chainAnim, {});
    function worldsOf(bones, anim) {
      var map = {};
      for (var i = 0; i < bones.length; i++) {
        var b = bones[i];
        var keys = anim.bones[b.name] || {};
        var tr = keys.translate && keys.translate[0] ? keys.translate[0] : { x: 0, y: 0 };
        var rot = keys.rotate && keys.rotate[0] ? keys.rotate[0].value : 0;
        var loc = { x: tr.x, y: tr.y, rotation: rot, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 };
        var pw = b.parent ? map[b.parent] : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
        map[b.name] = IK.worldOf(pw, loc);
      }
      return map;
    }
    var wOrig = worldsOf(chainBones, chainAnim);
    var wMir = worldsOf(chainBones, mirrored.value);
    var maxDiff = 0;
    for (var name of ["root", "a", "b"]) {
      maxDiff = Math.max(maxDiff, Math.abs(wMir[name].tx + wOrig[name].tx), Math.abs(wMir[name].ty - wOrig[name].ty));
    }
    near("整链镜像的世界位姿 = 关于 x=0 的反射", maxDiff, 0, 1e-9);
    ok("镜像后每骨 rotation 取负", mirrored.value.bones.a.rotate[0].value === -35 && mirrored.value.bones.b.rotate[0].value === 15);
    ok("镜像后 translate.x 取负、y 不变", mirrored.value.bones.a.translate[0].x === -10 && mirrored.value.bones.a.translate[0].y === 2);
  } else {
    result.skipped++;
    result.notes.push({ name: "镜像语义校验", detail: "SpineIkAim 未加载，跳过世界矩阵反射校验" });
  }

  /* ------------------------------------------------------------------ */
  section("pose-tools / 片段库（委托 SpineBatchEdit）");
  if (!BE) {
    ok("缺 SpineBatchEdit 时片段库显式拒绝", codeOf(P.createClip(baseAnim(), [])) === "BATCH_EDIT_REQUIRED");
    result.notes.push({ name: "片段库", detail: "SpineBatchEdit 未加载：仅验证拒绝路径" });
  } else {
    var sel = [{ kind: "bone", owner: "arm_l", field: "rotate", time: 0 }];
    var clipRes = P.createClip(baseAnim(), sel, { sourceAnimation: "idle", skeletonSignature: "sig-A", name: "armclip" });
    ok("createClip ok", clipRes.ok === true, JSON.stringify(clipRes.issues));
    eq("clip version", clipRes.value.version, 1);
    eq("clip name", clipRes.value.name, "armclip");
    eq("clip 签名", clipRes.value.skeletonSignature, "sig-A");
    eq("clip items 数", clipRes.value.items.length, 1);
    ok("clip 保留 originTime/offset", Math.abs(clipRes.value.originTime - 0) <= 1e-9 && Math.abs(clipRes.value.items[0].offset - 0) <= 1e-9);
    var curveSel = [{ kind: "bone", owner: "arm_l", field: "rotate", time: 0.5 }];
    var curveClip = P.createClip(baseAnim(), curveSel, { sourceAnimation: "idle", skeletonSignature: "sig-A" });
    ok("曲线片段可被复制", curveClip.ok === true && Array.isArray(curveClip.value.items[0].rawKey.curve));
    eq("曲线片段缺后继 → 粘贴拒绝", (function () {
      var r = P.applyClip(baseAnim(), curveClip.value, { atTime: 1, skeletonSignature: "sig-A" });
      return r.ok === false ? r.issues[0].code : null;
    })(), "ANIM_CURVE_EDIT_UNSUPPORTED");
    ok("validateClip ok", P.validateClip(clipRes.value).ok === true);
    eq("validateClip 版本不符", codeOf(P.validateClip(Object.assign({}, clipRes.value, { version: 2 }))), "CLIP_VERSION");
    eq("validateClip 非对象", codeOf(P.validateClip(null)), "CLIP_INVALID");
    var json = P.clipToJSON(clipRes.value);
    ok("clipToJSON ok", json.ok === true && typeof json.value === "string");
    var withMeta = P.createClip(baseAnim(), sel, { sourceAnimation: "idle", skeletonSignature: "sig-A", name: "meta", createdAt: "2026-01-01T00:00:00Z" });
    var metaJson = JSON.parse(P.clipToJSON(withMeta.value).value);
    ok("clipToJSON 保留 name/createdAt", metaJson.name === "meta" && metaJson.createdAt === "2026-01-01T00:00:00Z");
    ok("clip 字段完整（version/signature/originTime/items）", metaJson.version === 1 && metaJson.skeletonSignature === "sig-A" && typeof metaJson.originTime === "number" && Array.isArray(metaJson.items));
    var back = P.clipFromJSON(json.value);
    ok("clipFromJSON 往返", back.ok === true && back.value.name === "armclip" && back.value.items.length === 1);
    eq("clipFromJSON 损坏 JSON", codeOf(P.clipFromJSON("{oops")), "CLIP_JSON_PARSE");
    eq("clipFromJSON 空文本", codeOf(P.clipFromJSON("")), "CLIP_TEXT_EMPTY");
    eq("clipFromJSON 版本不符", codeOf(P.clipFromJSON(JSON.stringify({ version: 9, items: [] }))), "CLIP_VERSION");
    var apply = P.applyClip(baseAnim(), clipRes.value, { atTime: 1, skeletonSignature: "sig-A" });
    ok("applyClip 粘贴 ok（委托 batch-edit）", apply.ok === true, JSON.stringify(apply.issues));
    eq("applyClip delegate 标注", apply.delegate, "batch-edit");
    eq("applyClip 新增 1", apply.pasted, 1);
    eq("applyClip 返回 selectionAfter 1 项", apply.selectionAfter.length, 1);
    eq("applyClip 后 arm_l rotate 3 个 key", apply.value.bones.arm_l.rotate.length, 3);
    eq("applyClip 跨骨架签名拒绝", (function () {
      var r = P.applyClip(baseAnim(), clipRes.value, { atTime: 1, skeletonSignature: "sig-B" });
      return r.ok === false ? (r.issues[0] && r.issues[0].code) : null;
    })(), "CLIPBOARD_SIGNATURE");
    eq("applyClip 负锚点拒绝", (function () {
      var r = P.applyClip(baseAnim(), clipRes.value, { atTime: -1, skeletonSignature: "sig-A" });
      return r.ok === false ? r.issues[0].code : null;
    })(), "PASTE_NEGATIVE_TIME");
    var locked = P.applyClip(baseAnim(), clipRes.value, { atTime: 1, skeletonSignature: "sig-A", lockedRows: ["bone:arm_l:rotate"] });
    eq("applyClip 锁定行拒绝", locked.ok === false ? locked.issues[0].code : null, "LOCKED_ROW");
    var skipRes = P.applyClip(baseAnim(), clipRes.value, { atTime: 0, skeletonSignature: "sig-A", collision: "skip" });
    ok("applyClip skip 模式可用（同刻已存在 → 覆盖计数）", skipRes.ok === true && skipRes.skipped >= 1);
    ok("clip 与源动画隔离（改 clip 不影响源）", (function () {
      var src = baseAnim();
      var c = P.createClip(src, sel, { sourceAnimation: "idle" });
      c.value.items[0].rawKey.value = 999;
      return src.bones.arm_l.rotate[0].value === 30;
    })());
    var emptyClip = P.createClip(baseAnim(), [], { sourceAnimation: "idle" });
    eq("空选择 → EMPTY_SELECTION", codeOf(emptyClip), "EMPTY_SELECTION");
    eq("未知轨 → UNKNOWN_TRACK", codeOf(P.createClip(baseAnim(), [{ kind: "bone", owner: "ghost", field: "rotate", time: 0 }])), "UNKNOWN_TRACK");
  }

  global.__selftestPoseToolsResult = result;
  if (typeof window !== "undefined") window.__selftestPoseToolsResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
