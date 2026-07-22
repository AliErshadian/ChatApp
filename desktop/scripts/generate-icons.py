#!/usr/bin/env python3
"""Generate RELAY Electron icons for Windows, macOS, and Linux from build/logo.png."""

from __future__ import annotations

import struct
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow is required: pip install pillow", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
PUBLIC = ROOT / "public"
SRC = BUILD / "logo.png"

LINUX_SIZES = (16, 32, 48, 64, 128, 256, 512)
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
ICNS_SIZES = (16, 32, 64, 128, 256, 512, 1024)


def load_logo() -> Image.Image:
    if not SRC.exists():
        raise FileNotFoundError(f"Missing source logo: {SRC}")
    return Image.open(SRC).convert("RGBA")


def save_png(img: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.resize((size, size), Image.Resampling.LANCZOS).save(path, "PNG")


def write_ico(logo: Image.Image, path: Path) -> None:
    # Pillow ICO: provide sizes=; 0 in directory means 256.
    images = [logo.resize((s, s), Image.Resampling.LANCZOS) for s in ICO_SIZES]
    images[-1].save(
        path,
        format="ICO",
        sizes=[(im.width, im.height) for im in images],
        append_images=images[:-1],
    )
    data = path.read_bytes()
    count = struct.unpack_from("<H", data, 4)[0]
    sizes_found = []
    for i in range(count):
        entry = data[6 + i * 16 : 6 + (i + 1) * 16]
        w, h = entry[0] or 256, entry[1] or 256
        sizes_found.append((w, h))
    if (256, 256) not in sizes_found:
        raise RuntimeError(f"{path} is missing a 256x256 entry; found {sizes_found}")


def write_icns(logo: Image.Image, path: Path) -> None:
    images = [logo.resize((s, s), Image.Resampling.LANCZOS) for s in ICNS_SIZES]
    images[-1].save(path, format="ICNS", append_images=images[:-1])


def write_linux_icons(logo: Image.Image) -> None:
    # electron-builder looks for icons under build/icons or uses icon.png
    icons_dir = BUILD / "icons"
    for size in LINUX_SIZES:
        save_png(logo, icons_dir / f"{size}x{size}.png", size)
    # Also flat names some tools expect
    save_png(logo, icons_dir / "512x512.png", 512)


def write_public_favicons(logo: Image.Image) -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    save_png(logo, PUBLIC / "favicon-16x16.png", 16)
    save_png(logo, PUBLIC / "favicon-32x32.png", 32)
    save_png(logo, PUBLIC / "apple-touch-icon.png", 180)
    fav = logo.resize((32, 32), Image.Resampling.LANCZOS)
    fav.save(PUBLIC / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)])


def write_installer_bitmaps(logo: Image.Image) -> None:
    # Sidebar 164x314 24-bit BMP
    w, h = 164, 314
    sidebar = Image.new("RGB", (w, h), (10, 10, 12))
    for y in range(h):
        c = int(10 + (y / (h - 1)) * 18)
        for x in range(w):
            sidebar.putpixel((x, y), (c, c, min(255, c + 2)))
    mark = logo.resize((96, 96), Image.Resampling.LANCZOS)
    sidebar.paste(mark.convert("RGB"), ((w - 96) // 2, 72), mark.split()[-1])
    sidebar.save(BUILD / "installerSidebar.bmp", format="BMP")

    header = Image.new("RGB", (150, 57), (10, 10, 12))
    hmark = logo.resize((40, 40), Image.Resampling.LANCZOS)
    header.paste(hmark.convert("RGB"), (8, 8), hmark.split()[-1])
    header.save(BUILD / "installerHeader.bmp", format="BMP")


def main() -> int:
    logo = load_logo()
    BUILD.mkdir(parents=True, exist_ok=True)

    save_png(logo, BUILD / "icon.png", 512)
    write_ico(logo, BUILD / "icon.ico")
    write_icns(logo, BUILD / "icon.icns")
    write_linux_icons(logo)
    write_public_favicons(logo)
    write_installer_bitmaps(logo)

    print("Generated:")
    for name in (
        "icon.png",
        "icon.ico",
        "icon.icns",
        "icons/512x512.png",
        "installerSidebar.bmp",
        "installerHeader.bmp",
    ):
        path = BUILD / name
        print(f"  {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
