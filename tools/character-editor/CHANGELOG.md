# 变更记录 · 内置人物包管理器

只记**编辑器自身**的里程碑版本（`version.js`）。人物包 JSON 的 `schemaVersion`（v3.2 为 `manifestSchemaVersion: 2`）与保存接口的 `apiVersion` 本轮都保持 **1**，不随编辑器版本变化 —— 编辑器版本 ↔ 人物包格式是两套版本轴。

## 0.9.238 — 序列帧列表认规范 catalog 形态（三视图→序列帧流水线接线）

**背景**：`workspace/three-view-to-seq-anime/step1` 要把图生视频序列帧接进人物包
`sequences/`，验收第一步是动画分页「序列帧 · 复杂动作」能列出动作。真实包
catalog 的规范形态（pack-format v3 §5b）是：

```json
"registries": { "sequence": { "owner": "sequences/index.json", "ids": ["tail_wag", "wave"] } }
```

| 缺陷 | 表现 | 根因 |
| --- | --- | --- |
| `animSequenceEntries` 对 object 形态逐 key 展开 | 序列区渲染出 `owner`、`ids` 两条假条目，真实动作 ID 一个都看不到 | 只写了数组分支与「对象=旧形态 {id: {…}}」分支，没考虑规范要求的 `{owner, ids}` 包装 |

| 修复 | 说明 |
| --- | --- |
| `ids` 数组包装优先 | object 且含 `ids` 数组 → 取 `ids` 再走原数组分支；规范形态直接可用 |
| 旧形态不回归 | 无 `ids` 键的 object 仍逐 key 展开（自建 fixtures 兼容） |

**0.9.238 验证**：`node tools/character-editor/selftest-node.mjs` → **4383/4383**；
规范形态复现 `["tail_wag","wave"]`、旧形态 `{wave:{…}}` 仍渲染 `["wave","nod"]`。
端到端干跑（临时拷包，用完即删）：`wire_sequence.py` planned→ready 接线 + catalog
generation 内容寻址递增 + Q2/Q5/Q6/Q8/C1/C2/C9/C11/C16 校验通过，幂等重跑逐字节一致。

## 0.9.118–0.9.144 — 规划书 P0：Frame Timeline 帧视图（Flash 式逐帧）

### 0.9.144：P3 收口 —— Events 参数编辑（修掉「文本字段被当数字」的静默丢弃）

**审计结论**：event 的六个字段（`name/int/float/string/volume/balance`）在 `track-edit.SCHEMA` 里**早已定义**，
`#dsExtra` 也早已由 SCHEMA 驱动渲染。所以「Events 参数编辑 UI 未做」这个说法不准确 ——
真正的问题是**它渲染错了**。

| 缺陷 | 表现 | 根因 |
| --- | --- | --- |
| `string` 字段被渲染成 number 输入框 | 在 `event.string` 里填 `"hello"` 后**参数没写进去**，且没有任何提示 | 渲染分支只区分 `bool` 与「其他」，`f.type === "string"` 落进了 number 分支，`Number("hello")` → `NaN` → `if (Number.isFinite(v))` 静默跳过 |

| 修复 | 说明 |
| --- | --- |
| 新增 `string` 分支 | `type="text"`；空串 → `null`（显式清空）；**不 trim**（保留用户有意打的空格） |
| 纯函数 `controlForField()` / `parseFieldInput()`（在 `key-inspector.js`） | 把「字段类型 → 控件类型」与「文本 → 值」抽出来，selftest 与 UI **走同一套逻辑** |
| 数字字段解析改走 `parseFieldInput` | 非法输入不再静默丢弃，而是明确提示 `「xxx」不是合法数字` |

**0.9.144 验证**：`node tools/character-editor/selftest-node.mjs` → **4196/4196**
（key-inspector 105 → **128** 条，新增字段控件映射与文本解析）。

浏览器实测（自建 v3.2 包，`tracks.events` = `[{time:0.5,name:"ev1",int:1,float:0.5,string:"a"}, …]`，用完即删）：
字段控件类型为 `name→select(ev1)`、`int→number(1)`、`float→number(0.5)`、**`string→text("a")`**、
`volume→number(1)`、`balance→number(0)`；把 `string` 改成 `"hello 世界 42"` 后表单值**原样保留为字符串**（含中文与空格）。

**P3 到此全部完成**：Slot Attachment / Color / Two Color、约束（ik/transform/path）、Deform 顶点表、
Draw Order、Events 参数编辑均已可用。


### 0.9.143：P3 —— Deform 顶点表与顶点编辑校验

规划书 §4.5 的 Deform：`track-edit` 早有完整校验与 `setDeformVertex` 单点写入，
面板里也已有「顶点下标 + x/y + 应用」。缺的是**顶点表视图**与**布局判定**。

| 新增 | 说明 |
| --- | --- |
| 纯模块 `deform-edit.js`（`window.SpineDeformEdit`） | 布局判定 / 顶点表解析 / 编辑校验 / 单点与批量参数 / 摘要 |
| `#dsExtra` 顶点表 | 只读列出当前 Key 的顶点（`#n  x, y`），点一行回填下标与 x/y |
| 自检 `selftest-deformedit.js` | 64 条断言 |

**这块最容易写坏的地方**（所以单独抽成纯模块并写死测试）：
- **普通网格**：`vertices` 是 `[dx0,dy0, dx1,dy1, …]`，长度 = 顶点数 × 2，可编辑坐标；
- **加权网格**：`vertices` 是每顶点的**骨骼权重**（`[boneCount, bone1, w1, …]`），**不是坐标**。
  对它按 x/y 写入会把权重写坏（官方 `SkeletonJson.ts:968-1005` 对两者处理完全不同）。
  所以 `layoutOf` 一旦判出 `weighted`，解析与编辑**一律拒绝**并给出可读原因。

**其它刻意的约束**
- `vertices` 长度为奇数 → 直接判非法（`DEFORM_VERTICES_ODD`），不猜怎么配对；
- 下标上界**优先用 `offsetLength/2`**（真实网格容量），没有再退回 `vertexCount`；
- **批量编辑必须整体成功**：只要一个顶点越界，整批拒绝且不产出任何参数 —— 半套顶点数据比不改更糟。

**0.9.143 验证**：`node tools/character-editor/selftest-node.mjs` → **4173/4173**（新增 deform-edit 64 条）；
`bump-editor-version.mjs --check` → 62 处 `?v=` 同源。

浏览器实测（自建 v3.2 验证包，含 `default/s2/m1` 形变轨，2 个 Key / vertices 长度 8，用完即删）：
顶点表显示 `顶点表 @1.5s · 4 个顶点` 与 `#0 0,0 / #1 -8,6 / #2 0,0 / #3 8,-6`，与夹具逐值一致；
点第 2 个顶点 → 下标/x/y 回填为 `1 / -8 / 6`，状态栏 `已选中顶点 #1（-8, 6）@ 1.5s`，且 `dirty:false`（纯读取不写文档）。


### 0.9.140–0.9.142：P4 —— 曲线预设

规划书 §8.1 / §14 P4 要求「曲线预设」。Spine 的 `key.curve` 存的是**绝对坐标**贝塞尔控制点，
而用户心里的「缓入 / 缓出 / 回弹」是**归一化**的（0..1 时间 × 0..1 进度）—— 换算必须按段两端缩放。

| 新增 | 说明 |
| --- | --- |
| 纯模块 `curve-presets.js`（`window.SpineCurvePresets`） | 8 个预设 + 归一化→绝对换算 + 多分量平铺 + **反查**（给定控制点猜预设） |
| 检查器「曲线预设」区 | 下拉 + 应用按钮 + 当前预设识别提示；仅当插值为 Bezier 时可用 |
| 自检 `selftest-curvepresets.js` | 62 条断言 |

**8 个预设**：`linear`、`easeIn`、`easeOut`、`easeInOut`、`easeInStrong`、`easeOutStrong`、
`backOut`（末端过冲）、`backIn`（起步反向）。过冲类 `y` 会越出 `[v1,v2]`，UI 会提示。

**几条刻意的设计**
- **值可能反向**（`v2 < v1`）：进度映射是 `v1 + p*(v2-v1)`，不是加绝对值 —— selftest 覆盖了 100→0 的情形；
- **多分量**：`translate/scale/shear` 有 x/y，curve 数组按分量平铺成 4N 个数；
- **反查阈值**：4 个分量累计误差 ≤ 0.02 才认定「就是某个预设」，否则只给最近候选（不硬认）；
- **值轴退化**（`v1 === v2`）：y 无法归一化，只用 x 比较并标记 `reduced`。

**0.9.142 验证**：`node tools/character-editor/selftest-node.mjs` → **4109/4109**（新增 curve-presets 62 条）；
`bump-editor-version.mjs --check` → 59 处 `?v=` 同源。

浏览器实测（副本，用完即删）：选 `tail-1.rotate` 的 Key → 设 Bezier → 选 `easeInOut` → 应用，
草稿里实际写入 `[0.1775, -0.316986, 0.1975, 0.08524]`，与 `applyPreset` 的期望值逐位一致；
提示变为「当前 ≈ easeInOut」。

**修掉的两个真实缺陷（都是实测才暴露）**
1. **`setKeyCurve` 的 segment 形状用错**：我传 `{type:"bezier", curve}`，而它只认 `{points:{cx1,cy1,cx2,cy2}}`；
   传 type 只会改段类型、不写控制点 —— 表现为「点了应用但曲线没有变化」。
2. **反查覆盖了用户选择**：`syncPresetControls` 无条件把下拉框改写成反查结果，
   用户刚选好的 `easeInOut` 在刷新时被覆盖成 `linear`，于是「点应用却应用了别的」。
   现在只在用户**尚未选择**（值为空）时才回填。


### 0.9.136–0.9.139：P1 收口 —— §5.3 全身姿态关键帧

规划书 §5.3 要求三种创建方式：属性关键帧、骨骼姿态关键帧、**全身姿态关键帧**。
前两种已有（`keySelected`），第三种一直缺。§5.3 同时硬性要求
「全身记录必须提供范围确认，避免产生不必要的大量关键帧」——所以本轮做的是**确认 + 差异判定**两件事。

| 新增 | 说明 |
| --- | --- |
| `keyFullPose({scope, fields, atTime})` | 对一批骨批量打 rotate/translate/scale；`scope` = `visible` / `all` / `selected` |
| `keyFullPoseInteractive()` | §5.3 的范围确认框：可见骨 / 全部骨 / 仅已选骨 / 取消，并给出上限估算 |
| 纯函数 `needsFullPoseKey()` / `estimateFullPose()`（在 `key-inspector.js`） | 差异判定与规模估算抽成纯逻辑，selftest 与 UI **走同一套判定** |
| 帧右键菜单「全身姿态关键帧…」 | 入口；带「先选范围」提示 |
| `Ctrl+Shift+K` | 帧级快捷键（时间轴聚焦时），与 `K`/`Shift+K` 并列 |
| 句柄 `frameTimeline.fullPose(scope, atTime)` / `fullPoseInteractive()` | 自动化入口（前者跳过确认框） |

**核心语义：值没变就不写 Key。** 没有既有 Key → 必须写；有既有 Key 且差异 ≤ 1e-6 → 跳过。
这条规则让「全身打键」不会把 43 根骨 × 3 属性全部铺一遍。

**0.9.139 验证**：`node tools/character-editor/selftest-node.mjs` → **4047/4047**
（key-inspector 88 → 105 条，新增差异判定与估算）。

浏览器实测（副本，用完即删，原包零改动）：
| 情形 | 结果 |
| --- | --- |
| 空帧 + 可见骨（20 根） | 写 **60** 个 Key（20×3），292 → 352 |
| 同一时刻重复执行 | 写 **0** 个、跳过 60 —— **幂等** |
| 同一时刻改「全部骨」 | 再写 **69** 个（新增的 23 根骨），352 → 421 |
| 右键菜单 → 确认框 | 原文：`在帧 31（1.017s）为一批骨骼记录当前姿态的 rotate / translate / scale。只会写入与现有值不同的属性。` + §5.3 依据 + `最多 43 根骨 × 3 个属性 = 129 个 Key` |
| 点「可见骨（20）」 | 状态栏 `全身姿态关键帧：已写入 60 个属性 Key（20/20 根骨）@1.017s` |

**两次踩坑（同类错误，值得记）**：我在 app.js 里误用了 `isObject` / `isFiniteNum` —— 它们是
`key-inspector.js` 等**纯模块**内部的辅助函数，app.js 的闭包里只有 `isRecord` 与原生 `isFinite`。
两次都是**浏览器执行到该分支才抛 ReferenceError**，静态检查（`node --check`）发现不了。


### 0.9.134–0.9.135：P1 收口 —— §5.4 选中关键帧的属性检查器

规划书 §5.4 要求「选中关键帧后显示 Property / Target / Frame / Time / Value + 插值三段」。
现有 `#dsExtra` 只服务**额外轨道**（事件/绘制顺序/形变/约束/槽附件），普通骨骼/槽 Key 没有检查器 —— 这是缺口。

| 新增 | 说明 |
| --- | --- |
| 纯模块 `key-inspector.js`（`window.SpineKeyInspector`） | 值形状判定 / 视图模型 / **文本→写入值解析** / 写入准入 / 插值映射 |
| `#dsKeyInsp` 面板 | Property、Target、Frame、Time、Value（可编辑 + 写入）、插值三按钮、定位、删除 |
| `renderKeyInspector()` | 跟随当前选中 Key 刷新；输入框获得焦点时不覆盖用户正在打的字 |
| `keyInspApplyValue()` / `keyInspSetCurve()` | 写入走 `SpineAnimEdit.setKeyValues` / `setKeyCurve`，一条事务、可撤销 |
| 自检 `selftest-keyinspector.js` | 88 条断言 |

**为什么把解析拆成纯模块**：§5.4 的难点不在画面板，而在「一段文本 → 该字段的正确 JSON 形状」：
`rotate` 是数字、`translate/scale/shear` 是 `{x,y}`、`attachment` 是字符串或 `null`、
`color` 是 `RRGGBB[AA]`、`twoColor` 是 `{light,dark}`。这段逻辑放进 DOM 代码就没法测。

**几条刻意为之的语义**
- `attachment` 输入空串 → `{name:null}`（Spine 官方的「隐藏该槽」），这是**有意映射**，不是丢输入；
- `color` 只接受 6 或 8 位十六进制并统一转大写，**不转 rgb()** —— 转成 rgb 会让人以为可以随便写回；
- `vec2` 必须恰好两个数（`1 2 3` 直接拒绝，不猜取前两个）；分隔符接受空格/逗号/中文逗号；
- **末关键帧没有出段**：改插值被拒绝并说明「官方 Animation.ts 里末 frame 默认 STEPPED」；
- **曲线段内**：改插值拒绝（会破坏曲线语义），但**改值仍允许**（只影响时间，不影响值）——与 Dopesheet 既有规则一致。

**0.9.135 验证**：`node tools/character-editor/selftest-node.mjs` → **4030/4030**（新增 key-inspector 88 条）；
`bump-editor-version.mjs --check` → 56 处 `?v=` 同源。

浏览器实测（副本，用完即删）：
| 项 | 结果 |
| --- | --- |
| 跟随选择（三种字段形状） | `tail-1 · 旋转（°）帧 8 / 0.25s / 0.0852`；`head · 位移（px）帧 11 / 0.375s / 0, 0.1121`；`hips · 缩放（×）帧 19 / 0.625s / 1.0036, 1.0054` |
| 写入值 | 输入 `33.5` → `已写入 tail-1 · 旋转 @ 0.25s`，Key 数不变、`dirty` 置位、撤销后回基线 |
| 非法值 | `abc` → `写入被拒绝：「abc」不是合法数字`，文档零改动 |
| 插值切换 | `linear → stepped → bezier` 均生效并同步按钮态 |
| 末键改插值 | 按钮禁用，提示 `这是最后一个关键帧：它没有出段，插值设置不生效` |

**修掉的一个真实缺陷**：`dsSelectKey()` 原先只在**额外轨道**分支里刷新面板，
选中普通骨骼 Key 时检查器一直停在上一个 Key（实测三次切换读到同一内容）。已在该函数末尾统一刷新。


### 0.9.131–0.9.133：P4 起步 —— 前后帧姿态对照（新纯模块 `pose-compare.js`）

**审计结论**：规划书 P4 里的**洋葱皮（Onion Skin）此前已完整实现**
（`drawOnionSkin` + 前后帧数/步长 + 蓝=过去/琥珀=未来 + 性能统计 + 偏好持久化，且已接进 `render()`），
真正缺的是 **前后帧姿态对照**（并排/量化比较），以及音频波形、帧缩略图、曲线预设。

| 新增 | 规划书 | 说明 |
| --- | --- | --- |
| 纯模块 `pose-compare.js`（`window.SpinePoseCompare`） | §14 P4 | 只吃**已求值姿态**，不调 evalPose、不读模型、不改数据 —— 让「比较」可被单独测试 |
| `compareBone` / `comparePose` | §14 P4 | 分 **local / world 两层**报告；local 是动画数据的直接结果，world 含父链累积 |
| `angleDelta` | — | 角度差归一化到 (-180,180]，避免 359°↔1° 被算成 358° |
| `summaryLine` | — | 一行事实摘要，**优先报局部变化**（见下） |
| `diffTable` | — | 骨名 → 变更摘要表，供并排面板渲染 |
| 编辑器入口 `comparePoseWithFrame()` | §14 P4 | 画布右键「对照前后帧姿态 / 对照上一帧姿态」；只读求值，不污染 `lastPose`/`state.frame` |
| 句柄 `frameTimeline.comparePose(frame)` / `lastPoseDiff()` | — | 与 UI 同一函数 |
| 自检 `selftest-posecompare.js` | — | 77 条断言，含真实 rig（idle 0s vs 0.5s） |

**一个必须说明的设计修正（实测才暴露）**：最初的摘要写「42/43 根骨有变化」，但其中**局部变化只有 10 根**，
其余 31 根是父链带动的 —— 相邻帧上这个数字接近骨总数、几乎没有信息量，而且容易让人以为「全身都被改了」。
现在摘要改为**优先报局部变化**，只有「局部为 0 但有世界变化」时才强调父链带动。selftest 锁住这三条表述。

**0.9.133 验证**：`node tools/character-editor/selftest-node.mjs` → **3942/3942**
（新增 pose-compare 77 条）；`bump-editor-version.mjs --check` → 53 处 `?v=` 同源（新增 3 个脚本引用）。

浏览器实测（真实包 `workspace/packs/deepseek`，只读，`dirty:false`、Key 数不变）：
| 情形 | 结果 |
| --- | --- |
| 帧 0 ↔ 帧 1 | `局部变化 10/43 根骨；另有 31 根仅父链带动；最大：ahoge 旋转 0.12` |
| 帧 0 ↔ 帧 15 | `局部变化 10/43 根骨；另有 31 根仅父链带动；最大：ahoge 旋转 2.05` |
| 1.75s ↔ 帧 45 | `局部变化 10/43 根骨；另有 31 根仅父链带动；最大：tail-1 旋转 0.65` |
| 3.5s ↔ 帧 105 | `两帧姿态一致（43 根骨全部无显著变化）`（同一时刻，正确判定为一致） |
| 帧 0 ↔ 帧 999 | 拒绝：`目标帧 999 超出范围 0–105` |

**踩到的坑（值得记）**：`spine-core.parseModel(raw, atlas)` **必须同时传已解析的 atlas**，
否则返回 `ok:false` 且 `evalPose` 静默给出空 `world`/`local` 数组（不抛错）。我一开始只传了 raw，
得到"0 根骨"的假结论，差点据此写出错误测试。


### 0.9.128–0.9.130：P2 收口 —— 复制帧范围、粘贴姿态、Ctrl+D 复制副本

这三个菜单项/快捷键此前**存在于 UI 但未接线**（点了没反应或走错语义），本轮补完并实测。

| 项 | 规划书 | 语义（关键区别） |
| --- | --- | --- |
| 复制帧范围 `fsCopyFrameRange()` | §3.4 | 只把**帧范围内**的 Key 放进选择集再复制；与 `Ctrl+A` 全选的区别是范围受限 |
| 粘贴姿态 `fsPastePoseAt()` | §6.1 Copy Pose | 读取**当前求值姿态**、按相对 setup 值重新打键写到目标时间；**不是**复制该帧已有的 Key。目标帧原本无 Key 也会新建 |
| 复制副本 `fsDuplicateKey()`（`Ctrl+D`） | §6 Duplicate Key | 复制**已选中**的 Key 到下一帧；**不经过剪贴板**，不改用户剪贴板内容 |

**过程中修掉的两个真实缺陷**

1. **`Ctrl+D` 会批量克隆**：早期实现「无选择时退化成复制当前帧全部 Key」，实测在 0–30 帧范围内一次造出 **91 个 Key**。
   那不是 Duplicate，是批量克隆。现在**无选择时明确拒绝**并提示先选中。
2. **帧选择句柄调用形式不宽容**：`frameTimeline.select("range", {anchor,frame})` 会把字符串 `"range"` 当成帧号，
   报 `FRAME_SELECT_INVALID`。现在两种形式都接受（字符串 + 选项对象 / 单个对象）。

**0.9.130 验证**：`node tools/character-editor/selftest-node.mjs` → **3865/3865**；
`bump-editor-version.mjs --check` → 50 处 `?v=` 同源。

浏览器端到端（副本，用完即删，原包零改动）：
- 复制帧范围：选 0–30 帧（`已选帧 0–30（31）`）→ 剪贴板 **91 项**，偏移全部落在 0–30 帧内（`allOffsetsWithinRange:true`）；
- `Ctrl+D` 无选择 → 拒绝，Key 数 292→**292**（不再克隆）；
- `Ctrl+D` 有选择（11 个 Key）→ 292→**303**，且 `clipboardUntouched:true`；
- 粘贴姿态：`tail-1` 第 13 帧原本**无 Key**，粘贴后出现 Key（写入 3 个属性 Key），303→**306**。


### 0.9.127：P3 起步 —— Slot Color / Two Color 轨道、离散轨道阶梯绘制、预览不完整分级

**审计结论**：P3 的 `event`/`drawOrder`/`deform`/`ik`/`transform`/`path` 六类轨道**此前已有**行模型与写入路径
（`SpineTrackEdit.scanExtra`）；真正缺的是 **Slot Color / Two Color** 与**离散轨道的帧视图呈现**。

| 新增 | 规划书 | 说明 |
| --- | --- | --- |
| `SLOT_FIELD_META.color` / `.twoColor` | §4.3 | 颜色轨进入行模型；`valueKind` 为 `color`（`RRGGBB[AA]` 字符串）与 `colorPair`（`{light,dark}`） |
| `normalizeKey` 的 `color` / `colorPair` 分支 | §4.3 | 颜色值**原样透传不转 rgb**；兼容挂在 `value` 或 `color` 字段；双色缺 `dark` 时保持 `null` **不猜** |
| `formatValue(kind, value)` | §5.4 | 颜色/双色/附件/标量的人读文本；未知 kind 返回 `null` 让调用方决定，不硬编造 |
| `isDiscreteTrack(kind, field)` | §4.3 / §4.5 | 附件切换、事件、绘制顺序是**离散**（不插值）；形变/旋转不是 |
| 帧视图离散轨道阶梯绘制 | §4.3 / §4.5 | 只在 Frame 档：附件/绘制顺序画**阶梯块 + 末端竖线**，事件画**固定宽度标记**；不再与渐变色带混为一谈 |
| `buildRows` 新增 `partial` / `partialRows` | §7.1 分层 | 与 `unsupported`（结构非法/未知时序**只读**）**分开计数**：颜色轨是「语义已知、可编辑可保存，但 core 未求值」 |
| `makeRow` 透传 `previewPartial` / `note` | — | 之前只透传 `unsupported`，导致「预览不完整」的依据在 UI 侧丢失 |
| 预览不完整提示精确到字段 | §7.1 | `预览不完整：slot.color/slot.twoColor/transform/path 未求值（仅编辑/保存）` —— 不再笼统说 `slot`（附件其实是求值的） |

**0.9.127 验证**：`node tools/character-editor/selftest-node.mjs` → **3865/3865**
（timeline 套件 292 → **333** 条）；`bump-editor-version.mjs --check` → 50 处 `?v=` 同源。

浏览器端到端（自建 v3.2 验证包 `workspace/tmp/p3-verify/pkg`，用完即删，原包零改动）：
载入后行模型 **27 行 / 28 key / 2s**，覆盖 **8 类轨道**
（`bone / slot / event / drawOrder / deform / ik / transform / path`），其中
`slot.s1` 的 `attachment`(1 key) / `color`(3 keys @0,0.5,1s) / `twoColor`(2 keys @0,0.75s) 三条独立行全部出现；
预览提示为 `预览不完整：slot.color/slot.twoColor/transform/path 未求值（仅编辑/保存）`；
放大截图像素统计显示青色系 `[32,80,96]`/`[48,128,144]` 的阶梯块与黄色系 `[80,80,48]` 的事件标记并存，
证明离散轨道确实按阶梯而非渐变绘制。

**为什么颜色轨标 `unsupported` 却仍然可编辑**：`spine-core` 对 `slotField === "color"` 直接
`warn(animation.slotColor.unsupported)` 并置 `capabilities.unsupported.slotColor` —— 结构合法、能读能写能存，
只是**预览不生效**。所以它归 `partial`，不归「未知轨道只读」。这条边界写进了 selftest。


### 0.9.126：P2 起步 —— 反转关键帧顺序、创建逐帧关键帧、范围影响预览

规划书 P2「完整帧编辑工具」的数据层与两个此前缺失的范围操作：

| 新增 | 规划书 | 说明 |
| --- | --- | --- |
| `applyTimeFrameOperation("reverse")` | §6 Reverse Keys | 把 `[fromFrame, fromFrame+count-1]` 内关键帧的**时间顺序整体反转**，区间中点不动；只反转范围内已存在的 Key，不在区间外造数据；同轨碰撞按 `collision`（默认 `skip`）处理 |
| `applyTimeFrameOperation("spread")` | §5.3 创建逐帧关键帧 | 把范围内每条受影响轨道的时间**均匀铺到整数帧**上（首尾贴边、中间等距），**每条轨道的 Key 数量不变**、**不为没有 Key 的轨道凭空造 Key**；单 Key 轨道跳过 |
| `rangeImpact(rows, fromFrame, count, fps)` | §3.5「删除时间必须提供影响预览」 | 纯统计：受影响轨道数 / Key 数 / 范围起止 / **最大位置变化毫秒** / 轨道样例 |
| `rowKeyFromPath(path)` | — | 时间列路径 → 轨道行键（`bone:hips:rotate` / `slot:mouth:attachment` / `timeline:…`），与锁列表同一格式 |
| `applyTimeFrameOperation` 新增 `onlyRowKey` + `rowKeyOf(path)` | §6.2 单轨/整组移动 | 把任何时间帧操作**收窄到单条轨道**；缺解析器或找不到轨道时**拒绝而非猜测** |
| 帧右键菜单新增 `reverseRange` / `spreadRange` | §3.4 / §6 | 两者都先弹**范围确认**（「修改范围内全部轨道 / 仅修改选中轨道 / 取消」），确认文案含影响预览；`makePerFrameKeys` 从"显式禁用"改为**真正可用**（走 spread） |

**已知取舍（如实记录）**：`spread` 的默认碰撞策略是 `skip` —— 若区间帧数少于某轨道的 Key 数，
多出来的 Key 会被丢弃（保守、可撤销）；`keep-both` 会留下同刻重复 Key，对 Spine 不安全，故不作默认。

**0.9.126 验证**：`node tools/character-editor/selftest-node.mjs` → **3824/3824**
（frame-timeline 套件 246 → **292** 条）；`bump-editor-version.mjs --check` → 50 处 `?v=` 同源。
浏览器端到端（副本 `workspace/tmp/`，未碰原包）：帧标尺拖选 `0–30`（`已选帧 0–30（31）`）→
右键菜单 11 项 → 点「反转关键帧顺序」→ 确认框显示
`把帧 0–30 内 91 个关键帧（11 条轨道）的时间顺序整体反转，区间中点不动。最大位置变化约 500ms。` →
确认后状态栏 `时间帧操作 reverse：移动 91 个 Key、删除 0 个`，Key 总数仍 292、时长仍 3.5s。
500ms 正好是范围内最远键（第 30 帧）到中点（第 15 帧）的距离 15 帧，与命中数自洽。

**一个值得记下的观察**：在 `hips.scale` 上看不出反转效果 —— 该轨的 `x` 值是**以第 30 帧为对称轴的抛物线**，
反转后映射回自身。这不是缺陷，是数据本身对称；换非对称数据即能看到变化（selftest 已覆盖两种情形）。


### 0.9.125：§3.2 锁定轨道渲染 + §10 帧级快捷键

- **§3.2 锁定轨道 = 降低亮度 + 锁图标**：帧格里按 `state.edit.timeline.lockedRows`
  （与 `trackWriteGate` 同一份真值）把锁定行压一层 `rgba(18,22,31,0.62)` 遮罩并在行首画锁图标；
  按行在显示列表里的**序号**定位，行被过滤后不会错位。只做呈现，不改写入闸门。
- **§10 帧级快捷键**：`←/→` 上一帧/下一帧、`Shift+←/→` 上一个/下一个关键帧、
  `Home/End` 第一帧/最后一帧、`K` 当前属性打键、`Shift+K` 骨骼姿态关键帧、`Delete` 删键、
  `Ctrl+A` 全选。**只在「时间轴面板获得焦点 + Frame 档」时接管**（`fsFrameKeysOwnFocus()`）——
  规划书 §10 明确要求「快捷键必须考虑画布、属性输入框和时间轴焦点」，所以画布上的骨微调
  （同一个方向键）与输入框（`isTypingTarget` 上游拦截）保持原行为。
  `Ctrl+D`（复制并创建副本）按未实现处理并给出明确提示，不留静默无反应。
- **修掉的缺陷**：锁定轨道分支误用了 `SpineFrameTimeline.rowKey`（那是 `SpineTimeline` 的方法），
  渲染时抛 `lib.rowKey is not a function`。改用帧模块导出的同格式 `defaultRowKey`。
  该错误是**在真实浏览器里执行到该分支时才暴露**的，静态审查没发现。

**0.9.125 验证**：`node tools/character-editor/selftest-node.mjs` → 3778/3778；
`bump-editor-version.mjs --check` → 50 处 `?v=` 同源；`workspace/packs` 与 `assets/characters` 无改动。
浏览器侧：锁定 `root/rotate` 后截图可见该行压暗 + 行首锁图标（相邻未锁定行亮度正常）；
时间轴聚焦时 `→`/`End` → `帧 105 / 105`、`dirty:false`；画布聚焦时 `→` 不抢帧、不改数据（帧仍 0）。


**依据**：`Spine_Timeline_Editor_Technical_Spec.md` §2（三种模式）、§3（Frame Timeline）、§3.5（帧操作与关键帧操作分离）、§12.3（统一 TimelineState）、§14 P0。
**动机**：0.9.110–0.9.114 已经画出了帧格与帧标尺，但那只改了**绘制** —— 帧格没有交互语义（§15.1 明令不允许「只改外观」）。

### 新增纯模块 `frame-timeline.js`（`window.SpineFrameTimeline`，44 个导出）

不碰 DOM，Node 可直接 `require`；所有写操作失败时 `value:null` 且**入参零改动**。

| 规划书 | 接口 |
| --- | --- |
| §3.1 / §7.4 帧↔秒 | `frameToTime` `timeToFrame` `snapTime` `snapFrame` `frameAtTime` `frameKey` `normFps` |
| §3.1 帧格几何 | `frameRange` `frameToX` `xToFrame` `pxPerFrame` `currentFrameColumn` `chooseFrameSteps` |
| §3.2 帧格视觉状态 | `cellState`（current/selected/inRange/keyed/curve/disabled → `tone`）、`buildCells` |
| §12.3 统一 TimelineState | `createState` `normalizeState` `updateState` `seekState` `deriveState` |
| §3.3 选择与定位 | `selectFrames`（set/add/toggle/range/all/clear/invert/remove）、`selectFrameAllTracks` |
| **§3.5 帧操作与关键帧操作分离** | `readColumns` `timeBoundaries` `applyTimeFrameOperation`（insert/remove/move/scale/clear）、`keysInFrameRange` `rangeHasKeys` |
| §3.4 右键菜单 | `contextMenu`（空白帧 / 关键帧 / 帧范围，三套菜单项与中文标签） |
| §9 播放控制 | `seekFrame`（first/prev/next/last/prevKey/nextKey/loopStart/loopEnd）、`loopRangeToTime` |

关键设计：
- **时间列遍历与 `SpineAnimEdit.scanTimelineKeys` 同构**（数组项带有限 `time` 即视为时间列）。
  所以 `insert/remove/move/scale` 会把 events / drawOrder / deform / attachments / ffd / ik 一起搬移，
  不会只搬骨骼而漏掉事件。self-test 与 `scanTimelineKeys` **交叉核对** key 数与最大时间。
