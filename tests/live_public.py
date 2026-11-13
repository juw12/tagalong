"""Live sync over the real public relays (broker.emqx.io and broker.hivemq.com), two separate browsers.

python tests/live_public.py [--base <url>] [--proxy http://host:port]
Needs internet. Reports how many relays each browser reached and how long a change took to arrive.
"""
import argparse
import functools
import http.server
import socketserver
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--base", default="")
parser.add_argument("--proxy", default="")
ARGS = parser.parse_args()


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://localhost:{server.server_address[1]}/"


def relays_up(page):
    return page.evaluate("() => { const el = document.querySelector('.panel b[data-live-status]'); return el ? el.parentElement.textContent : ''; }")


def main():
    base = ARGS.base or serve()
    if not base.endswith("/"):
        base += "/"
    launch = {"proxy": {"server": ARGS.proxy, "bypass": "localhost,127.0.0.1"}} if ARGS.proxy else {}
    ok = True
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**launch)
        alice = browser.new_context().new_page()
        bob = browser.new_context().new_page()
        alice.goto(base + "?demo=1")
        alice.locator(".tags .tag").first.click()
        trip = alice.url.split("#")[1].rsplit("/", 1)[0]
        alice.goto(base + "?demo=1#" + trip + "/group")
        alice.locator('[data-act="live-on"]').click()
        try:
            alice.wait_for_function("() => /relays/.test(document.querySelector('.group-grid').innerText) && /\\b[12] of 2 relays/.test(document.querySelector('.group-grid').innerText)", timeout=30000)
        except Exception:
            pass
        print("alice:", relays_up(alice))
        alice.locator('.trip-head [data-act="invite"]').click()
        invite = alice.locator("#invite-link").input_value()
        alice.locator('#sheet [data-act="close"]').click()
        bob.goto(invite)
        bob.wait_for_selector("#sheet[open]")
        bob.locator('#sheet input[type="radio"]').nth(1).check()
        bob.locator("#sheet .btn.primary").click()
        bob.goto(base + "#" + trip + "/group")
        time.sleep(4)
        print("bob:  ", relays_up(bob))
        bob.goto(base + "#" + trip + "/ideas")
        marker = "Public relay test " + str(int(time.time()))
        bob.fill('form[data-form="quick-idea"] input', marker)
        start = time.time()
        bob.locator('form[data-form="quick-idea"] button').click()
        alice.goto(base + "#" + trip + "/ideas")
        try:
            alice.wait_for_function(f"() => document.body.innerText.includes({marker!r})", timeout=30000)
            print(f"change arrived over the public relays in {time.time() - start:.1f} s")
        except Exception:
            ok = False
            print("change did NOT arrive within 30 s")
        browser.close()
    print("PUBLIC LIVE SYNC", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
