/*
 * selftest-slotgroups.js —— slot-groups.js 的纯函数自检（Node / 浏览器共用）
 * 依赖：slot-groups.js（globalThis.SpineSlotGroups）
 * 输出：globalThis.__selftestSlotGroupsResult = {passed, failed, total, cases, failures}
 * 覆盖：分组规范化（成员白名单 / 未覆盖补「未分组」/ 重名与未知槽）、组显隐三态、
 *       搜索过滤（只留有命中的组 + 命中收缩）、跨组与首尾拖动拒绝、连续 z 区间校验。
 */
(function (global) {
  "use strict";

  var S = global.SpineSlotGroups;
  var result = { passed: 0, failed: 0, total: 0, cases: {}, failures: [], startedAt: new Date().toISOString() };
  var currentCase = "(global)";

  function fmt(v) {
    if (typeof v === "number") return isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : String(v);
    if (Array.isArray(v)) return "[" + v.map(fmt).join(", ") + "]";
    if (v && typeof v === "object") return JSON.stringify(v);
    return String(v);
  }
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

  if (!S) {
    record(false, "slot-groups.js 已加载", "SpineSlotGroups", null);
    global.__selftestSlotGroupsResult = result;
    return;
  }

  /* 模拟 model.slots：0 最背 → 5 最前（数组序 = z 序） */
  var SLOTS = [{ name: "back" }, { name: "tail" }, { name: "body" }, { name: "cloth" }, { name: "face" }, { name: "expr" }];
  /* rig-meta 顺序 = 前 → 背，组内 members 按 model.slots 递增写 */
  var RAW = [
    { id: "expr", name: "表情", slots: ["expr"] },
    { id: "face", name: "脸部", slots: ["face"] },
    { id: "cloth", name: "服装", slots: ["cloth"] },
    { id: "body", name: "身体", slots: ["body"] },
    { id: "tail", name: "尾巴", slots: ["tail"] },
    { id: "back", name: "后发", slots: ["back"] },
  ];

  section("slot-groups / 规范化");
  var g = S.normalizeGroups(RAW, SLOTS);
  eq("组数", g.length, 6);
  deepEq("组序 = 前 → 背", g.map(function (x) { return x.id; }), ["expr", "face", "cloth", "body", "tail", "back"]);
  deepEq("组内槽按 model 顺序", g[0].slots, ["expr"]);
  deepEq("slotIndices 递增", g[2].slotIndices, [3]);
  eq("z 标签单槽", g[5].zLabel, "z 0");
  eq("空输入 → 空数组（平铺 fallback）", S.normalizeGroups(null, SLOTS).length, 0);
  eq("非数组 → 空数组", S.normalizeGroups({ a: 1 }, SLOTS).length, 0);
  eq("无槽 → 空数组", S.normalizeGroups(RAW, []).length, 0);
  eq("groupsAvailable", S.groupsAvailable(g), true);
  eq("groupsAvailable 空数组", S.groupsAvailable([]), false);

  var multi = S.normalizeGroups(
    [
      { id: "top", name: "上", slots: ["expr", "face"] },
      { id: "bottom", name: "下", slots: ["cloth", "body", "tail", "back"] },
    ],
    SLOTS
  );
  eq("多成员组数", multi.length, 2);
  deepEq("多成员组内顺序=model 递增", multi[0].slots, ["face", "expr"]);
  eq("多成员 z 范围", multi[0].zLabel, "z 4–5");
  eq("多成员连续", multi[0].partial, false);

  section("slot-groups / 严格校验：非法一律返回 []");
  eq("重名 id → []", S.normalizeGroups([{ id: "a", name: "A", slots: ["expr", "face"] }, { id: "a", name: "B", slots: ["cloth"] }], SLOTS).length, 0);
  eq("重名 name → []", S.normalizeGroups([{ id: "a", name: "A", slots: ["expr"] }, { id: "b", name: "A", slots: [] }], SLOTS).length, 0);
  eq("同组重复成员 → []", S.normalizeGroups([{ id: "x", name: "X", slots: ["expr", "expr"] }], SLOTS).length, 0);
  eq("跨组重复成员 → []", S.normalizeGroups([{ id: "x", name: "X", slots: ["expr"] }, { id: "y", name: "Y", slots: ["expr"] }], SLOTS).length, 0);
  eq("未知槽 → []", S.normalizeGroups([{ id: "x", name: "X", slots: ["expr", "nope"] }], SLOTS).length, 0);
  eq("未全覆盖 → []", S.normalizeGroups([{ id: "x", name: "X", slots: ["expr"] }], SLOTS).length, 0);
  eq("非连续 z → []", S.normalizeGroups([{ id: "x", name: "X", slots: ["expr", "body"] }, { id: "y", name: "Y", slots: ["face", "cloth", "tail", "back"] }], SLOTS).length, 0);
  eq("组序反转（后组 z 更高）→ []", S.normalizeGroups([{ id: "a", name: "A", slots: ["back"] }, { id: "b", name: "B", slots: ["expr", "face", "cloth", "body", "tail"] }], SLOTS).length, 0);
  eq("缺 id → []", S.normalizeGroups([{ name: "A", slots: ["expr"] }], SLOTS).length, 0);
  eq("空 id → []", S.normalizeGroups([{ id: "", name: "A", slots: ["expr"] }], SLOTS).length, 0);
  eq("空 name → []", S.normalizeGroups([{ id: "a", name: "", slots: ["expr"] }], SLOTS).length, 0);
  eq("slots 不是数组 → []", S.normalizeGroups([{ id: "a", name: "A", slots: "expr" }], SLOTS).length, 0);
  eq("slots 空数组 → []", S.normalizeGroups([{ id: "a", name: "A", slots: [] }], SLOTS).length, 0);
  eq("slots 含非字符串 → []", S.normalizeGroups([{ id: "a", name: "A", slots: [1, 2] }], SLOTS).length, 0);
  eq("分组元素不是对象 → []", S.normalizeGroups([null], SLOTS).length, 0);
  eq("model 本身有重名槽 → []", S.normalizeGroups([{ id: "a", name: "A", slots: ["dup", "dup2"] }], [{ name: "dup" }, { name: "dup" }]).length, 0);

  section("slot-groups / 契约校验 validateGroups");
  var legal = S.normalizeGroups(
    [
      { id: "front", name: "前", slots: ["expr", "face"] },
      { id: "back", name: "后", slots: ["cloth", "body", "tail", "back"] },
    ],
    SLOTS
  );
  ok("合法分组通过校验", S.validateGroups(legal, SLOTS).ok === true);
  eq("空数组不通过", S.validateGroups([], SLOTS).ok, false);
  var reasonCount = S.validateGroups([], SLOTS).reasons.length;
  ok("失败给原因", reasonCount > 0);
  var nonContig = legal.map(function (g) { return Object.assign({}, g, { partial: true }); });
  ok("partial 不通过", S.validateGroups(nonContig, SLOTS).ok === false);
  var reversed = [
    Object.assign({}, legal[0], { minIndex: 0, maxIndex: 1, slotIndices: [0, 1] }),
    Object.assign({}, legal[1], { minIndex: 2, maxIndex: 5, slotIndices: [2, 3, 4, 5] }),
  ];
  var ov = S.validateGroups(reversed, SLOTS);
  ok("组序反转不通过", ov.ok === false && ov.reasons.join(" ").indexOf("组序") >= 0);
  var outOfRange = [Object.assign({}, legal[0], { slotIndices: [99] }), legal[1]];
  ok("越界下标不通过", S.validateGroups(outOfRange, SLOTS).ok === false);

  section("slot-groups / 显隐三态");
  var hidden = new Set();
  deepEq("全可见", S.computeGroupVis(["a", "b"], hidden), { state: "all", visible: 2, hidden: 0, total: 2 });
  hidden.add("a");
  deepEq("部分隐藏", S.computeGroupVis(["a", "b"], hidden), { state: "mixed", visible: 1, hidden: 1, total: 2 });
  hidden.add("b");
  deepEq("全隐藏", S.computeGroupVis(["a", "b"], hidden), { state: "none", visible: 0, hidden: 2, total: 2 });
  deepEq("空组视为全可见", S.computeGroupVis([], hidden), { state: "all", visible: 0, hidden: 0, total: 0 });
  deepEq("all → hide", S.approachGroupVis("all", 0), { action: "hide", add: true, remove: false });
  deepEq("none → show", S.approachGroupVis("none", 2), { action: "show", add: false, remove: true });
  deepEq("mixed → show", S.approachGroupVis("mixed", 1), { action: "show", add: false, remove: true });

  section("slot-groups / 搜索过滤");
  var all = S.filterGroups(g, "", function () { return ""; });
  eq("空搜索保留全部组", all.length, 6);
  eq("空搜索不做收缩", all[0].hits === all[0].total, true);
  var hay = function (name) {
    return name + " bone-" + name;
  };
  var hit = S.filterGroups(g, "expr", hay);
  eq("只留下有命中的组", hit.length, 1);
  eq("命中组 gid", hit[0].gid, "expr");
  eq("命中数=总数（单成员）", hit[0].hits, 1);
  eq("searching 标记", hit[0].searching, true);

  var g2 = S.normalizeGroups(
    [
      { id: "big", name: "大组", slots: ["expr", "face", "cloth"] },
      { id: "rest", name: "其余", slots: ["body", "tail", "back"] },
    ],
    SLOTS
  );
  eq("搜索用分组合法（全覆盖）", g2.length, 2);
  var hit2 = S.filterGroups(g2, "cloth", hay);
  deepEq("命中收缩只留命中成员", hit2[0].slotNames, ["cloth"]);
  eq("命中数", hit2[0].hits, 1);
  eq("总数仍是组大小", hit2[0].total, 3);
  var miss = S.filterGroups(g2, "zzz", hay);
  eq("无命中 → 空", miss.length, 0);
  var trimmed = S.filterGroups(g2, "  EXPR  ", hay);
  eq("搜索去空白 + 忽略大小写", trimmed.length, 1);

  section("slot-groups / 组内拖动约束");
  var gg = S.normalizeGroups(
    [
      { id: "front", name: "前组", slots: ["expr", "face"] },
      { id: "back", name: "后组", slots: ["cloth", "body", "tail", "back"] },
    ],
    SLOTS
  );
  var same = S.canDropInGroup(gg, 5, 4, false);
  ok("同组内允许", same.ok === true && same.reason === "same-group");
  var cross = S.canDropInGroup(gg, 5, 3, false);
  ok("跨组拒绝", cross.ok === false && cross.reason === "cross-group");
  ok("跨组提示含组名", cross.message.indexOf("前组") >= 0 && cross.message.indexOf("后组") >= 0);
  var top = S.canDropInGroup(gg, 5, "top", false);
  ok("拖到列表首拒绝", top.ok === false && top.reason === "outside-list");
  var bottom = S.canDropInGroup(gg, 5, "bottom", false);
  ok("拖到列表尾拒绝", bottom.ok === false);
  var nullTarget = S.canDropInGroup(gg, 5, null, false);
  ok("null 落点拒绝", nullTarget.ok === false);
  var noGroups = S.canDropInGroup([], 5, "top", false);
  ok("无分组时不受限（平铺回退）", noGroups.ok === true && noGroups.reason === "no-groups");
  var unknown = S.canDropInGroup(gg, 99, 4, false);
  ok("未知源下标拒绝", unknown.ok === false);
  ok("groupOfIndex 命中", S.groupOfIndex(gg, 5).id === "front");
  eq("groupOfIndex 未命中", S.groupOfIndex(gg, 99), null);

  var parts = S.partitionByGroups(gg, [5, 4, 3, 2, 1, 0]);
  eq("分区组数", parts.length, 2);
  deepEq("前组分区", parts[0].indices, [5, 4]);
  deepEq("后组分区", parts[1].indices, [3, 2, 1, 0]);

  section("slot-groups / 折叠状态");
  var col = S.defaultCollapsed();
  eq("默认全展开", col.size, 0);
  eq("isCollapsed 默认 false", S.isCollapsed(col, "expr"), false);
  col.add("expr");
  eq("折叠后 true", S.isCollapsed(col, "expr"), true);
  eq("未折叠组 false", S.isCollapsed(col, "face"), false);
  eq("isCollapsed 容忍 undefined", S.isCollapsed(undefined, "expr"), false);
  eq("slug 生成稳定 id", S.slug("头发与发饰"), "头发与发饰");
  eq("slug 处理空名", S.slug(""), "group");

  global.__selftestSlotGroupsResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
