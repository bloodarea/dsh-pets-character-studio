# character-editor 自动化接口参考

本文是 [../SKILL.md](../SKILL.md) 的细则。句柄签名于 **v0.4.4**（`tools/character-editor/version.js`：`version:"0.4.4"`、`schemaVersion:1`、`apiVersion:1`、`builtAt:"2026-11-08T11:14:09.415Z"`）**逐条读 `app.js` 的 `window.__characterEditor` 定义核对**，不是凭记忆。

> `window.__characterEditor` 不是公开 API：版本升级可能改签名。自动化脚本启动时先 `ed.version()` 记录版本，按版本判断兼容性。

## 1. 页面句柄（`window.__characterEditor`）

### 版本与状态

| 句柄 | 签名 | 返回 |
| --- | --- | --- |
| `version()` | — | `{version, schemaVersion, apiVersion, builtAt}`（**对象**，0.4.4 / 1 / 1） |
| `state` | 属性 | 内部 state（只读用途；不要直接改） |
| `core` | 属性 | coreInfo（渲染后端信息） |
| `frame()` | — | 当前帧对象（含 `pose`/`geo`） |
| `renderer()` | — | `"core" \| "none"` |
| `probeCapabilities()` | — | 能力探测（core 支持项与告警） |
| `edit()` | — | 编辑态快照：`{mode,target,tool,space,autoKey,selBone,selAttachment,transient,timelineOpen,timelineHeight,undoDepth,redoDepth,dirty}` |
| `tool()` / `spaceName()` | — | 当前工具 / 坐标系 |
| `modelSignature()` | — | 骨架签名（片段/剪贴板跨骨架校验用） |
| `geomHash()` | — | 几何哈希（渲染结果快速比对） |

### 载入与保存（async）

| 句柄 | 签名 | 说明 |
| --- | --- | --- |
| `loadIndex(path)` | `async (indexPath)` | 载入 `index.json`（内部 `loadIndexByPath`）；路径为仓库相对路径 |
| `loadRig(rig)` | `(rigDict)` | 直接载入 rig 字典 |
| `loadExample()` / `loadFixture()` | — | 内置示例 / 测试夹具 |
| `saveToDisk()` | `async ()` | 保存到服务端静态文件；**仅回环地址** |
| `saveAsZip()` | `async ()` | 导出 zip |
| `patchedModel()` | — | 当前已打补丁的模型 JSON |
| `bundle()` | — | 当前 bundle 状态 |
| `loadRigMeta()` | — | rig 元信息 |

### 选择与模式

| 句柄 | 签名 | 返回 |
| --- | --- | --- |
| `selectBone(indexOrName)` | number \| string \| null | 选中骨名（`state.edit.selBone`） |
| `setMode(m)` | `"animate" \| "setup"` 等 | 设置编辑模式 |
| `setTool(t)` | 工具名 | 设置工具（`tool()` 读回） |
| `setTarget(t)` | `"bone" \| …` | 设置编辑目标 |
| `setSpace(s)` | `"world" \| "local"` 等 | 坐标系 |
| `setAutoKey(v)` | boolean | AutoKey 开关（`edit().autoKey` 读回） |
| `keySelected(fields)` | `fields?: string[]` | 对**当前选中骨**按当前局部值在播放头打键；**不打键不改值** |
| `spaceGate(name, tool)` | | 空间/工具是否允许该操作 |
| `hitTest(x, y)` | 屏幕坐标 | 命中的槽/骨信息 |
| `setBoneField(field, value)` | `"x" \| "y" \| "rotation" \| "scaleX" \| "scaleY"` | 写选中骨的局部值 → `{ok,field,value,bone,undo}`；字段名不合法返回 `{ok:false,reason:"FIELD_INVALID"}`。**0.9.49 起这是右栏「常用属性」区四个输入框的唯一等价入口**（该区已从界面移除），内部走 `applyBoneNumber`：自带 World/Local 换算、缩放下限夹取、Setup 写基础值 / Animate 写未打键预览、每次一条撤销 |
| `boneField(field)` | 同上 | 只读回显选中骨在该字段上的当前值（与输入框同源） |

### 自由变换（U06；0.9.49 起界面按钮已移除）

| 句柄 | 签名 | 返回 |
| --- | --- | --- |
| `ftState()` | — | `{on,bone,box,drag,buttonRemoved:true,buttonPressed:null,entryPoints:["Shift+T","__characterEditor.ftToggle()"]}` |
| `ftBox(boneName)` / `ftHitAt(x,y)` | | 包围框 / 命中测试（只读） |
| `ftEnter()` | — | `{ok,on,bone,reason}`；拒绝原因：未载入 / 未选骨 / 该骨不可编辑 / 播放中 |
| `ftCommit()` | — | `{ok,changed,on,undo,dirty}`；**没有活动会话时返回 `{ok:false,reason:"FT_NOT_ACTIVE"}`**，与「有会话但零改动」（`ok:true, changed:false`）是两件事 |
| `ftCancel(msg?)` | string? | 回到进入前的快照 → `{ok,on,undo,dirty}` |
| `ftToggle()` | — | 进/出一次 → `{ok,on,bone,action:"enter"\|"commit",changed}` |

> 界面上的「自由变换」按钮与 `#ftHint` 已按用户要求删除；能力入口只剩 `Shift+T` 与本表这四个接口。画布交互（框内拖动 / 角点缩放 / 圆柄旋转 / Enter 提交 / Esc 取消）不受影响。

