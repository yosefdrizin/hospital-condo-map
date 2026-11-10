"""Step 7: PRIVATE workbook of buildings that could be bought and converted to condo suites.

Candidates: non-condo commercial buildings (office, medical office, flex, retail) within the radius of a hospital,
one titled owner on the parcel, not a hospital / health system, at least MIN_SF of building area.
Each row carries DCAD facts (size, year built, value, last deed, owner and mailing address) and the providers
practicing in that building per the NPI Registry (from step 3).

Writes outputs/private/ (git-ignored: the repo is public). Run after steps 3 and 5.
"""
import gzip
import json
import math
import os
import re
import secrets

import geopandas as gpd
import pandas as pd
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from importlib import import_module

from common import (CACHE, CRS_FT, DOCS, HEALTH_SYSTEM_PARCEL_RE, MILE_FT, OUT, PROC, RAW, SETTINGS, find_one, log, norm_street,
                    owner_class, poly_rings, polyline, strip_suite, suite_of, use_category)

condos_mod = import_module("02_condos")
site = import_module("05_build_site")
xl = import_module("06_build_excel")

PRIVATE = OUT / "private"
MAP_URL = "https://yosefdrizin.github.io/hospital-condo-map/"
KDF_ROUNDS = 310000                   # must match docs/deal_layer.js
MIN_SF = 2500
KEEP_CODES = ("M", "O", "R")          # medical office, office (incl. flex), retail; see parcel_code in step 5
# main building classes that are rarely a suite-condo conversion
SKIP_CLASS_RE = r"SERVICE STATION|FAST FOOD|CONVENIENCE|AUTOMOTIVE|CAR WASH|SUPERMARKET|THEATER"
# sale conditions whose price does not reflect a plain market sale of that property
COMP_SKIP_RE = r"Bulk/Portfolio|Ground Lease|Partial Interest|Business Value|Entity Buy|REO|Auction|Lease Option|Build to Suit|Double Escrow"
COMP_HEAD = ["Comp ID", "CoStar ID", "Address", "City", "County", "Segment", "Property Type", "Secondary Type", "Class", "Yr Built", "SF",
             "Sale Date", "Sale Status", "Sale Type", "Sale Price", "Price / SF", "Asking Price", "Asking / SF", "Cap Rate", "Sale Condition",
             "Price Treatment", "Nearest Hospital", "Distance (mi)", "In 1-mile Ring", "Buyer (True)", "Seller (True)"]
COMP_W = [10, 10, 34, 13, 9, 15, 22, 16, 6, 7, 8, 11, 9, 12, 12, 8, 12, 8, 7, 24, 26, 34, 8, 7, 28, 28]
COMP_FMT = {"K": "#,##0", "O": "$#,##0", "P": "$#,##0", "Q": "$#,##0", "R": "$#,##0", "W": "0.00"}
SBA_NAICS = ("6211", "6212", "6213", "6214")     # offices of physicians, dentists, other practitioners; outpatient centers
SBA_COUNTIES = ("DALLAS", "COLLIN", "DENTON", "TARRANT")
SBA_MIN_TERM = 240                                # a long 7(a) term usually means real estate; the data has no purpose field
# Default ranking settings. The map lets the owner change every one of these live; they're saved in his browser.
# Weights inside each group are relative (they're divided by the group total). Values in useVal are 0-100.
# Path on the map: Areas (where to hunt) -> Buildings (what to buy there) -> Brief. Demand is judged per area,
# so a building's grade is about the building (fit) and its owner; "dem" stays available but starts at 0.
RANK = {
    "parts": {"own": 50, "fit": 50, "dem": 0},
    "own": {"sale": 15, "hold": 30, "away": 20, "person": 10, "single": 10, "occ": 10, "notInst": 5},
    "fit": {"use": 40, "multi": 25, "park": 20, "low": 15},
    "dem": {"prac": 60, "sba": 20, "comp": 20},
    "opts": {"sizeMin": 5000, "sizeMax": 25000, "maxStories": 3, "noRetail": 1, "holdFull": 10, "awayLocal": 50,
             "parkTarget": 4, "gradeA": 70, "gradeB": 50, "top": 25, "radius": 1, "lookback": 5, "areaA": 67, "areaB": 34},
    "useVal": {"Medical office": 100, "Office": 70, "Office/showroom (flex)": 50, "Retail": 20, "Other": 20},
    "area": {"ratio": 50, "deeds": 25, "comps": 15, "sba": 10},
    "buyers": {"ph": 1, "dn": 1, "ot": 1},
}
# hospitals whose campus points are this close become one area (Medical District, Presbyterian / Walnut Hill)
AREA_JOIN_MI = 1.0
AREA_NAMES = {"Parkland Memorial Hospital": "Southwestern Medical District", "Texas Health Presbyterian Hospital Dallas": "Presbyterian / Walnut Hill"}
SHORT = {"Parkland Memorial Hospital": "Parkland", "UTSW Clements University Hospital (incl. Zale Lipshy Pavilion)": "UTSW Clements",
         "Children's Medical Center Dallas": "Children's", "Texas Health Presbyterian Hospital Dallas": "Texas Health Presbyterian",
         "Advanced Dallas Hospital and Clinics": "Advanced Dallas", "Baylor University Medical Center": "Baylor University Medical Center",
         "Baylor Scott & White Medical Center - Irving": "Baylor Irving", "Methodist Richardson - Campbell Rd Campus": "Methodist Richardson"}
INST_RE = r"\bREIT\b|\bFUND\b|INSURANCE|PENSION|RETIREMENT|\bBANK\b|INVESTORS|CAPITAL|REALTY|EQUIT|\bASSET|PORTFOLIO|INSTITUTIONAL|TRUST CO"
ENTITY_RE =r"\b(?:LLC|L L C|INC|LP|L P|LTD|CORP|CO|COMPANY|PARTNERS|PARTNERSHIP|HOLDINGS|PROPERTIES|INVESTMENTS|REIT|FUND|BANK|CHURCH|CITY OF|COUNTY|ISD|STATE OF|ASSOC|ASSN|GROUP|VENTURES|CAPITAL|REALTY|DEVELOPMENT)\b"
OWNER_TYPE = {"P": "Medical practice name", "I": "Investor / other"}


def load_costar(p, addr_par, folder="costar"):
    """CoStar exports from data/raw/<folder> (property exports in costar/, listings in costar_listings/), one row per property,
    matched to a DCAD parcel.

    Address match first; otherwise the parcel under the CoStar pin, or the nearest within 100 ft.
    Licensed data: it only ever goes to outputs/private and the encrypted blob, never docs/ in the clear or git.
    """
    fs = sorted((RAW / folder).glob("*.xlsx"))
    if not fs:
        return None, ""
    c = pd.concat([pd.read_excel(f, dtype=str) for f in fs], ignore_index=True)
    if "PropertyID" in c:
        c = c.drop_duplicates("PropertyID")
    else:
        c["PropertyID"] = c.index.astype(str)
    for k in ("RBA", "Latitude", "Longitude", "Number of Parking Spaces", "Parking Ratio", "Percent Leased",
              "Total Available Space (SF)", "For Sale Price Per SF", "Last Sale Price"):
        if k in c:
            c[k] = pd.to_numeric(c[k].astype(str).str.replace(r"[$,]", "", regex=True), errors="coerce")
    c["par"] = c["Property Address"].map(norm_street).map(addr_par)
    c["how"] = c.par.notna().map({True: "Address", False: ""})
    pts = gpd.GeoDataFrame(c[["PropertyID"]], geometry=gpd.points_from_xy(c.Longitude, c.Latitude), crs=4326).to_crs(CRS_FT)
    miss = c.par.isna()
    hit = gpd.sjoin(pts[miss], p[["Acct", "geometry"]], predicate="within", how="inner")
    hit = hit[~hit.index.duplicated()]
    c.loc[hit.index, "par"] = hit.Acct
    c.loc[hit.index, "how"] = "CoStar pin"
    miss = c.par.isna()
    nn = gpd.sjoin_nearest(pts[miss], p[["Acct", "geometry"]], max_distance=100, how="inner")
    nn = nn[~nn.index.duplicated()]
    c.loc[nn.index, "par"] = nn.Acct
    c.loc[nn.index, "how"] = "Pin within 100 ft"
    m = re.search(r"(\d{2})(\d{2})(\d{2})$", pd.ExcelFile(fs[0]).sheet_names[0])
    asof = f"{m.group(1)}/{m.group(2)}/20{m.group(3)}" if m else ""
    log(f"CoStar: {len(c):,} properties, {c.par.notna().sum():,} matched to a parcel in the rings ({c.how.value_counts().to_dict()})")
    return c, asof


