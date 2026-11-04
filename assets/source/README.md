# assets/source · 角色拆件与表情差分精修工作区

本目录是「**三视图 → 拆分部件 + 表情差分**」的精细化工作区：放输入基准、切件产出、差分产出，
以及每批素材的注册信息（`manifest.json`）。后续调部件边界、补遮挡、加表情档位，都在这里做与核对。

**当前状态（2026-11-02）**：

- `deepseek/`：按重做要求，上一版拆件（`parts/`）与表情差分（`expressions/`）已清空；
  `three-view/` 保留为输入基准，拆件 / 差分待重做。
- `doubao/`：三视图（正 / 侧 / 背 + 原图）已入库；拆件与表情差分未开始（本轮只做三视图）。

重做产物按下方布局写回，并各自生成 `manifest.json`。

**不是运行时资源**：运行时只读 `assets/characters/deepseek/` 下的 Spine 图集（`spine/model.*`）；
本目录不参与加载，也不进任何角色的 ZIP 包。

## 目标目录结构

```text
assets/source/
├── README.md
├── deepseek/
│   ├── three-view/                 # 输入：三视图源（正 / 侧 / 背）
│   │   ├── front.png / side.png / back.png
│   │   └── manifest.json           # 尺寸 / 裁剪框 / sha256 / 与 legacy 图集的 region 对照
│   ├── parts/                      # 待重做：拆件
│   │   ├── master.png              # 切件母版（去背，1×）
│   │   ├── labels.png              # 部件归属标签图（诊断 / 复切用，可选）
│   │   ├── 1x/                     # 每件 1× 直切（2px padding，贴边件按画布截断）
│   │   ├── rig/                    # 每件 = 当前图集 region 尺寸（生产输入）
│   │   └── manifest.json
│   └── expressions/                # 待重做：表情差分
│       ├── eyes/                   # 眨眼 5 档：0 / 25 / 50 / 75 / 100 %
│       ├── mouth/                  # 口型 5 档：0 / 25 / 50 / 75 / 100 %
│       ├── emotion/                # 情绪 4 张：happy / sad / surprised / focus
│       └── manifest.json
└── doubao/
    └── three-view/                 # 本轮新增：三视图
        ├── front.png               # 187×654 RGBA（1× 原生裁切）
        ├── side.png                # 152×652 RGBA
        ├── back.png                # 185×649 RGBA
        ├── source.jpg              # 用户提供的原始三视图（1280×720，含浅蓝底）
        └── manifest.json           # 尺寸 / 裁剪框 / 背景键参数 / sha256
    # parts/ 与 expressions/ 未开始
```

## 输入：`three-view/`

每个角色一套**去背的正 / 侧 / 背**（RGBA 透明底），原生裁切、不缩放；各视图分辨率可以不同，
尺寸、源图裁剪框与 sha256 都写在各自的 `three-view/manifest.json`。

- **deepseek**：`side` / `back` 与 `legacy-views` 图集对应 region **逐像素相同**；`front` 已替换为
  用户提供的高清正面立绘（1091×1442，同一张立绘的 2× 版；主体 alpha≈253 属导出特性）。
  三视图分辨率不一致——拆件以 `front` 为母版，侧 / 背只作比例与遮挡参考；上游横版设定图只在本机
  `references/` 保留。
- **doubao**：从用户提供的 1280×720 三视图（`source.jpg`）按浅蓝底色度键去背，地面蓝色软阴影一并
  移除；三张为原生 1× 裁切，正 / 侧 / 背的比例有轻微差异（渲染姿态不同），未做统一缩放。
- 用途：拆件时的比例、层序与遮挡参考；`hair-back` 就是从背视图直切后再按正面语义截断的。
- 换三视图时：先替换三张并更新该角色的 `three-view/manifest.json`，再动拆件。

## 待重做：`parts/`

适用于各角色（deepseek 待重做；doubao 未开始）：

| 文件 / 目录 | 内容 | 验收 |
| --- | --- | --- |
| `master.png` | 去背后的 1× 母版 | 全图 alpha 干净、无棋盘格 / 绿边残留 |
| `1x/` | 逐件 1× 直切（不重采样），每件 2px padding | 按 `bboxA` 贴回母版：最大绝对差 = 0 |
| `rig/` | 母版整张放大一次后按标签切件（`bleed 1px`） | 尺寸与 `spine/model.atlas` 的 region 一一对应 |
| `labels.png` | 归属标签图（可选，诊断 / 复切） | label 编号与件名一一对应并写进 manifest |
| `manifest.json` | 每件注册：`name / z / slot / bone / 1x{size,bboxA,px,sha256} / rig{size,crop,bboxHi,sha256}` | 与实际文件、已集成 rig 的槽位一致 |

### 坐标与命名约定

- **A 坐标**：`master.png` 左上角为原点、1× 像素；`bboxA` 用闭区间 `[x0, y0, x1, y1]`，贴回时以 `(x0-2, y0-2)` 放置。
- **缩放 S**：世界高 / 母版角色高（上一版 `1302 / 557 = 2.33752`）；重做若换母版，重新计算并写进 manifest。
- **左右**：`-l` = 角色自身左侧（画面右侧），`-r` = 角色自身右侧（画面左侧）。
- **z 序**：取已集成 rig 的 slots 下标（数值越大越靠前）；与 `model.json` 保持一致。
- **命名**：kebab-case 语义名，如 `hair-side-l`、`iris-r`、`thigh-l`；差分 `<类别>-<情绪/档位>`。

### 上一版验证过的切件原则（重做时照做）

