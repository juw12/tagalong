"""Tagalong browser gates (G2-G10) and screenshots.

Usage:
  python tests/e2e.py                 serve this folder locally and run every gate
  python tests/e2e.py --base <url>    run against a deployed copy (e.g. GitHub Pages)
  python tests/e2e.py --proxy <url>   browser proxy for a deployed copy
  python tests/e2e.py --no-shots      skip screenshots

Writes hone/gates.json and exits non-zero when any gate fails.
"""
import argparse
import datetime
import functools
import http.server
import json
import os
import socketserver
import threading
import traceback
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--base", default="")
parser.add_argument("--proxy", default="")
parser.add_argument("--no-shots", action="store_true")
parser.add_argument("--out", default="")
ARGS = parser.parse_args()

if not ARGS.base:
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        os.environ.pop(key, None)
    os.environ["NO_PROXY"] = "localhost,127.0.0.1"

from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "hone" / "shots"
OUT = Path(ARGS.out) if ARGS.out else ROOT / "hone" / "gates.json"

GATES = {
    "G2": "no JS or console errors",
    "G3": "no horizontal overflow at 320-1440",
    "G4": "WCAG AA contrast, light and dark",
    "G5": "tap targets >= 44 px on phone",
    "G6": "no text under 12 px",
    "G7": "one h1 + title + viewport on every view",
    "G8": "works offline after first load",
    "G9": "end-to-end flow",
    "G10": "money rows add up to the total",
}
results = {gate: {"name": name, "checks": 0, "failures": []} for gate, name in GATES.items()}
errors = []


def check(gate, label, ok, detail=""):
    results[gate]["checks"] += 1
    if not ok:
        results[gate]["failures"].append(f"{label}: {detail}" if detail else label)
        print(f"  FAIL {gate} {label} {detail}", flush=True)
    return ok


def equal(gate, label, actual, expected):
    return check(gate, label, actual == expected, f"got {actual!r}, expected {expected!r}")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(Quiet, directory=str(ROOT))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://localhost:{server.server_address[1]}/"


AUDIT = r"""
(opts) => {
  const out = { overflow: 0, wide: [], taps: [], fonts: [], contrast: [], h1: document.querySelectorAll('h1').length,
    title: document.title, viewport: !!document.querySelector('meta[name="viewport"]') };
  const doc = document.documentElement;
  out.overflow = Math.max(doc.scrollWidth, document.body.scrollWidth) - window.innerWidth;
  const sheet = document.querySelector('dialog[open]');
  const scope = sheet || document.body;
  const label = (el) => (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' "' + (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30) + '"');
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
  };
  if (sheet) {
    const box = sheet.getBoundingClientRect();
    if (box.left < -0.5 || box.right > window.innerWidth + 0.5) out.wide.push('dialog ' + Math.round(box.left) + '..' + Math.round(box.right));
    if (sheet.scrollWidth > sheet.clientWidth + 1) out.wide.push('dialog scrolls sideways by ' + (sheet.scrollWidth - sheet.clientWidth));
    for (const el of sheet.querySelectorAll('input, select, textarea, button, label')) {
      if (!visible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.right > box.right + 0.5 || rect.left < box.left - 0.5) out.wide.push(label(el));
    }
  }

  // tap targets
  for (const el of scope.querySelectorAll('a, button, input, select, textarea, summary')) {
    if (!visible(el) || el.closest('.skip') || el.disabled) continue;
    let target = el;
    if (el.matches('input[type="checkbox"], input[type="radio"], input[type="file"]')) target = el.closest('label') || el;
    const rect = target.getBoundingClientRect();
    if (rect.width < 43.5 || rect.height < 43.5) out.taps.push(label(el) + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height));
  }

  // text: size and contrast
  const parse = (text) => {
    const match = text.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const backdrop = (el) => {
    const layers = [];
    let image = false;
    let opacity = 1;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      opacity *= Number(style.opacity);
      if (style.backgroundImage && style.backgroundImage !== 'none') image = true;
      const color = parse(style.backgroundColor);
      if (color && color.a > 0) {
        layers.push(color);
        if (color.a === 1) break;
      }
      if (node.tagName === 'DIALOG') break;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    const rootColor = parse(getComputedStyle(document.documentElement).backgroundColor);
    const bodyColor = parse(getComputedStyle(document.body).backgroundColor);
    if (rootColor && rootColor.a > 0) base = over(rootColor, base);
    if (bodyColor && bodyColor.a > 0) base = over(bodyColor, base);
    for (const layer of layers.reverse()) base = over(layer, base);
    return { color: base, image, opacity };
  };
  const seen = new Set();
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.nodeValue.trim()) continue;
    const el = node.parentElement;
    if (!el || seen.has(el) || !visible(el)) continue;
    if (el.closest('option, script, style, noscript, title, .skip') || el.closest('svg')) continue;
    seen.add(el);
    const style = getComputedStyle(el);
    const size = parseFloat(style.fontSize);
    if (size < 12) out.fonts.push(label(el) + ' ' + size + 'px');
    const back = backdrop(el);
    if (back.image) continue;
    let text = parse(style.color);
    if (!text) continue;
    text = over({ ...text, a: text.a * back.opacity }, back.color);
    const big = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const need = big ? 3 : 4.5;
    const got = ratio(text, back.color);
    if (got < need) out.contrast.push(label(el) + ' ' + got.toFixed(2) + ' < ' + need);
  }
  for (const el of scope.querySelectorAll('input, textarea, select')) {
    if (!visible(el) || el.matches('[type="checkbox"], [type="radio"], [type="file"]')) continue;
    const style = getComputedStyle(el);
    const size = parseFloat(style.fontSize);
    if (size < 12) out.fonts.push(label(el) + ' ' + size + 'px');
    const back = backdrop(el);
    const text = parse(style.color);
    if (!text || back.image) continue;
    const got = ratio(over(text, back.color), back.color);
    if (got < 4.5) out.contrast.push(label(el) + ' ' + got.toFixed(2) + ' < 4.5');
  }
  return out;
}
"""


