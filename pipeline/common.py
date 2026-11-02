"""Shared paths, settings and helpers for the Hospital Condo Map pipeline."""
from __future__ import annotations

import json
import re
import time
from datetime import date
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config"
RAW = ROOT / "data" / "raw"
CACHE = ROOT / "data" / "cache"
PROC = ROOT / "data" / "processed"
DOCS = ROOT / "docs"          # GitHub Pages site root
OUT = ROOT / "outputs"        # Excel and other deliverables

for _d in (RAW, CACHE, PROC, DOCS / "img", OUT):
    _d.mkdir(parents=True, exist_ok=True)

SETTINGS = json.loads((CONFIG / "settings.json").read_text())

# DCAD GIS layers use EPSG:2276 (Texas North Central, US survey feet)
CRS_FT = 2276
MILE_FT = 5280.0

DCAD_DATA = "https://www.dallascad.org/ViewPDFs.aspx?type=3&id=%5C%5CDCAD.ORG%5CWEB%5CWEBDATA%5CWEBFORMS%5CDATA%20PRODUCTS%5C"
DCAD_GIS = "https://www.dallascad.org/ViewPDFs.aspx?type=3&id=%5C%5CDCAD.ORG%5CWEB%5CWEBDATA%5CWEBFORMS%5CGIS%20PRODUCTS%5C"

