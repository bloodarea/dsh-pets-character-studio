/*
 * frame-timeline.js —— Flash 式帧时间轴的**数据与几何**层 · 纯模块
 * 边界（与 timeline.js / anim-edit.js 一致）：
 *   本文件不碰 DOM / window.location / Image / Canvas / fetch / 磁盘 IO。
 *   只接受普通对象与数字，返回纯数据；浏览器暴露 window.SpineFrameTimeline，
 *   Node 里是 globalThis.SpineFrameTimeline（import 的副作用，与 anim-edit.js 同风格）。
 *
 * 职责边界（勿越界）：
 *   - 本模块只负责「帧」这一层的语义：帧↔秒换算、帧格几何、帧格视觉状态、
 *     帧选择与帧范围、统一 TimelineState、以及**时间帧操作**（插入/删除/移动/拉伸时间）。
 *   - 关键帧的增删改（upsertKey / removeKey / retimeKey / setKeyValues）一律不在这里做，
 *     由调用方用 SpineAnimEdit 执行。本模块产出新动画对象或纯规划，不直接落盘。
 *   - **帧操作与关键帧操作必须分离**（规划书 §3.5）：
 *       关键帧操作 = 只动指定轨道上的 key（SpineAnimEdit 负责）；
 *       时间帧操作 = 整段动画的时间结构变化，所有位于该位置及之后的 key 一起后移，
 *                   由 applyTimeFrameOperation 完成，天然覆盖全部轨道（含 events / deform）。
 *   - 内部时间统一用秒；帧号只作为显示与操作坐标（规划书 §3.1 / §7.4）。
 *     timeSeconds = frameIndex / fps，frameIndex = timeSeconds * fps。
 *
 * 稳定键约定：
 *   帧格键 frameKey(frame) = "f:<整数帧>"；轨道行键沿用 SpineTimeline.rowKey(row) = "kind:owner:field"。
 *   选择集只用这两个字符串，不持有对象引用 —— 这样撤销/重放/重排行都不会让选择失效。
 */