def audit(page, where, width, theme):
    data = page.evaluate(AUDIT, {})
    tag = f"{where} @{width} {theme}"
    check("G3", tag, data["overflow"] <= 0 and not data["wide"], f"overflow {data['overflow']}px {data['wide'][:4]}")
    check("G4", tag, not data["contrast"], "; ".join(data["contrast"][:6]))
    if width <= 430:
        check("G5", tag, not data["taps"], "; ".join(data["taps"][:6]))
    check("G6", tag, not data["fonts"], "; ".join(data["fonts"][:6]))
    check("G7", tag, data["h1"] == 1 and bool(data["title"].strip()) and data["viewport"],
          f"h1={data['h1']} title={data['title']!r} viewport={data['viewport']}")


def watch(page):
    page.on("console", lambda msg: errors.append(f"console: {msg.text} [{page.url[:80]}]") if msg.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error} [{page.url[:80]}]"))


def text_of(page, selector):
    return page.locator(selector).first.inner_text().strip()


def save_sheet(page):
    page.locator("#sheet .btn.primary").click()
    page.wait_for_timeout(120)
    if page.locator("#sheet[open]").count():
        raise AssertionError("sheet stayed open: " + page.locator("#sheet .form-error").inner_text())


def go_tab(page, tab):
    page.locator(f'nav.tabs a[href$="/{tab}"]').click()
    page.wait_for_selector(f"section.tab-{tab}")


def balances(page):
    rows = page.locator("ul.balances li")
    found = {}
    for index in range(rows.count()):
        row = rows.nth(index)
        name = row.locator("span").first.inner_text().replace("(you)", "").strip()
        found[name] = int(row.get_attribute("data-balance"))
    return found


def money_sum(page, label):
    total = int(page.locator("dd[data-total]").get_attribute("data-total"))
    rows = page.locator("button.expense[data-minor]")
    summed = sum(int(rows.nth(index).get_attribute("data-minor")) for index in range(rows.count()))
    check("G10", label, summed == total, f"rows {summed} vs total {total}")
    return total


def iso(offset):
    return (datetime.date.today() + datetime.timedelta(days=offset)).isoformat()


def add_trip(page, past, name, country, city, start, end, currency, transport, me=None, others=None):
    page.locator('[data-act="past-trip"]' if past else '[data-act="new-trip"]').first.click()
    page.wait_for_selector("#sheet[open]")
    page.fill('#sheet input[name="name"]', name)
    page.select_option('#sheet select[name="country"]', country)
    page.fill('#sheet input[name="city"]', city)
    page.fill('#sheet input[name="start"]', start)
    page.fill('#sheet input[name="end"]', end)
    page.select_option('#sheet select[name="currency"]', currency)
    page.select_option('#sheet select[name="transport"]', transport)
    if me is not None:
        page.fill('#sheet input[name="me"]', me)
    if others is not None:
        page.fill('#sheet input[name="others"]', others)
    save_sheet(page)


def add_event(page, block, title, time="", dur="", place="", day=None):
    page.locator(f'[data-act="add-event"][data-block="{block}"], .gap').first.click()
    page.wait_for_selector("#sheet[open]")
    page.fill('#sheet input[name="title"]', title)
    if day is not None:
        page.select_option('#sheet select[name="day"]', day)
    if time:
        page.fill('#sheet input[name="time"]', time)
    if dur:
        page.select_option('#sheet select[name="dur"]', dur)
    if place:
        page.fill('#sheet input[name="place"]', place)
    save_sheet(page)


