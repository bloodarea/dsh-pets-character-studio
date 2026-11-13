/*
 * frame-thumbs.js —— 规划书 §14 P4「帧缩略图」· 纯逻辑层
 * 边界（与 frame-timeline / pose-compare 一致）：
 *   本文件不碰 DOM、不读模型、不写动画数据。只做三件事：
 *     1) 决定「该为哪些帧出缩略图」（抽稀策略，避免 1000 帧全画）；
 *     2) 缓存键与失效判定（同一帧+同一动画+同一模型签名 → 复用）；
 *     3) 布局换算（缩略图尺寸、间距、在标尺区的落点）。
 *   真正的离屏绘制在 app.js（复用主画布快照），因为需要真实渲染管线。
 *
 * 为什么抽稀是必须的：一部 3.5s@30fps 的动画有 105 帧，逐帧渲染+drawImage
 * 在拖动播放头时会明显卡顿；而缩略图只是**视觉锚点**，不需要每帧都有。
 */
(function (global) {
  "use strict";

  const API_VERSION = 1;
  const MAX_THUMBS = 60;        /* 单次最多画多少个缩略图 */
  const DEFAULT_SIZE = 44;      /* 默认边长（CSS px） */
  const MIN_SIZE = 16;
  const MAX_SIZE = 160;

  function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function isFiniteNum(v) { return typeof v === "number" && isFinite(v); }
  function issue(path, code, message) { return { path: String(path == null ? "" : path), code: code, message: String(message || code) }; }

  /**
   * 抽稀：给定帧范围与最大数量，返回应当出缩略图的帧号列表（含首尾）。
   * @param {{fromFrame:number, toFrame:number, maxCount?:number, step?:number}} input
   * @returns {{ok:boolean, frames:number[], step:number, issues:Array}}
   */
  function planFrames(input) {
    const inp = isObject(input) ? input : {};
    const a = Math.round(isFiniteNum(inp.fromFrame) ? inp.fromFrame : 0);
    const b = Math.round(isFiniteNum(inp.toFrame) ? inp.toFrame : 0);
    if (a < 0 || b < 0) return { ok: false, frames: [], step: 1, issues: [issue("frame", "THUMB_FRAME_NEGATIVE", "帧号不能为负")] };
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const total = hi - lo + 1;
    const maxCount = isFiniteNum(inp.maxCount) && inp.maxCount > 0 ? Math.floor(inp.maxCount) : MAX_THUMBS;
    if (total <= 0) return { ok: true, frames: [], step: 1, issues: [] };
    /* 显式 step 优先（用户指定抽稀间隔） */
    let step = 1;
    if (isFiniteNum(inp.step) && inp.step >= 1) step = Math.floor(inp.step);
    else if (total > maxCount) step = Math.ceil(total / maxCount);
    const frames = [];
    for (let f = lo; f <= hi; f += step) frames.push(f);
    /* 末帧补上，保证视觉上有终点锚。
       注意：只有「还没到上限」时才 push，否则用末帧替换最后一个 —— 这样
       frames.length 永远不会超过 maxCount，下面的截断就成了纯保险。 */
    if (frames.length && frames[frames.length - 1] !== hi) {
      if (frames.length >= maxCount && frames.length > 1) frames[frames.length - 1] = hi;
      else frames.push(hi);
    }
    /* 保险：显式 step 过小或浮点误差可能让数量超限，这里硬截断。
       **注意**：正常路径下这一行是死代码（上面的 step 取整已保证不超限），
       所以自检里另加了一条「直接喂小 step + 大范围」的用例来覆盖它 ——
       否则变异测试会证明它是假守卫（实测如此）。 */
    const truncated = frames.length > maxCount;
    if (truncated) frames.length = maxCount;
    return { ok: true, frames: frames, step: step, truncated: truncated, issues: [] };
  }

  /** 缩略图缓存键：动画 + 帧 + 模型签名（模型变了必须重画） */
  function cacheKey(input) {
    const inp = isObject(input) ? input : {};
    const anim = typeof inp.anim === "string" ? inp.anim : "";
    const frame = isFiniteNum(inp.frame) ? Math.round(inp.frame) : 0;
    const sig = typeof inp.modelSignature === "string" ? inp.modelSignature : "";
    const size = isFiniteNum(inp.size) ? Math.round(inp.size) : DEFAULT_SIZE;
    return anim + "|" + frame + "|" + sig + "|" + size;
  }

  /** 尺寸归一化（夹到合理区间；非数回落默认） */
  function clampSize(v) {
    if (!isFiniteNum(v)) return DEFAULT_SIZE;
    return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(v)));
  }

  /**
   * 布局：每个缩略图在「帧标尺下方一行」的横向落点。
   * @param {{frames:number[], fps:number, pxPerSec:number, scrollSec:number, size:number, gap?:number, width:number}} input
   * @returns {{ok:boolean, items:Array<{frame:number,x:number,size:number,visible:boolean}>, issues:Array}}
   */
  function layout(input) {
    const inp = isObject(input) ? input : {};
    const frames = Array.isArray(inp.frames) ? inp.frames : [];
    const fps = isFiniteNum(inp.fps) && inp.fps > 0 ? inp.fps : 30;
    const pxPerSec = isFiniteNum(inp.pxPerSec) && inp.pxPerSec > 0 ? inp.pxPerSec : 100;
    const scrollSec = isFiniteNum(inp.scrollSec) ? inp.scrollSec : 0;
    const size = clampSize(inp.size);
    const gap = isFiniteNum(inp.gap) && inp.gap >= 0 ? inp.gap : 4;
    const width = isFiniteNum(inp.width) && inp.width > 0 ? inp.width : 800;
    const items = [];
    for (const f of frames) {
      if (!isFiniteNum(f)) continue;
      /* 与帧视图同源换算：x = (frame/fps - scrollSec) * pxPerSec */
      const x = Math.round((f / fps - scrollSec) * pxPerSec);
      const visible = x + size >= 0 && x <= width;
      items.push({ frame: Math.round(f), x: x, size: size, visible: visible });
    }
    return { ok: true, items: items, size: size, gap: gap, issues: [] };
  }

  /** 该缩略图是否在可视范围内（供绘制时提前跳过） */
  function isVisible(item, width) {
    if (!isObject(item)) return false;
    const w = isFiniteNum(width) ? width : 0;
    return item.x + item.size >= 0 && item.x <= w;
  }

  /** 一行摘要（状态栏/提示） */
  function summaryLine(input) {
    const inp = isObject(input) ? input : {};
    const n = isFiniteNum(inp.count) ? inp.count : 0;
    if (!n) return "没有帧缩略图";
    return n + " 张缩略图" + (inp.truncated ? "（已抽稀）" : "") + (inp.size ? " · " + inp.size + "px" : "");
  }

  const api = {
    API_VERSION: API_VERSION,
    MAX_THUMBS: MAX_THUMBS,
    DEFAULT_SIZE: DEFAULT_SIZE,
    MIN_SIZE: MIN_SIZE,
    MAX_SIZE: MAX_SIZE,
    planFrames: planFrames,
    cacheKey: cacheKey,
    clampSize: clampSize,
    layout: layout,
    isVisible: isVisible,
    summaryLine: summaryLine,
  };

  global.SpineFrameThumbs = api;
  if (typeof window !== "undefined" && window.SpineFrameThumbs !== api) window.SpineFrameThumbs = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
