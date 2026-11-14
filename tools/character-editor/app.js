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
  /* ---- task-33：编辑器自身版本（方案 A：只加版本号，不改任何 JSON schema） ---- */
  function editorVersion() {
    const v = typeof window !== "undefined" ? window.SpineEditorVersion : null;
    if (v && typeof v.version === "string" && v.version) return v;
    return { version: "0.0.0", label: "内置人物包管理器", builtAt: "", schemaVersion: 1, apiVersion: 1 };
  }
  /** 标题 + 帮助浮层的版本行（单一来源 version.js；缓存戳由 scripts/bump-editor-version.mjs 保持同源） */
  function syncEditorVersion() {
    const v = editorVersion();
    if (typeof document !== "undefined") {
      document.title = v.label + " " + v.version;
      /* 0.9.19：版本信息统一在「关于」模态框里展示；帮助浮层不再重复一份。
         下面两行保留空值保护，兼容 #helpVersion/#helpBuiltAt 若被外部加回的情形。 */
      const hv = el0("helpVersion");
      if (hv) hv.textContent = v.version + "（schema " + v.schemaVersion + " / api " + v.apiVersion + "）";
      const hb = el0("helpBuiltAt");
      if (hb) hb.textContent = "构建于 " + (v.builtAt || "未标注");
      syncAboutFields();
    }
    return v;
  }

  /** 「关于」模态框里的字段：全部取自 version.js，不手写任何版本号（避免与代码漂移） */
  function syncAboutFields() {
    if (typeof document === "undefined") return;
    const v = editorVersion();
    const set = (id, text) => {
      const node = el0(id);
      if (node) node.textContent = text;
    };
    set("aboutVersion", v.version || "—");
    set("aboutLabel", v.label || "内置人物包管理器");
    set("aboutMilestone", v.milestone || "—");
    set("aboutBuiltAt", v.builtAt || "未标注");
    set("aboutSchemaApi", "schema " + (v.schemaVersion == null ? "?" : v.schemaVersion) +
      " / api " + (v.apiVersion == null ? "?" : v.apiVersion));
    /* 包格式版本与编辑器版本是两套轴：这里说明清楚，避免被当成同一个版本号 */
    const lib = typeof window !== "undefined" ? window.SpineBundle : null;
    set("aboutPackFormat", lib && lib.MANIFEST_SCHEMA_VERSION != null
      ? "人物包格式 v3（manifestSchemaVersion " + lib.MANIFEST_SCHEMA_VERSION + "）"
      : "人物包格式 v3（manifestSchemaVersion 2）");
    set("aboutRuntime", typeof window !== "undefined" && window.SpineCore ? "Spine 4.2（本地 spine-core.js）" : "—");
    set("aboutClient", (typeof navigator !== "undefined" ? (navigator.userAgent || "—") : "—").slice(0, 180));
  }
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
  /* ------------------------------------------------------------------ *
   * 兜底元素（事故恢复补丁）
   *
   * 背景：本文件的部分面板（部件检查器 / 骨骼编辑 / 动画列表 / 调试面板等）
   * 在 index.html 里已被移除，但代码里仍有对这些 id 的读写。真实最终版本已删掉
   * 这些代码；此处以「缺失即空操作」的方式恢复同等行为：元素不存在则不更新、不抛错。
   * 注意：这不是新功能，只是让残留代码无害。
   * ------------------------------------------------------------------ */
  var _el0Fallback = null;
  function _mkEl0() {
    const noop = function () {};
    const box = {
      textContent: "", innerText: "", innerHTML: "", value: "", checked: false,
      disabled: false, hidden: false, className: "", title: "", id: "",
      scrollTop: 0, scrollLeft: 0, scrollHeight: 0, scrollWidth: 0,
      clientHeight: 0, clientWidth: 0, offsetHeight: 0, offsetWidth: 0,
      dataset: {}, style: {}, options: [], children: [], childNodes: [], files: [],
      classList: { add: noop, remove: noop, toggle: noop, contains: function () { return false; } },
      setAttribute: noop, removeAttribute: noop, getAttribute: function () { return null; },
      hasAttribute: function () { return false; }, addEventListener: noop, removeEventListener: noop,
      appendChild: function (x) { return x; }, removeChild: function (x) { return x; },
      insertBefore: function (x) { return x; }, replaceChild: function (x) { return x; },
      querySelector: function () { return null; }, querySelectorAll: function () { return []; },
      closest: function () { return null; }, contains: function () { return false; },
      focus: noop, blur: noop, click: noop, select: noop, scrollIntoView: noop,
      setSelectionRange: noop, play: function () { return Promise.resolve(); }, pause: noop,
      load: noop, remove: noop, after: noop, before: noop, cloneNode: function () { return _mkEl0(); },
      getBoundingClientRect: function () { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
      getContext: function () { return null; },
    };
    return box;
  }
  /** 取元素；不存在时返回无害兜底对象（见上方说明） */
  function el0(id) {
    const e = typeof id === "string" ? document.getElementById(id) : id;
    if (e) return e;
    if (!_el0Fallback) _el0Fallback = _mkEl0();
    return _el0Fallback;
  }

  const isTypingTarget = (t) => {
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return !!t.isContentEditable;
  };

  const core = window.SpineCore || null;
  const coreInfo = { ready: false, reason: core ? "未载入模型" : "spine-core.js 未加载" };

  /**
   * 版本信息。version.js（index.html 的第一个脚本）以 `window.SpineEditorVersion` 暴露
   * version / label / builtAt / schemaVersion / apiVersion；这里统一取用并对缺失给出安全默认，
   * 避免在版本脚本未加载时把标题拼成 "undefined"。
   *
   * 说明：此函数在 app.js 事故中随未提交改动丢失（会话日志里只留下了对它的调用），
   * 现按调用点用到的字段（version / label / schemaVersion / apiVersion / builtAt）
   * 与 version.js 的字段说明忠实重建。
   */
  function editorVersion() {
    const v = (typeof window !== "undefined" && window.SpineEditorVersion) || null;
    return {
      version: (v && v.version) || "0.0.0",
      label: (v && v.label) || "内置人物包管理器",
      builtAt: (v && v.builtAt) || "",
      schemaVersion: v && v.schemaVersion != null ? v.schemaVersion : 1,
      apiVersion: v && v.apiVersion != null ? v.apiVersion : 1,
      milestone: (v && v.milestone) || "",
    };
  }

  /* ==========================================================================
   * 1. 状态
   * ====================================================================== */
  /* ------------------------------------------------------------------ *
   * 动画名的显示层翻译（0.9.104–0.9.106）
   *
   * 契约（CHANGELOG 0.9.104–0.9.106 原文）：
   *   · 只翻译「给人看的字符串」；`state.anim`、model.json 的动画键、
   *     `animSelect(name)` 参数、保存/undo/关键帧轨道**全部保持英文 id**；
   *   · 表里没有的原样返回（避免出现空标签）。
   *
   * 说明：本函数在 app.js 事故中随未提交改动丢失（日志里只留下了对它的调用与文档描述），
   * 现按上述契约重建；`__gaze_follow__` 是内部虚拟动画 id（界面显示中文）。
   * ------------------------------------------------------------------ */
  const ANIM_LABELS = {
    idle: "待机",
    blink: "眨眼",
    idle_face: "面部待机",
    expression_swap: "表情切换",
    gaze_grid_preview: "视线网格预览",
    alert: "警觉",
    greeting: "打招呼",
    interact: "互动",
    happy: "开心",
    sad: "难过",
    shy: "害羞",
    pout: "鼓嘴",
    proud: "得意",
    sleepy: "困倦",
    surprised: "惊讶",
    thinking: "思考",
    wake: "醒来",
    working: "工作",
    talk_generic: "通用说话",
    wave: "挥手",
    tail_wag: "摆尾",
    /* 虚拟条目（内部 id 是 __gaze_follow__，界面显示中文） */
    __gaze_follow__: "眼珠跟随鼠标",
  };
  /** 英文动画名 → 中文显示名；表里没有的原样返回（避免出现空标签）。 */
  function animLabel(name) {
    if (typeof name !== "string" || !name) return "";
    return Object.prototype.hasOwnProperty.call(ANIM_LABELS, name) ? ANIM_LABELS[name] : name;
  }

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
    redo: [],
    initial: null,

    /* 眼珠跟随鼠标（0.9.85）：编辑器内的**虚拟动画**，不写 model.json、不进 undo / dirty。
     *   active   = 是否正在跟随（点播放开始、暂停后保持、换动画复位）
     *   dx, dy   = 当前世界单位偏移（相对 eye-L / eye-R 的 setup 位置）
     *   eyes     = 参与跟随的骨名（默认 eye-L / eye-R）
     * 求值侧在 evalCurrentPose 里叠加进 edits.bones，与 transient 完全独立 ——
     * 否则会触发「有未打键改动」守卫并污染 dirty。 */
    gaze: {
      active: false,
      dx: 0,
      dy: 0,
      eyes: ["eye-L", "eye-R"],
      anchor: null,
    },

    /* 骨骼编辑（契约 editor-p0-contract.md §2；T6 批次 1）
     *   mode   'setup'   = 改绑定姿态：写 boneList → 同步 model.bones（有效 Setup），保存写 model.bones
     *          'animate' = 改当前动画：绝不写 boneList；未打键值只活在 transient，预览经 edits.bones 叠加
     *   target 'bone' | 'attachment'：决定画布拾取对象、检查器面板与拖动写入目标
     *   selBone 骨**名**（契约 §2 裁定，不是索引）；state.sel 仍是选中部件 slot 索引，两者独立
     *   transient = 未打键的绝对 local 覆盖 {animation, time, bones:{name:PartialLocal}, fields:{name:[...]}}
     */
    edit: {
      mode: "animate",
      target: "bone",
      tool: "translate",
      space: "parent",
      previewSetup: false,
      autoKey: true,
      selBone: null,
      selAttachment: null,
      transient: null,
      attachmentPatches: [],
      /* P2-05/P2-06（task-28）：镜像暂存 / 两骨 IK / 骨架结构面板 */
      pendingMirror: null,
      ik: { on: false, mix: 1, lastReason: "", chain: null },
      skelLast: null,
      simpleKeyTime: null,   /* 简单时间条当前选中的位置关键帧时刻（只读视图态，不进快照/dirty） */
      /* P2-03 轴心补偿（仅 Setup）：运行期态，**不持久化**；切到动画模式 / 重载模型时保守复位为关。
       * lastPivot = 最近一次补偿结果摘要（检查器展示「哪些子骨被补偿」）。 */
      pivotCompensate: false,
      lastPivot: null,
      /* P2-04 纯显示层（绝不进保存）：洋葱皮 / 运动轨迹。开关与参数持久化在偏好 display 段。 */
      onion: {
        on: false,
        before: 1,
        after: 1,
        step: 1,
        drawn: 0,
        lastCostMs: 0,
        overflow: 0,
      },
      trail: { on: false, boneName: null, samples: 0, points: 0, costMs: 0, cached: false, at: 0 },
      timeline: {
        expanded: false,
        height: 280,
        pxPerSec: 100,
        scrollSec: 0,
        fps: 30,
        snapFrames: false,
        selectedKey: null,
        previewRangeByAnim: {},
        /* P1-01/P1-04（契约 §6/§8）：子轨道管理与 Graph 视图状态（内存态，T21 再接持久化） */
        tab: "dopesheet",
        graphRowKey: null,
        graphComponent: 0,
        search: "",
        onlyKeyed: false,
        lockedRows: [],
        hiddenRows: [],
        /* P2-01/02（task-27）：额外轨道（事件/绘制顺序/形变/ik/transform/path）UI 状态。
         * extraRowKey = 当前选中的额外行；extraForm = 面板表单草稿（不写文档，提交才走 track-edit）；
         * lastTrackEdit = 最近一次经 SpineTrackEdit 的写入摘要（检查器/调试可见）。 */
        extraRowKey: null,
        extraForm: null,
        lastTrackEdit: null,
        /* §14 P4：帧缩略图（纯显示，不写模型）。抽稀与布局在 frame-thumbs.js。 */
        showThumbs: false,
        thumbSize: 44,
        thumbDrawn: 0,
        /* §14 P4：音频波形（纯显示）。包络在 audio-wave.js，解码在 app.js。 */
        showWave: false,
        waveDrawn: 0,
        /* §3.3 帧选择工具：frameSelect（拖出帧范围）| frameBox（框选帧+轨道） */
        frameTool: "frameSelect",
      },
    },

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
    /* 0.9.52：进入拖拽模式前用的是哪个工具（"move" | "select"）。
       退出拖拽时还原到它 —— 不能固定回「移动」，否则会把用户的「选择」意图冲掉。 */
    toolBeforePan: null,
    helpOpen: false,
    /* 0.9.21：画布重绘计数（只增，调试快照暴露；用于「操作后是否真的重绘」的回归断言） */
    renderCount: 0,

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

    /* 显示顺序：PS 风格图层组（分组来自 rig-meta.slotGroups；无 meta 时平铺） */
    slotGroup: {
      collapsed: new Set(),
      groups: [],
      source: "none", // none | meta | invalid
      reason: "",
      metaKey: "",
      warned: false,
    },

    /* task-13：本地目录模式（方案 A）。
       null = 无本地树，所有读取走 fetch；Map = 本地模式，读取先查树。
       tree 的 key 是「相对 localRoot 的包内路径」（如 manifest.json / spine/model.json）。 */
    localTree: null,
    localRoot: null,        // 本地包根（相对路径，如 "deepseek"）；同时用作 observedBase
    localEntry: null,       // 入口文件名：manifest.json 或 index.json
    localCount: 0,          // 树里文件数
    localUrls: null,        // 音频 blob URL 缓存（避免重复创建与泄漏）

    /* 本地项目（文件菜单「本地项目」分组）：GET /api/packs 的缓存。
       null = 还没扫过；{packs:[], error:null|string} = 上一次结果（失败时保留旧 packs）。 */
    localPacks: null,
    localPacksBusy: false,

    /* 表情分页：差分试装（纯预览覆盖，不写模型 / 不进 dirty / 不参与保存） */
    expr: {
      open: false,
      /** slotName -> attachmentName | null（null = 该槽不显示附件） */
      override: Object.create(null),
      metaState: "idle", // idle | loading | ready | absent | error
      meta: null,
      metaError: "",
      metaUrl: "",
      set: null, // 最近应用的命名套装（= 当前预览「完全是」该事件的原值；一旦微调就置 null）
      /**
       * 0.9.27：**保存目标事件**，与上面的 `set` 是两件事。
       *
       *   set        = 「当前预览是不是某个事件的原封值」→ 微调后必然失效；
       *   saveTarget = 「你打算把预览写回哪个事件」→ 微调**不清除**。
       *
       * 为什么不复用 set：手动改一个槽时 applyExprAttachment 会把 set 置 null
       * （语义正确），但保存条也读 set 当目标 → 一精调就丢目标，
       * 而「选事件 → 精调 → 保存」正是这个功能的核心用法。
       * 只有换包 / 重置 / 显式换目标时才改 saveTarget。
       */
      saveTarget: null,
      mode: "normal", // normal | whole（眼睛互斥模式）
      warnings: [],
      loadGen: 0,
      /* v3.1 catalog（§5b）：权威索引。表情页的合法值与眨眼档位只认它；
         v2 旧包没有 catalog，此时保持原行为（从 model 附件推断）。 */
      catalogState: "idle", // idle | loading | ready | absent | error
      catalog: null,
      catalogError: "",
      catalogUrl: "",
      catalogStale: false, // C13：rigSha256 不符 → true（仍加载，不阻断）
      catGen: 0,
    },

    /* 动画页：时间线编辑草稿（只保存显式编辑过的动画） */
    animEdit: {
    /* 包内 spine/lipsync.json 的缓存（口型运行时包络，见 lipsync-pack 模块） */
    lipsync: null,
      drafts: Object.create(null), // animName -> 编辑后的原始动画对象（完整、保留未知字段）
      applied: Object.create(null), // animName -> undefined（已被 /api/save-bundle 落盘的草稿）
      /* P2-04：草稿修订号。运动轨迹的采样缓存按它失效（轨迹是纯显示，不能拖慢播放） */
      rev: 0,
      sel: "",
      durInput: null, // null = 跟随当前动画时长
      dirty: false,
      live: true,
      open: false,
      expanded: new Set(), // "bones:X" / "slots:Y" / "stop:bone:field"
    },
  };

  const cv = el0("cv");
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
    /* P2-06（task-28）：结构修订基线 = 本次载入的 raw（撤销结构变更靠它恢复） */
    state.skelRev = 0;
    state.skelHistory = [JSON.parse(JSON.stringify(state.raw))];

    state.sel = -1;
    state.hover = -1;
    /* P2-03/P2-04：重载模型 = 保守复位（轴心补偿关、轨迹缓存清空；显示开关由偏好恢复） */
    state.edit.pivotCompensate = false;
    state.edit.lastPivot = null;
    invalidateTrailCache();
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
    /* P1（T21）：载入模型后恢复偏好（布局全局保留；行配置按骨架签名隔离；清选择/草稿） */
    if (typeof applyPrefsToState === "function") {
      try {
        applyPrefsToState();
      } catch (e) {
        state.prefsError = "恢复布局失败：" + (e && e.message ? e.message : "错误");
      }
      if (state.prefsError) notice("warn", "偏好：" + state.prefsError);
    }
    fitView("all");
    setStatus(
      "已载入 " + state.slots.length + " 部件 / " + state.boneList.length + " 骨骼 · " + state.label +
      (isLocalMode() ? " · 本地目录：" + state.localRoot + "（" + state.localCount + " 个文件）" : "")
    );
    /* task-36：记「上次打开的包」与「上次的动画」（只在成功载入后；浏览器文件无路径 → null） */
    if (typeof state.ui === "object" && state.ui) {
      const base = state.bundle && typeof state.bundle.base === "string" ? state.bundle.base.replace(/\/+$/, "") : "";
      /* v3.2：入口可能是 manifest.json；用 bundle 记录的真实入口名，不要写死 index.json */
      const entryFile = (state.bundle && state.bundle.entryName) || INDEX_NAME;
      state.ui.lastPackIndexPath = base ? base + "/" + entryFile : null;
      const savedClip = base && state.ui.lastClipByPack ? state.ui.lastClipByPack[base] : null;
      if (savedClip && state.model && state.model.animations.has(savedClip)) setAnim(savedClip);
      if (typeof savePrefs === "function") savePrefs();
    }
    render();
    syncChrome();
    onModelChanged();
    return true;
  }

  /* --- 载入：统一索引流水线（契约 §2.1） ---------------------------------- */
  const INDEX_NAME = "index.json";
  const MANIFEST_NAME = "manifest.json";
  /** v3.2 起入口是包根 manifest.json；示例路径同步入口名（包目录不变） */
  const EXAMPLE_INDEX = "assets/characters/deepseek/manifest.json";
  const LEGACY_INDEX = "assets/characters/deepseek/legacy-views/manifest.json";

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

  /** 本地模式下把「URL」映射成文件树里的 key；找不到返回 null。
   *  URL 形如 "/deepseek/spine/model.json"，localRoot 是 "deepseek"，
   *  去掉前缀后正好是 "spine/model.json"。 */
  function localLookupUrl(url) {
    if (!state.localTree) return null;
    const lib = window.SpineBundle;
    if (!lib || typeof lib.localTreeLookup !== "function") return null;
    let rel = String(url == null ? "" : url).replace(/^\/+/, "");
    if (state.localRoot && rel.startsWith(state.localRoot + "/")) {
      rel = rel.slice(state.localRoot.length + 1);
    }
    return lib.localTreeLookup(state.localTree, rel);
  }

  async function fetchBytes(url) {
    /* 本地目录模式：先查树，命中即返回，不发请求 */
    if (state.localTree) {
      const hit = localLookupUrl(url);
      if (hit) {
        const buf = await hit.arrayBuffer();
        return new Uint8Array(buf);
      }
      throw new LoadError(
        "本地目录里缺少 " + String(url).replace(/^\/+/, "") + "（本地目录载入）",
        "请确认选中的是完整人物包目录"
      );
    }
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
    /* 保留实际 schemaVersion（v3 / v3.2 包是 2）；下游 spineDir() 靠它判断包根 vs spine 目录 */
    const sv = org && (org.schemaVersion === 2 || org.schemaVersion === 1) ? org.schemaVersion : 1;
    const out = { schemaVersion: sv, base: base };
    if (org && typeof org.label === "string") out.label = org.label;
    out.files = { model: org.files.model, atlas: org.files.atlas, textures: org.files.textures.slice() };
    /* v3 追加槽位原样带出，供 rig-meta / idle-profile / lipsync 定位 */
    if (sv === 2) {
      for (const extra of ["rigMeta", "idleProfile", "lipsync"]) {
        if (org && typeof org.files[extra] === "string" && org.files[extra]) out.files[extra] = org.files[extra];
      }
    }
    /* v3.2：manifest 入口的额外信息原样保留（catalog / events / spine 段） */
    if (org && org.entryKind === "manifest") {
      out.entryKind = "manifest";
      out.manifestSchemaVersion = org.manifestSchemaVersion;
      if (org.spine) out.spine = org.spine;
      if (org.catalog) out.catalog = org.catalog;
      if (org.events) out.events = org.events;
    }
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
      /* 文本入口由 parseIndexText 内部探测 manifest；对象入口在这里补一次同样的探测 */
      let validated;
      if (typeof indexSource === "string") {
        validated = lib.parseIndexText(indexSource, { requireBase: o.requireBase !== false });
      } else if (lib.looksLikeManifest && lib.looksLikeManifest(indexSource)) {
        validated = lib.validateManifest(indexSource, { requireBase: o.requireBase !== false });
      } else {
        validated = lib.validateIndex(indexSource, { requireBase: o.requireBase !== false });
      }
      if (!validated.ok) throw issuesToError(validated.issues, "索引校验失败：");
      const norm = validated.value;

      const loc = lib.resolveIndexLocation(norm, o.observedBase == null ? null : o.observedBase);
      if (!loc.ok) throw issuesToError(loc.issues, "索引定位失败：");
      const base = loc.value.base;

      /* v3.2 入口是 manifest.json：spine 资源在 manifest.spine.*；归一化里同时投影到 files */
      const spineFiles = norm.spine || norm.files;
      const entryName = loc.value.entryName || (norm.entryKind === "manifest" ? "manifest.json" : "index.json");
      setStatus("载入" + (norm.entryKind === "manifest" ? " manifest" : "索引") + "：" + base + " …");
      const modelUrl = "/" + base + "/" + spineFiles.model;
      const atlasUrl = "/" + base + "/" + spineFiles.atlas;
      const fetched = await Promise.all([fetchBytes(modelUrl), fetchBytes(atlasUrl)]);
      if (gen !== state.loadGen) return false;
      const modelBytes = fetched[0];
      const atlasBytes = fetched[1];

      const modelText = decodeUtf8(modelBytes, spineFiles.model);
      const atlasText = decodeUtf8(atlasBytes, spineFiles.atlas);
      let raw;
      try {
        raw = JSON.parse(modelText);
      } catch (e) {
        throw new LoadError(spineFiles.model + " 不是合法 JSON", e && e.message);
      }
      const parsed = parseBundle(raw, atlasText);

      const pages = lib.validateTexturePages(norm, parsed.atlas.pages);
      if (!pages.ok) throw issuesToError(pages.issues, "贴图清单不一致：");

      const textureBytesByName = Object.create(null);
      const pageImages = [];
      /* 贴图 URL 必须用**索引里的路径**（v3 是 spine/model.png 这种包根相对完整路径），
         不能直接用 atlas 里的裸页名（model.png），否则 v3 会拼成 <包根>/model.png → 404。
         v2 索引里的值本来就是裸文件名，行为不变。 */
      const texPaths = spineFiles.textures.slice();
      for (let pi = 0; pi < parsed.atlas.pages.length; pi++) {
        const page = parsed.atlas.pages[pi];
        const relPath = texPaths[pi] || page.name;
        const bytes = await fetchBytes("/" + base + "/" + relPath);
        if (gen !== state.loadGen) return false;
        textureBytesByName[page.name] = bytes;
        pageImages.push(await loadImageFromBytes(bytes, relPath));
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
          indexPath: loc.value.indexPath || base + "/" + entryName,
          entryName: entryName,
          entryKind: norm.entryKind || "index",
          index: index,
          indexBytes: textBytes(lib.serializeIndex(index)),
          modelName: spineFiles.model,
          atlasName: spineFiles.atlas,
          textureNames: spineFiles.textures.slice(),
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

  /** 「载入文件…」入口：优先弹目录选择器（v3.2 的包根相对路径需要整个目录） */
  function pickPackSource() {
    const dirInput = el0("filesDir");
    if (dirInput) {
      dirInput.click();
      return;
    }
    /* 浏览器不支持 webkitdirectory：退回单文件选择并说明 */
    notice("warn", "这个浏览器不支持选择目录，只能选单个 manifest.json；请改用 ?index=<包>/manifest.json 打开");
    const single = el0("files");
    if (single) single.click();
  }

  /** 清空本地目录模式（载入失败或切回 server 模式时必调，避免污染后续读取） */
  function clearLocalTree(reason) {
    if (state.localUrls) {
      for (const u of state.localUrls.values()) {
        try { URL.revokeObjectURL(u); } catch (_) { /* 忽略 */ }
      }
    }
    state.localTree = null;
    state.localRoot = null;
    state.localEntry = null;
    state.localCount = 0;
    state.localUrls = null;
  }

  /** 按扩展名给本地文件一个明确 MIME（不依赖 OS 关联，音频才能解码） */
  function localMimeFor(relPath) {
    const p = String(relPath || "").toLowerCase();
    if (p.endsWith(".ogg") || p.endsWith(".opus")) return "audio/ogg";
    if (p.endsWith(".mp3")) return "audio/mpeg";
    if (p.endsWith(".wav")) return "audio/wav";
    if (p.endsWith(".png")) return "image/png";
    if (p.endsWith(".webp")) return "image/webp";
    if (p.endsWith(".json")) return "application/json";
    if (p.endsWith(".atlas")) return "text/plain";
    return "";
  }

  /** 本地模式下取某个包内路径的 blob: URL（音频播放用）；带缓存避免重复创建 */
  function localObjectUrl(relPath) {
    if (!state.localTree) return null;
    const lib = window.SpineBundle;
    if (!lib || typeof lib.localTreeLookup !== "function") return null;
    const key = lib.normalizeLocalPath(relPath);
    const hit = lib.localTreeLookup(state.localTree, key);
    if (!hit) return null;
    if (!state.localUrls) state.localUrls = new Map();
    if (state.localUrls.has(key)) return state.localUrls.get(key);
    let url = null;
    try {
      /* 显式 MIME：File.type 可能为空或 octet-stream，<audio> 会拒绝解码 */
      const mime = localMimeFor(key);
      const blob = mime ? new Blob([hit], { type: mime }) : hit;
      url = URL.createObjectURL(blob);
    } catch (_) {
      url = null;
    }
    if (url) state.localUrls.set(key, url);
    return url;
  }

  const isLocalMode = () => !!state.localTree;

  /**
   * 目录选择：把整个包目录读进来（方案 A）。
   * 顺序：构建文件树 → 找根入口（manifest.json 优先）→ 设 localTree → 读入口文本 → 走同一条载入流水线。
   */
  async function loadDirFiles(fileList) {
    const lib = window.SpineBundle;
    if (!lib || typeof lib.buildLocalTree !== "function") {
      return reportLoadError(new LoadError("bundle.js 未加载，无法解析目录"));
    }
    if (!(await simpleUnsavedGuard("打开另一个包"))) return false;

    const built = lib.buildLocalTree(fileList);
    if (!built || !built.count) {
      return reportLoadError(
        new LoadError("这个目录里没有可用的文件", "请选择人物包目录（应包含 manifest.json）")
      );
    }
    /* manifest.json 优先；没有则退回 index.json（旧包，会给出旧格式提示） */
    const pick = built.roots.find((r) => r.entry === MANIFEST_NAME) || built.roots[0] || null;
    const root = pick ? pick.root : built.root;
    const entry = pick ? pick.entry : null;
    if (!root || !entry) {
      return reportLoadError(
        new LoadError("目录里找不到 manifest.json（或 index.json）",
          "已读取 " + built.count + " 个文件；请选中人物包目录本身")
      );
    }

    /* 先临时设树，让入口本身能被 fetchBytes 读到；失败则清干净 */
    state.localTree = built.tree;
    state.localRoot = root;
    state.localEntry = entry;
    state.localCount = built.count;
    if (state.localUrls) {
      for (const u of state.localUrls.values()) {
        try { URL.revokeObjectURL(u); } catch (_) { /* 忽略 */ }
      }
    }
    state.localUrls = new Map();

    let text = null;
    try {
      const bytes = await fetchBytes("/" + root + "/" + entry);
      text = decodeUtf8(bytes, entry);
    } catch (e) {
      clearLocalTree();
      return reportLoadError(e instanceof LoadError ? e : new LoadError(String((e && e.message) || e)));
    }

    const ok = await loadIndexEntry(text, {
      entry: "dir",
      requireBase: false,
      observedBase: root,
      retry: () => el0("filesDir").click(),
    });
    if (!ok) clearLocalTree();          /* Lead 点名的坑 1：失败必须清树 */
    else refreshLocalModeUI();
    return ok;
  }

  /** 本地模式下的 UI 同步：状态栏文案 + 保存可用性 */
  function refreshLocalModeUI() {
    if (!isLocalMode()) return;
    if (state.bundle) state.bundle.canSave = false;
    if (state.bundle && !state.bundle.reason) {
      state.bundle.reason = "本地目录载入：没有写回服务，无法就地保存；可用「另存 ZIP」导出";
    }
    syncToolbar();
  }

  /** picker / 拖入：只接受一个 index.json（契约 §2.2） */
  async function loadFiles(fileList) {
    /* task-37：简单模式下有未保存改动时先确认（与深链同一条路径） */
    if (!(await simpleUnsavedGuard("打开另一个包"))) return false;
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return false;
    const retry = () => el0("files").click();
    if (files.length > 1) {
      return reportLoadError(new LoadError("请选择一个 manifest.json（v3.2）或 index.json（旧）；模型、图集和贴图由它读取", "本次选了 " + files.length + " 个文件"));
    }
    const file = files[0];
    const ENTRY_OK = [MANIFEST_NAME, INDEX_NAME];
    if (!/\.json$/i.test(file.name) || ENTRY_OK.indexOf(file.name) < 0) {
      return reportLoadError(
        new LoadError("请选择一个 manifest.json（v3.2）或 index.json（旧）；模型、图集和贴图由它读取",
          "实际文件名：" + file.name),
        "重新选择",
        retry
      );
    }
    /* v3.2 manifest 的路径都是包根相对，而文件选择器拿不到包根 →
       必须走 ?index= 才能定位包内其它文件。这里给明确指引，不让它静默失败。
       注意：拖入走的是 dataTransfer.files，浏览器只给**文件**、不给目录结构
       （本编辑器没有 webkitGetAsEntry 递归），所以这里**不能**承诺「拖整个目录」；
       要整包离线读取，唯一入口是「载入文件…」的目录选择器。 */
    if (file.name === MANIFEST_NAME) {
      return reportLoadError(
        new LoadError("单个 manifest.json 无法定位包内资源；请改用「载入文件…」选择整个包目录",
          "或改用 ?index=<包>/manifest.json；「载入路径」也能直接填包目录"),
        "选目录",
        () => pickPackSource()
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
    /* task-37 缺陷 3：简单模式下有未保存改动时先走页内四选一 */
    if (!(await simpleUnsavedGuard("打开另一个包"))) return false;
    /* 走 URL 是 server 语义：先退出本地目录模式（否则会拿本地树去满足 fetch） */
    if (isLocalMode()) clearLocalTree();
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

  /* ==========================================================================
   * 载入路径：服务端起好后，填仓库相对路径由编辑器自己 fetch（不是上传文件）
   * 与「选包目录」是两条独立入口：
   *   载入路径 → server 语义（fetch 全链路，保存可用）
   *   选包目录 → 本地语义（把整个目录读进内存，离线可用，保存禁用）
   * ====================================================================== */

  /** 把用户输入的路径规范成「可交给 loadIndexByPath 的入口路径」。
   *
   *  实现已下移到 bundle.js（纯函数、可被 Node 自测覆盖）；这里只做委托，
   *  bundle.js 未加载时退化为一条明确错误，不静默放行。
   */
  function normalizePackPath(raw) {
    const lib = window.SpineBundle;
    if (!lib || typeof lib.normalizePackPath !== "function") {
      return { ok: false, reason: "bundle.js 未加载，无法解析路径" };
    }
    return lib.normalizePackPath(raw);
  }

  /** 「载入路径」按钮/回车：读输入 → 规范化 → 走 fetch 链路 */
  async function loadPackPathFromInput() {
    const inp = el0("packPathInput");
    if (!inp) return false;
    const norm = normalizePackPath(inp.value);
    const hint = el0("packPathHint");
    const baseHint = "仓库相对路径；填包目录会自动补 manifest.json。需要已起本地服务（start.bat）。";
    if (!norm.ok) {
      inp.classList.add("is-bad");
      if (hint) hint.textContent = norm.reason;
      setStatus("载入路径无效：" + norm.reason, "warn");
      return false;
    }
    inp.classList.remove("is-bad");
    if (hint) hint.textContent = baseHint;
    const ok = await loadIndexByPath(norm.value, "path");
    if (ok) {
      /* 成功后把规范后的值写回输入框，避免下次又手打错 */
      inp.value = norm.value;
      try { state.prefs.packPath = norm.value; } catch (_) { /* 忽略 */ }
    }
    return ok;
  }

  /** 示例包在发布区（assets/characters/），本地目录模式下没有可 fetch 的地址 */
  function exampleBlockedByLocal() {    if (!isLocalMode()) return false;
    notice(
      "warn",
      "本地目录模式下无法打开示例包（示例来自发布区，需要 server）；请先回到 server 模式（?index=），或继续使用当前本地包"
    );
    setStatus("本地目录模式：示例包需要 server，已忽略");
    return true;
  }

  function loadExample() {
    if (exampleBlockedByLocal()) return false;
    return loadIndexByPath(EXAMPLE_INDEX, "example");
  }

  function loadLegacyExample() {
    if (exampleBlockedByLocal()) return false;
    return loadIndexByPath(LEGACY_INDEX, "example");
  }

  /* ==========================================================================
   * 本地项目：文件菜单里的一个分组（标题 + 被扫到的包各占一条）
   *   · 不是弹窗，也不是单个「本地项目…」菜单项；
   *   · 数据来自只读 GET /api/packs（扫 workspace/packs 一层）；
   *   · 点一条包 = 用相对路径走已有 loadIndexByPath（server 语义，可保存）。
   * ====================================================================== */

  /** 把字节数说成人话（菜单里只给概览，不铺满细节） */
  function humanBytes(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return "—";
    if (v < 1024) return v + " B";
    if (v < 1024 * 1024) return (v / 1024).toFixed(0) + " KB";
    if (v < 1024 * 1024 * 1024) return (v / (1024 * 1024)).toFixed(1) + " MB";
    return (v / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  /** 文件菜单里「本地项目」那一组的容器（buildFileMenu 每次重建时重新挂） */
  function menuPacksBox() {
    return el0("menuFilePacks");
  }

  /** 一条包 = 一个菜单项；label 是包名+版本，note 是相对路径（菜单说明已强制单行） */
  function packMenuItem(meta) {
    const bad = !meta.ok || (Array.isArray(meta.issues) && meta.issues.length > 0);
    const facts = [];
    if (meta.animCount != null) facts.push(meta.animCount + " 动画");
    if (meta.slotCount != null) facts.push(meta.slotCount + " 槽");
    const label = (meta.label || meta.dirName || meta.path || "(未命名)") +
      (meta.version ? "  v" + meta.version : "") + (bad ? "  ⚠" : "");
    const tip = bad
      ? (Array.isArray(meta.issues) && meta.issues.length ? meta.issues.join("；") : "该包不可用")
      : "载入 " + (meta.path || "") + "/manifest.json" +
        (facts.length ? "（" + facts.join(" / ") + "）" : "");
    return menuItem("pack-" + (meta.path || meta.dirName), {
      label: label,
      icon: bad ? "alert" : "open",
      note: meta.path || "—",
      title: tip,
      disabled: !meta.ok,
      onClick: () => onPickPack(meta),
    });
  }

  /** 把缓存渲染进菜单（同步、不 await）；扫描中 / 失败 / 空各有文案 */
  function renderLocalPacks() {
    const box = menuPacksBox();
    if (!box) return;
    box.textContent = "";
    const s = state.localPacks;
    if (!s) {
      box.appendChild(el("div", "menu-packs-note", "扫描中…"));
      return;
    }
    if (s.error) {
      box.appendChild(el("div", "menu-packs-note", s.error));
      return;
    }
    const packs = Array.isArray(s.packs) ? s.packs : [];
    if (!packs.length) {
      box.appendChild(el("div", "menu-packs-note", "workspace/packs 下没有人物包"));
      return;
    }
    for (const meta of packs) box.appendChild(packMenuItem(meta));
  }

  /** 拉一次列表并写回缓存；不弹窗，失败也只在菜单里给一行原因 */
  async function refreshLocalPacks() {
    const keep = Array.isArray(state.localPacks && state.localPacks.packs) ? state.localPacks.packs : [];
    let res = null;
    try {
      res = await fetch("/api/packs", { cache: "no-store" });
    } catch (_) {
      res = null;
    }
    if (!res || !res.ok) {
      state.localPacks = {
        packs: keep,
        error: res ? "读不到本地项目（服务返回 " + res.status + "）" : "读不到本地项目（未连上本地服务）",
      };
      renderLocalPacks();
      return state.localPacks;
    }
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!data || data.ok !== true) {
      state.localPacks = {
        packs: keep,
        error: (data && data.error && data.error.message) || "扫描失败",
      };
      renderLocalPacks();
      return state.localPacks;
    }
    state.localPacks = { packs: Array.isArray(data.packs) ? data.packs : [], error: null, root: data.root };
    renderLocalPacks();
    return state.localPacks;
  }

  /** 点一条包：用相对路径走已有载入链路（不新增第二套载入逻辑） */
  async function onPickPack(meta) {
    if (!meta || !meta.ok || !meta.path) return false;
    closeMenus();
    const entryPath = meta.path + "/" + (meta.entry || "manifest.json");
    return loadIndexByPath(entryPath, "pack");
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
          res = await voiceFetchWithTimeout(cand, {}, 6000);
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
          reason: "已载入但无写回目标，且缺少可导出的原始文件字节；请选择 manifest.json",
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
    /* 载入失败是诊断信息：原样显示，不让人话改写把根因吞掉 */
    setStatus("载入失败：" + message + kept, "error", { verbatim: true });
    notice("error", "载入失败：" + message + detail + kept,
      actionLabel && actionFn ? [{ label: actionLabel, onClick: actionFn }] : [], { verbatim: true });
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
    /* T6/T7（契约 §2）：求值按模式分流 ——
     *   Setup：「绑定姿态」= 不求值任何动画（animation:null, time:0），只用有效 Setup（boneList→model.bones）。
     *          否则 Setup 下的 world 会带上动画旋转，导致 gizmo 的父级换算出现伪父旋转（Lead E2E 缺陷）。
     *   Animate：求值当前动画 + 未打键 transient；previewSetup 时临时只预览绑定姿态。
     * evalPose 的 edits.bones 只服务 Animate 的 transient（绝对 local 覆盖）。 */
    if (editMode() === "setup" && state.model) syncEffectiveSetupBones();
    const animate = editMode() === "animate" && !state.edit.previewSetup;
    const opts = {
      animation: animate ? state.anim || null : null,
      time: animate ? state.t : 0,
      skin: "default",
    };
    const edits = animate ? transientEdits() : null;
    if (edits && edits.size) opts.edits = { bones: edits };
    /* 附件覆盖：表情试装 + 附件目标补丁（补丁优先，因为它是文档级编辑） */
    const exprOv = exprOverrideMap();
    const attOv = attachmentOverrideMap();
    let merged = null;
    if (exprOv) {
      merged = new Map();
      exprOv.forEach((v, k) => merged.set(k, v));
    }
    if (attOv) {
      if (!merged) merged = new Map();
      attOv.forEach((v, k) => merged.set(k, v));
    }
    /* 眼珠跟随（0.9.89 分层版）：跟随时把眼睛拆成「眼白(sclera，挂 head 固定) + 虹膜(iris，挂 eye 骨可动)」。
       判据是「跟随激活」而不是「有没有偏移」—— 分层必须一直在，否则一暂停眼白就消失。
       偏移是否复位由 state.gaze.dx/dy 决定（暂停时保留、换动画归零）。
       注意必须放在 merged 声明之后（否则 TDZ 报错，node --check 查不出来）。 */
    if (animate && gazeActive()) {
      const gLayer = gazeLayerOverrides();
      if (gLayer) {
        if (!merged) merged = new Map();
        for (const [si, name] of gLayer) merged.set(si, name);
      }
      /* 虹膜层挂在 eye-L / eye-R 上，移骨即移动虹膜（眼白在 head 上不受影响）。 */
      if (gazeOffsetNonZero()) {
        const gBone = gazeBoneEdits();
        if (gBone) {
          if (!opts.edits) opts.edits = { bones: new Map() };
          if (!opts.edits.bones) opts.edits.bones = new Map();
          for (const [bn, v] of gBone) opts.edits.bones.set(bn, v);
        }
      }
    }
    if (merged) opts.attachmentOverrides = merged;
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
    /* 0.9.16：顶部缩放组已移除（缩放百分比只在左侧工具条/快捷键侧体现），
       这里必须空值保护——原来直接写 #zoomLabel 会在元素缺失时抛 TypeError，
       打断整个 syncToolbar() 链路。 */
    const label = el0("zoomLabel");
    if (label) label.textContent = state.model ? Math.round(state.zoom * 100) + "%" : "—";
  }
  function fitView(mode) {
    if (!state.model) return;
    const frame = state.frame || framePose();
    let items = frame.geo;
    if (mode === "sel" && editTarget() === "bone" && state.edit.selBone) {
      /* 骨骼目标下「适配选中」以选中骨为准：把它驱动的附件全部收进来 */
      const entry = boneEntry(state.edit.selBone);
      const driven = new Set();
      if (entry && state.model) {
        for (const s of state.slots) if (s.boneIndex === entry.index) driven.add(s.index);
        for (const it of frame.geo) {
          const att = attachmentAt(frame.pose, it.slotIndex);
          if (!att) continue;
          if (att.weighted && att.influences) {
            for (const list of att.influences) {
              for (const inf of list) {
                if (inf.boneIndex === entry.index) driven.add(it.slotIndex);
              }
            }
          }
        }
      }
      const one = items.filter((it) => driven.has(it.slotIndex));
      if (one.length) items = one;
    } else if (mode === "sel" && state.sel >= 0) {
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
    /* 0.9.21：只增计数，供调试快照 / 回归断言判断「某次操作后画布是否真的重绘过」。
       不参与任何业务判断，也不会被重置。 */
    state.renderCount = (state.renderCount || 0) + 1;
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
    /* P2-04：洋葱皮（纯显示，画在贴图之上、编辑层之下；不参与拾取） */
    if (state.edit.onion.on) drawOnionSkin(frame);
    if (state.show.mesh) drawMeshOverlay(frame);
    if (state.show.weights) drawWeightOverlay(frame, dpr);
    if (state.show.bones) drawBoneOverlay(frame);
    if (boneInteractionActive() && state.edit.selBone) drawBoneEditOverlay(frame);
    /* P2-04：运动轨迹（选中骨的 0..duration 采样折线 + 当前时刻标记） */
    if (state.edit.trail.on) drawTrail(frame);
    if (anyLayerOn()) {
      drawSelection(frame);
      drawDragGhost(frame);
    }
    /* task-41 / U06：自由变换包围框（画在最上层；命中在 onPointerDown 最前） */
    if (ft.on) {
      ft.box = ftBoxOf(ft.bone);
      ftDraw();
    }
    syncStageOverlays();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---- 6.1 贴图：region 四边形快路 + mesh 逐三角 ---- */

  // mesh 逐三角 clip 的抗锯齿缝修正（2026-11-07，step2 task-5）：
  // 相邻三角共享边两侧各被 AA 吃掉半像素 → 缝处 alpha 偏低（实测 α 95 vs 105、171 vs 218）。
  // 只对**非 quad（mesh）三角**把 clip 按内切圆心等比外扩 MESH_CLIP_EXPAND_DEVICE_PX 设备像素，
  // 让共享边互相覆盖、消缝；region 的 quad 快路与纹理变换（affine/UV）完全不变。
  const MESH_CLIP_EXPAND_DEVICE_PX = 0.5;
  const MESH_CLIP_EXPAND_MAX_SCALE = 3;

  function expandTriangleClip(pts, padCss) {
    const [x0, y0, x1, y1, x2, y2] = pts;
    if (!(padCss > 0)) return pts;
    const a = Math.hypot(x2 - x1, y2 - y1);
    const b = Math.hypot(x0 - x2, y0 - y2);
    const c = Math.hypot(x1 - x0, y1 - y0);
    const per = a + b + c;
    const area = Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;
    if (!(per > 0) || !(area > 1e-9)) return pts; // 退化三角不扩，避免放大成噪声
    const inr = area / (per / 2);                  // 内切圆半径
    const k = Math.min(1 + padCss / inr, MESH_CLIP_EXPAND_MAX_SCALE);
    const ix = (a * x0 + b * x1 + c * x2) / per;   // 内切圆心
    const iy = (a * y0 + b * y1 + c * y2) / per;
    return [ix + (x0 - ix) * k, iy + (y0 - iy) * k,
            ix + (x1 - ix) * k, iy + (y1 - iy) * k,
            ix + (x2 - ix) * k, iy + (y2 - iy) * k];
  }

  function paintTriangle(g, src, dst, a, b, c, page, dpr, clipQuad, clipTri) {
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
    } else if (clipTri) {
      g.moveTo(clipTri[0], clipTri[1]);
      g.lineTo(clipTri[2], clipTri[3]);
      g.lineTo(clipTri[4], clipTri[5]);
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
    const padCss = MESH_CLIP_EXPAND_DEVICE_PX / Math.max(1, dpr);
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const a = tris[t] * 2, b = tris[t + 1] * 2, c = tris[t + 2] * 2;
      const clipTri = expandTriangleClip(
        [screen[a], screen[a + 1], screen[b], screen[b + 1], screen[c], screen[c + 1]], padCss);
      paintTriangle(g, src, screen, a, b, c, page, dpr, null, clipTri);
    }
  }

  function drawTextures(frame, dpr) {
    const alpha = effectiveTextureAlpha();
    if (alpha <= 0 || !state.pageImages.length) return;
    applyAtlasSmoothing();
    const useScratch = alpha < 0.999;
    /* 0.9.90：眼珠跟随的分层裁剪 —— 虹膜（iris）必须被眼白（sclera）的 alpha 蒙版裁掉，
       否则移骨后整块矩形贴图会溢出眼眶形状（用户实测「眼珠超出眼白」）。
       做法：把虹膜与同侧 sclera 各自画进临时画布，用 destination-in 让两者 alpha 相乘，
       再把结果贴回主画布 —— 得到「虹膜 ∩ 眼眶」的精确形状。 */
    const gazeClips = gazeActive() ? gazeClipPairs(frame) : null;
    const itemById = new Map();
    if (gazeClips) {
      for (const item of frame.geo) itemById.set(item.slotIndex, item);
    }
    for (const item of frame.geo) {
      const page = state.pageImages[item.pageIndex] || state.pageImages[0];
      if (!page) continue;
      /* 槽透明度（来自动画 slots.<slot>.color 轨道，用于附件渐显渐隐）。
         完全透明就跳过，省一次绘制。 */
      const slotA = frame.pose && frame.pose.slotAlpha ? frame.pose.slotAlpha[item.slotIndex] : 1;
      if (slotA <= 0.002) continue;
      const screen = projXY(item.worldXY);
      /* 虹膜 item：走裁剪路径（画完再用 sclera 蒙版切） */
      if (gazeClips && gazeClips.irisSlots.has(item.slotIndex)) {
        const whiteItem = itemById.get(gazeClips.whiteSlotOf(item.slotIndex));
        if (whiteItem) {
          paintGazeIris(dpr, item, screen, page, whiteItem);
          continue;
        }
      }
      if (!useScratch) {
        if (slotA < 0.999) ctx.globalAlpha = alpha * slotA;
        paintItem(ctx, item, screen, page, dpr);
        if (slotA < 0.999) ctx.globalAlpha = 1;
        continue;
      }
      const g = scratchContext();
      paintItem(g, item, screen, page, dpr);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha * slotA;
      ctx.drawImage(scratch, 0, 0);
      ctx.restore();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
  }

  /** 跟随态下，虹膜槽 ↔ 同侧眼白槽 的配对；不跟随时返回 null */
  function gazeClipPairs(frame) {
    if (!state.model) return null;
    /* 调试开关：window.__gazeClipOff = true 可临时关掉裁剪，用于 A/B 验证。
       默认不存在 → 不影响正常运行。 */
    if (typeof window !== "undefined" && window.__gazeClipOff) return null;
    const irisSlots = new Set();
    const map = new Map();   /* 虹膜槽索引 → 眼白槽索引 */
    for (const side of ["L", "R"]) {
      const wi = state.slots.findIndex((s) => s.name === "眼白_" + side);
      const ei = state.slots.findIndex((s) => s.name === "眼珠_" + side);
      if (wi < 0 || ei < 0) continue;
      /* 只有两者都在 geometry 里才有意义 */
      if (!frame.geo.some((g) => g.slotIndex === wi)) continue;
      if (!frame.geo.some((g) => g.slotIndex === ei)) continue;
      irisSlots.add(ei);
      map.set(ei, wi);
    }
    if (!irisSlots.size) return null;
    return { irisSlots, whiteSlotOf: (ei) => map.get(ei), map };
  }

  /**
   * 画虹膜并用眼白 alpha 裁剪。
   * 步骤：iris → 临时画布；destination-in 画 sclera；结果贴回主画布。
   */
  function paintGazeIris(dpr, irisItem, irisScreen, page, whiteItem) {
    const mask = gazeMaskContext();
    /* 1) 只画虹膜 */
    paintItem(mask, irisItem, irisScreen, page, dpr);
    const dbgAfterIris = gazeMaskAlphaCount();
    /* 2) 用眼白的 alpha 做 destination-in（两者 alpha 相乘 = 眼形交集） */
    mask.save();
    mask.setTransform(dpr, 0, 0, dpr, 0, 0);
    mask.globalCompositeOperation = "destination-in";
    const whiteScreen = projXY(whiteItem.worldXY);
    const whitePage = state.pageImages[whiteItem.pageIndex] || state.pageImages[0];
    if (whitePage) paintItem(mask, whiteItem, whiteScreen, whitePage, dpr);
    mask.restore();
    const dbgAfterMask = gazeMaskAlphaCount();
    /* 3) 结果合成到主画布 */
    const alpha = effectiveTextureAlpha();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha < 0.999 ? alpha : 1;
    ctx.drawImage(gazeMask, 0, 0);
    ctx.restore();
    if (typeof window !== "undefined") {
      window.__gazeClipStats = window.__gazeClipStats || { calls: 0 };
      window.__gazeClipStats.calls++;
      window.__gazeClipStats.afterIris = dbgAfterIris;
      window.__gazeClipStats.afterMask = dbgAfterMask;
    }
  }

  /** 调试用：统计 gazeMask 的非透明像素数（抽样以控制开销） */
  function gazeMaskAlphaCount() {
    if (!gazeMask) return 0;
    const g = gazeMask.getContext("2d");
    try {
      const d = g.getImageData(0, 0, gazeMask.width, gazeMask.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 8) n++;
      return n;
    } catch (e) {
      return -1;
    }
  }

  let gazeMask = null;
  function gazeMaskContext() {
    if (!gazeMask) gazeMask = document.createElement("canvas");
    if (gazeMask.width !== cv.width || gazeMask.height !== cv.height) {
      gazeMask.width = cv.width;
      gazeMask.height = cv.height;
    }
    const g = gazeMask.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, gazeMask.width, gazeMask.height);
    g.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
    return g;
  }

  /**
   * 剪切蒙版的蒙版源：当 item 是「眼珠」槽且跟随激活时，返回用来裁切的蒙版 item。
   *
   * 原工程 PSD（`step2/source/*.psd`，见 0.9.95 调查）里：
   *   `眼白 100%`（clip=False，基底）→ `眼珠_100%`（clip=True）→ `睫毛_100%`
   * 也就是眼珠只在眼白的不透明范围内显示。这里用**完整眼球轮廓**（`eye_*_100`）
   * 当蒙版 —— 它与眼白同尺寸同位置，但中心填满（`sclera_*` 是挖空虹膜的环，不能当蒙版）。
   */
  function gazeMaskSourceOf(item, frame) {
    if (!gazeActive() || !state.model) return null;
    const slot = state.slots[item.slotIndex];
    if (!slot) return null;
    const m = /^眼珠_([LR])$/.exec(slot.name);
    if (!m) return null;
    /* 调试开关：window.__gazeMaskOff = true 可关掉剪切蒙版做 A/B 验证 */
    if (typeof window !== "undefined" && window.__gazeMaskOff) return null;
    const side = m[1];
    /* 蒙版 item：同槽、换成 eye_ 系列的完整眼球（保持同尺寸 102×101） */
    const skin = state.model.skins.get(state.model.defaultSkinName);
    const bag = skin && skin.attachments ? skin.attachments.get(item.slotIndex) : null;
    const maskName = "eye_" + side + "_100";
    if (!bag || typeof bag.get !== "function" || !bag.get(maskName)) return null;
    return { maskName, side, slotIndex: item.slotIndex };
  }

  /** 画眼珠并用完整眼球的 alpha 裁切（复刻 PSD 的剪贴蒙版） */
  function paintGazeClipped(item, screen, page, dpr, maskInfo) {
    const g = gazeScratchContext();
    paintItem(g, item, screen, page, dpr);
    /* 用完整眼球轮廓做 destination-in。蒙版几何按「槽 + 附件名」缓存 ——
       否则每帧一次 evalPose+buildGeometry 会让跟随掉帧。 */
    const maskItem = gazeMaskGeometry(maskInfo);
    if (maskItem) {
      g.save();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalCompositeOperation = "destination-in";
      paintItem(g, maskItem, projXY(maskItem.worldXY), page, dpr);
      g.restore();
    }
    const alpha = effectiveTextureAlpha();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha < 0.999 ? alpha : 1;
    ctx.drawImage(gazeScratch, 0, 0);
    ctx.restore();
  }

  /** 蒙版 item 缓存：key = 槽索引 + 附件名。眼骨静止时几何完全不变，可安全复用。 */
  let gazeMaskCache = { key: null, item: null };
  function gazeMaskGeometry(maskInfo) {
    const key = maskInfo.slotIndex + "|" + maskInfo.maskName;
    if (gazeMaskCache.key === key && gazeMaskCache.item) return gazeMaskCache.item;
    try {
      const gi = core.evalPose(state.model, {
        animation: null, time: 0, skin: "default",
        attachmentOverrides: new Map([[maskInfo.slotIndex, maskInfo.maskName]]),
      });
      const ggeo = core.buildGeometry(state.model, gi, { hidden: state.hidden });
      const it = ggeo.find((x) => x.slotIndex === maskInfo.slotIndex) || null;
      gazeMaskCache = { key, item: it };
      return it;
    } catch (e) {
      return null;
    }
  }

  let gazeScratch = null;
  function gazeScratchContext() {
    if (!gazeScratch) gazeScratch = document.createElement("canvas");
    if (gazeScratch.width !== cv.width || gazeScratch.height !== cv.height) {
      gazeScratch.width = cv.width;
      gazeScratch.height = cv.height;
    }
    const g = gazeScratch.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, gazeScratch.width, gazeScratch.height);
    g.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
    return g;
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
  /* 0.9.54：骨骼叠加层配色。用户要求「FK 骨蓝色、IK 骨绿色，能看出这两种骨骼」。
     原来 IK 骨是琥珀色 #f0b429，与「洋葱皮/未求值/曲线段」等一堆地方同色，一眼分不清。
     现在三色分工：
       · FK 骨        #5aa9ff  蓝（与整体 UI 主色一致）
       · IK 受控骨    #4ec9a5  绿（青绿，与琥珀拉开明显色相差）
       · IK target    #f57785  粉（保持原样，它是"把手"不是"骨"） */
  const BONE_FK_COLOR = "#5aa9ff";
  const BONE_IK_COLOR = "#4ec9a5";
  const BONE_IK_TARGET_COLOR = "#f57785";
  const BONE_IK_LABEL_COLOR = "#8ee6c8";

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
        ctx.strokeStyle = inIK.has(i) ? BONE_IK_COLOR : BONE_FK_COLOR;
        ctx.lineWidth = inIK.has(i) ? 2.2 : 1.6;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, inIK.has(i) ? 3.8 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = targets.has(i) ? BONE_IK_TARGET_COLOR : inIK.has(i) ? BONE_IK_COLOR : BONE_FK_COLOR;
      ctx.fill();
      ctx.strokeStyle = "#0b0e14";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (targets.has(i)) {
        ctx.strokeStyle = BONE_IK_TARGET_COLOR;
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
        ctx.fillStyle = inIK.has(i) ? BONE_IK_LABEL_COLOR : "#c9d4e6";
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
        ctx.fillStyle = info.restricted ? BONE_IK_TARGET_COLOR : BONE_IK_COLOR;
        ctx.fillText(info.restricted ? item[0] + " · 受限/未求值" : item[0], p.x + 11, p.y - 8);
      }
    }
    ctx.restore();
  }

  /* ---- 6.4b 骨骼编辑层：选中高亮 / 父子链 / gizmo（T6） ---- */
  const SELECT_COLOR = "#ffd166";
  const CHAIN_COLOR = "rgba(255, 209, 102, 0.45)";

  function drawBoneEditOverlay(frame) {
    const lib = boneEditLib();
    const name = state.edit.selBone;
    const entry = name ? boneEntry(name) : null;
    if (!lib || !entry || !frame || !frame.pose) return;
    const world = frame.pose.world;
    const selWorld = world[entry.index];
    if (!selWorld) return;

    /* 父子链高亮：父链 + 直接子骨 */
    const parentIdx = state.model.bones[entry.index].parentIndex;
    ctx.save();
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = CHAIN_COLOR;
    if (parentIdx >= 0 && world[parentIdx]) {
      ctx.beginPath();
      ctx.moveTo(proj(world[parentIdx].tx, world[parentIdx].ty).x, proj(world[parentIdx].tx, world[parentIdx].ty).y);
      const sp0 = proj(selWorld.tx, selWorld.ty);
      ctx.lineTo(sp0.x, sp0.y);
      ctx.stroke();
    }
    for (let i = 0; i < state.model.bones.length; i++) {
      if (state.model.bones[i].parentIndex !== entry.index) continue;
      const cw = world[i];
      if (!cw) continue;
      const c = proj(cw.tx, cw.ty);
      const s = proj(selWorld.tx, selWorld.ty);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    }
    const sp = proj(selWorld.tx, selWorld.ty);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = SELECT_COLOR;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#1b1205";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    /* gizmo：按工具画平移轴 / 旋转环 / 缩放手柄 */
    const g = currentGizmo();
    if (g) {
      const tool = editTool();
      const reason = boneEditBlockReason(name);
      const okColor = reason ? "#f57785" : "#7fd1ff";
      if (tool === "translate" || tool === "scale") {
        ctx.lineWidth = 2;
        for (const ax of ["axisX", "axisY"]) {
          ctx.strokeStyle = reason ? "#f57785" : okColor;
          ctx.beginPath();
          ctx.moveTo(g.center.x, g.center.y);
          ctx.lineTo(g[ax].x, g[ax].y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(g[ax].x, g[ax].y, 4, 0, Math.PI * 2);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(g.center.x, g.center.y, 4.6, 0, Math.PI * 2);
        ctx.fillStyle = reason ? "#f57785" : "#7fd1ff";
        ctx.fill();
        if (tool === "scale" && g.scaleHandle) {
          for (const h of [g.scaleHandle, g.scaleHandleY]) {
            if (!h) continue;
            ctx.beginPath();
            ctx.arc(h.x, h.y, 5.2, 0, Math.PI * 2);
            ctx.strokeStyle = reason ? "#f57785" : SELECT_COLOR;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      } else {
        ctx.beginPath();
        ctx.arc(g.center.x, g.center.y, g.ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = reason ? "#f57785" : SELECT_COLOR;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(g.center.x - g.ringRadius, g.center.y, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = reason ? "#f57785" : SELECT_COLOR;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(g.center.x, g.center.y, 4.6, 0, Math.PI * 2);
        ctx.fillStyle = okColor;
        ctx.fill();
      }
    }
    ctx.restore();
    /* P1-07：Pose 工具的 +X 显示柄（叶骨无 length → 固定 40 CSS px，只是显示，不写模型） */
    if (editTool() === "pose" && state.edit.selBone) {
      const info2 = boneScreenInfo(state.edit.selBone);
      const tip = poseTipReadout(state.edit.selBone);
      if (info2 && tip) drawPoseTip(ctx, info2, tip);
    }
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
  function notice(kind, text, actions, opts) {
    /* task-41：提示同样走人话映射；映射为空则丢弃。
       opts.verbatim=true 时跳过改写 —— 载入失败等诊断信息必须原样可见
       （否则消息里的 "HTTP" 会命中技术痕迹启发式，被换成通用兜底文案）。 */
    const o = opts || {};
    if (o.verbatim) {
      text = String(text == null ? "" : text);
      if (!text) return;
    } else {
      const mapped = simpleStatusText(text, kind);
      text = mapped;
      if (!text) return;
    }
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
    const box = el0("notices");
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
  function setStatus(msg, kind, opts) {
    const node = el0("statusMsg");
    /* task-41：单一界面下也走人话映射（保留 T36 成果）；映射为空则保持上一条。
       opts.verbatim=true 跳过改写，供载入失败等诊断用。 */
    const o = opts || {};
    const mapped = o.verbatim ? String(msg == null ? "" : msg) : simpleStatusText(msg, kind);
    if (mapped === "" && String(msg == null ? "" : msg).trim() !== "") return;
    if (mapped !== String(msg == null ? "" : msg)) console.debug("[status-raw]", msg);
    node.textContent = mapped;
    node.className = "msg" + (kind ? " " + kind : "");
  }
  function syncStageOverlays() {
    const loaded = !!state.model;
    el0("emptyState").hidden = loaded;
    el0("hiddenAllState").hidden = !(loaded && state.hidden.size >= state.slots.length);
    el0("noLayerState").hidden = !(loaded && !anyLayerOn());
  }

  /* ==========================================================================
   * 8b. 骨骼编辑：模式 / 目标 / 有效 Setup / 拾取与闸门（契约 §2、§4；T6）
   * ====================================================================== */
  function boneEditLib() {
    return window.SpineBoneEdit || null;
  }

  const editState = () => state.edit;

  function editMode() {
    return state.edit.mode === "animate" ? "animate" : "setup";
  }
  function editTarget() {
    return state.edit.target === "attachment" ? "attachment" : "bone";
  }
  function editTool() {
    const t = state.edit.tool;
    return t === "rotate" || t === "scale" || t === "pose" ? t : "translate";
  }
  function editSpace() {
    return state.edit.space === "world" ? "world" : state.edit.space === "local" ? "local" : "parent";
  }

  /** 骨名 → boneList 条目（含 index） */
  function boneEntry(name) {
    if (!name) return null;
    return state.bones[name] || null;
  }
  function boneNameList() {
    return state.boneList.map((b) => b.name);
  }
  /** 根 → 该骨的层级路径（骨名数组），用于检查器 breadcrumb */
  function bonePathOf(name) {
    const out = [];
    let cur = boneEntry(name);
    let guard = 0;
    while (cur && guard++ < 256) {
      out.unshift(cur.name);
      cur = cur.parentName ? boneEntry(cur.parentName) : null;
    }
    return out;
  }

  /**
   * 把 boneList 的五字段刷进 model.bones —— 有效 Setup（契约 §2）。
   * 不动 parent/index/shear 等原字段；也不做整模型重解析（pointermove 里绝不能调这个之外的重活）。
   */
  function syncEffectiveSetupBones() {
    const model = state.model;
    if (!model) return;
    for (const b of state.boneList) {
      const setup = model.bones[b.index];
      if (!setup) continue;
      for (const f of FIELDS) setup[f] = b[f];
    }
  }

  /** model 是否已与 boneList 一致（避免每次 render 都写） */
  function effectiveSetupDrift() {
    const model = state.model;
    if (!model) return false;
    for (const b of state.boneList) {
      const setup = model.bones[b.index];
      if (!setup) continue;
      for (const f of FIELDS) {
        const d = f === "scaleX" || f === "scaleY" ? 1 : 0;
        const a = b[f] == null ? d : b[f];
        const s = setup[f] == null ? d : setup[f];
        if (Math.abs(a - s) > 1e-9) return true;
      }
    }
    return false;
  }

  function transientActive() {
    const tr = state.edit.transient;
    return !!(tr && tr.bones && Object.keys(tr.bones).length);
  }

  /** Animate 下只把 transient 当 edits.bones（绝对 local 覆盖）；Setup 绝不走 edits */
  function transientEdits() {
    if (editMode() !== "animate" || !transientActive()) return null;
    const map = new Map();
    for (const name of Object.keys(state.edit.transient.bones)) {
      map.set(name, Object.assign({}, state.edit.transient.bones[name]));
    }
    return map.size ? map : null;
  }

  function setEditMode(mode) {
    const want = mode === "animate" ? "animate" : "setup";
    if (state.edit.mode === want && !state.edit.previewSetup) return true;
    const apply = () => {
      state.edit.previewSetup = false;
      state.edit.mode = want;
      /* P2-03：切模式一律保守复位轴心补偿（动画模式无法无损补偿；回 Setup 也要用户显式再开） */
      state.edit.pivotCompensate = false;
      state.edit.lastPivot = null;
      invalidateTrailCache();
      if (want === "animate") {
        if (!state.anim && state.model && state.model.animations.size) setAnim(Array.from(state.model.animations.keys())[0]);
        state.edit.autoKey = !!state.edit.autoKey;
      } else {
        /* 回 Setup：清掉未打键的临时姿态与播放，避免把预览值当绑定姿态 */
        state.edit.transient = null;
        state.playing = false;
        syncPlayButton();
      }
      syncEditToolbar();
      syncInspector();
      updateCursor();
      render();
      dsSyncPlayhead();
      syncDisplayToggles();
      /* task-42：顶部第 2 排的「绑定姿态 / 动画」按钮与属性区一起刷新（唯一真源） */
      syncChrome();
      setStatus(
        want === "setup"
          ? "模式：绑定姿态 —— 改动写骨骼基础值，会影响所有动画"
          : "模式：动画 —— 改动只作用于当前动画的 Key / 未打键预览"
      );
    };
    /* 切模式会丢弃未打键的临时姿态 → 先 guard，不静默丢 */
    if (transientActive()) return guardUnkeyed("切换到" + (want === "setup" ? "绑定姿态" : "动画") + "模式", apply);
    return apply(), true;
  }

  function setEditTarget(target) {
    const want = target === "attachment" ? "attachment" : "bone";
    if (state.edit.target === want) return true;
    const apply = () => {
      state.edit.target = want;
      state.edit.transient = null;
      /* P2-03：切到「部件」目标时保守复位轴心补偿（该开关只作用于骨骼目标） */
      if (want !== "bone") {
        state.edit.pivotCompensate = false;
        state.edit.lastPivot = null;
      }
      syncEditToolbar();
      syncInspector();
      syncList();
      updateCursor();
      render();
      if (want === "bone" && !state.edit.selBone && state.boneList.length) {
        setStatus("目标：骨骼 —— 在画布点击骨骼节点或连线选中");
      }
    };
    if (transientActive()) return guardUnkeyed("切换编辑目标", apply);
    return apply(), true;
  }

  function setEditTool(tool, opts) {
    const o = opts || {};
    const want = tool === "rotate" || tool === "scale" || tool === "pose" ? tool : "translate";
    state.edit.tool = want;
    /* 「选择」工具：只选中不拖动（PS 的 V 选择状态）；其它工具都允许拖动手势 */
    state.tool = o.selectOnly ? "select" : "move";
    syncEditToolbar();
    updateCursor();
    render();
    const label = o.selectOnly
      ? "选择（只点选，不拖动）"
      : want === "pose"
      ? "Pose（单骨 +X 指向光标；不做多骨 IK）"
      : want === "translate"
      ? "移动（V / G）"
      : want === "rotate"
      ? "旋转（R）"
      : "缩放（S）";
    setStatus("工具：" + label);
    return true;
  }

  function setEditSpace(space) {
    /* P1（契约 §5）：Parent / World / Local 三档；Local 用骨自身轴（真实 W 的两列） */
    const want = space === "world" ? "world" : space === "local" ? "local" : "parent";
    state.edit.space = want;
    syncEditToolbar();
    render();
    setStatus(
      want === "world"
        ? "坐标系：World（受父级条件限制，不可解时会拒绝并提示）"
        : want === "local"
        ? "坐标系：Local（沿骨骼自身轴；存储仍是父级局部的 x/y/rotation/scale）"
        : "坐标系：Parent（父骨局部）"
    );
    return true;
  }

  /**
   * 唯一时刻入口（契约 §2）：底栏 scrub / 时间输入 / 后续 Dopesheet 都走这里。
   * 切时刻前若有未打键 transient，先 guard（先别改 state.t，否则就是静默丢弃）。
   */
  function setPlayhead(sec, opts) {
    const o = opts || {};
    const range = previewRangeOf(state.anim);
    const lo = range.custom ? range.from : 0;
    const hi = range.custom ? range.to : state.animDur > 0 ? state.animDur : 0;
    const raw = Number.isFinite(sec) ? sec : 0;
    const target = clamp(raw, lo, Math.max(lo, hi));
    const apply = () => {
      if (o.pause !== false) {
        state.playing = false;
        syncPlayButton();
      }
      state.t = target;
      updateTimeLabel();
      syncInspector();
      syncEditToolbar();
      /* P2：播放头移动 → 轨道面板的表单初值跟着换（播放中不重建，避免每帧重绘） */
      if (!state.playing && el0("dsExtra") && !el0("dsExtra").hidden && state.edit.timeline.extraRowKey) {
        state.edit.timeline.extraForm = null;
        renderExtraPanel();
      }
      render();
      dsSyncPlayhead();
    };
    if (Math.abs(target - state.t) > 1e-9 && transientActive()) {
      return guardUnkeyed("切换时刻到 " + round(target, 3) + "s", apply);
    }
    apply();
  }

  /** 绑定姿态预览（契约 §2）：只预览 Setup Pose，不清动画 Key、不改 mode、不允许编辑 */
  function setPreviewSetup(on) {
    const want = !!on;
    if (want && transientActive()) {
      return guardUnkeyed("回到绑定姿态预览", () => {
        state.edit.previewSetup = true;
        state.playing = false;
        syncPlayButton();
        syncEditToolbar();
        syncInspector();
        render();
        setStatus("绑定姿态预览：只显示 Setup Pose，未清空任何动画 Key；再点一次返回");
      });
    }
    state.edit.previewSetup = want;
    state.playing = false;
    syncPlayButton();
    syncEditToolbar();
    syncInspector();
    updateCursor();
    render();
    dsSyncPlayhead();
    setStatus(
      want
        ? "绑定姿态预览：只显示 Setup Pose（未清空动画 Key）；再点「绑定姿态」返回"
        : "已退出绑定姿态预览" + (editMode() === "animate" ? "，回到动画模式" : "")
    );
    return true;
  }

  function setAutoKey(on) {
    const want = !!on;
    if (want && !state.edit.autoKey && transientActive()) {
      return guardUnkeyed("打开 Auto Key", () => {
        state.edit.autoKey = true;
        syncEditToolbar();
        setStatus("Auto Key 开：拖动结束会在当前时间写 Key");
      });
    }
    state.edit.autoKey = want;
    syncEditToolbar();
    setStatus(want ? "Auto Key 开：拖动结束会在当前时间写 Key" : "Auto Key 关：拖动只改预览，需手动打键");
    return true;
  }

  /** 选中骨（画布 / 列表 / 检查器共用入口）；name 为 null 表示清除 */
  function selectBone(name) {
    const __ret = selectBoneImpl(name);
    syncChrome();
    return __ret;
  }
  function selectBoneImpl(name) {
    const next = name && boneEntry(name) ? name : null;
    if (state.edit.selBone === next) {
      syncInspector();
      syncList();
      render();
      return;
    }
    state.edit.selBone = next;
    syncInspector();
    syncList();
    render();
  }

  function boneWorldOf(index) {
    const frame = state.frame;
    if (!frame || !frame.pose || !frame.pose.world) return null;
    return frame.pose.world[index] || null;
  }

  /** 选中骨在屏幕上的原点与朝向（gizmo 用） */
  function boneScreenInfo(name) {
    const entry = boneEntry(name);
    if (!entry || !state.frame) return null;
    const w = boneWorldOf(entry.index);
    if (!w) return null;
    const lib = boneEditLib();
    const p = proj(w.tx, w.ty);
    return {
      index: entry.index,
      name: entry.name,
      world: w,
      screen: p,
      angleRad: lib ? lib.screenAngleOf(w, state.zoom) : 0,
    };
  }

  /** 当前坐标系下该骨是否可解（World 旋转等；Local 用真实 W/H，aim 不受 World R gate 限制） */
  function spaceGate(name, tool) {
    const lib = boneEditLib();
    const entry = boneEntry(name);
    if (!lib || !entry) return { ok: true, reason: "" };
    const inherit = inheritOfBone(name);
    const basis = lib.inheritBasis(realParentWorldOf(entry), inherit);
    if (!basis.supported) {
      return { ok: false, code: "EDIT_INHERIT_UNSUPPORTED", reason: "该骨 inherit=" + inherit + " 未支持：不按 Normal 近似（请用官方工具处理）" };
    }
    const A = basis.A || lib.identity();
    if (editTool() === "rotate" && editSpace() === "world") return lib.canWorldRotate(A);
    if (editTool() === "scale" && editSpace() === "world") return lib.canWorldUniformScale(A);
    if (editSpace() === "local") {
      const local0 = localOfBone(name);
      if (editTool() === "translate" || editTool() === "pose") {
        const W = boneWorldOf(entry.index);
        if (!W || !lib.invert(W)) {
          return { ok: false, code: "EDIT_AFFINE_UNREPRESENTABLE", reason: "骨自身轴基不可逆（scale 为 0？）：Local 平移不可解" };
        }
        if (!lib.invert(A)) return { ok: false, code: "EDIT_PARENT_SINGULAR", reason: "父级矩阵不可逆：Local 平移不可解" };
      } else if (editTool() === "scale") {
        const W = boneWorldOf(entry.index);
        if (!W || !lib.invert(W)) {
          return { ok: false, code: "EDIT_AFFINE_UNREPRESENTABLE", reason: "骨自身轴基不可逆（scale 为 0？）：Local 缩放不可解" };
        }
      }
    }
    return { ok: true, reason: "" };
  }

  /** 把 bone-edit 的 reason 转成人话（含契约公开错误码），供状态栏/提示用 */
  function spaceReasonText(res) {
    const code = editCodeOf(res);
    const map = {
      EDIT_WORLD_ROTATE_UNSUPPORTED: "World 旋转要求父级是相似变换（无 shear/非均匀缩放）；改用 Parent 或 Local",
      EDIT_WORLD_AXIS_SCALE_UNSUPPORTED: "世界单轴缩放不可解：请改用 Parent / Local 或等比缩放",
      EDIT_PARENT_SINGULAR: "父级矩阵不可逆，无法换算",
      EDIT_AFFINE_UNREPRESENTABLE: "轴基退化（相邻控制点或 scale 为 0），无法表示",
      EDIT_SCALE_DEGENERATE: "缩放假数据：起点距离/倍率非法",
      EDIT_INHERIT_UNSUPPORTED: "该骨 inherit 未支持：不按 Normal 近似",
      LOCAL_BASIS_SINGULAR: "骨自身轴基不可逆（scale 为 0？）",
    };
    const text = map[code] || res.reasonText || "";
    return text ? code + "：" + text : code;
  }

  function editCodeOf(res) {
    const lib = boneEditLib();
    const raw = res && res.reason ? String(res.reason) : "";
    if (lib && typeof lib.editCode === "function") {
      const mapped = lib.editCode(raw);
      return mapped || raw;
    }
    return raw;
  }

  /** 骨骼目标的编辑闸门（替代 dragBlockReason 的 slot 视角） */
  function boneEditBlockReason(name) {
    if (!state.model) return "尚未载入模型";
    if (state.loading || state.saveBusy || state.zipBusy) return "载入 / 保存中，请稍候";
    if (state.edit.previewSetup) return "绑定姿态预览中：只读（再点「绑定姿态」退出后编辑）";
    if (state.playing) return "播放中：先暂停再编辑骨骼";
    if (state.edit.target !== "bone") return "当前目标是「部件」：切到「骨骼」才能编辑骨骼";
    const entry = boneEntry(name);
    if (!entry) return "没有选中骨骼";
    if (state.locked.has(entry.name)) return "该骨已锁定：解锁后可编辑";
    /* P1-01：Dopesheet 锁定轨也要挡住画布手势/打键（契约 §6） */
    const rowLock = boneRowLocked(entry.name);
    if (rowLock) return "该骨的轨道已锁定（" + rowLock + "）：解锁后再编辑";
    const gate = spaceGate(name, editTool());
    if (gate && gate.ok === false) return gate.reason || "当前坐标系下该操作不可解";
    return "";
  }

  /** 顶层类型闸门（契约：加权 mesh 在骨骼目标下必须可拖，附件目标才受限） */
  function slotEditBlockReason(slotIndex) {
    const slot = state.slots[slotIndex];
    if (!slot) return "没有选中部件";
    if (state.loading || state.saveBusy || state.zipBusy) return "载入 / 保存中，请稍候";
    if (state.edit.previewSetup) return "绑定姿态预览中：只读（退出预览后编辑）";
    if (state.playing) return "播放中：先暂停再编辑";
    if (state.locked.has(slot.name)) return "该部件已锁定：点检查器里的锁图标解锁后可拖动";
    const att = state.frame ? attachmentAt(state.frame.pose, slotIndex) : null;
    if (editTarget() === "bone") return ""; /* 骨骼目标：贴图命中也按「选骨 → 改骨」处理 */
    if (editMode() === "animate") return "动画模式下附件只读：切回绑定姿态再改附件";
    if (att && att.type !== "region") {
      return "该附件是" + (att.weighted ? "加权网格" : "网格") + "：附件自身变换只读（骨骼目标下可由骨驱动）";
    }
    for (const c of state.constraints) {
      if (c.bones.indexOf(slot.boneIndex) >= 0 && c.mix > 0) return "该骨受 IK 约束（" + c.name + "）：请移动 IK target 骨";
    }
    return "";
  }

  /** 旧入口保持可用：按当前目标分发（调用点太多，避免一次性改错） */
  function dragBlockReason(slotIndex) {
    if (editTarget() === "bone") {
      const slot = state.slots[slotIndex];
      const name = slot ? slot.boneName : state.edit.selBone;
      return boneEditBlockReason(name);
    }
    return slotEditBlockReason(slotIndex);
  }

  /** 画布上收集骨骼命中候选（关节 + 层级连线） */
  function boneHitCandidates() {
    const frame = state.frame;
    if (!frame || !frame.pose || !frame.pose.world) return [];
    const out = [];
    for (let i = 0; i < state.model.bones.length; i++) {
      const w = frame.pose.world[i];
      if (!w) continue;
      const p = proj(w.tx, w.ty);
      out.push({
        index: i,
        parentIndex: state.model.bones[i].parentIndex,
        world: { tx: w.tx, ty: w.ty },
        screen: p,
      });
    }
    return out;
  }

  function pickBoneAt(screenPoint) {
    const lib = boneEditLib();
    if (!lib || !state.model) return null;
    return lib.boneHitTest({
      bones: boneHitCandidates(),
      point: screenPoint,
      jointTolPx: lib.DEFAULT_JOINT_TOL,
      lineTolPx: lib.DEFAULT_LINE_TOL,
      zoom: state.zoom,
    });
  }

  /* ---- 8c. 附件目标编辑（P0-02/13；契约 §5） ---- */
  function attachmentPatchIndexOf(identity) {
    if (!identity) return -1;
    return state.edit.attachmentPatches.findIndex(
      (p) => p.slotName === identity.slotName && p.attachmentName === identity.attachmentName
    );
  }

  /** 基础（未打补丁）附件：身份与拖动起点都取它，避免「用已经烘焙过的值再叠一次」。
   *  注意：解析态 skin.attachments 是用 **slot 索引** 作键（不是槽名）。 */
  function baseAttachmentOf(slotIndex) {
    const slot = state.slots[slotIndex];
    if (!slot || !state.model) return null;
    const skin = state.model.skins.get(state.model.defaultSkinName);
    if (!skin || typeof skin.attachments.get !== "function") return null;
    const bag = skin.attachments.get(slot.index);
    if (!bag || typeof bag.get !== "function") return null;
    const name = slot.attachment;
    return name ? bag.get(name) || null : null;
  }

  /** 当前选中槽的真实附件身份 {skinName,slotName,attachmentName}（不用 id 拆名猜身份） */
  function currentAttachmentIdentity() {
    const slot = state.sel >= 0 ? state.slots[state.sel] : null;
    if (!slot) return null;
    const base = baseAttachmentOf(slot.index);
    if (!base || !base.path) return null;
    return {
      skinName: state.model && state.model.defaultSkinName ? state.model.defaultSkinName : "default",
      slotName: slot.name,
      attachmentName: base.path,
    };
  }

  function attachmentPatchOf(identity) {
    const i = attachmentPatchIndexOf(identity);
    return i < 0 ? null : state.edit.attachmentPatches[i];
  }

  /** 附件目标能否编辑：仅 Setup + region（网格/加权/linkedmesh 只读） */
  function attachmentEditBlockReason(slotIndex) {
    const slot = state.slots[slotIndex];
    if (!slot) return "没有选中部件";
    if (state.loading || state.saveBusy || state.zipBusy) return "载入 / 保存中，请稍候";
    if (editTarget() !== "attachment") return "当前目标是「骨骼」：切到「部件」才能编辑附件";
    if (editMode() !== "setup") return "附件只在「绑定姿态」模式可编辑（动画模式附件变换只读）";
    if (state.locked.has(slot.name)) return "该部件已锁定：解锁后可编辑";
    const att = state.frame ? attachmentAt(state.frame.pose, slot.index) : null;
    if (!att) return "该槽没有附件";
    if (att.type !== "region") return "该附件是" + (att.weighted ? "加权网格" : "网格") + "：附件自身变换只读，请改用骨骼目标由骨驱动";
    return "";
  }

  /**
   * 把附件补丁烘焙进 region 的 localXY（契约 §5：core 已把 transform 烘进 localXY，
   * 只改 parsed 的 x/y/rotation/scale 不会更新预览）。
   */
  function bakeRegionLocalXY(att, fields) {
    const src = att && att.rawRef;
    if (!src) return null;
    const width = Number.isFinite(src.width) ? src.width : att.width;
    const height = Number.isFinite(src.height) ? src.height : att.height;
    const bx = Number.isFinite(src.x) ? src.x : 0;
    const by = Number.isFinite(src.y) ? src.y : 0;
    const br = Number.isFinite(src.rotation) ? src.rotation : 0;
    const bsx = Number.isFinite(src.scaleX) ? src.scaleX : 1;
    const bsy = Number.isFinite(src.scaleY) ? src.scaleY : 1;
    const f = fields || {};
    const ax = Number.isFinite(f.x) ? f.x : bx;
    const ay = Number.isFinite(f.y) ? f.y : by;
    const rotation = Number.isFinite(f.rotation) ? f.rotation : br;
    const scaleX = Number.isFinite(f.scaleX) ? f.scaleX : bsx;
    const scaleY = Number.isFinite(f.scaleY) ? f.scaleY : bsy;
    const region = att.region;
    const trim = region
      ? { offX: region.offsetX, offY: region.offsetY, origW: region.originalW || region.w, origH: region.originalH || region.h, rw: region.w, rh: region.h }
      : { offX: 0, offY: 0, origW: width, origH: height, rw: width, rh: height };
    const ratioX = trim.origW > 0 ? (width / trim.origW) * scaleX : 0;
    const ratioY = trim.origH > 0 ? (height / trim.origH) * scaleY : 0;
    const left = (-width / 2) * scaleX + trim.offX * ratioX;
    const right = left + trim.rw * ratioX;
    const bottom = (-height / 2) * scaleY + trim.offY * ratioY;
    const top = bottom + trim.rh * ratioY;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const place = (lx, ly) => ({ x: lx * cos - ly * sin + ax, y: lx * sin + ly * cos + ay });
    const p0 = place(left, bottom);
    const p1 = place(left, top);
    const p2 = place(right, top);
    const p3 = place(right, bottom);
    return new Float64Array([p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y]);
  }

  /** 预览用的附件覆盖：把 attachmentPatches 烘焙成新的 region 附件对象（按补丁内容缓存） */
  let attachmentPatchCache = { key: "", map: null };
  function attachmentOverrideMap() {
    const patches = state.edit.attachmentPatches || [];
    if (!patches.length || !state.frame || !state.model) return null;
    const key = JSON.stringify(patches);
    if (attachmentPatchCache.key === key && attachmentPatchCache.map) return attachmentPatchCache.map;
    const map = new Map();
    const skin = state.model.skins.get(state.model.defaultSkinName) || null;
    for (const p of patches) {
      if (!skin) continue;
      const slotIndex = state.slots.findIndex((s) => s.name === p.slotName);
      if (slotIndex < 0) continue;
      const bag = skin.attachments.get(slotIndex);
      const base = bag && typeof bag.get === "function" ? bag.get(p.attachmentName) : null;
      if (!base || base.type !== "region") continue;
      const fields = p.fields || {};
      const clone = Object.assign({}, base);
      clone.x = Number.isFinite(fields.x) ? fields.x : base.x;
      clone.y = Number.isFinite(fields.y) ? fields.y : base.y;
      clone.rotation = Number.isFinite(fields.rotation) ? fields.rotation : base.rotation;
      clone.scaleX = Number.isFinite(fields.scaleX) ? fields.scaleX : base.scaleX;
      clone.scaleY = Number.isFinite(fields.scaleY) ? fields.scaleY : base.scaleY;
      const xy = bakeRegionLocalXY(base, fields);
      if (xy) clone.localXY = xy;
      map.set(slotIndex, clone);
    }
    attachmentPatchCache = { key: key, map: map.size ? map : null };
    return attachmentPatchCache.map;
  }

  function setAttachmentFields(identity, fields) {
    if (!identity) return false;
    const i = attachmentPatchIndexOf(identity);
    const cur = i >= 0 ? Object.assign({}, state.edit.attachmentPatches[i].fields) : {};
    for (const k of Object.keys(fields)) if (Number.isFinite(fields[k])) cur[k] = fields[k];
    const entry = { skinName: identity.skinName, slotName: identity.slotName, attachmentName: identity.attachmentName, fields: cur };
    if (i >= 0) state.edit.attachmentPatches[i] = entry;
    else state.edit.attachmentPatches.push(entry);
    return true;
  }

  /** 把补丁交给 T5 的 applyAttachmentEdits 做真实校验/落地（整批原子） */
  function applyAttachmentPatches(patchedModel) {
    const lib = window.SpineBundle;
    const patches = state.edit.attachmentPatches || [];
    if (!patches.length) return { ok: true, value: patchedModel, applied: [], issues: [] };
    if (!lib || typeof lib.applyAttachmentEdits !== "function") {
      return { ok: false, issues: [{ path: "skins", code: "ATTACHMENT_PATCH_UNSUPPORTED", message: "bundle.js 未提供 applyAttachmentEdits" }] };
    }
    return lib.applyAttachmentEdits(patchedModel, patches);
  }

  /* ==========================================================================
   * 9. 编辑 / 撤销
   * ====================================================================== */
  /**
   * 快照（契约 §3）：一次事务的可撤销文档状态。
   * 覆盖 boneList、slot 顺序、动画草稿（全量 JSON）、附件补丁、transient（含上下文）。
   * 不克隆 model 的 Map / Canvas / DOM。
   */
  /** 内容快照（不含视图态 sel）：用于 dirty / commit 的「是否真的改了文档」比较 */
  function contentSnapshot() {
    return snapshot(false);
  }

  function snapshot(withSelection) {
    const body = {
      v: 1,
      b: state.boneList.map((b) => [
        b.name,
        b.x || 0,
        b.y || 0,
        b.rotation || 0,
        b.scaleX == null ? 1 : b.scaleX,
        b.scaleY == null ? 1 : b.scaleY,
      ]),
      o: state.slots.map((s) => s.name),
      d: state.animEdit.drafts || {},
      ap: state.edit.attachmentPatches || [],
      tr: state.edit.transient || null,
      /* P2-06（task-28）：结构修订号 —— 改 raw 骨架（新建/重父级/重命名/删除骨）也随快照恢复 */
      sk: state.skelRev || 0,
    };
    /* P1（T21）：选择集随历史恢复（契约 §2）；但它属于视图态，不能影响 dirty/commit 判定 */
    if (withSelection !== false) {
      body.sel = state.edit.timeline && state.edit.timeline.selection ? state.edit.timeline.selection.items : [];
    }
    return JSON.stringify(body);
  }
  function applySnapshot(str) {
    const snap = JSON.parse(str);
    /* P2-06：结构修订号不同 → 先用当时的 raw 骨架重建解析态，再按快照恢复局部值 */
    if (snap.sk !== undefined && snap.sk !== (state.skelRev || 0) && Array.isArray(state.skelHistory) && state.skelHistory[snap.sk]) {
      const rawPrev = state.skelHistory[snap.sk];
      const rb = rebuildFromRaw(JSON.parse(JSON.stringify(rawPrev)), { selectBone: state.edit.selBone });
      state.skelRev = snap.sk;
      if (!rb.ok) setStatus("撤销结构变更时重解析失败：" + issueText(rb.issues, 2), "error");
    }
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
    /* 草稿与附件补丁（v1 之前的旧快照没有 d/ap/tr 字段，按空处理） */
    if (state.animEdit) state.animEdit.drafts = snap.d ? JSON.parse(JSON.stringify(snap.d)) : Object.create(null);
    if (state.animEdit) state.animEdit.rev = (state.animEdit.rev || 0) + 1; /* P2-04：轨迹缓存失效 */
    if (state.edit) {
      state.edit.attachmentPatches = Array.isArray(snap.ap) ? JSON.parse(JSON.stringify(snap.ap)) : [];
      state.edit.transient = snap.tr ? JSON.parse(JSON.stringify(snap.tr)) : null;
      /* P2-03：撤销/重做/回滚后，上一次补偿摘要不再代表文档状态 → 清掉（检查器不显示过期结论） */
      state.edit.lastPivot = null;
    }
    /* 有效 Setup：骨值回到 model.bones，草稿回到 model.animations */
    syncEffectiveSetupBones();
    /* P1（T21）：撤销/重做恢复选择集（旧快照没有 sel 字段 → 清空） */
    if (state.edit.timeline && typeof selectionSet === "function") {
      const sel = Array.isArray(snap.sel) ? snap.sel : [];
      selectionSet(sel, sel.length ? sel[0] : null);
    }
    syncAnimFromDraft(state.anim || state.animEdit.sel);
    /* 草稿/raw 变了 → 当前动画时长与时间标签必须跟着回（否则撤销重定时后仍显示 7s） */
    if (state.anim) {
      state.animDur = animDuration(state.anim);
      if (state.t > state.animDur) state.t = state.animDur;
      updateTimeLabel();
    }
    if (state.model) framePose();
    if (state.sel >= state.slots.length) state.sel = state.slots.length - 1;
  }
  function pushUndo(snap) {
    state.undo.push(snap);
    if (state.undo.length > 120) state.undo.shift();
    syncToolbar();
  }
  function commit(before) {
    /* 用内容快照比较：只改选择集不算文档改动（不写历史、不置 dirty） */
    const now = contentSnapshot();
    if (now === contentOfSnapshot(before)) return false;
    pushUndo(before);
    state.redo.length = 0;
    state.docRev = (state.docRev || 0) + 1;
    state.dirty = now !== contentOfSnapshot(state.initial);
    syncFooter();
    return true;
  }

  /** 全量快照串 → 内容部分（去掉 sel 视图态字段） */
  function contentOfSnapshot(str) {
    try {
      const o = JSON.parse(str);
      if (o && typeof o === "object") delete o.sel;
      return JSON.stringify(o);
    } catch (e) {
      return str;
    }
  }

  /** 统一刷新 dirty（只比较文档内容，选择集/布局不算改动） */
  function refreshDirty() {
    state.dirty = contentSnapshot() !== contentOfSnapshot(state.initial);
    return state.dirty;
  }
  function undo() {
    if (!state.undo.length) return setStatus("没有可撤销的操作");
    const entry = state.undo.pop();
    const after = snapshot();
    applySnapshot(entry);
    state.redo.push(after);
    if (state.redo.length > 120) state.redo.shift();
    refreshDirty();
    syncAll();
    render();
    setStatus("已撤销一步");
  }
  function redo() {
    if (!state.redo.length) return setStatus("没有可重做的操作");
    const entry = state.redo.pop();
    const before = snapshot();
    applySnapshot(entry);
    state.undo.push(before);
    if (state.undo.length > 120) state.undo.shift();
    refreshDirty();
    syncAll();
    render();
    setStatus("已重做一步");
  }
  function resetAll() {
    if (!state.initial) return;
    if (snapshot() === state.initial && !state.hidden.size && !state.locked.size) return setStatus("已经是最近保存状态");
    pushUndo(snapshot());
    applySnapshot(state.initial);
    state.redo.length = 0;
    state.edit.transient = null;
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
    /* 骨骼目标：方向键微调走同一换算通道（Setup 写 boneList，Animate 写 transient） */
    if (editTarget() === "bone") {
      const name = state.edit.selBone;
      if (!name) return;
      const reason = boneEditBlockReason(name);
      if (reason) return setStatus(reason, "warn");
      const local = localOfBone(name);
      const before = snapshot();
      const vals = {};
      vals[axis] = (axis === "x" ? local.x : local.y) + delta;
      writeLocalBone(name, vals);
      if (commit(before)) {
        syncInspector();
        syncEditToolbar();
        render();
      }
      return;
    }
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
    const groups = slotGroups();
    const lib = slotGroupLib();
    /* 分组视图：上移/下移只在本组内一步；置顶/置底拒绝（会破坏连续 z 区间） */
    if (lib && groups.length) {
      const group = lib.groupOfIndex(groups, state.sel);
      if (!group) return setStatus("找不到该部件所属的分组，已取消层级调整", "warn");
      if (action === "top" || action === "bottom") {
        return setStatus("分组视图下只能在组内调整显示顺序（不能用「置顶/置底」跨出「" + group.name + "」）", "warn");
      }
      const step = action === "up" ? 1 : action === "down" ? -1 : 0;
      const target = state.sel + step;
      if (!step || target === state.sel) return;
      if (target > group.maxIndex || target < group.minIndex) {
        return setStatus("已到分组「" + group.name + "」的边界，只能在组内调整显示顺序", "warn");
      }
      /* 走统一落点（同 guard + 重映射 + renorm），after 语义：向上=插到目标之前，向下=插到目标之后 */
      reorderSlotDisplay(state.sel, target, action === "down");
      return;
    }
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
    syncSlotOrderToModel();
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
  /**
   * 动画时长：**全时序 max**（契约 §4「延长与同步」/ Lead 阻塞项）。
   *   1) 解析态不做全量时序扫描（只扫 bones/slots），会漏 deform/events/ik/drawOrder/未知轨；
   *   2) 草稿（animEdit.drafts）可能比解析态更长。
   * 所以统一取 `max(parsed.duration, animDurationOf(rawDraft||raw))`，并把解析态缺口
   * 记成诊断（保留未知时序，不为了相等而丢数据）。
   */
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
    const lib = animEditLib();
    const raw = animDraft(name) || (state.raw && state.raw.animations ? state.raw.animations[name] : null);
    let scanned = 0;
    if (lib && raw && typeof lib.animDurationOf === "function") {
      try {
        scanned = lib.animDurationOf(raw) || 0;
      } catch (e) {
        scanned = 0;
      }
    }
    const total = Math.max(d, scanned);
    /* 解析态比全时序短 → 记诊断（未知/未解析的时序存在，不能丢） */
    if (scanned > d + 1e-9) {
      const key = "animdur:" + name;
      const text = "动画「" + name + "」含未纳入解析态时长的轨道：全时序 " + round(scanned, 4) + "s > bones/slots " + round(d, 4) + "s";
      if (!state.diagnostics.some((x) => x && x.key === key)) state.diagnostics.push({ key: key, text: text, kind: "warn" });
    }
    return total;
  }
  function syncAnimSelect() {
    /* task-36：记「上次这个包用的动画」（只记合法字符串；不写 JSON） */
    if (typeof state.ui === "object" && state.ui && state.bundle && state.anim) {
      const base = String(state.bundle.base || "").replace(/\/+$/, "");
      if (base) {
        if (!isRecord(state.ui.lastClipByPack)) state.ui.lastClipByPack = {};
        state.ui.lastClipByPack[base] = state.anim;
      }
    }
    const sel = el0("animSel");
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
    el0("btnPlay").disabled = !has;
    el0("btnSetup").disabled = !has;
    el0("btnStop").disabled = !state.anim;
    el0("speedSel").disabled = !has;
    el0("scrub").disabled = !state.anim || state.animDur <= 0;
    if (el0("animEditSel")) syncAnimEditBar();
    if (typeof syncPreviewRange === "function") syncPreviewRange();
    if (typeof dsSyncBars === "function") {
      dsSyncBars();
      dsDraw();
    }
  }
  /**
   * 未打键保护（契约 §6）：存在未打键 transient 时，先阻止待执行动作并给三分支。
   * 用页内 notice 动作，不强制浏览器 confirm；取消保持上下文与数据不变。
   */
  let pendingAction = null;
  let pendingNoticeKey = null;
  function removeNoticeByKey(key) {
    if (!key) return;
    const i = notices.findIndex((n) => n.key === key);
    if (i < 0) return;
    notices.splice(i, 1);
    syncNotices();
  }
  function clearPendingGuard() {
    const key = pendingNoticeKey;
    pendingNoticeKey = null;
    pendingAction = null;
    removeNoticeByKey(key);
  }
  function transientSummary() {
    const tr = state.edit.transient;
    if (!tr || !tr.bones) return "";
    const names = Object.keys(tr.bones);
    if (!names.length) return "";
    return names
      .slice(0, 3)
      .map((n) => {
        const f = (tr.fields && tr.fields[n]) || [];
        return n + (f.length ? "(" + f.join("/") + ")" : "");
      })
      .join("、") + (names.length > 3 ? " 等 " + names.length + " 根" : "");
  }
  function guardUnkeyed(reasonLabel, action) {
    if (!transientActive()) {
      action();
      return true;
    }
    /* 同一时刻只允许一个 guard 提示：新的 guard 取代旧的，避免多份三分支堆叠 */
    clearPendingGuard();
    pendingAction = action;
    const anim = state.anim || state.animEdit.sel || "（无动画）";
    const text = "「" + reasonLabel + "」前存在未打关键帧的改动：" + transientSummary() + " @ " + round(state.t, 3) + "s";
    pendingNoticeKey = "warn|" + text;
    notice("warn", text, [
      {
        label: "打键并继续",
        onClick: () => {
          const fields = (state.edit.transient && state.edit.transient.fields) || {};
          const before = snapshot();
          for (const n of Object.keys(fields)) keySelectedBoneFor(n, fields[n]);
          state.edit.transient = null;
          commit(before);
          const act = pendingAction;
          pendingAction = null;
          const key = pendingNoticeKey;
          pendingNoticeKey = null;
          removeNoticeByKey(key);
          syncEditToolbar();
          syncInspector();
          if (act) act();
          updateTimeLabel();
          dsSyncPlayhead();
        },
      },
      {
        label: "放弃临时姿态并继续",
        onClick: () => {
          const before = snapshot();
          state.edit.transient = null;
          commit(before);
          const act = pendingAction;
          pendingAction = null;
          const key = pendingNoticeKey;
          pendingNoticeKey = null;
          removeNoticeByKey(key);
          syncEditToolbar();
          syncInspector();
          render();
          if (act) act();
          setStatus("已放弃未打键的临时姿态（可 Ctrl+Z 撤销）", "warn");
        },
      },
      {
        label: "取消",
        onClick: () => {
          removeNoticeByKey(pendingNoticeKey);
          pendingNoticeKey = null;
          /* 取消：时刻/动画/transient 全不变，并把底栏 scrub 与 Dopesheet 播放头同步回 state.t
             （否则滑块会停在用户拖到的位置，与真实播放头不一致） */
          updateTimeLabel();
          dsSyncPlayhead();
          syncInspector();
          syncEditToolbar();
          setStatus("已取消：" + reasonLabel + " 未执行，未打键改动仍保留", "warn");
        },
      },
    ]);
    setStatus("有未打关键帧的改动：请先选择「打键并继续 / 放弃 / 取消」", "warn");
    return false;
  }

  /** 给指定骨打指定字段的 Key（transient guard 的「打键并继续」用） */
  function keySelectedBoneFor(name, fields) {
    const prev = state.edit.selBone;
    state.edit.selBone = name;
    const res = keySelectedBone(fields);
    state.edit.selBone = prev;
    return res;
  }

  function setAnim(name) {
    const apply = () => {
      state.anim = name || "";
      /* 0.9.85：虚拟条目「眼珠跟随鼠标」没有时间轴时长，给一个非零值让播放循环能跑；
         它的实际表现完全由 state.gaze 驱动（见 tick 里的分支）。 */
      state.animDur = isGazeAnim(state.anim) ? GAZE_VIRTUAL_DUR : animDuration(state.anim);
      state.t = 0;
      state.playing = false;
      /* 换动画 = 停止 + 眼珠复位（除虚拟条目外）。用户要求「更换动画选择后复位」。 */
      if (!isGazeAnim(state.anim)) gazeReset();
      else gazePause();
      state.edit.transient = null;
      invalidateTrailCache(); /* P2-04：换动画 → 轨迹采样失效 */
      if (state.animEdit && name) state.animEdit.sel = name;
      /* 0.9.108：取消选择（name 为空）时同步清掉 sel —— 否则列表高亮会残留，
         而且下游大量代码用 `state.anim || state.animEdit.sel` 取当前动画，不清会「取消不掉」。 */
      if (state.animEdit && !name) state.animEdit.sel = null;
      syncPlayButton();
      syncAnimSelect();
      updateTimeLabel();
      syncInspector();
      syncEditToolbar();
      render();
      if (isGazeAnim(state.anim)) {
        setStatus("眼珠跟随：点「播放」开始跟随鼠标；暂停后保持不动，换动画复位");
      } else if (state.anim) {
        setStatus("预览动画「" + animLabel(state.anim) + "」：摆位已暂停，点「绑定姿态」返回");
      }
    };
    if (name !== state.anim && transientActive()) return guardUnkeyed("切换动画", apply);
    apply();
  }
  function syncPlayButton() {
    const btn = el0("btnPlay");
    btn.innerHTML = icon(state.playing ? "pause" : "play");
    btn.appendChild(el("span", null, state.playing ? "暂停" : "播放"));
    btn.appendChild(el("kbd", null, "P"));
    btn.classList.toggle("on", state.playing);
    btn.setAttribute("aria-pressed", state.playing ? "true" : "false");
  }
  function togglePlay() {
    if (!state.anim) return setStatus("先选一个动画，或直接拖动部件摆位", "warn");
    /* 0.9.85：虚拟条目「眼珠跟随鼠标」—— 播放=开始跟随，暂停=保持不动。 */
    if (isGazeAnim(state.anim)) {
      state.playing = !state.playing;
      if (state.playing) {
        state.gaze.active = true;
        syncPlayButton();
        state.lastTs = 0;
        requestAnimationFrame(tick);
        setStatus("眼珠跟随中：移动鼠标看眼珠转向；再点播放暂停（保持不动），换动画复位");
      } else {
        gazePause();          /* 保持当前偏移，不归零 */
        syncPlayButton();
        setStatus("眼珠跟随已暂停（眼珠保持不动）；点播放继续，换动画复位");
      }
      render();
      return;
    }
    if (!state.playing && transientActive()) {
      return guardUnkeyed("开始播放", () => {
        state.playing = true;
        syncPlayButton();
        if (state.t >= state.animDur) state.t = 0;
        state.lastTs = 0;
        requestAnimationFrame(tick);
        setStatus("预览中 · 返回绑定姿态后才能摆位", "warn");
      });
    }
    state.playing = !state.playing;
    if (!state.playing) gazePause();   /* 普通动画暂停时同样保持眼珠现状 */
    syncPlayButton();
    if (state.playing) {
      if (state.t >= state.animDur) state.t = 0;
      state.lastTs = 0;
      requestAnimationFrame(tick);
      setStatus("预览中 · 返回绑定姿态后才能摆位", "warn");
    } else setStatus("已暂停");
  }
  /* 播放时钟：单一 requestAnimationFrame + 代次防「快速暂停再播放出现两条循环」（契约 §7） */
  let playbackGen = 0;
  let playbackRaf = 0;
  function startPlaybackLoop() {
    if (playbackRaf) return;
    const gen = ++playbackGen;
    const step = (ts) => {
      playbackRaf = 0;
      if (gen !== playbackGen || !state.playing) return;
      tick(ts, gen);
    };
    playbackRaf = requestAnimationFrame(step);
  }
  function stopPlaybackLoop() {
    playbackGen++;
    if (playbackRaf) {
      cancelAnimationFrame(playbackRaf);
      playbackRaf = 0;
    }
  }

  function tick(ts, gen) {
    if (!state.playing) return;
    if (gen !== undefined && gen !== playbackGen) return;
    /* 0.9.85：虚拟条目「眼珠跟随鼠标」不推进时间轴 —— 它由鼠标事件驱动。
       这里只保持 rAF 活着，让 onPointerMove 期间能持续重绘。 */
    if (isGazeAnim(state.anim)) {
      state.lastTs = ts;
      startPlaybackLoop();
      return;
    }
    if (!state.lastTs) state.lastTs = ts;
    const dt = Math.min(0.1, (ts - state.lastTs) / 1000) * state.speed;
    state.lastTs = ts;
    const range = previewRangeOf(state.anim);
    const from = range.from;
    const to = range.to > from ? range.to : state.animDur;
    state.t += dt;
    if (state.t >= to) {
      if (state.loop && to > from) state.t = from + ((state.t - from) % (to - from));
      else {
        state.t = to;
        state.playing = false;
        syncPlayButton();
      }
    }
    if (state.t < from) state.t = from;
    updateTimeLabel();
    render();
    dsSyncPlayhead();
    if (state.playing) startPlaybackLoop();
  }
  function updateTimeLabel() {
    el0("timeLabel").textContent = state.t.toFixed(2) + " / " + state.animDur.toFixed(2) + " s";
    if (state.animDur > 0) el0("scrub").value = Math.round((1000 * state.t) / state.animDur);
  }

  /* ==========================================================================
   * 10c. 眼珠跟随鼠标（0.9.85）—— 编辑器内的虚拟动画
   * ======================================================================
   * 需求（用户原话）：动画分页的 Spine 部分再补上眨眼动画和鼠标跟随眼珠动画；
   *   眼珠跟随在点播放后开始跟随，停止则保持不动，更换动画选择后复位。
   *
   * 为什么不做成 model.json 里的动画：
   *   · 跟随是**实时**的（鼠标一动就要跟），而 Spine 动画是按时间轴采样的；
   *   · 「暂停保持、换动画复位」是状态机语义，不是关键帧语义。
   * 所以做成虚拟条目：数据全靠 state.gaze，求值时叠加到 eye-L / eye-R 的局部 translate。
   *
   * 为什么不切 gaze_* 贴图：像素比对过 6 张 gaze_* 的不透明像素质心，
   *   差异 < 0.03px（全在正中），说明贴图本身没有方向偏移 —— 位移只能靠骨。
   * ====================================================================== */
  const GAZE_VIRTUAL_ID = "__gaze_follow__";
  const GAZE_VIRTUAL_DUR = 4;     /* 虚拟条目的名义时长（秒）——只用于时间轴显示与循环推进 */
  const GAZE_LIMIT = 10;          /* 最大偏移（世界单位） */
  const GAZE_RANGE_PX = 60;       /* 鼠标满量程距离（屏幕像素）—— 极小，稍微一动就拉满档 */
  const GAZE_SMOOTH = 0.55;       /* 插值平滑：0=瞬间到位，1=不动 */

  function gazeActive() {
    return !!(state.gaze && state.gaze.active);
  }
  /** 是否处于「跟随形态」：激活中 **或** 已有偏移冻结着（暂停后保持不动）。 */
  function gazeEngaged() {
    const g = state.gaze;
    if (!g) return false;
    return !!g.active || gazeOffsetNonZero();
  }
  function gazeOffsetNonZero() {
    const g = state.gaze;
    return !!(g && (Math.abs(g.dx) > 1e-6 || Math.abs(g.dy) > 1e-6));
  }
  /** 当前动画是否是那条虚拟的「眼珠跟随」 */
  function isGazeAnim(name) {
    return name === GAZE_VIRTUAL_ID;
  }

  /**
  /**
  /**
   * 构造眼珠槽的附件覆盖（Map<槽索引, 附件名>）—— 用贴图集里现成的 `gaze_*` 变体。
   *
   * 为什么这是唯一正确方案（0.9.94 定稿，前面错了三版）：
   *   · **移骨不行**：合成图 `eye_L_100` 是整只眼（眼白+虹膜同图），移骨会把眼白一起推走。
   *   · **分层不行**：`iris_*` 的不透明区域 **76×82**，而眼眶 `eye_L_100` 只有 **97×80** ——
   *     虹膜比眼眶还高，结构上装不进去（最优对齐仍有 175 像素溢出）。
   *   · **gaze_* 是对的**：24 张变体的**整眼轮廓与 eye_L_100 完全相同**（都是 x[1,97] y[1,80]、97×80），
   *     只有虹膜位置不同 —— 天生「眼白固定、虹膜移动」，且绝不会溢出眼眶。
   *
   * 左右无需镜像：实测世界 x 位移两侧同向（L: xm06 −7.5 / xp06 +7.9；R: xm06 −8.1 / xp06 +7.8）。
   *
   * 命名即档位：x ∈ {xm06, xm03, xz00, xp03, xp06}，y ∈ {ym04, ym02, yz00, yp02, yp04}。
   * 5×5 = 25 个位置只有 24 张 —— **缺正中的 `xz00_yz00`**，中心态回退到 `eye_*_100`。
   */
  const GAZE_X_LABELS = ["xm06", "xm03", "xz00", "xp03", "xp06"];
  const GAZE_Y_LABELS = ["ym04", "ym02", "yz00", "yp02", "yp04"];

  /** 世界偏移 → 5 档网格索引（0..4） */
  function gazeGridIndex(v) {
    const t = clamp(v / Math.max(1e-6, GAZE_LIMIT), -1, 1);
    return clamp(Math.round((t + 1) * 2), 0, 4);
  }

  /** 构造 attachmentOverrides（Map<槽索引, 附件名>）；不跟随时返回 null */
  function gazeAttachmentOverrides() {
    if (!gazeActive() || !state.model) return null;
    const map = new Map();
    const g = state.gaze;
    const skin = state.model.skins.get(state.model.defaultSkinName);
    if (!skin || !skin.attachments) return null;
    const ix = gazeGridIndex(g.dx);
    const iy = gazeGridIndex(g.dy);
    for (const side of ["L", "R"]) {
      const si = state.slots.findIndex((s) => s.name === "眼珠_" + side);
      if (si < 0) continue;
      const bag = skin.attachments.get(si);
      if (!bag || typeof bag.get !== "function") continue;
      const xl = GAZE_X_LABELS[ix];
      const yl = GAZE_Y_LABELS[iy];
      const name = (xl === "xz00" && yl === "yz00")
        ? "eye_" + side + "_100"
        : "gaze_" + side + "_" + xl + "_" + yl;
      if (bag.get(name)) map.set(si, name);
    }
    return map.size ? map : null;
  }

  /** 把鼠标画布坐标换算成眼珠偏移（世界单位，夹在 GAZE_LIMIT 内） */
  function gazeOffsetFromPointer(px, py) {
    const head = state.bones && state.bones["head"];
    if (!head) return { dx: 0, dy: 0 };
    /* 用 head 的世界原点当注视中心：鼠标离开中心越远，眼珠偏得越多 */
    const hw = lastPose && lastPose.world ? lastPose.world[head.index] : null;
    if (!hw) return { dx: 0, dy: 0 };
    const hp = proj(hw.tx, hw.ty);
    /* 0.9.100：满量程从「画布短边的一半」（384px）改成**固定 150px**。
       原来要鼠标跑到画布边缘才接近 ±10，而画布只有 680 宽 → 实际只用到中间 3 档，
       每档移位 7~8 世界单位，在 0.5 缩放下只有 3~4 屏幕像素 —— 视觉上「眼珠不动」。
       150px 让鼠标稍微偏离头部就到边缘档位，follow 立刻可见。 */
    const full = GAZE_RANGE_PX;
    let nx = (px - hp.x) / full;
    let ny = (py - hp.y) / full;
    const len = Math.hypot(nx, ny);
    if (len > 1) { nx /= len; ny /= len; }
    /* 画布 y 向下，世界 y 向上 → 取反 */
    return {
      dx: clamp(nx * GAZE_LIMIT, -GAZE_LIMIT, GAZE_LIMIT),
      dy: clamp(-ny * GAZE_LIMIT, -GAZE_LIMIT, GAZE_LIMIT),
    };
  }

  /** 让眼珠朝鼠标看（仅在跟随激活且鼠标在画布上时生效） */
  function updateGaze(px, py) {
    if (!gazeActive()) return false;
    const target = gazeOffsetFromPointer(px, py);
    const g = state.gaze;
    const ndx = g.dx + (target.dx - g.dx) * GAZE_SMOOTH;
    const ndy = g.dy + (target.dy - g.dy) * GAZE_SMOOTH;
    if (Math.abs(ndx - g.dx) < 1e-4 && Math.abs(ndy - g.dy) < 1e-4) return false;
    g.dx = ndx;
    g.dy = ndy;
    return true;
  }

  /** 停止跟随但**保持当前偏移**（用户要求：停止则保持不动） */
  function gazePause() {
    if (!state.gaze) return;
    state.gaze.active = false;
    /* dx/dy 故意不归零 */
  }

  /** 复位（用户要求：更换动画选择后复位） */
  function gazeReset() {
    if (!state.gaze) return;
    state.gaze.active = false;
    state.gaze.dx = 0;
    state.gaze.dy = 0;
  }

  /* ==========================================================================
   * 10b. 表情分页：差分试装（纯预览覆盖，不写模型）
   *   覆盖值只活在 state.expr.override，经 evalPose 的 attachmentOverrides 叠加，
   *   不进入 state.raw / dirty / 保存补丁；眼睛互斥：整眼(whole) 与眨眼三槽二选一。
   * ====================================================================== */
  const EXPR_MOUTH_ORDER = ["mouth_无表情", "mouth_微笑", "mouth_快乐", "mouth_愉快", "mouth_调皮", "mouth_不开心", "mouth_难过"];
  const EYE_BLINK_SLOT_KEYS = ["blinkL", "blinkR"];
  const EXPR_SLOT_KEYS = ["mouth", "mouthFx", "wholeL", "wholeR", "whiteL", "irisL", "lashL", "whiteR", "irisR", "lashR", "browL", "browR"];
  /** 眨眼三槽既可能平铺（whiteL/irisL/lashL）也可能嵌在 blinkL 对象里（本 rig 的写法） */
  const EXPR_EYE_SLOT_FALLBACKS = {
    whiteL: ["blinkL", "white"],
    irisL: ["blinkL", "iris"],
    lashL: ["blinkL", "lash"],
    whiteR: ["blinkR", "white"],
    irisR: ["blinkR", "iris"],
    lashR: ["blinkR", "lash"],
  };
  /**
   * 眨眼组：档位 → 每槽附件。
   * v3.1：档位清单来自 `catalog.expressionParts.眨眼_左/眨眼_右.levels`（权威索引）；
   * v2 旧包没有 catalog → 回退到 model 附件推断；
   * 每档的附件按 model 里的真实命名解析（`eye_{L|R}_{lv}` / `lash_{L|R}_{lv}`），
   * 0% 档没有融合眼，只留 `lash_{L|R}_0`（与契约 §1.4 一致）。
   * 不再读 rig-meta.expressions.blink（该段在数据层 v2 已移除）。
   */
  function exprBlinkLevels(side) {
    const key = side === "L" ? "眨眼_左" : "眨眼_右";
    /* v3.1：档位来自 catalog.expressionParts（权威索引）；
       v2 旧包没有 catalog → 回退到 model 的附件推断（原行为）。 */
    const rawLevels = catalogBlinkLevels(key);
    if (!rawLevels || !rawLevels.length) return null;
    const slotOf = side === "L"
      ? { white: "眼白_L", iris: "眼珠_L", lash: "睫毛_L" }
      : { white: "眼白_R", iris: "眼珠_R", lash: "睫毛_R" };
    const has = (slot, name) => exprAttachmentsFor(slot).indexOf(name) >= 0;
    const levels = [];
    for (const lv of rawLevels) {
      const level = Number(lv);
      if (!Number.isFinite(level)) continue;
      const slots = {};
      // 眼白槽在静态模型里恒为 null（融合件自带眼白），这里显式给出以保持「三槽同步」
      slots[slotOf.white] = null;
      const irisName = "eye_" + side + "_" + level;
      slots[slotOf.iris] = level > 0 && has(slotOf.iris, irisName) ? irisName : null;
      const lashName = "lash_" + side + "_" + level;
      slots[slotOf.lash] = has(slotOf.lash, lashName) ? lashName : null;
      levels.push({ key: String(level), level, slots });
    }
    levels.sort((a, b) => a.level - b.level);
    return levels.length ? levels : null;
  }

  function animEditLib() {
    return window.SpineAnimEdit || null;
  }

  function slotGroupLib() {
    return window.SpineSlotGroups || null;
  }

  /* ==========================================================================
   * 10a. 显示顺序：PS 风格图层组（数据来自 rig-meta.slotGroups）
   *   分组只影响「显示顺序」视图的呈现与拖拽约束；折叠/组显隐都只存内存，不落盘。
   * ====================================================================== */
  /** groups 数组顺序 = 最前 → 最背；组内 slots 顺序 = model.slots 顺序（0 最背） */
  function slotGroups() {
    return state.slotGroup.groups;
  }

  function slotGroupFallbackReason() {
    const meta = state.expr.meta;
    if (state.slotGroup.source === "invalid") return state.slotGroup.reason || "分组校验未通过";
    if (!state.model) return "未载入";
    if (state.expr.metaState === "loading") return "正在读取 rig-meta…";
    if (state.expr.metaState === "error") return "rig-meta 解析失败";
    if (!meta) return "无 rig-meta";
    if (!meta.slotGroups) return "rig-meta 无 slotGroups";
    return "分组不可用";
  }

  /** 从 rig-meta 重建分组（模型/rig-meta 代次变化时调用）；非法分组一律回退平铺 + 警告 */
  function refreshSlotGroups() {
    const lib = slotGroupLib();
    const meta = state.expr.meta;
    const key = [state.label, state.slots.length, meta && meta.modelVersion, meta && meta.source && meta.source.sha256].join("|");
    if (key === state.slotGroup.metaKey && state.slotGroup.groups.length) return;
    state.slotGroup.metaKey = key;
    const raw = meta && Array.isArray(meta.slotGroups) ? meta.slotGroups : null;
    if (!lib || !raw) {
      applySlotGroups([], "none");
      return;
    }
    const normalized = lib.normalizeGroups(raw, state.slots);
    if (!normalized.length) {
      applySlotGroups([], "invalid", "slotGroups 校验未通过（未知/重复成员、未全覆盖、z 不连续或组序不对）");
      return;
    }
    applySlotGroups(normalized, "meta");
  }

  /**
   * 应用分组：再过一次契约校验（覆盖完整 / 每组连续 / 组序单调），非法 → 全平铺 + 警告。
   * @param {Array} groups normalizeGroups 的产物
   * @param {"meta"|"none"|"invalid"} sourceKind
   * @param {string} [invalidReason]
   */
  function applySlotGroups(groups, sourceKind, invalidReason) {
    const lib = slotGroupLib();
    const candidate = Array.isArray(groups) ? groups : [];
    let finalGroups = [];
    let source = sourceKind === "meta" ? "none" : sourceKind || "none";
    let reason = invalidReason || "";
    if (candidate.length && lib) {
      const check = lib.validateGroups(candidate, state.slots);
      if (check.ok) {
        finalGroups = candidate;
        source = "meta";
      } else {
        reason = check.reasons.slice(0, 2).join("；");
        source = "invalid";
      }
    }
    state.slotGroup.groups = finalGroups;
    state.slotGroup.source = finalGroups.length ? "meta" : source === "invalid" ? "invalid" : "none";
    state.slotGroup.reason = state.slotGroup.source === "invalid" ? reason : "";
    const validIds = new Set(finalGroups.map((g) => g.gid));
    for (const gid of Array.from(state.slotGroup.collapsed)) if (!validIds.has(gid)) state.slotGroup.collapsed.delete(gid);
    if (state.slotGroup.source === "invalid" && !state.slotGroup.warned) {
      state.slotGroup.warned = true;
      notice("warn", "rig-meta.slotGroups 不可用（" + reason + "），显示顺序回退为平铺列表");
      setStatus("分组不可用，显示顺序已回退平铺：" + reason, "warn");
    }
  }

  /** 用当前 state.slots 重新规范化分组（组序/成员来自 rig-meta，不改 meta、不改组序） */
  function renormSlotGroups() {
    const lib = slotGroupLib();
    const meta = state.expr.meta;
    const raw = meta && Array.isArray(meta.slotGroups) ? meta.slotGroups : null;
    if (!lib || !raw) return;
    const normalized = lib.normalizeGroups(raw, state.slots);
    if (!normalized.length) {
      applySlotGroups([], "invalid", "调整后 slotGroups 不再满足契约（z 不连续或组序不对）");
      return;
    }
    applySlotGroups(normalized, "meta");
    /* 分组内容变了，metaKey 也要失效，下一次 syncList 重新计算 */
    state.slotGroup.metaKey = "";
  }

  function slotGroupCollapsed(gid) {
    const lib = slotGroupLib();
    if (lib) return lib.isCollapsed(state.slotGroup.collapsed, gid);
    return state.slotGroup.collapsed.has(gid);
  }

  function toggleSlotGroupCollapsed(gid) {
    if (!gid) return;
    if (state.slotGroup.collapsed.has(gid)) state.slotGroup.collapsed.delete(gid);
    else state.slotGroup.collapsed.add(gid);
    syncList();
    const searching = !!state.search.trim();
    const collapsedNow = state.slotGroup.collapsed.has(gid);
    if (searching) {
      setStatus(
        "已记录「" + groupNameById(gid) + "」的折叠偏好（" + (collapsedNow ? "折叠" : "展开") + "）；搜索中分组强制展开，清空搜索后生效"
      );
      return;
    }
    setStatus((collapsedNow ? "已折叠" : "已展开") + "分组「" + groupNameById(gid) + "」");
  }

  function groupNameById(gid) {
    for (const g of slotGroups()) if (g.gid === gid) return g.name;
    return gid || "";
  }

  /** 组的显隐三态（按完整成员；搜索只影响显示不影响三态） */
  function slotGroupVis(group) {
    const lib = slotGroupLib();
    if (!lib || !group) return { state: "all", visible: 0, hidden: 0, total: 0 };
    return lib.computeGroupVis(group.slots, state.hidden);
  }

  /** 组眼睛点击：全显示→全隐藏；全隐藏/部分→全显示（只改查看器状态，不写模型、不进撤销） */
  function toggleSlotGroupHidden(gid) {
    const lib = slotGroupLib();
    const group = slotGroups().filter((g) => g.gid === gid)[0];
    if (!lib || !group) return;
    const vis = lib.computeGroupVis(group.slots, state.hidden);
    const next = lib.approachGroupVis(vis.state, vis.hidden);
    for (const name of group.slots) {
      if (next.add) state.hidden.add(name);
      else if (next.remove) state.hidden.delete(name);
    }
    syncList();
    syncInspector();
    syncStageOverlays();
    render();
    setStatus(
      (next.action === "hide" ? "已隐藏分组「" : "已显示分组「") +
        group.name +
        "」（" +
        group.size +
        " 个部件，仅影响查看器不写模型）"
    );
  }

  /** 组内行的下标顺序：显示顺序 = 下标倒序（上方在前） */
  function slotIndicesDesc(indices) {
    return (Array.isArray(indices) ? indices : []).slice().sort((a, b) => b - a);
  }

  function slotHayFor(index) {
    const slot = state.slots[index];
    if (!slot) return "";
    const att = state.frame ? attachmentAt(state.frame.pose, slot.index) : null;
    return slotHay(slot, att);
  }

  /** 解析 rig-meta 里的槽名（blinkL/blinkR 是对象；三槽可平铺或嵌在 blink 对象里） */
  function exprSlotResolve(key) {
    const meta = state.expr.meta;
    if (!meta || !meta.slots || typeof meta.slots !== "object") return null;
    const raw = meta.slots[key];
    if (raw && typeof raw === "object") {
      const white = raw.white || null;
      const iris = raw.iris || null;
      const lash = raw.lash || null;
      if (!white && !iris && !lash) return null;
      return { kind: "blink", white: white, iris: iris, lash: lash };
    }
    if (typeof raw === "string" && raw) return { kind: "single", name: raw };
    const fb = EXPR_EYE_SLOT_FALLBACKS[key];
    if (fb) {
      const blink = meta.slots[fb[0]];
      const name = blink && typeof blink === "object" ? blink[fb[1]] : null;
      if (typeof name === "string" && name) return { kind: "single", name: name };
    }
    return null;
  }

  /** 表情页可用的全部槽键：常量键 + rig-meta 原生的 blinkL/blinkR（对象形式＝眨眼组） */
  function exprAllSlotKeys() {
    const meta = state.expr.meta;
    const out = EXPR_SLOT_KEYS.slice();
    if (meta && meta.slots && typeof meta.slots === "object") {
      for (const k of EYE_BLINK_SLOT_KEYS) {
        if (out.indexOf(k) < 0 && meta.slots[k] && typeof meta.slots[k] === "object") out.push(k);
      }
    }
    return out;
  }

  /** rig-meta 槽键 → 实际 slot 名列表 */
  function exprSlotNameMap() {
    const out = Object.create(null);
    for (const key of exprAllSlotKeys()) {
      const def = exprSlotResolve(key);
      if (!def) continue;
      if (def.kind === "single") out[key] = [def.name];
      else out[key] = [def.white, def.iris, def.lash].filter(Boolean);
    }
    return out;
  }

  function exprSlotByName(name) {
    if (!name) return -1;
    for (let i = 0; i < state.slots.length; i++) if (state.slots[i].name === name) return i;
    return -1;
  }

  /** slot name -> 该槽在 default skin 下的附件名（升序，稳定） */
  function slotAttachmentNames(slotName) {
    const model = state.model;
    if (!model || !model.skins) return [];
    const idx = exprSlotByName(slotName);
    if (idx < 0) return [];
    const skin = model.skins.get(model.defaultSkinName) || model.skins.get("default");
    if (!skin || !skin.attachments) return [];
    const bag = skin.attachments.get(idx);
    return bag ? Array.from(bag.keys()) : [];
  }

  /** 表情页槽键 → catalog 语义部位名（用于取权威允许值） */
  const CATALOG_PART_OF_SLOT_KEY = {
    mouth: "嘴巴",
    mouthFx: "嘴巴特效",
    wholeL: "左眼",
    wholeR: "右眼",
    browL: "眉毛_左",
    browR: "眉毛_右",
  };

  /** slot name -> 全部 attachments（去重排序） */
  function exprAttachmentsFor(slotName) {
    const model = state.model;
    if (!model || !model.skins || !model.skins.size) return [];
    const idx = exprSlotByName(slotName);
    if (idx < 0) return [];
    const seen = new Set();
    model.skins.forEach((skin) => {
      const bag = skin.attachments && skin.attachments.get(idx);
      if (bag) bag.forEach((_att, name) => seen.add(name));
    });
    return Array.from(seen).sort();
  }

  /**
   * v3.1 §5b：某语义部位的值是否合法 —— **只看 catalog**。
   * 返回 {checked, ok, reason}：
   *   checked=false 表示没有 catalog（v2 旧包）→ 调用方保持原行为，不判非法。
   */
  function catalogValueCheck(part, value) {
    if (value === null || value === undefined) return { checked: false, ok: true, reason: "" };
    const vals = catalogPartValues(part);
    if (!vals) return { checked: false, ok: true, reason: "" };
    const ok = vals.indexOf(value) >= 0;
    return {
      checked: true,
      ok: ok,
      reason: ok ? "" : part + "：" + value + " 不在 catalog 允许值内",
    };
  }

  /** 眨眼组的 iris/lash 是否在 catalog 对应槽内（§12.5b C6） */
  function catalogBlinkCheck(part, group) {
    if (!group || typeof group !== "object") return { checked: false, ok: true, reason: "" };
    const c = state.expr.catalog;
    if (!catalogReady() || !c.slots) return { checked: false, ok: true, reason: "" };
    const node = (c.expressionParts || {})[part];
    if (!node || !Array.isArray(node.slots)) return { checked: false, ok: true, reason: "" };
    const side = part.endsWith("左") ? "L" : "R";
    const pairs = [["iris", "眼珠_" + side], ["lash", "睫毛_" + side]];
    for (const pair of pairs) {
      const nm = group[pair[0]];
      if (nm === null || nm === undefined) continue;
      const bag = (c.slots[pair[1]] || {}).attachments || [];
      if (bag.indexOf(nm) < 0) {
        return { checked: true, ok: false, reason: part + "." + pair[0] + "：" + nm + " 不在 catalog 的 " + pair[1] + " 槽" };
      }
    }
    return { checked: true, ok: true, reason: "" };
  }

  /** 表达式覆盖 → attachmentOverrides（Map<slotIndex, attName|null>）；空覆盖返回 null */
  function exprOverrideMap() {
    const box = state.expr.override;
    const names = box ? Object.keys(box) : [];
    if (!names.length || !state.model) return null;
    const map = new Map();
    for (const name of names) {
      const idx = exprSlotByName(name);
      if (idx < 0) continue;
      map.set(idx, box[name]);
    }
    return map.size ? map : null;
  }

  /** 槽的当前生效附件名（覆盖优先，其次 setup/当前姿态） */
  function exprCurrentAttachment(slotName) {
    const box = state.expr.override;
    if (box && Object.prototype.hasOwnProperty.call(box, slotName)) {
      if (box[slotName] === null) return { name: null, source: "override" };
      const att = attachmentAt(state.frame && state.frame.pose, exprSlotByName(slotName));
      return { name: box[slotName], source: "override", resolved: !!att };
    }
    const idx = exprSlotByName(slotName);
    const att = attachmentAt(state.frame && state.frame.pose, idx);
    return { name: attachmentRawName(att), source: "pose" };
  }

  /** 已载入 model 时该附件的归一化附件名（用于高亮当前项） */
  function attachmentRawName(att) {
    return (att && (att.path || att.id || att.name)) || null;
  }

  /** default skin 里某槽的 setup 附件名（直接读原始 JSON：Spine 4.2 的 slots[].attachment / skins 数组或对象） */
  function setupAttachmentName(slotName) {
    const raw = state.raw;
    if (!raw || typeof raw !== "object") return null;
    if (Array.isArray(raw.slots)) {
      for (const s of raw.slots) {
        if (s && s.name === slotName) {
          const a = s.attachment;
          return typeof a === "string" && a ? a : null;
        }
      }
      return null;
    }
    /* 兜底：从 default skin 的 attachments 里取该槽第一个附件名 */
    if (!raw.skins) return null;
    const skinName = (state.model && state.model.defaultSkinName) || "default";
    let skinRaw = null;
    if (Array.isArray(raw.skins)) {
      skinRaw = raw.skins.filter((s) => s && s.name === skinName)[0] || raw.skins[0] || null;
    } else if (typeof raw.skins === "object") {
      skinRaw = raw.skins[skinName] || raw.skins.default || null;
    }
    if (!skinRaw || !skinRaw.attachments) return null;
    const bag = skinRaw.attachments[slotName];
    if (!bag || typeof bag !== "object") return null;
    const names = Object.keys(bag);
    if (!names.length) return null;
    const idx = exprSlotByName(slotName);
    const liveName = attachmentRawName(attachmentAt(state.frame && state.frame.pose, idx));
    if (liveName && names.indexOf(liveName) >= 0) return liveName;
    return names[0];
  }

  /** 重置用的 11 槽 setup 快照（不是简单 clear：动画帧可能仍让眨眼闭眼） */
  function exprSetupSnapshot() {
    const out = Object.create(null);
    let missing = 0;
    const names = exprSlotNameMap();
    for (const key of Object.keys(names)) {
      for (const slotName of names[key]) {
        const att = setupAttachmentName(slotName);
        if (att === null) missing++;
        out[slotName] = att;
      }
    }
    return { snapshot: out, missing: missing };
  }

  /** 重置：清掉动画预览 + 覆盖，让预览回到骨骼绑定姿态的 setup 快照 */
  function exprResetToSetup() {
    const hadAnim = !!state.anim;
    const snap = exprSetupSnapshot();
    state.expr.override = snap.snapshot;
    state.expr.set = null;
    /* 0.9.27：重置是「清空当前预览」，但它**不改变你要写回哪个事件** ——
       用户重置后往往还想把「默认值」存回同一个事件。只有换包才清 saveTarget。 */

    state.expr.warnings = [];
    if (hadAnim) setAnim("");
    refreshExprUI();
    render();
    setStatus(
      "已重置表情预览：" + (hadAnim ? "回到绑定姿态并" : "") + "恢复 setup 附件快照（" + Object.keys(snap.snapshot).length + " 槽，含空槽）"
    );
    return true;
  }

  function exprResetOverrides(statusText) {
    state.expr.override = Object.create(null);
    state.expr.set = null;
    /* 0.9.27：这是**换包/清空预览**的路径（不是用户主动重置），连同保存目标一起清掉，
       避免把新包的预览写到旧包的事件 id 上。 */
    state.expr.saveTarget = null;
    state.expr.warnings = [];
    refreshExprUI();
    render();
    if (statusText) setStatus(statusText);
  }

  /** 互斥：给定覆盖后的槽名集合，返回被清空的槽（眨眼组 = 眼白/眼珠/睫毛 六槽） */
  function exprEnforceExclusivity(box, touchedNames) {
    const cleared = [];
    const names = exprSlotNameMap();
    const whole = [].concat(names.wholeL || [], names.wholeR || []);
    const blink = [].concat(names.whiteL || [], names.irisL || [], names.lashL || [], names.whiteR || [], names.irisR || [], names.lashR || []);
    for (const n of touchedNames) {
      if (whole.indexOf(n) >= 0 && box[n] !== null && box[n] !== undefined) {
        for (const b of blink) if (Object.prototype.hasOwnProperty.call(box, b) && box[b] !== null) { box[b] = null; cleared.push(b); }
      }
      if (blink.indexOf(n) >= 0 && box[n] !== null && box[n] !== undefined) {
        for (const w of whole) if (Object.prototype.hasOwnProperty.call(box, w) && box[w] !== null) { box[w] = null; cleared.push(w); }
      }
    }
    return cleared;
  }

  /** 应用一份完整 11 槽快照（先在本地校验，全部通过才原子应用） */
  function applyExprSet(name) {
    const meta = state.expr.meta;

    /* task-9：v2 优先 —— 套装 = 事件名，内容 = events[].expression（7 部位） */
    const parts = exprForEvent(name);
    if (parts) {
      const base = exprSetupSnapshot().snapshot;
      const next = exprSlotsFromParts(parts, base);
      const issues = [];
      const touched = [];
      for (const slotName of Object.keys(next)) {
        if (exprSlotByName(slotName) < 0) continue;
        const att = next[slotName];
        if (att !== null && typeof att !== "string") {
          issues.push(slotName + "：附件名必须是字符串或 null");
          continue;
        }
        if (att !== null && exprAttachmentsFor(slotName).indexOf(att) < 0) {
          issues.push(slotName + "：找不到附件 " + att);
          continue;
        }
        touched.push(slotName);
      }
      /* v3.1：catalog 权威判定 —— 每个部位的值必须在 catalog 允许值内 */
      if (catalogReady()) {
        for (const part of Object.keys(parts)) {
          const v = parts[part];
          if (part === "眨眼_左" || part === "眨眼_右") {
            const bc = catalogBlinkCheck(part, v);
            if (bc.checked && !bc.ok) issues.push(bc.reason);
            continue;
          }
          const vc = catalogValueCheck(part, v);
          if (vc.checked && !vc.ok) issues.push(vc.reason);
        }
      }
      if (issues.length) {
        state.expr.warnings = issues;
        refreshExprUI();
        setStatus("表情 " + name + " 未应用：" + issues.length + " 项附件不匹配（见表情页告警）", "warn");
        return false;
      }
      exprEnforceExclusivity(next, touched);
      state.expr.override = next;
      state.expr.set = name;
      /* 0.9.27：点某个事件 = 同时把它设为**保存目标**；之后微调不会清掉它 */
      state.expr.saveTarget = name;
      state.expr.mode = parts["左眼"] != null || parts["右眼"] != null ? "whole" : "normal";
      state.expr.warnings = [];
      refreshExprUI();
      /* 0.9.21：**必须重绘画布**。这里原来只调 refreshExprUI()（只重绘右侧面板），
         画布保持旧图，直到播放推进/鼠标移动等顺带触发一次 render 才变 ——
         用户感知就是「点了没反应、等一会才生效」（实测点击同步耗时仅 0.9ms，
         所以从来不是性能问题）。同类的 applyExprBlinkLevel / applyExprAttachment /
         exprResetToSetup 末尾都有 render()，只有这里漏了。 */
      render();
      setStatus("已应用表情 " + name + "（" + state.expr.mode + " · " + touched.length + " 槽）", "info");
      return true;
    }

    /* 表情数据只在 events.json；不存在第二处来源，故无回退分支 */
    setStatus("找不到表情 " + name + "（events.json 里没有该事件）", "warn");
    return false;
  }

  /** 应用眨眼档位（L/R 各一档；level=null 表示三槽清空） */
  function applyExprBlinkLevel(side, level) {
    const slotKeys = side === "L" ? ["whiteL", "irisL", "lashL"] : ["whiteR", "irisR", "lashR"];
    const names = exprSlotNameMap();
    const levels = exprBlinkLevels(side);
    const box = Object.assign(Object.create(null), state.expr.override);
    const touched = [];
    if (level === null) {
      for (const k of slotKeys) for (const n of names[k] || []) { box[n] = null; touched.push(n); }
      state.expr.override = box;
      state.expr.mode = "normal";
      state.expr.set = null;
      state.expr.warnings = [];
      refreshExprUI();
      render();
      setStatus("已清空 " + side + " 侧眨眼三槽（仅预览）");
      return true;
    }
    const lv = levels && levels.filter((e) => e.level === level)[0];
    if (!lv) {
      setStatus("catalog.expressionParts 里没有 " + side + " 侧眨眼档位 " + level + "%", "warn");
      return false;
    }
    const issues = [];
    for (const n of Object.keys(lv.slots)) {
      const att = lv.slots[n];
      if (exprSlotByName(n) < 0) { issues.push(n + "：模型里没有这个槽"); continue; }
      if (att !== null && exprAttachmentsFor(n).indexOf(att) < 0) { issues.push(n + "：找不到附件 " + att); continue; }
      box[n] = att;
      touched.push(n);
    }
    if (issues.length) {
      state.expr.warnings = issues;
      refreshExprUI();
      setStatus("眨眼档位 " + level + "% 未应用：" + issues.length + " 项附件不匹配", "warn");
      return false;
    }
    exprEnforceExclusivity(box, touched);
    state.expr.override = box;
    state.expr.mode = "normal";
    state.expr.set = null;
    state.expr.warnings = [];
    refreshExprUI();
    render();
    setStatus("已应用 " + side + " 侧眨眼 " + level + "%（三槽快照，仅预览）");
    return true;
  }

  /** 单槽（或眨眼三槽组）附件覆盖（含互斥清理） */
  function applyExprAttachment(slotKey, attName) {
    const names = exprSlotNameMap();
    const slotNames = names[slotKey];
    if (!slotNames || !slotNames.length) {
      setStatus("表情槽 " + slotKey + " 未在 rig-meta 里定义，无法覆盖", "warn");
      return false;
    }
    /* 眨眼组按「眼珠槽」校验附件名（eye_L_N 是真实附件；眼白/L 与睫毛/L 各有自己的档位） */
    const probeSlot = slotNames.length > 1 ? slotNames[1] || slotNames[0] : slotNames[0];
    if (attName !== null && exprAttachmentsFor(probeSlot).indexOf(attName) < 0) {
      state.expr.warnings = [probeSlot + "：找不到附件 " + attName];
      refreshExprUI();
      setStatus("附件 " + attName + " 不存在于 " + probeSlot + "，已拒绝", "warn");
      return false;
    }
    /* v3.1：catalog 是权威。有 catalog 时，值必须落在该部位允许值内，否则拒绝。
       v2 旧包没有 catalog → checked=false，保持原行为（只看 model）。 */
    const catPart = CATALOG_PART_OF_SLOT_KEY[slotKey];
    const verdict = catalogValueCheck(catPart, attName);
    if (verdict.checked && !verdict.ok) {
      state.expr.warnings = [verdict.reason];
      refreshExprUI();
      setStatus(verdict.reason + "，已拒绝", "warn");
      return false;
    }
    const box = Object.assign(Object.create(null), state.expr.override);
    for (const n of slotNames) box[n] = attName;
    exprEnforceExclusivity(box, slotNames);
    state.expr.override = box;
    state.expr.set = null;
    state.expr.warnings = [];
    state.expr.mode = EYE_BLINK_SLOT_KEYS.indexOf(slotKey) >= 0 ? "normal" : slotKey === "wholeL" || slotKey === "wholeR" ? "whole" : state.expr.mode;
    refreshExprUI();
    render();
    setStatus((attName === null ? "已清空 " : "已试装 " + attName + " @ ") + slotNames.join("/") + "（仅预览）");
    return true;
  }

  /** spine 资源目录（rig-meta / idle-profile / lipsync 所在）
   *  v2：bundle.base 本身就是 spine 目录
   *  v3：bundle.base 是包根，spine 资源在 <base>/spine
   *  判定：索引 schemaVersion === 2 即为 v3 包。 */
  function spineDir() {
    const b = state.bundle;
    if (b && b.base) {
      const base = String(b.base).replace(/\/+$/, "");
      const sv = b.index && b.index.schemaVersion;
      return sv === 2 ? base + "/spine" : base;
    }
    const src = String(state.source || "");
    if (/^\/\//.test(src) || /^[a-z]+:\/\//i.test(src)) return null;
    const clean = src.replace(/^\//, "").replace(/[?#].*$/, "");
    if (clean && /\//.test(clean)) return clean.replace(/\/[^/]*$/, "");
    return null;
  }

  /** rig-meta 所在目录（= spine 目录） */
  function exprMetaBase() {
    return spineDir();
  }

  /* ---- v3.1 catalog（§5b）：权威索引 ---- */

  /** 包根：v3 的 bundle.base 即包根；v2 的 base 是 spine 目录，向上一级才是包根 */
  function packRootDir() {
    const b = state.bundle;
    if (!b || !b.base) return null;
    const base = String(b.base).replace(/\/+$/, "");
    const sv = b.index && b.index.schemaVersion;
    if (sv === 2) return base;                                  // v3：base 已是包根
    return /\/spine$/.test(base) ? base.slice(0, -"/spine".length) : base;
  }

  /** catalog 是否可用（ready 且有内容） */
  function catalogReady() {
    return state.expr.catalogState === "ready" && !!state.expr.catalog;
  }

  /** 某语义部位的允许值；catalog 不可用时返回 null（调用方回退到 model 推断） */
  function catalogPartValues(part) {
    const c = state.expr.catalog;
    if (!catalogReady() || !c.expressionParts) return null;
    const node = c.expressionParts[part];
    if (!node || !Array.isArray(node.values)) return null;
    return node.values;
  }

  /**
   * 某个**真实槽**的 catalog 允许值（v3.1）。
   * - 直接命中某部位的 slots（如 嘴巴 → 嘴巴 部位的 values）
   * - 眨眼组的子槽由 levels 推导：眼珠_L → eye_L_<lv>；睫毛_L → lash_L_<lv>
   * 返回 null 表示 catalog 没有约束该槽（调用方回退到 model 附件）。
   */
  function catalogSlotValues(slotName) {
    if (!catalogReady() || !slotName) return null;
    const parts = state.expr.catalog.expressionParts || {};
    for (const part of Object.keys(parts)) {
      const node = parts[part];
      if (Array.isArray(node.values) && (node.slots || []).indexOf(slotName) >= 0) {
        return node.values;
      }
    }
    const iris = /^眼珠_([LR])$/.exec(slotName);
    if (iris) {
      const lv = catalogBlinkLevels(iris[1] === "L" ? "眨眼_左" : "眨眼_右");
      return lv ? lv.filter((x) => x > 0).map((x) => "eye_" + iris[1] + "_" + x) : null;
    }
    const lash = /^睫毛_([LR])$/.exec(slotName);
    if (lash) {
      const lv = catalogBlinkLevels(lash[1] === "L" ? "眨眼_左" : "眨眼_右");
      return lv ? lv.map((x) => "lash_" + lash[1] + "_" + x) : null;
    }
    return null;
  }

  /** 表情页槽键：有 catalog 时用 rig-meta 原生的 blinkL/blinkR 分组键（才能渲染成一组档位）；
   *  无 catalog（v2 包）时保持原有的 whiteL/irisL/lashL 单槽行为不变。 */
  function exprPageSlotKeys() {
    const meta = state.expr.meta;
    const nativeBlink =
      catalogReady() && meta && meta.slots && meta.slots.blinkL && typeof meta.slots.blinkL === "object";
    if (!nativeBlink) return EXPR_SLOT_KEYS.slice();
    /* 0.9.35：这里原先是**硬编码列表**，新增的 mouthFx 不在里面 →
       就算 model / rig-meta / catalog 全都改好了，表情页也不会渲染它。
       直接给只会让人以为「结构没生效」。 */
    const out = ["mouth", "mouthFx", "wholeL", "wholeR", "blinkL"];
    const nativeBlinkR = meta.slots.blinkR && typeof meta.slots.blinkR === "object";
    if (nativeBlinkR) out.push("blinkR");
    else out.push("whiteR", "irisR", "lashR");
    out.push("browL", "browR");
    return out;
  }

  /** 眨眼档位（catalog 优先，回退 model 推断） */
  function catalogBlinkLevels(part) {
    const c = state.expr.catalog;
    if (!catalogReady() || !c.expressionParts) return null;
    const node = c.expressionParts[part];
    return node && Array.isArray(node.levels) ? node.levels : null;
  }

  /** 载入 catalog.json（v3.1）。v2 包没有该文件 → absent，静默回退。 */
  async function loadCatalog() {
    const e = state.expr;
    const gen = ++e.catGen;
    const root = packRootDir();
    if (!root) {
      e.catalogState = "absent";
      e.catalog = null;
      refreshExprUI();
      return false;
    }
    // 路径优先级：manifest.catalog → 包根 catalog.json
    let rel = "catalog.json";
    try {
      const mres = await voiceFetchWithTimeout("/" + root + "/manifest.json", {}, 6000);
      if (mres && mres.ok) {
        const man = JSON.parse(await mres.text());
        if (man && typeof man.catalog === "string" && man.catalog.trim()) rel = man.catalog.trim();
      }
    } catch (err) {
      /* manifest 读不到：回退同名文件 */
    }
    if (gen !== e.catGen) return false;
    const url = "/" + root + "/" + rel;
    e.catalogUrl = url;
    e.catalogState = "loading";
    refreshExprUI();
    let res = null;
    try {
      res = await voiceFetchWithTimeout(url, {}, 6000);
    } catch (err) {
      res = null;
    }
    if (gen !== e.catGen) return false;
    if (!res || res.status === 404) {
      // v2 包没有 catalog：不是错误，保持原行为
      e.catalogState = "absent";
      e.catalog = null;
      e.catalogError = "";
      e.catalogStale = false;
      onRigMetaChanged();
      return false;
    }
    if (!res.ok) {
      e.catalogState = "error";
      e.catalog = null;
      e.catalogError = "catalog HTTP " + res.status;
      onRigMetaChanged();
      return false;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(await res.text());
    } catch (err) {
      parsed = null;
    }
    if (gen !== e.catGen) return false;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      e.catalogState = "error";
      e.catalog = null;
      e.catalogError = "catalog.json 不是合法对象";
      onRigMetaChanged();
      return false;
    }
    e.catalog = parsed;
    e.catalogState = "ready";
    e.catalogError = "";
    e.catalogStale = false;
    onCatalogLoaded(parsed);
    onRigMetaChanged();
    return true;
  }

  /** C13 降级：rigSha256 与当前 model 不符 → 标记 catalogStale（不阻断加载） */
  function onCatalogLoaded(cat) {
    /* 只登记，不做网络校验：sha 比对放在 selftest / 校验脚本里做（浏览器不便算整个 model 的 sha） */
    state.expr.catalogStale = false;
  }

  /** catalog 只在需要时读一次（换包会重新读） */
  function maybeLoadCatalog() {
    const e = state.expr;
    const root = packRootDir();
    const want = root ? "/" + root + "/catalog.json" : "";
    if (!want) {
      if (e.catalogState !== "absent") {
        e.catalogState = "absent";
        e.catalog = null;
      }
      return false;
    }
    if (e.catalogState === "loading") return false;
    if (e.catalogState === "ready" && e.catalogUrl === want) return false;
    return loadCatalog();
  }

  /** rig-meta 变化后：表情页 + 显示顺序视图（图层组）都要跟上，不要求用户先开表情页 */
  function onRigMetaChanged() {
    state.slotGroup.metaKey = "";
    refreshSlotGroups();
    if (state.model) syncList();
    refreshExprUI();
  }

  /** 载入 rig-meta.json（可选约定文件，404 静默忽略） */
  async function loadRigMeta() {
    const gen = ++state.expr.loadGen;
    const base = exprMetaBase();
    if (!base) {
      state.expr.metaState = "absent";
      state.expr.meta = null;
      state.expr.metaError = "";
      onRigMetaChanged();
      return false;
    }
    const url = "/" + base + "/rig-meta.json";
    state.expr.metaUrl = url;
    state.expr.metaState = "loading";
    state.expr.metaError = "";
    refreshExprUI();
    let res = null;
    try {
      /* 本地目录模式也要能读 rig-meta（表情页槽位依赖它）→ 走统一的双路径读取 */
      res = await voiceFetchWithTimeout(url, {}, 6000);
    } catch (e) {
      res = null;
    }
    if (gen !== state.expr.loadGen) return false;
    if (!res || res.status === 404) {
      state.expr.metaState = "absent";
      state.expr.meta = null;
      state.expr.metaError = res ? "" : "读取 rig-meta.json 失败（网络错误），按未载入处理";
      onRigMetaChanged();
      return false;
    }
    if (!res.ok) {
      state.expr.metaState = "absent";
      state.expr.meta = null;
      state.expr.metaError = "rig-meta.json HTTP " + res.status + "，按未载入处理";
      onRigMetaChanged();
      return false;
    }
    let text;
    try {
      text = await res.text();
    } catch (e) {
      text = null;
    }
    if (gen !== state.expr.loadGen) return false;
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      state.expr.metaState = "error";
      state.expr.meta = null;
      state.expr.metaError = "rig-meta.json 解析失败（不是对象；模型仍可用）";
      onRigMetaChanged();
      setStatus("rig-meta.json 解析失败：表情套装与图层组不可用，模型与动画编辑不受影响", "warn");
      return false;
    }
    if (!Array.isArray(parsed.slotGroups) && !parsed.slots) {
      state.expr.metaState = "error";
      state.expr.meta = null;
      state.expr.metaError = "rig-meta.json 缺少 slotGroups / slots 字段（模型仍可用；表情数据在 events.json）";
      onRigMetaChanged();
      setStatus("rig-meta.json 内容不可用：表情套装与图层组不可用，模型与动画编辑不受影响", "warn");
      return false;
    }
    state.expr.meta = parsed;
    state.expr.metaState = "ready";
    state.expr.metaError = "";
    onRigMetaChanged();
    return true;
  }

  function refreshExprUI() {
    syncExprTabBadge();
    renderExprPanel();
  }

  function syncExprTabBadge() {
    const badge = el0("exprTabBadge");
    const n = state.expr.warnings.length;
    badge.hidden = n === 0;
    badge.textContent = String(n);
    badge.className = "tab-badge" + (state.expr.metaState === "error" ? " is-warn" : n ? " is-warn" : "");
  }

  function exprButton(text, cls, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    if (title) b.title = title;
    return b;
  }

  /** task-9：表情套装 = events[].expression（34 套，按事件名，字典序）。
   *  数据只来自 events.json —— 不读 rig-meta.expressions.sets（该段在 v2 已移除）。 */
  function exprSetEntries() {
    const v = state.voice;
    const evs = (v && Array.isArray(v.events)) ? v.events : [];
    return evs
      .filter((e) => e && e.expression && typeof e.expression === "object")
      .map((e) => e.event)
      .sort();
  }

  /* ---- task-9：7 个语义部位 → 实际槽的映射 ----
     0.9.35：新增**可选**第 8 部位「嘴巴特效」（mouth_嘘_气 这类从嘴里出来的气）。
     为什么是可选：34 个既有事件的 expression 里没有这个键，做成必填会让它们全部
     报「缺部位」。反算时只在真的有值时才写这个键 → 没改动的事件保存后逐字节不变。 */
  const EXPR_PARTS = ["左眼", "右眼", "眉毛_左", "眉毛_右", "眨眼_左", "眨眼_右", "嘴巴"];
  /** 可选部位：存在时才参与键集合校验，缺省视为 null */
  const EXPR_PARTS_OPTIONAL = ["嘴巴特效"];

  /** 事件 → 该事件的 expression 对象（v2） */
  function exprForEvent(eventId) {
    const v = state.voice;
    const ev = (v && v.events || []).find((e) => e.event === eventId);
    return ev && ev.expression ? ev.expression : null;
  }

  /**
   * 把 v2 的 7 部位 expression 转成 11 槽快照（可直接喂 exprEnforceExclusivity / override）。
   * 眨眼组是对象 {iris, white, lash}，null 表示该槽不显示附件。
   * whole 模式（左眼/右眼非 null）时眨眼组必为 null —— 这里也强制保证。
   */
  function exprSlotsFromParts(parts, baseSnapshot) {
    const next = Object.assign({}, baseSnapshot || {});
    if (!parts) return next;
    const whole = parts["左眼"] != null || parts["右眼"] != null;
    next["整眼_L"] = parts["左眼"] == null ? null : parts["左眼"];
    next["整眼_R"] = parts["右眼"] == null ? null : parts["右眼"];
    next["眉毛_L"] = parts["眉毛_左"] == null ? null : parts["眉毛_左"];
    next["眉毛_R"] = parts["眉毛_右"] == null ? null : parts["眉毛_右"];
    next["嘴巴"] = parts["嘴巴"] == null ? null : parts["嘴巴"];
    /* 0.9.35：第 8 部位 → 嘴巴特效槽（可选部位，缺省即 null） */
    next["嘴巴特效"] = parts["嘴巴特效"] == null ? null : parts["嘴巴特效"];
    for (const [key, side] of [["眨眼_左", "L"], ["眨眼_右", "R"]]) {
      const g = whole ? null : parts[key];
      const iris = g && typeof g === "object" ? g.iris : null;
      const white = g && typeof g === "object" ? g.white : null;
      const lash = g && typeof g === "object" ? g.lash : null;
      next["眼珠_" + side] = iris == null ? null : iris;
      next["眼白_" + side] = white == null ? null : white;
      next["睫毛_" + side] = lash == null ? null : lash;
    }
    return next;
  }

  /** 事件行用的紧凑表情摘要：只列非 null 的部位，用 · 连接 */
  function exprPartsSummary(parts) {
    if (!parts) return "—";
    const bits = [];
    if (parts["左眼"] != null || parts["右眼"] != null) {
      const l = parts["左眼"] == null ? "" : String(parts["左眼"]).replace(/^whole_L_/, "");
      const r = parts["右眼"] == null ? "" : String(parts["右眼"]).replace(/^whole_R_/, "");
      bits.push("整眼 " + (l || r));
    } else {
      if (parts["眨眼_左"] && parts["眨眼_左"].iris) bits.push("眼 " + String(parts["眨眼_左"].iris).replace(/^eye_L_/, ""));
      if (parts["眨眼_右"] && parts["眨眼_右"].iris) bits.push("眼 " + String(parts["眨眼_右"].iris).replace(/^eye_R_/, ""));
    }
    if (parts["眉毛_左"] != null) bits.push("眉 " + String(parts["眉毛_左"]).replace(/^brow_L_/, ""));
    if (parts["嘴巴"] != null) bits.push("嘴 " + String(parts["嘴巴"]).replace(/^mouth_/, ""));
    return bits.length ? bits.join(" · ") : "中性";
  }

  /** 一组槽共用的附件按钮（眨眼三槽是同一组） */
  function appendExprAttButtons(list, slotKey, slotNames, current, atts) {
    const groupApplied = slotNames.every((n) => {
      const box = state.expr.override;
      if (!box || !Object.prototype.hasOwnProperty.call(box, n)) return false;
      return box[n] === current;
    });
    const none = exprButton("（空）", "exp-att is-null", "该槽不显示附件");
    none.setAttribute("aria-pressed", groupApplied && current === null ? "true" : "false");
    none.addEventListener("click", () => applyExprAttachment(slotKey, null));
    list.appendChild(none);
    if (!atts.length) {
      const warn = el("span", "exp-att is-missing", "该槽无可用附件");
      warn.title = "模型里该槽的 skin 附件为空";
      list.appendChild(warn);
      return;
    }
    for (const a of atts) {
      const pressed = groupApplied && current === a;
      const btn = exprButton(a, "exp-att", pressed ? "当前生效：" + a : "点击试装（仅预览）");
      btn.setAttribute("aria-pressed", pressed ? "true" : "false");
      btn.addEventListener("click", () => applyExprAttachment(slotKey, a));
      list.appendChild(btn);
    }
  }

  /* ======================================================================
   * 0.9.26：把当前预览反算回 7 部位 expression，并保存到 events.json
   *
   * 正向映射 exprSlotsFromParts()（7 部位 → 11 槽）早就有；这里是它的逆。
   *
   * 关键约定（不这么做就会产生大面积无意义 diff）：
   *   · 眨眼组**只输出非 null 的键**。眼白为 null 时输出 {iris, lash}，
   *     与包里现有 38 组眨眼数据的写法完全一致 → 没改的数据写回后逐字节不变；
   *   · 整眼与同侧眨眼互斥：整眼非空时该侧眨眼输出 null；
   *   · 7 个部位**全部输出**（规范要求键集合与 catalog.expressionParts 完全一致）。
   * ====================================================================== */

  /** 11 槽覆盖 → 7 部位 expression（值一律 null 或字符串 / 眨眼对象） */
  function exprSlotsToParts(box, hints) {
    const b = box || {};
    const get = (n) => {
      if (!Object.prototype.hasOwnProperty.call(b, n)) return null;
      const v = b[n];
      return v === undefined ? null : v;
    };
    const wholeL = get("整眼_L");
    const wholeR = get("整眼_R");
    const hasWhole = wholeL !== null || wholeR !== null;

    /**
     * 眨眼组：三槽全空 → null；否则按**原事件写过的键集合**输出。
     *
     * 0.9.36 修：原来固定「只输出非 null 键」，但包里 6 组眨眼对像**显式写了
     * "iris": null**。省掉该键虽然语义等价，却让「什么都没改」的事件一保存就变字节，
     * 违背「没改动就不动盘」的承诺。hints = 该事件原眨眼对象，出现过的键一律保留
     * （值可为 null），没出现过的只在有值时才加。
     */
    const blinkOf = (side, hint) => {
      if (hasWhole) return null;
      const white = get("眼白_" + side);
      const iris = get("眼珠_" + side);
      const lash = get("睫毛_" + side);
      const h = hint && typeof hint === "object" ? hint : null;
      const had = (k) => !!(h && Object.prototype.hasOwnProperty.call(h, k));
      if (white === null && iris === null && lash === null && !(h && Object.keys(h).length)) return null;
      const out = {};
      if (iris !== null || had("iris")) out.iris = iris;
      if (lash !== null || had("lash")) out.lash = lash;
      if (white !== null || had("white")) out.white = white;
      if (!Object.keys(out).length) return null;
      return out;
    };

    const hL = hints && hints["眨眼_左"];
    const hR = hints && hints["眨眼_右"];

    const base = {
      "左眼": wholeL,
      "右眼": wholeR,
      "眉毛_左": get("眉毛_L"),
      "眉毛_右": get("眉毛_R"),
      "眨眼_左": blinkOf("L", hL),
      "眨眼_右": blinkOf("R", hR),
      "嘴巴": get("嘴巴"),
    };
    /* 0.9.35：第 8 部位是**可选**的 —— 只在真有值时才写这个键。
       若写成恒定输出 "嘴巴特效": null，31 个没用气的事件保存一次就会各多出一行
       （虽然语义等价，但会产生无意义 diff，违背「没改动就不动字节」的约定）。 */
    const fx = get("嘴巴特效");
    if (fx !== null) base["嘴巴特效"] = fx;
    return base;
  }

  /** 当前预览与某个事件原值的差异（用于保存前的确认与「无改动」判定） */
  function exprDiffAgainstEvent(eventId) {
    const before = exprForEvent(eventId) || {};
    /* 0.9.36：把原 expression 当 hints 传进去，让反算沿用原键集合（含显式 null 键） */
    const after = exprSlotsToParts(state.expr.override, before);
    const changed = [];
    /* 0.9.35：可选部位也要参与比较 —— 否则「只调了嘴巴特效」会被判成「无改动」，
       保存按钮一直是灰的，用户以为功能坏了。 */
    for (const k of EXPR_PARTS.concat(EXPR_PARTS_OPTIONAL)) {
      /* 0.9.39 修：**两边都要 undefined→null 归一**。
         原来只归一 before，after 没归一；而 JSON.stringify(undefined) 返回 undefined
         （不是字符串 "null"），于是「嘴巴特效」缺失时 JSON.stringify(undefined) !==
         JSON.stringify(null) 恒成立 → 明明没改动也判定有改动、保存按钮一直亮。
         归一之后「缺键」与「null」视为等价（语义本来就等价）。 */
      const bv = before[k] === undefined ? null : before[k];
      const av = after[k] === undefined ? null : after[k];
      if (JSON.stringify(bv) !== JSON.stringify(av)) {
        changed.push(k);
      }
    }
    return { before: before, after: after, changed: changed };
  }

  /** 事件表情保存：一条 API，只写 events.json 里该事件的 expression */
  async function saveExprToEvent(opts) {
    const o = opts || {};
    const root = packRootDir();
    if (!root) return reportExprSave("error", "没有包根：先载入人物包（不是本地目录模式）");
    if (isLocalMode()) return reportExprSave("error", "本地目录模式下没有写回服务，无法保存事件表情；请用「载入路径」载入");
    if (!state.model) return reportExprSave("error", "尚未载入模型");
    const eventId = typeof o.eventId === "string" && o.eventId ? o.eventId : (state.expr.saveTarget || state.expr.set);
    if (!eventId) {
      return reportExprSave("warn", "先在「事件表情」里点一个事件，再精细调整，最后点保存 —— 否则不知道该写回哪个事件");
    }
    if (!exprForEvent(eventId)) return reportExprSave("error", "events.json 里找不到事件 " + eventId);

    const diff = exprDiffAgainstEvent(eventId);
    if (!diff.changed.length) {
      setStatus("「" + eventLabelById(eventId, exprPackNameOf(eventId)) + "」的表情与包内一致，无需保存");
      return false;
    }
    if (o.dryRun) return { ok: true, dryRun: true, eventId: eventId, diff: diff };

    const btn = el0("exprSave");
    if (btn) btn.disabled = true;
    let res = null;
    try {
      res = await fetch("/api/save-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          /* 与 /api/save-bundle 同一套写盘防护：serve.py 要求这个头，
             用来拒绝「不是本编辑器发出的」写请求（CSRF 式防护）。 */
          "X-Spine-Editor": "save-bundle-v1",
        },
        cache: "no-store",
        body: JSON.stringify({
          apiVersion: 1,
          base: root,
          events: "events.json",
          expressionByEvent: { [eventId]: diff.after },
        }),
      });
    } catch (e) {
      res = null;
    } finally {
      if (btn) btn.disabled = false;
    }
    if (!res) {
      return reportExprSave("error", "没有连上本地服务：事件表情保存需要 serve.py（用 start.bat 启动）");
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok || !data || data.ok !== true) {
      const msg = (data && data.error && data.error.message) || ("服务返回 " + res.status);
      return reportExprSave("error", "保存失败：" + msg);
    }
    /* 保存成功后：磁盘上的值成了新的基线 —— 用写回的 expression 重建覆盖，
       这样「当前预览 == 包内值」，再次保存会判为无需改动。 */
    const base = exprSetupSnapshot().snapshot;
    state.expr.override = exprSlotsFromParts(diff.after, base);
    /* diff.after 可能带可选部位（嘴巴特效）；exprSlotsFromParts 已处理该键，无需特判 */
    state.expr.set = eventId;
    state.expr.mode = diff.after["左眼"] != null || diff.after["右眼"] != null ? "whole" : "normal";
    state.expr.warnings = [];
    /* 同步左侧事件分页里的表情摘要（它读的是 state.voice.events 的缓存副本） */
    const vev = (state.voice.events || []).find((e) => e && e.event === eventId);
    if (vev) vev.expression = diff.after;
    refreshExprUI();
    render();
    if (state.voice.open) scheduleVoiceRefresh();
    reportExprSave(
      "ok",
      "已保存「" + eventLabelById(eventId, exprPackNameOf(eventId)) + "」的表情（" +
        diff.changed.join("、") + "）到 events.json"
    );
    return true;
  }

  function reportExprSave(kind, message) {
    const stamp = el0("exprSaveState");
    if (stamp) {
      stamp.textContent = message;
      stamp.dataset.kind = kind;
      stamp.hidden = false;
    }
    setStatus(message, kind === "error" ? "error" : kind === "warn" ? "warn" : "info");
    return false;
  }

  /**
   * 保存条的可用性与文案（0.9.26）。
   *
   * 为什么不是「只要载入就 enable」：
   *   · 没选中事件 → 不知道该写回哪个，点了只会报错，干脆禁用并说明；
   *   · 当前预览与该事件包内值一致 → 保存无意义（无改动），也禁用；
   *   · 本地目录模式 / 没有包根 → 没有写回服务，禁用并说明原因。
   * 禁用时 `title` 一定给原因，不出现「点了才知道不能点」。
   */
  function syncExprSaveBar() {
    const btn = el0("exprSave");
    const label = el0("exprSaveTarget");
    const stamp = el0("exprSaveState");
    if (!btn) return;
    const root = packRootDir();
    const eventId = state.expr.saveTarget || state.expr.set;
    const reasons = [];
    if (!state.model) reasons.push("尚未载入模型");
    if (isLocalMode()) reasons.push("本地目录模式没有写回服务");
    else if (!root) reasons.push("没有包根（请用「载入路径」载入）");
    if (!eventId) reasons.push("先在「事件表情」里点一个事件");
    const diff = eventId ? exprDiffAgainstEvent(eventId) : null;
    if (eventId && diff && !diff.changed.length) reasons.push("与包内值一致，无改动");

    const zh = eventId ? eventLabelById(eventId, exprPackNameOf(eventId)) : null;
    if (label) {
      /* 0.9.29：标签只给**短状态**，完整原因交给右侧状态条。
         否则两处都在说「先点一个事件」，挤在同一行被各自截断成
         「未选中事件...」和「先在「事...」，看起来像两个坏掉的标签。
         英文 id 与完整说明放 title，不占可见宽度。 */
      label.textContent = eventId ? zh : "未选中事件";
      label.title = eventId
        ? "目标事件：" + zh + "（" + eventId + "）"
        : "先点「事件表情」里的一项，再精调、再保存";
      label.dataset.kind = eventId ? "ok" : "warn";
    }
    if (stamp && reasons.length) {
      /* 不覆盖上一次的保存结果文案（那是有用信息），只在没有结果时显示原因 */
      if (stamp.hidden || stamp.dataset.kind === "blocked") {
        stamp.textContent = reasons[0];
        stamp.dataset.kind = "blocked";
        stamp.hidden = false;
      }
    } else if (stamp && !reasons.length && stamp.dataset.kind === "blocked") {
      stamp.hidden = true;
      stamp.textContent = "";
    }
    btn.disabled = reasons.length > 0;
    btn.title = reasons.length
      ? "不能保存：" + reasons.join("；")
      : "把当前预览的表情写回 events.json 的「" + zh + "」（其余事件不动）";
  }

  /* ======================================================================
   * 0.9.22：眼睛互斥的**视觉语义**（只改显示，不动数据逻辑）
   *
   *   数据层的互斥早在 exprEnforceExclusivity() 里做全了（双向清理），但界面没有
   *   任何提示 —— 用户看不出「整眼」与「眨眼三槽（眼白/眼珠/睫毛）」是二选一，
   *   也看不出点另一组会把当前那组顶掉。这里补三件事：
   *     1) 两组标题带互斥徽标；
   *     2) 当前生效的那组正常，另一组置灰 + disabled + 说明「会替换当前 X」；
   *     3) 给出明确的「切换到 X」入口，而不是点了才发现眼睛变了。
   * ====================================================================== */

  /** 当前哪一组眼睛在生效：'whole' | 'blink' | 'none' */
  function exprEyeGroupActive() {
    const names = exprSlotNameMap();
    const box = state.expr.override || {};
    const isSet = (n) => Object.prototype.hasOwnProperty.call(box, n) && box[n] !== null && box[n] !== undefined;
    const whole = [].concat(names.wholeL || [], names.wholeR || []);
    const blink = [].concat(names.whiteL || [], names.irisL || [], names.lashL || [],
      names.whiteR || [], names.irisR || [], names.lashR || []);
    if (whole.some(isSet)) return "whole";
    if (blink.some(isSet)) return "blink";
    return "none";
  }

  /**
   * 眼睛两组之间**真正**切换（0.9.22）。
   *
   * 为什么不能复用 applyExprBlinkLevel(side, null)：它只把眨眼三槽清成 null，
   * **不调用 exprEnforceExclusivity**，所以「整眼」仍然非空、依旧生效 ——
   * 结果就是点了「切换到眨眼三槽」却什么都没换过去（实测 blockedCount 仍为 12）。
   *
   * 这里做完整两件事：清空对方那一组 + 给目标一组一个确定起点。
   *
   * @param {"whole"|"blink"} target
   */
  function exprSwitchEyeGroup(target) {
    const names = exprSlotNameMap();
    const box = Object.assign(Object.create(null), state.expr.override || {});
    const whole = [].concat(names.wholeL || [], names.wholeR || []);
    const blink = [].concat(names.whiteL || [], names.irisL || [], names.lashL || [],
      names.whiteR || [], names.irisR || [], names.lashR || []);
    if (target === "blink") {
      /* 清整眼；眨眼三槽取 setup 快照（该模型 setup 下眼白恒为 null，眼珠/睫毛有默认档） */
      for (const w of whole) box[w] = null;
      for (const b of blink) box[b] = setupAttachmentName(b);
    } else {
      /* 清眨眼三槽；整眼取 setup 快照 */
      for (const b of blink) box[b] = null;
      for (const w of whole) box[w] = setupAttachmentName(w);
    }
    state.expr.override = box;
    /* 0.9.23：mode 必须**按实际数据推导**，不能按意图写死。
       反例（真实踩到）：这个模型 setup 下「整眼_L/R」没有附件，setupAttachmentName
       返回 null，于是整组全空；此时若仍写 mode="whole"，就会出现「mode=whole 但
       徽标显示『二选一·未选』」的自相矛盾状态。 */
    const activeAfter = exprEyeGroupActive();
    state.expr.mode = activeAfter === "whole" ? "whole" : activeAfter === "blink" ? "normal" : "none";
    state.expr.set = null;              /* 已偏离某个事件的原值 → 不再声称是那个事件 */
    state.expr.warnings = [];
    refreshExprUI();
    render();
    setStatus(activeAfter === "blink"
      ? "已切换到眨眼三槽（整眼已清空，仅预览）"
      : activeAfter === "whole"
        ? "已切换到整眼（眨眼三槽已清空，仅预览）"
        : "已清空当前眼睛组；该组在 setup 下没有默认附件，请手动选一个（仅预览）");
    return true;
  }

  /** 组头徽标：**只讲互斥关系**，不讲「当前是否生效」 */
  function exprMutualBadge(group) {
    const other = group === "whole" ? "眨眼三槽" : "整眼";
    /* 0.9.34：右上角状态位已经负责「生效中 / 已取代」，
       徽标原来也写「生效中」，导致同一区域里出现两个「生效中」（截图可见）。
       现在徽标只承担**互斥语义**：告诉用户这两组是二选一、不能叠加。
       状态（生效中/已取代）唯一由右上角 .exp-region-ctl 表达。 */
    const badge = el("span", "exp-mutual", "与「" + other + "」二选一");
    badge.title = "眼睛两组互斥，只能选一组：整眼，或眨眼三槽（眼白·眼珠·睫毛）。" +
      "点本组会把「" + other + "」清空 —— 数据层见 exprEnforceExclusivity()";
    return badge;
  }




  /* ======================================================================
   * 表情页「按槽附件」区域：按**语义分区**渲染（0.9.25）
   *
   *   眼睛被拆成两块互相独立的区域，因为它们在语义上就是二选一的两套方案：
   *     · 「整眼」区域   —— 整眼_L / 整眼_R
   *     · 「眨眼三槽」区域 —— 眼白 / 眼珠 / 睫毛 × 左右
   *   每块的**右上角**放自己的互斥切换按钮（用户明确要求的位置），
   *   而不是像原来那样散落在按钮列表末尾、要滚到底才看得到。
   * ====================================================================== */

  /** 单槽行（整眼 / 眉毛 / 嘴巴都用它）；返回 DOM 片段 */
  function exprSingleSlotRow(key, slotNames) {
    const primary = slotNames[0];
    /* v3.1 §5b.1：编辑器判定「这个值合法吗」只看 catalog。
       有 catalog 时用它的 expressionParts 允许值；没有（v2 包）才回退到 model 附件。 */
    const catVals = catalogSlotValues(primary) ||
      catalogPartValues(CATALOG_PART_OF_SLOT_KEY[key]);
    const atts = catVals && catVals.length ? catVals.slice() : exprAttachmentsFor(primary);
    const cur = exprCurrentAttachment(primary);
    const row = el("div", "exp-slot");
    const hd = el("div", "exp-slot-hd");
    hd.appendChild(el("span", "exp-slot-name", primary));
    const curEl = el("span", "exp-slot-cur" + (cur.name ? "" : " is-null"), cur.name || "（无附件）");
    curEl.title = cur.source === "override" ? "来自预览覆盖" : "来自当前姿态";
    hd.appendChild(curEl);
    row.appendChild(hd);
    const list = el("div", "exp-atts");
    appendExprAttButtons(list, key, slotNames, cur.source === "override" ? cur.name : null, atts);
    row.appendChild(list);
    return { row: row, list: list };
  }

  /** 眨眼三槽组行（眼白/眼珠/睫毛 一起换档） */
  function exprBlinkGroupRow(key, slotNames) {
    const row = el("div", "exp-slot");
    const hd = el("div", "exp-slot-hd");
    hd.appendChild(el("span", "exp-slot-name", slotNames.join(" / ")));
    const curParts = slotNames.map((n) => {
      const c = exprCurrentAttachment(n);
      return c.name === null ? "（空）" : c.name;
    });
    const curEl = el("span", "exp-slot-cur", curParts.join(" · "));
    curEl.title = "三槽一起换档（眨眼 0/25/50/75/100 与整眼互斥）";
    hd.appendChild(curEl);
    row.appendChild(hd);
    const list = el("div", "exp-atts");
    const side = key === "blinkL" ? "L" : "R";   /* 修：原为未定义的 slotKey → side 恒为 R */
    const levels = exprBlinkLevels(side);
    const ov = state.expr.override;              /* 修：原变量名 box 遮蔽了 DOM 容器参数 */
    if (levels) {
      for (const lv of levels) {
        const entries = Object.keys(lv.slots).map((n) => [n, lv.slots[n]]);
        const applied = entries.every((e) => ov && Object.prototype.hasOwnProperty.call(ov, e[0]) && ov[e[0]] === e[1]);
        const btn = exprButton(lv.level + "%", "exp-att", "三槽快照：" + entries.map((e) => e[0] + "=" + (e[1] === null ? "（空）" : e[1])).join("；"));
        btn.setAttribute("aria-pressed", applied ? "true" : "false");
        btn.addEventListener("click", () => applyExprBlinkLevel(side, lv.level));
        list.appendChild(btn);
      }
      const none = exprButton("（空）", "exp-att is-null", "三槽都清空（该组不显示眼睛）");
      none.setAttribute("aria-pressed", slotNames.every((n) => ov && Object.prototype.hasOwnProperty.call(ov, n) && ov[n] === null) ? "true" : "false");
      none.addEventListener("click", () => applyExprBlinkLevel(side, null));
      list.appendChild(none);
    } else {
      appendExprAttButtons(list, key, slotNames, null, exprAttachmentsFor(slotNames[1] || slotNames[0]));
    }
    row.appendChild(list);
    return { row: row, list: list };
  }

  /**
   * 眼睛区域外壳：标题 + 状态徽标 + **右上角的切换按钮** + 内部的槽行。
   *
   * @param {"whole"|"blink"} group
   * @param {string} title 区域标题（人读）
   * @param {HTMLElement[]} rows 内部槽行
   */
  function exprEyeRegion(group, title, rows, hint) {
    const active = exprEyeGroupActive();
    const on = active === group;
    const section = el("section", "exp-region exp-region-eye" +
      (on ? " is-active" : active === "none" ? "" : " is-locked"));

    /* ---- 头部：三层结构，避免 300px 侧栏把字压成竖排 ----
       0.9.33 的现实教训：原来把「标题 + 徽标 + 右上角控制」塞进同一个 flex row，
       标题的 min-content 被挤到极窄就**一字一行**折行（实测显示成「整眼（整 / 眼_L / 」），
       徽标同样竖排，把右上角的切换按钮顶出区域外。
       现在拆成：
         row1：标题（nowrap + 省略号，完整名字在 title） + 右上角控制位
         row2：徽标独占整宽（可换行），互斥说明自然铺开
       标题本身也改短（「整眼」/「眨眼三槽」），详细说明放 title。 */
    const head = el("div", "exp-region-hd");

    const headRow = el("div", "exp-region-hd-row");
    const nameEl = el("span", "exp-region-title", title);
    nameEl.title = hint || title;
    headRow.appendChild(nameEl);

    /* 右上角：本区域是否生效 + 切换按钮（用户指定的位置，始终 flex:none 不被挤压） */
    const ctl = el("div", "exp-region-ctl");
    if (on) {
      ctl.appendChild(el("span", "exp-region-state is-on", "生效中"));
    } else if (active !== "none") {
      ctl.appendChild(el("span", "exp-region-state", "已取代"));
    }
    /* 只要另一组在生效，就给出明确的切换入口；本组生效时不显示（点了也只是重复自己） */
    if (active !== group && active !== "none") {
      const sw = exprButton("切换到这里", "exp-att is-switch",
        "会清空当前「" + (group === "whole" ? "眨眼三槽" : "整眼") + "」，换成「" + title + "」的默认值（仅预览）");
      sw.addEventListener("click", () => exprSwitchEyeGroup(group));
      ctl.appendChild(sw);
    }
    headRow.appendChild(ctl);

    head.appendChild(headRow);
    head.appendChild(exprMutualBadge(group));
    section.appendChild(head);

    const body = el("div", "exp-region-body");
    for (const r of rows) body.appendChild(r);
    section.appendChild(body);
    return section;
  }


  function renderExprSlots(box, slotKeys, hasMeta) {
    const names = exprSlotNameMap();
    const active = exprEyeGroupActive();
    let shown = 0;

    /* ---- 先分区收集：眼睛两块 + 其余普通槽 ---- */
    const wholeRows = [];
    const blinkRows = [];
    const plainKeys = [];
    for (const key of slotKeys) {
      const slotNames = names[key];
      if (!slotNames || !slotNames.length) continue;
      if (key === "wholeL" || key === "wholeR") {
        const built = exprSingleSlotRow(key, slotNames);
        wholeRows.push(built);
      } else if (slotNames.length > 1) {
        blinkRows.push(exprBlinkGroupRow(key, slotNames));
      } else {
        plainKeys.push(key);
      }
    }

    /** 把一组槽行批量置灰（另一区域生效时） */
    const greyRows = (items, why) => {
      for (const it of items) {
        it.list.querySelectorAll(".exp-att").forEach((b) => {
          b.disabled = true;
          b.classList.add("is-blocked");
          b.title = why;
        });
      }
    };

    /* ---- 眼睛区 1：整眼 ---- */
    if (wholeRows.length) {
      if (active === "blink") {
        greyRows(wholeRows, "当前「眨眼三槽」生效中：眼睛两组互斥，需先点右上角「切换到这里」");
      }
      box.appendChild(exprEyeRegion("whole", "整眼", wholeRows.map((r) => r.row),
        "整眼_L / 整眼_R：整只眼替换整套附件，与眨眼三槽互斥"));
      shown += wholeRows.length;
    }

    /* ---- 眼睛区 2：眨眼三槽 ---- */
    if (blinkRows.length) {
      if (active === "whole") {
        greyRows(blinkRows, "当前「整眼」生效中：眼睛两组互斥，需先点右上角「切换到这里」");
      }
      box.appendChild(exprEyeRegion("blink", "眨眼三槽", blinkRows.map((r) => r.row),
        "眼白 / 眼珠 / 睫毛：三槽一起换档（0/25/50/75/100%），与整眼互斥"));
      shown += blinkRows.length;
    }

    /* ---- 其余普通槽（眉毛 / 嘴巴 ...） ---- */
    for (const key of plainKeys) {
      const slotNames = names[key];
      const built = exprSingleSlotRow(key, slotNames);
      box.appendChild(built.row);
      shown++;
    }
    return shown;
  }

  function renderExprPanel() {
    const panel = el0("exprPanel");
    if (!panel) return;
    if (!state.expr.open) {
      syncExprTabBadge();
      return;
    }
    const loaded = !!state.model;
    const meta = state.expr.meta;
    const hasMeta = state.expr.metaState === "ready" && !!meta;
    /* task-9：套装来自 events[].expression —— 与 rig-meta 无关 */
    const hasExprMeta = exprSetEntries().length > 0;
    el0("exprEmpty").hidden = loaded;
    el0("exprReset").disabled = !loaded;
    const applied = Object.keys(state.expr.override).length;
    el0("exprApplied").textContent = "覆盖 " + applied + " 槽";
    /* 0.9.26：事件表情保存条的状态同步（目标事件 / 是否有改动 / 可用性） */
    syncExprSaveBar();
    const modeEl = el0("exprMode");
    modeEl.textContent = hasExprMeta ? state.expr.mode : "—";
    modeEl.dataset.mode = hasExprMeta ? state.expr.mode : "none";
    const metaEl = el0("exprMetaState");
    /* task-9：套装来自 events.json，状态文案按「是否有事件表情」表达 */
    const stateText = hasExprMeta
      ? { idle: "未读 events.json", loading: "读取 events.json…", ready: "events.json 已载入", absent: "无 events.json", error: "events.json 解析失败" }
      : { idle: "未读 rig-meta", loading: "读取 rig-meta…", ready: "rig-meta 已载入（无事件表情）", absent: "无 rig-meta（仅按槽调试）", error: "rig-meta 解析失败" };
    let metaLabel = stateText[state.expr.metaState] || "—";
    /* v3.1：追加 catalog 状态（权威索引）。v2 包没有 catalog → 不追加，保持原文案。 */
    const catState = state.expr.catalogState;
    if (catState !== "idle") {
      const catText = {
        loading: "catalog 读取中…",
        ready: "catalog gen " + (state.expr.catalog && state.expr.catalog.generation),
        absent: "无 catalog",
        error: "catalog 解析失败",
      }[catState];
      if (catText) metaLabel += " · " + catText;
    }
    metaEl.textContent = metaLabel;
    metaEl.classList.toggle(
      "is-warn",
      state.expr.metaState === "error" || state.expr.metaState === "absent" ||
      state.expr.catalogState === "error"
    );
    metaEl.title = [state.expr.metaError, state.expr.catalogError].filter(Boolean).join("；") ||
      state.expr.metaUrl || "";
    const warn = el0("exprWarn");
    const msgs = state.expr.warnings.slice();
    if (state.expr.metaError) msgs.unshift(state.expr.metaError);
    warn.hidden = msgs.length === 0;
    warn.textContent = msgs.slice(0, 6).join("；");
    warn.classList.toggle("is-error", state.expr.metaState === "error");

    const setsWrap = el0("exprSetsWrap");
    const names = exprSetEntries();
    setsWrap.hidden = !hasExprMeta || !names.length;
    if (!setsWrap.hidden) {
      el0("exprSetCount").textContent = String(names.length);
      const box = el0("exprSets");
      box.textContent = "";
      for (const n of names) {
        const isWhole = n.indexOf("whole:") === 0;
        /* 0.9.20：按钮显示中文事件名，底层仍传英文 id（applyExprSet(n) 收的是 id）。
           title 同时给中文与英文 id，便于对照包内 events.json。
           注意 `whole:` 是内部前缀，查字典/查包名之前必须剥掉，否则永远查不到。 */
        const rawId = isWhole ? n.slice("whole:".length) : n;
        const zh = eventLabelById(rawId, exprPackNameOf(rawId));
        const btn = exprButton(
          zh,
          "expr-set" + (isWhole ? " is-whole" : ""),
          (isWhole ? "应用「" + zh + "」（whole 模式：清空眨眼三槽）" : "应用「" + zh + "」（normal 模式：清空整眼）") +
            " · 事件 id：" + rawId
        );
        btn.setAttribute("aria-pressed", state.expr.set === n ? "true" : "false");
        btn.addEventListener("click", () => applyExprSet(n));
        box.appendChild(btn);
      }
    }

    const slotsWrap = el0("exprSlotsWrap");
    const slotKeys = hasExprMeta ? EXPR_SLOT_KEYS : ["mouth", "browL", "browR"];
    slotsWrap.hidden = !loaded;
    if (loaded) {
      const box = el0("exprSlots");
      box.textContent = "";
      const shown = renderExprSlots(box, exprPageSlotKeys(), hasExprMeta);
      if (!shown) {
        const note = el("p", "expr-note", hasExprMeta ? "events.json 里引用的槽名在模型里都不存在。" : "未找到嘴巴/眉毛槽：载入与 events.json 同目录的模型后再试。");
        box.appendChild(note);
      }
      el0("exprSlotCount").textContent = String(shown);
    } else {
      el0("exprSlots").textContent = "";
      el0("exprSlotCount").textContent = "0";
    }
  }

  /* ==========================================================================
   * 10c. 动画分页：时长 + 关键帧编辑
   *   草稿 = 完整原始动画对象（保留未知字段），只保存在 state.animEdit.drafts，
   *   保存时经 SpineAnimEdit.applyAnimationDrafts 合并进 patchedModel，只替换编辑过的动画。
   * ====================================================================== */
  function animRawAnimations() {
    const raw = state.raw;
    return raw && raw.animations && typeof raw.animations === "object" ? raw.animations : null;
  }

  function animCanonical(name) {
    const lib = animEditLib();
    if (lib && lib.draftBaseDuration) {
      const d = lib.draftBaseDuration(animRawAnimations() ? animRawAnimations()[name] : null);
      if (d > 0) return d;
    }
    const parsed = state.model && state.model.animations.get(name);
    return parsed && parsed.duration ? parsed.duration : 0;
  }

  /** 编辑草稿（没有草稿时回落到原始动画对象） */
  function animDraft(name) {
    const ed = state.animEdit;
    if (ed.drafts[name]) return ed.drafts[name];
    const raw = animRawAnimations();
    return raw ? raw[name] || null : null;
  }

  function animHasDraft() {
    return Object.keys(state.animEdit.drafts).length > 0;
  }

  function animIsDirty(name) {
    if (!name) return false;
    return !!state.animEdit.drafts[name];
  }

  function animDirtyCount() {
    return Object.keys(state.animEdit.drafts).length;
  }

  function animPatchInPlace(parsedKeys, rawKeys, fields) {
    if (!Array.isArray(parsedKeys) || !Array.isArray(rawKeys)) return;
    for (let i = 0; i < parsedKeys.length && i < rawKeys.length; i++) {
      const rk = rawKeys[i];
      if (!rk || typeof rk !== "object") continue;
      if (Number.isFinite(rk.time)) parsedKeys[i].time = rk.time;
      for (const f of fields) if (Number.isFinite(rk[f])) parsedKeys[i][f] = rk[f];
    }
  }

  /**
   * 让预览用上草稿：把「当前 raw + 全部草稿」重新 parse 一次，只替换 state.model.animations
   * （Map 对象不变 → 引用它的其它代码无需重建），其它 model 结构保持同一份。
   * 不用「按旧数组原位 patch」：那会漏掉新增/删除的 key、也写不进字符串附件名（name 不是数字）。
   */
  function syncAnimFromDraft(name) {
    const lib = animEditLib();
    const model = state.model;
    if (!model || !lib || !core) return false;
    const raw = state.raw;
    if (!raw || typeof raw !== "object") return false;
    const merged = lib.applyAnimationDrafts(raw, state.animEdit.drafts);
    if (!merged.ok) return false;
    const parsed = core.parseModel(merged.value, state.atlas, { skin: "default" });
    if (!parsed || parsed.ok !== true) {
      if (parsed && parsed.issues && parsed.issues.length) {
        setStatus("动画草稿解析失败：" + issueText(parsed.issues, 2), "error");
      }
      return false;
    }
    const fresh = parsed.value;
    model.animations = fresh.animations;
    model.capabilities = fresh.capabilities;
    /* 新出现的解析告警（未知 timeline 字段等）并入诊断，保持可见 */
    const known = state.issueDetails || [];
    const seen = new Set(known.map((i) => (i.path || "") + "|" + (i.code || "")));
    let added = 0;
    for (const i of parsed.issues || []) {
      const key = (i.path || "") + "|" + (i.code || "");
      if (seen.has(key)) continue;
      seen.add(key);
      state.issueDetails.push({ severity: i.severity, code: i.code, path: i.path, message: i.message });
      added++;
    }
    if (added) syncDebug();
    const anim = model.animations.get(name);
    return !!anim;
  }

  function syncAnimEditDurInput(force) {
    const input = el0("animDurInput");
    if (!input) return;
    const name = state.animEdit.sel;
    if (!name) {
      input.value = "";
      input.disabled = true;
      return;
    }
    input.disabled = false;
    if (force || state.animEdit.durInput == null) {
      input.value = String(round(state.animDur, 4));
      state.animEdit.durInput = null;
    }
  }

  function markAnimDirty(name) {
    const ed = state.animEdit;
    ed.dirty = animHasDraft();
    if (ed.dirty && name) ed.sel = name;
    syncAnimSelect();
    syncFooter();
    syncAnimEditBar();
  }

  /** 底部动画条 + 播放状态与动画页保持一致 */
  function syncAnimEditBar() {
    const ed = state.animEdit;
    const names = state.model ? Array.from(state.model.animations.keys()) : [];
    const sel = el0("animEditSel");
    if (sel) {
      sel.textContent = "";
      for (const n of names) {
        const o = el("option", null, n + (animIsDirty(n) ? " *" : ""));
        o.value = n;
        sel.appendChild(o);
      }
      sel.disabled = names.length === 0;
      sel.value = names.indexOf(ed.sel) >= 0 ? ed.sel : "";
    }
    const dirtyBadge = el0("animEditDirty");
    dirtyBadge.hidden = !animHasDraft();
    dirtyBadge.textContent = animDirtyCount() > 1 ? animDirtyCount() + " 段未保存" : "未保存";
    el0("animResetOne").disabled = !animIsDirty(ed.sel);
    el0("animResetAll").disabled = !animHasDraft();
    el0("animDurApply").disabled = !ed.sel;
    const saveBtn = el0("animSave");
    const can = !!state.model && !!saveTarget() && state.writeState === "ready" && !state.saveBusy && !state.zipBusy && !state.loading;
    saveBtn.disabled = !can;
    saveBtn.title = can ? "写回 " + state.bundle.base + "/" + state.bundle.modelName : saveReason();
    el0("animSaveNote").textContent = can
      ? "保存目标：" + state.bundle.base + "/" + state.bundle.modelName + "（只写 model.json）"
      : saveReason();
    const stat = el0("animKeyStat");
    const draft = animDraft(ed.sel);
    const lib = animEditLib();
    const scan = lib && draft ? lib.scanTracks(draft) : null;
    stat.textContent = !ed.sel ? "—" : !draft ? "无数据" : (scan.bones.length + " 骨轨道 / " + scan.slots.length + " 槽轨道 / " + scan.keyCount + " keys");
    syncAnimEditDurInput();
  }

  function animTrackKey(kind, owner, field) {
    return kind + ":" + owner + (field ? ":" + field : "");
  }

  function animToggleTrack(key, row, body) {
    const ed = state.animEdit;
    const openNow = !ed.expanded.has(key);
    if (openNow) ed.expanded.add(key);
    else ed.expanded.delete(key);
    renderAnimTracks();
    return openNow;
  }

  /** 当前预览姿态 → 该骨某属性的相对 setup 值 */
  function animCurrentValues(boneName, field) {
    const lib = animEditLib();
    if (!lib) return { ok: false, issues: [{ message: "anim-edit.js 未加载" }] };
    const entry = state.bones[boneName];
    const model = state.model;
    if (!entry || !model) return { ok: false, issues: [{ message: "找不到骨 " + boneName }] };
    const setup = model.bones[entry.index];
    const pose = lastPose || evalCurrentPose();
    const local = pose && pose.local ? pose.local[entry.index] : null;
    return lib.relativeValues(field, local, setup);
  }

  function animSetDraft(name, draft, opts) {
    const ed = state.animEdit;
    if (!name || !draft) return false;
    ed.drafts[name] = draft;
    ed.sel = name;
    ed.rev = (ed.rev || 0) + 1; /* P2-04：轨迹采样缓存失效 */
    if (!opts || opts.resetDur !== false) ed.durInput = null;
    syncAnimFromDraft(name);
    if (state.anim === name) {
      state.animDur = animDuration(name);
      if (state.t > state.animDur) state.t = state.animDur;
      updateTimeLabel();
    }
    markAnimDirty(name);
    renderAnimPanel();
    render();
    return true;
  }

  function animApplyScale(name, newDuration) {
    const lib = animEditLib();
    if (!lib) return false;
    const current = animDraft(name);
    if (!current) return false;
    /* 契约 §7 / T11：整体重定时前必须预检——未知带 time 轨道要原子拒绝，不能只改一部分还叫「全部 Key」 */
    if (typeof lib.retimeAllPrecheck === "function") {
      const pre = lib.retimeAllPrecheck(current);
      if (!pre.ok) {
        const paths = (pre.issues || []).map((i) => i.path).slice(0, 4).join("、");
        setStatus("ANIM_RETIME_UNSUPPORTED_TRACK：该动画含未覆盖的带时间轨道，整体重定时已拒绝" + (paths ? "（" + paths + "）" : ""), "warn");
        notice("warn", "整体重定时被拒绝：存在无法保证一致缩放的带 time 数据" + (paths ? "：" + paths : "") + "。请改用「预览起止」，它不写 JSON。");
        return false;
      }
    }
    const res = lib.scaleAnimationTimes(current, newDuration);
    if (!res.ok) {
      setStatus(res.issues[0].message, "warn");
      return false;
    }
    animSetDraft(name, res.value);
    setStatus("已把「" + name + "」整体重定时到 " + round(newDuration, 4) + "s：全部 Key 时间与贝塞尔时间控制点按比例缩放（数值不变）");
    return true;
  }

  function animAddBoneKey(name, boneName, field) {
    const lib = animEditLib();
    if (!lib) return false;
    const draft = animDraft(name);
    if (!draft) return false;
    const res = lib.relativeValues(field, (lastPose && lastPose.local && state.bones[boneName] ? lastPose.local[state.bones[boneName].index] : null), state.model.bones[state.bones[boneName].index]);
    if (!res.ok) {
      setStatus(res.issues[0].message, "warn");
      return false;
    }
    const up = lib.upsertKey(draft, "bones", boneName, field, res.values, state.t);
    if (!up.ok) {
      setStatus(up.issues[0].message, "warn");
      return false;
    }
    animSetDraft(name, up.value);
    setStatus((up.replaced ? "已更新 " : "已新增 ") + boneName + " / " + field + " key @ " + round(state.t, 3) + "s（取当前预览值）");
    return true;
  }

  function animAddSlotKey(name, slotName, attName) {
    const lib = animEditLib();
    if (!lib) return false;
    const draft = animDraft(name);
    if (!draft) return false;
    const value = attName === null || attName === undefined || attName === "" ? null : String(attName);
    if (value !== null && exprAttachmentsFor(slotName).indexOf(value) < 0) {
      setStatus("附件 " + value + " 不存在于槽 " + slotName + "，已拒绝写入", "warn");
      return false;
    }
    const up = lib.upsertKey(draft, "slots", slotName, "attachment", { name: value }, state.t);
    if (!up.ok) {
      setStatus(up.issues[0].message, "warn");
      return false;
    }
    animSetDraft(name, up.value);
    setStatus((up.replaced ? "已更新 " : "已新增 ") + slotName + " 附件 key @ " + round(state.t, 3) + "s → " + (value === null ? "（空）" : value));
    return true;
  }

  function animRemoveKey(name, kind, owner, field, time) {
    const lib = animEditLib();
    if (!lib) return false;
    const draft = animDraft(name);
    if (!draft) return false;
    const res = lib.removeKey(draft, kind, owner, field, time);
    if (!res.ok) {
      setStatus(res.issues[0].message, "warn");
      return false;
    }
    animSetDraft(name, res.value);
    setStatus("已删除 " + (kind === "bones" ? owner + " / " + field : owner + " / 附件") + " 在 " + round(time, 3) + "s 的 key");
    return true;
  }

  function animRetimeKey(name, kind, owner, field, from, to) {
    const lib = animEditLib();
    if (!lib) return false;
    const draft = animDraft(name);
    if (!draft) return false;
    const res = lib.retimeKey(draft, kind, owner, field, from, to);
    if (!res.ok) {
      setStatus(res.issues[0].message, "warn");
      syncAnimEditBar();
      renderAnimTracks();
      return false;
    }
    animSetDraft(name, res.value);
    return true;
  }

  function animSetKeyValue(name, kind, owner, field, time, values) {
    const lib = animEditLib();
    if (!lib) return false;
    const draft = animDraft(name);
    if (!draft) return false;
    const res = lib.setKeyValues(draft, kind, owner, field, time, values);
    if (!res.ok) {
      setStatus(res.issues[0].message, "warn");
      return false;
    }
    animSetDraft(name, res.value);
    return true;
  }

  function animResetOne(name) {
    if (!name) return false;
    const ed = state.animEdit;
    const had = !!ed.drafts[name];
    if (had) delete ed.drafts[name];
    ed.durInput = null;
    const raw = animRawAnimations();
    if (raw && raw[name]) syncAnimFromDraft(name);
    if (state.anim === name) {
      state.animDur = animDuration(name);
      updateTimeLabel();
    }
    markAnimDirty(name);
    renderAnimPanel();
    render();
    setStatus(had ? "已重置「" + name + "」（恢复磁盘内容）" : "「" + name + "」本来就是磁盘内容");
    return true;
  }

  function animResetAll() {
    const ed = state.animEdit;
    const names = Object.keys(ed.drafts);
    if (!names.length) {
      setStatus("没有未保存的动画编辑");
      return false;
    }
    ed.drafts = Object.create(null);
    ed.durInput = null;
    for (const n of names) syncAnimFromDraft(n);
    if (state.anim) {
      state.animDur = animDuration(state.anim);
      if (state.t > state.animDur) state.t = state.animDur;
      updateTimeLabel();
    }
    markAnimDirty(ed.sel);
    renderAnimPanel();
    render();
    setStatus("已丢弃 " + names.length + " 段动画的编辑（恢复磁盘内容）");
    return true;
  }

  function renderAnimKeyRow(box, name, kind, owner, field, key, numericFields) {
    const row = el("div", "anim-key");
    row.dataset.keyTime = String(key.time);
    const lbl = el("span", "k-lbl", "t");
    row.appendChild(lbl);
    const timeInp = document.createElement("input");
    timeInp.type = "number";
    timeInp.min = "0";
    timeInp.step = "0.005";
    timeInp.value = String(round(key.time, 6));
    timeInp.title = "key 时间（秒）";
    timeInp.setAttribute("aria-label", owner + " key 时间");
    timeInp.addEventListener("change", () => {
      const v = parseFloat(timeInp.value);
      if (!Number.isFinite(v) || v < 0) {
        setStatus("时间必须是非负数", "warn");
        timeInp.value = String(round(key.time, 6));
        return;
      }
      if (!animRetimeKey(name, kind, owner, field, key.time, v)) timeInp.value = String(round(key.time, 6));
    });
    row.appendChild(timeInp);
    for (const f of numericFields) {
      const wrap = el("span", "k-lbl", f);
      row.appendChild(wrap);
      const inp = document.createElement("input");
      inp.type = "number";
      inp.step = "0.01";
      inp.value = String(round(key[f] == null ? 0 : key[f], 6));
      inp.title = owner + " / " + field + " 的 " + f + " 值（相对 setup）";
      inp.setAttribute("aria-label", owner + " key 值 " + f);
      inp.addEventListener("change", () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v)) {
          inp.value = String(round(key[f] == null ? 0 : key[f], 6));
          setStatus("值必须是有限数字", "warn");
          return;
        }
        const values = {};
        values[f] = v;
        if (!animSetKeyValue(name, kind, owner, field, key.time, values)) inp.value = String(round(key[f] == null ? 0 : key[f], 6));
      });
      row.appendChild(inp);
    }
    if (kind === "slots") {
      const atts = exprAttachmentsFor(owner);
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "anim-att-name";
      inp.setAttribute("list", "animAttList");
      inp.value = key.name == null ? "" : String(key.name);
      inp.title = "附件名（必须存在于该槽；留空 = 该时间不显示附件）";
      inp.setAttribute("aria-label", owner + " 附件名");
      inp.addEventListener("change", () => {
        const v = inp.value.trim();
        const value = v === "" ? null : v;
        if (value !== null && atts.indexOf(value) < 0) {
          setStatus("附件 " + value + " 不存在于槽 " + owner + "，已拒绝写入", "warn");
          inp.value = key.name == null ? "" : String(key.name);
          return;
        }
        if (!animSetKeyValue(name, kind, owner, field, key.time, { name: value })) inp.value = key.name == null ? "" : String(key.name);
      });
      row.appendChild(inp);
    }
    const spacer = el("span", "spacer");
    row.appendChild(spacer);
    const del = exprButton("×", "anim-key-del", "删除该 key");
    del.setAttribute("aria-label", "删除 " + owner + " 在 " + round(key.time, 3) + "s 的 key");
    del.addEventListener("click", () => animRemoveKey(name, kind, owner, field, key.time));
    row.appendChild(del);
    box.appendChild(row);
  }

  function renderAnimStop(box, name, owner, track, kind) {
    const wrap = el("div", "anim-stop");
    const hd = el("div", "anim-stop-hd");
    const openKey = animTrackKey(kind, owner, track.key);
    const open = state.animEdit.expanded.has(openKey);
    hd.appendChild(iconEl(open ? "chevron-down" : "chevron-right", "caret"));
    hd.appendChild(el("span", null, (track.label || track.key) + (track.unit ? "（" + track.unit + "）" : "")));
    hd.appendChild(el("span", "spacer"));
    hd.appendChild(el("span", "anim-track-pill", track.keys.length + " keys"));
    const add = exprButton("+ 当前时间", "anim-add", "在 " + round(state.t, 3) + "s 处用当前预览值新增/更新 key");
    add.addEventListener("click", (e) => {
      e.stopPropagation();
      if (kind === "bones") animAddBoneKey(name, owner, track.key);
      else animAddSlotKey(name, owner, state.expr.override[owner] !== undefined ? state.expr.override[owner] : null);
    });
    hd.appendChild(add);
    hd.addEventListener("click", () => {
      animToggleTrack(openKey);
    });
    wrap.appendChild(hd);
    if (open) {
      const body = el("div", "anim-keys");
      if (track.unsupported) {
        body.appendChild(el("p", "anim-empty-note", "未识别的 timeline 字段：只显示，不编辑（保存时原样保留）。"));
      } else if (kind === "bones") {
        for (const key of track.keys) renderAnimKeyRow(body, name, kind, owner, track.key, key, track.fields || []);
      } else {
        for (const key of track.keys) renderAnimKeyRow(body, name, kind, owner, track.key, key, []);
        const note = el("p", "anim-empty-note", "空名 = 该时间不显示附件。可用附件：" + (exprAttachmentsFor(owner).slice(0, 6).join("、") || "（无）"));
        body.appendChild(note);
      }
      wrap.appendChild(body);
    }
    box.appendChild(wrap);
  }

  function renderAnimTrack(box, name, kind, owner, tracks, keyCount) {
    const tKey = animTrackKey(kind, owner);
    const open = state.animEdit.expanded.has(tKey);
    const row = el("div", "anim-track");
    const hd = document.createElement("button");
    hd.type = "button";
    hd.className = "anim-track-hd";
    hd.setAttribute("aria-expanded", open ? "true" : "false");
    hd.appendChild(iconEl(open ? "chevron-down" : "chevron-right", "caret"));
    hd.appendChild(el("span", "anim-track-name", owner));
    hd.appendChild(el("span", "spacer"));
    const props = tracks.map((t) => (t.label || t.key) + (t.unit || "")).join(" / ");
    hd.appendChild(el("span", "anim-track-pill" + (tracks.some((t) => t.unsupported) ? " is-warn" : ""), keyCount + " keys · " + props));
    hd.addEventListener("click", () => animToggleTrack(tKey));
    row.appendChild(hd);
    if (open) {
      const body = el("div", "anim-track-body");
      if (!tracks.length) {
        body.appendChild(el("p", "anim-empty-note", "该" + (kind === "bones" ? "骨" : "槽") + "在本动画里没有可编辑轨道。"));
        if (kind === "slots") {
          const add = exprButton("+ 在 " + round(state.t, 3) + "s 新增附件 key", "anim-add");
          add.addEventListener("click", () => animAddSlotKey(name, owner, null));
          body.appendChild(add);
        } else {
          for (const spec of animEditLib().boneFieldSpecs()) {
            const add = exprButton("+ " + spec.label + " key @ " + round(state.t, 3) + "s", "anim-add");
            add.addEventListener("click", () => animAddBoneKey(name, owner, spec.key));
            body.appendChild(add);
          }
        }
        row.appendChild(body);
        box.appendChild(row);
        return;
      }
      for (const t of tracks) renderAnimStop(body, name, owner, t, kind);
      if (kind === "bones") {
        const have = tracks.map((t) => t.key);
        for (const spec of animEditLib().boneFieldSpecs()) {
          if (have.indexOf(spec.key) >= 0) continue;
          const add = exprButton("+ " + spec.label + " key @ " + round(state.t, 3) + "s", "anim-add");
          add.addEventListener("click", () => animAddBoneKey(name, owner, spec.key));
          body.appendChild(add);
        }
      } else {
        const add = exprButton("+ 附件 key @ " + round(state.t, 3) + "s", "anim-add");
        add.addEventListener("click", () => animAddSlotKey(name, owner, null));
        body.appendChild(add);
      }
      row.appendChild(body);
    }
    box.appendChild(row);
  }

  function renderAnimTracks() {
    const name = state.animEdit.sel;
    const lib = animEditLib();
    const draft = name ? animDraft(name) : null;
    const bonesBox = el0("animBones");
    const slotsBox = el0("animSlots");
    bonesBox.textContent = "";
    slotsBox.textContent = "";
    if (!name || !draft || !lib) {
      el0("animBonesWrap").hidden = true;
      el0("animSlotsWrap").hidden = true;
      return;
    }
    const scan = lib.scanTracks(draft);
    const boneRows = scan.bones.filter((b) => b.tracks.length);
    el0("animBonesWrap").hidden = false;
    el0("animBoneCount").textContent = String(boneRows.length);
    for (const b of boneRows) renderAnimTrack(bonesBox, name, "bones", b.name, b.tracks, b.tracks.reduce((n, t) => n + t.keys.length, 0));
    if (!boneRows.length) bonesBox.appendChild(el("p", "anim-empty-note", "该动画没有骨轨道。"));

    el0("animSlotsWrap").hidden = false;
    const slotRows = scan.slots.filter((s) => s.tracks.length);
    el0("animSlotCount").textContent = String(slotRows.length);
    for (const s of slotRows) renderAnimTrack(slotsBox, name, "slots", s.name, s.tracks, s.tracks.reduce((n, t) => n + t.keys.length, 0));
    if (!slotRows.length) slotsBox.appendChild(el("p", "anim-empty-note", "该动画没有槽附件轨道。"));
  }

/*
 * 动画分页：动画列表渲染（修复）
 *
 * **问题背景**：HTML 里的容器是 animIdleWrap / animIdleList / animIdleCount
 * 与 animSeqWrap / animSeqList / animSeqCount（0.9.78 之后的结构），
 * 但 app.js 里的 renderAnimTracks 还在找 animBones / animSlots / animEditSel ——
 * 那些元素早已不存在。于是 renderAnimTracks 抛错被 try/catch 吞掉，
 * 列表永远空白，而 animEmpty 还显示「未载入动画」的误导文案。
 *
 * 这是 app.js 事故恢复时留下的错配：恢复目标是「让 selftest 全绿」，
 * 而自检只覆盖纯逻辑模块，DOM 渲染代码不在范围内。
 *
 * 本文件负责：把动画列表真正渲染进 animIdleList / animSeqList。
 */

/** 一行动画列表项（可点击选中 / 再次点击取消） */
function animListItem(name, label, meta, opts) {
  const o = opts || {};
  const row = el("button", "anim-item" + (o.selected ? " is-selected" : ""));
  row.type = "button";
  row.setAttribute("aria-pressed", o.selected ? "true" : "false");
  row.title = o.title || label || name;
  const nm = el("span", "anim-item-name", label || name);
  row.appendChild(nm);
  if (meta) row.appendChild(el("span", "anim-item-meta", meta));
  if (o.badge) row.appendChild(el("span", "anim-item-badge", o.badge));
  if (o.onClick) row.addEventListener("click", o.onClick);
  return row;
}

/**
 * 渲染「Spine · 待机动作」列表。
 * 数据源：state.model.animations（Map），与时间轴/播放用的是同一份。
 */
function renderAnimIdleList() {
  const wrap = el0("animIdleWrap");
  const list = el0("animIdleList");
  const count = el0("animIdleCount");
  if (!wrap || !list) return 0;

  const names = state.model && state.model.animations ? Array.from(state.model.animations.keys()) : [];
  /* 把「只在草稿里、还没保存」的动画也列出来（口型生成的 talk_* 就在这里）。
     否则用户生成了却看不到，会以为没成功。测试用的 __lip_test__ 不列。 */
  const draftNames = Object.keys(state.animEdit.drafts || {})
    .filter((n) => names.indexOf(n) < 0 && n.indexOf("__") !== 0);
  for (const n of draftNames) names.push(n);

  list.textContent = "";
  if (count) count.textContent = String(names.length);
  wrap.hidden = names.length === 0;
  if (!names.length) return 0;

  const fps = tlFps();
  const cur = state.animEdit.sel || state.anim || "";
  const keyCountOf = (name) => {
    const lib = animEditLib();
    const draft = animDraft(name);
    if (!lib || !draft) return 0;
    try {
      const scan = lib.scanTracks(draft);
      let n = 0;
      for (const b of scan.bones) for (const t of b.tracks) n += t.keys ? t.keys.length : 0;
      for (const s of scan.slots) for (const t of s.tracks) n += t.keys ? t.keys.length : 0;
      return n;
    } catch (_) { return 0; }
  };
  const metaOf = (name) => {
    const dur = animDuration(name);
    return round(dur, 2) + "s · " + Math.round(dur * fps) + " 帧 · " + keyCountOf(name) + " key";
  };
  const addItem = (name) => {
    list.appendChild(animListItem(name, animLabel(name), metaOf(name), {
      selected: name === cur,
      title: animLabel(name) + "（" + name + "）· " + metaOf(name),
      onClick: () => setAnimEditSelection(name),
    }));
  };

  /* ---- 分组：基础动作 / 表情 / 调试（用户要求「前端只展示待机、眨眼、说话」） ---- */
  const groups = animGroupNames(names);
  let shown = 0;

  /* 1) 基础动作：始终展开 */
  for (const n of groups.base) { addItem(n); shown++; }

  /* 2) 口型动画（talk_*，从台词音频生成）：独立成组，默认展开 —— 
     用户刚点完「生成到包」，必须立刻看得到，否则会以为没成功。 */
  if (groups.talk.length) {
    const open = state.animEdit.expandTalk !== false;
    const hd = el("button", "anim-group-hd");
    hd.type = "button";
    hd.setAttribute("aria-expanded", open ? "true" : "false");
    hd.appendChild(el("span", "anim-group-caret", open ? "▾" : "▸"));
    hd.appendChild(el("span", "anim-group-name", "口型"));
    hd.appendChild(el("span", "anim-group-count", String(groups.talk.length)));
    hd.title = open ? "收拢口型动画" : "展开口型动画（" + groups.talk.length + " 个）";
    hd.addEventListener("click", () => {
      state.animEdit.expandTalk = !open;
      renderAnimIdleList();
    });
    list.appendChild(hd);
    if (open) {
      for (const n of groups.talk) { addItem(n); shown++; }
    } else if (groups.talk.indexOf(cur) >= 0) {
      addItem(cur);
      shown++;
    }
  }

  /* 3) 表情：默认收起，点标题展开 */
  if (groups.expression.length) {
    const open = !!state.animEdit.expandExpression;
    const hd = el("button", "anim-group-hd");
    hd.type = "button";
    hd.setAttribute("aria-expanded", open ? "true" : "false");
    hd.appendChild(el("span", "anim-group-caret", open ? "▾" : "▸"));
    hd.appendChild(el("span", "anim-group-name", "表情"));
    hd.appendChild(el("span", "anim-group-count", String(groups.expression.length)));
    hd.title = open ? "收起表情动画" : "展开表情动画（" + groups.expression.length + " 个）";
    hd.addEventListener("click", () => {
      state.animEdit.expandExpression = !open;
      renderAnimIdleList();
    });
    list.appendChild(hd);
    if (open) {
      for (const n of groups.expression) { addItem(n); shown++; }
    } else if (groups.expression.indexOf(cur) >= 0) {
      /* 当前选中的是表情但列表收起 → 仍然显示它，否则用户看不出在播哪个 */
      addItem(cur);
      shown++;
    }
  }

  /* 3) 调试用动画：默认收起，且用灰字标明 */
  if (groups.debug.length) {
    const open = !!state.animEdit.expandDebug;
    const hd = el("button", "anim-group-hd is-debug");
    hd.type = "button";
    hd.setAttribute("aria-expanded", open ? "true" : "false");
    hd.appendChild(el("span", "anim-group-caret", open ? "▾" : "▸"));
    hd.appendChild(el("span", "anim-group-name", "调试"));
    hd.appendChild(el("span", "anim-group-count", String(groups.debug.length)));
    hd.title = "开发调试用动画（视线网格预览等），一般不需要";
    hd.addEventListener("click", () => {
      state.animEdit.expandDebug = !open;
      renderAnimIdleList();
    });
    list.appendChild(hd);
    if (open) {
      for (const n of groups.debug) { addItem(n); shown++; }
    }
  }
  return shown;
}

/**
 * 把动画名分成三组。
 *   基础动作：待机 / 眨眼 / 说话 —— 用户明确要求前端只展示这三个
 *   表情：其余的角色表演动画（开心/难过/害羞…）
 *   调试：视线网格预览这类开发用动画
 */
function animGroupNames(names) {
  const BASE = ["idle", "blink", "talk_generic"];
  const DEBUG = ["gaze_grid_preview"];
  const base = [];
  const talk = [];
  const expression = [];
  const debug = [];
  for (const n of names) {
    if (DEBUG.indexOf(n) >= 0) { debug.push(n); continue; }
    if (BASE.indexOf(n) >= 0) { base.push(n); continue; }
    /* 口型动画独立成组：talk_generic 是内置的通用说话，talk_<台词id> 是生成出来的 */
    if (n.indexOf("talk_") === 0) { talk.push(n); continue; }
    expression.push(n);
  }
  /* 基础动作按固定顺序（待机→眨眼→说话），不跟随底层键序 */
  base.sort((a, b) => BASE.indexOf(a) - BASE.indexOf(b));
  talk.sort();
  return { base: base, talk: talk, expression: expression, debug: debug };
}

/**
 * 渲染「序列帧 · 复杂动作」列表。
 * 数据源：catalog 里的 sequence 注册表。拿不到就隐藏该区（不编造数据）。
 */
function renderAnimSeqList() {
  const wrap = el0("animSeqWrap");
  const list = el0("animSeqList");
  const count = el0("animSeqCount");
  if (!wrap || !list) return 0;

  list.textContent = "";
  const seqs = animSequenceEntries();
  if (count) count.textContent = String(seqs.length);
  wrap.hidden = seqs.length === 0;
  if (!seqs.length) return 0;

  for (const s of seqs) {
    const meta = (s.frames != null ? s.frames + " 帧" : "") + (s.fps ? " · " + s.fps + "fps" : "");
    list.appendChild(animListItem(s.id, s.label || s.id, meta, {
      title: (s.label || s.id) + "（序列帧，只读）",
      badge: "序列帧",
      onClick: () => setStatus("序列帧动画「" + (s.label || s.id) + "」是只读的，请在序列帧编辑器里改", "warn"),
    }));
  }
  return seqs.length;
}

/** 从 catalog 里取出序列帧条目；没有就返回空数组（不编造） */
function animSequenceEntries() {
  const out = [];
  const cat = state.catalog;
  if (!cat) return out;
  /* 兼容几种可能的结构，任一层存在就用它 */
  const reg = cat.registries || cat;
  const seq = reg && (reg.sequence || reg.sequences);
  const push = (id, v) => {
    if (!id) return;
    const o = v && typeof v === "object" ? v : {};
    out.push({
      id: id,
      label: o.label || o.name || animLabel(id),
      frames: Number.isFinite(o.frames) ? o.frames : (Array.isArray(o.frameList) ? o.frameList.length : null),
      fps: Number.isFinite(o.fps) ? o.fps : null,
    });
  };
  if (Array.isArray(seq)) {
    for (const it of seq) {
      if (typeof it === "string") push(it, null);
      else if (it && typeof it === "object") push(it.id || it.name || it.clipId, it);
    }
  } else if (seq && typeof seq === "object") {
    for (const k of Object.keys(seq)) push(k, seq[k]);
  }
  return out;
}

/**
 * 动画分页总渲染（替代原来的 renderAnimTracks 调用点）。
 * 保留轨道区（animBones/animSlots 若存在则照旧渲染；不存在就跳过，不再抛错）。
 */
/*
 * 音频 → 嘴型动画：UI/集成层
 *
 * 流程：
 *   1) 取当前选中台词的 .ogg（复用 voiceLineUrl）
 *   2) decodeAudioWave 解码 → 峰值包络（audio-wave.js）
 *   3) SpineLipSync.build → 口型关键帧（lip-sync.js）
 *   4) 写进一个**新动画** talk_<台词id>（不动原始 21 个动画）
 *
 * 不直接改真实包：生成后先放在内存草稿里，由用户决定是否保存。
 */

/*
 * 口型测试台：让用户能「听声音 + 看嘴动」，而不是看数据。
 *
 * 做法：
 *   1) 生成口型关键帧（lip-sync）
 *   2) 写进临时动画 talk_test
 *   3) 同时播放：音频 <audio> 播放 + 编辑器时间轴按真实时间推进
 *   4) 用户能听到声音、看到角色嘴型跟着动
 *
 * 为什么不用编辑器自带的播放：它的播放是固定帧率推进，与音频不同步；
 * 这里用 audio.currentTime 驱动播放头，保证「听到什么就看到什么」。
 */

let _lipTest = null;   /* { animName, audio, raf, savedAnim } */

/**
 * 把视图放大到脸部（口型测试专用）。
 *
 * **为什么需要**：嘴巴在整身视图里只有 23×6 世界单位，默认缩放 0.5 时
 * 屏幕上仅约 11×3 px（张嘴时约 11×10 px）—— 实测截图确认变化真实存在，
 * 但用户在整身视图里几乎看不出来，会误判成「没动」。
 * 所以测试期间自动把镜头推到脸部，结束再恢复原视图。
 *
 * 变换约定（见 viewParams）：tx = viewW/2 + panX，ty = viewH/2 - panY。
 * 因此要让世界点 (cx, cy) 居中，panX = -cx*z、panY = -cy*z（与 fitView 一致）。
 *
 * @returns {{zoom:number, panX:number, panY:number}|null} 原视图，供恢复
 */
/*
 * 混合动画：基础动画（表情/待机）+ 口型 → 一条可直接播放的动画
 *
 * **为什么需要**：实测 21 个动画里只有 idle / blink 不碰嘴巴，
 * 其余 17 个表情的嘴巴轨道都把嘴型**锁死成一种**（happy=快乐、sad=不开心…）。
 * 所以「说话时动嘴」和「用表情」在单条动画里会互相覆盖。
 *
 * 用户要的做法：说话时嘴巴跟音频动，说完保持表情的嘴型。
 * 于是合成一条动画：
 *   骨骼轨道  ← idle 平铺循环（保证呼吸不中断）
 *   槽轨道    ← 基础动画的非嘴巴轨道（眼睛/眉毛/眼白/眼珠/睫毛）
 *   嘴巴轨道  ← 口型关键帧 + 末尾一个「基础动画原本的嘴型」
 * 这样 0~时长 内嘴巴对口型，最后一帧回到表情嘴型，结束后自然保持。
 */

/** 深拷贝（结构简单，JSON 即可；不引外部 clone 以免依赖顺序） */
/*
 * lipsync.json 载入 / 校验 / 预览
 *
 * **为什么是这条路径**：本包的口型机制不是「烘焙成 Spine 动画」，而是运行时包络。
 *   manifest.spine.lipsync → spine/lipsync.json
 *   运行时按音频播放头查 runs 得到档位，直接设 mouthSlot 的附件。
 *   契约 expr-anim-contract.md v2 §3.3 规定：
 *     · 0≤t<durationSec 时以 floor(t/.01 + 1e-9) 查最后一个 frame≤当前帧的 run，不插值
 *     · 实际播放查询前先加 20ms 前视（playheadLookaheadSec）
 *     · t≥durationSec 直接返回 0（endRule）
 *     · ended/stop/error 时清 override、恢复**当时** base 表情嘴（restore: current-expression-mouth）
 *
 * 本模块只读该文件，并复现上述查询语义用于预览；不改写 lipsync.json。
 */

const LIPSYNC_ALGORITHM = "rms-absolute-5level-v2";

/** lipsync.json 的包内相对路径（优先 manifest/索引声明，退回 spine 目录约定） */
function lipsyncPath() {
  const b = state.bundle;
  const idx = b && b.index;
  if (idx) {
    if (idx.spine && typeof idx.spine.lipsync === "string" && idx.spine.lipsync) return idx.spine.lipsync;
    if (idx.files && typeof idx.files.lipsync === "string" && idx.files.lipsync) return idx.files.lipsync;
  }
  return "spine/lipsync.json";
}

/**
 * 候选 URL 列表。
 * **坑**：manifest 里写的是「相对包根」的路径（spine/lipsync.json），
 * 而页面要的是「相对服务器根」的地址（workspace/packs/deepseek/spine/lipsync.json），
 * 所以必须补包根前缀；直接 fetch 相对路径会 404。
 */
function lipsyncUrlCandidates(declared) {
  const rel = String(declared || lipsyncPath() || "").replace(/^\/+/, "");
  const out = [];
  const root = typeof packRootDir === "function" ? packRootDir() : null;
  const sdir = typeof spineDir === "function" ? spineDir() : null;
  /* **必须有前导斜杠**：页面在 /tools/character-editor/ 下，
     相对路径会解析成 /tools/character-editor/workspace/... 而 404。
     实测正确地址是 /workspace/packs/deepseek/spine/lipsync.json。 */
  if (root) out.push("/" + String(root).replace(/^\/+|\/+$/g, "") + "/" + rel);
  if (sdir) out.push("/" + String(sdir).replace(/^\/+|\/+$/g, "") + "/" + rel.replace(/^spine\//, ""));
  if (rel) out.push("/" + rel);
  /* 去重保序 */
  return out.filter((u, i) => u && u !== "/" && out.indexOf(u) === i);
}

/** 载入并缓存（同一路径只取一次；失败不抛，返回原因） */
async function lipsyncLoad(opts) {
  const o = opts || {};
  const rel = o.path || lipsyncPath();
  const cur = state.lipsync;
  if (!o.force && cur && cur.rel === rel && cur.data) return { ok: true, cached: true, path: cur.path, rel: rel, data: cur.data };
  const urls = o.url ? [o.url] : lipsyncUrlCandidates(rel);
  if (!urls.length) return { ok: false, reason: "找不到 lipsync.json 的路径（包可能没有口型数据）" };
  const tried = [];
  for (const u of urls) {
    tried.push(u);
    try {
      const res = await fetch(u, { cache: "no-cache" });
      if (!res.ok) continue;
      const text = await res.text();
      const data = JSON.parse(text);
      state.lipsync = { path: u, rel: rel, data: data, loadedAt: Date.now(), bytes: text.length };
      return { ok: true, path: u, rel: rel, data: data, bytes: text.length };
    } catch (e) {
      /* 试下一个候选 */
    }
  }
  state.lipsync = null;
  return { ok: false, reason: "读取失败（试过 " + tried.join(" → ") + "）" };
}

/** 当前缓存的数据（无则 null） */
function lipsyncData() {
  return state.lipsync && state.lipsync.data ? state.lipsync.data : null;
}

/** 按 id 取某条台词的口型记录 */
function lipsyncLineById(id) {
  const d = lipsyncData();
  if (!d || !Array.isArray(d.lines)) return null;
  for (const l of d.lines) if (l && l.id === id) return l;
  return null;
}

/**
 * **运行时同语义**的档位查询。
 * @param {object} line lipsync.lines 里的一条
 * @param {number} t 音频播放头（秒）
 * @param {boolean} [applyLookahead=true] 播放查询要加 20ms 前视；离线对齐可关掉
 */
function lipsyncLevelAt(line, t, applyLookahead) {
  if (!line || !Array.isArray(line.runs) || !line.runs.length) return 0;
  const hop = 0.01;
  const tt = t + (applyLookahead === false ? 0 : 0.02);
  const dur = Number.isFinite(line.durationSec) ? line.durationSec : 0;
  if (dur > 0 && tt >= dur) return 0;   /* endRule: t>=durationSec → 0 */
  if (tt < 0) return 0;
  const frame = Math.floor(tt / hop + 1e-9);
  let lv = 0;
  for (const r of line.runs) {
    if (!r || !Number.isFinite(r.frame)) continue;
    if (r.frame <= frame) lv = r.level; else break;   /* runs 严格递增 */
  }
  return lv;
}

/** 档位 → 附件名（读文件自带的 attachments 映射，不写死） */
function lipsyncAttachmentName(level) {
  const d = lipsyncData();
  const map = d && d.attachments ? d.attachments : null;
  if (map && map[String(level)] != null) return map[String(level)];
  if (level === 0) return "mouth_无表情";
  const fallback = { 25: "mouth_张嘴_25", 50: "mouth_张嘴_50", 75: "mouth_张嘴_75", 100: "mouth_张嘴_100" };
  return fallback[level] || "mouth_无表情";
}

/**
 * 用 runs 采样成关键帧（相邻同档合并）。预览用；不是运行时依赖。
 * @param {object} line
 * @param {number} fps 采样帧率（编辑器时间轴帧率）
 */
function lipsyncKeysFromRuns(line, fps) {
  const f = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const dur = Number.isFinite(line && line.durationSec) ? line.durationSec : 0;
  if (!(dur > 0)) return [];
  const frames = Math.max(1, Math.round(dur * f));
  const keys = [];
  let last = null;
  for (let i = 0; i < frames; i++) {
    /* 采样点用帧中心，避免 floor 边界抖动；查询本身走运行时同语义 */
    const t = (i + 0.5) / f;
    if (t >= dur) break;
    const lv = lipsyncLevelAt(line, t);
    if (lv === last) continue;
    keys.push({ time: Math.round(t * 1e6) / 1e6, level: lv, name: lipsyncAttachmentName(lv) });
    last = lv;
  }
  /* 首帧补 t=0，保证从静音开始 */
  if (!keys.length || keys[0].time > 1e-9) keys.unshift({ time: 0, level: 0, name: lipsyncAttachmentName(0) });
  return keys;
}

/**
 * 契约校验（§3.3）。返回不通过项清单，空数组表示通过。
 */
function lipsyncValidate(data) {
  const d = data || lipsyncData();
  const issues = [];
  if (!d) return [{ code: "NO_DATA", message: "没有 lipsync 数据" }];
  if (d.schemaVersion !== 1) issues.push({ code: "SCHEMA", message: "schemaVersion 应为 1，实际 " + d.schemaVersion });
  if (d.algorithm !== LIPSYNC_ALGORITHM) issues.push({ code: "ALGORITHM", message: "算法应为 " + LIPSYNC_ALGORITHM + "，实际 " + d.algorithm });
  const tb = d.timebase || {};
  if (tb.hopSec !== 0.01) issues.push({ code: "HOP", message: "hopSec 应为 0.01" });
  if (tb.interpolation !== "step") issues.push({ code: "INTERP", message: "interpolation 应为 step" });
  if (tb.endRule !== "t>=durationSec:level0") issues.push({ code: "ENDRULE", message: "endRule 应为 t>=durationSec:level0" });
  if (!d.mouthSlot) issues.push({ code: "MOUTH_SLOT", message: "缺少 mouthSlot" });
  const att = d.attachments || {};
  for (const lv of ["0", "25", "50", "75", "100"]) {
    if (!att[lv]) issues.push({ code: "ATTACH", message: "attachments 缺少档位 " + lv });
  }
  const lines = Array.isArray(d.lines) ? d.lines : null;
  if (!lines) { issues.push({ code: "LINES", message: "lines 必须是数组" }); return issues; }
  const seen = new Set();
  let runBad = 0, dup = 0, firstBad = 0;
  for (const l of lines) {
    if (!l || typeof l.id !== "string") { issues.push({ code: "LINE_ID", message: "有记录缺少 id" }); continue; }
    if (seen.has(l.id)) dup++; else seen.add(l.id);
    const runs = Array.isArray(l.runs) ? l.runs : null;
    if (!runs || !runs.length) { runBad++; continue; }
    if (runs[0].frame !== 0 || runs[0].level !== 0) firstBad++;
    for (let i = 1; i < runs.length; i++) {
      const p = runs[i - 1], c = runs[i];
      if (!Number.isInteger(c.frame) || c.frame <= p.frame) runBad++;
      else if (c.level === p.level) runBad++;
      else if (Number.isFinite(l.frames) && c.frame >= l.frames) runBad++;
    }
  }
  if (dup) issues.push({ code: "DUP_ID", message: "重复 id " + dup + " 条" });
  if (firstBad) issues.push({ code: "FIRST_RUN", message: firstBad + " 条首 run 不是 frame=0/level=0" });
  if (runBad) issues.push({ code: "RUNS", message: runBad + " 处 run 不合规（需严格递增、相邻档位不同、frame<frames）" });
  return issues;
}

/** 面板/状态栏用的一行摘要 */
function lipsyncSummary() {
  const s = state.lipsync;
  if (!s || !s.data) return "未载入 lipsync.json";
  const issues = lipsyncValidate(s.data);
  return s.data.lines.length + " 条口型 · " + s.data.algorithm +
    (issues.length ? " · " + issues.length + " 项不合规" : " · 校验通过");
}

/*
 * 以「事件声明的表情」为基础合成口型动画
 *
 * **为什么必须走事件**：events.json 里每个事件都带 expression：
 *   { "id":"all_completed", "expression":{ "左眼":"whole_L_星星眼", ...,
 *                                          "嘴巴":"mouth_快乐" } }
 * 契约 §3.3 第374行②也要求运行时「应用 eventMap 的脸部 base」，
 * ⑤ 要求结束后「恢复当时 base 表情嘴」。
 * 所以基础嘴型是**事件声明的那一个**（如 mouth_快乐），
 * 不是从动画名（happy/proud…）反推 —— 两者并不总是一致（proud 是 愉快）。
 */

/** 取某条台词所属的事件对象（台词挂载在 event.lines 上） */
function eventOfLine(lineId) {
  const v = state.voice;
  if (!v || !Array.isArray(v.events) || !lineId) return null;
  for (const ev of v.events) {
    const lines = ev && Array.isArray(ev.lines) ? ev.lines : [];
    for (const ln of lines) {
      if (!ln) continue;
      if (ln.id === lineId || ln.audioId === lineId) return ev;
    }
  }
  return null;
}

/** 事件声明的表情部位（无则 null） */
function eventExpressionOf(lineId) {
  const ev = eventOfLine(lineId);
  return ev && ev.expression && typeof ev.expression === "object" ? ev.expression : null;
}

/**
 * 用事件表情合成：骨骼用 idle 平铺，槽用事件表情，嘴巴走口型 + 末尾回事件嘴型。
 * @param {object} exprParts 事件 expression（左眼、右眼、眉毛_左、眉毛_右、眨眼_左/右、嘴巴…）
 * @param {{keys:Array,duration:number}} lip
 */
function lipSyncMergeFromEvent(exprParts, lip) {
  const raw = state.raw;
  if (!raw || !raw.animations) return { ok: false, reason: "没有载入动画数据" };
  if (!lip || !Array.isArray(lip.keys) || !lip.keys.length) return { ok: false, reason: "没有口型关键帧" };
  const dur = Number.isFinite(lip.duration) && lip.duration > 0
    ? Math.round(lip.duration * 1e6) / 1e6
    : Math.round(lip.keys[lip.keys.length - 1].time * 1e6) / 1e6;

  const anim = { bones: {}, slots: {}, duration: dur };

  /* 1) 骨骼：idle 平铺循环，说话期间保持呼吸 */
  const idle = raw.animations.idle;
  if (idle && idle.bones) {
    for (const bone of Object.keys(idle.bones)) {
      const fields = idle.bones[bone];
      if (!fields || typeof fields !== "object") continue;
      anim.bones[bone] = {};
      for (const field of Object.keys(fields)) anim.bones[bone][field] = lipTileKeys(fields[field], dur);
    }
  }

  /* 2) 槽：事件表情 → 固定附件轨道（除嘴巴）。
     用 exprSlotsFromParts 复用表情页同一套映射，避免两处漂移。 */
  const slots = typeof exprSlotsFromParts === "function" ? exprSlotsFromParts(exprParts || {}, {}) : {};
  let baseTracks = 0;
  let exprMouth = null;
  let exprFx = null;
  for (const slotName of Object.keys(slots)) {
    if (slotName === "嘴巴") { exprMouth = slots[slotName]; continue; }
    if (slotName === "嘴巴特效") { exprFx = slots[slotName]; continue; }
    const val = slots[slotName];
    /* null = 该槽不显示附件；仍然写轨道，保证与表情页表现一致 */
    anim.slots[slotName] = { attachment: [{ time: 0, name: val == null ? null : val }, { time: dur, name: val == null ? null : val }] };
    baseTracks++;
  }
  /* **嘴巴特效**（mouth_嘘_气 这类从嘴里出来的气）属于「静态嘘声造型」：
     它和嘴巴槽在同一个位置，口型一开始驱动嘴巴，它就会叠在张开/闭合的嘴上。
     处理：口型期间隐藏，音频结束后进入**尾巴子动画**（用户要求）：
       dur         起：气出现，透明度 0
       dur+0.25s   ：渐显到 1
       dur+0.55s   ：保持 1
       dur+0.90s   ：渐隐回 0（动画结束）
     透明度走标准 slots.<slot>.color 轨道（Spine 4.2），由 spine-core 求值、
     绘制时乘进 globalAlpha —— 所以是真的渐显渐隐，不是跳变。
     注：编辑器不限制嘘/嘘_气的组合（表情页可任意配），这里只处理口型叠加。 */
  const FX_TAIL = 0.9;
  const total = Math.round((dur + (exprFx != null ? FX_TAIL : 0)) * 1e6) / 1e6;
  anim.duration = total;
  if (exprFx != null) {
    anim.slots["嘴巴特效"] = { attachment: [{ time: 0, name: null }, { time: dur, name: exprFx }] };
    const a1 = Math.round((dur + 0.25) * 1e6) / 1e6;
    const a2 = Math.round((dur + 0.55) * 1e6) / 1e6;
    /* **必须是 Spine 原生的 color 字符串格式**（rrggbbaa）：
       写成 {time, alpha} 会被草稿/解析链路按「无 color 字段」处理，alpha 恒为 1
       （实测：解析出来的 5 个键 alpha 全是 1，渐变失效）。 */
    anim.slots["嘴巴特效"].color = [
      { time: 0, color: "ffffff00" },
      { time: dur, color: "ffffff00" },
      { time: a1, color: "ffffffff" },
      { time: a2, color: "ffffffff" },
      { time: total, color: "ffffff00" },
    ];
    /* **气要向右飘走**（用户：原地太假）。嘴巴特效槽挂在新骨 mouth_fx（head 的子骨）上，
       所以尾巴里给这根骨加 translate 轨道：从嘴边 0 开始，边渐显边右移，
       渐隐结束时已飘出一段距离（~74 单位，嘴宽 27 的 2.7 倍）。 */
    if (Array.isArray(raw.bones) && raw.bones.some((b) => b && b.name === "mouth_fx")) {
      anim.bones["mouth_fx"] = {
        translate: [
          { time: 0, x: -9, y: 0 },
          { time: dur, x: -9, y: 0 },
          { time: Math.round((dur + 0.30) * 1e6) / 1e6, x: 15, y: 4 },
          { time: Math.round((dur + 0.60) * 1e6) / 1e6, x: 43, y: 8 },
          { time: total, x: 65, y: 12 },
        ],
      };
    }
    baseTracks++;
  }
  /* 末尾恢复事件声明的嘴型（保持原值，可能是 null = 该造型不显示嘴巴） */
  const tailMouth = exprMouth == null ? null : exprMouth;

  /* 3) 嘴巴：口型关键帧 + 末尾回事件嘴型（契约 ⑤「结束后才恢复情绪嘴」） */
  const mouthKeys = lip.keys
    .filter((k) => Number.isFinite(k.time) && k.time >= 0 && k.name && k.time < dur - 1e-9)
    .map((k) => ({ time: Math.round(k.time * 1e6) / 1e6, name: k.name }));
  mouthKeys.push({ time: dur, name: tailMouth });
  const byTime = new Map();
  for (const k of mouthKeys) byTime.set(k.time, k);
  anim.slots["嘴巴"] = { attachment: Array.from(byTime.values()).sort((a, b) => a.time - b.time) };

  return {
    ok: true,
    anim: anim,
    mouthTail: tailMouth,
    baseTracks: baseTracks,
    hasEyeLayer: baseTracks > 0,
    boneTracks: Object.keys(anim.bones).length,
    mouthKeys: anim.slots["嘴巴"].attachment.length,
    duration: dur,           /* 音频时长（口型部分） */
    totalDuration: total,    /* 含尾巴子动画的总时长 */
    fxTail: exprFx != null ? FX_TAIL : 0,
    fromEvent: true,
  };
}

function lipClone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

/**
 * 把一组关键帧按周期平铺，覆盖到 dur。
 * 例：3.5s 的待机键铺到 4.77s → 第 2 段接在 3.5s 处。
 * 每段只取 [0, period) 内的键，最后补一个 dur 处的键（值取第一帧），保证末尾不回弹。
 */
function lipTileKeys(src, dur) {
  const keys = Array.isArray(src) ? src : [];
  if (!keys.length) return [];
  const period = keys.reduce((m, k) => Math.max(m, Number(k.time) || 0), 0);
  if (!(period > 0)) return lipClone(keys);
  const out = [];
  const cycles = Math.ceil(dur / period) + 1;
  for (let c = 0; c < cycles; c++) {
    const off = c * period;
    for (const k of keys) {
      const t = (Number(k.time) || 0) + off;
      if (t >= period * (c + 1) - 1e-9) continue; /* 每段去掉末端，避免与下段首帧同时刻 */
      if (t > dur + 1e-9) continue;
      const nk = lipClone(k);
      nk.time = Math.round(t * 1e6) / 1e6;
      out.push(nk);
    }
  }
  /* 末尾补帧：取首帧的值，保证 dur 处有确定姿态 */
  const last = lipClone(keys[0]);
  last.time = Math.round(dur * 1e6) / 1e6;
  out.push(last);
  /* 去重（同时间只留最后一个）并排序 */
  const byTime = new Map();
  for (const k of out) byTime.set(k.time, k);
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

/** 取一个动画里某个槽附件轨道的最后一个「非 null」值（即它的固定嘴型） */
function lipFixedMouthOf(anim) {
  const t = anim && anim.slots && anim.slots["嘴巴"] ? anim.slots["嘴巴"].attachment : null;
  if (!Array.isArray(t) || !t.length) return null;
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] && t[i].name) return t[i].name;
  }
  return null;
}

/**
 * 合成「基础动画 + 口型」。
 * @param {string} baseName 基础动画名（表情或 idle/blink）
 * @param {{keys:Array<{time:number,name:string}>, duration:number}} lip 口型结果
 * @param {{fps?:number}} [opts]
 * @returns {{ok:boolean, anim?:object, reason?:string, mouthTail?:string, baseTracks?:number}}
 */
function lipSyncMerge(baseName, lip, opts) {
  const o = opts || {};
  const raw = state.raw;
  if (!raw || !raw.animations) return { ok: false, reason: "没有载入动画数据" };
  if (!lip || !Array.isArray(lip.keys) || !lip.keys.length) return { ok: false, reason: "没有口型关键帧" };
  const dur = Number.isFinite(lip.duration) && lip.duration > 0
    ? Math.round(lip.duration * 1e6) / 1e6
    : Math.round(lip.keys[lip.keys.length - 1].time * 1e6) / 1e6;

  const base = raw.animations[baseName] || null;
  const idle = raw.animations.idle || null;

  const anim = { bones: {}, slots: {}, duration: dur };

  /* 1) 骨骼轨道：用 idle 平铺循环 —— 说话期间角色仍在呼吸 */
  if (idle && idle.bones) {
    for (const bone of Object.keys(idle.bones)) {
      const fields = idle.bones[bone];
      if (!fields || typeof fields !== "object") continue;
      anim.bones[bone] = {};
      for (const field of Object.keys(fields)) {
        anim.bones[bone][field] = lipTileKeys(fields[field], dur);
      }
    }
  }
  /* 基础动画自带的骨骼轨道优先（例如将来某个表情带骨骼） */
  if (base && base.bones) {
    for (const bone of Object.keys(base.bones)) {
      const fields = base.bones[bone];
      if (!fields || typeof fields !== "object") continue;
      if (!anim.bones[bone]) anim.bones[bone] = {};
      for (const field of Object.keys(fields)) anim.bones[bone][field] = lipClone(fields[field]);
    }
  }

  /* 2) 槽轨道：基础动画除嘴巴外全部保留（眼睛/眉毛/眼白/眼珠/睫毛） */
  let baseTracks = 0;
  if (base && base.slots) {
    for (const slot of Object.keys(base.slots)) {
      if (slot === "嘴巴") continue;
      anim.slots[slot] = lipClone(base.slots[slot]);
      baseTracks++;
    }
  }
  const hasEyeLayer = baseTracks > 0;

  /* 3) 嘴巴轨道：口型关键帧 + 末尾恢复基础动画原本的嘴型 */
  const tail = lipFixedMouthOf(base) || "mouth_无表情";
  const mouthKeys = lip.keys
    .filter((k) => Number.isFinite(k.time) && k.time >= 0 && k.name && k.time < dur - 1e-9)
    .map((k) => ({ time: Math.round(k.time * 1e6) / 1e6, name: k.name }));
  mouthKeys.push({ time: dur, name: tail });
  const byTime = new Map();
  for (const k of mouthKeys) byTime.set(k.time, k);
  anim.slots["嘴巴"] = { attachment: Array.from(byTime.values()).sort((a, b) => a.time - b.time) };

  return {
    ok: true,
    anim: anim,
    mouthTail: tail,
    baseTracks: baseTracks,
    hasEyeLayer: hasEyeLayer,
    boneTracks: Object.keys(anim.bones).length,
    mouthKeys: anim.slots["嘴巴"].attachment.length,
    duration: dur,
  };
}

function lipTestFocusFace() {
  const mouthIdx = state.slots.findIndex((s) => s.name === "嘴巴");
  if (mouthIdx < 0) return null;
  const f = state.frame || (typeof framePose === "function" ? framePose() : null);
  if (!f || !f.geo) return null;
  const g = f.geo.find((x) => x.slotIndex === mouthIdx);
  if (!g || !g.bounds) return null;

  const b = g.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const mouthW = Math.max(4, b.maxX - b.minX);

  /* 以嘴巴为中心取一块区域：宽度给 16 倍嘴宽（能带上整张脸与眉眼），
     高度按画布比例换算，避免拉伸。倍数太小会只剩一张嘴，看不出表情。 */
  const regionW = mouthW * 16;
  const regionH = regionW * (viewH() / Math.max(1, viewW()));
  const pad = 20;
  const availW = Math.max(40, viewW() - pad * 2);
  const availH = Math.max(40, viewH() - pad * 2);
  const z = clamp(Math.min(availW / regionW, availH / regionH), 0.02, 12);

  const old = { zoom: state.zoom, panX: state.panX, panY: state.panY };
  state.zoom = z;
  state.panX = -cx * z;
  state.panY = -cy * z;
  if (typeof syncZoom === "function") syncZoom();
  render();
  return old;
}

/**
 * 静态预览：把「事件表情 + 口型」混合后装进编辑器（不播音频）。
 * 用途：不播放时检查某时刻的合成结果，也让 T4/截图可以定格取证。
 * @param {{lineId?:string, fps?:number}} opts
 */
async function lipPreviewStatic(opts) {
  const o = opts || {};
  lipTestStop({ silent: true });
  const line = lipTestLine(o.lineId);
  if (!line) return { ok: false, reason: "先在台词页选中一条台词" };
  const gen = await lipKeysForLine(line, { fps: o.fps, silenceThreshold: o.silenceThreshold, smooth: o.smooth });
  if (!gen.ok) return gen;
  const TEST_NAME = "__lip_test__";
  const exprParts = eventExpressionOf(line.id);
  const merged = exprParts
    ? lipSyncMergeFromEvent(exprParts, gen)
    : lipSyncMerge((state.anim && state.anim !== TEST_NAME ? state.anim : "idle"), gen);
  if (!merged.ok) return { ok: false, reason: merged.reason || "混合失败" };
  animSetDraft(TEST_NAME, merged.anim);
  setAnim(TEST_NAME);
  syncAnimPanel();
  const view = lipTestFocusFace();
  _lipTest = { animName: TEST_NAME, audio: null, raf: 0, savedAnim: null, savedView: view, static: true, lineId: line.id };
  state.playing = false;
  return {
    ok: true, static: true, animName: TEST_NAME,
    duration: merged.duration, mouthKeys: merged.mouthKeys, mouthTail: merged.mouthTail,
    totalDuration: merged.totalDuration || merged.duration, fxTail: merged.fxTail || 0,
    hasEyeLayer: merged.hasEyeLayer, boneTracks: merged.boneTracks,
  };
}

/**
 * 取一条台词的口型关键帧。
 * **优先用包内 lipsync.json 的 runs**（运行时真正用的数据），取不到才退回本地包络估算。
 * 返回里带 source 字段标明数据源，供状态栏如实显示。
 */
async function lipKeysForLine(line, opts) {
  const o = opts || {};
  const lsRes = await lipsyncLoad();
  const lsLine = lsRes.ok ? lipsyncLineById(line.id) : null;
  if (lsLine) {
    const fps = Number.isFinite(o.fps) && o.fps > 0 ? o.fps : tlFps();
    const keys = lipsyncKeysFromRuns(lsLine, fps);
    if (keys.length) {
      return {
        ok: true,
        keys: keys,
        frames: lsLine.frames,
        inserted: 0,
        duration: lsLine.durationSec,
        fps: fps,
        source: "pack-lipsync",
        summary: keys.length + " 个口型关键帧（来自 lipsync.json）",
      };
    }
  }
  const local = await lipSyncFromCurrentLine({
    lineId: line.id, fps: o.fps,
    silenceThreshold: o.silenceThreshold, smooth: o.smooth,
  });
  if (local && local.ok) local.source = "local-envelope";
  return local;
}

/** 取当前台词对象 */
function lipTestLine(lineId) {  const v = state.voice;
  const id = lineId || (v && v.play ? v.play.id : null);
  if (!id) return null;
  for (const ev of v.events || []) {
    for (const ln of ev.lines || []) {
      if (ln && ln.id === id) return ln;
    }
  }
  return null;
}

/** 停止口型测试（恢复原动画、停音频、停循环） */
function lipTestStop(opts) {
  const o = opts || {};
  if (!_lipTest) return { ok: true, already: true };
  const t = _lipTest;
  _lipTest = null;
  if (t.raf) clearInterval(t.raf);
  if (t.audio) {
    try { t.audio.pause(); } catch (_) { /* 忽略 */ }
  }
  state.playing = false;
  syncPlayButton();
  /* **清掉测试草稿**：契约 §3.3 规定 lipsync 是独立 sidecar、不进 model 动画，
     留着 __lip_test__ 会让「保存」把它写进 model.json，污染包数据。 */
  if (state.animEdit && state.animEdit.drafts && state.animEdit.drafts[t.animName]) {
    delete state.animEdit.drafts[t.animName];
    state.animEdit.rev = (state.animEdit.rev || 0) + 1;
    try { if (typeof markAnimDirty === "function") markAnimDirty(t.animName); } catch (_) { /* 忽略 */ }
    try { if (typeof renderAnimIdleList === "function") renderAnimIdleList(); } catch (_) { /* 忽略 */ }
  }
  /* 恢复口型测试期间让出的「表情 override」（嘴巴那一项），
     否则测试结束后嘴型会一直停在口型的最后一帧。 */
  if (t.savedOverride && state.expr) {
    state.expr.override = Object.assign({}, t.savedOverride);
    try { if (typeof refreshExprUI === "function") refreshExprUI(); } catch (_) { /* 忽略 */ }
  }
  /* 让台词行上的「停止」标签复位成「口型」：行按钮的状态取自 _lipTest */
  try { if (typeof renderVoice === "function") renderVoice(); } catch (_) { /* 忽略 */ }
  /* 恢复脸部放大前的视图 */
  if (t.savedView && !o.keepView) {
    state.zoom = t.savedView.zoom;
    state.panX = t.savedView.panX;
    state.panY = t.savedView.panY;
    if (typeof syncZoom === "function") syncZoom();
    render();
  }
  /* 恢复测试前的动画 */
  if (t.savedAnim && !o.keep) {
    try { setAnim(t.savedAnim); } catch (_) { /* 忽略 */ }
  }
  if (!o.silent) setStatus("口型测试已停止");
  return { ok: true, stopped: true };
}

/**
 * 一键测试：生成口型 → 写临时动画 → 音画同步播放。
 * @param {{lineId?:string, fps?:number, silenceThreshold?:number, smooth?:boolean}} opts
 */
async function lipTestRun(opts) {
  const o = opts || {};
  lipTestStop({ silent: true });

  const line = lipTestLine(o.lineId);
  if (!line) return { ok: false, reason: "先在台词页选中一条台词" };

  /* 1) 取关键帧：优先用包里 lipsync.json 的 runs（运行时真正用的数据），
     只有这样预览才等于运行时行为；取不到才退回本地包络估算。 */
  const gen = await lipKeysForLine(line, {
    fps: o.fps, silenceThreshold: o.silenceThreshold, smooth: o.smooth,
  });
  const source = gen && gen.source ? gen.source : "local-envelope";
  if (!gen.ok) {
    setStatus("口型测试失败：" + gen.reason, "warn");
    return gen;
  }

  /* 2) 混合：基础动画（表情/待机）+ 口型 → 一条可播放的动画。
     用户要求：说话时嘴巴跟音频动，说完保持表情的嘴型。
     基础动画默认取当前选中的那个（所以「先选开心，再点口型测试」= 开心+口型）。 */
  const TEST_NAME = "__lip_test__";
  const lib = animEditLib();
  if (!lib) return { ok: false, reason: "anim-edit 未加载" };
  /* **基础表情优先取「事件声明的 expression」**（契约 §3.3 ② eventMap 脸部 base、⑤ 结束后恢复它）。
     下拉只有在用户显式指定（o.baseAnim）时才覆盖 —— 否则会像之前那样
     从动画名反推（用了 proud=愉快），而事件声明的其实是 mouth_快乐，两者不一致。 */
  const exprParts = eventExpressionOf(line.id);
  let merged = null;
  let baseName = null;
  if (exprParts && !o.baseAnim) {
    merged = lipSyncMergeFromEvent(exprParts, gen);
    baseName = "事件表情";
  } else {
    baseName = o.baseAnim || (state.anim && state.anim !== TEST_NAME ? state.anim : "idle");
    merged = lipSyncMerge(baseName, gen);
  }
  if (!merged.ok) return { ok: false, reason: merged.reason || "混合失败" };
  const draft = merged.anim;
  const wrote = merged.mouthKeys;

  const savedAnim = state.anim;
  animSetDraft(TEST_NAME, draft);
  setAnim(TEST_NAME);
  syncAnimPanel();

  /* 3) 音画同步播放 */
  const url = audioWaveUrlForLine(line);
  if (!url) {
    setStatus("口型已生成，但找不到音频地址，无法同步播放", "warn");
    return Object.assign({}, gen, { ok: true, played: false, wrote: wrote });
  }
  const audio = new Audio(url);
  audio.preload = "auto";
  /* 放大到脸部：否则嘴巴在整身视图里只有几像素，用户会以为「没动」 */
  const savedView = lipTestFocusFace();
  /* **必须让出嘴巴**：点台词行会触发「表情同步」，把事件表情写进 state.expr.override，
     而 override 优先于动画 —— 嘴巴会被钉在事件的固定嘴型（如 mouth_快乐），
     口型动画就看不见了（实测：t 在推进但嘴型恒为 快乐）。
     override 里值为 null 表示「隐藏该附件」，所以这里要**删键**才是真正释放。 */
  const savedOverride = state.expr && state.expr.override ? Object.assign({}, state.expr.override) : null;
  if (state.expr && state.expr.override && Object.prototype.hasOwnProperty.call(state.expr.override, "嘴巴")) {
    const box = Object.assign({}, state.expr.override);
    delete box["嘴巴"];
    state.expr.override = box;
    try { if (typeof refreshExprUI === "function") refreshExprUI(); } catch (_) { /* 忽略 */ }
    render();
  }
  _lipTest = { animName: TEST_NAME, audio: audio, raf: 0, savedAnim: savedAnim, savedView: savedView, lineId: line.id, savedOverride: savedOverride };
  /* 临时诊断：记录音频生命周期，定位「点了没反应」 */
  state.__lipDebug = { url: String(url).slice(0, 160), events: [], playOk: null, playErr: null };
  for (const ev of ["loadstart", "loadedmetadata", "canplay", "playing", "ended", "error", "stalled"]) {
    audio.addEventListener(ev, () => {
      state.__lipDebug.events.push(ev + "@" + (+audio.currentTime.toFixed(3)) + " dur=" + audio.duration + " err=" + (audio.error ? audio.error.code : "null"));
    });
  }

  /* 用 setInterval 而不是 requestAnimationFrame：rAF 在后台/无头页面会被节流到几乎不跑，
     实测 t 会卡在 0.1s 不动（看起来就是「点了没反应」）。40ms 足够跟手。 */
  const drive = () => {
    if (!_lipTest || _lipTest.audio !== audio) return;
    const audioDur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : gen.duration;
    const totalDur = merged.totalDuration || merged.duration || audioDur;
    let t;
    if (_lipTest.tailFrom != null) {
      /* 尾巴阶段：音频已结束，按真实时间把播放头从音频末尾推到 totalDur */
      const nowMono = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      t = Math.min(totalDur, _lipTest.tailFrom + (nowMono - _lipTest.tailStartMono) / 1000);
      if (t >= totalDur - 1e-4) {
        state.t = totalDur;
        updateTimeLabel();
        render();
        if (typeof fsSyncBar === "function") fsSyncBar();
        lipTestStop({ silent: true });
        setStatus("口型测试播放完毕：" + gen.keys.length + " 个口型关键帧 · " +
          round(gen.duration, 2) + "s（含尾巴渐显渐隐 " + round(totalDur - gen.duration, 2) + "s）");
        return;
      }
    } else {
      t = Math.min(audioDur, audio.currentTime || 0);
    }
    /* 直接改 state.t 并重绘（不走 setPlayhead，避免暂停音频） */
    state.t = t;
    state.playing = true;
    updateTimeLabel();
    render();
    /* 帧视图读数（「帧 N / 总帧」）由 fsSyncBar 维护；不调用它时间轴会一直显示「帧 0 / …」，
       看起来就像动画停了。 */
    if (typeof fsSyncBar === "function") fsSyncBar();
    if (typeof dsSyncPlayhead === "function") dsSyncPlayhead();
  };

  audio.addEventListener("ended", () => {
    if (!_lipTest) return;
    const totalDur = merged.totalDuration || merged.duration || gen.duration;
    if (totalDur > gen.duration + 1e-3) {
      /* 尾巴子动画：不立即停，交给 drive() 推完 */
      const nowMono = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      _lipTest.tailFrom = gen.duration;
      _lipTest.tailStartMono = nowMono;
      setStatus("口型说完，尾巴：气渐显 → 停留 → 渐隐");
      return;
    }
    lipTestStop({ silent: true });
    setStatus("口型测试播放完毕：" + gen.keys.length + " 个口型关键帧 · " + round(gen.duration, 2) + "s");
  });
  audio.addEventListener("error", () => {
    if (!_lipTest) return;
    lipTestStop({ silent: true });
    setStatus("音频加载失败，无法测试", "warn");
  });

  try {
    await audio.play();
    if (state.__lipDebug) state.__lipDebug.playOk = true;
  } catch (e) {
    if (state.__lipDebug) { state.__lipDebug.playOk = false; state.__lipDebug.playErr = String((e && e.message) || e).slice(0, 120); }
    lipTestStop({ silent: true });
    return { ok: false, reason: "音频播放被拒绝（浏览器策略？）：" + String((e && e.message) || e).slice(0, 60) };
  }
  _lipTest.raf = setInterval(drive, 40);

  setStatus("口型测试中：「" + (line.text || line.id).slice(0, 18) + "」" +
    merged.mouthKeys + " 个口型 · " + round(gen.duration, 2) + "s · 基础「" + baseName + "」" +
    (merged.hasEyeLayer ? "（含眼眉）" : "") + " · 说完保持 " + String(merged.mouthTail).replace("mouth_", "") +
    " · 数据源 " + (source === "pack-lipsync" ? "lipsync.json" : "本地包络") +
    " —— 听声音看嘴型");
  return Object.assign({}, gen, { ok: true, played: true, wrote: wrote, testAnim: TEST_NAME });
}

function lipSyncLib() { return window.SpineLipSync || null; }

/** 当前选中台词的 id（沿用语音模块的查找链路） */
function lipSyncLineId() {
  const v = state.voice;
  if (!v || !v.play || !v.play.id) return null;
  return v.play.id;
}

/** 生成目标动画名：talk_<台词id> */
function lipSyncAnimName(lineId) {
  const base = String(lineId || "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 48);
  return "talk_" + (base || "line");
}

/**
 * 核心：把当前台词的音频转成口型关键帧（不写盘）。
 * @returns {Promise<{ok:boolean, keys?:Array, duration?:number, fps?:number, reason?:string, lineId?:string}>}
 */
async function lipSyncFromCurrentLine(opts) {
  const o = opts || {};
  const L = lipSyncLib();
  if (!L) return { ok: false, reason: "lip-sync.js 未加载" };

  const lineId = o.lineId || lipSyncLineId();
  if (!lineId) return { ok: false, reason: "先在台词页选中一条台词" };

  /* 找台词对象 */
  const v = state.voice;
  let line = null;
  for (const ev of v.events || []) {
    for (const ln of ev.lines || []) {
      if (ln && ln.id === lineId) { line = ln; break; }
    }
    if (line) break;
  }
  if (!line) return { ok: false, reason: "找不到台词：" + lineId };

  const url = audioWaveUrlForLine(line);
  if (!url) return { ok: false, reason: "这条台词没有可用的音频地址" };

  /* 解码（复用 audio-wave 的缓存与解码） */
  const wave = await decodeAudioWave(url, 2000);
  if (!wave || !wave.ok) return { ok: false, reason: (wave && wave.reason) || "音频解码失败" };

  const fps = Number.isFinite(o.fps) && o.fps > 0 ? o.fps : tlFps();
  const built = L.build({
    peaks: wave.peaks,
    duration: wave.duration,
    fps: fps,
    silenceThreshold: Number.isFinite(o.silenceThreshold) ? o.silenceThreshold : 0.06,
    smooth: o.smooth !== false,
    maxInsertPerStep: Number.isFinite(o.maxInsertPerStep) ? o.maxInsertPerStep : 3,
  });
  if (!built.ok) return { ok: false, reason: built.issues[0] ? built.issues[0].message : "口型生成失败" };

  return {
    ok: true,
    lineId: lineId,
    animName: lipSyncAnimName(lineId),
    keys: built.keys,
    frames: built.frames,
    inserted: built.inserted,
    duration: wave.duration,
    fps: fps,
    channels: wave.channels,
    summary: L.summaryLine(built),
  };
}

/**
 * 把生成的口型关键帧写成一个新动画（内存草稿，不自动保存）。
 * 只写 slots.<嘴> .attachment 轨道，不动骨骼。
 */
function lipSyncApplyToAnim(result) {
  const lib = animEditLib();
  if (!lib) return { ok: false, reason: "anim-edit 未加载" };
  if (!result || !result.ok || !result.keys || !result.keys.length) {
    return { ok: false, reason: "没有可写入的口型关键帧" };
  }
  const name = result.animName;
  const fps = result.fps || tlFps();
  const MOUTH = "嘴巴";

  /* 以空动画为底：只有 slots.嘴巴.attachment 一条轨道。
     **不用 upsertKey**：它内部的 animDurationOf 只认「已有 Key 的最大时间」，
     空草稿时长恒为 0，任何 time>0 的 Key 都会被 ANIM_KEY_OVER_DURATION 拒绝
     （实测：75 个 Key 只写进 time=0 那一个，倒序写也一样）。
     这个结构很简单，直接构造数组即可；写完再让 animSetDraft 走正常链路。 */
  const keys = result.keys
    .filter((k) => Number.isFinite(k.time) && k.time >= 0 && k.name)
    .map((k) => ({ time: Math.round(k.time * 1e6) / 1e6, name: k.name }))
    .sort((a, b) => a.time - b.time);
  if (!keys.length) return { ok: false, reason: "没有合法的口型关键帧" };

  const draft = {
    slots: {},
    duration: Number.isFinite(result.duration) && result.duration > 0
      ? Math.round(result.duration * 1e6) / 1e6
      : keys[keys.length - 1].time,
  };
  draft.slots[MOUTH] = { attachment: keys };
  const wrote = keys.length;

  const before = snapshot();
  animSetDraft(name, draft);
  commit(before);
  setAnim(name);
  syncAnimPanel();
  renderAnimIdleList();
  setStatus("已生成口型动画「" + animLabel(name) + "」：" + wrote + " 个关键帧 · " + round(result.duration, 2) + "s（内存草稿，未保存）");
  return { ok: true, animName: name, wrote: wrote, duration: result.duration };
}

/** 一键：当前台词 → 生成口型动画（供按钮/句柄调用） */
async function lipSyncGenerate(opts) {
  const r = await lipSyncFromCurrentLine(opts);
  if (!r.ok) { setStatus("口型生成失败：" + r.reason, "warn"); return r; }
  const applied = lipSyncApplyToAnim(r);
  return Object.assign({}, r, { applied: applied });
}

function renderAnimPage() {
  const panel = el0("animPanel");
  if (!panel) return;
  if (!state.animEdit.open) return;

  const idleN = renderAnimIdleList();
  const seqN = renderAnimSeqList();

  /* 空态提示：只有「两个列表都空」时才显示，且文案要准确 */
  const empty = el0("animEmpty");
  if (empty) {
    empty.hidden = idleN + seqN > 0;
    if (idleN + seqN === 0) {
      empty.textContent = "这个包没有可编辑的动画（model.json 里没有 animations，也没有序列帧）。";
    }
  }

  /* 轨道区：容器存在才渲染（当前 HTML 没有这两个容器，所以会被跳过） */
  const warn = el0("animWarn");
  const msgs = [];
  try {
    if (el0("animBones") && el0("animSlots")) renderAnimTracks();
  } catch (e) {
    msgs.push("轨道渲染失败：" + ((e && e.message) || String(e)));
  }
  if (warn) {
    warn.hidden = msgs.length === 0;
    warn.textContent = msgs.join("；");
    warn.classList.toggle("is-error", msgs.length > 0);
  }
}

  function renderAnimPanel() {
    const panel = el0("animPanel");
    if (!panel) return;
    if (!state.animEdit.open) return;
    const ed = state.animEdit;
    const names = state.model ? Array.from(state.model.animations.keys()) : [];
    if (!ed.sel && !ed.selUserCleared && names.length) ed.sel = state.anim || names[0];
    /* **改为调用 renderAnimPage**：它会真正填充 animIdleList / animSeqList。
       原来的 renderAnimTracks 只认 animBones/animSlots（当前 HTML 没有），
       所以列表永远空白 —— 这是事故恢复留下的 DOM 错配。 */
    renderAnimPage();
  }

  function syncAnimPanel() {
    guarded("anim", () => renderAnimPanel());
    guarded("anim", () => syncAnimEditBar());
  }

  /** 保存成功后：草稿落盘，基线对齐到磁盘内容 */
  function animCommitSaved() {
    const ed = state.animEdit;
    const names = Object.keys(ed.drafts);
    if (!names.length) return;
    ed.drafts = Object.create(null);
    ed.durInput = null;
    ed.dirty = false;
    syncAnimPanel();
  }

  function animEditLoaded() {
    const ed = state.animEdit;
    ed.drafts = Object.create(null);
    ed.dirty = false;
    ed.durInput = null;
    ed.expanded = new Set();
    const names = state.model ? Array.from(state.model.animations.keys()) : [];
    ed.sel = names[0] || "";
    animExpandAllTracks(ed.sel);
    if (names.length && !state.anim) setAnim(names[0]);
    /* 包刚加载完，补填口型测试的「基础表情」下拉（初始化时 state.raw 还是空的） */
    /* 载入包内 spine/lipsync.json（口型运行时包络）并在状态栏报出校验结果 */
    if (typeof lipsyncLoad === "function") {
      lipsyncLoad().then((r) => {
        const el = el0("voiceLipInfo");
        if (r.ok) {
          const issues = lipsyncValidate(r.data);
          if (el) {
            el.textContent = "口型 " + r.data.lines.length + " 条 · " + (issues.length ? issues.length + " 项不合规" : "校验通过");
            el.title = "lipsync.json：" + r.path + (issues.length ? "\n" + issues.map((i) => i.code + ": " + i.message).join("\n") : "\n契约校验通过");
            el.hidden = false;
          }
        } else if (el) {
          el.textContent = "无 lipsync.json";
          el.title = r.reason || "";
          el.hidden = false;
        }
      }).catch(() => { /* 忽略：没有口型数据不影响其它功能 */ });
    }
    syncAnimPanel();
  }

  /** 默认展开一个动画的全部骨/槽轨道（key 列表按「属性 / 附件」分组折叠，避免一次渲染几百行） */
  function animExpandAllTracks(name) {
    const ed = state.animEdit;
    const lib = animEditLib();
    const draft = name ? animDraft(name) : null;
    if (!lib || !draft) return;
    const scan = lib.scanTracks(draft);
    for (const b of scan.bones) ed.expanded.add(animTrackKey("bones", b.name));
    for (const s of scan.slots) ed.expanded.add(animTrackKey("slots", s.name));
  }

  /**
   * 动画列表点击（0.9.107）。
   *
   * 用户要求：「每个动画选中了应该有明显的视觉样式，再次点击应该能够取消选择」，且**互斥**。
   *
   * 规则：
   *   · 点 A → 选中 A（清掉其它行的选中样式，互斥）
   *   · 再点 A → **取消选择**（state.anim 清空、动画列表无高亮、播放按钮回到「先选一个动画」）
   *   · 点 B → 直接从 A 切到 B
   */
  function setAnimEditSelection(name) {
    const ed = state.animEdit;
    if (!name) return;
    /* 再次点击同一个 → 取消选择 */
    if (ed.sel === name && state.anim === name) {
      gazeReset();
      ed.sel = null;
      ed.selUserCleared = true;   /* 显式标记：用户主动取消，renderAnimPanel 不要再兜底成第一个动画 */
      ed.durInput = null;
      setAnim("");
      syncAnimPanel();
      renderAnimIdleList();
      renderAnimSeqList();
      setStatus("已取消动画选择");
      return;
    }
    /* 0.9.85：换动画选择后眼珠复位（用户明确要求）。虚拟条目本身不复位，它靠播放激活。 */
    if (!isGazeAnim(name)) gazeReset();
    ed.sel = name;
    ed.selUserCleared = false;
    ed.durInput = null;
    animExpandAllTracks(name);
    setAnim(name);
    syncAnimPanel();
    /* **高亮刷新**：setAnim 内部只同步了 animSel 下拉框（该元素已不存在），
       不会重画动画列表，所以 is-selected 会停在旧项上（实测：点「打招呼」后
       高亮仍停在「待机」）。这里显式再渲染一次列表。 */
    renderAnimIdleList();
    renderAnimSeqList();
  }

  /**
   * 整体重定时（契约 §7 / AC-15）：**先算后确认**，确认前绝不改任何 draft。
   *   1) 点击时只读计算：oldD = 当前文档时长、newD = 输入值、比例、受影响 key 数、precheck 结论；
   *   2) precheck 失败 → 直接拒绝、无确认、零改动，列出 unknownPaths；
   *   3) 确认 → 一次事务（snapshot before → retimeAll → commit 一条 undo）；
   *   4) 取消 → 零改动（draft/animation/undo/dirty 全不变）。
   */
  function confirmRetime(name, newD) {
    const lib = animEditLib();
    const cur = animDraft(name);
    if (!lib || !cur) return false;
    const oldD = animDuration(name);
    const v = Number(newD);
    if (!Number.isFinite(v) || v <= 0) {
      setStatus("整体重定时：新时长必须是正数", "warn");
      return false;
    }
    if (!(oldD > 0)) {
      setStatus("整体重定时：当前动画时长为 0，无法按比例重定时（请先添加 Key）", "warn");
      return false;
    }
    if (Math.abs(v - oldD) < 1e-9) {
      setStatus("整体重定时：新时长与当前一致（" + round(oldD, 4) + "s），未做任何修改");
      return false;
    }
    let pre = null;
    if (typeof lib.retimeAllPrecheck === "function") {
      pre = lib.retimeAllPrecheck(cur);
      if (!pre.ok) {
        const paths = (pre.issues || []).map((i) => i.path).slice(0, 6).join("、");
        setStatus("ANIM_RETIME_UNSUPPORTED_TRACK：整体重定时被拒绝" + (paths ? "（" + paths + "）" : ""), "warn");
        notice(
          "warn",
          "整体重定时被拒绝：该动画含无法保证一致缩放的带 time 数据" + (paths ? "：" + paths : "") +
            "。若只想改播放区间，请用「预览起止」（不写 JSON）。"
        );
        return false;
      }
    }
    const keyCount = pre && pre.value && Number.isFinite(pre.value.keyCount) ? pre.value.keyCount : null;
    const ratio = v / oldD;
    const doRetime = () => {
      const before = snapshot();
      const ok = animApplyScale(name, v);
      if (!ok) {
        /* 应用失败要回到点击前的文档（不留下半套改动） */
        applySnapshot(before);
        refreshDirty();
        syncFooter();
        syncAnimPanel();
        dsSyncBars();
        dsDraw();
        return false;
      }
      commit(before);
      state.edit.timeline.selectedKey = null;
      syncAnimPanel();
      syncEditToolbar();
      syncInspector();
      syncFooter();
      dsSyncBars();
      dsDraw();
      render();
      setStatus(
        "已整体重定时「" + name + "」：" + round(oldD, 4) + "s → " + round(v, 4) + "s（×" + round(ratio, 6) +
          (keyCount != null ? "，" + keyCount + " 个 Key" : "") + "）· 可 Ctrl+Z 撤销"
      );
      return true;
    };
    const text =
      "整体重定时「" + name + "」：" + round(oldD, 4) + "s → " + round(v, 4) + "s（×" + round(ratio, 6) + "）" +
      (keyCount != null ? "，影响 " + keyCount + " 个 Key" : "") +
      "。这会改写该动画全部 Key 的时间与贝塞尔时间控制点；若只想改播放区间，用「预览起止」不写 JSON。";
    notice("warn", text, [
      { label: "确认整体重定时", onClick: () => { removeNoticeByKey(pendingNoticeKey); pendingNoticeKey = null; doRetime(); } },
      { label: "取消", onClick: () => { removeNoticeByKey(pendingNoticeKey); pendingNoticeKey = null; setStatus("已取消整体重定时：文档未做任何修改"); } },
    ]);
    pendingNoticeKey = "warn|" + text;
    setStatus("等待确认：整体重定时会改写全部 Key 时间（尚未修改任何数据）");
    return true;
  }

  function animSetDurationInput(v) {
    const ed = state.animEdit;
    const n = parseFloat(v);
    if (!Number.isFinite(n) || n <= 0) {
      syncAnimEditDurInput(true);
      setStatus("时长必须是正数", "warn");
      return;
    }
    /* 只记录输入，不应用：整体重定时是破坏性事务，必须显式确认（契约 §7）。
       「实时预览」开关不再让时长输入自动落盘。 */
    ed.durInput = n;
    syncAnimEditBar();
    setStatus("已记录目标时长 " + round(n, 4) + "s（尚未应用；点「整体重定时全部 Key」确认后才会改写）");
  }

  /** 分页渲染统一兜底：渲染失败不能让侧栏变空白 */
  function guarded(label, fn) {
    try {
      return fn();
    } catch (e) {
      const panel =
        label === "expr" ? el0("exprPanel") : label === "anim" ? el0("animPanel") : null;
      if (panel) {
        const note = document.createElement("p");
        note.className = "expr-warn is-error";
        note.textContent = "面板渲染失败：" + ((e && e.message) || String(e));
        panel.appendChild(note);
      }
      setStatus("面板渲染失败（" + label + "）：" + ((e && e.message) || String(e)), "error");
      return null;
    }
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
    syncExprPanel();
    syncAnimPanel();
    syncEditToolbar();
    syncDisplayToggles();
    updateCursor();
  }
  /** 表情 / 动画分页的轻量同步（不重渲染整块列表时用） */
  function syncExprPanel() {
    if (!el0("exprPanel")) return;
    guarded("expr", () => refreshExprUI());
  }
  function syncToolbar() {
    const loaded = !!state.model;
    /* 0.9.16：顶部「适配 / 缩放」组已移除，这三个按钮可能不存在 → 空值保护。
       等价操作在左侧工具条（放大 / 缩小 / 适应窗口）与快捷键（+ / − / F）。 */
    const fitBtn = el0("btnFit");
    if (fitBtn) fitBtn.disabled = !loaded;
    const zoomInBtn = el0("btnZoomIn");
    if (zoomInBtn) zoomInBtn.disabled = !loaded;
    const zoomOutBtn = el0("btnZoomOut");
    if (zoomOutBtn) zoomOutBtn.disabled = !loaded;
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
    const box = el0("list");
    box.textContent = "";
    el0("slotCount").textContent = String(state.slots.length);
    el0("listEmpty").hidden = state.slots.length > 0;
    const q = state.search.trim().toLowerCase();
    const tree = state.listView === "tree";
    /* 分组：parts 页自己拉 rig-meta（不要求先开表情页）；无 meta/无 slotGroups 时平铺 */
    if (!tree) {
      maybeLoadRigMeta();
    maybeLoadCatalog();
      refreshSlotGroups();
    }
    const grouped = !tree && slotGroups().length > 0;
    box.setAttribute("role", tree ? "tree" : grouped ? "list" : "listbox");
    box.setAttribute("aria-label", tree ? "部件列表（骨骼层级）" : grouped ? "部件列表（图层组，上方在前）" : "部件列表，上方在前");
    box.classList.toggle("is-order", !tree);
    box.classList.toggle("is-grouped", grouped);
    el0("listEmpty").textContent = tree
      ? "按骨骼父子层级排列：点箭头折叠/展开，左侧数字是显示顺序。"
      : grouped
        ? "按图层组显示，上方在最前：点组头折叠/展开，组眼睛可整组显隐；只能在本组内拖动调整顺序。"
        : "按显示顺序排列，上方在最前；拖拽行可调整显示顺序（也可用上移/下移）。";
    syncListView();
    const shown = tree ? renderPartsTree(box, q) : renderPartsOrder(box, q);
    const sc = el0("searchCount");
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
    row.addEventListener("click", () => {
      /* 骨骼目标下：列表行点击同时把 selBone 设为该行的绑定骨（契约 §2 判定） */
      if (editTarget() !== "bone") return;
      const slot = state.slots[i];
      if (slot && boneEntry(slot.boneName)) selectBone(slot.boneName);
    });
    if (!tree) attachOrderDrag(row, i);
    box.appendChild(row);
    return row;
  }
  /** 显示顺序视图：拖拽行调整 z 序（仅 order 视图、且当前动画无 drawOrder 轨道）
   *  分组视图下只允许**同组内**换位：跨组 / 拖到列表首尾都在 mutation 前拒绝并提示。 */
  function attachOrderDrag(row, index) {
    row.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".slot-eye")) return;
      if (state.listView !== "order" || drawOrderLocked()) return;
      const startY = e.clientY;
      const lib = slotGroupLib();
      const groups = slotGroups();
      const grouped = !!(lib && groups.length);
      const fromGroup = grouped ? lib.groupOfIndex(groups, index) : null;
      const dragKey = state.slotGroup.metaKey;
      let dragging = false;
      let over = null;
      let after = false;
      let rejected = false;
      const clearOver = () => {
        if (over) over.classList.remove("drop-before", "drop-after", "drop-forbid");
        over = null;
      };
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
        const cand = hit && hit !== row ? hit : null;
        if (over && over !== cand) clearOver();
        if (cand) {
          const candIndex = Number(cand.dataset.index);
          const sameGroup = !grouped || (fromGroup && lib.groupOfIndex(groups, candIndex) === fromGroup);
          over = cand;
          const r = cand.getBoundingClientRect();
          after = ev.clientY > r.top + r.height / 2;
          cand.classList.remove("drop-before", "drop-after", "drop-forbid");
          cand.classList.add(sameGroup ? (after ? "drop-after" : "drop-before") : "drop-forbid");
          rejected = !sameGroup;
        } else {
          rejected = false;
        }
      };
      const end = (ev) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        const finish = (ok, msg) => {
          if (over) over.classList.remove("drop-before", "drop-after", "drop-forbid");
          row.classList.remove("is-dragging");
          document.body.classList.remove("is-reordering");
          if (msg) setStatus(msg, ok ? undefined : "warn");
        };
        if (!dragging) {
          finish(true, "");
          return;
        }
        state.suppressClick = true;
        setTimeout(() => {
          state.suppressClick = false;
        }, 0);
        /* pointercancel：零重排（手势被系统/浏览器取消，下标与落点都不可信） */
        if (ev && ev.type === "pointercancel") {
          finish(false, "拖动被取消，显示顺序未改变");
          return;
        }
        /* 拖拽期间模型 / rig-meta 代次变了 → 下标已失效，直接放弃这次拖动 */
        if (state.slotGroup.metaKey !== dragKey || index >= state.slots.length) {
          finish(false, "拖动期间模型或分组信息已变化，本次调整已取消");
          return;
        }
        if (rejected) {
          /* 落点非法：跨组或组头（在 mutation 之前拒绝） */
          finish(false, "分组视图下只能在组内调整显示顺序");
          return;
        }
        if (!over) {
          const box = el0("list").getBoundingClientRect();
          const outside = ev.clientY > box.bottom - 4 || ev.clientY < box.top + 4;
          if (grouped && outside) {
            finish(false, "分组视图下只能在组内调整显示顺序（不能拖到列表首/尾）");
            return;
          }
          if (ev.clientY > box.bottom - 4) {
            if (!reorderSlotDisplay(index, "bottom")) finish(true, "显示顺序未变化");
          } else if (ev.clientY < box.top + 4) {
            if (!reorderSlotDisplay(index, "top")) finish(true, "显示顺序未变化");
          } else finish(true, "");
          return;
        }
        const toIndex = Number(over.dataset.index);
        if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= state.slots.length) {
          finish(false, "落点部件已不存在，本次调整已取消");
          return;
        }
        if (grouped) {
          const check = lib.canDropInGroup(groups, index, toIndex, after);
          if (!check.ok) {
            finish(false, check.message);
            return;
          }
        }
        if (!reorderSlotDisplay(index, toIndex, after)) finish(true, "显示顺序未变化");
      };
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    });
  }
  /** 把 state.slots 的新顺序同步进 model.slots / slotIndex / skin.attachments / animations.slots，保证预览与拾取同步
   *  关键：Spine 动画的 `slots` Map 以**旧 slotIndex** 为键，必须按槽名重映射，
   *  否则组内拖动后 blink 会作用到错槽 / 找不到附件。 */
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
    remapAnimationSlotTracks(model, oldToNew);
    state.slots.forEach((s, i) => {
      s.index = i;
    });
  }

  /** 解析态的 bar: animations[].slots（Map<旧下标, tracks>）→ Map<新下标, tracks> */
  function remapAnimationSlotTracks(model, oldToNew) {
    const map = model && model.animations;
    if (!map || typeof map.forEach !== "function" || !oldToNew || !oldToNew.size) return 0;
    let changed = 0;
    map.forEach((anim) => {
      if (!anim || !anim.slots || typeof anim.slots.forEach !== "function" || !anim.slots.size) return;
      const oldEntries = Array.from(anim.slots.entries());
      const next = new Map();
      for (const [oldIdx, tracks] of oldEntries) {
        const ni = oldToNew.get(oldIdx);
        if (ni === undefined) continue;
        next.set(ni, tracks);
        changed++;
      }
      anim.slots = next;
    });
    return changed;
  }
  /** 分组视图下的移动预检：只允许同组内换位；拒绝时返回提示，调用方零副作用返回 */
  function slotMoveGuard(from, to, after) {
    const lib = slotGroupLib();
    const groups = slotGroups();
    if (!lib || !groups.length) return { ok: true, guarded: false, message: "" };
    if (to === "top" || to === "bottom" || to === null || to === undefined) {
      return { ok: false, guarded: true, message: "分组视图下只能在组内调整显示顺序（不能移到列表首/尾）" };
    }
    const check = lib.canDropInGroup(groups, from, to, after);
    return { ok: check.ok, guarded: true, message: check.message || "分组视图下只能在组内调整显示顺序" };
  }

  /** 拖拽/按钮共用的落点：from/to 都是 state.slots 下标；"top"/"bottom" 表示列表首/尾。
   *  分组视图下入口统一 guard（只允许同组内），非法一律 setStatus 拒绝且零副作用。
   *  @returns {boolean} true = 顺序发生了变化并已提交；false = 未变化或被拒绝 */
  function reorderSlotDisplay(from, to, after) {
    const n = state.slots.length;
    if (n < 2) return false;
    if (!Number.isInteger(from) || from < 0 || from >= n) return false;
    const guard = slotMoveGuard(from, to, after);
    if (!guard.ok) {
      setStatus(guard.message, "warn");
      return false;
    }
    const disp = [];
    for (let i = n - 1; i >= 0; i--) disp.push(i);
    const fromPos = disp.indexOf(from);
    if (fromPos < 0) return false;
    const moved = state.slots[from];
    const movedAt = disp.splice(fromPos, 1)[0];
    let pos;
    if (to === "top") pos = 0;
    else if (to === "bottom") pos = disp.length;
    else {
      if (!Number.isInteger(to) || to < 0 || to >= n) {
        disp.splice(fromPos, 0, movedAt);
        return false;
      }
      pos = disp.indexOf(to);
      if (pos < 0) pos = disp.length;
      if (after) pos += 1;
      if (pos === fromPos) {
        disp.splice(fromPos, 0, movedAt);
        return false;
      }
    }
    disp.splice(pos, 0, movedAt);
    const before = snapshot();
    state.slots = disp.slice().reverse().map((i) => state.slots[i]);
    syncSlotOrderToModel();
    state.sel = state.slots.findIndex((s) => s.name === moved.name);
    commit(before);
    /* 组是「连续 z 区间」：顺序变了要按当前 state.slots 重新规范化分组（成员白名单不变） */
    renormSlotGroups();
    framePose();
    syncAll();
    render();
    setStatus("已调整显示顺序：" + (state.slots[state.sel] ? state.slots[state.sel].name : ""));
    return true;
  }

  function renderPartsOrder(box, q) {
    const lib = slotGroupLib();
    const groups = slotGroups();
    if (lib && groups.length) return renderPartsOrderGrouped(box, q, lib, groups);
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

  /** 组头：折叠按钮（箭头 + 组名 + 槽数/命中 + z 范围）+ 三态眼睛（眼睛是兄弟节点，避免 button 嵌套） */
  function appendSlotGroupHeader(box, entry, shownIndices) {
    const group = entry.group;
    const vis = slotGroupVis(group);
    /* 搜索时临时强制展开（不清除折叠偏好）；清空搜索后恢复原折叠状态 */
    const prefCollapsed = slotGroupCollapsed(entry.gid);
    const collapsed = prefCollapsed && !entry.searching;
    const wrap = el("div", "slot-group");
    wrap.dataset.gid = entry.gid;
    if (entry.searching) wrap.classList.add("is-search");
    const wrapHd = el("div", "slot-group-hdwrap");
    const hd = document.createElement("button");
    hd.type = "button";
    hd.className = "slot-group-hd";
    hd.dataset.gid = entry.gid;
    hd.setAttribute("aria-expanded", collapsed ? "false" : "true");
    hd.title = entry.searching
      ? "搜索中已自动展开「" + group.name + "」（" + group.zLabel + "）；清空搜索恢复原来的折叠状态"
      : (collapsed ? "展开" : "折叠") + "分组「" + group.name + "」（" + group.zLabel + "）";
    hd.appendChild(iconEl(collapsed ? "chevron-right" : "chevron-down", "caret"));
    hd.appendChild(el("span", "slot-group-name", group.name));
    const countText = entry.searching ? entry.hits + "/" + entry.total : String(entry.total);
    hd.appendChild(el("span", "slot-group-count", countText));
    hd.appendChild(el("span", "slot-group-z mono", group.zLabel));
    const spacer = el("span", "spacer");
    hd.appendChild(spacer);
    if (group.partial) {
      const warn = el("span", "slot-group-warn", "z 不连续");
      warn.title = "该组的槽在 model.slots 里不是连续区间（rig-meta 与模型代次可能不一致）";
      hd.appendChild(warn);
    }
    hd.addEventListener("click", () => toggleSlotGroupCollapsed(entry.gid));
    hd.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleSlotGroupCollapsed(entry.gid);
      }
    });
    wrapHd.appendChild(hd);
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "slot-eye slot-group-eye";
    eye.dataset.gid = entry.gid;
    eye.dataset.state = vis.state;
    eye.innerHTML = icon(vis.state === "all" ? "eye" : "eye-off");
    eye.title =
      vis.state === "all"
        ? "整组全部可见 " + vis.visible + "/" + vis.total + "：点一下隐藏整组"
        : vis.state === "none"
          ? "整组已隐藏 " + vis.hidden + "/" + vis.total + "：点一下显示整组"
          : "部分隐藏 " + vis.hidden + "/" + vis.total + "：点一下显示整组";
    eye.setAttribute("aria-label", eye.title + "（分组：" + group.name + "）");
    eye.setAttribute("aria-pressed", vis.state === "all" ? "true" : "false");
    eye.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSlotGroupHidden(entry.gid);
    });
    wrapHd.appendChild(eye);
    wrap.appendChild(wrapHd);
    if (!collapsed) {
      const body = document.createElement("div");
      body.className = "slot-group-body";
      const ordered = slotIndicesDesc(shownIndices);
      for (const i of ordered) appendSlotRow(body, i, 0);
      wrap.appendChild(body);
    }
    box.appendChild(wrap);
  }

  function renderPartsOrderGrouped(box, q, lib, groups) {
    const entries = lib.filterGroups(groups, q, (name, index) => slotHayFor(index));
    let shown = 0;
    for (const entry of entries) {
      appendSlotGroupHeader(box, entry, entry.slotIndices);
      shown += entry.slotIndices.length;
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
    const t = el0("tabListTree"), o = el0("tabListOrder");
    if (t) t.setAttribute("aria-selected", tree ? "true" : "false");
    if (o) o.setAttribute("aria-selected", tree ? "false" : "true");
  }

  /** 槽位索引解析：接受 index / 槽名 / 当前选中（null）—— 0.9.50 新增接口共用 */
  function slotIndexOf(indexOrName) {
    if (indexOrName == null) return state.sel;
    if (typeof indexOrName === "number") {
      return indexOrName >= 0 && indexOrName < state.slots.length ? indexOrName : -1;
    }
    if (typeof indexOrName === "string") return state.slots.findIndex((x) => x.name === indexOrName);
    return -1;
  }

  function selectSlot(i) {
    state.sel = i;
    state.hover = -1;
    syncList();
    syncInspector();
    render();
    if (i >= 0) {
      const row = el0("list").querySelector('.slot-row[data-index="' + i + '"]');
      if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
    }
  }
  /* 0.9.50：右栏检查器整块删除，本函数不再有任何可写目标（#boneBody 及其全部子元素已不存在）。
     保留函数名是因为它在 syncInspector() 里被调用；函数体置空后不触碰任何已删 DOM。
     骨骼读写走 setBoneField / boneField。 */
  function syncBoneInspector() {
    return;
  }

  /* 0.9.50：#selBody / #selEmpty / #selBadge 等全部随检查器删除，本函数无可写目标。
     保留函数名（有 40+ 处调用点）。槽位状态快照走 slotSelection() / slotField()。 */
  function syncInspector() {
    return;
  }

  function syncLayers() {
    $$(".layers input[data-layer]").forEach((cb) => {
      cb.checked = !!state.show[cb.dataset.layer];
    });
    /* 0.9.14：吸附 / 权重配色已从顶部工具条移入隐藏容器；控件可能不在，全部做空值保护。 */
    const snapChk = el0("snapChk");
    if (snapChk) snapChk.checked = state.snap;
    const snapState = el0("snapState");
    if (snapState) snapState.textContent = state.snap ? "1 单位" : "关闭";
    el0("texAlpha").value = state.texAlpha;
    el0("texAlphaV").textContent = Math.round(state.texAlpha) + "%";
    const wm = el0("weightMode");
    if (wm) wm.value = state.weightMode;
    const weightWrap = el0("weightModeWrap");
    if (weightWrap) weightWrap.hidden = !state.show.weights;
    syncMenus();
  }
  /* 0.9.50：#debug 整块删除（骨骼/IK 图例、网格、权重、未求值明细、表情滑杆）。
     原本的字符串拼接输出改由 __characterEditor.diagnostics() 以结构化形式提供。 */
  function syncDebug() {
    return;
  }

  function syncFooter() {
    const animDirty = state.animEdit && animHasDraft();
    const dirty = !!state.dirty || !!animDirty;
    el0("footDirty").textContent = dirty
      ? (state.dirty && animDirty ? "有未保存改动（摆位 + 动画）" : animDirty ? "有未保存改动（动画 " + animDirtyCount() + " 段）" : "有未保存改动")
      : "无未保存改动";
    el0("footDirty").className = dirty ? "dirty-on" : "";
    const diag = el0("footDiag");
    diag.hidden = state.unsupportedCount === 0;
    diag.textContent = "未求值 " + state.unsupportedCount;
    el0("rendererInfo").textContent = !state.model ? "渲染：—" : coreInfo.ready ? "渲染：SpineCore" : "渲染：—";
    el0("rendererInfo").title = coreInfo.reason || "";
  }
  function updateCursor() {
    let cursor = "default";
    /* 拖动视野时 grabbing；停在拖拽模式（或按着 Space）时 grab —— 一眼就能看出"现在拖的是视野不是部件" */
    if (state.drag && state.drag.mode === "pan") cursor = "grabbing";
    else if (state.spaceDown || state.tool === "pan") cursor = "grab";
    else if (state.hover >= 0) cursor = dragBlockReason(state.hover) ? "not-allowed" : "move";
    cv.style.cursor = cursor;
  }
  /**
   * 工具切换。0.9.52：拖拽（pan）改成**开关** —— 用户要求「点在拖拽模式里能拖动画布，
   * 不在就拖不动，所以应该能再点一次退出」。
   *
   * 退出时要还原到**进入之前**那个工具，而不是固定回「移动」：
   * 用户可能正停在「选择」（只想点选），按 H 进去拖一下视野再按 H 出来，
   * 直接落到「移动」会把他的选择意图冲掉。
   * state.toolBeforePan 只记 move / select 两种（其余编辑工具在 state.edit.tool 里，不受影响）。
   */
  function setTool(tool, opts) {
    const o = opts || {};
    /* 再次点同一个 pan = 退出 */
    if (tool === "pan" && state.tool === "pan" && !o.force) {
      const back = state.toolBeforePan === "select" ? "select" : "move";
      state.toolBeforePan = null;
      state.tool = back;
      state.edit.tool = "translate";
      syncToolbar();
      syncEditToolbar();
      updateCursor();
      setStatus("已退出拖拽模式（回到「" + (back === "select" ? "选择" : "移动") + "」）：画布左键现在会命中部件");
      render();
      return back;
    }
    if (tool === "pan" && state.tool !== "pan") {
      state.toolBeforePan = state.tool === "select" ? "select" : "move";
    }
    state.tool = tool;
    syncToolbar();
    updateCursor();
    setStatus(tool === "pan" ? "拖拽工具：按住画布拖动只移动视野，不改部件数据（V 回到移动工具）" : "移动工具：拖动部件改变摆位");
  }
  function setDebugOpen(open) {
    el0("debug").classList.toggle("open", !!open);
    el0("debugBody").hidden = !open;
    el0("debugToggle").setAttribute("aria-expanded", open ? "true" : "false");
  }
  function openDebug() {
    setDebugOpen(true);
    el0("debug").scrollIntoView({ block: "nearest" });
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

  /* ---- 12.1 骨骼编辑手势（T6）：gizmo 拖动 / 选骨 ---- */
  /**
   * 骨的「父级到局部」有效仿射：P = world · L⁻¹。
   * 【P1 警告｜契约 §4】这只在 L 可逆且 W 精确时反推出父级矩阵，**不能**当作平移 Jacobian：
   *   平移必须用真实父级世界矩阵 P（realParentWorldOf）。此函数仅保留给
   *   "只有 W 与 L 可用的旧调用点"，新代码一律用 realParentWorldOf。
   */
  function effectiveParentOf(index, local) {
    const lib = boneEditLib();
    const w = boneWorldOf(index);
    if (!lib || !w) return null;
    const invLocal = lib.invert(lib.linearFrom(local.rotation, local.scaleX, local.scaleY));
    if (!invLocal) return null;
    invLocal.tx = -(invLocal.a * (local.x || 0) + invLocal.c * (local.y || 0));
    invLocal.ty = -(invLocal.b * (local.x || 0) + invLocal.d * (local.y || 0));
    return lib.mul(w, invLocal);
  }

  /** 真实父级世界矩阵 P（根 = 单位阵）——平移/World 换算的 Jacobian，契约 §5「逆A」 */
  function realParentWorldOf(entry) {
    const lib = boneEditLib();
    if (!lib) return null;
    if (!entry) return lib.identity();
    let pIndex = entry.parentIndex;
    if (!Number.isFinite(pIndex)) {
      const bone = state.model && state.model.bones ? state.model.bones[entry.index] : null;
      pIndex = bone && Number.isFinite(bone.parentIndex) ? bone.parentIndex : -1;
    }
    if (!(pIndex >= 0)) return lib.identity();
    return boneWorldOf(pIndex) || null;
  }

  /**
   * 骨的 inherit（编辑数学口径，契约 §5）：'normal' | 'onlyTranslation' |
   * 其它未支持值（原样回传 → bone-edit.inheritBasis().supported=false → 显式拒绝）。
   */
  function inheritOfBone(name) {
    const entry = boneEntry(name);
    if (!entry || !state.model) return "normal";
    const caps = state.model.capabilities;
    if (caps && Array.isArray(caps.unsupportedInherit) && caps.unsupportedInherit.indexOf(entry.name) >= 0) {
      return "unsupported";
    }
    const bone = state.model.bones ? state.model.bones[entry.index] : null;
    const raw = bone && typeof bone.inherit === "string" ? bone.inherit : "normal";
    return raw === "onlyTranslation" ? "onlyTranslation" : raw === "normal" ? "normal" : raw;
  }

  /** 拖动目标的当前局部值：Setup 读 boneList，Animate 读 transient（没有就取预览 local） */
  function localOfBone(name) {
    if (editMode() === "animate") {
      const tr = state.edit && state.edit.transient;
      if (tr && tr.bones && tr.bones[name]) {
        const base = state.bones[name] || {};
        return {
          x: tr.bones[name].x === undefined ? base.x || 0 : tr.bones[name].x,
          y: tr.bones[name].y === undefined ? base.y || 0 : tr.bones[name].y,
          rotation: tr.bones[name].rotation === undefined ? base.rotation || 0 : tr.bones[name].rotation,
          scaleX: tr.bones[name].scaleX === undefined ? (base.scaleX == null ? 1 : base.scaleX) : tr.bones[name].scaleX,
          scaleY: tr.bones[name].scaleY === undefined ? (base.scaleY == null ? 1 : base.scaleY) : tr.bones[name].scaleY,
          /* 契约 §4-3：localOfBone 必须把求值后的 shear 一并带出（轴基/aim 需要） */
          shearX: tr.bones[name].shearX === undefined ? base.shearX || 0 : tr.bones[name].shearX,
          shearY: tr.bones[name].shearY === undefined ? base.shearY || 0 : tr.bones[name].shearY,
        };
      }
      const entry = boneEntry(name);
      const frame = state.frame;
      const loc = entry && frame && frame.pose && frame.pose.local ? frame.pose.local[entry.index] : null;
      if (loc) {
        return {
          x: loc.x, y: loc.y, rotation: loc.rotation, scaleX: loc.scaleX, scaleY: loc.scaleY,
          shearX: loc.shearX || 0, shearY: loc.shearY || 0,
        };
      }
    }
    const b = boneEntry(name) || {};
    return {
      x: b.x || 0,
      y: b.y || 0,
      rotation: b.rotation || 0,
      scaleX: b.scaleX == null ? 1 : b.scaleX,
      scaleY: b.scaleY == null ? 1 : b.scaleY,
      shearX: b.shearX || 0,
      shearY: b.shearY || 0,
    };
  }

  /** 写回拖动目标：Setup 写 boneList（有效 Setup）；Animate 写 transient（未打键） */
  function writeLocalBone(name, vals) {
    if (editMode() === "animate") {
      const ed = state.edit;
      if (!ed.transient || ed.transient.animation !== state.anim || ed.transient.time !== state.t) {
        ed.transient = { animation: state.anim, time: state.t, bones: Object.create(null), fields: Object.create(null) };
      }
      const tr = ed.transient;
      const cur = tr.bones[name] || (tr.bones[name] = {});
      const fields = tr.fields[name] || (tr.fields[name] = []);
      for (const k of Object.keys(vals)) {
        if (!Number.isFinite(vals[k])) continue;
        cur[k] = vals[k];
        const tag = k === "x" || k === "y" ? "translate" : k === "rotation" ? "rotate" : "scale";
        if (fields.indexOf(tag) < 0) fields.push(tag);
      }
      return;
    }
    const b = state.bones[name];
    if (!b) return;
    for (const k of Object.keys(vals)) {
      if (!Number.isFinite(vals[k])) continue;
      b[k] = vals[k];
    }
  }

  /** 手动打键（K / 检查器按钮）：对选中骨当前被改过的属性写 Key */
  function keySelectedBone(fields) {
    const name = state.edit.selBone;
    if (!name) return setStatus("先选中一根骨骼再打键", "warn");
    if (editMode() !== "animate") return setStatus("打键需要先切到「动画」模式", "warn");
    if (!state.anim) return setStatus("当前没有选中的动画，无法打键", "warn");
    if (state.playing) return setStatus("播放中：先暂停再打键", "warn");
    const tr = state.edit.transient;
    let want = Array.isArray(fields) && fields.length ? fields.slice() : [];
    if (!want.length) {
      want = (tr && tr.animation === state.anim && tr.time === state.t && tr.fields && tr.fields[name]) || [];
    }
    if (!want.length) want = ["rotate", "translate", "scale"];
    const before = snapshot();
    let wrote = 0;
    for (const f of want) {
      if (animAddBoneKey(state.anim, name, f)) wrote++;
    }
    if (!wrote) return false;
    if (tr && tr.bones) delete tr.bones[name];
    if (tr && tr.fields) delete tr.fields[name];
    commit(before);
    syncEditToolbar();
    setStatus("已写入 " + name + " 的 " + want.join("/") + " Key @ " + round(state.t, 3) + "s");
    return true;
  }

  /** 附件拖动：只改附件自身 x/y（骨局部），骨/子骨 local & world 全不变 */
  function updateAttachmentGesture(screenPoint) {
    const lib = boneEditLib();
    const d = state.drag;
    if (!lib || !d) return;
    const world = unproj(screenPoint.x, screenPoint.y);
    const res = lib.attachmentDelta({
      attachment: d.base,
      boneWorld: d.boneWorld,
      startWorld: d.startWorld,
      world: world,
      axis: null,
      snapUnit: d.snapUnit,
    });
    if (!res.ok) {
      setStatus(res.reasonText || res.reason || "附件坐标换算失败", "warn");
      return;
    }
    d.moved = true;
    setAttachmentFields(d.identity, { x: res.x, y: res.y });
    updateBoneDragBadge(screenPoint, res.x - d.base.x, res.y - d.base.y, "");
    syncInspector();
    render();
  }
  /* 0.9.50：#attBody 及其输入框已删除。附件变换仍走 setAttachmentFields（画布手势 / 接口）。 */
  function syncAttachmentInspector() {
    return;
  }


  /**
   * 选中骨的操作轴（契约 §4.2/§4.4）：返回屏幕角，柄必须指向**正方向**，
   *   · 平移 + Parent：父级世界矩阵的两列 P·(1,0) / P·(0,1)
   *   · 平移 + World：世界 X / Y
   *   · 缩放：B0 = P·L0 的两列（骨本地缩放轴）
   * 这样画出来的柄方向与 translateFromDrag/scaleFromDrag 实际约束的轴一致，
   * 父级旋转 90° 时不会把 +X 柄画到 −X 一侧。
   */
  function boneGizmoAxes(name, screenInfo) {
    const lib = boneEditLib();
    const entry = boneEntry(name);
    if (!lib || !entry) return { axisXAngleRad: 0, axisYAngleRad: Math.PI / 2 };
    const local0 = localOfBone(name);
    const inherit = inheritOfBone(name);
    const basis = lib.inheritBasis(realParentWorldOf(entry), inherit);
    const A = basis.A || lib.identity();
    if (editTool() === "scale") {
      /* 缩放柄沿骨本地缩放轴 B0 = H·localLinear(L0)（含 shear，契约 §4.4/§5） */
      const B0 = lib.mul(basis.H, lib.localLinear(local0));
      return { axisXAngleRad: lib.axisAngleOf(B0.a, B0.b), axisYAngleRad: lib.axisAngleOf(B0.c, B0.d) };
    }
    if (editSpace() === "world") {
      return { axisXAngleRad: lib.axisAngleOf(1, 0), axisYAngleRad: lib.axisAngleOf(0, 1) };
    }
    if (editSpace() === "local") {
      /* Local 平移柄沿**真实骨世界线性的两列 W**（契约 §5 表末段） */
      const W = (screenInfo && screenInfo.world) || boneWorldOf(entry.index);
      if (W) return { axisXAngleRad: lib.axisAngleOf(W.a, W.b), axisYAngleRad: lib.axisAngleOf(W.c, W.d) };
    }
    /* Parent 平移柄沿真实父级世界线性的两列 A */
    return { axisXAngleRad: lib.axisAngleOf(A.a, A.b), axisYAngleRad: lib.axisAngleOf(A.c, A.d) };
  }

  /** 选中骨的 gizmo 几何（屏幕像素；绘制与命中共用） */
  function currentGizmo() {
    const lib = boneEditLib();
    const name = state.edit.selBone;
    const info = name ? boneScreenInfo(name) : null;
    if (!lib || !info) return null;
    const axes = boneGizmoAxes(name, info);
    return lib.gizmoGeometry({
      pivotScreen: info.screen,
      axisXAngleRad: axes.axisXAngleRad,
      axisYAngleRad: axes.axisYAngleRad,
      zoom: state.zoom,
      sizeCss: lib.DEFAULT_GIZMO_SIZE,
    });
  }

  function boneInteractionActive() {
    return editTarget() === "bone" && !!state.model && anyLayerOn();
  }

  function beginBoneGesture(e, screenPoint, part) {
    const lib = boneEditLib();
    const name = state.edit.selBone;
    const entry = boneEntry(name);
    if (!lib || !entry) return false;
    const reason = boneEditBlockReason(name);
    if (reason) {
      setStatus(reason, "warn");
      return true;
    }
    const info = boneScreenInfo(name);
    const local0 = localOfBone(name);
    /* 契约 §5：冻结真实 P（平移 Jacobian）、真实 W（Local 轴基/aim）、inherit、含 shear 的 local */
    const parentWorld = realParentWorldOf(entry);
    const bWorld = boneWorldOf(entry.index);
    const inherit = inheritOfBone(name);
    const world = unproj(screenPoint.x, screenPoint.y);
    const mode = editTool() === "rotate" ? "bone-rotate" : editTool() === "scale" ? "bone-scale" : editTool() === "pose" ? "bone-pose" : "bone-move";
    /* P2-06（task-28）：Pose 工具 + IK 开关 → 两骨 IK 手势（只经 SpineIkAim.solveTwoBone） */
    if (mode === "bone-pose" && state.edit.ik.on) {
      return beginBoneIkGesture(e, screenPoint);
    }
    state.drag = {
      mode: mode,
      boneName: name,
      part: part || "center",
      startWorld: world,
      startPivot: info ? { x: info.screen.x, y: info.screen.y } : null,
      pivotWorld: { x: info.world.tx, y: info.world.ty },
      local0: local0,
      parentWorld: parentWorld,
      boneWorld: bWorld,
      inherit: inherit,
      startLocal: local0,
      startRotation: local0.rotation,      startScale: { x: local0.scaleX, y: local0.scaleY },
      space: editSpace(),
      axis: part === "x" || part === "y" ? part : null,
      snapUnit: state.snap ? 1 : 0,
      snapDeg: state.snap ? 5 : 0,
      snapStep: state.snap ? 0.05 : 0,
      baseline: snapshot(),
      moved: false,
      pointerId: e.pointerId,
    };
    cv.setPointerCapture(e.pointerId);
    updateCursor();
    render();
    return true;
  }

  function updateBoneGesture(screenPoint) {
    const lib = boneEditLib();
    const d = state.drag;
    if (!lib || !d) return;
    if (d.mode === "bone-ik") {
      updateBoneIkGesture(screenPoint);
      return;
    }
    const world = unproj(screenPoint.x, screenPoint.y);
    if (d.mode === "bone-move") {
      const res = lib.translateFromDrag({
        startX: d.local0.x,
        startY: d.local0.y,
        startWorld: d.startWorld,
        world: world,
        parentWorld: d.parentWorld,
        inherit: d.inherit,
        boneWorld: d.boneWorld,
        startLocal: d.startLocal,
        space: d.space,
        axis: d.axis,
        snapUnit: d.snapUnit,
      });
      if (!res.ok) {
        setStatus(spaceReasonText(res), "warn");
        return;
      }
      d.moved = true;
      writeLocalBone(d.boneName, { x: res.x, y: res.y });
      updateBoneDragBadge(screenPoint, res.x - d.local0.x, res.y - d.local0.y, "");
    } else if (d.mode === "bone-pose") {
      /* P1-07 Pose：把骨 +X 轴 aim 到指针（单骨 FK aim，不做多骨 IK） */
      const res = lib.aimRotation({
        startRotation: d.startRotation,
        startLocal: d.startLocal,
        parentWorld: d.parentWorld,
        inherit: d.inherit,
        pivotWorld: d.pivotWorld,
        pointWorld: world,
        snapDeg: d.snapDeg,
      });
      if (!res.ok) {
        setStatus(spaceReasonText(res), "warn");
        return;
      }
      d.moved = true;
      writeLocalBone(d.boneName, { rotation: res.rotation });
      updateBoneDragBadge(screenPoint, res.deltaDeg, null, "Δ°");
    } else if (d.mode === "bone-rotate") {
      const res = lib.rotateFromDrag({
        startRotation: d.startRotation,
        pivotWorld: d.pivotWorld,
        startWorld: d.startWorld,
        world: world,
        parentWorld: d.parentWorld,
        inherit: d.inherit,
        space: d.space,
        snapDeg: d.snapDeg,
      });
      if (!res.ok) {
        setStatus(spaceReasonText(res), "warn");
        return;
      }
      d.moved = true;
      writeLocalBone(d.boneName, { rotation: res.rotation });
      updateBoneDragBadge(screenPoint, res.deltaDeg, null, "Δ°");
    } else if (d.mode === "bone-scale") {
      const res = lib.scaleFromDrag({
        startScaleX: d.startScale.x,
        startScaleY: d.startScale.y,
        pivotWorld: d.pivotWorld,
        startWorld: d.startWorld,
        world: world,
        axis: d.axis,
        uniform: !d.axis,
        parentWorld: d.parentWorld,
        inherit: d.inherit,
        /* 契约 §5：scale 的轴基走 H·localLinear(startLocal)，旧 boneWorld 是 H 别名，不再传 */
        startLocal: d.startLocal,
        space: d.space,
        snapStep: d.snapStep,
      });
      if (!res.ok) {
        setStatus(spaceReasonText(res), "warn");
        return;
      }
      d.moved = true;
      writeLocalBone(d.boneName, { scaleX: res.scaleX, scaleY: res.scaleY });
      updateBoneDragBadge(screenPoint, res.factor, null, "×");
    }
    syncInspector();
    render();
  }

  function updateBoneDragBadge(screenPoint, a, b, unit) {
    const badge = el0("dragBadge");
    if (!badge) return;
    badge.hidden = false;
    badge.style.left = clamp(screenPoint.x + 14, 4, Math.max(4, viewW() - 180)) + "px";
    badge.style.top = clamp(screenPoint.y + 14, 4, Math.max(4, viewH() - 44)) + "px";
    if (b === null || b === undefined) {
      badge.textContent = unit === "Δ°" ? "Δ " + fmt(a, 1) + "°" : "× " + fmt(a, 3);
    } else {
      badge.textContent = "ΔX " + (a >= 0 ? "+" : "−") + fmt(Math.abs(a), 1) + "  ΔY " + (b >= 0 ? "+" : "−") + fmt(Math.abs(b), 1);
    }
  }

  /* ==========================================================================
   * 12b. P2-03 轴心补偿（Setup）+ P2-04 洋葱皮 / 运动轨迹（纯显示）
   *
   * 口径：
   *   · 补偿 = 一次拖动结束后一次性算出（骨 + 附件同一份快照）→ 调用方只提交**一条事务**。
   *   · 洋葱皮 / 轨迹只读 core 求值，**不写 state.frame / lastPose / 模型 / JSON**，不参与拾取。
   * ====================================================================== */

  /** 轴心补偿是否生效（仅 Setup + 目标=骨骼） */
  function pivotCompensateOn() {
    return !!state.edit.pivotCompensate && editMode() === "setup" && editTarget() === "bone";
  }

  /** compensateMove 的骨输入：boneList（有效 Setup）+ model 的 parentIndex/inherit/shear */
  function pivotBonesInput() {
    const model = state.model;
    if (!model) return null;
    return state.boneList.map((b) => {
      const setup = model.bones[b.index] || {};
      return {
        name: b.name,
        parentIndex: Number.isFinite(setup.parentIndex) ? setup.parentIndex : -1,
        inherit: setup.inherit,
        x: Number.isFinite(b.x) ? b.x : 0,
        y: Number.isFinite(b.y) ? b.y : 0,
        rotation: Number.isFinite(b.rotation) ? b.rotation : 0,
        scaleX: b.scaleX == null ? 1 : b.scaleX,
        scaleY: b.scaleY == null ? 1 : b.scaleY,
        shearX: Number.isFinite(setup.shearX) ? setup.shearX : 0,
        shearY: Number.isFinite(setup.shearY) ? setup.shearY : 0,
      };
    });
  }

  /** 当前挂在该骨上的附件（x/y 取**当前有效值**：已含附件补丁；身份用于写补丁） */
  function pivotAttachmentsOf(boneIndex) {
    const out = [];
    const frame = state.frame;
    if (!state.model || !frame || !frame.pose) return out;
    for (const slot of state.slots) {
      if (slot.boneIndex !== boneIndex) continue;
      const att = attachmentAt(frame.pose, slot.index);
      if (!att) continue;
      const base = baseAttachmentOf(slot.index);
      const identity = {
        skinName: state.model.defaultSkinName || "default",
        slotName: slot.name,
        attachmentName: (base && base.path) || att.path || slot.attachment || null,
      };
      out.push({
        index: slot.index,
        boneIndex: boneIndex,
        name: slot.name,
        type: att.type === "region" ? "region" : att.type || "region",
        x: Number.isFinite(att.x) ? att.x : 0,
        y: Number.isFinite(att.y) ? att.y : 0,
        identity: identity,
      });
    }
    return out;
  }

  /**
   * P2-03：把选中骨的局部增量按「轴心补偿」落到文档（子骨 boneList.x/y + region 附件补丁）。
   * 调用方负责事务边界（必须与拖动本身共享同一份 baseline 快照）。
   * @returns {{ok:boolean, applied:boolean, reason?:string, code?:string, ...compensateMove 结果}}
   */
  function applyPivotCompensation(boneName, delta, mode) {
    const lib = boneEditLib();
    const model = state.model;
    const entry = boneEntry(boneName);
    if (!lib || !model || !entry) return { ok: false, reason: "NO_BONE" };
    if (editMode() !== "setup") return { ok: false, reason: "MODE_ANIMATE" };
    if (!delta || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return { ok: false, reason: "DELTA_INVALID" };
    if (typeof lib.compensateMove !== "function") return { ok: false, reason: "LIB_UNSUPPORTED" };
    const attachments = pivotAttachmentsOf(entry.index);
    const res = lib.compensateMove({
      bones: pivotBonesInput(),
      boneIndex: entry.index,
      delta: delta,
      mode: mode || "childrenAndAttachments",
      attachments: attachments,
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: res.reason,
        code: res.code || lib.editCode(res.reason),
        inheritBoneIndex: res.inheritBoneIndex,
        issues: res.issues || [],
        limitations: res.limitations || [],
      };
    }
    let wrote = 0;
    for (const ch of res.changes) {
      const b = state.boneList[ch.boneIndex];
      if (!b) continue;
      b.x = ch.x;
      b.y = ch.y;
      wrote++;
    }
    let attWrote = 0;
    for (const ac of res.attachmentChanges) {
      const src = attachments.filter((a) => a.index === ac.index)[0];
      if (!src || !src.identity) continue;
      if (setAttachmentFields(src.identity, { x: ac.x, y: ac.y })) attWrote++;
    }
    const summary = {
      ok: true,
      applied: wrote > 0 || attWrote > 0,
      boneName: boneName,
      boneIndex: entry.index,
      mode: res.mode,
      delta: res.delta,
      deltaWorld: res.deltaWorld,
      wrote: wrote,
      attWrote: attWrote,
      maxError: res.maxError,
      compensations: res.changes.map((c) => ({
        boneIndex: c.boneIndex,
        name: c.name,
        dx: c.dx,
        dy: c.dy,
        error: c.error,
      })),
      attachmentChanges: res.attachmentChanges.map((a) => ({ index: a.index, name: a.name, dx: a.dx, dy: a.dy, error: a.error })),
      skippedAttachments: res.skippedAttachments || [],
      issues: res.issues || [],
      limitations: res.limitations || [],
      at: state.t,
    };
    state.edit.lastPivot = summary;
    return Object.assign({}, res, summary);
  }

  function lastPivotState() {
    return state.edit.lastPivot ? JSON.parse(JSON.stringify(state.edit.lastPivot)) : null;
  }

  function setPivotCompensate(on) {
    const want = !!on;
    if (want && editMode() !== "setup") {
      setStatus("轴心补偿只在「绑定姿态」模式可用：动画模式下骨世界位置由 Key 决定，无法无损补偿", "warn");
      syncEditToolbar();
      return false;
    }
    state.edit.pivotCompensate = want;
    if (!want) state.edit.lastPivot = null;
    syncEditToolbar();
    syncInspector();
    setStatus(
      want
        ? "轴心补偿已开启：Setup 用 V 拖动骨时，同一条撤销里给直接子骨与 region 附件补偿局部 x/y（世界位置不变）"
        : "轴心补偿已关闭：拖动只改所选骨（子骨跟随）"
    );
    return true;
  }

  /* ---- P2-04 洋葱皮 ---- */
  const ONION_BEFORE_COLOR = "#5aa9ff";
  const ONION_AFTER_COLOR = "#f0b429";

  /**
   * 规划书 §14 P4「前后帧姿态对照」。
   * 对当前帧与目标帧各求一次姿态（**只读求值**，不写 state.frame / lastPose），
   * 交给纯模块 SpinePoseCompare 量化差异，结果写状态栏并缓存到 state.edit.poseDiff。
   *
   * 为什么单独做而不是复用洋葱皮：洋葱皮是「画出来看」，对照是「说清楚差多少」；
   * 后者要能回答「哪根骨、哪个字段、差多少」，并且必须区分 local 变化与父链带动。
   *
   * @param {number} targetFrame 目标帧号（可为小数，内部吸附到整数帧）
   * @returns {object|null} 对照结果（同时缓存在 state.edit.poseDiff）
   */
  function comparePoseWithFrame(targetFrame) {
    const lib = frameTimelineLib();
    const cmp = window.SpinePoseCompare || null;
    if (!cmp) {
      setStatus("姿态对照模块未加载（pose-compare.js）", "warn");
      return null;
    }
    if (!state.model || !state.anim) {
      setStatus("姿态对照需要先打开带动画的人物包", "warn");
      return null;
    }
    if (editMode() !== "animate") {
      setStatus("姿态对照需要「动画」模式（绑定姿态没有时间轴姿态可比）", "warn");
      return null;
    }
    const fps = tlFps();
    const curFrame = lib ? lib.frameAtTime(state.t, fps) : Math.round(state.t * fps);
    const dstFrame = lib ? lib.snapFrame(targetFrame) : Math.round(targetFrame);
    if (!Number.isFinite(dstFrame)) {
      setStatus("目标帧无效", "warn");
      return null;
    }
    const lastFrame = Math.max(0, Math.round((state.animDur || 0) * fps));
    if (dstFrame < 0 || dstFrame > lastFrame) {
      setStatus("目标帧 " + dstFrame + " 超出范围 0–" + lastFrame, "warn");
      return null;
    }
    const tA = state.t;
    const tB = lib ? lib.frameToTime(dstFrame, fps) : dstFrame / fps;
    /* 只读求值：与洋葱皮同一套调用，不污染 lastPose / state.frame */
    const poseA = core.evalPose(state.model, { animation: state.anim, time: tA, skin: "default" });
    const poseB = core.evalPose(state.model, { animation: state.anim, time: tB, skin: "default" });
    const names = state.model.bones.map((b) => b.name);
    const result = cmp.comparePose({ poseA: poseA, poseB: poseB, names: names, topN: 5 });
    if (!result.ok) {
      setStatus("姿态对照失败：" + (result.issues[0] ? result.issues[0].message : "未知原因"), "warn");
      return null;
    }
    const summary = cmp.summaryLine(result);
    state.edit.poseDiff = {
      at: Date.now(),
      fromFrame: curFrame,
      toFrame: dstFrame,
      fromTime: tA,
      toTime: tB,
      summary: summary,
      changedCount: result.changedCount,
      total: result.total,
      localChangedCount: result.localChangedCount,
      worldChangedCount: result.worldChangedCount,
      top: result.top.map((b) => ({ name: b.name, maxField: b.maxField, maxAbsDelta: round(b.maxAbsDelta, 4) })),
      table: cmp.diffTable(result),
    };
    setStatus("帧 " + curFrame + " ↔ 帧 " + dstFrame + "：" + summary);
    return state.edit.poseDiff;
  }

  function onionUsable() {    return !!(
      state.edit.onion.on &&
      state.model &&
      editMode() === "animate" &&
      state.anim &&
      state.animDur > 0
    );
  }

  /** 洋葱皮采样时刻（按 前后帧数 × 步长/帧率；夹在预览范围内） */
  function onionSampleTimes() {
    const o = state.edit.onion;
    const fps = clamp(Number(state.edit.timeline.fps) || 30, 1, 240);
    const stepSec = clamp(Math.round(Number(o.step) || 1), 1, 10) / fps;
    const range = previewRangeOf(state.anim);
    const lo = range.custom ? range.from : 0;
    const hi = range.custom ? range.to : state.animDur;
    const before = clamp(Math.round(Number(o.before) || 1), 1, 5);
    const after = clamp(Math.round(Number(o.after) || 1), 1, 5);
    const out = [];
    for (let k = before; k >= 1; k--) {
      const t = state.t - k * stepSec;
      if (t >= lo - 1e-9 && t <= hi + 1e-9) out.push({ t: clamp(t, lo, hi), dir: -1, k: k });
    }
    for (let k = 1; k <= after; k++) {
      const t = state.t + k * stepSec;
      if (t >= lo - 1e-9 && t <= hi + 1e-9) out.push({ t: clamp(t, lo, hi), dir: 1, k: k });
    }
    return out;
  }

  /**
   * 洋葱皮（纯显示）：对前后帧各求一次 core 姿态，画**骨骼线框**（原点到父骨原点 / 叶骨到 +X tip）
   * 与**region 附件四边轮廓**（半透明，颜色区分前后：蓝=过去、琥珀=未来）。
   * 只读求值，不写 state.frame / lastPose / 模型；不参与拾取。
   */
  function drawOnionSkin() {
    if (!onionUsable() || !core) return 0;
    const samples = onionSampleTimes();
    const total = samples.length;
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    let drawn = 0;
    ctx.save();
    for (const s of samples) {
      const pose = core.evalPose(state.model, { animation: state.anim, time: s.t, skin: "default" });
      if (!pose || !pose.world) continue;
      const alpha = Math.max(0.12, 0.4 - 0.06 * (s.k - 1));
      const color = s.dir < 0 ? ONION_BEFORE_COLOR : ONION_AFTER_COLOR;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < state.model.bones.length; i++) {
        const w = pose.world[i];
        if (!w) continue;
        const p = proj(w.tx, w.ty);
        const b = state.model.bones[i];
        if (b.parentIndex >= 0 && pose.world[b.parentIndex]) {
          const pw = pose.world[b.parentIndex];
          const pp = proj(pw.tx, pw.ty);
          ctx.beginPath();
          ctx.moveTo(pp.x, pp.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else if (b.length > 0) {
          /* 根骨没有父骨：用 +X tip 表示朝向 */
          const tip = proj(w.tx + w.a * b.length, w.ty + w.b * b.length);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(tip.x, tip.y);
          ctx.stroke();
        }
      }
      /* region 附件四边轮廓（简化：localXY 四角经驱动骨世界矩阵变换） */
      for (let sIdx = 0; sIdx < state.slots.length; sIdx++) {
        const att = attachmentAt(pose, sIdx);
        if (!att || att.weighted || att.type !== "region" || !att.localXY) continue;
        const slot = state.slots[sIdx];
        const bw = pose.world[slot.boneIndex];
        const l = att.localXY;
        if (!bw || !l || l.length < 8) continue;
        ctx.beginPath();
        for (let q = 0; q < 4; q++) {
          const lx = l[q * 2];
          const ly = l[q * 2 + 1];
          const pp = proj(bw.a * lx + bw.c * ly + bw.tx, bw.b * lx + bw.d * ly + bw.ty);
          if (q === 0) ctx.moveTo(pp.x, pp.y);
          else ctx.lineTo(pp.x, pp.y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      drawn++;
    }
    ctx.restore();
    const cost = typeof performance !== "undefined" ? performance.now() - t0 : 0;
    state.edit.onion.drawn = drawn;
    state.edit.onion.lastCostMs = Math.round(cost * 100) / 100;
    state.edit.onion.overflow = Math.max(0, total - drawn);
    return drawn;
  }

  function onionState() {
    const o = state.edit.onion;
    return {
      on: !!o.on,
      before: clamp(Math.round(Number(o.before) || 1), 1, 5),
      after: clamp(Math.round(Number(o.after) || 1), 1, 5),
      step: clamp(Math.round(Number(o.step) || 1), 1, 10),
      fps: clamp(Number(state.edit.timeline.fps) || 30, 1, 240),
      anim: state.anim || null,
      usable: onionUsable(),
      drawn: o.drawn || 0,
      clipped: o.overflow || 0,
      lastCostMs: o.lastCostMs || 0,
      colors: { before: ONION_BEFORE_COLOR, after: ONION_AFTER_COLOR },
      drawing: "骨骼线框 + region 附件四边轮廓（半透明；不参与拾取、不进保存）",
      writesModel: false,
    };
  }

  function setOnion(patch) {
    const o = state.edit.onion;
    const p = patch || {};
    if (typeof p.on === "boolean") o.on = p.on;
    if (p.before !== undefined) o.before = Math.round(clamp(Number(p.before) || 1, 1, 5));
    if (p.after !== undefined) o.after = Math.round(clamp(Number(p.after) || 1, 1, 5));
    if (p.step !== undefined) o.step = Math.round(clamp(Number(p.step) || 1, 1, 10));
    syncDisplayToggles();
    savePrefs();
    render();
    if (o.on && !onionUsable()) {
      setStatus("洋葱皮已开，但需要「动画」模式 + 已选动画（当前不绘制）", "warn");
    } else if (o.on) {
      setStatus("洋葱皮：前后各 " + o.before + "/" + o.after + " 帧 · 步长 " + o.step + " 帧（纯显示，不写 JSON）");
    } else {
      setStatus("洋葱皮已关闭");
    }
    return onionState();
  }

  /* ---- P2-04 运动轨迹 ---- */
  const TRAIL_MAX_SAMPLES = 240;
  let trailCache = { key: "", points: [], tipPoints: [], hasTip: false, samples: 0, costMs: 0 };

  function trailUsable() {
    return !!(state.edit.trail.on && state.model && state.anim && state.animDur > 0 && state.edit.selBone && boneEntry(state.edit.selBone));
  }

  function trailKeyOf(boneName) {
    const tl = state.edit.timeline;
    return [
      state.anim || "",
      boneName || "",
      Math.round((state.animDur || 0) * 1000),
      Math.round(clamp(Number(tl.fps) || 30, 1, 240)),
      state.animEdit.rev || 0,
      modelSignature() || "",
    ].join("|");
  }

  /**
   * 采样选中骨在当前动画 0..duration 的骨原点 / tip 世界位置（上限 240 采样，按 animEdit.rev 缓存）。
   * 只读 core.evalPose，不写 state.frame / lastPose（同帧求值不改全局 state）。
   */
  function trailCompute(boneName) {
    const lib = boneEditLib();
    const entry = boneEntry(boneName);
    if (!lib || !entry || !state.model || state.animDur <= 0) return trailCache;
    const key = trailKeyOf(boneName);
    if (trailCache.key === key && trailCache.points.length) {
      state.edit.trail.cached = true;
      return trailCache;
    }
    const fps = clamp(Number(state.edit.timeline.fps) || 30, 1, 240);
    const n = clamp(Math.ceil(state.animDur * fps) + 1, 2, TRAIL_MAX_SAMPLES);
    const dur = state.animDur;
    const length = Number.isFinite(state.model.bones[entry.index].length) ? state.model.bones[entry.index].length : 0;
    const pts = [];
    const tips = [];
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    for (let i = 0; i < n; i++) {
      const t = (i * dur) / (n - 1);
      const pose = core.evalPose(state.model, { animation: state.anim, time: t, skin: "default" });
      const w = pose && pose.world ? pose.world[entry.index] : null;
      if (!w) continue;
      pts.push({ t: t, x: w.tx, y: w.ty });
      if (length > 0) {
        const tip = lib.aimTipOf({
          boneWorld: w,
          pivotWorld: { x: w.tx, y: w.ty },
          length: length,
        });
        if (tip && tip.ok) tips.push({ t: t, x: tip.x, y: tip.y });
      }
    }
    const cost = typeof performance !== "undefined" ? performance.now() - t0 : 0;
    trailCache = {
      key: key,
      points: pts,
      tipPoints: tips,
      hasTip: tips.length === pts.length && pts.length > 0,
      samples: pts.length,
      costMs: Math.round(cost * 100) / 100,
    };
    return trailCache;
  }

  function drawTrail() {
    if (!trailUsable()) return 0;
    const cache = trailCompute(state.edit.selBone);
    const pts = cache.points;
    if (pts.length < 2) return 0;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#c77dff";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = proj(pts[i].x, pts[i].y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    if (cache.hasTip) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#9b6bd6";
      ctx.beginPath();
      for (let i = 0; i < cache.tipPoints.length; i++) {
        const p = proj(cache.tipPoints[i].x, cache.tipPoints[i].y);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    /* 当前时刻标记：用当前帧的骨原点（与画面一致，不额外求值） */
    const entry = boneEntry(state.edit.selBone);
    const cur = state.frame && state.frame.pose && state.frame.pose.world ? state.frame.pose.world[entry.index] : null;
    if (cur) {
      const p = proj(cur.tx, cur.ty);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.4, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#c77dff";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.restore();
    state.edit.trail.boneName = state.edit.selBone;
    state.edit.trail.samples = cache.samples;
    state.edit.trail.points = cache.points.length;
    state.edit.trail.costMs = cache.costMs;
    state.edit.trail.at = state.t;
    updateDisplayBadge();
    return cache.points.length;
  }

  function trailState() {
    const t = state.edit.trail;
    const sel = state.edit.selBone;
    const cache = sel && state.model ? trailCache : { points: [], samples: 0, costMs: 0, hasTip: false };
    return {
      on: !!t.on,
      boneName: sel || null,
      usable: trailUsable(),
      samples: cache.samples || 0,
      points: cache.points ? cache.points.length : 0,
      hasTip: !!cache.hasTip,
      costMs: cache.costMs || 0,
      cached: !!t.cached,
      maxSamples: TRAIL_MAX_SAMPLES,
      duration: state.animDur || 0,
      fps: clamp(Number(state.edit.timeline.fps) || 30, 1, 240),
      anim: state.anim || null,
      drawing: "选中骨原点折线（实线）+ tip 折线（虚线）+ 当前时刻标记",
      writesModel: false,
    };
  }

  function setTrail(on) {
    state.edit.trail.on = !!on;
    state.edit.trail.cached = false;
    if (!on) trailCache = { key: "", points: [], tipPoints: [], hasTip: false, samples: 0, costMs: 0 };
    syncDisplayToggles();
    savePrefs();
    render();
    if (on && !trailUsable()) {
      setStatus("轨迹已开，但需要已选动画 + 选中骨骼（当前不绘制）", "warn");
    } else {
      setStatus(on ? "轨迹已开：只显示，不写 JSON（采样上限 " + TRAIL_MAX_SAMPLES + "）" : "轨迹已关闭");
    }
    return trailState();
  }

  function invalidateTrailCache() {
    trailCache = { key: "", points: [], tipPoints: [], hasTip: false, samples: 0, costMs: 0 };
    state.edit.trail.cached = false;
  }

  /** 洋葱皮 / 轨迹工具条的同步（含禁用态与提示） */
  function syncDisplayToggles() {
    const o = state.edit.onion;
    const onChk = el0("onionChk");
    const loaded = !!state.model;
    const animReady = loaded && !!state.anim && state.animDur > 0;
    if (onChk) {
      onChk.checked = !!o.on;
      onChk.disabled = !loaded;
    }
    const wrap = el0("onionWrap");
    if (wrap) {
      wrap.title =
        "洋葱皮：半透明绘制前后帧的骨骼线框 + region 附件轮廓（蓝=过去，琥珀=未来）。纯显示：不写 JSON、不参与拾取。" +
        (animReady ? "" : "（需要「动画」模式 + 已选动画）");
      wrap.classList.toggle("is-armed", !!o.on);
    }
    const range = el0("onionRange");
    if (range) range.hidden = !o.on;
    for (const pair of [["onionBefore", "before", 1, 5], ["onionAfter", "after", 1, 5], ["onionStep", "step", 1, 10]]) {
      const node = el0(pair[0]);
      if (!node) continue;
      if (document.activeElement !== node) node.value = String(o[pair[1]]);
      node.disabled = !loaded;
      node.min = String(pair[2]);
      node.max = String(pair[3]);
    }
    const tChk = el0("trailChk");
    if (tChk) {
      tChk.checked = !!state.edit.trail.on;
      tChk.disabled = !loaded;
      tChk.title =
        "轨迹：采样选中骨在当前动画 0..duration 的原点/tip 世界位置（上限 " + TRAIL_MAX_SAMPLES +
        " 采样）画折线 + 当前时刻标记。纯显示：不写 JSON、不参与拾取。" +
        (state.edit.trail.on && !trailUsable() ? "（当前需要选中骨骼 + 已选动画）" : "");
    }
    updateDisplayBadge();
  }
  /** 工具条右侧的「洋葱皮/轨迹」摘要（内容不变就不写 DOM，播放中也不抖） */
  let displayBadgeText = null;
  function updateDisplayBadge() {
    const badge = el0("displayBadge");
    if (!badge) return;
    const o = state.edit.onion;
    const tr = state.edit.trail;
    const bits = [];
    if (o.on) bits.push("洋葱皮 " + o.before + "/" + o.after + "×" + o.step);
    if (tr.on) bits.push("轨迹 " + (trailUsable() ? (trailCache.samples || 0) + " 点" : "待选骨"));
    const text = bits.join(" · ");
    badge.hidden = !text;
    if (text !== displayBadgeText) {
      badge.textContent = text;
      displayBadgeText = text;
    }
  }

  /** 手势结束：AutoKey ON 落 Key，否则只留 transient 并提示未打键 */
  function finishBoneGesture() {
    const d = state.drag;
    if (!d || !d.moved) return;
    /* P2-03：Setup + 开关开启 → 拖动结束后**一次性**算补偿（子骨 + region 附件进同一条事务，
       与拖动本身共享 d.baseline）。不可解时回滚到手势起点，绝不写半套数据。 */
    if (d.mode === "bone-move" && pivotCompensateOn()) {
      const cur = state.bones[d.boneName] || { x: 0, y: 0 };
      const dx = (Number.isFinite(cur.x) ? cur.x : 0) - (Number.isFinite(d.local0.x) ? d.local0.x : 0);
      const dy = (Number.isFinite(cur.y) ? cur.y : 0) - (Number.isFinite(d.local0.y) ? d.local0.y : 0);
      const pivot = applyPivotCompensation(d.boneName, { x: dx, y: dy }, "childrenAndAttachments");
      d.pivot = pivot;
      if (!pivot.ok) {
        applySnapshot(d.baseline);
        d.moved = false;
        refreshDirty();
        syncAll();
        render();
        const label = pivot.code || pivot.reason || "UNKNOWN";
        setStatus("轴心补偿不可解（" + label + "）：本次拖动已回滚，未写坏数据", "warn");
        notice(
          "warn",
          "轴心补偿不可解：" + (pivot.reason || label) + "。已回滚本次拖动；可关闭「轴心补偿」后按普通移动提交。",
          [{ label: "关闭轴心补偿", onClick: () => setPivotCompensate(false) }]
        );
        return;
      }
      syncInspector();
      syncDebug();
    }
    /* U06：自由变换会话内不在这里提交——改动留作预览，Enter 一次提交（一条 Undo），Esc 全回滚 */
    const inFt = !!(state.drag && state.drag.freeTransform);
    if (inFt) {
      state.edit.simpleKeyTime = state.t;
      syncChrome();
      return;
    }
    if (editMode() === "animate" && state.edit.autoKey) {
      const fields = (state.edit.transient && state.edit.transient.fields && state.edit.transient.fields[d.boneName]) || [];
      const want = fields.length ? fields : [editTool() === "rotate" || editTool() === "pose" ? "rotate" : editTool() === "scale" ? "scale" : "translate"];
      const name = state.anim;
      if (name) {
        const before = d.baseline;
        for (const f of want) animAddBoneKey(name, d.boneName, f);
        if (state.edit.transient && state.edit.transient.bones) delete state.edit.transient.bones[d.boneName];
        if (state.edit.transient && state.edit.transient.fields) delete state.edit.transient.fields[d.boneName];
        if (commit(before)) setStatus("已在 " + round(state.t, 3) + "s 写入 " + d.boneName + " 的 " + want.join("/") + " Key");
      }
    } else if (editMode() === "animate" && transientActive()) {
      setStatus("未打关键帧：当前时间 " + round(state.t, 3) + "s 的姿态未写入 Key（按 K 打键）", "warn");
    }
    /* task-41：手势结束后刷新顶栏/文档名/关键帧条（单一界面） */
    state.edit.simpleKeyTime = state.t;
    syncChrome();
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
    /* U06：自由变换会话内先命中包围框（框内=移动 / 角点=等比缩放 / 圆柄=旋转） */
    if (ft.on) {
      const pFt = stagePoint(e);
      const hitFt = ftHit(pFt);
      if (hitFt) {
        e.preventDefault();
        if (ftBegin(e, pFt, hitFt)) return;
      }
      /* 框外点击：先提交当前会话，再按普通手势继续 */
      ftCommit({ quiet: true });
    }
    if (!anyLayerOn()) return setStatus("未显示任何内容：先恢复一个显示层再拾取", "warn");
    const p = stagePoint(e);
    const world = unproj(p.x, p.y);
    const frame = state.frame || framePose();

    /* task-41：命中可见图形 → 稳定 slot/bone identity → 同一次按下直接拖动（单一界面默认手势）；
       不改 region 附件、不走 Setup、不需要先点小节点；空白处清除选择。
       「选择」工具只选中不拖动；旋转/缩放/指向仍走各自 gizmo 手柄。 */
    if (editTarget() === "bone" && editTool() === "translate" && state.tool !== "select") {
      const hitSimple = core.hitTest(frame.geo, world, { epsilon: 1e-8 });
      if (!hitSimple) {
        state.edit.selBone = null;
        state.edit.simpleKeyTime = null;
        state.sel = -1;
        setStatus("已取消选择。");
        syncChrome();
        render();
        return;
      }
      const slotSimple = state.slots[hitSimple.slotIndex];
      if (!slotSimple) return;
      const boneSimple = slotSimple.boneName;
      state.sel = hitSimple.slotIndex;
      if (state.edit.selBone !== boneSimple) selectBone(boneSimple);
      if (state.playing) {
        setStatus("播放中，请先暂停再调整。", "warn");
        render();
        return;
      }
      const reasonSimple = boneEditBlockReason(boneSimple);
      if (reasonSimple) {
        setStatus(simpleStatusText(reasonSimple, "warn"), "warn");
        render();
        return;
      }
      beginBoneGesture(e, p, "center");
      return;
    }

    /* 骨骼目标：先 gizmo 手柄，再骨节点 / 连线，最后才落到部件（贴图不能挡住骨节点） */
    if (boneInteractionActive()) {
      const g = currentGizmo();
      if (g) {
        const lib = boneEditLib();
        const hitPart = lib.hitGizmo({ point: p, geometry: g, tolerancePx: lib.DEFAULT_HIT_TOL, tool: editTool() });
        if (hitPart && beginBoneGesture(e, p, hitPart)) return;
      }
      const boneHit = pickBoneAt(p);
      if (boneHit) {
        const name = state.model.bones[boneHit.index] ? state.model.bones[boneHit.index].name : null;
        if (name) {
          if (state.edit.selBone !== name) selectBone(name);
          const slotIdx = state.slots.findIndex((s) => s.boneIndex === boneHit.index);
          if (slotIdx >= 0) state.sel = slotIdx;
          const reason = boneEditBlockReason(name);
          if (reason) setStatus(reason, "warn");
          else setStatus("已选中骨 " + name + "（" + (boneHit.part === "joint" ? "关节" : "连线") + "）");
          updateCursor();
          render();
          return;
        }
      }
      /* 画布空白：清除骨选择 */
      if (state.edit.selBone) {
        selectBone(null);
        setStatus("已清除骨骼选择");
        render();
        return;
      }
    }

    /* 附件目标：命中 region 附件后开始「附件自身 x/y」拖动（契约 §5） */
    if (editTarget() === "attachment" && editMode() === "setup") {
      const hitAtt = core.hitTest(frame.geo, world, { epsilon: 1e-8 });
      if (hitAtt) {
        selectSlot(hitAtt.slotIndex);
        const reason = attachmentEditBlockReason(hitAtt.slotIndex);
        if (reason) {
          setStatus(reason, "warn");
          render();
          return;
        }
        const slot = state.slots[hitAtt.slotIndex];
        const base = baseAttachmentOf(hitAtt.slotIndex);
        const boneWorld = boneWorldOf(slot.boneIndex);
        const lib = boneEditLib();
        if (base && boneWorld && lib) {
          state.drag = {
            mode: "att-move",
            slotIndex: hitAtt.slotIndex,
            identity: currentAttachmentIdentity(),
            base: { x: base.x || 0, y: base.y || 0 },
            boneWorld: boneWorld,
            startWorld: world,
            snapUnit: state.snap ? 1 : 0,
            baseline: snapshot(),
            moved: false,
            pointerId: e.pointerId,
          };
          cv.setPointerCapture(e.pointerId);
          updateCursor();
          render();
          return;
        }
      }
    }

    const hit = core.hitTest(frame.geo, world, { epsilon: 1e-8 });
    if (!hit) return selectSlot(-1);
    selectSlot(hit.slotIndex);
    if (editTarget() === "bone") {
      const slot = state.slots[hit.slotIndex];
      if (slot && boneEntry(slot.boneName)) selectBone(slot.boneName);
      const breason = boneEditBlockReason(slot ? slot.boneName : null);
      if (breason) setStatus(breason, "warn");
      updateCursor();
      render();
      return;
    }
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
    /* 0.9.85：眼珠跟随鼠标 —— 只要跟随处于激活态就优先处理，
       **不参与**后面的部件拾取（否则鼠标划过眼睛会顺手选中槽）。
       放在最前面是因为它是最轻的动作，且必须在拾取之前截断。 */
    if (gazeActive()) {
      const gp = stagePoint(e);
      if (updateGaze(gp.x, gp.y)) render();
      return;
    }
    const d = state.drag;
    if (d) {
      const p = stagePoint(e);
      if (d.mode === "pan") {
        /* 平移必须**跟手**：鼠标右移 → 画面右移，鼠标下移 → 画面下移。
           这里 panX 进 tx 是加号（tx = W/2 + panX）→ 直接用 + 位移；
           panY 进 ty 是**减号**（ty = H/2 - panY，因为世界 +Y 朝屏幕上方）→ 必须用 - 位移。
           之前两侧都用 +，导致竖向反向（Lead 实测：鼠标右下 60,60 → dPanY=+60 使画面向上跑）。 */
        state.panX = d.panX + (p.x - d.startX);
        state.panY = d.panY - (p.y - d.startY);
        render();
        return;
      }
      if (d.mode === "bone-move" || d.mode === "bone-rotate" || d.mode === "bone-scale" || d.mode === "bone-pose" || d.mode === "bone-ik") {
        updateBoneGesture(p);
        return;
      }
      if (d.mode === "att-move") {
        updateAttachmentGesture(p);
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
        refreshDirty();
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
      state.redo.length = 0;
      refreshDirty();
      setStatus("已移动 " + (state.slots[d.slotIndex] ? state.slots[d.slotIndex].name : "") + " · 可 Ctrl+Z 撤销");
      syncFooter();
      syncInspector();
      syncList();
    }
    if (d.mode === "bone-move" || d.mode === "bone-rotate" || d.mode === "bone-scale" || d.mode === "bone-pose" || d.mode === "bone-ik") {
      if (d.freeTransform) {
        /* U06：会话内只刷新预览，不写 Key、不 pushUndo；Enter 一次提交 / Esc 全回滚。
           记下手势信息，Enter 时才能把预览落成数据（否则 dirty 变了但没写任何东西）。 */
        ft.drag = { bone: d.boneName, mode: d.mode, moved: !!d.moved };
        state.edit.simpleKeyTime = state.t;
        syncChrome();
        syncInspector();
        render();
      } else {
        finishBoneGesture();
        if (d.moved && !(editMode() === "animate" && state.edit.autoKey)) {
          pushUndo(d.baseline);
          state.redo.length = 0;
          refreshDirty();
          const verb = d.mode === "bone-rotate" ? "旋转" : d.mode === "bone-scale" ? "缩放" : d.mode === "bone-pose" ? "Pose 对准" : "移动";
          setStatus("已" + verb + "骨 " + d.boneName + (editMode() === "setup" ? "（绑定姿态）" : "（未打键预览）") + " · 可 Ctrl+Z 撤销");
          syncFooter();
          syncInspector();
          syncList();
          syncEditToolbar();
        }
      }
    }
    if (d.mode === "att-move" && d.moved) {
      pushUndo(d.baseline);
      state.redo.length = 0;
      refreshDirty();
      setStatus("已移动附件 " + (d.identity ? d.identity.attachmentName : "") + "（骨未改动） · 可 Ctrl+Z 撤销");
      syncFooter();
      syncInspector();
      syncList();
    }
    state.drag = null;
    el0("dragBadge").hidden = true;
    updateCursor();
    syncEditToolbar();
    syncUndoRedoMenu();
    render();
  }
  function cancelDrag() {
    const d = state.drag;
    if (!d) return false;
    if (d.mode === "move" && d.moved) {
      applySnapshot(d.baseline);
      refreshDirty();
    }
    if (d.mode === "bone-move" || d.mode === "bone-rotate" || d.mode === "bone-scale" || d.mode === "bone-pose" || d.mode === "bone-ik" || d.mode === "att-move") {
      applySnapshot(d.baseline);
      refreshDirty();
    }
    state.drag = null;
    el0("dragBadge").hidden = true;
    updateCursor();
    syncAll();
    render();
    setStatus("已取消本次拖动");
    return true;
  }
  function updateDragBadge(e, dx, dy) {
    const badge = el0("dragBadge");
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
  /** Space 的活动区域裁决：时间轴/播放条 = 播放暂停；画布/图层区 = 平移 */
  function spaceZoneOf(target) {
    const node = target && target.closest ? target.closest("#dopesheet, .bar-anim, #simpleTrackWrap, #simpleTrackCanvas") : null;
    return node ? "timeline" : "canvas";
  }

  function onKeyDown(e) {
    /* 页内确认模态优先（Enter 确认 / Esc 取消），不被任何快捷键抢走 */
    if (simpleConfirmKeyboard(e)) return;
    if (isTypingTarget(e.target)) return;
    if (captureShortcutKey(e)) return;
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
      if (simpleConfirmVisible()) return simpleConfirmClose(null);
      /* 关于模态框优先级高于帮助：它是后开的浮层，Esc 应先关它 */
      if (aboutVisible()) return closeAbout();
      if (state.helpOpen) return closeHelp();
      if (ft.on) {
        e.preventDefault();
        return ftCancel();
      }
      if (state.drag) {
        e.preventDefault();
        return cancelDrag();
      }
      if (state.sel >= 0) return selectSlot(-1);
      return;
    }

    /* Space 按**活动区域**裁决（不看 dopesheet 是否展开）：
       画布 / 图层区 = 按住平移；时间轴 / 播放条 = 播放暂停。 */
    if (key === " ") {
      e.preventDefault();
      if (spaceZoneOf(e.target) === "timeline") {
        if (!e.repeat) {
          if (!state.anim) setStatus("这个包还没有动画。", "warn");
          else togglePlay();
        }
        return;
      }
      if (!e.repeat) {
        state.spaceDown = true;
        updateCursor();
      }
      return;
    }

    if (key === "?" || (e.shiftKey && key === "/")) {
      e.preventDefault();
      return toggleHelp();
    }
    if (mod && lower === "z") {
      e.preventDefault();
      return e.shiftKey ? redo() : undo();
    }
    if (mod && lower === "y") {
      e.preventDefault();
      return redo();
    }
    if (mod && lower === "s") {
      e.preventDefault();
      if (state.bundle && state.cap && state.cap.saveBundle) openSimpleSaveMenu();
      else simpleSaveCopy();
      return;
    }
    /* U06：Shift+T 进入/提交自由变换（不劫持 Ctrl+T = 浏览器新标签） */
    if (lower === "t" && e.shiftKey) {
      e.preventDefault();
      return ftToggle();
    }
    if (ft.on && key === "Enter") {
      e.preventDefault();
      return ftCommit();
    }
    if (key === "Tab") {
      e.preventDefault();
      return dsOpen();
    }
    if (dsKeyDown(e)) return;
    /* **关键接线**：把带修饰键的组合交给 keymap 分发。
       踩过的坑：tryKeymapAction 早就写好了，但**从来没有被调用过** ——
       于是 Ctrl+C / Ctrl+V / Ctrl+Z 之外的所有 keymap 动作都是死代码
       （实测：选中 Key 按 Ctrl+C 剪贴板仍为空）。
       这里放在 `if (mod || e.altKey) return;` **之前**，否则 Ctrl 组合永远到不了。 */
    if (tryKeymapAction(e)) return;
    if (mod || e.altKey) return;

    /* 工具：V / G = 移动（PS / Blender 两种习惯），Q = 选择，R = 旋转，S = 缩放，W = 指向，H = 平移视图 */
    if (lower === "v" || lower === "g") {
      e.preventDefault();
      if (editTarget() === "bone") return setEditTool("translate");
      return setTool("move");
    }
    if (lower === "q") {
      e.preventDefault();
      return setEditTool("translate", { selectOnly: true });
    }
    if (lower === "r") {
      if (editTarget() === "bone") {
        e.preventDefault();
        return setEditTool("rotate");
      }
      return;
    }
    if (lower === "s" && editTarget() === "bone") {
      e.preventDefault();
      return setEditTool("scale");
    }
    if (lower === "w" && editTarget() === "bone") {
      e.preventDefault();
      return setEditTool("pose");
    }
    /* 0.9.52：H 是**开关** —— 按一下进入拖拽、再按一下退出（与按钮、菜单同一语义） */
    if (lower === "h" && e.shiftKey === false) {
      e.preventDefault();
      return setTool("pan");
    }
    /* 关键帧：K 打键（时间轴展开时走 Dopesheet，否则走位置快捷命令） */
    if (lower === "k") {
      e.preventDefault();
      if (state.edit && state.edit.timeline && state.edit.timeline.expanded && editTarget() === "bone" && state.edit.selBone) return keySelectedBone();
      simpleAddKey();
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      e.preventDefault();
      if (state.edit && state.edit.timeline && state.edit.timeline.expanded) dsDeleteSelected();
      else simpleDeleteKeyFlow();
      return;
    }
    if (lower === "p") {
      e.preventDefault();
      return togglePlay();
    }
    if (lower === "f") {
      e.preventDefault();
      return fitView(e.shiftKey ? "sel" : "all");
    }
    if (key === "[" || key === "]") {
      e.preventDefault();
      return moveLayer(key === "]" ? "up" : "down");
    }
    if (key === "+" || key === "=") {
      e.preventDefault();
      return zoomBy(1.25);
    }
    if (key === "-" || key === "_") {
      e.preventDefault();
      return zoomBy(1 / 1.25);
    }
    /* 规划书 §10：帧级快捷键只在**时间轴面板获得焦点**且处于 Frame 档时接管。
       规划书明确要求「快捷键必须考虑画布、属性输入框和时间轴焦点」——
       所以这里不抢占画布上的骨微调（下面 Arrow 分支）与输入框（isTypingTarget 已在上方拦截）。 */
    if ((key.indexOf("Arrow") === 0 || key === "Home" || key === "End") && fsFrameKeysOwnFocus()) {
      if (fsFrameKeyDown(e)) return;
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
    el0("helpOverlay").hidden = false;
    el0("helpClose").focus();
    /* P1（T21）：打开时刷新快捷键设置区与键位提示 */
    if (typeof renderShortcutSettings === "function") renderShortcutSettings();
    if (typeof syncHelpShortcutHints === "function") syncHelpShortcutHints();
    if (section === "keys" && el0("helpKeys")) {
      el0("helpKeys").scrollIntoView({ block: "nearest" });
      el0("helpKeys").classList.add("is-target");
      setTimeout(() => el0("helpKeys").classList.remove("is-target"), 900);
    }
  }
  function closeHelp() {
    state.helpOpen = false;
    el0("helpOverlay").hidden = true;
    if (helpReturnFocus && helpReturnFocus.focus) {
      try {
        helpReturnFocus.focus();
      } catch (_) {
        /* 忽略 */
      }
    }
  }

  /* ======================================================================
   * 13a. 关于（0.9.19）：工具信息模态框，复用 .modal 结构
   *      所有字段来自 version.js / bundle.js / navigator，**不手写版本号**。
   * ====================================================================== */
  let aboutReturnFocus = null;
  function aboutVisible() {
    const node = el0("aboutOverlay");
    return !!(node && !node.hidden);
  }
  function openAbout() {
    const node = el0("aboutOverlay");
    if (!node) return false;
    aboutReturnFocus = document.activeElement;
    syncAboutFields();
    node.hidden = false;
    const close = el0("aboutClose");
    if (close && close.focus) close.focus();
    return true;
  }
  function closeAbout() {
    const node = el0("aboutOverlay");
    if (!node || node.hidden) return;
    node.hidden = true;
    const back = aboutReturnFocus;
    aboutReturnFocus = null;
    if (back && back.focus && document.contains(back)) {
      try {
        back.focus();
      } catch (_) {
        /* 忽略：原控件已不可聚焦 */
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

  /* ---- 事件名中英映射（0.9.20）：显示中文，底层仍存英文 id ----------------
   * 纯显示层。event-names.js 是独立纯数据模块（Node 侧也能自测）。
   * 优先级：包内 events.json 的 name（作者写的）→ 通用字典 → 英文 id 原样。
   * 绝不用于写入：语音路径、动画映射、事件轨道 name 字段一律仍用英文 id。 */
  function eventNamesLib() {
    return (typeof window !== "undefined" && window.SpineEventNames) || null;
  }

  /** 取某个 voice 事件的显示名（ev 是 voice.js evaluate 后的对象） */
  function eventLabelOf(ev) {
    const id = ev && typeof ev.event === "string" ? ev.event : "";
    const packName = ev && typeof ev.name === "string" ? ev.name : "";
    const lib = eventNamesLib();
    if (lib && typeof lib.eventLabel === "function") return lib.eventLabel(id, packName);
    return packName || id || "（未命名事件）";
  }

  /** 直接按 id（可附带包内 name）取显示名，供表情页套装/其它场景用 */
  function eventLabelById(id, packName) {
    const lib = eventNamesLib();
    if (lib && typeof lib.eventLabel === "function") return lib.eventLabel(id, packName);
    return (typeof packName === "string" && packName.trim()) || String(id || "（未命名事件）");
  }

  /** 分类显示名 */
  function eventCategoryLabel(cat) {
    const lib = eventNamesLib();
    if (lib && typeof lib.categoryLabel === "function") return lib.categoryLabel(cat);
    return cat || "—";
  }

  /** 取某个事件**包内自带的 name**（events.json 里作者写的），没有则返回 "" */
  function exprPackNameOf(id) {
    const v = state.voice;
    const evs = (v && Array.isArray(v.events)) ? v.events : [];
    const hit = evs.find((e) => e && e.event === id);
    return hit && typeof hit.name === "string" ? hit.name : "";
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
      /* 0.9.20：界面显示的是中文名（eventLabel），搜索必须也能命中中文，
         否则「等待授权」这类输入会搜不到（英文 id 与中文名不一致的必然结果）。 */
      if (String(eventLabelOf(ev) || "").toLowerCase().indexOf(q) >= 0) return true;
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
      /* task-9：lib.evaluate 只认识 v1 字段，会把 events.json 的 v2 扩展丢掉。
         这里按 event id 把 expression / frameAction / name 合并回来。 */
      if (v.voice && Array.isArray(v.voice.events)) {
        const byId = Object.create(null);
        for (const src of v.voice.events) byId[src.event] = src;
        for (const ev of v.events) {
          const src = byId[ev.event];
          if (!src) continue;
          if (src.expression && typeof src.expression === "object") ev.expression = src.expression;
          if (src.frameAction !== undefined) ev.frameAction = src.frameAction;
          if (src.name) ev.name = src.name;
        }
      }
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

  /* ==========================================================================
   * task-9：v2 数据层适配（events.json 单一事实源）
   *
   * v2 起人物包的事实分布：
   *   <pack>/events.json          事件名/类别/动画/表情/台词文件   ← 唯一事实源
   *   <pack>/voice/index.json     只有 {id, emotion, text}         ← 按 audioId join
   *   <pack>/spine/rig-meta.json  已无 expressions 段
   *
   * 本段把这两份合成为 voice.js / 事件页期望的形状，**不改 voice.js**：
   * voice.js 的 v1 解析器仍可用于旧包，但 v2 包走这里。
   * ========================================================================== */

  /** 包根：spine base 去掉末尾 /spine */
  function packRootFromBase(base) {
    const b = String(base || "").replace(/\/+$/, "");
    if (!b) return null;
    const m = /^(.*)\/spine$/.exec(b);
    return m ? m[1] : b;
  }

  /** 读 <pack>/events.json（manifest.events 优先，回退包根同名） */
  async function fetchEventsJson(packRoot) {
    const root = String(packRoot || "").replace(/\/+$/, "");
    if (!root) return null;
    let rel = "events.json";
    // manifest.json 的 events 字段优先
    try {
      const mres = await voiceFetchWithTimeout("/" + root + "/manifest.json", {}, 6000);
      if (mres && mres.ok) {
        const mtext = await mres.text();
        const man = JSON.parse(mtext);
        if (man && typeof man.events === "string" && man.events.trim()) rel = man.events.trim();
      }
    } catch (e) {
      /* manifest 缺失不是错误：回退同名文件 */
    }
    try {
      const res = await voiceFetchWithTimeout("/" + root + "/" + rel, {}, 6000);
      if (!res || !res.ok) return null;
      const text = await res.text();
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.events)) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  /** 读 <pack>/voice/index.json（只有 id/emotion/text） */
  async function fetchVoiceSlim(packRoot) {
    const root = String(packRoot || "").replace(/\/+$/, "");
    if (!root) return null;
    try {
      const res = await voiceFetchWithTimeout("/" + root + "/voice/index.json", {}, 6000);
      if (!res || !res.ok) return null;
      const data = JSON.parse(await res.text());
      return data && Array.isArray(data.lines) ? data : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 把 v2 的 events.json + 瘦身 voice 合成为 voice.js 期望的 value 形状。
   * 返回 { meta, lines, events } —— 与 parseIndexText 的输出同构。
   */
  function buildVoiceValueFromEvents(eventsDoc, slimVoice, packRoot, animNames) {
    const slimById = Object.create(null);
    for (const ln of (slimVoice && slimVoice.lines) || []) slimById[ln.id] = ln;

    const lines = [];
    const events = [];
    for (const ev of eventsDoc.events) {
      const evLines = [];
      for (const l of ev.lines || []) {
        const meta = slimById[l.audioId] || {};
        const line = {
          index: lines.length,
          id: l.audioId,
          category: ev.category || null,
          event: ev.id,
          text: meta.text == null ? "" : meta.text,
          emotion: meta.emotion == null ? "" : meta.emotion,
          delivery: "",
          // 路径只来自 events.json（voice 索引里已没有 audio_file）
          audioFile: l.file,
          autoPlay: false,
        };
        /* v3（§7.3）：事件不再声明 Spine 动画。
           旧 v2 包仍有 events[].animation，那时才带上该字段供「联动动画」用；
           v3 下不设 animation，避免 voice.js 把它判成「动画未映射」。 */
        if (typeof ev.animation === "string" && ev.animation) {
          line.animation = ev.animation;
        }
        lines.push(line);
        evLines.push(line);
      }
      events.push({
        event: ev.id,
        name: ev.name || ev.id,
        category: ev.category || null,
        categories: ev.category ? [ev.category] : [],
        lineCount: evLines.length,
        lineIds: evLines.map((x) => x.id),
        animations: typeof ev.animation === "string" && ev.animation ? [ev.animation] : [],
        lines: evLines,
        // v2 扩展：7 部位表情 + frameAction
        expression: ev.expression || null,
        frameAction: ev.frameAction == null ? null : ev.frameAction,
        // v3：presentation.sequence 引用（planned 时 UI 标注「待实现」）
        presentation: ev.presentation || null,
        packFormatVersion: eventsDoc.schemaVersion === 2 ? 3 : 2,
      });
    }
    return {
      meta: {
        characterId: eventsDoc.characterId || (packRoot ? packRoot.split("/").pop() : null),
        characterName: (slimVoice && slimVoice.characterName) || null,
        language: null,
        audioFormat: "ogg",
        lineCount: lines.length,
        notes: [],
        packFormatVersion: 2,
      },
      lines,
      events,
    };
  }

  /** v2 载入：只给 ?index= 时自动探测 events.json */
  async function loadVoiceFromEvents(packRoot, opts) {
    const o = opts || {};
    const v = state.voice;
    const gen = ++v.loadGen;
    v.loadState = "loading";
    v.autoProbeBusy = true;
    v.autoProbeFailed = false;
    v.error = null;
    refreshVoiceUI();

    const doc = await fetchEventsJson(packRoot);
    if (gen !== v.loadGen) return false;
    if (!doc) {
      v.autoProbeBusy = false;
      v.autoProbeFailed = true;
      v.loadState = v.voice ? "ready" : "idle";
      refreshVoiceUI();
      return false;
    }
    const slim = await fetchVoiceSlim(packRoot);
    if (gen !== v.loadGen) return false;
    v.autoProbeBusy = false;

    const value = buildVoiceValueFromEvents(doc, slim, packRoot, v.animations);
    return commitVoiceIndex(value, [], {
      packRoot: packRoot,
      provenance: o.provenance || "auto",
      indexPath: packRoot + "/voice/index.json",
    });
  }

  /** 当前包根（用于事件页拼试听 URL） */
  function currentPackRoot() {
    const v = state.voice;
    if (v.packRoot) return v.packRoot;
    return packRootFromBase(exprMetaBase());
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
          "手动选择的语音索引不含包根（character_id 与当前角色包目录名不一致，或未载入角色包），音频状态为未解析；可在右侧台词分页里填写包根，或改用 ?voice=<仓库相对路径>",
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
    // 显式 / 手动载入是用户主动行为：直接切到台词分页看结果（自动探测不抢分页）
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

    /* task-9：v2 包优先。从 spine base 推导包根，读 <pack>/events.json。
       命中就整条走 v2，不再碰 voice.js 的 v1 解析器。 */
    {
      const packRoot = packRootFromBase(basePath);
      if (packRoot) {
        const v2ok = await loadVoiceFromEvents(packRoot, { provenance: "auto" });
        if (v2ok) return true;
        // v2 不存在：恢复探测态，继续走下面的 v1 候选链（兼容旧包）
        v.autoProbeBusy = false;
      }
    }
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
    /* 动画页：换模型后重建灰/脏状态与选中项 */
    const metaBase = exprMetaBase();
    const metaWant = metaBase ? "/" + metaBase + "/rig-meta.json" : "";
    if (state.expr.metaUrl !== metaWant) {
      state.expr.metaState = "idle";
      state.expr.meta = null;
      state.expr.metaError = "";
      state.expr.metaUrl = "";
    }
    /* 换模型后分组必须按新 state.slots 重新规范化 */
    state.slotGroup.metaKey = "";
    state.slotGroup.collapsed = new Set();
    exprResetOverrides("");
    animEditLoaded();
    maybeLoadRigMeta();
    maybeLoadCatalog();
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
      /* 本地目录模式：返回**合成 Response**，让所有调用方（.ok/.status/.text()）
         无需改动即可命中本地文件；HEAD 只回状态不回体。 */
      if (state.localTree) {
        const hit = localLookupUrl(url);
        const code = hit ? 200 : 404;
        const isHead = String(request.method || "GET").toUpperCase() === "HEAD";
        return new Response(hit && !isHead ? hit : null, { status: code });
      }
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
          setStatus("语音检查完成：" + counts.audioMissing + " 条语音缺失（详见右侧台词分页）", "warn");
        } else if (counts.animMissing > 0) {
          setStatus("语音检查完成：" + counts.animMissing + " 条动画未映射（仅播放语音，详见右侧台词分页）", "warn");
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
    return el0("voiceAudio");
  }

  function voiceLineUrl(line) {
    const lib = voiceLib();
    const v = state.voice;
    if (!lib || typeof lib.resolveAudioPath !== "function" || !v.packRoot || !line) return null;
    const res = lib.resolveAudioPath(v.packRoot, line.audioFile);
    if (!res || !res.ok) return null;
    /* 本地目录模式：没有可 fetch 的 URL，改用该 File 的 blob: URL，试听才能在本地工作 */
    if (isLocalMode()) {
      const blob = localObjectUrl(line.audioFile);
      return blob || null;
    }
    return res.value.url;
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
    /* v3.2：事件不声明动画是正常语义，不要报成「未检查」 */
    if (line.animationStatus === "none") return "该事件不声明联动动画（v3.2 由 Runtime 调度）";
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
    const now = el0("voiceNow");
    if (now) {
      now.textContent = v.play.url ? (v.play.event ? v.play.event + " · " : "") + (v.play.id || "") : "未播放";
      now.classList.toggle("error", !!v.play.error);
    }
    const hint = el0("voiceHint");
    if (hint) {
      hint.textContent = v.hint || "";
      hint.className = "voice-hint" + (v.hintKind ? " " + v.hintKind : " dim");
      hint.title = v.hint || "";
    }
    const stop = el0("voiceStop");
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
    const stop = el0("voiceStop");
    if (stop) stop.classList.toggle("on", !!(v.play.playing && voiceIsCurrent()));
  }

  function patchVoiceProgress() {
    const v = state.voice;
    const a = voiceAudioEl();
    const seek = el0("voiceSeek");
    const time = el0("voiceTime");
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
    const seek = el0("voiceSeek");
    if (seek) {
      seek.disabled = true;
      seek.value = "0";
    }
    const time = el0("voiceTime");
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
    /* v3.2（§7.3）：事件不再声明 Spine 动画 → animationStatus === "none"。
       这是正常语义，不是「未映射」；单独走一条干净路径，
       避免把 undefined 插进文案（那会被人话改写整条吞掉）。 */
    if (line.animationStatus === "none" || typeof anim !== "string" || !anim) {
      setVoiceHint("该事件不声明联动动画，仅播放语音");
      setStatus("仅播放语音（该事件不声明联动动画）");
      return;
    }
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
    if (line.animationStatus === "none") {
      setVoiceHint("该事件不声明联动动画，没有可预览的动画");
      setStatus("该事件不声明联动动画，没有可预览的动画");
      return false;
    }
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
    const host = el0("voiceRootHost");
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
    const box = el0("voiceIssues");
    const list = el0("voiceIssueList");
    if (!box || !list) return;
    const issues = (v.issues || []).slice();
    if (!issues.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const title = el0("voiceIssuesTitle");
    if (title) title.textContent = "索引警告 " + issues.length + " 条（独立展示，不参与事件异常判断）";
    list.hidden = !v.issuesOpen;
    list.textContent = "";
    if (v.issuesOpen) {
      for (const it of issues) {
        list.appendChild(el("li", null, (it.path || "") + " · " + (it.message || it.code || "")));
      }
    }
    const toggle = el0("voiceIssuesToggle");
    if (toggle) {
      toggle.textContent = v.issuesOpen ? "收起" : "展开";
      toggle.hidden = false;
    }
  }

  function renderVoiceSummary() {
    const v = state.voice;
    const text = el0("voiceSummaryText");
    if (!text) return;
    const filter = el0("voiceStatusFilter");
    if (filter && filter.value !== v.statusFilter) filter.value = v.statusFilter;
    const link = el0("voiceLinkAnim");
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
    /* 口型状态并入摘要行：lipsync.json 是独立 sidecar（契约 §3.3），
       条数与契约校验结果属于包级信息，放这里而不是面板底部。 */
    const ls = state.lipsync;
    if (ls && ls.data) {
      const issues = lipsyncValidate(ls.data);
      text.appendChild(el("span", "vsep-dot", " · "));
      const lip = el("span", "voice-count" + (issues.length ? " is-warn" : ""),
        "口型 " + ls.data.lines.length + (issues.length ? " / " + issues.length + " 项不合规" : " ✓"));
      lip.title = "lipsync.json：" + ls.path +
        (issues.length ? "\n" + issues.map((i) => i.code + ": " + i.message).join("\n") : "\n契约校验通过");
      text.appendChild(lip);
    }
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
    const box = el0("voiceChips");
    if (!box) return;
    const v = state.voice;
    box.textContent = "";
    /* task-9：分类由数据聚合（v2 的 events[].category），不再写死 4 个；
       已知分类保持固定顺序，未知分类按出现顺序追加。 */
    const KNOWN = ["agent", "session", "interaction", "easter_egg"];
    const seen = [];
    for (const ev of v.events || []) {
      for (const c of ev.categories || []) if (c && seen.indexOf(c) < 0) seen.push(c);
    }
    const cats = KNOWN.filter((c) => seen.indexOf(c) >= 0)
      .concat(seen.filter((c) => KNOWN.indexOf(c) < 0));
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
    const box = el0("voiceEmpty");
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
      const search = el0("voiceSearch");
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
    const name = el("button", "voice-ev-name", eventLabelOf(ev));
    name.type = "button";
    /* title 里同时给中文名与英文 id：排查问题、对包时两者都要能看到 */
    name.title = "选中并" + (open ? "折叠" : "展开") + " " + eventLabelOf(ev) + "（" + ev.event + "）";
    line1.appendChild(name);
    line1.appendChild(el("span", "spacer"));
    line1.appendChild(voiceStatusBadge(status, ev));
    hd.appendChild(line1);

    // 第二行（分类 / 条数 / 表情摘要 / 试听）—— 0.9.43 移除显示。
    // 保留隐藏容器：内部按钮仍由 voiceEventList 的点击委托按类名分发，
    // 物理删除会让委托失去目标；能力入口在 __characterEditor.voiceAudition / voiceAnimationStatus。
    const line2 = el("div", "voice-ev-line2");
    line2.hidden = true;
    line2.setAttribute("aria-hidden", "true");
    hd.appendChild(line2);
    row.appendChild(hd);

    if (open) {
      const body = el("div", "voice-ev-body");
      /* 0.9.43：按用户要求移除「动画清单 / 资源检查 / 模型动画清单」三块显示。
         能力未删：
           · 资源检查  → __characterEditor.voiceChecks(eventId)
           · 动画存在性 → __characterEditor.voiceAnimationStatus(eventId)
                       （voice() 快照里也仍带 animations 列表）
         这些内容原本是「排查信息」，展开卡片时占据大半高度、把真正的台词挤到下面。 */

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
    /* 0.9.43：按用户要求移除
         · 每行的「动画 ✓ / 动画未映射 / 动画未检查」徽标
         · 每行的「动画」预览按钮
         · 每行下方的 .ogg 文件路径
       能力未删：预览动画 → __characterEditor.voicePreviewLine(lineId)；
       动画存在性 → __characterEditor.voiceAnimationStatus(eventId)。
       文件路径仍是排查所需信息，放回 title（悬停可见），不占版面。 */
    main.appendChild(top);
    const textEl = el("span", "voice-line-text", line.text || "");
    /* 文件路径从可见行移入 title：信息不丢，但不再占版面 */
    textEl.title = [line.text || "", line.audioFile ? "文件：" + line.audioFile : ""].filter(Boolean).join("\n");
    main.appendChild(textEl);
    const err = v.lineErrors[line.id];
    if (err) main.appendChild(el("span", "voice-line-error", err));
    row.appendChild(main);
    /* 每行台词自带「口型」入口：口型是**这一条台词**的属性，
       所以按钮长在行上，而不是面板底部的全局控件。
       点它 = 把「待机骨骼 + 该事件声明的表情 + 该台词的口型」三层合成后
       在主时间轴上播放（用下面的动画时间轴看，不另起一套）。 */
    const lipPlaying = !!(_lipTest && _lipTest.lineId === line.id);
    const lipBtn = el("button", "voice-line-lip btn btn-sm" + (lipPlaying ? " on" : ""));
    lipBtn.type = "button";
    lipBtn.textContent = lipPlaying ? "停止" : "口型";
    lipBtn.title = lipPlaying
      ? "停止这条台词的口型测试"
      : "口型测试：待机骨骼 + 事件表情 + 本条台词的口型 → 在主时间轴播放（听声音看嘴型）";
    lipBtn.setAttribute("aria-pressed", lipPlaying ? "true" : "false");
    lipBtn.setAttribute("aria-label", (lipPlaying ? "停止口型测试 " : "口型测试 ") + line.id);
    row.appendChild(lipBtn);
    return row;
  }

  function renderVoiceList() {
    const v = state.voice;
    const box = el0("voiceEventList");
    const empty = el0("voiceEmpty");
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
    const count = el0("voiceSearchCount");
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
    const list = el0("voiceEventList");
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
    const badge = el0("eventTabBadge");
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
          ? "打开右侧台词分页（未找到语音包）"
          : "打开右侧台词分页（未载入语音包）";
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

  /** 侧栏主分页：parts | events | expr | anim（task-7 起四页平级，都不再折叠） */
  const INSPECTOR_TABS = {
    parts: { tab: "tabParts", panel: "partsView" },
    events: { tab: "tabEvents", panel: "eventPanel" },
    expr: { tab: "tabExpr", panel: "exprPanel" },
    anim: { tab: "tabAnim", panel: "animPanel" },
  };

  function setInspectorTab(tab) {
    const v = state.voice;
    const key = INSPECTOR_TABS[tab] ? tab : "parts";
    const events = key === "events";
    const aside = el0("inspector");
    /* task-7：parts 也走 hidden 切换，不再靠 .show-events 特例隐藏 */
    if (aside) aside.classList.toggle("show-events", events);
    for (const name of Object.keys(INSPECTOR_TABS)) {
      const ids = INSPECTOR_TABS[name];
      const tabEl = el0(ids.tab);
      const panelEl = el0(ids.panel);
      const on = name === key;
      if (tabEl) {
        tabEl.setAttribute("aria-selected", on ? "true" : "false");
        tabEl.tabIndex = on ? 0 : -1;
      }
      /* 四页平级：包括 parts 在内，未选中的都 hidden。
         .inspector > [role=tabpanel]:not([hidden]) 负责给选中页确定高度。 */
      if (panelEl) panelEl.hidden = !on;
    }
    v.open = events;
    state.expr.open = key === "expr";
    state.animEdit.open = key === "anim";
    if (!events) {
      stopVoice();
      v.hint = "";
      v.hintKind = "";
    } else {
      syncVoiceBadge();
      renderVoice();
    }
    if (state.expr.open) {
      renderExprPanel();
      maybeLoadRigMeta();
    maybeLoadCatalog();
    }
    if (state.animEdit.open) {
      /* 进入动画页先清表情覆盖：否则槽 attachment key 的预览会被覆盖遮住 */
      if (Object.keys(state.expr.override).length) exprResetOverrides("");
      syncAnimPanel();
    }
  }

  /** rig-meta 只在需要时读一次（换包/换目录会重新读） */
  function maybeLoadRigMeta() {
    const base = exprMetaBase();
    const want = base ? "/" + base + "/rig-meta.json" : "";
    if (state.expr.metaState === "loading") return;
    if (state.expr.metaUrl === want && (state.expr.metaState === "ready" || state.expr.metaState === "absent" || state.expr.metaState === "error")) return;
    loadRigMeta();
  }

  function openVoice() {
    setPanelOpen(true);
    setInspectorTab("events");
  }

  function closeVoice() {
    setInspectorTab("parts");
  }

  /** 展开/收起的动效时长（毫秒）。与 CSS 里的 --voice-anim-ms 保持一致 */
  const VOICE_ANIM_MS = 150;

  /** 系统是否要求减少动效 */
  function voiceReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }

  /**
   * 给刚渲染出来的展开体做入场动画。
   *
   * 为什么必须在 renderVoice() 之后调用：
   *   renderVoiceList() 先清空容器再重建，展开体是**新的 DOM 节点**。
   *   CSS 过渡依赖「同一个元素的状态变化」，元素都被换掉了就不会触发，
   *   所以只能用 WAAPI 在新节点上跑一次关键帧。
   */
  function voiceAnimateExpandedBody() {
    if (voiceReducedMotion()) return;
    const box = el0("voiceEventList");
    if (!box) return;
    const body = box.querySelector(".voice-event.open .voice-ev-body");
    if (!body || typeof body.animate !== "function") return;
    try {
      body.animate(
        [
          { opacity: 0, transform: "translateY(-4px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: VOICE_ANIM_MS, easing: "ease-out", fill: "none" }
      );
    } catch (e) {
      /* 动效失败不能影响功能：静默降级为直接显示 */
    }
  }

  /** 正在跑的退出动画定时器（快速连点时作废上一个） */
  let voiceExitTimer = 0;
  let voiceExitGen = 0;

  /**
   * 让当前展开的那张先淡出，再执行 after()。
   *
   * 为什么需要这一步：手风琴是「清空 expanded → 重建整列」，
   * 被顶掉的那张会在同一帧内从 184px 塌成 26px，视觉上是硬切换。
   * 先淡出再重建，才是「旧的退、新的进」的连贯过渡。
   *
   * @param {Function} after 淡出结束（或被跳过）后要做的事
   */
  function voiceFadeOutThen(after) {
    const box = el0("voiceEventList");
    const body = box ? box.querySelector(".voice-event.open .voice-ev-body") : null;
    const canAnim = body && typeof body.animate === "function" && !voiceReducedMotion();

    /* 作废上一轮（快速连点保护） */
    const gen = ++voiceExitGen;
    if (voiceExitTimer) {
      clearTimeout(voiceExitTimer);
      voiceExitTimer = 0;
    }

    if (!canAnim) { after(); return; }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      /* 只有还是最新那一轮才继续；否则说明用户又点了别的 */
      if (gen === voiceExitGen) after();
    };

    try {
      const anim = body.animate(
        [
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: "translateY(-4px)" },
        ],
        { duration: VOICE_ANIM_MS, easing: "ease-in", fill: "none" }
      );
      if (anim && typeof anim.finished === "object" && typeof anim.finished.then === "function") {
        anim.finished.then(finish).catch(finish);
      } else {
        voiceExitTimer = setTimeout(finish, VOICE_ANIM_MS);
      }
      /* 兜底：即使 finished 没触发（某些浏览器取消动画时 promise 不 resolve），也要继续 */
      voiceExitTimer = setTimeout(finish, VOICE_ANIM_MS + 60);
    } catch (e) {
      after();
    }
  }

  /** 收起时的轻微反馈：让卡片整体做一个极短的收缩动画 */
  function voiceAnimateCollapsed(rowEl) {
    if (voiceReducedMotion()) return;
    if (!rowEl || typeof rowEl.animate !== "function") return;
    try {
      rowEl.animate(
        [
          { transform: "scaleY(1)" },
          { transform: "scaleY(0.985)" },
          { transform: "scaleY(1)" },
        ],
        { duration: VOICE_ANIM_MS, easing: "ease-out", fill: "none" }
      );
    } catch (e) {
      /* 同上：静默降级 */
    }
  }

  function toggleVoiceEvent(name) {
    const v = state.voice;
    if (!name) return;
    const wasOpen = v.expanded.has(name);
    /* 0.9.46：**手风琴展开** —— 同一时刻只允许一张卡片打开。
       原来用 Set 允许多开，展开几张后整个列表被撑得很长、
       而且「当前在看哪个事件」变得不明确。
       打开新的一张时先清空，再放进当前这张；点已展开的那张仍然是收起。 */
    if (wasOpen) v.expanded.delete(name);
    else {
      v.expanded.clear();
      v.expanded.add(name);
    }
    v.selected = name;

    /* 0.9.48：先让旧的展开体淡出，再重建整列，最后给新展开体淡入。
       顺序很重要：如果直接 renderVoice()，被顶掉的那张会在同一帧内
       从 184px 塌成 26px（实测 6.7ms），视觉上是硬切换。 */
    const afterRebuild = () => {
      renderVoice();
      const box = el0("voiceEventList");
      const row = box && box.querySelector('.voice-event[data-event="' + voiceCssEscape(name) + '"]');
      if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });

      /* 0.9.45：点开卡片时顺带加载该事件的表情（等价于在表情页点同一事件）。
         为什么只在**展开**时应用、收起时不应用：
         收起是一次「看完了、关掉」的动作，如果那时也重算表情，
         会把用户在表情页刚精调好的结果覆盖掉 —— 那是很恼人的行为。
         收起时只清「当前事件」这个标记，预览保持不变。 */
      if (!wasOpen) {
        voiceAnimateExpandedBody();
        const ok = applyExprSet(name);
        if (ok) {
          setStatus("已载入「" + eventLabelById(name, exprPackNameOf(name)) + "」的表情（已从台词页同步应用）", "info");
        }
      } else {
        /* 收起：展开体已经随重建消失，给卡片本身一个极短收缩提示 */
        voiceAnimateCollapsed(row);
        /* 不碰 override，只把「当前生效事件」标记撤掉，避免下次保存到错的事件 */
        state.expr.set = null;
      }
    };

    /* 0.9.48：只有「重建前确实存在展开体」时才需要先淡出。
       判断依据是**改动后**还剩下谁：展开时 expanded 里只剩新的那张、
       但屏幕上旧的展开体还在（旧节点要到 renderVoice 才消失），所以要淡出；
       收起时 expanded 已经空了，屏幕上仍有旧的展开体，同样要淡出。
       唯一可以跳过的是「本来就是全折叠、且这次也是收起」—— 那是空操作。 */
    const hadBody = !!document.querySelector("#voiceEventList .voice-event.open .voice-ev-body");
    if (hadBody) voiceFadeOutThen(afterRebuild);
    else afterRebuild();
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
   * 10d. 可展开 Dopesheet（P0-14..P0-17；T7）
   *   数据源：SpineTimeline.buildRows（草稿优先，其次 raw）—— 禁止硬编码示例。
   *   时间唯一真值仍是 state.t；所有 scrub 走 setPlayhead（带 unkeyed guard）。
   *   Key 的增删改一律经 SpineAnimEdit（retimeKey/upsertKey/removeKey），一次拖拽一条事务。
   * ====================================================================== */
  const DS_RULER_H = 22;
  const DS_ROW_H = 20;
  let dsScrollTop = 0;

  function timelineLib() {
    return window.SpineTimeline || null;
  }

  /** 当前动画的「草稿优先」原始对象（buildRows 的输入） */
  function dsAnimationRaw() {
    const name = state.anim || state.animEdit.sel;
    if (!name) return null;
    return animDraft(name);
  }

  /* ==========================================================================
   * 规划书《Spine Timeline Editor》P0：Frame Timeline 帧视图（Flash 式逐帧）
   *   数据与几何全部来自纯模块 window.SpineFrameTimeline（frame-timeline.js）：
   *   帧↔秒换算、帧格几何、帧格状态、帧选择、统一 TimelineState、时间帧操作。
   *   本段只做：把 UI 状态映射成 TimelineState、把帧格画出来、把指针/键盘接上。
   *
   *   三条硬约束（规划书 §1.3 / §15.2 / §15.3 / §15.4）：
   *     1) Frame Timeline / Dopesheet / Graph **共用** state.edit.timeline 这一份时间状态与
   *        同一个动画草稿（animDraft），不新建第二份数据；
   *     2) 帧只是**时间定位单元**，不是动画数据对象 —— 不给每帧的所有骨骼造关键帧；
   *     3) 关键帧操作（增删改）仍走 SpineAnimEdit；帧视图的「时间帧操作」走
   *        SpineFrameTimeline.applyTimeFrameOperation（整段动画的时间结构），两者分离。
   * ====================================================================== */

  function frameTimelineLib() {
    return window.SpineFrameTimeline || null;
  }

  /** 时间轴帧率（唯一来源，Dopesheet/Graph 的吸附也用它） */
  function tlFps() {
    const tl = state.edit.timeline;
    const lib = frameTimelineLib();
    const raw = Number(tl.fps);
    return lib ? lib.normFps(raw) : raw > 0 ? raw : 30;
  }

  function tlFrameSnapOn() {
    const tl = state.edit.timeline;
    const lib = frameTimelineLib();
    /* 旧的 dsSnap（帧吸附）与新的 dsSnapFrame 是同一个开关：以 dsSnap 为准做单一真值 */
    return lib ? lib.normalizeState({ snapToFrame: !!tl.snapFrames }).snapToFrame : !!tl.snapFrames;
  }

  /**
   * 当前帧视图状态（统一 TimelineState，规划书 §12.3）。
   * 每次读取都从真实来源重建：时间 state.t、帧率 tl.fps、动画时长 state.animDur、
   * 已选关键帧 state.edit.timeline.selection、帧选择 tl.frameSel / tl.frameRange。
   */
  function fsState() {
    const lib = frameTimelineLib();
    const tl = state.edit.timeline;
    const base = {
      currentTime: state.t || 0,
      fps: tlFps(),
      isPlaying: !!state.playing,
      isLooping: !!state.loop,
      playbackSpeed: Number(state.speed) > 0 ? Number(state.speed) : 1,
      selectedKeyIds: fsKeyIds(),
      selectedTrackIds: tl.extraRowKey ? [tl.extraRowKey] : [],
      selectedFrames: Array.isArray(tl.frameSel) ? tl.frameSel : [],
      selectedFrameRange: tl.frameRange || null,
      autoKey: tl.autoKey !== false,
      snapToFrame: !!tl.snapFrames,
      activeMode: tl.tab === "dopesheet" ? "dopesheet" : tl.tab === "graph" ? "graph" : "frame",
      loopStart: state.previewRange && state.previewRange.custom ? state.previewRange.from : 0,
      loopEnd: state.previewRange && state.previewRange.custom ? state.previewRange.to : state.animDur,
      duration: state.animDur || 0,
      pxPerSec: tl.pxPerSec > 0 ? tl.pxPerSec : 100,
      scrollFrame: tl.scrollFrame,
    };
    if (!lib) return base;
    return lib.normalizeState(base);
  }

  /** 把帧状态写回 UI 状态（只回写帧视图自己拥有的字段，别的字段一律不动） */
  function fsSet(patch) {
    const lib = frameTimelineLib();
    const tl = state.edit.timeline;
    const next = lib ? lib.updateState(fsState(), patch || {}) : Object.assign(fsState(), patch || {});
    tl.frameSel = next.selectedFrames.slice();
    tl.frameRange = next.selectedFrameRange;
    tl.fps = next.fps;
    tl.snapFrames = next.snapToFrame;
    return next;
  }

  /** 已选关键帧 → 稳定 id（rowKey@time），供 TimelineState 使用 */
  function fsKeyIds() {
    const tl = state.edit.timeline;
    const sel = tl.selection;
    if (!sel || !Array.isArray(sel.items)) return [];
    const lib = timelineLib();
    const out = [];
    for (const it of sel.items) {
      if (!it) continue;
      const rk = lib ? lib.rowKey(it) : String(it.kind) + ":" + String(it.owner) + ":" + String(it.field);
      out.push(rk + "@" + round(it.time, 6));
    }
    return out;
  }

  /** 帧状态派生量：当前帧、可见帧区间、当前帧列几何、帧号换算（一次算好给绘制用） */
  function fsGeom(opts) {
    const lib = frameTimelineLib();
    const L = dsLayout();
    const st = fsState();
    if (!lib) {
      return { state: st, currentFrame: 0, visible: { ok: false, firstFrame: 0, lastFrame: -1, count: 0, framePx: 1 }, column: null, fps: tlFps() };
    }
    const d = lib.deriveState(st, { width: L.width });
    /* 帧几何与 Dopesheet 的秒基准完全一致：只有一个滚动量 scrollSec（Dopesheet 拥有），
       帧号滚动位置由它折算，避免出现两套各滚各的。 */
    const scrollFrame = (L.scrollSec || 0) * st.fps;
    return {
      state: d.state,
      currentFrame: d.currentFrame,
      durationFrames: d.durationFrames,
      visible: lib.frameRange({ fps: st.fps, pxPerSec: st.pxPerSec, scrollFrame: scrollFrame, width: L.width }),
      column: lib.currentFrameColumn(st.currentTime, { fps: st.fps, pxPerSec: st.pxPerSec, scrollFrame: scrollFrame, width: L.width }),
      framePx: lib.pxPerFrame(st.pxPerSec, st.fps),
      fps: st.fps,
      scrollFrame: scrollFrame,
    };
  }

  /** 帧号 → 轨道区 x（像素）。帧视图与 Dopesheet 共用同一 pxPerSec / scrollSec 基准。 */
  function fsFrameX(frame) {
    const lib = frameTimelineLib();
    const L = dsLayout();
    if (!lib) return NaN;
    const fps = tlFps();
    /* 帧几何统一走纯模块：scrollSec 折算成 scrollFrame，避免两套滚动量各算一遍 */
    return lib.frameToX(frame, {
      fps: fps,
      pxPerSec: L.pxPerSec,
      scrollFrame: (L.scrollSec || 0) * fps,
    });
  }

  /** x（像素）→ 帧号（连续值，是否吸附由调用方决定） */
  function fsXToFrame(x) {
    const lib = frameTimelineLib();
    const L = dsLayout();
    if (!lib) return NaN;
    const fps = tlFps();
    return lib.xToFrame(x, {
      fps: fps,
      pxPerSec: L.pxPerSec,
      scrollFrame: (L.scrollSec || 0) * fps,
    });
  }

  /** 帧选择是否命中（用于绘制） */
  function fsFrameSelected(frame) {
    const tl = state.edit.timeline;
    const list = Array.isArray(tl.frameSel) ? tl.frameSel : [];
    if (list.indexOf(frame) >= 0) return true;
    const r = tl.frameRange;
    return !!(r && frame >= r.start && frame <= r.end);
  }

  /** 帧范围（帧数）：有 range 用 range，否则用已选帧的 min..max */
  function fsRangeFrames() {
    const st = fsState();
    if (st.selectedFrameRange) return st.selectedFrameRange;
    if (st.selectedFrames.length) {
      return { start: st.selectedFrames[0], end: st.selectedFrames[st.selectedFrames.length - 1] };
    }
    return { start: st.selectedFrames.length ? 0 : fsCurrentFrame(), end: fsCurrentFrame() };
  }

  function fsCurrentFrame() {
    const lib = frameTimelineLib();
    return lib ? lib.frameAtTime(state.t || 0, tlFps()) : 0;
  }

  /** 帧选择 → Dopesheet 关键帧选择集（三视图共享选择状态，规划书 §3.3 / §12.3） */
  function fsSelectionItems() {
    const st = fsState();
    if (!st.selectedFrames.length && !st.selectedFrameRange) return null;
    const rows = dsBuild().rows || [];
    const lib = frameTimelineLib();
    const out = [];
    const inSel = (frame) => {
      if (st.selectedFrames.indexOf(frame) >= 0) return true;
      const r = st.selectedFrameRange;
      return !!(r && frame >= r.start && frame <= r.end);
    };
    for (const row of rows) {
      if (!row || row.kind === "group" || !Array.isArray(row.keys)) continue;
      for (const key of row.keys) {
        const f = lib ? lib.frameAtTime(key.time, st.fps) : 0;
        if (inSel(f)) out.push({ kind: row.kind, owner: row.owner, field: row.field, time: key.time });
      }
    }
    return out;
  }

  /** 帧选择 → 同步 Dopesheet 选择集（保留帧选择本身，规划书 §3.3 第 4 点） */
  function fsSyncSelectionToKeys() {
    const items = fsSelectionItems();
    if (items === null) return;
    selectionSet(items, items[0] || null);
  }

  function fsSelectFrame(frame, mode) {
    const lib = frameTimelineLib();
    if (!lib) return;
    const f = lib.snapFrame(frame);
    const tl = state.edit.timeline;
    const anchor = Number.isFinite(tl.frameAnchor) ? tl.frameAnchor : fsCurrentFrame();
    let op = "set";
    if (mode === "add" || mode === "toggle") op = "toggle";
    else if (mode === "range") op = "range";
    const res = lib.selectFrames(fsState(), { op: op, frame: f, anchor: anchor });
    if (!res.ok) {
      setStatus(res.issues[0].message, "warn");
      return;
    }
    tl.frameSel = res.selectedFrames.slice();
    tl.frameRange = res.selectedFrameRange;
    if (mode !== "range") tl.frameAnchor = f;
    fsSyncSelectionToKeys();
  }

  function fsSelectFramesCommand(op) {
    const lib = frameTimelineLib();
    if (!lib) return;
    const res = lib.selectFrames(fsState(), { op: op });
    if (!res.ok) {
      setStatus(res.issues[0].message, "warn");
      return;
    }
    state.edit.timeline.frameSel = res.selectedFrames.slice();
    state.edit.timeline.frameRange = res.selectedFrameRange;
    fsSyncSelectionToKeys();
    setStatus(fsSelectionStatText());
  }

  function fsSelectionStatText() {
    const st = fsState();
    if (!st.selectedFrames.length && !st.selectedFrameRange) return "未选帧";
    const r = st.selectedFrameRange;
    if (r && r.end - r.start + 1 === st.selectedFrames.length) return "已选帧 " + r.start + "–" + r.end + "（" + st.selectedFrames.length + "）";
    return "已选 " + st.selectedFrames.length + " 帧（" + st.selectedFrames.slice(0, 6).join("、") + (st.selectedFrames.length > 6 ? "…" : "") + "）";
  }

  /** 帧级定位（规划书 §9）：走 setPlayhead，保留 unkeyed guard */
  function fsSeekFrame(action, opts) {
    const lib = frameTimelineLib();
    if (!lib) return;
    const st = fsState();
    const res = lib.seekFrame(st, action, Object.assign({ rows: dsBuild().rows || [] }, opts || {}));
    if (!res.ok) {
      setStatus(res.issues[0].message, "warn");
      return;
    }
    setPlayhead(res.time);
    state.edit.timeline.frameAnchor = res.frame;
    dsSyncBars();
    dsDraw();
    graphDraw();
  }

  /** 帧吸附：把当前时间吸到整数帧（只改显示/操作坐标，不动关键帧秒数，§7.4） */
  function fsSnapCurrentToFrame() {
    const lib = frameTimelineLib();
    if (!lib) return;
    if (!tlFrameSnapOn()) return;
    const t = lib.snapTime(state.t || 0, tlFps());
    if (Math.abs(t - (state.t || 0)) > 1e-9) setPlayhead(t);
  }

  /**
   * 时间帧操作（规划书 §3.5 / §6）：走纯模块的 applyTimeFrameOperation，
   * 一次操作 = 一次事务（拖拽/提交各一条历史），失败零写入。
   * @returns {boolean} 是否真的写入了文档
   */
  function animTimeFrameOp(op, opts) {
    const lib = frameTimelineLib();
    const name = state.anim || state.animEdit.sel;
    if (!lib || !name) {
      setStatus("时间帧操作需要先载入动画", "warn");
      return false;
    }
    const draft = animDraft(name);
    if (!draft) {
      setStatus("没有可编辑的动画草稿", "warn");
      return false;
    }
    const before = snapshot();
    const res = lib.applyTimeFrameOperation(draft, Object.assign({ fps: tlFps() }, opts || {}, { op: op }));
    if (!res.ok) {
      setStatus(res.issues.length ? res.issues[0].message : "时间帧操作失败：" + op, "warn");
      notice("warn", "时间帧操作被拒绝：" + (res.issues.length ? res.issues[0].code : op) + "（文档未改动）");
      return false;
    }
    animSetDraft(name, res.value);
    /* 时间结构变了：已选 Key 的时间可能已失效 → 清掉选择，避免指向不存在的 Key */
    state.edit.timeline.selection = { items: [], primary: null };
    state.edit.timeline.selectedKey = null;
    if (commit(before)) {
      setStatus(
        "时间帧操作 " + op + "：移动 " + res.moved + " 个 Key、" + "删除 " + res.removed + " 个" +
          (res.issues.length ? "（" + res.issues.length + " 条告警）" : "")
      );
      animSetDraftRefresh();
      return true;
    }
    setStatus("时间帧操作 " + op + "：文档无变化", "warn");
    return false;
  }

  function frameInsertTimeAt(frame, count) {
    const lib = frameTimelineLib();
    if (!lib) return;
    return animTimeFrameOp("insert", { atFrame: lib.snapFrame(frame), count: Math.max(1, lib.snapFrame(count == null ? 1 : count)) });
  }

  function frameRemoveTimeAt(frame, count) {
    const lib = frameTimelineLib();
    if (!lib) return;
    return animTimeFrameOp("remove", { atFrame: lib.snapFrame(frame), count: Math.max(1, lib.snapFrame(count == null ? 1 : count)) });
  }

  function frameStretchRange(factor) {
    const r = fsRangeFrames();
    return animTimeFrameOp("scale", {
      fromFrame: r.start,
      count: Math.max(1, r.end - r.start + 1),
      factor: factor,
    });
  }

  function frameShiftRange(deltaFrames) {
    const r = fsRangeFrames();
    return animTimeFrameOp("move", {
      fromFrame: r.start,
      count: Math.max(1, r.end - r.start + 1),
      deltaFrames: deltaFrames,
    });
  }

  function frameClearRange() {
    const r = fsRangeFrames();
    return animTimeFrameOp("clear", { fromFrame: r.start, count: Math.max(1, r.end - r.start + 1) });
  }

  /**
   * 范围操作的影响预览（规划书 §3.5：删除时间必须提供影响预览）。
   * 只统计与描述，不改数据。
   */
  function fsRangeImpact() {
    const lib = frameTimelineLib();
    if (!lib) return null;
    const r = fsRangeFrames();
    return lib.rangeImpact(dsBuild().rows || [], r.start, Math.max(1, r.end - r.start + 1), tlFps());
  }

  /** 范围操作的「全轨 / 仅本轨」选择；返回 {mode:"all"|"selected"} 或 null（取消） */
  async function fsRangeScope(title, message, hint) {
    const rows = dsBuild().rows || [];
    const selRow = selectedTrackRow();
    const selKey = selRow ? timelineLib().rowKey(selRow) : null;
    const inSel = selKey
      ? rows.filter((rw) => timelineLib().rowKey(rw) === selKey && Array.isArray(rw.keys) && rw.keys.some((k) => {
          const f = frameTimelineLib().frameAtTime(k.time, tlFps());
          const r = fsRangeFrames();
          return f >= r.start && f <= r.end;
        })).length
      : 0;
    const choice = await simpleConfirm({
      title: title,
      message: message,
      hint: hint,
      actions: [
        { label: "修改范围内全部轨道", value: "all", primary: true },
        {
          label: selKey ? "仅修改选中轨道" : "仅修改选中轨道（先选中一条轨道）",
          value: "selected",
          disabled: !selKey || !inSel,
        },
        { label: "取消", value: null },
      ],
    });
    if (choice !== "all" && choice !== "selected") return null;
    return { mode: choice, rowKey: selKey };
  }

  /** §6 Reverse Keys：把范围内关键帧的时间顺序整体反转（需范围确认） */
  async function frameReverseRange() {
    const lib = frameTimelineLib();
    if (!lib) return false;
    const r = fsRangeFrames();
    const count = Math.max(1, r.end - r.start + 1);
    const imp = fsRangeImpact();
    if (!imp || !imp.ok || !imp.keys) {
      setStatus("帧范围 " + r.start + "–" + r.end + " 内没有关键帧，无需反转", "warn");
      return false;
    }
    const scope = await fsRangeScope(
      "反转关键帧顺序",
      "把帧 " + r.start + "–" + r.end + " 内 " + imp.keys + " 个关键帧（" + imp.tracks + " 条轨道）的时间顺序整体反转，区间中点不动。" +
        "最大位置变化约 " + imp.maxOffsetMs + "ms。",
      "反转会改变动画的播放顺序，可用 Ctrl+Z 撤销。" +
        (imp.sample.length ? " 涉及轨道样例：" + imp.sample.join("、") : "")
    );
    if (!scope) return false;
    const opts = { fromFrame: r.start, count: count, collision: "skip" };
    if (scope.mode === "selected" && scope.rowKey) {
      opts.onlyRowKey = scope.rowKey;
      opts.rowKeyOf = (path) => lib.rowKeyFromPath(path);
    }
    return animTimeFrameOp("reverse", opts);
  }

  /** §5.3「创建逐帧关键帧」：把范围内关键帧均匀铺到整数帧（需范围确认） */
  async function frameSpreadRange() {
    const lib = frameTimelineLib();
    if (!lib) return false;
    const r = fsRangeFrames();
    const count = Math.max(1, r.end - r.start + 1);
    const imp = fsRangeImpact();
    if (!imp || !imp.ok || imp.keys < 2) {
      setStatus("帧范围 " + r.start + "–" + r.end + " 内不足 2 个关键帧：逐帧铺平没有意义", "warn");
      return false;
    }
    const scope = await fsRangeScope(
      "创建逐帧关键帧",
      "把帧 " + r.start + "–" + r.end + " 内 " + imp.keys + " 个关键帧（" + imp.tracks + " 条轨道）在区间内均匀铺到整数帧上，" +
        "每条轨道的关键帧数量不变（不为没有 Key 的轨道凭空造 Key）。",
      "规划书 §5.3：全身/逐帧记录必须提供范围确认，所以这里先问你一次。" +
        (imp.sample.length ? " 涉及轨道样例：" + imp.sample.join("、") : "")
    );
    if (!scope) return false;
    const opts = { fromFrame: r.start, count: count, collision: "skip" };
    if (scope.mode === "selected" && scope.rowKey) {
      opts.onlyRowKey = scope.rowKey;
      opts.rowKeyOf = (path) => lib.rowKeyFromPath(path);
    }
    return animTimeFrameOp("spread", opts);
  }

  /** 右键菜单：空白帧 / 关键帧 / 帧范围（规划书 §3.4） */
  function fsContextMenuAt(p, e) {
    const lib = frameTimelineLib();
    if (!lib) return false;
    const frame = lib.snapFrame(fsXToFrame(p.x));
    const built = dsBuild();
    const rows = built.rows || [];
    const keyed = lib.keysInFrameRange(rows, frame, 1, tlFps()).count > 0;
    const st = fsState();
    const hasRange = !!st.selectedFrameRange && st.selectedFrames.length > 1;
    const menu = lib.contextMenu({ frame: frame, hasKey: keyed, range: hasRange ? st.selectedFrameRange : null });
    const L = lib.contextMenu ? menu.labels : {};
    const items = [
      {
        title: "帧 " + frame + " · " + round(lib.frameToTime(frame, tlFps()), 3) + "s" + (keyed ? " · 有关键帧" : ""),
      },
    ];
    const push = (id, label, opts2) => {
      items.push(Object.assign({ id: "fs-" + id, label: label, onClick: () => fsMenuRun(id, frame) }, opts2 || {}));
    };
    for (const id of menu.items) {
      const label = L[id] || id;
      if (id === "addKey" || id === "addPoseKey") {
        push(id, label, { disabled: !state.edit.selBone, reason: "先在图层里选一个部位" });
      } else if (id === "pasteKey" || id === "pastePose") {
        push(id, label, { disabled: !state.clipboard, reason: "剪贴板为空：先复制一些 Key" });
      } else if (id === "clearFrameKeys" || id === "deleteKey" || id === "deleteKeysInRange") {
        push(id, label, { disabled: !keyed && !hasRange, reason: "这一帧没有关键帧" });
      } else if (id === "editKey" || id === "copyKey" || id === "cutKey" || id === "moveKey" || id === "setInterpolation") {
        push(id, label, { disabled: !keyed, reason: "这一帧没有关键帧" });
      } else if (id === "stretchRange" || id === "shiftRangeLeft" || id === "shiftRangeRight" || id === "clearRange" || id === "copyRange") {
        push(id, label, { disabled: !hasRange, reason: "先拖选一段连续帧范围" });
      } else if (id === "makePerFrameKeys") {
        push(id, label, { disabled: !hasRange, reason: "先拖选一段连续帧范围" });
      } else if (id === "reverseRange" || id === "spreadRange") {
        push(id, label, { disabled: !hasRange, reason: "先拖选一段连续帧范围" });
      } else {
        push(id, label);
      }
    }
    items.push({ sep: true });
    items.push({
      id: "fs-fullpose",
      label: "全身姿态关键帧…",
      note: "先选范围",
      disabled: !(state.anim && editMode() === "animate"),
      reason: state.anim ? "需要「动画」模式" : "这个包没有动画",
      onClick: () => keyFullPoseInteractive(),
    });
    /* §14 P4：动作标记（编辑器侧辅助标注，不进人物包） */
    items.push({
      id: "fs-marker-add",
      label: "在这里加动作标记…",
      note: "仅编辑器偏好",
      disabled: !state.anim,
      reason: "这个包没有动画",
      onClick: () => fsAddMarkerAtPlayhead(),
    });
    items.push({
      id: "fs-marker-remove",
      label: "删除最近的标记",
      note: "不写人物包",
      disabled: !state.anim || !animMarkersGet().length,
      reason: "该动画没有动作标记",
      onClick: () => fsRemoveNearestMarker(),
    });
    items.push({
      id: "fs-insert-time",
      label: "在此插入 1 帧时间（整段后移）",
      disabled: !(state.anim && built.maxTime > 0),
      reason: "这个包没有动画",
      onClick: () => frameInsertTimeAt(frame, 1),
    });
    items.push({
      id: "fs-remove-time",
      label: "删除此帧时间（整段前移）",
      disabled: !(state.anim && built.maxTime > 0),
      reason: "这个包没有动画",
      onClick: () => frameRemoveTimeAt(frame, 1),
    });
    ctxOpen(e.clientX, e.clientY, items, { label: "帧 " + frame + " 菜单" });
    return true;
  }

  function fsMenuRun(id, frame) {
    const lib = frameTimelineLib();
    if (!lib) return;
    const name = state.anim || state.animEdit.sel;
    const fps = tlFps();
    const time = lib.frameToTime(frame, fps);
    switch (id) {
      case "addKey":
        setPlayhead(time);
        simpleAddKey();
        return;
      case "addPoseKey":
        setPlayhead(time);
        keySelected(["x", "y", "rotation", "scaleX", "scaleY"]);
        return;      case "pasteKey":
        dsPasteClipboard(time);
        return;
      case "pastePose":
        /* §6.1：粘贴**姿态**（按当前求值姿态重新打键），不是粘贴该帧已有的关键帧 */
        fsPastePoseAt(time);
        return;
      case "clearFrameKeys":
      case "deleteKey": {
        const t = lib.applyTimeFrameOperation ? time : time;
        setPlayhead(t);
        dsDeleteSelected();
        return;
      }
      case "copyKey":
        dsCopySelection();
        return;
      case "cutKey":
        dsCopySelection();
        dsDeleteSelected();
        return;
      case "locateKey":
        fsSeekFrame("frame", { frame: frame });
        return;
      case "selectFrame":
        fsSelectFrame(frame, "set");
        fsSeekFrame("frame", { frame: frame });
        dsDraw();
        return;
      case "selectFrameAllTracks": {
        const res = lib.selectFrameAllTracks(fsState(), frame, dsBuild().rows || []);
        if (res.ok) {
          selectionSet(
            (res.selectedKeyIds || []).map((sid) => {
              const at = sid.lastIndexOf("@");
              const rk = sid.slice(0, at);
              const tt = Number(sid.slice(at + 1));
              const parts = rk.split(":");
              return { kind: parts[0], owner: parts[1], field: parts.slice(2).join(":"), time: tt };
            }),
            null
          );
          setStatus("已选中帧 " + frame + " 上的全部轨道 Key（" + res.selectedKeyIds.length + " 个）");
          dsDraw();
          graphDraw();
        }
        return;
      }
      case "copyRange":
        fsCopyFrameRange();
        return;
      case "deleteKeysInRange":
      case "clearRange":
        frameClearRange();
        return;
      case "shiftRangeLeft":
        frameShiftRange(-1);
        return;
      case "shiftRangeRight":
        frameShiftRange(1);
        return;
      case "stretchRange":
        frameStretchRange(2);
        return;
      case "reverseRange":
        frameReverseRange();
        return;
      case "spreadRange":
        frameSpreadRange();
        return;
      case "makePerFrameKeys":
        frameSpreadRange();
        return;
      default:
        void name;
        setStatus("该菜单项尚未接线：" + id, "warn");
        return;
    }
  }

  /** 帧视图绘制：帧标尺（帧号 + 帧格） + 当前帧整列高亮 + 帧选择 + 关键帧菱形 */
  /* ==========================================================================
   * 规划书 §14 P4：动作标记（辅助标注，**不进人物包 JSON**）
   *   标记是编辑器侧的注释（"这里该抬手""这段是循环点"），不属于 Spine 动画数据、
   *   也不该导出到 runtime。所以只存编辑器偏好（localStorage），
   *   按「模型签名 + 动画名」隔离；纯逻辑在 anim-markers.js（可单测）。
   * ====================================================================== */

  function animMarkersLib() {
    return window.SpineAnimMarkers || null;
  }

  /** 偏好 key：一次标记只对「某个角色包的某个动画」有意义 */
  function markerStoreKey(animName) {
    const sig = state.model && typeof modelSignature === "function" ? modelSignature() : "";
    return "charEditor.markers.v1:" + String(sig || "nomodel") + ":" + String(animName || "");
  }

  /** 读该动画的标记列表（坏项跳过，不整份丢弃） */
  function animMarkersGet(animName) {
    const lib = animMarkersLib();
    const name = animName || state.anim || state.animEdit.sel;
    if (!lib || !name) return [];
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(markerStoreKey(name)) || "[]");
    } catch (e) {
      raw = [];
    }
    const v = lib.validateList(raw, { duration: animDurationSec(name) });
    return v.list;
  }

  /** 写回（只写偏好，不碰文档，因此不进撤销栈） */
  function animMarkersSet(animName, list) {
    const name = animName || state.anim || state.animEdit.sel;
    if (!name) return false;
    try {
      localStorage.setItem(markerStoreKey(name), JSON.stringify(Array.isArray(list) ? list : []));
      return true;
    } catch (e) {
      setStatus("动作标记保存失败（localStorage 不可用）", "warn");
      return false;
    }
  }

  /** 该动画时长（秒）：走 timeline.animationMaxTime（与 scanTracks 一致），失败再退回本地扫描 */
  function animDurationSec(animName) {
    const name = animName || state.anim || state.animEdit.sel;
    if (!name) return 0;
    const tl = timelineLib();
    if (tl && typeof tl.animationMaxTime === "function") {
      const d = tl.animationMaxTime(animDraft(name));
      if (Number.isFinite(d) && d > 0) return d;
    }
    /* 退回：草稿里所有轨道的最大 time */
    const raw = animDraft(name);
    let maxT = 0;
    const scan = (bag, fields) => {
      if (!bag) return;
      for (const owner of Object.keys(bag)) {
        const node = bag[owner];
        if (!node || typeof node !== "object") continue;
        for (const f of fields) {
          const list = node[f];
          if (!Array.isArray(list)) continue;
          for (const k of list) if (k && Number.isFinite(k.time) && k.time > maxT) maxT = k.time;
        }
      }
    };
    scan(raw && raw.bones, ["rotate", "translate", "scale", "shear"]);
    scan(raw && raw.slots, ["attachment", "color", "twoColor"]);
    if (Array.isArray(raw && raw.events)) for (const k of raw.events) if (k && Number.isFinite(k.time) && k.time > maxT) maxT = k.time;
    if (Array.isArray(raw && raw.drawOrder)) for (const k of raw.drawOrder) if (k && Number.isFinite(k.time) && k.time > maxT) maxT = k.time;
    return maxT;
  }

  /** 在播放头处加一个标记（右键菜单入口） */
  function fsAddMarkerAtPlayhead() {
    const lib = animMarkersLib();
    if (!lib) return setStatus("anim-markers.js 未加载", "error");
    const name = state.anim || state.animEdit.sel;
    if (!name) return setStatus("先选择一个动画", "warn");
    const cur = animMarkersGet(name);
    const raw = typeof window.prompt === "function" ? window.prompt("标记名称：", "标记" + (cur.length + 1)) : null;
    if (raw === null) return null;
    const r = lib.addMarker(cur, { time: state.t, name: raw }, { duration: animDurationSec(name) });
    if (!r.ok) return setStatus(r.issues[0].message, "warn");
    if (animMarkersSet(name, r.list)) {
      setStatus("已加动作标记「" + r.marker.name + "」@ " + round(r.marker.time, 3) + "s（" + lib.summaryLine(r.list) + "）");
      dsDraw();
      fsDraw();
    }
    return r;
  }

  /** 删除离播放头最近的标记 */
  function fsRemoveNearestMarker() {
    const lib = animMarkersLib();
    if (!lib) return setStatus("anim-markers.js 未加载", "error");
    const name = state.anim || state.animEdit.sel;
    if (!name) return setStatus("先选择一个动画", "warn");
    const cur = animMarkersGet(name);
    if (!cur.length) return setStatus("这个动画还没有动作标记", "warn");
    const near = lib.nearestMarker(cur, state.t);
    if (!near) return setStatus("没有可删除的标记", "warn");
    const r = lib.removeMarker(cur, { time: near.time, name: near.name });
    if (!r.ok) return setStatus(r.issues[0].message, "warn");
    if (animMarkersSet(name, r.list)) {
      setStatus("已删除动作标记「" + near.name + "」（剩 " + r.list.length + " 个）");
      dsDraw();
      fsDraw();
    }
    return r;
  }

  /** 某个仓库格子是否已有标记（下拉/提示用） */
  function markerAtTime(time) {
    const lib = animMarkersLib();
    if (!lib) return null;
    const cur = animMarkersGet();
    for (const m of cur) if (m && Math.abs(m.time - time) <= 1e-6) return m;
    return null;
  }

  /** 绘制标记旗标：贴帧标尺下沿，一条竖线 + 小旗（§14 P4） */
/*
 * 帧缩略图（规划书 §14 P4）—— UI 接线
 *
 * 做法（最忠实、零渲染逻辑重复）：
 *   1) 保存当前播放头与渲染状态；
 *   2) 逐个目标帧 setPlayhead → render() → 把主画布 drawImage 缩到小 canvas；
 *   3) 恢复播放头并重绘。
 *   因为直接复用主画布，缩略图与画布所见完全一致（含贴图、蒙版、姿态），
 *   不必复制 drawTextures 那套逻辑（它硬绑全局 ctx，无法离屏）。
 *
 * 抽稀与布局在纯模块 frame-thumbs.js（可单测）；这里只做「取帧 → 画 → 缓存」。
 */

function frameThumbsLib() {
  return window.SpineFrameThumbs || null;
}

/** 缩略图缓存：key -> canvas（模型/动画/帧/尺寸变化即失效） */
const _thumbCache = new Map();
const _THUMB_CACHE_MAX = 240;

/** 当前动画的帧范围（0 .. 时长×fps） */
function frameThumbRange() {
  const fps = tlFps();
  const dur = animDurationSec();
  return { fromFrame: 0, toFrame: Math.max(0, Math.round(dur * fps)) };
}

/**
 * 生成（或复用）某帧的缩略图 canvas。
 * 注意：会临时改播放头并触发 render()，调用方必须保证之后恢复并重绘。
 */
function buildFrameThumb(frame, size, modelSig) {
  const T = frameThumbsLib();
  if (!T) return null;
  const name = state.anim || state.animEdit.sel || "";
  const key = T.cacheKey({ anim: name, frame: frame, modelSignature: modelSig, size: size });
  const hit = _thumbCache.get(key);
  if (hit) return hit;

  /* 取主画布：真实 id 是 #cv（#stage 是它的容器 div，没有像素缓冲） */
  const src = cv || el0("cv");
  if (!src || !src.width || !src.height) return null;

  /* 直接改 state.t 再 render()，**不走 setPlayhead** ——
     setPlayhead → dsSyncPlayhead → dsDraw → 本函数，会形成递归（即使有重入锁，
     也会让「最终那次重绘」被锁挡住，导致缩略图始终画不出来）。 */
  const savedT = state.t;
  state.t = frame / tlFps();
  render();
  state.t = savedT;

  /* 缩到小 canvas：按「等比铺满」裁切，保证角色主体在框内 */
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  const sw = src.width;
  const sh = src.height;
  const scale = Math.max(size / sw, size / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  g.imageSmoothingEnabled = true;
  g.drawImage(src, (size - dw) / 2, (size - dh) / 2, dw, dh);

  /* 简易 LRU：超出上限就丢最早的键 */
  if (_thumbCache.size >= _THUMB_CACHE_MAX) {
    const first = _thumbCache.keys().next();
    if (!first.done) _thumbCache.delete(first.value);
  }
  _thumbCache.set(key, c);
  return c;
}

/** 模型签名变化时清空缓存（换包/改骨架必须重画） */
function invalidateFrameThumbs() {
  _thumbCache.clear();
}

/**
 * 在帧视图标尺下方画一行缩略图。
 * 调用点：dsDraw() 里帧格绘制之后、行区裁剪之前（与标记同层）。
 *
 * **重入保护是必须的**：本函数为了取快照会调 setPlayhead()，而 setPlayhead → dsSyncPlayhead
 * → dsDraw → fsDrawThumbnails，若不加锁就会无限递归（实测 `Maximum call stack size exceeded`）。
 * 这里用一个模块级标志：绘制期间再次进入直接返回。
 */
/*
 * 音频波形（规划书 §14 P4）—— UI 接线
 *
 * 解码：WebAudio decodeAudioData（浏览器原生支持 .ogg/opus）。
 * 绘制：把峰值包络画在时间轴标尺下方一条带子里，横轴与帧视图同源换算，
 *       因此波形与关键帧/缩略图在时间上严格对齐。
 * 纯逻辑（包络/归一化/重采样/换算）在 audio-wave.js（可单测）。
 */

function audioWaveLib() {
  return window.SpineAudioWave || null;
}

/* 解码缓存：url -> {peaks, duration, sampleRate, buckets} */
const _waveCache = new Map();
let _audioCtx = null;

function audioWaveCtx() {
  if (_audioCtx) return _audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { _audioCtx = new AC(); } catch (e) { _audioCtx = null; }
  return _audioCtx;
}

/**
 * 解码某个 URL 的音频并算出峰值包络（带缓存）。
 * @returns {Promise<{ok:boolean, peaks?:Array, duration?:number, sampleRate?:number, reason?:string}>}
 */
async function decodeAudioWave(url, buckets) {
  const W = audioWaveLib();
  if (!W) return { ok: false, reason: "audio-wave.js 未加载" };
  if (!url) return { ok: false, reason: "没有音频地址" };
  const want = Number.isFinite(buckets) && buckets > 0 ? Math.floor(buckets) : 800;
  const hit = _waveCache.get(url + "|" + want);
  if (hit) return hit;

  const ctx = audioWaveCtx();
  if (!ctx) return { ok: false, reason: "浏览器不支持 WebAudio" };
  let buf;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { ok: false, reason: "读不到音频（HTTP " + res.status + "）" };
    const bytes = await res.arrayBuffer();
    buf = await ctx.decodeAudioData(bytes);
  } catch (e) {
    return { ok: false, reason: "音频解码失败：" + String((e && e.message) || e).slice(0, 80) };
  }
  const channels = [];
  for (let i = 0; i < buf.numberOfChannels; i++) channels.push(buf.getChannelData(i));
  const built = W.buildPeaks({ channels: channels, buckets: want });
  if (!built.ok) return { ok: false, reason: built.issues[0] ? built.issues[0].message : "包络计算失败" };
  const norm = W.normalizePeaks(built.peaks);
  const out = {
    ok: true,
    peaks: norm.peaks,
    duration: W.durationOf({ duration: buf.duration, samples: buf.length, sampleRate: buf.sampleRate }),
    sampleRate: buf.sampleRate,
    channels: buf.numberOfChannels,
    buckets: built.buckets,
    silent: norm.silent,
    gain: norm.gain,
  };
  _waveCache.set(url + "|" + want, out);
  return out;
}

/** 当前事件行对应的音频 URL（沿用语音试听的同一解析链路） */
function audioWaveUrlForLine(line) {
  if (!line) return null;
  try {
    if (typeof voiceLineUrl === "function") return voiceLineUrl(line);
  } catch (e) { /* 忽略：回落到 null */ }
  return null;
}

/** 取当前选中的台词行（台词在 events[].lines[]，不在 state.voice.lines） */
function audioWaveCurrentLine() {
  const v = state.voice;
  if (!v || !v.play || !v.play.id) return null;
  /* 复用语音模块的查找（与试听走同一条链路，避免两套查找逻辑漂移） */
  try {
    if (typeof voiceFindLine === "function") {
      const hit = voiceFindLine(v.play.id);
      if (hit) return hit;
    }
  } catch (e) { /* 忽略：回落到下面的遍历 */ }
  const events = Array.isArray(v.events) ? v.events : [];
  for (const ev of events) {
    for (const line of (ev && ev.lines) || []) {
      if (line && line.id === v.play.id) return line;
    }
  }
  return null;
}

/** 只读状态（句柄用） */
function audioWaveState() {
  const W = audioWaveLib();
  const line = audioWaveCurrentLine();
  const url = audioWaveUrlForLine(line);
  const hit = url && W ? _waveCache.get(url + "|800") : null;
  return {
    lib: !!W,
    line: line ? { id: line.id, audioFile: line.audioFile } : null,
    url: url || null,
    decoded: !!hit,
    duration: hit ? hit.duration : 0,
    buckets: hit ? hit.buckets : 0,
    channels: hit ? hit.channels : 0,
    silent: hit ? !!hit.silent : null,
    cached: _waveCache.size,
    summary: hit && W ? W.summaryLine({ duration: hit.duration, buckets: hit.buckets, silent: hit.silent }) : "未解码",
  };
}

/** 主动解码当前台词（句柄入口，返回 Promise） */
async function audioWaveDecode(buckets) {
  const line = audioWaveCurrentLine();
  const url = audioWaveUrlForLine(line);
  if (!url) return { ok: false, reason: "当前没有可解码的台词音频（先在台词页选中一行）" };
  const r = await decodeAudioWave(url, buckets);
  if (r.ok) dsDraw();
  return r;
}

/**
 * 在时间轴标尺下方画一条波形带。
 * 与缩略图互斥显示（同时开会挤在一起），由调用方决定谁画。
 */
let _waveDrawing = false;
function fsDrawAudioWave(g, L) {
  if (_waveDrawing) return;
  const W = audioWaveLib();
  if (!W) return;
  if (!state.edit.timeline.showWave) return;
  const line = audioWaveCurrentLine();
  const url = audioWaveUrlForLine(line);
  if (!url) return;
  const hit = _waveCache.get(url + "|800");
  if (!hit || !hit.ok || !hit.peaks.length) {
    /* 未解码：异步解一次，完成后重绘 */
    if (!_wavePending.has(url)) {
      _wavePending.add(url);
      decodeAudioWave(url, 800).then(() => { _wavePending.delete(url); dsDraw(); }).catch(() => { _wavePending.delete(url); });
    }
    return;
  }

  const bandH = 34;
  const top = L.rulerH + 2;
  const mid = top + bandH / 2;
  const pxPerSec = L.pxPerSec > 0 ? L.pxPerSec : 100;
  const scrollSec = L.scrollSec || 0;
  const width = Math.max(1, Math.min(L.width, Math.round(hit.duration * pxPerSec)));

  /* 背景带 */
  g.save();
  g.fillStyle = "rgba(70,120,200,0.10)";
  g.fillRect(0, top, L.width, bandH);

  /* 逐像素画竖线（min..max） */
  g.strokeStyle = "rgba(120,190,255,0.85)";
  g.lineWidth = 1;
  g.beginPath();
  let drew = 0;
  for (let x = 0; x < L.width; x++) {
    const sec = x / pxPerSec + scrollSec;
    if (sec < 0 || sec > hit.duration) continue;
    const idx = Math.min(hit.peaks.length - 1, Math.floor((sec / hit.duration) * hit.peaks.length));
    const p = hit.peaks[idx];
    if (!p) continue;
    const y0 = mid - p.max * (bandH / 2 - 1);
    const y1 = mid - p.min * (bandH / 2 - 1);
    g.moveTo(x + 0.5, y0);
    g.lineTo(x + 0.5, Math.max(y1, y0 + 0.5));
    drew++;
  }
  g.stroke();

  /* 中线 */
  g.strokeStyle = "rgba(120,190,255,0.30)";
  g.beginPath();
  g.moveTo(0, mid + 0.5);
  g.lineTo(L.width, mid + 0.5);
  g.stroke();

  /* 时长标注 */
  g.fillStyle = "rgba(160,200,255,0.85)";
  g.font = "9px ui-monospace,monospace";
  g.textBaseline = "top";
  g.fillText(hit.duration.toFixed(2) + "s" + (hit.channels > 1 ? " · " + hit.channels + "ch" : ""), 4, top + 2);
  g.restore();
  state.edit.timeline.waveDrawn = drew;
}
const _wavePending = new Set();

/** 开关波形（句柄/右键菜单） */
function setAudioWave(on, opts) {
  const o = opts || {};
  const next = on !== false;
  state.edit.timeline.showWave = next;
  if (next) {
    /* 波形与缩略图都占标尺下方，同时开会重叠 —— 打开波形就关缩略图 */
    if (state.edit.timeline.showThumbs) {
      state.edit.timeline.showThumbs = false;
      if (typeof invalidateFrameThumbs === "function") invalidateFrameThumbs();
    }
  }
  dsDraw();
  if (!o.silent) setStatus(next ? "音频波形：开（需在台词页选中一行）" : "音频波形：关");
  return audioWaveState();
}

let _thumbRendering = false;
function fsDrawThumbnails(g, L) {
  if (_thumbRendering) return;
  const T = frameThumbsLib();
  if (!T) return;
  if (!state.edit.timeline.showThumbs) return;
  if (!state.model) return;
  const G = fsGeom();
  const fps = tlFps();
  const range = frameThumbRange();
  if (!(range.toFrame > 0)) return;

  /* 只为可见区间出图，避免为整段动画渲染 */
  const first = Math.max(0, G.visible && G.visible.firstFrame != null ? G.visible.firstFrame : 0);
  const last = G.visible && G.visible.lastFrame != null ? G.visible.lastFrame : range.toFrame;
  const size = T.clampSize(state.edit.timeline.thumbSize || T.DEFAULT_SIZE);
  const gap = 4;
  /* **按像素间距抽稀**：缩略图不能互相重叠。帧间距 = size + gap 像素，
     换算成帧数就是「每多少帧放一张」。这一步比单纯按数量抽稀更关键 ——
     54 张 44px 图挤在 866px 里会糊成一片（实测如此）。 */
  const pxPerSec = L.pxPerSec > 0 ? L.pxPerSec : 100;
  const pxPerFrame = pxPerSec / fps;
  const framesPerThumb = Math.max(1, Math.ceil((size + gap) / Math.max(pxPerFrame, 1e-6)));
  const plan = T.planFrames({
    fromFrame: Math.max(range.fromFrame, first),
    toFrame: Math.min(range.toFrame, last),
    step: framesPerThumb,
  });
  if (!plan.ok || !plan.frames.length) return;

  const sig = typeof modelSignature === "function" ? modelSignature() : "";
  const lay = T.layout({
    frames: plan.frames,
    fps: fps,
    pxPerSec: L.pxPerSec,
    scrollSec: L.scrollSec || 0,
    size: size,
    width: L.width,
  });

  /* 保存播放头：buildFrameThumb 会临时改它 */
  const savedT = state.t;
  const savedPlaying = state.playing;
  /* 缩略图放在帧标尺**下方**（标尺上沿放会伸进工具栏被裁掉）；
     若行区高度不够则贴着标尺下沿画，至少保证可见。 */
  const top = Math.max(0, Math.min(L.rulerH + 2, Math.max(L.rulerH + 2, L.height - size - 2)));
  let drew = 0;
  _thumbRendering = true;
  try {
    for (const it of lay.items) {
      if (!it.visible) continue;
      if (drew >= T.MAX_THUMBS) break;
      const c = buildFrameThumb(it.frame, size, sig);
      if (!c) continue;
      g.save();
      g.globalAlpha = 0.9;
      g.drawImage(c, it.x, top, size, size);
      g.restore();
      /* 边框：让每张图有明确边界（深色底上尤其重要） */
      g.strokeStyle = "rgba(140,160,200,0.55)";
      g.lineWidth = 1;
      g.strokeRect(it.x + 0.5, top + 0.5, size - 1, size - 1);
      drew++;
    }
  } finally {
    /* 恢复播放头与主画布（buildFrameThumb 已自行恢复 state.t，这里只需重绘主画布）。
       解锁放在最后，且不再调用 setPlayhead（它会导致递归 + 锁挡住最终重绘）。 */
    state.playing = savedPlaying;
    state.t = savedT;
    render();
    _thumbRendering = false;
  }
  state.edit.timeline.thumbDrawn = drew;
}

/** 开关帧缩略图（右键菜单 / 句柄） */
function setFrameThumbs(on, opts) {
  const o = opts || {};
  const next = on !== false;
  state.edit.timeline.showThumbs = next;
  if (o.size) state.edit.timeline.thumbSize = frameThumbsLib() ? frameThumbsLib().clampSize(o.size) : o.size;
  if (!next) invalidateFrameThumbs();
  /* 先确保时间轴面板已展开且有布局高度，否则 dsLayout().height 会是 0，
     画布被压成 1px、缩略图自然画不出来（实测踩过）。 */
  const panel = el0("dopesheet");
  if (next && panel && panel.hidden) {
    if (typeof dsOpen === "function") dsOpen(true, { silent: true });
  }
  dsDraw();
  /* 若首帧布局还没算好（clientHeight 为 0），下一帧再画一次 —— 只补一次，不循环。 */
  if (next && panel && !panel.hidden) {
    const box = el0("dsTracks");
    if (box && box.clientHeight <= 1) {
      requestAnimationFrame(() => {
        if (state.edit.timeline.showThumbs) dsDraw();
      });
    }
  }
  if (!o.silent) setStatus(next ? "帧缩略图：开" : "帧缩略图：关");
  return { on: next, size: state.edit.timeline.thumbSize || (frameThumbsLib() ? frameThumbsLib().DEFAULT_SIZE : 44), drawn: state.edit.timeline.thumbDrawn || 0 };
}

/** 句柄用的只读状态 */
function frameThumbsState() {
  const T = frameThumbsLib();
  const on = !!state.edit.timeline.showThumbs;
  const range = frameThumbRange();
  const plan = T ? T.planFrames({ fromFrame: range.fromFrame, toFrame: range.toFrame }) : { frames: [], step: 1 };
  return {
    on: on,
    size: state.edit.timeline.thumbSize || (T ? T.DEFAULT_SIZE : 44),
    cached: _thumbCache.size,
    range: range,
    planned: plan.frames.length,
    step: plan.step,
    truncated: !!plan.truncated,
    drawn: state.edit.timeline.thumbDrawn || 0,
    summary: T ? T.summaryLine({ count: plan.frames.length, truncated: plan.truncated, size: state.edit.timeline.thumbSize }) : "",
  };
}

  function fsDrawMarkers(g, L) {
    const lib = animMarkersLib();
    if (!lib) return;
    const cur = animMarkersGet();
    if (!cur.length) return;
    const G = fsGeom();
    const rulerH = L.rulerH;
    if (!(rulerH > 0)) return;
    for (const m of cur) {
      /* 标记存的是秒；绘制要转成帧再转 x（fsFrameX 是唯一的几何入口） */
      const x = Math.round(fsFrameX(Math.round(m.time * tlFps())));
      if (!isFinite(x) || x < -20 || x > L.width + 20) continue;
      const color = /^#[0-9a-f]{6}$/.test(m.color || "") ? m.color : lib.DEFAULT_COLOR;
      /* 竖线：从标尺底一路到画布底，半透明以免压过关键帧 */
      g.strokeStyle = color;
      g.globalAlpha = 0.55;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + 0.5, Math.max(0, rulerH - 8));
      g.lineTo(x + 0.5, L.height);
      g.stroke();
      g.globalAlpha = 1;
      /* 小旗：标尺上方一个三角 + 名称 */
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(x + 0.5, Math.max(1, rulerH - 8));
      g.lineTo(x + 0.5, Math.max(1, rulerH - 16));
      g.lineTo(x + 9.5, Math.max(1, rulerH - 12));
      g.closePath();
      g.fill();
      if (L.showLabels !== false) {
        g.fillStyle = color;
        g.font = "9px var(--font-mono, monospace)";
        g.textBaseline = "bottom";
        g.fillText(m.name, x + 12, Math.max(9, rulerH - 9));
      }
    }
  }

  function fsDrawFrameGrid(g, L, rows) {
    const lib = frameTimelineLib();
    if (!lib) return;
    const G = fsGeom();
    const fps = G.fps;
    const framePx = G.framePx;
    if (!(framePx > 0)) return;
    const steps = lib.chooseFrameSteps({ fps: fps, pxPerSec: L.pxPerSec });
    const first = Math.max(0, G.visible.firstFrame == null ? 0 : G.visible.firstFrame);
    const last = G.visible.lastFrame == null ? first : G.visible.lastFrame;
    const bodyTop = L.rulerH;
    const bodyH = Math.max(0, L.height - bodyTop);

    /* ---- 当前帧整列高亮（§3.2「当前帧」）：先铺在帧格之下，再被关键帧覆盖 ---- */
    if (G.column && G.column.ok) {
      const cx = G.column.x;
      if (cx + framePx >= 0 && cx <= L.width) {
        g.fillStyle = "rgba(255,209,102,0.10)";
        g.fillRect(cx, bodyTop, framePx, bodyH);
      }
    }
    /* ---- 已选帧列（§3.2「选中帧」）：独立底色，与当前帧区分 ---- */
    const selList = G.state.selectedFrames || [];
    for (let i = 0; i < selList.length; i++) {
      const sx = fsFrameX(selList[i]);
      if (!isFinite(sx) || sx + framePx < 0 || sx > L.width) continue;
      g.fillStyle = "rgba(127,209,255,0.13)";
      g.fillRect(sx, bodyTop, framePx, bodyH);
    }
    /* ---- 帧格分隔线：每帧细线（够宽才画）+ 主刻度粗线 ---- */
    if (framePx >= 6) {
      g.strokeStyle = "rgba(120,140,175,0.10)";
      g.lineWidth = 1;
      for (let f = first; f <= last; f++) {
        if (f % steps.major === 0) continue;
        const x = Math.round(fsFrameX(f));
        if (x < -1 || x > L.width + 1) continue;
        g.beginPath();
        g.moveTo(x + 0.5, bodyTop);
        g.lineTo(x + 0.5, L.height);
        g.stroke();
      }
    }
    g.strokeStyle = "rgba(120,140,175,0.26)";
    g.lineWidth = 1;
    for (let f = first; f <= last; f++) {
      if (f % steps.major !== 0) continue;
      const x = Math.round(fsFrameX(f));
      if (x < -1 || x > L.width + 1) continue;
      g.beginPath();
      g.moveTo(x + 0.5, bodyTop);
      g.lineTo(x + 0.5, L.height);
      g.stroke();
    }
    /* ---- 帧标尺：主刻度写整数帧号（§3.1 主刻度显示帧编号） ---- */
    for (let f = first; f <= last; f++) {
      const isLabel = f % steps.major === 0;
      const isMinor = steps.minor != null && f % steps.minor === 0;
      if (!isLabel && !isMinor) continue;
      const x = Math.round(fsFrameX(f));
      if (x < -20 || x > L.width + 20) continue;
      g.strokeStyle = isLabel ? "#5a6a86" : "rgba(120,140,175,0.30)";
      g.beginPath();
      g.moveTo(x + 0.5, isLabel ? 5 : L.rulerH - 5);
      g.lineTo(x + 0.5, L.rulerH);
      g.stroke();
      if (isLabel) {
        g.fillStyle = "#8b98ad";
        g.fillText(String(f), x + 3, 12);
      }
    }
    /* ---- 帧选择边框（选中帧整列描边，读起来像 Flash 的帧选中） ---- */
    for (let i = 0; i < selList.length; i++) {
      const sx = fsFrameX(selList[i]);
      if (!isFinite(sx) || sx + framePx < 0 || sx > L.width) continue;
      g.strokeStyle = "rgba(127,209,255,0.65)";
      g.lineWidth = 1;
      g.strokeRect(Math.round(sx) + 0.5, bodyTop + 0.5, Math.max(1, Math.round(framePx) - 1), Math.max(0, bodyH - 1));
    }
    /* ---- 离散轨道（§4.3 Attachment / §4.5 Events）：阶梯块而不是渐变带 ----
       附件切换与事件**不插值**：语义是「从该时间起就是这个值」。
       Dopesheet 的渐变色带（dsDraw）表达不了这件事，所以帧视图额外画一层阶梯块。
       只在 Frame 档生效（tl.tab === "frame"），不改动已验证的 Dopesheet 观感。 */
    if ((state.edit.timeline.tab || "dopesheet") === "frame") {
      const tlib = timelineLib();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.kind === "group" || !Array.isArray(row.keys) || !row.keys.length) continue;
        const rowTop = L.rulerH - L.scrollTop + i * L.rowH;
        if (rowTop > L.height || rowTop + L.rowH < L.rulerH) continue;
        const disc = tlib && typeof tlib.isDiscreteTrack === "function" ? tlib.isDiscreteTrack(row.kind, row.field) : null;
        if (!disc || !disc.discrete) continue;
        const klist = row.keys.slice().sort((a, b) => a.time - b.time);
        const isEventRow = row.kind === "event";
        const y = rowTop + 3;
        const h = Math.max(3, L.rowH - 6);
        for (let k = 0; k < klist.length; k++) {
          const key = klist[k];
          const xa = fsFrameX(lib.frameAtTime(key.time, fps));
          /* 事件是瞬时标记（宽度固定）；附件/绘制顺序持续到下一个 Key（或动画末尾） */
          let xb;
          if (isEventRow) {
            xb = xa + Math.max(2, Math.min(6, framePx * 0.5));
          } else {
            const nextT = k + 1 < klist.length ? klist[k + 1].time : (state.animDur || key.time);
            xb = fsFrameX(lib.frameAtTime(nextT, fps));
          }
          if (!isFinite(xa) || !isFinite(xb) || xb <= xa) continue;
          const ca = Math.max(-1, Math.min(L.width, xa));
          const cb = Math.max(-1, Math.min(L.width, xb));
          if (cb <= ca) continue;
          g.fillStyle = isEventRow ? "rgba(232,210,74,0.55)" : "rgba(79,195,217,0.45)";
          g.fillRect(ca, y, cb - ca, h);
          g.strokeStyle = isEventRow ? "rgba(232,210,74,0.9)" : "rgba(79,195,217,0.85)";
          g.lineWidth = 1;
          g.strokeRect(Math.round(ca) + 0.5, y + 0.5, Math.max(1, Math.round(cb - ca) - 1), h - 1);
          /* 阶梯末端竖线：一眼看出「离散跳变」而不是渐变 */
          g.beginPath();
          g.moveTo(Math.round(cb) + 0.5, y);
          g.lineTo(Math.round(cb) + 0.5, y + h);
          g.stroke();
        }
      }
    }

    /* ---- 锁定轨道：整行降亮度 + 锁图标（规划书 §3.2「锁定轨道 = 降低亮度并显示锁图标」）----
       锁定的真值来自 state.edit.timeline.lockedRows（与 trackWriteGate 同一份），
       这里只做呈现，不改变任何写入闸门。按行在显示列表里的序号定位，避免行被过滤后错位。 */
    const lockedList = Array.isArray(state.edit.timeline.lockedRows) ? state.edit.timeline.lockedRows : [];
    if (lockedList.length) {
      const lockedSet = new Set(lockedList.map((k) => String(k)));
      /* 注意：本函数里的 lib 是 SpineFrameTimeline，它没有 rowKey（那是 SpineTimeline 的）；
         帧模块导出的是同格式的 defaultRowKey（kind:owner:field），锁列表用的正是这一格式。 */
      const rowKeyOfRow = (row) => lib.defaultRowKey(row);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.kind === "group" || !Array.isArray(row.keys)) continue;
        if (!lockedSet.has(rowKeyOfRow(row))) continue;
        const rowTop = L.rulerH - L.scrollTop + i * L.rowH;
        if (rowTop > L.height || rowTop + L.rowH < L.rulerH) continue;
        const y0 = Math.max(L.rulerH, rowTop);
        const y1 = Math.min(L.height, rowTop + L.rowH);
        /* 降亮度：压一层与背景同色的半透明遮罩（不改行本身的色带/菱形颜色语义） */
        g.fillStyle = "rgba(18,22,31,0.62)";
        g.fillRect(0, y0, L.width, Math.max(0, y1 - y0));
        /* 锁图标：画在行首，与左侧轨道名区域对齐 */
        const cx = 9;
        const cy = rowTop + L.rowH / 2;
        if (cy > L.rulerH + 3 && cy < L.height - 3) {
          g.strokeStyle = "rgba(200,210,225,0.85)";
          g.fillStyle = "rgba(200,210,225,0.85)";
          g.lineWidth = 1.2;
          /* 锁体 */
          g.strokeRect(cx - 3.5, cy - 0.5, 7, 5.5);
          /* 锁梁 */
          g.beginPath();
          g.arc(cx, cy - 1.5, 2.4, Math.PI, 0);
          g.stroke();
        }
      }
    }
    void rows;
  }

  /** 帧视图鼠标：按下 */
/*
 * 帧选择工具（规划书 §3.3）+ 帧段复制（§6.1）
 *
 * 两种指针模式（工具条上切换）：
 *   frameSelect  帧选择：在帧格上拖动 = 画出帧范围（默认）
 *   frameBox     框选：拖出矩形，同时选帧与轨道 Key（等价 Dopesheet 框选）
 *
 * 复制能力：
 *   · Alt + 拖拽帧段 = 复制到新位置（原位置保留），对应 frame-timeline 的 duplicate 操作
 *   · 「复制帧」按钮 = 把当前帧范围内的 Key 放进剪贴板（Ctrl+C 等价，但按范围）
 *   · 「复制到后一帧」按钮 = 把范围整体复制到 +1 帧（不需要拖拽）
 */

/** 当前帧选择工具："frameSelect" | "frameBox" */
function fsFrameTool() {
  const t = state.edit.timeline.frameTool;
  return t === "frameBox" ? "frameBox" : "frameSelect";
}

/** 切换帧选择工具（工具条按钮） */
function fsSetFrameTool(tool, opts) {
  const o = opts || {};
  const next = tool === "frameBox" ? "frameBox" : "frameSelect";
  state.edit.timeline.frameTool = next;
  const a = el0("dsFrameToolSelect");
  const b = el0("dsFrameToolBox");
  if (a) a.setAttribute("aria-pressed", next === "frameSelect" ? "true" : "false");
  if (b) b.setAttribute("aria-pressed", next === "frameBox" ? "true" : "false");
  if (!o.silent) {
    setStatus(next === "frameBox"
      ? "框选工具：拖出矩形，同时选中范围内的帧与轨道 Key"
      : "帧选择工具：在帧格上拖动画出帧范围");
  }
  return { tool: next };
}

/**
 * 按当前帧范围复制 Key 进剪贴板。
 * 与 fsCopyFrameRange 的区别：没有帧范围时退回「复制当前选中 Key」，不会静默什么都不做。
 */
function fsCopyRangeToClipboard() {
  const r = fsRangeFrames();
  const hasRange = r && Number.isFinite(r.start) && Number.isFinite(r.end);
  if (!hasRange) {
    /* 没有帧范围：退回选中 Key 的复制 */
    const res = dsCopySelection();
    return { ok: !!(res && res.ok), mode: "keys", status: (el0("statusMsg") || {}).textContent };
  }
  const res = fsCopyFrameRange();
  return { ok: !!(res && res.ok), mode: "range", range: { start: r.start, end: r.end }, status: (el0("statusMsg") || {}).textContent };
}

/**
 * 把当前帧范围整体复制到 +deltaFrames 处（原位置保留）。
 * 这是「Alt+拖拽」与「复制到后一帧」按钮的共同底层。
 */
function fsDuplicateRange(deltaFrames) {
  const r = fsRangeFrames();
  if (!r || !Number.isFinite(r.start) || !Number.isFinite(r.end)) {
    setStatus("先选中一段帧范围再复制", "warn");
    return false;
  }
  const delta = Number.isFinite(deltaFrames) ? Math.round(deltaFrames) : 1;
  if (delta === 0) {
    setStatus("复制位移不能为 0", "warn");
    return false;
  }
  const lib = frameTimelineLib();
  if (!lib || typeof lib.applyTimeFrameOperation !== "function") {
    setStatus("帧模块未加载", "warn");
    return false;
  }
  const ok = animTimeFrameOp("duplicate", {
    fromFrame: r.start,
    count: Math.max(1, r.end - r.start + 1),
    deltaFrames: delta,
    collision: "skip",
  });
  if (ok) {
    /* 复制完成后把范围移到新位置，方便连续操作 */
    const a = r.start + delta;
    const b = r.end + delta;
    const list = [];
    for (let f = a; f <= b; f++) list.push(f);
    state.edit.timeline.frameSel = list;
    state.edit.timeline.frameRange = { start: a, end: b };
    setStatus("已复制帧范围 " + r.start + "–" + r.end + " 到 " + a + "–" + b + "（原位置保留）");
    dsSyncBars();
    dsDraw();
  }
  return ok;
}

  function fsPointerDown(e, p, L) {
    const lib = frameTimelineLib();
    if (!lib) return false;
    const box = el0("dsTracks");
    /* 标尺 → 定位当前帧（点击即选中该帧并移动播放指针，§3.3「单击帧格」第 1/2 条） */
    if (p.y < L.rulerH) {
      const frame = lib.snapFrame(fsXToFrame(p.x));
      fsSelectFrame(frame, e.ctrlKey || e.metaKey ? "toggle" : "set");
      fsSeekFrame("frame", { frame: frame });
      state.drag = { mode: "fs-ruler", pointerId: e.pointerId, anchorFrame: frame };
      try {
        box.setPointerCapture(e.pointerId);
      } catch (_) {
        /* 忽略 */
      }
      return true;
    }
    /* 轨道区：命中关键帧 → 交给 Dopesheet 的关键帧拖动；否则是帧选择 / 框选 */
    const hit = dsKeyHit(p);
    if (hit) return false;
    const frame = lib.snapFrame(fsXToFrame(p.x));
    const mode = e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "set";
    /* **框选工具**：拖出矩形，同时选帧与轨道 Key（等价 Dopesheet 框选）。
       这里不进入 fs-frame（那是「画帧范围」），而是走 Dopesheet 的 ds-box 流程。 */
    if (fsFrameTool() === "frameBox") {
      state.drag = {
        mode: "ds-box",
        pointerId: e.pointerId,
        anchor: { x: p.x, y: p.y },
        box: null,
        moveMode: !(e.ctrlKey || e.metaKey),
      };
      try {
        box.setPointerCapture(e.pointerId);
      } catch (_) {
        /* 忽略 */
      }
      if (!(e.ctrlKey || e.metaKey)) dsSelectKey(null);
      return true;
    }
    /* **拖拽帧段**：起手那一帧若已在既有帧范围内，记下整段边界，
       之后拖动就整体平移（Flash 的「拖拽帧」）。否则 spanStart/spanEnd 为 null，
       拖动退化成重新框选（保持原有行为，不破坏既有交互）。
       **Alt 键 = 复制**（不移动原位置的 Key）。 */
    const cur = state.edit.timeline.frameRange;
    const inSpan = !!(cur && Number.isFinite(cur.start) && Number.isFinite(cur.end) &&
      frame >= cur.start && frame <= cur.end);
    state.drag = {
      mode: "fs-frame",
      pointerId: e.pointerId,
      anchorFrame: frame,
      anchor: { x: p.x, y: p.y },
      box: null,
      moved: false,
      spanStart: inSpan ? cur.start : null,
      spanEnd: inSpan ? cur.end : null,
      lastDelta: 0,
      /* Alt 拖拽 = 复制帧段（原位置保留），否则 = 平移 */
      duplicate: !!e.altKey && inSpan,
    };
    fsSelectFrame(frame, mode);
    try {
      box.setPointerCapture(e.pointerId);
    } catch (_) {
      /* 忽略 */
    }
    dsSyncBars();
    dsDraw();
    return true;
  }

  function fsPointerMove(e, p, L) {
    const lib = frameTimelineLib();
    const d = state.drag;
    if (!lib || !d) return false;
    if (d.mode === "fs-ruler") {
      const frame = lib.snapFrame(fsXToFrame(p.x));
      setPlayhead(lib.frameToTime(frame, tlFps()));
      /* 标尺上拖动 = 连选一段帧（Shift 语义），松手前把范围同步出来；
         单击（未超过 4px）仍只是定位到那一帧，不产生范围选择。 */
      if (Number.isFinite(d.anchorFrame)) {
        const moved = Math.abs(frame - d.anchorFrame) > 0;
        if (moved) {
          const a = Math.min(d.anchorFrame, frame);
          const b = Math.max(d.anchorFrame, frame);
          const list = [];
          for (let f = a; f <= b; f++) list.push(f);
          state.edit.timeline.frameSel = list;
          state.edit.timeline.frameRange = { start: a, end: b };
          fsSyncSelectionToKeys();
          setStatus("帧范围 " + a + "–" + b + "（" + list.length + " 帧）· 右键可整段操作");
        } else {
          state.edit.timeline.frameAnchor = frame;
        }
      }
      dsSyncBars();
      dsDraw();
      return true;
    }
    if (d.mode !== "fs-frame") return false;
    /* 拖动超过 3px 进入帧范围选择（Shift 语义等价），单击则算单帧选择 */
    if (!d.moved && Math.hypot(p.x - d.anchor.x, p.y - d.anchor.y) < 4) return true;
    d.moved = true;
    const to = lib.snapFrame(fsXToFrame(p.x));

    /* **拖拽帧段（Flash 式）**：如果起手时那一帧已经在既有帧范围内，
       且按住的是「帧段」而不是新建选择，就把整段一起平移。
       判据：anchorFrame 落在 drag.spanStart..drag.spanEnd 内。
       这样「先在标尺上选一段 → 在段内按住拖」= 整段移动（Flash 的拖拽帧），
       而「在段外按住拖」= 重新框选（保持原行为）。 */
    if (d.spanStart != null && d.spanEnd != null &&
        d.anchorFrame >= d.spanStart && d.anchorFrame <= d.spanEnd) {
      const delta = to - d.anchorFrame;
      if (delta !== d.lastDelta) {
        d.lastDelta = delta;
        /* 预览：把范围按 delta 平移后重画（不写数据）。
           Alt 复制时原范围不动，预览用「新位置」高亮，提示这是复制而非移动。 */
        const a = d.spanStart + delta;
        const b = d.spanEnd + delta;
        state.edit.timeline.frameSel = (function () { const l = []; for (let f = a; f <= b; f++) l.push(f); return l; })();
        state.edit.timeline.frameRange = { start: a, end: b };
        setStatus((d.duplicate ? "复制帧段：" : "拖拽帧段：") + "第 " + d.spanStart + "–" + d.spanEnd +
          " 帧 → " + a + "–" + b + (d.duplicate ? "（Alt：原位置保留）" : "（松开应用，Esc 取消）"));
        dsSyncBars();
        dsDraw();
      }
      return true;
    }

    const a = Math.min(d.anchorFrame, to);
    const b = Math.max(d.anchorFrame, to);
    const list = [];
    for (let f = a; f <= b; f++) list.push(f);
    state.edit.timeline.frameSel = list;
    state.edit.timeline.frameRange = { start: a, end: b };
    fsSyncSelectionToKeys();
    setStatus("帧范围 " + a + "–" + b + "（" + list.length + " 帧）· 右键可整段操作");
    dsSyncBars();
    dsDraw();
    void L;
    return true;
  }

  function fsPointerUp() {
    const d = state.drag;
    if (!d || (d.mode !== "fs-ruler" && d.mode !== "fs-frame")) return false;
    /* 拖拽帧段松手：真正把 Key 平移过去（一次事务，可撤销） */
    if (d.mode === "fs-frame" && d.spanStart != null && d.spanEnd != null &&
        d.anchorFrame >= d.spanStart && d.anchorFrame <= d.spanEnd &&
        Number.isFinite(d.lastDelta) && d.lastDelta !== 0) {
      const delta = d.lastDelta;
      const s0 = d.spanStart;
      const s1 = d.spanEnd;
      const isDup = !!d.duplicate;
      state.drag = null;
      /* **关键**：预览阶段已经把 frameRange 改成了「平移后」的位置，
         而 frameShiftRange() / fsDuplicateRange() 读的是当前 frameRange ——
         直接调会二次平移。所以先还原成原始范围，再执行一次真正的操作。 */
      const orig = [];
      for (let f = s0; f <= s1; f++) orig.push(f);
      state.edit.timeline.frameSel = orig;
      state.edit.timeline.frameRange = { start: s0, end: s1 };
      const ok = isDup ? fsDuplicateRange(delta) : frameShiftRange(delta);
      if (!ok) {
        setStatus((isDup ? "复制帧段失败" : "拖拽帧段失败") + "：文档未改动", "warn");
      }
      dsSyncBars();
      dsDraw();
      return true;
    }
    state.drag = null;
    dsSyncBars();
    dsDraw();
    return true;
  }

  /** 把帧视图工具条与读数同步（只在帧视图显示） */
  function fsSyncBar() {
    const tl = state.edit.timeline;
    const frameMode = (tl.tab || "dopesheet") === "frame";
    const bar = el0("dsFrameBar");
    if (bar) bar.hidden = !frameMode;
    const read = el0("dsFrameRead");
    if (read) {
      const lib = frameTimelineLib();
      const cur = fsCurrentFrame();
      const total = lib ? lib.snapFrame(lib.timeToFrame(state.animDur || 0, tlFps())) : 0;
      read.textContent = "帧 " + cur + " / " + total;
      read.title = "当前帧 " + cur + "（" + round(state.t || 0, 3) + "s）· 总帧数 " + total + "（" + round(state.animDur || 0, 3) + "s @ " + tlFps() + "fps）";
    }
    const stat = el0("dsFrameSelStat");
    if (stat) stat.textContent = fsSelectionStatText();
    const snap = el0("dsSnapFrame");
    if (snap) snap.checked = !!tl.snapFrames;
    const fpsInput = el0("dsFps");
    if (fpsInput && document.activeElement !== fpsInput) fpsInput.value = String(tlFps());
    const prev = el0("dsPrevFrame");
    const next = el0("dsNextFrame");
    if (prev) prev.disabled = !state.anim;
    if (next) next.disabled = !state.anim;
  }

  /* ==========================================================================
   * 规划书 §10：帧级快捷键
   *   只在「时间轴面板获得焦点 + Frame 档」时生效，用来与画布上的骨微调
   *   （同一个方向键）和属性输入框（isTypingTarget 已在上游拦截）共存。
   *   Esc 的「取消选择 / 退出当前操作」与 Space 的播放暂停沿用既有全局处理。
   * ====================================================================== */

  function fsFrameKeysOwnFocus() {
    const tl = state.edit.timeline;
    if ((tl.tab || "dopesheet") !== "frame") return false;
    const panel = el0("dopesheet");
    if (!panel || panel.hidden) return false;
    const a = document.activeElement;
    if (!a || !panel.contains(a)) return false;
    /* 面板里的输入框（轨道搜索 / FPS / 缩放）自己吃键，不抢 */
    if (isTypingTarget(a)) return false;
    return true;
  }

  /** @returns {boolean} 是否已处理该按键（true = 调用方直接 return） */
  function fsFrameKeyDown(e) {
    const lib = frameTimelineLib();
    if (!lib) return false;
    const mod = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        /* Shift+←/→ = 上一个 / 下一个关键帧（§10） */
        fsSeekFrame(e.shiftKey ? (dir > 0 ? "nextKey" : "prevKey") : dir > 0 ? "next" : "prev");
        return true;
      }
      case "ArrowUp":
      case "ArrowDown":
        /* 纵向留给轨道列表滚动（§10 没有为上下方向键定义帧语义） */
        return false;
      case "Home":
        e.preventDefault();
        fsSeekFrame("first");
        return true;
      case "End":
        e.preventDefault();
        fsSeekFrame("last");
        return true;
      case "k":
      case "K": {
        e.preventDefault();
        /* §10：Shift+K = 骨骼姿态关键帧；Ctrl+Shift+K = 全身姿态关键帧（需范围确认，§5.3） */
        if (e.shiftKey && mod) keyFullPoseInteractive();
        else if (e.shiftKey) keySelected(["x", "y", "rotation", "scaleX", "scaleY"]);
        else simpleAddKey();
        return true;
      }
      case "Delete":
      case "Backspace":
        e.preventDefault();
        dsDeleteSelected();
        return true;
      case "a":
      case "A":
        if (!mod) return false;
        e.preventDefault();
        dsSelectAll();
        return true;
      case "d":
      case "D":
        if (!mod) return false;
        e.preventDefault();
        /* §6 Duplicate Key：复制当前选中/当前帧的 Key 到下一帧位置（一条事务） */
        fsDuplicateKey();
        return true;
      default:
        return false;
    }
  }

  /* ==========================================================================
   * P1（T21）：偏好持久化（契约 §8）、骨架签名、选择集 / 剪贴板 / 批量编辑
   * ====================================================================== */

  const PREFS_KEY = "dsh.character-editor.preferences";
  const PREFS_VERSION = 1;
  let prefsTimer = null;

  function isRecord(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function prefsDefaults() {
    return {
      version: PREFS_VERSION,
      layout: {
        expanded: false,
        height: 280,
        pxPerSec: 100,
        scrollSec: 0,
        snapFrames: false,
        fps: 30,
        tab: "dopesheet",
        graphComponent: 0,
      },
      /* P2-04：纯显示开关（洋葱皮 / 轨迹）。schema 只做**增量**容错读取：
         旧 P1 配置没有 display 段 ⇒ 取默认，不因缺字段丢弃整份偏好、也不改 PREFS_VERSION。 */
      display: {
        onion: { on: false, before: 1, after: 1, step: 1 },
        trail: { on: false },
      },
      shortcuts: null,
      models: {},
      /* task-36：界面模式（简单/高级）。增量字段：旧配置没有 ui 段 → 默认 simple，且不丢任何旧字段。 */
      ui: {
        mode: "simple",
        onboardingSeen: false,
        simpleKeysExpanded: false,
      moreOpen: false,
      clipOpen: false,
      extraOpen: false,
        advancedSeen: false,
        lastPackIndexPath: null,
        lastClipByPack: {},
      },
    };
  }

  /**
   * 读取 + 校验 + 夹取（契约 §8）：损坏 / 版本不符 / 类型不符 → 默认值 + 非阻断提示；
   * localStorage 抛错（SecurityError/Quota）→ 本会话继续可用，只是不持久化。
   */
  function loadPrefs() {
    const def = prefsDefaults();
    state.prefs = def;
    let raw = null;
    try {
      raw = window.localStorage.getItem(PREFS_KEY);
    } catch (e) {
      state.prefsError = "localStorage 不可用（" + (e && e.name ? e.name : "Error") + "）：本次会话不持久化";
      return def;
    }
    if (!raw) return def;
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }
    if (!isRecord(parsed) || parsed.version !== PREFS_VERSION) {
      state.prefsError = "偏好配置损坏或版本不符：已回退默认（不覆盖原内容）";
      return def;
    }
    const lay = isRecord(parsed.layout) ? parsed.layout : {};
    def.layout.expanded = lay.expanded === true;
    def.layout.height = Math.round(clamp(Number(lay.height) || 280, 160, 420));
    def.layout.pxPerSec = clamp(Number(lay.pxPerSec) || 100, 20, 600);
    def.layout.scrollSec = Math.max(0, Number.isFinite(Number(lay.scrollSec)) ? Number(lay.scrollSec) : 0);
    def.layout.snapFrames = lay.snapFrames === true;
    def.layout.fps = clamp(Number(lay.fps) || 30, 1, 240);
    def.layout.tab = lay.tab === "graph" ? "graph" : "dopesheet";
    def.layout.graphComponent = Number(lay.graphComponent) === 1 ? 1 : 0;
    /* P2-04 显示开关：字段缺失 / 类型不符 → 默认（不阻断），数值夹取到 UI 允许区间 */
    const disp = isRecord(parsed.display) ? parsed.display : {};
    const onion = isRecord(disp.onion) ? disp.onion : {};
    def.display.onion.on = onion.on === true;
    def.display.onion.before = Math.round(clamp(Number(onion.before) || 1, 1, 5));
    def.display.onion.after = Math.round(clamp(Number(onion.after) || 1, 1, 5));
    def.display.onion.step = Math.round(clamp(Number(onion.step) || 1, 1, 10));
    const trail = isRecord(disp.trail) ? disp.trail : {};
    def.display.trail.on = trail.on === true;
    const km = window.SpineKeymap;
    if (km && typeof km.sanitizeSettings === "function") {
      try {
        const fixed = km.sanitizeSettings({ version: PREFS_VERSION, shortcuts: parsed.shortcuts });
        def.shortcuts = fixed && fixed.shortcuts ? fixed.shortcuts : null;
        if (fixed && Array.isArray(fixed.issues) && fixed.issues.length && !state.prefsError) {
          state.prefsError = "快捷键配置有 " + fixed.issues.length + " 处问题：已修复/回退默认（" + fixed.issues[0].code + "）";
        }
      } catch (e) {
        def.shortcuts = null;
      }
    }
    const models = isRecord(parsed.models) ? parsed.models : {};
    for (const sig of Object.keys(models)) {
      const m = models[sig];
      if (!isRecord(m)) continue;
      def.models[sig] = {
        collapsed: Array.isArray(m.collapsed) ? m.collapsed.map(String).slice(0, 400) : [],
        search: typeof m.search === "string" ? m.search.slice(0, 120) : "",
        onlyKeyed: m.onlyKeyed === true,
        lockedRows: Array.isArray(m.lockedRows) ? m.lockedRows.map(String).slice(0, 400) : [],
        hiddenRows: Array.isArray(m.hiddenRows) ? m.hiddenRows.map(String).slice(0, 400) : [],
      };
    }
    /* task-36：ui 段容错解析（缺字段 → 默认 simple；不因缺失丢弃 layout/shortcuts/models/display） */
    const ui = isRecord(parsed.ui) ? parsed.ui : {};
    def.ui.mode = ui.mode === "advanced" ? "advanced" : "simple";
    def.ui.onboardingSeen = ui.onboardingSeen === true;
    def.ui.simpleKeysExpanded = ui.simpleKeysExpanded === true;
    def.ui.moreOpen = ui.moreOpen === true;
    def.ui.clipOpen = ui.clipOpen === true;
    def.ui.extraOpen = ui.extraOpen === true;
    def.ui.advancedSeen = ui.advancedSeen === true;
    def.ui.lastPackIndexPath =
      typeof ui.lastPackIndexPath === "string" && /(^|\/)index\.json$/.test(ui.lastPackIndexPath) && !/^([a-zA-Z]:[\\/]|\/)/.test(ui.lastPackIndexPath)
        ? ui.lastPackIndexPath.slice(0, 300)
        : null;
    def.ui.lastClipByPack = {};
    if (isRecord(ui.lastClipByPack)) {
      for (const k of Object.keys(ui.lastClipByPack).slice(0, 20)) {
        const v = ui.lastClipByPack[k];
        if (typeof v === "string") def.ui.lastClipByPack[String(k).slice(0, 300)] = v.slice(0, 120);
      }
    }
    state.prefs = def;
    return def;
  }

  function savePrefs(immediate) {
    const flush = () => {
      prefsTimer = null;
      if (!state.prefs) return;
      /* 只在写入前同步一次布局快照，避免每帧写盘 */
      captureLayoutIntoPrefs();
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
      } catch (e) {
        state.prefsError = "写入偏好失败（" + (e && e.name ? e.name : "Error") + "）：本次会话不持久化";
      }
    };
    if (prefsTimer) clearTimeout(prefsTimer);
    if (immediate) flush();
    else prefsTimer = setTimeout(flush, 200);
  }

  function captureLayoutIntoPrefs() {
    /* 初始化阶段（偏好还没应用到 state）不能回写：否则 dsOpen(false) 会把已存的布局冲成默认 */
    if (!state.prefsApplied) return;
    const p = state.prefs;
    /* task-36：ui 段（模式/引导/简单时间条/lastPack）总是写；简单模式**不覆盖**高级 layout 与显示配置 */
    /* task-41：ui 段只保留与布局无关的偏好（不再写 mode；旧配置里的 mode 读取时忽略） */
    if (p && state.ui) {
      if (!isRecord(p.ui)) p.ui = prefsDefaults().ui;
      delete p.ui.mode;
      delete p.ui.advancedSeen;
      p.ui.simpleKeysExpanded = !!state.ui.simpleKeysExpanded;
      p.ui.moreOpen = !!state.ui.moreOpen;
      p.ui.clipOpen = !!state.ui.clipOpen;
      p.ui.extraOpen = !!state.ui.extraOpen;
      p.ui.lastPackIndexPath = state.ui.lastPackIndexPath || null;
      p.ui.lastClipByPack = isRecord(state.ui.lastClipByPack) ? state.ui.lastClipByPack : {};
    }
    const tl = state.edit && state.edit.timeline;
    if (!p || !tl) return;
    if (!p.layout) p.layout = prefsDefaults().layout;
    p.layout.expanded = !!tl.expanded;
    p.layout.height = Math.round(clamp(Number(tl.height) || 280, 160, 420));
    p.layout.pxPerSec = clamp(Number(tl.pxPerSec) || 100, 20, 600);
    p.layout.scrollSec = Math.max(0, Number(tl.scrollSec) || 0);
    p.layout.snapFrames = !!tl.snapFrames;
    p.layout.fps = clamp(Number(tl.fps) || 30, 1, 240);
    p.layout.tab = tl.tab === "graph" ? "graph" : tl.tab === "frame" ? "frame" : "dopesheet";
    p.layout.graphComponent = Number(tl.graphComponent) === 1 ? 1 : 0;
    /* P2-04：显示开关随偏好落盘（localStorage），**不写任何 JSON / 模型数据** */
    if (!isRecord(p.display)) p.display = prefsDefaults().display;
    const on = (state.edit && state.edit.onion) || {};
    p.display.onion = {
      on: !!on.on,
      before: Math.round(clamp(Number(on.before) || 1, 1, 5)),
      after: Math.round(clamp(Number(on.after) || 1, 1, 5)),
      step: Math.round(clamp(Number(on.step) || 1, 1, 10)),
    };
    p.display.trail = { on: !!(state.edit && state.edit.trail && state.edit.trail.on) };
    const sig = modelSignature();
    if (!sig) return;
    if (!isRecord(p.models)) p.models = {};
    p.models[sig] = {
      collapsed: Array.from(dsCollapsedSet()).map(String).slice(0, 400),
      search: String(tl.search || "").slice(0, 120),
      onlyKeyed: !!tl.onlyKeyed,
      lockedRows: tlLockedSet().slice(0, 400),
      hiddenRows: tlHiddenSet().slice(0, 400),
    };
  }

  /** 全局 layout / 快捷键跨模型保留；模型内 collapsed/filter/lock/hidden 按签名隔离 */
  function applyPrefsToState() {
    const p = state.prefs || prefsDefaults();
    const tl = state.edit.timeline;
    const lay = p.layout || prefsDefaults().layout;
    tl.height = Math.round(clamp(Number(lay.height) || 280, 160, 420));
    tl.pxPerSec = clamp(Number(lay.pxPerSec) || 100, 20, 600);
    tl.snapFrames = !!lay.snapFrames;
    tl.fps = clamp(Number(lay.fps) || 30, 1, 240);
    tl.tab = lay.tab === "graph" ? "graph" : lay.tab === "frame" ? "frame" : "dopesheet";
    tl.graphComponent = Number(lay.graphComponent) === 1 ? 1 : 0;
    tl.scrollSec = Math.max(0, Number(lay.scrollSec) || 0);
    tl.expanded = !!lay.expanded;
    /* P2-04：显示开关恢复（旧配置无 display 段 ⇒ 默认关闭，不报错） */
    const disp2 = isRecord(p.display) ? p.display : prefsDefaults().display;
    const oni = isRecord(disp2.onion) ? disp2.onion : {};
    state.edit.onion.on = oni.on === true;
    state.edit.onion.before = Math.round(clamp(Number(oni.before) || 1, 1, 5));
    state.edit.onion.after = Math.round(clamp(Number(oni.after) || 1, 1, 5));
    state.edit.onion.step = Math.round(clamp(Number(oni.step) || 1, 1, 10));
    state.edit.trail.on = isRecord(disp2.trail) ? disp2.trail.on === true : false;
    state.edit.trail.cached = false;
    /* P2-03：轴心补偿不持久化（保守复位为关） */
    state.edit.pivotCompensate = false;
    state.edit.lastPivot = null;
    const sig = modelSignature();
    const bucket = sig && isRecord(p.models) ? p.models[sig] : null;
    if (bucket) {
      const set = dsCollapsedSet();
      set.clear();
      for (const k of bucket.collapsed || []) set.add(String(k));
      tl.search = String(bucket.search || "");
      tl.onlyKeyed = !!bucket.onlyKeyed;
      tl.lockedRows = Array.isArray(bucket.lockedRows) ? bucket.lockedRows.slice(0, 400) : [];
      tl.hiddenRows = Array.isArray(bucket.hiddenRows) ? bucket.hiddenRows.slice(0, 400) : [];
    } else {
      const set = dsCollapsedSet();
      set.clear();
      tl.search = "";
      tl.onlyKeyed = false;
      tl.lockedRows = [];
      tl.hiddenRows = [];
    }
    /* 模型切换：保留布局，但清选择 / 草稿驱动的选择集 / 剪贴板外的瞬态 */
    state.edit.timeline.selection = { items: [], primary: null };
    state.edit.timeline.selectedKey = null;
    state.edit.timeline.graphRowKey = null;
    const panel = el0("dopesheet");
    if (panel) {
      panel.style.height = tl.height + "px";
      panel.hidden = !tl.expanded;
    }
    if (el0("dsCanvas")) el0("dsCanvas").hidden = tl.tab === "graph";
    if (el0("graphCanvas")) el0("graphCanvas").hidden = tl.tab !== "graph";    const b1 = el0("dsTabDope");
    const b2 = el0("dsTabGraph");
    const b0 = el0("dsTabFrame");
    if (b0) b0.setAttribute("aria-pressed", tl.tab === "frame" ? "true" : "false");
    if (b1) b1.setAttribute("aria-pressed", tl.tab === "dopesheet" ? "true" : "false");
    if (b2) b2.setAttribute("aria-pressed", tl.tab === "graph" ? "true" : "false");
    const btn = el0("btnDopesheet");
    if (btn) btn.setAttribute("aria-pressed", tl.expanded ? "true" : "false");
    if (tl.expanded) {
      dsSyncBars();
      dsDraw();
      if (tl.tab === "graph") graphDraw();
    }
    /* 应用完成：之后才允许回写 localStorage */
    state.prefsApplied = true;
  }

  /** 骨架签名（骨名/父链 + 槽名）：用于按模型隔离行配置 */
  function modelSignature() {
    const m = state.model;
    if (!m) return "";
    if (state.signatureCache && state.signatureCache.model === m) return state.signatureCache.sig;
    const parts = [];
    for (let i = 0; i < m.bones.length; i++) {
      const b = m.bones[i];
      parts.push(String(b.name) + (b.parentIndex >= 0 && m.bones[b.parentIndex] ? ">" + m.bones[b.parentIndex].name : ""));
    }
    for (let i = 0; i < m.slots.length; i++) parts.push("slot:" + String(m.slots[i].name));
    const text = parts.join("|");
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const sig = ((h >>> 0).toString(36) + "-" + m.bones.length + "-" + m.slots.length);
    state.signatureCache = { model: m, sig: sig };
    return sig;
  }

  /* ---- 选择集（契约 §2/§3：{kind:bone|slot, owner, field, time}，去重） ---- */

  function dsSelection() {
    const tl = state.edit.timeline;
    if (!tl.selection || !Array.isArray(tl.selection.items)) tl.selection = { items: [], primary: null };
    return tl.selection;
  }

  function selIdOf(item) {
    if (!item) return "";
    return String(item.kind) + ":" + String(item.owner) + ":" + String(item.field) + "@" + round(item.time, 6);
  }

  function selRowKeyOf(item) {
    return String(item.kind) + ":" + String(item.owner) + ":" + String(item.field);
  }

  function selIndexOf(items, item) {
    const id = selIdOf(item);
    for (let i = 0; i < items.length; i++) if (selIdOf(items[i]) === id) return i;
    return -1;
  }

  function selectionContains(item) {
    return selIndexOf(dsSelection().items, item) >= 0;
  }

  function selectionSet(items, primary) {
    const out = [];
    for (const it of items || []) if (it && selIndexOf(out, it) < 0) out.push({ kind: it.kind, owner: it.owner, field: it.field, time: round(it.time, 6) });
    out.sort((a, b) => (selRowKeyOf(a) < selRowKeyOf(b) ? -1 : selRowKeyOf(a) > selRowKeyOf(b) ? 1 : a.time - b.time));
    const sel = dsSelection();
    sel.items = out;
    sel.primary = primary ? { kind: primary.kind, owner: primary.owner, field: primary.field, time: round(primary.time, 6) } : out.length ? out[0] : null;
    /* 单选时同步旧 selectedKey（Delete/Graph/状态栏都读它） */
    state.edit.timeline.selectedKey = sel.primary
      ? { rowKey: selRowKeyOf(sel.primary), owner: sel.primary.owner, field: sel.primary.field, kind: sel.primary.kind, time: sel.primary.time }
      : null;
    const del = el0("dsDelete");
    if (del) del.disabled = !sel.primary;
    return sel;
  }

  function selectionToggle(item, additive) {
    const sel = dsSelection();
    if (!additive) {
      selectionSet([item], item);
      return dsSelection();
    }
    const items = sel.items.slice();
    const i = selIndexOf(items, item);
    if (i >= 0) items.splice(i, 1);
    else items.push(item);
    selectionSet(items, i >= 0 ? items[items.length - 1] || null : item);
    return dsSelection();
  }

  function selectionAddRange(from, to) {
    /* from/to 为 {row, index}；按显示行序 + 行内时间范围取矩形 */
    const lib = timelineLib();
    const rows = dsView().rows;
    if (!lib || !from || !to) return dsSelection();
    let i0 = rows.indexOf(from.row);
    let i1 = rows.indexOf(to.row);
    if (i0 < 0 || i1 < 0) return dsSelection();
    if (i0 > i1) [i0, i1] = [i1, i0];
    const out = [];
    for (let i = i0; i <= i1; i++) {
      const row = rows[i];
      if (!row || row.kind === "group" || row.filtered || row.hidden) continue;
      for (const key of row.keys || []) {
        if (key.time + 1e-9 < Math.min(from.time, to.time)) continue;
        if (key.time - 1e-9 > Math.max(from.time, to.time)) continue;
        out.push({ kind: row.kind, owner: row.owner, field: row.field, time: key.time });
      }
    }
    return selectionSet(out, to.row ? { kind: to.row.kind, owner: to.row.owner, field: to.row.field, time: to.time } : null);
  }

  /**
   * 批量编辑只支持骨/槽轨道（SpineBatchEdit.resolveTrack 的约定）；
   * P2 额外轨道（事件/绘制顺序/形变/约束）的 Key 不参与批量 —— 直接丢弃并记录数量，
   * 由调用方给一次提示，避免整批因为一条额外轨道被拒。
   */
  function selectionItemsForBatch() {
    const out = [];
    let skipped = 0;
    for (const it of dsSelection().items) {
      if (it.kind !== "bone" && it.kind !== "slot") {
        skipped++;
        continue;
      }
      out.push({ kind: it.kind, owner: it.owner, field: it.field, time: it.time });
    }
    state.batchSkippedExtras = skipped;
    return out;
  }

  function selectionStatusText() {
    const sel = dsSelection();
    return sel.items.length + " 个 Key" + (sel.primary ? "（主 " + sel.primary.owner + "/" + sel.primary.field + "@" + round(sel.primary.time, 4) + "s）" : "");
  }

  /* ---- 批量编辑（契约 §2/§3：全部走 SpineBatchEdit.planKeyBatch，整批预检/一次写回） ---- */

  function batchLib() {
    return window.SpineBatchEdit || null;
  }

  /** batch-edit 的 selectionAfter 是数组（move/paste/delete 各自形态），统一成选择集 */
  function selectionAfterOf(res) {
    const sa = res && res.selectionAfter;
    if (Array.isArray(sa)) return sa;
    if (sa && Array.isArray(sa.items)) return sa.items;
    return [];
  }

  function batchGateAndRun(opts, label) {
    const lib = batchLib();
    const name = state.anim || state.animEdit.sel;
    const raw = name ? animDraft(name) : null;
    if (!lib || !name || !raw) {
      setStatus("批量编辑不可用：缺少动画或 SpineBatchEdit 模块", "warn");
      return null;
    }
    const sel = dsSelection();
    if (!sel.items.length) {
      setStatus("先选中至少一个 Key（Ctrl/Cmd 点选，Shift 连选，空白区拖动框选）", "warn");
      return null;
    }
    const lockedHit = [];
    for (const it of sel.items) if (tlLockedSet().indexOf(selRowKeyOf(it)) >= 0) lockedHit.push(selRowKeyOf(it));
    if (lockedHit.length) {
      setStatus("LOCKED_ROW：" + lockedHit[0] + " 已锁定，整批取消", "warn");
      return null;
    }
    const original = snapshot();
    const items = selectionItemsForBatch();
    if (!items.length) {
      setStatus("选择集里只有额外轨道（事件/绘制顺序/形变/约束）的 Key：批量仅支持骨/槽轨道，请单条编辑", "warn");
      return null;
    }
    if (state.batchSkippedExtras) {
      setStatus("批量仅处理骨/槽轨道：已跳过 " + state.batchSkippedExtras + " 个额外轨道 Key（请单条编辑）", "warn");
    }
    const res = lib.planKeyBatch(raw, Object.assign({ selection: items, lockedRows: tlLockedSet() }, opts));
    if (!res || res.ok !== true) {
      const issue = res && res.issues && res.issues[0] ? res.issues[0] : null;
      const msg = (issue && issue.code ? issue.code : "BATCH_REJECTED") + "：" + (issue && (issue.detail || issue.message) ? (issue.detail || issue.message) : (label + " 被拒绝"));
      setStatus(msg, "warn");
      notice("warn", msg);
      state.drag = null;
      return null;
    }
    if (!animSetDraft(name, res.value)) {
      setStatus("批量写回失败：草稿未更新", "warn");
      return null;
    }
    if (!commit(original)) {
      /* 内容没变（例如 delta=0）：不记历史，但仍然恢复选择 */
      const sa0 = selectionAfterOf(res);
      selectionSet(sa0, sa0.length ? sa0[0] : null);
      animSetDraftRefresh();
      return res;
    }
    const sa = selectionAfterOf(res);
    if (sa.length || (res.selectionAfter && typeof res.selectionAfter === "object" && res.selectionAfter.primary)) {
      selectionSet(sa, (res.selectionAfter && res.selectionAfter.primary) || (sa.length ? sa[0] : null));
    }
    if (res.duration !== undefined && Number.isFinite(res.duration)) {
      state.animDur = Math.max(res.duration, animDuration(name));
      if (state.t > state.animDur) state.t = state.animDur;
      updateTimeLabel();
    }
    setStatus(label + " 完成：" + selectionStatusText() + (res.counts ? "（" + JSON.stringify(res.counts) + "）" : ""));
    animSetDraftRefresh();
    return res;
  }

  function dsBatchMove(deltaSec) {
    if (!Number.isFinite(deltaSec) || Math.abs(deltaSec) < 1e-9) return null;
    return batchGateAndRun({ op: "move", delta: deltaSec }, "批量移动 " + round(deltaSec, 4) + "s");
  }

  function dsBatchDelete() {
    return batchGateAndRun({ op: "delete" }, "批量删除");
  }

  function dsCopySelection() {
    const lib = batchLib();
    const name = state.anim || state.animEdit.sel;
    const raw = name ? animDraft(name) : null;
    const sel = dsSelection();
    if (!lib || !raw) return setStatus("没有可复制的动画", "warn");
    if (!sel.items.length) return setStatus("先选中要复制的 Key", "warn");
    const res = lib.clipboardFromSelection(raw, selectionItemsForBatch(), {
      sourceAnimation: name,
      skeletonSignature: modelSignature(),
    });
    if (!res || res.ok !== true) {
      const code = res && res.issues && res.issues[0] ? res.issues[0].code : "CLIPBOARD_FAILED";
      return setStatus(code + "：复制被拒绝", "warn");
    }
    state.clipboard = res.value;
    const n = state.clipboard && Array.isArray(state.clipboard.items) ? state.clipboard.items.length : 0;
    setStatus("已复制 " + n + " 个 Key（源动画 " + name + "，内存剪贴板）");
    return res;
  }

  function dsPasteClipboard(atTime) {
    const lib = batchLib();
    if (!state.clipboard) return setStatus("剪贴板为空：先 Ctrl+C 复制 Key", "warn");
    const anchor = Number.isFinite(atTime) ? atTime : state.t;
    let anchorSnap = anchor;
    if (state.edit.timeline.snapFrames && timelineLib()) {
      anchorSnap = timelineLib().snapTime({ time: anchor, fps: state.edit.timeline.fps, enabled: true });
    }
    return batchGateAndRun(
      {
        op: "paste",
        clipboard: state.clipboard,
        atTime: anchorSnap,
        skeletonSignature: modelSignature(),
        collision: "overwrite",
        snap: { enabled: !!state.edit.timeline.snapFrames, fps: state.edit.timeline.fps },
      },
      "粘贴到 " + round(anchorSnap, 4) + "s"
    );
  }

  /**
   * 规划书 §5.3「全身姿态关键帧」：对一批骨骼批量记录当前姿态。
   *
   * §5.3 原文要求「全身记录必须提供范围确认，避免产生不必要的大量关键帧」，
   * 所以这里**先问范围**（可见骨 / 全部骨 / 仅已选骨），确认后才写。
   *
   * 只记录**实际有变化**的属性：调用方可以传 fieldsByBone；不传时按
   * 「相对 setup 的当前求值值」与「该轨在此时刻已有的 Key（或插值结果）」比较，
   * 跳过没有差异的属性 —— 避免一次造出 骨数×3 个无意义的 Key。
   *
   * @param {{scope:"visible"|"all"|"selected", fields?:string[], atTime?:number}} opts
   * @returns {{ok:boolean, written:number, skipped:number, bones:string[], reason?:string}}
   */
  function keyFullPose(opts) {
    const o = isRecord(opts) ? opts : {};
    const name = state.anim || state.animEdit.sel;
    if (!name) return { ok: false, written: 0, skipped: 0, bones: [], reason: "当前没有选中的动画" };
    if (editMode() !== "animate") return { ok: false, written: 0, skipped: 0, bones: [], reason: "全身姿态打键需要「动画」模式" };
    if (state.playing) return { ok: false, written: 0, skipped: 0, bones: [], reason: "播放中：先暂停再打键" };
    const lib = animEditLib();
    if (!lib) return { ok: false, written: 0, skipped: 0, bones: [], reason: "anim-edit.js 未加载" };
    const t = typeof o.atTime === "number" && isFinite(o.atTime) ? o.atTime : state.t;
    const fields = Array.isArray(o.fields) && o.fields.length ? o.fields.slice() : ["rotate", "translate", "scale"];
    const names = poseTargetBones(o.scope);
    if (!names.length) return { ok: false, written: 0, skipped: 0, bones: [], reason: "该范围内没有可打键的骨骼" };
    const before = snapshot();
    let written = 0;
    let skipped = 0;
    const touched = [];
    const insp = keyInspLib();
    for (const boneName of names) {
      let wrote = false;
      for (const f of fields) {
        const cur = animCurrentValues(boneName, f);
        if (!cur || !cur.ok) {
          skipped++;
          continue;
        }
        /* 差异判定走纯模块 key-inspector.needsFullPoseKey（与 selftest 同一套逻辑）：
           没有既有 Key → 必须写；有既有 Key 且值相同 → 跳过。 */
        const existing = animValueAtTime(name, boneName, f, t);
        const verdict = insp
          ? insp.needsFullPoseKey({ field: f, next: cur.values, current: existing })
          : { ok: true, needed: !existing || !sameFieldValues(f, existing, cur.values) };
        if (!verdict.ok || !verdict.needed) {
          skipped++;
          continue;
        }
        const up = lib.upsertKey(animDraft(name), "bones", boneName, f, cur.values, t);
        if (up && up.ok) {
          animSetDraft(name, up.value, { resetDur: false });
          written++;
          wrote = true;
        } else {
          skipped++;
        }
      }
      if (wrote) touched.push(boneName);
    }
    if (!written) {
      setStatus("全身姿态：范围内 " + names.length + " 根骨在当前时刻都已是最新值，无需打键", "warn");
      return { ok: true, written: 0, skipped: skipped, bones: [] };
    }
    if (commit(before)) {
      setStatus("全身姿态关键帧：已写入 " + written + " 个属性 Key（" + touched.length + "/" + names.length + " 根骨）@" + round(t, 3) + "s");
      animSetDraftRefresh();
    }
    return { ok: true, written: written, skipped: skipped, bones: touched };
  }

  /** 全身姿态的作用范围 → 骨名列表（§5.3 的「当前选中骨 / 可见骨 / 全部骨」） */
  function poseTargetBones(scope) {
    const all = state.model ? state.model.bones.map((b) => b.name).filter((n) => typeof n === "string" && n) : [];
    if (scope === "selected") return state.edit.selBone ? [state.edit.selBone] : [];
    if (scope === "visible") {
      /* 可见 = 当前显示层里能看到的槽所挂的骨；没有可见槽时退回全部骨 */
      const set = new Set();
      for (const s of state.slots || []) {
        if (!s || !s.boneName) continue;
        if (state.hidden && state.hidden.has(s.name)) continue;
        set.add(s.boneName);
      }
      const out = all.filter((n) => set.has(n));
      return out.length ? out : all;
    }
    return all;
  }

  /** 该轨在时刻 t 的现有值（有 Key 用 Key，没有则返回 null 表示「无既有值」） */
  function animValueAtTime(animName, boneName, field, t) {
    const raw = animDraft(animName);
    if (!raw || !raw.bones || !raw.bones[boneName]) return null;
    const list = raw.bones[boneName][field];
    if (!Array.isArray(list)) return null;
    for (const k of list) {
      if (!k || !Number.isFinite(k.time)) continue;
      if (Math.abs(k.time - t) > 1e-6) continue;
      if (field === "rotate") return { value: Number.isFinite(k.value) ? k.value : 0 };
      return { x: Number.isFinite(k.x) ? k.x : 0, y: Number.isFinite(k.y) ? k.y : 0 };
    }
    return null;
  }

  /** 两个字段值是否等价（rotate 比 value；vec2 比 x/y） */
  function sameFieldValues(field, a, b) {
    if (!a || !b) return false;
    if (field === "rotate") {
      return Number.isFinite(a.value) && Number.isFinite(b.value) && Math.abs(a.value - b.value) <= 1e-6;
    }
    return (
      Number.isFinite(a.x) && Number.isFinite(b.x) && Math.abs(a.x - b.x) <= 1e-6 &&
      Number.isFinite(a.y) && Number.isFinite(b.y) && Math.abs(a.y - b.y) <= 1e-6
    );
  }

  /** 全身姿态的交互入口：先问范围（§5.3 硬要求），再调用 keyFullPose */
  async function keyFullPoseInteractive() {
    const name = state.anim || state.animEdit.sel;
    if (!name) return setStatus("全身姿态打键需要先载入动画", "warn");
    if (editMode() !== "animate") return setStatus("全身姿态打键需要「动画」模式", "warn");
    if (state.playing) return setStatus("播放中：先暂停再打键", "warn");
    const counts = {
      selected: state.edit.selBone ? 1 : 0,
      visible: poseTargetBones("visible").length,
      all: poseTargetBones("all").length,
    };
    const t = state.t;
    const frame = Math.round(t * tlFps());
    const choice = await simpleConfirm({
      title: "全身姿态关键帧",
      message:
        "在帧 " + frame + "（" + round(t, 3) + "s）为一批骨骼记录当前姿态的 rotate / translate / scale。" +
        "只会写入与现有值不同的属性。",
      hint:
        "规划书 §5.3：全身记录必须提供范围确认，避免产生不必要的大量关键帧。" +
        "最多 " + counts.all + " 根骨 × 3 个属性 = " + counts.all * 3 + " 个 Key（实际只写有变化的）。",
      actions: [
        { label: "可见骨（" + counts.visible + "）", value: "visible", primary: true },
        { label: "全部骨（" + counts.all + "）", value: "all" },
        { label: "仅已选骨（" + counts.selected + "）", value: "selected", disabled: !counts.selected },
        { label: "取消", value: null },
      ],
    });
    if (!choice) return null;
    return keyFullPose({ scope: choice });
  }

  function dsSelectAll() {
    if (!dsActivate()) return;
    const rows = dsView().rows;
    const items = [];
    for (const row of rows) {
      if (!row || row.kind === "group" || row.filtered || row.hidden) continue;
      for (const key of row.keys || []) items.push({ kind: row.kind, owner: row.owner, field: row.field, time: key.time });
    }
    selectionSet(items, items[0] || null);
    setStatus("已全选可见 Key：" + selectionStatusText());
    dsDraw();
    graphDraw();
  }

  /**
   * 规划书 §6「Duplicate Key」：把当前选择复制到**下一帧**位置。
   * 整批一条事务；目标帧已有同轨 Key 时按 overwrite 覆盖。
   * 与 Ctrl+C/Ctrl+V 的区别：不经过剪贴板、不改用户剪贴板内容。
   *
   * 重要：**无选择时不猜**。早期实现在没有选择时退化成「复制当前帧全部 Key」，
   * 实测在 0–30 帧范围内一次就造出 91 个 Key —— 那不是 Duplicate，是批量克隆。
   * 现在无选择时明确拒绝并提示先选中，避免误操作。
   */
  function fsDuplicateKey() {
    const lib = frameTimelineLib();
    if (!lib) return setStatus("帧模块未加载", "warn");
    const name = state.anim || state.animEdit.sel;
    if (!name) return setStatus("复制副本需要先载入动画", "warn");
    const fps = tlFps();
    const sel = dsSelection();
    const items = sel.items.slice();
    if (!items.length) {
      setStatus("复制副本：先在时间轴上选中要复制的 Key（或先点一下关键帧）", "warn");
      notice("warn", "Ctrl+D 只复制**已选中的** Key。当前没有选中任何 Key，已拒绝执行，避免一次造出大量副本。");
      return null;
    }
    const baseFrame = Math.min.apply(null, items.map((it) => lib.frameAtTime(it.time, fps)));
    const toFrame = baseFrame + 1;
    const toTime = lib.frameToTime(toFrame, fps);
    const res = batchGateAndRun(
      { op: "paste", clipboard: makeDupClipboard(items), atTime: toTime, skeletonSignature: modelSignature(), collision: "overwrite", snap: { enabled: true, fps: fps } },
      "复制副本到第 " + toFrame + " 帧"
    );
    if (res) setStatus("已把 " + items.length + " 个 Key 复制到第 " + toFrame + " 帧（" + round(toTime, 3) + "s）");
    return res;
  }

  /** 用当前选择临时拼一个剪贴板（不动 state.clipboard） */
  function makeDupClipboard(items) {
    const lib = batchLib();
    const name = state.anim || state.animEdit.sel;
    const raw = name ? animDraft(name) : null;
    if (!lib || !raw) return null;
    const r = lib.clipboardFromSelection(raw, items, { sourceAnimation: name, skeletonSignature: modelSignature() });
    return r && r.ok ? r.value : null;
  }

  /**
   * 规划书 §3.4「复制帧范围」：只把**帧范围内**的关键帧放进选择集再复制。
   * 与 Ctrl+A 的区别是范围受限；与「粘贴姿态」的区别见 fsPastePoseAt。
   */
  function fsCopyFrameRange() {
    const lib = frameTimelineLib();
    if (!lib) return setStatus("帧模块未加载", "warn");
    const r = fsRangeFrames();
    const count = Math.max(1, r.end - r.start + 1);
    const rows = dsBuild().rows || [];
    const q = lib.keysInFrameRange(rows, r.start, count, tlFps());
    if (!q.ok) return setStatus(q.issues[0].message, "warn");
    if (!q.count) return setStatus("帧范围 " + r.start + "–" + r.end + " 内没有关键帧可复制", "warn");
    const items = q.keys.map((hit) => ({ kind: hit.row.kind, owner: hit.row.owner, field: hit.row.field, time: hit.time }));
    selectionSet(items, items[0] || null);
    const res = dsCopySelection();
    if (res && res.ok) {
      setStatus("已复制帧范围 " + r.start + "–" + r.end + " 内的 " + items.length + " 个 Key（内存剪贴板）");
      dsDraw();
      graphDraw();
    }
    return res;
  }

  /**
   * 规划书 §6.1「Copy Pose / Paste Pose」：读取**当前时间**的完整骨骼姿态，
   * 把它作为关键帧写到目标时间。必须与「复制关键帧」明确区分 ——
   * 复制姿态不依赖目标帧原本有没有 Key，而是按当前求值姿态重新打键。
   *
   * 只对**当前选中骨**（或调用方给定的骨列表）记录，避免「一键给全身造 Key」
   * （规划书 §5.3 要求全身记录必须有范围确认）。
   * @param {number} atTime 目标时间（秒）
   * @param {string[]} [boneNames] 缺省 = 当前选中骨
   */
  function fsPastePoseAt(atTime, boneNames) {
    const name = state.anim || state.animEdit.sel;
    if (!name) return setStatus("粘贴姿态需要先载入动画", "warn");
    if (editMode() !== "animate") return setStatus("粘贴姿态需要「动画」模式", "warn");
    const list = Array.isArray(boneNames) && boneNames.length ? boneNames.slice() : state.edit.selBone ? [state.edit.selBone] : [];
    if (!list.length) return setStatus("先选中一根骨骼再粘贴姿态", "warn");
    const lib = frameTimelineLib();
    const t = lib ? lib.snapTime(Number.isFinite(atTime) ? atTime : state.t, tlFps()) : Number.isFinite(atTime) ? atTime : state.t;
    const before = snapshot();
    let wrote = 0;
    for (const boneName of list) {
      /* 与画布打键同一条链路：先取当前求值姿态的相对值，再 upsert */
      const fields = ["rotate", "translate", "scale"];
      for (const f of fields) {
        const res = animCurrentValues(boneName, f);
        if (!res || !res.ok) continue;
        const up = animEditLib().upsertKey(animDraft(name), "bones", boneName, f, res.values, t);
        if (up && up.ok) {
          animSetDraft(name, up.value);
          wrote++;
        }
      }
    }
    if (!wrote) return setStatus("粘贴姿态失败：没有可写入的属性", "warn");
    if (commit(before)) {
      setStatus("已在 " + round(t, 3) + "s 粘贴姿态：" + list.join("、") + "（" + wrote + " 个属性 Key）");
      animSetDraftRefresh();
      return true;
    }
    return false;
  }

  /* ---- 快捷键注册表（keymap.js，契约 §7）+ 帮助浮层里的重绑定 UI ---- */

  function keymapLib() {
    return window.SpineKeymap || null;
  }

  function keyBindings() {
    const km = keymapLib();
    if (!km) return null;
    const saved = state.prefs && state.prefs.shortcuts;
    return saved && typeof saved === "object" ? saved : km.DEFAULT_BINDINGS;
  }

  function keyContextOf() {
    const panel = el0("dopesheet");
    const open = !!(panel && !panel.hidden);
    const inTimeline = open && (state.timelineHot === true || (document.activeElement && panel.contains(document.activeElement)));
    const rows = open ? dsView().rows : [];
    return {
      scope: open ? ((state.edit.timeline.tab || "dopesheet") === "graph" ? "graph" : "timeline") : "editor",
      inTimeline: !!inTimeline,
      keySelection: dsSelection().items.length > 0,
      clipboard: !!state.clipboard,
      animation: !!state.anim,
      selectableRows: rows.some((r) => r.kind !== "group" && !r.filtered && !r.hidden),
      textInput: false,
    };
  }

/*
 * Flash 式三键：F5 普通帧 / F6 关键帧 / F7 空白帧
 *
 * 语义适配（规划书 §3.5 禁止「为模仿 Flash 引入错误的数据语义」）
 *
 *   Flash 概念        →  Spine 等价做法
 *   ───────────────────────────────────────────────────────────────────
 *   F5 普通帧（延长）   →  在目标帧写入与当前帧相同的值。两帧间插值恒定 =
 *                          视觉上姿态被延长。**不新建任何对象**，就是普通 Spine Key。
 *   F6 关键帧          →  当前帧没 Key 就打；已有 Key 则转成 F5（延长到下一帧）。
 *                          对应 Flash 里 F6 连按两次 = 关键帧 + 普通帧。
 *   F7 空白帧          →  **按轨道类型分派**（关键设计，见下）
 *
 * F7 为什么不能「一把清空」：
 *   Flash 的空白关键帧是「一个没有内容的帧对象」；Spine 的骨骼属性没有这个概念
 *   ——某帧没有 Key 只表示「继续按原插值或 Setup Pose 走」。
 *   如果 F7 直接把该骨骼当前帧的所有字段 Key 全删掉，用户会看到整条骨骼突然
 *   跳回插值结果，等于「把整个角色骨骼状态弄丢」。所以按轨道类型分派：
 *
 *     轨道类型                     F7 语义
 *     ─────────────────────────────────────────────────────────────
 *     图片附件轨道（slot.attachment）  隐藏当前附件（走 toggleHidden，不删 Key）
 *     骨骼变换轨道（rotate/translate/  **二选一**，由用户明确选择：
 *       scale/shear）                    ① 清除当前帧关键帧
 *                                        ② 重置到绑定姿态（Setup Pose）
 *     其它离散轨道（drawOrder/events）  清除当前帧该轨道 Key
 *
 *   骨骼变换轨道必须二选一，不能默认全清 —— 这是本文件与「一把清空」的核心差别。
 */

/** 从 Key 项推出 animRemoveKey 需要的 kind */
function flashKindOf(item) {
  const rk = String((item && item.rowKey) || "");
  if (rk.startsWith("bone:")) return "bones";
  if (rk.startsWith("slot:")) return "slots";
  const seg = rk.startsWith("timeline:") ? rk.slice("timeline:".length) : "";
  const head = seg.split(":")[0];
  if (head === "ik" || head === "transform" || head === "path") return head;
  if (head === "deform") return "deform";
  if (head === "events") return "events";
  if (head === "drawOrder") return "drawOrder";
  if (state.bones && state.bones[item.owner]) return "bones";
  return "bones";
}

/** 骨骼变换类字段（这些字段的 F7 必须二选一，不能直接清空） */
const FLASH_BONE_TRANSFORM_FIELDS = ["rotate", "translate", "scale", "shear", "x", "y", "rotation", "scaleX", "scaleY", "shearX", "shearY"];

/** F5/F6/F7 共同前置校验 */
function flashKeyGuard() {
  if (!state.anim) return "当前没有选中的动画";
  if (state.playing) return "播放中：先暂停";
  if (editMode() !== "animate") return "需要先切到「动画」模式";
  return null;
}

/** 取一行的所有 Key 时间。
 *  **踩过的坑**：timeline.js 的行结构是 `row.keys`（对象数组，每项有 .time），
 *  **没有 `row.keyTimes` 字段** —— `ed.timeline()` 句柄里的 keyTimes 是它自己现算的。
 *  之前直接读 row.keyTimes 得到 undefined，导致「明明有 Key 却说没有」。
 *  这里两种都兼容，避免以后再踩。 */
function flashKeyTimesOf(row) {
  if (!row) return [];
  if (Array.isArray(row.keys)) return row.keys.map((k) => (k && typeof k === "object" ? Number(k.time) : Number(k))).filter((t) => Number.isFinite(t));
  if (Array.isArray(row.keyTimes)) return row.keyTimes.filter((t) => Number.isFinite(t));
  return [];
}

/** 某时间戳是否属于「当前帧」。
 *
 *  踩过的坑（两次）：
 *  1) 真实包的 Key 不落在整数帧上：idle 的 Key 在 0.125s，×30fps = 3.75 帧；
 *  2) setPlayhead(4/30) 得到 0.13333s，而 Key 在 0.125s —— 差 0.0083s。
 *
 *  稳妥判据：**时间距离在半帧以内**就算同一帧。
 *  既容忍 Key 的小数时间，也容忍播放头停在帧边界之外一点。 */
function flashTimeOnFrame(time, frame, fps) {
  const t = Number(time);
  const f = Number(frame);
  if (!Number.isFinite(t) || !Number.isFinite(f)) return false;
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const half = 0.5 / rate;
  return Math.abs(t - f / rate) <= half;
}

/** 当前帧该骨骼已有 Key 的字段列表 */
function flashFieldsAtFrame(name, frame) {
  const fps = tlFps();
  const built = dsBuild();
  const out = [];
  for (const row of built.rows || []) {
    if (row.kind === "group" || row.owner !== name) continue;
    for (const t of flashKeyTimesOf(row)) {
      if (flashTimeOnFrame(t, frame, fps)) { out.push(row.field); break; }
    }
  }
  return out;
}

/**
 * F5 普通帧：把当前帧姿态值写到目标帧，让姿态在区间内保持。
 * @returns {{ok:boolean, reason?:string, wrote?:number, frame?:number}}
 */
function flashHoldFrame(targetFrame) {
  const guard = flashKeyGuard();
  if (guard) { setStatus(guard, "warn"); return { ok: false, reason: guard }; }
  const name = state.edit.selBone;
  if (!name) { setStatus("F5：先选中一根骨骼", "warn"); return { ok: false, reason: "NO_BONE" }; }

  const fps = tlFps();
  const fromFrame = fsCurrentFrame();
  const toFrame = Number.isFinite(targetFrame) ? Math.round(targetFrame) : fromFrame + 1;
  if (toFrame <= fromFrame) {
    setStatus("F5：目标帧必须晚于当前帧", "warn");
    return { ok: false, reason: "FRAME_ORDER" };
  }
  const have = flashFieldsAtFrame(name, fromFrame);
  if (!have.length) {
    setStatus("F5：当前帧「" + name + "」没有 Key，先按 F6 打一个", "warn");
    return { ok: false, reason: "NO_KEY_AT_CURRENT" };
  }

  const before = snapshot();
  const savedT = state.t;
  let wrote = 0;
  try {
    for (const field of have) {
      state.t = toFrame / fps;
      if (animAddBoneKey(state.anim, name, field)) wrote++;
    }
  } finally {
    state.t = savedT;
  }
  if (!wrote) {
    setStatus("F5：没有写入（目标帧可能已有相同值）", "warn");
    return { ok: false, reason: "NO_WRITE" };
  }
  commit(before);
  syncEditToolbar();
  setStatus("F5 普通帧：「" + name + "」的姿态延长到第 " + toFrame + " 帧（" + wrote + " 个字段）");
  return { ok: true, wrote: wrote, frame: toFrame };
}

/**
 * F6 关键帧：当前帧没 Key 就打；已有 Key 则按 F5 延长到下一帧。
 */
function flashKeyFrame() {
  const guard = flashKeyGuard();
  if (guard) { setStatus(guard, "warn"); return { ok: false, reason: guard }; }
  const name = state.edit.selBone;
  if (!name) { setStatus("F6：先选中一根骨骼", "warn"); return { ok: false, reason: "NO_BONE" }; }

  const frame = fsCurrentFrame();
  const have = flashFieldsAtFrame(name, frame);
  if (have.length) return flashHoldFrame(frame + 1);
  const ok = keySelectedBone();
  return { ok: !!ok, mode: "key", frame: frame };
}

/**
 * F7 的「意图探测」：告诉调用方当前上下文该走哪条分支，不写数据。
 * UI 用它决定「直接执行」还是「弹二选一」。
 * @returns {{ok:boolean, kind:string, reason?:string, options?:string[], frame?:number, target?:object}}
 *   kind: "attachment" | "boneTransform" | "discrete" | "none"
 */
function flashBlankIntent() {
  const guard = flashKeyGuard();
  if (guard) return { ok: false, kind: "none", reason: guard };
  const frame = fsCurrentFrame();
  const fps = tlFps();
  const name = state.edit.selBone;

  /* 1) 优先看时间轴 Key 选择：选中什么就作用于什么 */
  const sel = dsSelection();
  if (sel.items && sel.items.length) {
    const it = sel.items[0];
    const field = String(it.field || "");
    const rk = String(it.rowKey || "");
    if (rk.startsWith("slot:") && /attachment/i.test(field)) {
      return { ok: true, kind: "attachment", frame: frame, target: it };
    }
    if (rk.startsWith("bone:") && FLASH_BONE_TRANSFORM_FIELDS.indexOf(field) >= 0) {
      return { ok: true, kind: "boneTransform", frame: frame, target: it, options: ["clearKeys", "resetSetup"] };
    }
    return { ok: true, kind: "discrete", frame: frame, target: it };
  }

  /* 2) 没选 Key：按「当前帧 + 当前骨骼」推断 */
  if (!name) return { ok: false, kind: "none", reason: "没有选中骨骼或 Key" };
  const built = dsBuild();
  const rowsHere = [];
  for (const row of built.rows || []) {
    if (row.kind === "group" || row.owner !== name) continue;
    for (const t of flashKeyTimesOf(row)) {
      if (flashTimeOnFrame(t, frame, fps)) { rowsHere.push({ owner: row.owner, field: row.field, time: t, rowKey: row.rowKey }); break; }
    }
  }
  if (!rowsHere.length) return { ok: false, kind: "none", reason: "当前帧没有可操作的 Key", frame: frame };

  const anyBone = rowsHere.some((r) => FLASH_BONE_TRANSFORM_FIELDS.indexOf(String(r.field)) >= 0);
  if (anyBone) {
    return {
      ok: true, kind: "boneTransform", frame: frame, target: rowsHere[0],
      targets: rowsHere, options: ["clearKeys", "resetSetup"],
    };
  }
  return { ok: true, kind: "discrete", frame: frame, target: rowsHere[0], targets: rowsHere };
}

/**
 * F7 空白帧 —— 按轨道类型分派。
 * @param {{mode?:string}} opts
 *   mode = "clearKeys"   清除当前帧关键帧（骨骼变换轨道需显式指定）
 *   mode = "resetSetup"  重置到绑定姿态（骨骼变换轨道需显式指定）
 *   mode 缺省：附件轨道直接隐藏；离散轨道直接清除；骨骼变换轨道**拒绝执行并返回需要选择**
 * @returns {{ok:boolean, kind?:string, needChoice?:boolean, reason?:string, ...}}
 */
function flashBlankFrame(opts) {
  const o = opts || {};
  const intent = flashBlankIntent();
  if (!intent.ok) {
    setStatus("F7：" + (intent.reason || "无法操作"), "warn");
    return { ok: false, reason: intent.reason, kind: intent.kind };
  }

  /* ---- 图片附件轨道：隐藏当前附件（不删 Key） ---- */
  if (intent.kind === "attachment") {
    const slotName = intent.target ? intent.target.owner : null;
    const idx = slotName ? state.slots.findIndex((s) => s.name === slotName) : -1;
    if (idx < 0) {
      setStatus("F7：找不到附件所属的槽位", "warn");
      return { ok: false, reason: "SLOT_NOT_FOUND", kind: "attachment" };
    }
    const before = snapshot();
    toggleHidden(idx);
    commit(before);
    syncEditToolbar();
    setStatus("F7 空白帧：隐藏附件「" + slotName + "」（附件轨道用隐藏表示空白，不删 Key）");
    return { ok: true, kind: "attachment", slot: slotName, hidden: state.hidden.has(slotName) };
  }

  /* ---- 骨骼变换轨道：必须二选一，不能默认全清 ---- */
  if (intent.kind === "boneTransform") {
    const mode = String(o.mode || "");
    if (mode !== "clearKeys" && mode !== "resetSetup") {
      setStatus("F7：骨骼变换轨道需要选择「清除关键帧」或「重置到绑定姿态」", "warn");
      /* 用带按钮的提示条做二选一：骨骼变换轨道的空白帧有两种含义，
         必须让用户明确选择，避免一次 F7 就把骨骼状态弄丢。 */
      notice("warn", "F7 空白帧：骨骼变换轨道有两种含义，请选择", [
        {
          label: "清除当前帧关键帧",
          onClick: () => { clearNotices(); flashBlankFrame({ mode: "clearKeys" }); },
        },
        {
          label: "重置到绑定姿态",
          onClick: () => { clearNotices(); flashBlankFrame({ mode: "resetSetup" }); },
        },
      ], { verbatim: true });
      return {
        ok: false, kind: "boneTransform", needChoice: true,
        options: ["clearKeys", "resetSetup"], frame: intent.frame,
        message: "骨骼变换轨道的空白帧有两种含义，请明确选择（避免一次 F7 就把骨骼状态弄丢）",
      };
    }
    if (mode === "resetSetup") {
      /* 重置到绑定姿态：把当前帧的骨骼变换 Key 写成 Setup Pose 的值。
         **数据来源**：绑定姿态在 state.model.bones[]（原始模型）。
         **关键**：animAddBoneKey 取的是「当前预览值」(lastPose.local)，不会读 modelBone，
         所以必须先把 state.bones[name] 临时设成绑定值、重算姿态、再打键，最后恢复。 */
      const name = state.edit.selBone || (intent.target && intent.target.owner);
      const modelBone = name && state.model && Array.isArray(state.model.bones)
        ? state.model.bones.find((b) => b && b.name === name)
        : null;
      if (!modelBone) {
        setStatus("F7：在模型里找不到骨骼「" + name + "」", "warn");
        return { ok: false, reason: "BONE_NOT_FOUND", kind: "boneTransform" };
      }
      const live = state.bones ? state.bones[name] : null;
      if (!live) {
        setStatus("F7：运行时骨骼表里没有「" + name + "」", "warn");
        return { ok: false, reason: "BONE_NOT_FOUND", kind: "boneTransform" };
      }
      const before = snapshot();
      const savedT = state.t;
      const wroteFields = [];
      const lib = animEditLib();
      /* **必须深拷贝**：animDraft() 在还没有草稿时返回 raw[name] 的**活引用**，
         原地修改会连带改掉 before 快照，导致 commit() 认为「没有变化」而不写历史
         （实测症状：F7 重置后 undo 栈为空、Ctrl+Z 撤不回来）。 */
      const draftSrc = animDraft(state.anim);
      const draft = draftSrc ? JSON.parse(JSON.stringify(draftSrc)) : null;
      if (!lib || !draft) {
        setStatus("F7：动画草稿不可用", "warn");
        return { ok: false, reason: "NO_DRAFT", kind: "boneTransform" };
      }
      /* 「重置到绑定姿态」的 Key 相对值就是**中性值**：
         因为 relativeValues 算的是 (当前姿态 − setup)，当前姿态 == setup 时
         旋转/位移 = 0、缩放倍率 = 1、剪切 = 0。
         直接把 local 设成 setup 的副本交给 relativeValues，语义最准确，
         也避免自己手写一套「中性值」常量（那样两处容易漂移）。 */
      const neutral = Object.assign({}, modelBone);
      const diag = [];
      /* **命名体系不同，必须分开**（实测抓到的坑）：
         · 轨道名（upsertKey 用）：rotate / translate / scale / shear
         · 模型原始字段（model.bones[] 用）：rotation / x,y / scaleX,scaleY / shearX,shearY
         之前只用一个数组，导致 "rotate" in modelBone === false，全部 skip。 */
      const FIELD_MAP = [
        { track: "rotate", model: ["rotation"] },
        { track: "translate", model: ["x", "y"] },
        { track: "scale", model: ["scaleX", "scaleY"] },
        { track: "shear", model: ["shearX", "shearY"] },
      ];
      try {
        state.t = (intent.frame || 0) / tlFps();
        for (const fm of FIELD_MAP) {
          /* 模型里至少有一个对应原始字段才写这条轨道 */
          if (!fm.model.some((k) => k in modelBone)) { diag.push(fm.track + ":skip(notInModel)"); continue; }
          const rel = lib.relativeValues(fm.track, neutral, modelBone);
          if (!rel.ok) { diag.push(fm.track + ":relFail=" + (rel.issues && rel.issues[0] ? rel.issues[0].code : "?")); continue; }
          const up = lib.upsertKey(draft, "bones", name, fm.track, rel.values, state.t);
          if (!up.ok) { diag.push(fm.track + ":upsertFail=" + (up.issues && up.issues[0] ? up.issues[0].code + "/" + up.issues[0].message : "?")); continue; }
          Object.keys(up.value).forEach((k) => { draft[k] = up.value[k]; });
          wroteFields.push(fm.track);
          diag.push(fm.track + ":ok");
        }
      } finally {
        state.t = savedT;
      }
      if (!wroteFields.length) {
        setStatus("F7：重置绑定姿态没有写入（" + diag.join(" ") + "）", "warn");
        return { ok: false, reason: "NO_WRITE", kind: "boneTransform", diag: diag };
      }
      animSetDraft(state.anim, draft);
      commit(before);
      syncEditToolbar();
      setStatus("F7 空白帧：「" + name + "」重置到绑定姿态（第 " + intent.frame + " 帧，" + wroteFields.join("/") + "）");
      return { ok: true, kind: "boneTransform", mode: "resetSetup", wrote: wroteFields.length, fields: wroteFields, frame: intent.frame };
    }
    /* mode === clearKeys：落到下面的通用清除分支 */
  }

  /* ---- 通用清除（离散轨道 / 明确选了 clearKeys 的骨骼轨道） ---- */
  const targets = intent.targets || (intent.target ? [intent.target] : []);
  if (!targets.length) {
    setStatus("F7：当前帧没有可清空的 Key", "warn");
    return { ok: false, reason: "NO_TARGET", kind: intent.kind };
  }
  const before = snapshot();
  let removed = 0;
  for (const it of targets) {
    if (animRemoveKey(state.anim, flashKindOf(it), it.owner, it.field, it.time)) removed++;
  }
  if (!removed) {
    setStatus("F7：没有删除任何 Key", "warn");
    return { ok: false, reason: "NO_REMOVE", kind: intent.kind };
  }
  state.edit.timeline.selection = { items: [], primary: null };
  state.edit.timeline.selectedKey = null;
  commit(before);
  syncEditToolbar();
  setStatus("F7 空白帧：清除第 " + intent.frame + " 帧的 " + removed + " 个 Key（" + intent.kind + "）");
  return { ok: true, kind: intent.kind, mode: "clearKeys", removed: removed, frame: intent.frame };
}

  const KEYMAP_RUN = {
    translate: () => (editTarget() === "bone" ? setEditTool("translate") : setTool("move")),
    rotate: () => editTarget() === "bone" && setEditTool("rotate"),
    scale: () => editTarget() === "bone" && setEditTool("scale"),
    pose: () => editTarget() === "bone" && setEditTool("pose"),
    key: () => (editTarget() === "bone" && state.edit.selBone ? keySelectedBone() : setStatus("先选骨骼再打键", "warn")),
    /* Flash 式三键：F5 普通帧 / F6 关键帧 / F7 空白帧 */
    frameHold: () => flashHoldFrame(),
    frameKey: () => flashKeyFrame(),
    frameBlank: () => flashBlankFrame(),
    delete: () => dsDeleteSelected(),
    copy: () => dsCopySelection(),
    /* 剪切 = 复制 + 删除（与右键菜单 cutKey 同一套动作，避免两处行为漂移） */
    cut: () => {
      const res = dsCopySelection();
      if (res && res.ok) dsDeleteSelected();
      return res;
    },
    paste: () => dsPasteClipboard(state.t),
    selectAll: () => dsSelectAll(),
    play: () => togglePlay(),
    undo: () => undo(),
    redo: () => redo(),
    timeline: () => dsOpen(),
    save: () => saveToDisk(),
    help: () => toggleHelp(),
  };

  /** 返回 true 表示已处理（只执行一次，成功才 preventDefault） */
  function tryKeymapAction(e) {
    const km = keymapLib();
    if (!km || state.keyCapture) return false;
    const map = keyBindings();
    const ctx = keyContextOf();
    let id = null;
    try {
      id = km.resolveAction(map, e, ctx);
    } catch (_) {
      id = null;
    }
    if (!id || id === "pan" || id === "cancel") return false;
    /* 画布上下文不劫持 Delete / Mod+C / Mod+V / Mod+A（契约 §7） */
    if ((id === "delete" || id === "copy" || id === "paste" || id === "selectAll") && !ctx.inTimeline) return false;
    const fn = KEYMAP_RUN[id];
    if (!fn) return false;
    e.preventDefault();
    fn();
    return true;
  }

  /** 快捷键设置区（帮助浮层内）：逐动作显示 chord + 重绑定 + 冲突提示 + 恢复默认 */
  function renderShortcutSettings() {
    const box = el0("shortcutList");
    const km = keymapLib();
    if (!box || !km) return;
    const map = keyBindings();
    const issues = typeof km.validateBindings === "function" ? km.validateBindings(map) : { ok: true, conflicts: [], issues: [] };
    const conflictText = el0("shortcutConflicts");
    if (conflictText) {
      const list = (issues && issues.conflicts) || [];
      const errs = (issues && issues.issues) || [];
      const texts = [];
      for (const c of list) texts.push("冲突：" + km.displayChord(c.chord) + " → " + c.actions.join(" / "));
      for (const it of errs) texts.push((it.code || "ISSUE") + "：" + (it.detail || ""));
      conflictText.hidden = texts.length === 0;
      conflictText.textContent = texts.join("；");
    }
    box.textContent = "";
    const actions = (km.ACTIONS || []).filter((a) => !a.reserved);
    for (const action of actions) {
      const line = el("div", "sc-row");
      line.appendChild(el("span", "sc-label", action.label || action.id));
      const chords = Array.isArray(map[action.id]) ? map[action.id] : [];
      line.appendChild(el("span", "sc-chord mono", chords.length ? chords.map((c) => km.displayChord(c)).join(" / ") : "（未绑定）"));
      const btn = el("button", "btn btn-sm", state.keyCapture === action.id ? "按下新组合…" : "重绑定");
      btn.type = "button";
      btn.addEventListener("click", () => {
        state.keyCapture = action.id;
        renderShortcutSettings();
        setStatus("请按下要绑定到「" + (action.label || action.id) + "」的组合键（Esc 取消）");
      });
      const clr = el("button", "btn btn-sm", "清除");
      clr.type = "button";
      clr.title = "解绑该动作（清空组合键）";
      clr.addEventListener("click", () => {
        const next = JSON.parse(JSON.stringify(map));
        next[action.id] = [];
        applyShortcutMap(next);
      });
      line.appendChild(btn);
      line.appendChild(clr);
      rowsBox.appendChild(line);
    }
  }

  function applyShortcutMap(nextMap) {
    const km = keymapLib();
    if (!km) return;
    const res = typeof km.validateBindings === "function" ? km.validateBindings(nextMap) : { ok: true };
    state.prefs = state.prefs || prefsDefaults();
    state.prefs.shortcuts = nextMap;
    savePrefs(true);
    renderShortcutSettings();
    syncHelpShortcutHints();
    if (!res.ok) {
      const first = (res.conflicts && res.conflicts[0]) || (res.issues && res.issues[0]);
      const msg = "快捷键存在冲突：" + (first ? JSON.stringify(first).slice(0, 160) : "见设置区");
      setStatus(msg, "warn");
      notice("warn", msg + "（已保存，但冲突组合不会触发动作）");
    } else {
      setStatus("快捷键已保存");
    }
  }

  /** 捕获阶段：设置区重绑定时消费下一次按键 */
  function captureShortcutKey(e) {
    const id = state.keyCapture;
    if (!id) return false;
    e.preventDefault();
    e.stopPropagation();
    const km = keymapLib();
    if (!km) {
      state.keyCapture = null;
      return true;
    }
    if (e.key === "Escape") {
      state.keyCapture = null;
      renderShortcutSettings();
      setStatus("已取消重绑定");
      return true;
    }
    const chord = km.chordFromEvent(e, { textInput: false });
    if (!chord) return true;
    const next = JSON.parse(JSON.stringify(keyBindings() || km.DEFAULT_BINDINGS));
    next[id] = [chord];
    state.keyCapture = null;
    applyShortcutMap(next);
    return true;
  }

  function resetShortcutsToDefaults() {
    const km = keymapLib();
    if (!km) return;
    state.prefs = state.prefs || prefsDefaults();
    state.prefs.shortcuts = JSON.parse(JSON.stringify(km.DEFAULT_BINDINGS));
    savePrefs(true);
    renderShortcutSettings();
    syncHelpShortcutHints();
    setStatus("快捷键已恢复默认（不影响人物包与其它偏好）");
  }

  /** 帮助浮层里的键位提示跟随自定义绑定 */
  function syncHelpShortcutHints() {
    const km = keymapLib();
    if (!km) return;
    const map = keyBindings();
    const pairs = [
      ["helpKbTranslate", "translate"],
      ["helpKbRotate", "rotate"],
      ["helpKbScale", "scale"],
      ["helpKbPose", "pose"],
      ["helpKbKey", "key"],
      ["helpKbDelete", "delete"],
      ["helpKbUndo", "undo"],
      ["helpKbRedo", "redo"],
      ["helpKbTimeline", "timeline"],
      ["helpKbSave", "save"],
      ["helpKbHelp", "help"],
    ];
    for (const [nodeId, action] of pairs) {
      const node = el0(nodeId);
      if (!node) continue;
      const chords = Array.isArray(map[action]) ? map[action] : [];
      node.textContent = chords.length ? chords.map((c) => km.displayChord(c)).join(" / ") : "未绑定";
    }
  }

  /* ---- Pose Tool（契约 §5/§8：单骨 +X aim，不写骨 length） ---- */

  function poseToolActive() {
    return editTarget() === "bone" && editTool() === "pose" && !!state.edit.selBone;
  }

  /** 选中骨的 +X 显示柄终点（叶骨无 length → 固定 40 CSS px，不写模型） */
  function poseTipReadout(name) {
    const lib = boneEditLib();
    const entry = boneEntry(name);
    if (!lib || !entry) return null;
    const local0 = localOfBone(name);
    const inherit = inheritOfBone(name);
    const parent = realParentWorldOf(entry);
    const bone = state.model && state.model.bones ? state.model.bones[entry.index] : null;
    const childIndex = boneChildIndex(entry.index);
    let childWorld = null;
    if (childIndex >= 0) {
      const w = boneWorldOf(childIndex);
      if (w) childWorld = { tx: w.tx, ty: w.ty };
    }
    const res = lib.aimTipOf({
      parentWorld: parent,
      inherit: inherit,
      startLocal: local0,
      pivotWorld: { x: boneScreenInfo(name) ? boneScreenInfo(name).world.tx : 0, y: 0 },
      length: bone && Number.isFinite(bone.length) ? bone.length : undefined,
      childWorld: childWorld,
    });
    return res && res.ok ? res : null;
  }

  function boneChildIndex(index) {
    const bones = state.model ? state.model.bones : null;
    if (!bones) return -1;
    for (let i = 0; i < bones.length; i++) if (bones[i].parentIndex === index) return i;
    return -1;
  }

  /** 绘制 +X 显示柄（Canvas 覆盖层） */
  function drawPoseTip(ctx2, screenInfo, tip) {
    if (!screenInfo || !tip) return;
    const lib = boneEditLib();
    if (!lib) return;
    const dirScreen = lib.axisAngleOf(tip.dirX, tip.dirY);
    const origin = screenInfo.screen;
    const len = tip.usedLengthSource === "none" ? 40 : Math.max(12, Math.min(400, Math.hypot(proj(tip.x, tip.y).x - origin.x, proj(tip.x, tip.y).y - origin.y)));
    const tipScreen = { x: origin.x + Math.cos(dirScreen) * len, y: origin.y + Math.sin(dirScreen) * len };
    ctx2.save();
    ctx2.strokeStyle = "#4ec9a5";
    ctx2.setLineDash([5, 3]);
    ctx2.lineWidth = 1.4;
    ctx2.beginPath();
    ctx2.moveTo(origin.x, origin.y);
    ctx2.lineTo(tipScreen.x, tipScreen.y);
    ctx2.stroke();
    ctx2.setLineDash([]);
    ctx2.beginPath();
    ctx2.arc(tipScreen.x, tipScreen.y, 5, 0, Math.PI * 2);
    ctx2.strokeStyle = "#4ec9a5";
    ctx2.lineWidth = 1.6;
    ctx2.stroke();
    ctx2.fillStyle = "rgba(78,201,165,0.25)";
    ctx2.fill();
    ctx2.restore();
  }

  /* ==========================================================================
   * P2-01/02（task-27）：事件 / 绘制顺序 / 形变 / 约束轨道（SpineTrackEdit）
   *
   * 口径（design/editor-p2-contract.md §1/§2）：
   *   · 行由 SpineTrackEdit.scanExtra 产出；**所有写入只走 SpineTrackEdit.planKeyEdit**，
   *     app 绝不直接改 raw.animations（planKeyEdit 内部深克隆，失败零改动）。
   *   · 行顺序：骨 → 槽 → 事件 → 绘制顺序 → 形变 → 约束（ik/transform/path）→ 未知（只读）。
   *   · 求值范围：events/drawOrder/deform/ik 已由 core 求值（写草案后 syncAnimFromDraft 重解析即生效）；
   *     transform / path 未求值 → 行上标「仅编辑」，顶部汇总告警，不假装生效。
   * ====================================================================== */
  const EXTRA_GROUPS = [
    { gid: "event", kinds: ["event"], label: "事件", note: "events 时间轴；播放到该时刻即命中（不播音频）" },
    { gid: "drawOrder", kinds: ["drawOrder"], label: "绘制顺序", note: "drawOrder offsets；未列出的槽按偏移 0" },
    { gid: "deform", kinds: ["deform"], label: "形变", note: "attachments.<skin>.<slot>.<att>.deform；region 形变为非官方扩展" },
    { gid: "constraint", kinds: ["ik", "transform", "path"], label: "约束", note: "ik / transform 每约束一行（合并 key）；path 按 position/spacing/mix 三行" },
    { gid: "unknown", kinds: ["timeline"], label: "未知轨道（只读）", note: "未求值的未知时序：只读保留，禁止写入" },
  ];
  const EXTRA_KINDS = ["event", "drawOrder", "deform", "ik", "transform", "path", "timeline"];

  function trackEditLib() {
    return window.SpineTrackEdit || null;
  }
  function isExtraKind(kind) {
    return EXTRA_KINDS.indexOf(kind) >= 0;
  }

  /**
   * 标签列的内层行容器（0.9.117）。
   *
   * 老实现直接在 #dsLabels 上写 `paddingTop = rulerH - scrollTop`：
   * 往下滚动时该值变负数，CSS padding 不接受负值（clamp 成 0），
   * 于是**标签永远停在顶部**，而 canvas 正常滚动 → 左右错位。
   *
   * 新结构：#dsLabels 只负责裁剪（overflow:hidden，固定高度），
   * 内层 #dsLabelRows 承载所有行，用负 marginTop 做滚动偏移。
   */
  function dsLabelRowsBox() {
    const box = el0("dsLabels");
    if (!box) return null;
    let inner = box.querySelector(".ds-label-rows");
    if (!inner) {
      inner = document.createElement("div");
      inner.className = "ds-label-rows";
      box.appendChild(inner);
    }
    return inner;
  }
  function rowColorClass(row) {
    if (!row) return " is-bone";
    if (row.kind === "slot") return " is-slot";
    if (row.kind === "deform") return " is-deform";
    if (row.kind === "path" || row.kind === "transform" || row.kind === "ik") return " is-constraint";
    if (row.kind === "event" || row.kind === "drawOrder") return " is-event";
    if (row.kind === "bone" || row.kind === "group") return " is-bone";
    return " is-other";
  }
  function extraGroupOf(kind) {
    for (const g of EXTRA_GROUPS) if (g.kinds.indexOf(kind) >= 0) return g;
    return null;
  }
  /** core 未求值 / 结构非法 → 预览不完整（不得假装生效） */
  function rowPreviewPartial(row) {
    if (!row) return false;
    return row.kind === "transform" || row.kind === "path" || row.unsupported === true;
  }
  /** planKeyEdit 的 field 参数：ik/transform 是合并 key（null = 不限定字段），旧式 deform 也是 null */
  function trackEditFieldOf(row) {
    if (!row) return null;
    if (row.kind === "ik" || row.kind === "transform") return null;
    if (row.kind === "deform" && (row.legacy || row.editField === null || row.editField === undefined)) return null;
    return row.field;
  }

  /** scanExtra 的缓存（按 动画名 + animEdit.rev + 骨架签名） */
  let extraScanCache = { key: "", value: null };
  function scanExtraRows() {
    const lib = trackEditLib();
    const anim = dsAnimationRaw();
    const empty = { rows: [], unsupported: 0, issues: [], keyCount: 0, maxTime: 0 };
    if (!lib || typeof lib.scanExtra !== "function" || !anim) return empty;
    const key = [state.anim || state.animEdit.sel || "", state.animEdit.rev || 0, modelSignature() || ""].join("|");
    if (extraScanCache.key === key && extraScanCache.value) return extraScanCache.value;
    let scan = null;
    try {
      scan = lib.scanExtra(anim, state.model);
    } catch (e) {
      scan = { rows: [], unsupported: 0, issues: [{ code: "TRACK_SCAN_FAILED", message: String((e && e.message) || e) }] };
    }
    const rows = [];
    let keyCount = 0;
    let maxTime = 0;
    for (const raw of scan.rows || []) {
      const row = Object.assign({}, raw);
      row.editField = raw.field === undefined ? null : raw.field; /* 规范化前的原始 field（写入用） */
      if (row.editField === null || row.editField === undefined) row.field = raw.kind === "deform" ? "(旧式)" : "key";
      row.extra = true;
      row.group = (extraGroupOf(raw.kind) || EXTRA_GROUPS[EXTRA_GROUPS.length - 1]).gid;
      row.previewPartial = rowPreviewPartial(row);
      keyCount += row.keyCount || 0;
      for (const k of row.keys || []) if (Number.isFinite(k.time)) maxTime = Math.max(maxTime, k.time);
      rows.push(row);
    }
    const value = { rows, unsupported: scan.unsupported || 0, issues: scan.issues || [], keyCount, maxTime };
    extraScanCache = { key, value };
    return value;
  }

  function findExtraRow(rowKey) {
    const lib = timelineLib();
    if (!lib || !rowKey) return null;
    for (const row of scanExtraRows().rows) if (lib.rowKey(row) === rowKey) return row;
    return null;
  }
  function selectedExtraRow() {
    const key = state.edit.timeline.extraRowKey;
    if (key) {
      const row = findExtraRow(key);
      if (row) return row;
    }
    const skim = state.edit.timeline.selectedKey;
    if (skim && isExtraKind(skim.kind)) return findExtraRow(skim.rowKey);
    return null;
  }

  function extraKeyAt(row, time, eps) {
    const e = eps === undefined ? 1e-6 : eps;
    for (const k of (row && row.keys) || []) if (Number.isFinite(k.time) && Math.abs(k.time - time) <= e) return k;
    return null;
  }

  /** 面板字段规格（由 SpineTrackEdit.SCHEMA 驱动，避免 UI 与官方结构各写一套） */
  function extraPanelFields(row) {
    const T = trackEditLib();
    if (!T || !row) return [];
    const schemaKind = row.kind === "event" ? "event" : row.kind;
    const schema = T.SCHEMA && T.SCHEMA[schemaKind] ? T.SCHEMA[schemaKind] : null;
    if (!schema || !Array.isArray(schema.fields)) return [];
    if (row.kind === "deform" || row.kind === "drawOrder") return [];
    if (row.kind === "path") {
      const sub = row.sub || (row.field === "mix" ? "mix" : row.field);
      if (sub === "position" || sub === "spacing") return [{ name: "value", type: "number", default: 0 }];
      return schema.fields.filter((f) => f.sub === "mix");
    }
    return schema.fields.slice();
  }

  /** 当前时刻的表单初值：取「时间 ≤ t 的最后一个 key」并补默认（与官方末值语义一致） */
  function extraValuesAt(row, time) {
    const out = Object.create(null);
    const fields = extraPanelFields(row);
    for (const f of fields) out[f.name] = f.default;
    if (row.kind === "event" && (out.name === undefined || out.name === null || out.name === "")) {
      const names = modelEventNames();
      out.name = names.length ? names[0] : "";
    }
    let last = null;
    for (const k of row.keys || []) if (Number.isFinite(k.time) && k.time <= time + 1e-6) last = k;
    if (last) for (const f of fields) if (last[f.name] !== undefined) out[f.name] = last[f.name];
    const exact = extraKeyAt(row, time);
    if (exact) for (const f of fields) if (exact[f.name] !== undefined) out[f.name] = exact[f.name];
    return out;
  }

  function modelEventNames() {
    const model = state.model;
    const out = [];
    const push = (v) => {
      const name = typeof v === "string" ? v : v && typeof v.name === "string" ? v.name : null;
      if (name && out.indexOf(name) < 0) out.push(name);
    };
    if (model) {
      if (Array.isArray(model.events)) model.events.forEach(push);
      const rawEvents = state.raw && state.raw.events;
      if (rawEvents && typeof rawEvents === "object") Object.keys(rawEvents).forEach(push);
    }
    return out;
  }

  /** 当前槽序的 drawOrder 初值（未列出 = 偏移 0；已有 key 则用它的 offsets） */
  function drawOrderInitialOffsets(time) {
    const row = findExtraRow("drawOrder:drawOrder:drawOrder");
    const exact = row ? extraKeyAt(row, time) : null;
    if (exact && Array.isArray(exact.offsets)) {
      return exact.offsets.map((o) => ({ slot: o && o.slot, offset: o && Number.isInteger(o.offset) ? o.offset : 0 }));
    }
    return state.slots.map((s) => ({ slot: s.name, offset: 0 }));
  }

  /** 当前时刻命中/最近的事件（用于「播放中至少显示当前事件」） */
  function currentEventsAt(time) {
    const anim = dsAnimationRaw();
    if (!anim || !Array.isArray(anim.events)) return { now: [], last: null };
    const now = [];
    let last = null;
    for (const k of anim.events) {
      if (!k || !Number.isFinite(k.time) || typeof k.name !== "string") continue;
      if (Math.abs(k.time - time) <= 1e-6) now.push({ name: k.name, time: k.time });
      else if (k.time <= time + 1e-6 && (!last || k.time > last.time)) last = { name: k.name, time: k.time };
    }
    return { now, last };
  }

  /** 写入前的预览一致性预检：草稿必须能被 core 重新解析（与保存同一路径） */
  function trackDraftParseCheck(name, candidate) {
    const lib = animEditLib();
    if (!lib || typeof lib.applyAnimationDrafts !== "function" || !core || !state.raw) return { ok: true, skipped: true };
    const drafts = Object.assign({}, state.animEdit.drafts || {});
    drafts[name] = candidate;
    const merged = lib.applyAnimationDrafts(state.raw, drafts);
    if (!merged.ok) return { ok: false, issues: merged.issues || [] };
    const parsed = core.parseModel(merged.value, state.atlas, { skin: "default" });
    if (!parsed || parsed.ok !== true) {
      const errors = ((parsed && parsed.issues) || []).filter((i) => i.severity === "error");
      return { ok: false, issues: errors.length ? errors : [{ code: "PARSE_FAILED", message: "core 无法解析写入后的动画" }] };
    }
    return { ok: true };
  }

  /**
   * 额外轨道写入唯一入口：锁定闸门 → planKeyEdit（深克隆规划）→ 解析预检 → 草案 + 一条事务。
   * @param {object} row scanExtra 行（dsBuild 规范化后）
   * @param {object} payload {op, time?, index?, delta?, value?}
   * @param {string} label 操作名（状态栏/错误提示用）
   */
  function trackWrite(row, payload, label) {
    const T = trackEditLib();
    const name = state.anim || state.animEdit.sel;
    if (!T || typeof T.planKeyEdit !== "function") {
      setStatus("track-edit.js 未加载：无法编辑该轨道", "error");
      return { ok: false, code: "LIB_MISSING" };
    }
    if (!row || !isExtraKind(row.kind)) return { ok: false, code: "ROW_INVALID" };
    if (!name) return { ok: false, code: "NO_ANIM" };
    if (state.playing) {
      setStatus("播放中：先暂停再改 Key", "warn");
      return { ok: false, code: "PLAYING" };
    }
    if (row.unsupported === true) {
      setStatus("该轨道结构非法/未支持：只读，禁止写入", "warn");
      return { ok: false, code: "UNSUPPORTED_ROW" };
    }
    const rowKey = timelineLib() ? timelineLib().rowKey(row) : row.kind + ":" + row.owner;
    const gate = trackWriteGate([rowKey], label || "轨道编辑");
    if (gate.ok === false) {
      setStatus(gate.code + "：" + gate.reason, "warn");
      return gate;
    }
    const raw = animDraft(name);
    if (!raw) return { ok: false, code: "NO_ANIM_RAW" };
    const payload2 = Object.assign({}, payload, {
      kind: row.kind,
      owner: row.owner,
      field: trackEditFieldOf(row),
      model: state.model,
    });
    const res = T.planKeyEdit(raw, payload2);
    if (!res.ok) {
      const first = (res.issues && res.issues[0]) || { code: "TRACK_EDIT_FAILED", message: "" };
      const codes = (res.issues || []).map((i) => i.code).filter(Boolean).slice(0, 3).join("；");
      const msg = (first.code || "TRACK_EDIT_FAILED") + "：" + (first.message || "") + (codes && codes !== first.code ? "（" + codes + "）" : "");
      setStatus(msg, "warn");
      notice("warn", "轨道写入被拒绝（零改动）：" + msg);
      return res;
    }
    const pre = trackDraftParseCheck(name, res.value);
    if (!pre.ok) {
      const msg = ((pre.issues && pre.issues[0] && (pre.issues[0].code || pre.issues[0].message)) || "PARSE_FAILED") + "：写入后 core 无法解析，已拒绝（零改动）";
      setStatus(msg, "warn");
      notice("warn", msg);
      return { ok: false, code: "PARSE_REJECTED", issues: pre.issues || [] };
    }
    const before = snapshot();
    if (!animSetDraft(name, res.value)) return { ok: false, code: "DRAFT_FAILED" };
    commit(before);
    for (const i of res.issues || []) if (i && i.code) notice("warn", i.code + "：" + i.message);
    state.edit.timeline.lastTrackEdit = {
      at: state.t,
      kind: row.kind,
      owner: row.owner,
      field: row.field,
      op: payload.op,
      changedPath: res.changedPath || null,
      keyCount: res.keyCount == null ? null : res.keyCount,
      overwritten: res.overwritten === true,
      issues: (res.issues || []).map((i) => i.code),
    };
    animSetDraftRefresh();
    setStatus(
      (label || "轨道编辑") + "：" + row.kind + "/" + row.owner + (row.field ? "/" + row.field : "") +
        " → " + (res.keyCount == null ? "?" : res.keyCount) + " key @ " + round(state.t, 4) + "s · 可 Ctrl+Z 撤销"
    );
    return res;
  }

  function trackAddOrSetKey(row, opts) {
    const at = opts && Number.isFinite(opts.time) ? opts.time : state.t;
    const existing = extraKeyAt(row, at);
    return trackWrite(
      row,
      { op: existing ? "set" : "add", time: at, index: existing ? (row.keys || []).indexOf(existing) : undefined, value: (opts && opts.value) || {} },
      existing ? "改 Key" : "新增 Key"
    );
  }

  function trackDeleteAt(row, time) {
    const at = Number.isFinite(time) ? time : state.t;
    const lib = timelineLib();
    const idx = lib && typeof lib.keyIndexAtTime === "function" ? lib.keyIndexAtTime(row.keys || [], at) : -1;
    if (idx < 0) {
      setStatus("该行在 " + round(at, 4) + "s 没有 Key", "warn");
      return { ok: false, code: "KEY_NOT_FOUND" };
    }
    if (lib && lib.bezierLockedAt(row.keys || [], idx)) {
      const msg = "ANIM_CURVE_EDIT_UNSUPPORTED：该 Key 相邻段含曲线，删除会破坏插值语义，已拒绝（曲线段 Key 只读）";
      setStatus(msg, "warn");
      notice("warn", msg);
      return { ok: false, code: "CURVE_LOCKED" };
    }
    return trackWrite(row, { op: "delete", index: idx }, "删除 Key " + round(at, 4) + "s");
  }

  function trackMoveKey(row, fromTime, toTime) {
    const lib = timelineLib();
    const idx = lib && typeof lib.keyIndexAtTime === "function" ? lib.keyIndexAtTime(row.keys || [], fromTime) : -1;
    if (idx < 0) return { ok: false, code: "KEY_NOT_FOUND" };
    if (lib && lib.bezierLockedAt(row.keys || [], idx)) {
      const msg = "ANIM_CURVE_EDIT_UNSUPPORTED：该 Key 相邻段含曲线，重定时会破坏曲线语义，已拒绝（曲线段 Key 只读）";
      setStatus(msg, "warn");
      notice("warn", msg);
      return { ok: false, code: "CURVE_LOCKED" };
    }
    return trackWrite(row, { op: "move", index: idx, time: toTime }, "重定时 Key");
  }

  /* ---- 额外轨道面板（选中行 → 表单 → 提交） ---- */
  function selectExtraRow(row) {
    const tl = state.edit.timeline;
    const lib = timelineLib();
    tl.extraRowKey = row && lib ? lib.rowKey(row) : null;
    tl.extraForm = null;
    if (row) {
      tl.graphRowKey = tl.extraRowKey;
      setStatus("轨道：" + (extraLabelOf(row) || row.kind) + (row.previewPartial ? "（仅编辑：预览不完整）" : ""));
    }
    renderExtraPanel();
    dsSyncBars();
    dsDraw();
  }

  function extraLabelOf(row) {
    if (!row) return "";
    if (row.kind === "event") return "事件";
    if (row.kind === "drawOrder") return "绘制顺序";
    if (row.kind === "deform") {
      const kindText = row.weighted ? "加权" : "刚性";
      const vc = row.vertexCount ? row.vertexCount + " 顶点" : "顶点数未知";
      const len = row.offsetLength ? "偏移长度 " + row.offsetLength : "偏移长度未知";
      return "形变[" + kindText + "] " + (row.slotName || row.owner) + "/" + (row.attachmentName || row.field) + " · " + vc + " · " + len;
    }
    if (row.kind === "ik") return "IK 约束 " + row.owner;
    if (row.kind === "transform") return "transform 约束 " + row.owner;
    if (row.kind === "path") return "path 约束 " + row.owner + " · " + (row.sub || row.field);
    return row.label || row.kind + ":" + row.owner;
  }

  function extraFormState(row) {
    const tl = state.edit.timeline;
    if (!row) return null;
    const key = timelineLib() ? timelineLib().rowKey(row) : row.kind + ":" + row.owner;
    if (!tl.extraForm || tl.extraForm.rowKey !== key) {
      tl.extraForm = { rowKey: key, kind: row.kind, at: state.t, values: extraValuesAt(row, state.t), offsets: null, vertex: { index: 0, x: 0, y: 0 } };
      if (row.kind === "slot") {
        const cur = slotAttachmentAt(row.owner, state.t);
        tl.extraForm.values = { name: cur.name === null || cur.name === undefined ? "" : String(cur.name), keyed: cur.keyed === true };
      }
      if (row.kind === "drawOrder") tl.extraForm.offsets = drawOrderInitialOffsets(state.t);
      if (row.kind === "deform") {
        const exact = extraKeyAt(row, state.t);
        const v = exact && Array.isArray(exact.vertices) ? exact.vertices : null;
        tl.extraForm.vertex = { index: 0, x: v && Number.isFinite(v[0]) ? v[0] : 0, y: v && Number.isFinite(v[1]) ? v[1] : 0 };
      }
    }
    return tl.extraForm;
  }

  /* ==========================================================================
   * 规划书 §5.4：选中关键帧的属性检查器（Property / Target / Frame / Time / Value + 插值）
   *   与 #dsExtra 分工：那边是「额外轨道」（事件/绘制顺序/形变/约束/槽附件）的表单；
   *   这边针对**任意轨道上的一个具体 Key**，可改值、改插值、定位。
   *   解析与准入全部走纯模块 key-inspector.js（可单测），本段只做 DOM 与写入。
   * ====================================================================== */

  function keyInspLib() {
    return window.SpineKeyInspector || null;
  }

  /** 当前检查器指向的 Key：优先 selectedKey，其次选择集 primary */
  function keyInspTarget() {
    const tl = state.edit.timeline;
    const sel = tl.selectedKey;
    if (sel && sel.owner && sel.field) return sel;
    const set = dsSelection();
    if (set.primary) return set.primary;
    if (set.items.length === 1) return set.items[0];
    return null;
  }

  /** 该 Key 在草稿里的当前值与 curve（找不到返回 null） */
  function keyInspReadKey(target) {
    const name = state.anim || state.animEdit.sel;
    const raw = name ? animDraft(name) : null;
    if (!raw || !target) return null;
    const kindBag = target.kind === "bone" ? "bones" : target.kind === "slot" ? "slots" : null;
    if (!kindBag) return null;
    const bag = raw[kindBag] && raw[kindBag][target.owner];
    if (!bag || !Array.isArray(bag[target.field])) return null;
    const list = bag[target.field];
    for (const k of list) {
      if (k && Number.isFinite(k.time) && Math.abs(k.time - target.time) <= 1e-6) return { key: k, list: list, kindBag: kindBag };
    }
    return null;
  }

  function renderKeyInspector() {
    const box = el0("dsKeyInsp");
    if (!box) return;
    const lib = keyInspLib();
    const target = keyInspTarget();
    if (!lib || !target) {
      box.hidden = true;
      return;
    }
    const found = keyInspReadKey(target);
    if (!found) {
      box.hidden = true;
      return;
    }
    const rowKey = timelineLib() ? timelineLib().rowKey(target) : target.kind + ":" + target.owner + ":" + target.field;
    const locked = tlLockedSet().indexOf(rowKey) >= 0;
    const idx = found.list.indexOf(found.key);
    const desc = lib.describe({
      kind: target.kind,
      owner: target.owner,
      field: target.field,
      time: found.key.time,
      value: normalizeKeyValueForInspector(target.kind, target.field, found.key),
      curve: found.key.curve,
      fps: tlFps(),
      locked: locked,
      bezierLocked: timelineLib() ? timelineLib().bezierLockedAt(found.list, idx) : false,
    });
    if (!desc.ok) {
      box.hidden = true;
      return;
    }
    const v = desc.view;
    box.hidden = false;
    el0("dsKeyInspWho").textContent = v.owner + " · " + v.label;
    el0("dsKeyInspProp").textContent = v.label + (v.unit ? "（" + v.unit + "）" : "");
    el0("dsKeyInspTarget").textContent = v.kind + " / " + v.owner;
    el0("dsKeyInspFrame").textContent = String(v.frame);
    el0("dsKeyInspTime").textContent = round(v.time, 3) + "s";
    const input = el0("dsKeyInspValue");
    /* 正在输入时不覆盖用户内容（避免打字被 sync 冲掉） */
    if (input && document.activeElement !== input) input.value = v.valueText;
    if (input) {
      input.disabled = !v.editable;
      input.title = v.editable ? "输入新值后点「写入」或按 Enter" : v.readOnlyReason || "不可编辑";
    }
    el0("dsKeyInspUnit").textContent = v.unit || "";
    el0("dsKeyInspApply").disabled = !v.editable;
    const curveNode = el0("dsKeyInspCurve");
    if (curveNode) {
      const isLast = idx === found.list.length - 1;
      curveNode.textContent = v.curveType + (isLast ? "（末键无出段）" : "");
      curveNode.title = isLast
        ? "最后一个关键帧没有出段：官方 Animation.ts 里末 frame 默认 STEPPED，改插值不生效"
        : "该关键帧到下一个关键帧的插值";
    }
    for (const pair of [["dsKeyInspLinear", "linear"], ["dsKeyInspStepped", "stepped"], ["dsKeyInspBezier", "bezier"]]) {
      const btn = el0(pair[0]);
      if (!btn) continue;
      btn.setAttribute("aria-pressed", v.curveType === pair[1] ? "true" : "false");
      const chk = lib.checkWrite({ op: "interpolation", curveType: v.curveType, isLastKey: idx === found.list.length - 1, locked: locked });
      btn.disabled = !chk.ok || v.curveType === pair[1];
      btn.title = chk.ok
        ? (v.curveType === pair[1] ? "当前已是该插值" : "设为 " + pair[1])
        : chk.issues.map((i) => i.message).join("；");
    }
    const hint = el0("dsKeyInspHint");
    if (hint) {
      hint.textContent = v.editable
        ? lib.describeLine(v) + (v.bezierLocked ? " · 该 Key 在曲线段内：改值会按原控制点改变形状" : "")
        : v.readOnlyReason || "不可编辑";
    }
    state.edit.timeline.keyInspRowKey = rowKey;
    /* §8.1：预设区的可用性与当前预设识别随检查器一起刷新 */
    if (typeof syncPresetControls === "function") syncPresetControls();
  }

  /** 把草稿里的原始 key 归一成检查器要的值（与 timeline.normalizeKey 同口径，但只取需要的字段） */
  function normalizeKeyValueForInspector(kind, field, key) {
    if (!key) return null;
    if (kind === "bone") {
      if (field === "rotate") return Number.isFinite(key.value) ? key.value : 0;
      if (field === "translate" || field === "scale" || field === "shear") {
        return { x: Number.isFinite(key.x) ? key.x : 0, y: Number.isFinite(key.y) ? key.y : 0 };
      }
      return null;
    }
    if (kind === "slot") {
      if (field === "attachment") return key.name === undefined ? null : key.name;
      if (field === "color") return typeof key.value === "string" ? key.value : typeof key.color === "string" ? key.color : null;
      if (field === "twoColor") {
        return {
          light: typeof key.light === "string" ? key.light : null,
          dark: typeof key.dark === "string" ? key.dark : null,
        };
      }
      return null;
    }
    return null;
  }

  /** 写入当前检查器的值（一条事务，失败零写入） */
  function keyInspApplyValue() {
    const lib = keyInspLib();
    const target = keyInspTarget();
    const input = el0("dsKeyInspValue");
    if (!lib || !target || !input) return false;
    const found = keyInspReadKey(target);
    if (!found) return setStatus("这个关键帧已经不存在（可能被撤销或重定时）", "warn");
    const rowKey = timelineLib() ? timelineLib().rowKey(target) : target.kind + ":" + target.owner + ":" + target.field;
    const shape = lib.valueShape(target.kind, target.field);
    const parsed = lib.parseValueInput({ shape: shape, text: input.value });
    if (!parsed.ok) {
      const msg = parsed.issues[0].message;
      setStatus("写入被拒绝：" + msg, "warn");
      notice("warn", "值格式不对：" + msg);
      return false;
    }
    const name = state.anim || state.animEdit.sel;
    const gate = lib.checkWrite({ op: "value", locked: tlLockedSet().indexOf(rowKey) >= 0, targetTime: found.key.time, duration: state.animDur });
    if (!gate.ok) {
      setStatus("写入被拒绝：" + gate.issues[0].message, "warn");
      return false;
    }
    const before = snapshot();
    const res = animEditLib().setKeyValues(animDraft(name), found.kindBag, target.owner, target.field, found.key.time, parsed.values);
    if (!res || !res.ok) {
      setStatus("写入失败：" + ((res && res.issues && res.issues[0] && res.issues[0].message) || "未知原因"), "warn");
      return false;
    }
    animSetDraft(name, res.value);
    if (commit(before)) {
      setStatus("已写入 " + target.owner + " · " + lib.fieldLabel(target.kind, target.field) + " @ " + round(found.key.time, 3) + "s");
      animSetDraftRefresh();
      renderKeyInspector();
      return true;
    }
    setStatus("值没有变化，未写入", "warn");
    return false;
  }

  /** 改插值（stepped / linear / bezier） */
  function keyInspSetCurve(type) {
    const lib = keyInspLib();
    const target = keyInspTarget();
    if (!lib || !target) return false;
    const found = keyInspReadKey(target);
    if (!found) return setStatus("这个关键帧已经不存在", "warn");
    const idx = found.list.indexOf(found.key);
    const isLast = idx === found.list.length - 1;
    const rowKey = timelineLib() ? timelineLib().rowKey(target) : target.kind + ":" + target.owner + ":" + target.field;
    const curveType = lib.curveTypeOf(found.key.curve);
    const gate = lib.checkWrite({ op: "interpolation", curveType: curveType, isLastKey: isLast, locked: tlLockedSet().indexOf(rowKey) >= 0 });
    if (!gate.ok) {
      setStatus("改插值被拒绝：" + gate.issues[0].message, "warn");
      return false;
    }
    const seg = lib.segmentFor(type);
    if (!seg) return false;
    const name = state.anim || state.animEdit.sel;
    const before = snapshot();
    /* setKeyCurve(rawAnim, kind, owner, field, time, valueIndex, segment)：valueIndex 0 = 首分量 */
    const res = animEditLib().setKeyCurve(animDraft(name), found.kindBag, target.owner, target.field, found.key.time, 0, seg);
    if (!res || !res.ok) {
      setStatus("改插值失败：" + ((res && res.issues && res.issues[0] && res.issues[0].message) || "未知原因"), "warn");
      return false;
    }
    animSetDraft(name, res.value);
    if (commit(before)) {
      setStatus("已把 " + target.owner + " 该 Key 的插值改为 " + type);
      animSetDraftRefresh();
      renderKeyInspector();
      return true;
    }
    setStatus("插值没有变化", "warn");
    return false;
  }

  /* ==========================================================================
   * 规划书 §8.1 / P4：曲线预设（把「缓入/缓出/回弹」换算成 key.curve 控制点）
   *   换算在纯模块 curve-presets.js（可单测），本段只做「取段 → 换算 → 写入」。
   *   预设本质是贝塞尔控制点，所以只在当前插值为 bezier 时可用。
   * ====================================================================== */

  function curvePresetsLib() {
    return window.SpineCurvePresets || null;
  }

  /** 填充预设下拉（只在初始化时做一次，避免每次刷新重建丢焦点） */
  function fillPresetOptions() {
    const sel = el0("dsKeyInspPreset");
    const lib = curvePresetsLib();
    if (!sel || !lib) return;
    if (sel.dataset.filled === "1") return;
    for (const p of lib.listPresets()) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.label;
      sel.appendChild(o);
    }
    sel.dataset.filled = "1";
  }

  /** 当前检查器 Key 的出段信息（供预设识别与应用）；没有出段返回 null */
  function keyInspSegment() {
    const target = keyInspTarget();
    if (!target) return null;
    const found = keyInspReadKey(target);
    if (!found) return null;
    const idx = found.list.indexOf(found.key);
    const next = idx + 1 < found.list.length ? found.list[idx + 1] : null;
    if (!next) return null;
    const ce = window.SpineCurveEdit || null;
    if (!ce || typeof ce.segmentInfo !== "function") return null;
    const seg = ce.segmentInfo(found.key, 0, next, { field: target.field });
    if (!seg || seg.ok !== true) return null;
    return { target: target, found: found, idx: idx, seg: seg, next: next };
  }

  /** 把选中的预设应用到当前段 */
  function keyInspApplyPreset() {
    const lib = curvePresetsLib();
    const sel = el0("dsKeyInspPreset");
    if (!lib || !sel) return false;
    const id = sel.value;
    if (!id) return setStatus("先选择一个曲线预设", "warn");
    const info = keyInspSegment();
    if (!info) return setStatus("该关键帧没有出段（末键），无法应用曲线预设", "warn");
    if (info.seg.type !== "bezier") {
      setStatus("曲线预设需要先把这个 Key 的插值设为 Bezier（当前是 " + info.seg.type + "）", "warn");
      return false;
    }
    /* 多分量字段（translate/scale/shear）：按分量分别换算后平铺成 4N 个数 */
    const comps = curveComponentCount(info.target.field);
    let curve = null;
    let over = false;
    if (comps > 1) {
      const from = [];
      const to = [];
      for (let i = 0; i < comps; i++) {
        const s = window.SpineCurveEdit.segmentInfo(info.found.key, i, info.next, { field: info.target.field });
        if (!s || s.ok !== true) return setStatus("读取分量 " + i + " 的段失败", "warn");
        from.push(s.value1);
        to.push(s.value2);
      }
      const r = lib.applyPresetMulti({ preset: id, time1: info.seg.time1, time2: info.seg.time2, from: from, to: to });
      if (!r.ok) return setStatus(r.issues[0].message, "warn");
      curve = r.curve;
      over = r.over;
    } else {
      const r = lib.applyPreset({ preset: id, time1: info.seg.time1, time2: info.seg.time2, value1: info.seg.value1, value2: info.seg.value2 });
      if (!r.ok) return setStatus(r.issues[0].message, "warn");
      curve = r.curve;
      over = r.over;
    }
    const name = state.anim || state.animEdit.sel;
    const rowKey = timelineLib() ? timelineLib().rowKey(info.target) : "";
    if (tlLockedSet().indexOf(rowKey) >= 0) return setStatus("该轨道已锁定，禁止写入", "warn");
    const before = snapshot();
    /* anim-edit.setKeyCurve 的 segment 形状：{ points: {cx1,cy1,cx2,cy2} } → 走 setControlPoints；
       传 { type:"bezier" } 只会改段类型，不会写入控制点（那正是先前"曲线没有变化"的原因）。
       多分量字段需要对**每个分量**分别 setControlPoints（curve 数组是 4N 平铺）。 */
    let res = null;
    const comps2 = curveComponentCount(info.target.field);
    for (let i = 0; i < comps2; i++) {
      const pts = { cx1: curve[i * 4], cy1: curve[i * 4 + 1], cx2: curve[i * 4 + 2], cy2: curve[i * 4 + 3] };
      const draft = i === 0 ? animDraft(name) : (res && res.ok ? res.value : animDraft(name));
      const r = animEditLib().setKeyCurve(draft, info.found.kindBag, info.target.owner, info.target.field, info.found.key.time, i, { points: pts });
      if (!r || !r.ok) {
        setStatus("应用预设失败（分量 " + i + "）：" + ((r && r.issues && r.issues[0] && r.issues[0].message) || "未知原因"), "warn");
        return false;
      }
      res = r;
    }
    if (!res || !res.ok) {
      setStatus("应用预设失败：" + ((res && res.issues && res.issues[0] && res.issues[0].message) || "未知原因"), "warn");
      return false;
    }
    animSetDraft(name, res.value);
    if (commit(before)) {
      setStatus("已应用曲线预设「" + lib.describePreset(id) + "」" + (over ? "（含过冲）" : "") + "：" + info.target.owner + " · " + info.target.field);
      animSetDraftRefresh();
      renderKeyInspector();
      return true;
    }
    setStatus("曲线没有变化", "warn");
    return false;
  }

  /** 该字段有几个分量（决定 curve 数组长度） */
  function curveComponentCount(field) {
    if (field === "translate" || field === "scale" || field === "shear") return 2;
    return 1;
  }

  function bindKeyInspector() {    const apply = el0("dsKeyInspApply");
    if (apply) apply.addEventListener("click", () => keyInspApplyValue());
    const input = el0("dsKeyInspValue");
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          keyInspApplyValue();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          const t = keyInspTarget();
          const found = t ? keyInspReadKey(t) : null;
          if (found && keyInspLib()) input.value = keyInspLib().formatValueForInput(keyInspLib().valueShape(t.kind, t.field), normalizeKeyValueForInspector(t.kind, t.field, found.key));
        }
      });
    }
    for (const pair of [["dsKeyInspLinear", "linear"], ["dsKeyInspStepped", "stepped"], ["dsKeyInspBezier", "bezier"]]) {
      const btn = el0(pair[0]);
      if (btn) btn.addEventListener("click", () => keyInspSetCurve(pair[1]));
    }
    const locate = el0("dsKeyInspLocate");
    if (locate) {
      locate.addEventListener("click", () => {
        const t = keyInspTarget();
        if (!t) return;
        setPlayhead(t.time);
        dsSyncBars();
        dsDraw();
        graphDraw();
        setStatus("已定位到 " + round(t.time, 3) + "s（帧 " + Math.round(t.time * tlFps()) + "）");
      });
    }
    const del = el0("dsKeyInspDelete");
    if (del) del.addEventListener("click", () => dsDeleteSelected());
    const close = el0("dsKeyInspClose");
    if (close) {
      close.addEventListener("click", () => {
        const box = el0("dsKeyInsp");
        if (box) box.hidden = true;
      });
    }
    /* §8.1 曲线预设 */
    fillPresetOptions();
    const presetSel = el0("dsKeyInspPreset");
    if (presetSel) presetSel.addEventListener("change", () => syncPresetControls());
    const presetApply = el0("dsKeyInspPresetApply");
    if (presetApply) presetApply.addEventListener("click", () => keyInspApplyPreset());
  }

  /** 同步预设区的可用性与「当前是哪个预设」的识别结果 */
  function syncPresetControls() {
    const lib = curvePresetsLib();
    const sel = el0("dsKeyInspPreset");
    const btn = el0("dsKeyInspPresetApply");
    const note = el0("dsKeyInspPresetNote");
    if (!lib || !sel || !btn) return;
    fillPresetOptions();
    const info = keyInspSegment();
    const isBezier = !!(info && info.seg.type === "bezier");
    sel.disabled = !isBezier;
    btn.disabled = !isBezier || !sel.value;
    if (!info) {
      sel.disabled = true;
      btn.disabled = true;
      if (note) note.textContent = "末键无出段";
      return;
    }
    if (!isBezier) {
      if (note) note.textContent = "插值需为 Bezier";
      return;
    }
    /* 反查当前段最接近的预设，供用户确认「现在用的是哪条」。
       注意：**不能无条件改写下拉框的选中值** —— 用户可能已经选好一个待应用的预设，
       刷新时把它覆盖掉会导致「点应用却应用了别的」（实测踩过）。
       只在用户尚未选择（值为空）时才回填。 */
    const m = lib.matchPreset({
      time1: info.seg.time1, time2: info.seg.time2,
      value1: info.seg.value1, value2: info.seg.value2,
      cx1: info.seg.cx1, cy1: info.seg.cy1, cx2: info.seg.cx2, cy2: info.seg.cy2,
    });
    if (m && m.ok) {
      if (note) {
        note.textContent = m.preset ? "当前 ≈ " + m.preset : "当前 ≈ " + (m.nearest || "自定义") + "（非标准预设）";
        note.title = "反查依据：把绝对控制点归一化后与预设比较，累计误差 " + (m.distance === undefined ? "—" : m.distance);
      }
      if (!sel.value && m.preset) sel.value = m.preset;
    }
  }

  /** §4.5 形变顶点表：只读展示当前 Key 的顶点偏移，点一行可回填到下标输入框 */
  function deformVertexTable(row) {
    const D = window.SpineDeformEdit || null;
    const box = el("div", "ds-deform-verts");
    if (!D) {
      box.textContent = "deform-edit.js 未加载：无法解析顶点表";
      return box;
    }
    /* 取该轨在播放头时刻（或最近一个 Key）的 vertices */
    const name = state.anim || state.animEdit.sel;
    const raw = name ? animDraft(name) : null;
    if (!raw) {
      box.textContent = "没有可读的动画草稿";
      return box;
    }
    const keys = deformKeysOf(raw, row);
    if (!keys || !keys.length) {
      box.textContent = "该轨道还没有形变 Key";
      return box;
    }
    /* 优先播放头时刻的 Key，否则用最后一个 */
    let key = null;
    for (const k of keys) {
      if (k && Number.isFinite(k.time) && Math.abs(k.time - state.t) <= 1e-6) key = k;
    }
    if (!key) key = keys[keys.length - 1];
    const weighted = row.weighted === true;
    const lay = D.layoutOf({ weighted: weighted, vertices: key.vertices });
    if (!lay.ok) {
      box.textContent = "顶点数据无法解析：" + (lay.issues[0] ? lay.issues[0].message : "未知原因");
      return box;
    }
    if (lay.layout === "weighted") {
      box.textContent = "加权网格：vertices 存的是骨骼权重（" + (Array.isArray(key.vertices) ? key.vertices.length : 0) + " 个数），不是坐标，顶点表只读。请改骨骼变换。";
      box.className = "ds-deform-verts is-readonly";
      return box;
    }
    const parsed = D.parseVertices({ weighted: false, vertices: key.vertices });
    if (!parsed.ok) {
      box.textContent = "顶点数据无法解析：" + (parsed.issues[0] ? parsed.issues[0].message : "未知原因");
      return box;
    }
    const head = el("div", "ds-deform-verts-hd");
    head.textContent = "顶点表 @" + round(key.time, 3) + "s · " + D.summaryLine({ layout: "xy", vertexCount: parsed.count }) +
      (parsed.truncated ? "（已截断）" : "");
    box.appendChild(head);
    const list = el("div", "ds-deform-verts-list");
    for (const v of parsed.vertices) {
      const b = el("button", "ds-deform-vert", "#" + v.index + "  " + v.x + ", " + v.y);
      b.type = "button";
      b.title = "点击把该顶点下标填入上方「顶点下标」，并把当前偏移带入 x/y";
      b.addEventListener("click", () => {
        const iIdx = el0("dsExtraVertexIndex");
        const iX = el0("dsExtraVertexX");
        const iY = el0("dsExtraVertexY");
        if (iIdx) iIdx.value = String(v.index);
        if (iX) iX.value = String(v.x);
        if (iY) iY.value = String(v.y);
        const form = state.edit.timeline.extraForm;
        if (form && form.vertex) {
          form.vertex.index = v.index;
          form.vertex.x = v.x;
          form.vertex.y = v.y;
        }
        setStatus("已选中顶点 #" + v.index + "（" + v.x + ", " + v.y + "）@ " + round(key.time, 3) + "s");
      });
      list.appendChild(b);
    }
    box.appendChild(list);
    return box;
  }

  /** 该 deform 轨道的 key 数组（兼容 attachments 与旧式 deform 两种容器） */
  function deformKeysOf(raw, row) {
    if (!raw || !row) return null;
    if (row.legacy) {
      return raw.deform && Array.isArray(raw.deform[row.owner]) ? raw.deform[row.owner] : null;
    }
    const skins = raw.attachments;
    if (!skins) return null;
    for (const skinName of Object.keys(skins)) {
      const slotMap = skins[skinName];
      if (!slotMap || !slotMap[row.owner]) continue;
      const bag = slotMap[row.owner][row.field];
      if (bag && Array.isArray(bag.deform)) return bag.deform;
    }
    return null;
  }

  function renderExtraPanel() {
    const box = el0("dsExtra");
    const body = el0("dsExtraBody");
    const title = el0("dsExtraTitle");
    const note = el0("dsExtraNote");
    if (!box || !body) return;
    const row = selectedTrackRow();
    if (!row) {
      box.hidden = true;
      return;
    }
    const form = extraFormState(row);
    box.hidden = false;
    title.textContent = isExtraKind(row.kind) ? extraLabelOf(row) : "槽附件 " + row.owner;
    note.textContent = isExtraKind(row.kind)
      ? (row.previewPartial ? "仅编辑：预览不完整（core 未求值）" : "可编辑（写入经 SpineTrackEdit）") + (row.unsupported ? " · 结构非法只读" : "")
      : "槽附件 Key：改该槽在该时刻显示哪个附件（空 = 隐藏该槽，官方 null 语义）；写入经 anim-edit.upsertKey";
    note.className = "ds-extra-note" + (isExtraKind(row.kind) && row.previewPartial ? " is-partial" : "");
    const sig = [form.rowKey, row.kind, (row.keys || []).length, JSON.stringify(form.offsets || null)].join("|");
    if (body.dataset.sig === sig && body.childElementCount) {
      /* 同签名不重建（避免输入时失焦） */
      return;
    }
    body.dataset.sig = sig;
    body.textContent = "";
    const T = trackEditLib();
    if (row.kind === "slot") {
      /* P2-01 核心项：槽附件轨（新增/改值/改时间/删除；空名 = 隐藏该槽） */
      const cur = slotAttachmentAt(row.owner, state.t);
      const draft = animDraft(state.anim || state.animEdit.sel) || {};
      const bag = draft.slots && draft.slots[row.owner];
      const keyCount = bag && Array.isArray(bag.attachment) ? bag.attachment.length : 0;
      const info = el("div", "ds-extra-note");
      info.textContent =
        "当前附件：" + (cur.name === null || cur.name === undefined ? "（空 = 隐藏该槽）" : cur.name) +
        " · 来源：" + (cur.keyed ? "该时刻 key" : "绑定姿态") + " · 该槽 " + keyCount + " 个附件 key";
      const tools = el("div", "ds-extra-tools");
      const lab = el("label", "ds-extra-field", "附件名");
      const sel = el("select");
      const emptyOpt = el("option", null, "（空 = 隐藏该槽）");
      emptyOpt.value = "";
      sel.id = "dsExtraSlotName";
      sel.setAttribute("aria-label", "槽附件名（空 = 隐藏该槽）");
      sel.appendChild(emptyOpt);
      const cands = slotAttachmentCandidates(row.owner);
      for (const n of cands) {
        const o = el("option", null, n);
        o.value = n;
        sel.appendChild(o);
      }
      if (form.values.name && cands.indexOf(form.values.name) < 0) {
        const o = el("option", null, form.values.name + "（不在候选里）");
        o.value = form.values.name;
        sel.appendChild(o);
      }
      sel.value = form.values.name || "";
      sel.addEventListener("change", () => {
        form.values.name = sel.value;
      });
      lab.appendChild(sel);
      tools.appendChild(lab);
      tools.appendChild(el("span", "dim", "候选 " + cands.length + " 个（default skin 附件键 + raw.slots[].attachment）"));
      body.appendChild(info);
      body.appendChild(tools);
      return;
    }
    if (row.kind === "drawOrder") {
      const wrap = el("div", "ds-extra-offsets");
      const list = form.offsets || [];
      list.forEach((entry, i) => {
        const line = el("div", "ds-extra-offset");
        const sel = el("select");
        for (const s of state.slots) {
          const o = el("option", null, s.name);
          o.value = s.name;
          sel.appendChild(o);
        }
        sel.id = "dsExtraOffSlot-" + i;
        sel.setAttribute("aria-label", "偏移 " + i + " 的槽");
        sel.value = entry.slot;
        sel.title = "该偏移作用的槽";
        sel.addEventListener("change", () => {
          entry.slot = sel.value;
          body.dataset.sig = "";
        });
        const num = el("input");
        num.type = "number";
        num.step = "1";
        num.id = "dsExtraOffVal-" + i;
        num.setAttribute("aria-label", "偏移 " + i);
        num.value = String(entry.offset | 0);
        num.title = "offset：该槽在绘制顺序里向前（负）/向后（正）移动的位数（整数）";
        num.addEventListener("change", () => {
          const v = Number(num.value);
          entry.offset = Number.isInteger(v) ? v : 0;
          body.dataset.sig = "";
          syncDsGraphBar();
        });
        const up = el("button", "btn btn-icon btn-sm", "↑");
        up.type = "button";
        up.title = "上移该偏移项（只影响列表顺序，不写 JSON）";
        up.addEventListener("click", () => {
          if (i === 0) return;
          const t = list[i - 1];
          list[i - 1] = list[i];
          list[i] = t;
          body.dataset.sig = "";
          renderExtraPanel();
        });
        const down = el("button", "btn btn-icon btn-sm", "↓");
        down.type = "button";
        down.title = "下移该偏移项";
        down.addEventListener("click", () => {
          if (i === list.length - 1) return;
          const t = list[i + 1];
          list[i + 1] = list[i];
          list[i] = t;
          body.dataset.sig = "";
          renderExtraPanel();
        });
        const del = el("button", "btn btn-icon btn-sm", "✕");
        del.type = "button";
        del.title = "从 offsets 里移除该槽（移除后按偏移 0 处理）";
        del.addEventListener("click", () => {
          list.splice(i, 1);
          body.dataset.sig = "";
          renderExtraPanel();
        });
        line.appendChild(sel);
        line.appendChild(num);
        line.appendChild(up);
        line.appendChild(down);
        line.appendChild(del);
        wrap.appendChild(line);
      });
      const tools = el("div", "ds-extra-tools");
      const addSlot = el("button", "btn btn-sm", "＋ 添加槽");
      addSlot.type = "button";
      addSlot.addEventListener("click", () => {
        const used = new Set((form.offsets || []).map((o) => o.slot));
        const next = state.slots.filter((s) => !used.has(s.name))[0];
        if (!next) return setStatus("所有槽都已列出", "warn");
        (form.offsets || (form.offsets = [])).push({ slot: next.name, offset: 0 });
        body.dataset.sig = "";
        renderExtraPanel();
      });
      const rebuild = el("button", "btn btn-sm", "按当前槽序重建");
      rebuild.type = "button";
      rebuild.title = "按当前槽序重建 offsets（全部偏移 0）";
      rebuild.addEventListener("click", () => {
        form.offsets = state.slots.map((s) => ({ slot: s.name, offset: 0 }));
        body.dataset.sig = "";
        renderExtraPanel();
      });
      const summary = el("span", "dim", "汇总：" + (form.offsets || []).length + " 项" + ((form.offsets || []).some((o) => o.offset) ? "（含非 0 偏移）" : "（全 0 = 默认顺序）"));
      tools.appendChild(addSlot);
      tools.appendChild(rebuild);
      tools.appendChild(summary);
      wrap.appendChild(tools);
      body.appendChild(wrap);
      return;
    }
    if (row.kind === "deform") {
      const info = el("div", "ds-extra-note");
      info.textContent =
        (row.weighted ? "加权网格" : "刚性网格") + "：顶点数 " + (row.vertexCount || 0) +
        " · 偏移长度 " + (row.offsetLength || 0) + (row.weighted ? "（= 2×influence 数）" : "（= 2×顶点数）") +
        (row.legacy ? " · 旧式 deform.<slot> 容器" : "");
      const tools = el("div", "ds-extra-tools");
      const labIdx = el("label", "ds-extra-field", "顶点下标");
      const inpIdx = el("input");
      inpIdx.type = "number";
      inpIdx.min = "0";
      inpIdx.step = "1";
      inpIdx.id = "dsExtraVertexIndex";
      inpIdx.setAttribute("aria-label", "顶点下标");
      inpIdx.value = String(form.vertex.index | 0);
      inpIdx.addEventListener("change", () => {
        const v = Math.max(0, Math.round(Number(inpIdx.value) || 0));
        form.vertex.index = v;
      });
      labIdx.appendChild(inpIdx);
      const labX = el("label", "ds-extra-field", "x 偏移");
      const inpX = el("input");
      inpX.type = "number";
      inpX.step = "0.01";
      inpX.id = "dsExtraVertexX";
      inpX.setAttribute("aria-label", "顶点 x 偏移");
      inpX.value = String(form.vertex.x);
      inpX.addEventListener("change", () => {
        form.vertex.x = Number(inpX.value);
      });
      labX.appendChild(inpX);
      const labY = el("label", "ds-extra-field", "y 偏移");
      const inpY = el("input");
      inpY.type = "number";
      inpY.step = "0.01";
      inpY.id = "dsExtraVertexY";
      inpY.setAttribute("aria-label", "顶点 y 偏移");
      inpY.value = String(form.vertex.y);
      inpY.addEventListener("change", () => {
        form.vertex.y = Number(inpY.value);
      });
      labY.appendChild(inpY);
      const apply = el("button", "btn btn-sm primary", "设该顶点偏移 @播放头");
      apply.type = "button";
      apply.addEventListener("click", () => deformSetVertex(row, form));
      tools.appendChild(labIdx);
      tools.appendChild(labX);
      tools.appendChild(labY);
      tools.appendChild(apply);
      body.appendChild(info);
      body.appendChild(tools);
      /* §4.5 顶点表：把当前形变 Key 的 vertices 解析成可读列表（只读展示 + 点选回填下标）。
         加权网格的 vertices 是骨骼权重而非坐标，明确只读 —— 见 deform-edit.layoutOf。 */
      body.appendChild(deformVertexTable(row));
      return;
    }
    /* event / ik / transform / path（字段由 SCHEMA 驱动） */
    const fields = extraPanelFields(row);
    const grid = el("div", "ds-extra-grid");
    for (const f of fields) {
      const lab = el("label", "ds-extra-field", f.name + (f.type === "bool" ? "" : f.type === "number" ? " (" + (f.min !== undefined ? f.min : "−∞") + "…" + (f.max !== undefined ? f.max : "+∞") + ")" : ""));
      let node;
      if (row.kind === "event" && f.name === "name") {
        node = el("select");
        const names = modelEventNames();
        node.id = "dsExtraF-name";
        node.setAttribute("aria-label", "事件名");
        for (const n of names) {
          const o = el("option", null, n);
          o.value = n;
          node.appendChild(o);
        }
        if (form.values.name && names.indexOf(form.values.name) < 0) {
          const o = el("option", null, form.values.name + "（模型中不存在）");
          o.value = form.values.name;
          node.appendChild(o);
        }
        node.value = form.values.name || "";
        node.addEventListener("change", () => {
          form.values.name = node.value;
        });
      } else if (f.type === "bool") {
        node = el("input");
        node.type = "checkbox";
        node.id = "dsExtraF-" + f.name;
        node.setAttribute("aria-label", f.name);
        node.checked = form.values[f.name] === true;
        node.addEventListener("change", () => {
          form.values[f.name] = node.checked;
        });
      } else if (f.type === "string") {
        /* §4.5 事件参数：`string` 字段（含 event.string）是**文本**，不是数字。
           早先这里没有 string 分支，文本字段被渲染成 number 输入框，
           输入的文字被 Number() 转成 NaN 后静默丢弃 —— 表现为"填了参数但没写进去"。 */
        node = el("input");
        node.type = "text";
        node.id = "dsExtraF-" + f.name;
        node.setAttribute("aria-label", f.name);
        const curS = form.values[f.name];
        node.value = curS === undefined || curS === null ? "" : String(curS);
        node.addEventListener("input", () => {
          const raw = node.value;
          /* 空串 = 显式清空（事件 string 允许 null）；非空原样保留，不 trim 掉用户有意打的空格 */
          form.values[f.name] = raw === "" ? null : raw;
        });
      } else {
        node = el("input");
        node.type = "number";
        node.step = f.type === "bool" ? "1" : "0.01";
        node.id = "dsExtraF-" + f.name;
        node.setAttribute("aria-label", f.name);
        if (f.min !== undefined) node.min = String(f.min);
        if (f.max !== undefined) node.max = String(f.max);
        const cur = form.values[f.name];
        node.value = cur === undefined || cur === null ? "" : String(cur);
        node.addEventListener("change", () => {
          /* 数字字段的解析走纯模块 key-inspector.parseFieldInput（与 selftest 同一套逻辑），
             非法输入不写入表单，并明确提示，避免「填了但没生效」。 */
          const insp = window.SpineKeyInspector || null;
          const parsed = insp ? insp.parseFieldInput({ type: "number", text: node.value }) : null;
          if (parsed && !parsed.ok) {
            setStatus("「" + f.name + "」" + parsed.issues[0].message, "warn");
            return;
          }
          if (parsed) {
            if (parsed.value === null) delete form.values[f.name];
            else form.values[f.name] = parsed.value;
            return;
          }
          const raw = node.value.trim();
          if (raw === "") {
            delete form.values[f.name];
            return;
          }
          const v = Number(raw);
          if (Number.isFinite(v)) form.values[f.name] = v;
        });
      }
      lab.appendChild(node);
      grid.appendChild(lab);
    }
    body.appendChild(grid);
    const hint = el("div", "ds-extra-note");
    hint.textContent =
      row.kind === "event"
        ? "事件名必须是 skeleton.events 里的名字；int/float/string 可留空。事件不支持贝塞尔。"
        : row.kind === "ik"
          ? "IK 合并 key：mix/softness 夹在合法区间；bendPositive/compress/stretch 用开关。官方 curve 为 2 分量，不提供 Bezier 编辑。"
          : row.kind === "transform"
            ? "transform 合并 key（6 个 mix 字段）：core 未求值 → 预览不完整，写入仅保存与官方 runtime 校验。"
            : "path 单值/mix 轨：core 未求值 → 预览不完整；position/spacing 读 value 字段。";
    body.appendChild(hint);
    if (T && T.SCHEMA && !fields.length) body.appendChild(el("div", "ds-extra-note is-partial", "该轨道没有可编辑字段（结构非法或未知）"));
  }

  /** 形变顶点写入（委托 SpineTrackEdit.setDeformVertex） */
  function deformSetVertex(row, form) {
    const T = trackEditLib();
    const name = state.anim || state.animEdit.sel;
    if (!T || typeof T.setDeformVertex !== "function" || !row || !name) return null;
    const rowKey = timelineLib() ? timelineLib().rowKey(row) : row.kind + ":" + row.owner;
    const gate = trackWriteGate([rowKey], "形变顶点写入");
    if (gate.ok === false) {
      setStatus(gate.code + "：" + gate.reason, "warn");
      return null;
    }
    if (state.playing) {
      setStatus("播放中：先暂停再改形变", "warn");
      return null;
    }
    const raw = animDraft(name);
    const res = T.setDeformVertex(raw, {
      slot: row.slotName || row.owner,
      attachment: row.legacy ? null : row.attachmentName || row.editField,
      legacy: row.legacy === true,
      index: form.vertex.index | 0,
      x: form.vertex.x,
      y: form.vertex.y,
      time: state.t,
      model: state.model,
    });
    if (!res.ok) {
      const first = (res.issues && res.issues[0]) || { code: "DEFORM_FAILED", message: "" };
      const msg = (first.code || "DEFORM_FAILED") + "：" + (typeof deformCodeText === "function" ? deformCodeText(first.code) || first.message || "" : first.message || "");
      setStatus(msg, "warn");
      notice("warn", "形变写入被拒绝（零改动）：" + msg);
      return res;
    }
    const pre = trackDraftParseCheck(name, res.value);
    if (!pre.ok) {
      setStatus("形变写入被拒绝：写入后 core 无法解析（零改动）", "warn");
      return { ok: false, code: "PARSE_REJECTED" };
    }
    const before = snapshot();
    if (!animSetDraft(name, res.value)) return null;
    commit(before);
    state.edit.timeline.lastTrackEdit = {
      at: state.t,
      kind: "deform",
      owner: row.owner,
      field: row.field,
      op: "set-vertex",
      changedPath: res.changedPath || null,
      keyCount: res.keyCount == null ? null : res.keyCount,
      issues: [],
    };
    animSetDraftRefresh();
    setStatus(
      "形变顶点：" + (row.slotName || row.owner) + "/" + (row.attachmentName || row.field) + " 顶点 " +
        (form.vertex.index | 0) + " = (" + form.vertex.x + ", " + form.vertex.y + ") @ " + round(state.t, 4) + "s · 可 Ctrl+Z 撤销"
    );
    return res;
  }

  /** 面板「加/改 Key」按钮：按行类型组 payload */
  function extraAddOrSetFromPanel() {
    const row = selectedTrackRow();
    if (!row) return setStatus("先在时间轴选中一条槽附件 / 事件 / 绘制顺序 / 形变 / 约束行", "warn");
    const form = extraFormState(row);
    if (row.kind === "slot") {
      const v = form.values.name === "" || form.values.name === undefined ? null : String(form.values.name);
      return slotAttachmentWrite(row.owner, v, state.t);
    }
    if (row.kind === "drawOrder") {
      const offsets = (form.offsets || []).filter((o) => o && typeof o.slot === "string").map((o) => ({ slot: o.slot, offset: o.offset | 0 }));
      return trackAddOrSetKey(row, { value: { offsets } });
    }
    if (row.kind === "event") {
      const v = {};
      for (const f of extraPanelFields(row)) if (form.values[f.name] !== undefined) v[f.name] = form.values[f.name];
      if (!v.name) return setStatus("EVENT_NAME_REQUIRED：事件名不能为空", "warn");
      return trackAddOrSetKey(row, { value: v });
    }
    if (row.kind === "deform") return deformSetVertex(row, form);
    const v = {};
    for (const f of extraPanelFields(row)) if (form.values[f.name] !== undefined) v[f.name] = form.values[f.name];
    return trackAddOrSetKey(row, { value: v });
  }

  /* ---- 槽附件轨（P2-01 核心项）：当前附件名 / 候选名 / 写入 ---- */

  /** 该槽在当前时刻的附件名（草稿 key 优先，其次绑定姿态）；keyed 表示是否由 key 决定 */
  function slotAttachmentAt(slotName, time) {
    const name = state.anim || state.animEdit.sel;
    const draft = name ? animDraft(name) : null;
    const keys = draft && draft.slots && draft.slots[slotName] && Array.isArray(draft.slots[slotName].attachment) ? draft.slots[slotName].attachment : null;
    if (keys && keys.length) {
      let value = null;
      let found = false;
      for (const k of keys) {
        if (k && Number.isFinite(k.time) && k.time <= time + 1e-6) {
          value = k.name === undefined ? null : k.name;
          found = true;
        }
      }
      const idx = timelineLib() ? timelineLib().keyIndexAtTime(keys, time) : -1;
      if (idx >= 0) {
        value = keys[idx].name === undefined ? null : keys[idx].name;
        found = true;
      }
      if (found) return { name: value, source: "key", keyed: true };
    }
    const si = exprSlotByName(slotName);
    const slot = si >= 0 ? state.model.slots[si] : null;
    return { name: slot ? slot.setupAttachment : null, source: "setup", keyed: false };
  }

  /** 附件名候选：default skin 该槽的附件键 + raw.slots[].attachment + 当前值（去重排序） */
  function slotAttachmentCandidates(slotName) {
    const out = [];
    const add = (n) => {
      if (typeof n === "string" && n && out.indexOf(n) < 0) out.push(n);
    };
    for (const n of slotAttachmentNames(slotName)) add(n);
    const rawSlots = state.raw && Array.isArray(state.raw.slots) ? state.raw.slots : [];
    for (const s of rawSlots) if (s && s.name === slotName && typeof s.attachment === "string") add(s.attachment);
    const cur = slotAttachmentAt(slotName, state.t);
    if (cur && cur.name) add(cur.name);
    return out.sort();
  }

  /**
   * 槽附件 Key 写入（复用既有 anim-edit 路径：upsertKey slots.<slot>.attachment）。
   * attName 为 null/"" = 官方 null 语义（该槽在该时刻不显示附件 → 隐藏）。
   * 一条事务；锁定/播放中/草稿缺失一律拒绝且零改动。
   */
  function slotAttachmentWrite(slotName, attName, time) {
    const name = state.anim || state.animEdit.sel;
    if (!name) return { ok: false, code: "NO_ANIM" };
    if (state.playing) {
      setStatus("播放中：先暂停再改 Key", "warn");
      return { ok: false, code: "PLAYING" };
    }
    const at = Number.isFinite(time) ? time : state.t;
    const rowKey = "slot:" + slotName + ":attachment";
    const gate = trackWriteGate([rowKey], "槽附件 Key");
    if (gate.ok === false) {
      setStatus(gate.code + "：" + gate.reason, "warn");
      return gate;
    }
    const value = attName === null || attName === undefined || attName === "" ? null : String(attName);
    const lib = animEditLib();
    const draft = animDraft(name);
    if (!lib || !draft || typeof lib.upsertKey !== "function") return { ok: false, code: "LIB_MISSING" };
    if (value !== null && exprAttachmentsFor(slotName).indexOf(value) < 0) {
      const msg = "ATTACHMENT_NOT_FOUND：" + value + " 不存在于槽 " + slotName + "（候选来自 model.skins/raw.slots）";
      setStatus(msg, "warn");
      notice("warn", msg);
      return { ok: false, code: "ATTACHMENT_NOT_FOUND" };
    }
    const up = lib.upsertKey(draft, "slots", slotName, "attachment", { name: value }, at);
    if (!up.ok) {
      const msg = ((up.issues && up.issues[0] && up.issues[0].message) || "SLOT_KEY_FAILED");
      setStatus(msg, "warn");
      return { ok: false, code: "SLOT_KEY_FAILED", issues: up.issues || [] };
    }
    const before = snapshot();
    if (!animSetDraft(name, up.value)) return { ok: false, code: "DRAFT_FAILED" };
    commit(before);
    state.edit.timeline.lastTrackEdit = {
      at: at,
      kind: "slot",
      owner: slotName,
      field: "attachment",
      op: up.replaced ? "set" : "add",
      changedPath: "animations.*.slots." + slotName + ".attachment",
      keyCount: Array.isArray(up.value.slots && up.value.slots[slotName] && up.value.slots[slotName].attachment)
        ? up.value.slots[slotName].attachment.length
        : null,
      issues: [],
    };
    animSetDraftRefresh();
    setStatus(
      (up.replaced ? "已更新 " : "已新增 ") + slotName + " 附件 Key @ " + round(at, 4) + "s → " +
        (value === null ? "（空 = 隐藏该槽）" : value) + " · 可 Ctrl+Z 撤销"
    );
    return { ok: true, replaced: !!up.replaced, value: value };
  }

  /** 当前选中的「可编辑轨道行」：额外轨道，或槽附件轨（P2-01） */
  function selectedTrackRow() {
    const extra = selectedExtraRow();
    if (extra) return extra;
    const skim = state.edit.timeline.selectedKey;
    const lib = timelineLib();
    if (skim && skim.kind === "slot" && skim.field === "attachment" && lib && skim.rowKey) {
      const built = dsBuild();
      for (const row of built.rows || []) {
        if (row.kind === "slot" && lib.rowKey(row) === skim.rowKey) return row;
      }
    }
    return null;
  }

  /** E2E/调试快照：额外轨道行 + 分组 + 事件 + 最近写入（只读，不写文档） */
  function trackSnapshot() {
    const built = dsBuild();
    const lib = timelineLib();
    const rows = (built.rows || []).filter((r) => isExtraKind(r.kind)).map((r) => ({
      rowKey: lib ? lib.rowKey(r) : null,
      kind: r.kind,
      owner: r.owner,
      field: r.field,
      editField: r.editField,
      label: extraLabelOf(r),
      keyCount: r.keyCount,
      keyTimes: (r.keys || []).map((k) => k.time),
      editable: r.editable !== false,
      unsupported: !!r.unsupported,
      previewPartial: !!r.previewPartial,
      group: r.group,
      legacy: !!r.legacy,
      vertexCount: r.vertexCount,
      offsetLength: r.offsetLength,
      weighted: !!r.weighted,
      keyFields: r.keyFields || null,
      valueField: r.valueField || null,
    }));
    const ev = currentEventsAt(state.t);
    const panel = el0("dsExtra");
    return {
      anim: state.anim || null,
      t: round(state.t, 6),
      rows: rows,
      groups: EXTRA_GROUPS.map((g) => ({ gid: g.gid, label: g.label, rows: rows.filter((r) => r.group === g.gid).length })),
      issues: (built.issues || []).map((i) => ({ code: i.code, path: i.path, message: i.message })),
      unsupported: built.unsupported || 0,
      keyCount: built.keyCount || 0,
      maxTime: built.maxTime || 0,
      eventNow: ev.now,
      eventLast: ev.last,
      lastEdit: state.edit.timeline.lastTrackEdit || null,
      panel: { visible: !!(panel && !panel.hidden), rowKey: state.edit.timeline.extraRowKey || null },
      groupOrder: EXTRA_GROUPS.map((g) => g.gid),
    };
  }

  function extraPanelState() {
    const row = selectedExtraRow();
    if (!row) return { visible: false, row: null };
    const form = extraFormState(row);
    const panel = el0("dsExtra");
    return {
      visible: !!(panel && !panel.hidden),
      rowKey: timelineLib() ? timelineLib().rowKey(row) : null,
      kind: row.kind,
      label: extraLabelOf(row),
      previewPartial: !!row.previewPartial,
      note: (el0("dsExtraNote") || {}).textContent || "",
      fields: extraPanelFields(row).map((f) => ({ name: f.name, type: f.type, default: f.default, min: f.min, max: f.max })),
      values: JSON.parse(JSON.stringify(form.values || {})),
      offsets: form.offsets ? JSON.parse(JSON.stringify(form.offsets)) : null,
      vertex: form.vertex ? JSON.parse(JSON.stringify(form.vertex)) : null,
      inputCount: el0("dsExtraBody") ? el0("dsExtraBody").querySelectorAll("input,select").length : 0,
    };
  }

  /* ==========================================================================
   * P2-05/P2-06（task-28）：镜像姿态 / 动画片段库 / 两骨 IK / 骨架结构工具
   *
   * 边界（task-28 口径）：
   *   · 镜像只经 SpinePoseTools.mirrorAnimation（整条 / 选中骨），曲线结构原样保留；
   *     AutoKey 关时先写 transient（临时预览）+ 显式「写入」按钮，避免静默改数据。
   *   · 片段库委托 SpinePoseTools.createClip / applyClip（底层 batch-edit 剪贴板语义），
   *     localStorage 版本化存储，跨骨架签名拒绝。
   *   · 两骨 IK 只经 SpineIkAim.solveTwoBone；**不接 FABRIK**（模块 NOT_IMPLEMENTED，UI 不暴露）。
   *   · 骨架结构只经 SpineIkAim.createBone/reparentBone/renameBone/deleteBone；
   *     结构变更改 state.raw → 重新解析 → 重建 boneList/slots，并走「结构修订号」进 undo。
   * ====================================================================== */
  function poseToolsLib() {
    return window.SpinePoseTools || null;
  }
  function ikAimLib() {
    return window.SpineIkAim || null;
  }
  function skeletonSig() {
    const T = window.SpineTrackEdit;
    if (!T || typeof T.skeletonSignature !== "function" || !state.model) return null;
    try {
      return T.skeletonSignature(state.model);
    } catch (e) {
      return null;
    }
  }

  /* ---- 镜像（P2-05） ---- */
  const MIRROR_LIMITATION = "数据级镜像；非 normal inherit / 左右不对称骨架不等价（只反转 rotate / translate / shear 数值）";

  function mirrorRun(scope) {
    const P = poseToolsLib();
    const name = state.anim || state.animEdit.sel;
    if (!P || typeof P.mirrorAnimation !== "function") return setStatus("pose-tools.js 未加载：无法镜像", "error");
    if (editMode() !== "animate") {
      setStatus("镜像当前动画需要「动画」模式（Setup 请用「镜像姿态」或片段预设）", "warn");
      return null;
    }
    if (!name) return setStatus("先选择一个动画", "warn");
    const raw = animDraft(name);
    if (!raw) return setStatus("当前动画没有可镜像数据", "warn");
    let bones = null;
    if (scope === "bone") {
      const sel = state.edit.selBone;
      if (!sel || !boneEntry(sel)) return setStatus("先选中一根骨，或用「镜像整条动画」", "warn");
      bones = [sel];
    }
    const res = P.mirrorAnimation(raw, { model: state.model, bones: bones, axis: "x" });
    if (!res || !res.ok) {
      const first = (res && res.issues && res.issues[0]) || { code: "MIRROR_FAILED", message: "" };
      setStatus("镜像失败：" + first.code + " " + (first.message || ""), "warn");
      return res;
    }
    const changedBones = [];
    for (const c of res.changed) {
      const bn = String(c).split(".")[1];
      if (bn && changedBones.indexOf(bn) < 0) changedBones.push(bn);
    }
    if (!res.changed.length) {
      setStatus("镜像：没有匹配到可镜像的骨轨道" + (bones ? "（选中骨没有 rotate/translate/shear 轨道）" : ""), "warn");
      return res;
    }
    const summary = {
      at: state.t,
      scope: scope,
      changed: res.changed.slice(),
      changedBones: changedBones,
      issues: (res.issues || []).map((i) => i.code),
      wrote: false,
      limitation: MIRROR_LIMITATION,
    };
    if (state.edit.autoKey) {
      /* AutoKey ON：直接落数据（一条事务） */
      const before = snapshot();
      if (!animSetDraft(name, res.value)) return res;
      if (state.edit.transient) state.edit.transient = null;
      commit(before);
      summary.wrote = true;
      state.edit.lastMirror = summary;
      animSetDraftRefresh();
      setStatus(
        "已镜像 " + res.changed.length + " 条轨道（" + changedBones.length + " 根骨 · " +
          (scope === "bone" ? "选中骨 " + bones[0] : "整条动画") + "，AutoKey 已写入）· 可 Ctrl+Z 撤销"
      );
      syncMirrorPanel();
      return res;
    }
    /* AutoKey 关：先 transient 预览，显式「写入」才改数据 */
    const baseline = snapshot();
    const applied = applyMirrorPreview(name, res.value);
    state.edit.pendingMirror = { animation: name, value: res.value, changed: res.changed, changedBones, issues: res.issues || [], scope: scope, baseline: baseline };
    state.edit.lastMirror = summary;
    syncMirrorPanel();
    render();
    syncInspector();
    syncEditToolbar();
    setStatus(
      (applied ? "镜像预览（未写入）" : "镜像已计算（预览不可用）") + "：" + res.changed.length + " 条轨道 / " +
        changedBones.length + " 根骨 → 点「写入镜像」落数据（AutoKey 关闭）"
    );
    notice("info", "镜像预览（未写入数据）：" + changedBones.join("、") + " → 点「写入镜像」或用 Ctrl+Z 之外的取消按钮", [
      { label: "写入镜像", onClick: () => commitPendingMirror() },
      { label: "取消", onClick: () => cancelPendingMirror() },
    ]);
    return res;
  }

  /** 把「镜像后的动画」在当前时刻的局部值写进 transient（只预览，不写文档） */
  function applyMirrorPreview(name, value) {
    const lib = animEditLib();
    if (!lib || !core || !state.raw) return false;
    const drafts = Object.assign({}, state.animEdit.drafts || {});
    drafts[name] = value;
    const merged = lib.applyAnimationDrafts(state.raw, drafts);
    if (!merged || !merged.ok) return false;
    const parsed = core.parseModel(merged.value, state.atlas, { skin: "default" });
    if (!parsed || parsed.ok !== true) return false;
    const pose = core.evalPose(parsed.value, { animation: name, time: state.t, skin: "default" });
    if (!pose || !pose.local) return false;
    const tr = { animation: name, time: state.t, bones: Object.create(null), fields: Object.create(null) };
    for (const b of state.boneList) {
      const loc = pose.local[b.index];
      if (!loc) continue;
      tr.bones[b.name] = {
        x: loc.x,
        y: loc.y,
        rotation: loc.rotation,
        scaleX: loc.scaleX,
        scaleY: loc.scaleY,
        shearX: loc.shearX || 0,
        shearY: loc.shearY || 0,
      };
      tr.fields[b.name] = ["x", "y", "rotation", "scaleX", "scaleY"];
    }
    state.edit.transient = tr;
    return true;
  }

  function commitPendingMirror() {
    const pm = state.edit.pendingMirror;
    if (!pm) return false;
    const before = pm.baseline || snapshot();
    const name = pm.animation;
    const res = animSetDraft(name, pm.value);
    state.edit.transient = null;
    state.edit.pendingMirror = null;
    if (!res) return false;
    commit(before);
    if (state.edit.lastMirror) state.edit.lastMirror.wrote = true;
    animSetDraftRefresh();
    syncMirrorPanel();
    setStatus("已写入镜像：" + pm.changed.length + " 条轨道 / " + pm.changedBones.length + " 根骨 · 可 Ctrl+Z 撤销");
    clearNotices();
    return true;
  }

  function cancelPendingMirror() {
    if (!state.edit.pendingMirror) return false;
    state.edit.pendingMirror = null;
    if (state.edit.transient) state.edit.transient = null;
    clearNotices();
    refreshDirty();
    syncAll();
    render();
    setStatus("已取消镜像预览（数据未改动）");
    return true;
  }

  /** Setup 姿态镜像（选中骨写入 boneList，一条事务） */
  function mirrorSetupPose() {
    const P = poseToolsLib();
    const name = state.edit.selBone;
    if (!P || typeof P.mirrorPose !== "function") return setStatus("pose-tools.js 未加载", "error");
    if (editMode() !== "setup") return setStatus("Setup 姿态镜像只在「绑定姿态」模式使用", "warn");
    if (!name) return setStatus("先选中一根骨", "warn");
    const entry = boneEntry(name);
    if (!entry) return null;
    const bones = state.boneList.map((b) => ({
      x: b.x, y: b.y, rotation: b.rotation,
      scaleX: b.scaleX == null ? 1 : b.scaleX, scaleY: b.scaleY == null ? 1 : b.scaleY,
      shearX: (state.model.bones[b.index] && state.model.bones[b.index].shearX) || 0,
      shearY: (state.model.bones[b.index] && state.model.bones[b.index].shearY) || 0,
    }));
    const res = P.mirrorPose({ bones: bones, indices: [entry.index] });
    if (!res || !res.ok) return setStatus("镜像姿态失败", "warn");
    const before = snapshot();
    const m = res.value[entry.index];
    entry.x = m.x;
    entry.rotation = m.rotation;
    const setup = state.model.bones[entry.index];
    if (setup) {
      setup.shearX = m.shearX;
      setup.shearY = m.shearY;
    }
    commit(before);
    state.edit.lastMirror = { at: state.t, scope: "pose", changed: ["bones." + name + ".x/rotation/shear"], changedBones: [name], issues: [], wrote: true, limitation: MIRROR_LIMITATION };
    syncAll();
    render();
    syncMirrorPanel();
    setStatus("已镜像骨 " + name + " 的 Setup 姿态（x/rotation/shear）· 可 Ctrl+Z 撤销");
    return res;
  }
  /* 0.9.50：#mirrorNote / #mirrorLimit 已随骨骼检查器删除。
     镜像能力不受影响：mirror() / mirrorRun() / mirrorPose() / mirrorWrite() / mirrorCancel()。 */
  function syncMirrorPanel() {
    return;
  }


  /* ---- 片段库（P2-05）：localStorage 版本化 ---- */
  const CLIPS_KEY = "dsh.character-editor.clips";
  const CLIPS_VERSION = 1;

  function clipsDefaults() {
    return { version: CLIPS_VERSION, clips: [], poses: [], collision: "overwrite" };
  }

  /** 读取 + 校验 + 损坏/版本不符回退（不覆盖原内容），localStorage 抛错只提示不阻断 */
  function loadClipStore() {
    const def = clipsDefaults();
    state.clips = def;
    let raw = null;
    try {
      raw = window.localStorage.getItem(CLIPS_KEY);
    } catch (e) {
      state.clipsError = "localStorage 不可用（" + (e && e.name ? e.name : "Error") + "）：片段库本次不持久化";
      return def;
    }
    if (!raw) return def;
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }
    if (!isRecord(parsed) || parsed.version !== CLIPS_VERSION) {
      state.clipsError = "片段库损坏或版本不符：已回退为空库（原内容未覆盖）";
      return def;
    }
    const clips = [];
    for (const c of Array.isArray(parsed.clips) ? parsed.clips : []) {
      if (!isRecord(c) || typeof c.name !== "string") continue;
      /* 存储项 = {id,name,...,clip:<clipToJSON 语义的片段>}；兼容早期直接把片段当项存 */
      const cand = isRecord(c.clip) ? c.clip : c;
      const P = poseToolsLib();
      const v = P && typeof P.validateClip === "function" ? P.validateClip(cand) : { ok: true };
      if (!v || !v.ok) continue;
      clips.push({
        id: typeof c.id === "string" ? c.id : clipId(),
        name: c.name,
        createdAt: c.createdAt || null,
        sourceAnimation: c.sourceAnimation || cand.sourceAnimation || null,
        skeletonSignature: c.skeletonSignature !== undefined ? c.skeletonSignature : cand.skeletonSignature || null,
        keyCount: Array.isArray(cand.items) ? cand.items.length : 0,
        clip: cand,
      });
    }
    const poses = [];
    for (const p of Array.isArray(parsed.poses) ? parsed.poses : []) {
      if (!isRecord(p) || typeof p.name !== "string" || !Array.isArray(p.bones)) continue;
      poses.push(p);
    }
    def.clips = clips.slice(0, 200);
    def.poses = poses.slice(0, 200);
    def.collision = parsed.collision === "skip" ? "skip" : "overwrite";
    state.clips = def;
    return def;
  }

  function saveClipStore() {
    if (!state.clips) return false;
    try {
      window.localStorage.setItem(CLIPS_KEY, JSON.stringify(state.clips));
      state.clipsError = "";
      return true;
    } catch (e) {
      state.clipsError = "片段库写入失败（" + (e && e.name ? e.name : "Error") + "）：本次改动只在内存";
      return false;
    }
  }

  function clipId() {
    return "c" + Date.now().toString(36) + Math.round(Math.random() * 1e4).toString(36);
  }

  /** 片段插入后统计实际变化的 Key 数（不依赖 delegate 的 counts 字段） */
  function countDraftDiff(a, b) {
    let n = 0;
    const walk = (x, y) => {
      if (x === y) return;
      if (x === null || y === null || typeof x !== typeof y || Array.isArray(x) !== Array.isArray(y)) {
        n++;
        return;
      }
      if (Array.isArray(x)) {
        if (x.length !== y.length) n += Math.abs(x.length - y.length);
        const len = Math.min(x.length, y.length);
        for (let i = 0; i < len; i++) walk(x[i], y[i]);
        return;
      }
      if (typeof x === "object") {
        const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
        for (const k of keys) {
          if (!(k in y) || !(k in x)) n++;
          else walk(x[k], y[k]);
        }
        return;
      }
      n++;
    };
    walk(a, b);
    return n;
  }

  function saveSelectionAsClip(name) {
    const P = poseToolsLib();
    const anim = state.anim || state.animEdit.sel;
    if (!P || typeof P.createClip !== "function") return setStatus("pose-tools.js 未加载", "error");
    if (!anim) return setStatus("先选择一个动画", "warn");
    const items = dsSelection().items.map((it) => ({ kind: it.kind, owner: it.owner, field: it.field, time: it.time }));
    if (!items.length) return setStatus("先在时间轴选中至少一个 Key 再保存片段", "warn");
    const raw = animDraft(anim);
    const res = P.createClip(raw, items, { model: state.model, sourceAnimation: anim, name: name || "clip", skeletonSignature: skeletonSig(), createdAt: new Date().toISOString() });
    if (!res || !res.ok) {
      const first = (res && res.issues && res.issues[0]) || { code: "CLIP_FAILED", message: "" };
      setStatus("保存片段失败：" + first.code + " " + (first.message || ""), "warn");
      return res;
    }
    const clip = res.value;
    const item = {
      id: clipId(),
      name: String(name || clip.name || "clip"),
      createdAt: new Date().toISOString(),
      sourceAnimation: clip.sourceAnimation || anim,
      skeletonSignature: clip.skeletonSignature || skeletonSig(),
      clip: clip,
      keyCount: Array.isArray(clip.items) ? clip.items.length : 0,
    };
    state.clips.clips.unshift(item);
    state.clips.clips = state.clips.clips.slice(0, 200);
    saveClipStore();
    renderClips();
    setStatus("已保存片段「" + item.name + "」：" + item.keyCount + " 个 Key（来源 " + item.sourceAnimation + "）");
    return item;
  }

  function deleteClip(id) {
    const i = state.clips.clips.findIndex((c) => c.id === id);
    if (i < 0) return false;
    state.clips.clips.splice(i, 1);
    saveClipStore();
    renderClips();
    setStatus("已删除片段");
    return true;
  }

  function renameClip(id, name) {
    const clip = state.clips.clips.filter((c) => c.id === id)[0];
    if (!clip) return false;
    const n = String(name || "").trim();
    if (!n) return setStatus("片段名不能为空", "warn");
    clip.name = n.slice(0, 60);
    saveClipStore();
    renderClips();
    setStatus("已重命名为「" + clip.name + "」");
    return true;
  }

  function insertClip(id) {
    const P = poseToolsLib();
    const anim = state.anim || state.animEdit.sel;
    if (!P || typeof P.applyClip !== "function") return setStatus("pose-tools.js 未加载", "error");
    const item = state.clips.clips.filter((c) => c.id === id)[0];
    if (!item) return setStatus("片段不存在", "warn");
    if (!anim) return setStatus("先选择一个动画", "warn");
    if (editMode() !== "animate") return setStatus("插入片段只在「动画」模式（写到当前动画的时间轴）", "warn");
    const sig = skeletonSig();
    if (item.skeletonSignature && sig && item.skeletonSignature !== sig) {
      setStatus("CLIP_SIGNATURE_MISMATCH：片段骨架签名与当前模型不一致，已拒绝插入", "warn");
      notice("warn", "片段「" + item.name + "」来自不同骨架（签名不一致），已拒绝插入；请在同骨架的模型里使用。");
      return null;
    }
    const raw = animDraft(anim);
    const res = P.applyClip(raw, item.clip, {
      atTime: state.t,
      collision: state.clips.collision === "skip" ? "skip" : "overwrite",
      lockedRows: tlLockedSet(),
      model: state.model,
      skeletonSignature: sig,
    });
    if (!res || !res.ok) {
      const first = (res && res.issues && res.issues[0]) || { code: "CLIP_APPLY_FAILED", message: "" };
      setStatus((first.code || "CLIP_APPLY_FAILED") + "：" + (first.message || "插入被拒绝（零改动）"), "warn");
      notice("warn", "片段插入被拒绝（零改动）：" + (first.code || "") + " " + (first.message || ""));
      return res;
    }
    const before = snapshot();
    if (!animSetDraft(anim, res.value)) return res;
    if (res.selectionAfter && res.selectionAfter.length) selectionSet(res.selectionAfter, res.selectionAfter[0] || null);
    commit(before);
    state.edit.lastClip = { id: item.id, name: item.name, at: state.t, pasted: res.pasted, skipped: res.skipped, collision: state.clips.collision, at2: state.t };
    animSetDraftRefresh();
    renderClips();
    const diffCount = countDraftDiff(raw, res.value);
    state.edit.lastClip = Object.assign(state.edit.lastClip || {}, { changedKeys: diffCount });
    setStatus("已插入片段「" + item.name + "」@" + round(state.t, 4) + "s：" + diffCount + " 处 Key 变化（碰撞 " + (state.clips.collision === "skip" ? "跳过" : "覆盖") + "）· 可 Ctrl+Z 撤销");
    return res;
  }

  /* ---- Setup 姿态预设（mirrorPose 同级容量） ---- */
  function savePosePreset(name) {
    if (!state.model) return setStatus("先载入模型", "warn");
    const bones = state.boneList.map((b) => {
      const setup = state.model.bones[b.index] || {};
      return {
        name: b.name,
        x: Number.isFinite(b.x) ? b.x : 0,
        y: Number.isFinite(b.y) ? b.y : 0,
        rotation: Number.isFinite(b.rotation) ? b.rotation : 0,
        scaleX: b.scaleX == null ? 1 : b.scaleX,
        scaleY: b.scaleY == null ? 1 : b.scaleY,
        shearX: Number.isFinite(setup.shearX) ? setup.shearX : 0,
        shearY: Number.isFinite(setup.shearY) ? setup.shearY : 0,
      };
    });
    const item = {
      id: clipId(),
      name: String(name || "pose").slice(0, 60),
      createdAt: new Date().toISOString(),
      skeletonSignature: skeletonSig(),
      bones: bones,
    };
    state.clips.poses.unshift(item);
    state.clips.poses = state.clips.poses.slice(0, 200);
    saveClipStore();
    renderClips();
    setStatus("已保存 Setup 姿态预设「" + item.name + "」：" + bones.length + " 根骨");
    return item;
  }

  function applyPosePreset(id, mirrored) {
    const P = poseToolsLib();
    const item = state.clips.poses.filter((p) => p.id === id)[0];
    if (!item) return setStatus("预设不存在", "warn");
    if (editMode() !== "setup") return setStatus("Setup 姿态预设只在「绑定姿态」模式应用", "warn");
    if (!state.model) return setStatus("先载入模型", "warn");
    const sig = skeletonSig();
    if (item.skeletonSignature && sig && item.skeletonSignature !== sig) {
      setStatus("POSE_SIGNATURE_MISMATCH：预设来自不同骨架，已拒绝应用", "warn");
      return null;
    }
    let bones = item.bones.map((b) => Object.assign({}, b));
    if (mirrored && P && typeof P.mirrorPose === "function") {
      const res = P.mirrorPose({ bones: bones });
      if (res && res.ok) bones = res.value;
    }
    const before = snapshot();
    const byName = Object.create(null);
    for (const b of bones) byName[b.name] = b;
    let applied = 0;
    for (const entry of state.boneList) {
      const src = byName[entry.name];
      if (!src) continue;
      entry.x = src.x;
      entry.y = src.y;
      entry.rotation = src.rotation;
      entry.scaleX = src.scaleX;
      entry.scaleY = src.scaleY;
      const setup = state.model.bones[entry.index];
      if (setup) {
        setup.shearX = src.shearX;
        setup.shearY = src.shearY;
      }
      applied++;
    }
    commit(before);
    syncEffectiveSetupBones();
    syncAll();
    render();
    setStatus("已应用 Setup 姿态预设「" + item.name + "」" + (mirrored ? "（镜像后）" : "") + "：" + applied + " 根骨 · 可 Ctrl+Z 撤销");
    return { ok: true, applied: applied };
  }

  function deletePosePreset(id) {
    const i = state.clips.poses.findIndex((p) => p.id === id);
    if (i < 0) return false;
    state.clips.poses.splice(i, 1);
    saveClipStore();
    renderClips();
    return true;
  }

  /** 片段/预设列表（DOM；重渲染重建，不进入每帧路径）
      0.9.49：列表 DOM（#clipList / #poseList / #clipStat）已随「片段库」整块从界面移除。
      这里保留函数本体与全部数据逻辑，只在首行早退 —— 这样 save/insert/apply/delete 之后
      仍然调用 renderClips() 而不会报错；将来把界面加回来，列表会立刻恢复。 */
  function renderClips() {
    if (!state.clips) return;
    const box = el0("clipList");
    const poseBox = el0("poseList");
    const stat = el0("clipStat");
    if (!box || !poseBox) return;
    const sig = skeletonSig();
    box.textContent = "";
    for (const item of state.clips.clips) {
      const row = el("div", "clip-row");
      const nameBtn = el("button", "clip-name", item.name);
      nameBtn.type = "button";
      nameBtn.title = "点击重命名";
      nameBtn.addEventListener("click", () => {
        const next = window.prompt("片段重命名", item.name);
        if (next !== null) renameClip(item.id, next);
      });
      const meta = el("span", "clip-meta", item.keyCount + " key · " + item.sourceAnimation + (item.skeletonSignature && sig && item.skeletonSignature !== sig ? " · 跨骨架" : ""));
      const ins = el("button", "btn btn-sm", "插入");
      ins.type = "button";
      ins.disabled = !!(item.skeletonSignature && sig && item.skeletonSignature !== sig);
      ins.title = ins.disabled ? "骨架签名不一致（跨骨架拒绝插入）" : "在播放头处插入片段（碰撞策略见上）";
      ins.addEventListener("click", () => insertClip(item.id));
      const del = el("button", "btn btn-icon btn-sm", "✕");
      del.type = "button";
      del.title = "删除该片段";
      del.addEventListener("click", () => deleteClip(item.id));
      row.appendChild(nameBtn);
      row.appendChild(meta);
      row.appendChild(ins);
      row.appendChild(del);
      box.appendChild(row);
    }
    if (!state.clips.clips.length) box.appendChild(el("p", "empty-note", "还没有片段：在时间轴选中 Key → 命名 → 保存。"));
    poseBox.textContent = "";
    for (const item of state.clips.poses) {
      const row = el("div", "clip-row");
      const nameBtn = el("button", "clip-name", item.name);
      nameBtn.type = "button";
      nameBtn.title = "点击重命名";
      nameBtn.addEventListener("click", () => {
        const next = window.prompt("预设重命名", item.name);
        if (next !== null) {
          item.name = String(next || "").trim().slice(0, 60) || item.name;
          saveClipStore();
          renderClips();
        }
      });
      const meta = el("span", "clip-meta", item.bones.length + " 骨");
      const apply = el("button", "btn btn-sm", "应用");
      apply.type = "button";
      apply.title = "把该 Setup 姿态写回当前绑定姿态（一条事务）";
      apply.addEventListener("click", () => applyPosePreset(item.id, false));
      const applyM = el("button", "btn btn-sm", "镜像应用");
      applyM.type = "button";
      applyM.title = "先镜像再应用（mirrorPose）";
      applyM.addEventListener("click", () => applyPosePreset(item.id, true));
      const del = el("button", "btn btn-icon btn-sm", "✕");
      del.type = "button";
      del.addEventListener("click", () => {
        deletePosePreset(item.id);
        renderClips();
      });
      row.appendChild(nameBtn);
      row.appendChild(meta);
      row.appendChild(apply);
      row.appendChild(applyM);
      row.appendChild(del);
      poseBox.appendChild(row);
    }
    if (!state.clips.poses.length) poseBox.appendChild(el("p", "empty-note", "还没有姿态预设：Setup 下调好姿态 → 命名 → 保存。"));
    if (stat) {
      stat.textContent =
        "片段 " + state.clips.clips.length + " · 预设 " + state.clips.poses.length +
        (state.clipsError ? " · " + state.clipsError : "");
    }
    /* 0.9.49：#clipCollision 下拉随片段库移除，这里不再回填它；
       冲突策略的状态由 __characterEditor.clipCollision() / clips().collision 反映。 */
  }

  /* ---- 两骨 IK（P2-06）：只经 SpineIkAim.solveTwoBone，不接 FABRIK ---- */
  /* 注意：spine-core 的 constraints[].bones / target 是**骨索引**（不是名字） */
  function ikConstraintForChain(parentIndex, childIndex) {
    const model = state.model;
    if (!model) return null;
    for (const c of model.constraints || []) {
      if (!c || !Array.isArray(c.bones)) continue;
      const n = c.bones.length;
      if (n >= 2 && c.bones[n - 1] === childIndex && c.bones[n - 2] === parentIndex) return c;
    }
    return null;
  }

  function ikChainOf(boneName) {
    const model = state.model;
    const entry = boneEntry(boneName);
    if (!model || !entry) return { ok: false, reason: "NO_SELECTION", message: "先选中一根骨（末端骨）" };
    const child = model.bones[entry.index];
    const pIdx = child.parentIndex;
    if (!(pIdx >= 0)) return { ok: false, reason: "NO_PARENT", message: "选中骨是根骨：两骨 IK 需要父骨" };
    const parent = model.bones[pIdx];
    if (!(Number.isFinite(child.length) && child.length > 0)) {
      return { ok: false, reason: "CHILD_LENGTH_ZERO", message: "选中骨 length=0：两骨 IK 需要末端骨有长度（本 rig 骨长全为 0 时不可用）" };
    }
    const constraint = ikConstraintForChain(pIdx, entry.index);
    const targetIdx = constraint && Number.isInteger(constraint.target) ? constraint.target : -1;
    const targetName = targetIdx >= 0 && model.bones[targetIdx] ? model.bones[targetIdx].name : null;
    return {
      ok: true,
      parentName: parent.name,
      childName: child.name,
      parentIndex: pIdx,
      childIndex: entry.index,
      targetName: targetName,
      targetIndex: targetIdx === undefined ? -1 : targetIdx,
      constraint: constraint,
      constraintName: constraint ? constraint.name : null,
      hasTarget: !!targetName,
      message: constraint
        ? "IK 约束 " + constraint.name + (targetName ? " · target " + targetName : " · 无 target（指针驱动）")
        : "无 IK 约束：自由目标（以指针为目标）",
    };
  }

  function setIkMode(on) {
    state.edit.ik.on = !!on;
    if (on && editTool() !== "pose") setEditTool("pose");
    syncEditToolbar();
    syncIkPanel();
    updateCursor();
    render();
    setStatus(
      state.edit.ik.on
        ? "IK（两骨）已开启：选中骨 + 其父骨，拖动画布让骨尖跟随指针（mix " + round(state.edit.ik.mix, 2) + "）"
        : "IK（两骨）已关闭"
    );
  }

  function setIkMix(v) {
    const n = Number(v);
    state.edit.ik.mix = clamp(Number.isFinite(n) ? n : 1, 0, 1);
    syncIkPanel();
    setStatus("IK mix = " + round(state.edit.ik.mix, 3));
  }
  /* 0.9.50：IK 面板随骨骼检查器删除。IK 能力不受影响：ik() / setIkMode() / setIkMix() / ikChain()。 */
  function syncIkPanel() {
    return;
  }


  function beginBoneIkGesture(e, screenPoint) {
    const IK = ikAimLib();
    const chain = ikChainOf(state.edit.selBone);
    state.edit.ik.chain = chain && chain.ok ? chain : null;
    if (!IK || typeof IK.solveTwoBone !== "function") {
      setStatus("ik-aim.js 未加载：IK 不可用", "error");
      return false;
    }
    if (!chain || !chain.ok) {
      setStatus((chain && (chain.message || chain.reason)) || "IK 链不可用", "warn");
      syncIkPanel();
      return false;
    }
    const pose = state.frame && state.frame.pose;
    if (!pose || !pose.world) return false;
    const parentWorld = pose.world[chain.parentIndex];
    const grandIdx = state.model.bones[chain.parentIndex].parentIndex;
    const grandWorld = grandIdx >= 0 && pose.world[grandIdx] ? pose.world[grandIdx] : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    if (!parentWorld) return false;
    const constraintMix = chain.constraint && Number.isFinite(chain.constraint.mix) ? chain.constraint.mix : 1;
    state.drag = {
      mode: "bone-ik",
      pointerId: e.pointerId,
      boneName: chain.childName,
      parentName: chain.parentName,
      childName: chain.childName,
      chain: chain,
      startWorld: unproj(screenPoint.x, screenPoint.y),
      parentWorld: parentWorld,
      grandWorld: grandWorld,
      startParent: localOfBone(chain.parentName),
      startChild: localOfBone(chain.childName),
      mix: Number.isFinite(state.edit.ik.mix) ? state.edit.ik.mix : constraintMix,
      bendPositive: chain.constraint && chain.constraint.bendPositive === false ? false : true,
      baseline: snapshot(),
      moved: false,
      lastReason: "",
    };
    cv.setPointerCapture(e.pointerId);
    updateCursor();
    render();
    return true;
  }

  function updateBoneIkGesture(screenPoint) {
    const IK = ikAimLib();
    const d = state.drag;
    if (!IK || !d) return;
    const world = unproj(screenPoint.x, screenPoint.y);
    const model = state.model;
    const pIdx = state.bones[d.parentName] ? state.bones[d.parentName].index : -1;
    const cIdx = state.bones[d.childName] ? state.bones[d.childName].index : -1;
    if (pIdx < 0 || cIdx < 0) return;
    const setupP = model.bones[pIdx];
    const setupC = model.bones[cIdx];
    const pLocal = d.startParent;
    const cLocal = d.startChild;
    const res = IK.solveTwoBone({
      parent: {
        x: pLocal.x, y: pLocal.y, rotation: pLocal.rotation,
        scaleX: pLocal.scaleX, scaleY: pLocal.scaleY,
        shearX: pLocal.shearX || 0, shearY: pLocal.shearY || 0,
        length: Number.isFinite(setupP.length) ? setupP.length : 0,
      },
      child: {
        x: cLocal.x, y: cLocal.y, rotation: cLocal.rotation,
        scaleX: cLocal.scaleX, scaleY: cLocal.scaleY,
        shearX: cLocal.shearX || 0, shearY: cLocal.shearY || 0,
        length: Number.isFinite(setupC.length) ? setupC.length : 0,
      },
      parentWorld: d.parentWorld,
      grandWorld: d.grandWorld,
      targetWorld: world,
      bendPositive: d.bendPositive,
      mix: d.mix,
      stretch: false,
      softness: 0,
      path: "ik." + (d.chain.constraintName || "free"),
    });
    if (!res || !res.ok) {
      const first = (res && res.issues && res.issues[0]) || { code: res && res.reason, message: "" };
      d.lastReason = (first.code || "IK_FAILED") + " " + (first.message || "");
      state.edit.ik.lastReason = d.lastReason;
      setStatus("IK 不可解（零写入）：" + d.lastReason, "warn");
      syncIkPanel();
      return;
    }
    d.moved = true;
    d.lastReason = "";
    state.edit.ik.lastReason = "";
    writeLocalBone(d.parentName, { rotation: res.rotations[0] });
    writeLocalBone(d.childName, { rotation: res.rotations[1] });
    const tip = res.tipWorld ? proj(res.tipWorld.x, res.tipWorld.y) : null;
    setStatus(
      "IK 拖动：mix " + round(d.mix, 2) + " · Δ父 " + fmt(res.deltaDeg[0], 1) + "° / Δ子 " + fmt(res.deltaDeg[1], 1) + "°" +
        (res.outOfReach ? " · 目标超出可达范围（已夹取）" : "") +
        (tip ? " · tip 屏幕 (" + Math.round(tip.x) + "," + Math.round(tip.y) + ")" : "")
    );
    render();
  }

  /* ---- 骨架结构（P2-06，Setup only） ---- */
  /** 结构修订号：让「改 raw 骨架」也进既有快照/undo（内容快照里带 sk） */
  function pushSkelRevision(raw) {
    if (!state.skelHistory) state.skelHistory = [JSON.parse(JSON.stringify(state.raw))];
    state.skelRev = (state.skelRev || 0) + 1;
    state.skelHistory[state.skelRev] = JSON.parse(JSON.stringify(raw));
    /* 只保留最近 12 个结构修订（索引整体前移，快照里的 sk 同步修正） */
    if (state.skelRev > 12) {
      const drop = state.skelRev - 12;
      state.skelHistory = state.skelHistory.slice(drop);
      state.skelRev -= drop;
      state.skelRevShift = (state.skelRevShift || 0) + drop;
    }
    return state.skelRev;
  }

  /** 用新 raw 重建解析态（骨/槽/约束/动画），保留选中骨名与当前动画名 */
  function rebuildFromRaw(raw, opts) {
    if (!core || !state.model) return { ok: false, issues: [{ code: "CORE_MISSING" }] };
    const parsed = core.parseModel(raw, state.atlas, { skin: "default" });
    if (!parsed || parsed.ok !== true) {
      const errors = ((parsed && parsed.issues) || []).filter((i) => i.severity === "error");
      return { ok: false, issues: errors.length ? errors : parsed && parsed.issues };
    }
    const fresh = parsed.value;
    const wantBone = (opts && opts.selectBone) || state.edit.selBone;
    const wantAnim = state.anim;
    const wantSlot = state.sel >= 0 && state.slots[state.sel] ? state.slots[state.sel].name : null;
    state.raw = raw;
    state.model = fresh;
    state.boneList = fresh.bones.map((b, i) => ({
      name: b.name,
      parentName: b.parentIndex >= 0 && fresh.bones[b.parentIndex] ? fresh.bones[b.parentIndex].name : null,
      x: b.x,
      y: b.y,
      rotation: b.rotation,
      scaleX: b.scaleX,
      scaleY: b.scaleY,
      index: i,
    }));
    state.bones = Object.create(null);
    for (const b of state.boneList) state.bones[b.name] = b;
    state.slots = fresh.slots.map((sl, i) => ({
      name: sl.name,
      index: i,
      boneIndex: sl.boneIndex,
      boneName: fresh.bones[sl.boneIndex] ? fresh.bones[sl.boneIndex].name : "",
      attachment: sl.setupAttachment,
    }));
    state.constraints = fresh.constraints || [];
    /* 结构变化后草稿的 owner 名/索引可能失效：保守清空（调用前已要求无草稿） */
    state.animEdit.drafts = Object.create(null);
    state.animEdit.rev = (state.animEdit.rev || 0) + 1;
    state.animEdit.applied = state.animEdit.applied || Object.create(null);
    extraScanCache = { key: "", value: null };
    if (wantAnim && fresh.animations.has(wantAnim)) {
      state.anim = wantAnim;
      state.animDur = animDuration(wantAnim);
      if (state.t > state.animDur) state.t = state.animDur;
    } else if (!fresh.animations.has(state.anim)) {
      state.anim = fresh.animations.size ? Array.from(fresh.animations.keys())[0] : "";
      state.animDur = state.anim ? animDuration(state.anim) : 0;
      state.t = 0;
    }
    state.edit.selBone = wantBone && state.bones[wantBone] ? wantBone : null;
    state.sel = wantSlot ? state.slots.findIndex((s) => s.name === wantSlot) : -1;
    if (state.sel >= state.slots.length) state.sel = -1;
    state.edit.transient = null;
    syncAnimSelect();
    framePose();
    syncAll();
    render();
    onModelChanged();
    return { ok: true };
  }

  function skeletonValidateNow() {
    const IK = ikAimLib();
    if (!IK || typeof IK.validateSkeleton !== "function" || !state.raw) return { ok: false, issues: [] };
    const res = IK.validateSkeleton(state.raw);
    state.edit.skelLast = {
      at: state.t,
      ok: !!res.ok,
      issues: (res.issues || []).map((i) => ({ code: i.code, path: i.path, message: i.message })),
    };
    return res;
  }

  /** 结构操作统一入口：Setup only / 无动画草稿 / 单条事务（含结构修订号） */
  function skelApply(kind, label, fn, selectBone, post) {
    const IK = ikAimLib();
    if (!IK) return setStatus("ik-aim.js 未加载：骨架结构不可用", "error");
    if (editMode() !== "setup") return setStatus("骨架结构操作只在「绑定姿态」模式（避免破坏动画 Key）", "warn");
    if (animHasDraft()) {
      setStatus("存在未保存的动画草稿：结构操作会重解析骨架，请先保存或丢弃动画编辑后再改结构", "warn");
      return null;
    }
    const before = snapshot();
    const res = fn(IK, state.raw);
    if (!res || !res.ok) {
      const first = (res && res.issues && res.issues[0]) || { code: res && res.reason, message: "" };
      const refs = (res && res.references) || [];
      setStatus((first.code || kind + "_FAILED") + "：" + (first.message || "结构操作被拒绝（零改动）") + (refs.length ? "（引用 " + refs.length + " 处）" : ""), "warn");
      notice("warn", "结构操作被拒绝（零改动）：" + (first.code || "") + (first.message ? " " + first.message : "") + (refs.length ? "；引用清单：" + refs.slice(0, 6).join("、") : ""));
      state.edit.skelLast = { at: state.t, ok: false, issues: [{ code: first.code || kind + "_FAILED", path: first.path || "", message: first.message || "" }], references: refs, label: label };
      syncSkeletonPanel();
      return res;
    }
    /* 模块未覆盖的引用迁移（如动画轨道名）由调用方在重解析前补上（post 返回处理说明） */
    if (typeof post === "function") res.post = post(res.value) || null;
    const rb = rebuildFromRaw(res.value, { selectBone: selectBone });
    if (!rb.ok) {
      setStatus("结构修改后重解析失败：" + issueText(rb.issues, 2), "error");
      return rb;
    }
    pushSkelRevision(res.value);
    commit(before);
    skeletonValidateNow();
    syncSkeletonPanel();
    const soft = (res.issues || []).filter((i) => i.code === "REPARENT_INHERIT_LIMITATION" || i.code === "REPARENT_NORMALIZED_SHEAR");
    setStatus(
      label + " 完成" + (res.updated ? "（" + res.updated.length + " 处更新）" : "") +
        (soft.length ? " · 注意：" + soft.map((i) => i.code).join("、") : "") + " · 可 Ctrl+Z 撤销"
    );
    return res;
  }

  function skelCreateBone(payload) {
    return skelApply("createBone", "新建骨 " + (payload && payload.name), (IK, raw) =>
      IK.createBone(raw, {
        name: payload.name,
        parent: payload.parent === undefined || payload.parent === "" ? null : payload.parent,
        x: payload.x,
        y: payload.y,
        rotation: payload.rotation,
        length: payload.length,
      }), payload && payload.name);
  }

  function skelReparent(boneName, newParent, keepWorld) {
    return skelApply("reparentBone", "重父级 " + boneName + " → " + (newParent || "（root）"), (IK, raw) =>
      IK.reparentBone(raw, { boneName: boneName, newParent: newParent === "" ? null : newParent, keepWorld: keepWorld !== false }), boneName);
  }

  function skelRenameBone(boneName, to) {
    return skelApply(
      "renameBone",
      "重命名 " + boneName + " → " + to,
      (IK, raw) => IK.renameBone(raw, { from: boneName, to: to }),
      to,
      /* 模块只同步 bones[].parent / slots[].bone / 约束；**动画轨道名**由这里迁移，
         否则旧名轨成孤儿（动画丢失但 validateSkeleton 仍通过） */
      (raw) => {
        const moved = [];
        for (const animName of Object.keys(raw.animations || {})) {
          const a = raw.animations[animName];
          const bag = a && a.bones;
          if (!isRecord(bag) || !(boneName in bag)) continue;
          if (to in bag) continue;
          bag[to] = bag[boneName];
          delete bag[boneName];
          moved.push(animName);
        }
        return { animationTracksRenamed: moved };
      }
    );
  }

  function skelDeleteBone(boneName) {
    return skelApply("deleteBone", "删除骨 " + boneName, (IK, raw) => IK.deleteBone(raw, { name: boneName }), null);
  }
  /* 0.9.50：#skelBody / #skelIssues / #skelInfo 已随骨架结构面板删除。
     骨架结构操作不受影响：skelCreate / skelDelete / skelReparent / skelRename / skelValidate。 */
  function syncSkeletonPanel() {
    return;
  }


  /* ---- 保存前校验（P2-06） ---- */
  function preSaveSkeletonCheck() {
    const IK = ikAimLib();
    if (!IK || !state.raw) return { ok: true, issues: [] };
    const res = IK.validateSkeleton(state.raw);
    const errors = (res.issues || []).filter((i) => i.code === "BONE_NAME_DUPLICATE" || i.code === "BONE_CYCLE" || i.code === "BONE_PARENT_MISSING" || i.code === "SLOT_BONE_MISSING" || i.code === "CONSTRAINT_BONE_MISSING");
    if (errors.length) {
      const text = errors.slice(0, 6).map((i) => i.code + " " + (i.message || "")).join("\n");
      const ok = typeof window.confirm === "function" ? window.confirm("骨架校验发现问题（" + errors.length + " 个 error）：\n" + text + "\n\n仍然保存？") : false;
      if (!ok) return { ok: false, blocked: true, issues: errors };
    }
    return { ok: true, issues: res.issues || [] };
  }

  /* ---- task-32：新建形变只允许官方可加载附件 + DEFORM_* 中文映射 ---- */
  const DEFORM_CODE_TEXT = {
    DEFORM_LENGTH_UNKNOWN: "无法推出形变偏移长度（该附件没有 baseline 形变数据），已拒绝创建",
    DEFORM_SKIN_REQUIRED: "多 skin 且没有 default skin：需要显式指定 skin 名",
    DEFORM_CREATE_ARRAY_SKINS_UNSUPPORTED: "attachments 是数组式多 skin 结构，不支持从零创建形变轨",
    DEFORM_FIELD_REQUIRED: "旧式 deform.<slot> 轨道不能从零创建，请选择具体附件",
    DEFORM_LENGTH_MISMATCH: "形变顶点数与该附件的偏移长度不一致，已拒绝写入",
    DEFORM_TARGET_MISSING: "形变目标附件不存在",
    DEFORM_ATTACHMENT_MISSING: "附件不存在或不是网格",
    DEFORM_CREATE_UNSUPPORTED: "该附件不支持从零创建形变轨",
    DEFORM_NOT_MESH: "该附件不是网格（region 形变是非官方扩展，官方 runtime 加载会抛异常）",
    DEFORM_REGION_UNSUPPORTED: "region 形变是非官方扩展，官方 runtime 无法加载",
    TRACK_NOT_FOUND: "轨道不存在（create:false 时不会新建）",
    TRACK_LOCKED: "该轨已锁定",
    TIME_INVALID: "时间值非法",
  };
  function deformCodeText(code) {
    if (!code) return "";
    return DEFORM_CODE_TEXT[code] || code;
  }

  /** 附件索引：`<skin>/<slot>/<att>` 与 `<slot>/<att>` 双键（用于模块未给 official/kind 时本地判定） */
  function attachmentIndex() {
    const byPair = Object.create(null);
    const model = state.model;
    if (!model || !model.attachments || typeof model.attachments.forEach !== "function") return byPair;
    model.attachments.forEach((att) => {
      if (!att || typeof att.id !== "string") return;
      const parts = att.id.split("/");
      const attName = parts[parts.length - 1];
      const slotName = parts[parts.length - 2];
      if (slotName && attName) byPair[slotName + "/" + attName] = att;
    });
    return byPair;
  }

  /** 官方可加载性：优先模块字段（task-31 的 official/kind），缺失则本地按附件类型判定 */
  function deformTargetOfficial(t, attByPair) {
    if (t && typeof t.official === "boolean") return t.official;
    const kind = t && (t.kind || t.type);
    if (typeof kind === "string" && kind) return kind !== "region";
    const att = attByPair[t.slotName + "/" + t.attachmentName];
    return !att || att.type !== "region";
  }

  function deformTargetKind(t, attByPair) {
    if (t && typeof t.kind === "string" && t.kind) return t.kind;
    const att = attByPair[t.slotName + "/" + t.attachmentName];
    return att && att.type === "region" ? "region" : t.weighted ? "weighted-mesh" : "mesh";
  }

  /** 候选文案：加权 = 2×influence（显示 influence 数），刚性 = 2×顶点 */
  function deformTargetLabel(t, kind) {
    const off = Number.isFinite(t.offsetLength) ? t.offsetLength : null;
    if (kind === "region") {
      return t.slotName + "/" + t.attachmentName + " · region · " + t.vertexCount + " 顶点 · 偏移长度 " + off + "（非官方，不列）";
    }
    if (t.weighted) {
      const infl = off === null ? null : off / 2;
      return (
        t.slotName + "/" + t.attachmentName + " · 加权 mesh · " + t.vertexCount + " 顶点 · " +
        (infl === null ? "influence 未知" : infl + " influence") + " · 偏移长度 " + off + "（= 2×influence）"
      );
    }
    return t.slotName + "/" + t.attachmentName + " · 刚性 mesh · " + t.vertexCount + " 顶点 · 偏移长度 " + off + "（= 2×顶点）";
  }

  /** P2-01/02 + task-29/32：给「没有形变轨」的附件从零新建形变 Key（planKeyEdit create） */
  function newDeformKey() {
    const T = trackEditLib();
    const name = state.anim || state.animEdit.sel;
    if (!T || typeof T.deformTargets !== "function" || typeof T.planKeyEdit !== "function") return setStatus("track-edit.js 未加载：无法新建形变", "error");
    if (!name) return setStatus("先选择一个动画", "warn");
    if (state.playing) return setStatus("播放中：先暂停", "warn");
    const attByPair = attachmentIndex();
    const all = T.deformTargets(state.model, animDraft(name)) || [];
    const official = [];
    const hidden = [];
    for (const t of all) {
      const kind = deformTargetKind(t, attByPair);
      if (deformTargetOfficial(t, attByPair)) official.push({ t, kind });
      else hidden.push({ t, kind });
    }
    if (!official.length) {
      const extra = hidden.length ? "（已隐藏 " + hidden.length + " 个 region 附件：region 形变是非官方扩展，官方 runtime 加载会抛异常）" : "";
      return setStatus("没有官方可加载的形变目标（需要 mesh 或加权 mesh 附件）" + extra, "warn");
    }
    const lines = official.map((e, i) => i + 1 + ") " + deformTargetLabel(e.t, e.kind));
    let pick = null;
    if (typeof window.prompt === "function") {
      const hiddenNames = hidden.map((e) => e.t.slotName + "/" + e.t.attachmentName);
      const hiddenShort = hiddenNames.slice(0, 5).join("、") + (hiddenNames.length > 5 ? " 等 " + hiddenNames.length + " 个" : "");
      const head = hidden.length
        ? "已隐藏 " + hidden.length + " 个 region 附件（region 形变是非官方扩展，官方 runtime 加载会抛异常）：" + hiddenShort + "\n"
        : "";
      const raw = window.prompt(head + "选择要新建形变 Key 的官方可加载附件（输入序号）：\n" + lines.join("\n"), "1");
      if (raw === null) return null;
      const idx = Number(String(raw).trim());
      pick = Number.isInteger(idx) && idx >= 1 && idx <= official.length ? official[idx - 1] : null;
    }
    if (!pick) return setStatus("未选择有效的形变附件", "warn");
    const t = pick.t;
    const row = { kind: "deform", owner: t.slotName, field: t.attachmentName, editField: t.attachmentName, extra: true, legacy: false };
    const res = trackWrite(row, { op: "add", time: state.t, value: {} }, "新建形变 Key " + t.slotName + "/" + t.attachmentName);
    if (res && res.ok) {
      state.edit.timeline.extraRowKey = timelineLib() ? timelineLib().rowKey(row) : null;
      state.edit.timeline.extraForm = null;
      state.edit.lastNewDeform = {
        at: state.t,
        target: t.slotName + "/" + t.attachmentName,
        kind: pick.kind,
        vertexCount: t.vertexCount,
        offsetLength: t.offsetLength,
        weighted: !!t.weighted,
        hiddenRegions: hidden.map((e) => e.t.slotName + "/" + e.t.attachmentName),
        official: true,
      };
      renderExtraPanel();
      dsSyncBars();
      dsDraw();
      syncSkeletonPanel && syncSkeletonPanel();
    }
    return res;
  }

  /* ==========================================================================
   * 单一界面（task-41）：文档模式 + 人话文案 + 位置快捷命令的小工具
   *
   * 0.4.x 的「简单/高级双模式」已整体移除：没有 uiMode、没有 mode-simple/mode-advanced、
   * 没有第二套布局。这里只保留三件事：
   *   · simpleStatusText()：把常见状态/错误换成普通人能读的话（未知错误给统一兜底）
   *   · syncChrome()：标题、文档名、未保存标记、撤销/重做可用性、文档模式按钮、时间条重绘
   *   · simple.* 位置快捷命令用到的小工具（当前部位 / 位置 Key / 时间↔像素）
   * 界面布局由 index.html + ui.css 决定，脚本不再切换模式。
   * ====================================================================== */
  const SIMPLE_FALLBACK = "这一步暂时做不了，改动已保留。可在右侧「更多」里查看原因。";

  /** 明显的实现细节痕迹（用于决定是否兜底成人话） */
  function looksTechnical(text) {
    const s = String(text || "");
    return /[A-Z][A-Z0-9_]{3,}/.test(s) || /\b(undefined|null|NaN|TypeError)\b/.test(s);
  }

  /** 动态文案映射：已知短语换人话；未知且像实现细节 → 统一兜底 */
  function simpleStatusText(text, kind) {
    const s = String(text == null ? "" : text).trim();
    if (!s) return s;
    const map = [
      [/^已载入 /, "已打开人物包。"],
      [/^已保存 \d+ 个文件/, "已保存到原包。"],
      [/^已保存到 /, "已保存到原包。"],
      [/未载入|未加载/, "还没有打开人物包。"],
      [/^模式：/, ""],
      [/^动画：/, ""],
      [/^已选中骨 /, "已选中这个部位。"],
      [/^已清除骨骼选择|已清除骨选择/, "已取消选择。"],
      [/^拖动：/, ""],
      [/^缩放：|^平移：/, ""],
      [/^未打关键帧/, "当前姿势还没记住，可按「添加关键帧」。"],
      [/^已在 .* 写入 .* Key/, "已记住当前位置。"],
      [/^Key /, ""],
      [/^已删除/, "已删除这个位置关键帧。可撤销。"],
      [/^已撤销|^撤销/, "已撤销。"],
      [/^已重做|^重做/, "已重做。"],
      [/^预览中|返回绑定姿态/, "播放中，暂停后才能调整。"],
      [/^先选一个动画/, "先选一个动画。"],
      [/^播放|^暂停/, "播放状态已切换。"],
      [/^时间轴/, ""],
      [/^偏好/, ""],
      [/^没有找到语音包/, ""],
      [/^已收起|^已展开/, ""],
    ];
    for (const [re, out] of map) {
      if (re.test(s)) return out;
    }
    if (looksTechnical(s)) {
      return kind === "warn" || kind === "error" ? SIMPLE_FALLBACK : "已完成本次操作。";
    }
    return s;
  }

  /** 部位显示名（单一界面直接显示原名；空则占位） */
  function simpleLayerLabel(boneName) {
    return boneName || "未选部位";
  }

  /** 文档模式（Setup / Animate）：画布角按钮 + 工具条 select 双向同步 */
  function syncDocMode() {
    const mode = editMode();
    /* task-42：文档模式唯一真源 = 顶部第 2 排的两个按钮 */
    const setupBtn = el0("docModeSetup");
    if (setupBtn) setupBtn.setAttribute("aria-pressed", String(mode === "setup"));
    const animBtn = el0("docModeAnimate");
    if (animBtn) animBtn.setAttribute("aria-pressed", String(mode === "animate"));
    const sel = el0("editMode");
    if (sel && sel.value !== mode) sel.value = mode;
  }

  /* 0.9.49：syncPropCommon() 随「常用属性」区一并移除（它的唯一消费者是 #propEmpty/#propBody/
     #bpx/#bpy/#brot2/#bscale/#propKeyBtn/#propKeyState 这一批已删除的 DOM）。
     回显职责转交：选中部件看 #selBody（syncInspector），选中骨骼看 #boneBody（syncBoneInspector）。 */
  /** 「更多面板」（事件/表情/动画）开合（默认折叠；状态进 prefs） */
  function extraOpen() {
    return !!(state.ui && state.ui.extraOpen);
  }

  function setExtraOpen(on) {
    if (!state.ui) state.ui = {};
    state.ui.extraOpen = !!on;
    const btn = el0("extraToggle");
    const body = el0("extraBody");
    if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
    if (body) body.hidden = !on;
    if (typeof savePrefs === "function") savePrefs();
    return !!on;
  }

  /* 0.9.49：片段库整块 DOM 已从界面移除（用户要求），折叠按钮 #clipToggle 不复存在，
     因此这两个函数不会再有任何点击来源。保留它们是因为 prefs.ui.clipOpen 仍是个合法偏好字段
     （旧配置里可能写着 true，直接删字段会让 loadPrefs 的容错逻辑出现未知键），
     而且 __characterEditor.simpleUi().visible.clipSection 需要它作为「是否有界面」的语义来源。
     真要恢复折叠区时，把 DOM 加回来即可复用。 */
  /** 片段库开合（默认折叠；状态进 prefs；0.9.49 起界面上没有该折叠区） */
  function clipOpen() {
    return !!(state.ui && state.ui.clipOpen);
  }

  function setClipOpen(on) {
    if (!state.ui) state.ui = {};
    state.ui.clipOpen = !!on;
    const btn = el0("clipToggle");
    const body = el0("clipBody");
    if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
    if (body) body.hidden = !on;
    if (typeof savePrefs === "function") savePrefs();
    return !!on;
  }

  /** 「更多」分区开合（默认折叠；状态进 prefs，不写 JSON、不进 dirty） */
  function moreOpen() {
    return !!(state.ui && state.ui.moreOpen);
  }

  function setMoreOpen(on) {
    if (!state.ui) state.ui = {};
    state.ui.moreOpen = !!on;
    const btn = el0("moreToggle");
    const body = el0("moreBody");
    if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
    if (body) body.hidden = !on;
    if (typeof savePrefs === "function") savePrefs();
    return !!on;
  }

  /** 顶栏 + 画布角 + 状态栏的同步（载入 / dirty / 撤销栈 / 选中 变化时调用；幂等） */
  function syncChrome() {
    const v = editorVersion();
    document.title = v.label + " " + v.version;
    const docName = el0("docName");
    if (docName) {
      const label = state.bundle && state.bundle.base ? String(state.bundle.base).split("/").filter(Boolean).pop() : "";
      docName.textContent = state.model ? label || "人物包" : "未打开人物包";
      docName.title = state.model ? (state.bundle && state.bundle.base) || "" : "";
    }
    const unsaved = el0("docUnsaved");
    if (unsaved) unsaved.hidden = !state.dirty;
    const undoBtn = el0("btnUndoTop");
    if (undoBtn) undoBtn.disabled = !(state.undo && state.undo.length);
    const redoBtn = el0("btnRedoTop");
    if (redoBtn) redoBtn.disabled = !(state.redo && state.redo.length);
    const saveBtn = el0("btnSaveTop");
    if (saveBtn) saveBtn.disabled = !state.model;
    syncDocMode();
    syncFtButton();
    const hint = el0("toolHint");
    if (hint) hint.innerHTML = "拖动移动 · 按住 Space 平移 · 滚轮缩放 · <b>?</b> 帮助";
  }

  /* ---- 位置快捷命令用的小工具（与界面无关，simple.* 与时间条共用） ---- */
  function simpleActiveRow() {
    const bone = state.edit && state.edit.selBone;
    const anim = state.anim;
    if (!bone || !anim) return null;
    return { kind: "bone", owner: bone, field: "translate" };
  }

  function simplePositionKeys() {
    const bone = state.edit && state.edit.selBone;
    const anim = state.anim;
    if (!bone || !anim) return [];
    const raw = animDraft(anim);
    const bag = raw && raw.bones && raw.bones[bone] && raw.bones[bone].translate;
    if (!Array.isArray(bag)) return [];
    return bag
      .filter((k) => k && Number.isFinite(k.time))
      .map((k) => ({ time: k.time, x: Number.isFinite(k.x) ? k.x : 0, y: Number.isFinite(k.y) ? k.y : 0, curve: k.curve }))
      .sort((a, b) => a.time - b.time);
  }


  /* 单一时间轴（task-41）：不再有第二套底部关键帧条；所有 Key 编辑都走 #dopesheet。 */
  /* ---- 简单模式六动作 ---- */
  function simpleAddKey() {
    const bone = state.edit && state.edit.selBone;
    const anim = state.anim;
    const gate = simpleRequireAnimate();
    if (gate) return gate;
    if (!bone) return simpleResult(false, "NO_LAYER", "先点一个部位。");
    if (state.playing) {
      setStatus("播放中，请先暂停再调整。", "warn");
      return simpleResult(false, "PLAYING", "播放中，请先暂停。");
    }
    const row = { kind: "bone", owner: bone, field: "translate" };
    const loc = localOfBone(bone);
    const res = trackWrite(row, { op: "add", time: state.t, value: { x: loc.x, y: loc.y } }, "添加位置关键帧");
    if (res && res.ok) {
      state.edit.simpleKeyTime = state.t;
      syncChrome();
      setStatus("已记住当前位置（" + round(state.t, 3) + "s）。");
    }
    return simpleResult(!!(res && res.ok), (res && res.issues && res.issues[0] && res.issues[0].code) || null, "已记住当前位置。", { time: state.t });
  }

  function simpleDeleteKey(time, opts) {
    const o = opts || {};
    const bone = state.edit && state.edit.selBone;
    const anim = state.anim;
    const gate = simpleRequireAnimate();
    if (gate) return gate;
    if (!bone) return simpleResult(false, "NO_LAYER", "先点一个部位。");
    const t = Number.isFinite(time) ? time : state.edit.simpleKeyTime;
    if (!Number.isFinite(t)) return simpleResult(false, "NO_KEY", "这里没有可以删除的位置关键帧。");
    const keys = simplePositionKeys();
    const key = keys.filter((k) => Math.abs(k.time - t) < 1e-6)[0];
    if (!key) return simpleResult(false, "NO_KEY", "这里没有可以删除的位置关键帧。");
    /* 曲线段保护：直接提示去高级，不弹假确认 */
    const TL = timelineLib();
    const bag = (function () {
      const raw = animDraft(anim);
      return raw && raw.bones && raw.bones[bone] && raw.bones[bone].translate;
    })();
    const idx = TL && typeof TL.keyIndexAtTime === "function" && Array.isArray(bag) ? TL.keyIndexAtTime(bag, t) : -1;
    const curveLocked = !!(TL && typeof TL.bezierLockedAt === "function" && idx >= 0 && TL.bezierLockedAt(bag, idx));
    if (curveLocked) {
      setStatus("这个关键帧有更细的变化，请到高级模式调整。", "warn");
      return simpleResult(false, "CURVE_PROTECTED", "这个关键帧有更细的变化，请到高级模式调整。");
    }
    const token = o.confirmToken;
    if (token !== simpleConfirmToken("deleteKey", bone, t)) {
      const token = simpleConfirmToken("deleteKey", bone, t);
      return simpleResult(false, "CONFIRM_REQUIRED", "删除这个位置关键帧吗？可以撤销。", { confirmToken: token, time: t, layerId: bone }, {
        token: token,
        action: "deleteKey",
        target: bone + "@" + round(t, 4) + "s",
        docRev: state.docRev || 0,
      });
    }
    /* 只删「当前部位 translate」这一个 Key：走 P0 的 animRemoveKey（planKeyEdit 只服务额外轨道） */
    const beforeDel = snapshot();
    const okDel = animRemoveKey(anim, "bones", bone, "translate", t);
    if (!okDel) return simpleResult(false, "DELETE_FAILED", SIMPLE_FALLBACK, { time: t });
    commit(beforeDel);
    animSetDraftRefresh();
    const stillThere = simplePositionKeys().some((k) => Math.abs(k.time - t) < 1e-6);
    if (stillThere) return simpleResult(false, "DELETE_FAILED", SIMPLE_FALLBACK, { time: t });
    if (Math.abs((state.edit.simpleKeyTime || -1) - t) < 1e-6) state.edit.simpleKeyTime = null;
    syncChrome();
    setStatus("已删除这个位置关键帧。可撤销。");
    return simpleResult(true, null, "已删除这个位置关键帧。", { time: t });
  }

  function simpleResult(ok, code, message, data, pending) {
    return { ok: !!ok, code: code || (ok ? null : "FAILED"), message: message || "", data: data === undefined ? null : data, pending: pending === undefined ? null : pending };
  }

  /** 动画上下文闸门（task-37 缺陷 1）：非 animate / 无动画时零写入拒绝，绝不偷偷改 Setup */
  function simpleRequireAnimate() {
    if (!state.model) return simpleResult(false, "NO_PACK", "还没有打开人物包。");
    if (editMode() !== "animate" || !state.anim) {
      return simpleResult(false, "NEED_ANIMATE_MODE", "请先切换到动画模式再调整。");
    }
    return null;
  }

  /** 一次性确认 token（动作 + 目标 + 文档版本；不做持久授权） */
  function simpleConfirmToken(action, layerId, time) {
    return [action, state.docRev || 0, state.model ? state.anim : "-", layerId || "-", Number.isFinite(time) ? time.toFixed(4) : "-"].join("|");
  }

  /* ---- 保存（副本 / 原包）---- */
  function simpleSaveCopy(opts) {
    if (!state.model) return simpleResult(false, "NO_PACK", "还没有打开人物包。");
    const before = { dirty: !!state.dirty };
    saveAsZip();
    const stillDirty = !!state.dirty;
    setStatus("已发起副本下载，原包没有改动。");
    notice("info", "副本会下载到浏览器的下载位置，原包不会改变。");
    syncChrome();
    return simpleResult(true, null, "已发起副本下载，原包没有改动。", { destination: "copy", downloadRequested: true, settled: true, dirtyBefore: before.dirty, dirtyAfter: stillDirty, dirty: !!state.dirty });
  }

  async function simpleSaveOriginal(opts) {
    const o = opts || {};
    if (!state.model) return simpleResult(false, "NO_PACK", "还没有打开人物包。");
    if (!state.bundle) return simpleResult(false, "NO_SAVE_TARGET", "这个人物包不能直接保存，请下载副本。");
    if (!state.cap || !state.cap.saveBundle) return simpleResult(false, "READ_ONLY", "这个人物包是只读的，请下载副本。");
    const token = simpleConfirmToken("saveOriginal", state.bundle.base, null);
    if (o.confirmToken !== token) {
      const packLabel = String(state.bundle.base || "").split("/").filter(Boolean).pop() || "这个包";
      return simpleResult(false, "CONFIRM_REQUIRED", "将替换「" + packLabel + "」里的当前内容。建议先下载副本。继续保存吗？", { confirmToken: token, target: state.bundle.base }, {
        token: token,
        action: "saveOriginal",
        target: state.bundle.base,
        docRev: state.docRev || 0,
      });
    }
    /* task-38：必须等保存链路完全落定（模型重建 + 基线更新 + dirty/undo 归零）才 resolve。
       saveToDisk() 自身是 async 且返回 true/false；早先这里 fire-and-forget，导致 agent 读到旧的 dirty/undo。 */
    const okSaved = await saveToDisk();
    if (!okSaved) {
      return simpleResult(false, "SAVE_FAILED", "没有保存成功，调整还在。请重试或下载副本。", {
        destination: "original",
        target: state.bundle.base,
        dirty: !!state.dirty,
        undo: state.undo ? state.undo.length : 0,
      });
    }
    return simpleResult(true, null, "已保存到原包。", {
      destination: "original",
      target: state.bundle.base,
      settled: true,
      dirty: !!state.dirty,
      undo: state.undo ? state.undo.length : 0,
    });
  }


  /* ---- simple.* agent API（与 UI 同一命令，不依赖 DOM） ---- */
  function simpleLayerFor(boneName) {
    const bone = state.bones && state.bones[boneName];
    const slot = state.slots.find((s) => s.boneName === boneName);
    const editableReason = bone ? boneEditBlockReason(boneName) : "没有这个部位";
    return {
      id: boneName,
      label: simpleLayerLabel(boneName),
      slotIndex: slot ? slot.index : -1,
      editable: !editableReason,
      reason: editableReason || null,
    };
  }

  function simpleStatusSnapshot() {
    const anim = state.anim || null;
    const bone = (state.edit && state.edit.selBone) || null;
    const layers = (state.boneList || [])
      .filter((b) => state.slots.some((s) => s.boneName === b.name))
      .map((b) => simpleLayerFor(b.name));
    return {
      apiVersion: 1,
      uiMode: "single", /* task-41：不再有界面模式，保留字段供旧 agent 兼容 */
      pack: state.model
        ? { base: (state.bundle && state.bundle.base) || null, bones: state.boneList.length, slots: state.slots.length, saved: !state.dirty }
        : null,
      clip: anim,
      time: state.t,
      duration: Number.isFinite(state.animDur) ? state.animDur : 0,
      playing: !!state.playing,
      dirty: !!state.dirty,
      busy: !!(state.loading || state.saveBusy || state.zipBusy),
      selectedLayer: bone,
      layers: layers,
      positionKeys: bone && anim ? simplePositionKeys().map((k) => ({ time: k.time, x: k.x, y: k.y })) : [],
      capabilities: {
        openPack: true,
        selectClip: true,
        play: true,
        seek: true,
        selectLayer: true,
        dragPose: !!anim,
        setKey: !!anim,
        deleteKey: !!anim,
        saveCopy: true,
        saveOriginal: !!(state.cap && state.cap.saveBundle && state.bundle),
        undo: !!(state.undo && state.undo.length),
        redo: !!(state.redo && state.redo.length),
      },
      limitations: ["transform/path 等未完整预览", "region 形变非官方扩展", "相邻部位会一起变化"],
      pending: {
        unkeyed: transientActive(),
        mirror: !!(state.edit && state.edit.pendingMirror),
      },
    };
  }

  function simpleApi() {
    return {
      openPack: async (opts) => {
        const o = opts || {};
        if (!o.indexPath || typeof o.indexPath !== "string") return simpleResult(false, "INDEX_REQUIRED", "需要 index 路径（同仓库相对路径）。");
        const okLoad = await loadIndexByPath(o.indexPath);
        if (!okLoad) {
          return state.simpleGuardCancelled
            ? simpleResult(false, "CANCELLED", "已取消，改动保留。")
            : simpleResult(false, "OPEN_FAILED", "这个包暂时打不开，请重新选择包里的 index.json。");
        }
        syncChrome();
        return simpleResult(true, null, "已打开人物包。", { base: (state.bundle && state.bundle.base) || null });
      },
      selectClip: (opts) => {
        const o = opts || {};
        if (typeof o.clipId !== "string" || !state.model || !state.model.animations.has(o.clipId)) {
          return simpleResult(false, "CLIP_NOT_FOUND", "没有这个动画。");
        }
        setAnim(o.clipId);
        setPlayhead(0, { pause: true });
        syncChrome();
        return simpleResult(true, null, "已选择动画。", { clip: state.anim, duration: state.animDur });
      },
      play: (opts) => {
        const o = opts || {};
        if (!state.anim) return simpleResult(false, "NO_ANIM", "这个包还没有动画。");
        if (transientActive()) return simpleResult(false, "UNKEYED", "还有没记住的调整，先添加关键帧或撤销。", { pending: { unkeyed: true } });
        if (Number.isFinite(o.loop) && el0("loopChk")) el0("loopChk").checked = !!o.loop;
        setSimplePlaying(true);
        return simpleResult(true, null, "播放中。", { playing: !!state.playing });
      },
      pause: () => {
        setSimplePlaying(false);
        return simpleResult(true, null, "已暂停。", { playing: !!state.playing });
      },
      seek: (opts) => {
        const o = opts || {};
        if (!Number.isFinite(o.time)) return simpleResult(false, "TIME_INVALID", "时间需要是数字。");
        setPlayhead(o.time, { pause: true });
        return simpleResult(true, null, "已跳到 " + round(state.t, 3) + "s。", { time: state.t });
      },
      selectLayer: (opts) => {
        const o = opts || {};
        const id = typeof o.layerId === "string" ? o.layerId : "";
        if (!id || !state.bones[id]) return simpleResult(false, "LAYER_NOT_FOUND", "没有这个部位。");
        const slot = state.slots.find((s) => s.boneName === id);
        selectBone(id);
        if (slot) state.sel = slot.index;
        syncChrome();
        return simpleResult(true, null, "已选中这个部位。", { layer: simpleLayerFor(id) });
      },
      dragPose: (opts) => {
        const o = opts || {};
        const id = typeof o.layerId === "string" ? o.layerId : "";
        if (!id || !state.bones[id]) return simpleResult(false, "LAYER_NOT_FOUND", "没有这个部位。");
        const gateDrag = simpleRequireAnimate();
        if (gateDrag) return gateDrag;
        if (state.playing) return simpleResult(false, "PLAYING", "播放中，请先暂停。");
        const dx = Number(o.dx) || 0;
        const dy = Number(o.dy) || 0;
        const entry = state.bones[id];
        const lib = boneEditLib();
        const before = snapshot();
        const local0 = localOfBone(id);
        const parentWorld = realParentWorldOf(entry);
        const inherit = inheritOfBone(id);
        if (!lib || typeof lib.translateFromDrag !== "function") return simpleResult(false, "LIB_MISSING", "这一步暂时做不了。");
        /* 与画布拖动同一套数学：world 位移 → 父级局部（冻结父世界矩阵与 inherit） */
        const res = lib.translateFromDrag({
          startX: local0.x,
          startY: local0.y,
          startWorld: { x: 0, y: 0 },
          world: { x: dx, y: dy },
          parentWorld: parentWorld,
          inherit: inherit,
          boneWorld: boneWorldOf(entry.index),
          startLocal: local0,
          space: o.space === "local" ? "local" : "world",
          axis: null,
          snapUnit: 0,
        });
        if (!res || !res.ok) return simpleResult(false, (res && res.code) || "DRAG_FAILED", SIMPLE_FALLBACK);
        writeLocalBone(id, { x: res.x, y: res.y });
        framePose(); /* 打键读的是 pose.local：必须先让 transient 生效（与画布手势的 render 时序一致） */
        if (state.anim && state.edit.autoKey) {
          animAddBoneKey(state.anim, id, "translate");
          if (state.edit.transient && state.edit.transient.bones) delete state.edit.transient.bones[id];
          if (state.edit.transient && state.edit.transient.fields) delete state.edit.transient.fields[id];
        }
        commit(before);
        render();
        syncChrome();
        return simpleResult(true, null, "已记住当前位置。", { layerId: id, time: state.t, keys: simplePositionKeys().map((k) => k.time) });
      },
      setKey: (opts) => {
        const o = opts || {};
        if (Number.isFinite(o.time)) {
          setPlayhead(o.time, { pause: true });
        }
        return simpleAddKey();
      },
      deleteKey: (opts) => {
        const o = opts || {};
        if (o.layerId && state.bones[o.layerId] && state.edit.selBone !== o.layerId) selectBone(o.layerId);
        return simpleDeleteKey(o.time, { confirmToken: o.confirmToken });
      },
      save: async (opts) => {
        const o = opts || {};
        const dest = o.destination === "original" ? "original" : "copy";
        if (dest === "copy") return simpleSaveCopy(o);
        return simpleSaveOriginal(o); /* 已 await 落定，resolve 时 dirty/undo 即为最终值 */
      },
      undo: () => {
        const depth = state.undo ? state.undo.length : 0;
        undo();
        syncChrome();
        return simpleResult(depth > 0, null, depth > 0 ? "已撤销。" : "暂时没有可撤销的调整。", { undo: state.undo ? state.undo.length : 0, redo: state.redo ? state.redo.length : 0 });
      },
      redo: () => {
        const depth = state.redo ? state.redo.length : 0;
        redo();
        syncChrome();
        return simpleResult(depth > 0, null, depth > 0 ? "已重做。" : "暂时没有可重做的调整。", { undo: state.undo ? state.undo.length : 0 });
      },
      status: () => simpleStatusSnapshot(),
    };
  }

  /* ---- 简单模式的菜单（打开/保存）与绑定 ---- */
  function closeSimpleMenus() {
    for (const id of ["simpleOpenMenu", "simpleSaveMenu"]) {
      const m = el0(id);
      if (m) m.hidden = true;
    }
    for (const id of ["simpleOpen", "simpleSave"]) {
      const b = el0(id);
      if (b) b.setAttribute("aria-expanded", "false");
    }
  }

  function simpleMenuItem(menu, label, onClick, disabled, title) {
    const b = el("button", "menu-item", label);
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.disabled = !!disabled;
    if (title) b.title = title;
    b.addEventListener("click", () => {
      closeSimpleMenus();
      onClick();
    });
    menu.appendChild(b);
    return b;
  }

  function openSimpleMenu(which) {
    closeSimpleMenus();
    const save = which === "save";
    const menu = el0(save ? "simpleSaveMenu" : "simpleOpenMenu");
    const btn = el0(save ? "simpleSave" : "simpleOpen");
    if (!menu || !btn) return;
    menu.textContent = "";
    if (save) {
      simpleMenuItem(menu, "下载副本（推荐）", () => simpleSaveCopy(), !state.model, "下载一个副本，原包不会改变");
      const canSave = !!(state.bundle && state.cap && state.cap.saveBundle);
      simpleMenuItem(
        menu,
        "保存到原包…",
        () => { void simpleSaveOriginalFlow(); },
        !canSave,
        canSave ? "替换原包里的当前内容（会先确认）" : "这个人物包不能直接保存，请下载副本"
      );
    } else {
      simpleMenuItem(menu, "打开文件…", () => pickPackSource(), false, "选整个包目录（含 manifest.json）");
      const last = state.ui && state.ui.lastPackIndexPath;
      simpleMenuItem(
        menu,
        last ? "上次打开的包" : "上次打开的包（暂无）",
        () => {
          if (last) loadIndexByPath(last, "url");
        },
        !last,
        last || "还没有打开过人物包"
      );
    }
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    const first = menu.querySelector("button:not(:disabled)");
    if (first && first.focus) first.focus();
  }
  function openSimpleSaveMenu() {
    openSimpleMenu("save");
  }
  function openSimpleOpenMenu() {
    openSimpleMenu("open");
  }

  /* 兼容旧调用点：一律走页内模态版本 */
  function simpleSaveOriginalThenConfirm() {
    return simpleSaveOriginalFlow();
  }

  /* ==========================================================================
   * 自由变换会话（task-41 / U06）：PS 式包围框
   *   · Shift+T 或属性面板「自由变换」按钮进入（不劫持 Ctrl+T：那是浏览器新标签）
   *   · 框内拖动 = 移动；角点拖动 = 等比缩放；上方圆柄 = 旋转
   *   · Enter 一次提交（一条 Undo）；Esc 全回滚到进入时快照
   *   · 复用既有 beginBoneGesture 的数学（translateFromDrag / scaleFromDrag / rotateFromDrag）
   * ====================================================================== */
  const ft = { on: false, bone: null, base: null, box: null, drag: null, hover: null };

  function ftBoxOf(boneName) {
    const frame = state.frame;
    const slot = state.slots.find((s) => s.boneName === boneName);
    if (!frame || !slot) return null;
    const geo = frame.geo.find((g) => g.slotIndex === slot.index);
    if (!geo || !geo.worldXY || !geo.worldXY.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 1 < geo.worldXY.length; i += 2) {
      const p = proj(geo.worldXY[i], geo.worldXY[i + 1]);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!(maxX > minX) || !(maxY > minY)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function ftSync() {
    if (!ft.on) return;
    if (!state.edit.selBone) {
      ftCancel("已取消自由变换（没有选中部位）。");
      return;
    }
    if (ft.bone !== state.edit.selBone) {
      /* 换部位：把当前会话提交，再对新部位重新开框 */
      ftCommit({ quiet: true });
      ftEnter();
      return;
    }
    ft.box = ftBoxOf(ft.bone);
  }

  function ftEnter() {
    const bone = state.edit && state.edit.selBone;
    if (!state.model || !bone) {
      setStatus("先选一个部位再自由变换。", "warn");
      return false;
    }
    const reason = boneEditBlockReason(bone);
    if (reason) {
      setStatus(reason, "warn");
      return false;
    }
    if (state.playing) {
      setStatus("播放中，请先暂停再调整。", "warn");
      return false;
    }
    ft.on = true;
    ft.bone = bone;
    ft.base = snapshot();
    ft.drag = null;
    ft.box = ftBoxOf(bone);
    syncFtButton();
    render();
    setStatus("自由变换：" + bone + " · 框内拖动=移动，角点=等比缩放，圆柄=旋转 · Enter 提交 / Esc 取消");
    return true;
  }

  /** Enter 提交时把预览落成数据：动画 + AutoKey → 写 Key；绑定姿态 → 拖动手势已直接写基础值 */
  function ftMaterialize(gesture) {
    const bone = gesture.bone;
    const fields =
      (state.edit.transient && state.edit.transient.fields && state.edit.transient.fields[bone]) || [];
    if (editMode() === "animate" && state.edit.autoKey && state.anim) {
      const want = fields.length
        ? fields
        : [gesture.mode === "bone-rotate" ? "rotate" : gesture.mode === "bone-scale" ? "scale" : "translate"];
      for (const f of want) animAddBoneKey(state.anim, bone, f);
      if (state.edit.transient && state.edit.transient.bones) delete state.edit.transient.bones[bone];
      if (state.edit.transient && state.edit.transient.fields) delete state.edit.transient.fields[bone];
      return true;
    }
    return false;
  }

  function ftCommit(opts) {
    const o = opts || {};
    if (!ft.on) return false;
    const base = ft.base;
    const gesture = ft.drag;
    ft.on = false;
    ft.bone = null;
    ft.base = null;
    ft.box = null;
    ft.drag = null;
    syncFtButton();
    /* U06：先把手势落成数据，再一次 commit（一条 Undo） */
    if (gesture && gesture.moved) ftMaterialize(gesture);
    const changed = base ? commit(base) : false;
    render();
    if (!o.quiet) setStatus(changed ? "已提交自由变换（一次撤销即可还原）。" : "自由变换没有改动。");
    return changed;
  }

  function ftCancel(msg) {
    if (!ft.on) return false;
    const base = ft.base;
    ft.on = false;
    ft.bone = null;
    ft.base = null;
    ft.box = null;
    ft.drag = null;
    if (base) applySnapshot(base);
    syncFtButton();
    syncAll();
    render();
    setStatus(msg || "已取消自由变换，回到进入前的状态。");
    return true;
  }

  function ftToggle() {
    return ft.on ? ftCommit() : ftEnter();
  }

  /* 0.9.49：属性面板的「自由变换」按钮与提示文案已从界面移除，能力的两个入口改为
     Shift+T 快捷键与 __characterEditor.ftToggle()。这里保留同步函数本体：
     若日后恢复按钮（或测试注入一个），aria-pressed 与提示仍然会跟着 ft.on 走。 */
  function syncFtButton() {
    const btn = el0("btnFreeTransform");
    if (btn) btn.setAttribute("aria-pressed", ft.on ? "true" : "false");
    const hint = el0("ftHint");
    if (hint) hint.hidden = !ft.on;
  }

  /** 命中测试：角点（8px）→ 旋转柄（框上方 24px）→ 框内 */
  function ftHit(p) {
    if (!ft.on || !ft.box) return null;
    const b = ft.box;
    const corners = [
      ["nw", b.x, b.y],
      ["ne", b.x + b.w, b.y],
      ["sw", b.x, b.y + b.h],
      ["se", b.x + b.w, b.y + b.h],
    ];
    for (const [name, cx, cy] of corners) {
      if (Math.hypot(p.x - cx, p.y - cy) <= 9) return { kind: "scale", handle: name, point: { x: cx, y: cy } };
    }
    const rotY = b.y - 24;
    if (Math.abs(p.x - (b.x + b.w / 2)) <= 10 && Math.abs(p.y - rotY) <= 10) {
      return { kind: "rotate", handle: "rot", point: { x: b.x + b.w / 2, y: rotY } };
    }
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return { kind: "move", handle: "inside" };
    return null;
  }

  function ftBegin(e, p, hit) {
    const lib = boneEditLib();
    const bone = ft.bone;
    const entry = boneEntry(bone);
    if (!lib || !entry) return false;
    const info = boneScreenInfo(bone);
    const local0 = localOfBone(bone);
    const world = unproj(p.x, p.y);
    const mode = hit.kind === "scale" ? "bone-scale" : hit.kind === "rotate" ? "bone-rotate" : "bone-move";
    state.drag = {
      mode: mode,
      freeTransform: true,
      boneName: bone,
      part: hit.kind === "scale" ? "uniform" : "center",
      startWorld: world,
      startPivot: info ? { x: info.screen.x, y: info.screen.y } : null,
      pivotWorld: info ? { x: info.world.tx, y: info.world.ty } : null,
      local0: local0,
      parentWorld: realParentWorldOf(entry),
      boneWorld: boneWorldOf(entry.index),
      inherit: inheritOfBone(bone),
      startLocal: local0,
      startRotation: local0.rotation,
      startScale: { x: local0.scaleX, y: local0.scaleY },
      space: editSpace(),
      axis: null,
      snapUnit: state.snap ? 1 : 0,
      snapDeg: state.snap ? 5 : 0,
      snapStep: state.snap ? 0.05 : 0,
      baseline: ft.base,
      moved: false,
      pointerId: e.pointerId,
    };
    /* 等比缩放：freeTransform 会话强制 uniform（scaleFromDrag 用 uniform:true） */
    state.drag.uniform = true;
    cv.setPointerCapture(e.pointerId);
    updateCursor();
    render();
    return true;
  }

  function ftDraw() {
    if (!ft.on || !ft.box) return;
    const b = ft.box;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "#4c9aff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w, b.h);
    ctx.setLineDash([]);
    /* 旋转柄连线 + 圆柄 */
    const cx = b.x + b.w / 2;
    ctx.beginPath();
    ctx.moveTo(cx, b.y);
    ctx.lineTo(cx, b.y - 24);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, b.y - 24, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#4c9aff";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    /* 四个角点 */
    for (const [cx2, cy2] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
      ctx.beginPath();
      ctx.rect(cx2 - 4, cy2 - 4, 8, 8);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#4c9aff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ==========================================================================
   * 右键菜单（task-41 / spec §5）：画布 / 时间轴 / 图层 三类
   *   · 全部走既有命令与 gate；不适用项置灰并给原因（note）
   *   · Esc 关闭、点空白关闭、方向键遍历、焦点归还
   *   · 单实例：同一时刻只有一个菜单
   * ====================================================================== */
  const ctxState = { node: null, returnFocus: null, onKey: null };

  function ctxClose() {
    if (!ctxState.node) return false;
    ctxState.node.remove();
    ctxState.node = null;
    if (ctxState.onKey) document.removeEventListener("keydown", ctxState.onKey, true);
    ctxState.onKey = null;
    if (ctxState.returnFocus && ctxState.returnFocus.focus) ctxState.returnFocus.focus();
    ctxState.returnFocus = null;
    return true;
  }

  function ctxOpen(x, y, items, opts) {
    ctxClose();
    const o = opts || {};
    const box = el("div", "ctx-menu");
    box.setAttribute("role", "menu");
    box.setAttribute("aria-label", o.label || "上下文菜单");
    for (const it of items) {
      if (it.sep) {
        box.appendChild(el("div", "ctx-sep"));
        continue;
      }
      if (it.title) {
        box.appendChild(el("div", "ctx-title", it.title));
        continue;
      }
      const b = el("button", "ctx-item");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      if (it.id) b.id = "ctx-" + it.id;
      const label = el("span", "ctx-label", it.label);
      b.appendChild(label);
      if (it.note) b.appendChild(el("span", "ctx-note", it.note));
      if (it.kbd) {
        const k = el("kbd", "ctx-kbd");
        k.textContent = it.kbd;
        b.appendChild(k);
      }
      if (it.disabled) {
        b.disabled = true;
        b.setAttribute("aria-disabled", "true");
        b.title = it.reason || "当前不可用";
      } else {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          ctxClose();
          if (it.onClick) it.onClick();
        });
      }
      box.appendChild(b);
    }
    document.body.appendChild(box);
    /* 视口内定位（右/下越界时翻转） */
    const r = box.getBoundingClientRect();
    const left = Math.min(x, Math.max(4, window.innerWidth - r.width - 6));
    const top = Math.min(y, Math.max(4, window.innerHeight - r.height - 6));
    box.style.left = Math.max(4, left) + "px";
    box.style.top = Math.max(4, top) + "px";
    ctxState.node = box;
    ctxState.returnFocus = document.activeElement;
    const first = box.querySelector(".ctx-item:not(:disabled)");
    if (first && first.focus) first.focus();
    ctxState.onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        ctxClose();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const list = [...box.querySelectorAll(".ctx-item:not(:disabled)")];
      if (!list.length) return;
      const at = list.indexOf(document.activeElement);
      const next = e.key === "ArrowDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
      list[next].focus();
    };
    document.addEventListener("keydown", ctxState.onKey, true);
    return box;
  }

  /** 画布右键：选中 / 打键 / 删除键 / 显示隐藏 / 洋葱皮 / 吸附 / 看全 */
  function ctxMenuCanvas(e) {
    if (!state.model) return false;
    const bone = state.edit && state.edit.selBone;
    const anim = state.anim;
    const loaded = !!state.model;
    const atTime = Number.isFinite(state.t) ? state.t : 0;
    const hasKey = bone && anim && simplePositionKeys().some((k) => Math.abs(k.time - atTime) < 1e-6);
    const items = [
      { title: bone ? "部位：" + bone : "未选中部位" },
      {
        id: "canvas-key",
        label: "打关键帧",
        kbd: "K",
        disabled: !(bone && anim && loaded),
        reason: !loaded ? "还没有打开人物包" : !bone ? "先在画布或图层里选一个部位" : "这个包没有动画",
        onClick: () => simpleAddKey(),
      },
      {
        id: "canvas-delkey",
        label: "删除这个关键帧",
        kbd: "Delete",
        disabled: !hasKey,
        reason: !bone ? "先选一个部位" : "当前时间没有位置关键帧",
        onClick: () => simpleDeleteKeyFlow(),
      },
      { sep: true },
      {
        id: "canvas-hide",
        label: state.sel >= 0 && state.hidden.has(state.slots[state.sel] && state.slots[state.sel].name) ? "显示这个部位" : "隐藏这个部位",
        disabled: state.sel < 0,
        reason: "先选一个部位",
        onClick: () => {
          if (state.sel >= 0) toggleHidden(state.sel);
        },
      },
      {
        id: "canvas-onion",
        label: state.edit.onion.on ? "关闭洋葱皮" : "打开洋葱皮",
        disabled: !(loaded && anim),
        reason: "需要先打开带动画的人物包",
        onClick: () => setOnion({ on: !state.edit.onion.on }),
      },
      {
        /* 规划书 §14 P4「前后帧姿态对照」：量化当前帧与目标帧的姿态差异，
           结果写状态栏并缓存在 state.edit.poseDiff 供检查器/报告读取。 */
        id: "canvas-posediff",
        label: "对照前后帧姿态",
        note: "当前帧 vs 下一帧",
        disabled: !(loaded && anim && state.animDur > 0),
        reason: "需要先打开带动画的人物包",
        onClick: () => comparePoseWithFrame(fsCurrentFrame() + 1),
      },
      {
        id: "canvas-posediff-prev",
        label: "对照上一帧姿态",
        disabled: !(loaded && anim && state.animDur > 0),
        reason: "需要先打开带动画的人物包",
        onClick: () => comparePoseWithFrame(fsCurrentFrame() - 1),
      },
      {
        id: "canvas-snap",
        label: state.snap ? "关闭吸附" : "打开吸附",
        note: "1 单位 / 5° / 0.05",
        onClick: () => setSnap(!state.snap),
      },
      { sep: true },
      { id: "canvas-fit", label: "看全", kbd: "F", onClick: () => fitView("all") },
      {
        id: "canvas-fit-sel",
        label: "只看选中",
        kbd: "Shift+F",
        disabled: state.sel < 0,
        reason: "先选一个部位",
        onClick: () => fitView("sel"),
      },
      { id: "canvas-timeline", label: state.edit.timeline.expanded ? "收起时间轴" : "展开时间轴", kbd: "Tab", onClick: () => dsOpen() },
    ];
    ctxOpen(e.clientX, e.clientY, items, { label: "画布菜单" });
    return true;
  }

  /** 时间轴右键：在当前帧打键 / 删除选中 Key / 复制 / 粘贴 / 全部选中 / 展开收起 */
  function ctxMenuTimeline(e) {
    /* 帧视图右键：按规划书 §3.4 出「空白帧 / 关键帧 / 帧范围」三套菜单 */
    if ((state.edit.timeline.tab || "dopesheet") === "frame") {
      const box = el0("dsTracks");
      if (box) {
        const r = box.getBoundingClientRect();
        const p = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (fsContextMenuAt(p, e)) return true;
      }
    }
    const sel = state.edit.timeline.selectedKey;
    const set = dsSelection();
    const anim = state.anim;
    const items = [
      { title: "时间轴 · " + round(state.t, 2) + "s" },
      {
        id: "tl-add",
        label: "在当前帧打关键帧",
        disabled: !(anim && state.edit.selBone),
        reason: !anim ? "这个包没有动画" : "先在图层里选一个部位",
        onClick: () => simpleAddKey(),
      },
      {
        id: "tl-del",
        label: set.items.length > 1 ? "删除选中的 " + set.items.length + " 个 Key" : "删除选中的 Key",
        kbd: "Delete",
        disabled: !sel && !set.items.length,
        reason: "先在时间轴上点一个关键帧",
        onClick: () => dsDeleteSelected(),
      },
      { sep: true },
      {
        id: "tl-copy",
        label: "复制选中 Key",
        kbd: MOD_LABEL + "+C",
        disabled: !sel && !set.items.length,
        reason: "先选中至少一个关键帧",
        onClick: () => dsCopySelection(),
      },
      {
        id: "tl-paste",
        label: "粘贴到当前帧",
        kbd: MOD_LABEL + "+V",
        disabled: !state.clipboard,
        reason: "剪贴板为空：先复制一些 Key",
        onClick: () => dsPasteClipboard(state.t),
      },
      {
        id: "tl-selall",
        label: "全选当前动画的 Key",
        kbd: MOD_LABEL + "+A",
        disabled: !anim,
        reason: "这个包没有动画",
        onClick: () => dsSelectAll(),
      },
      { sep: true },
      {
        id: "tl-graph",
        label: "切到 Graph 视图",
        disabled: !anim,
        reason: "这个包没有动画",
        onClick: () => {
          const tab = el0("dsTabGraph");
          if (tab) tab.click();
        },
      },
      { id: "tl-close", label: "收起时间轴", kbd: "Tab", onClick: () => dsOpen(false) },
    ];
    ctxOpen(e.clientX, e.clientY, items, { label: "时间轴菜单" });
    return true;
  }

  /** 图层（部件列表）右键：选中 / 显示隐藏 / 锁定 / 打键 / 层级上下移 / 看全 */
  function ctxMenuLayer(e, slotIndex) {
    const idx = Number.isFinite(slotIndex) ? slotIndex : -1;
    const slot = idx >= 0 ? state.slots[idx] : null;
    const bone = slot ? slot.boneName : null;
    const anim = state.anim;
    const items = [
      { title: slot ? slot.name : "未选中图层" },
      {
        id: "ly-select",
        label: "选中这个部位",
        disabled: !slot,
        reason: "在图层列表里右键一行",
        onClick: () => {
          selectSlot(idx);
          if (bone) selectBone(bone);
        },
      },
      {
        id: "ly-key",
        label: "打关键帧",
        kbd: "K",
        disabled: !(slot && bone && anim),
        reason: !slot ? "先选一个部位" : "这个包没有动画",
        onClick: () => {
          if (bone && state.edit.selBone !== bone) selectBone(bone);
          simpleAddKey();
        },
      },
      { sep: true },
      {
        id: "ly-hide",
        label: slot && state.hidden.has(slot.name) ? "显示" : "隐藏",
        disabled: !slot,
        reason: "先选一个部位",
        onClick: () => {
          if (slot) toggleHidden(idx);
        },
      },
      {
        id: "ly-lock",
        label: slot && state.locked.has(slot.name) ? "解锁" : "锁定（禁止写入）",
        disabled: !slot,
        reason: "先选一个部位",
        onClick: () => {
          if (!slot) return;
          if (state.locked.has(slot.name)) state.locked.delete(slot.name);
          else state.locked.add(slot.name);
          syncList();
          setStatus(state.locked.has(slot.name) ? "已锁定 " + slot.name + "（只读）" : "已解锁 " + slot.name);
        },
      },
      { sep: true },
      {
        id: "ly-up",
        label: "上移一层",
        kbd: "]",
        disabled: !slot,
        reason: "先选一个部位",
        onClick: () => {
          if (slot) moveLayer("up");
        },
      },
      {
        id: "ly-down",
        label: "下移一层",
        kbd: "[",
        disabled: !slot,
        reason: "先选一个部位",
        onClick: () => {
          if (slot) moveLayer("down");
        },
      },
      {
        id: "ly-fit",
        label: "只看这个部位",
        disabled: !slot,
        reason: "先选一个部位",
        onClick: () => {
          if (slot) {
            selectSlot(idx);
            if (bone) selectBone(bone);
            fitView("sel");
          }
        },
      },
    ];
    ctxOpen(e.clientX, e.clientY, items, { label: "图层菜单" });
    return true;
  }

  function bindContextMenus() {
    const cvEl = el0("cv");
    if (cvEl) {
      cvEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        ctxMenuCanvas(e);
      });
    }
    const tracks = el0("dsTracks");
    if (tracks) {
      tracks.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        ctxMenuTimeline(e);
      });
    }
    const list = el0("list");
    if (list) {
      list.addEventListener("contextmenu", (e) => {
        const row = e.target && e.target.closest ? e.target.closest(".slot-row") : null;
        if (!row) return;
        e.preventDefault();
        const raw = row.getAttribute("data-index");
        ctxMenuLayer(e, raw === null ? -1 : Number(raw));
      });
    }
    /* 点空白 / 滚动 / 窗口尺寸变化都关闭 */
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!ctxState.node) return;
        if (ctxState.node.contains(e.target)) return;
        ctxClose();
      },
      true
    );
    /* 视口变化时只把菜单拉回可视区（截图/工具栏切换也会触发 resize，不能因此关掉菜单） */
    window.addEventListener("resize", () => {
      const box = ctxState.node;
      if (!box) return;
      const r = box.getBoundingClientRect();
      box.style.left = Math.max(4, Math.min(parseFloat(box.style.left) || r.left, window.innerWidth - r.width - 6)) + "px";
      box.style.top = Math.max(4, Math.min(parseFloat(box.style.top) || r.top, window.innerHeight - r.height - 6)) + "px";
    });
  }

  /* ---- 工具条伸缩（0.9.5）----
   * 用**独立 localStorage 键**，不进 prefs：prefs 有 PREFS_VERSION 严格校验，
   * 版本不符会整份回退默认（layout/shortcuts/models 全丢）。为一个展开态去动那个版本
   * 代价太高，所以这里只存一个布尔。
   */
  const RAIL_PREFS_KEY = "dsh.character-editor.railExpanded";

  function railExpandedPref() {
    try {
      return window.localStorage.getItem(RAIL_PREFS_KEY) === "1";
    } catch (_) {
      return false;      /* localStorage 不可用：不持久化，也不报错 */
    }
  }

  function saveRailExpanded(on) {
    try {
      window.localStorage.setItem(RAIL_PREFS_KEY, on ? "1" : "0");
    } catch (_) {
      /* 忽略：不影响本次会话的展开态 */
    }
  }

  /** 同步展开态到 DOM（幂等；按钮 aria 与 rail data-expanded 一起改） */
  function syncRailExpanded() {
    const rail = el0("toolRail");
    const btn = el0("railToggle");
    const on = !!(state.railExpanded);
    if (rail) rail.setAttribute("data-expanded", on ? "true" : "false");
    if (btn) {
      btn.setAttribute("aria-expanded", on ? "true" : "false");
      /* 刻意**不设** aria-pressed：这是展开/收起开关，不是「选中某个工具」。
         .rail-btn[aria-pressed="true"] 会渲染成蓝色高亮，若这里也设了，
         就会和当前选中的工具（如「移动」）同时高亮，看起来像选中了两个工具。 */
      btn.removeAttribute("aria-pressed");
      btn.title = on ? "收起工具条：只显示图标" : "展开工具条：显示工具名称";
    }
  }

  /**
   * 设置展开态。收起时**立刻**交出焦点安全：焦点若在工具按钮上，宽度动画不影响它；
   * 唯一要保证的是别让焦点停在已隐藏的文字上（文字是 span，不可聚焦，无需处理）。
   */
  function setRailExpanded(on, opts) {
    const o = opts || {};
    state.railExpanded = !!on;
    syncRailExpanded();
    if (o.persist !== false) saveRailExpanded(state.railExpanded);
  }

  function toggleRailExpanded() {
    setRailExpanded(!state.railExpanded);
  }

  /* ---- 单一界面的绑定（工具条 / 顶栏 / 文档模式 / 关键帧条 / 确认模态） ---- */
  function bindSingleUi() {
    /* 左侧竖向工具条 */
    const railMap = [
      ["railSelect", () => setEditTool("translate", { selectOnly: true })],
      ["btnToolMove", () => setEditTool("translate")],
      ["btnToolRotate", () => setEditTool("rotate")],
      ["btnToolScale", () => setEditTool("scale")],
      ["btnToolPose", () => setEditTool("pose")],
      ["btnToolPan", () => setTool("pan")],
      ["btnZoomInRail", () => zoomBy(1.25)],
      ["btnZoomOutRail", () => zoomBy(1 / 1.25)],
      ["btnFitRail", () => fitView("all")],
    ];
    for (const [id, fn] of railMap) {
      const node = el0(id);
      if (node) node.addEventListener("click", fn);
    }
    /* 工具条伸缩开关 */
    const railToggle = el0("railToggle");
    if (railToggle) railToggle.addEventListener("click", toggleRailExpanded);
    syncRailExpanded();
    /* 文档模式（画布角） */
    const setupBtn = el0("docModeSetup");
    if (setupBtn) setupBtn.addEventListener("click", () => setEditMode("setup"));
    const animBtn = el0("docModeAnimate");
    if (animBtn) animBtn.addEventListener("click", () => setEditMode("animate"));
    /* 顶栏：撤销 / 重做 / 保存菜单 */
    const undoBtn = el0("btnUndoTop");
    if (undoBtn) undoBtn.addEventListener("click", () => simpleApi().undo());
    const redoBtn = el0("btnRedoTop");
    if (redoBtn) redoBtn.addEventListener("click", () => simpleApi().redo());
    const saveBtn = el0("btnSaveTop");
    if (saveBtn) saveBtn.addEventListener("click", () => openSimpleMenu("save"));
    /* task-41：单一时间轴——底部「关键帧」按钮改为展开/收起 #dopesheet（不再有第二套时间条） */
    const trackToggle = el0("simpleTrackToggle");
    if (trackToggle) {
      trackToggle.addEventListener("click", () => dsOpen());
    }
    /* task-41：画布 / 时间轴 / 图层 三类右键菜单（spec §5） */
    bindContextMenus();
    /* 规划书 §5.4：关键帧属性检查器的按钮与输入框 */
    bindKeyInspector();
    /* task-41：「更多面板」（事件/表情/动画）默认折叠 */
    const extraToggle = el0("extraToggle");
    if (extraToggle) extraToggle.addEventListener("click", () => setExtraOpen(!extraOpen()));
    /* task-42：属性面板顶部保留打关键帧 + 位置/旋转/缩放 + 自由变换（文档模式在顶部第 2 排） */
    /* 0.9.49：这块 DOM 已按用户要求从界面移除，对应的 5 个绑定一并删除（留着就是 dead code，
       而且 commitBoneField() 已删，绑定会指向不存在的函数）。
       能力去向：位置/旋转/缩放 → #boneBody / #selBody 的输入框（applyBoneNumber / applyBoneField）；
                 打关键帧 → K 快捷键、#btnBoneKey、R/T/S 打键按钮；
                 自由变换 → Shift+T 与 __characterEditor.ftToggle()。
       下面的 #skelToggle 绑定仍在，因为骨架结构面板还在界面上。 */
    /* task-41：骨架结构默认折叠（渐进披露） */
    const skelToggle = el0("skelToggle");
    if (skelToggle) {
      skelToggle.addEventListener("click", () => {
        const open = skelToggle.getAttribute("aria-expanded") === "true";
        skelToggle.setAttribute("aria-expanded", open ? "false" : "true");
        const body = el0("skelBody");
        if (body) body.hidden = open;
      });
    }
    /* task-41：片段库 / 调试默认折叠（渐进披露）
       0.9.49：片段库整块已从界面移除（用户要求），#clipToggle 不复存在，绑定一并删除。
       能力去向：__characterEditor.clips() / clipSave() / clipInsert() / clipRename() /
                 clipDelete() / clipCollision() / poseSave() / poseApply() / poseDelete()。 */
    /* task-42：原「更多」分区已移到顶部两排，没有折叠按钮要绑 */
    /* 看全/缩放按钮（顶部第 1 排）复用 init 里既有的 btnFit/btnZoomIn/btnZoomOut 绑定 */
    /* 确认模态 */
    const confirmX = el0("simpleConfirmX");
    if (confirmX) confirmX.addEventListener("click", () => simpleConfirmClose(null));
    const confirmMask = el0("simpleConfirm");
    if (confirmMask) {
      confirmMask.addEventListener("click", (e) => {
        if (e.target === confirmMask) simpleConfirmClose(null);
      });
    }
    /* 点击别处关闭保存菜单 */
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest("#btnSaveTop, #saveMenuTop")) return;
        closeSimpleMenus();
      },
      true
    );
  }

  function setSimplePlaying(want) {
    if (!state.anim) return false;
    if (!!state.playing !== !!want) togglePlay();
    return !!state.playing === !!want;
  }

  /* ---- 页内确认模态（task-37：替代 window.confirm；Enter 确认 / Esc 取消 / 焦点归还） ---- */
  let simpleConfirmResolve = null;
  let simpleConfirmReturnFocus = null;

  function simpleConfirmVisible() {
    const node = el0("simpleConfirm");
    return !!(node && !node.hidden);
  }

  function simpleConfirmClose(value) {
    const node = el0("simpleConfirm");
    if (!node || node.hidden) return;
    node.hidden = true;
    const fn = simpleConfirmResolve;
    simpleConfirmResolve = null;
    const back = simpleConfirmReturnFocus;
    simpleConfirmReturnFocus = null;
    if (back && back.focus && document.contains(back)) {
      try {
        back.focus();
      } catch (e) {
        /* 忽略：原控件已不可聚焦 */
      }
    }
    if (fn) fn(value);
  }

  function simpleConfirm(opts) {
    const o = opts || {};
    const node = el0("simpleConfirm");
    if (!node) return Promise.resolve(null);
    if (simpleConfirmVisible()) simpleConfirmClose(null);
    simpleConfirmReturnFocus = document.activeElement;
    const title = el0("simpleConfirmTitle");
    if (title) title.textContent = o.title || "确认";
    const text = el0("simpleConfirmText");
    if (text) text.textContent = o.message || "";
    const hint = el0("simpleConfirmHint");
    if (hint) {
      hint.hidden = !o.hint;
      hint.textContent = o.hint || "";
    }
    const box = el0("simpleConfirmActions");
    if (!box) return Promise.resolve(null);
    box.textContent = "";
    const actions = Array.isArray(o.actions) && o.actions.length ? o.actions : [{ label: "确定", value: "ok", primary: true }, { label: "取消", value: null }];
    for (const a of actions) {
      const b = el("button", "btn btn-sm" + (a.primary ? " primary" : ""), a.label);
      b.type = "button";
      b.addEventListener("click", () => simpleConfirmClose(a.value));
      box.appendChild(b);
    }
    node.hidden = false;
    const first = box.querySelector("button.primary") || box.querySelector("button");
    if (first && first.focus) first.focus();
    return new Promise((resolve) => {
      simpleConfirmResolve = resolve;
    });
  }

  /** 模态的键盘通道（在 onKeyDown 最前面调用；返回 true 表示已处理） */
  function simpleConfirmKeyboard(e) {
    if (!simpleConfirmVisible()) return false;
    if (e.key === "Escape") {
      e.preventDefault();
      simpleConfirmClose(null);
      return true;
    }
    if (e.key === "Enter") {
      const btn = el0("simpleConfirmActions").querySelector("button.primary") || el0("simpleConfirmActions").querySelector("button");
      if (btn) {
        e.preventDefault();
        btn.click();
        return true;
      }
    }
    return false;
  }

  /** 未保存保护（task-37 §6）：保存 / 下载副本后继续 / 放弃 / 取消；下载失败不得继续 */
  async function simpleUnsavedGuard(actionLabel) {
    state.simpleGuardCancelled = false;
    if (!state.dirty) return true;
    const choice = await simpleConfirm({
      title: "还有没保存的调整",
      message: "继续" + (actionLabel || "操作") + "会丢掉这次的调整。要先保存或下载副本吗？",
      hint: "「下载副本」只下载不改变原包；「放弃调整」会丢掉这次改动。",
      actions: [
        { label: "保存到原包", value: "save" },
        { label: "下载副本后继续", value: "copy" },
        { label: "放弃调整", value: "discard" },
        { label: "取消", value: null },
      ],
    });
    if (choice === null || choice === undefined) {
      state.simpleGuardCancelled = true;
      return false;
    }
    if (choice === "save") {
      const res = await simpleSaveOriginalFlow();
      return !!(res && res.ok);
    }
    if (choice === "copy") {
      const res = simpleSaveCopy();
      return !!(res && res.ok && res.data && res.data.downloadRequested);
    }
    return true;
  }

  /** 保存到原包（页内模态确认；显示包名 + 建议先下载副本） */
  async function simpleSaveOriginalFlow() {
    const pending = await simpleSaveOriginal();
    if (!pending || pending.ok) return pending;
    if (pending.code !== "CONFIRM_REQUIRED") {
      setStatus(pending.message, "warn");
      return pending;
    }
    const target = (pending.pending && pending.pending.target) || (state.bundle && state.bundle.base) || "";
    const packLabel = String(target).split("/").filter(Boolean).pop() || "这个包";
    const choice = await simpleConfirm({
      title: "保存到原包？",
      message: "将替换「" + packLabel + "」里的当前内容。建议先下载副本。",
      hint: "保存位置：" + target,
      actions: [
        { label: "下载副本", value: "copy" },
        { label: "保存到原包", value: "save", primary: true },
        { label: "取消", value: null },
      ],
    });
    if (choice === "copy") {
      simpleSaveCopy();
      return pending;
    }
    if (choice !== "save") return pending;
    return simpleSaveOriginal({ confirmToken: pending.pending.token });
  }

  /** 删单个位置关键帧（页内模态确认） */
  async function simpleDeleteKeyFlow(time) {
    const t = Number.isFinite(time) ? time : state.edit && Number.isFinite(state.edit.simpleKeyTime) ? state.edit.simpleKeyTime : state.t;
    const first = simpleDeleteKey(t);
    if (first && first.ok) return first;
    if (!first || first.code !== "CONFIRM_REQUIRED") return first;
    const choice = await simpleConfirm({
      title: "删除这个位置关键帧？",
      message: "这一小段动作会随之变化，可以撤销。",
      hint: "只删除当前部位在 " + round(t, 3) + "s 的位置关键帧。",
      actions: [
        { label: "删除", value: "ok", primary: true },
        { label: "取消", value: null },
      ],
    });
    if (choice !== "ok") return first;
    return simpleDeleteKey(t, { confirmToken: first.pending.token });
  }

  function dsBuild() {
    const lib = timelineLib();
    const anim = dsAnimationRaw();
    if (!lib || !state.model || !anim) return { ok: false, rows: [], maxTime: 0, keyCount: 0, unsupported: 0, unsupportedRows: [] };
    const built = lib.buildRows({ model: state.model, animation: anim });
    const tl = state.edit.timeline;
    /* 契约 §6：onlyKeyed OFF 必须补「已知骨 × rotate/translate/scale/shear」空行
       （scale 的缺省值是 1，不是 0）——由 T22 的 withEmptyBoneTracks 负责，app 不自己拼。 */
    if (built && built.ok !== false && typeof lib.withEmptyBoneTracks === "function") {
      const res = lib.withEmptyBoneTracks(built.rows, state.model, tl.onlyKeyed ? { includeEmpty: false } : undefined);
      if (res && res.ok) {
        built.rows = res.rows;
        built.emptyAdded = res.added;
      }
    }
    /* P2-01/02：额外轨道（事件/绘制顺序/形变/约束）追加在骨→槽之后。
       注意顺序：withEmptyBoneTracks 只补骨空轨（不产生额外行），所以这里才是唯一追加点。
       另外：timeline.js 只认 bones/slots，会把 events/drawOrder/attachments/ik/transform/path 等顶层容器
       当作「未知时序」补 kind='timeline' 的只读行；这些容器已由 SpineTrackEdit.scanExtra 覆盖（含真正的
       未知时序），先剔除重复行，再按 事件→绘制顺序→形变→约束→未知 分组重建。 */
    if (built && built.ok !== false) {
      const before = (built.rows || []).length;
      built.rows = (built.rows || []).filter((r) => r.kind !== "timeline");
      const dropped = before - built.rows.length;
      const extra = scanExtraRows();
      built.rows = built.rows.concat(extra.rows);
      built.keyCount = (built.keyCount || 0) + extra.keyCount;
      built.maxTime = Math.max(built.maxTime || 0, extra.maxTime);
      built.unsupportedRows = built.rows.filter((r) => r.unsupported === true);
      built.unsupported = built.unsupportedRows.length;
      built.issues = (built.issues || []).concat(extra.issues || []);
      built.extraRows = extra.rows;
      built.extraIssues = extra.issues || [];
      built.droppedTimelineRows = dropped;
    }
    return built;
  }

  /* ---- P1-01 子轨道管理（契约 §6）：搜索 / 只显示有 Key / 锁定 / 隐藏 ---- */

  function tlLockedSet() {
    const tl = state.edit.timeline;
    if (!Array.isArray(tl.lockedRows)) tl.lockedRows = [];
    return tl.lockedRows;
  }

  function tlHiddenSet() {
    const tl = state.edit.timeline;
    if (!Array.isArray(tl.hiddenRows)) tl.hiddenRows = [];
    return tl.hiddenRows;
  }

  function tlToggleIn(list, key) {
    const i = list.indexOf(key);
    if (i >= 0) list.splice(i, 1);
    else list.push(key);
    return i < 0;
  }

  /** 中央写入闸门（契约 §6）：任何新编辑命令（Key/曲线/批量）先过这里 */
  function trackWriteGate(trackIds, operation) {
    const locked = tlLockedSet();
    const hit = [];
    for (const id of trackIds || []) {
      if (id && locked.indexOf(String(id)) >= 0) hit.push(String(id));
    }
    if (hit.length) {
      return { ok: false, code: "LOCKED_ROW", reason: "锁定轨禁止写入：" + hit.slice(0, 3).join("、") + "（" + (operation || "编辑") + "）" };
    }
    return { ok: true };
  }

  /** 该骨是否被任何锁定轨覆盖（画布手势/手动打键也要挡） */
  function boneRowLocked(boneName) {
    const locked = tlLockedSet();
    if (!locked.length) return null;
    for (const id of locked) {
      const parts = String(id).split(":");
      if (parts.length >= 2 && parts[0] === "bone" && parts[1] === boneName) return String(id);
    }
    return null;
  }

  /** 组行定义（filterRows 用）：每骨一组，children = 其属性行 rowKey */
  function dsGroupDefs(rows) {
    const lib = timelineLib();
    if (!lib) return [];
    const byOwner = new Map();
    for (const row of rows) {
      if (row.kind !== "bone") continue;
      if (!byOwner.has(row.owner)) byOwner.set(row.owner, []);
      byOwner.get(row.owner).push(lib.rowKey(row));
    }
    const out = [];
    byOwner.forEach((children, owner) => out.push({ key: "bone:" + owner, label: owner, children: children }));
    return out;
  }

  /**
   * 过滤 + 折叠 + 搜索命中临时展开后的**显示行**（含组行）。
   * 契约 §6：搜索先过滤叶子再保留祖先；命中子行时临时展开，不改用户永久 collapsed。
   */
  function dsView() {
    const lib = timelineLib();
    const tl = state.edit.timeline;
    const built = dsBuild();
    if (!lib || !built || built.ok === false) return { built: built, view: null, rows: [] };
    const groups = dsGroupDefs(built.rows);
    const view = typeof lib.filterRows === "function"
      ? lib.filterRows({
          rows: built.rows,
          search: tl.search || "",
          onlyKeyed: !!tl.onlyKeyed,
          locked: tlLockedSet(),
          hidden: tlHiddenSet(),
          groups: groups,
        })
      : { ok: true, rows: built.rows.map((r) => Object.assign({}, r)), visibleRows: built.rows, groups: [], total: built.rows.length, visible: built.rows.length, matched: 0, hidden: 0, locked: 0 };
    const byKey = new Map();
    for (const r of view.rows) byKey.set(lib.rowKey(r), r);
    const collapsed = dsCollapsedSet();
    const searching = !!(tl.search && String(tl.search).trim());
    const out = [];
    const counts = Object.create(null);
    for (const r of view.rows) if (r.kind === "bone" && !r.filtered && !r.hidden) counts[r.owner] = (counts[r.owner] || 0) + r.keyCount;
    const emitted = new Set();
    for (const row of view.rows) {
      if (row.kind !== "bone") {
        if (isExtraKind(row.kind)) continue; /* P2 额外轨道单独分组，见下方 */
        if (row.filtered || row.hidden) continue;
        out.push(row);
        continue;
      }
      if (!emitted.has(row.owner)) {
        emitted.add(row.owner);
        const userCollapsed = collapsed.has("bone:" + row.owner);
        /* 组内是否还有可见子行 */
        const alive = (counts[row.owner] || 0) > 0 || view.rows.some((x) => x.kind === "bone" && x.owner === row.owner && !x.filtered && !x.hidden);
        if (!alive) continue;
        out.push({
          kind: "group",
          owner: row.owner,
          ownerIndex: row.ownerIndex,
          open: !userCollapsed,
          label: row.owner,
          keyCount: counts[row.owner] || 0,
        });
      }
      if (row.filtered || row.hidden) continue;
      const userCollapsed = collapsed.has("bone:" + row.owner);
      /* 搜索命中时临时展开（不改用户 collapsed） */
      const tmpOpen = searching && row.keyCount > 0;
      if (userCollapsed && !tmpOpen) continue;
      out.push(row);
    }
    /* P2-01/02：额外轨道分组（事件 → 绘制顺序 → 形变 → 约束 → 未知只读）。
       搜索命中或「仅有 Key」过滤后按组内可见行决定是否出现；组头可折叠（键 extra:<gid>）。 */
    const extras = view.rows.filter((r) => isExtraKind(r.kind) && !r.filtered && !r.hidden);
    if (extras.length) {
      const buckets = new Map();
      for (const r of extras) {
        const g = extraGroupOf(r.kind) || EXTRA_GROUPS[EXTRA_GROUPS.length - 1];
        if (!buckets.has(g.gid)) buckets.set(g.gid, []);
        buckets.get(g.gid).push(r);
      }
      for (const g of EXTRA_GROUPS) {
        const bucket = buckets.get(g.gid);
        if (!bucket || !bucket.length) continue;
        const collapseKey = "extra:" + g.gid;
        const open = searching || !collapsed.has(collapseKey);
        let keyCount = 0;
        for (const r of bucket) keyCount += r.keyCount || 0;
        out.push({
          kind: "group",
          extra: true,
          groupId: g.gid,
          collapseKey: collapseKey,
          open: open,
          label: g.label,
          note: g.note,
          keyCount: keyCount,
        });
        if (!open) continue;
        for (const r of bucket) out.push(r);
      }
    }
    return { built: built, view: view, rows: out };
  }

  /** 行 → 扁平显示列表（含组行；已应用搜索/过滤/折叠/锁定/隐藏） */
  function dsVisibleRows(built) {
    if (built && built !== undefined) {
      /* 兼容旧调用：忽略传入的 built，统一走 dsView（保证过滤一致） */
      return dsView().rows;
    }
    return dsView().rows;
  }

  function dsCollapsedSet() {
    const tl = state.edit.timeline;
    if (!tl.collapsed) tl.collapsed = new Set();
    return tl.collapsed;
  }

  /** 行 → 扁平显示列表（骨级折叠属性子行；未知行始终显示） */
  function dsVisibleRowsLegacy(built) {
    const collapsed = dsCollapsedSet();
    const out = [];
    const openBones = new Set();
    for (const row of built.rows) {
      if (row.kind === "bone") {
        const parentKey = "bone:" + row.owner;
        const open = !collapsed.has(parentKey);
        if (!openBones.has(row.owner)) {
          openBones.add(row.owner);
          out.push({ kind: "group", owner: row.owner, ownerIndex: row.ownerIndex, open: open, label: row.owner, keyCount: 0 });
        }
        if (open) out.push(row);
      } else {
        out.push(row);
      }
    }
    /* 组行的 key 数 = 其属性行之和 */
    const counts = Object.create(null);
    for (const row of built.rows) if (row.kind === "bone") counts[row.owner] = (counts[row.owner] || 0) + row.keyCount;
    for (const entry of out) if (entry.kind === "group") entry.keyCount = counts[entry.owner] || 0;
    return out;
  }

  function dsLayout() {
    const tl = state.edit.timeline;
    const trackBox = el0("dsTracks");
    const labelBox = el0("dsLabels");
    const width = trackBox ? trackBox.clientWidth : 0;
    const height = trackBox ? trackBox.clientHeight : 0;
    return {
      width: width,
      height: height,
      labelWidth: labelBox ? labelBox.clientWidth : 158,
      pxPerSec: tl.pxPerSec > 0 ? tl.pxPerSec : 100,
      scrollSec: tl.scrollSec || 0,
      rowH: DS_ROW_H,
      rulerH: DS_RULER_H,
      scrollTop: dsScrollTop,
    };
  }

  function dsSyncBars() {
    const tl = state.edit.timeline;
    const built = dsBuild();
    const view = dsView();
    el0("dsAnimName").textContent = state.anim || "（无动画）";
    /* 过滤标记只看 filterRows 的结果（search/onlyKeyed/hidden）；折叠不算过滤 */
    const leafRows = view.rows.filter((r) => r.kind !== "group").length;
    const totalLeaf = (view.view && (view.view.total || 0)) || 0;
    const visibleLeaf = (view.view && (view.view.visible || 0)) || 0;
    const filtered = !!(view.view && totalLeaf && visibleLeaf < totalLeaf);
    el0("dsKeyStat").textContent =
      built.keyCount + " key / " + (built.rows || []).length + " 行 · " + round(built.maxTime, 3) + "s" +
      (filtered ? " · 过滤后 " + leafRows + " 行" : "");
    el0("dsKeyStat").title = (built.emptyAdded ? "补空轨 " + built.emptyAdded + " 条；" : "") + "可见 " + view.rows.length + " 行";
    const uns = el0("dsUnsupported");
    uns.hidden = !built.unsupported;
    if (built.unsupported) {
      uns.textContent = built.unsupported + " 条未知轨道只读";
      uns.title = built.unsupportedRows.slice(0, 6).map((r) => r.kind + ":" + r.owner).join("、");
    }
    const px = el0("dsPxPerSec");
    if (px && document.activeElement !== px) px.value = String(Math.round(tl.pxPerSec));
    el0("dsPxPerSecV").textContent = String(Math.round(tl.pxPerSec));
    const snap = el0("dsSnap");
    if (snap) snap.checked = !!tl.snapFrames;
    const search = el0("dsSearch");
    if (search && document.activeElement !== search) search.value = tl.search || "";
    const ok = el0("dsOnlyKeyed");
    if (ok) ok.checked = !!tl.onlyKeyed;
    const del = el0("dsDelete");
    if (del) del.disabled = !tl.selectedKey;
    /* P2-01/02：当前命中事件 + 预览不完整汇总 + 轨道面板按钮可用性 */
    syncEventNow();
    const noteNode = el0("dsPreviewNote");
    if (noteNode) {
      /* 预览不完整的轨道分两处来源：extraRows（transform/path 约束）与 buildRows 的
         partialRows（例如 §4.3 槽位颜色动画 —— 语义已知、可编辑可保存，但 core 未求值）。 */
      const partialKinds = [];
      const pushKind = (k) => {
        const key = String(k);
        if (partialKinds.indexOf(key) < 0) partialKinds.push(key);
      };
      for (const r of built.partialRows || []) {
        /* 槽位只有**部分字段**未求值（attachment 求值、color/twoColor 不求值），
           所以这里标到字段粒度，避免让人以为整个插槽都不可预览。 */
        pushKind(r.kind === "slot" ? "slot." + r.field : r.kind);
      }
      for (const r of built.extraRows || []) {
        if (!r.previewPartial || r.unsupported) continue;
        pushKind(r.kind);
      }
      noteNode.hidden = !partialKinds.length;
      noteNode.textContent = partialKinds.length ? "预览不完整：" + partialKinds.join("/") + " 未求值（仅编辑/保存）" : "";
      noteNode.title =
        "core 未求值的时序（transform / path 约束、槽位颜色动画等）：编辑与保存可用，" +
        "但不得宣称预览已生效。颜色对应 capabilities.unsupported.slotColor。";
    }
    const extraRow = selectedTrackRow();
    const addBtn = el0("dsAddKey");
    if (addBtn) {
      addBtn.disabled = !extraRow;
      addBtn.title = extraRow
        ? "在播放头时刻对「" + (isExtraKind(extraRow.kind) ? extraLabelOf(extraRow) : "槽附件 " + extraRow.owner) + "」加/改 Key"
        : "先在左侧选中一条槽附件 / 事件 / 绘制顺序 / 形变 / 约束行";
    }
    syncDsGraphBar();
    fsSyncBar();
    /* §5.4 关键帧属性检查器：跟随当前选中的 Key 刷新。
       放在 dsSyncBars 里是因为它覆盖了几乎所有刷新路径（选择、拖动、撤销、切动画）。 */
    if (typeof renderKeyInspector === "function") renderKeyInspector();
    return built;
  }

  /** 画布绘制：标尺 + 行底 + key 菱形 + 播放头 */
  function dsDraw() {
    const panel = el0("dopesheet");
    if (!panel || panel.hidden) return;
    const lib = timelineLib();
    const cv2 = el0("dsCanvas");
    if (!lib || !cv2) return;
    const built = dsBuild();
    const rows = dsVisibleRows(built);
    const L = dsLayout();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(L.width * dpr));
    const h = Math.max(1, Math.round(L.height * dpr));
    if (cv2.width !== w || cv2.height !== h) {
      cv2.width = w;
      cv2.height = h;
    }
    const g = cv2.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, L.width, L.height);
    /* ===== Flash 风格帧时间轴 =====
       0.9.110 起用户要求参照 Flash/Animate 的帧面板；0.9.118（规划书 P0）把绘制
       收敛到纯模块 SpineFrameTimeline：帧标尺按 chooseFrameSteps 抽稀、当前帧整列高亮、
       已选帧列与边框由 fsDrawFrameGrid 一次画完，避免日月与 Dopesheet 两套帧几何漂移。 */
    g.font = "10px ui-monospace,monospace";
    g.textBaseline = "alphabetic";
    fsDrawFrameGrid(g, L, rows);
    /* §14 P4 动作标记：必须画在行区 clip **之前** —— 旗标要伸进标尺区，
       若在 clip 之后画，旗头会被行区裁剪切掉。 */
    fsDrawMarkers(g, L);
    /* §14 P4 帧缩略图：画在标尺下方一行，同样必须在行区 clip 之前 */
    fsDrawThumbnails(g, L);
    /* §14 P4 音频波形：与缩略图互斥（都占标尺下方） */
    fsDrawAudioWave(g, L);
    /* 行区起点（帧标尺之下）；下面的行裁剪与行高计算都用它 */
    const bodyTop = L.rulerH;
    /* 标尺底部分隔线 */
    g.strokeStyle = "#2a3242";
    g.beginPath();
    g.moveTo(0, L.rulerH + 0.5);
    g.lineTo(L.width, L.rulerH + 0.5);
    g.stroke();
    let y = bodyTop - L.scrollTop;
    /* 0.9.114：行区裁剪 —— 滚动的行会部分越过 bodyTop，若不裁剪，色带/关键帧会画进标尺区
       （实测色带像素出现在 y[5,22] 的标尺范围内）。 */
    g.save();
    g.beginPath();
    g.rect(0, bodyTop, L.width, Math.max(0, L.height - bodyTop));
    g.clip();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowTop = y + i * L.rowH;
      if (rowTop > L.height) break;
      if (rowTop + L.rowH < bodyTop) continue;
      if (i % 2 === 1) {
        g.fillStyle = "rgba(255,255,255,0.02)";
        g.fillRect(0, rowTop, L.width, L.rowH);
      }
      if (row.kind === "group") {
        /* P2：额外轨道组头画一条浅色分隔线，与骨组区分 */
        if (row.extra) {
          g.strokeStyle = "rgba(127,209,255,0.22)";
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(0, Math.round(rowTop + L.rowH) + 0.5);
          g.lineTo(L.width, Math.round(rowTop + L.rowH) + 0.5);
          g.stroke();
        }
        continue;
      }
      const rowKeyOfRow = lib.rowKey(row);
      const isSelRow = isExtraKind(row.kind)
        ? state.edit.timeline.extraRowKey === rowKeyOfRow
        : !!(state.edit.selBone && row.owner === state.edit.selBone);
      /* ===== Flash 风格帧格填充（0.9.112）=====
         原实现只给每个 Key 画一个小菱形，行区看着一片空。
         Flash 里「有内容的帧」是整格填色的：这里把相邻 Key 之间填成半透明色条，
         第一个 Key 到最后一个 Key 之间形成一条「有动画区间」的色带，一眼能看出这层在哪一段有数据。 */
      const klist = (row.keys || []).slice().sort((a, b) => a.time - b.time);
      if (klist.length) {
        const tStart = klist[0].time;
        const tEnd = Math.max(state.animDur || 0, klist[klist.length - 1].time);
        const xa = lib.timeToX({ time: tStart, scrollSec: L.scrollSec, pxPerSec: L.pxPerSec });
        const xb = lib.timeToX({ time: tEnd, scrollSec: L.scrollSec, pxPerSec: L.pxPerSec });
        if (isFinite(xa) && isFinite(xb) && xb > xa) {
          const clipA = Math.max(-1, Math.min(L.width, xa));
          const clipB = Math.max(-1, Math.min(L.width, xb));
          if (clipB > clipA) {
            const bandColor = row.kind === "slot"
              ? "rgba(79,195,217,0.30)"
              : isExtraKind(row.kind)
                ? "rgba(232,210,74,0.30)"
                : "rgba(90,169,255,0.28)";
            g.fillStyle = bandColor;
            g.fillRect(clipA, rowTop + 2, clipB - clipA, L.rowH - 4);
            /* 底边强调线：Flash 里「帧段」有明确的下边线，读起来更像时间轴 */
            g.strokeStyle = row.kind === "slot"
              ? "rgba(79,195,217,0.75)"
              : isExtraKind(row.kind)
                ? "rgba(232,210,74,0.75)"
                : "rgba(90,169,255,0.70)";
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(clipA, Math.round(rowTop + L.rowH - 3) + 0.5);
            g.lineTo(clipB, Math.round(rowTop + L.rowH - 3) + 0.5);
            g.stroke();
          }
        }
      }
      for (const key of row.keys || []) {
        const x = lib.timeToX({ time: key.time, scrollSec: L.scrollSec, pxPerSec: L.pxPerSec });
        if (!isFinite(x) || x < -6 || x > L.width + 6) continue;
        const cy = rowTop + L.rowH / 2;
        const sel =
          state.edit.timeline.selectedKey &&
          state.edit.timeline.selectedKey.rowKey === lib.rowKey(row) &&
          Math.abs(state.edit.timeline.selectedKey.time - key.time) < 1e-6;
        /* P1（T21）：多选高亮（选择集内 = 主色描边；primary = 白色描边） */
        const selSet = state.edit.timeline.selection && Array.isArray(state.edit.timeline.selection.items) ? state.edit.timeline.selection.items : [];
        const inSel = selSet.some((it) => it.kind === row.kind && it.owner === row.owner && it.field === row.field && Math.abs(it.time - key.time) < 1e-6);
        const isPrimary = !!(state.edit.timeline.selection && state.edit.timeline.selection.primary &&
          state.edit.timeline.selection.primary.kind === row.kind &&
          state.edit.timeline.selection.primary.owner === row.owner &&
          state.edit.timeline.selection.primary.field === row.field &&
          Math.abs(state.edit.timeline.selection.primary.time - key.time) < 1e-6);
        /* 曲线段 Key：其自身或前一个 Key 带 curve（D1 修复后 keyHasCurve 才能识别 normalized key）。
           曲线段 Key 只读（禁止拖动/增删），这里用琥珀色描边 + 下方小三角标记，独立于选中高亮。 */
        const curved = typeof lib.keyHasCurve === "function" ? lib.keyHasCurve(key) : false;
        g.beginPath();
        g.moveTo(x, cy - 4.4);
        g.lineTo(x + 4.4, cy);
        g.lineTo(x, cy + 4.4);
        g.lineTo(x - 4.4, cy);
        g.closePath();
        g.fillStyle = row.unsupported ? "#f0b429" : sel || isPrimary ? "#ffd166" : inSel ? "#7fd1ff" : isSelRow ? "#7fd1ff" : "#5aa9ff";
        g.fill();
        if (curved && !sel) {
          g.strokeStyle = "#f0b429";
          g.lineWidth = 1.2;
          g.stroke();
        }
        if (sel || isPrimary || inSel) {
          g.strokeStyle = sel || isPrimary ? "#fff" : "#bde3ff";
          g.lineWidth = sel || isPrimary ? 1.4 : 1.1;
          g.stroke();
        }
        if (curved) {
          /* 小三角始终画在菱形下方：即使该 Key 被选中（白描边）也能看出它在曲线段内 */
          g.beginPath();
          g.moveTo(x - 3, cy + 6.2);
          g.lineTo(x + 3, cy + 6.2);
          g.lineTo(x, cy + 9.6);
          g.closePath();
          g.fillStyle = "#f0b429";
          g.fill();
        }
      }
    }
    /* 结束行区裁剪（与上面的 g.save()/clip() 配对） */
    g.restore();
    /* 播放头 */
    const px = lib.timeToX({ time: state.t, scrollSec: L.scrollSec, pxPerSec: L.pxPerSec });
    if (isFinite(px)) {
      g.strokeStyle = "#f57785";
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(Math.round(px) + 0.5, 0);
      g.lineTo(Math.round(px) + 0.5, L.height);
      g.stroke();
      g.fillStyle = "#f57785";
      g.beginPath();
      g.moveTo(px - 5, 0);
      g.lineTo(px + 5, 0);
      g.lineTo(px, 7);
      g.closePath();
      g.fill();
    }
    dsRenderLabels(rows, L);
    /* P1（T21）：框选矩形（在 canvas 上补画） */
    const dbox = state.drag && state.drag.mode === "ds-box" ? state.drag.box : null;
    if (dbox) {
      g.strokeStyle = "#5aa9ff";
      g.setLineDash([4, 3]);
      g.lineWidth = 1;
      g.strokeRect(Math.round(dbox.x0) + 0.5, Math.round(dbox.y0) + 0.5, Math.max(1, dbox.x1 - dbox.x0), Math.max(1, dbox.y1 - dbox.y0));
      g.setLineDash([]);
      g.fillStyle = "rgba(90,169,255,0.12)";
      g.fillRect(dbox.x0, dbox.y0, Math.max(1, dbox.x1 - dbox.x0), Math.max(1, dbox.y1 - dbox.y0));
    }
    if ((state.edit.timeline.tab || "dopesheet") === "graph") graphDraw();
  }

  function dsRenderLabels(rows, L) {
    const box = el0("dsLabels");
    if (!box) return;
    const sig =
      rows
        .map((r) =>
          r.kind === "group"
            ? "G|" + (r.collapseKey || r.owner) + "|" + r.open + "|" + r.keyCount
            : r.kind + "|" + r.owner + "|" + r.field + "|" + r.keyCount + "|" + (r.unsupported ? 1 : 0) + "|" + (r.previewPartial ? 1 : 0) +
              (r.kind === "slot" ? "|" + (r.keys || []).map((k) => k.name).join(",") : "")
        )
        .join(";") +
      "|" + state.edit.selBone + "|" + (state.edit.timeline.extraRowKey || "") + "|" + dsScrollTop;
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.textContent = "";
    /* 0.9.117：标签列滚动 —— 老 bug 是 `paddingTop = rulerH - scrollTop` 会变负数，
       CSS padding 不接受负值（clamp 成 0），于是标签永远停在顶部、与 canvas 错位。
       正确结构：外层 #dsLabels 固定高度并裁剪（不滚动），内层行容器用负 marginTop 偏移。
       外层 paddingTop 改为 0，标尺占位交给内层 marginTop 一起算。 */
    const rowsBox = dsLabelRowsBox();
    if (!rowsBox) return;
    rowsBox.textContent = "";
    box.style.paddingTop = "0px";
    box.style.height = Math.max(0, L.height) + "px";
    rowsBox.style.marginTop = (L.rulerH - L.scrollTop) + "px";
    for (const row of rows) {
      const isGroup = row.kind === "group";
      const extra = !isGroup && isExtraKind(row.kind);
      const isSelRow = extra
        ? state.edit.timeline.extraRowKey === (timelineLib() ? timelineLib().rowKey(row) : "")
        : !isGroup && !!(state.edit.selBone && row.owner === state.edit.selBone);
      const line = el(
        "div",
        "ds-row" +
          (isGroup ? "" : row.kind === "slot" ? " is-child is-slot" : " is-child") +
          (row.unsupported ? " is-unsupported" : "") +
          (extra ? " is-extra" : "") +
          (isSelRow ? " is-selected" : "")
      );
      if (isGroup) {
        const ckey = row.collapseKey || "bone:" + row.owner;
        /* 供框选按 rowKey 对齐行位置（见 dsPointerMove 的 ds-box 分支） */
        line.setAttribute("data-row-key", "group:" + ckey);
        /* Flash 风格图层色块（0.9.110）：按轨道类型分色，与帧时间轴的图层条对应 */
        line.appendChild(el("span", "ds-swatch" + rowColorClass(row)));
        line.appendChild(el("span", "ds-caret", row.open ? "▾" : "▸"));
        line.appendChild(el("span", null, row.label));
        if (row.extra) line.appendChild(el("span", "ds-tag", "轨道组"));
        line.appendChild(el("span", "ds-count", String(row.keyCount)));
        line.title = row.note || "";
        line.addEventListener("click", () => {
          const set = dsCollapsedSet();
          if (set.has(ckey)) set.delete(ckey);
          else set.add(ckey);
          dsDraw();
        });
      } else {
        /* 供框选按 rowKey 对齐行位置（见 dsPointerMove 的 ds-box 分支） */
        line.setAttribute("data-row-key", timelineLib() ? timelineLib().rowKey(row) : "");
        const slotAtt = !extra && row.kind === "slot" && row.field === "attachment" ? slotAttachmentAt(row.owner, state.t) : null;
        const meta = extra
          ? extraLabelOf(row)
          : slotAtt
            ? "附件 " + (slotAtt.name === null || slotAtt.name === undefined ? "（空 = 隐藏）" : slotAtt.name) + (slotAtt.keyed ? " · key" : " · 绑定")
            : row.field === "attachment"
              ? "附件"
              : row.unit
                ? row.field + " " + row.unit
                : row.field;
        line.appendChild(el("span", "ds-swatch" + rowColorClass(row)));
        line.appendChild(el("span", null, meta));
        if (extra && row.previewPartial) {
          const tag = el("span", "ds-tag is-partial", row.unsupported ? "未支持" : "仅编辑");
          tag.title = row.unsupported ? "结构非法/未知：只读保留" : "core 未求值该类轨道：可编辑与保存，但预览不完整";
          line.appendChild(tag);
        }
        line.appendChild(el("span", "ds-count", String(row.keyCount)));
        /* P1-01：锁定 / 隐藏（锁定=禁止写入；隐藏=不显示行但数据保留） */
        const rowKey = timelineLib() ? timelineLib().rowKey(row) : row.owner + ":" + row.field;
        const locked = tlLockedSet().indexOf(rowKey) >= 0;
        const hidden = tlHiddenSet().indexOf(rowKey) >= 0;
        const btnLock = el("button", "ds-mini" + (locked ? " is-on" : ""), locked ? "🔒" : "🔓");
        btnLock.type = "button";
        btnLock.title = locked ? "解锁该轨（当前禁止写入）" : "锁定该轨（禁止 Key/曲线/拖动写入）";
        btnLock.addEventListener("click", (e) => {
          e.stopPropagation();
          const on = tlToggleIn(tlLockedSet(), rowKey);
          if (typeof savePrefs === "function") savePrefs();
          setStatus(on ? "已锁定轨道 " + rowKey + "：该轨禁止写入" : "已解锁轨道 " + rowKey);
          dsDraw();
        });
        const btnHide = el("button", "ds-mini" + (hidden ? " is-on" : ""), hidden ? "🙈" : "👁");
        btnHide.type = "button";
        btnHide.title = hidden ? "显示该轨（数据一直保留）" : "隐藏该轨（仅不显示，数据保留）";
        btnHide.addEventListener("click", (e) => {
          e.stopPropagation();
          const on = tlToggleIn(tlHiddenSet(), rowKey);
          if (typeof savePrefs === "function") savePrefs();
          setStatus(on ? "已隐藏轨道 " + rowKey + "（数据保留，导出不受影响）" : "已显示轨道 " + rowKey);
          dsDraw();
        });
        line.appendChild(btnLock);
        line.appendChild(btnHide);
        line.addEventListener("click", () => {
          state.edit.timeline.graphRowKey = rowKey;
          if (extra) {
            selectExtraRow(row);
            return;
          }
          if (state.model && state.model.boneIndex.has(row.owner)) selectBone(row.owner);
          syncDsGraphBar();
          graphDraw();
        });
      }
      rowsBox.appendChild(line);
    }
  }

  function dsPoint(rowKey, time) {
    const lib = timelineLib();
    const box = el0("dsTracks");
    if (!lib || !box) return null;
    const rows = dsVisibleRows(dsBuild());
    const L = dsLayout();
    const idx = rows.findIndex((r) => r.kind !== "group" && lib.rowKey(r) === rowKey);
    if (idx < 0) return null;
    const rect = box.getBoundingClientRect();
    const x = lib.timeToX({ time: time, scrollSec: L.scrollSec, pxPerSec: L.pxPerSec });
    const y = L.rulerH - L.scrollTop + idx * L.rowH + L.rowH / 2;
    return {
      rowKey: rowKey,
      index: idx,
      canvasX: x,
      canvasY: y,
      pageX: rect.left + x,
      pageY: rect.top + y,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      scrollTop: L.scrollTop,
      pxPerSec: L.pxPerSec,
      scrollSec: L.scrollSec,
    };
  }

  /** 时间轴双击空白处：额外轨道行/槽附件行 → 在该时刻新增（或更新）Key（真实指针路径） */
  function dsDoubleClickAdd(e) {
    if (!dsActivate()) return false;
    const lib = timelineLib();
    const box = el0("dsTracks");
    if (!lib || !box) return false;
    const r = box.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const L = dsLayout();
    if (p.y < L.rulerH) return false;
    /* 帧视图（规划书 §12.1）：双击空白帧 = 在当前帧记录当前评估姿态的属性值。
       帧格里逐轨道判断「哪条轨」不是帧视图的职责，所以这里走当前选中部位的
       打键流程（simpleAddKey，自带动画上下文与未记录调整的 gate）。 */
    if ((state.edit.timeline.tab || "dopesheet") === "frame") {
      const flib = frameTimelineLib();
      const hit = dsKeyHit(p);
      if (hit) return false; /* 命中已有 Key：交给拖动逻辑 */
      if (!flib) return false;
      const frame = flib.snapFrame(fsXToFrame(p.x));
      fsSelectFrame(frame, "set");
      fsSeekFrame("frame", { frame: frame });
      setStatus("双击帧 " + frame + "：按当前姿态记录关键帧");
      simpleAddKey();
      return true;
    }
    const rows = dsVisibleRows(dsBuild());
    const idx = Math.floor((p.y - L.rulerH + L.scrollTop) / L.rowH);
    const row = rows[idx];
    if (!row || row.kind === "group") return false;
    const editable = isExtraKind(row.kind) || (row.kind === "slot" && row.field === "attachment");
    if (!editable) return false;
    if (dsKeyHit(p)) return false; /* 命中已有 Key：交给拖动逻辑 */
    const time = lib.xToTime({ x: p.x, scrollSec: L.scrollSec, pxPerSec: L.pxPerSec });
    if (!Number.isFinite(time) || time < 0) return false;
    state.edit.timeline.selectedKey = { rowKey: lib.rowKey(row), owner: row.owner, field: row.field, kind: row.kind, time: time };
    if (isExtraKind(row.kind)) {
      state.edit.timeline.extraRowKey = lib.rowKey(row);
    } else {
      state.edit.timeline.extraRowKey = null;
    }
    state.edit.timeline.extraForm = null;
    const res = isExtraKind(row.kind)
      ? trackAddOrSetKey(row, { time: time })
      : (function () {
          const form = extraFormState(row);
          const v = form.values.name === "" || form.values.name === undefined ? null : String(form.values.name);
          return slotAttachmentWrite(row.owner, v, time);
        })();
    setStatus(
      res && res.ok
        ? "已在 " + round(time, 4) + "s 写入 " + (isExtraKind(row.kind) ? extraLabelOf(row) : "槽附件 " + row.owner)
        : "该处无法写入（见状态栏提示）"
    );
    return true;
  }

  function dsKeyHit(screenPoint) {
    const lib = timelineLib();
    const built = dsBuild();
    const rows = dsVisibleRows(built);
    const L = dsLayout();
    if (!lib) return null;
    const idx = Math.floor((screenPoint.y - L.rulerH + L.scrollTop) / L.rowH);
    if (idx < 0 || idx >= rows.length) return null;
    const row = rows[idx];
    if (!row || row.kind === "group") return null;
    const rowKey = lib.rowKey(row);
    for (const key of row.keys || []) {
      const x = lib.timeToX({ time: key.time, scrollSec: L.scrollSec, pxPerSec: L.pxPerSec });
      if (Math.abs(screenPoint.x - x) <= 6) return { row: row, rowKey: rowKey, time: key.time, index: (row.keys || []).indexOf(key) };
    }
    return null;
  }

  function dsActivate() {
    const panel = el0("dopesheet");
    if (!panel) return null;
    return panel.hidden ? null : panel;
  }

  function dsOpen(open) {
    const panel = el0("dopesheet");
    if (!panel) return;
    const want = open === undefined ? panel.hidden : !!open;
    if (want && !state.model) {
      setStatus("载入模型后才能展开时间轴", "warn");
      return;
    }
    /* 0.9.84：展开/收起是**高度收拢**动画。
       纯 opacity 动画（0.9.83）下面板仍占 280px，170ms 后 hidden 生效时上方工具条会瞬移
       （低帧率下能明显看到「面板先淡出下去，工具栏再跳下去」）。
       现在动画直接改 height，DOM 顺序是「工具条 → 面板 → 状态栏」，
       面板变矮会把工具条一起带着走，同一帧布局内同步移动。
       hidden 语义保持不变（dsActivate / E2E 的 offsetParent 判断都依赖它），
       所以关闭时先播收拢动画、结束后再设 hidden；期间用户再点则取消收起。 */
    const clearAnim = () => {
      panel.classList.remove("is-anim", "is-opening", "is-closing");
      panel.style.removeProperty("--ds-h");
    };
    if (want) {
      if (panel._dsCloseTimer) {
        clearTimeout(panel._dsCloseTimer);
        panel._dsCloseTimer = null;
      }
      panel.hidden = false;
      /* 把当前高度写进 CSS 变量，供 keyframes 的 to 状态使用（height:auto 无法过渡） */
      const targetH = Math.round(clamp(state.edit.timeline.height || panel.offsetHeight || 280, 160, 420));
      panel.style.setProperty("--ds-h", targetH + "px");
      panel.classList.add("is-anim");
      panel.classList.remove("is-closing");
      panel.classList.add("is-opening");
      clearTimeout(panel._dsOpenTimer);
      panel._dsOpenTimer = setTimeout(() => {
        panel.classList.remove("is-opening");
        panel.style.removeProperty("--ds-h");
      }, 220);
    } else if (!panel.hidden) {
      /* 起点 = 当前实际高度（可能是用户拖过的高度） */
      const fromH = Math.round(panel.getBoundingClientRect().height) || (state.edit.timeline.height || 280);
      panel.style.setProperty("--ds-h", fromH + "px");
      panel.classList.add("is-anim");
      panel.classList.remove("is-opening");
      panel.classList.add("is-closing");
      if (panel._dsCloseTimer) clearTimeout(panel._dsCloseTimer);
      panel._dsCloseTimer = setTimeout(() => {
        panel.hidden = true;
        clearAnim();
        panel._dsCloseTimer = null;
        /* 收起后画布变高：必须重算 canvas 尺寸再重绘（syncAll 不含这两步，
           参照 dsSetHeight 的做法，否则会出现贴图拉伸 / 命中偏移）。 */
        syncCanvasSize();
        if (state.model) {
          framePose();
          render();
        }
        syncAll();
      }, 190);
    }
    state.edit.timeline.expanded = want;
    if (typeof savePrefs === "function") savePrefs(true);
    /* 视图标签与 canvas 可见性（P1-04） */
    const tab = state.edit.timeline.tab || "dopesheet";
    if (el0("dsCanvas")) el0("dsCanvas").hidden = tab === "graph";
    if (el0("graphCanvas")) el0("graphCanvas").hidden = tab !== "graph";
    const btn = el0("btnDopesheet");
    if (btn) btn.setAttribute("aria-pressed", want ? "true" : "false");
    if (want) {
      dsFit();
      dsDraw();
      if (tab === "graph") graphDraw();
      syncDsGraphBar();
    } else {
      /* 收起动画期间画布还没变高，先立即重绘一次，避免闪；动画结束后再 syncAll */
      render();
    }
    setStatus(want ? "时间轴已展开（Tab 收起；拖动分隔条改高度）" : "时间轴已收起");
  }

  function dsSetHeight(h, opts) {
    const panel = el0("dopesheet");
    if (!panel) return;
    const clamped = Math.round(clamp(h, 160, 420));
    panel.style.height = clamped + "px";
    state.edit.timeline.height = clamped;
    if (typeof savePrefs === "function") savePrefs(true);
    /* 画布高度变了：必须重算 canvas 尺寸 / gizmo / 拾取（契约 §7） */
    syncCanvasSize();
    if (state.model) {
      framePose();
      render();
    }
    dsDraw();
    if (!opts || opts.announce !== false) setStatus("时间轴高度 " + clamped + "px");
  }

  function dsFit() {
    const built = dsBuild();
    const tl = state.edit.timeline;
    const L = dsLayout();
    const span = Math.max(built.maxTime, 0.001);
    const usable = Math.max(120, L.width - 24);
    tl.pxPerSec = clamp(usable / span, 20, 600);
    tl.scrollSec = 0;
    dsSyncBars();
    dsDraw();
  }

  function dsSetPxPerSec(v) {
    const tl = state.edit.timeline;
    tl.pxPerSec = clamp(Number(v) || 100, 20, 600);
    if (typeof savePrefs === "function") savePrefs();
    dsSyncBars();
    dsDraw();
  }

  function dsScrollBy(deltaSec) {
    const tl = state.edit.timeline;
    const built = dsBuild();
    const L = dsLayout();
    const maxScroll = Math.max(0, built.maxTime - L.width / tl.pxPerSec * 0.25);
    tl.scrollSec = clamp(tl.scrollSec + deltaSec, 0, Math.max(0, maxScroll));
    if (typeof savePrefs === "function") savePrefs();
    dsDraw();
  }

  function dsSelectKey(hit, keepSelection) {
    if (hit && typeof selectionSet === "function" && keepSelection !== true) {
      selectionSet([{ kind: hit.row.kind, owner: hit.row.owner, field: hit.row.field, time: hit.time }], { kind: hit.row.kind, owner: hit.row.owner, field: hit.row.field, time: hit.time });
    } else if (hit && keepSelection === true) {
      /* 多选拖动时只更新 primary，不塌缩选择集 */
      const sel = dsSelection();
      sel.primary = { kind: hit.row.kind, owner: hit.row.owner, field: hit.row.field, time: round(hit.time, 6) };
    }
    state.edit.timeline.selectedKey = hit ? { rowKey: hit.rowKey, owner: hit.row.owner, field: hit.row.field, kind: hit.row.kind, time: hit.time } : null;
    const del = el0("dsDelete");
    if (del) del.disabled = !hit;
    if (hit && (isExtraKind(hit.row.kind) || (hit.row.kind === "slot" && hit.row.field === "attachment"))) {
      /* P2：额外轨道行 / 槽附件行 → 打开轨道属性面板（表单不改文档，提交才写入） */
      const extraHit = isExtraKind(hit.row.kind);
      state.edit.timeline.extraRowKey = extraHit ? hit.rowKey : null;
      state.edit.timeline.extraForm = null;
      renderExtraPanel();
      renderKeyInspector();
      setStatus(
        "已选中 " + (extraHit ? extraLabelOf(hit.row) || hit.row.kind : "槽附件 " + hit.row.owner) + " 的 Key @ " + round(hit.time, 6) + "s"
      );
      dsDraw();
      return;
    }
    if (hit) {
      if (state.model && state.model.boneIndex.has(hit.row.owner) && hit.row.kind === "bone") selectBone(hit.row.owner);
      setStatus("已选中 Key：" + hit.row.owner + " / " + hit.row.field + " @ " + round(hit.time, 6) + "s");
    }
    /* §5.4：选中变化必须刷新关键帧属性检查器（早先只在额外轨道分支里刷新，
       导致选中普通骨骼 Key 时检查器一直停在上一个 Key）。 */
    renderKeyInspector();
    dsDraw();
  }

  function dsDeleteSelected() {
    const sel = state.edit.timeline.selectedKey;
    const set = dsSelection();
    if (!sel && !set.items.length) return setStatus("先选中一个关键帧", "warn");
    if (state.playing) return setStatus("播放中：先暂停再改 Key", "warn");
    if (set.items.length > 1) {
      /* P1（T21）：多选删除整批（SpineBatchEdit，一次事务） */
      dsBatchDelete();
      dsDraw();
      graphDraw();
      return;
    }
    const gate0 = trackWriteGate([sel.rowKey], "删除 Key");
    if (gate0.ok === false) return setStatus(gate0.code + "：" + gate0.reason, "warn");
    const name = state.anim || state.animEdit.sel;
    if (!name) return setStatus("没有选中的动画", "warn");
    const lib = timelineLib();
    const built = dsBuild();
    const rows = dsVisibleRows(built);
    const row = rows.find((r) => r.kind !== "group" && lib && lib.rowKey(r) === sel.rowKey);
    if (row && isExtraKind(row.kind)) {
      /* P2：额外轨道删除同样只走 SpineTrackEdit（含曲线段只读保护与合并 key 提示） */
      const res = trackDeleteAt(row, sel.time);
      if (res && res.ok) {
        state.edit.timeline.selectedKey = null;
        renderExtraPanel();
      }
      return !!(res && res.ok);
    }
    if (row) {
      const lock = lib.bezierLockedAt(row.keys || [], lib.keyIndexAtTime(row.keys || [], sel.time));
      if (lock) {
        const msg = "ANIM_CURVE_EDIT_UNSUPPORTED：该 Key 相邻段含贝塞尔曲线，删除会破坏曲线语义，已拒绝（曲线段 Key 只读）";
        setStatus(msg, "warn");
        notice("warn", msg);
        return false;
      }
    }
    const before = snapshot();
    const ok = animRemoveKey(name, sel.kind === "bone" ? "bones" : "slots", sel.owner, sel.field === "attachment" ? "attachment" : sel.field, sel.time);
    if (!ok) return false;
    commit(before);
    state.edit.timeline.selectedKey = null;
    animSetDraftRefresh();
    return true;
  }

  function animSetDraftRefresh() {
    const name = state.anim || state.animEdit.sel;
    if (name) syncAnimFromDraft(name);
    syncAnimPanel();
    syncEditToolbar();
    syncInspector();
    dsSyncBars();
    renderExtraPanel();
    dsDraw();
    render();
  }

  /* ==========================================================================
   * P1-04 Graph 曲线视图（契约 §1/§2）
   *   数据流：curve-edit 只做纯采样/手柄；写回一律走 anim-edit（setKeyCurve /
   *   setKeyTimeValue）+ animSetDraft；锁定轨先过 trackWriteGate。
   * ====================================================================== */

  function graphLib() {
    return window.SpineCurveEdit || null;
  }

  function graphCtx(row) {
    return { field: row ? row.field : undefined };
  }

  function graphRow() {
    const lib = timelineLib();
    if (!lib || !state.model || !state.anim) return null;
    const tl = state.edit.timeline;
    const want = tl.graphRowKey || (tl.selectedKey && tl.selectedKey.rowKey);
    if (!want) return null;
    const built = dsBuild();
    for (const row of built.rows || []) if (lib.rowKey(row) === want) return isExtraKind(row.kind) ? null : row;
    return null;
  }

  function graphComponents(row) {
    const lib = graphLib();
    if (!row) return 0;
    if (lib && typeof lib.componentCount === "function") {
      const n = lib.componentCount(row.field, (row.keys || [])[0]);
      if (n > 0) return n;
    }
    return row.field === "rotate" ? 1 : row.field === "attachment" ? 0 : 2;
  }

  function graphKeyValue(row, key, vi) {
    const def = row.field === "scale" ? 1 : 0;
    if (row.field === "rotate") return Number.isFinite(key.value) ? key.value : 0;
    const v = vi === 0 ? key.x : key.y;
    return Number.isFinite(v) ? v : def;
  }

  function graphValuesFor(row, vi, value) {
    if (row.field === "rotate") return { value: value };
    if (row.field === "attachment") return null;
    return vi === 0 ? { x: value } : { y: value };
  }

  function graphSamples(row, vi) {
    const lib = graphLib();
    if (!lib || !row || !(row.keys || []).length) return { ok: false, points: [], segments: [] };
    return lib.graphSamples(row.keys, vi, { field: row.field, samplesPerSegment: 24 });
  }

  /** 值域（含 padding），供坐标映射 */
  function graphRange(row, vi, samples) {
    let min = Infinity;
    let max = -Infinity;
    const pts = samples && samples.points ? samples.points : [];
    for (const p of pts) {
      if (!Number.isFinite(p.value)) continue;
      min = Math.min(min, p.value);
      max = Math.max(max, p.value);
    }
    for (const k of (row && row.keys) || []) {
      const v = graphKeyValue(row, k, vi);
      if (!Number.isFinite(v)) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = -1;
      max = 1;
    }
    if (max - min < 1e-6) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.12;
    return { min: min - pad, max: max + pad };
  }

  function graphGeometry() {
    const row = graphRow();
    const tl = state.edit.timeline;
    const vi = clamp(tl.graphComponent || 0, 0, Math.max(0, graphComponents(row) - 1));
    const samples = row ? graphSamples(row, vi) : { ok: false, points: [] };
    const range = graphRange(row, vi, samples);
    const box = el0("dsTracks");
    const L = dsLayout();
    const pad = 26;
    const plot = { x0: 44, y0: pad, w: Math.max(40, L.width - 44 - 12), h: Math.max(40, L.height - pad * 2) };
    const timeMin = L.scrollSec;
    const timeMax = L.scrollSec + plot.w / L.pxPerSec;
    return { row: row, vi: vi, samples: samples, range: range, L: L, plot: plot, timeMin: timeMin, timeMax: timeMax, box: box };
  }

  function graphXY(G, time, value) {
    const x = G.plot.x0 + (time - G.timeMin) * G.L.pxPerSec;
    const f = (value - G.range.min) / (G.range.max - G.range.min);
    const y = G.plot.y0 + (1 - f) * G.plot.h;
    return { x: x, y: y };
  }

  function graphInvXY(G, x, y) {
    return {
      time: G.timeMin + (x - G.plot.x0) / G.L.pxPerSec,
      value: G.range.min + (1 - (y - G.plot.y0) / G.plot.h) * (G.range.max - G.range.min),
    };
  }

  function graphSegmentType() {
    const lib = graphLib();
    const G = graphGeometry();
    if (!lib || !G.row) return null;
    const idx = graphSelectedIndex(G.row);
    if (idx < 0 || idx + 1 >= (G.row.keys || []).length) return null;
    const info = lib.segmentInfo(G.row.keys[idx], G.vi, G.row.keys[idx + 1], graphCtx(G.row));
    return info && info.ok ? info.type : null;
  }

  function graphSelectedIndex(row) {
    const sel = state.edit.timeline.selectedKey;
    const lib = timelineLib();
    if (!sel || !row || !lib || lib.rowKey(row) !== sel.rowKey) return -1;
    const keys = row.keys || [];
    for (let i = 0; i < keys.length; i++) if (Math.abs(keys[i].time - sel.time) < 1e-6) return i;
    return -1;
  }

  /** Graph 画布绘制：网格 + 曲线 + key + 手柄 + 播放头 */
  function graphDraw() {
    const panel = el0("dopesheet");
    if (!panel || panel.hidden) return;
    const cv3 = el0("graphCanvas");
    if (!cv3) return;
    if ((state.edit.timeline.tab || "dopesheet") !== "graph") return;
    const L = dsLayout();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(L.width * dpr));
    const h = Math.max(1, Math.round(L.height * dpr));
    if (cv3.width !== w || cv3.height !== h) {
      cv3.width = w;
      cv3.height = h;
    }
    const g = cv3.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, L.width, L.height);
    const G = graphGeometry();
    const row = G.row;
    const lib = graphLib();
    g.fillStyle = "#141922";
    g.fillRect(0, 0, L.width, L.height);
    if (!row) {
      g.fillStyle = "#8b98ad";
      g.font = "12px system-ui,sans-serif";
      g.fillText("先在 Dopesheet 选择一条属性轨（或在右侧骨列表选骨）", 16, 28);
      return;
    }
    const hidden = tlHiddenSet().indexOf(timelineLib().rowKey(row)) >= 0;
    const locked = tlLockedSet().indexOf(timelineLib().rowKey(row)) >= 0;
    /* 时间网格 */
    const ticks = timelineLib().rulerTicks({ from: G.timeMin, to: G.timeMax, pxPerSec: L.pxPerSec, fps: state.edit.timeline.fps });
    g.font = "10px ui-monospace,monospace";
    for (const tick of ticks) {
      const x = graphXY(G, tick.time, G.range.min).x;
      if (x < G.plot.x0 - 1 || x > G.plot.x0 + G.plot.w + 1) continue;
      g.strokeStyle = tick.major ? "#2c3444" : "#20262f";
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, G.plot.y0);
      g.lineTo(Math.round(x) + 0.5, G.plot.y0 + G.plot.h);
      g.stroke();
      if (tick.major && tick.label) {
        g.fillStyle = "#8b98ad";
        g.fillText(tick.label, x + 3, L.height - 4);
      }
    }
    /* 值网格 + 轴标签 */
    for (let i = 0; i <= 4; i++) {
      const v = G.range.min + ((G.range.max - G.range.min) * i) / 4;
      const y = graphXY(G, G.timeMin, v).y;
      g.strokeStyle = "#20262f";
      g.beginPath();
      g.moveTo(G.plot.x0, Math.round(y) + 0.5);
      g.lineTo(G.plot.x0 + G.plot.w, Math.round(y) + 0.5);
      g.stroke();
      g.fillStyle = "#8b98ad";
      g.fillText(fmt(v, 2), 3, y + 3);
    }
    /* 曲线 */
    const pts = G.samples && G.samples.points ? G.samples.points : [];
    if (pts.length > 1) {
      g.strokeStyle = hidden ? "#5b6577" : "#5aa9ff";
      g.lineWidth = 1.6;
      g.beginPath();
      let started = false;
      for (const p of pts) {
        const q = graphXY(G, p.time, p.value);
        if (!started) {
          g.moveTo(q.x, q.y);
          started = true;
        } else g.lineTo(q.x, q.y);
      }
      g.stroke();
      /* stepped 段用虚线提示 */
      for (const seg of G.samples.segments || []) {
        if (seg.type !== "stepped") continue;
        const y = graphXY(G, seg.time1, graphKeyValue(row, row.keys[seg.index], G.vi)).y;
        const x1 = graphXY(G, seg.time1, 0).x;
        const x2 = graphXY(G, seg.time2, 0).x;
        g.strokeStyle = "#f0b429";
        g.setLineDash([4, 3]);
        g.beginPath();
        g.moveTo(x1, y);
        g.lineTo(x2, y);
        g.stroke();
        g.setLineDash([]);
      }
    }
    /* 选中段的手柄（贝塞尔） */
    const selIdx = graphSelectedIndex(row);
    if (lib && selIdx >= 0) {
      const hres = lib.handlesOf(row.keys, selIdx, G.vi, graphCtx(row));
      if (hres && hres.ok && hres.type === "bezier") {
        const a = graphXY(G, hres.time1, hres.value1);
        const b = graphXY(G, hres.time2, hres.value2);
        g.strokeStyle = "#4ec9a5";
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(graphXY(G, hres.c1.time, hres.c1.value).x, graphXY(G, hres.c1.time, hres.c1.value).y);
        g.moveTo(b.x, b.y);
        g.lineTo(graphXY(G, hres.c2.time, hres.c2.value).x, graphXY(G, hres.c2.time, hres.c2.value).y);
        g.stroke();
        for (const h of [hres.c1, hres.c2]) {
          const q = graphXY(G, h.time, h.value);
          g.beginPath();
          g.arc(q.x, q.y, 4, 0, Math.PI * 2);
          g.fillStyle = "#4ec9a5";
          g.fill();
        }
      }
    }
    /* key 菱形 */
    for (const key of row.keys || []) {
      const v = graphKeyValue(row, key, G.vi);
      const q = graphXY(G, key.time, v);
      const isSel = selIdx >= 0 && Math.abs((row.keys || [])[selIdx].time - key.time) < 1e-6;
      const curved = lib && typeof lib.keyHasCurve === "function" ? lib.keyHasCurve(key) : false;
      g.beginPath();
      g.moveTo(q.x, q.y - 4.6);
      g.lineTo(q.x + 4.6, q.y);
      g.lineTo(q.x, q.y + 4.6);
      g.lineTo(q.x - 4.6, q.y);
      g.closePath();
      g.fillStyle = locked ? "#6b7280" : isSel ? "#ffd166" : curved ? "#f0b429" : "#5aa9ff";
      g.fill();
      if (isSel) {
        g.strokeStyle = "#fff";
        g.lineWidth = 1.3;
        g.stroke();
      }
    }
    /* 播放头 */
    const px = graphXY(G, state.t, 0).x;
    g.strokeStyle = "#f57785";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(px) + 0.5, G.plot.y0);
    g.lineTo(Math.round(px) + 0.5, G.plot.y0 + G.plot.h);
    g.stroke();
    /* 标题 / 状态 */
    const compName = graphComponents(row) > 1 ? (G.vi === 0 ? "x" : "y") : "";
    g.fillStyle = "#e6ebf5";
    g.font = "11px ui-monospace,monospace";
    g.fillText(row.owner + " / " + row.field + (compName ? " · " + compName : "") + "  ·  " + (row.keys || []).length + " key" + (locked ? "  · 已锁定（只读）" : "") + (hidden ? "  · 轨道隐藏（只读）" : ""), 6, 12);
  }

  /** 命中：手柄优先，其次 key */
  function graphHit(p) {
    const G = graphGeometry();
    const row = G.row;
    const lib = graphLib();
    if (!row) return null;
    const selIdx = graphSelectedIndex(row);
    if (lib && selIdx >= 0) {
      const hres = lib.handlesOf(row.keys, selIdx, G.vi, graphCtx(row));
      if (hres && hres.ok && hres.type === "bezier") {
        for (const which of ["c1", "c2"]) {
          const h = hres[which];
          const q = graphXY(G, h.time, h.value);
          if (Math.hypot(p.x - q.x, p.y - q.y) <= 7) return { kind: "handle", which: which, index: selIdx };
        }
      }
    }
    const keys = row.keys || [];
    for (let i = 0; i < keys.length; i++) {
      const q = graphXY(G, keys[i].time, graphKeyValue(row, keys[i], G.vi));
      if (Math.hypot(p.x - q.x, p.y - q.y) <= 8) return { kind: "key", index: i };
    }
    return null;
  }

  function graphSelectRow(rowKey) {
    state.edit.timeline.graphRowKey = rowKey || null;
    syncDsGraphBar();
    graphDraw();
  }

  function graphSelectKeyAt(index) {
    const G = graphGeometry();
    const row = G.row;
    const lib = timelineLib();
    if (!row || index < 0 || index >= (row.keys || []).length) return;
    const key = row.keys[index];
    dsSelectKey({ row: row, rowKey: lib.rowKey(row), time: key.time, index: index });
    graphDraw();
  }

  /** 拖动中：更新预览（key 的 time+value，或手柄的 curve 控制点） */
  function graphDragTo(p) {
    const d = state.drag;
    if (!d || (d.mode !== "graph-key" && d.mode !== "graph-handle")) return;
    const G = graphGeometry();
    const row = d.row;
    const lib = timelineLib();
    const cur = graphInvXY(G, p.x, p.y);
    if (d.mode === "graph-key") {
      let t = clamp(cur.time, 0, Math.max(state.animDur, 0));
      if (state.edit.timeline.snapFrames) {
        t = clamp(lib.snapTime({ time: t, fps: state.edit.timeline.fps, enabled: true }), 0, Math.max(state.animDur, 0));
      }
      d.pendingTime = t;
      d.pendingValue = cur.value;
      setStatus("Graph 拖动：" + row.owner + "/" + row.field + " → " + round(t, 4) + "s = " + round(cur.value, 3));
    } else {
      const dlib = graphLib();
      const keys = d.keys;
      const res = dlib.applyHandleDrag(keys, d.index, G.vi, d.which, { time: cur.time, value: cur.value }, graphCtx(row));
      if (!res || res.ok !== true) {
        setStatus((res && res.reason ? res.reason : "HANDLE_DRAG_FAILED") + "：手柄拖动被拒绝", "warn");
        return;
      }
      d.pendingKeys = res.value;
      setStatus("Graph 手柄：" + d.which + " → t=" + round(cur.time, 4) + "s v=" + round(cur.value, 3));
    }
    graphDraw();
  }

  function graphPointerDown(e) {
    if ((state.edit.timeline.tab || "dopesheet") !== "graph") return false;
    const box = el0("dsTracks");
    const r = box.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const row = graphRow();
    if (!row) {
      setStatus("Graph：先在 Dopesheet 选一条属性轨", "warn");
      return true;
    }
    const rowKey = timelineLib().rowKey(row);
    const gate = trackWriteGate([rowKey], "Graph 编辑");
    const hit = graphHit(p);
    if (gate.ok === false) {
      if (hit) graphSelectKeyAt(hit.index);
      setStatus(gate.code + "：" + gate.reason, "warn");
      notice("warn", gate.code + "：" + gate.reason);
      return true;
    }
    if (tlHiddenSet().indexOf(rowKey) >= 0) {
      setStatus("该轨道已隐藏：Graph 只读（显示后编辑）", "warn");
      return true;
    }
    if (!hit) {
      /* 空白：以值坐标加关键帧（同时间 upsert） */
      const G = graphGeometry();
      const cur = graphInvXY(G, p.x, p.y);
      graphAddKeyAt(row, G.vi, cur.time, cur.value);
      return true;
    }
    if (hit.kind === "handle") {
      state.drag = { mode: "graph-handle", pointerId: e.pointerId, row: row, index: hit.index, which: hit.which, keys: (row.keys || []).map((k) => JSON.parse(JSON.stringify(k))), baseline: snapshot() };
    } else {
      graphSelectKeyAt(hit.index);
      state.drag = {
        mode: "graph-key",
        pointerId: e.pointerId,
        row: row,
        index: hit.index,
        fromTime: row.keys[hit.index].time,
        baseline: snapshot(),
        pendingTime: row.keys[hit.index].time,
        pendingValue: graphKeyValue(row, row.keys[hit.index], graphGeometry().vi),
      };
    }
    box.setPointerCapture(e.pointerId);
    return true;
  }

  function graphPointerUp() {
    const d = state.drag;
    if (!d || (d.mode !== "graph-key" && d.mode !== "graph-handle")) return;
    const name = state.anim || state.animEdit.sel;
    const lib = animEditLib();
    const row = d.row;
    const kind = row.kind === "bone" ? "bones" : "slots";
    const field = row.field;
    const raw = animDraft(name);
    if (lib && raw && name) {
      const gate = trackWriteGate([timelineLib().rowKey(row)], "Graph 编辑");
      if (gate.ok === false) {
        setStatus(gate.code + "：" + gate.reason, "warn");
      } else if (d.mode === "graph-key") {
        const values = graphValuesFor(row, graphGeometry().vi, d.pendingValue);
        const res = values ? lib.setKeyTimeValue(raw, kind, row.owner, field, d.fromTime, d.pendingTime, values) : { ok: false, issues: [{ code: "GRAPH_FIELD_UNSUPPORTED" }] };
        if (!res.ok) {
          setStatus((res.issues[0] && res.issues[0].code ? res.issues[0].code : "GRAPH_EDIT_REJECTED") + "：Key 写回被拒绝", "warn");
        } else if (animSetDraft(name, res.value) && commit(d.baseline)) {
          state.edit.timeline.selectedKey = { rowKey: timelineLib().rowKey(row), owner: row.owner, field: field, kind: row.kind, time: d.pendingTime };
          setStatus("Graph：把 " + row.owner + "/" + field + " 的 Key 改为 " + round(d.pendingTime, 4) + "s = " + round(d.pendingValue, 3));
          animSetDraftRefresh();
        }
      } else if (Array.isArray(d.pendingKeys)) {
        const pts = handlePointsOf(d.pendingKeys, d.index, graphGeometry().vi, row);
        const res2 = pts ? lib.setKeyCurve(raw, kind, row.owner, field, row.keys[d.index].time, graphGeometry().vi, { points: pts }) : { ok: false, issues: [{ code: "GRAPH_HANDLE_EMPTY" }] };
        if (!res2.ok) {
          setStatus((res2.issues[0] && res2.issues[0].code ? res2.issues[0].code : "GRAPH_EDIT_REJECTED") + "：手柄写回被拒绝", "warn");
        } else if (animSetDraft(name, res2.value) && commit(d.baseline)) {
          setStatus("Graph：已更新 " + row.owner + "/" + field + " 的贝塞尔手柄");
          animSetDraftRefresh();
        }
      }
    }
    state.drag = null;
    graphDraw();
  }

  /** 从整条 keys 里取出该段的手柄控制点 */
  function handlePointsOf(keys, index, vi, row) {
    const lib = graphLib();
    if (!lib || !Array.isArray(keys) || index + 1 >= keys.length) return null;
    const info = lib.segmentInfo(keys[index], vi, keys[index + 1], graphCtx(row));
    if (!info || !info.ok || info.type !== "bezier") return null;
    return { cx1: info.cx1, cy1: info.cy1, cx2: info.cx2, cy2: info.cy2 };
  }

  /** Graph 空白处加 key：复用 anim-edit upsertKey（同时间 upsert） */
  function graphAddKeyAt(row, vi, time, value) {
    const name = state.anim || state.animEdit.sel;
    const lib = animEditLib();
    const tlib = timelineLib();
    if (!name || !lib || !state.model) return;
    const gate = trackWriteGate([tlib.rowKey(row)], "Graph 加 Key");
    if (gate.ok === false) {
      setStatus(gate.code + "：" + gate.reason, "warn");
      return;
    }
    const raw = animDraft(name);
    const kind = row.kind === "bone" ? "bones" : "slots";
    const values = graphValuesFor(row, vi, value);
    if (!values) return;
    let t = clamp(time, 0, Math.max(state.animDur, 0));
    if (state.edit.timeline.snapFrames) t = clamp(tlib.snapTime({ time: t, fps: state.edit.timeline.fps, enabled: true }), 0, Math.max(state.animDur, 0));
    const original = snapshot();
    const res = lib.upsertKey(raw, kind, row.owner, row.field, values, t);
    if (!res.ok) {
      setStatus((res.issues[0] && res.issues[0].code ? res.issues[0].code : "GRAPH_ADD_REJECTED") + "：加 Key 被拒绝", "warn");
      return;
    }
    if (animSetDraft(name, res.value) && commit(original)) {
      state.edit.timeline.selectedKey = { rowKey: tlib.rowKey(row), owner: row.owner, field: row.field, kind: row.kind, time: t };
      setStatus("Graph：已在 " + round(t, 4) + "s 为 " + row.owner + "/" + row.field + " 写 Key = " + round(value, 3));
      animSetDraftRefresh();
    }
  }

  /** 段类型按钮：作用于「当前选中 Key 起始的段」（末 key 禁用） */
  function graphSetSegment(type) {
    const name = state.anim || state.animEdit.sel;
    const lib = animEditLib();
    const row = graphRow();
    if (!name || !lib || !row) return setStatus("Graph：先选一条属性轨与一个 Key", "warn");
    const G = graphGeometry();
    const idx = graphSelectedIndex(row);
    if (idx < 0) return setStatus("Graph：先选中一个 Key（段类型作用于该 Key 起始的段）", "warn");
    if (idx + 1 >= (row.keys || []).length) return setStatus("末 Key 没有后续段：不能设置段类型", "warn");
    const gate = trackWriteGate([timelineLib().rowKey(row)], "Graph 段类型");
    if (gate.ok === false) return setStatus(gate.code + "：" + gate.reason, "warn");
    const raw = animDraft(name);
    const original = snapshot();
    const kind = row.kind === "bone" ? "bones" : "slots";
    const res = lib.setKeyCurve(raw, kind, row.owner, row.field, row.keys[idx].time, G.vi, { type: type });
    if (!res.ok) {
      const code = res.issues[0] && res.issues[0].code ? res.issues[0].code : "GRAPH_SEGMENT_REJECTED";
      setStatus(code + "：段类型写回被拒绝", "warn");
      notice("warn", code + "：" + (res.issues[0] && res.issues[0].message ? res.issues[0].message : "段类型写回被拒绝"));
      return;
    }
    if (animSetDraft(name, res.value) && commit(original)) {
      setStatus("Graph：段类型 → " + type + "（" + row.owner + "/" + row.field + " @" + round(row.keys[idx].time, 4) + "s）");
      animSetDraftRefresh();
    }
  }

  function graphSetComponent(vi) {
    state.edit.timeline.graphComponent = clamp(Number(vi) || 0, 0, 1);
    if (typeof savePrefs === "function") savePrefs();
    syncDsGraphBar();
    graphDraw();
  }

  function graphSetTab(tab) {
    /* **时间轴固定为 Frame 帧视图**：Dopesheet / Graph 的切换按钮已从界面移除，
       所以这里强制 want = "frame"，不再接受 dopesheet / graph。
       注意：底层的 dsCanvas / dsBuild / dsView / graphDraw 全部保留 ——
       Frame 视图的帧格、轨道树、缩略图、波形都画在 dsCanvas 上，
       Graph 的曲线绘制代码也留着（只是不再有入口），这样不会破坏任何现有能力。
       函数名保持 graphSetTab 不改，避免 5 处调用点一起动。 */
    const want = "frame";
    state.edit.timeline.tab = want;
    if (typeof savePrefs === "function") savePrefs();
    const dope = el0("dsCanvas");
    const graph = el0("graphCanvas");
    if (dope) dope.hidden = false;
    if (graph) graph.hidden = true;
    const b0 = el0("dsTabFrame");
    if (b0) b0.setAttribute("aria-pressed", "true");
    syncDsGraphBar();
    fsSyncBar();
    dsDraw();
    return want;
  }

  /** Graph 工具条状态（分量/段类型/可行性） */
  function syncDsGraphBar() {
    const row = graphRow();
    const comps = graphComponents(row);
    const extra = selectedExtraRow();
    const sel = el0("graphComp");
    if (sel) {
      sel.hidden = comps <= 1;
      if (comps > 1) sel.value = String(clamp(state.edit.timeline.graphComponent || 0, 0, comps - 1));
    }
    const idx = row ? graphSelectedIndex(row) : -1;
    const hasNext = row ? idx >= 0 && idx + 1 < (row.keys || []).length : false;
    const type = graphSegmentType();
    for (const pair of [["graphLinear", "linear"], ["graphStepped", "stepped"], ["graphBezier", "bezier"]]) {
      const btn = el0(pair[0]);
      if (!btn) continue;
      btn.disabled = !hasNext;
      btn.setAttribute("aria-pressed", type === pair[1] ? "true" : "false");
    }
    const info = el0("graphInfo");
    if (info) {
      if (!row && extra) {
        /* P2：额外轨道不进 Graph（曲线语义与骨/槽数值轨不同） */
        info.textContent = "该轨不在 Graph 支持范围（事件/绘制顺序/形变/约束请在 Dopesheet 编辑）";
      } else {
        info.textContent = row
          ? (graphComponents(row) > 1 ? (graphComponent(0) === undefined ? "" : "") : "") +
            row.field + (comps > 1 ? "·" + ((state.edit.timeline.graphComponent || 0) === 0 ? "x" : "y") : "") +
            " · " + (row.keys || []).length + " key" + (type ? " · 段:" + type : "")
          : "未选轨";
      }
    }
    const sel2 = el0("graphSelNote");
    if (sel2) sel2.hidden = !(row && idx >= 0);
  }

  function graphComponent() {
    return state.edit.timeline.graphComponent || 0;
  }

  function graphDebug() {
    const G = graphGeometry();
    const row = G.row;
    return {
      tab: state.edit.timeline.tab || "dopesheet",
      rowKey: row ? timelineLib().rowKey(row) : null,
      owner: row ? row.owner : null,
      field: row ? row.field : null,
      component: G.vi,
      components: graphComponents(row),
      keyCount: row ? (row.keys || []).length : 0,
      keyTimes: row ? (row.keys || []).map((k) => k.time) : [],
      keyValues: row ? (row.keys || []).map((k) => graphKeyValue(row, k, G.vi)) : [],
      segmentType: graphSegmentType(),
      locked: row ? tlLockedSet().indexOf(timelineLib().rowKey(row)) >= 0 : false,
      hidden: row ? tlHiddenSet().indexOf(timelineLib().rowKey(row)) >= 0 : false,
      samples: G.samples && G.samples.points ? G.samples.points.length : 0,
      range: G.range,
      geometry: {
        x0: G.plot.x0,
        y0: G.plot.y0,
        w: G.plot.w,
        h: G.plot.h,
        timeMin: G.timeMin,
        timeMax: G.timeMax,
        pxPerSec: G.L.pxPerSec,
        canvasWidth: G.L.width,
        canvasHeight: G.L.height,
      },
      keyScreen: row
        ? (row.keys || []).map((k) => {
            const q = graphXY(G, k.time, graphKeyValue(row, k, G.vi));
            return { time: k.time, value: graphKeyValue(row, k, G.vi), x: Math.round(q.x), y: Math.round(q.y) };
          })
        : [],
      selectedKey: state.edit.timeline.selectedKey,
      handles: (function () {
        const lib = graphLib();
        const idx = row ? graphSelectedIndex(row) : -1;
        if (!lib || !row || idx < 0) return null;
        const h = lib.handlesOf(row.keys, idx, G.vi, graphCtx(row));
        return h && h.ok ? { type: h.type, c1: h.c1, c2: h.c2 } : null;
      })(),
    };
  }

  function dsPointerDown(e) {
    const lib = timelineLib();
    if (!lib || !dsActivate()) return;
    if (e.button !== 0) return;
    /* Graph 标签下由 graphPointerDown 处理 */
    if ((state.edit.timeline.tab || "dopesheet") === "graph") {
      graphPointerDown(e);
      return;
    }
    const box = el0("dsTracks");
    const r = box.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const L = dsLayout();
    /* 帧视图（Frame Timeline，规划书 §3.3）：帧格与标尺的一整套指针语义在 fsPointerDown，
       它自己会在命中关键帧时回交 Dopesheet 的拖动流程（return false）。 */
    if ((state.edit.timeline.tab || "dopesheet") === "frame" && fsPointerDown(e, p, L)) return;
    if (p.y < L.rulerH) {
      /* 标尺 → scrub（走 setPlayhead，带 unkeyed guard） */
      state.drag = { mode: "ds-scrub", pointerId: e.pointerId };
      box.setPointerCapture(e.pointerId);
      dsScrubTo(p.x);
      return;
    }
    const hit = dsKeyHit(p);
    const additive = !!(e.ctrlKey || e.metaKey);
    if (!hit) {
      /* 空白：先记锚点，可能是框选（移动才成为框选，单击则清空选择） */
      state.drag = {
        mode: "ds-box",
        pointerId: e.pointerId,
        anchor: { x: p.x, y: p.y },
        box: null,
        moveMode: !additive,
      };
      box.setPointerCapture(e.pointerId);
      if (!additive) dsSelectKey(null);
      return;
    }
    const item = { kind: hit.row.kind, owner: hit.row.owner, field: hit.row.field, time: hit.time };
    if (additive) {
      selectionToggle(item, true);
      setStatus("选择：" + selectionStatusText());
      dsDraw();
      graphDraw();
      return;
    }
    if (e.shiftKey) {
      const prim = dsSelection().primary;
      if (prim) {
        const rows = dsView().rows;
        const primRow = rows.find((r) => r.kind !== "group" && r.owner === prim.owner && r.field === prim.field);
        if (primRow) {
          selectionAddRange({ row: primRow, time: prim.time }, { row: hit.row, time: hit.time });
          setStatus("Shift 连选：" + selectionStatusText());
          dsDraw();
          graphDraw();
          return;
        }
      }
    }
    const lock = lib.bezierLockedAt(hit.row.keys || [], hit.index);
    const inMulti = dsSelection().items.length > 1 && selectionContains(item);
    if (!inMulti) selectionSet([item], item);
    else dsSelectKey(hit, true);
    /* P2：额外轨道 / 槽附件行 —— 单击 Key 即选中并打开轨道属性面板（与多选分支同一套状态） */
    if (isExtraKind(hit.row.kind) || (hit.row.kind === "slot" && hit.row.field === "attachment")) {
      state.edit.timeline.selectedKey = {
        rowKey: hit.rowKey,
        owner: hit.row.owner,
        field: hit.row.field,
        kind: hit.row.kind,
        time: hit.time,
      };
      state.edit.timeline.extraRowKey = isExtraKind(hit.row.kind) ? hit.rowKey : null;
      state.edit.timeline.extraForm = null;
      state.edit.timeline.graphRowKey = hit.rowKey;
      renderExtraPanel();
      dsSyncBars();
      setStatus(
        "已选中 " + (isExtraKind(hit.row.kind) ? extraLabelOf(hit.row) : "槽附件 " + hit.row.owner) + " 的 Key @ " + round(hit.time, 6) + "s"
      );
    }
    if (lock) {
      const msg = "ANIM_CURVE_EDIT_UNSUPPORTED：该 Key 相邻段含贝塞尔曲线，重定时会破坏曲线语义，已禁用拖动（曲线段 Key 只读）";
      setStatus(msg, "warn");
      notice("warn", msg);
      dsDraw();
      return;
    }
    if (state.playing) {
      setStatus("播放中：先暂停再拖动 Key", "warn");
      return;
    }
    if (inMulti || dsSelection().items.length > 1) {
      /* 多选拖动：整批移动（一次拖拽一条事务；松手才写，拖动中只显示位移） */
      state.drag = {
        mode: "ds-key-batch",
        pointerId: e.pointerId,
        row: hit.row,
        rowKey: hit.rowKey,
        fromTime: hit.time,
        delta: 0,
        baseline: snapshot(),
      };
      box.setPointerCapture(e.pointerId);
      dsDraw();
      return;
    }
    state.drag = {
      mode: "ds-key",
      pointerId: e.pointerId,
      hit: hit,
      startX: p.x,
      baseline: snapshot(),
      moved: false,
    };
    box.setPointerCapture(e.pointerId);
  }

  function dsScrubTo(x) {
    const lib = timelineLib();
    const L = dsLayout();
    const t = lib.xToTime({ x: x, scrollSec: L.scrollSec, pxPerSec: L.pxPerSec });
    setPlayhead(t);
    dsDraw();
  }

  function dsPointerMove(e) {
    if (!dsActivate()) return;
    const d = state.drag;
    if (!d) return;
    const box = el0("dsTracks");
    const r = box.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    /* 帧视图拖动（标尺定位 / 帧范围选择） */
    if (d.mode === "fs-ruler" || d.mode === "fs-frame") {
      fsPointerMove(e, p, dsLayout());
      return;
    }
    if (d.mode === "ds-scrub") {
      dsScrubTo(p.x);
      return;
    }
    if (d.mode === "graph-key" || d.mode === "graph-handle") {
      graphDragTo(p);
      return;
    }
    if (d.mode === "ds-box") {
      /* 框选：拖动超过 3px 才进入框选（否则算单击） */
      if (!d.box && Math.hypot(p.x - d.anchor.x, p.y - d.anchor.y) < 4) return;
      d.box = { x0: Math.min(d.anchor.x, p.x), y0: Math.min(d.anchor.y, p.y), x1: Math.max(d.anchor.x, p.x), y1: Math.max(d.anchor.y, p.y) };
      const L0 = dsLayout();
      const rows = dsView().rows;
      const picked = [];
      /* **行 y 的权威来源是标签列真实 DOM 行，且必须按 rowKey 对齐，不能按索引**。
         实测踩到的坑：dsView().rows 与 #dsLabels 里的 .ds-row 顺序/数量并不一致
         （group 行、折叠、额外轨道都会错位），按索引取 band 会把 y 对到错误的行上，
         结果「框选始终 0 个 Key」。
         做法：先建 rowKey → DOM 行 rect 的映射，再按 row.rowKey 查。 */
      const labelBox = el0("dsLabels");
      const tracksBox = el0("dsTracks");
      const boxRect = tracksBox ? tracksBox.getBoundingClientRect() : null;
      const bandByKey = new Map();
      if (labelBox && boxRect) {
        const domRows = labelBox.querySelectorAll(".ds-row");
        for (const n of domRows) {
          const key = n.getAttribute("data-row-key") || n.dataset ? (n.getAttribute("data-row-key") || null) : null;
          if (!key) continue;
          const rr = n.getBoundingClientRect();
          if (!rr || !(rr.height > 0)) continue;
          bandByKey.set(key, { y0: rr.top - boxRect.top, y1: rr.bottom - boxRect.top });
        }
      }
      const rowBandOf = (row, i) => {
        const key = row && row.rowKey ? String(row.rowKey) : null;
        if (key && bandByKey.has(key)) return bandByKey.get(key);
        /* 退路：按公式（无 DOM 或没打 data-row-key 时） */
        const cy = L0.rulerH - L0.scrollTop + i * L0.rowH;
        return { y0: cy, y1: cy + L0.rowH };
      };
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.kind === "group" || row.filtered || row.hidden) continue;
        const band = rowBandOf(row, i);
        if (band.y1 < d.box.y0 || band.y0 > d.box.y1) continue;
        /* **必须用 keyTimes，不是 keys**：dsView().rows 的每行字段是
           { rowKey, kind, owner, field, label, keyCount, keyTimes, unsupported }，
           **没有 keys**。原来写 row.keys 会永远得到空数组。 */
        const times = Array.isArray(row.keyTimes) ? row.keyTimes
          : Array.isArray(row.keys) ? row.keys.map((k) => (k && typeof k === "object" ? k.time : k)) : [];
        for (const t of times) {
          if (!Number.isFinite(t)) continue;
          const x = timelineLib().timeToX({ time: t, scrollSec: L0.scrollSec, pxPerSec: L0.pxPerSec });
          if (x >= d.box.x0 - 6 && x <= d.box.x1 + 6) picked.push({ kind: row.kind, owner: row.owner, field: row.field, time: t });
        }
      }
      selectionSet(picked, picked[0] || null);
      /* 诊断：把判定过程记下来，便于查「框到了却选不中」 */
      state.edit.timeline.boxDebug = {
        box: { x0: Math.round(d.box.x0), y0: Math.round(d.box.y0), x1: Math.round(d.box.x1), y1: Math.round(d.box.y1) },
        rowCount: rows.length,
        labelRows: labelRows ? labelRows.length : 0,
        firstBand: rows.length ? rowBandOf(0) : null,
        sampleBand6: rows.length > 6 ? rowBandOf(6) : null,
        picked: picked.length,
        sampleTimes: rows.length > 6 ? (rows[6].keyTimes || []).slice(0, 3) : null,
        scrollSec: L0.scrollSec, pxPerSec: L0.pxPerSec,
      };
      setStatus("框选：" + selectionStatusText());
      dsDraw();
      return;
    }
    if (d.mode === "ds-key-batch") {
      const L = dsLayout();
      const lib2 = timelineLib();
      let toTime = lib2.xToTime({ x: p.x, scrollSec: L.scrollSec, pxPerSec: L.pxPerSec });
      if (state.edit.timeline.snapFrames) toTime = lib2.snapTime({ time: toTime, fps: state.edit.timeline.fps, enabled: true });
      d.delta = toTime - d.fromTime;
      const sign = d.delta >= 0 ? "+" : "−";
      setStatus("批量移动 " + selectionStatusText() + " · Δ " + sign + round(Math.abs(d.delta), 4) + "s（松手提交）");
      dsDraw();
      return;
    }
    if (d.mode !== "ds-key") return;
    const lib = timelineLib();
    const L = dsLayout();
    const toTime = lib.xToTime({ x: p.x, scrollSec: L.scrollSec, pxPerSec: L.pxPerSec });
    const built = dsBuild();
    const sug = lib.retimeSuggestion({
      keys: d.hit.row.keys,
      index: d.hit.index,
      toTime: toTime,
      fps: state.edit.timeline.fps,
      snapEnabled: !!state.edit.timeline.snapFrames,
      maxTime: Math.max(built.maxTime, 0.0001),
    });
    if (!sug.ok) return;
    /* D1 之后 retimeSuggestion 会给出 applyable/blocked（曲线段不可应用）；仍以它为准拦截 */
    if (sug.applyable === false || sug.blocked === true) {
      const msg = (sug.reason || "ANIM_CURVE_EDIT_UNSUPPORTED") + "：该 Key 相邻段含贝塞尔曲线，已拒绝拖动（曲线段 Key 只读）";
      setStatus(msg, "warn");
      notice("warn", msg);
      d.blocked = true;
      return;
    }
    if (sug.conflict !== null) {
      setStatus("同轨道 " + round(sug.conflict, 6) + "s 已有 Key：已拒绝落点", "warn");
      return;
    }
    d.pendingTime = sug.time;
    d.moved = Math.abs(sug.time - d.hit.time) > 1e-9;
    setStatus("拖动 " + d.hit.row.owner + " / " + d.hit.row.field + " → " + round(sug.time, 6) + "s（原 " + round(d.hit.time, 6) + "s）");
  }

  function dsPointerUp(e) {
    const d = state.drag;
    if (!d) return;
    if (d.mode === "fs-ruler" || d.mode === "fs-frame") {
      try {
        el0("dsTracks").releasePointerCapture(e.pointerId);
      } catch (_) {
        /* 忽略 */
      }
      fsPointerUp();
      return;
    }
    if (d.mode === "ds-box") {
      try {
        el0("dsTracks").releasePointerCapture(e.pointerId);
      } catch (_) {
        /* 忽略 */
      }
      state.drag = null;
      dsDraw();
      return;
    }
    if (d.mode === "ds-key-batch") {
      try {
        el0("dsTracks").releasePointerCapture(e.pointerId);
      } catch (_) {
        /* 忽略 */
      }
      const delta = d.delta;
      state.drag = null;
      if (Number.isFinite(delta) && Math.abs(delta) > 1e-9) dsBatchMove(delta);
      else setStatus("批量移动：位移为 0，未写入");
      dsDraw();
      graphDraw();
      return;
    }
    if (d.mode === "graph-key" || d.mode === "graph-handle") {
      try {
        el0("dsTracks").releasePointerCapture(e.pointerId);
      } catch (_) {
        /* 忽略 */
      }
      graphPointerUp();
      return;
    }
    if (d.mode !== "ds-key" && d.mode !== "ds-scrub") return;
    try {
      el0("dsTracks").releasePointerCapture(e.pointerId);
    } catch (_) {
      /* 忽略 */
    }
    if (d.mode === "ds-key" && d.moved && Number.isFinite(d.pendingTime)) {
      const name = state.anim || state.animEdit.sel;
      if (isExtraKind(d.hit.row.kind)) {
        /* P2：额外轨道重定时也走 SpineTrackEdit（曲线段 Key 只读） */
        const res = trackMoveKey(d.hit.row, d.hit.time, d.pendingTime);
        if (res && res.ok) {
          state.edit.timeline.selectedKey = { rowKey: d.hit.rowKey, owner: d.hit.row.owner, field: d.hit.row.field, kind: d.hit.row.kind, time: d.pendingTime };
          state.edit.timeline.extraRowKey = d.hit.rowKey;
          renderExtraPanel();
        }
      } else {
        const original = snapshot();
        const kind = d.hit.row.kind === "bone" ? "bones" : "slots";
        const field = d.hit.row.field === "attachment" ? "attachment" : d.hit.row.field;
        animRetimeKey(name, kind, d.hit.row.owner, field, d.hit.time, d.pendingTime);
        if (commit(original)) {
          state.edit.timeline.selectedKey = { rowKey: d.hit.rowKey, owner: d.hit.row.owner, field: d.hit.row.field, kind: d.hit.row.kind, time: d.pendingTime };
          setStatus("已把 " + d.hit.row.owner + " / " + d.hit.row.field + " 的 Key 从 " + round(d.hit.time, 6) + "s 重定时到 " + round(d.pendingTime, 6) + "s");
          animSetDraftRefresh();
        }
      }
    }
    state.drag = null;
    dsDraw();
  }

  function dsWheel(e) {
    if (!dsActivate()) return;
    e.preventDefault();
    const lib = timelineLib();
    const box = el0("dsTracks");
    const r = box.getBoundingClientRect();
    const L = dsLayout();
    const atTime = lib.xToTime({ x: e.clientX - r.left, scrollSec: L.scrollSec, pxPerSec: L.pxPerSec });
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const next = clamp(L.pxPerSec * factor, 20, 600);
      state.edit.timeline.pxPerSec = next;
      /* 以指针处时间为中心缩放 */
      state.edit.timeline.scrollSec = Math.max(0, atTime - (e.clientX - r.left) / next);
      dsSyncBars();
      dsDraw();
      return;
    }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      /* Shift+滚轮 / 横向滚动 = 时间轴左右滚动 */
      dsScrollBy((e.shiftKey ? e.deltaY : e.deltaX) / L.pxPerSec);
      return;
    }
    /* 普通滚轮 = 轨道纵向滚动（行数多时必需） */
    dsScrollVert(e.deltaY);
  }

  function dsScrollVert(deltaPx) {
    const built = dsBuild();
    const rows = dsVisibleRows(built);
    const L = dsLayout();
    const bodyH = Math.max(20, L.height - L.rulerH);
    const maxScroll = Math.max(0, rows.length * L.rowH - bodyH);
    dsScrollTop = clamp(dsScrollTop + deltaPx, 0, maxScroll);
    const labels = el0("dsLabels");
    if (labels) labels.dataset.sig = "";
    dsDraw();
  }

  function dsKeyDown(e) {
    if (!dsActivate()) return false;
    if (isTypingTarget(e.target)) return false;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      dsDeleteSelected();
      return true;
    }
    if (e.key === "Escape") {
      dsSelectKey(null);
      return true;
    }
    return false;
  }

  /** 事件命中读数（轻量：播放中每帧只更新这一处） */
  function syncEventNow() {
    const evNow = currentEventsAt(state.t);
    const evNode = el0("dsEventNow");
    if (!evNode) return evNow;
    const nowHit = evNow.now.map((e) => e.name).join("、");
    evNode.textContent = "事件：" + (nowHit ? "命中 " + nowHit : evNow.last ? "上次 " + evNow.last.name + " @" + round(evNow.last.time, 3) + "s" : "无");
    evNode.title = nowHit
      ? "当前时刻命中事件（只显示，不播音频）"
      : evNow.last
        ? "当前时刻未命中事件；显示最近一次事件与时刻"
        : "该动画没有事件轨道";
    evNode.classList.toggle("is-hit", !!nowHit);
    return evNow;
  }

  /** 播放/暂停时把播放头与 Dopesheet 同步（tick 里每帧调，只在展开时重绘） */
  function dsSyncPlayhead() {
    const panel = el0("dopesheet");
    if (panel && !panel.hidden) {
      syncEventNow();
      dsDraw();
    }
  }

  function dsBind() {
    const panel = el0("dopesheet");
    if (!panel) return;
    const tracks = el0("dsTracks");
    tracks.addEventListener("pointerdown", dsPointerDown);
    tracks.addEventListener("pointermove", dsPointerMove);
    tracks.addEventListener("pointerup", dsPointerUp);
    tracks.addEventListener("pointercancel", dsPointerUp);
    tracks.addEventListener("dblclick", (e) => dsDoubleClickAdd(e));
    tracks.addEventListener("wheel", dsWheel, { passive: false });
    /* 契约 §7：时间轴上下文判定（copy/paste/selectAll/delete 只在面板内生效） */
    panel.addEventListener("pointerenter", () => {
      state.timelineHot = true;
    });
    panel.addEventListener("pointerleave", () => {
      state.timelineHot = false;
    });
    panel.addEventListener("focusin", () => {
      state.timelineHot = true;
    });
    const scReset = el0("shortcutReset");
    if (scReset) scReset.addEventListener("click", () => resetShortcutsToDefaults());
    const dsTracksForHot = tracks;
    dsTracksForHot.addEventListener("focusin", () => {
      state.timelineHot = true;
    });
    const split = el0("dsSplit");
    split.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const startY = e.clientY;
      const startH = state.edit.timeline.height;
      split.setPointerCapture(e.pointerId);
      const move = (ev) => dsSetHeight(startH - (ev.clientY - startY), { announce: false });
      const end = (ev) => {
        try {
          split.releasePointerCapture(ev.pointerId);
        } catch (_) {
          /* 忽略 */
        }
        split.removeEventListener("pointermove", move);
        split.removeEventListener("pointerup", end);
        setStatus("时间轴高度 " + state.edit.timeline.height + "px");
      };
      split.addEventListener("pointermove", move);
      split.addEventListener("pointerup", end);
    });
    split.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        dsSetHeight(state.edit.timeline.height + 20);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        dsSetHeight(state.edit.timeline.height - 20);
      }
    });
    const close = el0("dsClose");
    if (close) close.addEventListener("click", () => dsOpen(false));
    const bd = el0("btnDopesheet");
    if (bd) bd.addEventListener("click", () => dsOpen());
      const del = el0("dsDelete");
    if (del) del.addEventListener("click", () => dsDeleteSelected());
    /* P2-01/02：轨道属性面板按钮 */
    const addKeyBtn = el0("dsAddKey");
    if (addKeyBtn) addKeyBtn.addEventListener("click", () => extraAddOrSetFromPanel());
    const newDeformBtn = el0("dsNewDeform");
    if (newDeformBtn) newDeformBtn.addEventListener("click", () => newDeformKey());
    const extraDel = el0("dsExtraDelete");
    if (extraDel) {
      extraDel.addEventListener("click", () => {
        const row = selectedExtraRow();
        if (!row) return setStatus("先选中一条事件/绘制顺序/形变/约束行", "warn");
        trackDeleteAt(row, state.t);
        renderExtraPanel();
      });
    }
    const extraClose = el0("dsExtraClose");
    if (extraClose) {
      extraClose.addEventListener("click", () => {
        state.edit.timeline.extraRowKey = null;
        state.edit.timeline.extraForm = null;
        renderExtraPanel();
        dsDraw();
      });
    }
    const snap = el0("dsSnap");
    if (snap) snap.addEventListener("change", (e) => {
      state.edit.timeline.snapFrames = !!e.target.checked;
      setStatus(state.edit.timeline.snapFrames ? "帧吸附开：拖动 Key 吸附到 " + state.edit.timeline.fps + "fps 帧格" : "帧吸附关：保留原始 float32 时间");
      fsSyncBar();
      dsDraw();
    });
    /* ---- 规划书 P0 帧视图工具条：帧读数 / 逐帧定位 / 帧吸附 / FPS ---- */
    const fsSnap = el0("dsSnapFrame");
    if (fsSnap) {
      fsSnap.addEventListener("change", (e) => {
        state.edit.timeline.snapFrames = !!e.target.checked;
        if (state.edit.timeline.snapFrames) fsSnapCurrentToFrame();
        setStatus(
          state.edit.timeline.snapFrames
            ? "帧吸附开：定位与拖动吸附到整数帧（" + tlFps() + "fps）"
            : "帧吸附关：允许小数时间定位（关键帧秒数不变）"
        );
        fsSyncBar();
        dsDraw();
      });
    }
    const fsPrev = el0("dsPrevFrame");
    if (fsPrev) fsPrev.addEventListener("click", () => fsSeekFrame("prev"));
    const fsNext = el0("dsNextFrame");
    if (fsNext) fsNext.addEventListener("click", () => fsSeekFrame("next"));
    const fsFirst = el0("dsFrameFirst");
    if (fsFirst) fsFirst.addEventListener("click", () => fsSeekFrame("first"));
    const fsLast = el0("dsFrameLast");
    if (fsLast) fsLast.addEventListener("click", () => fsSeekFrame("last"));
    /* §3.3 帧选择工具（帧选择 / 框选）+ §6.1 帧段复制 */
    const fsToolSel = el0("dsFrameToolSelect");
    if (fsToolSel) fsToolSel.addEventListener("click", () => fsSetFrameTool("frameSelect"));
    const fsToolBox = el0("dsFrameToolBox");
    if (fsToolBox) fsToolBox.addEventListener("click", () => fsSetFrameTool("frameBox"));
    const fsCopyBtn = el0("dsFrameCopy");
    if (fsCopyBtn) fsCopyBtn.addEventListener("click", () => fsCopyRangeToClipboard());
    const fsDupBtn = el0("dsFrameDup");
    if (fsDupBtn) fsDupBtn.addEventListener("click", () => fsDuplicateRange(1));
    const fsFps = el0("dsFps");
    if (fsFps) {
      const applyFps = () => {
        const lib = frameTimelineLib();
        const v = lib ? lib.normFps(Number(fsFps.value)) : Number(fsFps.value) || 30;
        state.edit.timeline.fps = v;
        /* §7.4：改 FPS 只改显示帧编号，不改关键帧实际秒数 */
        setStatus("帧率改为 " + v + "fps：关键帧的实际秒数不变，只改显示帧编号（要改速度请用整体重定时）");
        fsSyncBar();
        dsSyncBars();
        dsDraw();
      };
      fsFps.addEventListener("change", applyFps);
    }
    /* P1-01/P1-04：视图切换 / 搜索 / 仅有 Key / Graph 分量 / 段类型 */
    const tabF = el0("dsTabFrame");
    if (tabF) tabF.addEventListener("click", () => graphSetTab("frame"));
    const tabD = el0("dsTabDope");
    if (tabD) tabD.addEventListener("click", () => graphSetTab("dopesheet"));
    const tabG = el0("dsTabGraph");
    if (tabG) tabG.addEventListener("click", () => graphSetTab("graph"));
    const search = el0("dsSearch");
    if (search) {
      search.addEventListener("input", (e) => {
        state.edit.timeline.search = e.target.value || "";
        if (typeof savePrefs === "function") savePrefs();
        dsDraw();
      });
    }
    const onlyKeyed = el0("dsOnlyKeyed");
    if (onlyKeyed) {
      onlyKeyed.addEventListener("change", (e) => {
        state.edit.timeline.onlyKeyed = !!e.target.checked;
        if (typeof savePrefs === "function") savePrefs();
        const v = dsView();
        setStatus(
          "轨道过滤：" + (state.edit.timeline.onlyKeyed ? "仅显示有 Key 的轨" : "显示全部（已知骨补空轨）") +
            " → 可见 " + v.rows.length + " 行 / 共 " + ((v.view && v.view.total) || (v.built.rows || []).length) + " 行" +
            (v.built.emptyAdded ? "（补空轨 " + v.built.emptyAdded + " 条）" : "")
        );
        dsDraw();
      });
    }
    const comp = el0("graphComp");
    if (comp) comp.addEventListener("change", (e) => graphSetComponent(e.target.value));
    for (const pair of [["graphLinear", "linear"], ["graphStepped", "stepped"], ["graphBezier", "bezier"]]) {
      const btn = el0(pair[0]);
      if (btn) btn.addEventListener("click", () => graphSetSegment(pair[1]));
    }
    const px = el0("dsPxPerSec");
    if (px) px.addEventListener("input", (e) => dsSetPxPerSec(e.target.value));
    const zi = el0("dsZoomIn");
    if (zi) zi.addEventListener("click", () => dsSetPxPerSec(state.edit.timeline.pxPerSec * 1.3));
    const zo = el0("dsZoomOut");
    if (zo) zo.addEventListener("click", () => dsSetPxPerSec(state.edit.timeline.pxPerSec / 1.3));
    const ft = el0("dsFit");
    if (ft) ft.addEventListener("click", () => dsFit());
    dsSetHeight(state.edit.timeline.height, { announce: false });
    dsOpen(false);
  }

  /* ---- 预览播放范围（P0-22）：只影响播放与 scrub，绝不写 JSON / 不缩放 Key ---- */
  function previewRangeOf(name) {
    const tl = state.edit.timeline;
    const map = tl.previewRangeByAnim || (tl.previewRangeByAnim = {});
    const key = name || state.anim || state.animEdit.sel || "";
    const r = map[key];
    if (!r || !(r.to > r.from)) return { from: 0, to: state.animDur, custom: false };
    return { from: r.from, to: r.to, custom: true };
  }

  function setPreviewRange(from, to) {
    const name = state.anim || state.animEdit.sel;
    if (!name) return setStatus("先选一个动画", "warn");
    const D = state.animDur;
    let f = Number(from);
    let t = Number(to);
    if (!Number.isFinite(f) || !Number.isFinite(t)) return setStatus("预览起止必须是数字", "warn");
    f = clamp(f, 0, Math.max(D, 0));
    t = clamp(t, 0, Math.max(D, 0));
    if (!(t > f)) return setStatus("预览结束必须大于起始", "warn");
    const map = state.edit.timeline.previewRangeByAnim || (state.edit.timeline.previewRangeByAnim = {});
    map[name] = { from: f, to: t };
    syncPreviewRange();
    render();
    setStatus("预览播放范围 " + round(f, 3) + "–" + round(t, 3) + "s（只影响播放与 scrub，未改动画数据）");
    return true;
  }

  function clearPreviewRange() {
    const name = state.anim || state.animEdit.sel;
    const map = state.edit.timeline.previewRangeByAnim || {};
    if (name) delete map[name];
    syncPreviewRange();
    render();
    setStatus("预览播放范围回到整段 0–" + round(state.animDur, 3) + "s");
  }

  function syncPreviewRange() {
    const name = state.anim || state.animEdit.sel;
    const D = state.animDur;
    const r = previewRangeOf(name);
    const from = el0("rpFrom");
    const to = el0("rpTo");
    const on = !!name && D > 0;
    if (from) {
      from.disabled = !on;
      if (document.activeElement !== from) from.value = String(round(r.from, 4));
    }
    if (to) {
      to.disabled = !on;
      if (document.activeElement !== to) to.value = String(round(r.to, 4));
    }
    if (el0("rpApply")) el0("rpApply").disabled = !on;
    if (el0("rpReset")) el0("rpReset").disabled = !on || !r.custom;
    if (el0("rpState")) el0("rpState").textContent = r.custom ? "自定义 " + round(r.from, 2) + "–" + round(r.to, 2) + "s（不写 JSON）" : "整段 0–" + round(D, 2) + "s";
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

  /** 与另存/保存共用的补丁：无改动时复用缓存原文（契约 §4.2.1）
   *  动画草稿存在时必须重新序列化（复用原文会丢掉 animations 编辑）。 */
  function patchedModel() {
    const lib = window.SpineBundle;
    const res = lib.buildPatchedModel(state.raw, currentBoneValues(), currentSlotOrder());
    if (!res.ok) throw issuesToError(res.issues, "生成模型补丁失败：");
    let patched = res.value;
    /* 附件补丁（T5 applyAttachmentEdits）：整批原子，先查 ok 再交付 value */
    if ((state.edit.attachmentPatches || []).length) {
      const attRes = applyAttachmentPatches(patched);
      if (!attRes.ok) throw issuesToError(attRes.issues, "写入附件编辑失败：");
      patched = attRes.value;
    }
    const animNames = Object.keys(state.animEdit.drafts);
    if (animNames.length) {
      const edit = animEditLib();
      if (!edit || typeof edit.applyAnimationDrafts !== "function") throw new LoadError("anim-edit.js 未加载，无法写入动画编辑");
      const merged = edit.applyAnimationDrafts(patched, state.animEdit.drafts);
      if (!merged.ok) throw issuesToError(merged.issues, "写入动画编辑失败：");
      patched = merged.value;
      /* 保存前自检：序列化结果必须是可解析 JSON，且非动画字段与补丁保持一致 */
      let parsedBack = null;
      const textOut = lib.serializeModel(patched);
      try {
        parsedBack = JSON.parse(textOut);
      } catch (e) {
        throw new LoadError("动画编辑后的 model.json 不是合法 JSON", e && e.message);
      }
      if (!parsedBack || !parsedBack.animations) throw new LoadError("动画编辑后的 model.json 缺少 animations");
    }
    const reuse = snapshot() === state.initial && !animNames.length && !(state.edit.attachmentPatches || []).length && !!(state.bundle && state.bundle.modelText);
    return { patched: patched, text: reuse ? state.bundle.modelText : lib.serializeModel(patched), reused: reuse };
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
    if (isLocalMode()) return "本地目录载入：没有写回服务，无法就地保存；可用「另存 ZIP」导出";
    if (state.saveBusy) return "正在保存…";
    if (state.zipBusy) return "正在生成 ZIP…";
    if (!state.model) return "尚未载入；请选择 manifest.json";
    if (state.writeState === "checking") return "正在检查写入服务…";
    if (state.writeState === "uncertain") return "保存结果待确认；请重新载入后再就地保存";
    if (!saveTarget()) {
      const b = state.bundle;
      if (b && b.reason) return b.reason;
      return "已载入但无写回目标；请选择 manifest.json";
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
    if (!state.model) return "尚未载入；请选择 manifest.json";
    const b = state.bundle;
    if (b && b.reason) return b.reason;
    if (canArchiveNow()) return "打包 manifest.json + model + atlas + 贴图（ZIP 下载）";
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
    /* 未打键的 transient 不写进文档；保存前必须先处理（契约 §3/§6） */
    if (transientActive()) {
      guardUnkeyed("保存文件", () => saveToDisk());
      return false;
    }
    /* P2-06（task-28）：保存前跑 validateSkeleton；有 error 弹确认列出问题，用户取消则中止 */
    const skelCheck = typeof preSaveSkeletonCheck === "function" ? preSaveSkeletonCheck() : { ok: true };
    if (!skelCheck.ok && skelCheck.blocked) {
      setStatus("保存已取消：validateSkeleton 报了 " + (skelCheck.issues || []).length + " 个骨架 error", "warn");
      return false;
    }
    if (skelCheck.issues && skelCheck.issues.length) {
      state.edit.skelLast = { at: state.t, ok: !skelCheck.issues.some((i) => i.code === "BONE_CYCLE" || i.code === "BONE_NAME_DUPLICATE"), issues: skelCheck.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })), phase: "pre-save" };
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
    /* 先清草稿 / 附件补丁 / transient，再取基线 —— 顺序反了会让 initial 里仍含已落盘的草稿（契约 §3）。 */
    const savedAnims = Object.keys(state.animEdit.drafts);
    if (savedAnims.length) {
      animCommitSaved();
      for (const n of savedAnims) {
        if (state.raw && state.raw.animations && state.raw.animations[n]) syncAnimFromDraft(n);
      }
      if (state.anim) {
        state.animDur = animDuration(state.anim);
        updateTimeLabel();
      }
    } else {
      syncAnimFromDraft(state.anim || state.animEdit.sel);
    }
    state.edit.transient = null;
    state.edit.attachmentPatches = [];
    /* 保存后必须让内存模型与磁盘一致：附件补丁只写进了 state.raw（skins），
       state.model 的解析态 skins 还是旧值 —— 不重建就会出现「保存成功但画面回退到旧附件」。
       重建只换 model（bones/skins/slots/animations 全部来自新 raw），state.slots/bones 是值拷贝不受影响。 */
    let reprased = false;
    try {
      const fresh = parseBundle(state.raw, b.atlasText);
      state.model = fresh.model;
      state.atlas = fresh.atlas;
      reprased = true;
    } catch (e) {
      notice("warn", "保存后重建内存模型失败（画面可能与磁盘不一致，请重新载入核对）：" + (e && e.message));
    }
    if (reprased) {
      /* 重建后 bones 已是新值：boneList 对齐落盘值，slots 索引沿用 */
      alignBonesToSaved(patch.patched);
      state.slots = state.model.slots.map((sl, i) => ({
        name: sl.name,
        index: i,
        boneIndex: sl.boneIndex,
        boneName: state.model.bones[sl.boneIndex] ? state.model.bones[sl.boneIndex].name : "",
        attachment: sl.setupAttachment,
      }));
      syncSlotOrderToModel();
    }
    state.initial = snapshot();
    state.dirty = false;
    /* P0 明确清历史：旧快照里的 drafts/transient 已无法回滚到新 raw，保留会造成错误的跨保存撤销。 */
    const hadHistory = state.undo.length + state.redo.length;
    state.undo.length = 0;
    state.redo.length = 0;
    state.writeState = "ready";
    syncAll();
    syncEditToolbar();
    syncInspector();
    framePose();
    render();

    const changed = check.value.changed;
    const unchanged = check.value.unchanged;
    const changedText = changed.length ? "写入 " + changed.join("、") : "无文件变化";
    notice(
      "info",
      "已保存到 " + b.base + "：" + changedText + "；未变化 " + unchanged.length + " 个文件" +
        (hadHistory ? "。历史已从本次保存重新开始（撤销/重做栈已清空）" : "")
    );
    setStatus("已保存 " + changed.length + " 个文件 / " + unchanged.length + " 个未变化 · " + b.base);
    /* P2-06：保存后再跑一次 validateSkeleton（写进 state，证据 JSON 可读） */
    if (typeof skeletonValidateNow === "function") {
      const v = skeletonValidateNow();
      state.edit.skelLast = Object.assign({}, state.edit.skelLast || {}, {
        ok: !!v.ok,
        issues: (v.issues || []).map((i) => ({ code: i.code, path: i.path, message: i.message })),
        phase: "post-save",
        at: state.t,
      });
      if (!v.ok) notice("warn", "保存后 validateSkeleton 仍有 " + (v.issues || []).length + " 个问题（见骨架结构面板）");
    }
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

  /* 简化界面（用户拍板）：文件菜单只留「载入 / 保存 / 另存」三件事。
   * 已移除三组（曾在此菜单里）：事件（事件测试…、载入语音包…）、示例（发布区两个包）、
   * 测试样张（fixtures）。移除后的可达性（不是删功能，是收回入口）：
   *   · 台词分页 → 右栏「台词」标签仍可直接点开（openVoice 只是切标签的糖）；
   *   · 语音包 → 随 manifest.voice.index 自动载入，无需手动选；
   *   · 示例 / fixtures → 本仓库 assets/characters 无包数据（点了 404），
   *                 selftest.html 仍跑 fixtures 断言；脚本侧 __characterEditor.loadFixture 仍在。 */
  function buildFileMenu() {
    const menu = el0("menuFile");
    menu.textContent = "";
    menu.appendChild(
      menuItem("load", {
        label: "载入文件…",
        icon: "open",
        note: "选整个包目录（含 manifest.json）",
        onClick: () => pickPackSource(),
      })
    );
    menu.appendChild(
      menuItem("save", { label: "保存文件", icon: "save", kbd: MOD_LABEL + "+S", note: "", onClick: saveToDisk })
    );
    menu.appendChild(menuItem("saveAs", { label: "另存文件", icon: "layers", note: "", onClick: saveAsZip }));
    menu.appendChild(menuSep());
    /* 「本地项目」是**分组标题**，不是一个菜单项；被扫到的包各自占一条（0.9.2） */
    menu.appendChild(menuTitle("本地项目"));
    const packsBox = el("div", "menu-packs");
    packsBox.id = "menuFilePacks";
    menu.appendChild(packsBox);
    renderLocalPacks();
    /* 每次展开文件菜单都重新扫一次（包可能刚被编译出来），失败只影响这一组 */
    if (!state.localPacksBusy) {
      state.localPacksBusy = true;
      refreshLocalPacks().then(() => { state.localPacksBusy = false; });
    }
  }

  function buildEditMenu() {
    const menu = el0("menuEdit");
    menu.textContent = "";
    menu.appendChild(
      menuItem("toolMove", { label: "移动", icon: "move", kbd: "V", check: true, onClick: () => setTool("move") })
    );
    menu.appendChild(
      menuItem("toolPan", { label: "拖拽", icon: "hand", kbd: "H", check: true, onClick: () => setTool("pan") })
    );
    menu.appendChild(menuSep());
    menu.appendChild(
      menuItem("undo", { label: "撤销", icon: "undo", kbd: MOD_LABEL + "+Z", onClick: () => undo() })
    );
    menu.appendChild(
      menuItem("redo", {
        label: "重做",
        icon: "undo",
        kbd: MOD_LABEL + "+Shift+Z",
        onClick: () => redo(),
      })
    );
    menu.appendChild(
      menuItem("reset", { label: "重置", icon: "reset", note: "回到最近保存状态", onClick: () => resetAll() })
    );
  }

  function buildViewMenu() {
    const menu = el0("menuView");
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
    menu.appendChild(menuTitle("透明度"));
    menu.appendChild(
      menuSlider("texAlpha", {
        label: "透明度",
        min: 0,
        max: 100,
        step: 1,
        onInput: (v) => setTexAlpha(v, { auto: false }),
      })
    );
  }

  function buildHelpMenu() {
    const menu = el0("menuHelp");
    menu.textContent = "";
    /* 0.9.19：帮助浮层 + 快捷键本来就是**同一个模态框**（#helpOverlay 里既有速查表也有可自定义区），
       合并成一个入口；点击后仍滚到键盘表（保留原来「快捷键」那条的便利）。 */
    menu.appendChild(
      menuItem("help", {
        label: "帮助与快捷键",
        icon: "help",
        kbd: "?",
        note: "操作速查 / 键盘表 / 可自定义快捷键",
        onClick: () => openHelp("keys"),
      })
    );
    menu.appendChild(menuSep());
    menu.appendChild(
      menuItem("about", {
        label: "关于",
        icon: "info",
        note: "版本 · 许可 · 运行时",
        onClick: () => openAbout(),
      })
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
    /* 文件菜单已简化：voiceTest / voiceLoad / 示例 / fixtures 条目已移除，不再同步 */
    syncMenuEntry("toolMove", { checked: state.tool === "move" });
    syncMenuEntry("toolPan", { checked: state.tool === "pan" });
    syncMenuEntry("undo", { disabled: !loaded || state.undo.length === 0 });
    syncMenuEntry("redo", { disabled: !loaded || state.redo.length === 0 });
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
    const fileBtn = el0("btnMenuFile");
    if (fileBtn) fileBtn.setAttribute("aria-busy", busy ? "true" : "false");
  }

  /** 撤销 / 重做菜单项与真实栈同步（菜单未构建时静默跳过） */
  function syncUndoRedoMenu() {
    if (!menuRefs || !menuRefs.undo) return;
    const loaded = !!state.model;
    syncMenuEntry("undo", { disabled: !loaded || state.undo.length === 0 });
    syncMenuEntry("redo", { disabled: !loaded || state.redo.length === 0 });
  }

  /** 骨骼编辑工具条 / 坐标闸门 / 未打键徽标（T6） */
  function syncEditToolbar() {
    const ed = state.edit;
    if (!ed) return;
    const loaded = !!state.model;
    const targetSel = el0("editTarget");
    if (targetSel) {
      targetSel.value = editTarget();
      targetSel.disabled = !loaded;
    }
    const spaceSel = el0("editSpace");
    if (spaceSel) {
      spaceSel.value = editSpace();
      spaceSel.disabled = !loaded;
     /* World 是否可用取决于父级矩阵；这里只做提示，真正的拒绝在 spaceGate() */
      const worldOpt = spaceSel.querySelector('option[value="world"]');
      if (worldOpt) worldOpt.disabled = false;
    }
    /* 按骨闸门：World 在当前骨/工具下不可解 → 真实置灰 + title 说明（契约要求，不能只显示原因条） */
    const rotateBtn = el0("btnToolRotate");
    const scaleBtn = el0("btnToolScale");
    const name = ed.selBone;
    const gateRotate = loaded && name ? spaceGate(name, "rotate") : { ok: true };
    const gateScale = loaded && name ? spaceGate(name, "scale") : { ok: true };
    if (spaceSel && name && loaded) {
      const tool = editTool();
      const g = tool === "rotate" ? gateRotate : tool === "scale" ? gateScale : { ok: true };
      const worldBlocked = !g.ok;
      const worldOpt = spaceSel.querySelector('option[value="world"]');
      if (worldOpt) worldOpt.disabled = worldBlocked;
      if (worldBlocked && editSpace() === "world") {
        /* 当前就停在不可解的 World 上：自动回落到 Parent，避免「可点却无效」 */
        state.edit.space = "parent";
        spaceSel.value = "parent";
      }
      spaceSel.title = worldBlocked
        ? "World 在当前工具/父级下不可解：" + (g.reason || "") + " 已回落到 Parent（父骨局部）"
        : "坐标系：Parent = 父骨局部（始终可用）；World = 世界轴";
      /* 工具按钮也在不可解时置灰（只有 World 空间会不可解） */
      if (rotateBtn) {
        const blocked = editSpace() === "world" && !gateRotate.ok;
        rotateBtn.disabled = !loaded;
        rotateBtn.classList.toggle("unsupported", blocked);
        rotateBtn.title = blocked ? "World 旋转不可解：" + (gateRotate.reason || "") + "（切 Parent 可用）" : "旋转（R）";
      }
      if (scaleBtn) {
        const blocked = editSpace() === "world" && !gateScale.ok;
        scaleBtn.disabled = !loaded;
        scaleBtn.classList.toggle("unsupported", blocked);
        scaleBtn.title = blocked ? "World 缩放不可解：" + (gateScale.reason || "") + "（切 Parent 可用）" : "缩放（S）";
      }
    } else {
      if (rotateBtn) rotateBtn.disabled = !loaded;
      if (scaleBtn) scaleBtn.disabled = !loaded;
      if (spaceSel) spaceSel.title = "坐标系：Parent = 父骨局部；World = 世界轴（按选中骨判定是否可解）";
    }
    const modeSel = el0("editMode");
    if (modeSel) {
      modeSel.value = editMode();
      modeSel.disabled = !loaded;
      modeSel.title = state.edit.previewSetup
        ? "正在预览绑定姿态（只读）；再点底栏「绑定姿态」退出预览"
        : "模式：绑定姿态（改基础骨骼）或动画（改当前动画 Key）";
      modeSel.classList.toggle("is-preview", !!state.edit.previewSetup);
    }
    const modeDd = el0("editBoneMode");
    if (modeDd) {
      modeDd.textContent = state.edit.previewSetup
        ? "绑定姿态预览（只读）"
        : editMode() === "setup"
          ? "绑定姿态"
          : "动画";
    }
    /* 0.9.51：原来这里只同步 {translate, rotate, scale, pose} 四个按钮。
       但「选择」对应的状态是 state.tool === "select"（setEditTool 带 selectOnly），
       「拖拽」对应的是 state.tool === "pan"（setTool），两者都不在这张表里 ——
       于是它们的 aria-pressed 永远停在初始的 false，**点了完全看不出选中**。
       现在四个编辑工具 + 选择 + 拖拽共 6 个按钮统一按「当前工具」判定高亮，
       同一时刻只有一个亮（它们本来就是互斥的一组）。 */
    const activeTool = (function () {
      if (state.tool === "pan") return "pan";
      if (state.tool === "select") return "select";
      const t = editTool();
      return t === "rotate" || t === "scale" || t === "pose" ? t : "translate";
    })();
    const railBtns = [
      ["translate", $("btnToolMove")],
      ["rotate", $("btnToolRotate")],
      ["scale", $("btnToolScale")],
      ["pose", $("btnToolPose")],
      ["select", $("railSelect")],
      ["pan", $("btnToolPan")],
    ];
    for (const [key, b] of railBtns) {
      if (!b) continue;
      const on = activeTool === key;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.classList.toggle("on", on);
      /* 拖拽/选择在任何时候都可用（不需要载入模型）；其余编辑工具需要模型 */
      if (key === "pan" || key === "select") b.disabled = false;
      else b.disabled = !loaded;
    }
    const auto = el0("autoKeyChk");
    if (auto) {
      auto.checked = !!ed.autoKey;
      auto.disabled = !loaded || editMode() !== "animate";
    }
    /* P2-03：轴心补偿开关（仅 Setup；动画模式置灰并给原因） */
    const pivot = el0("pivotCompChk");
    if (pivot) {
      const animate = editMode() === "animate";
      pivot.checked = !!ed.pivotCompensate && !animate;
      pivot.disabled = !loaded || animate || editTarget() !== "bone";
      const wrap = el0("pivotCompWrap");
      if (wrap) {
        wrap.classList.toggle("is-off", animate || editTarget() !== "bone");
        wrap.title = !loaded
          ? "轴心补偿（保留子骨/部件位置）：载入模型后可用"
          : animate
            ? "动画模式下不可用：Spine 动画里骨的世界位置由 Key 决定，补偿只能写进 bind pose，会破坏所有动画（已置灰）"
            : editTarget() !== "bone"
              ? "轴心补偿只作用于骨骼目标：切回「骨骼」后可用（部件目标的附件拖动不牵动子骨）"
              : "轴心补偿（保留子骨/部件位置）：Setup 用 V 拖动选中骨时，在同一事务里给直接子骨与挂载的 region 附件补偿局部 x/y，使其世界位置不变";
      }
    }
    const badge = el0("editBadge");
    if (badge) badge.hidden = !transientActive();
    const gate = el0("editGate");
    if (gate) {
      const reason = editTarget() === "bone" && ed.selBone ? boneEditBlockReason(ed.selBone) : "";
      gate.hidden = !reason;
      gate.textContent = reason || "";
      gate.title = reason || "";
      gate.className = "edit-gate" + (reason ? "" : " is-ok");
    }
    const path = el0("editBonePath");
    if (path) {
      const name = ed.selBone;
      path.textContent = name ? bonePathOf(name).join(" › ") : "（未选骨）";
    }
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
    const btn = el0("btnPanel");
    const open = panelVisible();
    if (btn) {
      /* 双向开关（0.9.9）：展开时显示为「已按下」，点它即收起；
         不再是「展开后隐藏按钮」——那样面板展开后就失去收起入口。 */
      btn.setAttribute("aria-pressed", open ? "true" : "false");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.classList.toggle("on", open);
      btn.title = open ? "隐藏右侧面板（右栏）" : "显示右侧面板（部件 / 事件 / 表情 / 动画）";
      btn.disabled = false;
    }
    /* 0.9.17：右栏标题栏的 X 已移除；重开/收起统一由上面的 #btnPanel 双向开关负责。
       这里保留空值保护，以防将来又加回第二个关闭入口。 */
    const close = el0("btnPanelClose");
    if (close) close.disabled = !open;
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
  /* ---- 骨骼目标的数值编辑（Enter 提交；逐次一条事务；Animate 只改 transient） ---- */
  function applyBoneNumber(field, rawValue) {
    const name = state.edit.selBone;
    if (!name) return false;
    const reason = boneEditBlockReason(name);
    if (reason) {
      setStatus(reason, "warn");
      syncInspector();
      return false;
    }
    let v = Number(rawValue);
    if (!Number.isFinite(v)) {
      syncInspector();
      return false;
    }
    if (field === "scaleX" || field === "scaleY") {
      /* 保持负 scale 的符号，只把 |v| 夹到下限；不要把 0 自动换成 1 */
      const min = 0.01;
      if (Math.abs(v) < min && v !== 0) v = v < 0 ? -min : min;
      if (v === 0) v = min;
    }
    if (field === "x" || field === "y") {
      /* 数值框是「父级局部」值；World 坐标系下按当前父矩阵换算 */
      const entry = boneEntry(name);
      const local0 = localOfBone(name);
      if (editSpace() === "world" && entry) {
        const parentWorld = effectiveParentOf(entry.index, local0);
        const lib = boneEditLib();
        if (lib && parentWorld) {
          const inv = lib.invert(parentWorld);
          if (inv) {
            const worldNow = lib.apply(parentWorld, local0.x, local0.y);
            const target = field === "x" ? { x: v, y: worldNow.y } : { x: worldNow.x, y: v };
            const next = lib.apply(inv, target.x, target.y);
            const before = snapshot();
            const vals = field === "x" ? { x: next.x } : { y: next.y };
            writeLocalBone(name, vals);
            commit(before);
            syncInspector();
            syncEditToolbar();
            render();
            return true;
          }
        }
      }
    }
    const before = snapshot();
    const vals = {};
    vals[field] = v;
    writeLocalBone(name, vals);
    if (!commit(before)) {
      syncInspector();
      return false;
    }
    syncInspector();
    syncEditToolbar();
    render();
    setStatus("已设置 " + name + " 的 " + field + " = " + round(v, 4) + (editMode() === "setup" ? "（绑定姿态）" : "（未打键预览）"));
    return true;
  }

  /* 0.9.50：检查器 DOM 删除后，这一组函数不再从输入框读值 —— 改为接受显式 value。
     不传 value 时退回旧行为（读输入框），这样时间轴内联编辑那处调用点不用改。

     **一批实测抓出来的语义修正**：原来 applyInspectorNumber / applyBoneField 开头都有
       if (editTarget() === "bone") return applyBoneNumber(...)
     —— 也就是说"写槽位"的函数在骨骼目标下会**拐去写骨骼**。界面在时这不是问题
     （两条路径各有各的输入框，用户点哪个就很清楚），但接口统一叫 slotField 之后就成了
     语义错误：名字说写槽位，实际可能写骨。所以拆成：
       · applySlotNumber / applySlotField：**必定**写 state.bones[slot.boneName]，绝不拐弯，并返回原因
       · applyInspectorNumber / applyBoneField：保留原来的"按 editTarget 分流"，供时间轴等旧调用点
     ** */
  function slotWriteFail(code) {
    return { ok: false, reason: code };
  }
  function applySlotNumber(axis, raw) {
    const v = Number(raw);
    if (!Number.isFinite(v)) return slotWriteFail("VALUE_NOT_FINITE");
    if (state.sel < 0) return slotWriteFail("NO_SLOT_SELECTED");
    const reason = dragBlockReason(state.sel);
    if (reason) { setStatus(reason, "warn"); return slotWriteFail("BLOCKED: " + reason); }
    const slot = state.slots[state.sel];
    const b = state.bones[slot.boneName];
    if (!b) return slotWriteFail("SLOT_BONE_MISSING");
    const before = snapshot();
    b[axis] = v;
    if (!commit(before)) { syncInspector(); return slotWriteFail("NO_CHANGE"); }
    syncAll();
    render();
    return { ok: true, axis: axis, value: v, slot: slot.name, bone: slot.boneName };
  }
  function applySlotField(field, raw) {
    const v = Number(raw);
    if (!Number.isFinite(v)) return slotWriteFail("VALUE_NOT_FINITE");
    if (state.sel < 0) return slotWriteFail("NO_SLOT_SELECTED");
    const slot = state.slots[state.sel];
    /* 与界面原有禁用规则一致：动画模式下槽位变换锁死（旋转/缩放由 Key 决定），锁定件不可改 */
    if (state.anim) return slotWriteFail("ANIMATION_LOCKED: 动画模式下槽位变换只读，请改 Key 或先退出动画");
    if (state.locked.has(slot.name)) return slotWriteFail("SLOT_LOCKED: 该部件已锁定");
    const reason = dragBlockReason(state.sel);
    if (reason) { setStatus(reason, "warn"); return slotWriteFail("BLOCKED: " + reason); }
    const b = state.bones[slot.boneName];
    if (!b) return slotWriteFail("SLOT_BONE_MISSING");
    const before = snapshot();
    b[field] = field === "scaleX" || field === "scaleY" ? (v > 0 ? v : 0.01) : v;
    if (!commit(before)) { syncInspector(); return slotWriteFail("NO_CHANGE"); }
    syncInspector();
    syncDebug();
    render();
    return { ok: true, field: field, value: v, slot: slot.name, bone: slot.boneName };
  }
  /* 保留原名的分流版本：时间轴内联编辑等旧调用点仍走这里 */
  function applyInspectorNumber(axis, explicit) {
    if (editTarget() === "bone") {
      return applyBoneNumber(axis, explicit === undefined ? 0 : explicit);
    }
    const res = applySlotNumber(axis, explicit === undefined ? 0 : explicit);
    return res === true || (res && res.ok) === true;
  }
  function applyBoneField(field, rawValue) {
    if (editTarget() === "bone") return applyBoneNumber(field, rawValue);
    const res = applySlotField(field, rawValue);
    return res === true || (res && res.ok) === true;
  }
  function bindUI() {
    /* task-37 缺陷 3：未保存时离开页面给出浏览器级提示（页内模态负责"打开另一个包"） */
    window.addEventListener("beforeunload", (e) => {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = "还有没保存的调整";
      return "还有没保存的调整";
    });
    el0("btnEmptyLoad").addEventListener("click", () => pickPackSource());
    /* 载入路径：按钮 + 回车 */
    const btnLoadPath = el0("btnLoadPath");
    if (btnLoadPath) {
      btnLoadPath.addEventListener("click", () => { loadPackPathFromInput(); });
    }
    const packPathInput = el0("packPathInput");
    if (packPathInput) {
      packPathInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          loadPackPathFromInput();
        }
      });
      packPathInput.addEventListener("input", () => {
        packPathInput.classList.remove("is-bad");
        const hint = el0("packPathHint");
        if (hint) hint.textContent = "仓库相对路径；填包目录会自动补 manifest.json。需要已起本地服务（start.bat）。";
      });
      /* 记住上次成功载入的路径，下次打开页面直接可用 */
      try {
        if (state.prefs && typeof state.prefs.packPath === "string" && state.prefs.packPath) {
          packPathInput.value = state.prefs.packPath;
        }
      } catch (_) { /* 忽略 */ }
    }
    el0("filesDir").addEventListener("change", (e) => {
      /* 目录入口：把整个包读进本地树，不依赖 server */
      loadDirFiles(e.target.files).then(
        () => { e.target.value = ""; },
        () => { e.target.value = ""; }
      );
    });
    el0("files").addEventListener("change", (e) => {
      /* 单文件入口是 server / 旧包语义：先退出本地模式，避免污染读取 */
      if (isLocalMode()) clearLocalTree();
      loadFiles(e.target.files);
      e.target.value = "";
    });
    el0("btnEmptyExample").addEventListener("click", loadExample);
    /* 0.9.16：顶部「适配 / 缩放」组已移除。等价操作在左侧工具条
       （btnZoomInRail / btnZoomOutRail / btnFitRail）与快捷键（+ / − / F），
       这里只在按钮存在时绑定，避免直接对 null 调 addEventListener。 */
    const fitBtn = el0("btnFit");
    if (fitBtn) fitBtn.addEventListener("click", () => fitView("all"));
    const zoomInBtn = el0("btnZoomIn");
    if (zoomInBtn) zoomInBtn.addEventListener("click", () => zoomBy(1.25));
    const zoomOutBtn = el0("btnZoomOut");
    if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => zoomBy(1 / 1.25));
    /* 右栏双向开关（0.9.9）：一个按钮负责展开/收起，展开态也在位（不再「展开后消失」）。
       0.9.17 起右栏标题栏的 X 已移除，这里必须空值保护（原来直接对 #btnPanelClose
       调 addEventListener 会抛错，打断后面所有绑定）。 */
    const panelToggle = el0("btnPanel");
    if (panelToggle) panelToggle.addEventListener("click", () => setPanelOpen(!panelVisible()));
    const panelClose = el0("btnPanelClose");
    if (panelClose) panelClose.addEventListener("click", () => setPanelOpen(false));
    el0("helpClose").addEventListener("click", closeHelp);
    /* 关于（0.9.19）：关闭 / 遮罩点击关闭 / 帮助浮层里的跳转 */
    const aboutClose = el0("aboutClose");
    if (aboutClose) aboutClose.addEventListener("click", closeAbout);
    const aboutNode = el0("aboutOverlay");
    if (aboutNode) {
      aboutNode.addEventListener("click", (e) => {
        if (e.target === aboutNode) closeAbout();
      });
    }
    const helpOpenAbout = el0("helpOpenAbout");
    if (helpOpenAbout) {
      helpOpenAbout.addEventListener("click", () => {
        closeHelp();
        openAbout();
      });
    }
    /* task-36：简单模式的按钮/菜单/引导/帮助/时间条 */
    bindSingleUi();
    el0("helpOverlay").addEventListener("click", (e) => {
      if (e.target === el0("helpOverlay")) closeHelp();
    });
    /* ---- 右侧侧栏分页：部件 / 事件（契约 §2，非模态） ---- */
    const setListView = (view) => {
      if (state.listView === view) return;
      state.listView = view;
      syncList();
      setStatus(view === "tree" ? "部件列表：骨骼层级" : "部件列表：显示顺序");
    };
    el0("tabListTree").addEventListener("click", () => setListView("tree"));
    el0("tabListOrder").addEventListener("click", () => setListView("order"));
    /* task-7：四页平级的主分页（部件 / 事件 / 表情 / 动画） */
    const tabParts = el0("tabParts");
    if (tabParts) tabParts.addEventListener("click", () => setInspectorTab("parts"));
    const tabEvents = el0("tabEvents");
    if (tabEvents) tabEvents.addEventListener("click", () => setInspectorTab("events"));
    const tabExpr = el0("tabExpr");
    if (tabExpr) tabExpr.addEventListener("click", () => setInspectorTab("expr"));
    const tabAnim = el0("tabAnim");
    if (tabAnim) tabAnim.addEventListener("click", () => setInspectorTab("anim"));
    bindExprPanel();
    bindAnimPanel();
    el0("voiceFiles").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) loadVoiceFromFile(file);
    });
    el0("voiceSearch").addEventListener("input", (e) => {
      state.voice.search = e.target.value;
      if (state.voice.open) renderVoice();
    });
    el0("voiceStatusFilter").addEventListener("change", (e) => {
      state.voice.statusFilter = e.target.value;
      if (state.voice.open) renderVoice();
    });
    el0("voiceLinkAnim").addEventListener("change", (e) => {
      state.voice.linkAnimation = e.target.checked;
      setStatus(e.target.checked ? "已开启联动动画" : "已关闭联动动画：只播放语音");
    });
    el0("voiceIssuesToggle").addEventListener("click", () => {
      state.voice.issuesOpen = !state.voice.issuesOpen;
      if (state.voice.open) renderVoice();
    });
    el0("voiceStop").addEventListener("click", () => {
      stopVoice();
      setVoiceHint("已停止语音");
      setStatus("已停止语音");
    });
    /* 口型入口已移到每行台词上（.voice-line-lip）：口型是「某一条台词」的属性，
       不该是面板底部的全局控件。原先的 voiceLipTest / voiceLipStop / voiceLipBase /
       voiceLipMode / voiceLipInfo 全部移除。 */
    el0("voiceSeek").addEventListener("input", (e) => {
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
    el0("voiceChips").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      state.voice.category = chip.dataset.category || "all";
      renderVoice();
    });
    el0("voiceEventList").addEventListener("click", (e) => {
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
      const lipBtn = e.target.closest(".voice-line-lip");
      if (lipBtn) {
        const row = lipBtn.closest(".voice-line");
        const line = row ? voiceFindLine(row.dataset.id) : null;
        const ev = line ? voiceFindEventOfLine(line) : null;
        if (line) {
          if (ev) state.voice.selected = ev.event;
          /* 三层合成后在主时间轴播放：待机骨骼 + 该事件声明表情 + 本条台词口型。
             正在测这一条时再点 = 停止。 */
          const playing = _lipTest && _lipTest.lineId === line.id;
          if (playing) { lipTestStop(); }
          else { lipTestRun({ lineId: line.id }).then(() => renderVoice()); }
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
    const voiceAudio = el0("voiceAudio");
    if (voiceAudio) {
      voiceAudio.addEventListener("loadedmetadata", () => {
        if (!voiceIsCurrent()) return;
        const d = voiceAudio.duration;
        state.voice.play.duration = Number.isFinite(d) && d > 0 ? d : 0;
        const seek = el0("voiceSeek");
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
    const backdrop = el0("backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", () => setPanelOpen(false));
    }
    el0("btnRestoreAll").addEventListener("click", () => {
      state.hidden.clear();
      syncList();
      syncInspector();
      syncStageOverlays();
      render();
    });
    el0("btnRestoreTexture").addEventListener("click", () => {
      setLayer("texture", true);
      setStatus("已恢复贴图层");
    });
    $$(".layers input[data-layer]").forEach((cb) => {
      cb.addEventListener("change", () => setLayer(cb.dataset.layer, cb.checked));
    });
    el0("snapChk").addEventListener("change", (e) => setSnap(e.target.checked));
    /* ---- 骨骼编辑工具条（T6） ---- */
    const et = el0("editTarget");
    if (et) et.addEventListener("change", (e) => setEditTarget(e.target.value));
    const es = el0("editSpace");
    if (es) es.addEventListener("change", (e) => setEditSpace(e.target.value));
    const em = el0("editMode");
    if (em) em.addEventListener("change", (e) => setEditMode(e.target.value));
    const ak = el0("autoKeyChk");
    if (ak) ak.addEventListener("change", (e) => setAutoKey(e.target.checked));
    const tm = el0("btnToolMove");
    if (tm) tm.addEventListener("click", () => setEditTool("translate"));
    const tr = el0("btnToolRotate");
    if (tr) tr.addEventListener("click", () => setEditTool("rotate"));
    const ts = el0("btnToolScale");
    if (ts) ts.addEventListener("click", () => setEditTool("scale"));
    const tp = el0("btnToolPose");
    if (tp) tp.addEventListener("click", () => setEditTool("pose"));
    /* ---- P2-03 轴心补偿 / P2-04 洋葱皮 · 轨迹（纯显示开关） ---- */
    const pc = el0("pivotCompChk");
    if (pc) pc.addEventListener("change", (e) => setPivotCompensate(e.target.checked));
    const oc = el0("onionChk");
    if (oc) oc.addEventListener("change", (e) => setOnion({ on: e.target.checked }));
    for (const pair of [["onionBefore", "before"], ["onionAfter", "after"], ["onionStep", "step"]]) {
      const node = el0(pair[0]);
      if (node) node.addEventListener("change", (e) => setOnion({ [pair[1]]: e.target.value }));
    }
    const tc = el0("trailChk");
    if (tc) tc.addEventListener("change", (e) => setTrail(e.target.checked));
    /* ---- P2-05/P2-06（task-28）：镜像 / 片段库 / 两骨 IK / 骨架结构 ---- */
    const mBone = el0("btnMirrorBone");
    if (mBone) mBone.addEventListener("click", () => mirrorRun("bone"));
    const mAll = el0("btnMirrorAll");
    if (mAll) mAll.addEventListener("click", () => mirrorRun("anim"));
    const mWrite = el0("btnMirrorWrite");
    if (mWrite) mWrite.addEventListener("click", () => commitPendingMirror());
    const ikChk = el0("ikModeChk");
    if (ikChk) ikChk.addEventListener("change", (e) => setIkMode(e.target.checked));
    const ikMix = el0("ikMix");
    if (ikMix) ikMix.addEventListener("input", (e) => setIkMix(Number(e.target.value) / 100));
    /* 0.9.49：片段库整块 DOM 已移除，这三处绑定（保存选中 Key / 插入冲突下拉 / 保存 Setup 姿态）
       一并删除。三个动作仍有等价接口：
         saveSelectionAsClip  → __characterEditor.clipSave(name)
         collision            → __characterEditor.clipCollision("overwrite"|"skip")
         savePosePreset       → __characterEditor.poseSave(name) */
    const skelCreate = el0("btnSkelCreate");
    if (skelCreate) {
      skelCreate.addEventListener("click", () =>
        skelCreateBone({
          name: String(el0("skelName").value || "").trim(),
          parent: el0("skelParent").value,
          x: Number(el0("skelX").value),
          y: Number(el0("skelY").value),
          rotation: Number(el0("skelRot").value),
          length: Number(el0("skelLen").value),
        })
      );
    }
    const skelRep = el0("btnSkelReparent");
    if (skelRep) {
      skelRep.addEventListener("click", () => {
        const sel = state.edit.selBone;
        if (!sel) return setStatus("先选中要重父级的骨", "warn");
        skelReparent(sel, el0("skelNewParent").value, el0("skelKeepWorld").checked);
      });
    }
    const skelRename = el0("btnSkelRename");
    if (skelRename) {
      skelRename.addEventListener("click", () => {
        const sel = state.edit.selBone;
        if (!sel) return setStatus("先选中要重命名的骨", "warn");
        skelRenameBone(sel, String(el0("skelToName").value || "").trim());
      });
    }
    const skelDel = el0("btnSkelDelete");
    if (skelDel) {
      skelDel.addEventListener("click", () => {
        const sel = state.edit.selBone;
        if (!sel) return setStatus("先选中要删除的骨", "warn");
        skelDeleteBone(sel);
      });
    }
    /* ---- 时间轴（T7）与预览范围 ---- */
    dsBind();
    const rpApply = el0("rpApply");
    if (rpApply) rpApply.addEventListener("click", () => setPreviewRange(el0("rpFrom").value, el0("rpTo").value));
    const rpReset = el0("rpReset");
    if (rpReset) rpReset.addEventListener("click", () => clearPreviewRange());
    el0("texAlpha").addEventListener("input", (e) => setTexAlpha(e.target.value, { auto: false }));
    el0("weightMode").addEventListener("change", (e) => setWeightMode(e.target.value));
    el0("btnSelVisible").addEventListener("click", () => toggleHidden(state.sel));
    el0("btnSelLock").addEventListener("click", () => toggleLocked(state.sel));
    el0("btnLayerUp").addEventListener("click", () => moveLayer("up"));
    el0("btnLayerDown").addEventListener("click", () => moveLayer("down"));
    el0("btnLayerTop").addEventListener("click", () => moveLayer("top"));
    el0("btnLayerBottom").addEventListener("click", () => moveLayer("bottom"));
    el0("btnRestoreSlot").addEventListener("click", () => restoreSlot(state.sel));
    el0("posX").addEventListener("change", () => applyInspectorNumber("x"));
    el0("posY").addEventListener("change", () => applyInspectorNumber("y"));
    /* ---- 骨骼检查器（T6） ---- */
    for (const pair of [["bx", "x"], ["by", "y"], ["brot", "rotation"], ["bsx", "scaleX"], ["bsy", "scaleY"]]) {
      const node = el0(pair[0]);
      if (node) node.addEventListener("change", (e) => applyBoneNumber(pair[1], e.target.value));
    }
    const bk = el0("btnBoneKey");
    if (bk) bk.addEventListener("click", () => keySelectedBone());
    const bc = el0("btnBoneClear");
    if (bc) bc.addEventListener("click", () => selectBone(null));
    for (const pair of [["btnKeyRotate", "rotate"], ["btnKeyTranslate", "translate"], ["btnKeyScale", "scale"]]) {
      const node = el0(pair[0]);
      if (node) node.addEventListener("click", () => keySelectedBone([pair[1]]));
    }
    /* ---- 附件目标检查器（T6/P0-13） ---- */
    const attApply = (field) => {
      const identity = currentAttachmentIdentity();
      if (!identity) return;
      const reason = attachmentEditBlockReason(state.sel);
      if (reason) {
        setStatus(reason, "warn");
        syncInspector();
        return;
      }
      const idMap = { x: "attX", y: "attY", rotation: "attRot", scaleX: "attSX", scaleY: "attSY" };
      const v = Number(el0(idMap[field]).value);
      if (!Number.isFinite(v)) return syncInspector();
      const before = snapshot();
      setAttachmentFields(identity, { [field]: v });
      if (!commit(before)) return syncInspector();
      syncInspector();
      render();
      setStatus("已设置附件 " + identity.attachmentName + " 的 " + field + " = " + round(v, 4));
    };
    for (const pair of [["attX", "x"], ["attY", "y"], ["attRot", "rotation"], ["attSX", "scaleX"], ["attSY", "scaleY"]]) {
      const node = el0(pair[0]);
      if (node) node.addEventListener("change", () => attApply(pair[1]));
    }
    const attResetBtn = el0("attReset");
    if (attResetBtn) {
      attResetBtn.addEventListener("click", () => {
        const identity = currentAttachmentIdentity();
        const i = attachmentPatchIndexOf(identity);
        if (i < 0) return;
        const before = snapshot();
        state.edit.attachmentPatches.splice(i, 1);
        commit(before);
        syncInspector();
        render();
        setStatus("已恢复附件 " + identity.attachmentName + " 的原始变换");
      });
    }
    el0("rotX").addEventListener("change", (e) => applyBoneField("rotation", e.target.value));
    el0("rotRange").addEventListener("input", (e) => applyBoneField("rotation", e.target.value));
    el0("scaleX").addEventListener("change", (e) => applyBoneField("scaleX", e.target.value));
    el0("scaleY").addEventListener("change", (e) => applyBoneField("scaleY", e.target.value));
    el0("slotSearch").addEventListener("input", (e) => {
      state.search = e.target.value;
      syncList();
    });
    el0("footDiag").addEventListener("click", openDebug);
    el0("debugToggle").addEventListener("click", () => setDebugOpen(!el0("debug").classList.contains("open")));
    el0("animSel").addEventListener("change", (e) => setAnim(e.target.value));
    el0("btnPlay").addEventListener("click", togglePlay);
    el0("btnSetup").addEventListener("click", () => {
      /* 契约 §2/§5：「回到绑定姿态」= 预览 Setup Pose，不清空动画 Key、不改 mode */
      setPreviewSetup(!state.edit.previewSetup);
    });
    el0("btnStop").addEventListener("click", () => {
      state.playing = false;
      const r = previewRangeOf(state.anim);
      state.t = r.custom ? r.from : 0;
      syncPlayButton();
      updateTimeLabel();
      render();
      dsSyncPlayhead();
    });
    el0("loopChk").addEventListener("change", (e) => (state.loop = e.target.checked));
    el0("speedSel").addEventListener("change", (e) => (state.speed = parseFloat(e.target.value)));
    el0("scrub").addEventListener("input", (e) => {
      if (!state.animDur) return;
      setPlayhead((state.animDur * Number(e.target.value)) / 1000);
    });
    cv.addEventListener("pointerdown", onPointerDown);
    cv.addEventListener("pointermove", onPointerMove);
    cv.addEventListener("pointerup", onPointerUp);
    cv.addEventListener("pointercancel", onPointerUp);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    const stage = el0("stage");
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
    el0("texAlpha").value = state.texAlpha;
    el0("texAlphaV").textContent = Math.round(state.texAlpha) + "%";
  }
  /* ---- 表情分页 / 动画分页的控件绑定（分页非模态，键盘不拦截） ---- */
  function bindExprPanel() {
    const reset = el0("exprReset");
    if (reset) reset.addEventListener("click", () => exprResetToSetup());
    /* 0.9.26：事件表情保存（只写 events.json 的目标事件 expression） */
    const saveBtn = el0("exprSave");
    if (saveBtn) saveBtn.addEventListener("click", () => saveExprToEvent());
  }

  function bindAnimPanel() {
    const sel = el0("animEditSel");
    if (sel) sel.addEventListener("change", (e) => setAnimEditSelection(e.target.value));
    const durInput = el0("animDurInput");
    if (durInput) {
      /* 只在 change / 应用时长按钮上落盘，输入过程中不改动 key（避免边打字边缩放） */
      durInput.addEventListener("change", (e) => animSetDurationInput(e.target.value));
      durInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          animSetDurationInput(e.target.value);
        }
      });
    }
    const durApply = el0("animDurApply");
    if (durApply) {
      durApply.addEventListener("click", () => {
        const v = parseFloat(el0("animDurInput").value);
        if (!Number.isFinite(v) || v <= 0) return setStatus("时长必须是正数", "warn");
        const name = state.animEdit.sel;
        /* 未打键 transient 会被重定时后的 Key 覆盖，先走 guard（与切时刻同一套三分支） */
        if (transientActive()) return guardUnkeyed("整体重定时", () => confirmRetime(name, v));
        confirmRetime(name, v);
      });
    }
    const live = el0("animLiveChk");
    if (live) {
      live.checked = state.animEdit.live;
      live.addEventListener("change", (e) => {
        state.animEdit.live = e.target.checked;
        setStatus(state.animEdit.live ? "动画页：编辑立即更新预览" : "动画页：编辑只改草稿，点「应用时长」后生效");
      });
    }
    const resetOne = el0("animResetOne");
    if (resetOne) resetOne.addEventListener("click", () => animResetOne(state.animEdit.sel));
    const resetAll = el0("animResetAll");
    if (resetAll) resetAll.addEventListener("click", animResetAll);
    const saveBtn = el0("animSave");
    if (saveBtn) saveBtn.addEventListener("click", () => saveToDisk());
  }

  function syncExprInputs() {
    const pairs = [["exBlink", "exBlinkV", "0.00"], ["exMouth", "exMouthV", "0"], ["exBrow", "exBrowV", "0"]];
    for (const p of pairs) {
      const inp = el0(p[0]);
      const out = el0(p[1]);
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
    syncEditorVersion();
    /* 显式 ?voice= 锁必须在任何模型 / 语音异步之前落定（契约 §2.1，Lead 裁决 3） */
    const params = new URLSearchParams(location.search);
    const voiceParam = params.get("voice");
    if (voiceParam != null && String(voiceParam).trim()) state.voice.explicitRequest = String(voiceParam).trim();
    /* P1（T21）：偏好先读（快捷键/布局），模型载入后再按签名恢复行配置 */
    if (typeof loadPrefs === "function") loadPrefs();
    /* 工具条展开态（独立键；localStorage 不可用时静默收起，不影响其它偏好） */
    state.railExpanded = railExpandedPref();
    syncRailExpanded();
    /* P2-05：片段库（localStorage 版本化；损坏回退，不覆盖原内容） */
    if (typeof loadClipStore === "function") loadClipStore();
    bindUI();
    if (typeof renderClips === "function") renderClips();
    bindMenus();
    /* task-41：单一界面——只恢复与界面模式无关的偏好（旧配置的 ui.mode 读取时丢弃） */
    state.ui = Object.assign(prefsDefaults().ui, (state.prefs && state.prefs.ui) || {});
    delete state.ui.mode;
    setMoreOpen(!!state.ui.moreOpen);
    setClipOpen(!!state.ui.clipOpen);
    setExtraOpen(!!state.ui.extraOpen);
    syncChrome();
    syncChrome();
    if (el0("kbdUndo")) el0("kbdUndo").textContent = MOD_LABEL + "+Z";
    if (el0("helpModKey")) el0("helpModKey").textContent = MOD_LABEL;
    if (el0("helpModSave")) el0("helpModSave").textContent = MOD_LABEL;
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
      /* ---- 骨骼编辑（T6；只读快照 + 与 UI 同一动作函数，不替代 pointer 事件） ---- */
      proj: (wx, wy) => proj(wx, wy),
      unproj: (sx, sy) => unproj(sx, sy),
      /* U06 自由变换（只读诊断：会话状态 / 画布坐标下的包围框 / 命中测试；不写数据） */
      ftState: () => ({
        on: ft.on,
        bone: ft.bone,
        box: ft.box ? { x: ft.box.x, y: ft.box.y, w: ft.box.w, h: ft.box.h } : null,
        drag: state.drag && state.drag.freeTransform
          ? { mode: state.drag.mode, uniform: state.drag.uniform, part: state.drag.part, moved: state.drag.moved }
          : null,
        /* 0.9.49：属性面板的「自由变换」按钮已从界面移除，按钮状态无从读起。
           原来这里返回 null（无按钮），但 null 与「按钮存在且未按下(false)」不可区分，
           会让 E2E 以为按钮还在。改为显式报告「入口没了、状态只能是会话的 on」。 */
        buttonRemoved: true,
        buttonPressed: null,
        entryPoints: ["Shift+T", "__characterEditor.ftToggle()"],
      }),
      ftBox: (boneName) => ftBoxOf(boneName),
      ftHitAt: (x, y) => {
        const hit = ftHit({ x: x, y: y });
        return hit ? { kind: hit.kind, handle: hit.handle } : null;
      },
      /* 0.9.49：属性面板「自由变换」按钮删除后，agent 侧必须能进 / 提交 / 取消这个会话。
         与 UI 走的是同一批函数（ftToggle / ftEnter / ftCommit / ftCancel），不是复制一份逻辑。 */
      ftToggle: () => {
        const wasOn = ft.on;
        const res = ftToggle();
        /* wasOn=false → 本次是「进入」；wasOn=true → 本次是「提交」。
           res 在提交时表示「有没有真实改动」，不能拿来判成没进去。 */
        return { ok: !!(wasOn ? true : res === true), on: ft.on, bone: ft.bone, action: wasOn ? "commit" : "enter", changed: !!res };
      },
      ftEnter: () => {
        const ok2 = ftEnter();
        return { ok: !!ok2, on: ft.on, bone: ft.bone, reason: ok2 ? null : "ENTER_REFUSED（未载入 / 未选骨 / 该骨不可编辑 / 播放中）" };
      },
      ftCommit: () => {
        if (!ft.on) return { ok: false, reason: "FT_NOT_ACTIVE", on: false, undo: state.undo.length };
        const changed = ftCommit();
        return { ok: true, changed: !!changed, on: ft.on, undo: state.undo.length, dirty: !!state.dirty };
      },
      ftCancel: (msg) => {
        if (!ft.on) return { ok: false, reason: "FT_NOT_ACTIVE", on: false, undo: state.undo.length };
        ftCancel(msg || "已取消自由变换（接口调用）。");
        return { ok: true, on: ft.on, undo: state.undo.length, dirty: !!state.dirty };
      },
      edit: () => ({
        mode: editMode(),
        target: editTarget(),
        tool: editTool(),
        space: editSpace(),
        autoKey: !!state.edit.autoKey,
        selBone: state.edit.selBone,
        selAttachment: state.edit.selAttachment,
        transient: state.edit.transient
          ? { animation: state.edit.transient.animation, time: state.edit.transient.time, bones: Object.keys(state.edit.transient.bones || {}) }
          : null,
        timelineOpen: !!state.edit.timeline.expanded,
        timelineHeight: state.edit.timeline.height,
        undoDepth: state.undo.length,
        redoDepth: state.redo.length,
        dirty: !!state.dirty,
      }),
      selectBone: (indexOrName) => {
        if (typeof indexOrName === "number") {
          const b = state.model && state.model.bones[indexOrName];
          return selectBone(b ? b.name : null), state.edit.selBone;
        }
        selectBone(indexOrName == null ? null : String(indexOrName));
        return state.edit.selBone;
      },
      setMode: (m) => setEditMode(m),
      setTool: (t) => setEditTool(t),
      setTarget: (t) => setEditTarget(t),
      setSpace: (s) => setEditSpace(s),
      setAutoKey: (v) => setAutoKey(v),
      keySelected: (fields) => keySelectedBone(fields),
      /* 0.9.49：属性面板的位置 X/Y、旋转、缩放 4 个输入框已从界面移除。
         agent 侧用这个入口写同一个通道（applyBoneNumber）：它自带 World/Local 换算、
         缩放下限夹取、Setup 写基础值 / Animate 写未打键预览、每次一条撤销。
         field 只接受 x / y / rotation / scaleX / scaleY（与骨骼检查器的输入框一致）。 */
      /* 0.9.50：右栏「调试」面板整块从界面移除后，它显示的骨骼/IK、网格、权重与未求值明细
         仍需可读。这里给的是**同一批数据源**的结构化快照（面板原先是在 syncDebug() 里
         现场拼字符串，没有可直接复用的 state 字段）。只读，不写模型。 */
      diagnostics: () => {
        const loaded = !!state.model;
        const frame = state.frame;
        const ikStates = ikState();
        const restricted = Array.from(ikStates.values()).filter((x) => x.restricted);
        const meshes = [];
        if (loaded && frame) {
          for (const item of frame.geo) {
            const att = attachmentAt(frame.pose, item.slotIndex);
            if (att && att.type !== "region") meshes.push({ slotIndex: item.slotIndex, attachmentId: item.attachmentId, vertexCount: att.vertexCount, triangles: att.triangles ? att.triangles.length / 3 : 0, weighted: !!att.weighted, hullCount: att.hullCount });
          }
        }
        const issues = (state.issueDetails || []).map((i) => ({
          severity: i.severity || "warning",
          code: i.code || "",
          path: i.path || "",
          message: i.message || "",
        }));
        return {
          loaded: loaded,
          bones: { total: loaded ? state.boneList.length : 0, ikConstraints: loaded ? state.constraints.length : 0,
            ikNames: loaded ? state.constraints.map((c) => c.name) : [],
            ikTargets: loaded ? Array.from(new Set(state.constraints.map((c) => c.target))).length : 0,
            restricted: restricted.map((x) => ({ constraint: x.constraint && x.constraint.name, reason: x.reason })) },
          meshes: meshes,
          unsupportedCount: state.unsupportedCount || 0,
          issues: issues,
        };
      },
      /* 0.9.50：右栏「调试」面板整块从界面移除后，它显示的骨骼/IK、网格、权重与未求值明细
         仍需可读。这里给的是**同一批数据源**的结构化快照（面板原先是在 syncDebug() 里
         现场拼字符串，没有可直接复用的 state 字段）。只读，不写模型。 */
      diagnostics: () => {
        const loaded = !!state.model;
        const frame = state.frame;
        const ikStates = ikState();
        const restricted = Array.from(ikStates.values()).filter((x) => x.restricted);
        const meshes = [];
        if (loaded && frame) {
          for (const item of frame.geo) {
            const att = attachmentAt(frame.pose, item.slotIndex);
            if (att && att.type !== "region") meshes.push({ slotIndex: item.slotIndex, attachmentId: item.attachmentId, vertexCount: att.vertexCount, triangles: att.triangles ? att.triangles.length / 3 : 0, weighted: !!att.weighted, hullCount: att.hullCount });
          }
        }
        const issues = (state.issueDetails || []).map((i) => ({
          severity: i.severity || "warning",
          code: i.code || "",
          path: i.path || "",
          message: i.message || "",
        }));
        return {
          loaded: loaded,
          bones: { total: loaded ? state.boneList.length : 0, ikConstraints: loaded ? state.constraints.length : 0,
            ikNames: loaded ? state.constraints.map((c) => c.name) : [],
            ikTargets: loaded ? Array.from(new Set(state.constraints.map((c) => c.target))).length : 0,
            restricted: restricted.map((x) => ({ constraint: x.constraint && x.constraint.name, reason: x.reason })) },
          meshes: meshes,
          unsupportedCount: state.unsupportedCount || 0,
          issues: issues,
        };
      },
      setBoneField: (field, value) => {
        const FIELD_OK = { x: 1, y: 1, rotation: 1, scaleX: 1, scaleY: 1 };
        if (!FIELD_OK[field]) return { ok: false, reason: "FIELD_INVALID", field: field };
        if (!state.edit.selBone) return { ok: false, reason: "NO_BONE_SELECTED" };
        const okSet = applyBoneNumber(field, value);
        return { ok: !!okSet, field: field, value: Number(value), bone: state.edit.selBone, undo: state.undo.length };
      },
      /* 只读回显：当前选中骨在该字段上的值（World 坐标系下会按父矩阵换算，与输入框同源） */
      boneField: (field) => {
        const name = state.edit.selBone;
        if (!name) return null;
        const local = localOfBone(name);
        if (!local) return null;
        if (field === "x") return local.x;
        if (field === "y") return local.y;
        if (field === "rotation") return local.rotation;
        if (field === "scaleX") return local.scaleX == null ? 1 : local.scaleX;
        if (field === "scaleY") return local.scaleY == null ? 1 : local.scaleY;
        return null;
      },
      spaceGate: (name, tool) => spaceGate(name || state.edit.selBone, tool),
      /* 0.9.50：右栏检查器整块删除后，槽位选择必须另有入口 —— selectBone(indexOrName) 只能选骨，
         槽（slot）是另一条线。selectSlot(i) 与列表点击、画布拾取走的是同一个函数。 */
      selectSlot: (indexOrName) => {
        if (indexOrName == null) { selectSlot(-1); return -1; }
        let idx = -1;
        if (typeof indexOrName === "number") idx = indexOrName;
        else if (typeof indexOrName === "string") idx = state.slots.findIndex((x) => x.name === indexOrName);
        if (!(idx >= 0 && idx < state.slots.length)) return { ok: false, reason: "SLOT_NOT_FOUND", index: idx };
        selectSlot(idx);
        return { ok: true, index: idx, name: state.slots[idx].name, bone: state.slots[idx].boneName };
      },
      /* 只读：当前选中的槽（列表点击 / 画布拾取 / selectSlot 三者同源） */
      slotSelection: () => {
        const slot = state.sel >= 0 ? state.slots[state.sel] : null;
        return slot
          ? { index: state.sel, name: slot.name, bone: slot.boneName, attachment: slot.attachment || null,
              hidden: state.hidden.has(slot.name), locked: state.locked.has(slot.name) }
          : null;
      },
      /* 显示 / 隐藏 / 锁定：检查器按钮删除后保留的三个开关 */
      slotVisible: (indexOrName) => {
        const idx = slotIndexOf(indexOrName);
        if (idx < 0) return { ok: false, reason: "SLOT_NOT_FOUND" };
        toggleHidden(idx);
        const name = state.slots[idx].name;
        return { ok: true, index: idx, name: name, hidden: state.hidden.has(name) };
      },
      slotLock: (indexOrName) => {
        const idx = slotIndexOf(indexOrName);
        if (idx < 0) return { ok: false, reason: "SLOT_NOT_FOUND" };
        toggleLocked(idx);
        const name = state.slots[idx].name;
        return { ok: true, index: idx, name: name, locked: state.locked.has(name) };
      },
      /* 层操作：原本只有 [ ] 两个快捷键能到「上移/下移」，「置顶/置底」完全没有入口 */
      layerMove: (action) => {
        const A = { up: 1, down: 1, top: 1, bottom: 1 };
        if (!A[action]) return { ok: false, reason: "ACTION_INVALID", action: action };
        if (state.sel < 0) return { ok: false, reason: "NO_SLOT_SELECTED" };
        if (drawOrderLocked()) return { ok: false, reason: "DRAW_ORDER_LOCKED" };
        const from = state.sel;
        moveLayer(action);
        return { ok: state.sel !== from, action: action, from: from, to: state.sel, name: state.sel >= 0 ? state.slots[state.sel].name : null, undo: state.undo.length, dirty: !!state.dirty };
      },
      /* 恢复该部件 / 恢复附件：检查器里的两个「撤销到原始值」按钮 */
      slotRestore: (indexOrName) => {
        const idx = indexOrName == null ? state.sel : slotIndexOf(indexOrName);
        if (idx < 0) return { ok: false, reason: "NO_SLOT_SELECTED" };
        restoreSlot(idx);
        return { ok: true, index: idx, name: state.slots[idx].name, undo: state.undo.length, dirty: !!state.dirty };
      },
      attachmentRestore: () => {
        const identity = currentAttachmentIdentity();
        if (!identity) return { ok: false, reason: "NO_ATTACHMENT" };
        const i = attachmentPatchIndexOf(identity);
        if (i < 0) return { ok: false, reason: "NO_PATCH", attachment: identity.attachmentName };
        const before = snapshot();
        state.edit.attachmentPatches.splice(i, 1);
        commit(before);
        syncInspector();
        render();
        setStatus("已恢复附件 " + identity.attachmentName + " 的原始变换");
        return { ok: true, attachment: identity.attachmentName, undo: state.undo.length };
      },
      /* 0.9.50：槽位字段写入的接口出口。直连 applySlotNumber / applySlotField，
         **绝不**因为 editTarget 是 bone 就拐去写骨骼（那是名字叫 slotField 却写骨的语义错误）。 */
      slotField: (field, value) => {
        const SLOT_OK = { x: 1, y: 1, rotation: 1, scaleX: 1, scaleY: 1 };
        if (!SLOT_OK[field]) return { ok: false, reason: "FIELD_INVALID", field: field };
        /* 直连槽位通道：**绝不**因为 editTarget 是 bone 就拐去写骨骼 */
        const res = field === "x" || field === "y" ? applySlotNumber(field, value) : applySlotField(field, value);
        return Object.assign({}, res, {
          field: field,
          value: Number(value),
          slotIndex: state.sel,
          name: state.slots[state.sel] ? state.slots[state.sel].name : null,
          undo: state.undo.length,
          dirty: !!state.dirty,
        });
      },
      pose: () => {
        const f = state.frame;
        if (!f || !f.pose) return null;
        const pick = (m) => (m || []).map((v) => (v ? { x: v.x, y: v.y, rotation: v.rotation, scaleX: v.scaleX, scaleY: v.scaleY, a: v.a, b: v.b, c: v.c, d: v.d, tx: v.tx, ty: v.ty } : null));
        return { time: state.t, anim: state.anim, local: pick(f.pose.local), world: pick(f.pose.world) };
      },
      boneValues: (name) => {
        const b = boneEntry(name);
        return b ? { x: b.x, y: b.y, rotation: b.rotation, scaleX: b.scaleX, scaleY: b.scaleY } : null;
      },
      boneScreen: (name) => boneScreenInfo(name),
      gizmo: () => currentGizmo(),
      boneHidden: (name) => {
        const hit = pickBoneAt({ x: -9999, y: -9999 });
        return hit;
      },
      undo: () => undo(),
      redo: () => redo(),
      /* T7：时间轴只读快照（行/key 时间/播放范围），供 E2E 断言用 */
      timeline: () => {
        const lib = timelineLib();
        const built = dsBuild();
        const r = previewRangeOf(state.anim);
        return {
          open: !!state.edit.timeline.expanded,
          height: state.edit.timeline.height,
          pxPerSec: state.edit.timeline.pxPerSec,
          scrollSec: state.edit.timeline.scrollSec,
          snapFrames: !!state.edit.timeline.snapFrames,
          selectedKey: state.edit.timeline.selectedKey,
          keyCount: built.keyCount,
          maxTime: built.maxTime,
          unsupported: built.unsupported,
          rows: (built.rows || []).map((row) => ({
            rowKey: lib ? lib.rowKey(row) : null,
            kind: row.kind,
            owner: row.owner,
            field: row.field,
            label: row.label,
            keyCount: row.keyCount,
            keyTimes: (row.keys || []).map((k) => k.time),
            unsupported: !!row.unsupported,
          })),
          playRange: { from: r.from, to: r.to, custom: r.custom },
          /* 规划书 P0：帧视图状态也进快照（三种模式的共用时间状态一眼可读） */
          tab: state.edit.timeline.tab || "dopesheet",
          fps: tlFps(),
          currentFrame: fsCurrentFrame(),
          frameSel: (state.edit.timeline.frameSel || []).slice(),
          frameRange: state.edit.timeline.frameRange || null,
        };
      },
      /* ==========================================================================
       * 规划书 P0 帧视图句柄（与 UI 走同一批命令，不复制逻辑）
       *   frameTimeline.state/geom/select/seek/snap/setFps/menu/run
       *   timeFrame(op)：§3.5 的**时间帧操作**（整段动画），与关键帧操作分离
       * ====================================================================== */
      frameTimeline: {
        state: () => fsState(),
        geom: (opts2) => fsGeom(opts2),
        /* 帧选择：op = set/add/toggle/range/all/clear/invert/remove（与纯模块同口径）
           两种调用形式都接受：select("range", {anchor,frame}) 与 select({op:"range",anchor,frame})。
           早期只支持后一种，传字符串时 op 会被当成帧号，报 FRAME_SELECT_INVALID —— 这里做归一化。 */
        select: (op, opts2) => {
          const libF = frameTimelineLib();
          if (!libF) return { ok: false, reason: "FRAME_LIB_MISSING" };
          const a = typeof op === "string"
            ? Object.assign({}, isRecord(opts2) ? opts2 : {}, { op: op })
            : isRecord(op) ? op : { op: "set", frame: opts2 };
          const res = libF.selectFrames(fsState(), a);
          if (!res.ok) return { ok: false, code: res.issues[0] && res.issues[0].code, reason: res.issues[0] && res.issues[0].message };
          state.edit.timeline.frameSel = res.selectedFrames.slice();
          state.edit.timeline.frameRange = res.selectedFrameRange;
          if (Number.isFinite(a.frame)) state.edit.timeline.frameAnchor = libF.snapFrame(a.frame);
          fsSyncSelectionToKeys();
          dsSyncBars();
          dsDraw();
          return { ok: true, selectedFrames: res.selectedFrames.slice(), selectedFrameRange: res.selectedFrameRange };
        },
        seek: (action, opts2) => {
          const before = fsCurrentFrame();
          fsSeekFrame(action, opts2);
          return { ok: true, from: before, to: fsCurrentFrame(), time: state.t };
        },
        /* 帧吸附：把当前时间吸到整数帧（不动关键帧秒数） */
        snap: () => {
          const libF = frameTimelineLib();
          if (!libF) return { ok: false, reason: "FRAME_LIB_MISSING" };
          const t = libF.snapTime(state.t || 0, tlFps());
          setPlayhead(t);
          fsSyncBar();
          dsDraw();
          return { ok: true, time: t, frame: libF.frameAtTime(t, tlFps()) };
        },
        /* §7.4：改 FPS 只改显示帧编号，不改关键帧实际秒数 */
        setFps: (v) => {
          const libF = frameTimelineLib();
          if (!libF) return { ok: false, reason: "FRAME_LIB_MISSING" };
          state.edit.timeline.fps = libF.normFps(v);
          fsSyncBar();
          dsSyncBars();
          dsDraw();
          return { ok: true, fps: state.edit.timeline.fps, exactSecondsUnchanged: true };
        },
        /* 帧上下文菜单（§3.4）：只返回该帧该出哪一套，不弹 UI */
        menu: (opts2) => {
          const libF = frameTimelineLib();
          if (!libF) return { ok: false, reason: "FRAME_LIB_MISSING" };
          const o = isRecord(opts2) ? opts2 : {};
          const frame = Number.isFinite(o.frame) ? libF.snapFrame(o.frame) : fsCurrentFrame();
          const rows = dsBuild().rows || [];
          const hasKey = libF.keysInFrameRange(rows, frame, 1, tlFps()).count > 0;
          const st = fsState();
          const hasRange = !!(st.selectedFrameRange && st.selectedFrames.length > 1);
          const m = libF.contextMenu({ frame: frame, hasKey: hasKey, range: hasRange ? st.selectedFrameRange : null });
          return { ok: true, frame: frame, kind: m.kind, items: m.items, labels: m.labels, hasKey: hasKey, range: hasRange ? st.selectedFrameRange : null };
        },
        /* 执行一个菜单动作（与右键菜单同一个 fsMenuRun） */
        run: (id, frame) => {
          fsMenuRun(String(id), Number.isFinite(frame) ? frame : fsCurrentFrame());
          return { ok: true, id: id };
        },
        /* §3.5 时间帧操作：insert / remove / move / scale / clear / reverse / spread */
        timeFrame: (op, opts2) => {
          const applied = animTimeFrameOp(String(op), opts2 || {});
          return { ok: true, applied: applied, tab: state.edit.timeline.tab, keyCount: dsBuild().keyCount };
        },
        /* §14 P4 前后帧姿态对照：量化当前帧与目标帧的差异（只读求值，不写文档） */
        comparePose: (targetFrame) => {
          const d = comparePoseWithFrame(Number.isFinite(targetFrame) ? targetFrame : fsCurrentFrame() + 1);
          return d ? { ok: true, diff: d } : { ok: false, reason: document.getElementById("statusMsg").textContent };
        },
        lastPoseDiff: () => state.edit.poseDiff || null,
        /* §5.3 全身姿态关键帧：直接执行（跳过确认框，供自动化；UI 走 keyFullPoseInteractive） */
        fullPose: (scope, atTime) => {
          const before = dsBuild().keyCount;
          const r = keyFullPose({ scope: scope || "visible", atTime: Number.isFinite(atTime) ? atTime : state.t });
          return Object.assign({ keysBefore: before, keysAfter: dsBuild().keyCount }, r);
        },
        /* §5.3 交互入口：会先弹范围确认，返回 Promise */
        fullPoseInteractive: () => keyFullPoseInteractive(),
        /* §3.4 复制帧范围：只复制范围内 Key 进剪贴板 */
        copyRange: () => {
          const before = state.clipboard ? (state.clipboard.items || []).length : 0;
          fsCopyFrameRange();
          const after = state.clipboard ? (state.clipboard.items || []).length : 0;
          return { ok: after > 0, clipboardItems: after, previousItems: before };
        },
        /* §6.1 粘贴姿态：读当前求值姿态并写到目标时间（区别于粘贴关键帧） */
        pastePose: (atTime, boneNames) => {
          const before = dsBuild().keyCount;
          const okRes = fsPastePoseAt(atTime, boneNames);
          return { ok: !!okRes, keysBefore: before, keysAfter: dsBuild().keyCount, bones: boneNames || (state.edit.selBone ? [state.edit.selBone] : []) };
        },
        /* §6 Duplicate Key（Ctrl+D）：复制到下一帧，不动用户剪贴板 */
        duplicate: () => {
          const before = dsBuild().keyCount;
          const clipBefore = state.clipboard ? JSON.stringify(state.clipboard).length : 0;
          const res = fsDuplicateKey();
          const clipAfter = state.clipboard ? JSON.stringify(state.clipboard).length : 0;
          return { ok: !!res, keysBefore: before, keysAfter: dsBuild().keyCount, clipboardUntouched: clipBefore === clipAfter };
        },
      },
      setPlayhead: (sec) => setPlayhead(sec),
      setPreviewRange: (from, to) => setPreviewRange(from, to),
      clearPreviewRange: () => clearPreviewRange(),
      timelineOpen: (open) => dsOpen(open),
      /* P1（T20）调试句柄：Graph / 轨道管理 / Local 坐标系 */
      setSpace: (space) => setEditSpace(space),
      spaceName: () => editSpace(),
      graph: () => graphDebug(),
      graphState: () => graphDebug(),
      graphTab: (tab) => graphSetTab(tab),
      graphComponent: (vi) => graphSetComponent(vi),
      graphSelectRow: (rowKey) => {
        graphSelectRow(rowKey);
        return graphDebug();
      },
      graphSetSegment: (type) => {
        graphSetSegment(type);
        return graphDebug();
      },
      trackFilter: (opts) => {
        const tl = state.edit.timeline;
        const o = opts || {};
        if (typeof o.search === "string") tl.search = o.search;
        if (typeof o.onlyKeyed === "boolean") tl.onlyKeyed = o.onlyKeyed;
        dsSyncBars();
        dsDraw();
        const v = dsView();
        return {
          visibleRows: v.rows.length,
          totalRows: (v.view && v.view.total) || (v.built.rows || []).length,
          emptyAdded: v.built.emptyAdded || 0,
          search: tl.search,
          onlyKeyed: !!tl.onlyKeyed,
          locked: tlLockedSet().slice(),
          hidden: tlHiddenSet().slice(),
        };
      },
      trackLock: (rowKey, on) => {
        const list = tlLockedSet();
        const has = list.indexOf(rowKey) >= 0;
        if (on === true && !has) list.push(rowKey);
        if (on === false && has) list.splice(list.indexOf(rowKey), 1);
        dsDraw();
        return list.slice();
      },
      trackHide: (rowKey, on) => {
        const list = tlHiddenSet();
        const has = list.indexOf(rowKey) >= 0;
        if (on === true && !has) list.push(rowKey);
        if (on === false && has) list.splice(list.indexOf(rowKey), 1);
        dsDraw();
        return list.slice();
      },
      trackWriteGate: (rowKey, op) => trackWriteGate([rowKey], op),
      /* P2-01/02（task-27）：额外轨道调试句柄（与 UI 同一批动作函数；写入仍只走 SpineTrackEdit） */
      tracks: () => trackSnapshot(),
      trackRows: () => trackSnapshot().rows,
      /* task-36：简单模式 agent 接口（与 UI 同一命令/事务/保存链路；不依赖 DOM，不暗中切模式） */
      simple: simpleApi(),
      /* §14 P4 帧缩略图：开关 / 尺寸 / 状态（纯显示，不写模型） */
      setFrameThumbs: (on, opts) => setFrameThumbs(on, opts),
      frameThumbs: () => frameThumbsState(),
      invalidateFrameThumbs: () => { invalidateFrameThumbs(); return { cleared: true }; },
      /* Flash 式三键（F5/F6/F7）：供 agent 与测试直接调用，与快捷键走同一条链路 */
      flashHoldFrame: (targetFrame) => flashHoldFrame(targetFrame),
      flashKeyFrame: () => flashKeyFrame(),
      flashBlankFrame: (opts) => flashBlankFrame(opts),
      /* F7 的意图探测（不写数据）：UI 用它决定直接执行还是弹二选一 */
      flashBlankIntent: () => flashBlankIntent(),
      /* §3.3 帧选择工具 + §6.1 帧段复制 */
      frameTool: (tool) => (tool === undefined ? { tool: fsFrameTool() } : fsSetFrameTool(tool)),
      copyFrameRange: () => fsCopyRangeToClipboard(),
      duplicateFrameRange: (delta) => fsDuplicateRange(delta),
      /* 音频 → 口型动画（动态映射）：预览关键帧 / 生成动画 */
      lipSyncPreview: (opts) => lipSyncFromCurrentLine(opts),
      lipSyncGenerate: (opts) => lipSyncGenerate(opts),
      lipSyncMerge: (base, lip, opts) => lipSyncMerge(base, lip, opts),
      lipsyncLoad: (opts) => lipsyncLoad(opts),
      lipsyncData: () => lipsyncData(),
      lipsyncValidate: (d) => lipsyncValidate(d),
      lipsyncLevelAt: (line, t, la) => lipsyncLevelAt(line, t, la),
      lipsyncKeysFromRuns: (line, fps) => lipsyncKeysFromRuns(line, fps),
      lipsyncLineById: (id) => lipsyncLineById(id),
      eventOfLine: (id) => eventOfLine(id),
      eventExpressionOf: (id) => eventExpressionOf(id),
      lipKeysForLine: (line, opts) => lipKeysForLine(line, opts),
      lipSyncMergeFromEvent: (parts, lip) => lipSyncMergeFromEvent(parts, lip),
      lipsyncPath: () => lipsyncPath(),
      lipsyncUrlCandidates: (rel) => lipsyncUrlCandidates(rel),
      lipPreviewStatic: (opts) => lipPreviewStatic(opts),
      lipTestRun: (opts) => lipTestRun(opts),
      lipTestStop: (opts) => lipTestStop(opts),
      /* 诊断：F5/F6/F7 的帧匹配到底看到了什么（排查「有 Key 却说没有」用） */
      flashDebug: () => {
        const fps = tlFps();
        const frame = fsCurrentFrame();
        const name = state.edit.selBone;
        const built = dsBuild();
        const rowsHere = [];
        for (const row of built.rows || []) {
          if (row.kind === "group" || row.owner !== name) continue;
          for (const t of flashKeyTimesOf(row)) {
            if (flashTimeOnFrame(t, frame, fps)) { rowsHere.push({ owner: row.owner, field: row.field, time: t }); break; }
          }
        }
        const target = (built.rows || []).find((r) => r.owner === name && r.field === "rotate");
        return {
          fps: fps, frame: frame, selBone: name, stateT: state.t,
          fieldsAtFrame: flashFieldsAtFrame(name, frame),
          rowsHere: rowsHere,
          builtRowsForBone: (built.rows || []).filter((r) => r.owner === name).map((r) => ({ field: r.field, kind: r.kind, n: (r.keyTimes || []).length, first3: (r.keyTimes || []).slice(0, 3) })),
          sampleRow: target ? { owner: target.owner, field: target.field, n: (target.keyTimes || []).length } : null,
          builtOk: built.ok !== false,
        };
      },
      /* §14 P4 音频波形：开关 / 状态 / 主动解码（纯显示，不写模型） */
      setAudioWave: (on, opts) => setAudioWave(on, opts),
      audioWave: () => audioWaveState(),
      decodeAudioWave: (buckets) => audioWaveDecode(buckets),
      simpleUi: () => ({
        uiMode: "single", /* task-41：不再有界面模式，保留字段供旧 agent 兼容 */
        onboardingSeen: !!(state.ui && state.ui.onboardingSeen),
        advancedSeen: !!(state.ui && state.ui.advancedSeen),
        simpleKeysExpanded: !!(state.ui && state.ui.simpleKeysExpanded),
        lastPackIndexPath: (state.ui && state.ui.lastPackIndexPath) || null,
        visible: {
          simpleTop: !!(document.body.classList.contains("mode-simple") && el0("simpleTop") && el0("simpleTop").offsetParent !== null),
          menubar: !!(el0("btnMenuFile") && el0("btnMenuFile").offsetParent !== null),
          /* 0.9.16：顶部「适配/缩放」组已移除；viewbar 用第 2 排容器本身判定。
             注意 `$` 只是 getElementById 的别名，不能传选择器，这里用 querySelector。 */
          viewbar: !!(function () { const b = document.querySelector(".bar-view"); return b && b.offsetParent !== null; })(),
          edittools: !!(el0("btnToolMove") && el0("btnToolMove").offsetParent !== null),
          dopesheet: !!(el0("dopesheet") && el0("dopesheet").offsetParent !== null),
          /* 0.9.49：片段库整块已从界面移除，#clipSection 不存在。
             这里不能再看 offsetParent —— 那会恒返回 false，但「false」表示「有这块但没显示」，
             与「这块已经不存在了」是两件事，会把调用方误导成「折叠起来了、展开就能用」。
             改为报告「能力在、界面不在」，真实形状由 clips() 自己给出。 */
          clipSection: false,
          clipSectionRemoved: true,
          clipsCapability: !!(state.clips && state.clips.clips),
          debug: !!(el0("debug") && el0("debug").offsetParent !== null),
        },
      }),
      /* task-41：不再有界面模式；保留同名句柄返回单一界面标识，避免旧脚本报错 */
      setUiMode: () => "single",
      simpleHelp: (show) => {
        if (show) openHelp();
        else closeHelp();
        return !!show;
      },
      trackSelect: (rowKey) => {
        const extra = findExtraRow(rowKey);
        if (extra) {
          selectExtraRow(extra);
          return trackSnapshot();
        }
        /* 槽附件行（P2-01）：走与「单击 Key」相同的状态，面板由 selectedTrackRow 解析 */
        const lib = timelineLib();
        const built = dsBuild();
        for (const row of built.rows || []) {
          if (!lib || lib.rowKey(row) !== rowKey) continue;
          if (row.kind !== "slot" || row.field !== "attachment") continue;
          state.edit.timeline.selectedKey = { rowKey: rowKey, owner: row.owner, field: row.field, kind: row.kind, time: state.t };
          state.edit.timeline.extraRowKey = null;
          state.edit.timeline.extraForm = null;
          state.edit.timeline.graphRowKey = rowKey;
          renderExtraPanel();
          dsSyncBars();
          dsDraw();
          return trackSnapshot();
        }
        return null;
      },
      trackEdit: (opts) => {
        const o = opts || {};
        const row = findExtraRow(o.rowKey);
        if (!row) return { ok: false, code: "ROW_NOT_FOUND", rowKey: o.rowKey || null };
        const payload = { op: o.op, time: o.time, index: o.index, delta: o.delta, value: o.value };
        const res = trackWrite(row, payload, o.label || "调试写入");
        return Object.assign({ rowKey: o.rowKey, snapshot: trackSnapshot() }, res);
      },
      trackSetVertex: (opts) => {
        const o = opts || {};
        const row = findExtraRow(o.rowKey);
        if (!row) return { ok: false, code: "ROW_NOT_FOUND" };
        const res = deformSetVertex(row, { vertex: { index: o.index | 0, x: Number(o.x), y: Number(o.y) } });
        return Object.assign({ rowKey: o.rowKey, snapshot: trackSnapshot() }, res || { ok: false });
      },
      version: () => { const v = editorVersion(); return { version: v.version, schemaVersion: v.schemaVersion, apiVersion: v.apiVersion, builtAt: v.builtAt }; },
      newDeformCandidates: () => {
        const T = trackEditLib();
        if (!T || typeof T.deformTargets !== "function") return { official: [], hidden: [] };
        const attByPair = attachmentIndex();
        const all = T.deformTargets(state.model, animDraft(state.anim || state.animEdit.sel)) || [];
        const official = [];
        const hidden = [];
        for (const t of all) {
          const kind = deformTargetKind(t, attByPair);
          const item = {
            target: t.slotName + "/" + t.attachmentName,
            kind: kind,
            weighted: !!t.weighted,
            vertexCount: t.vertexCount,
            offsetLength: t.offsetLength,
            moduleOfficial: typeof t.official === "boolean" ? t.official : null,
            moduleKind: t.kind || null,
            label: deformTargetLabel(t, kind),
            official: deformTargetOfficial(t, attByPair),
          };
          if (item.official) official.push(item);
          else hidden.push(item);
        }
        return { official: official, hidden: hidden };
      },
      lastNewDeform: () => (state.edit.lastNewDeform ? JSON.parse(JSON.stringify(state.edit.lastNewDeform)) : null),
      newDeformKey: () => { const res = newDeformKey(); return { ok: !!(res && res.ok), code: res && res.issues && res.issues[0] ? res.issues[0].code : null, rows: trackSnapshot().rows.length }; },
      trackAddAtPlayhead: () => {
        const res = extraAddOrSetFromPanel();
        return Object.assign({ snapshot: trackSnapshot() }, res || {});
      },
      trackDeleteAtPlayhead: () => {
        const row = selectedExtraRow();
        if (!row) return { ok: false, code: "ROW_NOT_FOUND" };
        const res = trackDeleteAt(row, state.t);
        return Object.assign({ rowKey: state.edit.timeline.extraRowKey, snapshot: trackSnapshot() }, res || {});
      },
      trackPanel: () => extraPanelState(),
      dsPoint: (rowKey, time) => dsPoint(rowKey, time),
      /** 当前 dsView/布局读数（E2E 核对行序、组、折叠） */
      dsRows: () => dsView().rows.map((r) => ({
        kind: r.kind,
        owner: r.owner,
        field: r.field,
        groupId: r.groupId || null,
        collapseKey: r.collapseKey || null,
        open: r.open === undefined ? null : r.open,
        keyCount: r.keyCount,
        unsupported: !!r.unsupported,
        previewPartial: !!r.previewPartial,
        index: -1,
      })).map((r, i) => Object.assign(r, { index: i })),
      dsStat: () => ({ text: el0("dsKeyStat").textContent, title: el0("dsKeyStat").title, unsupported: document.getElementById("dsUnsupported").hidden ? 0 : document.getElementById("dsUnsupported").textContent }),
      /* P2-01：槽附件轨（当前附件名 / 候选名 / 写入） */
      slotAttachment: (slotName) => {
        const name = slotName || (state.sel >= 0 && state.slots[state.sel] ? state.slots[state.sel].name : null);
        if (!name) return null;
        return {
          slot: name,
          at: round(state.t, 6),
          current: slotAttachmentAt(name, state.t),
          candidates: slotAttachmentCandidates(name),
          keys: (function () {
            const d = animDraft(state.anim || state.animEdit.sel) || {};
            const bag = d.slots && d.slots[name];
            return bag && Array.isArray(bag.attachment) ? bag.attachment.map((k) => ({ time: k.time, name: k.name === undefined ? null : k.name })) : [];
          })(),
        };
      },
      slotAttachmentSet: (slotName, attName, time) => {
        const res = slotAttachmentWrite(slotName, attName === "" ? null : attName, time);
        return Object.assign({ snapshot: trackSnapshot() }, res || {});
      },
      slotRowLabels: () => dsView().rows.filter((r) => r.kind === "slot").map((r) => ({ owner: r.owner, field: r.field, keyCount: r.keyCount, current: slotAttachmentAt(r.owner, state.t) })),
      trackEventNow: () => currentEventsAt(state.t),
      trackGroups: () => dsView().rows.filter((r) => r.kind === "group" && r.extra).map((g) => ({ gid: g.groupId, label: g.label, open: g.open, keyCount: g.keyCount })),
      trackCollapse: (gid, open) => {
        const set = dsCollapsedSet();
        const key = "extra:" + gid;
        if (open === true) set.delete(key);
        else if (open === false) set.add(key);
        else tlToggleIn(Array.from(set), key) && null;
        dsDraw();
        return dsView().rows.filter((r) => r.kind === "group" && r.extra).map((g) => ({ gid: g.groupId, open: g.open }));
      },
      trackSearch: (q) => {
        state.edit.timeline.search = String(q == null ? "" : q);
        const inp = el0("dsSearch");
        if (inp) inp.value = state.edit.timeline.search;
        dsSyncBars();
        dsDraw();
        return dsView().rows.filter((r) => r.kind !== "group").length;
      },
      /* P2-05/P2-06（task-28）：镜像 / 片段库 / 两骨 IK / 骨架结构 */
      mirror: () => ({
        mode: editMode(),
        autoKey: !!state.edit.autoKey,
        limitation: MIRROR_LIMITATION,
        last: state.edit.lastMirror ? JSON.parse(JSON.stringify(state.edit.lastMirror)) : null,
        pending: state.edit.pendingMirror
          ? { animation: state.edit.pendingMirror.animation, changed: state.edit.pendingMirror.changed.slice(), changedBones: state.edit.pendingMirror.changedBones.slice() }
          : null,
        transient: transientActive(),
      }),
      mirrorRun: (scope) => {
        mirrorRun(scope === "anim" ? "anim" : "bone");
        return { last: state.edit.lastMirror ? JSON.parse(JSON.stringify(state.edit.lastMirror)) : null, pending: !!state.edit.pendingMirror, undo: state.undo.length, dirty: state.dirty, anchors: dsAnimationRaw && dsAnimationRaw() ? Object.keys(dsAnimationRaw().bones || {}) : [] };
      },
      mirrorPose: () => {
        mirrorSetupPose();
        return { last: state.edit.lastMirror ? JSON.parse(JSON.stringify(state.edit.lastMirror)) : null, undo: state.undo.length };
      },
      mirrorWrite: () => ({ ok: commitPendingMirror(), undo: state.undo.length, dirty: state.dirty }),
      mirrorCancel: () => ({ ok: cancelPendingMirror(), dirty: state.dirty }),
      clips: () => ({
        version: CLIPS_VERSION,
        error: state.clipsError || "",
        collision: state.clips ? state.clips.collision : "overwrite",
        signature: skeletonSig(),
        clips: state.clips ? state.clips.clips.map((c) => ({ id: c.id, name: c.name, keyCount: c.keyCount, sourceAnimation: c.sourceAnimation, signature: c.skeletonSignature || null })) : [],
        poses: state.clips ? state.clips.poses.map((p) => ({ id: p.id, name: p.name, bones: Array.isArray(p.bones) ? p.bones.length : 0, signature: p.skeletonSignature || null })) : [],
        persisted: (function () { try { return !!window.localStorage.getItem(CLIPS_KEY); } catch (e) { return false; } })(),
      }),
      clipSave: (name) => {
        const res = saveSelectionAsClip(name);
        return { saved: !!res && !!res.id, clips: state.clips ? state.clips.clips.length : 0 };
      },
      clipInsert: (id) => {
        const res = insertClip(id);
        return { ok: !!res && res.ok === true, pasted: res && res.pasted, skipped: res && res.skipped, undo: state.undo.length, dirty: state.dirty };
      },
      clipRename: (id, name) => ({ ok: renameClip(id, name) }),
      clipDelete: (id) => ({ ok: deleteClip(id) }),
      clipCollision: (mode) => {
        state.clips.collision = mode === "skip" ? "skip" : "overwrite";
        saveClipStore();
        return state.clips.collision;
      },
      poseSave: (name) => {
        const res = savePosePreset(name);
        return { saved: !!res && !!res.id, poses: state.clips ? state.clips.poses.length : 0 };
      },
      poseApply: (id, mirrored) => ({ ok: !!applyPosePreset(id, !!mirrored), undo: state.undo.length }),
      poseDelete: (id) => ({ ok: deletePosePreset(id) }),
      ik: () => ({
        on: !!state.edit.ik.on,
        mix: state.edit.ik.mix,
        tool: editTool(),
        chain: state.edit.ik.chain ? { parent: state.edit.ik.chain.parentName, child: state.edit.ik.chain.childName, target: state.edit.ik.chain.targetName, constraint: state.edit.ik.chain.constraintName, message: state.edit.ik.chain.message } : null,
        lastReason: state.edit.ik.lastReason || "",
        drag: state.drag && state.drag.mode === "bone-ik" ? { parent: state.drag.parentName, child: state.drag.childName, mix: state.drag.mix, reason: state.drag.lastReason, moved: !!state.drag.moved } : null,
      }),
      setIkMode: (on) => {
        setIkMode(on);
        return { on: state.edit.ik.on, tool: editTool() };
      },
      setIkMix: (v) => {
        setIkMix(v);
        return state.edit.ik.mix;
      },
      ikChain: (name) => ikChainOf(name || state.edit.selBone),
      skeleton: () => ({
        mode: editMode(),
        bones: state.boneList.length,
        rawBones: state.raw && Array.isArray(state.raw.bones) ? state.raw.bones.length : 0,
        slots: state.slots.length,
        selected: state.edit.selBone,
        refs: state.edit.selBone && ikAimLib() && state.raw ? ikAimLib().referencesTo(state.raw, state.edit.selBone) : [],
        validate: state.raw && ikAimLib() ? (function () { const v = ikAimLib().validateSkeleton(state.raw); return { ok: v.ok, issues: (v.issues || []).map((i) => ({ code: i.code, path: i.path, message: i.message })) }; })() : null,
        last: state.edit.skelLast ? JSON.parse(JSON.stringify(state.edit.skelLast)) : null,
        skelRev: state.skelRev || 0,
        undo: state.undo.length,
      }),
      skelCreate: (payload) => {
        const res = skelCreateBone(payload || {});
        return { ok: !!res && res.ok === true, code: res && res.issues && res.issues[0] ? res.issues[0].code : null, bones: state.boneList.length, undo: state.undo.length };
      },
      skelReparent: (boneName, newParent, keepWorld) => {
        const res = skelReparent(boneName, newParent, keepWorld);
        return {
          ok: !!res && res.ok === true,
          code: res && res.issues && res.issues[0] ? res.issues[0].code : null,
          keptWorld: !!(res && res.preservedWorld),
          undo: state.undo.length,
        };
      },
      skelRename: (boneName, to) => {
        const res = skelRenameBone(boneName, to);
        return { ok: !!res && res.ok === true, code: res && res.issues && res.issues[0] ? res.issues[0].code : null, undo: state.undo.length };
      },
      skelDelete: (boneName) => {
        const res = skelDeleteBone(boneName);
        return {
          ok: !!res && res.ok === true,
          code: res && res.issues && res.issues[0] ? res.issues[0].code : null,
          refs: (res && res.references) || [],
          undo: state.undo.length,
        };
      },
      skelValidate: () => {
        const v = skeletonValidateNow();
        return { ok: v.ok, issues: (v.issues || []).map((i) => ({ code: i.code, path: i.path, message: i.message })) };
      },
      boneSetupWorld: (name) => {
        const IK = ikAimLib();
        if (!IK || !state.raw) return null;
        return IK.setupWorldOf(state.raw, name, []);
      },
      inheritOf: (name) => inheritOfBone(name),
      realParentWorld: (name) => {
        const entry = boneEntry(name);
        return entry ? realParentWorldOf(entry) : null;
      },
      localFull: (name) => localOfBone(name),
      animDurationOf: (name) => animDuration(name || state.anim),
      /* P1（T21）：选择集 / 批量 / 剪贴板 / 快捷键 / 偏好 / Pose */
      selection: () => ({
        items: dsSelection().items.slice(),
        primary: dsSelection().primary,
        count: dsSelection().items.length,
      }),
      selectKeyItem: (item, additive) => {
        if (!item) return null;
        selectionToggle({ kind: item.kind, owner: item.owner, field: item.field, time: item.time }, additive === true);
        dsDraw();
        graphDraw();
        return dsSelection().items.slice();
      },
      selectAll: () => {
        dsSelectAll();
        return dsSelection().items.length;
      },
      clearSelection: () => {
        selectionSet([], null);
        dsDraw();
        return 0;
      },
      batchMove: (delta) => {
        dsBatchMove(delta);
        return { undo: state.undo.length, selection: dsSelection().items.length, drafts: Object.keys(state.animEdit.drafts) };
      },
      batchDelete: () => {
        dsBatchDelete();
        return { undo: state.undo.length, selection: dsSelection().items.length };
      },
      copyKeys: () => {
        dsCopySelection();
        return state.clipboard ? { items: state.clipboard.items.length, sourceAnimation: state.clipboard.sourceAnimation, originTime: state.clipboard.originTime } : null;
      },
      pasteKeys: (atTime) => {
        dsPasteClipboard(atTime === undefined ? state.t : atTime);
        return { undo: state.undo.length, selection: dsSelection().items.length };
      },
      clipboard: () => (state.clipboard ? { items: state.clipboard.items.length, source: state.clipboard.sourceAnimation, origin: state.clipboard.originTime } : null),
      prefs: () => ({
        prefs: state.prefs ? JSON.parse(JSON.stringify(state.prefs)) : null,
        error: state.prefsError || null,
        key: "dsh.character-editor.preferences",
        storage: (function () {
          try {
            return window.localStorage.getItem("dsh.character-editor.preferences");
          } catch (e) {
            return null;
          }
        })(),
      }),
      savePrefsNow: () => {
        savePrefs(true);
        return true;
      },
      shortcuts: () => {
        const km = keymapLib();
        const map = keyBindings();
        const res = km && typeof km.validateBindings === "function" ? km.validateBindings(map) : { ok: true };
        return { map: map, ok: !!(res && res.ok), conflicts: (res && res.conflicts) || [], issues: (res && res.issues) || [] };
      },
      rebindShortcut: (action, chord) => {
        const km = keymapLib();
        const map = JSON.parse(JSON.stringify(keyBindings() || {}));
        map[action] = chord ? [chord] : [];
        applyShortcutMap(map);
        return { action: action, chord: chord || null, ok: !!(km && km.validateBindings(map).ok) };
      },
      resetShortcuts: () => {
        resetShortcutsToDefaults();
        return true;
      },
      resolveKey: (eventLike) => {
        const km = keymapLib();
        if (!km) return null;
        return km.resolveAction(keyBindings(), eventLike, keyContextOf());
      },
      /* P2-03 轴心补偿（只读快照 + 与 UI 同一个动作函数） */
      pivot: () => ({
        on: !!state.edit.pivotCompensate,
        effective: pivotCompensateOn(),
        mode: editMode(),
        target: editTarget(),
        disabledReason:
          editMode() === "animate"
            ? "动画模式无法无损补偿（骨世界位置由 Key 决定）"
            : editTarget() !== "bone"
              ? "需要「骨骼」目标"
              : "",
        last: lastPivotState(),
      }),
      setPivotCompensate: (on) => setPivotCompensate(on),
      lastPivot: () => lastPivotState(),
      /** 纯计算（不写文档）：把「选中骨局部增量」的补偿结果算出来给 E2E 核对 */
      pivotPreview: (boneName, delta, mode) => {
        const lib = boneEditLib();
        const entry = boneEntry(boneName || state.edit.selBone);
        if (!lib || !entry || typeof lib.compensateMove !== "function") return null;
        return lib.compensateMove({
          bones: pivotBonesInput(),
          boneIndex: entry.index,
          delta: delta || { x: 0, y: 0 },
          mode: mode || "childrenAndAttachments",
          attachments: pivotAttachmentsOf(entry.index),
        });
      },
      /* P2-04 洋葱皮 / 轨迹（只读快照 + 与 UI 同一个动作函数） */
      onionState: () => onionState(),
      trailState: () => trailState(),
      setOnion: (patch) => setOnion(patch),
      setTrail: (on) => setTrail(on),
      /* 0.9.14：吸附 / 权重配色 从顶部工具条移除后，补上脚本入口（原本只有 UI 与视图菜单） */
      setSnap: (on) => setSnap(on),
      snap: () => !!state.snap,
      setWeightMode: (mode) => setWeightMode(mode),
      weightMode: () => state.weightMode,
      /** 世界快照（骨名 → 世界矩阵/原点），供补偿前后对比与零写入验证 */
      worldSnapshot: () =>
        (state.boneList || []).map((b) => {
          const w = state.frame && state.frame.pose ? state.frame.pose.world[b.index] : null;
          return w
            ? { name: b.name, index: b.index, tx: w.tx, ty: w.ty, a: w.a, b: w.b, c: w.c, d: w.d, x: b.x, y: b.y }
            : { name: b.name, index: b.index, tx: null, ty: null, x: b.x, y: b.y };
        }),
      attachmentSnapshot: () =>
        (state.edit.attachmentPatches || []).map((p) => ({
          slotName: p.slotName,
          attachmentName: p.attachmentName,
          fields: JSON.parse(JSON.stringify(p.fields || {})),
        })),
      modelSignature: () => modelSignature(),
      setTool: (tool) => setEditTool(tool),
      tool: () => editTool(),
      /* 0.9.52：拖拽模式开关。**注意这里的 setTool 指的是「编辑工具」**（translate/rotate/scale/pose，
         走 setEditTool），而工具栏的拖拽/选择是另一套 state.tool —— 两者名字撞了，
         所以拖拽相关单独给一组明确命名的句柄，不要用 setTool 来切拖拽。 */
      panMode: () => ({
        active: state.tool === "pan",
        /* **只有真在拖拽模式时才给 returnTo**。第一版写成 state.toolBeforePan || "move"，
           退出后 toolBeforePan 被清空 → 落到 "move"，但当前工具可能正是「选择」，
           读到的值和实际状态对不上。现在退出态明确返回 null。 */
        returnTo: state.tool === "pan" ? (state.toolBeforePan || "move") : null,
        currentTool: state.tool,
        canDragCanvas: state.tool === "pan",
        hint: state.tool === "pan"
          ? "拖拽中：画布左键拖动=移动视野，再次调用 togglePan() 或按 H 退出"
          : "不在拖拽模式：画布左键会命中部件",
      }),
      togglePan: () => {
        const was = state.tool === "pan";
        setTool("pan");
        return { active: state.tool === "pan", changed: was !== (state.tool === "pan"), tool: state.tool, returnTo: state.toolBeforePan || null };
      },
      /* 直接设置而非切换：force=true 可幂等地进/出 */
      setPan: (on) => {
        const want = on !== false;
        if (want === (state.tool === "pan")) return { active: state.tool === "pan", changed: false, tool: state.tool };
        setTool("pan");
        return { active: state.tool === "pan", changed: true, tool: state.tool };
      },
      poseTip: (name) => {
        const res = poseTipReadout(name || state.edit.selBone);
        return res ? { x: res.x, y: res.y, length: res.length, usedLengthSource: res.usedLengthSource, dirX: res.dirX, dirY: res.dirY, degenerate: res.degenerate } : null;
      },
      timelineHeight: (h) => dsSetHeight(h),
      previewSetup: (on) => setPreviewSetup(on == null ? !state.edit.previewSetup : on),
      selectKeyByTime: (owner, field, time) => {
        const lib = timelineLib();
        const built = dsBuild();
        for (const row of built.rows || []) {
          if (row.owner !== owner || row.field !== field) continue;
          const idx = lib.keyIndexAtTime(row.keys || [], time);
          if (idx < 0) continue;
          dsSelectKey({ row: row, rowKey: lib.rowKey(row), time: row.keys[idx].time, index: idx });
          return true;
        }
        return false;
      },
      deleteSelectedKey: () => dsDeleteSelected(),
      geomHash: () => {
        const f = state.frame;
        if (!f || !f.geo) return null;
        let h = 2166136261;
        for (const item of f.geo) {
          const xy = item.worldXY || [];
          for (let i = 0; i < xy.length; i++) {
            const n = Math.round(xy[i] * 1000) | 0;
            h ^= n;
            h = Math.imul(h, 16777619) >>> 0;
          }
        }
        return h >>> 0;
      },
      render: render,
      fitView: fitView,
      loadRig: loadRig,
      loadIndex: loadIndexByPath,
    loadDirFiles: loadDirFiles,
    clearLocalTree: clearLocalTree,
    isLocalMode: () => isLocalMode(),
      loadExample: loadExample,
      loadFixture: loadFixture,
      /* 本地项目（扫描 workspace/packs）：agent 侧也要能不开界面直接调 */
      refreshLocalPacks: refreshLocalPacks,
      localPacks: () => state.localPacks,
      onPickPack: onPickPack,
      saveToDisk: saveToDisk,
      saveAsZip: saveAsZip,
      probeCapabilities: probeCapabilities,
      bundle: () => state.bundle,
      saveReason: saveReason,
      archiveReason: archiveReason,
      patchedModel: patchedModel,
      /* 事件语音（契约 §2.5，只读调试入口，非公开 API） */
      voice: voiceSnapshot,
      /* 0.9.43：事件分页的「资源检查 / 试听 / 预览动画」UI 已删除，
         但能力必须保留 —— 这三项是 agent 的入口，与 UI 用同一个函数。 */
      voiceChecks: (eventId) => {
        const ev = voiceFindEvent(eventId);
        return ev ? voiceResourceChecks(ev) : null;
      },
      voiceAudition: (eventId) => auditionVoiceEvent(voiceFindEvent(eventId)),
      voicePreviewLine: (lineId) => {
        const line = voiceFindLine(lineId);
        if (!line) return false;
        const ev = voiceFindEventOfLine(line);
        if (ev) state.voice.selected = ev.event;
        return previewVoiceAnimation(line);
      },
      voiceAnimationStatus: (eventId) => {
        const ev = voiceFindEvent(eventId);
        if (!ev) return null;
        /* 0.9.43 修：ev.animations 里可能夹着 null（浏览器实测 pet_clicked 为 [null]），
           直接 map 会产出 `{animation: undefined, status: "none"}` 这种垃圾项。
           先过滤掉非字符串，再解析状态。 */
        const names = (ev.animations || []).filter((a) => typeof a === "string" && a);
        if (!names.length) return { animations: [], declared: false, note: "该事件不声明联动动画" };
        return {
          declared: true,
          animations: names.map((a) => ({ animation: a, status: voiceAnimationStatusInEvent(ev, a) })),
        };
      },
      /* 表情 / 动画分页调试入口（只读快照 + 与 UI 同一个动作函数） */
      expr: () => ({
        metaState: state.expr.metaState,
        metaUrl: state.expr.metaUrl,
        metaError: state.expr.metaError,
        setCount: exprSetEntries().length,
        mode: state.expr.mode,
        appliedSet: state.expr.set,
        override: Object.assign({}, state.expr.override),
        warnings: state.expr.warnings.slice(),
        /* 0.9.21：暴露画布重绘计数，供「点击后是否真的重绘」这类回归断言使用。 */
        renderCount: state.renderCount || 0,
      }),
      exprApplySet: (name) => applyExprSet(name),
      exprApplyAttachment: (slotKey, attName) => applyExprAttachment(slotKey, attName),
      exprApplyBlinkLevel: (side, level) => applyExprBlinkLevel(side, level),
      exprReset: () => exprResetToSetup(),
      /* 显示顺序图层组（只读快照 + 与 UI 同一个动作函数） */
      slotGroups: () => ({
        source: state.slotGroup.source,
        reason: state.slotGroup.groups.length ? "" : slotGroupFallbackReason(),
        collapsed: Array.from(state.slotGroup.collapsed),
        groups: state.slotGroup.groups.map((g) => ({
          gid: g.gid,
          name: g.name,
          size: g.size,
          minIndex: g.minIndex,
          maxIndex: g.maxIndex,
          zLabel: g.zLabel,
          partial: g.partial,
          slots: g.slots.slice(),
          vis: slotGroupVis(g).state,
        })),
      }),
      slotGroupToggle: (gid) => toggleSlotGroupCollapsed(gid),
      slotGroupToggleHidden: (gid) => toggleSlotGroupHidden(gid),
      slotListRefresh: () => syncList(),
      slotSetSearch: (q) => {
        state.search = String(q == null ? "" : q);
        const inp = el0("slotSearch");
        if (inp) inp.value = state.search;
        syncList();
      },
      slotRowIndices: () => Array.from(document.querySelectorAll("#list .slot-row")).map((r) => Number(r.dataset.index)),
      slotCanDrop: (from, to, after) => {
        const lib = slotGroupLib();
        if (!lib) return { ok: false, reason: "no-lib" };
        return lib.canDropInGroup(slotGroups(), from, to, after);
      },
      loadRigMeta: () => loadRigMeta(),
      animEdit: () => ({
        sel: state.animEdit.sel,
        dirty: animHasDraft(),
        draftNames: Object.keys(state.animEdit.drafts),
        duration: animDuration(state.animEdit.sel),
        appliedDurations: animDirtyCount(),
      }),
      animSelect: (name) => setAnimEditSelection(name),
      animSetDuration: (v) => animApplyScale(state.animEdit.sel, Number(v)),
      animAddBoneKey: (bone, field) => animAddBoneKey(state.animEdit.sel, bone, field),
      animAddSlotKey: (slot, att) => animAddSlotKey(state.animEdit.sel, slot, att),
      animRemoveKey: (kind, owner, field, time) => animRemoveKey(state.animEdit.sel, kind, owner, field, time),
      animResetOne: () => animResetOne(state.animEdit.sel),
      animResetAll: () => animResetAll(),
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