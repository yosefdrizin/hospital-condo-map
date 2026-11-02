"""Step 6: plain internal Excel workbook from docs/data.json.

outputs/Dallas County Hospital Condo Competition.xlsx
Summary uses live formulas over the 'Hospital x Project' sheet; physician counts are values (NPI Registry).
Run pipeline/recalc or open in Excel to compute formulas (LibreOffice: scripts in the xlsx skill).
"""
import json

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter as L

from common import DOCS, OUT, log

F = Font(name="Arial", size=10)
B = Font(name="Arial", size=10, bold=True)
OWN = {"H": "Hospital-owned", "M": "Independent medical", "N": "Independent other"}
UNIT_OWN = {"H": "Hospital / health system", "P": "Independent: medical practice", "I": "Independent: investor / other"}


def sheet(ws, headers, rows, widths, fmts=None):
    fmts = fmts or {}
    ws.append(headers)
    for c in ws[1]:
        c.font = B
        c.alignment = Alignment(wrap_text=True, vertical="top")
    for r in rows:
        ws.append(r)
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.font = F
            if c.column_letter in fmts:
                c.number_format = fmts[c.column_letter]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[L(i)].width = w
    ws.freeze_panes = "B2"
    ws.auto_filter.ref = ws.dimensions


def main():
    d = json.loads((DOCS / "data.json").read_text())
    wb = Workbook()
    # pairs
    pairs = []
    for c in d["condos"]:
        for hn, dist in c["near"]:
            pairs.append((hn, dist, c))
    pairs.sort(key=lambda x: (x[0], x[1]))
    wsP = wb.active
    wsP.title = "Hospital x Project"
    ph = ["Hospital", "Distance (mi)", "Condo Project (DCAD legal)", "Address", "City", "Ownership", "Structure", "Primary Use",
          "Use Mix", "Condo Suites", "Medical Suites", "Hospital-owned Suites", "Independent Medical Suites",
          "Indep. Medical Sold in Last 3 Yrs", "Bldg SF (DCAD)", "Earliest Yr Built", "Distinct Owners", "Largest Owner",
          "DCAD Value", "Latest Deed", "DCAD Regime ID"]
    rows = [[hn, dist, c["p"], c["a"], c["city"], OWN[c["oc"]], c["s"], c["u"], c["mix"], c["cu"], c["mu"], c["ho"], c["imu"],
             c["irec"], c["sf"], c["y"], c["ow"], c["lo"], c["val"], c["deed"], c["id"]] for hn, dist, c in pairs]
    sheet(wsP, ph, rows, [40, 9, 34, 26, 12, 20, 22, 18, 34, 9, 9, 10, 10, 10, 12, 9, 9, 30, 13, 11, 20],
          {"B": "0.00", "O": "#,##0", "S": "$#,##0"})
    n = len(rows) + 1
    # summary
    wsS = wb.create_sheet("Summary", 0)
    P = "'Hospital x Project'!"
    hs = sorted(d["hospitals"], key=lambda h: -h["b"])
    sh = ["Hospital", "System", "Licensed Beds", "Condo Buildings", "Condo Suites", "Medical Suites", "Hospital-owned Suites",
          "Independent Medical Suites", "Indep. Medical Sold in Last 3 Yrs", "Physicians in Independent Buildings",
          "Physicians in Hospital-owned Buildings", "All Clinicians", "Notes"]
    srows = []
    for i, h in enumerate(hs, start=2):
        a = f"{P}$A$2:$A${n}"
        s = lambda col: f"=SUMIFS({P}${col}$2:${col}${n},{a},A{i})"  # noqa: E731
        srows.append([h["n"], h["sys"], h["b"], f"=COUNTIF({a},A{i})", s("J"), s("K"), s("L"), s("M"), s("N"),
                      h.get("phOff"), h.get("phOn"), h.get("cl"), h["note"]])
    sheet(wsS, sh, srows, [44, 30, 10, 10, 10, 10, 11, 11, 11, 12, 12, 11, 60], {"C": "#,##0", "J": "#,##0", "K": "#,##0", "L": "#,##0"})
    t = d["totals"]
    wsS.append([])
    wsS.append(["All hospitals, each suite and provider counted once", None, None, len(d["condos"]), t["u"], t["mu"], t["ho"],
                t["imu"], t["irec"], t.get("phOff"), t.get("phOn"), t.get("cl")])
    for c in wsS[wsS.max_row]:
        c.font = B
    wsS.append([])
    wsS.append([f"Sources: {d['asof']} (DCAD current roll and parcel GIS); CMS NPI Registry pulled {d.get('npiAsOf', '')}; "
                f"Census geocoder; bed counts per config/hospitals.csv. Built {d['built']}. Existing stock only, not listings."])
    wsS.cell(wsS.max_row, 1).font = F
    # units
    urows = []
    for c in sorted(d["condos"], key=lambda c: (c["near"][0][0], c["p"])):
        for u in c["units"]:
            urows.append([c["p"], c["near"][0][0], u[9], u[10], u[0], u[1], UNIT_OWN.get(u[11], ""), u[2], u[7], u[3], u[4], u[5], u[6]])
    sheet(wb.create_sheet("Unit Detail"), ["Condo Project", "Nearest Hospital", "DCAD Account", "Address", "Unit", "Owner", "Owner Type",
                                           "Use", "Counted", "Bldg SF", "Yr Built", "DCAD Value", "Deed Transfer"],
          urows, [34, 38, 20, 26, 8, 34, 28, 20, 8, 10, 8, 13, 12], {"J": "#,##0", "L": "$#,##0"})
    # method
    wm = wb.create_sheet("Method & Notes")
    notes = [
        ("Scope", "Dallas County general acute care hospitals with 100+ licensed beds (config/hospitals.csv). Radius measured from the campus point to the nearest edge of each condo regime parcel."),
        ("Condo suites", "DCAD commercial-division accounts tied to a condo regime (GIS parcel ID CONDO...CONDO) or with CONDO / CE% in the legal description. Parking, land, apartment and hotel units are listed but not counted."),
        ("Medical suites", "DCAD building class MEDICAL OFFICE BUILDING or URGENT CARE CLINIC. Building type, not current tenant."),
        ("Ownership", "Owner-name screen: hospital/health system (Baylor, UT System, Encompass Health, Richardson Medical Center = former Methodist Richardson name), medical practice name, or investor/other. Doctors holding suites through LLCs appear as investor/other."),
        ("Physicians", "Individual NPI records (MD/DO taxonomy 20*) with a practice address within the radius. Each address is matched to its DCAD parcel; hospital-owned buildings = hospital campuses or parcels titled to a hospital, health system, UT System or VA. NPI addresses are self-reported."),
        ("Structure", "Owner-user suite condo = fragmented ownership; Single-owner / controlled = one owner holds 75%+ of suites; Mixed-use master = commercial units inside an apartment/garage master regime."),
    ]
    wm.append(["Item", "Detail"])
    for a, b in notes:
        wm.append([a, b])
    for row in wm.iter_rows():
        for c in row:
            c.font = F
            c.alignment = Alignment(wrap_text=True, vertical="top")
    wm["A1"].font = B
    wm["B1"].font = B
    wm.column_dimensions["A"].width = 20
    wm.column_dimensions["B"].width = 120
    out = OUT / "Dallas County Hospital Condo Competition.xlsx"
    wb.save(out)
    log(f"wrote {out.relative_to(OUT.parent)}")


if __name__ == "__main__":
    main()
