# 拆件包 v1（parts-bundle）· 文件夹工程格式

> 目标：和本仓库的**人物包**（`assets/characters/<角色>/spine/`，`index.json` 为唯一入口）同构：
> **一个文件夹 = 一个工程**，所有引用都是包内相对路径；整包可以随便移动、拷进 ZIP、解包后再打开，
> 不依赖 `assets/` 或 `workspace/` 之外的任何文件；不要求单二进制（不是 PSD 那种容器）。

## 1. 目录结构

```text
<拆件包>/
├── index.json           # 必需。唯一入口：角色/视图/画布/base/清单指针/可选文件表
├── parts.json           # 必需。语义部件清单（id/name/z/files 引用），backToFront 顺序
├── base.png             # 必需。原立绘（或 base-norm.png，alpha 归一化版），尺寸 = canvas
├── composite.png        # 可选。按 backToFront 合成的整图
├── preview.png          # 可选。给人看的压暗+着色预览
├── report.md            # 可选。拆件报告（阈值、未解决项）
├── annotations.json     # 可选。旧标注工程兼容文件（工具保存时附带，非权威）
├── layers/<id>.png      # 可选。成品 RGBA 全画布层（含被遮挡补全）
├── masks/<id>.png       # 可选。可见区二值掩码（白=属于该件）—— 可见区真值
├── cuts/<id>.png        # 可选。按可见区从 base 直接切出的 RGBA
├── hidden/<id>.png      # 可选。被遮挡补全区二值掩码
├── cuts-hidden/<id>.png # 可选。按补全区从 base 切出的 RGBA（颜色为推测占位）
├── issues.json          # 可选。拆分问题清单（审查标注，见 §3.5）
└── issues/<id>[-before|-after].png  # 可选。问题位置 / 改动前参考 / 期望范围 二值掩码
```

规则：

- **`index.json` 必须在包根**；ZIP 导出后根目录同样是 `index.json`。
- 目录名固定（`layers/`、`masks/`…）；文件名 `<id>.png`，`id` 与 `parts.json` 一致。
- 除 `index.json`/`parts.json`/`base*.png` 外，其余目录与文件都可缺省；缺 `layers/` 表示只有标注，
  缺 `masks/` 表示只有成品层（工具会按 alpha>10 反推候选掩码）。
- 不写绝对路径、不写 `..`、不用反斜杠；包内路径一律 POSIX 风格。

## 2. `index.json`

```json
{
  "schemaVersion": 1,
  "kind": "parts-bundle",
  "label": "deepseek-front-v1",
  "character": "deepseek",
  "view": "front",
  "canvas": { "width": 1091, "height": 1442 },
  "alphaMode": "straight",
  "base": {
    "file": "base.png",
    "size": [1091, 1442],
    "sha256": "<base.png 的 sha256，可空>"
  },
  "partsFile": "parts.json",
  "parts": 24,
  "issuesFile": "issues.json",
  "issues": 3,
  "files": {
    "layers": "layers/",
    "masks": "masks/",
    "cuts": "cuts/",
    "hidden": "hidden/",
    "cutsHidden": "cuts-hidden/",
    "issues": "issues/",
    "composite": "composite.png",
    "preview": "preview.png",
    "report": "report.md"
  },
  "source": "assets/source/deepseek/three-view/front.png",
  "provenance": {
    "tool": "tools/part-annotator",
    "generator": "part-annotator v1",
    "method": "manual semantic annotation (rect/polygon/brush/wand)",
    "route": "see-through + master snap + master-cut accessories"
  },
  "createdAt": "2026-11-03T09:18:59.245Z",
  "updatedAt": "2026-11-03T09:18:59.245Z"
}
```

约束：`schemaVersion=1`、`kind=parts-bundle`、`partsFile=parts.json`、`base.file ∈ {base.png, base-norm.png}`、
`base.size == canvas`、`alphaMode=straight`（未预乘）、`characters/view` 匹配 `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`。
`files` 里的目录项若出现必须等于固定值；文件项必须落在包内允许集合。

## 3. `parts.json`

