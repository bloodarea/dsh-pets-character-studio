/*
 * audio-wave.js —— 规划书 §14 P4「音频波形」· 纯逻辑层
 * 边界（与 frame-thumbs / anim-markers 一致）：
 *   本文件不碰 DOM、不解码音频、不写人物包。只做三件事：
 *     1) 把解码后的 PCM 采样压成**峰值包络**（绘制波形需要的就这一样东西）；
 *     2) 包络归一化与降采样到目标像素宽度；
 *     3) 时间 ↔ 像素换算（与帧视图同源，供在时间轴上叠波形）。
 *   解码（decodeAudioData）在 app.js，因为需要 AudioContext 与网络。
 *
 * 为什么要「峰值包络」而不是直接画采样：
 *   一段 3 秒 44.1kHz 的音频有 13 万个采样，画到 800px 宽只需 800 个值；
 *   逐采样画既慢又糊。峰值包络（每个像素桶取 |max| 与 |min|）是行业标准做法，
 *   而且能保留瞬态（人耳/眼睛最敏感的部分）。
 */
(function (global) {
  "use strict";

  const API_VERSION = 1;
  const MAX_BUCKETS = 4000;   /* 单次包络上限，防病态数据 */

  function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function isFiniteNum(v) { return typeof v === "number" && isFinite(v); }
  function issue(path, code, message) { return { path: String(path == null ? "" : path), code: code, message: String(message || code) }; }

  /**
   * 计算峰值包络。
   * @param {{channels:Array<Float32Array|number[]>, buckets:number}} input
   *   channels 每个元素是一条声道的采样（长度应一致；不一致时按最短处理）
   * @returns {{ok:boolean, peaks:Array<{min:number,max:number}>, buckets:number, issues:Array}}
   */
  function buildPeaks(input) {
    const inp = isObject(input) ? input : {};
    const chans = Array.isArray(inp.channels) ? inp.channels.filter((c) => c && typeof c.length === "number") : [];
    if (!chans.length) {
      return { ok: false, peaks: [], buckets: 0, issues: [issue("channels", "WAVE_CHANNELS_MISSING", "没有可用的声道数据")] };
    }
    let len = Infinity;
    for (const c of chans) len = Math.min(len, c.length);
    if (!isFiniteNum(len) || len <= 0) {
      return { ok: false, peaks: [], buckets: 0, issues: [issue("channels", "WAVE_EMPTY", "采样长度为 0")] };
    }
    const want = isFiniteNum(inp.buckets) && inp.buckets > 0 ? Math.floor(inp.buckets) : 800;
    const buckets = Math.min(want, MAX_BUCKETS, len);
    const per = len / buckets;
    const peaks = new Array(buckets);
    for (let b = 0; b < buckets; b++) {
      const s0 = Math.floor(b * per);
      const s1 = Math.max(s0 + 1, Math.min(len, Math.floor((b + 1) * per)));
      let mn = 0, mx = 0;
      for (let i = s0; i < s1; i++) {
        /* 多声道取所有声道的极值，避免某声道反相时漏掉幅度 */
        for (const c of chans) {
          const v = c[i];
          if (!isFiniteNum(v)) continue;
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      peaks[b] = { min: mn, max: mx };
    }
    return { ok: true, peaks: peaks, buckets: buckets, samples: len, issues: [] };
  }

  /**
   * 归一化到 [-1, 1]（按全局最大绝对值缩放）。
   * 静音（全 0）时原样返回，不制造放大噪声。
   */
  function normalizePeaks(peaks) {
    const arr = Array.isArray(peaks) ? peaks : [];
    let peakAbs = 0;
    for (const p of arr) {
      if (!isObject(p)) continue;
      const a = Math.max(Math.abs(isFiniteNum(p.min) ? p.min : 0), Math.abs(isFiniteNum(p.max) ? p.max : 0));
      if (a > peakAbs) peakAbs = a;
    }
    if (!(peakAbs > 1e-9)) return { ok: true, peaks: arr.slice(), gain: 1, silent: true, issues: [] };
    const gain = 1 / peakAbs;
    const out = arr.map((p) => ({
      min: Math.max(-1, (isFiniteNum(p && p.min) ? p.min : 0) * gain),
      max: Math.min(1, (isFiniteNum(p && p.max) ? p.max : 0) * gain),
    }));
    return { ok: true, peaks: out, gain: gain, silent: false, issues: [] };
  }

  /**
   * 按目标像素宽度重采样包络（最近桶聚合，保留极值）。
   * 目标比原包络宽时不做插值放大（重复桶即可），避免伪造细节。
   */
  function resamplePeaks(peaks, width) {
    const arr = Array.isArray(peaks) ? peaks : [];
    const w = isFiniteNum(width) && width > 0 ? Math.min(Math.floor(width), MAX_BUCKETS) : 0;
    if (!w || !arr.length) return { ok: true, peaks: [], issues: [] };
    if (w === arr.length) return { ok: true, peaks: arr.slice(), issues: [] };
    const out = new Array(w);
    const per = arr.length / w;
    for (let i = 0; i < w; i++) {
      const s0 = Math.floor(i * per);
      const s1 = Math.max(s0 + 1, Math.min(arr.length, Math.floor((i + 1) * per)));
      let mn = 0, mx = 0;
      for (let k = s0; k < s1; k++) {
        const p = arr[k];
        if (!isObject(p)) continue;
        if (isFiniteNum(p.min) && p.min < mn) mn = p.min;
        if (isFiniteNum(p.max) && p.max > mx) mx = p.max;
      }
      out[i] = { min: mn, max: mx };
    }
    return { ok: true, peaks: out, issues: [] };
  }

  /** 时间 ↔ 像素：与帧视图同源换算（sec → x） */
  function timeToX(input) {
    const inp = isObject(input) ? input : {};
    const sec = isFiniteNum(inp.sec) ? inp.sec : 0;
    const pxPerSec = isFiniteNum(inp.pxPerSec) && inp.pxPerSec > 0 ? inp.pxPerSec : 100;
    const scrollSec = isFiniteNum(inp.scrollSec) ? inp.scrollSec : 0;
    return Math.round((sec - scrollSec) * pxPerSec);
  }

  /** 像素 → 时间（x 的逆运算） */
  function xToTime(input) {
    const inp = isObject(input) ? input : {};
    const x = isFiniteNum(inp.x) ? inp.x : 0;
    const pxPerSec = isFiniteNum(inp.pxPerSec) && inp.pxPerSec > 0 ? inp.pxPerSec : 100;
    const scrollSec = isFiniteNum(inp.scrollSec) ? inp.scrollSec : 0;
    return x / pxPerSec + scrollSec;
  }

  /** 时长（秒）：优先用解码结果，否则按采样数/采样率推算 */
  function durationOf(input) {
    const inp = isObject(input) ? input : {};
    if (isFiniteNum(inp.duration) && inp.duration > 0) return inp.duration;
    const n = isFiniteNum(inp.samples) ? inp.samples : 0;
    const rate = isFiniteNum(inp.sampleRate) && inp.sampleRate > 0 ? inp.sampleRate : 0;
    if (!n || !rate) return 0;
    return n / rate;
  }

  /** 一行摘要（状态栏/提示） */
  function summaryLine(input) {
    const inp = isObject(input) ? input : {};
    const d = durationOf(inp);
    if (!(d > 0)) return "没有音频波形";
    return "波形 " + d.toFixed(2) + "s" + (inp.buckets ? " · " + inp.buckets + " 桶" : "") + (inp.silent ? "（静音）" : "");
  }

  const api = {
    API_VERSION: API_VERSION,
    MAX_BUCKETS: MAX_BUCKETS,
    buildPeaks: buildPeaks,
    normalizePeaks: normalizePeaks,
    resamplePeaks: resamplePeaks,
    timeToX: timeToX,
    xToTime: xToTime,
    durationOf: durationOf,
    summaryLine: summaryLine,
  };

  global.SpineAudioWave = api;
  if (typeof window !== "undefined" && window.SpineAudioWave !== api) window.SpineAudioWave = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
