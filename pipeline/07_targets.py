"""Step 7: PRIVATE workbook of buildings that could be bought and converted to condo suites.

Candidates: non-condo commercial buildings (office, medical office, flex, retail) within the radius of a hospital,
one titled owner on the parcel, not a hospital / health system, at least MIN_SF of building area.
Each row carries DCAD facts (size, year built, value, last deed, owner and mailing address) and the providers
practicing in that building per the NPI Registry (from step 3).

Writes outputs/private/ (git-ignored: the repo is public). Run after steps 3 and 5.
"""
import json

import pandas as pd
from importlib import import_module

from common import (DOCS, HEALTH_SYSTEM_PARCEL_RE, MILE_FT, OUT, PROC, RAW, SETTINGS, find_one, log, owner_class,
                    use_category)

condos_mod = import_module("02_condos")
site = import_module("05_build_site")
xl = import_module("06_build_excel")

PRIVATE = OUT / "private"
MIN_SF = 2500
KEEP_CODES = ("M", "O", "R")          # medical office, office (incl. flex), retail; see parcel_code in step 5
# main building classes that are rarely a suite-condo conversion
SKIP_CLASS_RE = r"SERVICE STATION|FAST FOOD|CONVENIENCE|AUTOMOTIVE|CAR WASH|SUPERMARKET|THEATER"
OWNER_TYPE = {"P": "Medical practice name", "I": "Investor / other"}