```json
{
  "schemaVersion": 1,
  "kind": "parts-list",
  "backToFront": ["hair-back", "hairband", "fin-ear-r", "fin-ear-l", "tail", "..."],
  "parts": [
    {
      "id": "hair-back",
      "name": "hair-back",
      "z": 1,
      "color": "#ff6b6b",
      "note": "后披发；可见区吸附母版",
      "files": {
        "layer": "layers/hair-back.png",
        "mask": "masks/hair-back.png",
        "cut": "cuts/hair-back.png"
      }
    }
  ]
}
```

- `z` 越大越靠前；`backToFront` 必须**恰好列出每个 id 一次**，按 z 升序（后 → 前）。
- `files` 的键可缺省；值必须是包内相对路径。`layer/mask/cut/hiddenMask/hiddenCut` 是约定键名。
- 最多 251 件（`id` 用于 PNG 名，字符集与文件名一致）。

## 3.5 `issues.json`（拆分问题标注）

这是**审查标注**，不是部件贴图：记录“哪里拆得不对、应改成什么样”，供人或 AI 返修。
`index.json` 里出现 `issuesFile` 时必须同时提供 `issues.json`，且 `index.issues == issues.issues.length`。

```json
{
  "schemaVersion": 1,
  "kind": "issues-list",
  "issues": [
    {
      "id": "issue-1",
      "type": "edge-missing",
      "severity": 2,
      "partId": "hair-back",
      "beforePartId": "hair-back",
      "note": "右侧发梢缺 3px，边缘有白边",
      "files": {
        "region": "issues/issue-1.png",
        "before": "issues/issue-1-before.png",
        "after": "issues/issue-1-after.png"
      },
      "bbox": [900, 300, 80, 80],
      "pixels": { "region": 6400, "before": 10000, "after": 10000, "blocks": { "region": 2, "before": 24, "after": 2 } },
      "createdAt": "2026-11-03T10:31:29.958Z"
    }
  ]
}
```

- `type`：`edge-missing` 边缘缺失 · `jagged` 毛边/锯齿 · `under-split` 拆少了 ·
  `over-split` 拆多了 · `wrong-part` 归属错误 · `completion` 补全质量 · `other`。
- `severity`：1 低 / 2 中 / 3 高。
- `partId` **必填**：有问题的部件 id（必须存在于 `parts.json`）。工具里第 1 步选「哪个部件有问题」，
  没有拆分部件时不允许添加问题。
- `beforePartId`（本工具扩展，可选，默认等于 `partId`）：`files.before` 是由**哪一件的可见区**生成的——
  「改动前」不画选区，直接选部件，`before` 掩码 = 该件的可见区像素。
  返修端可以据此把 `before` 与 `masks/<beforePartId>.png` 互相校验。
- `files.region` **必填**：问题实际发生的区域；`before` / `after` 可选：
  `before` = 该部件当前占用的区域（由 `beforePartId` 的可见区生成），
  `after` = 期望该部件改后拥有的区域（可以只圈一部分，允许不完整）。
  三者都是与 `base.png` 同画布的二值掩码（白=属于该区域）。
- **多选区**：`region` / `after` 可以由矩形、多边形、魔法棒**多次累加**而成，
  因此同一张掩码里可能有多个**不相邻的块**；`pixels.blocks` 给出每类的 4 连通块数
  （本工具扩展字段，返修端可用它拆成独立问题区域逐块裁剪）。
- 最多 500 条；`id` 唯一，用作 PNG 文件名。空区域的问题不会写出文件（保存时跳过）。

## 4. 消费约定（给拆件流水线 / 动画）

1. **`masks/` 是可见区真值**：从原图 `base.png` 按 mask 切出的 `cuts/` 与它一致；下游不要再按整层 alpha 猜归属。
2. **`layers/` 是成品件**：可见区 + 被遮挡补全都在这张全画布 RGBA 里；有 `masks/` 时以 mask 判定可见区，
   其余部分视为补全（推测），可用于变形时露出。
