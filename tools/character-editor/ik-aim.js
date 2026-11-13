/*
 * ik-aim.js —— 两骨解析 IK（P2-06）与骨架结构 JSON 数据操作（P2-06）纯模块
 *
 * 边界：不碰 DOM / fetch / 渲染。浏览器暴露 window.SpineIkAim，Node 里是 globalThis.SpineIkAim。
 *
 * 矩阵约定：**与 spine-core/pose.world 一致**（x' = a*x + c*y + tx，y' = b*x + d*y + ty）。
 *   官方 Bone 矩阵为 x' = a*x + b*y + worldX（spine-ts），映射关系 our.a=official.a、our.b=official.c、
 *   our.c=official.b、our.d=official.d ——本模块所有输入输出统一用 our 约定。
 *
 * solveTwoBone 严格按官方 `IkConstraint.apply2`（spine-ts 4.2 IkConstraint.ts:178-325）：
 *   - 只实现**均匀父缩放**分支（官方 :200 `u = |psx - psy| <= 1e-4`）；非均匀缩放走官方椭圆兜底分支，本模块
 *     显式返回 `NON_UNIFORM_PARENT`（与 spine-core 的 IK 子集限制一致），不猜、不写坏数据。
 *   - 符号处理 :182-198（os1/os2/s2）、softness :229-239、stretch :250-254、精确角 :257-259、
 *     最终角度与 mix 插值 :310-324 全部照抄。
 *   - 够不到目标：官方把 cos 夹到 ±1（:244-249）；本模块同样夹取并给 issue `IK_TARGET_OUT_OF_REACH`。
 *   - 链退化（父/子原点重合，官方退化 apply1）：返回 `DEGENERATE_CHAIN`。
 */