### 骨架现状与该包的骨（0.9.56）

当前包 **43 根骨**、**4 条两骨 IK**。新增的骨都有明确用途：

| 骨 | 父 | 用途 |
| --- | --- | --- |
| `ik-hand-L` / `ik-hand-R` / `ik-foot-L` / `ik-foot-R` | `hips` | 4 条 IK 的 target（挂在 hips 下便于整体坐标对齐） |
| `ahoge-2` / `ahoge-3` | `ahoge` / `ahoge-2` | 呆毛分段：一根骨管 222×213 的网格弯不动，补成 3 段链 |

**呆毛链**：`ahoge` → `ahoge-2` → `ahoge-3`，各段独立可控（实测单根转 15° 时呆毛位移分别 60.7 / 45.1 / 21.5，且互不牵连）。

**尾巴**：`tail-1` → `tail-2` → `tail-3` 沿鲸尾中轴，但**只有 `tail-1` 有贴图**（`鲸鱼尾巴` 槽绑它），`tail-2`/`tail-3` 是加权网格的驱动骨。

#### 改这些骨时的硬约束：必须重算加权网格顶点

`呆毛` 与 `鲸鱼尾巴` 都是 **weighted mesh**，顶点坐标存在**骨局部空间**。直接改骨坐标会让材质跟着变形。

正确做法（两次都靠这个做到外观零变化）：

```js
// 1. 记录当前顶点的世界位置
//    世界位置 = Σ wᵢ · (Wᵢ · localᵢ)，且 Σ wᵢ = 1
// 2. 改骨
// 3. 用**新**骨世界矩阵反解：localᵢ' = inv(Wᵢ') · worldPtᵢ
```

**精度**：顶点局部坐标至少保留 **6 位小数** —— 4 位时会有 6.4e-5 的位移（视觉无差异，但会累积）。

**级联效应**：改父骨会带走子骨的世界位置。若只想修某一根，子骨要单独反解复位。例：`tail-2` 挪 21 单位后 `tail-3` 世界位置偏了 20 单位，需反解 `tail-3` 让它回到原位。

#### 根骨不要挪到"材质正中"

用「该处自身边距 / 局部最大内切半径」判定骨是否在中轴，但**根骨例外**：`ahoge` 是发根、`tail-1` 挂在 `hips` 上，把它们挪到几何中心会拉断骨链（`tail-1` 的算法建议是 Δ=(93,−12)，采纳后尾巴会甩出身体）。

判定用的边界必须是**真边界**：只统计**只被一个三角形使用的边**。如果把网格内部的细分线也算进去，算出的"最大内切半径"只有真值的 1/6（呆毛 18.64 vs 真值 105），会得出完全错误的位移建议。

#### 骨要放在「贴图可见像素的中轴」，不是「网格矩形中心」

这两个附件都是**矩形四边形网格 + 整张贴图铺满**（UV 从 0 铺到 1），所以网格几何中心 = 贴图矩形中心。但贴图里画的图形（呆毛的拱、尾鳍的扇）只占其中一部分且是弯的 —— 按矩形中心放骨必然偏上/方向反。这是 0.9.57 被用户指出「尾巴偏上、呆毛方向反」的根因。

做法（`workspace/tmp/` 里有全套脚本）：

1. **解码 model.png 的 alpha**（2048×2048 RGBA，PNG 需手工解 IHDR/IDAT + 反滤波）
2. **在网格参数空间采样**：双线性插值出世界坐标与 UV → 用 UV 查 atlas region 内的像素
3. **按颜色分离目标图形**：`呆毛` region 里还画着背后的花发带（占 87% 像素），判据 `alpha>60 && (b−r)>70` 才能分出呆毛本体（高饱和蓝紫 vs 低饱和灰白）
4. **栅格化 + 倒角距离变换 + Dijkstra**（代价 `1/(厚度+0.6)`）求最厚路径 = 中轴
5. **按弧长取 k 个锚点**，每根骨设 `x/y` + **`rotation`（指向下一根）** + **`length`（到下一根的距离）**

> **只设 x/y 不够**：`rotation` 全为 0 时每根骨都朝正右方，连起来是折线不是弧线。这也是「方向反了」的成因。局部 rotation 要归一到 `(-180, 180]`。

当前包的实测值：

| 骨 | 世界位置 | 世界朝向 | 局部 rot | length |
| --- | --- | --- | --- | --- |
| `ahoge` | (-4.9, 1013) | 116.6° | 116.565 | 96.151 |
| `ahoge-2` | (-47.9, 1099) | -163.5° | 79.919 | 102.201 |
| `ahoge-3` | (-145.9, 1070) | -163.5° | 0 | 30 |
| `tail-1` | (105.8, 218.5) | -34.7° | -34.673 | 150.29 |
| `tail-2` | (229.4, 133.0) | -7.3° | 27.401 | 150.107 |
| `tail-3` | (378.3, 114.0) | -7.3° | 0 | 30 |

**权重要按「到骨线段距离」分配**，不是「到骨原点距离」—— 后者在拱形中段会让相邻顶点权重突变，转动时三角形翻转（撕裂）。取最近 3 段、`1/(d+8)²` 衰减可消除（实测翻转从 2 个降到 0）。

