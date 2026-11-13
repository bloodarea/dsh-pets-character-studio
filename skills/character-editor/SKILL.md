---
name: character-editor
description: 用内置人物包管理器（tools/character-editor）在不点界面的情况下载入 Spine 4.2 人物包、改动画/关键帧/骨骼/约束、保存副本，并用官方 4.2.120 runtime 与自测套件验证结果；面向 agent 自动化的接口契约与错误码。
whenToUse: 需要脚本化编辑 Spine 4.2 runtime JSON（动画关键帧、骨/槽/形变/事件/约束轨道、镜像、片段、骨架结构），或在不打开浏览器 UI 的情况下载入人物包、保存副本、跑官方对照与自测验收时加载。
---

# 内置人物包管理器：自动化接口契约

`tools/character-editor/` 是本仓现役的**零依赖** Spine 4.2 runtime JSON 查看/编辑工具（浏览器打开 `tools/character-editor/selftest.html` 旁边的 `index.html`；Node 侧可直接 `require` 纯模块）。界面正在收敛为「只给用户 6 个简单动作」，**复杂能力走本技能描述的自动化接口**。

两层接口，职责不同：

| 层 | 入口 | 适用 |
| --- | --- | --- |
| 页面句柄 | `window.__characterEditor`（浏览器内，非公开 API） | 载入/选动画/播放头/保存/校验/抓快照；需要页面渲染与 localStorage 的能力 |
| 纯模块 | `require("tools/character-editor/<模块>.js")` → `globalThis.Spine*` | 所有**数据写入**（无 DOM，可在 Node 脚本里直接跑，不依赖浏览器） |

> 写入优先走纯模块：可重复、可测试、不依赖页面状态。页面句柄用于「载入 → 观察 → 保存 → 校验」闭环。

详细句柄表、模块签名与错误码见 [references/automation-api.md](references/automation-api.md)。

## 启动与载入

工作目录必须是**仓库根**（静态根即仓库根）：

```sh
python tools/character-editor/serve.py --port 8123 --no-browser
# 可选：--bind 127.0.0.1（默认仅本机；非回环只读）、--strict-port、--no-restart
```

然后打开（或用 CDP 导航）：

```
http://127.0.0.1:8123/tools/character-editor/index.html?index=<仓库相对 index.json>
http://127.0.0.1:8123/tools/character-editor/index.html?rig=<仓库相对 rig.json>&voice=<仓库相对 voice.json>
```

- `?index=` 载入人物包索引（`index.json`，页面按包子项列出动画/模型）；`?rig=` 直接载入单个 rig JSON；`?voice=` 附带事件语音清单。三者可组合。
- **真实包只读**：`references/`、`assets/characters/`、`workspace/three-view-to-spine-anime/` 下的原包**只读**。自动化一律先复制到 `workspace/tmp/`（例如 `workspace/tmp/auto/<name>/`）再改，保存也只写副本。

## 自动化主入口

```js
const ed = window.__characterEditor;          // 非公开 API，随版本演进；先 ed.version() 记录版本
ed.version();                                  // → {version:"0.4.4", schemaVersion:1, apiVersion:1, builtAt:"…"}
await ed.loadIndex("workspace/tmp/auto/pkg/index.json");
ed.setMode("animate"); ed.setPlayhead(0.5); ed.selectBone("b1");
ed.keySelected(["x","y","rotation"]);          // 只对当前选中骨按当前局部值打键
ed.pose();                                     // 只读姿态快照（local/world）
ed.timeline();                                 // 行/键时间/播放范围
await ed.saveToDisk();                         // 仅回环地址；async
```

