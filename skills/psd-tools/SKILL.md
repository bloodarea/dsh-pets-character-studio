---
name: psd-tools
description: 用 psd-tools 把 PSD/PSB 拆成带 Alpha 的 PNG 部件：查看图层树、按图层或分组导出部件、合成透明预览、提取蒙版，并核对尺寸、偏移、可见性与颜色模式。
whenToUse: 需要从 PSD/PSB 拆件、导出图层 PNG、检查图层名称/尺寸/偏移/可见性，或排查 psd-tools 的透明合成、颜色模式与位深问题时加载。
---

# PSD 拆件（psd-tools）

`psd-tools` 是纯 Python 的 PSD/PSB 读取与基础合成库。本技能把它固定成人物包拆件的工作流：先看图层树，再把每个可见叶子图层导出成带 Alpha 的 PNG，并写一份可重组的 `manifest.json`。

上游资料、许可与更新方式见 [references/upstream.md](references/upstream.md)；API 细节与边界见 [references/guide.md](references/guide.md)。

## 先确认依赖

```sh
python -m pip install "psd-tools>=1.26,<2"
# 需要矢量描边、渐变/图案填充、图层效果时再加 composite extra：
python -m pip install "psd-tools[composite]>=1.26,<2"
```

- 脚本只需 `psd-tools` 与 Pillow；`numpy` 随 psd-tools 一起装。Windows 上用 `py -3` 或虚拟环境里的 `python`，不要用 `python3`。
- 没有 `composite` extra 时基础合成仍可用（缓存像素 + 简单像素运算），但矢量描边、渐变/图案填充、图层效果可能缺失或绘制为纯色，**不要据此判断 PSD 本身坏了**。
- 版本以本仓 `requirements.txt` 与 `references/upstream.md` 记录的测试版本为准。

## 首选：随技能脚本拆件

脚本在 `scripts/psd_parts.py`，不解析 PSD 二进制之外的任何项目约定。示例以技能目录为工作目录；从别处调用时把脚本路径换成绝对路径即可。

```sh
# 1. 看图层树（默认只列可见图层）
python scripts/psd_parts.py list part.psd
python scripts/psd_parts.py list part.psd --all --json

# 2. 拆件：每个可见叶子图层一个 PNG，分组映射为目录
python scripts/psd_parts.py extract part.psd --out parts/ --preview --with-masks

# 3. 隐藏图层也要、或者要扁平文件名
python scripts/psd_parts.py extract part.psd --out parts/ --all --flat --dry-run
```

`extract` 的约定：

| 行为 | 说明 |
| --- | --- |
| 图层范围 | 默认只导 `layer.is_visible()` 的叶子图层；`--all` 连隐藏层一起导。分组本身不出图，分组成目录。 |
| 文件名 | 图层名清洗 Windows 非法字符（`<>:"/\|?*` 与控制符），重名追加 `__2`、`__3`；空名按 `kind_序号`。 |
| 尺寸 | 每个部件是**图层自己 bbox 大小**的透明 PNG，不是整画布。 |
| 偏移 | `manifest.json` 的 `offset` 是 `(left, top)`，重组时按它贴回画布，**不要居中裁切或重新排版**。 |
| 蒙版 | 默认合成结果已含图层蒙版与剪贴层；`--with-masks` 额外把蒙版本体存成 `<部件>__mask.png`（灰度）。 |
| 预览 | `--preview` 用 `psd.composite(ignore_preview=True)` 生成 `_preview.png`（RGBA），用于核对拆件效果。 |
| 排序 | manifest 按 PSD 图层顺序（背景→前景）记录，按此顺序叠加即可还原。 |
| 退出码 | `0` 成功；`1` 有图层导出失败（明细在 stderr 与 manifest 的 `failures`）；`2` 参数、依赖或文件读取错误。 |

`manifest.json` 关键字段：`source`、`canvas`（宽高）、`colorMode`、`depth`、`channels`、`psdToolsVersion`、`count`，以及逐层 `name`、`kind`、`bbox`、`size`、`offset`、`opacity`、`blendMode`、`visible`、`effectivelyVisible`、`clipping`、`hasMask`、`groupPath`、`output`、`outputSize`（有蒙版时 `maskOutput`）。顶层 `skipped` 记录隐藏/无像素图层，`failures` 记录异常。

大图或不可信文件加 `--max-alloc-mb`（渲染预算），例如 `--max-alloc-mb 1024`；预算不足时 psd-tools 抛 `ValueError`，脚本按图层失败上报。

## 直接调用 API

脚本覆盖不到的情况直接用 Python：