**位置自检判据**（不靠肉眼）：三根骨到「目标图形最近可见像素」的距离应 < 1 单位、且在可见包围盒内。

### IK 约束与该包的 4 条链（0.9.54）

包里现在有 **4 条两骨 IK**，手臂与腿各一对。它们的 target 摆在「FK 数学末端」上，所以 `mix=1` 时骨不跳。

| 约束 | 链（父·子） | target 骨 | 子骨 length |
| --- | --- | --- | --- |
| `ik-arm-L` | `upper-arm-L` → `forearm-L` | `ik-hand-L` | 87.321 |
| `ik-arm-R` | `upper-arm-R` → `forearm-R` | `ik-hand-R` | 90.824 |
| `ik-leg-L` | `thigh-L` → `shin-L` | `ik-foot-L` | 70.257 |
| `ik-leg-R` | `thigh-R` → `shin-R` | `ik-foot-R` | 70.257 |

**为什么链是「上臂→前臂」而不是「前臂→手」**：这个包的手臂贴图挂在 `upper-arm` 上（`hand` 没有槽）。用 `[forearm, hand]` 只会转骨头，贴图不动。

**骨长为什么必须有**：`ikSolve` 里 `L2 = childBone.length * scale`，为 0 时直接 `ik.zeroLength` 保留 FK —— 没有 length 就没有 IK。

**写 IK 时容易踩的三个格式点**（都踩过）：
1. JSON 里 IK 段的键是 **`"ik"`**，不是 `"constraints"`（后者是编辑器内部对象名）
2. `bones` 与 `target` 都是**骨名字符串**，不是索引
3. 两骨约束要求 `bones[1].parent === bones[0]`（直接父子），否则 `ik.bones.notParentChild`

**改这个包的 IK 要改 handoff 源**：`step2/handoffs/rig/model.json`。`compile_pack.py` 会把它原样复制到 `workspace/packs/…/spine/model.json`；直接改产物下次编译会被覆盖。

| 句柄 | 返回 |
| --- | --- |
| `ik()` | `{on,mix,tool,chain,lastReason,drag}` |
| `ikChain(name)` | `{ok,parentName,childName,targetName,constraintName,hasTarget,message}`；失败 reason：`NO_SELECTION` / `NO_PARENT` / `CHILD_LENGTH_ZERO` |
| `setIkMode(on)` / `setIkMix(v)` | 开关 / 混合；`mix=0` 时不参与求值，等于未绑定 |

**验证 IK 是否真生效的判据**（不要只看 `ikConstraints > 0`）：

```js
// 直接用 core.evalPose 求值（render() 只重绘，不重算 pose）
const pose = SpineCore.evalPose(model, { animation: null, time: 0, skin: "default" });
// 末端 = 子骨原点 + length 沿子骨世界 +X
// 拖 target 前后，末端到 target 的距离应恒为 0，且 applied[子骨].rotation 变化
```

### 拖拽模式 / 工具栏工具（0.9.52 起拖拽是开关）

**先分清两套「工具」概念**，它们的名字撞了：

| 概念 | 状态字段 | 取值 | 设置入口 |
| --- | --- | --- | --- |
| **编辑工具**（怎么改数据） | `state.edit.tool` | `translate` / `rotate` / `scale` / `pose` | `setTool(t)` / `tool()` |
| **工具栏工具**（左键干什么） | `state.tool` | `move` / `select` / `pan` | 工具栏按钮、`H` 键、`togglePan()` |

> ⚠ `__characterEditor.setTool(t)` **走的是 `setEditTool`**（编辑工具那套），不是工具栏的拖拽/选择。想切拖拽请用下面的 `togglePan()` / `setPan()`。

| 句柄 | 签名 | 返回 |
| --- | --- | --- |
| `panMode()` | — | `{active,returnTo,currentTool,canDragCanvas,hint}`。`active` 为拖拽模式开关状态；**非拖拽态 `returnTo` 为 `null`**（不是默认 `"move"`）；`canDragCanvas` 直接表示「画布左键拖动=移动视野」 |
| `togglePan()` | — | 切一次 → `{active,changed,tool,returnTo}`；**会回到进入前的工具**（`move` 或 `select`），不会固定回移动 |
| `setPan(on)` | boolean | 幂等：想进就进、想出就出；重复调用 `changed:false` |

**行为语义**：进入拖拽后，画布 `pointerdown` 走 `beginPan`（`e.preventDefault()`，`state.drag.mode === "pan"`），左键拖动只移动视野、不命中部件；退出后恢复命中部件。

**三种拖视野方式**：
1. 点工具栏「拖拽」按钮 —— 常驻，再点一次退出
2. 按住 `Space` —— 临时，松手即恢复
3. 按住鼠标中键 —— 同上

### 槽位 / 层操作 / 诊断（0.9.50 起是唯一入口）

0.9.50 把右栏整块「属性与选中部件检查器」（含附件/骨骼/选中部件三个检查器 + 骨架结构）与「调试」面板从界面移除。下表原本都是界面按钮，现在只在接口里。