def member_ids(page):
    options = page.locator('#sheet select[name="paidBy"] option')
    return {options.nth(index).inner_text().strip(): options.nth(index).get_attribute("value") for index in range(options.count())}


def open_expense(page):
    page.locator('[data-act="add-expense"]').click()
    page.wait_for_selector("#sheet[open]")
    return member_ids(page)


def flow(browser, base):
    """G9 + G10: the whole journey a group takes, with independently computed expected numbers."""
    context = browser.new_context(viewport={"width": 390, "height": 844}, color_scheme="light", service_workers="block",
                                  accept_downloads=True)
    page = context.new_page()
    watch(page)
    page.goto(base)
    page.wait_for_selector("h1")
    equal("G9", "first run headline", text_of(page, "h1"), "One link. Everyone's in.")
    check("G9", "first run has one primary action", page.locator("main .btn.primary").count() == 1)

    # create
    add_trip(page, False, "Lisbon crew", "PT", "Lisbon", iso(30), iso(33), "EUR", "flight", "Juwen", "Mei, Arif")
    page.wait_for_selector("section.tab-plan")
    equal("G9", "trip opens on plan", text_of(page, "h1"), "Lisbon crew")
    equal("G9", "four day buttons", page.locator(".days .day").count(), 4)

    # members
    go_tab(page, "group")
    page.fill('form[data-form="add-member"] input[name="name"]', "Sam")
    page.locator('form[data-form="add-member"] button').click()
    page.wait_for_timeout(100)
    equal("G9", "four members", page.locator("ul.members li").count(), 4)

    # events
    go_tab(page, "plan")
    add_event(page, "morning", "Pasteis de Belem", place="Pasteis de Belem, Lisbon")
    equal("G9", "loose event shown", page.locator(".event").count(), 1)
    check("G9", "place opens Google Maps", "google.com/maps" in (page.locator(".event a.map").get_attribute("href") or ""))
    add_event(page, "afternoon", "Tram 28", time="14:00", dur="90")
    equal("G9", "timed event switches the day to clock", page.locator('.seg button[data-mode="clock"]').get_attribute("aria-pressed"), "true")
    check("G9", "free gaps offered", page.locator(".gap").count() >= 1)
    page.locator(".gap").last.click()
    page.wait_for_selector("#sheet[open]")
    page.fill('#sheet input[name="title"]', "Dinner at Ramiro")
    page.fill('#sheet input[name="time"]', "19:30")
    save_sheet(page)
    equal("G9", "three events on day 1", page.locator(".event").count(), 3)
    page.locator('.seg button[data-mode=""]').click()
    page.wait_for_selector(".blocks")
    equal("G9", "loose mode keeps all events", page.locator(".event").count(), 3)

    # move an event to day 2 (same result as dragging it onto the day)
    page.locator('.event-main:has-text("Tram 28")').click()
    page.wait_for_selector("#sheet[open]")
    page.select_option('#sheet select[name="day"]', iso(31))
    save_sheet(page)
    equal("G9", "moved event lands on day 2", page.locator(".event").count(), 1)
    equal("G9", "day 2 is selected", page.locator('.day[aria-pressed="true"]').get_attribute("data-day"), iso(31))

    # delete + undo
    page.locator('.event-main:has-text("Tram 28")').click()
    page.wait_for_selector("#sheet[open]")
    page.locator('[data-act="delete-event"]').click()
    page.wait_for_selector('#toast [data-act="undo"]')
    equal("G9", "event deleted", page.locator(".event").count(), 0)
    page.locator('#toast [data-act="undo"]').click()
    page.wait_for_timeout(100)
    equal("G9", "undo restores the event", page.locator(".event").count(), 1)

    # ideas + votes
    go_tab(page, "ideas")
    page.fill('form[data-form="quick-idea"] input[name="title"]', "Sunset at the miradouro")
    page.locator('form[data-form="quick-idea"] button').click()
    page.fill('form[data-form="quick-idea"] input[name="title"]', "Day trip to Sintra")
    page.locator('form[data-form="quick-idea"] button').click()
    page.wait_for_timeout(100)
    equal("G9", "two ideas", page.locator(".idea").count(), 2)
    sintra_vote = page.locator('.idea:has-text("Sintra") .vote')
    equal("G9", "author votes for own idea", sintra_vote.locator("b").inner_text(), "1")
    sintra_vote.click()
    equal("G9", "vote can be taken back", page.locator('.idea:has-text("Sintra") .vote b').inner_text(), "0")
    page.locator('.idea:has-text("Sintra") .vote').click()
    go_tab(page, "group")
    page.select_option('select[data-change="me"]', label="Mei")
    go_tab(page, "ideas")
    page.locator('.idea:has-text("Sintra") .vote').click()
    equal("G9", "second person's vote counts", page.locator('.idea:has-text("Sintra") .vote b').inner_text(), "2")
    check("G9", "most-voted idea floats to the top", "Sintra" in page.locator(".idea").first.inner_text())
    go_tab(page, "group")
    page.select_option('select[data-change="me"]', label="Juwen")
    go_tab(page, "ideas")
    page.locator('.idea:has-text("Sintra") [data-act="edit-event"]').click()
    page.wait_for_selector("#sheet[open]")
    page.select_option('#sheet select[name="day"]', iso(32))
    save_sheet(page)
    equal("G9", "scheduled idea leaves the shortlist", page.locator(".idea").count(), 1)
    go_tab(page, "plan")
    page.locator(f'.day[data-day="{iso(32)}"]').click()
    check("G9", "scheduled idea shows on its day", page.locator('.event:has-text("Sintra")').count() == 1)

    # money: even
    go_tab(page, "money")
    ids = open_expense(page)
    equal("G9", "payer defaults to me", page.locator('#sheet select[name="paidBy"]').input_value(), ids["Juwen"])
    page.fill('#sheet input[name="title"]', "Apartment")
    page.fill('#sheet input[name="amount"]', "400")
    save_sheet(page)
    equal("G9", "even split balances", balances(page), {"Juwen": 30000, "Mei": -10000, "Arif": -10000, "Sam": -10000})

    # money: shares
    open_expense(page)
    page.fill('#sheet input[name="title"]', "Fado tickets")
    page.fill('#sheet input[name="amount"]', "90")
    page.select_option('#sheet select[name="paidBy"]', ids["Mei"])
    page.locator('[data-act="split"][data-split="shares"]').click()
    page.fill(f'#sheet input[name="share-{ids["Juwen"]}"]', "2")
    page.fill(f'#sheet input[name="share-{ids["Mei"]}"]', "1")
    page.fill(f'#sheet input[name="share-{ids["Arif"]}"]', "0")
    page.fill(f'#sheet input[name="share-{ids["Sam"]}"]', "0")
    equal("G9", "typed fields survive a split change", page.locator('#sheet input[name="title"]').input_value(), "Fado tickets")
    save_sheet(page)

    # money: items with tax and tip
    open_expense(page)
    page.fill('#sheet input[name="title"]', "Seafood dinner")
    page.select_option('#sheet select[name="paidBy"]', ids["Arif"])
    page.locator('[data-act="split"][data-split="items"]').click()
    # receipt paste turns lines into items
    page.locator("#sheet details summary").click()
    page.fill('#sheet textarea[name="receipt"]', "Prawns 30.00\nBread and olives 20\nSubtotal 50.00\nVAT 5.00\nService 5.00\nTotal 60.00")
    page.locator('[data-act="parse-receipt"]').click()
    equal("G9", "receipt text becomes two items", page.locator('#sheet input[name="item-name"]').count(), 2)
    equal("G9", "receipt tax read", page.locator('#sheet input[name="tax"]').input_value(), "5")
    equal("G9", "receipt tip read", page.locator('#sheet input[name="tip"]').input_value(), "5")
    equal("G9", "receipt item price read", page.locator('#sheet input[name="item-amount"]').first.input_value(), "30")
    for member in ("Arif", "Sam"):
        page.locator(f'#sheet input[name="item-who-0"][value="{ids[member]}"]').uncheck()
    save_sheet(page)
    equal("G9", "group total after three expenses", int(page.locator("dd[data-total]").get_attribute("data-total")), 55000)
    equal("G9", "balances after three expenses", balances(page), {"Juwen": 21600, "Mei": -6400, "Arif": -4600, "Sam": -10600})
    money_sum(page, "three expenses")

    # money: foreign currency
    open_expense(page)
    page.fill('#sheet input[name="title"]', "Airport transfer")
    page.fill('#sheet input[name="amount"]', "100")
    page.select_option('#sheet select[name="currency"]', "USD")
    page.wait_for_selector('#sheet input[name="rate"]')
    page.fill('#sheet input[name="rate"]', "0.9")
    page.select_option('#sheet select[name="paidBy"]', ids["Sam"])
    save_sheet(page)
    equal("G9", "foreign expense converts into trip currency", int(page.locator("dd[data-total]").get_attribute("data-total")), 64000)
    equal("G9", "balances with foreign expense", balances(page), {"Juwen": 19350, "Mei": -8650, "Arif": -6850, "Sam": -3850})
    check("G9", "balances sum to zero", sum(balances(page).values()) == 0)
    money_sum(page, "four expenses, one foreign")
    equal("G9", "settle-up uses three payments", page.locator(".settle-list li").count(), 3)
    check("G9", "your share is shown", "206.50" in page.locator("dl.totals").inner_text(), page.locator("dl.totals").inner_text())

    # share before settling so the second device sees open balances
    go_tab(page, "group")
    page.locator('[data-act="share"]').click()
    page.wait_for_selector("#invite-link")
    link = page.locator("#invite-link").input_value()
    check("G9", "invite link carries the trip", "#join=" in link and len(link) > 200, f"length {len(link)}")
    check("G9", "invite link fits in a chat message", len(link) < 6000, f"length {len(link)}")
    page.locator('#sheet [data-act="close"]').click()

    with page.expect_download() as download:
        page.locator('[data-act="ics"]').click()
    calendar = Path(download.value.path()).read_text(encoding="utf-8")
    check("G9", "calendar export is valid ICS", "BEGIN:VCALENDAR" in calendar and calendar.count("BEGIN:VEVENT") >= 3,
          f"{calendar.count('BEGIN:VEVENT')} events")

    # second device
    other = browser.new_context(viewport={"width": 390, "height": 844}, color_scheme="light", service_workers="block")
    guest = other.new_page()
    watch(guest)
    guest.goto(link)
    guest.wait_for_selector("#sheet[open]")
    equal("G9", "clean profile sees the invitation", text_of(guest, "#sheet-title"), "You're invited: Lisbon crew")
    audit(guest, "join sheet", 390, "light")
    guest.locator('#sheet label.check:has-text("Mei")').click()
    save_sheet(guest)
    guest.wait_for_selector("section.tab-plan")
    equal("G9", "guest sees the same trip", text_of(guest, "h1"), "Lisbon crew")
    go_tab(guest, "money")
    equal("G9", "guest sees the same total", int(guest.locator("dd[data-total]").get_attribute("data-total")), 64000)
    equal("G9", "guest sees the same balances", balances(guest), {"Juwen": 19350, "Mei": -8650, "Arif": -6850, "Sam": -3850})
    money_sum(guest, "guest copy")
    check("G9", "guest is recognised as Mei", "(you)" in guest.locator('ul.balances li:has-text("Mei")').inner_text())
    go_tab(guest, "ideas")
    equal("G9", "guest sees the shortlist", guest.locator(".idea").count(), 1)
    guest.locator(".idea .vote").click()
    guest.fill('form[data-form="quick-idea"] input[name="title"]', "Fado night in Alfama")
    guest.locator('form[data-form="quick-idea"] button').click()
    go_tab(guest, "group")
    guest.locator('[data-act="share"]').click()
    guest.wait_for_selector("#invite-link")
    back_link = guest.locator("#invite-link").input_value()
    guest.locator('#sheet [data-act="close"]').click()

    # merge the guest's changes back
    page.fill('form[data-form="merge-link"] input[name="link"]', back_link)
    page.locator('form[data-form="merge-link"] button').click()
    page.wait_for_selector("section.tab-plan")
    check("G9", "merge is announced", "Merged" in page.locator("#toast").inner_text(), page.locator("#toast").inner_text())
    go_tab(page, "ideas")
    equal("G9", "merged copy has the guest's idea", page.locator('.idea:has-text("Fado night")').count(), 1)
    equal("G9", "merged copy has the guest's vote", page.locator('.idea:has-text("Sunset") .vote b').inner_text(), "2")
    go_tab(page, "money")
    equal("G9", "merge does not duplicate expenses", int(page.locator("dd[data-total]").get_attribute("data-total")), 64000)

    # settle
    for _ in range(6):
        buttons = page.locator('[data-act="mark-paid"]')
        if not buttons.count():
            break
        buttons.first.click()
        page.wait_for_timeout(80)
    check("G9", "everyone is square after settling", page.locator(".note.good").count() == 1)
    equal("G9", "settled balances are zero", balances(page), {"Juwen": 0, "Mei": 0, "Arif": 0, "Sam": 0})
    equal("G9", "three settle payments recorded", page.locator(".expense.settle").count(), 3)
    equal("G9", "settling does not change what was spent", money_sum(page, "after settling"), 64000)

    # reload keeps everything
    page.reload()
    page.wait_for_selector("section.tab-money")
    equal("G9", "data survives a reload", int(page.locator("dd[data-total]").get_attribute("data-total")), 64000)

    # passport
    page.locator('header.top nav a[href="#/"]').click()
    page.wait_for_selector(".tags")
    past = [
        ("Madrid weekend", "ES", "Madrid", iso(-400), iso(-398), "flight"),
        ("Marrakesh", "MA", "Marrakesh", iso(-200), iso(-196), "flight"),
        ("Seville by car", "ES", "Seville", iso(-90), iso(-89), "road"),
    ]
    for name, country, city, start, end, transport in past:
        add_trip(page, True, name, country, city, start, end, "EUR", transport, "Juwen", "Mei")
        page.wait_for_selector("section.tab-group")
        page.locator('header.top nav a[href="#/"]').click()
        page.wait_for_selector(".tags")
    equal("G9", "home lists four trips", page.locator("a.tag").count(), 4)
    page.locator('header.top nav a[href="#/passport"]').click()
    page.wait_for_selector("dl.figures")
    figures = {}
    cells = page.locator("dl.figures > div")
    for index in range(cells.count()):
        # text_content: the labels are upper-cased by CSS only, compare the real text
        figures[cells.nth(index).locator("dt").text_content().strip()] = cells.nth(index).locator("dd").text_content().strip()
    expected = {"Countries": "2", "Cities": "3", "Trips": "3", "Days away": "10", "Return visits": "1", "Flights": "2", "Road trips": "1"}
    equal("G9", "passport figures", figures, expected)
    equal("G9", "two countries filled on the map", page.locator("svg.world path.been").count(), 2)
    check("G9", "planned country outlined on the map", page.locator("svg.world path.next").count() >= 1)
    equal("G9", "two stamps", page.locator(".stamp").count(), 2)
    check("G9", "companion counted", "Mei" in page.locator("ul.chips").inner_text() and "3 trips" in page.locator("ul.chips").inner_text(),
          page.locator("ul.chips").inner_text())
    with page.expect_download() as download:
        page.locator('[data-act="export"]').click()
    backup = json.loads(Path(download.value.path()).read_text(encoding="utf-8"))
    check("G9", "backup holds every trip", backup.get("app") == "tagalong" and len(backup.get("trips", [])) == 4)

    # damaged link is handled
    guest.goto(base + "#join=not-a-real-link")
    guest.wait_for_timeout(300)
    check("G9", "damaged link gets a plain message", "damaged" in guest.locator("#toast").inner_text(), guest.locator("#toast").inner_text())


