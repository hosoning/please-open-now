#!/usr/bin/env python3
"""Generate PWA icons for 请在这时打开 (no external assets).

Usage:  python3 tools/make_icons.py
Requires Pillow (pip install pillow). Output goes to ./icons/.
Edit the palette below to re-brand.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

CREAM = (250, 246, 241)
MIST = (240, 214, 209)
BLUSH = (232, 196, 196)
ROSE = (200, 140, 140)
ROSE_DEEP = (176, 112, 116)
PAPER = (255, 250, 245)
FLAP = (245, 232, 224)
LINE = (226, 196, 190)

OUT = Path(__file__).resolve().parent.parent / "icons"
SS = 4  # supersampling factor


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = min(1.0, (x * 0.35 + y * 0.65) / size)
            px[x, y] = lerp(CREAM, MIST, t)
    return img


def heart(draw, cx, cy, r, fill):
    # two circles + triangle
    draw.ellipse([cx - r, cy - r * 0.9, cx, cy + r * 0.1], fill=fill)
    draw.ellipse([cx, cy - r * 0.9, cx + r, cy + r * 0.1], fill=fill)
    draw.polygon([(cx - r * 0.97, cy - r * 0.25), (cx + r * 0.97, cy - r * 0.25), (cx, cy + r * 1.0)], fill=fill)


def render(size, safe=0.80, rounded=True):
    """safe = fraction of canvas the envelope mark may occupy."""
    S = size * SS
    base = gradient(S // 4).resize((S, S), Image.BICUBIC).convert("RGBA")

    mark_w = S * safe * 0.78
    mark_h = mark_w * 0.66
    cx, cy = S / 2, S / 2 + S * 0.02
    x0, y0 = cx - mark_w / 2, cy - mark_h / 2
    x1, y1 = cx + mark_w / 2, cy + mark_h / 2
    rad = mark_w * 0.06

    # soft shadow
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([x0, y0 + S * 0.025, x1, y1 + S * 0.025], rad, fill=(150, 100, 90, 70))
    sh = sh.filter(ImageFilter.GaussianBlur(S * 0.03))
    base.alpha_composite(sh)

    d = ImageDraw.Draw(base)
    # letter peeking out
    lp = mark_w * 0.08
    d.rounded_rectangle([x0 + lp, y0 - mark_h * 0.22, x1 - lp, y0 + mark_h * 0.6], rad * 0.6, fill=(255, 253, 250))
    for i in range(3):
        ly = y0 - mark_h * 0.08 + i * mark_h * 0.12
        d.rounded_rectangle([x0 + lp * 2.2, ly, x1 - lp * 2.2 - (i == 2) * mark_w * 0.2, ly + S * 0.008], S * 0.004, fill=LINE)

    # envelope body
    d.rounded_rectangle([x0, y0, x1, y1], rad, fill=PAPER)
    # bottom folds
    d.polygon([(x0 + rad * 0.3, y1 - rad * 0.3), (cx, cy + mark_h * 0.02), (x1 - rad * 0.3, y1 - rad * 0.3)], fill=FLAP)
    d.line([(x0 + rad * 0.4, y1 - rad * 0.4), (cx, cy + mark_h * 0.02), (x1 - rad * 0.4, y1 - rad * 0.4)], fill=LINE, width=max(1, int(S * 0.006)))
    # top flap
    d.polygon([(x0 + rad * 0.2, y0 + rad * 0.2), (x1 - rad * 0.2, y0 + rad * 0.2), (cx, cy + mark_h * 0.12)], fill=(250, 238, 231))
    d.line([(x0 + rad * 0.3, y0 + rad * 0.3), (cx, cy + mark_h * 0.12), (x1 - rad * 0.3, y0 + rad * 0.3)], fill=LINE, width=max(1, int(S * 0.006)))

    # wax seal
    sr = mark_w * 0.14
    scy = cy + mark_h * 0.1
    seal_sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(seal_sh).ellipse([cx - sr, scy - sr + S * 0.01, cx + sr, scy + sr + S * 0.01], fill=(120, 60, 60, 90))
    base.alpha_composite(seal_sh.filter(ImageFilter.GaussianBlur(S * 0.012)))
    d = ImageDraw.Draw(base)
    d.ellipse([cx - sr, scy - sr, cx + sr, scy + sr], fill=ROSE)
    d.ellipse([cx - sr * 0.78, scy - sr * 0.78, cx + sr * 0.78, scy + sr * 0.78], outline=ROSE_DEEP, width=max(1, int(sr * 0.08)))
    heart(d, cx, scy - sr * 0.05, sr * 0.42, PAPER)

    img = base.resize((size, size), Image.LANCZOS)
    if rounded:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], S * 0.22, fill=255)
        img.putalpha(mask.resize((size, size), Image.LANCZOS))
    return img


def main():
    OUT.mkdir(exist_ok=True)
    for s in (192, 512):
        render(s, safe=0.86, rounded=True).save(OUT / f"icon-{s}.png", optimize=True)
        # maskable: full-bleed background, mark inside 80% safe zone
        render(s, safe=0.66, rounded=False).save(OUT / f"maskable-{s}.png", optimize=True)
    render(180, safe=0.80, rounded=False).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    render(64, safe=0.95, rounded=True).resize((32, 32), Image.LANCZOS).save(OUT / "favicon-32.png", optimize=True)
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
