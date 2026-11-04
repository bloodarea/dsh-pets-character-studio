/* =============================================================================
   拆件包 v1（parts-bundle）· 纯数据模块（无 DOM / fetch / 磁盘）
   - 一个文件夹 = 一个工程；唯一入口 index.json；部件清单 parts.json。
   - 所有引用都是包内相对路径，整包可移动 / 可压成 ZIP（index.json 在根）。
   - 图片目录固定：layers / masks / cuts / hidden / cuts-hidden；根下 base.png、
     composite.png、preview.png、report.md 可选。
   浏览器：window.PartAnnotatorBundle；Node：module.exports。
   ============================================================================= */
(function (root) {
  'use strict';

  var B = {};
  B.SCHEMA_VERSION = 1;
  B.KIND = 'parts-bundle';
  B.PARTS_KIND = 'parts-list';
  B.ENTRY = 'index.json';
  B.PARTS_FILE = 'parts.json';
  B.DIRS = { layers: 'layers/', masks: 'masks/', cuts: 'cuts/', hidden: 'hidden/', cutsHidden: 'cuts-hidden/' };
  B.ROOT_FILES = ['base.png', 'base-norm.png', 'composite.png', 'preview.png', 'report.md', 'annotations.json', 'issues.json'];
  B.ISSUES_FILE = 'issues.json';
  B.ISSUES_DIR = 'issues/';
  B.ISSUE_TYPES = ['edge-missing', 'jagged', 'under-split', 'over-split', 'wrong-part', 'completion', 'other'];
  B.ISSUE_LABELS = {
    'edge-missing': '边缘缺失',
    'jagged': '毛边/锯齿',
    'under-split': '拆少了',
    'over-split': '拆多了',
    'wrong-part': '归属错误',
    'completion': '补全质量',
    'other': '其他'
  };
  B.ISSUE_COLORS = {
    'edge-missing': '#ff5c5c',
    'jagged': '#ffa94d',
    'under-split': '#b197fc',
    'over-split': '#4dabf7',
    'wrong-part': '#f06595',
    'completion': '#ffd43b',
    'other': '#adb5bd'
  };
  B.MAX_PARTS = 251;
  B.ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

  var PNG_RE = /^(?:layers|masks|cuts|hidden|cuts-hidden)\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.png$/;
  var ISSUE_PNG_RE = /^issues\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:-before|-after)?\.png$/;

  B.isSafeRelPath = function (p) {
    if (typeof p !== 'string' || !p) return false;
    if (p.indexOf('\\') >= 0 || p.indexOf('..') >= 0) return false;
    if (p.charAt(0) === '/') return false;
    return p.split('/').every(function (seg) { return seg && seg !== '.' && seg !== '..'; });
  };

  B.isImagePath = function (p) {
    return B.isSafeRelPath(p) && (PNG_RE.test(p) || ISSUE_PNG_RE.test(p) || B.ROOT_FILES.indexOf(p) >= 0);
  };

  B.emptyIndex = function (opts) {
    var o = opts || {};
    return {
      schemaVersion: B.SCHEMA_VERSION,
      kind: B.KIND,
      label: o.label || '',
      character: o.character || 'deepseek',
      view: o.view || 'front',
      canvas: { width: o.width | 0, height: o.height | 0 },
      alphaMode: 'straight',
      base: { file: 'base.png', size: [o.width | 0, o.height | 0], sha256: o.baseSha256 || '' },
      partsFile: B.PARTS_FILE,
      parts: Number.isInteger(o.parts) ? o.parts : 0,
      files: {
        layers: B.DIRS.layers,
        masks: B.DIRS.masks,
        cuts: B.DIRS.cuts,
        hidden: B.DIRS.hidden,
        cutsHidden: B.DIRS.cutsHidden,
        composite: 'composite.png',
        preview: 'preview.png',
        report: 'report.md'
      },
      source: o.source || '',
      provenance: o.provenance || {},
      createdAt: o.createdAt || new Date().toISOString(),
      updatedAt: o.updatedAt || new Date().toISOString()
    };
  };

  B.emptyIssues = function (opts) {
    return { schemaVersion: B.SCHEMA_VERSION, kind: 'issues-list', issues: [] };
  };

  B.validateIssues = function (doc) {
    var errors = [];
    if (!doc || typeof doc !== 'object') return { ok: false, errors: ['issues is not an object'] };
    if (doc.schemaVersion !== B.SCHEMA_VERSION) errors.push('issues.schemaVersion must be 1');
    if (doc.kind !== 'issues-list') errors.push('issues.kind must be issues-list');
    if (!Array.isArray(doc.issues)) return { ok: false, errors: errors.concat('issues.issues must be an array') };
    if (doc.issues.length > 500) errors.push('too many issues');
    var ids = new Set();
    doc.issues.forEach(function (it, i) {
      if (!it || typeof it !== 'object') { errors.push('bad issue at ' + i); return; }
      if (!B.ID_RE.test(String(it.id || ''))) errors.push('bad issue.id at ' + i);
      else if (ids.has(it.id)) errors.push('duplicate issue.id: ' + it.id);
      else ids.add(it.id);
      if (B.ISSUE_TYPES.indexOf(it.type) < 0) errors.push('bad issue.type at ' + i);
      if (!Number.isInteger(it.severity) || it.severity < 1 || it.severity > 3) errors.push('bad issue.severity at ' + i);
      if (it.partId !== undefined && it.partId !== '' && !B.ID_RE.test(String(it.partId))) errors.push('bad issue.partId at ' + i);
      if (it.note !== undefined && typeof it.note !== 'string') errors.push('bad issue.note at ' + i);
      if (!it.files || !it.files.region || !B.isImagePath(it.files.region)) errors.push('issue.files.region required at ' + i);
      if (it.files && it.files.before !== undefined && !B.isImagePath(it.files.before)) errors.push('bad issue.files.before at ' + i);
      if (it.files && it.files.after !== undefined && !B.isImagePath(it.files.after)) errors.push('bad issue.files.after at ' + i);
    });
    return { ok: errors.length === 0, errors: errors };
  };

  B.validateBundleWithIssues = function (idx, parts, issues) {
    var base = B.validateBundle(idx, parts);
    var errors = base.errors.slice();
    if (idx && idx.issuesFile !== undefined) {
      if (idx.issuesFile !== B.ISSUES_FILE) errors.push('issuesFile must be issues.json');
      if (!issues) errors.push('index declares issuesFile but issues.json missing');
      else {
        var iv = B.validateIssues(issues);
        errors = errors.concat(iv.errors);
        if (Number.isInteger(idx.issues) && idx.issues !== issues.issues.length) errors.push('index.issues != issues.issues.length');
      }
    }
    return { ok: errors.length === 0, errors: errors };
  };

  B.emptyParts = function (opts) {
    var o = opts || {};
    return {
      schemaVersion: B.SCHEMA_VERSION,
      kind: B.PARTS_KIND,
      backToFront: [],
      parts: []
    };
  };

  B.validateIndex = function (idx) {
    var errors = [];
    if (!idx || typeof idx !== 'object') return { ok: false, errors: ['index is not an object'] };
    if (idx.schemaVersion !== B.SCHEMA_VERSION) errors.push('schemaVersion must be 1');
    if (idx.kind !== B.KIND) errors.push('kind must be parts-bundle');
    if (!B.ID_RE.test(String(idx.character || ''))) errors.push('bad character id');
    if (!B.ID_RE.test(String(idx.view || ''))) errors.push('bad view id');
    if (idx.label !== undefined && (typeof idx.label !== 'string' || idx.label.length > 120)) errors.push('bad label');
    if (!idx.canvas || !(idx.canvas.width > 0) || !(idx.canvas.height > 0)) errors.push('bad canvas');
    if (idx.alphaMode !== undefined && idx.alphaMode !== 'straight') errors.push('alphaMode must be straight');
    if (!idx.base || typeof idx.base !== 'object') errors.push('base missing');
    else {
      if (idx.base.file !== 'base.png' && idx.base.file !== 'base-norm.png') errors.push('base.file must be base.png/base-norm.png');
      if (!Array.isArray(idx.base.size) || idx.base.size.length !== 2 ||
          idx.base.size[0] !== idx.canvas.width || idx.base.size[1] !== idx.canvas.height) errors.push('base.size must equal canvas');
    }
    if (typeof idx.partsFile !== 'string' || idx.partsFile !== B.PARTS_FILE) errors.push('partsFile must be parts.json');
    if (!Number.isInteger(idx.parts) || idx.parts < 0 || idx.parts > B.MAX_PARTS) errors.push('bad parts count');
    if (!idx.files || typeof idx.files !== 'object') errors.push('files missing');
    else {
      ['layers', 'masks', 'cuts', 'hidden', 'cutsHidden'].forEach(function (k) {
        if (idx.files[k] !== undefined && idx.files[k] !== B.DIRS[k]) errors.push('files.' + k + ' must be ' + B.DIRS[k]);
      });
      ['composite', 'preview', 'report'].forEach(function (k) {
        if (idx.files[k] !== undefined && !B.isImagePath(idx.files[k])) errors.push('files.' + k + ' must be a bundle-relative file');
      });
    }
    if (idx.source !== undefined && idx.source !== '' && !B.isSafeRelPath(idx.source)) errors.push('source must be repo-relative or empty');
    return { ok: errors.length === 0, errors: errors };
  };

  B.validateParts = function (parts, canvas) {
    var errors = [];
    if (!parts || typeof parts !== 'object') return { ok: false, errors: ['parts is not an object'] };
    if (parts.schemaVersion !== B.SCHEMA_VERSION) errors.push('parts.schemaVersion must be 1');
    if (parts.kind !== B.PARTS_KIND) errors.push('parts.kind must be parts-list');
    if (!Array.isArray(parts.parts)) return { ok: false, errors: errors.concat('parts.parts must be an array') };
    if (parts.parts.length > B.MAX_PARTS) errors.push('too many parts');
    if (!Array.isArray(parts.backToFront)) errors.push('backToFront must be an array');
    var ids = new Set();
    parts.parts.forEach(function (p, i) {
      if (!p || typeof p !== 'object') { errors.push('bad part at ' + i); return; }
      if (!B.ID_RE.test(String(p.id || ''))) errors.push('bad part.id at ' + i);
      else if (ids.has(p.id)) errors.push('duplicate part.id: ' + p.id);
      else ids.add(p.id);
      if (typeof p.name !== 'string' || !p.name.trim()) errors.push('bad part.name at ' + i);
      if (!Number.isInteger(p.z)) errors.push('bad part.z at ' + i);
      if (p.files && typeof p.files === 'object') {
        Object.keys(p.files).forEach(function (k) {
          if (!B.isImagePath(p.files[k])) errors.push('bad file ref ' + p.files[k] + ' at part ' + p.id);
        });
      }
    });
    if (Array.isArray(parts.backToFront)) {
      var bset = new Set(parts.backToFront);
      if (bset.size !== parts.backToFront.length) errors.push('backToFront has duplicates');
      parts.backToFront.forEach(function (n) {
        if (!ids.has(n)) errors.push('backToFront references unknown part: ' + n);
      });
      if (parts.backToFront.length !== parts.parts.length) errors.push('backToFront must list every part once');
    }
    return { ok: errors.length === 0, errors: errors };
  };

  B.validateBundle = function (idx, parts) {
    var a = B.validateIndex(idx);
    var b = B.validateParts(parts, idx && idx.canvas);
    var errors = a.errors.concat(b.errors);
    if (idx && parts && Number.isInteger(idx.parts) && idx.parts !== parts.parts.length) errors.push('index.parts != parts.parts.length');
    return { ok: errors.length === 0, errors: errors };
  };

  // 从标注工程（annotations.json schema）生成 parts.json + index.json
  B.fromAnnotation = function (project, refs) {
    var r = refs || {};
    var order = project.parts.slice().sort(function (a, b) { return a.z - b.z; }).map(function (p) { return p.id; });
    var parts = {
      schemaVersion: B.SCHEMA_VERSION,
      kind: B.PARTS_KIND,
      backToFront: order,
      parts: project.parts.map(function (p) {
        return {
          id: p.id,
          name: p.name,
          z: p.z,
          color: p.color || '',
          note: p.note || '',
          files: {
            layer: B.DIRS.layers + p.id + '.png',
            mask: B.DIRS.masks + p.id + '.png',
            cut: B.DIRS.cuts + p.id + '.png'
          }
        };
      })
    };
    if (project.channels && project.channels.hidden) {
      parts.parts.forEach(function (p) {
        p.files.hiddenMask = B.DIRS.hidden + p.id + '.png';
        p.files.hiddenCut = B.DIRS.cutsHidden + p.id + '.png';
      });
    }
    var index = B.emptyIndex({
      label: r.label || '',
      character: project.character,
      view: project.view,
      width: project.canvas.width,
      height: project.canvas.height,
      source: project.source || '',
      baseSha256: r.baseSha256 || '',
      parts: project.parts.length,
      createdAt: r.createdAt || new Date().toISOString(),
      provenance: r.provenance || {}
    });
    index.updatedAt = project.updatedAt || new Date().toISOString();
    return { index: index, parts: parts };
  };

  // ZIP 条目：index.json 在根，图片按目录；bundle.files 里若已含 index/parts 会跳过，避免重名
  B.toZipEntries = function (bundle) {
    // bundle: { index, parts, files: {bundleRelPath: Uint8Array} }
    var enc = new TextEncoder();
    var out = [
      { name: B.ENTRY, bytes: enc.encode(JSON.stringify(bundle.index, null, 2)) },
      { name: B.PARTS_FILE, bytes: enc.encode(JSON.stringify(bundle.parts, null, 2)) }
    ];
    Object.keys(bundle.files || {}).sort().forEach(function (k) {
      if (k === B.ENTRY || k === B.PARTS_FILE) return;
      out.push({ name: k, bytes: bundle.files[k] });
    });
    return out;
  };

  /* BUNDLE:END */
  root.PartAnnotatorBundle = B;
  if (typeof module !== 'undefined' && module.exports) module.exports = B;
})(typeof globalThis !== 'undefined' ? globalThis : this);