| 句柄 | 签名 | 返回 |
| --- | --- | --- |
| `selectSlot(indexOrName)` | number \| string \| null | `{ok,index,name,bone}`；`null` 清除选中。**`selectBone` 只能选骨，槽是另一条线** |
| `slotSelection()` | — | 当前选中槽 `{index,name,bone,attachment,hidden,locked}` 或 `null` |
| `slotVisible(i)` / `slotLock(i)` | number \| string | 翻转显示/锁定 → `{ok,index,name,hidden}` / `{ok,index,name,locked}` |
| `layerMove(action)` | `"up"\|"down"\|"top"\|"bottom"` | `{ok,action,from,to,name,undo,dirty}`；`DRAW_ORDER_LOCKED` 时拒绝。**置顶/置底原本没有任何界面以外入口** |
| `slotRestore(i)` | number \| string? | 把该槽恢复到最近保存状态 → `{ok,index,name,undo,dirty}` |
| `attachmentRestore()` | — | 丢弃当前附件的补丁 → `{ok,attachment,undo}`；无补丁时 `{ok:false,reason:"NO_PATCH"}` |
| `slotField(field,value)` | `"x"\|"y"\|"rotation"\|"scaleX"\|"scaleY"` | 写槽位变换。**与 `setBoneField` 是两条线**：槽位走 `dragBlockReason` 并直接写 `state.bones[slot.boneName]`，骨骼走 `boneEditBlockReason` 且含 World/Local 换算 |
| `diagnostics()` | — | `{loaded,bones:{total,ikConstraints,ikNames,ikTargets,restricted},meshes:[{slotIndex,attachmentId,vertexCount,triangles,weighted,hullCount}],unsupportedCount,issues:[{severity,code,path,message}]}` —— 原「调试」面板的全部内容 |

#### `slotField` 的拒绝原因（都带 `reason`，不是裸 `false`）

| reason | 含义 |
| --- | --- |
| `FIELD_INVALID` | 字段名不在白名单 |
| `NO_SLOT_SELECTED` | 没有选中槽 |
| `ANIMATION_LOCKED` | **已选中动画时槽位的旋转/缩放只读**。注意这与 setup/animate 模式无关 —— 原界面的锁是 `transformLocked = !!state.anim \|\| locked`，切到绑定姿态**也改不了**。X/Y 不受此限 |
| `SLOT_LOCKED` | 该部件被锁定 |
| `BLOCKED: <原因>` | 来自 `dragBlockReason`（含具体说明） |
| `VALUE_NOT_FINITE` / `NO_CHANGE` / `SLOT_BONE_MISSING` | 值非法 / 与现况相同 / 槽的绑定骨缺失 |

> **实测坑（写脚本时踩过）**：`setBoneField` 与 `slotField` 名字像一个家族，但守卫和写入目标完全不同。想改「某个部件」的位置时如果 `editTarget()` 是 `bone`，用 `slotField` 不会写错骨 —— 它内部走的是独立通道 `applySlotNumber`/`applySlotField`，**不按 `editTarget` 分流**（这正是 0.9.50 修掉的 bug，见 CHANGELOG）。

### 姿态与几何（只读）

`pose()` → `{time, anim, local[], world[]}`；`boneValues(name)` → `{x,y,rotation,scaleX,scaleY}`；`boneScreen(name)`；`localFull(name)`；`realParentWorld(name)`；`boneSetupWorld(name)`（纯 FK 矩阵）；`inheritOf(name)`；`worldSnapshot()` → 每骨 `{name,index,tx,ty,a,b,c,d,x,y}`；`attachmentSnapshot()`；`poseTip(name)` → `{x,y,length,usedLengthSource,dirX,dirY,degenerate}`。

### 动画与时间轴

| 句柄 | 签名 | 说明 |
| --- | --- | --- |
| `animEdit()` | — | `{sel,dirty,draftNames,duration,appliedDurations}` |
| `animSelect(name)` | string | 选中动画 |
| `animSetDuration(v)` | number | 按比例缩放动画时长（写草案） |
| `animAddBoneKey(bone, field)` | | 给骨加键（当前值/播放头） |
| `animAddSlotKey(slot, att)` | | 给槽附件加键 |
| `animRemoveKey(kind, owner, field, time)` | | 删键 |
| `animResetOne()` / `animResetAll()` | — | 回滚草案 |
| `animDurationOf(name)` | string? | 动画时长 |
| `setPlayhead(sec)` | number | 播放头 |
| `setPreviewRange(from, to)` / `clearPreviewRange()` | number | 预览循环区间 |
| `timelineOpen(open)` / `timelineHeight(h)` | | 时间轴展开/高度 |
| `timeline()` | — | `{open,height,pxPerSec,scrollSec,snapFrames,selectedKey,keyCount,maxTime,unsupported,rows:[{rowKey,kind,owner,field,label,keyCount,keyTimes,unsupported}],playRange:{from,to,custom}}` |
| `selectKeyByTime(owner, field, time)` | | 选中指定时间的键（成功 `true`） |
| `deleteSelectedKey()` | — | 删除选中键 |

### 轨道（含 P2 额外轨道）

