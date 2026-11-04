#!/usr/bin/env python3
"""「语义标注器」本地服务（仅 Python 标准库）：静态文件 + 回环写接口。

编辑器必须经 HTTP 才能 fetch 仓库里的原立绘（assets/source/...）与本地拆分件
（workspace/characters/...）；直接双击 html 会被浏览器拒绝 fetch。本脚本负责：
选空闲端口 → 在仓库根目录起静态服务 → 打开浏览器；并提供一个只写 workspace 的保存接口。

  GET  /api/capabilities       能力与根目录
  GET  /api/sources            列出 assets/source/*/three-view/*.png
  GET  /api/splits?character=  列出 workspace/characters/<c>/output/parts/*/manifest.json
  GET  /api/projects?character= 列出 workspace/characters/<c>/annotation/*/annotations.json
  GET  /api/bundles?character=  列出 workspace/characters/<c>/parts-bundles/*/index.json
  GET  /api/bundle?path=        读取一个拆件包（index.json + parts.json）
  POST /api/save-bundle         写拆件包目录（index.json/parts.json/base.png/layers|masks|cuts|hidden）
  GET  /api/project?path=      读取一份 annotations.json（限 workspace/characters 下）
  POST /api/save-project       写 annotations.json + label/masks/cuts/preview 到
                               workspace/characters/<c>/annotation/<project>/

写接口只在回环地址（127.0.0.1 / localhost）监听时启用；非回环一律只读。
用法：
  python3 serve.py                 # 默认 8123，占用则自动往后找
  python3 serve.py --port 9000
  python3 serve.py --port 0        # 随机端口
  python3 serve.py --no-browser    # 只起服务
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
import subprocess
import time
import sys
import tempfile
import threading
import webbrowser
from urllib.parse import unquote

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
TOOL_PATH = "/tools/part-annotator/"

API_VERSION = 1
MAX_BODY_BYTES = 256 * 1024 * 1024
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024
MAX_FILES = 600
MAX_CHARACTER = 64
MAX_PROJECT = 64
READ_TIMEOUT = 30.0

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
NAME_RE = re.compile(r"^(annotations\.json|label\.png|label-hidden\.png|preview\.png|"
                     r"(masks|hidden|cuts|cuts-hidden)/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.png)$")
BUNDLE_NAME_RE = re.compile(r"^(index\.json|parts\.json|issues\.json|base\.png|base-norm\.png|composite\.png|"
                            r"preview\.png|report\.md|annotations\.json|"
                            r"(layers|masks|cuts|hidden|cuts-hidden)/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.png|"
                            r"issues/[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:-before|-after)?\.png)$")
BUNDLE_ENTRY = "index.json"
BUNDLE_PARTS = "parts.json"
BUNDLE_ISSUES = "issues.json"
SAVE_LOCK = threading.Lock()


class ApiError(Exception):
    def __init__(self, status, code, message, extra=None, close=False):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}
        self.close = close

    def payload(self):
        err = {"code": self.code, "message": self.message}
        err.update(self.extra)
        return {"ok": False, "error": err}


def invalid(message, **extra):
    return ApiError(400, "INVALID_REQUEST", message, extra)


def denied(message):
    return ApiError(403, "PATH_DENIED", message, close=True)


def safe_join(base: pathlib.Path, name: str) -> pathlib.Path:
    """校验单段文件名（不含分隔符），返回 base/name。"""
    if not ID_RE.match(name):
        raise invalid("非法文件名: %r" % name)
    target = (base / name).resolve()
    try:
        target.relative_to(base.resolve())
    except ValueError:
        raise denied("路径越界")
    return target


def repo_rel(path: pathlib.Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def read_json_file(path: pathlib.Path) -> dict:
    if not path.is_file():
        raise ApiError(404, "NOT_FOUND", "文件不存在: %s" % repo_rel(path))
    if path.stat().st_size > MAX_FILE_BYTES:
        raise invalid("文件过大")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise invalid("JSON 解析失败: %s" % exc)


def list_sources():
    out = []
    base = ROOT / "assets" / "source"
    if not base.is_dir():
        return out
    for char_dir in sorted(base.iterdir()):
        if not char_dir.is_dir() or not ID_RE.match(char_dir.name):
            continue
        tv = char_dir / "three-view"
        if not tv.is_dir():
            continue
        for img in sorted(tv.iterdir()):
            if img.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
                continue
            out.append({
                "path": repo_rel(img),
                "character": char_dir.name,
                "view": img.stem,
                "label": "%s / %s" % (char_dir.name, img.stem),
            })
    return out


def list_splits(character):
    out = []
    base = ROOT / "workspace" / "characters" / character / "output" / "parts"
    if not base.is_dir():
        return out
    candidates = []
    if (base / "manifest.json").is_file():
        candidates.append(base / "manifest.json")
    candidates.extend(sorted(base.glob("*/manifest.json")))
    for mf in candidates:
        try:
            data = json.loads(mf.read_text(encoding="utf-8"))
            views = data.get("views") or {}
            view = next(iter(views), "front")
            parts = views.get(view, {}).get("parts", [])
            rel_dir = mf.parent.relative_to(base).as_posix()
            out.append({
                "path": repo_rel(mf),
                "dir": repo_rel(mf.parent),
                "label": "%s (%s)" % (rel_dir if rel_dir != "." else base.name, len(parts)),
                "view": view,
                "partCount": len(parts),
            })
        except (OSError, ValueError):
            continue
    return out


def list_bundles(character):
    out = []
    base = ROOT / "workspace" / "characters" / character / "parts-bundles"
    if not base.is_dir():
        return out
    for entry in sorted(base.glob("*/index.json")):
        try:
            data = json.loads(entry.read_text(encoding="utf-8"))
            if data.get("kind") != "parts-bundle":
                continue
            out.append({
                "path": repo_rel(entry),
                "dir": repo_rel(entry.parent),
                "bundle": entry.parent.name,
                "label": "%s (%s 件)" % (data.get("label") or entry.parent.name,
                                         data.get("parts", 0)),
                "parts": data.get("parts", 0),
                "updatedAt": data.get("updatedAt", ""),
            })
        except (OSError, ValueError):
            continue
    return out


def load_bundle(index_path):
    if not index_path.endswith("/index.json") and index_path != "index.json":
        raise invalid("path 必须指向 index.json")
    if index_path.startswith("/") or ".." in index_path.split("/") or "\\" in index_path:
        raise invalid("path 非法")
    target = (ROOT / index_path).resolve()
    try:
        target.relative_to(ROOT)
    except ValueError:
        raise denied("只允许读取仓库内的拆件包")
    index = read_json_file(target)
    if index.get("kind") != "parts-bundle":
        raise invalid("不是 parts-bundle")
    if index.get("partsFile") != BUNDLE_PARTS:
        raise invalid("partsFile 必须是 parts.json")
    parts_path = target.parent / BUNDLE_PARTS
    parts = read_json_file(parts_path)
    if parts.get("kind") != "parts-list":
        raise invalid("parts.json kind 不符")
    if not isinstance(parts.get("parts"), list) or len(parts["parts"]) != int(index.get("parts", -1)):
        raise invalid("index.parts 与 parts.json 数量不一致")
    return target, index, parts


def perform_save_bundle(body):
    character = str(body.get("character", ""))
    bundle_id = str(body.get("bundleId", ""))
    if not ID_RE.match(character) or not ID_RE.match(bundle_id):
        raise invalid("character / bundleId 非法")
    index = body.get("index")
    parts = body.get("parts")
    if not isinstance(index, dict) or index.get("kind") != "parts-bundle":
        raise invalid("index 必须是 parts-bundle")
    if index.get("character") != character:
        raise invalid("index.character 与请求不一致")
    if not isinstance(parts, dict) or parts.get("kind") != "parts-list":
        raise invalid("parts 必须是 parts-list")
    part_list = parts.get("parts")
    if not isinstance(part_list, list) or len(part_list) > 251:
        raise invalid("parts.parts 非法")
    if int(index.get("parts", -1)) != len(part_list):
        raise invalid("index.parts 与 parts 数量不一致")
    canvas = index.get("canvas") or {}
    if not (isinstance(canvas.get("width"), int) and isinstance(canvas.get("height"), int)
            and 0 < canvas["width"] <= 8192 and 0 < canvas["height"] <= 8192):
        raise invalid("canvas 非法")
    files = body.get("files")
    if not isinstance(files, list) or not files or len(files) > MAX_FILES:
        raise invalid("files 非法")
    names = {str(f.get("name", "")) for f in files if isinstance(f, dict)}
    for required in (BUNDLE_ENTRY, BUNDLE_PARTS, "base.png"):
        if required not in names:
            raise invalid("拆件包必须包含 %s" % required)
    if index.get("issuesFile") is not None:
        if index.get("issuesFile") != BUNDLE_ISSUES:
            raise invalid("issuesFile 必须是 issues.json")
        if BUNDLE_ISSUES not in names:
            raise invalid("index 声明了 issuesFile，但缺少 issues.json")

    target_dir = ROOT / "workspace" / "characters" / character / "parts-bundles" / bundle_id
    target_dir.mkdir(parents=True, exist_ok=True)
    total = 0
    checked = []
    for item in files:
        if not isinstance(item, dict):
            raise invalid("file 条目非法")
        name = str(item.get("name", ""))
        if not BUNDLE_NAME_RE.match(name):
            raise invalid("文件路径不在允许集合: %r" % name)
        raw = item.get("base64")
        if not isinstance(raw, str):
            raise invalid("base64 缺失: %s" % name)
        if raw.startswith("data:"):
            raw = raw.split(",", 1)[-1]
        try:
            data = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError):
            raise invalid("base64 解码失败: %s" % name)
        total += len(data)
        if total > MAX_TOTAL_BYTES or len(data) > MAX_FILE_BYTES:
            raise invalid("保存体积超限")
        if name.endswith(".png") and not data.startswith(PNG_SIGNATURE):
            raise invalid("PNG 签名不符: %s" % name)
        if name in (BUNDLE_ENTRY, BUNDLE_PARTS, BUNDLE_ISSUES, "annotations.json"):
            try:
                parsed = json.loads(data.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                raise invalid("%s 不是合法 JSON" % name)
            if name == BUNDLE_ISSUES:
                if not isinstance(parsed, dict) or parsed.get("kind") != "issues-list" or not isinstance(parsed.get("issues"), list):
                    raise invalid("issues.json 结构不符")
                if not isinstance(index.get("issues"), int) or index["issues"] != len(parsed["issues"]):
                    raise invalid("index.issues 与 issues.json 数量不一致")
        checked.append((name, data))

    for name, data in checked:
        dest = target_dir / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        if name == BUNDLE_ENTRY:
            data = json.dumps(index, ensure_ascii=False, indent=2).encode("utf-8")
        elif name == BUNDLE_PARTS:
            data = json.dumps(parts, ensure_ascii=False, indent=2).encode("utf-8")
        write_atomic(dest, data)

    return {"ok": True, "dir": repo_rel(target_dir), "files": sorted(n for n, _ in checked), "bytes": total}


def list_projects(character):
    out = []
    base = ROOT / "workspace" / "characters" / character / "annotation"
    if not base.is_dir():
        return out
    for ann in sorted(base.glob("*/annotations.json")):
        try:
            data = json.loads(ann.read_text(encoding="utf-8"))
            out.append({
                "path": repo_rel(ann),
                "project": ann.parent.name,
                "label": "%s (%d 件)" % (ann.parent.name, len(data.get("parts", []))),
                "updatedAt": data.get("updatedAt", ""),
            })
        except (OSError, ValueError):
            continue
    return out


def validate_project_payload(project):
    if not isinstance(project, dict):
        raise invalid("project 必须是对象")
    if project.get("schemaVersion") != 1 or project.get("kind") != "part-annotation":
        raise invalid("project schemaVersion/kind 不符")
    parts = project.get("parts")
    if not isinstance(parts, list) or len(parts) > 251:
        raise invalid("parts 非法")
    ids = set()
    for p in parts:
        if not isinstance(p, dict):
            raise invalid("part 非法")
        pid = str(p.get("id", ""))
        if not ID_RE.match(pid) or pid in ids:
            raise invalid("part id 非法或重复: %r" % pid)
        ids.add(pid)
        if not isinstance(p.get("name"), str) or not p["name"].strip():
            raise invalid("part name 非法")
        if not isinstance(p.get("z"), int):
            raise invalid("part z 非法")
    canvas = project.get("canvas") or {}
    if not (isinstance(canvas.get("width"), int) and isinstance(canvas.get("height"), int)):
        raise invalid("canvas 非法")
    if not (0 < canvas["width"] <= 8192 and 0 < canvas["height"] <= 8192):
        raise invalid("canvas 尺寸越界")
    return project


def write_atomic(path: pathlib.Path, data: bytes):
    fd, tmp = tempfile.mkstemp(prefix=".part-ann-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def perform_save(body):
    character = str(body.get("character", ""))
    project_id = str(body.get("projectId", ""))
    if not ID_RE.match(character) or not ID_RE.match(project_id):
        raise invalid("character / projectId 非法")
    project = validate_project_payload(body.get("project"))
    if project.get("character") != character:
        raise invalid("project.character 与请求不一致")
    files = body.get("files")
    if not isinstance(files, list) or not files or len(files) > MAX_FILES:
        raise invalid("files 非法")
    target_dir = (ROOT / "workspace" / "characters" / character / "annotation" / project_id)
    target_dir.mkdir(parents=True, exist_ok=True)

    total = 0
    written = []
    checked = []
    for item in files:
        if not isinstance(item, dict):
            raise invalid("file 条目非法")
        name = str(item.get("name", ""))
        if not NAME_RE.match(name):
            raise invalid("文件路径不在允许集合: %r" % name)
        raw = item.get("base64")
        if not isinstance(raw, str):
            raise invalid("base64 缺失: %s" % name)
        if raw.startswith("data:"):
            raw = raw.split(",", 1)[-1]
        try:
            data = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError):
            raise invalid("base64 解码失败: %s" % name)
        total += len(data)
        if total > MAX_TOTAL_BYTES or len(data) > MAX_FILE_BYTES:
            raise invalid("保存体积超限")
        if name.endswith(".png") and not data.startswith(PNG_SIGNATURE):
            raise invalid("PNG 签名不符: %s" % name)
        if name == "annotations.json":
            try:
                parsed = json.loads(data.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                raise invalid("annotations.json 不是合法 JSON")
            if parsed.get("parts") is None:
                raise invalid("annotations.json 缺少 parts")
        checked.append((name, data))

    for name, data in checked:
        dest = target_dir / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        if name.endswith(".json"):
            # 以服务端校验后的 project 为准写回，避免浏览器 payload 与清单不一致
            payload = dict(project)
            payload["updatedAt"] = payload.get("updatedAt") or project.get("updatedAt", "")
            data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        write_atomic(dest, data)
        written.append(name)

    return {
        "ok": True,
        "dir": repo_rel(target_dir),
        "files": sorted(written),
        "bytes": total,
    }


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "PartAnnotator/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("[part-annotator] " + (fmt % args) + "\n")

    def write_enabled(self):
        host = self.client_address[0]
        return host in ("127.0.0.1", "::1", "localhost")

    def send_json(self, status, payload, close=False):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if close:
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        if close:
            self.close_connection = True

    # 静态文件（app.js / ui.css / index.html …）也强制不缓存：
    # 改完代码刷新就能看到，不会被浏览器按 Last-Modified 猜一个新鲜期缓存住。
    def send_head(self):
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        if "If-None-Match" in self.headers:
            del self.headers["If-None-Match"]
        orig_end_headers = self.end_headers

        def end_headers_no_cache():
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            orig_end_headers()

        self.end_headers = end_headers_no_cache
        try:
            return super().send_head()
        finally:
            self.end_headers = orig_end_headers

    def fail(self, err: ApiError):
        self.send_json(err.status, err.payload(), err.close)

    def do_GET(self):
        if self.path.startswith("/api/"):
            try:
                self.handle_api_get()
            except ApiError as exc:
                self.fail(exc)
            except Exception as exc:  # noqa: BLE001
                self.fail(ApiError(500, "INTERNAL", str(exc), close=True))
            return
        super().do_GET()

    def do_HEAD(self):
        if self.path.startswith("/api/"):
            try:
                self.handle_api_get(head=True)
            except ApiError as exc:
                self.fail(exc)
            return
        super().do_HEAD()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET,HEAD,POST,OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        if not self.path.startswith("/api/"):
            self.fail(ApiError(404, "NOT_FOUND", "未知接口"))
            return
        try:
            self.handle_api_post()
        except ApiError as exc:
            self.fail(exc)
        except Exception as exc:  # noqa: BLE001
            self.fail(ApiError(500, "INTERNAL", str(exc), close=True))

    def handle_api_get(self, head=False):
        parsed = pathlib.PurePosixPath(self.path.split("?", 1)[0])
        path = parsed.as_posix()
        query = {}
        if "?" in self.path:
            for pair in self.path.split("?", 1)[1].split("&"):
                if "=" in pair:
                    k, v = pair.split("=", 1)
                    query[unquote(k)] = unquote(v)
        if path == "/api/capabilities":
            caps = {
                "ok": True,
                "apiVersion": API_VERSION,
                "saveProject": self.write_enabled(),
                "saveBundle": self.write_enabled(),
                "root": str(ROOT),
                "tool": TOOL_PATH,
            }
            self.send_json(200, caps)
            return
        if not self.write_enabled():
            raise denied("当前服务只读（非回环地址启动）")
        if path == "/api/sources":
            self.send_json(200, {"ok": True, "sources": list_sources()})
            return
        if path == "/api/splits":
            character = query.get("character", "")
            if not ID_RE.match(character):
                raise invalid("character 非法")
            self.send_json(200, {"ok": True, "splits": list_splits(character)})
            return
        if path == "/api/projects":
            character = query.get("character", "")
            if not ID_RE.match(character):
                raise invalid("character 非法")
            self.send_json(200, {"ok": True, "projects": list_projects(character)})
            return
        if path == "/api/bundles":
            character = query.get("character", "")
            if not ID_RE.match(character):
                raise invalid("character 非法")
            self.send_json(200, {"ok": True, "bundles": list_bundles(character)})
            return
        if path == "/api/bundle":
            rel = query.get("path", "")
            target, index, parts = load_bundle(rel)
            self.send_json(200, {
                "ok": True,
                "path": rel,
                "dir": repo_rel(target.parent),
                "index": index,
                "parts": parts,
            })
            return
        if path == "/api/project":
            rel = query.get("path", "")
            if not rel or rel.startswith("/") or ".." in rel.split("/") or "\\" in rel:
                raise invalid("path 非法")
            target = (ROOT / rel).resolve()
            allowed = (ROOT / "workspace" / "characters").resolve()
            try:
                target.relative_to(allowed)
            except ValueError:
                raise denied("只允许读取 workspace/characters 下的工程")
            if target.name != "annotations.json":
                raise invalid("只允许读取 annotations.json")
            data = read_json_file(target)
            self.send_json(200, {"ok": True, "path": rel, "dir": target.parent.as_posix(), "project": data})
            return
        raise ApiError(404, "NOT_FOUND", "未知接口")

    def handle_api_post(self):
        parsed = pathlib.PurePosixPath(self.path.split("?", 1)[0])
        path = parsed.as_posix()
        if path not in ("/api/save-project", "/api/save-bundle"):
            raise ApiError(404, "NOT_FOUND", "未知接口")
        if not self.write_enabled():
            raise denied("当前服务只读（非回环地址启动）")
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            raise invalid("Content-Type 必须是 application/json")
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            raise invalid("Content-Length 非法")
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise invalid("请求体不是合法 JSON")
        if not isinstance(body, dict):
            raise invalid("请求体非法")
        expected = "save-project" if path == "/api/save-project" else "save-bundle"
        if body.get("action") != expected:
            raise invalid("action 非法")
        with SAVE_LOCK:
            result = perform_save(body) if expected == "save-project" else perform_save_bundle(body)
        self.send_json(200, result)


def is_loopback_bind(bind):
    return bind in ("127.0.0.1", "localhost", "::1")


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


def release_port(port, marker, wait=8.0):
    """端口若被本工具的旧 serve.py 占着，就结束它并等端口释放。

    返回 (usable, note)：usable=False 表示端口被别人占着，调用方应换端口或退出。
    """
    pid = port_owner_pid(port)
    if pid is None:
        return True, ""
    if pid == os.getpid():
        return True, ""
    cmd = process_command_line(pid)
    if marker not in cmd:
        return False, ("端口 %d 被 PID %d 占用（不是本工具的 serve.py）：%s"
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
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]
    for port in range(preferred, preferred + tries):
        if port_is_free(port):
            return port
    return 0


class ThreadingServer(socketserver.ThreadingTCPServer):
    # Windows 的 SO_REUSEADDR 允许“重复绑定”同一端口，两个实例会同时以为自己是服务，
    # 于是出现“旧进程没杀掉也能起第二份”。这里在 Windows 上禁止复用，占用就直接失败。
    allow_reuse_address = os.name != "nt"
    daemon_threads = True
    request_queue_size = 32


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8123)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--no-restart", action="store_true", help="不要结束占用端口的旧实例，改用其它端口")
    parser.add_argument("--strict-port", action="store_true", help="端口被其它程序占用时直接退出，不换端口")
    args = parser.parse_args()

    port = args.port
    if port and not args.no_restart:
        usable, note = release_port(port, "part-annotator")
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
        fallback = free_port(port)
        if not fallback:
            print("端口 %d 及其后 40 个端口都被占用，请用 --port 指定" % port, file=sys.stderr)
            return 2
        print("端口 %d 仍被占用，改用 %d" % (port, fallback))
        port = fallback

    server = ThreadingServer((args.bind, port), functools.partial(Handler))
    url = "http://127.0.0.1:%d%s" % (server.server_address[1], TOOL_PATH)
    print("根目录: %s" % ROOT)
    print("标注器: %s" % url)
    if is_loopback_bind(args.bind):
        print("保存接口: 已启用（POST /api/save-bundle → workspace/characters/<角色>/parts-bundles/；旧 save-project 保留）")
    else:
        print("保存接口: 已禁用（非回环地址，只读）")
    sys.stdout.flush()
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())