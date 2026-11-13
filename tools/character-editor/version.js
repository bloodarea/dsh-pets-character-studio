/*
 * version.js —— 内置人物包管理器的**自身版本**单一来源（方案 A：不改任何 JSON schema / 人物包格式）。
 *
 * 浏览器：作为 **classic script** 加载（index.html 里第一个脚本，自身带 ?v=<version>），挂 `window.SpineEditorVersion`。
 * Node：本仓库根 package.json 是 `type: "module"`，所以 `.js` 在 Node 侧按 ESM 解析，`require()` 只会拿到
 *       空命名空间 `{}`。**推荐的读取方式**（两种都行）：
 *         1) `await import('./tools/character-editor/version.js'); globalThis.SpineEditorVersion`
 *            —— 副作用会给 globalThis 挂上同一个对象（本文件末尾的守卫就是这样写的）；
 *         2) 文本正则读本文件的 `version:` / `builtAt:` 字段（`scripts/bump-editor-version.mjs` 用的就是这招，
 *            不依赖任何模块系统）。
 *
 * 改版本请跑 `node scripts/bump-editor-version.mjs <x.y.z>`：
 *   · 它同时改写本文件的 version / builtAt，以及 index.html / selftest.html 里所有 `?v=` 缓存戳；
 *   · `node scripts/bump-editor-version.mjs --check` 校验 semver、`?v=` 同源、脚本加载顺序。
 *
 * 字段说明：
 *   version       编辑器语义版本；里程碑对应 P0=0.1.0 / P1=0.2.0 / P2=0.3.0 / 单一界面=0.7.x
 *   label         界面标题用的产品名
 *   builtAt       构建日期（手写 ISO 字符串，bump 脚本会刷新）
 *   schemaVersion 人物包 JSON 的 schema 版本（方案 A：本轮不随编辑器版本变化，仍为 1）
 *   apiVersion    保存接口 /api/save-bundle 的 apiVersion（同样不变，仍为 1）
 *   milestone     人读的里程碑标注（不参与校验）
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.SpineEditorVersion = api;
  else if (root) root.SpineEditorVersion = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return Object.freeze({
    version: "0.9.198",
    label: "内置人物包管理器",
    builtAt: "2026-11-13T14:08:08.225Z",
    schemaVersion: 1,
    apiVersion: 1,
    milestone: "单一界面（PS/Flash/Blender 心智）",
  });
});
