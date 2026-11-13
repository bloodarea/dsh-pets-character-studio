/*
 * anim-edit.js —— 动画时间线编辑的纯函数 · 纯模块
 * 边界（与 bundle.js / voice.js 一致）：
 *   本文件不碰 DOM / window.location / Image / Canvas / fetch / 磁盘 IO。
 *   只接受普通对象与数字，返回 {ok, value|issues} 风格结果。
 *   浏览器暴露 window.SpineAnimEdit；Node 里是 globalThis.SpineAnimEdit（selftest 复用）。
 *
 * 关键规则（与 spine-core.js 的求值语义一致，勿改）：
 *   - Spine 4.2 骨的 rotate.value / translate.x,y / shear.x,y 是**相对 setup 的增量**，
 *     scale.x,y 是**相对 setup 的倍率**（spine-core.js applyBoneTracks）。插 key 必须反算。
 *   - 动画时长没有标准字段：duration = 所有 timeline 最后一个 key 的最大时间
 *     （spine-core.js parseAnimation 的 anim.duration）。
 *   - 4.2 每条 key 的 curve 是「每个被动画字段 4 个控制点」：[cx1,cy1,cx2,cy2, ...]；
 *     其中第 0/2 项是**绝对时间**控制点，第 1/3 项是归一化值。改时长必须同比例缩放
 *     第 0/2 项，否则曲线形状会被破坏。
 */

