#!/usr/bin/env python3
"""三视图立绘 → Spine 4.2 骨架（视图切换 + 变换动画）生成器。

输入：一张白色背景的三视图立绘（正/侧/背），JPEG/PNG 均可。
输出：<out>/images/{front,side,back}.png + <out>/<name>.json（Spine 4.2 骨架）。
     随后用 ref-sprite 的 spine-pack.py 打包图集、spine-verify.mjs 校验。

限制（诚实说明）：不做语义拆件、不做网格形变与权重，因此没有四肢/头发独立摆动；
动效来自整身骨骼变换与三视图切换。真正的拆件需要分层素材或 GPU 语义拆层。

用法：
  python3 sheet-to-spine.py <sheet.jpg> <out_dir> [--name model] [--height 720]
"""
import argparse
import json
import os
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

# 背景判定：接近纯白且低饱和
BG_MIN = 238
BG_CHROMA = 12
# 删除被发丝闭合的白色缝隙：页白与绘画白在颜色上无法可靠区分，
# 误判会把围裙/蕾丝打穿，故默认关闭；发缝建议改用绿幕素材（生图 API 出图）解决。
GAP_REMOVE = False


def bg_mask(rgb):
    """背景掩码：全分辨率精确求解，不做下采样（下采样会把边缘变成 4px 方块锯齿）。

    1) 与图像四边连通的近白区域 = 背景；
    2) 被发丝闭合的近白缝隙 = 背景（外环为饱和蓝发，色度 ≥ 23；围裙/蕾丝的外环 ≤ 21.6）。
    """
    from scipy import ndimage

    mn = rgb.min(axis=2).astype(np.int16)
    mx = rgb.max(axis=2).astype(np.int16)
    near_white = (mn >= BG_MIN) & ((mx - mn) <= BG_CHROMA)

    lab, n = ndimage.label(near_white)
    if n:
        border_ids = np.unique(np.concatenate([
            lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))
        border_ids = border_ids[border_ids != 0]
        border_bg = np.isin(lab, border_ids)
    else:
        border_bg = near_white

    if not GAP_REMOVE:
        return border_bg
    chroma = (mx - mn).astype(np.float32)
    gap = np.zeros_like(border_bg)
    for i in range(1, n + 1):
        m = lab == i
        area = int(m.sum())
        if border_bg[m].any() or area > 4000:
            continue
        ring = ndimage.binary_dilation(m, iterations=3) & ~m
        if not ring.any() or float(chroma[ring].mean()) < 23:
            continue  # 外环不是饱和发色 → 是衣服/皮肤上的白块，保留
        # 页白是中性灰（|R-B|≈0.5），画出来的白细节带暖色（|R-B|≈7）；
        # 只有中性白或足够大的区域才判为背景，避免把裙子圆点、眼内高光删掉。
        mean = rgb[m].mean(axis=0).astype(np.float32)
        neutral = (abs(float(mean[0]) - float(mean[2])) < 3.0
                   and abs(float(mean[0]) - float(mean[1])) < 3.0)
        if area >= 150 or (neutral and area >= 60):
            gap |= m
    return border_bg | gap


def clean_subject(alpha):
    """去掉 JPEG 噪点造成的小连通块，只保留真正的角色区块。"""
    from scipy import ndimage
    subj = alpha > 8
    lab, n = ndimage.label(subj)
    if n == 0:
        return alpha
    sizes = ndimage.sum(subj, lab, range(1, n + 1))
    keep_ids = [i + 1 for i, sz in enumerate(sizes) if sz > subj.size * 0.0005]
    keep = np.isin(lab, keep_ids) if keep_ids else subj
    # 注意：不要 binary_fill_holes —— 那会把头发丝之间的透明缝隙填成不透明白块
    return np.where(keep, 255, 0).astype(np.uint8)


def split_views(alpha):
    """按列的主体像素计数切栏：空白列（含只有噪点的列）视为分隔。"""
    cnt = (alpha > 8).sum(axis=0)
    thresh = max(3, int(alpha.shape[0] * 0.002))
    col_has = cnt > thresh
    groups, start = [], None
    for x, has in enumerate(col_has):
        if has and start is None:
            start = x
        elif not has and start is not None:
            groups.append((start, x))
            start = None
    if start is not None:
        groups.append((start, len(col_has)))
    # 合并过窄的碎片（噪点）
    groups = [g for g in groups if g[1] - g[0] > alpha.shape[1] * 0.02]
    return groups


def cut_view(rgb, alpha, box, target_h):
    """裁出一栏并缩放到目标高度。

    关键：先把 RGB 预乘 alpha 再缩放，最后反预乘。否则 LANCZOS 会把原图的白色
    背景色混进边缘像素，缩小后就是一圈白边/锯齿。
    """
    x0, x1 = box
    sub_a = alpha[:, x0:x1]
    rows = np.where((sub_a > 8).any(axis=1))[0]
    if not len(rows):
        return None
    y0, y1 = rows[0], rows[-1] + 1
    sub_rgb = rgb[y0:y1, x0:x1].astype(np.float32)
    a = (sub_a[y0:y1].astype(np.float32)) / 255.0
    h, w = a.shape
    scale = target_h / h
    size = (max(1, round(w * scale)), target_h)

    pm = np.dstack([sub_rgb * a[..., None], a * 255.0])
    out = np.zeros((target_h, size[0], 4), np.float32)
    for c in range(4):
        ch = Image.fromarray(pm[..., c], mode="F").resize(size, Image.LANCZOS)
        out[..., c] = np.array(ch)
    aa = np.clip(out[..., 3] / 255.0, 0.0, 1.0)
    rgb_out = np.where(aa[..., None] > 1e-4, out[..., :3] / np.maximum(aa[..., None], 1e-4), 0)
    rgba = np.dstack([np.clip(rgb_out, 0, 255), aa * 255.0]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def build_skeleton(name, views, height):
    """views: [(region, w, h)]，脚底对齐、水平居中。"""
    max_w = max(w for _, w, _ in views)
    bones = [
        {"name": "root"},
        {"name": "body", "parent": "root", "x": 0, "y": 0},
        {"name": "head", "parent": "body", "x": 0, "y": height * 0.78},
    ]
    slots = [{"name": "body", "bone": "body", "attachment": views[0][0]}]
    att = {}
    for region, w, h in views:
        att[region] = {"x": 0, "y": h / 2, "width": w, "height": h}
    skin = {"name": "default", "attachments": {"body": att}}

    def key(time, **kw):
        d = {"time": round(time, 3)}
        d.update({k: v for k, v in kw.items()})
        return d

    anims = {
        # 待机：呼吸 + 极轻微左右摆
        "idle": {
            "bones": {
                "body": {
                    "scaleY": [key(0, value=1), key(1.0, value=1.015), key(2.0, value=1)],
                    "scaleX": [key(0, value=1), key(1.0, value=0.995), key(2.0, value=1)],
                    "rotate": [key(0, value=0), key(1.0, value=0.6), key(2.0, value=0)],
                }
            }
        },
        # 工作中：快节奏起伏 + 前倾
        "working": {
            "bones": {
                "body": {
                    "translate": [key(0, y=0), key(0.25, y=8), key(0.5, y=0), key(0.75, y=8), key(1.0, y=0)],
                    "rotate": [key(0, value=1.5), key(0.5, value=-1.5), key(1.0, value=1.5)],
                },
                "head": {"rotate": [key(0, value=-2), key(0.5, value=2), key(1.0, value=-2)]},
            }
        },
        # 需要关注：快速抖动 + 放大
        "attention": {
            "bones": {
                "body": {
                    "scaleX": [key(0, value=1), key(0.12, value=1.04), key(0.24, value=1), key(0.36, value=1.04), key(0.5, value=1)],
                    "scaleY": [key(0, value=1), key(0.12, value=1.06), key(0.24, value=1), key(0.36, value=1.06), key(0.5, value=1)],
                    "rotate": [key(0, value=0), key(0.08, value=3), key(0.16, value=-3), key(0.24, value=2), key(0.32, value=-2), key(0.5, value=0)],
                }
            }
        },
        # 完成：跳一下 + 压扁回弹
        "done": {
            "bones": {
                "body": {
                    "translate": [key(0, y=0), key(0.15, y=-10), key(0.35, y=60), key(0.6, y=0), key(0.75, y=-6), key(1.0, y=0)],
                    "scaleY": [key(0, value=1), key(0.15, value=0.92), key(0.35, value=1.06), key(0.6, value=0.97), key(1.0, value=1)],
                    "scaleX": [key(0, value=1), key(0.15, value=1.08), key(0.35, value=0.95), key(0.6, value=1.02), key(1.0, value=1)],
                }
            }
        },
        # 失败：垂头、缓慢下沉
        "failed": {
            "bones": {
                "body": {
                    "rotate": [key(0, value=0), key(0.4, value=-3), key(3.0, value=-3)],
                    "translate": [key(0, y=0), key(0.4, y=-10), key(3.0, y=-10)],
                    "scaleY": [key(0, value=1), key(0.4, value=0.97), key(3.0, value=0.97)],
                },
                "head": {"rotate": [key(0, value=0), key(0.4, value=-8), key(3.0, value=-8)]},
            }
        },
        # 转身：三视图切换（正 → 侧 → 背 → 侧 → 正）
        "turn": {
            "slots": {
                "body": {
                    "attachment": [
                        {"time": 0, "name": views[0][0]},
                        {"time": 0.12, "name": views[1][0] if len(views) > 1 else views[0][0]},
                        {"time": 0.24, "name": views[2][0] if len(views) > 2 else views[0][0]},
                        {"time": 0.36, "name": views[1][0] if len(views) > 1 else views[0][0]},
                        {"time": 0.48, "name": views[0][0]},
                    ]
                }
            },
            "bones": {
                "body": {
                    "scaleX": [key(0, value=1), key(0.06, value=0.86), key(0.12, value=1),
                               key(0.18, value=0.86), key(0.24, value=1),
                               key(0.30, value=0.86), key(0.36, value=1),
                               key(0.42, value=0.86), key(0.48, value=1)],
                }
            },
        },
    }

    return {
        "skeleton": {"spine": "4.2.00", "x": -max_w / 2, "y": -20, "width": max_w, "height": height + 40},
        "bones": bones,
        "slots": slots,
        "skins": [skin],
        "animations": anims,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("out")
    ap.add_argument("--name", default="model")
    ap.add_argument("--height", type=int, default=720)
    a = ap.parse_args()

    src = Image.open(a.sheet).convert("RGB")
    rgb = np.array(src)
    back = bg_mask(rgb)
    alpha = np.where(back, 0, 255).astype(np.uint8)
    alpha = clean_subject(alpha)
    print(f"输入 {src.size[0]}x{src.size[1]}，背景占比 {(back.mean() * 100):.1f}%，"
          f"主体占比 {(alpha > 8).mean() * 100:.1f}%")

    groups = split_views(alpha)
    print(f"切出 {len(groups)} 个视图栏：{groups}")
    if len(groups) != 3:
        raise SystemExit(f"期望 3 栏（正/侧/背），实际 {len(groups)} 栏。请检查背景是否可分离。")

    os.makedirs(os.path.join(a.out, "images"), exist_ok=True)
    views = []
    for region, box in zip(("front", "side", "back"), groups):
        img = cut_view(rgb, alpha, box, a.height)
        if img is None:
            raise SystemExit(f"{region} 视图为空")
        img.save(os.path.join(a.out, "images", f"{region}.png"))
        views.append((region, img.width, img.height))
        print(f"  {region}: {img.width}x{img.height}")

    skel = build_skeleton(a.name, views, a.height)
    path = os.path.join(a.out, f"{a.name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(skel, f, ensure_ascii=False, indent=1)
    print(f"骨架已写出：{path}")


if __name__ == "__main__":
    main()
