# 人物包模板（character-pack）

复制本目录为 `<id>/` 后逐项补齐；缺任何一项都不是完整人物包，运行端不会加载。
字段与目录约定以 [CHARACTER-PACK.md](../../CHARACTER-PACK.md) 为准，这里只给可复制的骨架和清单。
本模板随插件分发，不包含任何人物素材；完整教程等全流程跑通后再补。

## 目录

```text
character-pack/
  manifest.template.json    # 复制为 manifest.json 后填写
  LICENSE.template.txt      # 替换为素材实际许可全文或条款链接
  ATTRIBUTION.template.md   # 复制为 ATTRIBUTION.md 后填写
  preview.webp              # 自备：512px 高列表图，同时作为 fallback
  spine/                    # 自备：model.json / model.atlas / 贴图，见 spine/README.md
  voice/                    # 可选：index.example.json 是索引样例
```

## 起手步骤

1. 复制目录到制作位置（本仓 `workspace/characters/<id>/`，或直接放 `~/.dsh/pets/characters/<id>/`）。
2. 改名并替换占位：`manifest.template.json` → `manifest.json`；`ATTRIBUTION.template.md` → `ATTRIBUTION.md`；`LICENSE.template.txt` → `LICENSE`。
3. 填 `manifest.json`：`id` 与目录名一致（kebab-case），`version` 从 `0.1.0` 起，清空全部 `TODO`；`states` 里的动画名必须是模型里真实存在的。
4. 放 Spine 资源（见 [spine/README.md](spine/README.md)）与 `preview.webp`。
5. 需要语音时，把 [voice/index.example.json](voice/index.example.json) 复制为 `voice/index.json`，按包根相对路径放 `.ogg`；不需要语音就删掉 `voice` 字段和目录。
6. 按下面的清单自检后再发布。

## 自检清单

- [ ] `manifest.json` 是合法 JSON，`schemaVersion=1`，`id` 与目录同名，无 `TODO` / `0.0.0` 占位
- [ ] `render.entry`、`fallback.entry`、`preview`、`voice.index` 指向的文件都存在
- [ ] `states` 的每个值都能在 Spine 模型里找到同名动画；缺非 idle 状态时按 idle 降级可以接受
- [ ] Spine 模型为 4.x，atlas 页名与贴图文件一一对应，图集页尺寸与贴图实际像素一致
- [ ] 语音：`line_count` 等于 `lines` 条数，`id` 唯一，`audio_file` 全部存在且无孤儿文件
- [ ] `LICENSE` 是实际条款而不是模板；`ATTRIBUTION.md` 与 `manifest` 的 `license` / `licenseUrl` / `credits` 一致
- [ ] 单文件 ≤ 8 MiB；包内路径无绝对路径、`..`、反斜杠与网络 URL
- [ ] 不依赖作者本机目录、本仓 `references/` 或兄弟仓库

## 发布

完整包打成 zip（`manifest.json` 直接位于压缩包根），上传 GitHub Release，然后在 `assets/characters/index.json` 的 `packs` 追加条目：`id` / `version` / `url` / `sha256` / `size` / `minPluginVersion` / `license`。仓库内已入库的包不需要重复登记。