```python
from psd_tools import PSDImage

psd = PSDImage.open("part.psd")          # PSB 同样用 PSDImage
psd.size, psd.color_mode, psd.depth, psd.channels

for layer in psd:                         # 背景 → 前景
    print(layer.name, layer.kind, layer.bbox, layer.offset, layer.is_visible())
    if layer.is_group():
        for child in layer:               # 递归
            ...

part = layer.composite()                  # PIL RGBA，已含蒙版与剪贴层；无像素时为 None
part.save(f"{layer.name}.png")

whole = psd.composite(ignore_preview=True)  # 渲染整图，RGBA；不加参数返回内嵌预览（通常 RGB、无 Alpha）
```

常用属性与取舍：

- 可见性：`layer.visible` 只看自己，`layer.is_visible()` 会算上分组，拆件一律用后者。
- 图层类型：`kind` 为 `pixel`、`group`、`type`、`shape`、`solidcolorfill`、`gradientfill`、`patternfill`、`adjustment`、`smartobject` 等；文本/形状/填充/智能对象导出的是**渲染后的像素**，不能由此还原可编辑图层。
- 精确像素：`layer.topil()` 只取图层自身通道（不含蒙版/剪贴），`layer.numpy()` 保留 16/32 位精度。
- 蒙版：`layer.has_mask()`、`layer.mask.topil()`；矢量蒙版在 `layer.vector_mask` / `layer.origination`。
- 智能对象：`layer.smart_object`，`detected_filetype` 为 `jpg`/`png` 等时可 `open()` 读嵌入文件。
- 文本：`layer.text`；排版细节在 `layer.typesetting`。
- 修改后保存：`psd.save()` 会重建内嵌预览；绕过 API 改底层记录后要 `psd.mark_updated()`。**能写不等于 Photoshop 能打开**，见下一节。

命令行替代方案（只需整图或单层、不想写代码时）：

```sh
psd-tools show part.psd            # 图层树
psd-tools export part.psd out.png  # 整图
psd-tools export "part.psd[0]" layer0.png
```

## 拆件与验收

1. 用 `list` 核对图层数、分组、可见性；隐藏层或空层缺部件是预期行为，确认后再决定是否 `--all`。
2. 拆件后检查每个 PNG：`mode=RGBA`、`size == layer.size`、Alpha 既非全 255 也非全 0（全 255 通常说明导出的是不透明底板或整图画布，全 0 说明图层无像素或缺资源）。
3. 把部件按 manifest 的 `offset` 顺序叠回 `canvas`，与 `_preview.png` 比较；差异应只出现在抗锯齿边缘（每通道 1–2 级）。差异成块说明顺序、偏移或蒙版用错。
4. 部件重组不等于 Photoshop 渲染：文本字体缺失、图层效果、部分混合模式、矢量描边的结果可能不同；以 `_preview.png` 为 psd-tools 侧基准，并与 Photoshop 导出的人工基准逐区比对。
5. 人物包发布前按包内约定重命名动作目录，保留 `manifest.json` 作为溯源与重组依据。

## 写回 PSD：安全边界（实测）

`psd.save()` 能写、psd-tools 也能再读回，**都不代表 Photoshop 能打开**。按实测（psd-tools 1.26.0 + Photoshop 26.2）分三档：

| 改动 | Photoshop | 说明 |
| --- | --- | --- |
| 改 `layer.name` | ✅ | legacy 名会变成 `"?"`，中文名进 `luni` 块 |
| `create_pixel_layer()` + `move_to_group()` 追加到已有组 | ✅ | 新层落在该组最上层 |
| 改 `visible` / `opacity` / `blend_mode` / `clipping` | ✅ | 剪贴标记在 PS 里表现为 `Grouped=true`，确实生效 |
| 改 `left` / `top` 平移整层 | ✅ | 只动位置与通道尺寸 |
| **`create_group()` / `delete_layer()` 新建或删除图层组** | ❌ **PS 报「无法打开文件，因为打开选项不正确」** | psd-tools 仍能读回，最容易误判 |

原则：**能打补丁就不要重组结构**。要调层序/层级就交给 Photoshop，或改完让 Photoshop 另存一份。

两个额外坑：

- **非 ASCII 图层名**：`Layer.name` 的 setter 会把 legacy（macroman）名置为 `"?"`，Unicode 名进 `luni`，这是正常的；但绕过 setter 把 CJK 直接写进 `layer._record.name`，`save()` 会在 `write_pascal_string` 抛 `UnicodeEncodeError: ... macroman`。要保留可读 legacy 名就写 ASCII：
  ```python
  layer.name = "眼白_左"                  # luni：中文名
  layer._record.name = "eye-white-l"      # legacy：ASCII 兜底
  ```
