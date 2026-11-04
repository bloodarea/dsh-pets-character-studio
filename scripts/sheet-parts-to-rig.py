#!/usr/bin/env python3
"""绿幕拆件 sheet → Spine 4.2 骨架（通用版，项目内可复用）。

输入：一张纯绿背景的拆件图（各部件互不接触），例如由生图 API 生成的
      "character parts sheet"。也接受白底：--key white。
输出：<out>/images/part_XX.png + <out>/<name>.json（Spine 4.2 骨架），
      随后用 spine-pack.py 打包、spine-verify.mjs 校验。

层序约定：默认按「面积从大到小」排前后（大衣身在后，小配件在前），
可用 --names 显式指定 back→front 的层名来固定顺序与命名。

限制：每个部件一根骨骼、绕自身中心旋转，不做网格与权重；
真正的二段式肢体（上臂/前臂）需要拆得更细或手工调骨。
"""
import argparse
import json
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage

MIN_AREA_RATIO = 0.0008  # 小于整图的 0.08% 视为噪点

# 轴心（关节）位置：相对部件 bbox 的比例，原点左上、y 向下。
# 不配的在部件中心——那会让肢体绕自身中心转，看起来"散架"，所以默认都给关节。
PIVOTS = {
    "head":      (0.50, 0.98),   # 颈
    "body":      (0.50, 0.98),   # 站姿脚底
    "leg":       (0.50, 0.02),   # 胯
    "arm-l":     (0.50, 0.06),   # 肩
    "arm-r":     (0.50, 0.06),
    "ahoge":     (0.50, 0.98),   # 呆毛根部（贴头顶）
    "tail":      (0.04, 0.30),   # 尾根
    "hair-side": (0.50, 0.05),   # 发根
    "hair-back": (0.50, 0.05),
    "headband":  (0.50, 0.60),
    "bow":       (0.50, 0.35),
}


def key_green(rgb):
    r, g, b = [rgb[..., i].astype(np.int16) for i in range(3)]
    spill = g - np.maximum(r, b)
    alpha = np.clip((80 - spill) / 60.0, 0, 1)
    out = rgb.copy()
    g2 = np.minimum(g, np.maximum(r, b) + 4)
    out[..., 1] = np.where(spill > 4, g2, g).astype(np.uint8)
    return out, (alpha * 255).astype(np.uint8)


def key_white(rgb):
    mn = rgb.min(axis=2).astype(np.int16)
    mx = rgb.max(axis=2).astype(np.int16)
    near = (mn >= 238) & ((mx - mn) <= 12)
    lab, n = ndimage.label(near)
    if n:
        border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
        border.discard(0)
        bg = np.isin(lab, list(border))
    else:
        bg = near
    return rgb, np.where(bg, 0, 255).astype(np.uint8)


TOP_BAND = 0.15       # 只在头顶 15% 清理闭合页白（呆毛环）
BIG_POCKET = 5000     # 只删大块闭合页白
PINHOLE = 600         # 小于该面积的透明碎洞从周围补回


def clean_top_pockets(rgb, alpha):
    """清掉头顶呆毛环里被包住的页白（模型通常不理会这个要求，只能本地补）。"""
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
        if int(m.sum()) < BIG_POCKET:
            continue
        if np.where(m)[0].mean() >= lim:
            continue
        mean = rgb[m].mean(axis=0)
        if abs(float(mean[0]) - float(mean[2])) < 2.0 and abs(float(mean[0]) - float(mean[1])) < 2.5:
            out[m] = 0
    return out


def fill_pinholes(rgb, alpha):
    trans = alpha <= 8
    lab, n = ndimage.label(trans)
    if not n:
        return rgb, alpha
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    out_a = alpha.copy()
    _, (iy, ix) = ndimage.distance_transform_edt(trans, return_indices=True)
    for i in range(1, n + 1):
        if i in border:
            continue
        m = lab == i
        if int(m.sum()) >= PINHOLE:
            continue
        rgb[m] = rgb[iy[m], ix[m]]
        out_a[m] = 255
    return rgb, out_a


