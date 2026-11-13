/*
 * keymap.js —— 快捷键模型（纯数据 + 纯函数）· 动作注册表 / chord 规范化 / 冲突校验 / 事件解析 / 偏好净化
 *
 * 边界：不碰 DOM / localStorage / fetch。浏览器暴露 window.SpineKeymap，Node 里是 globalThis.SpineKeymap。
 * 契约依据：design/editor-p1-contract.md §7（动作表）与 §8（偏好持久化）。
 *
 * scope 语义（T16 契约 + 顾问裁定）：
 *   - 模块只声明 `editor`（编辑器内全局）与 `timeline-graph`（仅时间轴/Graph 面板）。
 *   - **app 必须传真实的 ctx.scope（'editor' | 'timeline' | 'graph'）与 ctx 能力位**；模块不替 app 判断焦点。
 *   - copy / delete 需要已有 Key 选择（ctx.keySelection）；paste 需要有效剪贴板 + 动画（ctx.clipboard/ctx.animation）；
 *     selectAll 需要可见可选轨（ctx.selectableRows）——后两者不要求预选。
 *   - 固定通道 Space（按住平移）/ Escape（取消·关菜单）不可改绑，也不允许被别的动作占用。
 *   - 输入类目标（input/textarea/select/contenteditable）、IME（isComposing / keyCode 229）、AltGraph 一律不触发动作。
 */
