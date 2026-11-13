/*
 * selftest-trackedit.js —— track-edit.js 纯函数自检（T24 + T24-FIX 约束容器结构）
 * 依赖：track-edit.js（globalThis.SpineTrackEdit）；可选 spine-core.js（构造解析态 model 用于 deform/事件校验）。
 * 输出：globalThis.__selftestTrackEditResult = {passed, failed, total, cases, failures, notes}
 *
 * 结构口径（官方 4.2.120）：ik/transform = 合并 key 数组；path = {position,spacing,mix} 子轨对象，
 * position/spacing 用 value 字段、mix 用 mixRotate/mixX/mixY。
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
  function snap(v) {
    return JSON.stringify(v);
  }
  function codeOf(res) {
    return res && res.issues && res.issues.length ? res.issues[0].code : null;
  }
  function issueHas(res, code) {
    return !!(res && res.issues && res.issues.some(function (i) { return i.code === code; }));
  }

  var nodeMods = null;
  if (typeof process !== "undefined" && process.versions && process.versions.node && typeof process.getBuiltinModule === "function") {
    try { nodeMods = { fs: process.getBuiltinModule("node:fs"), module: process.getBuiltinModule("node:module"), cwd: process.cwd() }; } catch (e) { nodeMods = null; }
  }
  var T = global.SpineTrackEdit;
  var core = global.SpineCore;
  if (nodeMods) {
    var cwd = nodeMods.cwd.replace(/[\\/]+$/, "");
    var req = null;
    try { req = nodeMods.module.createRequire(cwd + "/selftest-trackedit-loader.js"); } catch (e) { req = null; }
    if (req) {
      if (!T) { try { req(cwd + "/tools/character-editor/track-edit.js"); T = global.SpineTrackEdit; } catch (e) { T = null; } }
      if (!core) { try { req(cwd + "/tools/character-editor/spine-core.js"); core = global.SpineCore; } catch (e) { core = null; } }
    }
  }
  if (!T) {
    record(false, "track-edit.js 已加载（globalThis.SpineTrackEdit）", "存在", null);
    global.__selftestTrackEditResult = result;
    return;
  }

  function ikKey(time, mix, extra) {
    return Object.assign({ time: time, mix: mix, softness: 0, bendPositive: true, compress: false, stretch: false }, extra || {});
  }
  function baseAnim() {
    return {
      bones: { b1: { rotate: [{ time: 0, value: 0 }] } },
      events: [{ time: 0.1, name: "step" }, { time: 0.5, name: "jump", int: 2, volume: 0.8 }],
      drawOrder: [{ time: 0, offsets: [] }, { time: 0.5, offsets: [{ slot: "s1", offset: -1 }, { slot: "s2", offset: 2 }] }],
      ik: { ik1: [ikKey(0, 1, { curve: "stepped" })] },
      transform: { tc1: [{ time: 0, mixRotate: 0.5, mixX: 1, mixY: 1, mixScaleX: 1, mixScaleY: 1, mixShearY: 1 }] },
      path: {
        pc1: {
          position: [{ time: 0, value: 0.5 }],
          spacing: [{ time: 0, value: 1 }],
          mix: [{ time: 0, mixRotate: 0.25, mixX: 1, mixY: 1 }],
        },
      },
      attachments: { default: { s1: { m1: { deform: [{ time: 0, offset: 0, vertices: [0, 0, 0, 0, 0, 0] }, { time: 1, offset: 0, vertices: [2, 0, 0, -2, -2, 0] }] } } } },
      deform: { s1: [{ time: 0, offset: 0, vertices: [0, 0, 0, 0, 0, 0] }] },
      weird: { nested: [{ time: 0.3, v: 1 }] },
    };
  }
  var MODEL_JSON = {
    skeleton: { spine: "4.2.22" },
    events: { step: {}, jump: {} },
    bones: [{ name: "root" }, { name: "b1", parent: "root", length: 50 }],
    slots: [{ name: "s1", bone: "b1", attachment: "m1" }, { name: "s2", bone: "b1" }],
    skins: [{ name: "default", attachments: { s1: { m1: { type: "mesh", path: "meshA", uvs: [0, 0, 1, 0, 1, 1], vertices: [0, 0, 10, 0, 10, 10], triangles: [0, 1, 2], hull: 3 } } } }],
    ik: [{ name: "ik1", bones: ["b1"], target: "root" }],
    transform: [{ name: "tc1", bones: ["b1"], target: "root" }],
    path: [{ name: "pc1", bones: ["b1"], target: "root" }],
  };
  var model = null;
  if (core) {
    var parsed = core.parseModel(MODEL_JSON, core.parseAtlas("tex.png\nsize: 128, 128\nmeshA\nbounds: 0, 0, 32, 32\n").value, { skin: "default" });
    if (parsed.ok) model = parsed.value;
  }
  if (!model) result.notes.push({ name: "model", detail: "SpineCore 未加载或缺省 model 解析失败：deform 长度/事件名校验按 raw 回退" });

  /* ------------------------------------------------------------------ */
  section("track-edit / SCHEMA 与容器描述");
  deepEq("SCHEMA 类型集合", Object.keys(T.SCHEMA).sort(), ["deform", "drawOrder", "event", "ik", "path", "transform"]);
  ok("SCHEMA 冻结", Object.isFrozen(T.SCHEMA));
  ok("ik 声明 combinedKeys", T.SCHEMA.ik.container === "combinedKeys");
  ok("transform 声明 combinedKeys", T.SCHEMA.transform.container === "combinedKeys");
  ok("path 声明 pathObject", T.SCHEMA.path.container === "pathObject");
  deepEq("ik keyFields", T.SCHEMA.ik.keyFields.slice(), ["mix", "softness", "bendPositive", "compress", "stretch"]);
  deepEq("transform keyFields", T.SCHEMA.transform.keyFields.slice(), ["mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY"]);
  deepEq("path 子轨 position/spacing/mix", Object.keys(T.SCHEMA.path.subTracks).sort(), ["mix", "position", "spacing"]);
  eq("path position 是单值子轨", T.SCHEMA.path.subTracks.position.mode, "single");
  eq("path mix 是合并子轨", T.SCHEMA.path.subTracks.mix.mode, "combinedKeys");
  eq("event/deform 容器保持 array/attachment", T.SCHEMA.event.container + "/" + T.SCHEMA.deform.container, "array/attachment");
  ok("ik mix 有 0..1 约束", T.SCHEMA.ik.fields.filter(function (f) { return f.name === "mix"; })[0].max === 1);

  /* ------------------------------------------------------------------ */
  section("track-edit / resolveContainer（官方结构）");
  var A0 = baseAnim();
  var rcIk = T.resolveContainer(A0, "ik", "ik1", "mix");
  ok("ik 解析为约束级合并数组", rcIk.ok === true && rcIk.mode === "combinedKeys" && rcIk.keys.length === 1);
  eq("ik writeField", rcIk.writeField, "mix");
  var rcTc = T.resolveContainer(A0, "transform", "tc1", "mixRotate");
  ok("transform 解析为合并数组", rcTc.ok === true && rcTc.mode === "combinedKeys" && rcTc.writeField === "mixRotate");
  var rcPos = T.resolveContainer(A0, "path", "pc1", "position");
  ok("path position 单值子轨", rcPos.ok === true && rcPos.mode === "single" && rcPos.valueField === "value");
  var rcSp = T.resolveContainer(A0, "path", "pc1", "spacing");
  ok("path spacing 单值子轨", rcSp.ok === true && rcSp.mode === "single");
  var rcMix = T.resolveContainer(A0, "path", "pc1", "mixRotate");
  ok("path mixRotate 指向 mix 合并数组", rcMix.ok === true && rcMix.mode === "combinedKeys" && rcMix.keys === A0.path.pc1.mix && rcMix.writeField === "mixRotate");
  var rcMixAll = T.resolveContainer(A0, "path", "pc1", "mix");
  ok("path mix 整组可解析", rcMixAll.ok === true && rcMixAll.writeField === null);
  eq("ik 未知字段 → TRACK_FIELD_UNKNOWN", T.resolveContainer(A0, "ik", "ik1", "wobble").code, "TRACK_FIELD_UNKNOWN");
  eq("未知约束 → TRACK_NOT_FOUND", T.resolveContainer(A0, "ik", "nope", "mix").code, "TRACK_NOT_FOUND");
  eq("未知 path 子轨 → TRACK_FIELD_UNKNOWN", T.resolveContainer(A0, "path", "pc1", "wobble").code, "TRACK_FIELD_UNKNOWN");
  var created = T.resolveContainer({ ik: {} }, "ik", "ik1", "mix", { create: true });
  ok("create=true 可创建缺失约束数组", created.ok === true && Array.isArray(created.keys) && created.created === true);
  eq("create=false 不创建", T.resolveContainer({ ik: {} }, "ik", "ik1", "mix").ok, false);
  ok("events/drawOrder 数组容器", T.resolveContainer(A0, "event").ok === true && T.resolveContainer(A0, "drawOrder").ok === true);
  ok("deform 4.2 容器", T.resolveContainer(A0, "deform", "s1", "m1").ok === true);
  ok("旧式 deform 容器", T.resolveContainer(A0, "deform", "s1", null).legacy === true);

  /* ------------------------------------------------------------------ */
  section("track-edit / deform 长度与目标");
  eq("raw 刚性 mesh 偏移长度 = 6", T.deformOffsetLengthFromRaw({ uvs: [0, 0, 1, 0, 1, 1], vertices: [0, 0, 10, 0, 10, 10], triangles: [0, 1, 2] }), 6);
  eq("raw 加权 mesh 偏移长度 = 2×influence", T.deformOffsetLengthFromRaw({ uvs: [0, 0, 1, 0, 1, 1], vertices: [1, 1, 0, 0, 1, 1, 1, 10, 0, 1, 2, 1, 0, 0, 0.5, 2, 10, 10, 0.5] }), 8);
  eq("raw 非法 → 0", T.deformOffsetLengthFromRaw({}), 0);
  if (model) {
    var targets = T.deformTargets(model, A0);
    eq("deformTargets 数量", targets.length, 1);
    eq("目标期望长度", targets[0].offsetLength, 6);
    ok("目标 hasDeform", targets[0].hasDeform === true);
    eq("mesh 目标 kind", targets[0].kind, "mesh");
    eq("mesh 目标 official=true", targets[0].official, true);
  }
  /* region / mesh / weightedmesh 三类（T31）：region 形变非官方特性，official 必须为 false */
  var KINDS_JSON = {
    skeleton: { spine: "4.2.22" },
    bones: [{ name: "root" }, { name: "b1", parent: "root", length: 10 }],
    slots: [
      { name: "sR", bone: "root", attachment: "r1" },
      { name: "sM", bone: "root", attachment: "m1" },
      { name: "sW", bone: "root", attachment: "w1" },
    ],
    skins: [
      {
        name: "default",
        attachments: {
          sR: { r1: { type: "region", path: "r1", width: 4, height: 4 } },
          sM: { m1: { type: "mesh", path: "m1", uvs: [0, 0, 1, 0, 1, 1], vertices: [0, 0, 10, 0, 10, 10], triangles: [0, 1, 2] } },
          sW: { w1: { type: "mesh", path: "w1", uvs: [0, 0, 1, 0, 1, 1], vertices: [2, 0, 0, 0, 0.5, 1, 10, 0, 0.5, 2, 0, 1, 0, 0.6, 1, 10, 1, 0.4, 2, 0, 2, 0, 0.3, 1, 10, 2, 0.7], triangles: [0, 1, 2] } },
        },
      },
    ],
  };
  if (core) {
    var kindsAtlas = core.parseAtlas("tex.png\nsize: 64, 64\nr1\nbounds: 0, 0, 4, 4\nm1\nbounds: 0, 0, 4, 4\nw1\nbounds: 0, 0, 4, 4\n");
    var kindsParsed = kindsAtlas.ok ? core.parseModel(KINDS_JSON, kindsAtlas.value, { skin: "default" }) : { ok: false };
    if (kindsParsed.ok) {
      var kt = T.deformTargets(kindsParsed.value, {});
      eq("三类候选都返回（region 不隐藏）", kt.length, 3);
      var kR = kt.filter(function (x) { return x.attachmentName === "r1"; })[0];
      var kM = kt.filter(function (x) { return x.attachmentName === "m1"; })[0];
      var kW = kt.filter(function (x) { return x.attachmentName === "w1"; })[0];
      eq("region kind", kR.kind, "region");
      eq("region official=false（非官方特性）", kR.official, false);
      deepEq("region 顶点数/偏移长度仍给出", [kR.vertexCount, kR.offsetLength], [4, 8]);
      deepEq("mesh kind/official", [kM.kind, kM.official], ["mesh", true]);
      deepEq("weightedmesh kind/official", [kW.kind, kW.official], ["weightedmesh", true]);
      eq("weightedmesh 偏移长度 = 2×influence", kW.offsetLength, 12);
      ok("每项都有 kind 与 official 字段", kt.every(function (x) { return typeof x.kind === "string" && typeof x.official === "boolean"; }));
      /* 已存在 region 形变轨时，scanExtra 行也要能标注 official:false 供 UI 提示 */
      var regionAnim = { attachments: { default: { sR: { r1: { deform: [{ time: 0, offset: 0, vertices: [0, 0, 0, 0, 0, 0, 0, 0] }] } } } } };
      var regionRow = T.scanExtra(regionAnim, kindsParsed.value).rows.filter(function (r) { return r.kind === "deform"; })[0];
      ok("scanExtra 行标注 attKind/official", !!regionRow && regionRow.attKind === "region" && regionRow.official === false);
    } else {
      result.skipped++;
      result.notes.push({ name: "三类形变候选", detail: "region/weighted 夹具解析失败，跳过" });
    }
  }

  /* ------------------------------------------------------------------ */
  section("track-edit / scanExtra 行模型");
  var scan = T.scanExtra(A0, model);
  var rowOf = function (kind, owner, field) {
    for (var i = 0; i < scan.rows.length; i++) {
      var r = scan.rows[i];
      if (r.kind === kind && r.owner === owner && (field === undefined || r.field === field)) return r;
    }
    return null;
  };
  eq("ik 每约束一行", scan.rows.filter(function (r) { return r.kind === "ik"; }).length, 1);
  eq("transform 每约束一行", scan.rows.filter(function (r) { return r.kind === "transform"; }).length, 1);
  eq("path 三行（position/spacing/mix）", scan.rows.filter(function (r) { return r.kind === "path"; }).length, 3);
  var ikRow = rowOf("ik", "ik1");
  ok("ik 行指向合并数组且 keyCount 正确", !!ikRow && ikRow.keys === A0.ik.ik1 && ikRow.keyCount === 1);
  ok("ik 行带 keyFields", !!ikRow && Array.isArray(ikRow.keyFields) && ikRow.keyFields.indexOf("mix") >= 0);
  var posRow = rowOf("path", "pc1", "position");
  ok("path position 行 valueField=value", !!posRow && posRow.valueField === "value" && posRow.keyCount === 1);
  var mixRow = rowOf("path", "pc1", "mix");
  ok("path mix 行 keyCount", !!mixRow && mixRow.keyCount === 1);
  var dRow = rowOf("deform", "s1", "m1");
  eq("deform 行 offsetLength", dRow.offsetLength, 6);
  ok("未知时序行标 unsupported", rowOf("timeline", "weird", "weird").unsupported === true);
  var scanBad = T.scanExtra({ ik: { ik1: { mix: [{ time: 0 }] } } }, model);
  ok("ik 非数组 → 结构非法 + unsupported", issueHas(scanBad, "TRACK_CONTAINER_INVALID") && scanBad.rows[0].unsupported === true);
  var scanUnknownField = T.scanExtra({ ik: { ik1: [{ time: 0, mix: 1, wobble: 2 }] } }, model);
  ok("合并 key 未知字段 → TRACK_UNKNOWN_FIELD", issueHas(scanUnknownField, "TRACK_UNKNOWN_FIELD"));
  var scanPathBad = T.scanExtra({ path: { pc1: { position: 5 } } }, model);
  ok("path 子轨非数组 → 结构 issue", issueHas(scanPathBad, "TRACK_CONTAINER_INVALID"));
  ok("kindOfRows 等价", T.kindOfRows(A0, model).length === scan.rows.length);

  /* ------------------------------------------------------------------ */
  section("track-edit / validateTrack");
  ok("干净 ik 轨道 ok", T.validateTrack(A0, model, "ik", "ik1", "mix").ok === true, JSON.stringify(T.validateTrack(A0, model, "ik", "ik1", "mix").issues));
  ok("干净 path 轨道 ok", T.validateTrack(A0, model, "path", "pc1", "position").ok === true);
  ok("ik mix>1 → TRACK_FIELD_RANGE", (function () {
    var a = baseAnim();
    a.ik.ik1 = [ikKey(0, 2)];
    return issueHas(T.validateTrack(a, model, "ik", "ik1", "mix"), "TRACK_FIELD_RANGE");
  })());
  ok("ik bendPositive 非布尔 → TRACK_FIELD_BOOL", (function () {
    var a = baseAnim();
    a.ik.ik1 = [ikKey(0, 1, { bendPositive: 1 })];
    return issueHas(T.validateTrack(a, model, "ik", "ik1", "bendPositive"), "TRACK_FIELD_BOOL");
  })());
  ok("ik 未知字段 → TRACK_UNKNOWN_FIELD 且 ok=true", (function () {
    var a = baseAnim();
    a.ik.ik1 = [ikKey(0, 1, { wobble: 3 })];
    var v = T.validateTrack(a, model, "ik", "ik1", "mix");
    return issueHas(v, "TRACK_UNKNOWN_FIELD") && v.ok === true;
  })());
  ok("path position 非数字 → TRACK_FIELD_NUMBER", (function () {
    var a = baseAnim();
    a.path.pc1.position = [{ time: 0, value: "x" }];
    return issueHas(T.validateTrack(a, model, "path", "pc1", "position"), "TRACK_FIELD_NUMBER");
  })());
  ok("乱序 → KEY_OUT_OF_ORDER", (function () {
    var a = baseAnim();
    a.ik.ik1 = [ikKey(1, 1), ikKey(0, 1)];
    return issueHas(T.validateTrack(a, model, "ik", "ik1", "mix"), "KEY_OUT_OF_ORDER");
  })());
  ok("重复时间 → KEY_DUPLICATE_TIME", (function () {
    var a = baseAnim();
    a.ik.ik1 = [ikKey(0.5, 1), ikKey(0.5, 0.5)];
    return issueHas(T.validateTrack(a, model, "ik", "ik1", "mix"), "KEY_DUPLICATE_TIME");
  })());

  /* ------------------------------------------------------------------ */
  section("track-edit / planKeyEdit：合并 key（ik/transform）");
  var e0 = baseAnim();
  var e0snap = snap(e0);
  var addIk = T.planKeyEdit(e0, { kind: "ik", owner: "ik1", field: "mix", op: "add", time: 0.5, value: { mix: 0.4 }, model: model });
  ok("add ik 合并 key ok", addIk.ok === true, JSON.stringify(addIk.issues));
  eq("add 后 keyCount", addIk.keyCount, 2);
  deepEq("新 key 含全部 keyFields", Object.keys(addIk.value.ik.ik1[1]).sort(), ["bendPositive", "compress", "mix", "softness", "stretch", "time"]);
  eq("新 key mix 生效", addIk.value.ik.ik1[1].mix, 0.4);
  eq("新 key 默认 softness=0", addIk.value.ik.ik1[1].softness, 0);
  eq("新 key 默认 bendPositive=true", addIk.value.ik.ik1[1].bendPositive, true);
  ok("原 key 的 curve 保真", addIk.value.ik.ik1[0].curve === "stepped");
  ok("add 不改入参", snap(e0) === e0snap);
  eq("add 结果时间有序", addIk.value.ik.ik1[0].time < addIk.value.ik.ik1[1].time, true);
  var addTc = T.planKeyEdit(baseAnim(), { kind: "transform", owner: "tc1", field: "mixRotate", op: "add", time: 0.9, value: { mixRotate: 0.5 }, model: model });
  deepEq("transform 新 key 六字段齐全", Object.keys(addTc.value.transform.tc1[1]).sort(), ["mixRotate", "mixScaleX", "mixScaleY", "mixShearY", "mixX", "mixY", "time"]);
  eq("transform 新 key 值", addTc.value.transform.tc1[1].mixRotate, 0.5);
  eq("transform 默认 mixX=1", addTc.value.transform.tc1[1].mixX, 1);
  var overwrite = T.planKeyEdit(baseAnim(), { kind: "ik", owner: "ik1", field: "mix", op: "add", time: 0, value: { mix: 0.9 }, model: model });
  ok("同刻覆盖合并 key", overwrite.ok === true && overwrite.overwritten === true && overwrite.keyCount === 1);
  eq("同刻覆盖只改本次字段", overwrite.value.ik.ik1[0].mix, 0.9);
  eq("同刻覆盖保留其它字段（softness）", overwrite.value.ik.ik1[0].softness, 0);
  ok("同刻覆盖保留 curve", overwrite.value.ik.ik1[0].curve === "stepped");
  var setIk = T.planKeyEdit(baseAnim(), { kind: "ik", owner: "ik1", field: "softness", op: "set", index: 0, value: { softness: 0.3 }, model: model });
  ok("set 单字段 ok", setIk.ok === true);
  eq("set 写入目标字段", setIk.value.ik.ik1[0].softness, 0.3);
  eq("set 保留其它字段（mix）", setIk.value.ik.ik1[0].mix, 1);
  ok("set 保留 curve", setIk.value.ik.ik1[0].curve === "stepped");
  var setBad = T.planKeyEdit(baseAnim(), { kind: "ik", owner: "ik1", field: "mix", op: "set", index: 0, value: { mix: 5 }, model: model });
  eq("set 越界值 → TRACK_FIELD_RANGE", codeOf(setBad), "TRACK_FIELD_RANGE");
  ok("set 失败零改动", setBad.ok === false && setBad.value === null);
  var delIk = T.planKeyEdit(baseAnim(), { kind: "ik", owner: "ik1", field: "mix", op: "delete", index: 0, model: model });
  ok("delete 合并 key ok", delIk.ok === true && delIk.value.ik.ik1.length === 0);
  ok("delete 合并 key 提示影响其它字段", issueHas(delIk, "DELETE_COMBINED_KEY"));
  var moveIk = T.planKeyEdit(baseAnim(), { kind: "ik", owner: "ik1", field: "mix", op: "move", index: 0, delta: 0.25, model: model });
  ok("move 合并 key ok", moveIk.ok === true && Math.abs(moveIk.value.ik.ik1[0].time - 0.25) < 1e-9);
  eq("move 保留其它字段", moveIk.value.ik.ik1[0].mix, 1);
  ok("move 保留 curve", moveIk.value.ik.ik1[0].curve === "stepped");
  var twoIk = T.planKeyEdit(addIk.value, { kind: "ik", owner: "ik1", field: "mix", op: "move", index: 1, delta: -0.5, model: model });
  eq("move 撞已有 key → TIME_COLLISION", codeOf(twoIk), "TIME_COLLISION");
  eq("ik 缺 owner 时预检拒绝", (function () {
    var r = T.planKeyEdit(baseAnim(), { kind: "ik", field: "mix", op: "add", time: 0.5, value: { mix: 0.5 } });
    return r.ok;
  })(), true);

  /* ------------------------------------------------------------------ */
  section("track-edit / planKeyEdit：path 子轨");
  var addPos = T.planKeyEdit(baseAnim(), { kind: "path", owner: "pc1", field: "position", op: "add", time: 0.3, value: { position: 0.5 }, model: model });
  ok("path position add ok", addPos.ok === true, JSON.stringify(addPos.issues));
  deepEq("position 写入 value 字段（官方 readTimeline1）", addPos.value.path.pc1.position[1], { time: 0.3, value: 0.5 });
  ok("position key 不含 position 字段", addPos.value.path.pc1.position[1].position === undefined);
  var addSp = T.planKeyEdit(baseAnim(), { kind: "path", owner: "pc1", field: "spacing", op: "add", time: 0.4, value: { value: 2 }, model: model });
  ok("spacing 支持 value 简写", addSp.ok === true && addSp.value.path.pc1.spacing[1].value === 2);
  var addMix = T.planKeyEdit(baseAnim(), { kind: "path", owner: "pc1", field: "mixRotate", op: "add", time: 0.3, value: { mixRotate: 0.25 }, model: model });
  ok("path mixRotate add ok", addMix.ok === true);
  deepEq("mix 新 key 三字段齐全", Object.keys(addMix.value.path.pc1.mix[1]).sort(), ["mixRotate", "mixX", "mixY", "time"]);
  eq("mix 新 key 值", addMix.value.path.pc1.mix[1].mixRotate, 0.25);
  eq("mix 默认 mixX=1", addMix.value.path.pc1.mix[1].mixX, 1);
  var setMix = T.planKeyEdit(baseAnim(), { kind: "path", owner: "pc1", field: "mixY", op: "set", index: 0, value: { mixY: 0.4 }, model: model });
  ok("path mix set 单字段 ok", setMix.ok === true && setMix.value.path.pc1.mix[0].mixY === 0.4);
  eq("path mix set 保留 mixRotate", setMix.value.path.pc1.mix[0].mixRotate, 0.25);
  var setPos = T.planKeyEdit(baseAnim(), { kind: "path", owner: "pc1", field: "position", op: "set", index: 0, value: { value: 1.5 }, model: model });
  ok("path position set ok", setPos.ok === true && setPos.value.path.pc1.position[0].value === 1.5);
  eq("path position set 只改 value", Object.keys(setPos.value.path.pc1.position[0]).sort().join(","), "time,value");
  var delPos = T.planKeyEdit(baseAnim(), { kind: "path", owner: "pc1", field: "position", op: "delete", index: 0 });
  ok("path position delete 保留空数组", delPos.ok === true && Array.isArray(delPos.value.path.pc1.position) && delPos.value.path.pc1.position.length === 0);
  var movePos = T.planKeyEdit(baseAnim(), { kind: "path", owner: "pc1", field: "position", op: "move", index: 0, time: 0.6 });
  ok("path position move 用显式 time", movePos.ok === true && Math.abs(movePos.value.path.pc1.position[0].time - 0.6) < 1e-9);

  /* ------------------------------------------------------------------ */
  section("track-edit / planKeyEdit：event / drawOrder / deform");
  var addEv = T.planKeyEdit(baseAnim(), { kind: "event", owner: "events", field: "events", op: "add", time: 0.3, value: { name: "step" }, model: model });
  ok("add 事件 ok", addEv.ok === true, JSON.stringify(addEv.issues));
  deepEq("事件时间有序", addEv.value.events.map(function (k) { return k.time; }), [0.1, 0.3, 0.5]);
  ok("事件默认值填充", addEv.value.events[1].volume === 1 && addEv.value.events[1].balance === 0);
  eq("缺 name → EVENT_NAME_REQUIRED", codeOf(T.planKeyEdit(baseAnim(), { kind: "event", op: "add", time: 0.3, value: {}, model: model })), "EVENT_NAME_REQUIRED");
  eq("未知事件名 → EVENT_NAME_UNKNOWN", codeOf(T.planKeyEdit(baseAnim(), { kind: "event", op: "add", time: 0.3, value: { name: "nope" }, model: model })), "EVENT_NAME_UNKNOWN");
  eq("负时间 → TIME_NEGATIVE", codeOf(T.planKeyEdit(baseAnim(), { kind: "event", op: "add", time: -1, value: { name: "step" }, model: model })), "TIME_NEGATIVE");
  var addDo = T.planKeyEdit(baseAnim(), { kind: "drawOrder", op: "add", time: 0.25, value: { offsets: [{ slot: "s1", offset: 1 }] }, model: model });
  ok("add drawOrder ok", addDo.ok === true);
  eq("drawOrder 非整数 offset → DRAW_ORDER_OFFSET", codeOf(T.planKeyEdit(baseAnim(), { kind: "drawOrder", op: "add", time: 0.25, value: { offsets: [{ slot: "s1", offset: 0.5 }] }, model: model })), "DRAW_ORDER_OFFSET");
  var addDef = T.planKeyEdit(baseAnim(), { kind: "deform", owner: "s1", field: "m1", op: "add", time: 0.5, value: { vertices: [1, 0, 0, -1, -1, 0] }, model: model });
  ok("add deform ok", addDef.ok === true);
  eq("deform 长度错 → DEFORM_LENGTH_MISMATCH", codeOf(T.planKeyEdit(baseAnim(), { kind: "deform", owner: "s1", field: "m1", op: "add", time: 0.5, value: { vertices: [1, 0] }, model: model })), "DEFORM_LENGTH_MISMATCH");
  var addDefAuto = T.planKeyEdit(baseAnim(), { kind: "deform", owner: "s1", field: "m1", op: "add", time: 0.5, value: {}, model: model });
  ok("缺 vertices 按期望长度补零", addDefAuto.ok === true && addDefAuto.value.attachments.default.s1.m1.deform[1].vertices.length === 6);
  var addLegacy = T.planKeyEdit(baseAnim(), { kind: "deform", owner: "s1", field: null, op: "add", time: 0.5, value: { vertices: [1, 1, 1, 1, 1, 1] }, model: model });
  ok("旧式 deform add ok（长度取 setup 附件）", addLegacy.ok === true, JSON.stringify(addLegacy.issues));
  eq("旧式 deform 从零创建不支持（需附件名）", codeOf(T.planKeyEdit(baseAnim(), { kind: "deform", owner: "s2", field: null, op: "add", time: 0.5, value: { vertices: [1, 1, 1, 1] }, model: model })), "DEFORM_FIELD_REQUIRED");
  eq("旧式 deform 缺容器且无附件名 → DEFORM_FIELD_REQUIRED", codeOf(T.planKeyEdit(baseAnim(), { kind: "deform", owner: "ghost", field: null, op: "add", time: 0.5, value: {}, model: model })), "DEFORM_FIELD_REQUIRED");
  eq("未知 kind → KIND_INVALID", codeOf(T.planKeyEdit(baseAnim(), { kind: "wobble", owner: "x", field: "y", op: "add", time: 0 })), "KIND_INVALID");
  eq("未知 op → OP_INVALID", codeOf(T.planKeyEdit(baseAnim(), { kind: "event", op: "wobble" })), "OP_INVALID");
  eq("轨道不存在 → TRACK_NOT_FOUND", codeOf(T.planKeyEdit(baseAnim(), { kind: "ik", owner: "nope", field: "mix", op: "set", index: 0, value: { mix: 0.5 } })), "TRACK_NOT_FOUND");
  eq("动画非对象 → ANIM_INVALID", codeOf(T.planKeyEdit(null, { kind: "event", op: "add", time: 0 })), "ANIM_INVALID");
  ok("set/delete 不改入参", (function () { var a = baseAnim(); var s = snap(a); T.planKeyEdit(a, { kind: "ik", owner: "ik1", field: "mix", op: "set", index: 0, value: { mix: 0.7 } }); return snap(a) === s; })());

  /* ------------------------------------------------------------------ */
  section("track-edit / deform 从零创建（T29）");
  var emptyAnim = { bones: { b1: { rotate: [{ time: 0, value: 0 }] } } };
  var emptySnap = snap(emptyAnim);
  var rcCreate = T.resolveContainer(JSON.parse(JSON.stringify(emptyAnim)), "deform", "s1", "m1", { create: true });
  ok("create=true 建链 attachments.default.s1.m1.deform", rcCreate.ok === true && rcCreate.mode === "attachment" && Array.isArray(rcCreate.keys) && rcCreate.keys.length === 0);
  eq("默认 skin 落到 default", rcCreate.skin, "default");
  eq("create=false 时不建链", T.resolveContainer(emptyAnim, "deform", "s1", "m1", {}).code, "TRACK_NOT_FOUND");

  var created1 = T.planKeyEdit(emptyAnim, { kind: "deform", owner: "s1", field: "m1", op: "add", time: 0.5, value: { vertices: [1, 0, 0, -1, -1, 0] }, model: model });
  ok("add 自动创建 deform 轨", created1.ok === true, JSON.stringify(created1.issues));
  ok("结构为 attachments.<skin>.<slot>.<att>.deform", !!created1.value.attachments && !!created1.value.attachments.default.s1.m1 && Array.isArray(created1.value.attachments.default.s1.m1.deform));
  eq("新 key 时间/偏移", created1.value.attachments.default.s1.m1.deform[0].time, 0.5);
  eq("新 key offset 默认 0", created1.value.attachments.default.s1.m1.deform[0].offset, 0);
  eq("新 key 顶点长度 = 刚性 2×顶点", created1.value.attachments.default.s1.m1.deform[0].vertices.length, 6);
  ok("add 成功后不改入参", snap(emptyAnim) === emptySnap);
  eq("create:false 显式拒绝创建", codeOf(T.planKeyEdit(emptyAnim, { kind: "deform", owner: "s1", field: "m1", op: "add", time: 0.5, value: {}, model: model, create: false })), "TRACK_NOT_FOUND");
  eq("长度推不出 → DEFORM_LENGTH_UNKNOWN", codeOf(T.planKeyEdit(emptyAnim, { kind: "deform", owner: "ghost", field: "m1", op: "add", time: 0.5, value: {}, model: model })), "DEFORM_LENGTH_UNKNOWN");
  ok("长度未知时零改动", (function () {
    var before = snap(emptyAnim);
    var r = T.planKeyEdit(emptyAnim, { kind: "deform", owner: "ghost", field: "m1", op: "add", time: 0.5, value: {}, model: model });
    return r.ok === false && r.value === null && snap(emptyAnim) === before;
  })());

  var add2 = T.planKeyEdit(created1.value, { kind: "deform", owner: "s1", field: "m1", op: "add", time: 0.2, value: {}, model: model });
  ok("已有容器追加（自动补零长度）", add2.ok === true && add2.value.attachments.default.s1.m1.deform.length === 2);
  ok("追加后按时间排序", add2.value.attachments.default.s1.m1.deform[0].time === 0.2 && add2.value.attachments.default.s1.m1.deform[1].time === 0.5);
  eq("已有容器不重复建（仍是同一条轨）", Object.keys(add2.value.attachments).length, 1);

  var heroAnim = { bones: {}, attachments: { hero: { s1: { m1: { deform: [] } } }, other: {} } };
  var heroPick = T.resolveContainer(JSON.parse(JSON.stringify(heroAnim)), "deform", "s1", "m1", { create: true, skin: "other" });
  ok("opts.skin 优先（即使别的 skin 已有轨道）", heroPick.ok === true && heroPick.skin === "other");
  eq("opts.skin 指向的 skin 无轨道且 create=false → 不回落", T.resolveContainer(heroAnim, "deform", "s1", "m1", { skin: "other" }).code, "TRACK_NOT_FOUND");
  var heroUnique = { bones: {}, attachments: { hero: { s1: { m1: { deform: [] } } } } };
  eq("唯一 skin 自动选中", T.resolveContainer(heroUnique, "deform", "s1", "m1", { create: true }).skin, "hero");
  var heroDefault = { bones: {}, attachments: { hero: {}, default: {} } };
  eq("多 skin 时优先 default", T.resolveContainer(heroDefault, "deform", "s1", "m1", { create: true }).skin, "default");
  var heroMulti = { bones: {}, attachments: { hero: {}, other: {} } };
  eq("多 skin 无 default → 要求显式 skin", T.resolveContainer(heroMulti, "deform", "s1", "m1", { create: true }).code, "DEFORM_SKIN_REQUIRED");
  var arrayAnim = { bones: {}, attachments: [] };
  eq("数组形态 attachments → 创建拒绝", T.resolveContainer(arrayAnim, "deform", "s1", "m1", { create: true }).code, "DEFORM_CREATE_ARRAY_SKINS_UNSUPPORTED");
  eq("数组形态 attachments → 编辑也拒绝", T.resolveContainer(arrayAnim, "deform", "s1", "m1", {}).code, "DEFORM_LEGACY_SKIN_ARRAY");
  ok("数组形态不被破坏", Array.isArray(arrayAnim.attachments) && arrayAnim.attachments.length === 0);

  /* 长度来源：raw 附件定义（无 model）/ 加权 mesh 解析态 */
  var rawLen = T.planKeyEdit({ bones: {}, attachments: { default: { s1: { m1: { uvs: [0, 0, 1, 0, 1, 1], vertices: [0, 0, 10, 0, 10, 10], deform: [] } } } } }, {
    kind: "deform",
    owner: "s1",
    field: "m1",
    op: "add",
    time: 0.1,
    value: {},
  });
  ok("无 model 时从 raw 附件推长度", rawLen.ok === true && rawLen.value.attachments.default.s1.m1.deform[0].vertices.length === 6, JSON.stringify(rawLen.issues));
  if (core) {
    var weightedJson = {
      skeleton: { spine: "4.2.22" },
      bones: [{ name: "root" }, { name: "b1", parent: "root", length: 10 }],
      slots: [{ name: "s1", bone: "b1", attachment: "m1" }],
      skins: [{ name: "default", attachments: { s1: { m1: { type: "mesh", uvs: [0, 0, 1, 0, 1, 1], vertices: [2, 0, 0, 0, 0.5, 1, 10, 0, 0.5, 2, 0, 1, 0, 0.6, 1, 10, 1, 0.4, 2, 0, 2, 0, 0.3, 1, 10, 2, 0.7], triangles: [0, 1, 2] } } } }],
    };
    var wAtlas = core.parseAtlas("tex.png\nsize: 64, 64\n");
    var wParsed = wAtlas.ok ? core.parseModel(weightedJson, wAtlas.value, { skin: "default" }) : { ok: false };
    if (wParsed.ok) {
      var wAdd = T.planKeyEdit({ bones: {} }, { kind: "deform", owner: "s1", field: "m1", op: "add", time: 0.1, value: {}, model: wParsed.value });
      ok("加权 mesh 长度 = 2×influence（12）", wAdd.ok === true && wAdd.value.attachments.default.s1.m1.deform[0].vertices.length === 12, JSON.stringify(wAdd.issues));
      var wScan = T.scanExtra(wAdd.value, wParsed.value);
      var wRow = wScan.rows.filter(function (r) { return r.kind === "deform" && r.owner === "s1"; })[0];
      ok("scanExtra 看到新建轨并给出加权长度", !!wRow && wRow.offsetLength === 12 && wRow.weighted === true);
      ok("新建轨 validateTrack ok", T.validateTrack(wAdd.value, wParsed.value, "deform", "s1", "m1").ok === true);
    } else {
      result.skipped++;
      result.notes.push({ name: "加权 mesh", detail: "加权夹具解析失败，跳过" });
    }
  }
  var svCreate = T.setDeformVertex(emptyAnim, { slot: "s1", attachment: "m1", index: 2, time: 0.3, x: 5, y: -5, model: model });
  ok("setDeformVertex 可从零建轨并写顶点", svCreate.ok === true && svCreate.value.attachments.default.s1.m1.deform[0].vertices[4] === 5);

  /* ------------------------------------------------------------------ */
  section("track-edit / setDeformVertex 与 signature");
  var sv = T.setDeformVertex(baseAnim(), { slot: "s1", attachment: "m1", index: 1, time: 1, x: 7, y: -7, model: model });
  ok("setDeformVertex ok", sv.ok === true, JSON.stringify(sv.issues));
  deepEq("目标顶点被改写", sv.value.attachments.default.s1.m1.deform[1].vertices, [2, 0, 7, -7, -2, 0]);
  var svNew = T.setDeformVertex(baseAnim(), { slot: "s1", attachment: "m1", index: 2, time: 0.5, x: 3, y: 4, model: model });
  ok("新时间自动建 key", svNew.ok === true && svNew.value.attachments.default.s1.m1.deform.length === 3);
  eq("顶点越界 → VERTEX_INDEX_RANGE", codeOf(T.setDeformVertex(baseAnim(), { slot: "s1", attachment: "m1", index: 9, time: 0, x: 1, y: 1, model: model })), "VERTEX_INDEX_RANGE");
  eq("x 非有限 → VERTEX_VALUE", codeOf(T.setDeformVertex(baseAnim(), { slot: "s1", attachment: "m1", index: 0, time: 0, x: NaN, y: 1, model: model })), "VERTEX_VALUE");
  var svLegacy = T.setDeformVertex(baseAnim(), { slot: "s1", legacy: true, index: 1, time: 0, x: 2, y: 2, model: model });
  ok("旧式 deform 顶点可改（长度来自 setup 附件）", svLegacy.ok === true && svLegacy.value.deform.s1[0].vertices[2] === 2, JSON.stringify(svLegacy.issues));
  eq("旧式 deform 缺容器 → TRACK_NOT_FOUND", codeOf(T.setDeformVertex(baseAnim(), { slot: "s2", legacy: true, index: 0, time: 0, x: 1, y: 1, model: model })), "TRACK_NOT_FOUND");
  if (model) {
    var sig1 = T.skeletonSignature(model);
    ok("签名稳定且含骨/槽数", sig1 === T.skeletonSignature(model) && sig1.split("-").slice(-2).join("-") === model.bones.length + "-" + model.slots.length);
  }
  eq("空 model → 空签名", T.skeletonSignature(null), "");
  ok("非模型 → 空签名", T.skeletonSignature({}) === "");

  global.__selftestTrackEditResult = result;
  if (typeof window !== "undefined") window.__selftestTrackEditResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);