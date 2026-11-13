# psd-tools API 速查（拆件视角）

本页只记录拆件用得到的行为，基于 psd-tools **1.26.0** 实测。完整 API 见上游文档 <https://psd-tools.readthedocs.io/>；行为与上游冲突时以上游源码与本机实测为准。

## 打开与检查

```python
from psd_tools import PSDImage

psd = PSDImage.open("part.psd")        # PSD 与 PSB 都用 PSDImage
print(psd)                              # PSDImage(mode=RGB size=101x55 depth=8 channels=3)
psd.size                                # (width, height)
psd.width, psd.height
psd.color_mode                          # ColorMode.RGB 等枚举
psd.color_mode.name                     # 'RGB'
psd.depth                               # 8 / 16 / 32
psd.channels
psd.has_preview()                       # 是否带内嵌合并预览
len(psd)                                # 顶层图层数
```

`PSDImage` 与 `Group` 都支持索引、迭代、`reversed()`、`len()`、`in`、`del`。迭代顺序是**背景→前景**（1.7 之前相反），需要前景优先时用 `reversed(psd)`。

## 图层树

```python
def walk(node, depth=0):
    for layer in node:
        print("  " * depth, layer.name, layer.kind, layer.bbox)
        if layer.is_group():
            walk(layer, depth + 1)

walk(psd)
```

- `layer.parent`：所属容器；顶层图层的 parent 是 `PSDImage`。
- `layer.kind`：`pixel`、`group`、`type`、`shape`、`solidcolorfill`、`gradientfill`、`patternfill`、`adjustment`、`smartobject`、`artboard` 等。
- `layer.bbox` / `layer.offset` / `layer.size`：`(left, top, right, bottom)` / `(left, top)` / `(width, height)`。分组 bbox 由可见且非剪贴的子层计算，可能超出画布。
- `layer.visible` 只看自身开关；`layer.is_visible()` 会乘上所有祖先分组。拆件用 `is_visible()`。
- `layer.opacity` 为 0–255；`layer.blend_mode` 是 `BlendMode` 枚举；`layer.clipping` 表示剪贴层；`layer.clip_layers` 取剪贴到该层的一组上层。
- `layer.has_mask()`、`layer.mask`（`Mask` 对象，`mask.topil()` 返回 `L` 模式或 `None`）、`layer.vector_mask`、`layer.origination`。

## 导出像素

```python
part = layer.composite()      # 合成图层 + 蒙版 + 剪贴层，返回 PIL.Image（RGBA）或 None
part = layer.topil()          # 只取图层自身通道，不合成蒙版/剪贴；无像素时 None
part = layer.topil(channel=0) # 单个通道，见 psd_tools.constants.ChannelID
array = layer.numpy()         # 保留位深的 NumPy 数组（color+alpha），无像素时 None
```

- `layer.composite()` 是拆件默认选择：结果尺寸等于图层 bbox（少数 0×0 bbox 的填充/调整层会给整画布），已烘焙蒙版与剪贴层。
- 文字、形状、填充、智能对象导出的是**渲染结果**，不是可编辑数据。
- 图层带缓存像素时优先用缓存；调用 `psd.mark_updated()` 或传 `force=True` 会强制重绘矢量。

整图：

```python
psd.composite()                          # 默认返回内嵌预览（通常 RGB、无 Alpha）
psd.composite(ignore_preview=True)       # 按图层重新合成，RGBA
psd.composite(force=True)                # 强制矢量绘制，RGBA
psd.composite(viewport=(0, 0, 512, 512)) # 指定视口
psd.composite(layer_filter=lambda l: l.is_visible() and l.kind != "type")
psd.thumbnail()                          # 缩小预览
```

`color` / `alpha` 控制背景色与背景透明度；`apply_icc=False` 关闭 ICC 到 sRGB 的转换。

## 蒙版、矢量与智能对象

```python
if layer.has_mask() and layer.mask is not None:
    mask = layer.mask.topil()          # 'L' 灰度，可能为 None（空蒙版）
    print(layer.mask.bbox, layer.mask.size)

print(layer.vector_mask)              # 矢量蒙版
for shape in layer.origination:       # 形状层/带形状信息图层的贝塞尔路径
    print(shape)

so = layer.smart_object               # SmartObjectLayer
if so.detected_filetype in ("jpg", "png", "psd"):
    with so.open() as f:              # 链接型智能对象默认从当前工作目录找
        ...                           # open(external_dir=...) / open(trust_full_path=True)
```

## 文本

```python
print(layer.text)                     # 纯文本
for paragraph in layer.typesetting:   # 段落/字符样式
    print(paragraph.style.justification)
    for run in paragraph:
        print(run.text, run.style.font_name, run.style.font_size)
```

psd-tools 不做字体渲染；文本层导出依赖缓存像素，缓存缺失时才绘制，字形可能与 Photoshop 不同。

## 颜色模式与位深

