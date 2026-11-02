"""Step 3: physicians and clinicians practicing near each hospital (demand side).

1. Pull every individual provider (NPI-1) by practice-location ZIP from the CMS NPI Registry API
   for ZIPs that touch a hospital ring. The API returns at most 1,200 records per query, so
   large ZIPs are split by two-letter last-name prefix (recursively).
2. Geocode unique practice addresses with the Census batch geocoder; fall back to DCAD address match.
3. Match each address to its DCAD parcel and flag hospital / health-system-owned buildings.
4. Count per hospital within the radius: physicians (MD/DO taxonomy 20*) in independent vs
   hospital-owned buildings, and all individual clinicians.

Cache: data/cache/npi/<zip>.jsonl and data/cache/geocode.csv. Delete them to force a fresh pull.
Outputs: data/processed/npi_counts.json, data/processed/npi_providers_near.csv
"""
import argparse
import csv
import io
import json
import re
import string
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import geopandas as gpd
import numpy as np
import pandas as pd
import requests

from common import (CACHE, CONFIG, CRS_FT, HEALTH_SYSTEM_PARCEL_RE, MILE_FT, PROC, RAW, SETTINGS, UA, find_one, log,
                    norm_street, strip_suite)

NPI_API = "https://npiregistry.cms.hhs.gov/api/"
NPI_DIR = CACHE / "npi"
NPI_DIR.mkdir(parents=True, exist_ok=True)
GEO_CACHE = CACHE / "geocode.csv"


# ---------------- NPI pull ----------------
def q(**kw):
    params = {"version": "2.1", **kw}
    for k in range(5):
        try:
            r = requests.get(NPI_API, params=params, timeout=60, headers=UA)
            d = r.json()
            if "Errors" in d:
                return []
            return d.get("results", [])
        except Exception:  # noqa: BLE001
            time.sleep(1 + k)
    return None


def page_all(**kw):
    out = []
    for sk in range(0, 1001, 200):          # API caps skip at 1000 -> 1,200 records max
        rs = q(limit=200, skip=sk, **kw)
        if rs is None:
            return None, True
        out += rs
        if len(rs) < 200:
            return out, False
    return out, True


def slim(r):
    loc = [a for a in r.get("addresses", []) if a.get("address_purpose") == "LOCATION"]
    a = loc[0] if loc else {}
    tx = [t for t in r.get("taxonomies", []) if t.get("primary")] or r.get("taxonomies", [])[:1]
    t = tx[0] if tx else {}
    b = r.get("basic", {})
    return {"npi": r["number"], "first": b.get("first_name"), "last": b.get("last_name"), "cred": b.get("credential"),
            "enum": b.get("enumeration_date"), "tcode": t.get("code"), "tdesc": t.get("desc"), "a1": a.get("address_1"),
            "a2": a.get("address_2"), "city": a.get("city"), "st": a.get("state"), "zip": (a.get("postal_code") or "")[:5],
            "phone": a.get("telephone_number")}


def pull_zip(z):
    f = NPI_DIR / f"{z}.jsonl"
    if f.exists():
        return z, "cached"
    base = dict(postal_code=z, enumeration_type="NPI-1", address_purpose="LOCATION", state="TX")
    res, cap = page_all(**base)
    if res is None:
        return z, "failed"
    recs = {}
    if not cap:
        for r in res:
            recs[r["number"]] = slim(r)
    else:
        stack = [a + b for a in string.ascii_uppercase for b in string.ascii_uppercase]
        while stack:
            pre = stack.pop()
            rr, c = page_all(last_name=pre + "*", **base)
            if rr is None:
                continue
            if c:
                stack += [pre + l for l in string.ascii_uppercase]
            for r in rr:
                recs[r["number"]] = slim(r)
    tmp = f.with_suffix(".tmp")
    with open(tmp, "w") as fh:
        for v in recs.values():
            fh.write(json.dumps(v) + "\n")
    tmp.replace(f)
    return z, len(recs)


def ring_zips(parcels, hg, ai):
    buf = hg.geometry.buffer(1.05 * SETTINGS["radius_miles"] * MILE_FT).union_all()
    near = parcels[parcels.intersects(buf)]
    z = ai[ai.GIS_PARCEL_ID.isin(near.Acct)].PROPERTY_ZIPCODE.fillna("").str.strip().str[:5]
    zips = sorted(set(z[z.str.match(r"^7[5-9]\d{3}$")]) | set(SETTINGS.get("extra_npi_zips", [])))
    return zips


