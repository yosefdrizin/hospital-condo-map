"""Run the whole pipeline, or pick steps.

  python pipeline/run_all.py                 # everything (downloads skipped when files exist)
  python pipeline/run_all.py --skip-imagery  # skip the slow aerial step (keeps existing docs/img)
  python pipeline/run_all.py --only 5 6 7    # just rebuild the site data, Excel and private candidates workbook
  python pipeline/run_all.py --refresh-dcad --refresh-npi   # force fresh downloads
"""
import argparse
import sys
import time
from importlib import import_module
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

STEPS = {1: "01_download", 2: "02_condos", 3: "03_npi", 4: "04_basemap", 5: "05_build_site", 6: "06_build_excel",
         7: "07_targets"}

ap = argparse.ArgumentParser()
ap.add_argument("--only", nargs="*", type=int)
ap.add_argument("--skip-imagery", action="store_true")
ap.add_argument("--skip-npi", action="store_true")
ap.add_argument("--refresh-dcad", action="store_true")
ap.add_argument("--refresh-npi", action="store_true")
a = ap.parse_args()

steps = a.only or list(STEPS)
if a.skip_imagery and 4 in steps:
    steps.remove(4)
if a.skip_npi and 3 in steps:
    steps.remove(3)
if a.refresh_dcad and 2 in steps:
    from common import CACHE
    (CACHE / "parcels.pkl").unlink(missing_ok=True)

for s in steps:
    t = time.time()
    print(f"\n=== step {s}: {STEPS[s]} ===", flush=True)
    m = import_module(STEPS[s])
    if s == 1:
        m.main(a.refresh_dcad)
    elif s == 3:
        m.main(a.refresh_npi)
    else:
        m.main()
    print(f"--- step {s} finished in {time.time() - t:.0f}s", flush=True)
