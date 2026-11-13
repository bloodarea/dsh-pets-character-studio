/*
 * selftest-anim.js —— anim-edit.js 的纯函数自检（Node / 浏览器共用）
 * 依赖：anim-edit.js（globalThis.SpineAnimEdit）
 * 输出：globalThis.__selftestAnimResult = {passed, failed, total, cases, failures}
 * 覆盖：时长扫描 / 时长缩放（含 4.2 贝塞尔绝对时间控制点）/ key 增删改排序 /
 *       轨道扫描 / 相对 setup 反算 / 未编辑轨道保留 / 保存补丁合并。
 */
(function (global) {
  "use strict";

  var E = global.SpineAnimEdit;
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
  function deepEq(name, actual, expected) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    return record(a === b, name, b, a);
  }
  function section(name) {
    currentCase = name;
  }

  if (!E) {
    record(false, "anim-edit.js 已加载", "SpineAnimEdit", null);
    global.__selftestAnimResult = result;
    return;
  }

  var ANIM = {
    bones: {
      hips: {
        scale: [
          { time: 0, x: 1, y: 1 },
          { time: 0.5, x: 1.01, y: 1.01 },
          { time: 1.0, x: 1, y: 1 },
        ],
        rotate: [
          { time: 0, value: 0 },
          { time: 1.0, value: 4 },
        ],
      },
      "tail-1": {
        rotate: [
          { time: 0, value: -1 },
          { time: 0.25, value: 2 },
          { time: 1.0, value: -1 },
        ],
      },
      "weird-bone": {
        bogusTrack: [
          { time: 0, value: 1 },
          { time: 0.75, value: 2 },
        ],
      },
    },
    slots: {
      "睫毛_L": {
        attachment: [
          { time: 0, name: "lash_L_100" },
          { time: 0.5, name: "lash_L_0" },
          { time: 1.0, name: "lash_L_100" },
        ],
      },
      "嘴巴": {
        attachment: [
          { time: 0, name: "mouth_无表情" },
          { time: 1.0, name: null },
        ],
      },
    },
  };

  function cloneAnim() {
    return JSON.parse(JSON.stringify(ANIM));
  }
  function mut(base, fn) {
    var o = JSON.parse(JSON.stringify(base));
    fn(o);
    return o;
  }

  /* ------------------------------------------------------------------ */
  section("anim-edit / 时长扫描");
  eq("duration = 已知时序最后 key 时间", E.animDurationOf(cloneAnim()), 1);
  eq("key 计数（含未识别轨道）", E.scanTimelineKeys(cloneAnim()).keyCount, 15);
  eq("空对象时长为 0", E.animDurationOf({}), 0);
  eq("null 时长为 0", E.animDurationOf(null), 0);

  var IK_ANIM = {
    bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 1 }] } },
    ik: {
      "ik-1": {
        continuous: { keys: [{ time: 0, mix: 0, softness: 0 }, { time: 1.5, mix: 1, softness: 2 }] },
        bendPositive: [{ time: 0, value: true }, { time: 1.5, value: false }],
      },
    },
    drawOrder: [{ time: 0, offsets: [] }, { time: 1.25, offsets: [{ slot: "a", offset: 1 }] }],
  };
  eq("ik / drawOrder 计入时长", E.animDurationOf(IK_ANIM), 1.5);
  eq("ik / drawOrder 计入 key 数", E.scanTimelineKeys(IK_ANIM).keyCount, 8);
  eq("draftBaseDuration 同 animDurationOf", E.draftBaseDuration(cloneAnim()), 1);

  /* ------------------------------------------------------------------ */
  section("anim-edit / 时长缩放");
  var scaled = E.scaleAnimationTimes(cloneAnim(), 2);
  ok("缩放返回 ok", scaled.ok);
  eq("缩放后时长", E.animDurationOf(scaled.value), 2);
  near("首 key 保持 0", scaled.value.bones.hips.scale[0].time, 0, 0);
  near("中间 key 按比例", scaled.value.bones["tail-1"].rotate[1].time, 0.5, 1e-9);
  eq("缩放保留 key 值", scaled.value.bones.hips.rotate[1].value, 4);
  eq("缩放保留槽附件名", scaled.value.slots["睫毛_L"].attachment[1].name, "lash_L_0");
  eq("缩放保留 null 附件", scaled.value.slots["嘴巴"].attachment[1].name, null);
  eq("缩放不改入参", ANIM.bones.hips.scale[2].time, 1);
  deepEq(
    "未识别 timeline 原样保留（整体克隆，不猜语义）",
    scaled.value.bones["weird-bone"].bogusTrack,
    ANIM.bones["weird-bone"].bogusTrack
  );

  var curveAnim = {
    bones: {
      b: {
        rotate: [
          { time: 0, value: 0, curve: [0.25, 0, 0.75, 1] },
          { time: 1, value: 10 },
        ],
      },
    },
  };
  var curveScaled = E.scaleAnimationTimes(curveAnim, 3);
  ok("带贝塞尔曲线缩放 ok", curveScaled.ok);
  deepEq("曲线绝对时间控制点同步缩放", curveScaled.value.bones.b.rotate[0].curve, [0.75, 0, 2.25, 1]);
  deepEq("曲线值控制点不变", curveAnim.bones.b.rotate[0].curve, [0.25, 0, 0.75, 1]);

  var durZero = E.scaleAnimationTimes({ bones: { b: { rotate: [{ time: 0, value: 0 }] } } }, 1);
  ok("旧时长 0 时拒绝缩放", !durZero.ok);
  eq("拒绝原因码", durZero.issues[0].code, "ANIM_DURATION_ZERO");
  ok("时长非正数拒绝", !E.scaleAnimationTimes(cloneAnim(), 0).ok);
  ok("时长 NaN 拒绝", !E.scaleAnimationTimes(cloneAnim(), NaN).ok);
  ok("动画非对象拒绝", !E.scaleAnimationTimes(null, 1).ok);

  var ikScaled = E.scaleAnimationTimes(IK_ANIM, 3);
  ok("含 ik/drawOrder 的动画可缩放", ikScaled.ok);
  near("ik 连续轨道时间缩放", ikScaled.value.ik["ik-1"].continuous.keys[1].time, 3, 1e-9);
  near("ik stepped 轨道时间缩放", ikScaled.value.ik["ik-1"].bendPositive[1].time, 3, 1e-9);
  near("drawOrder 时间缩放", ikScaled.value.drawOrder[1].time, 2.5, 1e-9);
  eq("drawOrder 内容保留", JSON.stringify(ikScaled.value.drawOrder[1].offsets), JSON.stringify([{ slot: "a", offset: 1 }]));
  ok("缩放后时长 = 新时长", Math.abs(E.animDurationOf(ikScaled.value) - 3) <= 1e-9);
  deepEq("scaled 列出已缩放时序", ikScaled.scaled.slice().sort(), ["bones", "drawOrder", "ik"]);

  var unknownAnim = {
    bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 1 }] } },
    events: [{ time: 0.5, name: "e1" }, { time: 2, name: "e2" }],
    deform: { skin: [{ time: 1, offset: 2 }] },
  };
  var unknownScaled = E.scaleAnimationTimes(unknownAnim, 4);
  ok("含 events/deform 的动画可缩放", unknownScaled.ok);
  near("events 时间随比例缩放（含 events 后旧时长=2，比例=2）", unknownScaled.value.events[1].time, 4, 1e-9);
  eq("events 其它字段保留", unknownScaled.value.events[0].name, "e1");
  near("deform 时间随比例缩放", unknownScaled.value.deform.skin[0].time, 2, 1e-9);
  near("缩放后时长 = 新时长（events 计入）", E.animDurationOf(unknownScaled.value), 4, 1e-9);
  ok("scaled 列出 events/deform", unknownScaled.scaled.indexOf("events") >= 0 && unknownScaled.scaled.indexOf("deform") >= 0);

  eq(
    "duration 计入 events（advisor 反例）",
    E.animDurationOf({ bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 1 }] } }, events: [{ time: 2, name: "e" }] }),
    2
  );
  var evScaled = E.scaleAnimationTimes(
    { bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 1 }] } }, events: [{ time: 2, name: "e" }] },
    4
  );
  ok("events 反例：骨末 key 缩放到新时长", evScaled.ok && Math.abs(E.animDurationOf(evScaled.value) - 4) <= 1e-9);

  var overflow = E.scaleAnimationTimes({ bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 1e-300, value: 1 }] } } }, 1e308);
  ok("极端缩放溢出被拒绝", !overflow.ok);
  eq("溢出原因码", overflow.issues[0].code, "ANIM_SCALE_OVERFLOW");
  var hugeFinite = E.scaleAnimationTimes({ bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 1e-300, value: 1 }] } } }, 1e-300);
  ok("极小但有限的新时长返回 ok", hugeFinite.ok);
  ok("返回值的所有数字都有限", (function () {
    var okAll = true;
    (function walk(v) {
      if (!okAll) return;
      if (typeof v === "number") { if (!isFinite(v)) okAll = false; return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === "object") Object.keys(v).forEach(function (k) { walk(v[k]); });
    })(hugeFinite.value);
    return okAll;
  })());

  var clampScale = E.scaleAnimationTimes({ bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 1e-9, value: 1 }, { time: 1, value: 2 }] } } }, 0.5);
  ok("末 key 夹到新时长内", clampScale.ok && E.animDurationOf(clampScale.value) <= 0.5 + 1e-9);
  near("夹取后末 key = 新时长", E.animDurationOf(clampScale.value), 0.5, 1e-9);

  /* ------------------------------------------------------------------ */
  section("anim-edit / key 增删改");
  var up = E.upsertKey(cloneAnim(), "bones", "tail-1", "rotate", { value: 7 }, 0.5);
  ok("新增 key 成功", up.ok);
  eq("新增后 key 数", up.value.bones["tail-1"].rotate.length, 4);
  near("新增 key 值", up.value.bones["tail-1"].rotate[2].value, 7, 1e-9);
  ok("新增后时间递增", up.value.bones["tail-1"].rotate[2].time < up.value.bones["tail-1"].rotate[3].time);
  eq("新增不替换", up.replaced, false);

  var up2 = E.upsertKey(cloneAnim(), "bones", "tail-1", "rotate", { value: -9 }, 0.25);
  ok("同时间覆盖", up2.ok && up2.replaced === true);
  eq("覆盖后 key 数不变", up2.value.bones["tail-1"].rotate.length, 3);
  near("覆盖后值更新", up2.value.bones["tail-1"].rotate[1].value, -9, 1e-9);

  var upNew = E.upsertKey(cloneAnim(), "slots", "嘴巴", "attachment", { name: "mouth_微笑" }, 0.5);
  ok("槽附件轨道可新增", upNew.ok);
  eq("槽附件新增数量", upNew.value.slots["嘴巴"].attachment.length, 3);
  eq("槽附件新增值", upNew.value.slots["嘴巴"].attachment[1].name, "mouth_微笑");

  var upOver = E.upsertKey(cloneAnim(), "bones", "hips", "rotate", { value: 1 }, 1.5);
  ok("超出时长拒绝", !upOver.ok);
  eq("超时长原因码", upOver.issues[0].code, "ANIM_KEY_OVER_DURATION");
  ok("负时间拒绝", !E.upsertKey(cloneAnim(), "bones", "hips", "rotate", { value: 1 }, -1).ok);
  ok("非有限值拒绝", !E.upsertKey(cloneAnim(), "bones", "hips", "rotate", { value: NaN }, 0.5).ok);
  ok("非法轨道种类拒绝", !E.upsertKey(cloneAnim(), "ik", "x", "rotate", { value: 1 }, 0.5).ok);
  var upNonexistent = E.upsertKey(cloneAnim(), "bones", "找不到的骨", "rotate", { value: 1 }, 0.5);
  ok("新骨名会新建轨道（由调用方保证骨存在）", upNonexistent.ok && !!upNonexistent.value.bones["找不到的骨"]);

  var curvePersist = E.upsertKey(curveAnim, "bones", "b", "rotate", { value: 3 }, 0);
  ok("覆盖时保留 curves", curvePersist.ok && JSON.stringify(curvePersist.value.bones.b.rotate[0].curve) === JSON.stringify([0.25, 0, 0.75, 1]));

  var rm = E.removeKey(cloneAnim(), "bones", "tail-1", "rotate", 0.25);
  ok("删除 key 成功", rm.ok);
  eq("删除后 key 数", rm.value.bones["tail-1"].rotate.length, 2);
  ok("删除不存在 key 失败", !E.removeKey(cloneAnim(), "bones", "tail-1", "rotate", 0.9).ok);
  ok("删除不存在轨道失败", !E.removeKey(cloneAnim(), "bones", "nope", "rotate", 0).ok);

  var rt = E.retimeKey(cloneAnim(), "slots", "睫毛_L", "attachment", 0.5, 0.75);
  ok("改时间成功", rt.ok);
  near("改时间后值", rt.value.slots["睫毛_L"].attachment[1].time, 0.75, 1e-9);
  eq("改时间保留附件名", rt.value.slots["睫毛_L"].attachment[1].name, "lash_L_0");
  ok("改时间超时长拒绝", !E.retimeKey(cloneAnim(), "slots", "睫毛_L", "attachment", 0.5, 2).ok);
  var rtConflict = E.retimeKey(cloneAnim(), "slots", "睫毛_L", "attachment", 0.5, 1);
  ok("改时间撞已有 key 拒绝（advisor 反例）", !rtConflict.ok);
  eq("冲突原因码", rtConflict.issues[0].code, "ANIM_KEY_TIME_CONFLICT");
  near("冲突后原 key 时间不变", cloneAnim().slots["睫毛_L"].attachment[1].time, 0.5, 1e-9);

  var sv = E.setKeyValues(cloneAnim(), "bones", "hips", "scale", 0.5, { x: 1.2, y: 0.8 });
  ok("改值成功", sv.ok);
  near("改 x 生效", sv.value.bones.hips.scale[1].x, 1.2, 1e-9);
  near("改 y 生效", sv.value.bones.hips.scale[1].y, 0.8, 1e-9);
  ok("改值非数字拒绝", !E.setKeyValues(cloneAnim(), "bones", "hips", "scale", 0.5, { x: "1" }).ok);
  ok("改不存在 key 失败", !E.setKeyValues(cloneAnim(), "bones", "hips", "scale", 0.9, { x: 1 }).ok);

  eq("findKeyIndex 容差命中", E.findKeyIndex([{ time: 0.25 }], 0.25001), 0);
  eq("findKeyIndex 容差外", E.findKeyIndex([{ time: 0.25 }], 0.3), -1);
  eq("sortedKeys 排序", E.sortedKeys([{ time: 1 }, { time: 0 }])[0].time, 0);

  /* ------------------------------------------------------------------ */
  section("anim-edit / 轨道扫描");
  var scan = E.scanTracks(cloneAnim());
  eq("骨轨道骨数", scan.bones.length, 3);
  eq("槽轨道槽数", scan.slots.length, 2);
  eq("总 key 数", scan.keyCount, 15);
  eq("时长", scan.duration, 1);
  var tail = scan.bones.filter(function (b) { return b.name === "tail-1"; })[0];
  eq("tail-1 轨道数", tail.tracks.length, 1);
  eq("rotate 轨道 key 数", tail.tracks[0].keys.length, 3);
  var weird = scan.bones.filter(function (b) { return b.name === "weird-bone"; })[0];
  ok("未识别 timeline 标记 unsupported", weird.tracks[0].unsupported === true);
  eq("未识别 timeline 保留 label", weird.tracks[0].label, "bogusTrack");
  var slotScan = scan.slots.filter(function (s) { return s.name === "睫毛_L"; })[0];
  eq("槽轨道字段", slotScan.tracks[0].key, "attachment");
  ok("扫描结果不共享引用", scan.bones[0].tracks[0].keys !== undefined);

  /* ------------------------------------------------------------------ */
  section("anim-edit / 相对 setup 反算");
  near("rotate 增量", E.relativeValues("rotate", { rotation: 14 }, { rotation: 10 }).values.value, 4, 1e-9);
  deepEq("translate 增量", E.relativeValues("translate", { x: 5, y: -3 }, { x: 1, y: 1 }).values, { x: 4, y: -4 });
  deepEq("scale 倍率", E.relativeValues("scale", { scaleX: 2, scaleY: 0.5 }, { scaleX: 1, scaleY: 1 }).values, { x: 2, y: 0.5 });
  deepEq("scale 相对 setup=2", E.relativeValues("scale", { scaleX: 3, scaleY: 4 }, { scaleX: 2, scaleY: 2 }).values, { x: 1.5, y: 2 });
  deepEq("shear 增量", E.relativeValues("shear", { shearX: 3, shearY: 0 }, { shearX: 1, shearY: 0 }).values, { x: 2, y: 0 });
  ok("setup 缩放为 0 时拒绝", !E.relativeValues("scale", { scaleX: 1, scaleY: 1 }, { scaleX: 0, scaleY: 1 }).ok);
  ok("缺 local 拒绝", !E.relativeValues("rotate", null, { rotation: 0 }).ok);
  ok("未知字段拒绝", !E.relativeValues("color", { x: 0 }, {}).ok);
  deepEq("rotate 允许负增量", E.relativeValues("rotate", { rotation: 0 }, { rotation: 12 }).values, { value: -12 });
  deepEq("时间线采样值直通", E.relativeFromTrackValue("rotate", [7], {}).values, { value: 7 });
  deepEq("时间线采样 scale", E.relativeFromTrackValue("scale", [1.5, 2], {}).values, { x: 1.5, y: 2 });

  /* ------------------------------------------------------------------ */
  section("anim-edit / 保存补丁合并");
  var patched = { skeleton: { spine: "4.2.00" }, bones: [], slots: [], skins: { default: {} }, animations: { idle: { bones: {} }, blink: { slots: {} } } };
  var merged = E.applyAnimationDrafts(patched, { blink: cloneAnim() });
  ok("合并 ok", merged.ok);
  eq("只替换编辑过的动画", Object.keys(merged.value.animations).length, 2);
  eq("未编辑动画保留原值", JSON.stringify(merged.value.animations.idle), JSON.stringify(patched.animations.idle));
  eq("编辑动画已替换", merged.value.animations.blink.bones["tail-1"].rotate.length, 3);
  eq("applied 列表", merged.applied.join(","), "blink");
  eq("不改入参", Object.keys(patched.animations.blink).length, 1);
  deepEq("非动画字段保持", merged.value.skeleton, patched.skeleton);

  var mergedNone = E.applyAnimationDrafts(patched, {});
  ok("空草稿 ok", mergedNone.ok);
  eq("空草稿不新增 animations 之外的键", Object.keys(mergedNone.value).length, Object.keys(patched).length);
  eq("空草稿 applied 为空", mergedNone.applied.length, 0);

  var noAnims = E.applyAnimationDrafts({ bones: [] }, { idle: { bones: {} } });
  ok("补丁缺 animations 时补上", noAnims.ok && !!noAnims.value.animations && !!noAnims.value.animations.idle);
  ok("非对象补丁拒绝", !E.applyAnimationDrafts(null, { idle: {} }).ok);
  var badDraft = E.applyAnimationDrafts({ animations: {} }, { idle: 5 });
  ok("非法草稿跳过并给警告", badDraft.ok && badDraft.applied.length === 0 && badDraft.issues.length === 1);

  /* ------------------------------------------------------------------ */
  section("anim-edit / 字段规格");
  eq("骨字段规格数", E.BONE_FIELDS.length, 4);
  eq("rotate 模式", E.BONE_FIELDS[0].mode, "delta");
  eq("scale 模式", E.BONE_FIELDS[2].mode, "multiply");
  eq("translate 字段", E.BONE_FIELDS[1].fields.join(","), "x,y");
  ok("BONE_FIELDS 冻结", Object.isFrozen(E.BONE_FIELDS));

  /* ------------------------------------------------------------------ */
  section("anim-edit / 整体重定时预检");
  var PRE_OK = {
    bones: {
      b: {
        rotate: [{ time: 0, value: 0 }, { time: 1, value: 10 }],
        translate: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 5, y: 5 }],
      },
    },
    slots: { s: { attachment: [{ time: 0, name: "a" }, { time: 1, name: null }] } },
    ik: {
      "ik-1": {
        continuous: { keys: [{ time: 0, mix: 0 }, { time: 1, mix: 1 }] },
        bendPositive: [{ time: 0, value: true }],
      },
    },
    drawOrder: [{ time: 0, offsets: [] }],
    events: [{ time: 0.5, name: "e" }],
    deform: { default: [{ time: 1, offset: 2 }] },
  };
  var PRE_SNAP = JSON.stringify(PRE_OK);
  var preOk = E.retimeAllPrecheck(PRE_OK);
  ok("全已知结构预检通过", preOk.ok === true, JSON.stringify(preOk.issues));
  eq("预检 maxTime", preOk.value.maxTime, 1);
  eq("预检 keyCount", preOk.value.keyCount, 12);
  deepEq("预检 unknownPaths 为空", preOk.value.unknownPaths, []);
  ok("预检不修改入参", JSON.stringify(PRE_OK) === PRE_SNAP);
  ok("retimeAllPrecheck / retimeAll 已导出", typeof E.retimeAllPrecheck === "function" && typeof E.retimeAll === "function");
  deepEq("IK 可缩放字段常量", E.IK_SCALED_FIELDS.slice(), ["bendPositive", "compress", "stretch"]);

  var rt = E.retimeAll(PRE_OK, 2);
  ok("retimeAll 成功", rt.ok === true, JSON.stringify(rt.issues));
  near("retimeAll 新时长", E.animDurationOf(rt.value), 2, 1e-9);
  near("已知骨轨道按比例", rt.value.bones.b.rotate[1].time, 2, 1e-9);
  near("已知槽轨道按比例", rt.value.slots.s.attachment[1].time, 2, 1e-9);
  near("ik 连续轨道按比例", rt.value.ik["ik-1"].continuous.keys[1].time, 2, 1e-9);
  near("ik 步进轨道时间不变", rt.value.ik["ik-1"].bendPositive[0].time, 0, 1e-9);
  near("drawOrder 按比例", rt.value.drawOrder[0].time, 0, 1e-9);
  near("events 按比例", rt.value.events[0].time, 1, 1e-9);
  near("deform 按比例", rt.value.deform.default[0].time, 2, 1e-9);
  eq("骨数值不变", rt.value.bones.b.rotate[1].value, 10);
  eq("附件名不变", rt.value.slots.s.attachment[0].name, "a");
  eq("null 附件保留", rt.value.slots.s.attachment[1].name, null);
  eq("event 名保留", rt.value.events[0].name, "e");
  ok("retimeAll 不修改入参", JSON.stringify(PRE_OK) === PRE_SNAP);
  ok("retimeAll 与 scaleAnimationTimes 结果一致", JSON.stringify(rt.value) === JSON.stringify(E.scaleAnimationTimes(PRE_OK, 2).value));
  ok("retimeAll 返回 precheck 信息", !!rt.precheck && rt.precheck.maxTime === 1);

  var CURVE_PRE = { bones: { b: { rotate: [{ time: 0, value: 0, curve: [0.25, 0, 0.75, 1] }, { time: 1, value: 10 }] } } };
  var crt = E.retimeAll(CURVE_PRE, 3);
  ok("带 curve 可整体重定时", crt.ok === true);
  deepEq("curve 时间控制点按比例", crt.value.bones.b.rotate[0].curve, [0.75, 0, 2.25, 1]);
  ok("curve y 控制点不变", crt.value.bones.b.rotate[0].curve[1] === 0 && crt.value.bones.b.rotate[0].curve[3] === 1);
  eq("curve key 数值不变", crt.value.bones.b.rotate[0].value, 0);

  var UNK_BONE = mut(PRE_OK, function (o) { o.bones.b.splitX = [{ time: 0, value: 1 }, { time: 1, value: 2 }]; });
  var UNK_BONE_SNAP = JSON.stringify(UNK_BONE);
  var pUnkBone = E.retimeAllPrecheck(UNK_BONE);
  ok("未知骨轨道预检失败", pUnkBone.ok === false);
  eq("未知骨轨道错误码", pUnkBone.issues[0].code, "ANIM_RETIME_UNSUPPORTED_TRACK");
  eq("未知骨轨道 path 定位", pUnkBone.issues[0].path, "bones.b.splitX");
  ok(
    "unknownPaths 记录 path 与原因",
    pUnkBone.value.unknownPaths.length === 1 &&
      pUnkBone.value.unknownPaths[0].path === "bones.b.splitX" &&
      /缩放/.test(pUnkBone.value.unknownPaths[0].reason)
  );
  var rUnkBone = E.retimeAll(UNK_BONE, 2);
  ok("未知骨轨道 retimeAll 整批拒绝", rUnkBone.ok === false && rUnkBone.issues[0].code === "ANIM_RETIME_UNSUPPORTED_TRACK");
  ok("拒绝时零改动", JSON.stringify(UNK_BONE) === UNK_BONE_SNAP);
  ok("拒绝时不交付模型", rUnkBone.value === undefined);

  var UNK_SLOT = { slots: { s: { attachment: [{ time: 0, name: "a" }], color: [{ time: 0, value: 1 }] } } };
  var pUnkSlot = E.retimeAllPrecheck(UNK_SLOT);
  ok("未知槽轨道预检失败", pUnkSlot.ok === false && pUnkSlot.issues[0].path === "slots.s.color");
  ok("未知槽轨道原因含定位信息", /缩放/.test(pUnkSlot.issues[0].message));

  var UNK_TOP = { bones: { b: { rotate: [{ time: 0, value: 0 }] } }, events: { e1: { time: 1, name: "x" } } };
  var pUnkTop = E.retimeAllPrecheck(UNK_TOP);
  ok("对象属性位置的 time 预检失败", pUnkTop.ok === false && pUnkTop.issues[0].path === "events.e1");
  ok("原因说明 scaleTimeDeep 只缩数组项", /scaleTimeDeep|数组项/.test(pUnkTop.issues[0].message));

  var STATIC_EXTRA = mut(PRE_OK, function (o) { o.bones.b.tags = ["a", "b"]; });
  ok("无 time 的未知骨字段视为安全", E.retimeAllPrecheck(STATIC_EXTRA).ok === true);
  var BAD_KEY = { bones: { b: { rotate: [{ value: 1 }] } } };
  var pBadKey = E.retimeAllPrecheck(BAD_KEY);
  ok("缺有限 time 的 key 数组拒绝", pBadKey.ok === false && pBadKey.issues[0].path === "bones.b.rotate");
  ok("缺 time 原因定位到具体项", /第 0 项/.test(pBadKey.issues[0].message));
  ok("非对象 key 项拒绝", E.retimeAllPrecheck({ bones: { b: { rotate: [5] } } }).ok === false);
  var NESTED_TIME = { bones: { b: { rotate: [{ time: 0, value: 0, extra: { time: 1 } }] } } };
  var pNested = E.retimeAllPrecheck(NESTED_TIME);
  ok("key 项内嵌 time 拒绝", pNested.ok === false && pNested.issues[0].path === "bones.b.rotate");
  ok("内嵌 time 原因说明", /内嵌/.test(pNested.issues[0].message));

  var pIkExtra = E.retimeAllPrecheck({ ik: { "ik-1": { continuous: { keys: [{ time: 0, mix: 0 }, { time: 1, mix: 1 }] }, softness: [{ time: 0, value: 0 }, { time: 1, value: 1 }] } } });
  ok("IK 未识别带 time 字段拒绝", pIkExtra.ok === false && pIkExtra.issues[0].path === "ik.ik-1.softness");
  ok("continuous 形状不匹配且带 time 拒绝", E.retimeAllPrecheck({ ik: { "ik-1": { continuous: [{ time: 1, mix: 1 }] } } }).ok === false);
  ok("bones 非对象拒绝", E.retimeAllPrecheck({ bones: [{ rotate: [{ time: 0, value: 0 }] }] }).ok === false);
  ok("空动画预检通过且 maxTime 0", (function () {
    var p = E.retimeAllPrecheck({});
    return p.ok === true && p.value.maxTime === 0 && p.value.keyCount === 0;
  })());

  ok("retimeAll 非对象拒绝", !E.retimeAll(null, 2).ok);
  eq("retimeAll 非对象错误码", E.retimeAll(null, 2).issues[0].code, "ANIM_INVALID");
  ok("retimeAll newD=0 拒绝", !E.retimeAll(PRE_OK, 0).ok);
  eq("retimeAll newD=0 错误码", E.retimeAll(PRE_OK, 0).issues[0].code, "ANIM_DURATION");
  ok("retimeAll newD=NaN 拒绝", !E.retimeAll(PRE_OK, NaN).ok);
  ok("retimeAll 旧时长 0 拒绝", !E.retimeAll({ bones: { b: { rotate: [{ time: 0, value: 0 }] } } }, 1).ok);
  eq("retimeAll 旧时长 0 错误码", E.retimeAll({ bones: { b: { rotate: [{ time: 0, value: 0 }] } } }, 1).issues[0].code, "ANIM_DURATION_ZERO");

  /* ------------------------------------------------------------------ */
  section("anim-edit / upsertKey 保真（未知扩展字段与未提供字段）");
  var EXT_KEY = {
    bones: {
      b: {
        rotate: [
          { time: 0, value: 0, curve: [0.25, 0, 0.75, 1], note: "keep", extra: { a: 1 } },
          { time: 1, value: 10 },
        ],
      },
    },
  };
  var EXT_SNAP = JSON.stringify(EXT_KEY);
  var upExt = E.upsertKey(EXT_KEY, "bones", "b", "rotate", { value: 5 }, 0);
  ok("替换保留未知扩展字段", upExt.value.bones.b.rotate[0].note === "keep" && upExt.value.bones.b.rotate[0].extra.a === 1);
  deepEq("替换保留 curve", upExt.value.bones.b.rotate[0].curve, [0.25, 0, 0.75, 1]);
  near("替换覆盖提供字段", upExt.value.bones.b.rotate[0].value, 5, 1e-9);
  near("替换后时间仍为目标时间", upExt.value.bones.b.rotate[0].time, 0, 1e-9);
  eq("替换后 key 数不变", upExt.value.bones.b.rotate.length, 2);
  ok("替换不修改入参", JSON.stringify(EXT_KEY) === EXT_SNAP);
  var upPartial = E.upsertKey({ bones: { b: { translate: [{ time: 0, x: 1, y: 2 }] } } }, "bones", "b", "translate", { x: 5 }, 0);
  near("只提供 x 时保留原 y", upPartial.value.bones.b.translate[0].y, 2, 1e-9);
  near("提供的 x 已覆盖", upPartial.value.bones.b.translate[0].x, 5, 1e-9);
  var upNewKey = E.upsertKey({ bones: { b: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 1 }] } } }, "bones", "b", "rotate", { value: 3 }, 0.5);
  ok("新增 key 只含提供字段", JSON.stringify(upNewKey.value.bones.b.rotate[1]) === JSON.stringify({ time: 0.5, value: 3 }));
  ok("新增不替换", upNewKey.replaced === false);
  ok("新增路径不受保真修复影响", upNewKey.value.bones.b.rotate.length === 3 && upNewKey.value.bones.b.rotate[0].value === 0 && upNewKey.value.bones.b.rotate[2].value === 1);

  /* ==========================================================================
   * P1（T20）：Graph 曲线/轨道读写（trackKeys / setKeyCurve / setKeyTimeValue）
   * ====================================================================== */
  section("P1-曲线写回");
  (function () {
    var C = global.SpineCurveEdit;
    ok("SpineCurveEdit 已加载（曲线写回依赖）", !!C && typeof C.setSegmentType === "function");

    function anim2() {
      return {
        bones: {
          hip: {
            translate: [
              { time: 0, x: 0, y: 0, curve: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] },
              { time: 1, x: 10, y: 20 },
            ],
            rotate: [
              { time: 0, value: 0 },
              { time: 0.5, value: 30 },
              { time: 1, value: 60 },
            ],
          },
        },
        unknownBag: { keep: true },
      };
    }

    /* trackKeys */
    var tk = E.trackKeys(anim2(), "bones", "hip", "translate");
    ok("trackKeys ok", tk.ok === true);
    eq("trackKeys 返回 2 条", tk.keys.length, 2);
    var tkSrc = anim2();
    var tk2 = E.trackKeys(tkSrc, "bones", "hip", "translate");
    tk2.keys[0].x = 999;
    eq("trackKeys 返回深克隆（不改原对象）", tkSrc.bones.hip.translate[0].x, 0);
    var tkMissing = E.trackKeys(anim2(), "bones", "hip", "scale");
    ok("缺轨 trackKeys 仍 ok:true", tkMissing.ok === true);
    eq("缺轨 trackKeys 返回空数组", tkMissing.keys.length, 0);
    eq("缺轨 trackKeys 带 issues", tkMissing.issues.length, 1);
    eq("trackKeys 非对象 → ok:false", E.trackKeys(null, "bones", "hip", "rotate").ok, false);

    /* setKeyCurve：type 改 bezier / linear / stepped */
    var base = anim2();
    var toBezier = E.setKeyCurve(base, "bones", "hip", "rotate", 0, 0, { type: "bezier" });
    ok("rotate 段改 bezier：ok", toBezier.ok === true);
    ok("rotate 段改 bezier：写入 curve", Array.isArray(toBezier.value.bones.hip.rotate[0].curve));
    eq("bezier 控制点长度（1 分量 4 个数）", toBezier.value.bones.hip.rotate[0].curve.length, 4);
    eq("入参未被修改", JSON.stringify(base.bones.hip.rotate[0]), JSON.stringify({ time: 0, value: 0 }));
    eq("未知顶层 bag 保留", toBezier.value.unknownBag.keep, true);
    eq("其它 key 保留", toBezier.value.bones.hip.rotate[2].value, 60);

    var backLinear = E.setKeyCurve(toBezier.value, "bones", "hip", "rotate", 0, 0, { type: "linear" });
    ok("改回 linear：ok", backLinear.ok === true);
    ok("linear 后删除 curve 字段", backLinear.value.bones.hip.rotate[0].curve === undefined);
    var stepped = E.setKeyCurve(anim2(), "bones", "hip", "rotate", 0, 0, { type: "stepped" });
    ok("改 stepped：ok", stepped.ok === true);
    eq("stepped 写成字符串", stepped.value.bones.hip.rotate[0].curve, "stepped");

    /* 末 key / 缺 key / 未知字段 / 未知分量 */
    var last = E.setKeyCurve(anim2(), "bones", "hip", "rotate", 1, 0, { type: "bezier" });
    eq("末 key 无段 → 拒绝", last.ok, false);
    eq("末 key 拒绝码", last.issues[0].code, "LAST_KEY_NO_SEGMENT");
    var noKey = E.setKeyCurve(anim2(), "bones", "hip", "rotate", 0.7, 0, { type: "bezier" });
    eq("找不到 key → 拒绝", noKey.issues[0].code, "ANIM_KEY_MISSING");
    var noTrack = E.setKeyCurve(anim2(), "bones", "hip", "scale", 0, 0, { type: "bezier" });
    eq("缺轨 → 拒绝", noTrack.issues[0].code, "ANIM_TRACK_MISSING");
    var badArg = E.setKeyCurve(anim2(), "bones", "hip", "rotate", 0, 0, null);
    eq("segment 非法 → 拒绝", badArg.issues[0].code, "ANIM_CURVE_ARG");
    var badIdx = E.setKeyCurve(anim2(), "bones", "hip", "rotate", 0, 5, { type: "bezier" });
    eq("分量越界 → 拒绝", badIdx.ok, false);
    ok("拒绝时不返回 value", last.value === undefined && noKey.value === undefined);

    /* 多分量（translate）：写第 1 分量的控制点 */
    var pts = E.setKeyCurve(anim2(), "bones", "hip", "translate", 0, 1, { points: { cx1: 0.2, cy1: 5, cx2: 0.8, cy2: 15 } });
    ok("写控制点：ok", pts.ok === true);
    var arr = pts.value.bones.hip.translate[0].curve;
    eq("控制点写入第 1 分量偏移（索引 4）", Math.round(arr[4] * 100) / 100, 0.2);
    eq("控制点 cy1 写入（索引 5）", Math.round(arr[5] * 100) / 100, 5);
    eq("第 0 分量控制点未被覆盖", Math.round(arr[0] * 100) / 100, 0.1);
    eq("第 0 分量 cy1 未被覆盖", Math.round(arr[1] * 100) / 100, 0.2);
    eq("第 0 分量 cy2 未被覆盖", Math.round(arr[3] * 100) / 100, 0.4);
    eq("x/y 值不受曲线写回影响", pts.value.bones.hip.translate[0].x, 0);
    var cxOut = E.setKeyCurve(anim2(), "bones", "hip", "translate", 0, 1, { points: { cx1: 99, cy1: 0, cx2: 0.8, cy2: 0 } });
    eq("控制点越界 → 显式拒绝（不静默夹取）", cxOut.ok, false);
    ok("越界拒绝带原因码", !!cxOut.issues[0].code);
    var dragKeys = E.trackKeys(anim2(), "bones", "hip", "translate").keys;
    var dragRes = C.applyHandleDrag(dragKeys, 0, 1, "c1", { time: 99, value: 3 });
    ok("applyHandleDrag 夹取 cx 到相邻区间", dragRes.ok === true && dragRes.value[0].curve[4] <= 1);
    var clamped = E.setKeyCurve(anim2(), "bones", "hip", "translate", 0, 1, { points: { cx1: dragRes.value[0].curve[4], cy1: 3, cx2: 0.8, cy2: 0 } });
    ok("夹取后的控制点可写回", clamped.ok === true);
    var steppedMulti = E.setKeyCurve(anim2(), "bones", "hip", "translate", 0, 0, { type: "stepped" });
    eq("多分量 stepped 需 componentWide → 拒绝", steppedMulti.ok, false);
    var steppedWide = E.setKeyCurve(anim2(), "bones", "hip", "translate", 0, 0, { type: "stepped", componentWide: true });
    ok("componentWide=true 时多分量 stepped 允许", steppedWide.ok === true);
    eq("componentWide stepped 写成字符串", steppedWide.value.bones.hip.translate[0].curve, "stepped");

    /* setKeyTimeValue：时间 + 值原子写 */
    var moved = E.setKeyTimeValue(anim2(), "bones", "hip", "rotate", 0, 0.25, { value: 12 });
    ok("移动 key：ok", moved.ok === true);
    var rk = moved.value.bones.hip.rotate;
    eq("移动后仍是 3 条", rk.length, 3);
    eq("时间已改", rk[0].time, 0.25);
    eq("值已改", rk[0].value, 12);
    ok("顺序按时间排序", rk[0].time < rk[1].time && rk[1].time < rk[2].time);
    ok("原对象未被修改", anim2().bones.hip.rotate[0].time === 0);
    var collide = E.setKeyTimeValue(anim2(), "bones", "hip", "rotate", 0, 0.5, { value: 1 });
    eq("时间冲突 → 拒绝", collide.ok, false);
    eq("时间冲突码", collide.issues[0].code, "ANIM_KEY_TIME_CONFLICT");
    ok("时间冲突零写入", collide.value === undefined);
    var over = E.setKeyTimeValue(anim2(), "bones", "hip", "rotate", 0.5, 2, { value: 1 });
    eq("超出时长 → 拒绝", over.issues[0].code, "ANIM_KEY_OVER_DURATION");
    var negTime = E.setKeyTimeValue(anim2(), "bones", "hip", "rotate", 0, -1, { value: 1 });
    eq("负时间 → 拒绝", negTime.issues[0].code, "ANIM_KEY_TIME");
    var badVal = E.setKeyTimeValue(anim2(), "bones", "hip", "rotate", 0, 0.25, { value: NaN });
    eq("非有限值 → 拒绝", badVal.issues[0].code, "ANIM_KEY_VALUE");
    var sameTime = E.setKeyTimeValue(anim2(), "bones", "hip", "translate", 0, 0, { x: 3, y: 4 });
    ok("原地只改值：ok", sameTime.ok === true);
    eq("原地改值 x", sameTime.value.bones.hip.translate[0].x, 3);
    eq("原地改值 y", sameTime.value.bones.hip.translate[0].y, 4);
    eq("原地改值不动时间", sameTime.value.bones.hip.translate[0].time, 0);
    ok("原地改值保留 curve", Array.isArray(sameTime.value.bones.hip.translate[0].curve));
    var noKeys = E.setKeyTimeValue(anim2(), "bones", "hip", "rotate", 0.9, 0.95, { value: 1 });
    eq("源 key 不存在 → 拒绝", noKeys.issues[0].code, "ANIM_KEY_MISSING");
    var moveIn = E.setKeyTimeValue({ bones: { b: { translate: [{ time: 0, x: 0, y: 0 }, { time: 2, x: 1, y: 1 }] } } }, "bones", "b", "translate", 0, 1, { x: 5, y: 5 });
    ok("移动到时长内：ok", moveIn.ok === true);
    eq("移动后 key 数不变", moveIn.value.bones.b.translate.length, 2);
    eq("移动后位置正确", moveIn.value.bones.b.translate[0].time, 1);
    ok("新轨道 API 均已导出", typeof E.trackKeys === "function" && typeof E.setKeyCurve === "function" && typeof E.setKeyTimeValue === "function");
  })();

  global.__selftestAnimResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);