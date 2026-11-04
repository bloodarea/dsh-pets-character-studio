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

    /* schemaVersion：严格整数 1 */
    if (!("schemaVersion" in input)) {
      issues.push(issue("schemaVersion", "MISSING_FIELD", "索引缺少 schemaVersion"));
    } else if (typeof input.schemaVersion !== "number" || !Number.isInteger(input.schemaVersion) || input.schemaVersion !== SCHEMA_VERSION) {
      issues.push(
        issue(
          "schemaVersion",
          "BAD_VERSION",
          "不支持的索引版本：" + show(input.schemaVersion) + "；当前仅支持 schemaVersion=" + SCHEMA_VERSION
        )
      );
    }

    /* base：picker 必填，URL 可省略 */
    let base = null;
    if (!("base" in input) || input.base === undefined || input.base === null) {
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
      for (const k of Object.keys(f)) {
        if (!FILE_FIELDS[k]) issues.push(issue("files." + k, "UNKNOWN_FIELD", "files 包含未知字段：" + k));
      }

      const model = f.model;
      const atlas = f.atlas;
      const textures = f.textures;

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
          const bad =
            filenameIssue(t, "files.textures[" + i + "]") ||
            (typeof t === "string" && !t.endsWith(".png") && !t.endsWith(".webp")
              ? issue("files.textures[" + i + "]", "INVALID_EXT", "贴图必须是 .png 或 .webp（小写扩展名）：" + t)
              : null);
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
      }
    }

    if (issues.length) return issuesResult(issues);
    const value = { schemaVersion: SCHEMA_VERSION };
    if (base) value.base = base;
    if (label) value.label = label;
    value.files = files;
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
      return failure("INVALID_JSON", "索引不是合法 JSON：" + (e && e.message ? e.message : String(e)), "");
    }
    return validateIndex(parsed, opts);
  }

  /**
   * 定位索引（契约 §2.2 / §2.3）。
   * @param {object} index 已通过 validateIndex 的规范化索引
   * @param {string|null} observedBase URL 目录（?index= 时给出），picker 传 null
   */
  function resolveIndexLocation(index, observedBase) {
    const declared = index && typeof index.base === "string" ? index.base : null;
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
    if (!param.endsWith("/index.json")) {
      return failure("INVALID_INDEX_PARAM", "?index= 必须以 /index.json 结尾：" + param);
    }
    const dir = param.slice(0, -"/index.json".length);
    if (!dir) return failure("INVALID_INDEX_PARAM", "仓库根不能作为索引目录");
    const b = validateBase(dir, "observedBase");
    if (!b.ok) return { ok: false, issues: b.issues };
    return success({ indexPath: param, observedBase: b.value });
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
    const n = Math.max(want.length, pages.length);
    for (let i = 0; i < n; i++) {
      const w = want[i];
      const got = pages[i] && pages[i].name;
      if (w === undefined) {
        issues.push(issue("files.textures[" + i + "]", "PAGE_EXTRA", "图集多出第 " + (i + 1) + " 页 " + got + "，索引未列出"));
      } else if (got === undefined) {
        issues.push(issue("files.textures[" + i + "]", "PAGE_MISSING", "索引贴图清单与图集页不一致：缺少 " + w));
      } else if (got !== w) {
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
   */
  function buildPatchedModel(raw, boneValues, slotOrder) {
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
    return success(out);
  }

  /** 固定序列化：JSON.stringify(patched,null,1) + "\n" */
  function serializeModel(patched) {
    return JSON.stringify(patched, null, 1) + "\n";
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

    validateFilename: validateFilename,
    validateBase: validateBase,
    validateIndex: validateIndex,
    parseIndexText: parseIndexText,
    parseIndexParam: parseIndexParam,
    resolveIndexLocation: resolveIndexLocation,
    validateTexturePages: validateTexturePages,

    buildPatchedModel: buildPatchedModel,
    serializeModel: serializeModel,
    serializeIndex: serializeIndex,

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
