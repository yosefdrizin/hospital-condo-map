# Setup on Windows

## One time
1. **Turn on the website.** On github.com open this repo, then Settings, then Pages. Under Build and deployment choose
   "Deploy from a branch", branch `main`, folder `/docs`, then Save. After 1 to 2 minutes the map is live at
   https://yosefdrizin.github.io/hospital-condo-map/
2. **Open PowerShell** (Start menu, type PowerShell).
3. **Install Git and Python**, then close and reopen PowerShell:
   ```
   winget install --id Git.Git -e
   winget install --id Python.Python.3.12 -e
   ```
4. **Install Claude Code**, then close and reopen PowerShell and check it:
   ```
   irm https://claude.ai/install.ps1 | iex
   claude --version
   ```
5. **Get the project** into your Documents folder:
   ```
   cd $HOME\Documents
   git clone https://github.com/yosefdrizin/hospital-condo-map.git
   cd hospital-condo-map
   ```
6. **Start Claude Code** and sign in with your claude.ai account when the browser opens:
   ```
   claude
   ```
7. First message to Claude: `Read CLAUDE.md, install the Python requirements, and preview the map locally.`

## Every time after
```
cd $HOME\Documents\hospital-condo-map
claude
```
Ask for changes in plain English. When you like them, say `commit and push`. The live map updates 1 to 2 minutes later.
The first push asks you to sign in to GitHub in the browser once.

## Rebuilding the data
The repo already has the built map and data, so nothing needs re-downloading to start. A full rebuild
(`python pipeline/run_all.py`) downloads about 300 MB and takes roughly 30 to 45 minutes the first time.

## Working from the browser or phone (cloud)
Open claude.ai/code and pick this repo. Page and code edits work as is. To rebuild data in the cloud, the cloud
environment needs these sites added to its allowed domains: dallascad.org, npiregistry.cms.hhs.gov,
geocoding.geo.census.gov, www2.census.gov, basemap.nationalmap.gov, imagery.nationalmap.gov.