def comp_segment(r):
    if r["Secondary Type"] == "Medical" or r.ptype == "Health Care":
        return "Medical office"
    return {"Office": "Other office", "Retail": "Retail", "Flex": "Flex / industrial", "Industrial": "Flex / industrial"}.get(r.ptype, "Other")


def load_comps(hg):
    """CoStar sale comps from data/raw/costar_comps: files starting 'condo' are suites, the rest whole buildings.

    Licensed data: outputs/private only. Each row notes whether its price counts toward the summary medians.
    """
    out = []
    for f in sorted((RAW / "costar_comps").glob("*.xlsx")):
        d = pd.read_excel(f, dtype=str)
        for k in ("Price Per SF", "Building SF", "Sale Price", "Asking Price", "Actual Cap Rate", "Year Built"):
            d[k] = pd.to_numeric(d[k].str.replace(r"[$,%]", "", regex=True), errors="coerce")
        d["kind"] = "Condo" if f.name.lower().startswith("condo") else "Building"
        out.append(d)
    if not out:
        return None
    c = pd.concat(out, ignore_index=True).drop_duplicates(["kind", "Comp ID", "PropertyID", "Building SF"])
    c = c[(c.kind == "Condo") | ~c["Property Address"].str.contains("(Condo)", regex=False)].copy()
    c["date"] = pd.to_datetime(c["Sale Date"], errors="coerce")
    c["ptype"] = c["Property Type"].str.replace(r" \(.*", "", regex=True)
    c["seg"] = c.apply(comp_segment, axis=1)
    c["ask_sf"] = c["Asking Price"] / c["Building SF"]
    multi = c.groupby(["kind", "Comp ID"]).PropertyID.transform("nunique") > 1
    cond = c["Sale Condition"].fillna("")
    c["treat"] = "Counted"
    c.loc[c["Sale Price"].isna(), "treat"] = "No disclosed price"
    c.loc[cond.str.contains(COMP_SKIP_RE, regex=True) | multi, "treat"] = "Left out: portfolio or non-market condition"
    c.loc[c["Sale Status"] != "Sold", "treat"] = "Left out: not closed"
    pts = gpd.GeoSeries(gpd.points_from_xy(pd.to_numeric(c.Longitude), pd.to_numeric(c.Latitude)), crs=4326, index=c.index).to_crs(CRS_FT)
    dist = pd.concat([pts.distance(h.geometry).rename(h["name"]) / MILE_FT for _, h in hg.iterrows()], axis=1)
    c["dist"], c["hosp"] = dist.min(axis=1).round(2), dist.dropna().idxmin(axis=1)      # a few comps have no pin
    log(f"CoStar comps: {c.kind.value_counts().to_dict()}, {c.treat.value_counts().to_dict()}")
    return c


def comp_rows(c):
    v = lambda x: None if pd.isna(x) else x  # noqa: E731
    return [[r["Comp ID"], r.PropertyID, r["Property Address"], r["Property City"], r["Property County"], r.seg, r["Property Type"],
             v(r["Secondary Type"]), v(r["Building Class"]), v(r["Year Built"]), v(r["Building SF"]),
             r.date.strftime("%Y-%m-%d") if pd.notna(r.date) else "", r["Sale Status"], v(r["Sale Type"]), v(r["Sale Price"]),
             v(r["Price Per SF"]), v(r["Asking Price"]), None if pd.isna(r.ask_sf) else round(r.ask_sf), v(r["Actual Cap Rate"]),
             v(r["Sale Condition"]), r.treat, v(r.hosp), v(r.dist), "Yes" if r.dist <= SETTINGS["radius_miles"] else "No",
             v(r["Buyer (True) Company"]), v(r["Seller (True) Company"])] for _, r in c.sort_values("date", ascending=False, na_position="last").iterrows()]


def comp_summary(c):
    rows = []
    groups = (("Dallas County", ["Dallas"]), ("Collin + Denton", ["Collin", "Denton"]))
    for kind in ("Condo", "Building"):
        k = c[c.kind == kind]
        for label, counties in groups:
            for seg in ("Medical office", "Other office", "Retail", "Flex / industrial"):
                x = k[k["Property County"].isin(counties) & (k.seg == seg) & (k["Sale Status"] == "Sold")]
                if x.empty:
                    continue
                p = x[x.treat == "Counted"]["Price Per SF"]
                a = x.ask_sf.dropna()
                rows.append([kind, label, seg, len(x), int((x["Sale Type"] == "Owner User").sum()), int((x.dist <= SETTINGS["radius_miles"]).sum()),
                             len(p), round(p.median()) if len(p) else None, round(p.min()) if len(p) else None, round(p.max()) if len(p) else None,
                             len(a), round(a.median()) if len(a) else None, x.date.min().strftime("%Y-%m-%d"), x.date.max().strftime("%Y-%m-%d")])
    return rows


def load_sba():
    """Funded healthcare SBA loans that look like real estate: all 504s, plus 7(a)s on terms of SBA_MIN_TERM+ months.

    Reads data/raw/sba/FOIA_*.csv once and caches the filtered rows in data/cache/sba_health.csv. Delete it after a refresh.
    """
    cache = CACHE / "sba_health.csv"
    if cache.exists():
        return pd.read_csv(cache, dtype=str)
    out = []
    for f in sorted((RAW / "sba").glob("FOIA_*.csv")):
        for ch in pd.read_csv(f, dtype=str, encoding="latin-1", chunksize=200000, low_memory=False):
            out.append(ch[(ch.ProjectState == "TX") & ch.NaicsCode.fillna("").str[:4].isin(SBA_NAICS)
                          & ch.ProjectCounty.fillna("").str.upper().isin(SBA_COUNTIES) & ~ch.LoanStatus.isin(["CANCLD", "NOT FUNDED"])])
    if not out:
        return None
    d = pd.concat(out, ignore_index=True)
    d.to_csv(cache, index=False)
    return d


def sba_geocode(d):
    """Map pins for borrower addresses via the Census batch geocoder, cached in data/cache/sba_geo.csv."""
    cache = CACHE / "sba_geo.csv"
    geo = pd.read_csv(cache, dtype={"gk": str}) if cache.exists() else pd.DataFrame(columns=["gk", "lat", "lon"])
    d["street"] = d.BorrStreet.fillna("").map(strip_suite)
    d["gk"] = d.street + "|" + d.BorrCity.fillna("").str.upper() + "|" + d.BorrZip.fillna("").str[:5]
    todo = d[~d.gk.isin(set(geo.gk))].drop_duplicates("gk").reset_index(drop=True)
    if len(todo):
        res = import_module("03_npi").census_batch([(str(i), r.street, r.BorrCity, "TX", r.BorrZip[:5]) for i, r in todo.iterrows()])
        new = [(r.gk, *res.get(str(i), (None, None))) for i, r in todo.iterrows()]
        geo = pd.concat([geo, pd.DataFrame(new, columns=["gk", "lat", "lon"])], ignore_index=True)
        geo.to_csv(cache, index=False)
    return d.merge(geo, on="gk", how="left")


