/*
 * selftest-keymap.js —— keymap.js 纯函数自检（Node / 浏览器共用）
 * 依赖：keymap.js（globalThis.SpineKeymap）。
 * 输出：globalThis.__selftestKeymapResult = {passed, failed, total, skipped, cases, failures, notes}
 * 覆盖：注册表与默认表 · chord 规范化 · 保留键 · validateBindings/conflicts · 事件解析（IME/AltGraph/输入框）
 *       · resolveAction（scope + 能力门槛）· 序列化/解析/偏好净化（只合并 shortcuts）。
 */
(function (global) {
  "use strict";

  var result = { passed: 0, failed: 0, total: 0, skipped: 0, cases: {}, failures: [], notes: [], startedAt: new Date().toISOString() };
  var currentCase = "(global)";

  function record(pass, name, expected, actual, detail) {
    result.total++;
    var c = result.cases[currentCase] || (result.cases[currentCase] = { passed: 0, failed: 0 });
    if (pass) {
      result.passed++;
      c.passed++;
      return true;
    }
    result.failed++;
    c.failed++;
    result.failures.push({ case: currentCase, name: name, expected: expected === undefined ? null : expected, actual: actual === undefined ? null : actual, detail: detail || "" });
    return false;
  }
  function ok(name, cond, detail) {
    return record(!!cond, name, "truthy", cond, detail);
  }
  function eq(name, actual, expected) {
    return record(actual === expected, name, expected, actual);
  }
  function deepEq(name, actual, expected) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    return record(a === b, name, b, a);
  }
  function section(name) {
    currentCase = name;
  }

  var nodeMods = null;
  if (typeof process !== "undefined" && process.versions && process.versions.node && typeof process.getBuiltinModule === "function") {
    try {
      nodeMods = { fs: process.getBuiltinModule("node:fs"), module: process.getBuiltinModule("node:module"), cwd: process.cwd() };
    } catch (e) {
      nodeMods = null;
    }
  }
  var K = global.SpineKeymap;
  if (!K && nodeMods) {
    try {
      var req = nodeMods.module.createRequire(nodeMods.cwd.replace(/[\\/]+$/, "") + "/selftest-keymap-loader.js");
      req(nodeMods.cwd.replace(/[\\/]+$/, "") + "/tools/character-editor/keymap.js");
      K = global.SpineKeymap;
    } catch (e) {
      K = null;
    }
  }
  if (!K) {
    record(false, "keymap.js 已加载（globalThis.SpineKeymap）", "存在", null);
    global.__selftestKeymapResult = result;
    return;
  }

  /* ------------------------------------------------------------------ */
  section("keymap / 注册表与默认表");
  ok("ACTIONS 非空且冻结", Array.isArray(K.ACTIONS) && Object.isFrozen(K.ACTIONS));
  ok("动作数 ≥ 17", K.ACTIONS.length >= 17, "n=" + K.ACTIONS.length);
  var ids = K.ACTIONS.map(function (a) { return a.id; });
  eq("动作 id 唯一", ids.length, new Set(ids).size);
  ok("每个动作都有 label/scope/defaultKeys", K.ACTIONS.every(function (a) {
    return typeof a.label === "string" && a.label && typeof a.scope === "string" && Array.isArray(a.defaultKeys) && a.defaultKeys.length > 0;
  }));
  ok("scope 只允许 editor / timeline-graph", K.ACTIONS.every(function (a) { return K.MODULE_SCOPES.indexOf(a.scope) >= 0; }));
  eq("SETTINGS_KEY", K.SETTINGS_KEY, "dsh.character-editor.preferences");
  eq("SETTINGS_VERSION", K.SETTINGS_VERSION, 1);
  deepEq("默认 translate = KeyV", K.DEFAULT_BINDINGS.translate, ["KeyV"]);
  deepEq("默认 rotate/scale/pose/key", [K.DEFAULT_BINDINGS.rotate[0], K.DEFAULT_BINDINGS.scale[0], K.DEFAULT_BINDINGS.pose[0], K.DEFAULT_BINDINGS.key[0]], ["KeyR", "KeyS", "KeyW", "KeyK"]);
  deepEq("默认 delete = Delete + Backspace", K.DEFAULT_BINDINGS["delete"], ["Delete", "Backspace"]);
  deepEq("默认 undo/redo", [K.DEFAULT_BINDINGS.undo, K.DEFAULT_BINDINGS.redo], [["Mod+KeyZ"], ["Mod+Shift+KeyZ", "Mod+KeyY"]]);
  deepEq("默认 timeline/save/help", [K.DEFAULT_BINDINGS.timeline[0], K.DEFAULT_BINDINGS.save[0], K.DEFAULT_BINDINGS.help[0]], ["Tab", "Mod+KeyS", "Shift+Slash"]);
  deepEq("默认 timeline-graph 动作（copy/paste/selectAll）", [K.DEFAULT_BINDINGS.copy, K.DEFAULT_BINDINGS.paste, K.DEFAULT_BINDINGS.selectAll], [["Mod+KeyC"], ["Mod+KeyV"], ["Mod+KeyA"]]);
  deepEq("固定通道 pan/cancel", [K.DEFAULT_BINDINGS.pan, K.DEFAULT_BINDINGS.cancel], [["Space"], ["Escape"]]);
  ok("pan/cancel 标 reserved", K.isReservedAction("pan") === true && K.isReservedAction("cancel") === true && K.isReservedAction("save") === false);
  eq("scopeOf copy = timeline-graph", K.scopeOf("copy"), "timeline-graph");
  eq("scopeOf key = editor", K.scopeOf("key"), "editor");
  eq("labelOf translate", K.labelOf("translate"), "平移工具");
  eq("labelOf 未知 = null", K.labelOf("nope"), null);
  deepEq("requires: copy 需 Key 选择", K.requiresOf("copy"), { keySelection: true });
  deepEq("requires: paste 需剪贴板+动画", K.requiresOf("paste"), { clipboard: true, animation: true });
  deepEq("requires: selectAll 需可见可选轨", K.requiresOf("selectAll"), { selectableRows: true });
  eq("requires: delete 需 Key 选择", JSON.stringify(K.requiresOf("delete")), JSON.stringify({ keySelection: true }));
  eq("selectAll 不要求预选（无 keySelection 门槛）", K.requiresOf("selectAll").keySelection, undefined);
  var d1 = K.defaults();
  d1.translate = ["KeyQ"];
  deepEq("defaults() 返回副本，改它不影响表", K.DEFAULT_BINDINGS.translate, ["KeyV"]);
  deepEq("reset() = 默认表", K.reset().translate, ["KeyV"]);

  /* ------------------------------------------------------------------ */
  section("keymap / chord 规范化");
  eq("小写字母", K.normalizeChord("v"), "KeyV");
  eq("大写字母", K.normalizeChord("V"), "KeyV");
  eq("已是 code 形式", K.normalizeChord("KeyV"), "KeyV");
  eq("ctrl → Mod", K.normalizeChord("ctrl+z"), "Mod+KeyZ");
  eq("Cmd → Mod（macOS）", K.normalizeChord("Cmd+S"), "Mod+KeyS");
  eq("meta → Mod", K.normalizeChord("Meta+z"), "Mod+KeyZ");
  eq("⌘ → Mod", K.normalizeChord("⌘+K"), "Mod+KeyK");
  eq("修饰键顺序规范化", K.normalizeChord("shift+mod+z"), "Mod+Shift+KeyZ");
  eq("三修饰键排序", K.normalizeChord("alt+shift+Mod+KeyZ"), "Mod+Alt+Shift+KeyZ");
  eq("option → Alt", K.normalizeChord("option+KeyA"), "Alt+KeyA");
  eq("命名键 Delete", K.normalizeChord("Delete"), "Delete");
  eq("别名 del", K.normalizeChord("del"), "Delete");
  eq("别名 esc", K.normalizeChord("esc"), "Escape");
  eq("空格", K.normalizeChord("space"), "Space");
  eq("Tab", K.normalizeChord("tab"), "Tab");
  eq("斜杠", K.normalizeChord("/"), "Slash");
  eq("Slash 名", K.normalizeChord("Slash"), "Slash");
  eq("问号自带 Shift", K.normalizeChord("?"), "Shift+Slash");
  eq("数字 → DigitN", K.normalizeChord("1"), "Digit1");
  eq("F 键", K.normalizeChord("F5"), "F5");
  eq("方向键", K.normalizeChord("ArrowUp"), "ArrowUp");
  eq("幂等", K.normalizeChord(K.normalizeChord("shift+mod+z")), K.normalizeChord("shift+mod+z"));
  eq("空串非法", K.normalizeChord(""), null);
  eq("只有修饰键非法", K.normalizeChord("Mod"), null);
  eq("尾随 + 非法", K.normalizeChord("Mod+"), null);
  eq("未知键名非法", K.normalizeChord("Mod+NotAKey"), null);
  eq("两个非修饰键非法", K.normalizeChord("a+b"), null);
  eq("非字符串非法", K.normalizeChord(123), null);
  eq("displayChord 非 mac", K.displayChord("Mod+Shift+KeyZ"), "Ctrl+Shift+Z");
  eq("displayChord mac", K.displayChord("Mod+KeyZ", { mac: true }), "⌘+Z");
  eq("displayChord 单键", K.displayChord("KeyV"), "V");
  eq("displayChord 斜杠", K.displayChord("Shift+Slash"), "Shift+/");

  /* ------------------------------------------------------------------ */
  section("keymap / 保留键");
  ok("Space 固定通道", K.isReservedChord("Space") === true);
  ok("Escape 固定通道", K.isReservedChord("Escape") === true);
  ok("普通键不是固定通道", K.isReservedChord("KeyV") === false);
  ok("Mod+KeyW 浏览器保留", K.isBrowserReservedChord("Mod+KeyW") === true);
  ok("F5 浏览器保留", K.isBrowserReservedChord("F5") === true);
  ok("Mod+Digit1 浏览器保留", K.isBrowserReservedChord("Mod+Digit1") === true);
  ok("Mod+KeyS 允许（保存）", K.isBrowserReservedChord("Mod+KeyS") === false);
  ok("Shift+Slash 允许（帮助）", K.isBrowserReservedChord("Shift+Slash") === false);

  /* ------------------------------------------------------------------ */
  section("keymap / validateBindings 与 conflicts");
  var v0 = K.validateBindings(K.defaults());
  ok("默认表校验通过", v0.ok === true);
  eq("默认表无 error 级 issue", v0.issues.filter(function (i) { return i.severity === "error"; }).length, 0);
  deepEq("默认表无冲突", K.conflicts(K.defaults()), []);
  var vDup = K.validateBindings({ translate: ["KeyV"], rotate: ["KeyV"] });
  ok("同键两动作 → DUPLICATE_CHORD", vDup.ok === false && vDup.issues.some(function (i) { return i.code === "DUPLICATE_CHORD" && i.otherActionId === "translate" && i.actionId === "rotate"; }));
  var vUnknown = K.validateBindings({ nope: ["KeyQ"] });
  ok("未知动作 → UNKNOWN_ACTION", vUnknown.ok === false && vUnknown.issues.some(function (i) { return i.code === "UNKNOWN_ACTION"; }));
  var vIllegal = K.validateBindings({ translate: ["NotAKey"] });
  ok("非法键位 → ILLEGAL_CHORD", vIllegal.ok === false && vIllegal.issues.some(function (i) { return i.code === "ILLEGAL_CHORD"; }));
  var vReservedChord = K.validateBindings({ rotate: ["Space"] });
  ok("占用 Space → RESERVED_CHORD", vReservedChord.ok === false && vReservedChord.issues.some(function (i) { return i.code === "RESERVED_CHORD"; }));
  var vBrowser = K.validateBindings({ rotate: ["Mod+KeyW"] });
  ok("浏览器组合 → BROWSER_RESERVED", vBrowser.ok === false && vBrowser.issues.some(function (i) { return i.code === "BROWSER_RESERVED"; }));
  var vReservedAction = K.validateBindings({ pan: ["KeyP"] });
  ok("改绑固定通道 → RESERVED_ACTION", vReservedAction.ok === false && vReservedAction.issues.some(function (i) { return i.code === "RESERVED_ACTION"; }));
  var vKeepReserved = K.validateBindings({ pan: ["Space"], cancel: ["Escape"] });
  ok("固定通道保持原样不报错", vKeepReserved.ok === true);
  var vDisabled = K.validateBindings({ translate: [] });
  ok("空数组 = 禁用（info 级）", vDisabled.ok === true && vDisabled.issues.some(function (i) { return i.code === "DISABLED" && i.actionId === "translate" && i.severity === "info"; }));
  var vCross = K.validateBindings({ translate: ["Mod+KeyC"] });
  ok("editor 与 timeline-graph 重叠 → 冲突", vCross.ok === false && vCross.issues.some(function (i) { return i.code === "DUPLICATE_CHORD" && i.actionId === "copy" && i.otherActionId === "translate"; }));
  var cCross = K.conflicts({ translate: ["Mod+KeyC"] });
  eq("conflicts 返回 1 对", cCross.length, 1);
  deepEq("冲突对内容（按注册表顺序）", cCross[0].actions, ["translate", "copy"]);
  eq("conflicts 无冲突时为空（同动作多键不算）", K.conflicts({ redo: ["Mod+Shift+KeyZ", "Mod+KeyY"] }).length, 0);
  eq("同动作两个键不算冲突", K.conflicts(K.defaults()).length, 0);
  var cUndoRedo = K.conflicts({ undo: ["Mod+KeyZ"], redo: ["Mod+KeyZ"] });
  eq("undo/redo 抢键成对报出", cUndoRedo.length, 1);

  /* ------------------------------------------------------------------ */
  section("keymap / 事件 → chord");
  eq("code=KeyV", K.chordFromEvent({ code: "KeyV" }), "KeyV");
  eq("fallback 到 key", K.chordFromEvent({ key: "v" }), "KeyV");
  eq("ctrl", K.chordFromEvent({ code: "KeyZ", ctrlKey: true }), "Mod+KeyZ");
  eq("meta 归并 Mod", K.chordFromEvent({ code: "KeyZ", metaKey: true }), "Mod+KeyZ");
  eq("shift", K.chordFromEvent({ code: "KeyV", shiftKey: true }), "Shift+KeyV");
  eq("ctrl+shift", K.chordFromEvent({ code: "KeyZ", ctrlKey: true, shiftKey: true }), "Mod+Shift+KeyZ");
  eq("Space", K.chordFromEvent({ code: "Space" }), "Space");
  eq("Escape", K.chordFromEvent({ code: "Escape" }), "Escape");
  eq("问号（shift+/）", K.chordFromEvent({ code: "Slash", key: "?", shiftKey: true }), "Shift+Slash");
  eq("纯修饰键 → null", K.chordFromEvent({ code: "ShiftLeft" }), null);
  eq("isComposing → null", K.chordFromEvent({ code: "KeyA", isComposing: true }), null);
  eq("keyCode 229 → null", K.chordFromEvent({ code: "KeyA", keyCode: 229 }), null);
  eq("key='Process' → null", K.chordFromEvent({ code: "KeyA", key: "Process" }), null);
  eq("AltGraph modifier → null", K.chordFromEvent({ code: "KeyA", getModifierState: function (m) { return m === "AltGraph"; } }), null);
  eq("Ctrl+Alt 视为 AltGr → null", K.chordFromEvent({ code: "KeyA", ctrlKey: true, altKey: true }), null);
  eq("input 目标 → null", K.chordFromEvent({ code: "KeyA", target: { tagName: "INPUT" } }), null);
  eq("textarea 目标 → null", K.chordFromEvent({ code: "KeyA", target: { tagName: "TEXTAREA" } }), null);
  eq("select 目标 → null", K.chordFromEvent({ code: "KeyA", target: { tagName: "SELECT" } }), null);
  eq("contenteditable 自身 → null", K.chordFromEvent({ code: "KeyA", target: { tagName: "DIV", isContentEditable: true } }), null);
  eq("contenteditable 祖先 → null", K.chordFromEvent({ code: "KeyA", target: { tagName: "SPAN", parentElement: { tagName: "DIV", isContentEditable: true } } }), null);
  eq("普通 div 目标放行", K.chordFromEvent({ code: "KeyA", target: { tagName: "DIV" } }), "KeyA");
  eq("ctx.textInput → null", K.chordFromEvent({ code: "KeyA" }, { textInput: true }), null);
  eq("空事件 → null", K.chordFromEvent(null), null);
  eq("无 code 无 key → null", K.chordFromEvent({ ctrlKey: true }), null);
  eq("fromKeyboardEvent 是别名", K.fromKeyboardEvent, K.chordFromEvent);
  ok("isTextInputTarget 判定", K.isTextInputTarget({ tagName: "input" }) === true && K.isTextInputTarget({ tagName: "DIV" }) === false && K.isTextInputTarget(null) === false);

  /* ------------------------------------------------------------------ */
  section("keymap / resolveAction（scope + 能力门槛）");
  var M = K.defaults();
  eq("V → translate", K.resolveAction(M, { code: "KeyV" }, { scope: "editor" }), "translate");
  eq("R → rotate", K.resolveAction(M, { code: "KeyR" }, { scope: "editor" }), "rotate");
  eq("S → scale", K.resolveAction(M, { code: "KeyS" }, { scope: "editor" }), "scale");
  eq("W → pose", K.resolveAction(M, { code: "KeyW" }, { scope: "editor" }), "pose");
  eq("K → key", K.resolveAction(M, { code: "KeyK" }, { scope: "editor" }), "key");
  eq("P → play", K.resolveAction(M, { code: "KeyP" }, { scope: "editor" }), "play");
  eq("Mod+Z → undo", K.resolveAction(M, { code: "KeyZ", ctrlKey: true }, { scope: "editor" }), "undo");
  eq("Mod+Shift+Z → redo", K.resolveAction(M, { code: "KeyZ", ctrlKey: true, shiftKey: true }, { scope: "editor" }), "redo");
  eq("Mod+Y → redo", K.resolveAction(M, { code: "KeyY", metaKey: true }, { scope: "editor" }), "redo");
  eq("Tab → timeline", K.resolveAction(M, { code: "Tab" }, { scope: "editor" }), "timeline");
  eq("Mod+S → save", K.resolveAction(M, { code: "KeyS", ctrlKey: true }, { scope: "editor" }), "save");
  eq("Shift+/ → help", K.resolveAction(M, { code: "Slash", shiftKey: true }, { scope: "editor" }), "help");
  eq("Space → pan（固定通道）", K.resolveAction(M, { code: "Space" }, { scope: "editor" }), "pan");
  eq("Escape → cancel（固定通道）", K.resolveAction(M, { code: "Escape" }, { scope: "editor" }), "cancel");
  eq("画布(editor) 按 Delete 不劫持时间轴删除", K.resolveAction(M, { code: "Delete" }, { scope: "editor" }), null);
  eq("timeline + 有 Key 选择 → delete", K.resolveAction(M, { code: "Delete" }, { scope: "timeline", keySelection: true }), "delete");
  eq("timeline 无 Key 选择 → null", K.resolveAction(M, { code: "Delete" }, { scope: "timeline" }), null);
  eq("graph + Backspace + 有选择 → delete", K.resolveAction(M, { code: "Backspace" }, { scope: "graph", keySelection: true }), "delete");
  eq("画布(editor) 按 Mod+C 不劫持复制", K.resolveAction(M, { code: "KeyC", ctrlKey: true }, { scope: "editor" }), null);
  eq("timeline + 有选择 → copy", K.resolveAction(M, { code: "KeyC", ctrlKey: true }, { scope: "timeline", keySelection: true }), "copy");
  eq("timeline 无选择 → copy 被门槛拦下", K.resolveAction(M, { code: "KeyC", ctrlKey: true }, { scope: "timeline" }), null);
  eq("graph + 剪贴板 + 动画 → paste", K.resolveAction(M, { code: "KeyV", metaKey: true }, { scope: "graph", clipboard: true, animation: true }), "paste");
  eq("有剪贴板但无动画 → null", K.resolveAction(M, { code: "KeyV", ctrlKey: true }, { scope: "graph", clipboard: true }), null);
  eq("timeline + 可见可选轨 → selectAll", K.resolveAction(M, { code: "KeyA", ctrlKey: true }, { scope: "timeline", selectableRows: true }), "selectAll");
  eq("无可选轨 → selectAll 被拦下", K.resolveAction(M, { code: "KeyA", ctrlKey: true }, { scope: "timeline" }), null);
  eq("IME 事件不解析动作", K.resolveAction(M, { code: "KeyV", isComposing: true }, { scope: "editor" }), null);
  eq("输入框内不解析动作", K.resolveAction(M, { code: "KeyV", target: { tagName: "INPUT" } }, { scope: "editor" }), null);
  eq("禁用动作（空绑定）→ null", K.resolveAction({ translate: [] }, { code: "KeyV" }, { scope: "editor" }), null);
  eq("自定义绑定生效", K.resolveAction({ translate: ["KeyJ"] }, { code: "KeyJ" }, { scope: "editor" }), "translate");
  eq("actionForChord 同解析", K.actionForChord(M, "Shift+Slash", { scope: "editor" }), "help");
  eq("actionForChord 非法 chord → null", K.actionForChord(M, "NotAKey", { scope: "editor" }), null);

  /* ------------------------------------------------------------------ */
  section("keymap / 序列化与偏好净化");
  var ser = K.serialize(K.defaults());
  var parsedSer = JSON.parse(ser);
  eq("serialize 含 version", parsedSer.version, 1);
  deepEq("serialize 内含规范 chord", parsedSer.shortcuts.translate, ["KeyV"]);
  var pRound = K.parse(ser);
  ok("parse(serialize()) 往返 ok", pRound.ok === true && pRound.error === null);
  deepEq("往返后 translate", pRound.settings.shortcuts.translate, ["KeyV"]);
  var pBad = K.parse("{not json");
  ok("损坏 JSON 回退默认不抛异常", pBad.ok === false && pBad.error && pBad.error.indexOf("JSON_PARSE") === 0);
  deepEq("损坏 JSON 后仍是默认表", pBad.settings.shortcuts.translate, ["KeyV"]);
  var pEmpty = K.parse("");
  eq("空文本 → EMPTY_TEXT", pEmpty.error, "EMPTY_TEXT");
  var sNull = K.sanitizeShortcuts(null);
  ok("shortcuts 非对象 → 回退 + repaired", sNull.repaired === true && JSON.stringify(sNull.shortcuts) === JSON.stringify(K.defaults()));
  var sIllegal = K.sanitizeShortcuts({ rotate: ["NotAKey"] });
  deepEq("非法键位保留默认", sIllegal.shortcuts.rotate, ["KeyR"]);
  ok("非法键位给出 ILLEGAL_CHORD", sIllegal.issues.some(function (i) { return i.code === "ILLEGAL_CHORD"; }));
  var sUnknown = K.sanitizeShortcuts({ nope: ["KeyQ"] });
  ok("未知动作被忽略并提示", sUnknown.issues.some(function (i) { return i.code === "UNKNOWN_ACTION"; }) && sUnknown.shortcuts.nope === undefined);
  var sDisabled = K.sanitizeShortcuts({ translate: [] });
  deepEq("空数组 = 显式禁用（保留）", sDisabled.shortcuts.translate, []);
  var sReserved = K.sanitizeShortcuts({ rotate: ["Space"] });
  deepEq("占用 Space 被拒并保留默认", sReserved.shortcuts.rotate, ["KeyR"]);
  var sBrowser = K.sanitizeShortcuts({ rotate: ["Mod+KeyW"] });
  deepEq("浏览器组合被拒并保留默认", sBrowser.shortcuts.rotate, ["KeyR"]);
  var sGood = K.sanitizeShortcuts({ undo: ["Mod+KeyU"] });
  deepEq("合法自定义生效", sGood.shortcuts.undo, ["Mod+KeyU"]);
  eq("合法自定义不修复", sGood.repaired, false);
  var sConflict = K.sanitizeShortcuts({ undo: ["Mod+KeyZ"], redo: ["Mod+KeyZ"] });
  ok("合并后冲突 → 整体回退默认", sConflict.repaired === true && JSON.stringify(sConflict.shortcuts.undo) === JSON.stringify(["Mod+KeyZ"]) && JSON.stringify(sConflict.shortcuts.redo) === JSON.stringify(["Mod+Shift+KeyZ", "Mod+KeyY"]));
  ok("合并后冲突有 CONFLICT_AFTER_MERGE", sConflict.issues.some(function (i) { return i.code === "CONFLICT_AFTER_MERGE"; }));
  var layoutIn = { expanded: true, height: 300, pxPerSec: 120 };
  var modelsIn = { sig1: { collapsed: ["bone:a"], search: "hip", onlyKeyed: true, lockedRows: ["bone:b"], hiddenRows: [] } };
  var st = K.sanitizeSettings({ version: 1, layout: layoutIn, models: modelsIn, shortcuts: { key: ["KeyQ"] } });
  deepEq("sanitizeSettings 合并 shortcuts", st.shortcuts.key, ["KeyQ"]);
  ok("layout 原样透传（不覆盖）", st.layout === layoutIn);
  ok("models 原样透传（不覆盖）", st.models === modelsIn);
  eq("version 归一到 1", st.version, 1);
  eq("合法输入不标 repaired", st.repaired, false);
  var stNull = K.sanitizeSettings(null);
  ok("null 偏好 → 默认 shortcuts + repaired", stNull.repaired === true && JSON.stringify(stNull.shortcuts.translate) === JSON.stringify(["KeyV"]));
  var stVer = K.sanitizeSettings({ version: 2, shortcuts: {} });
  ok("version 不符 → 提示 + repaired", stVer.repaired === true && stVer.issues.some(function (i) { return i.code === "VERSION_MISMATCH"; }));
  eq("version 不符仍产出 v1 结构", stVer.version, 1);
  ok("sanitizeSettings 不抛异常（数组/字符串输入）", typeof K.sanitizeSettings([]).shortcuts.translate[0] === "string" && typeof K.sanitizeSettings("x").shortcuts.undo[0] === "string");

  global.__selftestKeymapResult = result;
  if (typeof window !== "undefined") window.__selftestKeymapResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
