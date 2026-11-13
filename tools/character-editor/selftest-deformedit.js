/*
 * selftest-deformedit.js —— deform-edit.js 的纯函数自检（Node / 浏览器共用）
 * 依赖：deform-edit.js（globalThis.SpineDeformEdit）
 * 输出：globalThis.__selftestDeformEditResult = {passed, failed, total, skipped, cases, failures, notes}
 * 覆盖：布局判定（普通/加权/奇数长度）/ 顶点表解析 / 越界与类型校验 /
 *       单点与批量写入参数 / 「部分应用」必须整体拒绝 / 摘要文本。
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

  var D = global.SpineDeformEdit;
  if (!D) {
    result.total++; result.failed++;
    result.failures.push({ case: "(load)", name: "SpineDeformEdit 未加载", expected: "object", actual: typeof D, detail: "" });
    global.__selftestDeformEditResult = result;
    if (typeof window !== "undefined") window.__selftestDeformEditResult = result;
    return;
  }

  /* ================================================================== *
   * 1. 布局判定（最关键：加权网格不是坐标）
   * ================================================================== */
  section("布局：普通网格 / 加权网格 / 奇数长度");

  var xy = D.layoutOf({ weighted: false, vertices: [1, 2, 3, 4] });
  eq("普通网格 layout=xy", xy.layout, "xy");
  eq("普通网格 4 个数 = 2 顶点", xy.vertexCount, 2);
  eq("普通网格 stride=2", xy.stride, 2);

  var wt = D.layoutOf({ weighted: true, vertices: [1, 0, 1, 1, 0.5] });
  eq("加权网格 layout=weighted", wt.layout, "weighted");
  eq("加权网格 vertexCount=0（不当作坐标）", wt.vertexCount, 0);
  eq("加权网格本身不算错误", wt.ok, true);

  var odd = D.layoutOf({ weighted: false, vertices: [1, 2, 3] });
  eq("奇数长度 → ok:false", odd.ok, false);
  eq("奇数长度错误码", odd.issues[0].code, "DEFORM_VERTICES_ODD");

  var noVerts = D.layoutOf({ weighted: false });
  eq("缺 vertices → ok:false", noVerts.ok, false);
  eq("缺 vertices 错误码", noVerts.issues[0].code, "DEFORM_VERTICES_MISSING");

  eq("空数组 = 0 顶点", D.layoutOf({ weighted: false, vertices: [] }).vertexCount, 0);
  eq("空数组仍算 xy", D.layoutOf({ weighted: false, vertices: [] }).layout, "xy");

  /* ================================================================== *
   * 2. 顶点表解析
   * ================================================================== */
  section("解析：扁平数组 → 顶点表");

  var p = D.parseVertices({ weighted: false, vertices: [1, 2, 3, 4, 5, 6] });
  eq("解析 ok", p.ok, true);
  eq("顶点数 3", p.count, 3);
  deepEq("顶点 0", p.vertices[0], { index: 0, x: 1, y: 2 });
  deepEq("顶点 1", p.vertices[1], { index: 1, x: 3, y: 4 });
  deepEq("顶点 2", p.vertices[2], { index: 2, x: 5, y: 6 });
  near("坐标保留 4 位小数", D.parseVertices({ weighted: false, vertices: [1.23456789, 0] }).vertices[0].x, 1.2346, 1e-6);

  var pw = D.parseVertices({ weighted: true, vertices: [1, 0, 1] });
  eq("加权网格解析失败", pw.ok, false);
  eq("加权网格错误码", pw.issues[0].code, "DEFORM_WEIGHTED_NOT_COORDS");
  ok("加权网格错误说明提到「权重」", /权重/.test(pw.issues[0].message));

  var bad = D.parseVertices({ weighted: false, vertices: [1, 2, NaN, 4] });
  eq("非有限数 → ok:false", bad.ok, false);
  eq("非有限数错误码", bad.issues[0].code, "DEFORM_VERTEX_NOT_NUMBER");

  /* ================================================================== *
   * 3. 单点编辑校验
   * ================================================================== */
  section("校验：下标 / 类型 / 加权只读");

  eq("正常编辑允许", D.checkVertexEdit({ layout: "xy", vertexCount: 5, index: 2, x: 1, y: 2 }).ok, true);
  eq("加权网格拒绝", D.checkVertexEdit({ layout: "weighted", vertexCount: 5, index: 0, x: 1, y: 2 }).ok, false);
  eq("加权网格错误码", D.checkVertexEdit({ layout: "weighted", vertexCount: 5, index: 0, x: 1, y: 2 }).issues[0].code, "DEFORM_WEIGHTED_READONLY");
  eq("未知布局拒绝", D.checkVertexEdit({ layout: "unknown", vertexCount: 5, index: 0, x: 1, y: 2 }).ok, false);

  eq("负下标拒绝", D.checkVertexEdit({ layout: "xy", vertexCount: 5, index: -1, x: 0, y: 0 }).ok, false);
  eq("负下标错误码", D.checkVertexEdit({ layout: "xy", vertexCount: 5, index: -1, x: 0, y: 0 }).issues[0].code, "DEFORM_INDEX_INVALID");
  eq("小数下标拒绝", D.checkVertexEdit({ layout: "xy", vertexCount: 5, index: 1.5, x: 0, y: 0 }).ok, false);
  eq("越界拒绝", D.checkVertexEdit({ layout: "xy", vertexCount: 3, index: 3, x: 0, y: 0 }).ok, false);
  eq("越界错误码", D.checkVertexEdit({ layout: "xy", vertexCount: 3, index: 3, x: 0, y: 0 }).issues[0].code, "DEFORM_INDEX_RANGE");
  eq("边界内最后一个允许", D.checkVertexEdit({ layout: "xy", vertexCount: 3, index: 2, x: 0, y: 0 }).ok, true);

  /* offsetLength 优先于 vertexCount（真实网格容量） */
  eq("offsetLength 优先：6 → 3 顶点", D.checkVertexEdit({ layout: "xy", vertexCount: 99, offsetLength: 6, index: 2, x: 0, y: 0 }).ok, true);
  eq("offsetLength 优先：6 → 下标 3 越界", D.checkVertexEdit({ layout: "xy", vertexCount: 99, offsetLength: 6, index: 3, x: 0, y: 0 }).ok, false);

  eq("x 非数拒绝", D.checkVertexEdit({ layout: "xy", vertexCount: 5, index: 0, x: NaN, y: 0 }).ok, false);
  eq("y 非数拒绝", D.checkVertexEdit({ layout: "xy", vertexCount: 5, index: 0, x: 0, y: Infinity }).ok, false);
  eq("值错误码", D.checkVertexEdit({ layout: "xy", vertexCount: 5, index: 0, x: NaN, y: 0 }).issues[0].code, "DEFORM_VALUE_INVALID");

  /* ================================================================== *
   * 4. 写入参数
   * ================================================================== */
  section("参数：单点与批量");

  var a = D.buildSetVertexArgs({ slot: "s2", attachment: "m1", time: 0.5, index: 1, x: 2, y: 3 });
  eq("单点 ok", a.ok, true);
  eq("单点 slot", a.opts.slot, "s2");
  eq("单点 attachment", a.opts.attachment, "m1");
  near("单点 time", a.opts.time, 0.5, 1e-9);
  eq("单点 index", a.opts.index, 1);
  near("单点 x", a.opts.x, 2, 1e-9);
  eq("单点默认 create=true", a.opts.create, true);

  var legacy = D.buildSetVertexArgs({ slot: "s2", attachment: "m1", legacy: true, time: 0, index: 0, x: 0, y: 0 });
  eq("旧式 deform：attachment 置 null", legacy.opts.attachment, null);
  eq("旧式 deform：legacy=true", legacy.opts.legacy, true);

  eq("缺 slot → ok:false", D.buildSetVertexArgs({ time: 0, index: 0, x: 0, y: 0 }).ok, false);
  eq("缺 slot 错误码", D.buildSetVertexArgs({ time: 0, index: 0, x: 0, y: 0 }).issues[0].code, "DEFORM_SLOT_MISSING");
  eq("负时间 → ok:false", D.buildSetVertexArgs({ slot: "s", time: -1, index: 0, x: 0, y: 0 }).ok, false);
  eq("create=false 透传", D.buildSetVertexArgs({ slot: "s", time: 0, index: 0, x: 0, y: 0, create: false }).opts.create, false);

  var batch = D.buildBatchVertexArgs({
    layout: "xy", vertexCount: 4, slot: "s2", attachment: "m1", time: 1,
    edits: [{ index: 0, x: 1, y: 1 }, { index: 3, x: 4, y: 4 }],
  });
  eq("批量 ok", batch.ok, true);
  eq("批量产出 2 组参数", batch.args.length, 2);
  eq("批量第 1 组 index", batch.args[1].index, 3);

  /* 关键：只要有一个编辑非法，整批拒绝（不允许部分应用） */
  var batchBad = D.buildBatchVertexArgs({
    layout: "xy", vertexCount: 2, slot: "s2", attachment: "m1", time: 1,
    edits: [{ index: 0, x: 1, y: 1 }, { index: 99, x: 4, y: 4 }],
  });
  eq("批量有越界 → 整批拒绝", batchBad.ok, false);
  eq("整批拒绝时不产出任何参数", batchBad.args.length, 0);
  ok("整批拒绝给出可读原因", batchBad.issues.length > 0 && /越界/.test(batchBad.issues[0].message));

  eq("空 edits → ok:false", D.buildBatchVertexArgs({ layout: "xy", vertexCount: 4, slot: "s", time: 0, edits: [] }).ok, false);
  eq("空 edits 错误码", D.buildBatchVertexArgs({ layout: "xy", vertexCount: 4, slot: "s", time: 0, edits: [] }).issues[0].code, "DEFORM_EDITS_EMPTY");
  eq("加权网格批量拒绝", D.buildBatchVertexArgs({ layout: "weighted", vertexCount: 4, slot: "s", time: 0, edits: [{ index: 0, x: 1, y: 1 }] }).ok, false);

  /* ================================================================== *
   * 5. 摘要
   * ================================================================== */
  section("摘要：状态栏文本");

  ok("加权网格摘要说明只读", /只读/.test(D.summaryLine({ layout: "weighted" })));
  ok("普通网格摘要含顶点数", /4 个顶点/.test(D.summaryLine({ layout: "xy", vertexCount: 4 })));
  ok("有改动时摘要含改动数", /改 2 个/.test(D.summaryLine({ layout: "xy", vertexCount: 4, changedCount: 2 })));
  ok("未知布局摘要可读", /未知/.test(D.summaryLine({ layout: "unknown" })));

  result.finishedAt = new Date().toISOString();
  result.notes.push({ name: "覆盖面", detail: "布局/解析/校验/参数/批量原子性/摘要 共 " + result.total + " 条断言" });
  global.__selftestDeformEditResult = result;
  if (typeof window !== "undefined") window.__selftestDeformEditResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