def sba_tables(d):
    """(loan rows, suite purchase rows, their map points). Suite purchase = Dallas County loan at a DCAD condo address, with that suite's deed within 6 months of the loan."""
    d = d.copy()
    d["Program"] = d.Program.str.strip()
    d["amt"] = pd.to_numeric(d.GrossApproval, errors="coerce")
    d["bank"] = pd.to_numeric(d["ThirdPartyDollars"], errors="coerce")
    d["term"] = pd.to_numeric(d.TermInMonths, errors="coerce")
    d["date"] = pd.to_datetime(d.ApprovalDate, errors="coerce")
    d = d[(d.Program == "504") | (d.term >= SBA_MIN_TERM)].copy().reset_index(drop=True)
    d["est"] = ((d.amt + d.bank.fillna(0)) / 0.9).round()
    d["county"] = d.ProjectCounty.str.title()
    d["lender"] = d.ThirdPartyLender_Name.where(d.Program == "504", d.BankName)
    d = sba_geocode(d)
    v = lambda x: None if pd.isna(x) else x  # noqa: E731
    by_date = d.sort_values("date", ascending=False)
    loans = [[r.Program, r.county, r.BorrName, r.BorrStreet, r.BorrCity, r.BorrZip, r.NaicsDescription.strip(), r.date.strftime("%Y-%m-%d"), v(r.term), v(r.amt),
              v(r.bank), v(r.est), r.LoanStatus, v(r.lender)] for r in by_date.itertuples()]
    loan_pts = list(zip(by_date.lat, by_date.lon))
    u = pd.read_csv(PROC / "condo_units.csv", dtype=str)
    u = u[u.counted == "True"].copy()
    ring = set(pd.read_csv(PROC / "hospital_regimes.csv", dtype=str).regime)
    u["k"] = u.addr.fillna("").map(norm_street)
    u["sf"] = pd.to_numeric(u.SF, errors="coerce")
    u["deed"] = pd.to_datetime(u.DEED_TXFR_DATE, errors="coerce")
    u["uid"] = u.UNIT_ID.fillna("").str.strip().str.upper().str.lstrip("0")
    x = d[d.county == "Dallas"].copy()
    x["loan"] = x.index
    x["k"] = x.BorrStreet.fillna("").map(strip_suite).map(norm_street)
    x["s"] = x.BorrStreet.map(suite_of).str.upper().str.lstrip("0")
    m = x.merge(u[["k", "uid", "sf", "deed", "OWNER_NAME1", "use", "regime", "PROPERTY_CITY"]], on="k")
    m["gap"] = (m.deed - m.date).dt.days.abs()
    m = m[(m.gap <= 180) & (m.sf > 0) & ((m.s == "") | (m.s == m.uid))].sort_values(["loan", "gap"]).drop_duplicates("loan")
    buys = [[r.Program, r.BorrName, r.BorrStreet, r.PROPERTY_CITY, r.NaicsDescription.strip(), r.date.strftime("%Y-%m-%d"), r.deed.strftime("%Y-%m-%d"), int(r.gap),
             v(r.amt), v(r.bank), r.est, int(r.sf), round(r.est / r.sf), r.uid, "Address + suite" if r.s else "Address + deed date", r.OWNER_NAME1, r.use,
             "Yes" if r.regime in ring else "No"] for r in m.sort_values("date", ascending=False).itertuples()]
    buy_pts = list(zip(*[m.sort_values("date", ascending=False)[c] for c in ("lat", "lon")]))
    log(f"SBA: {len(loans)} real-estate style healthcare loans, {len(buys)} tied to a Dallas County condo suite, {d.lat.notna().sum()} loans mapped")
    return loans, buys, loan_pts, buy_pts


def rank_parts(sig, R):
    """Part scores (0-1) and overall score (0-100) from raw signals. Mirrors score() in docs/deal_layer.js: change both together."""
    o = R["opts"]

    def w(grp):
        t = sum(max(0, v) for v in R[grp].values()) or 1
        return {k: max(0, v) / t for k, v in R[grp].items()}
    wo, wf, wd, p = w("own"), w("fit"), w("dem"), w("parts")
    away = sig.away.map({2: 1.0, 1: o["awayLocal"] / 100, 0: 0.0})
    own = (wo["sale"] * sig.sale + wo["hold"] * (sig.yrs / (o["holdFull"] or 1)).clip(0, 1) + wo["away"] * away + wo["person"] * sig.person
           + wo["single"] * sig.single + wo["occ"] * sig.occ + wo["notInst"] * (1 - sig.inst))
    use = sig.use.map(lambda u: R["useVal"].get(u, R["useVal"]["Other"]) / 100)
    multi = sig.pl.map(lambda v: 1 if v >= 2 else 0.5 if v == 1 else 0.3)
    pk = sig.park.map(lambda v: 0.5 if v != v else 1 if v >= o["parkTarget"] else 0.5 if v >= o["parkTarget"] - 1 else 0)
    low = sig.st.map(lambda v: 0.5 if not v > 0 else 1 if v <= 1 else 0.6 if v <= 2 else 0.3 if v <= 3 else 0)
    fit = wf["use"] * use + wf["multi"] * multi + wf["park"] * pk + wf["low"] * low
    dem = wd["prac"] * sig.pp + wd["sba"] * sig.ps + wd["comp"] * (1 - sig.pc)
    score = (100 * (p["own"] * own + p["fit"] * fit + p["dem"] * dem) + 0.5).map(math.floor).astype(int)   # rounds like Math.round in JS
    return {"own": own, "fit": fit, "dem": dem, "score": score}


def grade(score, R):
    o = R["opts"]
    return "A" if score >= o["gradeA"] else "B" if score >= o["gradeB"] else "C"


def eligible(sig, R):
    """Hard screens before grading (the map lets the owner change each one): size range, height, retail."""
    o = R["opts"]
    ok = (sig.sf >= o["sizeMin"]) & (sig.sf <= o["sizeMax"]) & ((sig.st <= o["maxStories"]) | (sig.st <= 0))
    if o["noRetail"]:
        ok &= sig.use != "Retail"
    return ok


SNAP = OUT / "private" / "last_build.json"


def change_flags(b):
    """What changed since the last data refresh: New, Sold, Owner changed, Newly listed.

    The baseline is the previous build made from different source data (DCAD roll, CoStar export dates), so rebuilding
    on the same data keeps the same flags. The first build only records a baseline.
    """
    key = f"{SETTINGS['dcad_year']}|{SETTINGS.get('dcad_roll_zip')}|" + "|".join(
        f"{f.name}:{int(f.stat().st_mtime)}" for d in ("costar", "costar_listings") for f in sorted((RAW / d).glob("*.xlsx")))
    old = json.loads(SNAP.read_text()) if SNAP.exists() else None
    base = (old.get("prev") if old and old.get("key") == key else old) or None
    if base:
        base = {"key": base.get("key"), "rows": base["rows"]}
    rows = {r.GIS_PARCEL_ID: [str(r.owner or "").strip().upper(), r.deed.strftime("%Y-%m-%d") if pd.notna(r.deed) else "", int(r.sig["sale"])]
            for r in b.itertuples()}
    out = []
    for pid_, (own, deed, sale) in rows.items():
        f = []
        if base:
            was = base["rows"].get(pid_)
            if was is None:
                f.append("New")
            else:
                if deed and deed > was[1] and own != was[0]:
                    f.append("Sold")
                elif own != was[0]:
                    f.append("Owner changed")
                if sale and not was[2]:
                    f.append("Newly listed")
        out.append(f)
    SNAP.parent.mkdir(parents=True, exist_ok=True)
    SNAP.write_text(json.dumps({"key": key, "rows": rows, "prev": base}))
    log(f"change flags vs last refresh: {'none (first build sets the baseline)' if not base else pd.Series([x for f in out for x in f]).value_counts().to_dict()}")
    return out


def build_areas(hg):
    """Hospitals within AREA_JOIN_MI of each other (campus points) become one area; each area keeps its member points."""
    pts = list(hg.geometry)
    parent = list(range(len(pts)))

    def root(i):
        while parent[i] != i:
            i = parent[i]
        return i
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            if pts[i].distance(pts[j]) <= AREA_JOIN_MI * MILE_FT:
                parent[root(j)] = root(i)
    groups = {}
    for i in range(len(pts)):
        groups.setdefault(root(i), []).append(i)
    areas = []
    for mem in sorted(groups.values(), key=lambda m: -hg.iloc[m].beds.sum()):
        names = list(hg.iloc[mem]["name"])
        lead = names[0]
        nm = AREA_NAMES.get(lead) if len(mem) > 1 else None
        areas.append({"n": nm or lead, "hosp": names, "short": ", ".join(SHORT.get(x, x) for x in names), "beds": int(hg.iloc[mem].beds.sum()),
                      "pts": [[round(float(hg.iloc[k].lat), 6), round(float(hg.iloc[k].lon), 6)] for k in mem], "idx": mem})
    log(f"areas: {len(areas)} ({', '.join(a['n'] for a in areas if len(a['idx']) > 1)} merged)")
    return areas


