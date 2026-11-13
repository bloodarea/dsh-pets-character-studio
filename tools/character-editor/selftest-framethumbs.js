/*
 * selftest-framethumbs.js —— frame-thumbs.js 的纯函数自检（Node / 浏览器共用）
 * 依赖：frame-thumbs.js（globalThis.SpineFrameThumbs）
 * 输出：globalThis.__selftestFrameThumbsResult = {passed, failed, total, skipped, cases, failures, notes}
 * 覆盖：抽稀策略（含末帧对齐/上限/显式 step）/ 缓存键 / 尺寸夹取 / 布局换算 / 可见性 / 摘要。
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

  var T = global.SpineFrameThumbs;
  if (!T) {
    result.total++; result.failed++;
    result.failures.push({ case: "(load)", name: "SpineFrameThumbs 未加载", expected: "object", actual: typeof T, detail: "" });
    global.__selftestFrameThumbsResult = result;
    if (typeof window !== "undefined") window.__selftestFrameThumbsResult = result;
    return;
  }

  /* ================================================================== *
   * 1. 抽稀
   * ================================================================== */
  section("抽稀：帧数少时全画，多时抽稀且末帧对齐");

  var p10 = T.planFrames({ fromFrame: 0, toFrame: 9 });
  eq("10 帧 → 10 张", p10.frames.length, 10);
  eq("10 帧 step=1", p10.step, 1);
  eq("10 帧首帧", p10.frames[0], 0);
  eq("10 帧末帧", p10.frames[9], 9);

  var p105 = T.planFrames({ fromFrame: 0, toFrame: 104 });
  ok("105 帧被抽稀（少于 105）", p105.frames.length < 105, String(p105.frames.length));
  ok("105 帧不超过上限", p105.frames.length <= T.MAX_THUMBS, String(p105.frames.length));
  eq("抽稀首帧仍为 0", p105.frames[0], 0);
  eq("抽稀末帧对齐到 104（视觉终点锚）", p105.frames[p105.frames.length - 1], 104);
  ok("step 大于 1", p105.step > 1, String(p105.step));

  var pStep = T.planFrames({ fromFrame: 0, toFrame: 104, step: 15 });
  deepEq("显式 step=15 生效（含末帧对齐）", pStep.frames, [0, 15, 30, 45, 60, 75, 90, 104]);
  eq("显式 step 回报正确", pStep.step, 15);

  var pRev = T.planFrames({ fromFrame: 104, toFrame: 0 });
  eq("反向范围自动归正（首帧 0）", pRev.frames[0], 0);
  eq("反向范围自动归正（末帧 104）", pRev.frames[pRev.frames.length - 1], 104);

  var pOne = T.planFrames({ fromFrame: 7, toFrame: 7 });
  eq("单帧 → 1 张", pOne.frames.length, 1);
  eq("单帧值正确", pOne.frames[0], 7);

  var pNeg = T.planFrames({ fromFrame: -1, toFrame: 10 });
  eq("负帧号 → ok:false", pNeg.ok, false);
  eq("负帧号错误码", pNeg.issues[0].code, "THUMB_FRAME_NEGATIVE");

  var pMax = T.planFrames({ fromFrame: 0, toFrame: 1000, maxCount: 10 });
  ok("maxCount=10 生效", pMax.frames.length <= 10, String(pMax.frames.length));
  eq("maxCount 时末帧仍对齐", pMax.frames[pMax.frames.length - 1], 1000);

  /* 变异测试发现的盲区：上面的用例走不到「硬截断」那行（step 取整已保证不超限），
     所以那行是死代码、断言是假守卫。这里**显式喂一个极小的 step 配大范围**，
     让循环真的产出超过 maxCount 的帧数，才能覆盖截断逻辑。 */
  var pTight = T.planFrames({ fromFrame: 0, toFrame: 100, step: 1, maxCount: 5 });
  eq("显式 step=1 + maxCount=5 时被硬截断到 5", pTight.frames.length, 5);
  eq("硬截断后 truncated 为 true", pTight.truncated, true);
  ok("硬截断后仍不超过 maxCount", pTight.frames.length <= 5, String(pTight.frames.length));
  eq("硬截断保留首帧", pTight.frames[0], 0);

  /* ================================================================== *
   * 2. 缓存键
   * ================================================================== */
  section("缓存键：动画+帧+模型签名+尺寸");

  eq("键格式", T.cacheKey({ anim: "idle", frame: 30, modelSignature: "abc", size: 44 }), "idle|30|abc|44");
  ok("不同帧 → 不同键", T.cacheKey({ anim: "idle", frame: 30 }) !== T.cacheKey({ anim: "idle", frame: 31 }));
  ok("不同动画 → 不同键", T.cacheKey({ anim: "idle", frame: 30 }) !== T.cacheKey({ anim: "blink", frame: 30 }));
  ok("不同模型签名 → 不同键（换包必须重画）", T.cacheKey({ anim: "idle", frame: 30, modelSignature: "a" }) !== T.cacheKey({ anim: "idle", frame: 30, modelSignature: "b" }));
  ok("不同尺寸 → 不同键", T.cacheKey({ anim: "idle", frame: 30, size: 44 }) !== T.cacheKey({ anim: "idle", frame: 30, size: 60 }));
  eq("缺字段不抛错", T.cacheKey({}), "|0||44");

  /* ================================================================== *
   * 3. 尺寸
   * ================================================================== */
  section("尺寸：夹取到 [MIN, MAX]");

  eq("默认 44", T.clampSize(undefined), 44);
  eq("非数回落默认", T.clampSize(NaN), 44);
  eq("过小夹到下限", T.clampSize(1), T.MIN_SIZE);
  eq("过大夹到上限", T.clampSize(9999), T.MAX_SIZE);
  eq("区间内原样", T.clampSize(60), 60);
  eq("小数取整", T.clampSize(44.6), 45);

  /* ================================================================== *
   * 4. 布局
   * ================================================================== */
  section("布局：与帧视图同源换算");

  var lay = T.layout({ frames: [0, 30, 60], fps: 30, pxPerSec: 100, scrollSec: 0, size: 44, width: 800 });
  eq("三项", lay.items.length, 3);
  eq("帧 0 的 x", lay.items[0].x, 0);
  eq("帧 30 的 x（1 秒 × 100px）", lay.items[1].x, 100);
  eq("帧 60 的 x（2 秒 × 100px）", lay.items[2].x, 200);
  eq("尺寸透传", lay.items[0].size, 44);

  var layScroll = T.layout({ frames: [30], fps: 30, pxPerSec: 100, scrollSec: 0.5, size: 44, width: 800 });
  eq("滚动 0.5s 后帧 30 的 x = 100-50", layScroll.items[0].x, 50);

  var layOff = T.layout({ frames: [0], fps: 30, pxPerSec: 100, scrollSec: 3, size: 44, width: 800 });
  eq("滚出左边界 → x 为负", layOff.items[0].x, -300);
  eq("滚出左边界 → visible=false", layOff.items[0].visible, false);

  var layFar = T.layout({ frames: [300], fps: 30, pxPerSec: 100, scrollSec: 0, size: 44, width: 800 });
  eq("超出右边界 → visible=false", layFar.items[0].visible, false);
  eq("超出右边界但 x 仍有值", layFar.items[0].x, 1000);

  eq("空帧列表 → 空 items", T.layout({ frames: [] }).items.length, 0);
  eq("fps 非法回落 30", T.layout({ frames: [30], pxPerSec: 100, fps: 0, size: 44 }).items[0].x, 100);
  eq("pxPerSec 非法回落 100", T.layout({ frames: [30], fps: 30, pxPerSec: 0, size: 44 }).items[0].x, 100);

  /* ================================================================== *
   * 5. 可见性
   * ================================================================== */
  section("可见性：边缘包含");

  eq("完全在左外", T.isVisible({ x: -50, size: 44 }, 800), false);
  eq("压左边界", T.isVisible({ x: -44, size: 44 }, 800), true);
  eq("压右边界", T.isVisible({ x: 800, size: 44 }, 800), true);
  eq("完全在右外", T.isVisible({ x: 801, size: 44 }, 800), false);
  eq("非对象 → false", T.isVisible(null, 800), false);

  /* ================================================================== *
   * 6. 摘要
   * ================================================================== */
  section("摘要");
  eq("空摘要", T.summaryLine({ count: 0 }), "没有帧缩略图");
  ok("含数量", /12 张缩略图/.test(T.summaryLine({ count: 12 })));
  ok("抽稀标注", /已抽稀/.test(T.summaryLine({ count: 12, truncated: true })));
  ok("含尺寸", /44px/.test(T.summaryLine({ count: 3, size: 44 })));

  result.finishedAt = new Date().toISOString();
  result.notes.push({ name: "覆盖面", detail: "抽稀/缓存键/尺寸/布局/可见性/摘要 共 " + result.total + " 条断言" });
  global.__selftestFrameThumbsResult = result;
  if (typeof window !== "undefined") window.__selftestFrameThumbsResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