| 句柄 | 签名 | 说明 |
| --- | --- | --- |
| `tracks()` | — | 轨道快照（`trackSnapshot()`：`{rows,total,unsupported,…}`） |
| `trackRows()` | — | ⚠ 同一对象里定义了两次，**被后面的定义覆盖** → 实际返回 `trackSnapshot().rows` |
| `trackSelect(rowKey)` | string | 选中轨道行（额外轨行走 `selectExtraRow`；槽附件行走选中键路径） |
| `trackEdit({rowKey,op,time,index,delta,value})` | | 走与 UI 同一写入函数；返回 `{ok,code,rowKey,snapshot}` |
| `trackSetVertex({rowKey,index,x,y})` | | 改形变顶点 |
| `trackAddAtPlayhead()` / `trackDeleteAtPlayhead()` | — | 面板表单在播放头加/删键 |
| `trackPanel()` | — | 额外轨道面板状态 |
| `newDeformCandidates()` | — | `{official:[…],hidden:[…]}`，每项 `{target,kind,weighted,vertexCount,offsetLength,official,moduleKind,moduleOfficial,label}`；region 落 `hidden` |
| `newDeformKey()` | — | 在播放头新建形变键 → `{ok,code,rows}` |
| `lastNewDeform()` | — | 上次新建的形变轨信息 |
| `trackFilter({search,onlyKeyed})` | | 过滤 → `{visibleRows,totalRows,emptyAdded,search,onlyKeyed,locked,hidden}` |
| `trackSearch(q)` | string | 搜索 → 可见非组行数 |
| `trackLock(rowKey, on)` / `trackHide(rowKey, on)` | | 锁定/隐藏 → 列表 |
| `trackGroups()` / `trackCollapse(gid, open)` | | 分组行 |
| `trackEventNow()` | — | 播放头时刻的事件 |
| `dsRows()` | — | 时间轴行（`kind,owner,field,groupId,collapseKey,open,keyCount,unsupported,previewPartial,index`） |
| `dsStat()` | — | `{text,title,unsupported}`（Key 统计条） |
| `dsPoint(rowKey, time)` | | 行内时间→像素坐标 |

### 选择集 / 批量 / 剪贴板

`selection()` → `{items,primary,count}`；`selectKeyItem(item, additive)`；`selectAll()`；`clearSelection()`；`batchMove(delta)`；`batchDelete()`；`copyKeys()` → `{items,sourceAnimation,originTime}`；`pasteKeys(atTime)`；`clipboard()`。

### 镜像 / 片段 / 姿态预设

| 句柄 | 签名 | 说明 |
| --- | --- | --- |
| `mirror()` | — | `{mode,autoKey,limitation,last,pending:{animation,changed,changedBones},transient}` |
| `mirrorRun(scope)` | `"anim" \| "bone"`（默认 `"bone"`） | 生成待写入镜像；**不落盘** |
| `mirrorPose()` | — | 镜像当前 Setup 姿态 |
| `mirrorWrite()` / `mirrorCancel()` | — | 提交 / 丢弃待写入镜像 |
| `clips()` | — | `{version,error,collision,signature,clips:[…],poses:[…],persisted}` |
| `clipSave(name)` / `clipInsert(id)` / `clipRename(id,name)` / `clipDelete(id)` / `clipCollision(mode)` | | 片段库（localStorage）。**0.9.49 起界面上已无「片段库」面板，这五个句柄是唯一入口** |
| `poseSave(name)` / `poseApply(id, mirrored)` / `poseDelete(id)` | | 姿态预设（localStorage）。同上，界面已移除 |

> 数据仍存在 `localStorage["dsh.character-editor.clips"]`（版本化、损坏回退），不写入人物包；跨骨架签名不一致时 `clipInsert` / `poseApply` 会拒绝。删掉的只是面板 DOM 与 `renderClips()` 的渲染目标，`saveClipStore` / `applyClip` / `mirrorPose` 等底层链路未动。

### 两骨 IK / 骨架结构

| 句柄 | 签名 | 说明 |
| --- | --- | --- |
| `ik()` | — | `{on,mix,tool,chain:{parent,child,target,constraint,message},lastReason,drag}` |
| `setIkMode(on)` / `setIkMix(v)` | | 开关 / 混合 |
| `ikChain(name)` | string? | 该骨所属 IK 链信息 |
| `skeleton()` | — | `{mode,bones,rawBones,slots,selected,refs,validate:{ok,issues},last,skelRev,undo}` |
| `skelCreate(payload)` | 同 UI 新建表单 | → `{ok,code,bones,undo}` |
| `skelReparent(boneName, newParent, keepWorld)` | | → `{ok,code,keptWorld,undo}` |
| `skelRename(boneName, to)` | | → `{ok,code,undo}`（会迁移动画轨） |
| `skelDelete(boneName)` | | → `{ok,code,refs,undo}` |
| `skelValidate()` | — | → `{ok,issues:[{code,path,message}]}` |

### 轴心补偿 / 洋葱皮 / 轨迹

`pivot()` → `{on,effective,mode,target,disabledReason,last}`；`setPivotCompensate(on)`；`lastPivot()`；`pivotPreview(boneName, delta, mode)`（**纯计算不写文档**）；`onionState()`；`setOnion(patch)`；`trailState()`；`setTrail(on)`。

### 偏好 / 快捷键

`prefs()` → `{prefs,error,key:"dsh.character-editor.preferences",storage}`；`savePrefsNow()`；`shortcuts()` → `{map,ok,conflicts,issues}`；`rebindShortcut(action, chord)`；`resetShortcuts()`；`resolveKey(eventLike)`。

### 语音 / 表情 / 槽组（次要）

