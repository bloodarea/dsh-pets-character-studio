#!/usr/bin/env python3
"""Export PSD/PSB layers as transparent PNG parts plus a reassembly manifest.

The script is the bundled entry point of the `psd-tools` skill: it only wraps
the public `psd-tools` API so that a character-pack author does not have to
re-derive the same layer walk, name sanitising and manifest bookkeeping.

Requires psd-tools 1.26+ (``pip install "psd-tools>=1.26,<2"``). The optional
``composite`` extra is only needed for vector strokes, gradient/pattern fills
and layer effects.

Usage:
    python psd_parts.py list <psd> [--all] [--json]
    python psd_parts.py extract <psd> --out <dir> [--all] [--flat]
                                 [--with-masks] [--preview] [--manifest <path>]
                                 [--max-alloc-mb <n>] [--dry-run]

Exit codes: 0 success, 1 some layers failed to export, 2 invalid input or
environment (missing dependency, unreadable PSD, bad arguments).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import psd_tools
    from psd_tools import PSDImage
except ImportError:  # pragma: no cover - environment problem, not a PSD problem
    sys.stderr.write(
        "error: psd-tools is not installed.\n"
        '       Install it with: python -m pip install "psd-tools>=1.26,<2"\n'
    )
    raise SystemExit(2)

# Characters Windows rejects in a file name; the separators also keep a layer
# name from turning into a path component.
INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
WHITESPACE = re.compile(r"\s+")
# Windows reserves these device names even with an extension (CON.png fails).
RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def fail(message: str) -> "SystemExit":
    sys.stderr.write(f"error: {message}\n")
    return SystemExit(2)


def sanitize_name(name: str | None, fallback: str) -> str:
    """Turn a Photoshop layer name into a portable file/directory name."""
    text = INVALID_FILENAME.sub("_", (name or "").strip())
    text = WHITESPACE.sub(" ", text).strip(" .")
    text = text[:80].strip(" .")
    if not text:
        return fallback
    if text.split(".")[0].upper() in RESERVED_NAMES:
        text = f"_{text}"
    return text


def color_mode_name(psd) -> str:
    mode = psd.color_mode
    return getattr(mode, "name", None) or str(mode)


def open_psd(path: Path, max_alloc_mb: float | None):
    """Open a document, applying the render allocation budget when supported."""
    kwargs = {}
    if max_alloc_mb is not None:
        kwargs["max_alloc_bytes"] = int(max_alloc_mb * 1024 * 1024)
    try:
        return PSDImage.open(str(path), **kwargs)
    except TypeError:
        # Older psd-tools (before the allocation budget) rejects the keyword.
        if not kwargs:
            raise
        sys.stderr.write("warning: this psd-tools ignores --max-alloc-mb\n")
        return PSDImage.open(str(path))


def iter_tree(node, group_parts=()):
    """Yield (layer, parent_group_parts, index_in_parent) depth first."""
    for index, layer in enumerate(node):
        yield layer, group_parts, index
        if layer.is_group():
            yield from iter_tree(layer, group_parts + (layer, index))


def describe(layer) -> dict:
    """Stable description of one layer, shared by list and extract."""
    info = {
        "name": layer.name,
        "kind": layer.kind,
        "bbox": list(layer.bbox),
        "size": list(layer.size),
        "offset": list(layer.offset),
        "opacity": layer.opacity,
        "blendMode": str(layer.blend_mode),
        "visible": layer.visible,
        "effectivelyVisible": layer.is_visible(),
        "clipping": layer.clipping,
        "hasMask": layer.has_mask(),
    }
    if layer.is_group():
        info["group"] = True
    return info


def to_rgba(image):
    """Return an IMAGE with an alpha channel; leave size and orientation alone."""
    if image.mode == "RGBA":
        return image
    try:
        return image.convert("RGBA")
    except (ValueError, OSError):
        # CMYK/LAB without an ICC path: go through RGB, then add the opaque
        # alpha channel so the exported part stays a valid RGBA PNG.
        return image.convert("RGB").convert("RGBA")


def write_png(image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(str(path), format="PNG")


def unique_key(name_parts: tuple[str, ...], used: set[str]) -> str:
    key = "/".join(name_parts)
    if key not in used:
        used.add(key)
        return key
    suffix = 2
    while f"{key}__{suffix}" in used:
        suffix += 1
    key = f"{key}__{suffix}"
    used.add(key)
    return key


def cmd_list(args) -> int:
    psd = open_psd(args.psd, args.max_alloc_mb)
    rows = []

    def walk(node, depth, group_names=()):
        for index, layer in enumerate(node):
            visible = layer.is_visible()
            if args.all or visible:
                rows.append((depth, index, layer, visible, group_names))
            if layer.is_group():
                walk(layer, depth + 1, group_names + (layer.name,))

    walk(psd, 0)

    if args.json:
        payload = {
            "source": str(args.psd.resolve()),
            "canvas": {"width": psd.width, "height": psd.height},
            "colorMode": color_mode_name(psd),
            "depth": psd.depth,
            "channels": psd.channels,
            "layerCount": len(psd),
            "layers": [
                {**describe(layer), "groupPath": list(group_names)}
                for _, _, layer, _, group_names in rows
            ],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    print(
        f"{args.psd.name}: {psd.width}x{psd.height} "
        f"mode={color_mode_name(psd)} depth={psd.depth} channels={psd.channels}"
    )
    for depth, index, layer, visible, _ in rows:
        flags = []
        if not visible:
            flags.append("hidden")
        if layer.is_group():
            flags.append("group")
        if layer.has_mask():
            flags.append("mask")
        if layer.clipping:
            flags.append("clip")
        left, top, right, bottom = layer.bbox
        print(
            f"{'  ' * depth}[{index}] {layer.kind:<14} "
            f"bbox=({left},{top},{right},{bottom}) "
            f"{' '.join(flags):<24} {layer.name!r}"
        )
    return 0


def cmd_extract(args) -> int:
    psd = open_psd(args.psd, args.max_alloc_mb)
    out_dir = args.out
    used: set[str] = set()
    entries: list[dict] = []
    failures: list[dict] = []
    skipped: list[dict] = []

    def note_skip(layer, reason: str) -> None:
        skipped.append({"name": layer.name, "kind": layer.kind, "reason": reason})

    def walk(node, group_parts: tuple[str, ...], group_names: tuple[str, ...]):
        for index, layer in enumerate(node):
            label = f"{layer.kind}_{index}"
            part = sanitize_name(layer.name, label)
            if layer.is_group():
                walk(layer, group_parts + (part,), group_names + (layer.name,))
                continue

            if not args.all and not layer.is_visible():
                note_skip(layer, "hidden")
                continue

            try:
                image = layer.composite()
            except (ValueError, OSError) as error:
                failures.append(
                    {
                        "name": layer.name,
                        "kind": layer.kind,
                        "error": f"{type(error).__name__}: {error}",
                    }
                )
                continue

            if image is None:
                note_skip(layer, "no pixel data")
                continue

            key = unique_key(group_parts + (part,), used)
            if args.flat:
                relative = Path("__".join(key.split("/")))
            else:
                relative = Path(*key.split("/"))
            # Append ".png" instead of Path.with_suffix(): a layer name such as
            # "Layer.1" must not lose its dot segment.
            target = out_dir / relative.parent / f"{relative.name}.png"
            entry = describe(layer)
            entry.update(
                {
                    "groupPath": list(group_names),
                    "output": target.relative_to(out_dir).as_posix(),
                    "outputSize": list(image.size),
                }
            )

            if not args.dry_run:
                try:
                    write_png(to_rgba(image), target)
                except OSError as error:
                    failures.append(
                        {
                            "name": layer.name,
                            "kind": layer.kind,
                            "error": f"{type(error).__name__}: {error}",
                        }
                    )
                    continue
                if args.with_masks and layer.has_mask() and layer.mask is not None:
                    mask_image = layer.mask.topil()
                    if mask_image is not None:
                        mask_path = target.with_name(target.stem + "__mask.png")
                        write_png(mask_image, mask_path)
                        entry["maskOutput"] = mask_path.relative_to(out_dir).as_posix()

            entries.append(entry)

    walk(psd, (), ())

    manifest = {
        "generator": "skills/psd-tools/scripts/psd_parts.py",
        "psdToolsVersion": psd_tools.__version__,
        "source": str(args.psd.resolve()),
        "canvas": {"width": psd.width, "height": psd.height},
        "colorMode": color_mode_name(psd),
        "depth": psd.depth,
        "channels": psd.channels,
        "options": {"all": bool(args.all), "flat": bool(args.flat)},
        "count": len(entries),
        "layers": entries,
        "skipped": skipped,
        "failures": failures,
    }

    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)
        if args.preview:
            try:
                preview = psd.composite(ignore_preview=True)
                write_png(to_rgba(preview), out_dir / "_preview.png")
            except (ValueError, OSError) as error:
                sys.stderr.write(f"warning: preview failed ({error})\n")
        manifest_path = args.manifest or (out_dir / "manifest.json")
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    verb = "would write" if args.dry_run else "wrote"
    print(
        f"{verb} {len(entries)} part(s) from {args.psd.name}: "
        f"skipped={len(skipped)} failed={len(failures)}"
    )
    for failure in failures:
        sys.stderr.write(f"failed: {failure['name']!r}: {failure['error']}\n")
    return 1 if failures else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Inspect a PSD/PSB and export each layer as a transparent PNG part."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def add_common(p):
        p.add_argument("psd", type=Path, help="PSD or PSB file")
        p.add_argument(
            "--max-alloc-mb",
            type=float,
            metavar="N",
            help="render allocation budget in MiB (untrusted files)",
        )

    listing = sub.add_parser("list", help="print the layer tree")
    add_common(listing)
    listing.add_argument("--all", action="store_true", help="include hidden layers")
    listing.add_argument("--json", action="store_true", help="machine-readable output")
    listing.set_defaults(func=cmd_list)

    extract = sub.add_parser("extract", help="export leaf layers as PNG parts")
    add_common(extract)
    extract.add_argument("--out", type=Path, required=True, help="output directory")
    extract.add_argument("--all", action="store_true", help="also export hidden layers")
    extract.add_argument(
        "--flat",
        action="store_true",
        help="join group names with '__' instead of creating directories",
    )
    extract.add_argument(
        "--with-masks", action="store_true", help="also write layer masks as <part>__mask.png"
    )
    extract.add_argument(
        "--preview", action="store_true", help="also write _preview.png (composited, alpha)"
    )
    extract.add_argument(
        "--manifest", type=Path, help="manifest path (default: <out>/manifest.json)"
    )
    extract.add_argument(
        "--dry-run", action="store_true", help="report what would be written, write nothing"
    )
    extract.set_defaults(func=cmd_extract)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.psd.is_file():
        raise fail(f"PSD file not found: {args.psd}")
    try:
        return args.func(args)
    except (ValueError, OSError) as error:
        raise fail(f"cannot read {args.psd}: {type(error).__name__}: {error}")


if __name__ == "__main__":
    sys.exit(main())
