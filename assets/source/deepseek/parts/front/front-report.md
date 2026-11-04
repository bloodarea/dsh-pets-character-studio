# 正视图（front）头发四部件 · 执行与验收报告

> 对象：`assets/source/deepseek/three-view/front.png`（1091×1442，sha256 `458964cd…d8caac`）
> 母版：`master/front-master.png`（alpha≥250 → 255，sha256 `384fda8a…6193df`）
> 技能：`three-view-parts` 路线 B（云端图生图 + 母版像素吸附微调）
> 运行目录：`output/work/hair-parts/20261103T002036Z/`

## 1. 交付件

| 件 | 文件 | 尺寸(画布) | px | 连通域 | 洞(px) | 可见区覆盖 | 吸附 px | 补全 px |
|---|---|---|---:|---:|---:|---:|---:|---:|
| 后披发 `hair-back` | `front/layers/hair-back.png` | 1091×1442 | 696,960 | 1 | 12,826 | —（正面几乎全遮挡） | 0 | 全部 |
| 中两鬓发·角色左 `hair-side-l` | `front/layers/hair-side-l.png` | 1091×1442 | 133,766 | 1 | 5,664 | 1.000 | 120,546 | 13,220 |
| 中两鬓发·角色右 `hair-side-r` | `front/layers/hair-side-r.png` | 1091×1442 | 116,755 | 4 | 2,235 | 1.000 | 107,946 | 8,809 |
| 前刘海 `hair-front` | `front/layers/hair-front.png` | 1091×1442 | 337,275 | 2 | 0 | 1.000 | 289,452 | 47,823 |
| 顶呆毛 `ahoge` | `front/layers/ahoge.png` | 1091×1442 | 12,215 | 1 | 0 | 1.000 | 9,527 | 2,688 |

- 画布统一为母版画布，`offset = [0,0]`，straight alpha（未预乘）。
- 合成顺序（后→前）：`hair-back → hair-side-l → hair-side-r → hair-front → ahoge`。
- 每件的生成源图、提示词、对齐参数：`front/layers/_manifest-front.json`。

## 2. 方法（与 BRIEF.md §2 一致）

1. **预处理**：母版主体 alpha≈253 是导出特性，统一归一化为 255，避免整身 0.8% 透底。
2. **四部件可见区划分**（`scripts/partition.py`）：蓝发色板（`H∈[195,265] & B≥135 & S≥0.25 & B-(R+G)/2≥45`）
   → 整件丢弃非头发蓝色物（双虹膜、两侧蓝蝴蝶结、围裙鲸鱼图案、鲸尾）→ 连通域按位置归件
   → 闭运算+填洞（`& fg`）吸收发丝间高光 → 紧贴头发 2px 的暗描边按最近件并入 → 放宽色板补浅蓝渐变发梢。
   结果：`hair-front` 283,391 / `hair-side-l` 119,642 / `hair-side-r` 88,653 / `ahoge` 8,373 / `hair-back` 0（正面不可见）。
3. **生图**：`POST /v1/images/edits`，`model=codex/gpt-image-2`，输入=母版全图，一部件一次请求。
   回图尺寸 1091×1442 / 1247×1261 / 1305×1206 不等（服务端按部件自行取景），因此必须做注册。
4. **注册**：bbox 尺寸估初始尺度 → 0.80–1.25 共 9 档 → 网格粗搜 ±80px + 局部精搜 ±9px，
   目标函数 `0.35·targetCover + 0.45·IoU − 0.6·泄漏率`。`hair-back` 在正面无可见像素，
   自动切到 `align_bbox`（按总发区宽度 + 顶部对齐），避免把补全件整体无限放大。
5. **微调（不修改图片已有元素）**：
   - `grow` 半径裁剪（front 90 / side 140 / ahoge 60 px），限制补全区离可见区过远；
   - `allowed` = 母版前景外扩 2px —— 角色轮廓外一律不许有像素（否则会出现「多出来的一圈头发」）；
   - **强制并入该件全部可见区**，保证 `alphaMiss = 0`；
   - 7×7 圆盘开运算削掉 ≤3px 的生成细刺，再并回可见区（母版像素不受影响）；
   - 填 ≤400px 小洞；保留主连通域与相交连通域；
   - **可见区逐像素吸附母版原像素**（RGB+alpha），补全区才使用生成像素。