def main():
    PRIVATE.mkdir(parents=True, exist_ok=True)
    radius = SETTINGS["radius_miles"] * MILE_FT
    hg = condos_mod.hospitals()
    parcels = condos_mod.load_parcels()
    p = parcels[parcels.intersects(hg.geometry.buffer(radius).union_all())].copy()

    roll = RAW / "dcad_roll"
    ai = pd.read_csv(find_one(roll, "ACCOUNT_INFO.CSV"), dtype=str)
    ai["GIS_PARCEL_ID"] = ai.GIS_PARCEL_ID.str.strip()
    ai = ai[(ai.DIVISION_CD != "BPP") & ai.GIS_PARCEL_ID.isin(p.Acct)].copy()
    ay = pd.read_csv(find_one(roll, "ACCOUNT_APPRL_YEAR.CSV"), dtype=str, usecols=["ACCOUNT_NUM", "SPTD_CODE", "TOT_VAL"])
    ai = ai.merge(ay, on="ACCOUNT_NUM", how="left")
    ai["TOT_VAL"] = pd.to_numeric(ai.TOT_VAL, errors="coerce")
    cd = pd.read_csv(find_one(roll, "COM_DETAIL.CSV"), dtype=str)
    for c in ["GROSS_BLDG_AREA", "NET_LEASE_AREA", "YEAR_BUILT", "REMODEL_YR", "NUM_STORIES"]:
        cd[c] = pd.to_numeric(cd[c], errors="coerce")
    cda = cd.groupby("ACCOUNT_NUM").agg(SF=("GROSS_BLDG_AREA", "sum"), NRA=("NET_LEASE_AREA", "sum"), YR=("YEAR_BUILT", "min"),
                                        REM=("REMODEL_YR", "max"), ST=("NUM_STORIES", "max")).reset_index()
    big = cd.sort_values("GROSS_BLDG_AREA", ascending=False).drop_duplicates("ACCOUNT_NUM")
    ai = ai.merge(cda, on="ACCOUNT_NUM", how="left").merge(
        big[["ACCOUNT_NUM", "BLDG_CLASS_DESC", "PROPERTY_NAME", "PROPERTY_QUAL_DESC", "PROPERTY_COND_DESC"]], on="ACCOUNT_NUM", how="left")

    # drop condo regimes and anything already split into condo accounts
    legal = ai.LEGAL1.fillna("") + " " + ai.LEGAL2.fillna("") + " " + ai.LEGAL3.fillna("") + " " + ai.LEGAL4.fillna("")
    condo_par = set(ai[ai.GIS_PARCEL_ID.str.startswith("CONDO", na=False) | (ai.DIVISION_CD.eq("COM") & legal.str.contains(r"CONDO|CE ?%", regex=True))].GIS_PARCEL_ID)
    ai = ai[~ai.GIS_PARCEL_ID.isin(condo_par)]

    ai["code"] = [site.parcel_code(c, s, d) for c, s, d in zip(ai.BLDG_CLASS_DESC, ai.SPTD_CODE, ai.DIVISION_CD)]
    ai["owner"] = ai.OWNER_NAME1.fillna("").str.strip().str.upper()
    ai["deed"] = pd.to_datetime(ai.DEED_TXFR_DATE, errors="coerce")
    ai = ai.sort_values(["GIS_PARCEL_ID", "SF"], ascending=[True, False])
    b = ai.groupby("GIS_PARCEL_ID").agg(
        owners=("owner", "nunique"), owner=("OWNER_NAME1", "first"), owner2=("OWNER_NAME2", "first"),
        ml1=("OWNER_ADDRESS_LINE1", "first"), ml2=("OWNER_ADDRESS_LINE2", "first"), ml3=("OWNER_ADDRESS_LINE3", "first"),
        mcity=("OWNER_CITY", "first"), mst=("OWNER_STATE", "first"), mzip=("OWNER_ZIPCODE", "first"),
        num=("STREET_NUM", "first"), street=("FULL_STREET_NAME", "first"), city=("PROPERTY_CITY", "first"),
        name=("PROPERTY_NAME", "first"), cls=("BLDG_CLASS_DESC", "first"), sptd=("SPTD_CODE", "first"),
        qual=("PROPERTY_QUAL_DESC", "first"), cond=("PROPERTY_COND_DESC", "first"),
        codes=("code", lambda s: set(s)), SF=("SF", "sum"), NRA=("NRA", "sum"), YR=("YR", "min"), REM=("REM", "max"),
        ST=("ST", "max"), val=("TOT_VAL", "sum"), deed=("deed", "max"), acct=("ACCOUNT_NUM", "first"),
        accts=("ACCOUNT_NUM", "count")).reset_index()
    b["code"] = b.codes.map(lambda s: next((c for c in ("H", "M", "O", "R") if c in s), "C"))
    b["hs"] = b.owner.fillna("").str.upper().str.contains(HEALTH_SYSTEM_PARCEL_RE, regex=True) | b.code.eq("H")
    log(f"non-condo parcels within the radius with a DCAD account: {len(b):,}")
    poor_fit = b.cls.fillna("").str.contains(SKIP_CLASS_RE, regex=True)
    b = b[b.code.isin(KEEP_CODES) & ~b.hs & b.owners.eq(1) & (b.SF >= MIN_SF) & ~poor_fit].copy()
    log(f"candidate buildings (office / medical / retail, one owner, not hospital, {MIN_SF:,}+ SF): {len(b):,}")

    # distance to each hospital (campus point to nearest parcel edge, same rule as condos)
    geo = p.set_index("Acct").geometry
    geo = geo[~geo.index.duplicated()]
    g = geo.reindex(b.GIS_PARCEL_ID).values
    near = []
    for gm in g:
        d = sorted((round(gm.distance(h.geometry) / MILE_FT, 2), h["name"]) for _, h in hg.iterrows())
        near.append([x for x in d if x[0] <= SETTINGS["radius_miles"]])
    b["near"] = near

    # providers practicing in each building (NPI step 3)
    npi_f = PROC / "npi_providers_near.csv"
    pv = pd.read_csv(npi_f, dtype=str) if npi_f.exists() else pd.DataFrame(columns=["npi", "par", "grp", "ploc"])
    pv = pv[pv.par.fillna("") != ""].assign(par=lambda x: x.par.str.split(";")).explode("par")
    pv["oloc"] = pv.ploc.where(pv.grp.isin(["ph", "dn", "ot"]))
    cnt = pv.groupby("par").agg(ph=("grp", lambda s: (s == "ph").sum()), dn=("grp", lambda s: (s == "dn").sum()),
                                ot=("grp", lambda s: (s == "ot").sum()), cl=("npi", "nunique"),
                                px=("oloc", "nunique"))
    b = b.merge(cnt, left_on="GIS_PARCEL_ID", right_index=True, how="left")
    for c in ("ph", "dn", "ot", "cl", "px"):
        b[c] = b[c].fillna(0).astype(int)

    def s(v):
        return v.strip() if isinstance(v, str) else ""

    def mail(r):
        lines = [x for x in (r.ml1, r.ml2, r.ml3) if isinstance(x, str) and x.strip()]
        tail = " ".join(x for x in (s(r.mcity), s(r.mst), s(r.mzip)[:5]) if x)
        return ", ".join([*lines, tail])

    rows = []
    for r in b.sort_values(["SF"], ascending=False).itertuples():
        nh, nd = r.near[0][1], r.near[0][0]
        rows.append([nh, nd, len(r.near), f"{s(r.num)} {s(r.street)}".strip(), s(r.city),
                     r.name if isinstance(r.name, str) and r.name != "UNASSIGNED" else "", s(r.cls), use_category(r.cls, r.sptd),
                     int(r.SF), int(r.NRA) if r.NRA > 0 else None, int(r.YR) if r.YR > 0 else None,
                     int(r.REM) if r.REM > 0 else None, int(r.ST) if r.ST > 0 else None, s(r.qual), s(r.cond),
                     int(r.val) if pd.notna(r.val) else None, round(r.val / r.SF) if pd.notna(r.val) and r.SF else None,
                     r.deed.strftime("%Y-%m-%d") if pd.notna(r.deed) else "", s(r.owner), s(r.owner2),
                     OWNER_TYPE.get(owner_class(s(r.owner)), "Investor / other"), mail(r), s(r.mst),
                     r.ph, r.dn, r.ot, r.cl, r.px, r.accts, r.acct, r.GIS_PARCEL_ID])

    # ring summary from the site data (supply) + this step (candidates)
    d = json.loads((DOCS / "data.json").read_text())
    srows = []
    for h in sorted(d["hospitals"], key=lambda h: -h["b"]):
        mine = b[b.near.map(lambda n: any(x[1] == h["n"] for x in n))]
        demand = sum(h.get(k) or 0 for k in ("phOff", "dnOff", "otOff"))
        srows.append([h["n"], h["b"], h["u"], h["imu"], h["irec"], h.get("phOff"), h.get("dnOff"), h.get("otOff"), demand,
                      h.get("pxOff"), len(mine), int(mine.SF.sum()), int((mine.code == "M").sum()), int((mine.code == "O").sum()),
                      int((mine.code == "R").sum())])

    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Ring Summary"
    xl.sheet(ws, ["Hospital", "Licensed Beds", "Condo Suites", "Independent Medical Suites", "Indep. Medical Sold in Last 3 Yrs",
                  "Physicians in Indep. Bldgs", "Dentists in Indep. Bldgs", "Other Outpatient in Indep. Bldgs",
                  "Owner-user Providers in Indep. Bldgs", "Practice Locations in Indep. Bldgs", "Candidate Buildings",
                  "Candidate Bldg SF", "Candidates: Medical Office", "Candidates: Office / Flex", "Candidates: Retail"],
             srows, [44, 9, 9, 11, 11, 11, 11, 11, 12, 12, 10, 12, 10, 10, 10], {"L": "#,##0"})
    xl.sheet(wb.create_sheet("Candidate Buildings"),
             ["Nearest Hospital", "Distance (mi)", "Hospital Rings Containing", "Address", "City", "Property Name", "DCAD Bldg Class",
              "Use", "Bldg SF", "Net Leasable SF", "Yr Built", "Remodel Yr", "Stories", "DCAD Quality", "DCAD Condition",
              "DCAD Value", "Value / SF", "Latest Deed", "Owner", "Owner 2", "Owner Type", "Owner Mailing Address", "Owner State",
              "Physicians in Bldg", "Dentists in Bldg", "Other Outpatient in Bldg", "All Clinicians in Bldg",
              "Practice Locations in Bldg", "DCAD Accounts", "DCAD Account", "GIS Parcel ID"],
             rows, [38, 9, 9, 28, 12, 26, 24, 16, 10, 10, 8, 8, 7, 10, 10, 13, 9, 11, 34, 20, 18, 44, 7, 9, 9, 9, 9, 9, 8, 20, 20],
             {"B": "0.00", "I": "#,##0", "J": "#,##0", "P": "$#,##0", "Q": "$#,##0"})
    wm = wb.create_sheet("Method & Notes")
    notes = [
        ("Purpose", "Internal. Existing buildings near each hospital that could be bought and converted to medical condo suites, "
                    "next to condo supply and provider demand in the same 1-mile ring. Not for distribution: owner names and mailing addresses."),
        ("Candidates", f"Non-condo DCAD parcels within {SETTINGS['radius_miles']:g} mile of a hospital campus point (to the nearest parcel edge), "
                       f"main building class medical office / urgent care, office (incl. office/showroom, bank, loft, technical) or retail, "
                       f"one titled owner across all accounts on the parcel, at least {MIN_SF:,} SF, and not owned by a hospital or health system. "
                       "Multi-owner parcels, hospital-owned buildings, gas stations, fast food, convenience stores, auto, "
                       "car washes, supermarkets and theaters are left out."),
        ("Building facts", "DCAD commercial detail: gross building area, net leasable area, earliest year built, latest remodel year, "
                           "stories, DCAD quality and condition grades, total appraised value and latest deed transfer date. "
                           "Value / SF is DCAD value over gross SF, not a market price."),
        ("Owner type", "Owner-name screen: a name that reads like a medical practice, else investor / other. LLCs hide many owner-users."),
        ("Providers in building", "Individual NPI records whose practice address matches the parcel. Physicians = MD/DO; dentists; other outpatient = "
                                  "chiropractic, PT, OT, optometry, podiatry, psychology, counseling, clinical social work, MFT, audiology, speech. "
                                  "Practice locations = distinct building + suite among those three groups (approximate; many NPI addresses omit the suite)."),
        ("Ring summary", "Supply columns match the public map (docs/data.json). 'Indep.' = buildings not owned by a hospital or health system. "
                         "Owner-user providers = physicians + dentists + other outpatient. Rings overlap, so rows do not add to a county total."),
        ("Sources", f"DCAD {SETTINGS['dcad_year']} roll and parcel GIS ({d['asof']}); CMS NPI Registry pulled {d.get('npiAsOf', '')}; "
                    f"Census geocoder. Built {d['built']}."),
        ("CoStar", "Not yet joined. A CoStar export (address, RBA, vacancy, asking rent, for-sale status, last sale price) can be matched on address."),
    ]
    wm.append(["Item", "Detail"])
    for a_, b_ in notes:
        wm.append([a_, b_])
    for row in wm.iter_rows():
        for c in row:
            c.font = xl.F
            c.alignment = xl.Alignment(wrap_text=True, vertical="top")
    wm["A1"].font = xl.B
    wm["B1"].font = xl.B
    wm.column_dimensions["A"].width = 20
    wm.column_dimensions["B"].width = 120
    out = PRIVATE / "Hospital Ring Conversion Candidates (PRIVATE).xlsx"
    wb.save(out)
    log(f"wrote {out.relative_to(OUT.parent)} ({len(rows)} candidate buildings)")


if __name__ == "__main__":
    main()
