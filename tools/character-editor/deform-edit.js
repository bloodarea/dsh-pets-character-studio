/*
 * deform-edit.js —— 规划书 §4.5 Deform（形变）顶点编辑的**纯逻辑**层
 * 边界（与 track-edit / spine-core 一致）：
 *   本文件不碰 DOM、不写动画数据。只做三件事：
 *     1) 把 deform key 的扁平 `vertices` 数组解析成**可读的顶点表**（索引 + x/y）；
 *     2) 校验一次顶点编辑请求（下标、数值、是否加权网格）；
 *     3) 产出可直接交给 SpineTrackEdit.setDeformVertex / planKeyEdit 的**写入参数**。
 *   真正的写入仍由 track-edit 执行。
 *
 * 为什么单独拆：deform 的数据形状是 Spine 里最容易搞错的一处 ——
 *   - 普通网格：`vertices` 是 [dx0,dy0, dx1,dy1, ...]，长度 = 顶点数 × 2；
 *   - **加权网格**：`vertices` 是每顶点 3 个数 [boneCount, bone1, w1, bone2, w2, ...] 的**骨骼权重**，
 *     不是坐标！对它写 x/y 会把权重写坏（Spine 官方 SkeletonJson.ts:968-1005 对两者的处理完全不同）。
 *   把「这是哪种网格」的判断放进 DOM 代码，一旦判错就会静默写坏数据。
 */
