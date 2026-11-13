/*
 * bundle.js —— 索引（index.json v1）校验 + 整包 ZIP(store) 构建 · 纯模块
 *
 * 边界（契约 §0 / §5.3）：
 *   本文件不碰 DOM / Image / Canvas / Blob / URL / fetch / 磁盘 IO。
 *   只接收普通对象、字符串、Uint8Array，返回 {ok, value|issues} 风格的既有风格结果。
 *   浏览器暴露 window.SpineBundle；Node 里是 globalThis.SpineBundle（selftest 复用）。
 *
 * 消费方：
 *   - index.html / app.js：索引解析、路径定位、贴图页对齐、模型补丁、整包清单、ZIP 字节；
 *   - selftest.html / selftest.js：纯函数断言。
 */
(function (global) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const API_VERSION = 1;

  /* 契约 §1 / §3.2 / §4.4 的硬上限 */
  const LIMITS = {
    indexBytes: 64 * 1024,
    modelBytes: 8 * 1024 * 1024,
    atlasBytes: 2 * 1024 * 1024,
    textureBytes: 8 * 1024 * 1024,
    maxTextures: 16,
    maxEntries: 19,
    totalInputBytes: 48 * 1024 * 1024,
    zipBytes: 64 * 1024 * 1024,
    maxBodyBytes: 64 * 1024 * 1024,
    baseChars: 1024,
    labelChars: 120,
    filenameChars: 128,
  };

  const PATCH_FIELDS = ["x", "y", "rotation", "scaleX", "scaleY"];
  const FIELD_DEFAULTS = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

  /* ==========================================================================
   * 0. 结果与小工具
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

  /** 深度克隆；structuredClone 不可用（老 Node）时退回 JSON 往返 */
  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function utf8Bytes(text) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(String(text));
    /* 极老环境的兜底：仅 ASCII + UTF-8 手动编码 */
    const s = unescape(encodeURIComponent(String(text)));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /* ==========================================================================
   * 1. 路径文法（契约 §1 路径文法 1/2/3）
   * ====================================================================== */
  const BASENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  /** 单个文件名（basename）校验；返回 issue 或 null */
  function filenameIssue(name, path) {
    const p = path || "name";
    if (typeof name !== "string" || !name) return issue(p, "INVALID_NAME", "文件名必须是非空字符串");
    if (name.length > LIMITS.filenameChars) {
      return issue(p, "INVALID_NAME", "文件名过长（最多 " + LIMITS.filenameChars + " 字符）：" + name.slice(0, 32) + "…");
    }
    if (!BASENAME_RE.test(name)) {
      return issue(p, "INVALID_NAME", "文件名只允许 ASCII 字母、数字与 . _ -，且必须以字母或数字开头：" + name);
    }
    if (name === "." || name === "..") return issue(p, "INVALID_NAME", "文件名不能是 . 或 ..");
    if (name.indexOf("..") >= 0) return issue(p, "INVALID_NAME", "文件名不能包含连续 ..：" + name);
    if (name.endsWith(".")) return issue(p, "INVALID_NAME", "文件名不能以点结尾：" + name);
    const stem = name.replace(/\.[^.]*$/, "");
    if (RESERVED_RE.test(stem)) return issue(p, "INVALID_NAME", "文件名是 Windows 保留设备名：" + name);
    return null;
  }

  /** 目录段校验：与文件名同文法（不要求扩展名） */
  function dirSegmentIssue(seg, path) {
    const p = path || "base";
    if (!seg) return issue(p, "INVALID_BASE", "base 不能有空目录段");
    if (seg === "." || seg === "..") return issue(p, "INVALID_BASE", "base 不能包含 . 或 .. 段");
    if (!BASENAME_RE.test(seg)) {
      return issue(p, "INVALID_BASE", "base 段只允许 ASCII 字母、数字与 . _ -：" + seg);
    }
    if (seg.endsWith(".")) return issue(p, "INVALID_BASE", "base 段不能以点结尾：" + seg);
    if (seg.indexOf("..") >= 0) return issue(p, "INVALID_BASE", "base 段不能包含连续 ..：" + seg);
    if (RESERVED_RE.test(seg)) return issue(p, "INVALID_BASE", "base 段是 Windows 保留设备名：" + seg);
    return null;
  }

  /**
   * base：仓库根相对目录，1..1024 字符，/ 连接，不允许空段/前后斜杠/`.`/`..`/`//`/反斜杠/协议/盘符/查询
   * @returns {{ok:boolean, value?:string}}  value 为原字符串（不 normalize）
   */
  function validateBase(base, path) {
    const p = path || "base";
    if (typeof base !== "string" || !base) return failure("INVALID_BASE", "base 必须是非空字符串", p);
    if (base.length > LIMITS.baseChars) return failure("INVALID_BASE", "base 过长（最多 " + LIMITS.baseChars + " 字符）", p);
    if (base.startsWith("/") || base.endsWith("/")) return failure("INVALID_BASE", "base 不能以 / 开头或结尾：" + base, p);
    if (base.indexOf("//") >= 0) return failure("INVALID_BASE", "base 不能包含空目录段（//）：" + base, p);
    if (base.indexOf("\\") >= 0) return failure("INVALID_BASE", "base 不能包含反斜杠：" + base, p);
    if (/[:%?#]/.test(base)) return failure("INVALID_BASE", "base 不能包含 : % ? # 或协议/盘符：" + base, p);
    const segs = base.split("/");
    for (let i = 0; i < segs.length; i++) {
      const bad = dirSegmentIssue(segs[i], p + "[" + i + "]");
      if (bad) return { ok: false, issues: [bad] };
    }
    return success(base);
  }

  function validateFilename(name, path) {
    const bad = filenameIssue(name, path);
    return bad ? { ok: false, issues: [bad] } : success(name);
  }

  function extensionIssue(name, ext, path, what) {
    if (typeof name !== "string") return issue(path, "INVALID_NAME", (what || "文件名") + "必须是字符串");
    if (!name.toLowerCase().endsWith(ext)) {
      return issue(path, "INVALID_EXT", (what || "文件名") + "必须以小写 " + ext + " 结尾：" + name);
    }
    if (!name.endsWith(ext)) {
      return issue(path, "INVALID_EXT", (what || "文件名") + "的扩展名必须是小写 " + ext + "：" + name);
    }
    return null;
  }

  /* ==========================================================================
   * 2. 索引校验（契约 §1 schema）
   * ====================================================================== */
  const INDEX_FIELDS = { schemaVersion: 1, base: 1, label: 1, files: 1 };
  const FILE_FIELDS = { model: 1, atlas: 1, textures: 1 };
  /* v3：spine/index.json schemaVersion 2 追加的文件槽位（§5.2） */
  const FILE_FIELDS_V2 = { model: 1, atlas: 1, textures: 1, rigMeta: 1, idleProfile: 1, lipsync: 1 };
  const SUPPORTED_SCHEMA_VERSIONS = [1, 2];

  /* ===== v3.2：manifest.json 是包根唯一入口，spine/index.json 已废除 ===== */
  const MANIFEST_SCHEMA_VERSION = 2;
  /** 入口文件 basename 白名单（其他 .json 一律拒绝，含 model.json） */
  const ENTRY_NAMES = ["manifest.json", "index.json"];
  const MANIFEST_NAME = "manifest.json";
  const INDEX_NAME = "index.json";        // 旧版入口名（buildLocalTree 需要）
  /** manifest.spine 的路径槽位（六项平铺） */
  const SPINE_FIELDS = { model: 1, atlas: 1, textures: 1, rigMeta: 1, idleProfile: 1, lipsync: 1 };
  /** v3.2 必填的 manifest 字段 */
  const MANIFEST_REQUIRED = [
    "packFormatVersion", "manifestSchemaVersion", "id", "version",
    "displayName", "render", "spine", "catalog", "events", "license", "credits",
  ];
  const OLD_FORMAT_CODE = "OLD_FORMAT_PACK";
  const OLD_FORMAT_MSG =
    "该包为旧格式（v3.1 及更早）：spine/index.json 已废除，本版只认包根 manifest.json；" +
    "请用 compile_pack.py 重新编译";

  /* ==========================================================================
   * 2.1 「载入路径」入参规范化（纯函数，Node 可测；app.js 只负责读输入框）
   * ====================================================================== */

  /**
   * 把用户输入的路径规范成「可交给 loadIndexByPath 的入口路径」。
   *
   * 接受： workspace/packs/deepseek
   *        workspace/packs/deepseek/
   *        workspace/packs/deepseek/manifest.json
   *        workspace/packs/deepseek/index.json（旧包）
   *        ?index=workspace/packs/deepseek（带参数前缀，剥掉）
   *        整条 URL 里含 ?index=（剥掉查询串）
   * 拒绝： 空、以 / 开头、反斜杠、含 ..、file: 本地地址、其它带协议的地址、非入口的 .json
   *
   * @param {string} raw 用户原始输入
   * @returns {{ok:true, value:string} | {ok:false, reason:string}}
   */
  function normalizePackPath(raw) {
    let s = String(raw == null ? "" : raw).trim();
    if (!s) return { ok: false, reason: "请输入仓库相对路径" };
    /* 允许直接粘整条 URL 的 ?index= 部分 */
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(s) || s.startsWith("//")) {
      const m = /[?&]index=([^&#]+)/.exec(s);
      if (m) s = decodeURIComponent(m[1]);
      else if (/^file:/i.test(s)) {
        return { ok: false, reason: "这是本地文件地址，无法由服务端读取；请使用「选包目录」" };
      } else return { ok: false, reason: "只支持仓库相对路径，不接受带协议的地址" };
    }
    if (s.startsWith("/")) return { ok: false, reason: "不能以 / 开头（那是站点根，不是仓库相对路径）" };
    if (s.indexOf("\\") >= 0) return { ok: false, reason: "请用正斜杠 / ，不要用反斜杠 \\" };
    if (s.indexOf("..") >= 0) return { ok: false, reason: "路径不能包含 .." };
    if (s.indexOf("//") >= 0) s = s.replace(/\/+/g, "/");
    s = s.replace(/[?#].*$/, "");
    s = s.replace(/^\.\//, "");
    /* 去尾斜杠 */
    s = s.replace(/\/+$/, "");
    if (!s) return { ok: false, reason: "请输入仓库相对路径" };
    const base = s.replace(/\/+$/, "").split("/").pop();
    if (base === MANIFEST_NAME || base === INDEX_NAME) return { ok: true, value: s };
    if (base.endsWith(".json")) {
      return { ok: false, reason: "只接受 manifest.json（v3.2）或 index.json（旧）作为入口文件" };
    }
    /* 目录 → 默认 v3.2 的 manifest.json */
    return { ok: true, value: s + "/" + MANIFEST_NAME };
  }

  /** 形态探测：manifest 入口 */
  function looksLikeManifest(o) {
    if (!isPlainObject(o)) return false;
    return "manifestSchemaVersion" in o || "packFormatVersion" in o ||
      ("spine" in o && "render" in o && !("files" in o));
  }

  /** 形态探测：旧版 spine/index.json（schemaVersion + files） */
  function looksLikeLegacyIndex(o) {
    if (!isPlainObject(o)) return false;
    return "schemaVersion" in o && "files" in o;
  }

  /**
   * @param {object} input 解析后的索引对象
   * @param {{requireBase?:boolean}} [opts] picker 入口 requireBase=true（默认）；URL 入口可省略
   */
  function validateIndex(input, opts) {
    const o = opts || {};
    const requireBase = o.requireBase !== false;
    const issues = [];

    if (!isPlainObject(input)) return failure("NOT_OBJECT", "索引内容必须是 JSON 对象", "");

    for (const k of Object.keys(input)) {
      if (!INDEX_FIELDS[k]) issues.push(issue(k, "UNKNOWN_FIELD", "索引包含未知字段：" + k));
    }

    /* schemaVersion：严格整数，支持 1（旧）与 2（v3 包） */
    let schemaVersion = null;
    if (!("schemaVersion" in input)) {
      issues.push(issue("schemaVersion", "MISSING_FIELD", "索引缺少 schemaVersion"));
    } else if (
      typeof input.schemaVersion !== "number" ||
      !Number.isInteger(input.schemaVersion) ||
      SUPPORTED_SCHEMA_VERSIONS.indexOf(input.schemaVersion) < 0
    ) {
      issues.push(
        issue(
          "schemaVersion",
          "BAD_VERSION",
          "不支持的索引版本：" + show(input.schemaVersion) +
            "；当前支持 schemaVersion=" + SUPPORTED_SCHEMA_VERSIONS.join(" / ")
        )
      );
    } else {
      schemaVersion = input.schemaVersion;
    }
    const isV3 = schemaVersion === 2;

    /* base：
       - schemaVersion 2（v3）：**禁止出现**，包根由加载器从 index.json 的 URL 反推（§5.2）
       - schemaVersion 1（旧）：picker 必填，URL 可省略 */
    let base = null;
    const hasBase = "base" in input && input.base !== undefined && input.base !== null;
    if (isV3) {
      if (hasBase) {
        issues.push(
          issue("base", "UNEXPECTED_BASE", "schemaVersion 2 的索引不得再声明 base（v3 路径相对包根）")
        );
      }
    } else if (!hasBase) {
      if (requireBase) {
        issues.push(
          issue(
            "base",
            "MISSING_BASE",
            "这个索引未声明 base，浏览器无法知道所选文件所在目录。请在索引填写仓库相对 base，或使用 ?index= 打开。"
          )
        );
      }
    } else {
      const b = validateBase(input.base, "base");
      if (!b.ok) issues.push.apply(issues, b.issues);
      else base = b.value;
    }

    /* label：可选，1..120 字符 */
    let label = null;
    if (input.label !== undefined && input.label !== null) {
      if (typeof input.label !== "string") issues.push(issue("label", "INVALID_LABEL", "label 必须是字符串"));
      else if (input.label.length < 1 || input.label.length > LIMITS.labelChars) {
        issues.push(issue("label", "INVALID_LABEL", "label 长度必须在 1.." + LIMITS.labelChars + " 字符之间"));
      } else label = input.label;
    }

    /* files */
    let files = null;
    if (!isPlainObject(input.files)) {
      issues.push(issue("files", "MISSING_FIELD", "索引缺少 files 对象"));
    } else {
      const f = input.files;
      const allowedFiles = isV3 ? FILE_FIELDS_V2 : FILE_FIELDS;
      for (const k of Object.keys(f)) {
        if (!allowedFiles[k]) issues.push(issue("files." + k, "UNKNOWN_FIELD", "files 包含未知字段：" + k));
      }

      const model = f.model;
      const atlas = f.atlas;
      const textures = f.textures;

      /* v3（schemaVersion 2）：files 值是**包根相对路径**（可含 /），用路径校验；
         旧版（schemaVersion 1）：files 值是裸文件名。 */
      function relPathIssue(rel, path, ext, label) {
        if (typeof rel !== "string" || !rel) {
          return issue(path, "MISSING_FIELD", "索引缺少 " + path + "（" + label + "）");
        }
        if (rel.indexOf("\\") >= 0) return issue(path, "INVALID_PATH", path + " 不能含反斜杠：" + rel);
        if (rel.charAt(0) === "/" || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rel)) {
          return issue(path, "INVALID_PATH", path + " 必须是包根相对路径：" + rel);
        }
        if (rel.indexOf("..") >= 0) return issue(path, "INVALID_PATH", path + " 不能含 ..：" + rel);
        if (ext && !rel.toLowerCase().endsWith(ext)) {
          return issue(path, "INVALID_EXT", path + " 扩展名应为 " + ext + "：" + rel);
        }
        return null;
      }

      if (isV3) {
        const badModel = relPathIssue(model, "files.model", ".json", "模型路径");
        if (badModel) issues.push(badModel);
        const badAtlas = relPathIssue(atlas, "files.atlas", ".atlas", "图集路径");
        if (badAtlas) issues.push(badAtlas);
      } else {
        if (typeof model !== "string") {
          issues.push(issue("files.model", "MISSING_FIELD", "索引缺少 files.model（模型 JSON 文件名）"));
        } else {
          const bad = filenameIssue(model, "files.model") || extensionIssue(model, ".json", "files.model", "模型文件名");
          if (bad) issues.push(bad);
          else if (model === "index.json") issues.push(issue("files.model", "INVALID_NAME", "files.model 不能是 index.json"));
        }

        if (typeof atlas !== "string") {
          issues.push(issue("files.atlas", "MISSING_FIELD", "索引缺少 files.atlas（图集文件名）"));
        } else {
          const bad = filenameIssue(atlas, "files.atlas") || extensionIssue(atlas, ".atlas", "files.atlas", "图集文件名");
          if (bad) issues.push(bad);
        }
      }

      let texOut = null;
      if (!Array.isArray(textures)) {
        issues.push(issue("files.textures", "MISSING_FIELD", "索引缺少 files.textures（贴图文件名数组）"));
      } else if (textures.length < 1 || textures.length > LIMITS.maxTextures) {
        issues.push(
          issue("files.textures", "INVALID_TEXTURES", "贴图数量必须在 1.." + LIMITS.maxTextures + " 之间，实际 " + textures.length)
        );
      } else {
        texOut = [];
        const seen = Object.create(null);
        for (let i = 0; i < textures.length; i++) {
          const t = textures[i];
          const texPath = "files.textures[" + i + "]";
          let bad;
          if (isV3) {
            bad = relPathIssue(t, texPath, null, "贴图路径");
            if (!bad && typeof t === "string" && !t.toLowerCase().endsWith(".png") && !t.toLowerCase().endsWith(".webp")) {
              bad = issue(texPath, "INVALID_EXT", "贴图必须是 .png 或 .webp（小写扩展名）：" + t);
            }
          } else {
            bad =
              filenameIssue(t, texPath) ||
              (typeof t === "string" && !t.endsWith(".png") && !t.endsWith(".webp")
                ? issue(texPath, "INVALID_EXT", "贴图必须是 .png 或 .webp（小写扩展名）：" + t)
                : null);
          }
          if (bad) {
            issues.push(bad);
            continue;
          }
          const key = t.toLowerCase();
          if (seen[key]) issues.push(issue("files.textures[" + i + "]", "DUPLICATE_NAME", "贴图文件名重复（不区分大小写）：" + t));
          seen[key] = true;
          texOut.push(t);
        }
      }

      /* 目标名彼此不同 + casefold 冲突（契约 §1 第 3 条） */
      if (typeof model === "string" && typeof atlas === "string" && texOut) {
        const all = [{ n: "index.json", p: "indexName" }, { n: model, p: "files.model" }, { n: atlas, p: "files.atlas" }].concat(
          texOut.map((t, i) => ({ n: t, p: "files.textures[" + i + "]" }))
        );
        const seen = Object.create(null);
        for (const e of all) {
          const key = String(e.n).toLowerCase();
          if (seen[key] !== undefined) {
            issues.push(issue(e.p, "DUPLICATE_TARGET", "文件目标名冲突（不区分大小写）：" + e.n + " 与 " + seen[key]));
          } else seen[key] = e.n;
        }
      }

      if (typeof model === "string" && typeof atlas === "string" && texOut) {
        files = { model: model, atlas: atlas, textures: texOut.slice() };
        /* v3：把 rigMeta / idleProfile / lipsync 一并带出，供加载器定位 */
        if (isV3) {
          for (const extra of ["rigMeta", "idleProfile", "lipsync"]) {
            if (typeof f[extra] === "string" && f[extra]) files[extra] = f[extra];
          }
        }
      }
    }

    if (issues.length) return issuesResult(issues);
    /* 关键：输出**实际校验通过**的 schemaVersion，不能用常量 SCHEMA_VERSION（那恒为 1），
       否则下游 resolveIndexLocation 的 v3 分支永远进不去。 */
    const value = { schemaVersion: schemaVersion == null ? SCHEMA_VERSION : schemaVersion };
    if (base) value.base = base;
    if (label) value.label = label;
    value.files = files;
    return success(value);
  }

  /**
   * v3.2 manifest.json 校验（包根唯一入口）。
   *
   * 归一化输出与 validateIndex 同形（含 `files` 投影），因此下游
   * loadIndexEntry / validateTexturePages 几乎不用改；`spine` 原样保留，
   * 需要读 manifest.spine.* 的调用方也能拿到。
   */
  function validateManifest(input, opts) {
    const o = opts || {};
    const issues = [];
    if (!isPlainObject(input)) return failure("NOT_OBJECT", "manifest 内容必须是 JSON 对象", "");

    /* 版本：packFormatVersion === 3 且 manifestSchemaVersion === 2 */
    if (input.packFormatVersion !== 3) {
      const v = input.packFormatVersion;
      return failure(
        typeof v === "number" && v < 3 ? OLD_FORMAT_CODE : "BAD_PACK_FORMAT_VERSION",
        typeof v === "number" && v < 3
          ? OLD_FORMAT_MSG
          : "packFormatVersion 必须是 3，实际 " + show(v),
        "packFormatVersion"
      );
    }
    if (input.manifestSchemaVersion !== MANIFEST_SCHEMA_VERSION) {
      const v = input.manifestSchemaVersion;
      return failure(
        typeof v === "number" && v < MANIFEST_SCHEMA_VERSION ? OLD_FORMAT_CODE : "BAD_MANIFEST_SCHEMA_VERSION",
        typeof v === "number" && v < MANIFEST_SCHEMA_VERSION
          ? OLD_FORMAT_MSG
          : "manifestSchemaVersion 必须是 " + MANIFEST_SCHEMA_VERSION + "，实际 " + show(v),
        "manifestSchemaVersion"
      );
    }

    /* 必填字段存在性 */
    for (const f of MANIFEST_REQUIRED) {
      if (!(f in input) || input[f] === undefined || input[f] === null) {
        issues.push(issue(f, "MISSING_FIELD", "manifest 缺 " + f));
      }
    }

    /* id / version */
    if (typeof input.id !== "string" || !BASENAME_RE.test(input.id)) {
      issues.push(issue("id", "INVALID_ID", "manifest.id 必须是非空标识符：" + show(input.id)));
    }
    if (typeof input.version !== "string" || !/^\d+\.\d+\.\d+/.test(input.version)) {
      issues.push(issue("version", "INVALID_VERSION", "manifest.version 必须是 SemVer：" + show(input.version)));
    }

    /* displayName：{en, zh} 至少一个非空 */
    let label = null;
    const dn = input.displayName;
    if (!isPlainObject(dn)) {
      issues.push(issue("displayName", "INVALID_DISPLAY_NAME", "displayName 必须是对象 {en, zh}"));
    } else {
      const zh = typeof dn.zh === "string" ? dn.zh.trim() : "";
      const en = typeof dn.en === "string" ? dn.en.trim() : "";
      if (!zh && !en) issues.push(issue("displayName", "INVALID_DISPLAY_NAME", "displayName 的 en / zh 至少一个非空"));
      else label = zh || en;
    }

    /* 包根相对路径文法（无绝对 / .. / 反斜杠 / 盘符） */
    function relPath(v, path, ext, required) {
      if (v === undefined || v === null) {
        if (required) issues.push(issue(path, "MISSING_FIELD", "manifest 缺 " + path));
        return null;
      }
      if (typeof v !== "string" || !v) {
        issues.push(issue(path, "INVALID_PATH", path + " 必须是非空字符串"));
        return null;
      }
      if (v.indexOf("\\") >= 0) issues.push(issue(path, "INVALID_PATH", path + " 不能含反斜杠：" + v));
      else if (v.charAt(0) === "/" || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(v)) {
        issues.push(issue(path, "INVALID_PATH", path + " 必须是包根相对路径：" + v));
      } else if (v.split("/").indexOf("..") >= 0) {
        issues.push(issue(path, "INVALID_PATH", path + " 不能含 .. 段：" + v));
      } else if (ext && !v.toLowerCase().endsWith(ext)) {
        issues.push(issue(path, "INVALID_EXT", path + " 扩展名应为 " + ext + "：" + v));
      }
      return v;
    }

    /* render */
    let renderEntry = null;
    if (!isPlainObject(input.render)) {
      issues.push(issue("render", "INVALID_RENDER", "render 必须是对象"));
    } else {
      const r = input.render;
      if (r.type !== "spine") issues.push(issue("render.type", "INVALID_RENDER_TYPE", "render.type 必须是 spine：" + show(r.type)));
      renderEntry = relPath(r.entry, "render.entry", ".json", true);
      if (typeof r.scale !== "number" || !Number.isFinite(r.scale)) {
        issues.push(issue("render.scale", "INVALID_SCALE", "render.scale 必须是数字"));
      }
      if (!Array.isArray(r.anchor) || r.anchor.length !== 2 ||
          !r.anchor.every((n) => typeof n === "number" && Number.isFinite(n))) {
        issues.push(issue("render.anchor", "INVALID_ANCHOR", "render.anchor 必须是两个数字的数组"));
      }
    }

    /* spine：六项平铺 */
    const spine = {};
    if (!isPlainObject(input.spine)) {
      issues.push(issue("spine", "INVALID_SPINE", "spine 必须是对象"));
    } else {
      for (const k of Object.keys(input.spine)) {
        if (!SPINE_FIELDS[k]) issues.push(issue("spine." + k, "UNKNOWN_FIELD", "spine 包含未知字段：" + k));
      }
      spine.model = relPath(input.spine.model, "spine.model", ".json", true);
      spine.atlas = relPath(input.spine.atlas, "spine.atlas", ".atlas", true);
      spine.rigMeta = relPath(input.spine.rigMeta, "spine.rigMeta", ".json", true);
      spine.idleProfile = relPath(input.spine.idleProfile, "spine.idleProfile", ".json", true);
      spine.lipsync = relPath(input.spine.lipsync, "spine.lipsync", ".json", false);

      const tex = input.spine.textures;
      if (!Array.isArray(tex) || tex.length < 1 || tex.length > LIMITS.maxTextures) {
        issues.push(issue("spine.textures", "INVALID_TEXTURES",
          "spine.textures 数量必须在 1.." + LIMITS.maxTextures + " 之间"));
      } else {
        const out = [];
        const seen = Object.create(null);
        for (let i = 0; i < tex.length; i++) {
          const t = tex[i];
          const tp = "spine.textures[" + i + "]";
          const v = relPath(t, tp, null, true);
          if (typeof t === "string" && !t.toLowerCase().endsWith(".png") && !t.toLowerCase().endsWith(".webp")) {
            issues.push(issue(tp, "INVALID_EXT", "贴图必须是 .png 或 .webp（小写扩展名）：" + t));
            continue;
          }
          if (typeof t === "string") {
            const key = t.toLowerCase();
            if (seen[key]) issues.push(issue(tp, "DUPLICATE_NAME", "贴图路径重复（不区分大小写）：" + t));
            seen[key] = true;
          }
          if (v) out.push(v);
        }
        spine.textures = out;
      }
    }

    /* render.entry 必须等于 spine.model */
    if (renderEntry && spine.model && renderEntry !== spine.model) {
      issues.push(issue("render.entry", "ENTRY_MISMATCH",
        "render.entry 必须等于 spine.model：render.entry=" + renderEntry + "，spine.model=" + spine.model));
    }

    /* catalog / events */
    const catalog = relPath(input.catalog, "catalog", ".json", true);
    const events = relPath(input.events, "events", ".json", true);

    /* license / credits */
    if (typeof input.license !== "string" || !input.license.trim()) {
      issues.push(issue("license", "INVALID_LICENSE", "license 必须是非空 SPDX 字符串"));
    }
    if (!Array.isArray(input.credits) || !input.credits.length) {
      issues.push(issue("credits", "INVALID_CREDITS", "credits 必须是非空数组"));
    }

    /* 可选：voice / sequences */
    let voice = null;
    if (isPlainObject(input.voice) && input.voice.index != null) {
      voice = { index: relPath(input.voice.index, "voice.index", ".json", true) };
    }
    let sequences = null;
    if (isPlainObject(input.sequences) && input.sequences.index != null) {
      sequences = { index: relPath(input.sequences.index, "sequences.index", ".json", true) };
    }

    if (issues.length) return issuesResult(issues);

    const value = {
      entryKind: "manifest",
      schemaVersion: 2,                    // 语义同 v3：包根相对；供 spineDir()/packRootDir() 判断
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      id: input.id,
      version: input.version,
      label: label || input.id,
      spine: spine,
      files: {                             // 与 validateIndex 同形的投影，下游免改
        model: spine.model,
        atlas: spine.atlas,
        textures: (spine.textures || []).slice(),
      },
      catalog: catalog,
      events: events,
    };
    if (spine.rigMeta) value.files.rigMeta = spine.rigMeta;
    if (spine.idleProfile) value.files.idleProfile = spine.idleProfile;
    if (spine.lipsync) value.files.lipsync = spine.lipsync;
    if (voice) value.voice = voice;
    if (sequences) value.sequences = sequences;
    if (typeof input.label === "string" && input.label) value.label = input.label;
    value.manifest = input;                // 原始 manifest，供需要额外字段的调用方
    return success(value);
  }

  /** 严格解析索引文本：拒绝 BOM、拒绝非 JSON、不做宽松修复 */
  function parseIndexText(text, opts) {
    if (typeof text !== "string") return failure("NOT_TEXT", "索引内容必须是 UTF-8 文本");
    if (text.length && text.charCodeAt(0) === 0xfeff) {
      return failure("INVALID_ENCODING", "索引必须是 UTF-8 且不带 BOM", "");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return failure("INVALID_JSON", "入口文件不是合法 JSON：" + (e && e.message ? e.message : String(e)), "");
    }
    /* v3.2：先探测 manifest.json 形态 */
    if (looksLikeManifest(parsed)) return validateManifest(parsed, opts);
    /* 旧版 spine/index.json 形态：明确报「旧格式」，不当普通错误吞掉 */
    if (looksLikeLegacyIndex(parsed)) return failure(OLD_FORMAT_CODE, OLD_FORMAT_MSG, "");
    /* 都不是：交给旧校验器给出具体字段错误（保持既有行为，便于定位） */
    return validateIndex(parsed, opts);
  }

  /**
   * 定位索引（契约 §2.2 / §2.3）。
   * @param {object} index 已通过 validateIndex 的规范化索引
   * @param {string|null} observedBase URL 目录（?index= 时给出），picker 传 null
   */
  function resolveIndexLocation(index, observedBase) {
    /* v3.2 manifest 入口：manifest.json 就在包根，base = 它所在目录（包根）。
       picker 拿不到 URL → 无法定位包内其它文件，明确要求用 ?index=。 */
    if (index && index.entryKind === "manifest") {
      if (observedBase == null) {
        return failure(
          "MISSING_BASE",
          "manifest.json 不含 base，需要从 URL 反推包根；请用 ?index=<pack>/manifest.json 打开。",
          "base"
        );
      }
      const bm = validateBase(observedBase, "observedBase");
      if (!bm.ok) return { ok: false, issues: bm.issues };
      return success({
        base: bm.value,
        indexPath: bm.value + "/" + MANIFEST_NAME,
        entry: "url",
        entryName: MANIFEST_NAME,
        entryKind: "manifest",
        schemaVersion: 2,
      });
    }

    const declared = index && typeof index.base === "string" ? index.base : null;
    const isV3 = index && index.schemaVersion === 2;

    /* v3（schemaVersion 2）：索引无 base，files 是**包根相对**完整路径。
       包根 = index.json 所在目录去掉末尾的 /spine（§3.3 路径基准统一）。
       picker 入口拿不到 URL，无法反推 → 明确要求用 ?index=。 */
    if (isV3) {
      if (observedBase == null) {
        return failure(
          "MISSING_BASE",
          "schemaVersion 2 的索引不含 base，需要从 URL 反推包根；请用 ?index=<pack>/spine/index.json 打开。",
          "base"
        );
      }
      const bv = validateBase(observedBase, "observedBase");
      if (!bv.ok) return { ok: false, issues: bv.issues };
      const dir = bv.value;
      const packRoot = /\/spine$/.test(dir) ? dir.slice(0, -"/spine".length) : dir;
      if (!packRoot) {
        return failure("INVALID_BASE", "无法从 " + dir + " 反推包根（去掉 /spine 后为空）", "base");
      }
      const pr = validateBase(packRoot, "packRoot");
      if (!pr.ok) return { ok: false, issues: pr.issues };
      return success({ base: pr.value, indexPath: dir + "/index.json", entry: "url", schemaVersion: 2 });
    }

    if (observedBase == null) {
      if (!declared) {
        return failure(
          "MISSING_BASE",
          "这个索引未声明 base，浏览器无法知道所选文件所在目录。请在索引填写仓库相对 base，或使用 ?index= 打开。",
          "base"
        );
      }
      return success({ base: declared, indexPath: declared + "/index.json", entry: "picker" });
    }
    const b = validateBase(observedBase, "observedBase");
    if (!b.ok) return { ok: false, issues: b.issues };
    const observed = b.value;
    if (declared && declared !== observed) {
      return failure(
        "BASE_MISMATCH",
        "索引 base 与文件位置不一致：声明 " + declared + "，实际 URL 目录 " + observed + "。请修正索引。",
        "base"
      );
    }
    return success({ base: observed, indexPath: observed + "/index.json", entry: "url" });
  }

  /** 从 ?index= 参数得到 { observedBase } 或 issue；参数已是 URLSearchParams 解码一次的结果 */
  function parseIndexParam(param) {
    if (typeof param !== "string" || !param) return failure("INVALID_INDEX_PARAM", "?index= 需要一个仓库根相对路径");
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(param) || param.startsWith("//")) {
      return failure("INVALID_INDEX_PARAM", "?index= 只接受仓库根相对路径（不能带协议或 //）：" + param);
    }
    if (param.charAt(0) === "/") return failure("INVALID_INDEX_PARAM", "?index= 不能以 / 开头：" + param);
    if (param.indexOf("\\") >= 0) return failure("INVALID_INDEX_PARAM", "?index= 不能包含反斜杠：" + param);
    /* v3.2：入口为 <pack>/manifest.json；仍接受 /index.json 以便给出「旧格式」诊断 */
    const base0 = param.split("/").pop();
    if (ENTRY_NAMES.indexOf(base0) < 0) {
      return failure(
        "INVALID_INDEX_PARAM",
        "?index= 必须以 /manifest.json（v3.2）或 /index.json（旧）结尾：" + param
      );
    }
    const dir = param.slice(0, -(base0.length + 1));
    if (!dir) return failure("INVALID_INDEX_PARAM", "仓库根不能作为包目录");
    const b = validateBase(dir, "observedBase");
    if (!b.ok) return { ok: false, issues: b.issues };
    return success({ indexPath: param, observedBase: b.value, entryName: base0 });
  }

  /* ==========================================================================
   * 2b. 本地目录模式（方案 A）：把「选目录」的结果整理成可查的文件树
   *
   * 浏览器只给 File + webkitRelativePath，拿不到绝对路径；v3.2 的路径又是
   * 包根相对，所以必须先把目录内容索引成 Map<包内相对路径, File>，
   * 让 fetchBytes / voiceFetchWithTimeout 在本地模式下直接命中。
   * ====================================================================== */

  /** 路径归一：反斜杠转正斜杠、去 ./ 前缀、折叠重复斜杠、去首尾斜杠 */
  function normalizeLocalPath(rel) {
    let p = String(rel == null ? "" : rel).replace(/\\/g, "/");
    p = p.replace(/\/{2,}/g, "/");
    while (p.startsWith("./")) p = p.slice(2);
    if (p.startsWith("/")) p = p.replace(/^\/+/, "");
    if (p.endsWith("/")) p = p.replace(/\/+$/, "");
    return p;
  }

  /** 应当忽略的噪音条目：macOS 元数据、Windows 缩略图、编辑器临时文件 */
  function shouldIgnoreLocalPath(rel) {
    const p = normalizeLocalPath(rel);
    if (!p) return true;
    for (const seg of p.split("/")) {
      if (!seg) continue;
      if (seg === ".DS_Store" || seg === "__MACOSX" || seg === "Thumbs.db" || seg === "desktop.ini") return true;
      if (seg.startsWith("._")) return true;          // AppleDouble
      if (seg === ".git" || seg === "node_modules") return true;
    }
    return false;
  }

  /**
   * 从目录选择结果构建文件树（纯函数，可测）。
   *
   * @param {Array<{name?:string, webkitRelativePath?:string}>} fileList
   * @returns {{tree: Map<string, any>, count: number, root: string|null,
   *            roots: Array<{root:string, entry:string, depth:number}>, ignored: number}}
   *   tree  : 包内相对路径（相对 root）→ 原 File 对象
   *   root  : 选中的包根路径（如 "deepseek"，或选父目录时的 "packs/deepseek"）
   *   roots : 所有候选包根（含 manifest.json 者优先），按深度升序
   */
  function buildLocalTree(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    const norm = [];
    let ignored = 0;
    for (const f of files) {
      const raw = f && (f.webkitRelativePath || f.name);
      if (!raw || shouldIgnoreLocalPath(raw)) {
        ignored++;
        continue;
      }
      const rel = normalizeLocalPath(raw);
      if (!rel) {
        ignored++;
        continue;
      }
      norm.push({ rel: rel, file: f });
    }

    /* 第一遍：找候选包根 —— basename 是 manifest.json（首选）或 index.json 的条目 */
    const candidates = [];
    for (const it of norm) {
      const segs = it.rel.split("/");
      const base = segs[segs.length - 1];
      if (base !== MANIFEST_NAME && base !== INDEX_NAME) continue;
      const root = segs.slice(0, -1).join("/");
      candidates.push({ root: root, entry: base, depth: segs.length - 1 });
    }
    /* manifest.json 优先；同优先级按深度升序（选到父目录时取最浅的那个包） */
    candidates.sort((a, b) => {
      const am = a.entry === MANIFEST_NAME ? 0 : 1;
      const bm = b.entry === MANIFEST_NAME ? 0 : 1;
      return (am - bm) || (a.depth - b.depth) || (a.root < b.root ? -1 : a.root > b.root ? 1 : 0);
    });
    const roots = candidates.slice();

    /* 没有候选入口时退回「去掉第一段」：允许目录里直接放散装 index.json */
    let root = roots.length ? roots[0].root : null;
    if (root == null) {
      const segs0 = norm.length ? norm[0].rel.split("/") : [];
      if (segs0.length >= 2) root = segs0[0];
    }

    const tree = new Map();
    const prefix = root ? root + "/" : "";
    for (const it of norm) {
      let key;
      if (root == null) key = it.rel;
      else if (prefix && it.rel.startsWith(prefix)) key = it.rel.slice(prefix.length);
      else key = it.rel;                       // 包根之外的条目：保留全路径，仍可被直接命中
      if (!key) continue;
      tree.set(key, it.file);
    }
    return { tree: tree, count: tree.size, root: root, roots: roots, ignored: ignored };
  }

  /**
   * 在文件树里查一个「包根相对路径」。
   * @param {Map<string, any>} tree
   * @param {string} rel 已归一化的包内相对路径
   */
  function localTreeLookup(tree, rel) {
    if (!tree || !tree.size) return null;
    const key = normalizeLocalPath(rel);
    if (!key) return null;
    if (tree.has(key)) return tree.get(key);
    /* Windows 目录大小写不敏感：退回大小写无关匹配 */
    const low = key.toLowerCase();
    for (const [k, v] of tree) {
      if (k.toLowerCase() === low) return v;
    }
    return null;
  }

  /* ==========================================================================
   * 3. 贴图清单与 atlas 页对齐（契约 §1 files.textures）
   * ====================================================================== */
  function validateTexturePages(index, atlasPages) {
    const files = index && index.files;
    const want = files && Array.isArray(files.textures) ? files.textures : [];
    const pages = Array.isArray(atlasPages) ? atlasPages : [];
    const issues = [];
    if (pages.length !== want.length) {
      issues.push(
        issue(
          "files.textures",
          "PAGE_COUNT",
          "索引贴图清单与图集页不一致：索引 " + want.length + " 页，图集 " + pages.length + " 页"
        )
      );
    }
    /* v3 的 textures 是包根相对路径（spine/model.png），atlas 页名是裸文件名（model.png）。
       比对用 basename；返回值保留索引原值，下游拼 URL 需要完整路径。 */
    const baseName = (v) => {
      if (typeof v !== "string") return v;
      const k = v.lastIndexOf("/");
      return k < 0 ? v : v.slice(k + 1);
    };
    const n = Math.max(want.length, pages.length);
    for (let i = 0; i < n; i++) {
      const w = want[i];
      const got = pages[i] && pages[i].name;
      if (w === undefined) {
        issues.push(issue("files.textures[" + i + "]", "PAGE_EXTRA", "图集多出第 " + (i + 1) + " 页 " + got + "，索引未列出"));
      } else if (got === undefined) {
        issues.push(issue("files.textures[" + i + "]", "PAGE_MISSING", "索引贴图清单与图集页不一致：缺少 " + w));
      } else if (got !== w && got !== baseName(w)) {
        issues.push(
          issue(
            "files.textures[" + i + "]",
            "PAGE_MISMATCH",
            "索引贴图清单与图集页不一致：索引第 " + (i + 1) + " 页是 " + w + "，图集是 " + got
          )
        );
      }
    }
    if (issues.length) return issuesResult(issues);
    return success(want.map((name, index0) => ({ name: name, pageIndex: index0 })));
  }

  /* ==========================================================================
   * 4. 模型补丁（契约 §4.2.1）
   * ====================================================================== */
  function round(v, digits) {
    const p = Math.pow(10, digits == null ? 6 : digits);
    return Math.round(v * p) / p;
  }

  /**
   * 在原始骨架 JSON 上打补丁；不修改入参。
   * @param {object} raw 原始骨架 JSON
   * @param {Array<object>} boneValues 与 raw.bones 同序，元素含 x/y/rotation/scaleX/scaleY
   * @param {Array<string|object>} slotOrder 当前绘制顺序的 slot 名（或 {name,bone,attachment}）
   * @param {Array<object>} [attachmentEdits] 可选：region 附件局部变换补丁（见 applyAttachmentEdits）。
   *   缺省（undefined/null）时行为与旧版完全一致；传入时原子应用：任一 issue 直接 ok:false，不交付半成品。
   */
  function buildPatchedModel(raw, boneValues, slotOrder, attachmentEdits) {
    if (!isPlainObject(raw)) return failure("NOT_OBJECT", "原始骨架 JSON 不是对象", "");
    const out = clone(raw);
    const values = Array.isArray(boneValues) ? boneValues : [];

    out.bones = (out.bones || []).map((rb, i) => {
      const cur = values[i];
      if (!cur) return rb;
      const next = Object.assign({}, rb);
      for (const f of PATCH_FIELDS) {
        const dflt = FIELD_DEFAULTS[f];
        const before = rb[f] == null ? dflt : rb[f];
        const now = cur[f] == null ? dflt : cur[f];
        if (!Number.isFinite(now)) continue;
        if (Math.abs(now - before) > 1e-9) next[f] = round(now, 6);
      }
      return next;
    });

    if (Array.isArray(slotOrder) && slotOrder.length) {
      const byName = Object.create(null);
      for (const s of out.slots || []) byName[s.name] = s;
      out.slots = slotOrder.map((entry) => {
        if (entry && typeof entry === "object") {
          const known = byName[entry.name];
          return known ? Object.assign({}, known, entry.fields || {}) : entry;
        }
        const known = byName[entry];
        return known || { name: entry, attachment: null };
      });
    }

    if (attachmentEdits === undefined || attachmentEdits === null) return success(out);
    const attachRes = applyAttachmentEdits(out, attachmentEdits);
    if (!attachRes.ok) return issuesResult(attachRes.issues);
    return success(attachRes.value, attachRes.issues);
  }

  /** 固定序列化：JSON.stringify(patched,null,1) + "\n" */
  function serializeModel(patched) {
    return JSON.stringify(patched, null, 1) + "\n";
  }

  /* ==========================================================================
   * 4b. 附件局部变换补丁（P0-16 附件目标，纯对象补丁，不是字符串替换）
   * ====================================================================== */
  /** 附件可编辑字段：与 region 附件 JSON 的局部变换字段一致 */
  const ATTACH_FIELDS = Object.freeze(["x", "y", "rotation", "scaleX", "scaleY"]);

  /**
   * 附件类型判定（不猜前缀，只看附件对象自身）：
   *   - type 是字符串：'region' → region，其余（mesh/linkedmesh/clipping/boundingbox/path…）原样返回；
   *   - 无 type（旧格式）：有 vertices/triangles 数组 → mesh，否则按 region 处理。
   */
  function attachmentKind(att) {
    if (!isPlainObject(att)) return null;
    if (typeof att.type === "string" && att.type) return att.type;
    if (Array.isArray(att.vertices) || Array.isArray(att.triangles)) return "mesh";
    return "region";
  }

  /** skins 索引：数组形态 [{name,attachments}] 或对象形态 {default:{attachments}} */
  function skinLookup(model) {
    const skins = model ? model.skins : undefined;
    if (Array.isArray(skins)) {
      const byName = Object.create(null);
      for (const el of skins) {
        if (!isPlainObject(el) || typeof el.name !== "string" || !el.name) continue;
        if (!(el.name in byName)) byName[el.name] = el;
      }
      return { kind: "array", names: Object.keys(byName), byName: byName };
    }
    if (isPlainObject(skins)) {
      const byName = Object.create(null);
      for (const name of Object.keys(skins)) {
        if (isPlainObject(skins[name])) byName[name] = skins[name];
      }
      return { kind: "object", names: Object.keys(byName), byName: byName };
    }
    return null;
  }

  /**
   * 取一个 skin 条目的「槽 → 附件」容器。
   * 数组形态只认 attachments；对象形态优先 attachments，兼容旧式 skin 对象直接以槽名为键。
   */
  function attachmentContainer(skin) {
    if (!isPlainObject(skin)) return null;
    if (isPlainObject(skin.attachments)) return skin.attachments;
    return skin;
  }

  function skinPath(kind, skinName) {
    return "skins." + skinName + (kind === "array" ? ".attachments" : "");
  }

  /** 归一化单条 edit：兼容 canonical {skinName,slotName,attachmentName,fields} 与扁平 {skin,slot,attachment,x,y,…} */
  function normalizeAttachmentEdit(edit) {
    const src = isPlainObject(edit) ? edit : {};
    const out = {
      skinName: typeof src.skinName === "string" && src.skinName ? src.skinName : typeof src.skin === "string" && src.skin ? src.skin : null,
      slotName: typeof src.slotName === "string" && src.slotName ? src.slotName : typeof src.slot === "string" ? src.slot : "",
      attachmentName:
        typeof src.attachmentName === "string" && src.attachmentName
          ? src.attachmentName
          : typeof src.attachment === "string" && src.attachment
            ? src.attachment
            : null,
      fields: null,
    };
    const fields = Object.create(null);
    if (isPlainObject(src.fields)) {
      for (const f of Object.keys(src.fields)) fields[f] = src.fields[f];
    } else {
      for (const f of ATTACH_FIELDS) if (Object.prototype.hasOwnProperty.call(src, f)) fields[f] = src[f];
    }
    out.fields = fields;
    return out;
  }

  /**
   * 应用附件局部变换补丁（原子：全部合法才交付新模型）。
   * @param {object} patchedModel raw 或 buildPatchedModel 产物，skins 支持数组/对象两式
   * @param {Array<object>} edits 每项 {skinName?,slotName,attachmentName?,fields:{x?,y?,rotation?,scaleX?,scaleY?}}
   *   attachmentName 省略时回退到 slots 里该槽当前 setup attachment（不猜前缀）；
   *   兼容扁平写法 {skin,slot,attachment,x,y,rotation,scaleX,scaleY}。
   * @returns {{ok:true,value:object,applied:Array,noop:Array,issues:Array}
   *          |{ok:false,issues:Array}}
   *   任一 issue → ok:false，只返回 issues（不交付任何模型），原输入永不修改；
   *   成功时 value 是新模型，applied 只列真正写入了字段的条目，
   *   noop 列出「请求值与原值一致、按契约未写」的条目（可见，不静默忽略）。
   */
  function applyAttachmentEdits(patchedModel, edits) {
    if (!isPlainObject(patchedModel)) return { ok: false, value: null, applied: [], issues: [issue("model", "NOT_OBJECT", "模型补丁不是对象")] };
    if (!Array.isArray(edits)) return { ok: false, value: clone(patchedModel), applied: [], issues: [issue("edits", "ATTACH_EDITS_INVALID", "edits 必须是数组")] };

    const lookup = skinLookup(patchedModel);
    const issues = [];
    const plan = [];
    const seen = Object.create(null);

    for (let i = 0; i < edits.length; i++) {
      const path0 = "edits[" + i + "]";
      const edit = normalizeAttachmentEdit(edits[i]);
      if (!edit.slotName) {
        issues.push(issue(path0 + ".slotName", "ATTACH_SLOT_REQUIRED", "slotName 必须是非空字符串"));
        continue;
      }
      const fieldNames = Object.keys(edit.fields);
      if (!fieldNames.length) {
        issues.push(issue(path0 + ".fields", "ATTACH_NO_FIELDS", "fields 至少要有一个可编辑字段"));
        continue;
      }
      let fieldBad = false;
      for (const f of fieldNames) {
        if (ATTACH_FIELDS.indexOf(f) < 0) {
          issues.push(issue(path0 + ".fields." + f, "ATTACH_FIELD_UNKNOWN", "未知附件字段 " + f + "（只允许 " + ATTACH_FIELDS.join("/") + "）"));
          fieldBad = true;
        } else if (!Number.isFinite(edit.fields[f])) {
          issues.push(issue(path0 + ".fields." + f, "ATTACH_FIELD_VALUE", f + " 必须是有限数字"));
          fieldBad = true;
        }
      }
      if (fieldBad) continue;
      if (!lookup || !lookup.names.length) {
        issues.push(issue(path0, "ATTACH_SKINS_MISSING", "模型没有可用的 skins 段"));
        continue;
      }
      let skinName = edit.skinName;
      if (!skinName) {
        if (lookup.byName["default"]) skinName = "default";
        else if (lookup.names.length === 1) skinName = lookup.names[0];
        else {
          issues.push(
            issue(
              path0 + ".skinName",
              "ATTACH_SKIN_AMBIGUOUS",
              "未指定 skinName，且没有 default、skin 也不唯一（" + lookup.names.join("/") + "），已拒绝"
            )
          );
          continue;
        }
      }
      const skin = lookup.byName[skinName];
      const sPath = skinPath(lookup.kind, skinName);
      if (!skin) {
        issues.push(issue(path0 + ".skinName", "ATTACH_SKIN_MISSING", "找不到 skin " + skinName));
        continue;
      }
      const container = attachmentContainer(skin);
      const slotBag = isPlainObject(container) ? container[edit.slotName] : null;
      const slotPath = sPath + "." + edit.slotName;
      if (!isPlainObject(slotBag)) {
        issues.push(issue(slotPath, "ATTACH_SLOT_MISSING", "skin " + skinName + " 里找不到槽 " + edit.slotName + " 的附件表"));
        continue;
      }
      let attachmentName = edit.attachmentName;
      if (!attachmentName) {
        const slotEntry = (Array.isArray(patchedModel.slots) ? patchedModel.slots : []).filter(function (s) {
          return isPlainObject(s) && s.name === edit.slotName;
        })[0];
        if (slotEntry && typeof slotEntry.attachment === "string" && slotEntry.attachment) attachmentName = slotEntry.attachment;
        else {
          issues.push(issue(slotPath, "ATTACH_NAME_REQUIRED", "未指定 attachmentName，且 slots 里该槽没有 setup attachment"));
          continue;
        }
      }
      const attPath = slotPath + "." + attachmentName;
      const att = slotBag[attachmentName];
      if (!isPlainObject(att)) {
        issues.push(issue(attPath, "ATTACH_MISSING", "找不到附件 " + attachmentName));
        continue;
      }
      const kind = attachmentKind(att);
      if (kind !== "region") {
        issues.push(issue(attPath + ".type", "ATTACH_UNSUPPORTED_TYPE", "只支持 region 附件，当前是 " + kind + "（加权/网格附件不支持局部变换编辑）"));
        continue;
      }
      const dupKey = skinName + "/" + edit.slotName + "/" + attachmentName;
      if (seen[dupKey]) {
        issues.push(issue(attPath, "ATTACH_DUPLICATE", "同一次补丁里重复编辑同一个附件（" + dupKey + "），已拒绝"));
        continue;
      }
      seen[dupKey] = true;
      /* 契约 §5：只在有效数值相对原值（缺省 x/y/r=0、scale=1）确实变化时写字段，避免制造默认值噪声 */
      const fields = {};
      const requested = {};
      for (const f of fieldNames) {
        const dflt = FIELD_DEFAULTS[f];
        const before = Number.isFinite(att[f]) ? att[f] : dflt;
        const now = round(edit.fields[f], 6);
        requested[f] = now;
        if (Math.abs(now - before) > 1e-9) fields[f] = now;
      }
      plan.push({ skinName: skinName, slotName: edit.slotName, attachmentName: attachmentName, fields: fields, requested: requested, path: attPath });
    }

    if (issues.length) return { ok: false, issues: issues };

    const out = clone(patchedModel);
    const outLookup = skinLookup(out);
    const applied = [];
    const noop = [];
    for (const item of plan) {
      const written = Object.keys(item.fields);
      if (!written.length) {
        noop.push({ skinName: item.skinName, slotName: item.slotName, attachmentName: item.attachmentName, fields: clone(item.requested) });
        continue;
      }
      const container = attachmentContainer(outLookup.byName[item.skinName]);
      const att = container[item.slotName][item.attachmentName];
      for (const f of written) att[f] = item.fields[f];
      applied.push({ skinName: item.skinName, slotName: item.slotName, attachmentName: item.attachmentName, fields: clone(item.fields) });
    }
    return { ok: true, value: out, applied: applied, noop: noop, issues: [] };
  }

  /** 索引规范化序列化：schemaVersion/base/label/files 顺序，2 空格，结尾换行 */
  function serializeIndex(index) {
    const out = { schemaVersion: SCHEMA_VERSION };
    if (index && typeof index.base === "string") out.base = index.base;
    if (index && typeof index.label === "string") out.label = index.label;
    const f = (index && index.files) || {};
    out.files = {
      model: f.model,
      atlas: f.atlas,
      textures: Array.isArray(f.textures) ? f.textures.slice() : [],
    };
    return JSON.stringify(out, null, 2) + "\n";
  }

  /* ==========================================================================
   * 5. CRC32 / ZIP store（契约 §4.4）
   * ====================================================================== */
  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    if (!bytes || typeof bytes.length !== "number") return 0;
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const ZIP_DOS_TIME = 0;
  const ZIP_DOS_DATE = 0x0021; // 1980-01-01
  const ZIP_UTF8_FLAG = 0x0800;
  const ZIP_VERSION = 20;

  function isUint8Array(v) {
    return v instanceof Uint8Array || (!!v && Object.prototype.toString.call(v) === "[object Uint8Array]");
  }

  /**
   * 预检条目清单（不分配输出）。契约 §4.4：名字合法、无重名、无目录、条目数、总输入、ZIP32 边界。
   * @param {Array<{name:string, bytes:Uint8Array}>} entries
   */
  function checkZipEntries(entries) {
    const issues = [];
    if (!Array.isArray(entries) || !entries.length) {
      return issuesResult([issue("entries", "EMPTY", "ZIP 条目清单为空")]);
    }
    if (entries.length > LIMITS.maxEntries) {
      issues.push(issue("entries", "TOO_MANY_ENTRIES", "ZIP 条目过多（最多 " + LIMITS.maxEntries + " 个）：" + entries.length));
    }
    const seen = Object.create(null);
    let total = 0;
    let totalBytes = 0;
    const names = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!isPlainObject(e)) {
        issues.push(issue("entries[" + i + "]", "INVALID_ENTRY", "ZIP 条目必须是 {name,bytes} 对象"));
        continue;
      }
      const bad = filenameIssue(e.name, "entries[" + i + "].name");
      if (bad) {
        issues.push(bad);
        continue;
      }
      const key = e.name.toLowerCase();
      if (seen[key]) issues.push(issue("entries[" + i + "].name", "DUPLICATE_NAME", "ZIP 条目名重复（不区分大小写）：" + e.name));
      seen[key] = true;
      if (!isUint8Array(e.bytes)) {
        issues.push(issue("entries[" + i + "].bytes", "INVALID_BYTES", "ZIP 条目内容必须是 Uint8Array：" + e.name));
        continue;
      }
      const size = e.bytes.length;
      if (size > 0xffffffff) issues.push(issue("entries[" + i + "].bytes", "ZIP32_OVERFLOW", "单条目超过 ZIP32 上限：" + e.name));
      const nameBytes = utf8Bytes(e.name);
      total += 30 + nameBytes.length + size + 46 + nameBytes.length;
      totalBytes += size;
      names.push({ name: e.name, size: size, nameLength: nameBytes.length });
    }
    if (totalBytes > LIMITS.totalInputBytes) {
      issues.push(
        issue(
          "entries",
          "TOTAL_TOO_LARGE",
          "整包超过另存大小限制（" + totalBytes + " > " + LIMITS.totalInputBytes + " 字节）"
        )
      );
    }
    const totalBytesOut = total + 22;
    if (totalBytesOut > LIMITS.zipBytes) {
      issues.push(issue("entries", "ZIP_TOO_LARGE", "生成的 ZIP 超过 " + LIMITS.zipBytes + " 字节"));
    }
    if (totalBytesOut >= 0x100000000) {
      issues.push(issue("entries", "ZIP32_OVERFLOW", "生成的 ZIP 超出 ZIP32 上限"));
    }
    if (issues.length) return issuesResult(issues);
    return success({ entries: names, totalBytes: totalBytes, zipBytes: totalBytesOut });
  }

  /**
   * 构建 ZIP（store，无压缩）。重复相同输入输出相同字节。
   * @param {Array<{name:string, bytes:Uint8Array}>} entries
   * @returns {{ok:true, value:Uint8Array} | {ok:false, issues:Array}}
   */
  function buildZipStore(entries) {
    const pre = checkZipEntries(entries);
    if (!pre.ok) return pre;

    const plan = pre.value;
    const out = new Uint8Array(plan.zipBytes);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    let at = 0;
    const offsets = [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const nameBytes = utf8Bytes(e.name);
      const data = e.bytes;
      const crc = crc32(data);
      offsets.push(at);

      view.setUint32(at, 0x04034b50, true);
      view.setUint16(at + 4, ZIP_VERSION, true);
      view.setUint16(at + 6, ZIP_UTF8_FLAG, true);
      view.setUint16(at + 8, 0, true); // method = store
      view.setUint16(at + 10, ZIP_DOS_TIME, true);
      view.setUint16(at + 12, ZIP_DOS_DATE, true);
      view.setUint32(at + 14, crc >>> 0, true);
      view.setUint32(at + 18, data.length, true);
      view.setUint32(at + 22, data.length, true);
      view.setUint16(at + 26, nameBytes.length, true);
      view.setUint16(at + 28, 0, true); // extra length
      out.set(nameBytes, at + 30);
      out.set(data, at + 30 + nameBytes.length);
      at += 30 + nameBytes.length + data.length;
    }

    const centralStart = at;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const nameBytes = utf8Bytes(e.name);
      const data = e.bytes;
      const crc = crc32(data);

      view.setUint32(at, 0x02014b50, true);
      view.setUint16(at + 4, ZIP_VERSION, true); // version made by（DOS）
      view.setUint16(at + 6, ZIP_VERSION, true); // version needed
      view.setUint16(at + 8, ZIP_UTF8_FLAG, true);
      view.setUint16(at + 10, 0, true); // method
      view.setUint16(at + 12, ZIP_DOS_TIME, true);
      view.setUint16(at + 14, ZIP_DOS_DATE, true);
      view.setUint32(at + 16, crc >>> 0, true);
      view.setUint32(at + 20, data.length, true);
      view.setUint32(at + 24, data.length, true);
      view.setUint16(at + 28, nameBytes.length, true);
      view.setUint16(at + 30, 0, true); // extra
      view.setUint16(at + 32, 0, true); // comment
      view.setUint16(at + 34, 0, true); // disk start
      view.setUint16(at + 36, 0, true); // internal attrs
      view.setUint32(at + 38, 0, true); // external attrs
      view.setUint32(at + 42, offsets[i], true);
      out.set(nameBytes, at + 46);
      at += 46 + nameBytes.length;
    }

    const centralSize = at - centralStart;
    view.setUint32(at, 0x06054b50, true);
    view.setUint16(at + 4, 0, true);
    view.setUint16(at + 6, 0, true);
    view.setUint16(at + 8, entries.length, true);
    view.setUint16(at + 10, entries.length, true);
    view.setUint32(at + 12, centralSize, true);
    view.setUint32(at + 16, centralStart, true);
    view.setUint16(at + 20, 0, true);
    at += 22;

    if (at !== out.length) return failure("ZIP_SIZE_MISMATCH", "ZIP 输出长度与预检不一致", "entries");
    return success(out);
  }

  /* ==========================================================================
   * 6. 整包清单（另存 ZIP 用；契约 §4.4 限额）
   * ====================================================================== */
  function zipNameFor(base) {
    const dir = String(base || "").split("/").filter(Boolean);
    const last = dir.length ? dir[dir.length - 1] : "bundle";
    const safe = last.replace(/[^\w.-]+/g, "_").slice(0, 60) || "bundle";
    return safe + "-bundle.zip";
  }

  /**
   * 校验并排序整包条目：index → model → atlas → textures（索引顺序）。
   * @param {{base:string, indexBytes:Uint8Array, model:{name:string,bytes:Uint8Array},
   *          atlas:{name:string,bytes:Uint8Array}, textures:Array<{name:string,bytes:Uint8Array}>}} pkg
   */
  function planBundleArchive(pkg) {
    const issues = [];
    if (!isPlainObject(pkg)) return failure("INVALID_PACKAGE", "整包描述不是对象", "");
    const baseCheck = validateBase(pkg.base, "base");
    if (!baseCheck.ok) issues.push.apply(issues, baseCheck.issues);

    function take(role, item, name, maxBytes) {
      if (!isPlainObject(item)) {
        issues.push(issue(role, "MISSING_FILE", "整包缺少 " + role));
        return null;
      }
      const finalName = name || item.name;
      const bad = filenameIssue(finalName, role + ".name");
      if (bad) {
        issues.push(bad);
        return null;
      }
      if (!isUint8Array(item.bytes)) {
        issues.push(issue(role + ".bytes", "MISSING_FILE", "整包缺少 " + role + " 的原始字节：" + finalName));
        return null;
      }
      if (item.bytes.length > maxBytes) {
        issues.push(
          issue(role + ".bytes", "FILE_TOO_LARGE", role + " 超过上限（" + item.bytes.length + " > " + maxBytes + " 字节）：" + finalName)
        );
        return null;
      }
      return { name: finalName, bytes: item.bytes, role: role };
    }

    if (!isUint8Array(pkg.indexBytes)) {
      issues.push(issue("indexBytes", "MISSING_FILE", "整包缺少 index.json 的原始字节"));
    } else if (pkg.indexBytes.length > LIMITS.indexBytes) {
      issues.push(issue("indexBytes", "FILE_TOO_LARGE", "index.json 超过 " + LIMITS.indexBytes + " 字节"));
    }

    const model = take("model", pkg.model, pkg.model && pkg.model.name, LIMITS.modelBytes);
    const atlas = take("atlas", pkg.atlas, pkg.atlas && pkg.atlas.name, LIMITS.atlasBytes);

    const textures = [];
    const list = Array.isArray(pkg.textures) ? pkg.textures : [];
    if (!list.length) issues.push(issue("textures", "MISSING_FILE", "整包缺少贴图"));
    if (list.length > LIMITS.maxTextures) {
      issues.push(issue("textures", "TOO_MANY_TEXTURES", "贴图超过 " + LIMITS.maxTextures + " 页"));
    }
    for (let i = 0; i < list.length; i++) {
      const t = take("textures[" + i + "]", list[i], list[i] && list[i].name, LIMITS.textureBytes);
      if (t) textures.push(t);
    }

    if (issues.length) return issuesResult(issues);

    const entries = [{ name: "index.json", bytes: pkg.indexBytes, role: "index" }, model, atlas].concat(textures);
    const pre = checkZipEntries(entries);
    if (!pre.ok) return pre;
    return success({ entries: entries, zipName: zipNameFor(baseCheck.value), totalBytes: pre.value.totalBytes, zipBytes: pre.value.zipBytes });
  }

  /* ==========================================================================
   * 7. 保存请求/响应辅助（契约 §3.2 / §3.5 / §4.2）
   * ====================================================================== */
  /** 目标文件名集合，按 index → model → atlas → textures 顺序（与服务端响应顺序一致） */
  function targetNames(index) {
    const f = (index && index.files) || {};
    return ["index.json"].concat([f.model, f.atlas].filter(Boolean)).concat(Array.isArray(f.textures) ? f.textures : []);
  }

  /** 校验保存请求体的文件封套与索引一一对应 */
  function checkSaveRequestShape(body, expectedNames) {
    const issues = [];
    if (!isPlainObject(body)) return failure("INVALID_REQUEST", "保存请求必须是 JSON 对象", "");
    if (body.apiVersion !== API_VERSION) {
      issues.push(issue("apiVersion", "UNSUPPORTED_VERSION", "不支持的 API 版本：" + show(body.apiVersion) + "；当前仅支持 1"));
    }
    const enc = (item, path, wantEncoding) => {
      if (!isPlainObject(item)) {
        issues.push(issue(path, "MISSING_FIELD", "缺少文件封套：" + path));
        return;
      }
      if (typeof item.name !== "string") issues.push(issue(path + ".name", "MISSING_FIELD", "缺少文件名：" + path));
      if (item.encoding !== wantEncoding) {
        issues.push(issue(path + ".encoding", "INVALID_ENCODING", path + " 的 encoding 必须是 " + wantEncoding));
      }
      if (typeof item.data !== "string") issues.push(issue(path + ".data", "MISSING_FIELD", path + " 的 data 必须是字符串"));
    };
    enc(body.model, "model", "utf8");
    enc(body.atlas, "atlas", "utf8");
    if (!Array.isArray(body.textures)) issues.push(issue("textures", "MISSING_FIELD", "缺少 textures 数组"));
    else {
      body.textures.forEach((t, i) => enc(t, "textures[" + i + "]", "base64"));
      if (body.textures.length !== Math.max(0, (expectedNames || []).length - 3)) {
        issues.push(issue("textures", "TEXTURE_COUNT", "贴图封套数量与索引不一致"));
      }
      body.textures.forEach((t, i) => {
        const want = expectedNames ? expectedNames[3 + i] : null;
        if (want && t && t.name !== want) issues.push(issue("textures[" + i + "].name", "NAME_MISMATCH", "贴图封套名与索引不一致：" + t.name));
      });
    }
    if (typeof body.base !== "string") issues.push(issue("base", "MISSING_FIELD", "缺少 base"));
    if (expectedNames && body.model && body.model.name !== expectedNames[1]) {
      issues.push(issue("model.name", "NAME_MISMATCH", "model 封套名与索引不一致"));
    }
    if (expectedNames && body.atlas && body.atlas.name !== expectedNames[2]) {
      issues.push(issue("atlas.name", "NAME_MISMATCH", "atlas 封套名与索引不一致"));
    }
    return issues.length ? issuesResult(issues) : success(body);
  }

  /**
   * 校验保存响应：ok:true、apiVersion 1、changed/unchanged 互斥且并集恰好是目标集合。
   * 契约 §4.2.4 要求「响应目标集合完整」才提交新基线。
   */
  function checkSaveResponse(res, expectedNames) {
    const want = expectedNames || [];
    if (!isPlainObject(res)) return failure("INVALID_RESPONSE", "保存响应不是 JSON 对象", "");
    if (res.apiVersion !== API_VERSION) {
      return failure("UNSUPPORTED_VERSION", "保存响应 apiVersion 不受支持：" + show(res.apiVersion), "apiVersion");
    }
    if (res.ok !== true) return failure("NOT_OK", "保存响应未声明成功", "ok");
    const changed = Array.isArray(res.changed) ? res.changed : null;
    const unchanged = Array.isArray(res.unchanged) ? res.unchanged : null;
    if (!changed || !unchanged) return failure("INVALID_RESPONSE", "保存响应缺少 changed/unchanged 数组", "");
    const issues = [];
    const seen = Object.create(null);
    for (const n of changed.concat(unchanged)) {
      if (typeof n !== "string") {
        issues.push(issue("changed", "INVALID_RESPONSE", "文件名必须是字符串"));
        continue;
      }
      if (seen[n]) issues.push(issue(n, "DUPLICATE_TARGET", "响应重复列出文件：" + n));
      seen[n] = true;
    }
    for (const n of changed) if (unchanged.indexOf(n) >= 0) issues.push(issue(n, "CONFLICT", "同一个文件同时出现在 changed 与 unchanged"));
    for (const n of want) {
      if (!seen[n]) issues.push(issue(n, "INCOMPLETE", "保存响应缺少目标文件：" + n));
    }
    for (const n of Object.keys(seen)) {
      if (want.indexOf(n) < 0) issues.push(issue(n, "UNEXPECTED", "保存响应包含非目标文件：" + n));
    }
    return issues.length ? issuesResult(issues) : success({ changed: changed.slice(), unchanged: unchanged.slice() });
  }

  /* ==========================================================================
   * 导出
   * ====================================================================== */
  const api = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    API_VERSION: API_VERSION,
    LIMITS: LIMITS,
    PATCH_FIELDS: PATCH_FIELDS,
    FIELD_DEFAULTS: FIELD_DEFAULTS,
    ATTACH_FIELDS: ATTACH_FIELDS,

    validateFilename: validateFilename,
    validateBase: validateBase,
    validateIndex: validateIndex,
    parseIndexText: parseIndexText,
    parseIndexParam: parseIndexParam,
    resolveIndexLocation: resolveIndexLocation,
    validateManifest: validateManifest,
    normalizePackPath: normalizePackPath,
    buildLocalTree: buildLocalTree,
    localTreeLookup: localTreeLookup,
    normalizeLocalPath: normalizeLocalPath,
    shouldIgnoreLocalPath: shouldIgnoreLocalPath,
    looksLikeManifest: looksLikeManifest,
    looksLikeLegacyIndex: looksLikeLegacyIndex,
    MANIFEST_SCHEMA_VERSION: MANIFEST_SCHEMA_VERSION,
    ENTRY_NAMES: ENTRY_NAMES.slice(),
    OLD_FORMAT_CODE: OLD_FORMAT_CODE,
    validateTexturePages: validateTexturePages,

    buildPatchedModel: buildPatchedModel,
    serializeModel: serializeModel,
    serializeIndex: serializeIndex,
    applyAttachmentEdits: applyAttachmentEdits,
    attachmentKind: attachmentKind,

    crc32: crc32,
    checkZipEntries: checkZipEntries,
    buildZipStore: buildZipStore,
    planBundleArchive: planBundleArchive,
    zipNameFor: zipNameFor,

    targetNames: targetNames,
    checkSaveRequestShape: checkSaveRequestShape,
    checkSaveResponse: checkSaveResponse,
  };

  global.SpineBundle = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
