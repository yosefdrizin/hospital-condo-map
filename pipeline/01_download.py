"""Step 1: download the public source files (DCAD roll, DCAD parcels, Census TIGER roads).

Everything lands in data/raw/ (git-ignored). Files that already exist are skipped;
pass --refresh to download again (e.g. after DCAD posts a new roll).
"""
import argparse
import shutil
import zipfile

from common import DCAD_DATA, DCAD_GIS, RAW, SETTINGS, download, log


def unzip(zp, dest):
    if dest.exists() and any(dest.iterdir()):
        return
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zp) as z:
        z.extractall(dest)


def main(refresh=False):
    s = SETTINGS
    targets = {
        "dcad_roll": DCAD_DATA + s["dcad_roll_zip"],
        "parcels": DCAD_GIS + s["dcad_parcel_zip"],
        "roads": f"https://www2.census.gov/geo/tiger/TIGER{s['tiger_year']}/ROADS/tl_{s['tiger_year']}_{s['county_fips']}_roads.zip",
    }
    for name, url in targets.items():
        folder = RAW / name
        zp = RAW / f"{name}.zip"
        if refresh:
            shutil.rmtree(folder, ignore_errors=True)
            zp.unlink(missing_ok=True)
        log(f"{name}: downloading (skips if present)")
        download(url, zp, min_bytes=100_000)
        log(f"{name}: extracting")
        unzip(zp, folder)
    log("Downloads done")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    main(ap.parse_args().refresh)