# ---------------- geocoding ----------------
def census_batch(rows):
    """rows: list of (id, street, city, state, zip). Returns {id: (lat, lon)}."""
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    for k in range(3):
        try:
            r = requests.post("https://geocoding.geo.census.gov/geocoder/locations/addressbatch",
                              files={"addressFile": ("a.csv", buf.getvalue())}, data={"benchmark": "Public_AR_Current"},
                              timeout=900, headers=UA)
            out = {}
            for rec in csv.reader(io.StringIO(r.text)):
                if len(rec) >= 6 and rec[2] == "Match" and rec[5]:
                    lon, lat = map(float, rec[5].split(","))
                    out[rec[0]] = (lat, lon)
            return out
        except Exception as e:  # noqa: BLE001
            log(f"  geocoder retry {k + 1}: {e}")
            time.sleep(10)
    return {}


def main(refresh=False):
    from importlib import import_module
    condos = import_module("02_condos")
    parcels = condos.load_parcels()
    hg = condos.hospitals()
    roll = RAW / "dcad_roll"
    ai = pd.read_csv(find_one(roll, "ACCOUNT_INFO.CSV"), dtype=str,
                     usecols=["ACCOUNT_NUM", "STREET_NUM", "FULL_STREET_NAME", "PROPERTY_ZIPCODE", "GIS_PARCEL_ID", "OWNER_NAME1", "DIVISION_CD"])
    ai = ai[ai.DIVISION_CD != "BPP"].copy()
    ai["GIS_PARCEL_ID"] = ai.GIS_PARCEL_ID.str.strip()

    if refresh:
        for f in NPI_DIR.glob("*.jsonl"):
            f.unlink()
    zips = ring_zips(parcels, hg, ai)
    log(f"NPI pull for {len(zips)} ZIPs (cached ZIPs are skipped)")
    with ThreadPoolExecutor(6) as ex:
        for z, r in ex.map(pull_zip, zips):
            if r != "cached":
                log(f"  {z}: {r}")
    rows = [json.loads(l) for z in zips if (NPI_DIR / f"{z}.jsonl").exists() for l in open(NPI_DIR / f"{z}.jsonl")]
    df = pd.DataFrame(rows).drop_duplicates("npi")
    df = df[df.st == "TX"].copy()
    df["street"] = df.a1.map(strip_suite)
    df["key"] = df.street + "|" + df.city.fillna("").str.upper() + "|" + df.zip
    log(f"providers: {len(df):,}")

    # geocode cache
    geo = pd.read_csv(GEO_CACHE, dtype={"key": str}) if GEO_CACHE.exists() else pd.DataFrame(columns=["key", "lat", "lon", "src"])
    have = set(geo.key)
    todo = df.drop_duplicates("key")[["key", "street", "city", "zip"]]
    todo = todo[~todo.key.isin(have)].reset_index(drop=True)
    log(f"addresses to geocode: {len(todo):,}")
    new = []
    for k0 in range(0, len(todo), 9000):
        part = todo.iloc[k0:k0 + 9000]
        res = census_batch([(str(i), r.street, r.city, "TX", r.zip) for i, r in part.iterrows()])
        for i, r in part.iterrows():
            if str(i) in res:
                new.append((r.key, *res[str(i)], "census"))
    # DCAD fallback for misses
    parcel_pts = parcels.set_index("Acct").geometry.representative_point().to_crs(4326)
    ai["k"] = ai.STREET_NUM.fillna("").str.strip() + " " + ai.FULL_STREET_NAME.fillna("").map(norm_street) + "|" + ai.PROPERTY_ZIPCODE.fillna("").str.strip().str[:5]
    kmap = ai[ai.GIS_PARCEL_ID.isin(parcel_pts.index)].drop_duplicates("k").set_index("k").GIS_PARCEL_ID
    got = {n[0] for n in new}
    for r in todo.itertuples():
        if r.key in got:
            continue
        m = re.match(r"^(\d+)\s+(.*)$", r.street or "")
        if m:
            k = m.group(1) + " " + norm_street(m.group(2)) + "|" + r.zip
            if k in kmap.index:
                g = parcel_pts[kmap[k]]
                new.append((r.key, g.y, g.x, "dcad"))
    got = {n[0] for n in new}
    new += [(k, np.nan, np.nan, "none") for k in todo.key if k not in got]   # remember misses so they aren't retried
    if new:
        geo = pd.concat([geo, pd.DataFrame(new, columns=["key", "lat", "lon", "src"])]).drop_duplicates("key")
        geo.to_csv(GEO_CACHE, index=False)
    df = df.merge(geo[["key", "lat", "lon"]], on="key", how="left")
    log(f"geocoded {df.lat.notna().mean():.1%} of providers")

    g = df[df.lat.notna()].copy()
    g = gpd.GeoDataFrame(g, geometry=gpd.points_from_xy(g.lon, g.lat), crs=4326).to_crs(CRS_FT)
    g = g[g.geometry.distance(hg.geometry.union_all()) <= SETTINGS["radius_miles"] * MILE_FT + 120].copy()

    # hospital / health-system parcels
    p = parcels[parcels.intersects(hg.geometry.buffer(6000).union_all())]
    a2 = ai[ai.GIS_PARCEL_ID.isin(p.Acct)]
    cd = pd.read_csv(find_one(roll, "COM_DETAIL.CSV"), dtype=str, usecols=["ACCOUNT_NUM", "BLDG_CLASS_DESC"])
    hs_acct = set(a2[a2.OWNER_NAME1.fillna("").str.upper().str.contains(HEALTH_SYSTEM_PARCEL_RE, regex=True)].ACCOUNT_NUM) | \
        set(cd[cd.BLDG_CLASS_DESC == "HOSPITAL"].ACCOUNT_NUM)
    hs_par = set(a2[a2.ACCOUNT_NUM.isin(hs_acct)].GIS_PARCEL_ID) | set(gpd.sjoin(hg[["geometry"]], p, predicate="within").Acct)
    a2 = a2.assign(k2=a2.STREET_NUM.fillna("").str.strip() + " " + a2.FULL_STREET_NAME.fillna("").map(norm_street))
    kpar = a2.groupby("k2").GIS_PARCEL_ID.agg(lambda s: set(s))

    def key(a):
        a = norm_street(re.sub(r"#.*$", "", a or ""))
        m = re.match(r"^(\d+)\s+(.*)$", a)
        return (m.group(1) + " " + m.group(2)) if m else None

    g["k2"] = g.a1.map(key)
    g["par"] = g.k2.map(lambda k: kpar.get(k) if k else None)
    miss = g.par.isna()
    nn = gpd.sjoin_nearest(g[miss][["geometry"]], p[["Acct", "geometry"]], max_distance=150, how="left")
    nn = nn[~nn.index.duplicated()]
    g.loc[miss, "par"] = nn.Acct.map(lambda a: {a} if isinstance(a, str) else None)
    g["hs_bldg"] = g.par.map(lambda s: bool(s) and len(s & hs_par) > 0)
    g["phys"] = g.tcode.fillna("").str.startswith("20")

    radius = SETTINGS["radius_miles"] * MILE_FT
    per, A, PI, PH = {}, set(), set(), set()
    for _, h in hg.iterrows():
        x = g[g.geometry.distance(h.geometry) <= radius]
        per[h["name"]] = {"phOff": int((x.phys & ~x.hs_bldg).sum()), "phOn": int((x.phys & x.hs_bldg).sum()), "cl": int(len(x))}
        A |= set(x.npi); PI |= set(x[x.phys & ~x.hs_bldg].npi); PH |= set(x[x.phys & x.hs_bldg].npi)
    out = {"per": per, "tot": {"phOff": len(PI), "phOn": len(PH), "cl": len(A)}, "as_of": date.today().isoformat()}
    (PROC / "npi_counts.json").write_text(json.dumps(out, indent=1))
    g.drop(columns=["geometry", "par"]).to_csv(PROC / "npi_providers_near.csv", index=False)
    log(f"totals: {out['tot']}")
    log("step 3 done")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-pull NPI records")
    main(ap.parse_args().refresh)
