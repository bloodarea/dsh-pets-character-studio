/*
 * selftest-posecompare.js —— pose-compare.js 的纯函数自检（Node / 浏览器共用）
 * 依赖：pose-compare.js（globalThis.SpinePoseCompare）；可选 spine-core.js（真实 rig 姿态）。
 * 输出：globalThis.__selftestPoseCompareResult = {passed, failed, total, skipped, cases, failures, notes}
 * 覆盖：角度归一化 / 世界矩阵角度 / 单骨 local 与 world 分层 / 父链带动 vs 子骨真变 /
 *       阈值与 eps 覆盖 / 排序与 top / 摘要文本 / diffTable 形状 / 真实 rig 姿态对照。
 */
(function (global) {
  "use strict";

  var result = {
    passed: 0, failed: 0, total: 0, skipped: 0,
    cases: {}, failures: [], notes: [],
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
    if (pass) { result.passed++; c.passed++; return true; }
    result.failed++; c.failed++;
    result.failures.push({ case: currentCase, name: name, expected: expected === undefined ? null : expected, actual: actual === undefined ? null : actual, detail: detail || "" });
    return false;
  }
  function ok(name, cond, detail) { return record(!!cond, name, "truthy", cond, detail); }
  function eq(name, actual, expected) { return record(actual === expected, name, expected, actual); }
  function near(name, actual, expected, tol) {
    var t = tol === undefined ? 1e-6 : tol;
    return record(typeof actual === "number" && isFinite(actual) && Math.abs(actual - expected) <= t, name, expected, actual, "tol=" + t);
  }
  function deepEq(name, actual, expected) {
    var a = JSON.stringify(actual), b = JSON.stringify(expected);
    return record(a === b, name, b, a);
  }
  function skip(name, detail) { result.skipped++; result.notes.push({ name: name, detail: detail || "" }); }
  function section(name) { currentCase = name; }

  var P = global.SpinePoseCompare;
  if (!P) {
    result.total++; result.failed++;
    result.failures.push({ case: "(load)", name: "SpinePoseCompare 未加载", expected: "object", actual: typeof P, detail: "" });
    global.__selftestPoseCompareResult = result;
    if (typeof window !== "undefined") window.__selftestPoseCompareResult = result;
    return;
  }

  function local(x, y, rotation, sx, sy, shx, shy) {
    return { x: x || 0, y: y || 0, rotation: rotation || 0, scaleX: sx == null ? 1 : sx, scaleY: sy == null ? 1 : sy, shearX: shx || 0, shearY: shy || 0 };
  }
  function world(a, b, c, d, tx, ty) {
    return { a: a, b: b, c: c, d: d, tx: tx, ty: ty };
  }

  /* ================================================================== *
   * 1. 角度与矩阵基础
   * ================================================================== */
  section("基础：角度归一化 / 世界矩阵角度 / 尺度");

  near("angleDelta 359→1 归一化到 2", P.angleDelta(1, 359), 2, 1e-9);
  near("angleDelta 1→359 归一化到 -2", P.angleDelta(359, 1), -2, 1e-9);
  near("angleDelta 0→180 = 180", P.angleDelta(180, 0), 180, 1e-9);
  near("angleDelta 0→-180 = 180（开区间取正）", Math.abs(P.angleDelta(-180, 0)), 180, 1e-9);
  near("angleDelta 同角为 0", P.angleDelta(45, 45), 0, 1e-12);
  ok("angleDelta 非数返回 NaN", isNaN(P.angleDelta(NaN, 0)));

  var w0 = world(1, 0, 0, 1, 10, 20);
  near("单位矩阵角度 0", P.worldAngle(w0), 0, 1e-9);
  var w90 = world(0, 1, -1, 0, 0, 0);
  near("90° 矩阵角度", P.worldAngle(w90), 90, 1e-9);
  var wS = P.worldScale(world(2, 0, 0, 3, 0, 0));
  near("worldScale sx", wS.sx, 2, 1e-9);
  near("worldScale sy", wS.sy, 3, 1e-9);
  ok("worldAngle 非对象返回 NaN", isNaN(P.worldAngle(null)));

  /* ================================================================== *
   * 2. 单骨比较：分层
   * ================================================================== */
  section("单骨：local 与 world 分层");

  var same = P.compareBone("b", local(0, 0, 0), local(0, 0, 0), w0, w0);
  eq("完全一致 → changed=false", same.changed, false);
  eq("完全一致 → localChanged=false", same.localChanged, false);
  eq("完全一致 → 字段数 7", same.fields.length, 7);
  ok("完全一致 → 无 significant 字段", same.fields.every(function (f) { return !f.significant; }));

  var rot = P.compareBone("b", local(0, 0, 10), local(0, 0, 40));
  eq("旋转变化 → changed", rot.changed, true);
  eq("旋转变化 → localChanged", rot.localChanged, true);
  eq("旋转变化 → maxField=rotation", rot.maxField, "rotation");
  near("旋转变化 → maxAbsDelta=30", rot.maxAbsDelta, 30, 1e-9);
  var rotField = rot.fields.filter(function (f) { return f.field === "rotation"; })[0];
  near("旋转字段 from", rotField.from, 10, 1e-9);
  near("旋转字段 to", rotField.to, 40, 1e-9);
  near("旋转字段 delta", rotField.delta, 30, 1e-9);
  eq("旋转字段中文标签", rotField.label, "旋转");

  var xy = P.compareBone("b", local(0, 0), local(5, 0));
  eq("仅 X 变化 → maxField=x", xy.maxField, "x");
  ok("仅 X 变化时 y 不显著", xy.fields.filter(function (f) { return f.field === "y"; })[0].significant === false);

  /* 关键边界：父骨转动 → 子骨 world 变了但 local 没变 */
  var childByParent = P.compareBone("child", local(0, 0, 0), local(0, 0, 0), world(1, 0, 0, 1, 100, 200), world(1, 0, 0, 1, 150, 260));
  eq("父链带动 → changed=true", childByParent.changed, true);
  eq("父链带动 → localChanged=false（子骨局部没变）", childByParent.localChanged, false);
  eq("父链带动 → worldChanged=true", childByParent.worldChanged, true);
  ok("父链带动 → local 字段全不显著", childByParent.fields.every(function (f) { return !f.significant; }));

  var badLocal = P.compareBone("b", null, local(0, 0));
  eq("local 非对象 → ok:false", badLocal.ok, false);
  ok("local 非对象 → 错误码可读", badLocal.issues.length > 0 && badLocal.issues[0].code === "POSE_LOCAL_INVALID");

  /* ================================================================== *
   * 3. 阈值与 eps 覆盖
   * ================================================================== */
  section("阈值：默认 eps 与调用方覆盖");

  var tiny = P.compareBone("b", local(0, 0, 0), local(0, 0, 0.0005));
  eq("0.0005° 低于默认阈值 → 不显著", tiny.fields.filter(function (f) { return f.field === "rotation"; })[0].significant, false);
  var tinyLoose = P.compareBone("b", local(0, 0, 0), local(0, 0, 0.0005), null, null, { eps: { rotation: 0.0001 } });
  eq("放宽 eps 后同一变化变显著", tinyLoose.fields.filter(function (f) { return f.field === "rotation"; })[0].significant, true);
  var big = P.compareBone("b", local(0, 0, 0), local(0, 0, 0.01));
  eq("0.01° 高于默认阈值 → 显著", big.fields.filter(function (f) { return f.field === "rotation"; })[0].significant, true);
  var strict = P.compareBone("b", local(0, 0, 0), local(0, 0, 0.01), null, null, { eps: { rotation: 1 } });
  eq("收紧 eps 后同一变化不显著", strict.fields.filter(function (f) { return f.field === "rotation"; })[0].significant, false);

  /* ================================================================== *
   * 4. 整帧比较
   * ================================================================== */
  section("整帧：排序 / 计数 / top / 摘要");

  var poseA = { local: [local(0, 0, 0), local(0, 0, 0), local(0, 0, 0)], world: [w0, w0, w0] };
  var poseB = { local: [local(0, 0, 0), local(0, 0, 45), local(2, 0, 0)], world: [w0, w0, w0] };
  var cmp = P.comparePose({ poseA: poseA, poseB: poseB, names: ["root", "head", "hand"] });
  eq("comparePose.ok", cmp.ok, true);
  eq("total=3", cmp.total, 3);
  eq("changedCount=2", cmp.changedCount, 2);
  eq("localChangedCount=2", cmp.localChangedCount, 2);
  eq("按变化量降序：第一个是 head（45°）", cmp.bones[0].name, "head");
  eq("第二个是 hand（2 单位）", cmp.bones[1].name, "hand");
  eq("未变化的 root 排最后", cmp.bones[2].name, "root");
  eq("top 只含变化项", cmp.top.length, 2);
  eq("top[0] 是 head", cmp.top[0].name, "head");
  var topN = P.comparePose({ poseA: poseA, poseB: poseB, names: ["root", "head", "hand"], topN: 1 });
  eq("topN 可限制", topN.top.length, 1);

  var cmpSame = P.comparePose({ poseA: poseA, poseB: poseA });
  eq("相同姿态 changedCount=0", cmpSame.changedCount, 0);
  eq("相同姿态摘要文本", P.summaryLine(cmpSame), "两帧姿态一致（3 根骨全部无显著变化）");
  ok("有变化时摘要优先报「局部变化」", /局部变化 2\/3/.test(P.summaryLine(cmp)));
  ok("摘要含最大变化骨名", /head/.test(P.summaryLine(cmp)));
  ok("摘要不含评价词（只描述事实）", !/好|坏|正确|错误/.test(P.summaryLine(cmp)));

  /* 关键：只有父链带动（local 全 0）时，摘要不能说「N 根骨有变化」而不区分 */
  var parentOnlyA = { local: [local(0, 0, 0), local(0, 0, 0)], world: [w0, world(1, 0, 0, 1, 0, 0)] };
  var parentOnlyB = { local: [local(0, 0, 0), local(0, 0, 0)], world: [w0, world(1, 0, 0, 1, 80, 120)] };
  var parentOnly = P.comparePose({ poseA: parentOnlyA, poseB: parentOnlyB, names: ["root", "child"] });
  eq("仅父链带动 localChangedCount=0", parentOnly.localChangedCount, 0);
  eq("仅父链带动 changedCount>0", parentOnly.changedCount > 0, true);
  var pSum = P.summaryLine(parentOnly);
  ok("仅父链带动时摘要明确说「无局部变化」", /无局部变化/.test(pSum));
  ok("仅父链带动时摘要点出「父链带动」", /父链带动/.test(pSum));
  ok("仅父链带动时摘要不谎称「局部变化」", !/局部变化 \d/.test(pSum));

  var noNames = P.comparePose({ poseA: poseA, poseB: poseB });
  eq("无名字时用 #index", noNames.bones[0].name.indexOf("#") === 0, true);
  eq("非对象姿态 → ok:false", P.comparePose({ poseA: null, poseB: poseA }).ok, false);
  var lenMis = P.comparePose({ poseA: { local: [local(0, 0)], world: [] }, poseB: poseA });
  ok("长度不一致给出告警", lenMis.issues.some(function (i) { return i.code === "POSE_LENGTH_MISMATCH"; }));
  eq("长度不一致仍按较短者比较", lenMis.total, 1);

  /* ================================================================== *
   * 5. diffTable
   * ================================================================== */
  section("diffTable：只列变化项");

  var table = P.diffTable(cmp);
  eq("diffTable 默认只含变化项", table.length, 2);
  eq("diffTable 首项是 head", table[0].name, "head");
  eq("head 有 local 标记", table[0].local, true);
  ok("head 的 cells 含 rotation", table[0].cells.rotation !== undefined);
  near("head cells.rotation.delta=45", table[0].cells.rotation.delta, 45, 1e-6);
  ok("head 文本含「旋转」", /旋转/.test(table[0].text));
  var tableAll = P.diffTable(cmp, { onlyChanged: false });
  eq("onlyChanged:false 时含全部骨", tableAll.length, 3);
  eq("未变化项文本给占位", tableAll[2].text, "（仅父链带动）");
  deepEq("diffTable 非结果对象返回空数组", P.diffTable(null), []);

  /* ================================================================== *
   * 6. 真实 rig（spine-core 求值）
   * ================================================================== */
  section("真实 rig：idle 0s vs 0.5s 姿态对照");
  var C = global.SpineCore;
  var nodeMods = null;
  if (typeof process !== "undefined" && process.versions && process.versions.node && typeof process.getBuiltinModule === "function") {
    try { nodeMods = { fs: process.getBuiltinModule("node:fs"), cwd: process.cwd() }; } catch (e) { nodeMods = null; }
  }
  var rawModel = null, atlasText = null;
  if (nodeMods) {
    try {
      rawModel = JSON.parse(nodeMods.fs.readFileSync(nodeMods.cwd + "/workspace/packs/deepseek/spine/model.json", "utf8").replace(/^\uFEFF/, ""));
      atlasText = nodeMods.fs.readFileSync(nodeMods.cwd + "/workspace/packs/deepseek/spine/model.atlas", "utf8");
    } catch (e) { rawModel = null; }
  }
  if (C && rawModel && atlasText) {
    var atlas = C.parseAtlas(atlasText);
    var parsed = C.parseModel(rawModel, atlas);
    if (parsed.ok) {
      var model = parsed.value;
      var names = model.bones.map(function (b) { return b.name; });
      var pA = C.evalPose(model, { animation: "idle", time: 0, skin: "default" });
      var pB = C.evalPose(model, { animation: "idle", time: 0.5, skin: "default" });
      var real = P.comparePose({ poseA: pA, poseB: pB, names: names });
      eq("真实 rig 对照 ok", real.ok, true);
      /* 骨数不要硬编码：真实 rig 会随制作进展增减骨骼（例如 0.9.233 给「嘴巴特效」
         加的 mouth_fx 子骨）。这里断言「对照结果覆盖了模型全部骨骼」，并要求规模合理。 */
      eq("骨数 = 模型骨数", real.total, model.bones.length);
      ok("骨数规模合理（>40）", model.bones.length > 40);
      ok("0s 与 0.5s 确有变化（>0 根骨）", real.changedCount > 0);
      ok("变化骨数少于总数（不是全动）", real.changedCount < real.total);
      ok("摘要可读且非空", P.summaryLine(real).length > 0);
      var realTable = P.diffTable(real);
      ok("diffTable 与 changedCount 一致", realTable.length === real.changedCount);
      /* head 在 idle 里是 y 位移变化（不是旋转）——这条断言锁住「字段粒度」而不是「骨粒度」 */
      var headRow = real.bones.filter(function (b) { return b.name === "head"; })[0];
      ok("head 出现在对照结果里", !!headRow);
      if (headRow) {
        var headY = headRow.fields.filter(function (f) { return f.field === "y"; })[0];
        ok("head 的变化落在 y 位移上（而非 rotation）", headY.significant === true && headRow.fields.filter(function (f) { return f.field === "rotation"; })[0].significant === false);
      }
      /* 父链带动：子骨 world 变而 local 不变的情况应当存在或至少不误报 */
      ok("存在「local 未变但 world 变了」的骨（父链带动）或全部 local 变化覆盖",
        real.bones.some(function (b) { return !b.localChanged && b.worldChanged; }) || real.localChangedCount === real.changedCount);
      result.notes.push({ name: "真实 rig 对照", detail: "idle 0s vs 0.5s：" + P.summaryLine(real) });
    } else {
      skip("真实 rig 姿态对照", "parseModel 失败：" + JSON.stringify(parsed.issues && parsed.issues[0]));
    }
  } else {
    skip("真实 rig 姿态对照", C ? "找不到 rig 文件（非 Node 或路径不同）" : "SpineCore 未加载");
  }

  result.finishedAt = new Date().toISOString();
  result.notes.push({ name: "覆盖面", detail: "角度/矩阵/单骨分层/阈值/整帧/摘要/表格/真实 rig 共 " + result.total + " 条断言" });
  global.__selftestPoseCompareResult = result;
  if (typeof window !== "undefined") window.__selftestPoseCompareResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
