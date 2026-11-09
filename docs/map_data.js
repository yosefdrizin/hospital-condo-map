// Felt-style phase 3: your own data, drawing, saved views and a project backup file.
// Public file with no data. Everything you add stays in this browser (IndexedDB / localStorage) and is never uploaded to the site.
(function(){
const $=s=>document.querySelector(s);
const LIB={papa:'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',xlsx:'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  togeo:'https://cdnjs.cloudflare.com/ajax/libs/togeojson/0.16.0/togeojson.min.js',geoman:'https://cdn.jsdelivr.net/npm/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.min.js',
  geomanCss:'https://cdn.jsdelivr.net/npm/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.css'};
const loaded={};
function lib(k){return loaded[k]||(loaded[k]=new Promise((res,rej)=>{const s=document.createElement('script');s.src=LIB[k];s.onload=res;s.onerror=()=>rej(new Error('Could not load '+k));document.head.append(s)}))}
const COLORS=['#f43f5e','#3b82f6','#22c55e','#eab308','#a855f7','#06b6d4','#f97316','#ec4899'];
let H,map,rUser,rDraw;
const esc=s=>H.esc(s);

// ---------- tiny IndexedDB store (uploads can be bigger than localStorage allows) ----------
const idb={p:null,db(){return this.p||(this.p=new Promise((res,rej)=>{const r=indexedDB.open('hcm',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}))},
  async get(k){const d=await this.db();return new Promise(res=>{const q=d.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>res(undefined)})},
  async set(k,v){const d=await this.db();return new Promise((res,rej)=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').put(v,k);t.oncomplete=res;t.onerror=()=>rej(t.error)})},
  async del(k){const d=await this.db();return new Promise(res=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').delete(k);t.oncomplete=res})},
  async keys(){const d=await this.db();return new Promise(res=>{const q=d.transaction('kv').objectStore('kv').getAllKeys();q.onsuccess=()=>res(q.result)})}};
const ls={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};

function boot(){H=window.HCM;map=H.map;
  const css=document.createElement('style');css.textContent=CSS;document.head.append(css);
  map.createPane('user').style.zIndex=426;map.createPane('draw').style.zIndex=428;
  rUser=L.svg({pane:'user',padding:.3});rDraw=L.svg({pane:'draw',padding:.3});
  const tools=$('.mt-tools');
  tools.insertAdjacentHTML('afterbegin',`<button class="mt-btn" id="md-add" title="Add your own data">Add data</button><button class="mt-btn" id="md-draw" aria-expanded="false" title="Draw on the map">Draw</button><button class="mt-btn" id="md-views" aria-expanded="false" title="Saved views and backup">Views</button>`);
  $('#md-add').addEventListener('click',e=>pop('data',e.currentTarget));$('#md-draw').addEventListener('click',e=>pop('draw',e.currentTarget));$('#md-views').addEventListener('click',e=>pop('views',e.currentTarget));
  const drop=document.createElement('div');drop.className='md-drop';drop.innerHTML='<div>Drop a CSV, Excel, GeoJSON or KML file to add it to the map</div>';map.getContainer().append(drop);
  const mc=map.getContainer();let dc=0;
  mc.addEventListener('dragenter',e=>{if([...e.dataTransfer.types].includes('Files')){dc++;drop.classList.add('on');e.preventDefault()}});
  mc.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files'))e.preventDefault()});
  mc.addEventListener('dragleave',()=>{if(--dc<=0){dc=0;drop.classList.remove('on')}});
  mc.addEventListener('drop',e=>{e.preventDefault();dc=0;drop.classList.remove('on');[...e.dataTransfer.files].forEach(addFile)});
  document.addEventListener('click',e=>{if(!e.target.closest('.md-pop,#md-add,#md-draw,#md-views'))closePop()});
  restoreData();restoreDrawings();
}
function start(){if(window.HCM&&window.HCM.mt)boot();else window.addEventListener('mt-ready',boot,{once:true})}
if(window.HCM)start();else window.addEventListener('hcm-ready',start,{once:true});

// ---------- popovers ----------
function closePop(){document.querySelectorAll('.md-pop').forEach(p=>p.remove());['#md-add','#md-draw','#md-views'].forEach(s=>{const b=$(s);b&&b.setAttribute('aria-expanded','false')})}
function pop(kind,btn){const open=$('.md-pop.'+kind);closePop();H.mt.closeMenus();if(open&&kind!=='draw')return;if(open)return;btn.setAttribute('aria-expanded','true');
  const p=document.createElement('div');p.className='md-pop '+kind;    // not .mt-pop: map_tools closes those on any outside clickL.DomEvent.disableClickPropagation(p);L.DomEvent.disableScrollPropagation(p);
  map.getContainer().append(p);const r=btn.getBoundingClientRect(),m=map.getContainer().getBoundingClientRect();p.style.right=Math.max(12,m.right-r.right)+'px';p.style.top=(r.bottom-m.top+6)+'px';
  ({data:dataPop,draw:drawPop,views:viewsPop})[kind](p)}
function toast(html,ms){let t=$('#md-toast');if(!t){t=document.createElement('div');t.id='md-toast';t.className='md-toast';map.getContainer().append(t);L.DomEvent.disableClickPropagation(t)}
  t.innerHTML=html;t.hidden=false;clearTimeout(toast.t);if(ms)toast.t=setTimeout(()=>t.hidden=true,ms);return t}

// ---------- your data ----------
let DS=[];          // [{id,name,color,on,count,kind}]
function dataPop(p){p.innerHTML=`<div class="mt-h">Your data</div>
  <p class="md-note">Add a spreadsheet or map file. Rows need latitude/longitude columns, or an address (Census and OpenStreetMap look them up). Files stay in this browser.</p>
  <label class="md-file"><input type="file" id="md-file" multiple accept=".csv,.tsv,.txt,.xlsx,.xls,.geojson,.json,.kml">Choose files</label>
  <p class="md-note">Or drag files onto the map.</p>
  ${DS.length?DS.map(d=>`<div class="md-ds"><label><input type="checkbox" data-on="${d.id}"${d.on?' checked':''}><i class="mt-dot" style="background:${d.color}"></i><span>${esc(d.name)}<small>${d.count.toLocaleString('en-US')} ${d.kind||'items'}${d.skipped?`, ${d.skipped} not placed`:''}</small></span></label>
    <span><button class="mt-link" data-zoom="${d.id}">Zoom</button><button class="mt-link" data-sty="${d.id}">Style</button><button class="mt-link" data-tbl="${d.id}">Table</button><button class="mt-link" data-ren="${d.id}">Rename</button><button class="mt-link" data-del="${d.id}">Remove</button></span></div>`).join(''):''}`;
  p.querySelector('#md-file').addEventListener('change',e=>{[...e.target.files].forEach(addFile);closePop()});
  p.querySelectorAll('[data-on]').forEach(c=>c.addEventListener('change',()=>{const d=DS.find(x=>x.id===c.dataset.on);d.on=c.checked;saveIndex();show(d)}));
  p.querySelectorAll('[data-zoom]').forEach(b=>b.addEventListener('click',()=>{const d=DS.find(x=>x.id===b.dataset.zoom);if(d._grp)map.fitBounds(L.featureGroup(d._layers).getBounds().pad(.1))}));
  p.querySelectorAll('[data-sty]').forEach(b=>b.addEventListener('click',()=>H.mt.openEditor(b.dataset.sty,'style')));
  p.querySelectorAll('[data-tbl]').forEach(b=>b.addEventListener('click',()=>{closePop();H.mt.openTable(b.dataset.tbl)}));
  p.querySelectorAll('[data-ren]').forEach(b=>b.addEventListener('click',()=>{const d=DS.find(x=>x.id===b.dataset.ren);const n=prompt('Layer name',d.name);if(n&&n.trim()){d.name=n.trim();saveIndex();register(d);dataPop(p)}}));
  p.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',async()=>{const d=DS.find(x=>x.id===b.dataset.del);if(!confirm(`Remove "${d.name}" from this browser? The original file is not touched.`))return;
    if(d._grp)map.removeLayer(d._grp);H.unregisterLayer(d.id);DS=DS.filter(x=>x!==d);await idb.del('ds:'+d.id);saveIndex();dataPop(p)}))}
function saveIndex(){idb.set('ds:index',DS.map(({id,name,color,on,count,kind,skipped})=>({id,name,color,on,count,kind,skipped})))}
async function restoreData(){const idx=await idb.get('ds:index')||[];for(const d of idx){const fc=await idb.get('ds:'+d.id);if(fc){DS.push(d);build(d,fc)}}}

async function addFile(file){const name=file.name.replace(/\.[^.]+$/,''),ext=(file.name.split('.').pop()||'').toLowerCase();
  const t=toast(`Reading <b>${esc(file.name)}</b>…`);
  try{let fc;
    if(['geojson','json'].includes(ext)){const j=JSON.parse(await file.text());fc=j.type==='FeatureCollection'?j:j.type==='Feature'?{type:'FeatureCollection',features:[j]}:null;if(!fc)throw new Error('This JSON is not GeoJSON.')}
    else if(ext==='kml'){await lib('togeo');fc=toGeoJSON.kml(new DOMParser().parseFromString(await file.text(),'text/xml'))}
    else{let rows;
      if(['xlsx','xls'].includes(ext)){await lib('xlsx');const wb=XLSX.read(await file.arrayBuffer());rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:null})}
      else{await lib('papa');rows=Papa.parse(await file.text(),{header:true,dynamicTyping:true,skipEmptyLines:true}).data}
      fc=await rowsToFeatures(rows,t)}
    fc.features=fc.features.filter(f=>f&&f.geometry);
    if(!fc.features.length)throw new Error('No mappable rows found. Add latitude/longitude columns or an address column.');
    const d={id:'u'+Date.now().toString(36),name,color:COLORS[DS.length%COLORS.length],on:true,count:fc.features.length,kind:fc._kind||'items',skipped:fc._skipped||0};
    await idb.set('ds:'+d.id,{type:'FeatureCollection',features:fc.features});DS.push(d);saveIndex();build(d,fc);
    if(d._layers.length)map.fitBounds(L.featureGroup(d._layers).getBounds().pad(.1),{maxZoom:16});
    toast(`Added <b>${esc(name)}</b>: ${d.count.toLocaleString('en-US')} on the map${d.skipped?`, ${d.skipped} couldn't be placed`:''}. Style or filter it under Layers.`,7000)}
  catch(err){console.error(err);toast(`<b>${esc(file.name)}</b> wasn't added: ${esc(err.message)}`,9000)}}

// rows from a spreadsheet: use lat/long columns, otherwise look up an address
const LAT=/^(lat|latitude|y|lat_?dd|point_?y)$/i,LON=/^(lon|lng|long|longitude|x|lon_?dd|long_?dd|point_?x)$/i;
async function rowsToFeatures(rows,t){if(!rows.length)return {type:'FeatureCollection',features:[]};const cols=Object.keys(rows[0]);
  const la=cols.find(c=>LAT.test(c.trim())),lo=cols.find(c=>LON.test(c.trim()));
  if(la&&lo){const fs=[];let skip=0;rows.forEach(r=>{const y=+r[la],x=+r[lo];if(isFinite(y)&&isFinite(x)&&Math.abs(y)<=90&&Math.abs(x)<=180&&(y||x))fs.push(pt(r,x,y));else skip++});
    return Object.assign({type:'FeatureCollection',features:fs},{_skipped:skip,_kind:'points'})}
  const addr=cols.find(c=>/^(full_?address|address|property ?address|street ?address|site ?address|addr|street|location)$/i.test(c.trim()))||cols.find(c=>/address|street/i.test(c));
  if(!addr)throw new Error('No latitude/longitude or address column found.');
  const city=cols.find(c=>/^(city|town|property ?city)$/i.test(c.trim())),st=cols.find(c=>/^(state|st)$/i.test(c.trim())),zip=cols.find(c=>/^(zip|zip ?code|postal|postal ?code|property ?zip)$/i.test(c.trim()));
  const max=1000;if(rows.length>max)throw new Error(`Address lookup is limited to ${max} rows at a time; this file has ${rows.length.toLocaleString('en-US')}. Add lat/long columns or split the file.`);
  const fs=[];let skip=0,i=0,stop=false;
  for(const r of rows){if(stop)break;i++;const q=[r[addr],city&&r[city],(st&&r[st])||'TX',zip&&r[zip]].filter(Boolean).join(', ');
    t.innerHTML=`Finding addresses: ${i} of ${rows.length} <button class="mt-link" id="md-stop">Stop</button>`;const sb=$('#md-stop');sb&&(sb.onclick=()=>stop=true);
    const g=await geocode(q);if(g)fs.push(pt(Object.assign({'Matched address':g.label},r),g.lon,g.lat));else skip++}
  return Object.assign({type:'FeatureCollection',features:fs},{_skipped:skip+(rows.length-i),_kind:'points'})}
const pt=(props,x,y)=>({type:'Feature',properties:props,geometry:{type:'Point',coordinates:[x,y]}});
let jn=0,lastN=0;
async function geocode(q){const key='geo:'+q.toUpperCase();const hit=await idb.get(key);if(hit!==undefined)return hit;
  let g=await census(q);if(!g)g=await nominatim(q);await idb.set(key,g||null);return g}
function census(q){return new Promise(res=>{const cb='mdcb'+(++jn),s=document.createElement('script');const done=v=>{delete window[cb];s.remove();res(v)};
  const to=setTimeout(()=>done(null),12000);
  window[cb]=j=>{clearTimeout(to);const m=j&&j.result&&j.result.addressMatches&&j.result.addressMatches[0];done(m?{lat:m.coordinates.y,lon:m.coordinates.x,label:m.matchedAddress}:null)};
  s.src=`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=jsonp&callback=${cb}`;s.onerror=()=>{clearTimeout(to);done(null)};document.head.append(s)})}
async function nominatim(q){const w=Math.max(0,1100-(Date.now()-lastN));await new Promise(r=>setTimeout(r,w));lastN=Date.now();
  try{const j=await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`)).json();return j[0]?{lat:+j[0].lat,lon:+j[0].lon,label:j[0].display_name}:null}catch(e){return null}}

// draw a dataset and hand it to the styling / filter / table system
function build(d,fc){if(d._grp)map.removeLayer(d._grp);d._grp=L.featureGroup();d._layers=[];d._feats=[];
  fc.features.forEach(f=>{let lay;const props=f.properties||{};
    if(f.geometry.type==='Point'){const [x,y]=f.geometry.coordinates;lay=L.circleMarker([y,x],{renderer:rUser,pane:'user',radius:6,color:'#fff',weight:1.2,fillColor:d.color,fillOpacity:.9})}
    else lay=L.geoJSON(f,{style:()=>({renderer:rUser,pane:'user',color:d.color,weight:2,fillColor:d.color,fillOpacity:.25}),pointToLayer:(_,ll)=>L.circleMarker(ll,{renderer:rUser,pane:'user',radius:6,color:'#fff',weight:1.2,fillColor:d.color,fillOpacity:.9})});
    const c=lay.getLatLng?lay.getLatLng():lay.getBounds().getCenter();
    const feat={raw:lay,props,lat:c.lat,lon:c.lng};lay._md=feat;lay.bindPopup(()=>popupHTML(d,props),{maxWidth:340,className:'md-popup'});
    lay.bindTooltip(()=>esc(String(firstName(props)??d.name)),{className:'tip',direction:'top',offset:[0,-6]});
    d._layers.push(lay);d._feats.push(feat)});
  register(d);show(d)}
function firstName(p){const k=Object.keys(p).find(k=>/name|title|address|label/i.test(k));return k?p[k]:Object.values(p)[0]}
function popupHTML(d,p){const rows=Object.entries(p).filter(([k,v])=>v!==null&&v!==''&&typeof v!=='object').slice(0,30);
  return `<div class="md-ph">${esc(d.name)}</div><table class="md-pt">${rows.map(([k,v])=>`<tr><th>${esc(k)}</th><td>${esc(typeof v==='number'?v.toLocaleString('en-US'):String(v))}</td></tr>`).join('')}</table>`}
function register(d){H.registerLayer({id:d.id,label:d.name,color:d.color,features:d._feats,isOn:()=>d.on&&map.hasLayer(d._grp),
  apply:()=>{d._grp.clearLayers();d._layers.forEach(l=>{if(!H.mtPass||H.mtPass(d.id,l))d._grp.addLayer(l)})},
  restyle:()=>d._layers.forEach(l=>{const o=(H.mtStyle&&H.mtStyle(d.id,l))||{};const fill=o.fill||d.color,op=o.op??1;
    if(l.setRadius){l.setRadius(o.r!=null?o.r:6);l.setStyle({fillColor:fill,fillOpacity:.9*op,opacity:op})}else l.setStyle({color:fill,fillColor:fill,fillOpacity:.25*op,opacity:op})}),
  open:l=>{const c=l.getLatLng?l.getLatLng():l.getBounds().getCenter();map.flyTo(c,Math.max(map.getZoom(),16),{duration:.5});setTimeout(()=>l.openPopup(),550)}})}
function show(d){if(d.on)d._grp.addTo(map);else map.removeLayer(d._grp);H.mt.refreshLayer(d.id)}

// ---------- drawing ----------
const DKEY='hcm-draw';let drawn=[],gm=null;
const TOOLS=[['Marker','Pin'],['Line','Line'],['Polygon','Area'],['Rectangle','Rectangle'],['Circle','Circle'],['Text','Text note']];
async function geoman(){if(gm)return gm;const l=document.createElement('link');l.rel='stylesheet';l.href=LIB.geomanCss;document.head.append(l);await lib('geoman');
  // Geoman attaches itself only to maps created after it loads; ours already exists, so attach it here
  if(!map.pm)map.pm=new L.PM.Map(map);
  map.pm.setGlobalOptions({pathOptions:{renderer:rDraw,pane:'draw',color:'#f43f5e',weight:3,fillOpacity:.15},panes:{layerPane:'draw',markerPane:'markerPane'},snappable:true,snapDistance:15,continueDrawing:false});
  map.on('pm:create',e=>{const lay=e.layer;lay._d={name:'',note:'',color:'#f43f5e',kind:e.shape};adopt(lay);saveDrawings();setTimeout(()=>openShape(lay),50);document.querySelectorAll('.md-tool').forEach(b=>b.setAttribute('aria-pressed','false'))});
  return gm=map.pm}
function drawPop(p){p.innerHTML=`<div class="mt-h">Draw</div><div class="md-tools">${TOOLS.map(([k,t])=>`<button class="md-tool" data-t="${k}" aria-pressed="false">${t}</button>`).join('')}</div>
  <p class="md-note">Click the map to draw. Double-click or click the first point to finish an area. Click a drawing later to name it, add a note, recolor, edit or delete it. Drawings are saved in this browser.</p>
  ${drawn.length?`<div class="mt-sub">Your drawings (${drawn.length})</div>${drawn.map((l,i)=>`<div class="md-ds"><span><i class="mt-dot" style="background:${l._d.color}"></i>${esc(l._d.name||kindLabel(l._d.kind))}</span><span><button class="mt-link" data-go="${i}">Go to</button></span></div>`).join('')}<button class="mt-link" id="md-clear-draw">Delete all drawings</button>`:''}`;
  p.querySelectorAll('.md-tool').forEach(b=>b.addEventListener('click',async()=>{await geoman();const on=b.getAttribute('aria-pressed')==='true';map.pm.disableDraw();
    p.querySelectorAll('.md-tool').forEach(x=>x.setAttribute('aria-pressed','false'));if(!on){map.pm.enableDraw(b.dataset.t);b.setAttribute('aria-pressed','true')}}));
  p.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>{const l=drawn[+b.dataset.go];const c=l.getLatLng?l.getLatLng():l.getBounds().getCenter();map.flyTo(c,Math.max(map.getZoom(),16));setTimeout(()=>openShape(l),600)}));
  const cl=p.querySelector('#md-clear-draw');cl&&cl.addEventListener('click',()=>{if(!confirm('Delete all your drawings in this browser?'))return;drawn.forEach(l=>map.removeLayer(l));drawn=[];saveDrawings();drawPop(p)})}
const kindLabel=k=>({Marker:'Pin',Line:'Line',Polygon:'Area',Rectangle:'Rectangle',Circle:'Circle',Text:'Text note'}[k]||'Drawing');
function adopt(lay){drawn.push(lay);paint(lay);lay.on('click',e=>{L.DomEvent.stop(e);openShape(lay)});
  lay.on('pm:edit pm:dragend pm:textchange',saveDrawings);if(lay._d.name)lay.bindTooltip(esc(lay._d.name),{direction:'top',className:'tip'})}
function paint(lay){const c=lay._d.color;if(lay.setStyle&&!lay.getLatLng||lay instanceof L.Circle)lay.setStyle({color:c,fillColor:c});
  if(lay instanceof L.Marker&&lay._d.kind!=='Text')lay.setIcon(L.divIcon({className:'md-pin',html:`<i style="background:${c}"></i>`,iconSize:[22,30],iconAnchor:[11,30]}))}
function measureOf(lay){if(lay instanceof L.Circle){const r=lay.getRadius();return `Radius ${fmtLen(r)} · ${fmtArea(Math.PI*r*r)}`}
  if(lay instanceof L.Polygon){const ll=lay.getLatLngs()[0];return fmtArea(geoArea(ll))}
  if(lay instanceof L.Polyline){const ll=lay.getLatLngs();let d=0;for(let i=1;i<ll.length;i++)d+=ll[i].distanceTo(ll[i-1]);return fmtLen(d)}return ''}
function openShape(lay){const d=lay._d,m=measureOf(lay);
  const html=`<div class="md-ph">${esc(kindLabel(d.kind))}${m?` · ${m}`:''}</div>
   <input class="md-in" id="md-name" placeholder="Name" value="${esc(d.name)}"><textarea class="md-in" id="md-note" rows="3" placeholder="Notes">${esc(d.note)}</textarea>
   <div class="md-row">${COLORS.map(c=>`<button class="md-col" data-c="${c}" style="background:${c}" aria-pressed="${c===d.color}"></button>`).join('')}</div>
   <div class="md-row"><button class="mt-link" id="md-edit">Edit shape</button><button class="mt-link" id="md-del">Delete</button></div>`;
  const c=lay.getLatLng?lay.getLatLng():lay.getBounds().getCenter();const pp=L.popup({maxWidth:300,className:'md-popup'}).setLatLng(c).setContent(html).openOn(map);
  const el=pp.getElement();L.DomEvent.disableClickPropagation(el);
  el.querySelector('#md-name').addEventListener('input',e=>{d.name=e.target.value;lay.unbindTooltip();if(d.name)lay.bindTooltip(esc(d.name),{direction:'top',className:'tip'});saveDrawings()});
  el.querySelector('#md-note').addEventListener('input',e=>{d.note=e.target.value;saveDrawings()});
  el.querySelectorAll('.md-col').forEach(b=>b.addEventListener('click',()=>{d.color=b.dataset.c;paint(lay);saveDrawings();el.querySelectorAll('.md-col').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))}));
  el.querySelector('#md-edit').addEventListener('click',async()=>{await geoman();map.closePopup();if(!lay.pm)L.PM.reInitLayer(lay);lay.off('pm:edit pm:dragend').on('pm:edit pm:dragend',saveDrawings);if(lay.pm.enabled()){lay.pm.disable();saveDrawings()}else{lay.pm.enable({allowSelfIntersection:false});toast('Drag the points to reshape. Click "Edit shape" again on the drawing to finish.',6000)}});
  el.querySelector('#md-del').addEventListener('click',()=>{map.closePopup();map.removeLayer(lay);drawn=drawn.filter(x=>x!==lay);saveDrawings()})}
function saveDrawings(){ls.set(DKEY,drawn.map(l=>{const props=Object.assign({},l._d);let geo;
  if(l instanceof L.Circle){props.radius=l.getRadius();geo={type:'Point',coordinates:[l.getLatLng().lng,l.getLatLng().lat]}}
  else if(l instanceof L.Marker){geo={type:'Point',coordinates:[l.getLatLng().lng,l.getLatLng().lat]};if(l._d.kind==='Text'&&l.pm&&l.pm.getText)props.text=l.pm.getText()}
  else geo=l.toGeoJSON().geometry;return {type:'Feature',properties:props,geometry:geo}}))}
function restoreDrawings(){const fs=ls.get(DKEY,[]);if(!fs.length)return;
  fs.forEach(f=>{const p=f.properties,g=f.geometry;let lay;const opt={renderer:rDraw,pane:'draw',color:p.color,weight:3,fillColor:p.color,fillOpacity:.15};
    if(p.kind==='Circle')lay=L.circle([g.coordinates[1],g.coordinates[0]],Object.assign({radius:p.radius},opt));
    else if(p.kind==='Text')lay=L.marker([g.coordinates[1],g.coordinates[0]],{icon:L.divIcon({className:'md-text',html:`<span>${esc(p.text||p.name||'Note')}</span>`,iconSize:null})});
    else if(g.type==='Point')lay=L.marker([g.coordinates[1],g.coordinates[0]]);
    else lay=L.geoJSON({type:'Feature',geometry:g},{style:()=>opt}).getLayers()[0];
    lay._d={name:p.name||'',note:p.note||'',color:p.color||'#f43f5e',kind:p.kind};lay.addTo(map);adopt(lay)});
  drawn.forEach(paint)}

// ---------- saved views and backup ----------
const VKEY='hcm-views';
const toggles=()=>[...document.querySelectorAll('#l-ctx,#l-roads,#l-q,#f-oh,#f-om,#f-on,input[data-l]')];
const tid=i=>i.id||('dl:'+i.dataset.l);
function viewsPop(p){const views=ls.get(VKEY,[]);
  p.innerHTML=`<div class="mt-h">Saved views</div>
   <div class="md-row"><input class="md-in" id="md-vname" placeholder="Name this view"><button class="mt-btn" id="md-vsave">Save</button></div>
   <p class="md-note">Saves where you're looking, the basemap and which layers are on. Styles and filters stay as they are.</p>
   ${views.map((v,i)=>`<div class="md-ds"><span>${esc(v.name)}<small>${esc(v.when)}</small></span><span><button class="mt-link" data-v="${i}">Go</button><button class="mt-link" data-vd="${i}">Delete</button></span></div>`).join('')||'<p class="md-note">No saved views yet.</p>'}
   <div class="mt-sub">Backup</div><p class="md-note">One file with your notes, statuses, ranking settings, styles, filters, drawings, views and added data. Use it to move to another browser or device. It never includes your map key.</p>
   <div class="md-row"><button class="mt-link" id="md-exp">Download backup</button><label class="mt-link md-imp">Restore from backup<input type="file" id="md-impf" accept=".json" hidden></label></div>`;
  const save=()=>{const n=p.querySelector('#md-vname').value.trim()||`View ${views.length+1}`;const c=map.getCenter();
    views.push({name:n,when:new Date().toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'}),lat:c.lat,lon:c.lng,z:map.getZoom(),base:H.mt.getBase(),on:Object.fromEntries(toggles().map(i=>[tid(i),i.checked])),user:Object.fromEntries(DS.map(d=>[d.id,d.on]))});
    ls.set(VKEY,views);viewsPop(p)};
  p.querySelector('#md-vsave').addEventListener('click',save);p.querySelector('#md-vname').addEventListener('keydown',e=>{if(e.key==='Enter')save()});
  p.querySelectorAll('[data-v]').forEach(b=>b.addEventListener('click',()=>{const v=views[+b.dataset.v];H.mt.setBase(v.base);
    toggles().forEach(i=>{const w=v.on[tid(i)];if(w!=null&&w!==i.checked){i.checked=w;i.dispatchEvent(new Event('change',{bubbles:true}))}});
    DS.forEach(d=>{if(v.user&&v.user[d.id]!=null&&v.user[d.id]!==d.on){d.on=v.user[d.id];show(d)}});saveIndex();
    map.flyTo([v.lat,v.lon],v.z,{duration:.8});closePop()}));
  p.querySelectorAll('[data-vd]').forEach(b=>b.addEventListener('click',()=>{views.splice(+b.dataset.vd,1);ls.set(VKEY,views);viewsPop(p)}));
  p.querySelector('#md-exp').addEventListener('click',exportBackup);
  p.querySelector('#md-impf').addEventListener('change',e=>{const f=e.target.files[0];if(f)importBackup(f)})}
async function exportBackup(){const out={app:'hospital-condo-map',version:1,saved:new Date().toISOString(),local:{},idb:{}};
  for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith('hcm-')&&k!=='hcm-key')out.local[k]=localStorage.getItem(k)}
  for(const k of await idb.keys())if(String(k).startsWith('ds:'))out.idb[k]=await idb.get(k);
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out)],{type:'application/json'}));a.download=`map-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();
  toast('Backup downloaded. It holds your private notes and data: keep it somewhere safe.',7000)}
async function importBackup(f){try{const j=JSON.parse(await f.text());if(j.app!=='hospital-condo-map')throw new Error('Not a backup from this map.');
    if(!confirm('Restore this backup? It replaces your current notes, settings, drawings, views and added data in this browser.'))return;
    Object.entries(j.local||{}).forEach(([k,v])=>{if(k!=='hcm-key')localStorage.setItem(k,v)});
    for(const k of await idb.keys())if(String(k).startsWith('ds:'))await idb.del(k);
    for(const [k,v] of Object.entries(j.idb||{}))await idb.set(k,v);location.reload()}
  catch(e){toast('Restore failed: '+esc(e.message),8000)}}

// measurement helpers (same math as map_tools.js)
function fmtLen(m){const ft=m*3.28084;return ft<2640?`${Math.round(ft).toLocaleString('en-US')} ft`:`${(m/1609.344).toFixed(2)} mi`}
function geoArea(ll){if(ll.length<3)return 0;const R=6378137,rad=Math.PI/180;let s=0;for(let i=0;i<ll.length;i++){const a=ll[i],b=ll[(i+1)%ll.length];s+=(b.lng-a.lng)*rad*(2+Math.sin(a.lat*rad)+Math.sin(b.lat*rad))}return Math.abs(s*R*R/2)}
function fmtArea(m2){const sf=m2*10.7639,ac=sf/43560;return ac<1?`${Math.round(sf).toLocaleString('en-US')} SF`:`${ac.toFixed(2)} acres`}

const CSS=`
.md-pop{position:absolute;z-index:570;background:var(--surface);border:1px solid var(--rule);border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.25);padding:8px;width:300px;max-width:calc(100% - 24px);max-height:70vh;overflow:auto;font-size:12.5px}
.md-pop.data{width:380px}
.md-note{margin:4px 2px 8px;color:var(--muted);font-size:11.5px;line-height:1.4}
.md-file{display:inline-block;cursor:pointer;font-family:var(--f-display);font-weight:600;font-size:12.5px;border:1px dashed var(--ink);border-radius:4px;padding:7px 12px;margin:2px}.md-file input{display:none}
.md-ds{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 4px;border-top:1px solid var(--rule)}
.md-ds label,.md-ds>span:first-child{display:flex;align-items:center;gap:7px;cursor:pointer}.md-ds small{display:block;color:var(--muted);font-size:10.5px}
.md-ds>span:last-child{white-space:nowrap}.md-ds .mt-link{margin-left:6px}
.md-drop{position:absolute;inset:0;z-index:590;display:none;place-items:center;background:rgba(17,17,17,.45);pointer-events:none}
.md-drop.on{display:grid}.md-drop div{background:var(--surface);color:var(--ink);border:2px dashed var(--ink);border-radius:8px;padding:22px 28px;font-family:var(--f-display);font-weight:600}
.md-toast{position:absolute;left:50%;bottom:42px;transform:translateX(-50%);z-index:585;background:var(--ink);color:var(--canvas);font-size:12.5px;padding:8px 14px;border-radius:5px;max-width:80%}
.md-toast .mt-link{color:var(--canvas)}
.md-tools{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px}
.md-tool{all:unset;cursor:pointer;text-align:center;border:1px solid var(--rule);border-radius:4px;padding:7px 4px;font-size:12px}.md-tool:hover{border-color:var(--ink)}
.md-tool[aria-pressed="true"]{background:#fde047;color:#111;border-color:#fde047}
.md-popup .leaflet-popup-content{margin:10px 12px;font-size:12.5px}.md-ph{font-family:var(--f-display);font-weight:600;font-size:13px;margin-bottom:6px}
.md-pt{border-collapse:collapse;width:100%}.md-pt th{text-align:left;color:#555;font-weight:500;padding:2px 8px 2px 0;vertical-align:top;white-space:nowrap}.md-pt td{padding:2px 0}
.md-in{display:block;width:100%;box-sizing:border-box;font:inherit;font-size:12.5px;border:1px solid #ccc;border-radius:3px;padding:5px 7px;margin:4px 0;background:var(--surface);color:var(--ink)}
.md-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px}.md-row .md-in{flex:1;margin:0}
.md-col{all:unset;cursor:pointer;width:20px;height:20px;border-radius:50%;border:2px solid transparent}.md-col[aria-pressed="true"]{border-color:#111;box-shadow:0 0 0 2px #fff inset}
.md-pin i{display:block;width:18px;height:18px;margin:0 2px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}
.md-text span{display:inline-block;background:var(--surface);color:var(--ink);border:1px solid var(--rule);border-radius:3px;padding:3px 7px;font-size:12.5px;font-weight:600;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25)}
.md-imp{display:inline-block}`;
})();