| 情况 | 行为 |
| --- | --- |
| RGB / 灰度 / 索引 | `topil()`、`composite()` 正常输出，合成后多为 RGBA（PIL 只有 8 位）。 |
| CMYK / LAB | 默认按内嵌 ICC 转 sRGB；`apply_icc=False` 保留原色彩空间。PNG 不能存 CMYK，需 TIFF/JPEG。无内嵌 ICC 的 CMYK 文档保持 CMYK。 |
| 多通道 Multichannel | PIL 无多通道模式，只保留首个专色通道；需要全部通道用 `psd_tools.composite.composite()` 取 NumPy。PSD 多通道文档的图层记录可能被 Photoshop 丢弃，只能 `topil()` 取合并数据。 |
| 16/32 位 | PIL 输出 8 位；`numpy()` 保留存储精度；32→8 位按 Photoshop 色调映射。 |
| 双色调 / LAB 混合 | 近似实现并告警，不要当作精确还原。 |

## 编辑与保存

```python
layer.name = "updated"
psdimage.save("out.psd")              # 有编辑时重建内嵌预览
psdimage.mark_updated()               # 直接改底层记录后必须调用
```

psd-tools 的编辑能力有限：不支持改文本/形状/智能对象内容，大部分图层效果不参与合成。拆件场景通常只读，不保存。

### 保存后的兼容性（实测，psd-tools 1.26.0 + Photoshop 26.2）

**psd-tools 能写、也能再读回，不代表 Photoshop 能打开。** 按实测把改动的风险分三档：

| 改动 | Photoshop | 备注 |
| --- | --- | --- |
| `layer.name = ...`（走 setter） | ✅ | legacy 名会被写成 `"?"`，中文名进 `luni` 块 |
| `create_pixel_layer()` + `move_to_group()` 追加到现有组 | ✅ | 新层落在该组最上层 |
| `visible` / `opacity` / `blend_mode` / `clipping` | ✅ | 剪贴标记在 PS 里表现为 `Grouped=true` |
| `left` / `top` 平移整层 | ✅ | 只改位置与通道尺寸 |
| `create_group()` / `delete_layer()` 新建或删除**图层组** | ❌ | PS 报「无法打开文件，因为打开选项不正确」；psd-tools 仍能读回，极易误判 |

原则：**能打补丁就不要重组结构**。需要调层序/层级时，交给 Photoshop，或改完让 Photoshop 另存。

非 ASCII 名还有一个坑：`Layer.name` 的 setter 会把 legacy（macroman）名置为 `"?"`；若绕过 setter 把 CJK 直接写进 `layer._record.name`，`save()` 会在 `write_pascal_string` 抛 `UnicodeEncodeError: ... macroman`。要保留可读 legacy 名就写 ASCII：

```python
layer.name = "眼白_左"                    # luni：中文名
layer._record.name = "eye-white-l"        # legacy：ASCII 兜底
```

剪贴蒙版另有一条：`layer.clipping = True` 的层**必须紧贴基底之上**，中间不能夹别的层；基底即使隐藏，PS 仍按基底 alpha 裁切。

## 限制与错误

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
    max_alloc_bytes=512 * 1024**2,
)
```

- `max_alloc_bytes`：单次渲染分配的字节上限，默认 4 GiB（`psd_tools.api.utils.DEFAULT_MAX_ALLOC_BYTES`）。可传 `"unlimited"`；文档级设置优先于全局 `psd_tools.api.utils.MAX_ALLOC_BYTES`（该值从 `PSD_TOOLS_MAX_ALLOC_BYTES` 读取）。超预算抛 `ValueError`，图层效果超预算会被跳过。
- `ParseLimits`：结构解析的对象数/嵌套深度/读取字节上限；超限抛 `ParseLimitError`。
- 单轴 30000 px 上限（PSB 同样适用）。
- 损坏数据的错误类型只有 `ValueError`（含上述两个异常）或 `OSError`；`TypeError`/`IndexError`/`KeyError` 是调用方错误。
- 预算不限制进程总内存、CPU 或解析以外的开销；不可信文件单独进程 + OS 限制 + 超时。

## 命令行

```sh
psd-tools show part.psd                  # 图层树
psd-tools export part.psd out.png        # 整图
psd-tools export "part.psd[0]" l0.png    # 单层
psd-tools debug part.psd                 # 底层结构
```

## 实测夹具

本技能脚本在上游测试夹具上验证过（`references/psd-tools/tests/psd_files/`）：`2layers.psd`、`group.psd`、`masks.psd`、`text.psd`、`16bit5x5.psd`、`32bit5x5.psd`、`vector-mask.psd`、`semi-transparent-layers.psd`、`0layers.psb`，以及 `colormodes/4x4_8bit_cmyk.psd`。验收方式：按 manifest 的 `offset` 叠回部件，与 `_preview.png` 逐像素比较，差异只允许出现在抗锯齿边缘（每通道 1–2 级）。
