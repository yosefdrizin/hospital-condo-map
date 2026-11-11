# Hospital Condo Map: briefing for Claude Code

## What this project is
An interactive map and numbers table showing **commercial condo supply around Dallas County's major hospitals**
(who owns it, how much is medical) next to **demand** (physicians practicing within 1 mile).
Owner: Yosef, a healthcare-focused commercial real estate broker at Holiner (Dallas). The use case is
understanding competition for office-to-medical condo conversions.

The map is a static site in `docs/` published with GitHub Pages. **The repo and the site are public.**

## How the user wants this work done
- Present numbers neutrally. Do not editorialize about a "supply gap" or pick targets unless asked.
- Never use em dashes, in chat or in files.
- Explain things simply, with real estate analogies before jargon. Ask before big or ambiguous changes.
- Internal spreadsheets stay plain (no colors or fancy formatting).
- Cite source and date for any figure that might go to a client.
- Flag steps that are slow or costly (big downloads, long runs) before running them.

## Run it
```
pip install -r requirements.txt
python pipeline/run_all.py                    # full build; downloads are skipped if already in data/raw
python pipeline/run_all.py --only 5 6         # rebuild site data + Excel only (fast)
python pipeline/run_all.py --skip-imagery     # skip the slow aerial step
python -m http.server -d docs 8000            # preview at http://localhost:8000
```
First full run downloads about 300 MB (DCAD roll + parcels + TIGER roads), pulls NPI records (10 to 20 min),
geocodes addresses (a few minutes) and fetches imagery (5 to 10 min). Later runs reuse `data/cache/`.

Publish: commit and push `docs/`. GitHub Pages serves `docs/` from the main branch.

