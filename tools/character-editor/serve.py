#!/usr/bin/env python3
"""为「内置人物包管理器」起本地服务（仅标准库）：静态文件 + 回环写接口。

编辑器需要 http 才能 fetch 仓库里的角色文件，所以不能直接双击 html。
本脚本负责：选空闲端口 → 在仓库根目录起静态服务 → 打开浏览器；
并提供两个 API（契约 docs/review/2026-11-03-spine-index/contract.md §3）：

  GET  /api/capabilities   {"apiVersion":1,"saveBundle":bool,...}
  POST /api/save-bundle    就地回写 index.json + model + atlas + 贴图（原子替换 / 失败回滚）

写接口只在回环地址（127.0.0.1 / localhost）监听时启用；其他 --bind 一律只读。

用法：
  python3 serve.py                 # 默认 8123，占用则自动往后找
  python3 serve.py --port 9000
  python3 serve.py --port 0        # 随机端口
  python3 serve.py --no-browser    # 只起服务不打开浏览器
"""
import argparse
import base64
import binascii
import functools
import http.server
import json
import os
import pathlib
import re
import socket
import socketserver
import signal
import shlex
import subprocess
import time
import sys
import tempfile
import threading
import webbrowser

EDITOR_PATH = "/tools/character-editor/"

API_VERSION = 1
SAVE_HEADER = "save-bundle-v1"
SAVE_HEADER_NAME = "X-Spine-Editor"

MAX_BODY_BYTES = 64 * 1024 * 1024
MAX_TOTAL_OUT = 48 * 1024 * 1024
MAX_INDEX_BYTES = 64 * 1024
MAX_MODEL_BYTES = 8 * 1024 * 1024
MAX_ATLAS_BYTES = 2 * 1024 * 1024
MAX_TEXTURE_BYTES = 8 * 1024 * 1024
MAX_TEXTURES = 16
READ_TIMEOUT = 15.0

INDEX_NAME = "index.json"

BASENAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
MAX_BASENAME = 128
MAX_BASE = 1024
MAX_LABEL = 120
RESERVED_NAMES = frozenset(
    {"con", "prn", "aux", "nul"}
    | {"com%d" % i for i in range(1, 10)}
    | {"lpt%d" % i for i in range(1, 10)}
)

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
WEBP_SIGNATURE = b"RIFF"
WEBP_TAG = b"WEBP"

SAVE_LOCK = threading.Lock()


# --------------------------------------------------------------------------- #
# 错误与响应
# --------------------------------------------------------------------------- #
class ApiError(Exception):
    """带 HTTP 状态与契约错误码的 API 错误；extra 会并入 error 对象。"""

    def __init__(self, status, code, message, extra=None, file=None, close=False):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}
        self.file = file
        self.close = close

    def payload(self):
        err = {"code": self.code, "message": self.message}
        if self.file:
            err["file"] = self.file
        for k, v in self.extra.items():
            err[k] = v
        return {"ok": False, "apiVersion": API_VERSION, "error": err}


def path_denied(message, file=None):
    return ApiError(403, "PATH_DENIED", message or "保存路径不允许，只能写入索引目录内的指定文件", file=file)


def invalid_request(message, file=None):
    return ApiError(400, "INVALID_REQUEST", "请求格式错误：" + message, file=file)


# --------------------------------------------------------------------------- #
# 路径文法（与 bundle.js 同一套规则；服务端独立重新校验）
# --------------------------------------------------------------------------- #
def check_basename(name, what="文件名"):
    """返回错误文案或 None。"""
    if not isinstance(name, str) or not name:
        return "%s必须是非空字符串" % what
    if len(name) > MAX_BASENAME:
        return "%s过长（最多 %d 字符）" % (what, MAX_BASENAME)
    if not BASENAME_RE.match(name):
        return "%s只允许 ASCII 字母、数字与 . _ -，且必须以字母或数字开头：%s" % (what, name)
    if name in (".", ".."):
        return "%s不能是 . 或 .." % what
    if ".." in name:
        return "%s不能包含连续 ..：%s" % (what, name)
    if name.endswith("."):
        return "%s不能以点结尾：%s" % (what, name)
    stem = name.rsplit(".", 1)[0] if "." in name else name
    if stem.lower() in RESERVED_NAMES:
        return "%s是 Windows 保留设备名：%s" % (what, name)
    return None


def check_base(base):
    if not isinstance(base, str) or not base:
        raise path_denied("保存路径不允许：base 必须是非空字符串")
    if len(base) > MAX_BASE:
        raise path_denied("保存路径不允许：base 过长")
    if base.startswith("/") or base.endswith("/"):
        raise path_denied("保存路径不允许：base 不能以 / 开头或结尾")
    if "//" in base:
        raise path_denied("保存路径不允许：base 不能包含空目录段")
    if "\\" in base:
        raise path_denied("保存路径不允许：base 不能包含反斜杠")
    if any(ch in base for ch in ":%?#"):
        raise path_denied("保存路径不允许：base 不能包含 : % ? #")
    for seg in base.split("/"):
        bad = check_basename(seg, "base 目录段")
        if bad:
            raise path_denied("保存路径不允许：" + bad)
    return base


def check_target_name(name, exts, what):
    bad = check_basename(name, what)
    if bad:
        raise path_denied("保存路径不允许：" + bad)
    if exts:
        lowered = name.lower()
        if not any(lowered.endswith(e) for e in exts):
            raise path_denied("保存路径不允许：%s必须以下列小写扩展名结尾 %s：%s" % (what, "/".join(exts), name))
        if not any(name.endswith(e) for e in exts):
            raise path_denied("保存路径不允许：%s扩展名必须小写：%s" % (what, name))


# --------------------------------------------------------------------------- #
# JSON / 编码辅助
# --------------------------------------------------------------------------- #
def _reject_constant(value):
    raise ValueError("非法 JSON 常量：%s" % value)


def strict_json_loads(text):
    return json.loads(text, parse_constant=_reject_constant)


def decode_utf8(raw, what):
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise invalid_request("%s不是合法 UTF-8（%s）" % (what, exc.reason))


def decode_base64(data, what):
    if not isinstance(data, str):
        raise invalid_request("%s 的 data 必须是字符串" % what)
    try:
        return base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise invalid_request("%s 不是合法 base64" % what)


