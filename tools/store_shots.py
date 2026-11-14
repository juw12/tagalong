"""Microsoft Store listing screenshots for Tagalong.

Usage:
  python tools/store_shots.py            writes docs/store/*.png (2732x1536, sample trips)

The Store wants desktop screenshots of 1366x768 or larger, PNG, under 50 MB each.
Set TAGALONG_BROWSER to a Chromium executable when the bundled Playwright browser is missing.
"""
import functools
import http.server
import os
import socketserver
import threading
from pathlib import Path

for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
    os.environ.pop(key, None)
os.environ["NO_PROXY"] = "localhost,127.0.0.1"

from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "store"
WIDTH, HEIGHT, SCALE = 1366, 768, 2  # a 1366x768 window drawn at 2x, so the page fills the picture
VIEWS = [
    ("01-trips", "", "a.tag"),
    ("02-plan", "/plan", "section.tab-plan"),
    ("03-ideas", "/ideas", "section.tab-ideas"),
    ("04-places", "/places", "section.tab-places"),
    ("05-money", "/money", "section.tab-money"),
    ("06-group", "/group", "section.tab-group"),
]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://localhost:{server.server_address[1]}/"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    base = serve()
    launch = {}
    if os.environ.get("TAGALONG_BROWSER"):
        launch["executable_path"] = os.environ["TAGALONG_BROWSER"]
    with sync_playwright() as play:
        browser = play.chromium.launch(**launch)
        context = browser.new_context(
            viewport={"width": WIDTH, "height": HEIGHT},
            device_scale_factor=SCALE,
            color_scheme="light",
            service_workers="block",
        )
        page = context.new_page()
        page.set_default_timeout(30000)
        page.goto(base + "?demo=1")
        page.wait_for_selector("a.tag")
        trip = page.eval_on_selector("a.tag", "el => el.getAttribute('href')").rsplit("/", 1)[0]
        for name, tab, selector in VIEWS:
            page.goto(base + "?demo=1" + (trip + tab if tab else ""))
            page.wait_for_selector(selector)
            page.wait_for_timeout(600)
            target = OUT / f"{name}.png"
            page.screenshot(path=str(target))
            print(f"{target.name} {target.stat().st_size} bytes", flush=True)
        browser.close()


if __name__ == "__main__":
    main()
