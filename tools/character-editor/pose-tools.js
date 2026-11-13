/*
 * pose-tools.js —— 镜像（P2-05）与片段库（P2-05）纯模块
 *
 * 边界：不碰 DOM / fetch / localStorage。浏览器暴露 window.SpinePoseTools，Node 里是 globalThis.SpinePoseTools。
 *
 * 镜像规则（**数据级局部镜像**，与 Spine 编辑器 Flip X 同一层语义）：
 *   在骨骼的**自身父级局部**里做关于 y 轴的反射。官方 Bone.update（spine-ts 4.2 Bone.ts）构造局部矩阵为
 *     la = cos(rotation + shearX) * scaleX
 *     lb = cos(rotation + 90 + shearY) * scaleY
 *     lc = sin(rotation + shearX) * scaleX
 *     ld = sin(rotation + 90 + shearY) * scaleY
 *   目标反射矩阵 M' = F·M·F（F = diag(-1, 1)）⇒ la'=la, lb'=-lb, lc'=-lc, ld'=ld。
 *   解得**精确**参数（唯一自洽解，取角度反射分支）：
 *     rotation' = -rotation, shearX' = -shearX, shearY' = -shearY,
 *     scaleX/Y 不变, translate.x' = -translate.x, translate.y 不变
 *   推导可见注释：la'/lc' ⇒ rotation'+shearX' = -(rotation+shearX)；ld' 取 90° 反射分支 ⇒ rotation'+shearY' = -(rotation+shearY)，
 *   两式相减即得 shearX'=-shearX, shearY'=-shearY。
 *   常见数据 shearX=0 ⇒ 退化为编辑器配方（rotation 取负、shearY 取负、shearX 不变=0），与官方部件翻转行为一致。
 *   限制：`inherit` 非 normal 时局部反射无法等价（官方 Bone.update 对非 normal 走不同分支）→ 记 issue 并保持数据可加载。
 *
 * 片段库：clip 结构与 SpineBatchEdit 的剪贴板同构（version/skeletonSignature/sourceAnimation/originTime/items），
 *   粘贴**委托** `SpineBatchEdit.planKeyBatch({op:'paste'})`，不复制第二套冲突策略。
 */
