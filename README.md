# Hospital Condo Map

Commercial condo supply around Dallas County's 15 major hospitals (100+ licensed beds), split by who owns it
(hospital vs independent) and whether it is medical, next to how many physicians practice within 1 mile.

**Live map:** published from the `docs/` folder with GitHub Pages.

## What's in here
| Folder | What |
|---|---|
| `docs/` | The map site: `index.html`, `data.json`, `basemap.json`, `img/` aerial images |
| `pipeline/` | Python scripts that rebuild everything from public data (run in order, or `run_all.py`) |
| `config/` | `hospitals.csv` (the hospital list) and `settings.json` (data years, radius, etc.) |
| `data/processed/` | Intermediate tables (condo units, hospital matches, physician counts) |
| `data/raw`, `data/cache` | Downloads and caches, created on first run, not committed |
| `outputs/` | Excel workbook |
| `CLAUDE.md` | Briefing that Claude Code reads automatically: definitions, decisions, how to run |

## Rebuild
```
pip install -r requirements.txt
python pipeline/run_all.py
python -m http.server -d docs 8000   # then open http://localhost:8000
```

## Sources (all public)
- Dallas Central Appraisal District: 2026 current roll and parcel GIS (dallascad.org data products)
- CMS NPI Registry API (npiregistry.cms.hhs.gov)
- US Census Bureau: TIGER/Line roads; batch geocoder
- USGS The National Map: Imagery Topo basemap; USDA NAIP orthoimagery (public domain)
- Hospital beds: Texas HHSC General and Special Hospital Directory (10/21/2026); UTSW and VA from their own sources

Counts are existing stock from appraisal records, not current listings, and not a broker survey.