常用分组（完整签名见 references）：版本与状态 `version/state/edit/probeCapabilities`；载入保存 `loadIndex/loadRig/loadExample/loadFixture/saveToDisk/saveAsZip/patchedModel/modelSignature`；选择与模式 `selectBone/setMode/setTool/setTarget/setSpace/setAutoKey/keySelected/spaceGate`；姿态几何 `pose/boneValues/boneScreen/worldSnapshot/geomHash/poseTip`；动画与时间轴 `animEdit/animSelect/animSetDuration/animAddBoneKey/animAddSlotKey/animRemoveKey/setPlayhead/setPreviewRange/timeline/selectKeyByTime/deleteSelectedKey`；轨道 `tracks/trackRows/trackSelect/trackEdit/trackSetVertex/trackAddAtPlayhead/trackDeleteAtPlayhead/trackFilter/trackSearch/dsRows/dsStat/newDeformCandidates/newDeformKey`；选择集与剪贴板 `selection/selectKeyItem/selectAll/batchMove/batchDelete/copyKeys/pasteKeys`；镜像/片段/IK/骨架 `mirrorRun/mirrorWrite/clips/clipSave/clipInsert/ik/ikChain/skeleton/skelCreate/skelReparent/skelRename/skelDelete/skelValidate`；轴心/洋葱 `pivot/pivotPreview/onionState/trailState`；偏好 `prefs/shortcuts/rebindShortcut/resolveKey`。

**核对过的易错点**（以代码为准，见 `app.js` 的 `window.__characterEditor` 定义）：

- `version()` 返回**对象**（0.4.4 / schema 1 / api 1），不是字符串。
- `trackRows()` 在对象字面量里定义了两次，**后者覆盖前者** → 实际返回 `trackSnapshot().rows`。
- `mirrorRun(scope)` 参数是 `"anim" | "bone"`（默认 `"bone"`），不是布尔。
- `keySelected(fields)` 只打键不改值；改值要先拖拽，或直接用纯模块写数据。
- `saveToDisk()` / `loadIndex()` 都是 **async**。
- `simple` 命名空间**已实现**（0.4.x，见下文「简单模式」）；`simpleUi()` / `setUiMode()` / `simpleGuide()` / `simpleHelp()` 也在根对象上。

## 纯模块契约（Node 可直接跑）

```js
require("tools/character-editor/spine-core.js");     // SpineCore：parseModel/parseAtlas/evalPose/capabilities
require("tools/character-editor/anim-edit.js");      // SpineAnimEdit
require("tools/character-editor/track-edit.js");     // SpineTrackEdit
require("tools/character-editor/pose-tools.js");     // SpinePoseTools
require("tools/character-editor/ik-aim.js");         // SpineIkAim
require("tools/character-editor/batch-edit.js");     // SpineBatchEdit
require("tools/character-editor/curve-edit.js");     // SpineCurveEdit
```

| 模块 | 关键导出 |
| --- | --- |
| `SpineAnimEdit` | `upsertKey(rawAnim, kind, ownerName, field, values, time)`、`retimeKey(rawAnim, kind, ownerName, field, fromTime, toTime)`、`scanTracks(rawAnim)`、`animDurationOf(rawAnim)` |
| `SpineTrackEdit` | `planKeyEdit(rawAnim, {kind,owner,field,op,time,value,index,delta,model,skin,create})`、`scanExtra(rawAnim, model)`、`deformTargets(model, anim)`、`resolveContainer`、`validateTrack`、`validateKey`、`setDeformVertex`、`deformOffsetLengthFrom*`、`skeletonSignature` |
| `SpinePoseTools` | `mirrorAnimation(anim,{bones/axis/includeEvents})`、`mirrorPose({bones,indices})`、`mirrorTrackKeys(field,keys)`、`createClip/validateClip/applyClip/clipToJSON/clipFromJSON` |
| `SpineIkAim` | `solveTwoBone({parent,child,targetWorld,parentWorld,grandWorld,bendPositive,mix,stretch,softness})`、`solveChainFABRIK`（未实现）、`createBone/reparentBone/renameBone/deleteBone`、`validateSkeleton`、`referencesTo`、`setupWorldOf`、`localMatrix/worldOf/applyMat/invApply/mulMat` |
| `SpineBatchEdit` | `planKeyBatch(anim,{op,selection,delta,atTime,clipboard,collision,lockedRows,skeletonSignature})`、`clipboardFromSelection`、`validateClipboard`、`resolveTrack`、`sameIdentity`、`rowKeyOf`、`scanDuration` |
| `SpineCurveEdit` | `curveValues`、`defaultControlPoints`、`componentCount`、`segmentInfo`、`buildBezierTable`、`bezierValue` |