(function (global) {
  "use strict";

  const RAD = 180 / Math.PI;
  const DEG = Math.PI / 180;
  const TIME_EPS = 1e-6;
  const ANIM_TRACK_FIELDS = Object.freeze(["rotate", "translate", "scale", "shear"]);

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function isFiniteNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }
  function issue(path, code, message) {
    return { path: String(path == null ? "" : path), code: code, message: String(message === undefined ? code : message) };
  }
  function fail(code, message, extra) {
    const out = { ok: false, issues: [issue(extra && extra.path, code, message)] };
    if (extra) for (const k of Object.keys(extra)) if (k !== "path") out[k] = extra[k];
    return out;
  }
  function normalize180(deg) {
    let v = deg % 360;
    if (v > 180) v -= 360;
    else if (v < -180) v += 360;
    return v;
  }
  function isMat(m) {
    return isObject(m) && isFiniteNum(m.a) && isFiniteNum(m.b) && isFiniteNum(m.c) && isFiniteNum(m.d) && isFiniteNum(m.tx) && isFiniteNum(m.ty);
  }
  function applyMat(m, x, y) {
    return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty };
  }
  function invApply(m, x, y) {
    const det = m.a * m.d - m.c * m.b;
    if (Math.abs(det) < 1e-12) return null;
    const px = x - m.tx;
    const py = y - m.ty;
    return { x: (m.d * px - m.c * py) / det, y: (-m.b * px + m.a * py) / det };
  }
  function mulMat(p, l) {
    return {
      a: p.a * l.a + p.c * l.b,
      b: p.b * l.a + p.d * l.b,
      c: p.a * l.c + p.c * l.d,
      d: p.b * l.c + p.d * l.d,
      tx: p.a * l.tx + p.c * l.ty + p.tx,
      ty: p.b * l.tx + p.d * l.ty + p.ty,
    };
  }
  /** 局部矩阵（our 约定），与官方 Bone.update 的 la/lb/lc/ld 同源 */
  function localMatrix(bone) {
    const rotation = isFiniteNum(bone.rotation) ? bone.rotation : 0;
    const sx = isFiniteNum(bone.scaleX) ? bone.scaleX : 1;
    const sy = isFiniteNum(bone.scaleY) ? bone.scaleY : 1;
    const shx = isFiniteNum(bone.shearX) ? bone.shearX : 0;
    const shy = isFiniteNum(bone.shearY) ? bone.shearY : 0;
    const la = Math.cos((rotation + shx) * DEG) * sx; // official a
    const lb = Math.cos((rotation + 90 + shy) * DEG) * sy; // official b
    const lc = Math.sin((rotation + shx) * DEG) * sx; // official c
    const ld = Math.sin((rotation + 90 + shy) * DEG) * sy; // official d
    return {
      a: la,
      b: lc,
      c: lb,
      d: ld,
      tx: isFiniteNum(bone.x) ? bone.x : 0,
      ty: isFiniteNum(bone.y) ? bone.y : 0,
    };
  }
  function worldOf(world, bone) {
    return mulMat(world, localMatrix(bone));
  }

  /* ------------------------------------------------------------------ *
   * 两骨解析 IK
   * ------------------------------------------------------------------ */
  /**
   * @param {{parent:object, child:object, targetWorld:{x,y}, parentWorld:object, grandWorld:object,
   *          bendPositive?:boolean, mix?:number, stretch?:boolean, softness?:number, path?:string}} opts
   * @returns {{ok:boolean, rotations?:[number,number], deltaDeg?:[number,number], tipWorld?:{x,y},
   *            outOfReach?:boolean, stretchScale?:number|null, issues:Array}}
   */
  function solveTwoBone(opts) {
    const o = isObject(opts) ? opts : {};
    const path = o.path || "ik";
    const parent = o.parent;
    const child = o.child;
    if (!isObject(parent) || !isObject(child)) return fail("BONES_REQUIRED", "需要 parent/child 骨（含 length/rotation/scale/shear/x/y）", { path: path });
    if (!isMat(o.parentWorld) || !isMat(o.grandWorld)) return fail("MATRIX_REQUIRED", "需要 parentWorld/grandWorld（our 约定 {a,b,c,d,tx,ty}）", { path: path });
    const target = o.targetWorld;
    if (!isObject(target) || !isFiniteNum(target.x) || !isFiniteNum(target.y)) return fail("TARGET_INVALID", "targetWorld 需要有限 x/y", { path: path });
    const childLength = isFiniteNum(child.length) ? child.length : 0;
    if (!(childLength > 0)) return fail("CHILD_LENGTH_ZERO", "子骨长度必须 > 0", { path: path });

    const bendDir = o.bendPositive === false ? -1 : 1;
    const mix = isFiniteNum(o.mix) ? Math.min(1, Math.max(0, o.mix)) : 1;
    const stretch = o.stretch === true;
    const softness = isFiniteNum(o.softness) ? o.softness : 0;
    const issues = [];

    const parentRot = isFiniteNum(parent.rotation) ? parent.rotation : 0;
    const childRot = isFiniteNum(child.rotation) ? child.rotation : 0;
    const childShearX = isFiniteNum(child.shearX) ? child.shearX : 0;
    let psx = isFiniteNum(parent.scaleX) ? parent.scaleX : 1;
    let psy = isFiniteNum(parent.scaleY) ? parent.scaleY : 1;
    let csx = isFiniteNum(child.scaleX) ? child.scaleX : 1;
    const apsx = Math.abs(psx);
    const apsy = Math.abs(psy);
    if (Math.abs(apsx - apsy) > 1e-4) {
      return fail("NON_UNIFORM_PARENT", "父骨非均匀缩放（官方走椭圆兜底分支，本模块未实现）", { path: path });
    }
    /* 官方 :182-198 符号处理 */
    let os1 = 0;
    let s2 = 1;
    if (psx < 0) {
      psx = -psx;
      os1 = 180;
      s2 = -1;
    } else {
      os1 = 0;
      s2 = 1;
    }
    if (psy < 0) s2 = -s2;
    let os2 = 0;
    if (csx < 0) {
      csx = -csx;
      os2 = 180;
    } else os2 = 0;

    const cx = isFiniteNum(child.x) ? child.x : 0;
    const cy = isFiniteNum(child.y) ? child.y : 0;
    /* 官方 :200-209：均匀缩放且非 stretch 时用子骨 y；`!u || stretch` 时按 0 投影（u 恒为真，非均匀已拒绝） */
    const cyOrigin = stretch ? 0 : cy;
    const parentLocal = { x: isFiniteNum(parent.x) ? parent.x : 0, y: isFiniteNum(parent.y) ? parent.y : 0 };
    const childOriginWorld = applyMat(o.parentWorld, cx, cyOrigin);
    const childInGrand = invApply(o.grandWorld, childOriginWorld.x, childOriginWorld.y);
    if (!childInGrand) return fail("SINGULAR_GRAND_PARENT", "祖父世界矩阵不可逆", { path: path });
    const dx = childInGrand.x - parentLocal.x;
    const dy = childInGrand.y - parentLocal.y;
    const l1 = Math.sqrt(dx * dx + dy * dy);
    if (l1 < 1e-4) return fail("DEGENERATE_CHAIN", "父骨与子骨原点重合（官方退化为 apply1）", { path: path });
    const l2 = childLength * csx;

    const targetInGrand = invApply(o.grandWorld, target.x, target.y);
    let tx = targetInGrand.x - parentLocal.x;
    let ty = targetInGrand.y - parentLocal.y;
    let dd = tx * tx + ty * ty;
    if (softness !== 0) {
      /* 官方 :229-239 */
      const soft = softness * apsx * (csx + 1) * 0.5;
      const td = Math.sqrt(dd);
      const sd = td - l1 - l2 * apsx + soft;
      if (sd > 0) {
        let p = Math.min(1, sd / (soft * 2)) - 1;
        p = (sd - soft * (1 - p * p)) / td;
        tx -= p * tx;
        ty -= p * ty;
        dd = tx * tx + ty * ty;
      }
    }

    let cos = (dd - l1 * l1 - l2 * l2) / (2 * l1 * l2);
    let a2;
    let outOfReach = false;
    let stretchScale = null;
    if (cos < -1) {
      cos = -1;
      a2 = Math.PI * bendDir;
      outOfReach = true;
      issues.push(issue(path, "IK_TARGET_OUT_OF_REACH", "目标过近，官方把 cos 夹到 -1"));
    } else if (cos > 1) {
      cos = 1;
      a2 = 0;
      outOfReach = true;
      issues.push(issue(path, "IK_TARGET_OUT_OF_REACH", "目标过远，官方把 cos 夹到 1"));
      if (stretch) {
        /* 官方 :250-254：按 mix 拉伸父骨缩放 */
        const k = (Math.sqrt(dd) / (l1 + l2) - 1) * mix + 1;
        stretchScale = k;
      }
    } else {
      a2 = Math.acos(cos) * bendDir;
    }
    const A = l1 + l2 * cos;
    const B = l2 * Math.sin(a2);
    const a1 = Math.atan2(ty * A - tx * B, tx * A + ty * B);
    const os = Math.atan2(cyOrigin, cx) * s2;
    /* 官方 :310-324 */
    let d1 = (a1 - os) * RAD + os1 - parentRot;
    d1 = normalize180(d1);
    let d2 = ((a2 + os) * RAD - childShearX) * s2 + os2 - childRot;
    d2 = normalize180(d2);
    const newParentRot = parentRot + d1 * mix;
    const newChildRot = childRot + d2 * mix;

    /* 解算后的骨尖（our 约定 FK）：以父骨世界矩阵为基准，父骨**局部平移不再重复叠加**（parentWorld 已含） */
    const parentWorldAfter = worldOf(o.parentWorld, {
      x: 0,
      y: 0,
      rotation: newParentRot,
      scaleX: psx,
      scaleY: psy,
      shearX: isFiniteNum(parent.shearX) ? parent.shearX : 0,
      shearY: isFiniteNum(parent.shearY) ? parent.shearY : 0,
    });
    const reach = l2;
    const ang = (newChildRot + childShearX) * DEG;
    const tipWorld = applyMat(parentWorldAfter, cx + reach * Math.cos(ang), cy + reach * Math.sin(ang));

    return {
      ok: true,
      rotations: [newParentRot, newChildRot],
      deltaDeg: [d1 * mix, d2 * mix],
      tipWorld: tipWorld,
      outOfReach: outOfReach,
      stretchScale: stretchScale,
      chainLengths: [l1, l2],
      issues: issues,
    };
  }

  /** N 骨 FABRIK：未实现（显式声明，不假装成功） */
  function solveChainFABRIK() {
    return { ok: false, reason: "NOT_IMPLEMENTED", issues: [issue("ik.chain", "NOT_IMPLEMENTED", "N 骨 FABRIK 未实现（P2 列为可选）")] };
  }

  /* ------------------------------------------------------------------ *
   * 骨架结构数据操作（纯 JSON）
   * ------------------------------------------------------------------ */
  function bonesOf(rawModel) {
    return rawModel && Array.isArray(rawModel.bones) ? rawModel.bones : null;
  }
  function findBoneIndex(rawModel, name) {
    const bones = bonesOf(rawModel);
    if (!bones) return -1;
    for (let i = 0; i < bones.length; i++) if (isObject(bones[i]) && bones[i].name === name) return i;
    return -1;
  }
  function findConstraintBag(rawModel, key) {
    return rawModel && isObject(rawModel[key]) ? rawModel[key] : null;
  }
  /** 约束集合：官方 raw 为数组 [{name,...}]，也兼容对象键形式 {name:{...}} */
  function constraintEntries(rawModel, key) {
    const bag = rawModel ? rawModel[key] : null;
    const out = [];
    if (Array.isArray(bag)) {
      for (const c of bag) if (isObject(c) && typeof c.name === "string") out.push({ name: c.name, constraint: c, array: true });
      return out;
    }
    if (isObject(bag)) {
      for (const name of Object.keys(bag)) if (isObject(bag[name])) out.push({ name: name, constraint: bag[name], array: false });
    }
    return out;
  }

  function constraintListOf(rawModel, key) {
    return constraintEntries(rawModel, key);
  }

  function createBone(rawModel, opts) {
    const o = isObject(opts) ? opts : {};
    if (!isObject(rawModel) || !Array.isArray(rawModel.bones)) return fail("MODEL_INVALID", "rawModel.bones 必须是数组");
    const name = o.name;
    if (typeof name !== "string" || !name) return fail("BONE_NAME_REQUIRED", "name 必须是非空字符串");
    if (findBoneIndex(rawModel, name) >= 0) return fail("BONE_NAME_DUPLICATE", "骨名已存在：" + name);
    if (o.parent !== undefined && o.parent !== null) {
      if (typeof o.parent !== "string" || findBoneIndex(rawModel, o.parent) < 0) return fail("BONE_PARENT_MISSING", "父骨不存在：" + String(o.parent));
    }
    const numeric = ["x", "y", "rotation", "length", "scaleX", "scaleY"];
    for (const f of numeric) {
      if (o[f] !== undefined && !isFiniteNum(o[f])) return fail("BONE_FIELD_NUMBER", f + " 必须是有限数");
    }
    if (o.inherit !== undefined && ["normal", "onlyTranslation", "noRotationOrReflection", "noScale", "noScaleOrReflection"].indexOf(o.inherit) < 0) {
      return fail("BONE_INHERIT", "未知 inherit：" + String(o.inherit));
    }
    const out = clone(rawModel);
    const bone = { name: name, parent: o.parent === undefined ? null : o.parent };
    for (const f of numeric) if (o[f] !== undefined) bone[f] = o[f];
    if (o.inherit !== undefined) bone.inherit = o.inherit;
    out.bones.push(bone);
    return { ok: true, value: out, index: out.bones.length - 1, issues: [] };
  }

  /** 递归求某骨的世界矩阵（setup，normal 继承；未知 inherit 按 normal 并在 issues 提示） */
  function setupWorldOf(rawModel, boneName, issues) {
    const idx = findBoneIndex(rawModel, boneName);
    if (idx < 0) return null;
    let guard = 0;
    const chain = [];
    let cur = idx;
    while (cur >= 0 && guard++ < 512) {
      chain.unshift(cur);
      const b = rawModel.bones[cur];
      cur = b && typeof b.parent === "string" ? findBoneIndex(rawModel, b.parent) : -1;
    }
    let world = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    for (const i of chain) {
      const b = rawModel.bones[i];
      if (b.inherit && b.inherit !== "normal" && issues) {
        issues.push(issue("bones." + b.name, "REPARENT_INHERIT_LIMITATION", "inherit=" + b.inherit + "，世界矩阵按 normal 计算"));
      }
      world = worldOf(world, b);
    }
    return world;
  }

  function reparentBone(rawModel, opts) {
    const o = isObject(opts) ? opts : {};
    if (!isObject(rawModel) || !Array.isArray(rawModel.bones)) return fail("MODEL_INVALID", "rawModel.bones 必须是数组");
    const boneName = o.boneName;
    const idx = findBoneIndex(rawModel, boneName);
    if (idx < 0) return fail("BONE_NOT_FOUND", "骨不存在：" + String(boneName));
    if (o.newParent !== null && o.newParent !== undefined && o.newParent !== "") {
      if (typeof o.newParent !== "string" || findBoneIndex(rawModel, o.newParent) < 0) return fail("BONE_PARENT_MISSING", "新父骨不存在：" + String(o.newParent));
      if (o.newParent === boneName) return fail("REPARENT_SELF", "不能把骨挂到自己");
      /* 防止形成环：新父不能是该骨的后代 */
      let guard = 0;
      let cur = findBoneIndex(rawModel, o.newParent);
      while (cur >= 0 && guard++ < 512) {
        if (cur === idx) return fail("REPARENT_CYCLE", "新父是自身后代，会形成环");
        const b = rawModel.bones[cur];
        cur = b && typeof b.parent === "string" ? findBoneIndex(rawModel, b.parent) : -1;
      }
    }
    const issues = [];
    const out = clone(rawModel);
    const bone = out.bones[idx];
    if (o.keepWorld === true) {
      const worldBefore = setupWorldOf(rawModel, boneName, issues);
      const newParentName = o.newParent === undefined ? bone.parent : o.newParent;
      const parentName = newParentName === null || newParentName === undefined ? null : newParentName;
      const parentWorld = parentName ? setupWorldOf(rawModel, parentName, issues) : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
      if (!worldBefore || !parentWorld) return fail("REPARENT_MATRIX", "无法计算世界矩阵");
      const det = parentWorld.a * parentWorld.d - parentWorld.c * parentWorld.b;
      if (Math.abs(det) < 1e-12) return fail("REPARENT_SINGULAR", "新父世界矩阵不可逆");
      /* local = inv(parentWorld) * worldBefore（our 打包：a=official la、b=official lc、c=official lb、d=official ld） */
      const invP = { a: parentWorld.d / det, b: -parentWorld.b / det, c: -parentWorld.c / det, d: parentWorld.a / det, tx: 0, ty: 0 };
      const A = invP.a * worldBefore.a + invP.c * worldBefore.b;
      const B = invP.b * worldBefore.a + invP.d * worldBefore.b;
      const C = invP.a * worldBefore.c + invP.c * worldBefore.d;
      const D = invP.b * worldBefore.c + invP.d * worldBefore.d;
      const ltx = (parentWorld.d * (worldBefore.tx - parentWorld.tx) - parentWorld.c * (worldBefore.ty - parentWorld.ty)) / det;
      const lty = (-parentWorld.b * (worldBefore.tx - parentWorld.tx) + parentWorld.a * (worldBefore.ty - parentWorld.ty)) / det;
      /* 精确 SRT 反解：official la=A, lc=B, lb=C, ld=D
         la = cos(r+shx)*sx, lc = sin(r+shx)*sx → thetaX = atan2(B, A)
         lb = cos(r+90+shy)*sy, ld = sin(r+90+shy)*sy → thetaY = atan2(D, C) */
      const thetaX = Math.atan2(B, A) * RAD;
      const thetaY = Math.atan2(D, C) * RAD;
      const sx2 = Math.sqrt(A * A + B * B);
      const sy2 = Math.sqrt(C * C + D * D);
      if (!(sx2 > 1e-12) || !(sy2 > 1e-12)) return fail("REPARENT_DECOMPOSE", "局部矩阵退化，无法反解 scale");
      bone.parent = parentName;
      bone.x = ltx;
      bone.y = lty;
      bone.rotation = normalize180(thetaX);
      bone.scaleX = sx2;
      bone.scaleY = sy2;
      bone.shearX = 0;
      bone.shearY = normalize180(thetaY - thetaX - 90);
      issues.push(issue("bones." + boneName, "REPARENT_NORMALIZED_SHEAR", "反解把 shearX 归零并重新分配 rotation/shearY（官方 TRS 表示唯一化）"));
      return {
        ok: true,
        value: out,
        updated: ["bones." + boneName + ".parent", "bones." + boneName + ".x", "bones." + boneName + ".y", "bones." + boneName + ".rotation", "bones." + boneName + ".scaleX", "bones." + boneName + ".scaleY", "bones." + boneName + ".shearX", "bones." + boneName + ".shearY"],
        requiresAnimationReview: true,
        preservedWorld: true,
        issues: issues,
      };
    }
    bone.parent = o.newParent === undefined || o.newParent === "" ? null : o.newParent;
    return { ok: true, value: out, updated: ["bones." + boneName + ".parent"], requiresAnimationReview: true, issues: issues };
  }

  function renameBone(rawModel, opts) {
    const o = isObject(opts) ? opts : {};
    if (!isObject(rawModel) || !Array.isArray(rawModel.bones)) return fail("MODEL_INVALID", "rawModel.bones 必须是数组");
    const from = o.from;
    const to = o.to;
    if (typeof from !== "string" || !from) return fail("RENAME_FROM_REQUIRED", "from 必须是非空字符串");
    if (typeof to !== "string" || !to) return fail("RENAME_TO_REQUIRED", "to 必须是非空字符串");
    const idx = findBoneIndex(rawModel, from);
    if (idx < 0) return fail("BONE_NOT_FOUND", "骨不存在：" + from);
    const clash = findBoneIndex(rawModel, to);
    if (clash >= 0 && clash !== idx) return fail("BONE_NAME_DUPLICATE", "目标骨名已存在：" + to);
    const out = clone(rawModel);
    const updated = [];
    out.bones[idx].name = to;
    updated.push("bones[" + idx + "].name");
    for (let i = 0; i < out.bones.length; i++) {
      const b = out.bones[i];
      if (b && b.parent === from) {
        b.parent = to;
        updated.push("bones[" + i + "].parent");
      }
    }
    if (Array.isArray(out.slots)) {
      for (let i = 0; i < out.slots.length; i++) {
        const s = out.slots[i];
        if (s && s.bone === from) {
          s.bone = to;
          updated.push("slots[" + i + "].bone");
        }
      }
    }
    for (const key of ["ik", "transform", "path", "physics"]) {
      for (const item of constraintListOf(out, key)) {
        const c = item.constraint;
        const cname = item.name;
        if (Array.isArray(c.bones)) {
          for (let i = 0; i < c.bones.length; i++) {
            if (c.bones[i] === from) {
              c.bones[i] = to;
              updated.push(key + "." + cname + ".bones[" + i + "]");
            }
          }
        }
        if (c.target === from && key !== "path") {
          /* path 的 target 是槽名，不随骨改名而改 */
          c.target = to;
          updated.push(key + "." + cname + ".target");
        }
      }
    }
    /* 动画键迁移：animations.<anim>.bones.<from> → <to>（目标已存在则按字段合并、同 time 去重，来源值优先） */
    const animIssues = [];
    let mergedKeys = 0;
    if (isObject(out.animations)) {
      for (const animName of Object.keys(out.animations)) {
        const anim = out.animations[animName];
        if (!isObject(anim) || !isObject(anim.bones)) continue;
        if (anim.bones[from] === undefined) continue;
        const src = anim.bones[from];
        if (anim.bones[to] !== undefined) {
          const r = mergeAnimBoneTrack(anim.bones[to], src);
          anim.bones[to] = r.merged;
          mergedKeys += r.mergedKeys;
          if (r.issue) animIssues.push(issue("animations." + animName + ".bones." + from, "MERGED_ANIMATION_TRACK", "目标骨 " + to + " 已有轨道，已合并（" + r.mergedKeys + " 个同刻 key 由来源覆盖）"));
          for (const f of r.conflicts) animIssues.push(issue("animations." + animName + ".bones." + to + "." + f, "MERGED_ANIMATION_FIELD_CONFLICT", "未知字段 " + f + " 两边都有，保留目标值（来源值不再写入）"));
        } else {
          anim.bones[to] = src;
        }
        delete anim.bones[from];
        updated.push("animations." + animName + ".bones." + to);
      }
    }
    /* skins 里的顶点骨索引是数字索引，不受改名影响（官方 SkeletonJson 用索引） */
    return { ok: true, value: out, updated: updated, issues: animIssues, mergedAnimationKeys: mergedKeys };
  }

  /** 动画骨轨合并：rotate/translate/scale/shear 逐字段合并，同 time 由来源覆盖；未知字段保真 */
  function mergeAnimBoneTrack(target, src) {
    const merged = clone(target);
    const conflicts = [];
    let mergedKeys = 0;
    for (const field of Object.keys(src)) {
      const sval = src[field];
      if (ANIM_TRACK_FIELDS.indexOf(field) >= 0 && Array.isArray(sval)) {
        const base = Array.isArray(merged[field]) ? merged[field].slice() : [];
        for (const key of sval) {
          const t = isObject(key) && isFiniteNum(key.time) ? key.time : null;
          let hit = -1;
          if (t !== null) {
            for (let i = 0; i < base.length; i++) {
              const bt = isObject(base[i]) && isFiniteNum(base[i].time) ? base[i].time : null;
              if (bt !== null && Math.abs(bt - t) <= TIME_EPS) {
                hit = i;
                break;
              }
            }
          }
          if (hit >= 0) {
            /* 同刻：来源值覆盖目标值（迁移不丢被改名骨的数据），未知字段两边都保留 */
            base[hit] = Object.assign({}, base[hit], key);
            mergedKeys++;
          } else {
            base.push(key);
          }
        }
        base.sort(function (a, b) {
          const ta = isObject(a) && isFiniteNum(a.time) ? a.time : Infinity;
          const tb = isObject(b) && isFiniteNum(b.time) ? b.time : Infinity;
          return ta - tb;
        });
        merged[field] = base;
        continue;
      }
      if (merged[field] === undefined) {
        merged[field] = sval;
      } else if (JSON.stringify(merged[field]) !== JSON.stringify(sval)) {
        conflicts.push(field);
      }
    }
    return { merged: merged, conflicts: conflicts, mergedKeys: mergedKeys, issue: mergedKeys > 0 || conflicts.length > 0 };
  }

  function referencesTo(rawModel, boneName) {
    const refs = [];
    if (!isObject(rawModel)) return refs;
    if (Array.isArray(rawModel.slots)) {
      for (let i = 0; i < rawModel.slots.length; i++) if (rawModel.slots[i] && rawModel.slots[i].bone === boneName) refs.push("slots[" + i + "].bone");
    }
    for (const key of ["ik", "transform", "path", "physics"]) {
      for (const item of constraintListOf(rawModel, key)) {
        const c = item.constraint;
        const cname = item.name;
        if (Array.isArray(c.bones) && c.bones.indexOf(boneName) >= 0) refs.push(key + "." + cname + ".bones");
        /* path 的 target 是槽名，不属于骨引用 */
        if (key !== "path" && c.target === boneName) refs.push(key + "." + cname + ".target");
      }
    }
    if (isObject(rawModel.animations)) {
      for (const animName of Object.keys(rawModel.animations)) {
        const a = rawModel.animations[animName];
        if (isObject(a) && isObject(a.bones) && a.bones[boneName] !== undefined) refs.push("animations." + animName + ".bones." + boneName);
      }
    }
    return refs;
  }

  /** 是否存在加权网格（顶点里烘焙了骨索引 → 删骨需重映射） */
  function hasWeightedVertices(rawModel) {
    const skins = rawModel && rawModel.skins;
    const list = Array.isArray(skins) ? skins : isObject(skins) ? Object.keys(skins).map(function (k) { return skins[k]; }) : [];
    for (const skin of list) {
      const att = skin && skin.attachments;
      if (!isObject(att)) continue;
      for (const slotName of Object.keys(att)) {
        const slotMap = att[slotName];
        if (!isObject(slotMap)) continue;
        for (const attName of Object.keys(slotMap)) {
          const a = slotMap[attName];
          if (!isObject(a) || a.type !== "mesh") continue;
          const uvs = Array.isArray(a.uvs) ? a.uvs : null;
          const v = Array.isArray(a.vertices) ? a.vertices : null;
          if (uvs && v && v.length !== (uvs.length / 2) * 2) return true;
        }
      }
    }
    return false;
  }

  function deleteBone(rawModel, opts) {
    const o = isObject(opts) ? opts : {};
    if (!isObject(rawModel) || !Array.isArray(rawModel.bones)) return fail("MODEL_INVALID", "rawModel.bones 必须是数组");
    const name = o.name;
    const idx = findBoneIndex(rawModel, name);
    if (idx < 0) return fail("BONE_NOT_FOUND", "骨不存在：" + String(name));
    const refs = referencesTo(rawModel, name);
    /* 子骨引用也算：删父必须处理子骨 */
    for (const b of rawModel.bones) if (b && b.parent === name) refs.push("bones[" + findBoneIndex(rawModel, b.name) + "].parent");
    if (refs.length) return fail("DELETE_BONE_REFERENCED", "骨仍被引用，拒绝删除", { references: refs });
    if (hasWeightedVertices(rawModel)) {
      return fail("DELETE_REQUIRES_WEIGHT_REMAP", "存在加权网格（顶点烘焙骨索引），删除骨需要重映射全部权重索引；本模块显式拒绝而不是写坏数据", { references: [] });
    }
    const out = clone(rawModel);
    out.bones.splice(idx, 1);
    return { ok: true, value: out, removedIndex: idx, requiresWeightRemap: false, issues: [] };
  }

  function validateSkeleton(rawModel) {
    const issues = [];
    if (!isObject(rawModel) || !Array.isArray(rawModel.bones)) return { ok: false, issues: [issue("model", "MODEL_INVALID", "rawModel.bones 必须是数组")] };
    const names = new Map();
    for (let i = 0; i < rawModel.bones.length; i++) {
      const b = rawModel.bones[i];
      if (!isObject(b) || typeof b.name !== "string" || !b.name) {
        issues.push(issue("bones[" + i + "]", "BONE_NAME_INVALID", "骨缺少合法 name"));
        continue;
      }
      if (names.has(b.name)) issues.push(issue("bones[" + i + "]", "BONE_NAME_DUPLICATE", "骨名重复：" + b.name));
      names.set(b.name, i);
      if (b.parent !== undefined && b.parent !== null && typeof b.parent === "string") {
        if (!names.has(b.parent) && findBoneIndex(rawModel, b.parent) < 0) issues.push(issue("bones[" + i + "].parent", "BONE_PARENT_MISSING", "父骨不存在：" + b.parent));
      } else if (b.parent !== undefined && b.parent !== null) {
        issues.push(issue("bones[" + i + "].parent", "BONE_PARENT_TYPE", "parent 必须是字符串或 null"));
      }
    }
    /* 环检测 */
    for (let i = 0; i < rawModel.bones.length; i++) {
      const b = rawModel.bones[i];
      if (!isObject(b) || typeof b.name !== "string") continue;
      let guard = 0;
      let cur = b.parent;
      while (typeof cur === "string" && guard++ < 512) {
        if (cur === b.name) {
          issues.push(issue("bones[" + i + "]", "BONE_CYCLE", "父链成环：" + b.name));
          break;
        }
        const ci = findBoneIndex(rawModel, cur);
        cur = ci >= 0 ? rawModel.bones[ci].parent : null;
      }
      if (guard >= 512) issues.push(issue("bones[" + i + "]", "BONE_CYCLE", "父链过深（>512）"));
    }
    if (Array.isArray(rawModel.slots)) {
      for (let i = 0; i < rawModel.slots.length; i++) {
        const s = rawModel.slots[i];
        if (!isObject(s)) continue;
        if (typeof s.bone !== "string" || findBoneIndex(rawModel, s.bone) < 0) issues.push(issue("slots[" + i + "].bone", "SLOT_BONE_MISSING", "槽引用的骨不存在：" + String(s.bone)));
      }
    }
    for (const key of ["ik", "transform", "path", "physics"]) {
      for (const item of constraintListOf(rawModel, key)) {
        const c = item.constraint;
        const cname = item.name;
        const chain = Array.isArray(c.bones) ? c.bones : [];
        for (let i = 0; i < chain.length; i++) {
          if (typeof chain[i] !== "string" || findBoneIndex(rawModel, chain[i]) < 0) issues.push(issue(key + "." + cname + ".bones[" + i + "]", "CONSTRAINT_BONE_MISSING", "约束引用的骨不存在：" + String(chain[i])));
        }
        if (key === "ik" && chain.length >= 1) {
          for (let i = 1; i < chain.length; i++) {
            const ci = findBoneIndex(rawModel, chain[i]);
            if (ci >= 0 && rawModel.bones[ci].parent !== chain[i - 1]) {
              issues.push(issue(key + "." + cname + ".bones", "IK_CHAIN_NOT_PARENT", "IK 链必须是父子关系：" + chain[i - 1] + " → " + chain[i]));
            }
          }
        }
        if (c.target !== undefined && c.target !== null) {
          if (key === "path") {
            /* 官方 path 约束的 target 是**槽名**（SkeletonJson.ts:224 "Couldn't find target slot"） */
            const slots = Array.isArray(rawModel.slots) ? rawModel.slots : [];
            let slotOk = false;
            if (typeof c.target === "string") for (const s of slots) if (isObject(s) && s.name === c.target) slotOk = true;
            if (!slotOk) issues.push(issue(key + "." + cname + ".target", "CONSTRAINT_TARGET_SLOT_MISSING", "path 约束目标槽不存在：" + String(c.target)));
          } else if (typeof c.target !== "string" || findBoneIndex(rawModel, c.target) < 0) {
            issues.push(issue(key + "." + cname + ".target", "CONSTRAINT_TARGET_MISSING", "约束目标骨不存在：" + String(c.target)));
          }
        }
        if (key === "ik" && (!Array.isArray(c.bones) || !c.bones.length)) issues.push(issue(key + "." + cname, "IK_BONES_REQUIRED", "IK 约束缺少 bones"));
      }
    }
    /* 动画孤儿检测：保存时官方会丢弃这些轨道（SkeletonJson 只认已存在的骨/slot/约束），属于"静默丢数据"前置告警 */
    if (isObject(rawModel.animations)) {
      const boneNames = new Set();
      for (const b of rawModel.bones) if (isObject(b) && typeof b.name === "string") boneNames.add(b.name);
      const slotNames = new Set();
      if (Array.isArray(rawModel.slots)) for (const s of rawModel.slots) if (isObject(s) && typeof s.name === "string") slotNames.add(s.name);
      const constraintNames = { ik: new Set(), transform: new Set(), path: new Set() };
      for (const key of ["ik", "transform", "path"]) for (const item of constraintListOf(rawModel, key)) constraintNames[key].add(item.name);
      for (const animName of Object.keys(rawModel.animations)) {
        const a = rawModel.animations[animName];
        if (!isObject(a)) continue;
        if (isObject(a.bones)) {
          for (const bn of Object.keys(a.bones)) {
            if (!boneNames.has(bn)) {
              issues.push(issue("animations." + animName + ".bones." + bn, "ANIM_BONE_ORPHAN", "动画 " + animName + " 的骨轨道 " + bn + " 不存在于 bones[]，保存会静默丢失"));
              issues[issues.length - 1].severity = "warning";
            }
          }
        }
        if (isObject(a.slots)) {
          for (const sn of Object.keys(a.slots)) {
            if (!slotNames.has(sn)) {
              issues.push(issue("animations." + animName + ".slots." + sn, "ANIM_SLOT_ORPHAN", "动画 " + animName + " 的槽轨道 " + sn + " 不存在于 slots[]，保存会静默丢失"));
              issues[issues.length - 1].severity = "warning";
            }
          }
        }
        for (const key of ["ik", "transform", "path"]) {
          if (!isObject(a[key])) continue;
          for (const cn of Object.keys(a[key])) {
            if (!constraintNames[key].has(cn)) {
              issues.push(issue("animations." + animName + "." + key + "." + cn, "ANIM_CONSTRAINT_ORPHAN", "动画 " + animName + " 的 " + key + " 轨道 " + cn + " 不存在于该约束集合，保存会静默丢失"));
              issues[issues.length - 1].severity = "warning";
            }
          }
        }
      }
    }
    const warningCount = issues.filter(function (i) {
      return i.severity === "warning";
    }).length;
    return { ok: !issues.some(function (i) { return i.severity !== "warning"; }), issues: issues, warningCount: warningCount };
  }

  const api = Object.freeze({
    TIME_EPS: TIME_EPS,
    localMatrix: localMatrix,
    worldOf: worldOf,
    applyMat: applyMat,
    invApply: invApply,
    mulMat: mulMat,
    setupWorldOf: setupWorldOf,

    solveTwoBone: solveTwoBone,
    solveChainFABRIK: solveChainFABRIK,

    createBone: createBone,
    reparentBone: reparentBone,
    renameBone: renameBone,
    deleteBone: deleteBone,
    referencesTo: referencesTo,
    hasWeightedVertices: hasWeightedVertices,
    validateSkeleton: validateSkeleton,
    findBoneIndex: findBoneIndex,
  });

  global.SpineIkAim = api;
  if (typeof window !== "undefined" && window.SpineIkAim !== api) window.SpineIkAim = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
