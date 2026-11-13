/*
 * batch-edit.js —— 多选 / 批量移动 / 粘贴 / 删除的**纯规划模块**（T22）
 *
 * 边界：不碰 DOM / fetch / 动画全局状态。浏览器暴露 window.SpineBatchEdit，Node 里是 globalThis.SpineBatchEdit。
 * 契约依据：design/editor-p1-contract.md §3（多选/批量/事务）与 §4（复制/粘贴/删除/duration）。
 *
 * 设计要点：
 *   - 选择 identity 用结构化 `{kind, owner, field, time}`（**不拼 'kind:owner:field' 字符串反推**，名称可含冒号）；
 *     `rowKeyOf` 只用于 lockedRows 兼容与显示。
 *   - `planKeyBatch` 是一次性规划：深克隆 → 整批预检 → 一次写回；任何一项失败都零改动（value=null）。
 *   - move：全组同一个 delta（不逐 Key 吸附）；delta 夹到不早于 0；先移除整批原 Key 再对结果预检冲突，
 *     因此允许 A 移到已选 B 的旧时刻；与**未选** Key 同轨 ±1e-4 碰撞则整批拒绝。
 *   - paste：默认同轨同刻**覆盖**（源字段优先、目标未知扩展保留、源无 curve 则显式删除目标 curve）；
 *     跨动画仅同骨架签名；碰撞歧义（±eps 内匹配到多个）整批拒绝；曲线段的 cx 随粘贴整体平移。
 *   - delete：只删选中 Key，保留空数组与未知 bag 字段；duration 可真实变短。
 *   - 曲线保护（契约 §3/§4）：曲线段 Key 不能被移动/删除；其端点被移动/删除/覆盖，或移动/粘贴插入到段内，
 *     导致其它段重联 → `ANIM_CURVE_EDIT_UNSUPPORTED`，整批零改动。
 */
