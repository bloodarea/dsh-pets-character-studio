# 内置人物包管理器（零依赖，本地用）

此工具在 DSH Pets 与 DSH Pets Character Studio 两个项目均保留完整副本。桌宠仓库用于已有包的编辑、预览与调试；完整制作流程见 [Character Studio](https://github.com/bloodarea/dsh-pets-character-studio)。工具从当前仓库读取资产，不直接写入另一仓库。导出的 ZIP 只包含 Spine 子包。

一个不用装任何依赖的网页小工具，用来**手动微调角色部件的摆放（位置 / 旋转 / 缩放）与绘制顺序**，
并能在同一页里**预览动画、看骨骼与 IK、看网格与权重**。载入一个 `index.json` 就能看整包；
调好后可以**就地保存回索引目录**，或**另存一个 zip 整包**。产出与 spine-pack 流程兼容。

## 启动

三平台都是一条命令，**不需要 pip 安装任何依赖**（只用 Python 3 标准库）：

| 平台 | 命令 |
| --- | --- |
| Linux / macOS | `./tools/character-editor/start.sh` |
| Windows | 双击 `tools\character-editor\start.bat`，或命令行 `start.bat` |

脚本会：检查端口（默认 8123）→ 在**仓库根目录**起静态服务 → 打开浏览器。
用 `--port 9000` 指定端口，`--no-browser` 只起服务。

**端口被占用时**：

- 占着的是**当前仓库同一路径的旧实例**（命令行能确认绝对 `character-editor/serve.py` 路径）→ 先结束它，再接管同一个端口；另一个仓库或相对命令无法确认身份时只换端口；
- 占着的是**别的程序** → 不杀它，打印占用者（PID + 命令行）并改用下一个空闲端口；
  想让它直接报错就用 `--strict-port`；
- `--no-restart`：不结束旧实例，直接换空闲端口。

等价的手工方式（**只读**：能载入与另存 ZIP，保存文件置灰；就地保存需要 `start.sh` 起的 `serve.py`）：

```bash
cd <仓库根目录>                 # dsh-pets 或 dsh-pets-character-studio
python3 -m http.server 8123 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:8123/tools/character-editor/
```

要就地保存时用：

```bash
python3 tools/character-editor/serve.py --port 8123 --no-browser
```

> 为什么必须起服务：编辑器要 `fetch` 同仓库的 `assets/.../model.json` 与图集图片，
> 浏览器对 `file://` 的 fetch 一律拒绝，直接双击 html 会载入失败。

## 载入

载入只认一个 **`index.json`**：它声明 `base`（仓库根相对目录）与同目录下的模型 / 图集 / 贴图文件名，
编辑器按索引去 fetch 三件套，校验通过才提交。模型、图集和贴图不再单独多选。

| 方式 | 说明 |
| --- | --- |
| **「文件 ▾」→ 载入文件…** | 选一个 `index.json`（`accept=".json"`，文件名必须是 `index.json`） |
| **拖入画布** | 把 `index.json` 拖进画布，等同「载入文件…」 |
| **`?index=<仓库相对路径>`** | 深链，路径以 `/index.json` 结尾，如 `?index=assets/characters/deepseek/spine/index.json`；缺 `base` 时用 URL 目录，声明了就必须与 URL 目录一致 |
| **「文件 ▾」→ 示例 → deepseek 女仆 / 旧版三视图** | 走两个真实索引（主包与 `legacy-views`），不硬编码文件路径 |
| **「文件 ▾」→ 示例 → 测试样张** | 内置 fixtures（region / 刚性 mesh / 加权 mesh / 一骨 IK / 二骨 IK …），不依赖外部文件，适合验证渲染。样张没有原始整包字节，**不能保存、也不能另存** |
| **`?rig=<同源相对路径>`** | **开发用只读兼容**：直接载入同目录的 `<同名>.atlas` 与贴图，不推测索引、不启用就地保存（可另存 ZIP） |
| **`?voice=<仓库相对路径>`** | 深链载入事件语音索引（如 `?voice=assets/characters/deepseek/voice/index.json`），可与 `?index=` 同时用；以 `/voice/index.json` 结尾时自动推导包根 |

### 索引 schema（v1）

```json
{
  "schemaVersion": 1,
  "base": "assets/characters/deepseek/spine",
  "label": "deepseek 女仆",
  "files": {
    "model": "model.json",
    "atlas": "model.atlas",
    "textures": ["model.png"]
  }
}
```

- `schemaVersion` 必须是整数 `1`（字符串 `"1"`、布尔、2 都拒绝）；未知字段拒绝，防止拼写错误静默丢数据。
- `base` 是**仓库根相对目录**，picker 必填、`?index=` 可省略；不接受绝对路径、`..`、反斜杠、百分号。
- 文件必须与索引**同目录**（不嵌套子目录）：`model` 以 `.json` 结尾且不能是 `index.json`；`atlas` 以 `.atlas` 结尾；
  `textures` 1..16 个 `.png` / `.webp`，与 atlas 的页名和顺序严格一致（大小写敏感，多页必须列齐）。
- `label` 可选（1..120 字符），只用于展示。

多页示例：`"textures": ["model.png", "model-2.webp"]`，对应 atlas 第 1/2 页同名；渲染与保存都会取齐所有页（UV 预览仍只看第 1 页）。

载入是**校验后再提交**：新文件解析失败时**保留原来的模型**，画布不闪成空白，错误写在提示条与调试面板里。

### 保存与另存

| 入口 | 做什么 | 依赖 |
| --- | --- | --- |
| **文件 ▾ → 保存文件**（`Ctrl`/`⌘`+`S`） | 把**补丁后的 model + index + atlas + 全部贴图** POST 到 `serve.py` 的 `/api/save-bundle`，就地回写索引目录 | 必须用 `serve.py`（`start.sh` / `start.bat`）启动；`python3 -m http.server` 下置灰 |
| **文件 ▾ → 另存文件** | 纯前端打包一个 `.zip`（store，无压缩）并触发一次下载：根目录平铺 `index.json`、`model.json`、`model.atlas`、全部贴图 | 只要整包原始字节齐全即可，只读服务也能用；不写服务器文件 |

保存语义：

- 只写**真正改过的骨骼字段**（`x` / `y` / `rotation` / `scaleX` / `scaleY`，六位小数），`slots` 顺序按当前层级重排，
  动画 / 约束 / skins 等其它内容原样保留；未改动的文件服务端按字节跳过（第二次保存 `changed=[]`、mtime 不变）。
- 成功后 footer 的「未保存改动」清掉，基线更新为**最近一次保存**；「重置」与「恢复该部件」的文案随之变为「最近保存状态」。
- 保存的写回目标是**载入时声明的 base 目录**，因此界面里显示 `保存目录：<base>`；picker 选的是索引元数据，
  浏览器无法验证磁盘位置，只按索引的 `base` 读写。
- 失败语义：校验错误 / 明确失败会保留内存改动并提示原因；网络中断等**无法确认**的情况进入 `uncertain`，
  禁止继续覆盖，提示「未确认保存结果；改动仍保留，请重新载入核对磁盘」。回滚不完整（`ROLLBACK_FAILED`）同样禁止继续保存。
- 只读服务下「保存文件」置灰并给出原因；「另存文件」不受影响。**另存 ZIP 不清 dirty、不更新基线**——
  下载成功不等于磁盘已更新。

回灌流程（另存 ZIP 或保存后需要重打图集时）：

```bash
# 1) 解压 / 覆盖（另存 ZIP 解压到原仓库对应目录即可继续用；换位置要改索引里的 base）
unzip ~/Downloads/spine-bundle.zip -d assets/characters/deepseek/spine

# 2) 若需要重打图集，在 Studio 使用已准备并核实许可的外部工具。
# SPINE_PACK_SCRIPT 和 SPINE_VERIFY_SCRIPT 均由使用者配置，不依赖作者本机参考路径。
python3 "${SPINE_PACK_SCRIPT:?请配置图集打包脚本}" assets/characters/deepseek/spine --name model

# 3) 使用已安装对应 Spine runtime 的验证工具
node "${SPINE_VERIFY_SCRIPT:?请配置运行时验证脚本}" assets/characters/deepseek/spine model
```

> 导出的是**运行时 JSON**，不是 Spine 工程文件：不能还原 `.spine` 源工程，也不做二进制 `.skel` 导出。

## 能力

| 能力 | 状态 |
| --- | --- |
| region 附件（含 trim / rotate 90·180·270 / atlas `scale`） | ✅ 整四边形 affine 绘制 |
| 刚性 mesh | ✅ 逐三角 `clip + setTransform + drawImage`，顶点随骨变换 |
| 加权 mesh（多骨影响） | ✅ 顶点按权重蒙皮；权重着色按面内重心插值（有渐变，不是整块色） |
| IK 约束（一骨 / 二骨，Normal inherit、均匀缩放、无 shear） | ✅ 求值并画在骨骼层；不满足前提的约束显式标「受限 / 未求值」+ 原因 |
| 动画预览（bones rotate / translate / scale、slots attachment、ik 时间线） | ✅ 播放 / 暂停 / 循环 / 倍速 / 拖时间轴 |
| 摆位编辑 + 撤销 + 导出补丁 | ✅ 位置、旋转、缩放、z 序 |
| 网格层 / 权重层 / 骨骼层 / UV 预览 | ✅ 见下 |

## 界面

自上而下：**菜单条 → 视图/显示层条 → 画布 + 右栏 → 动画条 → 状态栏**。

1. **菜单条**（≈38px）：文件 / 编辑 / 视图 / 帮助，中间标题「内置人物包管理器」（绝对居中；< 720px 隐藏）。
   - 文件：载入文件… / 保存文件 / 另存文件 / **事件测试…** / **载入语音包…**（调试入口）/ 示例（真实索引与 fixtures）
   - 编辑：移动 `V` / 平移 `Space` / 撤销 `Ctrl`/`⌘`+`Z` / 重置（回到最近保存状态）
   - 视图：适配 / 放大 / 缩小 / 实际大小 / 面板 / 显示层四开关 / 吸附 / 权重配色 / 贴图强度——都是第二行控件的等价入口
   - 帮助：帮助浮层 / 快捷键
   - 菜单可键盘操作：Enter / Space 展开，方向键在项间移动，Esc 关闭并把焦点还给菜单按钮；点外部也关闭。
2. **视图/显示层条**（≈34px，一行）：适配 `F` + 缩放 −/百分比/+ + 分隔 + 显示层（贴图/骨骼/网格/权重）+ 吸附 + 贴图强度滑杆；
   最右端是**「展开」**（面板收起时出现）。窄屏（< 960px）按逻辑组换行，不产生整页横向滚动。
3. **主区**：中间画布（棋盘格）+ 右侧 320px 栏（顶部分页「部件 / 事件」+「收起」）：
   - **部件列表**：标题栏下方是独立的「显示顺序 / 骨骼层级」分页切换——
     **显示顺序**（默认，按 z 序倒序，上方在最前；**拖拽行可直接调整显示顺序**，也可用上移/下移），
     **骨骼层级**（按骨骼父子关系折叠/展开，部件挂在自己的骨下面，行首数字仍是显示顺序）；
     都可搜索（部件名 / 附件名 / 骨名），每行可点眼睛隐藏。
   - **选中**：绑定骨、附件类型与顶点/三角数、可编辑性、X/Y、旋转（数值 + 滑杆）、缩放 X/Y、层级四键、恢复该部件、多骨影响列表；
   - **调试**（折叠）：骨骼 / IK、网格、权重、表情、未求值明细；
   - **状态脚注**：是否有未保存改动 · 未求值项数 · 渲染器。
4. **动画条**（主区下面、状态栏上面，整行）：动画下拉 / 播放 / 绑定姿态 / 回到开头 / 循环 / 倍速 / 时间轴 / 时间。
5. **状态栏**（最底）：状态消息 + 操作提示。

菜单与行内控件**共享同一份 app state**：点菜单项等价于操作行内控件，`aria-checked` 与原生 `checked`/`value`
由同一个同步函数设置，不会出现两套状态。窄屏（< 960px）右栏变抽屉：视图条最右端「展开」打开、栏内顶部「收起」关闭，
抽屉关闭 / 切到「部件」分页都会停止语音；动画条按传输组 / 时间轴组换行。

## 显示层

第二行的「贴图 / 骨骼 / 网格 / 权重 / 吸附 / 贴图强度」与**视图菜单**里的同名项是同一份状态的两个入口，
勾选状态双向同步（`aria-checked` 与原生 `checked` / `value` 由同一个同步函数写入）。

| 复选框 | 显示什么 | 用来排查 |
| --- | --- | --- |
| **贴图** | 角色贴图本体（默认勾） | 最终观感 |
| **骨骼** | 父→子骨链 + 关节圆点 + 骨名；FK 蓝、IK 琥珀、IK target 红色十字 + 约束名 | 层级、轴心、IK 链条与 target |
| **网格** | 真实三角面 + 顶点 + hull 轮廓（region 只画 2 个三角 + 轮廓）；右下角图集 UV 预览（黄框=选中件的图集区域） | 网格密度、UV 映射 |
| **权重** | 按骨配色的顶点混合色（面内渐变）；「权重配色」可切「选中骨热力」看单骨权重 0..1 | 挂错骨、权重断层 |
| 吸附 | 拖动取整到 1 个单位（默认关） | 对齐 |
| 贴图强度 | 贴图不透明度（开调试层时自动降到 35%） | 看穿贴图 |

- 叠加调试层时贴图自动压暗（35%），关掉覆盖层恢复 100%；也可以手动拖强度。
- **贴图开关只影响显示**，不影响能否选中 / 拖动部件；但四层全关时画布显示
  「未显示任何内容 [恢复贴图]」，此时不响应画布拾取（列表与检查器照常可用）。
- 半透明贴图走「每个附件先以不透明画到离屏层、再整体合成」，避免叠加层下出现深色三角边。

## 快捷键

| 键 | 作用 |
| --- | --- |
| 拖动 / 中键拖动 | 移动部件 / 平移视图 |
| **Space（按住）** | 临时切到平移（**不播放动画**） |
| `V` | 移动工具 |
| `P` | 播放 / 暂停（播放已从 Space 挪到 P，按钮与帮助浮层都标了） |
| `F` / `Shift`+`F` | 适配全部 / 只适配选中件 |
| 方向键 / `Shift`+方向键 | 选中骨移动 1 / 10 个单位（父骨局部坐标） |
| `[` / `]` | 层级下移 / 上移 |
| `H` | 显隐选中件 |
| `Ctrl`/`⌘` + `Z` | 撤销（最多 120 步；一次拖动只算一条） |
| `Ctrl`/`⌘` + `S` | 保存文件（有写回目标时；输入框聚焦时不劫持） |
| `+` / `-`、滚轮 | 缩放 |
| `Esc` | 取消正在进行的拖动（回滚）/ 清选择 / 关帮助与菜单 |
| `?` | 帮助浮层（含全部键位） |
| 菜单 Enter / Space / 方向键 | 展开菜单 / 激活项 / 在项间移动，`Esc` 关闭并归还焦点 |

输入框 / 下拉框 / 菜单聚焦时以上的单键都不劫持（在搜索框里敲 `f` 不会触发适配）。

## 编辑与撤销

- 可编辑：X / Y（父骨局部位移）、旋转（-180..180，数值 + 滑杆）、缩放 X/Y、z 序、显隐、锁定。
- 拖动只改 X / Y；旋转与缩放用检查器，同样写父骨局部值，撤销覆盖。
- **加权 mesh 的位置只读**（多骨控制，改位置无意义；想直接摆位就把它烘成刚性 mesh），
  **锁定的部件**、**生效中的 IK 骨（mix>0）**、**动画预览中**都会被拒绝并给出原因。
  `mix=0` 的 IK 约束不参与求值，等价于未绑定，此时允许直接拖动该骨。
- 一次手势 = 一条撤销；拖动中按 `Esc` 回滚；「恢复该部件」把它自己的变换恢复到**最近保存状态**（尚未保存时即载入状态）。
- 显隐与锁定**只影响查看器**，不写进 JSON。

## 动画

- 「动画」下拉选一段 → `播放 P` / `暂停` / `回到开头` / `循环` / `0.25×–2×` / 拖时间轴。
- 预览动画时**禁用摆位**（状态栏与检查器写明「先点绑定姿态」），点 `绑定姿态` 回到 setup pose。
- 时长由 core 解析出的 track 决定；像 spineboy 的 `aim`（只有单帧关键帧）时长为 0，时间轴会禁用——这是数据本身的样子。

## 事件 · 语音与动画测试（右侧「事件」分页）

事件 = **语音 + 动画**：以角色包的 `voice/index.json` 为唯一事件来源，按事件折叠分组试听台词，
同时检查动画标签能否在当前模型里精确匹配。入口在右侧 320px 栏的「事件」分页（**不是弹窗**）：

| 入口 | 行为 |
| --- | --- |
| 右侧栏「事件」分页 | 切到事件分页；tab 徽标 = 有问题的事件数（有语音缺失为红，否则仅动画未映射为黄） |
| 文件 →「事件测试…」 | 打开侧栏并切到事件分页 |
| 文件 →「载入语音包…」 | 调试入口：选一个 `voice/index.json`（只读，不写回；正常使用不需要） |
| `?voice=<仓库相对路径>` | 深链载入语音索引；以 `/voice/index.json` 结尾时自动推导包根 |
| 载入角色包后自动探测 | 按 `bundle.base` 及其最多 3 级祖先依次 GET `voice/index.json`，**首个 200 即停** |

- **事件跟随角色包**：载入角色包后自动按 `base` 及最多 3 级祖先探测 `voice/index.json`，**正常使用不需要手动载入**；
  `?voice=` / 文件菜单「载入语音包…」是调试入口，显式载入后自动探测不再覆盖（自动探测失败也不覆盖）。
- **分组与筛选**：事件默认折叠，展开状态在搜索 / 分类 / 状态筛选后保留；分类 chips（全部 + agent / session /
  interaction / easter_egg，带事件数）；搜索匹配事件名、台词 id、台词原文、动画名；状态下拉（全部 / 仅语音缺失 /
  仅动画未映射 / 仅未检查 / 仅正常）；点事件行头部或箭头即可展开 / 折叠。
- **播放**：单实例 `<audio>`，同一时间只播一条；行内播放/暂停、进度条 seek、`loadedmetadata` 显示时长、`ended` 复位；
  事件级「试听」自动选第一条 `audioStatus === "ok"` 的台词。播放失败（解码 / 网络 / 自动播放拦截）在行内、播放条与
  状态栏提示。「联动」默认开：播放台词时若动画标签在模型里精确存在，则 `setAnim` 并播放；未映射时只播语音并提示。
  语音缺失禁用播放（`title` 写明路径），但行内「动画」按钮仍可单独预览（语音缺失时仍可看动画）。
- **资源检查**：去重后的 `audio_file` 用 `fetch(url, {method:"HEAD", cache:"no-store"})` 探测（并发 ≤ 4，6s 超时）；
  200 → ok，404 → missing，405 / 其它非 2xx 回退 GET 一次，网络异常 / 超时 → unknown。动画用当前
  `model.animations` 的 key 精确匹配；未载入模型 → unknown。切包 / 切模型用 `loadGen` / `checkGen` 丢弃旧结果，
  播放用 `playGen` 防止旧 Promise / 媒体事件复活按钮。
- **缺失语义**：事件徽标 `error`（红）= 任一语音 missing；`warn`（黄）= 无语音缺失但有动画未映射；
  `unknown`（灰）= 存在 checking / unknown / unresolved；`ok`（绿）= 全部命中。汇总分别计数
  「语音缺失 a / 动画未映射 b / 未检查 c」（按台词行；同一行语音与动画都未知只算 1）。
- **动画未映射 ≠ 包损坏**：`lines[].animation` 是语义标签（greeting / happy / working…），模型通常只有
  idle / working / attention / done / failed / turn，所以多数事件会显示「动画未映射（模型无同名动画，需补语义→实际映射）」，
  这是预期提示。展开行列出模型动画清单与原因，不做猜测映射（`voice.js` 支持显式 `animationAliases`，编辑器暂不传）。
- **手动选择的索引**没有仓库路径：仅在当前角色包 `base` 自身或祖先目录里找到名字等于 `character_id` 的目录时
  自动用该目录作包根（如 `base=.../deepseek/spine` → `.../deepseek`）；否则音频全部 `unresolved`，可在事件分页
  填写「包根（仓库相对）」后重新解析 / 检查；不会继承上一个包的包根。
- **索引警告**（未知字段 / `line_count` 不符 / 分类非法 / id 前缀不符等）在事件分页顶部单独展示，**不算事件异常**；
  该分页不是模态，搜索框正常输入，`Esc` 只处理菜单 / 帮助 / 拖动 / 清除选择。
- **停止时机**：切到「部件」分页、收起侧栏、停止按钮都会停止语音；「联动动画」关闭后只播语音。

## 调试面板 / `window.__characterEditor`

调试分组里是只读诊断：骨骼 / IK 数量与约束名、网格附件清单（顶点 / 三角 / 是否加权）、
权重图例（只列实际用到的骨），以及**「未求值 / 诊断明细」**逐条列 `code + 路径 + 原因`。
标题右侧的数字 = 「部分预览 N 项未求值」里的 N（按**约束 / 附件 / 骨 / 特性**去重计数，不是 issue 条数）。

页面还挂了一个**只读调试句柄** `window.__characterEditor`（`state` / `core` / `frame()` / `renderer()` /
`hitTest()` / `render()` / `fitView()` / `loadIndex()` / `loadRig()` / `loadFixture()` / `saveToDisk()` /
`saveAsZip()` / `probeCapabilities()` / `saveReason()` / `archiveReason()` / `patchedModel()` /
`voice()` / `loadVoice()` / `openVoice()` / `closeVoice()` / `playVoiceLine(event,id)` / `stopVoice()`），给本地校验与自动化断言用。
`voice()` 返回**快照**（不是可变的 state 引用），可用于验收事件状态 / 缺失计数 / 播放状态。
**它不是公开 API**，随时可能改，不要在业务代码里依赖。

## 已知限制

- **不做时间线编辑**：动画只能看，不能改关键帧、不能加轨道。
- **不做二进制导出**，**不做 `.spine` 源工程往返**；导出的是运行时 JSON 补丁。
- **transform / path / physics 约束不求值**，`deform` 形变、slot 颜色、`drawOrder` 时间线也不参与预览；
  这些都会在「部分预览」里点名（spineboy 的 8 个 transform 约束、deform、slotColor 就是这种情况）。
- **`inherit` 只支持 `normal` 与 `onlyTranslation`**；`noRotationOrReflection` 等按 `normal` 预览并告警。
- **IK 只支持一骨 / 二骨、Normal inherit、均匀缩放、无 shear** 的子集；不满足时保留 FK 并标「受限 / 未求值」。
- **多页图集**：渲染、载入与保存都取齐 atlas 的全部页（按页名逐个 fetch，缺页报错）；仅右下角 **UV 预览仍只看第 1 页**。
- **保存不检测外部内容修改**：只在保存锁内比对磁盘索引的**文件清单**；别的程序改了 model/atlas/贴图内容而清单不变，
  当前页面会按载入时的旧字节覆盖它。多页面先后保存是最后写入者生效；同进程并发保存第二个返回 `SAVE_BUSY`。
- **多文件保存不具备崩溃事务**：单文件 `os.replace` 原子，进程正常捕获异常时尽力回滚；进程被杀或断电可能留下混合版本。
  同目录临时文件（`.spine-save-*`）在强杀后可能残留，手工清理前核对名字与目录。
- **保存只支持回环地址**：`serve.py` 用非回环 `--bind` 启动时写接口 403 `WRITE_DISABLED`；只支持 `127.0.0.1` / `localhost` 的 HTTP origin。
- **不做文件系统目录授权**：不使用 File System Access API（`showDirectoryPicker` / `showSaveFilePicker`），
  picker 只提供索引元数据，实际读写都在索引声明的 `base` 下。
- `sequence` 附件、`clipping`、`boundingbox` 跳过并告警；linkedmesh 的少数边界情况未逐一验证。
- 渲染是 **Canvas2D**：mesh 逐三角 `clip + affine drawImage`，共享边可能有 ≤1 设备像素的抗锯齿细线，
  **不承诺与 GPU 运行时逐像素一致**（官方运行时是 GPU 批处理 + 纹理过滤，边缘与 mipmap 行为不同）。
- 图集路径是相对的：示例按钮依赖 `../../assets/...` 这个位置关系；`?rig=` 先按**站点根相对路径**找（`/references/...`），找不到再按页面相对路径找，失败时把两条都列出来。
- 官方编辑器的工程流程（`.spine` 导入导出、动画编辑、物理）**未测，也不在本工具范围**。

- **语音包只读**：事件分页只读取 `voice/index.json` 与音频，不提供增删台词 / 改音频，也不写回；根 README 的
  运行时语音播放仍是未完成项，编辑器测试 ≠ 运行时播放。
- **动画按语义标签精确匹配**：未命中时显示「动画未映射」是预期（多数事件如此），不读 manifest、不硬编码别名；
  需要映射时由调用方显式传 `animationAliases`（编辑器暂未开放入口）。
- **手动选择的索引没有仓库路径**：不同名角色包需要先载入同角色包，或手填包根；填错包根只会得到 404/unknown，
  界面会提示但不猜路径。
- **资源检查只验证存在性**：HEAD/GET 探测不校验音频内容、时长与可解码性；解码 / 播放失败在播放时提示。
  探测依赖服务对 HEAD 的响应（405 时回退 GET 一次），6s 超时记为 unknown。

## 自测

起服务后打开：

```
http://127.0.0.1:8123/tools/character-editor/selftest.html
```

页面跑 **1043 条断言**（解析 / 矩阵 / IK oracle / 蒙皮 / 边界用例 / 退化数据，加上 `bundle.js` 的
索引校验 / 路径文法 / 索引定位 / 贴图页对齐 / 模型补丁 / 保存请求响应 / CRC32 / ZIP store 结构，以及
`voice.js` 的索引校验 / 事件分组 / summarize / 资源评估 / 路径与自动探测），
结果在 `window.__selftestResult`（`failed === 0` 为通过）。回归截图放在 `output/review/`（gitignore）。

应用页在 core / bundle / voice / fixtures 就绪后加载 `app.js`；自测页加载相同的数据模块后运行 `selftest.js`。
`bundle.js` / `voice.js` 无 DOM / fetch。在仓库根运行 `node tools/character-editor/selftest-node.mjs` 可用 Node.js 执行相同数据自测。

## 图标集

界面上的图标是自绘的 16×16 SVG（1.6 线宽、圆角端点、颜色跟随按钮文字），内联雪碧图，不依赖外部资源：

| 文件 | 作用 |
| --- | --- |
| `icons.js` | 定义 47 个图标符号（含 `voice`）（`symbol#i-*`）并注入文档；对外暴露 `spineIcon(name)` |
| `icons-preview.html` | 图标一览页（含多尺寸缩放效果），改图标时先在这看 |

新增图标：在 `icons.js` 的 `ICONS` 里加一条（`viewBox="0 0 16 16"`，只写内部路径），
然后在 `index.html` 里用 `<svg class="ic"><use href="#i-名字"></use></svg>`，或直接调 `spineIcon("名字")`。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `index.html` | 语义 DOM（菜单条 / 视图条 / 画布 / 右栏分页「部件 / 事件」/ 动画条 / 状态栏 / 帮助浮层）；script 顺序 `icons.js → spine-core.js → bundle.js → voice.js → fixtures/cases.js → app.js` |
| `ui.css` | 全部样式与设计令牌（颜色 / 间距 / 字号 / 圆角 / 焦点环） |
| `app.js` | 应用层：载入、画布、状态、交互、撤销、保存 / 另存（渲染只调 core 的数学） |
| `spine-core.js` | 纯数学与解析（atlas / model / 采样 / 矩阵 / IK / 蒙皮 / 命中 / 几何），无 DOM 依赖 |
| `bundle.js` | 纯数据模块（`window.SpineBundle`）：索引校验 / 路径文法 / 索引定位 / 贴图页对齐 / 模型补丁 / 保存请求响应校验 / CRC32 / ZIP store，无 DOM / fetch / 磁盘 I/O |
| `voice.js` | 纯数据模块（`window.SpineVoice`）：`voice/index.json` 校验 / 事件分组 / summarize / 资源评估（动画精确匹配、音频状态聚合）/ 路径解析 / 自动探测候选，无 DOM / fetch / Audio |
| `fixtures/cases.js` | 内置样张与期望值（界面用 `example: true` 的部分，其余在 selftest 里跑断言） |
| `selftest.html` / `selftest.js` | 断言页 |
| `serve.py` / `start.sh` / `start.bat` | 本地服务与启动脚本：静态文件 + `GET /api/capabilities` + `POST /api/save-bundle` |
| `assets/characters/deepseek/spine/index.json` / `.../legacy-views/index.json` | 两个真实索引（数据文件，入库） |
| `assets/characters/deepseek/voice/index.json` | 事件语音索引（48 行 / 34 事件，只读数据；音频为 `voice/<event>/*.ogg`） |

## 为什么不用官方 Spine 编辑器

官方编辑器能做网格、权重、物理、缓动曲线，是精修的正路；但它需要付费授权。
这个工具解决的是「只想把部件摆正、把层级调对、顺手看一眼网格和权重」的高频小事，零依赖、开箱即用。
