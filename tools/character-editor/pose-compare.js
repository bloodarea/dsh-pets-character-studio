/*
 * pose-compare.js —— 前后帧姿态对照（规划书 §14 P4「前后帧姿态对照」）· 纯模块
 * 边界（与 spine-core / timeline / frame-timeline 一致）：
 *   本文件不碰 DOM / Canvas / fetch / 磁盘 IO。只接受**已求值的姿态**（spine-core evalPose 产物）
 *   与普通对象，返回纯数据；浏览器暴露 window.SpinePoseCompare，Node 里是 globalThis.SpinePoseCompare。
 *
 * 职责边界（勿越界）：
 *   - 本模块**不**调用 evalPose、不读模型、不改任何数据。求值仍由调用方（app.js / 测试）负责，
 *     这样「对照」这件事可以被单独测试，不会把求值错误和比较错误混在一起。
 *   - 只做**量化与描述**：哪些骨变了、变了多少、按什么排序、哪些字段贡献最大。
 *     不判断「这个变化对不对」——那是人的工作。
 *
 * 关键概念：
 *   - 姿态 = { local: [{x,y,rotation,scaleX,scaleY,shearX,shearY}], world: [{a,b,c,d,tx,ty}] }
 *   - 比较分两层：local（局部变换，动画数据的直接结果）与 world（世界变换，含父链累积）。
 *     **必须分开报**：父骨转了，子骨 world 会跟着变，但子骨 local 没变 —— 混在一起会误判「子骨被改了」。
 *   - rotation 单位是**度**（spine-core 的 local.rotation），世界矩阵只报平移与角度。
 */
