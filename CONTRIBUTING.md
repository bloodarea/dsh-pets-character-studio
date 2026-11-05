# 贡献与文件卫生

本仓负责人物包制作与分发，运行端是独立的 DSH Pets。当前管线为**帧序列动画 + 预录语音**；Spine 方案已从仓库移除，不再维护。

## 入库内容

- 公开技能及其配套参考资源（`skills/`）、仓库自检脚本（`scripts/*.sh`）、依赖声明、根 README/协作说明。
- `assets/characters/`：**发布区**。每个人物包一个目录，必须带 `manifest.json`、`LICENSE`、`ATTRIBUTION.md` 与可用资源；`index.json` 是供 DSH Pets 下载的索引。不完整的包不得入库。
- 轻量素材与清单可以入库；大体积帧序列优先走发布制品并在索引登记。

## 仅本地内容

- `workspace/`：**生产区**，放人物贴图与设定图（`texture2d-pack/`）、三视图（`three-view-pack/`）、预录语音输入（`voice-pack/`）、模型权重与中间产物；体积大、可重建，不入库。
- `references/`：本地参考项目（`ref-anime/` 桌宠参考实现、`ref-texture2d/` 角色图集参考），不入库。
- `.agents/`、`.dsh/` 与本机参数不入库。公开技能通过本仓 `index.js` 注册；只读取本包 `skills/` 的直接子目录或扁平技能文件，资源以技能目录为根。插件提供者名为 `dsh-pets-character-studio`。
- `output/`（工作记录、回图、验收证据）、依赖、`.venv/`、字节码、构建目录、日志、临时文件、编辑器文件与凭据不入库。
- `docs/` 下文档不入库；唯一例外为 `docs/assets/` 下的扁平图片（单张不超过 3 MiB）。
- 单文件一般不超过 5 MiB；人物包资源单文件不超过 8 MiB。超限资源放 Release 或在索引登记外部地址。

## 许可与交付

代码 MIT；角色图片、动画、音频与第三方素材分别遵守各自许可，不因代码开源自动获得授权。发布前逐项核实素材来源与再分发条件，并在包内保留署名。

生图与补全由项目级技能（如 `meta-api-imagegen`、`newapi-multimodal`）负责，结果仍按可见区逐像素验收；当前 `skills/` 没有随包技能。

## 自检

```bash
bash scripts/verify-hygiene.sh --all
# 新克隆可选安装本地钩子
bash scripts/install-hooks.sh
```

`--all` 检查已跟踪文件。首次迁入尚未跟踪的文件还要用 `--files <文件列表>` 检查。修改 `.gitignore` 时必须同步 `scripts/verify-hygiene.sh`；不得用 `git add -f` 绕过。确有误判才使用 `--no-verify` 并在提交说明记录原因。
