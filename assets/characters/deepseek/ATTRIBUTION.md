# 素材来源与出处核查 · deepseek 角色包

本文件记录素材的完整创作链、可核实来源与**未采用**的内容，便于权利人核查与后续维护。
法律条款见同目录 [LICENSE](LICENSE)。

## 1. 创作链

```
上善无形 / 上善（原始鲸鱼娘形象）
   └─ ZipZipPipe（加入 DeepSeek 元素与女仆装，明确声明 CC BY-NC-SA 4.0）
        ├─ lmy414/ai-chan-sheets    设定图补全、三视图整理
        └─ Photonico/AI_characters  Q 版、视图、提示词记录
```

ZipZipPipe 在《大AI和小AI们》简介与 2026-09-12 动态中明确：DeepSeek 二次设计采用
**CC BY-NC-SA 4.0**，形象不可商业化。

- 作者版权声明（2026-09-12 动态）：https://www.bilibili.com/opus/1247156596114456581
- 作品简介：https://www.bilibili.com/video/BV1tE9XBbErS/
- CC BY-NC-SA 4.0 中文说明：https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans

## 2. 上游仓库与许可状态

| 仓库 | 角色 | 许可声明 | 核验备注 |
| --- | --- | --- | --- |
| https://github.com/lmy414/ai-chan-sheets | 设定图 / 三视图 / 脚本 | 自有部分 CC BY-NC-SA 4.0；原形象版权归 ZipZipPipe | 第 12、13、14 条来源作者「未标注 / unknown」，本包**未采用**这几条 |
| https://github.com/Photonico/AI_characters | Q 版、视图、prompt 记录 | README 写「originally licensed under CC BY 4.0, modifications by Photonico」 | 该仓库无 LICENSE 文件；其 BY 4.0 声明与上游 NC-SA 4.0 不兼容，**本包按更严格的 NC-SA 4.0 处理** |
| https://github.com/shuaizenge/ai-girls | 素材整理与逐项出处（`catalog.json`） | 不授予新许可，仅记录来源 | 用作出处核查依据，不直接取用文件 |

## 3. 未采用的内容（重要）

| 内容 | 原因 |
| --- | --- |
| `ai-chan-sheets` 第 12/13/14 条（冬装小肥鱼、白紫龙娘小 GPT、Claude 工牌工作服） | 来源作者与授权均为 unknown，无法确认权利状态 |
| `ai-girls` 中的 `DeepSeek娘_人声.mp3` | 该页明确「未经作者授权禁止转载」，且含 AI 生成语音，不可再分发 |
| 任何厂商官方素材（头像、Logo、官方插画） | 品牌与商标权利，非社区同人素材 |
| 第三方配音 | 需独立授权。本包语音**不是真人录音**，而是厂商 TTS 生成的非官方二创（见 §6），不含真人声音克隆 |

## 4. 本包的改动

裁切、缩放、透明背景处理、Spine 图集与骨骼重组、目录结构化。**未改**角色设定与配色。

具体处理链：

1. **生图模型转绿幕**：把三视图逐张（正/侧/背）交给 `codex/gpt-image-2.5` 做 image edit，
   要求"保持角色不变、换成纯绿 #00FF00 背景、去掉发丝间白缝、保留蕾丝与眼内高光"；
2. **本地绿键抠图**：按绿色溢出计算 alpha 并去绿边（`scripts/greenscreen-views-to-spine.py`），
   比白底阈值干净——页白与绘画白在颜色上无法区分，绿幕把这个问题绕开了；
3. **闭合页白清理**：头顶呆毛的环把页白包在里面，绿键删不到，按"顶部 15% 内、面积 ≥5000px、
   中性白"清理；同时把面积 <600px 的透明碎洞从周围像素补回（模型会把眼底/蕾丝缝也画成绿色）；