def cut_parts(rgb, alpha, min_area):
    subj = alpha > 128
    lab, n = ndimage.label(subj)
    parts = []
    for i in range(1, n + 1):
        m = lab == i
        area = int(m.sum())
        if area < min_area:
            continue
        ys, xs = np.where(m)
        parts.append({
            "mask": m,
            "area": area,
            "box": (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1),
        })
    # 前后顺序：面积大的在后
    parts.sort(key=lambda p: -p["area"])
    return parts


TIGHTEN_TARGET = {
    "arm-l": "body", "arm-r": "body", "leg": "body", "tail": "body",
    "ahoge": "head", "hair-side": "head", "bow": "head",
}


def tighten_by_mask(parts, overlap=3.0, verbose=True):
    """按「mask 最近距离」把肢体拉向目标部件，补掉拆件图人为留出的缝。

    与 bbox 法相比，这里量的是真实轮廓间距：取肢体 mask 上离目标 mask 最近的点，
    沿该方向平移 gap+overlap 像素，使两部件轮廓重叠 overlap 像素。
    """
    by = {p["name"]: p for p in parts}
    for name, target in TIGHTEN_TARGET.items():
        p, t = by.get(name), by.get(target)
        if not p or not t:
            continue
        dist, (iy, ix) = ndimage.distance_transform_edt(~t["mask"], return_indices=True)
        ys, xs = np.where(p["mask"])
        if not len(ys):
            continue
        d = dist[ys, xs]
        k = int(np.argmin(d))
        gap = float(d[k])
        py, px = ys[k], xs[k]
        ty, tx = iy[py, px], ix[py, px]
        dy, dx = ty - py, tx - px
        norm = max(1e-6, (dx * dx + dy * dy) ** 0.5)
        dx, dy = dx / norm, dy / norm
        shift_x, shift_y = dx * (gap + overlap), dy * (gap + overlap)
        p["mask"] = np.roll(np.roll(p["mask"], int(round(shift_y)), axis=0),
                            int(round(shift_x)), axis=1)
        x0, y0, x1, y1 = p["box"]
        p["box"] = (x0 + shift_x, y0 + shift_y, x1 + shift_x, y1 + shift_y)
        if verbose:
            print(f"    合缝 {name} → {target}: gap={gap:.1f}px  shift=({shift_x:.1f},{shift_y:.1f})")
    return parts


