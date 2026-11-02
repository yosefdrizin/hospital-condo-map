"""Step 5: build docs/data.json for the map page.

Combines: context parcels around each hospital (by use), condo regimes with unit detail and ownership,
hospital stats (supply + NPI demand), countywide de-duplicated totals, and Census TIGER street lines.
"""
import json
from datetime import date

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from importlib import import_module

from common import (CONFIG, CRS_FT, DOCS, MILE_FT, PROC, RAW, SETTINGS, find_one, log, poly_rings, polyline,
                    recent_cutoff)

condos_mod = import_module("02_condos")

PRI = {"H": 0, "M": 1, "O": 2, "R": 3, "I": 4, "C": 5, "A": 6, "Y": 7, "V": 8}


def parcel_code(c, sptd, div):
    c = str(c)
    if "HOSPITAL" in c and "VETERIN" not in c and "CONVALES" not in c:
        return "H"
    if "MEDICAL" in c or "URGENT" in c:
        return "M"
    if c in ("OFFICE BUILDING", "LOFT BUILDING", "TECHNICAL BUILDING", "BANK", "OFFICE/SHOWROOM"):
        return "O"
    if any(k in c for k in ["RETAIL", "SHOPPING", "RESTAURANT", "SUPERMARKET", "COCKTAIL", "THEATER", "AUTOMOTIVE", "SERVICE STATION", "FAST FOOD", "CONVENIENCE"]):
        return "R"
    if any(k in c for k in ["WAREHOUSE", "HANGAR", "INDUSTR", "MANUFACT", "STORAGE"]):
        return "I"
    if "APARTMENT" in c:
        return "A"
    if div == "RES":
        return "Y"
    s = str(sptd)
    if c in ("nan", "LAND ONLY", "VACANT") or s.startswith("C") or s.startswith("D"):
        return "V"
    return "C"


def clean(v):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.floating):
        return float(v)
    return v


def mode(s):
    s = s.dropna()
    s = s[s.astype(str).str.len() > 0]
    return s.mode().iloc[0] if len(s) else ""


def structure(units, excl, owners, largest_units):
    if excl > 0 and excl >= units * 0.5:
        return "Mixed-use master condo"
    if owners == 1 or largest_units / units >= 0.75:
        return "Single-owner / controlled"
    if excl > 0:
        return "Mixed-use master condo"
    return "Owner-user suite condo"


