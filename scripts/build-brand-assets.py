#!/usr/bin/env python3
"""Derives every shipped brand asset from the supplied rasters in assets/brand (read-only sources).
Run: python3 scripts/build-brand-assets.py   (needs Pillow, numpy, scipy; macOS `iconutil` for the .icns)
The supplied files are opaque RGB rasters (no alpha, no vector masters). Transparency here is DERIVED (background removal), not original."""
import os, subprocess, shutil, tempfile, json
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

B = 'assets/brand'; D = 'apps/desktop'; UI = f'{D}/src/renderer/shared/brand'; PUB = f'{D}/src/renderer/public'; BUILD = f'{D}/build'
SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
report = []
def save(im, path, **kw):
    os.makedirs(os.path.dirname(path), exist_ok=True); im.save(path, **kw)
    r = Image.open(path); a = r.mode in ('RGBA', 'LA') and r.getchannel('A').getextrema()[0] < 255
    report.append((path, r.size, r.format, 'alpha' if a else 'opaque', os.path.getsize(path)))
def load(p): return Image.open(f'{B}/{p}').convert('RGB')
def bg_of(im):
    a = np.asarray(im); h, w, _ = a.shape; k = 24
    return np.median(np.concatenate([a[:k, :k].reshape(-1, 3), a[:k, -k:].reshape(-1, 3), a[-k:, :k].reshape(-1, 3), a[-k:, -k:].reshape(-1, 3)]), axis=0)
def dist(im, bg): return np.abs(np.asarray(im).astype(float) - bg).max(axis=2)
def trim(im, pad=0.04, thr=8):
    a = np.asarray(im.getchannel('A')); ys, xs = np.where(a > thr); x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    p = int(max(x1 - x0, y1 - y0) * pad); return im.crop((max(0, x0 - p), max(0, y0 - p), min(im.width, x1 + p), min(im.height, y1 + p)))
def cutout_light(im, t0=5, t1=45):
    """White-ish background → alpha. Background = region connected to the border, so enclosed white shapes (the sparkle) stay opaque. Edge pixels are un-blended from the background colour."""
    bg = bg_of(im); d = dist(im, bg); lab, _ = ndi.label(d < t1); border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    outside = np.isin(lab, list(border)); alpha = np.where(outside, np.clip((d - t0) / (t1 - t0), 0, 1), 1.0)
    px = np.asarray(im).astype(float); a3 = np.maximum(alpha, 1e-3)[..., None]
    col = np.where((alpha[..., None] < 1) & (alpha[..., None] > 0), np.clip(bg + (px - bg) / a3, 0, 255), px)
    out = np.dstack([col, alpha * 255]).astype(np.uint8); return Image.fromarray(out, 'RGBA')
def cutout_dark(im, t0=6, t1=90):
    """Dark background (with glow) → soft alpha; colours kept, so the glow fades into whatever dark surface is behind it."""
    bg = bg_of(im); d = dist(im, bg); alpha = np.clip((d - t0) / (t1 - t0), 0, 1)
    out = np.dstack([np.asarray(im), alpha * 255]).astype(np.uint8); return Image.fromarray(out, 'RGBA')
def width(im, w): return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)

# ---- UI logos (aspect ratio preserved; transparent; trimmed to content)
sym = trim(cutout_light(load('logos/symbol.png')))
save(width(sym, 256), f'{UI}/symbol.png', optimize=True)
save(width(trim(cutout_light(load('logos/logo-primary.png'))), 640), f'{UI}/logo-on-light.png', optimize=True)
save(width(trim(cutout_dark(load('logos/logo-dark.png')), thr=110), 640), f'{UI}/logo-on-dark.png', optimize=True)
mono = load('logos/logo-monochrome.png'); mlum = np.asarray(mono.convert('L')).astype(float)
mono_rgba = Image.fromarray(np.dstack([np.zeros((*mlum.shape, 3)), np.clip((255 - mlum) / 255 * 1.08, 0, 1) * 255]).astype(np.uint8), 'RGBA')
save(width(trim(mono_rgba), 640), f'{UI}/logo-mono.png', optimize=True)