`voice()`（只读快照）、`loadVoice(arg)`、`openVoice`、`closeVoice`、`playVoiceLine(eventName, id)`、`stopVoice`；`expr()`、`exprApplySet(name)`、`exprApplyAttachment(slotKey, attName)`、`exprApplyBlinkLevel(side, level)`、`exprReset()`；`slotGroups()`、`slotGroupToggle(gid)`、`slotGroupToggleHidden(gid)`、`slotListRefresh()`、`slotSetSearch(q)`、`slotRowIndices()`、`slotCanDrop(from, to, after)`。

### 简单模式（0.4.x 已实现；完整说明见 SKILL.md「简单模式」）

根对象上另有四个简单模式相关句柄：

| 句柄 | 签名 | 返回 |
| --- | --- | --- |
| `simple` | 属性 | 13 个方法的对象：`openPack/selectClip/play/pause/seek/selectLayer/dragPose/setKey/deleteKey/save/undo/redo/status` |
| `simpleUi()` | — | `{uiMode,onboardingSeen,advancedSeen,simpleKeysExpanded,lastPackIndexPath,visible:{simpleTop,menubar,viewbar,edittools,dopesheet,clipSection,clipSectionRemoved,clipsCapability,debug}}`（`visible` 是 DOM 探测，**仅供诊断**）。0.9.49 起 `clipSection` 恒为 `false` 且伴随 `clipSectionRemoved:true` —— 表示**这块界面已经不存在**，不是「折叠起来了、展开就能用」；`clipsCapability` 则说明接口仍在 |
| `setUiMode(mode)` | `'simple'\|'advanced'` | 同步读到的当前模式字符串；**`advanced` 分支是 async 且可能弹页内模态，不要用返回值判断已切换**（用 `simple.status().uiMode`） |
| `simpleGuide(show)` / `simpleHelp(show)` | boolean | 首次引导 / 帮助浮层 |

```js
simple.openPack({indexPath})        // async；→ {ok,code,message,data:{base},pending}
simple.selectClip({clipId})         // → data:{clip,duration}
simple.play({loop}) / simple.pause()// 幂等
simple.seek({time})                 // → data:{time}
simple.selectLayer({layerId})       // → data:{layer:{id,label,slotIndex,editable,reason}}
simple.dragPose({layerId,dx,dy,space})  // 仅 animate；否则 NEED_ANIMATE_MODE 零写入
simple.setKey({layerId,time})       // 仅 animate；同刻 upsert
simple.deleteKey({layerId,time,confirmToken})  // 仅 animate；无 token → CONFIRM_REQUIRED
simple.save({destination:'copy'|'original',confirmToken})  // async
simple.undo() / simple.redo()
simple.status()                     // 只读快照，见 SKILL.md
```

**错误码（简单模式）**：`NO_PACK`、`INDEX_REQUIRED`、`OPEN_FAILED`、`CANCELLED`、`CLIP_NOT_FOUND`、`NO_ANIM`、`UNKEYED`、`TIME_INVALID`、`LAYER_NOT_FOUND`、`NO_LAYER`、`PLAYING`、`NEED_ANIMATE_MODE`、`NO_KEY`、`CURVE_PROTECTED`、`DELETE_FAILED`、`LIB_MISSING`、`DRAG_FAILED`、`CONFIRM_REQUIRED`、`NO_SAVE_TARGET`、`READ_ONLY`、`SAVE_FAILED`、`FAILED`。

**保存 `data` 形态（0.4.4）**：`copy` → `{destination:"copy",downloadRequested:true,settled:true,dirtyBefore,dirtyAfter,dirty}`（不清 dirty）；`original` → `{destination:"original",target,settled:true,dirty:false,undo:0}`（resolve 即落定）。

**确认 token**：`[action, docRev, anim, layerId, time]`；`deleteKey` 的 `pending.target` 形如 `head@0s`（展示串，时间已去多余 0，别解析回时间）、`saveOriginal` 的 `target` 是 `bundle.base`。换包/文档变动即失效。

**实测补充（0.4.4）**：`seek` 超范围会夹取（`9999→duration`、`-5→0`）；`undo/redo` 无历史时 `ok:false, code:"FAILED"` 且 `data:{undo:0,redo:0}`；`status()` 是深快照，改返回值不影响内部；`save` 两条路径都是 **async**（返回 Promise）。

## 2. 纯模块契约

Node 用法（无 DOM）：

```js
require("tools/character-editor/spine-core.js");
require("tools/character-editor/anim-edit.js");
// …各自挂到 globalThis.SpineCore / SpineAnimEdit / …
```

### `SpineAnimEdit`

```js
upsertKey(rawAnim, kind, ownerName, field, values, time)
// kind: "bones" | "slots"（JSON 容器名，不是单数）；field 如 rotate/translate/scale/shear/attachment
// values: 字段对象，如 {value:15} / {x:5,y:0} / {name:"a1"|null}；数值按 round(v,6)
// → {ok, value, replaced, issues}
retimeKey(rawAnim, kind, ownerName, field, fromTime, toTime)   // 目标时间与已有 key 冲突则拒绝
removeKey(rawAnim, kind, ownerName, field, time)                // 空轨道保留空数组
scanTracks(rawAnim)        // → 行模型
animDurationOf(rawAnim)    // → 秒
```

### `SpineTrackEdit`