4. **预乘 alpha 缩放**：先 RGB×alpha 再 LANCZOS，避免白底混进边缘造成白边与锯齿；
5. **打包与装配**：2048² 单页图集（3px bleed）+ Spine 4.2 骨架（root→body→head，
   三视图为同槽位可切换附件）+ 动画 `idle / working / attention / done / failed / turn`。

⚠️ 模型是**重画**而非从原图拆层：姿态、配色、服装一致，但眼睛高光与发饰细节有轻微漂移。

## 5. 当前资产状态与限制

| 项 | 状态 |
| --- | --- |
| `spine/model.json` / `model.atlas` / `model.png` | ✅ 已生成，官方 spine-core 4.2 无头校验通过（3 骨 / 1 槽 / 3 区域 / 6 动画） |
| `preview.webp` | ✅ 已生成（512px 高） |
| 语音 `voice/` | ✅ 已就绪：`voice/index.json` + 48 条 `voice/<event>/<id>.ogg`（厂商 TTS 生成的非官方二创，见 §6） |
| 拆件（头/身/四肢/头发独立摆动） | ❌ 未做。三视图是三个整身姿态，**不是分层素材**，无法据此拆骨 |
| 网格形变 / 权重 / 眨眼嘴型 | ❌ 未做，需分层源图或 GPU 语义拆层（ComfyUI + See-through） |

也就是说：当前动效是「整身变换 + 三视图切换」，能跑、能看、可被运行时加载，
但没有肢体独立动作。要升级为真正的拆件骨骼，需要分层素材（见下）。

需要的素材规格（分层源）：

- 同一画布的透明 PNG 分层（或 PSD），层序：后发 / 身体+裙 / 腿×2 / 手臂×2 / 头 / 前发 /
  眼白 / 瞳孔 / 上眼睑 / 嘴 / 头饰 / 尾巴；
- 被遮挡区域必须补全（inpaint），否则转动时露出空洞；
- 源分辨率约为显示高度的 2–3 倍（桌宠显示 480px → 源图 1200–1440px 高）；
- 表情差分同画布：happy / sad / surprised / focus。

## 6. 语音来源与授权（`voice/`）

本包语音是**非官方二创配音**，由**大模型厂商 TTS 服务（DeepSeek）**在开发期批量生成的固定音频；
不是真人录音，不含真人声音克隆，也不代表厂商官方配音、官方认可或与厂商的任何合作。

- 内容：48 条原创二创台词（鲸鱼娘社区梗），逐条记录在 `voice/index.json`（`lines[].text`）。
- 生成方式：按 `lines[].text` 离线逐条合成，参考 `voice_profile` / `emotion` / `delivery` 控制风格；
  运行时只播放固定文件，**不做实时 TTS**，也不会把会话正文送进语音服务。
- 规范化边界：本轮只做文件搬移（`voice/<event>/<id>.ogg`）与索引改写，**未转码、未改动音频字节**
  （96 个文件 sha256 前后一致）；实测格式为 Ogg Opus / mono / 24 kHz 输入，Chromium 可解码。
- 具体模型版本、生成参数与调用条款以本地生成记录为准；这些记录不随包分发。
- **分发前必须复核厂商条款**：确认 TTS 产物可用于本项目的非商业分发并兼容 CC BY-NC-SA 4.0 语境；
  条款不明、受限或禁止再分发的音频一律移除，不做"先发再补"。
- 语音文本与音频的授权，和角色美术素材的授权链（§1–§2）相互独立；美术仍以 ZipZipPipe 的
  CC BY-NC-SA 4.0 为准，不因语音而放宽。
- 如厂商条款后续不允许此类再分发：删除 `voice/` 并从 `manifest.json` 移除 `voice` 字段，
  角色回到静音形态，其它功能不受影响。

## 7. 更正与下架

发现署名错误、来源缺失或权利争议，请在
https://github.com/bloodarea/dsh-pets/issues 提交，注明文件路径与可核实的作品出处。
