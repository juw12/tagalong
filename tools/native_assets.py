"""Render the app icon and splash screens for the native builds from icon.svg.

python tools/native_assets.py   ->  native/assets/icon-only.png, splash.png, splash-dark.png
"""
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "native" / "assets"


def render_icon(size, rounded):
    svg = (ROOT / "icon.svg").read_text(encoding="utf-8")
    svg = svg.replace("<svg ", f'<svg width="{size}" height="{size}" ', 1)
    if not rounded:
        svg = svg.replace('rx="112"', 'rx="0"', 1)
    target = ASSETS / f"_icon_{size}_{int(rounded)}.png"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": size, "height": size})
        page.set_content(f"<html><body style='margin:0;background:transparent'>{svg}</body></html>")
        page.screenshot(path=str(target), omit_background=True)
        browser.close()
    image = Image.open(target).convert("RGBA")
    target.unlink()
    return image


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    # Square, full-bleed: iOS and Android apply their own corner masks.
    render_icon(1024, rounded=False).convert("RGB").save(ASSETS / "icon-only.png")
    badge = render_icon(640, rounded=True)
    for name, colour in (("splash.png", "#f5f0e6"), ("splash-dark.png", "#16140f")):
        splash = Image.new("RGBA", (2732, 2732), colour)
        splash.alpha_composite(badge, ((2732 - 640) // 2, (2732 - 640) // 2))
        splash.convert("RGB").save(ASSETS / name)
    print("wrote", sorted(path.name for path in ASSETS.iterdir()))


if __name__ == "__main__":
    main()
