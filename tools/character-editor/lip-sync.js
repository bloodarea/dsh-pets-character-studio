/*
 * lip-sync.js —— 音频包络 → Spine 口型关键帧（纯逻辑层）
 *
 * 边界：不碰 DOM、不解码音频、不写文件。只做「给定包络与参数，算出口型序列」。
 *   解码在 app.js（WebAudio decodeAudioData），写盘走 SpineAnimEdit。
 *
 * 为什么要「补帧」：口型只有 4 档，若直接从 25 跳到 100，视觉上是硬切；
 *   在两档之间插入中间档（25→50→75→100）能让过渡更像说话。
 *   这是用户明确要求的「中间再补个帧」。
 *
 * 档位约定（与 assets 里真实附件名一致）：
 *   1 = mouth_张嘴_25
 *   2 = mouth_张嘴_50
 *   3 = mouth_张嘴_75
 *   4 = mouth_张嘴_100
 *   0 = 闭嘴（用 mouth_无表情；用户说「不加无表情是四挡」，所以 0 只用于静音段）
 */
(function (global) {
  "use strict";

  const API_VERSION = 1;
  const LEVELS = 4;
  const LEVEL_NAMES = Object.freeze({
    0: "mouth_无表情",
    1: "mouth_张嘴_25",
    2: "mouth_张嘴_50",
    3: "mouth_张嘴_75",
    4: "mouth_张嘴_100",
  });

  function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function isFiniteNum(v) { return typeof v === "number" && isFinite(v); }
  function issue(path, code, message) { return { path: String(path == null ? "" : path), code: code, message: String(message || code) }; }

  /** 幅度（0..1）→ 档位 1..4；低于 silenceThreshold 返回 0（闭嘴） */
  function levelOf(amp, silenceThreshold) {
    const a = isFiniteNum(amp) ? Math.max(0, Math.min(1, amp)) : 0;
    const th = isFiniteNum(silenceThreshold) ? silenceThreshold : 0.06;
    if (a < th) return 0;
    /* 四等分：0-25%→1，25-50%→2，50-75%→3，75-100%→4 */
    const lv = Math.ceil(a * LEVELS);
    return Math.max(1, Math.min(LEVELS, lv));
  }

  /**
   * 把峰值包络按帧取样 → 每帧一个档位。
   * @param {{peaks:Array<{min:number,max:number}>, duration:number, fps:number, silenceThreshold?:number}} input
   * @returns {{ok:boolean, levels:number[], frames:number, issues:Array}}
   */
  function sampleLevels(input) {
    const inp = isObject(input) ? input : {};
    const peaks = Array.isArray(inp.peaks) ? inp.peaks : [];
    const dur = isFiniteNum(inp.duration) && inp.duration > 0 ? inp.duration : 0;
    const fps = isFiniteNum(inp.fps) && inp.fps > 0 ? inp.fps : 30;
    if (!peaks.length) return { ok: false, levels: [], frames: 0, issues: [issue("peaks", "LIPSYNC_NO_PEAKS", "没有包络数据")] };
    if (!(dur > 0)) return { ok: false, levels: [], frames: 0, issues: [issue("duration", "LIPSYNC_NO_DURATION", "音频时长无效")] };

    const frames = Math.max(1, Math.round(dur * fps));
    const levels = new Array(frames);
    const per = peaks.length / frames;
    for (let f = 0; f < frames; f++) {
      const s0 = Math.floor(f * per);
      const s1 = Math.max(s0 + 1, Math.min(peaks.length, Math.floor((f + 1) * per)));
      let peak = 0;
      for (let i = s0; i < s1; i++) {
        const p = peaks[i];
        if (!isObject(p)) continue;
        const a = Math.max(Math.abs(isFiniteNum(p.min) ? p.min : 0), Math.abs(isFiniteNum(p.max) ? p.max : 0));
        if (a > peak) peak = a;
      }
      levels[f] = levelOf(peak, inp.silenceThreshold);
    }
    return { ok: true, levels: levels, frames: frames, issues: [] };
  }

  /**
   * 中间补帧：档位跨度 >1 时插入过渡档。
   * 例：2 → 4 补成 2,3,4；4 → 1 补成 4,3,2,1。
   * @param {{levels:number[], maxInsertPerStep?:number}} input
   * @returns {{ok:boolean, levels:number[], inserted:number, issues:Array}}
   */
  function smoothLevels(input) {
    const inp = isObject(input) ? input : {};
    const src = Array.isArray(inp.levels) ? inp.levels : [];
    if (src.length < 2) return { ok: true, levels: src.slice(), inserted: 0, issues: [] };
    const cap = isFiniteNum(inp.maxInsertPerStep) && inp.maxInsertPerStep >= 0 ? Math.floor(inp.maxInsertPerStep) : 3;

    const out = [src[0]];
    let inserted = 0;
    for (let i = 1; i < src.length; i++) {
      const prev = out[out.length - 1];
      const next = src[i];
      const gap = Math.abs(next - prev);
      if (gap > 1 && cap > 0) {
        const step = next > prev ? 1 : -1;
        const mid = Math.min(gap - 1, cap);
        for (let k = 1; k <= mid; k++) {
          out.push(prev + step * k);
          inserted++;
        }
      }
      out.push(next);
    }
    return { ok: true, levels: out, inserted: inserted, issues: [] };
  }

  /**
   * 相邻同档合并 → 关键帧列表（只保留变化点）。
   * @param {{levels:number[], fps:number}} input
   * @returns {{ok:boolean, keys:Array<{frame:number,time:number,level:number,name:string}>, issues:Array}}
   */
  function levelsToKeys(input) {
    const inp = isObject(input) ? input : {};
    const levels = Array.isArray(inp.levels) ? inp.levels : [];
    const fps = isFiniteNum(inp.fps) && inp.fps > 0 ? inp.fps : 30;
    if (!levels.length) return { ok: true, keys: [], issues: [] };

    const keys = [];
    let last = null;
    for (let f = 0; f < levels.length; f++) {
      const lv = levels[f];
      if (lv === last) continue;
      keys.push({
        frame: f,
        time: Math.round((f / fps) * 1e6) / 1e6,
        level: lv,
        name: LEVEL_NAMES[lv] || LEVEL_NAMES[0],
      });
      last = lv;
    }
    return { ok: true, keys: keys, issues: [] };
  }

  /**
   * 一键：包络 → 关键帧（取样 + 补帧 + 合并）。
   * @param {{peaks:Array, duration:number, fps?:number, silenceThreshold?:number, smooth?:boolean, maxInsertPerStep?:number}} input
   */
  function build(input) {
    const inp = isObject(input) ? input : {};
    const sampled = sampleLevels(inp);
    if (!sampled.ok) return { ok: false, keys: [], frames: 0, issues: sampled.issues };

    let levels = sampled.levels;
    let inserted = 0;
    if (inp.smooth !== false) {
      const sm = smoothLevels({ levels: levels, maxInsertPerStep: inp.maxInsertPerStep });
      levels = sm.levels;
      inserted = sm.inserted;
    }
    const keyed = levelsToKeys({ levels: levels, fps: inp.fps });
    return {
      ok: true,
      keys: keyed.keys,
      frames: levels.length,
      sourceFrames: sampled.frames,
      inserted: inserted,
      issues: [],
    };
  }

  /** 一行摘要（状态栏/日志） */
  function summaryLine(input) {
    const inp = isObject(input) ? input : {};
    const keys = Array.isArray(inp.keys) ? inp.keys.length : 0;
    if (!keys) return "没有生成口型关键帧";
    return keys + " 个口型关键帧" + (inp.inserted ? "（补帧 " + inp.inserted + "）" : "") + (inp.frames ? " · " + inp.frames + " 帧" : "");
  }

  const api = {
    API_VERSION: API_VERSION,
    LEVELS: LEVELS,
    LEVEL_NAMES: LEVEL_NAMES,
    levelOf: levelOf,
    sampleLevels: sampleLevels,
    smoothLevels: smoothLevels,
    levelsToKeys: levelsToKeys,
    build: build,
    summaryLine: summaryLine,
  };

  global.SpineLipSync = api;
  if (typeof window !== "undefined" && window.SpineLipSync !== api) window.SpineLipSync = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
