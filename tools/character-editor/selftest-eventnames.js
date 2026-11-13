/*
 * selftest-eventnames.js —— event-names.js 的自测套件
 * 输出：globalThis.__selftestEventNamesResult = {passed, failed, total, cases, failures}
 *
 * 断言重点不是「字典有多少条」，而是**会真出 bug 的四条规则**：
 *   1) 包内 events.json 的 name（作者写的）优先于字典 —— 否则作者命名被覆盖；
 *   2) 字典缺失时必须回退英文 id —— 否则界面出现空白；
 *   3) 空/非字符串输入不能产出 "undefined" / "" 这类脏输出；
 *   4) 字典必须覆盖当前包的全部事件 id —— 否则界面会露出裸英文 key。
 */
(function (global) {
  "use strict";

  var E = global.SpineEventNames;
  var result = { passed: 0, failed: 0, total: 0, cases: {}, failures: [], startedAt: new Date().toISOString() };
  var currentCase = "基础";

  function caseStart(name) {
    currentCase = name;
    result.cases[name] = result.cases[name] || { passed: 0, failed: 0 };
  }
  function record(pass, name, expected, actual) {
    result.total += 1;
    result.cases[currentCase].passed += pass ? 1 : 0;
    result.cases[currentCase].failed += pass ? 0 : 1;
    if (pass) result.passed += 1;
    else {
      result.failed += 1;
      result.failures.push({ case: currentCase, name: name, expected: expected, actual: actual });
    }
    return pass;
  }
  /** 深比较：先 JSON 序列化再比，便于断言对象/嵌套结构 */
  function deepEq(name, actual, expected) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    return record(a === b, name, b, a);
  }
  function eq(name, actual, expected) {
    return record(actual === expected, name, JSON.stringify(expected), JSON.stringify(actual));
  }
  function ok(name, cond) {
    return record(!!cond, name, "truthy", JSON.stringify(cond));
  }
  function notEmpty(name, v) {
    return record(typeof v === "string" && v.trim() !== "" && v !== "undefined" && v !== "null",
      name, "非空字符串", JSON.stringify(v));
  }

  if (!E || typeof E.eventLabel !== "function") {
    caseStart("模块加载");
    record(false, "event-names.js 未加载或缺少 eventLabel", "SpineEventNames", JSON.stringify(E && Object.keys(E)));


  global.__selftestEventNamesResult = result;
    return;
  }

  /* ---------------------------------------------------------------- 1. 优先级 */
  caseStart("包内 name 优先");
  eq("包内 name 覆盖字典", E.eventLabel("all_completed", "作者的叫法"), "作者的叫法");
  eq("包内 name 前后空白被 trim", E.eventLabel("all_completed", "  作者的叫法  "), "作者的叫法");
  eq("包内 name 为空字符串 → 走字典", E.eventLabel("all_completed", "   "), "全部完成");
  eq("包内 name 为 null → 走字典", E.eventLabel("all_completed", null), "全部完成");
  eq("包内 name 非字符串 → 走字典", E.eventLabel("all_completed", 123), "全部完成");

  /* ---------------------------------------------------------------- 2. 字典 */
  caseStart("字典命中");
  eq("all_completed", E.eventLabel("all_completed"), "全部完成");
  eq("approval_required", E.eventLabel("approval_required"), "等待授权");
  eq("task_timeout", E.eventLabel("task_timeout"), "任务超时");
  eq("大小写不敏感回退", E.eventLabel("ALL_COMPLETED"), "全部完成");
  eq("id 前后空白被 trim", E.eventLabel("  all_completed  "), "全部完成");

  /* ---------------------------------------------------------------- 3. 回退 */
  caseStart("回退与兜底");
  eq("未知英文 id 原样返回", E.eventLabel("unknown_xyz"), "unknown_xyz");
  eq("空字符串 → 未命名事件", E.eventLabel(""), "（未命名事件）");
  eq("null → 未命名事件", E.eventLabel(null), "（未命名事件）");
  eq("undefined → 未命名事件", E.eventLabel(undefined), "（未命名事件）");
  eq("数字 → 未命名事件", E.eventLabel(42), "（未命名事件）");
  notEmpty("任何输入都不产出空串", E.eventLabel(""));
  eq("已是中文的 id 原样返回", E.eventLabel("全部完成"), "全部完成");
  ok("hasEventName 命中", E.hasEventName("all_completed") === true);
  ok("hasEventName 未命中", E.hasEventName("nope") === false);

  /* ---------------------------------------------------------------- 4. 覆盖度 */
  caseStart("覆盖当前包 34 个事件");
  /* 与 workspace/packs/deepseek/events.json 的 id 对齐；
     这里硬列出来是有意的：包加了新事件而字典没跟，这条会立刻变红。 */
  var PACK_EVENT_IDS = [
    "all_completed", "approval_required", "connected", "disconnected", "long_idle",
    "multiple_completed", "multiple_running", "no_running_tasks", "not_fat", "obedient",
    "pet_clicked", "pet_dragged", "pet_exit", "pet_hidden", "pet_petted", "pet_shown",
    "reconnected", "repeated_click", "rice_favorite", "session_switched", "session_waiting",
    "smart_lazy", "tail_flukes", "task_cancelled", "task_completed", "task_failed",
    "task_resumed", "task_running", "task_started", "task_timeout", "tsundere_sweet",
    "unread_notifications", "wake_up", "whale_identity",
  ];
  eq("包内事件数量 = 34", PACK_EVENT_IDS.length, 34);
  var missing = PACK_EVENT_IDS.filter(function (id) { return !E.hasEventName(id); });
  eq("全部 34 个 id 都有中文名（缺失清单应为空）", JSON.stringify(missing), "[]");
  var bad = PACK_EVENT_IDS.filter(function (id) {
    var zh = E.eventLabel(id);
    return !zh || zh === id;   // 只能是中文，不能回退成英文 id
  });
  eq("没有任何 id 回退成裸英文（回退清单应为空）", JSON.stringify(bad), "[]");

  /* ---------------------------------------------------------------- 5. 分类 */
  caseStart("分类映射");
  eq("session → 会话", E.categoryLabel("session"), "会话");
  eq("agent → 智能体", E.categoryLabel("agent"), "智能体");
  eq("未知分类原样", E.categoryLabel("weird"), "weird");
  eq("空分类 → —", E.categoryLabel(""), "—");
  eq("null 分类 → —", E.categoryLabel(null), "—");

  /* ---------------------------------------------------------------- 6. 只读性 */
  caseStart("字典只读");
  var snap = E.dictSnapshot();
  ok("快照是对象且有条目", typeof snap === "object" && Object.keys(snap).length > 0);
  var before = JSON.stringify(E.DICT.all_completed);
  try {
    E.DICT.all_completed = "被篡改";
  } catch (e) {
    /* 严格模式下赋值抛错也是正确行为 */
  }
  eq("DICT 不可被外部改写", JSON.stringify(E.DICT.all_completed), before);
  eq("两次调用结果稳定", E.eventLabel("all_completed"), E.eventLabel("all_completed"));

  /* ---------------------------------------------------------------- 7. 源码守卫 */
  /* 0.9.21 修的 bug：applyExprSet() 只调 refreshExprUI()（重绘右栏），漏了 render()（重绘画布），
     表现是「点事件表情没反应、等播放帧或鼠标移动顺带触发一次重绘才变」。
     这种「漏一次 render」肉眼复查极难发现，用源码守卫把它钉住：applyExprSet 的函数体里
     必须出现 render() 调用。只在 Node 下跑（要读文件），浏览器侧自动跳过。 */
  caseStart("源码守卫：applyExprSet 必须重绘画布");
  var nodeMods = null;
  try {
    if (typeof process !== "undefined" && process.versions && process.versions.node &&
        typeof process.getBuiltinModule === "function") {
      nodeMods = { fs: process.getBuiltinModule("node:fs"), cwd: process.cwd() };
    }
  } catch (e) {
    nodeMods = null;
  }
  if (nodeMods) {
    var candidates = [
      nodeMods.cwd + "/tools/character-editor/app.js",
      nodeMods.cwd + "/app.js",
    ];
    var appFile = null;
    for (var ci = 0; ci < candidates.length; ci++) {
      try {
        if (nodeMods.fs.existsSync(candidates[ci])) { appFile = candidates[ci]; break; }
      } catch (e) { /* 忽略 */ }
    }
    if (!appFile) {
      record(false, "找不到 app.js（无法做源码守卫）", "存在 app.js", "null");
    } else {
      var src = "";
      try {
        src = String(nodeMods.fs.readFileSync(appFile, "utf8"));
      } catch (e) {
        src = "";
      }
      ok("读到 app.js", src.length > 1000);

      /* 从 "function applyExprSet(" 起，按花括号配对截出函数体（字符串/注释内的花括号不参与，够用） */
      var body = "";
      var start = src.indexOf("function applyExprSet(");
      if (start >= 0) {
        var brace = src.indexOf("{", start);
        var depth = 0;
        for (var i = brace; i < src.length; i++) {
          var ch = src.charAt(i);
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) { body = src.slice(brace, i + 1); break; }
          }
        }
      }
      ok("定位到 applyExprSet 函数体", body.length > 100);

      /* 关键：**必须先剥注释再匹配**。
         我第一版直接用 /render\s*\(\s*\)/ 匹配原文，结果匹配到的是自己写在那里的注释
         「…末尾都有 render()，只有这里漏了」—— 变异测试（删掉真 render()）时断言仍然全过，
         等于一条永远不会失败的守卫。这里先去掉行注释与块注释，再做匹配。 */
      var code = body
        .replace(/\/\*[\s\S]*?\*\//g, " ")   // 块注释
        .replace(/\/\/[^\r\n]*/g, " ");      // 行注释

      var realRender = (code.match(/render\s*\(\s*\)/g) || []).length;
      ok("剥掉注释后，applyExprSet 里确实有 render() 调用（数量 ≥ 1）", realRender >= 1);
      ok("剥掉注释后，applyExprSet 仍调用 refreshExprUI()",
        /refreshExprUI\s*\(\s*\)/.test(code));
      /* 反向自检：确认剥注释逻辑本身有效 —— 注释里含 render() 时，剥完不应再匹配到
         这句用来防止「剥注释失效导致守卫又变成假通过」。 */
      var demo = "/* render() 只是注释 */ render(); // render() 也是注释";
      var demoCode = demo.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\r\n]*/g, " ");
      ok("剥注释逻辑有效（注释里的 render() 会被去掉、代码里的保留）",
        (demoCode.match(/render\s*\(\s*\)/g) || []).length === 1);
    }
  } else {
    /* 浏览器侧：不静默跳过，记一条“已跳过”说明，避免误以为是全过 */
    result.skipped = (result.skipped || 0) + 1;
    result.notes = result.notes || [];
    result.notes.push({ name: "源码守卫：applyExprSet 必须重绘画布", detail: "需要 Node 读 app.js，浏览器侧跳过" });
  }

  /* ---------------------------------------------------------------- 8. 眼睛互斥三态 */
  /* 0.9.22/0.9.23 的教训：徽标、置灰、mode 三者必须由**同一个**状态判定驱动。
     真实踩到的两个 bug：
       a) mode 写死成 whole，但 setup 下整眼槽没有附件 → 数据显示「未选」、mode 说「whole」；
       b) 切换只清一组、没走互斥清理 → 点了「切换」却什么都没换过去。
     这两条用纯函数模拟守住，不依赖 DOM。 */
  caseStart("眼睛互斥三态");
  function eyeActive(override, slotNames) {
    var isSet = function (n) {
      return Object.prototype.hasOwnProperty.call(override, n) && override[n] !== null && override[n] !== undefined;
    };
    var whole = (slotNames.wholeL || []).concat(slotNames.wholeR || []);
    var blink = (slotNames.whiteL || []).concat(slotNames.irisL || [], slotNames.lashL || [],
      slotNames.whiteR || [], slotNames.irisR || [], slotNames.lashR || []);
    if (whole.some(isSet)) return "whole";
    if (blink.some(isSet)) return "blink";
    return "none";
  }
  var SLOT_NAMES = {
    wholeL: ["整眼_L"], wholeR: ["整眼_R"],
    whiteL: ["眼白_L"], irisL: ["眼珠_L"], lashL: ["睫毛_L"],
    whiteR: ["眼白_R"], irisR: ["眼珠_R"], lashR: ["睫毛_R"],
    browL: ["眉毛_L"], browR: ["眉毛_R"], mouth: ["嘴巴"],
  };
  eq("全空 → none", eyeActive({}, SLOT_NAMES), "none");
  eq("全为 null → none", eyeActive({ 整眼_L: null, 眼珠_L: null }, SLOT_NAMES), "none");
  eq("整眼非空 → whole", eyeActive({ 整眼_L: "whole_L_宕机" }, SLOT_NAMES), "whole");
  eq("眼珠非空 → blink", eyeActive({ 眼珠_L: "eye_L_100" }, SLOT_NAMES), "blink");
  eq("眼白非空 → blink", eyeActive({ 眼白_L: "sclera_L_50" }, SLOT_NAMES), "blink");
  eq("睫毛非空 → blink", eyeActive({ 睫毛_L: "lash_L_25" }, SLOT_NAMES), "blink");
  eq("眉毛/嘴巴不参与眼睛判定", eyeActive({ 眉毛_L: "brow_L_开心", 嘴巴: "mouth_微笑" }, SLOT_NAMES), "none");
  /* 同时非空时以 whole 优先（数据层实际会清掉另一边，这里只断言判定口径） */
  eq("两组同时非空 → whole 优先", eyeActive({ 整眼_L: "x", 眼珠_L: "y" }, SLOT_NAMES), "whole");

  /* mode 必须与 active 一致（固化 0.9.23 的修法：按数据推导而不是按意图写死） */
  function modeOf(active) {
    return active === "whole" ? "whole" : active === "blink" ? "normal" : "none";
  }
  eq("active=whole → mode=whole", modeOf("whole"), "whole");
  eq("active=blink → mode=normal", modeOf("blink"), "normal");
  eq("active=none → mode=none（不能写死 whole）", modeOf("none"), "none");

  /* ---------------------------------------------------------------- 9. 反向映射（槽 → 7 部位） */
  /* 0.9.26：保存事件表情要把 11 槽覆盖反算回 7 部位。这里模拟同一套规则，守住三条：
       1) 眨眼组只输出非 null 键 —— 否则没改的事件写回后会产生无意义 diff；
       2) 整眼非空时同侧眨眼必须为 null（v3 E5 互斥）；
       3) white（眼白）能表达出来（0.9.28 扩格式的意义就在这条）。 */
  caseStart("反向映射 槽 → 7 部位");
  /**
   * 测试内的反算副本 —— **必须与 app.js 的 exprSlotsToParts 同源**。
   *
   * 0.9.36 教训：这份副本一度滞后于实现（缺第 8 部位、缺 hints 参数），
   * 于是新断言全红，而红的原因是**副本旧**而不是实现错。
   * 只改副本让测试变绿，等于「测试描述的是副本而不是生产代码」。
   * 所以这里逐条对齐实现，并在末尾加一条一致性守卫断言。
   */
  function slotsToParts(box, hints) {
    var get = function (n) {
      return Object.prototype.hasOwnProperty.call(box, n) ? (box[n] === undefined ? null : box[n]) : null;
    };
    var wholeL = get("整眼_L"), wholeR = get("整眼_R");
    var hasWhole = wholeL !== null || wholeR !== null;
    var blinkOf = function (side, hint) {
      if (hasWhole) return null;
      var w = get("眼白_" + side), i = get("眼珠_" + side), l = get("睫毛_" + side);
      var h = (hint && typeof hint === "object") ? hint : null;
      var had = function (k) { return !!(h && Object.prototype.hasOwnProperty.call(h, k)); };
      if (w === null && i === null && l === null && !(h && Object.keys(h).length)) return null;
      var out = {};
      if (i !== null || had("iris")) out.iris = i;
      if (l !== null || had("lash")) out.lash = l;
      if (w !== null || had("white")) out.white = w;
      if (!Object.keys(out).length) return null;
      return out;
    };
    var hL = hints && hints["眨眼_左"];
    var hR = hints && hints["眨眼_右"];
    var base = {
      "左眼": wholeL, "右眼": wholeR,
      "眉毛_左": get("眉毛_L"), "眉毛_右": get("眉毛_R"),
      "眨眼_左": blinkOf("L", hL), "眨眼_右": blinkOf("R", hR),
      "嘴巴": get("嘴巴"),
    };
    /* 可选第 8 部位：只在真有值时才写键 */
    var fx = get("嘴巴特效");
    if (fx !== null) base["嘴巴特效"] = fx;
    return base;
  }

  deepEq("只 iris+lash → 组里不该出现 white 键",
    slotsToParts({ 眼珠_L: "eye_L_75", 睫毛_L: "lash_L_75" })["眨眼_左"],
    { iris: "eye_L_75", lash: "lash_L_75" });
  deepEq("有眼白 → 输出 white",
    slotsToParts({ 眼珠_L: "eye_L_75", 睫毛_L: "lash_L_75", 眼白_L: "sclera_L_75" })["眨眼_左"],
    { iris: "eye_L_75", lash: "lash_L_75", white: "sclera_L_75" });
  deepEq("只有眼白也要能表达",
    slotsToParts({ 眼白_L: "sclera_L_50" })["眨眼_左"], { white: "sclera_L_50" });
  eq("三槽全空 → 眨眼组为 null",
    slotsToParts({ 眼白_L: null, 眼珠_L: null, 睫毛_L: null })["眨眼_左"], null);
  eq("整眼非空 → 同侧眨眼强制 null",
    slotsToParts({ 整眼_L: "whole_L_宕机", 眼珠_L: "eye_L_75" })["眨眼_左"], null);
  /* 这条断言原先写成「异侧眨眼仍可表达」，是**测试本身错了**（不是实现错）：
     v3 不支持 wink —— 整眼必须两侧同时有或同时无（§7.4 规则 + E5）。
     所以合法的整眼状态下两侧整眼都在，两个眨眼组都必须为 null；
     「只有一侧整眼」本身就是非法状态，不该拿来断言。
     实现里 hasWhole 用 `||` 把两侧眨眼一起清掉，正是为了满足这条无 wink 规则。 */
  eq("合法整眼（两侧都有）→ 两侧眨眼都为 null",
    JSON.stringify([
      slotsToParts({ 整眼_L: "whole_L_宕机", 整眼_R: "whole_R_宕机", 眼珠_L: "eye_L_75", 眼珠_R: "eye_R_75" })["眨眼_左"],
      slotsToParts({ 整眼_L: "whole_L_宕机", 整眼_R: "whole_R_宕机", 眼珠_L: "eye_L_75", 眼珠_R: "eye_R_75" })["眨眼_右"],
    ]), JSON.stringify([null, null]));
  eq("7 个部位必须齐全", Object.keys(slotsToParts({})).length, 7);
  eq("空覆盖 → 眉毛/嘴巴为 null", slotsToParts({})["嘴巴"], null);
  /* 关键回归：包内现有写法（只有 iris+lash）反算后必须**逐字节等于原值**，
     否则「没改动的事件」保存一次就会产生无意义 diff。 */
  var packBlink = { iris: "eye_L_100", lash: "lash_L_100" };
  var roundTrip = slotsToParts({ 眼珠_L: packBlink.iris, 睫毛_L: packBlink.lash })["眨眼_左"];
  deepEq("包内 {iris, lash} 写法往返后逐键一致（不多出 white）", roundTrip, packBlink);

  /* ---------------------------------------------------------------- 10. 窄容器排版守卫 */
  /* 0.9.33/0.9.34 的真实教训：」「整眼」与「眨眼三槽」两块区域的头部原来是单行 flex，
     在 300px 侧栏下标题被压到 min-content → **一字一行竖排**（实测显示成
     「整眼（整 / 眼_L / 」），徽标同样竖排，把右上角切换按钮顶出区域外。
     这类问题目视截图容易漏（只看一张截图时像是「就长这样」），必须用源码守卫钉住：
       1) 区域头必须是两层（标题行 + 徽标行），不能把标题、徽标、控制位塞同一个 flex row；
       2) 标题必须 nowrap + 省略号（否则必然折行）；
       3) 右上角控制位必须 flex:none（否则会被标题挤走）。
     只在 Node 下跑（要读文件）。 */
  caseStart("窄容器排版守卫：区域头部");
  if (!nodeMods) {
    result.skipped = (result.skipped || 0) + 1;
    result.notes = result.notes || [];
    result.notes.push({ name: "窄容器排版守卫", detail: "需要 Node 读文件，浏览器侧跳过" });
  } else {
    var cssFile = null;
    for (var ci2 = 0; ci2 < candidates.length; ci2++) {
      var cand2 = candidates[ci2].replace(/app\.js$/, "ui.css");
      try {
        if (nodeMods.fs.existsSync(cand2)) { cssFile = cand2; break; }
      } catch (e) { /* 忽略 */ }
    }
    if (!cssFile) {
      record(false, "找不到 ui.css（无法做排版守卫）", "存在 ui.css", "null");
    } else {
      var css = String(nodeMods.fs.readFileSync(cssFile, "utf8"));

      /* 取某个选择器的规则体（不处理嵌套 at-rule，本文件用不到） */
      var ruleOf = function (sel) {
        var i = css.indexOf(sel + " {");
        if (i < 0) return "";
        var brace = css.indexOf("{", i);
        var depth = 0;
        for (var j = brace; j < css.length; j++) {
          if (css.charAt(j) === "{") depth++;
          else if (css.charAt(j) === "}") {
            depth--;
            if (depth === 0) return css.slice(brace + 1, j);
          }
        }
        return "";
      };
      var stripComments = function (t) {
        return t.replace(/\/\*[\s\S]*?\*\//g, " ");
      };

      var titleRule = stripComments(ruleOf(".exp-region-title"));
      var ctlRule = stripComments(ruleOf(".exp-region-ctl"));

      ok(".exp-region-title 规则存在", titleRule.length > 0);
      ok("标题 white-space:nowrap（绝不一字一行）", /white-space:\s*nowrap/.test(titleRule));
      ok("标题有省略号兜底", /text-overflow:\s*ellipsis/.test(titleRule));
      ok("标题 min-width:0（允许收缩而不是撑破容器）", /min-width:\s*0/.test(titleRule));

      ok(".exp-region-ctl 规则存在", ctlRule.length > 0);
      ok("右上角控制位 flex:none（不会被标题挤走）", /flex:\s*none|flex:\s*0\s+0\s+auto/.test(ctlRule));

      /* 头部容器必须是 column（两层堆叠），不能是 row 把三样塞一行 */
      var hdRule = stripComments(ruleOf(".exp-region-hd"));
      ok(".exp-region-hd 规则存在", hdRule.length > 0);
      ok("区域头用 flex-direction:column（标题层与徽标层分开）",
        /flex-direction:\s*column/.test(hdRule));
      ok("区域头不再用单行 align-items:center 硬塞",
        !/align-items:\s*center[^}]*flex-direction:\s*row/.test(hdRule));

      /* 结构守卫：JS 侧标题行必须是独立的 .exp-region-hd-row 容器 */
      ok("app.js 有独立的 .exp-region-hd-row 容器",
        /exp-region-hd-row/.test(src || ""));
      ok("app.js 里徽标不再计入 .exp-region-hd-row（徽标独占一层）",
        !/exp-region-hd-row[\s\S]{0,200}exprMutualBadge/.test(src || "") ||
        /head.appendChild\(headRow\)[\s\S]{0,80}exprMutualBadge/.test(src || ""));

      /* 语义守卫（0.9.34）：徽标只讲互斥，不再重复「生效中」——
         状态唯一由右上角 .exp-region-ctl 表达，两处都写会出两个「生效中」。 */
      var badgeFn = "";
      var bi = (src || "").indexOf("function exprMutualBadge");
      if (bi >= 0) {
        var bb = src.indexOf("{", bi);
        var bd = 0;
        for (var bj = bb; bj < src.length; bj++) {
          if (src.charAt(bj) === "{") bd++;
          else if (src.charAt(bj) === "}") {
            bd--;
            if (bd === 0) { badgeFn = src.slice(bb, bj + 1); break; }
          }
        }
      }
      ok("定位到 exprMutualBadge 函数体", badgeFn.length > 20);
      ok("徽标文案不再包含「生效中」（避免与右上角重复）",
        !/生效中/.test(badgeFn.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\r\n]*/g, " ")));
      ok("徽标说明内含「二选一」或「互斥」语义",
        /二选一|互斥/.test(badgeFn));
    }
  }


  /* ---------------------------------------------------------------- 11. 嘴巴特效（可选第 8 部位） */
  /* 0.9.35/0.9.36 的真实教训：mouth_嘘（嘴型）与 mouth_嘘_气（吐出的气）原来挤在同一个
     「嘴巴」槽里，而 Spine 一个槽一次只能显示一个附件 → 二者必然互斥，可它们在语义上是两层。
     扩成两个槽后，这组断言守住四条关键语义：
       1) 嘴巴特效是**可选**部位：缺键合法，不得因此判非法；
       2) 反算时「没写过该键」就不得凭空写出该键（否则 31 个事件各多一行、产生无意义 diff）；
       3) 原事件显式写过 "iris": null 时，反算必须保留该键（否则「无改动」的事件一存就变字节）；
       4) 整眼非空时两侧眨眼仍为 null（v3 无 wink）。 */
  caseStart("嘴巴特效（可选第 8 部位）");
  var OPT_PARTS = ["嘴巴特效"];
  eq("可选部位独立于必填 7 部位", OPT_PARTS.length, 1);

  /* 反算：没写过该键 → 不得凭空出现 */
  var partsNoFx = slotsToParts({ 嘴巴: "mouth_微笑" });
  eq("没设嘴巴特效 → 反算结果不含该键", Object.keys(partsNoFx).indexOf("嘴巴特效") >= 0, false);
  eq("必填 7 部位仍在", Object.keys(partsNoFx).length, 7);

  /* 反算：设了 → 必须出现 */
  var partsFx = slotsToParts({ 嘴巴: "mouth_嘘", 嘴巴特效: "mouth_嘘_气" });
  eq("设了嘴巴特效 → 反算结果含该键", partsFx["嘴巴特效"], "mouth_嘘_气");
  eq("嘴巴与嘴巴特效可以同时有值（不再互斥）", partsFx["嘴巴"], "mouth_嘘");
  eq("两者同时存在时键数 = 8", Object.keys(partsFx).length, 8);

  /* 显式 null 键必须保留（0.9.36 修的无意义 diff） */
  var packBlinkWithNullIris = { iris: null, lash: "lash_L_0" };
  var roundTripped = slotsToParts({ 眼珠_L: null, 睫毛_L: "lash_L_0" }, { "眨眼_左": packBlinkWithNullIris });
  eq("原事件写了 iris:null → 反算保留该键",
    JSON.stringify(roundTripped["眨眼_左"]), JSON.stringify(packBlinkWithNullIris));
  eq("若是新事件（无 hint）→ 省略 null 键",
    JSON.stringify(slotsToParts({ 睫毛_L: "lash_L_0" })["眨眼_左"]),
    JSON.stringify({ lash: "lash_L_0" }));

  /* 无 wink 规则仍然成立 */
  eq("合法整眼（两侧都有）→ 两侧眨眼仍为 null",
    JSON.stringify([
      slotsToParts({ 整眼_L: "a", 整眼_R: "b", 眼珠_L: "c" })["眨眼_左"],
      slotsToParts({ 整眼_L: "a", 整眼_R: "b", 眼珠_R: "d" })["眨眼_右"],
    ]), JSON.stringify([null, null]));

  /* ---------------------------------------------------------------- 12. 差异比较归一 */
  /* 0.9.39 的真 bug：`JSON.stringify(undefined) === undefined`（不是字符串 "null"），
     而比较时只把 before 的 undefined 归一成 null、after 没归一 →
     可选部位「嘴巴特效」缺失时永远判「有改动」，保存按钮一直亮着。
     这条守住「缺键与 null 视为等价」这个语义。 */
  caseStart("差异比较：缺键与 null 等价");
  var norm = function (v) { return v === undefined ? null : v; };
  var same = function (a, b) { return JSON.stringify(norm(a)) === JSON.stringify(norm(b)); };
  eq("两边都 undefined → 等价", same(undefined, undefined), true);
  eq("undefined 与 null → 等价（核心修复）", same(undefined, null), true);
  eq("null 与 undefined → 等价（对称）", same(null, undefined), true);
  eq("null 与有值 → 不等", same(null, "mouth_嘘"), false);
  eq("有值相同 → 等价", same("mouth_嘘", "mouth_嘘"), true);
  eq("有值不同 → 不等", same("mouth_嘘", "mouth_嘘_气"), false);
  /* 反例守卫：不能归一成「把有值当 null」 */
  eq("空字符串不被误当归一（保持原值）", same("", null), false);

  /* @@VOICE-STRIP-START@@ */
  /* ---------------------------------------------------------------- 13. 事件分页显示裁剪 */
  /* 0.9.43 按用户要求删掉事件卡片里的 5 处显示。这些是**源码守卫**：
     删掉渲染很容易，但很容易连带把「底层能力」一起删掉，
     所以同时钉住两件事：
       a) 被删的那几块**不得**再出现在 buildVoiceEventRow / buildVoiceLineRow；
       b) 对应的 agent 入口**必须**存在（否则就是「删了 UI = 删了能力」）。
     只在 Node 下跑（要读 app.js），浏览器侧跳过。 */
  caseStart("事件分页：显示已裁剪、能力仍在");
  if (!nodeMods) {
    result.skipped = (result.skipped || 0) + 1;
    result.notes = result.notes || [];
    result.notes.push({ name: "事件分页裁剪守卫", detail: "需要 Node 读 app.js，浏览器侧跳过" });
  } else {
    var appSrc2 = src || "";
    var fnOf = function (name) {
      var i = appSrc2.indexOf("function " + name + "(");
      if (i < 0) return "";
      var b = appSrc2.indexOf("{", i);
      var d = 0;
      for (var j = b; j < appSrc2.length; j++) {
        var c = appSrc2[j];
        if (c === '"') { j++; while (j < appSrc2.length && appSrc2[j] !== '"') { if (appSrc2[j] === "\\") j++; j++; } continue; }
        if (c === "{") d++;
        else if (c === "}") { d--; if (d === 0) return appSrc2.slice(b, j + 1); }
      }
      return "";
    };
    var stripComments2 = function (t) {
      return t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\r\n]*/g, " ");
    };

    var evRow = stripComments2(fnOf("buildVoiceEventRow"));
    var lineRow = stripComments2(fnOf("buildVoiceLineRow"));
    ok("定位到 buildVoiceEventRow", evRow.length > 200);
    ok("定位到 buildVoiceLineRow", lineRow.length > 200);

    /* a) 被删的显示不得回来 */
    eq("卡片头部不再渲染试听按钮", evRow.indexOf("voice-audition") >= 0, false);
    eq("卡片头部不再渲染表情摘要标签", evRow.indexOf("exprPartsSummary") >= 0, false);
    eq("展开体不再渲染资源检查", evRow.indexOf("voiceResourceChecks") >= 0, false);
    eq("展开体不再渲染模型动画清单", evRow.indexOf("voice-model-anims") >= 0, false);
    eq("展开体不再渲染动画清单", evRow.indexOf("voice-ev-anims") >= 0, false);
    eq("台词行不再渲染动画徽标", lineRow.indexOf("animTag") >= 0, false);
    eq("台词行不再渲染动画预览按钮", lineRow.indexOf("voice-line-preview") >= 0, false);
    eq("台词行不再渲染 .ogg 路径元素", lineRow.indexOf("voice-line-file") >= 0, false);

    /* b) 能力入口必须存在 */
    var full = stripComments2(appSrc2);
    ok("agent 入口 voiceChecks 存在", /voiceChecks:\s*\(/.test(full));
    ok("agent 入口 voiceAudition 存在", /voiceAudition:\s*\(/.test(full));
    ok("agent 入口 voicePreviewLine 存在", /voicePreviewLine:\s*\(/.test(full));
    ok("agent 入口 voiceAnimationStatus 存在", /voiceAnimationStatus:\s*\(/.test(full));
    ok("底层函数 voiceResourceChecks 仍在", /function voiceResourceChecks\(/.test(full));
    ok("底层函数 auditionVoiceEvent 仍在", /function auditionVoiceEvent\(/.test(full));
    ok("底层函数 previewVoiceAnimation 仍在", /function previewVoiceAnimation\(/.test(full));

    /* c) 文件路径不丢：移入 title */
    ok("台词行把音频路径放进了 title（信息不丢）", /textEl\.title/.test(lineRow));
  }

  /* @@EVENT-EXPR-START@@ */
  /* ---------------------------------------------------------------- 14. 事件页点卡片加载表情 */
  /* 0.9.45：点事件卡片展开时，顺带应用该事件的表情（等价于在表情页点同一事件）。
     这组守卫钉住三件事：
       a) 展开分支里**确实调用了** applyExprSet；
       b) 收起分支**不得**调用 applyExprSet —— 否则会把用户在表情页刚精调好的结果覆盖掉；
       c) 收起时只清 appliedSet，不清 saveTarget（否则收起后就不知道要存回哪个事件）。 */
  caseStart("事件页点卡片加载表情");
  if (!nodeMods) {
    result.skipped = (result.skipped || 0) + 1;
    result.notes = result.notes || [];
    result.notes.push({ name: "事件页应用表情守卫", detail: "需要 Node 读 app.js，浏览器侧跳过" });
  } else {
    var src3 = src || "";
    var fnToggle = "";
    var ti = src3.indexOf("function toggleVoiceEvent(");
    if (ti >= 0) {
      var tb = src3.indexOf("{", ti);
      var td = 0;
      for (var tj = tb; tj < src3.length; tj++) {
        var tc = src3.charAt(tj);
        if (tc === '"') { tj++; while (tj < src3.length && src3.charAt(tj) !== '"') { if (src3.charAt(tj) === "\\") tj++; tj++; } continue; }
        if (tc === "{") td++;
        else if (tc === "}") { td--; if (td === 0) { fnToggle = src3.slice(tb, tj + 1); break; } }
      }
    }
    ok("定位到 toggleVoiceEvent 函数体", fnToggle.length > 100);

    var clean = fnToggle.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\r\n]*/g, " ");

    /* a) 展开分支必须调用 applyExprSet */
    ok("展开时调用 applyExprSet（这就是「点卡片加载表情」）",
      /if\s*\(\s*!wasOpen\s*\)[\s\S]{0,300}applyExprSet\s*\(/.test(clean));

    /* b) 收起分支不得调用 applyExprSet —— 关键：避免覆盖用户精调 */
    var elsePart = "";
    var elseIdx = clean.indexOf("} else {");
    if (elseIdx >= 0) elsePart = clean.slice(elseIdx);
    eq("收起分支不调用 applyExprSet（不覆盖精调结果）",
      /applyExprSet\s*\(/.test(elsePart), false);

    /* c) 收起清 appliedSet、保留 saveTarget */
    ok("收起时清 appliedSet", /state\.expr\.set\s*=\s*null/.test(elsePart));
    eq("收起时**不**清 saveTarget（否则不知道存回哪个事件）",
      /state\.expr\.saveTarget\s*=\s*null/.test(elsePart), false);
  }

  /* @@ACCORDION-START@@ */
  /* ---------------------------------------------------------------- 15. 手风琴展开 + 页签改名 */
  /* 0.9.46：
     a) 台词页的卡片改成**手风琴** —— 打开一张时自动关闭其它的。
        用 Set 允许多开时，展开几张会把列表撑得很长、也不明确「当前在看哪个」。
     b) 「事件」页签改名为「台词」，更贴合功能语义（这个页列的就是台词）。
        注意：内部 id（tabEvents / eventPanel / eventTabBadge）**不改**，
        时间轴里的 Spine「事件」轨道也不改（那是另一回事）。 */
  caseStart("台词页：手风琴展开 + 页签改名");
  if (!nodeMods) {
    result.skipped = (result.skipped || 0) + 1;
    result.notes = result.notes || [];
    result.notes.push({ name: "手风琴/改名守卫", detail: "需要 Node 读文件，浏览器侧跳过" });
  } else {
    var src4 = src || "";
    var toggleFn = "";
    var gi = src4.indexOf("function toggleVoiceEvent(");
    if (gi >= 0) {
      var gb = src4.indexOf("{", gi);
      var gd = 0;
      for (var gj = gb; gj < src4.length; gj++) {
        var gc = src4.charAt(gj);
        if (gc === '"') { gj++; while (gj < src4.length && src4.charAt(gj) !== '"') { if (src4.charAt(gj) === "\\") gj++; gj++; } continue; }
        if (gc === "{") gd++;
        else if (gc === "}") { gd--; if (gd === 0) { toggleFn = src4.slice(gb, gj + 1); break; } }
      }
    }
    var cleanT = toggleFn.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\r\n]*/g, " ");
    ok("定位到 toggleVoiceEvent", cleanT.length > 100);

    /* a) 手风琴：展开前必须 clear() */
    ok("展开分支先 v.expanded.clear()（手风琴关键）",
      /v\.expanded\.clear\s*\(\s*\)/.test(cleanT));
    /* 顺序：先 clear 再 add */
    var ci = cleanT.indexOf("v.expanded.clear");
    var ai = cleanT.indexOf("v.expanded.add");
    ok("clear 在 add 之前（否则会把刚打开的那张也清掉）", ci >= 0 && ai > ci);

    /* b) 页签改名：index.html 里 tabEvents 按钮的文字必须是「台词」 */
    var idxFile = null;
    for (var xi = 0; xi < candidates.length; xi++) {
      var cand3 = candidates[xi].replace(/app\.js$/, "index.html");
      try { if (nodeMods.fs.existsSync(cand3)) { idxFile = cand3; break; } } catch (e) { /* 忽略 */ }
    }
    if (!idxFile) {
      record(false, "找不到 index.html（无法校验页签文案）", "存在 index.html", "null");
    } else {
      var idxSrc = String(nodeMods.fs.readFileSync(idxFile, "utf8"));
      var tabBlock = "";
      var ti2 = idxSrc.indexOf('id="tabEvents"');
      if (ti2 >= 0) tabBlock = idxSrc.slice(ti2, ti2 + 400);
      ok("定位到 tabEvents 按钮", tabBlock.length > 40);
      ok("页签文案是「台词」", /<span>台词<\/span>/.test(tabBlock));
      eq("页签不再写「事件」", /<span>事件<\/span>/.test(tabBlock), false);
      /* 内部 id 必须保留（改名只改文案，不破坏引用） */
      ok("内部 id tabEvents 未被改名", idxSrc.indexOf('id="tabEvents"') >= 0);
      ok("内部 id eventPanel 未被改名", idxSrc.indexOf('id="eventPanel"') >= 0);
      /* 搜索框提示同步 */
      ok("搜索占位符改成「搜索台词」", /placeholder="搜索台词/.test(idxSrc));
    }

    /* c) 不应把时间轴的 Spine「事件」轨道也改名（它是另一个概念） */
    ok("时间轴的 Spine 事件轨道仍叫「事件」",
      /label: "事件", note: "events 时间轴/.test(src4));
  }

  /* @@FADE-START@@ */
  /* ---------------------------------------------------------------- 16. 展开/收起淡入淡出 */
  /* 0.9.47/0.9.48 的两条关键事实（不写下来很容易被后来的人改回去）：
     a) **不能用 CSS transition**：renderVoiceList() 一开始就 box.textContent = ""
        整列重建，元素是「先删后建」，没有可过渡的中间态，CSS 过渡根本不会触发。
        所以用 WAAPI 在新节点上跑关键帧。
     b) **必须先淡出旧的再重建**：否则被手风琴顶掉的那张会在同一帧内从 184px
        塌成 26px（实测 6.7ms），视觉上是硬切换 —— 那正是「缺少淡入淡出」最刺眼处。 */
  caseStart("台词卡片：展开/收起淡入淡出");
  if (!nodeMods) {
    result.skipped = (result.skipped || 0) + 1;
    result.notes = result.notes || [];
    result.notes.push({ name: "淡入淡出守卫", detail: "需要 Node 读 app.js，浏览器侧跳过" });
  } else {
    var srcF = src || "";
    var fnOf2 = function (name) {
      var i = srcF.indexOf("function " + name + "(");
      if (i < 0) return "";
      var b = srcF.indexOf("{", i);
      var d = 0;
      for (var j = b; j < srcF.length; j++) {
        var c = srcF.charAt(j);
        if (c === '"') { j++; while (j < srcF.length && srcF.charAt(j) !== '"') { if (srcF.charAt(j) === "\\") j++; j++; } continue; }
        if (c === "{") d++;
        else if (c === "}") { d--; if (d === 0) return srcF.slice(b, j + 1); }
      }
      return "";
    };
    var stripC = function (t) { return t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\r\n]*/g, " "); };

    var fadeIn = stripC(fnOf2("voiceAnimateExpandedBody"));
    var fadeOut = stripC(fnOf2("voiceFadeOutThen"));
    var toggleF = stripC(fnOf2("toggleVoiceEvent"));

    ok("存在入场动画函数", fadeIn.length > 100);
    ok("入场动画用 opacity 0->1", /opacity:\s*0/.test(fadeIn) && /opacity:\s*1/.test(fadeIn));
    ok("存在退出动画函数", fadeOut.length > 100);
    ok("退出动画用 opacity 1->0", /opacity:\s*1/.test(fadeOut) && /opacity:\s*0/.test(fadeOut));

    /* a) 必须用 WAAPI（element.animate），不能指望 CSS transition */
    ok("入场用 WAAPI（body.animate）", /\.animate\s*\(/.test(fadeIn));
    ok("退出用 WAAPI（body.animate）", /\.animate\s*\(/.test(fadeOut));

    /* b) 必须先淡出再重建。
       注意：**不能用「renderVoice 的文本位置」判断顺序** ——
       它位于传给 voiceFadeOutThen 的回调体内部，源码位置必然更早，
       但运行时是「先淡出、回调里才 renderVoice」。文本先后 != 执行先后。
       改用结构性判断：
         1) renderVoice() 落在回调函数体里；
         2) 该回调是作为参数传给 voiceFadeOutThen 的。 */
    ok("toggle 里调用 voiceFadeOutThen（先淡出）", /voiceFadeOutThen\s*\(/.test(toggleF));
    var cbName = "";
    var cbMatch = toggleF.match(/const\s+(\w+)\s*=\s*\(\)\s*=>\s*\{/);
    if (cbMatch) cbName = cbMatch[1];
    ok("定位到重建回调（const afterRebuild = () => {...}）", cbName.length > 0);
    var cbBody = "";
    if (cbName) {
      var cbAt = toggleF.indexOf("const " + cbName);
      var ob = toggleF.indexOf("{", cbAt);
      var dd = 0;
      for (var cj = ob; cj < toggleF.length; cj++) {
        var cc = toggleF.charAt(cj);
        if (cc === '"') { cj++; while (cj < toggleF.length && toggleF.charAt(cj) !== '"') { if (toggleF.charAt(cj) === "\\") cj++; cj++; } continue; }
        if (cc === "{") dd++;
        else if (cc === "}") { dd--; if (dd === 0) { cbBody = toggleF.slice(ob, cj + 1); break; } }
      }
    }
    ok("renderVoice() 落在重建回调体内", /renderVoice\s*\(/.test(cbBody));
    ok("该回调是作为参数传给 voiceFadeOutThen 的",
      new RegExp("voiceFadeOutThen\\s*\\(\\s*" + cbName + "\\s*\\s*\\s*\\)").test(toggleF));
    /* 接线守卫（变异测试暴露的漏洞）：
       只检查「函数写得对」还不够 —— 把调用删掉后，上面那些断言仍然全过。
       必须另外断言「展开时**确实调用**了入场动画」。 */
    ok("展开时确实调用 voiceAnimateExpandedBody()",
      /voiceAnimateExpandedBody\s*\(\s*\)/.test(cbBody));

    /* c) 尊重无障碍设置 */
    ok("尊重 prefers-reduced-motion", /prefers-reduced-motion/.test(stripC(srcF)));

    /* d) 反例守卫：不得依赖 CSS transition 做这件事（我们验证过它不会触发） */
    var cssFile2 = null;
    for (var ci4 = 0; ci4 < candidates.length; ci4++) {
      var c4 = candidates[ci4].replace(/app\.js$/, "ui.css");
      try { if (nodeMods.fs.existsSync(c4)) { cssFile2 = c4; break; } } catch (e) { /* 忽略 */ }
    }
    if (cssFile2) {
      var css2 = String(nodeMods.fs.readFileSync(cssFile2, "utf8"));
      var bodyRule = "";
      var bi2 = css2.indexOf(".voice-ev-body {");
      if (bi2 >= 0) bodyRule = css2.slice(bi2, css2.indexOf("}", bi2));
      eq("voice-ev-body 不靠 transition 做展开动画（整列重建下无效）",
        /transition/.test(bodyRule), false);
    }
  }

  /* ---------------------------------------------------------------- 17. 属性面板 / 片段库移除（0.9.49） */
  /* 用户要求「把部件分页的属性面板、片段库整个删掉（前端，后端功能不动）」。
     这组守卫钉的不是「删干净了」，而是**最容易在后续维护里被破坏的两条边界**：
       a) 删掉的只能是显示层 —— 每组已删 DOM 都必须有仍然可调的接口，
          否则就成了「剥夺能力」，这在本仓是明确禁止的；
       b) 不许留死绑定 —— 指向已删 DOM 的 addEventListener 不会抛错，
          只会在某天恢复 DOM 时悄悄接错线，属于最难查的一类回归。 */
  caseStart("属性面板/片段库：删显示、留能力");
  if (!nodeMods) {
    result.skipped = (result.skipped || 0) + 1;
    result.notes = result.notes || [];
    result.notes.push({ name: "属性面板/片段库移除守卫", detail: "需要 Node 读 app.js / index.html，浏览器侧跳过" });
  } else {
    var srcG = src || "";
    var stripG = function (t) { return t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\r\n]*/g, " "); };

    /* --- a) index.html：这批 DOM 必须不存在 --- */
    var idxFileG = null;
    for (var xg = 0; xg < candidates.length; xg++) {
      var cg = candidates[xg].replace(/app\.js$/, "index.html");
      try { if (nodeMods.fs.existsSync(cg)) { idxFileG = cg; break; } } catch (e) { /* 忽略 */ }
    }
    ok("找到 index.html（校验已删 DOM 用）", !!idxFileG);
    if (idxFileG) {
      var idxG = String(nodeMods.fs.readFileSync(idxFileG, "utf8"));
      var IDS_REMOVED = [
        "propEmpty", "propBody", "bpx", "bpy", "brot2", "bscale",
        "propKeyBtn", "btnFreeTransform", "propKeyState", "ftHint",
        "clipSection", "clipBody", "clipStat", "clipName", "btnClipSave",
        "clipCollision", "clipList", "poseName", "btnPoseSave", "poseList"
      ];
      var stillThere = IDS_REMOVED.filter(function (id) { return idxG.indexOf('id="' + id + '"') >= 0; });
      eq("20 个属性/片段库 DOM id 全部已删除（残留清单应为空）", JSON.stringify(stillThere), "[]");

      /* 0.9.50：上一轮（0.9.49）这里断言「保留面板标题『属性』+ #selBadge/#selBody/#boneBody/#skelWrap」，
         因为那轮只删了常用属性区与片段库。这一轮用户把整块 panel-inspector 连同调试面板一起删了，
         所以这几条**必须反转**为「确实不存在」—— 否则守卫会一直报假失败，或者更糟：
         有人为了让它们通过而把 DOM 加回来。 */
      var IDS_WIDE_REMOVED = IDS_REMOVED.concat([
        "selBadge", "selEmpty", "selBody", "attBody", "boneBody", "skelWrap",
        "debug", "debugBody", "debugToggle", "diagBadge", "boneLegend", "boneNote",
        "meshNote", "legend", "weightsNote", "exBlink", "exMouth", "exBrow",
        "exprAvail", "issueWrap", "issueList",
        "posX", "posY", "rotX", "rotRange", "scaleX", "scaleY",
        "btnLayerUp", "btnLayerDown", "btnLayerTop", "btnLayerBottom", "btnRestoreSlot",
        "btnSelVisible", "btnSelLock", "attReset",
        "bx", "by", "brot", "bsx", "bsy", "bshear",
        "editBoneName", "editBoneIndex", "editBonePath", "editBoneMode", "editBoneSpace",
        "btnBoneKey", "btnBoneClear", "btnKeyRotate", "btnKeyTranslate", "btnKeyScale",
        "pivotNote", "mirrorNote", "mirrorLimit",
        "skelToggle", "skelBody", "skelStatus", "skelName", "skelParent", "skelNewParent",
        "skelX", "skelY", "skelRot", "skelLen", "skelKeepWorld", "skelToName", "skelInfo", "skelIssues",
        "btnSkelCreate", "btnSkelDelete", "btnSkelReparent", "btnSkelRename"
      ]);
      var wideStill = IDS_WIDE_REMOVED.filter(function (id) { return idxG.indexOf('id="' + id + '"') >= 0; });
      eq("panel-inspector 与 debug 两块的 DOM 全部已删除（残留清单应为空）", JSON.stringify(wideStill), "[]");
      ok("面板标题「属性」已随 panel-inspector 一并移除", /<h2>属性<\/h2>/.test(idxG) === false);
      /* 部件列表本身必须留（这是用户还要用的部分） */
      ok("保留部件列表 #list", idxG.indexOf('id="list"') >= 0);
      ok("保留搜索框 #slotSearch", idxG.indexOf('id="slotSearch"') >= 0);
      /* 四个主分页必须留 */
      ok("保留部件/台词/表情/动画四个主分页", idxG.indexOf('id="tabParts"') >= 0 && idxG.indexOf('id="tabEvents"') >= 0 && idxG.indexOf('id="tabExpr"') >= 0 && idxG.indexOf('id="tabAnim"') >= 0);

      /* 帮助文案不能再描述已删除的界面 */
      ok("帮助不再宣称属性面板含常用属性区", idxG.indexOf("常用项：文档模式、AutoKey、位置 / 旋转 / 缩放") < 0);
      ok("帮助不再把「片段库」列为可展开分区", idxG.indexOf("更多 / 片段库 / 骨架结构") < 0);
    }

    /* --- b) app.js：能力接口必须齐备 --- */
    var codeG = stripG(srcG);
    /* 自由变换：原本只有只读诊断（ftState / ftBox / ftHitAt），按钮删掉后必须补动作入口 */
    ["ftToggle", "ftEnter", "ftCommit", "ftCancel"].forEach(function (fn) {
      ok("导出动作入口 " + fn, new RegExp("      " + fn + ":\\s*\\(").test(srcG) || new RegExp("      " + fn + ":\\s*function").test(srcG));
    });
    /* 属性面板 4 个输入框的等价写入口 */
    ok("导出 setBoneField（位置/旋转/缩放的等价入口）", /      setBoneField:\s*\(/.test(srcG));
    ok("setBoneField 复用 applyBoneNumber（不复制一套换算逻辑）", /applyBoneNumber\s*\(\s*field\s*,\s*value\s*\)/.test(codeG));
    ok("setBoneField 有字段白名单（防打错字段名静默写入）", /FIELD_INVALID/.test(codeG));
    /* 片段库/姿态预设的既有接口不得被删 */
    ["clips", "clipSave", "clipInsert", "clipRename", "clipDelete", "clipCollision", "poseSave", "poseApply", "poseDelete"].forEach(function (fn2) {
      ok("保留片段/姿态接口 " + fn2, new RegExp("      " + fn2 + ":").test(srcG));
    });

    /* --- b2) 0.9.50 删掉整块检查器 + 调试面板后**新补的 11 个接口** ---
       **这批一开始没写断言，变异测试当场抓到 5 个假守卫**：把 slotField / diagnostics /
       selectSlot / layerMove 的导出删掉、把 syncInspector 恢复成写已删 DOM，
       测试仍然 3430/3430 一路绿灯。教训：接口存在性必须逐条断言，
       不能假设「我加过了所以它在」。 */
    var NEW_APIS_0950 = [
      "selectSlot", "slotSelection", "slotVisible", "slotLock", "layerMove",
      "slotRestore", "attachmentRestore", "slotField", "diagnostics"
    ];
    NEW_APIS_0950.forEach(function (api) {
      /* 用 indexOf 找「导出键位置」而不是拼正则 ——
         这里踩过两次：正则字面量里写双反斜杠会让 `(?:` 变成 `\\(?` 少一个括号，
         整个断言文件直接加载失败（表现为「suites not loaded」，总数凭空少 166 条，
         而 failed 仍然是 0，最容易被误读成"全绿"）。
         键位置的判据：缩进 6 空格 + 键名 + 冒号，后面紧跟 `(` 或 `function`。 */
      var key = "      " + api + ":";
      var at = srcG.indexOf(key);
      ok("0.9.50 接口存在且位于导出键位置: " + api, at >= 0);
      if (at >= 0) {
        var after = srcG.slice(at + key.length).replace(/^\s+/, "").slice(0, 20);
        ok("0.9.50 接口是函数而非值: " + api, after.charAt(0) === "(" || after.indexOf("function") === 0);
      }
    });
    /* 槽位写入不得拐去写骨骼 —— 这是我实测抓到的真 bug：
       applyInspectorNumber / applyBoneField 开头原来都有 if (editTarget() === "bone") return applyBoneNumber(...)，
       于是「写槽位」的接口在骨骼目标下会写骨骼。现在必须存在**不拐弯**的 applySlotNumber / applySlotField。 */
    ok("存在独立槽位写入 applySlotNumber（不按 editTarget 分流）",
      /function\s+applySlotNumber\s*\(/g.test(codeG));
    ok("存在独立槽位写入 applySlotField（不按 editTarget 分流）",
      /function\s+applySlotField\s*\(/g.test(codeG));
    ok("slotField 直连 applySlotNumber / applySlotField（不经过分流函数）",
      /applySlotNumber\s*\(field,\s*value\)/g.test(codeG) && /applySlotField\s*\(field,\s*value\)/g.test(codeG));
    /* 拒绝必须带原因：只回 ok:false 等于让调用方猜 */
    ok("槽位写入被拒时返回具体 reason（不是裸 false）", /slotWriteFail\s*\(/g.test(codeG));
    /* 这条断言**必须扫剥掉注释的代码**（codeG），不能扫原始源码。
       我第一次就写成了 srcG.indexOf(...)，结果一直假失败 ——
       因为说明「第一版写错了」的那段注释里正好保留了这五个字。
       同一类坑上一轮也踩过（那次是注释导致假**通过**，这次是假**失败**）。 */
    ok("动画锁提示不再给「切到绑定姿态」这条错建议（实测切过去也改不了）",
      codeG.indexOf("请切到绑定姿态") < 0);

    /* --- b3) 清空的同步函数体内不得再触碰已删 DOM ---
       变异 M8：把 syncInspector() 改回写 $("selBadge")，第一版断言抓不到。
       这里直接检查这几个函数体里有没有 $(" 调用。 */
    var EMPTIED_FNS = ["syncInspector", "syncBoneInspector", "syncDebug", "syncAttachmentInspector", "syncSkeletonPanel", "syncMirrorPanel", "syncIkPanel"];
    var emptiedOk = EMPTIED_FNS.filter(function (name) {
      var i = srcG.indexOf("function " + name + "(");
      if (i < 0) return true; /* 函数都没了也算「不再触碰」 */
      var b = srcG.indexOf("{", i);
      var d = 0;
      var body = "";
      for (var j = b; j < srcG.length; j++) {
        var ch = srcG.charAt(j);
        if (ch === '"') { j++; while (j < srcG.length && srcG.charAt(j) !== '"') { if (srcG.charAt(j) === "\\\\") j++; j++; } continue; }
        if (ch === "{") d++;
        else if (ch === "}") { d--; if (d === 0) { body = srcG.slice(b, j + 1); break; } }
      }
      return body.indexOf('$("') >= 0;
    });
    eq("七个清空的同步函数体内不再触碰任何 DOM（命中清单应为空）", JSON.stringify(emptiedOk), "[]");

    /* --- c) 不许留死绑定：$("已删 id") 之后不许再出现 addEventListener ---
       **第一版检测器是假通过的**（变异测试抓到的，3428/3428 一路绿灯）：
         它写成 $("id")[^;]*?addEventListener，要求两者出现在**同一条语句**。
         但真实的死绑定是两句相邻代码 ——
             const deadClipSave = $("btnClipSave");
             if (deadClipSave) deadClipSave.addEventListener("click", () => 0);
         [^;]*? 跨不过第一句结尾的分号，于是变异体永远通过。
       现在同时覆盖两种形态，且**只用 indexOf / charAt 判断，不堆嵌套正则转义**：
         ① 直连：$("id") 到下一个分号之前就出现 addEventListener
         ② 变量中转：取出赋值左侧变量名，只在**它所属的函数体**里找 addEventListener
            （限制在同一函数体内，是为了避免别处同名变量 btn/body 造成误伤） */
    var DEAD_IDS = ["clipToggle", "btnClipSave", "btnPoseSave", "clipCollision", "propKeyBtn", "bpx", "bpy", "brot2", "bscale"];
    var fnBodyAt = function (text, at) {
      var f = text.lastIndexOf("function ", at);
      if (f < 0) return "";
      var ob = text.indexOf("{", f);
      if (ob < 0 || ob > at + 200) return "";
      var d = 0;
      for (var j = ob; j < text.length; j++) {
        var ch = text.charAt(j);
        if (ch === "{") d++;
        else if (ch === "}") { d--; if (d === 0) return text.slice(ob, j + 1); }
      }
      return "";
    };
    var varBefore = function (text, at) {
      var j = at - 1;
      while (j >= 0 && text.charAt(j) === " ") j--;
      var end = j;
      while (j >= 0 && /[A-Za-z0-9_$]/.test(text.charAt(j))) j--;
      return text.slice(j + 1, end + 1);
    };
    var occurrences = function (text, needle) {
      var out = [];
      var from = 0;
      while (out.length < 40) {
        var k = text.indexOf(needle, from);
        if (k < 0) break;
        out.push(k);
        from = k + needle.length;
      }
      return out;
    };
    var findDeadBinding = function (text, id) {
      var needle = '$("' + id + '")';
      var ks = occurrences(text, needle);
      for (var hi = 0; hi < ks.length; hi++) {
        var k = ks[hi];
        /* ① 直连形态：同一语句内绑事件 */
        var tail = text.slice(k, k + 160);
        var semi = tail.indexOf(";");
        var anchor = tail.indexOf("addEventListener");
        if (anchor >= 0 && (semi < 0 || anchor < semi)) return true;
        /* ② 变量中转形态 */
        var eq = text.lastIndexOf("=", k);
        if (eq < 0) continue;
        var name = varBefore(text, eq);
        if (!name || name.length > 40) continue;
        var scope = fnBodyAt(text, k);
        if (!scope) scope = text.slice(Math.max(0, k - 200), k + 600);
        if (scope.indexOf(name + ".addEventListener") >= 0) return true;
      }
      return false;
    };
    var bindingHits = DEAD_IDS.filter(function (id) { return findDeadBinding(codeG, id); });
    eq("没有指向已删 DOM 的死绑定（命中清单应为空）", JSON.stringify(bindingHits), "[]");
    /* 反向自检 1：检测器必须认得出「变量中转」—— 否则它只对一种写法有效，等于假守卫。 */
    var demoDead = 'function x() { const deadClipSave = $("btnClipSave"); if (deadClipSave) deadClipSave.addEventListener("click", () => 0); }';
    eq("死绑定检测器自检：识别变量中转形态", findDeadBinding(demoDead, "btnClipSave"), true);
    /* 反向自检 2：也不能把「只读守卫」误判成死绑定 ——
       setClipOpen() 里就有 const btn = $("clipToggle")，它只是读状态，没有绑事件。 */
    var demoGuard = 'function y() { const btn = $("clipToggle"); if (btn) btn.setAttribute("aria-expanded", "false"); }';
    eq("死绑定检测器自检：只读守卫不算死绑定", findDeadBinding(demoGuard, "clipToggle"), false);

    /* --- d) visible.clipSection 不许谎报 ---
       原来它读 offsetParent：DOM 删掉后会恒返回 false，但 false 在旧语义里表示
       「这块存在但收起/隐藏」，会把调用方误导成「展开就能用」。必须同时给 removed 标记。 */
    ok("visible.clipSection 明确置 false", /clipSection:\s*false/.test(codeG));
    ok("同时暴露 clipSectionRemoved 标记（区分「不存在」与「被隐藏」）",
      /clipSectionRemoved:\s*true/.test(codeG));
    ok("visible.clipSection 不再依赖 offsetParent 探测已删节点",
      !/clipSection:\s*!!\s*\(\s*\$\\?\(/.test(codeG));
    /* ftState 同理：buttonPressed 返回 null 分不清「按钮没了」与「按钮未按下」 */
    ok("ftState 报告 buttonRemoved（不假装按钮还在）", /buttonRemoved:\s*true/.test(codeG));

    /* --- e) syncPropCommon / commitBoneField 不得复活（它们的唯一消费者已删） ---
       注意注释里出现过这两个名字是允许的，所以断言「不是函数定义」而不是「字面量不存在」。 */
    ok("syncPropCommon 不再是函数定义", !/function\s+syncPropCommon\s*\(/.test(codeG));
    ok("commitBoneField 不再是函数定义", !/function\s+commitBoneField\s*\(/.test(codeG));
    ok("syncChrome 不再调用 syncPropCommon", !/syncPropCommon\s*\(\s*\)/.test(codeG));
  }

  /* ---------------------------------------------------------------- 18. 工具条改名与选中态（0.9.51） */
  /* 用户反馈两件事：「平移视野」应改名叫拖拽；「选中和没选中应该有明显的视觉提示」。
     第二件查下去发现是**真 bug**，不只是样式不够显眼：
       · syncEditToolbar() 原来只同步 {translate, rotate, scale, pose} 四个按钮，
         「选择」走 state.tool === "select"、「拖拽」走 state.tool === "pan"，两者都不在表里
         → 它们的 aria-pressed 永远停在初始 false，点了完全没反馈；
       · setTool() 只调 syncToolbar()（不含按钮同步）→ 点「拖拽」后甚至连状态都不会刷新。
     这组守卫钉住：改名落地、6 个按钮互斥、样式用 inset 而不是会被裁剪的负偏移。 */
  caseStart("工具条：拖拽改名与选中态");
  if (!nodeMods) {
    result.skipped = (result.skipped || 0) + 1;
    result.notes = result.notes || [];
    result.notes.push({ name: "工具条改名与选中态守卫", detail: "需要 Node 读 app.js / index.html / ui.css，浏览器侧跳过" });
  } else {
    var srcH = src || "";
    var stripH = function (t) { return t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\r\n]*/g, " "); };
    var codeH = stripH(srcH);

    /* --- a) index.html：改名落地、旧名不再出现 --- */
    var idxH = null;
    for (var xh = 0; xh < candidates.length; xh++) {
      var ch2 = candidates[xh].replace(/app\.js$/, "index.html");
      try { if (nodeMods.fs.existsSync(ch2)) { idxH = ch2; break; } } catch (e) { /* 忽略 */ }
    }
    ok("找到 index.html（工具条改名校验用）", !!idxH);
    if (idxH) {
      var idxSrcH = String(nodeMods.fs.readFileSync(idxH, "utf8"));
      ok("拖拽按钮的 rail-label 是「拖拽」", /id="btnToolPan"[\s\S]{0,300}?<span class="rail-label">拖拽<\/span>/.test(idxSrcH));
      ok("拖拽按钮加了 aria-label", /id="btnToolPan"[^>]*aria-label="拖拽工具"/.test(idxSrcH));
      ok("拖拽按钮的 title 以「拖拽」开头", /id="btnToolPan"[^>]*title="拖拽（/.test(idxSrcH));
      /* 全文不许再有旧名（帮助表、快捷键表、画布提示、aria-label 都在同一份 HTML 里） */
      eq("index.html 里不再有「平移视野」", idxSrcH.indexOf("平移视野"), -1);
      eq("index.html 里不再有「平移视图」", idxSrcH.indexOf("平移视图"), -1);
    }

    /* --- b) app.js：拖拽状态栏文案 + 两个漏同步的按钮 --- */
    ok("setTool 的状态栏文案用「拖拽工具」", codeH.indexOf("拖拽工具：按住画布拖动") >= 0);
    ok("app.js 里不再有「平移视野」", codeH.indexOf("平移视野") < 0);
    ok("app.js 里不再有「平移视图」", codeH.indexOf("平移视图") < 0);

    /* 6 个工具按钮必须都在选中态同步表里 */
    var RAIL_SYNC_IDS = ["btnToolMove", "btnToolRotate", "btnToolScale", "btnToolPose", "railSelect", "btnToolPan"];
    var missingSync = RAIL_SYNC_IDS.filter(function (id) {
      /* 该 id 必须作为数组元素出现在 syncEditToolbar 的同步表里（形如 ["translate", $("btnToolMove")]） */
      return !new RegExp('\\$\\("' + id + '"\\)').test(codeH) ||
             codeH.indexOf('"' + id + '"') < 0;
    });
    eq("6 个工具按钮都在同步表里（缺失清单应为空）", JSON.stringify(missingSync), "[]");
    /* 精确一点：syncEditToolbar 函数体里必须出现这 6 个 id */
    var edBody = "";
    (function () {
      var i = srcH.indexOf("function syncEditToolbar(");
      if (i < 0) return;
      var b = srcH.indexOf("{", i);
      var d = 0;
      for (var j = b; j < srcH.length; j++) {
        var cc = srcH.charAt(j);
        if (cc === '"') { j++; while (j < srcH.length && srcH.charAt(j) !== '"') { if (srcH.charAt(j) === "\\") j++; j++; } continue; }
        if (cc === "{") d++;
        else if (cc === "}") { d--; if (d === 0) { edBody = srcH.slice(b, j + 1); break; } }
      }
    })();
    ok("定位到 syncEditToolbar 函数体", edBody.length > 500);
    var notInEd = RAIL_SYNC_IDS.filter(function (id) { return edBody.indexOf('"' + id + '"') < 0; });
    eq("syncEditToolbar 里确实同步了全部 6 个按钮（缺失清单应为空）", JSON.stringify(notInEd), "[]");
    /* 关键回归：activeTool 必须认 state.tool 的 select/pan 两个值 */
    ok("同步表按 state.tool 的 select 分支判定", /state\.tool === "select"/.test(edBody));
    ok("同步表按 state.tool 的 pan 分支判定", /state\.tool === "pan"/.test(edBody));
    /* setTool 必须调 syncEditToolbar —— 这是第二个真 bug */
    var stBody = "";
    (function () {
      var i = srcH.indexOf("function setTool(");
      if (i < 0) return;
      var b = srcH.indexOf("{", i);
      var d = 0;
      for (var j = b; j < srcH.length; j++) {
        var cc = srcH.charAt(j);
        if (cc === '"') { j++; while (j < srcH.length && srcH.charAt(j) !== '"') { if (srcH.charAt(j) === "\\") j++; j++; } continue; }
        if (cc === "{") d++;
        else if (cc === "}") { d--; if (d === 0) { stBody = srcH.slice(b, j + 1); break; } }
      }
    })();
    ok("setTool 里调用了 syncEditToolbar()（否则拖拽按钮永不刷新）",
      /syncEditToolbar\s*\(\s*\)/.test(stripH(stBody)));

    /* --- c) ui.css：选中态样式 --- */
    var cssH = null;
    for (var xc = 0; xc < candidates.length; xc++) {
      var cc2 = candidates[xc].replace(/app\.js$/, "ui.css");
      try { if (nodeMods.fs.existsSync(cc2)) { cssH = cc2; break; } } catch (e) { /* 忽略 */ }
    }
    ok("找到 ui.css", !!cssH);
    if (cssH) {
      var cssSrc = String(nodeMods.fs.readFileSync(cssH, "utf8"));
      /* 选中态必须含 inset 竖条 —— 外挂 ::before 的负偏移会被 .tool-rail 的 overflow 裁掉，
         实测 left:-4px 与 left:-6px 两种都被裁（按钮相对轨道的 left 就是 0）。 */
      var selRule = "";
      var ri = cssSrc.indexOf('.rail-btn[aria-pressed="true"] {');
      if (ri >= 0) selRule = cssSrc.slice(ri, cssSrc.indexOf("}", ri));
      ok("选中态规则存在", selRule.length > 40);
      ok("选中态用 box-shadow inset 画竖条（外挂负偏移会被 overflow 裁掉）",
        /inset/.test(selRule));
      ok("选中态保留了实心蓝底", /background:\s*var\(--accent/.test(selRule));
      ok("选中态字重加粗", /font-weight:\s*700/.test(selRule));
      /* 反例守卫：不许再用 ::before 扛竖条（我们验证过它会被裁） */
      ok("不再用 .rail-btn[aria-pressed=true]::before 做左色条",
        cssSrc.indexOf('.rail-btn[aria-pressed="true"]::before') < 0);
      /* 未选中态降透明度，拉开亮度差 */
      var offRule = "";
      var oi = cssSrc.indexOf('.rail-btn[aria-pressed="false"] {');
      if (oi >= 0) offRule = cssSrc.slice(oi, cssSrc.indexOf("}", oi));
      ok("未选中态降透明度（拉开与选中态的亮度差）", /opacity:\s*0\.\d+/.test(offRule));
    }
  }

  /* ---------------------------------------------------------------- 19. 拖拽模式是开关（0.9.52） */
  /* 用户要求：「拖拽应该可以再点一次退出拖拽模式」—— 在这个模式里能拖画布，不在就拖不动。
     这组守卫钉住的是**开关语义**，而不只是"按钮能点"：
       · 再点一次要退出，且**回到进入前的工具**（用户在「选择」态按 H 拖一下再按 H 回来，
         不能被冲到「移动」）；
       · 按钮 / H 键 / 菜单三个入口必须是同一语义（否则 UI 上会出现"点了有反应、按键没反应"）；
       · panMode().returnTo 在非拖拽态必须为 null —— 第一版写成 state.toolBeforePan || "move"，
         退出后工具已清空却仍报 "move"，与当前实际工具（可能是 select）不符。 */
  caseStart("拖拽模式：开关语义");
  if (!nodeMods) {
    result.skipped = (result.skipped || 0) + 1;
    result.notes = result.notes || [];
    result.notes.push({ name: "拖拽开关守卫", detail: "需要 Node 读 app.js，浏览器侧跳过" });
  } else {
    var srcP = src || "";
    var codeP = srcP.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\r\n]*/g, " ");

    /* 抽出 setTool 的函数体做结构判断 */
    var setToolBody = "";
    (function () {
      var i = srcP.indexOf("function setTool(tool, opts)");
      if (i < 0) i = srcP.indexOf("function setTool(tool)");
      if (i < 0) return;
      var b = srcP.indexOf("{", i);
      var d = 0;
      for (var j = b; j < srcP.length; j++) {
        var c = srcP.charAt(j);
        if (c === '"') { j++; while (j < srcP.length && srcP.charAt(j) !== '"') { if (srcP.charAt(j) === "\\") j++; j++; } continue; }
        if (c === "{") d++;
        else if (c === "}") { d--; if (d === 0) { setToolBody = srcP.slice(b, j + 1); break; } }
      }
    })();
    ok("定位到 setTool 函数体", setToolBody.length > 200);
    var setToolCode = setToolBody.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\r\n]*/g, " ");

    /* a) 开关：同值再次调用必须走"退出"分支 */
    ok("setTool 有「再次点同一个 pan 就退出」的分支",
      setToolCode.indexOf('tool === "pan" && state.tool === "pan"') >= 0);
    /* b) 退出要还原进入前的工具，且只认 move / select */
    ok("退出时读取 state.toolBeforePan 还原原工具",
      /state\.toolBeforePan/.test(setToolCode));
    ok("还原只允许 move / select（不把 rotate/scale 之类混进来）",
      setToolCode.indexOf('state.toolBeforePan === "select" ? "select" : "move"') >= 0);
    /* c) 进入时要记下当前工具。
       **第一版断言写成 /state\.toolBeforePan\s*=/，是假守卫**（变异测试 P3 抓到的）：
       setTool 里有两处赋值 —— 退出分支 `= null`、进入分支 `= state.tool === "select" ? … : "move"`。
       变异把进入分支也改成 `= null` 后，退出分支那处依然能匹配，断言照样绿。
       所以必须断言**赋值右侧的具体形态**，而不是只匹配等号。 */
    ok("进入拖拽时把当前工具记进 toolBeforePan（右侧必须是 select/move 的判定）",
      /state\.toolBeforePan\s*=\s*state\.tool\s*===\s*"select"\s*=\s*"move"/.test(setToolCode) ||
      /state\.toolBeforePan\s*=\s*state\.tool\s*===\s*"select"\s*[^;]*"move"/.test(setToolCode));
    ok("退出时把 toolBeforePan 清空（避免下次进入读到陈旧值）",
      /state\.toolBeforePan\s*=\s*null/.test(setToolCode));
    /* d) 退出分支必须刷新工具按钮选中态（否则高亮停在拖拽上） */
    ok("退出分支调用 syncEditToolbar()", /syncEditToolbar\s*\(\s*\)/.test(setToolCode));

    /* e) state 里必须有这个字段的初始值 */
    ok("state 初始化里有 toolBeforePan 字段（初始 null）",
      /toolBeforePan:\s*null/.test(codeP));

    /* f) 三个入口同一语义：H 键与菜单都调 setTool("pan")，不再各自实现一套 */
    ok("H 键走 setTool(\"pan\")", /lower === "h"[\s\S]{0,120}?setTool\("pan"\)/.test(codeP));
    ok("菜单项走 setTool(\"pan\")", /menuItem\("toolPan"[\s\S]{0,200}?setTool\("pan"\)/.test(codeP));
    ok("工具栏按钮走 setTool(\"pan\")", /\["btnToolPan"[\s\S]{0,60}?setTool\("pan"\)/.test(codeP));

    /* g) panMode().returnTo 在非拖拽态必须是 null，不能落到默认 "move" */
    var pmBody = "";
    (function () {
      var i = srcP.indexOf("panMode: () =>");
      if (i < 0) return;
      var b = srcP.indexOf("{", srcP.indexOf("=>", i));
      var d = 0;
      for (var j = b; j < srcP.length; j++) {
        var c = srcP.charAt(j);
        if (c === '"') { j++; while (j < srcP.length && srcP.charAt(j) !== '"') { if (srcP.charAt(j) === "\\") j++; j++; } continue; }
        if (c === "{") d++;
        else if (c === "}") { d--; if (d === 0) { pmBody = srcP.slice(b, j + 1); break; } }
      }
    })();
    ok("定位到 panMode 的返回体", pmBody.length > 60);
    ok("panMode 的 returnTo 按 active 三元判定（退出态给 null）",
      /returnTo:\s*state\.tool === "pan"/.test(pmBody));
    ok("panMode 暴露 currentTool 便于区分「退出态」与「当前工具」",
      /currentTool:/.test(pmBody));
    ok("panMode 暴露 canDragCanvas（画布左键能否拖动视野）",
      /canDragCanvas:/.test(pmBody));

    /* h) 面板能力不得因为改动而被删：togglePan / setPan 必须还在导出里 */
    ["togglePan", "setPan", "panMode"].forEach(function (api) {
      ok("拖拽接口仍在导出里: " + api,
        srcP.indexOf("      " + api + ":") >= 0);
    });

    /* i) 菜单 label 与按钮统一叫「拖拽」（曾经菜单写「平移」、按钮写「平移视野」，三处不一致） */
    ok("编辑菜单项 label 是「拖拽」", /menuItem\("toolPan",\s*\{\s*label:\s*"拖拽"/.test(codeP));
    eq("app.js 里不再有 label: \"平移\"", codeP.indexOf('label: "平移"'), -1);

    /* j) 帮助文案必须说明「再点一次退出」—— 这是用户这次唯一明确要求的可发现性 */
    var idxP = null;
    for (var xp = 0; xp < candidates.length; xp++) {
      var cp = candidates[xp].replace(/app\.js$/, "index.html");
      try { if (nodeMods.fs.existsSync(cp)) { idxP = cp; break; } } catch (e) { /* 忽略 */ }
    }
    if (idxP) {
      var idxText = String(nodeMods.fs.readFileSync(idxP, "utf8"));
      ok("帮助里写明了「拖拽是开关」", idxText.indexOf("拖拽是开关") >= 0);
      /* 断言钉**语义**而不是逐字措辞：上一版写成「退出会回到进入前的工具」，
         结果 0.9.53 把文案润色成「退出回到进入前的工具」（去掉一个「会」）就误报失败。
         现在只要求核心短语在，删掉整句说明依然会红。 */
      ok("帮助里说明退出会回到进入前的工具", idxText.indexOf("回到进入前的工具") >= 0);
      ok("按钮 title 说明「再点一下或再按 H 退出」", /再点一下或再按 H 退出/.test(idxText));
    }
  }

  /* ---------------------------------------------------------------- 20. 工具条分区与顺序（0.9.53） */
  /* 用户要求：「拖拽移动到选择工具下面；左侧边栏工具栏上下两个分区分别加上分区小标题：操作、视图控制，
     加在分割线的左上方合适位置」。
     这组守卫钉三件事：
       · 拖拽必须紧跟在「选择」之后（顺序错了 UI 就回到原样，而顺序是纯 DOM 位置，源码断言唯一能抓的地方）
       · 两个分区标题必须**挂在各自分隔线之上**（"左上方"= 标题行在 sep 之前，不是之后）
       · 收起态标题不能占空间 —— 44px 导轨放不下四个字，撑破就等于布局坏了 */
  caseStart("工具条：分区标题与顺序");
  if (!nodeMods) {
    result.skipped = (result.skipped || 0) + 1;
    result.notes = result.notes || [];
    result.notes.push({ name: "工具条分区守卫", detail: "需要 Node 读 index.html / ui.css，浏览器侧跳过" });
  } else {
    var idxQ = null;
    for (var xq = 0; xq < candidates.length; xq++) {
      var cq = candidates[xq].replace(/app\.js$/, "index.html");
      try { if (nodeMods.fs.existsSync(cq)) { idxQ = cq; break; } } catch (e) { /* 忽略 */ }
    }
    ok("找到 index.html（分区校验用）", !!idxQ);
    if (idxQ) {
      var htmlQ = String(nodeMods.fs.readFileSync(idxQ, "utf8"));

      /* a) 顺序：选择 → 拖拽 → 移动 → … → 指向 → 视图控制标题 → sep → 放大 */
      var posOf = function (needle) { return htmlQ.indexOf(needle); };
      var pSelect = posOf('id="railSelect"');
      var pPan = posOf('id="btnToolPan"');
      var pMove = posOf('id="btnToolMove"');
      var pPose = posOf('id="btnToolPose"');
      var pZoomIn = posOf('id="btnZoomInRail"');
      var pFit = posOf('id="btnFitRail"');
      ok("六个位置都找到了",
        pSelect >= 0 && pPan >= 0 && pMove >= 0 && pPose >= 0 && pZoomIn >= 0 && pFit >= 0);
      ok("拖拽紧跟在选择之后（select < pan）", pSelect < pPan);
      ok("拖拽在移动之前（pan < move）", pPan < pMove);
      ok("操作区以指向收尾（pose < zoomIn）", pPose < pZoomIn);
      ok("视图区顺序：放大 → 缩小 → 适应窗口", pZoomIn < posOf('id="btnZoomOutRail"') && posOf('id="btnZoomOutRail"') < pFit);

      /* b) 两个分区标题，且都出现在分隔线之前（"左上方"） */
      var titles = [];
      var reT = /rail-group-text">([^<]+)</g;
      var mt;
      while ((mt = reT.exec(htmlQ))) titles.push(mt[1]);
      eq("恰好两个分区标题", JSON.stringify(titles), JSON.stringify(["操作", "视图控制"]));

      /* 标题必须在对应 sep 之前：取出第一个标题与第一个 sep 的位置。
         **第一版用 htmlQ.indexOf('操作') 定位，是假守卫**（变异测试 Q2 抓到的）：
         「操作」这两个字在文件里出现多次（注释、帮助文案都有），indexOf 命中的是**注释里**
         第一处，与标题元素无关 —— 把标题元素挪到分隔线之后，位置照样不变。
         所以必须匹配**元素本身**（rail-group-text">操作），不是裸文字。 */
      var firstTitleAt = posOf('rail-group-text">操作');
      var firstSepAt = posOf('<span class="rail-sep"');
      ok("「操作」标题元素在第一条分隔线之前（左上方语义）",
        firstTitleAt >= 0 && firstSepAt >= 0 && firstTitleAt < firstSepAt);
      var secondTitleAt = posOf('rail-group-text">视图控制');
      var secondSepAt = htmlQ.indexOf('<span class="rail-sep"', firstSepAt + 1);
      ok("「视图控制」标题元素在第二条分隔线之前",
        secondTitleAt > firstSepAt && secondSepAt > 0 && secondTitleAt < secondSepAt);
      /* 标题必须在「操作区最后一个按钮」之后、「视图区第一个按钮」之前 */
      ok("「视图控制」落在指向与放大之间", pPose < secondTitleAt && secondTitleAt < pZoomIn);

      /* c) 帮助文案同步 —— 分组名必须出现在帮助里，否则用户看不到分区是什么 */
      ok("帮助里写明两组分区名", htmlQ.indexOf("分两组：<b>操作</b>") >= 0 && htmlQ.indexOf("<b>视图控制</b>") >= 0);
    }

    /* d) CSS：标题走 max-width/opacity 那套（不能 display:none），且收起态高度为 0 */
    var cssQ = null;
    for (var xcq = 0; xcq < candidates.length; xcq++) {
      var ccq = candidates[xcq].replace(/app\.js$/, "ui.css");
      try { if (nodeMods.fs.existsSync(ccq)) { cssQ = ccq; break; } } catch (e) { /* 忽略 */ }
    }
    ok("找到 ui.css（分区标题样式用）", !!cssQ);
    if (cssQ) {
      var cssQText = String(nodeMods.fs.readFileSync(cssQ, "utf8"));
      var titleRule = "";
      var ti = cssQText.indexOf('.rail-group-title {');
      if (ti >= 0) titleRule = cssQText.slice(ti, cssQText.indexOf("}", ti));
      ok("存在 .rail-group-title 规则", titleRule.length > 30);
      ok("收起态标题高度为 0（44px 导轨放不下文字，不能撑破）", /height:\s*0/.test(titleRule));

      var txtRule = "";
      var txi = cssQText.indexOf('.rail-group-text {');
      if (txi >= 0) txtRule = cssQText.slice(txi, cssQText.indexOf("}", txi));
      ok("标题文字走 max-width:0 + opacity:0（与 .rail-label 同一套，可过渡）",
        /max-width:\s*0/.test(txtRule) && /opacity:\s*0/.test(txtRule));
      /* 反例：不许用 display:none 收标题 —— 那样展开时没有过渡，会闪 */
      ok("标题文字没有用 display:none 收起（不可过渡）", !/display:\s*none/.test(txtRule));

      ok("展开态标题显示文字（max-width 放开 + opacity 复原）",
        cssQText.indexOf('.tool-rail[data-expanded="true"] .rail-group-text') >= 0);
      /* 窄屏横排必须隐藏标题 */
      ok("窄屏断点里隐藏分区标题", cssQText.indexOf('.rail-group-title { display: none !important; }') >= 0);
    }
  }

  /* @@SUITE-END@@ 新断言块一律插到这一行之前 */
  global.__selftestEventNamesResult = result;
})(typeof globalThis !== "undefined" ? globalThis : this);
