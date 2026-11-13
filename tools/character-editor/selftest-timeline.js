/*
 * selftest-timeline.js —— timeline.js 的纯函数自检（Node / 浏览器共用）
 * 依赖：timeline.js（globalThis.SpineTimeline）；可选 anim-edit.js（交叉核对 key 数/时长）、
 *       spine-core.js（真实 rig 解析态）；Node 下用 process.getBuiltinModule 读取真实 rig。
 * 输出：globalThis.__selftestTimelineResult = {passed, failed, total, skipped, cases, failures, notes}
 * 覆盖：行构建与排序 / 稳定键 / 未知 timeline 保留 / 时间映射往返 / 30fps 吸附 /
 *       key 命中与区间 / Bezier 邻接保护 / 标尺抽稀（100/300/1000 pxPerSec 标签不重叠）/
 *       重定时几何建议 / 真实 rig（idle/blink/expression_swap）与 anim-edit 一致性。
 * 浏览器/非 Node 环境：真实 rig 段自动跳过（skipped 计数），其余纯函数断言照跑。
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
  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function ascending(list, get) {
    for (var i = 1; i < list.length; i++) if (get(list[i - 1]) > get(list[i])) return false;
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 依赖加载
   * ------------------------------------------------------------------ */

  var nodeMods = null;
  function nodeBuiltins() {
    if (typeof process === "undefined" || !process.versions || !process.versions.node) return null;
    try {
      if (typeof process.getBuiltinModule !== "function") return null;
      return {
        fs: process.getBuiltinModule("node:fs"),
        module: process.getBuiltinModule("node:module"),
        cwd: process.cwd(),
      };
    } catch (e) {
      return null;
    }
  }
  nodeMods = nodeBuiltins();

  var ED_CANDIDATES = [];
  if (nodeMods) {
    ED_CANDIDATES.push(nodeMods.cwd + "/tools/character-editor", nodeMods.cwd);
  }
  function resolveExisting(paths) {
    if (!nodeMods) return null;
    for (var i = 0; i < paths.length; i++) {
      try {
        if (nodeMods.fs.existsSync(paths[i])) return paths[i];
      } catch (e) {
        return null;
      }
    }
    return null;
  }
  function requireSideEffect(file) {
    if (!nodeMods || !file) return false;
    try {
      var req = nodeMods.module.createRequire(nodeMods.cwd.replace(/[\\/]+$/, "") + "/selftest-timeline-loader.js");
      req(file);
      return true;
    } catch (e) {
      return false;
    }
  }

  var T = global.SpineTimeline;
  if (!T && nodeMods) {
    var timelineFile = resolveExisting(ED_CANDIDATES.map(function (d) { return d + "/timeline.js"; }));
    if (requireSideEffect(timelineFile)) T = global.SpineTimeline;
  }
  var E = global.SpineAnimEdit;
  if (!E && nodeMods) {
    var animEditFile = resolveExisting(ED_CANDIDATES.map(function (d) { return d + "/anim-edit.js"; }));
    if (requireSideEffect(animEditFile)) E = global.SpineAnimEdit;
  }

  if (!T) {
    record(false, "timeline.js 已加载（globalThis.SpineTimeline）", "存在", null);
    global.__selftestTimelineResult = result;
    return;
  }

  /* ------------------------------------------------------------------ *
   * 合成夹具
   * ------------------------------------------------------------------ */

  var MODEL = {
    boneIndex: new Map([["hips", 0], ["chest", 1], ["head", 2], ["tail-1", 3]]),
    slotIndex: new Map([["mouth", 0], ["eyes", 1]]),
    bones: [{ name: "hips" }, { name: "chest" }, { name: "head" }, { name: "tail-1" }],
    slots: [{ name: "mouth" }, { name: "eyes" }],
  };

  var ANIM = {
    bones: {
      "tail-1": {
        rotate: [
          { time: 0, value: -1 },
          { time: 0.5, value: 2, curve: [0, 0, 0.5, 1] },
          { time: 1, value: 0 },
        ],
      },
      head: {
        rotate: [{ time: 0, value: 0 }, { time: 1, value: 10 }],
        translate: [{ time: 0, x: 1, y: 2 }, { time: 0.25, x: 2, y: 3 }],
        bogusTrack: [{ time: 0, value: 1 }, { time: 2, value: 2 }],
      },
      hips: {
        scale: [{ time: 0, x: 1, y: 1 }, { time: 1, x: 1.1, y: 0.9 }],
        shear: [{ time: 0.5, x: 1, y: 0 }],
      },
      "weird-bone": { rotate: [{ time: 0, value: 0 }, { time: 0.75, value: 1 }] },
      emptybone: { rotate: [] },
    },
    slots: {
      eyes: {
        attachment: [
          { time: 0, name: "eye_open" },
          { time: 0.5, name: null },
          { time: 1, name: "eye_open" },
        ],
        color: [{ time: 0, value: 1 }],
      },
      mouth: { attachment: [{ time: 0, name: "mouth_x" }] },
      emptyslot: { attachment: [] },
    },
    events: [{ time: 0.25, name: "e1" }, { time: 2.5, name: "e2" }],
    deform: { skin: [{ time: 1, offset: 2 }] },
  };
  var ANIM_SNAPSHOT = JSON.stringify(ANIM);

  function cloneAnim() {
    return JSON.parse(ANIM_SNAPSHOT);
  }
  function rowsOf(built) {
    return built.rows;
  }
  function rowByKey(built, key) {
    for (var i = 0; i < built.rows.length; i++) if (T.rowKey(built.rows[i]) === key) return built.rows[i];
    return null;
  }

  /* ------------------------------------------------------------------ */
  section("timeline / 模块与常量");
  eq("API_VERSION", T.API_VERSION, 1);
  eq("默认帧率 30fps", T.DEFAULT_FPS, 30);
  eq("主刻度基准 0.5s", T.MAJOR_STEP_BASE, 0.5);
  eq("次刻度基准 0.1s", T.MINOR_STEP_BASE, 0.1);
  deepEq("骨字段固定序", T.BONE_FIELD_ORDER.slice(), ["rotate", "translate", "scale", "shear"]);
  ok("BONE_FIELD_META 冻结", Object.isFrozen(T.BONE_FIELD_META));
  eq("rotate 值类型 scalar", T.BONE_FIELD_META.rotate.valueKind, "scalar");
  eq("translate 值类型 vec2", T.BONE_FIELD_META.translate.valueKind, "vec2");
  eq("attachment 标签", T.SLOT_FIELD_META.attachment.label, "附件");
  ["buildRows", "rowKey", "compareRows", "timeToX", "xToTime", "clampTime", "snapTime", "keyAtTime",
    "keysInRange", "rulerTicks", "formatTime", "retimeSuggestion", "bezierLockedAt"].forEach(function (name) {
    eq("导出 " + name, typeof T[name], "function");
  });

  /* ------------------------------------------------------------------ */
  section("timeline / buildRows 行构建");
  var built = T.buildRows({ model: MODEL, animation: cloneAnim() });
  ok("构建 ok", built.ok);
  eq("总行数（7 骨 + 3 槽 + 2 顶层）", built.rows.length, 12);
  eq("骨+槽 key 数与 scanTracks 一致", built.boneSlotKeyCount, 19);
  eq("总 key 数含顶层时序", built.keyCount, 22);
  eq("unsupported 行数（bogus/color/events/deform）", built.unsupported, 4);
  eq("unsupportedRows 与计数一致", built.unsupportedRows.length, 4);
  if (E) eq("maxTime 与 anim-edit.animDurationOf 一致", built.maxTime, E.animDurationOf(cloneAnim()));
  eq("maxTime = 2.5（events 决定）", built.maxTime, 2.5);
  if (E) eq("骨+槽 key 数与 anim-edit.scanTracks 一致", built.boneSlotKeyCount, E.scanTracks(cloneAnim()).keyCount);

  var keysOrder = built.rows.map(function (r) { return T.rowKey(r); });
  deepEq("行顺序（骨按 boneIndex / 槽按 slotIndex / 顶层按名）", keysOrder, [
    "bone:hips:scale",
    "bone:hips:shear",
    "bone:head:rotate",
    "bone:head:translate",
    "bone:head:bogusTrack",
    "bone:tail-1:rotate",
    "bone:weird-bone:rotate",
    "slot:mouth:attachment",
    "slot:eyes:attachment",
    "slot:eyes:color",
    "timeline:deform:deform",
    "timeline:events:events",
  ]);
  ok("空轨道不建行（emptybone/emptyslot）", rowByKey(built, "bone:emptybone:rotate") === null && rowByKey(built, "slot:emptyslot:attachment") === null);

  var hipsScale = rowByKey(built, "bone:hips:scale");
  eq("hips 索引来自 model.boneIndex", hipsScale.ownerIndex, 0);
  eq("hips scale key 数", hipsScale.keyCount, 2);
  eq("scale 行 valueKind", hipsScale.valueKind, "vec2");
  eq("scale 行单位", hipsScale.unit, "×");

  var headRotate = rowByKey(built, "bone:head:rotate");
  eq("rotate key 值归一化为 number", headRotate.keys[1].value, 10);
  eq("rotate 行 label", headRotate.label, "旋转");
  var headTranslate = rowByKey(built, "bone:head:translate");
  deepEq("translate key 值 {x,y}", headTranslate.keys[0].value, { x: 1, y: 2 });
  var headBogus = rowByKey(built, "bone:head:bogusTrack");
  ok("未识别骨 timeline 标记 unsupported", headBogus.unsupported === true);
  eq("未识别骨 timeline 保留字段名", headBogus.field, "bogusTrack");
  eq("未识别骨 timeline key 数保留", headBogus.keyCount, 2);
  var weird = rowByKey(built, "bone:weird-bone:rotate");
  ok("未知骨行 ownerIndex 为 null", weird.ownerIndex === null);
  ok("未知骨排在同 kind 末尾", built.rows.indexOf(weird) > built.rows.indexOf(rowByKey(built, "bone:tail-1:rotate")));

  var eyesAtt = rowByKey(built, "slot:eyes:attachment");
  eq("attachment 值字符串", eyesAtt.keys[0].value, "eye_open");
  eq("attachment null 保留", eyesAtt.keys[1].value, null);
  eq("attachment 行 valueKind", eyesAtt.valueKind, "attachment");
  eq("eyes 索引来自 model.slotIndex", eyesAtt.ownerIndex, 1);
  var eyesColor = rowByKey(built, "slot:eyes:color");
  ok("槽未知字段标记 unsupported", eyesColor.unsupported === true);
  ok("槽附件行排在槽未知字段前", built.rows.indexOf(eyesAtt) < built.rows.indexOf(eyesColor));

  var tailRotate = rowByKey(built, "bone:tail-1:rotate");
  deepEq("raw 保留 curve", tailRotate.keys[1].raw.curve, [0, 0, 0.5, 1]);
  ok("row keys 时间升序", ascending(tailRotate.keys, function (k) { return k.time; }));
  eq("raw 是深克隆（不共享引用）", tailRotate.keys[1].raw === cloneAnim().bones["tail-1"].rotate[1], false);

  var eventsRow = rowByKey(built, "timeline:events:events");
  ok("events 顶层时序保留为 timeline 行", !!eventsRow && eventsRow.unsupported === true);
  eq("events key 数", eventsRow.keyCount, 2);
  eq("events key 名保留", eventsRow.keys[0].raw.name, "e1");
  var deformRow = rowByKey(built, "timeline:deform:deform");
  ok("deform 深度收集到 key", !!deformRow && deformRow.keyCount === 1);
  eq("deform 行 kind", deformRow.kind, "timeline");
  eq("timeline 行排在最后", built.rows[built.rows.length - 1].kind, "timeline");

  var builtAgain = T.buildRows({ model: MODEL, animation: cloneAnim() });
  builtAgain.rows[0].keys[0].raw.time = 999;
  eq("不改入参动画对象", JSON.stringify(ANIM), ANIM_SNAPSHOT);
  ok("重新构建不受上次结果影响", T.buildRows({ model: MODEL, animation: cloneAnim() }).rows[0].keys[0].time === 0);

  var noModel = T.buildRows({ animation: cloneAnim() });
  ok("无 model 也能构建", noModel.ok && noModel.rows.length === 12);
  ok("无 model 时 ownerIndex 全为 null", noModel.rows.every(function (r) { return r.ownerIndex === null; }));
  var arrayModel = T.buildRows({
    model: { bones: [{ name: "hips" }, { name: "head" }], slots: [{ name: "mouth" }] },
    animation: { bones: { head: { rotate: [{ time: 0, value: 1 }] }, hips: { rotate: [{ time: 0, value: 0 }] } } },
  });
  deepEq("数组形态 model 也能解析索引", arrayModel.rows.map(function (r) { return r.ownerIndex; }), [0, 1]);

  var bad = T.buildRows({ animation: null });
  ok("animation 非对象返回 ok:false", !bad.ok && bad.issues.length === 1);
  eq("animation 非对象原因码", bad.issues[0].code, "TIMELINE_ANIMATION_INVALID");
  var empty = T.buildRows({ animation: {} });
  ok("空动画 ok 且无行", empty.ok && empty.rows.length === 0);
  eq("空动画 maxTime 0", empty.maxTime, 0);
  eq("空动画 unsupported 0", empty.unsupported, 0);

  /* ------------------------------------------------------------------ */
  section("timeline / 稳定键与排序");
  eq("rowKey 稳定键", T.rowKey(hipsScale), "bone:hips:scale");
  eq("rowKey 无行返回空串", T.rowKey(null), "");
  var rA = { kind: "bone", owner: "a", ownerIndex: 5, field: "rotate" };
  var rB = { kind: "bone", owner: "b", ownerIndex: 2, field: "rotate" };
  ok("compareRows 按 ownerIndex", T.compareRows(rB, rA) < 0);
  var rSlot = { kind: "slot", owner: "a", ownerIndex: 0, field: "attachment" };
  ok("骨行排在槽行前", T.compareRows(rA, rSlot) < 0);
  var rTime = { kind: "timeline", owner: "a", ownerIndex: null, field: "a" };
  ok("槽行排在顶层时序前", T.compareRows(rSlot, rTime) < 0);
  var rRot = { kind: "bone", owner: "a", ownerIndex: 5, field: "rotate" };
  var rSh = { kind: "bone", owner: "a", ownerIndex: 5, field: "shear" };
  ok("字段固定序 rotate < shear", T.compareRows(rRot, rSh) < 0);
  var rUnk = { kind: "bone", owner: "a", ownerIndex: 5, field: "zzz" };
  ok("未知字段排在固定字段后", T.compareRows(rSh, rUnk) < 0);
  var rNull1 = { kind: "bone", owner: "z", ownerIndex: null, field: "rotate" };
  var rNull2 = { kind: "bone", owner: "y", ownerIndex: null, field: "rotate" };
  ok("未知 owner 按名字排序", T.compareRows(rNull2, rNull1) < 0);
  var sorted = [rNull1, rB, rA, rSlot, rTime].slice().sort(T.compareRows);
  deepEq("整表排序结果稳定", sorted.map(function (r) { return T.rowKey(r); }), ["bone:b:rotate", "bone:a:rotate", "bone:z:rotate", "slot:a:attachment", "timeline:a:a"]);

  /* ------------------------------------------------------------------ */
  section("timeline / 时间映射");
  eq("timeToX 基本换算", T.timeToX({ time: 1.5, pxPerSec: 100 }), 150);
  eq("timeToX 含滚动", T.timeToX({ time: 1.5, scrollSec: 0.5, pxPerSec: 100 }), 100);
  eq("timeToX 默认缩放 100px/s", T.timeToX({ time: 2 }), 200);
  eq("xToTime 基本换算", T.xToTime({ x: 150, pxPerSec: 100 }), 1.5);
  eq("xToTime 含滚动", T.xToTime({ x: 100, scrollSec: 0.5, pxPerSec: 100 }), 1.5);
  near("往返一致 0", T.timeToX({ time: T.xToTime({ x: 0, pxPerSec: 300 }), pxPerSec: 300 }), 0, 1e-9);
  near("往返一致 1.234", T.timeToX({ time: T.xToTime({ x: 370.2, pxPerSec: 300 }), pxPerSec: 300 }), 370.2, 1e-9);
  ok("timeToX 非有限时间返回 NaN", isNaN(T.timeToX({ time: NaN, pxPerSec: 100 })));
  ok("timeToX 非法缩放返回 NaN", isNaN(T.timeToX({ time: 1, pxPerSec: 0 })));
  ok("xToTime 非有限 x 返回 NaN", isNaN(T.xToTime({ x: Infinity, pxPerSec: 100 })));
  ok("xToTime 非法缩放返回 NaN", isNaN(T.xToTime({ x: 1, pxPerSec: -5 })));

  eq("clampTime 上限", T.clampTime(1.5, 1), 1);
  eq("clampTime 下限默认 0", T.clampTime(-1, 1), 0);
  eq("clampTime 区间内不变", T.clampTime(0.5, 1), 0.5);
  eq("clampTime 非有限时间取下限", T.clampTime(NaN, 1), 0);
  eq("clampTime 对象形态", T.clampTime({ time: 2, max: 1.5, min: 0.5 }), 1.5);
  eq("clampTime 无上限", T.clampTime(3, Infinity), 3);

  eq("snapTime 30fps 四舍五入到帧", T.snapTime({ time: 0.51 }), 0.5);
  eq("snapTime 帧内保持", T.snapTime({ time: 0.9 }), 0.9);
  near("snapTime 1 帧 = 1/30", T.snapTime({ time: 0.02 }), 1 / 30, 1e-9);
  eq("snapTime enabled=false 原值", T.snapTime({ time: 0.51, enabled: false }), 0.51);
  eq("snapTime 非法 fps 原值", T.snapTime({ time: 0.51, fps: 0 }), 0.51);
  eq("snapTime 自定义 fps", T.snapTime({ time: 0.51, fps: 10 }), 0.5);
  ok("snapTime 非有限时间 NaN", isNaN(T.snapTime({ time: NaN })));
  eq("frameOf 帧号", T.frameOf(0.9, 30), 27);

  /* ------------------------------------------------------------------ */
  section("timeline / key 命中与区间");
  var rotKeys = cloneAnim().bones["tail-1"].rotate;
  eq("keyIndexAtTime 容差命中", T.keyIndexAtTime(rotKeys, 0.50001), 1);
  eq("keyIndexAtTime 容差外", T.keyIndexAtTime(rotKeys, 0.6), -1);
  ok("keyAtTime 返回原 key 引用", T.keyAtTime(rotKeys, 0.5) === rotKeys[1]);
  eq("keyAtTime 未命中 null", T.keyAtTime(rotKeys, 5, 1e-3), null);
  ok("keyHasCurve 识别数组 curve", T.keyHasCurve(rotKeys[1]) === true);
  ok("keyHasCurve 无 curve false", T.keyHasCurve(rotKeys[0]) === false);
  ok("bezierLockedAt 自带 curve 锁定", T.bezierLockedAt(rotKeys, 1) === true);
  ok("bezierLockedAt 前一个 key 带 curve 锁定", T.bezierLockedAt(rotKeys, 2) === true);
  ok("bezierLockedAt 首 key 不锁定", T.bezierLockedAt(rotKeys, 0) === false);
  ok("bezierLockedAt 越界 false", T.bezierLockedAt(rotKeys, 9) === false);

  var inRange = T.keysInRange(built.rows, 0, 0.5);
  eq("[0,0.5] 命中 key 数", inRange.length, 14);
  ok("区间结果按时间升序", ascending(inRange, function (k) { return k.time; }));
  eq("区间结果带 rowKey", inRange[0].rowKey, "bone:hips:scale");
  eq("区间包含边界 t=0", inRange[0].time, 0);
  eq("末 key 边界含尾（t=2.5 命中）", T.keysInRange(built.rows, 2.5, 2.5).length, 1);
  eq("t>末 key 无命中", T.keysInRange(built.rows, 2.6, 3).length, 0);
  eq("空区间无命中", T.keysInRange(built.rows, 10, 20).length, 0);
  eq("from>to 自动交换", T.keysInRange(built.rows, 0.5, 0).length, 14);
  eq("空行数组返回空", T.keysInRange([], 0, 1).length, 0);
  eq("单行对象也可查询", T.keysInRange(hipsScale, 0, 0).length, 1);
  eq("单 key 时间点命中", T.keysInRange(built.rows, 0.75, 0.75).length, 1);

  /* ------------------------------------------------------------------ */
  section("timeline / D1 curve 保护（normalized key）");
  var builtCurve = T.buildRows({ model: MODEL, animation: cloneAnim() });
  var curveRow = rowByKey(builtCurve, "bone:tail-1:rotate");
  var nk = curveRow.keys;
  ok("normalized key 保留 curve 数组", Array.isArray(nk[1].curve) && nk[1].curve.length === 4);
  deepEq("normalized curve 数值与原始一致", nk[1].curve, [0, 0, 0.5, 1]);
  ok("normalized key.raw 仍保留 curve", Array.isArray(nk[1].raw.curve) && nk[1].raw.curve.length === 4);
  ok("keyHasCurve 识别 normalized key（key.curve）", T.keyHasCurve(nk[1]) === true);
  ok("keyHasCurve 识别 raw-only key（只有 key.raw.curve）", T.keyHasCurve({ time: 0, value: 1, raw: { time: 0, value: 1, curve: [0, 0, 1, 1] } }) === true);
  ok("keyHasCurve 原始 raw key 形态仍为 true", T.keyHasCurve({ time: 0, curve: [0, 0, 1, 1] }) === true);
  ok("keyHasCurve 无 curve 为 false", T.keyHasCurve(nk[0]) === false && T.keyHasCurve({ time: 0, value: 1 }) === false);
  ok("keyHasCurve 空 curve 数组为 false", T.keyHasCurve({ time: 0, curve: [] }) === false);
  ok("bezierLockedAt：自身带 curve（normalized）锁定", T.bezierLockedAt(nk, 1) === true);
  ok("bezierLockedAt：前驱带 curve（normalized）锁定", T.bezierLockedAt(nk, 2) === true);
  ok("bezierLockedAt：normalized 无 curve key 不锁定", T.bezierLockedAt(nk, 0) === false);
  var sugCurve = T.retimeSuggestion({ keys: nk, index: 2, toTime: 1.5, maxTime: 3, fps: 30 });
  ok("retimeSuggestion 对 normalized curve 邻接返回 bezierLocked", sugCurve.ok && sugCurve.bezierLocked === true);
  ok(
    "retimeSuggestion locked 时给出明确拒绝字段",
    sugCurve.blocked === true && sugCurve.applyable === false && sugCurve.reason === "ANIM_CURVE_EDIT_UNSUPPORTED"
  );
  var sugFree = T.retimeSuggestion({ keys: nk, index: 0, toTime: 1.5, maxTime: 3, fps: 30 });
  ok(
    "retimeSuggestion 无 curve 邻接时可应用",
    sugFree.ok && sugFree.bezierLocked === false && sugFree.blocked === false && sugFree.applyable === true && sugFree.reason === null
  );
  ok("D1 修复不改变 raw 入参", JSON.stringify(ANIM) === ANIM_SNAPSHOT);

  /* ------------------------------------------------------------------ */
  section("timeline / 搜索·过滤·锁定（filterRows / rowState / selectedRows）");
  var fbase = T.buildRows({ model: MODEL, animation: cloneAnim() });
  var snapBase = JSON.stringify(fbase.rows);
  var all = T.filterRows({ rows: fbase.rows });
  eq("空过滤行数不变", all.rows.length, fbase.rows.length);
  eq("空过滤 visible = total", all.visibleRows.length, all.total);
  ok("空过滤 matched = total", all.matched === all.total);
  ok("空过滤不改入参", JSON.stringify(fbase.rows) === snapBase);
  var searchBone = T.filterRows({ rows: fbase.rows, search: "TAIL-1" });
  ok("搜索骨名大小写无关", searchBone.visibleRows.length > 0 && searchBone.visibleRows.every(function (r) { return r.owner === "tail-1"; }));
  var searchField = T.filterRows({ rows: fbase.rows, search: "rotate" });
  ok("搜索字段名", searchField.visibleRows.length > 0 && searchField.visibleRows.every(function (r) { return r.field === "rotate"; }));
  var searchLabel = T.filterRows({ rows: fbase.rows, search: "旋转" });
  ok("搜索中文标签", searchLabel.visibleRows.length > 0 && searchLabel.visibleRows.every(function (r) { return r.field === "rotate"; }));
  var searchAnd = T.filterRows({ rows: fbase.rows, search: "tail rotate" });
  ok("多词 AND", searchAnd.visibleRows.length > 0 && searchAnd.visibleRows.every(function (r) { return r.owner === "tail-1" && r.field === "rotate"; }));
  var searchNone = T.filterRows({ rows: fbase.rows, search: "zzz-nope" });
  eq("无命中 visible = 0", searchNone.visibleRows.length, 0);
  eq("无命中仍保留全部行（只标记不删除）", searchNone.rows.length, fbase.rows.length);
  ok("无命中行标 filtered", searchNone.rows.every(function (r) { return r.filtered === true; }));
  eq("空白搜索恒等", T.filterRows({ rows: fbase.rows, search: "   " }).visibleRows.length, fbase.rows.length);
  eq("非字符串搜索恒等", T.filterRows({ rows: fbase.rows, search: 42 }).visibleRows.length, fbase.rows.length);
  var withEmpty = fbase.rows.concat([{ kind: "bone", owner: "tail-1", ownerIndex: null, field: "shear", label: "斜切", unit: "°", valueKind: "scalar", keys: [], keyCount: 0 }]);
  var onlyKeyed = T.filterRows({ rows: withEmpty, onlyKeyed: true });
  ok("onlyKeyed 滤掉空行", onlyKeyed.visibleRows.every(function (r) { return r.keyCount > 0; }));
  eq("onlyKeyed 可见行 = 有 Key 行数", onlyKeyed.visibleRows.length, fbase.rows.length);
  eq("onlyKeyed 不删除空行", onlyKeyed.rows.length, withEmpty.length);
  ok("onlyKeyed 空行标 filtered", onlyKeyed.rows[onlyKeyed.rows.length - 1].filtered === true);
  eq("onlyKeyed OFF 空行可见", T.filterRows({ rows: withEmpty, onlyKeyed: false }).visibleRows.length, withEmpty.length);
  var lockKey = T.rowKey(fbase.rows[0]);
  var lockedRes = T.filterRows({ rows: fbase.rows, locked: [lockKey] });
  ok("锁定行被标记", lockedRes.rows[0].locked === true && lockedRes.locked === 1);
  ok("锁定行仍可见", lockedRes.visibleRows.some(function (r) { return T.rowKey(r) === lockKey; }));
  ok("locked 支持 Set", T.filterRows({ rows: fbase.rows, locked: new Set([lockKey]) }).rows[0].locked === true);
  ok("locked 支持对象映射", (function () { var o = {}; o[lockKey] = true; return T.filterRows({ rows: fbase.rows, locked: o }).rows[0].locked === true; })());
  var hiddenKey = T.rowKey(fbase.rows[fbase.rows.length - 1]);
  var hiddenRes = T.filterRows({ rows: fbase.rows, hidden: [hiddenKey] });
  ok("隐藏行被标记且不在 visibleRows", hiddenRes.rows.some(function (r) { return T.rowKey(r) === hiddenKey && r.hidden === true; }) && !hiddenRes.visibleRows.some(function (r) { return T.rowKey(r) === hiddenKey; }));
  eq("隐藏行仍在 rows 中（数据保留）", hiddenRes.rows.length, fbase.rows.length);
  eq("hidden 计数", hiddenRes.hidden, 1);
  var groupsIn = [
    { key: "group:tail-1", label: "tail-1", children: fbase.rows.filter(function (r) { return r.owner === "tail-1"; }).map(function (r) { return T.rowKey(r); }) },
    { key: "group:other", label: "other", children: ["bone:root:rotate"] },
  ];
  var grouped = T.filterRows({ rows: fbase.rows, search: "tail-1", groups: groupsIn });
  ok("groups：命中组保留", grouped.groups[0].filtered === false && grouped.groups[0].matchedChildren > 0);
  ok("groups：未命中组标记 filtered", grouped.groups[1].filtered === true);
  ok("filterRows rows 非数组拒绝", T.filterRows({ rows: null }).ok === false);
  ok("rowSearchText 含 owner/field/label", T.rowSearchText(fbase.rows[0]).indexOf(String(fbase.rows[0].owner).toLowerCase()) >= 0);
  var st1 = T.rowState(fbase.rows[0], { locked: [lockKey], selected: [lockKey] });
  ok("rowState 锁定 → editable false", st1.locked === true && st1.editable === false && st1.selected === true && st1.visible === true);
  var st2 = T.rowState(fbase.rows[1], {});
  ok("rowState 无配置 → 可编辑可见", st2.locked === false && st2.editable === true && st2.visible === true && st2.selected === false);
  var st3 = T.rowState(fbase.rows[1], { hidden: [T.rowKey(fbase.rows[1])] });
  ok("rowState 隐藏 → visible false 但 editable true", st3.hidden === true && st3.visible === false && st3.editable === true);
  eq("rowState 未知行 key 为空", T.rowState(null, {}).key, "");
  var selRows = T.selectedRows(fbase.rows, [T.rowKey(fbase.rows[0]), T.rowKey(fbase.rows[2]), "bone:nope:rotate"]);
  eq("selectedRows 命中 2", selRows.count, 2);
  deepEq("selectedRows 未命中报出", selRows.missing, ["bone:nope:rotate"]);
  ok("selectedRows 保持 rows 顺序", T.rowKey(selRows.rows[0]) === T.rowKey(fbase.rows[0]) && T.rowKey(selRows.rows[1]) === T.rowKey(fbase.rows[2]));
  eq("selectedRows 支持 Set", T.selectedRows(fbase.rows, new Set([T.rowKey(fbase.rows[1])])).count, 1);
  eq("selectedRows 空选择", T.selectedRows(fbase.rows, []).count, 0);

  /* ------------------------------------------------------------------ */
  section("timeline / 空轨补齐（withEmptyBoneTracks）");
  var miniModel = { bones: [{ name: "root" }, { name: "tail-1" }, { name: "hip" }] };
  var emptyBase = T.buildRows({ model: MODEL, animation: { bones: { "tail-1": { rotate: [{ time: 0, value: 1 }] } } } });
  var filled = T.withEmptyBoneTracks(emptyBase.rows, miniModel);
  eq("补齐行数 = 3 骨 × 4 字段 − 已有 1 行", filled.added, 11);
  eq("补齐后总行数", filled.rows.length, emptyBase.rows.length + 11);
  ok("已有行不被覆盖（key 仍在）", filled.rows.some(function (r) { return r.owner === "tail-1" && r.field === "rotate" && r.keyCount === 1; }));
  ok("补齐行 keys 为空、keyCount 0", filled.addedRows.every(function (r) { return Array.isArray(r.keys) && r.keys.length === 0 && r.keyCount === 0; }));
  ok("补齐行不设 unsupported", filled.addedRows.every(function (r) { return r.unsupported === undefined; }));
  ok("ownerIndex 取骨索引", filled.addedRows.filter(function (r) { return r.owner === "hip"; }).every(function (r) { return r.ownerIndex === 2; }));
  deepEq("字段顺序 rotate/translate/scale/shear", filled.addedRows.filter(function (r) { return r.owner === "root"; }).map(function (r) { return r.field; }), ["rotate", "translate", "scale", "shear"]);
  eq("rowKey 稳定", T.rowKey(filled.addedRows[0]), "bone:root:rotate");
  var again = T.withEmptyBoneTracks(filled.rows, miniModel);
  eq("重复调用幂等（不再补）", again.added, 0);
  eq("幂等后行数不变", again.rows.length, filled.rows.length);
  var includeOff = T.withEmptyBoneTracks(emptyBase.rows, miniModel, { includeEmpty: false });
  eq("includeEmpty=false 不补", includeOff.added, 0);
  eq("includeEmpty=false 原样返回", includeOff.rows.length, emptyBase.rows.length);
  eq("opts.fields 限定字段（tail-1 rotate 已存在 → 只补 root/hip）", T.withEmptyBoneTracks(emptyBase.rows, miniModel, { fields: ["rotate"] }).added, 2);
  var noBones = T.withEmptyBoneTracks(emptyBase.rows, {});
  ok("model 缺 bones → ok:false", noBones.ok === false && noBones.issues.length === 1);
  var unknownKeep = T.withEmptyBoneTracks(emptyBase.rows.concat([{ kind: "timeline", owner: "unknownBag", field: "unknownBag", keys: [], keyCount: 0 }]), miniModel);
  ok("未知轨原样保留且不补造", unknownKeep.rows.some(function (r) { return r.kind === "timeline" && r.owner === "unknownBag"; }) && !unknownKeep.addedRows.some(function (r) { return r.kind === "timeline"; }));
  eq("槽行数量不受影响", T.withEmptyBoneTracks(fbase.rows, MODEL).rows.filter(function (r) { return r.kind === "slot"; }).length, fbase.rows.filter(function (r) { return r.kind === "slot"; }).length);
  var withEmptyAll = T.withEmptyBoneTracks(fbase.rows, MODEL);
  ok("onlyKeyed OFF：每根 model 骨都有四类基础字段", MODEL.bones.every(function (b) {
    return ["rotate", "translate", "scale", "shear"].every(function (f) {
      return withEmptyAll.rows.some(function (r) { return r.kind === "bone" && r.owner === b.name && r.field === f; });
    });
  }));
  eq("onlyKeyed ON 回到原行数", T.filterRows({ rows: withEmptyAll.rows, onlyKeyed: true }).visibleRows.length, fbase.rows.length);

  /* ------------------------------------------------------------------ */
  section("timeline / 标尺与格式");
  var ticks100 = T.rulerTicks({ from: 0, to: 2, pxPerSec: 100 });
  var majors100 = ticks100.filter(function (t) { return t.major; });
  eq("100px/s 主刻度数（0.5s 步长）", majors100.length, 5);
  deepEq("100px/s 主刻度时间", majors100.map(function (t) { return t.time; }), [0, 0.5, 1, 1.5, 2]);
  eq("主刻度标签", majors100[1].label, "0.50s");
  eq("次刻度标签为空串", ticks100.filter(function (t) { return !t.major; })[0].label, "");
  eq("100px/s 次刻度 0.1s", ticks100[1].time, 0.1);
  ok("100px/s 存在次刻度", ticks100.some(function (t) { return !t.major; }));
  ok("刻度时间严格升序", ascending(ticks100, function (t) { return t.time; }));
  ok("主刻度间距 ≥ 最小标签宽", majors100.every(function (t, i) {
    return i === 0 || (t.time - majors100[i - 1].time) * 100 >= 46 - 1e-9;
  }));
  eq("刻度数 = 5 主 + 16 次", ticks100.length, 21);
  ok("100px/s 主刻度无重叠（相邻 ≥46px）", T.chooseMajorStep(100, 46) * 100 >= 46);
  ok("300px/s 主刻度无重叠", T.chooseMajorStep(300, 46) * 300 >= 46);
  ok("1000px/s 主刻度无重叠", T.chooseMajorStep(1000, 46) * 1000 >= 46);
  var majors300 = T.rulerTicks({ from: 0, to: 2, pxPerSec: 300 }).filter(function (t) { return t.major; });
  ok("300px/s 标签间距 ≥46px", majors300.every(function (t, i) { return i === 0 || (t.time - majors300[i - 1].time) * 300 >= 46 - 1e-9; }));
  var majors1000 = T.rulerTicks({ from: 0, to: 2, pxPerSec: 1000 }).filter(function (t) { return t.major; });
  ok("1000px/s 标签间距 ≥46px", majors1000.every(function (t, i) { return i === 0 || (t.time - majors1000[i - 1].time) * 1000 >= 46 - 1e-9; }));
  eq("低缩放抽稀主刻度（20px/s → 5s）", T.chooseMajorStep(20, 46), 5);
  eq("50px/s 抽稀到 1s", T.chooseMajorStep(50, 46), 1);
  var lowTicks = T.rulerTicks({ from: 0, to: 60, pxPerSec: 20 });
  var lowMajors = lowTicks.filter(function (t) { return t.major; });
  ok("低缩放标签不重叠", lowMajors.every(function (t, i) { return i === 0 || (t.time - lowMajors[i - 1].time) * 20 >= 46 - 1e-9; }));
  var offsetTicks = T.rulerTicks({ from: 0.2, to: 1.2, pxPerSec: 100 });
  eq("from 之后首个主刻度", offsetTicks[0].time, 0.5);
  ok("from 之前不出现刻度", offsetTicks.every(function (t) { return t.time >= 0.2 - 1e-9; }));
  ok("次刻度间隔选择（1s 主刻度 → 0.2s）", T.chooseMinorStep(1, 40, 5) === 0.2);
  ok("次刻度太密时抽稀（5s 主刻度 @20px/s → 0.5s）", T.chooseMinorStep(5, 20, 5) === 0.5);
  eq("空区间只有起点主刻度", T.rulerTicks({ from: 0, to: 0, pxPerSec: 100 }).length, 1);
  eq("自定义主刻度生效", T.rulerTicks({ from: 0, to: 2, pxPerSec: 100, majorStep: 1 }).filter(function (t) { return t.major; }).length, 3);

  eq("formatTime 两位小数", T.formatTime(1.5), "1.50s");
  eq("formatTime 零", T.formatTime(0), "0.00s");
  eq("formatTime 自定义小数位", T.formatTime(1.5, { decimals: 1 }), "1.5s");
  eq("formatTime 去单位", T.formatTime(1.5, { unit: "" }), "1.50");
  eq("formatTime 非有限数", T.formatTime(NaN), "-");

  /* ------------------------------------------------------------------ */
  section("timeline / 重定时几何建议");
  var sug = T.retimeSuggestion({ keys: rotKeys, index: 2, toTime: 0.9, maxTime: 1, fps: 30, snapEnabled: true });
  ok("建议 ok", sug.ok);
  eq("建议时间", sug.time, 0.9);
  eq("未夹取", sug.clamped, false);
  eq("无冲突", sug.conflict, null);
  ok("Bezier 邻接锁定（前一个 key 带 curve）", sug.bezierLocked === true);
  var sugClamp = T.retimeSuggestion({ keys: rotKeys, index: 2, toTime: 5, maxTime: 0.8, fps: 30 });
  eq("超出 maxTime 夹取", sugClamp.time, 0.8);
  ok("标记已夹取", sugClamp.clamped === true);
  var sugNeg = T.retimeSuggestion({ keys: rotKeys, index: 0, toTime: -0.5, maxTime: 2 });
  eq("负时间夹到 0", sugNeg.time, 0);
  var sugConflict = T.retimeSuggestion({ keys: rotKeys, index: 2, toTime: 0.5, maxTime: 2 });
  eq("目标时间撞 key 报冲突", sugConflict.conflict, 0.5);
  var sugNoSnap = T.retimeSuggestion({ keys: rotKeys, index: 2, toTime: 0.91, maxTime: 2, snapEnabled: false });
  eq("关闭吸附保留原值", sugNoSnap.time, 0.91);
  ok("非法 keys 拒绝", !T.retimeSuggestion({ keys: null, toTime: 1 }).ok);
  ok("找不到 key 拒绝", !T.retimeSuggestion({ keys: rotKeys, fromTime: 9, toTime: 1 }).ok);
  ok("目标时间非有限数拒绝", !T.retimeSuggestion({ keys: rotKeys, index: 0, toTime: NaN }).ok);
  var sugFrom = T.retimeSuggestion({ keys: rotKeys, fromTime: 0.5, toTime: 0.7, maxTime: 1 });
  eq("用 fromTime 定位并吸附", sugFrom.time, 0.7);

  /* ------------------------------------------------------------------ */
  section("timeline / 规划书 §4.3 槽位颜色 + §4.3/§4.5 离散轨道");

  ok("SLOT_FIELD_META 含 color", !!T.SLOT_FIELD_META.color);
  ok("SLOT_FIELD_META 含 twoColor", !!T.SLOT_FIELD_META.twoColor);
  eq("color 的 valueKind", T.SLOT_FIELD_META.color.valueKind, "color");
  eq("twoColor 的 valueKind", T.SLOT_FIELD_META.twoColor.valueKind, "colorPair");
  eq("color 中文标签", T.SLOT_FIELD_META.color.label, "颜色");

  var colorAnim = {
    slots: {
      hair: {
        attachment: [{ time: 0, name: "hair-1" }, { time: 1, name: null }],
        color: [{ time: 0, value: "FFFFFFFF" }, { time: 0.5, value: "FF000080" }],
        twoColor: [{ time: 0, light: "FFFFFFFF", dark: "000000FF" }],
      },
    },
  };
  var cRows = T.buildRows({ animation: colorAnim });
  var colorRow = cRows.rows.filter(function (r) { return r.field === "color"; })[0];
  var twoRow = cRows.rows.filter(function (r) { return r.field === "twoColor"; })[0];
  var attRow = cRows.rows.filter(function (r) { return r.field === "attachment"; })[0];
  ok("color 行存在", !!colorRow);
  ok("twoColor 行存在", !!twoRow);
  eq("color 行 valueKind", colorRow.valueKind, "color");
  eq("color 行 key 数", colorRow.keyCount, 2);
  deepEq("color 值原样透传（不转 rgb）", colorRow.keys.map(function (k) { return k.value; }), ["FFFFFFFF", "FF000080"]);
  ok("color 行标 unsupported（core 未求值，不能假装预览生效）", colorRow.unsupported === true);
  ok("color 行标 previewPartial", colorRow.previewPartial === true);
  ok("color 行有 note 说明", typeof colorRow.note === "string" && colorRow.note.length > 0);
  eq("twoColor 行 valueKind", twoRow.valueKind, "colorPair");
  deepEq("twoColor 值拆成 light/dark", twoRow.keys[0].value, { light: "FFFFFFFF", dark: "000000FF" });
  ok("attachment 行仍是 attachment 语义", attRow.valueKind === "attachment" && !attRow.unsupported);
  ok("color 与 attachment 是两条独立行", colorRow.field !== attRow.field);
  eq("颜色类行计入 partial（color + twoColor 共 2 行）", cRows.partial, 2);
  eq("颜色类行也标 unsupported（core 未求值 → 允许「只读结构」以外的语义标记）", cRows.unsupported, 2);
  deepEq("partialRows 列出两条颜色轨", cRows.partialRows.map(function (r) { return r.field; }).sort(), ["color", "twoColor"]);
  ok("颜色行 kind 仍是 slot（不伪装成未知轨道）", colorRow.kind === "slot");
  ok("partial 与 unsupported 是两个独立计数（不得合并）", typeof cRows.partial === "number" && typeof cRows.unsupported === "number");
  var plainRows = T.buildRows({ animation: { bones: { b: { rotate: [{ time: 0 }] } } } });
  eq("普通骨骼行 partial=0", plainRows.partial, 0);
  eq("普通骨骼行 unsupported=0", plainRows.unsupported, 0);

  var noDark = T.normalizeKey("colorPair", { time: 0, light: "AABBCCDD" });
  deepEq("twoColor 缺 dark 不猜（保持 null）", noDark.value, { light: "AABBCCDD", dark: null });
  var noColor = T.normalizeKey("color", { time: 0 });
  eq("color 缺字段返回 null", noColor.value, null);
  var viaColorField = T.normalizeKey("color", { time: 0, color: "11223344" });
  eq("color 兼容挂在 color 字段上", viaColorField.value, "11223344");

  eq("formatValue 颜色原样输出", T.formatValue("color", "FF000080"), "FF000080");
  eq("formatValue 颜色为 null 时给占位", T.formatValue("color", null), "—");
  eq("formatValue 双色给出亮/暗", T.formatValue("colorPair", { light: "FFFFFFFF", dark: "000000FF" }), "亮 FFFFFFFF / 暗 000000FF");
  eq("formatValue 双色缺项用占位", T.formatValue("colorPair", { light: "AA", dark: null }), "亮 AA / 暗 —");
  eq("formatValue 附件为 null 给中文占位", T.formatValue("attachment", null), "（无附件）");
  eq("formatValue 附件给名字", T.formatValue("attachment", "hair-1"), "hair-1");
  eq("formatValue 标量带单位", T.formatValue("scalar", 12.34567, { decimals: 2, unit: "°" }), "12.35°");
  eq("formatValue 未知 kind 返回 null（不猜）", T.formatValue("nope", 1), null);

  eq("附件轨道是离散轨道", T.isDiscreteTrack("slot", "attachment").discrete, true);
  eq("事件轨道是离散轨道", T.isDiscreteTrack("event", "x").discrete, true);
  eq("绘制顺序是离散轨道", T.isDiscreteTrack("drawOrder", "x").discrete, true);
  eq("旋转轨道不是离散轨道", T.isDiscreteTrack("bone", "rotate").discrete, false);
  eq("形变轨道不是离散轨道", T.isDiscreteTrack("deform", "x").discrete, false);
  ok("离散判定带原因文本", (T.isDiscreteTrack("slot", "attachment").reason || "").length > 0);

  /* ------------------------------------------------------------------ */
  section("timeline / 真实 rig（idle/blink/expression_swap）");
  var rigRoot = null;
  if (nodeMods) {
    var bases = [
      nodeMods.cwd + "/workspace/three-view-to-spine-anime/step2/handoffs/rig",
      nodeMods.cwd + "/../workspace/three-view-to-spine-anime/step2/handoffs/rig",
      nodeMods.cwd + "/../../workspace/three-view-to-spine-anime/step2/handoffs/rig",
    ];
    rigRoot = resolveExisting(bases.map(function (b) { return b + "/model.json"; }));
    if (rigRoot) rigRoot = rigRoot.slice(0, -"/model.json".length);
  }
  if (!rigRoot) {
    skip("真实 rig 段（需要 Node + 仓库根 cwd）", "未找到 workspace/three-view-to-spine-anime/step2/handoffs/rig/model.json");
  } else {
    var raw = null;
    try {
      raw = JSON.parse(nodeMods.fs.readFileSync(rigRoot + "/model.json", "utf8"));
    } catch (e) {
      raw = null;
      record(false, "真实 rig model.json 可解析", "JSON", String(e && e.message));
    }
    if (raw) {
      ok("真实 rig 可读（skeleton.spine=4.2）", typeof raw.skeleton.spine === "string" && raw.skeleton.spine.indexOf("4.2") === 0, raw.skeleton.spine);
      eq("真实 rig 骨数（与 handoff 同步后为 43：37 原骨 + 4 根 IK target + 2 根呆毛分段）", raw.bones.length, 43);
      eq("真实 rig 槽数（含 0.9.41 拆出的「嘴巴特效」槽）", raw.slots.length, 38);
      /* 上面两条原来是写死的 37/37，注释却声称「不再钉死全量名单」——自相矛盾：
         · 槽数从 0.9.41 拆出「嘴巴特效」槽起就变成 38，这条断言一直没跟上；
         · 骨数在 0.9.54 加 4 根 IK target 骨后变成 41。
         钉死数字会让**正常的骨架演进**被判回归。真正该守的是**结构合法性**，
         所以下面这组断言才是主力；数字断言只作为「改动是否被同步」的提示。 */
      var boneNames = raw.bones.map(function (b) { return b.name; });
      var dupBones = boneNames.filter(function (n, i) { return boneNames.indexOf(n) !== i; });
      eq("真实 rig 骨名唯一（重名清单为空）", JSON.stringify(dupBones), "[]");
      var boneNameSet = {};
      boneNames.forEach(function (n) { boneNameSet[n] = true; });
      var orphanParents = raw.bones.filter(function (b) { return b.parent && !boneNameSet[b.parent]; });
      eq("真实 rig 每根骨的 parent 都存在（孤儿清单为空）",
        JSON.stringify(orphanParents.map(function (b) { return b.name + "→" + b.parent; })), "[]");
      var slotBoneMissing = raw.slots.filter(function (s) { return !boneNameSet[s.bone]; });
      eq("真实 rig 每个槽的 bone 都存在（缺失清单为空）",
        JSON.stringify(slotBoneMissing.map(function (s) { return s.name; })), "[]");
      /* IK 的结构完整性：约束引用的骨与 target 都必须真实存在，且两骨约束必须是直接父子 */
      var ikList = raw.ik || [];
      var ikBad = [];
      ikList.forEach(function (c) {
        (c.bones || []).forEach(function (bn) { if (!boneNameSet[bn]) ikBad.push(c.name + ".bones=" + bn); });
        if (!boneNameSet[c.target]) ikBad.push(c.name + ".target=" + c.target);
        if ((c.bones || []).length === 2) {
          var parent = raw.bones.filter(function (b) { return b.name === c.bones[0]; })[0];
          var child = raw.bones.filter(function (b) { return b.name === c.bones[1]; })[0];
          if (!parent || !child || child.parent !== parent.name) {
            ikBad.push(c.name + " 两骨不是直接父子（" + (c.bones || []).join("→") + "）");
          }
        }
      });
      eq("真实 rig 的 IK 约束结构合法（问题清单为空）", JSON.stringify(ikBad), "[]");
      ok("真实 rig 的 IK 受控子骨都有 length（否则求解器会判 zeroLength 保留 FK）",
        ikList.every(function (c) {
          if ((c.bones || []).length !== 2) return true;
          var child = raw.bones.filter(function (b) { return b.name === c.bones[1]; })[0];
          return !!child && typeof child.length === "number" && child.length > 0;
        }),
        ikList.map(function (c) { return c.name; }));
      // 真实 rig 是**可变生产数据**（workspace/…/rig/model.json），动画集会随契约演进；
      // 这里只断言「三个基础动画必须存在、且不得少于它们」，不再钉死全量名单。
      // 全量名单的权威来源是 rig-meta 与 design/expr-anim-contract.md，不是本自测。
      ok("真实 rig 含三个基础动画",
        ["idle", "blink", "expression_swap"].every(function (n) { return Object.keys(raw.animations).indexOf(n) >= 0; }),
        Object.keys(raw.animations));
      ok("真实 rig 动画数不为空（>=3）", Object.keys(raw.animations).length >= 3, Object.keys(raw.animations).length);

      /* ---- rig-meta.slotGroups 合法性（0.9.59）----
         这条守卫的来历：0.9.41 把 `嘴巴特效` 拆成独立槽（槽数 37→38），但 rig-meta 的
         slotGroups 是按槽名枚举的，新槽没被任何组覆盖。后果是编辑器**静默回退成 37 行平铺列表**
         （界面上只有一条黄色提示），分组视图完全失效，而且一直没人发现。
         真正的生成源头是 build_rig.py 的 SLOT_GROUPS，这里直接校验最终产物，两边都守住。 */
      var rigMetaPath = rigRoot + "/rig-meta.json";
      var rigMeta = null;
      try { rigMeta = JSON.parse(nodeMods.fs.readFileSync(rigMetaPath, "utf8")); } catch (e) { rigMeta = null; }
      ok("真实 rig 的 rig-meta.json 可解析", !!rigMeta);
      if (rigMeta) {
        var groups = Array.isArray(rigMeta.slotGroups) ? rigMeta.slotGroups : [];
        ok("rig-meta 有 slotGroups", groups.length > 0);
        var slotNames = raw.slots.map(function (s) { return s.name; });

        /* a) 全覆盖：每个槽都必须属于某一组，否则编辑器回退平铺 */
        var covered = {};
        groups.forEach(function (g) { (g.slots || []).forEach(function (n) { covered[n] = (covered[n] || 0) + 1; }); });
        var uncovered = slotNames.filter(function (n) { return !covered[n]; });
        eq("slotGroups 全覆盖模型全部槽（未覆盖清单为空）", JSON.stringify(uncovered), "[]");

        /* b) 无重复（同一槽出现在两个组里会导致组序校验失败） */
        var dupMembers = Object.keys(covered).filter(function (n) { return covered[n] > 1; });
        eq("slotGroups 无重复成员", JSON.stringify(dupMembers), "[]");

        /* c) 无未知槽名（分组里写了模型没有的槽） */
        var unknownMembers = Object.keys(covered).filter(function (n) { return slotNames.indexOf(n) < 0; });
        eq("slotGroups 不含未知槽名", JSON.stringify(unknownMembers), "[]");

        /* d) 每组是连续 z 区间 + e) 组序前→背严格递减
           注意组序判据是「本组 maxIndex < 上一组 minIndex」，不是跟前一组的 max 比 ——
           我第一版诊断脚本写成 min <= prevMax，把 7 个合法组全判成重叠。 */
        var groupProblems = [];
        var prevMin = Infinity;
        groups.forEach(function (g) {
          var idx = (g.slots || []).map(function (n) { return slotNames.indexOf(n); }).filter(function (i) { return i >= 0; });
          if (!idx.length) { groupProblems.push(g.name + ": 空组"); return; }
          idx.sort(function (a, b) { return a - b; });
          var minI = idx[0], maxI = idx[idx.length - 1];
          if (maxI - minI !== idx.length - 1) groupProblems.push(g.name + ": 非连续 z 区间");
          if (!(maxI < prevMin)) groupProblems.push(g.name + ": 组序不递减（max=" + maxI + " prevMin=" + prevMin + "）");
          prevMin = minI;
        });
        eq("slotGroups 每组连续且组序前→背递减（问题清单为空）", JSON.stringify(groupProblems), "[]");
        ok("表情组含「嘴巴特效」（0.9.41 拆出的槽必须登记）",
          (groups.filter(function (g) { return g.id === "expr"; })[0] || { slots: [] }).slots.indexOf("嘴巴特效") >= 0,
          JSON.stringify((groups.filter(function (g) { return g.id === "expr"; })[0] || { slots: [] }).slots));
      }

      if (!global.SpineCore && nodeMods) {
        var coreFile = resolveExisting(ED_CANDIDATES.map(function (d) { return d + "/spine-core.js"; }));
        requireSideEffect(coreFile);
      }
      var M = null;
      if (global.SpineCore && typeof global.SpineCore.parseModel === "function") {
        var atlasRes = global.SpineCore.parseAtlas(nodeMods.fs.readFileSync(rigRoot + "/model.atlas", "utf8"));
        var modelRes = global.SpineCore.parseModel(raw, atlasRes.value, { skin: "default" });
        ok("真实 rig parseModel 成功", modelRes.ok, modelRes.issues && modelRes.issues.length);
        if (modelRes.ok) M = modelRes.value;
      } else {
        skip("spine-core.parseModel 交叉核对", "SpineCore 未加载，改用最小 model 索引");
      }
      if (!M) {
        var boneIndex = new Map();
        var slotIndex = new Map();
        raw.bones.forEach(function (b, i) { boneIndex.set(b.name, i); });
        raw.slots.forEach(function (s, i) { slotIndex.set(s.name, i); });
        M = { bones: raw.bones, slots: raw.slots, boneIndex: boneIndex, slotIndex: slotIndex };
      }

      var idleRows = T.buildRows({ model: M, animation: raw.animations.idle });
      /* 0.9.118：改为动态期望 —— 从模型实际轨道数计算，不再绑定具体动画数据 */
      var idleExpectRows = Object.keys(raw.animations.idle.bones || {}).reduce(function (n, b) {
        return n + Object.keys(raw.animations.idle.bones[b]).length;
      }, 0);
      eq("idle 行数（动态：实际骨轨数）", idleRows.rows.length, idleExpectRows);
      var idleExpectKeys = 0;
      Object.keys(raw.animations.idle.bones || {}).forEach(function (b) {
        Object.keys(raw.animations.idle.bones[b]).forEach(function (f) {
          idleExpectKeys += raw.animations.idle.bones[b][f].length;
        });
      });
      eq("idle key 总数（动态）", idleRows.boneSlotKeyCount, idleExpectKeys);
      eq("idle 总 key 数（无顶层时序，动态）", idleRows.keyCount, idleExpectKeys);
      near("idle 最大时间 3.5s", idleRows.maxTime, 3.5, 1e-9);
      eq("idle 无 unsupported 行", idleRows.unsupported, 0);
      eq("idle 首行 hips scale", T.rowKey(idleRows.rows[0]), "bone:hips:scale");
      var idleFirstExpect = raw.animations.idle.bones.hips.scale.length;
      eq("idle 首行 key 数（动态）", idleRows.rows[0].keyCount, idleFirstExpect);
      ok("idle 全部为骨行", idleRows.rows.every(function (r) { return r.kind === "bone"; }));
      ok("idle 每行 key 数与该轨真实键数一致", idleRows.rows.every(function (r) {
        var parts = r.owner != null && r.field ? raw.animations.idle.bones[r.owner] : null;
        if (!parts || !parts[r.field]) return true;
        return r.keyCount === parts[r.field].length;
      }));
      ok("idle 行按 boneIndex 升序", ascending(idleRows.rows, function (r) { return r.ownerIndex; }));
      ok("idle 每行 key 时间升序", idleRows.rows.every(function (r) { return ascending(r.keys, function (k) { return k.time; }); }));
      eq("idle rotate 行值类型 scalar", rowByKey(idleRows, "bone:head:rotate").valueKind, "scalar");
      if (E) {
        eq("idle key 数与 anim-edit.scanTracks 一致", idleRows.boneSlotKeyCount, E.scanTracks(raw.animations.idle).keyCount);
        eq("idle 时长与 anim-edit.animDurationOf 一致", idleRows.maxTime, E.animDurationOf(raw.animations.idle));
      }
      var idleRange = T.keysInRange(idleRows.rows, 0, 0.125);
      var idleRangeExpect = 0;
      Object.keys(raw.animations.idle.bones || {}).forEach(function (b) {
        Object.keys(raw.animations.idle.bones[b]).forEach(function (f) {
          raw.animations.idle.bones[b][f].forEach(function (k) {
            if (k.time >= 0 && k.time <= 0.125) idleRangeExpect++;
          });
        });
      });
      eq("idle [0,0.125] 命中数（动态）", idleRange.length, idleRangeExpect);

      var blinkRows = T.buildRows({ model: M, animation: raw.animations.blink });
      eq("blink 行数（8 槽轨）", blinkRows.rows.length, 8);
      eq("blink key 总数", blinkRows.boneSlotKeyCount, 58);
      var blinkOwnerEarly = Object.keys(raw.animations.blink.slots)[0];
      var blinkRawLast = raw.animations.blink.slots[blinkOwnerEarly].attachment;
      var blinkExpectDur = blinkRawLast[blinkRawLast.length - 1].time;
      near("blink 时长（动态取附件轨末键）", blinkRows.maxTime, blinkExpectDur, 1e-9);
      ok("blink 全部为槽附件行", blinkRows.rows.every(function (r) { return r.kind === "slot" && r.field === "attachment"; }));
      ok("blink 槽名保留中文", blinkRows.rows.every(function (r) { return typeof r.owner === "string" && r.owner.length > 0; }));
      ok("blink 含睫毛_L 槽行", rowByKey(blinkRows, "slot:睫毛_L:attachment") !== null);
      ok("blink 行按 slotIndex 升序", ascending(blinkRows.rows, function (r) { return r.ownerIndex; }));
      ok("blink 附件值含 null（闭眼）", blinkRows.rows.some(function (r) { return r.keys.some(function (k) { return k.value === null; }); }));
      var blinkOwner = Object.keys(raw.animations.blink.slots)[0];
      var blinkRawTimes = raw.animations.blink.slots[blinkOwner].attachment.map(function (k) { return k.time; });
      var blinkRow = rowByKey(blinkRows, "slot:" + blinkOwner + ":attachment");
      deepEq("float32 噪声时间原样透传（不做帧量化）", blinkRow.keys.map(function (k) { return k.time; }), blinkRawTimes);
      ok("含非 1/30 整数倍的原始噪声时间", blinkRawTimes.some(function (t) { return Math.abs(t * 30 - Math.round(t * 30)) > 1e-3; }));
      if (E) eq("blink key 数与 anim-edit 一致", blinkRows.boneSlotKeyCount, E.scanTracks(raw.animations.blink).keyCount);

      var exprRows = T.buildRows({ model: M, animation: raw.animations.expression_swap });
      eq("expression_swap 行数（11 槽轨）", exprRows.rows.length, 11);
      eq("expression_swap key 总数", exprRows.boneSlotKeyCount, 33);
      near("expression_swap 时长 ≈0.3s", exprRows.maxTime, 0.29999998211860657, 1e-9);
      if (E) {
        eq("expression_swap key 数与 anim-edit 一致", exprRows.boneSlotKeyCount, E.scanTracks(raw.animations.expression_swap).keyCount);
        eq("expression_swap 时长与 anim-edit 一致", exprRows.maxTime, E.animDurationOf(raw.animations.expression_swap));
      }
      var rowKeysByIdle = idleRows.rows.map(T.rowKey);
      var rowKeysByBlink = blinkRows.rows.map(T.rowKey);
      var rowKeysByExpr = exprRows.rows.map(T.rowKey);
      eq("idle rowKey 唯一", new Set(rowKeysByIdle).size, idleRows.rows.length);
      eq("blink rowKey 唯一", new Set(rowKeysByBlink).size, blinkRows.rows.length);
      eq("expression_swap rowKey 唯一", new Set(rowKeysByExpr).size, exprRows.rows.length);
      ok("rowKey 是动画内稳定键（跨动画同名槽可复用）", rowKeysByBlink.indexOf("slot:睫毛_L:attachment") >= 0 && rowKeysByExpr.indexOf("slot:睫毛_L:attachment") >= 0);
      var totalKeys = idleRows.keyCount + blinkRows.keyCount + exprRows.keyCount;
      var expectTotal = idleRows.boneSlotKeyCount + blinkRows.boneSlotKeyCount + exprRows.boneSlotKeyCount;
      eq("三动画 key 总数（动态累加）", totalKeys, expectTotal);
      result.notes.push({ name: "真实 rig 统计", detail: "idle 10 行/290 key/3.5s；blink 8 行/58 key/0.15s；expression_swap 11 行/33 key/0.30s；共 381 key" });
    }
  }

  global.__selftestTimelineResult = result;
  if (typeof window !== "undefined") window.__selftestTimelineResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
