# 人物包交付协议 v1

DSH Pets 消费人物包，DSH Pets Character Studio 制作人物包。本文约定两仓之间的交付边界，基于现有 DeepSeek 包；运行端的加载、下载和安装校验尚待实现，本文不代表这些功能已经可用。规范权威版本在 dsh-pets，本仓拆分时将同版复制到 Studio；兼容变更需同步更新并使用新版本样例验证。

## 三种格式

| 产物 | 入口 | 用途 |
| --- | --- | --- |
| 部件贴图 / 标注工程 | 贴图清单或 `parts-bundle` 的 `index.json` | 制作输入，包含分层、遮挡补全与问题记录 |
| Spine 编辑子包 | Spine 目录内的 `index.json` | 编辑器载入与保存：模型 JSON、atlas、贴图 |
| 完整人物包 | 包根 `manifest.json` | 桌宠运行交付：渲染、状态、语音、降级与许可 |

编辑器的“另存 ZIP”目前只导出 Spine 子包，**不能直接当作可安装人物包**。`three-view-parts` 的交付止于贴图和清单，还需完成装骨、动画与最终打包。

## 完整目录

```text
<id>/
  manifest.json
  LICENSE
  ATTRIBUTION.md
  preview.webp
  spine/
    index.json
    model.json
    model.atlas
    model.png
  voice/                         # 可选
    index.json
    <event>/<line-id>.ogg
```

`manifest.json` 是运行入口。路径全部以包根为基准，不依赖仓库名、`assets/` 前缀、绝对路径、网络 URL 或兄弟目录。文件名不允许目录穿越或反斜杠；引用的文件必须真实存在于包内。Spine 图集可含多页，必须包含所有页；`spine/index.json` 是现有编辑器定位图集与贴图的显式索引。

## Manifest

现有样例见 [DeepSeek manifest](assets/characters/deepseek/manifest.json)。v1 保留这些字段：

| 字段 | 约定 |
| --- | --- |
| `schemaVersion` | 整数 `1`，与人物包内容版本分开 |
| `id` | kebab-case 标识，与包目录名一致 |
| `version` | 整个人物包的 semver；美术、动画、语音一起升级 |
| `displayName`、`description` | 按语言键提供文字，如 `en` / `zh` |
| `author`、`license`、`licenseUrl`、`credits` | 作者、许可与完整来源链；附实际 LICENSE 与 ATTRIBUTION |
| `official`、`brand` | 同人主题为 `official: false`，不得暗示厂商官方授权 |
| `minPluginVersion` | 最低运行版本；消费端实现后按兼容版本判断 |
| `render` | 当前主格式 `type: "spine"`；`entry` 为模型 JSON，附 `scale` 与 `[x,y]` 锚点 |
| `states` | 状态到实际动画名的映射：`idle` / `working` / `attention` / `done` / `failed` |
| `fallback` | `type: "image"` 与包内 `entry`，用于渲染失败或降级 |
| `preview` | 包内预览图片路径 |
| `voice` | 可选；有语音时提供 `index`，缺省时静音 |

状态映射必须指向模型中存在的动画。缺少非 idle 状态时，消费端按 idle 降级；idle 与图像降级均需可用。消费端不得因为图片或声音失败而丢失会话控制和通知。

拆分时示例包为 `version: 0.1.0`，要求运行插件 `minPluginVersion: 0.1.0`；仓库包仍为开发版 `0.0.1`。这是尚待实现的目标兼容版本，不通过降低要求或虚增插件版本来声称当前已有可用运行时。

## Spine 编辑索引

现有编辑器使用严格的 v1 索引：

```json
{
  "schemaVersion": 1,
  "base": "assets/characters/deepseek/spine",
  "label": "人物名称",
  "files": {
    "model": "model.json",
    "atlas": "model.atlas",
    "textures": ["model.png"]
  }
}
```

索引中的 `base` 是**所在制作/编辑仓库的根相对目录**，与 manifest 的包内路径不是同一坐标系。移动包到新仓库位置后须调整该值，不能写 `../dsh-pets/...` 或符号链接回原仓库。三个资源字段均为同目录文件名；贴图页名与顺序严格对应 atlas。最终运行逻辑不得把开发索引的 `base` 当作系统绝对加载地址。

## 语音与事件

语音索引使用现有 `character_id`、`lines` 结构，参考 [DeepSeek voice index](assets/characters/deepseek/voice/index.json)。每行保留唯一 `id`、`category`、`event`、`text`、`audio_file`、`auto_play` 和 `animation`（语义动作标签），另可含 `emotion` / `delivery`。`audio_file` 为包根相对路径；若提供 `line_count`，必须等于实际条数。

事件集合由 `lines[].event` 定义，运行端对自身识别的真实事件选择台词，未知事件不自动触发。`auto_play` 是建议值，最终仍由运行端统一控制静音、冷却、并发队列和免打扰。`animation` 可能是 `greeting` / `thinking` 等语义标签；它不保证就是模型中的动画名，未映射时应明确提示或仅播放语音，不猜测成功。

音频在 Studio 提前录制或生成，完整包携带音频文件。运行端无需生成模型、TTS API 或制作参考项目；包不含凭据、服务地址、模型权重和源工程依赖。

## 交付与验收

1. 在 Studio 完成素材、动画与语音准备，检查引用资源与动画存在；记录许可和署名。
2. 把 manifest、Spine 资源、静态图、可选语音及许可整理到一个自包含目录。打 ZIP 时 manifest 直接位于压缩包根。
3. 人工核对整包；当前尚无完整人物包自动导出/安装器。编辑器子包导出后仍需整合其余资源。
4. 运行项目选择某个完整版本作为内置快照或未来的下载包。Studio 和运行项目各自持有副本，改动不会自动覆盖另一边。
5. 已入库包位于 `assets/characters/<id>/`（当前样例 `deepseek`），下载索引在 `assets/characters/index.json`；dsh-pets 从本仓 GitHub Releases 下载，插件分发包不含人物包。运行端目标位置为 `~/.dsh/pets/characters/<id>/`，同名时用户副本优先。这是待运行端实现的安装/覆盖策略。起手模板见 [人物包模板](templates/character-pack/README.md)。

本次拆分保留现有动画、音频及许可文件的内容。人物包应当独立于作者本机目录，也独立于本仓提供的编辑器源码。