(function (global) {
  "use strict";

  const API_VERSION = 1;
  const DEFAULT_FPS = 30;
  const DEFAULT_PX_PER_SEC = 100;
  const TIME_EPS = 1e-9;
  const EPS_FRAME = 1e-6; /* 帧号比较容差（远小于半个帧） */
  const FPS_MIN = 1;
  const FPS_MAX = 240;
  const MODES = Object.freeze(["frame", "dopesheet", "graph"]);
  const MAX_CELLS = 20000; /* 单次 buildCells 的硬上限，防虚拟化缺失时炸内存 */
  const COLLISION_POLICY = Object.freeze(["keep-both", "skip", "replace"]);

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function isFiniteNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function numOr(v, d) {
    return isFiniteNum(v) ? v : d;
  }
  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }
  function issue(path, code, message) {
    return { path: String(path == null ? "" : path), code: code, message: String(message || code) };
  }
  function round(v, digits) {
    const p = Math.pow(10, digits == null ? 9 : digits);
    return Math.round(v * p) / p;
  }

  /** fps 归一化：非有限数 / 越界一律回落到默认 30（不抛，不静默变 0） */
  function normFps(fps) {
    const f = numOr(fps, DEFAULT_FPS);
    if (!(f > 0)) return DEFAULT_FPS;
    if (f < FPS_MIN) return FPS_MIN;
    if (f > FPS_MAX) return FPS_MAX;
    return f;
  }

  /* ------------------------------------------------------------------ *
   * §3.1 / §7.4 帧 ↔ 秒换算
   * ------------------------------------------------------------------ */

  function frameToTime(frame, fps) {
    const f = normFps(fps);
    if (!isFiniteNum(frame)) return NaN;
    return round(frame / f, 12);
  }

  function timeToFrame(time, fps) {
    const f = normFps(fps);
    if (!isFiniteNum(time)) return NaN;
    return time * f;
  }

  /** 时间吸附到整数帧格（§7.4 snapTime） */
  function snapTime(time, fps) {
    const f = normFps(fps);
    if (!isFiniteNum(time)) return NaN;
    return round(Math.round(time * f) / f, 12);
  }

  /** 帧号吸附到整数帧（帧视图里的帧号本身永远是整数） */
  function snapFrame(frame) {
    if (!isFiniteNum(frame)) return NaN;
    return Math.round(frame);
  }

  /** 当前时间所在的整数帧（§3.1：帧号仅作显示与操作坐标） */
  function frameAtTime(time, fps) {
    const fr = timeToFrame(time, fps);
    return isFiniteNum(fr) ? Math.round(fr) : NaN;
  }

  function frameKey(frame) {
    return "f:" + String(snapFrame(frame));
  }

  function parseFrameKey(key) {
    const m = /^f:(-?\d+)$/.exec(String(key == null ? "" : key));
    return m ? Number(m[1]) : NaN;
  }

  /* ------------------------------------------------------------------ *
   * §3.1 帧格几何（纯几何，与渲染无关）
   * ------------------------------------------------------------------ */

  function pxPerFrame(pxPerSec, fps) {
    const px = numOr(pxPerSec, DEFAULT_PX_PER_SEC);
    return (px > 0 ? px : DEFAULT_PX_PER_SEC) / normFps(fps);
  }

  /** 帧号 → 视口内 x（像素，含 scrollSec 与像素/秒缩放） */
  function frameToX(frame, opts) {
    const o = isObject(opts) ? opts : {};
    if (!isFiniteNum(frame)) return NaN;
    const pf = pxPerFrame(o.pxPerSec, o.fps);
    return (frame - numOr(o.scrollFrame, 0)) * pf;
  }

  function xToFrame(x, opts) {
    const o = isObject(opts) ? opts : {};
    if (!isFiniteNum(x)) return NaN;
    const pf = pxPerFrame(o.pxPerSec, o.fps);
    if (!(pf > 0)) return NaN;
    return numOr(o.scrollFrame, 0) + x / pf;
  }

  /**
   * 视口内可见帧格区间。
   * @returns {{ok:boolean, firstFrame:number, lastFrame:number, count:number,
   *            framePx:number, scrollFrame:number, issues:Array}}
   *   firstFrame/lastFrame 含两端，都是整数；width<=0 时 count=0。
   */
  function frameRange(opts) {
    const o = isObject(opts) ? opts : {};
    const width = numOr(o.width, 0);
    const pf = pxPerFrame(o.pxPerSec, o.fps);
    const scrollFrame = numOr(o.scrollFrame, 0);
    const pad = numOr(o.pad, 1);
    if (!(width > 0) || !(pf > 0)) {
      return {
        ok: false, firstFrame: 0, lastFrame: -1, count: 0,
        framePx: pf, scrollFrame: scrollFrame,
        issues: [issue("width", "FRAME_VIEW_EMPTY", "视口宽度必须大于 0")],
      };
    }
    const first = Math.floor(scrollFrame) - pad;
    const last = Math.ceil(scrollFrame + width / pf) + pad;
    const capped = Math.min(last, first + MAX_CELLS - 1);
    return {
      ok: true,
      firstFrame: first,
      lastFrame: capped,
      count: capped - first + 1,
      framePx: pf,
      scrollFrame: scrollFrame,
      capped: capped !== last,
      issues: [],
    };
  }

  /**
   * 当前帧整列高亮的几何（§3.2「当前帧」）。
   * @returns {{ok:boolean, frame:number, time:number, x:number, width:number,
   *            inView:boolean, issues:Array}}
   */
  function currentFrameColumn(time, opts) {
    const o = isObject(opts) ? opts : {};
    const frame = frameAtTime(time, o.fps);
    if (!isFiniteNum(frame)) {
      return { ok: false, frame: NaN, time: NaN, x: NaN, width: 0, inView: false,
        issues: [issue("time", "FRAME_TIME_INVALID", "当前时间必须是有限数")] };
    }
    const pf = pxPerFrame(o.pxPerSec, o.fps);
    const x = frameToX(frame, o);
    const width = numOr(o.width, 0);
    return {
      ok: true,
      frame: frame,
      time: frameToTime(frame, o.fps),
      x: x,
      width: pf,
      inView: isFiniteNum(x) && x + pf >= 0 && x <= width,
      issues: [],
    };
  }

  /** 主/次刻度步长（帧）：保证标签不重叠；次刻度用 5 帧（Flash 习惯） */
  function chooseFrameSteps(opts) {
    const o = isObject(opts) ? opts : {};
    const pf = pxPerFrame(o.pxPerSec, o.fps);
    const minLabelPx = numOr(o.minLabelPx, 40);
    const majorCandidates = [1, 2, 5, 10, 20, 30, 60, 120, 300];
    let major = majorCandidates[majorCandidates.length - 1];
    for (let i = 0; i < majorCandidates.length; i++) {
      if (majorCandidates[i] * pf >= minLabelPx) {
        major = majorCandidates[i];
        break;
      }
    }
    let minor = null;
    for (let i = 0; i < majorCandidates.length; i++) {
      const step = majorCandidates[i];
      if (step >= major) break;
      if (major % step !== 0) continue;
      if (step * pf < numOr(o.minMinorPx, 5)) continue;
      minor = step;
    }
    return { major: major, minor: minor, framePx: pf };
  }

  /* ------------------------------------------------------------------ *
   * §3.2 帧格视觉状态
   * ------------------------------------------------------------------ */

  /**
   * 单行单帧的视觉状态。
   * @param {{frame:number, time:number, row?:object, keys?:Array, currentFrame:number,
   *          selected?:boolean, inRange?:boolean, locked?:boolean, disabled?:boolean,
   *          selectedTrack?:boolean, hasCurveAt?:boolean}} cell
   * @returns {object} 状态对象（纯数据，可直接喂给渲染层）
   */
  function cellState(cell) {
    const c = isObject(cell) ? cell : {};
    const frame = snapFrame(c.frame);
    const time = isFiniteNum(c.time) ? c.time : frameToTime(frame, c.fps);
    const keys = Array.isArray(c.keys) ? c.keys : [];
    let keyCount = 0;
    for (let i = 0; i < keys.length; i++) {
      const kt = isObject(keys[i]) ? keys[i].time : NaN;
      if (isFiniteNum(kt) && Math.abs(kt - time) <= Math.max(TIME_EPS, 1e-6)) keyCount++;
    }
    const isCurrent = isFiniteNum(c.currentFrame) && frame === snapFrame(c.currentFrame);
    const locked = c.locked === true;
    const disabled = c.disabled === true || locked;
    return {
      frame: frame,
      time: time,
      keyCount: keyCount,
      hasKey: keyCount > 0,
      /* §3.2「多属性关键帧」：同一格上有多条轨道命中 */
      multiProperty: keyCount > 1,
      current: isCurrent,
      selected: c.selected === true,
      inRange: c.inRange === true,
      locked: locked,
      disabled: disabled,
      selectedTrack: c.selectedTrack === true,
      hasCurve: c.hasCurveAt === true,
      /* 渲染提示：帧格该用哪一档底色 */
      tone: disabled ? "disabled" : c.selected === true ? "selected" : isCurrent ? "current" : c.inRange === true ? "range" : c.hasCurveAt === true ? "curve" : keyCount > 0 ? "keyed" : "plain",
    };
  }

  /**
   * 生成视口内需要渲染的帧格（**只返回有内容或有标记的格子**，不含空白格）。
   * 空白帧由渲染层按 frameRange 自己铺底，避免 O(帧×轨道) 的对象构建（§12.2 虚拟化）。
   * @param {{rows:Array, frames:Array<number>, currentFrame:number, selected?:Set|Array,
   *          range?:{start:number,end:number}|null, lockedRows?:Set|Array,
   *          selectedTracks?:Set|Array, keyedByFrame?:object}} input
   * @returns {{ok:boolean, cells:Array, count:number, keyedFrames:Array, issues:Array}}
   */
  function buildCells(input) {
    const inp = isObject(input) ? input : {};
    const rows = Array.isArray(inp.rows) ? inp.rows : [];
    const frames = Array.isArray(inp.frames) ? inp.frames : [];
    const locked = toKeySet(inp.lockedRows);
    const selectedTracks = toKeySet(inp.selectedTracks);
    const sel = toKeySet(inp.selected);
    const range = normalizeRange(inp.range, inp.fps);
    const currentFrame = snapFrame(inp.currentFrame);
    const cells = [];
    const keyedFrameSet = new Set();
    const timeOfFrame = (f) => frameToTime(f, inp.fps);
    for (let fi = 0; fi < frames.length && cells.length < MAX_CELLS; fi++) {
      const frame = snapFrame(frames[fi]);
      if (!isFiniteNum(frame)) continue;
      const time = timeOfFrame(frame);
      const inRange = !!range && frame >= range.start && frame <= range.end;
      const rowKeyOf = (row) => (typeof inp.rowKeyOf === "function" ? inp.rowKeyOf(row) : defaultRowKey(row));
      for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri];
        if (!isObject(row) || !Array.isArray(row.keys)) continue;
        const rk = rowKeyOf(row);
        const st = cellState({
          frame: frame, time: time, keys: row.keys, fps: inp.fps,
          currentFrame: currentFrame,
          selected: sel.has(frameKey(frame) + "|" + rk),
          inRange: inRange,
          locked: locked.has(rk),
          selectedTrack: selectedTracks.has(rk),
        });
        if (!st.hasKey && !st.current && !st.selected && !st.inRange) continue;
        if (st.hasKey) keyedFrameSet.add(frame);
        cells.push(Object.assign({ rowKey: rk, row: row }, st));
      }
    }
    /* 整列标记（当前帧 / 选中帧 / 范围内）不在这里产出行级 cell：
       空白帧的列底色由渲染层按 deriveState().column / frameRange 自己铺，
       这样 buildCells 的规模只与「有内容的格子」成正比（§12.2 虚拟化）。 */
    const keyedFrames = Array.from(keyedFrameSet).sort((a, b) => a - b);
    return { ok: true, cells: cells, count: cells.length, keyedFrames: keyedFrames, issues: [] };
  }

  function defaultRowKey(row) {
    if (!isObject(row)) return "";
    return String(row.kind) + ":" + String(row.owner) + ":" + String(row.field);
  }

  /* ------------------------------------------------------------------ *
   * §12.3 统一 TimelineState
   * ------------------------------------------------------------------ */

  function createState(opts) {
    const o = isObject(opts) ? opts : {};
    return normalizeState({
      currentTime: numOr(o.currentTime, 0),
      fps: normFps(o.fps),
      isPlaying: o.isPlaying === true,
      isLooping: o.isLooping !== false,
      playbackSpeed: numOr(o.playbackSpeed, 1),
      selectedKeyIds: Array.isArray(o.selectedKeyIds) ? o.selectedKeyIds.slice() : [],
      selectedTrackIds: Array.isArray(o.selectedTrackIds) ? o.selectedTrackIds.slice() : [],
      selectedFrames: Array.isArray(o.selectedFrames) ? o.selectedFrames.slice() : [],
      selectedFrameRange: isObject(o.selectedFrameRange) ? { start: o.selectedFrameRange.start, end: o.selectedFrameRange.end } : null,
      autoKey: o.autoKey !== false,
      snapToFrame: o.snapToFrame === true,
      activeMode: o.activeMode,
      loopStart: isFiniteNum(o.loopStart) ? o.loopStart : 0,
      loopEnd: isFiniteNum(o.loopEnd) ? o.loopEnd : null,
      duration: numOr(o.duration, 0),
      pxPerSec: numOr(o.pxPerSec, DEFAULT_PX_PER_SEC),
      scrollFrame: numOr(o.scrollFrame, 0),
    });
  }

  /** 归一化：夹取非法值、排序去重、保证 currentTime 是整数帧当 snapToFrame 时 */
  function normalizeState(input) {
    const s = isObject(input) ? input : {};
    const fps = normFps(s.fps);
    let duration = numOr(s.duration, 0);
    if (duration < 0) duration = 0;
    let currentTime = numOr(s.currentTime, 0);
    if (currentTime < 0) currentTime = 0;
    if (currentTime > duration) currentTime = duration;
    if (s.snapToFrame === true) currentTime = snapTime(currentTime, fps);
    const speed = numOr(s.playbackSpeed, 1);
    const loopStart = Math.max(0, numOr(s.loopStart, 0));
    /* 循环区间**不在这里交换**：保留用户输入的原值，start/end 的顺序语义由
       loopRangeToTime() 统一决定（返回 min/max）。否则 createState 的返回值与
       loopRangeToTime 的交换行为重叠，调用方无法判断到底谁在改数据。 */
    const loopEnd = isFiniteNum(s.loopEnd) ? s.loopEnd : duration;
    const frames = [];
    if (Array.isArray(s.selectedFrames)) {
      const seen = new Set();
      for (const f of s.selectedFrames) {
        const sf = snapFrame(f);
        if (!isFiniteNum(sf) || sf < 0 || seen.has(sf)) continue;
        seen.add(sf);
        frames.push(sf);
      }
      frames.sort((a, b) => a - b);
    }
    const range = normalizeRange(s.selectedFrameRange, fps);
    const mode = MODES.indexOf(s.activeMode) >= 0 ? s.activeMode : "frame";
    const pxPerSec = numOr(s.pxPerSec, DEFAULT_PX_PER_SEC);
    return {
      currentTime: currentTime,
      fps: fps,
      isPlaying: s.isPlaying === true,
      isLooping: s.isLooping !== false,
      playbackSpeed: speed > 0 ? speed : 1,
      selectedKeyIds: uniqueStrings(s.selectedKeyIds),
      selectedTrackIds: uniqueStrings(s.selectedTrackIds),
      selectedFrames: frames,
      selectedFrameRange: range,
      autoKey: s.autoKey !== false,
      snapToFrame: s.snapToFrame === true,
      activeMode: mode,
      loopStart: loopStart,
      loopEnd: loopEnd,
      duration: duration,
      pxPerSec: pxPerSec > 0 ? pxPerSec : DEFAULT_PX_PER_SEC,
      scrollFrame: Math.max(0, numOr(s.scrollFrame, 0)),
    };
  }

  /** Set / 数组 / {key:truthy} 统一成字符串 Set（与 timeline.js 的 keySetOf 同口径） */
  function toKeySet(value) {
    const set = new Set();
    if (value instanceof Set) {
      value.forEach(function (v) {
        set.add(String(v));
      });
      return set;
    }
    if (Array.isArray(value)) {
      for (const v of value) set.add(String(v));
      return set;
    }
    if (isObject(value)) {
      for (const k of Object.keys(value)) if (value[k]) set.add(String(k));
      return set;
    }
    return set;
  }

  function uniqueStrings(list) {
    const out = [];
    if (!Array.isArray(list)) return out;
    const seen = new Set();
    for (const v of list) {
      const sv = String(v);
      if (seen.has(sv)) continue;
      seen.add(sv);
      out.push(sv);
    }
    return out;
  }

  /** 不可变更新：patch 走 normalizeState，返回新 state（原对象不动） */
  function updateState(state, patch) {
    if (!isObject(state)) return normalizeState(patch);
    const next = Object.assign({}, state, isObject(patch) ? patch : {});
    return normalizeState(next);
  }

  /** patch：仅改当前时间（不改选择，§3.3「除非操作明确要求，否则不清除已有关键帧选择」） */
  function seekState(state, time) {
    return updateState(state, { currentTime: time });
  }

  /** 派生视图：当前帧 / 可见帧区间 / 当前帧列几何 / 选中集合 */
  function deriveState(state, opts) {
    const s = normalizeState(state);
    const o = isObject(opts) ? opts : {};
    const currentFrame = frameAtTime(s.currentTime, s.fps);
    const geom = currentFrameColumn(s.currentTime, {
      fps: s.fps, pxPerSec: s.pxPerSec, scrollFrame: s.scrollFrame, width: numOr(o.width, 0),
    });
    const visible = frameRange({
      fps: s.fps, pxPerSec: s.pxPerSec, scrollFrame: s.scrollFrame, width: numOr(o.width, 0),
    });
    const selectedCells = new Set();
    for (const f of s.selectedFrames) selectedCells.add(frameKey(f));
    return {
      state: s,
      currentFrame: currentFrame,
      currentTime: s.currentTime,
      durationFrames: timeToFrame(s.duration, s.fps),
      loopFrames: { start: snapFrame(timeToFrame(s.loopStart, s.fps)), end: snapFrame(timeToFrame(s.loopEnd, s.fps)) },
      column: geom,
      visible: visible,
      selectedCellKeys: Array.from(selectedCells),
      hasSelection: s.selectedFrames.length > 0 || !!s.selectedFrameRange,
    };
  }

  /* ------------------------------------------------------------------ *
   * §3.3 帧选择与范围（全部返回新数组/新对象，不改入参）
   * ------------------------------------------------------------------ */

  function normalizeRange(range, fps) {
    if (!isObject(range)) return null;
    let start = snapFrame(range.start);
    let end = snapFrame(range.end);
    if (!isFiniteNum(start) || !isFiniteNum(end)) return null;
    if (end < start) {
      const t = start;
      start = end;
      end = t;
    }
    /* 也接受秒：调用方传 {startTime,endTime} 时用 fps 换算 */
    return { start: start, end: end };
  }

  /**
   * 帧选择操作。op 取值：
   *   set / add(ctrl) / toggle / range(shift) / all / clear / invert / remove
   * @returns {{ok:boolean, state:object, selectedFrames:Array, selectedFrameRange:object|null, issues:Array}}
   */
  function selectFrames(state, op) {
    const s = normalizeState(state);
    const o = isObject(op) ? op : {};
    const kind = String(o.op || "set");
    const fps = s.fps;
    let frames = s.selectedFrames.slice();
    let range = s.selectedFrameRange;
    const frame = snapFrame(o.frame);
    const anchor = snapFrame(o.anchor);
    const issues = [];

    if (kind === "clear") {
      return done([], null);
    }
    if (kind === "all") {
      const last = Math.max(0, snapFrame(timeToFrame(s.duration, fps)));
      const list = [];
      for (let f = 0; f <= last; f++) list.push(f);
      return done(list, { start: 0, end: last });
    }
    if (kind === "invert") {
      const last = Math.max(0, snapFrame(timeToFrame(s.duration, fps)));
      const cur = new Set(frames);
      const list = [];
      for (let f = 0; f <= last; f++) if (!cur.has(f)) list.push(f);
      return done(list, null);
    }
    if (kind === "range") {
      const to = isFiniteNum(frame) ? frame : anchor;
      const from = isFiniteNum(anchor) ? anchor : frame;
      if (!isFiniteNum(from) || !isFiniteNum(to)) {
        return fail("frame/anchor 必须是有限数");
      }
      const a = Math.min(from, to);
      const b = Math.max(from, to);
      const list = [];
      for (let f = a; f <= b; f++) list.push(f);
      return done(list, { start: a, end: b });
    }
    if (!isFiniteNum(frame)) return fail("frame 必须是有限数");
    if (kind === "set") return done([frame], null);
    if (kind === "add") {
      if (frames.indexOf(frame) < 0) frames.push(frame);
      frames.sort((x, y) => x - y);
      return done(frames, null);
    }
    if (kind === "remove") {
      frames = frames.filter((f) => f !== frame);
      return done(frames, null);
    }
    if (kind === "toggle") {
      const i = frames.indexOf(frame);
      if (i >= 0) frames.splice(i, 1);
      else {
        frames.push(frame);
        frames.sort((x, y) => x - y);
      }
      return done(frames, null);
    }
    return fail("未知的帧选择操作：" + kind);

    function done(list, rng) {
      const next = updateState(s, { selectedFrames: list, selectedFrameRange: rng });
      return {
        ok: true, state: next, selectedFrames: next.selectedFrames.slice(),
        selectedFrameRange: next.selectedFrameRange, issues: issues,
      };
    }
    function fail(msg) {
      issues.push(issue("frame", "FRAME_SELECT_INVALID", msg));
      return {
        ok: false, state: s, selectedFrames: s.selectedFrames.slice(),
        selectedFrameRange: s.selectedFrameRange, issues: issues,
      };
    }
  }

  /** 当前帧列选中全部轨道（§3.3「选择当前帧所有轨道」） */
  function selectFrameAllTracks(state, frame, rows) {
    const s = normalizeState(state);
    const f = snapFrame(frame);
    if (!isFiniteNum(f)) {
      return { ok: false, state: s, selectedKeyIds: [], issues: [issue("frame", "FRAME_SELECT_INVALID", "frame 必须是有限数")] };
    }
    const ids = [];
    const list = Array.isArray(rows) ? rows : [];
    for (const row of list) {
      if (!isObject(row) || !Array.isArray(row.keys)) continue;
      const rk = defaultRowKey(row);
      for (const key of row.keys) {
        if (isObject(key) && isFiniteNum(key.time) && isSameFrame(key.time, f, s.fps)) {
          ids.push(rk + "@" + round(key.time, 6));
        }
      }
    }
    const next = updateState(s, { selectedKeyIds: uniqueStrings(ids) });
    return { ok: true, state: next, selectedKeyIds: next.selectedKeyIds.slice(), issues: [] };
  }

  function isSameFrame(timeA, frame, fps) {
    if (!isFiniteNum(timeA)) return false;
    return Math.abs(frameAtTime(timeA, fps) - snapFrame(frame)) === 0;
  }

  /* ------------------------------------------------------------------ *
   * §3.5 时间帧操作（整段动画的时间结构） vs 关键帧操作（调用方用 SpineAnimEdit）
   * ------------------------------------------------------------------ */

  /**
   * 收集动画里所有「时间列」（key 数组）。
   * 判据与 anim-edit.scanTimeDeep / scanTimelineKeys 同构：数组项是对象且带**有限 time**。
   * 递归进入数组项与对象值，因此 events / drawOrder / deform / attachments / ffd / ik 全部覆盖，
   * 未知扩展字段也不会被漏掉（这一点由 selftest 与 SpineAnimEdit.scanTimelineKeys 交叉核对）。
   * @returns {Array<{path:string, keys:Array}>}
   */
  function readColumns(anim) {
    const out = [];
    walk(anim, "", out, 0);
    return out;

    function walk(value, path, sink, depth) {
      if (depth > 24) return;
      if (Array.isArray(value)) {
        if (isKeyArray(value)) {
          sink.push({ path: path, keys: value });
          return;
        }
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (isObject(item) || Array.isArray(item)) walk(item, path + "[" + i + "]", sink, depth + 1);
        }
        return;
      }
      if (isObject(value)) {
        const names = Object.keys(value);
        for (let i = 0; i < names.length; i++) {
          const v = value[names[i]];
          if (isObject(v) || Array.isArray(v)) walk(v, path ? path + "." + names[i] : names[i], sink, depth + 1);
        }
      }
    }
    function isKeyArray(arr) {
      if (!arr.length) return false;
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        if (!isObject(it) || !isFiniteNum(it.time)) return false;
      }
      return true;
    }  }

  /**
   * 按路径取/放（readColumns 产出的 path 专用：`a.b[3].c`）。
   * @returns {{ok:boolean, value:*, parent:object|null, key:string|null, issues:Array}}
   *   最后一节是数组下标时 parent=数组、key=下标；否则 parent=对象、key=属性名。
   */
  function resolvePath(root, path) {
    const issues = [];
    const parts = String(path == null ? "" : path).split(".").filter((p) => p !== "");
    if (!parts.length) {
      return { ok: false, value: undefined, parent: null, key: null, issues: [issue("path", "PATH_EMPTY", "路径不能为空")] };
    }
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parsePart(parts[i]);
      if (i === parts.length - 1) {
        if (p.slot == null) {
          const parent = node;
          const okParent = isObject(parent);
          if (!okParent) issues.push(issue(path, "PATH_PARENT_INVALID", "路径父节点不是对象：" + path));
          return { ok: okParent, value: okParent ? parent[p.name] : undefined, parent: okParent ? parent : null, key: okParent ? p.name : null, issues: issues };
        }
        const arr = node && node[p.name];
        if (!Array.isArray(arr)) {
          issues.push(issue(path, "PATH_ARRAY_MISSING", "路径数组不存在：" + path));
          return { ok: false, value: undefined, parent: null, key: null, issues: issues };
        }
        return { ok: true, value: arr[p.slot], parent: arr, key: String(p.slot), issues: issues };
      }
      const next = node ? node[p.name] : undefined;
      if (next === undefined || next === null) {
        issues.push(issue(path, "PATH_MISSING", "路径中断于：" + parts[i]));
        return { ok: false, value: undefined, parent: null, key: null, issues: issues };
      }
      if (p.slot != null) {
        if (!Array.isArray(next)) {
          issues.push(issue(path, "PATH_NOT_ARRAY", "路径段不是数组：" + parts[i]));
          return { ok: false, value: undefined, parent: null, key: null, issues: issues };
        }
        node = next[p.slot];
      } else {
        node = next;
      }
    }
    return { ok: false, value: undefined, parent: null, key: null, issues: issues };
  }

  function parsePart(part) {
    const m = /^([^\[\]]*)((?:\[\d+\])*)$/.exec(String(part));
    const name = m ? m[1] : String(part);
    let slot = null;
    if (m && m[2]) {
      const idx = /\[(\d+)\]/.exec(m[2]);
      if (idx) slot = Number(idx[1]);
    }
    return { name: name, slot: slot };
  }

  /** 时间边界（去重、升序）：帧范围操作要以它们为切割点，避免同一时刻的 key 被拆开 */
  function timeBoundaries(anim) {
    const cols = readColumns(anim);
    const set = new Set();
    for (const col of cols) {
      for (const k of col.keys) if (isFiniteNum(k.time)) set.add(round(k.time, 9));
    }
    const list = Array.from(set).sort((a, b) => a - b);
    return { ok: true, times: list, count: list.length, columns: cols.length, issues: [] };
  }

  /**
   * 时间帧操作（整段动画）：这是与关键帧操作**分离**的那一半。
   * 所有位于该时间位置及之后的 key（含 events / deform / drawOrder）整体后移/前移，
   * 因此它天然作用于全部轨道，而不是某一条。
   *
   * op:
   *   insert  { atFrame, count }        在该帧插入 count 帧空档，该位置及之后的 key 后移
   *   remove  { atFrame, count }        删除 [atFrame, atFrame+count-1] 这一段，之后的 key 前移
   *   move    { fromFrame, count, deltaFrames }  把该范围内的时间整体平移（会影响范围外的邻接段）
   *   scale   { fromFrame, count, factor }       把该范围拉伸 factor 倍（§6.2 时间拉伸）
   *   clear   { fromFrame, count }      删除范围内的 key（**只删 key，不移动时间结构**）
   *
   * @returns {{ok:boolean, value:object|null, changed:number, moved:number, removed:number,
   *            boundaries:Array, issues:Array}} 失败时 value:null 且**入参零改动**
   */
  function applyTimeFrameOperation(anim, op) {
    /* issues 必须最先声明：内层 fail() 会在入参校验阶段就被调用，否则触发 TDZ */
    const issues = [];
    const o = isObject(op) ? op : {};
    if (!isObject(anim)) {
      return fail("animations", "FRAME_ANIM_INVALID", "动画必须是对象");
    }
    const kind = String(o.op || "");
    const fps = normFps(o.fps);
    /* 合法 op 白名单：必须在「空动画提前返回」**之前**校验。
       否则空动画 + 非法 op 会返回 ok:true，调用方误以为操作生效（实测过的契约漏洞）。 */
    const KNOWN_OPS = ["insert", "remove", "move", "scale", "clear", "reverse", "spread", "duplicate"];
    if (KNOWN_OPS.indexOf(kind) < 0) {
      return fail("op", "FRAME_OP_UNKNOWN", "未知的时间帧操作：" + kind);
    }
    const cols = readColumns(anim);
    if (!cols.length) {
      return { ok: true, value: clone(anim), changed: 0, moved: 0, removed: 0, boundaries: [], issues: [] };
    }
    const out = clone(anim);
    const outCols0 = readColumns(out);
    if (outCols0.length !== cols.length) {
      return fail("animations", "FRAME_CLONE_MISMATCH", "克隆后时间列数量不一致，拒绝写入");
    }
    /* 「仅作用于某条轨道」：UI 传 onlyRowKey + rowKeyOf(path)，把操作收窄到单条轨道。
       缺省（不传）= 作用于全部时间列，这与 §3.5「时间帧操作改整个动画的时间结构」一致。 */
    const onlyRowKey = typeof o.onlyRowKey === "string" && o.onlyRowKey ? o.onlyRowKey : null;
    const rowKeyOfPath = typeof o.rowKeyOf === "function" ? o.rowKeyOf : null;
    let outCols = outCols0;
    if (onlyRowKey) {
      if (!rowKeyOfPath) {
        return fail("onlyRowKey", "FRAME_ROWKEY_RESOLVER_MISSING", "onlyRowKey 需要同时提供 rowKeyOf(path) 才能定位轨道");
      }
      outCols = outCols0.filter((col) => String(rowKeyOfPath(col.path)) === onlyRowKey);
      if (!outCols.length) {
        return fail("onlyRowKey", "FRAME_ROWKEY_NOT_FOUND", "找不到轨道：" + onlyRowKey);
      }
    }
    const from = snapFrame(o.fromFrame != null ? o.fromFrame : o.atFrame);
    const count = Math.max(0, snapFrame(numOr(o.count, 1)));
    let moved = 0;
    let removed = 0;

    if (kind === "clear") {
      if (!isFiniteNum(from) || count <= 0) return fail("fromFrame", "FRAME_RANGE_INVALID", "clear 需要有效的 fromFrame 与 count>0");
      const hi = from + count - 1;
      for (const col of outCols) {
        const kept = [];
        for (const k of col.keys) {
          const f = frameAtTime(k.time, fps);
          if (isFiniteNum(f) && f >= from && f <= hi) {
            removed++;
            continue;
          }
          kept.push(k);
        }
        col.keys.length = 0;
        if (kept.length) {
          for (const k of kept) col.keys.push(k);
        } else {
          removeColumnAt(out, col.path);
        }
      }
      return ok(moved, removed, out);
    }

    if (kind === "insert") {
      if (!isFiniteNum(from) || from < 0) return fail("atFrame", "FRAME_RANGE_INVALID", "insert 需要非负 atFrame");
      if (count <= 0) return fail("count", "FRAME_RANGE_INVALID", "insert 的 count 必须大于 0");
      const threshold = from;
      const delta = count;
      for (const col of outCols) {
        for (const k of col.keys) {
          const f = frameAtTime(k.time, fps);
          if (isFiniteNum(f) && f >= threshold) {
            k.time = round(k.time + delta / fps, 12);
            moved++;
          }
        }
        sortByTime(col.keys);
      }
      return ok(moved, 0, out);
    }
    if (kind === "remove") {
      if (!isFiniteNum(from) || from < 0) return fail("atFrame", "FRAME_RANGE_INVALID", "remove 需要非负 atFrame");
      if (count <= 0) return fail("count", "FRAME_RANGE_INVALID", "remove 的 count 必须大于 0");
      const hi = from + count - 1;
      const policy = COLLISION_POLICY.indexOf(o.collision) >= 0 ? o.collision : "keep-both";
      for (const col of outCols) {
        const kept = [];
        for (const k of col.keys) {
          const f = frameAtTime(k.time, fps);
          if (isFiniteNum(f) && f >= from && f <= hi) {
            removed++;
            continue;
          }
          if (isFiniteNum(f) && f > hi) {
            k.time = round(k.time - count / fps, 12);
            moved++;
          }
          kept.push(k);
        }
        /* 前移后可能落在同一时刻：按策略去重（默认 keep-both 保留全部，由调用方提示） */
        const dedup = policy === "keep-both" ? kept : dedupeAtSameTime(kept, policy);
        /* 空列按 Spine 规范**移除该字段**（Spine 不会输出空 key 数组；
           这也保证 readColumns 的结果与「磁盘上真实存在的时间列」一致） */
        col.keys.length = 0;
        if (dedup.length) {
          for (const k of dedup) col.keys.push(k);
          sortByTime(col.keys);
        } else {
          removeColumnAt(out, col.path);
        }
      }
      return ok(moved, removed, out);
    }

    if (kind === "move") {
      if (!isFiniteNum(from) || count <= 0) return fail("fromFrame", "FRAME_RANGE_INVALID", "move 需要有效的 fromFrame 与 count>0");
      const toTime = numOr(o.deltaFrames, o.delta);
      if (!isFiniteNum(toTime)) return fail("deltaFrames", "FRAME_DELTA_INVALID", "move 需要有限数 deltaFrames");
      const hi = from + count - 1;
      const d = snapFrame(toTime);
      for (const col of outCols) {
        for (const k of col.keys) {
          const f = frameAtTime(k.time, fps);
          if (!isFiniteNum(f) || f < from || f > hi) continue;
          const nf = f + d;
          if (nf < 0) {
            issues.push(issue(col.path, "FRAME_MOVE_BELOW_ZERO", "第 " + f + " 帧平移后为负，已夹到 0"));
            k.time = 0;
          } else {
            k.time = round(k.time + d / fps, 12);
          }
          moved++;
        }
        sortByTime(col.keys);
      }
      return ok(moved, 0, out);
    }

    if (kind === "duplicate") {
      /* §6.1「复制帧段」：把 [from, from+count-1] 内的 Key **复制**到 +deltaFrames 处，
         原位置的 Key 保留（与 move 的区别就在这里）。
         用途：Flash 式「按住 Alt 拖拽帧段」= 复制而不是移动。
         同一轨道目标时刻已有 Key 时按 collision 策略处理（默认 skip，保留原有）。 */
      if (!isFiniteNum(from) || count <= 0) return fail("fromFrame", "FRAME_RANGE_INVALID", "duplicate 需要有效的 fromFrame 与 count>0");
      const deltaRaw = numOr(o.deltaFrames, o.delta);
      if (!isFiniteNum(deltaRaw)) return fail("deltaFrames", "FRAME_DELTA_INVALID", "duplicate 需要有限数 deltaFrames");
      const d = snapFrame(deltaRaw);
      if (d === 0) return fail("deltaFrames", "FRAME_DELTA_ZERO", "duplicate 的位移不能为 0");
      const hi = from + count - 1;
      const policyDup = COLLISION_POLICY.indexOf(o.collision) >= 0 ? o.collision : "skip";
      for (const col of outCols) {
        /* 先收集要复制的原始 Key（浅拷贝值），避免边遍历边插入 */
        const src = [];
        for (const k of col.keys) {
          const f = frameAtTime(k.time, fps);
          if (!isFiniteNum(f) || f < from || f > hi) continue;
          src.push({ f: f, key: k });
        }
        if (!src.length) continue;
        for (const s of src) {
          const nf = s.f + d;
          if (nf < 0) {
            issues.push(issue(col.path, "FRAME_DUPLICATE_BELOW_ZERO", "第 " + s.f + " 帧复制后为负，已跳过"));
            continue;
          }
          const newTime = round(nf / fps, 12);
          /* 目标时刻已有 Key：按策略处理 */
          const exists = col.keys.some((k) => Math.abs(k.time - newTime) < 1e-9);
          if (exists) {
            if (policyDup === "skip") continue;
            if (policyDup === "overwrite") {
              col.keys = col.keys.filter((k) => Math.abs(k.time - newTime) >= 1e-9);
            }
          }
          const copy = clone(s.key);
          copy.time = newTime;
          col.keys.push(copy);
          moved++;
        }
        sortByTime(col.keys);
        if (policyDup !== "keep-both") dedupeSameTrack(col.keys, policyDup);
      }
      return ok(moved, 0, out);
    }

    if (kind === "scale") {
      if (!isFiniteNum(from) || count <= 0) return fail("fromFrame", "FRAME_RANGE_INVALID", "scale 需要有效的 fromFrame 与 count>0");
      const factor = numOr(o.factor, 1);
      if (!(factor > 0)) return fail("factor", "FRAME_SCALE_INVALID", "scale 的 factor 必须大于 0");
      const hi = from + count - 1;
      const base = from;
      for (const col of outCols) {
        for (const k of col.keys) {
          const f = frameAtTime(k.time, fps);
          if (!isFiniteNum(f) || f < base || f > hi) continue;
          const nf = base + (f - base) * factor;
          k.time = round(nf / fps, 12);
          moved++;
        }
        sortByTime(col.keys);
        dedupeSameTrack(col.keys, "skip");
      }
      return ok(moved, 0, out);
    }

    if (kind === "reverse") {
      /* §6 Reverse Keys：在 [fromFrame, fromFrame+count-1] 内把关键帧的时间顺序整体反转，
         区间中点保持不动。**只反转该范围内已存在的 Key**，不在区间外造动态；
         同一轨道出现时间碰撞时按 collision 策略处理（默认 skip：保留先出现者）。 */
      if (!isFiniteNum(from) || from < 0 || count <= 0) return fail("fromFrame", "FRAME_RANGE_INVALID", "reverse 需要非负 fromFrame 与 count>0");
      const hi = from + count - 1;
      const policyRev = COLLISION_POLICY.indexOf(o.collision) >= 0 ? o.collision : "skip";
      for (const col of outCols) {
        for (const k of col.keys) {
          const f = frameAtTime(k.time, fps);
          if (!isFiniteNum(f) || f < from || f > hi) continue;
          const nf = from + hi - f;
          k.time = round(nf / fps, 12);
          moved++;
        }
        sortByTime(col.keys);
        if (policyRev !== "keep-both") dedupeSameTrack(col.keys, policyRev);
      }
      return ok(moved, 0, out);
    }

    if (kind === "spread") {
      /* §5.3「创建逐帧关键帧」的数据层：把 [fromFrame, fromFrame+count-1] 内每条受影响轨道
         的时间均匀重排到整数帧格上（值保持各自原有的先后顺序）。
         调用方必须先做范围确认（规划书 §5.3：全身/逐帧记录必须提供范围确认），
         本函数只负责数据，且**不会为没有 Key 的轨道凭空造 Key**。 */
      if (!isFiniteNum(from) || from < 0 || count <= 0) return fail("fromFrame", "FRAME_RANGE_INVALID", "spread 需要非负 fromFrame 与 count>0");
      const hi = from + count - 1;
      const policySp = COLLISION_POLICY.indexOf(o.collision) >= 0 ? o.collision : "skip";
      for (const col of outCols) {
        const inside = [];
        for (const k of col.keys) {
          const f = frameAtTime(k.time, fps);
          if (isFiniteNum(f) && f >= from && f <= hi) inside.push(k);
        }
        if (inside.length < 2) continue; /* 单个 Key 没有「逐帧」可言 */
        inside.sort((a, b) => a.time - b.time);
        const n = inside.length;
        for (let i = 0; i < n; i++) {
          /* 均匀铺到区间内的整数帧：首尾贴边，中间等距 */
          const target = n === 1 ? from : Math.round(from + ((hi - from) * i) / (n - 1));
          const cur = frameAtTime(inside[i].time, fps);
          if (cur === target) continue;
          inside[i].time = round(target / fps, 12);
          moved++;
        }
        sortByTime(col.keys);
        if (policySp !== "keep-both") dedupeSameTrack(col.keys, policySp);
      }
      return ok(moved, 0, out);
    }

    return fail("op", "FRAME_OP_UNKNOWN", "未知的时间帧操作：" + kind);

    function ok(mv, rm, value) {
      return { ok: true, value: value, changed: mv + rm, moved: mv, removed: rm, boundaries: timeBoundaries(anim).times, issues: issues };
    }
    function fail(path, code, message) {
      issues.push(issue(path, code, message));
      return { ok: false, value: null, changed: 0, moved: 0, removed: 0, boundaries: [], issues: issues };
    }
  }

  function sortByTime(keys) {
    keys.sort((a, b) => (isFiniteNum(a.time) ? a.time : 0) - (isFiniteNum(b.time) ? b.time : 0));
    return keys;
  }

  /**
   * 时间列路径 → 轨道行键（kind:owner:field），与 UI / 锁列表同一格式。
   *   "bones.hips.rotate"          → "bone:hips:rotate"
   *   "slots.mouth.attachment"     → "slot:mouth:attachment"
   *   "ik.ik-arm.bendPositive"     → "timeline:ik:ik-arm.bendPositive"
   *   "events" / "drawOrder" / "deform.mesh-1" → "timeline:<path>"
   * 与 UI 的 rowKeyOfPath 使用同一张映射，避免两处各写一套。
   */
  function rowKeyFromPath(path) {
    const segs = String(path == null ? "" : path).split(".");
    if (segs.length >= 3 && segs[0] === "bones") return "bone:" + segs[1] + ":" + segs[2];
    if (segs.length >= 3 && segs[0] === "slots") return "slot:" + segs[1] + ":" + segs[2];
    return "timeline:" + segs[0] + ":" + segs.slice(1).join(".");
  }

  /**
   * 按路径移除一个时间列（属性删除 / 数组下标 splice）。
   * 用于「清空后为空的时间列」：Spine 不会输出空 key 数组，留着会让 UI 出现空轨道，
   * 也会让 readColumns 的结果与磁盘上真实存在的时间列不一致。
   * @returns {{ok:boolean, removed:boolean, issues:Array}}
   */
  function removeColumnAt(root, path) {
    const rp = resolvePath(root, path);
    if (!rp.ok || !rp.parent) {
      return { ok: false, removed: false, issues: rp.issues.length ? rp.issues : [issue(path, "PATH_MISSING", "移除时间列失败：" + path)] };
    }
    if (Array.isArray(rp.parent)) {
      const idx = Number(rp.key);
      if (!Number.isInteger(idx) || idx < 0 || idx >= rp.parent.length) {
        return { ok: false, removed: false, issues: [issue(path, "PATH_INDEX_INVALID", "数组下标非法：" + rp.key)] };
      }
      rp.parent.splice(idx, 1);
      return { ok: true, removed: true, issues: [] };
    }
    if (isObject(rp.parent)) {
      delete rp.parent[rp.key];
      return { ok: true, removed: true, issues: [] };
    }
    return { ok: false, removed: false, issues: [issue(path, "PATH_PARENT_INVALID", "父节点不可删除：" + path)] };
  }

  /** 同一时刻只留一个：skip 保留先出现者；replace 保留后出现者 */
  function dedupeAtSameTime(keys, policy) {
    const out = [];
    for (const k of keys) {
      const dup = out.find((x) => Math.abs(x.time - k.time) <= 1e-9);
      if (!dup) {
        out.push(k);
        continue;
      }
      if (policy === "replace") dup.time = k.time, (dup.value = k.value), (dup.curve = k.curve), (dup.name = k.name);
    }
    return out;
  }

  function dedupeSameTrack(keys, policy) {
    const kept = dedupeAtSameTime(keys, policy);
    keys.length = 0;
    for (const k of kept) keys.push(k);
    return keys;
  }

  /** 时间范围查询（帧精度）：把范围内的 key 列出来（供复制/删除范围用） */
  function keysInFrameRange(rows, fromFrame, count, fps) {
    const list = Array.isArray(rows) ? rows : [];
    const from = snapFrame(fromFrame);
    const hi = from + Math.max(0, snapFrame(numOr(count, 1))) - 1;
    const out = [];
    if (!isFiniteNum(from)) {
      return { ok: false, keys: [], count: 0, issues: [issue("fromFrame", "FRAME_RANGE_INVALID", "fromFrame 必须是有限数")] };
    }
    for (const row of list) {
      if (!isObject(row) || !Array.isArray(row.keys)) continue;
      const rk = defaultRowKey(row);
      for (let i = 0; i < row.keys.length; i++) {
        const key = row.keys[i];
        const f = frameAtTime(isObject(key) ? key.time : NaN, fps);
        if (!isFiniteNum(f) || f < from || f > hi) continue;
        out.push({ rowKey: rk, row: row, rowIndex: list.indexOf(row), keyIndex: i, key: key, frame: f, time: key.time });
      }
    }
    out.sort((a, b) => a.frame - b.frame || a.rowIndex - b.rowIndex);
    return { ok: true, keys: out, count: out.length, range: { start: from, end: hi }, issues: [] };
  }

  /**
   * 破坏性范围操作的**影响预览**（规划书 §3.5：删除时间必须提供影响预览）。
   * 只统计与描述，不改任何数据 —— 供确认框展示。
   * @returns {{ok:boolean, tracks:number, keys:number, firstFrame:number, lastFrame:number,
   *            maxOffsetMs:number, sample:Array<string>, issues:Array}}
   */
  function rangeImpact(rows, fromFrame, count, fps) {
    const q = keysInFrameRange(rows, fromFrame, count, fps);
    if (!q.ok) {
      return { ok: false, tracks: 0, keys: 0, firstFrame: NaN, lastFrame: NaN, maxOffsetMs: 0, sample: [], issues: q.issues };
    }
    const tracks = new Set();
    const byTrack = new Map();
    for (const hit of q.keys) {
      tracks.add(hit.rowKey);
      if (!byTrack.has(hit.rowKey)) byTrack.set(hit.rowKey, []);
      byTrack.get(hit.rowKey).push(hit);
    }
    const mid = (q.range.start + q.range.end) / 2;
    let maxOffsetMs = 0;
    for (const list of byTrack.values()) {
      for (const hit of list) {
        const off = Math.abs(hit.frame - mid) / (numOr(fps, DEFAULT_FPS) || DEFAULT_FPS) * 1000;
        if (off > maxOffsetMs) maxOffsetMs = off;
      }
    }
    const sample = Array.from(tracks).slice(0, 5);
    return {
      ok: true,
      tracks: tracks.size,
      keys: q.count,
      firstFrame: q.range.start,
      lastFrame: q.range.end,
      maxOffsetMs: round(maxOffsetMs, 1),
      sample: sample,
      issues: [],
    };
  }

  /** 范围内是否存在关键帧（右键菜单「清空范围」前的判断） */
  function rangeHasKeys(rows, fromFrame, count, fps) {
    return keysInFrameRange(rows, fromFrame, count, fps).count > 0;
  }

  /* ------------------------------------------------------------------ *
   * §3.4 右键菜单上下文（只产出菜单项，不碰 DOM）
   * ------------------------------------------------------------------ */

  const MENU_EMPTY = Object.freeze([
    "addKey", "addPoseKey", "pasteKey", "pastePose", "clearFrameKeys", "selectFrame", "selectFrameAllTracks",
  ]);
  const MENU_KEY = Object.freeze([
    "editKey", "copyKey", "cutKey", "deleteKey", "moveKey", "setInterpolation", "locateKey",
  ]);
  const MENU_RANGE = Object.freeze([
    "copyRange", "deleteKeysInRange", "shiftRangeLeft", "shiftRangeRight", "stretchRange", "makePerFrameKeys", "clearRange",
    "reverseRange", "spreadRange",
  ]);

  /**
   * 判定某帧格该出哪一套菜单。
   * @param {{frame:number, hasKey?:boolean, range?:object|null, fps?:number}} ctx
   * @returns {{ok:boolean, kind:"range"|"key"|"empty", items:Array<string>, labels:object, issues:Array}}
   */
  function contextMenu(ctx) {
    const c = isObject(ctx) ? ctx : {};
    const range = c.range || null;
    let kind = "empty";
    let items = MENU_EMPTY;
    if (range) {
      kind = "range";
      items = MENU_RANGE;
    } else if (c.hasKey === true) {
      kind = "key";
      items = MENU_KEY;
    }
    const labels = {};
    for (const id of items) labels[id] = MENU_LABELS[id] || id;
    return { ok: true, kind: kind, items: items.slice(), labels: labels, issues: [] };
  }

  const MENU_LABELS = Object.freeze({
    addKey: "添加关键帧",
    addPoseKey: "添加姿态关键帧",
    pasteKey: "粘贴关键帧",
    pastePose: "粘贴姿态",
    clearFrameKeys: "清除当前帧关键帧",
    selectFrame: "选择当前帧",
    selectFrameAllTracks: "选择当前帧所有轨道",
    editKey: "编辑关键帧",
    copyKey: "复制关键帧",
    cutKey: "剪切关键帧",
    deleteKey: "删除关键帧",
    moveKey: "移动关键帧",
    setInterpolation: "设置插值",
    locateKey: "定位到关键帧",
    copyRange: "复制帧范围",
    deleteKeysInRange: "删除范围内关键帧",
    shiftRangeLeft: "整体向左移动",
    shiftRangeRight: "整体向右移动",
    stretchRange: "时间拉伸",
    makePerFrameKeys: "创建逐帧关键帧",
    clearRange: "清空范围",
    reverseRange: "反转关键帧顺序",
    spreadRange: "仅铺平所选轨道（逐帧）",
  });

  /* ------------------------------------------------------------------ *
   * 播放控制（§9）：帧级定位与循环区间
   * ------------------------------------------------------------------ */

  /**
   * 帧级定位（§9 FirstFrame/Prev/Next/Last、Shift+方向键跳 key）。
   * @returns {{ok:boolean, time:number, frame:number, issues:Array}}
   */
  function seekFrame(state, action, opts) {
    const s = normalizeState(state);
    const o = isObject(opts) ? opts : {};
    const fps = s.fps;
    const cur = frameAtTime(s.currentTime, fps);
    const lastFrame = Math.max(0, snapFrame(timeToFrame(s.duration, fps)));
    let target = cur;
    switch (String(action)) {
      case "first":
        target = 0;
        break;
      case "last":
        target = lastFrame;
        break;
      case "prev":
        target = Math.max(0, cur - 1);
        break;
      case "next":
        target = Math.min(lastFrame, cur + 1);
        break;
      case "prevKey":
        target = nearestKeyFrame(o.rows, cur, fps, -1);
        break;
      case "nextKey":
        target = nearestKeyFrame(o.rows, cur, fps, 1);
        break;
      case "frame":
        target = snapFrame(o.frame);
        break;
      case "loopStart":
        target = snapFrame(timeToFrame(s.loopStart, fps));
        break;
      case "loopEnd":
        target = snapFrame(timeToFrame(s.loopEnd, fps));
        break;
      default:
        return { ok: false, time: s.currentTime, frame: cur, issues: [issue("action", "FRAME_SEEK_UNKNOWN", "未知的定位动作：" + action)] };
    }
    if (!isFiniteNum(target)) {
      return { ok: false, time: s.currentTime, frame: cur, issues: [issue("frame", "FRAME_SEEK_INVALID", "目标帧不是有限数")] };
    }
    const clamped = Math.max(0, Math.min(lastFrame, target));
    return { ok: true, time: frameToTime(clamped, fps), frame: clamped, issues: [] };
  }

  /** 在 rows 里找当前帧之前/之后最近的关键帧（不含当前帧本身） */
  function nearestKeyFrame(rows, fromFrame, fps, dir) {
    const list = Array.isArray(rows) ? rows : [];
    let best = NaN;
    for (const row of list) {
      if (!isObject(row) || !Array.isArray(row.keys)) continue;
      for (const key of row.keys) {
        const f = frameAtTime(isObject(key) ? key.time : NaN, fps);
        if (!isFiniteNum(f)) continue;
        if (dir < 0 && f < fromFrame) {
          if (!isFiniteNum(best) || f > best) best = f;
        } else if (dir > 0 && f > fromFrame) {
          if (!isFiniteNum(best) || f < best) best = f;
        }
      }
    }
    return best;
  }

  /** 循环区间（帧）→ 秒；Start/End 反了就交换（§9 Start/End） */
  function loopRangeToTime(state) {
    const s = normalizeState(state);
    return {
      ok: true,
      start: Math.min(s.loopStart, s.loopEnd),
      end: Math.max(s.loopStart, s.loopEnd),
      startFrame: snapFrame(timeToFrame(Math.min(s.loopStart, s.loopEnd), s.fps)),
      endFrame: snapFrame(timeToFrame(Math.max(s.loopStart, s.loopEnd), s.fps)),
      issues: [],
    };
  }

  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */

  const api = {
    API_VERSION: API_VERSION,
    DEFAULT_FPS: DEFAULT_FPS,
    DEFAULT_PX_PER_SEC: DEFAULT_PX_PER_SEC,
    TIME_EPS: TIME_EPS,
    MODES: MODES,
    COLLISION_POLICY: COLLISION_POLICY,
    MENU_LABELS: MENU_LABELS,

    /* 换算 */
    normFps: normFps,
    frameToTime: frameToTime,
    timeToFrame: timeToFrame,
    snapTime: snapTime,
    snapFrame: snapFrame,
    frameAtTime: frameAtTime,
    frameKey: frameKey,
    parseFrameKey: parseFrameKey,

    /* 几何 */
    pxPerFrame: pxPerFrame,
    frameToX: frameToX,
    xToFrame: xToFrame,
    frameRange: frameRange,
    currentFrameColumn: currentFrameColumn,
    chooseFrameSteps: chooseFrameSteps,

    /* 帧格状态 */
    cellState: cellState,
    buildCells: buildCells,
    defaultRowKey: defaultRowKey,

    /* 状态 */
    createState: createState,
    normalizeState: normalizeState,
    updateState: updateState,
    seekState: seekState,
    deriveState: deriveState,

    /* 选择 */
    normalizeRange: normalizeRange,
    selectFrames: selectFrames,
    selectFrameAllTracks: selectFrameAllTracks,
    isSameFrame: isSameFrame,

    /* 时间帧操作（与关键帧操作分离） */
    readColumns: readColumns,
    resolvePath: resolvePath,
    removeColumnAt: removeColumnAt,
    rowKeyFromPath: rowKeyFromPath,
    timeBoundaries: timeBoundaries,
    applyTimeFrameOperation: applyTimeFrameOperation,
    keysInFrameRange: keysInFrameRange,
    rangeImpact: rangeImpact,
    rangeHasKeys: rangeHasKeys,

    /* 菜单与播放 */
    contextMenu: contextMenu,
    seekFrame: seekFrame,
    nearestKeyFrame: nearestKeyFrame,
    loopRangeToTime: loopRangeToTime,
  };

  global.SpineFrameTimeline = api;
  if (typeof window !== "undefined" && window.SpineFrameTimeline !== api) window.SpineFrameTimeline = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