def sweep(browser, base, width, height, theme, shots):
    """G3-G7 on every view and every sheet at one viewport and theme."""
    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=theme, service_workers="block")
    page = context.new_page()
    page.set_default_timeout(8000)
    watch(page)

    def shot(name):
        if shots:
            page.screenshot(path=str(SHOTS / f"{name}-{width}-{theme}.png"), full_page=True, timeout=30000)

    page.goto(base, timeout=30000)
    page.wait_for_selector("h1")
    page.wait_for_timeout(250)
    audit(page, "home empty", width, theme)
    shot("home-empty")
    where = f"@{width} {theme}"
    check("G9", f"first run shows the sample-trip tag {where}", page.locator("figure.ticket").is_visible())
    edges = page.evaluate("""() => {
        const copy = document.querySelector('.hero-copy').getBoundingClientRect();
        const tag = document.querySelector('figure.ticket').getBoundingClientRect();
        return { copyRight: copy.right, copyBottom: copy.bottom, tagLeft: tag.left, tagTop: tag.top };
    }""")
    if width >= 960:
        check("G9", f"tag sits beside the headline {where}", edges["tagLeft"] >= edges["copyRight"] - 1, str(edges))
    else:
        check("G9", f"tag sits below the headline {where}", edges["tagTop"] >= edges["copyBottom"] - 1, str(edges))
    preview = " ".join(page.locator('[data-preview="settle"]').text_content().split())
    page.locator('[data-act="new-trip"]').click()
    page.wait_for_selector("#sheet[open]")
    audit(page, "trip sheet", width, theme)
    if shots:
        page.screenshot(path=str(SHOTS / f"sheet-trip-{width}-{theme}.png"))
    page.locator('#sheet [data-act="close"]').click()

    page.goto(base + "?demo=1", timeout=30000)
    page.wait_for_selector("a.tag")
    page.wait_for_timeout(250)
    audit(page, "home", width, theme)
    shot("home")
    trip = page.eval_on_selector("a.tag", "el => el.getAttribute('href')").rsplit("/", 1)[0]

    page.goto(base + "?demo=1" + trip + "/plan", timeout=30000)
    page.wait_for_selector("section.tab-plan")
    page.wait_for_timeout(200)
    audit(page, "plan", width, theme)
    shot("plan")
    strip = page.evaluate("""() => {
        const days = document.querySelector('.days');
        const wrap = days.parentElement;
        return { hidden: days.scrollWidth - days.clientWidth - days.scrollLeft, moreEnd: wrap.classList.contains('more-end'),
            arrow: !wrap.querySelector('.days-more').hidden };
    }""")
    check("G9", f"day-strip arrow shows only while days are hidden {where}",
          strip["moreEnd"] == (strip["hidden"] > 4) and strip["arrow"] == strip["moreEnd"], str(strip))
    if width <= 400:
        check("G9", f"phone day strip has more days off-screen {where}", strip["moreEnd"], str(strip))
        for _ in range(6):
            if not page.locator(".days-more").is_visible():
                break
            page.locator(".days-more").click()
            page.wait_for_timeout(700)
        ended = page.evaluate("""() => {
            const days = document.querySelector('.days');
            const box = days.getBoundingClientRect();
            const last = days.querySelector('.day:last-child').getBoundingClientRect();
            const wrap = days.parentElement;
            return { lastInView: last.right <= box.right + 1 && last.left >= box.left - 1, moreEnd: wrap.classList.contains('more-end'),
                moreStart: wrap.classList.contains('more-start') };
        }""")
        check("G9", f"arrow walks the strip to the last day {where}",
              ended["lastInView"] and not ended["moreEnd"] and ended["moreStart"], str(ended))
    other_mode = page.locator('.seg button[aria-pressed="false"]').first
    other_mode.click()
    page.wait_for_timeout(150)
    audit(page, "plan other layout", width, theme)
    shot("plan-alt")
    page.locator('.seg button[aria-pressed="false"]').first.click()
    page.wait_for_timeout(100)
    page.locator(".event-main").first.click()
    page.wait_for_selector("#sheet[open]")
    audit(page, "event sheet", width, theme)
    page.locator('#sheet [data-act="close"]').click()

    go_tab(page, "ideas")
    page.wait_for_timeout(150)
    audit(page, "ideas", width, theme)
    shot("ideas")

    go_tab(page, "money")
    page.wait_for_timeout(150)
    audit(page, "money", width, theme)
    shot("money")
    money_sum(page, f"sample trip @{width} {theme}")
    settle = [" ".join(row.split()) for row in page.locator("ul.settle-list li > span").all_text_contents()]
    check("G9", f"first-run tag quotes a real settle row {where}", preview in settle, f"{preview!r} not in {settle!r}")
    equal("G9", f"first-run tag payment count is real {where}", len(settle), 3)
    page.locator('[data-act="add-expense"]').click()
    page.wait_for_selector("#sheet[open]")
    audit(page, "expense sheet even", width, theme)
    page.locator('[data-act="split"][data-split="shares"]').click()
    audit(page, "expense sheet shares", width, theme)
    page.locator('[data-act="split"][data-split="items"]').click()
    page.locator("#sheet details summary").click()
    audit(page, "expense sheet items", width, theme)
    if shots:
        page.screenshot(path=str(SHOTS / f"sheet-expense-{width}-{theme}.png"))
    page.select_option('#sheet select[name="currency"]', "USD")
    page.wait_for_selector('#sheet input[name="rate"]')
    page.locator("#sheet .btn.primary").click()
    page.wait_for_selector("#sheet .form-error:not([hidden])")
    audit(page, "expense sheet error", width, theme)
    page.locator('#sheet [data-act="close"]').click()

    go_tab(page, "group")
    page.locator('[data-act="share"]').click()
    page.wait_for_selector("#invite-link")
    page.wait_for_timeout(150)
    audit(page, "invite sheet", width, theme)
    page.locator('#sheet [data-act="close"]').click()
    audit(page, "group", width, theme)
    shot("group")

    page.locator('header.top nav a[href="#/passport"]').click()
    page.wait_for_selector("dl.figures")
    page.wait_for_timeout(200)
    audit(page, "passport", width, theme)
    shot("passport")
    rows = page.evaluate("""() => {
        const tops = {};
        for (const cell of document.querySelectorAll('dl.figures > div')) {
            const top = Math.round(cell.getBoundingClientRect().top);
            tops[top] = (tops[top] || 0) + 1;
        }
        return Object.keys(tops).map(Number).sort((a, b) => a - b).map((top) => tops[top]);
    }""")
    check("G9", f"passport figures leave no orphan cell {where}", sum(rows) == 7 and rows[-1] >= 2, str(rows))
    whole = "0 0 1000 487"
    view_box = page.locator("svg.world").get_attribute("viewBox")
    if width < 600:
        check("G9", f"phone map opens zoomed to the trips {where}", view_box != whole, view_box)
    else:
        equal("G9", f"wide map opens on the whole world {where}", view_box, whole)
    page.locator('[data-act="map-zoom"]').click()
    page.wait_for_timeout(120)
    flipped = page.locator("svg.world").get_attribute("viewBox")
    check("G9", f"map zoom toggles {where}", (flipped == whole) != (view_box == whole), f"{view_box} -> {flipped}")
    audit(page, "passport map toggled", width, theme)
    page.locator('[data-act="map-zoom"]').click()
    page.wait_for_timeout(120)
    equal("G9", f"map zoom toggles back {where}", page.locator("svg.world").get_attribute("viewBox"), view_box)


