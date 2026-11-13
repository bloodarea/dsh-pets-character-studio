/*
 * timeline.js —— Dopesheet 轨道构建与时间轴映射 · 纯模块
 * 边界（与 anim-edit.js / bundle.js 一致）：
 *   本文件不碰 DOM / window.location / Image / Canvas / fetch / 磁盘 IO。
 *   只接受普通对象与数字，返回纯数据；浏览器暴露 window.SpineTimeline，
 *   Node 里是 globalThis.SpineTimeline（import 的副作用，与 anim-edit.js 同风格）。
 *
 * 职责边界（勿越界）：
 *   - 本模块只「读」原始动画对象（state.raw.animations[name]，含草稿）并整形为可渲染行；
 *     不修改 raw，不直接写 key。真正写入由调用方用 SpineAnimEdit.upsertKey /
 *     removeKey / retimeKey / setKeyValues 执行。
 *   - retimeSuggestion / snapTime / clampTime 只是几何建议；Bezier（curve 数组）
 *     相邻 key 的增删拖由 T7 显式禁用（见 bezierLockedAt）。
 *   - key 时间与 SpineAnimEdit.scanTracks 完全一致：同样只统计数组里的 key，
 *     空数组不建行；row 的 keys 与 scanTracks 的 keys 一一对应（时间相同）。
 *
 * 行模型 row：
 *   { kind:'bone'|'slot'|'timeline', owner, ownerIndex, field, label, unit,
 *     valueKind:'scalar'|'vec2'|'attachment'|'raw',
 *     keys:[{time, value, raw}], keyCount, unsupported? }
 *   value 归一化：rotate→number；translate/scale/shear→{x,y}；
 *   attachment→string|null；raw/未知→key.value（没有则去掉 time 的克隆）。
 *   raw 始终是原始 key 的深克隆（保留 curve 与任何未知字段）。
 */
