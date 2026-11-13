/*
 * slot-groups.js —— 「显示顺序」PS 风格图层组的纯函数 · 纯模块
 * 边界（与 bundle.js / voice.js / anim-edit.js 一致）：
 *   本文件不碰 DOM / window.location / Image / Canvas / fetch / 磁盘 IO。
 *   只接受普通对象与数组，返回普通对象/布尔/字符串。
 *   浏览器暴露 window.SpineSlotGroups；Node 里是 globalThis.SpineSlotGroups（selftest 复用）。
 *
 * 约定（与 task-11 rig-meta.slotGroups 一致）：
 *   - groups 数组顺序 = 最前 → 最背（与编辑器「上方在前」一致）。
 *   - 每组 slots 按 model.slots 顺序，且组是**连续 z 区间**。
 *   - slot 下标 = model.slots 下标（0 = 最背）；显示顺序是下标倒序。
 */

(function (global) {
  "use strict";

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function isStr(v) {
    return typeof v === "string" && v.length > 0;
  }

  function slug(name) {
    return String(name == null ? "" : name)
      .replace(/[^0-9A-Za-z\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "") || "group";
  }

  /** 全部可见 / 全部隐藏 / 部分隐藏 */
  function computeGroupVis(names, hiddenSet) {
    let hidden = 0;
    const list = Array.isArray(names) ? names : [];
    for (const n of list) if (hiddenSet && typeof hiddenSet.has === "function" && hiddenSet.has(n)) hidden++;
    const state = hidden === 0 ? "all" : hidden === list.length ? "none" : "mixed";
    return { state: state, visible: list.length - hidden, hidden: hidden, total: list.length };
  }

  /** 三态眼睛的点击语义：全显示→全隐藏；全隐藏→全显示；部分→全显示 */
  function approachGroupVis(state, hiddenCount) {
    if (state === "all") return { action: "hide", add: true, remove: false };
    if (state === "none") return { action: "show", add: false, remove: true };
    if (hiddenCount > 0) return { action: "show", add: false, remove: true };
    return { action: "hide", add: true, remove: false };
  }

  /**
   * 严格规范化 rig-meta.slotGroups：**任何一处非法都返回 []**，由调用方走「平铺 + 警告」分支。
   * 校验（全部满足才返回分组）：
   *   - raw 是数组且非空；每个元素是对象，id / name 非空且组内唯一；
   *   - slots 是非空字符串数组；每个名字都在当前 model 里（无未知槽）；
   *   - 无跨组或组内重复成员；当前 model 的**每个槽都被覆盖**（全覆盖）；
   *   - 每组的下标集合是连续区间；
   *   - 组序 = 前 → 背：后一组的 maxIndex 严格小于前一组的 minIndex（z 区间不重叠且单调）。
   * 说明：组内成员会在输出里按**当前 model 顺序**重排（白名单语义，见 Lead 裁定：
   *   meta 的旧成员顺序不算非法，否则组内拖动保存刷新后会误判为非法）。
   * @param {*} rawGroups rig-meta.slotGroups（数组）
   * @param {Array<{name:string}>} slots state.slots（数组序 = z 序，0 最背）
   * @returns {Array<{id,gid,name,slots,slotIndices,order,minIndex,maxIndex,zLabel,size,partial}>}
   */
  function normalizeGroups(rawGroups, slots) {
    const list = Array.isArray(slots) ? slots : [];
    if (!Array.isArray(rawGroups) || !rawGroups.length || !list.length) return [];
    const indexOf = new Map();
    list.forEach((s, i) => {
      if (s && isStr(s.name) && !indexOf.has(s.name)) indexOf.set(s.name, i);
    });
    if (indexOf.size !== list.length) return []; /* model 自身有重名/空名槽 → 不可用 */
    const claimed = new Set();
    const usedIds = new Set();
    const usedNames = new Set();
    const out = [];
    let order = 0;
    for (const raw of rawGroups) {
      if (!isObject(raw)) return [];
      if (!isStr(raw.id) || !isStr(raw.name)) return [];
      if (usedIds.has(raw.id) || usedNames.has(raw.name)) return [];
      const names = Array.isArray(raw.slots) ? raw.slots : null;
      if (!names || !names.length) return [];
      const indices = [];
      const kept = [];
      for (const n of names) {
        if (!isStr(n)) return [];
        const idx = indexOf.get(n);
        if (idx === undefined) return []; /* 未知槽 */
        if (claimed.has(idx)) return []; /* 跨组或组内重复 */
        claimed.add(idx);
        indices.push(idx);
        kept.push(n);
      }
      const sorted = indices.slice().sort((a, b) => a - b);
      if (sorted[sorted.length - 1] - sorted[0] !== sorted.length - 1) return []; /* 不是连续 z 区间 */
      usedIds.add(raw.id);
      usedNames.add(raw.name);
      out.push({
        id: raw.id,
        gid: raw.id,
        name: raw.name,
        slots: kept.slice().sort((a, b) => indexOf.get(a) - indexOf.get(b)),
        slotIndices: sorted,
        order: order,
        minIndex: sorted[0],
        maxIndex: sorted[sorted.length - 1],
        zLabel: sorted[0] === sorted[sorted.length - 1] ? "z " + sorted[0] : "z " + sorted[0] + "–" + sorted[sorted.length - 1],
        size: sorted.length,
        partial: false,
      });
      order++;
    }
    if (claimed.size !== list.length) return []; /* 未全覆盖 */
    /* 组序：前 → 背，z 区间严格递减且不重叠 */
    for (let i = 1; i < out.length; i++) {
      if (!(out[i].maxIndex < out[i - 1].minIndex)) return [];
    }
    return out;
  }

  /** 槽下标 → 分组（找不到返回 null） */
  function groupOfIndex(groups, index) {
    if (!Array.isArray(groups)) return null;
    for (const g of groups) if (g.slotIndices.indexOf(index) >= 0) return g;
    return null;
  }

  /**
   * 分组契约校验：只有「覆盖完整 + 每组 z 连续 + 组序前→背单调不重叠」才允许走分组视图，
   * 否则调用方必须回退平铺 + 警告（Lead 裁定）。
   * @returns {{ok:boolean, reasons:string[]}}
   */
  function validateGroups(groups, slots) {
    const reasons = [];
    const list = Array.isArray(slots) ? slots : [];
    const gs = Array.isArray(groups) ? groups : [];
    if (!gs.length) return { ok: false, reasons: ["没有分组"] };
    if (!list.length) return { ok: false, reasons: ["模型没有槽"] };
    const seen = new Map();
    for (const g of gs) {
      if (g.partial) reasons.push("组「" + g.name + "」的槽不是连续 z 区间");
      for (const i of g.slotIndices) {
        if (i < 0 || i >= list.length) {
          reasons.push("组「" + g.name + "」含越界下标 " + i);
          continue;
        }
        if (seen.has(i)) reasons.push("槽 " + list[i].name + " 同时属于「" + seen.get(i) + "」与「" + g.name + "」");
        else seen.set(i, g.name);
      }
    }
    if (seen.size !== list.length) {
      const missing = [];
      for (let i = 0; i < list.length; i++) if (!seen.has(i)) missing.push(list[i] && list[i].name);
      reasons.push("有 " + missing.length + " 个槽未被任何组覆盖：" + missing.slice(0, 4).join("、"));
    }
    /* 组序：前 → 背，z 区间必须严格递减且不重叠 */
    let prevMin = Infinity;
    for (const g of gs) {
      if (g.maxIndex >= prevMin) {
        reasons.push("组序或 z 区间重叠：「" + g.name + "」(" + g.minIndex + "–" + g.maxIndex + ")");
        break;
      }
      prevMin = g.minIndex;
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  /**
   * 搜索过滤：只保留有命中的组，并按命中收缩组内槽（保持原顺序）。
   * @param {Array} groups normalizeGroups 的产物
   * @param {string} query 已 trim + 小写
   * @param {Function} hay (slotName, index) => string 小写检索串
   */
  function filterGroups(groups, query, hay) {
    const q = typeof query === "string" ? query.trim().toLowerCase() : "";
    const list = Array.isArray(groups) ? groups : [];
    if (!q) {
      return list.map((g) => ({
        gid: g.gid,
        name: g.name,
        zLabel: g.zLabel,
        group: g,
        slotNames: g.slots.slice(),
        slotIndices: g.slotIndices.slice(),
        total: g.size,
        hits: g.size,
        searching: false,
      }));
    }
    const out = [];
    for (const g of list) {
      const names = [];
      const indices = [];
      for (let i = 0; i < g.slots.length; i++) {
        const name = g.slots[i];
        const idx = g.slotIndices[i];
        const text = typeof hay === "function" ? hay(name, idx) : name;
        if (String(text == null ? "" : text).indexOf(q) >= 0) {
          names.push(name);
          indices.push(idx);
        }
      }
      if (!names.length) continue;
      out.push({
        gid: g.gid,
        name: g.name,
        zLabel: g.zLabel,
        group: g,
        slotNames: names,
        slotIndices: indices,
        total: g.size,
        hits: names.length,
        searching: true,
      });
    }
    return out;
  }

  /**
   * 分组视图下的拖拽合法性：只允许同一组内换位（不破坏连续 z 区间）。
   * @param {Array} groups
   * @param {number} fromIndex 被拖槽下标
   * @param {number|"top"|"bottom"|null} toIndex 落点槽下标；"top"/"bottom" 表示列表首/尾
   * @param {boolean} after 是否落在目标行下方（=更靠背）
   */
  function canDropInGroup(groups, fromIndex, toIndex, after) {
    if (!Array.isArray(groups) || !groups.length) return { ok: true, reason: "no-groups" };
    const from = groupOfIndex(groups, fromIndex);
    if (!from) return { ok: false, reason: "unknown-slot", message: "找不到该部件所属的分组" };
    if (toIndex === "top" || toIndex === "bottom" || toIndex === null || toIndex === undefined) {
      return {
        ok: false,
        reason: "outside-list",
        message: "分组视图下只能在组内调整显示顺序（不能拖到列表首/尾）",
      };
    }
    const to = groupOfIndex(groups, toIndex);
    if (!to) return { ok: false, reason: "unknown-target", message: "找不到目标部件所属的分组" };
    if (to.gid !== from.gid) {
      return {
        ok: false,
        reason: "cross-group",
        message: "分组视图下只能在组内调整显示顺序（" + from.name + " → " + to.name + " 已拒绝）",
      };
    }
    return { ok: true, reason: "same-group", group: from, message: "" };
  }

  /** 组内相邻块：把 [min,max] 之外的槽按下标分区（供调用方校验/提示） */
  function partitionByGroups(groups, indices) {
    const list = Array.isArray(indices) ? indices : [];
    const out = [];
    for (const g of Array.isArray(groups) ? groups : []) {
      const inside = [];
      for (const i of list) if (i >= g.minIndex && i <= g.maxIndex) inside.push(i);
      out.push({ gid: g.gid, name: g.name, indices: inside, minIndex: g.minIndex, maxIndex: g.maxIndex });
    }
    return out;
  }

  /** 是否有分组信息可用（供调用方决定是否走平铺 fallback） */
  function groupsAvailable(groups) {
    return Array.isArray(groups) && groups.length > 0;
  }

  /** 折叠状态：默认全展开；返回 Set<string> */
  function defaultCollapsed() {
    return new Set();
  }
  function isCollapsed(collapsed, gid) {
    return !!(collapsed && typeof collapsed.has === "function" && collapsed.has(gid));
  }

  const api = {
    API_VERSION: 1,

    normalizeGroups: normalizeGroups,
    validateGroups: validateGroups,
    groupsAvailable: groupsAvailable,
    groupOfIndex: groupOfIndex,
    filterGroups: filterGroups,
    canDropInGroup: canDropInGroup,
    partitionByGroups: partitionByGroups,

    computeGroupVis: computeGroupVis,
    approachGroupVis: approachGroupVis,

    defaultCollapsed: defaultCollapsed,
    isCollapsed: isCollapsed,

    slug: slug,
  };

  global.SpineSlotGroups = api;
  if (typeof window !== "undefined" && window.SpineSlotGroups !== api) window.SpineSlotGroups = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
