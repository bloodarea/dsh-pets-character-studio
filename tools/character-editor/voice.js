/*
 * voice.js —— 事件语音索引（voice/index.json）校验 / 分组 / 资源评估 · 纯模块
 *
 * 边界（契约 §1）：
 *   本文件不碰 DOM / window.location / Image / Audio / fetch / Blob / URL / 磁盘 IO。
 *   只接收普通对象与字符串，返回 {ok, value|issues} 风格结果（与 bundle.js 一致）。
 *   浏览器暴露 window.SpineVoice；Node 里是 globalThis.SpineVoice（selftest 复用）。
 *
 * 消费方：
 *   - tools/character-editor/app.js：语音浮层的事件分组、路径解析、资源状态汇总；
 *   - selftest.html / selftest.js：纯函数断言。
 */
(function (global) {
  "use strict";

  const API_VERSION = 1;
  const CATEGORIES = Object.freeze(["agent", "session", "interaction", "easter_egg"]);

  /*
   * 契约 §1.1 的限额。§1.2 只把 indexBytes / lines 定为硬错误；
   * events / idChars / textChars 当前**不强制**，只作为对外常量供 UI 提示与后续规则，
   * 不要据此拒绝索引。
   */
  const LIMITS = Object.freeze({
    indexBytes: 256 * 1024,
    lines: 256,
    events: 128,
    idChars: 128,
    textChars: 2000,
  });

  const INDEX_FIELDS = {
    character_id: true,
    character_name: true,
    language: true,
    voice_profile: true,
    usage: true,
    audio_format: true,
    line_count: true,
    notes: true,
    lines: true,
  };

  const LINE_FIELDS = {
    id: true,
    category: true,
    event: true,
    text: true,
    emotion: true,
    delivery: true,
    audio_file: true,
    auto_play: true,
    animation: true,
  };

  const META_STRINGS = ["character_id", "character_name", "language", "voice_profile", "usage", "audio_format"];
  const AUDIO_STATUSES = ["checking", "ok", "missing", "unknown"];
  const EVENT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

  /* ==========================================================================
   * 0. 结果与小工具（与 bundle.js 同款）
   * ====================================================================== */
  function issue(path, code, message) {
    return { path: String(path == null ? "" : path), code: code, message: String(message || code) };
  }
  function failure(code, message, path) {
    return { ok: false, issues: [issue(path, code, message)] };
  }
  function issuesResult(issues) {
    return { ok: false, issues: issues || [] };
  }
  function success(value, issues) {
    return { ok: true, value: value, issues: issues || [] };
  }

  function show(v) {
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number" || typeof v === "boolean" || v === null || v === undefined) return String(v);
    try {
      return JSON.stringify(v);
    } catch (_) {
      return String(v);
    }
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function utf8ByteLength(text) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(String(text)).length;
    /* 极老环境的兜底（与 bundle.js 相同的思路） */
    return unescape(encodeURIComponent(String(text))).length;
  }

  /* ==========================================================================
   * 1. 路径文法（契约 §1.3，2026-11-04 补丁）
   *
   * packRoot 是仓库根相对路径；audioFile 是相对 packRoot 的路径。
   * 两者都拒绝：绝对路径、`..` / `.` 段、空段、反斜杠、: ? # %、控制字符；
   * 目录 / 文件段沿用 bundle.js 的 ASCII 字母数字 . _ - 文法。
   * 返回 issue 或 null。
   * ====================================================================== */
  const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
  const CONTROL_RE = /[\u0000-\u001f\u007f]/;

  function pathIssue(value, path, label) {
    const p = path || "path";
    const what = label || "路径";
    if (typeof value !== "string") return issue(p, "UNSAFE_PATH", what + "必须是字符串");
    if (!value) return issue(p, "UNSAFE_PATH", what + "不能为空");
    if (value.charAt(0) === "/") return issue(p, "UNSAFE_PATH", what + "不能是绝对路径：" + show(value));
    if (value.indexOf("\\") >= 0) return issue(p, "UNSAFE_PATH", what + "不能包含反斜杠：" + show(value));
    if (value.indexOf(":") >= 0) return issue(p, "UNSAFE_PATH", what + "不能包含协议 / 盘符前缀：" + show(value));
    if (value.indexOf("?") >= 0 || value.indexOf("#") >= 0) {
      return issue(p, "UNSAFE_PATH", what + "不能包含 ? 或 #：" + show(value));
    }
    if (value.indexOf("%") >= 0) return issue(p, "UNSAFE_PATH", what + "不能包含百分号编码：" + show(value));
    if (CONTROL_RE.test(value)) return issue(p, "UNSAFE_PATH", what + "不能包含控制字符");
    if (value.indexOf("..") >= 0) return issue(p, "UNSAFE_PATH", what + "不能包含 ..：" + show(value));
    const parts = value.split("/");
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      if (!seg) return issue(p, "UNSAFE_PATH", what + "不能有空路径段：" + show(value));
      if (seg === ".") return issue(p, "UNSAFE_PATH", what + "不能包含 . 段：" + show(value));
      if (!SEGMENT_RE.test(seg)) {
        return issue(p, "UNSAFE_PATH", what + "的路径段只允许 ASCII 字母、数字与 . _ -：" + show(seg));
      }
    }
    return null;
  }

  function stripTrailingSlashes(value) {
    return typeof value === "string" ? value.replace(/\/+$/, "") : value;
  }

  /* ==========================================================================
   * 2. 索引校验（契约 §1.2）
   *
   * 硬错误 -> ok:false；警告 -> ok:true + issues（保留数据，界面提示）。
   * ====================================================================== */
  function validateIndex(input) {
    const issues = [];
    let fatal = false;

    function warn(path, code, message) {
      issues.push(issue(path, code, message));
    }
    function bad(path, code, message) {
      fatal = true;
      issues.push(issue(path, code, message));
    }

    if (!isPlainObject(input)) return failure("NOT_OBJECT", "语音索引必须是 JSON 对象", "");

    for (const k of Object.keys(input)) {
      if (!INDEX_FIELDS[k]) warn(k, "UNKNOWN_FIELD", "语音索引包含未知字段：" + k);
    }

    /* 顶层必填字符串 */
    for (const k of META_STRINGS) {
      if (!Object.prototype.hasOwnProperty.call(input, k) || input[k] === undefined || input[k] === null) {
        bad(k, "MISSING_FIELD", "语音索引缺少 " + k);
      } else if (typeof input[k] !== "string") {
        bad(k, "INVALID_TYPE", k + " 必须是字符串");
      }
    }

    /* audio_format 非 ogg 只是警告 */
    if (typeof input.audio_format === "string" && input.audio_format !== "ogg") {
      warn("audio_format", "BAD_AUDIO_FORMAT", "audio_format 应为 ogg：" + show(input.audio_format));
    }

    /* line_count：必须是有限非负整数（与实际不符另算警告） */
    let lineCount = null;
    if (!Object.prototype.hasOwnProperty.call(input, "line_count") || input.line_count === undefined || input.line_count === null) {
      bad("line_count", "MISSING_FIELD", "语音索引缺少 line_count");
    } else if (
      typeof input.line_count !== "number" ||
      !isFinite(input.line_count) ||
      !Number.isInteger(input.line_count) ||
      input.line_count < 0
    ) {
      bad("line_count", "INVALID_TYPE", "line_count 必须是有限非负整数：" + show(input.line_count));
    } else {
      lineCount = input.line_count;
    }

    /* notes：可选；必须是字符串数组，非字符串元素警告并丢弃 */
    let notes = null;
    if (input.notes !== undefined && input.notes !== null) {
      if (!Array.isArray(input.notes)) {
        warn("notes", "INVALID_NOTES", "notes 必须是字符串数组");
      } else {
        notes = [];
        for (let i = 0; i < input.notes.length; i++) {
          if (typeof input.notes[i] !== "string") {
            warn("notes[" + i + "]", "INVALID_NOTES", "notes 只允许字符串");
          } else {
            notes.push(input.notes[i]);
          }
        }
      }
    }

    /* lines */
    let rawLines = null;
    if (!Array.isArray(input.lines)) {
      bad("lines", "MISSING_FIELD", "语音索引缺少 lines 数组");
    } else if (input.lines.length > LIMITS.lines) {
      bad(
        "lines",
        "TOO_MANY_LINES",
        "台词数量超过上限（最多 " + LIMITS.lines + " 条，实际 " + input.lines.length + " 条）"
      );
    } else {
      rawLines = input.lines;
      if (rawLines.length === 0) warn("lines", "EMPTY_LINES", "语音索引没有台词；事件列表为空");
    }

    const lines = [];
    if (rawLines) {
      const seenIds = Object.create(null);
      for (let i = 0; i < rawLines.length; i++) {
        const line = validateLine(rawLines[i], i, bad, warn);
        if (!line) continue;
        if (typeof line.id === "string") {
          if (seenIds[line.id]) bad("lines[" + i + "].id", "DUPLICATE_ID", "台词 id 重复：" + line.id);
          seenIds[line.id] = true;
        }
        lines.push(line);
      }
    }

    /* line_count 与实际不符：警告，保留数据 */
    if (lineCount !== null && rawLines && lineCount !== rawLines.length) {
      warn(
        "line_count",
        "LINE_COUNT_MISMATCH",
        "line_count=" + lineCount + " 与实际 lines.length=" + rawLines.length + " 不一致"
      );
    }

    const events = groupEvents(lines);
    for (const ev of events) {
      if (ev.categories.length > 1) {
        warn(
          "lines[" + ev.lines[0].index + "].category",
          "MIXED_CATEGORY",
          "同一事件 " + ev.event + " 下出现多个分类：" + ev.categories.join(" / ")
        );
      }
    }

    if (fatal) return issuesResult(issues);

    return success(
      {
        meta: {
          characterId: input.character_id,
          characterName: input.character_name,
          language: input.language,
          voiceProfile: input.voice_profile,
          usage: input.usage,
          audioFormat: input.audio_format,
          lineCount: lineCount,
          notes: notes,
        },
        lines: lines,
        events: events,
      },
      issues
    );
  }

  /** 单行校验；返回规范化 Line，或 null（已记录硬错误） */
  function validateLine(raw, index, bad, warn) {
    const path = "lines[" + index + "]";
    if (!isPlainObject(raw)) {
      bad(path, "NOT_OBJECT", "台词必须是 JSON 对象");
      return null;
    }
    for (const k of Object.keys(raw)) {
      if (!LINE_FIELDS[k]) warn(path + "." + k, "UNKNOWN_FIELD", "台词包含未知字段：" + k);
    }

    const line = { index: index, id: null, category: null, event: null, text: null, emotion: "", delivery: "", audioFile: null, autoPlay: false, animation: null };

    /* 必填字符串：id / category / event / text / audio_file / animation */
    const strings = [
      ["id", "id"],
      ["category", "category"],
      ["event", "event"],
      ["text", "text"],
      ["audio_file", "audio_file"],
      ["animation", "animation"],
    ];
    let missing = false;
    for (const pair of strings) {
      const key = pair[0];
      if (!Object.prototype.hasOwnProperty.call(raw, key) || raw[key] === undefined || raw[key] === null) {
        bad(path + "." + key, "MISSING_FIELD", "台词缺少 " + key);
        missing = true;
      } else if (typeof raw[key] !== "string") {
        bad(path + "." + key, "INVALID_TYPE", key + " 必须是字符串");
        missing = true;
      }
    }
    if (missing) return null;

    line.id = raw.id;
    line.category = raw.category;
    line.event = raw.event;
    line.text = raw.text;
    line.audioFile = raw.audio_file;
    line.animation = raw.animation;

    if (line.text === "") warn(path + ".text", "EMPTY_TEXT", "text 是空字符串（允许载入，界面提示）");

    /* category / event 语义检查：警告 */
    if (CATEGORIES.indexOf(line.category) < 0) {
      warn(path + ".category", "UNKNOWN_CATEGORY", "未知分类：" + show(line.category) + "；应为 " + CATEGORIES.join(" / "));
    }
    if (!EVENT_RE.test(line.event)) {
      warn(path + ".event", "INVALID_EVENT", "event 不符合 ^[a-z0-9][a-z0-9_-]{0,63}$：" + show(line.event));
    }
    if (line.id.indexOf(line.event + "_") !== 0) {
      warn(path + ".id", "ID_PREFIX", "id 应以 <event>_ 开头：" + show(line.id) + "（event=" + show(line.event) + "）");
    }

    /* audio_file：路径安全是硬错误；命名/扩展名是警告 */
    const unsafe = pathIssue(line.audioFile, path + ".audio_file", "audio_file");
    if (unsafe) {
      bad(unsafe.path, unsafe.code === "UNSAFE_PATH" ? "UNSAFE_PATH" : unsafe.code, unsafe.message);
      line.audioFile = null;
    } else {
      const stem = "voice/" + line.event + "/" + line.id;
      let shapeOk = false;
      if (line.audioFile.indexOf(stem + ".") === 0) {
        const ext = line.audioFile.slice(stem.length + 1);
        shapeOk = /^[A-Za-z0-9]+$/.test(ext);
        if (shapeOk && ext !== "ogg") {
          warn(path + ".audio_file", "BAD_AUDIO_EXT", "audio_file 扩展名应为 .ogg：" + show(line.audioFile));
        }
      }
      if (!shapeOk) {
        warn(path + ".audio_file", "AUDIO_PATH_SHAPE", "audio_file 应为 voice/<event>/<id>.<ext>：" + show(line.audioFile));
      }
    }

    /* 可选字段：auto_play / emotion / delivery，类型不对只警告 */
    if (Object.prototype.hasOwnProperty.call(raw, "auto_play") && raw.auto_play !== undefined) {
      if (typeof raw.auto_play !== "boolean") {
        warn(path + ".auto_play", "INVALID_AUTO_PLAY", "auto_play 必须是布尔值：" + show(raw.auto_play));
      } else {
        line.autoPlay = raw.auto_play;
      }
    }
    if (Object.prototype.hasOwnProperty.call(raw, "emotion") && raw.emotion !== undefined) {
      if (typeof raw.emotion !== "string") {
        warn(path + ".emotion", "INVALID_EMOTION", "emotion 必须是字符串：" + show(raw.emotion));
      } else {
        line.emotion = raw.emotion;
      }
    }
    if (Object.prototype.hasOwnProperty.call(raw, "delivery") && raw.delivery !== undefined) {
      if (typeof raw.delivery !== "string") {
        warn(path + ".delivery", "INVALID_DELIVERY", "delivery 必须是字符串：" + show(raw.delivery));
      } else {
        line.delivery = raw.delivery;
      }
    }

    return line;
  }

  /** 严格解析索引文本：拒绝非文本 / 超限 / 非法 JSON，不做宽松修复 */
  function parseIndexText(text) {
    if (typeof text !== "string") return failure("NOT_TEXT", "语音索引内容必须是 UTF-8 文本", "");
    const bytes = utf8ByteLength(text);
    if (bytes > LIMITS.indexBytes) {
      return failure(
        "INDEX_TOO_LARGE",
        "语音索引超过上限（最多 " + LIMITS.indexBytes + " 字节，实际 " + bytes + " 字节）",
        ""
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return failure("INVALID_JSON", "语音索引不是合法 JSON：" + (e && e.message ? e.message : String(e)), "");
    }
    return validateIndex(parsed);
  }

  /* ==========================================================================
   * 3. 事件分组与摘要（契约 §1.1）
   *
   * 事件顺序 = 首次出现顺序；Event.lines 与入参 Line 同引用、保持索引顺序。
   * ====================================================================== */
  function groupEvents(lines) {
    if (!Array.isArray(lines)) return [];
    const events = [];
    const byEvent = Object.create(null);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || typeof line !== "object") continue;
      const key = String(line.event == null ? "" : line.event);
      let ev = byEvent[key];
      if (!ev) {
        ev = {
          event: key,
          category: line.category,
          categories: [],
          lineCount: 0,
          lineIds: [],
          animations: [],
          lines: [],
        };
        byEvent[key] = ev;
        events.push(ev);
      }
      ev.lines.push(line);
      ev.lineCount++;
      ev.lineIds.push(line.id);
      if (ev.categories.indexOf(line.category) < 0) ev.categories.push(line.category);
      if (ev.animations.indexOf(line.animation) < 0) ev.animations.push(line.animation);
    }
    return events;
  }

  function summarize(events) {
    const out = {
      eventCount: 0,
      lineCount: 0,
      missingAudio: 0,
      missingAnimation: 0,
      unknownAudio: 0,
      unknownAnimation: 0,
      missingAudioFiles: [],
      missingAnimationTags: [],
      okEvents: 0,
      issueEvents: 0,
    };
    if (!Array.isArray(events)) return out;
    for (const ev of events) {
      out.eventCount++;
      const evLines = Array.isArray(ev.lines) ? ev.lines : [];
      out.lineCount += evLines.length;
      for (const line of evLines) {
        if (line.audioStatus === "missing") {
          out.missingAudio++;
          if (out.missingAudioFiles.indexOf(line.audioFile) < 0) out.missingAudioFiles.push(line.audioFile);
        } else if (line.audioStatus === "checking" || line.audioStatus === "unknown" || line.audioStatus === "unresolved") {
          out.unknownAudio++;
        }
        if (line.animationStatus === "missing") {
          out.missingAnimation++;
          if (out.missingAnimationTags.indexOf(line.animation) < 0) out.missingAnimationTags.push(line.animation);
        } else if (line.animationStatus === "unknown") {
          out.unknownAnimation++;
        }
      }
      if (ev.status === "ok") out.okEvents++;
      if (ev.hasIssues === true) out.issueEvents++;
    }
    return out;
  }

  /* ==========================================================================
   * 4. 资源存在性评估（契约 §1.1 / §2.4）
   *
   * 纯函数：输入由 app 采集（模型动画名、HEAD/GET 检查结果、packRoot）。
   * opts = { animations, audio, packRoot, animationAliases }：
   *   animationAliases 是可选的显式「语义标签 → 实际动画名」映射；不读 manifest，
   *   不内置默认别名。没有别名时按精确同名匹配，并把语义标签报告为「未映射」。
   * 不修改入参：每条 Line 复制成新对象后再附加 audioStatus / animationStatus。
   * ====================================================================== */
  function animationListText(animations) {
    if (!animations.length) return "无";
    const head = animations.slice(0, 8).join(" / ");
    return animations.length > 8 ? head + " / …" : head;
  }

  /**
   * lines[].animation 是语义标签（greeting / happy / working…），模型里通常只有
   * idle / working / attention / done / failed / turn。默认精确同名匹配；不猜映射。
   * 唯一例外是调用方显式给出的 opts.animationAliases（语义标签 → 实际动画名）。
   */
  function aliasTarget(aliases, label) {
    if (!aliases || typeof label !== "string") return null;
    if (!Object.prototype.hasOwnProperty.call(aliases, label)) return null;
    const target = aliases[label];
    return typeof target === "string" && target ? target : null;
  }

  function audioDetailFor(status, line, resolved) {
    if (status === "ok") return "语音就绪：" + (resolved ? resolved.path : line.audioFile);
    if (status === "missing") return "语音缺失：" + line.audioFile + "（HTTP 404）";
    if (status === "checking") return "检查中…：" + line.audioFile;
    if (status === "unknown") return "未检查语音存在性：" + line.audioFile;
    return "未解析语音路径：" + line.audioFile;
  }

  function evaluate(voice, opts) {
    const o = opts || {};
    if (!voice || !Array.isArray(voice.lines)) {
      return failure("INVALID_VOICE", "evaluate 需要 validateIndex 的 value（含 lines 数组）", "lines");
    }
    const issues = [];

    let packRoot = typeof o.packRoot === "string" ? stripTrailingSlashes(o.packRoot) : null;
    let packRootOk = false;
    let packRootError = "";
    if (!packRoot) {
      packRoot = null;
    } else {
      const bad = pathIssue(packRoot, "packRoot", "packRoot");
      if (bad) {
        packRootError = bad.message;
        issues.push(issue("packRoot", "INVALID_PACK_ROOT", bad.message));
      } else {
        packRootOk = true;
      }
    }

    const animations = Array.isArray(o.animations) ? o.animations.slice() : null;
    const audioMap = isPlainObject(o.audio) ? o.audio : null;
    const aliases = isPlainObject(o.animationAliases) ? o.animationAliases : null;

    const lines = voice.lines.map(function (line) {
      /* 新建对象，不修改入参（Line 是扁平对象） */
      const l = {};
      if (line && typeof line === "object") {
        for (const k of Object.keys(line)) l[k] = line[k];
      }

      const resolved = packRootOk ? resolveAudioPath(packRoot, l.audioFile) : null;
      const resolvedValue = resolved && resolved.ok ? resolved.value : null;

      const mapValue =
        audioMap && Object.prototype.hasOwnProperty.call(audioMap, l.audioFile) ? audioMap[l.audioFile] : null;

      let audioStatus;
      let audioDetail;
      if (AUDIO_STATUSES.indexOf(mapValue) >= 0) {
        audioStatus = mapValue;
        audioDetail = audioDetailFor(audioStatus, l, resolvedValue);
      } else if (!packRoot) {
        audioStatus = "unresolved";
        audioDetail = "未载入语音包，无法解析语音路径：" + l.audioFile;
      } else if (!packRootOk) {
        audioStatus = "unresolved";
        audioDetail = "语音包目录不可用：" + packRootError;
      } else if (!resolved || !resolved.ok) {
        audioStatus = "unresolved";
        audioDetail = "语音路径不可用：" + (resolved && resolved.issues[0] ? resolved.issues[0].message : "未知原因");
      } else if (audioMap) {
        audioStatus = "unknown";
        audioDetail = "未检查语音存在性（检查结果缺失）：" + l.audioFile;
      } else {
        audioStatus = "unknown";
        audioDetail = "未检查语音存在性：" + l.audioFile;
      }
      l.audioStatus = audioStatus;
      l.audioDetail = audioDetail;

      if (animations === null) {
        l.animationStatus = "unknown";
        l.animationDetail = "未载入角色模型，动画存在性未检查";
      } else {
        const target = aliasTarget(aliases, l.animation);
        if (target) {
          if (animations.indexOf(target) >= 0) {
            l.animationStatus = "ok";
            l.animationDetail = "动画映射：" + l.animation + " → " + target + "（模型存在）";
          } else {
            l.animationStatus = "missing";
            l.animationDetail =
              "动画未映射：" + l.animation + "（映射到 " + target + "，但模型无 " + target + "）";
          }
        } else if (animations.indexOf(l.animation) >= 0) {
          l.animationStatus = "ok";
          l.animationDetail = "动画存在：" + l.animation;
        } else {
          l.animationStatus = "missing";
          l.animationDetail =
            "动画未映射：" +
            l.animation +
            "（模型无同名动画，需补语义→实际动画映射；模型动画：" +
            animationListText(animations) +
            "）";
        }
      }

      return l;
    });

    const events = groupEvents(lines);
    for (const ev of events) {
      const evLines = ev.lines;
      ev.missingAudio = evLines.some(function (l) {
        return l.audioStatus === "missing";
      });
      ev.missingAnimation = evLines.some(function (l) {
        return l.animationStatus === "missing";
      });
      ev.unknownAudio = evLines.some(function (l) {
        return l.audioStatus === "checking" || l.audioStatus === "unknown" || l.audioStatus === "unresolved";
      });
      ev.unknownAnimation = evLines.some(function (l) {
        return l.animationStatus === "unknown";
      });
      ev.hasIssues = evLines.some(function (l) {
        return (
          l.audioStatus === "missing" ||
          l.audioStatus === "unknown" ||
          l.audioStatus === "unresolved" ||
          l.animationStatus === "missing" ||
          l.animationStatus === "unknown"
        );
      });
      ev.status = ev.missingAudio
        ? "error"
        : ev.missingAnimation
        ? "warn"
        : ev.unknownAudio || ev.unknownAnimation
        ? "unknown"
        : "ok";

      if (ev.categories.length > 1) {
        issues.push(
          issue(
            "lines[" + ev.lines[0].index + "].category",
            "MIXED_CATEGORY",
            "同一事件 " + ev.event + " 下出现多个分类：" + ev.categories.join(" / ")
          )
        );
      }
    }

    return success({ events: events, summary: summarize(events) }, issues);
  }

  /* ==========================================================================
   * 5. 路径解析 / 自动发现（契约 §1.3）
   * ====================================================================== */
  function resolveAudioPath(packRoot, audioFile) {
    const root = stripTrailingSlashes(packRoot);
    if (typeof root !== "string" || !root) {
      /* 手动选择索引（没有 packRoot）时不猜路径，由调用方显式给出包根 */
      return {
        ok: false,
        issues: [issue("packRoot", "PACK_ROOT_MISSING", "未提供语音包目录（packRoot），无法解析语音路径")],
      };
    }
    const rootIssue = pathIssue(root, "packRoot", "packRoot");
    if (rootIssue) return { ok: false, issues: [issue("packRoot", "UNSAFE_PATH", rootIssue.message)] };
    const fileIssue = pathIssue(audioFile, "audioFile", "audioFile");
    if (fileIssue) return { ok: false, issues: [issue("audioFile", "UNSAFE_PATH", fileIssue.message)] };
    const path = root + "/" + audioFile;
    return success({ path: path, url: "/" + path });
  }

  /**
   * 自动探测候选：base 本身 + 最多 maxDepth 级祖先（默认 3）→ 最多 4 个。
   * 契约 §1.3 示例（base 4 段、默认 3）：
   *   assets/characters/deepseek/spine → deepseek → characters → assets。
   * 不含空 base / 根路径；含非法段的候选直接跳过（不影响更上层候选）。
   */
  function voiceIndexCandidates(base, maxDepth) {
    const out = [];
    const b = stripTrailingSlashes(base);
    if (typeof b !== "string" || !b) return out;
    let levels = 3;
    if (maxDepth !== undefined && maxDepth !== null) {
      if (typeof maxDepth === "number" && isFinite(maxDepth) && maxDepth >= 0) levels = Math.floor(maxDepth);
    }
    const parts = b.split("/");
    for (let up = 0; up <= levels && up < parts.length; up++) {
      const packRoot = parts.slice(0, parts.length - up).join("/");
      if (!packRoot) continue;
      if (pathIssue(packRoot, "base", "base")) continue;
      out.push({ packRoot: packRoot, indexPath: packRoot + "/voice/index.json" });
    }
    return out;
  }

  function derivePackRoot(voiceIndexPath) {
    if (typeof voiceIndexPath !== "string") return null;
    const p = stripTrailingSlashes(voiceIndexPath);
    const suffix = "/voice/index.json";
    if (p.length <= suffix.length || p.slice(-suffix.length) !== suffix) return null;
    const root = p.slice(0, p.length - suffix.length);
    if (!root || pathIssue(root, "packRoot", "packRoot")) return null;
    return root;
  }

  /* ==========================================================================
   * 导出
   * ====================================================================== */
  const api = {
    API_VERSION: API_VERSION,
    CATEGORIES: CATEGORIES,
    LIMITS: LIMITS,

    parseIndexText: parseIndexText,
    validateIndex: validateIndex,
    groupEvents: groupEvents,
    summarize: summarize,
    evaluate: evaluate,

    resolveAudioPath: resolveAudioPath,
    voiceIndexCandidates: voiceIndexCandidates,
    derivePackRoot: derivePackRoot,
  };

  global.SpineVoice = api;
  if (typeof window !== "undefined" && window.SpineVoice !== api) window.SpineVoice = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