```js
planKeyEdit(rawAnim, {
  kind: "event"|"drawOrder"|"deform"|"ik"|"transform"|"path",
  owner?, field?, op: "add"|"set"|"delete"|"move",
  time?, index?, delta?, value?, model?, skin?, create?, pruneEmpty?
}) // → {ok, value, changedPath, keyCount, index?, overwritten?, mergedAnimationKeys?, issues}
scanExtra(rawAnim, model)  // → {rows, unsupported, issues}；ik/transform 每约束一行，path 三行
deformTargets(model, anim) // → [{slotName,attachmentName,slotIndex,kind:'region'|'mesh'|'weightedmesh',official,vertexCount,weighted,offsetLength,hasDeform}]
```

- `ik`/`transform` 是**合并 key 数组**（一个 key 同时含全部字段）；`path` 是 `{position,spacing,mix}` 三子轨，`position/spacing` 用 `value`。
- `deform` 支持 `create:true` 从零建链（`attachments.<skin>.<slot>.<att>.deform`），skin 优先级 `opts.skin > 唯一 skin > 'default'`。

### `SpinePoseTools`

```js
mirrorAnimation(rawAnim, {model?, bones?: Array<number|string>, axis?: "x", includeEvents?: false})
  // → {ok, value, changed:[…], issues}
mirrorPose({bones, indices?})            // → {ok, value, issues}
mirrorTrackKeys(field, keys)             // → {ok, value}
createClip(anim, selection, {model?, sourceAnimation?, name?, skeletonSignature?, createdAt?})
validateClip(clip) / applyClip(anim, clip, {atTime, collision?, lockedRows?, model?, skeletonSignature?})
clipToJSON(clip) / clipFromJSON(text)
```

### `SpineIkAim`

```js
solveTwoBone({parent, child, targetWorld:{x,y}, parentWorld, grandWorld, bendPositive?, mix?, stretch?, softness?})
  // → {ok, rotations:[p,c], deltaDeg, tipWorld, outOfReach, stretchScale, chainLengths, issues}
solveChainFABRIK(...)   // → {ok:false, reason:"NOT_IMPLEMENTED"}
createBone(rawModel, {name, parent?, x?, y?, rotation?, length?, inherit?})
reparentBone(rawModel, {boneName, newParent, keepWorld?})
renameBone(rawModel, {from, to})   // 会迁移动画轨（合并时给 MERGED_ANIMATION_TRACK）
deleteBone(rawModel, {name})       // 被引用/含加权网格时拒绝
validateSkeleton(rawModel)         // → {ok, issues, warningCount}
referencesTo(rawModel, boneName) / hasWeightedVertices(rawModel) / setupWorldOf(rawModel, boneName, issues?)
localMatrix(bone) / worldOf(world, bone) / applyMat(m,x,y) / invApply(m,x,y) / mulMat(p,l)
```

矩阵约定：`x' = a·x + c·y + tx`、`y' = b·x + d·y + ty`（与 `spine-core` 的 `pose.world` 一致；官方 `x' = a·x + b·y + worldX`，映射 `our.a=official.a`、`our.b=official.c`、`our.c=official.b`、`our.d=official.d`）。

### `SpineBatchEdit`

```js
planKeyBatch(rawAnim, {op:"move"|"paste"|"delete", selection?, delta?, atTime?, clipboard?, collision?, lockedRows?, skeletonSignature?})
  // → {ok, value, counts:{moved,added,overwritten,deleted,delta,clampedToZero}, selectionAfter, issues}
clipboardFromSelection(rawAnim, selection, {sourceAnimation?, skeletonSignature?})
validateClipboard(clipboard, {skeletonSignature?})
resolveTrack(rawAnim, item) / sameIdentity(a,b) / rowKeyOf(row) / scanDuration(rawAnim)
```

### `SpineCurveEdit`

`curveValues` / `defaultControlPoints` / `componentCount` / `segmentInfo` / `buildBezierTable` / `bezierValue`：贝塞尔分段与插值（含官方 18 点表的 `f32` 校验错误码 `POINTS_NOT_F32`、`CONTROL_POINTS_NOT_F32`、`KEY_VALUE_NOT_F32`）。

## 3. 错误码清单（自动化判断依据）

**轨道/键（SpineTrackEdit）**：`TRACK_NOT_FOUND`、`TRACK_CONTAINER_INVALID`、`TRACK_FIELD_UNKNOWN`、`TRACK_FIELD_NUMBER`、`TRACK_FIELD_BOOL`、`TRACK_FIELD_RANGE`、`TRACK_UNKNOWN_FIELD`（仅告警，`ok` 仍为 true）、`KEY_INVALID`、`KEY_TIME`、`KEY_TIME_NEGATIVE`、`KEY_OUT_OF_ORDER`、`KEY_DUPLICATE_TIME`、`INDEX_OUT_OF_RANGE`、`KEY_NOT_FOUND`、`INDEX_OR_TIME_REQUIRED`、`TIME_REQUIRED`、`TIME_NEGATIVE`、`TIME_COLLISION`、`DELTA_OR_TIME_REQUIRED`、`DELETE_COMBINED_KEY`、`KIND_INVALID`、`OP_INVALID`、`ANIM_INVALID`。

**动画键（SpineAnimEdit）**：`ANIM_INVALID`、`ANIM_TRACK_MISSING`、`ANIM_KEY_MISSING`、`ANIM_KEY_TIME`、`ANIM_KEY_OVER_DURATION`。

