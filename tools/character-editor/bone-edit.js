/*
 * bone-edit.js —— 骨骼 gizmo / 坐标换算 / 拾取 · 纯模块（无 DOM、无 fetch、无 canvas）
 *
 * 边界：
 *   本文件只做数学与几何，不碰 DOM / window 之外的东西，不读模型、不改动画。
 *   浏览器暴露 window.SpineBoneEdit；Node 里是 globalThis.SpineBoneEdit（selftest 复用）。
 *
 * 矩阵约定（与 spine-core.js 的 pose.world / localMatrix 完全一致）：
 *   m = {a,b,c,d,tx,ty}，点变换为
 *     x' = a*x + c*y + tx
 *     y' = b*x + d*y + ty
 *   线性部分 L = [[a,c],[b,d]]；m 的第 1 列 (a,b) 是骨骼局部 +X 轴的世界方向，
 *   第 2 列 (c,d) 是局部 +Y 轴方向。parent * local 用 SpineBoneEdit.mul。
 *
 * 坐标语义（顾问裁定，2026-11-08；P1 修订见下）：
 *   - 平移：Δlocal = P.linear⁻¹ · Δworld（P = 父级世界矩阵；无父级时 P = 单位阵）。
 *   - 旋转：**parent/local 空间的角差必须在父级坐标系里取**：把 v0/v 先经 H⁻¹
 *           （H = 父级世界矩阵）映射，再取 atan2 差。父级为非相似变换（如 diag(2,1)）时，
 *           世界角差 ≠ 局部角差（世界 26.565° 对应局部 45°），所以不能直接用世界角差。
 *           仅 space:'world' 才用世界角差，并且要求 H 是相似变换（见 canWorldRotate），
 *           反射时按 sign(det H) 反号。
 *   - 缩放：等比可任意可逆 H 下按距离比乘；单轴缩放按**骨骼自身轴基**
 *           B0 = H·localLinear(L0)（含 shear，等于真实骨世界线性的两列）取分量比；
 *           世界单轴缩放需要 H⁻¹ Q diag(fx,fy) Q⁻¹ H，残差不过就应禁用（本模块不提供该近似）。
 *   - Local 平移：轴基用骨自身世界线性 B = W.linear，dLocal = B⁻¹·Δworld，做轴约束后
 *           再回父级：Δparent = H⁻¹·B·dLocal（free 分支 ≈ H⁻¹·Δworld，与 parent 逐位一致）。
 *   - 所有函数遇到退化矩阵 / 非有限输入 / 零距离一律返回 {ok:false, reason}，不抛错、不产生 NaN。
 */