写入惯例：`planXxx(...)` 都是**纯规划**——返回 `{ok, value:<新对象>, issues:[...]}`，失败时 `value:null` 且**入参零改动**；拿到 `value` 后再落盘。错误码清单见 references。

## 五个最小工作流

### ① 载入副本 → 改一个关键帧 → 保存 → 校验

```js
// Node：先在副本上打键（kind 是 JSON 容器名 "bones"|"slots"，values 是字段对象）
const fs = require("node:fs");
require("tools/character-editor/anim-edit.js");
const AE = globalThis.SpineAnimEdit;
const p = "workspace/tmp/auto/pkg/rig.json";
const raw = JSON.parse(fs.readFileSync(p, "utf8"));
const anim = raw.animations.idle;
const r = AE.upsertKey(anim, "bones", "b1", "rotate", { value: 15 }, 0.5);
// translate 用 {x,y}；shear 用 {x,y}；scale 用 {x,y}；slot 的 attachment 用 {name:"a1"|null}
// ⚠ key 时间不能超过动画当前时长，否则 ANIM_KEY_OVER_DURATION；先确认 animDurationOf 足够长
if (!r.ok) throw new Error(JSON.stringify(r.issues));
fs.writeFileSync(p, JSON.stringify(r.value, null, 2));
```

页面侧核对：`await ed.loadIndex(...)` → `ed.animSelect("idle")` → `ed.setPlayhead(0.5)` → `ed.pose()` 里 `b1` 的 `rotation` 应为 15；再 `await ed.saveToDisk()`。

### ② 批量重定时

```js
const B = globalThis.SpineBatchEdit;
const sel = [{ kind: "bone", owner: "b1", field: "rotate", time: 0.5 }];
const r = B.planKeyBatch(anim, { op: "move", selection: sel, delta: 0.25 });
// r.value 为新动画；r.counts = {moved,added,overwritten,deleted,delta,clampedToZero}
```

### ③ 新增事件关键帧

```js
const T = globalThis.SpineTrackEdit;
const r = T.planKeyEdit(anim, { kind: "event", op: "add", time: 0.8,
  value: { name: "step", int: 1, float: 0.5, volume: 1, balance: 0 }, model });
// 未知事件名会给 EVENT_NAME_UNKNOWN，先核对 model.events / raw.events
```

### ④ 镜像并写入

```js
const P = globalThis.SpinePoseTools;
const m = P.mirrorAnimation(anim, { bones: ["arm_l", "arm_r"] });   // 只镜像选中骨
// m.changed 列出被改的轨道；m.issues 里可能有 MIRROR_INHERIT_LIMITATION / MIRROR_EVENTS_SKIPPED
```

页面侧等价：`ed.mirrorRun("anim")` → `ed.mirrorWrite()`（`mirrorRun` 只产生待写入状态，`mirrorWrite` 提交，`mirrorCancel` 丢弃）。

### ⑤ 校验保存结果（必做）

```sh
node tools/character-editor/selftest-node.mjs                     # 纯逻辑自测：3221/3221
node workspace/tmp/e2e/p2-lead-track-official.mjs                 # 轨道 → 官方 4.2.120 加载 + 姿态对照
node workspace/tmp/e2e/p2-advanced-official.mjs                  # 高级轨道（若存在）
node workspace/tmp/e2e/p2-deform-create-official.mjs             # 从零创建 deform → 官方可加载（10/10）
node workspace/tmp/e2e/runtime-verify.mjs                        # 三包真实数据 runtime 对照
```

原则：**任何写入都要过一次官方 4.2.120 加载**——官方加载成功 + 姿态/顶点对照在阈值内，才算「数据没写坏」。region 形变是唯一例外（官方会抛异常）。

## 验收与证据

```sh
node tools/character-editor/selftest-node.mjs        # 期望 3221/3221 passed
node scripts/bump-editor-version.mjs --check         # semver / ?v= 同源 / version.js 首选加载
```

浏览器侧打开 `tools/character-editor/selftest.html` 看页脚计数（最近一次实测 **3162**，以页面页脚为准）；改动编辑器后 `node scripts/bump-editor-version.mjs <x.y.z>` 会同步 `version.js` 与各页 `?v=` 缓存戳。

