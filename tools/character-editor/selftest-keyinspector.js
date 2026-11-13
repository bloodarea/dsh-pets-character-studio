/*
 * selftest-keyinspector.js —— key-inspector.js 的纯函数自检（Node / 浏览器共用）
 * 依赖：key-inspector.js（globalThis.SpineKeyInspector）
 * 输出：globalThis.__selftestKeyInspectorResult = {passed, failed, total, skipped, cases, failures, notes}
 * 覆盖：值形状判定 / 视图模型（帧号/单位/只读原因）/ 六种输入解析（含失败原因）/
 *       写入准入（锁定、末键无出段、曲线段只读、超时长）/ 插值映射 / 一行描述。
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

  var K = global.SpineKeyInspector;
  if (!K) {
    result.total++; result.failed++;
    result.failures.push({ case: "(load)", name: "SpineKeyInspector 未加载", expected: "object", actual: typeof K, detail: "" });
    global.__selftestKeyInspectorResult = result;
    if (typeof window !== "undefined") window.__selftestKeyInspectorResult = result;
    return;
  }

  /* ================================================================== *
   * 1. 值形状与标签
   * ================================================================== */
  section("值形状：六类轨道字段");

  eq("bone.rotate → scalar", K.valueShape("bone", "rotate"), "scalar");
  eq("bone.translate → vec2", K.valueShape("bone", "translate"), "vec2");
  eq("bone.scale → vec2", K.valueShape("bone", "scale"), "vec2");
  eq("bone.shear → vec2", K.valueShape("bone", "shear"), "vec2");
  eq("bone 未知字段 → raw", K.valueShape("bone", "whatever"), "raw");
  eq("slot.attachment → attachment", K.valueShape("slot", "attachment"), "attachment");
  eq("slot.color → color", K.valueShape("slot", "color"), "color");
  eq("slot.twoColor → colorPair", K.valueShape("slot", "twoColor"), "colorPair");
  eq("event 轨 → raw（检查器不猜）", K.valueShape("event", "events"), "raw");

  eq("rotate 中文标签", K.fieldLabel("bone", "rotate"), "旋转");
  eq("attachment 中文标签", K.fieldLabel("slot", "attachment"), "附件");
  eq("rotate 单位是度", K.unitOf("bone", "rotate"), "°");
  eq("translate 单位是 px", K.unitOf("bone", "translate"), "px");
  eq("scale 单位是 ×", K.unitOf("bone", "scale"), "×");
  eq("attachment 无单位", K.unitOf("slot", "attachment"), "");

  /* ================================================================== *
   * 2. 视图模型
   * ================================================================== */
  section("视图：帧号 / 值文本 / 只读原因");

  var d1 = K.describe({ kind: "bone", owner: "head", field: "rotate", time: 0.5, value: 12.3456789, fps: 30 });
  eq("describe.ok", d1.ok, true);
  eq("帧号 0.5s@30fps = 15", d1.view.frame, 15);
  eq("值文本截到 4 位", d1.view.valueText, "12.3457");
  eq("curve 缺省 = linear", d1.view.curveType, "linear");
  eq("可编辑", d1.view.editable, true);
  eq("无只读原因", d1.view.readOnlyReason, null);

  var dVec = K.describe({ kind: "bone", owner: "hips", field: "translate", time: 0, value: { x: 1.23456, y: -2 }, fps: 30 });
  eq("vec2 值文本", dVec.view.valueText, "1.2346, -2");
  var dAtt = K.describe({ kind: "slot", owner: "s1", field: "attachment", time: 0, value: null, fps: 30 });
  eq("attachment null → 空文本", dAtt.view.valueText, "");
  eq("attachment 可编辑", dAtt.view.editable, true);
  var dCol = K.describe({ kind: "slot", owner: "s1", field: "color", time: 0, value: "FF000080", fps: 30 });
  eq("color 原样显示", dCol.view.valueText, "FF000080");
  var dPair = K.describe({ kind: "slot", owner: "s1", field: "twoColor", time: 0, value: { light: "FFFFFFFF", dark: "000000FF" }, fps: 30 });
  eq("twoColor 显示为「亮 / 暗」", dPair.view.valueText, "FFFFFFFF / 000000FF");

  eq("stepped 曲线识别", K.describe({ kind: "bone", owner: "b", field: "rotate", time: 0, value: 0, curve: "stepped", fps: 30 }).view.curveType, "stepped");
  eq("bezier 曲线识别", K.describe({ kind: "bone", owner: "b", field: "rotate", time: 0, value: 0, curve: [0.1, 0.2, 0.3, 0.4], fps: 30 }).view.curveType, "bezier");

  var dLocked = K.describe({ kind: "bone", owner: "b", field: "rotate", time: 0, value: 0, fps: 30, locked: true });
  eq("锁定 → 不可编辑", dLocked.view.editable, false);
  ok("锁定 → 有可读原因", typeof dLocked.view.readOnlyReason === "string" && dLocked.view.readOnlyReason.length > 0);
  var dRaw = K.describe({ kind: "event", owner: "events", field: "events", time: 0, value: {}, fps: 30 });
  eq("未知形状 → 不可编辑", dRaw.view.editable, false);
  ok("未知形状 → 原因提到「不猜」或「轨道属性面板」", /不猜|轨道属性面板/.test(dRaw.view.readOnlyReason || ""));

  eq("缺 kind → ok:false", K.describe({ owner: "b", field: "rotate", time: 0 }).ok, false);
  eq("时间非数 → ok:false", K.describe({ kind: "bone", owner: "b", field: "rotate", time: NaN }).ok, false);
  ok("错误码可读", K.describe({}).issues[0].code === "KEY_INSPECT_TARGET");

  /* ================================================================== *
   * 3. 文本 → 写入值（核心难点）
   * ================================================================== */
  section("解析：六种输入 → 正确 JSON 形状");

  var pScalar = K.parseValueInput({ shape: "scalar", text: " 12.5 " });
  eq("scalar.ok", pScalar.ok, true);
  deepEq("scalar → {value:number}", pScalar.values, { value: 12.5 });
  eq("scalar 空 → 失败", K.parseValueInput({ shape: "scalar", text: "  " }).ok, false);
  eq("scalar 非数 → 失败", K.parseValueInput({ shape: "scalar", text: "abc" }).ok, false);
  eq("scalar 失败码", K.parseValueInput({ shape: "scalar", text: "abc" }).issues[0].code, "VALUE_NOT_NUMBER");

  var pVec = K.parseValueInput({ shape: "vec2", text: "1, 2" });
  eq("vec2.ok", pVec.ok, true);
  deepEq("vec2 → {x,y}", pVec.values, { x: 1, y: 2 });
  deepEq("vec2 空格分隔也接受", K.parseValueInput({ shape: "vec2", text: "1 2" }).values, { x: 1, y: 2 });
  deepEq("vec2 中文逗号也接受", K.parseValueInput({ shape: "vec2", text: "1，2" }).values, { x: 1, y: 2 });
  deepEq("vec2 负数", K.parseValueInput({ shape: "vec2", text: "-1.5, -2.5" }).values, { x: -1.5, y: -2.5 });
  eq("vec2 只有一个数 → 失败", K.parseValueInput({ shape: "vec2", text: "1" }).ok, false);
  eq("vec2 三个数 → 失败（不猜取前两个）", K.parseValueInput({ shape: "vec2", text: "1 2 3" }).ok, false);
  eq("vec2 失败码", K.parseValueInput({ shape: "vec2", text: "1" }).issues[0].code, "VALUE_VEC2_ARITY");
  eq("vec2 非数 → 失败", K.parseValueInput({ shape: "vec2", text: "1, x" }).ok, false);

  deepEq("attachment 空串 → name:null（隐藏该槽）", K.parseValueInput({ shape: "attachment", text: "" }).values, { name: null });
  deepEq("attachment 名字原样", K.parseValueInput({ shape: "attachment", text: " hair-1 " }).values, { name: "hair-1" });

  var pCol = K.parseValueInput({ shape: "color", text: "ff0000" });
  eq("color.ok", pCol.ok, true);
  deepEq("color 6 位并转大写", pCol.values, { value: "FF0000" });
  deepEq("color 8 位", K.parseValueInput({ shape: "color", text: "#00ff0080" }).values, { value: "00FF0080" });
  eq("color 空 → 失败", K.parseValueInput({ shape: "color", text: "" }).ok, false);
  eq("color 5 位 → 失败", K.parseValueInput({ shape: "color", text: "ff000" }).ok, false);
  eq("color 失败码", K.parseValueInput({ shape: "color", text: "zzz" }).issues[0].code, "VALUE_NOT_HEX");
  eq("color 非十六进制字符 → 失败", K.parseValueInput({ shape: "color", text: "gggggg" }).ok, false);

  var pPair = K.parseValueInput({ shape: "colorPair", text: "ffffffff / 000000ff" });
  eq("colorPair.ok", pPair.ok, true);
  deepEq("colorPair → {light,dark} 大写", pPair.values, { light: "FFFFFFFF", dark: "000000FF" });
  eq("colorPair 缺一段 → 失败", K.parseValueInput({ shape: "colorPair", text: "FFFFFFFF" }).ok, false);
  eq("colorPair 失败码", K.parseValueInput({ shape: "colorPair", text: "FFFFFFFF" }).issues[0].code, "VALUE_PAIR_ARITY");
  eq("colorPair 某段非 hex → 失败", K.parseValueInput({ shape: "colorPair", text: "ZZZ / 000000" }).ok, false);

  eq("未知形状 → 失败", K.parseValueInput({ shape: "raw", text: "x" }).ok, false);
  eq("未知形状失败码", K.parseValueInput({ shape: "raw", text: "x" }).issues[0].code, "VALUE_SHAPE_UNKNOWN");

  /* ================================================================== *
   * 4. 写入准入
   * ================================================================== */
  section("准入：锁定 / 末键 / 曲线段 / 超时长");

  eq("正常改值允许", K.checkWrite({ op: "value" }).ok, true);
  eq("锁定拒绝", K.checkWrite({ op: "value", locked: true }).ok, false);
  eq("锁定错误码", K.checkWrite({ op: "value", locked: true }).issues[0].code, "KEY_WRITE_LOCKED");
  eq("末键改插值拒绝", K.checkWrite({ op: "interpolation", isLastKey: true }).ok, false);
  eq("末键错误码", K.checkWrite({ op: "interpolation", isLastKey: true }).issues[0].code, "KEY_LAST_NO_SEGMENT");
  eq("曲线段改插值拒绝", K.checkWrite({ op: "interpolation", curveType: "bezier" }).ok, false);
  eq("曲线段错误码", K.checkWrite({ op: "interpolation", curveType: "bezier" }).issues[0].code, "KEY_CURVE_SEGMENT_READONLY");
  eq("曲线段改值仍允许（只影响时间，不影响值）", K.checkWrite({ op: "value", curveType: "bezier" }).ok, true);
  eq("超时长改值拒绝", K.checkWrite({ op: "value", targetTime: 5, duration: 3.5 }).ok, false);
  eq("超时长错误码", K.checkWrite({ op: "value", targetTime: 5, duration: 3.5 }).issues[0].code, "KEY_WRITE_OVER_DURATION");
  eq("等于时长允许", K.checkWrite({ op: "value", targetTime: 3.5, duration: 3.5 }).ok, true);
  eq("linear 改插值允许", K.checkWrite({ op: "interpolation", curveType: "linear" }).ok, true);

  deepEq("segmentFor stepped", K.segmentFor("stepped"), { type: "stepped" });
  deepEq("segmentFor linear", K.segmentFor("linear"), { type: "linear" });
  deepEq("segmentFor bezier", K.segmentFor("bezier"), { type: "bezier" });
  eq("segmentFor 未知返回 null", K.segmentFor("nope"), null);

  /* ================================================================== *
   * 5. 一行描述
   * ================================================================== */
  section("描述：一行事实");

  var line = K.describeLine(d1.view);
  ok("描述含属性标签", /旋转/.test(line));
  ok("描述含骨名", /head/.test(line));
  ok("描述含帧号", /帧 15/.test(line));
  ok("描述含秒", /0\.5/.test(line));
  ok("描述含插值类型", /linear/.test(line));
  eq("空视图给占位", K.describeLine(null), "未选中关键帧");
  var emptyLine = K.describeLine(dAtt.view);
  ok("附件为空时描述给「（空）」", /（空）/.test(emptyLine));

  /* ================================================================== *
   * 6. §5.3 全身姿态：差异判定与规模估算
   * ================================================================== */
  section("全身姿态：needsFullPoseKey / estimateFullPose");

  var nNoKey = K.needsFullPoseKey({ field: "rotate", next: { value: 10 }, current: null });
  eq("没有既有 Key → 必须写", nNoKey.needed, true);
  ok("没有既有 Key 的原因可读", /没有既有 Key/.test(nNoKey.reason));

  var nSame = K.needsFullPoseKey({ field: "rotate", next: { value: 10 }, current: { value: 10 } });
  eq("旋转值相同 → 跳过", nSame.needed, false);
  var nDiff = K.needsFullPoseKey({ field: "rotate", next: { value: 10.5 }, current: { value: 10 } });
  eq("旋转值不同 → 写入", nDiff.needed, true);
  var nTiny = K.needsFullPoseKey({ field: "rotate", next: { value: 10.0000001 }, current: { value: 10 } });
  eq("旋转差异小于 eps → 跳过（不产生噪声 Key）", nTiny.needed, false);
  var nTinyLoose = K.needsFullPoseKey({ field: "rotate", next: { value: 10.0000001 }, current: { value: 10 }, eps: 0 });
  eq("eps=0 时同一差异变显著", nTinyLoose.needed, true);

  var vSame = K.needsFullPoseKey({ field: "translate", next: { x: 1, y: 2 }, current: { x: 1, y: 2 } });
  eq("vec2 相同 → 跳过", vSame.needed, false);
  var vX = K.needsFullPoseKey({ field: "translate", next: { x: 1.5, y: 2 }, current: { x: 1, y: 2 } });
  eq("vec2 仅 x 变 → 写入", vX.needed, true);
  var vY = K.needsFullPoseKey({ field: "scale", next: { x: 1, y: 2.5 }, current: { x: 1, y: 2 } });
  eq("vec2 仅 y 变 → 写入", vY.needed, true);

  eq("next 缺失 → ok:false", K.needsFullPoseKey({ field: "rotate", next: null, current: null }).ok, false);
  eq("旋转值非数 → ok:false", K.needsFullPoseKey({ field: "rotate", next: { value: NaN }, current: { value: 1 } }).ok, false);
  eq("vec2 分量非数 → ok:false", K.needsFullPoseKey({ field: "translate", next: { x: 1, y: NaN }, current: { x: 1, y: 1 } }).ok, false);

  var est = K.estimateFullPose({ boneCount: 43 });
  eq("估算骨数", est.bones, 43);
  eq("估算每骨属性数默认 3", est.fieldsPerBone, 3);
  eq("估算上限 = 43×3", est.maxKeys, 129);
  eq("自定义属性列表", K.estimateFullPose({ boneCount: 10, fields: ["rotate"] }).maxKeys, 10);
  eq("骨数非法时按 0", K.estimateFullPose({ boneCount: -5 }).maxKeys, 0);

  /* ================================================================== *
   * 7. §4.5 事件字段 → 控件类型（文本字段不能被当成数字）
   * ================================================================== */
  section("事件字段：controlForField / parseFieldInput");

  eq("string 字段用 text 控件", K.controlForField({ type: "string" }).control, "text");
  ok("string 字段的理由点明「不能按数字解析」", /不能按数字/.test(K.controlForField({ type: "string" }).reason));
  eq("number 字段用 number 控件", K.controlForField({ type: "number" }).control, "number");
  eq("bool 字段用 checkbox", K.controlForField({ type: "bool" }).control, "checkbox");
  eq("boolean 也认", K.controlForField({ type: "boolean" }).control, "checkbox");
  eq("有候选值时优先 select", K.controlForField({ type: "string" }, { enumNames: ["a", "b"] }).control, "select");
  eq("offsets 交给专用控件", K.controlForField({ type: "offsets" }).control, "unknown");
  eq("未知类型 ok:false", K.controlForField({ type: "weird" }).ok, false);
  eq("未知类型错误码", K.controlForField({ type: "weird" }).issues[0].code, "FIELD_TYPE_UNKNOWN");

  /* 关键：event.string 必须原样保留为文本 */
  var ps = K.parseFieldInput({ type: "string", text: "hello world" });
  eq("string 解析 ok", ps.ok, true);
  eq("string 原样保留（不转数字）", ps.value, "hello world");
  eq("string 空串 → null（显式清空）", K.parseFieldInput({ type: "string", text: "" }).value, null);
  eq("string 保留前后空格（不 trim）", K.parseFieldInput({ type: "string", text: " a " }).value, " a ");
  eq("string 纯数字也保持字符串", K.parseFieldInput({ type: "string", text: "123" }).value, "123");

  var pn = K.parseFieldInput({ type: "number", text: " 12.5 " });
  eq("number 解析 ok", pn.ok, true);
  eq("number 得到数字", pn.value, 12.5);
  eq("number 空串 → null", K.parseFieldInput({ type: "number", text: "" }).value, null);
  eq("number 非数 → ok:false", K.parseFieldInput({ type: "number", text: "abc" }).ok, false);
  eq("number 非数错误码", K.parseFieldInput({ type: "number", text: "abc" }).issues[0].code, "FIELD_NOT_NUMBER");

  eq("bool true", K.parseFieldInput({ type: "bool", text: "true" }).value, true);
  eq("bool 1 也算 true", K.parseFieldInput({ type: "bool", text: "1" }).value, true);
  eq("bool 其他为 false", K.parseFieldInput({ type: "bool", text: "no" }).value, false);
  eq("未知类型解析失败", K.parseFieldInput({ type: "weird", text: "x" }).ok, false);

  result.finishedAt = new Date().toISOString();
  result.notes.push({ name: "覆盖面", detail: "形状/视图/解析/准入/描述/全身姿态 共 " + result.total + " 条断言" });  global.__selftestKeyInspectorResult = result;
  if (typeof window !== "undefined") window.__selftestKeyInspectorResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