(function (global) {
  "use strict";

  var API_VERSION = 1;

  /*
   * 契约别名（editor-p0-contract.md §4.2/§4.3/§4.4）：模块内部沿用短码，集成方用 EDIT_CODES
   * 把内部 reason 翻成契约公开错误码，避免在 UI 里出现两套命名。
   *   PARENT_SINGULAR                  → EDIT_PARENT_SINGULAR        父矩阵不可逆，不提交
   *   WORLD_ROTATE_UNSUPPORTED         → EDIT_WORLD_ROTATE_UNSUPPORTED
   *   WORLD_AXIS_SCALE_UNSUPPORTED     → EDIT_WORLD_AXIS_SCALE_UNSUPPORTED
   *   AXIS_DEGENERATE / AXIS_BASE_ZERO → EDIT_AFFINE_UNREPRESENTABLE  轴基退化，无法表示
   *   START_DISTANCE_ZERO / DISTANCE_INVALID / FACTOR_INVALID
   *                                    → EDIT_SCALE_DEGENERATE
   */
  var EDIT_CODES = {
    PARENT_SINGULAR: "EDIT_PARENT_SINGULAR",
    WORLD_ROTATE_UNSUPPORTED: "EDIT_WORLD_ROTATE_UNSUPPORTED",
    WORLD_AXIS_SCALE_UNSUPPORTED: "EDIT_WORLD_AXIS_SCALE_UNSUPPORTED",
    AXIS_DEGENERATE: "EDIT_AFFINE_UNREPRESENTABLE",
    AXIS_BASE_ZERO: "EDIT_AFFINE_UNREPRESENTABLE",
    START_DISTANCE_ZERO: "EDIT_SCALE_DEGENERATE",
    DISTANCE_INVALID: "EDIT_SCALE_DEGENERATE",
    FACTOR_INVALID: "EDIT_SCALE_DEGENERATE",
    INHERIT_UNSUPPORTED: "EDIT_INHERIT_UNSUPPORTED",
    /* P2-03 轴心补偿：世界线性奇异 ⇒ 局部平移无法表示所需世界位移（不提交、不写坏数据） */
    COMPENSATE_SINGULAR: "EDIT_COMPENSATE_UNREPRESENTABLE",
  };

  /** 内部 reason → 契约公开错误码；未知码原样返回 */
  function editCode(reason) {
    return EDIT_CODES[reason] || reason;
  }

  /* ==========================================================================
   * 0. 小工具
   * ====================================================================== */
  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /** 原点常量（减少临时对象；只读，勿改） */
  var ZERO = { x: 0, y: 0 };

  /** 归一到 (-180, 180]（与 spine-core.wrap180 同口径） */
  function wrap180(deg) {
    var d = deg % 360;
    if (d > 180) d -= 360;
    else if (d <= -180) d += 360;
    return d;
  }

  function fail(reason, extra) {
    var out = { ok: false, reason: reason };
    if (extra) for (var k in extra) out[k] = extra[k];
    return out;
  }

  function isMat(m) {
    return (
      !!m &&
      typeof m === "object" &&
      isFiniteNumber(m.a) &&
      isFiniteNumber(m.b) &&
      isFiniteNumber(m.c) &&
      isFiniteNumber(m.d) &&
      isFiniteNumber(m.tx) &&
      isFiniteNumber(m.ty)
    );
  }

  /* ==========================================================================
   * 1. 矩阵
   * ====================================================================== */
  function identity() {
    return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  }

  /** parent * local：先应用 local，再应用 parent（与 spine-core.matMul 同实现） */
  function mul(parent, local) {
    return {
      a: parent.a * local.a + parent.c * local.b,
      b: parent.b * local.a + parent.d * local.b,
      c: parent.a * local.c + parent.c * local.d,
      d: parent.b * local.c + parent.d * local.d,
      tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
      ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
    };
  }

  /** 逆矩阵；行列式过小或非有限返回 null（不假装可逆） */
  function invert(mat, eps) {
    if (!isMat(mat)) return null;
    var limit = eps === undefined ? 1e-12 : eps;
    var det = mat.a * mat.d - mat.b * mat.c;
    if (!isFinite(det) || Math.abs(det) <= limit) return null;
    var inv = 1 / det;
    var a = mat.d * inv;
    var b = -mat.b * inv;
    var c = -mat.c * inv;
    var d = mat.a * inv;
    return {
      a: a,
      b: b,
      c: c,
      d: d,
      tx: -(a * mat.tx + c * mat.ty),
      ty: -(b * mat.tx + d * mat.ty),
    };
  }

  /** 变换一个点（含平移） */
  function apply(mat, x, y) {
    if (!isMat(mat)) return { x: NaN, y: NaN };
    return { x: mat.a * x + mat.c * y + mat.tx, y: mat.b * x + mat.d * y + mat.ty };
  }

  /** 只变换方向/增量（忽略平移） */
  function applyVec(mat, dx, dy) {
    if (!isMat(mat)) return { x: NaN, y: NaN };
    return { x: mat.a * dx + mat.c * dy, y: mat.b * dx + mat.d * dy };
  }

  /** 矩阵线性部分第一列的角度（度，(-180,180]）：骨骼局部 +X 轴在世界/父级下的朝向 */
  function rotationOf(mat) {
    if (!isMat(mat)) return NaN;
    return wrap180((Math.atan2(mat.b, mat.a) * 180) / Math.PI);
  }

  /** 由角度（度）+ 缩放构造线性矩阵（不含平移） */
  function linearFrom(rotation, scaleX, scaleY) {
    var r = ((isFiniteNumber(rotation) ? rotation : 0) * Math.PI) / 180;
    var sx = isFiniteNumber(scaleX) ? scaleX : 1;
    var sy = isFiniteNumber(scaleY) ? scaleY : 1;
    return { a: Math.cos(r) * sx, b: Math.sin(r) * sx, c: -Math.sin(r) * sy, d: Math.cos(r) * sy, tx: 0, ty: 0 };
  }

  /**
   * 骨骼**本地矩阵**线性部分（含 shear），与 spine-core.localMatrix 同口径：
   *   a = cos(rotation+shearX)·scaleX, b = sin(rotation+shearX)·scaleX
   *   c = cos(rotation+90+shearY)·scaleY, d = sin(rotation+90+shearY)·scaleY
   * 说明：linearFrom 忽略 shear，只适用于 shear=0 的老调用；P1 起轴基一律用本函数。
   * @param {{rotation?:number,scaleX?:number,scaleY?:number,shearX?:number,shearY?:number}} local
   * @returns {object} 线性矩阵（tx=ty=0）
   */
  function localLinear(local) {
    var L = local || {};
    var r = isFiniteNumber(L.rotation) ? L.rotation : 0;
    var sx = isFiniteNumber(L.scaleX) ? L.scaleX : 1;
    var sy = isFiniteNumber(L.scaleY) ? L.scaleY : 1;
    var shx = isFiniteNumber(L.shearX) ? L.shearX : 0;
    var shy = isFiniteNumber(L.shearY) ? L.shearY : 0;
    var rx = ((r + shx) * Math.PI) / 180;
    var ry = ((r + 90 + shy) * Math.PI) / 180;
    return {
      a: Math.cos(rx) * sx,
      b: Math.sin(rx) * sx,
      c: Math.cos(ry) * sy,
      d: Math.sin(ry) * sy,
      tx: 0,
      ty: 0,
    };
  }

  /** 骨的世界矩阵 = 父级世界矩阵 · 本地矩阵（含 shear）；W 缺省时回退 H·linearFrom(L0) */
  function boneWorldLinear(parentWorld, startLocal) {
    var H = orIdentity(parentWorld);
    if (!isMat(H)) return null;
    var L = startLocal ? localLinear(startLocal) : linearFrom(0, 1, 1);
    return mul(H, L);
  }

  /**
   * 区分位移 Jacobian A 与继承矩阵 H（顾问 T16 裁定）：
   *   A = 真实父级世界线性（parentWorld）——位移映射用它，inherit 不影响（onlyTranslation 仍用 A）。
   *   H = inherit === 'onlyTranslation' ? 单位阵 : A —— 旋转/缩放/aim 的继承映射用它。
   * 支持的 inherit：undefined | 'normal' | 'onlyTranslation'；其它 Spine 取值
   * （noScale / noRotationOrReflection / noScaleOrReflection）本模块**显式拒绝**，
   * 不按 normal 伪验收（契约 §4：其它未支持 inherit 显式拒绝）。
   * @returns {{A:object,H:object,inherit:string,supported:boolean}}
   */
  function inheritBasis(parentWorld, inherit) {
    var A = orIdentity(parentWorld);
    var mode = "normal";
    var supported = true;
    if (inherit === undefined || inherit === null || inherit === "" || inherit === "normal") {
      mode = "normal";
    } else if (inherit === "onlyTranslation") {
      mode = "onlyTranslation";
    } else {
      /* 未知/未支持 inherit：保留真实 A，但调用方必须按 supported:false 拒绝 */
      mode = String(inherit);
      supported = false;
    }
    var H = mode === "onlyTranslation" ? identity() : A;
    return { A: A, H: H, inherit: mode, supported: supported };
  }

  /** 单位阵或给定矩阵；null/undefined 视为单位阵 */
  function orIdentity(mat) {
    return mat === null || mat === undefined ? identity() : mat;
  }

  /* ==========================================================================
   * 2. 平移
   * ====================================================================== */

  /**
   * 世界拖拽增量 → 骨的局部 x/y。
   * @param {object} p
   *   startX/startY      手势开始时骨的局部 x/y
   *   startWorld/world   {x,y} 世界坐标（手势开始 / 当前）
   *   parentWorld        {a..ty} 真实父级世界矩阵 P（A = P.linear）
   *   inherit            'normal'（缺省，H=A）| 'onlyTranslation'（H=I，位移仍用 A）
   *   space              'parent' | 'world' | 'local'
   *     · parent：轴约束按父级轴（A⁻¹ 后砍分量）
   *     · world ：轴约束按世界轴（先砍世界分量再回父级局部）
   *     · local ：轴基为骨自身轴 W = H·L0（含 shear）；dLocal = W⁻¹Δworld，
   *               砍掉另一分量后用 **A⁻¹** 回父级存储：Δparent = A⁻¹·W·dLocal
   *               （free 分支 = A⁻¹Δworld；注意不是 H⁻¹，onlyTranslation 下两者不同）
   *   boneWorld          骨的世界矩阵 W（local 用；缺省 H·localLinear(startLocal)）
   *   startLocal         {rotation,scaleX,scaleY,shearX,shearY}（local 轴基缺省来源）
   *   axis               'x' | 'y' | null（单轴约束）
   *   snapUnit           正数时对结果取整到该单位
   * @returns {{ok:true,x:number,y:number,deltaLocal:{x:number,y:number},space:string}} | {ok:false,reason:string}
   */
  function translateFromDrag(p) {
    var o = p || {};
    if (!isFiniteNumber(o.startX) || !isFiniteNumber(o.startY)) return fail("START_INVALID");
    if (!o.startWorld || !o.world || !isFiniteNumber(o.startWorld.x) || !isFiniteNumber(o.startWorld.y) ||
        !isFiniteNumber(o.world.x) || !isFiniteNumber(o.world.y)) {
      return fail("POINT_INVALID");
    }
    var wdx = o.world.x - o.startWorld.x;
    var wdy = o.world.y - o.startWorld.y;
    var space = o.space === "world" ? "world" : o.space === "local" ? "local" : "parent";
    var axis = o.axis === "x" || o.axis === "y" ? o.axis : null;

    /* 轴约束：world 空间直接砍掉另一根世界轴；parent/local 先回各自局部再砍 */
    if (axis && space === "world") {
      if (axis === "x") wdy = 0;
      else wdx = 0;
    }

    var basis = inheritBasis(o.parentWorld, o.inherit);
    if (!basis.supported) return fail("INHERIT_UNSUPPORTED", { inherit: basis.inherit });
    var A = basis.A;
    if (!isMat(A)) return fail("PARENT_INVALID");
    var invA = invert(A);
    if (!invA) return fail("PARENT_SINGULAR");

    var ldx;
    var ldy;
    if (space === "local") {
      /* 骨自身轴基 = H·L0（H 由 inherit 决定）。注意：
         · 轴基用 H（onlyTranslation ⇒ H=I，骨不带父级旋转/缩放）
         · **回父级存储用 A⁻¹**（A = 真实父级世界线性）；free 分支即 A⁻¹Δworld。
           用 H⁻¹ 回写是错的：A=diag(2,1) 时 Local free 世界(10,0) 应得 (5,0) 而非 (10,0)。 */
      var W = o.boneWorld !== undefined && o.boneWorld !== null ? o.boneWorld : mul(basis.H, o.startLocal ? localLinear(o.startLocal) : linearFrom(0, 1, 1));
      if (!isMat(W)) return fail("PARENT_INVALID");
      var invB = invert(W);
      if (!invB) return fail("LOCAL_BASIS_SINGULAR");
      var dBone = applyVec(invB, wdx, wdy);
      if (axis === "x") dBone.y = 0;
      else if (axis === "y") dBone.x = 0;
      var boneVec = applyVec(W, dBone.x, dBone.y);
      var dParent = applyVec(invA, boneVec.x, boneVec.y);
      ldx = dParent.x;
      ldy = dParent.y;
    } else {
      var tmp = applyVec(invA, wdx, wdy);
      ldx = tmp.x;
      ldy = tmp.y;
      /* 只有 parent 空间才砍父级局部分量；world 空间已在上面砍过世界分量 */
      if (axis && space === "parent") {
        if (axis === "x") ldy = 0;
        else ldx = 0;
      }
    }

    var nx = o.startX + ldx;
    var ny = o.startY + ldy;
    var snap = o.snapUnit;
    if (isFiniteNumber(snap) && snap > 0) {
      nx = Math.round(nx / snap) * snap;
      ny = Math.round(ny / snap) * snap;
    }
    if (!isFiniteNumber(nx) || !isFiniteNumber(ny)) return fail("RESULT_NOT_FINITE");
    return { ok: true, x: nx, y: ny, deltaLocal: { x: nx - o.startX, y: ny - o.startY }, space: space };
  }

  /* ==========================================================================
   * 3. 旋转
   * ====================================================================== */

  function angleOf(pivot, point) {
    return (Math.atan2(point.y - pivot.y, point.x - pivot.x) * 180) / Math.PI;
  }

  /**
   * 拖拽旋转：绕 pivotWorld 的角度差加到 startRotation 上。
   * @param {object} p
   *   startRotation  手势开始时骨的 rotation（度）
   *   pivotWorld     骨原点的世界坐标
   *   startWorld/world 指针世界坐标
   *   parentWorld    父级世界矩阵（H）：决定是否可解，以及反射时的符号
   *   space          'parent' | 'world'
   *   snapDeg        正数时对**角差 deltaDeg** 取整到该角度（不吸附 r0 本身）
   * @returns {{ok:true,rotation:number,deltaDeg:number}} | {ok:false,reason:string}
   *
   * 契约 §4.3：
   *   - Parent：delta 是父级坐标系里的角差，等价于 L1.linear = R(delta)·L0.linear，保留 shear/scale。
   *   - World：仅在 H 为可逆相似变换时可用（见 canWorldRotate）；反射时角差反号，
   *     故 delta = sign(det(H)) · deltaWorld。不可解时返回 ok:false（不静默近似）。
   *   - 不把结果强制夹到 [-180,180]，保留多圈语义；只对角差做 ±180 归一。
   */
  function rotateFromDrag(p) {
    var o = p || {};
    if (!isFiniteNumber(o.startRotation)) return fail("START_INVALID");
    if (!o.pivotWorld || !o.startWorld || !o.world) return fail("POINT_INVALID");
    var pv = o.pivotWorld;
    var sw = o.startWorld;
    var w = o.world;
    if (!isFiniteNumber(pv.x) || !isFiniteNumber(pv.y) || !isFiniteNumber(sw.x) || !isFiniteNumber(sw.y) ||
        !isFiniteNumber(w.x) || !isFiniteNumber(w.y)) {
      return fail("POINT_INVALID");
    }
    var parent = orIdentity(o.parentWorld);
    if (!isMat(parent)) return fail("PARENT_INVALID");

    var r0 = Math.hypot(sw.x - pv.x, sw.y - pv.y);
    var r1 = Math.hypot(w.x - pv.x, w.y - pv.y);
    if (!(r0 > 1e-9) || !(r1 > 1e-9)) return fail("RADIUS_ZERO");

    var space = o.space === "world" ? "world" : o.space === "local" ? "local" : "parent";
    var basis = inheritBasis(o.parentWorld, o.inherit);
    if (!basis.supported) return fail("INHERIT_UNSUPPORTED", { inherit: basis.inherit });
    var H = basis.H;
    var delta;
    if (space === "world") {
      /* 世界空间：用世界角差，仅相似父级可解；反射反号 */
      var gate = canWorldRotate(basis.A);
      if (!gate.ok) return fail(gate.code, { reasonText: gate.reason, ratio: gate.ratio });
      delta = wrap180(angleOf(pv, w) - angleOf(pv, sw));
      var det = basis.A.a * basis.A.d - basis.A.b * basis.A.c;
      if (det < 0) delta = -delta;
    } else {
      /* parent / local：角差必须在**继承矩阵 H** 的坐标系里取（H⁻¹ 后 atan2 差）。
         父级非相似时世界角差 ≠ 局部角差（H=diag(2,1)：世界 26.565° ↔ 局部 45°）；
         onlyTranslation 时 H=I ⇒ 角差即世界角差。 */
      var invH = invert(H);
      if (!invH) return fail("PARENT_SINGULAR");
      var h0 = applyVec(invH, sw.x - pv.x, sw.y - pv.y);
      var h1 = applyVec(invH, w.x - pv.x, w.y - pv.y);
      if (!(Math.hypot(h0.x, h0.y) > 1e-9) || !(Math.hypot(h1.x, h1.y) > 1e-9)) return fail("RADIUS_ZERO");
      delta = wrap180(angleOf(ZERO, h1) - angleOf(ZERO, h0));
    }
    if (isFiniteNumber(o.snapDeg) && o.snapDeg > 0) delta = Math.round(delta / o.snapDeg) * o.snapDeg;
    delta = wrap180(delta);
    var rot = o.startRotation + delta;
    if (!isFiniteNumber(rot)) return fail("RESULT_NOT_FINITE");
    return { ok: true, rotation: rot, deltaDeg: delta, space: space };
  }

  /* ==========================================================================
   * 4. 缩放
   * ====================================================================== */

  /**
   * 拖拽缩放。
   * @param {object} p
   *   startScaleX/startScaleY 手势开始时的骨缩放
   *   pivotWorld              骨原点世界坐标
   *   startWorld/world        指针世界坐标
   *   axis                    'x' | 'y' | null
   *   uniform                 true = 等比（任意可逆 H 下精确）
   *   space                   'parent' | 'world' | 'local'（local 与 parent 轴基同源 = 骨自身轴）
   *   inherit                 'normal'（缺省 H=A）| 'onlyTranslation'（H=I）
   *   boneWorld               骨世界矩阵 W（显式给就以它为准；否则 H·localLinear(L0)）
   *   startLocal              {rotation,scaleX,scaleY,shearX,shearY} 手势开始时的骨 local（轴缩放需 L0 基，**含 shear**）
   *   snapStep                正数时对倍率取整
   *   minScale                下限（默认 0.01）
   * @returns {{ok:true,scaleX:number,scaleY:number,factor:number}} | {ok:false,reason:string}
   *
   * 契约 §4.4：
   *   - 等比：f = |v|/|v0|，sx = sx0·f、sy = sy0·f；任意可逆 H 精确成立。
   *   - 单轴：轴基 B0 = H·localLinear(L0)（含 shear，等于真实骨世界线性的两列），
   *           h0 = B0⁻¹·v0、h = B0⁻¹·v，X 柄 fx = h.x/h0.x（fy=1），Y 柄 fy = h.y/h0.y（fx=1）。
   *   - World 单轴：P0 不支持（需 H⁻¹ Q diag(fx,fy) Q⁻¹ H，固定 shear 下常不可表示）→ 显式拒绝。
   */
  function scaleFromDrag(p) {
    var o = p || {};
    var sx0 = isFiniteNumber(o.startScaleX) ? o.startScaleX : 1;
    var sy0 = isFiniteNumber(o.startScaleY) ? o.startScaleY : 1;
    if (!o.pivotWorld || !o.startWorld || !o.world) return fail("POINT_INVALID");
    var pv = o.pivotWorld;
    var sw = o.startWorld;
    var w = o.world;
    if (!isFiniteNumber(pv.x) || !isFiniteNumber(pv.y) || !isFiniteNumber(sw.x) || !isFiniteNumber(sw.y) ||
        !isFiniteNumber(w.x) || !isFiniteNumber(w.y)) {
      return fail("POINT_INVALID");
    }
    var axis = o.axis === "x" || o.axis === "y" ? o.axis : null;
    if (o.space === "world" && axis && !o.uniform) return fail("WORLD_AXIS_SCALE_UNSUPPORTED");
    var basisChk = inheritBasis(o.parentWorld, o.inherit);
    if (!basisChk.supported) return fail("INHERIT_UNSUPPORTED", { inherit: basisChk.inherit });

    var v0 = { x: sw.x - pv.x, y: sw.y - pv.y };
    var v = { x: w.x - pv.x, y: w.y - pv.y };
    var minScale = isFiniteNumber(o.minScale) ? o.minScale : 0.01;
    var nx = sx0;
    var ny = sy0;
    var factor;

    if (o.uniform || !axis) {
      var d0 = Math.hypot(v0.x, v0.y);
      var d1 = Math.hypot(v.x, v.y);
      if (!(d0 > 1e-9)) return fail("START_DISTANCE_ZERO");
      if (!(d1 > 0) || !isFinite(d1)) return fail("DISTANCE_INVALID");
      factor = d1 / d0;
      if (isFiniteNumber(o.snapStep) && o.snapStep > 0) factor = Math.round(factor / o.snapStep) * o.snapStep;
      if (!(factor > 0) || !isFinite(factor)) return fail("FACTOR_INVALID");
      nx = sx0 * factor;
      ny = sy0 * factor;
    } else {
      /* 单轴：用骨本地轴基 B0 = H·localLinear(L0)（含 shear）。
         H 的取法：显式 boneWorld 优先（P0 兼容：那时 boneWorld 就是继承矩阵 H）；
         否则由 parentWorld + inherit 算 H（normal⇒H=A，onlyTranslation⇒H=I）。 */
      var basis = inheritBasis(o.parentWorld, o.inherit);
      var H = o.boneWorld !== undefined && o.boneWorld !== null ? o.boneWorld : basis.H;
      if (!isMat(H)) return fail("PARENT_INVALID");
      var L0 = o.startLocal;
      if (!L0 || (!isFiniteNumber(L0.rotation) && !isFiniteNumber(L0.scaleX) && !isFiniteNumber(L0.scaleY))) {
        return fail("START_LOCAL_MISSING");
      }
      var l0sx = isFiniteNumber(L0.scaleX) ? L0.scaleX : 1;
      var l0sy = isFiniteNumber(L0.scaleY) ? L0.scaleY : 1;
      if (Math.abs(l0sx) < 1e-9 && axis === "x") return fail("AXIS_DEGENERATE");
      if (Math.abs(l0sy) < 1e-9 && axis === "y") return fail("AXIS_DEGENERATE");
      var B0 = mul(H, localLinear(L0));
      var invB = invert(B0);
      if (!invB) return fail("PARENT_SINGULAR");
      var h0 = { x: invB.a * v0.x + invB.c * v0.y, y: invB.b * v0.x + invB.d * v0.y };
      var h = { x: invB.a * v.x + invB.c * v.y, y: invB.b * v.x + invB.d * v.y };
      var target = axis === "x" ? h.x : h.y;
      var base = axis === "x" ? h0.x : h0.y;
      if (!(Math.abs(base) > 1e-9)) return fail("AXIS_BASE_ZERO");
      factor = target / base;
      if (isFiniteNumber(o.snapStep) && o.snapStep > 0) factor = Math.round(factor / o.snapStep) * o.snapStep;
      if (!(factor > 0) || !isFinite(factor)) return fail("FACTOR_INVALID");
      if (axis === "x") nx = sx0 * factor;
      else ny = sy0 * factor;
    }

    if (o.uniform || !axis) {
      if (Math.abs(nx) < minScale) nx = nx < 0 ? -minScale : minScale;
      if (Math.abs(ny) < minScale) ny = ny < 0 ? -minScale : minScale;
    } else if (axis === "x") {
      if (Math.abs(nx) < minScale) nx = nx < 0 ? -minScale : minScale;
    } else if (Math.abs(ny) < minScale) {
      ny = ny < 0 ? -minScale : minScale;
    }
    if (!isFinite(nx) || !isFinite(ny)) return fail("RESULT_NOT_FINITE");
    return { ok: true, scaleX: nx, scaleY: ny, factor: factor };
  }

  /* ==========================================================================
   * 4b. 瞄准（Pose aim，T18）
   * ====================================================================== */

  /**
   * 单骨 aim（选骨 +X 朝向目标点）——契约 T16：
   *   θ = angle(H⁻¹ · (point − pivot))            // 目标方向在**继承系**里的角
   *   r* = θ − shearX − (scaleX < 0 ? 180 : 0)    // +X 列角度 = rotation + shearX (+180 若 scaleX<0)
   *   在 r0 的 360° 等价集合里取离 r0 最近者（保留多圈，不夹到 (-180,180]）
   * @param {object} p
   *   startRotation 当前 rotation（度）
   *   pivotWorld    骨原点世界坐标
   *   pointWorld    目标点世界坐标
   *   parentWorld   真实父级世界矩阵（A）；H 由 inherit 决定
   *   inherit       'normal'（缺省）| 'onlyTranslation'
   *   startLocal    {shearX, scaleX}（+X 朝向修正；缺省 0 / 1）
   *   snapDeg       正数时把角差吸附到该角度
   * @returns {{ok:true,rotation,deltaDeg,angleDeg}|{ok:false,reason:string}}
   */
  function aimRotation(p) {
    var o = p || {};
    if (!isFiniteNumber(o.startRotation)) return fail("START_INVALID");
    var pv = o.pivotWorld;
    var pt = o.pointWorld;
    if (!pv || !pt || !isFiniteNumber(pv.x) || !isFiniteNumber(pv.y) || !isFiniteNumber(pt.x) || !isFiniteNumber(pt.y)) {
      return fail("POINT_INVALID");
    }
    var basis = inheritBasis(o.parentWorld, o.inherit);
    if (!basis.supported) return fail("INHERIT_UNSUPPORTED", { inherit: basis.inherit });
    var invH = invert(basis.H);
    if (!invH) return fail("PARENT_SINGULAR");
    var v = applyVec(invH, pt.x - pv.x, pt.y - pv.y);
    if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y)) return fail("RESULT_NOT_FINITE");
    if (!(Math.hypot(v.x, v.y) > 1e-9)) return fail("AIM_DEGENERATE");

    var theta = (Math.atan2(v.y, v.x) * 180) / Math.PI;
    var L = o.startLocal || {};
    var shearX = isFiniteNumber(L.shearX) ? L.shearX : 0;
    var scaleX = isFiniteNumber(L.scaleX) ? L.scaleX : 1;
    /* |scaleX|≈0：+X 列退化，朝向无定义（不估算、不写坏） */
    if (Math.abs(scaleX) < 1e-9) return fail("AXIS_DEGENERATE");
    var rStar = theta - shearX - (scaleX < 0 ? 180 : 0);
    var r0 = o.startRotation;
    var rotation = rStar + 360 * Math.round((r0 - rStar) / 360);
    var delta = wrap180(rotation - r0);
    if (isFiniteNumber(o.snapDeg) && o.snapDeg > 0) {
      delta = Math.round(delta / o.snapDeg) * o.snapDeg;
      rotation = r0 + delta;
    }
    if (!isFiniteNumber(rotation)) return fail("RESULT_NOT_FINITE");
    return { ok: true, rotation: rotation, deltaDeg: delta, angleDeg: wrap180(theta) };
  }

  /**
   * 当前骨尖世界坐标（沿骨 +X，含 shear/scale）。
   *   tip = pivot + W.colX · length，W.colX = (a, b)（已含 scaleX）
   * @param {object} p
   *   parentWorld / inherit / startLocal  同 aimRotation；boneWorld 显式覆盖 W
   *   pivotWorld  骨原点世界坐标
   *   length      骨 length（优先）；缺省时用 childWorld 原点距离换算本地长度（仅显示用）
   *   childWorld  {tx,ty} 子骨世界原点（仅当 length 缺失时用于反算显示长度）
   * @returns {{ok:true,x,y,length,usedLengthSource,dirX,dirY,degenerate}|{ok:false,reason:string}}
   */
  function aimTipOf(p) {
    var o = p || {};
    var pv = o.pivotWorld;
    if (!pv || !isFiniteNumber(pv.x) || !isFiniteNumber(pv.y)) return fail("POINT_INVALID");
    var basis = inheritBasis(o.parentWorld, o.inherit);
    if (!basis.supported) return fail("INHERIT_UNSUPPORTED", { inherit: basis.inherit });
    var W = o.boneWorld !== undefined && o.boneWorld !== null
      ? o.boneWorld
      : mul(basis.H, o.startLocal ? localLinear(o.startLocal) : linearFrom(0, 1, 1));
    if (!isMat(W)) return fail("PARENT_INVALID");
    var colXLen = Math.hypot(W.a, W.b);
    if (!(colXLen > 1e-9)) return fail("LOCAL_BASIS_SINGULAR");

    var length;
    var source;
    if (isFiniteNumber(o.length) && o.length > 0) {
      length = o.length;
      source = "bone";
    } else if (o.childWorld && isFiniteNumber(o.childWorld.tx) && isFiniteNumber(o.childWorld.ty)) {
      /* 子骨原点距离 / |W.colX| = 本地 length（只作显示长度，不改 +X 朝向定义） */
      length = Math.hypot(o.childWorld.tx - pv.x, o.childWorld.ty - pv.y) / colXLen;
      source = "child";
    } else {
      /* 叶骨无 length：不伪造 scaleX 来源，交调用方用固定显示长度（如 CSS 40px/zoom） */
      length = 0;
      source = "none";
    }
    var x = pv.x + W.a * length;
    var y = pv.y + W.b * length;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return fail("RESULT_NOT_FINITE");
    return {
      ok: true,
      x: x,
      y: y,
      length: length,
      usedLengthSource: source,
      dirX: W.a / colXLen,
      dirY: W.b / colXLen,
      degenerate: source === "none",
    };
  }

  /* ==========================================================================
   * 5. 附件（region 的 x/y 是骨局部值）
   * ====================================================================== */

  /**
   * 附件拖拽：和骨的平移同一套换算，但起点是附件自身 x/y。
   * @param {object} p
   *   attachment   {x,y}（region 附件的骨局部坐标）
   *   boneWorld    驱动骨的世界矩阵
   *   startWorld/world 指针世界坐标
   *   space        'parent'(=骨局部) | 'world'
   *   axis         'x' | 'y' | null
   *   snapUnit
   * @returns {{ok:true,x:number,y:number}} | {ok:false,reason:string}
   */
  function attachmentDelta(p) {
    var o = p || {};
    var att = o.attachment;
    if (!att || !isFiniteNumber(att.x) || !isFiniteNumber(att.y)) return fail("ATTACHMENT_INVALID");
    var res = translateFromDrag({
      startX: att.x,
      startY: att.y,
      startWorld: o.startWorld,
      world: o.world,
      parentWorld: o.boneWorld,
      space: o.space,
      axis: o.axis,
      snapUnit: o.snapUnit,
    });
    if (!res.ok) return res;
    return { ok: true, x: res.x, y: res.y };
  }

  /* ==========================================================================
   * 5b. 坐标系能力判定（World 旋转 / World 单轴缩放的禁用闸门）
   *
   * 背景（顾问裁定 2026-11-08）：
   *   骨骼局部矩阵在 L0 与 L1 之间**不允许新增斜切**——Spine 4.2 里 shear 是独立字段，
   *   我们只改 rotation/scale，若换算结果本身带出斜切，就说明该坐标系下这个操作不可表达。
   *
   *   World 旋转：世界角差 Δ 作用在骨骼上等价于
   *       L1 = H⁻¹ · R(Δ) · H · L0        （H = 父级线性部分）
   *   只有当 H 是**相似变换**（旋转 + 等比缩放/反射：两列正交且等长）时，H⁻¹R(Δ)H 才是纯旋转，
   *   否则 H⁻¹R(Δ)H 会带出斜切 → 在固定 shear 的模型里不可表达，必须禁用而不是近似。
   *   父级等比缩放 / 仅平移 / 父级自身只有旋转时全部可解；父级非均匀缩放时不可解。
   *
   *   World 单轴缩放：要求父级线性部分把骨骼的局部轴映到世界轴（父级无旋转/斜切），
   *   否则 L' = H⁻¹ Q diag(fx,fy) Q⁻¹ H L0 会产生新增斜切 → 禁用。
   *   World 等比缩放在任意可逆 H 下都是精确的（两侧 H⁻¹/H 与倍率对易），故无此限制。
   * ====================================================================== */

  function linearOf(mat) {
    if (!isMat(mat)) return null;
    return { a: mat.a, b: mat.b, c: mat.c, d: mat.d };
  }

  /**
   * 父级线性部分是否是相似变换（旋转/反射 + 等比缩放）：两列正交且模长相等。
   * @returns {{similar:boolean,scale:number,ratio:number,ortho:number,tol:number}}
   */
  function parentSimilarity(mat, opts) {
    var o = opts || {};
    var tol = isFiniteNumber(o.tol) ? o.tol : 1e-9;
    var L = linearOf(orIdentity(mat));
    if (!L) return { similar: false, scale: NaN, ratio: NaN, ortho: NaN, tol: tol };
    var len1 = Math.hypot(L.a, L.b);
    var len2 = Math.hypot(L.c, L.d);
    if (!isFinite(len1) || !isFinite(len2) || !(len1 > 0) || !(len2 > 0)) {
      return { similar: false, scale: NaN, ratio: NaN, ortho: NaN, tol: tol };
    }
    var ortho = Math.abs(L.a * L.c + L.b * L.d) / (len1 * len2);
    var ratio = Math.max(len1, len2) / Math.min(len1, len2);
    var similar = ortho <= tol && Math.abs(ratio - 1) <= tol;
    return { similar: similar, scale: (len1 + len2) / 2, ratio: ratio, ortho: ortho, tol: tol };
  }

  /**
   * World 旋转闸门。可解 → {ok:true}；不可解 → {ok:false, code, reason}。
   * 父级非均匀缩放（真实 rig 的 hips 就带非均匀 scale）必须走 ok:false 分支并给提示文案。
   */
  function canWorldRotate(parentWorld, opts) {
    var s = parentSimilarity(parentWorld, opts);
    if (s.similar) return { ok: true, code: "OK", reason: "", ratio: s.ratio, ortho: s.ortho };
    var why = !isFinite(s.ratio)
      ? "父级矩阵退化，无法换算"
      : "父级非均匀缩放（比例 " + s.ratio.toFixed(3) + "）下世界旋转会引入斜切";
    return {
      ok: false,
      code: "WORLD_ROTATE_UNSUPPORTED",
      reason: why + "；已禁用 World 旋转，请改用 Parent 坐标系或等比缩放父级。",
      ratio: s.ratio,
      ortho: s.ortho,
    };
  }

  /**
   * World 单轴缩放闸门。要求父级先把局部轴映到世界轴（父级无旋转/斜切）。
   * @param {object} parentWorld
   * @param {'x'|'y'} axis
   */
  function canWorldAxisScale(parentWorld, axis, opts) {
    var o = opts || {};
    var tol = isFiniteNumber(o.tol) ? o.tol : 1e-9;
    var L = linearOf(orIdentity(parentWorld));
    if (!L) return { ok: false, code: "PARENT_INVALID", reason: "父级矩阵非法，无法换算世界轴缩放。" };
    var len1 = Math.hypot(L.a, L.b);
    var len2 = Math.hypot(L.c, L.d);
    if (!(len1 > 0) || !(len2 > 0)) return { ok: false, code: "PARENT_SINGULAR", reason: "父级矩阵退化，无法换算世界轴缩放。" };
    var ortho = Math.abs(L.a * L.c + L.b * L.d) / (len1 * len2);
    var alignedX = Math.abs(L.b) <= tol * len1;
    var alignedY = Math.abs(L.c) <= tol * len2;
    var wantX = axis !== "y";
    var aligned = wantX ? alignedX : alignedY;
    if (aligned && ortho <= tol) return { ok: true, code: "OK", reason: "" };
    return {
      ok: false,
      code: "WORLD_AXIS_SCALE_UNSUPPORTED",
      reason: "父级含旋转/斜切或轴不对齐时，世界单轴缩放会引入斜切；请改用 Parent 坐标系、世界等比缩放，或取消轴约束。",
    };
  }

  /** World 等比缩放闸门：任意可逆父级都精确，只需父级可逆 */
  function canWorldUniformScale(parentWorld, opts) {
    var o = opts || {};
    var lim = isFiniteNumber(o.eps) ? o.eps : 1e-12;
    var mat = orIdentity(parentWorld);
    if (!isMat(mat)) return { ok: false, code: "PARENT_INVALID", reason: "父级矩阵非法，无法换算世界缩放。" };
    var det = mat.a * mat.d - mat.b * mat.c;
    if (!isFinite(det) || Math.abs(det) <= lim) return { ok: false, code: "PARENT_SINGULAR", reason: "父级矩阵退化，无法换算世界缩放。" };
    return { ok: true, code: "OK", reason: "" };
  }

  /* ==========================================================================
   * 6. gizmo 几何与命中（屏幕坐标，CSS px，Y 向下）
   * ====================================================================== */

  var DEFAULT_SIZE = 46;
  /* 契约 §4.1：拾取半径 9～12px（CSS 像素），且「缩放画布不改变可点击尺寸」。
     因此 hitGizmo 的 tolerancePx 与 boneHitTest 的 jointTolPx 都是**屏幕常量**，
     不随 view.zoom 变化；只有 gizmo 的绘制长度随 zoom 变化（视觉上与骨一起缩放）。 */
  var DEFAULT_HIT_TOL = 10;
  var DEFAULT_JOINT_TOL = 10;
  var DEFAULT_LINE_TOL = 6;

  function norm(dx, dy) {
    var len = Math.hypot(dx, dy);
    if (!(len > 1e-9)) return { x: 0, y: 0 };
    return { x: dx / len, y: dy / len };
  }

  /**
   * @param {object} p
   *   pivotScreen   {x,y} 骨原点屏幕坐标
   *   axisXAngleRad / axisYAngleRad  两条操作轴在屏幕上的朝向（弧度，屏幕 Y 向下为正）
   *      · 平移 + Parent：父级世界矩阵的两列 → P·(1,0) / P·(0,1)
   *      · 平移 + World：世界轴 → 0 / +π/2
   *      · 缩放：B0 = P·L0 的两列（契约 §4.4 要求柄沿骨本地缩放轴绘制）
   *   angleRad      兼容旧调用：只给一个角时，Y 轴 = 该角 + 90°
   *   zoom          画布缩放（gizmo 视觉长度 = sizeCss * zoom）
   *   sizeCss       100% 时的手柄长度（默认 46）
   * @returns {{center,axisX,axisY,ringRadius,scaleHandle,scaleHandleY}} 全部为屏幕点
   */
  function gizmoGeometry(p) {
    var o = p || {};
    var c = o.pivotScreen || { x: 0, y: 0 };
    var zoom = isFiniteNumber(o.zoom) && o.zoom > 0 ? o.zoom : 1;
    var size = isFiniteNumber(o.sizeCss) && o.sizeCss > 0 ? o.sizeCss : DEFAULT_SIZE;
    var len = size * zoom;
    var ring = len * 0.62;
    var baseAngle = isFiniteNumber(o.angleRad) ? o.angleRad : 0;
    /* axesAngleRad:{x,y} 是 axisXAngleRad/axisYAngleRad 的等价别名（顾问 T16 命名） */
    var axes = o.axesAngleRad && typeof o.axesAngleRad === "object" ? o.axesAngleRad : null;
    var axIn = isFiniteNumber(o.axisXAngleRad) ? o.axisXAngleRad : axes && isFiniteNumber(axes.x) ? axes.x : baseAngle;
    var ayIn = isFiniteNumber(o.axisYAngleRad) ? o.axisYAngleRad : axes && isFiniteNumber(axes.y) ? axes.y : axIn + Math.PI / 2;
    var angX = axIn;
    var angY = ayIn;
    var axisX = { x: c.x + len * Math.cos(angX), y: c.y + len * Math.sin(angX) };
    var axisY = { x: c.x + len * Math.cos(angY), y: c.y + len * Math.sin(angY) };
    return {
      center: { x: c.x, y: c.y },
      axisX: axisX,
      axisY: axisY,
      ringRadius: ring,
      scaleHandle: { x: c.x + len * 0.82 * Math.cos(angX), y: c.y + len * 0.82 * Math.sin(angX) },
      scaleHandleY: { x: c.x + len * 0.82 * Math.cos(angY), y: c.y + len * 0.82 * Math.sin(angY) },
    };
  }

  /** 点到线段距离 */
  function distToSegment(px, py, x0, y0, x1, y1) {
    var vx = x1 - x0;
    var vy = y1 - y0;
    var len2 = vx * vx + vy * vy;
    if (!(len2 > 1e-12)) return Math.hypot(px - x0, py - y0);
    var t = ((px - x0) * vx + (py - y0) * vy) / len2;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x0 + t * vx), py - (y0 + t * vy));
  }

  /**
   * gizmo 命中。优先级：手柄/轴（按 tool）→ 中心 → 旋转环。
   * @param {object} p {point, geometry, tolerancePx, tool:'translate'|'rotate'|'scale'}
   * @returns {'center'|'x'|'y'|'rotate'|'scale'|null}
   */
  function hitGizmo(p) {
    var o = p || {};
    var pt = o.point;
    var g = o.geometry;
    if (!pt || !isFiniteNumber(pt.x) || !isFiniteNumber(pt.y)) return null;
    if (!g || !g.center) return null;
    var tol = isFiniteNumber(o.tolerancePx) && o.tolerancePx > 0 ? o.tolerancePx : DEFAULT_HIT_TOL;
    var tool = o.tool === "rotate" || o.tool === "scale" ? o.tool : "translate";
    var c = g.center;
    var dCenter = Math.hypot(pt.x - c.x, pt.y - c.y);
    if (dCenter <= tol) return "center";

    if (tool === "translate") {
      var dx = distToSegment(pt.x, pt.y, c.x, c.y, g.axisX.x, g.axisX.y);
      var dy = distToSegment(pt.x, pt.y, c.x, c.y, g.axisY.x, g.axisY.y);
      var best = null;
      if (dx <= tol && dy <= tol) best = dx <= dy ? "x" : "y";
      else if (dx <= tol) best = "x";
      else if (dy <= tol) best = "y";
      if (best) return best;
      return null;
    }
    if (tool === "rotate") {
      if (Math.abs(dCenter - g.ringRadius) <= tol) return "rotate";
      return null;
    }
    /* scale：X/Y 两个手柄 + 两根轴 */
    var shX = g.scaleHandle;
    var shY = g.scaleHandleY;
    if (shX && Math.hypot(pt.x - shX.x, pt.y - shX.y) <= tol) return "scale";
    if (shY && Math.hypot(pt.x - shY.x, pt.y - shY.y) <= tol) return "scale";
    var dsx = distToSegment(pt.x, pt.y, c.x, c.y, g.axisX.x, g.axisX.y);
    var dsy = distToSegment(pt.x, pt.y, c.x, c.y, g.axisY.x, g.axisY.y);
    if (dsx <= tol && dsy <= tol) return dsx <= dsy ? "x" : "y";
    if (dsx <= tol) return "x";
    if (dsy <= tol) return "y";
    return null;
  }

  /* ==========================================================================
   * 7. 骨骼拾取
   * ====================================================================== */

  /**
   * 最近关节优先（≤jointTolPx），其次线段（≤lineTolPx）。
   * @param {object} p
   *   bones     [{index, world:{tx,ty}, screen:{x,y}, parentIndex?}]，screen 缺失时用 world 当屏幕坐标
   *   point     {x,y} 屏幕坐标
   *   jointTolPx/lineTolPx
   *   zoom      仅用于诊断输出，不参与判定
   * @returns {{index,part:'joint'|'line',distance}|null}
   */
  function boneHitTest(p) {
    var o = p || {};
    var pt = o.point;
    if (!pt || !isFiniteNumber(pt.x) || !isFiniteNumber(pt.y)) return null;
    var list = Array.isArray(o.bones) ? o.bones : [];
    var jointTol = isFiniteNumber(o.jointTolPx) ? o.jointTolPx : DEFAULT_JOINT_TOL;
    var lineTol = isFiniteNumber(o.lineTolPx) ? o.lineTolPx : DEFAULT_LINE_TOL;

    function screenOf(b) {
      if (b && b.screen && isFiniteNumber(b.screen.x) && isFiniteNumber(b.screen.y)) return b.screen;
      if (b && b.world && isFiniteNumber(b.world.tx) && isFiniteNumber(b.world.ty)) return { x: b.world.tx, y: b.world.ty };
      return null;
    }

    var bestJoint = null;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || !isFiniteNumber(b.index)) continue;
      var s = screenOf(b);
      if (!s) continue;
      var d = Math.hypot(pt.x - s.x, pt.y - s.y);
      if (!isFinite(d)) continue;
      if (d <= jointTol && (!bestJoint || d < bestJoint.distance)) {
        bestJoint = { index: b.index, part: "joint", distance: d };
      }
    }
    if (bestJoint) return bestJoint;

    var bestLine = null;
    for (var j = 0; j < list.length; j++) {
      var bb = list[j];
      if (!bb || !isFiniteNumber(bb.index)) continue;
      var child = screenOf(bb);
      if (!child) continue;
      var pi = bb.parentIndex;
      if (!isFiniteNumber(pi) || pi < 0) continue;
      var parent = null;
      for (var k = 0; k < list.length; k++) {
        if (list[k] && list[k].index === pi) {
          parent = list[k];
          break;
        }
      }
      if (!parent) continue;
      var ps = screenOf(parent);
      if (!ps) continue;
      var dl = distToSegment(pt.x, pt.y, ps.x, ps.y, child.x, child.y);
      if (!isFinite(dl)) continue;
      if (dl <= lineTol && (!bestLine || dl < bestLine.distance)) {
        bestLine = { index: bb.index, part: "line", distance: dl };
      }
    }
    return bestLine;
  }

  /* ==========================================================================
   * 8. 世界 ↔ 屏幕（画布 proj / unproj 的纯函数版，便于单测与 gizmo 复用）
   * ====================================================================== */

  /** 与 app.js viewParams/proj 同口径：屏幕 Y 向下 */
  function worldToScreen(p) {
    var o = p || {};
    var z = isFiniteNumber(o.zoom) ? o.zoom : 1;
    var tx = isFiniteNumber(o.tx) ? o.tx : 0;
    var ty = isFiniteNumber(o.ty) ? o.ty : 0;
    return { x: o.x * z + tx, y: -o.y * z + ty };
  }

  function screenToWorld(p) {
    var o = p || {};
    var z = isFiniteNumber(o.zoom) && o.zoom !== 0 ? o.zoom : 1;
    var tx = isFiniteNumber(o.tx) ? o.tx : 0;
    var ty = isFiniteNumber(o.ty) ? o.ty : 0;
    return { x: (o.x - tx) / z, y: -(o.y - ty) / z };
  }

  /** 世界矩阵在屏幕上的朝向（弧度）：把世界 +X 轴方向投到屏幕再取角。
   *  世界向量 (vx,vy) 投到屏幕是 (vx,-vy)（屏幕 Y 向下），所以
   *  世界列向量 (a,b) → 屏幕角 atan2(-b, a)，与 canvas 的 rotate 正方向（顺时针）一致。
   *  验证：世界 rot(90) 把局部 +X 指向世界 +Y（向上）→ 屏幕角 = -π/2（朝上）。
   *  单位世界矩阵 → 0（朝右）。 */
  function screenAngleOf(worldMat, zoom) {
    if (!isMat(worldMat)) return 0;
    var z = isFiniteNumber(zoom) && zoom > 0 ? zoom : 1;
    return Math.atan2(-worldMat.b * z, worldMat.a * z);
  }

  /** 世界向量 (vx,vy) → 屏幕角（弧度，屏幕 Y 向下为正） */
  function axisAngleOf(vx, vy) {
    if (!isFiniteNumber(vx) || !isFiniteNumber(vy)) return 0;
    /* vy=0 时把 -0 归成 +0，保证「朝左」得到 +π 而不是 -π（两者等价，但显示/测试需要稳定） */
    var screenY = vy === 0 ? 0 : -vy;
    return Math.atan2(screenY, vx);
  }

  /* ==========================================================================
   * 9. 轴心补偿（P2-03）：改骨局部 x/y 时，保持直接子骨 / 挂载附件的世界位置
   *
   * 数学推导（决定了哪些情形可解、哪些必须拒绝）：
   *   只改骨 b 的局部 (x,y)、不动 rotation/scale/shear 时，b 的**世界线性部分不变**，
   *   只有世界平移变：
   *       W1 = W0 · T(u)，  u = (W0.linear)⁻¹ · ΔO，  ΔO = 骨原点的世界位移
   *   （'normal' 世界线性 = P.linear·L0.linear，'onlyTranslation' = L0.linear，
   *     两者都与局部 x/y 无关 ⇒ 上式对两种 inherit 都精确成立。）
   *   直接子骨与挂在该骨上的 region 附件都满足同一形式
   *       W_child = W0 · T(c) · L_child（c = 子骨/附件的局部 x,y）
   *   要 W_child 不变，只需 c' = c − u：**纯平移补偿**，不改 rotation/scale/shear。
   *   孙代骨挂在子骨的世界矩阵之下，子骨世界不变 ⇒ 孙代自动不变（无需逐级补偿）。
   *
   * 由此可得边界（与 §4b 的「父矩阵求逆」口径不同，这里是精确解，故更宽）：
   *   · 父级非均匀缩放 / 反射**不影响**可解性：父矩阵根本不出现在解里（先验世界矩阵已含它）。
   *   · 只有 W0.linear 奇异（scaleX≈0 / scaleY≈0 / 行列式过小）才不可解 → ok:false，绝不写坏数据。
   *   · inherit 只支持 'normal' / 'onlyTranslation'；其它取值（noScale / noRotationOrReflection / …）
   *     显式拒绝，与 §1 inheritBasis 的策略一致。
   * ====================================================================== */

  /** 骨局部矩阵（含平移，与 spine-core.localMatrix 逐位同口径） */
  function boneLocalMatrix(local) {
    var lin = localLinear(local || {});
    return {
      a: lin.a, b: lin.b, c: lin.c, d: lin.d,
      tx: isFiniteNumber(local && local.x) ? local.x : 0,
      ty: isFiniteNumber(local && local.y) ? local.y : 0,
    };
  }

  /** inherit 归一（与 inheritBasis 同判据；unknown 原样返回且 supported:false） */
  function inheritModeOf(raw) {
    if (raw === undefined || raw === null || raw === "" || raw === "normal") return { mode: "normal", supported: true };
    if (raw === "onlyTranslation") return { mode: "onlyTranslation", supported: true };
    return { mode: String(raw), supported: false };
  }

  /**
   * 整条链的世界矩阵（与 spine-core.fkAll 同口径，含 onlyTranslation 的平移继承）：
   *   根：W = 局部矩阵；其它：W = matMul(W_parent, 局部)（onlyTranslation 只继承平移）。
   * 父链用记忆化递归解析，允许骨顺序与层级顺序不同；检测到环/非法父级 → 返回原因。
   * @param {Array<object>} bones [{x,y,rotation,scaleX,scaleY,shearX,shearY,parentIndex,inherit}]
   * @returns {{ok:true, worlds:Array<object>}|{ok:false, reason:string, boneIndex:number}}
   */
  function boneChainWorlds(bones) {
    if (!Array.isArray(bones)) return { ok: false, reason: "BONES_INVALID", boneIndex: -1 };
    var n = bones.length;
    var worlds = new Array(n);
    var mark = new Array(n); /* 0=未访问 1=访问中 2=完成 */
    var bad = null;
    function resolve(i) {
      if (mark[i] === 2) return worlds[i];
      if (mark[i] === 1) {
        if (!bad) bad = { reason: "BONE_CYCLE", boneIndex: i };
        return null;
      }
      var b = bones[i];
      if (!b || typeof b !== "object") {
        if (!bad) bad = { reason: "BONE_INVALID", boneIndex: i };
        return null;
      }
      mark[i] = 1;
      var L = boneLocalMatrix(b);
      var p = b.parentIndex;
      var out;
      if (!isFiniteNumber(p) || p < 0) {
        out = L;
      } else if (p >= n) {
        if (!bad) bad = { reason: "PARENT_INDEX_INVALID", boneIndex: i };
        out = null;
      } else {
        var pw = resolve(p);
        if (!pw) out = null;
        else if (inheritModeOf(b.inherit).mode === "onlyTranslation") {
          out = {
            a: L.a, b: L.b, c: L.c, d: L.d,
            tx: pw.a * L.tx + pw.c * L.ty + pw.tx,
            ty: pw.b * L.tx + pw.d * L.ty + pw.ty,
          };
        } else {
          out = mul(pw, L);
        }
      }
      worlds[i] = out;
      mark[i] = 2;
      return out;
    }
    for (var i = 0; i < n; i++) {
      var w = resolve(i);
      if (!w && !bad) return { ok: false, reason: "WORLD_UNRESOLVED", boneIndex: i };
    }
    if (bad) return { ok: false, reason: bad.reason, boneIndex: bad.boneIndex };
    for (var j = 0; j < n; j++) {
      if (!isMat(worlds[j])) return { ok: false, reason: "BONE_INVALID", boneIndex: j };
    }
    return { ok: true, worlds: worlds };
  }

  /** 直接子骨索引（保持输入顺序） */
  function directChildrenOf(bones, boneIndex) {
    var out = [];
    if (!Array.isArray(bones)) return out;
    for (var i = 0; i < bones.length; i++) {
      var b = bones[i];
      if (b && isFiniteNumber(b.parentIndex) && b.parentIndex === boneIndex) out.push(i);
    }
    return out;
  }

  /** 选中骨 → 根的所有祖先索引（不含自身），用于 inherit 预检 */
  function ancestorIndicesOf(bones, boneIndex) {
    var out = [];
    var cur = boneIndex;
    var guard = 0;
    while (guard++ < 512) {
      var b = bones[cur];
      var p = b ? b.parentIndex : -1;
      if (!isFiniteNumber(p) || p < 0) break;
      out.push(p);
      cur = p;
    }
    return out;
  }

  /**
   * Δlocal → Δworld（骨原点世界位移）：ΔO = P.linear · Δlocal（P = 真实父级世界矩阵，根 = 单位阵）。
   * 与 inherit 无关：两种 inherit 下骨原点世界位置都是 P.linear·(x,y) + P.t。
   */
  function worldDeltaOfLocal(bones, boneIndex, delta) {
    var p = bones[boneIndex] ? bones[boneIndex].parentIndex : -1;
    if (!isFiniteNumber(p) || p < 0) return { x: delta.x, y: delta.y };
    var worlds = boneChainWorlds(bones);
    if (!worlds.ok) return null;
    var pw = worlds.worlds[p];
    if (!pw) return null;
    return applyVec(pw, delta.x, delta.y);
  }

  /** Δworld → Δlocal（父级线性求逆）；父级奇异 → null */
  function localDeltaOfWorld(bones, boneIndex, worldDelta) {
    var p = bones[boneIndex] ? bones[boneIndex].parentIndex : -1;
    if (!isFiniteNumber(p) || p < 0) return { x: worldDelta.x, y: worldDelta.y };
    var worlds = boneChainWorlds(bones);
    if (!worlds.ok) return null;
    var inv = invert(worlds.worlds[p]);
    if (!inv) return null;
    return applyVec(inv, worldDelta.x, worldDelta.y);
  }

  /**
   * 轴心补偿：把 bones[boneIndex] 的局部 x/y 加 delta，并给直接子骨（可选：该骨挂载的 region 附件）
   * 施加纯平移补偿，使其世界位置保持不变。
   *
   * @param {object} p
   *   bones               骨数组（不修改）：{x,y,rotation?,scaleX?,scaleY?,shearX?,shearY?,parentIndex?,inherit?,name?}
   *   boneIndex           选中骨索引
   *   delta               {x,y} 选中骨的局部增量
   *   mode                'none' | 'children'（默认）| 'childrenAndAttachments'
   *   attachments         可选 [{boneIndex,x,y,index?,name?,type?}]；只有 boneIndex 命中且 type 为 region
   *                       （type 缺省视为 region）的条目参与补偿
   *   childIndices        可选：只补偿列出的直接子骨（缺省 = 全部直接子骨）
   *   tol                 奇异判定容差（默认 1e-12）
   * @returns {{ok:true, ...}|{ok:false, reason:string, ...}}
   *   changes             [{boneIndex,name,x,y,worldBefore,worldAfter,error}] 子骨补偿结果
   *   attachmentChanges   [{index,boneIndex,name,x,y,worldBefore,worldAfter,error,skipped?}]
   *   selfChange          {boneIndex,name,x,y} 选中骨的新局部值
   *   limitations         已知覆盖边界（字符串数组，永远返回）
   */
  function compensateMove(p) {
    var o = p || {};
    var bones = o.bones;
    var limitations = [
      "只补偿直接子骨：孙代骨挂在子骨世界矩阵之下，子骨世界不变 ⇒ 孙代自动不变（无需逐级补偿）。",
      "补偿为纯平移：只改子骨/附件的局部 x/y，不改 rotation/scaleX/scaleY/shear。",
      "恰好抵消：要求选中骨世界线性（含 scale/shear）可逆；scaleX 或 scaleY 为 0 时不可解，直接拒绝。",
      "父级非均匀缩放/反射不影响可解性（解里不出现父矩阵）；inherit 只支持 normal / onlyTranslation。",
    ];
    var mode = o.mode === "none" ? "none" : o.mode === "childrenAndAttachments" ? "childrenAndAttachments" : "children";
    if (!Array.isArray(bones)) return fail("BONES_INVALID", { issues: [], limitations: limitations });
    var idx = o.boneIndex;
    if (!isFiniteNumber(idx) || !Number.isInteger(idx) || idx < 0 || idx >= bones.length) {
      return fail("BONE_INDEX_INVALID", { issues: [], limitations: limitations, boneIndex: idx });
    }
    var delta = o.delta;
    if (!delta || !isFiniteNumber(delta.x) || !isFiniteNumber(delta.y)) {
      return fail("DELTA_INVALID", { issues: [], limitations: limitations, boneIndex: idx });
    }
    var issues = [];
    var tol = isFiniteNumber(o.tol) ? o.tol : 1e-12;
    var worldsBefore = boneChainWorlds(bones);
    if (!worldsBefore.ok) {
      return fail(worldsBefore.reason, { issues: issues, limitations: limitations, boneIndex: worldsBefore.boneIndex });
    }
    var W0 = worldsBefore.worlds[idx];

    /* inherit 预检：选中骨 / 其祖先 / 直接子骨都不允许未知 inherit（不按 normal 伪验收） */
    var checked = [idx].concat(ancestorIndicesOf(bones, idx)).concat(directChildrenOf(bones, idx));
    for (var ci = 0; ci < checked.length; ci++) {
      var ib = inheritModeOf(bones[checked[ci]] ? bones[checked[ci]].inherit : undefined);
      if (!ib.supported) {
        return fail("INHERIT_UNSUPPORTED", {
          inherit: ib.mode,
          inheritBoneIndex: checked[ci],
          issues: issues,
          limitations: limitations,
          boneIndex: idx,
        });
      }
    }

    var selfName = bones[idx] && bones[idx].name !== undefined ? bones[idx].name : null;
    var deltaWorld = worldDeltaOfLocal(bones, idx, delta) || { x: NaN, y: NaN };
    var det = W0.a * W0.d - W0.b * W0.c;
    var childIdxAll = directChildrenOf(bones, idx);
    var childIdx = childIdxAll;
    if (Array.isArray(o.childIndices)) {
      childIdx = childIdxAll.filter(function (i) { return o.childIndices.indexOf(i) >= 0; });
    }
    var attIn = Array.isArray(o.attachments) ? o.attachments : [];
    var attIdx = [];
    var skipped = [];
    for (var ai = 0; ai < attIn.length; ai++) {
      var att = attIn[ai];
      if (!att || att.boneIndex !== idx) continue;
      var type = att.type === undefined || att.type === null ? "region" : String(att.type);
      if (type !== "region") {
        skipped.push({
          index: isFiniteNumber(att.index) ? att.index : ai,
          boneIndex: idx,
          name: att.name === undefined ? null : att.name,
          reason: "ATTACHMENT_NOT_REGION",
        });
        continue;
      }
      attIdx.push({ pos: ai, att: att });
    }

    /* 选中骨自身的世界位移（用于诊断）：ΔO = W1.t − W0.t，等价 P.linear·Δlocal */
    var selfX = (isFiniteNumber(bones[idx].x) ? bones[idx].x : 0) + delta.x;
    var selfY = (isFiniteNumber(bones[idx].y) ? bones[idx].y : 0) + delta.y;

    /* 幂等：delta = 0 ⇒ 零改动（仍返回可用的诊断） */
    var zero = delta.x === 0 && delta.y === 0;
    if (!(Math.abs(det) > tol) || !isFinite(det)) {
      return fail("COMPENSATE_SINGULAR", {
        code: editCode("COMPENSATE_SINGULAR"),
        issues: issues,
        limitations: limitations,
        boneIndex: idx,
        det: det,
        mode: mode,
        delta: { x: delta.x, y: delta.y },
        selfChange: { boneIndex: idx, name: selfName, x: selfX, y: selfY },
      });
    }
    if (zero) {
      return {
        ok: true,
        mode: mode,
        boneIndex: idx,
        delta: { x: 0, y: 0 },
        deltaWorld: { x: 0, y: 0 },
        pivotBefore: { x: W0.tx, y: W0.ty },
        pivotAfter: { x: W0.tx, y: W0.ty },
        selfChange: { boneIndex: idx, name: selfName, x: selfX, y: selfY },
        changes: [],
        attachmentChanges: [],
        skippedAttachments: skipped,
        issues: issues,
        limitations: limitations,
        diagnostics: { det: det, mode: mode, idempotent: true, compensated: 0, attachments: 0 },
      };
    }

    /* u = W0.linear⁻¹ · ΔO ⇒ 子骨/附件补偿量 = −u */
    var invW0 = invert(W0, tol);
    if (!invW0) {
      return fail("COMPENSATE_SINGULAR", {
        code: editCode("COMPENSATE_SINGULAR"),
        issues: issues,
        limitations: limitations,
        boneIndex: idx,
        det: det,
      });
    }

    /* 补偿后的骨数组（浅拷贝选中骨，其余原样引用，便于复用链求值） */
    var after = bones.slice();
    after[idx] = {};
    for (var k in bones[idx]) if (Object.prototype.hasOwnProperty.call(bones[idx], k)) after[idx][k] = bones[idx][k];
    after[idx].x = selfX;
    after[idx].y = selfY;

    var changes = [];
    var subs = [];
    if (mode !== "none") {
      for (var c = 0; c < childIdx.length; c++) {
        var ci2 = childIdx[c];
        var cb = bones[ci2];
        var cx0 = isFiniteNumber(cb.x) ? cb.x : 0;
        var cy0 = isFiniteNumber(cb.y) ? cb.y : 0;
        subs.push({ kind: "bone", boneIndex: ci2, x: cx0, y: cy0, name: cb.name === undefined ? null : cb.name });
      }
      if (mode === "childrenAndAttachments") {
        for (var a2 = 0; a2 < attIdx.length; a2++) {
          var entry = attIdx[a2];
          var ax0 = isFiniteNumber(entry.att.x) ? entry.att.x : 0;
          var ay0 = isFiniteNumber(entry.att.y) ? entry.att.y : 0;
          subs.push({
            kind: "attachment",
            pos: entry.pos,
            index: isFiniteNumber(entry.att.index) ? entry.att.index : entry.pos,
            boneIndex: idx,
            x: ax0,
            y: ay0,
            name: entry.att.name === undefined ? null : entry.att.name,
          });
        }
      }
    }

    /* ΔO：先算补偿后的世界（含选中骨已加的 delta），得到真实 ΔO，再求 u 与补偿量 */
    var worldsAfter = boneChainWorlds(after);
    if (!worldsAfter.ok) {
      return fail(worldsAfter.reason, { issues: issues, limitations: limitations, boneIndex: worldsAfter.boneIndex });
    }
    var W1 = worldsAfter.worlds[idx];
    var dOx = W1.tx - W0.tx;
    var dOy = W1.ty - W0.ty;
    var u = { x: invW0.a * dOx + invW0.c * dOy, y: invW0.b * dOx + invW0.d * dOy };
    if (!isFiniteNumber(u.x) || !isFiniteNumber(u.y)) {
      return fail("RESULT_NOT_FINITE", { issues: issues, limitations: limitations, boneIndex: idx });
    }

    /* 把补偿写进 after：子骨改 x/y；附件改 x/y 后必须重建世界（附件用骨世界 · T(att)） */
    var attWorld = function (boneWorld, ax, ay) {
      return { tx: boneWorld.a * ax + boneWorld.c * ay + boneWorld.tx, ty: boneWorld.b * ax + boneWorld.d * ay + boneWorld.ty };
    };
    for (var s = 0; s < subs.length; s++) {
      var sub = subs[s];
      var nx = sub.x - u.x;
      var ny = sub.y - u.y;
      if (sub.kind === "bone") {
        var wb = worldsBefore.worlds[sub.boneIndex];
        after[sub.boneIndex] = {};
        for (var kk in bones[sub.boneIndex]) {
          if (Object.prototype.hasOwnProperty.call(bones[sub.boneIndex], kk)) after[sub.boneIndex][kk] = bones[sub.boneIndex][kk];
        }
        after[sub.boneIndex].x = nx;
        after[sub.boneIndex].y = ny;
        var wa = attWorld(W1, nx, ny);
        var err = Math.hypot(wa.tx - wb.tx, wa.ty - wb.ty);
        changes.push({
          boneIndex: sub.boneIndex,
          name: sub.name,
          x: nx,
          y: ny,
          dx: nx - sub.x,
          dy: ny - sub.y,
          worldBefore: { x: wb.tx, y: wb.ty },
          worldAfter: { x: wa.tx, y: wa.ty },
          error: err,
        });
      } else {
        var wbA = attWorld(W0, sub.x, sub.y);
        var waA = attWorld(W1, nx, ny);
        var errA = Math.hypot(waA.tx - wbA.tx, waA.ty - wbA.ty);
        subs[s]._out = {
          index: sub.index,
          boneIndex: idx,
          name: sub.name,
          x: nx,
          y: ny,
          dx: nx - sub.x,
          dy: ny - sub.y,
          worldBefore: wbA,
          worldAfter: waA,
          error: errA,
        };
      }
    }

    /* 子骨链变了 → 重新求一次世界，逐个核对「补偿后世界 vs 补偿前世界」（自证不变量） */
    var verify = boneChainWorlds(after);
    if (verify.ok) {
      for (var v = 0; v < changes.length; v++) {
        var vw = verify.worlds[changes[v].boneIndex];
        if (vw) {
          changes[v].worldAfter = { x: vw.tx, y: vw.ty };
          changes[v].error = Math.hypot(vw.tx - changes[v].worldBefore.x, vw.ty - changes[v].worldBefore.y);
        }
      }
    }
    var attachmentChanges = [];
    var maxError = 0;
    for (var m = 0; m < subs.length; m++) {
      if (subs[m].kind === "attachment") attachmentChanges.push(subs[m]._out);
    }
    for (var e1 = 0; e1 < changes.length; e1++) maxError = Math.max(maxError, changes[e1].error);
    for (var e2 = 0; e2 < attachmentChanges.length; e2++) maxError = Math.max(maxError, attachmentChanges[e2].error);
    for (var sk = 0; sk < skipped.length; sk++) {
      issues.push({
        severity: "warning",
        code: "ATTACHMENT_NOT_REGION",
        boneIndex: idx,
        index: skipped[sk].index,
        message: "附件 " + (skipped[sk].name === null ? "#" + skipped[sk].index : skipped[sk].name) +
          " 不是 region（网格/加权）：自身 x/y 补偿不适用，已跳过（改由骨骼目标驱动）。",
      });
    }

    var pivotBefore = { x: W0.tx, y: W0.ty };
    var pivotAfter = { x: W1.tx, y: W1.ty };
    return {
      ok: true,
      mode: mode,
      boneIndex: idx,
      delta: { x: delta.x, y: delta.y },
      deltaWorld: { x: dOx, y: dOy },
      requestedWorldDelta: deltaWorld,
      pivotBefore: pivotBefore,
      pivotAfter: pivotAfter,
      selfChange: { boneIndex: idx, name: selfName, x: selfX, y: selfY },
      u: u,
      changes: changes,
      attachmentChanges: attachmentChanges,
      skippedAttachments: skipped,
      maxError: maxError,
      issues: issues,
      limitations: limitations,
      diagnostics: {
        det: det,
        mode: mode,
        idempotent: false,
        compensated: changes.length,
        attachments: attachmentChanges.length,
        skipped: skipped.length,
        maxError: maxError,
      },
    };
  }

  /**
   * 轴心重定位（P2-03）：把骨原点移到世界点 targetWorld（或按 worldDelta 平移），
   * 保持 rotation/scale/shear 不变，并补偿直接子骨/挂载附件使其世界位置不变。
   * 内部 = 「世界位移 → 局部 delta（父级线性求逆）」+ compensateMove。
   *
   * @param {object} p  同 compensateMove，另有：
   *   targetWorld  {x,y} 目标世界点（与 worldDelta 二选一）
   *   worldDelta   {x,y} 世界位移（优先）
   * @returns {ok:true, delta, deltaWorld, pivotBefore, pivotAfter, changes, attachmentChanges, ...} | {ok:false, reason}
   */
  function compensatePivot(p) {
    var o = p || {};
    var bones = o.bones;
    var limitations = [
      "轴心重定位只改选中骨的局部 x/y（世界平移），不改 rotation/scale/shear；子骨/附件世界位置由补偿保持。",
      "目标点用父级线性求逆换算：父级世界矩阵奇异（scaleX/scaleY≈0）时不可解，拒绝。",
      "子骨覆盖边界同 compensateMove：只直接子骨（孙代自动不变），附件仅 region。",
    ];
    if (!Array.isArray(bones)) return fail("BONES_INVALID", { issues: [], limitations: limitations });
    var idx = o.boneIndex;
    if (!isFiniteNumber(idx) || !Number.isInteger(idx) || idx < 0 || idx >= bones.length) {
      return fail("BONE_INDEX_INVALID", { issues: [], limitations: limitations, boneIndex: idx });
    }
    var worlds = boneChainWorlds(bones);
    if (!worlds.ok) return fail(worlds.reason, { issues: [], limitations: limitations, boneIndex: worlds.boneIndex });
    var W0 = worlds.worlds[idx];
    var worldDelta;
    if (o.worldDelta && isFiniteNumber(o.worldDelta.x) && isFiniteNumber(o.worldDelta.y)) {
      worldDelta = { x: o.worldDelta.x, y: o.worldDelta.y };
    } else if (o.targetWorld && isFiniteNumber(o.targetWorld.x) && isFiniteNumber(o.targetWorld.y)) {
      worldDelta = { x: o.targetWorld.x - W0.tx, y: o.targetWorld.y - W0.ty };
    } else {
      return fail("POINT_INVALID", { issues: [], limitations: limitations, boneIndex: idx });
    }
    var delta = localDeltaOfWorld(bones, idx, worldDelta);
    if (!delta) {
      return fail("PARENT_SINGULAR", {
        code: editCode("PARENT_SINGULAR"),
        issues: [],
        limitations: limitations,
        boneIndex: idx,
        pivotBefore: { x: W0.tx, y: W0.ty },
      });
    }
    if (!isFiniteNumber(delta.x) || !isFiniteNumber(delta.y)) {
      return fail("RESULT_NOT_FINITE", { issues: [], limitations: limitations, boneIndex: idx });
    }
    var res = compensateMove({
      bones: bones,
      boneIndex: idx,
      delta: delta,
      mode: o.mode,
      attachments: o.attachments,
      childIndices: o.childIndices,
      tol: o.tol,
    });
    if (!res.ok) {
      if (res.limitations) limitations.forEach(function (t) { res.limitations.push(t); });
      return res;
    }
    res.limitations = limitations.concat(res.limitations || []);
    res.worldDelta = worldDelta;
    res.pivotTargetBefore = { x: W0.tx, y: W0.ty };
    res.diagnostics = res.diagnostics || {};
    res.diagnostics.worldDelta = worldDelta;
    res.diagnostics.worldDeltaError = Math.hypot(
      res.pivotAfter.x - res.pivotBefore.x - worldDelta.x,
      res.pivotAfter.y - res.pivotBefore.y - worldDelta.y
    );
    return res;
  }

  /* ==========================================================================
   * 导出
   * ====================================================================== */
  var api = {
    API_VERSION: API_VERSION,
    DEFAULT_GIZMO_SIZE: DEFAULT_SIZE,
    DEFAULT_HIT_TOL: DEFAULT_HIT_TOL,
    DEFAULT_JOINT_TOL: DEFAULT_JOINT_TOL,
    DEFAULT_LINE_TOL: DEFAULT_LINE_TOL,
    EDIT_CODES: EDIT_CODES,
    editCode: editCode,

    identity: identity,
    mul: mul,
    invert: invert,
    apply: apply,
    applyVec: applyVec,
    rotationOf: rotationOf,
    linearFrom: linearFrom,
    localLinear: localLinear,
    boneWorldLinear: boneWorldLinear,
    inheritBasis: inheritBasis,
    wrap180: wrap180,
    isMat: isMat,
    isFiniteNumber: isFiniteNumber,
    distToSegment: distToSegment,

    translateFromDrag: translateFromDrag,
    rotateFromDrag: rotateFromDrag,
    scaleFromDrag: scaleFromDrag,
    aimRotation: aimRotation,
    aimTipOf: aimTipOf,
    attachmentDelta: attachmentDelta,

    /* P2-03 轴心补偿（纯数学，无 DOM） */
    boneLocalMatrix: boneLocalMatrix,
    boneChainWorlds: boneChainWorlds,
    directChildrenOf: directChildrenOf,
    ancestorIndicesOf: ancestorIndicesOf,
    inheritModeOf: inheritModeOf,
    worldDeltaOfLocal: worldDeltaOfLocal,
    localDeltaOfWorld: localDeltaOfWorld,
    compensateMove: compensateMove,
    compensatePivot: compensatePivot,

    parentSimilarity: parentSimilarity,
    canWorldRotate: canWorldRotate,
    canWorldAxisScale: canWorldAxisScale,
    canWorldUniformScale: canWorldUniformScale,

    gizmoGeometry: gizmoGeometry,
    hitGizmo: hitGizmo,
    boneHitTest: boneHitTest,

    worldToScreen: worldToScreen,
    screenToWorld: screenToWorld,
    screenAngleOf: screenAngleOf,
    axisAngleOf: axisAngleOf,
  };

  global.SpineBoneEdit = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
