# 上游来源与更新

本技能是 **psd-tools 的用法封装**，不分发 psd-tools 源码。运行时从 PyPI 安装：

```sh
python -m pip install "psd-tools>=1.26,<2"
```

## 记录

| 项 | 值 |
| --- | --- |
| 上游 | <https://github.com/psd-tools/psd-tools> |
| 文档 | <https://psd-tools.readthedocs.io/> |
| 许可 | MIT，Copyright (c) 2019 Kota Yamaguchi；全文见 [LICENSE](../LICENSE) |
| 实测版本 | `psd-tools==1.26.0`（PyPI wheel，`psd_tools-1.26.0-cp313-cp313-win_amd64`） |
| 参考克隆 | 本机 `references/psd-tools/`，commit `043c28ad`（`v1.26.0-38-g043c28ad`，2026-11-06），已被 `.gitignore` 忽略、不入库 |
| 依赖 | `attrs>=23`、`Pillow>=10.3`、`numpy>=1.22`；`composite` extra 另需 `aggdraw`、`scipy` |

本技能打包的内容只有：`SKILL.md`、`scripts/psd_parts.py`、`references/guide.md`、本文件与上游 `LICENSE`。上游源码、测试夹具（含大体积 PSD/PSB）与文档构建文件都留在本地参考克隆中，不随插件分发。

## 升级步骤

1. 在本地参考克隆里取新版本并记录新 commit：

   ```sh
   git -C references/psd-tools fetch --tags
   git -C references/psd-tools checkout <new-tag-or-commit>
   git -C references/psd-tools describe --tags --always
   ```

2. 安装同一版本到测试环境：

   ```sh
   python -m pip install -U "psd-tools==<version>"
   ```

3. 用上游夹具回归拆件脚本，至少覆盖：普通 PSB/PSD、分组、蒙版、文本、16 位、32 位、CMYK、透明与空图层。验收方式见 `guide.md` 末尾“实测夹具”。

   ```sh
   FIXTURES=references/psd-tools/tests/psd_files
   python skills/psd-tools/scripts/psd_parts.py list "$FIXTURES/group.psd"
   python skills/psd-tools/scripts/psd_parts.py extract "$FIXTURES/masks.psd" \
       --out workspace/tmp/psd-parts-check --preview --with-masks
   ```

4. 只在本机允许读取 `references/psd-tools/` 的情况下修改技能文档；**不要把源码、夹具或大文件复制进 `skills/`**。提交前跑：

   ```sh
   bash scripts/verify-hygiene.sh --files $(git ls-files --others --exclude-standard | grep '^skills/')
   ```

5. 同步更新：本文件表格、`SKILL.md` 的版本说明、根 `requirements.txt` 的版本范围，以及 `references/guide.md` 中与版本相关的行为（例如预算/限制 API 变化）。

## 行为变更风险

拆件依赖以下上游行为，升级时优先核对：

- 默认返回值：`PSDImage.composite()` 是否仍优先返回内嵌预览（需要 `ignore_preview=True` 才得到 RGBA）。
- 图层顺序：迭代是否仍为背景→前景。
- `layer.composite()` 是否仍烘焙蒙版与剪贴层，`topil()` 是否仍只取自身通道。
- 16/32 位窄化到 8 位的色调映射规则。
- `max_alloc_bytes` / `ParseLimits` 的默认值与异常类型。
- 颜色模式转换（CMYK/LAB 的 ICC 行为、多通道保留通道数）。