- **剪贴蒙版**：`layer.clipping = True` 的层**必须紧贴基底之上**，中间不能夹别的层；基底即使隐藏，PS 仍按基底 alpha 裁切。

### 用 Photoshop 验证（Windows，推荐）

写回后真开一次，抛异常即文件坏：

```powershell
$app = New-Object -ComObject 'Photoshop.Application'
$app.DisplayDialogs = 3
$doc = $app.Open('F:\path\to\part.psd')   # 打不开会抛错
$doc.Close(2)                              # 2 = 不保存
```

要看细节再取 `$doc.Layers.Count`、逐层 `$l.Name` / `$l.Visible` / `$l.Grouped`（剪贴）。

## 颜色模式与位深

- RGB/灰度/索引：正常导出 RGBA。
- CMYK / LAB：默认通过内嵌 ICC 转 sRGB；`apply_icc=False` 保留原色彩空间，但 **PNG 存不下 CMYK**，需要 TIFF/JPEG。无内嵌配置的 CMYK 文档保持 CMYK。
- 多通道（Multichannel）：PIL 无多通道模式，只保留首个专色通道；需要全部通道时用 `psd_tools.composite.composite()` 取 NumPy。
- 16/32 位：PIL 只有 8 位，`topil()`/`composite()` 会降到 8 位；需要原精度用 `numpy()`。32 位窄化按 Photoshop 的色调映射处理。
- 双色调（Duotone）与 LAB 混合是近似实现，会告警。

## 不可信 PSD 的安全边界

PSD 可声明远超实际内容的像素，小文件也能申请数 GiB。处理来源不明的文件时：

```python
from psd_tools import ParseLimits, PSDImage

psd = PSDImage.open(
    "untrusted.psd",
    parse_limits=ParseLimits(
        max_read_bytes=64 * 1024**2,
        max_total_bytes=256 * 1024**2,
        max_objects=100_000,
        max_nesting_depth=32,
    ),
    max_alloc_bytes=512 * 1024**2,   # 渲染分配预算，默认 4 GiB
)
```

- 也可用环境变量 `PSD_TOOLS_MAX_ALLOC_BYTES=536870912` 或 `psd_tools.api.utils.MAX_ALLOC_BYTES` 设全局预算；文档级设置优先。
- 单轴上限 30000 px（PSB 同样适用）。
- 预算是**单次分配**上限，不限制进程总内存或 CPU；不可信文件应每个文件单独进程并加 OS 内存上限与超时。
- 文件数据错误只会抛 `ValueError`（含 `ParseLimitError`、`DecompressionLimitError`）或 `OSError`；`TypeError` 等属于调用方参数错误。

## 排错

| 现象 | 处理 |
| --- | --- |
| 合成结果纯色、缺渐变/描边/效果 | 未装 `composite` extra，或 psd-tools 不支持该效果；装 extra 后重试并如实说明差异。 |
| 部件全透明 | 图层在隐藏分组里（`visible=True` 但 `is_visible()=False`）、图层本身无像素，或该层只有蒙版没有 RGB。 |
| 部件尺寸与预期不符 | 部件是图层 bbox 大小；`manifest` 的 `offset`+`outputSize` 才是画布坐标。0×0 bbox 的图层会输出整画布图（通常全透明）。 |
| 图层名乱码 | PSD 旧式编码名；psd-tools 取不到 Unicode 名时按 `kind_序号` 命名，不要手改二进制。 |
| 大文件内存爆炸 | 用 `--max-alloc-mb`、逐层 `topil()`，不要整图 `numpy()`；必要时先 `thumbnail()` 做预览。 |
| `save()` 抛 `UnicodeEncodeError: ... macroman` | 非 ASCII 图层名被写进了 legacy 名；见「写回 PSD」里的 ASCII 兜底写法。 |
| Photoshop 打不开保存后的 PSD，psd-tools 却能读回 | 保存前很可能 `create_group()` / `delete_layer()` 重组过结构；改成只改名/追加/改属性，或让 Photoshop 另存。 |
| 剪贴蒙版在 PS 里没生效 | 被剪贴的层必须紧贴基底之上；中间夹了别的层就会被当成独立层。 |
| `ImportError: aggdraw/scipy` | 缺 `composite` extra；基础合成可继续，但不能声称矢量/效果已正确渲染。 |

## 更新与来源

本技能内置的是**用法封装**，不是 psd-tools 源码：运行时依赖 PyPI 包。上游克隆只在本机 `references/psd-tools/`（已被 `.gitignore` 忽略），用于读源码与测试夹具。升级步骤见 [references/upstream.md](references/upstream.md)。
