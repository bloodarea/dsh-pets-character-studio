# 内置人物包管理器（零依赖，本地用）

此工具在 DSH Pets 与 DSH Pets Character Studio 两个项目均保留完整副本。桌宠仓库用于已有包的编辑、预览与调试；完整制作流程见 [Character Studio](https://github.com/bloodarea/dsh-pets-character-studio)。工具从当前仓库读取资产，不直接写入另一仓库。导出的 ZIP 只包含 Spine 子包。

一个不用装任何依赖的网页小工具：**在画布上选骨骼、用移动/旋转/缩放手柄改姿态**，在 **绑定姿态 / 动画** 两种模式间切换，
编辑骨骼关键帧（可展开 Dopesheet：时间标尺、播放头、Key 增删拖、Graph 曲线、多选/复制粘贴、Undo/Redo），也能**手动微调部件摆放与绘制顺序**、
**预览动画、看骨骼与 IK、看网格与权重**。载入一个 `index.json` 就能看整包；调好后可以**就地保存回索引目录**
（骨骼字段 + 动画 Key + region 附件补丁），或**另存一个 zip 整包**。产出与 spine-pack 流程兼容。

## 启动

三平台都是一条命令，**不需要 pip 安装任何依赖**（只用 Python 3 标准库）：

| 平台 | 命令 |
| --- | --- |
| Linux / macOS | `./tools/character-editor/start.sh` |
| Windows | 双击 `tools\character-editor\start.bat`，或命令行 `start.bat` |

脚本会：检查端口（默认 8123）→ 在**仓库根目录**起静态服务 → 打开浏览器。
用 `--port 9000` 指定端口，`--no-browser` 只起服务。

**端口被占用时**：

- 占着的是**当前仓库同一路径的旧实例** → 先结束它，再接管同一个端口；
- 占着的是**别的程序** → 不杀它，打印占用者（PID + 命令行）并改用下一个空闲端口；想直接报错用 `--strict-port`；
- `--no-restart`：不结束旧实例，直接换空闲端口。

等价的手工方式（**只读**：能载入与另存 ZIP，保存文件置灰；就地保存需要 `serve.py`）：

```bash
cd <仓库根目录>
python3 -m http.server 8123 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:8123/tools/character-editor/
```

要就地保存时用：

```bash
python3 tools/character-editor/serve.py --port 8123 --no-browser
```

> 为什么必须起服务：编辑器要 `fetch` 同仓库的模型与图集图片，浏览器对 `file://` 的 fetch 一律拒绝。

## 载入

v3.2 起包的**唯一入口是包根 `manifest.json`**（`manifestSchemaVersion: 2`）；旧包的 `spine/index.json` 已废除，
只记一条日志并拒绝（提示用 `compile_pack.py` 重新编译）。入参只给**包根目录或入口文件名**，
模型 / 图集 / 贴图 / 语音 / 事件 / catalog 的路径全部由 manifest 按**包根相对**推导，编辑器不猜。

界面提供两条独立入口，语义不同，别混用：

| 入口 | 语义 | 需要服务 | 就地保存 |
| --- | --- | --- | --- |
| **载入路径**（空状态卡片 / 推荐） | 填**仓库相对路径**，编辑器自己 `fetch` | ✅ 必须 | ✅ 可用 |
| **选包目录（离线）**（「文件 ▾」→ 载入文件…） | 弹目录选择器（`webkitdirectory`），整包读进内存 | ❌ 不需要 | ❌ 禁用（另存 ZIP 可用） |

载入路径的规范化规则（`normalizePackPath`，拒绝时给**具体原因**，不是通用兜底）：

- 填包目录 `workspace/packs/deepseek` → 自动补成 `…/manifest.json`
- 也接受直接填 `…/manifest.json`，或旧包的 `…/index.json`
- 粘贴整条 URL 也行：自动剥掉 `?index=` 前缀，其余带协议的地址拒绝
- 拒绝：以 `/` 开头（站点根）、反斜杠 `\`、包含 `..`、`file:` 本地地址（改用「选包目录」）、非入口的 `.json`
- 成功后把规范后的值写回输入框并记住（`prefs.packPath`），下次打开自动填

其他载入方式：

| 方式 | 说明 |
| --- | --- |
| **`?index=<仓库相对路径>`** | 深链，指向包根 `manifest.json`（旧包也收 `index.json`） |
| **拖入画布** | 拖 `manifest.json` 进来（单文件拿不到包根，会引导去选目录）。**拖目录不行**：浏览器 `dataTransfer.files` 只给文件、不给目录结构，整包离线读取请用「载入文件…」的目录选择器 |
| **「文件 ▾」→ 载入文件…** | 0.8.9 起文件菜单只剩三项（载入 / 保存 / 另存）；示例与 fixtures **已从菜单移除**，详见 §界面 |
| **`?rig=<同源相对路径>`** | **开发用只读兼容**：直接载入同目录的 `<同名>.atlas` 与贴图，不启用就地保存 |
| **`?voice=<仓库相对路径>`** | 深链载入事件语音索引，可与 `?index=` 同时用 |

### manifest schema（v3.2）

```json
{
  "packFormatVersion": 3,
  "manifestSchemaVersion": 2,
  "id": "deepseek",
  "version": "0.2.0",
  "displayName": { "en": "Whale Girl", "zh": "鲸鱼娘" },
  "render": {
    "type": "spine",
    "entry": "spine/model.json",
    "scale": 1.0,
    "anchor": [0.5, 1.0]
  },
  "spine": {
    "model": "spine/model.json",
    "atlas": "spine/model.atlas",
    "textures": ["spine/model.png"],
    "rigMeta": "spine/rig-meta.json",
    "idleProfile": "spine/idle-profile.json",
    "lipsync": "spine/lipsync.json"
  },
  "catalog": "catalog.json",
  "events": "events.json",
  "license": "CC-BY-NC-SA-4.0",
  "credits": ["…"],
  "voice": { "index": "voice/index.json" },
  "sequences": { "index": "sequences/index.json" }
}
```

- `packFormatVersion` 必须是整数 **`3`**；小于 3 按**旧格式**拒绝（`OLD_FORMAT_PACK`）。
- `manifestSchemaVersion` 必须是整数 **`2`**；小于 2 同样拒绝。
- 入口文件名白名单是 `manifest.json` / `index.json`，其它 `.json`（含 `model.json`）不当作入口。
- `displayName` 是 `{en, zh}` 对象，至少一个非空；`version` 是 SemVer。
- `spine` 六个槽位平铺（`lipsync` 可选），`render.entry` 必须**等于** `spine.model`。
- `textures` 1..16 个 `.png`/`.webp`（小写扩展名），与 atlas 页名和顺序严格一致。
- 所有路径都是**包根相对**，不接受绝对路径、`..`、反斜杠、带协议前缀。
- 载入是**校验后再提交**：新文件解析失败时保留原模型，错误写在提示条与调试面板。
- 完整规范见 [`docs/dsh-pets-character-pack-format-v3.md`](../../docs/dsh-pets-character-pack-format-v3.md)。

### 旧索引 schema（v1 / v2，仍可载入）

```json
{
  "schemaVersion": 1,
  "base": "assets/characters/deepseek/spine",
  "label": "deepseek 女仆",
  "files": { "model": "model.json", "atlas": "model.atlas", "textures": ["model.png"] }
}
```

- `schemaVersion` 整数 `1`（旧）或 `2`（v3 包，可多带 `rigMeta` / `idleProfile` / `lipsync`）；未知字段拒绝。
- `base` 是仓库根相对目录；文件必须与索引**同目录**。

### 保存与另存

| 入口 | 做什么 | 依赖 |
| --- | --- | --- |
| **文件 ▾ → 保存文件**（`Ctrl`/`⌘`+`S`） | 把补丁后的 model + index + atlas + 全部贴图 POST 到 `serve.py` 的 `/api/save-bundle`，就地回写索引目录 | 必须用 `serve.py` 启动 |
| **文件 ▾ → 另存文件** | 纯前端打包 `.zip`（store）并下载 | 只要整包原始字节齐全即可 |

保存语义：

- 写回内容 = **骨骼字段**（`x`/`y`/`rotation`/`scaleX`/`scaleY`，六位小数，只在确实变化时写）+ `slots` 顺序
  + **动画草稿**（Key 增删改 / 曲线 / 整体重定时）+ **region 附件补丁**（`skins` 目标附件的 x/y/rotation/scale）；
  约束、deform、events、未编辑的动画 / skins 与其它未知字段原样保留。
- 成功保存后：内存模型按落盘补丁重建，动画草稿与 transient 清空，**撤销/重做栈清空**，基线更新；
  第二次保存若 0 变化则复用原文。
- 保存目标是载入时声明的 `base` 目录；失败 / 网络中断会保留内存改动并提示，不确定时禁止继续覆盖。
- 只读服务下「保存文件」置灰；「另存 ZIP」不清 dirty、不更新基线。

## 能力

| 能力 | 状态 |
| --- | --- |
| region 附件（含 trim / rotate 90·180·270 / atlas `scale`） | ✅ 整四边形 affine 绘制 |
| 刚性 mesh / 加权 mesh（多骨影响） | ✅ 逐三角绘制；顶点按权重蒙皮，权重着色按面内重心插值 |
| IK 约束（一骨 / 二骨，Normal inherit、均匀缩放、无 shear） | ✅ 求值并画在骨骼层；不满足前提时显式标「受限 / 未求值」+ 原因 |
| 动画预览（bones rotate/translate/scale、slots attachment、ik 时间线） | ✅ 播放 / 暂停 / 循环 / 倍速 / 拖时间轴 |
| 摆位编辑 + 撤销 + 导出补丁 | ✅ 位置、旋转、缩放、z 序 |
| 骨骼选中与高亮 | ✅ 画布点关节圆点或骨链选骨；选中/父/子链高亮，与检查器、骨骼层级列表同步 |
| 画布 gizmo（移动 `V` / 旋转 `R` / 缩放 `S` / Pose `W`） | ✅ 平移轴+中心、旋转环、缩放双轴手柄；真实 pointer、拖动中显示 Δ、`Esc` 回滚、一次手势一条撤销 |
| 坐标系 Local / Parent / World（P1） | ✅ Local 沿骨自身轴（轴基含 shear），Parent 沿父骨轴，World 按世界轴；不可解时显式拒绝 |
| 绑定姿态 / 动画模式 | ✅ Setup 改 `boneList`（保存写 `model.bones`）；Animate 只改当前动画 Key 与 transient |
| Auto Key / 手动打键 / 未打键保护 | ✅ 拖拽写当前时间 Key（相对 setup 反算）；`K` 手动打键；AutoKey OFF 只写 transient；切时刻/切模式等三分支保护 |
| 可展开 Dopesheet | ✅ 真实轨道、时间标尺、单播放头、行折叠、横向缩放滚动、帧吸附；未知 timeline 只读标注 |
| Key 增删与拖动 | ✅ 点击选中、拖动重定时、`Delete` 删除、`K` 新增；Bezier 段 Key 的时间/增删仍拒绝 |
| Graph 曲线视图（P1） | ✅ Dopesheet/Graph 切换；Linear/Stepped/Bezier；Key 时间+值拖动；Bezier 手柄；保存/重载一致 |
| 子轨道搜索 / 过滤 / 锁定 / 隐藏（P1） | ✅ 搜索、仅显示有 Key、逐轨锁定/隐藏；关闭过滤时补空轨 |
| 多选 / 框选 / 批量移动（P1） | ✅ Ctrl/Cmd 点选、Shift 连选、框选；整批同 delta 移动/删除，一次事务；Undo/Redo 恢复选择集 |
| 复制 / 粘贴（P1） | ✅ Ctrl/Cmd+C / V，跨时刻保留相对间隔；同刻覆盖、曲线片段/跨动画拒绝 |
| 快捷键定制 / 布局持久化（P1） | ✅ 17 动作可重绑定/冲突检测/恢复默认；面板高度/缩放/标签/搜索/锁隐/快捷键 localStorage 持久化 |
| Undo / Redo | ✅ 拖拽 / 打键 / 重定时 / 批量 / Graph 各一条，几何可逐位复现 |
| 预览播放范围 vs 整体重定时 | ✅ 预览起止不写 JSON；整体重定时先预检 + 确认，取消零改动 |
| 槽附件切换轨（P2） | ✅ Dopesheet 槽行显示当前附件名，可新增/改值/改时间/删除，候选来自 default skin + `raw.slots[].attachment`（空=隐藏槽） |
| 事件 / 绘制顺序轨（P2） | ✅ 事件（name/int/float/string/volume/balance + 当前命中读数）、绘制顺序（`offsets[{slot,offset}]` 列表）可视化增删改 |
| 形变轨与求值（P2） | ✅ 从零建轨 / 顶点 x·y / 长度校验；core 求值 weighted（2×influence）、rigid（2×顶点）、region（非官方扩展） |
| IK / transform / path 约束轨（P2） | ✅ 按官方 4.2 容器（IK/transform 合并 key，path position/spacing/mix）；transform/path 可编辑/保存，预览标「不完整」 |
| 轴心补偿（P2） | ✅ Setup 开关，拖动时补偿直接子骨 + region 附件（世界误差 ~1e-14），Animate 置灰 |
| 洋葱皮 / 运动轨迹（P2） | ✅ 前后 1–5 帧半透明线框；选中骨 0..duration 原点/tip 折线（≤240 点、缓存）；纯显示、零写入 |
| 镜像 / 片段库（P2） | ✅ 镜像骨/镜像动画/写入镜像；片段保存到 localStorage、刷新后插入（覆盖/跳过、跨骨架拒绝）；Setup 姿态预设。**0.9.49 起面板从界面移除，能力全部改由 `__characterEditor` 接口提供** |
| 两骨 IK / 骨架结构工具（P2） | ✅ 两骨解析 IK（照官方 `apply2`）；新建骨、重父级 keepWorld、重命名（含动画轨迁移）、删除被引用拒绝、`validateSkeleton` 常驻 |
| 网格层 / 权重层 / 骨骼层 / UV 预览 | ✅ 见下 |

## 界面（单一界面，PS / Flash / Blender 心智）

编辑器**只有一套界面**——没有「简单 / 高级」开关，也没有第二套布局。所有能力都在同一个 DOM 里，专业参数用**折叠分区**渐进披露。布局按 Photoshop / Flash / Blender 用户的习惯排布：

```
┌───────────────────────────────────────────────────────────────────────┐
│ 文件 编辑 视图 帮助 │ 包名 ●未保存 │            ↶ ↷  保存▾   ▣        │ 顶栏第1排：菜单 + 右栏开关
│ ☑贴图 ☐骨骼 ☐网格 ☐权重 │ 透明度 ──● 100%                        │ 顶栏第2排：显示层
├────┬──────────────────────────────────────────────┬───────────────────┤
│ 工 │                                              │  图层（部件列表） │
│ 具 │                画布 + gizmo                  │  搜索 / 顺序切换  │
│ 条 │                                              ├───────────────────┤
│44px│                                              │  图层（部件列表） │
│    │                                              │  0.9.50：属性与   │
│    │                                              │  调试面板已移除   │
├────┴──────────────────────────────────────────────┴───────────────────┤
│ 动画 ▾ │ ▶播放 │ 时间轴 Tab │ 绑定姿态 │ 回到开头 │ 循环 │ 1× │ ──●── │ 动画条
├───────────────────────────────────────────────────────────────────────┤
│ 状态消息                                              拖动移动 · ? 帮助 │ 状态栏
└───────────────────────────────────────────────────────────────────────┘
（按 Tab 时，Dopesheet 在动画条上方展开：轨道树 + 时间轴 / Graph 同一面板）
```

1. **顶栏（两排，0.9.13–0.9.41 起逐步简化；原先三排）**：
   - 第 1 排：菜单（文件 / 编辑 / 视图 / 帮助）+ 文档名 + `● 未保存` + 撤销 `↶` / 重做 `↷` + 保存 ▾；**最右端是右栏开关**（只有图标，见 §右栏开关）。
   - 第 2 排（视图 / 显示层）：显示层 贴图 / 骨骼 / 网格 / 权重、**透明度**滑块。（0.9.41 起 `适配 F` 与 `− 缩放% +` 已移除，等价操作在左侧工具条的「适应窗口 / 放大 / 缩小」与快捷键 `F` / `+` / `−`。）
   - **已移除（0.9.14）**：吸附、洋葱皮（含前/后/步长）、轨迹、权重配色 —— 界面不再显示，能力保留（`setSnap()` / `setOnion()` / `setTrail()` / `setWeightMode()`；吸附另可从「视图 → 吸附」勾选）。
   - **已移除（0.9.13）**：整条第 3 排「编辑工具」（目标 / 坐标 / 文档模式 / AutoKey / 轴心补偿 / IK / 镜像），能力保留（见下表）。
   - 移除的控件都以 `display:none` 形式留在 `#hiddenToolControls` 里，只为保持既有同步链不断；**它们不占版面、不产生焦点**。

   | 保留的接口 | 用途 |
   | --- | --- |
   | `setTarget()` / `setSpace()` / `setMode()` | 目标、坐标系、文档模式 |
   | `setAutoKey()` / `setPivotCompensate()` | AutoKey、轴心补偿 |
   | `setIkMode()` / `setIkMix()` / `mirrorRun()` | IK、mix、镜像 |
   | `setSnap()` / `snap()` | 吸附（0.9.15 补的读写对） |
   | `setOnion()` / `setTrail()` | 洋葱皮、轨迹 |
   | `setWeightMode()` / `weightMode()` | 权重配色（0.9.15 补的读写对） |

2. **左侧竖向工具条（44px）**，分两组：<b>操作</b> = `Q` 选择 · `H` 拖拽 · `V`/`G` 移动 · `R` 旋转 · `S` 缩放 · `W` 指向；<b>视图控制</b> = `+` 放大 · `−` 缩小 · `F` 适应窗口。分区名在展开态显示，收起态（44px）只留分隔线。当前工具是实心蓝底 + 左侧白条 + 加粗，其余为灰色。**拖拽是开关**：点一下进、再点一下出（退出回到进入前的工具）。每个按钮的 tooltip 都是「动作 + 键位 + 影响谁」；顶部有伸缩开关（收起 44px / 展开 132px）。
3. **画布**：直接拖人物改姿势；滚轮缩放，中键或按住 `Space` 平移。缩放与「适应窗口」在左侧工具条（画布角不再重复放按钮）。
4. **右栏（300px，上下两栏）**：
   - **图层**：部件列表（搜索、显示顺序 / 骨骼层级切换、👁 显隐、🔒 锁定）。
   - **属性面板**（0.9.49 去掉常用属性区 → **0.9.50 整块移除**）：右栏现在只有部件列表与四个主分页，没有任何检查器。原来挂在检查器里的操作全部走 `__characterEditor`：槽位选择 `selectSlot()`/`slotSelection()`、显示与锁定 `slotVisible()`/`slotLock()`、层操作 `layerMove()`、恢复 `slotRestore()`/`attachmentRestore()`、数值 `slotField()`/`setBoneField()`、骨架结构 `skelCreate()` 等、轴心与镜像 `pivot()`/`mirror()`。键盘入口不受影响：`K` 打键、`Shift+T` 自由变换、`[` `]` 层级。
   - **骨架现状**（0.9.58）：43 根骨、4 条两骨 IK（手臂/腿各一对）。呆毛是 3 段链（`ahoge` → `ahoge-2` → `ahoge-3`）、鲸鱼尾 3 根骨，都按**贴图里实际可见像素的中轴**定位（不是网格矩形中心）。
  - **为什么不能按矩形中心**：这两个附件是「矩形四边形网格 + 整张贴图铺满」（UV 从 0 铺到 1），贴图里画的图形只占其中一部分且是弯的，按矩形中心放骨必然偏。
  - **呆毛要先按颜色分离**：`呆毛` region 里除了呆毛本体，还画着背后的花发带（占 87% 像素）。判据 `alpha>60 && (b−r)>70` 才能把本体（高饱和蓝紫）与发带（低饱和灰白）分开。
  - **骨要设 rotation**：只设 x/y 会让每根骨都朝正右方，连起来是折线而非弧线 —— 这也是「方向反了」的成因之一。
  - **权重按到骨线段距离分配**：按「到骨原点距离」会在拱形中段产生权重突变，转动时三角形翻转（撕裂）。取最近 3 段、`1/(d+8)²` 衰减可消除。
  - **改骨必须重算顶点**：按顶点原世界位置对新骨矩阵反解，静止外观零变化（实测位移 6e-7）。
  - **贴图放大镜**（0.9.66–0.9.70）：`drawUVInset` 面板**只在网格或权重模式下出现**（`if (state.show.mesh || state.show.weights) drawUVInset(frame)`）。结构是**双面板**（电商详情页式）：右下角 150×150 小窗显示整张图集并**接受鼠标悬浮**，在小窗里移动时画出蓝色取景框；同时在左侧 320×320 大浮层显示取景框内的放大内容（带中心十字、命中附件名、放大倍数、图集坐标）；小窗取景框有 **16px 最小可视尺寸** + 半透明高亮 + 四角强调；放大浮层尺寸按画布比例（**62% × 60%**，下限 320×336）**居中偏上**摆放，内容严格限制在正方形内（取样是 span×span，铺到非正方形区域会被拉变形）；放大倍率**固定 1.5×**（常量 `MAG_ZOOM`），取样窗口由倍率反推 `span = 内容边长 / MAG_ZOOM` —— 不随附件大小变化，鼠标在不同附件间移动时倍率恒定
  - **动画分页只列待机**（0.9.71–0.9.117）：底部工具条的 `动画` 下拉也已移除（与分页列表冗余）；换动画走列表行点击或 `__characterEditor.animSelect(name)`。底部动画工具条**放在 `#dopesheet` 之前** —— 时间轴折叠时它贴底，展开时位于面板上方；展开/收起是**高度收拢**动画（改 height 而非只改 opacity，这样工具条会被布局带着同步移动；`hidden` 语义不变）。Spine 只负责待机动画 `idle`；`blink` 与 18 个表情动画**数据保留在 model.json**（人物包内在机制，runtime 照常用），但**不在动画分页列出**；挥手 / 摆尾这类复杂动作归**序列帧**层（`sequences/index.json`），在分页里以只读区呈现。
    - **为什么 `wave` / `tail_wag` 的 Spine 动画不能删**：它们在 Spine 里骨轨为空、只切 11 个表情槽，是 `EXPR_ALIASES` 的表情别名，供事件联动表情用；真正的挥手 / 摆尾在序列帧层。删掉会让相关事件失去表情联动。
    - 分页里删掉了整体重定时 / 预览起止 / 实时预览 / 键统计 / 重置 / 保存 / 逐轨列表共 19 个控件；这些能力全部保留在接口：`animSetDuration` / `animResetOne` / `animResetAll` / `saveToDisk` / `setPreviewRange`。逐帧编辑走底部时间轴。。鼠标在小窗内时**不参与模型拾取**（否则会误选窗后部件）。取景窗口 `clamp(命中附件最长边 × 0.5, 24, 96)` 自适应。世界坐标 → 图集像素用逐三角形**重心坐标插值**（`uvAtWorld`）。鼠标位置存于 `state.cursor`，只在上述两种模式下更新。
  - **加槽必须同步 slotGroups**（0.9.59 的教训）：`rig-meta.slotGroups` 按槽名枚举 7 个图层组，加槽后若没登记进去，编辑器会**静默回退成平铺列表**（只弹一条黄色提示）。校验条件：全覆盖 / 无重复 / 无未知槽名 / 每组连续 z 区间 / 组序前→背递减。源头常量在 `build_rig.py` 的 `SLOT_GROUPS`，直接改 `rig-meta.json` 会在下次重建时被覆盖。
- **骨骼显示配色**（0.9.54）：`状态栏上方视图条的「骨骼」显示层`。打开后 **FK 骨是蓝色 `#5aa9ff`、受 IK 约束的骨是青绿色 `#4ec9a5`、IK target 是粉色十字 `#f57785`**。IK 骨线加粗（2.2 vs 1.6）、关节点更大，骨名也用对应色。原来 IK 骨是琥珀色，与「未求值 / 曲线段 / 洋葱皮」同色难以区分，已改。
  - **折叠分区**：0.9.49 移除了 `片段库`，0.9.50 移除了 `骨架结构` 与 `调试` —— 现在右栏**没有任何折叠分区**。片段/姿态预设走 `clips()` / `poseSave()` 等；骨架结构走 `skelCreate()` 等；调试诊断走 `diagnostics()`。
5. **时间轴（唯一一套）**：按 `Tab` 或底部「时间轴」展开 `#dopesheet`——轨道树 + 时间轴 / Graph 同面板切换、搜索、仅有 Key、锁定隐藏、批量、曲线保护；动画条上是播放控制与播放头。
6. **右键菜单**：画布 / 时间轴 / 图层三类，每类 7–8 项，全部走既有命令与 gate，**不适用项置灰并在 tooltip 说明原因**，`Esc` 关闭。

### 文件菜单（0.8.9 起简化）

只有三项，照常带快捷键与禁用原因：

| 菜单项 | 作用 | 快捷键 |
| --- | --- | --- |
| **载入文件…** | 选整个包目录（含 `manifest.json`） | — |
| **保存文件** | 就地写回原包（需要 `serve.py`） | `Ctrl`/`⌘`+`S` |
| **另存文件** | 打包 ZIP 下载 | — |

**说明文字一律单行（0.8.11 起）**：`.menu-note` 在 CSS 层强制 `white-space: nowrap` + 省略号，文案长短不影响行数；菜单宽度封顶 360px（0.8.13），长说明只截断不把菜单撑宽，完整文本在 `title` 里可悬停查看。

### 本地项目（0.9.2 起为菜单分组）

「文件」菜单里 **「本地项目」是一个分组标题**（不可点），被扫到的包各自占一条菜单项 —— 不是弹窗，也不是单个可点的「本地项目…」项。

```
文件
├ 载入文件…    选整个包目录（含 manifest.json）
├ 保存文件     …                       Ctrl+S
├ 另存文件     …
├ ────────────────
├ 本地项目                    ← menuTitle()，分组标题
└ 鲸鱼娘  v0.2.0             ← 一个包 = 一个菜单项
   workspace/packs/deepseek  ← 相对路径（说明栏已强制单行）
```

| 项 | 说明 |
| --- | --- |
| 扫描范围 | `workspace/packs/*/`，**只扫一层**（不递归进包内部，避免把包里备份的 manifest 当独立项目） |
| 展示 | 包名 · 版本 · **仓库相对路径**；动画/槽数、体积、许可、问题原因在 `title` 里（菜单说明只占一行） |
| 载入 | 点一条包 → 走 `loadIndexByPath("<相对路径>/manifest.json")`，**与「载入路径」同一条链路**（server 语义，可保存） |
| 刷新 | **每次展开文件菜单都重扫一次**（包可能刚被编译出来）；扫描失败只在组内给一行原因，不影响载入/保存 |
| 空/失败 | `扫描中…` / `workspace/packs 下没有人物包` / `读不到本地项目（未连上本地服务）` |

接口：`GET /api/packs`（**只读**，不碰保存链路）。版本口径与 `bundle.js` 一致：`packFormatVersion != 3` 或 `manifestSchemaVersion != 2` 会以 `issues` 返回，菜单里直接标 ⚠，不用点了才知道会被拒。

```json
{
  "ok": true, "apiVersion": 1, "root": "workspace/packs", "count": 1,
  "packs": [{
    "path": "workspace/packs/deepseek", "label": "鲸鱼娘", "id": "deepseek", "version": "0.2.0",
    "packFormatVersion": 3, "manifestSchemaVersion": 2,
    "license": "CC-BY-NC-SA-4.0", "creditsCount": 4,
    "animCount": 21, "slotCount": 37, "fileCount": 63, "bytes": 5703381,
    "hasVoice": true, "hasSequences": true, "issues": []
  }]
}
```

健壮性：单包损坏返回 `ok:false` + 原因但**不拖垮整体**；目录大小有 200MB 预算；扫描异常返回 `ok:false` 而非 500。
agent 侧也可以不开界面调用：`__characterEditor.refreshLocalPacks()` / `localPacks()` / `onPickPack(meta)`。

**已移除**（用户拍板简化界面）：`事件`（事件测试… / 载入语音包…）、`示例`（发布区两个包）、`测试样张（fixtures）`。
这些是**收回了菜单入口，不是删掉功能**：

| 功能 | 现在怎么到 |
| --- | --- |
| 事件分页 | 右栏「事件」标签直接点开（`openVoice()` 只是切标签的糖） |
| 语音包 | 随 `manifest.voice.index` **自动载入**，不需要手动选文件 |
| fixtures | `selftest.html` 仍跑全部断言；`__characterEditor.loadFixture()` 脚本接口仍在 |
| 示例 | 空状态卡片的「查看示例」按钮仍在；且本仓 `assets/characters/` 无包数据，点菜单原本就 404 |

### 右栏开关（0.9.9 起，0.9.17 起只保留一个）

| 位置 | 元素 | 作用 |
| --- | --- | --- |
| 第 1 排最右端（`order:99` + `margin-left:auto`） | `#btnPanel`，**只有 `panel` 图标、无文字** | **双向**：展开时点击收起，收起时点击展开 |

- **右栏标题栏的 X 已移除（0.9.17）**：它和顶部开关是两份重复入口；X 一走，那条只剩「spacer + X」的 `.inspector-bar` 也一并删除，右栏现在直接从主分页栏开始。
- 关闭右栏仍有两条路：顶部 `#btnPanel`（双向）、「视图 → 面板」菜单项。

- 原来的结构死结：只有单向的「收起」按钮，重开只能走「视图 → 面板」菜单；`syncPanel()` 里找的 `$("btnPanel")` 早就不存在。新增的 `#btnPanel` 成为唯一双向开关，`aria-pressed` 反映真实状态（**不再「展开后隐藏按钮」**）。
- **右栏淡入淡出**：`.inspector` 过渡 `width / flex-basis / opacity / transform / border-left-width`；`body.panel-hidden` 从 `display: none` 改为「宽度收 0 + 透明度 0 + 轻微位移」——**`display` 不可过渡**。
- **内容延迟隐藏**：`visibility` 用「0s 时长 + .2s 延迟」阶跃过渡，内容保持可见到动画结束；直接写 `visibility: hidden` 会让内容瞬间消失、只剩空壳收窄（淡出等于没做，0.9.11 修的）。
- **窄屏（≤959px）**：右栏是抽屉，有自己的 `translateX` 动画；宽屏那套「宽度收 0」在该断点**显式还原**，避免两套动画打架。
- **定位用 flex 尾项而非绝对定位**：绝对定位 + 行尾预留 padding 会在 1024px 下把「透明度」滑块挤到第二行（0.9.12 修复）。现在是宽屏落同一行最右端、窄屏换行到**右端**且与任何控件零重叠。
- `.panel-toggle[aria-pressed='true']` 用「弱强调」样式，不与真正被勾选的「贴图 / 骨骼」抢注意力。

### 左侧工具条伸缩（0.9.5 起）

工具条顶部有伸缩开关（`#railToggle`，`panel` 图标 + 方向箭头）：

| 状态 | 宽度 | 显示 | 记忆 |
| --- | --- | --- | --- |
| 收起（默认） | 44px | 只有图标 + 右下角快捷键角标；`title` 保留完整说明 | — |
| 展开 | 132px | 图标 → 工具名称 → 快捷键，淡入淡出 | `localStorage: dsh.character-editor.railExpanded` |

- **动画**：`width` + `max-width` + `opacity` 过渡（180ms）。文字用 `max-width: 0 → 96px` 而不是 `display: none`——**`display` 不可过渡**，用它会变成瞬间出现、淡入实际不生效（0.9.7 修的就是这个）。
- **对齐**：收起态 `panel` 图标**居中**，与下面 9 个工具图标同一条竖线（实测中心 X 全部 = 22）；方向箭头是**右下角角标**（`right:1px / bottom:0`），与快捷键字母 `.rail-k` 同一套定位。展开态箭头回到行内最右端并 `rotate(180°)`（0.9.41 修的挤压错位）。
- **遵守减少动态效果**：走既有的 `@media (prefers-reduced-motion: reduce) { * { transition: none !important } }`，没有绕开它写私有动画。
- **不用 `aria-pressed`**：那是「选中某个工具」的语义，伸缩按钮只用 `aria-expanded`；否则会和当前工具同时高亮成两处实心蓝（0.9.6 修的）。
- **持久化独立键**：**不进 `prefs`**。`prefs` 有 `PREFS_VERSION` 严格校验，版本不符会整份回退默认（`layout`/`shortcuts`/`models` 全丢），为一个展开态动那个版本不值。
- **窄屏（≤960px）**：工具条横排，展开会挤掉画布，因此该断点隐藏伸缩按钮、文字一律不显示。

### 渐进披露的边界

- 折叠只是**默认收起**，不是「另一个界面」：展开后仍是同一个 `#partsView`，Tab 可遍历，窄屏仍是同一套抽屉。
- `绑定姿态 / 动画` 是**文档模式**（决定「写到哪」：绑定姿态写 bones 基础值，动画写当前动画的 Key），与界面布局无关，也不再叫「模式切换」。
- 属性与调试面板 0.9.50 起**整体移除**，右栏只留部件列表；形变 / 约束 / IK / 事件 / 绘制顺序 / 骨架结构 / 曲线类型 / 权重全部只在接口里，**没有「高级模式」字样**。

## 快捷键

| 键 | 作用 |
| --- | --- |
| `Q` | 选择工具（只选中，不拖动） |
| `V` / `G` | 移动工具（`V` 是 PS 习惯，`G` 是 Blender 别名） |
| `R` / `S` / `W` | 旋转 / 缩放 / 指向 |
| `H` | 拖拽**开关**：按一下进入（画布左键拖动=移动视野，不碰部件），再按一下退出并回到进入前的工具 |
| **`Space`** | **按活动区域分工**：指针在画布 / 图层区 = 按住临时平移；指针在时间轴 / 播放条 = 播放暂停 |
| `K` | 打关键帧（时间轴展开时打到时间轴，否则记当前位置） |
| `Delete` / `Backspace` | 删除关键帧（页内确认，可撤销） |
| `P` | 播放 / 暂停 |
| `F` / `Shift`+`F` | 适应窗口 / 只看选中 |
| `Tab` | 展开 / 收起时间轴 |
| `[` / `]` | 层级下移 / 上移 |
| 方向键 / `Shift`+方向键 | 移动 1 / 10 单位 |
| `Ctrl`/`⌘` + `C` / `V` / `A` | 时间轴内复制 / 播放头处粘贴 / 全选 Key（画布聚焦时不劫持） |
| `Ctrl`/`⌘` + `Z` / `Shift`+`Z` / `Y` | 撤销 / 重做 / 重做 |
| `Ctrl`/`⌘` + `S` | 保存（有写回目标时弹保存菜单，否则下载副本） |
| `+` / `-`、滚轮 | 缩放 |
| `Esc` | 取消拖动 / 清选择 / 关闭右键菜单、帮助与浮层 |
| `?` | 帮助与快捷键（操作速查 + 键盘表 + 可自定义） |

> 「帮助与快捷键」浮层里的「快捷键（可自定义）」区可逐动作重绑定 / 清除 / 恢复默认并提示冲突；`Space` 与 `Escape` 是固定通道。
> 输入框 / 下拉框 / 菜单聚焦时单键不劫持。

## 位置快捷命令（`simple.*`，与界面无关）

`window.__characterEditor.simple.*` 保留为**位置快捷命令**——它不依赖任何界面布局或折叠状态，只是把「选部位 / 拖姿势 / 打键 / 删键 / 保存」做成可脚本化的最小集合：

`openPack / selectClip / play / pause / seek / selectLayer / dragPose / setKey / deleteKey / save / undo / redo / status`

- 返回值统一 `{ok, code, message, data?, pending?}`；`status()` 是只读快照（`apiVersion / uiMode / pack / clip / time / duration / playing / dirty / busy / selectedLayer / layers / positionKeys / capabilities / limitations / pending`），其中 `uiMode` 恒为 `"single"`（旧字段兼容）。
- `dragPose / setKey / deleteKey` 只在动画上下文执行，绑定姿态或没有动画一律 `NEED_ANIMATE_MODE` 且**零写入**。
- 需要确认时返回 `CONFIRM_REQUIRED` + `pending:{token,action,target,docRev}`；带 token 重试即执行。
- `save()` 是 async，**resolve 即已落定**：返回前已完成模型重建、基线更新与 dirty/undo 归零，`data.settled:true`；`destination:'copy'` 只报「已发起下载」，**不清 dirty**；失败返回 `SAVE_FAILED`（改动保留）。

## 危险操作与保护

- **页内确认**：所有确认都是页面内模态（`#simpleConfirm`），Enter = 确认、Esc = 取消、焦点归还，不用浏览器原生 `confirm`。
- **未保存保护**：`dirty` 时 `beforeunload` 提示；打开另一个包 / 上次打开的包前弹四选一（保存到原包 / 下载副本后继续 / 放弃调整 / 取消），下载失败不继续。
- **保存**：写回原包前必须确认（文案含「建议先下载副本」）；下载副本只报「已发起副本下载」，不宣称已写磁盘。

## 骨骼与关键帧编辑

- **目标**：`骨骼` 改骨变换（驱动后代与加权网格）；`部件` 改附件自身。
- **坐标系**：`Parent` 父骨局部；`Local` 沿骨自身轴（含 shear，回父级用真实 P⁻¹）；`World` 世界轴。
  父级非均匀缩放/斜切时 World 旋转/单轴缩放显式拒绝；Local 平移/轴约束仍可解。
- **模式**：Setup 写 `boneList` → `model.bones`；Animate 只写当前动画 Key / transient。底栏「绑定姿态」是预览，不清 Key。
- 选骨、V/R/S/W gizmo、拖动 Δ、Esc 回滚、一次手势一条撤销；方向键微调。
- Auto Key ON 写当前时间 Key；OFF 只写 transient 并显示未打键；切时刻/切动画/切模式/切目标/播放/保存前有三分支保护。
- Dopesheet：真实轨道、单播放头、Key 选中/拖动/删除/K 新增；曲线段 Key 以琥珀描边 + 小三角标记，时间/增删被
  `ANIM_CURVE_EDIT_UNSUPPORTED` 拒绝，值编辑仍允许。
- Graph：段类型 Linear/Stepped/Bezier、Key 时间+值拖动、Bezier 手柄；写回经 `anim-edit`。
- 多选/框选/批量移动、Ctrl+C/V、批量 Delete：经 `SpineBatchEdit.planKeyBatch`，一次事务、失败零改动。
- 时长语义：「整体重定时全部 Key」先只读预检 + 确认；「预览起止」只影响播放/scrub。
- 附件目标：仅 Setup + region 可编辑，保存经 `applyAttachmentEdits` 整批校验；mesh/加权只读。
- **额外轨道（P2）**：Dopesheet 分组为 骨 → 槽 → 事件 → 绘制顺序 → 形变 → 约束；所有写入经 `SpineTrackEdit.planKeyEdit`（失败零改动），
  保存只改 `animations` 内对应容器。形变支持从零建轨（`attachments.<skin>.<slot>.<att>.deform`），region 附件因官方 runtime 会抛异常
  默认不提供创建；加权长度=2×influence、刚性=2×顶点。IK/transform 为合并 key；path 为 position/spacing/mix 三行。
- **轴心补偿（P2）**：Setup 打开后 V 拖动会以 `childrenAndAttachments` 模式补偿直接子骨与 region 附件（一次事务），
  Animate 模式开关置灰并复位；不可解（世界线性奇异、inherit 非 normal/onlyTranslation 未知值）时零改动。
- **洋葱皮 / 轨迹（P2）**：纯显示层，不参与拾取、不进 JSON；轨迹采样按 `animEdit.rev` 缓存。
- **镜像 / 片段库（P2）**：镜像骨/整条动画可先 transient 预览再写入（AutoKey 关）或直接写入（AutoKey 开）；
  片段保存选中 Key（localStorage 版本化），刷新后可在播放头插入（覆盖/跳过），跨骨架拒绝。
- **两骨 IK / 骨架结构（P2）**：Pose 工具开 IK 后拖动末端骨写父/子 rotation（mix 0..1）；Setup 面板可新建骨、重父级（keepWorld）、
  重命名（同步 parent/slots/约束/动画轨道名）、删除（被引用或含加权网格时拒绝并列出引用）；`validateSkeleton` 常驻并在保存前后各跑一次。

## 动画 / 事件 · 语音

- 动画下拉选段 → 播放/暂停/回到开头/循环/倍速/拖时间轴；预览时禁用摆位，点「绑定姿态」回 setup。
- 事件分页以 `voice/index.json` 为唯一来源，按事件折叠试听台词、检查动画标签映射；34 事件/48 台词实测通过。
- 语音缺失/动画未映射分别提示，不猜测映射；事件页只读，不写回。

> ⚠️ **改了 `serve.py` 之后必须重启服务进程**：Python 在启动时把模块读进内存，
> 旧进程不会加载新代码 —— 表现是接口返回「未知 API 路径」或「含未知部位」。
> 如果同时开了多个端口（如 8123 / 8124），**每个端口都要重启**，否则你打开的可能是旧的那份。
### 事件页点卡片加载表情（0.9.48 起）

在事件页**展开**某个事件卡片时，会顺带应用该事件的表情 —— 与在表情页点同一事件完全等效（同一段 pplyExprSet() 代码路径）。

> **收起时不应用**：收起是「关掉」的动作，那时重算表情会覆盖你在表情页刚精调好的结果。收起只清 ppliedSet、保留 saveTarget。

### 事件分页的显示裁剪（0.9.43 起）

单个事件卡片只保留「事件名 + 状态 + 台词」三样。被移除的显示与其**保留的能力入口**：

| 已移除显示 | 能力入口（不会因删 UI 而丢失） |
| --- | --- |
| 试听按钮 | __characterEditor.voiceAudition(eventId) |
| 资源检查块 | __characterEditor.voiceChecks(eventId) |
| 动画徽标 / 预览按钮 | __characterEditor.voiceAnimationStatus(eventId) / oicePreviewLine(lineId) |
| .ogg 路径 | 移入台词 	itle（悬停可见） |

> 卡片的点击委托是**按类名**分发的，所以第二行容器用 hidden 保留而非物理删除 —— 物理删除会让委托失去目标。

### 事件表情的精细编辑与保存（0.9.25 起）

表情页底部有**独立保存按钮**，只写 events.json 里**当前目标事件**的 expression —— 与顶栏「保存文件」（写模型/图集/贴图）是两条互不影响的链路。

| 环节 | 说明 |
| --- | --- |
| 目标事件 | 点「事件表情」某一项即设为目标；**之后手动精调不会丢目标**（saveTarget 与「当前是否为事件原值」set 是两个字段） |
| 区域 | 「整眼」与「眨眼三槽（眼白/眼珠/睫毛）」各自框成独立区域，**切换按钮在区域右上角**，两组只能二选一 |
| 反算 | 11 槽 → 7 部位；眨眼组只输出非 null 键，所以没改动的事件保存后**逐字节不变** |
| 保存按钮 | 未选事件 / 无改动 / 本地目录模式 / 无包根时**禁用并给原因**（	itle 里写明） |
| 服务端 | POST /api/save-events：只允许写 <base>/events.json、只改点名事件的 expression、拒绝新建事件、写前回读自检、原子替换 + 失败回滚、统一 CRLF |

> 格式扩展（0.9.41）：眨眼组类型为 {iris, lash, white}，**white 是可选键**（缺省 = 沿用 Rig 默认眼白）。包里现有 38 组眨眼数据没有一组带 white，做成必填会导致全部旧包不可加载。

### 事件名中英映射（0.9.41 起）

**界面显示中文，底层一律英文 id**（语音路径、动画映射、事件轨道 `name` 字段都不变）。

| 项 | 说明 |
| --- | --- |
| 字典模块 | [`event-names.js`](event-names.js)：纯数据、零依赖零 DOM，Node 侧可自测 |
| 显示优先级 | 包内 `events.json` 作者的 `name` → 字典 → 英文 id 原样兜底 |
| 覆盖 | 53 条（当前包 34 个事件全覆盖 + 19 个通用兜底）；分类映射 session→会话 等 |
| 生效位置 | 表情页按钮、左侧事件分页行、分类标签、搜索匹配（中英文都能搜到） |
| 排查 | 事件的 `title` 同时给「中文名（英文 id）」，可直接对上包内 `events.json` |

为什么字典**不能**盖过包内 `name`：包是内容源，作者把某事件改名后，字典不该强行盖回去。字典只给「没写 name 的包」和通用事件兜底。

扩展新事件时：加进 `event-names.js` 的 `DICT`，并把 id 附到 `selftest-eventnames.js` 的 `PACK_EVENT_IDS` —— 那条断言会检查字典是否覆盖包内全部事件，漏了立刻变红。

## 调试面板 / `window.__characterEditor`

调试分组显示骨骼/IK 数量、网格与权重清单、未求值明细。页面挂调试句柄（**非公开 API**）：
`state` / `core` / `frame()` / `pose()` / `boneValues()` / `boneScreen()` / `gizmo()` / `geomHash()` /
`edit()` / `timeline()` / `graph()` / `graphState()` / `selection()` / `prefs()` / `shortcuts()` / `poseTip()` /
`tracks()` / `trackSelect()` / `trackSetVertex()` / `dsRows()` / `dsStat()` / `trackSearch()` /
`mirror()` / `mirrorRun()` / `mirrorPose()` / `mirrorWrite()` / `mirrorCancel()` / `clips()` / `clipSave()` /
`ik()` / `ikChain()` / `skeleton()` / `pivot()` / `pivotPreview()` / `onionState()` / `trailState()`，
以及 `loadIndex()` / `saveToDisk()` / `selectBone()` / `setMode()` / `setTool()` / `setSpace()` / `setAutoKey()` /
`keySelected()` / `undo()` / `redo()` / `timelineOpen()` / `setPlayhead()` / `selectKeyByTime()` 等自动化动作。

## 已知限制

- **官方 Spine 4.2 runtime 验证只到 core 级**：spine-ts 4.2.120 加载 rig 与保存副本，P0 required 13/13 PASS；
  P1 `p1-runtime-verify.json` / `t21-runtime-verify.json` PASS；P2 `p2-track-api-verify.json` 15/15、`p2-deform-verify.json` 4/4、
  `p2-ik-mirror-verify.json` 13/13、`p2-advanced-official.json`（38 骨/37 槽/3 动画、10 采样 8.5e-5）、`p2-newdeform-official*.json` PASS。
  **不含 GPU 渲染逐像素**。
- **DPR ≠ 1 未实测**：高 DPI 下 gizmo/拾取/截图未逐一验证。
- **Graph 限制**：Dopesheet 曲线段重定时/删除仍拒绝（曲线语义保护）；Graph 横拖 Key 暂不延长动画时长；
  纵轴为逐轨自适应刻度；额外轨道（事件/绘制顺序/形变/约束）不进 Graph，只在 Dopesheet 编辑。
- **Local/World 限制**：2D Local 旋转与 Parent 同标量（差别在轴显示/读数）；World 旋转/单轴缩放在父级非均匀/斜切时禁用。
- **Pose 限制**：单骨 +X FK aim；两骨 IK 仅在选中骨有长度且父矩阵可逆时可用（本 rig 骨长全 0，需换 spineboy 等包）；
  叶骨显示柄不写模型 length；不做多骨 FABRIK（`NOT_IMPLEMENTED`，UI 不暴露）。
- **镜像限制**：数据级镜像（translate.x / rotate / shear 取负，curve 结构保留），非 normal inherit / 左右不对称骨架不等价；
  不覆盖槽附件、槽颜色、drawOrder、events。
- **片段库限制**：只存 localStorage（不随人物包分发、不跨设备）；跨骨架签名拒绝插入。0.9.49 起界面上已无「片段库」面板，`clips()/clipSave/clipInsert/clipRename/clipDelete/clipCollision/poseSave/poseApply/poseDelete` 是唯一入口。
- **骨架结构限制**：删除骨不重映射已烘焙权重（直接拒绝并列出引用）；重父级 keepWorld 会把 shearX 归零重分配（`REPARENT_NORMALIZED_SHEAR`），
  可能破坏 IK 链（`validateSkeleton` 报 `IK_CHAIN_NOT_PARENT`，属预期副作用）；结构撤销只保留最近 12 个修订；不做 `.spine` 工程往返。
- **快捷键**：`fit/zoom/层序/[ ]` 等旧快捷键仍走硬编码，未进可定制注册表；洋葱皮 / 轨迹 / 镜像 / IK / 结构面板目前只有脚本接口（0.9.14 起界面不再显示，见 §界面）。
- **布局持久化**：只覆盖时间轴/轨道/Graph/快捷键/显示（洋葱皮、轨迹），不含画布 zoom/pan。
- **示例真实包在本仓库 404**：`assets/characters/` 只有下载索引；用 `?index=` 载入 `references/` 副本。
- **约束求值范围**：transform / path 约束**未求值**（可编辑/保存/官方加载验证，预览标「不完整」）；physics、槽颜色未求值；
  **region 形变为非官方扩展**（官方 RegionAttachment 不是 VertexAttachment，加载会抛异常，UI 默认不提供创建）；
  deform/drawOrder 已求值；spineboy 16 项未求值，不声称全姿态正确。
- **IK 求值只支持一骨/二骨、Normal inherit、均匀缩放、无 shear** 的子集；不满足时保留 FK 并标「受限」。
- **Canvas2D**：mesh 逐三角绘制，共享边可能有 ≤1 设备像素抗锯齿细线，不承诺与 GPU 运行时逐像素一致。
- 保存不检测外部内容修改；多文件保存不具备崩溃事务；保存只支持回环地址；picker 只提供索引元数据。

## 版本

编辑器**自身**版本是 **0.9.117**（里程碑：P0 = 0.1.0、P1 = 0.2.0、P2 = 0.3.0 收口、0.4.x = 过渡期的双模式（已删除）、0.6/0.7 = 合并为单一 PS/Flash/Blender 心智界面、**0.8.x = v3.2 manifest 入口与两种载入方式**）。

- **单一来源**：[`version.js`](version.js) 导出 `{ version, label, builtAt, schemaVersion, apiVersion, milestone }`。浏览器作为 classic script 加载并挂 `window.SpineEditorVersion`；**Node 侧**（根 `package.json` 是 `type: module`，`require()` 只会拿到 `{}`）用 `await import('./tools/character-editor/version.js')` 后读 `globalThis.SpineEditorVersion`，或直接文本正则读 `version:` / `builtAt:` 字段（`scripts/bump-editor-version.mjs` 就是这么做的，不依赖模块系统）。
- **缓存戳同源**：`index.html` / `selftest.html` 里所有 `?v=` 必须等于 `version.js` 的 `version`，且 `version.js` 是 `index.html` 的**第一个** `<script>`（在 `spine-core.js` 之前）。
- **改版本**（唯一推荐入口，别手改）：

  ```bash
  node scripts/bump-editor-version.mjs 0.9.49   # 改 version.js(version/builtAt) + 全部 ?v=，打印改动文件数
  node scripts/bump-editor-version.mjs --check # 校验 semver / ?v= 同源 / version.js 首选加载，不一致 exit 1 并列出位置
  ```

- **显示**：浏览器标题 = `内置人物包管理器 0.9.117`；帮助浮层「版本」行只留一行摘要 + 「关于」跳转；完整工具信息（版本 / 构建时间 / 里程碑 / schema·api / 人物包格式 / 运行时 / 许可）在「帮助 → 关于」模态框里，全部取自 `version.js` 与 `bundle.js`；调试句柄 `__characterEditor.version()` 返回四个字段。
- **边界（方案 A）**：编辑器版本**不改变任何 JSON schema**——人物包 `manifest.json`（v3.2）/`model.json` 的 `schemaVersion` 仍为 1，`/api/save-bundle` 的 `apiVersion` 仍为 1，旧包照旧可载入；版本号只用于界面标识、缓存击穿与问题定位。
- **与人物包格式无关**：编辑器 0.9.117 ↔ 人物包格式 v3.2 是两套版本轴。编辑器版本只描述工具本身，人物包格式见 [`docs/dsh-pets-character-pack-format-v3.md`](../../docs/dsh-pets-character-pack-format-v3.md)。

## 自测

起服务后打开：

```
http://127.0.0.1:8123/tools/character-editor/selftest.html
```

页面加载 `spine-core.js` / `bundle.js` / `bone-edit.js` / `timeline.js` / `anim-edit.js` / `curve-edit.js` / `batch-edit.js` / `keymap.js` / `track-edit.js` / `pose-tools.js` / `ik-aim.js` / `slot-groups.js` / `voice.js` 与 fixtures，
运行 `selftest*.js`；结果在 `window.__selftest*Result` / `__selftestAggregate`。

浏览器侧实测（0.9.41 那一轮的页面聚合）：**3204/3204 通过、0 失败、skipped=2**；`event-names` 套件**当前**独立跑 **253/253**（`__selftestEventNamesResult`，未计入页面聚合；其中含只需 Node 的源码守卫 —— 0.9.41 时是 131 条，0.9.45–0.9.54 陆续加到 253）。
（core 1202 / anim 248 / slot-groups 75 / bone-edit 573 / track-edit 165 / pose-tools 80 / ik-aim 185 / timeline 238 / curve-edit 152 / batch-edit 119 / keymap 167）。

> 浏览器侧比 Node 侧少 60 条（`timeline` 238 vs 280、`curve-edit` 152 vs 170），**不是漏跑**：这两个套件把「真实 rig 往返」整段放在 Node 门禁后（`skipped=2` 只记**两段**，段内的逐条断言在浏览器里根本不执行，所以不进 `total`）。两边都是 0 失败；**以 Node 数字为准**。

**最全的聚合在 Node**（权威数字，改动后以这个为准）：

```
node tools/character-editor/selftest-node.mjs
# Character editor: 3532/3532 passed; 0 failed
#   suites: core 1202, anim 248, slot-groups 75, bone-edit 573, track-edit 165,
#           pose-tools 80, ik-aim 185, timeline 280, curve-edit 170,
#           batch-edit 119, keymap 167

node scripts/bump-editor-version.mjs --check
# ✓ 版本校验通过：version 0.9.117；?v= 共 47 处全部一致；version.js 为 index.html 第一个脚本
```

官方 runtime 对照：

```
node workspace/tmp/e2e/runtime-verify.mjs             # P0 required 13/13 PASS
node workspace/tmp/e2e/curve-oracle.mjs               # P0 真实 curve 4/4 PASS
node workspace/tmp/e2e/curve-edit-verify.mjs          # P1 curve-edit 7/7 PASS
node workspace/tmp/e2e/p1-runtime-verify.mjs          # P1 Graph 保存副本 PASS
node workspace/tmp/e2e/track-deform-verify.mjs        # P2 形变求值 4/4 PASS（maxDiff 1.012e-4）
node workspace/tmp/e2e/p2-lead-track-official.mjs     # P2 6 类轨道官方合法性 15/15 PASS
node workspace/tmp/e2e/p2-ik-mirror-verify.mjs        # P2 IK/镜像 13/13 PASS（3 NOTE）
node workspace/tmp/e2e/p2-deform-create-official.mjs  # P2 从零建形变轨官方可加载 10/10 PASS
node workspace/tmp/e2e/p2-advanced-official.mjs       # P2 rig-adv/spineboy 官方加载与采样
node workspace/tmp/e2e/make-p2-fixtures.mjs           # 生成合成 drawOrder/path/deform 验收包
```

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `index.html` | 语义 DOM（菜单/工具组/画布/右栏/Dopesheet/动画条/帮助）；script 顺序 `version → icons → spine-core → bundle → bone-edit → track-edit → pose-tools → ik-aim → timeline → curve-edit → batch-edit → keymap → anim-edit → slot-groups → voice → fixtures → app`（全部带 `?v=<version>` 缓存戳） |
| `ui.css` | 全部样式与设计令牌 |
| `version.js` | **编辑器自身版本的单一来源**（纯数据，无 DOM/网络）：`version`/`label`/`builtAt`/`schemaVersion`/`apiVersion`；浏览器挂 `window.SpineEditorVersion`，Node 用 `await import()` + 该全局（或文本正则读字段） |
| `app.js` | 应用层：载入、画布、状态、骨骼/附件编辑与 gizmo、Dopesheet/Graph、事务与撤销、保存/另存 |
| `spine-core.js` | 纯数学与解析（atlas/model/采样/矩阵/IK/蒙皮/命中/几何），无 DOM |
| `bundle.js` | 纯数据模块：索引校验、模型补丁、附件补丁、保存请求校验、ZIP |
| `anim-edit.js` | 纯数据模块：时长扫描/整体重定时预检、Key 增删改、曲线写回、setup 相对值 |
| `bone-edit.js` | 纯几何模块：Parent/Local/World 矩阵、拖拽、aim、gizmo、骨拾取 |
| `timeline.js` | 纯数据模块：行构建、时间↔像素、吸附、空轨补齐、搜索/过滤辅助 |
| `curve-edit.js` | 纯数据模块：Spine 4.2 curve 解析/采样/段类型/手柄 |
| `batch-edit.js` | 纯数据模块：多选移动/粘贴/删除整批规划 |
| `keymap.js` | 纯数据模块：快捷键注册表/冲突/上下文解析 |
| `track-edit.js` | 纯数据模块：事件/绘制顺序/形变/ik/transform/path 轨道的扫描、行模型、Key 规划（官方 4.2 容器结构，失败零改动） |
| `pose-tools.js` | 纯数据模块：镜像（动画/姿态）、片段库（创建/校验/应用/JSON 往返，粘贴委托 batch-edit） |
| `ik-aim.js` | 纯数据模块：两骨解析 IK、骨架结构操作（create/reparent keepWorld/rename 含动画轨迁移/delete 拒绝规则）、`validateSkeleton`（含孤儿告警） |
| `slot-groups.js` | 纯数据模块：显示顺序图层组 |
| `voice.js` | 纯数据模块：语音索引校验/事件分组/资源评估 |
| `selftest.html` / `selftest.js` | 断言页与套件入口；`selftest-{boneedit,timeline,curveedit,batchedit,keymap,trackedit,posetools,ikaim}.js` 为各纯模块套件 |
| `serve.py` / `start.sh` / `start.bat` | 本地服务与启动脚本 |
| `../../scripts/bump-editor-version.mjs` | 改版本 / `--check` 校验（semver、`?v=` 同源、`version.js` 首选加载）；纯 Node ESM，无依赖 |
| `assets/characters/index.json` | 下载索引；本仓库不含真实包数据 |

## 为什么不用官方 Spine 编辑器

官方编辑器能做网格、权重、物理、缓动曲线，是精修的正路；但它需要付费授权。
这个工具解决的是「只想把部件摆正、把层级调对、顺手看一眼网格和权重」的高频小事，零依赖、开箱即用。
