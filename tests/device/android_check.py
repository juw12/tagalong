"""Install the released APK on an Android emulator and use it like a person would.

python3 tests/device/android_check.py <Tagalong.apk> <evidence folder> [expected version, e.g. 2.0.1]

Run inside the Device check workflow (GitHub Actions, free runner with an emulator). It installs the APK,
opens the app, waits for the first screen, checks that the header starts below the status bar, opens the
sample trip, turns on live sync and reads the relay count. Text on screen is read two ways: the accessibility tree (uiautomator) and OCR of the screenshot
(tesseract), so one of them failing does not fail the check. Every step saves a screenshot.

Emulators on free runners are slow, and the system sometimes covers the app with a "<another app> isn't
responding" box (seen with Pixel Launcher on API 35). The check presses Wait on those and says so in the
result. If the box names Tagalong itself, that is a failure, not something to dismiss.

This proves the released file installs and runs on an emulator. It is not a check on a physical phone.
"""
import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ElementTree
from pathlib import Path

APP_ID = "io.github.juw12.tagalong"
APK = Path(sys.argv[1])
EVIDENCE = Path(sys.argv[2])
EXPECTED_VERSION = sys.argv[3].strip() if len(sys.argv) > 3 else ""
EVIDENCE.mkdir(parents=True, exist_ok=True)

checks = []
dismissed_dialogs = []
app_freezes = []


def check(label, ok, detail="", core=True):
    checks.append({"label": label, "ok": bool(ok), "core": core, "detail": str(detail)[:400]})
    print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else "  -> " + str(detail)[:400]), flush=True)


def adb(*args, timeout=90, binary=False):
    result = subprocess.run(["adb", *args], capture_output=True, timeout=timeout)
    if binary:
        return result.stdout
    return (result.stdout + result.stderr).decode("utf-8", "replace")


def screenshot(name):
    path = EVIDENCE / name
    path.write_bytes(adb("exec-out", "screencap", "-p", binary=True))
    return path


