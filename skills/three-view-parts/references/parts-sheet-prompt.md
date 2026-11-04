# 完整 RGBA 部件：提示词与工具适配

使用时机：主技能步骤 1 比较方案后，逐件生成、补全缺层或获取视频参考时读取。提示词是起点，必须根据角色、视图与部件清单改写；本文件不提供本机服务地址、模型名或凭据。

## 1. 同画布单件提取

提供当前视图的基础图；其他视图若作为参考，要说明它们只辅助判断形状与遮挡，不用于改变当前视角。把 `<part>`、`<view>` 与被遮挡区域描述具体化。

```text
Use image 1 as the base for this character's <view> view. Extract only <part> as a
complete, independently usable painted RGBA layer. Preserve its pose, position,
proportions, line work, colors and shading in the original canvas coordinate system.
Complete the portions hidden behind <occluding parts>, including the part's own contour.
Keep the original canvas dimensions. Remove all other character parts and leave those
areas transparent. Do not include a duplicate full character, labels, shadows or a grid.
Output an image with a real alpha channel, not a painted checkerboard background.
```

单件提取会移除其他部件，所以不能同时要求“其他所有像素与整人图一致”。生成结果是完整层候选，验收后可直接作为正式贴图；不要再与原图可见区域求交或用颜色差分截掉补全像素。

### 头发

优先按清单分别生成前刘海、两鬓、后发与发饰；只有清单明确需要整顶头发时才合成一件。

```text
Extract the back hair only. Preserve its outer shape and complete the inner hair hidden
behind the head and shoulders, using matching line work and shading. Keep the hair in the
same position and at the same scale as in the <view> base image. No face or body pixels.
Transparent background, original canvas dimensions.
```

### 脸、眼白、虹膜与嘴

```text
Extract the bare head surface, including the forehead and ears hidden under the hair.
Preserve the head outline, skin tone, pose and position. Remove hair, accessories, eyes,
eyebrows and mouth only if these are separate layers in the supplied part list.
Complete the hidden skin and its contour. Original canvas, real RGBA transparency.
```

眼白、虹膜和嘴按清单分别生成完整 RGBA。背面视图没有脸时标为不适用，不能沿用上一张正面的输出。可见且完整的局部允许直接裁切，但它不是所有部件的默认拆层方法。

### 衣身与手臂

```text
Extract the torso and clothing as one complete layer. Remove both arms and hands.
Reconstruct the clothing behind them, including shoulder contours, side seams and any
hidden skirt fabric. Preserve the costume design, pose and original canvas placement.
Remove the head, hair, legs and other non-target parts. Real RGBA transparency.
```

若衣身和裙子需要分件，分别请求；袖口、手与手臂的分界按清单描述。分层接口若输出多件，不要把它们再次压成一个颜色块。

```text
Extract only the character's <left/right> arm (on the viewer's <side> in this <view>),
including <sleeve or cuff if assigned to this part> and the complete hand and fingers.
Continue the hidden shoulder / upper arm under <occluder> with matching line work.
Keep its pose, scale and original canvas position. Remove the other arm and all non-target
parts. Output real transparency, without reposing the arm or inventing extra fingers.
```

以当前视图检查角色左右与画面左右，尤其是背面；不是每种朝向都能套“角色右＝画面左”。若同一手臂既在衣身后又跨在衣身前，先规划前后件，再为每件描述遮挡和交界，不假设一个固定顺序能正确合成。

### 腿、尾巴、翅膀与饰物

```text
Extract only <part>, described as <position, shape, colors and distinguishing details>.
Complete the portion hidden by <occluder> without changing the part's pose or orientation.
Keep its original canvas placement and a complete outline. Remove all other parts.
Real RGBA transparency, no invented extra limbs or accessories.
```

腿部需要补全时，可增加：

```text
Extract <left leg / right leg / both legs as specified>, including <shoes if assigned>.
Continue the thighs under the clothing up to the hips, following the visible pose and
proportions. Keep the original view and canvas placement. Do not draw extra legs or
alter the costume details that belong to this part. All non-target areas transparent.
```

侧面近 / 远侧部件不能默认靠镜像复制解决；确实无法观察到的结构要记录推测与待确认项。生成前写清哪部分来自当前视图、哪部分参考另一个视图；补画只作为设计推测。

## 2. 局部补全与整层替换

输入该部件当前 RGBA 层，用 mask 或文字区域约束编辑；接口不支持 mask 时不要声称已进行了 mask 保护。

```text
Complete the missing region of <part> behind <occluder>. Continue the surrounding contour,
texture, line weight, shading and color palette. Preserve the layer's original canvas,
pose and placement. Keep the existing artwork outside the edit region unchanged.
Return the complete part with its alpha channel, not only the filled patch.
```

检查未编辑区域是否变化；提示词中的“unchanged”不等于实际零改动。出现整体漂移时重新生成或按已知变换还原；不能凭肉眼任意拉伸。若整个裙子 / 头饰缺失，重新生成完整层，不用超分或从原图截可见碎片伪装补全。

## 3. 执行方式与工具适配

### See-through 官方 Python（不需要 ComfyUI）

