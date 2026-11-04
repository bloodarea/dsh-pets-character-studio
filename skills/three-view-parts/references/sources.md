# 方法来源与适配边界

## 主要来源

本技能的方法主要依据 zeroa234 的 [game-asset-spine-portrait](https://github.com/zeroa234/game-asset-aesthetic-test/blob/9c78c1e2a17537a20bf44c1fa96b2525670093f0/extensions/skills/game-asset-spine-portrait/SKILL.md)，对应参考仓库修订 `9c78c1e2a17537a20bf44c1fa96b2525670093f0`。同时参考该技能的配套实现说明、资源来源与同画布编辑提示词，重新组织为只处理贴图的公开说明；未复制其脚本、工作流、补丁、权重或角色资产。

| 上游顺序 | 本技能对应步骤 |
| --- | --- |
| 比较 See-through 语义拆层与同画布逐部件编辑；不再默认像素差分切层 | 步骤 1：比较方案与工具路线 |
| 基础图手与衣身分开，具体描述尾巴、翅膀、发饰；核对同画布编辑 | 步骤 2：准备基础图与清单 |
| 先检层完整性，缺件换种子或较低分辨率，再整层替换 | 步骤 3：生成完整语义部件 |
| 高清头部补丁需兼容；共享记录串行核对，背面不能误取上一张脸 | 步骤 4：按需提高局部清晰度 |
| 逆 pad/resize 变换、预乘 alpha 缩放、逐像素深度合并、保留生成完整轮廓 | 步骤 5 与 6：统一画布、遮挡合成 |
| 先查重合成，再进行骨骼等下游操作 | 步骤 6 与 7：检查并交付贴图，到此结束 |

上游的网格、权重、骨骼、物理、动画与运行时集成不在本技能范围。三视图逐视图处理、生视频 API 参考路线、无深度时的显式遮挡顺序、贴图清单格式是本技能的适配内容，不声称它们都是上游原有实现或已经实测的能力。

## 贴图检查的补充参考

以下项目的方法用于梳理质量检查，不要求安装这些项目，也不复制其代码、权重或角色素材。文中样例结果属于各项目报告，未在本技能环境中复现。

- [多视图实验记录](https://github.com/zeroa234/game-asset-aesthetic-test/blob/9c78c1e2a17537a20bf44c1fa96b2525670093f0/extensions/skills/game-asset-spine-multiview/assets/workspace/config/dir-view-prompts.json)：单图转换与同画布三栏实验；只作为缺视图时的候选，不是所有模型的定律。
- [discrete-sprite-lab 方向约定](https://github.com/qiulinfan/discrete-sprite-lab/blob/f3e36b9efcd1647881b671fe53b58c15f5020b63/skills/create-topdown-8dir-sprites/references/pipeline-contract.md)：身份主图、标志线和跨视图一致性；其像素网格 / 二值 alpha 不作为本技能默认。
- [rig-c/parts 的部件记录](https://github.com/rig-c/parts/blob/feb17a872feea8f657703b4fa0f4b4dd238b3699/src/parts.ts)：来源、坐标、重合成缺口和边界框；其整套组装的原图投影 / 补块不作为本技能默认方法。
- [still2rig-psd 的图层顺序](https://github.com/shinshin86/still2rig-psd/blob/9206c5895c3b236e9fa9a6a54d1c948b76ce0ca8/docs/quality-gates.md)：局部前后交叉需考虑分层；其正面角色顺序和固定部件表不是所有视图的统一契约。
- [image2live2d 的层导入](https://github.com/Wzhang3912/image2live2d/blob/714e7cc9191f1ef6c9a1732c80e8b566ec127d6b/src/image2live2d/core/decompose/sources.py)：已有 PSD 图层的偏移与画布处理；对名称和左右的启发式映射需人工核对。
- [sprite-gen 的透明边缘说明](https://github.com/aldegad/sprite-gen/blob/4f5ccd55c7cf06685a41f954acc1e476b7772ece/docs/chroma-alpha.md)：色键选择、半透明边缘和去污限制；其像素化处理不适合直接用于一般半透明素材。
- [agent-sprite-forge 的局部编辑检查](https://github.com/0x0funky/agent-sprite-forge/blob/5324342fdfab72430f4e9604f3fe427009f8596d/skills/generate2dmap/scripts/edit_locality_check.py)：变换与编辑区域外差异；只适用于要求保留周围画面的编辑。

## 可选工具入口

- [See-through](https://github.com/shitagaki-lab/see-through)：语义 RGBA 分层与深度方法，可独立使用官方 Python，不要求 ComfyUI。
- [官方 Python 入口](https://github.com/shitagaki-lab/see-through/blob/df019de5129d6c4b406587a14c3501669441a783/inference/scripts/inference_psd.py)与[导出实现](https://github.com/shitagaki-lab/see-through/blob/df019de5129d6c4b406587a14c3501669441a783/common/utils/inference_utils.py)：本次命令参数及 PNG / PSD 分支依据，核对修订为 `df019de5129d6c4b406587a14c3501669441a783`。新版本先复核帮助与实现。
- [官方在线演示](https://huggingface.co/spaces/24yearsold/see-through-demo)：免本机安装入口，可用状态与额度以服务为准。
- [ComfyUI-See-through](https://github.com/jtydhr88/ComfyUI-See-through)：第三方可选节点封装与当前安装 / 输出说明。
- [ComfyUI](https://github.com/Comfy-Org/ComfyUI)：工作流与节点运行环境。

以上是工具获取入口，不是本包已安装这些依赖的承诺；具体版本、显存需求、模型与权重条款需按当前上游说明核对。生图 / 改图和生视频 API 使用者自选，本技能不绑定供应商或模型名。

## 验收经验的适用范围

12/255、1%、0.5px、0.99 等数值来自上游历史经验，不是普遍成功保证。必须说明度量方法、统计区域和实际显示尺寸；缺件和语义错误不能由低重合成误差抵消。资源链接与方法来源不代表已经在使用者的环境完成推理验证。