**事件/绘制顺序**：`EVENT_NAME_REQUIRED`、`EVENT_NAME_UNKNOWN`、`EVENT_FIELD_NUMBER`、`EVENT_FIELD_STRING`、`EVENTS_NOT_ARRAY`、`DRAW_ORDER_OFFSETS`、`DRAW_ORDER_SLOT`、`DRAW_ORDER_SLOT_UNKNOWN`、`DRAW_ORDER_OFFSET`、`DRAW_ORDER_NOT_ARRAY`。

**形变**：`DEFORM_LENGTH_MISMATCH`、`DEFORM_LENGTH_UNKNOWN`、`DEFORM_OFFSET`、`DEFORM_VERTICES`、`DEFORM_VERTEX_NUMBER`、`DEFORM_CURVE`、`DEFORM_FIELD_REQUIRED`、`DEFORM_SKIN_REQUIRED`、`DEFORM_CREATE_ARRAY_SKINS_UNSUPPORTED`、`DEFORM_LEGACY_SKIN_ARRAY`、`VERTEX_INDEX`、`VERTEX_INDEX_RANGE`、`VERTEX_VALUE`。

**骨架结构（SpineIkAim）**：`MODEL_INVALID`、`BONE_NAME_REQUIRED`、`BONE_NAME_DUPLICATE`、`BONE_NAME_INVALID`、`BONE_PARENT_MISSING`、`BONE_PARENT_TYPE`、`BONE_FIELD_NUMBER`、`BONE_INHERIT`、`BONE_NOT_FOUND`、`BONE_CYCLE`、`RENAME_FROM_REQUIRED`、`RENAME_TO_REQUIRED`、`REPARENT_SELF`、`REPARENT_CYCLE`、`REPARENT_MATRIX`、`REPARENT_SINGULAR`、`REPARENT_DECOMPOSE`、`REPARENT_NORMALIZED_SHEAR`、`REPARENT_INHERIT_LIMITATION`、`DELETE_BONE_REFERENCED`、`DELETE_REQUIRES_WEIGHT_REMAP`、`SLOT_BONE_MISSING`、`CONSTRAINT_BONE_MISSING`、`CONSTRAINT_TARGET_MISSING`、`CONSTRAINT_TARGET_SLOT_MISSING`（path 的 target 是**槽名**）、`IK_CHAIN_NOT_PARENT`、`IK_BONES_REQUIRED`、`MERGED_ANIMATION_TRACK`、`MERGED_ANIMATION_FIELD_CONFLICT`、`ANIM_BONE_ORPHAN` / `ANIM_SLOT_ORPHAN` / `ANIM_CONSTRAINT_ORPHAN`（`severity:"warning"`，不翻转 `ok`，另给 `warningCount`）。

**IK 求解 / 矩阵**：`BONES_REQUIRED`、`MATRIX_REQUIRED`、`TARGET_INVALID`、`CHILD_LENGTH_ZERO`、`NON_UNIFORM_PARENT`、`SINGULAR_GRAND_PARENT`、`DEGENERATE_CHAIN`、`IK_TARGET_OUT_OF_REACH`（官方同样夹取，属提示）、`NOT_IMPLEMENTED`。

**镜像 / 片段（SpinePoseTools）**：`ANIM_INVALID`、`MIRROR_AXIS_UNSUPPORTED`、`MIRROR_TRACK`、`MIRROR_INHERIT_LIMITATION`、`MIRROR_SLOT_SKIPPED`、`MIRROR_DRAW_ORDER_SKIPPED`、`MIRROR_EVENTS_SKIPPED`、`MIRROR_NO_TARGET`、`CLIP_INVALID`、`CLIP_VERSION`、`CLIP_TEXT_EMPTY`、`CLIP_JSON_PARSE`、`BATCH_EDIT_REQUIRED`。

**批量/剪贴板（SpineBatchEdit）**：`EMPTY_SELECTION`、`UNKNOWN_TRACK`、`CLIPBOARD_SIGNATURE`、`PASTE_NEGATIVE_TIME`、`LOCKED_ROW`、`ANIM_CURVE_EDIT_UNSUPPORTED`（复制曲线 key 但没带后继段）。

## 4. 官方对照脚本

| 脚本 | 用途 | 期望 |
| --- | --- | --- |
| `workspace/tmp/e2e/p2-lead-track-official.mjs` | 轨道写入 → 官方 4.2.120 加载 + 姿态/绘制顺序对照 | 全 PASS |
| `workspace/tmp/e2e/p2-deform-create-official.mjs` | 从零创建 deform → 官方 `DeformTimeline` 存在、offset 长度正确 | 10/10 |
| `workspace/tmp/e2e/p2-ik-mirror-verify.mjs` | 两骨 IK（`arotation`）与镜像官方对照 | 13/13 |
| `workspace/tmp/e2e/runtime-verify.mjs` | 三个真实包 runtime 求值对照 | 全 PASS |
| `workspace/tmp/e2e/curve-edit-verify.mjs` | 曲线编辑 → 官方对照 | 7/7 |

官方 runtime 在 `workspace/tmp/spine42/spine-core-4.2.mjs`（spine-ts 4.2.120）。读官方「已施加约束」后的值时记得用 **`bone.arotation` / `ax` / `ay`**——`rotation` 始终是 setup/动画层输入值。