(function (global) {
  "use strict";

  const API_VERSION = 1;
  const LOCAL_FIELDS = Object.freeze(["x", "y", "rotation", "scaleX", "scaleY", "shearX", "shearY"]);
  const FIELD_LABELS = Object.freeze({
    x: "位移 X",
    y: "位移 Y",
    rotation: "旋转",
    scaleX: "缩放 X",
    scaleY: "缩放 Y",
    shearX: "斜切 X",
    shearY: "斜切 Y",
    tx: "世界 X",
    ty: "世界 Y",
    angle: "世界角度",
  });
  /* 每字段的「显著」阈值：低于此值视为数值噪声（float32 时间与三角函数累积）。
     rotation/shear 用度，位移/缩放用模型单位。这些是**默认值**，调用方可覆盖。 */
  const DEFAULT_EPS = Object.freeze({
    x: 1e-4,
    y: 1e-4,
    rotation: 1e-3,
    scaleX: 1e-5,
    scaleY: 1e-5,
    shearX: 1e-3,
    shearY: 1e-3,
    tx: 1e-4,
    ty: 1e-4,
    angle: 1e-3,
  });

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
    const p = Math.pow(10, digits == null ? 4 : digits);
    return Math.round(v * p) / p;
  }
  function issue(path, code, message) {
    return { path: String(path == null ? "" : path), code: code, message: String(message || code) };
  }
  function epsOf(opts, field) {
    const e = isObject(opts) && isObject(opts.eps) ? opts.eps : null;
    const v = e ? e[field] : undefined;
    if (isFiniteNum(v) && v >= 0) return v;
    return numOr(DEFAULT_EPS[field], 1e-4);
  }

  /* ------------------------------------------------------------------ *
   * 世界矩阵 → 可读量
   * ------------------------------------------------------------------ */

  /** 2D 仿射矩阵 {a,b,c,d,tx,ty} 的旋转角（度）与尺度 */
  function worldAngle(w) {
    if (!isObject(w)) return NaN;
    const a = numOr(w.a, 1);
    const b = numOr(w.b, 0);
    return (Math.atan2(b, a) * 180) / Math.PI;
  }

  function worldScale(w) {
    if (!isObject(w)) return { sx: NaN, sy: NaN };
    const a = numOr(w.a, 1);
    const b = numOr(w.b, 0);
    const c = numOr(w.c, 0);
    const d = numOr(w.d, 1);
    return { sx: Math.hypot(a, b), sy: Math.hypot(c, d) };
  }

  /** 角度差归一化到 (-180, 180]，避免 359° 与 1° 被算成 358° */
  function angleDelta(a, b) {
    if (!isFiniteNum(a) || !isFiniteNum(b)) return NaN;
    let d = a - b;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    return d;
  }

  /* ------------------------------------------------------------------ *
   * 单骨比较
   * ------------------------------------------------------------------ */

  /**
   * 比较同一根骨在两帧的 local + world。
   * @param {string} name 骨名（仅用于报告）
   * @param {object} a 前一帧 local
   * @param {object} b 后一帧 local
   * @param {object} [wa] 前一帧 world
   * @param {object} [wb] 后一帧 world
   * @param {object} [opts] {eps:{field:number}}
   * @returns {{ok:boolean, name:string, changed:boolean, localChanged:boolean, worldChanged:boolean,
   *            fields:Array<{field,label,from,to,delta,absDelta,significant}>, maxField:string|null,
   *            maxAbsDelta:number, issues:Array}}
   */
  function compareBone(name, a, b, wa, wb, opts) {
    const issues = [];
    if (!isObject(a) || !isObject(b)) {
      return {
        ok: false, name: String(name), changed: false, localChanged: false, worldChanged: false,
        fields: [], maxField: null, maxAbsDelta: 0,
        issues: [issue("local", "POSE_LOCAL_INVALID", "两帧的 local 必须是对象")],
      };
    }
    const fields = [];
    let maxField = null;
    let maxAbsDelta = 0;
    for (const f of LOCAL_FIELDS) {
      const from = a[f];
      const to = b[f];
      if (!isFiniteNum(from) || !isFiniteNum(to)) continue;
      /* rotation / shear 用角度差归一化；其余直接差 */
      const delta = f === "rotation" || f === "shearX" || f === "shearY" ? angleDelta(to, from) : to - from;
      const absDelta = Math.abs(delta);
      const eps = epsOf(opts, f);
      const significant = absDelta > eps;
      fields.push({ field: f, label: FIELD_LABELS[f] || f, from: from, to: to, delta: delta, absDelta: absDelta, significant: significant });
      if (significant && absDelta > maxAbsDelta) {
        maxAbsDelta = absDelta;
        maxField = f;
      }
    }
    /* world 层：只报平移与角度（尺度差通常由父链缩放引起，噪声大，不参与「谁变了」的判定） */
    const worldFields = [];
    if (isObject(wa) && isObject(wb)) {
      const pairs = [
        ["tx", numOr(wa.tx, 0), numOr(wb.tx, 0)],
        ["ty", numOr(wa.ty, 0), numOr(wb.ty, 0)],
      ];
      for (const p of pairs) {
        const delta = p[2] - p[1];
        const absDelta = Math.abs(delta);
        worldFields.push({ field: p[0], label: FIELD_LABELS[p[0]], from: p[1], to: p[2], delta: delta, absDelta: absDelta, significant: absDelta > epsOf(opts, p[0]) });
      }
      const angA = worldAngle(wa);
      const angB = worldAngle(wb);
      const ad = angleDelta(angB, angA);
      worldFields.push({ field: "angle", label: FIELD_LABELS.angle, from: angA, to: angB, delta: ad, absDelta: Math.abs(ad), significant: Math.abs(ad) > epsOf(opts, "angle") });
    }
    const localChanged = fields.some((f) => f.significant);
    const worldChanged = worldFields.some((f) => f.significant);
    return {
      ok: true,
      name: String(name),
      changed: localChanged || worldChanged,
      localChanged: localChanged,
      worldChanged: worldChanged,
      fields: fields,
      worldFields: worldFields,
      maxField: maxField,
      maxAbsDelta: maxAbsDelta,
      issues: issues,
    };
  }

  /* ------------------------------------------------------------------ *
   * 整帧比较
   * ------------------------------------------------------------------ */

  /**
   * 比较两个完整姿态。
   * @param {{poseA:object, poseB:object, names?:string[], opts?:object}} input
   *   names 缺省用 model 顺序索引；没有名字时用 "#<index>"。
   * @returns {{ok:boolean, bones:Array, changedCount:number, localChangedCount:number,
   *            worldChangedCount:number, total:number, top:Array, issues:Array}}
   *   bones 按 |最大变化| 降序（变化大的在前），便于「一眼看出谁动得最多」。
   */
  function comparePose(input) {
    const inp = isObject(input) ? input : {};
    const pa = inp.poseA;
    const pb = inp.poseB;
    if (!isObject(pa) || !isObject(pb)) {
      return {
        ok: false, bones: [], changedCount: 0, localChangedCount: 0, worldChangedCount: 0, total: 0, top: [],
        issues: [issue("pose", "POSE_INVALID", "poseA 与 poseB 都必须是对象")],
      };
    }
    const la = Array.isArray(pa.local) ? pa.local : [];
    const lb = Array.isArray(pb.local) ? pb.local : [];
    const wa = Array.isArray(pa.world) ? pa.world : [];
    const wb = Array.isArray(pb.world) ? pb.world : [];
    const n = Math.min(la.length, lb.length);
    const names = Array.isArray(inp.names) ? inp.names : [];
    const issues = [];
    if (la.length !== lb.length) {
      issues.push(issue("pose.local", "POSE_LENGTH_MISMATCH", "两帧 local 长度不同：" + la.length + " vs " + lb.length));
    }
    const bones = [];
    for (let i = 0; i < n; i++) {
      const name = typeof names[i] === "string" ? names[i] : "#" + i;
      const r = compareBone(name, la[i], lb[i], wa[i], wb[i], inp.opts);
      if (r.ok) bones.push(r);
    }
    bones.sort((x, y) => y.maxAbsDelta - x.maxAbsDelta || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    let changedCount = 0;
    let localChangedCount = 0;
    let worldChangedCount = 0;
    for (const b of bones) {
      if (b.changed) changedCount++;
      if (b.localChanged) localChangedCount++;
      if (b.worldChanged) worldChangedCount++;
    }
    return {
      ok: true,
      bones: bones,
      changedCount: changedCount,
      localChangedCount: localChangedCount,
      worldChangedCount: worldChangedCount,
      total: bones.length,
      top: bones.filter((b) => b.changed).slice(0, numOr(inp.topN, 5)),
      issues: issues,
    };
  }

  /**
   * 一行摘要（状态栏 / 报告用）。只描述事实，不评价好坏。
   *
   * 表述优先级（这条顺序很重要）：
   *   1) **局部变化**才是「动画数据真的改了」的证据 —— 优先报它；
   *   2) 世界变化里绝大多数是父链带动的（父骨一转，所有后代 world 都变），
   *      相邻帧上这个数字接近骨总数、几乎没有信息量，所以只在「局部为 0 但有世界变化」时才强调；
   *   3) 两者都为 0 才算「一致」。
   */
  function summaryLine(result, opts) {
    if (!result || !result.ok) return "姿态对照不可用";
    const o = isObject(opts) ? opts : {};
    const d = isFiniteNum(o.decimals) ? o.decimals : 2;
    const local = numOr(result.localChangedCount, 0);
    const world = numOr(result.worldChangedCount, 0);
    const total = numOr(result.total, 0);
    if (!result.changedCount) return "两帧姿态一致（" + total + " 根骨全部无显著变化）";
    const parts = [];
    if (local) {
      parts.push("局部变化 " + local + "/" + total + " 根骨");
      if (world > local) parts.push("另有 " + (world - local) + " 根仅父链带动");
    } else {
      /* 没有局部变化、只有世界变化：说明这一帧区间内本骨自身没动，是父链在动 */
      parts.push("无局部变化；" + world + "/" + total + " 根仅父链带动");
    }
    const top = (result.top || []).filter((b) => b.localChanged)[0] || (result.top || [])[0];
    if (top && top.maxField) {
      const f = (top.fields || []).find((x) => x.field === top.maxField);
      if (f) parts.push("最大：" + top.name + " " + f.label + " " + round(f.delta, d));
    }
    return parts.join("；");
  }

  /**
   * 把对照结果压成「骨名 → 变更摘要」表，供并排面板渲染。
   * @returns {Array<{name:string, local:boolean, world:boolean, cells:object, text:string}>}
   */
  function diffTable(result, opts) {
    if (!result || !result.ok) return [];
    const o = isObject(opts) ? opts : {};
    const d = isFiniteNum(o.decimals) ? o.decimals : 3;
    const onlyChanged = o.onlyChanged !== false;
    const out = [];
    for (const b of result.bones) {
      if (onlyChanged && !b.changed) continue;
      const cells = {};
      for (const f of b.fields) {
        if (!f.significant) continue;
        cells[f.field] = { from: round(f.from, d), to: round(f.to, d), delta: round(f.delta, d) };
      }
      const texts = b.fields.filter((f) => f.significant).map((f) => f.label + " " + round(f.delta, d));
      out.push({
        name: b.name,
        local: b.localChanged,
        world: b.worldChanged,
        cells: cells,
        text: texts.length ? texts.join("、") : "（仅父链带动）",
      });
    }
    return out;
  }

  const api = {
    API_VERSION: API_VERSION,
    LOCAL_FIELDS: LOCAL_FIELDS,
    FIELD_LABELS: FIELD_LABELS,
    DEFAULT_EPS: DEFAULT_EPS,

    worldAngle: worldAngle,
    worldScale: worldScale,
    angleDelta: angleDelta,

    compareBone: compareBone,
    comparePose: comparePose,
    summaryLine: summaryLine,
    diffTable: diffTable,
  };

  global.SpinePoseCompare = api;
  if (typeof window !== "undefined" && window.SpinePoseCompare !== api) window.SpinePoseCompare = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
