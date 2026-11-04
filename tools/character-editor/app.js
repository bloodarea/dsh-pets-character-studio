/*
 * 内置人物包管理器 · 应用层
 *
 * 分层（docs/review/2026-11-01-spine/contract-task1.md A1）：
 *   - 纯数学（解析/采样/矩阵/IK/几何/蒙皮/命中）在 spine-core.js；
 *   - 本文件只碰 DOM / canvas / 状态 / 交互 / 撤销 / 原 JSON 补丁导出。
 *
 * 渲染（A4）：姿势来自 core.evalPose（含 IK 求值），几何来自 core.buildGeometry；
 *   region 走整四边形 affine 快路，mesh / 加权 mesh 逐三角 clip + setTransform + drawImage。
 *   Y 翻转只在 view 层做一次，DPR 只乘在 setTransform 上。
 */
"use strict";
(function () {
  /* ==========================================================================
   * 0. 小工具
   * ====================================================================== */
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const icon = typeof window.spineIcon === "function" ? window.spineIcon : () => "";
  const iconEl = (name, cls) => {
    const wrap = document.createElement("span");
    wrap.innerHTML = icon(name);
    const svg = wrap.firstChild;
    if (svg && cls) svg.classList.add(cls);
    return svg || wrap;
  };
  const round = (v, d) => {
    const p = Math.pow(10, d == null ? 2 : d);
    return Math.round(v * p) / p;
  };
  const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d == null ? 1 : d) : "—");
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const IS_MAC = /mac/i.test(
    (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ""
  );
  const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl";
  const isTypingTarget = (t) => {
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return !!t.isContentEditable;
  };

  const core = window.SpineCore || null;
  const coreInfo = { ready: false, reason: core ? "未载入模型" : "spine-core.js 未加载" };

  /* ==========================================================================
   * 1. 状态
   * ====================================================================== */
  const state = {
    raw: null,
    model: null,
    atlas: null,
    pageImages: [],
    label: "",
    source: "",

    boneList: [],
    bones: Object.create(null),
    slots: [],
    constraints: [],
    ikIssues: Object.create(null),

    zoom: 1,
    panX: 0,
    panY: 0,
    tool: "move",

    sel: -1,
    hover: -1,
    hidden: new Set(),
    locked: new Set(),
    search: "",
    listView: "order",
    collapsed: new Set(),

    dirty: false,
    undo: [],
    initial: null,

    anim: "",
    animDur: 0,
    t: 0,
    playing: false,
    speed: 1,
    loop: true,
    lastTs: 0,

    show: { texture: true, bones: false, mesh: false, weights: false },
    weightMode: "bone",
    texAlpha: 100,
    texAlphaAuto: true,
    snap: false,

    diagnostics: [],
    issueDetails: [],
    unsupportedCount: 0,
    frame: null,
    drag: null,
    spaceDown: false,
    helpOpen: false,

    /* 索引整包 / 保存（契约 §2.1、§4.1） */
    bundle: null,
    writeState: "checking",
    cap: null,
    loading: false,
    saveBusy: false,
    zipBusy: false,
    loadGen: 0,

    /* 事件 · 语音测试（docs/review/2026-11-04-voice-editor/contract.md §2） */
    voice: {
      open: false,
      explicitRequest: null, // ?voice= 原文；init 最前锁定，自动发现永不覆盖（含显式失败）
      provenance: null, // "explicit" | "auto" | "manual" | null
      indexPath: null, // 仓库相对索引路径；手动文件载入为 null
      packRoot: null, // 仓库相对语音包根；null = 音频未解析
      packRootSource: null, // "derived" | "bundle" | "manual"
      rootDraft: "", // 手动包根输入草稿（重渲染不丢）
      voice: null, // voice.js validateIndex 的 value
      events: [],
      summary: null,
      issues: [], // 解析/评估警告（浮层顶部单独展示，不算事件异常）
      issuesOpen: true,
      animations: null, // string[] | null（未载入模型）
      audio: Object.create(null), // audioFile -> checking|ok|missing|unknown
      audioDetail: Object.create(null),
      loadState: "idle", // idle | loading | ready | error
      error: null, // {message, issues, provenance, indexPath}
      autoProbeBusy: false,
      autoProbeFailed: false,
      checking: false,
      loadGen: 0, // 语音索引载入代（旧索引/旧探测迟到保护）
      checkGen: 0, // HEAD 探测代
      playGen: 0, // 播放 Promise / 媒体事件代
      expanded: new Set(), // 保持展开状态（默认全折叠）
      selected: null, // 选中事件名
      search: "",
      category: "all", // "all" | CATEGORIES
      statusFilter: "all", // all | audio-missing | anim-unmapped | pending | ok
      linkAnimation: true, // 「联动动画」复选框（默认开）
      lineErrors: Object.create(null), // 行内播放失败提示（按台词 id）
      hint: "", // 浮层内最近一次播放/联动提示
      hintKind: "",
      play: { event: null, id: null, audioFile: null, url: null, playing: false, duration: 0, error: null },
      renderTimer: 0,
    },
  };

  const cv = $("cv");
  const ctx = cv.getContext("2d");

  /* ==========================================================================
   * 2. 载入
   * ====================================================================== */
  class LoadError extends Error {
    constructor(message, detail) {
      super(message);
      this.detail = detail || "";
    }
  }

  function loadImage(src, label) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new LoadError("图片加载失败：" + (label || src)));
      im.src = src;
    });
  }

  function issueText(issues, n) {
    const list = (issues || []).slice(0, n || 3);
    return list.map((i) => (i.path || "") + " " + (i.message || i.code)).join("；");
  }

  function parseBundle(raw, atlasText) {
    if (!core) throw new LoadError("spine-core.js 未加载，无法解析");
    if (!raw || typeof raw !== "object") throw new LoadError("JSON 内容不是对象");
    const version = raw.skeleton && raw.skeleton.spine;
    if (version && !/^[34]\./.test(String(version))) {
      throw new LoadError("不支持的 skeleton.spine=" + version + "（本编辑器覆盖 3.8 / 4.x 的 region+mesh 子集）");
    }
    const atlasRes = core.parseAtlas(atlasText || "");
    if (!atlasRes || atlasRes.ok !== true) {
      throw new LoadError("图集解析失败", issueText(atlasRes && atlasRes.issues));
    }
    const modelRes = core.parseModel(raw, atlasRes.value, { skin: "default" });
    if (!modelRes || modelRes.ok !== true) {
      throw new LoadError("骨架解析失败", issueText(modelRes && modelRes.issues));
    }
    return { atlas: atlasRes.value, atlasIssues: atlasRes.issues || [], model: modelRes.value };
  }

  function applyLoaded(input) {
    const parsed = parseBundle(input.raw, input.atlasText);
    const model = parsed.model;

    state.raw = typeof structuredClone === "function" ? structuredClone(input.raw) : JSON.parse(JSON.stringify(input.raw));
    state.model = model;
    state.atlas = parsed.atlas;
    state.pageImages = input.pageImages || [];
    state.label = input.label || "";
    state.source = input.source || "";
    state.bundle = input.bundle || null;
    if (state.writeState === "uncertain") {
      state.writeState = state.cap && state.cap.saveBundle ? "ready" : "readonly";
    }

    state.boneList = model.bones.map((b, i) => ({
      name: b.name,
      parentName: b.parentIndex >= 0 && model.bones[b.parentIndex] ? model.bones[b.parentIndex].name : null,
      x: b.x,
      y: b.y,
      rotation: b.rotation,
      scaleX: b.scaleX,
      scaleY: b.scaleY,
      index: i,
    }));
    state.bones = Object.create(null);
    for (const b of state.boneList) state.bones[b.name] = b;

    state.slots = model.slots.map((sl, i) => ({
      name: sl.name,
      index: i,
      boneIndex: sl.boneIndex,
      boneName: model.bones[sl.boneIndex] ? model.bones[sl.boneIndex].name : "",
      attachment: sl.setupAttachment,
    }));
    state.constraints = model.constraints || [];
    state.ikIssues = Object.create(null);

    state.sel = -1;
    state.hover = -1;
    state.hidden = new Set();
    state.locked = new Set();
    state.search = "";
    state.collapsed = new Set();
    state.undo = [];
    state.dirty = false;
    state.anim = "";
    state.animDur = 0;
    state.t = 0;
    state.playing = false;
    state.initial = snapshot();
    coreInfo.ready = true;
    coreInfo.reason = "SpineCore";
    clearNotices();
    state.diagnostics = collectDiagnostics(parsed.atlasIssues, model);
    if (state.unsupportedCount > 0) {
      notice("warn", "部分预览：" + state.unsupportedCount + " 项未求值", [{ label: "查看详情", onClick: () => openDebug() }]);
    }
    for (const d of state.diagnostics.filter((x) => x.severity === "error")) notice("error", d.text);
    if (!state.pageImages.length) notice("warn", "没有载入到图集图片：几何可编辑，但贴图不显示。");

    syncAnimSelect();
    syncExprInputs();
    framePose();
    syncAll();
    fitView("all");
    setStatus("已载入 " + state.slots.length + " 部件 / " + state.boneList.length + " 骨骼 · " + state.label);
    render();
    onModelChanged();
    return true;
  }

  /* --- 载入：统一索引流水线（契约 §2.1） ---------------------------------- */
  const INDEX_NAME = "index.json";
  const EXAMPLE_INDEX = "assets/characters/deepseek/spine/index.json";
  const LEGACY_INDEX = "assets/characters/deepseek/spine/legacy-views/index.json";

  function issuesToError(issues, prefix) {
    const list = issues || [];
    const first = list[0] || { message: "（无详情）" };
    const rest = list
      .slice(1, 4)
      .map((i) => i.message)
      .join("；");
    const paths = list
      .map((i) => i.path)
      .filter(Boolean)
      .join("、");
    return new LoadError((prefix || "") + first.message, rest || paths);
  }

  function textBytes(text) {
    return new TextEncoder().encode(String(text));
  }

  function decodeUtf8(bytes, what) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      throw new LoadError(what + " 不是合法 UTF-8", e.message);
    }
  }

  function guessMime(name) {
    if (/\.webp$/i.test(name)) return "image/webp";
    if (/\.jpe?g$/i.test(name)) return "image/jpeg";
    return "image/png";
  }

  function loadImageFromBytes(bytes, name) {
    const blob = new Blob([bytes], { type: guessMime(name) });
    const url = URL.createObjectURL(blob);
    return loadImage(url, name).finally(() => setTimeout(() => URL.revokeObjectURL(url), 1000));
  }

  async function fetchBytes(url) {
    let res;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch (e) {
      throw new LoadError("读不到 " + url.replace(/^\//, "") + "（网络错误）", e && e.message);
    }
    if (!res.ok) {
      throw new LoadError("读不到 " + url.replace(/^\//, "") + "（HTTP " + res.status + "），请确认索引 base 与文件名");
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  function normalizedIndex(org, base) {
    const out = { schemaVersion: 1, base: base };
    if (org && typeof org.label === "string") out.label = org.label;
    out.files = { model: org.files.model, atlas: org.files.atlas, textures: org.files.textures.slice() };
    return out;
  }

  /**
   * 索引载入主流程：索引校验 → 定位 → GET 三件套 → 解析/页对齐 → 解码 → applyLoaded 一次提交。
   * @param {string|object} indexSource 索引文本或已解析对象
   * @param {{entry?:string, observedBase?:string|null, requireBase?:boolean, retry?:Function}} opts
   */
  async function loadIndexEntry(indexSource, opts) {
    const o = opts || {};
    const lib = window.SpineBundle;
    if (!lib) return reportLoadError(new LoadError("bundle.js 未加载，无法解析索引"));
    const gen = ++state.loadGen;
    state.loading = true;
    syncToolbar();
    try {
      const validated =
        typeof indexSource === "string"
          ? lib.parseIndexText(indexSource, { requireBase: o.requireBase !== false })
          : lib.validateIndex(indexSource, { requireBase: o.requireBase !== false });
      if (!validated.ok) throw issuesToError(validated.issues, "索引校验失败：");
      const norm = validated.value;

      const loc = lib.resolveIndexLocation(norm, o.observedBase == null ? null : o.observedBase);
      if (!loc.ok) throw issuesToError(loc.issues, "索引定位失败：");
      const base = loc.value.base;

      setStatus("载入索引：" + base + " …");
      const modelUrl = "/" + base + "/" + norm.files.model;
      const atlasUrl = "/" + base + "/" + norm.files.atlas;
      const fetched = await Promise.all([fetchBytes(modelUrl), fetchBytes(atlasUrl)]);
      if (gen !== state.loadGen) return false;
      const modelBytes = fetched[0];
      const atlasBytes = fetched[1];

      const modelText = decodeUtf8(modelBytes, norm.files.model);
      const atlasText = decodeUtf8(atlasBytes, norm.files.atlas);
      let raw;
      try {
        raw = JSON.parse(modelText);
      } catch (e) {
        throw new LoadError(norm.files.model + " 不是合法 JSON", e && e.message);
      }
      const parsed = parseBundle(raw, atlasText);

      const pages = lib.validateTexturePages(norm, parsed.atlas.pages);
      if (!pages.ok) throw issuesToError(pages.issues, "贴图清单不一致：");

      const textureBytesByName = Object.create(null);
      const pageImages = [];
      for (const page of parsed.atlas.pages) {
        const bytes = await fetchBytes("/" + base + "/" + page.name);
        if (gen !== state.loadGen) return false;
        textureBytesByName[page.name] = bytes;
        pageImages.push(await loadImageFromBytes(bytes, page.name));
        if (gen !== state.loadGen) return false;
      }

      const index = normalizedIndex(norm, base);
      const label = (norm.label || base.split("/").pop()) + "（" + base + "）";
      return applyLoaded({
        raw: raw,
        atlasText: atlasText,
        pageImages: pageImages,
        label: label,
        source: o.entry || "index",
        bundle: {
          entry: o.entry || "index",
          base: base,
          indexPath: base + "/" + INDEX_NAME,
          index: index,
          indexBytes: textBytes(lib.serializeIndex(index)),
          modelName: norm.files.model,
          atlasName: norm.files.atlas,
          textureNames: norm.files.textures.slice(),
          modelBytes: modelBytes,
          modelText: modelText,
          atlasBytes: atlasBytes,
          atlasText: atlasText,
          textureBytesByName: textureBytesByName,
          canSave: true,
          canArchive: true,
          reason: "",
        },
      });
    } catch (e) {
      if (gen !== state.loadGen) return false;
      reportLoadError(e instanceof LoadError ? e : new LoadError(String((e && e.message) || e)), "重试", o.retry);
      return false;
    } finally {
      if (gen === state.loadGen) {
        state.loading = false;
        syncToolbar();
      }
    }
  }

  /** picker / 拖入：只接受一个 index.json（契约 §2.2） */
  async function loadFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return false;
    const retry = () => $("files").click();
    if (files.length > 1) {
      return reportLoadError(new LoadError("请选择一个 index.json；模型、图集和贴图由索引读取", "本次选了 " + files.length + " 个文件"));
    }
    const file = files[0];
    if (!/\.json$/i.test(file.name) || file.name !== INDEX_NAME) {
      return reportLoadError(
        new LoadError("请选择一个 index.json；模型、图集和贴图由索引读取", "实际文件名：" + file.name),
        "重新选择",
        retry
      );
    }
    let text;
    try {
      text = await file.text();
    } catch (e) {
      return reportLoadError(new LoadError("读取索引失败：" + ((e && e.message) || e)), "重新选择", retry);
    }
    return loadIndexEntry(text, { entry: "picker", requireBase: true, retry: retry });
  }

  /** ?index= / 示例：按仓库根相对路径读取索引（契约 §2.3） */
  async function loadIndexByPath(indexPath, entry) {
    const lib = window.SpineBundle;
    if (!lib) return reportLoadError(new LoadError("bundle.js 未加载，无法解析索引"));
    const p = lib.parseIndexParam(indexPath);
    if (!p.ok) return reportLoadError(issuesToError(p.issues, "?index= 参数无效："));
    let text;
    try {
      text = decodeUtf8(await fetchBytes("/" + p.value.indexPath), p.value.indexPath);
    } catch (e) {
      return reportLoadError(e instanceof LoadError ? e : new LoadError(String((e && e.message) || e)));
    }
    return loadIndexEntry(text, {
      entry: entry || "url",
      requireBase: false,
      observedBase: p.value.observedBase,
    });
  }

  function loadExample() {
    return loadIndexByPath(EXAMPLE_INDEX, "example");
  }

  function loadLegacyExample() {
    return loadIndexByPath(LEGACY_INDEX, "example");
  }

  /**
   * ?rig= 开发兼容：保留读取，但保存禁用、另存尽力可用（契约 §2.4）。
   * 目录与文件名都要能通过 v1 文法才合成只读索引。
   */
  async function loadRig(param) {
    const lib = window.SpineBundle;
    const rig = String(param || "").trim();
    if (!rig) return false;
    if (/^[a-z]+:/i.test(rig) || rig.startsWith("//") || rig.includes("..")) {
      reportLoadError(new LoadError("?rig= 只接受同源相对路径（不能带协议或 ..）"));
      return false;
    }
    const wanted = rig.replace(/\.json$/i, "") + ".json";
    // 站点根相对优先（工具在 /tools/character-editor/ 下，root = ../../），再退回页面相对
    const rootRel = new URL("../../", location.href).pathname;
    const candidates = [rootRel + wanted, wanted];
    const gen = ++state.loadGen;
    state.loading = true;
    syncToolbar();
    setStatus("载入 rig：" + wanted);
    try {
      let jsonPath = null;
      let modelBytes = null;
      let lastStatus = 0;
      for (const cand of candidates) {
        let res = null;
        try {
          res = await fetch(cand, { cache: "no-store" });
        } catch (_) {
          res = null;
        }
        if (res && res.ok) {
          jsonPath = cand;
          modelBytes = new Uint8Array(await res.arrayBuffer());
          break;
        }
        lastStatus = res ? res.status : 0;
      }
      if (!jsonPath) {
        throw new LoadError(
          "读不到 " + wanted + "（HTTP " + (lastStatus || "?") + "）",
          "已试：" + candidates.join(" / ")
        );
      }
      const modelText = decodeUtf8(modelBytes, wanted);
      let raw;
      try {
        raw = JSON.parse(modelText);
      } catch (e) {
        throw new LoadError(wanted + " 不是合法 JSON", e && e.message);
      }
      const relPath = new URL(jsonPath, location.href).pathname.replace(/^\//, "");
      const modelName = relPath.split("/").pop();
      const dir = relPath.slice(0, relPath.length - modelName.length).replace(/\/$/, "");
      const atlasName = modelName.replace(/\.json$/i, ".atlas");
      const atlasBytes = await fetchBytes("/" + (dir ? dir + "/" : "") + atlasName);
      const atlasText = decodeUtf8(atlasBytes, atlasName);
      const parsed = parseBundle(raw, atlasText);
      const textureBytesByName = Object.create(null);
      const pageImages = [];
      for (const page of parsed.atlas.pages) {
        const bytes = await fetchBytes("/" + (dir ? dir + "/" : "") + page.name);
        textureBytesByName[page.name] = bytes;
        pageImages.push(await loadImageFromBytes(bytes, page.name));
      }
      if (gen !== state.loadGen) return false;

      const textureNames = parsed.atlas.pages.map((p) => p.name);
      const index = {
        schemaVersion: 1,
        base: dir,
        label: "rig · " + modelName,
        files: { model: modelName, atlas: atlasName, textures: textureNames.slice() },
      };
      const check = lib ? lib.validateIndex(index, { requireBase: true }) : { ok: false };
      const canArchive = !!(dir && check.ok);
      return applyLoaded({
        raw: raw,
        atlasText: atlasText,
        pageImages: pageImages,
        label: "rig · " + relPath,
        source: "rig",
        bundle: {
          entry: "rig",
          base: dir || null,
          indexPath: dir ? dir + "/" + INDEX_NAME : null,
          index: canArchive ? normalizedIndex(check.value, dir) : index,
          indexBytes: canArchive ? textBytes(lib.serializeIndex(normalizedIndex(check.value, dir))) : null,
          modelName: modelName,
          atlasName: atlasName,
          textureNames: textureNames,
          modelBytes: modelBytes,
          modelText: modelText,
          atlasBytes: atlasBytes,
          atlasText: atlasText,
          textureBytesByName: textureBytesByName,
          canSave: false,
          canArchive: canArchive,
          reason: "已载入但无写回目标：开发 rig 未通过索引载入，可另存 ZIP 或改用 ?index=",
        },
      });
    } catch (e) {
      if (gen !== state.loadGen) return false;
      reportLoadError(
        e instanceof LoadError
          ? e
          : new LoadError(String((e && e.message) || e), "同目录需要 <同名>.atlas + 图集图片（page 名要与 atlas 一致）")
      );
      return false;
    } finally {
      if (gen === state.loadGen) {
        state.loading = false;
        syncToolbar();
      }
    }
  }

  async function loadFixture(id) {
    const cases = fixtureCases();
    const fx = cases && cases[id];
    if (!fx) return reportLoadError(new LoadError("找不到样张：" + id));
    setStatus("载入样张：" + (fx.label || id));
    try {
      const pages = textureSpecs(fx.textureSpec);
      applyLoaded({
        raw: fx.json,
        atlasText: fx.atlasText,
        pageImages: pages.map((p) => textureSpecToCanvas(p)),
        label: "样张 · " + (fx.label || id),
        source: "fixture",
        bundle: {
          entry: "fixture",
          base: null,
          indexPath: null,
          index: null,
          indexBytes: null,
          modelName: null,
          atlasName: null,
          textureNames: [],
          modelBytes: null,
          modelText: null,
          atlasBytes: null,
          atlasText: fx.atlasText,
          textureBytesByName: Object.create(null),
          canSave: false,
          canArchive: false,
          reason: "已载入但无写回目标，且缺少可导出的原始文件字节；请选择 index.json",
        },
      });
      if (pages.length > 1) notice("warn", "样张图集有 " + pages.length + " 页，已全部载入");
    } catch (e) {
      reportLoadError(e);
    }
  }

  function fixtureCases() {
    const f = window.SpineFixtures;
    if (!f) return null;
    return f.cases || f;
  }
  function textureSpecs(spec) {
    const list = Array.isArray(spec) ? spec : [spec];
    return list.filter(Boolean).map((p, i) => Object.assign({ name: p.name || "page" + i + ".png", width: 64, height: 64 }, p));
  }
  function textureSpecToCanvas(spec) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(spec.width || 64));
    c.height = Math.max(1, Math.round(spec.height || 64));
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, c.width, c.height);
    for (const cell of spec.cells || []) {
      const r = cell.rect || [0, 0, c.width, c.height];
      g.fillStyle = cell.color || "#888";
      g.fillRect(r[0], r[1], r[2], r[3]);
      if (cell.label) {
        g.fillStyle = "rgba(0,0,0,.75)";
        g.font = "10px ui-monospace,monospace";
        g.fillText(cell.label, r[0] + 2, r[1] + 12);
      }
    }
    return c;
  }

  function reportLoadError(err, actionLabel, actionFn) {
    const message = (err && err.message) || String(err);
    const detail = err && err.detail ? "（" + err.detail + "）" : "";
    const kept = state.model ? "；载入失败，已保留原模型" : "";
    setStatus("载入失败：" + message + kept, "error");
    notice("error", "载入失败：" + message + detail + kept, actionLabel && actionFn ? [{ label: actionLabel, onClick: actionFn }] : []);
    try {
      console.info("[character-editor] 载入失败：", message, detail);
    } catch (_) {
      /* 忽略 */
    }
    return false;
  }

  /* ==========================================================================
   * 3. 诊断（「部分预览 N 项」= 未求值的对象数，明细另存）
   * ====================================================================== */
  function collectDiagnostics(atlasIssues, model) {
    const out = [];
    const issues = [];
    for (const i of atlasIssues || []) issues.push(i);
    for (const i of model.issues || []) issues.push(i);

    // 「部分预览 N 项」= 未求值的**对象**数（约束 / 附件 / 骨 / 特性去重计）
    const objects = new Set();
    const cap = model.capabilities || {};
    const u = cap.unsupported || {};
    const addN = (n, tag) => {
      for (let i = 1; i <= n; i++) objects.add(tag + " #" + i);
    };
    if (u.transformConstraints) addN(u.transformConstraints, "transform 约束");
    if (u.pathConstraints) addN(u.pathConstraints, "path 约束");
    if (u.physicsConstraints) addN(u.physicsConstraints, "physics 约束");
    if (u.sequences) addN(u.sequences, "sequence 附件");
    if (u.deform) objects.add("deform 形变动画");
    if (u.slotColor) objects.add("slot 颜色动画");
    if (u.drawOrder) objects.add("drawOrder 动画");
    for (const i of issues) {
      const code = String(i.code || "");
      const path = String(i.path || "");
      if (code === "bone.inherit.unsupported") objects.add("inherit " + path);
      else if (code === "attachment.unsupportedType") objects.add("attachment " + path);
      else if (/^ik\./.test(path) && /^ik\.(unsupported|targetMissing|zeroLength|singularParent|bone\.noParent)/.test(code)) {
        const name = path.slice(3);
        if (name) {
          state.ikIssues[name] = i.message || code;
          objects.add("ik " + name);
        }
      }
    }
    if (u.attachments && typeof u.attachments === "object") {
      // issue 里已经逐个报过的附件不再按类型重复计数
      const mentioned = issues
        .filter((i) => i.code === "attachment.unsupportedType")
        .map((i) => String(i.message || ""));
      for (const k of Object.keys(u.attachments)) {
        if (mentioned.some((m) => m.indexOf(k) >= 0)) continue;
        objects.add("attachment " + k);
      }
    }
    state.unsupportedCount = objects.size;

    // 分组摘要（面板/提示只列组，明细在「未求值 / 诊断明细」里逐条给 code + 路径）
    const groups = new Map();
    for (const o of objects) {
      let key = o.replace(/ #\d+$/, "");
      if (key.indexOf("inherit ") === 0) key = "inherit≠Normal 骨";
      else if (key.indexOf("attachment ") === 0) key = "不支持的附件";
      else if (key.indexOf("ik ") === 0) key = "IK 约束";
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    for (const entry of groups) {
      out.push({ severity: "warning", text: "部分预览：" + entry[0] + (entry[1] > 1 ? " ×" + entry[1] : "") + " 未求值" });
    }
    for (const i of issues) {
      if (i.severity === "error") out.push({ severity: "error", text: "错误 " + (i.path || "") + " " + (i.message || i.code) });
    }
    state.issueDetails = issues.map((i) => ({ severity: i.severity, code: i.code, path: i.path, message: i.message }));
    return out;
  }

  /* ==========================================================================
   * 4. 姿态 / 几何
   * ====================================================================== */
  const FIELDS = ["x", "y", "rotation", "scaleX", "scaleY"];
  let lastPose = null;

  function editsMap() {
    const map = new Map();
    for (const b of state.boneList) {
      const setup = state.model.bones[b.index];
      if (!setup) continue;
      const patch = {};
      let any = false;
      for (const f of FIELDS) {
        const isScale = f === "scaleX" || f === "scaleY";
        const v = b[f] == null ? (isScale ? 1 : 0) : b[f];
        const s = setup[f] == null ? (isScale ? 1 : 0) : setup[f];
        if (Math.abs(v - s) > 1e-9) {
          patch[f] = v;
          any = true;
        }
      }
      if (any) map.set(b.name, patch);
    }
    return map;
  }

  function evalCurrentPose() {
    const edits = editsMap();
    const opts = { animation: state.anim || null, time: state.t, skin: "default" };
    if (edits.size) opts.edits = { bones: edits };
    return core.evalPose(state.model, opts);
  }

  function attachmentAt(pose, slotIndex) {
    return (pose && pose.attachments && pose.attachments[slotIndex]) || null;
  }

  function framePose() {
    if (!state.model) {
      state.frame = null;
      return null;
    }
    const pose = evalCurrentPose();
    lastPose = pose;
    const geo = core.buildGeometry(state.model, pose, { hidden: state.hidden });
    state.frame = { pose: pose, geo: geo };
    return state.frame;
  }

  /* ==========================================================================
   * 5. 视图
   * ====================================================================== */
  const viewW = () => cv.clientWidth;
  const viewH = () => cv.clientHeight;
  const viewParams = () => ({ z: state.zoom, tx: viewW() / 2 + state.panX, ty: viewH() / 2 - state.panY });
  function proj(wx, wy) {
    const v = viewParams();
    return { x: wx * v.z + v.tx, y: -wy * v.z + v.ty };
  }
  function unproj(sx, sy) {
    const v = viewParams();
    return { x: (sx - v.tx) / v.z, y: -(sy - v.ty) / v.z };
  }
  function projXY(worldXY) {
    const v = viewParams();
    const out = new Float64Array(worldXY.length);
    for (let i = 0; i < worldXY.length; i += 2) {
      out[i] = worldXY[i] * v.z + v.tx;
      out[i + 1] = -worldXY[i + 1] * v.z + v.ty;
    }
    return out;
  }
  function syncZoom() {
    $("zoomLabel").textContent = state.model ? Math.round(state.zoom * 100) + "%" : "—";
  }
  function fitView(mode) {
    if (!state.model) return;
    const frame = state.frame || framePose();
    let items = frame.geo;
    if (mode === "sel" && state.sel >= 0) {
      const one = items.filter((it) => it.slotIndex === state.sel);
      if (one.length) items = one;
    }
    const b = core.boundsOf(items);
    if (!b) return;
    const pad = 24;
    const availW = Math.max(40, viewW() - pad * 2);
    const availH = Math.max(40, viewH() - pad * 2);
    const z = clamp(Math.min(availW / Math.max(1e-6, b.maxX - b.minX), availH / Math.max(1e-6, b.maxY - b.minY)), 0.02, 12);
    state.zoom = z;
    state.panX = -((b.minX + b.maxX) / 2) * z;
    state.panY = -((b.minY + b.maxY) / 2) * z;
    syncZoom();
    render();
  }
  function zoomBy(factor, ax, ay) {
    if (!state.model) return;
    const sx = ax == null ? viewW() / 2 : ax;
    const sy = ay == null ? viewH() / 2 : ay;
    const before = unproj(sx, sy);
    state.zoom = clamp(state.zoom * factor, 0.02, 12);
    state.panX = sx - viewW() / 2 - before.x * state.zoom;
    state.panY = viewH() / 2 - sy - before.y * state.zoom;
    syncZoom();
    render();
  }

  /* ==========================================================================
   * 6. 渲染
   * ====================================================================== */
  const overlayActive = () => state.show.bones || state.show.mesh || state.show.weights;
  const anyLayerOn = () => state.show.texture || overlayActive();
  const effectiveTextureAlpha = () => (state.show.texture ? clamp(state.texAlpha / 100, 0, 1) : 0);

  function syncCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(viewW() * dpr));
    const h = Math.max(1, Math.round(viewH() * dpr));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    return dpr;
  }

  let scratch = null;
  function scratchContext() {
    if (!scratch) scratch = document.createElement("canvas");
    if (scratch.width !== cv.width || scratch.height !== cv.height) {
      scratch.width = cv.width;
      scratch.height = cv.height;
    }
    const g = scratch.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, scratch.width, scratch.height);
    g.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
    return g;
  }

  function applyAtlasSmoothing() {
    const page = state.atlas && state.atlas.pages && state.atlas.pages[0];
    const f = page && page.filter;
    let nearest = false;
    if (f && typeof f === "object") nearest = f.mag === "Nearest";
    else if (typeof f === "string") nearest = /nearest/i.test(f);
    ctx.imageSmoothingEnabled = !nearest;
  }

  function render() {
    const dpr = syncCanvasSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW(), viewH());
    if (!state.model) {
      state.frame = null;
      syncStageOverlays();
      return;
    }
    const frame = framePose();
    drawTextures(frame, dpr);
    if (state.show.mesh) drawMeshOverlay(frame);
    if (state.show.weights) drawWeightOverlay(frame, dpr);
    if (state.show.bones) drawBoneOverlay(frame);
    if (anyLayerOn()) {
      drawSelection(frame);
      drawDragGhost(frame);
    }
    syncStageOverlays();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---- 6.1 贴图：region 四边形快路 + mesh 逐三角 ---- */
  function paintTriangle(g, src, dst, a, b, c, page, dpr, clipQuad) {
    const m = core.affineFromTriangles(
      [src[a], src[a + 1], src[b], src[b + 1], src[c], src[c + 1]],
      [dst[a], dst[a + 1], dst[b], dst[b + 1], dst[c], dst[c + 1]]
    );
    if (!m) return false;
    g.save();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.beginPath();
    if (clipQuad) {
      g.moveTo(clipQuad[0], clipQuad[1]);
      g.lineTo(clipQuad[2], clipQuad[3]);
      g.lineTo(clipQuad[4], clipQuad[5]);
      g.lineTo(clipQuad[6], clipQuad[7]);
    } else {
      g.moveTo(dst[a], dst[a + 1]);
      g.lineTo(dst[b], dst[b + 1]);
      g.lineTo(dst[c], dst[c + 1]);
    }
    g.closePath();
    g.clip();
    g.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.tx, dpr * m.ty);
    g.drawImage(page, 0, 0);
    g.restore();
    return true;
  }

  function paintItem(g, item, screen, page, dpr) {
    const tris = item.triangles;
    const src = item.sourceXY;
    if (!tris || tris.length < 3) return;
    const isQuad = item.worldXY.length === 8 && tris.length === 6;
    if (isQuad) {
      paintTriangle(g, src, screen, tris[0] * 2, tris[1] * 2, tris[2] * 2, page, dpr, [
        screen[0], screen[1], screen[2], screen[3], screen[4], screen[5], screen[6], screen[7],
      ]);
      return;
    }
    for (let t = 0; t + 2 < tris.length; t += 3) {
      paintTriangle(g, src, screen, tris[t] * 2, tris[t + 1] * 2, tris[t + 2] * 2, page, dpr, null);
    }
  }

  function drawTextures(frame, dpr) {
    const alpha = effectiveTextureAlpha();
    if (alpha <= 0 || !state.pageImages.length) return;
    applyAtlasSmoothing();
    const useScratch = alpha < 0.999;
    for (const item of frame.geo) {
      const page = state.pageImages[item.pageIndex] || state.pageImages[0];
      if (!page) continue;
      const screen = projXY(item.worldXY);
      if (!useScratch) {
        paintItem(ctx, item, screen, page, dpr);
        continue;
      }
      const g = scratchContext();
      paintItem(g, item, screen, page, dpr);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(scratch, 0, 0);
      ctx.restore();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
  }

  /* ---- 6.2 网格层 ---- */
  function drawMeshOverlay(frame) {
    ctx.save();
    for (const item of frame.geo) {
      const att = attachmentAt(frame.pose, item.slotIndex);
      if (!att) continue;
      const screen = projXY(item.worldXY);
      const tris = item.triangles;
      const isRegion = att.type === "region";
      const sel = item.slotIndex === state.sel;
      ctx.strokeStyle = sel ? "rgba(120,190,255,.95)" : "rgba(90,169,255,.45)";
      ctx.lineWidth = sel ? 1.2 : 0.8;
      ctx.beginPath();
      for (let t = 0; t + 2 < tris.length; t += 3) {
        const a = tris[t] * 2;
        const b = tris[t + 1] * 2;
        const c = tris[t + 2] * 2;
        ctx.moveTo(screen[a], screen[a + 1]);
        ctx.lineTo(screen[b], screen[b + 1]);
        ctx.lineTo(screen[c], screen[c + 1]);
        ctx.closePath();
      }
      ctx.stroke();
      const hull = att.hullCount || 0;
      if (!isRegion && hull > 2) {
        ctx.strokeStyle = sel ? "#a8d8ff" : "rgba(90,169,255,.85)";
        ctx.lineWidth = sel ? 1.8 : 1.1;
        ctx.beginPath();
        for (let k = 0; k < hull; k++) {
          const p = k * 2;
          if (k === 0) ctx.moveTo(screen[p], screen[p + 1]);
          else ctx.lineTo(screen[p], screen[p + 1]);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = sel ? "#ffffff" : "#5aa9ff";
        const r = sel ? 2.4 : 1.6;
        for (let i = 0; i < screen.length; i += 2) {
          ctx.beginPath();
          ctx.arc(screen[i], screen[i + 1], r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
    drawUVInset(frame);
  }

  /* ---- 6.3 权重层 ---- */
  const bonePalette = new Map();
  const patchCache = new Map();
  function boneColorOf(boneIndex) {
    if (bonePalette.has(boneIndex)) return bonePalette.get(boneIndex);
    const name = (state.model.bones[boneIndex] && state.model.bones[boneIndex].name) || String(boneIndex);
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    const c = hslToRgb(h / 360, 0.78, 0.58);
    bonePalette.set(boneIndex, c);
    return c;
  }
  function hslToRgb(h, s, l) {
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }
  function heatColor(t) {
    const c = clamp(t, 0, 1);
    if (c < 0.5) {
      const k = c / 0.5;
      return [0.15 + 0.1 * k, 0.45 + 0.45 * k, 0.95 - 0.75 * k];
    }
    const k = (c - 0.5) / 0.5;
    return [0.25 + 0.75 * k, 0.9 - 0.6 * k, 0.2 - 0.2 * k];
  }
  const colorKey = (c) => (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
  function patchCanvas(c0, c1, c2) {
    const key = colorKey(c0) + ":" + colorKey(c1) + ":" + colorKey(c2);
    const hit = patchCache.get(key);
    if (hit) return hit;
    const S = 64;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const g = c.getContext("2d");
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const idx = (y * S + x) * 4;
        const w1 = x / S;
        const w2 = y / S;
        const w0 = 1 - w1 - w2;
        if (w0 < 0) {
          img.data[idx + 3] = 0;
          continue;
        }
        img.data[idx] = Math.round(255 * (w0 * c0[0] + w1 * c1[0] + w2 * c2[0]));
        img.data[idx + 1] = Math.round(255 * (w0 * c0[1] + w1 * c1[1] + w2 * c2[1]));
        img.data[idx + 2] = Math.round(255 * (w0 * c0[2] + w1 * c1[2] + w2 * c2[2]));
        img.data[idx + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    patchCache.set(key, c);
    return c;
  }
  function drawWeightOverlay(frame, dpr) {
    const heatMode = state.weightMode === "heat";
    const selectedBone = state.sel >= 0 ? state.slots[state.sel].boneIndex : null;
    const pal = new Map();
    for (let i = 0; i < state.model.bones.length; i++) pal.set(i, boneColorOf(i));
    ctx.save();
    ctx.globalAlpha = 0.92;
    for (const item of frame.geo) {
      const att = attachmentAt(frame.pose, item.slotIndex);
      if (!att) continue;
      const screen = projXY(item.worldXY);
      let res = null;
      try {
        res = core.weightColors(att, state.slots[item.slotIndex].boneIndex, pal, heatMode ? selectedBone : null);
      } catch (_) {
        res = null;
      }
      let colors = res ? res.rgb : null;
      if (heatMode && res && res.heat && selectedBone !== null) {
        const rgb = new Float32Array(res.heat.length * 3);
        for (let v = 0; v < res.heat.length; v++) {
          const c = heatColor(res.heat[v]);
          rgb[v * 3] = c[0];
          rgb[v * 3 + 1] = c[1];
          rgb[v * 3 + 2] = c[2];
        }
        colors = rgb;
      }
      if (!colors) {
        const c = boneColorOf(state.slots[item.slotIndex].boneIndex);
        ctx.fillStyle = "rgb(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + ")";
        ctx.beginPath();
        for (let i = 0; i < screen.length; i += 2) {
          if (i === 0) ctx.moveTo(screen[i], screen[i + 1]);
          else ctx.lineTo(screen[i], screen[i + 1]);
        }
        ctx.closePath();
        ctx.fill();
        continue;
      }
      const tris = item.triangles;
      for (let t = 0; t + 2 < tris.length; t += 3) {
        const i0 = tris[t];
        const i1 = tris[t + 1];
        const i2 = tris[t + 2];
        const c0 = [colors[i0 * 3], colors[i0 * 3 + 1], colors[i0 * 3 + 2]];
        const c1 = [colors[i1 * 3], colors[i1 * 3 + 1], colors[i1 * 3 + 2]];
        const c2 = [colors[i2 * 3], colors[i2 * 3 + 1], colors[i2 * 3 + 2]];
        const S = 64;
        const patch = patchCanvas(c0, c1, c2);
        const a = i0 * 2;
        const b = i1 * 2;
        const c = i2 * 2;
        const m = core.affineFromTriangles([0, 0, S, 0, 0, S], [screen[a], screen[a + 1], screen[b], screen[b + 1], screen[c], screen[c + 1]]);
        if (!m) continue;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        ctx.moveTo(screen[a], screen[a + 1]);
        ctx.lineTo(screen[b], screen[b + 1]);
        ctx.lineTo(screen[c], screen[c + 1]);
        ctx.closePath();
        ctx.clip();
        ctx.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.tx, dpr * m.ty);
        ctx.drawImage(patch, 0, 0);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ---- 6.4 骨骼层 ---- */
  function ikState() {
    const map = new Map();
    for (const c of state.constraints) {
      map.set(c.name, { constraint: c, restricted: !!state.ikIssues[c.name], reason: state.ikIssues[c.name] || "" });
    }
    return map;
  }
  function drawBoneOverlay(frame) {
    const ik = ikState();
    const inIK = new Set();
    const targets = new Set();
    for (const c of state.constraints) {
      for (const bi of c.bones) inIK.add(bi);
      targets.add(c.target);
    }
    ctx.save();
    for (let i = 0; i < state.model.bones.length; i++) {
      const b = state.model.bones[i];
      const w = frame.pose.world[i];
      if (!w) continue;
      const p = proj(w.tx, w.ty);
      if (b.parentIndex >= 0 && frame.pose.world[b.parentIndex]) {
        const pw = frame.pose.world[b.parentIndex];
        const pp = proj(pw.tx, pw.ty);
        ctx.beginPath();
        ctx.moveTo(pp.x, pp.y);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = inIK.has(i) ? "#f0b429" : "#5aa9ff";
        ctx.lineWidth = inIK.has(i) ? 2.2 : 1.6;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, inIK.has(i) ? 3.8 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = targets.has(i) ? "#f57785" : inIK.has(i) ? "#f0b429" : "#5aa9ff";
      ctx.fill();
      ctx.strokeStyle = "#0b0e14";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (targets.has(i)) {
        ctx.strokeStyle = "#f57785";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x - 9, p.y);
        ctx.lineTo(p.x + 9, p.y);
        ctx.moveTo(p.x, p.y - 9);
        ctx.lineTo(p.x, p.y + 9);
        ctx.stroke();
      }
      if (state.zoom > 0.22) {
        ctx.font = "10px ui-monospace,SFMono-Regular,Menlo,monospace";
        ctx.fillStyle = inIK.has(i) ? "#f6d38a" : "#c9d4e6";
        ctx.fillText(b.name, p.x + 6, p.y - 5);
      }
    }
    if (state.zoom > 0.18) {
      ctx.font = "10px ui-monospace,SFMono-Regular,Menlo,monospace";
      for (const item of ik) {
        const info = item[1];
        const tw = frame.pose.world[info.constraint.target];
        if (!tw) continue;
        const p = proj(tw.tx, tw.ty);
        ctx.fillStyle = info.restricted ? "#f57785" : "#f0b429";
        ctx.fillText(info.restricted ? item[0] + " · 受限/未求值" : item[0], p.x + 11, p.y - 8);
      }
    }
    ctx.restore();
  }

  /* ---- 6.5 UV 预览 ---- */
  function drawUVInset(frame) {
    const page = state.pageImages[0];
    if (!page) return;
    const size = 150;
    const pad = 12;
    const x = viewW() - size - pad;
    const y = viewH() - size - pad;
    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = "#12151d";
    ctx.strokeStyle = "#2c3444";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, size, size);
    ctx.strokeRect(x, y, size, size);
    const s = Math.min(size / page.width, size / page.height);
    const ox = x + (size - page.width * s) / 2;
    const oy = y + (size - page.height * s) / 2;
    ctx.globalAlpha = 0.62;
    ctx.imageSmoothingEnabled = false;
    try {
      ctx.drawImage(page, ox, oy, page.width * s, page.height * s);
    } catch (_) {
      /* 忽略 */
    }
    const item = state.sel >= 0 && frame ? frame.geo.find((it) => it.slotIndex === state.sel) : null;
    if (item && item.sourceXY && item.sourceXY.length >= 2) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < item.sourceXY.length; i += 2) {
        const sx = item.sourceXY[i];
        const sy = item.sourceXY[i + 1];
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#f0b429";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + minX * s, oy + minY * s, Math.max(1, (maxX - minX) * s), Math.max(1, (maxY - minY) * s));
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#8b98ad";
    ctx.font = "10px ui-monospace,monospace";
    ctx.fillText("atlas · UV", x + 6, y + 13);
    ctx.restore();
  }

  /* ---- 6.6 选中 / 拖动反馈 ---- */
  function traceHull(screen, hull) {
    ctx.beginPath();
    const n = Math.max(3, Math.min(hull || 4, screen.length / 2));
    for (let k = 0; k < n; k++) {
      const p = k * 2;
      if (k === 0) ctx.moveTo(screen[p], screen[p + 1]);
      else ctx.lineTo(screen[p], screen[p + 1]);
    }
    ctx.closePath();
  }
  function drawSelection(frame) {
    const selItem = state.sel >= 0 ? frame.geo.find((it) => it.slotIndex === state.sel) : null;
    const hovItem = state.hover >= 0 && state.hover !== state.sel ? frame.geo.find((it) => it.slotIndex === state.hover) : null;
    ctx.save();
    if (hovItem) {
      const att = attachmentAt(frame.pose, hovItem.slotIndex);
      traceHull(projXY(hovItem.worldXY), att ? att.hullCount : 4);
      ctx.strokeStyle = "rgba(230,235,245,.7)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (selItem) {
      const att = attachmentAt(frame.pose, selItem.slotIndex);
      const screen = projXY(selItem.worldXY);
      traceHull(screen, att ? att.hullCount : 4);
      ctx.strokeStyle = "#5aa9ff";
      ctx.lineWidth = 2;
      ctx.stroke();
      const w = frame.pose.world[state.slots[selItem.slotIndex].boneIndex];
      if (w) {
        const p = proj(w.tx, w.ty);
        ctx.strokeStyle = "#f0b429";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x - 7, p.y);
        ctx.lineTo(p.x + 7, p.y);
        ctx.moveTo(p.x, p.y - 7);
        ctx.lineTo(p.x, p.y + 7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = "#f0b429";
        ctx.fill();
      }
    }
    ctx.restore();
  }
  function drawDragGhost(frame) {
    const d = state.drag;
    if (!d || d.mode !== "move" || !d.startWorldXY) return;
    const start = projXY(d.startWorldXY);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "rgba(240,180,41,.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < start.length; i += 2) {
      if (i === 0) ctx.moveTo(start[i], start[i + 1]);
      else ctx.lineTo(start[i], start[i + 1]);
    }
    ctx.closePath();
    ctx.stroke();
    const item = frame.geo.find((it) => it.slotIndex === d.slotIndex);
    if (item) {
      const a = proj(d.startPivot.x, d.startPivot.y);
      const cur = projXY(item.worldXY);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(cur[0], cur[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ==========================================================================
   * 7. 拾取
   * ====================================================================== */
  function hitSlot(worldPoint) {
    const frame = state.frame;
    if (!frame) return -1;
    const hit = core.hitTest(frame.geo, worldPoint, { epsilon: 1e-8 });
    return hit ? hit.slotIndex : -1;
  }
  function dragBlockReason(slotIndex) {
    const slot = state.slots[slotIndex];
    if (!slot) return "没有选中部件";
    if (state.locked.has(slot.name)) return "该部件已锁定：点检查器里的锁图标解锁后可拖动";
    if (state.anim) return "预览动画中：先点「绑定姿态」回到绑定姿态再摆位";
    const att = state.frame ? attachmentAt(state.frame.pose, slotIndex) : null;
    if (att && att.weighted) return "加权网格由多根骨骼共同控制，位置只读（可改旋转/缩放看变形）";
    for (const c of state.constraints) {
      // mix=0 的 IK 约束不参与求值（等价于未绑定），此时允许直接摆位；mix>0 才要求先动 target。
      if (c.bones.indexOf(slot.boneIndex) >= 0 && c.mix > 0) return "该骨受 IK 约束（" + c.name + "）：请移动 IK target 骨";
    }
    return "";
  }

  /* ==========================================================================
   * 8. 提示 / 状态
   * ====================================================================== */
  const notices = [];
  function notice(kind, text, actions) {
    const key = kind + "|" + text;
    if (notices.some((n) => n.key === key)) return;
    notices.push({ key: key, kind: kind, text: text, actions: actions || [] });
    syncNotices();
  }
  function clearNotices() {
    notices.length = 0;
    syncNotices();
  }
  function syncNotices() {
    const box = $("notices");
    box.textContent = "";
    for (const n of notices) {
      const row = el("div", "notice " + n.kind);
      row.setAttribute("role", n.kind === "error" ? "alert" : "status");
      row.appendChild(iconEl(n.kind === "error" ? "alert" : n.kind === "warn" ? "alert" : "info"));
      row.appendChild(el("span", "msg", n.text));
      if (n.actions.length) {
        const act = el("div", "notice-actions");
        for (const a of n.actions) {
          const b = el("button", "btn btn-sm", a.label);
          b.type = "button";
          b.addEventListener("click", a.onClick);
          act.appendChild(b);
        }
        row.appendChild(act);
      }
      const close = el("button", "btn btn-icon btn-sm", "×");
      close.type = "button";
      close.title = "关闭提示";
      close.addEventListener("click", () => {
        const i = notices.indexOf(n);
        if (i >= 0) notices.splice(i, 1);
        syncNotices();
      });
      row.appendChild(close);
      box.appendChild(row);
    }
  }
  function setStatus(msg, kind) {
    const node = $("statusMsg");
    node.textContent = msg;
    node.className = "msg" + (kind ? " " + kind : "");
  }
  function syncStageOverlays() {
    const loaded = !!state.model;
    $("emptyState").hidden = loaded;
    $("hiddenAllState").hidden = !(loaded && state.hidden.size >= state.slots.length);
    $("noLayerState").hidden = !(loaded && !anyLayerOn());
  }

  /* ==========================================================================
   * 9. 编辑 / 撤销
   * ====================================================================== */
  function snapshot() {
    return JSON.stringify({
      b: state.boneList.map((b) => [
        b.name,
        b.x || 0,
        b.y || 0,
        b.rotation || 0,
        b.scaleX == null ? 1 : b.scaleX,
        b.scaleY == null ? 1 : b.scaleY,
      ]),
      o: state.slots.map((s) => s.name),
    });
  }
  function applySnapshot(str) {
    const snap = JSON.parse(str);
    for (const entry of snap.b) {
      const b = state.bones[entry[0]];
      if (!b) continue;
      b.x = entry[1];
      b.y = entry[2];
      b.rotation = entry[3];
      b.scaleX = entry[4];
      b.scaleY = entry[5];
    }
    const byName = Object.create(null);
    for (const s of state.slots) byName[s.name] = s;
    const next = [];
    for (const n of snap.o) if (byName[n]) next.push(byName[n]);
    if (next.length === snap.o.length) state.slots = next;
    syncSlotOrderToModel();
    if (state.model) framePose();
    if (state.sel >= state.slots.length) state.sel = state.slots.length - 1;
  }
  function pushUndo(snap) {
    state.undo.push(snap);
    if (state.undo.length > 120) state.undo.shift();
    syncToolbar();
  }
  function commit(before) {
    const now = snapshot();
    if (now === before) return false;
    pushUndo(before);
    state.dirty = now !== state.initial;
    syncFooter();
    return true;
  }
  function undo() {
    if (!state.undo.length) return setStatus("没有可撤销的操作");
    applySnapshot(state.undo.pop());
    state.dirty = snapshot() !== state.initial;
    syncAll();
    render();
    setStatus("已撤销一步");
  }
  function resetAll() {
    if (!state.initial) return;
    if (snapshot() === state.initial && !state.hidden.size && !state.locked.size) return setStatus("已经是最近保存状态");
    pushUndo(snapshot());
    applySnapshot(state.initial);
    state.hidden = new Set();
    state.locked = new Set();
    state.dirty = false;
    state.sel = -1;
    if (state.anim) {
      state.anim = "";
      state.animDur = 0;
      state.t = 0;
      state.playing = false;
      syncPlayButton();
      updateTimeLabel();
    }
    syncAll();
    render();
    setStatus("已重置到最近保存状态");
  }
  function nudgeBone(axis, delta) {
    if (state.sel < 0) return;
    const reason = dragBlockReason(state.sel);
    if (reason) return setStatus(reason, "warn");
    const slot = state.slots[state.sel];
    const b = state.bones[slot.boneName];
    if (!b) return;
    const before = snapshot();
    b[axis] = (b[axis] || 0) + delta;
    if (commit(before)) {
      render();
      syncInspector();
    }
  }
  function moveLayer(action) {
    if (state.sel < 0) return;
    if (drawOrderLocked()) return setStatus("该动画含 drawOrder，本期禁用层级调整", "warn");
    const arr = state.slots;
    const pos = state.sel;
    let target = pos;
    if (action === "up") target = Math.min(arr.length - 1, pos + 1);
    if (action === "down") target = Math.max(0, pos - 1);
    if (action === "top") target = arr.length - 1;
    if (action === "bottom") target = 0;
    if (target === pos) return;
    const before = snapshot();
    const moved = arr.splice(pos, 1)[0];
    arr.splice(target, 0, moved);
    state.sel = target;
    commit(before);
    framePose();
    syncAll();
    render();
  }
  function drawOrderLocked() {
    const u = state.model && state.model.capabilities && state.model.capabilities.unsupported;
    return !!(u && u.drawOrder);
  }
  function toggleHidden(slotIndex) {
    if (slotIndex < 0) return;
    const name = state.slots[slotIndex].name;
    if (state.hidden.has(name)) state.hidden.delete(name);
    else state.hidden.add(name);
    syncList();
    syncInspector();
    syncStageOverlays();
    render();
  }
  function toggleLocked(slotIndex) {
    if (slotIndex < 0) return;
    const name = state.slots[slotIndex].name;
    if (state.locked.has(name)) state.locked.delete(name);
    else state.locked.add(name);
    syncList();
    syncInspector();
    updateCursor();
    render();
  }
  function restoreSlot(slotIndex) {
    if (slotIndex < 0) return;
    const slot = state.slots[slotIndex];
    const initial = JSON.parse(state.initial);
    const entry = initial.b.find((e) => e[0] === slot.boneName);
    if (!entry) return;
    const b = state.bones[slot.boneName];
    const before = snapshot();
    b.x = entry[1];
    b.y = entry[2];
    b.rotation = entry[3];
    b.scaleX = entry[4];
    b.scaleY = entry[5];
    if (commit(before)) {
      syncAll();
      render();
      setStatus("已恢复 " + slot.name + " 的变换（最近保存状态）");
    } else setStatus("该部件已经在最近保存状态");
  }

  /* ==========================================================================
   * 10. 动画
   * ====================================================================== */
  function animDuration(name) {
    const anim = state.model && state.model.animations.get(name);
    if (!anim) return 0;
    let d = 0;
    const scan = (map) => {
      if (!map || typeof map.forEach !== "function") return;
      map.forEach((tracks) => {
        const list = Object.keys(tracks || {});
        for (const k of list) {
          const track = tracks[k];
          const keys = track && track.keys;
          if (keys && keys.length) d = Math.max(d, keys[keys.length - 1].time);
        }
      });
    };
    scan(anim.bones);
    scan(anim.slots);
    return d;
  }
  function syncAnimSelect() {
    const sel = $("animSel");
    const names = state.model ? Array.from(state.model.animations.keys()) : [];
    sel.textContent = "";
    const none = el("option", null, "（无 · 绑定姿态）");
    none.value = "";
    sel.appendChild(none);
    for (const n of names) {
      const o = el("option", null, n);
      o.value = n;
      sel.appendChild(o);
    }
    sel.value = state.anim;
    const has = names.length > 0;
    sel.disabled = !has;
    $("btnPlay").disabled = !has;
    $("btnSetup").disabled = !has;
    $("btnStop").disabled = !state.anim;
    $("speedSel").disabled = !has;
    $("scrub").disabled = !state.anim || state.animDur <= 0;
  }
  function setAnim(name) {
    state.anim = name || "";
    state.animDur = animDuration(state.anim);
    state.t = 0;
    state.playing = false;
    syncPlayButton();
    syncAnimSelect();
    updateTimeLabel();
    syncInspector();
    render();
    if (state.anim) setStatus("预览动画「" + state.anim + "」：摆位已暂停，点「绑定姿态」返回");
  }
  function syncPlayButton() {
    const btn = $("btnPlay");
    btn.innerHTML = icon(state.playing ? "pause" : "play");
    btn.appendChild(el("span", null, state.playing ? "暂停" : "播放"));
    btn.appendChild(el("kbd", null, "P"));
    btn.classList.toggle("on", state.playing);
    btn.setAttribute("aria-pressed", state.playing ? "true" : "false");
  }
  function togglePlay() {
    if (!state.anim) return setStatus("先选一个动画，或直接拖动部件摆位", "warn");
    state.playing = !state.playing;
    syncPlayButton();
    if (state.playing) {
      if (state.t >= state.animDur) state.t = 0;
      state.lastTs = 0;
      requestAnimationFrame(tick);
      setStatus("预览中 · 返回绑定姿态后才能摆位", "warn");
    } else setStatus("已暂停");
  }
  function tick(ts) {
    if (!state.playing) return;
    if (!state.lastTs) state.lastTs = ts;
    const dt = Math.min(0.1, (ts - state.lastTs) / 1000) * state.speed;
    state.lastTs = ts;
    state.t += dt;
    if (state.t >= state.animDur) {
      if (state.loop && state.animDur > 0) state.t %= state.animDur;
      else {
        state.t = state.animDur;
        state.playing = false;
        syncPlayButton();
      }
    }
    updateTimeLabel();
    render();
    if (state.playing) requestAnimationFrame(tick);
  }
  function updateTimeLabel() {
    $("timeLabel").textContent = state.t.toFixed(2) + " / " + state.animDur.toFixed(2) + " s";
    if (state.animDur > 0) $("scrub").value = Math.round((1000 * state.t) / state.animDur);
  }

  /* ==========================================================================
   * 11. UI 同步
   * ====================================================================== */
  function syncAll() {
    syncToolbar();
    syncList();
    syncInspector();
    syncLayers();
    syncDebug();
    syncFooter();
    syncStageOverlays();
    syncPanel();
    updateCursor();
  }
  function syncToolbar() {
    const loaded = !!state.model;
    $("btnFit").disabled = !loaded;
    $("btnZoomIn").disabled = !loaded;
    $("btnZoomOut").disabled = !loaded;
    syncZoom();
    syncAnimSelect();
    syncVoiceBadge();
    syncMenus();
  }
  function slotHay(slot, att) {
    const attName = (att && (att.path || slot.attachment)) || slot.attachment || slot.name;
    return (slot.name + " " + attName + " " + slot.boneName).toLowerCase();
  }
  function syncList() {
    const box = $("list");
    box.textContent = "";
    $("slotCount").textContent = String(state.slots.length);
    $("listEmpty").hidden = state.slots.length > 0;
    const q = state.search.trim().toLowerCase();
    const tree = state.listView === "tree";
    box.setAttribute("role", tree ? "tree" : "listbox");
    box.setAttribute("aria-label", tree ? "部件列表（骨骼层级）" : "部件列表，上方在前");
    box.classList.toggle("is-order", !tree);
    $("listEmpty").textContent = tree
      ? "按骨骼父子层级排列：点箭头折叠/展开，左侧数字是显示顺序。"
      : "按显示顺序排列，上方在最前；拖拽行可调整显示顺序（也可用上移/下移）。";
    syncListView();
    const shown = tree ? renderPartsTree(box, q) : renderPartsOrder(box, q);
    const sc = $("searchCount");
    if (q) {
      sc.hidden = false;
      sc.textContent = shown + "/" + state.slots.length;
    } else sc.hidden = true;
  }
  function appendSlotRow(box, i, depth) {
    const slot = state.slots[i];
    const frame = state.frame;
    const att = frame ? attachmentAt(frame.pose, slot.index) : null;
    const attName = (att && (att.path || slot.attachment)) || slot.attachment || slot.name;
    const tree = state.listView === "tree";
    const row = el("div", "slot-row");
    row.setAttribute("role", tree ? "treeitem" : "option");
    row.setAttribute("aria-selected", i === state.sel ? "true" : "false");
    if (tree) {
      row.setAttribute("aria-level", String((depth || 0) + 1));
      row.style.paddingLeft = (4 + (depth || 0) * 12 + 18) + "px";
    }
    row.tabIndex = 0;
    row.dataset.index = String(i);
    if (state.hidden.has(slot.name)) row.classList.add("is-hidden");
    row.appendChild(el("span", "slot-idx", String(i)));
    row.appendChild(el("span", "slot-name", attName));
    if (String(slot.boneName).toLowerCase() !== String(attName).toLowerCase()) {
      row.appendChild(el("span", "slot-bone", slot.boneName));
    }
    if (state.locked.has(slot.name)) {
      const lk = el("span", "slot-lock");
      lk.title = "已锁定";
      lk.appendChild(iconEl("lock"));
      row.appendChild(lk);
    }
    const eye = el("button", "slot-eye");
    eye.type = "button";
    eye.innerHTML = icon(state.hidden.has(slot.name) ? "eye-off" : "eye");
    eye.title = state.hidden.has(slot.name) ? "显示该部件" : "隐藏该部件";
    eye.setAttribute("aria-label", eye.title + "：" + slot.name);
    eye.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleHidden(i);
    });
    row.appendChild(eye);
    row.addEventListener("click", () => {
      if (state.suppressClick) return;
      selectSlot(i);
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectSlot(i);
      }
    });
    if (!tree) attachOrderDrag(row, i);
    box.appendChild(row);
    return row;
  }
  /** 显示顺序视图：拖拽行调整 z 序（仅 order 视图、且当前动画无 drawOrder 轨道） */
  function attachOrderDrag(row, index) {
    row.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".slot-eye")) return;
      if (state.listView !== "order" || drawOrderLocked()) return;
      const startY = e.clientY;
      let dragging = false;
      let over = null;
      let after = false;
      const move = (ev) => {
        if (!dragging) {
          if (Math.abs(ev.clientY - startY) < 6) return;
          dragging = true;
          row.classList.add("is-dragging");
          document.body.classList.add("is-reordering");
        }
        ev.preventDefault();
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const hit = el && el.closest ? el.closest("#list .slot-row") : null;
        if (over && over !== hit) over.classList.remove("drop-before", "drop-after");
        over = hit && hit !== row ? hit : null;
        if (over) {
          const r = over.getBoundingClientRect();
          after = ev.clientY > r.top + r.height / 2;
          over.classList.remove("drop-before", "drop-after");
          over.classList.add(after ? "drop-after" : "drop-before");
        }
      };
      const end = (ev) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        if (over) over.classList.remove("drop-before", "drop-after");
        row.classList.remove("is-dragging");
        document.body.classList.remove("is-reordering");
        if (!dragging) return;
        state.suppressClick = true;
        setTimeout(() => {
          state.suppressClick = false;
        }, 0);
        if (over) reorderSlotDisplay(index, Number(over.dataset.index), after);
        else {
          const box = $("list").getBoundingClientRect();
          if (ev.clientY > box.bottom - 4) reorderSlotDisplay(index, "bottom");
          else if (ev.clientY < box.top + 4) reorderSlotDisplay(index, "top");
        }
      };
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    });
  }
  /** 把 state.slots 的新顺序同步进 model.slots / slotIndex / skin.attachments，保证预览与拾取同步 */
  function syncSlotOrderToModel() {
    const model = state.model;
    if (!model) return;
    const nameToOld = new Map(model.slots.map((s, i) => [s.name, i]));
    const newToOld = state.slots.map((s) => nameToOld.get(s.name));
    const identity = newToOld.every((v, i) => v === i);
    if (identity) {
      state.slots.forEach((s, i) => {
        s.index = i;
      });
      return;
    }
    const oldToNew = new Map();
    newToOld.forEach((o, n) => oldToNew.set(o, n));
    const oldSlots = model.slots.slice();
    model.slots = newToOld.map((o) => oldSlots[o]);
    model.slotIndex = new Map(model.slots.map((s, i) => [s.name, i]));
    for (const skin of model.skins.values()) {
      const next = new Map();
      for (const [oldIdx, bag] of skin.attachments) {
        const ni = oldToNew.get(oldIdx);
        if (ni === undefined) continue;
        next.set(ni, bag);
        for (const att of bag.values()) if (att) att.slotIndex = ni;
      }
      skin.attachments = next;
    }
    state.slots.forEach((s, i) => {
      s.index = i;
    });
  }
  /** 拖拽落点：from/to 都是 state.slots 下标；to=null 表示拖到列表末尾（最底层） */
  function reorderSlotDisplay(from, to, after) {
    const n = state.slots.length;
    if (n < 2) return;
    const disp = [];
    for (let i = n - 1; i >= 0; i--) disp.push(i);
    const fromPos = disp.indexOf(from);
    if (fromPos < 0) return;
    const moved = state.slots[from];
    const movedAt = disp.splice(fromPos, 1)[0];
    let pos;
    if (to === "top") pos = 0;
    else if (to === "bottom") pos = disp.length;
    else {
      pos = disp.indexOf(to);
      if (pos < 0) pos = disp.length;
      if (after) pos += 1;
      if (pos === fromPos) return;
    }
    disp.splice(pos, 0, movedAt);
    const before = snapshot();
    state.slots = disp.slice().reverse().map((i) => state.slots[i]);
    syncSlotOrderToModel();
    state.sel = state.slots.findIndex((s) => s.name === moved.name);
    commit(before);
    framePose();
    syncAll();
    render();
    setStatus("已调整显示顺序：" + (state.slots[state.sel] ? state.slots[state.sel].name : ""));
  }
  function renderPartsOrder(box, q) {
    let shown = 0;
    for (let i = state.slots.length - 1; i >= 0; i--) {
      const slot = state.slots[i];
      const att = state.frame ? attachmentAt(state.frame.pose, i) : null;
      if (q && slotHay(slot, att).indexOf(q) < 0) continue;
      appendSlotRow(box, i, 0);
      shown++;
    }
    return shown;
  }
  function renderPartsTree(box, q) {
    const model = state.model;
    if (!model) return 0;
    const nodes = model.bones.map((b, i) => ({ index: i, name: b.name, parent: b.parentIndex, children: [], slots: [] }));
    for (const s of state.slots) {
      const n = nodes[s.boneIndex];
      if (n) n.slots.push(s.index);
    }
    for (const n of nodes) if (n.parent >= 0 && nodes[n.parent]) nodes[n.parent].children.push(n);
    const hasParts = new Map();
    const calc = (n) => {
      let v = n.slots.length > 0;
      for (const c of n.children) if (calc(c)) v = true;
      hasParts.set(n.index, v);
      return v;
    };
    for (const n of nodes) if (n.parent < 0) calc(n);
    const visibleSlots = new Set();
    if (!q) {
      for (const s of state.slots) visibleSlots.add(s.index);
    } else {
      for (const s of state.slots) {
        const att = state.frame ? attachmentAt(state.frame.pose, s.index) : null;
        if (slotHay(s, att).indexOf(q) >= 0) visibleSlots.add(s.index);
      }
      const force = (n, on) => {
        const keep = on || n.name.toLowerCase().indexOf(q) >= 0;
        if (keep) for (const si of n.slots) visibleSlots.add(si);
        for (const c of n.children) force(c, keep);
      };
      for (const n of nodes) if (n.parent < 0) force(n, false);
    }
    const hit = new Map();
    const mark = (n) => {
      let v = n.slots.some((i) => visibleSlots.has(i));
      for (const c of n.children) if (mark(c)) v = true;
      hit.set(n.index, v);
      return v;
    };
    for (const n of nodes) if (n.parent < 0) mark(n);
    const open = (n) => (q ? true : !state.collapsed.has(n.name));
    let shown = 0;
    const renderNode = (n, depth) => {
      if (!hasParts.get(n.index)) return;
      if (q && !hit.get(n.index)) return;
      const kids = n.children.filter((c) => hasParts.get(c.index) && (!q || hit.get(c.index)));
      const parts = n.slots.filter((i) => !q || visibleSlots.has(i));
      const expandable = kids.length > 0 || parts.length > 0;
      const isOpen = open(n);
      const row = el("div", "bone-row");
      row.style.paddingLeft = (4 + depth * 12) + "px";
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", String(depth + 1));
      if (expandable) {
        row.setAttribute("aria-expanded", String(isOpen));
        row.tabIndex = 0;
        const tw = el("button", "bone-twisty");
        tw.type = "button";
        tw.appendChild(iconEl(isOpen ? "chevron-down" : "chevron-right"));
        tw.setAttribute("aria-label", (isOpen ? "折叠 " : "展开 ") + n.name);
        tw.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleBone(n.name);
        });
        row.appendChild(tw);
        row.addEventListener("click", () => toggleBone(n.name));
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleBone(n.name);
          }
        });
      } else {
        row.appendChild(el("span", "bone-twisty is-leaf"));
      }
      row.appendChild(el("span", "bone-name", n.name));
      if (n.slots.length) row.appendChild(el("span", "bone-count", String(n.slots.length)));
      box.appendChild(row);
      if (!isOpen) return;
      for (const si of parts) {
        appendSlotRow(box, si, depth + 1);
        shown++;
      }
      for (const c of kids) renderNode(c, depth + 1);
    };
    for (const n of nodes) if (n.parent < 0) renderNode(n, 0);
    return shown;
  }
  function toggleBone(name) {
    if (state.collapsed.has(name)) state.collapsed.delete(name);
    else state.collapsed.add(name);
    syncList();
  }
  function syncListView() {
    const tree = state.listView === "tree";
    const t = $("tabListTree"), o = $("tabListOrder");
    if (t) t.setAttribute("aria-selected", tree ? "true" : "false");
    if (o) o.setAttribute("aria-selected", tree ? "false" : "true");
  }

  function selectSlot(i) {
    state.sel = i;
    state.hover = -1;
    syncList();
    syncInspector();
    render();
    if (i >= 0) {
      const row = $("list").querySelector('.slot-row[data-index="' + i + '"]');
      if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
    }
  }
  function syncInspector() {
    const slot = state.sel >= 0 ? state.slots[state.sel] : null;
    const frame = state.frame;
    const att = slot && frame ? attachmentAt(frame.pose, slot.index) : null;
    $("selBadge").textContent = slot ? String(state.sel) : "—";
    $("selEmpty").hidden = !!slot;
    $("selBody").hidden = !slot;
    if (!slot) {
      $("selEmpty").textContent = state.model
        ? "点击画布或列表选择部件。选中后这里显示绑定骨、局部坐标与层级操作。"
        : "还没有载入角色。点「载入文件」或「示例」开始。";
      return;
    }
    const bone = state.bones[slot.boneName] || {};
    $("selName").textContent = (att && (att.path || slot.attachment)) || slot.name;
    $("selSlot").textContent = "slot:" + slot.name;
    $("selBone").textContent = slot.boneName;
    $("selType").textContent = !att
      ? "（无附件）"
      : att.type === "region"
        ? "矩形附件"
        : (att.weighted ? "加权网格" : "刚性网格") + " · " + att.vertexCount + " 顶点 / " + (att.triangles ? att.triangles.length / 3 : 0) + " 三角";
    const reason = dragBlockReason(state.sel);
    $("selEditable").textContent = reason ? "受限" : "可拖动 / 方向键";
    $("selReason").hidden = !reason;
    $("selReason").textContent = reason || "";
    $("posX").disabled = !!reason;
    $("posY").disabled = !!reason;
    $("posX").value = round(bone.x || 0, 2);
    $("posY").value = round(bone.y || 0, 2);
    const transformLocked = !!state.anim || state.locked.has(slot.name);
    $("rotX").disabled = transformLocked;
    $("rotX").value = round(bone.rotation || 0, 1);
    $("rotRange").disabled = transformLocked;
    $("rotRange").value = clamp(bone.rotation || 0, -180, 180);
    $("scaleX").disabled = transformLocked;
    $("scaleX").value = round(bone.scaleX == null ? 1 : bone.scaleX, 2);
    $("scaleY").disabled = transformLocked;
    $("scaleY").value = round(bone.scaleY == null ? 1 : bone.scaleY, 2);
    const hidden = state.hidden.has(slot.name);
    const vis = $("btnSelVisible");
    vis.innerHTML = icon(hidden ? "eye-off" : "eye");
    vis.setAttribute("aria-pressed", hidden ? "true" : "false");
    vis.title = hidden ? "显示该部件（H）" : "隐藏该部件（H）";
    const locked = state.locked.has(slot.name);
    const lk = $("btnSelLock");
    lk.innerHTML = icon(locked ? "lock" : "unlock");
    lk.setAttribute("aria-pressed", locked ? "true" : "false");
    lk.title = locked ? "解锁该部件" : "锁定该部件（只影响查看器）";
    const zLocked = drawOrderLocked();
    $("btnLayerUp").disabled = zLocked || state.sel >= state.slots.length - 1;
    $("btnLayerDown").disabled = zLocked || state.sel <= 0;
    $("btnLayerTop").disabled = zLocked;
    $("btnLayerBottom").disabled = zLocked;
    $("btnRestoreSlot").disabled = !state.initial;
    const infl = $("influences");
    if (att && att.weighted && att.influences) {
      const bonesUsed = new Map();
      for (const list of att.influences) for (const inf of list) bonesUsed.set(inf.boneIndex, (bonesUsed.get(inf.boneIndex) || 0) + inf.weight);
      const ul = $("influenceList");
      ul.textContent = "";
      const entries = Array.from(bonesUsed.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
      for (const entry of entries) {
        const bi = entry[0];
        const name = (state.model.bones[bi] && state.model.bones[bi].name) || "#" + bi;
        const li = el("li");
        const left = el("span");
        const sw = el("span", "swatch");
        const c = boneColorOf(bi);
        sw.style.background = "rgb(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + ")";
        left.appendChild(sw);
        left.appendChild(document.createTextNode(name));
        li.appendChild(left);
        li.appendChild(el("span", null, round(entry[1], 1) + " Σw"));
        ul.appendChild(li);
      }
      infl.hidden = false;
    } else infl.hidden = true;
  }
  function syncLayers() {
    $$(".layers input[data-layer]").forEach((cb) => {
      cb.checked = !!state.show[cb.dataset.layer];
    });
    $("snapChk").checked = state.snap;
    $("snapState").textContent = state.snap ? "1 单位" : "关闭";
    $("texAlpha").value = state.texAlpha;
    $("texAlphaV").textContent = Math.round(state.texAlpha) + "%";
    $("weightMode").value = state.weightMode;
    const weightWrap = $("weightModeWrap");
    if (weightWrap) weightWrap.hidden = !state.show.weights;
    syncMenus();
  }
  function syncDebug() {
    const loaded = !!state.model;
    $("boneLegend").textContent = "";
    if (loaded) {
      const legend = $("boneLegend");
      const fk = el("span");
      fk.innerHTML = '<i class="swatch" style="background:#5aa9ff"></i>骨骼 ' + state.boneList.length;
      const ikn = el("span");
      ikn.innerHTML = '<i class="swatch" style="background:#f0b429"></i>IK ' + state.constraints.length;
      const tg = el("span");
      tg.innerHTML = '<i class="swatch" style="background:#f57785"></i>target ' + new Set(state.constraints.map((c) => c.target)).size;
      legend.appendChild(fk);
      legend.appendChild(ikn);
      legend.appendChild(tg);
      const restricted = Array.from(ikState().values()).filter((x) => x.restricted);
      $("boneNote").textContent = state.constraints.length
        ? "IK 约束 " + state.constraints.length + " 个（" + state.constraints.map((c) => c.name).join("、") + "）。" +
          (restricted.length
            ? "受限/未求值 " + restricted.length + " 个：" + restricted.map((x) => x.constraint.name + "（" + x.reason + "）").join("；")
            : "全部已求值（mix>0 时生效）。") +
          " 蓝线 FK、琥珀 IK、红色十字为 IK target。"
        : "骨骼 " + state.boneList.length + " 根，没有 ik 约束（skeleton.ik 为空），所以全部是 FK 链。";
    } else $("boneNote").textContent = "载入后显示骨骼数与约束状态。";

    const frame = state.frame;
    const meshes = [];
    if (loaded && frame) {
      for (const item of frame.geo) {
        const att = attachmentAt(frame.pose, item.slotIndex);
        if (att && att.type !== "region") meshes.push({ item: item, att: att });
      }
    }
    if (!loaded) $("meshNote").textContent = "载入后显示网格与 UV 状态。";
    else if (!meshes.length) {
      $("meshNote").textContent = "全部是矩形附件（无网格顶点）：网格层只画 2 个三角面 + 轮廓，不画示意细分。";
    } else {
      const selMesh = meshes.filter((m) => m.item.slotIndex === state.sel)[0];
      $("meshNote").textContent =
        "网格附件 " + meshes.length + " 个：" +
        meshes
          .slice(0, 6)
          .map((m) => m.item.attachmentId.split("/").pop() + "(" + m.att.vertexCount + " 顶点/" + m.att.triangles.length / 3 + " 三角" + (m.att.weighted ? "·加权" : "") + ")")
          .join("、") +
        (meshes.length > 6 ? "…" : "") +
        (selMesh ? "；选中件 hull=" + selMesh.att.hullCount : "") +
        "。右下角是图集 UV 预览（黄框为选中件）。";
    }

    $("legend").textContent = "";
    if (loaded && frame) {
      const legend = $("legend");
      const used = new Map();
      let anyWeighted = false;
      for (const item of frame.geo) {
        const att = attachmentAt(frame.pose, item.slotIndex);
        if (!att) continue;
        if (att.weighted) anyWeighted = true;
        let res = null;
        try {
          res = core.weightColors(att, state.slots[item.slotIndex].boneIndex, new Map(), null);
        } catch (_) {
          res = null;
        }
        const list = (res && res.legend) || [];
        for (const e of list) if (!used.has(e.boneIndex)) used.set(e.boneIndex, e);
      }
      const entries = Array.from(used.entries()).slice(0, 12);
      for (const entry of entries) {
        const bi = entry[0];
        const e = entry[1];
        const s = el("span");
        const c = e.color || boneColorOf(bi);
        s.innerHTML = '<i class="swatch" style="background:rgb(' + Math.round((c[0] || 0) * 255) + "," + Math.round((c[1] || 0) * 255) + "," + Math.round((c[2] || 0) * 255) + ')"></i>';
        s.appendChild(document.createTextNode((e.name || "#" + bi) + (e.vertexCount ? " ×" + e.vertexCount : "")));
        legend.appendChild(s);
      }
      $("weightsNote").textContent = anyWeighted
        ? "按顶点权重混合着色（每面重心插值色片）：面内可见渐变；可切「选中骨热力」看单骨权重 0..1。"
        : "刚性绑定：每个部件 100% 属于其绑定骨（颜色只表示归属，没有渐变）。";
    } else $("weightsNote").textContent = "载入后显示权重归属说明。";

    $("exprAvail").textContent = !loaded
      ? "载入后检测表情槽位。"
      : "spine 没有独立的「表情」参数类型：本工具不伪造眨眼/口型。要换表情请用动画里的 attachment(swap) 轨道（本期不编辑时间线）。";
    const exprIds = ["exBlink", "exMouth", "exBrow"];
    for (const id of exprIds) $(id).disabled = true;
    $$("#debug .presets button").forEach((b) => (b.disabled = true));

    const issues = state.issueDetails || [];
    $("diagBadge").hidden = state.unsupportedCount === 0 && issues.length === 0;
    $("diagBadge").textContent = String(issues.length);
    const box = $("issueList");
    box.textContent = "";
    for (const i of issues.slice(0, 60)) {
      const li = el("li", "issue-" + (i.severity || "warning"));
      li.textContent = (i.severity === "error" ? "错误" : "警告") + " [" + (i.code || "") + "] " + (i.path || "") + " — " + (i.message || "");
      box.appendChild(li);
    }
    $("issueWrap").hidden = issues.length === 0;
  }
  function syncFooter() {
    $("footDirty").textContent = state.dirty ? "有未保存改动" : "无未保存改动";
    $("footDirty").className = state.dirty ? "dirty-on" : "";
    const diag = $("footDiag");
    diag.hidden = state.unsupportedCount === 0;
    diag.textContent = "未求值 " + state.unsupportedCount;
    $("rendererInfo").textContent = !state.model ? "渲染：—" : coreInfo.ready ? "渲染：SpineCore" : "渲染：—";
    $("rendererInfo").title = coreInfo.reason || "";
  }
  function updateCursor() {
    let cursor = "default";
    if (state.drag && state.drag.mode === "pan") cursor = "grabbing";
    else if (state.spaceDown || state.tool === "pan") cursor = "grab";
    else if (state.hover >= 0) cursor = dragBlockReason(state.hover) ? "not-allowed" : "move";
    cv.style.cursor = cursor;
  }
  function setTool(tool) {
    state.tool = tool;
    syncToolbar();
    updateCursor();
    setStatus(tool === "pan" ? "平移工具：拖动移动视图（V 回到移动工具）" : "移动工具：拖动部件改变摆位");
  }
  function setDebugOpen(open) {
    $("debug").classList.toggle("open", !!open);
    $("debugBody").hidden = !open;
    $("debugToggle").setAttribute("aria-expanded", open ? "true" : "false");
  }
  function openDebug() {
    setDebugOpen(true);
    $("debug").scrollIntoView({ block: "nearest" });
  }

  /* ==========================================================================
   * 12. 画布交互
   * ====================================================================== */
  function stagePoint(e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function beginPan(e) {
    const p = stagePoint(e);
    state.drag = { mode: "pan", startX: p.x, startY: p.y, panX: state.panX, panY: state.panY };
    cv.setPointerCapture(e.pointerId);
    updateCursor();
  }
  function onPointerDown(e) {
    if (e.button === 1) {
      e.preventDefault();
      return beginPan(e);
    }
    if (e.button !== 0) return;
    if (state.spaceDown || state.tool === "pan") {
      e.preventDefault();
      return beginPan(e);
    }
    if (!state.model) return;
    if (!anyLayerOn()) return setStatus("未显示任何内容：先恢复一个显示层再拾取", "warn");
    const p = stagePoint(e);
    const world = unproj(p.x, p.y);
    const frame = state.frame || framePose();
    const hit = core.hitTest(frame.geo, world, { epsilon: 1e-8 });
    if (!hit) return selectSlot(-1);
    selectSlot(hit.slotIndex);
    const reason = dragBlockReason(hit.slotIndex);
    if (reason) return setStatus(reason, "warn");
    const slot = state.slots[hit.slotIndex];
    const bone = state.bones[slot.boneName];
    const item = frame.geo.filter((it) => it.slotIndex === hit.slotIndex)[0];
    const bw = frame.pose.world[slot.boneIndex];
    const parentIndex = state.model.bones[slot.boneIndex].parentIndex;
    state.drag = {
      mode: "move",
      slotIndex: hit.slotIndex,
      boneName: slot.boneName,
      startWorld: world,
      startBone: { x: bone.x || 0, y: bone.y || 0 },
      startPivot: { x: bw.tx, y: bw.ty },
      startWorldXY: item ? Array.from(item.worldXY) : null,
      parentWorld: parentIndex >= 0 ? frame.pose.world[parentIndex] : null,
      baseline: snapshot(),
      moved: false,
      pointerId: e.pointerId,
    };
    cv.setPointerCapture(e.pointerId);
    updateCursor();
    render();
  }
  function onPointerMove(e) {
    const d = state.drag;
    if (d) {
      const p = stagePoint(e);
      if (d.mode === "pan") {
        state.panX = d.panX + (p.x - d.startX);
        state.panY = d.panY + (p.y - d.startY);
        render();
        return;
      }
      const world = unproj(p.x, p.y);
      const wdx = world.x - d.startWorld.x;
      const wdy = world.y - d.startWorld.y;
      let ldx = wdx;
      let ldy = wdy;
      if (d.parentWorld) {
        const m = d.parentWorld;
        const det = m.a * m.d - m.b * m.c;
        if (Math.abs(det) < 1e-12) return;
        ldx = (m.d * wdx - m.c * wdy) / det;
        ldy = (-m.b * wdx + m.a * wdy) / det;
      }
      const bone = state.bones[d.boneName];
      let nx = d.startBone.x + ldx;
      let ny = d.startBone.y + ldy;
      if (state.snap) {
        nx = Math.round(nx);
        ny = Math.round(ny);
      }
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
      if (nx !== d.startBone.x || ny !== d.startBone.y) d.moved = true;
      bone.x = nx;
      bone.y = ny;
      if (d.moved) {
        state.dirty = snapshot() !== state.initial;
        syncFooter();
        syncInspector();
      }
      updateDragBadge(e, nx - d.startBone.x, ny - d.startBone.y);
      render();
      return;
    }
    if (!state.model || !anyLayerOn()) {
      if (state.hover !== -1) {
        state.hover = -1;
        updateCursor();
        render();
      }
      return;
    }
    const p = stagePoint(e);
    const world = unproj(p.x, p.y);
    const frame = state.frame || framePose();
    const hit = core.hitTest(frame.geo, world, { epsilon: 1e-8 });
    const idx = hit ? hit.slotIndex : -1;
    if (idx !== state.hover) {
      state.hover = idx;
      updateCursor();
      render();
    }
  }
  function onPointerUp(e) {
    const d = state.drag;
    if (!d) return;
    try {
      cv.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* 忽略 */
    }
    if (d.mode === "move" && d.moved) {
      pushUndo(d.baseline);
      state.dirty = snapshot() !== state.initial;
      setStatus("已移动 " + (state.slots[d.slotIndex] ? state.slots[d.slotIndex].name : "") + " · 可 Ctrl+Z 撤销");
      syncFooter();
      syncInspector();
      syncList();
    }
    state.drag = null;
    $("dragBadge").hidden = true;
    updateCursor();
    render();
  }
  function cancelDrag() {
    const d = state.drag;
    if (!d) return false;
    if (d.mode === "move" && d.moved) {
      applySnapshot(d.baseline);
      state.dirty = snapshot() !== state.initial;
    }
    state.drag = null;
    $("dragBadge").hidden = true;
    updateCursor();
    syncAll();
    render();
    setStatus("已取消本次拖动");
    return true;
  }
  function updateDragBadge(e, dx, dy) {
    const badge = $("dragBadge");
    const r = cv.getBoundingClientRect();
    badge.hidden = false;
    badge.style.left = clamp(e.clientX - r.left + 14, 4, r.width - 180) + "px";
    badge.style.top = clamp(e.clientY - r.top + 14, 4, r.height - 44) + "px";
    badge.textContent =
      "ΔX " + (dx >= 0 ? "+" : "−") + fmt(Math.abs(dx), 1) + "  ΔY " + (dy >= 0 ? "+" : "−") + fmt(Math.abs(dy), 1);
  }
  function onWheel(e) {
    if (!state.model) return;
    e.preventDefault();
    const p = stagePoint(e);
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
  }
  function onKeyDown(e) {
    if (isTypingTarget(e.target)) return;
    const inChrome = !!(e.target && e.target.closest && e.target.closest(".menubar, .menu"));
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;

    if (key === "Escape" && anyMenuOpen()) {
      e.preventDefault();
      closeMenus();
      return;
    }
    if (inChrome) return;

    if (key === "Escape") {
      if (state.helpOpen) return closeHelp();
      if (state.drag) {
        e.preventDefault();
        return cancelDrag();
      }
      if (state.sel >= 0) return selectSlot(-1);
      return;
    }
    if (key === "?" || (e.shiftKey && key === "/")) {
      e.preventDefault();
      return toggleHelp();
    }
    if (mod && lower === "z") {
      e.preventDefault();
      return undo();
    }
    if (mod && lower === "s") {
      e.preventDefault();
      return saveToDisk();
    }
    if (key === " ") {
      e.preventDefault();
      if (!e.repeat) {
        state.spaceDown = true;
        updateCursor();
      }
      return;
    }
    if (mod || e.altKey) return;
    if (lower === "v") return setTool("move");
    if (lower === "p") {
      e.preventDefault();
      return togglePlay();
    }
    if (lower === "f") {
      e.preventDefault();
      return fitView(e.shiftKey ? "sel" : "all");
    }
    if (lower === "h") {
      e.preventDefault();
      if (state.sel >= 0) toggleHidden(state.sel);
      return;
    }
    if (key === "[") {
      e.preventDefault();
      return moveLayer("down");
    }
    if (key === "]") {
      e.preventDefault();
      return moveLayer("up");
    }
    if (key === "+" || key === "=") {
      e.preventDefault();
      return zoomBy(1.25);
    }
    if (key === "-" || key === "_") {
      e.preventDefault();
      return zoomBy(1 / 1.25);
    }
    if (key.indexOf("Arrow") === 0) {
      if (state.sel < 0) return;
      const step = e.shiftKey ? 10 : 1;
      const map = { ArrowLeft: ["x", -step], ArrowRight: ["x", step], ArrowUp: ["y", step], ArrowDown: ["y", -step] };
      const d = map[key];
      if (!d) return;
      e.preventDefault();
      nudgeBone(d[0], d[1]);
    }
  }
  function onKeyUp(e) {
    if (e.code === "Space" || e.key === " ") {
      state.spaceDown = false;
      updateCursor();
    }
  }

  /* ==========================================================================
   * 13. 帮助浮层
   * ====================================================================== */
  let helpReturnFocus = null;
  function toggleHelp() {
    if (state.helpOpen) closeHelp();
    else openHelp();
  }
  function openHelp(section) {
    helpReturnFocus = document.activeElement;
    state.helpOpen = true;
    $("helpOverlay").hidden = false;
    $("helpClose").focus();
    if (section === "keys" && $("helpKeys")) {
      $("helpKeys").scrollIntoView({ block: "nearest" });
      $("helpKeys").classList.add("is-target");
      setTimeout(() => $("helpKeys").classList.remove("is-target"), 900);
    }
  }
  function closeHelp() {
    state.helpOpen = false;
    $("helpOverlay").hidden = true;
    if (helpReturnFocus && helpReturnFocus.focus) {
      try {
        helpReturnFocus.focus();
      } catch (_) {
        /* 忽略 */
      }
    }
  }

  /* ==========================================================================
   * 13b. 事件 · 语音测试浮层
   *      契约：docs/review/2026-11-04-voice-editor/contract.md §2 / §2.5
   *      Lead 裁决：语音缺失=红色 error；动画未映射=黄色 warn（不写「包损坏」）；
   *      未检查/未解析=灰色 unknown；索引警告只在浮层顶部单独展示，不算事件异常。
   *      数据全部来自 voice.js（window.SpineVoice），本层只做 DOM / fetch / Audio。
   * ====================================================================== */
  const VOICE_STATUS_TEXT = { error: "语音缺失", warn: "未映射", unknown: "未检查", ok: "正常" };
  const VOICE_STATUS_ICON = { error: "alert", warn: "alert", unknown: "info", ok: "target" };
  const VOICE_CATEGORY_FALLBACK = ["agent", "session", "interaction", "easter_egg"];

  function voiceLib() {
    return window.SpineVoice || null;
  }

  function voiceErrText(e) {
    return (e && (e.message || e.name)) || String(e || "未知错误");
  }

  function voiceCssEscape(value) {
    const s = String(value == null ? "" : value);
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(s);
    return s.replace(/["\\\]]/g, "\\$&");
  }

  /** 仓库相对路径安全校验（Lead 裁决 3）：% / . 段 / 控制字符 / 协议 / 反斜杠 / ?# 一律拒绝 */
  function voicePathIssue(p) {
    if (typeof p !== "string" || !p) return "路径为空";
    if (p.length > 512) return "路径过长";
    if (/[\u0000-\u001f\u007f]/.test(p)) return "含控制字符";
    if (p.indexOf("%") >= 0) return "不接受百分号转义";
    if (p.indexOf("\\") >= 0) return "不接受反斜杠";
    if (p.charAt(0) === "/") return "不接受绝对路径";
    if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return "不接受协议";
    if (p.indexOf("?") >= 0 || p.indexOf("#") >= 0) return "不接受查询或片段";
    const segs = p.split("/");
    for (const seg of segs) {
      if (!seg) return "路径段为空";
      if (seg === "." || seg === "..") return "路径段不能是 . 或 ..";
    }
    return null;
  }

  /* --- 状态推导 ---------------------------------------------------------- */

  function voiceEventStatus(ev) {
    const lines = (ev && ev.lines) || [];
    if (lines.some((l) => l.audioStatus === "missing")) return "error";
    if (lines.some((l) => l.animationStatus === "missing")) return "warn";
    if (
      lines.some(
        (l) =>
          l.audioStatus === "checking" ||
          l.audioStatus === "unknown" ||
          l.audioStatus === "unresolved" ||
          l.animationStatus === "unknown"
      )
    ) {
      return "unknown";
    }
    return "ok";
  }

  function voiceAudioPending(status) {
    return status === "checking" || status === "unknown" || status === "unresolved";
  }

  function voiceCounts() {
    const out = {
      events: 0,
      lines: 0,
      audioMissing: 0,
      animMissing: 0,
      pending: 0,
      errorEvents: 0,
      warnEvents: 0,
      unknownEvents: 0,
      okEvents: 0,
    };
    for (const ev of state.voice.events) {
      out.events++;
      const lines = ev.lines || [];
      out.lines += lines.length;
      for (const line of lines) {
        if (line.audioStatus === "missing") out.audioMissing++;
        if (line.animationStatus === "missing") out.animMissing++;
        // 「未检查」按台词行计数：同一行语音与动画都未知也只算 1 行
        if (voiceAudioPending(line.audioStatus) || line.animationStatus === "unknown") out.pending++;
      }
      const status = voiceEventStatus(ev);
      if (status === "error") out.errorEvents++;
      else if (status === "warn") out.warnEvents++;
      else if (status === "unknown") out.unknownEvents++;
      else out.okEvents++;
    }
    return out;
  }

  function voiceFindLine(id) {
    for (const ev of state.voice.events) {
      for (const line of ev.lines || []) if (line.id === id) return line;
    }
    return null;
  }

  function voiceFindEventOfLine(line) {
    if (!line) return null;
    for (const ev of state.voice.events) {
      if ((ev.lines || []).indexOf(line) >= 0) return ev;
    }
    for (const ev of state.voice.events) {
      if ((ev.lines || []).some((l) => l.id === line.id)) return ev;
    }
    return null;
  }

  function voiceFindEvent(name) {
    for (const ev of state.voice.events) if (ev.event === name) return ev;
    return null;
  }

  function voiceCategories() {
    const lib = voiceLib();
    const cats = lib && Array.isArray(lib.CATEGORIES) ? lib.CATEGORIES.slice() : VOICE_CATEGORY_FALLBACK.slice();
    const seen = new Set(cats);
    for (const ev of state.voice.events) {
      for (const cat of ev.categories || []) {
        if (cat && !seen.has(cat)) {
          seen.add(cat);
          cats.push(cat);
        }
      }
    }
    return cats;
  }

  function voiceAnimationStatusInEvent(ev, anim) {
    for (const line of ev.lines || []) if (line.animation === anim) return line.animationStatus;
    return "unknown";
  }

  function voiceVisibleEvents() {
    const v = state.voice;
    const q = v.search.trim().toLowerCase();
    return v.events.filter((ev) => {
      if (v.category !== "all" && (ev.categories || []).indexOf(v.category) < 0) return false;
      if (!voiceStatusFilterMatch(ev)) return false;
      if (!q) return true;
      if (String(ev.event || "").toLowerCase().indexOf(q) >= 0) return true;
      for (const line of ev.lines || []) {
        if (String(line.id || "").toLowerCase().indexOf(q) >= 0) return true;
        if (String(line.text || "").toLowerCase().indexOf(q) >= 0) return true;
        if (String(line.animation || "").toLowerCase().indexOf(q) >= 0) return true;
        if (String(line.audioFile || "").toLowerCase().indexOf(q) >= 0) return true;
      }
      return false;
    });
  }

  function voiceStatusFilterMatch(ev) {
    const filter = state.voice.statusFilter;
    if (filter === "all") return true;
    const lines = ev.lines || [];
    if (filter === "audio-missing") return lines.some((l) => l.audioStatus === "missing");
    if (filter === "anim-unmapped") return lines.some((l) => l.animationStatus === "missing");
    if (filter === "pending") return lines.some((l) => voiceAudioPending(l.audioStatus) || l.animationStatus === "unknown");
    if (filter === "ok") return voiceEventStatus(ev) === "ok";
    return true;
  }

  /* --- 载入 / 自动发现 / 评估 -------------------------------------------- */

  function evaluateVoiceState() {
    const v = state.voice;
    const lib = voiceLib();
    v.animations = state.model && state.model.animations ? Array.from(state.model.animations.keys()) : null;
    if (!lib || typeof lib.evaluate !== "function" || !v.voice) {
      v.events = [];
      v.summary = null;
      return;
    }
    const res = lib.evaluate(v.voice, {
      animations: v.animations,
      audio: v.packRoot ? v.audio : null,
      packRoot: v.packRoot,
    });
    if (res && res.ok === true) {
      v.events = res.value.events;
      v.summary = res.value.summary;
    } else {
      v.events = [];
      v.summary = null;
      v.error = {
        message: "语音资源评估失败：" + issueText(res && res.issues, 3),
        issues: (res && res.issues) || [],
        provenance: v.provenance,
        indexPath: v.indexPath,
      };
    }
  }

  function manualRootForCharacter(characterId) {
    const base =
      state.bundle && state.bundle.base ? String(state.bundle.base).replace(/\/+$/, "") : "";
    if (!base) return { root: null, reason: "当前未载入角色包，手动选择的索引没有包根，音频状态为未解析" };
    if (!characterId) {
      return { root: null, reason: "语音包缺少 character_id，无法与角色包目录名匹配，未自动使用包根" };
    }
    /* 语音包根 = 角色包里名字等于 character_id 的那个目录（如 base=.../deepseek/spine → .../deepseek），
       只在 base 自身及祖先里找，不从 character_id 猜路径 */
    const segs = base.split("/");
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i] === characterId) {
        return { root: segs.slice(0, i + 1).join("/"), reason: "" };
      }
    }
    return {
      root: null,
      reason:
        "语音包 character_id=" +
        characterId +
        " 与当前角色包路径 " +
        base +
        " 的目录名都不一致，未自动使用包根（不猜路径）",
    };
  }

  function clearVoiceFields(opts) {
    const v = state.voice;
    const o = opts || {};
    v.loadGen++;
    v.checkGen++;
    stopVoice();
    v.voice = null;
    v.events = [];
    v.summary = null;
    v.issues = [];
    v.audio = Object.create(null);
    v.audioDetail = Object.create(null);
    v.animations = null;
    v.selected = null;
    v.expanded = new Set();
    v.lineErrors = Object.create(null);
    v.packRoot = null;
    v.packRootSource = null;
    v.indexPath = null;
    v.provenance = null;
    v.loadState = "idle";
    v.error = null;
    v.autoProbeBusy = false;
    v.autoProbeFailed = false;
    v.checking = false;
    v.hint = "";
    v.hintKind = "";
    if (o.reason === "no-base") v.loadState = "idle";
    refreshVoiceUI();
  }

  function voiceFailure(message, opts, issues) {
    const v = state.voice;
    const o = opts || {};
    const hasData = !!v.voice;
    v.loadState = hasData ? "ready" : "error";
    v.autoProbeBusy = false;
    v.checking = false;
    v.error = {
      message: message,
      issues: issues || [],
      provenance: o.provenance || v.provenance,
      indexPath: o.indexPath || v.indexPath,
    };
    if (!hasData) {
      v.voice = null;
      v.events = [];
      v.summary = null;
      v.issues = issues || [];
    }
    if (o.provenance === "auto") {
      v.autoProbeFailed = true;
      // 自动探测失败只在浮层空状态说明，不弹红色错误（契约 §2.4）
      setStatus("未找到可用的语音包（自动查找）", "warn");
    } else {
      const source = o.provenance === "explicit" ? "?voice=" : o.provenance === "manual" ? "手动载入" : "重新载入";
      const kept = hasData ? "（已保留当前语音包：" + (v.indexPath || v.packRoot || "手动选择") + "）" : "";
      notice("error", source + "语音包失败：" + message + kept);
      setStatus(source + "语音包失败：" + message, "error");
    }
    refreshVoiceUI();
    return false;
  }

  function commitVoiceIndex(value, warnings, opts) {
    const v = state.voice;
    const o = opts || {};
    const lib = voiceLib();
    v.loadGen++; // 提交即生效：之前的在途载入 / 旧失败全部作废
    const gen = v.loadGen;
    let packRoot = o.packRoot ? String(o.packRoot) : null;
    let packRootSource = packRoot ? "derived" : null;
    if (!packRoot && o.indexPath && lib && typeof lib.derivePackRoot === "function") {
      const derived = lib.derivePackRoot(o.indexPath);
      if (derived) {
        packRoot = derived;
        packRootSource = "derived";
      }
    }
    if (!packRoot && o.provenance === "manual") {
      const auto = manualRootForCharacter(value.meta && value.meta.characterId);
      if (auto.root) {
        packRoot = auto.root;
        packRootSource = "bundle";
      } else if (auto.reason) {
        warnings.push({ path: "character_id", code: "MANUAL_PACK_ROOT", message: auto.reason });
      }
    }
    if (packRoot) {
      const bad = voicePathIssue(packRoot);
      if (bad) {
        warnings.push({ path: "packRoot", code: "INVALID_PACK_ROOT", message: "包根不可用：" + bad });
        packRoot = null;
        packRootSource = null;
      }
    }
    v.voice = value;
    v.events = value.events;
    v.issues = warnings;
    v.indexPath = o.indexPath || null;
    v.packRoot = packRoot;
    v.packRootSource = packRootSource;
    v.provenance = o.provenance || "manual";
    v.loadState = "ready";
    v.error = null;
    v.autoProbeBusy = false;
    v.autoProbeFailed = false;
    v.selected = null;
    v.expanded = new Set();
    v.lineErrors = Object.create(null);
    v.audio = Object.create(null);
    v.audioDetail = Object.create(null);
    v.checking = false;
    v.hint = "";
    v.hintKind = "";
    if (packRoot) {
      for (const line of value.lines) v.audio[line.audioFile] = "checking";
    }
    evaluateVoiceState();
    if (packRoot) checkVoiceAudio();
    else {
      v.checkGen++;
      evaluateVoiceState();
    }
    refreshVoiceUI();
    const meta = value.meta || {};
    const label = meta.characterName || meta.characterId || "语音包";
    if (o.provenance === "manual") {
      setStatus(
        "已载入语音包：" + label + "（手动选择）" + (packRoot ? " · " + packRoot : " · 包根未解析，音频状态为未解析"),
        packRoot ? "info" : "warn"
      );
      if (!packRoot) {
        notice(
          "warn",
          "手动选择的语音索引不含包根（character_id 与当前角色包目录名不一致，或未载入角色包），音频状态为未解析；可在右侧事件分页里填写包根，或改用 ?voice=<仓库相对路径>",
          []
        );
      }
    } else if (o.provenance === "explicit") {
      setStatus(
        "已载入语音包：" + label + (packRoot ? " · " + packRoot : " · 包根未解析，音频状态为未解析"),
        packRoot ? "info" : "warn"
      );
    } else {
      setStatus("已自动载入语音包：" + label + " · " + (packRoot || o.indexPath || ""), "info");
    }
    // 显式 / 手动载入是用户主动行为：直接切到事件分页看结果（自动探测不抢分页）
    if (o.provenance === "explicit" || o.provenance === "manual") openVoice();
    return true;
  }

  function loadVoiceIndexText(text, opts) {
    const lib = voiceLib();
    const o = opts || {};
    if (!lib || typeof lib.parseIndexText !== "function") {
      return voiceFailure("voice.js 未加载，无法解析语音索引", o, []);
    }
    const parsed = lib.parseIndexText(text);
    if (!parsed || parsed.ok !== true) {
      return voiceFailure(
        "语音索引校验失败：" + issueText(parsed && parsed.issues, 3),
        o,
        (parsed && parsed.issues) || []
      );
    }
    return commitVoiceIndex(parsed.value, (parsed.issues || []).slice(), o);
  }

  async function loadVoiceByPath(rawPath, provenance) {
    const v = state.voice;
    const path = String(rawPath == null ? "" : rawPath).trim();
    const prov = provenance || "manual";
    const bad = voicePathIssue(path);
    if (bad) return voiceFailure("语音索引路径无效：" + bad + "（" + path + "）", { provenance: prov, indexPath: path });
    const gen = ++v.loadGen;
    v.loadState = "loading";
    v.autoProbeBusy = false;
    v.autoProbeFailed = false;
    v.error = null;
    refreshVoiceUI();
    let res = null;
    try {
      res = await voiceFetchWithTimeout("/" + path, {}, 6000);
    } catch (e) {
      if (gen !== v.loadGen) return false;
      return voiceFailure(
        "读不到 " + path + "（" + (e && e.name === "AbortError" ? "读取超时" : "网络错误：" + voiceErrText(e)) + "）",
        { provenance: prov, indexPath: path }
      );
    }
    if (gen !== v.loadGen) return false;
    if (!res.ok) {
      return voiceFailure("读不到 " + path + "（HTTP " + res.status + "）", { provenance: prov, indexPath: path });
    }
    let text = null;
    try {
      text = await res.text();
    } catch (e) {
      if (gen !== v.loadGen) return false;
      return voiceFailure("读取 " + path + " 失败：" + voiceErrText(e), { provenance: prov, indexPath: path });
    }
    if (gen !== v.loadGen) return false;
    return loadVoiceIndexText(text, { indexPath: path, provenance: prov, source: prov });
  }

  async function loadVoiceFromFile(file) {
    if (!file) return false;
    const v = state.voice;
    const gen = ++v.loadGen;
    let text = null;
    try {
      text = await file.text();
    } catch (e) {
      if (gen !== state.voice.loadGen) return false;
      return voiceFailure("读取文件失败：" + voiceErrText(e), { provenance: "manual", indexPath: null });
    }
    if (gen !== state.voice.loadGen) return false;
    const name = file.name || "index.json";
    const ok = loadVoiceIndexText(text, { indexPath: null, packRoot: null, provenance: "manual", source: "picker", fileName: name });
    if (name !== "index.json") {
      notice("warn", "语音包文件名是 " + name + "（期望 index.json）；已按内容校验，请确认选对了文件。");
    }
    return ok;
  }

  function reloadVoice() {
    const v = state.voice;
    if (!v.indexPath) {
      setStatus("当前语音包是手动选择的文件，没有仓库路径；请用「载入语音包…」重新选择", "warn");
      return false;
    }
    const provenance = v.provenance === "auto" ? "auto" : v.provenance === "manual" ? "manual" : "explicit";
    return loadVoiceByPath(v.indexPath, provenance);
  }

  /** 自动发现（Lead 裁决 3）：候选 = base + 最多 3 级祖先；首个 200 即停（索引损坏也不继续向上） */
  async function probeVoiceCandidates(base, opts) {
    const lib = voiceLib();
    const v = state.voice;
    const o = opts || {};
    const basePath = String(base || "").replace(/\/+$/, "");
    const baseBad = voicePathIssue(basePath);
    if (!lib || typeof lib.voiceIndexCandidates !== "function") {
      v.autoProbeFailed = true;
      refreshVoiceUI();
      return false;
    }
    if (baseBad) {
      v.loadState = v.voice ? "ready" : "idle";
      v.error = { message: "角色包根不可用，无法自动查找语音包：" + baseBad, issues: [], provenance: "auto", indexPath: null };
      v.autoProbeFailed = true;
      refreshVoiceUI();
      return false;
    }
    // 重新探测前先清掉上一个自动发现的包，避免不同模型错配（显式 / 手动包不在此路径）
    if (v.provenance === "auto" && v.voice) {
      v.loadGen++;
      v.checkGen++;
      stopVoice();
      v.voice = null;
      v.events = [];
      v.summary = null;
      v.issues = [];
      v.audio = Object.create(null);
      v.audioDetail = Object.create(null);
      v.packRoot = null;
      v.packRootSource = null;
      v.indexPath = null;
      v.provenance = null;
      v.selected = null;
      v.expanded = new Set();
      v.checking = false;
    }
    const candidates = lib.voiceIndexCandidates(basePath) || [];
    const gen = ++v.loadGen;
    let lastNetworkError = "";
    v.autoProbeBusy = true;
    v.autoProbeFailed = false;
    v.error = null;
    v.loadState = "loading";
    refreshVoiceUI();
    for (const cand of candidates) {
      if (gen !== v.loadGen) return false;
      const indexPath = typeof cand === "string" ? cand : (cand && cand.indexPath) || "";
      const packRoot =
        typeof cand === "string" ? lib.derivePackRoot(indexPath) : (cand && cand.packRoot) || lib.derivePackRoot(indexPath);
      if (!indexPath || voicePathIssue(indexPath)) continue;
      let res = null;
      try {
        res = await voiceFetchWithTimeout("/" + indexPath, {}, 6000);
      } catch (e) {
        if (gen !== v.loadGen) return false;
        // 单个候选网络错误/超时：按契约继续下一候选（最终都失败再报）
        lastNetworkError =
          (e && e.name === "AbortError" ? "探测超时" : "网络错误") + "：" + voiceErrText(e);
        continue;
      }
      if (gen !== v.loadGen) return false;
      if (!res.ok) continue; // 非 200：继续上一级祖先
      let text = null;
      try {
        text = await res.text();
      } catch (e) {
        if (gen !== v.loadGen) return false;
        v.autoProbeBusy = false;
        v.autoProbeFailed = true;
        v.loadState = v.voice ? "ready" : "error";
        v.error = {
          message: "自动发现的语音索引读取失败（" + indexPath + "）：" + voiceErrText(e),
          issues: [],
          provenance: "auto",
          indexPath: indexPath,
        };
        refreshVoiceUI();
        return false;
      }
      if (gen !== v.loadGen) return false;
      v.autoProbeBusy = false;
      const parsed = lib.parseIndexText(text);
      if (!parsed || parsed.ok !== true) {
        // 首个 200 即停：该索引损坏就报出来，不继续向上找别的包
        v.loadState = v.voice ? "ready" : "error";
        v.autoProbeFailed = true;
        v.error = {
          message:
            "自动发现的语音索引损坏（" + indexPath + "）：" + issueText(parsed && parsed.issues, 3),
          issues: (parsed && parsed.issues) || [],
          provenance: "auto",
          indexPath: indexPath,
        };
        refreshVoiceUI();
        setStatus("自动发现的语音索引损坏：" + indexPath, "warn");
        return false;
      }
      return commitVoiceIndex(parsed.value, (parsed.issues || []).slice(), {
        indexPath: indexPath,
        packRoot: packRoot,
        provenance: "auto",
        source: "auto",
      });
    }
    if (gen !== v.loadGen) return false;
    v.autoProbeBusy = false;
    v.autoProbeFailed = true;
    v.loadState = v.voice ? "ready" : "idle";
    v.error = lastNetworkError
      ? {
          message: "自动查找语音包失败：" + lastNetworkError + "（已按角色包根及最多 3 级祖先探测）",
          issues: [],
          provenance: "auto",
          indexPath: null,
        }
      : null;
    refreshVoiceUI();
    setStatus(
      lastNetworkError
        ? "自动查找语音包失败：" + lastNetworkError
        : "没有找到语音包（已按角色包根及最多 3 级祖先探测）",
      "warn"
    );
    return false;
  }

  function onModelChanged() {
    const v = state.voice;
    const base = state.bundle && state.bundle.base ? String(state.bundle.base) : null;
    evaluateVoiceState(); // 模型动画清单变化 → 重新评估状态
    if (v.explicitRequest) {
      // 显式 ?voice= 锁：自动发现永不覆盖（含显式失败）
      refreshVoiceUI();
      return;
    }
    if (v.provenance === "manual") {
      refreshVoiceUI();
      return;
    }
    if (v.provenance === "auto") {
      if (!base) clearVoiceFields({ reason: "no-base" });
      else probeVoiceCandidates(base, { automatic: true });
      refreshVoiceUI();
      return;
    }
    if (base) probeVoiceCandidates(base, { automatic: true });
    else refreshVoiceUI();
  }

  /* --- 语音资源 HEAD 探测（并发 ≤ 4 / checkGen） ------------------------- */

  /** 语音相关 fetch 统一超时（6s）：挂起请求不能把「检查中…」/「正在读取…」永久卡住 */
  async function voiceFetchWithTimeout(url, opts, timeoutMs) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => {
          try {
            controller.abort();
          } catch (_) {
            /* 忽略 */
          }
        }, timeoutMs || 6000)
      : 0;
    const request = Object.assign({ cache: "no-store" }, opts || {});
    if (controller) request.signal = controller.signal;
    try {
      return await fetch(url, request);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function probeVoiceUrl(url) {
    let res = null;
    try {
      res = await voiceFetchWithTimeout(url, { method: "HEAD" }, 6000);
    } catch (e) {
      return {
        status: "unknown",
        detail: (e && e.name === "AbortError" ? "检查超时" : "网络错误") + "：" + voiceErrText(e),
      };
    }
    if (res.ok) return { status: "ok", detail: "HTTP " + res.status };
    if (res.status === 404) return { status: "missing", detail: "HTTP 404" };
    const headStatus = res.status;
    // 405 / 其它非 2xx：回退 GET 一次（契约 §2.4）
    let getRes = null;
    try {
      getRes = await voiceFetchWithTimeout(url, {}, 6000);
    } catch (e) {
      return {
        status: "unknown",
        detail:
          "HEAD " + headStatus + "，GET " + (e && e.name === "AbortError" ? "检查超时" : "网络错误") + "：" + voiceErrText(e),
      };
    }
    if (getRes.ok) return { status: "ok", detail: "HEAD " + headStatus + " → GET " + getRes.status };
    if (getRes.status === 404) return { status: "missing", detail: "HTTP 404（HEAD " + headStatus + "）" };
    return { status: "unknown", detail: "HEAD " + headStatus + " → GET " + getRes.status };
  }

  function checkVoiceAudio() {
    const lib = voiceLib();
    const v = state.voice;
    const gen = ++v.checkGen;
    v.checking = false;
    if (!lib || typeof lib.resolveAudioPath !== "function" || !v.voice || !v.packRoot) {
      evaluateVoiceState();
      refreshVoiceUI();
      return;
    }
    const files = [];
    const seen = new Set();
    for (const line of v.voice.lines) {
      if (seen.has(line.audioFile)) continue;
      seen.add(line.audioFile);
      const resolved = lib.resolveAudioPath(v.packRoot, line.audioFile);
      const ok = !!(resolved && resolved.ok);
      files.push({
        file: line.audioFile,
        url: ok ? resolved.value.url : null,
        why: ok ? "" : issueText(resolved && resolved.issues, 1),
      });
    }
    for (const item of files) {
      if (item.url) {
        v.audio[item.file] = "checking";
        v.audioDetail[item.file] = "检查中…";
      } else {
        v.audio[item.file] = "unknown";
        v.audioDetail[item.file] = "语音路径不可用：" + (item.why || "未知原因");
      }
    }
    v.checking = true;
    evaluateVoiceState();
    refreshVoiceUI();
    const queue = files.filter((f) => f.url);
    if (!queue.length) {
      v.checking = false;
      return;
    }
    let next = 0;
    const workers = Math.max(1, Math.min(4, queue.length));
    const runOne = async () => {
      while (true) {
        if (gen !== state.voice.checkGen) return;
        const item = queue[next++];
        if (!item) return;
        const result = await probeVoiceUrl(item.url);
        if (gen !== state.voice.checkGen) return;
        state.voice.audio[item.file] = result.status;
        state.voice.audioDetail[item.file] = result.detail;
        evaluateVoiceState();
        scheduleVoiceRefresh();
      }
    };
    const jobs = [];
    for (let i = 0; i < workers; i++) jobs.push(runOne());
    Promise.all(jobs)
      .then(() => {
        if (gen !== state.voice.checkGen) return;
        state.voice.checking = false;
        evaluateVoiceState();
        refreshVoiceUI();
        // 检查完成后在状态栏给缺失汇总（Lead 裁决 4：缺失要在状态栏可见，不只浮层）
        const counts = voiceCounts();
        if (counts.audioMissing > 0) {
          setStatus("语音检查完成：" + counts.audioMissing + " 条语音缺失（详见右侧事件分页）", "warn");
        } else if (counts.animMissing > 0) {
          setStatus("语音检查完成：" + counts.animMissing + " 条动画未映射（仅播放语音，详见右侧事件分页）", "warn");
        }
      })
      .catch(() => {
        if (gen !== state.voice.checkGen) return;
        state.voice.checking = false;
        refreshVoiceUI();
      });
  }

  /* --- 播放（单实例 <audio> / playGen） ---------------------------------- */

  function voiceAudioEl() {
    return $("voiceAudio");
  }

  function voiceLineUrl(line) {
    const lib = voiceLib();
    const v = state.voice;
    if (!lib || typeof lib.resolveAudioPath !== "function" || !v.packRoot || !line) return null;
    const res = lib.resolveAudioPath(v.packRoot, line.audioFile);
    return res && res.ok ? res.value.url : null;
  }

  function voiceLinePlayable(line) {
    if (!line) return false;
    if (line.audioStatus === "missing" || line.audioStatus === "unresolved") return false;
    return !!voiceLineUrl(line);
  }

  function voiceIsCurrent() {
    const v = state.voice;
    const a = voiceAudioEl();
    if (!a || !v.play || !v.play.url) return false;
    return a.getAttribute("src") === v.play.url;
  }

  function voiceLineIsPlaying(line) {
    if (!line || !voiceIsCurrent()) return false;
    return state.voice.play.id === line.id && state.voice.play.playing;
  }

  function voiceAudioTitle(line) {
    const v = state.voice;
    const detail = v.audioDetail[line.audioFile] || "";
    if (line.audioStatus === "ok") return "语音：" + line.audioFile + (detail ? "（" + detail + "）" : "");
    if (line.audioStatus === "missing") return "语音缺失：" + line.audioFile + "（" + (detail || "HTTP 404") + "）";
    if (line.audioStatus === "unresolved") return "语音未解析：" + line.audioFile + "（缺少语音包根；可用 ?voice= 或填写包根）";
    if (line.audioStatus === "checking") return "检查中…：" + line.audioFile;
    return "语音未确认：" + line.audioFile + (detail ? "（" + detail + "）" : "");
  }

  function voiceAnimationTitle(line) {
    const v = state.voice;
    if (line.animationStatus === "ok") return "动画存在：" + line.animation;
    if (line.animationStatus === "missing") {
      const list = v.animations && v.animations.length ? v.animations.join(" / ") : "（无）";
      return "动画未映射：" + line.animation + "（模型无同名动画，需补语义→实际动画映射；模型动画：" + list + "）";
    }
    return "未载入角色模型，动画存在性未检查：" + line.animation;
  }

  function setVoiceHint(text, kind) {
    const v = state.voice;
    v.hint = text || "";
    v.hintKind = kind || "";
    updateVoicePlaybar();
  }

  function updateVoicePlaybar() {
    const v = state.voice;
    const now = $("voiceNow");
    if (now) {
      now.textContent = v.play.url ? (v.play.event ? v.play.event + " · " : "") + (v.play.id || "") : "未播放";
      now.classList.toggle("error", !!v.play.error);
    }
    const hint = $("voiceHint");
    if (hint) {
      hint.textContent = v.hint || "";
      hint.className = "voice-hint" + (v.hintKind ? " " + v.hintKind : " dim");
      hint.title = v.hint || "";
    }
    const stop = $("voiceStop");
    if (stop) stop.disabled = !v.play.url;
  }

  function syncVoicePlayUI() {
    const v = state.voice;
    updateVoicePlaybar();
    for (const btn of $$(".voice-line-play")) {
      const row = btn.closest(".voice-line");
      const id = row && row.dataset.id;
      const line = id ? voiceFindLine(id) : null;
      const playing = line ? voiceLineIsPlaying(line) : false;
      btn.innerHTML = icon(playing ? "pause" : "play");
      btn.classList.toggle("on", playing);
      btn.setAttribute("aria-pressed", playing ? "true" : "false");
    }
    const stop = $("voiceStop");
    if (stop) stop.classList.toggle("on", !!(v.play.playing && voiceIsCurrent()));
  }

  function patchVoiceProgress() {
    const v = state.voice;
    const a = voiceAudioEl();
    const seek = $("voiceSeek");
    const time = $("voiceTime");
    if (!a) return;
    if (!voiceIsCurrent()) {
      if (time) time.textContent = "0.00 / 0.00 s";
      if (seek) {
        seek.disabled = true;
        seek.value = "0";
      }
      return;
    }
    const dur = v.play.duration || (Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0);
    if (!v.play.duration && dur) v.play.duration = dur;
    const t = Number.isFinite(a.currentTime) ? a.currentTime : 0;
    if (time) time.textContent = t.toFixed(2) + " / " + dur.toFixed(2) + " s";
    if (seek) {
      seek.disabled = !(dur > 0);
      seek.value = dur > 0 ? String(Math.round((1000 * Math.min(t, dur)) / dur)) : "0";
    }
  }

  function stopVoice() {
    const v = state.voice;
    v.playGen++;
    const a = voiceAudioEl();
    if (a) {
      try {
        a.pause();
      } catch (_) {
        /* 忽略 */
      }
      a.removeAttribute("src");
      try {
        a.load();
      } catch (_) {
        /* 忽略 */
      }
    }
    v.play = { event: null, id: null, audioFile: null, url: null, playing: false, duration: 0, error: null };
    const seek = $("voiceSeek");
    if (seek) {
      seek.disabled = true;
      seek.value = "0";
    }
    const time = $("voiceTime");
    if (time) time.textContent = "0.00 / 0.00 s";
    syncVoicePlayUI();
    return true;
  }

  function onVoicePlayError(err, line, gen) {
    if (gen !== state.voice.playGen) return; // 旧播放 / 切换后的迟到拒绝不得复活按钮
    const name = (err && err.name) || "";
    let msg;
    if (name === "NotAllowedError") msg = "浏览器拦截了自动播放（需要用户手势）";
    else if (name === "NotSupportedError") msg = "音频格式不支持或解码失败";
    else if (name === "AbortError") {
      state.voice.play.playing = false;
      syncVoicePlayUI();
      return;
    } else msg = "播放失败：" + voiceErrText(err);
    state.voice.play.playing = false;
    state.voice.play.error = msg;
    if (line) state.voice.lineErrors[line.id] = msg;
    setVoiceHint(msg, "error");
    setStatus(msg + (line ? "（" + line.audioFile + "）" : ""), "error");
    scheduleVoiceRefresh();
  }

  function linkVoiceAnimation(line) {
    const v = state.voice;
    if (!v.linkAnimation || !line) return;
    const anim = line.animation;
    if (v.animations === null) {
      setVoiceHint("未载入角色模型，动画未检查；仅播放语音", "warn");
      setStatus("未载入角色模型，动画未检查；仅播放语音", "warn");
      return;
    }
    if (line.animationStatus === "ok" && v.animations.indexOf(anim) >= 0) {
      // setAnim 会把 playing 置 false，需要显式启动（Lead 裁决 4）
      setAnim(anim);
      state.playing = true;
      state.lastTs = 0;
      syncPlayButton();
      requestAnimationFrame(tick);
      setVoiceHint("联动动画：" + anim);
    } else {
      setVoiceHint("动画「" + anim + "」未映射（模型无同名动画），仅播放语音", "warn");
      setStatus("动画「" + anim + "」未映射（模型无同名动画），仅播放语音", "warn");
    }
  }

  function startVoicePlayback(ev, line) {
    const v = state.voice;
    const a = voiceAudioEl();
    if (!line || !a) return false;
    if (!voiceLinePlayable(line)) {
      const why =
        line.audioStatus === "missing" ? "语音缺失" : line.audioStatus === "unresolved" ? "语音路径未解析" : "语音不可用";
      setVoiceHint(why + "：" + line.audioFile, "warn");
      setStatus(why + "：" + line.audioFile, "warn");
      refreshVoiceUI();
      return false;
    }
    const url = voiceLineUrl(line);
    if (!url) {
      setVoiceHint("语音路径不可用：" + line.audioFile, "warn");
      setStatus("语音路径不可用：" + line.audioFile, "warn");
      return false;
    }
    // 同一条：暂停 / 继续（不重复 setAnim、不重复联动）
    if (v.play.id === line.id && v.play.url === url && voiceIsCurrent()) {
      if (!a.paused) {
        a.pause();
        v.play.playing = false;
        syncVoicePlayUI();
        return true;
      }
      const gen = ++v.playGen;
      v.play.playing = true;
      syncVoicePlayUI();
      const p2 = a.play();
      if (p2 && typeof p2.then === "function") {
        p2.then(() => {
          if (gen !== state.voice.playGen) return;
          v.play.playing = true;
          syncVoicePlayUI();
        }).catch((err) => onVoicePlayError(err, line, gen));
      }
      return true;
    }
    const gen = ++v.playGen;
    try {
      a.pause();
    } catch (_) {
      /* 忽略 */
    }
    v.play = {
      event: ev ? ev.event : null,
      id: line.id,
      audioFile: line.audioFile,
      url: url,
      playing: true,
      duration: 0,
      error: null,
    };
    delete v.lineErrors[line.id];
    a.src = url;
    try {
      a.load();
    } catch (_) {
      /* 忽略 */
    }
    linkVoiceAnimation(line);
    v.hint = v.hint || "播放：" + line.id;
    updateVoicePlaybar();
    patchVoiceProgress();
    syncVoicePlayUI();
    const p = a.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        if (gen !== state.voice.playGen) return;
        v.play.playing = true;
        syncVoicePlayUI();
      }).catch((err) => onVoicePlayError(err, line, gen));
    }
    return true;
  }

  function toggleVoiceLine(ev, line) {
    return startVoicePlayback(ev, line);
  }

  function auditionVoiceEvent(ev) {
    if (!ev) return false;
    const line = (ev.lines || []).filter((l) => l.audioStatus === "ok")[0] || null;
    if (!line) {
      setVoiceHint("该事件没有可用语音（语音缺失 / 未解析 / 待检查）", "warn");
      setStatus("该事件没有可用语音：" + (ev.event || ""), "warn");
      return false;
    }
    state.voice.selected = ev.event;
    return startVoicePlayback(ev, line);
  }

  function previewVoiceAnimation(line) {
    const v = state.voice;
    if (!line) return false;
    if (line.animationStatus !== "ok" || !v.animations || v.animations.indexOf(line.animation) < 0) {
      setVoiceHint("动画「" + (line.animation || "") + "」未映射或未检查，无法预览", "warn");
      setStatus("动画未映射或未检查，无法预览：" + (line.animation || ""), "warn");
      return false;
    }
    setAnim(line.animation);
    state.playing = true;
    state.lastTs = 0;
    syncPlayButton();
    requestAnimationFrame(tick);
    setVoiceHint("预览动画：" + line.animation);
    setStatus("预览动画「" + line.animation + "」", "info");
    return true;
  }

  function applyVoicePackRoot(raw) {
    const v = state.voice;
    const lib = voiceLib();
    if (!v.voice) return false;
    let root = String(raw == null ? "" : raw).trim();
    while (root.charAt(root.length - 1) === "/") root = root.slice(0, -1);
    if (!root) {
      notice("warn", "包根不能为空：请填仓库相对路径，例如 assets/characters/deepseek");
      return false;
    }
    if (lib && typeof lib.derivePackRoot === "function" && /\/voice\/index\.json$/.test(root)) {
      root = lib.derivePackRoot(root) || root;
    }
    const bad = voicePathIssue(root);
    if (bad) {
      notice("warn", "包根不可用：" + bad + "（" + root + "）");
      return false;
    }
    const dir = root.split("/").pop();
    const meta = v.voice.meta || {};
    if (meta.characterId && dir !== meta.characterId) {
      notice("warn", "包根目录名 " + dir + " 与语音包 character_id=" + meta.characterId + " 不一致；仍按你填的包根解析，请自行确认");
    }
    v.packRoot = root;
    v.packRootSource = "manual";
    v.rootDraft = root;
    v.audio = Object.create(null);
    v.audioDetail = Object.create(null);
    v.lineErrors = Object.create(null);
    v.checkGen++;
    for (const line of v.voice.lines) v.audio[line.audioFile] = "checking";
    evaluateVoiceState();
    checkVoiceAudio();
    refreshVoiceUI();
    setStatus("已设置语音包根：" + root + "，正在检查语音…", "info");
    return true;
  }

  /* --- 渲染 -------------------------------------------------------------- */

  function voiceStatusBadge(status, ev) {
    const badge = el("span", "status-badge " + status);
    badge.appendChild(iconEl(VOICE_STATUS_ICON[status] || "info"));
    let text = VOICE_STATUS_TEXT[status] || status;
    const lines = (ev && ev.lines) || [];
    if (status === "error") {
      const n = lines.filter((l) => l.audioStatus === "missing").length;
      if (n) text += " " + n;
      badge.title = "该事件有 " + n + " 条语音缺失（HTTP 404）";
    } else if (status === "warn") {
      const n = new Set(lines.filter((l) => l.animationStatus === "missing").map((l) => l.animation)).size;
      if (n) text += " " + n;
      badge.title =
        "该事件有 " +
        n +
        " 个动画未映射（模型无同名动画，需补语义→实际动画映射；不同台词共用同一标签只计 1 个）";
    } else if (status === "unknown") {
      badge.title = "该事件存在未检查 / 未解析的语音或动画";
    } else {
      badge.title = "语音与动画全部命中";
    }
    badge.appendChild(el("span", null, text));
    return badge;
  }

  function voiceStatusDot(status) {
    return el("span", "status-dot " + status);
  }

  /** 手动载入且没有包根时：提示 + 包根输入（只有这种情况才出现） */
  function renderVoiceRootHost() {
    const v = state.voice;
    const host = $("voiceRootHost");
    if (!host) return;
    const need = !!(v.voice && !v.packRoot);
    host.hidden = !need;
    host.textContent = "";
    if (!need) return;
    host.appendChild(
      el(
        "p",
        "voice-empty-hint",
        "当前语音包没有包根，音频状态为未解析；填写包根后重新解析并检查（不会自动继承上一个包）。"
      )
    );
    host.appendChild(buildVoiceRootForm());
  }

  function renderVoiceIssues() {
    const v = state.voice;
    const box = $("voiceIssues");
    const list = $("voiceIssueList");
    if (!box || !list) return;
    const issues = (v.issues || []).slice();
    if (!issues.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const title = $("voiceIssuesTitle");
    if (title) title.textContent = "索引警告 " + issues.length + " 条（独立展示，不参与事件异常判断）";
    list.hidden = !v.issuesOpen;
    list.textContent = "";
    if (v.issuesOpen) {
      for (const it of issues) {
        list.appendChild(el("li", null, (it.path || "") + " · " + (it.message || it.code || "")));
      }
    }
    const toggle = $("voiceIssuesToggle");
    if (toggle) {
      toggle.textContent = v.issuesOpen ? "收起" : "展开";
      toggle.hidden = false;
    }
  }

  function renderVoiceSummary() {
    const v = state.voice;
    const text = $("voiceSummaryText");
    if (!text) return;
    const filter = $("voiceStatusFilter");
    if (filter && filter.value !== v.statusFilter) filter.value = v.statusFilter;
    const link = $("voiceLinkAnim");
    if (link) link.checked = !!v.linkAnimation;
    text.textContent = "";
    if (!v.voice) {
      text.appendChild(el("span", "dim", v.autoProbeBusy ? "正在自动查找语音包…" : "未载入语音包"));
      return;
    }
    const c = voiceCounts();
    text.appendChild(el("span", null, c.events + " 事件 / " + c.lines + " 条台词"));
    text.appendChild(el("span", "vsep-dot", " · "));
    appendVoiceCount(text, "语音缺失", c.audioMissing, "error");
    text.appendChild(el("span", "vsep-dot", " / "));
    appendVoiceCount(text, "动画未映射", c.animMissing, "warn");
    text.appendChild(el("span", "vsep-dot", " / "));
    appendVoiceCount(text, "未检查", c.pending, "dim");
    if (v.checking) {
      text.appendChild(el("span", "vsep-dot", " · "));
      text.appendChild(el("span", "voice-checking", "检查中…"));
    }
  }

  function appendVoiceCount(parent, label, n, kind) {
    const span = el("span", "voice-count" + (n > 0 ? " is-" + kind : ""));
    span.textContent = label + " " + n;
    parent.appendChild(span);
  }

  function renderVoiceChips() {
    const box = $("voiceChips");
    if (!box) return;
    const v = state.voice;
    box.textContent = "";
    const cats = voiceCategories();
    const make = (value, label, count) => {
      const chip = el("button", "chip");
      chip.type = "button";
      chip.dataset.category = value;
      chip.setAttribute("aria-pressed", v.category === value ? "true" : "false");
      chip.appendChild(el("span", null, label));
      chip.appendChild(el("span", "chip-count", String(count)));
      chip.title = label + "：" + count + " 个事件";
      return chip;
    };
    box.appendChild(make("all", "全部", v.events.length));
    for (const cat of cats) {
      let n = 0;
      for (const ev of v.events) if ((ev.categories || []).indexOf(cat) >= 0) n++;
      box.appendChild(make(cat, cat, n));
    }
  }

  function buildVoiceRootForm() {
    const v = state.voice;
    const wrap = el("div", "voice-root-form");
    wrap.appendChild(el("span", "dim", "包根（仓库相对）"));
    const input = document.createElement("input");
    input.type = "text";
    input.className = "voice-root-input";
    input.placeholder = "assets/characters/deepseek";
    input.value = v.rootDraft || "";
    input.setAttribute("aria-label", "语音包根目录（仓库相对路径）");
    input.addEventListener("input", () => {
      state.voice.rootDraft = input.value;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyVoicePackRoot(input.value);
      }
    });
    const btn = el("button", "btn btn-sm", "应用");
    btn.type = "button";
    btn.addEventListener("click", () => applyVoicePackRoot(input.value));
    wrap.appendChild(input);
    wrap.appendChild(btn);
    return wrap;
  }

  function renderVoiceEmpty() {
    const box = $("voiceEmpty");
    if (!box) return;
    const v = state.voice;
    box.textContent = "";
    const add = (text, cls) => box.appendChild(el("p", cls || "empty-note", text));
    if (!voiceLib()) {
      add("voice.js 未加载，无法解析语音索引。", "empty-note voice-empty-error");
      return;
    }
    if (v.loadState === "loading" || v.autoProbeBusy) {
      add(v.autoProbeBusy ? "正在按角色包自动查找 voice/index.json…" : "正在读取语音索引…", "empty-note");
      return;
    }
    if (!v.voice) {
      if (v.error) add(v.error.message, "empty-note voice-empty-error");
      else if (v.autoProbeFailed)
        add(
          "没有找到语音包：已按角色包根及最多 3 级祖先探测 voice/index.json，未命中。事件默认跟随角色包自动探测；调试可用 文件 →「载入语音包…」或 ?voice=<仓库相对路径> 指定。",
          "empty-note"
        );
      else {
        add("尚未载入语音包。", "empty-note");
        add(
          "载入角色包（?index=）后会自动探测 voice/index.json；调试入口：文件 →「载入语音包…」或 ?voice=<仓库相对路径>。",
          "voice-empty-hint"
        );
      }
      return;
    }
    add("没有匹配的事件。", "empty-note");
    const actions = el("div", "voice-empty-actions");
    const reset = el("button", "btn btn-sm", "清除筛选");
    reset.type = "button";
    reset.addEventListener("click", () => {
      const vv = state.voice;
      vv.search = "";
      vv.category = "all";
      vv.statusFilter = "all";
      const search = $("voiceSearch");
      if (search) search.value = "";
      renderVoice();
    });
    actions.appendChild(reset);
    box.appendChild(actions);
  }

  function buildVoiceEventRow(ev) {
    const v = state.voice;
    const status = voiceEventStatus(ev);
    const open = v.expanded.has(ev.event);
    const row = el("div", "voice-event" + (open ? " open" : "") + (v.selected === ev.event ? " selected" : ""));
    row.dataset.event = ev.event;
    row.setAttribute("role", "listitem");

    const hd = el("div", "voice-ev-hd");
    // 第一行：箭头 + 事件名 + 状态徽标（320px 内不换行，事件名可省略）
    const line1 = el("div", "voice-ev-line1");
    const toggle = el("button", "voice-ev-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.title = open ? "折叠台词" : "展开台词";
    toggle.appendChild(iconEl("chevron-right"));
    line1.appendChild(toggle);
    const name = el("button", "voice-ev-name", ev.event);
    name.type = "button";
    name.title = "选中并" + (open ? "折叠" : "展开") + " " + ev.event;
    line1.appendChild(name);
    line1.appendChild(el("span", "spacer"));
    line1.appendChild(voiceStatusBadge(status, ev));
    hd.appendChild(line1);

    // 第二行：分类 / 条数 / 动画标签 / 试听
    const line2 = el("div", "voice-ev-line2");
    line2.appendChild(el("span", "voice-cat", ev.category || "—"));
    line2.appendChild(el("span", "voice-ev-meta", (ev.lines || []).length + " 条"));
    const tags = el("span", "voice-anim-tags");
    for (const anim of ev.animations || []) {
      const animStatus = voiceAnimationStatusInEvent(ev, anim);
      const tag = el(
        "span",
        "voice-tag" + (animStatus === "missing" ? " is-warn" : animStatus === "unknown" ? " is-dim" : " is-ok"),
        anim
      );
      tag.title =
        animStatus === "missing"
          ? "动画未映射：" + anim + "（模型无同名动画，需补语义→实际动画映射）"
          : animStatus === "unknown"
          ? "动画未检查：未载入角色模型"
          : "动画存在：" + anim;
      tags.appendChild(tag);
    }
    line2.appendChild(tags);
    line2.appendChild(el("span", "spacer"));
    const audition = el("button", "btn btn-sm voice-audition", "试听");
    audition.type = "button";
    const firstOk = (ev.lines || []).filter((l) => l.audioStatus === "ok")[0] || null;
    audition.disabled = !firstOk;
    audition.title = firstOk ? "试听 " + firstOk.id + "（第一条可用语音）" : "该事件没有可用语音";
    line2.appendChild(audition);
    hd.appendChild(line2);
    row.appendChild(hd);

    if (open) {
      const body = el("div", "voice-ev-body");

      /* 动画清单与状态（内联，替代原右侧详情） */
      const anims = el("div", "voice-ev-anims");
      anims.appendChild(el("span", "voice-ev-label", "动画"));
      const animList = ev.animations || [];
      if (!animList.length) anims.appendChild(el("span", "dim", "（无动画标签）"));
      else {
        for (const anim of animList) {
          const st = voiceAnimationStatusInEvent(ev, anim);
          const item = el(
            "span",
            "voice-anim-item" + (st === "ok" ? " is-ok" : st === "missing" ? " is-warn" : " is-dim")
          );
          item.appendChild(voiceStatusDot(st === "ok" ? "ok" : st === "missing" ? "warn" : "unknown"));
          item.appendChild(el("span", "voice-anim-name", anim));
          item.appendChild(el("span", "dim", st === "ok" ? "存在" : st === "missing" ? "未映射" : "未检查"));
          item.title =
            st === "ok"
              ? "动画存在：" + anim
              : st === "missing"
              ? voiceAnimationTitle({ animation: anim, animationStatus: "missing" })
              : "未载入角色模型，动画存在性未检查";
          anims.appendChild(item);
        }
      }
      body.appendChild(anims);

      /* 资源检查（复用 voiceResourceChecks） */
      body.appendChild(el("div", "voice-ev-label", "资源检查"));
      const checks = voiceResourceChecks(ev);
      const checkList = el("ul", "voice-check-list");
      if (!checks.length) {
        const li = el("li", "is-ok");
        li.appendChild(voiceStatusDot("ok"));
        li.appendChild(el("span", null, "语音与动画全部命中（" + (ev.lines || []).length + " 条台词）"));
        checkList.appendChild(li);
      } else {
        for (const item of checks) {
          const li = el("li", "is-" + item.kind);
          li.appendChild(voiceStatusDot(item.kind === "error" ? "error" : item.kind === "warn" ? "warn" : "unknown"));
          li.appendChild(el("span", null, item.text));
          checkList.appendChild(li);
        }
      }
      body.appendChild(checkList);
      body.appendChild(
        el(
          "p",
          "voice-model-anims dim",
          v.animations === null
            ? "未载入角色模型：动画存在性未检查"
            : "模型动画（" + v.animations.length + "）：" + (v.animations.join(" / ") || "（无）")
        )
      );

      /* 台词（只保留这一套，不再有右侧详情里的重复列表） */
      body.appendChild(el("div", "voice-ev-label", "台词"));
      const lines = el("div", "voice-lines");
      for (const line of ev.lines || []) lines.appendChild(buildVoiceLineRow(ev, line));
      body.appendChild(lines);
      row.appendChild(body);
    }
    return row;
  }

  function buildVoiceLineRow(ev, line) {
    const v = state.voice;
    const row = el("div", "voice-line");
    row.dataset.id = line.id;
    row.dataset.event = ev.event;

    const play = el("button", "voice-line-play btn btn-icon btn-sm");
    play.type = "button";
    const playing = voiceLineIsPlaying(line);
    play.innerHTML = icon(playing ? "pause" : "play");
    play.setAttribute("aria-pressed", playing ? "true" : "false");
    play.classList.toggle("on", playing);
    play.disabled = !voiceLinePlayable(line);
    play.title = voiceAudioTitle(line);
    play.setAttribute("aria-label", (playing ? "暂停" : "播放") + "台词 " + line.id);
    row.appendChild(play);

    const main = el("div", "voice-line-main");
    const top = el("div", "voice-line-top");
    top.appendChild(el("span", "voice-line-id", line.id));
    const audioTag = el(
      "span",
      "voice-tag" + (line.audioStatus === "missing" ? " is-error" : line.audioStatus === "ok" ? " is-ok" : " is-dim")
    );
    audioTag.textContent =
      line.audioStatus === "ok"
        ? "语音 ✓"
        : line.audioStatus === "missing"
        ? "语音缺失"
        : line.audioStatus === "checking"
        ? "检查中…"
        : line.audioStatus === "unresolved"
        ? "语音未解析"
        : "语音未确认";
    audioTag.title = voiceAudioTitle(line);
    top.appendChild(audioTag);
    const animTag = el(
      "span",
      "voice-tag" + (line.animationStatus === "missing" ? " is-warn" : line.animationStatus === "ok" ? " is-ok" : " is-dim")
    );
    animTag.textContent =
      line.animationStatus === "ok" ? "动画 ✓" : line.animationStatus === "missing" ? "动画未映射" : "动画未检查";
    animTag.title = voiceAnimationTitle(line);
    top.appendChild(animTag);
    const preview = el("button", "btn btn-sm voice-line-preview", "动画");
    preview.type = "button";
    preview.disabled = line.animationStatus !== "ok";
    preview.title =
      line.animationStatus === "ok"
        ? "预览动画「" + line.animation + "」（语音缺失时仍可用）"
        : voiceAnimationTitle(line);
    top.appendChild(preview);
    main.appendChild(top);
    main.appendChild(el("span", "voice-line-text", line.text || ""));
    const err = v.lineErrors[line.id];
    if (err) main.appendChild(el("span", "voice-line-error", err));
    main.appendChild(el("span", "voice-line-file", line.audioFile));
    row.appendChild(main);
    return row;
  }

  function renderVoiceList() {
    const v = state.voice;
    const box = $("voiceEventList");
    const empty = $("voiceEmpty");
    if (!box) return;
    box.textContent = "";
    const list = voiceVisibleEvents();
    if (!list.length) {
      box.hidden = true;
      if (empty) {
        empty.hidden = false;
        renderVoiceEmpty();
      }
    } else {
      box.hidden = false;
      if (empty) empty.hidden = true;
      const frag = document.createDocumentFragment();
      for (const ev of list) frag.appendChild(buildVoiceEventRow(ev));
      box.appendChild(frag);
    }
    const count = $("voiceSearchCount");
    if (count) {
      if (v.search.trim()) {
        count.hidden = false;
        count.textContent = list.length + "/" + v.events.length;
      } else count.hidden = true;
    }
  }

  function voiceResourceChecks(ev) {
    const v = state.voice;
    const animList = v.animations && v.animations.length ? v.animations.join(" / ") : "（无）";
    const out = [];
    for (const line of ev.lines || []) {
      if (line.audioStatus === "missing") {
        out.push({ kind: "error", text: "语音缺失：" + line.audioFile + "（" + (v.audioDetail[line.audioFile] || "HTTP 404") + "）" });
      } else if (line.audioStatus === "unresolved") {
        out.push({ kind: "warn", text: "语音未解析：" + line.audioFile + "（缺少语音包根，可用 ?voice= 或填写包根）" });
      } else if (line.audioStatus === "unknown") {
        out.push({ kind: "warn", text: "语音未确认：" + line.audioFile + "（" + (v.audioDetail[line.audioFile] || "未检查") + "）" });
      } else if (line.audioStatus === "checking") {
        out.push({ kind: "dim", text: "语音检查中：" + line.audioFile });
      }
      if (line.animationStatus === "missing") {
        out.push({
          kind: "warn",
          text: "动画未映射：" + line.animation + "（模型无同名动画，需补语义→实际动画映射；模型动画：" + animList + "）",
        });
      } else if (line.animationStatus === "unknown") {
        out.push({ kind: "warn", text: "动画未检查：" + line.animation + "（未载入角色模型，动画存在性未检查）" });
      }
    }
    const seen = new Set();
    return out.filter((it) => {
      if (seen.has(it.text)) return false;
      seen.add(it.text);
      return true;
    });
  }

  function renderVoice() {
    const v = state.voice;
    if (!v.open) return;
    const list = $("voiceEventList");
    const scroll = list ? list.scrollTop : 0;
    renderVoiceRootHost();
    renderVoiceIssues();
    renderVoiceSummary();
    renderVoiceChips();
    renderVoiceList();
    if (list) list.scrollTop = scroll;
    updateVoicePlaybar();
    syncVoicePlayUI();
  }

  function syncVoiceBadge() {
    const badge = $("eventTabBadge");
    const menuRef = menuRefs.voiceTest;
    const v = state.voice;
    const c = voiceCounts();
    // 徽标 = hasIssues 事件数（含未检查/未解析）；语音缺失红、仅动画未映射黄
    const issueEvents = v.events.filter((ev) => ev.hasIssues === true || voiceEventStatus(ev) !== "ok").length;
    if (badge) {
      badge.hidden = !v.voice || issueEvents === 0;
      badge.textContent = String(issueEvents);
      badge.classList.toggle("is-error", c.errorEvents > 0);
      badge.classList.toggle("is-warn", c.errorEvents === 0 && c.warnEvents > 0);
      badge.title = c.errorEvents
        ? "语音缺失 " + c.errorEvents + " 个事件"
        : c.warnEvents > 0
        ? "动画未映射 " + c.warnEvents + " 个事件" + (c.unknownEvents ? "，未检查 " + c.unknownEvents + " 个" : "")
        : c.unknownEvents > 0
        ? "未检查 " + c.unknownEvents + " 个事件（未载入模型或未解析）"
        : "无异常事件";
    }
    if (menuRef && menuRef.node) {
      const node = menuRef.node;
      const note = node.querySelector(".menu-note");
      if (note) {
        note.textContent = v.voice
          ? c.events +
            " 事件 / " +
            c.lines +
            " 条台词 · 语音缺失 " +
            c.audioMissing +
            " / 动画未映射 " +
            c.animMissing
          : v.autoProbeFailed
          ? "打开右侧事件分页（未找到语音包）"
          : "打开右侧事件分页（未载入语音包）";
      }
    }
  }

  function scheduleVoiceRefresh() {
    const v = state.voice;
    syncVoiceBadge();
    if (!v.open || v.renderTimer) return;
    v.renderTimer = setTimeout(() => {
      v.renderTimer = 0;
      renderVoice();
    }, 80);
  }

  function refreshVoiceUI() {
    syncVoiceBadge();
    const v = state.voice;
    if (v.renderTimer) {
      clearTimeout(v.renderTimer);
      v.renderTimer = 0;
    }
    if (v.open) renderVoice();
  }

  /* --- 打开 / 关闭 / 交互入口 -------------------------------------------- */

  /** 侧栏分页：parts | events（事件分页不是模态，键盘不拦截） */
  function setInspectorTab(tab) {
    const v = state.voice;
    const events = tab === "events";
    const aside = $("inspector");
    if (aside) aside.classList.toggle("show-events", events);
    const tabParts = $("tabParts");
    const tabEvents = $("tabEvents");
    if (tabParts) tabParts.setAttribute("aria-selected", events ? "false" : "true");
    if (tabEvents) tabEvents.setAttribute("aria-selected", events ? "true" : "false");
    const parts = $("partsView");
    const panel = $("eventPanel");
    if (parts) parts.hidden = events;
    if (panel) panel.hidden = !events;
    v.open = events;
    if (!events) {
      stopVoice();
      v.hint = "";
      v.hintKind = "";
    } else {
      syncVoiceBadge();
      renderVoice();
    }
  }

  function openVoice() {
    setPanelOpen(true);
    setInspectorTab("events");
  }

  function closeVoice() {
    setInspectorTab("parts");
  }

  function toggleVoiceEvent(name) {
    const v = state.voice;
    if (!name) return;
    if (v.expanded.has(name)) v.expanded.delete(name);
    else v.expanded.add(name);
    v.selected = name;
    renderVoice();
    const box = $("voiceEventList");
    const row = box && box.querySelector('.voice-event[data-event="' + voiceCssEscape(name) + '"]');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
  }

  function voiceSnapshot() {
    const v = state.voice;
    const c = voiceCounts();
    return {
      open: v.open,
      explicitRequest: v.explicitRequest,
      provenance: v.provenance,
      indexPath: v.indexPath,
      packRoot: v.packRoot,
      packRootSource: v.packRootSource,
      loadState: v.loadState,
      error: v.error ? { message: v.error.message, indexPath: v.error.indexPath } : null,
      autoProbeBusy: v.autoProbeBusy,
      autoProbeFailed: v.autoProbeFailed,
      checking: v.checking,
      issues: (v.issues || []).map((i) => ({ path: i.path, code: i.code, message: i.message })),
      meta: v.voice ? v.voice.meta : null,
      animations: v.animations ? v.animations.slice() : null,
      events: v.events.map((ev) => ({
        event: ev.event,
        category: ev.category,
        categories: (ev.categories || []).slice(),
        status: voiceEventStatus(ev),
        lineCount: (ev.lines || []).length,
        animations: (ev.animations || []).slice(),
        missingAudio: (ev.lines || []).filter((l) => l.audioStatus === "missing").length,
        missingAnimation: (ev.lines || []).filter((l) => l.animationStatus === "missing").length,
        lines: (ev.lines || []).map((l) => ({
          id: l.id,
          text: l.text,
          animation: l.animation,
          audioFile: l.audioFile,
          audioStatus: l.audioStatus,
          audioDetail: v.audioDetail[l.audioFile] || l.audioDetail || "",
          animationStatus: l.animationStatus,
        })),
      })),
      summary: c,
      expanded: Array.from(v.expanded),
      selected: v.selected,
      search: v.search,
      category: v.category,
      statusFilter: v.statusFilter,
      linkAnimation: v.linkAnimation,
      play: {
        event: v.play.event,
        id: v.play.id,
        audioFile: v.play.audioFile,
        url: v.play.url,
        playing: v.play.playing,
        duration: v.play.duration,
        error: v.play.error,
      },
    };
  }

  /* ==========================================================================
   * 14. 保存（就地回写）/ 另存（ZIP）—— 契约 §4.2 / §4.4
   * ====================================================================== */
  function currentBoneValues() {
    return state.boneList.map((b) => ({
      name: b.name,
      x: b.x,
      y: b.y,
      rotation: b.rotation,
      scaleX: b.scaleX,
      scaleY: b.scaleY,
    }));
  }

  function currentSlotOrder() {
    return state.slots.map((s) => s.name);
  }

  /** 与另存/保存共用的补丁：无改动时复用缓存原文（契约 §4.2.1） */
  function patchedModel() {
    const lib = window.SpineBundle;
    const res = lib.buildPatchedModel(state.raw, currentBoneValues(), currentSlotOrder());
    if (!res.ok) throw issuesToError(res.issues, "生成模型补丁失败：");
    const reuse = snapshot() === state.initial && !!(state.bundle && state.bundle.modelText);
    return { patched: res.value, text: reuse ? state.bundle.modelText : lib.serializeModel(res.value), reused: reuse };
  }

  function toBase64(bytes) {
    const chunk = 0x8000;
    let out = "";
    for (let i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /** 保存成功后把可编辑骨字段与落盘值对齐（契约 §4.2.5），setup 缓存同步 */
  function alignBonesToSaved(patched) {
    const saved = (patched && patched.bones) || [];
    for (let i = 0; i < state.boneList.length; i++) {
      const cur = state.boneList[i];
      if (!cur) continue;
      const src = saved[i];
      const setup = state.model && state.model.bones[cur.index];
      for (const f of FIELDS) {
        const dflt = f === "scaleX" || f === "scaleY" ? 1 : 0;
        const v = !src || src[f] == null ? dflt : src[f];
        cur[f] = v;
        if (setup) setup[f] = v;
      }
    }
  }

  function saveTarget() {
    const b = state.bundle;
    return b && b.canSave && b.base && b.index ? b : null;
  }

  function canSaveNow() {
    if (!saveTarget()) return false;
    if (state.writeState !== "ready") return false;
    if (state.saveBusy || state.zipBusy || state.loading) return false;
    if (state.drag) return false;
    return true;
  }

  function saveReason() {
    if (state.loading) return "载入中…";
    if (state.saveBusy) return "正在保存…";
    if (state.zipBusy) return "正在生成 ZIP…";
    if (!state.model) return "尚未载入；请选择 index.json";
    if (state.writeState === "checking") return "正在检查写入服务…";
    if (state.writeState === "uncertain") return "保存结果待确认；请重新载入后再就地保存";
    if (!saveTarget()) {
      const b = state.bundle;
      if (b && b.reason) return b.reason;
      return "已载入但无写回目标；请选择 index.json";
    }
    if (state.writeState === "readonly") return "当前服务只读，可另存文件（ZIP）；使用启动脚本启用保存";
    if (state.drag) return "请结束当前拖动";
    return "保存到 " + state.bundle.base;
  }

  function canArchiveNow() {
    const b = state.bundle;
    if (!b || !b.canArchive) return false;
    if (state.saveBusy || state.zipBusy || state.loading) return false;
    return true;
  }

  function archiveReason() {
    if (state.loading) return "载入中…";
    if (state.saveBusy) return "正在保存…";
    if (state.zipBusy) return "正在生成 ZIP…";
    if (!state.model) return "尚未载入；请选择 index.json";
    const b = state.bundle;
    if (b && b.reason) return b.reason;
    if (canArchiveNow()) return "打包 index.json + model + atlas + 贴图（ZIP 下载）";
    return "整包字节不完整，无法另存";
  }

  function enterUncertain(message) {
    state.writeState = "uncertain";
    syncAll();
    notice("error", message, [{ label: "重新载入", onClick: reloadCurrent }]);
    setStatus(message, "error");
    return false;
  }

  function reloadCurrent() {
    const b = state.bundle;
    if (!b) return false;
    if (b.entry === "picker" || b.entry === "example" || b.entry === "url" || b.entry === "index") {
      return loadIndexByPath(b.indexPath, b.entry === "picker" ? "picker" : "url");
    }
    if (b.entry === "rig") return loadRig(b.indexPath || "");
    return false;
  }

  function flushPendingEdits() {
    const active = document.activeElement;
    if (!active || !active.id) return;
    if (["posX", "posY", "rotX", "scaleX", "scaleY"].indexOf(active.id) < 0) return;
    active.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function saveToDisk() {
    if (!canSaveNow()) {
      setStatus(saveReason(), "warn");
      return false;
    }
    const lib = window.SpineBundle;
    const b = saveTarget();
    flushPendingEdits();

    let patch;
    try {
      patch = patchedModel();
    } catch (e) {
      setStatus(e.message, "error");
      notice("error", e.message);
      return false;
    }

    let body;
    try {
      body = {
        apiVersion: 1,
        base: b.base,
        index: b.index,
        model: { name: b.modelName, encoding: "utf8", data: patch.text },
        atlas: { name: b.atlasName, encoding: "utf8", data: b.atlasText },
        textures: b.textureNames.map((name) => {
          const bytes = b.textureBytesByName[name];
          if (!bytes) throw new Error("贴图原始字节缺失：" + name);
          return { name: name, encoding: "base64", data: toBase64(bytes) };
        }),
      };
    } catch (e) {
      setStatus("保存失败：" + e.message, "error");
      notice("error", "保存失败：" + e.message);
      return false;
    }

    const expected = lib.targetNames(b.index);
    const shape = lib.checkSaveRequestShape(body, expected);
    if (!shape.ok) {
      const err = issuesToError(shape.issues, "保存请求自检失败：");
      setStatus(err.message, "error");
      notice("error", err.message);
      return false;
    }

    state.saveBusy = true;
    state.writeState = "saving";
    syncAll();
    setStatus("正在保存 → " + b.base + " …");

    let response = null;
    let networkError = null;
    try {
      response = await fetch("/api/save-bundle", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Spine-Editor": "save-bundle-v1",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      networkError = e;
    }

    let payload = null;
    if (response) {
      try {
        payload = await response.json();
      } catch (_) {
        payload = null;
      }
    }
    state.saveBusy = false;

    if (networkError || !response) {
      return enterUncertain("未确认保存结果；改动仍保留，请重新载入核对磁盘（" + ((networkError && networkError.message) || "网络中断") + "）");
    }

    if (!response.ok) {
      const err = payload && payload.error ? payload.error : null;
      if (!err) {
        return enterUncertain("未确认保存结果（HTTP " + response.status + " 响应无法识别）；改动仍保留，请重新载入核对磁盘");
      }
      if (err.code === "ROLLBACK_FAILED") {
        return enterUncertain(err.message || "保存失败且部分文件未能恢复，请先检查磁盘或重新载入");
      }
      state.writeState = "ready";
      syncAll();
      const extra = err.code === "WRITE_DISABLED" ? "（当前服务只读）" : "";
      notice("error", "保存失败：" + err.message + extra);
      setStatus("保存失败：" + err.message, "error");
      return false;
    }

    const check = lib.checkSaveResponse(payload, expected);
    if (!check.ok) {
      return enterUncertain(
        "未确认保存结果：保存响应目标集合不完整（" + issuesToError(check.issues, "").message + "）；请重新载入核对磁盘"
      );
    }

    /* ---- 收到合法 200 且目标集合完整，才提交新基线（契约 §4.2.4） ---- */
    /* b.index 在载入时即由 normalizedIndex 规范化，保存不改变它的字段；这里只刷新序列化字节。 */
    b.indexBytes = textBytes(lib.serializeIndex(b.index));
    b.modelText = patch.text;
    b.modelBytes = textBytes(patch.text);
    state.raw =
      typeof structuredClone === "function" ? structuredClone(patch.patched) : JSON.parse(JSON.stringify(patch.patched));
    alignBonesToSaved(patch.patched);
    state.initial = snapshot();
    state.dirty = false;
    state.writeState = "ready";
    syncAll();
    framePose();
    render();

    const changed = check.value.changed;
    const unchanged = check.value.unchanged;
    const changedText = changed.length ? "写入 " + changed.join("、") : "无文件变化";
    notice("info", "已保存到 " + b.base + "：" + changedText + "；未变化 " + unchanged.length + " 个文件");
    setStatus("已保存 " + changed.length + " 个文件 / " + unchanged.length + " 个未变化 · " + b.base);
    return true;
  }

  function saveAsZip() {
    if (!canArchiveNow()) {
      setStatus(archiveReason(), "warn");
      return false;
    }
    const lib = window.SpineBundle;
    const b = state.bundle;
    state.zipBusy = true;
    syncAll();
    setStatus("正在生成 ZIP…");
    try {
      const patch = patchedModel();
      const pkg = {
        base: b.base,
        indexBytes: textBytes(lib.serializeIndex(b.index)),
        model: { name: b.modelName, bytes: textBytes(patch.text) },
        atlas: { name: b.atlasName, bytes: b.atlasBytes },
        textures: b.textureNames.map((name) => ({ name: name, bytes: b.textureBytesByName[name] })),
      };
      const plan = lib.planBundleArchive(pkg);
      if (!plan.ok) {
        const err = issuesToError(plan.issues, "另存失败：");
        setStatus(err.message, "error");
        notice("error", err.message);
        return false;
      }
      const zip = lib.buildZipStore(plan.value.entries);
      if (!zip.ok) {
        const err = issuesToError(zip.issues, "另存失败：");
        setStatus(err.message, "error");
        notice("error", err.message);
        return false;
      }
      downloadBlob(new Blob([zip.value], { type: "application/zip" }), plan.value.zipName);
      notice("info", "已生成 ZIP 并发起下载：" + plan.value.zipName + "；当前文件尚未就地保存");
      setStatus("已生成 ZIP：" + plan.value.zipName + "（" + zip.value.length + " 字节）");
      return true;
    } catch (e) {
      const message = "另存失败：" + ((e && e.message) || e);
      setStatus(message, "error");
      notice("error", message);
      return false;
    } finally {
      state.zipBusy = false;
      syncAll();
    }
  }

  /* ==========================================================================
   * 15. 菜单条（文件 / 编辑 / 视图 / 帮助）—— 契约 §4.1
   *     单一数据源：菜单与行内控件都调用同一 setter，同步函数同时写 DOM 与 aria-checked
   * ====================================================================== */
  const menuRefs = Object.create(null);

  function menuSep() {
    return el("div", "menu-sep");
  }

  function menuTitle(text) {
    return el("div", "menu-title", text);
  }

  function menuItem(key, opts) {
    const b = el("button", "menu-item");
    b.type = "button";
    b.setAttribute("role", opts.check ? "menuitemcheckbox" : "menuitem");
    if (opts.check) b.setAttribute("aria-checked", "false");
    if (key) b.id = "mi-" + key;
    b.appendChild(iconEl(opts.icon || "info"));
    const text = el("span", "menu-text");
    text.appendChild(el("span", "menu-label", opts.label));
    if (opts.note !== undefined) text.appendChild(el("span", "menu-note", opts.note));
    b.appendChild(text);
    if (opts.kbd) {
      const k = el("kbd", "menu-kbd");
      k.textContent = opts.kbd;
      b.appendChild(k);
    }
    if (key) menuRefs[key] = { node: b, opts: opts };
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (b.disabled) return;
      closeMenus();
      if (opts.onClick) opts.onClick();
    });
    return b;
  }

  function menuSlider(key, opts) {
    const wrap = el("div", "menu-field");
    wrap.appendChild(el("span", "menu-field-label", opts.label));
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(opts.min == null ? 0 : opts.min);
    input.max = String(opts.max == null ? 100 : opts.max);
    input.step = String(opts.step == null ? 1 : opts.step);
    input.setAttribute("aria-label", opts.label);
    input.addEventListener("input", () => opts.onInput(Number(input.value)));
    const val = el("span", "val mono", "");
    wrap.appendChild(input);
    wrap.appendChild(val);
    menuRefs[key] = { node: input, val: val, opts: opts };
    return wrap;
  }

  function buildFileMenu() {
    const menu = $("menuFile");
    menu.textContent = "";
    menu.appendChild(
      menuItem("load", {
        label: "载入文件…",
        icon: "open",
        note: "选择一个 index.json；模型、图集和贴图由索引读取",
        onClick: () => $("files").click(),
      })
    );
    menu.appendChild(
      menuItem("save", { label: "保存文件", icon: "save", kbd: MOD_LABEL + "+S", note: "", onClick: saveToDisk })
    );
    menu.appendChild(menuItem("saveAs", { label: "另存文件", icon: "layers", note: "", onClick: saveAsZip }));
    menu.appendChild(menuSep());
    menu.appendChild(menuTitle("事件"));
    menu.appendChild(
      menuItem("voiceTest", {
        label: "事件测试…",
        icon: "voice",
        note: "打开右侧事件分页（未载入语音包）",
        onClick: () => openVoice(),
      })
    );
    menu.appendChild(
      menuItem("voiceLoad", {
        label: "载入语音包…",
        icon: "open",
        note: "选择一个 voice/index.json（只读）",
        onClick: () => $("voiceFiles").click(),
      })
    );
    menu.appendChild(menuSep());
    menu.appendChild(menuTitle("示例"));
    menu.appendChild(
      menuItem("ex-main", {
        label: "deepseek 女仆",
        icon: "sample",
        note: "assets/characters/deepseek/spine · 经索引载入",
        onClick: loadExample,
      })
    );
    menu.appendChild(
      menuItem("ex-legacy", {
        label: "deepseek 旧版三视图",
        icon: "sample",
        note: "assets/characters/deepseek/spine/legacy-views · 经索引载入",
        onClick: loadLegacyExample,
      })
    );
    menu.appendChild(menuSep());
    menu.appendChild(menuTitle("测试样张（fixtures）"));
    const cases = fixtureCases();
    if (cases) {
      const ids = Object.keys(cases).filter((id) => cases[id] && cases[id].example === true);
      const list = ids.length ? ids : Object.keys(cases);
      const groupIcon = {
        basic: "mesh",
        atlas: "texture",
        ik: "target",
        fk: "bone",
        diagnostics: "alert",
        degenerate: "alert",
      };
      for (const id of list) {
        const fx = cases[id];
        menu.appendChild(
          menuItem("fx-" + id, {
            label: fx.label || id,
            note: "fixtures/" + id + (fx.group ? " · " + fx.group : "") + "（只读样张）",
            icon: groupIcon[fx.group] || "mesh",
            onClick: () => loadFixture(id),
          })
        );
      }
      if (list.length < Object.keys(cases).length) {
        menu.appendChild(
          menuItem("fx-rest", {
            label: "其余 " + (Object.keys(cases).length - list.length) + " 个样张",
            note: "含退化/不支持特性用例：在 selftest.html 里跑断言",
            icon: "info",
            disabled: true,
            onClick: () => {},
          })
        );
      }
    } else {
      menu.appendChild(menuItem("fx-none", { label: "fixtures 未就绪", note: "需要 fixtures/cases.js", icon: "mesh", disabled: true, onClick: () => {} }));
    }
    menu.appendChild(menuSep());
    const rig = new URLSearchParams(location.search).get("rig");
    menu.appendChild(
      menuItem("rig-hint", {
        label: "开发用：?rig=<相对路径>",
        note: rig ? "当前：" + rig + "（只读，保存禁用）" : "地址栏追加 ?index=assets/…/index.json 可就地保存",
        icon: "target",
        disabled: true,
        onClick: () => {},
      })
    );
  }

  function buildEditMenu() {
    const menu = $("menuEdit");
    menu.textContent = "";
    menu.appendChild(
      menuItem("toolMove", { label: "移动", icon: "move", kbd: "V", check: true, onClick: () => setTool("move") })
    );
    menu.appendChild(
      menuItem("toolPan", { label: "平移", icon: "hand", kbd: "Space", check: true, onClick: () => setTool("pan") })
    );
    menu.appendChild(menuSep());
    menu.appendChild(
      menuItem("undo", { label: "撤销", icon: "undo", kbd: MOD_LABEL + "+Z", onClick: () => undo() })
    );
    menu.appendChild(
      menuItem("reset", { label: "重置", icon: "reset", note: "回到最近保存状态", onClick: () => resetAll() })
    );
  }

  function buildViewMenu() {
    const menu = $("menuView");
    menu.textContent = "";
    menu.appendChild(menuItem("fit", { label: "适配", icon: "fit", kbd: "F", onClick: () => fitView("all") }));
    menu.appendChild(menuItem("zoomIn", { label: "放大", icon: "zoom-in", kbd: "+", onClick: () => zoomBy(1.25) }));
    menu.appendChild(menuItem("zoomOut", { label: "缩小", icon: "zoom-out", kbd: "-", onClick: () => zoomBy(1 / 1.25) }));
    menu.appendChild(menuItem("zoom100", { label: "实际大小", icon: "bounds", note: "100%", onClick: zoomReset }));
    menu.appendChild(menuSep());
    menu.appendChild(menuItem("panel", { label: "面板", icon: "panel", check: true, onClick: () => setPanelOpen(!panelVisible()) }));
    menu.appendChild(menuSep());
    menu.appendChild(menuTitle("显示层"));
    const layers = [
      ["texture", "贴图", "texture"],
      ["bones", "骨骼", "bone"],
      ["mesh", "网格", "mesh"],
      ["weights", "权重", "weight"],
    ];
    for (const item of layers) {
      menu.appendChild(
        menuItem("layer-" + item[0], {
          label: item[1],
          icon: item[2],
          check: true,
          onClick: () => setLayer(item[0], !state.show[item[0]]),
        })
      );
    }
    menu.appendChild(menuSep());
    menu.appendChild(menuItem("snap", { label: "吸附", icon: "magnet", check: true, onClick: () => setSnap(!state.snap) }));
    menu.appendChild(menuTitle("权重配色"));
    menu.appendChild(
      menuItem("weightBone", { label: "按骨配色", icon: "weight", check: true, onClick: () => setWeightMode("bone") })
    );
    menu.appendChild(
      menuItem("weightHeat", { label: "选中骨热力", icon: "weight", check: true, onClick: () => setWeightMode("heat") })
    );
    menu.appendChild(menuSep());
    menu.appendChild(menuTitle("贴图强度"));
    menu.appendChild(
      menuSlider("texAlpha", {
        label: "贴图强度",
        min: 0,
        max: 100,
        step: 1,
        onInput: (v) => setTexAlpha(v, { auto: false }),
      })
    );
  }

  function buildHelpMenu() {
    const menu = $("menuHelp");
    menu.textContent = "";
    menu.appendChild(menuItem("help", { label: "帮助浮层", icon: "help", kbd: "?", onClick: () => openHelp() }));
    menu.appendChild(
      menuItem("shortcuts", { label: "快捷键", icon: "keyframe", note: "打开帮助并跳到键盘表", onClick: () => openHelp("keys") })
    );
  }

  function buildMenus() {
    buildFileMenu();
    buildEditMenu();
    buildViewMenu();
    buildHelpMenu();
  }

  function syncMenuEntry(key, patch) {
    const ref = menuRefs[key];
    if (!ref || !ref.node) return;
    const node = ref.node;
    if (patch.disabled !== undefined) node.disabled = !!patch.disabled;
    if (patch.checked !== undefined) node.setAttribute("aria-checked", patch.checked ? "true" : "false");
    if (patch.note !== undefined) {
      const note = node.querySelector(".menu-note");
      if (note) note.textContent = patch.note;
      // 只在禁用时用 title 解释原因；恢复可用后清掉，避免残留「载入中… / 正在生成 ZIP…」
      if (node.disabled && patch.note) node.title = patch.note;
      else node.removeAttribute("title");
    }
    if (patch.label !== undefined) {
      const lab = node.querySelector(".menu-label");
      if (lab) lab.textContent = patch.label;
    }
  }

  function syncMenus() {
    const loaded = !!state.model;
    const busy = state.loading || state.saveBusy || state.zipBusy;
    syncMenuEntry("load", { disabled: busy });
    syncMenuEntry("save", { disabled: !canSaveNow(), note: saveReason() });
    syncMenuEntry("saveAs", { disabled: !canArchiveNow(), note: archiveReason() });
    syncMenuEntry("voiceTest", { disabled: false });
    syncMenuEntry("voiceLoad", { disabled: false });
    syncMenuEntry("toolMove", { checked: state.tool === "move" });
    syncMenuEntry("toolPan", { checked: state.tool === "pan" });
    syncMenuEntry("undo", { disabled: !loaded || state.undo.length === 0 });
    syncMenuEntry("reset", { disabled: !loaded });
    syncMenuEntry("fit", { disabled: !loaded });
    syncMenuEntry("zoomIn", { disabled: !loaded });
    syncMenuEntry("zoomOut", { disabled: !loaded });
    syncMenuEntry("zoom100", { disabled: !loaded });
    syncMenuEntry("panel", { checked: panelVisible() });
    for (const name of ["texture", "bones", "mesh", "weights"]) {
      syncMenuEntry("layer-" + name, { checked: !!state.show[name] });
    }
    syncMenuEntry("snap", { checked: !!state.snap });
    syncMenuEntry("weightBone", { checked: state.weightMode !== "heat" });
    syncMenuEntry("weightHeat", { checked: state.weightMode === "heat" });
    const tex = menuRefs.texAlpha;
    if (tex && tex.node) {
      tex.node.value = String(state.texAlpha);
      tex.node.disabled = false;
      tex.val.textContent = Math.round(state.texAlpha) + "%";
    }
    const fileBtn = $("btnMenuFile");
    if (fileBtn) fileBtn.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function anyMenuOpen() {
    return $$(".menubar .menu").some((m) => !m.hidden);
  }

  function closeMenus() {
    for (const wrap of $$(".menubar .menu-wrap")) {
      const menu = wrap.querySelector(".menu");
      const btn = wrap.querySelector(".menubtn");
      if (menu && !menu.hidden) {
        menu.hidden = true;
        menu.style.left = "";
        menu.style.right = "";
      }
      if (btn) btn.setAttribute("aria-expanded", "false");
    }
  }

  function menuFocusables(menu) {
    return $$(".menu-item:not(:disabled)", menu);
  }

  function focusMenuItem(menu, index) {
    const items = menuFocusables(menu);
    if (!items.length) return;
    const i = Math.max(0, Math.min(items.length - 1, index));
    items[i].focus();
  }

  /** 视口右边缘翻转：靠右的菜单改为右对齐，避免被裁切 */
  function positionMenu(wrap) {
    const menu = wrap.querySelector(".menu");
    if (!menu || menu.hidden) return;
    menu.style.left = "";
    menu.style.right = "";
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      menu.style.left = "auto";
      menu.style.right = "0px";
    }
  }

  function openMenu(wrap) {
    closeMenus();
    const menu = wrap.querySelector(".menu");
    const btn = wrap.querySelector(".menubtn");
    if (!menu || !btn) return;
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    positionMenu(wrap);
  }

  function bindMenus() {
    for (const wrap of $$(".menubar .menu-wrap")) {
      const btn = wrap.querySelector(".menubtn");
      const menu = wrap.querySelector(".menu");
      if (!btn || !menu) continue;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (menu.hidden) openMenu(wrap);
        else closeMenus();
      });
      btn.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openMenu(wrap);
          focusMenuItem(menu, 0);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          openMenu(wrap);
          const items = menuFocusables(menu);
          focusMenuItem(menu, items.length - 1);
        }
      });
      btn.addEventListener("mouseenter", () => {
        if (anyMenuOpen() && menu.hidden) openMenu(wrap);
      });
      menu.addEventListener("click", (e) => e.stopPropagation());
      menu.addEventListener("keydown", (e) => {
        const items = menuFocusables(menu);
        const at = items.indexOf(document.activeElement);
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeMenus();
          btn.focus();
          return;
        }
        if (e.key === "Tab") {
          closeMenus();
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const dir = e.key === "ArrowDown" ? 1 : -1;
          const next = items.length ? (at < 0 ? 0 : (at + dir + items.length) % items.length) : 0;
          focusMenuItem(menu, next);
          return;
        }
        if (e.key === "Home") {
          e.preventDefault();
          focusMenuItem(menu, 0);
          return;
        }
        if (e.key === "End") {
          e.preventDefault();
          focusMenuItem(menu, items.length - 1);
        }
      });
    }
    document.addEventListener("click", (e) => {
      if (!e.target || !e.target.closest || !e.target.closest(".menu-wrap")) closeMenus();
    });
    window.addEventListener("resize", () => {
      for (const wrap of $$(".menubar .menu-wrap")) positionMenu(wrap);
    });
  }

  /* --- 视图/显示层单一数据源 setter（行内控件与菜单共用） ------------------ */

  function zoomReset() {
    if (!state.model) return;
    const b = state.frame ? core.boundsOf(state.frame.geo) : null;
    state.zoom = 1;
    if (b) {
      state.panX = -((b.minX + b.maxX) / 2);
      state.panY = -((b.minY + b.maxY) / 2);
    }
    syncZoom();
    render();
  }

  function setLayer(name, on) {
    if (!(name in state.show)) return;
    state.show[name] = !!on;
    autoTextureAlpha();
    syncLayers();
    syncStageOverlays();
    syncDebug();
    render();
    if (!anyLayerOn()) setStatus("四个显示层都关了：画布暂不响应拾取，列表与检查器仍可用", "warn");
  }

  function setSnap(on) {
    state.snap = !!on;
    syncLayers();
    setStatus(state.snap ? "吸附已开启：拖动取整到 1 个单位" : "吸附已关闭");
  }

  function setTexAlpha(v, opts) {
    const n = Number(v);
    state.texAlpha = clamp(Number.isFinite(n) ? n : 0, 0, 100);
    if (opts && opts.auto === false) state.texAlphaAuto = false;
    syncLayers();
    render();
  }

  function setWeightMode(mode) {
    state.weightMode = mode === "heat" ? "heat" : "bone";
    syncLayers();
    render();
    syncDebug();
  }

  const isNarrow = () => !!(window.matchMedia && window.matchMedia("(max-width: 959px)").matches);

  function panelVisible() {
    if (isNarrow()) return document.body.classList.contains("drawer-open");
    return !document.body.classList.contains("panel-hidden");
  }

  function syncPanel() {
    const btn = $("btnPanel");
    const open = panelVisible();
    if (btn) {
      // 「展开」只负责展开：面板已展开时隐藏；不再强制 disabled（Lead UI 反馈 3）
      btn.hidden = open;
      btn.setAttribute("aria-pressed", open ? "true" : "false");
      btn.classList.toggle("on", open);
      btn.disabled = false;
    }
    const close = $("btnPanelClose");
    if (close) close.disabled = false;
  }

  function setPanelOpen(open) {
    if (isNarrow()) document.body.classList.toggle("drawer-open", !!open);
    else document.body.classList.toggle("panel-hidden", !open);
    // 收起侧栏（宽屏 / 窄屏抽屉）时停语音：否则后台继续播且没有可见控件
    if (!open) {
      stopVoice();
      state.voice.hint = "";
      state.voice.hintKind = "";
    }
    syncPanel();
    if (state.model) render();
  }
  /* ==========================================================================
   * 16. 绑定 / 启动
   * ====================================================================== */
  function applyInspectorNumber(axis) {
    if (state.sel < 0) return;
    const reason = dragBlockReason(state.sel);
    if (reason) return setStatus(reason, "warn");
    const slot = state.slots[state.sel];
    const v = parseFloat($(axis === "x" ? "posX" : "posY").value);
    if (!Number.isFinite(v)) return syncInspector();
    const b = state.bones[slot.boneName];
    const before = snapshot();
    b[axis] = v;
    if (commit(before)) {
      syncAll();
      render();
    } else syncInspector();
  }
  function applyBoneField(field, rawValue) {
    if (state.sel < 0) return;
    const slot = state.slots[state.sel];
    if (state.anim || state.locked.has(slot.name)) return;
    const v = Number(rawValue);
    if (!Number.isFinite(v)) return syncInspector();
    const b = state.bones[slot.boneName];
    const before = snapshot();
    b[field] = field === "scaleX" || field === "scaleY" ? (v > 0 ? v : 0.01) : v;
    if (commit(before)) {
      syncInspector();
      syncDebug();
      render();
    }
  }
  function bindUI() {
    $("btnEmptyLoad").addEventListener("click", () => $("files").click());
    $("files").addEventListener("change", (e) => {
      loadFiles(e.target.files);
      e.target.value = "";
    });
    $("btnEmptyExample").addEventListener("click", loadExample);
    $("btnFit").addEventListener("click", () => fitView("all"));
    $("btnZoomIn").addEventListener("click", () => zoomBy(1.25));
    $("btnZoomOut").addEventListener("click", () => zoomBy(1 / 1.25));
    $("btnPanel").addEventListener("click", () => setPanelOpen(true));
    $("btnPanelClose").addEventListener("click", () => setPanelOpen(false));
    $("helpClose").addEventListener("click", closeHelp);
    $("helpOverlay").addEventListener("click", (e) => {
      if (e.target === $("helpOverlay")) closeHelp();
    });
    /* ---- 右侧侧栏分页：部件 / 事件（契约 §2，非模态） ---- */
    const setListView = (view) => {
      if (state.listView === view) return;
      state.listView = view;
      syncList();
      setStatus(view === "tree" ? "部件列表：骨骼层级" : "部件列表：显示顺序");
    };
    $("tabListTree").addEventListener("click", () => setListView("tree"));
    $("tabListOrder").addEventListener("click", () => setListView("order"));
    $("tabParts").addEventListener("click", () => setInspectorTab("parts"));
    $("tabEvents").addEventListener("click", () => setInspectorTab("events"));
    $("voiceFiles").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) loadVoiceFromFile(file);
    });
    $("voiceSearch").addEventListener("input", (e) => {
      state.voice.search = e.target.value;
      if (state.voice.open) renderVoice();
    });
    $("voiceStatusFilter").addEventListener("change", (e) => {
      state.voice.statusFilter = e.target.value;
      if (state.voice.open) renderVoice();
    });
    $("voiceLinkAnim").addEventListener("change", (e) => {
      state.voice.linkAnimation = e.target.checked;
      setStatus(e.target.checked ? "已开启联动动画" : "已关闭联动动画：只播放语音");
    });
    $("voiceIssuesToggle").addEventListener("click", () => {
      state.voice.issuesOpen = !state.voice.issuesOpen;
      if (state.voice.open) renderVoice();
    });
    $("voiceStop").addEventListener("click", () => {
      stopVoice();
      setVoiceHint("已停止语音");
      setStatus("已停止语音");
    });
    $("voiceSeek").addEventListener("input", (e) => {
      const v = state.voice;
      const a = voiceAudioEl();
      if (!a || !voiceIsCurrent() || !(v.play.duration > 0)) return;
      const t = (v.play.duration * Number(e.target.value)) / 1000;
      try {
        a.currentTime = t;
      } catch (_) {
        /* 忽略 */
      }
      patchVoiceProgress();
    });
    $("voiceChips").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      state.voice.category = chip.dataset.category || "all";
      renderVoice();
    });
    $("voiceEventList").addEventListener("click", (e) => {
      const playBtn = e.target.closest(".voice-line-play");
      if (playBtn) {
        const row = playBtn.closest(".voice-line");
        const line = row ? voiceFindLine(row.dataset.id) : null;
        const ev = line ? voiceFindEventOfLine(line) : null;
        if (line) {
          if (ev) state.voice.selected = ev.event;
          startVoicePlayback(ev, line);
        }
        return;
      }
      const previewBtn = e.target.closest(".voice-line-preview");
      if (previewBtn) {
        const row = previewBtn.closest(".voice-line");
        const line = row ? voiceFindLine(row.dataset.id) : null;
        const ev = line ? voiceFindEventOfLine(line) : null;
        if (ev) state.voice.selected = ev.event;
        previewVoiceAnimation(line);
        return;
      }
      const auditionBtn = e.target.closest(".voice-audition");
      if (auditionBtn) {
        const row = auditionBtn.closest(".voice-event");
        auditionVoiceEvent(row ? voiceFindEvent(row.dataset.event) : null);
        renderVoice();
        return;
      }
      const evRow = e.target.closest(".voice-event");
      if (!evRow) return;
      // 箭头与事件名本身就是按钮：显式处理，否则会被下面的 closest("button") 排除
      if (e.target.closest(".voice-ev-toggle") || e.target.closest(".voice-ev-name")) {
        toggleVoiceEvent(evRow.dataset.event);
        return;
      }
      const hd = e.target.closest(".voice-ev-hd");
      if (hd && !e.target.closest("button")) toggleVoiceEvent(evRow.dataset.event);
    });
    const voiceAudio = $("voiceAudio");
    if (voiceAudio) {
      voiceAudio.addEventListener("loadedmetadata", () => {
        if (!voiceIsCurrent()) return;
        const d = voiceAudio.duration;
        state.voice.play.duration = Number.isFinite(d) && d > 0 ? d : 0;
        const seek = $("voiceSeek");
        if (seek) seek.disabled = !(state.voice.play.duration > 0);
        patchVoiceProgress();
      });
      voiceAudio.addEventListener("timeupdate", () => {
        if (!voiceIsCurrent()) return;
        patchVoiceProgress();
      });
      voiceAudio.addEventListener("play", () => {
        if (!voiceIsCurrent()) return;
        state.voice.play.playing = true;
        syncVoicePlayUI();
      });
      voiceAudio.addEventListener("pause", () => {
        if (!voiceIsCurrent()) return;
        if (voiceAudio.ended) return;
        state.voice.play.playing = false;
        syncVoicePlayUI();
      });
      voiceAudio.addEventListener("ended", () => {
        if (!voiceIsCurrent()) return;
        state.voice.play.playing = false;
        patchVoiceProgress();
        syncVoicePlayUI();
      });
      voiceAudio.addEventListener("error", () => {
        if (!voiceIsCurrent()) return;
        const v = state.voice;
        v.play.playing = false;
        const msg = "播放失败：无法读取或解码 " + (v.play.audioFile || "音频");
        v.play.error = msg;
        if (v.play.id) v.lineErrors[v.play.id] = msg;
        setVoiceHint(msg, "error");
        setStatus(msg, "error");
        scheduleVoiceRefresh();
      });
    }
    const backdrop = $("backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", () => setPanelOpen(false));
    }
    $("btnRestoreAll").addEventListener("click", () => {
      state.hidden.clear();
      syncList();
      syncInspector();
      syncStageOverlays();
      render();
    });
    $("btnRestoreTexture").addEventListener("click", () => {
      setLayer("texture", true);
      setStatus("已恢复贴图层");
    });
    $$(".layers input[data-layer]").forEach((cb) => {
      cb.addEventListener("change", () => setLayer(cb.dataset.layer, cb.checked));
    });
    $("snapChk").addEventListener("change", (e) => setSnap(e.target.checked));
    $("texAlpha").addEventListener("input", (e) => setTexAlpha(e.target.value, { auto: false }));
    $("weightMode").addEventListener("change", (e) => setWeightMode(e.target.value));
    $("btnSelVisible").addEventListener("click", () => toggleHidden(state.sel));
    $("btnSelLock").addEventListener("click", () => toggleLocked(state.sel));
    $("btnLayerUp").addEventListener("click", () => moveLayer("up"));
    $("btnLayerDown").addEventListener("click", () => moveLayer("down"));
    $("btnLayerTop").addEventListener("click", () => moveLayer("top"));
    $("btnLayerBottom").addEventListener("click", () => moveLayer("bottom"));
    $("btnRestoreSlot").addEventListener("click", () => restoreSlot(state.sel));
    $("posX").addEventListener("change", () => applyInspectorNumber("x"));
    $("posY").addEventListener("change", () => applyInspectorNumber("y"));
    $("rotX").addEventListener("change", (e) => applyBoneField("rotation", e.target.value));
    $("rotRange").addEventListener("input", (e) => applyBoneField("rotation", e.target.value));
    $("scaleX").addEventListener("change", (e) => applyBoneField("scaleX", e.target.value));
    $("scaleY").addEventListener("change", (e) => applyBoneField("scaleY", e.target.value));
    $("slotSearch").addEventListener("input", (e) => {
      state.search = e.target.value;
      syncList();
    });
    $("footDiag").addEventListener("click", openDebug);
    $("debugToggle").addEventListener("click", () => setDebugOpen(!$("debug").classList.contains("open")));
    $("animSel").addEventListener("change", (e) => setAnim(e.target.value));
    $("btnPlay").addEventListener("click", togglePlay);
    $("btnSetup").addEventListener("click", () => {
      if (!state.anim) return;
      setAnim("");
      setStatus("已回到绑定姿态，可以拖动摆位");
    });
    $("btnStop").addEventListener("click", () => {
      state.playing = false;
      state.t = 0;
      syncPlayButton();
      updateTimeLabel();
      render();
    });
    $("loopChk").addEventListener("change", (e) => (state.loop = e.target.checked));
    $("speedSel").addEventListener("change", (e) => (state.speed = parseFloat(e.target.value)));
    $("scrub").addEventListener("input", (e) => {
      if (!state.animDur) return;
      state.playing = false;
      syncPlayButton();
      state.t = (state.animDur * Number(e.target.value)) / 1000;
      updateTimeLabel();
      render();
    });
    cv.addEventListener("pointerdown", onPointerDown);
    cv.addEventListener("pointermove", onPointerMove);
    cv.addEventListener("pointerup", onPointerUp);
    cv.addEventListener("pointercancel", onPointerUp);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    const stage = $("stage");
    stage.addEventListener("dragenter", (e) => {
      e.preventDefault();
      stage.classList.add("drop-target");
    });
    stage.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    stage.addEventListener("dragleave", (e) => {
      if (e.target === stage) stage.classList.remove("drop-target");
    });
    stage.addEventListener("drop", (e) => {
      e.preventDefault();
      stage.classList.remove("drop-target");
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) loadFiles(files);
    });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", () => {
      state.spaceDown = false;
      updateCursor();
    });
    window.addEventListener("resize", () => {
      syncPanel();
      render();
    });
    if (typeof ResizeObserver === "function") new ResizeObserver(() => render()).observe(stage);
  }

  function autoTextureAlpha() {
    if (!state.texAlphaAuto) return;
    state.texAlpha = overlayActive() ? 35 : 100;
    $("texAlpha").value = state.texAlpha;
    $("texAlphaV").textContent = Math.round(state.texAlpha) + "%";
  }
  function syncExprInputs() {
    const pairs = [["exBlink", "exBlinkV", "0.00"], ["exMouth", "exMouthV", "0"], ["exBrow", "exBrowV", "0"]];
    for (const p of pairs) {
      const inp = $(p[0]);
      const out = $(p[1]);
      if (inp) inp.value = 0;
      if (out) out.textContent = p[2];
    }
  }
  async function probeCapabilities() {
    state.writeState = "checking";
    syncAll();
    let cap = null;
    try {
      const res = await fetch("/api/capabilities", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = await res.json();
      if (!body || body.apiVersion !== 1 || body.saveBundle !== true) throw new Error("能力响应不匹配");
      cap = body;
    } catch (_) {
      cap = null;
    }
    state.cap = cap;
    state.writeState = cap ? "ready" : "readonly";
    syncAll();
    if (!cap) {
      setStatus("当前服务只读：可载入与另存 ZIP；用启动脚本（serve.py）可就地保存", "warn");
    }
    return !!cap;
  }

  function init() {
    /* 显式 ?voice= 锁必须在任何模型 / 语音异步之前落定（契约 §2.1，Lead 裁决 3） */
    const params = new URLSearchParams(location.search);
    const voiceParam = params.get("voice");
    if (voiceParam != null && String(voiceParam).trim()) state.voice.explicitRequest = String(voiceParam).trim();
    bindUI();
    bindMenus();
    if ($("kbdUndo")) $("kbdUndo").textContent = MOD_LABEL + "+Z";
    if ($("helpModKey")) $("helpModKey").textContent = MOD_LABEL;
    if ($("helpModSave")) $("helpModSave").textContent = MOD_LABEL;
    buildMenus();
    syncPanel();
    syncAll();
    syncExprInputs();
    updateTimeLabel();
    syncFooter();
    setStatus("未载入：选择一个 index.json，或从「文件 → 示例」开始");
    render();
    probeCapabilities();
    const indexParam = params.get("index");
    const rigParam = params.get("rig");
    if (indexParam) {
      if (rigParam) notice("warn", "同时给了 ?index= 与 ?rig=：优先使用 index，rig 参数已忽略");
      loadIndexByPath(indexParam, "url");
    } else if (rigParam) {
      loadRig(rigParam);
    }
    if (state.voice.explicitRequest) loadVoiceByPath(state.voice.explicitRequest, "explicit");
    window.__characterEditor = {
      state: state,
      core: coreInfo,
      frame: () => state.frame,
      renderer: () => (coreInfo.ready ? "core" : "none"),
      hitTest: (x, y) => hitSlot({ x: x, y: y }),
      render: render,
      fitView: fitView,
      loadRig: loadRig,
      loadIndex: loadIndexByPath,
      loadExample: loadExample,
      loadFixture: loadFixture,
      saveToDisk: saveToDisk,
      saveAsZip: saveAsZip,
      probeCapabilities: probeCapabilities,
      bundle: () => state.bundle,
      saveReason: saveReason,
      archiveReason: archiveReason,
      patchedModel: patchedModel,
      /* 事件语音（契约 §2.5，只读调试入口，非公开 API） */
      voice: voiceSnapshot,
      loadVoice: (arg) => {
        if (arg && typeof arg === "object" && typeof arg.text === "function") return loadVoiceFromFile(arg);
        if (typeof arg === "string" && arg) return loadVoiceByPath(arg, "explicit");
        return reloadVoice();
      },
      openVoice: openVoice,
      closeVoice: closeVoice,
      playVoiceLine: (eventName, id) => {
        const ev = voiceFindEvent(eventName);
        const line = ev ? (ev.lines || []).filter((l) => l.id === id)[0] : null;
        if (!line) {
          setStatus("找不到台词：" + eventName + " / " + id, "warn");
          return false;
        }
        return startVoicePlayback(ev, line);
      },
      stopVoice: stopVoice,
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
