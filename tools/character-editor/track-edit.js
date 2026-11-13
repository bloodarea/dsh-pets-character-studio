/*
 * track-edit.js —— events / drawOrder / deform / ik / transform / path 轨道纯模块（T24-A，T24-FIX 约束容器结构）
 *
 * 边界：不碰 DOM / fetch / localStorage。浏览器暴露 window.SpineTrackEdit，Node 里是 globalThis.SpineTrackEdit。
 *
 * ⚠ 容器结构（以官方 4.2.120 SkeletonJson 为准，T24-FIX 修正）：
 *   - events：`animations.<a>.events` = key 数组，key = {time, name, int, float, string, volume, balance}（readEventTimeline）
 *   - drawOrder：`animations.<a>.drawOrder` = key 数组，key = {time, offsets:[{slot, offset}]}
 *   - deform：`animations.<a>.attachments.<skin>.<slot>.<att>.deform` = key 数组，key = {time, offset, vertices, curve?}
 *     或旧式 `animations.<a>.deform.<slot>`；deformLength = 加权 ? vertices.length/3*2 : vertices.length（SkeletonJson.ts:968-1005）
 *   - **ik：`animations.<a>.ik.<约束名>` = 一个"合并 key"数组**（SkeletonJson.ts:748-787）：
 *     key = {time, mix, softness, bendPositive, compress, stretch, curve?}（同 key 内字段合并；curve 按 mix/softness 两段读）
 *   - **transform：`animations.<a>.transform.<约束名>` = 合并 key 数组**（:790-846）：
 *     key = {time, mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY, curve?}（curve 6 段）
 *   - **path：`animations.<a>.path.<约束名>` = 对象**（:848-900）：
 *     `position` / `spacing` = 单值 key 数组（key = {time, value, curve?}，官方 readTimeline1 读 `value`）；
 *     `mix` = 合并 key 数组（key = {time, mixRotate, mixX, mixY, curve?}，默认值 mixRotate=1、mixX=1、mixY=mixX）。
 *   空数组可安全保留：官方 `let keyMap = constraintMap[0]; if (!keyMap) continue;`（:752-753 / :794-795 / :857-858）。
 */