def build_skeleton(name, placements, canvas_w, canvas_h):
    """placements: [{name,w,h,cx,cy}]，cx/cy 为画布坐标（y 向下）。"""
    feet_y = max(p["cy"] + p["h"] / 2 for p in placements)
    bones = [{"name": "root"}]
    slots, att_by_slot = [], {}
    for p in placements:
        bone = f"b_{p['name']}"
        px = p.get("px", p["cx"]); py = p.get("py", p["cy"])
        bones.append({
            "name": bone, "parent": "root",
            "x": round(px - canvas_w / 2, 2),
            "y": round(feet_y - py, 2),
        })
        slots.append({"name": f"s_{p['name']}", "bone": bone, "attachment": p["name"]})
        px = p.get("px", p["cx"]); py = p.get("py", p["cy"])
        # 轴心在部件内的位置（y 向上换算）：附件中心相对骨骼原点的偏移
        off_x = p["w"] / 2 - (px - (p["cx"] - p["w"] / 2))
        off_y = (py - (p["cy"] - p["h"] / 2)) - p["h"] / 2
        att_by_slot[f"s_{p['name']}"] = {
            p["name"]: {"x": round(off_x, 2), "y": round(off_y, 2),
                        "width": p["w"], "height": p["h"]}
        }

    present = {p["name"] for p in placements}

    def keys(dur, fn, n=9):
        return [{"time": round(i * dur / (n - 1), 3), "value": round(fn(i / (n - 1)), 3)}
                for i in range(n)]

    def sine(amp, phase=0.0, cycles=1.0):
        return lambda t: amp * math.sin(2 * math.pi * (t * cycles + phase))

    # 每个状态：整体节奏 + 各部件幅度（度 / 像素）
    STATES = {
        "idle":      dict(dur=2.4, bob=5,  body=0.8, ahoge=5,  tail=4,  arm=2,  head=1.2, hair=1.5),
        "working":   dict(dur=1.2, bob=12, body=1.5, ahoge=9,  tail=8,  arm=5,  head=2.5, hair=3.0),
        "attention": dict(dur=0.9, bob=8,  body=2.0, ahoge=12, tail=10, arm=8,  head=3.5, hair=4.0),
        "done":      dict(dur=1.2, bob=18, body=2.0, ahoge=11, tail=11, arm=9,  head=3.0, hair=3.5),
        "failed":    dict(dur=3.0, bob=2,  body=0.8, ahoge=3,  tail=2,  arm=1.5, head=2.0, hair=0.8),
    }
    # 相位错开，避免所有部件同步摆动（那样像纸片整体抖）
    PHASE = {"ahoge": 0.12, "tail": 0.25, "arm-l": 0.0, "arm-r": 0.5,
             "hair-back": 0.33, "hair-side": 0.42, "head": 0.08, "bow": 0.2}

    anims = {}
    for state, cfg in STATES.items():
        dur = cfg["dur"]
        bones_anim = {}
        if "body" in present:
            bones_anim[f"b_body"] = {
                "translate": [{"time": 0, "x": 0, "y": 0},
                              {"time": round(dur / 4, 3), "x": 0, "y": round(cfg["bob"] * 0.5, 2)},
                              {"time": round(dur / 2, 3), "x": 0, "y": 0},
                              {"time": round(dur * 3 / 4, 3), "x": 0, "y": round(cfg["bob"] * 0.5, 2)},
                              {"time": dur, "x": 0, "y": 0}],
                "rotate": keys(dur, sine(cfg["body"])),
            }
        for part, amp_key in (("ahoge", "ahoge"), ("tail", "tail"), ("head", "head"),
                              ("hair-back", "hair"), ("hair-side", "hair"), ("bow", "head")):
            if part not in present:
                continue
            amp = cfg[amp_key] * (1.6 if part == "ahoge" else 1.0)
            ph = PHASE.get(part, 0)
            bones_anim[f"b_{part}"] = {"rotate": keys(dur, sine(amp, ph, cycles=1.0))}
        for arm in ("arm-l", "arm-r"):
            if arm not in present:
                continue
            ph = PHASE.get(arm, 0)
            bones_anim[f"b_{arm}"] = {"rotate": keys(dur, sine(cfg["arm"], ph, cycles=2.0))}
        if "failed" == state and "head" in present:
            bones_anim[f"b_head"] = {"rotate": [{"time": 0, "value": 0},
                                                {"time": 0.4, "value": -8},
                                                {"time": dur, "value": -8}]}
        anims[state] = {"bones": bones_anim}
    if "ahoge" in present and "tail" in present:
        anims["turn"] = {
            "slots": {},
            "bones": {f"b_{p}": {"rotate": keys(0.6, sine(10 if p == "ahoge" else 8, 0, 2))}
                      for p in ("ahoge", "tail") if p in present},
        }

    return {
        "skeleton": {"spine": "4.2.00", "x": -canvas_w / 2, "y": -20,
                     "width": canvas_w, "height": canvas_h + 40},
        "bones": bones,
        "slots": slots,
        "skins": [{"name": "default", "attachments": att_by_slot}],
        "animations": anims,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("out")
    ap.add_argument("--name", default="model")
    ap.add_argument("--key", choices=("green", "white"), default="green")
    ap.add_argument("--names", default=None, help="逗号分隔，back→front 的层名（数量需与切出的件一致）")
    ap.add_argument("--min-area-ratio", type=float, default=MIN_AREA_RATIO)
    ap.add_argument("--layout", choices=("inplace", "center"), default="inplace",
                    help="inplace=部件保持 sheet 上的原始位置（要求拆件图原位分离）；"
                         "center=全部居中堆叠（格子排布的 sheet 只能这样凑合）")
    ap.add_argument("--no-tighten", action="store_true", help="不做肢体合缝（保留拆件图原始间距）")
    ap.add_argument("--draw-order", default=None,
                    help="逗号分隔的层名，指定 back→front 的绘制顺序（未列出的按原顺序追加）")
    a = ap.parse_args()

    src = Image.open(a.sheet).convert("RGB")
    rgb = np.array(src)
    canvas_w, canvas_h = src.size
    rgb2, alpha = (key_green if a.key == "green" else key_white)(rgb)
    if a.key == "green":
        alpha = clean_top_pockets(rgb2, alpha)
        rgb2, alpha = fill_pinholes(rgb2, alpha)
    parts = cut_parts(rgb2, alpha, int(canvas_w * canvas_h * a.min_area_ratio))
    print(f"输入 {canvas_w}x{canvas_h}，切出 {len(parts)} 个部件")
    if not parts:
        raise SystemExit("没有切出任何部件：检查背景色与 --key")

    names = a.names.split(",") if a.names else None
    if names and len(names) != len(parts):
        raise SystemExit(f"--names 给了 {len(names)} 个名字，但切出 {len(parts)} 个部件")
    for i, p in enumerate(parts):
        p["name"] = names[i] if names else f"part_{i:02d}"

    if not a.no_tighten:
        parts = tighten_by_mask(parts)

    os.makedirs(os.path.join(a.out, "images"), exist_ok=True)
    placements = []
    for i, p in enumerate(parts):
        x0, y0, x1, y1 = [int(round(v)) for v in p["box"]]
        w, h = x1 - x0, y1 - y0
        layer = np.zeros((h, w, 4), np.uint8)
        layer[..., :3] = rgb2[y0:y1, x0:x1]
        layer[..., 3] = alpha[y0:y1, x0:x1] * p["mask"][y0:y1, x0:x1]
        part_name = p["name"]
        Image.fromarray(layer, "RGBA").save(os.path.join(a.out, "images", f"{part_name}.png"))
        pv = PIVOTS.get(part_name, (0.5, 0.5))
        placements.append({"name": part_name, "w": w, "h": h,
                           "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2,
                           "px": x0 + pv[0] * w, "py": y0 + pv[1] * h})
        print(f"  {part_name}: {w}x{h}  面积 {p['area']}")

    if a.layout == "center":
        ccx, ccy = canvas_w / 2, canvas_h / 2
        for pl in placements:
            pl["cx"], pl["cy"] = ccx, ccy
        print("布局：center（所有部件居中堆叠）")
    else:
        print("布局：inplace（使用 sheet 原始坐标，要求原位分离）")

    if a.draw_order:
        want = [n.strip() for n in a.draw_order.split(",") if n.strip()]
        by_name = {p["name"]: p for p in placements}
        unknown = [n for n in want if n not in by_name]
        if unknown:
            raise SystemExit(f"--draw-order 里有未知层名: {unknown}")
        placements = [by_name[n] for n in want] + [p for p in placements if p["name"] not in want]
        print("绘制顺序：" + " → ".join(p["name"] for p in placements))


    feet_sheet = max(pl["cy"] + pl["h"] / 2 for pl in placements)
    with open(os.path.join(a.out, "layout.json"), "w", encoding="utf-8") as f:
        json.dump({"canvas": [canvas_w, canvas_h], "feetSheetY": round(feet_sheet, 2),
                   "parts": [{k: round(v, 2) if isinstance(v, float) else v
                              for k, v in pl.items()} for pl in placements]},
                  f, ensure_ascii=False, indent=1)

    skel = build_skeleton(a.name, placements, canvas_w, canvas_h)
    path = os.path.join(a.out, f"{a.name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(skel, f, ensure_ascii=False, indent=1)
    print(f"骨架已写出：{path}（{len(skel['bones'])} 骨 / {len(skel['slots'])} 槽）")


if __name__ == "__main__":
    main()