- **空时间列会被移除**（`removeColumnAt`）：Spine 不输出空 key 数组，留着会出现空轨道并让
  `readColumns` 与磁盘真实数据不一致。
- 循环区间**不在 `normalizeState` 里偷换** start/end：保留原值，顺序语义只由 `loopRangeToTime` 决定。

### 新增 self-test：`selftest-frametimeline.js`（246 条断言）

覆盖换算 / 几何 / 帧格状态 / 状态归一化 / 帧选择七种操作 / 三套菜单 / 时间列 / 路径往返 /
五种时间帧操作 / 范围查询 / 播放定位；接进 `selftest-node.mjs` 与浏览器侧 `selftest.html` 页脚。
两侧合计：`node tools/character-editor/selftest-node.mjs` → **3778/3778 passed**。

### `app.js` 接线

- `state.edit.timeline` 增加 `frameSel` / `frameRange` / `frameAnchor`；三档 `tab` 扩展为
  `frame`（默认仍是 dopesheet，偏好里可持久化）。
- `dsDraw()` 的帧标尺与帧格绘制改由 `fsDrawFrameGrid()` 用纯模块完成：**帧号刻度**按
  `chooseFrameSteps` 抽稀、**当前帧整列高亮**、**已选帧列底色 + 边框**；滚动量仍只有
  Dopesheet 的 `scrollSec` 一个来源（帧号滚动由它折算，避免两套各滚各的）。
- 指针语义按 `tab` 分流：帧视图下标尺单击/拖动 = 定位 +（拖动时）连选帧范围；轨道区空白处
  单击/拖动 = 帧选择 / 帧范围；命中关键帧时**回交** Dopesheet 的关键帧拖动（曲线段仍只读）；
  双击空白帧 = 按当前姿态打键；右键 = 帧上下文菜单。Dopesheet / Graph 行为不变。
- 帧选择会同步成 Dopesheet 的关键帧选择集（`fsSyncSelectionToKeys`），但**不清除**帧选择本身。
- 新增句柄 `__characterEditor.frameTimeline.{state,geom,select,seek,snap,setFps,menu,run,timeFrame}`；
  `timeline()` 快照补 `tab/fps/currentFrame/frameSel/frameRange`。

### `index.html` / `ui.css`

- Frame / Dopesheet / Graph 三档切换；帧工具条（帧读数 `帧 N / 总数`、`◀ ▶ ⇤ ⇥`、帧吸附、FPS 输入、
  已选帧读数），只在帧视图显示。

### 验证

- `node tools/character-editor/selftest-node.mjs` → 3778/3778（新增 frame-timeline 246 条，旧用例无回归）。
- 真实包 `workspace/packs/deepseek`（idle 3.5s / 292 key）+ 内嵌 Chromium 实测：
  帧标尺点第 15 帧 → 播放头 0.5s、读数 `帧 15 / 105`、`已选 1 帧（15）`；标尺拖选 → `已选帧 20–35（16）`；
  右键第 30 帧 → 范围菜单 7 项 + 时间插入/删除 2 项，全部命中规划书 §3.4 原文；
  在 `workspace/tmp/` 副本上 `timeFrame("insert", {atFrame:15,count:1})` → key 数不变、`maxTime` 3.5→3.5333、
  `dirty` 置位，`undo()` 完全回到基线且 `dirty:false`；全过程 **0 运行时错误**。

### 尚未实现（诚实清单）

- 「创建逐帧关键帧」菜单项**显式禁用**（规划书 §5.3 要求范围确认 + 批量工具，留到 P2），
  代码里没有假按钮、也没有点了没反应的路径。
- 帧视图做到 P0；**P1 已实测通过（见下），P2/P3/P4 尚未实现**。

### P1 现状实测（0.9.124，真实包副本 + 真实指针事件）

审计发现 P1 的多数条款**earlier 已实现**（`finishBoneGesture` / `keySelectedBone` /
`state.edit.transient`），因此本轮先做**实测确认**而不是重写。证据见
`workspace/three-view-to-spine-anime/Spine-Animation-Editor-plan/evidence/2026-11-12-p0-p1-timeline-acceptance.md`。

| 规划书 P1 条款 | 实测结论 |
| --- | --- |
| §5.1 Auto Key：只为**变化属性**建当前时间 Key | 通过。在 idle 第 45 帧（1.5s）拖 `发带蝴蝶结_右`（骨 `hairband`，该骨此前 0 个 Key）：总 Key 292→293，**新增仅 1 行** `hairband.translate @1.5s`；同一时刻本来就有 Key 的 10 行（hips/chest/head/hair-back-1..3/ahoge/tail-1..3）**一格未动** —— 没有"给所有骨骼造关键帧" |
| §5.2 手动关键帧模式：关 Auto Key 只预览不提交 | 通过。关 Auto Key 后同样拖动：总 Key 保持 292、`hairband` 各轨仍 0 Key，但骨值真的变了（`x=10.5,y=279`）、状态栏「已移动骨 hairband（未打键预览）」——**预览生效、动画数据零写入** |
| §7.7 PoseOverride 临时姿态与正式数据隔离 | 通过。临时姿态落在 `state.edit.transient`（`{animation:"idle",time:1.5}`），`undo()` 后归零 |
| §5.2 界面区分三种状态 | 通过。已保存 Key / 未记录临时姿态（`dirty` + 「未打键预览」）/ 已选 Key 三者读法不同 |
| §5.3 属性关键帧 | 通过（`keySelected(["rotate"])` 等按字段写） |
| §5.3 骨骼姿态关键帧 | 通过（`keySelected` 默认 `rotate/translate/scale`） |
| §5.3 全身姿态关键帧（需范围确认） | **未实现**：需要先做范围确认 UI，否则会一次性造出大量 Key |
| §5.4 当前帧属性检查器（Property/Target/Frame/Time/Value + 插值三段） | **部分**：帧读数与插值按钮已有，独立的"选中 Key 属性检查器"面板未做 |

### 未实现（续）

- P2 关键帧复制/粘贴/批量移动/时间拉伸的范围 UI、P3 Slot/约束/Deform/Events 的帧视图呈现、
  P4 洋葱皮等专业辅助，均**尚未实现**。`autoKey` 已在 TimelineState 中，但帧视图侧的
  Auto Key 指示与 §10 帧级快捷键（←/→/Home/End/Shift+方向键）尚未接线。

## 0.9.61–0.9.62 — ~~悬浮放大镜：鼠标停在附件上时放大其贴图区域~~（已撤销，方向做错，见 0.9.63）

**用户需求**：在贴图/权重视图里，鼠标悬浮在材质上时应有一个类似放大镜的浮层，显示该材质对应的贴图区块。

**场景**：用户截图里的状态是 `texture:false` + `mesh:true` + `weights:true`、透明度 35% —— 此时画面全是按骨骼权重着色的彩色三角面片，看不出「这一块到底取的是贴图哪个部位」。

### 实现

新增 `drawHoverMagnifier(frame)`（`app.js`，紧随 `drawUVInset` 之后）：

| 数据 | 来源 |
| --- | --- |
| 悬浮的附件 | `state.hover`（`onPointerMove` 里 `core.hitTest` 求出） |
| 鼠标画布坐标 | `state.pointer`（新增，`stagePoint(e)` 结果） |
| 附件的图集像素范围 | `item.sourceXY`（成对 x/y，来自 UV） |
| 贴图页 | `state.pageImages[item.pageIndex]` |

行为：

- 浮层 156×156，标题条显示槽名（青绿 `#8ee6c8`），内容区按宽高比 fit，右下角标注原始像素尺寸（如 `65×97`）
- **放大用最近邻**（`imageSmoothingEnabled = false`），保证原始像素看得清，不是糊成一团
- **靠边自动翻转**：右侧/下方放不下就翻到左/上，最后 `clamp` 夹在画布内
- 拖动中不画（跟手反馈已由 `dragGhost` 承担，浮层只挡视线）
- 无 `sourceXY` / 区域小于 2px / 贴图未载入 → 静默跳过，不打断渲染
- `pointerleave` 时清 `state.pointer` 并重置 hover，避免浮层停在原处不消失

### 接错了一次调用位置

第一版把 `drawHoverMagnifier(frame)` 放在 `drawMeshOverlay` 末尾（紧挨着 `drawUVInset`），但 `render()` 里是：

```js
if (state.show.mesh) drawMeshOverlay(frame);
```

**于是只有勾上「网格」时才有放大镜** —— 恰恰违背用途（网格关闭时更需要看清贴图）。已挪到 `render()` 末尾、所有图层之后，**不受任何图层开关影响**。

### 验证

浏览器实测（`肩膀花边_左`，slotIndex 8，图集区域 65×97）：

```
(137,137) 边框位     [49, 87,130]      边框 #5aa9ff 混合（对）
(140,142) 背板       [18, 21, 29]      背板 #12151d（对）
(214,214) 内容中心    [231,215,236]     贴图实际像素（对）
(130,214) 浮层外      [0,0,0,0]        未污染
```

边界情况：

| 情况 | 采样 | 结果 |
| --- | --- | --- |
| `hover = -1` | 浮层应在的位置 | `[0,0,0]` 未画 ✅ |
| 鼠标右下角 (650,600) | 翻转后中心 | `[231,215,236]` 翻转成功且内容正常 ✅ |
| `pointer = null` | 画布中部 | 底下权重层颜色，浮层未画 ✅ |

截图确认视觉：标题 `肩膀花边_左`、居中蕾丝花边、右下 `65×97`、蓝边框深背板。

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.62）
```

## 0.9.110–0.9.117 — 时间轴改成 Flash 风格帧面板（2026-11-11）

**用户要求**：把时间轴面板改成参考图那种 Flash/Animate 的帧时间轴（附了截图）。确认「完整复刻 Flash 布局」。

### 加的视觉元素

| 元素 | 说明 |
| --- | --- |
| 帧标尺 | 顶部显示**帧号**（0/20/40/60/80/100…）而非秒数，每 5 帧小刻度、按帧宽自动切换标签密度 |
| 帧格线 | 每 5 帧一条粗线 + 每 5 帧列底色微加深；逐帧细线仅在一帧 ≥ 6px 时画 |
| 帧段色带 | 相邻 Key 之间填成半透明色条（骨=蓝、槽=青、额外轨道=黄），底部加强调线 |
| 图层色块 | 左侧每行一个 5×13 色块，按轨道类型分色：骨蓝 / 槽青 / 形变紫 / 约束橙 / 事件黄 |

### 修掉的三个真实 bug

**① 帧格线把关键帧淹没了**

首版逐帧画线：`pxPerSec=100` + `fps=30` → 每帧 3.33px，整个行区糊成一片竖条纹，关键帧完全看不见。改成只画每 5 帧粗线，逐帧细线在一帧 ≥ 6px 时才画。

**② 色带画进标尺区**

滚动的行会部分越过 `bodyTop`，色带/关键帧直接画进标尺（实测色带像素出现在 y[5,22]）。加了 canvas 裁剪：`g.save() → clip(0, bodyTop, w, h-bodyTop) … g.restore()`。

**③ 标签列与右侧完全错位（最严重，老 bug）**

原代码：

```js
box.style.paddingTop = L.rulerH - L.scrollTop + "px";
```

往下滚动时该值为**负数**，CSS padding 不接受负值（clamp 成 0）—— 于是**标签列永远停在顶部**，而 canvas 正常滚动，错位达 200 多行。截图里左侧显示 `root/rotate/translate` 且 key 都是 0，右侧色带却画在那些行上，就是这个 bug。

中间我还试错两次：先用 `marginTop` 把**整个容器**推出可视区（top 变成 -3740），再用 `scrollTop` 但容器高度是 auto、无滚动空间。最终结构：

```
#dsLabels        固定高度 + overflow:hidden（只裁剪，不滚动）
  .ds-label-rows  承载所有行，用负 marginTop 做滚动偏移
```

验证：内层 `marginTop=-4251px`、外层高度 209px，有关键帧的行（索引 215）落在可视区内，与右侧色带对齐。

### 交互完全保留

只改**绘制**，37 个时间轴函数里没动任何一个交互函数 —— 关键帧拖动、框选、双击加 Key、播放头、缩放、吸附全部原样。

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.117）
```

## 0.9.107–0.9.109 — 动画列表选中样式 + 再次点击取消（互斥）（2026-11-11）

**用户要求**：「动作分页的每个动画选中了应该有明显的视觉样式，再次点击应该能够取消选择」，并明确「而且是互斥的」。

### 三个 bug 一起修

**① 没有选中样式**

代码里已经加了 `is-active` 类，但 **CSS 里根本没有 `.anim-track.is-active` 规则** —— 只有 `exp-region-eye` 有这个类。等于加了个空标记。

补的样式：

```css
.anim-track.is-active {
  border-color: var(--accent);
  border-left-width: 3px;
  background: rgba(90, 169, 255, 0.13);
  box-shadow: 0 0 0 1px rgba(90, 169, 255, 0.35) inset;
}
.anim-track.is-active .anim-track-hd { font-weight: 600; }
.anim-track { transition: border-color .12s ease, background-color .12s ease, box-shadow .12s ease; }
```

**② 点击不切换**

`setAnimEditSelection` 原来直接设置选中，不看当前状态。改成：

| 操作 | 结果 |
| --- | --- |
| 点 A（未选中） | 选中 A |
| 点 A（已选中） | **取消选择** |
| 点 B（A 已选中） | 直接切到 B |

**③ 取消不掉（最隐蔽的一个）**

取消后 `ed.sel = null`，但 `renderAnimPanel` 里有「空值兜底」：

```js
if (!ed.sel && names.length) ed.sel = (names.indexOf(state.anim) >= 0 ? state.anim : names[0]);
```

一空就设成第一个动画 —— 实测点两次「眨眼」后 `sel` 又变回 `"idle"`，待机行重新高亮，取消等于没做。

修法：加 `ed.selUserCleared` 标记，用户主动取消后不再兜底；选中任意行时清掉该标记。

同时 `setAnim("")` 也要清 `state.animEdit.sel` —— 否则下游大量用 `state.anim || state.animEdit.sel` 取当前动画的代码会「取消不掉」。

### 单一数据源

高亮判定从双条件改成只看 `state.animEdit.sel`：

```js
// 错：sel 与 anim 可能不同步，出现「待机 + 眨眼同时高亮」
const active = it.virtual ? isGazeAnim(state.anim) : state.anim === it.id;
// 对：
const active = it.virtual ? isGazeAnim(sel) : sel === it.id;
```

Spine 层与序列帧层用同一套规则。

### 验证

**Spine 层**：

| 操作 | state.anim | state.animEdit.sel | 高亮行 |
| --- | --- | --- | --- |
| 初始 | idle | idle | 待机 |
| 点眨眼 | blink | blink | 眨眼（待机取消） |
| 再点眨眼 | "" | **null** | **无** |
| 点眼珠跟随 | `__gaze_follow__` | 同 | 眼珠跟随鼠标 |
| 再点 | "" | null | **无** |
| 点待机 | idle | idle | 待机 |

**序列帧层**：

| 操作 | 高亮 |
| --- | --- |
| 点挥手 | 只有「挥手」，Spine 层全不高亮 |
| 再点挥手 | 全不高亮 |

**视觉**：选中行蓝色边框 + 蓝色底 + 左侧 3px 强调 + 文字加粗，与其它行对比明显。

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.109）
```

## 0.9.104–0.9.106 — 动画列表显示中文，底层仍存英文（2026-11-11）

**用户要求**：「这里应该显示中文显示在前端，底层用英文存储」。

### 做法：只加显示层翻译，不动任何数据

```js
const ANIM_LABELS = {
  idle: "待机", blink: "眨眼", wave: "挥手", tail_wag: "摆尾", …
};
function animLabel(name) { /* 表里没有的返回原名，避免空标签 */ }
```

**保持不变**（这是关键）：

| 项 | 值 |
| --- | --- |
| `state.anim` | `"idle"` / `"blink"` / `"__gaze_follow__"` |
| `model.json` 的动画键 | `idle` / `blink` / …（21 个全是英文） |
| `__characterEditor.animSelect(name)` | 参数仍是英文 |
| 保存 / undo / 关键帧轨道 | 全部走英文 id |

**只改这些「给人看的字符串」**：

| 位置 | 改动 |
| --- | --- |
| 动画列表行（Spine + 序列帧） | `it.label` / `animLabel(id)` |
| 时间轴当前动画名 `#dsAnimName` | `animLabel(state.anim)` |
| 状态栏「预览动画「…」」 | `animLabel(state.anim)` |
| `ANIMATION_LOCKED` 提示 | `animLabel(state.anim)` |

### 映射表覆盖全部 21 个动画

`idle` 待机 · `blink` 眨眼 · `idle_face` 面部待机 · `expression_swap` 表情切换 · `gaze_grid_preview` 视线网格预览 · `alert` 警觉 · `greeting` 打招呼 · `interact` 互动 · `happy` 开心 · `sad` 难过 · `shy` 害羞 · `pout` 鼓嘴 · `proud` 得意 · `sleepy` 困倦 · `surprised` 惊讶 · `thinking` 思考 · `wake` 醒来 · `working` 工作 · `talk_generic` 通用说话 · `wave` 挥手 · `tail_wag` 摆尾

外加虚拟条目 `__gaze_follow__` → 眼珠跟随鼠标（否则时间轴会显示内部 id）。

### 验证

```
界面显示   待机 / 眨眼 / 眼珠跟随鼠标      摆尾 / 挥手
时间轴     待机 / 眨眼 / 眼珠跟随鼠标
底层       anim="blink"、"__gaze_follow__"、"idle"   模型数据仍英文
```

点击中文行实测：

| 点击 | state.anim | 时间轴显示 |
| --- | --- | --- |
| 眨眼 | `blink` | 眨眼 |
| 眼珠跟随鼠标 | `__gaze_follow__` | 眼珠跟随鼠标 |
| 待机 | `idle` | 待机 |

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.106）
```

## 0.9.99–0.9.103 — 眼珠跟随最终定型：iris 移骨 + 剪切蒙版（2026-11-11）

**用户两次反馈**：「渲染还是有问题」「你这限位限得太死了，直接拉满了看更直观」，并指出「眼珠都动不了」。

### 找到了「眼珠不动」的真实原因

`gaze_*` 那 24 张变体，虹膜在纹理坐标里只偏移约 **7.4 / 102 像素（7%）**。缩小到屏幕（0.5 视口缩放）后只剩 **0.7 屏幕像素** —— 实测虹膜亮部质心 `dx=-10 → +10` 只从 26.78 移到 27.49。

所以「换贴图」这条路根本无法产生可见位移。必须**移骨**。

### 最终方案

```
眼白_L 槽（绑 head，固定不动）→ sclera_L_100   ← PSD 里的「眼白」基底
眼珠_L 槽（绑 eye-L，可动）  → iris_L_100     ← PSD 里的「眼珠」剪贴层
移 eye-L / eye-R 骨 → 只动虹膜
剪切蒙版（destination-in + sclera alpha）→ 裁掉超出眼眶的部分
```

**关键认知**：之前判定「`iris_*` 比眼眶大，装不进去」是对的（76×82 vs 97×80），但**这不构成障碍** —— 剪切蒙版的意义正是「超出部分不显示」。虹膜大一点没有关系。

### 效果对比（同一只眼，4× 特写）

| 左限位 `dx=-10` | 右限位 `dx=+10` |
| --- | --- |
| 虹膜贴左，右侧露出白色眼白 | 虹膜贴右，左侧露出白色眼白 |

虹膜位移 **8.5 屏幕像素**（换贴图方案只有 0.7），肉眼清晰可见；边缘沿眼眶形状收住，没有像素跑到脸或头发上。

### 顺便修的两个问题

**① 静止态不该裁剪**

原来只要跟随激活就裁剪，但静止态用的是 `eye_*_100`（原始合成图），再裁一遍会啃掉眼眶边缘（实测差异 53 像素、最大色差 62）—— 等于「不动的时候眼睛也变了」。改成只有 `iris_*` 才裁。

**② 暂停时眼珠弹回原位**

暂停时 `gaze.active=false`，分层与移骨全部撤销，`eye-L` 从 -98 弹回 -108，与「停止保持不动」相反。

加 `gazeEngaged()`：`active || 有偏移` —— 暂停后偏移冻结，分层保留、眼睛停在原处。

### 三条行为规则实测

| 阶段 | 眼白槽 | 眼珠槽 | eye-L | dx |
| --- | --- | --- | --- | --- |
| 跟随中 | `sclera_L_100` | `iris_L_100` | (-102.72, 650.95) | 5.28 |
| 暂停 | `sclera_L_100` | `iris_L_100` | **不变** | 5.28 |
| 暂停后移动鼠标 | — | — | **不动** | 5.28 |
| 换回 idle | (无) | `eye_L_100` | 复位 | 0 / 0 |

### 跟随量程

`GAZE_RANGE_PX = 60` —— 鼠标离头部超过 60 屏幕像素就取满档，稍微一动就能看到眼珠转向（原来按画布短边一半算，要移到边缘才到 ±10）。

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.103）
```

**model.json 未改动**（`眼白=空`、`眼珠=eye_*_100`，与原始一致）—— 所有分层都是运行时覆盖，退出跟随即撤销。

## 0.9.90–0.9.98 — 眼珠跟随改回 gaze_* 切图 + 加上剪切蒙版（2026-11-11）

**用户三次反馈**：① 眼白跟着动 ② 出现幻影 ③ 眼珠超出眼白，「眼珠子到脸上了，理论上只能在有眼白的地方显示，也不能超过睫毛的位置」，并明确「就类似剪切蒙版的效果，你用 psd 工具看看原工程的剪切蒙版实现的」「本来就是要切掉虹膜（眼珠）边缘」。

### 最终方案：复刻 PSD 的剪切蒙版

用 psd-tools 查原工程 `step2/source/deepseek-whale-maid-disassembly-v3.psd`，眼睛组的图层结构是：

```
表情差分_眨眼_左
  眼白 100%    clip=False   ← 基底
  眼珠_100%    clip=True    ← 剪切蒙版，被眼白裁切
  睫毛_100%    clip=False
```

`眼珠_*` 全部 `clipping=True` 且紧贴 `眼白 *` 之上 —— **眼珠只在眼白的 alpha 内显示**。这就是「切掉超出眼眶的部分」。

### 实现

`drawTextures` 里，眼珠 item 走专用路径：

```js
眼珠画到临时画布 gazeScratch
→ globalCompositeOperation = "destination-in"
→ 画 sclera_*_100（完整眼形，PSD 里的眼白基底）
→ 结果贴回主画布
```

蒙版几何按「眼白槽索引 + 附件名」缓存（`gazeMaskGeometry`），避免每帧一次 `evalPose + buildGeometry` 拖慢跟随。

### 素材层面的关键数据（决定了为什么只有这个方案可行）

| 事实 | 数据 |
| --- | --- |
| `sclera_*` 是**完整眼形**，不是空心环 | 不透明 56.3%，与 `eye_*` 完全一致（深 0%、亮 55.1%） |
| `iris_*` 装不进 `sclera` | 不透明 76×82 vs 眼眶 97×80，最优对齐仍溢出 52/4922 像素 |
| `gaze_*` 24 档中 22 档虹膜贴边 | 虹膜到眼眶边缘余量 = 0~2 像素（如 `xp06_yz00` 右 1 / 上 1 / 下 0） |

所以「移骨」会把眼白一起推走、「换 iris 分层」装不进去 —— **只有剪切蒙版能表达「超出部分不显示」**。

### 验证：A/B 裁剪开关

加调试开关 `window.__gazeMaskOff`，同一帧状态下对比裁剪开/关：

```
差异像素 51   最大色差 70
差异框   x[260,379] y[266,294]
眼眶框   x[244.8,295.7] y[253.3,303.6]
```

差异全部落在眼眶边界上 —— 正是「虹膜超出部分被切掉」的位置。

4× 特写在极限偏移（`dx=10, dy=4`，贴图 `gaze_L_xp06_yp02`）下确认：眼球完整收在眼眶轮廓内，虹膜偏到右上，没有任何像素跑到脸/头发上。

### 走到这一步之前的错误路径（记录以免复用）

| 尝试 | 结果 |
| --- | --- |
| 移 `eye-L`/`eye-R` 骨 | 合成图是整只眼（眼白+虹膜同图），移骨把眼白一起推走 |
| 改用 `iris_*` 分层（挂 head 的 sclera + 挂 eye 骨的 iris） | 虹膜 76×82 比眼眶 97×80 大，装不进去 |
| 把 setup 直接改成分层 | 回滚 —— 18 个动画都写了 `眼珠_L/R` 轨道，改 setup 要同步改 36 处 |
| 用 `eye_*_100` 当蒙版 | 等于没裁 —— 它的轮廓与 `gaze_*` 完全相同 |
| 用 `sclera` 当蒙版但算错 y 符号 | 误判成「空心环」；Spine 的 y 朝上、图像 y 朝下，符号必须反 |
| 靠颜色判据数「眶外蓝色像素」 | 反复被蓝色**头发**污染（三次误判），最后改用裁剪开关做 A/B 才可靠 |

### 收窄跟随范围

`GAZE_LIMIT` 保持 10（世界单位）。因为有剪切蒙版，越界部分会被切掉而不是画到脸上。

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.98）
```

**model.json 一个字节都没改**（`眼白=空`、`眼珠=eye_*_100`，与原始一致）。

## 0.9.89 — 眼珠跟随改用「眼白 + 虹膜」分层（真正让眼白固定）（2026-11-11）

**用户反馈**：还是有问题；接着说明「眼珠移动出现幻影」，并附了双眼截图 —— 红框标出的是两只眼的**外侧边缘**。

### 前两版都不对，各错在哪

| 版本 | 做法 | 错因 |
| --- | --- | --- |
| 0.9.85–87 | 移 `eye-L` / `eye-R` 骨 | 合成图 `eye_L_100` 是 **102×101 的整只眼**（眼白+虹膜同图），移骨把眼白一起推走 |
| 0.9.88 | 切 `gaze_*` 变体 | 贴图比对显示 `gaze_*` 的**整眼轮廓与合成图差异 53.6%**（四边完全不同），换图时轮廓跳变 = 幻影 |

### 正解：贴图集里本来就有一套分层素材

| 素材 | 尺寸 | 透明 | 深色(虹膜) | 亮色(眼白) | 说明 |
| --- | --- | --- | --- | --- | --- |
| `eye_L_100` | 102×101 | 43.7% | 27.7% | 15.6% | 合成图（眼白+虹膜） |
| `sclera_L_100` | 102×101 | 43.7% | **0.0%** | 55.1% | **纯眼白，与合成图逐边界一致** |
| `iris_L_100` | 78×84 | 24.4% | 46.4% | 11.1% | **纯虹膜，落在眼眶内部** |

而且槽的骨绑定天生就是对的：

```
眼白_L 槽 → bone = head    （固定）   附件 x=-89.5, y=-123.5  ← 正是 eye-L 相对 head 的局部坐标
眼珠_L 槽 → bone = eye-L   （可动）   附件 x=2, y=7.5
```

作者早就设计了两层，只是 setup 里 `眼白_L` 的 attachment 空着没启用。

**世界框实测（setup 姿态）**：

```
合成图 eye_L_100    x[-159, -57]  y[602, 703]
分层 sclera_L_100   x[-159, -57]  y[602, 703]   ← 完全相同
分层 iris_L_100     x[-145, -67]  y[618, 702]   ← 在眼眶内部
```

### 关键决策：只做运行时覆盖，不改 model.json

我曾试过把 setup 改成分层，**回滚了**。原因：

18 个动画全都写了 `眼珠_L/R` 轨道（多数设 `eye_L_100`）：`blink` / `expression_swap` / `gaze_grid_preview` / `alert` / `greeting` / `happy` / `idle_face` / `interact` / `pout` / `proud` / `sad` / `shy` / `sleepy` / `surprised` / `thinking` / `wake` / `working` / `wave` / `tail_wag`。

改 setup 就得同步改 36 处轨道，**漏一个就会出现「眨眼时眼白突然消失」**（`blink` 的 `眼白_L` 轨道全是 null，眨眼全靠合成图）。风险远大于收益。

而「眼珠跟随」是虚拟条目，选中它时**没有任何真实动画在驱动眼槽** —— 覆盖安全、可撤销。所以：

```js
// 仅跟随时
眼白_L → sclera_L_100   （绑 head，绝对不动）
眼珠_L → iris_L_100     （绑 eye-L，随骨移动）
// 退出跟随：覆盖撤销，setup / blink 原样恢复
```

### 验证：眼白框逐字节固定

| 鼠标位置 | 眼白框 | 眼珠框 | dx |
| --- | --- | --- | --- |
| 中 | [-159,602,-57,703] | [-142.2,616.5,-64.2,700.5] | 2.78 |
| 右 | [-159,602,-57,703] **不变** | [-138.5,615.6,-60.5,699.6] 右移 | 6.45 |
| 左 | [-159,602,-57,703] **不变** | [-146.4,615.2,-68.4,699.2] 左移 | -1.42 |

三个位置下 `JSON.stringify(眼白框)` 完全相同 —— 眼白钉死在 head 上，只有虹膜跟着骨走。

**附件切换实测**：

```
点播放前  眼白_L = (无)          眼珠_L = eye_L_100
点播放后  眼白_L = sclera_L_100  眼珠_L = iris_L_100
```

### `node --check` 查不出的一个 TDZ（这轮已避免）

分层覆盖块必须放在 `let merged = null;` **之后**。上一版放在之前引用 `merged`，语法检查通过但运行时会抛 `Cannot access 'merged' before initialization` —— 整个 `evalCurrentPose` 挂掉，整个渲染挂掉。

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.89）
```

## 0.9.88 — 眼珠跟随改为换贴图，不再移动眼球（修「眼白跟着动」）（2026-11-11）

**用户反馈**：眼珠跟随有问题，眼白跟着动了 —— 眼白是固定位置的，只有眼珠该跟着动。

### 我的实现错了：移骨会推动整只眼

0.9.85 的结论是「位移必须靠骨」，理由是我比对 `gaze_*` 贴图时**用了全部不透明像素质心**：

| 贴图 | 全部像素质心 |
| --- | --- |
| eye_L_100 | (52.59, 40.24) |
| gaze_L_xp06_yp04 | (52.60, 40.23) |
| gaze_L_xm06_ym04 | (52.57, 40.26) |

差异 < 0.03px → 我判定「贴图没偏移」。**这个比对方法有缺陷**：眼白占了大面积亮色像素，把质心拉平了，虹膜的偏移被稀释掉。

### 正确比对：深浅分开

按亮度把像素分成「眼白（亮）」与「虹膜（深）」分别求质心：

| 贴图 | 眼白质心 | 虹膜质心 |
| --- | --- | --- |
| eye_L_100 | (52.48, 48.47) | (52.70, 32.35) |
| gaze_L_xm06_yz00 | (59.51, 48.03) | (44.89, 31.67) |
| gaze_L_xp06_yz00 | (44.44, 48.27) | (60.86, 32.15) |

**虹膜左移时，可见眼白质心反而右移** —— 说明眼白铺满整个眼眶、虹膜遮住其中一块：虹膜往左，左边眼白被遮住，可见部分的质心就往右偏。

### 决定性证据：整眼轮廓完全不变，只有虹膜在动

| 贴图 | 整眼轮廓（全部不透明） | 虹膜边界（深色） |
| --- | --- | --- |
| eye_L_100 | x[1,97] y[1,80]，97×80，5801px | x[16,90] |
| gaze_L_xp06_yz00 | x[1,97] y[1,80]，97×80，5804px | **x[22,96]**（右移 6） |
| gaze_L_xm06_yz00 | x[1,97] y[1,80]，97×80，5809px | **x[10,84]**（左移 6） |

轮廓逐像素同尺寸、同边界；只有深色虹膜的 x 范围在变。**这就是「眼白固定、虹膜移动」的画法**。

而我移 `eye-L` 骨时，推动的是 97×80 的**整只眼**（眼白+虹膜一起）—— 用户看到的正是这个。

### 修法：改用 attachmentOverrides 切 gaze_* 贴图

`眼珠_L` 槽里有 24 张 `gaze_*` 变体，命名即档位：

```
x 档位: -0.06, -0.03, 0, +0.03, +0.06   →  xm06, xm03, xz00, xp03, xp06
y 档位: -0.04, -0.02, 0, +0.02, +0.04   →  ym04, ym02, yz00, yp02, yp04
```

5×5 = 25 个位置，实际只有 **24** 张 —— **缺中心 `xz00_yz00`**（正中用 `eye_L_100` 那张睁眼贴图）。所以偏移接近 0 时回退到 `eye_L_100`。

实现改动：

