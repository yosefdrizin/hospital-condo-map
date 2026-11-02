"""Step 2: build the commercial condo universe and match it to hospitals.

Outputs (data/processed/):
  condo_units.csv        one row per DCAD commercial condo account (all regimes in the county)
  hospital_regimes.csv   hospital x condo regime pairs within the radius, with distance
  regimes.gpkg           regime parcel geometry (EPSG:2276) for regimes near a hospital
Also caches the full parcel layer as data/cache/parcels.pkl for later steps.
"""
import geopandas as gpd
import numpy as np
import pandas as pd

from common import CACHE, CONFIG, CRS_FT, MILE_FT, PROC, RAW, SETTINGS, find_one, log, owner_class, use_category


def load_parcels():
    pk = CACHE / "parcels.pkl"
    if pk.exists():
        return pd.read_pickle(pk)
    shp = find_one(RAW / "parcels", "PARCEL*.shp")
    log(f"reading parcels {shp.name} (slow the first time)")
    p = gpd.read_file(shp, columns=["Acct"])
    p["Acct"] = p.Acct.astype(str).str.strip()
    p = p.set_crs(CRS_FT, allow_override=True)
    p.to_pickle(pk)
    return p


def hospitals():
    h = pd.read_csv(CONFIG / "hospitals.csv")
    return gpd.GeoDataFrame(h, geometry=gpd.points_from_xy(h.lon, h.lat), crs=4326).to_crs(CRS_FT)


def main():
    roll = RAW / "dcad_roll"
    log("reading DCAD roll")
    ai = pd.read_csv(find_one(roll, "ACCOUNT_INFO.CSV"), dtype=str)
    ay = pd.read_csv(find_one(roll, "ACCOUNT_APPRL_YEAR.CSV"), dtype=str, usecols=["ACCOUNT_NUM", "SPTD_CODE", "TOT_VAL"])
    cd = pd.read_csv(find_one(roll, "COM_DETAIL.CSV"), dtype=str)
    for c in ["GROSS_BLDG_AREA", "NET_LEASE_AREA", "YEAR_BUILT"]:
        cd[c] = pd.to_numeric(cd[c], errors="coerce")
    ai = ai.merge(ay, on="ACCOUNT_NUM", how="left")
    ai["GIS_PARCEL_ID"] = ai.GIS_PARCEL_ID.str.strip()

    com = ai[ai.DIVISION_CD == "COM"].copy()
    legal = com.LEGAL1.fillna("") + " " + com.LEGAL2.fillna("") + " " + com.LEGAL3.fillna("") + " " + com.LEGAL4.fillna("")
    com["is_condo"] = com.GIS_PARCEL_ID.str.startswith("CONDO", na=False) | legal.str.contains(r"CONDO|CE ?%", regex=True)
    cu = com[com.is_condo].copy()

    agg = cd.groupby("ACCOUNT_NUM").agg(SF=("GROSS_BLDG_AREA", "sum"), NRA=("NET_LEASE_AREA", "sum"), YR=("YEAR_BUILT", "min")).reset_index()
    cls = cd.sort_values("GROSS_BLDG_AREA", ascending=False).drop_duplicates("ACCOUNT_NUM")[["ACCOUNT_NUM", "BLDG_CLASS_DESC", "PROPERTY_NAME"]]
    cu = cu.merge(agg, on="ACCOUNT_NUM", how="left").merge(cls, on="ACCOUNT_NUM", how="left")
    cu["regime"] = cu.GIS_PARCEL_ID
    cu["addr"] = (cu.STREET_NUM.fillna("").str.strip() + " " + cu.FULL_STREET_NAME.fillna("").str.strip()).str.strip()
    cu["TOT_VAL"] = pd.to_numeric(cu.TOT_VAL, errors="coerce")
    cu["use"] = [use_category(b, s) for b, s in zip(cu.BLDG_CLASS_DESC, cu.SPTD_CODE)]
    cu["counted"] = ~cu.use.str.contains("excluded")
    cu["owner_class"] = cu.OWNER_NAME1.map(owner_class)
    cu["deed"] = pd.to_datetime(cu.DEED_TXFR_DATE, errors="coerce")
    log(f"commercial condo accounts in county: {len(cu):,} in {cu.regime.nunique():,} regimes")

    p = load_parcels()
    rg = p[p.Acct.isin(cu.regime.unique())].dissolve(by="Acct").reset_index()
    missing = set(cu.regime) - set(rg.Acct)
    if missing:
        log(f"  {len(missing)} regimes have no parcel geometry (skipped)")

    hg = hospitals()
    radius = SETTINGS["radius_miles"] * MILE_FT
    rows = []
    for _, h in hg.iterrows():
        d = rg.geometry.distance(h.geometry)   # to nearest edge of the regime parcel
        for i in np.where(d <= radius)[0]:
            rows.append({"hospital": h["name"], "regime": rg.Acct.iloc[i], "dist_mi": round(d.iloc[i] / MILE_FT, 2)})
    pairs = pd.DataFrame(rows)
    # keep only regimes that hold at least one counted unit
    counted_regimes = set(cu[cu.counted].regime)
    pairs = pairs[pairs.regime.isin(counted_regimes)]
    log(f"hospital x regime pairs: {len(pairs)}; unique regimes: {pairs.regime.nunique()}")

    keep = ["ACCOUNT_NUM", "regime", "LEGAL1", "LEGAL3", "addr", "STREET_NUM", "FULL_STREET_NAME", "UNIT_ID", "BLDG_ID", "PROPERTY_CITY",
            "OWNER_NAME1", "OWNER_NAME2", "BLDG_CLASS_DESC", "PROPERTY_NAME",
            "SPTD_CODE", "SF", "NRA", "YR", "TOT_VAL", "DEED_TXFR_DATE", "use", "counted", "owner_class"]
    cu[keep].to_csv(PROC / "condo_units.csv", index=False)
    pairs.to_csv(PROC / "hospital_regimes.csv", index=False)
    rg[rg.Acct.isin(pairs.regime)].to_file(PROC / "regimes.gpkg", driver="GPKG")
    log("step 2 done")


if __name__ == "__main__":
    main()