def tree_items():
    """Text and tap targets from the accessibility tree."""
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml", timeout=60)
    raw = adb("exec-out", "cat", "/sdcard/ui.xml", binary=True)
    items = []
    try:
        root = ElementTree.fromstring(raw.decode("utf-8", "replace"))
    except ElementTree.ParseError:
        return items
    for node in root.iter("node"):
        text = (node.get("text") or "").strip() or (node.get("content-desc") or "").strip()
        box = re.findall(r"\d+", node.get("bounds") or "")
        if text and len(box) == 4:
            left, top, right, bottom = map(int, box)
            items.append({"text": text, "x": (left + right) // 2, "y": (top + bottom) // 2, "top": top, "bottom": bottom, "source": "tree"})
    return items


def ocr_items(image_path):
    """Text lines and their centres from OCR of a screenshot."""
    result = subprocess.run(
        ["tesseract", str(image_path), "-", "--psm", "11", "tsv"],
        capture_output=True,
        timeout=120,
    )
    lines = {}
    for row in result.stdout.decode("utf-8", "replace").splitlines()[1:]:
        cells = row.split("\t")
        if len(cells) < 12 or not cells[11].strip():
            continue
        key = tuple(cells[1:5])
        left, top, width, height = map(int, cells[6:10])
        entry = lines.setdefault(key, {"words": [], "box": [left, top, left + width, top + height]})
        entry["words"].append(cells[11].strip())
        entry["box"] = [
            min(entry["box"][0], left),
            min(entry["box"][1], top),
            max(entry["box"][2], left + width),
            max(entry["box"][3], top + height),
        ]
    items = []
    for entry in lines.values():
        left, top, right, bottom = entry["box"]
        items.append({"text": " ".join(entry["words"]), "x": (left + right) // 2, "y": (top + bottom) // 2, "top": top, "bottom": bottom, "source": "ocr"})
    return items


NOT_RESPONDING = r"(.+?) (isn.t responding|keeps stopping|has stopped)"


def clear_system_dialog(items):
    """Press Wait when the system says another app is not responding. True if something was dismissed."""
    dialog = find(items, NOT_RESPONDING)
    if not dialog:
        return False
    title = dialog["text"].strip()
    if re.search(r"tagalong", title, re.IGNORECASE):
        if title not in app_freezes:
            app_freezes.append(title)
        return False
    button = find(items, r"^wait$") or find(items, r"^close app$") or find(items, r"^ok$")
    if not button:
        return False
    dismissed_dialogs.append(title)
    print(f"  system dialog dismissed: {title}", flush=True)
    tap(button)
    return True


def read_screen(name):
    for attempt in range(4):
        image = screenshot(name)
        items = tree_items() + ocr_items(image)
        if not clear_system_dialog(items):
            return items
    return items


def find(items, pattern):
    regex = re.compile(pattern, re.IGNORECASE)
    for item in items:
        if regex.search(item["text"]):
            return item
    return None


def wait_for(pattern, name, seconds=120):
    deadline = time.time() + seconds
    items = []
    while time.time() < deadline:
        items = read_screen(name)
        hit = find(items, pattern)
        if hit:
            # The text can be in the accessibility tree a moment before it is painted: keep a painted picture.
            time.sleep(1.5)
            screenshot(name)
            return hit, items
        time.sleep(3)
    return None, items


def tap(item):
    adb("shell", "input", "tap", str(item["x"]), str(item["y"]))
    time.sleep(2)


def screen_size():
    size = re.findall(r"(\d+)x(\d+)", adb("shell", "wm", "size"))
    return tuple(map(int, size[-1])) if size else (1080, 1920)


def status_bar_bottom(window_dump, items, screen_height):
    """Where the system status bar ends, in pixels from the top, and how that was measured."""
    frames = re.findall(
        r"InsetsSource[^\n]*(?:STATUS_BAR|statusBars)[^\n]*?frame=\[0,0\]\[\d+,(\d+)\]",
        window_dump,
        re.IGNORECASE,
    )
    heights = [int(value) for value in frames if 0 < int(value) < screen_height * 0.2]
    if heights:
        return max(heights), "system window report"
    clocks = [
        item for item in items
        if re.fullmatch(r"\d{1,2}:\d{2}", item["text"].strip()) and item["y"] < screen_height * 0.08
    ]
    if clocks:
        return max(item["bottom"] for item in clocks), "bottom of the clock on screen"
    return None, "not measured"


HEADER_WORDS = re.compile(r"^\W{0,3}(tagalong|trips|passport|dark|light|switch to (dark|light) theme)$", re.IGNORECASE)


def header_layout(items, bar_bottom, screen_height):
    """The app header (brand, Trips, Passport, theme button) must start below the status bar."""
    header = [item for item in items if HEADER_WORDS.match(item["text"].strip()) and item["y"] < screen_height * 0.25]
    seen_header = ", ".join(sorted({f"{item['text'].strip()}@{item['top']}" for item in header}))
    if bar_bottom is None:
        return False, f"status bar not measured; header: {seen_header}"
    if len({item["text"].strip().lower() for item in header}) < 2:
        return False, f"header not found on screen (status bar ends at {bar_bottom}px); saw: {seen_header}"
    highest = min(item["top"] for item in header)
    detail = f"status bar ends at {bar_bottom}px, header starts at {highest}px ({seen_header})"
    return highest >= bar_bottom - 2, detail


def swipe_up():
    width, height = screen_size()
    adb("shell", "input", "swipe", str(width // 2), str(int(height * 0.72)), str(width // 2), str(int(height * 0.30)), "400")
    time.sleep(2)


def seen(items):
    return " | ".join(sorted({item["text"] for item in items}))[:400]


def main():
    # 1. Install the released file.
    install = adb("install", "-r", str(APK), timeout=300)
    check("the released APK installs", "Success" in install, install)
    package = adb("shell", "dumpsys", "package", APP_ID)
    version = re.search(r"versionName=(\S+)", package)
    installed = version.group(1) if version else ""
    if EXPECTED_VERSION:
        check(f"installed version is {EXPECTED_VERSION}", installed == EXPECTED_VERSION, installed or "not found")
    else:
        check("installed version is 2.x", installed.startswith("2."), installed or "not found")
    webview = re.search(r"versionName=(\S+)", adb("shell", "dumpsys", "package", "com.google.android.webview"))
    release = adb("shell", "getprop", "ro.build.version.release").strip()
    sdk = adb("shell", "getprop", "ro.build.version.sdk").strip()
    print(f"  Android {release} (API {sdk}), system WebView {webview.group(1) if webview else 'unknown'}", flush=True)

    # 2. Open it and wait for the first screen.
    adb("logcat", "-c")
    adb("shell", "monkey", "-p", APP_ID, "-c", "android.intent.category.LAUNCHER", "1")
    home, items = wait_for(r"look around a sample trip|start a trip|open this trip", "android-1-home.png", 150)
    check("the first screen renders (Start a trip / sample trip)", home, seen(items))
    resumed = adb("shell", "dumpsys", "activity", "activities")
    top = [line.strip() for line in resumed.splitlines() if "ResumedActivity" in line]
    check("Tagalong is the foreground app", any(APP_ID in line for line in top), top)

    # 2b. Nothing of the app may sit under the clock and battery icons.
    width, height = screen_size()
    window_dump = adb("shell", "dumpsys", "window", timeout=120)
    (EVIDENCE / "window.txt").write_text(window_dump, encoding="utf-8")
    bar_bottom, bar_source = status_bar_bottom(window_dump, items, height)
    layout_ok, layout_detail = header_layout(items, bar_bottom, height)
    layout_detail = f"{layout_detail}; measured from the {bar_source}; screen {width}x{height}"
    print("  " + layout_detail, flush=True)
    check("the header sits below the status bar", layout_ok, layout_detail)

    # 3. Open the sample trip and reach its tabs.
    sample = find(items, r"look around a sample trip") or find(items, r"open this trip|open the sample trip")
    if sample:
        tap(sample)
    tabs, items = wait_for(r"^(money|places|ideas)$", "android-2-trip.png", 60)
    check("the sample trip opens with its tabs", tabs, seen(items))
    check("the trip is the sample (Tokyo, finally)", find(items, r"tokyo,? finally"), seen(items))

    # 4. Live sync from inside the app: turn it on and read how many relays answered.
    relays = None
    group = find(items, r"^group$")
    if group:
        tap(group)
        button = None
        for attempt in range(7):
            items = read_screen("android-3-group.png")
            button = find(items, r"turn on live sync")
            if button:
                break
            swipe_up()
        if button:
            tap(button)
            hit, items = wait_for(r"[1-9] of \d relays", "android-4-live.png", 75)
            if hit:
                relays = re.search(r"([1-9]) of (\d) relays", hit["text"], re.IGNORECASE).group(0)
    check("live sync connects from the app (at least 1 relay)", relays, relays or seen(items), core=False)

    # 5. It did not crash.
    log = adb("logcat", "-d", timeout=120)
    (EVIDENCE / "logcat.txt").write_text(log, encoding="utf-8")
    crashes = [line for line in log.splitlines() if "FATAL EXCEPTION" in line or f"Process: {APP_ID}" in line]
    check("no crash in the device log", not crashes, crashes[:3])
    frozen = [line.strip() for line in log.splitlines() if f"ANR in {APP_ID}" in line]
    check("Tagalong never stopped responding", not frozen and not app_freezes, (frozen + app_freezes)[:3])
    pid = adb("shell", "pidof", APP_ID).strip()
    check("the app is still running", pid.isdigit(), f"pid {pid}" if pid.isdigit() else "no process found")

    summary = {
        "what": "emulator check of the released APK (not a physical phone)",
        "android": release,
        "api": sdk,
        "webview": webview.group(1) if webview else None,
        "version": version.group(1) if version else None,
        "relays": relays,
        "layout": layout_detail,
        "system_dialogs_dismissed": dismissed_dialogs,
        "checks": checks,
        "core_passed": all(item["ok"] for item in checks if item["core"]),
        "all_passed": all(item["ok"] for item in checks),
    }
    (EVIDENCE / "result.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    passed = sum(item["ok"] for item in checks)
    print(f"{passed}/{len(checks)} checks passed", flush=True)
    return 0 if summary["core_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