先按 [官方 README](https://github.com/shitagaki-lab/see-through#environment-setup) 在独立环境中准备 Python、匹配硬件的 PyTorch、项目依赖与模型。运行目录必须是官方仓库根目录；本技能不替使用者安装环境或下载权重。

以下为官方脚本已提供的参数，路径由使用者填写。从已准备好的官方环境运行：

```sh
python inference/scripts/inference_psd.py --help

# 贴图任务：不加 --save_to_psd，导出独立部件文件
python inference/scripts/inference_psd.py \
  --srcp /absolute/path/to/front.png \
  --save_dir /absolute/path/to/new-run-output \
  --seed 42
```

此入口会依次运行 LayerDiff 与 Marigold，再提取语义件。按已核对的实现，结果在 `<save_dir>/<输入文件名去扩展名>/`；不加 `--save_to_psd` 时，`optimized/` 中有 `<part>.png`、`<part>_depth.png`、部件 JSON 与 `info.json`。加 `--save_to_psd` 切换为 PSD 导出，不能假设它还会写同一套 optimized PNG；按实际输出检查。

- `--srcp` 支持单图或目录；逐视图运行更便于检查背面无脸、缺件与单次运行来源。每轮用新输出目录，避免旧文件混入。
- `--resolution`、`--resolution_depth`、`--inference_steps`、`--group_offload` 等按当前版本帮助与设备能力选择，不照搬历史显存数字。`--tblr_split` 是额外的启发式细分，按部件需求开启并人工核对，不是“必定分对左右”的保证。
- 保存原始图、部件 JSON、深度图及推理记录；`optimized/info.json` 是上游格式，不等于主技能的贴图 manifest。检查 `xyxy`、`frame_size` 与真实 pad/resize 后再换算 offset。
- 官方 CLI 不要求 ComfyUI 的 `/object_info`、节点补丁或共享 `latest.txt`。这些检查只在实际使用相应封装时适用。

### ComfyUI（可选封装）

- 安装与模型按当前节点文档配置。使用 See-through 类语义分层输出完整 RGBA，必要时保留逐像素深度。
- 先从现场 `/object_info` 核对节点输入，再提交工作流。取回时关联本次任务标识和导出记录。
- 保存实际 pad、resize、裁切变换；高清头部的共享记录取回要串行并校验，避免读到上一轮结果。
- 不同运行的深度值不直接混用。版本补丁要先检查兼容性；本技能不附带工作流代码、补丁或模型权重。

### 通用生图 / 改图 API（可独立完成贴图段）

使用云端服务时，生成计算在服务端，本机只做请求、文件处理与验收，不要求本地 GPU 或先运行 See-through。这是通用模型逐件编辑路线，不是通过提示词调用 See-through 权重。

先以同一张参考图试衣身、头发、脸、手臂，完成一轮小规模重合成，检查是否满足完整部件、位置、比例与画风要求，再扩到全部视图。文生图用于候选或缺件方案；已有角色的正式部件优先图生图 / 编辑，并始终提供对应视图基准，不将上一件输出无条件当成下一件基准以免漂移累积。

难点是每次编辑独立生成：完成单件不保证整套层一致。若连续候选无法对齐或补全，把该件标为未解决，比较模型或编辑方案；不把局部成功报告成已达到 See-through 的整套效果。没有深度时按显式遮挡顺序合成，仍按主技能检查缺层与差异。

常见 OpenAI 兼容形态如下；它不是所有服务的统一协议，路径、字段、上传方式与鉴权均以所用服务文档为准：

```text
POST <service-base>/images/generations
  {"model": "<model>", "prompt": "<prompt>"}

POST <service-base>/images/edits
  multipart: model, prompt, image; mask / 多参考图仅在服务支持时使用
```

优先用参考图编辑以保持角色一致；文生图重出整件时，要另外核对身份、服装与画风。先检查业务错误，再按实际响应读取 base64、URL 或任务标识；异步接口要等到任务成功后取回文件。检查实际张数、尺寸和 alpha，不能把某一网关忽略 `n` 或 `size` 的行为推广到所有服务。

服务不支持透明输出时，使用与目标颜色分离的纯色背景，另做去背和边缘核对。不要仅把 RGB 文件转换成 RGBA 就宣称已经透明。

### 生视频 API（辅助参考）

```text
Use the reference character and preserve its costume, proportions and identity.
Show a slow, stable reveal of <occluded region> / a turn from <view A> to <view B>.
Plain background, consistent lighting, no cuts, no added objects or camera shake.
```

遵循服务的提交 → 查询任务 → 下载视频流程。抽取清楚且身份稳定的帧，记录时间点；再以该帧作为分层 / 编辑参考，还原到目标视图画布。视频不是独立 RGBA 层，不能把遮挡参考直接当成角色结构的真实观测。已有足够视图时跳过此路线。

## 4. 结果接入与交付

1. 保存原始返回、运行标识和输入哈希，检查部件语义与隐藏部分完整性。
2. 按主技能步骤 5 还原画布；需要缩放时使用预乘 alpha，保留完整轮廓和变换记录。
3. 同画布层直接合成；裁切层按记录的 offset 放回。允许部件重叠，禁止以颜色差分或原图标签裁掉生成区域。
4. 输出逐件 PNG、manifest、重合成与差异图。图集、骨骼与动画不属于本次交付。

爆炸图 / 拆件 sheet 仅用于方案试验或展示；上游曾出现保留整人且缺件的问题，不将它作为默认正式路线，也不强制要求每件挪开固定间距。
