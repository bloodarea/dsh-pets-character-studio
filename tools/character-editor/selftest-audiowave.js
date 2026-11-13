/*
 * selftest-audiowave.js —— audio-wave.js 的纯函数自检（Node / 浏览器共用）
 * 依赖：audio-wave.js（globalThis.SpineAudioWave）
 * 输出：globalThis.__selftestAudioWaveResult = {passed, failed, total, skipped, cases, failures, notes}
 * 覆盖：峰值包络（含多声道/不等长/空数据）/ 归一化（含静音）/ 重采样 / 时间换算 / 时长 / 摘要。
 */
(function (global) {
  "use strict";

  var result = { passed: 0, failed: 0, total: 0, skipped: 0, cases: {}, failures: [], notes: [], startedAt: new Date().toISOString() };
  var currentCase = "(global)";

  function record(pass, name, expected, actual, detail) {
    result.total++;
    var c = result.cases[currentCase] || (result.cases[currentCase] = { passed: 0, failed: 0 });
    if (pass) { result.passed++; c.passed++; return true; }
    result.failed++; c.failed++;
    result.failures.push({ case: currentCase, name: name, expected: expected === undefined ? null : expected, actual: actual === undefined ? null : actual, detail: detail || "" });
    return false;
  }
  function ok(name, cond, detail) { return record(!!cond, name, "truthy", cond, detail); }
  function eq(name, actual, expected) { return record(actual === expected, name, expected, actual); }
  function near(name, actual, expected, tol) {
    var t = tol === undefined ? 1e-9 : tol;
    return record(typeof actual === "number" && isFinite(actual) && Math.abs(actual - expected) <= t, name, expected, actual, "tol=" + t);
  }
  function deepEq(name, actual, expected) {
    var a = JSON.stringify(actual), b = JSON.stringify(expected);
    return record(a === b, name, b, a);
  }
  function section(name) { currentCase = name; }

  var W = global.SpineAudioWave;
  if (!W) {
    result.total++; result.failed++;
    result.failures.push({ case: "(load)", name: "SpineAudioWave 未加载", expected: "object", actual: typeof W, detail: "" });
    global.__selftestAudioWaveResult = result;
    if (typeof window !== "undefined") window.__selftestAudioWaveResult = result;
    return;
  }

  /* ================================================================== *
   * 1. 峰值包络
   * ================================================================== */
  section("峰值包络：分桶取极值");

  var mono = W.buildPeaks({ channels: [new Float32Array([0, 0.5, -0.5, 1, -1, 0.25])], buckets: 3 });
  eq("单声道 ok", mono.ok, true);
  eq("桶数 3", mono.buckets, 3);
  eq("采样数 6", mono.samples, 6);
  deepEq("桶 0 的 min/max", mono.peaks[0], { min: 0, max: 0.5 });
  deepEq("桶 1 的 min/max", mono.peaks[1], { min: -0.5, max: 1 });
  deepEq("桶 2 的 min/max", mono.peaks[2], { min: -1, max: 0.25 });

  /* 多声道：取所有声道极值，避免反相漏幅度。
     注意：Float32Array 存 -0.9 实际是 -0.8999999761581421，所以用近似比较。 */
  var stereo = W.buildPeaks({ channels: [new Float32Array([0.5, 0.5]), new Float32Array([-0.9, 0.2])], buckets: 1 });
  near("多声道保留负向极值（反相不漏幅度）", stereo.peaks[0].min, -0.9, 1e-6);
  near("多声道保留正向极值", stereo.peaks[0].max, 0.5, 1e-6);

  /* 不等长：按最短处理 */
  var uneven = W.buildPeaks({ channels: [new Float32Array([1, 1, 1]), new Float32Array([1])], buckets: 1 });
  eq("不等长按最短", uneven.samples, 1);

  eq("空 channels → ok:false", W.buildPeaks({ channels: [] }).ok, false);
  eq("空 channels 错误码", W.buildPeaks({ channels: [] }).issues[0].code, "WAVE_CHANNELS_MISSING");
  eq("零长采样 → ok:false", W.buildPeaks({ channels: [new Float32Array(0)] }).ok, false);
  eq("零长错误码", W.buildPeaks({ channels: [new Float32Array(0)] }).issues[0].code, "WAVE_EMPTY");

  /* 桶数超过采样数时按采样数封顶 */
  var cap = W.buildPeaks({ channels: [new Float32Array(4)], buckets: 100 });
  ok("桶数不超过采样数", cap.buckets <= 4, String(cap.buckets));

  /* 桶数上限 */
  var big = W.buildPeaks({ channels: [new Float32Array(20000)], buckets: 99999 });
  ok("桶数不超过 MAX_BUCKETS", big.buckets <= W.MAX_BUCKETS, String(big.buckets));

  /* NaN 采样被跳过而不是污染极值 */
  var withNaN = W.buildPeaks({ channels: [new Float32Array([0.5, NaN, -0.5])], buckets: 1 });
  deepEq("NaN 被跳过", withNaN.peaks[0], { min: -0.5, max: 0.5 });

  /* ================================================================== *
   * 2. 归一化
   * ================================================================== */
  section("归一化：按全局峰值缩放，静音不放大");

  var nz = W.normalizePeaks([{ min: -2, max: 1 }, { min: -0.5, max: 0.5 }]);
  near("gain = 1/2", nz.gain, 0.5, 1e-9);
  near("min 缩放到 -1", nz.peaks[0].min, -1, 1e-9);
  near("max 缩放到 0.5", nz.peaks[0].max, 0.5, 1e-9);
  eq("不是静音", nz.silent, false);

  var sil = W.normalizePeaks([{ min: 0, max: 0 }, { min: 0, max: 0 }]);
  eq("全零判为静音", sil.silent, true);
  eq("静音 gain = 1（不放大噪声）", sil.gain, 1);
  deepEq("静音原样返回", sil.peaks[0], { min: 0, max: 0 });

  eq("空数组 ok", W.normalizePeaks([]).ok, true);
  eq("非数组不抛错", W.normalizePeaks(null).ok, true);

  /* ================================================================== *
   * 3. 重采样
   * ================================================================== */
  section("重采样：聚合保留极值，不插值伪造细节");

  var src = [{ min: 0, max: 0.5 }, { min: -0.5, max: 1 }, { min: -1, max: 0.25 }];
  var up = W.resamplePeaks(src, 6);
  eq("放大到 6 桶", up.peaks.length, 6);
  deepEq("放大后桶 0 沿用原桶 0", up.peaks[0], src[0]);
  deepEq("放大后桶 2 沿用原桶 1", up.peaks[2], src[1]);

  var down = W.resamplePeaks(src, 1);
  eq("缩到 1 桶", down.peaks.length, 1);
  deepEq("缩小聚合全局极值", down.peaks[0], { min: -1, max: 1 });

  eq("同宽原样返回", W.resamplePeaks(src, 3).peaks.length, 3);
  eq("width=0 → 空", W.resamplePeaks(src, 0).peaks.length, 0);
  eq("空源 → 空", W.resamplePeaks([], 10).peaks.length, 0);

  /* ================================================================== *
   * 4. 时间换算
   * ================================================================== */
  section("时间换算：与帧视图同源");

  eq("timeToX 1.5s @100px/s = 150", W.timeToX({ sec: 1.5, pxPerSec: 100 }), 150);
  near("xToTime 150 = 1.5s", W.xToTime({ x: 150, pxPerSec: 100 }), 1.5, 1e-9);
  eq("滚动 1s 后 timeToX(2s) = 100", W.timeToX({ sec: 2, pxPerSec: 100, scrollSec: 1 }), 100);
  near("往返一致", W.xToTime({ x: W.timeToX({ sec: 2.25, pxPerSec: 80 }), pxPerSec: 80 }), 2.25, 1e-6);
  eq("pxPerSec 非法回落 100", W.timeToX({ sec: 1, pxPerSec: 0 }), 100);
  eq("负时间可算出负 x", W.timeToX({ sec: -1, pxPerSec: 100 }), -100);

  /* ================================================================== *
   * 5. 时长与摘要
   * ================================================================== */
  section("时长与摘要");

  near("按采样/采样率算时长", W.durationOf({ samples: 44100, sampleRate: 44100 }), 1, 1e-9);
  near("显式 duration 优先", W.durationOf({ duration: 3.5, samples: 44100, sampleRate: 44100 }), 3.5, 1e-9);
  eq("缺数据 → 0", W.durationOf({}), 0);
  eq("采样率 0 → 0（不除零）", W.durationOf({ samples: 100, sampleRate: 0 }), 0);

  eq("空摘要", W.summaryLine({}), "没有音频波形");
  ok("摘要含秒", /3\.50s/.test(W.summaryLine({ duration: 3.5 })));
  ok("摘要含桶数", /800 桶/.test(W.summaryLine({ duration: 3.5, buckets: 800 })));
  ok("静音标注", /静音/.test(W.summaryLine({ duration: 1, silent: true })));

  result.finishedAt = new Date().toISOString();
  result.notes.push({ name: "覆盖面", detail: "峰值包络/归一化/重采样/时间换算/时长/摘要 共 " + result.total + " 条断言" });
  global.__selftestAudioWaveResult = result;
  if (typeof window !== "undefined") window.__selftestAudioWaveResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