# ---- application icons (tile from the supplied per-platform icon art)
def tile(path, body):
    im = load(path); px = np.asarray(im).astype(float); lab, _ = ndi.label((px.min(axis=2) >= 135) | ((px.min(axis=2) >= 100) & (np.ptp(px, axis=2) < 52)))  # light bg or grey drop shadow
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    inside = ~np.isin(lab, list(border)); yy, xx = np.ogrid[-45:46, -45:46]; inside = ndi.binary_opening(ndi.binary_fill_holes(inside), structure=(xx * xx + yy * yy) <= 45 * 45)  # disc opening drops the thin baked drop-shadow band
    inside = ndi.binary_erosion(inside, iterations=2); alpha = ndi.gaussian_filter(inside.astype(float), 1.0)
    rgba = Image.fromarray(np.dstack([px, alpha * 255]).astype(np.uint8), 'RGBA'); rgba = rgba.crop(rgba.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox())
    s = round(1024 * body); rgba = rgba.resize((s, round(s * rgba.height / rgba.width)), Image.LANCZOS)
    canvas = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0)); canvas.paste(rgba, ((1024 - rgba.width) // 2, (1024 - rgba.height) // 2), rgba); return canvas
masters = {'macos': tile('icons/macos/icon-source.png', 0.82), 'windows': tile('icons/windows/icon-source.png', 0.94), 'linux': tile('icons/linux/icon-source.png', 0.94)}
mac, win, lin = masters['macos'], masters['windows'], masters['linux']
with tempfile.TemporaryDirectory() as t:
    iset = f'{t}/icon.iconset'; os.makedirs(iset)
    for n, px in [('16x16', 16), ('16x16@2x', 32), ('32x32', 32), ('32x32@2x', 64), ('128x128', 128), ('128x128@2x', 256), ('256x256', 256), ('256x256@2x', 512), ('512x512', 512), ('512x512@2x', 1024)]:
        mac.resize((px, px), Image.LANCZOS).save(f'{iset}/icon_{n}.png')
    subprocess.run(['iconutil', '-c', 'icns', iset, '-o', f'{BUILD}/icon.icns'], check=True)
report.append((f'{BUILD}/icon.icns', (1024, 1024), 'ICNS', 'alpha', os.path.getsize(f'{BUILD}/icon.icns')))
save(win.resize((256, 256), Image.LANCZOS), f'{BUILD}/icon.ico', sizes=[(s, s) for s in SIZES if s <= 256])
save(lin, f'{BUILD}/icon.png')  # 1024 master: electron-builder resizes for Linux
for s in SIZES: save(lin.resize((s, s), Image.LANCZOS), f'{BUILD}/icons/{s}x{s}.png', optimize=True)

# ---- tray: macOS template (black + alpha, from the monochrome lockup's symbol) and colour symbol for Windows/Linux
def square(im, px, pad=0.08):
    s = round(px * (1 - 2 * pad)); im = im.resize((s, round(s * im.height / im.width)), Image.LANCZOS) if im.width >= im.height else im.resize((round(s * im.width / im.height), s), Image.LANCZOS)
    c = Image.new('RGBA', (px, px), (0, 0, 0, 0)); c.paste(im, ((px - im.width) // 2, (px - im.height) // 2), im); return c
msym = mono_rgba.crop((190, 400, 480, 670)); msym = msym.crop(msym.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
for name, px in [('iconTemplate.png', 16), ('iconTemplate@2x.png', 32), ('iconTemplate@3x.png', 48)]: save(square(msym, px, 0.06), f'{BUILD}/tray/{name}')
for px in [16, 24, 32, 48, 64]: save(square(sym, px, 0.04), f'{BUILD}/tray/tray-color-{px}.png', optimize=True)

# ---- website favicon (renderer <link rel=icon>)
fav = square(sym, 256, 0.04); save(fav, f'{PUB}/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)]); save(square(sym, 180, 0.12), f'{PUB}/apple-touch-icon.png', optimize=True)

# ---- splash (B10): artwork only; startup lifecycle shows it in a 16:9 window, no artificial delay
save(load('splash/splash-screen.png').resize((1408, 792), Image.LANCZOS), f'{PUB}/splash.webp', quality=90, method=6)

# ---- empty-state illustrations (B17): artwork cropped from each card, headings/helper text excluded (rendered as HTML in the UI)
es = load('illustrations/empty-states.png')
for name, box in {'skills': (48, 84, 697, 392), 'mcp': (752, 84, 1400, 392), 'plugins': (48, 564, 697, 880), 'workflows': (752, 564, 1400, 880)}.items():
    save(es.crop(box), f'{UI}/empty-{name}.webp', quality=92, method=6)

# ---- README banner (B12)
save(load('social/github-banner.png').resize((1400, 700), Image.LANCZOS), 'docs/assets/github-banner.png', optimize=True)

# preview sheet for review
sheet = Image.new('RGB', (1500, 420), (128, 128, 128))
for i, m in enumerate([mac, win, lin]): bg = Image.new('RGBA', (400, 400), (200, 200, 200, 255)); bg.alpha_composite(m.resize((400, 400), Image.LANCZOS)); sheet.paste(bg.convert('RGB'), (10 + i * 410, 10))
sheet.save('/tmp/icon-sheet.png')
json.dump([[p, list(s), f, a, b] for p, s, f, a, b in report], open('/tmp/brand-report.json', 'w'))
for r in report: print(f'{r[0]:70s} {r[1][0]}x{r[1][1]:<5} {r[2]:5s} {r[3]:6s} {r[4]:>8}')