def normalize_index(index, wanted_base):
    """校验并规范化索引，返回 (dict, bytes)。字段顺序固定。"""
    if not isinstance(index, dict):
        raise invalid_request("index 必须是 JSON 对象")
    allowed = {"schemaVersion", "base", "label", "files"}
    unknown = [k for k in index if k not in allowed]
    if unknown:
        raise invalid_request("index 含未知字段：%s" % "、".join(sorted(unknown)))

    version = index.get("schemaVersion")
    if isinstance(version, bool) or not isinstance(version, int) or version != 1:
        raise ApiError(400, "UNSUPPORTED_VERSION", "不支持的索引版本：%s；当前仅支持 1" % json.dumps(version, ensure_ascii=False))

    if "base" in index and index["base"] != wanted_base:
        raise ApiError(409, "INDEX_MISMATCH", "索引 base 与请求 base 不一致，请重新载入")

    label = index.get("label")
    if label is not None:
        if not isinstance(label, str):
            raise invalid_request("index.label 必须是字符串")
        if not (1 <= len(label) <= MAX_LABEL):
            raise invalid_request("index.label 长度必须在 1..%d 之间" % MAX_LABEL)

    files = index.get("files")
    if not isinstance(files, dict):
        raise invalid_request("index.files 必须是对象")
    unknown = [k for k in files if k not in ("model", "atlas", "textures")]
    if unknown:
        raise invalid_request("index.files 含未知字段：%s" % "、".join(sorted(unknown)))

    model = files.get("model")
    atlas = files.get("atlas")
    textures = files.get("textures")
    check_target_name(model, [".json"], "index.files.model")
    if model == INDEX_NAME:
        raise path_denied("保存路径不允许：files.model 不能是 index.json")
    check_target_name(atlas, [".atlas"], "index.files.atlas")
    if not isinstance(textures, list) or not (1 <= len(textures) <= MAX_TEXTURES):
        raise invalid_request("index.files.textures 必须是 1..%d 个文件名的数组" % MAX_TEXTURES)
    for name in textures:
        check_target_name(name, [".png", ".webp"], "index.files.textures")
    if len({n.lower() for n in textures}) != len(textures):
        raise path_denied("保存路径不允许：贴图文件名重复")

    targets = [INDEX_NAME, model, atlas] + list(textures)
    if len({n.lower() for n in targets}) != len(targets):
        raise path_denied("保存路径不允许：索引目标文件名冲突")

    out = {"schemaVersion": 1, "base": wanted_base}
    if label is not None:
        out["label"] = label
    out["files"] = {"model": model, "atlas": atlas, "textures": list(textures)}
    data = (json.dumps(out, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    if len(data) > MAX_INDEX_BYTES:
        raise ApiError(413, "PAYLOAD_TOO_LARGE", "规范化索引超过 %d 字节" % MAX_INDEX_BYTES)
    return out, data


def check_signature(name, data):
    lowered = name.lower()
    if lowered.endswith(".png"):
        if not data.startswith(PNG_SIGNATURE):
            raise invalid_request("贴图 %s 的文件头不是 PNG" % name, file=name)
    elif lowered.endswith(".webp"):
        if not (data.startswith(WEBP_SIGNATURE) and data[8:12] == WEBP_TAG):
            raise invalid_request("贴图 %s 的文件头不是 WebP" % name, file=name)


# --------------------------------------------------------------------------- #
# 磁盘与原子替换
# --------------------------------------------------------------------------- #
def lstat_regular(path):
    """返回 stat 或抛 ApiError；拒绝缺失/符号链接/目录/FIFO/硬链接。"""
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        raise ApiError(404, "BUNDLE_NOT_FOUND", "找不到索引或资源，请重新载入（服务不创建目录/文件）", file=path.name)
    except OSError as exc:
        raise path_denied("保存路径不允许：%s（%s）" % (path.name, exc.strerror or exc))
    if os.path.islink(path):
        raise path_denied("保存路径不允许：目标是符号链接：%s" % path.name)
    if not os.path.isfile(path):
        raise path_denied("保存路径不允许：目标不是普通文件：%s" % path.name)
    if st.st_nlink > 1:
        raise path_denied("保存路径不允许：目标是硬链接：%s" % path.name)
    return st


def realpath_inside(root, base, target):
    """resolved parent 必须等于 resolved base，且都在 root 内。"""
    try:
        real_base = pathlib.Path(base).resolve(strict=True)
        real_target = pathlib.Path(target).resolve(strict=True)
    except OSError:
        raise ApiError(404, "BUNDLE_NOT_FOUND", "找不到索引或资源，请重新载入（服务不创建目录/文件）")
    try:
        real_base.relative_to(root)
        real_target.relative_to(root)
    except ValueError:
        raise path_denied("保存路径不允许：目标越出仓库目录")
    if real_target.parent != real_base:
        raise path_denied("保存路径不允许：目标不在索引目录内")
    return real_base, real_target


def check_no_symlink_chain(root, rel_dir):
    """root 到 base 的每个目录段都不得是符号链接。"""
    current = root
    for seg in rel_dir.split("/"):
        current = current / seg
        try:
            st = os.lstat(current)
        except FileNotFoundError:
            raise ApiError(404, "BUNDLE_NOT_FOUND", "找不到索引或资源，请重新载入（服务不创建目录/文件）")
        if os.path.islink(current):
            raise path_denied("保存路径不允许：目录含符号链接：%s" % seg)
        if not os.path.isdir(current):
            raise path_denied("保存路径不允许：%s 不是目录" % seg)


def write_temp(base_dir, data, mode):
    fd, tmp = tempfile.mkstemp(dir=str(base_dir), prefix=".spine-save-")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, mode & 0o777)
        return tmp
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def best_effort_fsync_dir(base_dir):
    try:
        fd = os.open(str(base_dir), os.O_RDONLY)
    except OSError:
        return False
    try:
        os.fsync(fd)
        return True
    except OSError:
        return False
    finally:
        os.close(fd)


# --------------------------------------------------------------------------- #
# 事件表保存（只写 events.json；与 /api/save-bundle 完全独立的一条链路）
# --------------------------------------------------------------------------- #
EVENTS_NAME = "events.json"
EVENTS_API_VERSION = 1
MAX_EVENTS_BYTES = 16 * 1024 * 1024

# 事件表情的 7 个语义部位（与 docs/dsh-pets-character-pack-format-v3.md §expression 一致）。
# 顺序即规范里的表格顺序；服务端独立重新校验，不信任前端。
EXPRESSION_PART_KEYS = (
    "左眼", "右眼", "眉毛_左", "眉毛_右", "眨眼_左", "眨眼_右", "嘴巴",
)
# 0.9.35：可选部位 —— 事件可以不写该键（缺省视为 null）。
# 服务端独立校验，不信任前端：键必须落在「必填 + 可选」范围内，且必填键不能缺。
EXPRESSION_PART_KEYS_OPTIONAL = ("嘴巴特效",)


def _json_dump_crlf(obj):
    """序列化并按仓库约定统一成 CRLF（零裸 LF）。

    events.json 在仓库里是纯 CRLF（实测 976 CRLF / 0 裸 LF）；写成 LF 会让整文件
    diff 全部翻红，看起来像改了上千行其实只改了一处。
    """
    return (json.dumps(obj, ensure_ascii=False, indent=2) + "\n").replace("\n", "\r\n")


def _validate_event_expression(expr):
    """校验一个事件的 expression（7 部位，眨眼组允许 iris/lash/white）。返回错误文案或 None。"""
    if not isinstance(expr, dict):
        return "expression 必须是对象"
    allowed = set(EXPRESSION_PART_KEYS) | set(EXPRESSION_PART_KEYS_OPTIONAL)
    unknown = [k for k in expr if k not in allowed]
    if unknown:
        return "expression 含未知部位：%s" % "、".join(sorted(unknown))
    missing = [k for k in EXPRESSION_PART_KEYS if k not in expr]
    if missing:
        return "expression 缺部位：%s" % "、".join(missing)
    # 可选部位：出现时必须是非空字符串或 null（与必填部位的取值约束一致）
    for k in EXPRESSION_PART_KEYS_OPTIONAL:
        if k in expr:
            v = expr[k]
            if v is not None and not isinstance(v, str):
                return "%s 必须是字符串或 null" % k
    for part in ("眨眼_左", "眨眼_右"):
        val = expr.get(part)
        if val is None:
            continue
        if not isinstance(val, dict):
            return "%s 必须是对象或 null" % part
        unknown_keys = [k for k in val if k not in ("iris", "lash", "white")]
        if unknown_keys:
            return "%s 含未知键：%s（只允许 iris / lash / white）" % (part, "、".join(sorted(unknown_keys)))
        for k in ("iris", "lash", "white"):
            if k in val and val[k] is not None and not isinstance(val[k], str):
                return "%s.%s 必须是字符串或 null" % (part, k)
    for part in ("左眼", "右眼", "眉毛_左", "眉毛_右", "嘴巴"):
        val = expr.get(part)
        if val is not None and not isinstance(val, str):
            return "%s 必须是字符串或 null" % part
    # 互斥：整眼非空时，同侧眨眼组必须为 null（v3 E5 规则）
    if expr.get("左眼") is not None and expr.get("眨眼_左") is not None:
        return "左眼（整眼）与 眨眼_左 不能同时非空"
    if expr.get("右眼") is not None and expr.get("眨眼_右") is not None:
        return "右眼（整眼）与 眨眼_右 不能同时非空"
    # v3 不支持 wink：整眼必须两侧同时有或同时无
    if expr.get("左眼") is not None and expr.get("右眼") is None:
        return "单眼整眼（左非空右空）在 v3 不支持"
    if expr.get("右眼") is not None and expr.get("左眼") is None:
        return "单眼整眼（右非空左空）在 v3 不支持"
    return None


def perform_save_events(root, body):
    """把 events.json 写回磁盘；返回 (changed, unchanged)。

    请求形：{apiVersion, base, events, expressionByEvent:{id: expression}}

    安全设计（与 bundle 保存同一套口径）：
      · base 必须是仓库内相对路径，且只能是 <base>/events.json；
      · 只改**请求里点名的事件**的 expression 字段，其余事件、category、lines、
        presentation、schemaVersion 等一律原样保留 —— 目标清单之外一律不动；
      · 写入前把「改后对象」与「磁盘原文」都做一次校验，任一失败即拒绝；
      · 原子替换（同目录临时文件 + os.replace），失败回滚。
    """
    if not isinstance(body, dict):
        raise invalid_request("请求正文必须是 JSON 对象")
    if body.get("apiVersion") != EVENTS_API_VERSION or isinstance(body.get("apiVersion"), bool):
        raise ApiError(400, "UNSUPPORTED_VERSION", "不支持的 API 版本；当前仅支持 %d" % EVENTS_API_VERSION)
    allowed = {"apiVersion", "base", "events", "expressionByEvent"}
    unknown = [k for k in body if k not in allowed]
    if unknown:
        raise invalid_request("请求含未知字段：%s" % "、".join(sorted(unknown)))

    base_rel = body.get("base")
    check_base(base_rel)
    base_dir = root / base_rel
    rel = body.get("events")
    if rel != EVENTS_NAME:
        raise invalid_request("events 必须是 %s（只允许写这一个文件）" % EVENTS_NAME)
    target = base_dir / EVENTS_NAME
    st = lstat_regular(target)
    realpath_inside(root, base_dir, target)

    patches = body.get("expressionByEvent")
    if not isinstance(patches, dict) or not patches:
        raise invalid_request("expressionByEvent 必须是非空对象（事件 id → expression）")
    if len(patches) > 200:
        raise invalid_request("一次最多修改 200 个事件")

    try:
        old_bytes = target.read_bytes()
    except OSError as exc:
        raise ApiError(500, "READ_FAILED", "读取 events.json 失败：%s" % (exc.strerror or exc))
    try:
        doc = json.loads(old_bytes.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ApiError(409, "EVENTS_NOT_JSON", "磁盘上的 events.json 不是合法 JSON：%s" % exc)
    if not isinstance(doc, dict) or not isinstance(doc.get("events"), list):
        raise ApiError(409, "EVENTS_SHAPE", "磁盘上的 events.json 结构不符合预期（需要 {events:[...]}）")
    if len(old_bytes) > MAX_EVENTS_BYTES:
        raise ApiError(413, "EVENTS_TOO_LARGE", "events.json 超过 %d 字节" % MAX_EVENTS_BYTES)

    by_id = {}
    for ev in doc["events"]:
        if isinstance(ev, dict) and isinstance(ev.get("id"), str):
            by_id[ev["id"]] = ev

    changed_ids = []
    for event_id in sorted(patches):
        if event_id not in by_id:
            raise invalid_request("events.json 里没有事件 %s，拒绝创建新事件" % event_id)
        expr = patches[event_id]
        err = _validate_event_expression(expr)
        if err:
            raise invalid_request("%s：%s" % (event_id, err))
        ev = by_id[event_id]
        # 只替换 expression 一个字段；其余字段对象引用原样保留
        if json.dumps(ev.get("expression"), sort_keys=True, ensure_ascii=False) != \
           json.dumps(expr, sort_keys=True, ensure_ascii=False):
            ev["expression"] = expr
            changed_ids.append(event_id)

    if not changed_ids:
        return [], [EVENTS_NAME]

    try:
        new_bytes = _json_dump_crlf(doc).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise invalid_request("写入前序列化失败：%s" % exc)

    # 回读自检：序列化后的内容必须仍是合法 JSON，且非目标事件逐字段未变
    try:
        reread = json.loads(new_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ApiError(500, "SERIALIZE_SELF_CHECK", "写入前自检失败（回读不是合法 JSON）：%s" % exc)
    for ev in reread.get("events", []):
        eid = ev.get("id") if isinstance(ev, dict) else None
        if eid in changed_ids or eid is None:
            continue
        if json.dumps(ev, sort_keys=True, ensure_ascii=False) != \
           json.dumps(by_id[eid], sort_keys=True, ensure_ascii=False):
            raise ApiError(500, "SERIALIZE_SELF_CHECK", "写入前自检失败：事件 %s 被意外改动" % eid)

    if new_bytes == old_bytes:
        return [], [EVENTS_NAME]

    tmp = None
    try:
        tmp = write_temp(base_dir, new_bytes, st.st_mode)
        lstat_regular(target)
        realpath_inside(root, base_dir, target)
        os.replace(tmp, target)
        tmp = None
    except BaseException:
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass
        # 回滚：用旧字节重建
        try:
            t2 = write_temp(base_dir, old_bytes, st.st_mode)
            os.replace(t2, target)
        except BaseException:
            raise ApiError(
                500,
                "ROLLBACK_FAILED",
                "写入失败且回滚失败，请手动检查 events.json",
                extra={"changed": [EVENTS_NAME], "uncertain": [EVENTS_NAME]},
            )
        raise ApiError(500, "WRITE_FAILED", "写入失败，已恢复原文件；内存中的改动仍保留", extra={"changed": []})

    return changed_ids, []


# --------------------------------------------------------------------------- #
# 本地项目扫描（只读；不碰 SAVE_LOCK / perform_save）
# --------------------------------------------------------------------------- #
PACKS_SUBDIR = "workspace/packs"
PACK_ENTRY = "manifest.json"
# 单个包的目录大小上限：超过就只统计到上限为止（避免扫到超大包把接口拖死）
PACK_SIZE_BUDGET = 200 * 1024 * 1024


def _safe_read_json(path):
    """读一个 JSON 文件；失败返回 None（元信息缺失不应让整个列表失败）。"""
    try:
        with open(path, "rb") as fh:
            return json.loads(fh.read().decode("utf-8-sig"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None


def _dir_stats(pack_dir):
    """(文件数, 字节数)；有预算上限，超限后停止累加但仍继续计数文件。"""
    count = 0
    total = 0
    budget_hit = False
    for dirpath, _dirnames, filenames in os.walk(pack_dir):
        for name in filenames:
            count += 1
            if budget_hit:
                continue
            try:
                total += os.path.getsize(os.path.join(dirpath, name))
            except OSError:
                continue
            if total > PACK_SIZE_BUDGET:
                budget_hit = True
    return count, total, budget_hit


def _pack_meta(root, pack_dir):
    """读一个包的 manifest + catalog，拼出展示用元信息；不支持/损坏也返回条目（带 issues）。"""
    manifest = _safe_read_json(os.path.join(pack_dir, PACK_ENTRY))
    rel = pack_dir.relative_to(root).as_posix()
    issues = []
    if not isinstance(manifest, dict):
        return {
            "path": rel,
            "dirName": pack_dir.name,
            "ok": False,
            "issues": ["manifest.json 缺失或不是合法 JSON 对象"],
        }

    def label_of(display):
        if isinstance(display, dict):
            for key in ("zh", "en"):
                val = display.get(key)
                if isinstance(val, str) and val.strip():
                    return val.strip()
        if isinstance(display, str) and display.strip():
            return display.strip()
        return None

    label = label_of(manifest.get("displayName")) or manifest.get("characterName") or manifest.get("id")
    issues_out = list(issues)

    pack_format = manifest.get("packFormatVersion")
    manifest_schema = manifest.get("manifestSchemaVersion")
    # 与编辑器 bundle.js 同一套判定：packFormatVersion 必须 3、manifestSchemaVersion 必须 2
    if pack_format != 3:
        issues_out.append("packFormatVersion 不是 3，编辑器会按旧格式拒绝")
    if manifest_schema != 2:
        issues_out.append("manifestSchemaVersion 不是 2，编辑器会按旧格式拒绝")

    anim_count = None
    slot_count = None
    generation = None
    catalog_rel = manifest.get("catalog")
    if isinstance(catalog_rel, str) and catalog_rel:
        catalog = _safe_read_json(os.path.join(pack_dir, *catalog_rel.split("/")))
        if isinstance(catalog, dict):
            anns = catalog.get("animations")
            anim_count = len(anns) if isinstance(anns, (list, dict)) else None
            slots = catalog.get("slots")
            slot_count = len(slots) if isinstance(slots, (list, dict)) else None
            generation = catalog.get("generation")
            stale = catalog.get("stale")
            if isinstance(stale, list) and stale:
                issues_out.append("catalog stale %d 条" % len(stale))
            unresolved = catalog.get("unresolved")
            if isinstance(unresolved, list) and unresolved:
                issues_out.append("catalog unresolved %d 条" % len(unresolved))
        else:
            issues_out.append("catalog.json 读不到（动画/槽数未知）")

    licenses = manifest.get("license")
    credits = manifest.get("credits")
    file_count, byte_total, budget_hit = _dir_stats(pack_dir)

    return {
        "path": rel,
        "dirName": pack_dir.name,
        "ok": True,
        "entry": "manifest.json",
        "id": manifest.get("id"),
        "version": manifest.get("version"),
        "label": label,
        "packFormatVersion": pack_format,
        "manifestSchemaVersion": manifest_schema,
        "license": licenses,
        "creditsCount": len(credits) if isinstance(credits, list) else 0,
        "animCount": anim_count,
        "slotCount": slot_count,
        "catalogGeneration": generation,
        "fileCount": file_count,
        "bytes": byte_total,
        "sizeBudgetHit": budget_hit,
        "hasVoice": isinstance(manifest.get("voice"), dict) and bool(manifest["voice"].get("index")),
        "hasSequences": isinstance(manifest.get("sequences"), dict) and bool(manifest["sequences"].get("index")),
        "official": manifest.get("official") if isinstance(manifest.get("official"), bool) else None,
        "issues": issues_out,
    }


def scan_packs(root):
    """扫 workspace/packs 下的一层子目录；返回 (packs, scannedAtIso, rootRel)。

    只扫一层：包根就是 workspace/packs/<name>/，不递归进包内部找 manifest，
    以免把 fixtures 或包里的备份误当成独立项目。
    """
    packs_root = root / PACKS_SUBDIR
    packs = []
    if packs_root.is_dir():
        try:
            entries = sorted(packs_root.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            entries = []
        for item in entries:
            try:
                if not item.is_dir():
                    continue
            except OSError:
                continue
            packs.append(_pack_meta(root, item))
    return packs


# --------------------------------------------------------------------------- #
# 保存实现
# --------------------------------------------------------------------------- #
QUEUE_ORDER = "textures-atlas-model-index"


def perform_save(root, body):
    """把请求应用到磁盘；返回 (changed, unchanged)。失败抛 ApiError。"""
    if not isinstance(body, dict):
        raise invalid_request("请求正文必须是 JSON 对象")
    if body.get("apiVersion") != API_VERSION or isinstance(body.get("apiVersion"), bool):
        raise ApiError(400, "UNSUPPORTED_VERSION", "不支持的 API 版本；当前仅支持 1")

    allowed = {"apiVersion", "base", "index", "model", "atlas", "textures"}
    unknown = [k for k in body if k not in allowed]
    if unknown:
        raise invalid_request("请求含未知字段：%s" % "、".join(sorted(unknown)))

    base_rel = body.get("base")
    check_base(base_rel)

    index, index_bytes = normalize_index(body.get("index"), base_rel)
    files = index["files"]
    model_name = files["model"]
    atlas_name = files["atlas"]
    texture_names = list(files["textures"])
    target_order = [INDEX_NAME, model_name, atlas_name] + texture_names

    model_env = body.get("model")
    atlas_env = body.get("atlas")
    textures_env = body.get("textures")
    for env, name, path in (
        (model_env, model_name, "model"),
        (atlas_env, atlas_name, "atlas"),
    ):
        if not isinstance(env, dict):
            raise invalid_request("%s 必须是文件封套对象" % path)
        if env.get("name") != name:
            raise invalid_request("%s.name 必须与 index.files 一致（%s）" % (path, name))
        if env.get("encoding") != "utf8":
            raise invalid_request("%s.encoding 必须是 utf8" % path)
        if not isinstance(env.get("data"), str):
            raise invalid_request("%s.data 必须是字符串" % path)

    if not isinstance(textures_env, list):
        raise invalid_request("textures 必须是数组")
    if len(textures_env) != len(texture_names):
        raise invalid_request("textures 数量与索引不一致")
    for i, name in enumerate(texture_names):
        env = textures_env[i]
        if not isinstance(env, dict):
            raise invalid_request("textures[%d] 必须是文件封套对象" % i)
        if env.get("name") != name:
            raise invalid_request("textures[%d].name 必须与索引一致（%s）" % (i, name))
        if env.get("encoding") != "base64":
            raise invalid_request("textures[%d].encoding 必须是 base64" % i)
        if not isinstance(env.get("data"), str):
            raise invalid_request("textures[%d].data 必须是字符串" % i)

    # 解码正文
    model_bytes = model_env["data"].encode("utf-8")
    if len(model_bytes) > MAX_MODEL_BYTES:
        raise ApiError(413, "PAYLOAD_TOO_LARGE", "model.json 超过 %d 字节" % MAX_MODEL_BYTES)
    model_text = decode_utf8(model_bytes, "model.json")
    if model_text.startswith("\ufeff"):
        raise invalid_request("model.json 不能带 BOM")
    try:
        model_obj = strict_json_loads(model_text)
    except ValueError as exc:
        raise invalid_request("model.json 不是合法 JSON：%s" % exc)
    if not isinstance(model_obj, dict):
        raise invalid_request("model.json 顶层必须是对象")
    if not isinstance(model_obj.get("bones"), list):
        raise invalid_request("model.json 缺少 bones 数组")

    atlas_bytes = atlas_env["data"].encode("utf-8")
    if len(atlas_bytes) > MAX_ATLAS_BYTES:
        raise ApiError(413, "PAYLOAD_TOO_LARGE", "model.atlas 超过 %d 字节" % MAX_ATLAS_BYTES)
    atlas_text = decode_utf8(atlas_bytes, "model.atlas")
    if not atlas_text.strip():
        raise invalid_request("model.atlas 不能为空")

    texture_bytes = []
    for i, name in enumerate(texture_names):
        data = decode_base64(textures_env[i]["data"], "textures[%d]" % i)
        if len(data) > MAX_TEXTURE_BYTES:
            raise ApiError(413, "PAYLOAD_TOO_LARGE", "贴图 %s 超过 %d 字节" % (name, MAX_TEXTURE_BYTES))
        check_signature(name, data)
        texture_bytes.append(data)

    if len(index_bytes) + len(model_bytes) + len(atlas_bytes) + sum(len(t) for t in texture_bytes) > MAX_TOTAL_OUT:
        raise ApiError(413, "PAYLOAD_TOO_LARGE", "解码后所有输出文件总和超过 %d 字节" % MAX_TOTAL_OUT)

    # 磁盘侧校验
    base_dir = root / base_rel
    check_no_symlink_chain(root, base_rel)
    if not base_dir.is_dir():
        raise ApiError(404, "BUNDLE_NOT_FOUND", "找不到索引目录，请重新载入（服务不创建目录/文件）")

    disk_targets = []
    for name in target_order:
        target = base_dir / name
        st = lstat_regular(target)
        realpath_inside(root, base_dir, target)
        disk_targets.append((name, target, st))

    disk_index_path = base_dir / INDEX_NAME
    try:
        disk_index_raw = disk_index_path.read_bytes()
    except OSError:
        raise ApiError(404, "BUNDLE_NOT_FOUND", "找不到索引或资源，请重新载入（服务不创建目录/文件）")
    try:
        disk_index = strict_json_loads(decode_utf8(disk_index_raw, "索引"))
    except ValueError as exc:
        raise invalid_request("磁盘索引不是合法 JSON：%s" % exc)
    if not isinstance(disk_index, dict) or not isinstance(disk_index.get("files"), dict):
        raise invalid_request("磁盘索引缺少 files")
    disk_files = disk_index["files"]
    same_files = (
        disk_files.get("model") == model_name
        and disk_files.get("atlas") == atlas_name
        and list(disk_files.get("textures") or []) == texture_names
    )
    if not same_files:
        raise ApiError(409, "INDEX_MISMATCH", "磁盘索引文件清单与当前模型不一致，请重新载入")
    if disk_index.get("base") not in (None, base_rel):
        raise ApiError(409, "INDEX_MISMATCH", "磁盘索引 base 与请求不一致，请重新载入")

    # 逐文件比较字节
    new_bytes = {INDEX_NAME: index_bytes, model_name: model_bytes, atlas_name: atlas_bytes}
    for i, name in enumerate(texture_names):
        new_bytes[name] = texture_bytes[i]

    old_bytes = {}
    for name, target, st in disk_targets:
        old_bytes[name] = target.read_bytes()

    changed = []
    unchanged = []
    for name in target_order:
        if old_bytes[name] == new_bytes[name]:
            unchanged.append(name)
        else:
            changed.append(name)
    if not changed:
        return [], unchanged

    # 阶段一：写同目录临时文件
    staged = {}
    try:
        for name, target, st in disk_targets:
            if name not in changed:
                continue
            staged[name] = write_temp(base_dir, new_bytes[name], st.st_mode)
    except BaseException:
        for tmp in staged.values():
            try:
                os.unlink(tmp)
            except OSError:
                pass
        raise ApiError(500, "WRITE_FAILED", "保存失败，已恢复原文件；内存中的改动仍保留", extra={"rollback": "complete", "changed": []})

    # 阶段二：替换（textures → atlas → model → index）
    replace_order = list(texture_names) + [atlas_name, model_name, INDEX_NAME]
    replace_order = [n for n in replace_order if n in staged]
    replaced = []
    try:
        for name in replace_order:
            # 替换前再验一次身份与链接条件
            target = base_dir / name
            lstat_regular(target)
            realpath_inside(root, base_dir, target)
            os.replace(staged[name], target)
            staged.pop(name, None)
            replaced.append(name)
    except BaseException as exc:
        # 回滚：逆序用旧字节重建临时文件再替换
        restored = []
        failed = []
        for name in reversed(replaced):
            target = base_dir / name
            mode = 0o644
            if target.exists():
                mode = os.stat(target).st_mode
            try:
                tmp = write_temp(base_dir, old_bytes[name], mode)
                os.replace(tmp, target)
                restored.append(name)
            except BaseException:
                failed.append(name)
        for tmp in staged.values():
            try:
                os.unlink(tmp)
            except OSError:
                pass
        if failed:
            raise ApiError(
                500,
                "ROLLBACK_FAILED",
                "保存失败且部分文件未能恢复，请先检查磁盘或重新载入",
                extra={
                    "rollback": "partial",
                    "restored": restored,
                    "changed": failed,
                    "uncertain": failed,
                },
            )
        raise ApiError(
            500,
            "WRITE_FAILED",
            "保存失败，已恢复原文件；内存中的改动仍保留",
            extra={"rollback": "complete", "restored": restored, "changed": []},
        )

    best_effort_fsync_dir(base_dir)
    return changed, unchanged


# --------------------------------------------------------------------------- #
# HTTP Handler
# --------------------------------------------------------------------------- #
class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "CharacterEditor/1.0"

    # -- 日志：只打印 4xx/5xx，避免刷屏 ---------------------------------- #
    def log_message(self, fmt, *args):
        try:
            code = str(args[1])
        except (IndexError, TypeError):
            code = ""
        if code.startswith(("4", "5")):
            super().log_message(fmt, *args)

    # -- 基础 ------------------------------------------------------------ #
    def end_headers(self):
        """静态资源也禁止缓存：本地工具边改边看，避免 HTML/JS/CSS 混用旧缓存。"""
        buffered = b"".join(getattr(self, "_headers_buffer", []) or [])
        if b"Cache-Control" not in buffered:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    @property
    def root(self):
        return pathlib.Path(self.server.repo_root)

    @property
    def write_enabled(self):
        return bool(getattr(self.server, "write_enabled", False))

    def allowed_hosts(self):
        port = self.server.server_address[1]
        hosts = {"127.0.0.1:%d" % port, "localhost:%d" % port}
        if port == 80:
            hosts |= {"127.0.0.1", "localhost"}
        return hosts

    def request_host(self):
        values = self.headers.get_all("Host") or []
        if len(values) != 1:
            raise ApiError(403, "HOST_DENIED", "主机不允许", close=True)
        host = values[0].strip()
        if host not in self.allowed_hosts():
            raise ApiError(403, "HOST_DENIED", "主机不允许", close=True)
        return host

    def send_json(self, status, payload, close=False):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass
        if close:
            self.close_connection = True

    def fail(self, err):
        self.send_json(err.status, err.payload(), close=err.close)

    # -- 请求入口 -------------------------------------------------------- #
    def do_GET(self):
        if self.path.startswith("/api/"):
            self.handle_api_get()
            return
        super().do_GET()

    def do_HEAD(self):
        if self.path.startswith("/api/"):
            self.handle_api_get()
            return
        super().do_HEAD()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self.handle_api_post()
            return
        self.send_json(405, {"ok": False, "apiVersion": API_VERSION, "error": {"code": "METHOD_NOT_ALLOWED", "message": "只支持静态 GET 与 API 请求"}})

    def do_OPTIONS(self):
        # 契约 §3.1：不提供任何跨源许可
        self.send_json(403, {"ok": False, "apiVersion": API_VERSION, "error": {"code": "ORIGIN_DENIED", "message": "请求来源不允许"}}, close=True)

    def do_PUT(self):
        self.handle_other_method()

    do_DELETE = do_PUT
    do_PATCH = do_PUT

    def handle_other_method(self):
        # 契约 §3.5：非 POST 写方法 405；未知 API 路径 404
        path = self.path.split("?")[0]
        if path == "/api/save-bundle":
            self.send_json(
                405,
                {"ok": False, "apiVersion": API_VERSION, "error": {"code": "METHOD_NOT_ALLOWED", "message": "保存只接受 POST"}},
            )
            return
        self.send_json(405, {"ok": False, "apiVersion": API_VERSION, "error": {"code": "METHOD_NOT_ALLOWED", "message": "方法不允许"}})

    # -- API: GET -------------------------------------------------------- #
    def handle_api_get(self):
        try:
            self.request_host()
        except ApiError as err:
            self.fail(err)
            return
        path = self.path.split("?")[0]
        if path == "/api/save-bundle":
            self.send_json(
                405,
                {"ok": False, "apiVersion": API_VERSION, "error": {"code": "METHOD_NOT_ALLOWED", "message": "保存只接受 POST"}},
            )
            return
        if path == "/api/packs":
            # 只读：扫描 workspace/packs 下的人物包，返回元信息（不进入保存链路）
            try:
                packs = scan_packs(self.root)
            except Exception as err:  # noqa: BLE001 — 扫描失败不该 500 崩掉编辑器
                self.send_json(
                    200,
                    {
                        "ok": False,
                        "apiVersion": API_VERSION,
                        "root": PACKS_SUBDIR,
                        "packs": [],
                        "error": {"code": "SCAN_FAILED", "message": "扫描失败：%s" % (err,)},
                    },
                )
                return
            self.send_json(
                200,
                {
                    "ok": True,
                    "apiVersion": API_VERSION,
                    "root": PACKS_SUBDIR,
                    "packs": packs,
                    "count": len(packs),
                },
            )
            return
        if path != "/api/capabilities":
            self.send_json(404, {"ok": False, "apiVersion": API_VERSION, "error": {"code": "NOT_FOUND", "message": "未知 API 路径"}})
            return
        self.send_json(
            200,
            {
                "apiVersion": API_VERSION,
                "saveBundle": self.write_enabled,
                "saveEvents": self.write_enabled,
                "maxBodyBytes": MAX_BODY_BYTES,
                "externalModificationCheck": False,
            },
        )

    # -- API: POST /api/save-events -------------------------------------- #
    def handle_api_save_events(self):
        """POST /api/save-events —— 只写 events.json 的 expression 字段。

        与 /api/save-bundle 共用回环校验 / 写入锁 / 原子替换口径，但**独立端点**：
        保存事件表不该要求调用方同时把所有模型贴图字节带上。
        """
        try:
            host = self.request_host()
            self.check_write_allowed(host)
            length = self.check_length()
        except ApiError as err:
            self.fail(err)
            return

        if not SAVE_LOCK.acquire(blocking=False):
            self.send_json(409, {"ok": False, "apiVersion": EVENTS_API_VERSION, "error": {"code": "SAVE_BUSY", "message": "正在保存，请稍后重试"}})
            return
        try:
            raw = self.read_body(length)
            try:
                body = strict_json_loads(raw.decode("utf-8"))
            except UnicodeDecodeError as exc:
                raise invalid_request("正文不是合法 UTF-8（%s）" % exc.reason)
            except ValueError as exc:
                raise invalid_request("正文不是合法 JSON：%s" % exc)
            changed, unchanged = perform_save_events(self.root, body)
            self.send_json(
                200,
                {
                    "ok": True,
                    "apiVersion": EVENTS_API_VERSION,
                    "base": body.get("base"),
                    "changed": changed,
                    "unchanged": unchanged,
                    "message": ("已更新 %d 个事件的 expression" % len(changed)) if changed else "没有事件需要更新",
                },
            )
        except ApiError as err:
            self.fail(err)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except OSError as exc:
            self.send_json(
                500,
                {
                    "ok": False,
                    "apiVersion": EVENTS_API_VERSION,
                    "error": {"code": "WRITE_FAILED", "message": "写入 events.json 失败（%s）" % (exc.strerror or "IO 错误")},
                },
            )
        finally:
            SAVE_LOCK.release()

    # -- API: POST /api/save-bundle -------------------------------------- #
    def handle_api_post(self):
        path = self.path.split("?")[0]
        if path == "/api/save-events":
            self.handle_api_save_events()
            return
        if path == "/api/capabilities":
            self.send_json(
                405,
                {"ok": False, "apiVersion": API_VERSION, "error": {"code": "METHOD_NOT_ALLOWED", "message": "能力探测只接受 GET"}},
            )
            return
        if path != "/api/save-bundle":
            self.send_json(404, {"ok": False, "apiVersion": API_VERSION, "error": {"code": "NOT_FOUND", "message": "未知 API 路径"}})
            return

        try:
            host = self.request_host()
            self.check_write_allowed(host)
            length = self.check_length()
        except ApiError as err:
            self.fail(err)
            return

        if not SAVE_LOCK.acquire(blocking=False):
            self.send_json(409, {"ok": False, "apiVersion": API_VERSION, "error": {"code": "SAVE_BUSY", "message": "正在保存，请稍后重试"}})
            return
        try:
            raw = self.read_body(length)
            try:
                body = strict_json_loads(raw.decode("utf-8"))
            except UnicodeDecodeError as exc:
                raise invalid_request("正文不是合法 UTF-8（%s）" % exc.reason)
            except ValueError as exc:
                raise invalid_request("正文不是合法 JSON：%s" % exc)
            changed, unchanged = perform_save(self.root, body)
            if changed:
                message = "已保存 %d 个文件，%d 个文件未变化" % (len(changed), len(unchanged))
            else:
                message = "%d 个文件均未变化，无需写入" % len(unchanged)
            self.send_json(
                200,
                {
                    "ok": True,
                    "apiVersion": API_VERSION,
                    "base": body.get("base"),
                    "changed": changed,
                    "unchanged": unchanged,
                    "message": message,
                },
            )
        except ApiError as err:
            self.fail(err)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except OSError as exc:
            self.send_json(
                500,
                {
                    "ok": False,
                    "apiVersion": API_VERSION,
                    "error": {"code": "WRITE_FAILED", "message": "保存失败（%s）；请检查磁盘后重新载入" % (exc.strerror or "IO 错误")},
                },
            )
        finally:
            SAVE_LOCK.release()

    def check_write_allowed(self, host):
        if not self.write_enabled:
            raise ApiError(403, "WRITE_DISABLED", "当前服务不允许写入，请使用回环地址启动编辑器服务", close=True)
        if self.headers.get_all("Transfer-Encoding"):
            raise ApiError(400, "INVALID_REQUEST", "请求格式错误：不接受 Transfer-Encoding", close=True)
        origins = self.headers.get_all("Origin") or []
        if len(origins) != 1:
            raise ApiError(403, "ORIGIN_DENIED", "请求来源不允许", close=True)
        origin = origins[0].strip()
        if origin != "http://" + host:
            raise ApiError(403, "ORIGIN_DENIED", "请求来源不允许", close=True)
        header = self.headers.get_all(SAVE_HEADER_NAME) or []
        if len(header) != 1 or header[0].strip() != SAVE_HEADER:
            raise ApiError(403, "HEADER_REQUIRED", "缺少编辑器保存请求头", close=True)
        ctype = self.headers.get_all("Content-Type") or []
        if len(ctype) != 1 or not self.json_content_type_ok(ctype[0]):
            raise ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "保存只接受 application/json（UTF-8）", close=True)
        site = self.headers.get_all("Sec-Fetch-Site") or []
        if site and site[0].strip().lower() not in ("same-origin",):
            raise ApiError(403, "ORIGIN_DENIED", "请求来源不允许", close=True)

    @staticmethod
    def json_content_type_ok(value):
        parts = [p.strip() for p in value.split(";")]
        if not parts or parts[0].lower() != "application/json":
            return False
        for extra in parts[1:]:
            if not extra:
                continue
            if "=" not in extra:
                return False
            key, _, val = extra.partition("=")
            if key.strip().lower() != "charset":
                return False
            if val.strip().strip('"').lower() not in ("utf-8", "utf8"):
                return False
        return True

    def check_length(self):
        values = self.headers.get_all("Content-Length") or []
        if not values:
            raise ApiError(411, "LENGTH_REQUIRED", "保存请求必须声明 Content-Length", close=True)
        if len(values) != 1:
            raise ApiError(400, "INVALID_REQUEST", "请求格式错误：Content-Length 重复", close=True)
        raw = values[0].strip()
        if not raw.isdigit():
            raise ApiError(400, "INVALID_REQUEST", "请求格式错误：Content-Length 非法", close=True)
        length = int(raw)
        if length > MAX_BODY_BYTES:
            raise ApiError(
                413,
                "PAYLOAD_TOO_LARGE",
                "保存内容超过限制（HTTP 正文上限 %d 字节）" % MAX_BODY_BYTES,
                close=True,
            )
        return length

    def read_body(self, length):
        if length == 0:
            raise invalid_request("正文为空")
        self.connection.settimeout(READ_TIMEOUT)
        chunks = []
        remaining = length
        try:
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 1024 * 1024))
                if not chunk:
                    raise invalid_request("正文不完整：连接提前结束")
                chunks.append(chunk)
                remaining -= len(chunk)
        except socket.timeout:
            raise ApiError(400, "INVALID_REQUEST", "请求格式错误：读取正文超时", close=True)
        finally:
            try:
                self.connection.settimeout(None)
            except OSError:
                pass
        return b"".join(chunks)


# --------------------------------------------------------------------------- #
# 启动
# --------------------------------------------------------------------------- #
def repo_root():
    # serve.py 位于 <root>/tools/character-editor/
    return pathlib.Path(__file__).resolve().parents[2]


def is_loopback_bind(bind):
    return bind in ("127.0.0.1", "localhost")


# ---------------------------------------------------------------- 端口占用处理
def port_owner_pid(port):
    """返回监听该端口的 PID；查不到返回 None。"""
    if os.name == "nt":
        try:
            out = subprocess.run(["netstat", "-ano", "-p", "tcp"],
                                 capture_output=True, text=True, timeout=10).stdout
        except Exception:  # noqa: BLE001
            return None
        for line in out.splitlines():
            parts = line.split()
            if len(parts) >= 5 and parts[0].upper() == "TCP" and parts[3].upper() == "LISTENING":
                if parts[1].rsplit(":", 1)[-1] == str(port):
                    try:
                        return int(parts[4])
                    except ValueError:
                        continue
        return None
    for cmd in (["lsof", "-ti", "tcp:%d" % port, "-sTCP:LISTEN"], ["fuser", "%d/tcp" % port]):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout
        except Exception:  # noqa: BLE001
            continue
        for tok in out.split():
            if tok.isdigit():
                return int(tok)
    return None


def process_command_line(pid):
    if os.name == "nt":
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "(Get-CimInstance Win32_Process -Filter \"ProcessId=%d\").CommandLine" % pid],
                capture_output=True, text=True, timeout=20).stdout
            return out.strip()
        except Exception:  # noqa: BLE001
            return ""
    try:
        return subprocess.run(["ps", "-p", str(pid), "-o", "args="],
                              capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:  # noqa: BLE001
        return ""


def kill_pid(pid):
    if os.name == "nt":
        try:
            subprocess.run(["taskkill", "/PID", str(pid), "/F"],
                           capture_output=True, timeout=20)
        except Exception:  # noqa: BLE001
            pass
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass


def _script_self_identifies(arg):
    """判断占用端口的进程是不是「本仓库这份 serve.py」。

    绝对路径直接比对；**相对路径**也接受，但只接受与本脚本仓库相对路径完全一致的那种
    （如 tools/character-editor/serve.py）。这是有意的窄口径：
      · 我们不知道对方进程的 cwd，所以不能把任意相对路径当成自己；
      · 但用相对路径启动旧实例是很常见的事（IDE / 手敲 / 别的启动脚本），
        旧版一律判 False，于是旧实例不会被替换 → 端口被占 → 悄悄换端口 →
        用户在另一个端口上看到「代码是新的、行为是旧的」的怪现象。
      所以这里多认这一种确定形态，其余仍然拒绝。
    """
    if os.path.isabs(arg) and (os.name != "nt" or os.path.splitdrive(arg)[0]):
        return os.path.normcase(os.path.realpath(arg)) == os.path.normcase(os.path.realpath(__file__))
    rel = arg.replace("\\\\", "/").lstrip("./");
    try:
        me = os.path.relpath(os.path.realpath(__file__), os.path.realpath(repo_root()))
    except (OSError, ValueError):
        return False
    return os.path.normcase(rel) == os.path.normcase(me.replace("\\", "/"))


def command_runs_this_script(command):
    """只认 Python 的脚本参数；不猜测另一个进程的工作目录。"""
    try:
        args = shlex.split(command, posix=os.name != "nt")
    except ValueError:
        return False
    if os.name == "nt":
        args = [arg[1:-1] if len(arg) >= 2 and arg[0] == arg[-1] == '"' else arg
                for arg in args]
    if not args:
        return False
    executable = os.path.basename(args[0]).lower()
    if not re.fullmatch(r"(?:python(?:[23](?:\.\d+)*)?w?|py)(?:\.exe)?", executable):
        return False
    for arg in args[1:]:
        if arg == "--":
            break
        if arg in ("-u", "-B", "-E", "-I", "-s", "-S", "-O", "-OO", "-q", "-v"):
            continue
        if executable in ("py", "py.exe") and re.fullmatch(r"-[23](?:\.\d+)*", arg):
            continue
        if arg.startswith("-"):
            # -c / -m 以及无法确认的解释器选项都不能证明脚本身份。
            return False
        break
    else:
        return False
    if arg == "--":
        index = args.index("--") + 1
        if index == len(args):
            return False
        arg = args[index]
    return _script_self_identifies(arg)


def release_port(port, wait=8.0):
    """端口若被本仓库同一路径的旧 serve.py 占着，就结束它并等端口释放。

    返回 (usable, note)：usable=False 表示端口被别人占着，调用方应换端口或退出。
    """
    pid = port_owner_pid(port)
    if pid is None:
        return True, ""
    if pid == os.getpid():
        return True, ""
    cmd = process_command_line(pid)
    if not command_runs_this_script(cmd):
        return False, ("端口 %d 被 PID %d 占用（无法确认为本仓库的 serve.py）：%s"
                       % (port, pid, cmd[:160] or "读取不到命令行"))
    kill_pid(pid)
    deadline = time.time() + wait
    while time.time() < deadline:
        if port_owner_pid(port) is None:
            return True, "已结束占用端口 %d 的旧实例（PID %d）" % (port, pid)
        time.sleep(0.15)
    return False, "旧实例（PID %d）在 %.0f 秒内没有退出，请手动结束后再启动" % (pid, wait)


def port_is_free(port):
    """端口没被监听才算空闲（Windows 的 SO_REUSEADDR 会让 bind 探测误判）。"""
    return port_owner_pid(port) is None


def free_port(preferred, tries=40):
    if preferred == 0:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]
    for p in range(preferred, preferred + tries):
        if port_is_free(p):
            return p
    raise SystemExit("从 %d 起连续 %d 个端口都被占用，请用 --port 指定" % (preferred, tries))


class ThreadingServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    # Windows 的 SO_REUSEADDR 允许“重复绑定”同一端口，两个实例会同时以为自己是服务，
    # 于是出现“旧进程没杀掉也能起第二份”。这里在 Windows 上禁止复用，占用就直接失败。
    allow_reuse_address = os.name != "nt"
    repo_root = ""
    write_enabled = True


def main():
    ap = argparse.ArgumentParser(description="内置人物包管理器本地服务")
    ap.add_argument("--port", type=int, default=8123, help="优先端口，0=随机（默认 8123）")
    ap.add_argument("--bind", default="127.0.0.1", help="监听地址（默认仅本机；非回环只读）")
    ap.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    ap.add_argument("--no-restart", action="store_true", help="不要结束占用端口的旧实例，改用其它端口")
    ap.add_argument("--strict-port", action="store_true", help="端口被其它程序占用时直接退出，不换端口")
    args = ap.parse_args()

    root = repo_root()
    if not (root / "tools" / "character-editor" / "index.html").is_file():
        print("找不到编辑器页面：%s/tools/character-editor/index.html" % root, file=sys.stderr)
        return 1

    port = args.port
    if port and not args.no_restart:
        usable, note = release_port(port)
        if note:
            print(note)
        if not usable:
            if args.strict_port:
                print("已停止：端口 %d 被其它程序占用（换端口用 --port 9000，或先结束它）" % port)
                return 2
            print("改用一个空闲端口继续启动")
    if port == 0:
        port = free_port(0)
    elif not port_is_free(port):
        newport = free_port(port)
        print("端口 %d 仍被占用，改用 %d" % (port, newport))
        port = newport
    bind = args.bind
    write_enabled = is_loopback_bind(bind)
    url = "http://%s:%d%s" % (bind, port, EDITOR_PATH)
    handler = functools.partial(Handler, directory=str(root))

    print("仓库根目录: %s" % root)
    print("编辑器地址: %s" % url)
    if write_enabled:
        print("保存接口: 已启用（POST /api/save-bundle）")
    else:
        print("保存接口: 已禁用（非回环监听 %s，只读模式）" % bind)
    print("按 Ctrl+C 停止服务")
    sys.stdout.flush()

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    with ThreadingServer((bind, port), handler) as httpd:
        httpd.repo_root = str(root)
        httpd.write_enabled = write_enabled
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
