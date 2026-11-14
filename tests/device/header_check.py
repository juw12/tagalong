"""Does the app header start below the iPhone status bar and Dynamic Island?

python3 tests/device/header_check.py <boxes.tsv> <screenshot.png>

boxes.tsv comes from `swift ocr.swift --boxes <screenshot.png>`: top, bottom, left (pixels) and the text, tab separated.
Passes when the brand ("Tagalong") is found near the top of the screen and starts lower than the status bar zone.
Text recognition sometimes "corrects" the brand to "Tagalog", so the match is loose on purpose.
"""
import re
import struct
import sys

# The clock, the Dynamic Island and the battery icon end within the top 5.5% of every current iPhone screen.
STATUS_ZONE = 0.055
BRAND = re.compile(r"tagal\w*g", re.IGNORECASE)
CLOCK = re.compile(r"^\d{1,2}:\d{2}$")


def png_size(path):
    with open(path, "rb") as handle:
        head = handle.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG file")
    return struct.unpack(">II", head[16:24])


def read_boxes(path):
    boxes = []
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            cells = line.rstrip("\n").split("\t", 3)
            if len(cells) == 4 and cells[0].lstrip("-").isdigit() and cells[1].lstrip("-").isdigit():
                boxes.append({"top": int(cells[0]), "bottom": int(cells[1]), "text": cells[3].strip()})
    return boxes


def judge(boxes, height):
    limit = round(height * STATUS_ZONE)
    brands = [box for box in boxes if BRAND.search(box["text"]) and box["top"] < height * 0.15]
    if not brands:
        top_lines = " | ".join(box["text"] for box in boxes if box["top"] < height * 0.15)
        return False, f"brand not found in the top of the screen; saw: {top_lines}"
    brand = min(brands, key=lambda box: box["top"])
    clocks = [box for box in boxes if CLOCK.match(box["text"]) and box["top"] < limit]
    floor = max([limit] + [box["bottom"] for box in clocks])
    detail = (
        f"header starts at {brand['top']}px ({brand['top'] / height:.1%} of {height}px); "
        f"status bar zone ends at {floor}px"
    )
    return brand["top"] >= floor, detail


def main():
    boxes = read_boxes(sys.argv[1])
    _, height = png_size(sys.argv[2])
    ok, detail = judge(boxes, height)
    print(detail)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
