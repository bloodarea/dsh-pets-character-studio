/* =============================================================================
   立绘语义标注器 · 应用层
   - 原立绘 / 现有拆分件 / 标注工程载入
   - 多部件（语义层）编辑：矩形、多边形、画笔、橡皮、颜色魔法棒
   - 选区 -> 赋给当前件 / 从当前件减去 / 新建部件；合并、删除、调 z 序
   - 保存到 workspace（annotations.json + label + masks + cuts + preview）或导出 ZIP
   依赖：core.js（PartAnnotatorCore）
   ============================================================================= */
(function () {
  'use strict';

  var BUILD = '2026-11-04.2';

  var C = window.PartAnnotatorCore;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ---------------------------------------------------------------- 状态
  var S = {
    caps: null,
    img: null,               // HTMLImageElement 原立绘
    imgW: 0, imgH: 0,
    basePixels: null,        // Uint8ClampedArray（洪水填充用）
    maps: { visible: null, hidden: null },
    channel: 'visible',
    advanced: false,
    layout: 'single',          // single | dual | quad
    quadSelect: 'front',       // 四视图里被选中的立绘（部件叠加跟着它切换）
    hoverScreen: null,         // 指针在画布上的坐标（放大镜用）
    hoverPane: null,
    loupe: false,              // 按住 Alt 显示放大镜
    panes: [],
    paneOrigin: { x: 0, y: 0 },
    baseMode: 'stack',         // stack = 完整部件层叠（默认，能看见被遮挡的部分）；art = 纯原立绘
    stackCanvas: null,
    stackDirty: true,
    layerImages: {},           // id -> { img, ok }
    artImages: {},             // view -> Image | false
    mode: 'issues',           // 默认只记录问题；部件编辑需开启高级编辑
    usedIssueIds: {},
    onlyIssuePart: false,
    partPreview: null,
    partPreviewKey: '',
    parts: [],
    activeId: null,
    nextZ: 1,
    // [{id,type,severity,partId,beforePartId,note,masks:{region,before,after},createdAt}]
    // region / after 是“可累加的选区”（多个矩形/多边形/魔法棒叠加成一块或多块）；
    // before 不画选区，直接由 beforePartId 指向的拆分件的可见区生成。
    issues: [],
    activeIssueId: null,
    issueTarget: 'region',    // region | before | after
    showIssues: true,
    issueOverlayDirty: true,
    tool: 'rect',
    lastPaintTool: 'rect',    // 切到「改动前」（选择工具）前用的绘制工具，切回来时恢复
    zoom: 1, tx: 0, ty: 0,
    showMask: true, showOutline: true, showBase: true,
    brushSize: 18, tolerance: 28, autoAssign: true,
    selection: null,          // {type:'rect',x0,y0,x1,y1} | {type:'poly',points:[{x,y}]}
    hover: null,              // 指针图像坐标
    drag: null,
    undo: [], redo: [],
    dirty: false,
    sourcePath: '',
    projectDir: '',
    projectName: '',
    character: 'deepseek',
    view: 'front',
    overlayDirty: true,
    outlineDirty: true,
    visibilityDirty: true,
    visibilityCanvas: null,
    outlinePart: null,
    outlineCanvas: null,
    raf: 0
  };

  var cv, ctx, stage;
  var checker = null;
  var overlayCanvas = null, overlayCtx = null;
  var issueCanvas = null, issueCtx = null;
  var maskCanvas = null, maskCtx = null;
  var dpr = 1;

  // ---------------------------------------------------------------- 小工具
  function msg(text, hint) {
    $('#statusMsg').textContent = text;
    if (hint !== undefined) $('#statusHint').textContent = hint;
  }
  function setDirty(v) {
    S.dirty = v;
    document.title = (v ? '● ' : '') + '立绘问题标注';
    $('#btnSave').classList.toggle('unsaved', !!v);
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function nowIso() { return new Date().toISOString(); }
  function partIndex(id) {
    for (var i = 0; i < S.parts.length; i++) if (S.parts[i].id === id) return i + 1;
    return 0;
  }
  function activePart() {
    var idx = partIndex(S.activeId);
    return idx ? S.parts[idx - 1] : null;
  }
  function partLabel(p) {
    if (!p) return '整张立绘';
    if (S.advanced || p.name !== p.id) return p.name;
    var names = { 'hair-front': '前发', 'hair-back': '后发', hairband: '发带', tail: '尾巴', neck: '脖子', skirt: '裙子', topwear: '上衣', 'head-face': '头和脸', nose: '鼻子', mouth: '嘴巴', 'fin-ear': '耳鳍', shoe: '鞋子', arm: '手臂', eyewhite: '眼白', iris: '瞳孔', eyebrow: '眉毛', eyelash: '睫毛' };
    if (names[p.id]) return names[p.id];
    var m = /^(.*)-(l|r)$/.exec(p.id);
    return m && names[m[1]] ? (m[2] === 'l' ? '左' : '右') + names[m[1]] : p.name;
  }
  function channelMap(ch) { return S.maps[ch || S.channel]; }
  function scheduleRender() {
    if (S.raf) return;
    S.raf = requestAnimationFrame(function () { S.raf = 0; render(); });
  }
  function hexToRgba(hex, a) {
    var c = C.hexToRgb(hex);
    return [c.r, c.g, c.b, a | 0];
  }
  function isEditableTarget(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  }

  function cancelPendingSelection() {
    S.selection = null;
    // 已落下的画笔先结束，以保留这一步的撤销记录；未闭合框选直接取消。
    if (S.drag && S.drag.stroke) endStroke({});
    S.drag = null;
    updateSelectionBar();
    closeContextMenu();
    scheduleRender();
  }
  function stopDrawing(commit) {
    if (commit !== false && S.mode === 'issues' && S.issueTarget !== 'before' && currentSelectionBbox()) applyIssueSelection();
    cancelPendingSelection();
    setTool('select');
    msg('已停止圈选，可继续写说明或保存');
  }
  function setAdvanced(enabled) {
    cancelPendingSelection();
    S.advanced = !!enabled;
    document.body.classList.toggle('simple', !S.advanced);
    $('#btnAdvanced').textContent = S.advanced ? '返回问题标注' : '高级编辑';
    $('#btnAdvanced').setAttribute('aria-pressed', S.advanced ? 'true' : 'false');
    if (!S.advanced) { S.issueTarget = 'region'; S.onlyIssuePart = false; $('#onlyIssuePart').checked = false; }
    setMode(S.advanced ? 'parts' : 'issues');
    setTool('select');
    S.issueOverlayDirty = true;
    S.visibilityDirty = true;
    renderParts();
    updateIssueGuide();
    layoutCanvas();
  }
  function updateIssueGuide() {
    var it = activeIssue();
    $('#issueEditor').disabled = !it;
    $('#btnDeleteIssue').disabled = !it;
    $('#btnAddIssue').disabled = !S.img || !S.parts.length;
    $('#onlyIssuePart').disabled = !it || !partById(it.partId);
    if ($('#onlyIssuePart').disabled) { S.onlyIssuePart = false; $('#onlyIssuePart').checked = false; }
    var previewing = !S.advanced && S.onlyIssuePart && !!S.partPreview;
    $('#showMask').disabled = previewing;
    $('#showMask').parentNode.title = previewing ? '「只看这个部件」时不叠加部件颜色' : '按部件给画面上色';
    var toolHints = {
      select: '已停止圈选，拖动画面可移动视图。',
      rect: '拖出矩形框，可连续标多处。',
      poly: '逐点点击，双击或 Enter 完成一个框。',
      wand: '点击相近颜色的区域，可调节容差。',
      brush: '用画笔涂出需要标记的地方。',
      eraser: '只擦掉当前标记，原图不会被擦掉。'
    };
    var target = S.issueTarget === 'after' ? '期望范围' : '问题位置';
    $('#issueStepHint').textContent = !it ? '先点「添加问题」。' : (S.tool === 'select' ? toolHints.select : '正在标记' + target + '。' + (toolHints[S.tool] || ''));
    var n = it ? maskCount(it.masks.region) : 0;
    var rb = it ? issueBlocks(it).region : 0;
    $('#issueRegionState').textContent = n ? ('✓ 已圈出问题位置' + (rb > 1 ? '（' + rb + ' 块）' : '')) : '还没圈选问题位置';
    var info = [];
    if (S.selection) {
      var pend = currentSelectionBbox();
      if (pend) info.push('当前选区 ' + pend.x0 + ',' + pend.y0 + ' · ' + (pend.x1 - pend.x0) + '×' + (pend.y1 - pend.y0));
    }
    if (it) {
      var bb = C.bboxOfValue(it.masks.region, S.imgW, S.imgH, 1);
      if (bb) info.push('已标记 ' + bb.x0 + ',' + bb.y0 + ' · ' + (bb.x1 - bb.x0) + '×' + (bb.y1 - bb.y0) + '（' + n.toLocaleString() + ' px）');
    }
    var infoEl = $('#issueSelInfo');
    if (infoEl) infoEl.textContent = info.join(' ｜ ') || '（选区会显示 x,y 和宽×高）';
    $('#issueAfterState').textContent = it && maskCount(it.masks.after) ? '✓ 已补充期望范围，可继续修改。' : '不确定怎么圈，写在说明里也可以。';
    $('#targetRegion').setAttribute('aria-pressed', S.issueTarget === 'region' && S.tool !== 'select' ? 'true' : 'false');
    $('#targetAfter').setAttribute('aria-pressed', S.issueTarget === 'after' && S.tool !== 'select' ? 'true' : 'false');
    $('#btnStopDrawing').disabled = !it || S.tool === 'select';
    $('label:has(#brushSize)').hidden = !S.advanced && S.tool !== 'brush' && S.tool !== 'eraser';
    $('label:has(#tolerance)').hidden = S.tool !== 'wand';
    refreshPartPreview();
  }
  function refreshPartPreview() {
    var it = activeIssue(), p = it && partById(it.partId);
    var src = p && S.layerSources && S.layerSources[p.id];
    var key = S.onlyIssuePart && p ? (src || p.id) : '';
    if (key === S.partPreviewKey) return;
    S.partPreviewKey = key; S.partPreview = null; S.partPreviewPixels = null;
    function setPreview(img) {
      var canvas = document.createElement('canvas');
      canvas.width = S.imgW; canvas.height = S.imgH;
      var c = canvas.getContext('2d'); c.drawImage(img, 0, 0);
      S.partPreviewPixels = c.getImageData(0, 0, S.imgW, S.imgH).data;
      S.partPreview = img;
      scheduleRender();
    }
    if (!key) { scheduleRender(); return; }
    if (!src) {
      setPreview(makeCutCanvas(S.maps.visible, partIndex(p.id)));
      return;
    }
    var img = new Image();
    img.onload = function () { if (S.partPreviewKey === key) setPreview(img); };
    img.onerror = function () { if (S.partPreviewKey === key) { msg('这个部件的图片暂时无法显示，请查看整张立绘'); S.onlyIssuePart = false; $('#onlyIssuePart').checked = false; S.partPreviewKey = ''; scheduleRender(); } };
    img.src = repoUrl(src);
  }

  // ---------------------------------------------------------------- 画布 / 视图
  function layoutCanvas() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!cv || !stage) return;
    var w = stage.clientWidth, h = stage.clientHeight;
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    buildChecker();
    syncPaneOrigin();
    scheduleRender();
  }

  function buildChecker() {
    var size = 16;
    checker = document.createElement('canvas');
    checker.width = checker.height = size * 2;
    var c = checker.getContext('2d');
    c.fillStyle = '#20242e';
    c.fillRect(0, 0, size * 2, size * 2);
    c.fillStyle = '#262b37';
    c.fillRect(0, 0, size, size);
    c.fillRect(size, size, size, size);
  }

  function fitView() {
    if (!S.img) return;
    var e = editPane();
    var z = Math.min((e.w - 32) / S.imgW, (e.h - 32) / S.imgH);
    S.zoom = clamp(z, 0.02, 8);
    S.tx = (e.w - S.imgW * S.zoom) / 2;
    S.ty = (e.h - S.imgH * S.zoom) / 2;
    updateZoomLabel();
    scheduleRender();
  }

  function updateZoomLabel() {
    $('#zoomLabel').textContent = Math.round(S.zoom * 100) + '%';
  }

  function screenToImage(px, py) {
    return { x: (px - S.tx) / S.zoom, y: (py - S.ty) / S.zoom };
  }
  // 取整到像素：加一点点余量，避免浮点误差把整坐标算成 x.999999 落到相邻像素
  function pixelAt(v) { return Math.floor(v + 1e-6); }
  // 指针位置 → 编辑窗格内的本地坐标（画布坐标减去窗格原点）
  function cursorPos(ev) {
    var rect = cv.getBoundingClientRect();
    return { x: ev.clientX - rect.left - S.paneOrigin.x, y: ev.clientY - rect.top - S.paneOrigin.y };
  }
  // 指针落在哪一格，就按那一格的变换换成图像坐标（双视图左=原图、右=叠加图，两格都能画）
  function imagePointFor(ev) {
    var rect = cv.getBoundingClientRect();
    var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    var p = paneAt(x, y) || editPane();
    if (p.kind === 'edit') return { x: (x - p.x - S.tx) / S.zoom, y: (y - p.y - S.ty) / S.zoom };
    var r = paneRect(p, S.imgW, S.imgH);
    if (!r || !r.s) return { x: 0, y: 0 };
    return { x: (x - p.x - r.x) / r.s, y: (y - p.y - r.y) / r.s };
  }
  function canDrawAt(ev) {
    var rect = cv.getBoundingClientRect();
    var p = paneAt(ev.clientX - rect.left, ev.clientY - rect.top);
    if (!p) return false;
    if (p.kind === 'edit') return true;
    return p.kind === 'composite' && S.quadSelect === S.view;
  }
  function inEditPane(ev) {
    var rect = cv.getBoundingClientRect();
    var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    var e = editPane();
    return x >= e.x && y >= e.y && x <= e.x + e.w && y <= e.y + e.h;
  }
  function imageToScreen(ix, iy) {
    return { x: S.tx + ix * S.zoom, y: S.ty + iy * S.zoom };
  }

  function ensureOverlayCanvas() {
    if (!overlayCanvas || overlayCanvas.width !== S.imgW || overlayCanvas.height !== S.imgH) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = S.imgW;
      overlayCanvas.height = S.imgH;
      overlayCtx = overlayCanvas.getContext('2d');
      S.overlayDirty = true;
    }
    if (!maskCanvas || maskCanvas.width !== S.imgW || maskCanvas.height !== S.imgH) {
      maskCanvas = document.createElement('canvas');
      maskCanvas.width = S.imgW;
      maskCanvas.height = S.imgH;
      maskCtx = maskCanvas.getContext('2d');
    }
  }

  // 把标签图渲染成带色叠加（只在掩码/选中变化时重建）
  function rebuildOverlay() {
    if (!S.img) return;
    ensureOverlayCanvas();
    var map = channelMap();
    var data = overlayCtx.createImageData(S.imgW, S.imgH);
    var buf = data.data;
    var activeIdx = partIndex(S.activeId);
    var colorCache = {};
    for (var i = 0; i < S.parts.length; i++) {
      if (S.parts[i].visible === false) continue;   // 隐藏的部件不上色
      colorCache[i + 1] = hexToRgba(S.parts[i].color, i + 1 === activeIdx ? 190 : 120);
    }
    for (var p = 0; p < map.length; p++) {
      var v = map[p];
      if (!v) continue;
      var col = colorCache[v];
      if (!col) continue;
      var o = p * 4;
      buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = col[3];
    }
    overlayCtx.putImageData(data, 0, 0);
    S.overlayDirty = false;
  }

  function rebuildOutline() {
    S.outlineDirty = false;
    S.outlineCanvas = null;
    var idx = partIndex(S.activeId);
    if (!idx || !S.showOutline) return;
    if (S.parts[idx - 1] && S.parts[idx - 1].visible === false) return;
    var map = channelMap();
    var w = S.imgW, h = S.imgH;
    var col = C.hexToRgb(S.parts[idx - 1].color || '#ff6b6b');
    // 先标记选中件的边界像素，再在边界外侧补一圈深色，任何底色上都看得清
    var edge = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var p = y * w + x;
        if (map[p] !== idx) continue;
        if ((x === 0 || map[p - 1] !== idx) || (x === w - 1 || map[p + 1] !== idx) ||
            (y === 0 || map[p - w] !== idx) || (y === h - 1 || map[p + w] !== idx)) {
          edge[p] = 1;
        }
      }
    }
    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    var c = out.getContext('2d');
    var data = c.createImageData(w, h);
    var buf = data.data;
    for (var y2 = 0; y2 < h; y2++) {
      for (var x2 = 0; x2 < w; x2++) {
        var q = y2 * w + x2;
        var o = q * 4;
        if (edge[q]) {
          buf[o] = 255; buf[o + 1] = 255; buf[o + 2] = 255; buf[o + 3] = 240;
          continue;
        }
        var nearEdge = (x2 > 0 && edge[q - 1]) || (x2 < w - 1 && edge[q + 1]) ||
                       (y2 > 0 && edge[q - w]) || (y2 < h - 1 && edge[q + w]);
        if (nearEdge) {
          if (map[q] === idx) {
            // 往部件内部再加一圈白，缩小时也看得见
            buf[o] = 255; buf[o + 1] = 255; buf[o + 2] = 255; buf[o + 3] = 200;
          } else {
            buf[o] = 13; buf[o + 1] = 16; buf[o + 2] = 23; buf[o + 3] = 170;
          }
        } else if (map[q] === idx && !S.showMask) {
          // 没开“部件颜色”时，选中件按自身配色铺一层，强度对齐颜色块，一眼可辨
          buf[o] = col.r; buf[o + 1] = col.g; buf[o + 2] = col.b; buf[o + 3] = 150;
        }
      }
    }
    c.putImageData(data, 0, 0);
    S.outlineCanvas = out;
  }

  // 图层可见性：隐藏部件时从底图里抠掉它（但不抠掉盖在它上面的可见件）
  // 一次遍历：label 图里每个像素的归属件如果被隐藏，就把该像素置空（棋盘格露出来）——
  // 像素归属唯一，所以“盖在上面的可见件”天然不会被抠掉。
  function rebuildVisibility() {
    S.visibilityDirty = false;
    S.visibilityCanvas = null;
    if (!S.img || !S.maps.visible) return;
    var anyHidden = false;
    for (var k = 0; k < S.parts.length; k++) {
      if (S.parts[k].visible === false) { anyHidden = true; break; }
    }
    if (!anyHidden || !S.parts.length) return;
    var w = S.imgW, h = S.imgH, map = S.maps.visible;
    var hiddenFlags = new Uint8Array(S.parts.length + 1);   // 下标 = 标签值
    S.parts.forEach(function (p, i) { if (p.visible === false) hiddenFlags[i + 1] = 1; });
    var cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    var c = cvs.getContext('2d');
    c.drawImage(S.img, 0, 0);
    var img = c.getImageData(0, 0, w, h);
    var buf = img.data;
    for (var i = 0, n = map.length; i < n; i++) {
      var v = map[i];
      if (!v || !hiddenFlags[v]) continue;
      var o = i * 4;
      buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = 0;
    }
    c.putImageData(img, 0, 0);
    S.visibilityCanvas = cvs;
  }

  // ---------------------------------------------------------------- 视图布局（单 / 双 / 四视图）
  function viewArtUrl(view) { return 'assets/source/' + S.character + '/three-view/' + view + '.png'; }
  function paneLayout() {
    var w = Math.min(stage.clientWidth, cv ? cv.width / dpr : stage.clientWidth);
    var h = Math.min(stage.clientHeight, cv ? cv.height / dpr : stage.clientHeight);
    var gap = 10;
    if (S.layout === 'dual') {
      var pw = Math.floor((w - gap) / 2);
      return [
        { key: 'edit', kind: 'edit', label: '原立绘', x: 0, y: 0, w: pw, h: h },
        { key: 'stack', kind: 'composite', label: '部件叠加', x: pw + gap, y: 0, w: w - pw - gap, h: h }
      ];
    }
    if (S.layout === 'quad') {
      var qw = Math.floor((w - gap) / 2), qh = Math.floor((h - gap) / 2);
      var views = [['front', '正面立绘', 0, 0], ['side', '侧面立绘', qw + gap, 0], ['back', '背面立绘', 0, qh + gap]];
      var out = views.map(function (v) {
        return {
          key: v[0], view: v[0], label: v[1], x: v[2], y: v[3],
          w: v[0] === 'side' ? w - qw - gap : qw,
          h: v[0] === 'back' ? h - qh - gap : qh,
          kind: v[0] === S.view ? 'edit' : 'art'
        };
      });
      out.push({ key: 'stack', kind: 'composite', label: '部件叠加', x: qw + gap, y: qh + gap, w: w - qw - gap, h: h - qh - gap });
      return out;
    }
    return [{ key: 'edit', kind: 'edit', label: '', x: 0, y: 0, w: w, h: h }];
  }
  function editPane() {
    var panes = paneLayout();
    for (var i = 0; i < panes.length; i++) if (panes[i].kind === 'edit') return panes[i];
    return panes[0];
  }
  function paneAt(x, y) {
    var panes = paneLayout();
    for (var i = 0; i < panes.length; i++) {
      var p = panes[i];
      if (x >= p.x && y >= p.y && x <= p.x + p.w && y <= p.y + p.h) return p;
    }
    return null;
  }
  // 四视图：点某张立绘 = 选中它（部件叠加跟着切换；绿框提示）
  function selectQuadView(view) {
    if (!view || S.quadSelect === view) { scheduleRender(); return; }
    S.quadSelect = view;
    var hasBundle = view === S.view;
    msg('已选中' + ({ front: '正面', side: '侧面', back: '背面' }[view] || view) + '立绘 · ' +
      (hasBundle ? '部件叠加显示这个视图的拆件' : '这个视图还没有拆分件'));
    scheduleRender();
  }
  function syncPaneOrigin() {
    S.panes = paneLayout();
    S.paneOrigin = { x: S.panes[0].x, y: S.panes[0].y };
  }
  function syncBaseToggle() {
    var onlySingle = S.layout === 'single';
    var box = $('#useStack');
    if (box) box.disabled = !onlySingle;
    var wrap = box && box.parentNode;
    if (wrap) wrap.title = onlySingle
      ? '单视图的底图：用完整部件层叠（含被遮挡部分）；取消则用纯原立绘'
      : '双/四视图的立绘格始终是静态原图；完整部件只影响单视图';
  }
  function resetLayoutQuiet() {
    S.layout = 'single';
    S.quadSelect = S.view;
    $$('#viewSeg .btn').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.layout === 'single' ? 'true' : 'false');
    });
    syncPaneOrigin();
    syncBaseToggle();
  }
  function setLayout(mode) {
    if (S.layout === mode) return;
    cancelPendingSelection();
    S.layout = mode;
    $$('#viewSeg .btn').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.layout === mode ? 'true' : 'false'); });
    if (mode === 'quad') S.quadSelect = S.view;
    syncPaneOrigin();
    syncBaseToggle();
    if (mode !== 'single') ensureArtViews();
    fitView();
    msg({ single: '单视图', dual: '双视图：左原立绘、右部件叠加', quad: '四视图：正面 / 侧面 / 背面 / 部件叠加' }[mode]);
  }
  function ensureArtViews() {
    ['side', 'back'].forEach(function (v) {
      if (S.artImages[v] !== undefined) return;
      S.artImages[v] = null;
      var img = new Image();
      img.onload = function () { S.artImages[v] = img; scheduleRender(); };
      img.onerror = function () { S.artImages[v] = false; scheduleRender(); };
      img.src = repoUrl(viewArtUrl(v));
    });
  }
  // 每个部件的成品层（含被遮挡补全）；没有层图时退回可见区切图
  function ensureLayerImages() {
    if (!S.layerSources) return;
    Object.keys(S.layerSources).forEach(function (id) {
      if (S.layerImages[id]) return;
      var img = new Image();
      var rec = { img: img, ok: false };
      S.layerImages[id] = rec;
      img.onload = function () { rec.ok = true; S.stackDirty = true; scheduleRender(); };
      img.onerror = function () { rec.ok = false; S.stackDirty = true; scheduleRender(); };
      img.src = repoUrl(S.layerSources[id]);
    });
  }
  function rebuildStack() {
    S.stackDirty = false;
    S.stackCanvas = null;
    if (!S.img || !S.parts.length) return;
    var cvs = document.createElement('canvas');
    cvs.width = S.imgW; cvs.height = S.imgH;
    var c = cvs.getContext('2d');
    S.parts.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (p) {
      if (p.visible === false) return;
      var rec = S.layerImages[p.id];
      if (rec && rec.ok) { c.drawImage(rec.img, 0, 0); return; }
      var cut = makeCutCanvas(S.maps.visible, partIndex(p.id));
      if (cut) c.drawImage(cut, 0, 0);
    });
    S.stackCanvas = cvs;
  }
  function paneSource(p) {
    if (p.kind === 'art') {
      if (p.view === S.view && S.img) return { w: S.imgW, h: S.imgH, src: S.img };
      var a = S.artImages[p.view];
      return a ? { w: a.naturalWidth, h: a.naturalHeight, src: a } : null;
    }
    if (S.stackCanvas) return { w: S.imgW, h: S.imgH, src: S.stackCanvas };
    return null;
  }
  // 所有窗格共用一套缩放/位移（以编辑格为准），四视图才对齐；
  // 只有「部件叠加」格接受拖动/缩放，改的就是这一套，所以其它格跟着动。
  function paneFit(p, w, h) {
    return Math.max(1e-6, Math.min((p.w - 20) / w, (p.h - 20) / h));
  }
  function sharedView() {
    var e = editPane();
    var w = S.imgW || 1, h = S.imgH || 1;
    var fit = paneFit(e, w, h);
    return {
      z: S.zoom / fit,                                  // 相对“适配”的倍率
      tx: S.tx - (e.w - w * S.zoom) / 2,
      ty: S.ty - (e.h - h * S.zoom) / 2
    };
  }
  // 某格把 w×h 的图画在哪里（窗格内坐标 + 缩放）
  function paneRect(p, w, h) {
    var sv = sharedView();
    var sz = paneFit(p, w, h) * sv.z;
    return { x: (p.w - w * sz) / 2 + sv.tx, y: (p.h - h * sz) / 2 + sv.ty, s: sz };
  }
  function fitPaneKey() { fitView(); return true; }
  // 在部件叠加格里缩放：换算回同一套 S.zoom/S.tx/S.ty
  function zoomSharedAt(p, cx, cy, factor) {
    var e = editPane();
    var w = S.imgW, h = S.imgH;
    var lx = cx - p.x, ly = cy - p.y;
    var rc = paneRect(p, w, h);
    var ix = (lx - rc.x) / rc.s, iy = (ly - rc.y) / rc.s;
    var sv = sharedView();
    var z2 = clamp(sv.z * factor, 0.05, 40);
    var fitE = paneFit(e, w, h), fitC = paneFit(p, w, h);
    var s2 = fitC * z2;
    var ntx = lx - (p.w - w * s2) / 2 - ix * s2;
    var nty = ly - (p.h - h * s2) / 2 - iy * s2;
    S.zoom = clamp(fitE * z2, 0.02, 16);
    S.tx = ntx + (e.w - w * S.zoom) / 2;
    S.ty = nty + (e.h - h * S.zoom) / 2;
    updateZoomLabel();
    scheduleRender();
  }
  // 光标在“部件叠加”或对应立绘上时，在另一格同位置画一个绿点，方便对齐
  function drawHoverMarkers() {
    if (S.layout === 'single' || !S.hoverScreen || !S.hoverPane) return;
    var hp = S.hoverPane;
    if (hp.kind === 'art' && hp.view !== S.view) return;    // 侧/背图不是同一张画布，不联动
    if (hp.kind === 'composite' && S.quadSelect !== S.view) return;
    var rect = hp.kind === 'edit' ? { x: S.tx, y: S.ty, s: S.zoom } : paneRect(hp, S.imgW, S.imgH);
    if (!rect || !rect.s) return;
    var ix = (S.hoverScreen.x - hp.x - rect.x) / rect.s;
    var iy = (S.hoverScreen.y - hp.y - rect.y) / rect.s;
    if (!(ix >= 0 && iy >= 0 && ix <= S.imgW && iy <= S.imgH)) return;
    S.panes.forEach(function (q) {
      if (q === hp) return;
      // 编辑格（双视图的“原立绘”、四视图的正面）本身就是当前视图，一律联动
      var same = (q.kind === 'composite') ? (S.quadSelect === S.view) : (q.kind === 'edit' || q.view === S.view);
      if (!same) return;
      var rq = q.kind === 'edit' ? { x: S.tx, y: S.ty, s: S.zoom } : paneRect(q, S.imgW, S.imgH);
      var mx = q.x + rq.x + ix * rq.s, my = q.y + rq.y + iy * rq.s;
      if (mx < q.x || my < q.y || mx > q.x + q.w || my > q.y + q.h) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(q.x, q.y, q.w, q.h); ctx.clip();
      // 外圈深色描边 + 绿色实心 + 中心白点，缩到 20% 也还看得见
      ctx.strokeStyle = '#0d1017';
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(mx, my, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#4ec9a5';
      ctx.beginPath(); ctx.arc(mx, my, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(mx, my, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
  }
  function drawLoupe(mx, my) {
    var p = S.hoverPane;
    if (!p || !S.img) return;
    var src = paneSource(p);
    if (!src && p.kind === 'edit') src = { w: S.imgW, h: S.imgH, src: (S.baseMode === 'stack' && S.stackCanvas) ? S.stackCanvas : S.img };
    if (!src || !src.src) return;
    var t;
    if (p.kind === 'edit') t = { zoom: S.zoom, tx: S.tx, ty: S.ty };
    else { var lr = paneRect(p, src.w, src.h); t = { zoom: lr.s, tx: lr.x, ty: lr.y }; }
    var ix = (mx - p.x - t.tx) / t.zoom, iy = (my - p.y - t.ty) / t.zoom;
    var R = 86, M = 2.8, sw = (R * 2) / M;
    ctx.save();
    ctx.beginPath(); ctx.arc(mx, my, R, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.fillStyle = '#0d1017';
    ctx.fillRect(mx - R, my - R, R * 2, R * 2);
    ctx.imageSmoothingEnabled = true;
    try { ctx.drawImage(src.src, ix - sw / 2, iy - sw / 2, sw, sw, mx - R, my - R, R * 2, R * 2); } catch (e) { /* 源超出时忽略 */ }
    ctx.restore();
    ctx.strokeStyle = '#5aa9ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mx, my, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffffff66'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx - 10, my); ctx.lineTo(mx + 10, my);
    ctx.moveTo(mx, my - 10); ctx.lineTo(mx, my + 10);
    ctx.stroke();
  }
  function paneText(p, text) {
    ctx.fillStyle = '#8b98ad';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, p.x + p.w / 2, p.y + p.h / 2 + 4);
    ctx.textAlign = 'left';
  }
  function drawPaneFrame(p) {
    if (S.layout === 'single') return;
    var picked = S.layout === 'quad' && p.view && p.view === S.quadSelect;
    ctx.strokeStyle = picked ? '#4ec9a5' : '#2c3444';
    ctx.lineWidth = picked ? 2 : 1;
    var inset = picked ? 1.5 : 0.5;
    ctx.strokeRect(p.x + inset, p.y + inset, p.w - inset * 2, p.h - inset * 2);
  }
  function drawPaneLabel(p) {
    if (!p.label) return;
    ctx.fillStyle = '#e6ebf5';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(p.label, p.x + 8, p.y + 17);
  }

  function render() {
    if (!ctx) return;
    var w = cv.width / dpr, h = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#11141c';
    ctx.fillRect(0, 0, w, h);
    S.panes = paneLayout();
    S.paneOrigin = { x: S.panes[0].x, y: S.panes[0].y };
    if (!S.img) return;
    S.panes.forEach(function (p) {
      ctx.save();
      ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip();
      if (checker) {
        ctx.fillStyle = ctx.createPattern(checker, 'repeat');
      } else {
        ctx.fillStyle = '#20242e';
      }
      ctx.fillRect(p.x, p.y, p.w, p.h);
      if (p.kind === 'edit') {
        ctx.translate(p.x, p.y);
        renderEditPane();
      } else if (p.kind === 'art') {
        var art = p.view === S.view ? S.img : S.artImages[p.view];
        if (art) {
          var ra = paneRect(p, art.naturalWidth, art.naturalHeight);
          ctx.translate(p.x, p.y);
          ctx.imageSmoothingEnabled = ra.s < 2;
          ctx.drawImage(art, ra.x, ra.y, art.naturalWidth * ra.s, art.naturalHeight * ra.s);
        } else {
          paneText(p, art === false ? '暂无' + p.label : '载入中…');
        }
      } else {
        var sameView = S.quadSelect === S.view;
        if (sameView && S.stackDirty) rebuildStack();
        if (sameView && S.stackCanvas) {
          var rs = paneRect(p, S.imgW, S.imgH);
          ctx.translate(p.x, p.y);
          ctx.imageSmoothingEnabled = rs.s < 2;
          ctx.drawImage(S.stackCanvas, rs.x, rs.y, S.imgW * rs.s, S.imgH * rs.s);
          // 部件颜色只画在“部件叠加”这一格，三张立绘保持纯静态
          if (S.showMask) {
            if (S.overlayDirty) rebuildOverlay();
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(overlayCanvas, rs.x, rs.y, S.imgW * rs.s, S.imgH * rs.s);
          }
          // 选中件描边与颜色开关无关，这里也画，方便在叠加图上认位置
          if (S.showOutline) {
            if (S.outlineDirty) rebuildOutline();
            if (S.outlineCanvas) ctx.drawImage(S.outlineCanvas, rs.x, rs.y, S.imgW * rs.s, S.imgH * rs.s);
          }
        } else {
          var which = { front: '正面', side: '侧面', back: '背面' }[S.quadSelect] || '这个';
          paneText(p, !S.parts.length ? '还没有拆分件' : which + '立绘还没有拆分件');
        }
      }
      ctx.restore();
      drawPaneFrame(p);
      drawPaneLabel(p);
      if (p.kind === 'edit') {
        drawSelectionOverlay(p.x + S.tx, p.y + S.ty, S.zoom);
      } else if (p.kind === 'composite' && S.quadSelect === S.view && S.stackCanvas) {
        var rsel = paneRect(p, S.imgW, S.imgH);
        drawSelectionOverlay(p.x + rsel.x, p.y + rsel.y, rsel.s);
      }
    });
    drawHoverMarkers();
    if (S.loupe && S.hoverScreen) drawLoupe(S.hoverScreen.x, S.hoverScreen.y);
  }

  function renderEditPane() {
    var iw = S.imgW * S.zoom, ih = S.imgH * S.zoom;
    ctx.imageSmoothingEnabled = S.zoom < 2;
    if (S.stackDirty) rebuildStack();
    // 「只看这个部件」看该件成品图；
    // 单视图：按「完整部件」用层叠图或原立绘（眼睛隐藏的件会留空）；
    // 双/四视图：立绘格永远是静态原图，眼睛/底图开关只影响「部件叠加」格。
    var previewing = !S.advanced && S.onlyIssuePart && !!S.partPreview;
    var useStack = S.baseMode === 'stack' && !!S.stackCanvas && S.layout === 'single';
    if (previewing) {
      ctx.drawImage(S.partPreview, S.tx, S.ty, iw, ih);
    } else if (!S.advanced || S.showBase) {
      if (S.layout !== 'single') {
        ctx.drawImage(S.img, S.tx, S.ty, iw, ih);
      } else if (useStack) {
        ctx.drawImage(S.stackCanvas, S.tx, S.ty, iw, ih);
      } else {
        if (S.visibilityDirty) rebuildVisibility();
        ctx.drawImage(S.visibilityCanvas || S.img, S.tx, S.ty, iw, ih);
      }
    }
    // 部件颜色只在单视图的这块画布上叠；选中件描边与它无关，随时可见
    if (!previewing && S.layout === 'single') {
      ctx.imageSmoothingEnabled = false;
      if (S.showMask) {
        if (S.overlayDirty) rebuildOverlay();
        ctx.drawImage(overlayCanvas, S.tx, S.ty, iw, ih);
      }
      if (S.showOutline) {
        if (S.outlineDirty) rebuildOutline();
        if (S.outlineCanvas) ctx.drawImage(S.outlineCanvas, S.tx, S.ty, iw, ih);
      }
    }
    if ((!S.advanced || S.showIssues) && S.issues.length) {
      if (S.issueOverlayDirty) rebuildIssueOverlay();
      if (issueCanvas) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(issueCanvas, S.tx, S.ty, iw, ih);
      }
    }

  }

  // 选区预览与画笔光标：每格按自己的变换画，所以拖在哪一格都能看到虚线框
  function drawSelectionOverlay(ox, oy, scale) {
    var toScr = function (ix, iy) { return { x: ox + ix * scale, y: oy + iy * scale }; };
    if (S.selection) {
      ctx.save();
      ctx.strokeStyle = '#5aa9ff';
      ctx.fillStyle = 'rgba(90,169,255,0.12)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      if (S.selection.type === 'rect') {
        var r = S.selection;
        var a = toScr(r.x0, r.y0), b = toScr(r.x1, r.y1);
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      } else if (S.selection.type === 'poly' && S.selection.points.length) {
        ctx.beginPath();
        var p0 = toScr(S.selection.points[0].x, S.selection.points[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (var i = 1; i < S.selection.points.length; i++) {
          var pp = toScr(S.selection.points[i].x, S.selection.points[i].y);
          ctx.lineTo(pp.x, pp.y);
        }
        if (S.hover) {
          var hp = toScr(S.hover.x, S.hover.y);
          ctx.lineTo(hp.x, hp.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // 画笔光标
    if ((S.tool === 'brush' || S.tool === 'eraser') && S.hover) {
      var c = toScr(S.hover.x, S.hover.y);
      ctx.save();
      ctx.strokeStyle = '#ffffffcc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(2, S.brushSize * scale / 2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- 部件
  function partById(id) {
    for (var i = 0; i < S.parts.length; i++) if (S.parts[i].id === id) return S.parts[i];
    return null;
  }
  function sortedParts() {
    return S.parts.slice().sort(function (a, b) { return b.z - a.z; });
  }
  function createPart(name, color) {
    var id = C.normalizeId(name || ('part-' + (S.parts.length + 1)), S.parts.map(function (p) { return p.id; }));
    var part = {
      id: id,
      name: name || id,
      color: color || C.paletteColor(S.parts.length),
      z: S.nextZ++,
      note: '',
      visible: true
    };
    S.parts.push(part);
    S.activeId = part.id;
    S.outlineDirty = true;
    S.overlayDirty = true;
    setDirty(true);
    renderParts();
    scheduleRender();
    return part;
  }
  function deletePart(part) {
    var idx = partIndex(part.id);
    if (!idx) return;
    if (!confirm('删除部件「' + part.name + '」？它的像素会变为未标注（可用撤销恢复）。')) return;
    snapshotAll();
    S.parts.splice(idx - 1, 1);
    remapLabelsAfterDelete(idx);
    if (S.activeId === part.id) S.activeId = S.parts.length ? S.parts[0].id : null;
    S.overlayDirty = true; S.outlineDirty = true;
    setDirty(true);
    renderParts(); scheduleRender();
    msg('已删除部件 ' + part.name);
  }
  function remapLabelsAfterDelete(idx) {
    ['visible', 'hidden'].forEach(function (ch) {
      var map = S.maps[ch];
      if (!map) return;
      for (var i = 0; i < map.length; i++) {
        var v = map[i];
        if (v === idx) map[i] = 0;
        else if (v > idx) map[i] = v - 1;
      }
    });
  }
  function mergePart(source, target) {
    if (!source || !target || source.id === target.id) return;
    var si = partIndex(source.id), ti = partIndex(target.id);
    if (!si || !ti) return;
    snapshotAll();
    ['visible', 'hidden'].forEach(function (ch) {
      var map = S.maps[ch];
      if (!map) return;
      for (var i = 0; i < map.length; i++) if (map[i] === si) map[i] = ti;
    });
    S.parts.splice(si - 1, 1);
    if (si < ti) ti -= 1;
    remapLabelsAfterDelete(si); // 先移除索引，再修正 >si 的编号
    renumberParts();
    S.activeId = target.id;
    S.overlayDirty = true; S.outlineDirty = true;
    setDirty(true);
    renderParts(); scheduleRender();
    msg('已把 ' + source.name + ' 合并到 ' + target.name);
  }
  function renumberParts() {
    // 保证 z 唯一且按数组顺序递增；列表按 z 倒序显示
    S.parts.forEach(function (p, i) { p.z = i + 1; });
    S.nextZ = S.parts.length + 1;
  }
  function moveZ(part, dir) {
    var list = sortedParts();
    var idx = list.indexOf(part);
    var swap = idx + dir;
    if (swap < 0 || swap >= list.length) return;
    var other = list[swap];
    var tmp = part.z; part.z = other.z; other.z = tmp;
    setDirty(true); renderParts(); scheduleRender();
  }

  function renderParts() {
    var list = $('#partList');
    var q = ($('#partSearch').value || '').trim().toLowerCase();
    var rows = sortedParts().filter(function (p) {
      return !q || p.name.toLowerCase().indexOf(q) >= 0 || p.id.indexOf(q) >= 0;
    });
    list.innerHTML = '';
    rows.forEach(function (p) {
      var idx = partIndex(p.id);
      var count = 0;
      ['visible', 'hidden'].forEach(function (ch) {
        var m = S.maps[ch]; if (!m) return;
        for (var i = 0; i < m.length; i++) if (m[i] === idx) count++;
      });
      var li = document.createElement('li');
      li.className = 'part-row' + (p.id === S.activeId ? ' selected' : '');
      li.setAttribute('role', 'option');
      li.dataset.id = p.id;
      li.innerHTML =
        '<span class="chip" style="background:' + p.color + '"></span>' +
        '<span class="pname"></span>' +
        '<span class="ppx mono">' + (count >= 10000 ? (Math.round(count / 1000) + 'k') : count) + '</span>' +
        '<button class="eye' + (p.visible ? '' : ' off') + '" type="button" title="显示/隐藏（不影响导出）">' +
          '<svg class="ic"><use href="#' + (p.visible ? 'i-eye' : 'i-eye-off') + '"></use></svg></button>' +
        '<button class="zbtn" type="button" data-z="1" title="上移一层">▲</button>' +
        '<button class="zbtn" type="button" data-z="-1" title="下移一层">▼</button>';
      li.querySelector('.pname').textContent = S.advanced ? p.name : partLabel(p);
      li.addEventListener('click', function (ev) {
        if (ev.target.closest('.eye')) {
          p.visible = !p.visible;
          S.overlayDirty = true; S.outlineDirty = true; S.visibilityDirty = true; S.stackDirty = true;
          renderParts(); scheduleRender();
          ev.stopPropagation(); return;
        }
        var zb = ev.target.closest('.zbtn');
        if (zb) { moveZ(p, Number(zb.dataset.z)); ev.stopPropagation(); return; }
        // 再点一次同一件 = 取消选择（高亮消失）
        if (p.id === S.activeId) {
          S.activeId = null;
          S.outlineDirty = true; S.overlayDirty = true;
          renderParts(); scheduleRender();
          msg('已取消选中 ' + partLabel(p));
          return;
        }
        selectPart(p.id);
        if (!S.advanced) {
          var it0 = activeIssue();
          if (it0) {
            setIssueBeforeFromPart(it0, p.id, { linkPart: true, silent: true });
            msg('这个问题的问题部件 = ' + partLabel(p) + '，在图上圈出问题位置即可');
          } else {
            msg('已选中 ' + partLabel(p) + '；先点「添加问题」才能记录');
          }
        }
      });
      list.appendChild(li);
    });
    $('#partsCount').textContent = S.parts.length + ' 件';
    if (!S.parts.length) {
      var empty = document.createElement('li');
      empty.className = 'part-row dim';
      empty.textContent = '还没有部件 —— 点「新建」或载入现有拆分件';
      list.appendChild(empty);
    }
    updateInspector();
  }

  function selectPart(id) {
    S.activeId = id;
    S.outlineDirty = true;
    S.overlayDirty = true;
    renderParts();
    scheduleRender();
  }

  function updateInspector() {
    var p = activePart();
    $('#activePartId').textContent = p ? p.id : '—';
    if (!p) return;
    $('#partName').value = p.name;
    $('#partId').value = p.id;
    $('#partColor').value = p.color;
    $('#partNote').value = p.note || '';
    var idx = partIndex(p.id);
    var count = 0;
    ['visible', 'hidden'].forEach(function (ch) {
      var m = S.maps[ch]; if (!m) return;
      for (var i = 0; i < m.length; i++) if (m[i] === idx) count++;
    });
    $('#statPx').textContent = count.toLocaleString();
    $('#statPct').textContent = S.imgW ? (100 * count / (S.imgW * S.imgH)).toFixed(2) + '%' : '—';
    $('#statZ').textContent = p.z;
    $('#statChannel').textContent = S.channel;
  }

  // ---------------------------------------------------------------- 问题标注（issues）
  function issueDefs() { return window.PartAnnotatorBundle || {}; }
  function issueColor(type) {
    var d = issueDefs();
    return (d.ISSUE_COLORS && d.ISSUE_COLORS[type]) || '#adb5bd';
  }
  function issueLabel(type) {
    var d = issueDefs();
    return (d.ISSUE_LABELS && d.ISSUE_LABELS[type]) || type;
  }
  function activeIssue() {
    for (var i = 0; i < S.issues.length; i++) if (S.issues[i].id === S.activeIssueId) return S.issues[i];
    return null;
  }
  function newIssueId() {
    var used = {};
    S.issues.forEach(function (it) { used[it.id] = 1; });
    var n = 1;
    while (used['issue-' + n] || S.usedIssueIds['issue-' + n]) n++;
    S.usedIssueIds['issue-' + n] = true;
    return 'issue-' + n;
  }
  function createIssue(opts) {
    if (!S.img) { msg('先载入原立绘/拆件包'); return null; }
    if (!S.parts.length) { msg('先打开拆件工程：问题必须指向一个已拆分的部件'); return null; }
    cancelPendingSelection();
    var o = opts || {};
    var pid = o.partId !== undefined ? o.partId : (S.activeId || (sortedParts()[0] ? sortedParts()[0].id : ''));
    var it = {
      id: newIssueId(),
      type: o.type || 'other',
      severity: o.severity || 2,
      partId: pid,
      beforePartId: o.beforePartId !== undefined ? o.beforePartId : pid,
      note: o.note || '',
      masks: { region: C.createLabelMap(S.imgW, S.imgH), before: null, after: null },
      createdAt: new Date().toISOString()
    };
    S.issues.push(it);
    S.activeIssueId = it.id;
    S.issueOverlayDirty = true;
    setDirty(true);
    setMode('issues');
    setIssueTarget('region');
    setTool('rect');
    // 有部件时，默认把「改动前」指向当前关联件（= 直接用该件可见区，不用画）
    var filled = false;
    if (S.parts.length && it.beforePartId) {
      filled = setIssueBeforeFromPart(it, it.beforePartId, { silent: true, noHistory: true });
    }
    renderIssues();
    scheduleRender();
    pushUndo({ type: 'issuePresence', issue: it, index: S.issues.length - 1, before: false, after: true });
    msg('已添加问题：选部件，圈位置，再写一句说明');
    return it;
  }
  function deleteIssue(it) {
    if (!it) return;
    if (!confirm('删除这条问题标注？')) return;
    S.usedIssueIds[it.id] = true;
    cancelPendingSelection();
    var idx = S.issues.indexOf(it);
    if (idx >= 0) { S.issues.splice(idx, 1); pushUndo({ type: 'issuePresence', issue: it, index: idx, before: true, after: false }); }
    if (S.activeIssueId === it.id) S.activeIssueId = S.issues.length ? S.issues[0].id : null;
    S.issueOverlayDirty = true;
    setDirty(true);
    renderIssues();
    scheduleRender();
    msg('已删除 ' + it.id);
  }
  function ensureIssueMask(it, target) {
    if (!it.masks[target]) it.masks[target] = C.createLabelMap(S.imgW, S.imgH);
    return it.masks[target];
  }
  function issueTargetMap() {
    var it = activeIssue();
    if (!it) return null;
    return ensureIssueMask(it, S.issueTarget);
  }
  function maskCount(map) {
    if (!map) return 0;
    var n = 0;
    for (var i = 0; i < map.length; i++) if (map[i]) n++;
    return n;
  }
  function issueBBox(it) {
    var b = C.bboxOfValue(it.masks.region, S.imgW, S.imgH, 1);
    if (!b) return null;
    return [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0];
  }
  // 每类目标里的“块”数（一个问题位置可以是多块不相邻的选区）
  function issueBlocks(it) {
    if (!it) return { region: 0, before: 0, after: 0 };
    return {
      region: it.masks.region ? C.countComponents(it.masks.region, S.imgW, S.imgH, 1) : 0,
      before: it.masks.before ? C.countComponents(it.masks.before, S.imgW, S.imgH, 1) : 0,
      after: it.masks.after ? C.countComponents(it.masks.after, S.imgW, S.imgH, 1) : 0
    };
  }
  function fmtPx(n, blocks) {
    var s = (n || 0).toLocaleString();
    return blocks > 1 ? s + ' · ' + blocks + ' 块' : s;
  }
  function unionBox(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
      x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
      x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1)
    };
  }
  // 画布某点最上层的已拆分部件（visible 优先，其次 hidden 补全通道）
  function pickPartAt(x, y) {
    if (!(x >= 0 && x < S.imgW && y >= 0 && y < S.imgH)) return null;
    var i = y * S.imgW + x;
    var chans = ['visible', 'hidden'];
    for (var c = 0; c < chans.length; c++) {
      var m = S.maps[chans[c]];
      if (!m) continue;
      var v = m[i];
      if (v > 0 && S.parts[v - 1]) return S.parts[v - 1];
    }
    return null;
  }
  // 「改动前」= 直接指定一个已拆分部件：before 掩码由该件的可见区像素生成（可撤销、可清空）
  function setIssueBeforeFromPart(it, partId, opts) {
    if (!it) { msg('先在「问题」页新建或选中一个问题'); return false; }
    var idx = partIndex(partId);
    if (!idx) { msg('「改动前」要指向一个已拆分的部件：先载入现有拆分件，再点画布或下拉选一件'); return false; }
    var p = S.parts[idx - 1];
    var src = S.maps.visible;
    if (!src) { msg('还没有可见区掩码'); return false; }
    var oldMeta = { partId: it.partId, beforePartId: it.beforePartId };
    var map = ensureIssueMask(it, 'before');
    var entry = { type: 'issueRegion', issueId: it.id, target: 'before', metaBefore: oldMeta };
    var newBox = C.bboxOfValue(src, S.imgW, S.imgH, idx);
    var oldBox = C.bboxOfValue(map, S.imgW, S.imgH, 1);
    var box = unionBox(oldBox, newBox);
    if (box) {
      var beforeRegion = C.extractRegion(map, S.imgW, box);
      C.drawRect(map, S.imgW, S.imgH, box.x0, box.y0, box.x1, box.y1, 0);
      if (newBox) {
        for (var y = newBox.y0; y < newBox.y1; y++) {
          for (var x = newBox.x0; x < newBox.x1; x++) {
            var i = y * S.imgW + x;
            if (src[i] === idx) map[i] = 1;
          }
        }
      }
      var afterRegion = C.extractRegion(map, S.imgW, box);
      entry.diff = { x0: box.x0, y0: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0, before: beforeRegion, after: afterRegion };
    }
    it.beforePartId = partId;
    if (!it.partId || (opts && opts.linkPart)) it.partId = partId;
    entry.metaAfter = { partId: it.partId, beforePartId: it.beforePartId };
    if (!(opts && opts.noHistory)) pushUndo(entry);
    S.issueOverlayDirty = true;
    setDirty(true);
    renderIssues();
    scheduleRender();
    if (!(opts && opts.silent)) {
      msg('「改动前」= ' + p.name + '（' + p.id + '）：用它的可见区 ' + maskCount(map).toLocaleString() + ' px 作为改动前区域（不用画选区）');
    }
    return true;
  }
  function clearIssueBefore(it) {
    if (!it) { msg('先选中一个问题'); return; }
    var map = it.masks.before;
    var box = map ? C.bboxOfValue(map, S.imgW, S.imgH, 1) : null;
    var entry = { type: 'issueRegion', issueId: it.id, target: 'before', metaBefore: { partId: it.partId, beforePartId: it.beforePartId } };
    it.beforePartId = null;
    if (!S.advanced) it.partId = '';
    entry.metaAfter = { partId: it.partId, beforePartId: it.beforePartId };
    if (box) {
      var beforeRegion = C.extractRegion(map, S.imgW, box);
      C.drawRect(map, S.imgW, S.imgH, box.x0, box.y0, box.x1, box.y1, 0);
      var afterRegion = C.extractRegion(map, S.imgW, box);
      entry.diff = { x0: box.x0, y0: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0, before: beforeRegion, after: afterRegion };
    }
    pushUndo(entry);
    S.issueOverlayDirty = true;
    setDirty(true);
    renderIssues();
    scheduleRender();
    msg('已清除「改动前」');
  }
  function setIssueTarget(t) {
    if (!S.advanced && t === 'before') return;
    cancelPendingSelection();
    if (t === 'before' && !S.parts.length) {
      msg('还没有拆分部件：「改动前」要直接选一件（先「载入现有拆分件」或打开拆件包）');
      return;
    }
    if (S.tool !== 'select') S.lastPaintTool = S.tool;
    S.issueTarget = t;
    $$('.segbtn').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.target === t ? 'true' : 'false'); });
    if (t === 'before') {
      if (S.tool !== 'select') setTool('select');
      msg('「改动前」= 直接点画布上的某个拆分部件（或右侧「改动前件」下拉），表示问题发生在哪一件；不用画选区');
    } else {
      if (S.tool === 'select') setTool(S.lastPaintTool || 'rect');
      msg(t === 'region' ? '圈出有问题的地方，可连续标多处' : '圈出期望的范围，不必一次画完整');
    }
    updateIssueInspector();
    scheduleRender();
  }
  function updateIssueInspector() {
    var it = activeIssue();
    updateIssueGuide();
    $('#activeIssueId').textContent = it ? it.id : '—';
    // 改动前件下拉：先按部件表重建（与有没有选中问题无关）
    var bsel = $('#issueBeforePart');
    bsel.innerHTML = S.parts.length
      ? '<option value="">（未指定）</option>'
      : '<option value="">（先载入拆分件）</option>';
    sortedParts().forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = S.advanced ? p.name + ' (' + p.id + ')' : partLabel(p);
      bsel.appendChild(opt);
    });
    bsel.disabled = !S.parts.length;
    $('#btnBeforePick').disabled = !S.parts.length;
    if (!it) {
      $('#issuePxRegion').textContent = '0';
      $('#issuePxBefore').textContent = '0';
      $('#issuePxAfter').textContent = '0';
      $('#issuePxTotal').textContent = '0';
      $('#beforePartState').textContent = S.parts.length ? '（未指定）' : '（先载入拆分件）';
      bsel.value = '';
      $('#btnBeforeClear').disabled = true;
      return;
    }
    var r = maskCount(it.masks.region), b = maskCount(it.masks.before), a = maskCount(it.masks.after);
    var blocks = S.advanced ? issueBlocks(it) : { region: 0, after: 0 };
    $('#issuePxRegion').textContent = fmtPx(r, blocks.region);
    $('#issuePxBefore').textContent = b.toLocaleString();
    $('#issuePxAfter').textContent = fmtPx(a, blocks.after);
    $('#issuePxTotal').textContent = (r + b + a).toLocaleString();
    $('#issueType').value = it.type;
    $('#issueSeverity').value = String(it.severity);
    $('#issueNote').value = it.note || '';
    var sel = $('#issuePart');
    if (!S.parts.length) sel.innerHTML = '<option value="">（先打开拆件工程）</option>';
    else if (!it.partId) sel.innerHTML = '<option value="">（请选择有问题的部件）</option>';
    else sel.innerHTML = '';
    sortedParts().forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = S.advanced ? p.name + ' (' + p.id + ')' : partLabel(p);
      sel.appendChild(opt);
    });
    sel.value = it.partId || '';
    bsel.value = it.beforePartId || '';
    var bp = it.beforePartId ? partById(it.beforePartId) : null;
    $('#beforePartState').textContent = S.parts.length
      ? (bp ? bp.name + ' · 可见区 ' + b.toLocaleString() + ' px' : '（未指定：点画布或选下拉）')
      : '（先载入拆分件）';
    $('#btnBeforeClear').disabled = !it.beforePartId && !b;
  }
  function renderIssues() {
    var list = $('#issueList');
    list.innerHTML = '';
    S.issues.forEach(function (it) {
      var li = document.createElement('li');
      li.className = 'part-row issue-row' + (it.id === S.activeIssueId ? ' selected' : '');
      li.setAttribute('role', 'option');
      li.innerHTML =
        '<span class="chip" style="background:' + issueColor(it.type) + '"></span>' +
        '<span class="pname"></span>' +
        '<span class="itype">' + (maskCount(it.masks.region) ? '已圈选' : '待圈选') + '</span>';
      var p = partById(it.partId);
      li.querySelector('.pname').textContent = it.note || partLabel(p) + ' · ' + (it.type === 'other' ? '新问题' : $('#issueType option[value="' + it.type + '"]').textContent);
      li.title = it.note || li.querySelector('.pname').textContent;
      li.setAttribute('aria-selected', it.id === S.activeIssueId ? 'true' : 'false');
      li.addEventListener('click', function () {
        cancelPendingSelection();
        S.activeIssueId = it.id;
        if (!S.advanced) setTool('select');
        S.issueOverlayDirty = true;
        renderIssues();
        scheduleRender();
      });
      list.appendChild(li);
    });
    if (!S.issues.length) {
      var empty = document.createElement('li');
      empty.className = 'part-row dim';
      empty.textContent = '还没有问题，点上方「添加问题」。';
      list.appendChild(empty);
    }
    $('#issuesCount').textContent = S.issues.length + ' 条';
    updateIssueInspector();
  }
  function rebuildIssueOverlay() {
    S.issueOverlayDirty = false;
    if (!S.img) return;
    if (!issueCanvas || issueCanvas.width !== S.imgW || issueCanvas.height !== S.imgH) {
      issueCanvas = document.createElement('canvas');
      issueCanvas.width = S.imgW; issueCanvas.height = S.imgH;
      issueCtx = issueCanvas.getContext('2d');
    }
    var data = issueCtx.createImageData(S.imgW, S.imgH);
    var buf = data.data;
    var active = S.activeIssueId;
    function paint(map, hex, alpha) {
      if (!map) return;
      var c = C.hexToRgb(hex);
      for (var i = 0; i < map.length; i++) {
        if (!map[i]) continue;
        var o = i * 4;
        buf[o] = c.r; buf[o + 1] = c.g; buf[o + 2] = c.b; buf[o + 3] = alpha;
      }
    }
    S.issues.forEach(function (it) {
      if (S.advanced || it.id === active) paint(it.masks.region, S.advanced ? issueColor(it.type) : '#f57785', it.id === active ? 100 : 50);
    });
    var it = activeIssue();
    if (it) {
      if (S.advanced) paint(it.masks.before, '#5aa9ff', 100);
      paint(it.masks.region, S.advanced ? issueColor(it.type) : '#f57785', 100);
      paint(it.masks.after, '#4ec9a5', 110);
    }
    issueCtx.putImageData(data, 0, 0);
  }
  function setMode(m) {
    cancelPendingSelection();
    if (!S.advanced && m === 'parts') m = 'issues';
    S.mode = m;
    $$('.mode[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false'); });
    S.selection = null;
    updateSelectionBar();
    switchTab(m === 'issues' ? 'issues' : 'parts');
    if (m === 'issues') {
      msg('选部件 → 圈出问题 → 写说明 → 保存');
    } else {
      msg('部件标注模式：选中部件后框选，把可见区归给该件');
    }
    updateIssueGuide();
    scheduleRender();
  }
  function eraseIssueSelection() {
    var it = activeIssue();
    if (!it) return;
    if (S.issueTarget === 'before') { msg('「改动前」不画选区：直接点画布上的部件（或下拉「改动前件」）'); return; }
    var bbox = currentSelectionBbox();
    if (!bbox || selectionTooSmall()) { clearSelection(); return; }
    var map = issueTargetMap();
    var before = C.extractRegion(map, S.imgW, bbox);
    if (S.selection.type === 'rect') {
      C.drawRect(map, S.imgW, S.imgH, S.selection.x0, S.selection.y0, S.selection.x1, S.selection.y1, 0);
    } else if (S.selection.type === 'poly' && S.selection.points.length >= 3) {
      C.fillPolygon(map, S.imgW, S.imgH, S.selection.points, 0);
    }
    var after = C.extractRegion(map, S.imgW, bbox);
    pushUndo({
      type: 'issueRegion', issueId: it.id, target: S.issueTarget,
      diff: { x0: Math.floor(bbox.x0), y0: Math.floor(bbox.y0), w: Math.ceil(bbox.x1) - Math.floor(bbox.x0), h: Math.ceil(bbox.y1) - Math.floor(bbox.y0), before: before, after: after }
    });
    S.selection = null;
    S.issueOverlayDirty = true;
    setDirty(true);
    updateSelectionBar();
    renderIssues();
    scheduleRender();
    var left = maskCount(map);
    msg('已从「' + (S.issueTarget === 'region' ? '问题位置' : '改动后') + '」擦除选区：剩 ' + left.toLocaleString() + ' px');
  }

  function applyIssueSelection() {
    var it = activeIssue();
    if (!it) { msg('先在「问题」页新建或选中一个问题'); return; }
    if (S.issueTarget === 'before') { msg('「改动前」不画选区：直接点画布上的部件（或下拉「改动前件」）'); return; }
    var bbox = currentSelectionBbox();
    if (!bbox || selectionTooSmall()) { clearSelection(); return; }
    var map = issueTargetMap();
    var before = C.extractRegion(map, S.imgW, bbox);
    if (S.selection.type === 'rect') {
      C.drawRect(map, S.imgW, S.imgH, S.selection.x0, S.selection.y0, S.selection.x1, S.selection.y1, 1);
    } else if (S.selection.type === 'poly' && S.selection.points.length >= 3) {
      C.fillPolygon(map, S.imgW, S.imgH, S.selection.points, 1);
    }
    var after = C.extractRegion(map, S.imgW, bbox);
    pushUndo({
      type: 'issueRegion', issueId: it.id, target: S.issueTarget,
      diff: { x0: Math.floor(bbox.x0), y0: Math.floor(bbox.y0), w: Math.ceil(bbox.x1) - Math.floor(bbox.x0), h: Math.ceil(bbox.y1) - Math.floor(bbox.y0), before: before, after: after }
    });
    S.selection = null;
    S.issueOverlayDirty = true;
    setDirty(true);
    updateSelectionBar();
    renderIssues();
    scheduleRender();
    var pxAfter = S.advanced ? maskCount(map) : 0;
    msg(S.advanced ? '已累加选区，累计 ' + pxAfter.toLocaleString() + ' px' :
      (S.issueTarget === 'region' ? '已标记问题位置' : '已标记期望范围') + '，可继续标；圈好了点「完成圈选」');
  }

  // ---------------------------------------------------------------- 撤销
  function pushUndo(entry) {
    S.undo.push(entry);
    if (S.undo.length > 40) S.undo.shift();
    S.redo.length = 0;
  }
  function snapshotAll() {
    pushUndo({
      type: 'all',
      maps: { visible: S.maps.visible ? S.maps.visible.slice() : null, hidden: S.maps.hidden ? S.maps.hidden.slice() : null },
      parts: JSON.parse(JSON.stringify(S.parts)),
      activeId: S.activeId,
      nextZ: S.nextZ
    });
    setDirty(true);
  }
  function mutateRegion(channel, bbox, fn) {
    var map = S.maps[channel];
    var w = S.imgW;
    var x0 = clamp(Math.floor(bbox.x0), 0, S.imgW), y0 = clamp(Math.floor(bbox.y0), 0, S.imgH);
    var x1 = clamp(Math.ceil(bbox.x1), 0, S.imgW), y1 = clamp(Math.ceil(bbox.y1), 0, S.imgH);
    if (x1 <= x0 || y1 <= y0) return;
    var before = C.extractRegion(map, w, { x0: x0, y0: y0, x1: x1, y1: y1 });
    fn(map);
    var after = C.extractRegion(map, w, { x0: x0, y0: y0, x1: x1, y1: y1 });
    var diff = { x0: x0, y0: y0, w: x1 - x0, h: y1 - y0, before: before, after: after };
    pushUndo({ type: 'region', channel: channel, diff: diff });
  }
  function issueMapById(id, target) {
    for (var i = 0; i < S.issues.length; i++) {
      if (S.issues[i].id !== id) continue;
      var it = S.issues[i];
      if (target === 'region') return it.masks.region;
      return it.masks[target];
    }
    return null;
  }
  function applyIssueHistory(e, side) {
    var it = S.issues.filter(function (x) { return x.id === e.issueId; })[0];
    if (!it) return;
    if (e.diff) C.applyDiff(ensureIssueMask(it, e.target), S.imgW, e.diff, side);
    var meta = side === 'before' ? e.metaBefore : e.metaAfter;
    if (meta) { it.partId = meta.partId; it.beforePartId = meta.beforePartId; }
    S.activeIssueId = it.id;
  }
  function applyIssuePresence(e, side) {
    var idx = S.issues.indexOf(e.issue);
    if (e[side]) { if (idx < 0) S.issues.splice(Math.min(e.index, S.issues.length), 0, e.issue); S.activeIssueId = e.issue.id; }
    else { if (idx >= 0) S.issues.splice(idx, 1); S.activeIssueId = S.issues.length ? S.issues[0].id : null; }
  }
  function undo() {
    cancelPendingSelection();
    var e = S.undo.pop();
    if (!e) { msg('没有可撤销的操作'); return; }
    if (e.type === 'all') {
      S.redo.push({ type: 'all', maps: { visible: S.maps.visible.slice(), hidden: S.maps.hidden ? S.maps.hidden.slice() : null }, parts: JSON.parse(JSON.stringify(S.parts)), activeId: S.activeId, nextZ: S.nextZ });
      S.maps.visible = e.maps.visible;
      S.maps.hidden = e.maps.hidden;
      S.parts = e.parts; S.activeId = e.activeId; S.nextZ = e.nextZ;
    } else if (e.type === 'issueRegion') {
      applyIssueHistory(e, 'before');
      S.issueOverlayDirty = true;
      S.redo.push(e);
    } else if (e.type === 'issuePresence') {
      applyIssuePresence(e, 'before'); S.redo.push(e);
    } else {
      var target = S.maps[e.channel];
      C.applyDiff(target, S.imgW, e.diff, 'before');
      S.redo.push(e);
    }
    afterHistory();
  }
  function redo() {
    cancelPendingSelection();
    var e = S.redo.pop();
    if (!e) { msg('没有可重做的操作'); return; }
    if (e.type === 'all') {
      S.undo.push({ type: 'all', maps: { visible: S.maps.visible.slice(), hidden: S.maps.hidden ? S.maps.hidden.slice() : null }, parts: JSON.parse(JSON.stringify(S.parts)), activeId: S.activeId, nextZ: S.nextZ });
      S.maps.visible = e.maps.visible; S.maps.hidden = e.maps.hidden;
      S.parts = e.parts; S.activeId = e.activeId; S.nextZ = e.nextZ;
    } else if (e.type === 'issueRegion') {
      applyIssueHistory(e, 'after');
      S.issueOverlayDirty = true;
      S.undo.push(e);
    } else if (e.type === 'issuePresence') {
      applyIssuePresence(e, 'after'); S.undo.push(e);
    } else {
      C.applyDiff(S.maps[e.channel], S.imgW, e.diff, 'after');
      S.undo.push(e);
    }
    afterHistory();
  }
  function afterHistory() {
    S.overlayDirty = true; S.outlineDirty = true; S.issueOverlayDirty = true; S.selection = null;
    setDirty(true); renderParts(); renderIssues(); updateSelectionBar(); scheduleRender();
  }

  // ---------------------------------------------------------------- 选区
  function currentSelectionBbox() {
    var b = rawSelectionBbox();
    if (!b) return null;
    b = { x0: clamp(Math.floor(b.x0), 0, S.imgW), y0: clamp(Math.floor(b.y0), 0, S.imgH), x1: clamp(Math.ceil(b.x1), 0, S.imgW), y1: clamp(Math.ceil(b.y1), 0, S.imgH) };
    return b.x1 > b.x0 && b.y1 > b.y0 ? b : null;
  }
  function rawSelectionBbox() {
    var s = S.selection;
    if (!s) return null;
    if (s.type === 'rect') return { x0: Math.min(s.x0, s.x1), y0: Math.min(s.y0, s.y1), x1: Math.max(s.x0, s.x1), y1: Math.max(s.y0, s.y1) };
    if (s.type === 'poly' && s.points.length >= 3) {
      var xs = s.points.map(function (p) { return p.x; }), ys = s.points.map(function (p) { return p.y; });
      return { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
    }
    return null;
  }
  // 单击（没拖动）不算选区：按原始坐标判断，避免 floor/ceil 把 0 尺寸撑成 1px
  function selectionTooSmall() {
    var b = rawSelectionBbox();
    if (!b) return true;
    return (b.x1 - b.x0) < 0.75 || (b.y1 - b.y0) < 0.75;
  }
  function updateSelectionBar() {
    var bar = $('#selectionBar');
    var bbox = currentSelectionBbox();
    if (!S.selection || !bbox) { bar.hidden = true; return; }
    bar.hidden = false;
    var w = Math.round(bbox.x1 - bbox.x0), h = Math.round(bbox.y1 - bbox.y0);
    $('#selectionInfo').textContent = S.selection.type === 'rect'
      ? '矩形 ' + w + '×' + h + ' @' + Math.round(bbox.x0) + ',' + Math.round(bbox.y0)
      : '多边形 ' + S.selection.points.length + ' 顶点 · 包围盒 ' + w + '×' + h;
    if (S.mode === 'issues') updateIssueGuide();
  }
  function rasterizeSelection(value) {
    var bbox = currentSelectionBbox();
    if (!bbox) return;
    var channel = S.channel;
    mutateRegion(channel, bbox, function (map) {
      if (S.selection.type === 'rect') {
        C.drawRect(map, S.imgW, S.imgH, S.selection.x0, S.selection.y0, S.selection.x1, S.selection.y1, value);
      } else if (S.selection.type === 'poly' && S.selection.points.length >= 3) {
        C.fillPolygon(map, S.imgW, S.imgH, S.selection.points, value);
      }
    });
    S.overlayDirty = true; S.outlineDirty = true;
    setDirty(true);
    renderParts(); scheduleRender();
  }
  function applySelection(mode) {
    if (S.mode === 'issues') {
      if (mode === 'assign') applyIssueSelection();
      else if (mode === 'subtract') eraseIssueSelection();
      return;
    }
    if (!S.advanced) return;
    if (!S.selection) { msg('先框选一个区域'); return; }
    var idx = partIndex(S.activeId);
    if (mode !== 'new' && !idx) { msg('先在右侧选中一个部件（或用「新建部件」）'); return; }
    if (mode === 'new') {
      var p = createPart(null);
      rasterizeSelection(partIndex(p.id));
      msg('用选区新建了部件 ' + p.name);
    } else if (mode === 'subtract') {
      rasterizeSelection(0);
      msg('已从 ' + activePart().name + ' 减去选区');
    } else {
      rasterizeSelection(idx);
      msg('已把选区赋给 ' + activePart().name);
    }
    S.selection = null;
    updateSelectionBar();
    scheduleRender();
  }
  function clearSelection() {
    S.selection = null;
    updateSelectionBar();
    scheduleRender();
  }

  // ---------------------------------------------------------------- 工具操作
  // 当前编辑目标：部件通道 或 当前问题的某个目标掩码
  function strokeContext() {
    if (S.mode === 'issues') {
      if (S.issueTarget === 'before') return null;
      var it = activeIssue();
      if (!it) return null;
      return { kind: 'issue', map: issueTargetMap(), value: S.tool === 'brush' ? 1 : 0, issueId: it.id, target: S.issueTarget };
    }
    var idx = partIndex(S.activeId);
    if (!idx) return null;
    return { kind: 'parts', map: S.maps[S.channel], value: S.tool === 'brush' ? idx : 0, channel: S.channel };
  }

  function beginStroke(ev) {
    if (!S.img) return;
    var pt = imagePointFor(ev);
    S.drag = { start: pt, last: pt, button: ev.button };
    if (ev.button === 1 || ev.button === 2 || ev.shiftKey === false) { /* noop */ }
    if (S.tool === 'select' || ev.button === 1 || spaceDown) {
      S.drag.mode = 'pan';
      S.drag.panStart = { x: S.tx, y: S.ty, sx: ev.clientX, sy: ev.clientY };
      cv.classList.add('panning');
      return;
    }
    if (S.tool === 'rect') {
      S.selection = { type: 'rect', x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
      updateSelectionBar();
    } else if (S.tool === 'poly') {
      if (!S.selection || S.selection.type !== 'poly') S.selection = { type: 'poly', points: [] };
      S.selection.points.push({ x: pt.x, y: pt.y });
      updateSelectionBar();
    } else if (S.tool === 'brush' || S.tool === 'eraser') {
      var cx = strokeContext();
      if (!cx) { msg(S.mode === 'issues' ? '先新建/选中一个问题' : '先选中一个部件'); return; }
      var bbox = C.drawBrush(cx.map, S.imgW, S.imgH, pt.x, pt.y, S.brushSize / 2, cx.value);
      // 记录整笔的 undo：起点区域在 pointerdown 里已截 before，这里只记区域
      S.drag.stroke = { kind: cx.kind, channel: cx.channel, issueId: cx.issueId, target: cx.target, map: cx.map, value: cx.value, points: [pt], start: pt, bbox: { x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 } };
    }
  }

  function moveStroke(ev) {
    if (!S.img) return;
    var pt = imagePointFor(ev);
    S.hover = pt;
    if (!S.drag) { scheduleRender(); return; }
    if (S.drag.mode === 'pan') {
      S.tx = S.drag.panStart.x + (ev.clientX - S.drag.panStart.sx);
      S.ty = S.drag.panStart.y + (ev.clientY - S.drag.panStart.sy);
      scheduleRender();
      return;
    }
    if (S.tool === 'rect' && S.selection && S.selection.type === 'rect') {
      S.selection.x1 = pt.x; S.selection.y1 = pt.y;
      updateSelectionBar(); scheduleRender();
    } else if (S.tool === 'brush' || S.tool === 'eraser') {
      if (!S.drag.stroke) return;
      var st = S.drag.stroke;
      var value = st.value;
      var last = st.points[st.points.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < Math.max(0.5, S.brushSize / 4)) return;
      var bbox = C.drawBrushLine(st.map, S.imgW, S.imgH, last.x, last.y, pt.x, pt.y, S.brushSize / 2, st.value);
      st.points.push(pt);
      st.bbox.x0 = Math.min(st.bbox.x0, bbox.x0); st.bbox.y0 = Math.min(st.bbox.y0, bbox.y0);
      st.bbox.x1 = Math.max(st.bbox.x1, bbox.x1); st.bbox.y1 = Math.max(st.bbox.y1, bbox.y1);
      if (st.kind === 'issue') S.issueOverlayDirty = true; else S.overlayDirty = true;
      scheduleRender();
    } else {
      scheduleRender();
    }
  }

  function endStroke(ev) {
    if (!S.img) return;
    cv.classList.remove('panning');
    if (S.drag && S.drag.mode === 'pan') {
      if (!S.advanced) { S.drag = null; return; }
      var moved = Math.abs((ev.clientX - S.drag.panStart.sx)) + Math.abs((ev.clientY - S.drag.panStart.sy));
      if (moved < 4 && S.tool === 'select') {
        // 单击选择：取该像素最上层的部件
        var pt = imagePointFor(ev);
        var x = pixelAt(pt.x), y = pixelAt(pt.y);
        if (x >= 0 && x < S.imgW && y >= 0 && y < S.imgH) {
          if (S.mode === 'issues' && S.issueTarget === 'before') {
            // 「改动前」= 直接点选一个已拆分部件，不画选区
            var it0 = activeIssue();
            var pp = pickPartAt(x, y);
            if (pp) setIssueBeforeFromPart(it0, pp.id);
            else msg('这里没有已拆分的部件（点在有部件的像素上，或在右侧「改动前件」下拉里选）');
            S.drag = null;
            return;
          }
          var map = channelMap();
          var v = map[y * S.imgW + x];
          if (v > 0) { selectPart(S.parts[v - 1].id); msg('选中 ' + S.parts[v - 1].name); }
          else { msg('该处未标注（可新建部件后框选）'); }
        }
      }
      S.drag = null; return;
    }
    if (S.tool === 'rect' && S.selection && S.selection.type === 'rect') {
      if (!selectionTooSmall()) {
        if (S.mode === 'issues') applyIssueSelection();
        else if (S.autoAssign) applySelection('assign');
        else updateSelectionBar();
      } else {
        clearSelection();
      }
    } else if (S.tool === 'brush' || S.tool === 'eraser') {
      if (S.drag && S.drag.stroke) {
        var st = S.drag.stroke;
        var map = st.map;
        if (st.beforeMap) {
          var after = C.extractRegion(map, S.imgW, st.bbox);
          var diff = { x0: st.bbox.x0, y0: st.bbox.y0, w: st.bbox.x1 - st.bbox.x0, h: st.bbox.y1 - st.bbox.y0, before: C.extractRegion(st.beforeMap, S.imgW, st.bbox), after: after };
          if (st.kind === 'issue') pushUndo({ type: 'issueRegion', issueId: st.issueId, target: st.target, diff: diff });
          else pushUndo({ type: 'region', channel: st.channel, diff: diff });
        }
        if (st.kind === 'issue') { S.issueOverlayDirty = true; renderIssues(); }
        else { setDirty(true); renderParts(); }
      }
    } else if (S.tool === 'poly') {
      updateSelectionBar();
    }
    S.drag = null;
    S.overlayDirty = true; S.outlineDirty = true;
    scheduleRender();
  }

  // ---------------------------------------------------------------- 事件
  var spaceDown = false;
  var quadClick = null;   // 四视图：按下时记住落在哪张立绘上，抬起未拖动就选中它
  function bindEvents() {
    cv.addEventListener('pointerdown', function (ev) {
      if (ev.button === 2) return;
      if (S.layout !== 'single') {
        var rq = cv.getBoundingClientRect();
        var mxq = ev.clientX - rq.left, myq = ev.clientY - rq.top;
        var pq = paneAt(mxq, myq);
        quadClick = pq && pq.view ? { view: pq.view, x: ev.clientX, y: ev.clientY } : null;
        var paintOnComposite = pq && pq.kind === 'composite' && S.quadSelect === S.view &&
          S.tool !== 'select' && ev.button !== 1 && !spaceDown;
        if (pq && pq.kind !== 'edit' && !paintOnComposite) {
          if (pq.kind === 'composite' && (ev.button === 1 || spaceDown || S.tool === 'select')) {
            cv.setPointerCapture(ev.pointerId);
            S.drag = { mode: 'panePan', px: mxq, py: myq, tx: S.tx, ty: S.ty };
            cv.classList.add('panning');
            return;
          }
          if (S.layout === 'quad' && pq.view) {
            // 静态立绘：只做“选中”，不在上面画东西
            cv.setPointerCapture(ev.pointerId);
            S.drag = { mode: 'pick', start: { x: ev.clientX, y: ev.clientY }, view: pq.view };
          }
          return;
        }
      }
      if (!canDrawAt(ev) && !(ev.button === 1 || spaceDown)) return;
      cv.setPointerCapture(ev.pointerId);
      if (ev.button === 1 || spaceDown) { beginStroke(ev); return; }
      if (S.mode === 'issues' && !activeIssue() && S.tool !== 'select') { msg('先点「添加问题」'); return; }
      if (S.tool === 'wand') { applyWand(ev); return; }
      if (S.tool === 'brush' || S.tool === 'eraser') {
        var cx = strokeContext();
        if (cx) {
          var pt = imagePointFor(ev);
          var st = { kind: cx.kind, map: cx.map, channel: cx.channel, issueId: cx.issueId, target: cx.target, value: cx.value, points: [pt] };
          // 先算 bbox 与 before，再落第一笔（否则撤销回不到笔前）
          var bx0 = clamp(Math.floor(pt.x - S.brushSize / 2), 0, S.imgW);
          var by0 = clamp(Math.floor(pt.y - S.brushSize / 2), 0, S.imgH);
          var bx1 = clamp(Math.ceil(pt.x + S.brushSize / 2) + 1, 0, S.imgW);
          var by1 = clamp(Math.ceil(pt.y + S.brushSize / 2) + 1, 0, S.imgH);
          st.bbox = { x0: bx0, y0: by0, x1: bx1, y1: by1 };
          st.beforeMap = cx.map.slice();
          C.drawBrush(cx.map, S.imgW, S.imgH, pt.x, pt.y, S.brushSize / 2, st.value);
          S.drag = { stroke: st, start: pt };
          if (st.kind === 'issue') S.issueOverlayDirty = true; else S.overlayDirty = true;
          setDirty(true);
          scheduleRender();
          return;
        }
      }
      beginStroke(ev);
    });
    cv.addEventListener('pointermove', function (ev) {
      S.hover = imagePointFor(ev);
      var rcq = cv.getBoundingClientRect();
      S.hoverScreen = { x: ev.clientX - rcq.left, y: ev.clientY - rcq.top };
      S.hoverPane = S.layout === 'single' ? paneAt(S.hoverScreen.x, S.hoverScreen.y) : paneAt(S.hoverScreen.x, S.hoverScreen.y);
      if (S.drag && S.drag.mode === 'panePan') {
        S.tx = S.drag.tx + (ev.clientX - rcq.left - S.drag.px);
        S.ty = S.drag.ty + (ev.clientY - rcq.top - S.drag.py);
        scheduleRender();
        return;
      }
      if (S.loupe || S.layout !== 'single') scheduleRender();
      if (!S.drag) { if (S.tool === 'poly' || S.tool === 'brush' || S.tool === 'eraser') scheduleRender(); return; }
      moveStroke(ev);
    });
    cv.addEventListener('pointerup', function (ev) {
      if (S.drag && S.drag.mode === 'panePan') { S.drag = null; cv.classList.remove('panning'); return; }
      if (S.drag && S.drag.mode === 'pick') {
        var moved = Math.abs(ev.clientX - S.drag.start.x) + Math.abs(ev.clientY - S.drag.start.y);
        var view = S.drag.view;
        S.drag = null;
        if (moved < 6) selectQuadView(view);
        quadClick = null;
        return;
      }
      if (quadClick) {
        var moved2 = Math.abs(ev.clientX - quadClick.x) + Math.abs(ev.clientY - quadClick.y);
        var clickedView = quadClick.view;
        quadClick = null;
        if (moved2 < 6) selectQuadView(clickedView);
      }
      endStroke(ev);
    });
    cv.addEventListener('pointercancel', function () { quadClick = null; cancelPendingSelection(); });
    cv.addEventListener('pointerleave', function () { S.hover = null; scheduleRender(); });
    cv.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    stage.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      showContextMenu(ev.clientX, ev.clientY);
    });
    document.addEventListener('pointerdown', function (ev) {
      if (ctxMenuEl && !ev.target.closest('.ctxmenu')) closeContextMenu();
    }, true);
    window.addEventListener('wheel', function () { closeContextMenu(); }, { passive: true });
    cv.addEventListener('dblclick', function (ev) {
      if (S.layout !== 'single') {
        var rd = cv.getBoundingClientRect();
        var pd = paneAt(ev.clientX - rd.left, ev.clientY - rd.top);
        if (pd && pd.kind !== 'edit') {
          ev.preventDefault();
          fitView();
          msg('已把四格一起适配到窗口');
          return;
        }
      }
      if (S.tool === 'poly' && S.selection && S.selection.type === 'poly') {
        ev.preventDefault();
        if (S.selection.points.length >= 3) {
          if (S.mode === 'issues') applyIssueSelection();
          else if (S.autoAssign) applySelection('assign');
          else updateSelectionBar();
        } else { clearSelection(); }
        scheduleRender();
      }
    });
    cv.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      if (!S.img) return;
      if (S.layout !== 'single') {
        var rw = cv.getBoundingClientRect();
        var mwx = ev.clientX - rw.left, mwy = ev.clientY - rw.top;
        var pw = paneAt(mwx, mwy);
        if (pw && pw.kind === 'composite') { zoomSharedAt(pw, mwx, mwy, ev.deltaY < 0 ? 1.12 : 1 / 1.12); return; }
        if (pw && pw.kind !== 'edit') return;   // 立绘格不单独缩放，保持坐标对齐
      }
      var cpw = cursorPos(ev);
      var before = screenToImage(cpw.x, cpw.y);
      var factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      S.zoom = clamp(S.zoom * factor, 0.02, 16);
      S.tx = cpw.x - before.x * S.zoom;
      S.ty = cpw.y - before.y * S.zoom;
      updateZoomLabel();
      scheduleRender();
    }, { passive: false });

    window.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveBundle(!!ev.shiftKey); return; }
      if (isEditableTarget(ev.target)) return;
      if (ev.key === 'Alt') { ev.preventDefault(); if (!S.loupe) { S.loupe = true; scheduleRender(); } return; }
      if (ev.code === 'Space') { spaceDown = true; cv.classList.add('pan'); return; }
      var k = ev.key.toLowerCase();
      if ((ev.ctrlKey || ev.metaKey) && k === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && k === 's') { ev.preventDefault(); saveBundle(true); return; }
      if ((ev.ctrlKey || ev.metaKey) && k === 's') { ev.preventDefault(); saveBundle(false); return; }
      if ((ev.ctrlKey || ev.metaKey) && k === 'o') { ev.preventDefault(); openSourceDialog(); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && k === 'n') { ev.preventDefault(); applySelection('new'); return; }
      if (k === 'enter') {
        if (S.selection && S.selection.type === 'poly') {
          if (S.selection.points.length >= 3) {
            if (S.mode === 'issues') applyIssueSelection();
            else applySelection('assign');
          } else clearSelection();
          scheduleRender();
        } else if (S.selection) {
          if (S.mode === 'issues') applyIssueSelection();
          else applySelection('assign');
        }
        return;
      }
      if (k === 'delete' || k === 'backspace') {
        if (S.selection) {
          ev.preventDefault();
          if (S.mode === 'issues') { eraseIssueSelection(); return; }
          applySelection('subtract');
          return;
        }
        if (S.tool === 'poly' && S.selection && S.selection.points.length) {
          S.selection.points.pop(); updateSelectionBar(); scheduleRender(); return;
        }
      }
      if (k === 'escape') { stopDrawing(false); closeDialog(); return; }
      if (k === '?') { openHelp(); return; }
      if (k === 'f') { fitView(); return; }
      if (k === '+' || k === '=') { zoomBy(1.15); return; }
      if (k === '-') { zoomBy(1 / 1.15); return; }
      if (k === 'v') return setTool('select');
      if (k === 'r') return setTool('rect');
      if (k === 'p') return setTool('poly');
      if (k === 'b') return setTool('brush');
      if (k === 'e') return setTool('eraser');
      if (k === 'w') return setTool('wand');
      if (k === 'm') { $('#showMask').checked = !$('#showMask').checked; toggleShowMask($('#showMask').checked); return; }
      if (k === '[') { if (S.advanced && S.mode === 'parts' && activePart()) moveZ(activePart(), -1); return; }
      if (k === ']') { if (S.advanced && S.mode === 'parts' && activePart()) moveZ(activePart(), 1); return; }
    });
    window.addEventListener('keyup', function (ev) {
      if (ev.code === 'Space') { spaceDown = false; cv.classList.remove('pan'); }
      if (ev.key === 'Alt' && S.loupe) { S.loupe = false; scheduleRender(); }
    });
    window.addEventListener('blur', function () { if (S.loupe) { S.loupe = false; scheduleRender(); } });
    window.addEventListener('resize', layoutCanvas);

    // 工具切换
    $$('.tool').forEach(function (btn) {
      btn.addEventListener('click', function () { setTool(btn.dataset.tool); });
    });
    $('#partSearch').addEventListener('input', renderParts);
    $('#btnAddPart').addEventListener('click', function () { createPart(); msg('已新建部件'); });
    $('#btnDeletePart').addEventListener('click', function () { var p = activePart(); if (p) deletePart(p); });
    $('#btnMerge').addEventListener('click', function () {
      var p = activePart();
      if (!p) { msg('先选中要保留的目标部件'); return; }
      openDialog('合并部件', '选择要合并进「' + p.name + '」的部件（像素会归到目标件，可用撤销恢复）：',
        S.parts.filter(function (q) { return q.id !== p.id; }).map(function (q) {
          return { label: q.name + ' (' + q.id + ')', meta: 'z=' + q.z, action: function () { mergePart(q, p); closeDialog(); } };
        }));
    });
    $('#partName').addEventListener('change', function () {
      var p = activePart(); if (!p) return;
      p.name = this.value.trim() || p.name;
      setDirty(true); renderParts();
    });
    $('#partColor').addEventListener('input', function () {
      var p = activePart(); if (!p) return;
      p.color = this.value;
      S.overlayDirty = true; S.outlineDirty = true; renderParts(); scheduleRender();
    });
    $('#partNote').addEventListener('change', function () {
      var p = activePart(); if (!p) return;
      p.note = this.value; setDirty(true);
    });
    $('#channel').addEventListener('change', function () {
      setChannel(this.value);
    });
    $('#selAssign').addEventListener('click', function () { applySelection('assign'); });
    $('#selSubtract').addEventListener('click', function () { applySelection('subtract'); });
    $('#selNew').addEventListener('click', function () { applySelection('new'); });
    $('#selClear').addEventListener('click', clearSelection);
    $('#brushSize').addEventListener('input', function () { S.brushSize = Number(this.value); $('#brushSizeV').textContent = this.value; });
    $('#tolerance').addEventListener('input', function () { S.tolerance = Number(this.value); $('#toleranceV').textContent = this.value; });
    $('#autoAssign').addEventListener('change', function () { S.autoAssign = this.checked; });
    $('#showMask').addEventListener('change', function () { toggleShowMask(this.checked); });
    $('#showOutline').addEventListener('change', function () { S.showOutline = this.checked; S.outlineDirty = true; scheduleRender(); });
    $('#showBase').addEventListener('change', function () { S.showBase = this.checked; scheduleRender(); });
    $('#showIssuesChk').addEventListener('change', function () { S.showIssues = this.checked; S.issueOverlayDirty = true; scheduleRender(); });
    $('#modeParts').addEventListener('click', function () { setMode('parts'); });
    $('#modeIssues').addEventListener('click', function () { setMode('issues'); });
    $('#btnAddIssue').addEventListener('click', function () { createIssue(); });
    $('#btnDeleteIssue').addEventListener('click', function () { deleteIssue(activeIssue()); });
    $('#issueType').addEventListener('change', function () {
      var it = activeIssue(); if (!it) return;
      it.type = this.value; S.issueOverlayDirty = true; setDirty(true); renderIssues(); scheduleRender();
    });
    $('#issueSeverity').addEventListener('change', function () {
      var it = activeIssue(); if (!it) return;
      it.severity = Number(this.value); setDirty(true); renderIssues();
    });
    $('#issuePart').addEventListener('change', function () {
      var it = activeIssue(); if (!it) return;
      cancelPendingSelection();
      if (!S.advanced) {
        if (this.value) setIssueBeforeFromPart(it, this.value, { linkPart: true, silent: true });
        else clearIssueBefore(it);
      } else { it.partId = this.value; setDirty(true); renderIssues(); }
      msg('已选部件，可在图上圈出问题');
    });
    $('#issueNote').addEventListener('input', function () {
      var it = activeIssue(); if (!it) return;
      it.note = this.value; setDirty(true);
    });
    // 改动前件：下拉直接指定（等值于在画布上点该件）
    $('#issueBeforePart').addEventListener('change', function () {
      var it = activeIssue(); if (!it) return;
      if (this.value) setIssueBeforeFromPart(it, this.value);
      else clearIssueBefore(it);
    });
    $('#btnBeforePick').addEventListener('click', function () {
      var it = activeIssue();
      if (!it) { msg('先新建或选中一个问题'); return; }
      if (!S.parts.length) { msg('先载入现有拆分件，再选「改动前件」'); return; }
      if (S.issueTarget !== 'before') setIssueTarget('before');
      msg('在画布上点一下要指认的部件（当前问题 ' + it.id + '）');
    });
    $('#btnBeforeClear').addEventListener('click', function () { clearIssueBefore(activeIssue()); });
    $$('.segbtn').forEach(function (b) {
      b.addEventListener('click', function () { setIssueTarget(b.dataset.target); });
    });
    $('#btnFit').addEventListener('click', fitView);
    $('#btnZoomIn').addEventListener('click', function () { zoomBy(1.15); });
    $('#btnZoomOut').addEventListener('click', function () { zoomBy(1 / 1.15); });
    $('#btnSave').addEventListener('click', function () { saveBundle(false); });
    $('#btnIssueSave').addEventListener('click', function () { saveBundle(false); });
    $('#btnAdvanced').addEventListener('click', function () { setAdvanced(!S.advanced); });
    $('#btnStopDrawing').addEventListener('click', stopDrawing);
    $('#btnUndo').addEventListener('click', undo);
    $('#btnOpenBundle').addEventListener('click', openBundleDialog);
    $('#btnEmptyBundle').addEventListener('click', openBundleDialog);
    $$('#viewSeg .btn').forEach(function (b) { b.addEventListener('click', function () { setLayout(b.dataset.layout); }); });
    $('#useStack').addEventListener('change', function () {
      S.baseMode = this.checked ? 'stack' : 'art';
      if (this.checked) { ensureLayerImages(); S.stackDirty = true; }
      scheduleRender();
    });
    $('#onlyIssuePart').addEventListener('change', function () { cancelPendingSelection(); S.onlyIssuePart = this.checked; refreshPartPreview(); updateIssueGuide(); scheduleRender(); });
    $('#btnPanel').addEventListener('click', function () { document.body.classList.toggle('drawer-open'); });
    $('#btnPanelClose').addEventListener('click', function () { document.body.classList.remove('drawer-open'); });
    $('#tabParts').addEventListener('click', function () { if (S.advanced) setMode('parts'); else switchTab('parts'); });
    $('#tabIssues').addEventListener('click', function () { setMode('issues'); });
    $('#tabHelp').addEventListener('click', function () { stopDrawing(false); switchTab('help'); });
    $('#dialogClose').addEventListener('click', closeDialog);
    $('#dialogCancel').addEventListener('click', closeDialog);

    // 菜单
    $$('.menubtn').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var menu = $('#' + btn.getAttribute('aria-controls'));
        var open = btn.getAttribute('aria-expanded') === 'true';
        closeMenus();
        if (!open) { btn.setAttribute('aria-expanded', 'true'); menu.hidden = false; }
      });
    });
    document.addEventListener('click', function (ev) {
      if (!ev.target.closest('.menu-wrap')) closeMenus();
    });
    $$('[data-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cmd = btn.dataset.cmd;
        closeMenus();
        var map = {
          'load-source': openSourceDialog,
          'load-split': openSplitDialog,
          'open-project': openProjectDialog,
          'load-bundle': openBundleDialog,
          'load-bundle-path': openBundleByPath,
          'save': function () { saveBundle(false); },
          'save-as': function () { saveBundle(true); },
          'export-zip': exportZip,
          'undo': undo,
          'redo': redo,
          'assign': function () { applySelection('assign'); },
          'subtract': function () { applySelection('subtract'); },
          'new-from-selection': function () { applySelection('new'); },
          'clear-selection': clearSelection,
          'fit': fitView,
          'zoom-in': function () { zoomBy(1.15); },
          'zoom-out': function () { zoomBy(1 / 1.15); },
          'actual': function () { S.zoom = 1; updateZoomLabel(); scheduleRender(); },
          'toggle-mask': function () { $('#showMask').checked = !$('#showMask').checked; toggleShowMask($('#showMask').checked); },
          'toggle-outline': function () { $('#showOutline').checked = !$('#showOutline').checked; S.showOutline = $('#showOutline').checked; S.outlineDirty = true; scheduleRender(); },
          'toggle-base': function () { $('#showBase').checked = !$('#showBase').checked; S.showBase = $('#showBase').checked; scheduleRender(); },
          'help': openHelp,
          'selftest': function () { window.open('selftest.html', '_blank'); }
        };
        if (map[cmd]) map[cmd]();
      });
    });

    // 空状态按钮
    $('#btnEmptyLoad').addEventListener('click', openSourceDialog);
    $('#btnEmptySplit').addEventListener('click', openSplitDialog);

    // 拖拽载入
    ['dragenter', 'dragover'].forEach(function (t) {
      stage.addEventListener(t, function (ev) { ev.preventDefault(); $('#dropHint').hidden = false; });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      stage.addEventListener(t, function (ev) { ev.preventDefault(); $('#dropHint').hidden = true; });
    });
    stage.addEventListener('drop', function (ev) {
      var f = ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) loadImageFile(f);
    });
    $('#dragFiles').addEventListener('change', function () {
      if (this.files[0]) loadImageFile(this.files[0]);
      this.value = '';
    });
  }

  function toggleShowMask(v) {
    S.showMask = v;
    if (v) S.overlayDirty = true;
    scheduleRender();
  }
  function setTool(t) {
    if (t !== S.tool) cancelPendingSelection();
    S.tool = t;
    if (t !== 'select') S.lastPaintTool = t;
    updateIssueGuide();
    $$('.tool').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false'); });
    cv.classList.toggle('pan', t === 'select');
    if (t !== 'poly') { /* 保留多边形选区？切换工具时清掉未闭合多边形 */ }
    if (t !== 'poly' && S.selection && S.selection.type === 'poly') clearSelection();
    // 在「改动前」目标下拿起绘制工具 → 自动切回「问题位置」（改动前只能点选部件）
    if (t !== 'select' && S.mode === 'issues' && S.issueTarget === 'before') {
      S.issueTarget = 'region';
      $$('.segbtn').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.target === 'region' ? 'true' : 'false'); });
      updateIssueInspector();
      msg('已切回「问题位置」：' + ({ rect: '矩形', poly: '多边形', brush: '画笔', eraser: '橡皮', wand: '魔法棒' }[t] || t) + '选区会累加到问题位置');
      scheduleRender();
      return;
    }
    scheduleRender();
    msg('工具：' + ({ select: '选择/平移', rect: '矩形选框', poly: '多边形套索', brush: '画笔', eraser: '橡皮', wand: '颜色魔法棒' })[t]);
  }
  function setChannel(ch) {
    S.channel = ch;
    if (ch === 'hidden' && !S.maps.hidden) {
      S.maps.hidden = C.createLabelMap(S.imgW, S.imgH);
    }
    S.overlayDirty = true; S.outlineDirty = true;
    updateInspector(); scheduleRender();
    msg('当前编辑通道：' + C.CHANNEL_LABEL[ch]);
  }
  function zoomBy(f) {
    if (!S.img) return;
    var w = stage.clientWidth / 2, h = stage.clientHeight / 2;
    var before = screenToImage(w, h);
    S.zoom = clamp(S.zoom * f, 0.02, 16);
    S.tx = w - before.x * S.zoom;
    S.ty = h - before.y * S.zoom;
    updateZoomLabel(); scheduleRender();
  }
  function closeMenus() {
    $$('.menubtn').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    $$('.menu').forEach(function (m) { m.hidden = true; });
  }
  function switchTab(which) {
    ['parts', 'issues', 'help'].forEach(function (k) {
      var tab = $('#' + 'tab' + k.charAt(0).toUpperCase() + k.slice(1));
      if (!tab) return;
      tab.classList.toggle('active', which === k);
      tab.setAttribute('aria-selected', which === k ? 'true' : 'false');
    });
    $('#paneParts').hidden = which !== 'parts';
    $('#paneIssues').hidden = which !== 'issues';
    $('#paneHelp').hidden = which !== 'help';
  }
  function openHelp() {
    stopDrawing(false);
    switchTab('help');
    document.body.classList.add('drawer-open');
  }

  // ---------------------------------------------------------------- 右键菜单
  var ctxMenuEl = null;
  function closeContextMenu() {
    if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; }
  }
  function deselectPart() {
    S.activeId = null;
    S.outlineDirty = true; S.overlayDirty = true;
    renderParts(); scheduleRender();
    msg('已取消选中部件');
  }
  function deselectIssue() {
    S.activeIssueId = null;
    S.issueOverlayDirty = true;
    renderIssues(); scheduleRender();
    msg('已取消选中问题');
  }
  function showContextMenu(px, py) {
    closeContextMenu();
    var menu = document.createElement('div');
    menu.className = 'ctxmenu';
    menu.setAttribute('role', 'menu');
    function item(label, kbd, enabled, run) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.disabled = !enabled;
      var s = document.createElement('span');
      s.textContent = label;
      b.appendChild(s);
      if (kbd) { var k = document.createElement('kbd'); k.textContent = kbd; b.appendChild(k); }
      b.addEventListener('click', function () { closeContextMenu(); if (enabled) run(); });
      menu.appendChild(b);
    }
    function sep() { var d = document.createElement('div'); d.className = 'sep'; menu.appendChild(d); }
    var hasSel = !!S.selection;
    var hasPart = !!activePart();
    var hasIssue = !!activeIssue();
    if (!S.advanced) {
      item('完成圈选', 'Esc', hasIssue, stopDrawing);
      item('取消未完成的选框', '', hasSel, cancelPendingSelection);
      item(S.mode === 'issues' ? '取消选中问题' : '取消选中部件', '', S.mode === 'issues' ? hasIssue : hasPart,
        S.mode === 'issues' ? deselectIssue : deselectPart);
      sep();
      item('撤销', 'Ctrl+Z', S.undo.length > 0, undo);
      item('重做', 'Ctrl+Shift+Z', S.redo.length > 0, redo);
      sep();
      item(S.showIssues ? '隐藏问题层' : '显示问题层', 'I', S.issues.length > 0, function () {
        S.showIssues = !S.showIssues;
        $('#showIssuesChk').checked = S.showIssues;
        S.issueOverlayDirty = true; scheduleRender();
      });
      item('适配画面', 'F', !!S.img, fitView);
      item('保存标注', 'Ctrl+S', !!S.img, function () { saveBundle(false); });
    } else {
    item('取消选区', 'Esc', hasSel, clearSelection);
    if (S.mode === 'issues') item('取消选中问题', '', hasIssue, deselectIssue);
    else item('取消选中部件', '', hasPart, deselectPart);
    sep();
    if (S.mode === 'issues') {
      item('写入当前问题目标', 'Enter', hasSel && hasIssue, applyIssueSelection);
      item('从当前目标擦除', 'Del', hasSel && hasIssue, eraseIssueSelection);
    } else {
      item('赋给当前件', 'Enter', hasSel && hasPart, function () { applySelection('assign'); });
      item('从当前件减去', 'Del', hasSel && hasPart, function () { applySelection('subtract'); });
      item('用选区新建部件', 'Ctrl+Shift+N', hasSel, function () { applySelection('new'); });
    }
    sep();
    item('撤销', 'Ctrl+Z', S.undo.length > 0, undo);
    item('重做', 'Ctrl+Shift+Z', S.redo.length > 0, redo);
    sep();
    item(S.showIssues ? '隐藏问题层' : '显示问题层', 'I', S.issues.length > 0, function () {
      S.showIssues = !S.showIssues;
      $('#showIssuesChk').checked = S.showIssues;
      S.issueOverlayDirty = true; scheduleRender();
    });
    item('适配全部', 'F', !!S.img, fitView);
    item('保存拆件包', 'Ctrl+S', !!S.img, function () { saveBundle(false); });
    }
    document.body.appendChild(menu);
    var rect = menu.getBoundingClientRect();
    var x = Math.min(px, window.innerWidth - rect.width - 8);
    var y = Math.min(py, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(4, x) + 'px';
    menu.style.top = Math.max(4, y) + 'px';
    ctxMenuEl = menu;
  }

  // ---------------------------------------------------------------- 对话框
  var dialogPick = null;
  function openDialog(title, desc, items, extra) {
    $('#dialogTitle').textContent = title;
    $('#dialogDesc').textContent = desc || '';
    var list = $('#dialogList');
    list.innerHTML = '';
    (items || []).forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dialog-item';
      var lab = document.createElement('span'); lab.textContent = it.label;
      b.appendChild(lab);
      if (it.meta) { var m = document.createElement('span'); m.className = 'meta'; m.textContent = it.meta; b.appendChild(m); }
      b.addEventListener('click', function () { (it.action || function () {})(); });
      list.appendChild(b);
    });
    var localBtn = $('#dialogLocal');
    localBtn.hidden = !(extra && extra.localFile);
    localBtn.onclick = function () { $('#dialogFile').click(); };
    $('#dialogFile').onchange = function () {
      if (this.files[0] && extra && extra.onFile) extra.onFile(this.files[0]);
      this.value = '';
    };
    $('#dialog').hidden = false;
  }
  function closeDialog() { $('#dialog').hidden = true; }

  // ---------------------------------------------------------------- 载入
  function resetForImage(img, sourcePath) {
    S.img = img;
    S.imgW = img.naturalWidth || img.width;
    S.imgH = img.naturalHeight || img.height;
    S.sourcePath = sourcePath || '';
    S.maps.visible = C.createLabelMap(S.imgW, S.imgH);
    S.maps.hidden = null;
    S.channel = 'visible';
    S.parts = [];
    S.layerSources = {};
    S.layerImages = {};
    S.stackCanvas = null;
    S.stackDirty = true;
    S.visibilityDirty = true;
    S.visibilityCanvas = null;
    S.issues = [];
    S.usedIssueIds = {};
    S.onlyIssuePart = false; S.partPreview = null; S.partPreviewPixels = null; S.partPreviewKey = '';
    $('#onlyIssuePart').checked = false;
    S.activeIssueId = null;
    S.issueTarget = 'region';
    S.issueOverlayDirty = true;
    S.activeId = null;
    S.nextZ = 1;
    S.selection = null;
    S.undo = []; S.redo = [];
    S.projectDir = '';
    S.projectName = '';
    S.reportSource = '';
    S.bundleCreatedAt = '';
    // 取 base 像素供魔法棒
    var off = document.createElement('canvas');
    off.width = S.imgW; off.height = S.imgH;
    var c = off.getContext('2d');
    c.drawImage(img, 0, 0);
    S.basePixels = c.getImageData(0, 0, S.imgW, S.imgH).data;
    overlayCanvas = null; maskCanvas = null;
    S.overlayDirty = true; S.outlineDirty = true;
    $('#emptyState').hidden = true;
    $('#channel').value = 'visible';
    updateSelectionBar();
    renderParts();
    renderIssues();
    fitView();
    setDirty(false);
    if (!S.advanced) setTool('select');
    resetLayoutQuiet();
    msg('图片已打开，点「添加问题」开始');
  }

  function loadImageUrl(url, sourcePath) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resetForImage(img, sourcePath); resolve(img); };
      img.onerror = function () { reject(new Error('图片载入失败: ' + url)); };
      img.src = url;
    });
  }
  function loadImageFile(file) {
    var url = URL.createObjectURL(file);
    loadImageUrl(url, file.name).then(function () { URL.revokeObjectURL(url); })
      .catch(function (err) { msg(err.message); });
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return r.json();
    });
  }

  function openSourceDialog() {
    fetchJson('/api/sources').then(function (data) {
      var items = (data.sources || []).map(function (s) {
        return {
          label: s.label,
          meta: s.path,
          action: function () {
            loadImageUrl(repoUrl(s.path), s.path).then(function () {
              S.character = s.character || 'deepseek';
              S.view = s.view || 'front';
              closeDialog();
              msg('已载入原立绘 ' + s.path);
            }).catch(function (e) { msg(e.message); });
          }
        };
      });
      if (!items.length) items.push({ label: '没有在 assets/source/*/three-view 找到图片', meta: '可用本地文件选择', action: function () {} });
      openDialog('载入原立绘', '来自 assets/source/<角色>/three-view/ 的图片；也可以直接拖一张 PNG 进画布。', items, { localFile: true, onFile: function (f) { closeDialog(); loadImageFile(f); } });
    }).catch(function (e) {
      openDialog('载入原立绘', 'API 不可用（' + e.message + '），可直接选择本地图片。', [], { localFile: true, onFile: function (f) { closeDialog(); loadImageFile(f); } });
    });
  }

  function openSplitDialog() {
    var character = S.character || 'deepseek';
    fetchJson('/api/splits?character=' + encodeURIComponent(character)).then(function (data) {
      var items = (data.splits || []).map(function (sp) {
        return {
          label: sp.label,
          meta: sp.path,
          action: function () { closeDialog(); loadSplit(sp.path).catch(function (e) { msg(e.message); }); }
        };
      });
      if (!items.length) items.push({ label: '没找到 workspace/characters/' + character + '/output/parts/*/manifest.json', meta: '', action: function () {} });
      openDialog('载入现有拆分件', '按 manifest 的 z 序把每件 alpha 填成候选掩码；之后可以改错、挪像素、合并或拆分。', items);
    }).catch(function (e) { msg('载入拆分件失败：' + e.message); });
  }

  function openProjectDialog() {
    var character = S.character || 'deepseek';
    fetchJson('/api/projects?character=' + encodeURIComponent(character)).then(function (data) {
      var items = (data.projects || []).map(function (p) {
        return { label: p.label, meta: p.updatedAt || p.path, action: function () { closeDialog(); loadProject(p.path).catch(function (e) { msg(e.message); }); } };
      });
      if (!items.length) items.push({ label: '还没有已保存的工程', meta: '先标注并保存', action: function () {} });
      openDialog('打开本地标注工程', '来自 workspace/characters/' + character + '/annotation/*/annotations.json。', items);
    }).catch(function (e) { msg('打开工程失败：' + e.message); });
  }

  function dirname(path) { var i = path.lastIndexOf('/'); return i >= 0 ? path.slice(0, i) : ''; }
  // 仓库相对路径 → 站点根绝对 URL（页面在 /tools/part-annotator/ 下，必须加前导 /）
  function repoUrl(p) {
    if (!p) return p;
    if (/^(https?:|blob:|data:)/i.test(p)) return p;
    return '/' + String(p).replace(/^\/+/, '');
  }
  // 兼容省略 workspace/ 的写法：characters/... → workspace/characters/...
  function normalizeWorkspacePath(p) {
    if (!p) return p;
    var s = String(p).replace(/^\/+/, '');
    if (/^characters\//.test(s)) return 'workspace/' + s;
    return s;
  }

  function loadSplit(manifestPath) {
    manifestPath = normalizeWorkspacePath(manifestPath);
    msg('正在载入拆分件…');
    return fetchJson(repoUrl(manifestPath)).then(function (mf) {
      var view = mf.views ? Object.keys(mf.views)[0] : 'front';
      var views = mf.views || {};
      var v = views[view] || {};
      var parts = v.parts || [];
      var order = (v.composition && v.composition.backToFront) || parts.map(function (p) { return p.name; });
      var byName = {};
      parts.forEach(function (p) { byName[p.name] = p; });
      var baseDir = dirname(manifestPath);
      // 载入原图：manifest.base 指向 parts 目录里的 front/base_norm? 优先 source original
      var baseFile = (v.base && v.base.file) || '';
      var basePath = baseFile ? baseDir + '/' + baseFile : '';
      var character = mf.character || S.character || 'deepseek';
      S.character = character;
      S.view = view;
      var sourceGuess = 'assets/source/' + character + '/three-view/' + view + '.png';
      var imgPromise = basePath
        ? loadImageUrl(repoUrl(basePath), sourceGuess)
        : loadImageUrl(repoUrl(sourceGuess), sourceGuess).catch(function () { return null; });
      return imgPromise.then(function () {
        // 建立部件（z 从后到前递增；列表内 z 大=靠前）
        S.parts = [];
        S.nextZ = 1;
        S.maps.visible = C.createLabelMap(S.imgW, S.imgH);
        S.maps.hidden = null;
        var nameToPart = {};
        order.forEach(function (name) {
          var p = byName[name];
          if (!p) return;
          var idxName = name;
          var id = C.normalizeId(idxName, S.parts.map(function (q) { return q.id; }));
          var part = { id: id, name: name, color: C.paletteColor(S.parts.length), z: S.nextZ++, note: '', visible: true };
          S.parts.push(part);
          nameToPart[name] = part;
          S.layerSources[part.id] = baseDir + '/' + p.file;
        });
        // 打开工程时不预选任何部件：由用户点选，避免一进来就有一块被高亮
        S.activeId = null;
        S.outlineDirty = true; S.overlayDirty = true;
        // 逐件把 alpha 填成候选掩码：后 → 前，靠前的覆盖靠后的（与可见归属一致）
        var chain = Promise.resolve();
        order.forEach(function (name) {
          var p = byName[name];
          if (!p) return;
          chain = chain.then(function () {
            var url = baseDir + '/' + p.file;
            return new Promise(function (resolve) {
              var im = new Image();
              im.onload = function () {
                var off = document.createElement('canvas');
                off.width = S.imgW; off.height = S.imgH;
                var c = off.getContext('2d');
                c.drawImage(im, 0, 0);
                var data = c.getImageData(0, 0, S.imgW, S.imgH).data;
                var idx = partIndex(nameToPart[name].id);
                var map = S.maps.visible;
                for (var i = 0, p4 = 0; i < map.length; i++, p4 += 4) {
                  if (data[p4 + 3] > C.MASK_ALPHA_THRESHOLD) map[i] = idx;
                }
                resolve();
              };
              im.onerror = function () { resolve(); };
              im.src = repoUrl(url);
            });
          });
        });
        return chain.then(function () {
          S.overlayDirty = true; S.outlineDirty = true;
          renderParts();
          S.zoom = Math.min((stage.clientWidth - 32) / S.imgW, (stage.clientHeight - 32) / S.imgH);
          fitView();
          setDirty(false);
          msg('已载入 ' + S.parts.length + ' 件候选掩码（来自 ' + manifestPath + '）—— 现在可以改语义');
        });
      });
    });
  }

  function loadProject(annotationsPath) {
    annotationsPath = normalizeWorkspacePath(annotationsPath);
    msg('正在打开标注工程…');
    return fetchJson('/api/project?path=' + encodeURIComponent(annotationsPath)).then(function (res) {
      var proj = res.project || {};
      var dir = res.dir || dirname(annotationsPath);
      var source = proj.source || ('assets/source/' + (proj.character || 'deepseek') + '/three-view/' + (proj.view || 'front') + '.png');
      return loadImageUrl(repoUrl(source), source).then(function () {
        S.character = proj.character || 'deepseek';
        S.view = proj.view || 'front';
        S.parts = (proj.parts || []).map(function (p) {
          return { id: p.id, name: p.name, color: p.color || C.paletteColor(0), z: p.z | 0, note: p.note || '', visible: true };
        });
        S.nextZ = S.parts.reduce(function (m, p) { return Math.max(m, p.z); }, 0) + 1;
        S.maps.visible = C.createLabelMap(S.imgW, S.imgH);
        S.maps.hidden = proj.channels && proj.channels.hidden ? C.createLabelMap(S.imgW, S.imgH) : null;
        S.projectDir = dir;
        S.projectName = dir.split('/').pop();
        // 打开工程时不预选任何部件：由用户点选，避免一进来就有一块被高亮
        S.activeId = null;
        S.outlineDirty = true; S.overlayDirty = true;
        var chain = loadLabelPng(dir + '/label.png', S.maps.visible);
        if (S.maps.hidden) chain = chain.then(function () { return loadLabelPng(dir + '/label-hidden.png', S.maps.hidden); });
        return chain.then(function () {
          S.channel = 'visible';
          $('#channel').value = 'visible';
          renderParts();
          fitView();
          setDirty(false);
          msg('已打开工程 ' + annotationsPath + '（' + S.parts.length + ' 件）');
        });
      });
    });
  }

  function loadLabelPng(url, map) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () {
        var off = document.createElement('canvas');
        off.width = S.imgW; off.height = S.imgH;
        var c = off.getContext('2d');
        c.drawImage(im, 0, 0);
        var data = c.getImageData(0, 0, S.imgW, S.imgH).data;
        for (var i = 0; i < map.length; i++) {
          var o = i * 4;
          map[i] = data[o + 3] > 127 ? clamp(data[o], 0, 255) : 0; // R = 索引，A>0 表示已标注
        }
        resolve();
      };
      im.onerror = function () { resolve(); };
      im.src = repoUrl(url);
    });
  }

  // ---------------------------------------------------------------- 魔法棒
  function applyWand(ev) {
    if (!S.img || !S.basePixels) return;
    if (!S.advanced && S.onlyIssuePart && !S.partPreviewPixels) { msg('部件图片正在载入，请稍候'); return; }
    var pixels = !S.advanced && S.onlyIssuePart ? S.partPreviewPixels : S.basePixels;
    var pt = imagePointFor(ev);
    var x = pixelAt(pt.x), y = pixelAt(pt.y);
    if (!(x >= 0 && x < S.imgW && y >= 0 && y < S.imgH)) {
      clearSelection();
      msg('点在画布外：已取消选区');
      return;
    }
    var alphaAt = pixels[(y * S.imgW + x) * 4 + 3];
    if (alphaAt < C.MASK_ALPHA_THRESHOLD) {
      clearSelection();
      msg('点在透明区域：已取消选区');
      return;
    }
    var isIssue = S.mode === 'issues';
    var it = activeIssue();
    if (isIssue && !it) { msg('先新建/选中一个问题'); return; }
    if (isIssue && S.issueTarget === 'before') { msg('「改动前」不画选区：直接点画布上的部件（或下拉「改动前件」）'); return; }
    var idx = isIssue ? 1 : partIndex(S.activeId);
    if (!isIssue && !idx) { msg('先选中一个部件'); return; }
    var map = isIssue ? issueTargetMap() : S.maps[S.channel];
    // 先复制一份求差异（魔法棒可能大面积扩散）
    var before = map.slice();
    var bbox = C.floodFill(pixels, S.imgW, S.imgH, x, y, S.tolerance, map, idx);
    if (!bbox) { msg('该处颜色区域为空或已经是当前目标'); return; }
    var beforeRegion = C.extractRegion(before, S.imgW, bbox);
    var afterRegion = C.extractRegion(map, S.imgW, bbox);
    var diff = { x0: bbox.x0, y0: bbox.y0, w: bbox.x1 - bbox.x0, h: bbox.y1 - bbox.y0, before: beforeRegion, after: afterRegion };
    if (isIssue) {
      pushUndo({ type: 'issueRegion', issueId: it.id, target: S.issueTarget, diff: diff });
      S.issueOverlayDirty = true;
      renderIssues();
    } else {
      pushUndo({ type: 'region', channel: S.channel, diff: diff });
      S.overlayDirty = true; S.outlineDirty = true;
      renderParts();
    }
    setDirty(true);
    scheduleRender();
    if (isIssue) {
      var blocks = C.countComponents(map, S.imgW, S.imgH, 1);
      msg('魔法棒已把 ' + (bbox.x1 - bbox.x0) + '×' + (bbox.y1 - bbox.y0) + ' 区域累加到问题「' +
        (S.issueTarget === 'region' ? '问题位置' : '改动后') + '」：共 ' + maskCount(map).toLocaleString() + ' px' +
        (blocks > 1 ? '（' + blocks + ' 块）' : '') + '；可继续点/框选');
    } else {
      msg('魔法棒已填充 ' + (bbox.x1 - bbox.x0) + '×' + (bbox.y1 - bbox.y0) + ' 区域到 ' + activePart().name);
    }
  }

  // ---------------------------------------------------------------- 导出 / 保存
  function buildAnnotations() {
    return {
      schemaVersion: 1,
      kind: 'part-annotation',
      character: S.character,
      view: S.view,
      canvas: { width: S.imgW, height: S.imgH },
      source: S.sourcePath,
      seedFrom: S.projectDir ? '' : '',
      parts: S.parts.map(function (p) { return { id: p.id, name: p.name, color: p.color, z: p.z, note: p.note || '' }; }),
      channels: { visible: true, hidden: !!S.maps.hidden },
      updatedAt: nowIso()
    };
  }

  function canvasToPngBytes(canvas) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        blob.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); });
      }, 'image/png');
    });
  }
  function bytesToBase64(bytes) {
    var out = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(out);
  }

  // label 图：R=部件索引，G=B=0，A=标注掩码；索引 0 => A=0
  function makeLabelCanvas(map) {
    var cvs = document.createElement('canvas');
    cvs.width = S.imgW; cvs.height = S.imgH;
    var c = cvs.getContext('2d');
    var img = c.createImageData(S.imgW, S.imgH);
    var buf = img.data;
    for (var i = 0; i < map.length; i++) {
      var v = map[i];
      if (!v) continue;
      var o = i * 4;
      buf[o] = v; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return cvs;
  }
  function makeMaskCanvas(map, idx) {
    var cvs = document.createElement('canvas');
    cvs.width = S.imgW; cvs.height = S.imgH;
    var c = cvs.getContext('2d');
    var img = c.createImageData(S.imgW, S.imgH);
    var buf = img.data;
    for (var i = 0; i < map.length; i++) {
      if (map[i] !== idx) continue;
      var o = i * 4;
      buf[o] = 255; buf[o + 1] = 255; buf[o + 2] = 255; buf[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return cvs;
  }
  function makeCutCanvas(map, idx) {
    var cvs = document.createElement('canvas');
    cvs.width = S.imgW; cvs.height = S.imgH;
    var c = cvs.getContext('2d');
    var img = c.createImageData(S.imgW, S.imgH);
    var buf = img.data;
    var base = S.basePixels;
    for (var i = 0; i < map.length; i++) {
      if (map[i] !== idx) continue;
      var o = i * 4;
      buf[o] = base[o]; buf[o + 1] = base[o + 1]; buf[o + 2] = base[o + 2];
      buf[o + 3] = base[o + 3] > 0 ? base[o + 3] : 255;
    }
    c.putImageData(img, 0, 0);
    return cvs;
  }
  function makePreviewCanvas() {
    var cvs = document.createElement('canvas');
    cvs.width = S.imgW; cvs.height = S.imgH;
    var c = cvs.getContext('2d');
    c.fillStyle = '#151821'; c.fillRect(0, 0, S.imgW, S.imgH);
    c.globalAlpha = 0.55; c.drawImage(S.img, 0, 0); c.globalAlpha = 1;
    var map = S.maps.visible;
    var img = c.createImageData(S.imgW, S.imgH);
    var buf = img.data;
    for (var i = 0; i < map.length; i++) {
      var v = map[i];
      if (!v) continue;
      var col = C.hexToRgb(S.parts[v - 1] ? S.parts[v - 1].color : '#888');
      var o = i * 4;
      buf[o] = col.r; buf[o + 1] = col.g; buf[o + 2] = col.b; buf[o + 3] = 150;
    }
    var tmp = document.createElement('canvas');
    tmp.width = S.imgW; tmp.height = S.imgH;
    tmp.getContext('2d').putImageData(img, 0, 0);
    c.drawImage(tmp, 0, 0);
    return cvs;
  }

  async function sha256Bytes(bytes) {
    try {
      if (window.crypto && crypto.subtle) {
        var buf = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(buf)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }
    } catch (e) { /* fall back to empty */ }
    return '';
  }

  function makeBaseCanvas() {
    var cvs = document.createElement('canvas');
    cvs.width = S.imgW; cvs.height = S.imgH;
    cvs.getContext('2d').drawImage(S.img, 0, 0);
    return cvs;
  }

  // 构建标准拆件包（parts-bundle v1）：index.json + parts.json + base/masks/cuts/composite/preview
  async function buildPartsBundle() {
    var BUNDLE = window.PartAnnotatorBundle;
    if (!BUNDLE) throw new Error('bundle.js 未加载');
    var project = buildAnnotations();
    var order = S.parts.slice().sort(function (a, b) { return a.z - b.z; }); // 后 → 前
    var files = [];
    var baseBytes = await canvasToPngBytes(makeBaseCanvas());
    files.push({ name: 'base.png', bytes: baseBytes });

    var comp = document.createElement('canvas');
    comp.width = S.imgW; comp.height = S.imgH;
    var compCtx = comp.getContext('2d');
    var partsList = { schemaVersion: 1, kind: 'parts-list', backToFront: [], parts: [] };

    for (var i = 0; i < order.length; i++) {
      var p = order[i], idx = partIndex(p.id);
      var refs = {
        mask: 'masks/' + p.id + '.png',
        cut: 'cuts/' + p.id + '.png'
      };
      var maskCanvas = makeMaskCanvas(S.maps.visible, idx);
      var cutCanvas = makeCutCanvas(S.maps.visible, idx);
      files.push({ name: refs.mask, bytes: await canvasToPngBytes(maskCanvas) });
      files.push({ name: refs.cut, bytes: await canvasToPngBytes(cutCanvas) });
      compCtx.drawImage(cutCanvas, 0, 0);
      if (S.maps.hidden) {
        refs.hiddenMask = 'hidden/' + p.id + '.png';
        refs.hiddenCut = 'cuts-hidden/' + p.id + '.png';
        files.push({ name: refs.hiddenMask, bytes: await canvasToPngBytes(makeMaskCanvas(S.maps.hidden, idx)) });
        files.push({ name: refs.hiddenCut, bytes: await canvasToPngBytes(makeCutCanvas(S.maps.hidden, idx)) });
      }
      partsList.backToFront.push(p.id);
      partsList.parts.push({ id: p.id, name: p.name, z: p.z, color: p.color, note: p.note || '', files: refs });
    }
    files.push({ name: 'composite.png', bytes: await canvasToPngBytes(comp) });
    files.push({ name: 'preview.png', bytes: await canvasToPngBytes(makePreviewCanvas()) });
    files.push({ name: 'annotations.json', bytes: new TextEncoder().encode(JSON.stringify(project, null, 2)) });

    // 保留已有成品层（载入现有拆分件 / 旧拆件包时不要丢 layers/）
    var layerAdded = 0;
    for (var li = 0; li < partsList.parts.length; li++) {
      var lp = partsList.parts[li];
      var src = S.layerSources && S.layerSources[lp.id];
      if (!src) continue;
      try {
        var resp = await fetch(repoUrl(src));
        if (!resp.ok) continue;
        var layerBytes = new Uint8Array(await resp.arrayBuffer());
        files.push({ name: 'layers/' + lp.id + '.png', bytes: layerBytes });
        lp.files.layer = 'layers/' + lp.id + '.png';
        layerAdded++;
      } catch (e) { /* 缺这一层就跳过 */ }
    }

    // 问题标注：issues.json + issues/<id>[-before|-after].png
    var issuesDoc = { schemaVersion: 1, kind: 'issues-list', issues: [] };
    for (var ii = 0; ii < S.issues.length; ii++) {
      var it = S.issues[ii];
      var rPx = maskCount(it.masks.region), bPx = maskCount(it.masks.before), aPx = maskCount(it.masks.after);
      if (!rPx && !bPx && !aPx) continue;   // 空问题不写文件
      var refs = { region: 'issues/' + it.id + '.png' };
      files.push({ name: refs.region, bytes: await canvasToPngBytes(makeMaskCanvas(it.masks.region, 1)) });
      if (bPx) {
        refs.before = 'issues/' + it.id + '-before.png';
        files.push({ name: refs.before, bytes: await canvasToPngBytes(makeMaskCanvas(it.masks.before, 1)) });
      }
      if (aPx) {
        refs.after = 'issues/' + it.id + '-after.png';
        files.push({ name: refs.after, bytes: await canvasToPngBytes(makeMaskCanvas(it.masks.after, 1)) });
      }
      issuesDoc.issues.push({
        id: it.id, type: it.type, severity: it.severity, partId: it.partId || '',
        beforePartId: it.beforePartId || '',
        note: it.note || '',
        files: refs, bbox: issueBBox(it),
        pixels: { region: rPx, before: bPx, after: aPx, blocks: issueBlocks(it) },
        createdAt: it.createdAt
      });
    }

    var index = BUNDLE.emptyIndex({
      label: S.projectName || (S.character + '-' + S.view),
      character: S.character,
      view: S.view,
      width: S.imgW,
      height: S.imgH,
      source: S.sourcePath,
      baseSha256: await sha256Bytes(baseBytes),
      parts: partsList.parts.length,
      createdAt: S.bundleCreatedAt || undefined
    });
    index.partsFile = 'parts.json';
    index.files.masks = 'masks/';
    index.files.cuts = 'cuts/';
    index.files.hidden = S.maps.hidden ? 'hidden/' : undefined;
    index.files.cutsHidden = S.maps.hidden ? 'cuts-hidden/' : undefined;
    index.provenance = {
      tool: 'tools/part-annotator',
      generator: 'part-annotator v1',
      method: 'manual semantic annotation (rect/polygon/brush/wand)',
      source: S.sourcePath,
      bundle: S.projectName || ''
    };
    if (!S.maps.hidden) { delete index.files.hidden; delete index.files.cutsHidden; }
    // report.md：来自已有拆件包时原样带回
    if (S.reportSource) {
      try {
        var rr = await fetch(repoUrl(S.reportSource));
        if (rr.ok) {
          files.push({ name: 'report.md', bytes: new Uint8Array(await rr.arrayBuffer()) });
          index.files.report = 'report.md';
        }
      } catch (e) { /* 拿不到就不带 */ }
    }
    if (!index.files.report) delete index.files.report;
    if (!layerAdded) delete index.files.layers;
    if (issuesDoc.issues.length) {
      files.push({ name: 'issues.json', bytes: new TextEncoder().encode(JSON.stringify(issuesDoc, null, 2)) });
      index.issuesFile = 'issues.json';
      index.issues = issuesDoc.issues.length;
      index.files.issues = 'issues/';
    }
    var check = BUNDLE.validateBundleWithIssues(index, partsList, issuesDoc.issues.length ? issuesDoc : null);
    if (!check.ok) throw new Error('拆件包校验失败: ' + check.errors.join('; '));
    files.push({ name: 'parts.json', bytes: new TextEncoder().encode(JSON.stringify(partsList, null, 2)) });
    files.push({ name: 'index.json', bytes: new TextEncoder().encode(JSON.stringify(index, null, 2)) });
    return { index: index, parts: partsList, files: files };
  }

  async function saveBundle(saveAs) {
    if (!S.img) { msg('先打开图片或工程'); return; }
    cancelPendingSelection();
    var unfinished = S.issues.filter(function (it) { return !maskCount(it.masks.region); })[0];
    if (unfinished) {
      S.activeIssueId = unfinished.id; setMode('issues'); renderIssues();
      msg('这个问题还没圈位置：圈一下再保存，或删除这条问题');
      return;
    }
    var missingPart = S.issues.filter(function (it) { return !it.partId || !partById(it.partId); })[0];
    if (missingPart) {
      S.activeIssueId = missingPart.id; setMode('issues'); renderIssues();
      msg('这个问题还没选「哪个部件有问题」：在第 1 步选一件，再保存');
      return;
    }
    var targetName = S.projectName;
    if (saveAs || !targetName) {
      targetName = prompt(
        '拆件包名（写入 workspace/characters/' + S.character + '/parts-bundles/<名字>/）' +
        (S.projectName ? '\n当前：' + S.projectName + '；改名即另存为新包' : '') + '：',
        S.projectName || (S.character + '-' + S.view + '-bundle'));
    }
    if (!targetName) return;
    var name = targetName;
    if (!C.SAFE_ID_RE.test(name)) { msg('拆件包名必须字母数字开头，可含 . _ -（≤64 字符）'); return; }
    if (!S.caps || !S.caps.saveBundle) {
      if (!S.caps || !S.caps.saveProject) { msg('保存接口不可用（只读服务），已改为导出拆件包 ZIP'); await exportZip(); return; }
    }
    msg('正在打包拆件包' + (name === S.projectName ? '（写回 ' + name + '）' : '（另存为 ' + name + '）') + '…');
    try {
      var bundle = await buildPartsBundle();
      var payload = {
        action: 'save-bundle',
        character: S.character,
        bundleId: name,
        index: bundle.index,
        parts: bundle.parts,
        files: bundle.files.map(function (f) { return { name: f.name, base64: bytesToBase64(f.bytes) }; })
      };
      var res = await fetch('/api/save-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
      S.projectName = name;
      S.projectDir = data.dir;
      setDirty(false);
      msg(S.advanced ? '已保存拆件包到 ' + data.dir : '✓ 标注已保存到「' + name + '」');
      renderIssues();
    } catch (e) {
      msg('保存失败：' + e.message + '（可在只读服务下用「导出拆件包 ZIP」）');
    }
  }

  async function exportZip() {
    if (!S.img) { msg('先载入原立绘'); return; }
    var BUNDLE = window.PartAnnotatorBundle;
    msg('正在打包拆件包 ZIP…');
    try {
      var bundle = await buildPartsBundle();
      var fileMap = {};
      bundle.files.forEach(function (f) { fileMap[f.name] = f.bytes; });
      var entries = BUNDLE.toZipEntries({ index: bundle.index, parts: bundle.parts, files: fileMap });
      var zipBytes = C.zipStore(entries);
      var blob = new Blob([zipBytes], { type: 'application/zip' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = (S.projectName || (S.character + '-' + S.view + '-bundle')) + '.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
      msg('已导出拆件包 ZIP（' + entries.length + ' 个文件，' + Math.round(zipBytes.length / 1024) + ' KB，index.json 在根目录）');
    } catch (e) {
      msg('导出失败：' + e.message);
    }
  }

  async function loadBundle(indexPath) {
    var BUNDLE = window.PartAnnotatorBundle;
    var rel = normalizeWorkspacePath(indexPath);
    msg('正在打开拆件包…');
    var res = await fetchJson('/api/bundle?path=' + encodeURIComponent(rel));
    var idx = res.index, pl = res.parts, dir = res.dir;
    var check = BUNDLE.validateBundle(idx, pl);
    if (!check.ok) throw new Error('拆件包校验失败: ' + check.errors.join('; '));
    var baseRel = dir + '/' + idx.base.file;
    var source = idx.source || baseRel;
    return loadImageUrl(repoUrl(baseRel), source).then(function () {
      S.character = idx.character;
      S.view = idx.view;
      S.layerSources = {};
      S.layerImages = {};
      S.stackDirty = true;
      S.parts = pl.parts.map(function (p) {
        return { id: p.id, name: p.name, color: p.color || C.paletteColor(0), z: p.z | 0, note: p.note || '', visible: true };
      }).sort(function (a, b) { return a.z - b.z; });
      pl.parts.forEach(function (p) {
        if (p.files && p.files.layer) S.layerSources[p.id] = dir + '/' + p.files.layer;
      });
      ensureLayerImages();
      S.nextZ = S.parts.reduce(function (m, p) { return Math.max(m, p.z); }, 0) + 1;
      S.maps.visible = C.createLabelMap(S.imgW, S.imgH);
      S.maps.hidden = idx.files && idx.files.hidden ? C.createLabelMap(S.imgW, S.imgH) : null;
      S.projectDir = dir;
      S.projectName = dir.split('/').pop();
      S.reportSource = (idx.files && idx.files.report) ? (dir + '/' + idx.files.report) : '';
      S.bundleCreatedAt = idx.createdAt || '';
      S.quadSelect = idx.view || 'front';
      // 打开工程时不预选任何部件：由用户点选，避免一进来就有一块被高亮
      S.activeId = null;
      S.outlineDirty = true; S.overlayDirty = true;
      S.visibilityDirty = true;
      // 载入顺序：后 → 前。有 mask 用 mask；只有 layer 时按 alpha>10 填
      var chain = Promise.resolve();
      pl.backToFront.forEach(function (id) {
        chain = chain.then(function () {
          var p = null;
          for (var i = 0; i < pl.parts.length; i++) if (pl.parts[i].id === id) p = pl.parts[i];
          if (!p) return Promise.resolve();
          var pi = partIndex(p.id);
          var filesRef = p.files || {};
          var jobs = [];
          if (filesRef.mask) jobs.push(loadMaskPng(dir + '/' + filesRef.mask, pi, 'visible'));
          else if (filesRef.layer) jobs.push(seedFromLayerPng(dir + '/' + filesRef.layer, pi, 'visible'));
          if (filesRef.hiddenMask && S.maps.hidden) jobs.push(loadMaskPng(dir + '/' + filesRef.hiddenMask, pi, 'hidden'));
          return Promise.all(jobs);
        });
      });
      var finish = function () {
        if (!idx.issuesFile) return Promise.resolve();
        return fetchJson(repoUrl(dir + '/' + idx.issuesFile)).then(function (doc) {
          var vv = BUNDLE.validateIssues(doc);
          if (!vv.ok) throw new Error('issues.json 校验失败: ' + vv.errors.join('; '));
          S.issues = doc.issues.map(function (x) {
            return {
              id: x.id, type: x.type, severity: x.severity | 0, partId: x.partId || '',
              beforePartId: x.beforePartId || (x.files && x.files.before ? (x.partId || '') : ''),
              note: x.note || '',
              masks: { region: C.createLabelMap(S.imgW, S.imgH), before: null, after: null },
              createdAt: x.createdAt || ''
            };
          });
          S.activeIssueId = S.issues.length ? S.issues[0].id : null;
          return Promise.all(S.issues.map(function (it, k) {
            var refs = (doc.issues[k] && doc.issues[k].files) || {};
            var jobs = [];
            if (refs.region) jobs.push(loadMaskInto(dir + '/' + refs.region, it.masks.region, 1));
            if (refs.before) {
              it.masks.before = C.createLabelMap(S.imgW, S.imgH);
              jobs.push(loadMaskInto(dir + '/' + refs.before, it.masks.before, 1));
            }
            if (refs.after) {
              it.masks.after = C.createLabelMap(S.imgW, S.imgH);
              jobs.push(loadMaskInto(dir + '/' + refs.after, it.masks.after, 1));
            }
            return Promise.all(jobs);
          }));
        }).catch(function (err) {
          // issues.json 缺失 / 读不到时不能让整个工程打不开，按“没有问题记录”处理
          S.issues = [];
          S.activeIssueId = null;
          if (window.console && console.warn) console.warn('[part-annotator] 读取问题记录失败，按空处理：', err && err.message);
          return Promise.resolve();
        });
      };
      return chain.then(function () { renderParts(); }).then(finish).then(function () {
        S.overlayDirty = true; S.outlineDirty = true; S.visibilityDirty = true;
        S.issueOverlayDirty = true;
        renderIssues();
        resetLayoutQuiet();
        fitView();
        setDirty(false);
        msg(S.advanced ? '已打开拆件包 ' + dir : '已打开「' + S.projectName + '」 · ' + S.issues.length + ' 条问题');
      });
    });
  }

  function loadMaskInto(url, map, value) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () {
        var off = document.createElement('canvas');
        off.width = S.imgW; off.height = S.imgH;
        var c = off.getContext('2d');
        c.drawImage(im, 0, 0);
        var data = c.getImageData(0, 0, S.imgW, S.imgH).data;
        for (var i = 0; i < map.length; i++) if (data[i * 4 + 3] > 127) map[i] = value;
        resolve();
      };
      im.onerror = function () { resolve(); };
      im.src = repoUrl(url);
    });
  }

  function loadMaskPng(url, idx, channel) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () {
        var off = document.createElement('canvas');
        off.width = S.imgW; off.height = S.imgH;
        var c = off.getContext('2d');
        c.drawImage(im, 0, 0);
        var data = c.getImageData(0, 0, S.imgW, S.imgH).data;
        var map = S.maps[channel];
        for (var i = 0; i < map.length; i++) if (data[i * 4 + 3] > 127) map[i] = idx;
        resolve();
      };
      im.onerror = function () { resolve(); };
      im.src = repoUrl(url);
    });
  }

  function seedFromLayerPng(url, idx, channel) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () {
        var off = document.createElement('canvas');
        off.width = S.imgW; off.height = S.imgH;
        var c = off.getContext('2d');
        c.drawImage(im, 0, 0);
        var data = c.getImageData(0, 0, S.imgW, S.imgH).data;
        var map = S.maps[channel];
        for (var i = 0; i < map.length; i++) if (data[i * 4 + 3] > C.MASK_ALPHA_THRESHOLD) map[i] = idx;
        resolve();
      };
      im.onerror = function () { resolve(); };
      im.src = repoUrl(url);
    });
  }

  function openBundleByPath() {
    var p = prompt('输入仓库相对路径的 index.json（可放在仓库任意目录，例如 workspace/.../parts-bundles/xxx/index.json）：',
      S.projectDir ? (S.projectDir + '/index.json') : 'workspace/characters/deepseek/parts-bundles/deepseek-front-v1/index.json');
    if (!p) return;
    loadBundle(p).catch(function (e) { msg('打开拆件包失败：' + e.message); });
  }

  function openBundleDialog() {
    var character = S.character || 'deepseek';
    fetchJson('/api/bundles?character=' + encodeURIComponent(character)).then(function (data) {
      var items = (data.bundles || []).map(function (b) {
        return {
          label: b.label,
          meta: b.updatedAt || b.dir,
          action: function () { closeDialog(); loadBundle(b.path).catch(function (e) { msg('打开拆件包失败：' + e.message); }); }
        };
      });
      if (!items.length) items.push({ label: '还没有拆件包', meta: '先标注并「保存拆件包」', action: function () {} });
      openDialog('打开工程', '选择要继续标注的工程。', items);
    }).catch(function (e) { msg('读取拆件包列表失败：' + e.message); });
  }

  // ---------------------------------------------------------------- 启动
  function boot() {
    cv = $('#cv');
    stage = $('#stage');
    ctx = cv.getContext('2d');
    layoutCanvas();
    bindEvents();
    setTool('rect');
    setChannel('visible');
    updateZoomLabel();
    renderParts();
    renderIssues();
    setMode('issues');
    setTool('select');
    syncPaneOrigin();
    // 默认看原图：部件颜色按需打开（高级编辑里沿用原来的默认开启）
    $('#showMask').checked = S.showMask = S.advanced;
    $('#useStack').checked = S.baseMode === 'stack';
    resetLayoutQuiet();
    document.body.dataset.build = BUILD;
    window.__partAnnotatorBuild = BUILD;
    if (window.console && console.info) console.info('[part-annotator] build ' + BUILD);

    fetchJson('/api/capabilities').then(function (caps) {
      S.caps = caps;
      if (!S.img) msg('打开工程，开始记录问题');
    }).catch(function () {
      S.caps = { saveProject: false, saveBundle: false };
      msg('静态服务可用（无保存 API）：可用 ZIP 导出');
    });

    // 深链：?bundle=<index.json> / ?source=<png> / ?parts=<manifest> / ?project=<annotations.json>
    var q = new URLSearchParams(location.search);
    var src = q.get('source');
    var parts = q.get('parts');
    var project = q.get('project');
    var bundlePath = q.get('bundle');
    if (bundlePath) {
      loadBundle(bundlePath).catch(function (e) { msg('打开拆件包失败：' + e.message); });
    } else if (project) {
      loadProject(project).catch(function (e) { msg(e.message); });
    } else if (src) {
      if (parts) {
        // 先载入原图，再载入拆分件（loadSplit 自己会载入图）
        loadSplit(parts).catch(function (e) { msg(e.message); });
      } else {
        loadImageUrl(repoUrl(src), src).catch(function (e) { msg(e.message); });
      }
    } else if (parts) {
      loadSplit(parts).catch(function (e) { msg(e.message); });
    }
    if (window.__partAnnotatorDebug) window.__partAnnotatorDebug.state = S;
  }

  window.__partAnnotator = {
    state: S,
    core: C,
    loadSource: function (path) { return loadImageUrl(repoUrl(path), path); },
    loadSplit: loadSplit,
    loadProject: loadProject,
    save: saveBundle,
    saveAs: function () { return saveBundle(true); },
    openBundle: openBundleDialog,
    openBundlePath: openBundleByPath,
    loadBundle: loadBundle,
    exportZip: exportZip,
    annotations: buildAnnotations,
    render: render,
    createPart: createPart,
    selectPart: selectPart,
    deletePart: deletePart,
    mergePart: mergePart,
    setTool: setTool,
    setChannel: setChannel,
    setMode: setMode,
    setAdvanced: setAdvanced,
    setLayout: setLayout,
    paneRect: function (key) {
      var panes = paneLayout();
      for (var i = 0; i < panes.length; i++) {
        if (panes[i].key !== key) continue;
        var src = paneSource(panes[i]);
        if (!src) return null;
        return paneRect(panes[i], src.w, src.h);
      }
      return null;
    },
    sharedView: sharedView,
    fitPaneKey: fitPaneKey,
    setBaseMode: function (mode) { S.baseMode = mode === 'stack' ? 'stack' : 'art'; $('#useStack').checked = S.baseMode === 'stack'; if (S.baseMode === 'stack') ensureLayerImages(); scheduleRender(); },
    stackCanvas: function () { if (S.stackDirty) rebuildStack(); return S.stackCanvas; },
    stopDrawing: stopDrawing,
    createIssue: createIssue,
    deleteIssue: deleteIssue,
    applyIssueSelection: applyIssueSelection,
    eraseIssueSelection: eraseIssueSelection,
    setIssueTarget: setIssueTarget,
    setIssueBeforeFromPart: setIssueBeforeFromPart,
    clearIssueBefore: clearIssueBefore,
    pickPartAt: pickPartAt,
    issueBlocks: function (id) {
      var target = id ? S.issues.filter(function (x) { return x.id === id; })[0] : activeIssue();
      return issueBlocks(target || null);
    },
    issueSummary: function () { return S.issues.map(function (it) { return { id: it.id, type: it.type, severity: it.severity, partId: it.partId, beforePartId: it.beforePartId || '', note: it.note, region: maskCount(it.masks.region), before: maskCount(it.masks.before), after: maskCount(it.masks.after), blocks: issueBlocks(it) }; }); },
    setPartVisible: function (id, v) {
      var p = partById(id);
      if (!p) return false;
      p.visible = !!v;
      S.overlayDirty = true; S.outlineDirty = true; S.visibilityDirty = true; S.stackDirty = true;
      renderParts(); scheduleRender();
      return true;
    },
    wandAt: function (ix, iy) {
      var r = cv.getBoundingClientRect();
      applyWand({ clientX: r.left + S.paneOrigin.x + S.tx + ix * S.zoom, clientY: r.top + S.paneOrigin.y + S.ty + iy * S.zoom });
    },
    setSelectionRect: function (x0, y0, x1, y1) {
      S.selection = { type: 'rect', x0: x0, y0: y0, x1: x1, y1: y1 };
      updateSelectionBar(); scheduleRender();
    },
    clearSelection: clearSelection,
    applySelection: applySelection,
    undo: undo,
    redo: redo,
    fit: fitView,
    setProjectName: function (name) { S.projectName = name; },
    summary: function () {
      var out = { parts: S.parts.length, activeId: S.activeId, channel: S.channel, canvas: [S.imgW, S.imgH], counts: {},
                  mode: S.mode, issues: S.issues.length, activeIssueId: S.activeIssueId,
                  issueCounts: S.issues.map(function (it) { return { id: it.id, type: it.type, region: maskCount(it.masks.region), before: maskCount(it.masks.before), after: maskCount(it.masks.after) }; }) };
      S.parts.forEach(function (p) {
        var idx = partIndex(p.id);
        var n = 0;
        ['visible', 'hidden'].forEach(function (ch) {
          var m = S.maps[ch]; if (!m) return;
          for (var i = 0; i < m.length; i++) if (m[i] === idx) n++;
        });
        out.counts[p.id] = n;
      });
      return out;
    },
    tools: { rect: 'rect', poly: 'poly', brush: 'brush', wand: 'wand' }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();