"""G11: the v2 features, each checked in a real browser.

python tests/features.py                 serve this folder locally and check every feature
python tests/features.py --base <url>    check a deployed copy (live sync still uses the local test relay)

Covers: the sample tag opens the sample trip, map pan/pinch/zoom, organizer and member roles with the plan lock,
saved places and collections, invite from every tab, one accent colour for money, the toast staying off the
focused field, end-to-end encrypted live sync between two browsers, and receipt scanning with on-device OCR.
"""
import argparse
import functools
import http.server
import json
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
from relay import Relay  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--base", default="")
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


def receipt_image(path):
    image = Image.new("RGB", (900, 760), "white")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 44)
    except OSError:
        font = ImageFont.load_default()
    lines = ["RAMEN STREET", "", "Ramen 12.50", "Gyoza 9.00", "Lemon soda 4.50", "", "Tax 2.60", "Total 28.60"]
    for index, line in enumerate(lines):
        draw.text((70, 60 + index * 80), line, fill="black", font=font)
    image.save(path)


def balances_colour(page):
    return page.evaluate("""() => {
        const plus = document.querySelector('.balances li.plus span:last-child');
        const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
        const good = getComputedStyle(document.documentElement).getPropertyValue('--good').trim();
        return { plus: plus ? getComputedStyle(plus).color : null, ink, good };
    }""")


def hex_to_rgb(text):
    text = text.lstrip("#")
    return "rgb(" + ", ".join(str(int(text[i:i + 2], 16)) for i in (0, 2, 4)) + ")"


