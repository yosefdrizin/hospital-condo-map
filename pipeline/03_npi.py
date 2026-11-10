"""Step 3: physicians and clinicians practicing near each hospital (demand side).

1. Pull every individual provider (NPI-1) by practice-location ZIP from the CMS NPI Registry API
   for ZIPs that touch a hospital ring. The API returns at most 1,200 records per query, so
   large ZIPs are split by two-letter last-name prefix (recursively).
2. Geocode unique practice addresses with the Census batch geocoder; fall back to DCAD address match.
3. Match each address to its DCAD parcel and flag hospital / health-system-owned buildings.
   Join the CMS Doctors & Clinicians file (Medicare group affiliation): providers billing through a
   health-system medical group at that ZIP count on the hospital side even in an independent building.
4. Count per hospital within the radius, independent vs hospital side: physicians (MD/DO),
   dentists and other outpatient (groups in common.PROVIDER_GROUPS); practice locations (building + suite) in
   independent buildings; and all individual clinicians.

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

from common import (CACHE, CONFIG, CRS_FT, HEALTH_SYSTEM_PARCEL_RE, MILE_FT, OWNER_USER_GROUPS, PROC, RAW, SETTINGS, UA,
                    find_one, log, norm_street, provider_group, strip_suite, suite_of)

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


# ---------------- CMS Doctors & Clinicians (group affiliation) ----------------
CMS_DIR = RAW / "cms"
CMS_FILE = CMS_DIR / "dac_dfw.csv"
CMS_META = "https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/mj5m-pzi6"
# health-system medical groups (physician arms of the hospital owners); tuned against the 10/2026 file
# Not included on purpose: big independent or corporate groups (US Anesthesia Partners, Texas Oncology, WellMed/Optum,
# hospitalist companies, Methodist-CDI imaging JV) and look-alikes such as TEXAS HEALTH CARE PLLC.
SYSTEM_GROUP_RE = (r"UNIVERSITY OF TEXAS SOUTHWESTERN|UT SOUTHWESTERN|HEALTHTEXAS PROVIDER NETWORK|SCOTT AND WHITE|"
                   r"BAYLOR SCOTT|BAYLOR UNIVERSITY MEDICAL|BAYLOR ST\. LUKE|TEXAS HEALTH PHYSICIANS GROUP|"
                   r"TEXAS HEALTH RESOURCES|TEXAS HEALTH URGENT CARE|TEXAS HEALTH VIRTUAL CARE|HOSPITAL DISTRICT|PARKLAND|"
                   r"^MEDHEALTH\b|METHODIST MEDICAL GROUP|METHODIST HEALTH SYSTEM|DALLAS PHYSICIAN MEDICAL SERVICES FOR CHILDREN|"
                   r"CHILDREN'?S HEALTH|CHILDRENS MEDICAL CENTER|COOK CHILDRENS|^MEDICAL CITY|\bHCA\b|CHRISTUS|"
                   r"TEXAS SCOTTISH RITE|VETERANS AFFAIRS|UNIVERSITY OF TEXAS HEALTH SCIENCE|"
                   r"UNIVERSITY OF NORTH TEXAS HEALTH SCIENCE")
CMS_COLS = ["NPI", "Facility Name", "org_pac_id", "num_org_mem", "adr_ln_1", "City/Town", "State", "ZIP Code", "pri_spec"]


def cms_download(refresh=False):
    """Stream the CMS National Downloadable File (about 900 MB) and keep only Texas 75xxx/76xxx rows.
    CMS blocks scripted use of its filtered query API, so the whole file is read once; only the
    North Texas rows (a few MB) are saved."""
    if CMS_FILE.exists() and not refresh:
        return
    CMS_DIR.mkdir(parents=True, exist_ok=True)
    meta = requests.get(CMS_META, timeout=60).json()
    url = next(d["downloadURL"] for d in meta["distribution"] if d.get("downloadURL", "").lower().endswith(".csv"))
    log(f"CMS clinician file ({meta.get('modified')}): streaming about 900 MB, keeping North Texas rows")
    tmp = CMS_FILE.with_suffix(".tmp")
    n = kept = 0
    with requests.get(url, stream=True, timeout=600) as r, open(tmp, "w", newline="", encoding="utf-8") as out:
        r.raise_for_status()
        lines = (l.decode("utf-8", "replace") for l in r.iter_lines())
        rd = csv.reader(lines)
        head = next(rd)
        idx = [head.index(c) for c in CMS_COLS]
        st, zp = head.index("State"), head.index("ZIP Code")
        w = csv.writer(out)
        w.writerow(CMS_COLS + ["cms_as_of"])
        for row in rd:
            n += 1
            if len(row) > zp and row[st] == "TX" and row[zp][:2] in ("75", "76"):
                w.writerow([row[i] for i in idx] + [meta.get("modified", "")])
                kept += 1
            if n % 500000 == 0:
                log(f"  {n:,} rows read, {kept:,} kept")
    tmp.replace(CMS_FILE)
    log(f"CMS: {kept:,} North Texas rows of {n:,}")


def cms_affiliation(prov):
    """prov: DataFrame with npi, zip (practice ZIP from NPPES). Returns one row per npi with
    cms_match, cms_group, cms_group_size, sys_emp, cms_as_of.
    A provider is system-employed when the CMS group billed at the same ZIP is a health-system medical
    group (SYSTEM_GROUP_RE). With no row at that ZIP, all of the provider's North Texas groups must be
    health-system groups. No CMS record (common for dentists and non-Medicare providers): not flagged."""
    cms = pd.read_csv(CMS_FILE, dtype=str).rename(columns={"NPI": "npi", "Facility Name": "org", "num_org_mem": "size"})
    cms["z5"] = cms["ZIP Code"].str[:5]
    cms["sys"] = cms.org.fillna("").str.upper().str.contains(SYSTEM_GROUP_RE, regex=True)
    m = prov.drop_duplicates("npi").merge(cms, on="npi", how="inner")
    m["same"] = m.z5 == m.zip
    rows = []
    for npi, x in m.groupby("npi"):
        s = x[x.same]
        pick = s if len(s) else x
        sys = bool(s.sys.any()) if len(s) else bool(x.sys.all())
        grp = pick[pick.org.notna()].sort_values("sys", ascending=not sys)
        top = grp.iloc[0] if len(grp) else pick.iloc[0]
        rows.append((npi, True, top.org if isinstance(top.org, str) else "", top["size"], sys, top.cms_as_of))
    return pd.DataFrame(rows, columns=["npi", "cms_match", "cms_group", "cms_group_size", "sys_emp", "cms_as_of"])


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
    cms_download(refresh)
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
    g = g.merge(cms_affiliation(g[["npi", "zip"]]), on="npi", how="left")
    g["sys_emp"] = g.sys_emp.fillna(False).astype(bool)
    # hospital side = hospital-owned building OR billing through a health-system medical group (CMS)
    g["indep"] = ~g.hs_bldg & ~g.sys_emp
    g["grp"] = g.tcode.map(provider_group)
    g["phys"] = g.grp.eq("ph")
    # practice location = building + suite; providers sharing one are one potential suite buyer
    g["ploc"] = g.k2.fillna(g.key) + "|" + (g.a1.fillna("") + " " + g.a2.fillna("")).map(suite_of)

    radius = SETTINGS["radius_miles"] * MILE_FT
    per, A = {}, set()
    S = {k: set() for k in ("phOff", "phOn", "dnOff", "dnOn", "otOff", "otOn", "pxOff")}

    S["phSys"] = set()

    def sets(x):
        off, on = x[x.indep], x[~x.indep]
        return {"phOff": set(off[off.grp == "ph"].npi), "phOn": set(on[on.grp == "ph"].npi),
                "dnOff": set(off[off.grp == "dn"].npi), "dnOn": set(on[on.grp == "dn"].npi),
                "otOff": set(off[off.grp == "ot"].npi), "otOn": set(on[on.grp == "ot"].npi),
                "pxOff": set(off[off.grp.isin(OWNER_USER_GROUPS)].ploc),
                # physicians in independent buildings who bill through a health-system group (moved to the hospital side)
                "phSys": set(x[~x.hs_bldg & x.sys_emp & (x.grp == "ph")].npi)}

    for _, h in hg.iterrows():
        x = g[g.geometry.distance(h.geometry) <= radius]
        s = sets(x)
        per[h["name"]] = {k: len(v) for k, v in s.items()} | {"cl": int(len(x))}
        A |= set(x.npi)
        for k, v in s.items():
            S[k] |= v
    cms_as_of = g.cms_as_of.dropna().iloc[0] if g.cms_as_of.notna().any() else None
    out = {"per": per, "tot": {k: len(v) for k, v in S.items()} | {"cl": len(A)}, "as_of": date.today().isoformat(),
           "cms_as_of": cms_as_of}
    ph = g[(g.grp == "ph") & (g.geometry.distance(hg.geometry.union_all()) <= radius)]
    log(f"physicians within radius with a CMS record: {ph.cms_match.fillna(False).mean():.1%}")
    (PROC / "npi_counts.json").write_text(json.dumps(out, indent=1))
    g["par"] = g.par.map(lambda s: ";".join(sorted(s)) if s else "")
    g.drop(columns=["geometry"]).to_csv(PROC / "npi_providers_near.csv", index=False)
    log(f"totals: {out['tot']}")
    log("step 3 done")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-pull NPI records")
    main(ap.parse_args().refresh)
