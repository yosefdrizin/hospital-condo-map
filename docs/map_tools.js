// Map tools, Felt-style: live basemap menu, search, measure (distance / area / radius) and a Layers panel.
// Public file with no private data. Works on the plain map and in deal mode; deal_layer.js adds to search via HCM.searchProviders.
(function(){
const $=s=>document.querySelector(s);
const USGS='https://basemap.nationalmap.gov/arcgis/rest/services/';
// public-domain imagery and topo from USGS (tiles to zoom 16, scaled up beyond); street map from OpenStreetMap
const BASES=[
 {k:'sat',label:'Satellite',mode:'aerial',url:USGS+'USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',max:16,attr:'Imagery: USGS The National Map, USDA NAIP'},
 {k:'hyb',label:'Satellite + labels',mode:'aerial',url:USGS+'USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',max:16,attr:'USGS The National Map'},
 {k:'snap',label:'Sharp aerial snapshots',mode:'aerial',url:null,attr:'Imagery: USGS The National Map, USDA NAIP',note:'Stitched close-ups around each hospital'},
 {k:'streets',label:'Streets',mode:'plan',url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',max:19,attr:'© OpenStreetMap contributors',noRoads:true},
 {k:'topo',label:'Topo',mode:'plan',url:USGS+'USGSTopo/MapServer/tile/{z}/{y}/{x}',max:16,attr:'USGS The National Map',noRoads:true},
 {k:'plan',label:'Plan (parcels only)',mode:'plan',url:null,attr:''}];
const store={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
let H,map,tile=null,base=null,baseOpacity=store.get('hcm-base-op',1);

function boot(){H=window.HCM;map=H.map;H.searchProviders=H.searchProviders||[];
  const css=document.createElement('style');css.textContent=CSS;document.head.append(css);
  map.createPane('basetiles').style.zIndex=140;
  const bar=document.createElement('div');bar.className='mt-bar';
  bar.innerHTML=`<div class="mt-search"><input id="mt-q" type="search" placeholder="Search address, building, owner…" autocomplete="off" aria-label="Search"><div class="mt-res" id="mt-res" hidden></div></div>
   <button class="mt-btn" id="mt-base" aria-haspopup="true" aria-expanded="false">Basemap</button>`;
  map.getContainer().append(bar);
  const tools=document.createElement('div');tools.className='mt-tools';
  tools.innerHTML=`<button class="mt-btn" id="mt-layers" aria-expanded="false" title="Layers">Layers</button>
   <button class="mt-btn" data-m="line" title="Measure distance">Distance</button><button class="mt-btn" data-m="area" title="Measure area">Area</button><button class="mt-btn" data-m="circle" title="Measure a radius">Radius</button>`;
  map.getContainer().append(tools);
  [bar,tools].forEach(el=>{L.DomEvent.disableClickPropagation(el);L.DomEvent.disableScrollPropagation(el)});
  const old=$('.basebar');if(old)old.hidden=true;
  const saved=store.get('hcm-basemap',H.getMode()==='plan'?'plan':'sat');setBase(BASES.find(b=>b.k===saved)?saved:'sat');
  $('#mt-base').addEventListener('click',e=>toggleMenu('base',e.currentTarget));
  $('#mt-layers').addEventListener('click',e=>toggleMenu('layers',e.currentTarget));
  tools.querySelectorAll('[data-m]').forEach(b=>b.addEventListener('click',()=>measure(b.dataset.m,b)));
  wireSearch();
  document.addEventListener('keydown',e=>{if(e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();$('#mt-q').focus()}});
  document.addEventListener('click',e=>{if(!e.target.closest('.mt-pop,#mt-base,#mt-layers'))closeMenus();if(!e.target.closest('.mt-search'))$('#mt-res').hidden=true});
}
if(window.HCM)boot();else window.addEventListener('hcm-ready',boot,{once:true});

// ---------- basemaps ----------
function setBase(k){const b=BASES.find(x=>x.k===k);base=b;store.set('hcm-basemap',k);
  if(tile){map.removeLayer(tile);tile=null}
  if(b.url){tile=L.tileLayer(b.url,{pane:'basetiles',maxNativeZoom:b.max,maxZoom:20,opacity:baseOpacity,attribution:b.attr,crossOrigin:true,detectRetina:false}).addTo(map)}
  H.setMode(b.mode);H.setLive(!!b.url&&b.mode==='aerial');
  const roads=$('#l-roads');if(roads&&b.noRoads&&roads.checked){roads.checked=false;roads.dispatchEvent(new Event('change'))}
  if(roads&&!b.noRoads&&!roads.checked){roads.checked=true;roads.dispatchEvent(new Event('change'))}
  const cr=$('#credit');if(cr){cr.hidden=!b.attr;cr.textContent=b.attr}
  const btn=$('#mt-base');if(btn)btn.innerHTML=`<span class="mt-sw mt-${b.k}"></span>${b.label}`}
function closeMenus(){document.querySelectorAll('.mt-pop').forEach(p=>p.remove());['#mt-base','#mt-layers'].forEach(s=>{const b=$(s);b&&b.setAttribute('aria-expanded','false')})}
function toggleMenu(kind,btn){const open=$('.mt-pop.'+kind);closeMenus();if(open)return;btn.setAttribute('aria-expanded','true');
  const pop=document.createElement('div');pop.className='mt-pop '+kind;L.DomEvent.disableClickPropagation(pop);L.DomEvent.disableScrollPropagation(pop);
  pop.innerHTML=kind==='base'?baseMenu():layersMenu();map.getContainer().append(pop);
  const r=btn.getBoundingClientRect(),m=map.getContainer().getBoundingClientRect();
  if(kind==='base'){pop.style.left=(r.left-m.left)+'px';pop.style.top=(r.bottom-m.top+6)+'px'}else{pop.style.right=(m.right-r.right)+'px';pop.style.top=(r.bottom-m.top+6)+'px'}
  wireMenu(pop,kind)}
function baseMenu(){return `<div class="mt-h">Basemap</div>${BASES.map(b=>`<button class="mt-opt" data-b="${b.k}" aria-pressed="${base.k===b.k}"><span class="mt-sw mt-${b.k}"></span><span>${b.label}${b.note?`<small>${b.note}</small>`:''}</span></button>`).join('')}
  ${opacityRow()}`}
function opacityRow(){return `<label class="mt-op"><span>Basemap strength</span><input type="range" min="0.2" max="1" step="0.05" value="${baseOpacity}" id="mt-op"></label>`}
// mirrors the page's own checkboxes so both stay in sync
function layersMenu(){const row=(id,label,color)=>{const i=document.getElementById(id);if(!i)return '';return `<label class="mt-row"><input type="checkbox" data-mirror="${id}"${i.checked?' checked':''}><i class="mt-dot" style="background:${color}"></i>${label}</label>`};
  const chipLabel=i=>i.closest('label')?i.closest('label').textContent.trim():'';
  const deal=[...document.querySelectorAll('input[data-l]')];
  const ringsOn=H.ringLayers.length&&map.hasLayer(H.ringLayers[0]);
  return `<div class="mt-h">Layers</div>
   ${deal.length?`<div class="mt-sub">Deal data</div>${deal.map(i=>{i.id=i.id||'mt-l-'+i.dataset.l;return row(i.id,chipLabel(i),getComputedStyle(i.nextElementSibling).backgroundColor)}).join('')}`:''}
   <div class="mt-sub">Condos and parcels</div>${row('f-oh','Hospital-owned condos','var(--u-hosp)')}${row('f-om','Independent medical condos','var(--green)')}${row('f-on','Independent other condos','var(--tan)')}${row('l-ctx','Parcels by use (zoom in)','var(--u-med)')}
   <div class="mt-sub">Reference</div><label class="mt-row"><input type="checkbox" id="mt-rings"${ringsOn?' checked':''}><i class="mt-dot" style="background:transparent;border:1.5px dashed var(--ink)"></i>1-mile hospital rings</label>${row('l-q','¼-mile rings','transparent')}${row('l-roads','Street lines (plan view)','var(--road-edge)')}
   ${opacityRow()}`}
function wireMenu(pop,kind){
  pop.querySelectorAll('[data-b]').forEach(b=>b.addEventListener('click',()=>{setBase(b.dataset.b);closeMenus()}));
  const op=pop.querySelector('#mt-op');op&&op.addEventListener('input',()=>{baseOpacity=+op.value;store.set('hcm-base-op',baseOpacity);if(tile)tile.setOpacity(baseOpacity);
    document.querySelectorAll('.leaflet-base-pane img').forEach(i=>i.style.opacity=baseOpacity)});
  pop.querySelectorAll('[data-mirror]').forEach(c=>c.addEventListener('change',()=>{const t=document.getElementById(c.dataset.mirror);if(t){t.checked=c.checked;t.dispatchEvent(new Event('change',{bubbles:true}))}}));
  const rg=pop.querySelector('#mt-rings');rg&&rg.addEventListener('change',()=>H.ringLayers.forEach(r=>rg.checked?r.addTo(map):map.removeLayer(r)))}

// ---------- search ----------
const norm=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
function localResults(q){const n=norm(q),D=H.D,out=[];if(n.length<2)return out;
  D.hospitals.forEach((h,i)=>{if(norm(h.n+' '+h.ad).includes(n))out.push({kind:'Hospital',label:h.n,sub:h.ad,lat:h.lat,lon:h.lon,go:()=>H.selectHosp(i)})});
  D.condos.forEach((c,i)=>{if(norm(c.p+' '+c.a+' '+c.lo).includes(n)){const ll=decodeFirst(c.g);out.push({kind:'Condo project',label:H.title(c.p),sub:`${c.a}, ${c.city} · ${c.cu} suites`,lat:ll[0],lon:ll[1],go:()=>H.selectCondo(i)})}});
  if(n.length>=3)for(const p of D.parcels){if(out.length>40)break;const s=norm((p.a||'')+' '+(p.nm||'')+' '+(p.o||''));if(s.includes(n)){const ll=decodeFirst(p.g);out.push({kind:'Parcel',label:p.a||H.title(p.nm||''),sub:[p.nm&&H.title(p.nm),p.o&&H.title(p.o)].filter(Boolean).join(' · '),lat:ll[0],lon:ll[1],zoom:18})}}
  H.searchProviders.forEach(f=>{try{out.unshift(...f(q).slice(0,8))}catch(e){}});
  return out.slice(0,14)}
function decodeFirst(g){const pts=H.decode(Array.isArray(g)?g[0]:g);const la=pts.reduce((a,p)=>a+p[0],0)/pts.length,lo=pts.reduce((a,p)=>a+p[1],0)/pts.length;return [la,lo]}
let gT=null,lastG=0,pin=null;
function geocode(q){clearTimeout(gT);return new Promise(res=>{gT=setTimeout(async()=>{const wait=Math.max(0,1100-(Date.now()-lastG));await new Promise(r=>setTimeout(r,wait));lastG=Date.now();
  try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=us&viewbox=-97.35,33.25,-96.35,32.5&bounded=1&q=${encodeURIComponent(q)}`,{headers:{'Accept-Language':'en'}});
    const j=await r.json();res(j.map(x=>({kind:'Address',label:x.display_name.split(',').slice(0,2).join(','),sub:x.display_name.split(',').slice(2,5).join(',').trim(),lat:+x.lat,lon:+x.lon,zoom:18})))}catch(e){res([])}},450)})}
function wireSearch(){const q=$('#mt-q'),box=$('#mt-res');let act=-1,items=[];
  const render=()=>{box.hidden=!items.length&&!q.value.trim();box.innerHTML=items.length?items.map((r,i)=>`<button class="mt-hit${i===act?' on':''}" data-i="${i}"><b>${H.esc(r.label)}</b><small>${H.esc(r.kind)}${r.sub?' · '+H.esc(r.sub):''}</small></button>`).join(''):(q.value.trim().length>2?'<p class="mt-none">No match yet…</p>':'');
    box.querySelectorAll('[data-i]').forEach(b=>b.addEventListener('click',()=>pick(items[+b.dataset.i])))};
  const run=async()=>{const v=q.value.trim();items=localResults(v);act=-1;render();if(v.length>=4){const g=await geocode(v);if(q.value.trim()===v){items=items.concat(g).slice(0,16);render()}}};
  q.addEventListener('input',run);q.addEventListener('focus',()=>{if(q.value.trim())run()});
  q.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){act=Math.min(items.length-1,act+1);render();e.preventDefault()}else if(e.key==='ArrowUp'){act=Math.max(0,act-1);render();e.preventDefault()}
    else if(e.key==='Enter'&&items.length){pick(items[act<0?0:act])}else if(e.key==='Escape'){box.hidden=true;q.blur()}})}
function pick(r){$('#mt-res').hidden=true;if(pin){map.removeLayer(pin);pin=null}
  if(r.go){r.go();if(r.kind!=='Hospital')map.flyTo([r.lat,r.lon],Math.max(map.getZoom(),17),{duration:.6});return}
  map.flyTo([r.lat,r.lon],r.zoom||17,{duration:.7});
  pin=L.circleMarker([r.lat,r.lon],{renderer:L.svg({pane:'markerPane'}),pane:'markerPane',radius:9,color:'#fff',weight:3,fillColor:'#e11d48',fillOpacity:1}).addTo(map).bindTooltip(H.esc(r.label),{permanent:true,direction:'right',offset:[10,0],className:'tip'})}

// ---------- measure ----------
let M=null;
const ftOf=m=>m*3.28084;
function fmtLen(m){const ft=ftOf(m);return ft<2640?`${Math.round(ft).toLocaleString('en-US')} ft`:`${(m/1609.344).toFixed(2)} mi`}
function geoArea(ll){if(ll.length<3)return 0;const R=6378137,rad=Math.PI/180;let s=0;for(let i=0;i<ll.length;i++){const a=ll[i],b=ll[(i+1)%ll.length];s+=(b.lng-a.lng)*rad*(2+Math.sin(a.lat*rad)+Math.sin(b.lat*rad))}return Math.abs(s*R*R/2)}
function fmtArea(m2){const sf=m2*10.7639,ac=sf/43560;return ac<1?`${Math.round(sf).toLocaleString('en-US')} SF (${ac.toFixed(2)} ac)`:ac<640?`${ac.toFixed(2)} acres (${Math.round(sf).toLocaleString('en-US')} SF)`:`${(ac/640).toFixed(2)} sq mi`}
function measure(kind,btn){const was=M&&M.kind;stopMeasure(true);if(was===kind)return;
  const r=L.svg({pane:'markerPane'});
  M={kind,btn,pts:[],g:L.layerGroup().addTo(map),r,shape:null,tip:L.tooltip({permanent:true,direction:'right',offset:[12,0],className:'tip mt-tip'})};
  btn.setAttribute('aria-pressed','true');map.getContainer().classList.add('mt-measuring');map.doubleClickZoom.disable();
  M.hint=hint(kind==='circle'?'Click the center, then click again to set the radius. Esc to stop.':`Click to add points. Double-click to finish. Esc to stop.`);
  map.on('click',mClick);map.on('mousemove',mMove);map.on('dblclick',mDone);document.addEventListener('keydown',mKey)}
function hint(t){const h=document.createElement('div');h.className='mt-hint';h.textContent=t;map.getContainer().append(h);return h}
function mKey(e){if(e.key==='Escape')stopMeasure(false);if(e.key==='Enter')mDone()}
function mClick(e){const p=e.latlng;
  if(M.kind==='circle'){if(!M.pts.length){M.pts=[p];M.shape=L.circle(p,{renderer:M.r,pane:'markerPane',radius:1,color:'#fde047',weight:2,fillOpacity:.08,interactive:false}).addTo(M.g)}else{M.shape.setRadius(p.distanceTo(M.pts[0]));finish()}return}
  M.pts.push(p);L.circleMarker(p,{renderer:M.r,pane:'markerPane',radius:4,color:'#111',weight:1.5,fillColor:'#fde047',fillOpacity:1,interactive:false}).addTo(M.g);draw(null)}
function mMove(e){if(!M||!M.pts.length)return;if(M.kind==='circle'){M.shape.setRadius(e.latlng.distanceTo(M.pts[0]));label(e.latlng);return}draw(e.latlng)}
function draw(cursor){const pts=cursor?M.pts.concat([cursor]):M.pts;if(M.shape)M.g.removeLayer(M.shape);
  M.shape=(M.kind==='area'?L.polygon:L.polyline)(pts,{renderer:M.r,pane:'markerPane',color:'#fde047',weight:2.5,dashArray:M.done?null:'6 5',fillOpacity:.12,interactive:false}).addTo(M.g);label(cursor||pts[pts.length-1])}
function label(at){let t='';
  if(M.kind==='line'){const pts=M.shape.getLatLngs();let d=0;for(let i=1;i<pts.length;i++)d+=pts[i].distanceTo(pts[i-1]);t=fmtLen(d)}
  else if(M.kind==='area'){const pts=M.shape.getLatLngs()[0]||[];let per=0;for(let i=0;i<pts.length;i++)per+=pts[i].distanceTo(pts[(i+1)%pts.length]);t=`${fmtArea(geoArea(pts))}<br><small>perimeter ${fmtLen(per)}</small>`}
  else{const rr=M.shape.getRadius();t=`radius ${fmtLen(rr)}<br><small>${fmtArea(Math.PI*rr*rr)}</small>`}
  M.tip.setLatLng(at).setContent(t);if(!M.g.hasLayer(M.tip))M.g.addLayer(M.tip)}
function mDone(e){if(e)L.DomEvent.stop(e);if(!M)return;if(M.kind!=='circle'&&M.pts.length<(M.kind==='area'?3:2))return;finish()}
function finish(){M.done=true;if(M.kind!=='circle')draw(null);else label(M.pts[0]);
  const keep=M.g;stopMeasure(false,true);
  const x=document.createElement('button');x.className='mt-btn mt-clear';x.textContent='Clear measurement';map.getContainer().append(x);
  L.DomEvent.disableClickPropagation(x);x.addEventListener('click',()=>{map.removeLayer(keep);x.remove()});done.push({keep,x})}
const done=[];
function stopMeasure(clearAll,keepShape){if(clearAll){done.forEach(d=>{map.removeLayer(d.keep);d.x.remove()});done.length=0}
  if(!M)return;map.off('click',mClick);map.off('mousemove',mMove);map.off('dblclick',mDone);document.removeEventListener('keydown',mKey);
  map.getContainer().classList.remove('mt-measuring');setTimeout(()=>map.doubleClickZoom.enable(),300);M.btn.setAttribute('aria-pressed','false');M.hint&&M.hint.remove();
  if(!keepShape)map.removeLayer(M.g);M=null}

const CSS=`
.mt-bar{position:absolute;top:max(12px,env(safe-area-inset-top,0px));left:max(12px,env(safe-area-inset-left,0px));z-index:560;display:flex;gap:6px;align-items:flex-start;max-width:calc(100% - 140px)}
.mt-search{position:relative;width:300px;max-width:52vw}
#mt-q{width:100%;box-sizing:border-box;font:inherit;font-size:13px;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:4px;padding:7px 10px;box-shadow:0 1px 4px rgba(0,0,0,.18)}
#mt-q:focus{outline:2px solid var(--focus);outline-offset:0}
.mt-res{position:absolute;left:0;right:0;top:calc(100% + 4px);background:var(--surface);border:1px solid var(--rule);border-radius:4px;box-shadow:0 4px 14px rgba(0,0,0,.22);max-height:60vh;overflow:auto}
.mt-hit{all:unset;box-sizing:border-box;display:block;width:100%;cursor:pointer;padding:7px 10px;border-bottom:1px solid var(--rule)}
.mt-hit b{display:block;font-size:12.5px;font-weight:600}.mt-hit small{display:block;font-size:11.5px;color:var(--muted)}
.mt-hit:hover,.mt-hit.on{background:var(--canvas)}.mt-none{margin:0;padding:8px 10px;font-size:12px;color:var(--muted)}
.mt-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:var(--f-display);font-weight:600;font-size:12.5px;letter-spacing:.03em;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:4px;padding:6px 10px;box-shadow:0 1px 4px rgba(0,0,0,.18);white-space:nowrap}
.mt-btn:hover,.mt-btn[aria-expanded="true"]{border-color:var(--ink)}.mt-btn[aria-pressed="true"]{background:#fde047;color:#111;border-color:#fde047}
.mt-btn:focus-visible{outline:2px solid var(--focus);outline-offset:1px}
.mt-tools{position:absolute;top:max(12px,env(safe-area-inset-top,0px));right:58px;z-index:560;display:flex;gap:6px}
.mt-pop{position:absolute;z-index:570;background:var(--surface);border:1px solid var(--rule);border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.25);padding:8px;min-width:250px;max-height:70vh;overflow:auto;font-size:12.5px}
.mt-h{font-family:var(--f-display);font-weight:600;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:2px 4px 6px}
.mt-sub{font-size:11px;color:var(--muted);padding:8px 4px 2px;border-top:1px solid var(--rule);margin-top:4px}
.mt-opt{all:unset;box-sizing:border-box;cursor:pointer;display:flex;gap:9px;align-items:center;width:100%;padding:6px 6px;border-radius:4px}
.mt-opt small{display:block;color:var(--muted);font-size:11px}.mt-opt:hover{background:var(--canvas)}.mt-opt[aria-pressed="true"]{background:var(--canvas);font-weight:600}
.mt-sw{display:inline-block;width:26px;height:18px;border-radius:3px;border:1px solid var(--rule);flex:none;background-size:cover}
.mt-sat,.mt-snap{background:linear-gradient(135deg,#3f4a36,#7a7d5c 45%,#5e6650)}.mt-hyb{background:linear-gradient(135deg,#3f4a36,#7a7d5c 45%,#5e6650);box-shadow:inset 0 0 0 2px rgba(255,255,255,.6)}
.mt-streets{background:linear-gradient(135deg,#f2efe9,#fff 50%,#e8e2d3)}.mt-topo{background:linear-gradient(135deg,#eef0e2,#d9e3c8 50%,#f4eedc)}.mt-plan{background:var(--land)}
.mt-row{display:flex;gap:8px;align-items:center;padding:5px 4px;cursor:pointer}.mt-row input{margin:0}
.mt-dot{display:inline-block;width:11px;height:11px;border-radius:50%;flex:none;box-sizing:border-box}
.mt-op{display:grid;grid-template-columns:1fr 110px;gap:8px;align-items:center;padding:8px 4px 2px;border-top:1px solid var(--rule);margin-top:6px;color:var(--muted)}
.mt-measuring{cursor:crosshair}.mt-measuring .leaflet-interactive{pointer-events:none!important}
.mt-hint{position:absolute;bottom:42px;left:50%;transform:translateX(-50%);z-index:560;background:var(--ink);color:var(--canvas);font-size:12px;padding:6px 12px;border-radius:4px;pointer-events:none}
.mt-tip{font-family:var(--f-mono);font-size:12.5px;font-weight:600}.mt-tip small{font-weight:400;color:var(--muted)}
.mt-clear{position:absolute;bottom:42px;right:12px;z-index:560}
@media (max-width:760px){.mt-bar{max-width:calc(100% - 24px)}.mt-search{width:auto;flex:1}.mt-tools{top:auto;bottom:12px;right:12px}.mt-tools [data-m]{display:none}}`;
})();
