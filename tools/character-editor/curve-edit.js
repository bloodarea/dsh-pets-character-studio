/*
 * curve-edit.js —— Spine 4.2 关键帧曲线（Bezier / Stepped / Linear）解析 · 采样 · 编辑 · 纯模块
 *
 * 边界（与 anim-edit.js / timeline.js / bone-edit.js 一致）：
 *   不碰 DOM / window.location / Image / Canvas / fetch / 磁盘 IO。
 *   只接受普通对象与数字，返回 {ok, value|issues} 风格结果；浏览器暴露 window.SpineCurveEdit，
 *   Node 里是 globalThis.SpineCurveEdit（selftest 复用）。
 *
 * 官方 4.2 编码（已核对 workspace/tmp/spine42/spine-ts/spine-core/src）：
 *   - 段 = key → 下一个 key；末 key 没有可编辑的出段（Animation.ts:229 构造时末 frame 默认 STEPPED）。
 *   - `key.curve` 缺失 = linear；`"stepped"` = 整段 stepped（SkeletonJson.ts:1157 setStepped(frame)，**整条组合段**，
 *     不能只让 translate.x stepped 而 y linear）；数组 = 每个分量 4 个数 [cx1,cy1,cx2,cy2]，
 *     偏移 i = valueIndex << 2（SkeletonJson.ts:1161-1166）。
 *   - cx/cy 是**绝对时间 / 真实值**（不是归一化）；cy 在 JSON 空间与 key 值同单位。
 *     官方只在 **translate** 轨把 key 值与 cy 整体乘 `SkeletonJson.scale`（SkeletonJson.ts:711）；
 *     rotate(`:708`)、scale(`:720`)、shear(`:729`) 的 scale 都是 1。本模块只处理 raw JSON，不做 scale 换算。
 *   - 官方采样：Animation.ts:267-287 setBezier 展开 18 点表 + :293-309 getBezierValue 分段线性查表；
 *     本模块与 spine-core.js buildBezierTable/bezierValue **逐位一致**（同为 9 段 18 点、f32 输入）。
 *
 * 写操作全部纯函数：深克隆入参、不改动输入；末 key / 非法输入返回 {ok:false, reason} 零改动。
 */
