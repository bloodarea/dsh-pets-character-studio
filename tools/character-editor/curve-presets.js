/*
 * curve-presets.js —— 规划书 §8.1 / §14 P4「曲线预设」· 纯模块
 * 边界（与 curve-edit / anim-edit 一致）：
 *   本文件不碰 DOM、不读模型、不写动画数据。只做一件事：
 *   **把一条有名字的缓动曲线，换算成 Spine 4.2 key.curve 需要的四元组**。
 *
 * 为什么需要它：
 *   Spine 的 `key.curve` 存的是**绝对坐标**的贝塞尔控制点 `[cx1,cy1,cx2,cy2]`，
 *   而用户心里的「缓入 / 缓出 / 回弹」是**归一化**的（0..1 的时间 × 0..1 的进度）。
 *   换算时要按段两端的时间与值缩放，且必须与 curve-edit.segmentInfo 的取法一致，
 *   否则控制点会跑飞。这段换算放进 DOM 代码里就没法测。
 *
 * 重要约定：
 *   - 时间轴：cx1/cx2 在 [t1, t2] 内（Spine 的 x 就是时间，不是归一化时间）；
 *   - 值轴：cy1/cy2 按 (v2-v1) 缩放后加 v1；
 *   - 值可能**反向**（v2 < v1），所以进度 p 的映射是 v1 + p*(v2-v1)，不是加绝对值。
 */
