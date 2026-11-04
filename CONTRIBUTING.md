# 贡献与文件卫生

本仓负责人物包制作，运行端是独立的 DSH Pets。两边通过 [CHARACTER-PACK.md](CHARACTER-PACK.md) 的完整人物包交付；不通过源码路径、可写软链接或隐式目录同步互相依赖。

## 入库内容

- 工具源码、脚本、依赖声明、根 README/协作说明、公开技能及其配套参考资源。
- `assets/source/` 中需要保留的原始制作输入、人工维护素材与清单。迁入的历史素材和度量保持原样；可重建的差异图、报告、生成中间件以后放 `output/`，不继续扩充到源码树。
- `assets/characters/` 承载已入库的人物包与 `index.json` 下载索引；插件分发包（npm `files`）不含人物包。每个入库包必须带 `manifest.json`、`LICENSE`、`ATTRIBUTION.md` 与可用资源，并经 `verify-hygiene.sh` 复核；未完成或授权待核实的包只留本地（默认忽略，按包显式放行）。当前样例为 `deepseek`；仓库作为分发源，对外下载由 GitHub Releases + `index.json` 登记。
- `tools/character-editor/` 在本仓与 dsh-pets 均完整保留。共用修复要分别跑自测，不能假定自动同步。

## 仅本地内容

- `docs/` 下的文档、设计稿与笔记不入库；唯一例外为 `docs/assets/` 下的扁平 png/jpg/jpeg/gif/webp/svg/avif README 用图，单张不超过 3 MiB（超过 1 MiB 告警）。
- 仓库根 `references/`、`reference/`、`workspace/`、`experiments/`、`playground/`、`sandbox/` 不入库。公开技能的 `skills/*/references/` 不受根目录规则影响。
- `.agents/`、`.dsh/` 与本机参数不入库。公开技能通过本仓 `index.js` 注册；只读取本包 `skills/` 的直接子目录或扁平技能文件，资源以技能目录为根。插件提供者名为 `dsh-pets-character-studio`。
- `output/`（工作记录、回图、验收证据）、依赖、`.venv/`、字节码、构建目录、日志、临时文件、编辑器文件与凭据不入库。
- 单文件一般不超过 5 MiB；人物包资源单文件不超过 8 MiB。原图或模型权重超过限制时保留在本地或独立制品存储。

## 许可与交付

代码 MIT；素材依各包许可与署名，不因迁仓改变。DeepSeek 素材的 CC BY-NC-SA 4.0 与完整来源链见样例包。来源待核实的素材可以保留为已有本地/制作输入，但发布前必须补齐授权，不继承 DeepSeek 角色的授权。Spine 运行时与导出数据另受 Esoteric Software 许可约束。

`three-view-parts` 只负责部件贴图和清单。标注器工程与编辑器 Spine ZIP 都是制作格式，不等于包含 manifest、预览、语音和许可的最终人物包。工具不应反向读取兄弟运行仓库。

## 自检

```bash
npm test
bash scripts/verify-hygiene.sh --all
# 新克隆可选安装本地钩子
bash scripts/install-hooks.sh
```

`--all` 检查已跟踪文件。首次迁入尚未跟踪的文件还要用 `--files <文件列表>` 检查。修改 `.gitignore` 时必须同步 `scripts/verify-hygiene.sh`；不得用 `git add -f` 绕过。确有误判才使用 `--no-verify` 并在提交说明记录原因。