(function (global) {
  "use strict";

  const API_VERSION = 1;
  const SEGMENT_TYPES = Object.freeze(["linear", "stepped", "bezier"]);
  const COMPONENT_COUNT = Object.freeze({ rotate: 1, translate: 2, scale: 2, shear: 2, attachment: 0 });
  /** 官方 readTimeline 的 defaultValue（SkeletonJson.ts:711 translate=0、:720 scale=1、:729 shear=0） */
  const DEFAULT_VALUE_BY_FIELD = Object.freeze({ rotate: 0, translate: 0, scale: 1, shear: 0 });
  const BEZIER_SEGMENTS = 9; // 与 4.2 CurveTimeline 的 18 个 float 采样表一致
  const TIME_EPS = 1e-6;

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function isFiniteNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function f32(v) {
    return typeof Math.fround === "function" ? Math.fround(v) : v;
  }
  /**
   * 是否 float32 可表示（T16 契约：cy 必须 finite 且 f32 可表示）。
   * Number.MAX_VALUE / 1e39 这类 fround 后变 Infinity，写进 runtime 会污染整条轨道。
   */
  function isF32Representable(v) {
    return isFiniteNum(v) && isFinite(f32(v));
  }
  function pointsF32Ok(p) {
    return isF32Representable(p.cx1) && isF32Representable(p.cy1) && isF32Representable(p.cx2) && isF32Representable(p.cy2);
  }
  function round6(v) {
    return Math.round(v * 1e6) / 1e6;
  }
  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }
  function issue(path, code, message) {
    return { path: String(path == null ? "" : path), code: code, message: String(message || code) };
  }
  function failIndex(index, reason, extra) {
    const out = { ok: false, index: index, reason: reason };
    if (extra) for (const k of Object.keys(extra)) out[k] = extra[k];
    return out;
  }

  /** 字段 → 分量数（rotate=1；translate/scale/shear=2；未知=0） */
  function componentCount(field, rawKey) {
    if (typeof field === "string" && Object.prototype.hasOwnProperty.call(COMPONENT_COUNT, field)) {
      return COMPONENT_COUNT[field];
    }
    if (rawKey !== undefined) return inferComponents(rawKey);
    return 0;
  }

  /** 从 key 自身字段推断分量数：value→1；x/y→2；其余 0 */
  function inferComponents(key) {
    if (!isObject(key)) return 0;
    if (Object.prototype.hasOwnProperty.call(key, "value")) return 1;
    if (Object.prototype.hasOwnProperty.call(key, "x") || Object.prototype.hasOwnProperty.call(key, "y")) return 2;
    return 0;
  }

  function keyField(key, valueIndex) {
    if (!isObject(key)) return undefined;
    if (valueIndex === 0) {
      if (Object.prototype.hasOwnProperty.call(key, "value")) return key.value;
      if (Object.prototype.hasOwnProperty.call(key, "x")) return key.x;
    }
    if (valueIndex === 1 && Object.prototype.hasOwnProperty.call(key, "y")) return key.y;
    return undefined;
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  /**
   * 统一上下文：`opts = {field, defaultValue, components}`（Task-16 裁定）。
   *   - components 显式给出优先；否则按 field 查表；否则从 key 字段推断（raw rotate={time:0} 这类推断不出，Graph 必须给 field）。
   *   - defaultValue：field 为 scale → 1；rotate / translate / shear → 0；显式 defaultValue 优先。
   */
  function contextOf(opts, key) {
    const o = isObject(opts) ? opts : {};
    let n = null;
    if (isFiniteNum(o.components) && o.components >= 0) n = o.components;
    else if (typeof o.field === "string" && hasOwn(COMPONENT_COUNT, o.field)) n = COMPONENT_COUNT[o.field];
    else n = inferComponents(key);
    let def = isFiniteNum(o.defaultValue) ? o.defaultValue : null;
    if (def === null && typeof o.field === "string" && hasOwn(DEFAULT_VALUE_BY_FIELD, o.field)) def = DEFAULT_VALUE_BY_FIELD[o.field];
    if (def === null) def = 0;
    return { components: n, field: typeof o.field === "string" ? o.field : null, defaultValue: def };
  }

  /** key 的某分量值；缺字段时按上下文默认（scale=1，其余 0），并 f32 化 */
  function componentValue(key, valueIndex, ctx) {
    const v = keyField(key, valueIndex);
    return f32(v === undefined || v === null ? ctx.defaultValue : v);
  }

  /**
   * 校验并拆出 curve 数组。段类型命名与 segmentInfo 一致：缺 curve = `linear`。
   * @returns {{ok:boolean, type:'linear'|'stepped'|'bezier', values:Array|null, hasCurveField:boolean, crossed?:boolean, reason?:string}}
   *   crossed=true 表示原文 cx1>cx2（Graph 里只读/诊断，不自动修）。
   */
  function curveValues(rawKey, components) {
    const n = isObject(components) ? contextOf(components, rawKey).components : components === undefined ? inferComponents(rawKey) : components;
    const curve = isObject(rawKey) ? rawKey.curve : undefined;
    if (curve === undefined || curve === null) return { ok: true, type: "linear", values: null, hasCurveField: false };
    if (curve === "stepped") return { ok: true, type: "stepped", values: null, hasCurveField: true };
    if (!Array.isArray(curve)) return { ok: false, type: "invalid", values: null, hasCurveField: true, reason: "CURVE_TYPE" };
    if (!n) return { ok: false, type: "invalid", values: null, hasCurveField: true, reason: "UNKNOWN_COMPONENTS" };
    if (curve.length < 4 * n) return { ok: false, type: "invalid", values: null, hasCurveField: true, reason: "CURVE_LENGTH" };
    const values = [];
    let crossed = false;
    for (let i = 0; i < n; i++) {
      const p = [curve[i * 4], curve[i * 4 + 1], curve[i * 4 + 2], curve[i * 4 + 3]];
      for (const v of p) if (!isFiniteNum(v)) return { ok: false, type: "invalid", values: null, hasCurveField: true, reason: "CURVE_NON_FINITE" };
      if (p[0] > p[2] + TIME_EPS) crossed = true;
      values.push(p);
    }
    return { ok: true, type: "bezier", values: values, hasCurveField: true, crossed: crossed };
  }

  /** 段的共线默认控制点（1/3、2/3） */
  function defaultControlPoints(time1, value1, time2, value2) {
    const dt = time2 - time1;
    const dv = value2 - value1;
    return {
      cx1: round6(time1 + dt / 3),
      cy1: round6(value1 + dv / 3),
      cx2: round6(time1 + (dt * 2) / 3),
      cy2: round6(value1 + (dv * 2) / 3),
    };
  }

  /**
   * key → nextKey 的段信息。
   * @returns {null|{ok:false,reason:string}|{ok:true,type,time1,value1,time2,value2,steppedShared,cx1?,cy1?,cx2?,cy2?}}
   *   末 key / 无 nextKey → null（没有可编辑的出段）。
   */
  function segmentInfo(key, valueIndex, nextKey, opts) {
    if (!isObject(key)) return failIndex(valueIndex, "INVALID_KEY");
    if (nextKey === undefined || nextKey === null) return null;
    if (!isObject(nextKey)) return failIndex(valueIndex, "INVALID_NEXT_KEY");
    const ctx = contextOf(opts, key);
    const n = ctx.components;
    if (!n) return failIndex(valueIndex, "UNKNOWN_COMPONENTS");
    if (!(valueIndex >= 0 && valueIndex < n)) return failIndex(valueIndex, "VALUE_INDEX");
    const time1 = f32(isFiniteNum(key.time) ? key.time : 0);
    const time2 = f32(isFiniteNum(nextKey.time) ? nextKey.time : 0);
    const value1 = componentValue(key, valueIndex, ctx);
    const value2 = componentValue(nextKey, valueIndex, ctx);
    const cv = curveValues(key, n);
    if (!cv.ok) return failIndex(valueIndex, cv.reason);
    const out = { ok: true, type: cv.type, time1: time1, value1: value1, time2: time2, value2: value2, field: ctx.field, defaultValue: ctx.defaultValue };
    if (cv.type === "stepped") {
      out.steppedShared = n > 1;
      return out;
    }
    if (cv.type === "bezier") {
      const p = cv.values[valueIndex];
      out.cx1 = p[0];
      out.cy1 = p[1];
      out.cx2 = p[2];
      out.cy2 = p[3];
      out.crossed = !!cv.crossed;
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 采样（与 spine-core 逐位一致）
   * ------------------------------------------------------------------ */

  /** 复刻 4.2 CurveTimeline.setBezier 的 9 点表（BEZIER_SEGMENTS*2 个数） */
  function buildBezierTable(time1, value1, cx1, cy1, cx2, cy2, time2, value2) {
    const table = new Float64Array(BEZIER_SEGMENTS * 2);
    const tmpx = (time1 - cx1 * 2 + cx2) * 0.03;
    const tmpy = (value1 - cy1 * 2 + cy2) * 0.03;
    const dddx = ((cx1 - cx2) * 3 - time1 + time2) * 0.006;
    const dddy = ((cy1 - cy2) * 3 - value1 + value2) * 0.006;
    let ddx = tmpx * 2 + dddx;
    let ddy = tmpy * 2 + dddy;
    let dx = (cx1 - time1) * 0.3 + tmpx + dddx * 0.16666667;
    let dy = (cy1 - value1) * 0.3 + tmpy + dddy * 0.16666667;
    let x = time1 + dx;
    let y = value1 + dy;
    for (let i = 0; i < BEZIER_SEGMENTS * 2; i += 2) {
      table[i] = x;
      table[i + 1] = y;
      dx += ddx;
      dy += ddy;
      ddx += dddx;
      ddy += dddy;
      x += dx;
      y += dy;
    }
    return table;
  }

  /** 复刻 4.2 CurveTimeline.getBezierValue（表内分段线性） */
  function bezierValue(table, keyTime, keyValue, nextTime, nextValue, time) {
    if (table[0] > time) {
      const span = table[0] - keyTime;
      if (Math.abs(span) <= 1e-9) return table[1];
      return keyValue + ((time - keyTime) / span) * (table[1] - keyValue);
    }
    for (let i = 2; i < table.length; i += 2) {
      if (table[i] >= time) {
        const x0 = table[i - 2];
        const y0 = table[i - 1];
        const dx = table[i] - x0;
        if (Math.abs(dx) <= 1e-9) return table[i + 1];
        return y0 + ((time - x0) / dx) * (table[i + 1] - y0);
      }
    }
    const lx = table[table.length - 2];
    const ly = table[table.length - 1];
    const ldx = nextTime - lx;
    if (Math.abs(ldx) <= 1e-9) return nextValue;
    return ly + ((time - lx) / ldx) * (nextValue - ly);
  }

  /**
   * 段内采样（时间端点含在段内；stepped 取前值）。
   * @returns {{ok:boolean,value?:number,type?:string,reason?:string}}
   */
  function sampleSegment(keys, index, valueIndex, time, opts) {
    if (!Array.isArray(keys)) return { ok: false, reason: "KEYS_NOT_ARRAY" };
    if (!(index >= 0) || index + 1 >= keys.length) return { ok: false, reason: "LAST_KEY_NO_SEGMENT" };
    const info = segmentInfo(keys[index], valueIndex, keys[index + 1], opts);
    if (!info) return { ok: false, reason: "LAST_KEY_NO_SEGMENT" };
    if (!info.ok) return { ok: false, reason: info.reason };
    const t = isFiniteNum(time) ? time : info.time1;
    if (info.type === "stepped") return { ok: true, value: info.value1, type: "stepped" };
    if (info.type === "bezier") {
      const table = buildBezierTable(
        info.time1, info.value1, f32(info.cx1), f32(info.cy1), f32(info.cx2), f32(info.cy2), info.time2, info.value2
      );
      return { ok: true, value: bezierValue(table, info.time1, info.value1, info.time2, info.value2, t), type: "bezier" };
    }
    const span = info.time2 - info.time1;
    const frac = span <= 1e-9 ? 1 : (t - info.time1) / span;
    return { ok: true, value: info.value1 + (info.value2 - info.value1) * frac, type: "linear" };
  }

  /**
   * 整轨求值：首 key 之前返回 defaultValue（rotate/translate 为 0、scale 为 1），末 key 之后返回末值。
   * 时间比较用 f32，与 spine-core.sampleTrack 一致。
   */
  function valueAt(keys, valueIndex, time, opts) {
    const o = isObject(opts) ? opts : {};
    const ctx = contextOf(o, Array.isArray(keys) && keys.length ? keys[0] : null);
    const def = ctx.defaultValue;
    if (!Array.isArray(keys) || keys.length === 0) return { ok: false, reason: "KEYS_EMPTY", value: def };
    const times = keys.map(function (k) {
      return f32(isObject(k) && isFiniteNum(k.time) ? k.time : 0);
    });
    const t = isFiniteNum(time) ? time : 0;
    if (t < times[0]) return { ok: true, value: def, before: true, after: false };
    let idx = keys.length - 1;
    for (let i = 0; i < keys.length - 1; i++) {
      if (t < times[i + 1]) {
        idx = i;
        break;
      }
    }
    if (idx >= keys.length - 1) {
      return { ok: true, value: componentValue(keys[keys.length - 1], valueIndex, ctx), before: false, after: true, index: keys.length - 1 };
    }
    const s = sampleSegment(keys, idx, valueIndex, t, o);
    if (!s.ok) return { ok: false, reason: s.reason, value: def };
    return { ok: true, value: s.value, before: false, after: false, index: idx, type: s.type };
  }

  /**
   * 整轨折线采样（每段 samplesPerSegment 段，含端点）。
   * @returns {{ok:boolean, points:Array<{time,value}>, segments:Array, reason?:string}}
   */
  function graphSamples(keys, valueIndex, opts) {
    const o = isObject(opts) ? opts : {};
    const per = isFiniteNum(o.samplesPerSegment) && o.samplesPerSegment >= 1 ? Math.min(256, Math.round(o.samplesPerSegment)) : 16;
    if (!Array.isArray(keys) || keys.length === 0) return { ok: false, points: [], segments: [], reason: "KEYS_EMPTY" };
    const points = [];
    const segments = [];
    for (let i = 0; i < keys.length - 1; i++) {
      const info = segmentInfo(keys[i], valueIndex, keys[i + 1], o);
      if (!info || !info.ok) return { ok: false, points: points, segments: segments, reason: info ? info.reason : "LAST_KEY_NO_SEGMENT", index: i };
      const seg = [];
      for (let s = 0; s <= per; s++) {
        const t = info.time1 + ((info.time2 - info.time1) * s) / per;
        const r = sampleSegment(keys, i, valueIndex, t, o);
        const pt = { time: round6(t), value: r.ok ? r.value : info.value1, segment: i, type: info.type };
        seg.push(pt);
        if (!(points.length && Math.abs(points[points.length - 1].time - pt.time) <= TIME_EPS)) points.push(pt);
      }
      segments.push({ index: i, type: info.type, time1: info.time1, time2: info.time2, points: seg });
    }
    if (!segments.length) {
      /* 单 key 轨道：没有段，但仍给出该 key 的点，便于 Graph 画一个孤立手柄 */
      const ctx = contextOf(o, keys[0]);
      points.push({
        time: round6(f32(isFiniteNum(keys[0].time) ? keys[0].time : 0)),
        value: componentValue(keys[0], valueIndex, ctx),
        segment: -1,
        type: "linear",
      });
    }
    return { ok: true, points: points, segments: segments };
  }

  /* ------------------------------------------------------------------ *
   * 写操作（纯函数）
   * ------------------------------------------------------------------ */

  /** 该 key → nextKey 段在分量 componentIndex 上的共线控制点（用于补齐数组） */
  function collinearFor(keys, index, componentIndex, ctx) {
    const key = keys[index];
    const next = keys[index + 1];
    const t1 = f32(isFiniteNum(key.time) ? key.time : 0);
    const t2 = f32(isFiniteNum(next.time) ? next.time : 0);
    const v1 = componentValue(key, componentIndex, ctx);
    const v2 = componentValue(next, componentIndex, ctx);
    return defaultControlPoints(t1, v1, t2, v2);
  }

  /**
   * 写目标分量的控制点；缺的分量补共线控制点。
   * 官方按 `valueIndex << 2` 固定偏移读取（SkeletonJson.ts:1161），因此数组必须先补齐到 4*分量数，
   * **不能截短**（截短会让 y 错位/缺项）。
   */
  function writeSegmentControlsFrom(out, index, valueIndex, components, p, ctx) {
    const key = out[index];
    const arr = Array.isArray(key.curve) ? key.curve.slice() : [];
    while (arr.length < 4 * components) {
      const idx = Math.floor(arr.length / 4);
      const seg = collinearFor(out, index, idx, ctx);
      arr.push(seg.cx1, seg.cy1, seg.cx2, seg.cy2);
    }
    const base = valueIndex * 4;
    arr[base] = p.cx1;
    arr[base + 1] = p.cy1;
    arr[base + 2] = p.cx2;
    arr[base + 3] = p.cy2;
    key.curve = arr;
  }

  /**
   * 设置段类型（纯函数）。
   * 语义（T16 契约裁定）：
   *   - `stepped` / `linear` 是**整段（componentWide）语义**：`curve:"stepped"` 是单个字符串，不能只让 x stepped 而 y linear；
   *     `linear` 的“整段”命令才 `delete curve`（分量级 linear 只把该分量 4 项写成共线控制点，保留数组偏移）。
   *   - `bezier` 是分量级：只写目标分量，其它分量缺失时补共线控制点；原文是 stepped 时必须 `componentWide` 才整段转换。
   * @param {{componentWide?:boolean}} [opts]
   * @returns {{ok:boolean, value?:Array, componentWide?:boolean, needsComponentWide?:boolean, reason?:string}}
   */
  function setSegmentType(keys, index, valueIndex, type, opts) {
    const o = isObject(opts) ? opts : {};
    if (!Array.isArray(keys)) return failIndex(index, "KEYS_NOT_ARRAY");
    if (SEGMENT_TYPES.indexOf(type) < 0) return failIndex(index, "SEGMENT_TYPE");
    if (!(index >= 0) || index + 1 >= keys.length) return failIndex(index, "LAST_KEY_NO_SEGMENT");
    const src = keys[index];
    if (!isObject(src) || !isObject(keys[index + 1])) return failIndex(index, "INVALID_KEY");
    const ctx = contextOf(o, src);
    const n = ctx.components;
    if (!n) return failIndex(index, "UNKNOWN_COMPONENTS");
    if (!(valueIndex >= 0 && valueIndex < n)) return failIndex(index, "VALUE_INDEX");
    const info = segmentInfo(src, valueIndex, keys[index + 1], o);
    if (!info || !info.ok) return failIndex(index, info ? info.reason : "LAST_KEY_NO_SEGMENT");
    const curve = src.curve;
    const hasBezierArray = Array.isArray(curve);

    if (type === "stepped") {
      if (hasBezierArray && n > 1 && !o.componentWide) {
        return failIndex(index, "STEPPED_REQUIRES_COMPONENT_WIDE", { needsComponentWide: true });
      }
      const out = clone(keys);
      out[index].curve = "stepped";
      return { ok: true, value: out, componentWide: n > 1 || hasBezierArray };
    }

    if (type === "linear") {
      if (curve === "stepped") {
        if (n > 1 && !o.componentWide) return failIndex(index, "STEPPED_REQUIRES_COMPONENT_WIDE", { needsComponentWide: true });
        const out = clone(keys);
        delete out[index].curve;
        return { ok: true, value: out, componentWide: true };
      }
      const out = clone(keys);
      if (o.componentWide) {
        if (out[index].curve !== undefined) delete out[index].curve;
        return { ok: true, value: out, componentWide: true };
      }
      if (!hasBezierArray) return { ok: true, value: out, componentWide: false };
      /* 分量级 linear：保留数组长度与偏移，把该分量写成共线控制点（禁止 splice 截短） */
      const arr = curve.slice();
      const col = collinearFor(keys, index, valueIndex, ctx);
      if (!pointsF32Ok(col)) return failIndex(index, "CONTROL_POINTS_NOT_F32", { detail: "共线控制点超出 float32" });
      arr[valueIndex * 4] = col.cx1;
      arr[valueIndex * 4 + 1] = col.cy1;
      arr[valueIndex * 4 + 2] = col.cx2;
      arr[valueIndex * 4 + 3] = col.cy2;
      out[index].curve = arr;
      return { ok: true, value: out, componentWide: false, collinearized: true };
    }

    // bezier
    if (curve === "stepped") {
      if (n > 1 && !o.componentWide) return failIndex(index, "STEPPED_SHARED_UNSUPPORTED", { needsComponentWide: true });
      const out = clone(keys);
      const arr = [];
      for (let i = 0; i < n; i++) {
        const seg = collinearFor(keys, index, i, ctx);
        if (!pointsF32Ok(seg)) return failIndex(index, "CONTROL_POINTS_NOT_F32", { detail: "分量 " + i + " 共线控制点超出 float32" });
        arr.push(seg.cx1, seg.cy1, seg.cx2, seg.cy2);
      }
      out[index].curve = arr;
      return { ok: true, value: out, componentWide: n > 1, paddedComponents: true };
    }
    const hasThisComponent =
      hasBezierArray && curve.length >= valueIndex * 4 + 4 &&
      [0, 1, 2, 3].every(function (k) {
        return isFiniteNum(curve[valueIndex * 4 + k]);
      });
    const out = clone(keys);
    if (hasThisComponent) return { ok: true, value: out, componentWide: false, keptExisting: true };
    const base = defaultControlPoints(info.time1, info.value1, info.time2, info.value2);
    if (!pointsF32Ok(base)) return failIndex(index, "CONTROL_POINTS_NOT_F32", { detail: "默认控制点超出 float32" });
    const padded = !hasBezierArray || curve.length < 4 * n;
    writeSegmentControlsFrom(out, index, valueIndex, n, base, ctx);
    return { ok: true, value: out, componentWide: false, paddedComponents: padded };
  }

  /**
   * 设置控制点：四值必须有限；新写入强制 `time1 ≤ cx1 ≤ cx2 ≤ time2`（T16 裁定 3）；
   * cy 不限幅（只要求 f32 可表示）。
   * @returns {{ok:boolean, value?:Array, reason?:string}}
   */
  function setControlPoints(keys, index, valueIndex, points, opts) {
    const o = isObject(opts) ? opts : {};
    if (!Array.isArray(keys)) return failIndex(index, "KEYS_NOT_ARRAY");
    if (!(index >= 0) || index + 1 >= keys.length) return failIndex(index, "LAST_KEY_NO_SEGMENT");
    if (!isObject(points)) return failIndex(index, "POINTS_INVALID");
    const ctx = contextOf(o, keys[index]);
    const n = ctx.components;
    if (!n) return failIndex(index, "UNKNOWN_COMPONENTS");
    if (!(valueIndex >= 0 && valueIndex < n)) return failIndex(index, "VALUE_INDEX");
    const info = segmentInfo(keys[index], valueIndex, keys[index + 1], o);
    if (!info || !info.ok) return failIndex(index, info ? info.reason : "LAST_KEY_NO_SEGMENT");
    const vals = [points.cx1, points.cy1, points.cx2, points.cy2];
    for (const v of vals) if (!isFiniteNum(v)) return failIndex(index, "POINTS_NON_FINITE");
    for (const v of vals) if (!isF32Representable(v)) return failIndex(index, "POINTS_NOT_F32", { detail: String(v) });
    for (const cx of [points.cx1, points.cx2]) {
      if (cx < info.time1 - TIME_EPS || cx > info.time2 + TIME_EPS) return failIndex(index, "CX_OUT_OF_RANGE");
    }
    if (points.cx1 > points.cx2 + TIME_EPS) return failIndex(index, "CX_ORDER", { detail: "cx1>cx2" });
    const out = clone(keys);
    writeSegmentControlsFrom(out, index, valueIndex, n, {
      cx1: round6(points.cx1), cy1: round6(points.cy1), cx2: round6(points.cx2), cy2: round6(points.cy2),
    }, ctx);
    return { ok: true, value: out };
  }

  /** 供 Graph 手柄使用的段端点与两个控制点 */
  function handlesOf(keys, index, valueIndex, opts) {
    if (!Array.isArray(keys) || !(index >= 0) || index + 1 >= keys.length) return { ok: false, reason: "LAST_KEY_NO_SEGMENT" };
    const info = segmentInfo(keys[index], valueIndex, keys[index + 1], opts);
    if (!info) return { ok: false, reason: "LAST_KEY_NO_SEGMENT" };
    if (!info.ok) return { ok: false, reason: info.reason };
    const out = {
      ok: true,
      type: info.type,
      time1: info.time1, value1: info.value1, time2: info.time2, value2: info.value2,
      c1: null, c2: null,
    };
    if (info.type === "bezier") {
      out.c1 = { time: info.cx1, value: info.cy1 };
      out.c2 = { time: info.cx2, value: info.cy2 };
    }
    return out;
  }

  /**
   * 拖动手柄：cx 夹取到 [time1,time2]，cy 只要有限（不限幅）。
   * @param {'c1'|'c2'} which
   */
  function applyHandleDrag(keys, index, valueIndex, which, point, opts) {
    if (which !== "c1" && which !== "c2") return failIndex(index, "HANDLE_WHICH");
    if (!isObject(point)) return failIndex(index, "POINT_INVALID");
    const h = handlesOf(keys, index, valueIndex, opts);
    if (!h.ok) return failIndex(index, h.reason);
    if (h.type !== "bezier") return failIndex(index, "NOT_BEZIER");
    if (!isFiniteNum(point.time) || !isFiniteNum(point.value)) return failIndex(index, "POINTS_NON_FINITE");
    const next = { cx1: h.c1.time, cy1: h.c1.value, cx2: h.c2.time, cy2: h.c2.value };
    if (which === "c1") {
      /* c1 夹取到 [t1, min(cx2,t2)]，保证 t1 ≤ cx1 ≤ cx2 ≤ t2 */
      const hi = Math.min(h.time2, Math.max(h.time1, h.c2.time));
      next.cx1 = Math.min(hi, Math.max(h.time1, point.time));
      next.cy1 = point.value;
    } else {
      const lo = Math.max(h.time1, Math.min(h.time2, h.c1.time));
      next.cx2 = Math.max(lo, Math.min(h.time2, point.time));
      next.cy2 = point.value;
    }
    return setControlPoints(keys, index, valueIndex, next, opts);
  }

  /**
   * 轨道校验（只报不改）。
   * severity：error = 真的非法；warn = 可接受但需提示（末 key curve 官方忽略、cx1>cx2 原文只读）。
   * @returns {{ok:boolean, issues:Array<{path,code,message,severity}>}}
   */
  function validateTrackKeys(keys, valueIndex, opts) {
    const o = isObject(opts) ? opts : {};
    const issues = [];
    const push = function (p, code, message, severity) {
      issues.push({ path: p, code: code, message: message, severity: severity || "error" });
    };
    if (!Array.isArray(keys)) return { ok: false, issues: [Object.assign(issue("keys", "KEYS_NOT_ARRAY", "keys 必须是数组"), { severity: "error" })] };
    if (!keys.length) return { ok: false, issues: [Object.assign(issue("keys", "KEYS_EMPTY", "轨道没有 key"), { severity: "error" })] };
    let prevTime = null;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const p = "keys[" + i + "]";
      if (!isObject(k)) {
        push(p, "KEY_NOT_OBJECT", "key 必须是对象");
        continue;
      }
      const hasTime = hasOwn(k, "time");
      if (hasTime && !isFiniteNum(k.time)) push(p + ".time", "KEY_TIME", "time 必须是有限数");
      if (!hasTime) push(p + ".time", "KEY_TIME_MISSING", "key 没有 time 字段，官方按 0 处理（仅提示，不修）", "warn");
      const t = isFiniteNum(k.time) ? k.time : hasTime ? null : 0; // 缺省按官方 getValue(...,0) 视为 0 参与顺序检查
      if (t !== null && prevTime !== null) {
        if (t < prevTime - TIME_EPS) push(p + ".time", "KEY_OUT_OF_ORDER", "时间乱序：" + t + " < " + prevTime);
        else if (Math.abs(t - prevTime) <= TIME_EPS) push(p + ".time", "KEY_DUPLICATE_TIME", "重复时间：" + t);
      }
      if (t !== null) prevTime = t;
      const n = contextOf(o, k).components;
      const cv = curveValues(k, n);
      if (!cv.ok) push(p + ".curve", cv.reason, "curve 非法：" + cv.reason);
      else if (cv.crossed) push(p + ".curve", "CX_CROSSED", "cx1>cx2（原文保留，Graph 只读/诊断，不自动修）", "warn");
      if (cv.ok && cv.hasCurveField && i === keys.length - 1) {
        push(p + ".curve", "LAST_KEY_HAS_CURVE", "末 key 的 curve 没有出段，官方忽略（保留原文，仅提示）", "warn");
      }
      if (n && valueIndex >= 0 && valueIndex < n) {
        const v = keyField(k, valueIndex);
        if (v !== undefined && !isFiniteNum(v)) push(p + ".value", "KEY_VALUE_NON_FINITE", "值不是有限数");
        else if (v !== undefined && !isF32Representable(v)) {
          push(p + ".value", "KEY_VALUE_NOT_F32", "值超出 float32 可表示范围（写入 runtime 会变成 Infinity）");
        }
      }
      if (n === 0) push(p, "UNKNOWN_COMPONENTS", "无法从 key 推断分量数（既无 value 也无 x/y）");
    }
    const errors = issues.filter(function (x) {
      return x.severity === "error";
    });
    return { ok: errors.length === 0, issues: issues, errors: errors.length, warnings: issues.length - errors.length };
  }

  const api = Object.freeze({
    API_VERSION: API_VERSION,
    SEGMENT_TYPES: SEGMENT_TYPES,
    COMPONENT_COUNT: COMPONENT_COUNT,
    BEZIER_SEGMENTS: BEZIER_SEGMENTS,
    TIME_EPS: TIME_EPS,
    isF32Representable: isF32Representable,

    componentCount: componentCount,
    curveValues: curveValues,
    defaultControlPoints: defaultControlPoints,
    segmentInfo: segmentInfo,

    buildBezierTable: buildBezierTable,
    bezierValue: bezierValue,
    sampleSegment: sampleSegment,
    valueAt: valueAt,
    graphSamples: graphSamples,

    setSegmentType: setSegmentType,
    setControlPoints: setControlPoints,
    handlesOf: handlesOf,
    applyHandleDrag: applyHandleDrag,
    validateTrackKeys: validateTrackKeys,
  });

  global.SpineCurveEdit = api;
  if (typeof window !== "undefined" && window.SpineCurveEdit !== api) window.SpineCurveEdit = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
