# Setup on Windows (Claude desktop app, no terminal)

Live map: https://yosefdrizin.github.io/hospital-condo-map/ (public; updates 1 to 2 minutes after each push)

## One time
1. Open the Claude desktop app and click the **Code** tab at the top of the sidebar.
2. Under the message box, open the environment selector and pick the top entry under **Local**.
3. Click the folder control next to it, choose **Open folder...**, and pick `C:\Users\<you>\repos`.
4. Send: `Clone https://github.com/yosefdrizin/hospital-condo-map into this folder. Install Git for Windows first if it's missing.`
   Approve each step when asked.
5. Start a new session with the folder set to `repos\hospital-condo-map`, then send:
   `Read CLAUDE.md, install Python 3.12 and the requirements if they're missing, and preview the map.`
   The preview opens in the app's Browser pane.

## Every time after
Code tab, Local, folder `repos\hospital-condo-map`. Ask for changes in plain English. Click the `+12 -1` counter to see
exactly what changed. When you like it, say `commit and push`. The first push asks you to sign in to GitHub once.

## Rebuilding the data
The repo already has the built map and data. A full rebuild (`python pipeline/run_all.py`, Claude runs it for you)
downloads about 300 MB and takes roughly 30 to 45 minutes the first time.

## From the browser or phone (Cloud)
Pick **Cloud** instead of Local and choose this repo. Map and code edits work as is. To rebuild data in the cloud,
add these to the cloud environment's allowed domains first: dallascad.org, npiregistry.cms.hhs.gov,
geocoding.geo.census.gov, www2.census.gov, basemap.nationalmap.gov, imagery.nationalmap.gov.

## Terminal route (optional)
PowerShell users can instead install with `irm https://claude.ai/install.ps1 | iex`, then
`git clone https://github.com/yosefdrizin/hospital-condo-map.git`, `cd hospital-condo-map`, `claude`.
