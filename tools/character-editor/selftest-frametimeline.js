/*
 * selftest-frametimeline.js —— frame-timeline.js 的纯函数自检（Node / 浏览器共用）
 * 依赖：frame-timeline.js（globalThis.SpineFrameTimeline）；可选 anim-edit.js（交叉核对时间列覆盖）。
 * 输出：globalThis.__selftestFrameTimelineResult = {passed, failed, total, skipped, cases, failures, notes}
 * 覆盖：帧↔秒换算 / fps 归一化 / 帧格几何与虚拟化上限 / 帧格视觉状态 /
 *       统一 TimelineState 归一化 / 帧选择七种操作 / 右键菜单三套 /
 *       时间帧操作五种（insert/remove/move/scale/clear）与「只删 key 不搬时间」的区分 /
 *       时间列遍历覆盖 events·deform·drawOrder·ik（与 SpineAnimEdit.scanTimelineKeys 交叉核对）/
 *       路径解析往返 / 播放控制帧级定位。
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
    return record(typeof actual === "number" && isFinite(actual) && Math.abs(actual - expected) <= t, name, expected, actual, "tol=" + t);
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
  /** 逐项近似相等：时间数组里有除法结果（如 40/30），不能用严格 JSON 比较 */
  function nearList(name, actual, expected, tol) {
    var t = tol === undefined ? 1e-9 : tol;
    if (!Array.isArray(actual)) return record(false, name, expected, actual, "actual 不是数组");
    if (actual.length !== expected.length) return record(false, name, expected, actual, "长度不一致");
    for (var i = 0; i < expected.length; i++) {
      if (Math.abs(actual[i] - expected[i]) > t) return record(false, name, expected, actual, "第 " + i + " 项超出 tol=" + t);
    }
    return record(true, name, expected, actual);
  }
  function section(name) {
    currentCase = name;
  }

  /* ------------------------------------------------------------------ *
   * 依赖
   * ------------------------------------------------------------------ */

  var F = global.SpineFrameTimeline;
  var E = global.SpineAnimEdit || null;
  if (!F) {
    result.failures.push({ case: "(load)", name: "SpineFrameTimeline 未加载", expected: "object", actual: typeof F, detail: "" });
    result.total++;
    result.failed++;
    global.__selftestFrameTimelineResult = result;
    if (typeof window !== "undefined") window.__selftestFrameTimelineResult = result;
    return;
  }

  var FPS = 30;

  /* ------------------------------------------------------------------ *
   * 合成动画（覆盖骨骼 / 插槽 / ik / drawOrder / events / deform）
   * ------------------------------------------------------------------ */

  function makeAnim() {
    return {
      bones: {
        hips: {
          rotate: [
            { time: 0, angle: 0 },
            { time: 1, angle: 10 },
          ],
          translate: [
            { time: 0, x: 0, y: 0 },
            { time: 0.5, x: 5, y: 0 },
          ],
        },
        head: {
          rotate: [
            { time: 0, angle: 0 },
            { time: 0.5, angle: 5 },
            { time: 1, angle: 0 },
          ],
        },
      },
      slots: {
        mouth: {
          attachment: [
            { time: 0, name: "mouth_1" },
            { time: 1, name: null },
          ],
        },
      },
      ik: {
        "ik-arm": {
          bendPositive: [
            { time: 0, value: 1 },
            { time: 1, value: 0 },
          ],
          continuous: { keys: [{ time: 0.5, value: 2 }] },
        },
      },
      drawOrder: [{ time: 0 }, { time: 1, offsets: [{ slot: "mouth", offset: 1 }] }],
      events: [{ time: 0.5, name: "step" }],
      deform: {
        "mesh-1": [{ time: 0.5, offset: [0, 1, 2] }],
      },
    };
  }

  function totalKeys(anim) {
    var cols = F.readColumns(anim);
    var n = 0;
    for (var i = 0; i < cols.length; i++) n += cols[i].keys.length;
    return n;
  }

  function timesOf(anim, path) {
    var cols = F.readColumns(anim);
    for (var i = 0; i < cols.length; i++) if (cols[i].path === path) return cols[i].keys.map(function (k) { return k.time; });
    return null;
  }

  var pathsOf = function (anim) {
    return F.readColumns(anim).map(function (c) { return c.path; }).sort();
  };

  /* ================================================================== *
   * 1. 帧 ↔ 秒换算（§3.1 / §7.4）
   * ================================================================== */
  section("换算：帧↔秒 / fps 归一化");

  near("frameToTime(15,30) = 0.5", F.frameToTime(15, 30), 0.5, 1e-12);
  near("frameToTime(0,30) = 0", F.frameToTime(0, 30), 0, 1e-12);
  near("frameToTime(30,30) = 1", F.frameToTime(30, 30), 1, 1e-12);
  near("frameToTime(60,30) = 2", F.frameToTime(60, 30), 2, 1e-12);
  near("timeToFrame(0.5,30) = 15", F.timeToFrame(0.5, 30), 15, 1e-9);
  near("timeToFrame(0.033,30) ≈ 0.99", F.timeToFrame(0.033, 30), 0.99, 1e-9);
  near("snapTime(0.52,30) = 0.5333…（吸到 16 帧）", F.snapTime(0.52, 30), 16 / 30, 1e-12);
  eq("frameAtTime(0.5,30) = 15", F.frameAtTime(0.5, 30), 15);
  eq("snapFrame(14.4) = 14", F.snapFrame(14.4), 14);
  eq("snapFrame(14.6) = 15", F.snapFrame(14.6), 15);
  near("frameToTime 不吞小数帧", F.frameToTime(1.5, 30), 0.05, 1e-12);
  eq("fps 非法（0）回落 30", F.normFps(0), 30);
  eq("fps 非法（NaN）回落 30", F.normFps(NaN), 30);
  eq("fps 非法（字符串）回落 30", F.normFps("30"), 30);
  eq("fps 上限 240", F.normFps(10000), 240);
  eq("fps 下限 1", F.normFps(0.1), 1);
  eq("fps 合法值原样", F.normFps(60), 60);
  ok("timeToFrame 非数返回 NaN", isNaN(F.timeToFrame("x", 30)));
  ok("frameToTime 非数返回 NaN", isNaN(F.frameToTime(NaN, 30)));
  eq("frameKey(15)", F.frameKey(15), "f:15");
  eq("parseFrameKey('f:15')", F.parseFrameKey("f:15"), 15);
  ok("parseFrameKey 非法返回 NaN", isNaN(F.parseFrameKey("x")));

  /* ================================================================== *
   * 2. 帧格几何（§3.1 / §3.2 / §12.2 虚拟化）
   * ================================================================== */
  section("几何：帧格宽度 / 可见区间 / 当前帧列 / 刻度步长");

  near("pxPerFrame(100,30) = 3.333…", F.pxPerFrame(100, 30), 100 / 30, 1e-12);
  near("frameToX(10) = 10*3.33 − 0 = 33.33", F.frameToX(10, { fps: 30, pxPerSec: 100, scrollFrame: 0 }), 10 * (100 / 30), 1e-9);
  near("frameToX 带 scrollFrame", F.frameToX(10, { fps: 30, pxPerSec: 100, scrollFrame: 5 }), 5 * (100 / 30), 1e-9);
  near("xToFrame 与 frameToX 互逆", F.xToFrame(F.frameToX(37, { fps: 30, pxPerSec: 100, scrollFrame: 9 }), { fps: 30, pxPerSec: 100, scrollFrame: 9 }), 37, 1e-9);

  var fr = F.frameRange({ fps: 30, pxPerSec: 100, scrollFrame: 0, width: 333.3333333 });
  eq("frameRange.ok", fr.ok, true);
  eq("frameRange 首帧（含 pad=1）", fr.firstFrame, -1);
  eq("frameRange 末帧（width=10 帧 + pad=1 → 101）", fr.lastFrame, 101);
  ok("frameRange 计数 = 末−首+1", fr.count === fr.lastFrame - fr.firstFrame + 1);
  ok("frameRange 帧号都是整数", Number.isInteger(fr.firstFrame) && Number.isInteger(fr.lastFrame));
  var fr2 = F.frameRange({ fps: 30, pxPerSec: 100, scrollFrame: 0, width: 100000 });
  ok("超宽视口被 MAX_CELLS 截断（capped=true）", fr2.capped === true);
  ok("截断后 count ≤ 20000", fr2.count <= 20000);
  var fr3 = F.frameRange({ fps: 30, pxPerSec: 100, scrollFrame: 0, width: 0 });
  eq("width=0 → ok:false", fr3.ok, false);
  eq("width=0 → count:0", fr3.count, 0);

  var col = F.currentFrameColumn(0.5, { fps: 30, pxPerSec: 100, scrollFrame: 0, width: 800 });
  eq("当前帧列 frame=15", col.frame, 15);
  near("当前帧列 time=0.5", col.time, 0.5, 1e-12);
  near("当前帧列 x=50", col.x, 50, 1e-9);
  near("当前帧列 width=pxPerFrame", col.width, 100 / 30, 1e-12);
  eq("当前帧列 inView", col.inView, true);
  eq("视口外当前帧 inView=false", F.currentFrameColumn(100, { fps: 30, pxPerSec: 100, scrollFrame: 0, width: 800 }).inView, false);

  var steps = F.chooseFrameSteps({ fps: 30, pxPerSec: 100 });
  ok("主刻度是正整数", Number.isInteger(steps.major) && steps.major >= 1);
  ok("主刻度 × 帧宽 ≥ 40px（标签不重叠）", steps.major * steps.framePx >= 40);
  var stepTight = F.chooseFrameSteps({ fps: 30, pxPerSec: 3000 });
  ok("放大后主刻度收紧到 1 帧", stepTight.major <= 2);
  var stepWide = F.chooseFrameSteps({ fps: 30, pxPerSec: 5 });
  ok("缩到极小 pxPerSec 时主刻度变大", stepWide.major >= steps.major * 10);

  /* ================================================================== *
   * 3. §3.2 帧格视觉状态
   * ================================================================== */
  section("帧格状态：cellState / buildCells");

  var st1 = F.cellState({ frame: 10, time: 10 / 30, fps: 30, keys: [], currentFrame: 10 });
  eq("空帧 + 当前帧 → current", st1.current, true);
  eq("空帧 hasKey=false", st1.hasKey, false);
  eq("空帧 tone=current", st1.tone, "current");
  var st2 = F.cellState({ frame: 10, time: 10 / 30, fps: 30, keys: [{ time: 10 / 30 }, { time: 0 }], currentFrame: 3 });
  eq("命中 1 个 key", st2.keyCount, 1);
  eq("hasKey=true", st2.hasKey, true);
  eq("单属性 tone=keyed", st2.tone, "keyed");
  var st3 = F.cellState({ frame: 10, time: 10 / 30, fps: 30, keys: [{ time: 10 / 30 }, { time: 10 / 30 }], currentFrame: 3 });
  eq("同刻两个 key → multiProperty", st3.multiProperty, true);
  eq("multiProperty 时 keyCount=2", st3.keyCount, 2);
  var st4 = F.cellState({ frame: 10, time: 10 / 30, fps: 30, keys: [{ time: 10 / 30 }], currentFrame: 3, selected: true });
  eq("选中优先于 keyed", st4.tone, "selected");
  eq("选中标记", st4.selected, true);
  var st5 = F.cellState({ frame: 10, time: 10 / 30, fps: 30, keys: [{ time: 10 / 30 }], currentFrame: 3, inRange: true });
  eq("范围内 tone=range", st5.tone, "range");
  var st6 = F.cellState({ frame: 10, time: 10 / 30, fps: 30, keys: [{ time: 10 / 30 }], currentFrame: 3, locked: true, inRange: true });
  eq("锁定 → disabled", st6.disabled, true);
  eq("锁定 tone=disabled", st6.tone, "disabled");
  eq("锁定 locked=true", st6.locked, true);
  var st7 = F.cellState({ frame: 10, time: 10 / 30, fps: 30, keys: [{ time: 10 / 30, curve: [0.1, 0.2, 0.3, 0.4] }], currentFrame: 3, hasCurveAt: true });
  eq("曲线段 tone=curve（无 key 优先时）", st7.tone, "curve", "keyed 与 curve 同时存在时以 hasCurveAt 判定");
  eq("曲线标记 hasCurve", st7.hasCurve, true);

  var rows = [
    { kind: "bone", owner: "head", field: "rotate", keys: [{ time: 0 }, { time: 0.5 }] },
    { kind: "bone", owner: "head", field: "translate", keys: [{ time: 0.5 }] },
    { kind: "slot", owner: "mouth", field: "attachment", keys: [{ time: 1 }] },
  ];
  var cells = F.buildCells({
    rows: rows, frames: [0, 1, 15, 30], currentFrame: 15, fps: 30,
    range: { start: 1, end: 20 },
    lockedRows: ["slot:mouth:attachment"],
    selected: [F.frameKey(0) + "|bone:head:rotate"],
  });
  eq("buildCells.ok", cells.ok, true);
  ok("buildCells 不产生空轨道的行 cell（虚拟化）", cells.cells.every(function (c) { return c.hasKey || c.current || c.selected || c.inRange; }));
  ok("buildCells 只覆盖入参 frames 里的帧", cells.cells.every(function (c) { return [0, 1, 15, 30].indexOf(c.frame) >= 0; }));
  ok("keyedFrames 含 0/15/30", cells.keyedFrames.indexOf(0) >= 0 && cells.keyedFrames.indexOf(15) >= 0 && cells.keyedFrames.indexOf(30) >= 0);
  var cellAt = function (frame, rk) {
    for (var i = 0; i < cells.cells.length; i++) if (cells.cells[i].frame === frame && cells.cells[i].rowKey === rk) return cells.cells[i];
    return null;
  };
  var headRot0 = cellAt(0, "bone:head:rotate");
  ok("head.rotate @0 命中", !!headRot0);
  eq("head.rotate @0 tone=selected（选择集命中）", headRot0 && headRot0.tone, "selected");
  var headRot15 = cellAt(15, "bone:head:rotate");
  eq("head.rotate @15 在当前帧", headRot15 && headRot15.current, true);
  eq("head.rotate @15 tone=current（current 优先于 keyed）", headRot15 && headRot15.tone, "current");
  var mouth1 = cellAt(30, "slot:mouth:attachment");
  eq("锁定行 @30 仍产出但 disabled", mouth1 && mouth1.disabled, true);
  ok("buildCells 的 rowKey 与 defaultRowKey 一致", F.defaultRowKey(rows[0]) === "bone:head:rotate");

  /* ================================================================== *
   * 4. §12.3 统一 TimelineState
   * ================================================================== */
  section("状态：createState / normalizeState / updateState / deriveState");

  var s0 = F.createState({ fps: 30, duration: 3.5 });
  eq("默认 fps=30", s0.fps, 30);
  eq("默认 activeMode=frame（§2.1 默认进入 Frame Timeline）", s0.activeMode, "frame");
  eq("默认 autoKey=true", s0.autoKey, true);
  eq("默认 snapToFrame=false", s0.snapToFrame, false);
  eq("默认 isLooping=true", s0.isLooping, true);
  eq("默认 playbackSpeed=1", s0.playbackSpeed, 1);
  deepEq("默认选择为空", s0.selectedFrames, []);
  eq("默认 selectedFrameRange=null", s0.selectedFrameRange, null);
  eq("默认 pxPerSec=100", s0.pxPerSec, 100);

  var s1 = F.normalizeState({ fps: 30, currentTime: 99, duration: 3.5, selectedFrames: [5, 3, 5, -2, 3.7], activeMode: "bogus", playbackSpeed: 0, pxPerSec: -5 });
  near("currentTime 夹到 duration", s1.currentTime, 3.5, 1e-12);
  deepEq("selectedFrames 去重排序且丢弃负数（3.7→4）", s1.selectedFrames, [3, 4, 5]);
  eq("activeMode 非法回落 frame", s1.activeMode, "frame");
  eq("playbackSpeed 0 → 1", s1.playbackSpeed, 1);
  eq("pxPerSec 负数回落 100", s1.pxPerSec, 100);
  eq("activeMode 合法值保留", F.normalizeState({ activeMode: "graph" }).activeMode, "graph");
  eq("activeMode=dopesheet 保留", F.normalizeState({ activeMode: "dopesheet" }).activeMode, "dopesheet");

  var s2 = F.updateState(s0, { currentTime: 0.52, snapToFrame: true });
  near("snapToFrame 打开时 currentTime 吸到整数帧", s2.currentTime, 16 / 30, 1e-12);
  near("原 state 不被修改（不可变）", s0.currentTime, 0, 1e-12);
  var s3 = F.normalizeState({ fps: 30, duration: 2, loopStart: 1.5, loopEnd: 0.5 });
  near("loopEnd < loopStart 时原样保留（交换交给 loopRangeToTime）", s3.loopEnd, 0.5, 1e-12);

  var d = F.deriveState(F.createState({ fps: 30, duration: 3.5, currentTime: 0.5, selectedFrames: [1, 2] }), { width: 800 });
  eq("deriveState.currentFrame=15", d.currentFrame, 15);
  near("deriveState.durationFrames=105", d.durationFrames, 105, 1e-9);
  near("deriveState.column.x=50", d.column.x, 50, 1e-9);
  eq("deriveState.visible.ok", d.visible.ok, true);
  eq("deriveState.hasSelection", d.hasSelection, true);
  deepEq("deriveState.selectedCellKeys", d.selectedCellKeys, ["f:1", "f:2"]);

  /* ================================================================== *
   * 5. §3.3 帧选择
   * ================================================================== */
  section("选择：set/add/toggle/range/all/clear/invert/remove");

  var base = F.createState({ fps: 30, duration: 1 }); /* 0..30 帧 */
  deepEq("set 单选", F.selectFrames(base, { op: "set", frame: 7 }).selectedFrames, [7]);
  deepEq("add 累加", F.selectFrames(F.selectFrames(base, { op: "set", frame: 7 }).state, { op: "add", frame: 3 }).selectedFrames, [3, 7]);
  deepEq("add 重复不叠加", F.selectFrames(F.selectFrames(base, { op: "set", frame: 7 }).state, { op: "add", frame: 7 }).selectedFrames, [7]);
  deepEq("toggle 命中则移除", F.selectFrames(F.selectFrames(base, { op: "set", frame: 7 }).state, { op: "toggle", frame: 7 }).selectedFrames, []);
  deepEq("toggle 未命中则加入", F.selectFrames(base, { op: "toggle", frame: 4 }).selectedFrames, [4]);
  var rng = F.selectFrames(base, { op: "range", anchor: 12, frame: 3 });
  deepEq("range 生成连续帧", rng.selectedFrames, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  deepEq("range 归一化 start/end", rng.selectedFrameRange, { start: 3, end: 12 });
  var rngRev = F.selectFrames(base, { op: "range", anchor: 3, frame: 12 });
  deepEq("range 反向拖动结果一致", rngRev.selectedFrames, rng.selectedFrames);
  var allSel = F.selectFrames(base, { op: "all" });
  eq("all 覆盖 0..durationFrames", allSel.selectedFrames.length, 31);
  eq("all 首帧 0", allSel.selectedFrames[0], 0);
  eq("all 末帧 30", allSel.selectedFrames[30], 30);
  deepEq("clear 清空选择", F.selectFrames(allSel.state, { op: "clear" }).selectedFrames, []);
  eq("clear 同时清范围", F.selectFrames(rng.state, { op: "clear" }).selectedFrameRange, null);
  var inv = F.selectFrames(F.selectFrames(base, { op: "set", frame: 0 }).state, { op: "invert" });
  eq("invert 后不含已选帧", inv.selectedFrames.indexOf(0), -1);
  eq("invert 后总数 = 全部−已选", inv.selectedFrames.length, 30);
  deepEq("remove 删除指定帧", F.selectFrames(F.selectFrames(base, { op: "range", anchor: 0, frame: 4 }).state, { op: "remove", frame: 2 }).selectedFrames, [0, 1, 3, 4]);
  var bad = F.selectFrames(base, { op: "nope", frame: 1 });
  eq("未知操作 → ok:false", bad.ok, false);
  eq("未知操作不清空选择", bad.selectedFrames.length, 0);
  ok("未知操作给出错误码", bad.issues.length > 0 && bad.issues[0].code === "FRAME_SELECT_INVALID");

  var rowsForSel = [
    { kind: "bone", owner: "head", field: "rotate", keys: [{ time: 0 }, { time: 0.5 }] },
    { kind: "slot", owner: "mouth", field: "attachment", keys: [{ time: 0.5 }] },
  ];
  var allTracks = F.selectFrameAllTracks(base, 15, rowsForSel);
  eq("当前帧全选轨道命中 2 条", allTracks.selectedKeyIds.length, 2);
  ok("命中 id 含 rowKey@time 形态", allTracks.selectedKeyIds.every(function (id) { return /^[a-z]+:[^@]+@0\.5$/.test(id); }));
  eq("空帧全选轨道命中 0 条", F.selectFrameAllTracks(base, 7, rowsForSel).selectedKeyIds.length, 0);

  /* ================================================================== *
   * 6. §3.4 右键菜单
   * ================================================================== */
  section("菜单：空白帧 / 关键帧 / 帧范围 三套");

  var mEmpty = F.contextMenu({ frame: 5, hasKey: false, range: null });
  eq("空白帧菜单 kind=empty", mEmpty.kind, "empty");
  deepEq("空白帧菜单项（§3.4 原文 7 项）", mEmpty.items, ["addKey", "addPoseKey", "pasteKey", "pastePose", "clearFrameKeys", "selectFrame", "selectFrameAllTracks"]);
  var mKey = F.contextMenu({ frame: 5, hasKey: true, range: null });
  eq("关键帧菜单 kind=key", mKey.kind, "key");
  deepEq("关键帧菜单项（§3.4 原文 7 项）", mKey.items, ["editKey", "copyKey", "cutKey", "deleteKey", "moveKey", "setInterpolation", "locateKey"]);
  var mRange = F.contextMenu({ frame: 5, hasKey: true, range: { start: 3, end: 12 } });
  eq("有范围时优先范围菜单", mRange.kind, "range");
  deepEq("帧范围菜单项（§3.4 原文 7 项 + 本轮新增 reverse/spread 2 项）", mRange.items, ["copyRange", "deleteKeysInRange", "shiftRangeLeft", "shiftRangeRight", "stretchRange", "makePerFrameKeys", "clearRange", "reverseRange", "spreadRange"]);
  ok("帧范围菜单仍以 §3.4 原文 7 项开头", mRange.items.slice(0, 7).join(",") === "copyRange,deleteKeysInRange,shiftRangeLeft,shiftRangeRight,stretchRange,makePerFrameKeys,clearRange");
  ok("reverse/spread 都有中文标签", (mRange.labels.reverseRange || "").length > 0 && (mRange.labels.spreadRange || "").length > 0);
  ok("菜单项都有中文标签", mRange.items.every(function (id) { return typeof mRange.labels[id] === "string" && mRange.labels[id].length > 0; }));
  eq("范围菜单 label 正确", mRange.labels.stretchRange, "时间拉伸");
  eq("空白菜单 label 正确", mEmpty.labels.selectFrameAllTracks, "选择当前帧所有轨道");

  /* ================================================================== *
   * 7. 时间列遍历（与 SpineAnimEdit 交叉核对）
   * ================================================================== */
  section("时间列：readColumns 覆盖 events/deform/drawOrder/ik");

  var anim = makeAnim();
  var paths = pathsOf(anim);
  ok("含骨骼 rotate 列", paths.indexOf("bones.hips.rotate") >= 0);
  ok("含骨骼 translate 列", paths.indexOf("bones.hips.translate") >= 0);
  ok("含插槽 attachment 列", paths.indexOf("slots.mouth.attachment") >= 0);
  ok("含 ik bendPositive 列", paths.indexOf("ik.ik-arm.bendPositive") >= 0);
  ok("含 ik continuous.keys 列", paths.indexOf("ik.ik-arm.continuous.keys") >= 0);
  ok("含 drawOrder 列", paths.indexOf("drawOrder") >= 0);
  ok("含 events 列", paths.indexOf("events") >= 0);
  ok("含 deform 列", paths.indexOf("deform.mesh-1") >= 0);
  eq("时间列总数（3 骨列 + 1 槽列 + 2 ik 列 + drawOrder + events + deform）", F.readColumns(anim).length, 9);

  var isoShape = { bones: { b: { bones: [{ time: 0, x: 1, y: 2 }] } } };
  eq("形如 key 的对象数组仍按时间列处理（全项带有限 time）", F.readColumns(isoShape).length, 1);
  var isoPlain = { bones: { b: { vertices: [[0, 1], [2, 3]] } } };
  eq("非 key 数组（顶点数值数组）不被当成时间列", F.readColumns(isoPlain).length, 0);
  var isoMixed = { bones: { b: { mesh: [{ time: 0 }, { x: 1 }] } } };
  eq("混入无 time 项的数组不是时间列", F.readColumns(isoMixed).length, 0);
  eq("readColumns 空动画返回空数组", F.readColumns({}).length, 0);

  if (E && typeof E.scanTimelineKeys === "function") {
    var viaE = E.scanTimelineKeys(anim);
    eq("key 总数与 anim-edit.scanTimelineKeys 一致", totalKeys(anim), viaE.keyCount);
    var maxT = 0;
    var cols = F.readColumns(anim);
    for (var ci = 0; ci < cols.length; ci++) for (var ki = 0; ki < cols[ci].keys.length; ki++) if (cols[ci].keys[ki].time > maxT) maxT = cols[ci].keys[ki].time;
    near("最大时间与 anim-edit 一致", maxT, viaE.maxTime, 1e-12);
  } else {
    skip("与 anim-edit.scanTimelineKeys 交叉核对", "SpineAnimEdit 未加载");
  }

  var tb = F.timeBoundaries(anim);
  deepEq("时间边界去重升序", tb.times, [0, 0.5, 1]);
  eq("时间边界计数", tb.count, 3);
  ok("时间边界不含重复", new Set(tb.times).size === tb.times.length);

  /* ================================================================== *
   * 8. 路径解析往返
   * ================================================================== */
  section("路径：resolvePath 往返");

  var anim2 = makeAnim();
  var cols2 = F.readColumns(anim2);
  var allResolved = true;
  for (var i2 = 0; i2 < cols2.length; i2++) {
    var rp = F.resolvePath(anim2, cols2[i2].path);
    if (!rp.ok || !Array.isArray(rp.value) || rp.value.length !== cols2[i2].keys.length) allResolved = false;
  }
  ok("所有 readColumns 路径都能 resolvePath 回同一数组", allResolved);
  var rpHips = F.resolvePath(anim2, "bones.hips.rotate");
  eq("resolvePath 骨骼列 ok", rpHips.ok, true);
  deepEq("resolvePath 返回该列的完整内容", rpHips.value, anim2.bones.hips.rotate);
  eq("resolvePath 的 parent 是同一对象上的属性宿主", rpHips.parent === anim2.bones.hips, true);
  var rpIk = F.resolvePath(anim2, "ik.ik-arm.continuous.keys");
  eq("resolvePath 深层数组 ok", rpIk.ok, true);
  eq("resolvePath 深层数组长度", rpIk.value.length, 1);
  var rpDeform = F.resolvePath(anim2, "deform.mesh-1");
  eq("resolvePath 带连字符的路径段 ok", rpDeform.ok, true);
  eq("resolvePath 缺路径 ok:false", F.resolvePath(anim2, "bones.nope.rotate").ok, false);
  eq("resolvePath 空路径 ok:false", F.resolvePath(anim2, "").ok, false);

  /* ================================================================== *
   * 9. §3.5 时间帧操作 vs 关键帧操作
   * ================================================================== */
  section("时间帧操作：insert / remove / move / scale / clear");

  var a0 = makeAnim();
  var before0 = JSON.stringify(a0);
  var N0 = totalKeys(a0); /* 16：0/15/30 三帧上分布的时间列 */
  eq("合成动画 key 总数 =16", N0, 16);
  var ins = F.applyTimeFrameOperation(a0, { op: "insert", atFrame: 15, count: 10, fps: FPS });
  eq("insert.ok", ins.ok, true);
  eq("insert 后 key 总数不变（只搬时间，不增删）", totalKeys(ins.value), N0);
  eq("insert 不动入参（纯函数）", JSON.stringify(a0), before0);
  nearList("insert 后 hips.rotate 末键 +10 帧（30→40）", timesOf(ins.value, "bones.hips.rotate"), [0, 40 / 30]);
  nearList("insert 后 head.rotate 的 15/30 帧键 → 25/40 帧", timesOf(ins.value, "bones.head.rotate"), [0, 25 / 30, 40 / 30]);
  nearList("insert 后 events 一起后移（不是只搬骨骼）", timesOf(ins.value, "events"), [25 / 30]);
  nearList("insert 后 drawOrder 一起后移", timesOf(ins.value, "drawOrder"), [0, 40 / 30]);
  nearList("insert 后 deform 一起后移", timesOf(ins.value, "deform.mesh-1"), [25 / 30]);
  eq("insert 命中数 = 阈值及之后的全部 key（15/30 帧共 10 个）", ins.moved, 10);
  ok("insert 后每条列都按时间升序", F.readColumns(ins.value).every(function (c) {
    for (var k = 1; k < c.keys.length; k++) if (c.keys[k - 1].time > c.keys[k].time) return false;
    return true;
  }));
  ok("insert 负 atFrame 被拒", F.applyTimeFrameOperation(a0, { op: "insert", atFrame: -1, count: 1 }).ok === false);
  ok("insert count=0 被拒", F.applyTimeFrameOperation(a0, { op: "insert", atFrame: 0, count: 0 }).ok === false);

  var insLess = F.applyTimeFrameOperation(a0, { op: "insert", atFrame: 0, count: 5, fps: FPS });
  eq("insert atFrame:0 移动全部 key", insLess.moved, N0);
  nearList("insert atFrame:0 后首键=5 帧", timesOf(insLess.value, "bones.hips.rotate"), [5 / 30, 35 / 30]);
  var insLessRows = F.readColumns(insLess.value)
    .filter(function (c) { return c.path === "bones.hips.rotate"; })
    .map(function (c) { return { kind: "bone", owner: "hips", field: "rotate", keys: c.keys }; });
  eq("insert 后新空档内无 key", F.keysInFrameRange(insLessRows, 0, 5, FPS).count, 0);

  var insTiny = F.applyTimeFrameOperation(a0, { op: "insert", atFrame: 15, count: 1, fps: FPS });
  eq("插入 1 帧（§3.5 原文示例）后总数不变", totalKeys(insTiny.value), N0);
  var headTimes = timesOf(insTiny.value, "bones.head.rotate");
  near("插入 1 帧后原 0.5s（15 帧）的 key 到 16 帧", headTimes[1], 16 / 30, 1e-9);
  near("插入点之前的 key（0 帧）不动", headTimes[0], 0, 1e-9);

  var rm = F.applyTimeFrameOperation(a0, { op: "remove", atFrame: 15, count: 10, fps: FPS });
  eq("remove.ok", rm.ok, true);
  eq("remove 删除范围内 key（15..24 帧上的 5 个）", rm.removed, 5);
  eq("remove 后总数 = 原数 − 删除数", totalKeys(rm.value), N0 - 5);
  nearList("remove 后 30 帧的键前移 10 帧 → 20 帧", timesOf(rm.value, "bones.hips.rotate"), [0, 20 / 30]);
  eq("remove 后事件列整体消失（范围内 key 已删净）", timesOf(rm.value, "events"), null);
  eq("remove 范围外无 key 被误删（0 帧的 key 仍在）", timesOf(rm.value, "bones.hips.rotate")[0], 0);
  ok("remove 负 atFrame 被拒", F.applyTimeFrameOperation(a0, { op: "remove", atFrame: -1, count: 1 }).ok === false);

  var mv = F.applyTimeFrameOperation(a0, { op: "move", fromFrame: 15, count: 16, deltaFrames: 15, fps: FPS });
  eq("move.ok", mv.ok, true);
  eq("move 命中 15..30 范围内的 10 个 key", mv.moved, 10);
  nearList("move 后 30 帧的键 → 45 帧", timesOf(mv.value, "bones.hips.rotate"), [0, 45 / 30]);
  nearList("move 范围外（0 帧的 key）不动", timesOf(mv.value, "bones.hips.rotate").slice(0, 1), [0]);
  nearList("move 不搬范围外的事件（15 帧在范围内 → 30 帧）", timesOf(mv.value, "events"), [30 / 30]);
  var mvNeg = F.applyTimeFrameOperation(a0, { op: "move", fromFrame: 15, count: 16, deltaFrames: -30, fps: FPS });
  ok("move 到负帧时给出告警", mvNeg.issues.some(function (x) { return x.code === "FRAME_MOVE_BELOW_ZERO"; }));
  ok("move 负帧被夹到 0 而不是产生负时间", F.readColumns(mvNeg.value).every(function (c) { return c.keys.every(function (k) { return k.time >= 0; }); }));

  var sc = F.applyTimeFrameOperation(a0, { op: "scale", fromFrame: 0, count: 31, factor: 2, fps: FPS });
  eq("scale.ok", sc.ok, true);
  nearList("时间拉伸 2×（§6.2：0/15/30 → 0/30/60）", timesOf(sc.value, "bones.head.rotate"), [0, 30 / 30, 60 / 30]);
  nearList("scale 保持范围内相对关系", timesOf(sc.value, "slots.mouth.attachment"), [0, 60 / 30]);
  nearList("scale 也覆盖 events", timesOf(sc.value, "events"), [30 / 30]);
  ok("scale factor<=0 被拒", F.applyTimeFrameOperation(a0, { op: "scale", fromFrame: 0, count: 10, factor: 0 }).ok === false);
  var scHalf = F.applyTimeFrameOperation(a0, { op: "scale", fromFrame: 0, count: 31, factor: 0.5, fps: FPS });
  nearList("缩放 0.5× 压缩时间（15/30 → 7.5/15 帧）", timesOf(scHalf.value, "bones.head.rotate"), [0, 7.5 / 30, 15 / 30]);

  var cl = F.applyTimeFrameOperation(a0, { op: "clear", fromFrame: 0, count: 31, fps: FPS });
  eq("clear.ok", cl.ok, true);
  eq("clear 删除范围内全部 key", cl.removed, N0);
  eq("clear 后没有 key 被搬动（moved=0）", cl.moved, 0);
  eq("clear 后 key 总数 0", totalKeys(cl.value), 0);
  eq("窄范围 clear 只删范围内的 key（15 帧上的 5 个）", F.applyTimeFrameOperation(a0, { op: "clear", fromFrame: 15, count: 5, fps: FPS }).removed, 5);
  eq("窄范围 clear 后其余 key 时间不变", timesOf(F.applyTimeFrameOperation(a0, { op: "clear", fromFrame: 15, count: 5, fps: FPS }).value, "bones.hips.rotate")[0], 0);
  eq("清空后的空时间列被移除（events 不再出现在 readColumns）", timesOf(cl.value, "events"), null);
  ok("被移除的时间列在原对象上仍然存在（入参零改动）", Array.isArray(a0.events) && a0.events.length === 1);
  var rmHost = { bones: { b: { rotate: [{ time: 0 }] } } };
  var rmCol = F.removeColumnAt(rmHost, "bones.b.rotate");
  eq("removeColumnAt 属性路径 ok", rmCol.ok, true);
  eq("removeColumnAt 真的删掉属性", rmHost.bones.b.rotate, undefined);
  eq("removeColumnAt 后 readColumns 不再包含该列", F.readColumns(rmHost).length, 0);
  var rmIdxHost = { deform: { m: [{ time: 0 }, { time: 1 }] } };
  var rmIdx = F.removeColumnAt(rmIdxHost, "deform.m[0]");
  eq("removeColumnAt 数组下标路径 ok", rmIdx.ok, true);
  eq("removeColumnAt 下标 splice 后只剩 1 项", rmIdxHost.deform.m.length, 1);
  near("removeColumnAt splice 保留的是原第二项", rmIdxHost.deform.m[0].time, 1, 1e-12);
  eq("removeColumnAt 缺路径 ok:false", F.removeColumnAt({}, "bones.x.rotate").ok, false);
  eq("removeColumnAt 下标越界 ok:false", F.removeColumnAt({ deform: { m: [] } }, "deform.m[0]").ok, false);

  var badOp = F.applyTimeFrameOperation(a0, { op: "nope", fromFrame: 0, count: 1 });
  eq("未知时间帧操作 → ok:false", badOp.ok, false);
  eq("未知时间帧操作 → value:null", badOp.value, null);
  eq("未知时间帧操作 → 入参零改动", JSON.stringify(a0), before0);
  eq("非对象动画被拒", F.applyTimeFrameOperation(null, { op: "insert" }).ok, false);
  eq("空动画（无任何时间列）视为成功无变化", F.applyTimeFrameOperation({ bones: {} }, { op: "insert", atFrame: 0, count: 1 }).ok, true);
  eq("空动画 changed=0", F.applyTimeFrameOperation({ bones: {} }, { op: "insert", atFrame: 0, count: 1 }).changed, 0);

  var ops = F.COLLISION_POLICY;
  deepEq("collision 策略三种", ops.slice().sort(), ["keep-both", "replace", "skip"]);

  /* ================================================================== *
   * 10. 范围查询
   * ================================================================== */
  section("范围查询：keysInFrameRange / rangeHasKeys");

  var qrows = [
    { kind: "bone", owner: "a", field: "rotate", keys: [{ time: 0 }, { time: 0.5 }, { time: 1 }] },
    { kind: "bone", owner: "b", field: "rotate", keys: [{ time: 0.5 }] },
  ];
  var q = F.keysInFrameRange(qrows, 15, 1, FPS);
  eq("单帧查询命中 2 条（含多轨道同刻）", q.count, 2);
  deepEq("查询命中帧号", q.keys.map(function (k) { return k.frame; }), [15, 15]);
  ok("命中带 rowKey", q.keys[0].rowKey === "bone:a:rotate" || q.keys[0].rowKey === "bone:b:rotate");
  var q2 = F.keysInFrameRange(qrows, 0, 31, FPS);
  eq("全覆盖查询命中 4 条", q2.count, 4);
  ok("命中按帧升序", q2.keys.every(function (k, i, arr) { return i === 0 || arr[i - 1].frame <= k.frame; }));
  eq("rangeHasKeys 有 key 时 true", F.rangeHasKeys(qrows, 0, 1, FPS), true);
  eq("rangeHasKeys 无 key 时 false", F.rangeHasKeys(qrows, 10, 3, FPS), false);
  eq("非法 fromFrame → ok:false", F.keysInFrameRange(qrows, NaN, 1, FPS).ok, false);

  /* ================================================================== *
   * 11. §9 播放控制帧级定位
   * ================================================================== */
  section("播放：seekFrame / loopRangeToTime");

  var ps = F.createState({ fps: 30, duration: 1, currentTime: 0.5 }); /* 当前 15 帧 */
  eq("first → 0 帧", F.seekFrame(ps, "first").frame, 0);
  eq("last → 30 帧", F.seekFrame(ps, "last").frame, 30);
  eq("prev → 14 帧", F.seekFrame(ps, "prev").frame, 14);
  eq("next → 16 帧", F.seekFrame(ps, "next").frame, 16);
  near("seekFrame 同时给出秒", F.seekFrame(ps, "next").time, 16 / 30, 1e-12);
  eq("next 不超过末帧", F.seekFrame(F.createState({ fps: 30, duration: 1, currentTime: 1 }), "next").frame, 30);
  eq("prev 不低于 0 帧", F.seekFrame(F.createState({ fps: 30, duration: 1, currentTime: 0 }), "prev").frame, 0);
  eq("frame 指定定位", F.seekFrame(ps, "frame", { frame: 22 }).frame, 22);
  eq("越界 frame 被夹到末帧", F.seekFrame(ps, "frame", { frame: 9999 }).frame, 30);
  eq("负 frame 被夹到 0", F.seekFrame(ps, "frame", { frame: -5 }).frame, 0);
  eq("prevKey 跳到上一个关键帧", F.seekFrame(ps, "prevKey", { rows: qrows }).frame, 0);
  eq("nextKey 跳到下一个关键帧", F.seekFrame(ps, "nextKey", { rows: qrows }).frame, 30);
  eq("未知动作 → ok:false", F.seekFrame(ps, "nope").ok, false);
  var lp = F.loopRangeToTime(F.createState({ fps: 30, duration: 3, loopStart: 1, loopEnd: 0.5 }));
  near("loop 区间反了就交换（start）", lp.start, 0.5, 1e-12);
  near("loop 区间反了就交换（end）", lp.end, 1, 1e-12);
  eq("loop 帧号换算", lp.startFrame, 15);
  eq("loop 末帧换算", lp.endFrame, 30);
  var rawReversed = F.createState({ fps: 30, duration: 3, loopStart: 1, loopEnd: 0.5 });
  near("createState 保留 loopEnd 原值（不在归一化里偷换）", rawReversed.loopEnd, 0.5, 1e-12);
  near("createState 保留 loopStart 原值", rawReversed.loopStart, 1, 1e-12);
  var lpRaw = F.loopRangeToTime({ fps: 30, duration: 3, loopStart: 1, loopEnd: 0.5, currentTime: 0 });
  near("loopRangeToTime 自身也做交换（start）", lpRaw.start, 0.5, 1e-12);
  near("loopRangeToTime 自身也做交换（end）", lpRaw.end, 1, 1e-12);
  near("loopRangeToTime 交换后帧号也正确", lpRaw.startFrame, 15, 1e-9);

  /* ================================================================== *
   * 12. §6 Reverse Keys / §5.3 创建逐帧关键帧（spread）
   * ================================================================== */
  section("P2：reverse / spread 时间帧操作");

  var rv0 = makeAnim(); /* 关键帧在 0/15/30 帧 */
  var beforeRv = JSON.stringify(rv0);
  var rv = F.applyTimeFrameOperation(rv0, { op: "reverse", fromFrame: 0, count: 31, fps: FPS });
  eq("reverse.ok", rv.ok, true);
  eq("reverse 不动入参", JSON.stringify(rv0), beforeRv);
  eq("reverse 后 key 总数不变", totalKeys(rv.value), totalKeys(rv0));
  nearList("reverse 0..30 后 hips.rotate 时间变为 0 与 30 帧", timesOf(rv.value, "bones.hips.rotate"), [0, 30 / 30]);
  nearList("reverse 后 head.rotate 顺序整体翻转（0/15/30 → 30/15/0）", timesOf(rv.value, "bones.head.rotate"), [0, 15 / 30, 30 / 30]);
  nearList("reverse 后 events 也翻转（15 帧·区间中点不动）", timesOf(rv.value, "events"), [15 / 30]);
  var rvHalf = F.applyTimeFrameOperation(makeAnim(), { op: "reverse", fromFrame: 0, count: 16, fps: FPS });
  nearList("reverse 只作用于范围内（0..15 帧内的 0/15 互换位置仍为 0 与 15）", timesOf(rvHalf.value, "bones.head.rotate"), [0, 15 / 30, 30 / 30]);
  ok("reverse 负 fromFrame 被拒", F.applyTimeFrameOperation(rv0, { op: "reverse", fromFrame: -1, count: 5 }).ok === false);
  ok("reverse count=0 被拒", F.applyTimeFrameOperation(rv0, { op: "reverse", fromFrame: 0, count: 0 }).ok === false);
  ok("reverse 后每条列仍按时间升序", F.readColumns(rv.value).every(function (c) {
    for (var k = 1; k < c.keys.length; k++) if (c.keys[k - 1].time > c.keys[k].time) return false;
    return true;
  }));
  var rvTwice = F.applyTimeFrameOperation(rv.value, { op: "reverse", fromFrame: 0, count: 31, fps: FPS });
  nearList("reverse 两次回到原状", timesOf(rvTwice.value, "bones.head.rotate"), [0, 15 / 30, 30 / 30]);

  /* spread：造一条时间不均的轨道，验证被均匀铺到整数帧 */
  function makeUneven() {
    return {
      bones: {
        b1: {
          rotate: [
            { time: 0 },
            { time: 0.1 },
            { time: 0.9 },
            { time: 1.0 },
          ],
        },
      },
    };
  }
  var sp0 = makeUneven();
  var beforeSp = JSON.stringify(sp0);
  var sp = F.applyTimeFrameOperation(sp0, { op: "spread", fromFrame: 0, count: 31, fps: FPS });
  eq("spread.ok", sp.ok, true);
  eq("spread 不动入参", JSON.stringify(sp0), beforeSp);
  eq("spread 后 key 总数不变", totalKeys(sp.value), 4);
  nearList("spread 把 4 个 Key 均匀铺到 0/10/20/30 帧", timesOf(sp.value, "bones.b1.rotate"), [0, 10 / 30, 20 / 30, 30 / 30]);
  ok("spread 后时间都落在整数帧上", F.readColumns(sp.value)[0].keys.every(function (k) {
    return Math.abs(k.time * FPS - Math.round(k.time * FPS)) < 1e-9;
  }));
  var spSingle = F.applyTimeFrameOperation({ bones: { b1: { rotate: [{ time: 0.3 }] } } }, { op: "spread", fromFrame: 0, count: 31, fps: FPS });
  eq("spread 对单 Key 轨道不做改动（没有「逐帧」可言）", spSingle.moved, 0);
  eq("spread 不会为无 Key 轨道凭空造 Key", F.readColumns(spSingle.value).length, 1);
  ok("spread 负 fromFrame 被拒", F.applyTimeFrameOperation(sp0, { op: "spread", fromFrame: -1, count: 5 }).ok === false);
  ok("spread count=0 被拒", F.applyTimeFrameOperation(sp0, { op: "spread", fromFrame: 0, count: 0 }).ok === false);
  var spCollide = F.applyTimeFrameOperation(
    { bones: { b1: { rotate: [{ time: 0 }, { time: 1 / 30 }, { time: 2 / 30 }] } } },
    { op: "spread", fromFrame: 0, count: 3, fps: FPS }
  );
  eq("spread 在窄区间内仍保持每轨去重（3 帧 3 Key）", F.readColumns(spCollide.value)[0].keys.length, 3);

  /* 范围影响预览（§3.5「删除时间必须提供影响预览」，确认框用） */
  var impRows = [
    { kind: "bone", owner: "a", field: "rotate", keys: [{ time: 15 / 30 }, { time: 30 / 30 }] },
    { kind: "bone", owner: "b", field: "translate", keys: [{ time: 15 / 30 }] },
    { kind: "bone", owner: "c", field: "rotate", keys: [{ time: 90 / 30 }] },
  ];
  var imp = F.rangeImpact(impRows, 15, 16, FPS);
  eq("rangeImpact.ok", imp.ok, true);
  eq("rangeImpact 统计受影响轨道数", imp.tracks, 2);
  eq("rangeImpact 统计受影响 Key 数", imp.keys, 3);
  eq("rangeImpact 范围起止", imp.firstFrame + "-" + imp.lastFrame, "15-30");
  ok("rangeImpact 给出最大位移毫秒（非零）", imp.maxOffsetMs > 0);
  ok("rangeImpact 给出轨道样例", imp.sample.length === 2);
  var impEmpty = F.rangeImpact(impRows, 100, 5, FPS);
  eq("rangeImpact 空范围 keys=0", impEmpty.keys, 0);
  eq("rangeImpact 空范围 tracks=0", impEmpty.tracks, 0);
  eq("rangeImpact 不改动入参", JSON.stringify(impRows[0].keys.map(function (k) { return k.time; })), JSON.stringify([15 / 30, 1]));

  /* 路径 → 轨道行键（UI「仅修改选中轨道」用；与锁列表同一格式） */
  eq("rowKeyFromPath 骨骼列", F.rowKeyFromPath("bones.hips.rotate"), "bone:hips:rotate");
  eq("rowKeyFromPath 插槽列", F.rowKeyFromPath("slots.mouth.attachment"), "slot:mouth:attachment");
  eq("rowKeyFromPath ik 列", F.rowKeyFromPath("ik.ik-arm.bendPositive"), "timeline:ik:ik-arm.bendPositive");
  eq("rowKeyFromPath events 列", F.rowKeyFromPath("events"), "timeline:events:");
  eq("rowKeyFromPath deform 列", F.rowKeyFromPath("deform.mesh-1"), "timeline:deform:mesh-1");

  /* onlyRowKey：把操作收窄到单条轨道 */
  var narrowAnim = makeAnim();
  var narrow = F.applyTimeFrameOperation(narrowAnim, {
    op: "reverse", fromFrame: 0, count: 31, fps: FPS,
    onlyRowKey: "bone:head:rotate",
    rowKeyOf: function (p) { return F.rowKeyFromPath(p); },
  });
  eq("onlyRowKey reverse.ok", narrow.ok, true);
  nearList("onlyRowKey 只动目标轨（head.rotate 顺序翻转后首尾同为 0/30 帧）", timesOf(narrow.value, "bones.head.rotate"), [0, 15 / 30, 30 / 30]);
  nearList("onlyRowKey 不改其他轨（hips.rotate 仍为 0/30 帧）", timesOf(narrow.value, "bones.hips.rotate"), [0, 30 / 30]);
  eq("onlyRowKey 只影响目标轨的命中数（3 个 Key）", narrow.moved, 3);
  var narrowMissing = F.applyTimeFrameOperation(makeAnim(), {
    op: "reverse", fromFrame: 0, count: 31, fps: FPS, onlyRowKey: "bone:nope:rotate",
    rowKeyOf: function (p) { return F.rowKeyFromPath(p); },
  });
  eq("onlyRowKey 找不到轨道 → ok:false", narrowMissing.ok, false);
  eq("onlyRowKey 找不到轨道 → value:null", narrowMissing.value, null);
  ok("onlyRowKey 找不到轨道 → 错误码可读", narrowMissing.issues.some(function (x) { return x.code === "FRAME_ROWKEY_NOT_FOUND"; }));
  var narrowNoResolver = F.applyTimeFrameOperation(makeAnim(), { op: "reverse", fromFrame: 0, count: 31, fps: FPS, onlyRowKey: "bone:head:rotate" });
  eq("onlyRowKey 缺行解析器 → ok:false（不猜）", narrowNoResolver.ok, false);
  ok("onlyRowKey 缺解析器 → 错误码可读", narrowNoResolver.issues.some(function (x) { return x.code === "FRAME_ROWKEY_RESOLVER_MISSING"; }));

  /* ================================================================== *
   * 汇总
   * ================================================================== */
  result.finishedAt = new Date().toISOString();
  result.notes.push({
    name: "覆盖面",
    detail: "换算/几何/状态/选择/菜单/时间列/路径/时间帧操作/范围查询/播放定位 共 " + result.total + " 条断言",
  });
  global.__selftestFrameTimelineResult = result;
  if (typeof window !== "undefined") window.__selftestFrameTimelineResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
