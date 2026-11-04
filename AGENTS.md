# AGENTS.md

本仓是 DSH Pets Character Studio，负责制作人物包；动态桌宠、会话管理与事件播放由独立的 dsh-pets 项目负责。规则正文见 [CONTRIBUTING.md](CONTRIBUTING.md)，交付边界见 [CHARACTER-PACK.md](CHARACTER-PACK.md)。

- `docs/` 不入库，唯一例外是 `docs/assets/` 下供 README 使用的扁平图片。
- 根目录 `references/`、`workspace/`、`experiments/`、`playground/`、`sandbox/` 与 `output/` 只在本地保留。技能自身的 `skills/*/references/` 是公开资源，可入库。
- 依赖、构建产物、凭据和本机环境不入库；可重建产物不要新增为共享源码。
- 提交前跑 `scripts/verify-hygiene.sh --all`。修改忽略规则时同步修改卫生脚本；不得用 `git add -f` 绕过。
- 两个网页工具必须能在没有参考项目、没有 dsh-pets 兄弟仓库的环境下启动。不要用软链接把另一仓的可写资产挂进来。
- `character-editor` 在两个项目均保留完整副本；共用修复要同步并分别验证。
- 公开技能保持环境无关；本机网关、模型、路径留在忽略的 `.agents/skills/`。
- 保留迁入素材的许可和署名。未经核实的制作输入不得自动成为可发布人物包。