(function (global) {
  "use strict";

  const BONE_FIELDS = Object.freeze([
    { key: "rotate", fields: ["value"], mode: "delta", label: "旋转", unit: "°" },
    { key: "translate", fields: ["x", "y"], mode: "delta", label: "位移", unit: "px" },
    { key: "scale", fields: ["x", "y"], mode: "multiply", label: "缩放", unit: "×" },
    { key: "shear", fields: ["x", "y"], mode: "delta", label: "斜切", unit: "°" },
  ]);

  const DEFAULT_EPS = 1e-6;

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function isFiniteNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function issue(path, code, message) {
    return { path: String(path == null ? "" : path), code: code, message: String(message || code) };
  }
  function round(v, digits) {
    const p = Math.pow(10, digits == null ? 6 : digits);
    return Math.round(v * p) / p;
  }
  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  /** 固定字段顺序：旋转在前的 4 组 */
  function boneFieldSpecs() {
    return BONE_FIELDS.slice();
  }

  function specFor(key) {
    for (const s of BONE_FIELDS) if (s.key === key) return s;
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 时长
   * ------------------------------------------------------------------ */

  /** 深度扫描任意 JSON 里"带 time 的 key"（用于 events / deform / drawOrder 等非标准时序） */
  function scanTimeDeep(value, bump) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isObject(item) && isFiniteNum(item.time)) bump(item.time);
        else if (isObject(item) || Array.isArray(item)) scanTimeDeep(item, bump);
      }
      return;
    }
    if (isObject(value)) {
      for (const k of Object.keys(value)) {
        const v = value[k];
        if (isObject(v) || Array.isArray(v)) scanTimeDeep(v, bump);
      }
    }
  }

  /**
   * 扫描动画的已知时序，收集最大时间与 key 计数。
   * 覆盖：bones / slots（key 数组）、ik（continuous 与 stepped）、drawOrder（对象项 time）、
   * 以及 events / deform / attachments / ffd 等其它带 time 的时序（如实计入，不静默漏掉）。
   */
  function scanTimelineKeys(anim) {
    let max = 0;
    let count = 0;
    const bump = (t) => {
      count++;
      if (isFiniteNum(t) && t > max) max = t;
    };
    const scanList = (keys) => {
      if (!Array.isArray(keys)) return;
      for (const k of keys) bump(isObject(k) ? k.time : undefined);
    };
    const seenBag = (bag) => {
      if (!isObject(bag)) return;
      for (const field of Object.keys(bag)) scanList(bag[field]);
    };
    if (!isObject(anim)) return { maxTime: 0, keyCount: 0 };
    if (isObject(anim.bones)) for (const n of Object.keys(anim.bones)) seenBag(anim.bones[n]);
    if (isObject(anim.slots)) for (const n of Object.keys(anim.slots)) seenBag(anim.slots[n]);
    if (isObject(anim.ik)) {
      for (const n of Object.keys(anim.ik)) {
        const bag = anim.ik[n];
        if (!isObject(bag)) continue;
        if (isObject(bag.continuous)) scanList(bag.continuous.keys);
        for (const f of ["bendPositive", "compress", "stretch"]) scanList(bag[f]);
      }
    }
    if (Array.isArray(anim.drawOrder)) for (const k of anim.drawOrder) if (isObject(k)) bump(k.time);
    /* 其它时序（events / deform / attachments / ffd …）：深度扫描，只统计有 time 的对象 */
    for (const k of Object.keys(anim)) {
      if (k === "bones" || k === "slots" || k === "ik" || k === "drawOrder") continue;
      const v = anim[k];
      if (v === null || v === undefined) continue;
      if (Array.isArray(v) || isObject(v)) scanTimeDeep(v, bump);
    }
    return { maxTime: max, keyCount: count };
  }

  /** 动画时长（不读非标准 duration 字段） */
  function animDurationOf(rawAnim) {
    return scanTimelineKeys(rawAnim).maxTime;
  }

  /** 编辑草稿的时长 = 原动画时长（应用时长前） */
  function draftBaseDuration(rawAnim) {
    return animDurationOf(rawAnim);
  }

  /* ------------------------------------------------------------------ *
   * 时长缩放
   * ------------------------------------------------------------------ */

  /** 检查一个 key 对象里所有数值字段都是有限数（含 time 与曲线控制点） */
  function finiteKeyCheck(k) {
    if (!isObject(k)) return true;
    for (const f of Object.keys(k)) {
      const v = k[f];
      if (typeof v === "number" && !isFinite(v)) return false;
      if (Array.isArray(v) && f === "curve") {
        for (const c of v) if (typeof c === "number" && !isFinite(c)) return false;
      }
    }
    return true;
  }

  function scaleCurve(curve, s) {
    if (!Array.isArray(curve)) return curve;
    const out = curve.slice();
    for (let i = 0; i + 3 < out.length; i += 4) {
      if (isFiniteNum(out[i])) out[i] = round(out[i] * s, 6);
      if (isFiniteNum(out[i + 2])) out[i + 2] = round(out[i + 2] * s, 6);
    }
    return out;
  }

  function scaleKeyList(keys, s, dur) {
    const out = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!isObject(k)) {
        out.push(k);
        continue;
      }
      const next = {};
      const t = isFiniteNum(k.time) ? k.time : 0;
      next.time = round(t * s, 6);
      for (const f of Object.keys(k)) {
        if (f === "time") continue;
        next[f] = f === "curve" ? scaleCurve(k[f], s) : k[f];
      }
      out.push(next);
    }
    if (out.length) {
      if (out[0] && isFiniteNum(out[0].time) && Math.abs(out[0].time) < DEFAULT_EPS) out[0].time = 0;
      const last = out[out.length - 1];
      if (last && isFiniteNum(last.time) && isFiniteNum(dur) && last.time > dur) last.time = round(dur, 6);
    }
    return out;
  }

  const BONE_TIMELINE_FIELDS = Object.freeze(["rotate", "translate", "scale", "shear"]);
  const SLOT_TIMELINE_FIELDS = Object.freeze(["attachment"]);
  /** 已知时序：这些顶层键会按比例缩放 */
  const ANIM_TIMELINE_KEYS = Object.freeze(["bones", "slots", "ik", "drawOrder"]);
  const IK_STEPPED_FIELDS = Object.freeze(["bendPositive", "compress", "stretch"]);

  function scaleBag(bag, s, dur, recognized) {
    const out = {};
    const known = recognized || [];
    for (const field of Object.keys(bag || {})) {
      const v = bag[field];
      if (Array.isArray(v) && known.indexOf(field) >= 0) out[field] = scaleKeyList(v, s, dur);
      else out[field] = clone(v);
    }
    return out;
  }

  function scaleIK(ik, s, dur) {
    const out = {};
    for (const name of Object.keys(ik || {})) {
      const bag = ik[name];
      if (!isObject(bag)) {
        out[name] = clone(bag);
        continue;
      }
      const next = {};
      for (const field of Object.keys(bag)) {
        const v = bag[field];
        if (field === "continuous" && isObject(v)) {
          const cont = {};
          for (const f of Object.keys(v)) {
            if (f === "keys" && Array.isArray(v[f])) cont[f] = scaleKeyList(v[f], s, dur);
            else cont[f] = clone(v[f]);
          }
          next[field] = cont;
        } else if (IK_STEPPED_FIELDS.indexOf(field) >= 0 && Array.isArray(v)) {
          next[field] = scaleKeyList(v, s, dur);
        } else {
          next[field] = clone(v);
        }
      }
      out[name] = next;
    }
    return out;
  }

  function scaleDrawOrder(list, s, dur) {
    if (!Array.isArray(list)) return list;
    return list.map((k) => {
      if (!isObject(k)) return clone(k);
      const next = {};
      const t = isFiniteNum(k.time) ? k.time : 0;
      next.time = round(t * s, 6);
      if (dur != null && next.time > dur) next.time = round(dur, 6);
      for (const f of Object.keys(k)) {
        if (f === "time") continue;
        next[f] = f === "curve" ? scaleCurve(k[f], s) : clone(k[f]);
      }
      return next;
    });
  }

  /** 深度缩放任意 JSON 里"带 time 的 key"（events / deform / attachments / ffd 等） */
  function scaleTimeDeep(value, s, dur) {
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (isObject(item)) {
          if (isFiniteNum(item.time)) return scaleKeyList([item], s, dur)[0];
          const out = {};
          for (const k of Object.keys(item)) {
            const v = item[k];
            out[k] = isObject(v) || Array.isArray(v) ? scaleTimeDeep(v, s, dur) : clone(v);
          }
          return out;
        }
        return Array.isArray(item) ? scaleTimeDeep(item, s, dur) : clone(item);
      });
    }
    if (isObject(value)) {
      const out = {};
      for (const k of Object.keys(value)) {
        const v = value[k];
        out[k] = isObject(v) || Array.isArray(v) ? scaleTimeDeep(v, s, dur) : clone(v);
      }
      return out;
    }
    return clone(value);
  }

  /** 深度检查缩放结果里没有非有限数字（JSON 会把 Infinity/NaN 变成 null） */
  function deepFiniteOk(value, path, issues) {
    if (typeof value === "number") {
      if (!isFinite(value)) {
        issues.push(issue(path, "ANIM_SCALE_OVERFLOW", "缩放结果出现非有限数字（" + path + "），已拒绝本次缩放"));
        return false;
      }
      return true;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (!deepFiniteOk(value[i], path + "[" + i + "]", issues)) return false;
      }
      return true;
    }
    if (isObject(value)) {
      for (const k of Object.keys(value)) {
        if (!deepFiniteOk(value[k], path + "." + k, issues)) return false;
      }
      return true;
    }
    return true;
  }

  /**
   * 按比例缩放一个动画对象的**已知时序** key 时间。
   * 规则：
   *   - 旧时长 D_old = 已知时序里最后一个 key 的最大时间（D_old ≤ 0 时按失败返回）。
   *   - 比例 s = D_new / D_old；每个 key.time 与 curve 的绝对时间控制点都乘 s，四舍五入到 1e-6。
   *   - 缩放后把首 key 的 time 归零（|t| < 1e-6），并把落在 D_new 之后的最后一个 key 夹到 D_new。
   *   - 覆盖的已知时序：bones（rotate/translate/scale/shear）、slots（attachment）、
   *     ik（continuous + bendPositive/compress/stretch）、drawOrder，以及 events / deform /
   *     attachments / ffd 等其它带 time 的时序（深度缩放，未识别字段原样保留）。
   *   - 结果里任何非有限数字（溢出）都会被检出并**原子拒绝**，不落盘成 null。
   * @returns {{ok:boolean, value?:object, scaled?:string[], issues?:Array}}
   */
  function scaleAnimationTimes(rawAnim, newDuration) {
    const issues = [];
    if (!isObject(rawAnim)) return { ok: false, issues: [issue("animations", "ANIM_INVALID", "动画必须是对象")] };
    if (!isFiniteNum(newDuration) || newDuration <= 0) {
      return { ok: false, issues: [issue("animations.duration", "ANIM_DURATION", "时长必须是正数")] };
    }
    const old = animDurationOf(rawAnim);
    if (!(old > 0)) {
      return { ok: false, issues: [issue("animations.duration", "ANIM_DURATION_ZERO", "旧时长 ≤ 0，无法按比例缩放")] };
    }
    const s = newDuration / old;
    if (!isFinite(s)) {
      return { ok: false, issues: [issue("animations.duration", "ANIM_SCALE_OVERFLOW", "缩放比例非有限数（时长超出可表示范围），已拒绝")] };
    }
    const out = {};
    const scaled = [];
    for (const k of Object.keys(rawAnim)) {
      const v = rawAnim[k];
      if (k === "bones" && isObject(v)) {
        const bones = {};
        for (const name of Object.keys(v)) bones[name] = scaleBag(v[name], s, newDuration, BONE_TIMELINE_FIELDS);
        out.bones = bones;
        scaled.push(k);
      } else if (k === "slots" && isObject(v)) {
        const slots = {};
        for (const name of Object.keys(v)) slots[name] = scaleBag(v[name], s, newDuration, SLOT_TIMELINE_FIELDS);
        out.slots = slots;
        scaled.push(k);
      } else if (k === "ik" && isObject(v)) {
        out.ik = scaleIK(v, s, newDuration);
        scaled.push(k);
      } else if (k === "drawOrder" && Array.isArray(v)) {
        out.drawOrder = scaleDrawOrder(v, s, newDuration);
        scaled.push(k);
      } else if (Array.isArray(v) || isObject(v)) {
        out[k] = scaleTimeDeep(v, s, newDuration);
        scaled.push(k);
      } else {
        out[k] = clone(v);
      }
    }
    /* 溢出守卫：任何非有限数字都拒绝整次缩放（否则 JSON 会写成 null） */
    if (!deepFiniteOk(out, "animations", issues)) return { ok: false, issues: issues };
    return { ok: true, value: out, scaled: scaled, unscaled: [], issues: issues };
  }

  /* ------------------------------------------------------------------ *
   * 整体重定时预检（AC-15）
   * scaleAnimationTimes 只按已知结构缩时间：bones 只认 rotate/translate/scale/shear，
   * slots 只认 attachment，ik 只认 continuous.keys + bendPositive/compress/stretch，
   * drawOrder 整体；其它顶层结构走 scaleTimeDeep（只缩放「数组项里带有限 time」的对象）。
   * 因此以下数据不会被一致缩放，直接调用会「部分重排」：
   *   - 骨/槽 bag 里的未知字段（splitX、rgba…）或形状不合法的已知轨道；
   *   - ik bag 里未识别的带 time 字段、continuous 形状不匹配；
   *   - 顶层对象属性位置上的带 time 对象（scaleTimeDeep 只缩数组项）；
   *   - 已知 key 项内部嵌套的带 time 数据（scaleKeyList 只克隆该项）。
   * 预检发现任何一项即整批拒绝，不部分通过。
   * ------------------------------------------------------------------ */

  const IK_SCALED_FIELDS = Object.freeze(["bendPositive", "compress", "stretch"]);

  /**
   * 任意深度是否存在「带有限 time 的对象」。
   * 比 scanTimeDeep 更宽：对象自身的 time 也算（scaleKeyList/scaleBag 会整段克隆，
   * 任何位置的 time 都不会被缩放，因此预检必须一律拦下）。
   */
  function hasTimeDeep(value) {
    if (Array.isArray(value)) {
      for (const item of value) if (hasTimeDeep(item)) return true;
      return false;
    }
    if (isObject(value)) {
      if (isFiniteNum(value.time)) return true;
      for (const k of Object.keys(value)) if (hasTimeDeep(value[k])) return true;
    }
    return false;
  }

  /** key 项内部是否有不会被 scaleKeyList 缩放的嵌套 time（curve 是纯数字控制点，排除） */
  function nestedTimeField(item) {
    for (const f of Object.keys(item)) {
      if (f === "curve") continue;
      const v = item[f];
      if ((isObject(v) || Array.isArray(v)) && hasTimeDeep(v)) return f;
    }
    return null;
  }

  /** 已知 key 数组校验；返回原因字符串或 null（空数组安全） */
  function keyArrayIssue(value) {
    if (!Array.isArray(value)) return null;
    for (let i = 0; i < value.length; i++) {
      const k = value[i];
      if (!isObject(k)) return "第 " + i + " 项不是对象";
      if (!isFiniteNum(k.time)) return "第 " + i + " 项缺少有限 time";
      const nested = nestedTimeField(k);
      if (nested) return "第 " + i + " 项的 " + nested + " 内嵌带 time 数据";
    }
    return null;
  }

  /** 顶层未知结构是否能被 scaleTimeDeep 一致缩放（镜像其遍历，收集所有问题） */
  function collectDeepScaleIssues(value, path, out) {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (isObject(item) && isFiniteNum(item.time)) {
          const nested = nestedTimeField(item);
          if (nested) out.push({ path: path + "[" + i + "]." + nested, reason: "时间 key 项内嵌带 time 数据" });
        } else if (isObject(item) || Array.isArray(item)) {
          collectDeepScaleIssues(item, path + "[" + i + "]", out);
        }
      }
      return out;
    }
    if (isObject(value)) {
      for (const k of Object.keys(value)) {
        const v = value[k];
        if (!isObject(v) && !Array.isArray(v)) continue;
        if (isObject(v) && isFiniteNum(v.time)) {
          out.push({ path: path + "." + k, reason: "带 time 的对象处于对象属性位置（scaleTimeDeep 只缩放数组项）" });
          continue;
        }
        collectDeepScaleIssues(v, path + "." + k, out);
      }
    }
    return out;
  }

  /**
   * 扫描整个动画，判定能否安全地整体重定时全部 Key。
   * @returns {{ok:boolean, value:{maxTime:number,keyCount:number,unknownPaths:Array<{path,reason}>}, issues:Array}}
   *   ok:false 时 issues 每项 code=ANIM_RETIME_UNSUPPORTED_TRACK + path + 原因。
   */
  function retimeAllPrecheck(rawAnim) {
    if (!isObject(rawAnim)) {
      return {
        ok: false,
        value: { maxTime: 0, keyCount: 0, unknownPaths: [] },
        issues: [issue("animations", "ANIM_INVALID", "动画必须是对象")],
      };
    }
    const scanned = scanTimelineKeys(rawAnim);
    const unknown = [];
    const push = (path, reason) => unknown.push({ path: String(path), reason: String(reason) });

    ["bones", "slots", "ik"].forEach(function (bagKey) {
      const v = rawAnim[bagKey];
      if (v === undefined || v === null) return;
      if (!isObject(v)) push(bagKey, bagKey + " 不是对象，缩放会按未知结构处理");
    });

    if (isObject(rawAnim.bones)) {
      for (const owner of Object.keys(rawAnim.bones)) {
        const bag = rawAnim.bones[owner];
        if (!isObject(bag)) {
          push("bones." + owner, "骨 timeline 不是对象，scaleBag 会把它替换为空对象");
          continue;
        }
        for (const field of Object.keys(bag)) {
          const value = bag[field];
          const path = "bones." + owner + "." + field;
          if (BONE_TIMELINE_FIELDS.indexOf(field) >= 0) {
            if (Array.isArray(value)) {
              const bad = keyArrayIssue(value);
              if (bad) push(path, bad);
            } else if (hasTimeDeep(value) > 0) {
              push(path, "已知骨轨道不是 key 数组但含带 time 数据");
            }
          } else if (hasTimeDeep(value) > 0) {
            push(path, "未知骨轨道不会被整体重定时缩放");
          }
        }
      }
    }

    if (isObject(rawAnim.slots)) {
      for (const owner of Object.keys(rawAnim.slots)) {
        const bag = rawAnim.slots[owner];
        if (!isObject(bag)) {
          push("slots." + owner, "槽 timeline 不是对象，scaleBag 会把它替换为空对象");
          continue;
        }
        for (const field of Object.keys(bag)) {
          const value = bag[field];
          const path = "slots." + owner + "." + field;
          if (SLOT_TIMELINE_FIELDS.indexOf(field) >= 0) {
            if (Array.isArray(value)) {
              const bad = keyArrayIssue(value);
              if (bad) push(path, bad);
            } else if (hasTimeDeep(value) > 0) {
              push(path, "已知槽轨道不是 key 数组但含带 time 数据");
            }
          } else if (hasTimeDeep(value) > 0) {
            push(path, "未知槽轨道不会被整体重定时缩放（例如 color/rgba）");
          }
        }
      }
    }

    if (isObject(rawAnim.ik)) {
      for (const cname of Object.keys(rawAnim.ik)) {
        const bag = rawAnim.ik[cname];
        const cpath = "ik." + cname;
        if (!isObject(bag)) {
          push(cpath, "IK 轨道不是对象，scaleIK 会把它替换为空对象");
          continue;
        }
        for (const field of Object.keys(bag)) {
          const value = bag[field];
          const path = cpath + "." + field;
          if (field === "continuous") {
            if (isObject(value)) {
              for (const cf of Object.keys(value)) {
                const cv = value[cf];
                const cp = path + "." + cf;
                if (cf === "keys" && Array.isArray(cv)) {
                  const bad = keyArrayIssue(cv);
                  if (bad) push(cp, bad);
                } else if (hasTimeDeep(cv) > 0) {
                  push(cp, "IK continuous 的未识别字段含带 time 数据");
                }
              }
            } else if (hasTimeDeep(value) > 0) {
              push(path, "IK continuous 形状不匹配（非对象）但含带 time 数据");
            }
          } else if (IK_SCALED_FIELDS.indexOf(field) >= 0) {
            if (Array.isArray(value)) {
              const bad = keyArrayIssue(value);
              if (bad) push(path, bad);
            } else if (hasTimeDeep(value) > 0) {
              push(path, "IK 步进轨道不是 key 数组但含带 time 数据");
            }
          } else if (hasTimeDeep(value) > 0) {
            push(path, "IK 未识别字段不会被整体重定时缩放");
          }
        }
      }
    }

    if (rawAnim.drawOrder !== undefined && rawAnim.drawOrder !== null) {
      const value = rawAnim.drawOrder;
      if (!Array.isArray(value)) {
        if (hasTimeDeep(value) > 0) push("drawOrder", "drawOrder 不是数组但含带 time 数据");
      } else {
        const bad = keyArrayIssue(value);
        if (bad) push("drawOrder", bad);
      }
    }

    for (const key of Object.keys(rawAnim)) {
      if (key === "bones" || key === "slots" || key === "ik" || key === "drawOrder") continue;
      const value = rawAnim[key];
      if (value === null || value === undefined) continue;
      if (isObject(value) || Array.isArray(value)) collectDeepScaleIssues(value, key, unknown);
    }

    const value = { maxTime: scanned.maxTime, keyCount: scanned.keyCount, unknownPaths: unknown };
    if (unknown.length) {
      return {
        ok: false,
        value: value,
        issues: unknown.map(function (u) {
          return issue(u.path, "ANIM_RETIME_UNSUPPORTED_TRACK", u.path + "：" + u.reason + "（整体重定时会部分重排，已整批拒绝）");
        }),
      };
    }
    return { ok: true, value: value, issues: [] };
  }

  /**
   * 整体重定时（先预检、再调用现有 scaleAnimationTimes）；不修改入参。
   * @returns {{ok:boolean, value?:object, precheck?:object, scaled?:string[], issues?:Array}}
   */
  function retimeAll(rawAnim, newDuration) {
    if (!isObject(rawAnim)) return { ok: false, issues: [issue("animations", "ANIM_INVALID", "动画必须是对象")] };
    if (!isFiniteNum(newDuration) || newDuration <= 0) {
      return { ok: false, issues: [issue("animations.duration", "ANIM_DURATION", "时长必须是正数")] };
    }
    const pre = retimeAllPrecheck(rawAnim);
    if (!pre.ok) return { ok: false, issues: pre.issues, precheck: pre.value };
    if (!(pre.value.maxTime > 0)) {
      return {
        ok: false,
        issues: [issue("animations.duration", "ANIM_DURATION_ZERO", "旧时长 ≤ 0，无法按比例缩放")],
        precheck: pre.value,
      };
    }
    const scaled = scaleAnimationTimes(rawAnim, newDuration);
    if (!scaled.ok) return { ok: false, issues: scaled.issues, precheck: pre.value };
    return { ok: true, value: scaled.value, precheck: pre.value, scaled: scaled.scaled, issues: [] };
  }

  /* ------------------------------------------------------------------ *
   * 轨道读写（key 排序 / 增删改）
   * ------------------------------------------------------------------ */

  function byTime(a, b) {
    return (isFiniteNum(a && a.time) ? a.time : 0) - (isFiniteNum(b && b.time) ? b.time : 0);
  }

  function sortedKeys(keys) {
    return (Array.isArray(keys) ? keys.slice() : []).sort(byTime);
  }

  function findKeyIndex(keys, time, eps) {
    const t = isFiniteNum(time) ? time : 0;
    const e = eps == null ? 1e-4 : eps;
    if (!Array.isArray(keys)) return -1;
    for (let i = 0; i < keys.length; i++) {
      if (Math.abs((isFiniteNum(keys[i].time) ? keys[i].time : 0) - t) <= e) return i;
    }
    return -1;
  }

  /** 把 values 覆盖到 key 对象上（time/issues 校验由调用方负责；attachment 的 name 允许 string|null） */
  function applyKeyValues(target, values, stringFields) {
    for (const f of Object.keys(values)) {
      const v = values[f];
      target[f] = stringFields.indexOf(f) >= 0 ? (v === undefined ? null : v) : round(v, 6);
    }
    return target;
  }

  /**
   * 在 bag（如 raw.bones["tail-1"]）的 field timeline 插入/替换一个 key。
   * 同时间（±1e-4）已存在则替换，否则插入并保持时间递增。
   * @param {string} kind "bones" | "slots"
   * @param {string} ownerName 骨名 / 槽名
   * @param {string} field 轨道字段（rotate / translate / scale / shear / attachment）
   * @param {object} values 数值字段（attachment 轨道的 name 允许 string|null）
   * @param {number} time key 时间（秒）
   * @returns {{ok:boolean, value?:object, replaced?:boolean, issues?:Array}}
   */
  function upsertKey(rawAnim, kind, ownerName, field, values, time) {
    const issues = [];
    if (!isObject(rawAnim)) return { ok: false, issues: [issue("animations", "ANIM_INVALID", "动画必须是对象")] };
    if (kind !== "bones" && kind !== "slots") {
      return { ok: false, issues: [issue("animations", "ANIM_KIND", "轨道种类只能是 bones / slots")] };
    }
    if (!isFiniteNum(time) || time < 0) {
      return { ok: false, issues: [issue("animations.key.time", "ANIM_KEY_TIME", "key 时间必须是非负有限数")] };
    }
    const dur = animDurationOf(rawAnim);
    if (time > dur + 1e-9) {
      return {
        ok: false,
        issues: [issue("animations.key.time", "ANIM_KEY_OVER_DURATION", "key 时间 " + round(time, 4) + "s 超出动画时长 " + round(dur, 4) + "s")],
      };
    }
    if (!isObject(values)) return { ok: false, issues: [issue("animations.key.value", "ANIM_KEY_VALUE", "key 值必须是对象")] };
    const stringFields = kind === "slots" ? ["name"] : [];
    for (const f of Object.keys(values)) {
      const v = values[f];
      if (stringFields.indexOf(f) >= 0) {
        if (v !== null && v !== undefined && typeof v !== "string") {
          return { ok: false, issues: [issue("animations.key." + f, "ANIM_KEY_VALUE", f + " 必须是字符串或 null")] };
        }
        continue;
      }
      if (!isFiniteNum(v)) {
        return { ok: false, issues: [issue("animations.key." + f, "ANIM_KEY_VALUE", f + " 必须是有限数字")] };
      }
    }
    const out = clone(rawAnim);
    if (!isObject(out[kind])) out[kind] = {};
    if (!isObject(out[kind][ownerName])) out[kind][ownerName] = {};
    const bag = out[kind][ownerName];
    if (!Array.isArray(bag[field])) bag[field] = [];
    const idx = findKeyIndex(bag[field], time);
    let replaced = false;
    if (idx >= 0) {
      /* 契约 §6：更新现有 Key 必须 clone 原 Key 再覆盖 time/数值，
         否则会丢 curve 之外的未知扩展字段（及未提供的已知字段）。 */
      const prev = bag[field][idx];
      const next = isObject(prev) ? clone(prev) : {};
      next.time = round(time, 6);
      applyKeyValues(next, values, stringFields);
      bag[field][idx] = next;
      replaced = true;
    } else {
      const next = { time: round(time, 6) };
      applyKeyValues(next, values, stringFields);
      bag[field].push(next);
    }
    bag[field] = sortedKeys(bag[field]);
    return { ok: true, value: out, replaced: replaced, issues: issues };
  }

  /** 删除 key；空 timeline 保留空数组（是否清理由调用方决定） */
  function removeKey(rawAnim, kind, ownerName, field, time) {
    if (!isObject(rawAnim)) return { ok: false, issues: [issue("animations", "ANIM_INVALID", "动画必须是对象")] };
    const out = clone(rawAnim);
    const bag = isObject(out[kind]) ? out[kind][ownerName] : null;
    if (!bag || !Array.isArray(bag[field])) {
      return { ok: false, issues: [issue("animations." + kind, "ANIM_TRACK_MISSING", "找不到轨道")] };
    }
    const idx = findKeyIndex(bag[field], time);
    if (idx < 0) return { ok: false, issues: [issue("animations.key", "ANIM_KEY_MISSING", "找不到该时间的 key")] };
    bag[field].splice(idx, 1);
    return { ok: true, value: out };
  }

  /** 改 key 时间（value 不变）；目标时间与别的 key 冲突则拒绝（不产生重复时间的 key） */
  function retimeKey(rawAnim, kind, ownerName, field, fromTime, toTime) {
    const issues = [];
    if (!isFiniteNum(toTime) || toTime < 0) {
      return { ok: false, issues: [issue("animations.key.time", "ANIM_KEY_TIME", "新时间必须是非负有限数")] };
    }
    const dur = animDurationOf(rawAnim);
    if (toTime > dur + 1e-9) {
      return { ok: false, issues: [issue("animations.key.time", "ANIM_KEY_OVER_DURATION", "新时间超出动画时长 " + round(dur, 4) + "s")] };
    }
    const out = clone(rawAnim);
    const bag = isObject(out[kind]) ? out[kind][ownerName] : null;
    if (!bag || !Array.isArray(bag[field])) {
      return { ok: false, issues: [issue("animations." + kind, "ANIM_TRACK_MISSING", "找不到轨道")] };
    }
    const idx = findKeyIndex(bag[field], fromTime);
    if (idx < 0) return { ok: false, issues: [issue("animations.key", "ANIM_KEY_MISSING", "找不到该时间的 key")] };
    const cur = isFiniteNum(bag[field][idx].time) ? bag[field][idx].time : 0;
    if (Math.abs(cur - toTime) > 1e-9 && findKeyIndex(bag[field], toTime) >= 0) {
      return {
        ok: false,
        issues: [issue("animations.key.time", "ANIM_KEY_TIME_CONFLICT", "目标时间 " + round(toTime, 6) + "s 已有 key，已拒绝改写")],
      };
    }
    bag[field][idx].time = round(toTime, 6);
    bag[field] = sortedKeys(bag[field]);
    return { ok: true, value: out, issues: issues };
  }

  /** 改 key 值（时间不变）；attachment 轨道的 name 允许 string|null */
  function setKeyValues(rawAnim, kind, ownerName, field, time, values) {
    if (!isObject(values)) return { ok: false, issues: [issue("animations.key.value", "ANIM_KEY_VALUE", "key 值必须是对象")] };
    const stringFields = field === "attachment" ? ["name"] : [];
    for (const f of Object.keys(values)) {
      const v = values[f];
      if (stringFields.indexOf(f) >= 0) {
        if (v !== null && v !== undefined && typeof v !== "string") {
          return { ok: false, issues: [issue("animations.key." + f, "ANIM_KEY_VALUE", f + " 必须是字符串或 null")] };
        }
        continue;
      }
      if (!isFiniteNum(v)) {
        return { ok: false, issues: [issue("animations.key." + f, "ANIM_KEY_VALUE", f + " 必须是有限数字")] };
      }
    }
    const out = clone(rawAnim);
    const bag = isObject(out[kind]) ? out[kind][ownerName] : null;
    if (!bag || !Array.isArray(bag[field])) {
      return { ok: false, issues: [issue("animations." + kind, "ANIM_TRACK_MISSING", "找不到轨道")] };
    }
    const idx = findKeyIndex(bag[field], time);
    if (idx < 0) return { ok: false, issues: [issue("animations.key", "ANIM_KEY_MISSING", "找不到该时间的 key")] };
    for (const f of Object.keys(values)) {
      const v = values[f];
      bag[field][idx][f] = stringFields.indexOf(f) >= 0 ? (v === undefined ? null : v) : round(v, 6);
    }
    return { ok: true, value: out };
  }

  /* ------------------------------------------------------------------ *
   * 轨迹扫描（给 UI 列表用）
   * ------------------------------------------------------------------ */

  /**
   * 扫描一个动画对象，返回可直接渲染的轨道列表。
   * @returns {{bones:Array, slots:Array, keyCount:number, duration:number}}
   */
  function scanTracks(rawAnim) {
    const bones = [];
    const slots = [];
    let keyCount = 0;
    if (isObject(rawAnim) && isObject(rawAnim.bones)) {
      for (const name of Object.keys(rawAnim.bones)) {
        const bag = rawAnim.bones[name];
        const tracks = [];
        if (isObject(bag)) {
          for (const spec of BONE_FIELDS) {
            const keys = bag[spec.key];
            if (!Array.isArray(keys) || !keys.length) continue;
            keyCount += keys.length;
            tracks.push({ key: spec.key, label: spec.label, unit: spec.unit, mode: spec.mode, fields: spec.fields.slice(), keys: clone(keys) });
          }
          for (const extra of Object.keys(bag)) {
            if (specFor(extra)) continue;
            if (Array.isArray(bag[extra])) {
              keyCount += bag[extra].length;
              tracks.push({ key: extra, label: extra, unit: "", mode: "delta", fields: [], keys: clone(bag[extra]), unsupported: true });
            }
          }
        }
        bones.push({ name: name, tracks: tracks });
      }
    }
    if (isObject(rawAnim) && isObject(rawAnim.slots)) {
      for (const name of Object.keys(rawAnim.slots)) {
        const bag = rawAnim.slots[name];
        const tracks = [];
        if (isObject(bag)) {
          for (const field of Object.keys(bag)) {
            const keys = bag[field];
            if (!Array.isArray(keys) || !keys.length) continue;
            keyCount += keys.length;
            tracks.push({ key: field, keys: clone(keys) });
          }
        }
        slots.push({ name: name, tracks: tracks });
      }
    }
    return { bones: bones, slots: slots, keyCount: keyCount, duration: animDurationOf(rawAnim) };
  }

  /* ------------------------------------------------------------------ *
   * 当前姿态 → 相对 setup 的 key 值（反算规则见文件头）
   * ------------------------------------------------------------------ */

  /**
   * @param {string} field rotate|translate|scale|shear
   * @param {object} local  pose.local[boneIndex]（{x,y,rotation,scaleX,scaleY,shearX,shearY}）
   * @param {object} setup  model.bones[boneIndex] 的 setup 值
   * @returns {{ok:boolean, values?:object, issues?:Array}}
   */
  function relativeValues(field, local, setup) {
    if (!isObject(local) || !isObject(setup)) {
      return { ok: false, issues: [issue("pose", "POSE_SOURCE_MISSING", "缺少当前姿态或 setup 值")] };
    }
    const num = (v, d) => (isFiniteNum(v) ? v : d);
    if (field === "rotate") {
      return { ok: true, values: { value: round(num(local.rotation, 0) - num(setup.rotation, 0), 6) } };
    }
    if (field === "shear") {
      return {
        ok: true,
        values: { x: round(num(local.shearX, 0) - num(setup.shearX, 0), 6), y: round(num(local.shearY, 0) - num(setup.shearY, 0), 6) },
      };
    }
    if (field === "translate") {
      return { ok: true, values: { x: round(num(local.x, 0) - num(setup.x, 0), 6), y: round(num(local.y, 0) - num(setup.y, 0), 6) } };
    }
    if (field === "scale") {
      const sx = num(setup.scaleX, 1);
      const sy = num(setup.scaleY, 1);
      if (Math.abs(sx) < 1e-9 || Math.abs(sy) < 1e-9) {
        return { ok: false, issues: [issue("pose", "POSE_SETUP_SCALE_ZERO", "setup 缩放为 0，无法反算倍率")] };
      }
      return { ok: true, values: { x: round(num(local.scaleX, 1) / sx, 6), y: round(num(local.scaleY, 1) / sy, 6) } };
    }
    return { ok: false, issues: [issue("pose", "POSE_FIELD", "不支持的骨字段 " + field)] };
  }

  /** 时间线采样 → 相对 setup 的值（新增 key 时用 evaluated 轨道值也可以） */
  function relativeFromTrackValue(field, sampled, setup) {
    if (!Array.isArray(sampled) || !isObject(setup)) {
      return { ok: false, issues: [issue("pose", "POSE_SOURCE_MISSING", "缺少采样值或 setup 值")] };
    }
    const num = (v, d) => (isFiniteNum(v) ? v : d);
    if (field === "rotate") return { ok: true, values: { value: round(num(sampled[0], 0), 6) } };
    if (field === "translate") return { ok: true, values: { x: round(num(sampled[0], 0), 6), y: round(num(sampled[1], 0), 6) } };
    if (field === "scale") return { ok: true, values: { x: round(num(sampled[0], 1), 6), y: round(num(sampled[1], 1), 6) } };
    if (field === "shear") return { ok: true, values: { x: round(num(sampled[0], 0), 6), y: round(num(sampled[1], 0), 6) } };
    return { ok: false, issues: [issue("pose", "POSE_FIELD", "不支持的骨字段 " + field)] };
  }

  /* ------------------------------------------------------------------ *
   * 保存补丁
   * ------------------------------------------------------------------ */

  /**
   * 把草稿动画合并进 patchedModel（buildPatchedModel 的产物）。
   * - 只替换**明确编辑过**的动画；未编辑的动画保留 patched 里（来自 raw）的原值。
   * - drafts 为空时不添加 animations 键。
   * - 不修改入参。
   * @returns {{ok:boolean, value?:object, applied?:string[], issues?:Array}}
   */
  function applyAnimationDrafts(patched, drafts) {
    const issues = [];
    if (!isObject(patched)) return { ok: false, issues: [issue("", "ANIM_PATCH_INVALID", "模型补丁不是对象")] };
    const names = isObject(drafts) ? Object.keys(drafts) : [];
    const out = clone(patched);
    if (!names.length) return { ok: true, value: out, applied: [], issues: issues };
    if (!isObject(out.animations)) out.animations = {};
    for (const name of names) {
      const anim = drafts[name];
      if (!isObject(anim)) {
        issues.push(issue("animations." + name, "ANIM_DRAFT_INVALID", "草稿动画不是对象，已跳过"));
        continue;
      }
      out.animations[name] = clone(anim);
    }
    return { ok: true, value: out, applied: names.filter((n) => isObject(drafts[n])), issues: issues };
  }

  /* ==========================================================================
   * P1（T20）：Graph 曲线的读写。曲线数组结构交给 SpineCurveEdit（懒取全局，
   * 避免加载顺序耦合）；本模块只负责「读写整条轨 + 保持其它字段」，
   * app 不得直接改 raw.animations。
   * ====================================================================== */

  function curveLib() {
    const lib = global.SpineCurveEdit;
    return lib && typeof lib.setSegmentType === "function" ? lib : null;
  }

  /** 读某轨 key 数组（深克隆）。轨道不存在不算错误，返回空数组 + issues 提示 */
  function trackKeys(rawAnim, kind, ownerName, field) {
    if (!isObject(rawAnim)) return { ok: false, keys: [], issues: [issue("animations", "ANIM_INVALID", "动画必须是对象")] };
    const bag = isObject(rawAnim[kind]) ? rawAnim[kind][ownerName] : null;
    const list = bag && Array.isArray(bag[field]) ? bag[field] : null;
    if (!list) {
      return { ok: true, keys: [], issues: [issue("animations." + kind, "ANIM_TRACK_MISSING", "轨道不存在（返回空数组）")] };
    }
    return { ok: true, keys: clone(list), issues: [] };
  }

  /** 把整条轨写回（深克隆 rawAnim；只替换目标轨） */
  function writeTrack(rawAnim, kind, ownerName, field, keys) {
    const out = clone(rawAnim);
    if (!isObject(out[kind])) out[kind] = {};
    if (!isObject(out[kind][ownerName])) out[kind][ownerName] = {};
    out[kind][ownerName][field] = clone(keys);
    return out;
  }

  /**
   * 写回某段曲线（类型或控制点）。
   * @param {object} segment {type?:'linear'|'stepped'|'bezier', points?:{cx1,cy1,cx2,cy2}, componentWide?:boolean}
   * @returns {{ok:true,value:object,change:string,issues:Array}|{ok:false,issues:Array}}
   */
  function setKeyCurve(rawAnim, kind, ownerName, field, time, valueIndex, segment) {
    const lib = curveLib();
    if (!lib) return { ok: false, issues: [issue("animations.curve", "ANIM_CURVE_LIB_MISSING", "缺少 SpineCurveEdit 模块")] };
    if (!isObject(segment)) return { ok: false, issues: [issue("animations.curve", "ANIM_CURVE_ARG", "segment 必须是对象")] };
    const read = trackKeys(rawAnim, kind, ownerName, field);
    if (!read.ok) return { ok: false, issues: read.issues };
    const keys = read.keys;
    if (!keys.length) return { ok: false, issues: [issue("animations." + kind, "ANIM_TRACK_MISSING", "找不到轨道")] };
    const idx = findKeyIndex(keys, time);
    if (idx < 0) return { ok: false, issues: [issue("animations.key", "ANIM_KEY_MISSING", "找不到该时间的 key")] };
    const vi = isFiniteNum(valueIndex) ? valueIndex : 0;
    const opts = segment.componentWide === true ? { componentWide: true } : undefined;
    let res;
    let change;
    if (isObject(segment.points)) {
      res = lib.setControlPoints(keys, idx, vi, segment.points, opts);
      change = "points";
    } else {
      res = lib.setSegmentType(keys, idx, vi, segment.type, opts);
      change = "type:" + String(segment.type);
    }
    if (!res || res.ok !== true || !Array.isArray(res.value)) {
      const code = res && res.reason ? res.reason : "ANIM_CURVE_EDIT_UNSUPPORTED";
      return { ok: false, issues: [issue("animations." + kind + "." + ownerName + "." + field, code, "曲线写回被拒绝：" + code)] };
    }
    const before = JSON.stringify(keys);
    /* 契约 §1：linear 若让该 key 不再有任何分量带曲线，应删除 curve 字段本身。
       curve-edit 的「分量级 linear」为保留其它分量偏移会写共线控制点；单分量字段
       （如 rotate）没有别的分量，共线数组等价于删除 → 这里做一次归一。 */
    let outKeys = res.value;
    if (change === "type:linear") {
      const n = typeof lib.componentCount === "function" ? lib.componentCount(field, keys[idx]) : 0;
      const first = outKeys[idx];
      if (n === 1 && isObject(first) && Array.isArray(first.curve) && first.curve.length === 4) {
        const normalized = clone(outKeys);
        delete normalized[idx].curve;
        outKeys = normalized;
      }
    }
    const after = JSON.stringify(outKeys);
    return { ok: true, value: writeTrack(rawAnim, kind, ownerName, field, outKeys), change: change, unchanged: before === after, issues: [] };
  }

  /**
   * Graph 拖动 key：一次原子地改时间与数值（同轨时间冲突 / 超出时长 / 非法值全部拒绝）。
   * @param {object} values 与 setKeyValues 同格式（rotate: {value}, translate/scale: {x,y} ...）
   */
  function setKeyTimeValue(rawAnim, kind, ownerName, field, fromTime, toTime, values) {
    if (!isObject(values)) return { ok: false, issues: [issue("animations.key.value", "ANIM_KEY_VALUE", "key 值必须是对象")] };
    if (!isFiniteNum(toTime) || toTime < 0) {
      return { ok: false, issues: [issue("animations.key.time", "ANIM_KEY_TIME", "新时间必须是非负有限数")] };
    }
    const read = trackKeys(rawAnim, kind, ownerName, field);
    if (!read.ok) return { ok: false, issues: read.issues };
    const keys = read.keys;
    if (!keys.length) return { ok: false, issues: [issue("animations." + kind, "ANIM_TRACK_MISSING", "找不到轨道")] };
    const idx = findKeyIndex(keys, fromTime);
    if (idx < 0) return { ok: false, issues: [issue("animations.key", "ANIM_KEY_MISSING", "找不到该时间的 key")] };
    const dur = animDurationOf(rawAnim);
    if (toTime > dur + 1e-9) {
      return { ok: false, issues: [issue("animations.key.time", "ANIM_KEY_OVER_DURATION", "新时间超出动画时长 " + round(dur, 4) + "s")] };
    }
    /* 允许原地（时间不变）只改值 */
    for (let i = 0; i < keys.length; i++) {
      if (i === idx) continue;
      if (Math.abs((isFiniteNum(keys[i].time) ? keys[i].time : 0) - toTime) < DEFAULT_EPS) {
        return { ok: false, issues: [issue("animations.key.time", "ANIM_KEY_TIME_CONFLICT", "目标时间已有 key（" + round(toTime, 6) + "s）")] };
      }
    }
    const stringFields = field === "attachment" ? ["name"] : [];
    for (const f of Object.keys(values)) {
      const v = values[f];
      if (stringFields.indexOf(f) >= 0) {
        if (v !== null && v !== undefined && typeof v !== "string") {
          return { ok: false, issues: [issue("animations.key." + f, "ANIM_KEY_VALUE", f + " 必须是字符串或 null")] };
        }
        continue;
      }
      if (!isFiniteNum(v)) return { ok: false, issues: [issue("animations.key." + f, "ANIM_KEY_VALUE", f + " 必须是有限数字")] };
    }
    const next = clone(keys);
    const moved = next.splice(idx, 1)[0];
    moved.time = round(toTime, 6);
    applyKeyValues(moved, values, stringFields);
    next.push(moved);
    next.sort((a, b) => (a.time || 0) - (b.time || 0));
    return { ok: true, value: writeTrack(rawAnim, kind, ownerName, field, next), issues: [] };
  }

  const api = {
    API_VERSION: 1,
    BONE_FIELDS: BONE_FIELDS,
    ANIM_TIMELINE_KEYS: ANIM_TIMELINE_KEYS,
    boneFieldSpecs: boneFieldSpecs,

    animDurationOf: animDurationOf,
    draftBaseDuration: draftBaseDuration,
    scanTimelineKeys: scanTimelineKeys,
    scanTracks: scanTracks,

    scaleAnimationTimes: scaleAnimationTimes,
    scaleKeyList: scaleKeyList,
    scaleCurve: scaleCurve,

    retimeAllPrecheck: retimeAllPrecheck,
    retimeAll: retimeAll,
    IK_SCALED_FIELDS: IK_SCALED_FIELDS,

    upsertKey: upsertKey,
    removeKey: removeKey,
    retimeKey: retimeKey,
    setKeyValues: setKeyValues,
    /* P1（T20）：Graph 曲线/轨道读写 */
    trackKeys: trackKeys,
    setKeyCurve: setKeyCurve,
    setKeyTimeValue: setKeyTimeValue,
    findKeyIndex: findKeyIndex,
    sortedKeys: sortedKeys,

    relativeValues: relativeValues,
    relativeFromTrackValue: relativeFromTrackValue,

    applyAnimationDrafts: applyAnimationDrafts,
  };

  global.SpineAnimEdit = api;
  if (typeof window !== "undefined" && window.SpineAnimEdit !== api) window.SpineAnimEdit = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
