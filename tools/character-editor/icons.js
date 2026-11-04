/*
 * 内置人物包管理器图标集（16×16 网格 / 1.6 线宽 / 圆角端点）
 * 用法：
 *   <svg class="ic"><use href="#i-play"></use></svg>
 * 主题色由 CSS 的 currentColor 决定，solid 类用于实心图形（播放三角、暂停条、停止块）。
 * 说明：图标为内联雪碧图，避免外部 <use> 在 file:// 下失效。
 */
(function () {
  "use strict";

  // name -> symbol 内部标记（不带 <symbol>）
  const ICONS = {
    /* ---- spine 语义 ---- */
    bone: `<path d="M5.3 10.7 10.7 5.3"/>
           <circle cx="3.9" cy="12.1" r="1.55"/><circle cx="12.1" cy="3.9" r="1.55"/>`,
    joint: `<circle cx="8" cy="8" r="2.1"/><path d="M8 1.6v2.2M8 12.2v2.2M1.6 8h2.2M12.2 8h2.2"/>
            <circle cx="8" cy="8" r=".55" fill="currentColor" stroke="none"/>`,
    mesh: `<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.4"/>
           <path d="M2.2 8h11.6M8 2.2v11.6"/>
           <circle cx="8" cy="8" r=".6" fill="currentColor" stroke="none"/>`,
    keyframe: `<path d="M8 2.4 13.6 8 8 13.6 2.4 8z"/><circle cx="8" cy="8" r=".7" fill="currentColor" stroke="none"/>`,
    timeline: `<path d="M2 12.5h12"/><path d="M4.6 4.4l1.8 1.8-1.8 1.8-1.8-1.8z"/>
               <path d="M8.6 12.5V6.2M11.4 12.5V6.2"/>`,
    layers: `<path d="M8 2.2 13.8 5.1 8 8 2.2 5.1z"/><path d="M2.2 8.4 8 11.3l5.8-2.9"/><path d="M2.2 11.4 8 14.3l5.8-2.9"/>`,
    physics: `<path d="M3 11.5c1.4 0 1.8-2.2 3.2-2.2s1.8 2.2 3.2 2.2 1.8-2.2 3.2-2.2"/>
              <path d="M3 7.2c1.4 0 1.8-2.2 3.2-2.2s1.8 2.2 3.2 2.2 1.8-2.2 3.2-2.2"/>`,

    /* ---- 层级 ---- */
    "layer-front": `<path d="M8 13V4.4"/><path d="M4.6 7.8 8 4.4l3.4 3.4"/><path d="M3 2.4h10"/>`,
    "layer-back": `<path d="M8 3v8.6"/><path d="M4.6 8.2 8 11.6l3.4-3.4"/><path d="M3 13.6h10"/>`,
    "layer-up": `<path d="M8 13V4.4"/><path d="M4.6 7.8 8 4.4l3.4 3.4"/>`,
    "layer-down": `<path d="M8 3v8.6"/><path d="M4.6 8.2 8 11.6l3.4-3.4"/>`,

    /* ---- 显隐 ---- */
    eye: `<path d="M1.7 8S4.2 4.4 8 4.4 14.3 8 14.3 8 11.8 11.6 8 11.6 1.7 8 1.7 8z"/>
          <circle cx="8" cy="8" r="1.65"/>`,
    "eye-off": `<path d="M6.2 4.7A6.6 6.6 0 0 1 8 4.4C11.8 4.4 14.3 8 14.3 8a12 12 0 0 1-2.2 2.5"/>
               <path d="M4 5.6A12 12 0 0 0 1.7 8S4.2 11.6 8 11.6c.6 0 1.2-.1 1.7-.3"/>
               <path d="M2.4 13.6 13.6 2.4"/>`,

    /* ---- 传输/播放 ---- */
    play: `<path d="M5.1 3.4 12.6 8 5.1 12.6z" fill="currentColor" stroke="none"/>`,
    pause: `<rect x="4.9" y="3.4" width="2.3" height="9.2" rx=".7" fill="currentColor" stroke="none"/>
            <rect x="8.8" y="3.4" width="2.3" height="9.2" rx=".7" fill="currentColor" stroke="none"/>`,
    stop: `<rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.1" fill="currentColor" stroke="none"/>`,
    loop: `<path d="M2.9 7V6.3A2.4 2.4 0 0 1 5.3 3.9h5.1"/>
           <path d="M8.6 1.9 10.8 3.9 8.6 5.9"/>
           <path d="M13.1 9v.7a2.4 2.4 0 0 1-2.4 2.4H5.6"/>
           <path d="M7.4 14.1 5.2 12.1 7.4 10.1"/>`,

    /* ---- 工具/界面（T3 新增） ---- */
    hand: `<path d="M5.4 7.8V5.1a1.05 1.05 0 0 1 2.1 0v2.4"/>
           <path d="M7.5 7.5V4.4a1.05 1.05 0 0 1 2.1 0v3.1"/>
           <path d="M9.6 7.6V5.6a1.05 1.05 0 0 1 2.1 0v4.9a4.3 4.3 0 0 1-4.3 4.3H6.9A4.4 4.4 0 0 1 2.9 11l-.6-1.9a1.05 1.05 0 0 1 1.9-.9l1.2 1.9"/>`,
    search: `<circle cx="7.2" cy="7.2" r="4.2"/><path d="M10.4 10.4 14 14"/>`,
    "chevron-down": `<path d="M4.2 6.2 8 10l3.8-3.8"/>`,
    "chevron-right": `<path d="M6.2 4.2 10 8l-3.8 3.8"/>`,
    help: `<circle cx="8" cy="8" r="6.1"/>
           <path d="M6.2 6.1a1.85 1.85 0 0 1 3.6.5c0 1.2-1.8 1.5-1.8 2.8"/>
           <circle cx="8" cy="11.6" r=".65" fill="currentColor" stroke="none"/>`,
    info: `<circle cx="8" cy="8" r="6.1"/><path d="M8 7.4v4"/>
           <circle cx="8" cy="5" r=".65" fill="currentColor" stroke="none"/>`,
    alert: `<path d="M8 2.5 14.2 13H1.8z"/><path d="M8 6.4v3.3"/>
            <circle cx="8" cy="11.4" r=".62" fill="currentColor" stroke="none"/>`,
    close: `<path d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6"/>`,
    lock: `<rect x="3.6" y="7" width="8.8" height="6.2" rx="1.3"/>
           <path d="M5.6 7V5.4a2.4 2.4 0 0 1 4.8 0V7"/>`,
    unlock: `<rect x="3.6" y="7" width="8.8" height="6.2" rx="1.3"/>
             <path d="M5.6 7V5.4a2.4 2.4 0 0 1 4.6-.9"/>`,
    magnet: `<path d="M4.1 3.4v5.1a3.9 3.9 0 0 0 7.8 0V3.4"/>
             <path d="M4.1 3.4h3.2M8.7 3.4h3.2"/><path d="M4.1 6.6h3.2M8.7 6.6h3.2"/>`,
    "zoom-in": `<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2 14 14"/>
                <path d="M7 5.2v3.6M5.2 7h3.6"/>`,
    "zoom-out": `<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2 14 14"/><path d="M5.2 7h3.6"/>`,
    panel: `<rect x="2.2" y="3" width="11.6" height="10" rx="1.4"/><path d="M9.6 3v10"/>`,
    "skip-back": `<path d="M4.2 3.6v8.8"/><path d="M12.6 4.2 6.6 8l6 3.8z" fill="currentColor" stroke="none"/>`,
    target: `<circle cx="8" cy="8" r="5.2"/><circle cx="8" cy="8" r="1.4"/>
             <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2"/>`,
    voice: `<path d="M7.4 3.2 4.9 5.5H2.5v5h2.4l2.5 2.3z"/>
            <path d="M9.9 6.2a2.5 2.5 0 0 1 0 3.6"/>
            <path d="M11.8 4.3a5.1 5.1 0 0 1 0 7.4"/>`,

    /* ---- 文件/操作 ---- */
    open: `<path d="M1.9 5.1A1.1 1.1 0 0 1 3 4h3.1l1.4 1.8h5.5A1.1 1.1 0 0 1 14.1 6.9v5.6a1.1 1.1 0 0 1-1.1 1.1H3a1.1 1.1 0 0 1-1.1-1.1z"/>`,
    sample: `<path d="M8 2.2 13.6 5v6L8 13.8 2.4 11V5z"/><path d="M2.4 5 8 7.8 13.6 5"/><path d="M8 7.8v6"/>`,
    save: `<path d="M8 2.4v7.4"/><path d="M4.9 6.9 8 10 11.1 6.9"/><path d="M2.9 13.2h10.2"/>`,
    undo: `<path d="M6.1 4.3 2.9 7.5l3.2 3.2"/><path d="M3.3 7.5h6.2a3.5 3.5 0 0 1 0 7H6.6"/>`,
    reset: `<path d="M13 8a5 5 0 1 1-1.5-3.5"/><path d="M13.3 2.5v3.3H10"/>`,

    /* ---- 视图 ---- */
    fit: `<path d="M3 6.2V4.1a1.1 1.1 0 0 1 1.1-1.1H6.2"/>
          <path d="M9.8 3h2.1A1.1 1.1 0 0 1 13 4.1v2.1"/>
          <path d="M13 9.8v2.1a1.1 1.1 0 0 1-1.1 1.1H9.8"/>
          <path d="M6.2 13H4.1A1.1 1.1 0 0 1 3 11.9V9.8"/>`,
    bounds: `<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.2" stroke-dasharray="2.1 1.9"/>`,
    pivot: `<path d="M8 1.8v3.2M8 11v3.2M1.8 8h3.2M11 8h3.2"/>
            <circle cx="8" cy="8" r="1.5"/>`,
    move: `<path d="M8 2v12M2 8h12"/>
           <path d="M6.2 3.8 8 2l1.8 1.8M6.2 12.2 8 14l1.8-1.8M3.8 6.2 2 8l1.8 1.8M12.2 6.2 14 8l-1.8 1.8"/>`,
    weight: `<circle cx="8" cy="8" r="5.7"/><path d="M8 2.3a5.7 5.7 0 0 0 0 11.4z" fill="currentColor" stroke="none"/>`,
    face: `<circle cx="8" cy="8" r="5.8"/><path d="M5.3 9.5a3.2 3.2 0 0 0 5.4 0"/>
           <circle cx="6.1" cy="6.3" r=".62" fill="currentColor" stroke="none"/>
           <circle cx="9.9" cy="6.3" r=".62" fill="currentColor" stroke="none"/>`,
    texture: `<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="1.3"/>
              <path d="M2.2 6.4 13.8 6.4M2.2 9.8 13.8 9.8M6.4 2.2v11.6M9.8 2.2v11.6"/>`,
    trash: `<path d="M3.2 5.1h9.6"/><path d="M6.4 5.1V3.7a.9.9 0 0 1 .9-.9h1.4a.9.9 0 0 1 .9.9v1.4"/>
            <path d="M4.6 5.1 5.3 13a.9.9 0 0 0 .9.8h3.6a.9.9 0 0 0 .9-.8l.7-7.9"/>`,
  };

  function inject() {
    const holder = document.createElement("div");
    holder.setAttribute("aria-hidden", "true");
    holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    holder.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg">` +
      Object.entries(ICONS).map(([name, body]) =>
        `<symbol id="i-${name}" viewBox="0 0 16 16">${body}</symbol>`).join("") +
      `</svg>`;
    document.body.insertBefore(holder, document.body.firstChild);
  }

  /** 生成图标 HTML，供按钮/列表内联使用 */
  window.spineIcon = function (name, cls) {
    return `<svg class="ic${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  };
  window.SPINE_ICON_NAMES = Object.keys(ICONS);

  if (document.body) inject();
  else document.addEventListener("DOMContentLoaded", inject);
})();