(function (global) {
  "use strict";

  const API_VERSION = 1;
  /* 预设表：归一化控制点 (x1,y1,x2,y2)，x 是时间进度、y 是值进度，均在 0..1（回弹类 y 可越界）。
     这些是业界通用的缓动手感，命名保持直白，不做"魔法数字"包装。 */
  const PRESETS = Object.freeze({
    linear: { x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3, label: "线性（匀速）", over: false },
    easeIn: { x1: 0.42, y1: 0, x2: 1, y2: 1, label: "缓入（起步慢）", over: false },
    easeOut: { x1: 0, y1: 0, x2: 0.58, y2: 1, label: "缓出（收尾慢）", over: false },
    easeInOut: { x1: 0.42, y1: 0, x2: 0.58, y2: 1, label: "缓入缓出（两头慢）", over: false },
    easeInStrong: { x1: 0.76, y1: 0, x2: 1, y2: 1, label: "强缓入", over: false },
    easeOutStrong: { x1: 0, y1: 0, x2: 0.24, y2: 1, label: "强缓出", over: false },
    backOut: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1, label: "回弹（末端过冲）", over: true },
    backIn: { x1: 0.36, y1: 0, x2: 0.66, y2: -0.56, label: "预备（起步反向）", over: true },
  });

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function isFiniteNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function round(v, digits) {
    const p = Math.pow(10, digits == null ? 6 : digits);
    return Math.round(v * p) / p;
  }
  function issue(path, code, message) {
    return { path: String(path == null ? "" : path), code: code, message: String(message || code) };
  }

  /** 预设清单（UI 下拉/按钮用），按「常用程度」排序 */
  function listPresets() {
    return ["linear", "easeIn", "easeOut", "easeInOut", "easeInStrong", "easeOutStrong", "backOut", "backIn"].map(function (id) {
      const p = PRESETS[id];
      return { id: id, label: p.label, over: p.over, points: { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 } };
    });
  }

  function presetOf(id) {
    if (typeof id !== "string") return null;
    const p = PRESETS[id];
    if (!p) return null;
    return { id: id, label: p.label, over: p.over, points: { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 } };
  }

  /**
   * 归一化控制点 → 该段的绝对控制点（可直接写进 key.curve）。
   * @param {{preset:string, time1:number, time2:number, value1:number, value2:number}} input
   * @returns {{ok:boolean, curve:number[]|null, over:boolean, issues:Array}}
   */
  function applyPreset(input) {
    const inp = isObject(input) ? input : {};
    const p = presetOf(inp.preset);
    if (!p) {
      return { ok: false, curve: null, over: false, issues: [issue("preset", "PRESET_UNKNOWN", "未知曲线预设：" + inp.preset)] };
    }
    const t1 = inp.time1;
    const t2 = inp.time2;
    const v1 = inp.value1;
    const v2 = inp.value2;
    if (!isFiniteNum(t1) || !isFiniteNum(t2) || !isFiniteNum(v1) || !isFiniteNum(v2)) {
      return { ok: false, curve: null, over: false, issues: [issue("segment", "PRESET_SEGMENT_INVALID", "段的 time/value 必须都是有限数")] };
    }
    /* 时间必须严格递增：Spine 的段是 key → nextKey，同刻或倒序都没有可插值区间 */
    if (!(t2 > t1)) {
      return { ok: false, curve: null, over: false, issues: [issue("time", "PRESET_TIME_ORDER", "下一关键帧必须晚于当前帧（" + round(t1, 4) + "s → " + round(t2, 4) + "s）")] };
    }
    const dt = t2 - t1;
    const dv = v2 - v1;
    const cx1 = t1 + p.points.x1 * dt;
    const cy1 = v1 + p.points.y1 * dv;
    const cx2 = t1 + p.points.x2 * dt;
    const cy2 = v1 + p.points.y2 * dv;
    return {
      ok: true,
      /* 与 curve-edit 一样保留 6 位，避免 float 噪声进入 JSON */
      curve: [round(cx1, 6), round(cy1, 6), round(cx2, 6), round(cy2, 6)],
      over: p.over,
      issues: [],
    };
  }

  /**
   * 把同一条预设应用到**多分量**字段（translate/scale/shear 有 x/y 两个分量）。
   * Spine 的 curve 数组按分量平铺：4 个数一段，N 个分量就是 4N 个。
   * @param {{preset:string, time1:number, time2:number, from:number[], to:number[]}} input
   * @returns {{ok:boolean, curve:number[]|null, over:boolean, issues:Array}}
   */
  function applyPresetMulti(input) {
    const inp = isObject(input) ? input : {};
    const from = Array.isArray(inp.from) ? inp.from : null;
    const to = Array.isArray(inp.to) ? inp.to : null;
    if (!from || !to || !from.length || from.length !== to.length) {
      return { ok: false, curve: null, over: false, issues: [issue("components", "PRESET_COMPONENTS_INVALID", "from/to 必须是等长非空数组")] };
    }
    const out = [];
    let over = false;
    for (let i = 0; i < from.length; i++) {
      const r = applyPreset({ preset: inp.preset, time1: inp.time1, time2: inp.time2, value1: from[i], value2: to[i] });
      if (!r.ok) return { ok: false, curve: null, over: false, issues: r.issues };
      for (const v of r.curve) out.push(v);
      if (r.over) over = true;
    }
    return { ok: true, curve: out, over: over, issues: [] };
  }

  /**
   * 反查：给定段的绝对控制点，猜最接近的预设（用于 UI 高亮当前预设）。
   * 做法是把绝对点归一化回 0..1 再比距离；**不追求唯一**，返回最近的与误差。
   * @returns {{ok:boolean, preset:string|null, distance:number, candidates:Array, issues:Array}}
   */
  function matchPreset(input) {
    const inp = isObject(input) ? input : {};
    const t1 = inp.time1;
    const t2 = inp.time2;
    const v1 = inp.value1;
    const v2 = inp.value2;
    const cx1 = inp.cx1;
    const cy1 = inp.cy1;
    const cx2 = inp.cx2;
    const cy2 = inp.cy2;
    if (![t1, t2, v1, v2, cx1, cy1, cx2, cy2].every(isFiniteNum)) {
      return { ok: false, preset: null, distance: NaN, candidates: [], issues: [issue("curve", "PRESET_MATCH_INVALID", "需要 8 个有限数才能反查预设")] };
    }
    const dt = t2 - t1;
    const dv = v2 - v1;
    if (!(dt > 0)) {
      return { ok: false, preset: null, distance: NaN, candidates: [], issues: [issue("time", "PRESET_TIME_ORDER", "时间必须递增才能反查")] };
    }
    /* 值轴退化（v1 === v2）：y 分量无法归一化，只用 x 比较，并标记 reduced */
    const reduced = Math.abs(dv) < 1e-9;
    const nx1 = (cx1 - t1) / dt;
    const nx2 = (cx2 - t1) / dt;
    const ny1 = reduced ? null : (cy1 - v1) / dv;
    const ny2 = reduced ? null : (cy2 - v1) / dv;
    const scored = [];
    for (const id of Object.keys(PRESETS)) {
      const p = PRESETS[id];
      let d = Math.abs(p.x1 - nx1) + Math.abs(p.x2 - nx2);
      if (!reduced) d += Math.abs(p.y1 - ny1) + Math.abs(p.y2 - ny2);
      scored.push({ id: id, label: p.label, distance: round(d, 6) });
    }
    scored.sort(function (a, b) {
      return a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    const best = scored[0];
    /* 阈值：4 个分量累计误差 < 0.02 才认为"就是某个预设"，否则只给最近候选 */
    const matched = best && best.distance <= (reduced ? 0.01 : 0.02) ? best.id : null;
    return { ok: true, preset: matched, nearest: best ? best.id : null, distance: best ? best.distance : NaN, reduced: reduced, candidates: scored.slice(0, 3), issues: [] };
  }

  /**
   * 一行描述（状态栏/报告用）。
   *
   * 注意：预设标签本身可能含「过冲」字样（如 backOut 的「回弹（末端过冲）」），
   * 所以 over 覆盖不能只靠"追加一句话"来表达 —— 必须**先剥掉标签里的过冲措辞**，
   * 否则 {over:false} 之后文本里仍出现过冲字样，调用方无法据此判断。
   */
  function describePreset(id, opts) {
    const p = presetOf(id);
    if (!p) return "未知预设：" + id;
    const o = isObject(opts) ? opts : {};
    const over = o.over !== undefined ? !!o.over : p.over;
    /* 标签里的括号说明（含"过冲/反向"等）只在 over 为真时保留 */
    const base = p.label.replace(/（[^）]*）\s*$/, "");
    const inner = (p.label.match(/（([^）]*)）\s*$/) || [])[1] || "";
    const parts = [base];
    if (over) {
      if (inner) parts.push("（" + inner + "）");
      else parts.push("（含过冲，注意首尾帧值）");
    }
    return parts.join("");
  }

  const api = {
    API_VERSION: API_VERSION,
    PRESETS: PRESETS,
    listPresets: listPresets,
    presetOf: presetOf,
    applyPreset: applyPreset,
    applyPresetMulti: applyPresetMulti,
    matchPreset: matchPreset,
    describePreset: describePreset,
  };

  global.SpineCurvePresets = api;
  if (typeof window !== "undefined" && window.SpineCurvePresets !== api) window.SpineCurvePresets = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