## Deal data on the map (one map, one link)
The owner uses the live map alone. Candidates, CoStar, comps and SBA borrowers sit on it inside `docs/deal-data.bin`, encrypted (AES-256-GCM) by step 7.
`docs/deal_layer.js` decrypts it in the browser with a key; without the key the page is the plain public map. Open it with `outputs/private/Open My Map.url`:
the key travels after the # (never sent to the server) and is then remembered in that browser. "Lock" on the page forgets it.
The key is `outputs/private/map-key.txt`. It must never go in git, docs/, chat or a commit. Keep the same key across rebuilds, since old blobs stay in git history.
To add data: put files in the right `data/raw/` folder, run `python pipeline/run_all.py --only 7`, then commit and push `docs/deal-data.bin`. New layers go in `LAYERS` in deal_layer.js.
Never put that data in `docs/` unencrypted, including data.json, index.html or deal_layer.js.
The owner is a principal (buys and converts buildings himself), value-add or leased, buyers not yet chosen. Price and DCAD value do not matter
to him (DCAD value is unreliable): deal size is screened by building SF instead.
Deal mode follows his path in three steps (answers to 40 questions, 11/9/2026):
1. **Areas** (where to hunt): hospitals whose campus points are within 1 mile merge into one area (Southwestern Medical District = Parkland +
   UTSW + Children's; Presbyterian / Walnut Hill = Presbyterian + Advanced Dallas), 12 areas. Graded A/B/C on practice locations per independent
   medical condo suite, DCAD suite deeds, CoStar condo sales and SBA suite purchases in the lookback (percentiles among areas, weights adjustable).
   Radius slider 0.5 to 3 mi (`max_radius_miles` in settings.json; step 3 pulls NPI that far, the public counts stay at 1 mile); lookback slider;
   buyer types (physicians, dentists, therapy and other; med-adjacent is not in NPI). Scoreboard table plus a card list.
2. **Buildings** (what to buy there): hard screens (size range, 4+ stories out, retail out, condos and hospital owners already out), then a grade:
   half owner likely to sell (listed, years held from the later of DCAD deed and CoStar sale, full at 10; out of state, outside DFW half;
   individual or trust; owner's only parcel in the county; owner-occupied; not institutional, also judged from CoStar true owner), half building
   fit (use, already holds practices, parking, low-rise). Parking in the score is CoStar's count where it exists, else the DCAD land
   estimate: (land SF minus building footprint) / `PARK_SF_PER_SPACE` (575, calibrated against CoStar 11/11/2026, rough) per 1,000 SF; the
   card shows both, plus DCAD's zoning label (LAND.CSV, the city's description, PD districts need the PD number). Demand moved to the area (weight 0 by default). Age, vacancy and DCAD value trend
   (TOT_VAL vs PREV_MKT_VAL) are shown, never scored. Top 25 per area. Change flags (New, Sold, Owner changed, Newly listed) compare with the
   previous build on different source data (`outputs/private/last_build.json`); the 11/9/2026 build is the first baseline.
3. **Brief**: "One-page brief" on the card opens a Holiner-branded printable page (green #78A167, tan #AFA183, cream #EDECE2) with a USGS aerial and
   the parcel outline; print or save as PDF.
Defaults live in `RANK` in 07_targets.py; `rank_parts` (Python) and `score()` in deal_layer.js must stay the same math (both round half up;
check that the workbook's score total equals the map's). His settings live in localStorage `hcm-rank2`; the workbook shows defaults.
Layers: ranked buildings, medical condo projects (bulk buy = one independent owner holds 2+ suites), for sale (CoStar; a listings export in
`data/raw/costar_listings/` replaces the property-export flag), condo sales, SBA suite purchases are on by default; the rest sit under "More data".
Every point item carries `ad` = [[area, miles]] so the map recounts at any radius. Practice locations travel as `pl` = [[group bits, ad]].
Notes sync: status and notes (`hcm-notes`, each with `u` timestamp and delete tombstones) can sync through a secret GitHub Gist the owner
owns, encrypted with the map key; the token he pastes is `hcm-gh` (never in backups, git or chat).
After changing deal_layer.js, bump `?v=` on its script tag in index.html so browsers load the new version. Keyboard on a card: arrows or j/k, Esc.
Layers drawn above the parcels must use an SVG renderer: a canvas in a higher pane covers the whole map and swallows clicks.
The map toolbar keeps search and basemap up front; everything else sits in one "Tools" menu (map_present.js `toolsMenu`).

## Pipeline (pipeline/)
| Step | File | Does | Writes |
|---|---|---|---|
| 1 | 01_download.py | DCAD roll, DCAD parcel GIS, Census TIGER roads | data/raw/ |
| 2 | 02_condos.py | Commercial condo universe, use buckets, owner class, hospital x regime matching | data/processed/condo_units.csv, hospital_regimes.csv, regimes.gpkg |
| 3 | 03_npi.py | NPI Registry pull by ZIP, Census geocoding, building ownership, physician counts | data/processed/npi_counts.json |
| 4 | 04_basemap.py | USGS Imagery Topo tiles + USDA NAIP aerials stitched per hospital | docs/img/, docs/basemap.json |
| 5 | 05_build_site.py | Everything the page needs | docs/data.json |
| 6 | 06_build_excel.py | Plain internal workbook (committed, so effectively public) | outputs/*.xlsx |
| 7 | 07_targets.py | PRIVATE conversion candidates workbook (owner names + mailing addresses) and the encrypted map data | outputs/private/ (git-ignored), docs/deal-data.bin |

Shared logic lives in `pipeline/common.py`: paths, settings, ownership regexes, use buckets, polyline encoding.
Hospitals are in `config/hospitals.csv` (name, system, address, beds, lat/lon, notes). Knobs are in `config/settings.json`.

## Definitions (keep these consistent everywhere)
- **Hospitals**: Dallas County general acute care, 100+ licensed beds (Texas HHSC directory 10/21/2026; UTSW and VA from
  their own sources). Two borderline includes are flagged in notes: Methodist Richardson Campbell Rd and Advanced Dallas.
- **Radius**: 1 mile from the campus point to the nearest edge of the condo regime parcel.
- **Condo suite**: DCAD commercial-division (COM) account tied to a condo regime (GIS parcel id `CONDO...CONDO`) or with
  CONDO / CE% in the legal description. Parking, land, apartment and hotel units are listed but not counted.
- **Medical suite**: DCAD building class MEDICAL OFFICE BUILDING or URGENT CARE CLINIC (building type, not tenant).
- **Ownership** (owner-name screen in common.py): H = hospital/health system, P = medical practice name, I = investor/other.
  "Independent" = P + I. Richardson Medical Center = Methodist Richardson's former name, counted as hospital.
- **Building ownership for physicians**: a practice address is "hospital-owned building" if its DCAD parcel is hospital class,
  owned by a hospital/health system/UT System/VA, or contains a hospital point. Investor-owned MOBs on campus count as independent.
- **Hospital-employed (CMS group)**: a provider whose Medicare group at that ZIP (CMS Doctors & Clinicians file, `data/raw/cms/dac_dfw.csv`)
  matches `SYSTEM_GROUP_RE` in 03_npi.py (UTSW, HealthTexas/Baylor Scott & White, Texas Health Physicians Group, MedHealth/Methodist,
  Parkland, Children's, Medical City/HCA, hospital districts). "Independent" provider = independent building AND not hospital-employed
  (`indep` column; `phSys` = physicians moved by the group rule). No CMS record (about 41% of nearby physicians, most dentists) = building rule only.
  Big corporate groups (US Anesthesia Partners, Texas Oncology, WellMed/Optum) are not hospital systems and stay independent.
- **Physicians**: NPI-1 records with primary taxonomy starting `20` (MD/DO). "All clinicians" = every individual NPI record.
- **Dentists / other outpatient**: taxonomy groups in `common.PROVIDER_GROUPS` (dentists 1223*; other outpatient = chiro, PT, OT,
  optometry, podiatry, psychology, counseling, clinical social work, MFT, audiology, speech). NPs/PAs are in All clinicians only.
- **Practice locations**: distinct building + suite among physicians, dentists and other outpatient in independent buildings.
- **Conversion candidates** (private workbook and encrypted map data only): non-condo office / medical office / retail parcel within 1 mile, one titled owner,
  not hospital or health system, 2,500+ SF. Never put this list, owner mailing addresses or the outputs/private folder in git or in docs/ unencrypted.
- **Structure** (secondary view): owner-user suites (fragmented ownership), single-owner/controlled (one owner 75%+),
  mixed-use master (commercial units inside an apartment/garage regime).

## Current numbers (built 2026-11-02 from the DCAD 2026 roll posted 10/12/2026)
300 condo suites within 1 mile of the 15 hospitals; 135 medical; 40 hospital-owned; 106 independent medical;
9 independent medical suites sold in the last 3 years. Within 1 mile (NPI pulled 2026-11-02, CMS group file 10/2/2026), independent:
1,582 physicians, 406 dentists, 1,950 other outpatient, 1,462 practice locations; hospital-owned building or hospital-employed: 6,335 physicians,
335 dentists, 1,354 other outpatient; 23,553 individual clinicians. (Before the CMS group rule, 11/9/2026: 1,738 independent physicians.) Private workbook (11/9/2026): 6,680 candidate buildings within 3 miles; 442 pass the
default screens within 1 mile (26 A, 179 B, 237 C after the CMS group rule and the parking estimate, 11/11/2026); 27 medical condo projects within 3 miles, 20 with a bulk-buy owner.
If a rebuild changes these, say so.

## The page (docs/index.html)
Single file, Leaflet 1.9.4 from cdnjs. Loads `data.json` and `basemap.json`. Features: Aerial/Plan basemap toggle,
ownership vs structure coloring, map-driven hospital focus (center inside a ring at zoom 13.5+ switches the panel;
others dim; zoom below 13 returns to all), overlap switcher chips, Supply and demand numbers sheet (sortable).
Data field names in data.json are short on purpose (see 05_build_site.py for the meaning of each key).
`docs/map_tools.js` (public, no data) adds Felt-style tools: basemap menu (live USGS satellite / satellite+labels, sharp NAIP snapshots,
OpenStreetMap streets, USGS topo, plan), search (hospitals, condos, parcels, deal data via `HCM.searchProviders`, addresses via Nominatim),
measure distance / area / radius, and a Layers panel that mirrors the page's own checkboxes. Live NAIP tiles are too slow (over 60 s a tile), so
close-ups near hospitals still use the stitched NAIP snapshots. Roadmap the owner chose: (1) look and navigation [done], (2) styling and filters
[done], (3) own data and drawing [done], (4) dashboards and presenting [done]. Bump `?v=` on map_tools.js after changes.
Phase 2: layers register with `HCM.registerLayer({id,label,color,features:[{raw,props,lat,lon}],isOn,apply,restyle,open})` (deal_layer.js registers its
six; map_tools registers the public condo projects). Per layer: style (points colored by category or number, size by number on the 5th to 95th
percentile, opacity; heatmap via leaflet.heat 0.2.0 from cdnjs; hex bins), filters (number range, category checkboxes, text), labels, auto legend,
data table (sort, search, columns, CSV). Settings live in localStorage `hcm-mt`. Layer owners honor them through `HCM.mtStyle(id,raw)` and
`HCM.mtPass(id,raw)`; filters also narrow the deal worklist, while "hide the points" only makes dots invisible.
Phase 3 is `docs/map_data.js` (public, no data): Add data (drag or pick CSV / Excel / GeoJSON / KML; lat/long columns, else addresses looked up
via Census JSONP then Nominatim, 1,000-row cap, cached), stored in IndexedDB `hcm` and registered as styleable layers; Draw with Leaflet-Geoman
2.17.0 from jsdelivr (attached by hand with `new L.PM.Map(map)` since the map exists first), drawings in localStorage `hcm-draw`; Views
(`hcm-views`) and a backup file of every `hcm-*` setting plus IndexedDB data, never `hcm-key`. Its popovers use `.md-pop`, not `.mt-pop`
(map_tools closes `.mt-pop` on outside clicks). autoFocus in index.html leaves an open deal card alone.
Phase 4 is `docs/map_present.js` (public, no data): Dashboard (number boxes, bar charts, histograms per layer; clicking a bar or bin sets a
filter through `HCM.mt.setFilter`; listens for the `mt-change` event; charts saved in `hcm-dash`), Compare (second tile basemap in pane `cmp`,
clipped with CSS `clip` to a draggable divider), Present (full screen, editable title in `hcm-present-title`, saved views as slides, arrows / Esc),
and Export (composes tiles, canvases, SVG panes and labels onto a canvas, adds title, legend, scale bar and credit; PNG, or PDF via jsPDF 2.5.1
from cdnjs). Tile layers need `crossOrigin:true` or export skips them.
Never edit docs files with PowerShell Get-Content / Set-Content: Windows PowerShell reads UTF-8 without a BOM as ANSI and mangles ·, ¼, – and ←.
Use the Edit tool.
Some source labels in the page footer are hard-coded (DCAD roll date, TIGER year); update them after a data refresh.

## Gotchas
- DCAD downloads go through `ViewPDFs.aspx?type=3&id=\\DCAD.ORG\...` URLs (encoded in common.py).
- CMS Doctors & Clinicians file: the filtered query API returns 403 to scripts, so step 3 streams the full ~900 MB CSV once (about 1 minute)
  and keeps Texas 75xxx/76xxx rows in `data/raw/cms/dac_dfw.csv`. Delete it (or use --refresh) to pull a newer month.
- NPI Registry API: max 200 per page, `skip` caps at 1000, so 1,200 records per query. Big ZIPs are split by last-name prefix.
  The bulk NPPES file was down for maintenance in Nov 2026; the API is the fallback that works.
- USGS Imagery Topo tiles exist only through zoom 16; closer views use NAIP via exportImage (2000 px chunks; 4000 px fails).
- Census batch geocoder: 10,000 addresses per file max; we send 9,000. Misses are cached as "none" so they aren't retried.
- Windows: run commands from the repo root; paths are pathlib-based. Reading the 700k-parcel shapefile takes a few minutes
  the first time; it is cached as data/cache/parcels.pkl.
- GitHub limits: 100 MB per file. `data/raw` and `data/cache` are git-ignored; never commit them.
- The site is public. Do not add owner mailing addresses, phone numbers or individual provider records to docs/.
- CoStar exports go in `data/raw/costar/*.xlsx` (git-ignored). Licensed data: step 7 joins it into outputs/private and the encrypted blob only.
  Parcel match is by address, then CoStar pin. The 11/3/2026 export covers about 5,000 to 100,000 SF, so smaller and larger candidates have blank CoStar columns.
- CoStar sale comps go in `data/raw/costar_comps/` (git-ignored), never in `data/raw/costar/`, which step 7 reads as property exports. Files starting "condo" are suite sales;
  the rest are whole buildings. Texas doesn't disclose sale prices, so few rows have one: never present a comp median without its count.
- SBA FOIA loan files go in `data/raw/sba/` (git-ignored; 7(a) files are about 440 MB, from data.sba.gov/dataset/7a-504-foia). Step 7 caches the filtered rows in
  `data/cache/sba_health.csv`; delete that after a refresh. SBA suite prices are loan-based estimates, not closing prices. Borrower lists stay in outputs/private.

## Ideas backlog (only when the user asks)
- CoStar export: current medical condo listings and MOB availability within each ring.
- Medical condo sale comps (price per SF) from recorded deeds.
- Expand to Collin and Denton counties (Collin CAD, Denton CAD) or all DFW.
- Suites sold as platted lots, not condo regimes (example: University Business Center, 222 Municipal Dr, Richardson).
- Live USGS tiles instead of stitched images (possible now that the page is on GitHub Pages, not a claude.ai artifact).
