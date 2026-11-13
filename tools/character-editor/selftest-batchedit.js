/*
 * selftest-batchedit.js —— batch-edit.js 纯函数自检（Node / 浏览器共用）
 * 依赖：batch-edit.js（globalThis.SpineBatchEdit）。
 * 输出：globalThis.__selftestBatchEditResult = {passed, failed, total, cases, failures, notes}
 * 覆盖：轨道寻址 · 选择集 identity · move（同 delta/夹取/碰撞/A→B 旧时刻/曲线保护/锁定/未知轨）
 *       · delete（空数组保留/未知 bag 不动/曲线保护/duration 变短）· 剪贴板（生成/校验/签名/offset 一致）
 *       · paste（覆盖合并/未知扩展保留/源无 curve 删目标 curve/曲线平移/邻接拒绝/歧义/跨动画/锁定）
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
  function failCode(res) {
    return res && res.issues && res.issues.length ? res.issues[0].code : null;
  }

  var nodeMods = null;
  if (typeof process !== "undefined" && process.versions && process.versions.node && typeof process.getBuiltinModule === "function") {
    try {
      nodeMods = { fs: process.getBuiltinModule("node:fs"), module: process.getBuiltinModule("node:module"), cwd: process.cwd() };
    } catch (e) {
      nodeMods = null;
    }
  }
  var B = global.SpineBatchEdit;
  if (!B && nodeMods) {
    try {
      var req = nodeMods.module.createRequire(nodeMods.cwd.replace(/[\\/]+$/, "") + "/selftest-batchedit-loader.js");
      req(nodeMods.cwd.replace(/[\\/]+$/, "") + "/tools/character-editor/batch-edit.js");
      B = global.SpineBatchEdit;
    } catch (e) {
      B = null;
    }
  }
  if (!B) {
    record(false, "batch-edit.js 已加载（globalThis.SpineBatchEdit）", "存在", null);
    global.__selftestBatchEditResult = result;
    return;
  }

  /* ---------------- 夹具 ---------------- */
  function baseAnim() {
    return {
      bones: {
        "tail-1": {
          rotate: [{ time: 0, value: 0, note: "keep0" }, { time: 0.5, value: 10 }, { time: 1, value: 0 }],
          translate: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 5, y: -5 }],
          shear: [],
        },
        hip: {
          rotate: [{ time: 0.2, value: 1 }, { time: 0.6, value: 2, curve: [0.7, 2.5, 0.8, 3] }, { time: 0.9, value: 3 }],
          scale: [{ time: 0.4, x: 1, y: 1 }],
        },
      },
      slots: { "front-fist": { attachment: [{ time: 0, name: "a" }, { time: 0.5, name: "b" }] } },
      events: [{ time: 0.3, name: "e1" }],
      unknownBag: { foo: [{ time: 0.7, v: 1 }] },
    };
  }
  var sel = function (kind, owner, field, time) {
    return { kind: kind, owner: owner, field: field, time: time };
  };

  /* ------------------------------------------------------------------ */
  section("batch-edit / 轨道寻址与选择集");
  var A0 = baseAnim();
  ok("resolveTrack bone.rotate", B.resolveTrack(A0, "bone", "tail-1", "rotate").ok === true);
  ok("resolveTrack slot.attachment", B.resolveTrack(A0, "slot", "front-fist", "attachment").ok === true);
  ok("resolveTrack 顶层数组（events）", B.resolveTrack(A0, "timeline", "events", "events").ok === true);
  ok("resolveTrack 空数组轨道（shear）可用", B.resolveTrack(A0, "bone", "tail-1", "shear").ok === true);
  eq("resolveTrack 未知骨 → UNKNOWN_TRACK", B.resolveTrack(A0, "bone", "ghost", "rotate").code, "UNKNOWN_TRACK");
  eq("resolveTrack 未知顶层包 → UNKNOWN_TRACK", B.resolveTrack(A0, "timeline", "unknownBag", "unknownBag").code, "UNKNOWN_TRACK");
  eq("resolveTrack 未支持 kind → UNKNOWN_TRACK", B.resolveTrack(A0, "weird", "x", "y").code, "UNKNOWN_TRACK");
  eq("rowKeyOf 结构化键", B.rowKeyOf("bone", "tail-1", "rotate"), "bone:tail-1:rotate");
  eq("pathOf bone", B.pathOf("bone", "tail-1", "rotate"), "bones.tail-1.rotate");
  eq("pathOf slot", B.pathOf("slot", "front-fist", "attachment"), "slots.front-fist.attachment");
  eq("keyHasCurve 数组为真", B.keyHasCurve({ time: 0, curve: [0.1, 0, 0.2, 1] }), true);
  eq("keyHasCurve 缺 curve 为假", B.keyHasCurve({ time: 0 }), false);
  ok("sameIdentity 同结构为真", B.sameIdentity(sel("bone", "a", "rotate", 1), sel("bone", "a", "rotate", 1)) === true);
  ok("sameIdentity 时间不同为假", B.sameIdentity(sel("bone", "a", "rotate", 1), sel("bone", "a", "rotate", 2)) === false);
  eq("normalizeSelection 数组 ok", B.normalizeSelection([sel("bone", "tail-1", "rotate", 0.5)]).items.length, 1);
  eq("normalizeSelection {items} ok", B.normalizeSelection({ items: [sel("bone", "tail-1", "rotate", 0.5)] }).items.length, 1);
  eq("normalizeSelection 去重", B.normalizeSelection([sel("bone", "tail-1", "rotate", 0.5), sel("bone", "tail-1", "rotate", 0.5)]).items.length, 1);
  eq("normalizeSelection null → SELECTION_INVALID", B.normalizeSelection(null).code, "SELECTION_INVALID");
  eq("normalizeSelection 空 → EMPTY_SELECTION", B.normalizeSelection([]).code, "EMPTY_SELECTION");
  eq("normalizeSelection 缺 field → SELECTION_INVALID", B.normalizeSelection([{ kind: "bone", owner: "a", time: 0 }]).code, "SELECTION_INVALID");
  eq("normalizeSelection time 非有限 → SELECTION_INVALID", B.normalizeSelection([{ kind: "bone", owner: "a", field: "rotate", time: NaN }]).code, "SELECTION_INVALID");
  ok("scanDuration 取全时序最大（含未知包）", Math.abs(B.scanDuration(A0) - 1) <= 1e-9);
  ok("scanDuration 非对象安全", B.scanDuration(null) === 0);

  /* ------------------------------------------------------------------ */
  section("batch-edit / move 批量移动");
  var m0 = baseAnim();
  var m0snap = snap(m0);
  var mv1 = B.planKeyBatch(m0, { op: "move", selection: [sel("bone", "tail-1", "rotate", 0.5), sel("bone", "hip", "rotate", 0.2)], delta: 0.1 });
  ok("跨轨移动 ok", mv1.ok === true);
  near("目标轨时间 +delta", mv1.value.bones["tail-1"].rotate[1].time, 0.6, 1e-9);
  near("另一轨时间 +delta", mv1.value.bones.hip.rotate[0].time, 0.3, 1e-9);
  deepEq("未选 Key 不动", mv1.value.bones["tail-1"].rotate.map(function (k) { return k.time; }), [0, 0.6, 1]);
  ok("未知字段随 Key 保留", mv1.value.bones["tail-1"].rotate[0].note === "keep0");
  ok("入参未被修改", snap(m0) === m0snap);
  eq("changedPaths 去重后两条", mv1.changedPaths.length, 2);
  eq("counts.moved", mv1.counts.moved, 2);
  eq("selectionAfter 两条", mv1.selectionAfter.length, 2);
  near("selectionAfter 时间", mv1.selectionAfter[0].time, 0.6, 1e-9);
  ok("返回新对象（不复用入参）", mv1.value !== m0);

  var mv2 = B.planKeyBatch(baseAnim(), { op: "move", selection: [sel("bone", "tail-1", "rotate", 0.5), sel("bone", "tail-1", "rotate", 1)], delta: 0.5 });
  ok("A 移到已选 B 旧时刻被允许", mv2.ok === true);
  deepEq("结果时间 [0,1,1.5]", mv2.value.bones["tail-1"].rotate.map(function (k) { return k.time; }), [0, 1, 1.5]);
  near("末 Key 延长后 duration", mv2.duration, 1.5, 1e-9);

  var mv3 = B.planKeyBatch(baseAnim(), { op: "move", selection: [sel("bone", "tail-1", "rotate", 0.5)], delta: 0.5 });
  eq("与未选 Key 碰撞 → COLLISION", failCode(mv3), "COLLISION");
  ok("碰撞时零改动（value=null）", mv3.ok === false && mv3.value === null);

  var mv4 = B.planKeyBatch(baseAnim(), { op: "move", selection: [sel("bone", "hip", "scale", 0.4)], delta: -5 });
  ok("负 delta 夹到不早于 0", mv4.ok === true);
  near("夹取后时间为 0", mv4.value.bones.hip.scale[0].time, 0, 1e-9);
  near("counts.delta 记录夹取后值", mv4.counts.delta, -0.4, 1e-9);
  eq("counts.clampedToZero", mv4.counts.clampedToZero, true);

  eq("移动曲线段 Key → 拒绝", failCode(B.planKeyBatch(baseAnim(), { op: "move", selection: [sel("bone", "hip", "rotate", 0.6)], delta: 0.05 })), "ANIM_CURVE_EDIT_UNSUPPORTED");
  eq("移动曲线段末端 → 拒绝", failCode(B.planKeyBatch(baseAnim(), { op: "move", selection: [sel("bone", "hip", "rotate", 0.9)], delta: 0.05 })), "ANIM_CURVE_EDIT_UNSUPPORTED");
  eq("移入曲线段内 → 拒绝", failCode(B.planKeyBatch(baseAnim(), { op: "move", selection: [sel("bone", "hip", "rotate", 0.2)], delta: 0.65 })), "ANIM_CURVE_EDIT_UNSUPPORTED");
  ok("曲线段外的 Key 可移动", B.planKeyBatch(baseAnim(), { op: "move", selection: [sel("bone", "hip", "rotate", 0.2)], delta: -0.1 }).ok === true);
  eq("锁定行 → LOCKED_ROW", failCode(B.planKeyBatch(baseAnim(), { op: "move", selection: [sel("bone", "hip", "rotate", 0.2)], delta: 0.1, lockedRows: ["bone:hip:rotate"] })), "LOCKED_ROW");
  eq("未知轨 → UNKNOWN_TRACK", failCode(B.planKeyBatch(baseAnim(), { op: "move", selection: [sel("bone", "ghost", "rotate", 0)], delta: 0.1 })), "UNKNOWN_TRACK");
  eq("未知顶层轨 → UNKNOWN_TRACK", failCode(B.planKeyBatch(baseAnim(), { op: "move", selection: [sel("timeline", "unknownBag", "unknownBag", 0.7)], delta: 0.1 })), "UNKNOWN_TRACK");
  eq("选中 Key 不存在 → SELECTED_KEY_NOT_FOUND", failCode(B.planKeyBatch(baseAnim(), { op: "move", selection: [sel("bone", "tail-1", "rotate", 0.77)], delta: 0.1 })), "SELECTED_KEY_NOT_FOUND");
  eq("空选择 → EMPTY_SELECTION", failCode(B.planKeyBatch(baseAnim(), { op: "move", selection: [], delta: 0.1 })), "EMPTY_SELECTION");
  eq("delta 非有限 → DELTA_INVALID", failCode(B.planKeyBatch(baseAnim(), { op: "move", selection: [sel("bone", "tail-1", "rotate", 0.5)], delta: NaN })), "DELTA_INVALID");
  eq("未知 op → OP_INVALID", failCode(B.planKeyBatch(baseAnim(), { op: "wobble" })), "OP_INVALID");
  eq("动画非对象 → ANIM_INVALID", failCode(B.planKeyBatch(null, { op: "delete", selection: [sel("bone", "a", "rotate", 0)] })), "ANIM_INVALID");
  ok("同轨多 Key 同 delta（间距不变）", (function () {
    var r = B.planKeyBatch(baseAnim(), { op: "move", selection: [sel("bone", "tail-1", "rotate", 0), sel("bone", "tail-1", "rotate", 1)], delta: 0.25 });
    return r.ok && Math.abs(r.selectionAfter[1].time - r.selectionAfter[0].time - 1) <= 1e-9;
  })());

  /* ------------------------------------------------------------------ */
  section("batch-edit / delete 删除");
  var d1 = B.planKeyBatch(baseAnim(), { op: "delete", selection: [sel("bone", "tail-1", "rotate", 0.5)] });
  ok("删除单选 ok", d1.ok === true);
  eq("剩余 Key 数", d1.value.bones["tail-1"].rotate.length, 2);
  deepEq("剩余时间", d1.value.bones["tail-1"].rotate.map(function (k) { return k.time; }), [0, 1]);
  eq("counts.deleted", d1.counts.deleted, 1);
  eq("selectionAfter 清空", d1.selectionAfter.length, 0);
  var d2 = B.planKeyBatch(baseAnim(), { op: "delete", selection: [sel("bone", "hip", "scale", 0.4)] });
  deepEq("删空后保留空数组", d2.value.bones.hip.scale, []);
  ok("空数组字段仍存在", Object.prototype.hasOwnProperty.call(d2.value.bones.hip, "scale") === true);
  ok("未知 bag 字段保留", d2.value.unknownBag && Array.isArray(d2.value.unknownBag.foo) && d2.value.unknownBag.foo.length === 1);
  var d3 = B.planKeyBatch(baseAnim(), { op: "delete", selection: [sel("bone", "tail-1", "rotate", 0), sel("bone", "tail-1", "rotate", 1)] });
  ok("删除后 duration 不变短于其它轨（translate 仍有 key@1）", Math.abs(d3.duration - 1) <= 1e-9);
  var shrinkAnim = { bones: { a: { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: 1 }] } } };
  var dShrink = B.planKeyBatch(shrinkAnim, { op: "delete", selection: [sel("bone", "a", "rotate", 0.5)] });
  near("删掉末 Key 后 duration 真实变短", dShrink.duration, 0, 1e-9);
  eq("删除曲线段 Key → 拒绝", failCode(B.planKeyBatch(baseAnim(), { op: "delete", selection: [sel("bone", "hip", "rotate", 0.6)] })), "ANIM_CURVE_EDIT_UNSUPPORTED");
  eq("删除曲线段末端 → 拒绝", failCode(B.planKeyBatch(baseAnim(), { op: "delete", selection: [sel("bone", "hip", "rotate", 0.9)] })), "ANIM_CURVE_EDIT_UNSUPPORTED");
  eq("删除锁定行 → LOCKED_ROW", failCode(B.planKeyBatch(baseAnim(), { op: "delete", selection: [sel("bone", "tail-1", "rotate", 0.5)], lockedRows: ["bone:tail-1:rotate"] })), "LOCKED_ROW");
  var d4 = B.planKeyBatch(baseAnim(), { op: "delete", selection: [sel("slot", "front-fist", "attachment", 0.5)] });
  ok("槽轨可删", d4.ok === true && d4.value.slots["front-fist"].attachment.length === 1);
  var d5 = B.planKeyBatch(baseAnim(), { op: "delete", selection: [sel("timeline", "events", "events", 0.3)] });
  ok("顶层 events 轨可删", d5.ok === true && d5.value.events.length === 0);
  var dSnap = baseAnim();
  var dSnapJson = snap(dSnap);
  B.planKeyBatch(dSnap, { op: "delete", selection: [sel("bone", "tail-1", "rotate", 0.5)] });
  ok("delete 不改入参", snap(dSnap) === dSnapJson);

  /* ------------------------------------------------------------------ */
  section("batch-edit / 剪贴板生成与校验");
  var cAnim = baseAnim();
  var cb1 = B.clipboardFromSelection(cAnim, [sel("bone", "tail-1", "rotate", 0.5), sel("bone", "hip", "rotate", 0.2)], { sourceAnimation: "idle", skeletonSignature: "sig-A" });
  ok("clipboardFromSelection ok", cb1.ok === true);
  eq("剪贴板 version", cb1.value.version, B.CLIPBOARD_VERSION);
  near("originTime = 最小时间", cb1.value.originTime, 0.2, 1e-9);
  eq("items 数", cb1.value.items.length, 2);
  near("offset 计算", cb1.value.items[0].offset, 0.3, 1e-9);
  ok("rawKey 深克隆（与源不同对象）", cb1.value.items[0].rawKey !== cAnim.bones["tail-1"].rotate[1]);
  deepEq("rawKey 内容一致", cb1.value.items[0].rawKey, { time: 0.5, value: 10 });
  eq("sourceAnimation 记录", cb1.value.sourceAnimation, "idle");
  eq("skeletonSignature 记录", cb1.value.skeletonSignature, "sig-A");
  ok("单键复制不带 nextSourceTime", cb1.value.items[0].nextSourceTime === undefined);
  var cbCurve = B.clipboardFromSelection(baseAnim(), [sel("bone", "hip", "rotate", 0.6), sel("bone", "hip", "rotate", 0.9)]);
  ok("后继也在选择内 → 带 nextSourceTime", Math.abs(cbCurve.value.items[0].nextSourceTime - 0.9) <= 1e-9);
  ok("曲线 Key 原样复制", Array.isArray(cbCurve.value.items[0].rawKey.curve));
  eq("复制未知轨 → UNKNOWN_TRACK", failCode(B.clipboardFromSelection(baseAnim(), [sel("bone", "ghost", "rotate", 0)])), "UNKNOWN_TRACK");
  eq("复制空选择 → EMPTY_SELECTION", failCode(B.clipboardFromSelection(baseAnim(), [])), "EMPTY_SELECTION");
  ok("validateClipboard 合法通过", B.validateClipboard(cb1.value).ok === true);
  eq("validateClipboard null → CLIPBOARD_INVALID", failCode(B.validateClipboard(null)), "CLIPBOARD_INVALID");
  eq("version 不符 → CLIPBOARD_VERSION", failCode(B.validateClipboard(Object.assign({}, cb1.value, { version: 2 }))), "CLIPBOARD_VERSION");
  eq("items 空 → CLIPBOARD_EMPTY", failCode(B.validateClipboard(Object.assign({}, cb1.value, { items: [] }))), "CLIPBOARD_EMPTY");
  eq("originTime 非法 → CLIPBOARD_ORIGIN", failCode(B.validateClipboard(Object.assign({}, cb1.value, { originTime: NaN }))), "CLIPBOARD_ORIGIN");
  eq("offset 与 rawKey.time 不一致 → CLIPBOARD_ITEM", failCode(B.validateClipboard(Object.assign({}, cb1.value, { items: [{ kind: "bone", owner: "a", field: "rotate", offset: 5, rawKey: { time: 0, value: 1 } }] }))), "CLIPBOARD_ITEM");
  eq("签名不一致 → CLIPBOARD_SIGNATURE", failCode(B.validateClipboard(cb1.value, { skeletonSignature: "sig-B" })), "CLIPBOARD_SIGNATURE");
  eq("目标无该 owner → CLIPBOARD_UNKNOWN_OWNER", failCode(B.validateClipboard(cb1.value, { owners: ["hip"] })), "CLIPBOARD_UNKNOWN_OWNER");

  /* ------------------------------------------------------------------ */
  section("batch-edit / paste 粘贴");
  var pAnim = {
    bones: { "tail-1": { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: 10, keep: "dest" }] } },
  };
  var pCB = { version: 1, skeletonSignature: null, sourceAnimation: "idle", originTime: 0, items: [{ kind: "bone", owner: "tail-1", field: "rotate", offset: 0, rawKey: { time: 0, value: 99 } }] };
  var p1 = B.planKeyBatch(pAnim, { op: "paste", clipboard: pCB, atTime: 0.5 });
  ok("同刻粘贴覆盖 ok", p1.ok === true);
  eq("counts.overwritten", p1.counts.overwritten, 1);
  eq("counts.added", p1.counts.added, 0);
  eq("覆盖后 Key 数不变", p1.value.bones["tail-1"].rotate.length, 2);
  eq("源值优先", p1.value.bones["tail-1"].rotate[1].value, 99);
  eq("目标未知扩展保留", p1.value.bones["tail-1"].rotate[1].keep, "dest");
  ok("selectionAfter 指向粘贴结果", p1.selectionAfter.length === 1 && Math.abs(p1.selectionAfter[0].time - 0.5) <= 1e-9);
  var pAnim2 = { bones: { "tail-1": { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: 10, curve: [0.6, 11, 0.7, 12] }] } } };
  var p2 = B.planKeyBatch(pAnim2, { op: "paste", clipboard: pCB, atTime: 0.5 });
  ok("源无 curve → 覆盖时删除目标 curve", p2.ok === true && p2.value.bones["tail-1"].rotate[1].curve === undefined);
  var p3 = B.planKeyBatch(pAnim, { op: "paste", clipboard: pCB, atTime: 0.5, collision: "reject" });
  eq("collision=reject → COLLISION", failCode(p3), "COLLISION");
  var p4 = B.planKeyBatch(pAnim, { op: "paste", clipboard: pCB, atTime: 0.25 });
  ok("插入新 Key ok", p4.ok === true && p4.counts.added === 1 && p4.counts.overwritten === 0);
  deepEq("插入后按时间排序", p4.value.bones["tail-1"].rotate.map(function (k) { return k.time; }), [0, 0.25, 0.5]);
  var p5 = B.planKeyBatch(pAnim, { op: "paste", clipboard: pCB, atTime: 0.25, lockedRows: ["bone:tail-1:rotate"] });
  eq("锁定目标 → LOCKED_ROW", failCode(p5), "LOCKED_ROW");
  var p6 = B.planKeyBatch(pAnim, { op: "paste", clipboard: pCB, atTime: 0.25, skeletonSignature: "sig-B" });
  ok("剪贴板无签名 + 目标有签名 → 拒绝", p6.ok === false && failCode(p6) === "CLIPBOARD_SIGNATURE");
  var p7 = B.planKeyBatch(pAnim, { op: "paste", clipboard: pCB, atTime: 2 });
  near("粘贴延长 duration", p7.duration, 2, 1e-9);
  var p8 = B.planKeyBatch(pAnim, { op: "paste", clipboard: pCB, atTime: 0.25, snap: { enabled: true, fps: 30 } });
  ok("锚点吸附一次（0.25 → 0.233333）", p8.ok === true && Math.abs(p8.counts.anchor - Math.round(0.25 * 30) / 30) <= 1e-9);
  var pAnimAmbig = { bones: { "tail-1": { rotate: [{ time: 0.5, value: 1 }, { time: 0.50005, value: 2 }] } } };
  eq("目标 ±eps 内多个匹配 → AMBIGUOUS_TARGET", failCode(B.planKeyBatch(pAnimAmbig, { op: "paste", clipboard: pCB, atTime: 0.5 })), "AMBIGUOUS_TARGET");
  eq("粘贴到未知轨 → UNKNOWN_TRACK", failCode(B.planKeyBatch(pAnim, { op: "paste", clipboard: Object.assign({}, pCB, { items: [{ kind: "bone", owner: "ghost", field: "rotate", offset: 0, rawKey: { time: 0, value: 1 } }] }) })), "UNKNOWN_TRACK");
  eq("锚点为负 → PASTE_NEGATIVE_TIME", failCode(B.planKeyBatch(pAnim, { op: "paste", clipboard: pCB, atTime: -1 })), "PASTE_NEGATIVE_TIME");
  var pSnap = snap(pAnim);
  B.planKeyBatch(pAnim, { op: "paste", clipboard: pCB, atTime: 0.25 });
  ok("paste 不改入参", snap(pAnim) === pSnap);
  ok("paste 不改剪贴板", JSON.stringify(pCB.items[0].rawKey) === JSON.stringify({ time: 0, value: 99 }));

  /* 曲线片段粘贴：cx 平移、cy 与值不变 */
  var cDest = { bones: { hip: { rotate: [{ time: 0, value: 0 }, { time: 2, value: 0 }] } } };
  var cCB = {
    version: 1,
    skeletonSignature: null,
    sourceAnimation: "idle",
    originTime: 0.5,
    items: [
      { kind: "bone", owner: "hip", field: "rotate", offset: 0, rawKey: { time: 0.5, value: 5, curve: [0.6, 1, 0.8, 2] }, nextSourceTime: 0.7 },
      { kind: "bone", owner: "hip", field: "rotate", offset: 0.2, rawKey: { time: 0.7, value: 7 } },
    ],
  };
  var cp1 = B.planKeyBatch(cDest, { op: "paste", clipboard: cCB, atTime: 1 });
  ok("完整曲线片段可粘贴", cp1.ok === true && cp1.counts.added === 2);
  var pastedCurve = cp1.value.bones.hip.rotate.filter(function (k) { return Math.abs(k.time - 1) <= 1e-9; })[0];
  deepEq("curve cx 随粘贴平移、cy/值不变", pastedCurve.curve, [1.1, 1, 1.3, 2]);
  eq("曲线源缺后继 → 拒绝", failCode(B.planKeyBatch(cDest, { op: "paste", clipboard: Object.assign({}, cCB, { items: [cCB.items[0]] }) })), "ANIM_CURVE_EDIT_UNSUPPORTED");
  var cDest2 = { bones: { hip: { rotate: [{ time: 0, value: 0, curve: [0.5, 1, 1.5, 2] }, { time: 2, value: 0 }] } } };
  eq("插入到既有曲线段内 → 拒绝", failCode(B.planKeyBatch(cDest2, { op: "paste", clipboard: { version: 1, skeletonSignature: null, originTime: 0, items: [{ kind: "bone", owner: "hip", field: "rotate", offset: 0, rawKey: { time: 0, value: 9 } }] }, atTime: 1 })), "ANIM_CURVE_EDIT_UNSUPPORTED");
  var cp3 = B.planKeyBatch(cDest, { op: "paste", clipboard: { version: 1, skeletonSignature: null, originTime: 0.5, items: [{ kind: "bone", owner: "hip", field: "rotate", offset: 0, rawKey: { time: 0.5, value: 5, curve: [0.6, 1, 0.8, 2] }, nextSourceTime: 0.7 }, { kind: "bone", owner: "hip", field: "rotate", offset: 0.2, rawKey: { time: 0.7, value: 7 } }] }, atTime: 1, lockedRows: ["bone:hip:rotate"] });
  eq("曲线粘贴遇锁定 → LOCKED_ROW", failCode(cp3), "LOCKED_ROW");

  global.__selftestBatchEditResult = result;
  if (typeof window !== "undefined") window.__selftestBatchEditResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
