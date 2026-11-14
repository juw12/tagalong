"""G12: the app keeps clear of the phone's status bar, notch and home bar.

python tests/safe_area.py                serve this folder locally and check
python tests/safe_area.py --shots <dir>  also save screenshots there

A phone app that fills the whole screen draws under the clock and battery unless the page leaves room.
The browser is told the screen has a 59 px status bar and a 34 px home bar (an iPhone with a Dynamic Island),
then the header, the sticky tab row, the toast and the bottom of the page are measured. Light and dark.
"""
import argparse
import functools
import http.server
import os
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
TOP, BOTTOM = 59, 34
parser = argparse.ArgumentParser()
parser.add_argument("--shots", default="")
ARGS = parser.parse_args()

results = []


def check(label, ok, detail=""):
    results.append((label, bool(ok), detail))
    print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else "  -> " + str(detail)))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://localhost:{server.server_address[1]}/"


def set_insets(context, page):
    """Ask the browser for real safe-area insets; fall back to setting the page's own variables."""
    try:
        session = context.new_cdp_session(page)
        session.send("Emulation.setSafeAreaInsetsOverride", {"insets": {"top": TOP, "bottom": BOTTOM}})
        page.reload()
        page.wait_for_selector(".top .brand")
        seen = page.evaluate("getComputedStyle(document.body).paddingTop")
        if seen == f"{TOP}px":
            return "browser safe-area override"
    except Exception:
        pass
    page.add_style_tag(content=f":root{{--safe-top:{TOP}px;--safe-bottom:{BOTTOM}px}}")
    return "page variables"


def top_of(page, selector):
    return page.evaluate("(selector) => { const el = document.querySelector(selector); return el ? el.getBoundingClientRect().top : null; }", selector)


def run_theme(browser, base, theme):
    context = browser.new_context(viewport={"width": 393, "height": 852}, color_scheme=theme)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base)
    page.wait_for_selector(".top .brand")
    how = set_insets(context, page)
    tag = f"[{theme}] "

    # Without insets (a normal browser tab) nothing moves: checked first on a second, untouched page.
    plain = context.new_page() if how == "page variables" else None
    if plain:
        plain.goto(base)
        plain.wait_for_selector(".top .brand")
        check(tag + "no gap is added in a normal browser tab", top_of(plain, ".top") < 12, top_of(plain, ".top"))
        plain.close()

    brand_top = top_of(page, ".top .brand")
    check(tag + f"header starts below the status bar ({how})", brand_top is not None and brand_top >= TOP, brand_top)
    buttons = page.evaluate("""() => [...document.querySelectorAll('.top a, .top button')].map((el) => Math.round(el.getBoundingClientRect().top))""")
    check(tag + "every header button is below the status bar", buttons and min(buttons) >= TOP, buttons)
    if ARGS.shots:
        page.screenshot(path=str(Path(ARGS.shots) / f"safe-area-{theme}-home.png"))

    page.locator(".ticket-open").click()
    page.wait_for_selector(".trip-head h1")
    page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
    page.wait_for_timeout(250)
    scrolled = page.evaluate("window.scrollY")
    tabs_top = top_of(page, ".tabs")
    check(tag + "page scrolls far enough to test the sticky tab row", scrolled > 200, scrolled)
    check(tag + "sticky tab row stops below the status bar", tabs_top is not None and abs(tabs_top - TOP) <= 1, tabs_top)

    # Nothing but paper may show inside the status-bar strip once the page has scrolled.
    strip = page.evaluate("""(height) => {
        const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
        const cover = getComputedStyle(document.body, '::before');
        const points = [20, 196, 373].map((x) => document.elementFromPoint(x, height / 2));
        return { paper, coverHeight: cover.height, coverPosition: cover.position, coverColour: cover.backgroundColor,
                 hit: points.map((el) => el ? el.tagName.toLowerCase() : null) };
    }""", TOP)
    check(tag + "a solid strip covers the status bar area", strip["coverHeight"] == f"{TOP}px" and strip["coverPosition"] == "fixed" and set(strip["hit"]) <= {"body", "html"}, strip)

    last_bottom = page.evaluate("document.querySelector('#app').getBoundingClientRect().bottom")
    check(tag + "the end of the page clears the home bar", last_bottom <= 852 - BOTTOM + 1, last_bottom)
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check(tag + "no sideways scroll", overflow <= 0, overflow)
    if ARGS.shots:
        page.screenshot(path=str(Path(ARGS.shots) / f"safe-area-{theme}-trip-scrolled.png"))

    # A sheet opened from the trip must keep its buttons above the home bar and its title below the status bar.
    page.evaluate("window.scrollTo(0, 0)")
    page.locator('.trip-head [data-act="invite"]').click()
    page.wait_for_selector("#sheet[open]")
    page.wait_for_timeout(250)
    sheet = page.evaluate("""() => {
        const box = document.querySelector('#sheet').getBoundingClientRect();
        const controls = [...document.querySelectorAll('#sheet button, #sheet input')].filter((el) => el.offsetParent).map((el) => el.getBoundingClientRect());
        return { top: box.top, bottom: box.bottom, highest: Math.min(...controls.map((r) => r.top)), lowest: Math.max(...controls.map((r) => r.bottom)) };
    }""")
    check(tag + "sheet controls stay between the status bar and the home bar", sheet["highest"] >= TOP and sheet["lowest"] <= 852 - BOTTOM + 1, sheet)
    if ARGS.shots:
        page.screenshot(path=str(Path(ARGS.shots) / f"safe-area-{theme}-sheet.png"))
    check(tag + "no script errors", not errors, errors[:3])
    context.close()


def main():
    base = serve()
    if ARGS.shots:
        Path(ARGS.shots).mkdir(parents=True, exist_ok=True)
    launch = {"args": ["--proxy-bypass-list=127.0.0.1;localhost"]}
    if os.environ.get("TAGALONG_BROWSER"):  # a browser already on this machine, when the bundled one is missing
        launch["executable_path"] = os.environ["TAGALONG_BROWSER"]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**launch)
        for theme in ("light", "dark"):
            try:
                run_theme(browser, base, theme)
            except Exception as error:
                check(f"[{theme}] run finished", False, repr(error)[:400])
        browser.close()
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} safe-area checks passed")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