def area_dist(geoms, hg, areas, max_mi):
    """For each geometry (EPSG:2276): [[area index, miles], ...] for areas within max_mi (nearest edge to any member campus point)."""
    d = pd.concat([geoms.distance(h.geometry).rename(i) / MILE_FT for i, (_, h) in enumerate(hg.iterrows())], axis=1)
    out = []
    for row in d.itertuples(index=False):
        x = []
        for ai, a in enumerate(areas):
            m = min(row[k] for k in a["idx"])
            if m == m and m <= max_mi:
                x.append([ai, round(float(m), 2)])
        out.append(x)
    return out


def score_candidates(b, costar_row, geo, sba_pts):
    """Rank candidates for a buyer-converter: owner likely to sell, buyer demand nearby, easy to convert (equal thirds).

    Each part is 0 to 1; score = 100 x their average. Rank runs only over buildings with DCAD value within BUDGET.
    A ranking of research priority, not a valuation. Weights are in the comments below so they can be tuned.
    """
    b = b.reset_index(drop=True)
    pts = gpd.GeoDataFrame({"i": range(len(b))}, geometry=gpd.GeoSeries(geo.reindex(b.GIS_PARCEL_ID).values, crs=CRS_FT).representative_point().values, crs=CRS_FT)

    def near(points, radius, col=None):
        if points is None or points.empty:
            return pd.Series(0, index=b.index)
        j = gpd.sjoin(pts.assign(geometry=pts.buffer(radius)), points, predicate="contains")
        c = j.groupby("i")[col].nunique() if col else j.groupby("i").size()
        return c.reindex(b.index, fill_value=0)

    pv = pd.read_csv(PROC / "npi_providers_near.csv", dtype=str)
    pv = pv[(pv.indep == "True") & pv.grp.isin(["ph", "dn", "ot"])]
    pvg = gpd.GeoDataFrame(pv[["ploc"]], geometry=gpd.points_from_xy(pd.to_numeric(pv.lon), pd.to_numeric(pv.lat)), crs=4326).to_crs(CRS_FT)
    sp = pd.DataFrame(sba_pts, columns=["lat", "lon"]).dropna() if sba_pts else pd.DataFrame(columns=["lat", "lon"])
    sg = gpd.GeoDataFrame(geometry=gpd.points_from_xy(sp.lon, sp.lat), crs=4326).to_crs(CRS_FT)
    u = pd.read_csv(PROC / "condo_units.csv", dtype=str)
    u = u[(u.counted == "True") & (u.use == "Medical office") & (u.owner_class != "H")]
    rg = gpd.read_file(PROC / "regimes.gpkg")
    rg = rg.set_index("Acct").geometry.representative_point()
    cu = gpd.GeoDataFrame(geometry=rg.reindex(u.regime).dropna().values, crs=CRS_FT)
    b["prac"], b["sba1"], b["comp"] = near(pvg, MILE_FT / 2, "ploc"), near(sg, MILE_FT), near(cu, MILE_FT)
    pct = lambda x: x.rank(pct=True, method="average")  # noqa: E731

    # raw signals, one value per building; RANK turns them into a score (docs/deal_layer.js does the same live)
    rows = [costar_row(par, sf) for par, sf in zip(b.GIS_PARCEL_ID, b.SF)]
    # years held runs from the later of the DCAD deed and CoStar's last sale (entity sales often leave the deed date unchanged)
    cs_sale = pd.Series([pd.to_datetime(t["Last Sale Date"], errors="coerce") if t is not None else pd.NaT for t in rows])
    b["deed"] = pd.concat([b.deed, cs_sale], axis=1).max(axis=1)
    yrs = ((pd.Timestamp.today() - b.deed).dt.days / 365.25).fillna(0)
    true_own = pd.Series([str(t["True Owner Name"]).upper() if t is not None and isinstance(t["True Owner Name"], str) else "" for t in rows])
    for_sale = pd.Series([t is not None and t["For Sale Status"] == "Y" for t in rows])
    leased = pd.Series([t["Percent Leased"] if t is not None else float("nan") for t in rows])
    park = pd.Series([t["Parking Ratio"] if t is not None else float("nan") for t in rows])
    st, mz = b.mst.fillna("").str.strip().str.upper(), b.mzip.fillna("").str[:3]
    out_state = ~st.isin(["TX", "TEXAS", ""])                      # DCAD spells the state out
    own = b.owner.fillna("").str.upper()
    uses = pd.Series([use_category(c, s) for c, s in zip(b.cls, b.sptd)])          # the main building's use, not any account on the parcel
    for_sale = for_sale | b.listed.fillna(False).astype(bool)
    inst = ((own.str.contains(INST_RE) | (b.own_n >= 5)) & ~own.str.contains(r"\bTRUST\b(?! CO)")) | true_own.str.contains(INST_RE + r"|REALTY TRUST|\bREIT\b")
    sig = pd.DataFrame({
        "sale": for_sale.astype(int), "yrs": yrs.round(1),
        "away": out_state.astype(int) * 2 + (~out_state & ~mz.isin(["750", "751", "752", "753"]) & mz.ne("")).astype(int),
        "person": (own.str.contains(r"TRUST|ESTATE|LIVING|FAMILY|\bETAL\b|\bET AL\b") | ~own.str.contains(ENTITY_RE)).astype(int),
        "single": ((b.own_n <= 1) & ~inst).astype(int), "occ": b.occ.astype(int), "inst": inst.astype(int),
        "pl": b.px.astype(int), "prac": b.prac, "sba": b.sba1, "comp": b.comp, "pp": pct(b.prac).round(4), "ps": pct(b.sba1).round(4), "pc": pct(b.comp).round(4),
        "sf": b.SF.round().astype(int), "use": uses, "park": park.round(2), "st": b.ST.fillna(0).astype(int),
        # shown on the card, not scored (owner's call): age, vacancy, tax value trend, DCAD value
        "yr": b.YR.fillna(0).astype(int), "vac": ((100 - leased) / 100).clip(0, 1).round(2), "tax": b.tax.round(1), "val": b.val.fillna(0).round().astype(int)})
    parts = rank_parts(sig, RANK)
    b["s_own"], b["s_fit"], b["s_dem"], b["score"] = parts["own"], parts["fit"], parts["dem"], parts["score"]
    b["grade"] = b.score.map(lambda v: grade(v, RANK))
    b["yrs"] = yrs.round().astype(int)
    ok = eligible(sig, RANK) & b.near.map(len).gt(0)               # default view: inside 1 mile, default screens
    b["rank"] = b.score.where(ok).rank(ascending=False, method="first")
    b["tier"] = ok.map({True: "Passes default screens", False: "Outside default screens"})
    b["sig"] = sig.to_dict("records")

    def why(i):
        r = b.loc[i]
        bits = []
        if for_sale[i]:
            bits.append("Listed for sale")
        if r.yrs >= 10:
            bits.append(f"Owned {r.yrs} yrs")
        if out_state[i]:
            bits.append(f"Owner in {st[i].title()}")
        elif sig.away[i] == 1:
            bits.append("Owner outside DFW")
        if sig.person[i]:
            bits.append("Individual or trust owner")
        if sig.single[i]:
            bits.append("Owner's only building")
        if sig.occ[i]:
            bits.append("Owner-occupied")
        if sig.inst[i]:
            bits.append("Institutional owner")
        bits.append(f"{int(r.SF):,} SF {uses[i].lower()}")
        if r.ST > 0:
            bits.append(f"{int(r.ST)} stor{'y' if r.ST == 1 else 'ies'}")
        if r.px:
            bits.append(f"{r.px} practice{'s' if r.px > 1 else ''} inside")
        if park[i] == park[i]:
            bits.append(f"parking {park[i]:.1f}/1,000")
        return " · ".join(bits)

    b["why"] = [why(i) for i in b.index]
    log(f"scored {len(b):,} candidates; {int(ok.sum()):,} pass the default screens within {SETTINGS['radius_miles']:g} mile; "
        f"grades {b[ok].grade.value_counts().to_dict()}")
    return b.sort_values(["rank", "score"], ascending=[True, False], na_position="last").reset_index(drop=True)


