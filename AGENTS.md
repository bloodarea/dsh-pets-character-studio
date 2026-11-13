# AGENTS.md

本仓是 DSH Pets Character Studio，负责人物包的制作与分发；动态桌宠、会话管理与事件播放由独立的 dsh-pets 项目负责。当前采用混合动画架构：Spine 4.2 轻量骨架负责待机、眨眼与表情（内置人物包管理器可直接载入 runtime JSON 查看与编辑骨骼、关键帧），帧序列动画 + 预录语音负责挥手、坐下、转身等复杂动作；两套共用同一角色、锚点与比例，切换用交叉淡入淡出（crossfade）。规则正文见 [CONTRIBUTING.md](CONTRIBUTING.md)，许可见 [LICENSE](LICENSE)。

- `assets/characters/` 是**发布区**：只放完整人物包（manifest、资源、许可与署名齐备）与下载索引 `index.json`；不完整的包留在 `workspace/`。
- `workspace/` 是**生产区**（本地、不入库）：`texture2d-pack/` 人物贴图与设定图、`three-view-pack/` 三视图、`voice-pack/` 语音输入、模型与中间产物。
- 根目录 `references/`、`workspace/`、`experiments/`、`playground/`、`sandbox/` 与 `output/` 只在本地保留。技能自身的 `skills/*/references/` 是公开资源，可入库。
- 依赖、构建产物、凭据和本机环境不入库；可重建产物不要新增为共享源码。
- 提交前跑 `scripts/verify-hygiene.sh --all`。修改忽略规则时同步修改卫生脚本；不得用 `git add -f` 绕过。
- 公开技能保持环境无关；本机网关、模型、路径留在忽略的 `.agents/skills/`。随插件分发的技能从 `skills/` 注册，当前有 `skills/psd-tools/`（PSD/PSB 拆件）与 `skills/character-editor/`（内置人物包管理器的 agent 自动化接口契约）。
- **本仓库是许可证分发与继承点**：代码 MIT（继承 dsh-pets，部分派生自 dsh-pet 的 MIT 许可），角色资产 CC BY-NC-SA 4.0。保留迁入素材的许可与署名；未经核实的制作输入不得自动成为可发布人物包。
- `tools/character-editor/` 是现役**内置人物包管理器**（零依赖的 Spine 4.2 runtime JSON 查看/编辑工具），不是待迁移的旧工具；发布区规则（`assets/characters/` 只收完整包）不变。