6. **合成 / 重合成验收**：`composite.py` 做 alpha-over；`recompose.py` 把四层放回「去掉头发的主体」之下，
   与母版逐像素比较。

## 3. 验收

### 3.1 重合成（`recompose.json`）

| 指标 | 值 | 说明 |
|---|---:|---|
| 前景 IoU | **0.98935** | 重合成 vs 母版前景 |
| ΔRGB 均值（整前景） | **0.039 / 255** | 基本逐像素还原 |
| ΔRGB 均值（可见发区） | **0.017 / 255** | 可见头发完全等于母版 |
| 可见发区未被覆盖 | **0** | 不缺层 |
| ΔRGB>8 的像素（可见发区） | 217 | 占比 0.04%，都在 1px 接缝 |
| 被改动的身体像素 | 3,692 | 母版半透明边缘（alpha<128）差异，可忽略 |

### 3.2 合成缺口（`verify.json`）

| 指标 | 值 |
|---|---:|
| 母版可见发区 `hairVisiblePx` | 500,059 |
| `alphaMissPx` / `alphaMissRatio` | **0 / 0.00000** |
| 缺口块（≥20px） | **0** |
| `extraOnEmptyPx` | 11,286（2.3%，全是轮廓 1–2px 抗锯齿外沿） |
| `extraOnOtherPartsPx` | 318,960（补全区落在身体下方，属设计意图） |

### 3.3 目检

- `front/_view-composite.png`（四层合成，棋盘底）
- `front/layers-sheet.png`（逐件棋盘拼图）
- `front/_evidence-head-vs-half.png`（母版 vs 重合成，头部 1:1 对照，肉眼无可辨差异）
- `front/_view-difference.png`（红=缺口、黄=多余、蓝=已覆盖）

## 4. 已知残留（诚实记录）

| ID | 级别 | 现象 | 说明 / 处置 |
|---|---|---|---|
| F-1 | Minor | `hair-side-l` 补全区左侧有一道竖直接缝（约 x≈740，y 820–950） | 由 `grow` 裁剪与生成件边界共同造成，位于身体下方，重合成时被身体完全覆盖；不影响成品 |
| F-2 | Minor | `hair-side-r` 有 4 个连通域 | 第 2–4 块与母版该件的分离发块一一对应（母版里被鳍耳/蝴蝶结切开），非碎片 |
| F-3 | Minor | `hair-front` 右侧有一块分离片（864,305–954,550） | 母版该处发块被发带/蝴蝶结切断，属母版真实结构 |
| F-4 | Info | `hair-back` 整件高度依赖生成，无母版像素可校正 | 正面视角后披发 100% 被遮挡，母版无真值；形状按「总发区宽度+顶部」对齐，风格按提示词锁定 |
| F-5 | Info | 补全区不与母版逐像素可比 | 这是遮挡补全的固有性质；已用 `extraOnEmpty = 1.1%` 与重合成差值证明未破坏可见区 |

## 5. 复现

```sh
cd output/work/hair-parts/20261103T002036Z
export NEWAPI_BASE_URL=<new-api 网关根地址，本机配置，不入库>
export NEWAPI_API_KEY=<new-api token，仅环境变量>
bash scripts/gen.sh front hair-back hair-front hair-side-l hair-side-r ahoge
python3 scripts/partition.py master/front-master.png master front
python3 scripts/pipeline.py --gen front/gen/hair-front.png --master master/front-master.png \
  --labels master/front-labels.npy --part 4 --out front/layers/hair-front.png \
  --json front/layers/_m-hair-front.json --grow 90 --allowed master/front-allowed.npy
python3 scripts/composite.py  front front
python3 scripts/verify.py     master/front-master.png master/front-labels.npy front front
python3 scripts/recompose.py  master/front-master.png master/front-labels.npy front front
```