def main():
    PRIVATE.mkdir(parents=True, exist_ok=True)
    max_mi = SETTINGS.get("max_radius_miles", SETTINGS["radius_miles"])   # the map's radius slider goes up to this
    hg = condos_mod.hospitals()
    areas = build_areas(hg)
    parcels = condos_mod.load_parcels()
    p = parcels[parcels.intersects(hg.geometry.buffer(max_mi * MILE_FT).union_all())].copy()

    roll = RAW / "dcad_roll"
    ai = pd.read_csv(find_one(roll, "ACCOUNT_INFO.CSV"), dtype=str)
    ai["GIS_PARCEL_ID"] = ai.GIS_PARCEL_ID.str.strip()
    ai = ai[ai.DIVISION_CD != "BPP"].copy()
    # how many parcels each owner name holds county-wide (1 = this is their only building; 5+ reads as institutional)
    own_n = ai.assign(o=ai.OWNER_NAME1.fillna("").str.strip().str.upper()).groupby("o").GIS_PARCEL_ID.nunique()
    ai = ai[ai.GIS_PARCEL_ID.isin(p.Acct)].copy()
    ay = pd.read_csv(find_one(roll, "ACCOUNT_APPRL_YEAR.CSV"), dtype=str, usecols=["ACCOUNT_NUM", "SPTD_CODE", "TOT_VAL", "PREV_MKT_VAL"])
    ai = ai.merge(ay, on="ACCOUNT_NUM", how="left")
    ai["TOT_VAL"] = pd.to_numeric(ai.TOT_VAL, errors="coerce")
    ai["PREV_MKT_VAL"] = pd.to_numeric(ai.PREV_MKT_VAL, errors="coerce")
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
    akey = (ai.STREET_NUM.fillna("").str.strip() + " " + ai.FULL_STREET_NAME.fillna("")).map(norm_street)
    pars = ai.assign(akey=akey).groupby("akey").GIS_PARCEL_ID.agg(lambda x: set(x))
    addr_par = {k: next(iter(v)) for k, v in pars.items() if len(v) == 1}     # skip addresses spanning parcels
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
        ST=("ST", "max"), val=("TOT_VAL", "sum"), prev=("PREV_MKT_VAL", "sum"), deed=("deed", "max"), acct=("ACCOUNT_NUM", "first"),
        accts=("ACCOUNT_NUM", "count")).reset_index()
    b["tax"] = ((b.val / b.prev.where(b.prev > 0)) - 1) * 100      # DCAD value vs prior year market value, %
    b["own_n"] = b.owner.fillna("").str.strip().str.upper().map(own_n).fillna(1).astype(int)
    prop = (b.num.fillna("").str.strip() + " " + b.street.fillna("")).map(norm_street)
    mailst = (b.ml1.fillna("") + " | " + b.ml2.fillna("") + " | " + b.ml3.fillna("")).str.split(" \\| ")
    b["occ"] = [bool(pa) and any(norm_street(m).startswith(pa) for m in ms) for pa, ms in zip(prop, mailst)]
    b["code"] = b.codes.map(lambda s: next((c for c in ("H", "M", "O", "R") if c in s), "C"))
    b["hs"] = b.owner.fillna("").str.upper().str.contains(HEALTH_SYSTEM_PARCEL_RE, regex=True) | b.code.eq("H")
    log(f"non-condo parcels within the radius with a DCAD account: {len(b):,}")
    poor_fit = b.cls.fillna("").str.contains(SKIP_CLASS_RE, regex=True)
    b_all = b.assign(poor=poor_fit).set_index("GIS_PARCEL_ID")
    b = b[b.code.isin(KEEP_CODES) & ~b.hs & b.owners.eq(1) & (b.SF >= MIN_SF) & ~poor_fit].copy()
    log(f"candidate buildings (office / medical / retail, one owner, not hospital, {MIN_SF:,}+ SF): {len(b):,}")

    # distance to each hospital (campus point to nearest parcel edge, same rule as condos)
    geo = p.set_index("Acct").geometry
    geo = geo[~geo.index.duplicated()]
    g = geo.reindex(b.GIS_PARCEL_ID).values
    near, nearest = [], []
    for gm in g:
        d = sorted((round(gm.distance(h.geometry) / MILE_FT, 2), h["name"]) for _, h in hg.iterrows())
        near.append([x for x in d if x[0] <= SETTINGS["radius_miles"]])
        nearest.append(d[0])
    b["near"], b["nearest"] = near, nearest
    b["ad"] = area_dist(gpd.GeoSeries(g, crs=CRS_FT, index=b.index), hg, areas, max_mi)

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

    # CoStar facts per candidate parcel; a parcel can hold several CoStar properties, the largest speaks for it
    cs, cs_asof = load_costar(p, addr_par)
    cand = set(b.GIS_PARCEL_ID)
    cmap = {}
    if cs is not None:
        cs = cs.sort_values("RBA", ascending=False)
        cmap = {k: g for k, g in cs[cs.par.isin(cand)].groupby("par")}

    def why_not(r):
        if not isinstance(r.par, str):
            return "No DCAD parcel match inside the rings"
        if r.par in cand:
            return "Candidate"
        if r.par in condo_par:
            return "Already a DCAD condo"
        if r.par not in b_all.index:
            return "No DCAD account on parcel"
        x = b_all.loc[r.par]
        return ("Hospital or health system" if x.hs else "More than one DCAD owner" if x.owners > 1
                else f"Under {MIN_SF:,} SF in DCAD" if not x.SF >= MIN_SF else "DCAD class left out")

    def s(v):
        return v.strip() if isinstance(v, str) else ""

    def n(v):
        return None if pd.isna(v) else (int(v) if float(v).is_integer() else float(v))

    def costar_cols(par, dcad_sf):
        g = cmap.get(par)
        if g is None:
            return [""] * 20
        t = g.iloc[0]
        ratio = t.RBA / dcad_sf if dcad_sf and pd.notna(t.RBA) else None
        sale = pd.to_datetime(t["Last Sale Date"], errors="coerce")
        return [t.PropertyID, s(t["Property Name"]), s(t["Property Type"]), s(t["Secondary Type"]), s(t["Building Class"]),
                n(t.RBA), n(t["Number of Parking Spaces"]), n(t["Parking Ratio"]), s(t.Condo), n(t["Percent Leased"]),
                n(t["Total Available Space (SF)"]), s(t["Rent/SF/Yr"]), s(t["For Sale Status"]), n(t["For Sale Price Per SF"]),
                sale.strftime("%Y-%m-%d") if pd.notna(sale) else "", n(t["Last Sale Price"]), s(t["True Owner Name"]), len(g), s(t.how),
                "OK" if ratio and 0.75 <= ratio <= 1.25 else "Size differs"]

    def mail(r):
        lines = [x for x in (r.ml1, r.ml2, r.ml3) if isinstance(x, str) and x.strip()]
        tail = " ".join(x for x in (s(r.mcity), s(r.mst), s(r.mzip)[:5]) if x)
        return ", ".join([*lines, tail])

    def costar_row(par, dcad_sf):
        """The parcel's CoStar row when its size agrees with DCAD within 25%, else None."""
        g = cmap.get(par)
        if g is None or not dcad_sf or pd.isna(g.iloc[0].RBA):
            return None
        return g.iloc[0] if 0.75 <= g.iloc[0].RBA / dcad_sf <= 1.25 else None

    sba = load_sba()
    sba_out = sba_tables(sba) if sba is not None else None
    ls, ls_asof = load_costar(p, addr_par, "costar_listings")
    b["listed"] = b.GIS_PARCEL_ID.isin(set(ls.par.dropna())) if ls is not None else False
    b = score_candidates(b, costar_row, geo, sba_out[2] if sba_out else None)
    b["chg"] = change_flags(b)

    rows = []
    for r in b.itertuples():
        nd, nh = r.nearest
        rows.append([None if r.rank != r.rank else int(r.rank), r.grade, r.score, r.why, nh, nd, len(r.near), f"{s(r.num)} {s(r.street)}".strip(), s(r.city),
                     r.name if isinstance(r.name, str) and r.name != "UNASSIGNED" else "", s(r.cls), use_category(r.cls, r.sptd),
                     int(r.SF), int(r.NRA) if r.NRA > 0 else None, int(r.YR) if r.YR > 0 else None,
                     int(r.REM) if r.REM > 0 else None, int(r.ST) if r.ST > 0 else None, s(r.qual), s(r.cond),
                     int(r.val) if pd.notna(r.val) else None, round(r.val / r.SF) if pd.notna(r.val) and r.SF else None,
                     r.deed.strftime("%Y-%m-%d") if pd.notna(r.deed) else "", s(r.owner), s(r.owner2),
                     OWNER_TYPE.get(owner_class(s(r.owner)), "Investor / other"), mail(r), s(r.mst),
                     r.ph, r.dn, r.ot, r.cl, r.px, r.accts, r.acct, r.GIS_PARCEL_ID, *costar_cols(r.GIS_PARCEL_ID, r.SF),
                     round(100 * r.s_own), round(100 * r.s_fit), round(100 * r.s_dem), r.prac, r.sba1, r.comp, r.yrs,
                     None if r.tax != r.tax else round(r.tax, 1), int(r.prev) if r.prev > 0 else None, r.own_n, "Yes" if r.occ else "No",
                     "Yes" if r.listed else "No", r.tier, ", ".join(r.chg)])

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
    ring_head = ["Hospital", "Licensed Beds", "Condo Suites", "Independent Medical Suites", "Indep. Medical Sold in Last 3 Yrs",
                 "Physicians in Indep. Bldgs", "Dentists in Indep. Bldgs", "Other Outpatient in Indep. Bldgs",
                 "Owner-user Providers in Indep. Bldgs", "Practice Locations in Indep. Bldgs", "Candidate Buildings",
                 "Candidate Bldg SF", "Candidates: Medical Office", "Candidates: Office / Flex", "Candidates: Retail"]
    xl.sheet(ws, ring_head,
             srows, [44, 9, 9, 11, 11, 11, 11, 11, 12, 12, 10, 12, 10, 10, 10], {"L": "#,##0"})
    cand_head = ["Rank", "Grade", "Score", "Why", "Nearest Hospital", "Distance (mi)", "Hospital Rings Containing", "Address", "City", "Property Name", "DCAD Bldg Class",
              "Use", "Bldg SF", "Net Leasable SF", "Yr Built", "Remodel Yr", "Stories", "DCAD Quality", "DCAD Condition",
              "DCAD Value", "Value / SF", "Latest Deed", "Owner", "Owner 2", "Owner Type", "Owner Mailing Address", "Owner State",
              "Physicians in Bldg", "Dentists in Bldg", "Other Outpatient in Bldg", "All Clinicians in Bldg",
              "Practice Locations in Bldg", "DCAD Accounts", "DCAD Account", "GIS Parcel ID",
              "CoStar ID", "CoStar Name", "CoStar Type", "CoStar Secondary Type", "CoStar Class", "CoStar RBA", "CoStar Parking Spaces",
              "CoStar Parking Ratio", "CoStar Condo", "CoStar % Leased", "CoStar Available SF", "CoStar Rent/SF/Yr", "CoStar For Sale",
              "CoStar For Sale $/SF", "CoStar Last Sale Date", "CoStar Last Sale Price", "CoStar True Owner", "CoStar Properties on Parcel",
              "CoStar Match", "CoStar vs DCAD Size",
              "Owner Likely to Sell (0-100)", "Building Fit (0-100)", "Buyer Demand Nearby (0-100)", "Practices within 1/2 mi",
              "SBA Loans within 1 mi", "Indep. Medical Condo Suites within 1 mi", "Years Held",
              "DCAD Value Change vs Prior Yr (%)", "DCAD Prior Yr Market Value", "Owner's Parcels in County", "Owner-occupied",
              "Listed (CoStar listings)", "Default Screens", "Changes Since Last Build"]
    fmt_by = {"Distance (mi)": "0.00", "Bldg SF": "#,##0", "Net Leasable SF": "#,##0", "DCAD Value": "$#,##0", "Value / SF": "$#,##0",
              "CoStar RBA": "#,##0", "CoStar Available SF": "#,##0", "CoStar Last Sale Price": "$#,##0", "DCAD Prior Yr Market Value": "$#,##0"}
    xl.sheet(wb.create_sheet("Candidate Buildings"), cand_head,
             rows, [6, 6, 6, 60, 38, 9, 9, 28, 12, 26, 24, 16, 10, 10, 8, 8, 7, 10, 10, 13, 9, 11, 34, 20, 18, 44, 7, 9, 9, 9, 9, 9, 8, 20, 20,
                    11, 26, 20, 16, 7, 10, 9, 8, 7, 8, 10, 14, 7, 9, 11, 13, 30, 9, 14, 11, 9, 9, 9, 9, 9, 9, 7, 9, 13, 9, 9, 9, 18, 24],
             {xl.L(cand_head.index(k) + 1): v for k, v in fmt_by.items()})
    if cs is not None:
        cs["status"] = [why_not(r) for r in cs.itertuples()]
        log(f"CoStar status: {cs.status.value_counts().to_dict()}")
        cs["dcls"] = cs.par.map(b_all.cls)
        rv = cs.rename(columns={"Property Address": "address", "Property Name": "name_", "Property Type": "ptype",
                                "Secondary Type": "stype", "True Owner Name": "owner_"}).sort_values(["status", "address"])
        rv = rv[(rv.status != "Candidate") | (rv.Condo == "Yes")]
        review = [[r.status, r.Condo, s(r.address), s(r.City), s(r.name_), s(r.ptype), s(r.stype), n(r.RBA), s(r.dcls), s(r.owner_), r.PropertyID, s(r.how)]
                  for r in rv.itertuples()]
        review_head = ["Status vs DCAD", "CoStar Condo", "Address", "City", "CoStar Name", "CoStar Type", "CoStar Secondary Type", "CoStar RBA",
                       "DCAD Bldg Class", "CoStar True Owner", "CoStar ID", "CoStar Match"]
        xl.sheet(wb.create_sheet("CoStar Review"), review_head, review, [32, 8, 30, 12, 28, 24, 18, 10, 24, 30, 11, 14], {"H": "#,##0"})
    comps = load_comps(hg)
    if comps is not None:
        sum_head = ["Sale Kind", "Area", "Segment", "Closed Sale Records", "Owner-user Sales", "Inside a 1-mile Ring", "Prices Counted",
                    "Median $/SF", "Low $/SF", "High $/SF", "Asking Prices", "Median Asking $/SF", "First Sale", "Last Sale"]
        xl.sheet(wb.create_sheet("Comp Summary"), sum_head, comp_summary(comps), [10, 16, 16, 9, 9, 9, 8, 8, 8, 8, 8, 9, 11, 11], {c_: "$#,##0" for c_ in "HIJL"})
        xl.sheet(wb.create_sheet("Condo Comps"), COMP_HEAD, comp_rows(comps[comps.kind == "Condo"]), COMP_W, COMP_FMT)
        xl.sheet(wb.create_sheet("Building Comps"), COMP_HEAD, comp_rows(comps[comps.kind == "Building"]), COMP_W, COMP_FMT)
    if sba_out:
        loans, buys, loan_pts, buy_pts = sba_out
        buy_head = ["Program", "Borrower", "Borrower Address", "City", "Industry", "Loan Date", "DCAD Deed Date", "Days Apart", "SBA or 7(a) Loan", "504 Bank Loan",
                    "Est. Price", "Suite SF", "Est. $/SF", "DCAD Unit", "Match", "DCAD Owner", "DCAD Use", "In 1-mile Ring"]
        loan_head = ["Program", "County", "Borrower", "Borrower Address", "City", "ZIP", "Industry", "Loan Date", "Term (mo)", "SBA or 7(a) Loan", "504 Bank Loan",
                     "Est. Project Cost", "Status", "Lender"]
        xl.sheet(wb.create_sheet("SBA Suite Purchases"), buy_head,
                 buys, [8, 32, 34, 18, 34, 11, 11, 7, 12, 12, 12, 8, 8, 8, 18, 30, 15, 7],
                 {"I": "$#,##0", "J": "$#,##0", "K": "$#,##0", "L": "#,##0", "M": "$#,##0"})
        xl.sheet(wb.create_sheet("SBA Loans"), loan_head,
                 loans, [8, 9, 34, 34, 15, 7, 36, 11, 7, 12, 12, 12, 8, 34], {"J": "$#,##0", "K": "$#,##0", "L": "$#,##0"})
    wm = wb.create_sheet("Method & Notes")
    notes = [
        ("Purpose", "Internal. Existing buildings near each hospital that could be bought and converted to medical condo suites, "
                    "next to condo supply and provider demand in the same 1-mile ring. Not for distribution: owner names and mailing addresses."),
        ("Candidates", f"Non-condo DCAD parcels within {max_mi:g} miles of a hospital campus point (to the nearest parcel edge; the map's radius slider "
                       f"goes up to {max_mi:g}), "
                       f"main building class medical office / urgent care, office (incl. office/showroom, bank, loft, technical) or retail, "
                       f"one titled owner across all accounts on the parcel, at least {MIN_SF:,} SF, and not owned by a hospital or health system. "
                       "Multi-owner parcels, hospital-owned buildings, gas stations, fast food, convenience stores, auto, "
                       "car washes, supermarkets and theaters are left out."),
        ("Ranking", "Research order for a buyer-converter, not a valuation. Areas first (on the map: practice locations per independent medical "
                    "condo suite, plus suite deeds, CoStar condo sales and SBA suite purchases in the lookback window), then buildings. "
                    "Building score 0-100 = half owner likely to sell, half building fit; graded A (70+), B (50 to 69), C (under 50). "
                    "Owner likely to sell: listed for sale 15%, years since the later of the last DCAD deed and CoStar's last sale (full at 10) 30%, owner mails from out of state 20% "
                    "(outside DFW 750-753 ZIPs counts half), owner is a person, trust or estate 10%, this is the owner's only parcel in Dallas County 10%, "
                    "owner-occupied (mailing address is the building) 10%, not institutional 5%. Building fit: use (medical office 100, office 70, "
                    "flex 50, retail 20) 40%, already holds 2+ practice locations (NPI) 25%, CoStar parking 20%, low-rise (1 story best) 15%. "
                    f"Default screens: {RANK['opts']['sizeMin']:,} to {RANK['opts']['sizeMax']:,} SF, {RANK['opts']['maxStories']} stories or fewer, no retail, "
                    f"within {SETTINGS['radius_miles']:g} mile. Rank counts only buildings that pass them. Price and DCAD value are not used. "
                    "Age, vacancy and the DCAD value trend are shown but not scored. CoStar facts count only where CoStar and DCAD sizes agree within 25%. "
                    "These are the defaults; on the map every weight, screen and the radius can be changed live."),
        ("Building facts", "DCAD commercial detail: gross building area, net leasable area, earliest year built, latest remodel year, "
                           "stories, DCAD quality and condition grades, total appraised value and latest deed transfer date. "
                           "Value / SF is DCAD value over gross SF, not a market price. Value change vs prior year compares the 2026 total value "
                           "with DCAD's prior-year market value (PREV_MKT_VAL) on the same accounts; it tracks the tax bill's direction, not a sale price."),
        ("Owner type", "Owner-name screen: a name that reads like a medical practice, else investor / other. LLCs hide many owner-users."),
        ("Providers in building", "Individual NPI records whose practice address matches the parcel. Physicians = MD/DO; dentists; other outpatient = "
                                  "chiropractic, PT, OT, optometry, podiatry, psychology, counseling, clinical social work, MFT, audiology, speech. "
                                  "Practice locations = distinct building + suite among those three groups (approximate; many NPI addresses omit the suite)."),
        ("Ring summary", "Supply columns match the public map (docs/data.json). 'Indep.' = buildings not owned by a hospital or health system. "
                         "Owner-user providers = physicians + dentists + other outpatient. Rings overlap, so rows do not add to a county total."),
        ("Sources", f"DCAD {SETTINGS['dcad_year']} roll and parcel GIS ({d['asof']}); CMS NPI Registry pulled {d.get('npiAsOf', '')}; "
                    f"Census geocoder. Built {d['built']}."),
        ("CoStar", (f"CoStar property exports dated {cs_asof}, {len(cs):,} properties of office, retail, flex and health care, about 5,000 to 100,000 SF "
                    "in CoStar's RBA, searched by radius around the hospitals. Matched to DCAD parcels by address, then by CoStar pin. "
                    "A blank CoStar column means no CoStar property matched, usually because the building is outside that size range. "
                    "Where one parcel holds several CoStar properties, the largest is shown. 'Size differs' means CoStar RBA is more than 25% "
                    "from DCAD SF, so the CoStar row may describe only part of the property. The CoStar Review sheet lists every CoStar "
                    "property that is not a candidate and why, plus candidates CoStar flags as condos. CoStar data is licensed: internal use only."
                    ) if cs is not None else "No CoStar export in data/raw/costar."),
        ("Sale comps", ("CoStar sale comps, exported 11/3/2026. Condo Comps cover about 5 years; Building Comps cover only the last 12 months, so the two "
                        "are different time windows. Texas does not disclose sale prices, so most rows have no price. Medians use closed sales with a "
                        "disclosed price, leaving out portfolio and non-market conditions (see Price Treatment). Asking prices are not sale prices. "
                        "Very few prices are counted: read medians as a rough indication, not a market price."
                        ) if comps is not None else "No sale comps in data/raw/costar_comps."),
        ("SBA loans", ("SBA 7(a) and 504 FOIA data as of 9/30/2026 (data.sba.gov), from FY2010. Funded loans to physicians, dentists, other "
                       f"practitioners and outpatient centers with projects in Dallas, Collin, Denton or Tarrant County. All 504s; 7(a)s only on terms of {SBA_MIN_TERM}+ months, "
                       "because a long term usually means real estate (the data has no loan purpose). Addresses are the borrower's, not always the property. "
                       "Cash and conventional purchases do not appear."
                       ) if sba is not None else "No SBA files in data/raw/sba."),
        ("SBA suite purchases", "Dallas County loans at a DCAD condo address where a suite's deed transferred within 6 months of the loan: likely purchases, not confirmed. "
                                "Est. Price = (loan + 504 bank loan) / 0.9, assuming 10% down. It is an estimate, not a closing price, and can run high because a loan can also fund "
                                "buildout or equipment. 'Address + deed date' means no suite in the loan address, so the suite is the one with the closest deed date."),
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

    # everything above as private.json for the local private map (pipeline/serve_private.py)
    bs = b                                # same order as rows
    shapes = gpd.GeoSeries(geo.reindex(bs.GIS_PARCEL_ID).values, crs=CRS_FT).to_crs(4326).simplify(0.00001)
    cand_items = [{"lat": round(pt.y, 6), "lon": round(pt.x, 6), "g": [polyline(x) for x in poly_rings(gm)], "rings": [x[1] for x in near_],
                   "code": code, "s": sg, "ad": ad_, "fl": fl_, "f": dict(zip(cand_head, row))}
                  for row, gm, pt, near_, code, sg, ad_, fl_ in zip(rows, shapes, shapes.representative_point(), bs.near, bs.code, bs.sig, bs.ad, bs.chg)]

    def pt_ad(pts):
        pts = list(pts)
        if not pts:
            return []
        la, lo = zip(*pts)
        gs = gpd.GeoSeries(gpd.points_from_xy(pd.to_numeric(pd.Series(lo)), pd.to_numeric(pd.Series(la))), crs=4326).to_crs(CRS_FT)
        return area_dist(gs, hg, areas, max_mi)

    def items(head, table, pts):
        pts = list(pts)
        ads = pt_ad([(la if pd.notna(la) else 0, lo if pd.notna(lo) else 0) for la, lo in pts])
        return [{"lat": la, "lon": lo, "ad": ad_, "f": dict(zip(head, row))} for row, (la, lo), ad_ in zip(table, pts, ads) if pd.notna(la) and pd.notna(lo)]

    def latlon(frame):
        return list(zip(pd.to_numeric(frame.Latitude), pd.to_numeric(frame.Longitude)))

    # practice locations (building + suite) in independent buildings, for area demand at any radius: [group bits, area distances]
    pv2 = pd.read_csv(PROC / "npi_providers_near.csv", dtype=str)
    pv2 = pv2[(pv2.indep == "True") & pv2.grp.isin(["ph", "dn", "ot"]) & pv2.lat.notna()]
    pv2["bit"] = pv2.grp.map({"ph": 1, "dn": 2, "ot": 4})
    plx = pv2.groupby("ploc").agg(bit=("bit", lambda s: int(sum(set(s)))), lat=("lat", "first"), lon=("lon", "first"))
    pl = [[int(m), ad_] for m, ad_ in zip(plx.bit, pt_ad(zip(plx.lat, plx.lon))) if ad_]

    # medical condo projects (supply), each with its independent medical suites' deed dates and any bulk-buy owner
    cu = pd.read_csv(PROC / "condo_units.csv", dtype=str)
    cu = cu[cu.counted == "True"].copy()
    cu["med"] = cu.use == "Medical office"
    cu["own"] = cu.OWNER_NAME1.fillna("").str.strip().str.upper()
    cu["DEED_TXFR_DATE"] = pd.to_datetime(cu.DEED_TXFR_DATE, errors="coerce").dt.strftime("%Y-%m-%d")    # DCAD writes MM/DD/YYYY
    rgeo = p[p.Acct.isin(set(cu.regime))].dissolve(by="Acct").geometry
    cprj = []
    rads = area_dist(rgeo, hg, areas, max_mi)
    for (rid, gm), ad_ in zip(rgeo.items(), rads):
        x = cu[cu.regime == rid]
        if not ad_ or not x.med.any():
            continue
        ind = x[x.owner_class != "H"]
        im = ind[ind.med]
        top = ind.own.value_counts()
        tn, tc = (top.index[0], int(top.iloc[0])) if len(top) else ("", 0)
        pt = gpd.GeoSeries([gm.representative_point()], crs=CRS_FT).to_crs(4326).iloc[0]
        nm = x.PROPERTY_NAME.dropna()
        cprj.append({"lat": round(pt.y, 6), "lon": round(pt.x, 6), "ad": ad_, "dd": sorted(im.DEED_TXFR_DATE.dropna().str[:10].tolist()),
                     "f": {"Project": (nm.iloc[0] if len(nm) and nm.iloc[0] != "UNASSIGNED" else "") or x.addr.iloc[0], "Address": x.addr.iloc[0],
                           "City": x.PROPERTY_CITY.iloc[0], "Suites": len(x), "Medical Suites": int(x.med.sum()),
                           "Independent Medical Suites": len(im), "Hospital-owned Suites": int((x.owner_class == "H").sum()),
                           "Largest Independent Owner": tn.title() if tn else "", "Suites Held by Largest Owner": tc,
                           "Bulk Buy": f"Yes: {tn.title()} holds {tc} of {len(x)}" if tc >= 2 else "No",
                           "Latest Deed": max(x.DEED_TXFR_DATE.dropna().str[:10], default=""), "DCAD Regime": rid}})
    log(f"medical condo projects within {max_mi:g} mi: {len(cprj)}; with a bulk-buy owner: {sum(c['f']['Bulk Buy'] != 'No' for c in cprj)}")

    layers = {"cand": cand_items, "cprj": cprj}
    # listings: the CoStar listings export when there is one, else properties CoStar marks for sale in the property exports
    lsrc = ls if ls is not None else (cs[cs["For Sale Status"] == "Y"] if cs is not None else None)
    if lsrc is not None and len(lsrc):
        lcols = [k for k in ("Property Address", "City", "Property Name", "Property Type", "Secondary Type", "Building Class", "RBA", "Condo",
                             "For Sale Price Per SF", "Percent Leased", "Year Built", "True Owner Name", "PropertyID") if k in lsrc]
        lv = lambda v: None if (isinstance(v, float) and v != v) else v  # noqa: E731
        layers["list"] = items(lcols, [[lv(r[k]) for k in lcols] for _, r in lsrc.iterrows()], latlon(lsrc))
        log(f"listings layer: {len(layers['list'])} ({'listings export ' + ls_asof if ls is not None else 'for sale in the CoStar property exports'})")
    sheets = [{"title": "Ring summary", "note": f"DCAD {SETTINGS['dcad_year']} roll, CMS NPI Registry, public map counts. Rings overlap, so rows do not add up.",
               "head": ring_head, "rows": srows}]
    if cs is not None:
        layers["review"] = items(review_head, review, latlon(rv))
    if comps is not None:
        for key, kind in (("condo", "Condo"), ("bldg", "Building")):
            k = comps[comps.kind == kind]
            layers[key] = items(COMP_HEAD, comp_rows(k), latlon(k.sort_values("date", ascending=False, na_position="last")))
        sheets.append({"title": "Sale comp summary", "note": "CoStar, exported 11/3/2026. Condo comps cover 5 years, building comps only 12 months. Read medians with their counts.",
                       "head": sum_head, "rows": comp_summary(comps)})
    if sba is not None:
        layers["buys"] = items(buy_head, buys, buy_pts)
        layers["loans"] = items(loan_head, loans, loan_pts)
    clean = lambda o: {k: clean(v) for k, v in o.items()} if isinstance(o, dict) else [clean(v) for v in o] if isinstance(o, (list, tuple)) else (  # noqa: E731
        None if isinstance(o, float) and o != o else o)
    area_meta = [{k: a[k] for k in ("n", "hosp", "short", "beds", "pts")} for a in areas]
    payload = json.dumps(clean({"layers": layers, "sheets": sheets, "rank": RANK, "costarAsOf": cs_asof, "listAsOf": ls_asof, "built": d["built"],
                                "areas": area_meta, "pl": pl, "maxMi": max_mi, "npiAsOf": d.get("npiAsOf", "")}),
                         separators=(",", ":"), default=lambda o: o.item() if hasattr(o, "item") else str(o))
    encrypt_deal_data(payload)
    log("docs/deal-data.bin written (encrypted): " + str({k: len(v) for k, v in layers.items()}))


def encrypt_deal_data(payload):
    """Write the deal layers to docs/deal-data.bin, readable only with the key in outputs/private (never in git).

    gzip, then AES-256-GCM with a PBKDF2 key: salt (16 bytes) + nonce (12) + ciphertext. docs/deal_layer.js reverses it.
    Also writes 'Open My Map.url', a double-click link that carries the key after the # (browsers don't send that part to the server).
    """
    key_file = PRIVATE / "map-key.txt"
    if not key_file.exists():
        key_file.write_text(secrets.token_urlsafe(32))
    key = key_file.read_text().strip()
    salt, nonce = os.urandom(16), os.urandom(12)
    aes = AESGCM(PBKDF2HMAC(hashes.SHA256(), 32, salt, KDF_ROUNDS).derive(key.encode()))
    (DOCS / "deal-data.bin").write_bytes(salt + nonce + aes.encrypt(nonce, gzip.compress(payload.encode("utf-8"), 9), None))
    (PRIVATE / "Open My Map.url").write_text(f"[InternetShortcut]\nURL={MAP_URL}#key={key}\n")


if __name__ == "__main__":
    main()