3. **`hidden/` 只描述补全范围**：不是原图真实观测；没有该文件就表示该件没有额外补全声明。
4. 画布 = `base.png` 像素尺寸；不要在消费端缩放。合成顺序 = `parts.json.backToFront`。
5. 半透明保留真实 alpha；`alphaMode` 固定 `straight`，缩放时自行预乘/解预乘。
6. **`issues.json` 是返修输入**：按 `type` 决定修法，`region` 定位问题，
   `before` → `after` 描述期望改动（可选）。它不改变 `masks/` / `layers/` 的权威性；
   返修后应更新部件层并同步/关闭对应 issue，而不是把 issue 掩码当贴图。

## 5. 校验

浏览器/Node 共用 `bundle.js`：

```js
const B = window.PartAnnotatorBundle;              // 浏览器
const B = require('./tools/part-annotator/bundle.js'); // Node（ESM 用 import 副作用 + globalThis）
B.validateBundle(index, parts);                     // → {ok, errors[]}
B.validateIndex(index); B.validateParts(parts);
B.validateIssues(issuesDoc);                        // issues.json
B.validateBundleWithIssues(index, parts, issuesDoc); // 含 issues 的整包
B.isSafeRelPath('masks/a.png');                     // true
```

服务端（`serve.py`）在 `POST /api/save-bundle` 时会再校验一遍：文件白名单、PNG 签名、JSON 可解析、
必须含 `index.json`/`parts.json`/`base.png`、`index.parts == parts.parts.length`、
声明 `issuesFile` 时必须带 `issues.json` 且 `index.issues` 数量一致、路径段正则。

## 6. 打开 / 保存 / 导出

| 动作 | 位置 / 语义 |
| --- | --- |
| 打开拆件包 | 标注器 **文件 → 打开拆件包…**（列 `parts-bundles/`）、**按路径打开拆件包…**（仓库任意相对 `index.json`），或深链 `?bundle=<index.json>` |
| 写回当前包 | **Ctrl+S**：改动写回打开时的同一个 `<包>/`（`index.json`/`parts.json`/`issues.json` + `masks`/`cuts`/`issues`/`composite`/`preview` 重写，`layers/`、`report.md` 原样保留）。未打开包时先要求包名 = 新建 |
| 另存为新包 | **Ctrl+Shift+S**：改名写到 `workspace/characters/<角色>/parts-bundles/<新名>/`，原包不动 |
| 导出快照 | **文件 → 导出拆件包 ZIP**（`index.json` 在 ZIP 根，纯前端，只读服务也可用） |
| 现有拆分件转包 | **载入现有拆分件…** → Ctrl+S：带上原 `layers/`，补 `masks/`、`cuts/`、`composite.png`、`preview.png` |

写回细节 / 注意：

- 打开 = 读取一个**文件夹**：浏览器不能凭本地文件路径读兄弟文件，必须经工具服务（列表 / 路径 / `?bundle=`）；
  **直接双击 `index.json` 不会打开工程**——它不像 PSD 是单文件容器。
- 写回是**逐文件原子替换**，不删除孤儿文件：删掉/改名的部件会留下旧的 `layers|masks|cuts/<旧id>.png`。
- `report.md` 若来自原包会被带回；`annotations.json` 每次重写（兼容文件）。
- 写接口只允许写到 `workspace/characters/<角色>/parts-bundles/<包>/`；读取允许仓库内任意相对路径的 `index.json`。
- 想保留旧版本：先 Ctrl+Shift+S 另存，再改新包；或复制整个文件夹（自包含，可直接改名）。

## 7. 与人物包对照

| 人物包（spine bundle） | 拆件包（parts-bundle） | 说明 |
| --- | --- | --- |
| `index.json` | `index.json` | 唯一入口、声明 base 与文件表 |
| `model.json` | `parts.json` | 结构清单（骨骼/槽位 ↔ 部件/层序） |
| `model.atlas` + `model.png` | `layers/*.png`/`masks/*.png` | 图集 ↔ 逐件全画布 PNG |
| `voice/index.json` | `annotations.json`（兼容） | 附加数据，非权威 |
| `?index=` 深链 | `?bundle=` 深链 | 打开方式一致 |

> 版本：`schemaVersion 1`。未来加字段时保持向后兼容；当前校验器不拒绝未知字段（便于先扩后收紧）。