def offline(browser, base):
    """G8: after one online visit the app opens and works with the network off."""
    context = browser.new_context(viewport={"width": 390, "height": 844}, color_scheme="light")
    page = context.new_page()
    watch(page)
    page.goto(base)
    page.wait_for_selector("h1")
    ready = page.evaluate("""async () => {
        if (!('serviceWorker' in navigator)) return 'no service worker support';
        const registration = await navigator.serviceWorker.ready;
        for (let tries = 0; tries < 50 && !navigator.serviceWorker.controller; tries++) await new Promise((done) => setTimeout(done, 100));
        const keys = await caches.keys();
        const cache = keys.length ? await caches.open(keys[0]) : null;
        const count = cache ? (await cache.keys()).length : 0;
        return (registration.active ? 'active' : 'inactive') + ' ' + (navigator.serviceWorker.controller ? 'controlled' : 'uncontrolled') + ' ' + count;
    }""")
    parts = ready.split(" ")
    check("G8", "service worker active and controlling", ready.startswith("active controlled"), ready)
    check("G8", "shell is cached", parts[-1].isdigit() and int(parts[-1]) >= 9, ready)
    context.set_offline(True)
    failed = []
    page.on("requestfailed", lambda request: failed.append(request.url))
    page.reload()
    page.wait_for_selector("h1", timeout=8000)
    equal("G8", "offline reload renders the app", text_of(page, "h1"), "One link. Everyone's in.")
    page.locator('[data-act="sample"]').click()
    page.wait_for_selector("section.tab-plan", timeout=8000)
    check("G8", "offline: sample trip opens", page.locator(".event").count() >= 1)
    page.locator('header.top nav a[href="#/passport"]').click()
    page.wait_for_selector("svg.world path")
    check("G8", "offline: world map draws", page.locator("svg.world path").count() > 100)
    styled = page.evaluate("getComputedStyle(document.body).fontFamily")
    check("G8", "offline: stylesheet applied", bool(styled) and page.evaluate("document.styleSheets.length") >= 1, styled)
    check("G8", "offline: no failed requests", not failed, str(failed[:4]))
    context.set_offline(False)
    context.close()


