/*
 * anim-markers.js —— 规划书 §14 P4「动作标记」· 纯模块
 * 边界（与 timeline / frame-timeline 一致）：
 *   本文件不碰 DOM、不写人物包 JSON。只做三件事：
 *     1) 把「时间 + 名称 + 颜色」规范化成一条标记记录；
 *     2) 增删改查（全部纯函数，返回新数组，不改入参）；
 *     3) 与帧号互转、区间查询、按名称去重。
 *
 * 为什么不写进人物包 JSON：
 *   动作标记是**编辑器侧的辅助标注**（"这里该抬手""这段是循环点"），
 *   不属于 Spine 动画数据，也不该被导出到 runtime。所以它只存在编辑器偏好
 *   （localStorage）里，按「模型签名 + 动画名」隔离 —— 见 app.js 的调用方。
 *   本模块因此完全不认识人物包格式，只处理 {time, name, color} 三元组。
 *
 * 时间语义：
 *   标记的 time 是**秒**（与动画一致）；frame 只是显示用的换算值。
 *   fps 变化不应移动标记的秒位置 —— 这一点在 toFrame/fromFrame 里写死。
 */
(function (global) {
  "use strict";

  const API_VERSION = 1;
  const MAX_MARKERS = 500; /* 单动画上限：标记是人工标注，超过这个数基本是误用 */
  const NAME_MAX = 64;
  const COLOR_RE = /^#([0-9a-fA-F]{6})$/;
  const DEFAULT_COLOR = "#f0b429";

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
  function normFps(fps) {
    const f = isFiniteNum(fps) && fps > 0 ? fps : 30;
    return f < 1 ? 1 : f > 240 ? 240 : f;
  }

  /**
   * 规范化一条标记。
   * @param {{time:number, name:string, color?:string}} input
   * @param {{duration?:number, fps?:number}} [opts]
   * @returns {{ok:boolean, marker:object|null, issues:Array}}
   */
  function normalizeMarker(input, opts) {
    const inp = isObject(input) ? input : {};
    const o = isObject(opts) ? opts : {};
    const issues = [];
    if (!isFiniteNum(inp.time)) {
      issues.push(issue("time", "MARKER_TIME_INVALID", "标记时间必须是有限数"));
    } else if (inp.time < 0) {
      issues.push(issue("time", "MARKER_TIME_NEGATIVE", "标记时间不能为负"));
    } else if (isFiniteNum(o.duration) && o.duration > 0 && inp.time > o.duration + 1e-9) {
      issues.push(issue("time", "MARKER_TIME_OVER_DURATION", "标记时间 " + round(inp.time, 3) + "s 超过动画时长 " + round(o.duration, 3) + "s"));
    }
    const rawName = typeof inp.name === "string" ? inp.name : "";
    const name = rawName.trim();
    if (!name) issues.push(issue("name", "MARKER_NAME_EMPTY", "标记名称不能为空"));
    else if (name.length > NAME_MAX) issues.push(issue("name", "MARKER_NAME_TOO_LONG", "标记名称最多 " + NAME_MAX + " 字符"));
    let color = DEFAULT_COLOR;
    if (inp.color !== undefined && inp.color !== null && inp.color !== "") {
      if (typeof inp.color !== "string" || !COLOR_RE.test(inp.color)) {
        issues.push(issue("color", "MARKER_COLOR_INVALID", "颜色必须是 #RRGGBB 形式：" + String(inp.color)));
      } else {
        color = inp.color.toLowerCase();
      }
    }
    if (issues.length) return { ok: false, marker: null, issues: issues };
    return {
      ok: true,
      marker: { time: round(inp.time, 6), name: name, color: color },
      issues: [],
    };
  }

  /** 秒 → 帧号（四舍五入到整数帧） */
  function toFrame(time, fps) {
    if (!isFiniteNum(time)) return NaN;
    return Math.round(time * normFps(fps));
  }

  /** 帧号 → 秒 */
  function fromFrame(frame, fps) {
    if (!isFiniteNum(frame)) return NaN;
    return round(frame / normFps(fps), 9);
  }

  /** 按时间升序排序（同刻按名称稳定排序，保证渲染顺序确定） */
  function sortMarkers(list) {
    const arr = Array.isArray(list) ? list.slice() : [];
    arr.sort(function (a, b) {
      const ta = a && isFiniteNum(a.time) ? a.time : 0;
      const tb = b && isFiniteNum(b.time) ? b.time : 0;
      if (ta !== tb) return ta - tb;
      const na = a && typeof a.name === "string" ? a.name : "";
      const nb = b && typeof b.name === "string" ? b.name : "";
      return na < nb ? -1 : na > nb ? 1 : 0;
    });
    return arr;
  }

  /**
   * 新增一条标记。
   * @returns {{ok:boolean, list:Array, marker:object|null, index:number, issues:Array}}
   *   同刻同名视为重复，拒绝（不静默覆盖）。
   */
  function addMarker(list, input, opts) {
    const cur = Array.isArray(list) ? list.slice() : [];
    const o = isObject(opts) ? opts : {};
    if (cur.length >= MAX_MARKERS) {
      return { ok: false, list: cur, marker: null, index: -1, issues: [issue("markers", "MARKER_LIMIT", "单动画标记数量上限 " + MAX_MARKERS)] };
    }
    const n = normalizeMarker(input, o);
    if (!n.ok) return { ok: false, list: cur, marker: null, index: -1, issues: n.issues };
    const dup = cur.findIndex(function (m) {
      return m && Math.abs((isFiniteNum(m.time) ? m.time : 0) - n.marker.time) <= 1e-6 && m.name === n.marker.name;
    });
    if (dup >= 0) {
      return { ok: false, list: cur, marker: null, index: dup, issues: [issue("markers[" + dup + "]", "MARKER_DUPLICATE", "该时刻已有同名标记「" + n.marker.name + "」")] };
    }
    const next = sortMarkers(cur.concat([n.marker]));
    return { ok: true, list: next, marker: n.marker, index: next.indexOf(n.marker), issues: [] };
  }

  /** 删除：按 index，或按 {time,name} 定位 */
  function removeMarker(list, target) {
    const cur = Array.isArray(list) ? list.slice() : [];
    let idx = -1;
    if (isFiniteNum(target)) {
      idx = Math.round(target);
    } else if (isObject(target)) {
      const t = isFiniteNum(target.time) ? target.time : NaN;
      idx = cur.findIndex(function (m) {
        if (!m || !isFiniteNum(t)) return false;
        if (Math.abs(m.time - t) > 1e-6) return false;
        return target.name === undefined || m.name === target.name;
      });
    }
    if (idx < 0 || idx >= cur.length) {
      return { ok: false, list: cur, removed: null, issues: [issue("index", "MARKER_NOT_FOUND", "找不到该标记")] };
    }
    const removed = cur[idx];
    cur.splice(idx, 1);
    return { ok: true, list: cur, removed: removed, issues: [] };
  }

  /** 改名 / 改色 / 改时间（时间变化会重新排序） */
  function updateMarker(list, index, patch, opts) {
    const cur = Array.isArray(list) ? list.slice() : [];
    const idx = isFiniteNum(index) ? Math.round(index) : -1;
    if (idx < 0 || idx >= cur.length) {
      return { ok: false, list: cur, marker: null, issues: [issue("index", "MARKER_NOT_FOUND", "找不到该标记")] };
    }
    const merged = Object.assign({}, cur[idx], isObject(patch) ? patch : {});
    const n = normalizeMarker(merged, opts);
    if (!n.ok) return { ok: false, list: cur, marker: null, issues: n.issues };
    /* 改完之后若与另一条同刻同名，也算重复 */
    const dup = cur.findIndex(function (m, i) {
      return i !== idx && m && Math.abs((isFiniteNum(m.time) ? m.time : 0) - n.marker.time) <= 1e-6 && m.name === n.marker.name;
    });
    if (dup >= 0) {
      return { ok: false, list: cur, marker: null, issues: [issue("markers[" + dup + "]", "MARKER_DUPLICATE", "该时刻已有同名标记「" + n.marker.name + "」")] };
    }
    cur[idx] = n.marker;
    return { ok: true, list: sortMarkers(cur), marker: n.marker, issues: [] };
  }

  /** 取 [fromTime, toTime] 内的标记（含端点） */
  function markersInRange(list, fromTime, toTime) {
    const cur = Array.isArray(list) ? list : [];
    const lo = isFiniteNum(fromTime) ? Math.min(fromTime, toTime) : -Infinity;
    const hi = isFiniteNum(toTime) ? Math.max(fromTime, toTime) : Infinity;
    return cur.filter(function (m) {
      return m && isFiniteNum(m.time) && m.time >= lo - 1e-9 && m.time <= hi + 1e-9;
    });
  }

  /** 离给定时间最近的标记（同距取较早者）；没有返回 null */
  function nearestMarker(list, time) {
    const cur = Array.isArray(list) ? list : [];
    if (!isFiniteNum(time)) return null;
    let best = null;
    let bestD = Infinity;
    for (const m of cur) {
      if (!m || !isFiniteNum(m.time)) continue;
      const d = Math.abs(m.time - time);
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best && m.time < best.time)) {
        best = m;
        bestD = d;
      }
    }
    return best;
  }

  /** 校验一整份标记列表（从偏好读回时用）：坏项跳过并报告，不整份丢弃 */
  function validateList(list, opts) {
    const cur = Array.isArray(list) ? list : [];
    const out = [];
    const issues = [];
    for (let i = 0; i < cur.length; i++) {
      const n = normalizeMarker(cur[i], opts);
      if (!n.ok) {
        for (const it of n.issues) issues.push(issue("markers[" + i + "]." + it.path, it.code, it.message));
        continue;
      }
      out.push(n.marker);
    }
    return { ok: issues.length === 0, list: sortMarkers(out), issues: issues };
  }

  /** 一行摘要（状态栏/提示用） */
  function summaryLine(list, fps) {
    const cur = Array.isArray(list) ? list : [];
    if (!cur.length) return "没有动作标记";
    const names = cur.slice(0, 3).map(function (m) { return m.name; }).join("、");
    return cur.length + " 个标记（" + names + (cur.length > 3 ? " 等" : "") + "）";
  }

  const api = {
    API_VERSION: API_VERSION,
    MAX_MARKERS: MAX_MARKERS,
    NAME_MAX: NAME_MAX,
    DEFAULT_COLOR: DEFAULT_COLOR,
    normalizeMarker: normalizeMarker,
    toFrame: toFrame,
    fromFrame: fromFrame,
    sortMarkers: sortMarkers,
    addMarker: addMarker,
    removeMarker: removeMarker,
    updateMarker: updateMarker,
    markersInRange: markersInRange,
    nearestMarker: nearestMarker,
    validateList: validateList,
    summaryLine: summaryLine,
  };

  global.SpineAnimMarkers = api;
  if (typeof window !== "undefined" && window.SpineAnimMarkers !== api) window.SpineAnimMarkers = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