(function (global) {
  "use strict";

  const SETTINGS_KEY = "dsh.character-editor.preferences";
  const SETTINGS_VERSION = 1;

  /* ------------------------------------------------------------------ *
   * 动作注册表
   * ------------------------------------------------------------------ */
  const ACTIONS = Object.freeze([
    { id: "translate", label: "平移工具", scope: "editor", defaultKeys: ["V"] },
    { id: "rotate", label: "旋转工具", scope: "editor", defaultKeys: ["R"] },
    { id: "scale", label: "缩放工具", scope: "editor", defaultKeys: ["S"] },
    { id: "pose", label: "Pose 工具", scope: "editor", defaultKeys: ["W"] },
    { id: "key", label: "打关键帧", scope: "editor", defaultKeys: ["K"] },
    /* Flash 式三键（用户明确要求「像 Flash 一样的操作体验」）：
       · F5 = 普通帧（延长当前姿态的显示时间）
       · F6 = 关键帧（把当前姿态记成 Key；若已在该帧则转成普通帧延长）
       · F7 = 空白帧（清空当前帧该轨道的 Key，语义等价于 Flash 空白关键帧）
       注意：Spine 没有通用「空白关键帧对象」（规划书 §3.5 禁止为模仿 Flash 引入错误数据语义），
       所以 F7 实现为「删除当前帧该轨道的 Key」——在帧格上看起来就是空白，但不新建错误对象。 */
    { id: "frameHold", label: "普通帧（延长姿态）", scope: "timeline-graph", defaultKeys: ["F5"], requires: { animation: true } },
    { id: "frameKey", label: "关键帧（打键 / 转普通帧）", scope: "timeline-graph", defaultKeys: ["F6"], requires: { animation: true } },
    { id: "frameBlank", label: "空白帧（清空当前帧该轨道）", scope: "timeline-graph", defaultKeys: ["F7"], requires: { animation: true } },
    { id: "play", label: "播放 / 暂停", scope: "editor", defaultKeys: ["P"] },
    { id: "undo", label: "撤销", scope: "editor", defaultKeys: ["Mod+Z"] },
    { id: "redo", label: "重做", scope: "editor", defaultKeys: ["Mod+Shift+Z", "Mod+Y"] },
    { id: "timeline", label: "展开 / 收起时间轴", scope: "editor", defaultKeys: ["Tab"] },
    { id: "save", label: "保存", scope: "editor", defaultKeys: ["Mod+S"] },
    { id: "help", label: "快捷键帮助", scope: "editor", defaultKeys: ["Shift+/"] },
    {
      id: "delete",
      label: "删除选中 Key",
      scope: "timeline-graph",
      defaultKeys: ["Delete", "Backspace"],
      requires: { keySelection: true },
    },
    { id: "copy", label: "复制 Key", scope: "timeline-graph", defaultKeys: ["Mod+C"], requires: { keySelection: true } },
    /* 剪切 = 复制 + 删除。右键菜单里早有 cutKey 分支，但从未绑键（实测发现）。 */
    { id: "cut", label: "剪切 Key", scope: "timeline-graph", defaultKeys: ["Mod+X"], requires: { keySelection: true } },
    { id: "paste", label: "粘贴 Key", scope: "timeline-graph", defaultKeys: ["Mod+V"], requires: { clipboard: true, animation: true } },
    { id: "selectAll", label: "全选可见 Key", scope: "timeline-graph", defaultKeys: ["Mod+A"], requires: { selectableRows: true } },
    { id: "pan", label: "按住平移（固定通道）", scope: "editor", defaultKeys: ["Space"], reserved: true },
    { id: "cancel", label: "取消 / 关菜单（固定通道）", scope: "editor", defaultKeys: ["Escape"], reserved: true },
  ]);

  const ACTION_IDS = Object.freeze(ACTIONS.map(function (a) {
    return a.id;
  }));
  const SCOPES = Object.freeze(["editor", "timeline", "graph"]);
  const MODULE_SCOPES = Object.freeze(["editor", "timeline-graph"]);

  /** 固定通道：不可改绑、也不可被其它动作占用 */
  const RESERVED_CHORDS = Object.freeze(["Space", "Escape"]);
  /** 浏览器 / 系统保留组合：不得注册为编辑器动作（契约 §7）
   *
   *  **F5 已从本表移除**（用户明确要求「像 Flash 一样的操作体验」，Flash 的 F5 就是
   *  「普通帧/延长」）。代价：编辑页里按 F5 不再触发浏览器刷新 —— 这是刻意的取舍，
   *  因为本工具是动画编辑器，F5 的 Flash 语义优先于刷新。仍然保留 F11/F12
   *  （全屏/开发者工具），以及所有 Ctrl/Cmd 组合（标签页/地址栏类）。
   */
  const BROWSER_RESERVED = Object.freeze([
    "Mod+KeyW",
    "Mod+KeyR",
    "Mod+KeyT",
    "Mod+KeyN",
    "Mod+KeyQ",
    "Mod+Shift+KeyW",
    "Mod+KeyL",
    "Mod+Digit1",
    "Mod+Digit2",
    "Mod+Digit3",
    "Mod+Digit4",
    "Mod+Digit5",
    "Mod+Digit6",
    "Mod+Digit7",
    "Mod+Digit8",
    "Mod+Digit9",
    "F11",
    "F12",
    "Alt+ArrowLeft",
    "Alt+ArrowRight",
  ]);

  /* DEFAULT_BINDINGS 在 normalizeChord 定义之后构建（表内即规范 chord） */

  /* ------------------------------------------------------------------ *
   * chord 规范化
   * ------------------------------------------------------------------ */
  const MOD_ALIASES = { mod: "Mod", ctrl: "Mod", control: "Mod", cmd: "Mod", command: "Mod", meta: "Mod", "⌘": "Mod" };
  const ALT_ALIASES = { alt: "Alt", option: "Alt", opt: "Alt", "⌥": "Alt" };
  const SHIFT_ALIASES = { shift: "Shift", "⇧": "Shift" };
  const NAMED_KEYS = {
    space: "Space",
    escape: "Escape",
    esc: "Escape",
    tab: "Tab",
    enter: "Enter",
    return: "Enter",
    backspace: "Backspace",
    delete: "Delete",
    del: "Delete",
    insert: "Insert",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
    slash: "Slash",
    backslash: "Backslash",
    comma: "Comma",
    period: "Period",
    semicolon: "Semicolon",
    quote: "Quote",
    bracketleft: "BracketLeft",
    bracketright: "BracketRight",
    minus: "Minus",
    equal: "Equal",
    backquote: "Backquote",
  };
  const PUNCT_TO_CODE = {
    "/": "Slash",
    "?": "Slash",
    "\\": "Backslash",
    ",": "Comma",
    ".": "Period",
    ";": "Semicolon",
    "'": "Quote",
    "[": "BracketLeft",
    "]": "BracketRight",
    "-": "Minus",
    "=": "Equal",
    "`": "Backquote",
    "<": "Comma",
    ">": "Period",
  };

  function canonicizeKeyToken(raw) {
    if (typeof raw !== "string" || !raw) return null;
    const t = raw.trim();
    if (!t) return null;
    const lower = t.toLowerCase();
    if (NAMED_KEYS[lower]) return NAMED_KEYS[lower];
    if (/^key[a-z]$/i.test(t)) return "Key" + t.slice(3).toUpperCase();
    if (/^digit[0-9]$/i.test(t)) return "Digit" + t.slice(5);
    if (/^f([1-9]|1[0-2])$/i.test(t)) return "F" + t.slice(1);
    if (/^[a-z]$/i.test(t)) return "Key" + t.toUpperCase();
    if (/^[0-9]$/.test(t)) return "Digit" + t;
    if (PUNCT_TO_CODE[t]) return PUNCT_TO_CODE[t];
    return null;
  }

  /**
   * 规范化 chord（大小写无关、修饰键有序、ctrl/meta 统一为 Mod）。
   * @returns {string|null} 例：'mod+shift+z' → 'Mod+Shift+KeyZ'；非法返回 null。
   */
  function normalizeChord(chord) {
    if (typeof chord !== "string") return null;
    const raw = chord.trim();
    if (!raw) return null;
    const parts = raw.split("+").map(function (p) {
      return p.trim();
    });
    if (parts.some(function (p) { return !p; })) return null;
    const mods = [];
    let key = null;
    for (const p of parts) {
      const lower = p.toLowerCase();
      if (MOD_ALIASES[lower]) {
        if (mods.indexOf("Mod") < 0) mods.push("Mod");
        continue;
      }
      if (ALT_ALIASES[lower]) {
        if (mods.indexOf("Alt") < 0) mods.push("Alt");
        continue;
      }
      if (SHIFT_ALIASES[lower]) {
        if (mods.indexOf("Shift") < 0) mods.push("Shift");
        continue;
      }
      if (key !== null) return null; // 两个非修饰键
      const k = canonicizeKeyToken(p);
      if (!k) return null;
      key = k;
    }
    if (key === null) return null; // 只有修饰键
    /* '?' 自带 Shift；显式写 Shift+/ 也一样 */
    if (raw.indexOf("?") >= 0 && mods.indexOf("Shift") < 0) mods.push("Shift");
    const order = ["Mod", "Alt", "Shift"];
    const ordered = order.filter(function (m) {
      return mods.indexOf(m) >= 0;
    });
    return ordered.concat([key]).join("+");
  }

  function isReservedChord(chord) {
    const c = normalizeChord(chord);
    return !!c && RESERVED_CHORDS.indexOf(c) >= 0;
  }

  /* DEFAULT_BINDINGS：表内即规范 chord（'V' → 'KeyV'、'Mod+Z' → 'Mod+KeyZ'） */
  const DEFAULT_BINDINGS = Object.freeze(
    ACTIONS.reduce(function (acc, a) {
      acc[a.id] = a.defaultKeys.map(function (c) {
        return normalizeChord(c) || c;
      });
      return acc;
    }, {})
  );

  /** 供 UI 显示：'Mod+KeyZ' → 'Ctrl+Z'（mac:true → '⌘+Z'）、'KeyV' → 'V'、'Shift+Slash' → 'Shift+/' */
  function displayChord(chord, opts) {
    const c = normalizeChord(chord);
    if (!c) return null;
    const mac = !!(opts && opts.mac);
    const parts = c.split("+");
    const out = parts.map(function (p) {
      if (p === "Mod") return mac ? "⌘" : "Ctrl";
      if (p === "Alt") return mac ? "⌥" : "Alt";
      if (p === "Shift") return mac ? "⇧" : "Shift";
      if (p === "Slash") return "/";
      if (/^Key[A-Z]$/.test(p)) return p.slice(3);
      if (/^Digit[0-9]$/.test(p)) return p.slice(5);
      return p;
    });
    return out.join("+");
  }
  function isBrowserReservedChord(chord) {
    const c = normalizeChord(chord);
    return !!c && BROWSER_RESERVED.indexOf(c) >= 0;
  }

  function actionById(id) {
    for (let i = 0; i < ACTIONS.length; i++) if (ACTIONS[i].id === id) return ACTIONS[i];
    return null;
  }
  function labelOf(id) {
    const a = actionById(id);
    return a ? a.label : null;
  }
  function scopeOf(id) {
    const a = actionById(id);
    return a ? a.scope : null;
  }
  function requiresOf(id) {
    const a = actionById(id);
    return a && a.requires ? a.requires : null;
  }
  function isReservedAction(id) {
    const a = actionById(id);
    return !!(a && a.reserved);
  }
  function defaults() {
    return JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
  }
  function reset() {
    return defaults();
  }
  /** 把 map 的值统一成规范 chord 数组（不改入参）；非法 chord 原样保留供 validate 报告 */
  function chordList(value) {
    if (value === undefined || value === null) return [];
    const arr = Array.isArray(value) ? value : [value];
    return arr.map(function (c) {
      return typeof c === "string" ? c.trim() : c;
    }).filter(function (c) {
      return c !== "";
    });
  }
  /** 取某动作的绑定：map 是"覆盖补丁"，缺该 key 时回落到默认表；显式空数组 = 禁用 */
  function bindingsOf(map, id) {
    const m = map && typeof map === "object" ? map : {};
    const v = Object.prototype.hasOwnProperty.call(m, id) ? m[id] : DEFAULT_BINDINGS[id];
    return chordList(v);
  }
  function normalize(map) {
    const src = map && typeof map === "object" ? map : {};
    const out = {};
    for (const a of ACTIONS) {
      const list = chordList(Object.prototype.hasOwnProperty.call(src, a.id) ? src[a.id] : DEFAULT_BINDINGS[a.id]);
      const norm = [];
      for (const c of list) {
        const n = normalizeChord(c);
        if (n && norm.indexOf(n) < 0) norm.push(n);
      }
      out[a.id] = norm;
    }
    return out;
  }
  function serialize(map) {
    return JSON.stringify({ version: SETTINGS_VERSION, shortcuts: normalize(map) });
  }

  /** 解析持久化文本；损坏 JSON / 空文本不抛异常，回退默认并给出 error */
  function parse(text) {
    if (typeof text !== "string" || !text.trim()) {
      return { ok: false, settings: sanitizeSettings(null), error: "EMPTY_TEXT" };
    }
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      return { ok: false, settings: sanitizeSettings(null), error: "JSON_PARSE: " + (err && err.message) };
    }
    const settings = sanitizeSettings(raw);
    return { ok: !settings.repaired, settings: settings, error: null };
  }

  /* ------------------------------------------------------------------ *
   * 校验与冲突
   * ------------------------------------------------------------------ */
  function scopesOverlap(a, b) {
    if (a === b) return true;
    if (a === "editor" || b === "editor") return true; // 编辑器全局与任何面板叠加
    return true; // timeline ↔ graph：同属时间轴区域，保守视为重叠
  }

  /**
   * 校验绑定表（只报不改）。
   * @returns {{ok:boolean, issues:Array, map:object}}
   *   issues[].code: UNKNOWN_ACTION | ILLEGAL_CHORD | RESERVED_ACTION | RESERVED_CHORD
   *                  | BROWSER_RESERVED | DUPLICATE_CHORD | DISABLED(info)
   */
  function validateBindings(map) {
    const issues = [];
    const src = map && typeof map === "object" ? map : {};
    for (const key of Object.keys(src)) {
      if (!actionById(key)) issues.push({ code: "UNKNOWN_ACTION", actionId: key, severity: "error", detail: "未注册的动作 id" });
    }
    const seen = [];
    for (const a of ACTIONS) {
      const has = Object.prototype.hasOwnProperty.call(src, a.id);
      const list = has ? chordList(src[a.id]) : chordList(DEFAULT_BINDINGS[a.id]);
      if (has && isReservedAction(a.id)) {
        const same = JSON.stringify(normalizeChordList(list)) === JSON.stringify(normalizeChordList(DEFAULT_BINDINGS[a.id]));
        if (!same) issues.push({ code: "RESERVED_ACTION", actionId: a.id, severity: "error", detail: "固定通道不可改绑（" + DEFAULT_BINDINGS[a.id].join("/") + "）" });
      }
      if (!list.length) {
        issues.push({ code: "DISABLED", actionId: a.id, severity: "info", detail: "该动作已禁用（空绑定）" });
        continue;
      }
      const norm = normalizeChordList(list);
      for (let i = 0; i < list.length; i++) {
        if (!norm[i]) {
          issues.push({ code: "ILLEGAL_CHORD", actionId: a.id, chord: list[i], severity: "error", detail: "无法规范化的键位" });
          continue;
        }
        if (isReservedChord(norm[i]) && DEFAULT_BINDINGS[a.id].indexOf(norm[i]) < 0) {
          issues.push({ code: "RESERVED_CHORD", actionId: a.id, chord: norm[i], severity: "error", detail: "Space / Escape 是固定通道" });
        }
        if (isBrowserReservedChord(norm[i])) {
          issues.push({ code: "BROWSER_RESERVED", actionId: a.id, chord: norm[i], severity: "error", detail: "浏览器/系统保留组合" });
        }
        for (const prev of seen) {
          if (prev.chord === norm[i] && scopesOverlap(prev.scope, a.scope)) {
            issues.push({
              code: "DUPLICATE_CHORD",
              actionId: a.id,
              otherActionId: prev.actionId,
              chord: norm[i],
              severity: "error",
              detail: prev.actionId + " 与 " + a.id + " 抢同一组合键（scope " + prev.scope + " / " + a.scope + " 重叠）",
            });
          }
        }
        seen.push({ chord: norm[i], actionId: a.id, scope: a.scope });
      }
    }
    return { ok: !issues.some(function (i) { return i.severity === "error"; }), issues: issues, map: normalize(src) };
  }
  function normalizeChordList(list) {
    return chordList(list).map(function (c) {
      return normalizeChord(c);
    });
  }
  function conflicts(map) {
    const out = [];
    const seen = [];
    for (const a of ACTIONS) {
      const list = normalizeChordList(bindingsOf(map, a.id));
      for (const c of list) {
        if (!c) continue;
        for (const prev of seen) {
          if (prev.chord === c && scopesOverlap(prev.scope, a.scope)) {
            out.push({ chord: c, actions: [prev.actionId, a.id], overlap: prev.scope === a.scope ? prev.scope + "-vs-" + a.scope : prev.scope + "-vs-" + a.scope });
          }
        }
        seen.push({ chord: c, actionId: a.id, scope: a.scope });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 事件 → chord → 动作
   * ------------------------------------------------------------------ */
  const MODIFIER_CODES = ["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "CapsLock", "NumLock", "ScrollLock", "ContextMenu"];

  function isTextInputTarget(target) {
    if (!target) return false;
    const tag = typeof target.tagName === "string" ? target.tagName.toUpperCase() : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    let node = target;
    for (let depth = 0; node && depth < 10; depth++) {
      if (node.isContentEditable === true) return true;
      node = node.parentElement || node.parentNode || null;
    }
    return false;
  }

  /**
   * 事件 → 规范 chord（无则 null）。
   * 排除：IME（isComposing / keyCode 229 / key 'Process'）、AltGraph、纯修饰键、输入类目标（ctx.textInput 或 event.target）。
   */
  function chordFromEvent(eventLike, ctx) {
    const ev = eventLike;
    if (!ev || typeof ev !== "object") return null;
    const c = ctx && typeof ctx === "object" ? ctx : {};
    if (ev.isComposing === true) return null;
    if (ev.keyCode === 229 || ev.which === 229 || ev.key === "Process") return null;
    if (typeof ev.getModifierState === "function" && ev.getModifierState("AltGraph")) return null;
    /* Windows AltGr ≈ Ctrl+Alt：不得当成用户快捷键 */
    if (ev.ctrlKey && ev.altKey && !ev.metaKey) return null;
    if (c.textInput === true) return null;
    if (isTextInputTarget(ev.target)) return null;
    const code = typeof ev.code === "string" && ev.code ? ev.code : null;
    if (code && MODIFIER_CODES.indexOf(code) >= 0) return null;
    const keyToken = code || (typeof ev.key === "string" ? ev.key : "");
    if (!keyToken) return null;
    const parts = [];
    if (ev.ctrlKey || ev.metaKey) parts.push("Mod");
    if (ev.altKey) parts.push("Alt");
    if (ev.shiftKey) parts.push("Shift");
    parts.push(keyToken);
    return normalizeChord(parts.join("+"));
  }

  function requiresSatisfied(action, ctx) {
    const req = action.requires;
    if (!req) return true;
    const c = ctx && typeof ctx === "object" ? ctx : {};
    for (const k of Object.keys(req)) {
      if (req[k] === true && c[k] !== true) return false;
    }
    return true;
  }

  /**
   * 事件 → 动作 id（无匹配/被门槛拦下则 null）。
   * 优先级（契约 §7）：当前 timeline/graph 面板动作 → editor 动作；只执行一次。
   * @param {object} map actionId → chord 数组
   * @param {object} eventLike 真实 KeyboardEvent 或 {code,key,ctrlKey,metaKey,shiftKey,altKey,...}
   * @param {{scope?:'editor'|'timeline'|'graph', keySelection?:boolean, clipboard?:boolean, animation?:boolean, selectableRows?:boolean, textInput?:boolean}} ctx
   */
  function resolveAction(map, eventLike, ctx) {
    const chord = chordFromEvent(eventLike, ctx);
    if (!chord) return null;
    const c = ctx && typeof ctx === "object" ? ctx : {};
    const panelActive = c.scope === "timeline" || c.scope === "graph";
    const order = panelActive ? ["timeline-graph", "editor"] : ["editor"];
    for (const scope of order) {
      for (const a of ACTIONS) {
        if (a.scope !== scope) continue;
        if (normalizeChordList(bindingsOf(map, a.id)).indexOf(chord) < 0) continue;
        if (!requiresSatisfied(a, c)) continue;
        return a.id;
      }
    }
    return null;
  }

  /** 某个 chord 当前会命中哪个动作（便于 UI 提示冲突） */
  function actionForChord(map, chord, ctx) {
    const n = normalizeChord(chord);
    if (!n) return null;
    const c = ctx && typeof ctx === "object" ? ctx : {};
    const panelActive = c.scope === "timeline" || c.scope === "graph";
    const order = panelActive ? ["timeline-graph", "editor"] : ["editor"];
    for (const scope of order) {
      for (const a of ACTIONS) {
        if (a.scope !== scope) continue;
        if (normalizeChordList(bindingsOf(map, a.id)).indexOf(n) < 0) continue;
        if (!requiresSatisfied(a, c)) continue;
        return a.id;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 偏好净化（只合并 shortcuts；layout / models 由 app 自己校验）
   * ------------------------------------------------------------------ */
  /**
   * @returns {{shortcuts:object, issues:Array, repaired:boolean}}
   */
  function sanitizeShortcuts(raw) {
    const issues = [];
    let repaired = false;
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
    if (!src) {
      issues.push({ code: "SHORTCUTS_NOT_OBJECT", severity: "warn", detail: "shortcuts 不是对象，已回退默认表" });
      return { shortcuts: defaults(), issues: issues, repaired: true };
    }
    const out = defaults();
    for (const id of Object.keys(src)) {
      if (!actionById(id)) {
        issues.push({ code: "UNKNOWN_ACTION", actionId: id, severity: "warn", detail: "未注册动作，已忽略" });
        repaired = true;
        continue;
      }
      const list = chordList(src[id]);
      if (!list.length) {
        out[id] = []; // 空 = 显式禁用
        continue;
      }
      const norm = [];
      for (const c of list) {
        const n = normalizeChord(c);
        if (!n || isReservedChord(n) && DEFAULT_BINDINGS[id].indexOf(n) < 0 || isBrowserReservedChord(n)) {
          issues.push({ code: "ILLEGAL_CHORD", actionId: id, chord: c, severity: "warn", detail: "非法/保留组合，该项保留默认" });
          repaired = true;
          continue;
        }
        if (norm.indexOf(n) < 0) norm.push(n);
      }
      if (norm.length) out[id] = norm;
      else {
        issues.push({ code: "SHORTCUT_KEPT_DEFAULT", actionId: id, severity: "warn", detail: "全部键位非法，保留默认" });
        repaired = true;
      }
    }
    const merged = Object.assign(defaults(), out);
    const v = validateBindings(merged);
    if (!v.ok) {
      issues.push({ code: "CONFLICT_AFTER_MERGE", severity: "error", detail: "合并后仍有冲突", conflicts: conflicts(merged) });
      return { shortcuts: defaults(), issues: issues, repaired: true };
    }
    return { shortcuts: merged, issues: issues, repaired: repaired };
  }

  /**
   * 净化持久化偏好对象（契约 §8 的 preferences：{version, layout, shortcuts, models}）。
   * **只校验并合并 `shortcuts`**；`layout` / `models` 原样透传（由 app 自己按 range 夹取），不覆盖。
   * @returns {{version:number, shortcuts:object, layout:*, models:*, issues:Array, repaired:boolean}}
   */
  function sanitizeSettings(raw) {
    const issues = [];
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
    if (!src) {
      return {
        version: SETTINGS_VERSION,
        shortcuts: defaults(),
        layout: undefined,
        models: undefined,
        issues: [{ code: "SETTINGS_NOT_OBJECT", severity: "warn", detail: "偏好不是对象，shortcuts 回退默认，layout/models 置空" }],
        repaired: true,
      };
    }
    if (src.version !== SETTINGS_VERSION) {
      issues.push({ code: "VERSION_MISMATCH", severity: "warn", detail: "version=" + JSON.stringify(src.version) + "，按 v" + SETTINGS_VERSION + " 读取 shortcuts" });
    }
    const s = sanitizeShortcuts(src.shortcuts);
    return {
      version: SETTINGS_VERSION,
      shortcuts: s.shortcuts,
      layout: src.layout,
      models: src.models,
      issues: issues.concat(s.issues),
      repaired: s.repaired || src.version !== SETTINGS_VERSION,
    };
  }

  const api = Object.freeze({
    SETTINGS_KEY: SETTINGS_KEY,
    SETTINGS_VERSION: SETTINGS_VERSION,
    ACTIONS: ACTIONS,
    ACTION_IDS: ACTION_IDS,
    SCOPES: SCOPES,
    MODULE_SCOPES: MODULE_SCOPES,
    RESERVED_CHORDS: RESERVED_CHORDS,
    BROWSER_RESERVED: BROWSER_RESERVED,
    DEFAULT_BINDINGS: DEFAULT_BINDINGS,

    normalizeChord: normalizeChord,
    displayChord: displayChord,
    chordFromEvent: chordFromEvent,
    fromKeyboardEvent: chordFromEvent,
    isTextInputTarget: isTextInputTarget,
    isReservedChord: isReservedChord,
    isBrowserReservedChord: isBrowserReservedChord,

    validateBindings: validateBindings,
    conflicts: conflicts,
    resolveAction: resolveAction,
    actionForChord: actionForChord,

    defaults: defaults,
    reset: reset,
    normalize: normalize,
    serialize: serialize,
    parse: parse,
    labelOf: labelOf,
    scopeOf: scopeOf,
    requiresOf: requiresOf,
    isReservedAction: isReservedAction,
    bindingsOf: bindingsOf,
    chordList: chordList,

    sanitizeShortcuts: sanitizeShortcuts,
    sanitizeSettings: sanitizeSettings,
  });

  global.SpineKeymap = api;
  if (typeof window !== "undefined" && window.SpineKeymap !== api) window.SpineKeymap = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