(function (global) {
  "use strict";

  const TIME_EPS = 1e-6;

  const IK_KEY_FIELDS = Object.freeze(["mix", "softness", "bendPositive", "compress", "stretch"]);
  const TRANSFORM_KEY_FIELDS = Object.freeze(["mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY"]);
  const PATH_MIX_KEY_FIELDS = Object.freeze(["mixRotate", "mixX", "mixY"]);

  const SCHEMA = Object.freeze({
    event: Object.freeze({
      kind: "event",
      container: "array",
      label: "事件",
      fields: Object.freeze([
        { name: "name", type: "string" },
        { name: "int", type: "number", default: 0, int: true },
        { name: "float", type: "number", default: 0 },
        { name: "string", type: "string", default: null },
        { name: "volume", type: "number", default: 1 },
        { name: "balance", type: "number", default: 0 },
      ]),
    }),
    drawOrder: Object.freeze({
      kind: "drawOrder",
      container: "array",
      label: "绘制顺序",
      fields: Object.freeze([{ name: "offsets", type: "offsets" }]),
    }),
    deform: Object.freeze({
      kind: "deform",
      container: "attachment",
      label: "形变",
      fields: Object.freeze([
        { name: "offset", type: "number", default: 0, int: true },
        { name: "vertices", type: "array" },
        { name: "curve", type: "curve" },
      ]),
    }),
    ik: Object.freeze({
      kind: "ik",
      container: "combinedKeys",
      label: "IK 约束",
      keyFields: IK_KEY_FIELDS,
      fields: Object.freeze([
        { name: "mix", type: "number", default: 1, min: 0, max: 1 },
        { name: "softness", type: "number", default: 0, min: 0 },
        { name: "bendPositive", type: "bool", default: true },
        { name: "compress", type: "bool", default: false },
        { name: "stretch", type: "bool", default: false },
      ]),
    }),
    transform: Object.freeze({
      kind: "transform",
      container: "combinedKeys",
      label: "transform 约束",
      keyFields: TRANSFORM_KEY_FIELDS,
      fields: Object.freeze([
        { name: "mixRotate", type: "number", default: 1, min: 0, max: 1 },
        { name: "mixX", type: "number", default: 1, min: 0, max: 1 },
        { name: "mixY", type: "number", default: 1, min: 0, max: 1 },
        { name: "mixScaleX", type: "number", default: 1, min: 0, max: 1 },
        { name: "mixScaleY", type: "number", default: 1, min: 0, max: 1 },
        { name: "mixShearY", type: "number", default: 1, min: 0, max: 1 },
      ]),
    }),
    path: Object.freeze({
      kind: "path",
      container: "pathObject",
      label: "path 约束",
      subTracks: Object.freeze({
        position: Object.freeze({ mode: "single", valueField: "value", default: 0 }),
        spacing: Object.freeze({ mode: "single", valueField: "value", default: 0 }),
        mix: Object.freeze({ mode: "combinedKeys", keyFields: PATH_MIX_KEY_FIELDS }),
      }),
      fields: Object.freeze([
        { name: "position", type: "number", default: 0, sub: "position" },
        { name: "spacing", type: "number", default: 0, sub: "spacing" },
        { name: "mixRotate", type: "number", default: 1, min: 0, max: 1, sub: "mix" },
        { name: "mixX", type: "number", default: 1, min: 0, max: 1, sub: "mix" },
        { name: "mixY", type: "number", default: 1, min: 0, max: 1, sub: "mix" },
      ]),
    }),
  });

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function isFiniteNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }
  function issue(path, code, message, extra) {
    const out = { path: String(path == null ? "" : path), code: code, message: String(message === undefined ? code : message) };
    if (extra) for (const k of Object.keys(extra)) out[k] = extra[k];
    return out;
  }
  function fail(code, message, extra) {
    return { ok: false, value: null, changedPath: null, keyCount: null, issues: [issue(extra && extra.path, code, message, extra)] };
  }
  function schemaOf(kind) {
    return Object.prototype.hasOwnProperty.call(SCHEMA, kind) ? SCHEMA[kind] : null;
  }
  function fieldSchema(kind, field) {
    const s = schemaOf(kind);
    if (!s) return null;
    for (let i = 0; i < s.fields.length; i++) if (s.fields[i].name === field) return s.fields[i];
    return null;
  }
  function keyTime(key) {
    return isObject(key) && isFiniteNum(key.time) ? key.time : null;
  }
  function sortKeys(keys) {
    return keys
      .map(function (k, i) {
        return { k: k, i: i };
      })
      .sort(function (a, b) {
        const ta = keyTime(a.k);
        const tb = keyTime(b.k);
        return (ta === null ? Infinity : ta) - (tb === null ? Infinity : tb) || a.i - b.i;
      })
      .map(function (x) {
        return x.k;
      });
  }

  /* ------------------------------------------------------------------ *
   * 容器寻址（按官方结构：array / combinedKeys / pathObject / attachment）
   * ------------------------------------------------------------------ */

  /**
   * 选 anim 侧 skin 容器名：opts.skin > 唯一 skin > 'default'；多 skin 且无 'default' 且未指定 → 要求显式指定。
   */
  function pickAnimSkin(rawAnim, optsSkin) {
    const explicit = typeof optsSkin === "string" && optsSkin ? optsSkin : isObject(optsSkin) && typeof optsSkin.skin === "string" && optsSkin.skin ? optsSkin.skin : null;
    const bag = rawAnim ? rawAnim.attachments : undefined;
    if (Array.isArray(bag)) return { ok: false, code: "DEFORM_CREATE_ARRAY_SKINS_UNSUPPORTED", skins: [] };
    const names = isObject(bag) ? Object.keys(bag) : [];
    if (explicit) return { ok: true, skin: explicit, source: "explicit", skins: names };
    if (names.length === 1) return { ok: true, skin: names[0], source: "unique", skins: names };
    if (names.indexOf("default") >= 0) return { ok: true, skin: "default", source: "default", skins: names };
    if (names.length === 0) return { ok: true, skin: "default", source: "implicit", skins: names };
    return { ok: false, code: "DEFORM_SKIN_REQUIRED", skins: names };
  }

  /**
   * @param {object} rawAnim
   * @param {'event'|'drawOrder'|'deform'|'ik'|'transform'|'path'} kind
   * @param {string} owner 约束名 / 槽名；event、drawOrder 忽略
   * @param {string} field 目标字段（ik/transform：合并 key 内的字段；path：position/spacing/mixRotate/mixX/mixY/mix）
   * @param {{create?:boolean}} [opts] create=true 时允许创建缺失的子容器（用于 add）
   * @returns {{ok:true, keys:Array, mode:'array'|'combinedKeys'|'single'|'pathObject'|'attachment',
   *            keyFields?:Array, writeField?:string|null, valueField?:string, path:string, legacy?:boolean,
   *            assign:function(Array):void, created?:boolean}|{ok:false, code:string}}
   */
  function resolveContainer(rawAnim, kind, owner, field, opts) {
    const o = isObject(opts) ? opts : {};
    if (!isObject(rawAnim)) return { ok: false, code: "ANIM_INVALID" };
    if (kind === "event" || kind === "drawOrder") {
      const name = kind === "event" ? "events" : "drawOrder";
      if (!Array.isArray(rawAnim[name])) {
        if (o.create === true) {
          rawAnim[name] = [];
          return {
            ok: true, keys: rawAnim[name], mode: "array", writeField: null, path: "animations.*." + name, created: true,
            assign: function (keys) {
              rawAnim[name] = keys;
            },
          };
        }
        return { ok: false, code: "TRACK_NOT_FOUND" };
      }
      return {
        ok: true, keys: rawAnim[name], mode: "array", writeField: null, path: "animations.*." + name,
        assign: function (keys) {
          rawAnim[name] = keys;
        },
      };
    }
    if (kind === "ik" || kind === "transform") {
      const bagName = kind;
      const keyFields = kind === "ik" ? IK_KEY_FIELDS : TRANSFORM_KEY_FIELDS;
      const writeField = field === undefined || field === null || field === "" ? null : String(field);
      if (writeField !== null && keyFields.indexOf(writeField) < 0) return { ok: false, code: "TRACK_FIELD_UNKNOWN" };
      let bag = rawAnim[bagName];
      if (!isObject(bag)) {
        if (o.create !== true) return { ok: false, code: "TRACK_NOT_FOUND" };
        bag = {};
        rawAnim[bagName] = bag;
      }
      const existing = bag[owner];
      if (!Array.isArray(existing)) {
        if (existing !== undefined && o.create !== true) return { ok: false, code: "TRACK_CONTAINER_INVALID" };
        if (o.create !== true) return { ok: false, code: "TRACK_NOT_FOUND" };
        bag[owner] = [];
      }
      const path = "animations.*." + bagName + "." + owner;
      return {
        ok: true, keys: bag[owner], mode: "combinedKeys", keyFields: keyFields, writeField: writeField, path: path,
        created: !Array.isArray(existing),
        assign: function (keys) {
          bag[owner] = keys;
        },
      };
    }
    if (kind === "path") {
      const target = String(field === undefined || field === null ? "" : field);
      const sub = target === "position" || target === "spacing" ? target : target === "mix" || PATH_MIX_KEY_FIELDS.indexOf(target) >= 0 ? "mix" : null;
      if (!sub) return { ok: false, code: "TRACK_FIELD_UNKNOWN" };
      let bag = rawAnim.path;
      if (!isObject(bag)) {
        if (o.create !== true) return { ok: false, code: "TRACK_NOT_FOUND" };
        bag = {};
        rawAnim.path = bag;
      }
      let ownerBag = bag[owner];
      if (!isObject(ownerBag)) {
        if (ownerBag !== undefined && o.create !== true) return { ok: false, code: "TRACK_CONTAINER_INVALID" };
        if (o.create !== true) return { ok: false, code: "TRACK_NOT_FOUND" };
        ownerBag = {};
        bag[owner] = ownerBag;
      }
      const existing = ownerBag[sub];
      if (!Array.isArray(existing)) {
        if (existing !== undefined && o.create !== true) return { ok: false, code: "TRACK_CONTAINER_INVALID" };
        if (o.create !== true) return { ok: false, code: "TRACK_NOT_FOUND" };
        ownerBag[sub] = [];
      }
      const single = sub === "position" || sub === "spacing";
      const path = "animations.*.path." + owner + "." + sub;
      const res = {
        ok: true,
        keys: ownerBag[sub],
        mode: single ? "single" : "combinedKeys",
        keyFields: single ? null : PATH_MIX_KEY_FIELDS,
        writeField: sub === "mix" ? (target === "mix" ? null : target) : null,
        valueField: single ? "value" : null,
        path: path,
        created: !Array.isArray(existing),
        assign: function (keys) {
          ownerBag[sub] = keys;
        },
      };
      return res;
    }
    if (kind === "deform") {
      const attachments = rawAnim.attachments;
      if (Array.isArray(attachments)) {
        /* 旧式数组形态（4.0/4.1 的 attachments 以槽索引为键）：本模块不猜索引语义，显式拒绝 */
        return { ok: false, code: o.create === true ? "DEFORM_CREATE_ARRAY_SKINS_UNSUPPORTED" : "DEFORM_LEGACY_SKIN_ARRAY" };
      }
      if (isObject(attachments) && field) {
        const preferred = typeof o.skin === "string" && o.skin ? o.skin : null;
        const skinNames = preferred ? [preferred] : Object.keys(attachments);
        for (const skinName of skinNames) {
          const slotMap = attachments[skinName] && attachments[skinName][owner];
          if (isObject(slotMap) && isObject(slotMap[field]) && Array.isArray(slotMap[field].deform)) {
            const node = slotMap[field];
            return {
              ok: true, keys: node.deform, mode: "attachment", writeField: null,
              path: "animations.*.attachments." + skinName + "." + owner + "." + field + ".deform",
              skin: skinName,
              assign: function (keys) {
                node.deform = keys;
              },
            };
          }
        }
      }
      if (isObject(rawAnim.deform) && Array.isArray(rawAnim.deform[owner]) && !field) {
        const node = rawAnim.deform;
        return {
          ok: true, keys: node[owner], mode: "attachment", writeField: null, legacy: true,
          path: "animations.*.deform." + owner,
          assign: function (keys) {
            node[owner] = keys;
          },
        };
      }
      /* —— 从零创建：attachments.<skin>.<slot>.<att>.deform —— */
      if (o.create === true) {
        if (!field || typeof field !== "string") return { ok: false, code: "DEFORM_FIELD_REQUIRED" };
        const skinPick = pickAnimSkin(rawAnim, o.skin);
        if (!skinPick.ok) return { ok: false, code: skinPick.code, skins: skinPick.skins };
        if (!isObject(rawAnim.attachments)) rawAnim.attachments = {};
        const bag = rawAnim.attachments;
        if (!isObject(bag[skinPick.skin])) bag[skinPick.skin] = {};
        const skinBag = bag[skinPick.skin];
        if (!isObject(skinBag[owner])) skinBag[owner] = {};
        const slotBag = skinBag[owner];
        if (!isObject(slotBag[field])) slotBag[field] = {};
        const node = slotBag[field];
        if (!Array.isArray(node.deform)) node.deform = [];
        return {
          ok: true, keys: node.deform, mode: "attachment", writeField: null, created: true, skin: skinPick.skin,
          path: "animations.*.attachments." + skinPick.skin + "." + owner + "." + field + ".deform",
          assign: function (keys) {
            node.deform = keys;
          },
        };
      }
      return { ok: false, code: "TRACK_NOT_FOUND" };
    }
    return { ok: false, code: "TRACK_NOT_FOUND" };
  }

  /* ------------------------------------------------------------------ *
   * deform 长度
   * ------------------------------------------------------------------ */
  /** 从 raw 附件定义推偏移长度；推不出返回 0（调用方据此判定 unknown） */
  function deformOffsetLengthFromRaw(attJson) {
    if (!isObject(attJson)) return 0;
    const uvs = Array.isArray(attJson.uvs) ? attJson.uvs : null;
    const v = Array.isArray(attJson.vertices) ? attJson.vertices : null;
    if (uvs && v) {
      const vertexCount = uvs.length / 2;
      if (v.length === vertexCount * 2) return vertexCount * 2;
      let p = 0;
      let total = 0;
      for (let i = 0; i < vertexCount; i++) {
        const n = v[p++];
        if (!Number.isInteger(n) || n <= 0) return 0;
        total += n;
        p += n * 4;
      }
      return total * 2;
    }
    return 0;
  }
  function deformOffsetLengthFromModel(att) {
    if (!isObject(att) || !isFiniteNum(att.vertexCount)) return 0;
    if (!att.weighted) return att.vertexCount * 2;
    let total = 0;
    if (Array.isArray(att.influences)) for (let i = 0; i < att.influences.length; i++) total += (att.influences[i] && att.influences[i].length) || 0;
    return total * 2;
  }
  function findModelAttachment(model, slotName, attName) {
    if (!model || !model.attachments || typeof model.attachments.forEach !== "function") return null;
    let found = null;
    model.attachments.forEach(function (att) {
      if (found || !isObject(att)) return;
      if (att.slotIndex === undefined) return;
      const slotOk = model.slots && model.slots[att.slotIndex] && model.slots[att.slotIndex].name === slotName;
      if (!slotOk) return;
      if (String(att.id || "").endsWith("/" + slotName + "/" + attName)) found = att;
    });
    return found;
  }
  /**
   * 可形变附件候选。
   * kind：'region' | 'mesh' | 'weightedmesh'；official：region 形变**不是官方 4.2 特性**
   * （官方 RegionAttachment 非 VertexAttachment，SkeletonJson.ts:961/971 对 region deform 直接抛异常），
   * 因此 region 项照常返回（供高级用户/我方扩展）但 official:false，UI 应默认过滤。
   */
  function deformTargets(model, rawAnim) {
    const out = [];
    if (!model || !model.attachments || typeof model.attachments.forEach !== "function") return out;
    const rawAtt = {};
    if (isObject(rawAnim) && isObject(rawAnim.attachments)) {
      for (const skinName of Object.keys(rawAnim.attachments)) {
        const slots = rawAnim.attachments[skinName];
        if (!isObject(slots)) continue;
        for (const slotName of Object.keys(slots)) {
          if (!isObject(slots[slotName])) continue;
          for (const attName of Object.keys(slots[slotName])) rawAtt[slotName + "/" + attName] = slots[slotName][attName];
        }
      }
    }
    model.attachments.forEach(function (att) {
      if (!isObject(att) || !isFiniteNum(att.vertexCount) || !att.vertexCount) return;
      const parts = String(att.id || "").split("/");
      const attName = parts[parts.length - 1];
      const slotName = parts[parts.length - 2];
      const isRegion = att.type === "region";
      const kind = isRegion ? "region" : att.weighted ? "weightedmesh" : "mesh";
      const offsetLength = deformOffsetLengthFromModel(att) || deformOffsetLengthFromRaw(rawAtt[slotName + "/" + attName]);
      out.push({
        slotName: slotName,
        attachmentName: attName,
        slotIndex: att.slotIndex,
        kind: kind,
        official: kind !== "region",
        vertexCount: att.vertexCount,
        weighted: !!att.weighted,
        offsetLength: offsetLength,
        hasDeform: !!(rawAtt[slotName + "/" + attName] && Array.isArray(rawAtt[slotName + "/" + attName].deform)),
      });
    });
    return out;
  }
  function deformOffsetLengthForTrack(model, rawAnim, owner, field, resolved) {
    if (resolved && resolved.legacy) {
      const slotName = owner;
      const setupAtt = model && model.slots && model.slotIndex && model.slotIndex.has && model.slotIndex.has(slotName) ? model.slots[model.slotIndex.get(slotName)].setupAttachment : null;
      const att = setupAtt ? findModelAttachment(model, slotName, setupAtt) : null;
      return att ? deformOffsetLengthFromModel(att) : 0;
    }
    const att = findModelAttachment(model, owner, field);
    if (att) return deformOffsetLengthFromModel(att);
    if (isObject(rawAnim) && isObject(rawAnim.attachments)) {
      for (const skinName of Object.keys(rawAnim.attachments)) {
        const slotMap = rawAnim.attachments[skinName] && rawAnim.attachments[skinName][owner];
        if (isObject(slotMap) && isObject(slotMap[field])) return deformOffsetLengthFromRaw(slotMap[field]);
      }
    }
    return 0;
  }

  /**
   * 偏移长度（带来源与 known 标记）：weighted=2×influence、rigid=2×顶点。
   * 模型解析态优先，其次 raw 附件定义；都推不出 → {length:0, known:false}（调用方必须拒绝，不能用 0 占位写入）。
   */
  function deformLengthForTrack(model, rawAnim, owner, field, resolved) {
    if (resolved && resolved.legacy) {
      const slotName = owner;
      const setupAtt = model && model.slots && model.slotIndex && model.slotIndex.has && model.slotIndex.has(slotName) ? model.slots[model.slotIndex.get(slotName)].setupAttachment : null;
      const att = setupAtt ? findModelAttachment(model, slotName, setupAtt) : null;
      const length = att ? deformOffsetLengthFromModel(att) : 0;
      return { length: length, known: length > 0, source: length > 0 ? (att.weighted ? "model.weighted" : "model.vertexCount") : "unknown" };
    }
    const att = findModelAttachment(model, owner, field);
    if (att && isFiniteNum(att.vertexCount) && att.vertexCount > 0) {
      const length = deformOffsetLengthFromModel(att);
      if (length > 0) return { length: length, known: true, source: att.weighted ? "model.weighted" : "model.vertexCount" };
    }
    if (isObject(rawAnim) && isObject(rawAnim.attachments)) {
      const skins = resolved && resolved.skin ? [resolved.skin] : Object.keys(rawAnim.attachments);
      for (const skinName of skins) {
        const slotMap = rawAnim.attachments[skinName] && rawAnim.attachments[skinName][owner];
        if (!isObject(slotMap) || !isObject(slotMap[field])) continue;
        const length = deformOffsetLengthFromRaw(slotMap[field]);
        if (length > 0) return { length: length, known: true, source: "raw.attachment" };
        /* 附件容器存在但没有 uvs/vertices（例如只放了空的 deform 容器）→ 仍算 unknown */
      }
    }
    return { length: 0, known: false, source: "unknown" };
  }

  /* ------------------------------------------------------------------ *
   * 扫描
   * ------------------------------------------------------------------ */
  function deepTimeKeys(value, out) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isObject(item) && isFiniteNum(item.time)) out.push(item);
        else if (isObject(item) || Array.isArray(item)) deepTimeKeys(item, out);
      }
      return;
    }
    if (isObject(value)) for (const k of Object.keys(value)) if (isObject(value[k]) || Array.isArray(value[k])) deepTimeKeys(value[k], out);
  }
  function labelOfConstraint(model, kind, owner) {
    const list = model && model.constraints;
    if (Array.isArray(list)) for (const c of list) if (c && c.name === owner) return (c.type ? c.type + " " : "") + owner;
    return owner;
  }

  /**
   * @returns {{rows:Array, unsupported:number, issues:Array}}
   *   ik / transform：**每个约束一行**（keys = 合并 key 数组，单行内含全部字段）
   *   path：position / spacing / mix 三行（mix 行为合并 key）
   */
  function scanExtra(rawAnim, model) {
    const rows = [];
    const issues = [];
    if (!isObject(rawAnim)) return { rows: [], unsupported: 0, issues: [issue("animations.*", "ANIM_INVALID", "动画必须是对象")] };

    if (rawAnim.events !== undefined) {
      if (Array.isArray(rawAnim.events)) rows.push({ kind: "event", owner: "events", field: "events", label: "事件", keys: rawAnim.events, keyCount: rawAnim.events.length, editable: true, unsupported: false });
      else {
        issues.push(issue("animations.*.events", "EVENTS_NOT_ARRAY", "events 必须是数组"));
        rows.push({ kind: "event", owner: "events", field: "events", label: "事件（结构非法）", keys: [], keyCount: 0, editable: false, unsupported: true });
      }
    }
    if (rawAnim.drawOrder !== undefined) {
      if (Array.isArray(rawAnim.drawOrder)) rows.push({ kind: "drawOrder", owner: "drawOrder", field: "drawOrder", label: "绘制顺序", keys: rawAnim.drawOrder, keyCount: rawAnim.drawOrder.length, editable: true, unsupported: false });
      else {
        issues.push(issue("animations.*.drawOrder", "DRAW_ORDER_NOT_ARRAY", "drawOrder 必须是数组"));
        rows.push({ kind: "drawOrder", owner: "drawOrder", field: "drawOrder", label: "绘制顺序（结构非法）", keys: [], keyCount: 0, editable: false, unsupported: true });
      }
    }
    /* ik / transform：每约束一行（合并 key） */
    for (const kind of ["ik", "transform"]) {
      const bag = rawAnim[kind];
      if (bag === undefined) continue;
      if (!isObject(bag)) {
        issues.push(issue("animations.*." + kind, "TRACK_CONTAINER_INVALID", kind + " 必须是对象"));
        rows.push({ kind: kind, owner: kind, field: null, label: kind + "（结构非法）", keys: [], keyCount: 0, editable: false, unsupported: true });
        continue;
      }
      for (const owner of Object.keys(bag)) {
        const keys = bag[owner];
        const path = "animations.*." + kind + "." + owner;
        if (!Array.isArray(keys)) {
          issues.push(issue(path, "TRACK_CONTAINER_INVALID", kind + " 轨道必须是合并 key 数组"));
          const found = [];
          deepTimeKeys(keys, found);
          rows.push({ kind: kind, owner: owner, field: null, label: owner + "（结构非法）", keys: found, keyCount: found.length, editable: false, unsupported: true });
          continue;
        }
        const keyFields = kind === "ik" ? IK_KEY_FIELDS : TRANSFORM_KEY_FIELDS;
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          if (!isObject(k)) continue;
          for (const f of Object.keys(k)) {
            if (f === "time" || f === "curve") continue;
            if (keyFields.indexOf(f) < 0) issues.push(issue(path + "[" + i + "].", "TRACK_UNKNOWN_FIELD", "未知 " + kind + " 字段 " + f + "（只读保留）"));
          }
        }
        rows.push({ kind: kind, owner: owner, field: null, label: (kind === "ik" ? "IK 约束 " : "transform 约束 ") + owner, keys: keys, keyCount: keys.length, editable: true, unsupported: false, keyFields: keyFields });
      }
    }
    /* path：position / spacing / mix 三行 */
    if (rawAnim.path !== undefined) {
      if (!isObject(rawAnim.path)) {
        issues.push(issue("animations.*.path", "TRACK_CONTAINER_INVALID", "path 必须是对象"));
        rows.push({ kind: "path", owner: "path", field: null, label: "path（结构非法）", keys: [], keyCount: 0, editable: false, unsupported: true });
      } else {
        for (const owner of Object.keys(rawAnim.path)) {
          const bag = rawAnim.path[owner];
          const base = "animations.*.path." + owner;
          if (!isObject(bag)) {
            issues.push(issue(base, "TRACK_CONTAINER_INVALID", "path 约束轨道必须是对象"));
            const found = [];
            deepTimeKeys(bag, found);
            rows.push({ kind: "path", owner: owner, field: null, label: owner + "（结构非法）", keys: found, keyCount: found.length, editable: false, unsupported: true });
            continue;
          }
          const label = labelOfConstraint(model, "path", owner);
          for (const sub of ["position", "spacing"]) {
            if (bag[sub] === undefined) continue;
            if (!Array.isArray(bag[sub])) {
              issues.push(issue(base + "." + sub, "TRACK_CONTAINER_INVALID", sub + " 必须是单值 key 数组"));
              continue;
            }
            for (let i = 0; i < bag[sub].length; i++) {
              const k = bag[sub][i];
              if (!isObject(k)) continue;
              for (const f of Object.keys(k)) {
                if (f === "time" || f === "curve" || f === "value") continue;
                issues.push(issue(base + "." + sub + "[" + i + "]", "TRACK_UNKNOWN_FIELD", "未知 " + sub + " 字段 " + f + "（只读保留）"));
              }
            }
            rows.push({ kind: "path", owner: owner, field: sub, label: label + " · " + sub, keys: bag[sub], keyCount: bag[sub].length, editable: true, unsupported: false, valueField: "value", sub: sub });
          }
          if (bag.mix !== undefined) {
            if (!Array.isArray(bag.mix)) {
              issues.push(issue(base + ".mix", "TRACK_CONTAINER_INVALID", "mix 必须是合并 key 数组"));
            } else {
              for (let i = 0; i < bag.mix.length; i++) {
                const k = bag.mix[i];
                if (!isObject(k)) continue;
                for (const f of Object.keys(k)) {
                  if (f === "time" || f === "curve") continue;
                  if (PATH_MIX_KEY_FIELDS.indexOf(f) < 0) issues.push(issue(base + ".mix[" + i + "]", "TRACK_UNKNOWN_FIELD", "未知 mix 字段 " + f + "（只读保留）"));
                }
              }
              rows.push({ kind: "path", owner: owner, field: "mix", label: label + " · mix", keys: bag.mix, keyCount: bag.mix.length, editable: true, unsupported: false, keyFields: PATH_MIX_KEY_FIELDS, sub: "mix" });
            }
          }
        }
      }
    }
    /* deform */
    if (rawAnim.attachments !== undefined) {
      if (!isObject(rawAnim.attachments)) issues.push(issue("animations.*.attachments", "ATTACHMENTS_INVALID", "attachments 必须是对象"));
      else {
        for (const skinName of Object.keys(rawAnim.attachments)) {
          const slots = rawAnim.attachments[skinName];
          if (!isObject(slots)) continue;
          for (const slotName of Object.keys(slots)) {
            if (!isObject(slots[slotName])) continue;
            for (const attName of Object.keys(slots[slotName])) {
              const bag = slots[slotName][attName];
              const path = "animations.*.attachments." + skinName + "." + slotName + "." + attName;
              if (!isObject(bag)) {
                issues.push(issue(path, "DEFORM_CONTAINER_INVALID", "附件形变容器必须是对象"));
                continue;
              }
              const unknown = Object.keys(bag).filter(function (f) {
                return f !== "deform";
              });
              if (unknown.length) issues.push(issue(path, "DEFORM_UNKNOWN_FIELD", "未知形变字段 " + unknown.join(",") + "（只读保留）"));
              if (bag.deform === undefined) continue;
              if (!Array.isArray(bag.deform)) {
                issues.push(issue(path + ".deform", "DEFORM_NOT_ARRAY", "deform 必须是数组"));
                rows.push({ kind: "deform", owner: slotName, field: attName, label: slotName + "/" + attName + "（结构非法）", keys: [], keyCount: 0, editable: false, unsupported: true });
                continue;
              }
              const att = findModelAttachment(model, slotName, attName);
              const offsetLength = deformOffsetLengthFromModel(att) || deformOffsetLengthFromRaw(bag);
              const attKind = !att ? null : att.type === "region" ? "region" : att.weighted ? "weightedmesh" : "mesh";
              rows.push({
                kind: "deform", owner: slotName, field: attName, label: "形变 " + slotName + "/" + attName,
                keys: bag.deform, keyCount: bag.deform.length, editable: true, unsupported: !att,
                slotName: slotName, attachmentName: attName,
                attKind: attKind, official: !!att && attKind !== "region",
                vertexCount: att && isFiniteNum(att.vertexCount) ? att.vertexCount : 0,
                offsetLength: offsetLength, weighted: !!(att && att.weighted),
              });
            }
          }
        }
      }
    }
    if (rawAnim.deform !== undefined) {
      if (!isObject(rawAnim.deform)) issues.push(issue("animations.*.deform", "DEFORM_LEGACY_INVALID", "旧式 deform 必须是对象"));
      else {
        for (const slotName of Object.keys(rawAnim.deform)) {
          const keys = rawAnim.deform[slotName];
          const path = "animations.*.deform." + slotName;
          if (!Array.isArray(keys)) {
            issues.push(issue(path, "DEFORM_LEGACY_NOT_ARRAY", "旧式 deform 轨道必须是数组"));
            continue;
          }
          const setupAttName = model && model.slots && model.slotIndex && model.slotIndex.has && model.slotIndex.has(slotName) ? model.slots[model.slotIndex.get(slotName)].setupAttachment : null;
          const att = setupAttName ? findModelAttachment(model, slotName, setupAttName) : null;
          rows.push({
            kind: "deform", owner: slotName, field: null, label: "形变（旧式）" + slotName, keys: keys, keyCount: keys.length,
            editable: true, unsupported: false, legacy: true, slotName: slotName, attachmentName: setupAttName,
            offsetLength: deformOffsetLengthFromModel(att),
          });
        }
      }
    }
    /* 其它未知顶层时序 */
    for (const k of Object.keys(rawAnim)) {
      if (["bones", "slots", "events", "drawOrder", "attachments", "deform", "ik", "transform", "path"].indexOf(k) >= 0) continue;
      const v = rawAnim[k];
      if (v === null || v === undefined) continue;
      if (!Array.isArray(v) && !isObject(v)) continue;
      const found = [];
      deepTimeKeys(v, found);
      if (!found.length) continue;
      rows.push({ kind: "timeline", owner: k, field: k, label: k, keys: found, keyCount: found.length, editable: false, unsupported: true });
      issues.push(issue("animations.*." + k, "TRACK_UNSUPPORTED", "未知时序 " + k + " 未求值，只读保留"));
    }
    const unsupported = rows.filter(function (r) {
      return r.unsupported === true;
    }).length;
    return { rows: rows, unsupported: unsupported, issues: issues };
  }

  function kindOfRows(rawAnim, model) {
    return scanExtra(rawAnim, model).rows;
  }

  /* ------------------------------------------------------------------ *
   * 校验
   * ------------------------------------------------------------------ */
  function modelEventNames(model) {
    const set = new Set();
    if (model && Array.isArray(model.events)) {
      for (const e of model.events) {
        if (typeof e === "string") set.add(e);
        else if (isObject(e) && typeof e.name === "string") set.add(e.name);
      }
    }
    const rawEvents = model && model.raw && model.raw.events;
    if (isObject(rawEvents)) for (const k of Object.keys(rawEvents)) set.add(k);
    return set;
  }
  function validateOffsets(offsets, model, path, issues) {
    if (!Array.isArray(offsets)) {
      issues.push(issue(path + ".offsets", "DRAW_ORDER_OFFSETS", "offsets 必须是数组"));
      return;
    }
    for (let i = 0; i < offsets.length; i++) {
      const o = offsets[i];
      if (!isObject(o)) {
        issues.push(issue(path + ".offsets[" + i + "]", "DRAW_ORDER_OFFSETS", "offset 项必须是对象"));
        continue;
      }
      if (typeof o.slot !== "string") issues.push(issue(path + ".offsets[" + i + "].slot", "DRAW_ORDER_SLOT", "slot 必须是字符串"));
      else if (model && model.slotIndex && typeof model.slotIndex.get === "function" && typeof model.slotIndex.has === "function" && !model.slotIndex.has(o.slot)) {
        issues.push(issue(path + ".offsets[" + i + "].slot", "DRAW_ORDER_SLOT_UNKNOWN", "未知槽 " + o.slot));
      }
      if (!Number.isInteger(o.offset)) issues.push(issue(path + ".offsets[" + i + "].offset", "DRAW_ORDER_OFFSET", "offset 必须是整数"));
    }
  }
  /**
   * 校验单个 key。ctx：{path, model, eventNames, offsetLength, mode, keyFields, valueField, writeField}
   */
  function validateKey(kind, key, ctx) {
    const issues = [];
    const c = ctx || {};
    const path = c.path || "key";
    if (!isObject(key)) return [issue(path, "KEY_INVALID", "key 必须是对象")];
    const t = keyTime(key);
    if (t === null) issues.push(issue(path + ".time", "KEY_TIME", "time 必须是有限数"));
    else if (t < -TIME_EPS) issues.push(issue(path + ".time", "KEY_TIME_NEGATIVE", "time 不能为负：" + t));

    if (kind === "event") {
      if (typeof key.name !== "string" || !key.name) issues.push(issue(path + ".name", "EVENT_NAME_REQUIRED", "事件名必须是非空字符串"));
      else if (c.eventNames && c.eventNames.size && !c.eventNames.has(key.name)) issues.push(issue(path + ".name", "EVENT_NAME_UNKNOWN", "模型中不存在事件 " + key.name));
      for (const f of ["int", "float", "volume", "balance"]) if (key[f] !== undefined && !isFiniteNum(key[f])) issues.push(issue(path + "." + f, "EVENT_FIELD_NUMBER", f + " 必须是有限数"));
      if (key.string !== undefined && key.string !== null && typeof key.string !== "string") issues.push(issue(path + ".string", "EVENT_FIELD_STRING", "string 必须是字符串"));
      return issues;
    }
    if (kind === "drawOrder") {
      validateOffsets(key.offsets, c.model, path, issues);
      return issues;
    }
    if (kind === "deform") {
      if (key.offset !== undefined && (!Number.isInteger(key.offset) || key.offset < 0)) issues.push(issue(path + ".offset", "DEFORM_OFFSET", "offset 必须是非负整数"));
      if (!Array.isArray(key.vertices)) issues.push(issue(path + ".vertices", "DEFORM_VERTICES", "vertices 必须是数组"));
      else {
        for (let i = 0; i < key.vertices.length; i++) if (!isFiniteNum(key.vertices[i])) issues.push(issue(path + ".vertices[" + i + "]", "DEFORM_VERTEX_NUMBER", "偏移必须是有限数"));
        const expect = c.offsetLength ? c.offsetLength : 0;
        if (expect && key.vertices.length !== expect) issues.push(issue(path + ".vertices", "DEFORM_LENGTH_MISMATCH", "顶点偏移长度 " + key.vertices.length + " ≠ 期望 " + expect));
      }
      if (key.curve !== undefined && key.curve !== null) {
        if (key.curve === "stepped") {
          /* ok */
        } else if (Array.isArray(key.curve)) {
          if (key.curve.length < 4 || !isFiniteNum(key.curve[0]) || !isFiniteNum(key.curve[1]) || !isFiniteNum(key.curve[2]) || !isFiniteNum(key.curve[3])) issues.push(issue(path + ".curve", "DEFORM_CURVE", "curve 需要 4 个有限数"));
        } else issues.push(issue(path + ".curve", "DEFORM_CURVE", "curve 必须是 'stepped' 或 4 个数"));
      }
      return issues;
    }
    /* path 单值子轨（position/spacing）：官方 readTimeline1 读 value */
    if (kind === "path" && c.mode === "single") {
      if (!isFiniteNum(key.value)) issues.push(issue(path + ".value", "TRACK_FIELD_NUMBER", (c.valueField || "value") + " 必须是有限数"));
      return issues;
    }
    /* ik / transform / path.mix：合并 key，字段限于 keyFields */
    const keyFields = c.keyFields || (schemaOf(kind) ? schemaOf(kind).keyFields : null);
    if (!keyFields) return issues;
    for (const f of Object.keys(key)) {
      if (f === "time" || f === "curve") continue;
      if (keyFields.indexOf(f) < 0) {
        issues.push(issue(path + "." + f, "TRACK_UNKNOWN_FIELD", "未知 " + kind + " 字段 " + f));
        continue;
      }
      if (c.writeField && f !== c.writeField) continue;
      const fs = fieldSchema(kind, f);
      const v = key[f];
      if (fs && fs.type === "bool") {
        if (typeof v !== "boolean") issues.push(issue(path + "." + f, "TRACK_FIELD_BOOL", f + " 必须是布尔"));
        continue;
      }
      if (!isFiniteNum(v)) {
        issues.push(issue(path + "." + f, "TRACK_FIELD_NUMBER", f + " 必须是有限数"));
        continue;
      }
      if (fs && fs.min !== undefined && v < fs.min - 1e-9) issues.push(issue(path + "." + f, "TRACK_FIELD_RANGE", f + " < " + fs.min));
      if (fs && fs.max !== undefined && v > fs.max + 1e-9) issues.push(issue(path + "." + f, "TRACK_FIELD_RANGE", f + " > " + fs.max));
    }
    return issues;
  }

  function validateTrack(rawAnim, model, kind, owner, field) {
    const issues = [];
    const r = resolveContainer(rawAnim, kind, owner, field, { create: false });
    if (!r.ok) return { ok: false, issues: [issue(kind + "." + owner + "." + field, r.code, "找不到轨道")] };
    const ctx = {
      model: model,
      eventNames: modelEventNames(model),
      offsetLength: kind === "deform" ? deformOffsetLengthForTrack(model, rawAnim, owner, field, r) : 0,
      mode: r.mode,
      keyFields: r.keyFields,
      valueField: r.valueField,
      writeField: null,
      path: r.path,
    };
    let prev = null;
    for (let i = 0; i < r.keys.length; i++) {
      const kpath = r.path + "[" + i + "]";
      for (const it of validateKey(kind, r.keys[i], Object.assign({}, ctx, { path: kpath }))) issues.push(it);
      const t = keyTime(r.keys[i]);
      if (t === null) continue;
      if (prev !== null) {
        if (t < prev - TIME_EPS) issues.push(issue(kpath + ".time", "KEY_OUT_OF_ORDER", "时间乱序 " + t + " < " + prev));
        else if (Math.abs(t - prev) <= TIME_EPS) issues.push(issue(kpath + ".time", "KEY_DUPLICATE_TIME", "重复时间 " + t));
      }
      prev = t;
    }
    return { ok: !issues.some(function (i) { return i.code !== "TRACK_UNKNOWN_FIELD"; }), issues: issues };
  }

  /* ------------------------------------------------------------------ *
   * 编辑
   * ------------------------------------------------------------------ */
  function combinedDefaults(kind, keyFields) {
    const out = {};
    for (const f of keyFields) {
      const fs = fieldSchema(kind, f);
      if (fs && fs.default !== undefined) out[f] = fs.default;
    }
    return out;
  }

  /**
   * 额外轨道的 Key 增删改（纯规划）。
   * @param {object} rawAnim
   * @param {{kind,owner?,field?,op:'add'|'set'|'delete'|'move',index?,time?,delta?,value?,model?,pruneEmpty?}} opts
   */
  function planKeyEdit(rawAnim, opts) {
    const o = isObject(opts) ? opts : {};
    if (!isObject(rawAnim)) return fail("ANIM_INVALID", "rawAnim 必须是对象");
    const kind = o.kind;
    const schema = schemaOf(kind);
    if (!schema) return fail("KIND_INVALID", "未知轨道类型 " + JSON.stringify(kind));
    if (["add", "set", "delete", "move"].indexOf(o.op) < 0) return fail("OP_INVALID", "op 必须是 add/set/delete/move");
    const owner = o.owner;
    const field = o.field;
    /* 先在原对象上探测容器是否存在（不创建），保证 set/delete/move 不会悄悄新建轨道 */
    const probe = resolveContainer(rawAnim, kind, owner, field, { create: false });
    const createAllowed = o.create !== false;
    if (!probe.ok && !(o.op === "add" && createAllowed && (probe.code === "TRACK_NOT_FOUND" || probe.code === "TRACK_CONTAINER_INVALID"))) {
      return fail(probe.code === "TRACK_CONTAINER_INVALID" ? "TRACK_CONTAINER_INVALID" : probe.code, "找不到轨道 " + kind + "/" + owner + "/" + field, { path: kind + "." + owner + "." + field });
    }
    const out = clone(rawAnim);
    const r = resolveContainer(out, kind, owner, field, { create: true });
    if (!r.ok) return fail(r.code, "无法创建/定位轨道 " + kind + "/" + owner + "/" + field, { path: kind + "." + owner + "." + field });
    const ctxBase = {
      model: o.model,
      eventNames: modelEventNames(o.model),
      mode: r.mode,
      keyFields: r.keyFields,
      valueField: r.valueField,
      path: r.path,
    };
    const offsetInfo = kind === "deform" ? deformLengthForTrack(o.model, rawAnim, owner, field, probe.ok ? probe : r) : { length: 0, known: true, source: "n/a" };
    const offsetLength = offsetInfo.length;
    const keys = r.keys.slice();
    const noteIssues = [];

    function locate() {
      if (Number.isInteger(o.index)) {
        if (o.index < 0 || o.index >= keys.length) return { ok: false, code: "INDEX_OUT_OF_RANGE" };
        return { ok: true, index: o.index };
      }
      if (isFiniteNum(o.time)) {
        for (let i = 0; i < keys.length; i++) {
          const t = keyTime(keys[i]);
          if (t !== null && Math.abs(t - o.time) <= TIME_EPS) return { ok: true, index: i };
        }
        return { ok: false, code: "KEY_NOT_FOUND" };
      }
      return { ok: false, code: "INDEX_OR_TIME_REQUIRED" };
    }

    if (o.op === "delete" || o.op === "set" || o.op === "move") {
      const loc = locate();
      if (!loc.ok) return fail(loc.code, loc.code, { path: r.path });
      const existing = keys[loc.index];

      if (o.op === "delete") {
        /* 合并 key：删整个 key 会同时移除同 key 的其它字段 —— 显式提示 */
        if (r.mode === "combinedKeys") {
          const others = Object.keys(existing || {}).filter(function (f) {
            return f !== "time" && f !== "curve";
          });
          if (others.length) noteIssues.push(issue(r.path + "[" + loc.index + "]", "DELETE_COMBINED_KEY", "该时间点是合并 key，删除会同时移除字段 " + others.join(",")));
        }
        keys.splice(loc.index, 1);
        if (o.pruneEmpty === true && keys.length === 0 && (kind === "ik" || kind === "transform")) {
          /* 官方允许空数组（:752-753 continue）；prune 时保留空数组而不删约束名，避免约束轨道被整体移除 */
        }
        r.assign(keys);
        return { ok: true, value: out, changedPath: r.path, keyCount: keys.length, issues: noteIssues, index: loc.index };
      }

      if (o.op === "move") {
        let target = null;
        if (isFiniteNum(o.delta)) {
          const t0 = keyTime(existing);
          if (t0 === null) return fail("KEY_TIME", "原 key 时间非法", { path: r.path });
          target = t0 + o.delta;
        } else if (isFiniteNum(o.time)) target = o.time;
        if (target === null) return fail("DELTA_OR_TIME_REQUIRED", "move 需要 delta 或 time", { path: r.path });
        if (!isFiniteNum(target)) return fail("TIME_INVALID", "目标时间必须是有限数", { path: r.path });
        if (target < -TIME_EPS) return fail("TIME_NEGATIVE", "目标时间不能为负：" + target, { path: r.path });
        const moved = Object.assign({}, clone(existing), { time: target < 0 ? 0 : target });
        keys[loc.index] = moved;
        for (let i = 0; i < keys.length; i++) {
          if (i === loc.index) continue;
          const t = keyTime(keys[i]);
          if (t !== null && Math.abs(t - moved.time) <= TIME_EPS) return fail("TIME_COLLISION", "目标时间与已有 Key 冲突：" + moved.time, { path: r.path });
        }
        r.assign(sortKeys(keys));
        return { ok: true, value: out, changedPath: r.path, keyCount: keys.length, issues: noteIssues };
      }

      /* set */
      const value = isObject(o.value) ? o.value : {};
      let merged;
      if (r.mode === "combinedKeys") {
        merged = Object.assign({}, clone(existing));
        const writeFields = r.writeField ? [r.writeField] : (r.keyFields || []).filter(function (f) {
          return value[f] !== undefined;
        });
        for (const f of writeFields) {
          if (value[f] !== undefined) merged[f] = clone(value[f]);
        }
        if (isFiniteNum(o.time) && value.time === undefined) merged.time = o.time;
      } else if (r.mode === "single") {
        merged = Object.assign({}, clone(existing));
        const v = value.value !== undefined ? value.value : field === "position" || field === "spacing" ? value[field] : undefined;
        if (v !== undefined) merged.value = v;
        if (isFiniteNum(o.time) && value.time === undefined) merged.time = o.time;
      } else {
        merged = Object.assign({}, clone(existing), clone(value));
        if (isFiniteNum(o.time) && value.time === undefined) merged.time = o.time;
      }
      const sub = validateKey(kind, merged, Object.assign({}, ctxBase, { path: r.path + "[" + loc.index + "]", writeField: r.writeField }));
      if (sub.length) return { ok: false, value: null, changedPath: null, keyCount: null, issues: sub };
      keys[loc.index] = merged;
      r.assign(sortKeys(keys));
      return { ok: true, value: out, changedPath: r.path, keyCount: keys.length, issues: noteIssues, index: loc.index };
    }

    /* add */
    if (!isFiniteNum(o.time)) return fail("TIME_REQUIRED", "add 需要 time", { path: r.path });
    if (o.time < -TIME_EPS) return fail("TIME_NEGATIVE", "time 不能为负：" + o.time, { path: r.path });
    if (kind === "deform" && !offsetInfo.known) {
      return fail("DEFORM_LENGTH_UNKNOWN", "无法从模型/附件定义推出形变偏移长度（weighted=2×influence、rigid=2×顶点），拒绝用 0 长度占位写入", { path: r.path });
    }
    const time = o.time < 0 ? 0 : o.time;
    const value = isObject(o.value) ? o.value : {};
    let draft;
    if (r.mode === "combinedKeys") {
      draft = Object.assign({ time: time }, combinedDefaults(kind, r.keyFields), clone(value));
      draft.time = time;
    } else if (r.mode === "single") {
      const v = value.value !== undefined ? value.value : value[field];
      draft = { time: time, value: v !== undefined ? v : (schema.subTracks && schema.subTracks[(field === "position" || field === "spacing") ? field : "position"] ? schema.subTracks[field].default : 0) };
    } else if (kind === "event") {
      draft = Object.assign({ time: time }, { int: 0, float: 0, string: null, volume: 1, balance: 0 }, clone(value));
      draft.time = time;
    } else if (kind === "drawOrder") {
      draft = Object.assign({ time: time }, clone(value));
      draft.time = time;
    } else {
      /* deform */
      draft = Object.assign({ time: time }, clone(value));
      draft.time = time;
      if (!Array.isArray(draft.vertices)) draft.vertices = new Array(offsetLength || 0).fill(0);
      if (draft.offset === undefined) draft.offset = 0;
    }
    const sub = validateKey(kind, draft, Object.assign({}, ctxBase, { path: r.path + "[" + keys.length + "]", offsetLength: offsetLength, writeField: null }));
    if (sub.length) return { ok: false, value: null, changedPath: null, keyCount: null, issues: sub };
    let idx = -1;
    let overwritten = false;
    for (let i = 0; i < keys.length; i++) {
      const t = keyTime(keys[i]);
      if (t !== null && Math.abs(t - time) <= TIME_EPS) {
        idx = i;
        overwritten = true;
        break;
      }
    }
    if (overwritten) {
      /* 同刻覆盖：合并 key 只覆盖本次给出的字段，保留其它字段与未知扩展/curve */
      if (r.mode === "combinedKeys") {
        const merged = Object.assign({}, clone(keys[idx]), clone(value));
        merged.time = time;
        keys[idx] = merged;
      } else {
        keys[idx] = Object.assign({}, clone(keys[idx]), draft);
      }
    } else {
      keys.push(draft);
      idx = keys.length - 1;
    }
    r.assign(sortKeys(keys));
    return { ok: true, value: out, changedPath: r.path, keyCount: keys.length, issues: noteIssues, index: idx, overwritten: overwritten };
  }

  /** 便捷：改某个形变顶点在指定时间的偏移 */
  function setDeformVertex(rawAnim, opts) {
    const o = isObject(opts) ? opts : {};
    if (!isFiniteNum(o.index) || o.index < 0) return fail("VERTEX_INDEX", "index 必须是非负整数");
    if (!isFiniteNum(o.x) || !isFiniteNum(o.y)) return fail("VERTEX_VALUE", "x/y 必须是有限数");
    const r = resolveContainer(rawAnim, "deform", o.slot, o.legacy ? null : o.attachment, { create: o.create !== false && !o.legacy, skin: o.skin });
    if (!r.ok) return fail(r.code, "找不到形变轨道 " + o.slot + "/" + (o.attachment || "(旧式)"));
    const offsetLength = deformOffsetLengthForTrack(o.model, rawAnim, o.slot, o.legacy ? null : o.attachment, r);
    const idx = 2 * o.index;
    if (offsetLength && idx + 1 >= offsetLength) return fail("VERTEX_INDEX_RANGE", "顶点下标越界（偏移长度 " + offsetLength + "）");
    let target = null;
    for (const k of r.keys) {
      const t = keyTime(k);
      if (t !== null && isFiniteNum(o.time) && Math.abs(t - o.time) <= TIME_EPS) target = k;
    }
    const vertices = target && Array.isArray(target.vertices) ? clone(target.vertices) : new Array(offsetLength).fill(0);
    while (vertices.length < idx + 2) vertices.push(0);
    vertices[idx] = o.x;
    vertices[idx + 1] = o.y;
    const value = { offset: target && Number.isInteger(target.offset) ? target.offset : 0, vertices: vertices };
    if (target && target.curve !== undefined) value.curve = clone(target.curve);
    return planKeyEdit(rawAnim, { kind: "deform", owner: o.slot, field: o.legacy ? null : o.attachment, op: "add", time: isFiniteNum(o.time) ? o.time : 0, value: value, model: o.model });
  }

  /* ------------------------------------------------------------------ *
   * 稳定签名（与 app.js modelSignature() 同算法）
   * ------------------------------------------------------------------ */
  function skeletonSignature(model) {
    if (!model || !Array.isArray(model.bones) || !Array.isArray(model.slots)) return "";
    const parts = [];
    for (let i = 0; i < model.bones.length; i++) {
      const b = model.bones[i];
      parts.push(String(b && b.name) + (b && b.parentIndex >= 0 && model.bones[b.parentIndex] ? ">" + model.bones[b.parentIndex].name : ""));
    }
    for (let i = 0; i < model.slots.length; i++) parts.push("slot:" + String(model.slots[i] && model.slots[i].name));
    const text = parts.join("|");
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36) + "-" + model.bones.length + "-" + model.slots.length;
  }

  const api = Object.freeze({
    SCHEMA: SCHEMA,
    TIME_EPS: TIME_EPS,
    IK_KEY_FIELDS: IK_KEY_FIELDS,
    TRANSFORM_KEY_FIELDS: TRANSFORM_KEY_FIELDS,
    PATH_MIX_KEY_FIELDS: PATH_MIX_KEY_FIELDS,

    resolveContainer: resolveContainer,
    scanExtra: scanExtra,
    kindOfRows: kindOfRows,
    deformTargets: deformTargets,
    deformOffsetLengthFromRaw: deformOffsetLengthFromRaw,
    deformOffsetLengthFromModel: deformOffsetLengthFromModel,

    planKeyEdit: planKeyEdit,
    setDeformVertex: setDeformVertex,
    validateTrack: validateTrack,
    validateKey: validateKey,
    skeletonSignature: skeletonSignature,
  });

  global.SpineTrackEdit = api;
  if (typeof window !== "undefined" && window.SpineTrackEdit !== api) window.SpineTrackEdit = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);