def run(browser, base, relay_url, relay):
    errors = []
    phone = browser.new_context(viewport={"width": 390, "height": 760}, accept_downloads=True)
    page = phone.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))

    # 1. The first-run tag opens the sample trip.
    page.goto(base)
    page.locator(".ticket-open").click()
    page.wait_for_selector(".trip-head h1")
    check("sample tag opens the sample trip", page.locator(".trip-head h1").inner_text() == "Tokyo, finally", page.url)

    # 2. Invite from every tab.
    trip_hash = page.url.split("#")[1].rsplit("/", 1)[0]
    for tab in ["plan", "ideas", "places", "money", "group"]:
        page.goto(base + "#" + trip_hash + "/" + tab)
        page.wait_for_selector(".trip-head")
        check(f"invite button on the {tab} tab", page.locator('.trip-head [data-act="invite"]').is_visible())
    page.locator('.trip-head [data-act="invite"]').click()
    page.wait_for_selector("#sheet[open] #invite-link")
    link = page.locator("#invite-link").input_value()
    check("invite sheet holds a join link", "#join=" in link, link[:80])
    page.locator('#sheet [data-act="close"]').click()

    # 3. Money: one accent, no second green for "gets back".
    page.goto(base + "#" + trip_hash + "/money")
    colours = balances_colour(page)
    check("'gets back' uses ink, not green", colours["plus"] == hex_to_rgb(colours["ink"]) and colours["plus"] != hex_to_rgb(colours["good"]), colours)

    # 4. Places and collections.
    page.goto(base + "#" + trip_hash + "/places")
    check("sample trip has 4 saved places", page.locator(".place").count() == 4, page.locator(".place").count())
    check("collections are listed", page.locator(".lists button").count() == 4, page.locator(".lists button").count())
    page.locator('.lists button[data-list="Food"]').click()
    check("filter by collection", page.locator(".place").count() == 2, page.locator(".place").count())
    page.locator('[data-act="add-place"]').click()
    page.fill('#sheet input[name="name"]', "Tsujihan")
    page.fill('#sheet input[name="list"]', "Food")
    page.fill('#sheet input[name="address"]', "Tsujihan, Nihonbashi")
    page.locator("#sheet .btn.primary").click()
    check("saved place lands in its collection", page.locator(".place").count() == 3, page.locator(".place").count())
    ideas_before = page.locator('.tabs a[href$="/ideas"]').inner_text()
    page.locator('.place [data-act="place-idea"]').first.click()
    ideas_after = page.locator('.tabs a[href$="/ideas"]').inner_text()
    check("place turns into an idea", ideas_before != ideas_after, f"{ideas_before} -> {ideas_after}")

    # 5. Roles and the plan lock.
    page.goto(base + "#" + trip_hash + "/group")
    check("organizer badge shown", page.locator(".members .role").count() >= 1)
    check("organizer sees role controls", page.locator('[data-act="set-role"]').count() == 3, page.locator('[data-act="set-role"]').count())
    page.locator('input[data-change="lock"]').check()
    page.wait_for_timeout(100)
    check("plan lock is on", page.locator('input[data-change="lock"]').is_checked())
    members = page.locator('select[data-change="me"] option').all_inner_texts()
    page.select_option('select[data-change="me"]', label="Mei")
    check("member sees no role controls", page.locator('[data-act="set-role"]').count() == 0)
    check("member cannot remove people", page.locator('[data-act="remove-member"]').count() == 0)
    check("member cannot edit trip details", page.locator('[data-act="edit-trip"]').count() == 0)
    check("member cannot turn live sync on", page.locator('[data-act="live-on"]').count() == 0)
    page.goto(base + "#" + trip_hash + "/plan")
    check("locked plan: no add buttons for a member", page.locator('[data-act="add-event"]').count() == 0)
    check("locked plan: events cannot be dragged", page.locator('.event[draggable="true"]').count() == 0)
    page.locator(".event .event-main").first.click()
    page.wait_for_selector("#sheet[open]")
    check("locked plan: event opens read-only", page.locator("#sheet .btn.primary").count() == 0 and page.locator("#sheet fieldset[disabled]").count() >= 1)
    page.locator('#sheet [data-act="close"]').click()
    page.goto(base + "#" + trip_hash + "/ideas")
    page.fill('form[data-form="quick-idea"] input', "Onsen day")
    page.locator('form[data-form="quick-idea"] button').click()
    check("locked plan: a member can still add ideas", "Onsen day" in page.locator(".idea").all_inner_texts().__str__())
    page.goto(base + "#" + trip_hash + "/group")
    page.select_option('select[data-change="me"]', label=members[0])
    page.locator('input[data-change="lock"]').uncheck()

    # 6. The toast stays off the field you are using.
    page.locator('form[data-form="merge-link"] input').fill("not a link")
    page.locator('form[data-form="merge-link"] input').scroll_into_view_if_needed()
    page.evaluate("""() => {
        const input = document.querySelector('form[data-form="merge-link"] input');
        window.scrollBy(0, input.getBoundingClientRect().bottom - window.innerHeight + 12);
    }""")
    page.locator('form[data-form="merge-link"] input').press("Enter")
    page.wait_for_selector("#toast:not([hidden])")
    overlap = page.evaluate("""() => {
        const a = document.activeElement.getBoundingClientRect();
        const b = document.querySelector('#toast').getBoundingClientRect();
        return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
    }""")
    check("toast does not cover the focused field", not overlap)

    # 7. Passport map: drag, ctrl+wheel, buttons, keys.
    page.goto(base + "#/passport")
    svg = page.locator("svg.world")
    svg.scroll_into_view_if_needed()
    view = lambda: [float(v) for v in svg.get_attribute("viewBox").split()]
    start = view()
    page.locator('[data-act="map-in"]').click()
    zoomed = view()
    check("zoom-in button narrows the map", zoomed[2] < start[2], (start, zoomed))
    box = svg.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] / 2 + 80, box["y"] + box["height"] / 2, steps=6)
    page.mouse.up()
    dragged = view()
    check("dragging pans the map", dragged[0] < zoomed[0], (zoomed, dragged))
    page.keyboard.down("Control")
    page.mouse.wheel(0, -300)
    page.keyboard.up("Control")
    page.wait_for_timeout(100)
    wheeled = view()
    check("ctrl+wheel (trackpad pinch) zooms", wheeled[2] < dragged[2], (dragged, wheeled))
    svg.focus()
    page.keyboard.press("ArrowRight")
    keyed = view()
    check("arrow keys pan the map", keyed[0] > wheeled[0], (wheeled, keyed))
    page.locator('[data-act="map-out"]').click()
    check("zoom-out button widens the map", view()[2] > keyed[2])
    # two-finger pinch through raw pointer events
    pinched = page.evaluate("""() => {
        const svg = document.querySelector('svg.world');
        const rect = svg.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        const before = svg.viewBox.baseVal.width;
        const fire = (type, id, x) => svg.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: cy, bubbles: true, pointerType: 'touch' }));
        fire('pointerdown', 11, cx - 40); fire('pointerdown', 12, cx + 40);
        for (let step = 1; step <= 5; step++) fire('pointermove', 12, cx + 40 + step * 20);
        fire('pointerup', 11, cx - 40); fire('pointerup', 12, cx + 140);
        return [before, svg.viewBox.baseVal.width];
    }""")
    check("two-finger pinch zooms", pinched[1] < pinched[0], pinched)

    # 8. Receipt scan with on-device OCR.
    page.goto(base + "#" + trip_hash + "/money")
    page.locator('[data-act="add-expense"]').click()
    page.fill('#sheet input[name="title"]', "Ramen lunch")
    page.locator('[data-act="split"][data-split="items"]').click()
    receipt = Path(tempfile.gettempdir()) / "tagalong-receipt.png"
    receipt_image(receipt)
    ocr_requests = []
    page.on("request", lambda request: ocr_requests.append(request.url) if "vendor/ocr" in request.url else None)
    page.set_input_files('#sheet input[data-change="scan"]', str(receipt))
    page.wait_for_function("() => /Found|No prices|Could not/.test(document.querySelector('#sheet .scan-status').textContent)", timeout=120000)
    status = page.locator("#sheet .scan-status").inner_text()
    names = page.locator('#sheet input[name="item-name"]').evaluate_all("els => els.map(e => e.value)")
    amounts = page.locator('#sheet input[name="item-amount"]').evaluate_all("els => els.map(e => e.value)")
    tax = page.locator('#sheet input[name="tax"]').input_value()
    check("receipt scan finds the 3 items", status.startswith("Found 3"), (status, names, amounts))
    check("receipt scan reads the prices", [float(a or 0) for a in amounts] == [12.5, 9.0, 4.5], amounts)
    check("receipt scan pulls tax out and skips the total", tax == "2.6", tax)
    check("OCR files come from this app, not a CDN", ocr_requests and all(url.startswith(base) for url in ocr_requests), ocr_requests[:3])
    page.locator("#sheet .btn.primary").click()
    check("scanned receipt saves as an expense", "Ramen lunch" in page.locator(".expense").all_inner_texts().__str__())

    # 9. Live sync between two browsers through the (local) relay.
    alice_ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    bob_ctx = browser.new_context(viewport={"width": 390, "height": 760})
    alice = alice_ctx.new_page()
    bob = bob_ctx.new_page()
    for who in (alice, bob):
        who.on("pageerror", lambda error: errors.append(str(error)))
    alice.goto(base + "?demo=1&relay=" + relay_url)
    alice.locator(".tags .tag").first.click()
    alice_hash = alice.url.split("#")[1].rsplit("/", 1)[0]
    alice.goto(base + "?demo=1&relay=" + relay_url + "#" + alice_hash + "/group")
    alice.locator('[data-act="live-on"]').click()
    alice.wait_for_function("() => /Live$/.test((document.querySelector('[data-live-status]') || {}).textContent || '')", timeout=15000)
    check("live sync connects", True)
    alice.locator('.trip-head [data-act="invite"]').click()
    invite = alice.locator("#invite-link").input_value()
    alice.locator('#sheet [data-act="close"]').click()
    bob.goto(invite.replace(base, base + "?relay=" + relay_url).replace("?demo=1", ""))
    bob.wait_for_selector("#sheet[open]")
    bob.locator('#sheet input[type="radio"]').nth(1).check()
    bob.locator("#sheet .btn.primary").click()
    bob.wait_for_selector(".trip-head")
    bob_hash = bob.url.split("#")[1].rsplit("/", 1)[0]
    bob.goto(bob.url.split("#")[0] + "#" + bob_hash + "/ideas")
    bob.fill('form[data-form="quick-idea"] input', "Robot restaurant")
    bob.locator('form[data-form="quick-idea"] button').click()
    alice.goto(alice.url.split("#")[0] + "#" + alice_hash + "/ideas")
    try:
        alice.wait_for_function("() => document.body.innerText.includes('Robot restaurant')", timeout=10000)
        check("a change on one phone shows up on the other", True)
    except Exception as error:
        check("a change on one phone shows up on the other", False, str(error)[:200])
    alice.fill('form[data-form="quick-idea"] input', "Sumo morning practice")
    alice.locator('form[data-form="quick-idea"] button').click()
    try:
        bob.wait_for_function("() => document.body.innerText.includes('Sumo morning practice')", timeout=10000)
        check("and back the other way", True)
    except Exception as error:
        check("and back the other way", False, str(error)[:200])
    plain = [p for p in relay.payloads if b"Tokyo" in p or b"Robot" in p or b"Sumo" in p]
    check("the relay only ever saw ciphertext", relay.payloads and not plain, f"{len(relay.payloads)} payloads, {len(plain)} readable")
    late_ctx = browser.new_context()
    late = late_ctx.new_page()
    late.goto(invite.replace(base, base + "?relay=" + relay_url).replace("?demo=1", ""))
    late.wait_for_selector("#sheet[open]")
    late.locator('#sheet input[type="radio"]').nth(2).check()
    late.locator("#sheet .btn.primary").click()
    late.goto(late.url.split("#")[0] + "#" + bob_hash + "/ideas")
    try:
        late.wait_for_function("() => document.body.innerText.includes('Robot restaurant')", timeout=10000)
        check("someone joining later gets the latest state from the old link", True)
    except Exception as error:
        check("someone joining later gets the latest state from the old link", False, str(error)[:200])
    alice.goto(alice.url.split("#")[0] + "#" + alice_hash + "/group")
    alice.locator('[data-act="live-off"]').click()
    try:
        bob.goto(bob.url.split("#")[0] + "#" + bob_hash + "/group")
        bob.wait_for_function("() => !document.querySelector('[data-live-status]')", timeout=10000)
        check("turning live sync off reaches everyone", True)
    except Exception as error:
        check("turning live sync off reaches everyone", False, str(error)[:200])

    check("no script errors", not errors, errors[:3])
    for ctx in (phone, alice_ctx, bob_ctx, late_ctx):
        ctx.close()


def main():
    base = ARGS.base or serve()
    if not base.endswith("/"):
        base += "/"
    relay = Relay()
    relay_url = relay.start()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            run(browser, base, relay_url, relay)
        except Exception as error:
            check("feature run finished", False, repr(error)[:400])
        browser.close()
    passed = sum(ok for _, ok, _ in results)
    print(f"G11 {'PASS' if passed == len(results) else 'FAIL'} ({passed}/{len(results)} checks) v2 features")
    (ROOT / "hone" / "gates_v2.json").write_text(json.dumps({"base": ARGS.base or "local", "checks": [[label, ok] for label, ok, _ in results]}, indent=1))
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
