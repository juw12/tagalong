"""Quick smoke run: serve the app, open the demo, save screenshots, print console errors."""
import functools
import http.server
import os
import socketserver
import sys
import threading
from pathlib import Path

for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
    os.environ.pop(key, None)
os.environ["NO_PROXY"] = "localhost,127.0.0.1"

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "hone" / "smoke"
SHOTS.mkdir(parents=True, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server.server_address[1]


def main():
    port = serve()
    base = f"http://localhost:{port}/"
    errors = []
    with sync_playwright() as play:
        browser = play.chromium.launch(args=["--proxy-bypass-list=127.0.0.1;localhost"])
        for width, height, theme in ((390, 844, "light"), (1280, 800, "light"), (390, 844, "dark")):
            context = browser.new_context(
                viewport={"width": width, "height": height},
                color_scheme=theme,
                service_workers="block",
            )
            page = context.new_page()
            page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
            page.on("pageerror", lambda error: errors.append("pageerror: " + str(error)))
            page.goto(base)
            page.wait_for_timeout(400)
            page.screenshot(path=str(SHOTS / f"empty-{width}-{theme}.png"), full_page=True)
            page.goto(base + "?demo=1")
            page.wait_for_timeout(500)
            page.screenshot(path=str(SHOTS / f"home-{width}-{theme}.png"), full_page=True)
            trip_href = page.eval_on_selector("a.tag", "el => el.getAttribute('href')")
            trip_base = trip_href.rsplit("/", 1)[0]
            for tab in ("plan", "ideas", "money", "group"):
                page.goto(base + "?demo=1" + trip_base + "/" + tab)
                page.wait_for_timeout(350)
                page.screenshot(path=str(SHOTS / f"{tab}-{width}-{theme}.png"), full_page=True)
            page.goto(base + "?demo=1#/passport")
            page.wait_for_timeout(350)
            page.screenshot(path=str(SHOTS / f"passport-{width}-{theme}.png"), full_page=True)
            print("done", width, theme, flush=True)
    print("ERRORS", len(errors), flush=True)
    for line in errors[:30]:
        print("  ", line, flush=True)
    sys.stdout.flush()
    os._exit(0)


main()
