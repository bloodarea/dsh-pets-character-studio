#!/usr/bin/env node
/*
 * bump-editor-version.mjs —— 编辑器版本与缓存戳的单一入口（无第三方依赖，纯 Node ESM）。
 *
 * 用法：
 *   node scripts/bump-editor-version.mjs 0.3.1     # 改 version.js(version/builtAt) + 所有 ?v=
 *   node scripts/bump-editor-version.mjs --check   # 校验 semver / ?v= 同源 / version.js 首选加载
 *
 * 退出码：0 成功或校验通过；1 校验失败或参数错误。
 *
 * 方案 A 边界：只动编辑器自身版本与静态资源缓存戳，**不碰任何 JSON schema / 人物包格式**。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EDITOR = path.join(ROOT, "tools", "character-editor");
const VERSION_FILE = path.join(EDITOR, "version.js");
const HTML_FILES = [path.join(EDITOR, "index.html"), path.join(EDITOR, "selftest.html")];
const SEMVER = /^\d+\.\d+\.\d+$/;

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

function readText(p) {
  return fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** version.js 里的 version 字段 */
function readVersionField(text) {
  const m = /version:\s*"([^"]*)"/.exec(text);
  return m ? m[1] : null;
}

/** 所有 ?v=<值>（含 link href 与 script src），返回 {value, line, snippet} */
function stampList(text) {
  const out = [];
  /* 只认 src="...?v=..." / href="...?v=..." 形式的缓存戳（帮助文案里的 `?v=` 不算） */
  const re = /(?:src|href)="[^"]*\?v=([^"'\s>]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = Math.max(0, m.index - 48);
    out.push({ value: m[1], line: lineOf(text, m.index), snippet: text.slice(start, m.index + m[0].length).trim().split("\n").pop() });
  }
  return out;
}

/** index.html 的第一个 <script src=...> 指向哪个文件 */
function firstScriptSrc(text) {
  const m = /<script\s+src="([^"]+)"/.exec(text);
  return m ? m[1].split("?")[0] : null;
}

function check() {
  const problems = [];
  const info = { versionFile: rel(VERSION_FILE), html: HTML_FILES.map(rel), version: null, stamps: 0 };

  if (!fs.existsSync(VERSION_FILE)) {
    problems.push(`缺少版本单一来源：${rel(VERSION_FILE)}`);
    return { problems, info };
  }
  const vText = readText(VERSION_FILE);
  const version = readVersionField(vText);
  info.version = version;
  if (!version) problems.push(`${rel(VERSION_FILE)} 里找不到 version: "x.y.z" 字段`);
  else if (!SEMVER.test(version)) problems.push(`${rel(VERSION_FILE)} 的 version "${version}" 不是合法 semver（应形如 1.2.3）`);
  if (!/builtAt:\s*"/.test(vText)) problems.push(`${rel(VERSION_FILE)} 缺少 builtAt 字段`);

  for (const file of HTML_FILES) {
    if (!fs.existsSync(file)) {
      problems.push(`缺少文件：${rel(file)}`);
      continue;
    }
    const text = readText(file);
    const stamps = stampList(text);
    info.stamps += stamps.length;
    if (!stamps.length) problems.push(`${rel(file)} 里没有任何 ?v= 缓存戳（应由 bump 脚本统一写入）`);
    for (const s of stamps) {
      if (version && s.value !== version) {
        problems.push(`${rel(file)}:${s.line} 缓存戳 ?v=${s.value} ≠ version.js 的 ${version} — ${s.snippet}`);
      }
    }
  }

  const indexFile = HTML_FILES[0];
  if (fs.existsSync(indexFile)) {
    const indexText = readText(indexFile);
    const first = firstScriptSrc(indexText);
    if (first !== "version.js") {
      problems.push(`${rel(indexFile)} 的第一个 <script src> 必须是 version.js（当前是 ${first || "无"}）`);
    }
    const vIdx = indexText.indexOf('src="version.js');
    const coreIdx = indexText.indexOf('src="spine-core.js');
    if (vIdx < 0) problems.push(`${rel(indexFile)} 未加载 version.js`);
    else if (coreIdx >= 0 && vIdx > coreIdx) problems.push(`${rel(indexFile)} 的 version.js 必须在 spine-core.js 之前加载`);
  }

  return { problems, info };
}

function bump(next) {
  if (!SEMVER.test(next)) {
    console.error(`✗ 版本号 "${next}" 不是合法 semver（应形如 1.2.3）`);
    process.exit(1);
  }
  const changed = [];
  const vText = readText(VERSION_FILE);
  const current = readVersionField(vText);
  const stamp = new Date().toISOString();
  let nextV = vText
    .replace(/version:\s*"[^"]*"/, `version: "${next}"`)
    .replace(/builtAt:\s*"[^"]*"/, `builtAt: "${stamp}"`);
  if (nextV !== vText) {
    fs.writeFileSync(VERSION_FILE, nextV, "utf8");
    changed.push(rel(VERSION_FILE));
  }
  for (const file of HTML_FILES) {
    if (!fs.existsSync(file)) continue;
    const text = readText(file);
    const replaced = text.replace(/((?:src|href)="[^"]*)\?v=[^"'\s>]*/g, `$1?v=${next}`);
    if (replaced !== text) {
      fs.writeFileSync(file, replaced, "utf8");
      changed.push(rel(file));
    }
  }
  console.log(`✓ 版本 ${current || "?"} → ${next}（builtAt ${stamp}）`);
  console.log(`  修改 ${changed.length} 个文件：${changed.join("、") || "无"}`);
  const { problems } = check();
  if (problems.length) {
    console.error("✗ bump 后自检未通过：");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log("✓ 自检通过（?v= 与 version.js 同源，version.js 首选加载）");
}

const arg = process.argv[2];
if (!arg || arg === "--help" || arg === "-h") {
  console.log("用法：node scripts/bump-editor-version.mjs <x.y.z> | --check");
  process.exit(arg ? 0 : 1);
}
if (arg === "--check") {
  const { problems, info } = check();
  if (problems.length) {
    console.error(`✗ 版本校验失败（${problems.length} 个问题）：`);
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log(`✓ 版本校验通过：version ${info.version}；?v= 共 ${info.stamps} 处全部一致；version.js 为 index.html 第一个脚本`);
  process.exit(0);
}
bump(arg);