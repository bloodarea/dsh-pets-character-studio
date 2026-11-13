/*
 * key-inspector.js —— 规划书 §5.4「当前帧属性检查器」的**纯逻辑**层
 * 边界（与 timeline / frame-timeline / anim-edit 一致）：
 *   本文件不碰 DOM、不写动画数据。只做三件事：
 *     1) 把「选中的 Key」规范化成检查器要显示的字段（Property / Target / Frame / Time / Value / 插值）；
 *     2) 把用户输入的文本**解析**成该轨道该字段的正确写入值（并在失败时给可读原因，不猜）；
 *     3) 校验一次「改值 / 改插值」请求是否允许（曲线段只读、锁定轨、越界时间）。
 *   真正的写入仍由调用方用 SpineAnimEdit.setKeyValues / setKeyCurve 执行。
 *
 * 为什么单独拆：§5.4 的难点不在画面板，而在「一段文本 → 该字段的正确 JSON 形状」。
 *   rotate 是数字；translate/scale/shear 是 {x,y}；attachment 是字符串或 null；
 *   color 是 RRGGBB[AA] 十六进制；twoColor 是 {light,dark}。把这段逻辑放进 DOM 代码里就没法测。
 */
(function (global) {
  "use strict";

  const API_VERSION = 1;
  const HEX_RE = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const SEP_RE = /[\s,，、]+/;

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

  /** 该轨道字段的输入形态 */
  function valueShape(kind, field) {
    if (kind === "bone") {
      if (field === "rotate") return "scalar";
      if (field === "translate" || field === "scale" || field === "shear") return "vec2";
      return "raw";
    }
    if (kind === "slot") {
      if (field === "attachment") return "attachment";
      if (field === "color") return "color";
      if (field === "twoColor") return "colorPair";
      return "raw";
    }
    return "raw";
  }

  function fieldLabel(kind, field) {
    const map = {
      rotate: "旋转",
      translate: "位移",
      scale: "缩放",
      shear: "斜切",
      attachment: "附件",
      color: "颜色",
      twoColor: "双色",
    };
    if (map[field]) return map[field];
    return String(field == null ? "" : field);
  }

  function unitOf(kind, field) {
    if (kind === "bone") {
      if (field === "rotate" || field === "shear") return "°";
      if (field === "translate") return "px";
      if (field === "scale") return "×";
    }
    return "";
  }

  /* ------------------------------------------------------------------ *
   * 1. 选中 Key → 检查器视图模型
   * ------------------------------------------------------------------ */

  /**
   * @param {{kind:string, owner:string, field:string, time:number, value:*, curve?:*,
   *          fps:number, duration:number, locked?:boolean, bezierLocked?:boolean}} input
   * @returns {{ok:boolean, view:object|null, issues:Array}}
   *   view = { kind, owner, field, label, unit, shape, frame, time, valueText, curveType, editable, readOnlyReason }
   */
  function describe(input) {
    const inp = isObject(input) ? input : {};
    const issues = [];
    const kind = typeof inp.kind === "string" ? inp.kind : "";
    const owner = typeof inp.owner === "string" ? inp.owner : "";
    const field = typeof inp.field === "string" ? inp.field : "";
    if (!kind || !owner || !field) {
      return { ok: false, view: null, issues: [issue("key", "KEY_INSPECT_TARGET", "缺少 kind/owner/field")] };
    }
    if (!isFiniteNum(inp.time)) {
      return { ok: false, view: null, issues: [issue("time", "KEY_INSPECT_TIME", "关键帧时间必须是有限数")] };
    }
    const fps = isFiniteNum(inp.fps) && inp.fps > 0 ? inp.fps : 30;
    const shape = valueShape(kind, field);
    const curveType = curveTypeOf(inp.curve);
    /* 只读判定：锁定轨 / 曲线段 / 未知形状。三者都要给出**可读原因**，不能只 disable 了事。 */
    let editable = true;
    let readOnlyReason = null;
    if (inp.locked === true) {
      editable = false;
      readOnlyReason = "该轨道已锁定（先解锁再改）";
    } else if (shape === "raw") {
      editable = false;
      readOnlyReason = "该字段结构未知，检查器不猜它的值形状（请用轨道属性面板）";
    }
    return {
      ok: true,
      view: {
        kind: kind,
        owner: owner,
        field: field,
        label: fieldLabel(kind, field),
        unit: unitOf(kind, field),
        shape: shape,
        frame: Math.round(inp.time * fps),
        time: inp.time,
        valueText: formatValueForInput(shape, inp.value),
        value: inp.value,
        curveType: curveType,
        /* 曲线段只读只影响「移动/删除时间」，**改值仍允许**（与 Dopesheet 的既有规则一致） */
        bezierLocked: inp.bezierLocked === true,
        editable: editable,
        readOnlyReason: readOnlyReason,
        fps: fps,
      },
      issues: issues,
    };
  }

  function curveTypeOf(curve) {
    if (curve === "stepped") return "stepped";
    if (Array.isArray(curve) && curve.length) return "bezier";
    return "linear";
  }

  /** 值 → 输入框文本（round 到 4 位，避免浮点噪声刷屏） */
  function formatValueForInput(shape, value) {
    if (shape === "scalar") return isFiniteNum(value) ? String(round(value, 4)) : "";
    if (shape === "vec2") {
      if (!isObject(value)) return "";
      return round(numOr(value.x, 0), 4) + ", " + round(numOr(value.y, 0), 4);
    }
    if (shape === "attachment") return value == null ? "" : String(value);
    if (shape === "color") return value == null ? "" : String(value);
    if (shape === "colorPair") {
      if (!isObject(value)) return "";
      const l = value.light == null ? "" : String(value.light);
      const d = value.dark == null ? "" : String(value.dark);
      return l + (d ? " / " + d : "");
    }
    return "";
  }

  function numOr(v, d) {
    return isFiniteNum(v) ? v : d;
  }

  /* ------------------------------------------------------------------ *
   * 2. 文本 → 写入值（解析失败要给出可读原因，绝不猜）
   * ------------------------------------------------------------------ */

  /**
   * @param {{shape:string, text:string, kind?:string, field?:string}} input
   * @returns {{ok:boolean, values:object|null, issues:Array}}
   *   values 是**直接喂给 SpineAnimEdit.setKeyValues 的字段对象**：
   *     scalar → {value:number}；vec2 → {x,y}；attachment → {name:string|null}；
   *     color → {value:"RRGGBB[AA]"}；colorPair → {light,dark}
   */
  function parseValueInput(input) {
    const inp = isObject(input) ? input : {};
    const shape = typeof inp.shape === "string" ? inp.shape : "raw";
    const raw = typeof inp.text === "string" ? inp.text : "";
    const text = raw.trim();
    if (shape === "scalar") {
      if (text === "") return fail("VALUE_EMPTY", "数值不能为空");
      const n = Number(text);
      if (!isFiniteNum(n)) return fail("VALUE_NOT_NUMBER", "「" + raw + "」不是合法数字");
      return { ok: true, values: { value: n }, issues: [] };
    }
    if (shape === "vec2") {
      const parts = text === "" ? [] : text.split(SEP_RE).filter((s) => s !== "");
      if (parts.length !== 2) {
        return fail("VALUE_VEC2_ARITY", "需要两个数字（x, y），当前是 " + parts.length + " 个：" + raw);
      }
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (!isFiniteNum(x) || !isFiniteNum(y)) return fail("VALUE_NOT_NUMBER", "「" + raw + "」里有非数字");
      return { ok: true, values: { x: x, y: y }, issues: [] };
    }
    if (shape === "attachment") {
      /* 空串 = null = 隐藏该槽（Spine 官方 null 语义），这是**有意**的映射，不是丢输入 */
      return { ok: true, values: { name: text === "" ? null : text }, issues: [] };
    }
    if (shape === "color") {
      if (text === "") return fail("VALUE_EMPTY", "颜色不能为空（要清空请删除该 Key）");
      const m = HEX_RE.exec(text);
      if (!m) return fail("VALUE_NOT_HEX", "颜色必须是 RRGGBB 或 RRGGBBAA（6 或 8 位十六进制），当前：" + raw);
      return { ok: true, values: { value: m[1].toUpperCase() }, issues: [] };
    }
    if (shape === "colorPair") {
      const parts = text.split("/").map((s) => s.trim()).filter((s) => s !== "");
      if (parts.length !== 2) {
        return fail("VALUE_PAIR_ARITY", "双色需要「亮 / 暗」两段，当前是 " + parts.length + " 段：" + raw);
      }
      const l = HEX_RE.exec(parts[0]);
      const d = HEX_RE.exec(parts[1]);
      if (!l || !d) return fail("VALUE_NOT_HEX", "亮/暗都必须是 RRGGBB 或 RRGGBBAA：" + raw);
      return { ok: true, values: { light: l[1].toUpperCase(), dark: d[1].toUpperCase() }, issues: [] };
    }
    return fail("VALUE_SHAPE_UNKNOWN", "未知的值形状：" + shape);

    function fail(code, message) {
      return { ok: false, values: null, issues: [issue("text", code, message)] };
    }
  }

  /* ------------------------------------------------------------------ *
   * 3. 写入前的准入校验
   * ------------------------------------------------------------------ */

  /**
   * @param {{locked?:boolean, curveType?:string, op:'value'|'interpolation', targetTime?:number, duration?:number}} input
   * @returns {{ok:boolean, issues:Array}}
   */
  function checkWrite(input) {
    const inp = isObject(input) ? input : {};
    const issues = [];
    if (inp.locked === true) {
      issues.push(issue("row", "KEY_WRITE_LOCKED", "该轨道已锁定，禁止写入"));
    }
    if (inp.op === "interpolation") {
      /* 末关键帧没有出段：官方 Animation.ts 里末 frame 默认 STEPPED，改它没有意义 */
      if (inp.isLastKey === true) {
        issues.push(issue("curve", "KEY_LAST_NO_SEGMENT", "这是最后一个关键帧：它没有出段，插值设置不生效"));
      }
      if (inp.curveType === "bezier") {
        issues.push(issue("curve", "KEY_CURVE_SEGMENT_READONLY", "该关键帧位于贝塞尔曲线段内：改插值会破坏曲线语义（曲线段只读）"));
      }
    }
    if (inp.op === "value" && isFiniteNum(inp.targetTime) && isFiniteNum(inp.duration) && inp.targetTime > inp.duration + 1e-9) {
      issues.push(issue("time", "KEY_WRITE_OVER_DURATION", "目标时间超过动画时长 " + round(inp.duration, 3) + "s"));
    }
    return { ok: issues.length === 0, issues: issues };
  }

  /** 三个插值按钮 → SpineAnimEdit.setKeyCurve 的 segment 参数 */
  function segmentFor(type) {
    if (type === "stepped") return { type: "stepped" };
    if (type === "linear") return { type: "linear" };
    if (type === "bezier") return { type: "bezier" };
    return null;
  }

  /** 状态栏一行描述（§5.4 的五项压成一句） */
  function describeLine(view, opts) {
    if (!view) return "未选中关键帧";
    const o = isObject(opts) ? opts : {};
    const d = isFiniteNum(o.decimals) ? o.decimals : 3;
    return (
      view.label + " · " + view.owner + " · 帧 " + view.frame + " · " + round(view.time, d) + "s · " +
      (view.valueText === "" ? "（空）" : view.valueText + (view.unit || "")) + " · " + view.curveType
    );
  }

  /* ------------------------------------------------------------------ *
   * 4. §5.3 全身姿态：哪些属性真的需要写
   * ------------------------------------------------------------------ */

  /**
   * 判断一个属性在当前时刻是否需要新 Key。
   *
   * §5.3 要求「全身记录必须提供范围确认，避免产生不必要的大量关键帧」，
   * 所以除了确认范围，还要**逐属性判差异**：值没变就不写。
   * 这段判定是纯逻辑，抽出来才能测（DOM 里的 keyFullPose 只负责调用与写盘）。
   *
   * @param {{field:string, next:object, current:object|null, eps?:number}} input
   *   next    = anim-edit.relativeValues 的结果（rotate → {value}；vec2 → {x,y}）
   *   current = 该轨在此时刻**已有 Key** 的值；null 表示没有 Key
   * @returns {{ok:boolean, needed:boolean, reason:string, issues:Array}}
   *   needed=true  → 需要写入
   *   needed=false → 跳过（reason 说明为什么）
   */
  function needsFullPoseKey(input) {
    const inp = isObject(input) ? input : {};
    const field = typeof inp.field === "string" ? inp.field : "";
    const next = inp.next;
    if (!isObject(next)) {
      return { ok: false, needed: false, reason: "没有可写入的值", issues: [issue("next", "FULLPOSE_VALUE_MISSING", "relativeValues 没有给出值")] };
    }
    /* 没有既有 Key：必须写（否则该属性在这个时刻没有数据） */
    if (inp.current === null || inp.current === undefined) {
      return { ok: true, needed: true, reason: "该时刻没有既有 Key", issues: [] };
    }
    const cur = inp.current;
    const eps = isFiniteNum(inp.eps) && inp.eps >= 0 ? inp.eps : 1e-6;
    if (field === "rotate") {
      if (!isFiniteNum(next.value) || !isFiniteNum(cur.value)) {
        return { ok: false, needed: false, reason: "旋转值不是有限数", issues: [issue("next.value", "FULLPOSE_NOT_NUMBER", "旋转值必须有限")] };
      }
      const same = Math.abs(next.value - cur.value) <= eps;
      return { ok: true, needed: !same, reason: same ? "与既有 Key 相同（跳过）" : "与既有 Key 不同", issues: [] };
    }
    /* vec2 类（translate / scale / shear） */
    if (!isFiniteNum(next.x) || !isFiniteNum(next.y) || !isFiniteNum(cur.x) || !isFiniteNum(cur.y)) {
      return { ok: false, needed: false, reason: "分量不是有限数", issues: [issue("next", "FULLPOSE_NOT_NUMBER", "x/y 必须有限")] };
    }
    const same = Math.abs(next.x - cur.x) <= eps && Math.abs(next.y - cur.y) <= eps;
    return { ok: true, needed: !same, reason: same ? "与既有 Key 相同（跳过）" : "与既有 Key 不同", issues: [] };
  }

  /**
   * 估算一次全身姿态打键的规模（供确认框展示「最多 N 个」）。
   * @param {{boneCount:number, fields?:string[]}} input
   */
  function estimateFullPose(input) {
    const inp = isObject(input) ? input : {};
    const bones = isFiniteNum(inp.boneCount) && inp.boneCount > 0 ? Math.round(inp.boneCount) : 0;
    const fields = Array.isArray(inp.fields) && inp.fields.length ? inp.fields.length : 3;
    return { bones: bones, fieldsPerBone: fields, maxKeys: bones * fields };
  }

  /* ------------------------------------------------------------------ *
   * 5. 事件/约束字段 → 控件类型（§4.5）
   * ------------------------------------------------------------------ */

  /**
   * SCHEMA 字段类型 → 该用哪种控件。
   *
   * 为什么要有这个函数：§4.5 的 event 字段里 `string` 是**文本**，
   * 早先 UI 只区分 bool 与「其他」，把文本字段渲染成 number 输入框，
   * 输入的文字被 Number() 转成 NaN 后**静默丢弃**（表现为"填了参数但没写进去"）。
   * 把映射抽出来才能测住这类错误。
   *
   * @param {{type:string, name?:string, int?:boolean}} field
   * @param {{enumNames?:Array<string>}} [opts] 有候选值时用下拉
   * @returns {{ok:boolean, control:'checkbox'|'select'|'text'|'number'|'unknown', reason:string, issues:Array}}
   */
  function controlForField(field, opts) {
    const f = isObject(field) ? field : {};
    const o = isObject(opts) ? opts : {};
    const type = typeof f.type === "string" ? f.type : "";
    if (Array.isArray(o.enumNames) && o.enumNames.length) {
      return { ok: true, control: "select", reason: "有候选值，用下拉更不容易写错", issues: [] };
    }
    if (type === "bool" || type === "boolean") return { ok: true, control: "checkbox", reason: "布尔值", issues: [] };
    if (type === "string") return { ok: true, control: "text", reason: "文本字段（不能按数字解析）", issues: [] };
    if (type === "number") return { ok: true, control: "number", reason: f.int === true ? "整数" : "数字", issues: [] };
    if (type === "offsets") return { ok: true, control: "unknown", reason: "偏移列表由专用控件处理", issues: [] };
    return {
      ok: false, control: "unknown", reason: "未知字段类型：" + type,
      issues: [issue("type", "FIELD_TYPE_UNKNOWN", "未知字段类型：" + (type || "(空)"))],
    };
  }

  /**
   * 把用户输入按字段类型解析成写入值。
   * `string` 字段**绝不**转数字；空串按显式清空处理（null）。
   * @param {{type:string, text:string}} input
   * @returns {{ok:boolean, value:*, issues:Array}}
   */
  function parseFieldInput(input) {
    const inp = isObject(input) ? input : {};
    const type = typeof inp.type === "string" ? inp.type : "";
    const raw = typeof inp.text === "string" ? inp.text : "";
    if (type === "string") {
      return { ok: true, value: raw === "" ? null : raw, issues: [] };
    }
    if (type === "bool" || type === "boolean") {
      return { ok: true, value: raw === "true" || raw === "1", issues: [] };
    }
    if (type === "number") {
      const t = raw.trim();
      if (t === "") return { ok: true, value: null, issues: [] };
      const n = Number(t);
      if (!isFiniteNum(n)) {
        return { ok: false, value: null, issues: [issue("text", "FIELD_NOT_NUMBER", "「" + raw + "」不是合法数字")] };
      }
      return { ok: true, value: n, issues: [] };
    }
    return { ok: false, value: null, issues: [issue("type", "FIELD_TYPE_UNKNOWN", "未知字段类型：" + (type || "(空)"))] };
  }

  const api = {
    API_VERSION: API_VERSION,
    valueShape: valueShape,
    fieldLabel: fieldLabel,
    unitOf: unitOf,
    curveTypeOf: curveTypeOf,
    formatValueForInput: formatValueForInput,
    describe: describe,
    parseValueInput: parseValueInput,
    checkWrite: checkWrite,
    segmentFor: segmentFor,
    describeLine: describeLine,
    needsFullPoseKey: needsFullPoseKey,
    estimateFullPose: estimateFullPose,
    controlForField: controlForField,
    parseFieldInput: parseFieldInput,
  };

  global.SpineKeyInspector = api;
  if (typeof window !== "undefined" && window.SpineKeyInspector !== api) window.SpineKeyInspector = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
