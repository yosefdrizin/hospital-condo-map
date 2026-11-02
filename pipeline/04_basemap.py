"""Step 4: aerial basemap images (public domain).

- USGS National Map "Imagery Topo" tiles (aerial + labels, cached to zoom 16), stitched per hospital
  at z15 and z16, plus county overviews at z11 and z13.
- USDA NAIP 1 m aerial per hospital from the USGS NAIP image service (exportImage, 2x2 chunks).

The map page swaps these by zoom level. Outputs docs/img/*.jpg and docs/basemap.json.
Tiles are cached in data/cache/tiles/.
"""
import json
import math
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import requests
from PIL import Image

from common import CACHE, CONFIG, DOCS, PROC, SETTINGS, UA, log

SVC = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile"
NAIP = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage"
T = CACHE / "tiles"
T.mkdir(parents=True, exist_ok=True)
IMG = DOCS / "img"
R = 6378137.0


def merc(lat, lon):
    return math.radians(lon) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R


def unmerc(x, y):
    return math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2), math.degrees(x / R)


def tilexy(lat, lon, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def tile_lat(y, z):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** z))))


def tile_lon(x, z):
    return x / 2 ** z * 360 - 180


def get_tile(z, x, y):
    f = T / f"{z}_{x}_{y}.jpg"
    if f.exists() and f.stat().st_size > 500:
        return f
    for _ in range(3):
        try:
            r = requests.get(f"{SVC}/{z}/{y}/{x}", timeout=40, headers=UA)
            if r.status_code == 200:
                f.write_bytes(r.content)
                return f
        except Exception:  # noqa: BLE001
            pass
    return None


def stitch(lat0, lat1, lon0, lon1, z, name, q=72):
    x0, y0 = tilexy(lat1, lon0, z)
    x1, y1 = tilexy(lat0, lon1, z)
    xs = range(int(x0), int(x1) + 1)
    ys = range(int(y0), int(y1) + 1)
    jobs = [(z, x, y) for x in xs for y in ys]
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda a: get_tile(*a), jobs))
    im = Image.new("RGB", (256 * len(xs), 256 * len(ys)), (200, 200, 190))
    for (_, x, y), f in zip(jobs, res):
        if f:
            try:
                im.paste(Image.open(f).convert("RGB"), ((x - xs[0]) * 256, (y - ys[0]) * 256))
            except Exception:  # noqa: BLE001
                pass
    im.save(IMG / name, quality=q, optimize=True, progressive=True)
    b = [[tile_lat(ys[-1] + 1, z), tile_lon(xs[0], z)], [tile_lat(ys[0], z), tile_lon(xs[-1] + 1, z)]]
    return {"f": "img/" + name, "b": [[round(v, 6) for v in p] for p in b], "px": list(im.size), "miss": sum(r is None for r in res)}


def naip(lat, lon, half_m, name):
    cx, cy = merc(lat, lon)
    hm = half_m / math.cos(math.radians(lat))
    bb = (cx - hm, cy - hm, cx + hm, cy + hm)
    N, P = 2, 2000
    full = Image.new("RGB", (N * P, N * P), (200, 200, 190))
    step = 2 * hm / N
    for ix in range(N):
        for iy in range(N):
            x0 = bb[0] + ix * step
            y1 = bb[3] - iy * step
            raw = T / f"naip_{name}_{ix}{iy}.jpg"
            ok = raw.exists() and raw.stat().st_size > 50000
            params = {"bbox": f"{x0},{y1 - step},{x0 + step},{y1}", "bboxSR": 3857, "imageSR": 3857, "size": f"{P},{P}",
                      "format": "jpg", "compressionQuality": 82, "f": "image"}
            for _ in range(6):
                if ok:
                    break
                try:
                    r = requests.get(NAIP, params=params, timeout=240, headers=UA)
                    if r.status_code == 200 and len(r.content) > 50000:
                        raw.write_bytes(r.content)
                        ok = True
                except Exception:  # noqa: BLE001
                    pass
            if ok:
                full.paste(Image.open(raw).convert("RGB").resize((P, P)), (ix * P, iy * P))
            else:
                log(f"  NAIP chunk failed: {name} {ix}{iy} (rerun this step to retry)")
    full.save(IMG / name, quality=66, optimize=True, progressive=True)
    s, w = unmerc(bb[0], bb[1])
    n, e = unmerc(bb[2], bb[3])
    return {"f": "img/" + name, "b": [[round(s, 6), round(w, 6)], [round(n, 6), round(e, 6)]], "px": list(full.size)}


def main():
    h = pd.read_csv(CONFIG / "hospitals.csv")
    half = SETTINGS["imagery_half_width_miles"] * 1609.344
    man = {"hosp": []}
    lats, lons = [], []
    for i, r in h.iterrows():
        dlat = half / 111320
        dlon = half / (111320 * math.cos(math.radians(r.lat)))
        lats += [r.lat - dlat, r.lat + dlat]
        lons += [r.lon - dlon, r.lon + dlon]
        e = {"n": r["name"],
             "z15": stitch(r.lat - dlat, r.lat + dlat, r.lon - dlon, r.lon + dlon, 15, f"h{i}_z15.jpg"),
             "z16": stitch(r.lat - dlat, r.lat + dlat, r.lon - dlon, r.lon + dlon, 16, f"h{i}_z16.jpg"),
             "naip": naip(r.lat, r.lon, half, f"h{i}_naip.jpg")}
        man["hosp"].append(e)
        log(f"  imagery {i + 1}/{len(h)}: {r['name']}")
    m = 0.04
    man["ov"] = stitch(min(lats) - m, max(lats) + m, min(lons) - m, max(lons) + m, 13, "overview_z13.jpg", q=70)
    man["ov12"] = stitch(min(lats) - 0.25, max(lats) + 0.25, min(lons) - 0.3, max(lons) + 0.3, 11, "overview_z11.jpg", q=70)
    (DOCS / "basemap.json").write_text(json.dumps(man))
    (PROC / "basemap.json").write_text(json.dumps(man))
    log("step 4 done")


if __name__ == "__main__":
    main()