def main():
    base = ARGS.base or serve()
    if not base.endswith("/"):
        base += "/"
    shots = not ARGS.no_shots
    if shots:
        SHOTS.mkdir(parents=True, exist_ok=True)
    launch = {"args": ["--proxy-bypass-list=127.0.0.1;localhost"]}
    if ARGS.proxy:
        launch = {"proxy": {"server": ARGS.proxy}}
    if os.environ.get("TAGALONG_BROWSER"):  # a browser already on this machine, when the bundled one is missing
        launch["executable_path"] = os.environ["TAGALONG_BROWSER"]
    with sync_playwright() as play:
        browser = play.chromium.launch(**launch)
        stages = [("flow", lambda: flow(browser, base), "G9"), ("offline", lambda: offline(browser, base), "G8")]
        plan = [(320, 700, "light", False), (390, 844, "light", True), (390, 844, "dark", True), (768, 1024, "light", False),
                (1024, 768, "light", False), (1280, 800, "light", True), (1280, 800, "dark", True), (1440, 900, "light", False)]
        for width, height, theme, with_shots in plan:
            stages.append((f"sweep {width} {theme}",
                           functools.partial(sweep, browser, base, width, height, theme, shots and with_shots), "G3"))
        for name, run, gate in stages:
            print("stage", name, flush=True)
            try:
                run()
            except Exception as error:  # a crash in a stage is a gate failure, never a skip
                trace = traceback.format_exc().strip().splitlines()
                check(gate, f"{name} crashed", False, f"{type(error).__name__}: {str(error)[:300]} | {trace[-3][:160] if len(trace) > 2 else ''}")
        check("G2", "console and page errors", not errors, "; ".join(errors[:6]))
        results["G2"]["checks"] = max(results["G2"]["checks"], 1)
        passed = [gate for gate, data in results.items() if not data["failures"]]
        summary = {
            "base": base if ARGS.base else "local",
            "date": datetime.datetime.now().isoformat(timespec="seconds"),
            "passed": len(passed),
            "of": len(results),
            "gates": {gate: {"name": data["name"], "pass": not data["failures"], "checks": data["checks"], "failures": data["failures"][:12]}
                      for gate, data in results.items()},
        }
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8", newline="\n")
        for gate, data in summary["gates"].items():
            print(f"{gate} {'PASS' if data['pass'] else 'FAIL'} ({data['checks']} checks) {data['name']}", flush=True)
            for failure in data["failures"]:
                print("     -", failure[:400], flush=True)
        print(f"GATES {len(passed)}/{len(results)}", flush=True)
        os._exit(0 if len(passed) == len(results) else 1)


main()