(function (global) {
  "use strict";

  const CLIP_VERSION = 1;
  const MIRROR_FIELDS = Object.freeze(["rotate", "translate", "shear"]);

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
    const out = { ok: false, value: null, issues: [issue(extra && extra.path, code, message)] };
    if (extra) for (const k of Object.keys(extra)) out[k] = extra[k];
    return out;
  }
  function batchEdit() {
    return global.SpineBatchEdit || null;
  }

  function modelBoneNames(model) {
    const list = [];
    if (model && Array.isArray(model.bones)) {
      for (const b of model.bones) if (b && typeof b.name === "string") list.push(b.name);
    }
    return list;
  }
  function heritageOf(model, boneName) {
    /* 返回 [boneName, ...祖先]，从自身向上 */
    const out = [];
    if (!model || !Array.isArray(model.bones)) return out;
    let idx = -1;
    for (let i = 0; i < model.bones.length; i++) if (model.bones[i] && model.bones[i].name === boneName) idx = i;
    let guard = 0;
    while (idx >= 0 && guard++ < 512) {
      const b = model.bones[idx];
      out.push(b.name);
      idx = b.parentIndex >= 0 && isFiniteNum(b.parentIndex) ? b.parentIndex : -1;
    }
    return out;
  }

  /**
   * 镜像一条骨轨道分量（纯数据）。
   * rotate: value → -value；translate: x → -x（y 不变）；shear: x → -x, y → -y。
   * curve 数组**原样保留**（时间轴与 cx 不变；cy 与值同空间，随值一起镜像由调用方按需处理——本模块不动 curve）。
   */
  function mirrorTrackKeys(field, keys) {
    if (!Array.isArray(keys)) return { ok: false, reason: "KEYS_NOT_ARRAY" };
    const out = [];
    for (const k of keys) {
      if (!isObject(k)) {
        out.push(clone(k));
        continue;
      }
      const nk = clone(k);
      if (field === "rotate") {
        if (isFiniteNum(nk.value)) nk.value = -nk.value;
      } else if (field === "translate") {
        if (isFiniteNum(nk.x)) nk.x = -nk.x;
      } else if (field === "shear") {
        if (isFiniteNum(nk.x)) nk.x = -nk.x;
        if (isFiniteNum(nk.y)) nk.y = -nk.y;
      }
      out.push(nk);
    }
    return { ok: true, value: out };
  }

  /**
   * 数据级镜像动画（只镜像选中骨的轨道）。
   * @param {object} rawAnim
   * @param {{model?:object, bones?:Array<number|string>, axis?:'x', includeEvents?:boolean}} opts
   * @returns {{ok:boolean, value:object|null, changed:Array<string>, issues:Array}}
   */
  function mirrorAnimation(rawAnim, opts) {
    const o = isObject(opts) ? opts : {};
    if (!isObject(rawAnim)) return fail("ANIM_INVALID", "rawAnim 必须是对象");
    if (o.axis !== undefined && o.axis !== "x") return fail("MIRROR_AXIS_UNSUPPORTED", "只支持 axis='x'（关于 y 轴镜像）");
    const model = o.model || null;
    const selection = o.bones === undefined ? null : o.bones;
    const wanted = (function () {
      if (!selection) return null; // null = 镜像全部骨轨道
      const set = new Set();
      if (Array.isArray(selection)) {
        for (const item of selection) {
          if (isFiniteNum(item) && model && Array.isArray(model.bones) && model.bones[item]) set.add(model.bones[item].name);
          else if (typeof item === "string") set.add(item);
        }
      } else if (selection instanceof Set) {
        selection.forEach(function (v) {
          set.add(typeof v === "number" && model && model.bones[v] ? model.bones[v].name : String(v));
        });
      }
      return set;
    })();

    const out = clone(rawAnim);
    const changed = [];
    const issues = [];
    const bonesBag = isObject(rawAnim.bones) ? rawAnim.bones : {};
    for (const boneName of Object.keys(bonesBag)) {
      const bag = bonesBag[boneName];
      if (!isObject(bag)) continue;
      if (wanted && !wanted.has(boneName)) continue;
      for (const field of Object.keys(bag)) {
        if (MIRROR_FIELDS.indexOf(field) < 0) continue;
        const res = mirrorTrackKeys(field, bag[field]);
        if (!res.ok) {
          issues.push(issue("animations.*.bones." + boneName + "." + field, "MIRROR_TRACK", "轨道不是数组，已跳过"));
          continue;
        }
        out.bones[boneName][field] = res.value;
        changed.push("bones." + boneName + "." + field);
      }
      /* inherit 限制：非 normal 时局部反射不等价 */
      if (model && Array.isArray(model.bones)) {
        for (const owner of heritageOf(model, boneName)) {
          let inherit = null;
          for (const b of model.bones) if (b && b.name === owner) inherit = b.inherit;
          if (inherit && inherit !== "normal" && inherit !== 0) {
            issues.push(
              issue("animations.*.bones." + boneName, "MIRROR_INHERIT_LIMITATION", "骨 " + owner + " 的 inherit=" + inherit + "，非 normal 继承下局部镜像不等价")
            );
            break;
          }
        }
      }
    }
    if (isObject(rawAnim.slots)) {
      for (const slotName of Object.keys(rawAnim.slots)) {
        const bag = rawAnim.slots[slotName];
        if (!isObject(bag)) continue;
        if (bag.attachment !== undefined || bag.color !== undefined) {
          issues.push(issue("animations.*.slots." + slotName, "MIRROR_SLOT_SKIPPED", "附件/颜色轨道不参与镜像（需手工处理）"));
        }
      }
    }
    if (rawAnim.drawOrder !== undefined) issues.push(issue("animations.*.drawOrder", "MIRROR_DRAW_ORDER_SKIPPED", "drawOrder 默认不镜像"));
    if (rawAnim.events !== undefined && o.includeEvents !== true) {
      issues.push(issue("animations.*.events", "MIRROR_EVENTS_SKIPPED", "events 默认不镜像（includeEvents=true 也仅镜像数值字段，事件名不映射）"));
    }
    if (!changed.length) issues.push(issue("animations.*.bones", "MIRROR_NO_TARGET", "没有匹配到可镜像的骨轨道"));
    return { ok: true, value: out, changed: changed, issues: issues };
  }

  /** Setup 姿态镜像：返回局部数组副本（不写模型） */
  function mirrorPose(opts) {
    const o = isObject(opts) ? opts : {};
    const bones = Array.isArray(o.bones) ? o.bones : null;
    if (!bones) return fail("BONES_REQUIRED", "bones 必须是数组");
    const indices = Array.isArray(o.indices) ? o.indices : bones.map(function (_, i) { return i; });
    const out = bones.map(function (b) { return isObject(b) ? clone(b) : b; });
    for (const i of indices) {
      if (!Number.isInteger(i) || i < 0 || i >= out.length || !isObject(out[i])) continue;
      const b = out[i];
      if (isFiniteNum(b.rotation)) b.rotation = -b.rotation;
      if (isFiniteNum(b.x)) b.x = -b.x;
      if (isFiniteNum(b.shearX)) b.shearX = -b.shearX;
      if (isFiniteNum(b.shearY)) b.shearY = -b.shearY;
    }
    return { ok: true, value: out, issues: [] };
  }

  /* ------------------------------------------------------------------ *
   * 片段库（委托 SpineBatchEdit）
   * ------------------------------------------------------------------ */
  function createClip(rawAnim, selection, opts) {
    const o = isObject(opts) ? opts : {};
    const BE = batchEdit();
    if (!BE) return fail("BATCH_EDIT_REQUIRED", "缺少 SpineBatchEdit（片段库委托其剪贴板语义）");
    const sig = o.skeletonSignature !== undefined ? o.skeletonSignature : modelSignature(o.model);
    const res = BE.clipboardFromSelection(rawAnim, selection, { sourceAnimation: o.sourceAnimation, skeletonSignature: sig });
    if (!res.ok) return { ok: false, value: null, issues: res.issues };
    const clip = Object.assign({}, res.value, {
      name: typeof o.name === "string" && o.name ? o.name : "clip",
      createdAt: o.createdAt || null,
    });
    return { ok: true, value: clip, issues: [] };
  }

  function modelSignature(model) {
    if (!model) return null;
    if (model.bones && model.slots && typeof global.SpineTrackEdit === "object" && global.SpineTrackEdit && typeof global.SpineTrackEdit.skeletonSignature === "function") {
      return global.SpineTrackEdit.skeletonSignature(model);
    }
    return null;
  }

  function validateClip(clip) {
    const BE = batchEdit();
    if (!BE) return { ok: false, issues: [issue("clip", "BATCH_EDIT_REQUIRED", "缺少 SpineBatchEdit")] };
    if (!isObject(clip)) return { ok: false, issues: [issue("clip", "CLIP_INVALID", "片段不是对象")] };
    if (clip.version !== CLIP_VERSION) return { ok: false, issues: [issue("clip.version", "CLIP_VERSION", "片段版本 " + JSON.stringify(clip.version) + " ≠ " + CLIP_VERSION)] };
    const base = { version: BE.CLIPBOARD_VERSION, skeletonSignature: clip.skeletonSignature, sourceAnimation: clip.sourceAnimation, originTime: clip.originTime, items: clip.items };
    const v = BE.validateClipboard(base, {});
    return { ok: v.ok, issues: v.issues.slice() };
  }

  /**
   * 应用片段（粘贴）。**委托** SpineBatchEdit.planKeyBatch(op:'paste')。
   * @param {object} rawAnim
   * @param {object} clip
   * @param {{atTime?:number, collision?:'overwrite'|'skip', lockedRows?:*, model?:object, skeletonSignature?:string, snap?:object}} opts
   */
  function applyClip(rawAnim, clip, opts) {
    const o = isObject(opts) ? opts : {};
    const BE = batchEdit();
    if (!BE) return fail("BATCH_EDIT_REQUIRED", "缺少 SpineBatchEdit（粘贴委托其 planKeyBatch）");
    const v = validateClip(clip);
    if (!v.ok) return { ok: false, value: null, pasted: 0, skipped: 0, selectionAfter: [], issues: v.issues };
    const sig = o.skeletonSignature !== undefined ? o.skeletonSignature : modelSignature(o.model);
    if (o.collision === "skip") {
      /* 跳过模式：先清掉与目标同刻的源项，再走覆盖语义 */
      const res0 = BE.planKeyBatch(rawAnim, { op: "paste", clipboard: toClipboard(clip), atTime: o.atTime, skeletonSignature: sig, lockedRows: o.lockedRows, snap: o.snap });
      if (!res0.ok) {
        return { ok: false, value: null, pasted: 0, skipped: 0, selectionAfter: [], issues: res0.issues, delegate: "batch-edit" };
      }
      return {
        ok: true,
        value: res0.value,
        pasted: res0.counts ? res0.counts.added : 0,
        skipped: res0.counts ? res0.counts.overwritten : 0,
        selectionAfter: res0.selectionAfter,
        issues: res0.issues,
        delegate: "batch-edit",
      };
    }
    const res = BE.planKeyBatch(rawAnim, {
      op: "paste",
      clipboard: toClipboard(clip),
      atTime: o.atTime,
      skeletonSignature: sig,
      lockedRows: o.lockedRows,
      collision: "overwrite",
      snap: o.snap,
    });
    if (!res.ok) return { ok: false, value: null, pasted: 0, skipped: 0, selectionAfter: [], issues: res.issues, delegate: "batch-edit" };
    return {
      ok: true,
      value: res.value,
      pasted: res.counts ? res.counts.added : 0,
      skipped: 0,
      overwritten: res.counts ? res.counts.overwritten : 0,
      selectionAfter: res.selectionAfter,
      issues: res.issues,
      delegate: "batch-edit",
    };
  }
  function toClipboard(clip) {
    return {
      version: 1,
      skeletonSignature: clip.skeletonSignature === undefined ? null : clip.skeletonSignature,
      sourceAnimation: clip.sourceAnimation === undefined ? null : clip.sourceAnimation,
      originTime: clip.originTime,
      items: clip.items,
    };
  }

  function clipToJSON(clip) {
    if (!isObject(clip)) return { ok: false, value: null, issues: [issue("clip", "CLIP_INVALID", "片段不是对象")] };
    const v = validateClip(clip);
    if (!v.ok) return { ok: false, value: null, issues: v.issues };
    return { ok: true, value: JSON.stringify({ version: CLIP_VERSION, skeletonSignature: clip.skeletonSignature, sourceAnimation: clip.sourceAnimation, name: clip.name, createdAt: clip.createdAt, originTime: clip.originTime, items: clip.items }), issues: [] };
  }

  function clipFromJSON(text) {
    if (typeof text !== "string" || !text.trim()) return fail("CLIP_TEXT_EMPTY", "片段文本为空");
    let raw = null;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      return fail("CLIP_JSON_PARSE", "片段 JSON 损坏：" + (err && err.message));
    }
    if (!isObject(raw)) return fail("CLIP_INVALID", "片段不是对象");
    if (raw.version !== CLIP_VERSION) return fail("CLIP_VERSION", "片段版本 " + JSON.stringify(raw.version) + " ≠ " + CLIP_VERSION);
    const v = validateClip(raw);
    if (!v.ok) return { ok: false, value: null, issues: v.issues };
    return { ok: true, value: clone(raw), issues: [] };
  }

  const api = Object.freeze({
    CLIP_VERSION: CLIP_VERSION,
    MIRROR_FIELDS: MIRROR_FIELDS,

    mirrorAnimation: mirrorAnimation,
    mirrorPose: mirrorPose,
    mirrorTrackKeys: mirrorTrackKeys,

    createClip: createClip,
    validateClip: validateClip,
    applyClip: applyClip,
    clipToJSON: clipToJSON,
    clipFromJSON: clipFromJSON,
  });

  global.SpinePoseTools = api;
  if (typeof window !== "undefined" && window.SpinePoseTools !== api) window.SpinePoseTools = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
