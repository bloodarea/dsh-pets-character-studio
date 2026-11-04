/* 语义标注器自测：core.js 的纯函数 + 工程 schema + ZIP 结构。
   浏览器：打开 selftest.html，结果写 window.__selftestResult。
   Node：node selftest.js（同一套断言，便于 CI/本地快速回归）。 */
(function () {
  'use strict';
  var isNode = typeof window === 'undefined' && typeof process !== 'undefined' && process.versions && process.versions.node;
  var C = isNode ? (typeof module !== 'undefined' && module.exports ? require('./core.js') : globalThis.PartAnnotatorCore)
                 : window.PartAnnotatorCore;
  var B = isNode ? ((typeof module !== 'undefined' && module.exports ? require('./bundle.js') : globalThis.PartAnnotatorBundle))
                 : window.PartAnnotatorBundle;
  if (!C) throw new Error('PartAnnotatorCore 未加载');
  var results = [];
  function test(name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, error: String(e && e.message || e) }); }
  }
  function eq(a, b, msg) {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
  }
  function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
  function near(a, b, eps) { if (Math.abs(a - b) > (eps || 1e-9)) throw new Error('expected ~' + b + ' got ' + a); }

  test('palette color cycles', function () {
    ok(C.paletteColor(0)[0] === '#');
    eq(C.paletteColor(C.PALETTE.length), C.paletteColor(0));
  });
  test('hexToRgb / rgbToHex roundtrip', function () {
    eq(C.hexToRgb('#ff8800'), { r: 255, g: 136, b: 0 });
    eq(C.rgbToHex(255, 136, 0), '#ff8800');
    eq(C.hexToRgb('bad'), { r: 136, g: 136, b: 136 });
  });
  test('createLabelMap zeroed', function () {
    var m = C.createLabelMap(4, 3);
    eq(m.length, 12);
    ok(m.every(function (v) { return v === 0; }));
  });
  test('drawRect fills and returns bbox', function () {
    var m = C.createLabelMap(5, 5);
    var b = C.drawRect(m, 5, 5, 1, 1, 3, 4, 2);
    eq(b, { x0: 1, y0: 1, x1: 3, y1: 4 });
    eq(m[1 * 5 + 1], 2);
    eq(m[3 * 5 + 2], 2);
    eq(m[0], 0);
  });
  test('drawRect clamps to canvas', function () {
    var m = C.createLabelMap(5, 5);
    var b = C.drawRect(m, 5, 5, -2, -2, 10, 10, 1);
    eq(b, { x0: 0, y0: 0, x1: 5, y1: 5 });
    eq(m[24], 1);
  });
  test('drawRect normalizes reversed corners', function () {
    var m = C.createLabelMap(5, 5);
    C.drawRect(m, 5, 5, 4, 4, 2, 2, 3);
    eq(m[2 * 5 + 2], 3);   // (2,2) 在框内
    eq(m[3 * 5 + 3], 3);   // (3,3) 在框内
    eq(m[4 * 5 + 4], 0);   // (4,4) 在右下开区间外
    eq(m[1 * 5 + 1], 0);
  });
  test('fillPolygon triangle area', function () {
    var m = C.createLabelMap(10, 10);
    var b = C.fillPolygon(m, 10, 10, [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 1, y: 9 }], 1);
    ok(b, 'bbox');
    var count = 0;
    for (var i = 0; i < m.length; i++) if (m[i] === 1) count++;
    ok(count > 20 && count < 60, 'triangle area ~32, got ' + count);
    eq(m[0], 0);
  });
  test('fillPolygon rejects <3 points', function () {
    var m = C.createLabelMap(4, 4);
    eq(C.fillPolygon(m, 4, 4, [{ x: 0, y: 0 }, { x: 1, y: 1 }], 1), null);
  });
  test('drawBrush circle', function () {
    var m = C.createLabelMap(20, 20);
    C.drawBrush(m, 20, 20, 10, 10, 3, 1);
    eq(m[10 * 20 + 10], 1);
    eq(m[0], 0);
  });
  test('drawBrushLine covers endpoints', function () {
    var m = C.createLabelMap(30, 10);
    C.drawBrushLine(m, 30, 10, 2, 5, 27, 5, 2, 4);
    eq(m[5 * 30 + 2], 4);
    eq(m[5 * 30 + 27], 4);
  });
  test('labelStats counts only known indexes', function () {
    var m = C.createLabelMap(4, 1);
    m[0] = 1; m[1] = 2; m[2] = 2; m[3] = 9;
    var s = C.labelStats(m, [{ id: 'a' }, { id: 'b' }]);
    eq(s[1], 1); eq(s[2], 2); eq(s[0], 0);
  });
  test('bboxOfValue', function () {
    var m = C.createLabelMap(6, 4);
    m[1 * 6 + 2] = 1; m[2 * 6 + 4] = 1;
    eq(C.bboxOfValue(m, 6, 4, 1), { x0: 2, y0: 1, x1: 5, y1: 3, area: 2 });
    eq(C.bboxOfValue(m, 6, 4, 7), null);
  });
  test('countComponents counts separate 4-connected blobs', function () {
    var m = C.createLabelMap(8, 4);
    // 块 A：左上 2x2；块 B：右下 2x2；块 C：单像素
    C.drawRect(m, 8, 4, 0, 0, 2, 2, 1);
    C.drawRect(m, 8, 4, 5, 2, 7, 4, 1);
    m[1 * 8 + 7] = 1;
    eq(C.countComponents(m, 8, 4, 1), 3);
    eq(C.countComponents(m, 8, 4, 1, 4), 2);     // 单像素块被 minArea=4 滤掉
    eq(C.countComponents(m, 8, 4, 1, 1, 2), 2);  // maxCount 早停
    eq(C.countComponents(m, 8, 4, 2), 0);        // 别的值
  });
  test('floodFill same color region', function () {
    var w = 6, h = 4;
    var rgba = new Uint8ClampedArray(w * h * 4);
    for (var i = 0; i < w * h; i++) { rgba[i * 4] = 10; rgba[i * 4 + 3] = 255; }
    rgba[(0 * w + 0) * 4] = 200; // 一个异色角
    var map = C.createLabelMap(w, h);
    var b = C.floodFill(rgba, w, h, 3, 2, 0, map, 1);
    ok(b, 'bbox');
    eq(map[0], 0);
    eq(map[3 * w + 3], 1);
    var n = 0; for (var k = 0; k < map.length; k++) if (map[k] === 1) n++;
    eq(n, w * h - 1);
  });
  test('floodFill tolerance and out-of-bounds', function () {
    var w = 3, h = 3;
    var rgba = new Uint8ClampedArray(w * h * 4);
    for (var i = 0; i < w * h; i++) rgba[i * 4] = 10;
    rgba[4] = 20;
    var map = C.createLabelMap(w, h);
    var b = C.floodFill(rgba, w, h, 0, 0, 15, map, 2);
    ok(b, 'bbox with tolerance');
    eq(map[4], 2);
    eq(C.floodFill(rgba, w, h, -1, 0, 15, map, 2), null);
  });
  test('diff undo restores region', function () {
    var m = C.createLabelMap(5, 5);
    C.drawRect(m, 5, 5, 1, 1, 4, 4, 7);
    var before = C.extractRegion(m, 5, { x0: 1, y0: 1, x1: 4, y1: 4 });
    m[2 * 5 + 2] = 0;
    var after = C.extractRegion(m, 5, { x0: 1, y0: 1, x1: 4, y1: 4 });
    var diff = { x0: 1, y0: 1, w: 3, h: 3, before: before, after: after };
    C.applyDiff(m, 5, diff, 'before');
    eq(m[2 * 5 + 2], 7);
  });
  test('normalizeId', function () {
    eq(C.normalizeId('Hair Front'), 'hair-front');
    eq(C.normalizeId('hair-front', ['hair-front']), 'hair-front-2');
    eq(C.normalizeId('!!!'), 'part');
    ok(C.SAFE_ID_RE.test(C.normalizeId('a b c')));
  });
  test('emptyProject + validateProject ok', function () {
    var p = C.emptyProject({ character: 'deepseek', view: 'front', width: 100, height: 200, source: 'x.png' });
    p.parts.push({ id: 'hair-back', name: '后发', z: 1 });
    var v = C.validateProject(p);
    eq(v.ok, true, JSON.stringify(v.errors));
  });
  test('validateProject rejects bad cases', function () {
    var p = C.emptyProject({ width: 10, height: 10 });
    p.parts.push({ id: 'bad id', name: 'x', z: 1 });
    eq(C.validateProject(p).ok, false);
    p = C.emptyProject({ width: 10, height: 10 });
    p.parts.push({ id: 'a', name: 'x', z: 1 }, { id: 'a', name: 'y', z: 2 });
    eq(C.validateProject(p).ok, false);
    eq(C.validateProject(C.emptyProject({ width: 0, height: 10 })).ok, false);
    eq(C.validateProject(null).ok, false);
  });
  test('exportLayout names', function () {
    var p = C.emptyProject({ width: 4, height: 4 });
    p.parts = [{ id: 'a', name: 'A', z: 1 }, { id: 'b', name: 'B', z: 2 }];
    p.channels.hidden = true;
    var L = C.exportLayout(p);
    eq(L.masks, ['masks/a.png', 'masks/b.png']);
    eq(L.hidden, ['hidden/a.png', 'hidden/b.png']);
    eq(L.cuts, ['cuts/a.png', 'cuts/b.png']);
  });
  test('crc32 known vector', function () {
    var bytes = new TextEncoder().encode('123456789');
    eq(C.crc32(bytes), 0xCBF43926);
  });
  test('zipStore has local/central/eocd structure', function () {
    var files = [{ name: 'a.txt', bytes: new TextEncoder().encode('hello') }];
    var zip = C.zipStore(files);
    var dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    eq(dv.getUint32(0, true), 0x04034b50);
    var eocdPos = zip.length - 22;
    eq(dv.getUint32(eocdPos, true), 0x06054b50);
    eq(dv.getUint16(eocdPos + 10, true), 1);
    eq(dv.getUint32(eocdPos + 16, true), zip.length - 22 - 46 - 5);
  });
  test('parseDataUrl base64', function () {
    var d = C.parseDataUrl('data:image/png;base64,aGVsbG8=');
    ok(d && d.mime === 'image/png');
    eq(Array.from(d.bytes), [104, 101, 108, 108, 111]);
    eq(C.parseDataUrl('nope'), null);
  });

  // ---------------------------------------------------------------- 拆件包 v1
  test('bundle: emptyIndex / emptyParts shape', function () {
    var idx = B.emptyIndex({ character: 'deepseek', view: 'front', width: 1091, height: 1442, parts: 2 });
    eq(idx.kind, 'parts-bundle');
    eq(idx.partsFile, 'parts.json');
    eq(idx.base.file, 'base.png');
    eq(idx.base.size, [1091, 1442]);
    var pl = B.emptyParts();
    eq(pl.kind, 'parts-list');
    eq(pl.backToFront, []);
  });
  test('bundle: validateIndex ok / bad', function () {
    var idx = B.emptyIndex({ width: 100, height: 200, parts: 1 });
    eq(B.validateIndex(idx).ok, true);
    var bad = B.emptyIndex({ width: 100, height: 200, parts: 1 });
    bad.base.file = 'x.png';
    eq(B.validateIndex(bad).ok, false);
    var bad2 = B.emptyIndex({ width: 100, height: 200, parts: 1 });
    bad2.canvas.width = 0;
    eq(B.validateIndex(bad2).ok, false);
    eq(B.validateIndex(null).ok, false);
  });
  test('bundle: validateParts ok / duplicate / backToFront', function () {
    var pl = B.emptyParts();
    pl.parts = [
      { id: 'hair-back', name: '后发', z: 1, files: { mask: 'masks/hair-back.png' } },
      { id: 'hair-front', name: '前发', z: 2, files: { mask: 'masks/hair-front.png' } }
    ];
    pl.backToFront = ['hair-back', 'hair-front'];
    eq(B.validateParts(pl).ok, true, JSON.stringify(B.validateParts(pl).errors));
    var dup = JSON.parse(JSON.stringify(pl));
    dup.parts[1].id = 'hair-back';
    eq(B.validateParts(dup).ok, false);
    var miss = JSON.parse(JSON.stringify(pl));
    miss.backToFront = ['hair-back'];
    eq(B.validateParts(miss).ok, false);
    var badpath = JSON.parse(JSON.stringify(pl));
    badpath.parts[0].files.mask = '../evil.png';
    eq(B.validateParts(badpath).ok, false);
  });
  test('bundle: validateBundle count mismatch', function () {
    var idx = B.emptyIndex({ width: 10, height: 10, parts: 2 });
    var pl = B.emptyParts();
    pl.parts = [{ id: 'a', name: 'A', z: 1 }];
    pl.backToFront = ['a'];
    eq(B.validateBundle(idx, pl).ok, false);
    idx.parts = 1;
    eq(B.validateBundle(idx, pl).ok, true, JSON.stringify(B.validateBundle(idx, pl).errors));
  });
  test('bundle: fromAnnotation wiring', function () {
    var project = {
      character: 'deepseek', view: 'front', canvas: { width: 10, height: 10 },
      source: 'assets/source/deepseek/three-view/front.png',
      channels: { visible: true, hidden: true },
      parts: [{ id: 'a', name: 'A', z: 1, color: '#fff' }, { id: 'b', name: 'B', z: 2, color: '#000' }]
    };
    var out = B.fromAnnotation(project, { label: 't' });
    eq(out.index.parts, 2);
    eq(out.parts.backToFront, ['a', 'b']);
    eq(out.parts.parts[0].files.mask, 'masks/a.png');
    eq(out.parts.parts[0].files.hiddenMask, 'hidden/a.png');
    eq(B.validateBundle(out.index, out.parts).ok, true, JSON.stringify(B.validateBundle(out.index, out.parts).errors));
  });
  test('bundle: toZipEntries puts index.json at root', function () {
    var idx = B.emptyIndex({ width: 10, height: 10, parts: 1 });
    var pl = B.emptyParts(); pl.parts = [{ id: 'a', name: 'A', z: 1 }]; pl.backToFront = ['a'];
    var entries = B.toZipEntries({
      index: idx, parts: pl,
      files: { 'base.png': new Uint8Array([1]), 'index.json': new Uint8Array([2]), 'parts.json': new Uint8Array([3]) }
    });
    eq(entries[0].name, 'index.json');
    eq(entries[1].name, 'parts.json');
    ok(entries.some(function (e) { return e.name === 'base.png'; }));
    var names = entries.map(function (e) { return e.name; });
    eq(names.length, new Set(names).size, 'zip entry names must be unique');
  });
  test('bundle: isSafeRelPath rejects escape', function () {
    eq(B.isSafeRelPath('masks/a.png'), true);
    eq(B.isSafeRelPath('../x.png'), false);
    eq(B.isSafeRelPath('/abs.png'), false);
    eq(B.isSafeRelPath('a\\b.png'), false);
  });
  test('bundle: issue path allow/deny', function () {
    eq(B.isImagePath('issues/issue-1.png'), true);
    eq(B.isImagePath('issues/issue-1-before.png'), true);
    eq(B.isImagePath('issues/issue-1-after.png'), true);
    eq(B.isImagePath('issues/../evil.png'), false);
    eq(B.isImagePath('issues.json'), true);
  });
  test('bundle: validateIssues ok / bad', function () {
    var doc = B.emptyIssues();
    eq(doc.kind, 'issues-list');
    doc.issues.push({
      id: 'issue-1', type: 'edge-missing', severity: 2, partId: 'hair-back', note: '缺一角',
      files: { region: 'issues/issue-1.png', before: 'issues/issue-1-before.png' }
    });
    eq(B.validateIssues(doc).ok, true, JSON.stringify(B.validateIssues(doc).errors));
    var badType = JSON.parse(JSON.stringify(doc)); badType.issues[0].type = 'nope';
    eq(B.validateIssues(badType).ok, false);
    var badSev = JSON.parse(JSON.stringify(doc)); badSev.issues[0].severity = 9;
    eq(B.validateIssues(badSev).ok, false);
    var noRegion = JSON.parse(JSON.stringify(doc)); delete noRegion.issues[0].files.region;
    eq(B.validateIssues(noRegion).ok, false);
    var dup = JSON.parse(JSON.stringify(doc)); dup.issues.push({ id: 'issue-1', type: 'jagged', severity: 1, files: { region: 'issues/issue-1.png' } });
    eq(B.validateIssues(dup).ok, false);
  });
  test('bundle: validateBundleWithIssues', function () {
    var idx = B.emptyIndex({ width: 10, height: 10, parts: 1 });
    var pl = B.emptyParts(); pl.parts = [{ id: 'a', name: 'A', z: 1 }]; pl.backToFront = ['a'];
    eq(B.validateBundleWithIssues(idx, pl, null).ok, true, JSON.stringify(B.validateBundleWithIssues(idx, pl, null).errors));
    idx.issuesFile = 'issues.json';
    idx.issues = 2;
    var doc = B.emptyIssues();
    doc.issues.push({ id: 'issue-1', type: 'jagged', severity: 1, files: { region: 'issues/issue-1.png' } });
    eq(B.validateBundleWithIssues(idx, pl, doc).ok, false); // 数量不符
    idx.issues = 1;
    eq(B.validateBundleWithIssues(idx, pl, doc).ok, true, JSON.stringify(B.validateBundleWithIssues(idx, pl, doc).errors));
    idx.issuesFile = 'other.json';
    eq(B.validateBundleWithIssues(idx, pl, doc).ok, false);
  });

  var failed = results.filter(function (r) { return !r.ok; }).length;
  var summary = { total: results.length, failed: failed, results: results };
  if (typeof globalThis !== 'undefined') globalThis.__selftestResult = summary;
  if (isNode) {
    summary.results.forEach(function (r) { console.log((r.ok ? 'ok  ' : 'FAIL') + '  ' + r.name + (r.error ? ' — ' + r.error : '')); });
    console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
    if (typeof module !== 'undefined' && module.exports) module.exports = summary;
    if (typeof process !== 'undefined') process.exitCode = failed ? 1 : 0;
  } else {
    window.__selftestResult = summary;
    var root = document.getElementById('out');
    if (root) {
      root.textContent = '';
      var head = document.createElement('h1');
      head.textContent = (results.length - failed) + ' / ' + results.length + ' passed';
      head.className = failed ? 'bad' : 'good';
      root.appendChild(head);
      results.forEach(function (r) {
        var div = document.createElement('div');
        div.className = 'case ' + (r.ok ? 'ok' : 'fail');
        div.textContent = (r.ok ? '✓ ' : '✗ ') + r.name + (r.error ? ' — ' + r.error : '');
        root.appendChild(div);
      });
    }
  }
})();