(function (global) {
  "use strict";

  const CLIPBOARD_VERSION = 1;
  const COLLISION_EPS = 1e-4; // 同轨同刻容差（契约 §3）
  const TIME_EPS = 1e-6;

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function isFiniteNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }
  function f32(v) {
    return typeof Math.fround === "function" ? Math.fround(v) : v;
  }
  function issue(code, detail, extra) {
    const out = { code: code, detail: detail === undefined ? code : String(detail) };
    if (extra) for (const k of Object.keys(extra)) out[k] = extra[k];
    return out;
  }
  function fail(code, detail, extra) {
    return { ok: false, value: null, selectionAfter: [], changedPaths: [], duration: null, issues: [issue(code, detail, extra)] };
  }
  function rowKeyOf(kind, owner, field) {
    return String(kind) + ":" + String(owner) + ":" + String(field);
  }
  function pathOf(kind, owner, field) {
    const prefix = kind === "bone" ? "bones." : kind === "slot" ? "slots." : "";
    return prefix + String(owner) + "." + String(field);
  }
  function keyHasCurve(key) {
    return !!(isObject(key) && Array.isArray(key.curve) && key.curve.length > 0);
  }
  function sameIdentity(a, b) {
    return a && b && a.kind === b.kind && a.owner === b.owner && a.field === b.field && Math.abs(a.time - b.time) <= TIME_EPS;
  }
  function uniqPaths(list) {
    const out = [];
    for (const p of list) if (out.indexOf(p) < 0) out.push(p);
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 轨道寻址（与 timeline.buildRows 的 kind/owner/field 约定一致）
   * ------------------------------------------------------------------ */
  /**
   * @returns {{ok:true, keys:Array, container:object, fieldName:string}|{ok:false, code:string}}
   *   bone  → anim.bones[owner][field]
   *   slot  → anim.slots[owner][field]
   *   timeline → 顶层键 owner：数组（field===owner）或 anim[owner][field] / anim[owner][a][b]
   *   其它 / 不存在 → UNKNOWN_TRACK（不猜、不补造）
   */
  function resolveTrack(anim, kind, owner, field) {
    if (!isObject(anim)) return { ok: false, code: "ANIM_INVALID" };
    if (kind === "bone" || kind === "slot") {
      const bagName = kind === "bone" ? "bones" : "slots";
      const bag = anim[bagName] && anim[bagName][owner];
      if (!isObject(bag) || !Array.isArray(bag[field])) return { ok: false, code: "UNKNOWN_TRACK" };
      return { ok: true, keys: bag[field], container: bag, fieldName: field };
    }
    if (kind === "timeline") {
      const top = anim[owner];
      if (Array.isArray(top) && field === owner) return { ok: true, keys: top, container: anim, fieldName: owner };
      if (isObject(top)) {
        if (Array.isArray(top[field])) return { ok: true, keys: top[field], container: top, fieldName: field };
        const parts = String(field).split(".");
        if (parts.length === 2 && isObject(top[parts[0]]) && Array.isArray(top[parts[0]][parts[1]])) {
          return { ok: true, keys: top[parts[0]][parts[1]], container: top[parts[0]], fieldName: parts[1] };
        }
      }
      return { ok: false, code: "UNKNOWN_TRACK" };
    }
    return { ok: false, code: "UNKNOWN_TRACK" };
  }

  /** 选择集规范化：接受数组或 {items:[...]}；identity 结构化；去重 */
  function normalizeSelection(selection) {
    const items = Array.isArray(selection) ? selection : isObject(selection) && Array.isArray(selection.items) ? selection.items : null;
    if (!items) return { ok: false, code: "SELECTION_INVALID", detail: "selection 必须是数组或 {items:[]}" };
    if (!items.length) return { ok: false, code: "EMPTY_SELECTION", detail: "选择为空" };
    const out = [];
    for (const it of items) {
      if (!isObject(it)) return { ok: false, code: "SELECTION_INVALID", detail: "item 不是对象" };
      if (typeof it.kind !== "string" || typeof it.owner !== "string" || typeof it.field !== "string") {
        return { ok: false, code: "SELECTION_INVALID", detail: "item 缺 kind/owner/field" };
      }
      if (!isFiniteNum(it.time)) return { ok: false, code: "SELECTION_INVALID", detail: "item.time 非有限数" };
      const norm = { kind: it.kind, owner: it.owner, field: it.field, time: it.time };
      if (!out.some(function (u) { return sameIdentity(u, norm); })) out.push(norm);
    }
    return { ok: true, items: out };
  }

  function keySetOf(value) {
    const set = new Set();
    if (value instanceof Set) {
      value.forEach(function (v) { set.add(String(v)); });
      return set;
    }
    if (Array.isArray(value)) {
      for (const v of value) set.add(typeof v === "string" ? v : isObject(v) ? rowKeyOf(v.kind, v.owner, v.field) : String(v));
      return set;
    }
    if (isObject(value)) {
      for (const k of Object.keys(value)) if (value[k]) set.add(String(k));
      return set;
    }
    return set;
  }

  /** 按轨道分组选择项并定位下标；任一轨道解析失败/选中 Key 不存在 → 整批失败 */
  function gather(rawAnim, items, lockedRows) {
    const locked = keySetOf(lockedRows);
    const groups = new Map();
    for (const it of items) {
      const tk = rowKeyOf(it.kind, it.owner, it.field);
      if (locked.has(tk)) return { ok: false, code: "LOCKED_ROW", detail: tk + " 已锁定" };
      let g = groups.get(tk);
      if (!g) {
        const r = resolveTrack(rawAnim, it.kind, it.owner, it.field);
        if (!r.ok) return { ok: false, code: r.code, detail: tk };
        g = { key: tk, kind: it.kind, owner: it.owner, field: it.field, keys: r.keys, selIdx: new Set(), items: [] };
        groups.set(tk, g);
      }
      let idx = -1;
      for (let i = 0; i < (Array.isArray(g.keys) ? g.keys.length : 0); i++) {
        if (isObject(g.keys[i]) && isFiniteNum(g.keys[i].time) && Math.abs(g.keys[i].time - it.time) <= TIME_EPS) {
          idx = i;
          break;
        }
      }
      if (idx < 0) return { ok: false, code: "SELECTED_KEY_NOT_FOUND", detail: tk + "@" + it.time };
      g.selIdx.add(idx);
      g.items.push(Object.assign({}, it, { index: idx }));
    }
    return { ok: true, groups: groups };
  }

  function f32CollapseOk(sortedKeys) {
    for (let i = 1; i < sortedKeys.length; i++) {
      if (f32(sortedKeys[i].time) === f32(sortedKeys[i - 1].time) && Math.abs(sortedKeys[i].time - sortedKeys[i - 1].time) > TIME_EPS) return false;
    }
    return true;
  }
  function sortAndCheck(keys) {
    const sorted = keys.slice().sort(function (a, b) {
      return (isFiniteNum(a.time) ? a.time : 0) - (isFiniteNum(b.time) ? b.time : 0);
    });
    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(sorted[i].time - sorted[i - 1].time) <= TIME_EPS) return { ok: false, code: "TIME_DUPLICATE", detail: sorted[i].time };
    }
    if (!f32CollapseOk(sorted)) return { ok: false, code: "F32_TIME_COLLAPSE", detail: "两个不同时间在 float32 下塌缩" };
    return { ok: true, keys: sorted };
  }

  /* ------------------------------------------------------------------ *
   * duration
   * ------------------------------------------------------------------ */
  function scanDuration(anim) {
    const AE = global.SpineAnimEdit;
    if (AE && typeof AE.animDurationOf === "function") return AE.animDurationOf(anim);
    let max = 0;
    const bump = function (t) {
      if (isFiniteNum(t) && t > max) max = t;
    };
    const deep = function (v) {
      if (Array.isArray(v)) {
        for (const item of v) {
          if (isObject(item) && isFiniteNum(item.time)) bump(item.time);
          else if (isObject(item) || Array.isArray(item)) deep(item);
        }
        return;
      }
      if (isObject(v)) for (const k of Object.keys(v)) if (isObject(v[k]) || Array.isArray(v[k])) deep(v[k]);
    };
    const bag = function (b) {
      if (!isObject(b)) return;
      for (const f of Object.keys(b)) if (Array.isArray(b[f])) for (const k of b[f]) if (isObject(k)) bump(k.time);
    };
    if (!isObject(anim)) return 0;
    if (isObject(anim.bones)) for (const n of Object.keys(anim.bones)) bag(anim.bones[n]);
    if (isObject(anim.slots)) for (const n of Object.keys(anim.slots)) bag(anim.slots[n]);
    if (Array.isArray(anim.drawOrder)) for (const k of anim.drawOrder) if (isObject(k)) bump(k.time);
    for (const k of Object.keys(anim)) {
      if (k === "bones" || k === "slots" || k === "drawOrder") continue;
      if (isObject(anim[k]) || Array.isArray(anim[k])) deep(anim[k]);
    }
    return max;
  }

  /* ------------------------------------------------------------------ *
   * 剪贴板
   * ------------------------------------------------------------------ */
  /**
   * 由选择集生成剪贴板（深克隆源 Key；不写模型、不改入参）。
   * @param {object} rawAnim 源动画
   * @param {Array|{items:Array}} selection
   * @param {{sourceAnimation?:string, skeletonSignature?:string}} [opts]
   */
  function clipboardFromSelection(rawAnim, selection, opts) {
    const o = isObject(opts) ? opts : {};
    const sel = normalizeSelection(selection);
    if (!sel.ok) return { ok: false, value: null, issues: [issue(sel.code, sel.detail)] };
    const g = gather(rawAnim, sel.items, null);
    if (!g.ok) return { ok: false, value: null, issues: [issue(g.code, g.detail)] };
    const originTime = Math.min.apply(null, sel.items.map(function (i) { return i.time; }));
    const items = [];
    for (const it of sel.items) {
      const r = resolveTrack(rawAnim, it.kind, it.owner, it.field);
      let rawKey = null;
      for (const k of r.keys) if (isObject(k) && isFiniteNum(k.time) && Math.abs(k.time - it.time) <= TIME_EPS) rawKey = k;
      if (!rawKey) return { ok: false, value: null, issues: [issue("SELECTED_KEY_NOT_FOUND", rowKeyOf(it.kind, it.owner, it.field))] };
      /* 源后继是否也在选择里（曲线闭合判断用） */
      const sorted = r.keys.filter(function (k) { return isObject(k) && isFiniteNum(k.time); }).sort(function (a, b) { return a.time - b.time; });
      const pos = sorted.findIndex(function (k) { return Math.abs(k.time - it.time) <= TIME_EPS; });
      const succ = pos >= 0 && pos + 1 < sorted.length ? sorted[pos + 1] : null;
      const succSelected = succ ? sel.items.some(function (s) { return rowKeyOf(s.kind, s.owner, s.field) === rowKeyOf(it.kind, it.owner, it.field) && Math.abs(s.time - succ.time) <= TIME_EPS; }) : false;
      const item = {
        kind: it.kind,
        owner: it.owner,
        field: it.field,
        offset: it.time - originTime,
        rawKey: clone(rawKey),
      };
      if (succSelected) item.nextSourceTime = succ.time;
      items.push(item);
    }
    const value = {
      version: CLIPBOARD_VERSION,
      skeletonSignature: typeof o.skeletonSignature === "string" ? o.skeletonSignature : null,
      sourceAnimation: typeof o.sourceAnimation === "string" ? o.sourceAnimation : null,
      originTime: originTime,
      items: items,
    };
    return { ok: true, value: value, issues: [] };
  }

  /**
   * 校验剪贴板结构（只报不改）。
   * @param {object} cb
   * @param {{skeletonSignature?:string, requireSignature?:boolean, owners?:string[]}} [opts]
   */
  function validateClipboard(cb, opts) {
    const o = isObject(opts) ? opts : {};
    const issues = [];
    if (!isObject(cb)) return { ok: false, issues: [issue("CLIPBOARD_INVALID", "剪贴板不是对象")] };
    if (cb.version !== CLIPBOARD_VERSION) issues.push(issue("CLIPBOARD_VERSION", "版本 " + JSON.stringify(cb.version) + " ≠ " + CLIPBOARD_VERSION));
    if (!isFiniteNum(cb.originTime)) issues.push(issue("CLIPBOARD_ORIGIN", "originTime 非有限数"));
    if (!Array.isArray(cb.items) || !cb.items.length) issues.push(issue("CLIPBOARD_EMPTY", "items 为空"));
    if (Array.isArray(cb.items)) {
      for (let i = 0; i < cb.items.length; i++) {
        const it = cb.items[i];
        const p = "items[" + i + "]";
        if (!isObject(it)) {
          issues.push(issue("CLIPBOARD_ITEM", p + " 不是对象"));
          continue;
        }
        if (typeof it.kind !== "string" || typeof it.owner !== "string" || typeof it.field !== "string") issues.push(issue("CLIPBOARD_ITEM", p + " 缺 kind/owner/field"));
        if (!isFiniteNum(it.offset) || it.offset < -TIME_EPS) issues.push(issue("CLIPBOARD_ITEM", p + ".offset 非法"));
        if (!isObject(it.rawKey) || !isFiniteNum(it.rawKey.time)) {
          issues.push(issue("CLIPBOARD_ITEM", p + ".rawKey 缺 time"));
          continue;
        }
        if (isFiniteNum(cb.originTime) && isFiniteNum(it.offset) && Math.abs(it.rawKey.time - (cb.originTime + it.offset)) > 1e-3) {
          issues.push(issue("CLIPBOARD_ITEM", p + ".rawKey.time 与 originTime+offset 不一致"));
        }
      }
    }
    if (o.requireSignature !== false && typeof o.skeletonSignature === "string") {
      if (typeof cb.skeletonSignature !== "string" || cb.skeletonSignature !== o.skeletonSignature) {
        issues.push(issue("CLIPBOARD_SIGNATURE", "骨架签名不一致（源 " + String(cb.skeletonSignature) + " / 目标 " + o.skeletonSignature + "）"));
      }
    }
    if (Array.isArray(o.owners)) {
      for (const it of cb.items || []) {
        if (isObject(it) && o.owners.indexOf(it.owner) < 0) issues.push(issue("CLIPBOARD_UNKNOWN_OWNER", String(it.owner)));
      }
    }
    return { ok: issues.length === 0, issues: issues };
  }

  /* ------------------------------------------------------------------ *
   * 规划：move / paste / delete
   * ------------------------------------------------------------------ */
  function planMove(rawAnim, o) {
    const sel = normalizeSelection(o.selection);
    if (!sel.ok) return fail(sel.code, sel.detail);
    const g = gather(rawAnim, sel.items, o.lockedRows);
    if (!g.ok) return fail(g.code, g.detail);
    if (!isFiniteNum(o.delta)) return fail("DELTA_INVALID", "delta 非有限数");
    let delta = o.delta;
    const minTime = Math.min.apply(null, sel.items.map(function (i) { return i.time; }));
    let clamped = false;
    if (minTime + delta < -TIME_EPS) {
      delta = -minTime;
      clamped = true;
    }
    /* 曲线保护（契约 §3：任一曲线邻接保护失败 → 整批零改动） */
    for (const grp of g.groups.values()) {
      for (let i = 0; i < grp.keys.length; i++) {
        if (!keyHasCurve(grp.keys[i])) continue;
        if (grp.selIdx.has(i)) return fail("ANIM_CURVE_EDIT_UNSUPPORTED", "曲线段 Key 不能重定时：" + grp.key);
        const succIdx = i + 1;
        if (succIdx < grp.keys.length && grp.selIdx.has(succIdx)) return fail("ANIM_CURVE_EDIT_UNSUPPORTED", "曲线段末端被移动：" + grp.key);
        const lo = grp.keys[i].time + TIME_EPS;
        const hi = succIdx < grp.keys.length ? grp.keys[succIdx].time - TIME_EPS : Infinity;
        for (const it of grp.items) {
          const nt = it.time + delta;
          if (nt > lo && nt < hi) return fail("ANIM_CURVE_EDIT_UNSUPPORTED", "移动 Key 落入曲线段内：" + grp.key);
        }
      }
    }
    const plans = [];
    for (const grp of g.groups.values()) {
      const kept = [];
      const moved = [];
      for (let i = 0; i < grp.keys.length; i++) {
        if (grp.selIdx.has(i)) {
          const t = grp.keys[i].time + delta;
          if (!isFiniteNum(t)) return fail("TIME_INVALID", grp.key);
          moved.push(Object.assign({}, clone(grp.keys[i]), { time: t }));
        } else {
          kept.push(clone(grp.keys[i]));
        }
      }
      for (const m of moved) {
        for (const k of kept) {
          if (isFiniteNum(k.time) && Math.abs(k.time - m.time) <= COLLISION_EPS) {
            return fail("COLLISION", grp.key + " 与未选 Key 同刻碰撞 @" + m.time);
          }
        }
      }
      const checked = sortAndCheck(kept.concat(moved));
      if (!checked.ok) return fail(checked.code, grp.key + " " + checked.detail);
      plans.push({ group: grp, keys: checked.keys, moved: moved });
    }
    const out = clone(rawAnim);
    const changedPaths = [];
    for (const p of plans) {
      const t = resolveTrack(out, p.group.kind, p.group.owner, p.group.field);
      t.container[t.fieldName] = p.keys;
      changedPaths.push(pathOf(p.group.kind, p.group.owner, p.group.field));
    }
    return {
      ok: true,
      value: out,
      selectionAfter: sel.items.map(function (it) { return { kind: it.kind, owner: it.owner, field: it.field, time: it.time + delta }; }),
      changedPaths: uniqPaths(changedPaths),
      duration: scanDuration(out),
      issues: [],
      counts: {
        moved: sel.items.length,
        added: 0,
        overwritten: 0,
        deleted: 0,
        delta: delta,
        clampedToZero: clamped,
      },
    };
  }

  function planDelete(rawAnim, o) {
    const sel = normalizeSelection(o.selection);
    if (!sel.ok) return fail(sel.code, sel.detail);
    const g = gather(rawAnim, sel.items, o.lockedRows);
    if (!g.ok) return fail(g.code, g.detail);
    for (const grp of g.groups.values()) {
      for (let i = 0; i < grp.keys.length; i++) {
        if (!keyHasCurve(grp.keys[i])) continue;
        if (grp.selIdx.has(i)) return fail("ANIM_CURVE_EDIT_UNSUPPORTED", "曲线段 Key 不能删除：" + grp.key);
        if (i + 1 < grp.keys.length && grp.selIdx.has(i + 1)) return fail("ANIM_CURVE_EDIT_UNSUPPORTED", "删除会移除曲线段端点：" + grp.key);
      }
    }
    const out = clone(rawAnim);
    const changedPaths = [];
    let deleted = 0;
    for (const grp of g.groups.values()) {
      const kept = [];
      for (let i = 0; i < grp.keys.length; i++) {
        if (grp.selIdx.has(i)) {
          deleted++;
          continue;
        }
        kept.push(clone(grp.keys[i]));
      }
      const t = resolveTrack(out, grp.kind, grp.owner, grp.field);
      t.container[t.fieldName] = kept; // 空数组保留（不删字段、不动未知 bag）
      changedPaths.push(pathOf(grp.kind, grp.owner, grp.field));
    }
    return {
      ok: true,
      value: out,
      selectionAfter: [],
      changedPaths: uniqPaths(changedPaths),
      duration: scanDuration(out),
      issues: [],
      counts: { moved: 0, added: 0, overwritten: 0, deleted: deleted },
    };
  }

  function planPaste(rawAnim, o) {
    const cb = o.clipboard;
    const v = validateClipboard(cb, {
      skeletonSignature: o.skeletonSignature,
      requireSignature: o.requireSignature,
      owners: o.owners,
    });
    if (!v.ok) return fail(v.issues[0].code, v.issues[0].detail);
    const atTime = isFiniteNum(o.atTime) ? o.atTime : 0;
    let anchor = atTime;
    if (isObject(o.snap) && o.snap.enabled === true && isFiniteNum(o.snap.fps) && o.snap.fps > 0) {
      anchor = Math.round(atTime * o.snap.fps) / o.snap.fps; // 只吸附锚点一次
    }
    if (anchor < -TIME_EPS) return fail("PASTE_NEGATIVE_TIME", "锚点早于 0");
    const overwrite = o.collision !== "reject";
    /* 目标轨道解析 + 锁定检查 */
    const groups = new Map();
    for (const it of cb.items) {
      const tk = rowKeyOf(it.kind, it.owner, it.field);
      let grp = groups.get(tk);
      if (!grp) {
        const r = resolveTrack(rawAnim, it.kind, it.owner, it.field);
        if (!r.ok) return fail(r.code, tk);
        grp = { key: tk, kind: it.kind, owner: it.owner, field: it.field, keys: r.keys, items: [] };
        groups.set(tk, grp);
      }
      grp.items.push(it);
    }
    const locked = keySetOf(o.lockedRows);
    for (const grp of groups.values()) if (locked.has(grp.key)) return fail("LOCKED_ROW", grp.key + " 已锁定（粘贴整批拒绝）");

    const plans = [];
    let added = 0;
    let overwritten = 0;
    for (const grp of groups.values()) {
      const dest = grp.keys.filter(function (k) { return isObject(k); }).map(function (k) { return clone(k); });
      const pasted = [];
      const pastedIds = []; // 粘贴结果（含覆盖），用于 selectionAfter
      const overwrittenIdx = new Set();
      for (const it of grp.items) {
        const targetTime = anchor + it.offset;
        if (!isFiniteNum(targetTime) || targetTime < -TIME_EPS) return fail("PASTE_NEGATIVE_TIME", grp.key + " @" + targetTime);
        const matches = [];
        for (let i = 0; i < dest.length; i++) {
          if (isFiniteNum(dest[i].time) && Math.abs(dest[i].time - targetTime) <= COLLISION_EPS) matches.push(i);
        }
        if (matches.length > 1) return fail("AMBIGUOUS_TARGET", grp.key + " @" + targetTime + " 匹配到 " + matches.length + " 个目标 Key");
        const src = clone(it.rawKey);
        const shifted = shiftCurveTimes(src, anchor - cb.originTime);
        if (matches.length === 1) {
          if (!overwrite) return fail("COLLISION", grp.key + " @" + targetTime);
          const merged = mergeKey(dest[matches[0]], shifted);
          merged.time = targetTime;
          dest[matches[0]] = merged;
          overwrittenIdx.add(matches[0]);
          overwritten++;
          pastedIds.push({ time: targetTime });
        } else {
          const inserted = Object.assign({}, shifted, { time: targetTime });
          pasted.push(inserted);
          pastedIds.push({ time: targetTime });
          added++;
        }
      }
      /* 目标侧曲线保护：未被动过的曲线段，其端点必须保持不变 */
      for (let i = 0; i < grp.keys.length; i++) {
        const before = grp.keys[i];
        if (!keyHasCurve(before)) continue;
        if (overwrittenIdx.has(i)) continue; // 覆盖该 Key 本身 = 用户显式替换该段（契约 §4：源无 curve 则删目标 curve）
        const succ = i + 1 < grp.keys.length ? grp.keys[i + 1] : null;
        if (!succ) continue;
        const succOverwritten = overwrittenIdx.has(i + 1);
        const between = pasted.some(function (p) {
          return p.time > before.time + TIME_EPS && p.time < succ.time - TIME_EPS;
        });
        const succReplaced = dest.some(function (k, di) {
          return overwrittenIdx.has(di) && isFiniteNum(k.time) && Math.abs(k.time - succ.time) <= COLLISION_EPS;
        });
        if (succOverwritten || succReplaced || between) {
          return fail("ANIM_CURVE_EDIT_UNSUPPORTED", "粘贴会改变既有曲线段邻接：" + grp.key);
        }
      }
      /* 源侧曲线保护：带 curve 的源 Key 需要其后继也被复制且粘贴后仍直接相邻 */
      for (const it of grp.items) {
        if (!keyHasCurve(it.rawKey)) continue;
        if (!isFiniteNum(it.nextSourceTime)) return fail("ANIM_CURVE_EDIT_UNSUPPORTED", "曲线段缺少后继端点（不完整片段）：" + grp.key);
        const succOffset = it.nextSourceTime - cb.originTime;
        const succItem = grp.items.some(function (x) { return Math.abs(x.offset - succOffset) <= TIME_EPS; });
        if (!succItem) return fail("ANIM_CURVE_EDIT_UNSUPPORTED", "曲线段后继未被复制：" + grp.key);
        const t1 = anchor + it.offset;
        const t2 = anchor + succOffset;
        const between = dest
          .concat(pasted)
          .some(function (k) { return isFiniteNum(k.time) && k.time > t1 + TIME_EPS && k.time < t2 - TIME_EPS; });
        if (between) return fail("ANIM_CURVE_EDIT_UNSUPPORTED", "粘贴后曲线段两端不再相邻：" + grp.key);
      }
      const checked = sortAndCheck(dest.concat(pasted));
      if (!checked.ok) return fail(checked.code, grp.key + " " + checked.detail);
      plans.push({ group: grp, keys: checked.keys, pasted: pasted, pastedIds: pastedIds });
    }
    const out = clone(rawAnim);
    const changedPaths = [];
    const selectionAfter = [];
    for (const p of plans) {
      const t = resolveTrack(out, p.group.kind, p.group.owner, p.group.field);
      t.container[t.fieldName] = p.keys;
      changedPaths.push(pathOf(p.group.kind, p.group.owner, p.group.field));
      for (const k of p.pastedIds) selectionAfter.push({ kind: p.group.kind, owner: p.group.owner, field: p.group.field, time: k.time });
    }
    return {
      ok: true,
      value: out,
      selectionAfter: selectionAfter,
      changedPaths: uniqPaths(changedPaths),
      duration: scanDuration(out),
      issues: [],
      counts: { moved: 0, added: added, overwritten: overwritten, deleted: 0, anchor: anchor },
    };
  }

  /** 曲线的时间控制点随粘贴整体平移（cy 与数值不变）；非数组 curve 原样 */
  function shiftCurveTimes(rawKey, shift) {
    const out = clone(rawKey);
    if (!Array.isArray(out.curve)) return out;
    const curves = out.curve.slice();
    for (let i = 0; i + 3 < curves.length; i += 4) {
      if (isFiniteNum(curves[i])) curves[i] = curves[i] + shift;
      if (isFiniteNum(curves[i + 2])) curves[i + 2] = curves[i + 2] + shift;
    }
    out.curve = curves;
    return out;
  }

  /** 覆盖合并：目标未知扩展保留、源同名字段优先；源无 curve → 显式删除目标 curve */
  function mergeKey(destKey, srcKey) {
    const merged = Object.assign({}, clone(destKey), clone(srcKey));
    if (!Array.isArray(srcKey.curve)) delete merged.curve;
    return merged;
  }

  /**
   * 批量规划入口（纯函数，不改入参）。
   * @param {object} rawAnim 目标动画（state.raw.animations[name]）
   * @param {{op:'move'|'paste'|'delete', selection?:Array, delta?:number, clipboard?:object, atTime?:number,
   *          collision?:'overwrite'|'reject', lockedRows?:Set|Array, skeletonSignature?:string, owners?:string[],
   *          snap?:{enabled:boolean,fps:number}, model?:object}} opts
   * @returns {{ok:boolean, value:object|null, selectionAfter:Array, changedPaths:string[], duration:number|null,
   *            issues:Array, counts?:object}}
   */
  function planKeyBatch(rawAnim, opts) {
    const o = isObject(opts) ? opts : {};
    if (!isObject(rawAnim)) return fail("ANIM_INVALID", "rawAnim 必须是对象");
    if (o.op === "move") return planMove(rawAnim, o);
    if (o.op === "delete") return planDelete(rawAnim, o);
    if (o.op === "paste") return planPaste(rawAnim, o);
    return fail("OP_INVALID", "op 必须是 move/paste/delete，收到 " + JSON.stringify(o.op));
  }

  const api = Object.freeze({
    CLIPBOARD_VERSION: CLIPBOARD_VERSION,
    COLLISION_EPS: COLLISION_EPS,
    TIME_EPS: TIME_EPS,

    rowKeyOf: rowKeyOf,
    pathOf: pathOf,
    keyHasCurve: keyHasCurve,
    sameIdentity: sameIdentity,
    resolveTrack: resolveTrack,
    normalizeSelection: normalizeSelection,
    scanDuration: scanDuration,

    clipboardFromSelection: clipboardFromSelection,
    validateClipboard: validateClipboard,
    planKeyBatch: planKeyBatch,
  });

  global.SpineBatchEdit = api;
  if (typeof window !== "undefined" && window.SpineBatchEdit !== api) window.SpineBatchEdit = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
