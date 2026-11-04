# DSH Pets Character Studio

[DSH Pets](https://github.com/bloodarea/dsh-pets) 的人物包制作项目。负责立绘与三视图、完整 RGBA 部件、问题标注、Spine 装配与动画检查、离线语音准备，以及最终人物包整理。桌宠窗口、会话管理、事件调度和语音播放由 DSH Pets 运行项目负责。

当前已有两套本地网页工具、三份图像转骨架脚本与 `three-view-parts` 制作技能；完整的自动装骨、语音生成和一键人物包发布流程仍需后续实现。编辑器能试听语音，不等于桌宠运行时已经完成。

## 开始使用

两套网页工具只需 Python 3 标准库，不用安装 npm 或 pip 依赖。从本仓库根目录运行：

```bash
# 人物包编辑器：摆位、层级、动画预览、事件语音检查
python3 tools/character-editor/serve.py --port 8123 --no-browser
# 打开 http://127.0.0.1:8123/tools/character-editor/

# 立绘问题标注器：多视图、部件检查、修改要求与拆件工程
python3 tools/part-annotator/serve.py --port 8124 --no-browser
# 打开 http://127.0.0.1:8124/tools/part-annotator/
```

也可运行各工具的 `start.sh`（Linux/macOS）或 `start.bat`（Windows）自动打开浏览器。两套工具和桌宠仓库的编辑器可使用不同端口同时运行。编辑器只读写本仓库根目录下的素材，不通过兄弟目录符号链接共享可写人物包。

工具说明：[人物包编辑器](tools/character-editor/README.md)、[立绘问题标注器](tools/part-annotator/README.md)。

图像转骨架脚本另外需要 NumPy、Pillow、SciPy，建议放在独立环境：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python scripts/sheet-parts-to-rig.py --help
```

Windows 使用 `.venv\Scripts\python.exe`。这些旧脚本提供基础骨架，并不自动完成完整语义拆件、网格权重或图集打包；外部 Spine 工具按需要自行配置，不依赖本机参考项目路径。

## 目录与职责

| 目录 | 用途 |
| --- | --- |
| `tools/character-editor/` | 完整人物包编辑/预览/语音测试工具；DSH Pets 也保留一份 |
| `tools/part-annotator/` | 制作侧的部件与问题标注工具 |
| `scripts/*-to-*.py` | 图像去背、切分与基础骨架生成 |
| `skills/three-view-parts/` | 可分发的三视图到完整部件贴图技能，交付止于贴图与清单 |
| `assets/source/` | 制作输入与长期保留的源素材，不随 npm 包分发 |
| `assets/characters/` | 已入库人物包（当前 `deepseek` 样例，含完整署名和许可）与 `index.json` 下载索引；插件分发包不含人物包 |
| `templates/character-pack/` | DIY 人物包起点：manifest / 许可 / 署名模板与交付自检清单 |
| `workspace/` | 本地拆件工程与模型环境，不入库 |
| `output/` | 本地生成记录、临时脚本和验收证据，不入库 |
| `references/` | 本地参考开源项目，不入库，也不作为工具启动依赖 |

两个仓库的 `character-editor` 在拆分时来自同一版本。改动共用编辑器时应同步修复并在两边跑自测；目前无跨仓 import、软链接或自动同步。源素材的历史度量与生成记录保留原样，当前状态以实际清单和文件为准。

豆包的三视图已随 `assets/source/doubao/` 迁入；本机已有的 51 个豆包语音相关文件也统一保留在本仓 `assets/characters/doubao/`（忽略，不入库、不随 npm 分发）。DSH Pets 只保留 DeepSeek 鲸鱼娘内置人物包。豆包目前不作为已完成或已核实授权的可发布人物包。

## 向桌宠交付

交付边界是**完整、自包含的人物包**，见 [人物包交付协议](CHARACTER-PACK.md)。Studio 的素材与示例包可以独立修改；DSH Pets 内置包是运行项目选定的版本快照，后续更新通过完整包交付，不自动覆盖另一个仓库。

必须区分三种格式：

1. `three-view-parts` 的贴图与清单、标注器的 `parts-bundle`：制作中间输入。
2. `character-editor` 的 Spine ZIP：模型、图集、贴图与编辑索引，不含完整人物包元数据/语音/许可。
3. 最终人物包：以 `manifest.json` 为入口，包含 Spine 资源、状态映射、预览/降级图、可选语音、许可与署名。这才是交给桌宠的产物。

目前请人工整理第 3 类目录并核对协议；尚未实现一键完整包导出或运行时安装功能。

插件与 npm 分发包只带制作工具和技能，**不含人物包**。仓库本身承担人物包分发：`assets/characters/index.json` 登记经 GitHub Releases 发布的完整包（`url` / `sha256` / `size` / `minPluginVersion` / `license`），dsh-pets 运行时从本仓下载；仓库内已入库的 `deepseek` 包是当前样例。装好插件后即可从零 DIY 自己的包：制作 → 按协议自检 → 放 `~/.dsh/pets/characters/<id>/` 或发布为 Release。起点见 [人物包模板](templates/character-pack/README.md)；完整教程待全流程跑通后再补。

## 在 DSH 中加载制作技能

网页工具无需安装插件。只有希望 Agent 目录里出现 `three-view-parts` 时才安装 Studio bundle：

```bash
dsh plugin --profile web add /path/to/dsh-pets-character-studio
# 随后重启对应 Harness 或重载插件
# 卸载
dsh plugin --profile web remove dsh-pets-character-studio
```

插件名和技能 provider 均为 `dsh-pets-character-studio`，由本仓入口注册公开技能；`dsh-pets` 不再注册它。项目级本机参数保留在忽略的 `.agents/skills/`，不进入分发包。

## 验证

Node.js 18+ 可运行纯数据自测，无 npm 依赖：

```bash
npm test
bash scripts/verify-hygiene.sh --all
```

编辑器与标注器也各有浏览器自测页 `tools/<工具>/selftest.html`。首次迁入尚未跟踪的新文件需要额外按文件列表执行卫生检查，`--all` 只覆盖已跟踪文件。

## 来源与许可

项目从 [bloodarea/dsh-pets](https://github.com/bloodarea/dsh-pets) 提取，保留原作者、上游与资源来源说明。源代码为 MIT；角色创意素材独立授权，见 [LICENSE](LICENSE) 与 [默认角色署名](assets/characters/deepseek/ATTRIBUTION.md)。DeepSeek 同人资产采用 CC BY-NC-SA 4.0，非官方、禁止商用、演绎同许可。`assets/source/` 中来源未完整核实的素材只作保留的制作输入，不自动列入可发布人物包；正式交付前逐项补齐授权。
