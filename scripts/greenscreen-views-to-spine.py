#!/usr/bin/env python3
"""绿幕三视图 → Spine 4.2 骨架（生图 API 出图后的落地脚本）。

与 sheet-views-to-spine.py 的区别：输入是三张已经抠成纯绿背景的图片（通常由
生图 API 的 image edit 产出），因此去背用「绿幕溢出」而不是白度阈值，边缘更干净，
也不会把角色的白色蕾丝/围裙误判成背景。

额外处理：发丝闭合形成的圈（例如头顶呆毛的环）内部仍是页白，绿键删不掉。
这里只在**头部区域（纵向 < 45%）**清理「中性白的闭合并列区域」，避免误伤裙摆蕾丝。

用法：
  python3 greenscreen-views-to-spine.py front.png side.png back.png <out_dir> \
          [--name model] [--height 720]
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib.machinery import SourceFileLoader

_views = SourceFileLoader("sheet_views", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "sheet-views-to-spine.py")).load_module()
build_skeleton = _views.build_skeleton

TOP_BAND = 0.15       # 只清理头顶 15%（呆毛环在 ~5%，发带蕾丝圈在 8-15% 但面积很小）
BIG_POCKET = 5000     # 只删「大块」闭合页白（呆毛环实测 8664px；蕾丝小圈 <300px）
NEUTRAL_RB = 2.0      # 页白接近中性：|R-B| < 2
NEUTRAL_RG = 2.5
PINHOLE = 600         # 小于该面积的透明碎洞，从周围不透明像素补回


def key_green(rgb):
    r, g, b = [rgb[..., i].astype(np.int16) for i in range(3)]
    spill = g - np.maximum(r, b)
    alpha = np.clip((80 - spill) / 60.0, 0, 1)
    out = rgb.copy()
    g2 = np.minimum(g, np.maximum(r, b) + 4)
    out[..., 1] = np.where(spill > 4, g2, g).astype(np.uint8)
    return out, (alpha * 255).astype(np.uint8)


def clean_enclosed_page_white(rgb, alpha):
    """清掉发丝闭合圈里的页白（只作用于头部纵向带）。"""
    h, w = alpha.shape
    white = (alpha > 200) & (rgb.min(axis=2) >= 235)
    lab, n = ndimage.label(white)
    if not n:
        return alpha
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    out = alpha.copy()
    lim = int(h * TOP_BAND)
    for i in range(1, n + 1):
        if i in border:
            continue
        m = lab == i
        area = int(m.sum())
        if area < BIG_POCKET:
            continue
        ys = np.where(m)[0]
        if ys.mean() >= lim:
            continue                      # 裙摆/身体区域不动
        mean = rgb[m].mean(axis=0).astype(np.float32)
        if abs(float(mean[0]) - float(mean[2])) >= NEUTRAL_RB:
            continue                      # 暖白 = 画出来的，保留
        if abs(float(mean[0]) - float(mean[1])) >= NEUTRAL_RG:
            continue
        out[m] = 0
    return out


def fill_pinholes(rgb, alpha):
    """把「被角色包住、面积很小」的透明碎洞用周围颜色补回。

    生图模型有时会把眼底、发带蕾丝缝也画成绿色，绿键之后就成了小洞；
    这类洞远小于呆毛环（<600px），补回比留洞更自然。
    """
    trans = alpha <= 8
    lab, n = ndimage.label(trans)
    if not n:
        return alpha
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    out_a = alpha.copy()
    _, (iy, ix) = ndimage.distance_transform_edt(trans, return_indices=True)
    filled = 0
    for i in range(1, n + 1):
        if i in border:
            continue
        m = lab == i
        area = int(m.sum())
        if area >= PINHOLE:
            continue
        rgb[m] = rgb[iy[m], ix[m]]
        out_a[m] = 255
        filled += area
    if filled:
        print(f"     补回碎洞 {filled}px")
    return rgb, out_a


def cut_and_scale(rgb, alpha, target_h):
    ys, xs = np.where(alpha > 8)
    if not len(ys):
        return None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    sub_rgb = rgb[y0:y1, x0:x1].astype(np.float32)
    a = alpha[y0:y1, x0:x1].astype(np.float32) / 255.0
    h, w = a.shape
    size = (max(1, round(w * (target_h / h))), target_h)
    pm = np.dstack([sub_rgb * a[..., None], a * 255.0])
    out = np.zeros((target_h, size[0], 4), np.float32)
    for c in range(4):
        out[..., c] = np.array(Image.fromarray(pm[..., c], mode="F").resize(size, Image.LANCZOS))
    aa = np.clip(out[..., 3] / 255.0, 0, 1)
    rgb_out = np.where(aa[..., None] > 1e-4, out[..., :3] / np.maximum(aa[..., None], 1e-4), 0)
    return Image.fromarray(np.dstack([np.clip(rgb_out, 0, 255), aa * 255]).astype(np.uint8), "RGBA")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs=3, help="front.png side.png back.png（纯绿背景）")
    ap.add_argument("out")
    ap.add_argument("--name", default="model")
    ap.add_argument("--height", type=int, default=720)
    a = ap.parse_args()

    os.makedirs(os.path.join(a.out, "images"), exist_ok=True)
    views = []
    for region, path in zip(("front", "side", "back"), a.inputs):
        im = Image.open(path).convert("RGB")
        rgb = np.array(im)
        out_rgb, alpha = key_green(rgb)
        before = int((alpha > 200).sum())
        alpha = clean_enclosed_page_white(out_rgb, alpha)
        out_rgb, alpha = fill_pinholes(out_rgb, alpha)
        after = int((alpha > 200).sum())
        img = cut_and_scale(out_rgb, alpha, a.height)
        if img is None:
            raise SystemExit(f"{path} 抠图后为空")
        img.save(os.path.join(a.out, "images", f"{region}.png"))
        views.append((region, img.width, img.height))
        print(f"  {region}: {img.size[0]}x{img.size[1]}  清理闭合页白 {before - after}px")
        if before == after:
            print("     （未发现需要清理的闭合页白）")

    skel = build_skeleton(a.name, views, a.height)
    path = os.path.join(a.out, f"{a.name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(skel, f, ensure_ascii=False, indent=1)
    print(f"骨架已写出：{path}")


if __name__ == "__main__":
    main()