(function (global) {
  "use strict";

  const API_VERSION = 1;
  const DEFAULT_FPS = 30;
  const DEFAULT_PX_PER_SEC = 100;
  const DEFAULT_EPS = 1e-4; // 与 anim-edit.findKeyIndex 的默认容差一致
  const TIME_EPS = 1e-9;
  const MAJOR_STEP_BASE = 0.5; // 主刻度 0.5s
  const MINOR_STEP_BASE = 0.1; // 次刻度 0.1s
  const DEFAULT_MIN_LABEL_PX = 46;
  const DEFAULT_MIN_MINOR_PX = 5;
  const MAX_TICKS = 20000;

  const BONE_FIELD_ORDER = Object.freeze(["rotate", "translate", "scale", "shear"]);
  const BONE_FIELD_META = Object.freeze({
    rotate: { label: "旋转", unit: "°", valueKind: "scalar" },
    translate: { label: "位移", unit: "px", valueKind: "vec2" },
    scale: { label: "缩放", unit: "×", valueKind: "vec2" },
    shear: { label: "斜切", unit: "°", valueKind: "vec2" },
  });
  const SLOT_FIELD_META = Object.freeze({
    attachment: { label: "附件", unit: "", valueKind: "attachment" },
    /* 规划书 §4.3：Slot Color / Two Color。颜色 key 是 7 段或 8 段十六进制字符串
       （RRGGBBAA 或 RRGGBB）；core 目前**不求值**颜色动画（capabilities.unsupported.slotColor），
       所以这些行必须带 unsupported 标记 —— 编辑/保存可用，但不得声称预览已生效。 */
    color: { label: "颜色", unit: "", valueKind: "color" },
    twoColor: { label: "双色", unit: "", valueKind: "colorPair" },
  });
  const MAJOR_STEP_CANDIDATES = Object.freeze([0.5, 1, 2, 5, 10, 15, 30, 60]);
  const MINOR_STEP_CANDIDATES = Object.freeze([0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60]);
  const KINDS = Object.freeze({ bone: 0, slot: 1, timeline: 2 });

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function isFiniteNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function numOr(v, d) {
    return isFiniteNum(v) ? v : d;
  }
  function round(v, digits) {
    const p = Math.pow(10, digits == null ? 6 : digits);
    return Math.round(v * p) / p;
  }
  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }
  function issue(path, code, message) {
    return { path: String(path == null ? "" : path), code: code, message: String(message || code) };
  }
  function meta(kind, field) {
    if (kind === "bone" && BONE_FIELD_META[field]) return BONE_FIELD_META[field];
    if (kind === "slot" && SLOT_FIELD_META[field]) return SLOT_FIELD_META[field];
    return { label: field, unit: "", valueKind: "raw" };
  }

  /* ------------------------------------------------------------------ *
   * 轨道构建
   * ------------------------------------------------------------------ */

  function indexResolver(mapLike, list) {
    if (mapLike && typeof mapLike.get === "function") {
      return function (name) {
        const v = mapLike.get(name);
        return isFiniteNum(v) ? v : null;
      };
    }
    if (Array.isArray(list)) {
      const pos = {};
      for (let i = 0; i < list.length; i++) {
        if (isObject(list[i]) && typeof list[i].name === "string") pos[list[i].name] = i;
      }
      return function (name) {
        return Object.prototype.hasOwnProperty.call(pos, name) ? pos[name] : null;
      };
    }
    return function () {
      return null;
    };
  }

  /** 一个 key 的显示值：raw 原样深克隆，value 按 valueKind 归一化 */
  function normalizeKey(valueKind, rawKey) {
    const raw = isObject(rawKey) ? rawKey : {};
    const out = { time: isFiniteNum(raw.time) ? raw.time : 0, value: null, raw: clone(raw) };
    /* D1：曲线信息必须挂到 normalized key 上，否则 keyHasCurve/bezierLockedAt 对 buildRows 产物恒 false */
    if (Array.isArray(raw.curve)) out.curve = clone(raw.curve);
    if (valueKind === "scalar") {
      out.value = numOr(raw.value, 0);
    } else if (valueKind === "vec2") {
      out.value = { x: numOr(raw.x, 0), y: numOr(raw.y, 0) };
    } else if (valueKind === "attachment") {
      out.value = raw.name === undefined ? null : raw.name;
    } else if (valueKind === "color") {
      /* 7 段或 8 段十六进制（RRGGBB / RRGGBBAA）；3.x/4.x 里可能挂在 value 或 color 字段上 */
      const hex = typeof raw.value === "string" ? raw.value : typeof raw.color === "string" ? raw.color : null;
      out.value = hex;
    } else if (valueKind === "colorPair") {
      /* 双色：{"light": "RRGGBBAA", "dark": "RRGGBBAA"}（3.8+）；缺字段保持 null 不猜 */
      out.value = {
        light: typeof raw.light === "string" ? raw.light : null,
        dark: typeof raw.dark === "string" ? raw.dark : null,
      };
    } else if (Object.prototype.hasOwnProperty.call(raw, "value")) {
      out.value = raw.value;
    } else {
      const rest = clone(raw);
      delete rest.time;
      out.value = rest;
    }
    return out;
  }

  function makeRow(kind, owner, ownerIndex, field, keys, extra) {
    const m = meta(kind, field);
    const row = {
      kind: kind,
      owner: owner,
      ownerIndex: ownerIndex == null ? null : ownerIndex,
      field: field,
      label: (extra && extra.label) || m.label,
      unit: (extra && extra.unit !== undefined ? extra.unit : m.unit),
      valueKind: (extra && extra.valueKind) || m.valueKind,
      keys: keys,
      keyCount: keys.length,
    };
    if (extra && extra.unsupported) row.unsupported = true;
    /* 预览不完整（core 未求值）与说明文本也要透传：否则 UI 拿不到「不能假装预览已生效」的依据 */
    if (extra && extra.previewPartial) row.previewPartial = true;
    if (extra && typeof extra.note === "string") row.note = extra.note;
    return row;
  }

  function keysOfList(list, valueKind) {
    const out = [];
    for (let i = 0; i < list.length; i++) out.push(normalizeKey(valueKind, list[i]));
    return out;
  }

  /** 与 anim-edit.scanTimeDeep 同构的深度收集：只收「对象且带有限 time」的项 */
  function collectTimeKeys(value, out) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (isObject(item) && isFiniteNum(item.time)) out.push(item);
        else if (isObject(item) || Array.isArray(item)) collectTimeKeys(item, out);
      }
      return out;
    }
    if (isObject(value)) {
      const names = Object.keys(value);
      for (let i = 0; i < names.length; i++) {
        const v = value[names[i]];
        if (isObject(v) || Array.isArray(v)) collectTimeKeys(v, out);
      }
    }
    return out;
  }

  /** anim-edit.scanTimelineKeys 的镜像（只在 SpineAnimEdit 不可用时兜底 maxTime） */
  function scanMaxTime(anim) {
    let max = 0;
    const bump = function (t) {
      if (isFiniteNum(t) && t > max) max = t;
    };
    const scanList = function (keys) {
      if (!Array.isArray(keys)) return;
      for (let i = 0; i < keys.length; i++) bump(isObject(keys[i]) ? keys[i].time : undefined);
    };
    const scanBag = function (bag) {
      if (!isObject(bag)) return;
      const names = Object.keys(bag);
      for (let i = 0; i < names.length; i++) scanList(bag[names[i]]);
    };
    if (!isObject(anim)) return 0;
    if (isObject(anim.bones)) {
      const names = Object.keys(anim.bones);
      for (let i = 0; i < names.length; i++) scanBag(anim.bones[names[i]]);
    }
    if (isObject(anim.slots)) {
      const names = Object.keys(anim.slots);
      for (let i = 0; i < names.length; i++) scanBag(anim.slots[names[i]]);
    }
    if (isObject(anim.ik)) {
      const names = Object.keys(anim.ik);
      for (let i = 0; i < names.length; i++) {
        const bag = anim.ik[names[i]];
        if (!isObject(bag)) continue;
        if (isObject(bag.continuous)) scanList(bag.continuous.keys);
        scanList(bag.bendPositive);
        scanList(bag.compress);
        scanList(bag.stretch);
      }
    }
    if (Array.isArray(anim.drawOrder)) {
      for (let i = 0; i < anim.drawOrder.length; i++) {
        if (isObject(anim.drawOrder[i])) bump(anim.drawOrder[i].time);
      }
    }
    const top = Object.keys(anim);
    for (let i = 0; i < top.length; i++) {
      const k = top[i];
      if (k === "bones" || k === "slots" || k === "ik" || k === "drawOrder") continue;
      const v = anim[k];
      if (v === null || v === undefined) continue;
      if (isObject(v) || Array.isArray(v)) {
        const found = collectTimeKeys(v, []);
        for (let j = 0; j < found.length; j++) bump(found[j].time);
      }
    }
    return max;
  }

  /** 时长：优先用 anim-edit（保证与 scanTracks/animDurationOf 一致），否则本地镜像 */
  function animationMaxTime(anim) {
    const E = global.SpineAnimEdit;
    if (E && typeof E.animDurationOf === "function") {
      const via = E.animDurationOf(anim);
      if (isFiniteNum(via)) return via;
    }
    return scanMaxTime(anim);
  }

  function pushBoneRows(rows, bag, owner, ownerIndex, animation) {
    for (let i = 0; i < BONE_FIELD_ORDER.length; i++) {
      const field = BONE_FIELD_ORDER[i];
      const list = bag[field];
      if (!Array.isArray(list) || !list.length) continue;
      rows.push(makeRow("bone", owner, ownerIndex, field, keysOfList(list, meta("bone", field).valueKind)));
    }
    const names = Object.keys(bag).filter((k) => BONE_FIELD_ORDER.indexOf(k) < 0).sort();
    for (let i = 0; i < names.length; i++) {
      const field = names[i];
      const list = bag[field];
      if (!Array.isArray(list) || !list.length) continue;
      rows.push(
        makeRow("bone", owner, ownerIndex, field, keysOfList(list, "raw"), {
          label: field,
          unit: "",
          valueKind: "raw",
          unsupported: true,
        })
      );
    }
    void animation;
  }

  function pushSlotRows(rows, bag, owner, ownerIndex) {
    const known = Object.keys(SLOT_FIELD_META);
    for (let i = 0; i < known.length; i++) {
      const field = known[i];
      const list = bag[field];
      if (!Array.isArray(list) || !list.length) continue;
      const extra = {};
      /* 颜色动画：core 明确未求值（animation.slotColor.unsupported）。
         语义标签保留为「颜色/双色」，但必须带 unsupported —— 预览不完整这件事不能藏。 */
      if (field === "color" || field === "twoColor") {
        extra.unsupported = true;
        extra.previewPartial = true;
        extra.note = "core 未求值槽位颜色动画（capabilities.unsupported.slotColor）：可编辑/保存，预览不完整";
      }
      rows.push(makeRow("slot", owner, ownerIndex, field, keysOfList(list, SLOT_FIELD_META[field].valueKind), extra));
    }
    const names = Object.keys(bag).filter((k) => known.indexOf(k) < 0).sort();
    for (let i = 0; i < names.length; i++) {
      const field = names[i];
      const list = bag[field];
      if (!Array.isArray(list) || !list.length) continue;
      rows.push(
        makeRow("slot", owner, ownerIndex, field, keysOfList(list, "raw"), {
          label: field,
          unit: "",
          valueKind: "raw",
          unsupported: true,
        })
      );
    }
  }

  /** 顶层未知时序（events / deform / drawOrder / ik / attachments / ffd …）只读保留 */
  function pushTopLevelRows(rows, animation) {
    const names = Object.keys(animation);
    for (let i = 0; i < names.length; i++) {
      const key = names[i];
      if (key === "bones" || key === "slots") continue;
      const v = animation[key];
      if (v === null || v === undefined) continue;
      if (key === "ik" && isObject(v)) {
        pushIKRows(rows, v);
        continue;
      }
      const found = collectTimeKeys(v, []);
      if (!found.length) continue;
      rows.push(
        makeRow("timeline", key, null, key, keysOfList(found, "raw"), {
          label: key,
          unit: "",
          valueKind: "raw",
          unsupported: true,
        })
      );
    }
  }

  function pushIKRows(rows, ik) {
    const names = Object.keys(ik);
    for (let i = 0; i < names.length; i++) {
      const cname = names[i];
      const bag = ik[cname];
      if (!isObject(bag)) continue;
      const fields = Object.keys(bag);
      for (let j = 0; j < fields.length; j++) {
        const sub = fields[j];
        let list = bag[sub];
        if (sub === "continuous" && isObject(list)) list = list.keys;
        if (!Array.isArray(list) || !list.length) continue;
        rows.push(
          makeRow("timeline", "ik", null, cname + "." + sub, keysOfList(list, "raw"), {
            label: "IK " + cname + " " + sub,
            unit: "",
            valueKind: "raw",
            unsupported: true,
          })
        );
      }
    }
  }

  /**
   * 从原始动画对象构建 Dopesheet 行。
   * @param {{model?:object, animation?:object}} input
   *   model 提供 boneIndex/slotIndex（Map 或 bones/slots 数组均可），仅用于排序与 ownerIndex。
   *   animation 是 state.raw.animations[name] 原始对象（含草稿）。
   * @returns {{ok:boolean, rows:Array, maxTime:number, keyCount:number,
   *            boneSlotKeyCount:number, unsupported:number, unsupportedRows:Array, issues:Array}}
   */
  function buildRows(input) {
    const model = input && input.model;
    const animation = input && input.animation;
    if (!isObject(animation)) {
      return {
        ok: false,
        rows: [],
        maxTime: 0,
        keyCount: 0,
        boneSlotKeyCount: 0,
        unsupported: 0,
        unsupportedRows: [],
        issues: [issue("animations", "TIMELINE_ANIMATION_INVALID", "动画必须是对象")],
      };
    }
    const boneAt = indexResolver(model && model.boneIndex, model && model.bones);
    const slotAt = indexResolver(model && model.slotIndex, model && model.slots);
    const rows = [];
    const bones = isObject(animation.bones) ? animation.bones : {};
    const boneNames = Object.keys(bones);
    for (let i = 0; i < boneNames.length; i++) {
      const name = boneNames[i];
      const bag = bones[name];
      if (!isObject(bag)) continue;
      pushBoneRows(rows, bag, name, boneAt(name), animation);
    }
    const slots = isObject(animation.slots) ? animation.slots : {};
    const slotNames = Object.keys(slots);
    for (let i = 0; i < slotNames.length; i++) {
      const name = slotNames[i];
      const bag = slots[name];
      if (!isObject(bag)) continue;
      pushSlotRows(rows, bag, name, slotAt(name));
    }
    pushTopLevelRows(rows, animation);
    rows.sort(compareRows);
    let keyCount = 0;
    let boneSlotKeyCount = 0;
    const unsupportedRows = [];
    const partialRows = [];
    for (let i = 0; i < rows.length; i++) {
      keyCount += rows[i].keyCount;
      if (rows[i].kind === "bone" || rows[i].kind === "slot") boneSlotKeyCount += rows[i].keyCount;
      /* 两类必须分开：unsupported 是「结构非法/未知时序，只读」；
         partial 是「语义已知、可编辑可保存，但 core 没求值 → 预览不完整」（如槽位颜色动画）。
         混在一起会让用户以为颜色轨坏了。 */
      if (rows[i].unsupported) unsupportedRows.push(rows[i]);
      if (rows[i].previewPartial) partialRows.push(rows[i]);
    }
    return {
      ok: true,
      rows: rows,
      maxTime: animationMaxTime(animation),
      keyCount: keyCount,
      boneSlotKeyCount: boneSlotKeyCount,
      unsupported: unsupportedRows.length,
      unsupportedRows: unsupportedRows,
      partial: partialRows.length,
      partialRows: partialRows,
      issues: [],
    };
  }

  /* ------------------------------------------------------------------ *
   * 稳定键与排序
   * ------------------------------------------------------------------ */

  function rowKey(row) {
    if (!isObject(row)) return "";
    return String(row.kind) + ":" + String(row.owner) + ":" + String(row.field);
  }

  function kindRank(kind) {
    return Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : 99;
  }

  function fieldRank(kind, field) {
    if (kind === "bone") {
      const i = BONE_FIELD_ORDER.indexOf(field);
      return i >= 0 ? i : 100;
    }
    if (kind === "slot") return field === "attachment" ? 0 : 100;
    return 0;
  }

  function cmpStr(a, b) {
    const x = String(a == null ? "" : a);
    const y = String(b == null ? "" : b);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  /**
   * 排序：骨（按 boneIndex）→ 槽（按 slotIndex）→ 顶层未知时序；
   * 同 owner 内字段固定序 rotate/translate/scale/shear（槽 attachment 优先），
   * 未知字段按字母排后；索引缺失（未知骨/槽）排在同 kind 末尾。
   */
  function compareRows(a, b) {
    const ka = kindRank(a && a.kind);
    const kb = kindRank(b && b.kind);
    if (ka !== kb) return ka - kb;
    const ia = a && isFiniteNum(a.ownerIndex) ? a.ownerIndex : Number.POSITIVE_INFINITY;
    const ib = b && isFiniteNum(b.ownerIndex) ? b.ownerIndex : Number.POSITIVE_INFINITY;
    if (ia !== ib) return ia - ib;
    if (ia === Number.POSITIVE_INFINITY) {
      const byOwner = cmpStr(a && a.owner, b && b.owner);
      if (byOwner !== 0) return byOwner;
    }
    const fa = fieldRank(a && a.kind, a && a.field);
    const fb = fieldRank(b && b.kind, b && b.field);
    if (fa !== fb) return fa - fb;
    const byField = cmpStr(a && a.field, b && b.field);
    if (byField !== 0) return byField;
    return cmpStr(rowKey(a), rowKey(b));
  }

  /* ------------------------------------------------------------------ *
   * 时间轴映射（纯几何）
   * ------------------------------------------------------------------ */

  function timeToX(opts) {
    const o = isObject(opts) ? opts : {};
    const time = o.time;
    const scrollSec = numOr(o.scrollSec, 0);
    const pxPerSec = numOr(o.pxPerSec, DEFAULT_PX_PER_SEC);
    if (!isFiniteNum(time) || !(pxPerSec > 0)) return NaN;
    return (time - scrollSec) * pxPerSec;
  }

  function xToTime(opts) {
    const o = isObject(opts) ? opts : {};
    const x = o.x;
    const scrollSec = numOr(o.scrollSec, 0);
    const pxPerSec = numOr(o.pxPerSec, DEFAULT_PX_PER_SEC);
    if (!isFiniteNum(x) || !(pxPerSec > 0)) return NaN;
    return scrollSec + x / pxPerSec;
  }

  /** clampTime(time, max, min=0) 或 clampTime({time,max,min}) */
  function clampTime(a, b, c) {
    let time;
    let max;
    let min;
    if (isObject(a)) {
      time = a.time;
      max = a.max;
      min = a.min;
    } else {
      time = a;
      max = b;
      min = c;
    }
    const lo = numOr(min, 0);
    const hi = isFiniteNum(max) ? max : Number.POSITIVE_INFINITY;
    const t = isFiniteNum(time) ? time : lo;
    if (t < lo) return lo;
    if (t > hi) return hi;
    return t;
  }

  /** 30fps 默认吸附；enabled=false 时原值返回；时间非有限数返回 NaN */
  function snapTime(opts) {
    const o = isObject(opts) ? opts : {};
    const time = o.time;
    if (!isFiniteNum(time)) return NaN;
    if (o.enabled === false) return time;
    const fps = numOr(o.fps, DEFAULT_FPS);
    if (!(fps > 0)) return time;
    return round(Math.round(time * fps) / fps, 9);
  }

  function frameOf(time, fps) {
    const f = numOr(fps, DEFAULT_FPS);
    if (!isFiniteNum(time) || !(f > 0)) return NaN;
    return Math.round(time * f);
  }

  function keyIndexAtTime(keys, time, eps) {
    if (!Array.isArray(keys)) return -1;
    const t = isFiniteNum(time) ? time : 0;
    const e = eps == null ? DEFAULT_EPS : eps;
    for (let i = 0; i < keys.length; i++) {
      const kt = isObject(keys[i]) && isFiniteNum(keys[i].time) ? keys[i].time : 0;
      if (Math.abs(kt - t) <= e) return i;
    }
    return -1;
  }

  function keyAtTime(keys, time, eps) {
    const i = keyIndexAtTime(keys, time, eps);
    return i < 0 ? null : keys[i];
  }

  /**
   * key 是否带 Bezier curve。兼容两种形态：
   *   - normalized key（buildRows 产物，D1 起把 curve 直接挂在 key.curve 上，同时保留 key.raw.curve）；
   *   - 原始 raw key（key.curve 即曲线数组）。
   */
  function keyHasCurve(key) {
    if (!isObject(key)) return false;
    if (Array.isArray(key.curve) && key.curve.length > 0) return true;
    return !!(isObject(key.raw) && Array.isArray(key.raw.curve) && key.raw.curve.length > 0);
  }

  /**
   * Bezier 邻接保护（P0 契约）：某 key 自身带 curve，或前一个 key 带 curve
   * （curve 描述的是它之后那一段），则该 key 的增删/拖动会破坏相邻段插值。
   * 值更新不受影响。调用方（T7）在拖动前用它决定禁用。
   */
  function bezierLockedAt(keys, index) {
    if (!Array.isArray(keys) || !(index >= 0) || index >= keys.length) return false;
    if (keyHasCurve(keys[index])) return true;
    return index > 0 && keyHasCurve(keys[index - 1]);
  }

  function keysInRange(rows, from, to) {
    const list = Array.isArray(rows) ? rows : isObject(rows) ? [rows] : [];
    let f = isFiniteNum(from) ? from : 0;
    let t = isFiniteNum(to) ? to : f;
    if (t < f) {
      const tmp = f;
      f = t;
      t = tmp;
    }
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!isObject(row) || !Array.isArray(row.keys)) continue;
      for (let k = 0; k < row.keys.length; k++) {
        const key = row.keys[k];
        const kt = isObject(key) && isFiniteNum(key.time) ? key.time : 0;
        if (kt >= f - TIME_EPS && kt <= t + TIME_EPS) {
          out.push({ row: row, rowKey: rowKey(row), rowIndex: i, keyIndex: k, key: key, time: kt });
        }
      }
    }
    out.sort(function (a, b) {
      if (a.time !== b.time) return a.time - b.time;
      return a.rowIndex - b.rowIndex || a.keyIndex - b.keyIndex;
    });
    return out;
  }

  /**
   * 拖动重定时的纯几何建议：吸附（30fps 可选）→ 夹到 [0,maxTime] → 冲突检测。
   * 本模块不写 raw；调用方拿到 ok 后用 SpineAnimEdit.retimeKey 落地。
   * @returns {{ok:boolean, time:number|null, snapped:number|null, clamped:boolean,
   *            conflict:number|null, bezierLocked:boolean, issues:Array}}
   */
  function retimeSuggestion(opts) {
    const o = isObject(opts) ? opts : {};
    const keys = o.keys;
    const issues = [];
    if (!Array.isArray(keys)) {
      return {
        ok: false,
        time: null,
        snapped: null,
        clamped: false,
        conflict: null,
        bezierLocked: false,
        issues: [issue("keys", "TIMELINE_KEYS_INVALID", "keys 必须是数组")],
      };
    }
    const toTime = o.toTime;
    if (!isFiniteNum(toTime)) {
      return {
        ok: false,
        time: null,
        snapped: null,
        clamped: false,
        conflict: null,
        bezierLocked: false,
        issues: [issue("keys.time", "TIMELINE_TIME_INVALID", "目标时间必须是有限数")],
      };
    }
    const index = isFiniteNum(o.index) ? o.index : keyIndexAtTime(keys, o.fromTime, o.eps);
    if (index < 0 || index >= keys.length) {
      return {
        ok: false,
        time: null,
        snapped: null,
        clamped: false,
        conflict: null,
        bezierLocked: false,
        issues: [issue("keys", "TIMELINE_KEY_MISSING", "找不到要拖动的 key")],
      };
    }
    const snapped = snapTime({ time: toTime, fps: o.fps, enabled: o.snapEnabled });
    const clamped = clampTime(snapped, o.maxTime, 0);
    let conflict = null;
    for (let i = 0; i < keys.length; i++) {
      if (i === index) continue;
      const kt = isObject(keys[i]) && isFiniteNum(keys[i].time) ? keys[i].time : 0;
      if (Math.abs(kt - clamped) <= (o.eps == null ? DEFAULT_EPS : o.eps)) {
        conflict = kt;
        break;
      }
    }
    const bezierLocked = bezierLockedAt(keys, index);
    return {
      ok: true,
      time: clamped,
      snapped: snapped,
      clamped: clamped !== snapped,
      conflict: conflict,
      bezierLocked: bezierLocked,
      /* D1：locked 时给出明确拒绝字段，调用方不得落地该时间（几何值仅供显示） */
      blocked: bezierLocked,
      applyable: !bezierLocked,
      reason: bezierLocked ? "ANIM_CURVE_EDIT_UNSUPPORTED" : null,
      issues: issues,
    };
  }

  /**
   * 值 → 人读文本（帧视图 / 关键帧读数用）。只处理已知 valueKind；未知返回 null（调用方自己决定）。
   * 颜色刻意**不转成 rgb()**：Spine 里存的是 hex 字符串，转成 rgb 会让人以为可以随便写回。
   */
  function formatValue(valueKind, value, opts) {
    const o = isObject(opts) ? opts : {};
    const d = isFiniteNum(o.decimals) ? o.decimals : 3;
    if (valueKind === "scalar") return isFiniteNum(value) ? round(value, d) + (o.unit || "") : "—";
    if (valueKind === "vec2") {
      if (!isObject(value)) return "—";
      return round(numOr(value.x, 0), d) + ", " + round(numOr(value.y, 0), d);
    }
    if (valueKind === "attachment") return value == null ? "（无附件）" : String(value);
    if (valueKind === "color") return value == null ? "—" : String(value);
    if (valueKind === "colorPair") {
      if (!isObject(value)) return "—";
      const light = value.light == null ? "—" : String(value.light);
      const dark = value.dark == null ? "—" : String(value.dark);
      return "亮 " + light + " / 暗 " + dark;
    }
    return null;
  }

  /**
   * 离散轨道（§4.3 Attachment / §4.5 Events）：这些轨道的 key **不插值**，
   * 语义是「从该时间起切换成这个值」。帧视图要按阶梯块画，不能画成渐变色带。
   * @returns {{ok:boolean, discrete:boolean, reason:string|null, issues:Array}}
   */
  function isDiscreteTrack(kind, field) {
    if (kind === "slot" && field === "attachment") {
      return { ok: true, discrete: true, reason: "附件切换是离散事件（不可插值）", issues: [] };
    }
    if (kind === "event" || kind === "drawOrder") {
      return { ok: true, discrete: true, reason: kind === "event" ? "事件是瞬时标记（无持续时间）" : "绘制顺序按关键帧整段生效（阶梯）", issues: [] };
    }
    if (kind === "deform") {
      return { ok: true, discrete: false, reason: "形变顶点按线性/贝塞尔插值", issues: [] };
    }
    return { ok: true, discrete: false, reason: null, issues: [] };
  }

  /* ------------------------------------------------------------------ *
   * 时间标尺
   * ------------------------------------------------------------------ */

  function formatTime(t, opts) {
    if (!isFiniteNum(t)) return "-";
    const o = isObject(opts) ? opts : {};
    const d = isFiniteNum(o.decimals) ? Math.max(0, Math.min(6, Math.round(o.decimals))) : 2;
    const s = t.toFixed(d);
    return o.unit === "" ? s : s + (typeof o.unit === "string" ? o.unit : "s");
  }

  /** 选主刻度间隔：保证 label 间距 ≥ minLabelPx（默认 46） */
  function chooseMajorStep(pxPerSec, minLabelPx) {
    const px = isFiniteNum(pxPerSec) && pxPerSec > 0 ? pxPerSec : DEFAULT_PX_PER_SEC;
    const need = isFiniteNum(minLabelPx) ? minLabelPx : DEFAULT_MIN_LABEL_PX;
    for (let i = 0; i < MAJOR_STEP_CANDIDATES.length; i++) {
      if (MAJOR_STEP_CANDIDATES[i] * px >= need) return MAJOR_STEP_CANDIDATES[i];
    }
    const last = MAJOR_STEP_CANDIDATES[MAJOR_STEP_CANDIDATES.length - 1];
    return last * Math.max(1, Math.ceil(need / (last * px)));
  }

  /** 选次刻度间隔：0.1s 起步、必须整除主刻度且间距 ≥ minMinorPx；太密返回 null */
  function chooseMinorStep(majorStep, pxPerSec, minMinorPx) {
    const px = isFiniteNum(pxPerSec) && pxPerSec > 0 ? pxPerSec : DEFAULT_PX_PER_SEC;
    const need = isFiniteNum(minMinorPx) ? minMinorPx : DEFAULT_MIN_MINOR_PX;
    const major = isFiniteNum(majorStep) && majorStep > 0 ? majorStep : MAJOR_STEP_BASE;
    for (let i = 0; i < MINOR_STEP_CANDIDATES.length; i++) {
      const step = MINOR_STEP_CANDIDATES[i];
      if (step >= major) break;
      const ratio = major / step;
      if (Math.abs(ratio - Math.round(ratio)) > 1e-9) continue;
      if (step * px < need) continue;
      return step;
    }
    return null;
  }

  /**
   * 时间刻度：0.5s 主刻度 + 0.1s 次刻度，随 pxPerSec 抽稀避免标签重叠。
   * @returns {Array<{time:number, major:boolean, label:string}>} 按时间升序
   */
  function rulerTicks(opts) {
    const o = isObject(opts) ? opts : {};
    let from = isFiniteNum(o.from) ? o.from : 0;
    let to = isFiniteNum(o.to) ? o.to : from;
    if (to < from) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    const pxPerSec = isFiniteNum(o.pxPerSec) && o.pxPerSec > 0 ? o.pxPerSec : DEFAULT_PX_PER_SEC;
    const majorStep = isFiniteNum(o.majorStep) && o.majorStep > 0 ? o.majorStep : chooseMajorStep(pxPerSec, o.minLabelPx);
    const minorStep = o.minorStep === null ? null : isFiniteNum(o.minorStep) && o.minorStep > 0 ? o.minorStep : chooseMinorStep(majorStep, pxPerSec, o.minMinorPx);
    const ticks = [];
    const count = minorStep ? Math.round(majorStep / minorStep) : 1;
    let start = Math.ceil((from - TIME_EPS) / majorStep) * majorStep;
    if (!isFiniteNum(start)) start = from;
    for (let t = start; t <= to + TIME_EPS && ticks.length < MAX_TICKS; t += majorStep) {
      const majorTime = round(t, 6);
      if (majorTime < from - TIME_EPS) continue;
      ticks.push({ time: majorTime, major: true, label: formatTime(majorTime) });
      if (count > 1) {
        for (let m = 1; m < count; m++) {
          const mt = round(majorTime + m * minorStep, 6);
          if (mt > to + TIME_EPS) break;
          ticks.push({ time: mt, major: false, label: "" });
        }
      }
    }
    ticks.sort(function (a, b) {
      return a.time - b.time;
    });
    return ticks;
  }

  /* ------------------------------------------------------------------ *
   * 轨道过滤 / 行状态 / 多选（P1：搜索、有 Key、锁定、隐藏；只标记不删除）
   * ------------------------------------------------------------------ */

  function rowSearchText(row) {
    if (!isObject(row)) return "";
    return [row.owner, row.field, row.label, row.kind, row.unit, rowKey(row)]
      .filter(function (v) {
        return v !== undefined && v !== null;
      })
      .join(" ")
      .toLowerCase();
  }

  function searchTerms(search) {
    if (typeof search !== "string") return [];
    return search
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(function (t) {
        return t !== "";
      });
  }

  function matchSearch(row, terms) {
    if (!terms.length) return true;
    const text = rowSearchText(row);
    for (let i = 0; i < terms.length; i++) if (text.indexOf(terms[i]) < 0) return false;
    return true;
  }

  /** Set / 数组 / {key:truthy} 统一成字符串 Set */
  function keySetOf(value) {
    const set = new Set();
    if (value instanceof Set) {
      value.forEach(function (v) {
        set.add(String(v));
      });
      return set;
    }
    if (Array.isArray(value)) {
      for (const v of value) set.add(String(v));
      return set;
    }
    if (isObject(value)) {
      for (const k of Object.keys(value)) if (value[k]) set.add(String(k));
      return set;
    }
    return set;
  }

  /**
   * 过滤轨道行（**只标记不删除**：行仍在数组里，靠 `filtered`/`hidden` 决定是否渲染）。
   * @param {{rows:Array, search?:string, onlyKeyed?:boolean, locked?:Set|Array|object,
   *          hidden?:Set|Array|object, groups?:Array<{key,label,children:string[]}>}} input
   * @returns {{ok:boolean, rows:Array, visibleRows:Array, groups:Array,
   *            total:number, visible:number, hidden:number, locked:number, matched:number, issues:Array}}
   *   - search：多词 AND、大小写无关，匹配 owner / field / label / kind / unit / rowKey
   *   - onlyKeyed：keyCount>0 才 visible；骨组行由 groups 的 children 存活情况决定
   */
  function filterRows(input) {
    const inp = isObject(input) ? input : {};
    const rows = Array.isArray(inp.rows) ? inp.rows : null;
    if (!rows) {
      return {
        ok: false, rows: [], visibleRows: [], groups: [], total: 0, visible: 0, hidden: 0, locked: 0, matched: 0,
        issues: [issue("rows", "ROWS_NOT_ARRAY", "rows 必须是数组")],
      };
    }
    const terms = searchTerms(inp.search);
    const lockedSet = keySetOf(inp.locked);
    const hiddenSet = keySetOf(inp.hidden);
    const onlyKeyed = inp.onlyKeyed === true;
    const out = [];
    let matched = 0;
    let visible = 0;
    let hiddenCount = 0;
    let lockedCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const key = rowKey(row);
      const isLocked = lockedSet.has(key);
      const isHidden = hiddenSet.has(key);
      const searchOk = matchSearch(row, terms);
      const keyOk = !onlyKeyed || (isObject(row) && row.keyCount > 0);
      const filtered = !(searchOk && keyOk);
      const annotated = isObject(row) ? Object.assign({}, row) : row;
      if (isObject(annotated)) {
        annotated.locked = isLocked;
        annotated.hidden = isHidden;
        annotated.filtered = filtered;
      }
      if (searchOk) matched++;
      if (!filtered && !isHidden) visible++;
      if (isHidden) hiddenCount++;
      if (isLocked) lockedCount++;
      out.push(annotated);
    }
    const groups = [];
    if (Array.isArray(inp.groups)) {
      for (const g of inp.groups) {
        const children = Array.isArray(g && g.children) ? g.children : [];
        const alive = children.filter(function (ck) {
          for (let i = 0; i < out.length; i++) {
            if (rowKey(out[i]) === String(ck)) return !out[i].filtered && !out[i].hidden;
          }
          return false;
        });
        groups.push(Object.assign({}, g, { matchedChildren: alive.length, filtered: children.length > 0 && alive.length === 0 }));
      }
    }
    return {
      ok: true,
      rows: out,
      visibleRows: out.filter(function (r) {
        return !r.filtered && !r.hidden;
      }),
      groups: groups,
      total: out.length,
      visible: visible,
      hidden: hiddenCount,
      locked: lockedCount,
      matched: matched,
      issues: [],
    };
  }

  /**
   * 为空轨道补行（契约 §6：onlyKeyed OFF 时每根已知骨都应有 rotate/translate/scale/shear 行）。
   * 规则：只为 `model.bones` 里的**已知骨**补缺失字段；未知轨/槽行原样保留；已有行不覆盖；重复调用幂等。
   * @param {Array} rows buildRows 产物
   * @param {{bones:Array}} model spine-core 解析态（只需 bones）
   * @param {{fields?:string[], includeEmpty?:boolean, sort?:boolean}} [opts]
   *   includeEmpty=false → 原样返回（对应"只看有 Key 的行"）；sort=false → 追加在末尾不排序
   * @returns {{ok:boolean, rows:Array, added:number, addedRows:Array, issues:Array}}
   */
  function withEmptyBoneTracks(rows, model, opts) {
    const o = isObject(opts) ? opts : {};
    const list = Array.isArray(rows) ? rows.slice() : [];
    const fields = Array.isArray(o.fields) && o.fields.length ? o.fields.slice() : ["rotate", "translate", "scale", "shear"];
    if (o.includeEmpty === false) return { ok: true, rows: list, added: 0, addedRows: [], issues: [] };
    const bones = model && Array.isArray(model.bones) ? model.bones : null;
    if (!bones) {
      return { ok: false, rows: list, added: 0, addedRows: [], issues: [issue("model", "MODEL_BONES_MISSING", "model.bones 缺失，无法补齐空轨")] };
    }
    const existing = new Set();
    for (const row of list) {
      if (isObject(row) && row.kind === "bone") existing.add(String(row.owner) + "|" + String(row.field));
    }
    const addedRows = [];
    for (let bi = 0; bi < bones.length; bi++) {
      const b = bones[bi];
      if (!isObject(b) || typeof b.name !== "string" || !b.name) continue; // 匿名/未知骨不补造
      for (const field of fields) {
        const id = b.name + "|" + field;
        if (existing.has(id)) continue;
        const m = meta("bone", field);
        addedRows.push({
          kind: "bone",
          owner: b.name,
          ownerIndex: bi,
          field: field,
          label: m.label,
          unit: m.unit,
          valueKind: m.valueKind,
          keys: [],
          keyCount: 0,
        });
        existing.add(id);
      }
    }
    const merged = list.concat(addedRows);
    const out = o.sort === false ? merged : merged.sort(compareRows);
    return { ok: true, rows: out, added: addedRows.length, addedRows: addedRows, issues: [] };
  }

  /** 行状态：锁定=禁写、隐藏=不显示、选中=高亮；未知 rowKey 视为未锁定未隐藏 */
  function rowState(row, opts) {
    const o = isObject(opts) ? opts : {};
    const key = rowKey(row);
    const locked = keySetOf(o.locked).has(key);
    const hidden = keySetOf(o.hidden).has(key);
    const selected = keySetOf(o.selected).has(key);
    return { key: key, locked: locked, hidden: hidden, selected: selected, editable: !locked, visible: !hidden };
  }

  /** 多选命中：selection 的 rowKey → 行（保持 rows 顺序），未命中的 key 单独报出 */
  function selectedRows(rows, selection) {
    const list = Array.isArray(rows) ? rows : [];
    const sel = keySetOf(selection);
    const hit = [];
    const found = new Set();
    for (let i = 0; i < list.length; i++) {
      const key = rowKey(list[i]);
      if (sel.has(key)) {
        hit.push(list[i]);
        found.add(key);
      }
    }
    const missing = [];
    sel.forEach(function (k) {
      if (!found.has(k)) missing.push(k);
    });
    return { ok: true, rows: hit, count: hit.length, missing: missing };
  }

  const api = {
    API_VERSION: API_VERSION,
    DEFAULT_FPS: DEFAULT_FPS,
    DEFAULT_PX_PER_SEC: DEFAULT_PX_PER_SEC,
    DEFAULT_EPS: DEFAULT_EPS,
    MAJOR_STEP_BASE: MAJOR_STEP_BASE,
    MINOR_STEP_BASE: MINOR_STEP_BASE,
    BONE_FIELD_ORDER: BONE_FIELD_ORDER,
    BONE_FIELD_META: BONE_FIELD_META,
    SLOT_FIELD_META: SLOT_FIELD_META,

    buildRows: buildRows,
    rowKey: rowKey,
    compareRows: compareRows,
    normalizeKey: normalizeKey,
    scanMaxTime: scanMaxTime,

    timeToX: timeToX,
    xToTime: xToTime,
    clampTime: clampTime,
    snapTime: snapTime,
    frameOf: frameOf,
    formatTime: formatTime,
    rulerTicks: rulerTicks,
    chooseMajorStep: chooseMajorStep,
    chooseMinorStep: chooseMinorStep,

    keyAtTime: keyAtTime,
    keyIndexAtTime: keyIndexAtTime,
    keyHasCurve: keyHasCurve,
    bezierLockedAt: bezierLockedAt,
    keysInRange: keysInRange,
    retimeSuggestion: retimeSuggestion,
    formatValue: formatValue,
    isDiscreteTrack: isDiscreteTrack,
    rowSearchText: rowSearchText,
    withEmptyBoneTracks: withEmptyBoneTracks,
    filterRows: filterRows,
    rowState: rowState,
    selectedRows: selectedRows,
  };

  global.SpineTimeline = api;
  if (typeof window !== "undefined" && window.SpineTimeline !== api) window.SpineTimeline = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