UA = {"User-Agent": "hospital-condo-map/1.0 (research; contact via repo)"}


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def download(url: str, dest: Path, timeout: int = 900, retries: int = 4, min_bytes: int = 1) -> Path:
    """Stream a file to disk with retries. Skips if it already exists."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size >= min_bytes:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    for k in range(retries):
        try:
            with requests.get(url, stream=True, timeout=timeout, headers=UA) as r:
                r.raise_for_status()
                with open(tmp, "wb") as fh:
                    for chunk in r.iter_content(1 << 20):
                        fh.write(chunk)
            if tmp.stat().st_size >= min_bytes:
                tmp.replace(dest)
                return dest
        except Exception as e:  # noqa: BLE001
            log(f"  retry {k + 1} for {url[:90]}: {e}")
            time.sleep(2 + 3 * k)
    raise RuntimeError(f"Download failed: {url}")


def find_one(folder: Path, pattern: str) -> Path:
    hits = sorted(folder.rglob(pattern))
    if not hits:
        raise FileNotFoundError(f"No {pattern} under {folder}. Run pipeline/01_download.py first.")
    return hits[0]


# ---------- ownership classification (owner name screens) ----------
# Hospital or health system as titled owner of a condo suite
HOSP_OWNER_RE = (r"BAYLOR|BOARD OF REG OF UNIV OF TX|TEXAS HEALTH RES|METHODIST|MEDICAL CITY|PARKLAND|"
                 r"DALLAS COUNTY HOSP|CHILDRENS MED|RICHARDSON MEDICAL CENTER|RICHARDSON MEDICAL CTR|"
                 r"RMC FOUNDATION|EHC-NT|PRIME HEALTH|UT SOUTHWESTERN")
# Owner name reads like a medical practice (directional only; LLCs hide many practices)
PRACTICE_OWNER_RE = (r"\bMD\b|M D\b|\bPA\b|CLINIC|IVF|RENAL|FOOT & ANKLE|PSYCHIATRIC|DERMA|SECOND DOCS|"
                     r"FTD MD|BBIGGERSMD|ACCUPUNCTURE|MEDICAL CONDO|DENTAL|HEALTH")
# Parcels whose owner makes a building "hospital-owned" for the physician split
HEALTH_SYSTEM_PARCEL_RE = (r"BAYLOR|TEXAS HEALTH RES|METHODIST HOSP|METHODIST HEALTH|METHODIST MED|METHODIST RICH|"
                           r"MEDHEALTH|MEDICAL CITY|\bHCA\b|COLUMBIA |DALLAS COUNTY HOSP|PARKLAND|CHILDRENS MED|"
                           r"CHILDREN'?S HEALTH|BOARD OF REG|UNIVERSITY OF TEXAS|UT SOUTHWESTERN|SOUTHWESTERN MED|"
                           r"VETERANS|PRIME HEALTH|DALLAS MEDICAL CENTER|DALLAS REGIONAL MED|SCOTTISH RITE|TENET|"
                           r"PIPELINE|WHITE ROCK MED|ENCOMPASS|EHC-|RICHARDSON MEDICAL C|RICHARDSON HOSP|"
                           r"RMC FOUNDATION|BIR JV|WALNUT HILLS|U S VETERANS")


def owner_class(name: str) -> str:
    """H = hospital/health system, P = medical practice name, I = investor/other."""
    n = (name or "").upper()
    if re.search(HOSP_OWNER_RE, n):
        return "H"
    if re.search(PRACTICE_OWNER_RE, n):
        return "P"
    return "I"


def use_category(bldg_class: str, sptd: str) -> str:
    """Map a DCAD building class to the condo use buckets used everywhere."""
    c = str(bldg_class)
    s = str(sptd)
    if "MEDICAL" in c or "URGENT" in c:
        return "Medical office"
    if c in ("OFFICE BUILDING", "LOFT BUILDING", "TECHNICAL BUILDING", "BANK"):
        return "Office"
    if c == "OFFICE/SHOWROOM":
        return "Office/showroom (flex)"
    if any(k in c for k in ["RETAIL", "SHOPPING", "RESTAURANT", "SUPERMARKET", "COCKTAIL", "THEATER", "AUTOMOTIVE"]):
        return "Retail"
    if any(k in c for k in ["WAREHOUSE", "HANGAR", "INDUSTR", "MANUFACT"]):
        return "Industrial/storage"
    if "PARKING" in c:
        return "Parking (excluded)"
    if "LAND" in c or s.startswith("C"):
        return "Land (excluded)"
    if "APARTMENT" in c or s.startswith("B"):
        return "Apartment (excluded)"
    if "HOTEL" in c:
        return "Hotel (excluded)"
    if c == "nan":
        return "Unclassified"
    return "Other commercial"


def recent_cutoff() -> str:
    y = SETTINGS.get("recent_sale_years", 3)
    t = date.today()
    return t.replace(year=t.year - y).isoformat()


# ---------- Google polyline encoding (keeps data.json small) ----------
def polyline(points) -> str:
    """points: iterable of (lat, lon)."""
    res, pl, pn = [], 0, 0
    for la, lo in points:
        a, b = int(round(la * 1e5)), int(round(lo * 1e5))
        for v in (a - pl, b - pn):
            v = ~(v << 1) if v < 0 else (v << 1)
            while v >= 0x20:
                res.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            res.append(chr(v + 63))
        pl, pn = a, b
    return "".join(res)


def poly_rings(geom):
    """Exterior rings of a (multi)polygon as lists of (lat, lon)."""
    out = []
    polys = [geom] if geom.geom_type == "Polygon" else list(getattr(geom, "geoms", []))
    for pg in polys:
        if pg.geom_type != "Polygon" or pg.is_empty:
            continue
        out.append([(round(c[1], 5), round(c[0], 5)) for c in pg.exterior.coords])
    return out


# ---------- address normalization (NPI <-> DCAD) ----------
_SUFFIX = {"STREET": "ST", "AVENUE": "AVE", "ROAD": "RD", "DRIVE": "DR", "BOULEVARD": "BLVD", "LANE": "LN",
           "PARKWAY": "PKWY", "FREEWAY": "FWY", "EXPRESSWAY": "EXPY", "HIGHWAY": "HWY", "CIRCLE": "CIR",
           "COURT": "CT", "PLACE": "PL", "TRAIL": "TRL"}


def norm_street(s: str) -> str:
    s = (s or "").upper()
    s = re.sub(r"\b(NORTH|SOUTH|EAST|WEST)\b", lambda m: m.group(0)[0], s)
    s = re.sub(r"\bSO\b", "S", s)
    for a, b in _SUFFIX.items():
        s = re.sub(r"\b" + a + r"\b", b, s)
    s = re.sub(r"[^A-Z0-9 ]", "", s)
    s = re.sub(r"\s+(STE|SUITE|BLDG|FL|FLOOR|RM|ROOM|UNIT|APT|MC|TOWER)\b.*$", "", s)
    return re.sub(r"\s+", " ", s).strip()


def strip_suite(a: str) -> str:
    a = (a or "").upper()
    a = re.sub(r"\s*(,|\b(STE|SUITE|BLDG|BUILDING|FL|FLOOR|RM|ROOM|UNIT|APT|#|MAIL ?CODE|MC|DEPT|TOWER|PAVILION)\b).*$", "", a)
    a = re.sub(r"#.*$", "", a)
    return re.sub(r"\s+", " ", a).strip()
