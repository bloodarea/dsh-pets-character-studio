/*
 * event-names.js —— 事件英文 id ↔ 中文显示名（**纯数据模块**，零依赖、零 DOM）
 *
 * 为什么单独一个模块：
 *   - 本仓分层约定：纯数据/纯函数放独立模块，app.js 只做 DOM 与状态；
 *   - 这样 selftest-node.mjs 能直接加载并断言字典完整性与回退规则。
 *
 * 显示优先级（**顺序很重要**）：
 *   1) 人物包 events.json 里作者写的 `name`（中文）—— 内容源权威，优先；
 *   2) 本文件「通用字典」—— 给**没有写 name 的包**和**通用 DSH 事件**兜底；
 *   3) 英文 id 原样显示 —— 最后兜底，绝不显示空白或 "undefined"。
 *
 * 为什么不能反过来（字典盖过包内 name）：
 *   包是内容，字典是兜底；作者给某个事件改叫「等待主人授权」，字典不该把它
 *   强行改回「等待授权」。
 *
 * 底层存储**永远用英文 id**：语音文件路径、动画映射、事件轨道的 name 字段
 * 都用 id。本模块只负责「给人看的那一层」，不参与任何写入。
 */
(function (global) {
  "use strict";

  /**
   * 通用字典：英文 id -> 中文显示名。
   *
   * 覆盖范围 = 当前 deepseek 包的 34 个事件（与 events.json 对齐）
   *            + DSH/Pets 常见事件的通用译名（给别的包/旧包兜底）。
   * 值一律简短（2–6 字），适配 320px 右栏与菜单单行。
   */
  const DICT = Object.freeze({
    /* ---- 会话生命周期 ---- */
    all_completed: "全部完成",
    approval_required: "等待授权",
    connected: "上线",
    disconnected: "掉线",
    long_idle: "长时间空闲",
    multiple_completed: "多个任务完成",
    multiple_running: "多个任务运行",
    no_running_tasks: "无运行任务",
    not_fat: "不是大肥鱼",
    obedient: "听话",
    pet_clicked: "被点击",
    pet_dragged: "被拖动",
    pet_exit: "退出",
    pet_hidden: "被隐藏",
    pet_petted: "被抚摸",
    pet_shown: "被显示",
    reconnected: "重新连接",
    repeated_click: "被反复点击",
    rice_favorite: "爱吃白饭",
    session_switched: "切换会话",
    session_waiting: "会话等待",
    smart_lazy: "聪明偷懒",
    tail_flukes: "摆尾鳍",
    task_cancelled: "任务取消",
    task_completed: "任务完成",
    task_failed: "任务失败",
    task_resumed: "任务恢复",
    task_running: "任务进行中",
    task_started: "任务开始",
    task_timeout: "任务超时",
    tsundere_sweet: "傲娇温柔",
    unread_notifications: "未读提醒",
    wake_up: "唤醒",
    whale_identity: "鲸鱼身份",

    /* ---- 以下是通用/常见事件（当前包没有，给别的包兜底） ---- */
    boot: "启动",
    idle: "空闲",
    working: "工作中",
    thinking: "思考中",
    writing: "写作中",
    error: "出错",
    warning: "提示",
    success: "成功",
    ready: "就绪",
    loading: "载入中",
    shutdown: "关闭",
    sleeping: "休眠",
    hungry: "饿了",
    happy: "开心",
    sad: "难过",
    angry: "生气",
    surprised: "惊讶",
    greeting: "打招呼",
    farewell: "告别",
            });

  /** 事件分类（category）的中文名；未知分类原样返回 */
  const CATEGORY_DICT = Object.freeze({
    session: "会话",
    agent: "智能体",
    pet: "桌宠",
    system: "系统",
    task: "任务",
    voice: "语音",
    idle: "空闲",
    ui: "界面",
  });

  /** 是否是非空字符串 */
  function isText(v) {
    return typeof v === "string" && v.trim() !== "";
  }

  /**
   * 事件显示名。
   *
   * @param {string} idOrName 事件英文 id（也可传已是中文名的值）
   * @param {string} [packName] 人物包 events.json 里作者写的 name（可选，优先级最高）
   * @returns {string} 一定是非空字符串
   */
  function eventLabel(idOrName, packName) {
    if (isText(packName)) return packName.trim();
    const id = isText(idOrName) ? idOrName.trim() : "";
    if (!id) return "（未命名事件）";
    if (Object.prototype.hasOwnProperty.call(DICT, id)) return DICT[id];
    /* 大小写不敏感回退：换个包可能写成 Pet_Clicked */
    const lower = id.toLowerCase();
    for (const k of Object.keys(DICT)) {
      if (k.toLowerCase() === lower) return DICT[k];
    }
    /* 已经是中文（含非 ASCII）就直接显示，不再查字典 */
    if (/[^\x00-\x7F]/.test(id)) return id;
    return id;   // 最后兜底：英文 id 原样，绝不返回空
  }

  /** 分类显示名 */
  function categoryLabel(cat) {
    const c = isText(cat) ? cat.trim() : "";
    if (!c) return "—";
    if (Object.prototype.hasOwnProperty.call(CATEGORY_DICT, c)) return CATEGORY_DICT[c];
    return c;
  }

  /** 字典是否收录某 id（供自测断言覆盖度） */
  function hasEventName(id) {
    return isText(id) && Object.prototype.hasOwnProperty.call(DICT, String(id).trim());
  }

  /** 只读快照（自测用） */
  function dictSnapshot() {
    return Object.assign({}, DICT);
  }

  const api = {
    DICT: DICT,
    CATEGORY_DICT: CATEGORY_DICT,
    eventLabel: eventLabel,
    categoryLabel: categoryLabel,
    hasEventName: hasEventName,
    dictSnapshot: dictSnapshot,
  };

  global.SpineEventNames = api;
  if (typeof module === "object" && module && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
