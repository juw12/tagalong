"""Bake Natural Earth (public domain) country shapes into world.js for the offline passport map.

Run: python tools/build_world.py
Output: world.js -> window.WORLD = {w, h, c: [[iso2, name, pathData, labelX, labelY], ...]}
Countries too small for the 110m shapes are added as dots (empty pathData).
"""
import json
import math
import urllib.request
from pathlib import Path

BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
SHAPES = "ne_110m_admin_0_countries.geojson"
TINY = "ne_50m_admin_0_tiny_countries.geojson"
WIDTH = 1000

A1, A2, A3, A4 = 1.340264, -0.081106, 0.000893, 0.003796
M = math.sqrt(3) / 2
X_MAX = 2.7066
Y_MAX = 1.3174
HEIGHT = round(WIDTH * Y_MAX / X_MAX)


def project(lon, lat):
    """Equal Earth projection to viewBox pixels."""
    theta = math.asin(M * math.sin(math.radians(lat)))
    t2 = theta * theta
    t6 = t2 * t2 * t2
    x = math.radians(lon) * math.cos(theta) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)))
    y = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))
    px = (x / X_MAX + 1) * WIDTH / 2
    py = (1 - y / Y_MAX) * HEIGHT / 2
    return round(px), round(py)


def fetch(name):
    with urllib.request.urlopen(BASE + name, timeout=60) as response:
        return json.load(response)


def iso_code(props):
    for key in ("ISO_A2_EH", "ISO_A2", "WB_A2"):
        code = props.get(key)
        if code and code != "-99":
            return code
    return None


def ring_path(ring):
    points = []
    for lon, lat in ring:
        point = project(lon, lat)
        if not points or points[-1] != point:
            points.append(point)
    if len(points) < 4:
        return "", points
    path = "M" + "L".join(f"{x},{y}" for x, y in points[:-1]) + "Z"
    return path, points


def main():
    countries = {}
    for feature in fetch(SHAPES)["features"]:
        props = feature["properties"]
        code = iso_code(props)
        if not code or code == "AQ":
            continue
        geometry = feature["geometry"]
        polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        paths = []
        biggest = []
        for polygon in polygons:
            path, points = ring_path(polygon[0])
            if path:
                paths.append(path)
                if len(points) > len(biggest):
                    biggest = points
        if not paths:
            continue
        label_x = round(sum(x for x, _ in biggest) / len(biggest))
        label_y = round(sum(y for _, y in biggest) / len(biggest))
        countries[code] = [code, props["NAME"], "".join(paths), label_x, label_y]

    for feature in fetch(TINY)["features"]:
        props = feature["properties"]
        code = iso_code(props)
        if not code or code in countries:
            continue
        lon, lat = feature["geometry"]["coordinates"][:2]
        x, y = project(lon, lat)
        countries[code] = [code, props["NAME"], "", x, y]

    rows = sorted(countries.values(), key=lambda row: row[1])
    payload = {"w": WIDTH, "h": HEIGHT, "c": rows}
    out = Path(__file__).resolve().parent.parent / "world.js"
    text = "window.WORLD=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    out.write_text(text, encoding="utf-8", newline="\n")
    dots = sum(1 for row in rows if not row[2])
    print(f"{len(rows)} countries ({dots} as dots), {len(text) // 1024} KB -> {out}")
    for code in ("SG", "ID", "JP", "FR", "HK", "MV"):
        print(code, countries.get(code, ["missing"])[1:2])


if __name__ == "__main__":
    main()
