/* =============================================================================
   语义标注器 · 纯数据核心（无 DOM / 无 fetch / 无磁盘 I/O）
   - 标签图（label map）：每个像素一个 part 索引（0 = 未标注），可见区与被遮挡补全
     各一张，尺寸严格等于原图。
   - 标注工具共用的栅格操作：矩形、多边形扫描填充、圆形笔刷、颜色洪水填充、撤销 diff。
   - 工程与清单 schema、导出文件命名、ZIP（store）打包。
   浏览器里挂在 window.PartAnnotatorCore；Node 里 module.exports 同一对象，便于断言。
   ============================================================================= */
(function (root) {
  'use strict';

  var C = {};

  C.SCHEMA_VERSION = 1;
  C.CHANNELS = ['visible', 'hidden'];
  C.CHANNEL_LABEL = { visible: '可见区', hidden: '被遮挡补全' };
  C.SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  C.MASK_ALPHA_THRESHOLD = 10;      // 与 See-through / workspace 拆分件一致的 alpha 阈值
  C.MAX_PARTS = 251;                // 索引 1..251 留给部件，252..255 保留

  // 18 色高对比调色板（与深色 UI 适配；循环使用）
  C.PALETTE = [
    '#ff6b6b', '#ffa94d', '#ffd43b', '#a9e34b', '#51cf66', '#38d9a9',
    '#3bc9db', '#4dabf7', '#5c7cfa', '#845ef7', '#cc5de8', '#f06595',
    '#c0a080', '#8ce99a', '#66d9e8', '#91a7ff', '#e599f7', '#ffc9c9'
  ];

  C.paletteColor = function (index) {
    if (!Number.isFinite(index) || index < 0) return '#888888';
    return C.PALETTE[index % C.PALETTE.length];
  };

  C.hexToRgb = function (hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return { r: 136, g: 136, b: 136 };
    var n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };

  C.rgbToHex = function (r, g, b) {
    function h(v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }
    return '#' + h(r) + h(g) + h(b);
  };

  // ---------------------------------------------------------------- 标签图
  C.createLabelMap = function (w, h) {
    if (!(w > 0 && h > 0)) throw new Error('createLabelMap: bad size');
    return new Uint8Array(w * h);
  };

  C.labelStats = function (map, parts) {
    var counts = new Array(parts.length + 1).fill(0);
    for (var i = 0; i < map.length; i++) {
      var v = map[i];
      if (v > 0 && v <= parts.length) counts[v]++;
    }
    counts[0] = 0;
    return counts;
  };

  C.bboxOfValue = function (map, w, h, value) {
    var x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        if (map[row + x] === value) {
          n++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (n === 0) return null;
    return { x0: x0, y0: y0, x1: x1 + 1, y1: y1 + 1, area: n };
  };

  // 统计等于 value 的 4 连通块数量（“多选区”口径：一块 = 一个不相邻的选区）
  // minArea：只数像素数 >= minArea 的块；maxCount：数到这么多个就早停（0 = 不早停）。
  var _ccStack = null;
  C.countComponents = function (map, w, h, value, minArea, maxCount) {
    var target = value === undefined ? 1 : value;
    var minA = minArea === undefined ? 1 : minArea;
    var cap = maxCount || 0;
    if (!(map && map.length === w * h)) return 0;
    var visited = new Uint8Array(map.length);
    if (!_ccStack || _ccStack.length < map.length) _ccStack = new Int32Array(map.length);
    var stack = _ccStack;
    var count = 0;
    for (var start = 0; start < map.length; start++) {
      if (map[start] !== target || visited[start]) continue;
      var sp = 0;
      stack[sp++] = start;
      visited[start] = 1;
      var area = 0;
      while (sp > 0) {
        var i = stack[--sp];
        area++;
        var x = i % w;
        var y = (i - x) / w;
        if (x > 0) { var a = i - 1; if (!visited[a] && map[a] === target) { visited[a] = 1; stack[sp++] = a; } }
        if (x < w - 1) { var b = i + 1; if (!visited[b] && map[b] === target) { visited[b] = 1; stack[sp++] = b; } }
        if (y > 0) { var c = i - w; if (!visited[c] && map[c] === target) { visited[c] = 1; stack[sp++] = c; } }
        if (y < h - 1) { var d = i + w; if (!visited[d] && map[d] === target) { visited[d] = 1; stack[sp++] = d; } }
      }
      if (area >= minA) {
        count++;
        if (cap && count >= cap) return count;
      }
    }
    return count;
  };

  // ---------------------------------------------------------------- 撤销 diff
  // 记录 bbox 内改动前后像素，回滚时只写这一块（内存远小于整图快照）
  C.snapshotDiff = function (map, w, bbox, before) {
    var x0 = Math.max(0, bbox.x0), y0 = Math.max(0, bbox.y0);
    var x1 = Math.min(w, bbox.x1), y1 = Math.min(map.length / w, bbox.y1);
    var bw = x1 - x0, bh = y1 - y0;
    if (!(bw > 0 && bh > 0)) return null;
    var after = new Uint8Array(bw * bh);
    for (var y = 0; y < bh; y++) {
      for (var x = 0; x < bw; x++) after[y * bw + x] = map[(y0 + y) * w + x0 + x];
    }
    return { x0: x0, y0: y0, w: bw, h: bh, before: before || null, after: after };
  };

  C.extractRegion = function (map, w, bbox) {
    var x0 = Math.max(0, bbox.x0), y0 = Math.max(0, bbox.y0);
    var x1 = Math.min(w, bbox.x1), y1 = Math.min(map.length / w, bbox.y1);
    var bw = x1 - x0, bh = y1 - y0;
    var out = new Uint8Array(Math.max(1, bw * bh));
    for (var y = 0; y < bh; y++) {
      for (var x = 0; x < bw; x++) out[y * bw + x] = map[(y0 + y) * w + x0 + x];
    }
    return out;
  };

  C.applyDiff = function (map, w, diff, which) {
    if (!diff) return false;
    var data = which === 'before' ? diff.before : diff.after;
    if (!data) return false;
    for (var y = 0; y < diff.h; y++) {
      for (var x = 0; x < diff.w; x++) {
        map[(diff.y0 + y) * w + diff.x0 + x] = data[y * diff.w + x];
      }
    }
    return true;
  };

  // ---------------------------------------------------------------- 栅格操作
  function clampRect(w, h, x0, y0, x1, y1) {
    var ax = Math.min(x0, x1), bx = Math.max(x0, x1);
    var ay = Math.min(y0, y1), by = Math.max(y0, y1);
    return {
      x0: Math.max(0, Math.floor(ax)), y0: Math.max(0, Math.floor(ay)),
      x1: Math.min(w, Math.ceil(bx)), y1: Math.min(h, Math.ceil(by))
    };
  }

  C.drawRect = function (map, w, h, x0, y0, x1, y1, value) {
    var r = clampRect(w, h, x0, y0, x1, y1);
    for (var y = r.y0; y < r.y1; y++) {
      var row = y * w;
      for (var x = r.x0; x < r.x1; x++) map[row + x] = value;
    }
    return r;
  };

  C.fillPolygon = function (map, w, h, points, value) {
    if (!points || points.length < 3) return null;
    var y0 = h, y1 = 0, minX = w, maxX = 0;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    }
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(h, Math.ceil(y1) + 1);
    var changed = null;
    var xs = [];
    for (var y = y0; y < y1; y++) {
      xs.length = 0;
      var sy = y + 0.5;
      for (var k = 0; k < points.length; k++) {
        var a = points[k], b = points[(k + 1) % points.length];
        var ay = a.y, by = b.y;
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) {
          var t = (sy - ay) / (by - ay);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
      if (xs.length < 2) continue;
      xs.sort(function (u, v) { return u - v; });
      for (var s = 0; s + 1 < xs.length; s += 2) {
        var lx = Math.max(0, Math.ceil(xs[s] - 0.5));
        var rx = Math.min(w, Math.ceil(xs[s + 1] - 0.5));
        if (rx <= lx) continue;
        var row = y * w;
        for (var x = lx; x < rx; x++) map[row + x] = value;
        changed = changed || { x0: w, y0: h, x1: 0, y1: 0 };
        if (lx < changed.x0) changed.x0 = lx;
        if (rx > changed.x1) changed.x1 = rx;
        if (y < changed.y0) changed.y0 = y;
        if (y + 1 > changed.y1) changed.y1 = y + 1;
      }
    }
    return changed;
  };

  C.drawBrush = function (map, w, h, cx, cy, radius, value) {
    var r = Math.max(1, Math.round(radius));
    var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w, Math.ceil(cx + r) + 1);
    var y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h, Math.ceil(cy + r) + 1);
    var r2 = r * r;
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) map[y * w + x] = value;
      }
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  };

  C.drawBrushLine = function (map, w, h, x0, y0, x1, y1, radius, value) {
    var dist = Math.hypot(x1 - x0, y1 - y0);
    var steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.5)));
    var bbox = null;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var b = C.drawBrush(map, w, h, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, value);
      if (!bbox) bbox = b;
      else {
        bbox.x0 = Math.min(bbox.x0, b.x0); bbox.y0 = Math.min(bbox.y0, b.y0);
        bbox.x1 = Math.max(bbox.x1, b.x1); bbox.y1 = Math.max(bbox.y1, b.y1);
      }
    }
    return bbox;
  };

  // 颜色洪水填充：与 (x,y) 处颜色差 <= tolerance（0..255，按通道最大差）的 4 连通区域
  // 只写 labelMap，不修改 base 像素；返回改动 bbox。
  C.floodFill = function (baseRGBA, w, h, x, y, tolerance, labelMap, value) {
    x = Math.floor(x); y = Math.floor(y);
    if (!(x >= 0 && x < w && y >= 0 && y < h)) return null;
    var idx = y * w + x;
    var sr = baseRGBA[idx * 4], sg = baseRGBA[idx * 4 + 1], sb = baseRGBA[idx * 4 + 2];
    var tol = Math.max(0, tolerance | 0);
    var seen = new Uint8Array(w * h);
    var stack = [idx];
    var bbox = { x0: w, y0: h, x1: 0, y1: 0 };
    var changed = false;
    while (stack.length) {
      var p = stack.pop();
      if (seen[p]) continue;
      seen[p] = 1;
      var px = p % w, py = (p - px) / w;
      var o = p * 4;
      if (Math.abs(baseRGBA[o] - sr) > tol || Math.abs(baseRGBA[o + 1] - sg) > tol ||
          Math.abs(baseRGBA[o + 2] - sb) > tol) continue;
      if (labelMap[p] !== value) {
        labelMap[p] = value;
        changed = true;
        if (px < bbox.x0) bbox.x0 = px;
        if (px + 1 > bbox.x1) bbox.x1 = px + 1;
        if (py < bbox.y0) bbox.y0 = py;
        if (py + 1 > bbox.y1) bbox.y1 = py + 1;
      }
      if (px > 0) stack.push(p - 1);
      if (px + 1 < w) stack.push(p + 1);
      if (py > 0) stack.push(p - w);
      if (py + 1 < h) stack.push(p + w);
    }
    return changed ? bbox : null;
  };

  // ---------------------------------------------------------------- 工程 / 清单
  C.emptyProject = function (opts) {
    var o = opts || {};
    return {
      schemaVersion: C.SCHEMA_VERSION,
      kind: 'part-annotation',
      character: o.character || 'deepseek',
      view: o.view || 'front',
      canvas: { width: o.width | 0, height: o.height | 0 },
      source: o.source || '',
      seedFrom: o.seedFrom || '',
      parts: [],
      channels: { visible: true, hidden: false },
      createdAt: o.createdAt || new Date().toISOString(),
      updatedAt: o.updatedAt || new Date().toISOString()
    };
  };

  C.normalizeId = function (name, existing) {
    var s = String(name || '').trim().toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!s) s = 'part';
    var used = new Set(existing || []);
    var base = s, i = 2;
    while (used.has(s) || !C.SAFE_ID_RE.test(s)) { s = base + '-' + i; i++; }
    return s;
  };

  C.validateProject = function (p) {
    var errors = [];
    if (!p || typeof p !== 'object') return { ok: false, errors: ['project is not an object'] };
    if (p.schemaVersion !== C.SCHEMA_VERSION) errors.push('schemaVersion must be 1');
    if (p.kind !== 'part-annotation') errors.push('kind must be part-annotation');
    if (!C.SAFE_ID_RE.test(String(p.character || ''))) errors.push('bad character id');
    if (!C.SAFE_ID_RE.test(String(p.view || ''))) errors.push('bad view id');
    if (!p.canvas || !(p.canvas.width > 0) || !(p.canvas.height > 0)) errors.push('bad canvas');
    if (!Array.isArray(p.parts)) errors.push('parts must be an array');
    else {
      if (p.parts.length > C.MAX_PARTS) errors.push('too many parts');
      var seen = new Set();
      p.parts.forEach(function (part, i) {
        if (!part || !C.SAFE_ID_RE.test(String(part.id || ''))) errors.push('bad part id at ' + i);
        else if (seen.has(part.id)) errors.push('duplicate part id: ' + part.id);
        else seen.add(part.id);
        if (typeof part.name !== 'string' || !part.name.trim()) errors.push('bad part name at ' + i);
        if (!Number.isInteger(part.z)) errors.push('bad part z at ' + i);
      });
    }
    return { ok: errors.length === 0, errors: errors };
  };

  // 导出命名：masks/<id>.png / hidden/<id>.png / cuts/<id>.png
  C.exportLayout = function (project) {
    var out = { manifest: 'annotations.json', label: 'label.png', preview: 'preview.png', masks: [], cuts: [], hidden: [] };
    project.parts.forEach(function (part) {
      out.masks.push('masks/' + part.id + '.png');
      out.cuts.push('cuts/' + part.id + '.png');
    });
    if (project.channels && project.channels.hidden) {
      project.parts.forEach(function (part) { out.hidden.push('hidden/' + part.id + '.png'); });
    }
    return out;
  };

  // ---------------------------------------------------------------- ZIP (store)
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  C.crc32 = function (bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  C.zipStore = function (files) {
    // files: [{name, bytes(Uint8Array)}] — store 方法（无压缩），零依赖
    var chunks = [], central = [];
    var offset = 0;
    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = f.bytes;
      var crc = C.crc32(data);
      var local = new Uint8Array(30 + name.length);
      var dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
      local.set(name, 30);
      chunks.push(local, data);
      var cen = new Uint8Array(46 + name.length);
      var cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cen.set(name, 46);
      central.push(cen);
      offset += local.length + data.length;
    });
    var centralSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    var total = offset + centralSize + end.length;
    var out = new Uint8Array(total), pos = 0;
    chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
    central.forEach(function (c) { out.set(c, pos); pos += c.length; });
    out.set(end, pos);
    return out;
  };

  C.parseDataUrl = function (url) {
    var m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(String(url || ''));
    if (!m) return null;
    var bytes;
    if (m[2]) {
      var bin = atob(m[3]);
      bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = utf8(decodeURIComponent(m[3]));
    }
    return { mime: m[1] || '', bytes: bytes };
  };

  root.PartAnnotatorCore = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof globalThis !== 'undefined' ? globalThis : this);