def main():
    radius = SETTINGS["radius_miles"] * MILE_FT
    hcsv = pd.read_csv(CONFIG / "hospitals.csv")
    hg = condos_mod.hospitals()
    cu = pd.read_csv(PROC / "condo_units.csv", dtype={"ACCOUNT_NUM": str, "regime": str, "UNIT_ID": str})
    cu["counted"] = cu.counted.astype(str).eq("True")
    pairs = pd.read_csv(PROC / "hospital_regimes.csv", dtype={"regime": str})
    rg = gpd.read_file(PROC / "regimes.gpkg").to_crs(4326)
    cutoff = recent_cutoff()

    # ---------- condo regimes ----------
    condos = []
    for regime, grp in pairs.groupby("regime"):
        allu = cu[cu.regime == regime]
        c = allu[allu.counted]
        if c.empty:
            continue
        geom = rg[rg.Acct == regime].geometry
        if geom.empty:
            continue
        excl = len(allu) - len(c)
        top = c.OWNER_NAME1.value_counts()
        st = structure(len(c), excl, c.OWNER_NAME1.nunique(), int(top.iloc[0]))
        deeds = pd.to_datetime(c.DEED_TXFR_DATE, errors="coerce")
        med = c.use.eq("Medical office")
        hosp_owned = c.owner_class.eq("H")
        rec = {
            "id": regime, "p": str(mode(c.LEGAL1)).strip(), "a": mode(c.addr), "city": mode(c.PROPERTY_CITY), "s": st,
            "u": mode(c.use), "cu": int(len(c)), "mu": int(med.sum()),
            "sf": int(c.SF.fillna(0).sum()) or None, "y": int(c.YR.min()) if c.YR.notna().any() and c.YR.min() > 0 else None,
            "ow": int(c.OWNER_NAME1.nunique()), "lo": top.index[0],
            "mix": ", ".join(f"{k} {v}" for k, v in c.use.value_counts().items()),
            "val": int(c.TOT_VAL.fillna(0).sum()) or None,
            "deed": deeds.max().strftime("%Y-%m-%d") if deeds.notna().any() else None,
            "near": [[r.hospital, float(r.dist_mi)] for r in grp.sort_values("dist_mi").itertuples()],
            "ho": int(hosp_owned.sum()), "ind": int((~hosp_owned).sum()), "imu": int((med & ~hosp_owned).sum()),
            "irec": int((med & ~hosp_owned & (deeds >= cutoff)).sum()),
        }
        rec["inm"] = rec["ind"] - rec["imu"]
        rec["oc"] = "H" if rec["ho"] > 0 and rec["ho"] * 2 >= rec["cu"] else ("M" if rec["imu"] > 0 and rec["imu"] >= rec["inm"] else "N")
        units = []
        for x in allu.sort_values(["addr", "UNIT_ID"], na_position="first").itertuples():
            d = pd.to_datetime(x.DEED_TXFR_DATE, errors="coerce")
            units.append([str(x.UNIT_ID) if isinstance(x.UNIT_ID, str) else "", x.OWNER_NAME1 if isinstance(x.OWNER_NAME1, str) else "",
                          x.use, int(x.SF) if pd.notna(x.SF) else None, int(x.YR) if pd.notna(x.YR) and x.YR > 0 else None,
                          int(x.TOT_VAL) if pd.notna(x.TOT_VAL) else None, d.strftime("%Y-%m-%d") if pd.notna(d) else "",
                          "Yes" if x.counted else "No", x.owner_class == "P", x.ACCOUNT_NUM, x.addr, x.owner_class])
        rec["units"] = units
        g = shapely.set_precision(geom.iloc[0].simplify(0.000008, preserve_topology=True), 0.00001)
        rec["g"] = [polyline(r) for r in poly_rings(g)]
        condos.append(rec)
    log(f"condo regimes on map: {len(condos)}")

    # ---------- hospitals ----------
    npi = json.loads((PROC / "npi_counts.json").read_text()) if (PROC / "npi_counts.json").exists() else {"per": {}, "tot": {}}
    hosp = []
    for r in hcsv.itertuples():
        cs = [c for c in condos if any(n[0] == r.name for n in c["near"])]
        dists = [next(n[1] for n in c["near"] if n[0] == r.name) for c in cs]
        h = {"n": r.name, "sys": r.system, "b": int(r.beds), "lat": r.lat, "lon": r.lon, "ad": f"{r.address}, {r.city}",
             "note": r.notes if isinstance(r.notes, str) else "",
             "pj": len(cs), "opj": sum(c["s"] == "Owner-user suite condo" for c in cs),
             "u": sum(c["cu"] for c in cs), "ou": sum(c["cu"] for c in cs if c["s"] == "Owner-user suite condo"),
             "mu": sum(c["mu"] for c in cs), "q": sum(d <= 0.25 for d in dists), "near": min(dists) if dists else None}
        for k in ("ho", "ind", "imu", "inm", "irec"):
            h[k] = sum(c[k] for c in cs)
        h.update(npi["per"].get(r.name, {}))
        hosp.append(h)

    # ---------- context parcels ----------
    log("context parcels")
    parcels = condos_mod.load_parcels()
    area = hg.geometry.buffer(SETTINGS["context_parcel_radius_miles"] * MILE_FT).union_all()
    p = parcels[parcels.intersects(area)].copy()
    roll = RAW / "dcad_roll"
    ai = pd.read_csv(find_one(roll, "ACCOUNT_INFO.CSV"), dtype=str)
    ai["GIS_PARCEL_ID"] = ai.GIS_PARCEL_ID.str.strip()
    ai = ai[(ai.DIVISION_CD != "BPP") & ai.GIS_PARCEL_ID.isin(p.Acct)]
    ay = pd.read_csv(find_one(roll, "ACCOUNT_APPRL_YEAR.CSV"), dtype=str, usecols=["ACCOUNT_NUM", "SPTD_CODE", "TOT_VAL"])
    ai = ai.merge(ay, on="ACCOUNT_NUM", how="left")
    ai["TOT_VAL"] = pd.to_numeric(ai.TOT_VAL, errors="coerce")
    cd = pd.read_csv(find_one(roll, "COM_DETAIL.CSV"), dtype=str)
    for c in ["GROSS_BLDG_AREA", "YEAR_BUILT", "NUM_STORIES"]:
        cd[c] = pd.to_numeric(cd[c], errors="coerce")
    cda = cd.groupby("ACCOUNT_NUM").agg(SF=("GROSS_BLDG_AREA", "sum"), YR=("YEAR_BUILT", "min")).reset_index()
    cls = cd.sort_values("GROSS_BLDG_AREA", ascending=False).drop_duplicates("ACCOUNT_NUM")[["ACCOUNT_NUM", "BLDG_CLASS_DESC", "PROPERTY_NAME"]]
    ai = ai.merge(cda, on="ACCOUNT_NUM", how="left").merge(cls, on="ACCOUNT_NUM", how="left")
    ai["addr"] = (ai.STREET_NUM.fillna("").str.strip() + " " + ai.FULL_STREET_NAME.fillna("").str.strip()).str.strip()
    ai["code"] = [parcel_code(c, s, d) for c, s, d in zip(ai.BLDG_CLASS_DESC, ai.SPTD_CODE, ai.DIVISION_CD)]
    ai["pr"] = ai.code.map(PRI)
    ai = ai.sort_values(["GIS_PARCEL_ID", "pr", "SF"], ascending=[True, True, False])
    summ = ai.groupby("GIS_PARCEL_ID").agg(code=("code", "first"), addr=("addr", "first"), owner=("OWNER_NAME1", "first"),
                                           cls=("BLDG_CLASS_DESC", "first"), name=("PROPERTY_NAME", "first"), SF=("SF", "sum"),
                                           YR=("YR", "min"), val=("TOT_VAL", "sum"), n=("ACCOUNT_NUM", "count"),
                                           acct=("ACCOUNT_NUM", "first")).reset_index()
    p = p.merge(summ, left_on="Acct", right_on="GIS_PARCEL_ID", how="left")
    p["code"] = p.code.fillna("V")
    regime_ids = {c["id"] for c in condos}
    p = p[~p.Acct.isin(regime_ids)].to_crs(4326)
    p["geometry"] = shapely.set_precision(p.geometry.simplify(0.000008, preserve_topology=True).values, 0.00001)
    parcels_out = []
    for r in p.itertuples():
        rings = poly_rings(r.geometry)
        if not rings:
            continue
        rec = {"g": [polyline(x) for x in rings], "c": r.code}
        if isinstance(r.addr, str) and r.addr and r.code != "Y":
            rec["a"] = r.addr
        if r.code not in ("Y", "V") or (r.code == "V" and isinstance(r.owner, str)):
            extra = {"o": r.owner, "k": r.cls if isinstance(r.cls, str) else None,
                     "nm": r.name if isinstance(r.name, str) and r.name != "UNASSIGNED" else None,
                     "sf": int(r.SF) if pd.notna(r.SF) and r.SF > 0 else None, "y": int(r.YR) if pd.notna(r.YR) and r.YR > 0 else None,
                     "v": int(r.val) if pd.notna(r.val) else None, "n": int(r.n) if pd.notna(r.n) and r.n > 1 else None, "ac": r.acct}
            rec.update({k: clean(v) for k, v in extra.items() if clean(v) is not None})
        parcels_out.append(rec)
    log(f"context parcels: {len(parcels_out):,}")

    # ---------- roads ----------
    rd = gpd.read_file(find_one(RAW / "roads", "*.shp")).to_crs(CRS_FT)
    rarea = hg.geometry.buffer(SETTINGS["road_radius_miles"] * MILE_FT).union_all()
    rd = gpd.clip(rd[rd.intersects(rarea)], rarea).to_crs(4326)
    rd["geometry"] = rd.geometry.simplify(0.00003)
    roads = []
    for r in rd.itertuples():
        t = {"S1100": 1, "S1200": 2, "S1400": 3, "S1630": 2, "S1640": 3}.get(r.MTFCC)
        if not t:
            continue
        geoms = [r.geometry] if r.geometry.geom_type == "LineString" else list(getattr(r.geometry, "geoms", []))
        for gm in geoms:
            if gm.geom_type != "LineString" or gm.is_empty:
                continue
            roads.append({"t": t, "n": r.FULLNAME if isinstance(r.FULLNAME, str) else "", "g": polyline([(c[1], c[0]) for c in gm.coords])})

    sm = lambda k: sum(c.get(k, 0) for c in condos)  # noqa: E731
    totals = {"u": sm("cu"), "mu": sm("mu"), "ho": sm("ho"), "ind": sm("ind"), "imu": sm("imu"), "irec": sm("irec"), **npi.get("tot", {})}
    data = {"hospitals": hosp, "condos": condos, "parcels": parcels_out, "roads": roads, "totals": totals,
            "asof": f"DCAD {SETTINGS['dcad_year']} roll", "npiAsOf": npi.get("as_of", ""), "recentCutoff": cutoff,
            "built": date.today().isoformat()}
    (DOCS / "data.json").write_text(json.dumps(data, separators=(",", ":")))
    log(f"totals: {totals}")
    log(f"docs/data.json written ({(DOCS / 'data.json').stat().st_size / 1e6:.1f} MB)")
    log("step 5 done")


if __name__ == "__main__":
    main()