1. **1× 直切是保真唯一路径**：按标签切件再拼回，最大绝对差应为 0；不要拿 image-edit 当放大/补绘的主路径。
2. **只放大一次**：先把母版整张 LANCZOS 放大，再用 NEAREST 放大的标签图切件；逐件放大必然出 ≤1px 接缝。
3. **被遮挡区要补全**：inpaint 或程序化补绘，否则做转身 / 抬臂时露洞。
4. **头发按语义分层**：前刘海 / 两鬓 / 后披发 / 发带各一件，不能按纯 x 坐标硬切；发带里不得混发丝。
5. **脸与眼珠分开**：`head-face` 只含皮肤、眼白、耳、颈；虹膜单独成件挂眼骨；眼睑层压住虹膜。
6. **碎点与残色**：≥16px 的孤立碎点必须登记或删除；绿幕残色 ≤0.01%。

### 验收门槛（每件 / 整 rig）

| 项 | 阈值 |
| --- | --- |
| 1× 拼回母版 | 最大绝对差 0；silhouette IoU ≥ 0.99；ΔRGB 均值 ≤ 8 |
| alpha 半透明占比（分母 = 前景） | 大件 < 5%；小件边缘（手 / 尾 / 鞋）天然偏高，按实际记录 |
| 轮廓宽高比（相对源图） | 偏差 < 0.5% |
| rig 加载（官方 spine-core 4.2） | 0 报错；允许集的空 slot 记 `MISSING` |
| 整 rig 透底洞 | 0 个 >20px（重点：颈肩带、发际、件间接缝） |
| 动画 bounds 相对 setup | ≤ ±5%（turn 的宽度单独看） |

上一版踩过的坑，重做时优先复查：颈肩带两处透洞（4,855px）、发际 974px 洞、6 处 1px 接缝、
`upper-arm` 是整形块而非原画笔触、发丝/尾巴上的细网格线。

## 待重做：`expressions/`

与当次 `head-face` **共用同一画布与同一 attachment 变换**（上一版为 135×145、`aOff = (131,144)`；
重做按新 head 实际画布重算，并写进 manifest）：

| 集合 | 档位 | 挂载槽 | 要点 |
| --- | --- | --- | --- |
| `eyes/` | 0/25/50/75/100 % | `s_eye-stage` | 000 同时是「眼裂外皮肤 + 上睫毛、眼裂内透明」的罩层，用来压住虹膜越界 |
| `mouth/` | 0/25/50/75/100 % | `s_mouth-stage` | 五档同一嘴中心；开口面积按档位标定 |
| `emotion/` | happy / sad / surprised / focus | `s_expression` | 只改眉 / 眼 / 嘴，不改脸型与轮廓 |

- **驱动方式必须是 attachment swap**，禁止 alpha 交叉淡化（二阶元线稿会出双眼线重影）。
- 差分必须整幅同画布：ROI 外与 `head-face` 逐像素相等（RGB 与 alpha 都是 0 改动），轮廓 XOR = 0。
- 装配时整幅拉伸到 head 附件框，不做逐件 LANCZOS；内容占比与 head 对齐（偏差 <1%）。
- **head-face 一改，14 张差分全部重跑**：先在 manifest 记录生成时的 head `sha256[:16]`，重跑前比对。

### `expressions/manifest.json` 至少包含

- 画布尺寸、`aOff`、`pivot`、眼/嘴 ROI、虹膜 bbox、嘴中心；
- 生成时的 `head-face` sha256；
- 每张的 `file / size / sha256` 与度量（闭合度、开口占比、质心偏差、ROI 外改动、半透明像素）。

## 重做时的脚本与复核

生产脚本在本机 `output/work/`（不入库）；重做后若脚本或命令有变化，请把新命令补到这里：

```bash
# 上一版一条龙（拆件 → 放大切件 → rig → 验收渲染）
bash output/work/parts-v2/scripts/make_final.sh

# 上一版表情差分
python3 output/work/expr-v2/scripts/make_expr.py

# 独立复核：1× 拼回母版
cd output/work/parts-v2 && python3 scripts/compose.py \
  --parts parts --clean probe/master/q-front-alpha-clean.png \
  --ref ../../review/2026-11-06-parts-v2/ref/q-front-alpha.png --out /tmp/compose-check
```

## 维护约定

1. **改图先改 manifest**：新增 / 替换任何 png，都要同步该批 `manifest.json` 的 `size`、`bbox` / `crop`、
   `px`、`sha256` 与度量字段；`sha256` 是跨版本比对与回滚的依据。
2. **两套切件同源**：改了 `1x/` 就重跑放大切件生成 `rig/`，不要让两套长期漂移。
3. **差分跟着 head 走**：`head-face` 一改，先按 `sha256` 判断是否需要重跑全部差分。
4. **命名**：kebab-case；解剖件用语义名；差分 `<类别>-<情绪/档位>`。
5. **不往这里塞运行时产物**：Spine 图集、语音、preview 一律留在 `assets/characters/deepseek/`。

## 历史

- 2026-11-02：deepseek 正面立绘替换为 2× 高清版（1091×1442，用户提供），manifest 已同步；侧 / 背暂未替换。
- 2026-11-02：doubao 三视图入库（只做三视图，拆件 / 差分未开始；素材由用户提供，出处与授权待补）。
- 2026-11-02：deepseek 上一版（parts-v2 / expr-v2）源文件已按重做要求清理；验收报告
  `output/review/2026-11-06-parts-v2/final-report.md`（本地）保留作对照，不作为当前真值。

## 许可

角色素材沿用 **CC BY-NC-SA 4.0**（非官方同人，禁止商用，演绎同许可）。
deepseek 的署名与来源链见 [`../characters/deepseek/ATTRIBUTION.md`](../characters/deepseek/ATTRIBUTION.md)；
doubao 素材目前只有用户提供的三视图，出处与授权需在正式打包前补齐。