证据 JSON 一律写 `workspace/three-view-to-spine-anime/Spine-Animation-Editor-plan/evidence/`；**不要**写真实 rig/assets/references。

## 边界与限制（诚实清单）

- **transform / path 约束未求值**：轨道可编辑、可保存、官方能加载，但本项目预览不算它们的效果（`capabilities.unsupported` 与 `animation.transform.unsupported` 告警）。要判断效果只能靠官方 runtime。
- **region 形变不是官方特性**：`RegionAttachment` 非 `VertexAttachment`，官方 `SkeletonJson` 对 region deform 直接抛异常。`deformTargets()` 的 region 项带 `official:false`，`kind:'region'`；新建形变候选应默认过滤。
- **镜像为数据级局部镜像**：`rotation→-r, shearX→-shx, shearY→-shy, translate.x→-x`，`scale` 与 `curve` 不变；`shearX=0` 时等价于编辑器配方；非 `normal` `inherit` 记 `MIRROR_INHERIT_LIMITATION`，不是等价变换。
- **片段/姿态预设存 localStorage**（键 `dsh.character-editor.clips` 与偏好 `dsh.character-editor.preferences`），换浏览器/清缓存即丢；跨会话传递请用 `clipToJSON`/`clipFromJSON` 落文件。
- **两骨 IK 需骨长 > 0**（`CHILD_LENGTH_ZERO`）；父骨非均匀缩放显式拒绝（`NON_UNIFORM_PARENT`）；N 骨 FABRIK 未实现。
- **删除骨不重映射权重**：含加权网格时 `deleteBone` 直接拒绝（`DELETE_REQUIRES_WEIGHT_REMAP`）；被引用时拒绝并给引用清单。
- **保存只支持回环地址**（`saveToDisk` 走同源 POST），**不支持 .spine 往返**（只认 runtime JSON），DPR≠1 的渲染未实测。
- **`trackRows()` 名字被覆盖**、`version()` 返回对象等易错点见上文核对清单。

## 简单模式：`window.__characterEditor.simple`（0.4.x 已实现）

界面默认是**简单模式**（6 个动作），复杂能力在「高级」。agent 用 `simple.*` 完成简单工作流，**不查按钮文案、不依赖 DOM、不假设 UI 处于哪个模式**。所有方法都走与 UI 相同的命令、gate 与事务，返回统一的

```js
{ ok: boolean, code: string|null, message: string, data: object|null, pending: object|null }
```

`code` 成功时为 `null`；失败时用于机器判断（`message` 是给人看的中文）。

### 13 个方法

| 方法 | 入参 | 成功 `data` / 说明 |
| --- | --- | --- |
| `openPack({indexPath})` | 仓库相对 `index.json` | `{base}`；完整校验成功才返回。失败 `INDEX_REQUIRED` / `OPEN_FAILED` / `CANCELLED`（有未保存改动被取消时保留改动） |
| `selectClip({clipId})` | `status().clip` 的稳定 id | `{clip,duration}`；不存在 → `CLIP_NOT_FOUND`（不猜名字），并暂停在 0s |
| `play({loop?})` | `loop` 布尔可选 | `{playing}`；无动画 `NO_ANIM`；有未记录调整 `UNKEYED`（`pending:{unkeyed:true}`）。**幂等**：重复调用不会反向切换 |
| `pause()` | — | `{playing:false}`；幂等 |
| `seek({time})` | 秒，有限数 | `{time}` **实际落点**（走唯一 `setPlayhead`，暂停）。超出范围按现有规则**夹取**：实测 `9999 → 3.5`（duration）、`-5 → 0`；非数字 → `TIME_INVALID` |
| `selectLayer({layerId})` | `status().layers[].id` | `{layer}`（含 `editable`/`reason`）；不存在 → `LAYER_NOT_FOUND` |
| `dragPose({layerId,dx,dy,space?})` | world 单位位移，`space:"world"\|"local"` | `{layerId,time,keys}`：一次完整位置调整 + 当前动画 translate Key，**一条 Undo**；播放中 `PLAYING` |
| `setKey({layerId?,time?})` | 可选先 seek | `{time}`：仅当前部位的位置 Key，同刻 upsert 不重复 |
| `deleteKey({layerId?,time?,confirmToken?})` | 见下「确认协议」 | 只删该位置 Key；无 Key `NO_KEY`；曲线段 `CURVE_PROTECTED`（直接拒绝，不弹假确认） |
| `save({destination?,confirmToken?})` | `'copy'`（默认）\|`'original'` | 见下「保存语义」 |
| `undo()` / `redo()` | — | `{undo,redo}`（redo 只回 `{undo}`）；无历史时 `ok:false` + `code:"FAILED"`（`data` 仍给 `{undo:0,redo:0}`） |
| `status()` | — | 只读快照（见下） |

