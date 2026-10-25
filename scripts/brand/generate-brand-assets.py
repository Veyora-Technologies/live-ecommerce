#!/usr/bin/env python3
"""Generate the Furnivo brand assets (SVG sources + rasterised PNG exports).

Why a script instead of hand-edited SVGs: the wordmark must be real vector
outlines, not <text>, so the logo renders identically on every device and in the
social-sharing card regardless of installed fonts. This converts the Geist
typeface (shipped inside Next.js) into paths and writes every variant from one
source of truth, so the mark, the wordmark and the icons can never drift apart.

Requirements (build-time only, nothing is added to package.json):
    pip install pillow fonttools

Usage:
    python3 scripts/brand/generate-brand-assets.py [--font /path/to/Geist.ttf]

Font resolution order:
    1. --font argument
    2. FURNIVO_BRAND_FONT environment variable
    3. Geist bundled with Next.js (node_modules/next/dist/compiled/@vercel/og)
    4. DejaVu Sans (system)

Outputs are committed to the repository, so a normal build never runs this.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

try:
    from fontTools.pens.basePen import BasePen
    from fontTools.ttLib import TTFont
except ImportError:  # pragma: no cover - developer-facing message only
    sys.exit("fontTools is required: pip install fonttools")

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install pillow")

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"
BRAND = PUBLIC / "brand"

# ---------------------------------------------------------------------------
# Brand palette (from the Furnivo identity board)
# ---------------------------------------------------------------------------
PURPLE = "#6C3BFF"       # Royal Purple   - gradient start
ORANGE = "#FF8A00"       # Sun Orange     - gradient end
CHARCOAL = "#0B0F14"     # Deep Charcoal  - ink and icon background
CLOUD = "#F5F7FA"        # Cloud White    - reverse wordmark
PURPLE_DEEP = "#4B22CC"  # inner mark tone on light surfaces
PURPLE_LIGHT = "#C9B6FF"  # inner mark tone on dark surfaces
ORANGE_LIGHT = "#FFB566"

GRADIENT_ID = "furnivo-mark-gradient"

# Mark geometry, unchanged from the previous identity: a bag silhouette plus an
# inner leaf. Only the colours move to the Furnivo palette, so the mark keeps the
# silhouette customers already recognise.
MARK_BODY = (
    "M31.2 9.5c-12.2 0-22 9.8-22 22v34.2c0 16 13 29 29 29h5.2c11.6 0 22.7-4.8 "
    "30.6-13.3l9.5-10.2H48.2c-8.4 0-13.1-4.8-13.1-13.2V31.5c0-12.2-1.4-22-3.9-22Z"
)
MARK_LEAF = (
    "M47.2 36.1c0-7 7.9-11.1 13.7-7.2l23.6 16.3c5.2 3.6 5.2 11.2 0 14.8L60.9 76.3"
    "c-5.8 4-13.7-.2-13.7-7.2V36.1Z"
)


# ---------------------------------------------------------------------------
# Wordmark: Geist outlines -> a single SVG path
# ---------------------------------------------------------------------------
def _fmt(pt) -> str:
    return f"{pt[0]:.2f} {pt[1]:.2f}"


def _quad_to_cubic(p0, p1, p2) -> tuple:
    """Convert a quadratic control/end pair into a cubic control pair."""
    c1 = (p0[0] + 2 / 3 * (p1[0] - p0[0]), p0[1] + 2 / 3 * (p1[1] - p0[1]))
    c2 = (p2[0] + 2 / 3 * (p1[0] - p2[0]), p2[1] + 2 / 3 * (p1[1] - p2[1]))
    return c1, c2


def build_wordmark(font_path: Path, text: str, cap_height: float, baseline: float,
                   start_x: float, tracking: float) -> tuple[str, float]:
    """Return (path_data, total_width) for `text` as outlined SVG paths.

    Quadratic and composite glyphs are decomposed by fontTools so the output is
    plain absolute M/L/C/Q/Z commands that any SVG renderer (and the rasteriser
    below) can consume.
    """
    from fontTools.pens.recordingPen import DecomposingRecordingPen

    font = TTFont(str(font_path))
    upm = font["head"].unitsPerEm
    cap = getattr(font["OS/2"], "sCapHeight", None) or int(upm * 0.7)
    scale = cap_height / cap
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    hmtx = font["hmtx"]

    def transform(pt):
        # Font space is y-up with the origin on the baseline; SVG is y-down.
        return (start_x + x + pt[0] * scale, baseline - pt[1] * scale)

    parts: list[str] = []
    x = 0.0
    for char in text:
        glyph_name = cmap[ord(char)]
        rec = DecomposingRecordingPen(glyph_set)
        glyph_set[glyph_name].draw(rec)
        current = (0.0, 0.0)
        for op, args in rec.value:
            if op == "moveTo":
                current = transform(args[0])
                parts.append(f"M{_fmt(current)}")
            elif op == "lineTo":
                current = transform(args[0])
                parts.append(f"L{_fmt(current)}")
            elif op == "curveTo":
                pts = [transform(p) for p in args]
                current = pts[-1]
                parts.append(f"C{_fmt(pts[0])} {_fmt(pts[1])} {_fmt(pts[2])}")
            elif op == "qCurveTo":
                pts = list(args)
                # TrueType may omit the on-curve point; the implied on-curve
                # points are the midpoints between consecutive controls.
                offs = [p for p in pts if p is not None]
                end = pts[-1]
                if end is None:
                    offs = offs[:-1]
                    end = ((offs[0][0] + offs[-1][0]) / 2, (offs[0][1] + offs[-1][1]) / 2)
                for i, ctrl in enumerate(offs):
                    seg_end = end if i == len(offs) - 1 else (
                        (ctrl[0] + offs[i + 1][0]) / 2,
                        (ctrl[1] + offs[i + 1][1]) / 2,
                    )
                    c1, c2 = _quad_to_cubic(current, transform(ctrl), transform(seg_end))
                    parts.append(f"C{_fmt(c1)} {_fmt(c2)} {_fmt(transform(seg_end))}")
                    current = transform(seg_end)
            elif op in ("closePath", "endPath"):
                parts.append("Z")
        x += hmtx[glyph_name][0] * scale + tracking

    width = x - tracking
    font.close()
    return "".join(parts), width


# ---------------------------------------------------------------------------
# SVG builders
# ---------------------------------------------------------------------------
def gradient_defs(x1=0, y1=0, x2=1, y2=1) -> str:
    return (
        f'  <defs><linearGradient id="{GRADIENT_ID}" x1="{x1}" y1="{y1}" '
        f'x2="{x2}" y2="{y2}"><stop offset="0" stop-color="{PURPLE}"/>'
        f'<stop offset="1" stop-color="{ORANGE}"/></linearGradient></defs>'
    )


def mark_group(x: float, y: float, scale: float, body: str, leaf: str) -> str:
    return (
        f'  <g transform="translate({x} {y}) scale({scale})">\n'
        f'    <path d="{MARK_BODY}" fill="{body}"/>\n'
        f'    <path d="{MARK_LEAF}" fill="{leaf}"/>\n'
        f"  </g>"
    )


def wordmark_path(d: str, fill: str, stroke: float) -> str:
    return (
        f'  <path d="{d}" fill="{fill}" stroke="{fill}" stroke-width="{stroke}" '
        f'stroke-linejoin="round" stroke-linecap="round"/>'
    )


def svg(view_box: str, title: str, body: list[str], extra: str = "") -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}" role="img" '
        f'aria-labelledby="title"{extra}>\n'
        f'  <title id="title">{title}</title>\n' + "\n".join(body) + "\n</svg>\n"
    )


# ---------------------------------------------------------------------------
# Rasteriser (Pillow): even-odd polygon fill + linear gradient + supersampling
# ---------------------------------------------------------------------------
def parse_path(d: str, samples: int = 16) -> list[list[tuple[float, float]]]:
    """Flatten an SVG path into polygon subpaths.

    Supports both absolute (M L H V C Q Z) and relative (m l h v c q z) commands,
    because the mark geometry is written with relative curves. Curves are sampled
    so the raster export matches the SVG closely enough at icon sizes.
    """
    import re

    tokens = re.findall(r"[MLHVCQZmlhvcqz]|-?\d*\.?\d+", d)
    subpaths: list[list[tuple[float, float]]] = []
    current: list[tuple[float, float]] = []
    x = y = start_x = start_y = 0.0
    i = 0

    def num() -> float:
        nonlocal i
        value = float(tokens[i])
        i += 1
        return value

    while i < len(tokens):
        cmd = tokens[i]
        i += 1
        rel = cmd.islower()
        up = cmd.upper()

        if up == "M":
            if current:
                subpaths.append(current)
            dx, dy = num(), num()
            x, y = (x + dx, y + dy) if rel else (dx, dy)
            start_x, start_y = x, y
            current = [(x, y)]
        elif up == "L":
            dx, dy = num(), num()
            x, y = (x + dx, y + dy) if rel else (dx, dy)
            current.append((x, y))
        elif up == "H":
            v = num()
            x = x + v if rel else v
            current.append((x, y))
        elif up == "V":
            v = num()
            y = y + v if rel else v
            current.append((x, y))
        elif up == "C":
            pts = [(num(), num()) for _ in range(3)]
            if rel:
                pts = [(x + px, y + py) for px, py in pts]
            (x1, y1), (x2, y2), (x3, y3) = pts
            x0, y0 = current[-1]
            for s_i in range(1, samples + 1):
                t = s_i / samples
                mt = 1 - t
                current.append((
                    mt**3 * x0 + 3 * mt**2 * t * x1 + 3 * mt * t**2 * x2 + t**3 * x3,
                    mt**3 * y0 + 3 * mt**2 * t * y1 + 3 * mt * t**2 * y2 + t**3 * y3,
                ))
            x, y = x3, y3
        elif up == "Q":
            pts = [(num(), num()) for _ in range(2)]
            if rel:
                pts = [(x + px, y + py) for px, py in pts]
            (x1, y1), (x2, y2) = pts
            x0, y0 = current[-1]
            for s_i in range(1, samples + 1):
                t = s_i / samples
                mt = 1 - t
                current.append((
                    mt**2 * x0 + 2 * mt * t * x1 + t**2 * x2,
                    mt**2 * y0 + 2 * mt * t * y1 + t**2 * y2,
                ))
            x, y = x2, y2
        elif up == "Z":
            if current:
                current.append((start_x, start_y))
                subpaths.append(current)
                current = []
            x, y = start_x, start_y
    if current:
        subpaths.append(current)
    return subpaths


def fill_mask(size: tuple[int, int], subpaths, scale: float, offset, supersample: int = 3) -> Image.Image:
    """Even-odd filled mask; XOR of subpaths reproduces TrueType counters."""
    w, h = size
    big = (int(w * supersample), int(h * supersample))
    mask = Image.new("1", big, 0)
    ox, oy = offset
    for sub in subpaths:
        if len(sub) < 3:
            continue
        layer = Image.new("1", big, 0)
        ImageDraw.Draw(layer).polygon(
            [((px * scale + ox) * supersample, (py * scale + oy) * supersample) for px, py in sub],
            fill=1,
        )
        mask = ImageChops.logical_xor(mask, layer)
    return mask.convert("L").resize((w, h), Image.LANCZOS)


def linear_gradient(size: tuple[int, int], start: str, end: str, vertical: bool,
                    box: tuple[float, float, float, float] | None = None) -> Image.Image:
    """Bilinear ramp; optionally confined to a box so it spans the mark, not the canvas.

    Direction follows the identity board: start colour at the top, end colour at
    the bottom for vertical ramps, left-to-right for horizontal ones.
    """
    seed = Image.new("RGB", (2, 2))
    seed.putpixel((0, 0), _rgb(start))
    seed.putpixel((1, 0), _rgb(end))
    seed.putpixel((0, 1), _rgb(start))
    seed.putpixel((1, 1), _rgb(end))
    if vertical:
        # Start colour at the TOP (purple), end colour at the BOTTOM (orange),
        # matching the identity board's mark.
        seed = Image.new("RGB", (2, 2))
        seed.putpixel((0, 0), _rgb(start))
        seed.putpixel((1, 0), _rgb(start))
        seed.putpixel((0, 1), _rgb(end))
        seed.putpixel((1, 1), _rgb(end))
    if box is None:
        return seed.resize(size, Image.BICUBIC)

    x0, y0, x1, y1 = (int(round(v)) for v in box)
    bw = max(1, x1 - x0)
    bh = max(1, y1 - y0)
    patch = seed.resize((bw, bh), Image.BICUBIC)
    canvas = Image.new("RGB", size, _rgb(end))
    canvas.paste(patch, (x0, y0))
    return canvas


def bbox_of(subpaths) -> tuple[float, float, float, float]:
    xs = [pt[0] for sub in subpaths for pt in sub]
    ys = [pt[1] for sub in subpaths for pt in sub]
    return min(xs), min(ys), max(xs), max(ys)


def paint(img: Image.Image, subpaths, fill, vertical: bool = True) -> None:
    """Composite a fill (hex or ('grad', start, end)) through an even-odd mask."""
    mask = fill_mask(img.size, subpaths, 1.0, (0, 0))
    if isinstance(fill, tuple):
        _, a, b = fill
        patch = linear_gradient(img.size, a, b, vertical, box=bbox_of(subpaths))
    else:
        patch = Image.new("RGB", img.size, _rgb(fill))
    img.paste(patch, (0, 0), mask)


def _rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", default=None, help="TTF/OTF used for the wordmark")
    args = ap.parse_args()

    candidates = [
        args.font,
        os.environ.get("FURNIVO_BRAND_FONT"),
        str(ROOT / "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    font_path = next((Path(c) for c in candidates if c and Path(c).exists()), None)
    if not font_path:
        sys.exit("No font found. Pass --font /path/to/font.ttf")
    print(f"wordmark font: {font_path}")

    BRAND.mkdir(parents=True, exist_ok=True)

    # ---- wordmark -----------------------------------------------------------
    # Cap height 52 within a 100-unit tall canvas, baseline at y=76.
    word, word_width = build_wordmark(font_path, "Furnivo", 52, 76, 0, -1.1)
    stroke = 1.5

    # ---- symbol SVGs --------------------------------------------------------
    symbol_variants = {
        "live-symbol.svg": (f"url(#{GRADIENT_ID})", PURPLE_DEEP, True),
        "live-symbol-inverse.svg": (f"url(#{GRADIENT_ID})", PURPLE_LIGHT, True),
        "live-symbol-mono.svg": (CHARCOAL, CHARCOAL, False),
    }
    for name, (body, leaf, needs_gradient) in symbol_variants.items():
        parts = ([gradient_defs()] if needs_gradient else []) + [
            mark_group(0, 0, 1.0, body, leaf)
        ]
        (BRAND / name).write_text(svg("0 0 100 100", "Furnivo symbol", parts))

    # ---- horizontal / compact / wordmark -----------------------------------
    H_WORD_X = 92.0
    H_WIDTH = round(H_WORD_X + word_width + 10)
    horizontal_body = [
        gradient_defs(),
        mark_group(8, 18, 0.66, f"url(#{GRADIENT_ID})", PURPLE_DEEP),
        wordmark_path(
            build_wordmark(font_path, "Furnivo", 42, 74, H_WORD_X, -1.0)[0], CHARCOAL, stroke
        ),
    ]
    (BRAND / "live-logo-horizontal.svg").write_text(
        svg(f"0 0 {H_WIDTH} 100", "Furnivo", horizontal_body)
    )

    inverse_body = [
        gradient_defs(),
        mark_group(8, 18, 0.66, f"url(#{GRADIENT_ID})", PURPLE_LIGHT),
        wordmark_path(
            build_wordmark(font_path, "Furnivo", 42, 74, H_WORD_X, -1.0)[0], CLOUD, stroke
        ),
    ]
    (BRAND / "live-logo-horizontal-inverse.svg").write_text(
        svg(f"0 0 {H_WIDTH} 100", "Furnivo", inverse_body)
    )

    mono_body = mark_group(8, 18, 0.66, CHARCOAL, CHARCOAL) + "\n" + wordmark_path(
        build_wordmark(font_path, "Furnivo", 42, 74, H_WORD_X, -1.0)[0], CHARCOAL, stroke
    )
    (BRAND / "live-logo-horizontal-mono.svg").write_text(
        svg(f"0 0 {H_WIDTH} 100", "Furnivo monochrome logo", [mono_body])
    )

    mono_inv_body = mark_group(8, 18, 0.66, "#FFFFFF", "#FFFFFF") + "\n" + wordmark_path(
        build_wordmark(font_path, "Furnivo", 42, 74, H_WORD_X, -1.0)[0], "#FFFFFF", stroke
    )
    (BRAND / "live-logo-horizontal-mono-inverse.svg").write_text(
        svg(f"0 0 {H_WIDTH} 100", "Furnivo monochrome inverse logo", [mono_inv_body])
    )

    C_WORD_X = 78.0
    c_word, c_width = build_wordmark(font_path, "Furnivo", 36, 72, C_WORD_X, -0.9)
    C_WIDTH = round(C_WORD_X + c_width + 8)
    for name, ink, leaf, needs_gradient in (
        ("live-logo-horizontal-compact.svg", CHARCOAL, PURPLE_DEEP, True),
        ("live-logo-horizontal-compact-inverse.svg", CLOUD, PURPLE_LIGHT, True),
    ):
        body = ([gradient_defs()] if needs_gradient else []) + [
            mark_group(6, 22, 0.56, f"url(#{GRADIENT_ID})", leaf),
            wordmark_path(c_word, ink, stroke),
        ]
        (BRAND / name).write_text(svg(f"0 0 {C_WIDTH} 100", "Furnivo compact logo", body))

    (BRAND / "live-wordmark.svg").write_text(
        svg(
            f"0 0 {round(word_width + 4)} 100",
            "Furnivo wordmark",
            [wordmark_path(word, CHARCOAL, stroke)],
            extra=' ',
        ).replace(' viewBox="0 0', ' viewBox="0 0')
    )
    # The standalone wordmark needs its own coordinate origin for tight cropping.
    word_crop, word_crop_width = build_wordmark(font_path, "Furnivo", 52, 76, 4, -1.1)
    (BRAND / "live-wordmark.svg").write_text(
        svg(f"0 0 {round(word_crop_width + 12)} 100", "Furnivo wordmark",
            [wordmark_path(word_crop, CHARCOAL, stroke)])
    )

    # ---- app icons ----------------------------------------------------------
    (BRAND / "live-app-icon.svg").write_text(
        svg("0 0 512 512", "Furnivo app icon", [
            gradient_defs(),
            f'  <rect width="512" height="512" rx="112" fill="{CHARCOAL}"/>',
            mark_group(82, 82, 3.48, f"url(#{GRADIENT_ID})", ORANGE_LIGHT)
            .replace(f'<path d="{MARK_LEAF}"', f'<path d="{MARK_LEAF}" stroke="{CHARCOAL}" stroke-width="1.4"'),
        ])
    )
    (BRAND / "live-app-icon-light.svg").write_text(
        svg("0 0 512 512", "Furnivo app icon (light)", [
            gradient_defs(),
            f'  <rect width="512" height="512" rx="112" fill="{CLOUD}"/>',
            mark_group(82, 82, 3.48, f"url(#{GRADIENT_ID})", PURPLE_DEEP),
        ])
    )
    (BRAND / "live-app-icon-maskable.svg").write_text(
        svg("0 0 512 512", "Furnivo maskable app icon", [
            gradient_defs(),
            f'  <rect width="512" height="512" fill="{CHARCOAL}"/>',
            mark_group(93, 93, 3.26, f"url(#{GRADIENT_ID})", ORANGE_LIGHT)
            .replace(f'<path d="{MARK_LEAF}"', f'<path d="{MARK_LEAF}" stroke="{CHARCOAL}" stroke-width="1.4"'),
        ])
    )
    for path, rx, leaf in ((PUBLIC / "favicon.svg", 24, PURPLE_LIGHT), (PUBLIC / "icon.svg", 24, PURPLE_LIGHT)):
        path.write_text(svg("0 0 100 100", "Furnivo", [
            gradient_defs(),
            f'  <rect width="100" height="100" rx="{rx}" fill="{CHARCOAL}"/>',
            mark_group(0, 0, 1.0, f"url(#{GRADIENT_ID})", leaf),
        ]))

    print("SVG assets written")

    # ---- social card --------------------------------------------------------
    render_social_card(font_path)

    # ---- PNG exports --------------------------------------------------------
    render_icons()


def render_social_card(font_path: Path) -> None:
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), _rgb(CHARCOAL))

    # Subtle brand wash: soft purple-to-orange veil at low opacity so the card
    # reads as Furnivo on dark surfaces without hurting text contrast.
    veil = linear_gradient((W, H), PURPLE, ORANGE, vertical=False)
    alpha = Image.linear_gradient("L").resize((W, H)).transpose(Image.FLIP_LEFT_RIGHT)
    alpha = alpha.point(lambda v: int(v * 0.16))
    img.paste(veil, (0, 0), alpha)

    # Mark: the gradient spans the mark's own bounding box, not the canvas.
    scale, ox, oy = 3.1, 96, 96

    def place(subpaths):
        return [[(x * scale + ox, y * scale + oy) for x, y in sub] for sub in subpaths]

    paint(img, place(parse_path(MARK_BODY)), ("grad", PURPLE, ORANGE), vertical=True)
    paint(img, place(parse_path(MARK_LEAF)), ORANGE_LIGHT)

    # Wordmark, thickened slightly so it holds up at card-preview sizes.
    from PIL import ImageFilter
    path_d, _width = build_wordmark(font_path, "Furnivo", 132, 400, 430, -2.4)
    mask = fill_mask((W, H), parse_path(path_d), 1.0, (0, 0))
    thick = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MaxFilter(5))
    img.paste(Image.new("RGB", (W, H), _rgb(CLOUD)), (0, 0), thick)

    draw = ImageDraw.Draw(img)
    tag_font = ImageFont.truetype(str(font_path), 40)
    small_font = ImageFont.truetype(str(font_path), 30)
    draw.text((430, 452), "Shop  \u00b7  Sell  \u00b7  Grow", font=tag_font, fill=_rgb(ORANGE))
    draw.text((430, 512), "More than a marketplace. It's your next move.",
              font=small_font, fill=(170, 178, 190))

    img.save(BRAND / "live-social-card.png", optimize=True)
    print("social card rendered")

    # Matching SVG source. The PNG above is the exact export used by the
    # Open Graph / Twitter card, so a missing font can never break sharing.
    word_for_svg = build_wordmark(font_path, "Furnivo", 1000, 0, 0, -18)[0]
    (BRAND / "live-social-card.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" role="img" aria-labelledby="title">\n'
        '  <title id="title">Furnivo \u2014 Shop, Sell, Grow</title>\n'
        + gradient_defs() + "\n"
        + f'  <rect width="1200" height="630" fill="{CHARCOAL}"/>\n'
        + f'  <rect width="1200" height="630" fill="url(#{GRADIENT_ID})" opacity="0.12"/>\n'
        + '  <g transform="translate(96 96) scale(3.1)">\n'
        + f'    <path d="{MARK_BODY}" fill="url(#{GRADIENT_ID})"/>\n'
        + f'    <path d="{MARK_LEAF}" fill="{ORANGE_LIGHT}"/>\n'
        + "  </g>\n"
        + '  <g transform="translate(430 400) scale(0.132)">\n'
        + f'    <path d="{word_for_svg}" fill="{CLOUD}" stroke="{CLOUD}" stroke-width="11" stroke-linejoin="round"/>\n'
        + "  </g>\n"
        + f'  <text x="430" y="492" fill="{ORANGE}" font-family="Geist, Inter, Segoe UI, Arial, Helvetica, sans-serif" font-size="40">Shop  \u00b7  Sell  \u00b7  Grow</text>\n'
        + '  <text x="430" y="542" fill="#AAB2BE" font-family="Geist, Inter, Segoe UI, Arial, Helvetica, sans-serif" font-size="30">More than a marketplace. It&apos;s your next move.</text>\n'
        + "</svg>\n"
    )


def render_icons() -> None:
    """PNG/ICO exports. The mark is drawn from the same paths as the SVGs."""

    def placed(size: int, padding: float):
        inner = size * (1 - padding * 2)
        scale = inner / 100
        ox, oy = size * padding, size * padding * 0.94

        def place(subpaths):
            return [[(x * scale + ox, y * scale + oy) for x, y in sub] for sub in subpaths]

        return place(parse_path(MARK_BODY)), place(parse_path(MARK_LEAF))

    def draw_mark(img: Image.Image, size: int, padding: float) -> None:
        from PIL import ImageFilter
        body, leaf = placed(size, padding)
        paint(img, body, ("grad", PURPLE, ORANGE), vertical=True)
        # Even separation: paint a dilated leaf silhouette in charcoal, then the
        # leaf itself on top, so it stays legible where the gradient ends orange.
        leaf_mask = fill_mask(img.size, leaf, 1.0, (0, 0))
        ring = leaf_mask.filter(ImageFilter.MaxFilter(max(3, (size // 120) * 2 + 1)))
        img.paste(Image.new("RGB", img.size, _rgb(CHARCOAL)), (0, 0), ring)
        paint(img, leaf, ORANGE_LIGHT)

    def rounded(size: int, radius_ratio: float = 0.22, padding: float = 0.16) -> Image.Image:
        art = Image.new("RGB", (size, size), _rgb(CHARCOAL))
        draw_mark(art, size, padding)
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255
        )
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(art, (0, 0), mask)
        return out

    def square(size: int, padding: float = 0.18) -> Image.Image:
        img = Image.new("RGB", (size, size), _rgb(CHARCOAL))
        draw_mark(img, size, padding)
        return img

    rounded(192).save(PUBLIC / "icon-192.png", optimize=True)
    rounded(512).save(PUBLIC / "icon-512.png", optimize=True)
    rounded(32, padding=0.12).save(PUBLIC / "icon-32.png", optimize=True)
    rounded(180, padding=0.14).save(PUBLIC / "apple-touch-icon.png", optimize=True)
    square(192).save(PUBLIC / "icon-maskable-192.png", optimize=True)
    square(512).save(PUBLIC / "icon-maskable-512.png", optimize=True)
    rounded(64, radius_ratio=0.24).save(
        PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)]
    )
    print("PNG/ICO assets written")


if __name__ == "__main__":
    main()