| 项 | 改前（0.9.85–87） | 改后 |
| --- | --- | --- |
| 通道 | `opts.edits.bones`（改骨局部坐标） | `opts.attachmentOverrides`（换槽附件） |
| 影响范围 | 整只眼（97×80 全部） | **只有虹膜**（眼白轮廓不变） |
| 偏移量 | 世界单位直接叠到骨 | 换算成 5×5 网格索引 |

`gazeBoneEdits()` 已彻底删除，改为 `gazeAttachmentOverrides()`。

### 这轮还修了一个 `node --check` 查不出的 bug

我最初把眼珠合并块放在 `let merged = null;` **之前**，引用了 TDZ（暂时性死区）变量：

```js
if (animate && gazeOffsetNonZero()) {
  if (!merged) merged = new Map();   // ← merged 还没声明
```

`node --check` 只验语法，**不报 TDZ**；真跑起来会抛 `Cannot access 'merged' before initialization`，整个 `evalCurrentPose` 挂掉 = 整个渲染挂掉。把合并块挪到声明之后修好。

### 验证

**贴图切换映射**：

| 偏移 | 眼珠_L 附件 |
| --- | --- |
| (0, 0) | `eye_L_100` |
| (+10, +6) | `gaze_L_xp06_yp02` |
| (+0.5, +0.5) | `eye_L_100`（中心回退） |
| (-10, 0) | `gaze_L_xm06_yz00` |

**三条行为规则**（鼠标真实事件驱动）：

| 场景 | 眼珠_L | 眼白_L |
| --- | --- | --- |
| 鼠标右上 | `gaze_L_xp03_yz00` | null |
| 鼠标左下 | `gaze_L_xz00_ym02` | null |
| 暂停 | 保持 `gaze_L_xz00_ym02` | null |
| 暂停后再移动 | 不动 | null |
| 换回 idle | `eye_L_100` 复位 | null |

眼白槽全程为 null（setup 里它就没挂附件），只有 `眼珠_L` 的内容在换 —— 正是用户要的「眼白不动、只有眼珠动」。

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.88）
```

## 0.9.85–0.9.87 — 动画分页补 blink 与「眼珠跟随鼠标」（2026-11-11）

**用户要求**：动画分页的 Spine 部分再补上眨眼动画和鼠标跟随眼珠动画；眼珠跟随在点播放后开始跟随，停止则保持不动，更换动画选择后复位。

### 动画分页现在列三条

```
Spine · 待机动作 (3)
  idle
  blink
  眼珠跟随鼠标

序列帧 · 复杂动作 (2)
  tail_wag
  wave
```

`blink` 是 model.json 里真实存在的动画（0.15s，8 个槽轨），只是之前被 `spineIdleAnimNames()` 过滤掉了 —— 现在放出来即可，无需造数据。

### 「眼珠跟随鼠标」是虚拟条目，不做成动画

三个理由：

1. 跟随是**实时**的（鼠标一动就要跟），而 Spine 动画按时间轴采样
2. 「暂停保持、换动画复位」是**状态机**语义，不是关键帧语义
3. 做成动画会写进 model.json 并污染 dirty / 保存链路

所以它是编辑器内的一个 pseudo 条目，id 为 `__gaze_follow__`，数据只活在 `state.gaze`：

```js
state.gaze = { active: false, dx: 0, dy: 0, eyes: ["eye-L", "eye-R"] };
```

### 为什么不切 gaze_* 贴图

`眼珠_L` 槽里有 24 张 `gaze_*` 贴图（5×5 方向网格，命名如 `gaze_L_xp06_yp04`），看起来像是「换图就能改视线」。**像素比对否掉了这个假设**：

| 贴图 | 不透明像素质心 |
| --- | --- |
| eye_L_100 | (52.59, 40.24) |
| gaze_L_xm03_yz00 | (52.57, 40.25) |
| gaze_L_xp06_yp04 | (52.60, 40.23) |
| gaze_L_xm06_ym04 | (52.57, 40.26) |
| gaze_L_xp03_yp02 | (52.59, 40.24) |

六张贴图质心差异 **< 0.03 像素**，全在正中 —— 贴图本身没有方向偏移，位移只能靠骨。这也解释了 `gaze_grid_preview` 为什么骨位移全是 0（那是个没做完的空壳）。

### 实现要点

**求值侧**：在 `evalCurrentPose()` 里把眼骨偏移叠加到 `opts.edits.bones`（与 transient 同一通道但完全独立）：

```js
if (animate && gazeOffsetNonZero()) { /* 注意判据不是 active，见下 */ }
```

**鼠标驱动**：`onPointerMove` 最前面拦截，跟随激活时不参与部件拾取：

```js
if (gazeActive()) { const gp = stagePoint(e); if (updateGaze(gp.x, gp.y)) render(); return; }
```

**偏移换算**：以 `head` 世界原点为注视中心，画布短边一半为满量程，夹在 ±10 世界单位（约眼珠直径 102 的 1/10，不出眼眶）。画布 y 向下、世界 y 向上 → `dy` 取反。

### 我在这轮踩的两个 bug（都已修，记录以便复用）

**① `edits.bones` 是绝对 local 覆盖，不是增量**

第一版写 `map.set(name, { x: dx, y: dy })`，把 `eye-L` 的 setup 局部坐标 `(-89.5, -123.5)` **整个替换**成 `(4.34, 1.04)`。两眼共享父骨 `head`，结果**挤到同一点**：

```
基线    eye-L (-108, 652.5)   eye-R (79, 650.5)
出错后  eye-L (-14.16, 777)   eye-R (-14.16, 777)   ← 重合
```

修法：基于 `state.bones[name]` 的 setup 值做增量 `x: base.x + dx`。

**② 暂停时叠加被 `gazeActive()` 挡住，眼珠弹回基线**

```
暂停前  eye-L (-103.39, 652.81)
暂停后  eye-L (-108.00, 652.50)   ← 弹回基线，与「停止保持不动」相反
```

根因：求值判据写的是 `gazeActive() && gazeOffsetNonZero()`，暂停时 `active=false` 就不再叠加。改成**只看有没有偏移** —— `active` 只控制「是否继续响应鼠标」。

### 附带确认：局部增量 == 世界增量

`dx/dy` 是世界单位，而 `edits.bones` 的 `x/y` 是父骨局部。实测该 rig 的 `head` 在 setup 下 `rotation=0`、`scale=1`，所以两者等价：

```
eye-L 局部 x +5  →  世界 (-108.00, 652.50) → (-103.00, 652.50)   Δ=(5.000, 0.000)
```

**限制**：若将来某个动画让 `head` 带旋转/缩放，该等价关系失效，眼珠会偏。当前包里 head 无旋转动画，可接受；已在代码注释里标明。

### 验证

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.87）
```

**三条行为规则（实测 eye-L 世界坐标）**：

| 阶段 | eye-L | gaze.active | dx/dy |
| --- | --- | --- | --- |
| 基线 | (-108, 652.5) | false | 0 / 0 |
| 播放 + 鼠标右上 | (-102.83, 654.38) | true | +5.17 / +1.876 |
| 暂停 | (-102.83, 654.38) 不变 | false | 偏移保留 |
| 暂停后移动鼠标 | (-102.83, 654.38) 不动 | false | 不变 |
| 换到 idle | idle 驱动的位置 | false | **归零** |

两眼间距全程保持 **187**（`84.17 − (−102.83)`），不再重合。方向也对：鼠标右上 → 眼珠 x/y 都增大；左下 → 都减小。

**blink**：`animDur` = 0.150；播放时时间轴推进 `0.104 → 0.146 → 0.038 → 0.079`（循环）；`t=0.079` 时 `眼珠_L` 附件变 null —— 正是闭眼帧。

## 0.9.84 — 收起改成高度收拢动画，工具条不再与面板脱节（2026-11-11）

**用户反馈**：收起底部面板时，低帧率下能看到「面板先下去，工具栏再下去」，两者不同步。

### 根因：0.9.83 只做了 opacity 动画，面板高度全程没变

```css
/* 0.9.83 */
@keyframes dsFadeOut {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(8px); }
}
```

面板在这场动画里**始终占 280px 高**，只是自己淡出 + 平移 8px。工具条的位置由布局决定，一动不动。170ms 后 `hidden` 生效，面板突然从布局里消失，工具条在**那一帧**跳到最底部 —— 视觉上就是「面板先下去、工具栏再跳下去」。

低帧率下更明显，因为动画期间工具条静止、结束瞬间位移 280px，是两段截然不同的运动。

### 修法：动画直接改 height

```css
@keyframes dsFold {
  from { height: var(--ds-h, 280px); opacity: 1; }
  to   { height: 0px; opacity: 0; }
}
@keyframes dsUnfold {
  from { height: 0px; opacity: 0; }
  to   { height: var(--ds-h, 280px); opacity: 1; }
}
.dopesheet.is-opening,
.dopesheet.is-closing { min-height: 0; max-height: none; }
.dopesheet { overflow: hidden; }
```

DOM 顺序是「工具条 → 面板 → 状态栏」，**面板真变矮，上方工具条就被布局带着一起走** —— 同一帧内同步，不会脱节。

三个必须处理的技术细节：

| 细节 | 原因 |
| --- | --- |
| 高度写进 CSS 变量 `--ds-h` | `height: auto` 不能过渡，keyframes 的 from/to 需要具体数值；JS 每次按实际高度写入（用户可能拖过高度） |
| 动画期 `min-height: 0` | 原规则 `min-height: 160px` 会顶住，面板收不到 0 |
| `overflow: hidden` | 高度收拢时内容要裁掉，否则溢出 |

JS 同步调整（`dsOpen`）：展开前把目标高度写进 `--ds-h`、动画结束清掉；收起前把**当前实际高度**写进去。两个超时分别 220ms / 190ms，略大于动画时长，保证动画真的跑完再切 `hidden`。

### 验证：逐 30ms 采样，`间隙 = 工具条底边 − 面板顶边` 应恒为 0

**收起过程**：

| 时刻 | 面板高 | 面板顶 | 工具条顶 | 间隙 |
| --- | --- | --- | --- | --- |
| 0 | 280 | 462 | 425 | 0 |
| 30 | 272 | 470 | 433 | 0 |
| 60 | 245 | 497 | 460 | 0 |
| 90 | 197 | 545 | 508 | 0 |
| 120 | 129 | 613 | 576 | 0 |
| 150 | 40 | 702 | 665 | 0 |
| 180 | 1 | 741 | 704 | 0 |

**展开过程**：

| 时刻 | 面板高 | 工具条顶 | 间隙 |
| --- | --- | --- | --- |
| 30 | 143 | 562 | 0 |
| 60 | 221 | 484 | 0 |
| 90 | 256 | 449 | 0 |
| 120 | 272 | 433 | 0 |
| 180 | 280 | 425 | 0 |

两段过程的间隙**恒为 0**，工具条始终贴着面板顶边同步移动。收起末尾面板只剩 1px、工具条已到 704（最终 705），**没有跳变**。

收尾状态：`hidden=true` / `--ds-h` 已清 / class 只剩 `dopesheet`；展开收尾 `hidden=false` / 高度 280 / `opacity=1`。

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.84）
```

## 0.9.83 — 动画工具条移到时间轴面板上方，展开/收起加淡入淡出（2026-11-11）

**用户要求**：底部工具条应该在时间轴面板展开时位于**面板上方**，折叠时回到最底部；展开/收起要有淡入淡出动画。

### 布局：靠 DOM 顺序解决，不改 flex 结构

改前顺序（工具条被压在最底）：

```
#dopesheet      时间轴面板
.bar-anim       工具条
footer.statusbar 状态栏
```

改后：

```
.bar-anim       工具条
#dopesheet      时间轴面板
footer.statusbar 状态栏
```

因为面板折叠时是 `hidden`（`display:none` 不占位），所以：

| 状态 | 表现 |
| --- | --- |
| 折叠 | 工具条紧挨状态栏 → 看起来就在底部（与改动前一致） |
| 展开 | 工具条在上、面板在下（用户要的效果） |

不需要 `order`、不需要绝对定位、不需要改任何 flex 容器。

### 动画：class 驱动，保持 hidden 语义

`hidden` 是瞬间的 `display` 切换，过渡会被直接打断，所以不能给它加 `transition`。做法是关闭时**先播淡出、动画结束再设 hidden**：

```js
// 展开
panel.hidden = false;
panel.classList.add("is-anim", "is-opening");
setTimeout(() => panel.classList.remove("is-opening"), 200);

// 收起
panel.classList.add("is-anim", "is-closing");
panel._dsCloseTimer = setTimeout(() => {
  panel.hidden = true;
  panel.classList.remove("is-anim", "is-opening", "is-closing");
  syncCanvasSize(); if (state.model) { framePose(); render(); } syncAll();
}, 170);
```

关键点：

- **`hidden` 语义保持不变** —— `dsActivate()`、E2E 的 `offsetParent` 判断、`dopesheet` 可见性断言都还在用
- **收起期间再点展开会取消定时器**，不会出现「刚展开又被收起」
- 顺带加了 `prefers-reduced-motion` 支持，系统开了减少动效就不播

CSS：

```css
.dopesheet.is-opening { animation: dsFadeIn .18s ease both; }
.dopesheet.is-closing { animation: dsFadeOut .16s ease both; }
@keyframes dsFadeIn  { from { opacity:0; transform:translateY(8px);} to { opacity:1; transform:none;} }
@keyframes dsFadeOut { from { opacity:1; transform:none;} to { opacity:0; transform:translateY(8px);} }
```

### 重写 dsOpen 时漏掉的两处，已修回

**① `savePrefs(true)`** —— 原代码在设置 `timeline.expanded` 后会存偏好，我整段重写时漏了。不补的话重启后就记不住时间轴是开着的。

**② 收起回调里该用 `syncCanvasSize()` 而不是 `syncAll()`** —— `syncAll()` 的实现里**不含**画布尺寸重算与 `render()`：

```js
function syncAll() { syncToolbar(); syncList(); syncInspector(); syncLayers();
  syncDebug(); syncFooter(); syncStageOverlays(); syncPanel(); syncExprPanel();
  syncAnimPanel(); syncEditToolbar(); syncDisplayToggles(); updateCursor(); }
```

时间轴收起后画布变高，不重算尺寸会出现贴图拉伸与命中偏移。参照 `dsSetHeight` 的正确做法补上 `syncCanvasSize()` + `framePose()` + `render()`。

### 验证

**布局（`getBoundingClientRect`）**：

| 状态 | 工具条 top–bottom | 面板 top–bottom | 状态栏 top–bottom |
| --- | --- | --- | --- |
| 展开 | 425–462 | 462–742 | 742–768 |
| 折叠 | 705–742 | 隐藏 | 742–768 |

展开时「工具条底边 462 == 面板顶边 462」，工具条确实在面板上方；折叠时工具条贴到状态栏顶部 742。

DOM 顺序断言：`bar.compareDocumentPosition(panel)` 含 FOLLOWING、`panel.compareDocumentPosition(status)` 含 FOLLOWING，均为 true。

**动画（逐帧抓 opacity / class）**：

```
收起 +30ms   cls = "dopesheet is-anim is-closing"   opacity 0.898
收起 +130ms                                        opacity 0.0165   ← 正在淡出
收起结束     hidden = true   cls = "dopesheet"     opacity 1（类已清干净）
展开 +30ms   cls 含 is-opening                      opacity 0.084
展开结束     hidden = false                        opacity 1
```

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.83）
```

## 0.9.82 — 修「时间轴」按钮一直是灰色禁用态（2026-11-11）

**用户反馈**：底部工具条的「时间轴」按钮为什么是灰色禁止态。

### 根因：HTML 写死的 disabled，没有任何代码去打开它

```html
<!-- index.html 原样 -->
<button id="btnDopesheet" class="btn" type="button" disabled ...>
```

而 `syncAnimSelect()` 只维护这五个控件的可用状态：

```js
$("btnPlay").disabled  = !has;
$("btnSetup").disabled = !has;
$("btnStop").disabled  = !state.anim;
$("speedSel").disabled = !has;
$("scrub").disabled    = !state.anim || state.animDur <= 0;
```

**`btnDopesheet` 从头到尾没被赋值过** —— 所以载入模型后它仍然是灰的。同一条工具条上其他按钮全部 `disabled=false`，只有它 `true` 且带静态 `disabled` 属性，正好对上。

### 修法（两处）

| 位置 | 改动 |
| --- | --- |
| `index.html` | 去掉 `btnDopesheet` 的静态 `disabled` |
| `app.js` `syncAnimSelect()` | 补 `$("btnDopesheet").disabled = !state.model` |

判据用 `!state.model` 而不是 `!has`（`has` 指有没有动画）：时间轴也能显示槽轨、事件行、形变等，没有动画同样该能展开。

### 验证

```
btnDopesheet disabled      false      ← 不再灰
静态 disabled 属性          已移除
点击后 #dopesheet.hidden     false      ← 展开
state.edit.timeline.expanded true
aria-pressed                "true"
node --check app.js          0
selftest-node.mjs           3532/3532
```

## 0.9.81 — 去掉底部动画条的「动画」下拉（与分页列表冗余）（2026-11-11）

**用户要求**：左下角那个组合框冗余了，去掉。指的是底部工具条里的 `动画 [idle ▾]` —— 它与动画分页的「Spine · 待机动作」列表功能重复。

### 删除

```html
<label class="lbl" for="animSel">动画</label>
<select id="animSel" disabled><option value="">（无）</option></select>
```

以及 `$("animSel").addEventListener("change", ...)` 绑定。

### 最容易踩的坑：连带把按钮状态搞坏

`syncAnimSelect()` 不只填充下拉，它同时负责五个控件的可用状态：

```js
sel.disabled = !has;
$("btnPlay").disabled  = !has;      // 播放
$("btnSetup").disabled = !has;      // 绑定姿态
$("btnStop").disabled  = !state.anim;  // 回到开头
$("speedSel").disabled = !has;      // 速度
$("scrub").disabled    = !state.anim || state.animDur <= 0;
```

如果因为它 `sel` 为 null 就整段跳过，**这五个按钮会永久禁用**。处理方式：只给 select 那段包 `if (sel)`，按钮那几行保持无条件执行（并各自加空值保护）。

### 换动画的入口没丢

| 入口 | 说明 |
| --- | --- |
| 动画分页的列表行点击 | `renderAnimIdleList` 里每行绑 `setAnimEditSelection(n)` |
| `__characterEditor.animSelect(name)` | 接口，与 UI 同一函数 |

### 验证

```
document.getElementById("animSel") === null     true   ← DOM 已删
btnPlay  disabled                                false  ← 可用
btnSetup disabled                                false
btnStop  disabled                                false
speedSel disabled                                false
点列表行后 animEdit.sel                           idle
animSelect("blink") → animEdit.sel                blink
animSelect("idle")  → animEdit.sel                idle
node --check app.js                               0
selftest-node.mjs                                3532/3532
```

底部条现在是：`播放 P | 时间轴 Tab | 绑定姿态 | 回到开头 | 循环 | 1× | scrub`。

## 0.9.78–0.9.80 — 待机区去掉下拉框，改成与序列帧区同款纯列表（2026-11-11）

**用户要求**：「这个下拉框删掉，和下面一样的列表」。0.9.77 做出的「下拉框放进 anim-track 条目」仍然是个 select —— 用户要的是**纯列表行**，`idle` 就是一行普通条目。

### 改动

| 项 | 改前（0.9.77） | 改后 |
| --- | --- | --- |
| DOM | `<div class="anim-track"><div class="anim-track-hd"><select id="animEditSel">` | `<div id="animIdleList" class="anim-tracks">` + `renderAnimIdleList()` 动态生成 |
| 交互 | select 的 `change` 事件 | 每行 `click` 调 `setAnimEditSelection(n)` |
| 视觉 | 条目里嵌一个被抹平的 select | 与 `tail_wag` / `wave` **完全相同** |

### 删掉的东西

| 符号 | 原因 | 残留 |
| --- | --- | --- |
| `select#animEditSel` | 换成列表行 | 元素不存在 |
| `.anim-track-select` CSS（3 条规则） | 只服务那个 select | 0 |
| `.anim-track.is-active` CSS | 试过选中态但视觉过重 | 0 |
| select 的 change 绑定 | 交互改为行点击 | 0 |

### 选中态为什么也去掉了

0.9.79 先加了 `is-active` 高亮，实测边框变成 `rgb(230,235,245)`（接近纯白）——比下面几行显眼太多，与「和下面一样」矛盾。换成 `--accent` 蓝边 + `--selected` 深蓝底后仍然抢眼。

最终去掉高亮：当前动画在**底部工具条的下拉**里本来就显示着，列表里不需要再做选中指示。

### 实测（`getComputedStyle` + `getBoundingClientRect`）

| 项 | `idle` | `tail_wag` |
| --- | --- | --- |
| 背景 | rgb(25,30,40) | rgb(25,30,40) |
| 边框 | rgb(44,52,68) | rgb(44,52,68) |
| 宽 | 275px | 275px |
| 高 | 28px | 28px |
| class | `anim-track` | `anim-track` |

`document.getElementById("animEditSel") === null` 为 true。

### 最终形态

```
Spine · 待机动作  (1)
  ┌────────────┐
  │ idle       │
  └────────────┘

序列帧 · 复杂动作  (2)
  ┌────────────┐
  │ tail_wag   │
  └────────────┘
  ┌────────────┐
  │ wave       │
  └────────────┘
```

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.80）
```

## 0.9.77 — 动画下拉做成「Spine · 待机动作」小标题 + 条目（与序列帧区同构）（2026-11-11）

**用户要求**：顶部红框那块（`标签「动画」+ 裸下拉`）做成和下面条目一样的样式；标题为「Spine · 待机动作」。

### 改动前 / 后

| 项 | 改前 | 改后 |
| --- | --- | --- |
| 顶部结构 | `<label>动画</label> + <select>` 平铺在 `anim-row` | `h3「Spine · 待机动作 (1)」+ anim-track 条目`，下拉在条目内 |
| 下拉外观 | 全局 `select` 样式（`var(--surface)` 背景、1px 边框、32px 高、13px 字号） | 透明背景、零边框、26px 高、11px 等宽字体 |
| 与下方一致性 | 无（两套视觉） | 完全同构 |

### 实现

HTML：待机区改成与序列帧区同一套骨架

```html
<section id="animIdleWrap" class="anim-section" hidden>
  <h3>Spine · 待机动作 <span id="animIdleCount" class="count">0</span></h3>
  <div class="anim-tracks">
    <div class="anim-track">
      <div class="anim-track-hd">
        <select id="animEditSel" class="anim-track-select" ...></select>
      </div>
    </div>
  </div>
</section>
```

CSS：新增 `.anim-track-select` 抹平全局 select 外观 —— 否则它在条目里会像个输入框

```css
.anim-track-select {
  flex: 1 1 auto; width: 100%; height: 26px; min-width: 0; max-width: none;
  padding: 0; border: 0; border-radius: 0; background: transparent;
  color: var(--fg); font: var(--text-xs)/1 var(--font-mono); cursor: pointer;
}
.anim-track-select:disabled { opacity: 1; cursor: default; }  /* 覆盖全局 55% 变灰 */
```

JS：`syncAnimEditBar` 补 `animIdleCount` / `animIdleWrap` 的同步（计数与显隐，与序列帧区同一规则）。

顺带删掉了 `#animEditDirty`「未保存」徽章 —— 它跟着旧的行内布局，放进条目里会挤掉下拉宽度；`animHasDraft` 仍在 `syncFooter` 里体现。原引用已加空值保护。

### 实测（`getBoundingClientRect` + `getComputedStyle` 逐项比对）

| 项 | 待机条目 | 序列帧条目 |
| --- | --- | --- |
| 高度 | 28px | 28px |
| 宽度 | 275px | 275px |
| 背景 | rgb(25,30,40) | rgb(25,30,40) |
| 边框 | 1px rgb(44,52,68) | 1px rgb(44,52,68) |
| 圆角 | 4px | 4px |
| 字体 | 13px system-ui | 13px system-ui |

下拉本身：`background: rgba(0,0,0,0)`、`border: 0px`、`height: 26px`、`radius: 0px`、`11px ui-monospace`。

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.77）
```

## 0.9.76 — 再删动画分页的胶囊标签与底部提示（2026-11-11）

**用户要求**：序列帧条目右侧的「序列帧 · xxx」也删掉，还有那句「逐帧 xxx」。

删除：

| 位置 | 内容 |
| --- | --- |
| 每个序列帧条目右侧 | 胶囊标签 `序列帧 · Spine 内为表情快照` / `序列帧 · 待接入` |
| 页面底部 | 「逐帧关键帧编辑请用底部「时间轴」；本分页只作动画总览。」 |

保留：`动画` 下拉、`序列帧 · 复杂动作` 标题与计数、`tail_wag` / `wave` 两条条目。

顺带清掉只服务那个胶囊的 `hasSpineTwin` 判断（它比较 model 动画名与序列帧 id 来决定标签文案）—— 不留死代码。`renderAnimSeq` 现在只输出条目名。

```
app.js  序列帧 · Spine 内为表情快照: 0
app.js  序列帧 · 待接入: 0
app.js  hasSpineTwin: 0
html    逐帧关键帧编辑: 0
html    序列帧 · 复杂动作: 1（标题保留）
selftest-node.mjs  3532/3532
```

分页最终形态：`动画 [idle]` + `序列帧 · 复杂动作 (2): tail_wag / wave`。

## 0.9.75 — 删掉动画分页里两段冗长说明（2026-11-11）

**用户要求**：把两处说明文字删掉（附图红框标出）。

删除的两段：

| 位置 | 原文 |
| --- | --- |
| 动画下拉下方 | 「Spine 只负责待机动画（idle）；眨眼与表情是人物包的内在机制，不出现在这里；挥手、坐下、转身等复杂动作走序列帧层。」 |
| 序列帧标题下方 | 「这一层用预渲染帧序列 + 预录语音，不归 Spine 管；与材质共用同一角色、锚点和比例，切换时交叉淡入淡出。」 |

保留：`动画` 下拉、`序列帧 · 复杂动作` 标题与计数、两条序列帧条目（含「Spine 内为表情快照」标注）、底部「逐帧关键帧编辑请用底部时间轴」提示。

只删 HTML 里的两个 `<p class="anim-note">`，不动数据与逻辑。

```
Spine 只负责待机动画 残留: 0
这一层用预渲染帧序列 残留: 0
序列帧 · 复杂动作 标题: 1
逐帧关键帧编辑 提示: 1
selftest-node.mjs  3532/3532
```

## 0.9.71–0.9.74 — 动画分页精简：只显示待机，复杂动作划归序列帧（2026-11-11）

**用户要求**：把人物包的动画清理掉，只保留待机 `idle`；明显区分 Spine 是待机动画、复杂动画是序列帧动画，提前留好槽位。附图标注了动画分页里要删除的部分。

**后来澄清**：「眨眼和表情动画要保留，但是动画分页不显示，这属于人物包的其他机制或者特性」。

### 结论：数据全保留，只精简分页

我先查了每个动画的实际用途，**没有盲删数据**：

| 动画 | 内容 | 处理 |
| --- | --- | --- |
| `idle` | 10 条骨轨，3.5s 循环 | 保留，分页显示 |
| `blink` | 8 条槽轨，眨眼档位 | 数据保留，**分页不显示** |
| 18 个表情 / 别名 | 各 11 条槽轨快照 | 数据保留，**分页不显示** |

**为什么 `wave` / `tail_wag` 也不能删**：查了它们在 Spine 里的实际内容 ——

```
wave      骨轨: (无)   槽轨: 11 个表情槽，0s 与 0.3s 两个 key
tail_wag  骨轨: (无)   槽轨: 11 个表情槽，0s 与 0.3s 两个 key
```

它们**没有任何身体动作**，只是表情别名（`build_animations.py` 的 `EXPR_ALIASES`），用于事件里标记「这个事件该配挥手」时联动表情。删掉会让相关事件失去表情联动。真正的挥手 / 摆尾在 `sequences/` 层，且 `status: "planned"`、`media: null`（素材未就位）。

### 动画分页的改动

**删除的 DOM（19 个节点，按用户附图）**：

| 区域 | 节点 |
| --- | --- |
| 时长与整体重定时 | `animDurInput` / `animDurApply` / `animDurNote` |
| 预览起止 | `rpFrom` / `rpTo` / `rpApply` / `rpReset` / `rpState` / `rpNote` |
| 实时预览与统计 | `animLiveChk` / `animKeyStat` |
| 重置与保存 | `animResetOne` / `animResetAll` / `animSave` / `animSaveNote` |
| 逐轨列表 | `animBonesWrap` / `animBoneCount` / `animBones` / `animSlotsWrap` / `animSlotCount` / `animSlots` |

**新增的序列帧区**（只读）：

```
序列帧 · 复杂动作  (2)
  tail_wag   序列帧 · Spine 内为表情快照
  wave       序列帧 · Spine 内为表情快照