(function (global) {
  "use strict";

  const API_VERSION = 1;
  const MAX_VERTICES = 20000; /* 单次解析上限，防病态数据把 UI 卡死 */

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function isFiniteNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function round(v, digits) {
    const p = Math.pow(10, digits == null ? 4 : digits);
    return Math.round(v * p) / p;
  }
  function issue(path, code, message) {
    return { path: String(path == null ? "" : path), code: code, message: String(message || code) };
  }

  /**
   * deform key 的顶点布局判定。
   * @param {{weighted?:boolean, vertices?:Array}} input
   * @returns {{ok:boolean, layout:'xy'|'weighted'|'unknown', vertexCount:number, stride:number, issues:Array}}
   *   layout='xy'       → 每顶点 2 个数（x,y 偏移），可编辑坐标
   *   layout='weighted' → 加权网格，vertices 是骨骼权重，**不可按坐标编辑**
   */
  function layoutOf(input) {
    const inp = isObject(input) ? input : {};
    const verts = Array.isArray(inp.vertices) ? inp.vertices : null;
    if (!verts) {
      return { ok: false, layout: "unknown", vertexCount: 0, stride: 0, issues: [issue("vertices", "DEFORM_VERTICES_MISSING", "vertices 必须是数组")] };
    }
    if (inp.weighted === true) {
      /* 加权网格：解析骨骼数只能给出"至少"信息，不给坐标表 */
      return { ok: true, layout: "weighted", vertexCount: 0, stride: 0, issues: [] };
    }
    if (verts.length % 2 !== 0) {
      return {
        ok: false, layout: "unknown", vertexCount: 0, stride: 2,
        issues: [issue("vertices", "DEFORM_VERTICES_ODD", "普通网格的 vertices 长度必须是偶数（x,y 成对），实际 " + verts.length)],
      };
    }
    return { ok: true, layout: "xy", vertexCount: verts.length / 2, stride: 2, issues: [] };
  }

  /**
   * 解析成顶点表（只对 layout='xy' 有意义）。
   * @returns {{ok:boolean, layout:string, vertices:Array<{index:number,x:number,y:number}>, count:number, issues:Array}}
   */
  function parseVertices(input) {
    const lay = layoutOf(input);
    if (!lay.ok) return { ok: false, layout: lay.layout, vertices: [], count: 0, issues: lay.issues };
    if (lay.layout !== "xy") {
      return {
        ok: false, layout: lay.layout, vertices: [], count: 0,
        issues: [issue("vertices", "DEFORM_WEIGHTED_NOT_COORDS", "这是加权网格：vertices 存的是骨骼权重而不是坐标，不能按顶点坐标编辑")],
      };
    }
    const verts = input.vertices;
    const out = [];
    const limit = Math.min(lay.vertexCount, MAX_VERTICES);
    for (let i = 0; i < limit; i++) {
      const x = verts[i * 2];
      const y = verts[i * 2 + 1];
      if (!isFiniteNum(x) || !isFiniteNum(y)) {
        return {
          ok: false, layout: "xy", vertices: [], count: 0,
          issues: [issue("vertices[" + i + "]", "DEFORM_VERTEX_NOT_NUMBER", "顶点 " + i + " 的坐标不是有限数")],
        };
      }
      out.push({ index: i, x: round(x, 4), y: round(y, 4) });
    }
    const issues = [];
    if (lay.vertexCount > MAX_VERTICES) {
      issues.push(issue("vertices", "DEFORM_VERTICES_TRUNCATED", "顶点数 " + lay.vertexCount + " 超过上限 " + MAX_VERTICES + "，只解析前 " + MAX_VERTICES + " 个"));
    }
    return { ok: true, layout: "xy", vertices: out, count: lay.vertexCount, truncated: lay.vertexCount > MAX_VERTICES, issues: issues };
  }

  /**
   * 校验一次顶点编辑请求。
   * @param {{layout:string, vertexCount:number, index:number, x:number, y:number, offsetLength?:number}} input
   * @returns {{ok:boolean, issues:Array}}
   */
  function checkVertexEdit(input) {
    const inp = isObject(input) ? input : {};
    const issues = [];
    if (inp.layout === "weighted") {
      issues.push(issue("layout", "DEFORM_WEIGHTED_READONLY", "加权网格的顶点由骨骼权重驱动，不支持按坐标编辑（请改骨骼变换）"));
      return { ok: false, issues: issues };
    }
    if (inp.layout !== "xy") {
      issues.push(issue("layout", "DEFORM_LAYOUT_UNKNOWN", "顶点布局未知，拒绝编辑"));
      return { ok: false, issues: issues };
    }
    if (!isFiniteNum(inp.index) || inp.index < 0 || !Number.isInteger(inp.index)) {
      issues.push(issue("index", "DEFORM_INDEX_INVALID", "顶点下标必须是非负整数"));
    } else {
      /* 上界优先用 offsetLength/2（真实网格容量），没有再退回 vertexCount */
      const cap = isFiniteNum(inp.offsetLength) && inp.offsetLength > 0 ? Math.floor(inp.offsetLength / 2) : inp.vertexCount;
      if (isFiniteNum(cap) && cap > 0 && inp.index >= cap) {
        issues.push(issue("index", "DEFORM_INDEX_RANGE", "顶点下标 " + inp.index + " 越界（共 " + cap + " 个顶点）"));
      }
    }
    if (!isFiniteNum(inp.x) || !isFiniteNum(inp.y)) {
      issues.push(issue("value", "DEFORM_VALUE_INVALID", "x/y 必须是有限数"));
    }
    return { ok: issues.length === 0, issues: issues };
  }

  /**
   * 生成写入参数（直接喂 SpineTrackEdit.setDeformVertex）。
   * @param {{slot:string, attachment:string|null, legacy?:boolean, time:number, index:number, x:number, y:number}} input
   * @returns {{ok:boolean, opts:object|null, issues:Array}}
   */
  function buildSetVertexArgs(input) {
    const inp = isObject(input) ? input : {};
    const issues = [];
    if (typeof inp.slot !== "string" || !inp.slot) issues.push(issue("slot", "DEFORM_SLOT_MISSING", "缺少槽名"));
    if (!isFiniteNum(inp.time) || inp.time < 0) issues.push(issue("time", "DEFORM_TIME_INVALID", "时间必须是非负有限数"));
    if (!isFiniteNum(inp.index) || inp.index < 0) issues.push(issue("index", "DEFORM_INDEX_INVALID", "顶点下标必须是非负整数"));
    if (!isFiniteNum(inp.x) || !isFiniteNum(inp.y)) issues.push(issue("value", "DEFORM_VALUE_INVALID", "x/y 必须是有限数"));
    if (issues.length) return { ok: false, opts: null, issues: issues };
    return {
      ok: true,
      opts: {
        slot: inp.slot,
        attachment: inp.legacy === true ? null : inp.attachment || null,
        legacy: inp.legacy === true,
        time: inp.time,
        index: inp.index,
        x: inp.x,
        y: inp.y,
        model: inp.model || null,
        skin: inp.skin,
        create: inp.create !== false,
      },
      issues: [],
    };
  }

  /**
   * 一次编辑多个顶点（批量）：先整体校验，全部通过才产出参数数组。
   * 「部分应用」是明确禁止的 —— 半套顶点数据比不改更糟。
   * @param {{layout:string, vertexCount:number, offsetLength?:number, edits:Array<{index,x,y}>, slot, attachment, legacy?, time, model?, skin?, create?}} input
   */
  function buildBatchVertexArgs(input) {
    const inp = isObject(input) ? input : {};
    const edits = Array.isArray(inp.edits) ? inp.edits : [];
    if (!edits.length) return { ok: false, args: [], issues: [issue("edits", "DEFORM_EDITS_EMPTY", "没有要修改的顶点")] };
    const all = [];
    const args = [];
    for (let i = 0; i < edits.length; i++) {
      const e = edits[i];
      const chk = checkVertexEdit({
        layout: inp.layout, vertexCount: inp.vertexCount, offsetLength: inp.offsetLength,
        index: e && e.index, x: e && e.x, y: e && e.y,
      });
      if (!chk.ok) {
        for (const it of chk.issues) all.push(issue("edits[" + i + "]." + it.path, it.code, it.message));
        continue;
      }
      const built = buildSetVertexArgs({
        slot: inp.slot, attachment: inp.attachment, legacy: inp.legacy, time: inp.time,
        index: e.index, x: e.x, y: e.y, model: inp.model, skin: inp.skin, create: inp.create,
      });
      if (!built.ok) {
        for (const it of built.issues) all.push(issue("edits[" + i + "]." + it.path, it.code, it.message));
        continue;
      }
      args.push(built.opts);
    }
    if (all.length) return { ok: false, args: [], issues: all };
    return { ok: true, args: args, issues: [] };
  }

  /** 摘要文本（状态栏用） */
  function summaryLine(input) {
    const inp = isObject(input) ? input : {};
    const lay = inp.layout;
    if (lay === "weighted") return "加权网格：顶点由骨骼权重驱动，只读";
    if (lay !== "xy") return "顶点布局未知";
    const n = isFiniteNum(inp.vertexCount) ? inp.vertexCount : 0;
    const changed = isFiniteNum(inp.changedCount) ? inp.changedCount : 0;
    return n + " 个顶点" + (changed ? "，本次改 " + changed + " 个" : "");
  }

  const api = {
    API_VERSION: API_VERSION,
    MAX_VERTICES: MAX_VERTICES,
    layoutOf: layoutOf,
    parseVertices: parseVertices,
    checkVertexEdit: checkVertexEdit,
    buildSetVertexArgs: buildSetVertexArgs,
    buildBatchVertexArgs: buildBatchVertexArgs,
    summaryLine: summaryLine,
  };

  global.SpineDeformEdit = api;
  if (typeof window !== "undefined" && window.SpineDeformEdit !== api) window.SpineDeformEdit = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
