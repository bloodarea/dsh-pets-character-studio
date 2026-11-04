/*
 * spine-core.js —— 「内置人物包管理器」纯逻辑核心。
 *
 * 契约：docs/review/2026-11-01-spine/contract-task1.md A 节（A1–A9）。
 * 边界：零依赖、无 DOM / Image / canvas / fetch；Node 与浏览器均可直接加载。
 * 导出：globalThis.SpineCore = Object.freeze({...})（浏览器即 window.SpineCore）。
 *
 * 坐标约定：世界坐标 Y 向上；角度输入输出为度，内部三角函数用弧度。
 * 矩阵约定：Mat = {a,b,c,d,tx,ty}，x' = a*x + c*y + tx，y' = b*x + d*y + ty。
 *   （官方 spine-core 的 b/c 命名与本仓相反，比对官方数据时需交换 b/c。）
 *
 * 本期范围（A1）：region、mesh（刚性/加权）、一/二骨 IK 子集、linkedmesh、动画查看。
 * 不纳入求值：transform/path/physics 约束、clipping、sequence、deform 播放、槽位颜色动画、
 *   非 Normal/OnlyTranslation 的 inherit 模式。以上均检测并以 Issue 形式报告，不静默吞掉。
 */
(function (global) {
  "use strict";

  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;
  var EPS = 1e-9;
  var BEZIER_SEGMENTS = 9; // 与 4.2 CurveTimeline 的 18 个 float 采样表一致

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function wrap180(deg) {
    // 归一到 (-180, 180]，用于 IK 最短路旋转。
    var d = deg % 360;
    if (d > 180) d -= 360;
    else if (d <= -180) d += 360;
    return d;
  }

  // 官方 4.2 运行时把 timeline 的时间/值/控制点存进 Float32Array（Utils.newFloatArray）。
  // 复刻这一点：尤其是 key 时间，float32 舍入会影响 Timeline.search 在“恰好等于 key 时间”时的选段
  // （例如 JSON 的 0.6 存成 0.6000000238 > 查询 0.6，stepped 时间线会取到上一个 key）。
  function f32(v) {
    return typeof Math.fround === "function" ? Math.fround(v) : v;
  }

  function matIdentity() {
    return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  }

  function matMul(parent, local) {
    // parent * local：先 local，再 parent。
    return {
      a: parent.a * local.a + parent.c * local.b,
      b: parent.b * local.a + parent.d * local.b,
      c: parent.a * local.c + parent.c * local.d,
      d: parent.b * local.c + parent.d * local.d,
      tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
      ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
    };
  }

  function invert(mat, eps) {
    if (!mat) return null;
    var limit = eps === undefined ? 1e-10 : eps;
    var det = mat.a * mat.d - mat.b * mat.c;
    if (!isFinite(det) || Math.abs(det) <= limit) return null; // 不用 det||1e-6 假装可逆
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

  function transformPoint(mat, point) {
    return {
      x: mat.a * point.x + mat.c * point.y + mat.tx,
      y: mat.b * point.x + mat.d * point.y + mat.ty,
    };
  }

  function localMatrix(local) {
    var rx = (local.rotation + local.shearX) * DEG;
    var ry = (local.rotation + 90 + local.shearY) * DEG;
    var cosX = Math.cos(rx);
    var sinX = Math.sin(rx);
    var cosY = Math.cos(ry);
    var sinY = Math.sin(ry);
    return {
      a: cosX * local.scaleX,
      b: sinX * local.scaleX,
      c: cosY * local.scaleY,
      d: sinY * local.scaleY,
      tx: local.x,
      ty: local.y,
    };
  }

  /* ------------------------------------------------------------------ *
   * 解析错误 / Issue
   * ------------------------------------------------------------------ */

  function ParseError(code, path, message) {
    this.name = "SpineParseError";
    this.code = code;
    this.path = path;
    this.message = message;
  }
  ParseError.prototype = Object.create(Error.prototype);
  ParseError.prototype.constructor = ParseError;

  function hard(ctx, code, path, message) {
    throw new ParseError(code, path, message);
  }

  function warn(ctx, code, path, message) {
    ctx.issues.push({ severity: "warning", code: code, path: path, message: message });
  }

  function resultOk(value, issues) {
    return { ok: true, value: value, issues: issues || [] };
  }

  function resultFail(issues) {
    return { ok: false, issues: issues || [] };
  }

  function failResult(ctx, err) {
    if (err instanceof ParseError || (err && err.name === "SpineParseError")) {
      ctx.issues.push({ severity: "error", code: err.code, path: err.path, message: err.message });
    } else {
      ctx.issues.push({
        severity: "error",
        code: "internal.error",
        path: "",
        message: String(err && err.message ? err.message : err),
      });
    }
    return resultFail(ctx.issues);
  }

  /* 字段读取：undefined 取默认值；显式非法值直接硬错（A2「非有限数」）。 */
  function readNum(ctx, obj, key, def, path) {
    var v = obj ? obj[key] : undefined;
    if (v === undefined) return def;
    if (!isFiniteNumber(v)) hard(ctx, "number.invalid", path + "." + key, "必须是有限数字");
    return v;
  }

  function readInt(ctx, obj, key, def, path) {
    var v = readNum(ctx, obj, key, def, path);
    if (!Number.isInteger(v)) hard(ctx, "number.integer", path + "." + key, "必须是整数");
    return v;
  }

  function readStr(ctx, obj, key, def, path, allowNull) {
    var v = obj ? obj[key] : undefined;
    if (v === undefined) return def;
    if (v === null && allowNull) return null;
    if (typeof v !== "string") hard(ctx, "string.invalid", path + "." + key, "必须是字符串");
    return v;
  }

  function readBool(ctx, obj, key, def, path) {
    var v = obj ? obj[key] : undefined;
    if (v === undefined) return def;
    if (typeof v !== "boolean") hard(ctx, "boolean.invalid", path + "." + key, "必须是布尔值");
    return v;
  }

  function readArray(ctx, obj, key, path, required) {
    var v = obj ? obj[key] : undefined;
    if (v === undefined || v === null) {
      if (required) hard(ctx, "array.missing", path + "." + key, "缺少数组");
      return null;
    }
    if (!Array.isArray(v)) hard(ctx, "array.invalid", path + "." + key, "必须是数组");
    return v;
  }

  function readNumArray(ctx, obj, key, path, required) {
    var arr = readArray(ctx, obj, key, path, required);
    if (!arr) return null;
    var out = new Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
      if (!isFiniteNumber(arr[i])) {
        hard(ctx, "number.invalid", path + "." + key + "[" + i + "]", "必须是有限数字");
      }
      out[i] = arr[i];
    }
    return out;
  }

  function readObject(ctx, obj, key, path, required) {
    var v = obj ? obj[key] : undefined;
    if (v === undefined || v === null) {
      if (required) hard(ctx, "object.missing", path + "." + key, "缺少对象");
      return null;
    }
    if (!isObject(v)) hard(ctx, "object.invalid", path + "." + key, "必须是对象");
    return v;
  }

  /* ------------------------------------------------------------------ *
   * 曲线采样（4.2：控制点是绝对 (time,value)，双通道 8 个数）
   * ------------------------------------------------------------------ */

  /**
   * 复刻 4.2 CurveTimeline 的 9 点采样表（setBezier），再用线性插值求值（getBezierValue）。
   * 这样与官方运行时逐位一致，误差远小于 1e-3。
   */
  function buildBezierTable(time1, value1, cx1, cy1, cx2, cy2, time2, value2) {
    var table = new Float64Array(BEZIER_SEGMENTS * 2);
    var tmpx = (time1 - cx1 * 2 + cx2) * 0.03;
    var tmpy = (value1 - cy1 * 2 + cy2) * 0.03;
    var dddx = ((cx1 - cx2) * 3 - time1 + time2) * 0.006;
    var dddy = ((cy1 - cy2) * 3 - value1 + value2) * 0.006;
    var ddx = tmpx * 2 + dddx;
    var ddy = tmpy * 2 + dddy;
    var dx = (cx1 - time1) * 0.3 + tmpx + dddx * 0.16666667;
    var dy = (cy1 - value1) * 0.3 + tmpy + dddy * 0.16666667;
    var x = time1 + dx;
    var y = value1 + dy;
    for (var i = 0; i < BEZIER_SEGMENTS * 2; i += 2) {
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

  function bezierValue(table, keyTime, keyValue, nextTime, nextValue, time) {
    if (table[0] > time) {
      var span = table[0] - keyTime;
      if (Math.abs(span) <= EPS) return table[1];
      return keyValue + ((time - keyTime) / span) * (table[1] - keyValue);
    }
    for (var i = 2; i < table.length; i += 2) {
      if (table[i] >= time) {
        var x0 = table[i - 2];
        var y0 = table[i - 1];
        var dx = table[i] - x0;
        if (Math.abs(dx) <= EPS) return table[i + 1];
        return y0 + ((time - x0) / dx) * (table[i + 1] - y0);
      }
    }
    var lx = table[table.length - 2];
    var ly = table[table.length - 1];
    var ldx = nextTime - lx;
    if (Math.abs(ldx) <= EPS) return nextValue;
    return ly + ((time - lx) / ldx) * (nextValue - ly);
  }

  function fieldValue(key, field, def) {
    var v = key[field];
    return v === undefined || v === null ? def : v;
  }

  function curveFor(key, fieldIndex) {
    var curve = key.curve;
    if (!curve) return null;
    if (curve === "stepped") return "stepped";
    if (!Array.isArray(curve)) return null;
    var base = fieldIndex * 4;
    if (curve.length < base + 4) return null;
    var p = [];
    for (var i = 0; i < 4; i++) {
      var v = curve[base + i];
      if (!isFiniteNumber(v)) return null;
      p.push(f32(v));
    }
    return p;
  }

  /**
   * sampleTrack(keys, t, fields, defaults) -> number[]
   * keys: 原始 JSON key 数组（或解析时归一化过的 key 数组）。
   * fields: 字段名数组（如 ['x','y'] / ['value'] / ['mix','softness']）。
   * defaults: 首 key 之前的返回值（A2「首 key 之前返回 setup 默认」）。
   */
  function sampleTrack(keys, t, fields, defaults) {
    var nf = fields.length;
    var out = new Array(nf);
    var i;
    var defs = defaults || [];
    if (!Array.isArray(keys) || keys.length === 0) {
      for (i = 0; i < nf; i++) out[i] = defs[i] === undefined ? 0 : defs[i];
      return out;
    }
    var time = isFiniteNumber(t) ? t : 0;
    var times = new Array(keys.length);
    for (i = 0; i < keys.length; i++) times[i] = f32(keys[i].time);
    if (time < times[0]) {
      for (i = 0; i < nf; i++) out[i] = defs[i] === undefined ? 0 : defs[i];
      return out;
    }
    var idx = keys.length - 1;
    for (i = 0; i < keys.length - 1; i++) {
      if (time < times[i + 1]) {
        idx = i;
        break;
      }
    }
    var a = keys[idx];
    var b = keys[idx + 1] || null;
    var ta = times[idx];
    var tb = b ? times[idx + 1] : 0;
    for (var fi = 0; fi < nf; fi++) {
      var field = fields[fi];
      var def = defs[fi] === undefined ? 0 : defs[fi];
      var va = f32(fieldValue(a, field, def));
      if (!b) {
        out[fi] = va;
        continue;
      }
      var curve = curveFor(a, fi);
      if (curve === "stepped") {
        out[fi] = va;
      } else if (curve) {
        var vb = f32(fieldValue(b, field, def));
        var table = buildBezierTable(ta, va, f32(curve[0]), f32(curve[1]), f32(curve[2]), f32(curve[3]), tb, vb);
        out[fi] = bezierValue(table, ta, va, tb, vb, time);
      } else {
        var vb2 = f32(fieldValue(b, field, def));
        var span = tb - ta;
        var f = span <= EPS ? 1 : (time - ta) / span;
        out[fi] = va + (vb2 - va) * f;
      }
    }
    return out;
  }

  function steppedValue(keys, t, field, def) {
    if (!Array.isArray(keys) || keys.length === 0) return def;
    var time = isFiniteNumber(t) ? t : 0;
    if (time < f32(keys[0].time)) return def;
    var value = def;
    for (var i = 0; i < keys.length; i++) {
      if (f32(keys[i].time) > time) break;
      value = f32(fieldValue(keys[i], field, def));
    }
    return value;
  }

  function sampleAttachmentName(keys, t, setupName) {
    if (!Array.isArray(keys) || keys.length === 0) return setupName;
    var time = isFiniteNumber(t) ? t : 0;
    if (time < f32(keys[0].time)) return setupName;
    var name = setupName;
    for (var i = 0; i < keys.length; i++) {
      if (f32(keys[i].time) > time) break;
      // name:null / 缺 name key 表示卸载，不能用 || 回退（A2）。
      name = keys[i].name === undefined ? null : keys[i].name;
    }
    return name;
  }

  /* ------------------------------------------------------------------ *
   * atlas
   * ------------------------------------------------------------------ */

  function applyPageField(ctx, page, entry, path) {
    var key = entry.key;
    var vals = entry.vals;
    switch (key) {
      case "size":
        if (vals.length < 2) hard(ctx, "atlas.page.size", path, "size 需要 2 个整数");
        page.width = parseInt(vals[0], 10);
        page.height = parseInt(vals[1], 10);
        if (!isFinite(page.width) || !isFinite(page.height) || page.width < 0 || page.height < 0) {
          hard(ctx, "atlas.page.size", path, "size 必须是非负整数");
        }
        break;
      case "filter":
        page.filter = { min: vals[0] || null, mag: vals[1] || vals[0] || null };
        break;
      case "pma":
        page.pma = vals[0] === "true";
        if (page.pma) warn(ctx, "atlas.pma.unsupported", path, "图集使用 PMA（预乘 alpha），本期按普通 alpha 采样");
        break;
      case "repeat":
        page.repeat = vals[0] || null;
        warn(ctx, "atlas.repeat.unsupported", path, "图集使用 repeat 平铺，本期按 clamp 采样");
        break;
      case "format":
      case "scale":
        // format 与 scale 仅元数据；scale 由导出器写入，运行时不需要。
        break;
      default:
        // 未知页字段静默忽略（与官方一致）。
        break;
    }
  }

  function applyRegionField(ctx, region, entry, path) {
    var key = entry.key;
    var vals = entry.vals;
    var num = function (i) {
      var v = parseInt(vals[i], 10);
      if (!isFinite(v)) hard(ctx, "atlas.region.number", path, key + " 含非整数");
      return v;
    };
    switch (key) {
      case "bounds":
        if (vals.length < 4) hard(ctx, "atlas.region.bounds", path, "bounds 需要 4 个整数");
        region.x = num(0);
        region.y = num(1);
        region.w = num(2);
        region.h = num(3);
        region.hasBounds = true;
        break;
      case "xy":
        region.x = num(0);
        region.y = num(1);
        region.hasBounds = true;
        break;
      case "size":
        region.w = num(0);
        region.h = num(1);
        region.hasBounds = true;
        break;
      case "offsets":
        if (vals.length < 4) hard(ctx, "atlas.region.offsets", path, "offsets 需要 4 个整数");
        region.offsetX = num(0);
        region.offsetY = num(1);
        region.originalW = num(2);
        region.originalH = num(3);
        break;
      case "offset":
        region.offsetX = num(0);
        region.offsetY = num(1);
        break;
      case "orig":
        region.originalW = num(0);
        region.originalH = num(1);
        break;
      case "rotate": {
        var raw = vals[0];
        var deg = raw === "true" ? 90 : raw === "false" ? 0 : parseInt(raw, 10);
        if (deg !== 0 && deg !== 90 && deg !== 180 && deg !== 270) {
          warn(ctx, "atlas.rotate.unsupported", path, "不支持的 rotate=" + raw + "，按 0° 处理");
          deg = 0;
        }
        region.rotate = deg;
        break;
      }
      case "index":
        region.index = num(0);
        break;
      default:
        break;
    }
  }

  function splitAtlasEntry(line) {
    // 官方 TextureAtlasReader.readEntry：按第一个 ':' 与逗号切分，最多 4 个值。
    var text = line.trim();
    if (!text) return null;
    var colon = text.indexOf(":");
    if (colon < 0) return null;
    var key = text.substring(0, colon).trim();
    if (!key) return null;
    var rest = text.substring(colon + 1);
    var vals = [];
    var start = 0;
    for (var i = 0; i <= rest.length && vals.length < 4; i++) {
      if (i === rest.length || rest.charAt(i) === ",") {
        vals.push(rest.substring(start, i).trim());
        start = i + 1;
      }
    }
    return { key: key, vals: vals };
  }

  function parseAtlas(text) {
    var ctx = { issues: [] };
    try {
      if (typeof text !== "string") hard(ctx, "atlas.text", "", "atlas 必须是字符串");
      var lines = text.split(/\r\n|\r|\n/);
      var pages = [];
      var regions = new Map();
      var page = null;
      var region = null;
      var i = 0;

      // 跳过首个条目之前的空行，并忽略文件头 key:value（与官方一致）。
      while (i < lines.length && !lines[i].trim()) i++;
      while (i < lines.length && splitAtlasEntry(lines[i])) i++;

      var line = i < lines.length ? lines[i++] : null;
      while (line !== null) {
        if (!line.trim()) {
          page = null;
          region = null;
          line = i < lines.length ? lines[i++] : null;
          continue;
        }
        var entry = splitAtlasEntry(line);
        if (!page) {
          page = {
            name: line.trim(),
            width: 0,
            height: 0,
            pma: false,
            filter: null,
            repeat: null,
          };
          pages.push(page);
          line = i < lines.length ? lines[i++] : null;
          while (line !== null) {
            entry = splitAtlasEntry(line);
            if (!entry) break;
            applyPageField(ctx, page, entry, "atlas.pages[" + (pages.length - 1) + "]");
            line = i < lines.length ? lines[i++] : null;
          }
          continue;
        }
        if (entry) {
          // 容错：页字段之后直接出现字段行（缺 region 名）时忽略。
          warn(ctx, "atlas.region.orphanField", "atlas", "字段 " + entry.key + " 出现在 region 名之前，已忽略");
          line = i < lines.length ? lines[i++] : null;
          continue;
        }
        region = {
          name: line.trim(),
          pageIndex: pages.length - 1,
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          rotate: 0,
          offsetX: 0,
          offsetY: 0,
          originalW: 0,
          originalH: 0,
          index: 0,
          hasBounds: false,
        };
        var regionPath = "atlas.regions[" + regions.size + "](" + region.name + ")";
        line = i < lines.length ? lines[i++] : null;
        while (line !== null) {
          entry = splitAtlasEntry(line);
          if (!entry) break;
          applyRegionField(ctx, region, entry, regionPath);
          line = i < lines.length ? lines[i++] : null;
        }
        if (!region.hasBounds) {
          warn(ctx, "atlas.region.bounds", regionPath, "region 缺少 bounds/xy/size，尺寸按 0 处理");
        }
        if (region.w <= 0 || region.h <= 0) {
          warn(ctx, "atlas.region.size", regionPath, "region 裁剪尺寸必须为正");
        }
        if (!region.originalW && !region.originalH) {
          region.originalW = region.w;
          region.originalH = region.h;
        } else {
          if (!region.originalW) region.originalW = region.w;
          if (!region.originalH) region.originalH = region.h;
        }
        if (regions.has(region.name)) {
          warn(ctx, "atlas.region.duplicate", regionPath, "重复的 region 名，后者覆盖前者");
        }
        regions.set(region.name, region);
      }
      return resultOk({ pages: pages, regions: regions }, ctx.issues);
    } catch (err) {
      return failResult(ctx, err);
    }
  }

  /* ------------------------------------------------------------------ *
   * model 解析
   * ------------------------------------------------------------------ */

  var INHERIT_ALIASES = {
    normal: "normal",
    onlytranslation: "onlyTranslation",
    norotationorreflection: "noRotationOrReflection",
    noscale: "noScale",
    noscaleorreflection: "noScaleOrReflection",
  };

  var SUPPORTED_INHERIT = { normal: true, onlyTranslation: true };

  function normalizeInherit(ctx, rawBone, path) {
    var value = rawBone ? rawBone.inherit : undefined;
    var legacy = false;
    if (value === undefined) {
      value = rawBone ? rawBone.transform : undefined;
      legacy = value !== undefined;
    }
    if (value === undefined || value === null) return "normal";
    if (typeof value !== "string") hard(ctx, "bone.inherit", path, "inherit 必须是字符串");
    var mapped = INHERIT_ALIASES[value.toLowerCase()];
    if (!mapped) {
      warn(ctx, "bone.inherit.unknown", path, "未知 inherit=" + value + "，按 Normal 求值");
      return "normal";
    }
    if (legacy) warn(ctx, "bone.inherit.legacy", path, "使用旧 transform 字段声明 inherit，已按 4.2 inherit 兼容");
    return mapped;
  }

  function parseBones(ctx, rawBones, boneIndex) {
    var bones = [];
    var names = [];
    var i;
    for (i = 0; i < rawBones.length; i++) {
      var path = "bones[" + i + "]";
      var map = rawBones[i];
      if (!isObject(map)) hard(ctx, "bone.invalid", path, "骨必须是对象");
      var name = readStr(ctx, map, "name", undefined, path);
      if (!name) hard(ctx, "bone.name", path, "骨必须有非空 name");
      if (boneIndex.has(name)) hard(ctx, "bone.duplicateName", path, "重复的骨名 " + name);
      names.push(name);
      boneIndex.set(name, i);
      var inherit = normalizeInherit(ctx, map, path);
      var bone = {
        name: name,
        parentIndex: -1,
        parentName: readStr(ctx, map, "parent", null, path, true),
        length: readNum(ctx, map, "length", 0, path),
        x: readNum(ctx, map, "x", 0, path),
        y: readNum(ctx, map, "y", 0, path),
        rotation: readNum(ctx, map, "rotation", 0, path),
        scaleX: readNum(ctx, map, "scaleX", 1, path),
        scaleY: readNum(ctx, map, "scaleY", 1, path),
        shearX: readNum(ctx, map, "shearX", 0, path),
        shearY: readNum(ctx, map, "shearY", 0, path),
        inherit: inherit,
        rawRef: map,
      };
      if (bone.length < 0) warn(ctx, "bone.length", path, "length 为负，按 0 长度处理");
      if (!SUPPORTED_INHERIT[inherit]) {
        warn(
          ctx,
          "bone.inherit.unsupported",
          path,
          "骨 " + name + " 的 inherit=" + inherit + " 本期未支持，按 Normal 预览（部分预览）"
        );
      }
      bones.push(bone);
    }
    // 第二轮解析父骨；父骨允许出现在子骨之后，但必须存在。
    for (i = 0; i < bones.length; i++) {
      var pname = bones[i].parentName;
      if (pname === null) continue;
      var pidx = boneIndex.get(pname);
      if (pidx === undefined) hard(ctx, "bone.parentMissing", "bones[" + i + "]", "找不到父骨 " + pname);
      if (pidx === i) hard(ctx, "bone.cycle", "bones[" + i + "]", "骨不能以自身为父骨");
      bones[i].parentIndex = pidx;
    }
    return bones;
  }

  function computeTopo(ctx, bones) {
    var n = bones.length;
    var state = new Uint8Array(n); // 0 未访问，1 访问中，2 完成
    var topo = [];
    var visit = function (idx, stack) {
      if (state[idx] === 2) return;
      if (state[idx] === 1) {
        hard(ctx, "bone.cycle", "bones[" + idx + "]", "骨层级存在循环：" + stack.concat(idx).join(" -> "));
      }
      state[idx] = 1;
      var parent = bones[idx].parentIndex;
      if (parent >= 0) visit(parent, stack.concat(idx));
      state[idx] = 2;
      topo.push(idx);
    };
    for (var i = 0; i < n; i++) visit(i, []);
    return topo;
  }

  function parseSlots(ctx, rawSlots, bones, boneIndex) {
    var slots = [];
    var slotIndex = new Map();
    if (!rawSlots) return { slots: slots, slotIndex: slotIndex };
    for (var i = 0; i < rawSlots.length; i++) {
      var path = "slots[" + i + "]";
      var map = rawSlots[i];
      if (!isObject(map)) hard(ctx, "slot.invalid", path, "slot 必须是对象");
      var name = readStr(ctx, map, "name", undefined, path);
      if (!name) hard(ctx, "slot.name", path, "slot 必须有非空 name");
      if (slotIndex.has(name)) hard(ctx, "slot.duplicateName", path, "重复的 slot 名 " + name);
      var boneName = readStr(ctx, map, "bone", undefined, path);
      if (!boneName) hard(ctx, "slot.bone", path, "slot 必须指定 bone");
      var boneIdx = boneIndex.get(boneName);
      if (boneIdx === undefined) hard(ctx, "slot.boneMissing", path, "找不到骨 " + boneName);
      var setupAttachment = readStr(ctx, map, "attachment", null, path, true);
      slotIndex.set(name, i);
      slots.push({
        name: name,
        boneIndex: boneIdx,
        setupAttachment: setupAttachment,
        rawIndex: i,
        rawRef: map,
      });
    }
    return { slots: slots, slotIndex: slotIndex };
  }

  function parseIK(ctx, rawIK, bones, boneIndex, model) {
    var constraints = [];
    if (!rawIK) return constraints;
    var seen = new Map();
    for (var i = 0; i < rawIK.length; i++) {
      var path = "ik[" + i + "]";
      var map = rawIK[i];
      if (!isObject(map)) hard(ctx, "ik.invalid", path, "IK 约束必须是对象");
      var name = readStr(ctx, map, "name", undefined, path);
      if (!name) hard(ctx, "ik.name", path, "IK 约束必须有非空 name");
      if (seen.has(name)) hard(ctx, "ik.duplicateName", path, "重复的 IK 约束名 " + name);
      seen.set(name, i);
      var boneNames = readArray(ctx, map, "bones", path, true);
      if (boneNames.length !== 1 && boneNames.length !== 2) {
        hard(ctx, "ik.bones.count", path, "IK bones 只支持 1 或 2 根");
      }
      var indices = [];
      for (var b = 0; b < boneNames.length; b++) {
        if (typeof boneNames[b] !== "string") hard(ctx, "ik.bones.name", path, "IK bones 必须是骨名字符串");
        var idx = boneIndex.get(boneNames[b]);
        if (idx === undefined) hard(ctx, "ik.bones.missing", path, "找不到骨 " + boneNames[b]);
        indices.push(idx);
      }
      if (indices.length === 2 && bones[indices[1]].parentIndex !== indices[0]) {
        hard(ctx, "ik.bones.notParentChild", path, "两骨 IK 必须是直接父子关系（" + boneNames.join(" -> ") + "）");
      }
      var targetName = readStr(ctx, map, "target", undefined, path);
      if (!targetName) hard(ctx, "ik.target", path, "IK 约束必须指定 target");
      var target = boneIndex.get(targetName);
      if (target === undefined) hard(ctx, "ik.targetMissing", path, "找不到 target 骨 " + targetName);
      var mix = readNum(ctx, map, "mix", 1, path);
      var softness = readNum(ctx, map, "softness", 0, path);
      if (mix < 0 || mix > 1) warn(ctx, "ik.mix", path, "mix 超出 0..1，按 0..1 夹取");
      if (softness < 0) warn(ctx, "ik.softness", path, "softness 为负，按 0 处理");
      var bendPositive = readBool(ctx, map, "bendPositive", true, path);
      var compress = readBool(ctx, map, "compress", false, path);
      var stretch = readBool(ctx, map, "stretch", false, path);
      var constraint = {
        name: name,
        index: i,
        order: readNum(ctx, map, "order", 0, path),
        bones: indices,
        target: target,
        // 当前帧值（每次 evalPose 先从 setup 恢复，再套 IK 时间线；避免跨帧累积）
        mix: clamp(mix, 0, 1),
        softness: Math.max(0, softness),
        bendPositive: bendPositive,
        compress: compress,
        stretch: stretch,
        uniform: readBool(ctx, map, "uniform", false, path),
        // setup 值
        setupMix: clamp(mix, 0, 1),
        setupSoftness: Math.max(0, softness),
        setupBendPositive: bendPositive,
        setupCompress: compress,
        setupStretch: stretch,
        rawRef: map,
      };
      if (indices.length === 1 && bones[indices[0]].parentIndex < 0) {
        warn(ctx, "ik.bone.noParent", path, "一骨 IK 的骨 " + bones[indices[0]].name + " 没有父骨，无法求解");
      }
      constraints.push(constraint);
    }
    return constraints;
  }

  function parseRegionAttachment(ctx, map, attName, path, slotIndex, skinName, slotName, atlas) {
    var regionPath = readStr(ctx, map, "path", attName, path);
    var region = atlas && atlas.regions ? atlas.regions.get(regionPath) : null;
    if (!region) {
      warn(ctx, "attachment.regionMissing", path, "atlas 中找不到 region " + regionPath + "，该附件不会绘制");
    }
    var width = readNum(ctx, map, "width", 0, path);
    var height = readNum(ctx, map, "height", 0, path);
    if (!(width > 0) || !(height > 0)) {
      warn(ctx, "attachment.region.size", path, "region 附件 width/height 必须为正");
    }
    var scaleX = readNum(ctx, map, "scaleX", 1, path);
    var scaleY = readNum(ctx, map, "scaleY", 1, path);
    var rotation = readNum(ctx, map, "rotation", 0, path);
    var ax = readNum(ctx, map, "x", 0, path);
    var ay = readNum(ctx, map, "y", 0, path);
    var trim = region
      ? {
          offX: region.offsetX,
          offY: region.offsetY,
          origW: region.originalW || region.w,
          origH: region.originalH || region.h,
          rw: region.w,
          rh: region.h,
        }
      : { offX: 0, offY: 0, origW: width, origH: height, rw: width, rh: height };
    var ratioX = trim.origW > 0 ? (width / trim.origW) * scaleX : 0;
    var ratioY = trim.origH > 0 ? (height / trim.origH) * scaleY : 0;
    var left = (-width / 2) * scaleX + trim.offX * ratioX;
    var right = left + trim.rw * ratioX;
    var bottom = (-height / 2) * scaleY + trim.offY * ratioY;
    var top = bottom + trim.rh * ratioY;
    var cos = Math.cos(rotation * DEG);
    var sin = Math.sin(rotation * DEG);
    var place = function (lx, ly) {
      return { x: lx * cos - ly * sin + ax, y: lx * sin + ly * cos + ay };
    };
    var p0 = place(left, bottom); // BL
    var p1 = place(left, top); // TL
    var p2 = place(right, top); // TR
    var p3 = place(right, bottom); // BR
    var localXY = new Float64Array([p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y]);
    var u0 = trim.origW > 0 ? trim.offX / trim.origW : 0;
    var u1 = trim.origW > 0 ? (trim.offX + trim.rw) / trim.origW : 1;
    var v0 = trim.origH > 0 ? (trim.origH - trim.offY) / trim.origH : 1;
    var v1 = trim.origH > 0 ? (trim.origH - trim.offY - trim.rh) / trim.origH : 0;
    var uv = new Float64Array([u0, v0, u0, v1, u1, v1, u1, v0]);
    return {
      id: skinName + "/" + slotName + "/" + attName,
      type: "region",
      path: regionPath,
      region: region,
      slotIndex: slotIndex,
      weighted: false,
      vertexCount: 4,
      localXY: localXY,
      influences: null,
      uv: uv,
      triangles: new Uint32Array([0, 1, 2, 2, 3, 0]),
      hullCount: 4,
      edges: new Uint32Array(0),
      width: width,
      height: height,
      x: ax,
      y: ay,
      rotation: rotation,
      scaleX: scaleX,
      scaleY: scaleY,
      slotBoneName: null, // 由 parseSkin 补
      rawRef: map,
    };
  }

  function decodeWeightedVertices(ctx, vertices, vertexCount, bones, boneIndex, path) {
    var influences = new Array(vertexCount);
    var p = 0;
    for (var v = 0; v < vertexCount; v++) {
      if (p >= vertices.length) {
        hard(ctx, "mesh.vertices.remainder", path, "加权顶点在 v=" + v + " 处截断");
      }
      var count = vertices[p++];
      if (!Number.isInteger(count) || count <= 0) {
        hard(ctx, "mesh.influence.count", path, "顶点 v=" + v + " 的 influence 数量必须是正整数");
      }
      if (p + count * 4 > vertices.length) {
        hard(ctx, "mesh.vertices.remainder", path, "顶点 v=" + v + " 的 influence 数据不足");
      }
      var list = new Array(count);
      var sum = 0;
      for (var k = 0; k < count; k++) {
        var boneIdx = vertices[p];
        var ix = vertices[p + 1];
        var iy = vertices[p + 2];
        var weight = vertices[p + 3];
        p += 4;
        if (!Number.isInteger(boneIdx) || boneIdx < 0 || boneIdx >= bones.length) {
          hard(ctx, "mesh.influence.boneIndex", path, "顶点 v=" + v + " 的骨索引非法：" + boneIdx);
        }
        if (weight < 0) hard(ctx, "mesh.influence.weight", path, "顶点 v=" + v + " 的权重为负");
        sum += weight;
        list[k] = {
          boneIndex: boneIdx,
          boneName: bones[boneIdx].name,
          x: ix,
          y: iy,
          weight: weight,
        };
      }
      if (!(sum > 1e-6)) {
        hard(ctx, "mesh.weights.zero", path, "顶点 v=" + v + " 的权重和为 0");
      }
      if (Math.abs(sum - 1) > 1e-3) {
        warn(
          ctx,
          "mesh.weights.sum",
          path,
          "顶点 v=" + v + " 的权重和为 " + sum.toFixed(6) + "（容差 1e-3），颜色显示时归一化"
        );
      }
      influences[v] = list;
    }
    if (p !== vertices.length) {
      hard(ctx, "mesh.vertices.remainder", path, "加权顶点解码后仍有 " + (vertices.length - p) + " 个多余分量");
    }
    return influences;
  }

  function parseMeshAttachment(ctx, map, attName, path, slotIndex, skinName, slotName, atlas, bones, boneIndex) {
    var regionPath = readStr(ctx, map, "path", attName, path);
    var region = atlas && atlas.regions ? atlas.regions.get(regionPath) : null;
    if (!region) {
      warn(ctx, "attachment.regionMissing", path, "atlas 中找不到 region " + regionPath + "，该附件不会绘制");
    }
    var uvs = readNumArray(ctx, map, "uvs", path, true);
    if (!uvs || uvs.length === 0) hard(ctx, "mesh.uvs.empty", path, "mesh 缺少 uvs 或 uvs 为空");
    if (uvs.length % 2 !== 0) hard(ctx, "mesh.uvs.odd", path, "uvs 长度必须是偶数");
    var vertexCount = uvs.length / 2;
    var vertices = readNumArray(ctx, map, "vertices", path, true);
    if (!vertices) hard(ctx, "mesh.vertices.missing", path, "mesh 缺少 vertices");
    var weighted = vertices.length !== vertexCount * 2;
    var localXY = null;
    var influences = null;
    if (weighted) {
      influences = decodeWeightedVertices(ctx, vertices, vertexCount, bones, boneIndex, path);
    } else {
      localXY = Float64Array.from(vertices);
    }
    var triangles = readNumArray(ctx, map, "triangles", path, true);
    if (!triangles || triangles.length % 3 !== 0) hard(ctx, "mesh.triangles.count", path, "triangles 长度必须是 3 的倍数");
    for (var t = 0; t < triangles.length; t++) {
      if (!Number.isInteger(triangles[t]) || triangles[t] < 0 || triangles[t] >= vertexCount) {
        hard(ctx, "mesh.triangles.index", path, "三角形顶点索引越界：" + triangles[t] + "（顶点数 " + vertexCount + "）");
      }
    }
    var hull = readNum(ctx, map, "hull", 0, path);
    if (!Number.isInteger(hull) || hull < 0 || hull > vertexCount) {
      warn(ctx, "mesh.hull.invalid", path, "hull 必须是 0.." + vertexCount + " 的整数，按 0 处理");
      hull = 0;
    }
    var edgesRaw = readNumArray(ctx, map, "edges", path, false) || [];
    if (edgesRaw.length % 2 !== 0) {
      warn(ctx, "mesh.edges.count", path, "edges 长度应为偶数（每边两个标量偏移）");
    }
    var edges = [];
    for (var e = 0; e < edgesRaw.length; e++) {
      var scalar = edgesRaw[e];
      if (!Number.isInteger(scalar) || scalar < 0 || scalar >= vertexCount * 2) {
        warn(ctx, "mesh.edges.index", path, "edges 标量偏移越界：" + scalar + "（应 < " + vertexCount * 2 + "）");
        continue;
      }
      if (scalar % 2 !== 0) {
        warn(ctx, "mesh.edges.odd", path, "edges 标量偏移 " + scalar + " 不是偶数，无法转成顶点索引，已跳过");
        continue;
      }
      edges.push(scalar / 2);
    }
    return {
      id: skinName + "/" + slotName + "/" + attName,
      type: "mesh",
      path: regionPath,
      region: region,
      slotIndex: slotIndex,
      weighted: weighted,
      vertexCount: vertexCount,
      localXY: localXY,
      influences: influences,
      uv: Float64Array.from(uvs),
      triangles: Uint32Array.from(triangles),
      hullCount: hull,
      edges: Uint32Array.from(edges),
      width: readNum(ctx, map, "width", 0, path),
      height: readNum(ctx, map, "height", 0, path),
      slotBoneName: null,
      rawRef: map,
    };
  }

  function parseSkinAttachments(ctx, rawSkin, skinName, model, atlas, pendingLinked) {
    var skin = { name: skinName, attachments: new Map(), rawRef: rawSkin };
    var attsMap = rawSkin.attachments;
    if (attsMap === undefined || attsMap === null) return skin;
    if (!isObject(attsMap)) hard(ctx, "skin.attachments", "skins." + skinName + ".attachments", "attachments 必须是对象");
    var slotNames = Object.keys(attsMap);
    for (var s = 0; s < slotNames.length; s++) {
      var slotName = slotNames[s];
      var slotIndex = model.slotIndex.get(slotName);
      if (slotIndex === undefined) {
        warn(ctx, "skin.slotUnknown", "skins." + skinName + ".attachments." + slotName, "skin 引用了不存在的 slot，已跳过");
        continue;
      }
      var bagRaw = attsMap[slotName];
      if (!isObject(bagRaw)) hard(ctx, "skin.attachmentBag", "skins." + skinName + ".attachments." + slotName, "slot 附件必须是对象");
      var bag = new Map();
      var attNames = Object.keys(bagRaw);
      for (var a = 0; a < attNames.length; a++) {
        var attName = attNames[a];
        var path = "skins." + skinName + ".attachments." + slotName + "." + attName;
        var map = bagRaw[attName];
        if (!isObject(map)) hard(ctx, "attachment.invalid", path, "附件必须是对象");
        var type = readStr(ctx, map, "type", "region", path);
        if (type === "weightedmesh") {
          warn(ctx, "attachment.weightedmesh.alias", path, "weightedmesh 是旧称，按 4.2 mesh 解析");
          type = "mesh";
        }
        var attachment = null;
        if (type === "region") {
          if (map.sequence !== undefined) {
            warn(ctx, "attachment.sequence.unsupported", path, "sequence 附件本期按单帧预览");
            model.capabilities.unsupported.sequences++;
          }
          attachment = parseRegionAttachment(ctx, map, attName, path, slotIndex, skinName, slotName, atlas);
          attachment.slotBoneName = model.bones[model.slots[slotIndex].boneIndex].name;
        } else if (type === "mesh") {
          if (map.sequence !== undefined) {
            warn(ctx, "attachment.sequence.unsupported", path, "sequence 附件本期按单帧预览");
            model.capabilities.unsupported.sequences++;
          }
          if (map.parent !== undefined && map.parent !== null) {
            // 4.2 里 type=mesh 且带 parent 等同 linkedmesh。
            warn(ctx, "attachment.linkedmesh.asMesh", path, "type=mesh 且带 parent，按 linkedmesh 解析");
            attachment = parseLinkedMeshPlaceholder(ctx, map, attName, path, slotIndex, skinName, slotName, atlas);
            pendingLinked.push({ attachment: attachment, skinName: skinName, slotName: slotName, parent: readStr(ctx, map, "parent", undefined, path) });
          } else {
            attachment = parseMeshAttachment(ctx, map, attName, path, slotIndex, skinName, slotName, atlas, model.bones, model.boneIndex);
            attachment.slotBoneName = model.bones[model.slots[slotIndex].boneIndex].name;
          }
        } else if (type === "linkedmesh") {
          if (map.sequence !== undefined) {
            warn(ctx, "attachment.sequence.unsupported", path, "sequence 附件本期按单帧预览");
            model.capabilities.unsupported.sequences++;
          }
          attachment = parseLinkedMeshPlaceholder(ctx, map, attName, path, slotIndex, skinName, slotName, atlas);
          pendingLinked.push({ attachment: attachment, skinName: skinName, slotName: slotName, parent: readStr(ctx, map, "parent", undefined, path) });
        } else {
          warn(
            ctx,
            "attachment.unsupportedType",
            path,
            "不支持的附件类型 " + type + "（本期仅 region/mesh/linkedmesh），已跳过"
          );
          model.capabilities.unsupported.attachments[type] = (model.capabilities.unsupported.attachments[type] || 0) + 1;
          continue;
        }
        bag.set(attName, attachment);
        model.attachments.set(attachment.id, attachment);
      }
      skin.attachments.set(slotIndex, bag);
    }
    return skin;
  }

  function parseLinkedMeshPlaceholder(ctx, map, attName, path, slotIndex, skinName, slotName, atlas) {
    var regionPath = readStr(ctx, map, "path", attName, path);
    var region = atlas && atlas.regions ? atlas.regions.get(regionPath) : null;
    return {
      id: skinName + "/" + slotName + "/" + attName,
      type: "mesh",
      path: regionPath,
      region: region,
      slotIndex: slotIndex,
      weighted: false,
      vertexCount: 0,
      localXY: null,
      influences: null,
      uv: new Float64Array(0),
      triangles: new Uint32Array(0),
      hullCount: 0,
      edges: new Uint32Array(0),
      width: readNum(ctx, map, "width", 0, path),
      height: readNum(ctx, map, "height", 0, path),
      slotBoneName: null,
      rawRef: map,
      linked: true,
    };
  }

  function resolveLinkedMeshes(ctx, model, pending) {
    var resolving = new Set();
    var resolved = new Set();
    var resolve = function (item) {
      var att = item.attachment;
      if (resolved.has(att.id)) return;
      if (resolving.has(att.id)) {
        hard(ctx, "mesh.linkedmesh.cycle", "linkedmesh:" + att.id, "linkedmesh 引用成环");
      }
      resolving.add(att.id);
      var parentSkin = model.skins.get(item.skinName);
      if (!parentSkin) {
        hard(ctx, "mesh.linkedmesh.skin", "linkedmesh:" + att.id, "找不到 skin " + item.skinName);
      }
      var parentBag = parentSkin.attachments.get(att.slotIndex);
      var parent = parentBag ? parentBag.get(item.parent) : undefined;
      if (!parent) {
        hard(ctx, "mesh.linkedmesh.parentMissing", "linkedmesh:" + att.id, "找不到同 slot 的父 mesh " + item.parent);
      }
      if (parent.linked) {
        // 父级本身也是 linkedmesh：先解析它。
        var parentItem = null;
        for (var i = 0; i < pending.length; i++) {
          if (pending[i].attachment === parent) {
            parentItem = pending[i];
            break;
          }
        }
        if (!parentItem) hard(ctx, "mesh.linkedmesh.parentMissing", "linkedmesh:" + att.id, "父 linkedmesh 未登记");
        resolve(parentItem);
      }
      if (parent.type !== "mesh") {
        hard(ctx, "mesh.linkedmesh.parentType", "linkedmesh:" + att.id, "父附件不是 mesh：" + item.parent);
      }
      att.weighted = parent.weighted;
      att.vertexCount = parent.vertexCount;
      att.localXY = parent.localXY;
      att.influences = parent.influences;
      att.uv = parent.uv;
      att.triangles = parent.triangles;
      att.hullCount = parent.hullCount;
      att.edges = parent.edges;
      if (!att.region) {
        if (parent.region) {
          warn(ctx, "mesh.linkedmesh.regionFallback", "linkedmesh:" + att.id, "自身 region 缺失，沿用父 mesh 的 region");
          att.region = parent.region;
        } else {
          warn(ctx, "attachment.regionMissing", "linkedmesh:" + att.id, "linkedmesh 与父 mesh 都找不到 region");
        }
      } else if (parent.region && att.region !== parent.region) {
        warn(ctx, "mesh.linkedmesh.regionMismatch", "linkedmesh:" + att.id, "linkedmesh 与父 mesh 使用不同 region，共享几何可能错位");
      }
      att.slotBoneName = model.bones[model.slots[att.slotIndex].boneIndex].name;
      att.linked = false;
      resolving.delete(att.id);
      resolved.add(att.id);
    };
    for (var i = 0; i < pending.length; i++) resolve(pending[i]);
  }

  /* ---------------------------- 动画 ---------------------------- */

  function makeTrack(ctx, keysRaw, fields, keyDefaults, sampleDefaults, path) {
    if (!Array.isArray(keysRaw)) hard(ctx, "animation.keys", path, "timeline 必须是 key 数组");
    if (keysRaw.length === 0) {
      warn(ctx, "animation.keys.empty", path, "空 timeline，已忽略");
      return null;
    }
    var keys = new Array(keysRaw.length);
    for (var i = 0; i < keysRaw.length; i++) {
      var raw = keysRaw[i];
      if (!isObject(raw)) hard(ctx, "animation.key", path + "[" + i + "]", "key 必须是对象");
      var key = { time: f32(readNum(ctx, raw, "time", 0, path + "[" + i + "]")) };
      for (var f = 0; f < fields.length; f++) {
        key[fields[f]] = f32(readNum(ctx, raw, fields[f], keyDefaults[f], path + "[" + i + "]"));
      }
      if (raw.curve !== undefined) {
        if (raw.curve === "stepped") {
          key.curve = "stepped";
        } else if (Array.isArray(raw.curve)) {
          var need = fields.length * 4;
          var ok = raw.curve.length >= need;
          for (var c = 0; ok && c < need; c++) ok = isFiniteNumber(raw.curve[c]);
          if (!ok) {
            warn(ctx, "animation.curve.invalid", path + "[" + i + "]", "curve 控制点数量或数值非法，按线性处理");
          } else {
            key.curve = raw.curve.slice(0, need).map(f32);
          }
        } else {
          warn(ctx, "animation.curve.invalid", path + "[" + i + "]", "curve 必须是 'stepped' 或数字数组，按线性处理");
        }
      }
      keys[i] = key;
    }
    for (var j = 1; j < keys.length; j++) {
      if (keys[j].time < keys[j - 1].time) {
        warn(ctx, "animation.keys.order", path, "key 时间非递增，采样结果可能异常");
        break;
      }
    }
    return { keys: keys, fields: fields, defaults: sampleDefaults };
  }

  function makeSteppedTrack(ctx, keysRaw, field, keyDefault, setupValue, path) {
    if (!Array.isArray(keysRaw)) hard(ctx, "animation.keys", path, "timeline 必须是 key 数组");
    if (keysRaw.length === 0) return null;
    var keys = new Array(keysRaw.length);
    for (var i = 0; i < keysRaw.length; i++) {
      var raw = keysRaw[i];
      if (!isObject(raw)) hard(ctx, "animation.key", path + "[" + i + "]", "key 必须是对象");
      keys[i] = {
        time: f32(readNum(ctx, raw, "time", 0, path + "[" + i + "]")),
        value: readBool(ctx, raw, field, keyDefault, path + "[" + i + "])") ? 1 : 0,
      };
    }
    return { keys: keys, default: setupValue };
  }

  function maxKeyTime(keys) {
    var max = 0;
    if (!keys) return 0;
    for (var i = 0; i < keys.length; i++) {
      var t = f32(keys[i].time);
      if (t > max) max = t;
    }
    return max;
  }

  function trackMax(track) {
    return track ? maxKeyTime(track.keys) : 0;
  }

  function buildDrawOrder(ctx, offsets, slotIndexMap, slotCount, path) {
    if (offsets === undefined || offsets === null) return null;
    if (!Array.isArray(offsets)) hard(ctx, "animation.drawOrder", path, "offsets 必须是数组");
    var order = new Array(slotCount).fill(-1);
    var unchanged = [];
    var originalIndex = 0;
    for (var i = 0; i < offsets.length; i++) {
      var o = offsets[i];
      if (!isObject(o)) hard(ctx, "animation.drawOrder", path, "offset 必须是对象");
      var slotName = readStr(ctx, o, "slot", undefined, path);
      var slotIdx = slotIndexMap.get(slotName);
      if (slotIdx === undefined) {
        warn(ctx, "animation.drawOrder.slot", path, "drawOrder 引用不存在的 slot " + slotName + "，忽略该帧");
        return null;
      }
      var offset = readInt(ctx, o, "offset", 0, path);
      var dest = originalIndex + offset;
      if (dest < 0 || dest >= slotCount || order[dest] !== -1) {
        warn(ctx, "animation.drawOrder.offset", path, "drawOrder offset 越界或冲突，忽略该帧");
        return null;
      }
      while (originalIndex !== slotIdx) unchanged.push(originalIndex++);
      order[dest] = originalIndex++;
    }
    while (originalIndex < slotCount) unchanged.push(originalIndex++);
    for (var k = slotCount - 1; k >= 0; k--) {
      if (order[k] === -1) order[k] = unchanged.pop();
    }
    return order;
  }

  function parseAnimation(ctx, raw, name, model) {
    var anim = {
      name: name,
      duration: 0,
      bones: new Map(),
      slots: new Map(),
      ik: new Map(),
      drawOrder: null,
      hasTransform: false,
      hasDeform: false,
      hasPath: false,
      hasPhysics: false,
      hasEvents: false,
      hasSlotColor: false,
      rawRef: raw,
    };
    var path = "animations." + name;
    if (!isObject(raw)) hard(ctx, "animation.invalid", path, "动画必须是对象");

    if (raw.bones !== undefined) {
      var boneMap = readObject(ctx, raw, "bones", path, true);
      var boneNames = Object.keys(boneMap);
      for (var bi = 0; bi < boneNames.length; bi++) {
        var boneName = boneNames[bi];
        var boneIdx = model.boneIndex.get(boneName);
        var bpath = path + ".bones." + boneName;
        if (boneIdx === undefined) {
          warn(ctx, "animation.bone.missing", bpath, "动画引用不存在的骨，已跳过");
          continue;
        }
        var bag = boneMap[boneName];
        if (!isObject(bag)) hard(ctx, "animation.bone", bpath, "骨 timeline 必须是对象");
        var tracks = {};
        var fields = Object.keys(bag);
        for (var fi = 0; fi < fields.length; fi++) {
          var field = fields[fi];
          if (field === "rotate") {
            // 4.2 rotate timeline 的 value 是相对 setup 的增量（RotateTimeline.getRelativeValue）。
            tracks.rotate = makeTrack(ctx, bag[field], ["value"], [0], [0], bpath + ".rotate");
          } else if (field === "translate") {
            tracks.translate = makeTrack(ctx, bag[field], ["x", "y"], [0, 0], [0, 0], bpath + ".translate");
          } else if (field === "scale") {
            tracks.scale = makeTrack(ctx, bag[field], ["x", "y"], [1, 1], [1, 1], bpath + ".scale");
          } else if (field === "shear") {
            tracks.shear = makeTrack(ctx, bag[field], ["x", "y"], [0, 0], [0, 0], bpath + ".shear");
          } else if (field === "inherit") {
            warn(ctx, "animation.inherit.unsupported", bpath + ".inherit", "inherit 动画未求值（部分预览）");
          } else {
            warn(ctx, "animation.boneField.unknown", bpath + "." + field, "未知骨 timeline 字段，已忽略");
          }
        }
        var keysUsed = false;
        for (var tk in tracks) if (tracks[tk]) keysUsed = true;
        if (keysUsed) {
          anim.bones.set(boneIdx, tracks);
          anim.duration = Math.max(
            anim.duration,
            trackMax(tracks.rotate),
            trackMax(tracks.translate),
            trackMax(tracks.scale),
            trackMax(tracks.shear)
          );
        }
      }
    }

    if (raw.slots !== undefined) {
      var slotMap = readObject(ctx, raw, "slots", path, true);
      var slotNames = Object.keys(slotMap);
      for (var si = 0; si < slotNames.length; si++) {
        var slotName = slotNames[si];
        var slotIdx = model.slotIndex.get(slotName);
        var spath = path + ".slots." + slotName;
        if (slotIdx === undefined) {
          warn(ctx, "animation.slot.missing", spath, "动画引用不存在的 slot，已跳过");
          continue;
        }
        var slotBag = slotMap[slotName];
        if (!isObject(slotBag)) hard(ctx, "animation.slot", spath, "slot timeline 必须是对象");
        var slotTracks = {};
        var slotFields = Object.keys(slotBag);
        for (var sf = 0; sf < slotFields.length; sf++) {
          var slotField = slotFields[sf];
          if (slotField === "attachment") {
            var keysRaw = slotBag[slotField];
            if (!Array.isArray(keysRaw)) hard(ctx, "animation.keys", spath + ".attachment", "attachment timeline 必须是数组");
            var keys = new Array(keysRaw.length);
            for (var k = 0; k < keysRaw.length; k++) {
              if (!isObject(keysRaw[k])) hard(ctx, "animation.key", spath + ".attachment[" + k + "]", "key 必须是对象");
              var keyName = keysRaw[k].name;
              if (keyName !== undefined && keyName !== null && typeof keyName !== "string") {
                hard(ctx, "animation.key.name", spath + ".attachment[" + k + "]", "name 必须是字符串或 null");
              }
              keys[k] = {
                time: f32(readNum(ctx, keysRaw[k], "time", 0, spath + ".attachment[" + k + "]")),
                name: keyName === undefined ? null : keyName,
              };
            }
            slotTracks.attachment = { keys: keys, default: model.slots[slotIdx].setupAttachment };
            anim.duration = Math.max(anim.duration, maxKeyTime(keys));
          } else if (slotField === "color" || slotField === "rgba") {
            warn(ctx, "animation.slotColor.unsupported", spath + "." + slotField, "槽位颜色动画未求值（部分预览）");
            anim.hasSlotColor = true;
          } else {
            warn(ctx, "animation.slotField.unknown", spath + "." + slotField, "未知 slot timeline 字段，已忽略");
          }
        }
        if (Object.keys(slotTracks).length) anim.slots.set(slotIdx, slotTracks);
      }
    }

    if (raw.ik !== undefined) {
      var ikMap = readObject(ctx, raw, "ik", path, true);
      var ikNames = Object.keys(ikMap);
      var constraintByName = new Map();
      for (var ci = 0; ci < model.constraints.length; ci++) constraintByName.set(model.constraints[ci].name, model.constraints[ci]);
      for (var ii = 0; ii < ikNames.length; ii++) {
        var cname = ikNames[ii];
        var cpath = path + ".ik." + cname;
        var constraint = constraintByName.get(cname);
        if (!constraint) {
          warn(ctx, "animation.ik.missing", cpath, "动画引用不存在的 IK 约束，已跳过");
          continue;
        }
        var ikKeys = ikMap[cname];
        if (!Array.isArray(ikKeys)) hard(ctx, "animation.keys", cpath, "IK timeline 必须是数组");
        var continuous = makeTrack(
          ctx,
          ikKeys,
          ["mix", "softness"],
          [1, 0],
          [constraint.setupMix, constraint.setupSoftness],
          cpath
        );
        var ikTracks = {
          continuous: continuous,
          bendPositive: makeSteppedTrack(
            ctx,
            ikKeys,
            "bendPositive",
            true,
            constraint.setupBendPositive ? 1 : -1,
            cpath + ".bendPositive"
          ),
          compress: makeSteppedTrack(ctx, ikKeys, "compress", false, constraint.setupCompress ? 1 : 0, cpath + ".compress"),
          stretch: makeSteppedTrack(ctx, ikKeys, "stretch", false, constraint.setupStretch ? 1 : 0, cpath + ".stretch"),
        };
        anim.ik.set(constraint.index, ikTracks);
        anim.duration = Math.max(
          anim.duration,
          trackMax(continuous),
          maxKeyTime(ikTracks.bendPositive && ikTracks.bendPositive.keys),
          maxKeyTime(ikTracks.compress && ikTracks.compress.keys),
          maxKeyTime(ikTracks.stretch && ikTracks.stretch.keys)
        );
      }
    }

    if (raw.transform !== undefined) {
      anim.hasTransform = true;
      warn(ctx, "animation.transform.unsupported", path + ".transform", "transform 约束动画未求值（部分预览）");
    }
    if (raw.path !== undefined) {
      anim.hasPath = true;
      warn(ctx, "animation.path.unsupported", path + ".path", "path 约束动画未求值（部分预览）");
    }
    if (raw.physics !== undefined) {
      anim.hasPhysics = true;
      warn(ctx, "animation.physics.unsupported", path + ".physics", "physics 约束动画未求值（部分预览）");
    }
    if (raw.deform !== undefined) {
      anim.hasDeform = true;
      warn(ctx, "animation.deform.unsupported", path + ".deform", "旧式 deform 动画未求值（部分预览）");
    }
    if (raw.attachments !== undefined) {
      anim.hasDeform = true;
      warn(ctx, "animation.deform.unsupported", path + ".attachments", "形变动画未求值，按绑定网格预览（部分预览）");
    }

    if (raw.drawOrder !== undefined) {
      var doKeysRaw = raw.drawOrder;
      if (!Array.isArray(doKeysRaw)) hard(ctx, "animation.drawOrder", path + ".drawOrder", "drawOrder 必须是数组");
      var doKeys = new Array(doKeysRaw.length);
      for (var di = 0; di < doKeysRaw.length; di++) {
        var doKey = doKeysRaw[di];
        if (!isObject(doKey)) hard(ctx, "animation.drawOrder", path + ".drawOrder[" + di + "]", "drawOrder key 必须是对象");
        var order = buildDrawOrder(
          ctx,
          doKey.offsets,
          model.slotIndex,
          model.slots.length,
          path + ".drawOrder[" + di + "]"
        );
        if (!order) continue;
        doKeys[di] = { time: f32(readNum(ctx, doKey, "time", 0, path + ".drawOrder[" + di + "]")), order: order };
      }
      doKeys = doKeys.filter(Boolean);
      if (doKeys.length) {
        anim.drawOrder = { keys: doKeys };
        anim.duration = Math.max(anim.duration, maxKeyTime(doKeys));
      }
    }

    if (raw.events !== undefined) {
      anim.hasEvents = true;
      if (Array.isArray(raw.events)) {
        for (var ei = 0; ei < raw.events.length; ei++) {
          if (isObject(raw.events[ei])) {
            var et = raw.events[ei].time;
            if (isFiniteNumber(et)) anim.duration = Math.max(anim.duration, et);
          }
        }
      }
    }
    return anim;
  }

  function doParseModel(ctx, raw, atlas, opts) {
    if (atlas && atlas.ok === true && atlas.value) atlas = atlas.value;
    if (!isObject(raw)) hard(ctx, "model.invalid", "", "模型 JSON 必须是对象");
    if (!atlas || !atlas.regions || !Array.isArray(atlas.pages)) hard(ctx, "model.atlas", "", "缺少已解析的 atlas");

    var model = {
      raw: raw,
      skeleton: {
        hash: null,
        spine: null,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        fps: 0,
      },
      bones: [],
      boneIndex: new Map(),
      topo: [],
      slots: [],
      slotIndex: new Map(),
      skins: new Map(),
      attachments: new Map(),
      constraints: [],
      animations: new Map(),
      capabilities: {
        region: true,
        mesh: true,
        weightedMesh: false,
        linkedMesh: false,
        ik: false,
        unsupported: {
          transformConstraints: 0,
          pathConstraints: 0,
          physicsConstraints: 0,
          attachments: {},
          sequences: 0,
          deform: false,
          slotColor: false,
          drawOrder: false,
          unsupportedInherit: [],
        },
      },
      issues: [],
      defaultSkinName: null,
    };

    var skeletonMap = isObject(raw.skeleton) ? raw.skeleton : null;
    if (!skeletonMap) {
      warn(ctx, "model.skeleton.missing", "skeleton", "缺少 skeleton 段");
    } else {
      model.skeleton.hash = typeof skeletonMap.hash === "string" ? skeletonMap.hash : null;
      model.skeleton.spine = typeof skeletonMap.spine === "string" ? skeletonMap.spine : null;
      model.skeleton.x = readNum(ctx, skeletonMap, "x", 0, "skeleton");
      model.skeleton.y = readNum(ctx, skeletonMap, "y", 0, "skeleton");
      model.skeleton.width = readNum(ctx, skeletonMap, "width", 0, "skeleton");
      model.skeleton.height = readNum(ctx, skeletonMap, "height", 0, "skeleton");
      model.skeleton.fps = readNum(ctx, skeletonMap, "fps", 0, "skeleton");
      if (!model.skeleton.spine) {
        warn(ctx, "model.version.missing", "skeleton.spine", "缺少 spine 版本号，按 4.2 规则尝试解析");
      } else if (model.skeleton.spine.indexOf("4.2") !== 0) {
        warn(
          ctx,
          "model.version.unsupported",
          "skeleton.spine",
          "版本 " + model.skeleton.spine + " 不是 4.2，按 4.2 规则解析（部分预览）"
        );
      }
    }

    var rawBones = readArray(ctx, raw, "bones", "", true);
    model.bones = parseBones(ctx, rawBones, model.boneIndex);
    model.topo = computeTopo(ctx, model.bones);
    for (var ub = 0; ub < model.bones.length; ub++) {
      if (!SUPPORTED_INHERIT[model.bones[ub].inherit]) {
        model.capabilities.unsupported.unsupportedInherit.push(model.bones[ub].name);
      }
    }

    var slotResult = parseSlots(ctx, readArray(ctx, raw, "slots", "", false), model.bones, model.boneIndex);
    model.slots = slotResult.slots;
    model.slotIndex = slotResult.slotIndex;

    var rawIK = readArray(ctx, raw, "ik", "", false);
    model.constraints = parseIK(ctx, rawIK, model.bones, model.boneIndex, model);
    model.capabilities.ik = model.constraints.length > 0;

    if (raw.transform !== undefined) {
      var tc = readArray(ctx, raw, "transform", "", true);
      model.capabilities.unsupported.transformConstraints = tc.length;
      warn(ctx, "model.transform.unsupported", "transform", "含 " + tc.length + " 个 transform 约束，本期未求值（部分预览）");
    }
    if (raw.path !== undefined) {
      var pc = readArray(ctx, raw, "path", "", true);
      model.capabilities.unsupported.pathConstraints = pc.length;
      warn(ctx, "model.path.unsupported", "path", "含 " + pc.length + " 个 path 约束，本期未求值（部分预览）");
    }
    if (raw.physics !== undefined) {
      var phc = readArray(ctx, raw, "physics", "", true);
      model.capabilities.unsupported.physicsConstraints = phc.length;
      warn(ctx, "model.physics.unsupported", "physics", "含 " + phc.length + " 个 physics 约束，本期未求值（部分预览）");
    }

    var rawSkins = readArray(ctx, raw, "skins", "", false);
    var pendingLinked = [];
    if (!rawSkins || rawSkins.length === 0) {
      warn(ctx, "model.skins.empty", "skins", "模型没有 skin");
    } else {
      for (var si = 0; si < rawSkins.length; si++) {
        var rawSkin = rawSkins[si];
        if (!isObject(rawSkin)) hard(ctx, "skin.invalid", "skins[" + si + "]", "skin 必须是对象");
        var skinName = readStr(ctx, rawSkin, "name", undefined, "skins[" + si + "]");
        if (!skinName) hard(ctx, "skin.name", "skins[" + si + "]", "skin 必须有非空 name");
        if (model.skins.has(skinName)) {
          warn(ctx, "skin.duplicateName", "skins[" + si + "]", "重复的 skin 名 " + skinName + "，已跳过");
          continue;
        }
        var skin = parseSkinAttachments(ctx, rawSkin, skinName, model, atlas, pendingLinked);
        model.skins.set(skinName, skin);
        if (skinName === "default") model.defaultSkinName = skinName;
      }
    }
    resolveLinkedMeshes(ctx, model, pendingLinked);

    for (var att of model.attachments.values()) {
      if (att.weighted) model.capabilities.weightedMesh = true;
      if (att.linked) model.capabilities.linkedMesh = true;
    }

    var defaultSkinName = opts && typeof opts.skin === "string" ? opts.skin : "default";
    model.defaultSkinName = defaultSkinName;
    if (!model.skins.has(defaultSkinName)) {
      warn(ctx, "model.skin.missing", "skins", "找不到默认 skin " + defaultSkinName + "，将使用 default");
      model.defaultSkinName = model.skins.has("default") ? "default" : model.skins.size ? model.skins.keys().next().value : null;
    }

    var rawAnimations = isObject(raw.animations) ? raw.animations : null;
    if (raw.animations !== undefined && !isObject(raw.animations)) {
      hard(ctx, "animations.invalid", "animations", "animations 必须是对象");
    }
    if (rawAnimations) {
      var animNames = Object.keys(rawAnimations);
      for (var ai = 0; ai < animNames.length; ai++) {
        var animName = animNames[ai];
        var anim = parseAnimation(ctx, rawAnimations[animName], animName, model);
        model.animations.set(animName, anim);
        if (anim.hasDeform) model.capabilities.unsupported.deform = true;
        if (anim.hasSlotColor) model.capabilities.unsupported.slotColor = true;
        if (anim.drawOrder) model.capabilities.unsupported.drawOrder = true;
      }
    }

    model.issues = ctx.issues;
    return model;
  }

  function parseModel(raw, atlas, opts) {
    var ctx = { issues: [] };
    try {
      var model = doParseModel(ctx, raw, atlas, opts || {});
      return resultOk(model, ctx.issues);
    } catch (err) {
      return failResult(ctx, err);
    }
  }

  /* ------------------------------------------------------------------ *
   * 姿势求值
   * ------------------------------------------------------------------ */

  function cloneLocal(local) {
    return {
      x: local.x,
      y: local.y,
      rotation: local.rotation,
      scaleX: local.scaleX,
      scaleY: local.scaleY,
      shearX: local.shearX,
      shearY: local.shearY,
    };
  }

  function fkAll(model, applied, world) {
    var topo = model.topo;
    for (var i = 0; i < topo.length; i++) {
      var idx = topo[i];
      var bone = model.bones[idx];
      var local = localMatrix(applied[idx]);
      var parentIndex = bone.parentIndex;
      if (parentIndex < 0) {
        world[idx] = local;
        continue;
      }
      var parent = world[parentIndex];
      if (!parent) {
        world[idx] = local;
        continue;
      }
      if (bone.inherit === "onlyTranslation") {
        // 平移走父矩阵，旋转/缩放/切变不继承（4.2 OnlyTranslation）。
        world[idx] = {
          a: local.a,
          b: local.b,
          c: local.c,
          d: local.d,
          tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
          ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
        };
      } else {
        world[idx] = matMul(parent, local);
      }
    }
  }

  function mapEntries(mapLike) {
    var out = [];
    if (!mapLike) return out;
    if (typeof mapLike.forEach === "function" && !Array.isArray(mapLike)) {
      mapLike.forEach(function (value, key) {
        out.push([key, value]);
      });
      return out;
    }
    if (typeof mapLike === "object") {
      for (var key in mapLike) {
        if (Object.prototype.hasOwnProperty.call(mapLike, key)) out.push([key, mapLike[key]]);
      }
    }
    return out;
  }

  function resolveAttachment(model, skin, slotIndex, name) {
    if (name === null || name === undefined) return null;
    if (!skin) return null;
    var bag = skin.attachments.get(slotIndex);
    if (!bag) return null;
    var att = bag.get(name);
    return att || null;
  }

  function applyBoneTracks(model, applied, anim, time) {
    var entries = mapEntries(anim.bones);
    for (var i = 0; i < entries.length; i++) {
      var boneIndex = entries[i][0];
      var tracks = entries[i][1];
      var bone = model.bones[boneIndex];
      var local = applied[boneIndex];
      if (tracks.rotate) {
        var r = sampleTrack(tracks.rotate.keys, time, tracks.rotate.fields, tracks.rotate.defaults);
        local.rotation = bone.rotation + r[0];
      }
      if (tracks.translate) {
        var t = sampleTrack(tracks.translate.keys, time, tracks.translate.fields, tracks.translate.defaults);
        local.x = bone.x + t[0];
        local.y = bone.y + t[1];
      }
      if (tracks.scale) {
        var s = sampleTrack(tracks.scale.keys, time, tracks.scale.fields, tracks.scale.defaults);
        local.scaleX = bone.scaleX * s[0];
        local.scaleY = bone.scaleY * s[1];
      }
      if (tracks.shear) {
        var sh = sampleTrack(tracks.shear.keys, time, tracks.shear.fields, tracks.shear.defaults);
        local.shearX = bone.shearX + sh[0];
        local.shearY = bone.shearY + sh[1];
      }
    }
  }

  function resetIKConstraints(model) {
    for (var i = 0; i < model.constraints.length; i++) {
      var c = model.constraints[i];
      c.mix = c.setupMix;
      c.softness = c.setupSoftness;
      c.bendPositive = c.setupBendPositive;
      c.compress = c.setupCompress;
      c.stretch = c.setupStretch;
    }
  }

  function applyIKTimeline(model, pose, anim, time) {
    var entries = mapEntries(anim.ik);
    for (var i = 0; i < entries.length; i++) {
      var constraintIndex = entries[i][0];
      var tracks = entries[i][1];
      var constraint = model.constraints[constraintIndex];
      if (!constraint) continue;
      if (tracks.continuous) {
        var v = sampleTrack(tracks.continuous.keys, time, tracks.continuous.fields, tracks.continuous.defaults);
        constraint.mix = clamp(v[0], 0, 1);
        constraint.softness = Math.max(0, v[1]);
      }
      if (tracks.bendPositive) constraint.bendPositive = steppedValue(tracks.bendPositive.keys, time, "value", tracks.bendPositive.default) > 0.5;
      if (tracks.compress) constraint.compress = steppedValue(tracks.compress.keys, time, "value", tracks.compress.default) > 0.5;
      if (tracks.stretch) constraint.stretch = steppedValue(tracks.stretch.keys, time, "value", tracks.stretch.default) > 0.5;
    }
  }

  function sampleDrawOrder(drawOrder, time, slotCount) {
    var order = new Array(slotCount);
    for (var i = 0; i < slotCount; i++) order[i] = i;
    if (!drawOrder || !drawOrder.keys || drawOrder.keys.length === 0) return order;
    if (time < f32(drawOrder.keys[0].time)) return order;
    var chosen = order;
    for (var k = 0; k < drawOrder.keys.length; k++) {
      if (f32(drawOrder.keys[k].time) > time) break;
      chosen = drawOrder.keys[k].order;
    }
    return chosen.slice();
  }

  function evalPose(model, opts) {
    var options = opts || {};
    if (model && model.ok === true && model.value) model = model.value;
    var issues = [];
    if (!model || !Array.isArray(model.bones) || !model.slotIndex) {
      return {
        local: [],
        applied: [],
        world: [],
        attachments: [],
        drawOrder: [],
        issues: [{ severity: "error", code: "pose.model", path: "", message: "无效模型" }],
      };
    }
    var animationName = options.animation === undefined ? null : options.animation;
    var time = isFiniteNumber(options.time) ? options.time : 0;
    var anim = null;
    if (animationName !== null && animationName !== undefined && animationName !== "") {
      anim = model.animations.get(animationName) || null;
      if (!anim) {
        issues.push({
          severity: "warning",
          code: "pose.animation.missing",
          path: "animations",
          message: "找不到动画 " + animationName,
        });
      }
    }

    var skinName = options.skin === undefined || options.skin === null ? model.defaultSkinName : options.skin;
    var skin = skinName ? model.skins.get(skinName) : null;
    if (!skin && model.defaultSkinName) skin = model.skins.get(model.defaultSkinName) || null;
    if (!skin) {
      issues.push({ severity: "warning", code: "pose.skin.missing", path: "skins", message: "找不到 skin " + skinName });
    }

    var local = new Array(model.bones.length);
    var attachments = new Array(model.slots.length);
    var i;
    for (i = 0; i < model.bones.length; i++) {
      var b = model.bones[i];
      local[i] = {
        x: b.x,
        y: b.y,
        rotation: b.rotation,
        scaleX: b.scaleX,
        scaleY: b.scaleY,
        shearX: b.shearX,
        shearY: b.shearY,
      };
    }
    for (i = 0; i < model.slots.length; i++) {
      attachments[i] = resolveAttachment(model, skin, i, model.slots[i].setupAttachment);
    }

    if (anim) {
      applyBoneTracks(model, local, anim, time);
      var slotEntries = mapEntries(anim.slots);
      for (i = 0; i < slotEntries.length; i++) {
        var slotIndex = slotEntries[i][0];
        var slotTracks = slotEntries[i][1];
        if (slotTracks.attachment) {
          var name = sampleAttachmentName(slotTracks.attachment.keys, time, slotTracks.attachment.default);
          attachments[slotIndex] = resolveAttachment(model, skin, slotIndex, name);
        }
      }
    }

    // 编辑：只改 local（随后 FK），不改 setup/raw。
    var edits = options.edits;
    if (edits) {
      var boneEdits = mapEntries(edits.bones);
      for (i = 0; i < boneEdits.length; i++) {
        var key = boneEdits[i][0];
        var patch = boneEdits[i][1];
        var boneIndex = typeof key === "number" ? key : model.boneIndex.get(String(key));
        if (boneIndex === undefined || boneIndex < 0 || boneIndex >= model.bones.length) {
          issues.push({ severity: "warning", code: "pose.edit.bone", path: "edits.bones", message: "未知骨 " + key });
          continue;
        }
        if (!isObject(patch)) continue;
        var fields = ["x", "y", "rotation", "scaleX", "scaleY", "shearX", "shearY"];
        for (var f = 0; f < fields.length; f++) {
          if (patch[fields[f]] === undefined) continue;
          if (!isFiniteNumber(patch[fields[f]])) {
            issues.push({
              severity: "warning",
              code: "pose.edit.value",
              path: "edits.bones." + key + "." + fields[f],
              message: "编辑值必须是有限数字，已忽略",
            });
            continue;
          }
          local[boneIndex][fields[f]] = patch[fields[f]];
        }
      }
    }

    // 附件覆盖（Map<slotIndex|slotName, attName|null|Attachment>）。
    var overrides = options.attachmentOverrides;
    if (overrides) {
      var overrideEntries = mapEntries(overrides);
      for (i = 0; i < overrideEntries.length; i++) {
        var okey = overrideEntries[i][0];
        var ovalue = overrideEntries[i][1];
        var oslot = typeof okey === "number" ? okey : model.slotIndex.get(String(okey));
        if (oslot === undefined || oslot < 0 || oslot >= model.slots.length) {
          issues.push({ severity: "warning", code: "pose.override.slot", path: "attachmentOverrides", message: "未知 slot " + okey });
          continue;
        }
        if (ovalue === null || ovalue === undefined) {
          attachments[oslot] = null;
        } else if (typeof ovalue === "string") {
          var found = resolveAttachment(model, skin, oslot, ovalue);
          if (!found) {
            issues.push({
              severity: "warning",
              code: "pose.override.attachment",
              path: "attachmentOverrides",
              message: "slot " + model.slots[oslot].name + " 找不到附件 " + ovalue,
            });
          }
          attachments[oslot] = found;
        } else if (typeof ovalue === "object" && ovalue.id && ovalue.type) {
          attachments[oslot] = ovalue;
        } else {
          issues.push({
            severity: "warning",
            code: "pose.override.value",
            path: "attachmentOverrides",
            message: "覆盖值必须是附件名、附件对象或 null",
          });
        }
      }
    }

    // 绘制顺序。
    var drawOrder = new Array(model.slots.length);
    for (i = 0; i < drawOrder.length; i++) drawOrder[i] = i;
    if (anim && anim.drawOrder) drawOrder = sampleDrawOrder(anim.drawOrder, time, model.slots.length);
    if (edits && edits.slotOrder) {
      var order = edits.slotOrder;
      var valid = Array.isArray(order) && order.length === model.slots.length;
      if (valid) {
        var seen = new Uint8Array(model.slots.length);
        for (i = 0; i < order.length; i++) {
          var v = order[i];
          if (!Number.isInteger(v) || v < 0 || v >= model.slots.length || seen[v]) {
            valid = false;
            break;
          }
          seen[v] = 1;
        }
      }
      if (valid) drawOrder = order.slice();
      else {
        issues.push({
          severity: "warning",
          code: "pose.edit.slotOrder",
          path: "edits.slotOrder",
          message: "slotOrder 必须是 0..slotCount-1 的排列，已忽略",
        });
      }
    }

    var applied = new Array(local.length);
    for (i = 0; i < local.length; i++) applied[i] = cloneLocal(local[i]);
    var world = new Array(model.bones.length);
    fkAll(model, applied, world);

    // 约束按 (order, 原序) 求值；IK 时间线先覆盖约束参数（先从 setup 恢复，避免跨帧累积）。
    resetIKConstraints(model);
    if (anim && anim.ik.size) applyIKTimeline(model, { applied: applied, world: world }, anim, time);
    var constraints = model.constraints.slice().sort(function (a, b) {
      return a.order - b.order || a.index - b.index;
    });
    for (i = 0; i < constraints.length; i++) {
      var result = ikSolve(model, { applied: applied, world: world }, constraints[i]);
      if (result.issues.length) issues.push.apply(issues, result.issues);
    }

    return { local: local, applied: applied, world: world, attachments: attachments, drawOrder: drawOrder, issues: issues };
  }

  /* ------------------------------------------------------------------ *
   * IK（A7 最小子集）
   * ------------------------------------------------------------------ */

  function ikIssue(constraint, code, message) {
    return {
      severity: "warning",
      code: code,
      path: "ik." + constraint.name,
      message: "IK 约束 " + constraint.name + "：" + message,
    };
  }

  function ikSolve(model, pose, constraint) {
    var issues = [];
    var changed = [];
    if (!constraint || !pose || !pose.applied || !pose.world) return { changedBones: changed, issues: issues };
    var mix = clamp(isFiniteNumber(constraint.mix) ? constraint.mix : 1, 0, 1);
    if (mix === 0) return { changedBones: changed, issues: issues };
    var applied = pose.applied;
    var world = pose.world;
    var targetWorld = world[constraint.target];
    if (!targetWorld) {
      issues.push(ikIssue(constraint, "ik.targetMissing", "target 骨 world 不存在，跳过求解"));
      return { changedBones: changed, issues: issues };
    }
    var targetPoint = { x: targetWorld.tx, y: targetWorld.ty };
    var indices = constraint.bones;
    var i;

    if (indices.length === 1) {
      var boneIndex = indices[0];
      var bone = model.bones[boneIndex];
      var local = applied[boneIndex];
      if (bone.parentIndex < 0) {
        issues.push(ikIssue(constraint, "ik.bone.noParent", "骨没有父骨，无法在其父空间求解，保留 FK"));
        return { changedBones: changed, issues: issues };
      }
      if (bone.inherit !== "normal") {
        issues.push(ikIssue(constraint, "ik.unsupported.inherit", "骨 inherit=" + bone.inherit + " 未支持，保留 FK"));
        return { changedBones: changed, issues: issues };
      }
      if (!(local.scaleX > 0)) {
        issues.push(ikIssue(constraint, "ik.unsupported.scale", "骨 scaleX<=0 未支持，保留 FK"));
        return { changedBones: changed, issues: issues };
      }
      var parentWorld = world[bone.parentIndex];
      var invParent = invert(parentWorld);
      if (!invParent) {
        issues.push(ikIssue(constraint, "ik.singularParent", "父骨矩阵不可逆，保留 FK"));
        return { changedBones: changed, issues: issues };
      }
      var targetLocal = transformPoint(invParent, targetPoint);
      var tx = targetLocal.x - local.x;
      var ty = targetLocal.y - local.y;
      var desired = Math.atan2(ty, tx) * RAD - local.shearX;
      var fkRot = local.rotation;
      var newRot = fkRot + mix * wrap180(desired - fkRot);
      var dist = Math.hypot(tx, ty);
      var scaleX = local.scaleX;
      if ((constraint.compress || constraint.stretch) && bone.length > 1e-6) {
        var reach = bone.length * Math.abs(scaleX);
        if ((constraint.compress && dist < reach) || (constraint.stretch && dist > reach)) {
          var scale = 1 + mix * (dist / reach - 1);
          local.scaleX = scaleX * scale;
          if (constraint.uniform) local.scaleY *= scale;
          changed.push(boneIndex);
        }
      }
      if (Math.abs(newRot - fkRot) > 1e-12) {
        local.rotation = newRot;
        if (changed.indexOf(boneIndex) < 0) changed.push(boneIndex);
      }
      if (changed.length) fkAll(model, applied, world);
      return { changedBones: changed, issues: issues };
    }

    // 二骨 IK。
    var parentIndex = indices[0];
    var childIndex = indices[1];
    var parentBone = model.bones[parentIndex];
    var childBone = model.bones[childIndex];
    if (parentBone.parentIndex < 0) {
      issues.push(ikIssue(constraint, "ik.bone.noParent", "父骨没有父骨，无法求解，保留 FK"));
      return { changedBones: changed, issues: issues };
    }
    if (parentBone.inherit !== "normal" || childBone.inherit !== "normal") {
      issues.push(ikIssue(constraint, "ik.unsupported.inherit", "受控骨 inherit 不是 Normal，保留 FK"));
      return { changedBones: changed, issues: issues };
    }
    var psx = applied[parentIndex].scaleX;
    var psy = applied[parentIndex].scaleY;
    var csx = applied[childIndex].scaleX;
    if (!(psx > 0) || !(psy > 0) || !(csx > 0)) {
      issues.push(ikIssue(constraint, "ik.unsupported.scale", "受控骨 scale<=0 未支持，保留 FK"));
      return { changedBones: changed, issues: issues };
    }
    if (Math.abs(psx - psy) > 1e-4) {
      issues.push(ikIssue(constraint, "ik.unsupported.nonUniformParent", "父骨非均匀缩放，保留 FK"));
      return { changedBones: changed, issues: issues };
    }
    if (
      Math.abs(applied[parentIndex].shearX) > 1e-9 ||
      Math.abs(applied[parentIndex].shearY) > 1e-9 ||
      Math.abs(applied[childIndex].shearX) > 1e-9 ||
      Math.abs(applied[childIndex].shearY) > 1e-9
    ) {
      issues.push(ikIssue(constraint, "ik.unsupported.shear", "受控骨含 shear，保留 FK"));
      return { changedBones: changed, issues: issues };
    }
    if (constraint.stretch && Math.abs(applied[childIndex].y) > 1e-9) {
      issues.push(ikIssue(constraint, "ik.unsupported.stretchChildOffset", "stretch 要求子骨 y≈0，保留 FK"));
      return { changedBones: changed, issues: issues };
    }
    var grandWorld = world[parentBone.parentIndex];
    var invGrand = invert(grandWorld);
    if (!invGrand) {
      issues.push(ikIssue(constraint, "ik.singularParent", "祖父矩阵不可逆，保留 FK"));
      return { changedBones: changed, issues: issues };
    }
    var targetInGrand = transformPoint(invGrand, targetPoint);
    var T = {
      x: targetInGrand.x - applied[parentIndex].x,
      y: targetInGrand.y - applied[parentIndex].y,
    };
    var childX = applied[childIndex].x;
    var childY = applied[childIndex].y;
    var L1 = Math.hypot(childX, childY) * Math.abs(psx);
    var L2 = childBone.length * Math.abs(csx) * Math.abs(psx);
    if (!(L1 > 1e-6) || !(L2 > 1e-6)) {
      issues.push(ikIssue(constraint, "ik.zeroLength", "骨链长度接近 0，保留 FK"));
      return { changedBones: changed, issues: issues };
    }
    var D = Math.hypot(T.x, T.y);
    var S = constraint.softness * Math.abs(psx) * (Math.abs(csx) + 1) / 2;
    if (S > 1e-9) {
      var sd = D - (L1 + L2) + S;
      if (sd > 0) {
        var qSoft = Math.min(1, sd / (2 * S)) - 1;
        var dSoft = D - (sd - S * (1 - qSoft * qSoft));
        var k = dSoft / Math.max(D, 1e-9);
        T.x *= k;
        T.y *= k;
      }
    }
    D = Math.hypot(T.x, T.y);
    var newPsx = psx;
    if (constraint.stretch && D > L1 + L2) {
      var stretchScale = 1 + mix * (D / (L1 + L2) - 1);
      newPsx = psx * stretchScale;
      applied[parentIndex].scaleX = newPsx;
      if (constraint.uniform) applied[parentIndex].scaleY = psy * stretchScale;
      changed.push(parentIndex);
    }
    var q = clamp((D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
    var bend = constraint.bendPositive ? 1 : -1;
    var theta2 = bend * Math.acos(q);
    var theta1 = Math.atan2(T.y, T.x) - Math.atan2(L2 * Math.sin(theta2), L1 + L2 * Math.cos(theta2));
    var os = Math.atan2(childY, childX);
    var fkP = applied[parentIndex].rotation;
    var fkC = applied[childIndex].rotation;
    var newP = fkP + mix * wrap180(theta1 * RAD - os * RAD - fkP);
    var newC = fkC + mix * wrap180(theta2 * RAD + os * RAD - fkC);
    if (Math.abs(newP - fkP) > 1e-12) {
      applied[parentIndex].rotation = newP;
      if (changed.indexOf(parentIndex) < 0) changed.push(parentIndex);
    }
    if (Math.abs(newC - fkC) > 1e-12) {
      applied[childIndex].rotation = newC;
      if (changed.indexOf(childIndex) < 0) changed.push(childIndex);
    }
    if (changed.length) fkAll(model, applied, world);
    return { changedBones: changed, issues: issues };
  }

  /* ------------------------------------------------------------------ *
   * 几何
   * ------------------------------------------------------------------ */

  function skinMesh(att, slotBoneIndex, world, deform) {
    var n = att.vertexCount;
    var out = new Float64Array(n * 2);
    if (!n) return out;
    var i;
    if (!att.weighted) {
      var mat = world[slotBoneIndex];
      if (!mat || !att.localXY) return out;
      var l = att.localXY;
      for (i = 0; i < n; i++) {
        var x = l[i * 2];
        var y = l[i * 2 + 1];
        if (deform && deform.length >= n * 2) {
          x += deform[i * 2];
          y += deform[i * 2 + 1];
        }
        out[i * 2] = mat.a * x + mat.c * y + mat.tx;
        out[i * 2 + 1] = mat.b * x + mat.d * y + mat.ty;
      }
      return out;
    }
    var influences = att.influences;
    if (!influences) return out;
    var k = 0;
    for (var v = 0; v < n; v++) {
      var list = influences[v] || [];
      var wx = 0;
      var wy = 0;
      for (var j = 0; j < list.length; j++) {
        var inf = list[j];
        var boneMat = world[inf.boneIndex];
        var ix = inf.x;
        var iy = inf.y;
        if (deform && k + 1 < deform.length) {
          ix += deform[k];
          iy += deform[k + 1];
        }
        k += 2;
        if (!boneMat) continue;
        wx += inf.weight * (boneMat.a * ix + boneMat.c * iy + boneMat.tx);
        wy += inf.weight * (boneMat.b * ix + boneMat.d * iy + boneMat.ty);
      }
      out[v * 2] = wx;
      out[v * 2 + 1] = wy;
    }
    return out;
  }

  function uvToPageXY(region, uv) {
    if (!region || !uv || uv.length % 2 !== 0) return new Float64Array(0);
    var out = new Float64Array(uv.length);
    var x = region.x;
    var y = region.y;
    var w = region.w;
    var h = region.h;
    var W = region.originalW || w;
    var H = region.originalH || h;
    var offX = region.offsetX || 0;
    var offY = region.offsetY || 0;
    var rotate = region.rotate || 0;
    for (var i = 0; i < uv.length; i += 2) {
      var u = uv[i];
      var v = uv[i + 1];
      var sx;
      var sy;
      if (rotate === 90) {
        sx = x - (H - offY - h) + v * H;
        sy = y - (W - offX - w) + (1 - u) * W;
      } else if (rotate === 180) {
        sx = x - (W - offX - w) + (1 - u) * W;
        sy = y - offY + (1 - v) * H;
      } else if (rotate === 270) {
        sx = x - offY + (1 - v) * H;
        sy = y - offX + u * W;
      } else {
        sx = x - offX + u * W;
        sy = y - (H - offY - h) + v * H;
      }
      out[i] = sx;
      out[i + 1] = sy;
    }
    return out;
  }

  function boundsOfArray(xy) {
    if (!xy || xy.length < 2) return null;
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    for (var i = 0; i < xy.length; i += 2) {
      var x = xy[i];
      var y = xy[i + 1];
      if (!isFinite(x) || !isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function buildGeometry(model, pose, opts) {
    var options = opts || {};
    var hidden = options.hidden || null;
    var items = [];
    if (!model || !pose || !pose.drawOrder) return items;
    for (var d = 0; d < pose.drawOrder.length; d++) {
      var slotIndex = pose.drawOrder[d];
      var att = pose.attachments ? pose.attachments[slotIndex] : null;
      if (!att || !att.region) continue;
      var slot = model.slots[slotIndex];
      if (!slot) continue;
      if (hidden) {
        if (typeof hidden.has === "function") {
          if (hidden.has(slotIndex) || hidden.has(slot.name) || hidden.has(att.id)) continue;
        }
      }
      var worldXY = skinMesh(att, slot.boneIndex, pose.world);
      var sourceXY = uvToPageXY(att.region, att.uv);
      var bounds = boundsOfArray(worldXY);
      if (!bounds) continue;
      items.push({
        slotIndex: slotIndex,
        attachmentId: att.id,
        worldXY: worldXY,
        sourceXY: sourceXY,
        triangles: att.triangles,
        pageIndex: att.region.pageIndex,
        bounds: bounds,
        weighted: !!att.weighted,
      });
    }
    return items;
  }

  function boundsOf(items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    for (var i = 0; i < items.length; i++) {
      var b = items[i] && items[i].bounds;
      if (!b) continue;
      if (!isFinite(b.minX) || !isFinite(b.minY) || !isFinite(b.maxX) || !isFinite(b.maxY)) continue;
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function hitTest(items, point, opts) {
    if (!Array.isArray(items) || items.length === 0 || !point) return null;
    var options = opts || {};
    var eps = isFiniteNumber(options.epsilon) ? options.epsilon : 1e-8;
    for (var i = items.length - 1; i >= 0; i--) {
      var item = items[i];
      if (!item || !item.bounds) continue;
      var b = item.bounds;
      if (point.x < b.minX - eps || point.x > b.maxX + eps || point.y < b.minY - eps || point.y > b.maxY + eps) continue;
      var tri = item.triangles;
      var w = item.worldXY;
      if (!tri || !w) continue;
      for (var t = 0; t + 2 < tri.length; t += 3) {
        var i0 = tri[t];
        var i1 = tri[t + 1];
        var i2 = tri[t + 2];
        var x0 = w[i0 * 2];
        var y0 = w[i0 * 2 + 1];
        var x1 = w[i1 * 2];
        var y1 = w[i1 * 2 + 1];
        var x2 = w[i2 * 2];
        var y2 = w[i2 * 2 + 1];
        var area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
        if (Math.abs(area) <= 1e-12) continue; // 退化三角跳过
        var l0 = ((x1 - point.x) * (y2 - point.y) - (x2 - point.x) * (y1 - point.y)) / area;
        var l1 = ((x2 - point.x) * (y0 - point.y) - (x0 - point.x) * (y2 - point.y)) / area;
        var l2 = 1 - l0 - l1;
        if (l0 >= -1e-7 && l1 >= -1e-7 && l2 >= -1e-7) {
          return {
            slotIndex: item.slotIndex,
            attachmentId: item.attachmentId,
            triangleIndex: t / 3,
            barycentric: [l0, l1, l2],
          };
        }
      }
    }
    return null;
  }

  function affineFromTriangles(srcXY6, dstXY6) {
    if (!srcXY6 || !dstXY6 || srcXY6.length < 6 || dstXY6.length < 6) return null;
    var s0x = srcXY6[0];
    var s0y = srcXY6[1];
    var q0x = srcXY6[2] - s0x;
    var q0y = srcXY6[3] - s0y;
    var q1x = srcXY6[4] - s0x;
    var q1y = srcXY6[5] - s0y;
    var det = q0x * q1y - q1x * q0y;
    if (!isFinite(det) || Math.abs(det) < 1e-12) return null; // 奇异 UV 三角
    var i00 = q1y / det;
    var i01 = -q1x / det;
    var i10 = -q0y / det;
    var i11 = q0x / det;
    var r0x = dstXY6[2] - dstXY6[0];
    var r0y = dstXY6[3] - dstXY6[1];
    var r1x = dstXY6[4] - dstXY6[0];
    var r1y = dstXY6[5] - dstXY6[1];
    var a = r0x * i00 + r1x * i10;
    var c = r0x * i01 + r1x * i11;
    var b = r0y * i00 + r1y * i10;
    var d = r0y * i01 + r1y * i11;
    var tx = dstXY6[0] - (a * s0x + c * s0y);
    var ty = dstXY6[1] - (b * s0x + d * s0y);
    return { a: a, b: b, c: c, d: d, tx: tx, ty: ty };
  }

  function fallbackColor(boneIndex) {
    // 稳定散列色（palette 未提供时的兜底）；与骨索引绑定，跨 slot 同色。
    var hue = ((boneIndex * 137.508) % 360) / 360;
    var s = 0.62;
    var l = 0.58;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = hue * 6;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r = 0;
    var g = 0;
    var b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    var m = l - c / 2;
    return [r + m, g + m, b + m];
  }

  function weightColors(att, slotBoneIndex, palette, selectedBone) {
    var n = att && att.vertexCount ? att.vertexCount : 0;
    var rgb = new Float32Array(n * 3);
    var heat = selectedBone === undefined || selectedBone === null ? null : new Float32Array(n);
    var legend = [];
    if (!att) return { rgb: rgb, heat: heat === null ? undefined : heat, legend: legend };
    var colorOf = function (boneIndex) {
      var c = palette && typeof palette.get === "function" ? palette.get(boneIndex) : palette ? palette[boneIndex] : undefined;
      if (c && c.length >= 3) return c;
      return fallbackColor(boneIndex);
    };
    var legendMap = new Map();
    for (var v = 0; v < n; v++) {
      var weights;
      if (!att.weighted) {
        weights = [{ boneIndex: slotBoneIndex, boneName: att.slotBoneName || "", weight: 1 }];
      } else {
        weights = att.influences && att.influences[v] ? att.influences[v] : [];
      }
      var sum = 0;
      var i;
      for (i = 0; i < weights.length; i++) sum += weights[i].weight;
      if (!(sum > 0)) sum = 1;
      var r = 0;
      var g = 0;
      var b = 0;
      var heatWeight = 0;
      for (i = 0; i < weights.length; i++) {
        var inf = weights[i];
        var w = inf.weight / sum;
        var col = colorOf(inf.boneIndex);
        r += w * col[0];
        g += w * col[1];
        b += w * col[2];
        if (heat && inf.boneIndex === selectedBone) heatWeight += w;
        var entry = legendMap.get(inf.boneIndex);
        if (!entry) {
          entry = {
            boneIndex: inf.boneIndex,
            name: inf.boneName || (att.slotBoneName && !att.weighted ? att.slotBoneName : ""),
            color: col,
            maxWeight: 0,
            vertexCount: 0,
          };
          legendMap.set(inf.boneIndex, entry);
        }
        if (w > entry.maxWeight) entry.maxWeight = w;
        if (w > 0) entry.vertexCount++;
      }
      rgb[v * 3] = r;
      rgb[v * 3 + 1] = g;
      rgb[v * 3 + 2] = b;
      if (heat) heat[v] = heatWeight;
    }
    legendMap.forEach(function (entry) {
      legend.push(entry);
    });
    legend.sort(function (a, b) {
      return a.boneIndex - b.boneIndex;
    });
    return { rgb: rgb, heat: heat === null ? undefined : heat, legend: legend };
  }

  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */

  var api = {
    parseAtlas: parseAtlas,
    parseModel: parseModel,
    sampleTrack: sampleTrack,
    evalPose: evalPose,
    ikSolve: ikSolve,
    skinMesh: skinMesh,
    uvToPageXY: uvToPageXY,
    buildGeometry: buildGeometry,
    weightColors: weightColors,
    boundsOf: boundsOf,
    hitTest: hitTest,
    affineFromTriangles: affineFromTriangles,
    matMul: matMul,
    invert: invert,
    transformPoint: transformPoint,
  };

  global.SpineCore = Object.freeze(api);
})(typeof globalThis !== "undefined" ? globalThis : this);