```

数据来自 `catalog.registries.sequence.ids`（owner = `sequences/index.json`）。「Spine 内为表情快照」这个标注是查出来的事实，不是套话 —— 避免看到同名就以为两边都在做动作。

**动画下拉过滤**：新增 `spineIdleAnimNames()` —— 有 `idle` 时只返回 `idle`，包里没有 `idle` 时退回全部（避免老包整个面板空掉）。

### 能力没丢，只是入口从按钮换成接口

删掉的按钮背后都能通过接口调用，函数本体一个没删：

| 原按钮 | 现有入口 |
| --- | --- |
| 整体重定时 | `animApplyScale(name, dur)` / `__characterEditor.animSetDuration(name, v)` |
| 重置该动画 / 重置全部 | `animResetOne` / `animResetAll` / `__characterEditor.animResetOne()` |
| 保存文件 | `文件 → 保存文件` / `saveToDisk()` |
| 预览起止 | `setPreviewRange(from, to)` / `clearPreviewRange()` |

`syncPreviewRange` 与 `renderAnimTracks` 改成空实现（内部路径仍会调用，不能缺失）。

### 过程记录：三次自己修的错误

**① 替换函数头把函数体留下了孤儿**

我用 `edit` 把 `function syncAnimEditDurInput(force) {` 这一行整体换成了新代码，导致它的函数体悬空在下一行 —— `Unexpected token 'function'`。这个函数本来就该删（只服务已移除的时长输入框），把孤儿体一并删掉。

**② 锚点匹配没处理 CRLF**

脚本里用 `\n` 拼接锚点，但文件是 CRLF，`split` 计数为 0。改成按 `s.includes('\r\n')` 判断并统一转换。

**③ HTML 里写了 Markdown 星号**

说明文字写成 `**待机动画**`，界面把星号原样显示出来了。改成普通文字。（剩下的 6 处 `**` 都在 `<!-- -->` 注释里，不渲染。）

### 验证

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.74）
```

**已删节点的实际访问全部为 0**（`$("id")` 与 `getElementById`）：

```
animDurInput / animDurApply / animLiveChk / animResetOne / animResetAll / animSave
animBonesWrap / animBones / animBoneCount / animSlotsWrap / animSlots / animSlotCount
rpFrom / rpTo / rpApply / rpReset / rpState  →  全部 0
```

否则缺节点时 `.textContent` 会抛 TypeError 打断 `bindUI()`（本仓历史坑，注释里有记载）。

**浏览器实测**：

```
下拉选项        ["idle"]
模型动画数      21                ← 数据一个没删
blink 存在      true              ← 眨眼保留
expression_swap 存在 true          ← 表情保留
blink 可选中    true              ← 接口仍可播放
序列帧区        tail_wag / wave（Spine 内为表情快照）
已删控件残留    0
```

## 0.9.70 — 放大倍率固定 1.5×，不再变动（2026-11-11）

**用户反馈**：算了，默认 1.5× 吧，不要变动倍率。

### 改动

去掉「按附件大小分 2×/3× 两档」的分档逻辑，换成单个常量：

```js
const MAG_ZOOM = 1.5;                              // 固定倍率
const span = clamp(geo.side / MAG_ZOOM, 1, ...);   // 窗口反推
```

### 删掉的死代码

| 符号 | 残留数 |
| --- | --- |
| `MAG_ZOOM_SMALL` | 0 |
| `MAG_ZOOM_LARGE` | 0 |
| `MAG_SMALL_ITEM_EDGE` | 0 |
| `targetZoom` / `itemEdge` 局部变量 | 0 |

留着分档常量会变成「看起来还在用、实际不生效」的死代码，一并清掉。

### 固定倍率的额外好处

分档方案下，鼠标从蕾丝（3×）移到旁边的头发（2×）时倍率会**突变**，观感跳。固定后整个小窗内倍率恒定。

### 实测（内容边长 351，取样窗口统一 234）

| 附件 | 图集最长边 | 倍率 |
| --- | --- | --- |
| 肩膀花边_左 | 97 | 1.50 |
| 呆毛 | 222 | 1.50 |
| 裙子 | 456 | 1.50 |
| 前头发刘海 | 644 | 1.50 |
| 披发 | 854 | 1.50 |

从最小到最大五个附件，倍率全部一致。

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.70）
```

## 0.9.69 — 放大倍率约束到 2×/3×（2026-11-11）

**用户反馈**：缩放倍率太大，2× 或 3× 就行。

### 根因：先前是「按附件尺寸估窗口」，倍率只是被动结果

```js
span = clamp(附件最长边 × 0.5, 24, 96);   // 旧：先定窗口
zoom = 内容边长 / span;                    // 倍率是副产品
```

小附件（蕾丝 65×97）算出 span ≈ 48、内容边长 356 → **约 7.4×**；更小的件能到 15×。

### 改法：先定倍率，再由倍率反推窗口

```js
targetZoom = 附件最长边 > 140 ? 2 : 3;     // 大件 2×、小件 3×
span = clamp(内容边长 / targetZoom, 1, min(page.width, page.height));
```

这样无论浮层多大、附件多小，倍率都落在 2×/3×。

### 顺带重构：magGeometry() 统一浮层几何

取样窗口与取景框/内容区必须用**同一份**边长，否则倍数会和取景框对不上。抽出 magGeometry() 返回 m / side / dx / dy，两处共用。

### 实测

```
内容边长 351（画布 680×628，浮层 422×377）
肩膀花边_左  最长边  97 → 3×  窗口 117  实际 3.00×
裙子        最长边 456 → 2×  窗口 176  实际 2.00×
呆毛        最长边 222 → 2×  窗口 176  实际 2.00×
前头发刘海   最长边 644 → 2×  窗口 176  实际 2.00×
```

旧常量 MAG_SPAN_MIN / MAG_SPAN_MAX / MAG_SPAN_RATIO 残留 0（已全部替换）。

### 过程记录：漏了一个闭合括号

插入 magGeometry() 时 return 语句的右花括号之后漏了函数的闭合花括号，直接接上 function drawUVInset，报 Unexpected token。补上即通过。

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.69）
```

## 0.9.68 — 放大浮层改为画面中央大窗（尺寸按画布比例）（2026-11-11）

**用户反馈**：结构对了，但**浮层太小、位置不对**。附了一张对照图 —— 黄框是当前 320×336 挤在小窗左侧且被小窗压住一角，红框是期望的**画面中央大窗**（约 60% 尺寸）。

### 改动

| 项 | 改前 | 改后 |
| --- | --- | --- |
| 尺寸 | 固定 320×336 | **画布 62% × 60%**（下限 320×336，窄画布不缩成小块） |
| 位置 | 小窗左侧、底边对齐 | **水平居中、垂直居中上移 8%**（避开底部播放条与小窗） |
| 遮挡 | 被小窗压住右下角 | 小窗在右下角，浮层不覆盖它 |

画布 680×628 时实际结果：**422×377**，位于 `(129, 78)`。

### 改尺寸时发现并修掉一个真 bug：内容被拉变形

原代码取样是正方形、却铺到非正方形区域：

```js
const innerW = m.w - MAG_INSET * 2;
const innerH = m.h - MAG_TITLE - MAG_INSET * 2;
ctx.drawImage(page, sx, sy, span, span, dx, dy, innerW, innerH);  // ← span×span 画进 innerW×innerH
```

320×336 时两个值差得少，看不出；放大到 60% 画布后会被明显拉扁。改成取正方形边长 `min(boxW, boxH)` 居中绘制，十字准心与坐标也按居中后的原点算。

### 验证

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.68）
```

内容区正方形性（画布 680×628，浮层 422×377）：

| 采样点 | 值 | 结论 |
| --- | --- | --- |
| 中心 (340, 277) | `[82,128,211]` | 图集内容 |
| 非背板像素比例 | 79.6% | 内容画满 |
| 右下角内 | `[92,105,183]` | 图集内容 |
| 内容右侧留白 | `[20,17,27]` | 纯背板 —— **未被拉到 boxW，无拉伸** |

### 附带修好的环境问题

实测时发现 8123/8124 都不在监听（服务进程已退出），用 `serve.py --port 8123 --no-browser` 重新拉起。

## 0.9.67 — 取景框最小可视尺寸（2026-11-11）

0.9.66 的小窗取景框按真实比例绘制：图集 2048px 塞进 150px 小窗，缩放比 0.069，96px 的取景窗口在屏幕上**只有 6.65px** —— 像素级采样能查到边框（`[90,169,255]` 三处都在位），但肉眼几乎看不见。

改法：给取景框加最小可视尺寸并做成「镜片」观感：

| 改动 | 说明 |
| --- | --- |
| 最小尺寸 16px | `Math.max(16, span * nav.scale)`，以真实位置为中心外扩 |
| 半透明填充 | `rgba(90,169,255,.18)`，看出取景范围 |
| 四角加粗 | 2.5px 角标，小框也能一眼定位 |

**注意**：外扩只在**绘制**上进行，取景框对应的图集区域（`sx/sy/span`）不受影响 —— 放大浮层的内容仍严格对应鼠标位置，不会因为视觉放大而错位。

验证（同一次 eval 内设值 + render + 读像素，避免 `pointerleave` 打断）：

```
小窗内 #5aa9ff 边框像素  88 个（此前 6.65px 时几乎为 0）
样例坐标 (576,505) (577,505) (654,496)
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.67）
```

## 0.9.66 — 双面板放大镜：右下小窗做导航，大浮层显示放大（2026-11-11）

**用户第三次澄清**：接受悬浮输入的只有右下角那个小窗，放大内容显示在**另一个更大的浮层**里。

前两版都没抓住这个结构：

| 版本 | 做法 | 问题 |
| --- | --- | --- |
| 0.9.61–62 | 鼠标旁弹小浮窗 | 位置不对（不是固定右下） |
| 0.9.63–65 | 把小窗自己改成放大区 | 输入源不对（该是小窗导航） |

### 正确结构（电商详情页放大镜）

```
右下角小窗（150×150 缩略图，**接受鼠标悬浮**）
    ├─ 显示整张图集
    ├─ 鼠标在上面移动 → 画出取景框（蓝框）
    └─ 同时在大浮层里显示取景框内的放大内容（320×320，小窗左侧）
```

### 实现要点

| 函数 | 职责 |
| --- | --- |
| `navPanelGeom()` | 小窗几何（绘制与命中**共用同一份**，避免两处各算一遍算错） |
| `inNavPanel(px, py)` | 判断画布点是否落在小窗内 |
| `navContentRect(page)` | 缩略图内容区矩形 + 缩放比 |
| `itemAtAtlasPoint(frame, ax, ay)` | 图集坐标命中的**最小**附件（用于自适应取景窗口） |
| `magPlacement()` | 大浮层位置：优先小窗左侧、底边对齐；左侧放不下改到上方 |

**取景窗口自适应**：`clamp(命中附件最长边 × 0.5, 24, 96)`。小件（蕾丝 65×97）窗口 48、大件（裙子 456×278）窗口 96。贴边时窗口**平移**而非压缩，保证倍数恒定。

**关键交互**：鼠标在小窗内时**不参与模型拾取** —— 否则会误选小窗背后的部件。`onPointerMove` 里小窗优先判断并 `return`：

```js
const onPanel = (state.show.mesh || state.show.weights) && inNavPanel(p.x, p.y);
state.panelHover = onPanel ? { x: p.x, y: p.y } : null;
if (onPanel) { state.hover = -1; ... return; }
```

### 拼接时的一个错：函数定义被甩到文件末尾

重写脚本先替换 `drawUVInset` 整段、**之后**才去找 `itemSpanOf` —— 但 `itemSpanOf` 原本就在被替换的范围里，已经没了，`indexOf` 返回 −1，于是新定义被拼到 `})()` 后面：

```js
})()function itemSpanOf(item, withBox) {   // ← SyntaxError: Unexpected token 'function'
```

修法：从尾部切掉错拼段，再把函数定义插到 `drawUVInset` 之前。**教训：替换大段代码时，被替换范围内的辅助函数要先抽取出来，不能事后再找。**

### 验证

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.66）
```

**真实鼠标事件链路**（`mousemove` 派发到小窗内文档坐标 685,596）：

| 检查点 | 采样/状态 | 结果 |
| --- | --- | --- |
| 记录小窗内坐标 | `panelHover = {x:641, y:519}` | ✅ |
| 不误选背后部件 | `hover = -1` | ✅ |
| 大浮层边框 | `[47,83,128]` | ✅ |
| 大浮层标题条 | `[15,17,30]` | ✅ 背板色 |
| 放大内容 | `[60,98,166]` | ✅ 裙子深蓝布料 |

**鼠标移出小窗**（移到画布 300,300）：

| 检查点 | 结果 |
| --- | --- |
| `panelHover` 清空 | ✅ null |
| 大浮层消失 | ✅ 背板像素 0 |
| 恢复模型拾取 | ✅ `hover = 36` |
| 小窗边框回常态灰 | ✅ `[30,28,30]` |

整屏截图确认：右下小窗 `atlas · UV` 显示整张图集 + 蓝色取景框；左侧大浮层标题 `裙子 3×`，内容为取景框内的放大布料。

## 0.9.64–0.9.65 — ~~放大镜采样窗口按附件尺寸自适应~~（自适应逻辑已并入 0.9.66 的双面板结构）

0.9.63 用**固定 42×42** 的图集采样窗口，对不同尺寸的附件效果差得很远：

| 附件 | 图集尺寸 | 42×42 覆盖率 | 观感 |
| --- | --- | --- | --- |
| 肩膀花边_左 | 65×97 | 43% | 能看清蕾丝花纹 |
| 裙子 | 456×278 | 9% | 只有一片纯蓝，认不出是什么 |

**已核对这不是算法错误**：把插值结果打出来单独验证过 ——

```
鼠标世界点       (-6, 298)
插值图集坐标      (1718, 706)   重心 [0.5, 0, 0.5]
直接采样该像素     [38, 40, 94]  深蓝
裙子图集范围       x[1490,1946]  y[567,845]
```

坐标落在裙子范围内、采样值也是深蓝 —— 面板显示纯蓝是**正确**的，那块裙子本来就在纯色布料中间。问题纯粹是「窗口太小看不到上下文」。

### 改法：窗口 = 附件最长边的 0.55 倍，夹在 [28, 100]

```js
const span = clamp(Math.max(bbox.w, bbox.h) * 0.55, 28, 100);
```

三档实测：

| 附件 | 图集尺寸 | 原始窗口 | 实际窗口 | 倍数 |
| --- | --- | --- | --- | --- |
| 肩膀花边_左 | 65×97 | 53 | 53 | **2.81×** |
| 裙子 | 456×278 | 251 | 100（上限） | **1.5×** |
| 呆毛 | 222×213 | 122 | 100（上限） | **1.5×** |

**上限从 160 降到 100**：160 时裙子 `150/160 = 0.94`，标签四舍五入成 `1×` —— 等于没有放大，跟「放大镜」自相矛盾。

**倍数标签改成一位小数**（`1.5×` / `2.8×`），不再四舍五入骗人：

```js
const tag = (zoom >= 1.95 ? Math.round(zoom) : +zoom.toFixed(1)) + "×";
```

改后裙子面板能看见裙摆的橙色花纹，不再是纯蓝一片。

### 验证

```
node --check app.js            0
selftest-node.mjs             3532/3532
bump-editor-version.mjs --check  0（0.9.65）
ZOOM_SRC_SPAN 残留 0
```

截图确认：裙子 `1.5×`（可见橙色花纹）、肩膀花边 `2.81×`（可见蕾丝）、呆毛 `1.5×`。

## 0.9.63 — ~~右下角贴图面板改成跟随鼠标的放大镜~~（已撤销，输入源搞错，见 0.9.66）

**用户反馈**：0.9.61–0.9.62 做的「鼠标旁弹浮窗」不是要的东西。要的是**放大在网格和权重模式下才会显示在右下角的贴图图层**，类似电商商品详情的放大镜效果。

**我理解偏了**：做成了跟随鼠标的浮动小窗；实际要的是**改造右下角那个固定面板本身** —— 面板位置不变，但内容是鼠标所指位置的贴图放大。

### 0.9.61–0.9.62 的改动已完整撤销

| 撤销项 | 结果 |
| --- | --- |
| `render()` 里的 `drawHoverMagnifier(frame)` 调用 | 已删 |
| `6.5b` 整段（100 行，4086 字符） | 已删 |
| `state.pointer` 字段 | 已删 |
| `onPointerMove` 里的取样逻辑 | 已恢复原样 |
| `pointerleave` 监听 | 已删 |

残留检查全部为 0。

### 真正的改法：重写 `drawUVInset`

那个 150×150 面板原本画的是**整张图集缩略图 + 选中附件的范围框**，看不出「鼠标指的位置取的是贴图哪一块」。改成双模式：

| 鼠标状态 | 面板内容 |
| --- | --- |
| 指向某个附件 | **以该点的图集像素为中心，取 42×42 放大铺满**（约 3.5×），带中心十字 |
| 未指向附件 | 退回整张图集缩略图 + 选中范围框（原行为保留） |

**世界坐标 → 图集像素**用逐三角形重心坐标插值（新增 `uvAtWorld`）：

```js
// 对每个三角形求重心坐标 (l1,l2,l3)，命中则插值出 sourceXY
const sx = src[ia*2]*l1 + src[ib*2]*l2 + src[ic*2]*l3;
```

**贴边处理**：鼠标指向图集边缘时，采样窗口**平移**而不是压缩，保证放大倍数恒定。

**面板几何**：150×150 → 158×158 + 15 标题条。标题左边槽名（青绿 `#8ee6c8`），右边放大倍数（橙黄 `#f0b429`）。

### 修正了「只开权重时不显示」

原版 `drawUVInset` 是在 `drawMeshOverlay` 末尾调用的，而 `drawMeshOverlay` 只在 `state.show.mesh` 为真时执行 —— **只开权重视图时面板根本不出现**。

已把调用从 `drawMeshOverlay` 里取出，改到 `render()` 里：

```js
if (state.show.mesh || state.show.weights) drawUVInset(frame);
```

这正是用户说的「网格和权重模式下才会显示」。

### 鼠标位置记录

新增 `state.cursor`（画布内 CSS 坐标），但**只在 `mesh || weights` 时更新** —— 其它模式下不记录、不触发额外重绘：

```js
const zoomPanelOn = state.show.mesh || state.show.weights;
if (zoomPanelOn) state.cursor = { x: p.x, y: p.y };
else state.cursor = null;
```

附件没变但光标移动时也重绘（否则放大内容不跟着变）。`pointerleave` 清空 cursor 与 hover。

### 验证

```
node --check app.js      0
selftest-node.mjs       3532/3532
bump-editor-version.mjs --check  0（0.9.63）
```

**面板显隐**（以背板色 `#12151d` 的像素数判定）：

| 图层状态 | 背板像素 | 结论 |
| --- | --- | --- |
| 只开权重 | 16650 | ✅ 出现 |
| 只开网格 | 17525 | ✅ 出现 |
| 全关 | 0 | ✅ 不出现 |

**放大内容**（`肩膀花边_左`，光标在其中心）：

```
标题 [93,142,126]     青绿槽名（对）
内容 [179,209,250]    贴图实际像素（对，非背板色）
```

截图确认：标题 `肩膀花边_左` + 右侧 `4×`，内容为米白色蕾丝放大，中心有蓝色十字准心。

**鼠标移出**：

```
hover -1 / cursor null / 面板背板仍 16646 像素 → 面板保留但退回缩略图模式
```

## 0.9.60 — 旧格式错误提示补上「实际读到的入口文件」（2026-11-11）

**用户反馈**：贴了一张截图 —— 页面空状态 + 顶部红条 `载入失败：索引校验失败：该包为旧格式（v3.1 及更早）：spine/index.json 已废除，本版只认包根 manifest.json；请用 compile_pack.py 重新编译`，并说「我啥都没干就报错」。

### 诊断：不是「干了什么」，是 URL 里的 `?index=` 指向了旧包

精确复现（0.9.59，一字不差）：

```
?index=workspace/tmp/e2e/rig-base/index.json
→ 该包为旧格式（v3.1 及更早）：spine/index.json 已废除…
```

**关键证据**：截图里页面是**空状态**（「还没有打开人物包」+ 中间载入卡片），这正是「启动时带 `?index=` 但载入失败」的形态 —— `app.js` 启动时只有带 `?index=` 才会自动载入。

而当前包 `workspace/packs/deepseek` **完全正常**（38 槽 / 7 组 / 无提示）。

**旧包的地图**：`workspace/` 下有 **22 个**符合旧格式的 `index.json`（`schemaVersion` + `files`，无 `manifest.json`）：

```
workspace/tmp/e2e/rig-base/、rig-save/、rig-p2/、spineboy/ …
workspace/three-view-to-spine-anime/step2/handoffs/rig/index.json
workspace/tmp/editor-acceptance/、editor-acceptance-main/ …
```

它们都**没有 `manifest.json`**，所以「打开文件…」选到这些目录时，`buildLocalTree` 会退回 `index.json` 当入口（这是既有设计，为了给出「旧格式」诊断而不是含糊的失败）。

### 这条消息本身是对的，但它有两个缺陷

**① 不报实际读到的文件路径**

`issuesToError(issues, prefix)` 只用 `issue.path`（字段路径，如 `spine`），不含文件路径。22 个旧包报出来**一模一样**，用户无从判断自己踩了哪个。

改法：给 `issuesToError` 加第三个参数 `sourcePath`，`loadIndexEntry` 据此把入口文件路径写进 `detail`：

```js
if (sourcePath) detailParts.push("读到的入口：" + sourcePath);
```

两条调用路径都接上了：
- `loadIndexByPath` → `sourcePath: p.value.indexPath`（URL 路径）
- `loadDirFiles` → `sourcePath: root + "/" + entry`（本地目录）

现在同一个旧包报：

```
该包为旧格式（v3.1 及更早）：spine/index.json 已废除，本版只认包根 manifest.json；
请用 compile_pack.py 重新编译（读到的入口：workspace/tmp/e2e/rig-base/index.json）
```

**② 文案只说「请重新编译」，但打开的可能只是测试夹具**

`workspace/tmp/e2e/` 与 `step2/handoffs/` 下的旧包是**测试夹具**，没有需要编译的东西。这条没有改 —— 因为文案本身区分不出「真包」与「夹具」，改动风险大于收益。记在这里作为已知局限。

### 诊断过程中的两次自我纠错

**① 断言放错模块**

第一次把旧格式断言插到 `selftest.js` 第 2254 行附近，那里 `parseIndexText` 属于 **`SpineVoice`**（语音索引），不是 `SpineBundle`。测试红了 2 条，失败标签是 `[core] (voice)`，而 `SpineBundle` 段用的是变量 `B`（第 662 行）、`SpineVoice` 段用 `V`（第 1840 行）。

挪到 `buildLocalTree` 旧包断言之后（`B` 作用域），全绿。

**② 一条「假守卫」**

我设计的变异 M2（把旧格式分支提到 manifest 检测之前，期望 v3.2 包被误判）**变异后仍然全绿** —— 因为两个探测函数的字段集互斥：

```js
looksLikeManifest:    "manifestSchemaVersion" || "packFormatVersion" || (spine && render && !files)
looksLikeLegacyIndex: "schemaVersion" && "files"
```

v3.2 manifest 根本没有 `schemaVersion`/`files`（真实包验证：`files in o: false`），所以顺序无关紧要，那条反向断言只是文档性的，不构成真实故障。

如实记录：3 条断言里 **1 条是真守卫**（删掉旧格式分支 → 2 条 FAIL），1 条是文档性断言。

### 验证

```
node --check app.js / bundle.js / selftest.js   0
selftest-node.mjs                              3532/3532（core 1205，+3）
bump-editor-version.mjs --check                0（0.9.60）
verify_pack_v3   PASS 39 / FAIL 0 / BLOCK 1（原有 planned 序列）
verify_catalog   17 条全 PASS，可进发布区
check_frozen_spine  5/5
```

**浏览器实测**：

```
当前包   version 0.9.60  notices []  loaded true  slots 38  groups source=meta count=7
旧包     （读到的入口：workspace/tmp/e2e/rig-base/index.json）  ← 新增信息
```

**变异测试**：

| 变异 | 结果 |
| --- | --- |
| M1 删掉旧格式分支 | 2 条 FAIL ✅ 真守卫 |
| M2 旧格式分支提到 manifest 之前 | 仍全绿 ❌ 假守卫（字段集互斥，该顺序不构成故障） |

还原后 `restore byte-identical: true`，基线 3532/3532。

### 给用户的直接结论

当前人物包没有问题。要恢复正**用带 `?index=` 的完整 URL 重新打开**：

```
http://127.0.0.1:8123/tools/character-editor/index.html?index=workspace/packs/deepseek/manifest.json
```

页面若还显示旧版本号，Ctrl+F5 硬刷新（`app.js` 按 `?v=<version>` 加载，版本变了才换脚本）。

## 0.9.59 — 修 `rig-meta.slotGroups` 未覆盖新槽（显示顺序回退平铺）（2026-11-11）

**用户反馈**：界面弹出一条警告 —— `rig-meta.slotGroups 不可用（slotGroups 校验未通过（未知/重复成员、未全覆盖、z 不连续或组序不对）），显示顺序回退为平铺列表`。

### 根因：0.9.41 拆出的 `嘴巴特效` 槽没登记进分组

`rig-meta.slotGroups` 是按**槽名枚举**的 7 个图层组。0.9.41 把 `mouth_嘘_气` 从 `嘴巴` 槽拆成独立的 `嘴巴特效` 槽（槽数 37 → 38），但分组没跟着加。于是：

```
model 槽数 38   分组覆盖 37   未覆盖：["嘴巴特效"]
表情组 idx[26,37]  → 组里只有 10 个槽，却横跨 12 个索引 → 非连续 z 区间
```

两条失败（未全覆盖 + 表情组不连续）都源自这一个槽。「表情」组原本含 `嘴巴(26)` 与 `整眼_L(28)`，中间 27 空了出来。

编辑器的处置是**静默回退**：`normalizeGroups` 判定失败 → `validateGroups` 给出 reasons → 调用方回退成 38 行平铺列表，只弹一条黄色提示。所以分组视图一直失效，但没人发现 —— 因为没有测试覆盖这件事。

### 修法：两处都改

| 位置 | 改动 |
| --- | --- |
| `build_rig.py` 的 `SLOT_GROUPS`（源头常量） | 表情组加 `"嘴巴特效"`，放在 `嘴巴` 之后（组内按 model 索引递增，`build_rig.py` 注释里定的规矩） |
| `handoffs/rig/rig-meta.json`（当前生效的那份） | 同步同样的改动 |

只改 JSON 不够 —— 下次重建 rig 会从 `SLOT_GROUPS` 重新生成，又退回 37 槽分组。

### 诊断时我自己判错了一次

第一版诊断脚本把组序判据写成 `min <= prevMax`，于是判定「7 个组全部重叠」。实际校验器用的是：

```python
prevMin = Infinity
for g in groups:
    if g.maxIndex >= prevMin: 报重叠
    prevMin = g.minIndex
```

即「本组 max < 上一组 min」。正确判定下 7 个组全部合法：

```
表情(26–37) → 头发(19–25) → 脸部(16–18) → 服装(5–15) → 身体(2–4) → 尾巴(1) → 后发(0)
```

**组顺序本来就是对的**，只有「未覆盖 + 不连续」两条真问题。

### 补回归断言（7 条）

在 `selftest-timeline.js` 的真实 rig 段新增，直接校验最终产物：

1. 全模型每个槽都被某组覆盖
2. 无重复成员
3. 无未知槽名
4. 每组是连续 z 区间
5. 组序前→背严格递减
6. 表情组含 `嘴巴特效`
7. `rig-meta.json` 可解析

这组断言的真正价值：**它是唯一能抓住「加了槽却忘了加进分组」的地方**。这次的问题从 0.9.41 潜伏到现在，界面上只表现为一条可关闭的黄色提示。

### 验证

```
node --check app.js / selftest-*.js   0
selftest-node.mjs                    3529/3529（timeline 292，+7）
bump-editor-version.mjs --check      0（0.9.59）
py_compile build_rig.py              0
verify_pack_v3   PASS 39 / FAIL 0 / BLOCK 1（原有 planned 序列）
verify_catalog   17 条全 PASS，可进发布区
check_frozen_spine  5/5
```

**浏览器实测**：

```
notices: []                      ← 警告消失
hasSlotGroupsWarning: false
slotGroupsSource: "meta"         ← 用的是分组，不再回退
reason: ""
七组全部 partial:false
表情组 size 12，z 26–37
```

### 变异测试（4/4 全部被抓）

| 变异 | 结果 |
| --- | --- |
| R1 表情组删掉 `嘴巴特效` | 3 failed ✅（同时打破全覆盖 / 连续性 / 表情组含该槽） |
| R2 同一槽放进两个组 | 2 failed ✅ |
| R3 组里写不存在的槽名 | 1 failed ✅ |
| R4 组顺序整体倒过来 | 1 failed ✅ |

## 0.9.57–0.9.58 — 按贴图实际像素重排呆毛与尾巴骨（2026-11-11）

**用户反馈**：尾巴中间那根还是偏上；呆毛骨骼方向反了。并附了一张手绘红线的截图说明预期走向。

### 根因：一直在往「网格矩形的中心」放骨，而不是「贴图里画的东西」

这两个附件都是**矩形四边形网格 + 整张贴图摊上去**：

```
呆毛     region 223×214   UV 范围 u[0.0022, 0.9978] v[0.0023, 0.9977]  → 铺满
鲸鱼尾巴 region 371×209   UV 范围 u[0.0013, 0.9987] v[0.0024, 0.9976]  → 铺满
```

UV 从 0 铺到 1，所以网格几何中心 = 贴图矩形中心。但**贴图里画的呆毛/尾鳍只占其中一部分**，而且形状是弯的。往矩形中心放骨，自然「偏上」「方向反」。

第二层原因：`呆毛` region 里除了呆毛本体，**还画着背后的花发带**。用 `alpha > 40` 筛像素会把两者都算进去（发带占 87%），中轴路径沿发带走 —— 骨链就横挂在头顶上。

### 三个关键改进

**① 用颜色阈值把呆毛本体单独分离**

呆毛是高饱和蓝紫，花发带是低饱和灰白：

| 内容 | RGB | b − r |
| --- | --- | --- |
| 呆毛 | (91,114,209) | 118 |
| 呆毛 | (55,69,143) | 88 |
| 花发带 | (126,135,169) | 43 |
| 花发带 | (114,123,164) | 50 |

判据 `alpha > 60 && (b − r) > 70` 后，呆毛本体只占 region 像素的 **13%**（6317 / 47722），形状干净分离。

**② 栅格化 + 距离变换 + Dijkstra 求真正的中轴路径**

把可见像素栅格化成 mask → 倒角距离变换 → 用 `1/(厚度+0.6)` 作代价的 Dijkstra 找「最厚那条路」。结果与用户手绘红线一致：

```
呆毛中轴（弧长 254.3）  锚点 (-145.9, 1070) / (-47.9, 1099) / (-4.9, 1013)
尾巴中轴（弧长 360.8）  锚点 (145.4, 192.9) / (233.7, 143.7) / (335.4, 144.8)
```

**③ 给每根骨设置 rotation 与 length（之前全是 0）**

这是「方向反了」的另一半原因：三根骨的 `rotation` 全是 0，每根都朝正右方，连起来必然是折线而不是弧。Spine 里骨的方向由 `rotation` 决定，位置对了但方向不对，看起来就是反的。

现在每根骨：位置 + 朝向下一根 + `length = 到下一根的距离`，形成真正贴在弧上的骨链：

| 骨 | 世界位置 | 世界朝向 | 局部 rotation | length |
| --- | --- | --- | --- | --- |
| `ahoge` | (-4.9, 1013) | 116.6° | 116.565 | 96.151 |
| `ahoge-2` | (-47.9, 1099) | -163.5° | 79.919 | 102.201 |
| `ahoge-3` | (-145.9, 1070) | -163.5° | 0 | 30 |
| `tail-1` | (105.8, 218.5) | -34.7° | -34.673 | 150.29 |
| `tail-2` | (229.4, 133.0) | -7.3° | 27.401 | 150.107 |
| `tail-3` | (378.3, 114.0) | -7.3° | 0 | 30 |

根在右端（贴 head）、梢在左端 —— 与用户红线一致。局部 rotation 都归一到 `(-180, 180]`（出现了 −280° 这种越界值，已夹取）。

### 权重算法：按「到骨线段距离」而非「到骨原点距离」

第一版按「最近两根骨的原点、距离平方反比」分配权重。形变检查发现 **`ahoge-2` 转 −20° 时有 2 个三角形翻转**、最小面积比 0.059（接近塌陷）—— 这是撕裂前兆。

原因：拱形中段到两根骨的原点距离接近，权重在相邻顶点间**突变**。

改成「到**骨线段**的距离 + 取最近 3 段 + `1/(d+8)²`」后：

```
ahoge     ±20°  翻转 0  面积比 1.000
ahoge-2   ±20°  翻转 0  面积比 0.799 / 0.697    ← 原来 2 翻转 / 0.059
ahoge-3   ±20°  翻转 0  面积比 0.856 / 0.850
```

权重表也是平滑的（拱顶 `ahoge-2:0.782`，向两端渐变到 `ahoge-3:0.447`，无突变）。

### 验证

```
node --check app.js                    0
selftest-node.mjs                     3522/3522
bump-editor-version.mjs --check       0（0.9.58）
compile_pack.py                       0
verify_pack_v3   PASS 39 / FAIL 0 / BLOCK 1（原有 planned 序列）
verify_catalog   17 条全 PASS，可进发布区
check_frozen_spine  5/5
```

**位置判据**（不靠肉眼）：

```
呆毛本体可见范围  x[-170.1, 3.8]  y[991.7, 1117.2]
ahoge    最近可见像素 0.78  在范围内 ✅
ahoge-2  最近可见像素 0.16  在范围内 ✅
ahoge-3  最近可见像素 0.65  在范围内 ✅
```

三根骨都压在呆毛本体的像素上。

### 过程中的失败尝试（记录下来免得再走）

1. **PCA 主轴拟合** —— 给出「呆毛主轴 −5°」和三锚点几乎在一条水平线上，与真实的拱形完全不符。这两个形状是**弯的**，直线主轴必然错。
2. **按 y 分带取 x 中位** —— 呆毛是宽扇面且内部有洞，同一带里中位在 −152 / −27 / −106 之间跳，均值也不稳。
3. **只看 alpha** —— 把背后占 87% 的花发带算进去，中轴跑到发带上。
4. **用矩形几何中心** —— 就是这次被用户指出的「偏上」「方向反」。

## 0.9.55–0.9.56 — 呆毛补骨、尾巴骨归位、冻结基线更新（2026-11-11）

**用户要求**：更新基线；修正两个骨骼问题 —— 呆毛骨骼缺失、尾巴中间的骨头没在材质中央。

### 呆毛：一根骨管 222×213 的网格，且骨偏在右侧

改前：

```
呆毛网格世界包围盒  x[-193.5, 28.5]  y[949.5, 1162.5]   （222 宽 × 213 高）
ahoge 骨位置        (-27.5, 976)
```

- 整片呆毛只有 `ahoge` 一根骨（+ `head` 做根部混合），无法弯曲
- 骨的 x 在 −27.5，而网格水平中心是 (−193.5+28.5)/2 = **−82.5** —— 偏右 55 单位

补成三段链（新增 `ahoge-2` / `ahoge-3`，父级依次挂接），并把 `ahoge` 移到水平中心。

### 尾巴：中间那根不在中轴

用「该处自身边距 / 局部最大内切半径」比值判定，`tail-2` 是全场最该修的一根。

### 关键技术：挪骨必须同步重算顶点，否则材质会变形

这两个附件都是**加权网格**，顶点坐标存在**骨局部空间**。直接挪骨会让材质跟着变形 —— 那就不是"修骨骼"而是"改外观"。

做法：对每个顶点算出它当前的**世界位置**，再对新骨世界矩阵反解出新的局部坐标。因为加权网格的顶点世界位置 = `Σ wᵢ · (Wᵢ · localᵢ)` 且 `Σwᵢ = 1`，这个反解能保证**静止姿态逐顶点不变**。

实测：
```
静止姿态全模型最大顶点位移  4.0e-7   （顶点保留 6 位小数的量化误差）
```

呆毛额外做了**权重重分配**（从 `ahoge`+`head` 两根变成三根中最近的两根，按距离平方反比），同样保持世界位置不变。

### 结果

| 骨 | 改前位置 | 改后位置 | 到边界（改前 → 改后） |
| --- | --- | --- | --- |
| `ahoge` | (-27.5, 976) | (-82.5, 958) | 8.5 → 8.5（发根，故意不动） |
| `ahoge-2` | 新增 | (-100.5, 1042) | — → **92.5** |
| `ahoge-3` | 新增 | (-59.5, 1090) | — → **72.5** |
| `tail-1` | (100, 250) | 不变 | 18.0（根骨，故意不动） |
| `tail-2` | (213, 185.4) | (192, 173.4) | 82.6 → **94.9** |
| `tail-3` | (330, 140) | 不变 | 81.3（级联修正后复位） |

**根骨为什么不动**：`ahoge` 是发根、`tail-1` 挂在 `hips` 上 —— 把它们挪到材质正中会拉断骨链，动画时整条肢体甩出身体。判据里的"局部最大内切点"在根骨处会给出不合理的远距离建议（`tail-1` 那条 Δ=(93,−12) 就是），必须人工判断取舍。

**级联修正**：`tail-2` 挪动后，子骨 `tail-3` 的世界位置被带走 20 单位（81.3 → 68.6）。反解 `tail-3` 的新局部坐标让它复位到 (330, 140)，距离回到 81.3。

### 过程中的四次自我修正（这一轮错得比较多）

**① 用错「点在网格内」的边界判定，导致所有位移数字不可信**

第一版算"到边界距离"时把**所有三角形边**都算进去了 —— 包括网格内部的细分线。于是：

```
呆毛是 6×4 网格（列间距 ~44），任何格内点最多离最近内部线 ~22
→ 算出「最大内切半径 18.64」（真值是 105）
→ 算出「骨头贴边 2.58」（其实是"贴近某条内部细分线"）
```

**误导后果**：我据此把尾巴三根骨挪到了「每个格子中央」，把 `tail-2` 从真正的中轴（边距 98.42）挪到了边距 84.90 的位置 —— **改坏了**。

修正：只提取**边界边**（只被一个三角形使用的边）。真值：

```
呆毛 最大内切半径 105.00   尾巴 最大内切半径 102.87
```

**② 拿过期数据做对比**

验证脚本标签写着「原始位置」，打印出来却是 92.5 / 202.5 / 314.5（我改后的值）。因为只还原了 handoff、**没重新编译**，pack 里仍是被改坏的尾巴。教训：验证脚本必须确认读的是哪个版本，不能信标签。

**③ `world` 索引与 `raw.bones` 顺序不一致**

`pose.world` 是按**解析后 model.bones** 的顺序，我直接拿它当 `raw.bones` 的索引 —— 两边不同序，取到的是别的骨（甚至 `undefined`，报 `Cannot read properties of undefined`）。改成建立 `rawIdx ↔ modelIdx` 映射表。

**④ 顶点精度不够，过了不自己的门禁**

第一版顶点局部坐标只保留 4 位小数，位移 6.4e-5，被我设的 1e-6 门禁拦下。提到 6 位后降到 4.0e-7。（6.4e-5 单位 = 0.000064 像素，视觉无差异，但这个包要长期用，不留可累积误差。）

另外脚本里还有两处低级错误：`for (const mv of ORDER)` 把字符串数组当对象用（`mv.name` 是 undefined）；以及 `MOVES`/`ORDER` 两个变量重复定义。

### 冻结基线更新

`check_frozen_spine.py` 从 2/5 恢复到 **5/5**。基线里 `model.json` 的哈希已更新到当前值。

**关于 `model.atlas` / `rig-meta.json` 的说明**：这两个文件在我动手前的基线里就已经是 DIFF 状态（时间戳证据：基线建于 `11/11 0:48`，而 0.9.41 的附件改名备份在 `0:47` —— 改名完成后这两个文件就变了，基线没跟上）。本轮已一并更新，现在 5 个文件全部对齐。

### 验证

```
node --check app.js / selftest-*.js   0
selftest-node.mjs                    3522/3522
bump-editor-version.mjs --check      0（0.9.56，47 处 ?v= 同源）
py_compile serve.py / compile_pack.py 0
verify_pack_v3   PASS 39 / FAIL 0 / BLOCK 1（原有 planned 序列阻断）
verify_catalog   17 条全 PASS，可进发布区
check_frozen_spine  5/5 一致
```

浏览器实测（43 骨 / 4 条 IK）：

```
呆毛  ahoge (-85.7, 952.8) / ahoge-2 (-96.8, 1037.2) / ahoge-3 (-52.2, 1081.4)
尾巴  tail-1 (100, 250) / tail-2 (190.4, 171.5) / tail-3 (325, 126.3)
```

## 0.9.54 — 给人物包补 IK：骨长 + 4 条约束 + FK/IK 配色（2026-11-11）

**用户要求**：把骨长和 IK 都做完，「我希望能看到 FK 骨是蓝色而 IK 骨是绿色，能显示这两种骨骼」，并且「这个 IK 骨要是真的能用的」。

### 改动前的事实

直接读 `workspace/packs/deepseek/spine/model.json`：

```
bones: 37 根，length > 0 的：0 根        ← 全部骨长都是 0
constraints / ik: 缺失                    ← 没有任何 IK 约束
```

编辑器里六条候选链逐条测试，全部被同一原因拒绝：

```
hand-L / hand-R / foot-L / foot-R / hair-back-3 / tail-3
→ CHILD_LENGTH_ZERO：选中骨 length=0：两骨 IK 需要末端骨有长度（本 rig 骨长全为 0 时不可用）
```

`spine-core.js` 的 `ikSolve` 里写着硬门槛：

```js
var L2 = childBone.length * Math.abs(csx) * Math.abs(psx);
if (!(L1 > 1e-6) || !(L2 > 1e-6)) {
  issues.push(ikIssue(constraint, "ik.zeroLength", "骨链长度接近 0，保留 FK"));
```

—— 补骨长不是可选项，是 IK 能不能算的前提。

### 骨长不是拍的，是从现有几何反推

求解器的两个量：`L1 = hypot(child.x, child.y)`（父→子偏移，数据已有）、`L2 = child.length`（要补的）。所以长度取「该骨到其直接子骨的局部距离」：

| 骨 | 计算 | 值 |
| --- | --- | --- |
| `upper-arm-L/R` | hypot(−48,−87) / hypot(42,−92) | 99.363 / 101.134 |
| `forearm-L/R` | hypot(−43,−76) / hypot(43,−80) | 87.321 / 90.824 |
| `thigh-L/R` | hypot(−16,−95) / hypot(16,−95) | 96.338 / 96.338 |
| `shin-L/R` | hypot(6,−70) / hypot(−6,−70) | 70.257 / 70.257 |

### 链选择：必须是「上臂→前臂」而不是「前臂→手」

查槽位绑定发现关键事实：

```
hand-L / hand-R / foot-L / foot-R   （无槽）      ← 四肢末端没有贴图
upper-arm-L: 手臂_左   upper-arm-R: 手臂_右        ← 贴图挂在**上臂**骨
```

如果链用 `[forearm, hand]`，转的是前臂和手 —— **贴图一点不动**，视觉上只有骨头在转。所以链必须是 `[upper-arm, forearm]` / `[thigh, shin]`：IK 转上臂时整条手臂贴图跟着转。

### target 位置：摆在「数学末端」上，这样开 IK 不跳

求解器的末端位置 = `childOffset + L2·(cos θ, sin θ)`。这套骨架的前臂是斜的（`(−48,−87)`，约 −119°），与 `hand-L` 的实际位置差 160 单位。若把 target 摆在实际手部，`mix=1` 时手臂会被瞬间拉直。

所以 target 必须落在这个**数学末端**上 —— 此时 FK 姿态本身就是 IK 的一个解（不动点），`mix` 从 0 拉到 1 骨不动；之后拖 target 才让肢体跟随。

| 约束 | 链 | target（挂 hips） | 数学末端（世界） |
| --- | --- | --- | --- |
| `ik-arm-L` | upper-arm-L → forearm-L | (−60.679, 33) | (−60.679, 433) |
| `ik-arm-R` | upper-arm-R → forearm-R | (215.324, 35) | (215.324, 435) |
| `ik-leg-L` | thigh-L → shin-L | (−5.743, −235) | (−5.743, 165) |
| `ik-leg-R` | thigh-R → shin-R | (141.257, −235) | (141.257, 165) |

实测四条链的 target 与 FK 末端**距离全为 0**。

### 安全性：手臂/腿的骨没有被任何动画 key

| 骨组 | 被 key 的动画数 |
| --- | --- |
| 手臂（upper-arm/forearm/hand L+R） | **0** |
| 腿（thigh/shin/foot L+R） | **0** |
| 头发 / 尾巴 | 1（idle） |

所以给手臂和腿开 `mix=1` **不会覆盖任何现有动画的 FK 旋转**，21 个动画不受影响。头发和尾巴被 idle 驱动，不动。

### 配色：FK 蓝、IK 绿

新增常量（`app.js`）：

```js
const BONE_FK_COLOR        = "#5aa9ff";   // FK 骨：蓝
const BONE_IK_COLOR        = "#4ec9a5";   // IK 受控骨：青绿
const BONE_IK_TARGET_COLOR = "#f57785";   // IK target：粉
const BONE_IK_LABEL_COLOR  = "#8ee6c8";   // IK 骨名文字
```

原来 IK 骨用 `#f0b429` 琥珀 —— 这个色在这套 UI 里同时用于「未求值」「曲线段」「洋葱皮 after」，**标 IK 骨根本分不出来**。换成青绿后色相差足够大。六处引用全部改（骨线 / 关节点 / target 十字 / 骨名文字 / 约束标签）。

像素级验证：按 `#4ec9a5`（78,201,165）做确定性识别，命中 **933 个前景像素、21 个候选区域**，集中在手臂与腿的位置。

### 数据改法：外科手术式插入，不整份重写

原文件格式：CRLF、2 空格缩进、7655 行、数字带小数点（`0.0` / `400.0` / `0.29999998211860657`）。若用 `JSON.stringify` 整份重写会缩进变 1 空格、`0.0`→`0`，几千处无意义 diff。

改用文本级插入：只给 8 根骨各加一行 `"length"`、bones 数组尾部追加 4 个对象、末尾追加 `"ik"` 段。**diff：7655 行里只有 112 行变化，全部是纯增量。**

### 过程中的三次错误

**① 键名写错：`constraints` → `ik`**

我从编辑器内部对象 `model.constraints` 反推 JSON 键名，写成了 `"constraints"`。`spine-core.js` 读的是 `readArray(ctx, raw, "ik", ...)` —— Spine 4.x 的格式里 IK 就放在 `"ik"` 数组。**把「运行时结构」当成了「文件格式」**。表现是加载成功但 `ikConstraints: 0`。

**② 测试方法错：改数据不重算 pose**

第一版测试直接改 `state.model.bones[i].x` 然后 `render()`，两次读数当然一样 —— `render()` 只重绘画面，pose 由 `evalPose` 算。改用 `SpineCore.evalPose()` 才拿到真实求解结果。

**③ 编译器有实现遗漏，导致 0.9.41 的欠账一直没暴露**

跑 `compile_pack.py` 时报 `all_completed: expression 键集合与 catalog 不符 ['嘴巴特效']`。查下去是三处代码对「可选部位」的理解不一致：

| 位置 | 声明 | 实际 |
| --- | --- | --- |
| `compile_pack.py` 第 60 行注释 | 「嘴巴特效是**可选**部位」 | — |
| 第 68 行 `OPTIONAL_EXPR_KEYS` | 定义了 | — |
| 第 171 行校验 | — | `set(expr) != dict_keys` **严格相等**，完全没用可选集 |
| `build_catalog_body()` | — | **从不写 `optional` 字段** |
| `verify_pack_v3.py` E3 | 靠 `expressionParts[k].optional` 判定可选 | 读不到 → 认为 8 个全必填 |

即：**「可选」只在生成器内部知道，产物里丢了**。运行端也因此无法判断。

修了三处：
- `validate_events_against_assets`：改为「必需键齐全 + 不含未知键」
- `build_catalog_body`：`嘴巴特效` 产出时带 `"optional": true`
- 结果：`E3 PASS  req=[7 个] opt=['嘴巴特效']`

**顺带修掉 0.9.41 的遗留欠账**：`src/events.json` 里有 3 个事件（`long_idle` / `reconnected` / `task_timeout`）写着 `嘴巴: mouth_嘘_气`，但该附件在 0.9.41 已搬到 `嘴巴特效` 槽 → 指向失效。改为 `嘴巴: null` + `嘴巴特效: mouth_嘘_气`（**外观不变**，只是挂到正确的槽）。

### 权威位置：handoff 源，不是 pack 产物

`compile_pack.py` 头部写明分层，且 `SPINE_FILES` 是从 `step2/handoffs/rig/` **原样复制**：

```
源（人编辑、权威）  step2/src/            events.json, pack.json
派生输入（非源）    step2/handoffs/rig/   model.json / atlas / png / rig-meta / lipsync
产物（可重建）      workspace/packs/…    ← 手改这里下次编译会被覆盖
```

所以 IK 同步到了 handoff（`model.json` 两边现在同哈希 `d2167860`），并跑编译验证。`detect_hand_edited_product` 的 `probe_keys` 只含 `events.json / manifest.json / catalog.json`，**不含 model.json** —— 直接改 pack 的 model 不报错，但会被下次编译抹掉。

### 验证

```
node --check app.js / selftest-*.js           0
selftest-node.mjs                            3522/3522（+5 条结构断言）
bump-editor-version.mjs --check              0（0.9.54，47 处 ?v= 同源）
py_compile serve.py / compile_pack.py        0
verify_pack_v3.py                            PASS 39 / FAIL 0 / BLOCK 1（原有 planned 序列）
verify_catalog.py                            17 条全 PASS，可进发布区（C13 哈希对齐）
```

**浏览器真实模型实测**（41 骨 / 38 槽 / 21 动画）：

```
diag: ikConstraints=4  ikNames=[ik-arm-L, ik-arm-R, ik-leg-L, ik-leg-R]
      ikTargets=4  restricted=[]  未求值=0

四条链拖 target（+25/+18）：
  ik-arm-L  末端↔target 0 → 0   子骨旋转 +0.822°   跟随 ✅
  ik-arm-R  末端↔target 0 → 0   子骨旋转 −15.875°  跟随 ✅
  ik-leg-L  末端↔target 0 → 0   子骨旋转 −1.036°   跟随 ✅
  ik-leg-R  末端↔target 0 → 0   子骨旋转 −8.020°   跟随 ✅
```

**过时断言的处理**：`selftest-timeline.js` 里 `eq("真实 rig 骨数", 37)` / `eq("真实 rig 槽数", 37)` 是硬编码 —— 而旁边注释自己写着「不再钉死全量名单」。槽数从 0.9.41 起就该是 38（一直没跟上），骨数加 IK 后是 41。改成结构性校验（骨名唯一 / parent 存在 / 槽的 bone 存在 / IK 引用的骨与 target 存在 / 两骨必须直接父子 / IK 子骨有 length），数字断言保留为「改动是否被同步」的提示。

## 0.9.53 — 工具条分区标题与拖拽位置（2026-11-11）

**用户要求**：拖拽移到「选择」下面；左侧工具条分两个区，各加小标题「操作」「视图控制」，加在分割线的左上方。

### 结构

```
[工具]  ← 伸缩开关
操作                ← 分区标题（左对齐）
────────────────
选择 Q / 拖拽 H / 移动 V / 旋转 R / 缩放 S / 指向 W
视图控制            ← 分区标题（左对齐）
────────────────
放大 + / 缩小 − / 适应窗口 F
```

拖拽从「指向」之后挪到「选择」正下方，归入**操作**区；视图控制区留放大/缩小/适应窗口。

### 关键约束：收起态放不下标题

导轨收起态只有 **44px**，标题「视图控制」四个字塞不进去。所以标题必须：
- 展开态：显示文字（`max-width: 96px` + `opacity: .72`）
- 收起态：隐形，**高度 0**、`max-width: 0`、`opacity: 0`

沿用 `.rail-label` 那套 `max-width + opacity`（**不能**用 `display: none` —— display 不可过渡，`none→block` 时展开动画不会触发）。收起态的分组信息由那条**分隔线**承担。

窄屏（≤960px）导轨是横排的，此时整个标题隐藏 —— 横排里插两行竖排文字会把高度撑爆。

实测：
```
展开态：标题宽 131 / 高 18 / textMaxW 96px / opacity 0.72
收起态：标题宽 36  / 高 0  / textMaxW 0px / opacity 0
       导轨宽 44px（没被撑破）
```

### 过程中的两次自我修正

**① 移动脚本"假成功"**

第一版用 `s.replace(panBtn, '')` 移按钮，然后无条件 `console.log('moved')`。`String.replace` 在**匹配不上时不报错、原样返回** —— 两处都没匹配上（我从 `read` 看到的渲染结果与实际字节有差异），脚本却照样打印"已移动"，文件顺序完全没变。

改成**行号级操作**（`blockOf(id)` 定位 `</button>` 结束行 → splice 摘出 → splice 插入），并在写入后**重新读盘校验**：

```
select at 133 / pan at 136 / pan after select: true
```

**② 断言用裸文字定位，匹配到了注释**

Q2 那条断言验证「标题元素在分隔线之前」，最初写成 `htmlQ.indexOf('操作')`。但「操作」这两个字在文件里出现多次（注释、帮助文案里都有），`indexOf` 命中**注释里第一处**，与标题元素无关 —— 把标题元素挪到分隔线之后，断言照样绿。

改成匹配**元素本身**（`rail-group-text">操作`）后才变红。同类坑这轮已踩过两次（另一次是 `请切到绑定姿态` 匹配到了说明「第一版写错了」的注释）。

### 验证

```
node --check app.js / selftest-eventnames.js   0
selftest-node.mjs                             3517/3517（event-names 253/253，+18 条守卫）
bump-editor-version.mjs --check               0（0.9.53，47 处 ?v= 同源）
```

浏览器实测（展开态 / 收起态各一遍）：

```
railChildren 顺序：railToggle → 操作标题 → sep → 选择 → 拖拽 → 移动 → 旋转 → 缩放 → 指向
                  → 视图控制标题 → sep → 放大 → 缩小 → 适应窗口  ✅
展开态标题：宽 131 / 高 18 / opacity 0.72 ✅
收起态标题：宽 36  / 高 0  / opacity 0     ✅   导轨 44px 未撑破
```

### 变异测试（5/5 全部被抓）

| 变异 | 结果 |
| --- | --- |
| Q1 拖拽挪回「指向」之后 | 6 failed ✅ |
| Q2「操作」标题挪到分隔线之后 | 1 failed ✅（修正断言前是假守卫） |
| Q3 删掉「视图控制」标题 | 3 failed ✅ |
| Q4 标题文字改用 `display:none` 收起 | 2 failed ✅ |
| Q5 收起态标题高度改成 18px | 1 failed ✅ |

### 帮助文案

左侧工具条那行重写为分组描述：`操作` = Q 选择 · H 拖拽 · V/G 移动 · R 旋转 · S 缩放 · W 指向；`视图控制` = + 放大 · − 缩小 · F 适应窗口；并说明「分区名在展开态显示，收起态（44px）只留分隔线」。

## 0.9.52 — 拖拽改成开关：再点一次退出（2026-11-11）

**用户反馈**：拖拽应该可以再点一次退出拖拽模式 —— 在这个模式里能拖画布，不在就拖不动。

### 改动前的问题

拖拽只有进入路径，没有退出路径：

| 入口 | 改动前 |
| --- | --- |
| 工具栏按钮 | `setTool("pan")` —— 只进不出 |
| `H` 键 | 同上 |
| 编辑菜单「平移」 | 同上 |
| 退出方式 | **只能**按 V / 点别的工具 |

画布那边判断是 `state.spaceDown || state.tool === "pan"` → 走 `beginPan`。所以只要 `state.tool === "pan"` 挂着，左键拖动就是拖视野、选不中部件 —— 却没有一个"关掉它"的显式操作。

### 改法

把 `setTool("pan")` 变成开关，记住进入前的工具：

```js
if (tool === "pan" && state.tool === "pan" && !o.force) {
  const back = state.toolBeforePan === "select" ? "select" : "move";
  state.toolBeforePan = null;
  state.tool = back;
  ...
}
if (tool === "pan" && state.tool !== "pan") {
  state.toolBeforePan = state.tool === "select" ? "select" : "move";
}
```

**退出还原到进入前的工具，而不是固定回「移动」**：用户可能正停在「选择」（只想点选），按 H 进去拖一下视野再按 H 出来，直接落到「移动」会把他的选择意图冲掉。`toolBeforePan` 只记 `move` / `select`（其余编辑工具在 `state.edit.tool` 里，不受影响）。

三个入口（按钮 / `H` 键 / 菜单）现在都走同一个 toggle，语义一致。

顺带统一了文案：编辑菜单原来叫「平移」，按钮叫「拖拽」，两处不一致 —— 菜单项改为「拖拽」，快捷键标注从 `Space` 改为 `H`。

### 新增接口

`__characterEditor` 里 `setTool` **已经指向 `setEditTool`**（编辑工具 translate/rotate/scale/pose），与工具栏的 drag/select 是两套概念、名字撞了。所以拖拽单独给一组明确命名的句柄：

| 接口 | 说明 |
| --- | --- |
| `panMode()` | `{active,returnTo,currentTool,canDragCanvas,hint}`；**非拖拽态 `returnTo` 为 `null`** |
| `togglePan()` | 切一次 → `{active,changed,tool,returnTo}` |
| `setPan(on)` | 幂等设置，重复调用 `changed:false` |

`panMode().returnTo` 第一版写成 `state.toolBeforePan || "move"`，退出后字段已清空却仍报 `"move"`，而当前工具可能是「选择」——读到的值和实际状态对不上。改成按 `active` 三元判定，并补了 `currentTool` 让两件事分开表达。

### 验证

```
node --check app.js / selftest-eventnames.js   0
selftest-node.mjs                             3499/3499（event-names 235/235，+23 条守卫）
bump-editor-version.mjs --check               0（0.9.52，47 处 ?v= 同源）
```

浏览器实测（真实包 38 槽 / 37 骨）：

```
起点「移动」→ 点拖拽 → 拖拽高亮, cursor=grab, canDragCanvas:true
            → 再点一次 → 回到「移动」, cursor=default, canDragCanvas:false ✅
起点「选择」→ 点拖拽  → returnTo:"select" ✅
            → 再点一次 → 回到「选择」（不是移动）✅
键盘 H      → 进出两次都正确 ✅
togglePan() → active 往返正确，退出后 returnTo:null ✅
setPan(true)→ 连续两次 changed:true / changed:false（幂等）✅
```

**画布行为实测**（`pointerdown` 的真实判据）：

| 状态 | `state.drag.mode` | `defaultPrevented` |
| --- | --- | --- |
| 选择模式 | `null` | `false`（命中部件） |
| 拖拽模式 | `"pan"` | `true`（拖动视野） |
| 退出后 | `null` | `false`（回到命中部件） |

### 变异测试（7/7 全部被抓）

| 变异 | 结果 |
| --- | --- |
| P1 去掉 toggle 退出分支 | 1 failed ✅ |
| P2 退出固定回 `move` | 1 failed ✅ |
| P3 进入时不记 `toolBeforePan` | 1 failed ✅（修正断言前是假守卫） |
| P4 `panMode.returnTo` 去掉 `active` 判断 | 1 failed ✅ |
| P5 菜单 label 改回「平移」 | 2 failed ✅ |
| P6 帮助里删掉「拖拽是开关」 | 2 failed ✅ |
| P7 删掉 `togglePan` 导出 | 1 failed ✅ |

> **P3 修正**：断言原来是 `/state\.toolBeforePan\s*=/` —— 只要求"有个赋值"。但 `setTool` 里有两处赋值（退出分支 `= null`、进入分支 `= state.tool === "select" ? … : "move"`）。变异把进入分支也改成 `= null` 后，退出分支那处依然能匹配，断言照样绿。改成断言**赋值右侧的具体形态**后才变红。

### 帮助文案

- 按钮 title：「拖拽（H）：点一下进入拖拽模式…再点一下或再按 H 退出，回到进入前的工具。按住 Space / 中键拖动是临时拖拽，松手即恢复」
- 工具条说明：补「拖拽是开关：点一下进、再点一下出（退出会回到进入前的工具）」
- 画布那行：分清**三种拖视野方式**（常驻按钮 / 按住 Space / 中键）
- `H` 快捷键：标明是开关

## 0.9.51 — 「平移视野」改名「拖拽」+ 工具选中态修复（2026-11-11）

**用户反馈**两件事：左边工具栏的「平移视野」应该叫「拖拽」；选中和没选中应该有明显的视觉提示。

第二件查下去发现是**真 bug**，不只是样式不够显眼。

### 真 bug：选择与拖拽两个按钮的选中态从未生效

`syncEditToolbar()` 里同步选中态的只有四个按钮：

```js
const btns = { translate: $("btnToolMove"), rotate: $("btnToolRotate"),
               scale: $("btnToolScale"), pose: $("btnToolPose") };
```

但「选择」走的是 `state.tool === "select"`（`setEditTool` 带 `selectOnly`），「拖拽」走的是 `state.tool === "pan"`（`setTool`）——**两者都不在这张表里**，所以它们的 `aria-pressed` 永远停在初始的 `false`：点了完全没反馈。

还有第二处：`setTool()` 只调 `syncToolbar()`，**没调 `syncEditToolbar()`** —— 而选中态是在后者里刷新的。所以点「拖拽」后连状态都不会更新。`setEditTool()` 那条路径恰好调了，所以只有拖拽有这个毛病。

修法：把 6 个按钮（移动/旋转/缩放/指向/选择/拖拽）统一按「当前工具」判定，同一时刻只亮一个；并在 `setTool()` 里补调 `syncEditToolbar()`。

### 改名

| 位置 | 改动 |
| --- | --- |
| 按钮 label | 平移视野 → **拖拽** |
| 按钮 title | 「拖拽（H / Space / 中键拖动）：按住画布拖动只移动视野，不改任何部件数据」 |
| 按钮 aria-label | 新增 `拖拽工具` |
| 画布提示条 | 按住 Space 平移 → 按住 Space **拖拽** |
| 画布 aria-label | 同步 |
| 帮助 · 左侧工具条 | `H` 平移视野 → `H` 拖拽 |
| 帮助 · 快捷键表 | `H` → 「拖拽（只移动视野，不改部件数据）」 |
| 帮助 · Space 行与脚注 | 播报暂停 / 拖拽 |
| 状态栏 | 「拖拽工具：按住画布拖动只移动视野，不改部件数据」 |
| README | 两处同步 |

`references/dsh-pets/` 下的上游副本未改动。

### 视觉强化：三次才对

选中的信号从 1 个加到 3 个：**实心蓝底 + 左侧白色竖条 + 字重加粗 + 冷色外发光**；未选中的降到 `opacity: 0.78`，把亮度差拉开。

竖条的做法改了三版，每版都是被实测否掉的：

1. **`::before { left: -6px }`** —— 挂在按钮外侧。被 `.tool-rail` 的 `overflow` 裁掉，只剩 1px 可见。
2. **`left: -4px`** —— 我以为「按钮 36px 居中在 44px 轨道里，左右各 4px，所以 -4 正好落在轨道左边缘」。**实测否掉**：收起态与展开态下按钮相对轨道的 `left` 都是 **0**，不是 4px。任何负偏移都会跑到轨道外。

   ```
   收起态: deltaBtn=0  beforeLeft=-4px  stripeDocX=-4  railDocX=0  →  visible:false
   展开态: deltaBtn=0  beforeLeft=0px   stripeDocX=0   railDocX=0  →  visible:true
   ```

3. **`inset box-shadow`** —— 把竖条画在按钮**内部**（`inset 3px 0 0 0 #fff`），不占布局、不受裁剪影响。收起态与展开态都稳定可见。

### 验证

```
node --check app.js / selftest-eventnames.js   0
selftest-node.mjs                             3476/3476（event-names 212/212，+22 条守卫）
bump-editor-version.mjs --check               0（0.9.51，47 处 ?v= 同源）
```

浏览器实测（收起态与展开态各测一遍）：

```
点 拖拽 → pressed=true, label=拖拽, bg=rgb(90,169,255), fontWeight=700, inset 白条 present ✅
点 选择 → pressed=true（修复前永远 false）✅
8 次连续点击 6 个按钮 → 每次恰好 1 个 pressed ✅
收起态：轨道 44 / 按钮 36 / 按钮居中 ✅   label max-width=0px（确实收起了）
```

### 变异测试（5/5 全部被抓）

| 变异 | 结果 |
| --- | --- |
| N1 拖拽改回平移视野 | 2 failed ✅ |
| N2 把 `railSelect` 从同步表删掉 | 2 failed ✅ |
| N3 把 `btnToolPan` 从同步表删掉 | 2 failed ✅ |
| N4 删掉 `setTool` 里的 `syncEditToolbar()` | 1 failed ✅ |
| N5 CSS 竖条改回 `::before` 负偏移 | 1 failed ✅ |

> N4 第一次是**变异方法写错**：我的替换只改了注释文字，`syncEditToolbar();` 那行原封不动，代码行为没变，所以测试自然全过。改成精确删除函数体内的调用后才变红。

## 0.9.50 — 移除整块「属性/检查器」与「调试」面板（2026-11-11）

**用户要求**：上面那块属性面板、下面那块调试面板，整个删掉（只删前端，后端功能不动）。

### 删了什么

| 面板 | 内容 | 能力去向 |
| --- | --- | --- |
| `#panel-inspector` | 标题「属性」+ 选中徽标 + **附件检查器** + **骨骼检查器** + **选中部件检查器** + **骨架结构面板** | 见下表 |
| `#debug` | 骨骼/IK 图例、网格、权重图例、未求值明细、表情三滑杆 + 四个预设 | `diagnostics()`（新增） |

### 删除前先补的 11 个接口

这一轮比 0.9.49 危险得多：上一轮删的两块本来就有接口兜着，这次里面挂着**七组**没有出口的能力。先补接口、后删 DOM：

| 新接口 | 复用的内部函数 | 替代的原 UI |
| --- | --- | --- |
| `selectSlot(indexOrName)` | `selectSlot` | 选中槽位（原来只有 `selectBone` 选骨） |
| `slotSelection()` | 读 `state.sel` | 检查器头部的槽位信息 |
| `slotVisible(i)` / `slotLock(i)` | `toggleHidden` / `toggleLocked` | 👁 / 🔒 按钮 |
| `layerMove(action)` | `moveLayer` | 上移/下移/置顶/置底（**置顶/置底原本完全没有界面以外入口**） |
| `slotRestore(i)` | `restoreSlot` | 恢复该部件 |
| `attachmentRestore()` | 原 `attReset` 点击逻辑 | 恢复附件 |
| `slotField(field, value)` | `applySlotNumber` / `applySlotField`（新拆） | 槽位 X/Y/旋转/缩放四个输入框 |
| `diagnostics()` | `ikState` / `attachmentAt` / `state.issueDetails` | 调试面板全部内容 |

### 三个实测抓出来的真问题

**① 槽位写入会拐去写骨骼（语义 bug，实测抓到）**

`applyInspectorNumber` / `applyBoneField` 开头都有：

```js
if (editTarget() === "bone") return applyBoneNumber(...)
```

界面在时这不是问题 —— 两条路径各有各的输入框，用户点哪个很清楚。但接口统一叫 `slotField` 之后就成了错：**名字说写槽位，实际可能写骨骼**。拆出 `applySlotNumber` / `applySlotField`，它们**必定**写 `state.bones[slot.boneName]`，绝不按 `editTarget` 分流。

**② 拒绝时不告诉原因**

`applyBoneField` 里 `if (state.anim || state.locked.has(slot.name)) return false;` —— 只回 `false`，调用方无法区分「参数错」和「锁住了」。改成 `slotWriteFail("ANIMATION_LOCKED: …")` 这类带原因的失败。

**③ 我给的错误建议**

`ANIMATION_LOCKED` 第一版提示是「请切到绑定姿态或改 Key」。实测证明**切到 setup 依然被拒** —— 原界面的锁是 `transformLocked = !!state.anim || locked`，只要选了动画就锁死，与 setup/animate 模式无关。提示改为「已选中动画「id」，槽位的旋转/缩放只读（与绑定姿态模式无关）；X/Y 仍可写」。

同时确认 X/Y 在动画模式**可以写**（原 `posX/posY` 只查 `dragBlockReason`，不查 anim），这条照搬对了。

### 删除策略：清空函数体而不是删函数

`syncInspector()` 有 **47 个调用点**、`syncDebug` 6 个、`syncMirrorPanel`/`syncIkPanel` 各 4 个、`syncSkeletonPanel` 3 个。全删调用点要改 ~70 处，每处还要区分 `syncInspector();`（可整行删）与 `return syncInspector();`（控制流不能动）—— 收益是省几十个空壳，风险是把 47 处控制流改错。

所以：**函数体清空 + 注释说明 + 保留函数名**。零风险，且函数体内不再触碰任何已删 DOM。

### 过程中的四次自我修正

1. **偏移基准算错，切坏了文件** —— 我在循环里每次都用**原始源码**算函数跨度，却往**已修改的文本**里替换。第一次替换后所有后续偏移全错，第二个函数从错误位置切开，把一个 `if/else` 劈成两半（`SyntaxError: Unexpected token 'else'`）。正确做法：**先算好全部跨度，再从后往前替换**。已从备份还原重做。

2. **正则字面量里写了双反斜杠** —— `\\(?` 让 `(?:` 缺右括号，导致**整个 `selftest-eventnames.js` 加载失败**。表现极具误导性：

   ```
   Character editor: 3264/3264 passed; 0 failed
   suites not loaded (file missing): event-names
   ```

   `failed: 0` 看着全绿，实际 190 条断言凭空消失。**「failed 为 0」不等于「测试都在跑」**，必须看套件清单和总数。

3. **断言扫到了自己的注释** —— 「提示不再给切到绑定姿态这条错建议」这条一直假失败，因为我说明「第一版写错了」的注释里正好留着这五个字。改成扫剥掉注释的 `codeG`。（同类坑上轮踩过一次，那次是注释导致假**通过**。）

4. **新接口一个断言都没写** —— 变异测试当场抓到 5 个假守卫：删掉 `slotField` / `diagnostics` / `selectSlot` / `layerMove` 的导出、把 `syncInspector` 恢复成写已删 DOM，测试全部一路绿灯。补了 24 条断言（接口存在性逐条断言 + 独立槽位写入存在 + 清空函数体不得触碰 DOM）。

### 保留了什么

部件列表（`#list`）、搜索框、显示顺序/骨骼层级切换、四个主分页（部件/台词/表情/动画）、时间轴、状态栏、`state.sel` 与画布拾取链路。

### 验证

```
node --check app.js / selftest-eventnames.js      0
selftest-node.mjs                                3454/3454（event-names 190/190，+24 条守卫）
bump-editor-version.mjs --check                  0（0.9.50，47 处 ?v= 同源）
py_compile serve.py                              0
```

**浏览器真实模型实测**（`workspace/packs/deepseek`，38 槽 / 37 骨 / 21 动画）：

```
inspector 子节点 = 分页标签 / partsView / 3 个分页 / foot   （属性块与调试块均不存在）
partsView 子节点 = 只剩部件列表   列表 38 行，高度 501px（没有被压扁）
selectSlot(5)        → {ok, index:5, name:"裙子", bone:"skirt"} ✅
slotField("x", 15)   → 写入成功，撤销回到 0 ✅
slotField("nope")    → FIELD_INVALID ✅
slotVisible / slotLock 往返翻转 ✅
layerMove("up")      → 5→6，undo+1 ✅   layerMove("sideways") → ACTION_INVALID ✅
diagnostics()        → 37 骨 / 0 IK 约束 / 3 网格 / 0 未求值 / 0 诊断 ✅
```

### 变异测试（8/8 全部被抓）

| 变异 | 结果 |
| --- | --- |
| M1 把 `panel-inspector` 加回 HTML | 1 failed ✅ |
| M2 把 `#debug` 加回 HTML | 1 failed ✅ |
| M3 把 `#selBody` 加回 HTML | 1 failed ✅ |
| M4 删掉 `slotField` 导出 | 1 failed ✅（补断言前是假守卫） |
| M5 删掉 `diagnostics` 导出 | 1 failed ✅（同上） |
| M6 删掉 `selectSlot` 导出 | 1 failed ✅（同上） |
| M7 删掉 `layerMove` 导出 | 1 failed ✅（同上） |
| M8 `syncInspector` 改回写 `$("selBadge")` | 1 failed ✅（同上） |

### 顺带清理

CSS 删 55 条规则（`.panel-inspector` / `.sel-*` / `.kv` / `.field-grid` / `.debug*` / `.legend` / `.skel-*` / `.xform-row` / `.issue-list` 等），括号平衡仍为 0。`setDebugOpen` / `openDebug` 改安全空壳（仍有调用点）。状态栏 `#footDiag` 不再跳转，改为「未求值 N（diagnostics() 可读明细）」。

## 0.9.49 — 移除部件分页的「常用属性」区与「片段库」（2026-11-11）

**用户要求**：把部件分页的属性面板、片段库整个删掉（前端 / 后端功能不动）。

### 删了什么

| 删除的面板 | 具体元素 | 能力去向（**一个都没丢**） |
| --- | --- | --- |
| 常用属性区 | `#propEmpty` `#propBody` `#bpx` `#bpy` `#brot2` `#bscale` `#propKeyBtn` `#btnFreeTransform` `#propKeyState` `#ftHint` | 位置/旋转/缩放 → 选中部件检查器 `#selBody`、骨骼检查器 `#boneBody`；新增 `__characterEditor.setBoneField(field,value)` / `boneField(field)`<br>打关键帧 → `K` 快捷键 / `#btnBoneKey` / `R` `T` `S` 打键按钮 / `keySelected(fields)`<br>自由变换 → `Shift+T`；**新增** `ftToggle/ftEnter/ftCommit/ftCancel`（原来只有 `ftState/ftBox/ftHitAt` 三个只读诊断，没有任何动作入口） |
| 片段库 | `#clipSection` `#clipBody` `#clipStat` `#clipName` `#btnClipSave` `#clipCollision` `#clipList` `#poseName` `#btnPoseSave` `#poseList` | 早已齐备：`clips()` / `clipSave` / `clipInsert` / `clipRename` / `clipDelete` / `clipCollision` / `poseSave` / `poseApply` / `poseDelete` |

**刻意保留**：面板标题「属性」、右上角选中徽标 `#selBadge`、`#selBody` / `#boneBody` / `#attBody` / `#skelWrap`、调试面板、`localStorage["dsh.character-editor.clips"]` 里的全部数据与 `pose-tools.js` 的 `applyClip` / `mirrorPose` 链路。删的只是显示层。

### 顺带修掉的原有 HTML 结构缺陷

删除过程中发现原文件**两个错误正好互相抵消**：

```
section 开合  16 : 15   ← #clipSection 的 <section> 从来没闭合过
div     开合 148 : 149  ← 文件末尾多一个 </div>
```

浏览器实测（DOMParser）证实：`#debug` 被解析成 `#clipSection` 的**子节点**，`#partsView` 被那个多余 `</div>` 强行闭合 —— 旧页面能正常显示纯属浏览器宽容解析的巧合。本次一并修正为**完全平衡**（`section 15:15`、`div 137:137`、文档嵌套深度终值 0），并用 DOMParser 复核了全部关键区块的父子关系与 `body` 直接子元素清单。

### 过程中修掉的自己的错误

1. **新接口的返回值语义混淆**（写下去立刻复查发现的）：
   - `ftToggle` 第一版是 `!!(res || ft.on === false)` —— 但 `ftToggle` 在「提交且零改动」时返回 `false`，会被误读成「没进去」。
   - `ftCommit` 把「没有会话」和「有会话但零改动」压成同一个 `false`。
   - 改法：`ftToggle` 用 `wasOn ? "commit" : "enter"` 区分动作；`ftCommit` / `ftCancel` 无会话时返回 `{ok:false,reason:"FT_NOT_ACTIVE"}`，有会话但零改动则是 `{ok:true,changed:false}`。

2. **死绑定检测器是假守卫**（变异测试抓到的，见下表 M1/M2）：第一版写成 `$("id")[^;]*?addEventListener`，要求两者在**同一条语句**。但真实死绑定是相邻两句、靠变量中转：

   ```js
   const deadClipSave = $("btnClipSave");
   if (deadClipSave) deadClipSave.addEventListener("click", () => 0);
   ```

   `[^;]*?` 跨不过第一句的分号 → 变异体 3428/3428 一路绿灯。改为同时覆盖「直连」与「变量中转」两种形态，并给检测器本身加了两条反向自检（能认出变量中转 / 不把只读守卫 `const btn = $("clipToggle")` 误判成死绑定）。

3. **`index.html` 里两行帮助文案成了假话**：还写着「右栏 · 属性：位置 / 旋转 / 缩放、◆ 打关键帧」与「片段库默认收起」。已按实际界面改写。

### `visible.clipSection` 的语义

旧实现读 `offsetParent`。DOM 删掉后它会**恒返回 `false`** —— 但 `false` 在旧语义里表示「这块存在、只是收起/隐藏」，会把调用方误导成「展开就能用」。改为：

```js
clipSection: false,
clipSectionRemoved: true,     // 这块界面已经不存在
clipsCapability: true,        // 但能力还在
```

`ftState()` 同理加了 `buttonRemoved: true` 与 `entryPoints`，不让 `buttonPressed: null` 独自承担「按钮没了」与「按钮未按下」两种含义。

### 验证

```
node --check app.js                              0
selftest-node.mjs                                3430/3430（event-names 166/166，新增 35 条守卫）
bump-editor-version.mjs --check                  0（0.9.49，47 处 ?v= 同源）
py_compile serve.py                              0
verify_pack_v3.py workspace/packs/deepseek       PASS 39 / FAIL 0 / BLOCK 1（原有 planned 序列阻断，与本次无关）
verify_catalog.py --pack …                       17 条全 PASS，可进发布区
BOM 扫描 / 残留 .bak                             0 / 0
```

**浏览器真实模型实测**（`workspace/packs/deepseek`，21 动画 / 38 槽 / 37 骨）：

```
setBoneField x      18.5 → 28.5 ✅        setBoneField rotation  0 → 5 ✅
字段名打错          ok:false, FIELD_INVALID ✅
撤销两次            回到 18.5 / 0 ✅
ftEnter→ftCancel    on 正确翻转 ✅        ftCommit 空闲 → FT_NOT_ACTIVE ✅
ftToggle            action:"enter" → "commit"，零改动 != 没进去 ✅
poseSave→apply→mirror→delete   poses 1→0 ✅   localStorage 已清理，dirty:false
```

### 变异测试（8/8 全部被抓）

| 变异 | 结果 |
| --- | --- |
| M1 变量中转死绑定加回 | 3429/3430，1 failed ✅ |
| M2 直连死绑定加回 | 3429/3430，1 failed ✅ |
| M3 `syncPropCommon` 函数复活 | 3428/3430，2 failed ✅ |
| M4 `visible.clipSection` 改回 `offsetParent` | 3428/3430，2 failed ✅ |
| M5 删掉 `ftToggle` 导出 | 3429/3430，1 failed ✅ |
| M6 删掉 `setBoneField` 导出 | 3429/3430，1 failed ✅ |
| M7 把 `propBody` 加回 `index.html` | 3429/3430，1 failed ✅ |
| M8 把片段库 `section` 加回 `index.html` | 3429/3430，1 failed ✅ |

## 0.9.48 — 展开/收起的淡入淡出（2026-11-11）

**用户反馈**：展开收起缺少淡入淡出动画。

### 为什么不能用 CSS transition（这是关键前提）

`renderVoiceList()` 一开始就 `box.textContent = ""`，**整列重建**。元素是「先删后建」，没有可过渡的中间态 —— **CSS 过渡根本不会触发**。所以改成在渲染完成后给新节点跑一次 WAAPI 关键帧。

### 实测抓到的真问题：被顶掉的那张是「瞬间消失」

第一版只做了入场动画。实测发现：

```
打开 B 时，A 的高度 184px → 26px，在同一帧内完成（6.7ms）
```

也就是说：**新卡有淡入，旧卡瞬间塌掉** —— 这才是「缺少淡入淡出」最刺眼的地方。

### 最终实现

| 场景 | 动画序列 |
| --- | --- |
| 首次展开 | `fade-in`（opacity 0→1，150ms） |
| **切换到另一张** | `fade-out`（1→0）→ 重建整列 → `fade-in`（0→1） |
| 收起 | `fade-out`（1→0）+ 卡片 `collapse`（scaleY 1→0.985→1） |

- 顺序：**先淡出旧的、再重建、最后淡入新的**。直接重建会硬切换。
- 快速连点保护：`voiceFadeOutThen()` 用 `voiceExitGen` 作废上一轮，避免「点了 C 却在播 B 的退出」。
- 尊重 `prefers-reduced-motion: reduce`：系统要求减少动效时全部跳过。
- 动效失败静默降级（`try/catch`），不影响功能。

### 过程中修掉的三个问题（都是我自己的）

1. **`if (v.expanded.size || true)`** —— 恒真条件，写代码时没想清楚就凑出来的。改为按「重建前是否真的存在展开体」判断。
2. **守卫用文本位置判断运行时顺序** —— `renderVoice()` 在传给 `voiceFadeOutThen` 的**回调体内部**，源码位置必然更早，但运行时是先淡出。文本先后 ≠ 执行先后，改为结构性判断（回调体内 + 作为参数传入）。
3. **守卫只检查实现、不检查接线** —— 变异测试发现：把 `voiceAnimateExpandedBody()` 的**调用**删掉，断言仍然全过。补了一条「展开时确实调用」的接线断言。

### 验证（三次变异测试）

| 变异 | 结果 |
| --- | --- |
| 绕过 `voiceFadeOutThen`（取消退出动画） | 3392/3394，2 failed ✅ |
| 删掉入场动画**调用** | 3394/3395，1 failed ✅ |
| 全部还原 | 3395/3395 全过 ✅ |

- 浏览器埋点（按首末帧顺序正确分类）确认三种过渡的动画序列与上表一致。
- 新增 13 条守卫（`event-names` 118 → 131）。
## 0.9.46 — 台词页手风琴展开 + 页签改名（2026-11-11）

**用户要求**：① 不同卡片点击应该互斥展开，打开一个其它就关闭；② 这个页签应该叫「台词」，更符合功能语义。

### 一、手风琴展开

- 原来 `state.voice.expanded` 是 `Set`，**允许多开**。展开几张后列表被撑得很长，而且「当前在看哪个事件」不明确。
- 改成：展开前先 `v.expanded.clear()`，再 `add(name)` —— 同一时刻只有一张打开；点已展开的那张仍然是收起。

```js
if (wasOpen) v.expanded.delete(name);
else { v.expanded.clear(); v.expanded.add(name); }
```

- 实测（每次重新查询 DOM，不是抓快照）：依次点开 4 张，`openCount` 恒为 1：

| 打开 | openCount | openIds |
| --- | --- | --- |
| `pet_clicked` | 1 | `[pet_clicked]` |
| `session_waiting` | 1 | `[session_waiting]` |
| `task_running` | 1 | `[task_running]` |
| `not_fat` | 1 | `[not_fat]` |

### 二、页签改名「事件」→「台词」

- 改的是**指向这个分页**的用户可见文案：页签文字、`按状态筛选台词`、`搜索台词 / 原文 / 动画`、`打开右侧台词分页`、状态提示里的「详见右侧台词分页」。
- **刻意不改**：
  - 内部 id（`tabEvents` / `eventPanel` / `eventTabBadge`）—— 改名只换文案，不破坏任何引用；
  - 时间轴里的 Spine「事件」轨道（那是 runtime 的 event track，与这个分页无关）；
  - 顶部摘要 `34 事件 / 48 条台词` —— 它描述的是「34 个事件里共 48 条台词」，是真实数据关系，改成「48 条台词」会丢掉一层信息。

### 三、我的一个测试缺陷（记录以免重犯）

第一版验证脚本抓了一次 `rows` 快照就反复点它，但 `renderVoice()` 每次都**重建列表 DOM**，后续点击落在已脱离文档的死元素上 —— 表现是「openIds 永远不变」，看起来像手风琴失效，实际是测试没点到。改成每次重新查询 `querySelector` 后才拿到真实结果。

### 验证

- 新增 10 条守卫（`event-names` 108 → 118）：`expanded.clear()` 必须存在、且**在 add 之前**；页签文案必须是「台词」且不再写「事件」；内部 id 未被改名；搜索占位符已同步；时间轴的 Spine 事件轨道**仍叫「事件」**。
- **两组变异测试双向验证**：
  - 去掉 `expanded.clear()`（恢复多开）→ **3380/3382，2 failed**；
  - 页签改回「事件」→ **3380/3382，2 failed**；
  - 还原 → 3382/3382 全过。
## 0.9.45 — 事件页点卡片加载表情（2026-11-11）

**用户要求**：在事件页点击卡片应该加载对应表情，相当于在表情页点击指定事件。

- 事件与表情本来就是**同一份数据**（`events[].expression`），所以在 `toggleVoiceEvent()` 展开卡片时直接调用 `applyExprSet(eventId)` —— 与表情页点同一事件走**完全相同**的代码路径（同样的 catalog 校验、互斥清理、`render()` 重绘）。
- **只在「展开」时应用，「收起」时不应用**。这是有意为之：收起是「看完了、关掉」的动作，如果那时也重算表情，会把用户在表情页刚精调好的结果覆盖掉 —— 那是很恼人的行为。收起只清 `appliedSet`（不再声称是那个事件的原值），**保留 `saveTarget`**（这样收起后仍知道要存回哪个事件）。
- 实测（浏览器）：

| 操作 | 结果 |
| --- | --- |
| 展开「被点击」 | `appliedSet=pet_clicked`、override 写入 12 槽、画布嘴巴=`mouth_调皮` |
| 收起 | `overrideUnchanged=true`（精调不被覆盖），`appliedSet=null`，`saveTarget` 仍为 `pet_clicked` |
| 再展开 | 重新应用，`renderCount` 增长，画布同步 |

- **确认过前置条件**：`applyExprSet()` 不依赖「表情页是否打开」；catalog 在载入包/切到部件页时已加载，且没有 catalog 时会降级（跳过 catalog 校验）而不是静默失败。
- 新增 5 条源码守卫（`event-names` 103 → 108）：展开分支**必须**调用 `applyExprSet`、收起分支**不得**调用、收起清 `appliedSet`、收起不清 `saveTarget`。
- **变异测试**：把 `applyExprSet` 也塞进收起分支 → **3371/3372，1 failed**（正好命中「不覆盖精调结果」）；还原 → 3372/3372 全过。
## 0.9.44 — 事件分页裁剪：删 5 处显示，能力全部保留（2026-11-11）

**用户要求**：单个事件卡片里绿框的 5 处前端内容全删（「每个事件卡片都要改」）。

| # | 删除内容 | 原代码位置 | 能力去向 |
| --- | --- | --- | --- |
| 1 | 分类 / 条数 / 表情摘要行 | `buildVoiceEventRow` 的 `line2` | 容器置 `hidden`（保留，见下） |
| 2 | `试听` 按钮 | 同 `line2` 末尾 | `__characterEditor.voiceAudition(eventId)` |
| 3 | `资源检查` + 模型动画清单 | 展开体 `anims` / `voiceResourceChecks` / `voice-model-anims` | `__characterEditor.voiceChecks(eventId)` |
| 4 | 每行 `动画未检查` / `动画` 徽标 + 预览按钮 | `buildVoiceLineRow` 的 `animTag` / `preview` | `__characterEditor.voicePreviewLine(lineId)`、`voiceAnimationStatus(eventId)` |
| 5 | 每行 `.ogg` 路径 | `voice-line-file` | 移入台词 `title`（悬停可见，不占版面） |

### 为什么用 `hidden` 而不是物理删除

`voiceEventList` 上有一条**按类名分发**的点击委托（`.voice-line-play` / `.voice-line-preview` / `.voice-audition`）。物理删除元素会让那条委托失去目标，等于顺手砍掉能力。所以：

- `line2` 保留为 `hidden + aria-hidden` 的空容器；
- 台词行的播放按钮（`.voice-line-play`）**保留** —— 它不在绿框里，且是唯一能点播放的入口。

### 一个顺带查清的事实

包里 34 个事件：带 `animation` 字段的 **0**、带 `frameAction` 的 **0**、带 `presentation.sequence` 的 5。也就是说，那个「动画未检查」徽标对**所有事件**都恒为「未检查」—— 它一直在显示一个恒定的空洞状态，删掉不损失任何信息。

### 顺带修的一个自造 bug

新加的 `voiceAnimationStatus` 直接 `map` 了 `ev.animations`，而浏览器实测该字段可能是 `[null]`，于是输出 `{animation: undefined, status: "none"}` 这种垃圾项。已改为先过滤非字符串，并如实返回 `{declared:false, note:"该事件不声明联动动画"}`。

### 验证

- 浏览器实测 5 处全部消失：`line2Visible=false`、试听/动画清单/资源检查/模型动画清单全部 `absent`、每行动画徽标 0 条、预览按钮 0 个、`.ogg` 路径 0 条。
- 卡片高度 184px，文本只剩：`被点击 正常 台词` + 3 条 `语音 ✓ 台词正文`。
- **新增 18 条源码守卫**（`event-names` 85 → 103）：删掉的那几块不得回来 + 4 个 agent 入口必须存在 + 底层函数仍在 + 路径仍进 title。
- **变异测试双向验证**：把试听按钮 / 动画徽标 / `.ogg` 路径加回去、并删掉 `voiceAudition` 入口 → **3363/3367，4 failed**（正好命中）；还原 → 3367/3367 全过。
## 0.9.41 — 附件改名让语义自洽 + 修「未知 API」（2026-11-11）

**用户反馈**：「这两个的中文名称又反了，然后保存会显示未知 api」。

### 问题一：保存报「未知 API 路径」

- **根因不是代码，是服务进程没重启**。实测两个端口的能力探测：

```
8123   {"saveBundle": true, "saveEvents": true, ...}   ← 新代码
8124   {"saveBundle": true, ...}  缺 saveEvents         ← 旧代码（启动早于改动）
```

  Python 在启动时就把模块读进内存，旧进程不会加载新的 `serve.py`；`/api/save-events` 因此走「未知路径」分支。
- **修复**：重启 8124（以及任何其它在跑的端口）。两个端口现在都 `saveEvents: true`。
- 这个坑在 README 里加了显式提醒：**改 `serve.py` 后必须重启，多端口要逐个重启**。

### 问题二：两个附件的中文命名与内容相反

- 现象：`mouth_嘘_气` 实为**噘嘴**（红色 3 形）、`mouth_嘘` 实为**吐出的气**（白色气泡）。名字读起来正好相反。
- **修法：直接改名，让名字与内容一致**（而不是加一层中文别名或再动槽归属）：

```
嘴巴        mouth_嘘     ← 噘嘴（x=7，13×22）
嘴巴特效    mouth_嘘_气   ← 气（x=30，27×23）
```

- 同步改：`spine/model.json`、`spine/model.atlas`、`catalog.json`、`events.json`。`rig-meta.json` / `lipsync.json` 不引用这两个名字，未动。
- **前缀陷阱**：`mouth_嘘` 是 `mouth_嘘_气` 的前缀，连续两次 `replace` 会互相污染。改用**临时占位符**做三段交换，并用「两个名字的出现次数必须对调」自检（四个文件的计数全部正确互换）。
- 校验结果（`verify_catalog` 17 条 PASS、`verify_pack_v3` 40 条 PASS 39 / 拒收 0、基线 5/5）之后，逐项实测：

| 只显示 | 所在槽 | 画面 |
| --- | --- | --- |
| `mouth_嘘` | 嘴巴 | 红色 3 形噘嘴 |
| `mouth_嘘_气` | 嘴巴特效 | 白色气泡 |

- 8124 上实测保存：`long_idle` 写入 `嘴巴:mouth_嘘` + `嘴巴特效:mouth_嘘_气`，磁盘 25102→25146 字节、981 CRLF / 0 裸 LF、仅该事件变化，已还原。
## 0.9.40 — 修差异比较缺 undefined 归一 + 服务端部位白名单（2026-11-11）

**两个真 bug（都是我这轮引入的）**：

1. **差异比较只归一了一半**：
   ```js
   JSON.stringify(before[k] === undefined ? null : before[k]) !== JSON.stringify(after[k])
   ```
   `JSON.stringify(undefined)` 返回 `undefined`（不是字符串 `"null"`），所以当 `after` 没有「嘴巴特效」这个键时永远判不等 → **点事件、不改任何东西，保存按钮也是亮的**。修法：两边都做 `undefined → null` 归一。
2. **`serve.py` 的部位白名单漏了「嘴巴特效」**：
   ```
   保存失败：请求格式错误：long_idle：expression 含未知部位：嘴巴特效
   ```
   服务端**独立重新校验**的设计在这里起了作用 —— 前端加部位不会自动被接受。补上 `EXPRESSION_PART_KEYS_OPTIONAL`，并把「必填/可选」语义一起带过去（可选键缺省合法，出现时仍要求字符串或 null）。

- 新增 7 条断言（`event-names` 78 → 85）：缺键与 null 等价、对称性、有值不等、空字符串不被误归一。
- **顺手加了 `@@SUITE-END@@` 锚点注释**：新断言块一律插到该行之前，**从结构上避免再插进不可达分支**。这个坑本轮踩了两次，每次表现都是「测试数纹丝不动」——后来把「测试数没变」当成红灯信号来查才抓住。
- 实测：点「长时间空闲」不改动 → 保存按钮恢复「与包内值一致，无改动」；手动给嘴巴特效加气 → 按钮可点、保存成功、磁盘 `long_idle.expression` 同时含 `嘴巴:mouth_嘘_气` 与 `嘴巴特效:mouth_嘘`，仅该事件变化（34→34），已还原。
## 0.9.38 — 修正嘴巴/气的槽归属搞反（2026-11-10）

**用户反馈**：「你把嘴巴特效和嘴巴搞反了，就是哪个嘘」「组合起来是对的，分开选就是错的」。

- **确认方式（不凭名字猜）**：分别单独渲染两个附件并 4× 放大对照 ——

| 只显示 | 实际画面 | 判定 |
| --- | --- | --- |
| `mouth_嘘` | **白色四瓣气泡** | 这是**气** |
| `mouth_嘘_气` | **红色 `3` 形噘嘴** | 这才是**嘴** |

- **坐标佐证**：其余 12 个嘴型 region 的 `x` 都在 5~7；`mouth_嘘_气` 是 `x=7 / 13×22`（正嘴位），`mouth_嘘` 是 `x=30 / 27×23`（偏到嘴右侧）。**附件名与内容相反**，属于历史命名遗留。
- **修正**：交换两个附件的槽归属 ——

```
嘴巴       = mouth_嘘_气   （真嘴，红色 3 形）
嘴巴特效   = mouth_嘘     （气，白色气泡）
```

- **6 个事件的视觉结果保持不变**，只修引用路径：

| 事件 | 语义 | 当前写法 |
| --- | --- | --- |
| `long_idle` / `reconnected` / `task_timeout` | 只显示嘴、无气 | `嘴巴 = mouth_嘘_气`（无 `嘴巴特效` 键） |
| `pet_hidden` / `session_waiting` / `task_running` | 只显示气、无嘴 | `嘴巴 = null` + `嘴巴特效 = mouth_嘘` |

- **同步**：`catalog.json` 的 slots 与 expressionParts 集合互换（并与 model 逐项比对一致）、`generation` 2→3、`rigSha256` 更新；冻结基线更新（仍只允许 model.json/rig-meta.json）；规范文档里写反的说明已改正并补上判定依据。
- **过程中我自己写坏了 catalog**：把「交换两个槽的附件集合」写成了「直接赋值为对方集合」，导致 `嘴巴` 只剩 1 个附件。被「与 model 逐项比对」的硬校验抓住后重建正确列表（12 普通嘴型 + 嘘_气 = 13）。
- **实测**：单独显示「嘴」→ 得红色 3 形；单独显示「气」→ 得白色气泡；两者同显 → 3 形 + 气泡并列。
## 0.9.37 — 修「显式 null 键」导致的无意义 diff（2026-11-10）

- 实测发现：点「长时间空闲」**一字未改**，比较结果却报「有改动」。原因是包里 6 组眨眼对象**显式写了 `"iris": null`**，而 0.9.28 的反算约定「只输出非 null 键」→ 一保存就把 `iris: null` 删掉。语义等价、字节不同，违背「没改动就不动盘」的承诺。
- 修法：`exprSlotsToParts(box, hints)` 接受原事件 expression 作为 hint，**原对象上出现过的键一律保留**（值可为 null）；没出现过的键只在有值时才加。
- 实测：点「长时间空闲」→ 保存按钮恢复为「与包内值一致，无改动」。
- 变异测试：去掉「可选部位输出」+「显式 null 保留」→ **3 条断言变红**；还原 → 全过。

## 0.9.36 — 嘴巴特效渲染入口 + 测试副本同源（2026-11-10）

- **漏改第 6 处**：`exprPageSlotKeys()` 是**硬编码列表**，没加 `mouthFx`。即使 model / rig-meta / catalog 全部改好，表情页也不会渲染新槽 —— 表现为「结构改了但界面没变」。
- **测试副本同源**：`selftest-eventnames.js` 里那份 `slotsToParts` 副本滞后于实现（缺第 8 部位、缺 hints），导致新断言全红。**红的原因是副本旧，不是实现错**。把副本逐条对齐实现，并说明「只改副本让测试变绿 = 测试描述的是副本而不是生产代码」。
- 教训复现：断言块又一次被插进「模块未加载」的提前返回分支，测试数从 3333 纹丝不动 → 这正是上次踩过的同一个坑。**「测试数没变」必须当成红灯信号来查**。

## 0.9.35 — 新增「嘴巴特效」槽：嘴型与气不再互斥（2026-11-10）

**用户报告**：`mouth_嘘` 和 `mouth_嘘_气` 应该是一个 Mouth 部件 —— 一个是嘴巴、一个是嘴巴吐出来的气，**不应该互斥**，可以分在「嘴巴特效」。

- **根因（不是 UI 问题）**：两者在模型里是**同一个「嘴巴」槽的两个附件**，而 Spine 一个槽一次只能显示一个附件 → 天然互斥。要做到同显，必须给「气」一个独立槽。
- **模型层改动**（外科式，不重跑 PSD）：

| 文件 | 改动 |
| --- | --- |
| `spine/model.json` | 37 → **38 槽**，新增 `嘴巴特效`（紧跟 `嘴巴` 之后）；`mouth_嘘_气` 从 `嘴巴` 搬到新槽；新槽**不写 attachment 键** → 默认不显示（否则气会一直挂着） |
| `spine/rig-meta.json` | `slots.mouthFx` / `slots.all` / `slotBones` / `slotGroups.expr` 共 4 处 |
| `catalog.json` | slots 加新槽；`expressionParts` 加**可选**第 8 部位 `嘴巴特效`；`嘴巴` 的 values 移除该附件；`generation` 1→2、`rigSha256` 更新 |
| `events.json` | **迁移 3 个事件**（`long_idle` / `reconnected` / `task_timeout`）：`嘴巴: "mouth_嘘_气"` → `嘴巴: null` + `嘴巴特效: "mouth_嘘_气"` |
| 编辑器 `app.js` | 正向/反向映射加第 8 部位（**可选**语义）+ 差异比较覆盖可选部位 + 渲染入口 |
| 流水线 | `compile_pack.py` / `export_parts.py` / `verify_pack_v3.py` / `verify_catalog.py` / `verify_no_dup.py` 同步 37→38 与可选部位 |

- **「可选」是关键设计**：既有 34 个事件的 expression **没有**该键 → 逐字节不变，不需要迁移。若做成必填，34 个事件全部要改并报「缺部位」。
- **用户手改的两个事件完整保留**：`tsundere_sweet`（眉毛）、`wake_up`（眨眼档位）都在未迁移清单里，脚本断言「未迁移事件被误改 = 0」。
- **实测（几何 + 截图双证）**：

```
嘴巴       default/嘴巴/mouth_嘘        6 三角形  bounds x  2..29
嘴巴特效   default/嘴巴特效/mouth_嘘_气  6 三角形  bounds x -14..-1
```

  两者**同时存在于几何、各自成层**，气正好在嘴的左侧。

- **冻结基线**：`model.json` 与 `rig-meta.json` 变了，基线同步更新。更新前先**反向移除我加的 4 处**验证能逐字节还原出原哈希（`2c1e9aa276ec…`），证明「改动恰好这 4 处」。白名单只放行这两个文件；**model.png / model.atlas / lipsync.json 一个字节都没动**。
- **顺手补了一处校验漏洞**：`verify_pack_v3` 的 E7 原先是「值落在**任意**声明槽即可」，搬槽后仍会通过。收紧为「必须落在**自己声明的槽**」后，立刻暴露出我漏改的 `expressionParts.嘴巴.values`。

## 0.9.34 — 徽标只讲互斥，不再与右上角状态重复（2026-11-10）

- 生效态截图暴露语义重复：右上角写「生效中」，徽标也写「生效中」，同一区域出现两个。
- 徽标职责收窄为**只讲互斥关系**：`与「眨眼三槽」二选一` / `与「整眼」二选一`；完整说明放 `title`。
- 状态（生效中 / 已取代）**唯一**由右上角 `.exp-region-ctl` 表达，不两处各说一遍。

## 0.9.33 — 修区域头部「一字一行」竖排（2026-11-10）

**用户报告**：红框位置的换行没做好，导致按钮被顶到外面去了。

- **根因**：`.exp-region-hd` 原来是单行 flex，塞了「标题 + 徽标 + 右上角控制位」三样。300px 侧栏下标题被压到 **min-content** → 一字一行折行（实测显示成 `整眼（整 / 眼_L / /整眼 / _R）`），徽标同样竖排，右上角切换按钮被顶出区域外。
- **修法三条**：
  1. **标题改短**：`整眼（整眼_L / 整眼_R）` → `整眼`，`眨眼三槽（眼白 / 眼珠 / 睫毛）` → `眨眼三槽`；完整说明移到 `title`；
  2. **头部拆两层**：`.exp-region-hd` 改 `flex-direction: column`；第一行 `.exp-region-hd-row`（标题 nowrap+省略号 + 右上角控制位 `flex:none`），徽标独占第二行整宽；
  3. **标题 CSS**：`white-space: nowrap` + `text-overflow: ellipsis` + `min-width: 0`。
- **实测几何（300px 侧栏，未生效态与生效态都测）**：

| 指标 | 修前 | 修后 |
| --- | --- | --- |
| 标题高度 | 多行（一字一行） | **17px = 1 行** |
| 右上角控制位距右边缘 | 被顶出区域 | **7px，ctlOverflow=false** |
| 徽标 | 竖排 | **1 行、独占整宽 261px** |
| 区域宽 | 275px | 275px（未变，说明没有靠加宽逃避问题） |

- **新增 14 条排版守卫断言**（`event-names` 55 → 69）：标题必须 nowrap + 省略号 + min-width:0、控制位必须 flex:none、头部必须 column、徽标不得再出现「生效中」、徽标必须含「二选一/互斥」语义。全部**源码守卫**（Node 侧读文件，浏览器侧记 skipped 不静默跳过）。
- 踩了一个值得记的坑：这块守卫**第一次插错位置**（插进了「模块未加载」的提前返回分支里），导致它根本没执行 —— `node --check` 通过、测试全绿、但断言没跑。修正后测试数才从 3319 变 3333。
- **做了变异测试双向验证**：把 CSS 的 `nowrap` 与 `flex-direction: column` 去掉 → **3331/3333，2 failed**（正好是这两条）；还原 → 3333/3333 全过。

## 0.9.32 — 保存条两行布局 + 常驻底部（2026-11-10）

**用户要求**：这个箭头位置要有保存按钮，用来保存表情分页的数据。

- **位置修正（0.9.30）**：保存条原先放在 `#exprBody`（**滚动容器**）末尾，实测 `y=755 … bottom=794`，而侧栏只有 `y=77 … bottom=737` —— **整个掉到侧栏外面**，要滚到最底才看得见。移到 `#exprPanel` 直属层（滚动区之外）后：`y=668 … bottom=707`，常驻可见。
- **文案修正（0.9.29）**：目标标签原写「目标事件：被抚摸（pet_petted）」，与右侧状态条重复且被截断成「未选...」/「先在「事...」。改为：标签只给短状态（`被抚摸` / `未选中事件`），完整说明放 `title`，原因交给状态条。
- **两行布局（0.9.32）**：侧栏 300px 塞不下「按钮 + 目标 + 状态」，改 `flex-wrap` + 状态条 `flex: 1 1 100%` 独占第二行。实测第一行 `[保存表情到事件] 未选中事件`、第二行 `先在「事件表情」里点一个事件`，两处都完整可读。
- 删掉无用的 `<span class="spacer">`（两行布局下它只会占位）。

## 0.9.29 — 保存条文案不再重复（2026-11-10）

- 目标标签与状态条都在说「先点一个事件」，挤在一行被截断成两个坏标签。
- 标签只留短状态；英文事件 id 与完整说明放 `title`，不占可见宽度。

## 0.9.28 — 格式扩展：眨眼组支持 white（眼白）·（2026-11-10）

**用户拍板方案二**：给 `眨眼_左/右` 增加眼白字段，让界面上单独调的眼白能真正写回 `events.json`。

| 文件 | 改动 |
| --- | --- |
| `docs/dsh-pets-character-pack-format-v3.md` | 类型 `{iris, lash}` → `{iris, lash, white}`；新增 4 条规则 |
| `step2/scripts/compile_pack.py` | `blink_slot` 加 `white: 眼白_L/R`，编译器放行 |
| `step2/scripts/verify_pack_v3.py` | S8 校验加 `white` 槽比对 |
| `serve.py` | 新增 `POST /api/save-events`（见 0.9.26） |

- **`white` 是可选键**：缺省表示该侧眼白沿用 Rig 默认附件。这条很重要 —— 包里现有 38 组眨眼数据**没有一组带 white**，把它做成必填会导致全部旧包不可加载。
- **值为 `null` 的键可省略**：反算时只输出非 null 键，所以「没改动的事件」保存后**逐字节不变**，不产生无意义 diff。
- `white` 的取值同样受 C6 约束（必须落在 `眼白_{L|R}` 槽的真实附件名内）。
- 验收：`verify_pack_v3.py` 实跑 40 条 → **PASS 39 / 拒收 0 / 阻断 1**（那条是原有的 planned 序列阻断，与本次无关）。

## 0.9.27 — 拆分「当前套装」与「保存目标」（2026-11-10）

- **真实卡点**：`applyExprAttachment()` 手动改一个槽时会把 `state.expr.set` 置 `null`（语义正确：预览已偏离事件原值）。但保存条也读 `set` 当目标 → **一精调就丢目标**，而「选事件 → 精调 → 保存」正是这个功能的核心用法。
- 拆成两个字段：
  - `set`：当前预览是否**完全是**某事件的原值（微调后必然失效）；
  - `saveTarget`：**你打算写回哪个事件**（微调**不**清除；只有换包才清）。
- `applyExprSet()` 点事件时同时设两者；`exprResetOverrides()`（换包路径）两个都清；`exprResetToSetup()`（用户主动重置）只清 `set`、保留 `saveTarget`。

## 0.9.26 — 事件表情保存按钮 + 写回 events.json（2026-11-10）

**用户要求**：表情页底部要有单独保存按钮，用来改写 `events.json`，精细调整每个事件的表情。

- **服务端新增独立写路径** `POST /api/save-events`（`serve.py`）：

| 安全设计 | 说明 |
| --- | --- |
| 只允许写什么 | `<base>/events.json`，且只改请求点名事件的 `expression` |
| 拒绝新建 | 事件 id 不存在 → 报错，不偷偷加事件 |
| 校验 | 7 部位齐全、眨眼组只允许 iris/lash/white、整眼与同侧眨眼互斥、无 wink |
| 写后自检 | 序列化后**回读**，确认合法 JSON 且非目标事件逐字段未变 |
| 换行 | 统一 CRLF（该文件实测 976 CRLF / 0 裸 LF） |
| 原子性 | 临时文件 + `os.replace`；失败回滚；回滚也失败报 `ROLLBACK_FAILED` |
| 并发 | 复用既有 `SAVE_LOCK` |
| 防护 | 与 `/api/save-bundle` 同一套：回环 host、`Origin`、`X-Spine-Editor` 头、`application/json` |

- `capabilities` 增加 `saveEvents: true`。
- **前端**：`#exprSave` 按钮 + `#exprSaveTarget` 目标显示 + `#exprSaveState` 结果提示；`syncExprSaveBar()` 做**可用性判定**，禁用时 `title` 必给原因（未选事件 / 无改动 / 本地目录模式 / 无包根）。
- **反算 `exprSlotsToParts()`**：11 槽 → 7 部位，含 `white`；只输出非 null 键。
- **实测写盘（字节级）**：

```
改 pet_petted 的眉毛_左  brow_L_开心 → brow_L_叹气
磁盘 25002 → 25004 字节，变更 2 行 / 977 行
换行 977 CRLF / 0 裸 LF
逐事件比对：34 → 34，只有 index 14（pet_petted）的 expression 变；
            category / lines / presentation / 其他 33 个事件全同
schemaVersion 与顶层键集合完全一致
```

- 测试完成后已把 `events.json` 恢复到测试前 SHA256（`311f5653…`），没有留下测试残留。

## 0.9.25 — 眼睛拆成两块独立区域（2026-11-10）

**用户要求**：把 `整眼_L/R` 框成独立区域、`三槽_L/R` 也框起来，切换按钮各放在**区域右上角**。

- `renderExprSlots()` 重构为「先分区收集 → 按区域渲染」：整眼区 / 眨眼三槽区 / 其余普通槽（眉毛、嘴巴）。
- 新增 `exprEyeRegion()`：区域外壳 = 标题 + 互斥徽标 + **右上角控制位**（`生效中` 或 `切换到这里`）+ 内部槽行。
- 生效区域：左侧 3px 强调竖线 + 淡蓝底；被取代区域：整体压暗 + 内部按钮划线置灰。
- 删掉已无引用的 `exprGreyOtherEyeGroup()`（新结构用区域级置灰代替，不留死代码）。
- 实测：两块区域、右上角控制位距右 7px、`regionCount=2`。
## 0.9.24 — 修「切回整眼」的 mode 自相矛盾（2026-11-10）

- `exprSwitchEyeGroup()` 原先把 `mode` **按意图写死**（`target === "whole" ? "whole" : "normal"`）。但这个模型 setup 下「整眼_L/R」**没有默认附件**，`setupAttachmentName` 返回 `null` → 整组全空 → 徽标如实显示「二选一·未选」，而 `mode` 却说是 `whole`。**状态字段与实际数据互相矛盾**。
- 改为**按实际数据推导**：`active = exprEyeGroupActive()` → `whole` / `normal`（blink）/ `none`。全空时如实告诉用户「已清空当前眼睛组；该组在 setup 下没有默认附件，请手动选一个」。
- 实测四态（mode / 生效徽标 / 置灰数 / 切换按钮全部对应）：

| 状态 | mode | 生效徽标 | 置灰 | 切换按钮 |
| --- | --- | --- | --- | --- |
| 初始 | normal | 0/4 | 0 | 0 |
| 整眼生效 | **whole** | 2/4 | 12 | 2 |
| 切到眨眼 | **normal** | 2/4 | 22 | 2 |
| 切回整眼 | **none** | 0/4 | 0 | 0 |

## 0.9.23 — 修「切换到眨眼三槽」切换无效（2026-11-10）

- 原切换按钮复用 `applyExprBlinkLevel(side, null)`，它只把眨眼三槽清成 `null`，**不调用 `exprEnforceExclusivity`** → 「整眼」仍非空、依旧生效，**点了切换什么都没换过去**（实测 `blockedCount` 仍为 12）。
- 新增 `exprSwitchEyeGroup(target)`：完整做两件事 —— 清空对方那一组 + 给目标一组一个确定起点（setup 快照），然后 `refreshExprUI()` + `render()`。
- 顺带修徽标判定：`exprMutualBadge()` 原先只判「不等于另一组」就算本组生效，导致 `active === "none"` 时**两组都显示「生效中」且都被置灰**（用户完全点不动）。改为三态分别处理，`none` 时显示「二选一 · 未选」。

## 0.9.22 — 眼睛互斥的界面视觉语义（2026-11-10）

**用户反馈**：睫毛 / 眼珠 / 眼白 + 两侧 + 眉毛 + 嘴巴是 11 个槽，与整眼互斥，功能上已经做了，**但还少 UI 层面的互斥视觉语义**。

- **数据层没动**：`exprEnforceExclusivity()` 的双向清理本来就是完整的，这轮只补「看得出来」。
- 四件事：
  1. 眼睛两组标题加**互斥徽标**（`生效中` / `与「X」互斥` / `二选一 · 未选`）；
  2. 当前生效那一组正常，另一组按钮 **`disabled` + 划线 + 虚线边框 + 灰化**，hover 说明原因；
  3. 提供显式**「切换到「X」」按钮**，而不是点了才发现眼睛被换掉；
  4. 组头加说明文字，明示「眼睛两组只能二选一，不能叠加」。
- CSS 新增 `.exp-mutual` / `.exp-mutual.is-on` / `.exp-mutual-note` / `.exp-att.is-blocked` / `.exp-att.is-switch`。
- 新增 13 条断言（`event-names` 套件 35 → 46）：三态判定（whole / blink / none，含眉毛嘴巴不参与、全 null 视为 none、同时非空时 whole 优先）+ **`mode` 必须与 active 一致**（固化 0.9.23 的修法，防止再把意图写死）。

## 0.9.21 — 修「点事件表情要等一会」：漏了一次画布重绘（2026-11-10）

**用户报告**：「点击事件表情的时候，没有马上加载，还要等一会，这应该是性能的问题」（举例：点「被抚摸」要等几秒）。

- **先排除性能**：埋点实测点击同步耗时 **0.9 ms**、到下一个 RAF **2.5 ms**，`state.expr.set` 已立即变成 `pet_petted`、覆盖 11 槽也已生效 —— **数据是毫秒级到位的，根本不是性能问题**。
- **真根因**：`applyExprSet()` 成功路径只调 `refreshExprUI()`（**只重绘右侧面板**），**漏了 `render()`**（重绘画布）。画布保持旧图，直到播放推进 / 鼠标移动 / 切页等顺带触发一次 `render` 才突然变化 —— 用户感知就是「点了没反应、等一会才生效」。
- 同类函数对照（只有这一处漏了）：

| 函数 | 末尾 `render()` |
| --- | --- |
| `exprResetToSetup()` | ✅ |
| `exprResetOverrides()` | ✅ |
| `applyExprBlinkLevel()` | ✅（两分支） |
| `applyExprAttachment()` | ✅ |
| **`applyExprSet()`** | ❌ → **已补** |

- **修复后实测**（动画停在 idle，最容易暴露该问题的条件下）：点击耗时 3 ms、**画布当次就变化**（`toDataURL` 前后不同）。
- **新增 `state.renderCount`**（只增计数，不参与业务判断），并在 `expr()` 调试快照里暴露，用于「操作后是否真的重绘」的回归断言。
- **新增 5 条源码守卫断言**（`event-names` 套件 30 → 35 条）。这里踩了一个值得记录的坑：
  - 第一版守卫用 `/render\s*\(\s*\)/` 直接匹配函数源码，**匹配到的是我自己写在那里的注释**「…末尾都有 render()…」，于是**删掉真 render() 时断言仍然全过** —— 一条永远不会失败的守卫比没有更糟。
  - 改为**先剥掉行/块注释再匹配**，并加一条「剥注释逻辑本身是否有效」的反向自检。
  - **做了变异测试双向验证**：有 `render()` → 3299/3299 全过；删掉 → 3298/3299，`FAIL [event-names] 剥掉注释后，applyExprSet 里确实有 render() 调用`；恢复 → 全过。

## 0.9.20 — 事件名中英映射 + 表情页收口（2026-11-10）

**用户要求**：删掉表情页顶部红框那块；「命名包装 34」改名「事件表情」；事件名需要中英映射（界面中文、底层英文），左侧事件分页的事件名也要一起改。

- **红框（`.expr-top`）从界面移除**：模式、events.json 状态、「覆盖 N 槽」、重置按钮。**能力全保留** —— 控件仍在 DOM 里（`display:none` + `hidden`），`exprResetToSetup()` 仍可经 `__characterEditor.exprReset()` 调用，覆盖计数仍在状态快照里。符合「只删前端，不剥夺底层功能」。
- **「命名套装」→「事件表情」**（`#exprSetsWrap` 的 `<h3>` 与 `aria-label`）。
- **新增 `event-names.js`（纯数据模块，零依赖零 DOM）**：英文 id → 中文显示名，53 条（**包内 34 个事件全覆蓋** + 19 个通用兜底），另含分类映射（session→会话 / agent→智能体 …）。独立成模块是为了让 Node 自测能直接加载、并守住分层约定。
- **显示优先级（顺序有讲究）**：包内 `events.json` 作者的 `name` → 字典 → 英文 id 原样兜底。**不能反过来**：包是内容源，作者把某事件改名了，字典不该强行盖回去。
- **三处渲染同步改**（只改一处会显示不一致）：
  - 表情页套装按钮（`eventLabelById`）
  - 左侧事件分页行（`eventLabelOf`），`title` 同时给「中文名（英文 id）」
  - 分类标签（`categoryLabel`），`title` 保留英文原值
- **搜索也一并修**：原来只匹配英文 `ev.event`，界面改中文后输入「等待授权」会搜不到。现在同时匹配中文显示名。
- **一个具体陷阱**：套装列表的 `whole:<id>` 是内部前缀，第一版直接把整串当 id 查字典会永远查不到（界面露出裸英文 `whole:xxx`）；已改为先剥前缀再查。
- **底层零污染**（实测）：点「等待授权」按钮 → 按钮显示中文，但 `state.expr.set = "approval_required"`、语音事件 id 与台词 `audioId` 全部仍是英文。
- **验收**：

| 项 | 结果 |
| --- | --- |
| `.expr-top` | `display:none`、`offsetParent:null` |
| 表情页标题 / 按钮数 | 「事件表情 34」/ 34 |
| 34 个按钮纯 ASCII 残留 | **0 条** |
| 左侧事件行纯 ASCII 残留 | **0 条** |
| 中文搜索「等待授权」 | 命中 1 条 |
| 英文搜索 `approval_required` | 命中同一条 |
| `selftest` | **3294/3294**（新增 `event-names 30/30`） |

- `selftest-eventnames.js` 的断言重点不是「字典有多少条」，而是四条会真出 bug 的规则：包内 name 优先、缺失回退英文、空输入不出 `undefined`、**字典必须覆盖当前包全部 34 个 id**（包加新事件而字典没跟，这条会立刻变红）。

## 0.9.19 — 帮助入口合并 + 新增「关于」模态框（2026-11-10）

**用户要求**：「帮助浮层」和「快捷键」合并成一个入口「帮助与快捷键」；新增「关于」，在模态框里显示工具信息。

- **合并入口**：这两项本来打开的就是**同一个模态框**（`#helpOverlay` 里既有「快捷键速查」表，也有「快捷键（可自定义）」区），「快捷键」只是打开后再滚到键盘表。现在合并为一条：
  - 菜单项 `help`：**「帮助与快捷键」**（`?`），点击仍滚到键盘表，保留原来那份便利。
  - 浮层标题 `操作与快捷键` → **`帮助与快捷键`**。
- **新增「关于」**：`#aboutOverlay`（复用 `.modal` 结构）+ 菜单项 `about`（分隔线之后）。字段**全部来自真实来源，没有一个是写死的**：

| 字段 | 来源 |
| --- | --- |
| 名称 / 版本 / 构建时间 / 里程碑 | `version.js`（`syncAboutFields()`） |
| 数据版本（schema / api） | `version.js` 的 `schemaVersion` / `apiVersion` |
| 人物包格式 | `bundle.js` 的 `MANIFEST_SCHEMA_VERSION` |
| 运行时 | 探测 `window.SpineCore` |
| 客户端 | `navigator.userAgent`（截断 180 字符） |

  另含许可与来源段（代码 MIT / 角色资产 CC BY-NC-SA 4.0 / 仓库 / 职责边界）与「两套版本轴」说明。
- **帮助里的版本块改为跳转**：原来它自己展示一份版本号，与「关于」重复。现在只留一行 `编辑器 0.9.19 · 构建于 …` + 一个「关于」按钮；点按钮**先关帮助再开关于**，不会两个浮层叠着。
- **Esc 优先级**：`aboutVisible()` 排在 `state.helpOpen` 之前——关于是后开的浮层，Esc 应先关它。
- 验收（浏览器实测）：

| 场景 | 结果 |
| --- | --- |
| 打开帮助 | `help=true, about=false` |
| 帮助里点「关于」 | `help=false, about=true` |
| 按 Esc | 两个都关 |
| 点关于的 X | `about=false` |
| 关于框字段 | 8 个字段全部有真实值（无 `—`） |

- 回归：`node --check` 0、`selftest` 3264/3264、`--check` 0（44 处 `?v=` 同源）。

## 0.9.18 — 清理 `.inspector-bar` 死代码（2026-11-10）

- 0.9.17 删掉右栏 X 后，`.inspector-bar` 的样式与窄屏 padding 规则成了死代码，一并移除。
- 实测右栏现在直接从主分页栏开始：`#inspector` top = 主分页栏 top = 77（gap = 0），没有残留空条。

## 0.9.17 — 删除左侧冗余分隔条与右栏 X（2026-11-10）

**用户要求**：两处红框都删 —— 左边是冗余分隔条，右边的 X 多余。

- **左红框**：删 `bar-view` 开头的 `vsep`（删掉「适配/缩放」组后它前面已无内容）。⚠️ 顶部**菜单栏**里的 `vsep`（菜单与包名之间）是另一个元素，**未改动**。
- **右红框**：删右栏标题栏的 `#btnPanelClose`（X），并把只剩「spacer + X」的整条 `.inspector-bar` 一起移除，否则会留下一条只有下边框的空条。
- **确认无死锁再删**：顶部 `#btnPanel` 可见（x=1242, y=42）且是双向开关；「视图 → 面板」菜单项也在。右栏仍有两条关闭路，X 是第三份重复入口。
- **修掉一处会炸的绑定**：`bindUI()` 里 `$("btnPanelClose").addEventListener(...)` 是未保护的，元素删掉会抛 TypeError 并**打断后面所有绑定**（帮助关闭 / 分页 / 语音面板 / 右键菜单）。改成 `if (panelClose)`；`syncPanel()` 里那处同样加保护。
- 实测：

| 项 | 结果 |
| --- | --- |
| `#btnPanelClose` | 不存在 ✅ |
| `.inspector-bar` | 整条不存在 ✅ |
| `.bar-view` 子项 | `btnPanel / layers / alpha / displayBadge`（vsep 已不在）✅ |
| 菜单栏 `vsep` | 仍是 1 个（未误删）✅ |
| 双向开关 | 开 → 关 → 开，三态正确 ✅ |
| 后续绑定是否存活 | 帮助关闭按钮可用、分页标签在 ✅ |

## 0.9.16 — 移除顶部「适配 / 缩放」组，「看全」改名「适应窗口」（2026-11-10）

**用户要求**：红框（顶部第 2 排的 `适配 F` + `− 缩放% +`）删除；黄框（左侧工具条 `看全`）改描述。

- 顶部 `#btnFit` / `.zoomgrp`（`#btnZoomOut` / `#zoomLabel` / `#btnZoomIn`）整体移除。
- 左侧工具条 `#btnFitRail` 文案：`看全` → **`适应窗口`**；`title` 重写为「做什么」而不是罗列快捷键：**「适应窗口（F；Shift+F 只看选中）：把整个角色缩放到画布内；只改视野，不改数据」**。
- **四处连带影响一并处理**（否则删元素后会抛错或自检信息失真）：

| 位置 | 原来 | 现在 |
| --- | --- | --- |
| `syncZoom()` | 直接写 `#zoomLabel.textContent` | `if (label)` 保护 |
| `syncToolbar()` | 直接设三个按钮 `disabled` | 三个都 `if (btn)` |
| `bindUI()` | 直接 `addEventListener` | 三个都 `if (btn)` |
| 调试快照 `visible.viewbar` | 靠 `#btnFit` 是否存在 | 改判 `.bar-view` 容器（顺带发现 `$` 只是 `getElementById` 别名，不能传选择器，改用 `querySelector`） |

- **能力没丢**（实测）：`适应窗口` 点击后 zoom 0.52645→0.52644（重新适配生效）；`放大` 0.52644→0.65805；`缩小` 0.65805→0.52644（精确回原值）。右键菜单仍有「看全 F」，快捷键 `F` / `Shift+F` / `+` / `−` 不变。
- 帮助浮层与 README 的「看全」措辞同步改为「适应窗口」。
- 回归：`node --check` 0、`selftest` 3264/3264、`--check` 0（44 处 `?v=` 同源）。

## 0.9.15 — 补 `setSnap` / `setWeightMode` 脚本入口（2026-11-10）

- 0.9.14 移除「吸附 / 权重配色」的 UI 后暴露一个真缺口：这两项**原本只有 UI 与「视图」菜单两个入口，没有脚本接口**。按用户「UI 可以少，agent 必须能调」的原则补上：

| 新增接口 | 读回 |
| --- | --- |
| `setSnap(on)` | `snap()` |
| `setWeightMode(mode)` | `weightMode()` |

- 实测（载入真包后）：`setSnap(true/false)` → `snap()` 正确；`setWeightMode('heat')` → `weightMode()` = `"heat"`；`setOnion({on:true/false})`、`setTrail(true/false)` 同样正确。

## 0.9.14 — 移除吸附 / 洋葱皮 / 轨迹，贴图强度改名透明度（2026-11-10）

**用户要求**：红框（吸附 / 洋葱皮 / 轨迹）从界面删除；黄框「贴图强度」改名「透明度」。

- 三项从 `.bar-view` 移除，控件**移入隐藏容器** `#hiddenToolControls`（`display:none`），能力保留。
- **「贴图强度」→「透明度」**：顶部滑块标签、`aria-label`、视图菜单里的滑块标题全部同步；状态字段名 `texAlpha` 不变（只改人读文案，不动数据契约）。
- 顺带把 `syncLayers()` 里对 `snapChk` / `snapState` / `weightMode` 的三处**未加空值保护**的访问改成 `if (node)` 形式——这是这轮唯一会真炸的隐患（控件移走后 `$("snapChk").checked = …` 会抛 TypeError，打断整条 `syncLayers()`，连带贴图滑块与图层勾选都不更新）。
- 界面残留实测：`.bar-view` 里可见子项只剩 `btnFit / zoomgrp / vsep / layers / alpha / btnPanel`，三项确实不在其中。
- 回归：`node --check` 0、`selftest` 3264/3264、`--check` 0。

## 0.9.13 — 移除第 2 排「编辑工具」UI，能力保留（2026-11-10）

**用户要求**：「我只是让你去除前端界面的操作区域，不代表底层功能也要剥夺，agent 一样要能调用」。

- **删掉整行 `.bar-edittools`**（19 个控件）：目标、坐标、文档模式、AutoKey、轴心补偿、IK + mix、镜像骨 / 镜像动画 / 写入镜像、未打键徽标、gate 徽标。界面现在只剩一行工具条。
- **控件没有从 DOM 里抹掉，而是移进 `hidden` 的 `<form id="hiddenToolControls">`**（`display:none` / 零尺寸 / `aria-hidden`）。理由：`syncEditToolbar()` 等函数大量做 `$("editTarget").value = …`、`pivotCompChk.checked = …` 这类**依赖元素存在的状态同步**；元素全删会让部分同步路径静默跳过。保留隐藏控件 = 界面不显示，但同步链 / 事件绑定 / 脚本读写全在。
- **能力实测全部可用（不是推断）**：

| 调用 | 结果 |
| --- | --- |
| `setTarget('attachment')` | `edit().target = "attachment"` ✅ |
| `setSpace('world')` | `edit().space = "world"` ✅ |
| `setAutoKey(false)` | `edit().autoKey = false` ✅ |
| `setMode('setup')` / `setMode('animate')` | `edit().mode` 正确切换 ✅ |
| `setPivotCompensate(true)` | 生效 ✅ |
| `setIkMode(true/false)` | `state.edit.ik.on` 切换 ✅ |
| `setIkMix()` / `mirrorRun()` | 函数仍在 ✅ |

- 隐藏容器实测：`display:none`、宽高均为 0，不占版面、不产生焦点。
- 回归：`node --check` 0、`selftest` 3264/3264、`--check` 0（44 处 `?v=` 同源）。

> **一个需要用户知道的取舍**：这行删掉后，**界面上不再有「绑定姿态 / 动画」切换入口**（右侧属性区 `#editBoneMode` 只是显示当前值，不是按钮）。UI 会保持当前文档模式，只能用 `setMode()` 切换。若要保留一个最小入口，需要另行指定放在哪里。

## 0.9.12 — 右栏开关定位改为 flex 尾项（2026-11-10）

- 0.9.10 用「绝对定位 + 行尾预留 40px」，在 1024px 宽下**反而把「贴图强度」挤到第二行**（自己制造的回归）。
- 改为 **flex 子项 + `order:99` + `margin-left:auto`**：宽屏落在同一行最右端；窄屏放不下时换到下一行**右端**，既不会压住滑块，也不会把原本能放下的内容挤下去。
- 实测（1280×800）：按钮与行 1 同高、距右 8px、内容最右 1006 ＜ 按钮左 1242，无重叠。
- 实测（1024×768）：按钮落在第二行右侧（x 986–1016, y 81–111），矩形求交与所有控件**零重叠**——`flex-wrap` 在 1024 下必然换行，这是可接受结果。

## 0.9.11 — 右栏收起淡出真正生效（2026-11-10）

- **自纠**：0.9.9 写的 `body.panel-hidden .inspector > * { visibility: hidden }` 是**即时生效**的，右栏内容瞬间消失、只剩空壳在收窄 —— 淡出等于没做。
- 改为 `visibility` 阶跃过渡 + `.2s` 延迟：内容**保持可见到动画结束**才切换 hidden；展开方向延迟为 0，内容立刻可见。
- 顺带纠正我自己的错误结论：上一步说「收起没有过渡」是**采样时机错了**（`browser_click` 之后另开一次 eval，中间隔了半秒）。同一次调用内连续采样证实两个方向都有过渡。
- 实测两个方向（宽度 / 透明度 / 内容可见性）：

| 方向 | t0 | t70ms | t150ms | t300–420ms |
| --- | --- | --- | --- | --- |
| 收起 | 300px / 1.000 / visible | 138.8 / 0.400 / visible | 10.5 / 0.013 / visible | 0 / 0.000 / **hidden** |
| 展开 | 0 / 0.000 / visible | 161 / 0.599 / visible | 285.8 / 0.978 / visible | 300 / 1.000 / visible |

## 0.9.10 — 右栏开关放到第 1 排右端（2026-11-10）

- `#btnPanel` 原先被我错放在第 1 排末尾当 flex 子项，1024px 下被换行挤到**第二行左侧**（`x=23,y=81`），完全不是用户指的位置。
- 改放到 `.bar-view` 内部并在 CSS 里定位到该行右端（0.9.12 换成 flex 尾项方案）。

## 0.9.9 — 右栏双向开关 + 淡入淡出（2026-11-10）

**用户需求**：把收起/展开图标移到第 1 排右侧（只显示图标、不带文字）；右栏原来的「收起」按钮改成 X 用来关闭；右栏也要淡入淡出；展开时上面的按钮也能收起。

- **结构死结一并解开**：原来只有 `#btnPanelClose`（单向关闭），重开靠「视图 → 面板」菜单；`syncPanel()` 里找的 `$("btnPanel")` **早就不存在**（注释写着 task-41 已移除）。新增的 `#btnPanel` 成为唯一双向开关。
- `#btnPanel`：只有 `panel` 图标、无文字，`aria-controls="inspector"`，点击 `setPanelOpen(!panelVisible())`；`aria-pressed` 反映真实展开态，**不再「展开后隐藏按钮」**。
- `#btnPanelClose`：改成 **X**（`#i-close`），只关闭；面板已收起时 `disabled`。
- 右栏淡入淡出：`.inspector` 加 `width/flex-basis/opacity/transform` 过渡，`body.panel-hidden` 从 `display:none` 改为「宽度收 0 + 透明度 0 + 位移」，**display 不可过渡**所以必须换。
- 窄屏（≤959px）右栏是抽屉，有自己的 `translateX` 动画；宽屏那套「宽度收 0」在该断点**显式还原**，避免两套动画打架。
- `.panel-toggle[aria-pressed='true']` 用「弱强调」而不是实心蓝，避免抢走真正被勾选的「贴图/骨骼」的注意力。
- 实测：X 点击后 `panel-hidden=true`、`#btnPanel` 的 `aria-pressed` 变 `false`、title 变「显示右侧面板」；顶部按钮在展开态点击可收起（双向）。

## 0.9.8 — 伸缩图标与工具图标对齐，箭头改角落角标（2026-11-10）

**用户反馈**：「这个伸缩展开图标没和下面对齐啊，`>` 这个图标怎么不也做在右下角」。

- **根因**：收起态把 `panel` 图标与方向箭头**一起行内居中**，箭头占 13px 宽度，把主图标**向左挤偏**，于是它和下面 9 个工具图标不在同一条竖线上。
- **修复**：收起态箭头改为**角落角标**（`position:absolute; right:1px; bottom:0; 10×10`），与快捷键字母 `.rail-k` 同一套定位语义；`panel` 图标恢复居中。展开态箭头回到行内最右端并 `rotate(180deg)`（`order:2` 保证排在「图标 → 文字」之后）。
- **用坐标验证对齐，不是目测**：

```
主图标中心 X：railToggle=22, railSelect=22, btnToolMove=22, btnToolRotate=22,
              btnToolScale=22, btnToolPose=22, btnToolPan=22,
              btnZoomInRail=22, btnZoomOutRail=22, btnFitRail=22
allAligned = true

角标位置一致性：箭头 right=2 / bottom=1  ←→  快捷键字母 right=3 / bottom=1
```

- 展开态复核：箭头 `position:static`、`transform:matrix(-1,0,0,-1,0,0)`（即 180°）、
  x 顺序 `图标 9 < 文字 33 < 箭头 111` —— 正确。
- 纯 CSS 改动，不动 JS；`node --check` 0、`selftest` 3264/3264、`--check` 0。

## 0.9.7 — 工具条伸缩：修掉「淡入其实没生效」（2026-11-10）

- **自纠一个真 bug**：0.9.5 用 `display: none → block` 配 `opacity` 过渡做淡入。但 CSS 里 **`display` 不可过渡**——从 `none` 切到 `block` 时元素是「新出现」的，`opacity` 的 transition 压根不触发，实际是**瞬间出现、没有淡入**，即用户要的淡入淡出等于没做。
- 改为 `max-width: 0 → 96px` + `opacity: 0 → 1` 双属性过渡（两者都可过渡）；收起态文字宽度为 0、不占位，效果与 `display:none` 等价。
- **实测过渡真的在跑**（逐帧采样，不是只看终态）：

| 方向 | t≈0 | t≈60ms | t≈150ms | t≈420ms |
| --- | --- | --- | --- | --- |
| 展开 | op 0 / maxW 0px / 条宽 44 | op 0 / maxW 43.4px / 条宽 84 | op 0.733 / maxW 92.9px / 条宽 129 | op 1 / maxW 96px / 条宽 132 |
| 收起 | op 1 / maxW 96px / 条宽 132 | op 0.331 / maxW 38.4px / 条宽 79 | op 0.0045 / maxW 2.1px / 条宽 46 | op 0 / maxW 0px / 条宽 44 |

- 遵守既有 `@media (prefers-reduced-motion: reduce) { * { transition: none !important } }`（没绕过它写私有动画）。
- 排版顺序用 `order` 修正：DOM 里 `.rail-k` 在 `.rail-label` 之前，展开态下靠 `order: 1 / 2` 排成「图标 → 文字 → 快捷键」。

## 0.9.6 — 工具条伸缩：不再误用「选中态」高亮（2026-11-10）

- 伸缩按钮原先同时设了 `aria-pressed="true"`，而 `.rail-btn[aria-pressed="true"]` 会渲染成实心蓝色 —— 结果**伸缩按钮与当前选中工具两个都是蓝的**，看起来像同时选中了两个工具。
- 改为只设 `aria-expanded`（语义就是展开/收起），`aria-pressed` 显式 `removeAttribute`；展开时用「弱强调」样式（浅底 + 边框），不与工具选中态抢。
- 实测：整条工具条里 `aria-pressed=true` 的只剩当前工具（`btnToolMove`）一个。

## 0.9.5 — 左侧工具条伸缩开关（2026-11-10）

**用户需求**：左侧竖向工具条加一个伸缩栏图标，当前状态是收起；展开时显示工具详细名称，展开要有淡入淡出动画。

- **DOM**：新增 `#railToggle`（`icons.js` 现成的 `panel` 图标 + `chevron-right`，展开时 `rotate(180°)` 成左箭头，指明「往哪边收」）；9 个工具按钮各加 `<span class="rail-label">` 文字名。
- **尺寸**：收起 44px（只有图标 + 右下角快捷键角标），展开 132px；文字超长省略号。
- **可发现性**：收起态**保留完整 `title`**（动作 + 键位 + 影响谁），不因没有文字而失去说明。
- **持久化用独立键** `dsh.character-editor.railExpanded`，**刻意不进 `prefs`**：`prefs` 有 `PREFS_VERSION` 严格校验，版本不符会整份回退默认（`layout`/`shortcuts`/`models` 全丢）——为一个展开态动那个版本，代价是用户可能丢快捷键定制。localStorage 不可用时静默收起、不报错。
- **窄屏（≤960px）**：工具条本来就是横排，展开会把画布挤没，所以该断点下隐藏伸缩按钮、文字一律不显示。
- 验收：展开/收起后条宽 44 ↔ 132、文字 `opacity` 0 ↔ 1、`localStorage` 记 `"0"`/`"1"`，**刷新页面后仍恢复展开态**。

## 0.9.4 — 端口自识别支持仓库相对路径（2026-11-10）

**现场症状**（用户环境）：日志里 `GET /api/packs` 全是 `404`，而同一台机器另一个端口正常。同时启动时报
`'--strict-port' is not recognized as an internal or external command`，并把 8123 判成「被 PID … 占用（无法确认为本仓库的 serve.py）」。

- **根因（与「扫描不到」是同一个）**：`serve.py` 判断端口占用者是不是自己人时，**只认绝对路径**。旧实例的命令行是相对路径
  `python.exe tools/character-editor/serve.py --port 8123`，于是被判成「别人」→ 不替换 → 悄悄换到 8124 →
  **用户在 8124 上看到的是旧进程的旧代码**（磁盘上新了，内存里没新）。这解释了「你浏览器读不到 / 调试视图读得到」。
- **修复**：抽出 `_script_self_identifies(arg)`，在绝对路径比对之外**再认一种确定形态**——仓库相对路径与本脚本
  相对仓库根的路径**完全一致**（如 `tools/character-editor/serve.py`）。这是有意收窄：不猜对方进程的 cwd。

| 进程命令行 | 判定 |
| --- | --- |
| `python.exe "F:\…\tools\character-editor\serve.py" --port 8123` | ✅ 自己人 |
| `python.exe tools/character-editor/serve.py --port 8123` | ✅ 自己人（**新增**） |
| `py -3 tools/character-editor/serve.py` | ✅ 自己人 |
| `python.exe serve.py --port 8123` | ❌ 裸文件名，无法确定仓库 |
| `python.exe .\serve.py` / `-m serve` / 别的目录的 serve.py / `node.exe …serve.py` | ❌ |

- `start.bat` 保持传 `%~dp0` 绝对路径（两个方向都更稳，也便于在任务管理器里认出脚本）。
- 验收：`py_compile` 0；8 条命令行判定用例符合上表；两个端口 `/api/packs` 均 200 / count=1。

## 0.9.3 — 修复平移竖向反向（2026-11-10）

**用户报告**：「斜向拖动画布四个方向都是反的」。

- **根因**：`panX` 与 `panY` 进视图变换的符号**不一致**——`tx = W/2 + panX`（加），`ty = H/2 - panY`（减，因为世界 +Y 朝屏幕上方）。但拖动时两者都写成了 `+= Δ`，于是竖向被减号反了一次：鼠标下移 → `panY` 增大 → `ty` 减小 → 画面**向上**跑。
- **修复**：`state.panY = d.panY - (p.y - d.startY)`（一行）。`panX` 保持不变（它本来就对）。
- **实测（不是推断）**，用真实指针拖动并读 `proj(0,0)`（画面原点在屏幕上的位置，应与鼠标同向同量移动）：

| 鼠标动作 | panX | panY | `proj(0,0)` | 结论 |
| --- | --- | --- | --- | --- |
| 右下 (60, 60) | +60 | −60 | (325,568) → (385,628) | ✅ 跟手 |
| 左上 (−60, −60) | −60 | +60 | (385,628) → (325,568) | ✅ 跟手 |

  改前同一次右下拖动是 `dPanY=+60`、`proj(0,0)` (325,568) → (325,256)（画面往上跑）。
- **副作用审查**：另外三个写 `panY` 的地方（`fitView` 居中、`zoomBy` 锚点补偿、`zoomReset`）都按 `ty = H/2 - panY` 这个约定推导，与本次修复同向，未受影响（`selftest` 3264/3264、`--check` 0）。

## 0.9.2 — 本地项目改为菜单分组（2026-11-10）

**用户纠正**：「我说的这个本地项目应该是分割线标题，不是单独列表项，一个被扫描到的人物包才是一个列表项」。

0.9.0 做成了「本地项目…」单个菜单项 → 点开弹窗列表。形态错了：它应该是**分组标题**，包才是列表项。

- 文件菜单结构改为：

```
文件
├ 载入文件… / 保存文件 / 另存文件
├ ────────────────
├ 本地项目                 ← menuTitle()，不可点
└ 鲸鱼娘  v0.2.0           ← 一个包 = 一个 menuItem()
   workspace/packs/deepseek
```

- **删掉整个弹窗**：`#packBrowser` 的 DOM、`.pack-browser` / `.pack-row` 等 20 条 CSS、`openPackBrowser` / `closePackBrowser` / `packBrowserVisible` / `fetchPackList` / `packRow` 全部移除；`onKeyDown` 里那段「弹窗打开时不劫持快捷键」也随之删除（不再需要）。
- 新增 `refreshLocalPacks()` / `renderLocalPacks()` / `packMenuItem()` / `onPickPack()`；状态加 `state.localPacks`（`{packs, error}`，失败时**保留上一次成功结果**）与 `state.localPacksBusy`（防并发重复扫）。
- **每次展开文件菜单都重扫一次**：包可能刚被 `compile_pack.py` 编出来，不用手动刷新。
- 扫描失败只影响这一组：组内显示一行原因，载入/保存三项照常可用。
- 菜单说明仍受 0.8.11 的单行约束；体积/许可/问题原因放到 `title`（悬停可见），不在菜单里铺成多行。
- 验收（浏览器实测）：

| 项 | 结果 |
| --- | --- |
| 菜单 DOM | `menu-title`(本地项目) + `menu-packs#menuFilePacks` → `menu-item`(鲸鱼娘 v0.2.0 / workspace/packs/deepseek) |
| 点包 | `GET /workspace/packs/deepseek/manifest.json` 200 → `model.json` / `model.atlas` → `label=鲸鱼娘`、21 动画 / 37 槽、`isLocal=false`、`canSave=true`、菜单自动收起 |
| 回归 | `node --check` 0、`selftest-node` 3264/3264、`--check` 0、`py_compile` 0 |

## 0.9.1 — 本地项目接口挂进调试句柄（2026-11-10）

- `__characterEditor` 增 `fetchPackList` / `openPackBrowser` / `closePackBrowser`：agent 不开界面也能列 `workspace/packs` 下的包。
- 实测：`fetchPackList()` → `count=1`、`packs[0].path="workspace/packs/deepseek"`。

## 0.9.0 — 文件菜单「本地项目…」：扫描 workspace/packs（2026-11-10）

**用户需求**：文件菜单加「直接加载本地人物包」，路径暂时扫 `workspace/packs`，自动读元信息，展示一部分，用相对路径。

- **后端加了一个只读接口**（`serve.py`）：`GET /api/packs`
  - 扫 `workspace/packs/*/manifest.json` —— **只扫一层**，不递归进包内部，避免把包里备份的 manifest 当独立项目
  - 每包返回：`path`（相对路径）/ `id` / `version` / `label` / `packFormatVersion` / `manifestSchemaVersion` / `license` / `creditsCount` / `animCount` / `slotCount` / `catalogGeneration` / `fileCount` / `bytes` / `hasVoice` / `hasSequences` / `official` / `issues`
  - **版本口径与 `bundle.js` 同一套**：`packFormatVersion != 3` 或 `manifestSchemaVersion != 2` 直接进 `issues`，用户在列表里就能看到「这包编辑器会拒收」，不用点了才发现
  - **健壮性**：单包损坏不拖垮整体（返回 `ok:false` + 原因，其余照列）；目录大小有 200MB 预算，超限停止累加但仍计数文件；扫描异常返回 `ok:false` 而不是 500
  - **只读**：完全不碰 `SAVE_LOCK` / `perform_save`，沿用既有 `request_host()` 回环校验
- **前端**：文件菜单加「本地项目…」→ 弹出项目列表（复用现有 `.modal` 结构，不新造范式）
  - 每行展示：名字 · 版本 · **相对路径**（等宽单行，超长省略号）· 动画/槽/文件/体积/许可 · 语音·序列·格式版本 · 问题徽标
  - 点一行 → 直接走既有 `loadIndexByPath("<相对路径>/manifest.json")`，**与「载入路径」同一条链路**，不新增第二套载入逻辑；弹窗自动关闭
  - 有「重新扫描」按钮；无包 / 服务未起 / 扫描失败各有明确文案
  - 弹窗打开时**只放行 Esc，其余快捷键一律不劫持**（否则列表里按 `V`/`R`/`K` 会被画布快捷键吃掉）
- 验收（浏览器实测，非推断）：

| 项 | 结果 |
| --- | --- |
| `GET /api/packs` | 200，`count=1`，`label=鲸鱼娘`、`animCount=21`、`slotCount=37`、`fileCount=63`、`bytes=5703381` |
| 菜单项 | 文件菜单出现「本地项目…」，说明单行 |
| 点行载入 | 请求 `/workspace/packs/deepseek/manifest.json` → `label=鲸鱼娘`、21 动画 / 37 槽 / 37 骨、`isLocal=false`、`canSave=true` |
| 画面 | 角色正常渲染，idle 3.50s，状态栏「已自动载入语音包：deepseek」 |

## 0.8.13 — 菜单说明宽度封顶（2026-11-10）

- `.menubar .menu` 加 `max-width: min(360px, calc(100vw - 16px))`：0.8.11 的单行约束成立后，超长说明会**把菜单横向撑开**（实测 271 → 410px），比换行更难看。
- 改为宽度封顶 + 省略号：长文案只在 360px 内单行截断，菜单宽度稳定，`title` 里仍保留完整文本可悬停查看。
- 实测（人为塞入一条 40+ 字的长原因）：`lines=1`、`ellipsis=true`、菜单宽度封顶 360px 不再继续增长。
- 纯 CSS，不动逻辑；3264/3264 不变。

## 0.8.11 — 菜单说明强制单行（2026-11-10）

- 用户要求「红框里的描述精简到只显示一行」。**在 CSS 层强制，不靠把文案写短糊过去**：`.menu-note` 加 `white-space: nowrap` + `overflow: hidden` + `text-overflow: ellipsis`，任何长度的说明都只能占一行，超出即省略号。
- 文案同时精简：`载入文件…` 的说明从「选整个包目录（含 manifest.json）；模型、图集、贴图与语音按包根相对读取」（**唯一一条会占 2 行**）压成「选整个包目录（含 manifest.json）」。后半句并非丢失——包根相对读取是 manifest 的既定语义，已在 §载入 文档里。
- 四个菜单全部实测（把面板临时 `hidden=false` 逐条量 `scrollHeight / lineHeight`）：文件 3 条、编辑 1 条、视图 1 条、帮助 1 条，**全部 `lines=1`、零换行**。

## 0.8.10 — 保存提示不再写 index.json（2026-11-10）

- 4 处**禁用态文案**还写着旧入口名，而 v3.2 早改成 `manifest.json` 了；这些字平时常驻灰色条上，会把人往错文件引：
  - `saveReason` / `archiveReason`：`尚未载入；请选择 index.json` → `manifest.json`
  - `saveReason` 无写回目标分支、`canArchiveNow` 缺字节分支：同样改口径
  - `archiveReason` 成功态：`打包 index.json + model + atlas + 贴图` → `manifest.json`
- 纯文案，不动逻辑；`node --check` 通过、3264/3264 不变。

## 0.8.9 — 文件菜单简化（2026-11-10）

- **按用户红框删掉三组**（用户拍板「简化界面，后端不动」）：

| 删除 | 原内容 |
| --- | --- |
| 事件 | 事件测试… / 载入语音包… |
| 示例 | deepseek 女仆 / deepseek 旧版三视图 |
| 测试样张（fixtures） | 所有 `fixtures/*` 条目 + 「其余 N 个样张」 |

- 文件菜单现在只有 **载入文件… / 保存文件 / 另存文件** 三项（含 `Ctrl+S`）。
- **这是收入口，不是删功能**（删前逐个核对可达性）：

| 功能 | 现在怎么到 |
| --- | --- |
| 事件分页 | 右栏「事件」标签直接点开（`openVoice()` 只是切标签的糖） |
| 语音包 | 随 `manifest.voice.index` **自动载入**，不需要手动选文件 |
| fixtures | `selftest.html` 仍跑全部断言；`__characterEditor.loadFixture()` 脚本接口仍在 |
| 示例 | 本仓 `assets/characters/` 无包数据（点了本来 404）；空状态卡片「查看示例」按钮仍在 |

- 清掉 `syncMenus()` 里两条指向已删条目的 `syncMenuEntry("voiceTest"/"voiceLoad")` 调用（指向不存在的 ref 会静默失效，留着是死代码）。
- `buildFileMenu()` 顶部留了注释，说明删了什么、为什么可达性没破——避免以后有人以为是误删而加回来。
- `node --check` 通过、3264/3264 不变。

## 0.8.8 — 拖入提示不再承诺「拖整个目录」（2026-11-10）

- 修掉一句**不成立的提示**：拖入单个 `manifest.json` 时报错文案原本写「也可以拖动整个包目录到画布」。拖入走 `dataTransfer.files`，浏览器只给文件、不给目录结构，本编辑器也没有 `webkitGetAsEntry` 递归 —— **拖目录实际不成立**，这句话会把人引到死路。
- 改为只承诺两条真实可用的路：「载入文件…」的目录选择器、或「载入路径」直接填包目录；同时给出 `?index=<包>/manifest.json`。
- 纯文案改动，不动逻辑；`node --check` 通过、3264/3264 不变。

## 0.8.7 — `normalizePackPath` 下移并补测试（2026-11-10）

- **结构修正**：0.8.6 的 `normalizePackPath` 写在 `app.js` 的 IIFE 里，而 `app.js` 依赖 DOM、**不参与 Node 自测** —— 这个纯函数因此**结构上测不到**（不是漏写）。按本仓既有分层（纯函数在 `bundle.js`、`app.js` 只管 DOM/状态）下移到 `bundle.js` 并导出；`app.js` 改为**委托调用**，`bundle.js` 未加载时返回明确错误而不是静默放行。
- 新增 **21 条**断言（`core` 套件 1182 → 1202，总数 3244 → **3264**）：

| 类别 | 覆盖点 |
| --- | --- |
| 接受 | 包目录补 `manifest.json`、尾斜杠、多尾斜杠、首尾空白、`./` 前缀、重复斜杠、已是入口文件、旧包 `index.json` |
| 剥 URL | 整条 URL 的 `?index=`、值已含入口名、`%2F` 编码值 |
| 拒绝 | 空、全空白、`/` 开头、反斜杠、`..`、`file:`、其他协议、非入口 `.json` |
| 契约 | 失败分支**不得**带 `value` |

- `node --check` 三文件通过；`selftest-node.mjs` 3264/3264；`bump-editor-version --check` 通过（44 处 `?v=` 同源）。
- 行为对用户**无变化**（同一套规范化规则，只是换了个文件），纯内部重构 + 补测。

## 0.8.6 — 载入路径（服务端读取，2026-11-10）

- **新增「载入路径」**（空状态卡片，输入框 + 打开按钮 + 回车）：填**仓库相对路径**，编辑器自己 `fetch` 读包 —— 这是对「怎么是上传不是读取」的直接回应。此前只有目录选择器（上传语义），服务端起好了也得手动选文件。
- 新增 `normalizePackPath`（纯函数、无副作用）：包目录自动补 `manifest.json`；接受 `…/manifest.json` 与旧包 `…/index.json`；粘贴整条 URL 时剥 `?index=` 前缀；**拒绝**以 `/` 开头、反斜杠、`..`、`file:` 地址、非入口 `.json`，每类给**具体原因**而非通用兜底。
- 成功后把规范化值写回输入框并记住（`prefs.packPath`），下次打开自动填；输入时清掉 `is-bad` 红框。
- 与「选包目录（离线）」保持**两条独立入口**：载入路径 = server 语义（可保存）；选包目录 = 本地语义（保存禁用、另存 ZIP 可用）。
- `ui.css` 增 `.path-load` / `.path-load-row` / `.path-load-input` / `.is-bad` / `.path-load-hint` 一组样式。
- 验收：填 `workspace/packs/deepseek` → 自动补成 `…/manifest.json` → `label=鲸鱼娘`、`entryKind=manifest`、21 动画 / 37 槽、`isLocal=false`、notices 空。

## 0.8.5 — 本地目录载入，解除 v3.2 manifest 硬拒绝（2026-11-10）

- **「文件 ▾」→ 载入文件…** 从单选 `index.json` 改为**选整个包目录**（`#filesDir`，`webkitdirectory directory multiple`）：v3.2 的包根相对路径拿不到包根，单文件入口在结构上就不成立。单文件入口保留给旧包与语音包。
- `bundle.js` 新增 `normalizeLocalPath` / `shouldIgnoreLocalPath` / `buildLocalTree` / `localTreeLookup`（纯函数，Node 可测）：先扫全部 `manifest.json`（次选 `index.json`）定位包根，`manifest.json` 优先、同级取最浅；忽略 `.DS_Store` / `__MACOSX` / AppleDouble `._`；key 按包根归一；查找大小写不敏感回退。
- `app.js` 新增 `state.localTree` 等字段；`fetchBytes` 与 `voiceFetchWithTimeout` **双路径**（本地模式返回合成 `Response`，命中 200 / 未命中 404），因此 10 处语音/索引调用方 `.ok/.status/.text()/.arrayBuffer()` **零改动**即可命中；新增 `loadDirFiles` / `clearLocalTree` / `localObjectUrl` / `pickPackSource`。
- **本地模式下就地保存禁用**并给明确理由（返回 `false`，不抛异常）；另存 ZIP 仍可用；「示例」在本地模式下被拦下并说明原因。
- 收尾后 `app.js` 只剩 4 处 `fetch`：`fetchBytes` / `voiceFetchWithTimeout` 的回退分支 + `/api/save-bundle` + `/api/capabilities`。
- `selftest.js` 新增 `buildLocalTree` / `localTreeLookup` / `normalizeLocalPath` 断言 **22 条**；总数 3222 → **3244**。
- 验收：模拟 63 File 载入 → `localTree` 63、21 动画 / 37 槽 / 34 事件 / 34 表情 + 7 槽位、零诊断；server 模式 `?index=…/manifest.json` 回归同值且 `canSave: true`。
- 版本戳 0.7.9 → 0.8.5（中间 4 次迭代 bump），`--check` 通过：44 处 `?v=` 与 `version.js` 同源。

## 0.7.8 — 自由变换提交与顶栏收口（2026-11-09）

- **自由变换修复**：Enter 之前只置 dirty/undo 却不落数据（手势停在 transient 预览）——新增 `ftMaterialize()`，提交时按模式写数据：动画+AutoKey 写当前 Key，绑定姿态写基础值；Esc 仍全回滚、一次 Undo。
- **顶栏两排恢复**：视图/显示层排（贴图/骨骼/网格/权重/吸附/洋葱皮/轨迹/权重配色/贴图强度）+ 编辑工具排（目标/坐标/绑定姿态|动画/AutoKey/轴心补偿/IK/镜像/未打键徽标）；控件从「更多」与属性顶部**移动**而来，重复 id = 0。
- `setEditMode` 补 `syncChrome()`：切绑定姿态/动画后顶部按钮 aria 与状态同步。
- 自由变换逐手柄验收：角点等比缩放（scaleX=scaleY=2.525689689675872）、旋转圆柄（rotation=-48.611657）、框内移动（70.509/116.920）、Enter 提交、Esc 回滚、单次 Undo；无选中/播放中/目标=部件三种禁用均零写入。
- 未验证：World 旋转 + 父级非均匀缩放的不可表达 gate 未端到端演练（rig-base gate 全通过）。

## 0.7.6 — 顶栏恢复（2026-11-09）

- **恢复两排顶部控制条**（用户反馈「之前的顶部控制栏还可以」）：第 2 排 = 视图 / 显示层（适配、缩放、贴图/骨骼/网格/权重、吸附、洋葱皮含范围、轨迹、权重配色、贴图强度），第 3 排 = 编辑工具（目标、坐标、文档模式、AutoKey、轴心补偿、IK 含 mix、镜像骨/动画/写入、未打键与 gate 徽标）。
- 控件是**移动而不是复制**：`#moreSection` 与画布角、属性顶部的重复入口一起删除，全文件同名 id 只有一份（脚本核对 0 重复）。
- 单一界面不变：没有「简单 / 高级」按钮，也没有 `state.ui.mode`；文档模式仍是**文档模式**（绑定姿态 / 动画），不是界面模式。
- 修复：切换文档模式后顶部按钮 `aria-pressed` 立即同步（`setEditMode` 内补 `syncChrome()`）。
- 布局实测：1280×800 顶栏 113px（洋葱皮范围展开 138px）、rail 44px、右栏 300px、无横向滚动；900×700 窄屏按逻辑组换行。

## 0.7.4 — 自由变换与收尾（2026-11-09）

- **自由变换会话**（PS 心智，不占用浏览器 `Ctrl+T`）：可见「自由变换」按钮 / `Shift+T` 进入，画布显示几何包围框 + 角点等比缩放柄 + 旋转圆柄；框内拖动=移动，`Enter` 一次提交（一条 Undo），`Esc` 全回滚。
- 帮助改版：快捷键速查（注明 Space 按活动区域）+ 每区一句话；右键菜单补齐画布/时间轴/图层三类。
- 版本里程碑标注改为「单一界面」；修复收尾期的探针/焦点/样式回归。

## 0.7.2 — 单一界面收尾（2026-11-08）

- **合并双模式**：彻底删除「简单 / 高级」开关（`state.ui.mode`、`isSimple()`、`#simpleTop`、`#uiModeSwitch`、`body.mode-simple/advanced` 及其 29 条 CSS 隐藏规则）。只有一套界面、一套 DOM、一套数据链路；`prefs.ui.mode` 旧值读取时丢弃、不再写回。
- **顶栏减负**：删除整条专业「视图/显示层条」；顶栏只剩一行（实测 39px）——菜单 + 文档名 + `● 未保存` + 撤销/重做 + 保存 ▾。显示层 / 吸附 / 洋葱皮 / 轨迹 / 目标 / 坐标 / IK / 镜像 / 轴心补偿 / 贴图强度全部移入右栏「更多」分区（仍在「视图」菜单保留一份显示层与吸附入口）。
- **右栏重构**：300px「图层 + 属性」上下两栏。上=部件列表（搜索 / 显示顺序 / 骨骼层级）；下=属性常用区（文档模式二段、AutoKey、位置 X/Y、旋转、缩放、`◆ 打关键帧`、关键帧状态）。`更多` / `片段库` / `骨架结构` / `调试` / `更多面板（事件·表情·动画）` 默认折叠，同一面板内展开，不是第二个界面。
- **左侧竖向工具条**：44px，`Q` 选择 / `V`·`G` 移动 / `R` 旋转 / `S` 缩放 / `W` 指向 / `H` 平移视野 / `+ −` 缩放 / `F` 看全；9 个 tooltip 均为「动作 + 键位 + 影响谁」。
- **单一时间轴**：删除第二套底部「位置关键帧」小条（`#simpleTrackWrap` 及其 canvas/hint/toggle 与 `drawSimpleTrack/syncSimpleTrack/simpleTrackHit/onSimpleTrackDown`）；所有 Key 编辑都走唯一 `#dopesheet`（轨道树 + 时间轴 / Graph 同面板）。
- **Space 按活动区域裁决**：指针在画布 / 图层区 = 按住平移；在时间轴 / 播放条 = 播放暂停。不再看 dopesheet 是否展开。
- **统一键位表**：`V`/`G` 移动、`Q` 选择、`R`/`S`/`W` 旋转/缩放/指向、`H` 平移视野、`K` 打键、`Delete` 删键、`P` 播放、`F`/`Shift+F` 看全、`Tab` 时间轴；输入框/下拉/菜单聚焦时不劫持。
- **右键菜单**：画布 / 时间轴 / 图层三类，各 7–8 项（打键、删键、复制粘贴、全选、显隐、锁定、层级上下移、洋葱皮、吸附、看全、Graph 切换、展开收起时间轴等），全部走既有命令与 gate；不适用项置灰并在 tooltip 说明原因；`Esc` / 点空白 / 窗口缩放关闭。
- **帮助改版**：删掉旧的双模式说明与 7 条简单帮助，改为「每个区域一句话 + 快捷键速查（注明 Space 按区域分工）+ 可自定义快捷键 + 保存与撤销 + 版本」。
- **保留**：页内确认模态（Enter 确认 / Esc 取消 / 焦点归还）、未保存保护（`beforeunload` + 四选一）、人话错误提示、`version.js` 单一来源与 `--check`、全部专业 debug 句柄。
- **`simple.*` 保留为位置快捷命令**：13 个方法语义不变（`NEED_ANIMATE_MODE` / `CONFIRM_REQUIRED` + `pending{token,action,target,docRev}` / `save()` resolve 即落定 `settled:true`）；`status().uiMode` 恒为 `"single"` 以兼容旧脚本；不再依赖任何界面布局或折叠状态。

## 0.4.4 — save 落定契约（2026-11-08）

- **修复**：`simple.save()` 在保存链路落定前 resolve（agent 会读到旧的 `dirty/undo` 并误判/重复保存）。现在 `simpleSaveOriginal()` 会 `await saveToDisk()`，resolve 时已重建模型、更新基线、清空历史；返回 `data:{settled:true,dirty,undo}`。
- `simple.save()` 改为 async；copy 路径同样带 `settled:true`（但按语义**不清 dirty**）。
- 失败返回 `SAVE_FAILED`「没有保存成功，调整还在。请重试或下载副本。」，不再先报成功。
- 排查 `deleteKey`/`undo`/`redo`：均为同步落定，无同类竞态。

## 0.4.3 — 简单模式数据安全与确认体验（2026-11-08）

- **修复**：`simple.dragPose/setKey/deleteKey` 在非动画上下文会误写 Setup（`boneList/model.bones`）→ 现在一律 `NEED_ANIMATE_MODE` 零写入拒绝，绝不偷偷切模式。
- **修复**：简单模式所有确认改为页内模态 `#simpleConfirm`（切高级 / 删单 Key / 保存到原包 / 未保存切包），Enter 确认、Esc 取消、焦点归还；不再用 `window.confirm`（会挂起自动化）。
- `CONFIRM_REQUIRED` 统一返回 `pending:{token,action,target,docRev}`（保留 `data.confirmToken`）。
- **新增**：未保存保护——`beforeunload` 提示 + 打开另一个包/上次打开的包前的四选一（保存 / 下载副本后继续 / 放弃 / 取消），下载失败不得继续。
- 修正「保存到原包」确认文案错字。

## 0.4.0 — 简单模式（2026-11-08）

- 默认进入**简单模式**（面向 PS/Flash 用户）：六大动作 + 单行「位置关键帧」；高级模式一键切换并保留全部 P0–P2 能力。
- 画布同一次按下即可拖动角色（命中可见图形 → 绑定部位），松手写一个位置 Key；播放中禁编辑。
- 简单模式真隐藏专业入口（Graph/Dopesheet/坐标/工具/AutoKey/洋葱皮/轨迹/镜像/片段库/IK/骨架结构/约束与形变轨/批量），隐藏的快捷键不会后台生效。
- 简单文案人话映射（禁词表见 README），未知错误统一兜底；危险操作确认（覆盖原包 / 下载副本 / 删单 Key / 切高级）。
- `window.__characterEditor.simple.*` agent 接口（`CONFIRM_REQUIRED` 一次性 token、`status()` 只读快照）。
- 修复：debug 对象重复的 `trackRows` 键；简单拖动打键时序；简单删 Key 走 P0 `animRemoveKey`。

## 0.3.0 — P2 收口（2026-11-08）

- 轨道可视化编辑：事件 / 绘制顺序 / 形变 / ik / transform / path 六类轨道进 Dopesheet（全部经 `track-edit.js` 规划，失败零改动）；槽附件切换轨。
- 轴心补偿、洋葱皮、运动轨迹。
- 镜像（选中骨 / 整条动画）、片段库（localStorage，跨骨架拒绝）、Setup 姿态预设。
- 两骨 IK 交互（`ik-aim.js` 照官方 `apply2`）、骨架结构工具（新建 / 重父级 keepWorld / 重命名含动画轨迁移 / 删除被引用拒绝）、`validateSkeleton` 常驻与保存前后校验。
- 新建形变只列官方可加载的 mesh/加权 mesh（region 形变属非官方扩展，界面不列）。
- 编辑器版本号单一来源（`version.js`）+ `scripts/bump-editor-version.mjs`（`--check` 校验 `?v=` 同源）。

## 0.2.0 — P1

- Graph 曲线视图（Linear/Stepped/Bezier、手柄拖动、Key 时间+值拖动）。
- 子轨道搜索 / 过滤 / 锁定 / 隐藏；多选 / 框选 / 批量移动；复制 / 粘贴。
- 快捷键定制、布局持久化、Local/Parent/World 坐标系、槽组与语音包联动。

## 0.1.0 — P0

- 载入 Spine 4.2 runtime JSON（`?index=` / 文件 / 拖入），画布渲染 region / mesh / 加权 mesh。
- 骨骼选中与 gizmo（V/R/S/Pose）、摆位编辑、撤销/重做、导出补丁。
- 时间轴（Dopesheet）、Key 增删拖动、Auto Key / 未打键保护。
- 就地保存（`serve.py` + `/api/save-bundle`）与另存 zip。