# spine/

放 Spine 4.x 导出的资源，缺一不可：

| 文件 | 说明 |
| --- | --- |
| `model.json` | 骨架 JSON，`manifest.render.entry` 指向它 |
| `model.atlas` | 图集描述；首行是贴图文件名，`size:` 必须等于贴图实际像素 |
| `model.png` / `model.webp` | 图集贴图；允许多页，atlas 里出现的每一页都要有对应文件 |

编辑器与运行端还要求同目录的索引 `index.json`（格式见 [CHARACTER-PACK.md](../../../CHARACTER-PACK.md) §Spine 编辑索引）：

```json
{
  "schemaVersion": 1,
  "base": "assets/characters/<id>/spine",
  "label": "角色名",
  "files": {
    "model": "model.json",
    "atlas": "model.atlas",
    "textures": ["model.png"]
  }
}
```

注意事项：

- 不要建空骨架或占位贴图充数；没有真实资源就不要放这个目录。
- `manifest.states` 的每个动画名都必须在这个 `model.json` 里存在。
- 贴图单文件 ≤ 8 MiB，超了先压缩或分页。
- `base` 是编辑仓库根相对路径，换仓库/换位置后要同步改，不能指回兄弟仓库。