### 上下文限制（`NEED_ANIMATE_MODE`）

`dragPose` / `setKey` / `deleteKey` **只在动画上下文可用**：由 `simpleRequireAnimate()` 在取快照**之前**拦截，返回

- 没有包 → `NO_PACK`
- `editMode() !== "animate"` 或没有动画 → **`NEED_ANIMATE_MODE`**（"请先切换到动画模式再调整。"），**零写入**：不碰 `model.bones`、不改 Setup、`dirty`/`undo`/draft 全不变

简单模式内部固定 `Animate + AutoKey=true + target=bone + tool=translate + space=parent`，不暴露开关；这些默认只作用于当前显示与操作，不写回高级偏好、不进 `dirty`。**不要**指望用 `dragPose` 去改 Setup——高级模式请直接用纯模块（`SpineBoneEdit` / `spine-core` 的 edits）。

### 确认协议（`CONFIRM_REQUIRED`）

`deleteKey` 与 `save({destination:'original'})` 需要一次性确认：

```js
const first = S.deleteKey({ layerId: "head", time: 0 });
// → { ok:false, code:"CONFIRM_REQUIRED",
//     data:{ confirmToken:"deleteKey|1|idle|head|0.0000", time:0, layerId:"head" },
//     pending:{ token:"deleteKey|1|idle|head|0.0000", action:"deleteKey", target:"head@0s", docRev:1 } }
const done = S.deleteKey({ layerId: "head", time: 0, confirmToken: first.data.confirmToken });
```

- token 由 `[action, docRev, anim, layerId, time]` 组成（`saveOriginal` 的 action 是 `"saveOriginal"`、`target` 是 `bundle.base`，无 layer/time）。`pending.target` 是便于日志的展示串（实测 `deleteKey` 为 `head@0s`，时间已去掉多余 0），**不要**拿它当 token 或解析回时间——用 `data.time` / `data.layerId`。
- **换包、换动画或文档变动（`docRev` 变）后旧 token 失效**，必须重新取；一次确认不授权换包覆盖。
- 调用方把 `data.confirmToken`（或 `pending.token`）回传即可；**不要**伪造"用户已点确认"，也不要靠 DOM 点按钮绕 gate。
- UI 侧等价操作是页内模态：Enter=主按钮、Esc=取消、关闭后焦点归还。

### 保存语义（0.4.4 起：resolve 即落定）

```js
// 副本：只表示"已发起下载"
const c = await S.save({ destination: "copy" });
// → data:{ destination:"copy", downloadRequested:true, settled:true, dirtyBefore, dirtyAfter, dirty }
//   dirty 保持不变（副本下载不改原包、不算已保存）

// 原包：resolve 时已完全落定（模型重建 + 基线更新 + dirty/undo 归零）
const o = await S.save({ destination: "original", confirmToken: first.data.confirmToken });
// → data:{ destination:"original", target, settled:true, dirty:false, undo:0 }
//   改动落在 animations.<clip>.bones.<layer>.translate，bones.<layer>（Setup）不变
```

- `save` 是 **async**；`destination` 默认 `"copy"`。
- `original` 失败 → `SAVE_FAILED`（`data` 带当前 `dirty`/`undo`，改动保留）；只读包 → `READ_ONLY`；无保存目标 → `NO_SAVE_TARGET`。
- 若某次返回 `settled:false`（理论上不该出现），用 `status()` 的 `pending`/`busy` 轮询到 `busy:false && pending.unkeyed===false` 再继续；**不要**在 `settled:false` 时重复保存。

