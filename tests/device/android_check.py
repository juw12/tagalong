"""Install the released APK on an Android emulator and use it like a person would.

python3 tests/device/android_check.py <Tagalong.apk> <evidence folder>

Run inside the Device check workflow (GitHub Actions, free runner with an emulator). It installs the APK,
opens the app, waits for the first screen, opens the sample trip, turns on live sync and reads the relay
count. Text on screen is read two ways: the accessibility tree (uiautomator) and OCR of the screenshot
(tesseract), so one of them failing does not fail the check. Every step saves a screenshot.

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
EVIDENCE.mkdir(parents=True, exist_ok=True)

checks = []


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
            items.append({"text": text, "x": (left + right) // 2, "y": (top + bottom) // 2, "source": "tree"})
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
        items.append({"text": " ".join(entry["words"]), "x": (left + right) // 2, "y": (top + bottom) // 2, "source": "ocr"})
    return items


def read_screen(name):
    image = screenshot(name)
    return tree_items() + ocr_items(image)


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
            return hit, items
        time.sleep(3)
    return None, items


def tap(item):
    adb("shell", "input", "tap", str(item["x"]), str(item["y"]))
    time.sleep(2)


def swipe_up():
    size = re.findall(r"(\d+)x(\d+)", adb("shell", "wm", "size"))
    width, height = map(int, size[-1]) if size else (1080, 1920)
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
    check("installed version is 2.x", bool(version and version.group(1).startswith("2.")), version and version.group(1))
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
    check("the app is still running", adb("shell", "pidof", APP_ID).strip().isdigit(), "no process")

    summary = {
        "what": "emulator check of the released APK (not a physical phone)",
        "android": release,
        "api": sdk,
        "webview": webview.group(1) if webview else None,
        "version": version.group(1) if version else None,
        "relays": relays,
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