### `status()` 只读快照

`{apiVersion:1, uiMode:"simple"|"advanced", pack:{base,bones,slots,saved}|null, clip, time, duration, playing, dirty, busy, selectedLayer, layers:[{id,label,slotIndex,editable,reason}], positionKeys:[{time,x,y}], capabilities:{openPack,selectClip,play,seek,selectLayer,dragPose,setKey,deleteKey,saveCopy,saveOriginal,undo,redo}, limitations:[…], pending:{unkeyed,mirror}}`

`layers` 只列出**有可见槽的骨**（`id` 是稳定骨名，不是 label）；`positionKeys` 是当前部位的位置 Key。`status()` 返回的是**深快照**（实测改返回值不影响内部 state），不是活的 `state` 引用。

### 简单模式 6 动作 → simple API 对照

| 界面动作 | agent 调用 |
| --- | --- |
| ① 打开人物包 | `await S.openPack({indexPath})` |
| ② 选动画并播放 | `S.selectClip({clipId})` → `S.play({loop})` / `S.pause()` / `S.seek({time})` |
| ③ 点选并拖动改姿势 | `S.selectLayer({layerId})` → `S.dragPose({layerId,dx,dy})` |
| ④ 添加/删除关键帧 | `S.setKey({time?})` / `S.deleteKey({layerId,time})`（→ `CONFIRM_REQUIRED` → 带 token 重调） |
| ⑤ 撤销/重做 | `S.undo()` / `S.redo()` |
| ⑥ 保存 / 另存副本 | `S.save({destination:'copy'})` / `S.save({destination:'original',confirmToken})` |

### 界面模式与自动化陷阱

- 默认 `simple`；`__characterEditor.setUiMode('simple'|'advanced')`，`__characterEditor.uiMode` 读当前值。**`setUiMode('advanced')` 是 async 且可能弹页内模态**（首次进入），其同步返回值不可靠——要判断是否已切换，读 `status().uiMode`。
- 简单模式下隐藏的高级快捷键（Tab/V/R/S/W、批量、镜像、结构等）**在后台不生效**；高级 API 仍可独立调用（不必切界面）。
- `beforeunload` 在 `dirty` 时会阻止离开：**headless 导航会挂起**。agent 换页/关页前先 `save({destination:'original'})` 或放弃改动，否则导航超时。
- 原生文件选择器不可自动化：用 `openPack({indexPath})` 或 URL `?index=`，不要点「打开文件…」。
- 真实包只读：自动化只在 `workspace/tmp/` 副本上写。

## 注册与可见性

本仓 `index.js` 从 `skills/<name>/SKILL.md` 发现技能；新增技能目录需要**插件重载（或重启会话）**后才会出现在技能目录里。若本会话看不到 `character-editor` 技能，先重载插件再试。

## 排错

| 现象 | 处理 |
| --- | --- |
| 打开页面白屏 / `?index=` 无效 | 确认 cwd 是仓库根、路径是仓库相对路径、`serve.py` 端口未被占用（`--strict-port` 会直接退出）。 |
| `saveToDisk()` 报错 | 只在 `127.0.0.1/localhost` 且静态根下可用；远程/非回环只读。 |
| 改了 JSON 但页面没变 | `index.html` 有 `?v=` 缓存戳；硬刷新或跑 `bump-editor-version.mjs <x.y.z>`。 |
| `planKeyEdit` 返回 `TRACK_NOT_FOUND` | 轨道不存在；deform 需 `create:true` 且能推出偏移长度（`DEFORM_LENGTH_UNKNOWN`）。 |
| 校验报 `ANIM_BONE_ORPHAN` | 动画里有不存在的骨轨（多半是删/改名后遗留），保存会被官方丢弃；用 `renameBone` 迁移或手工清理。 |
| 官方加载抛异常 | 先看是不是 region 形变；再看 `validateSkeleton` 的 error 级 issue（槽/约束引用缺失）。 |
| 中文/路径问题 | 一律用仓库相对路径与 UTF-8；Windows 下 `python` 不要写 `python3`。 |
