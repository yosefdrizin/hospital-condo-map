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
  tools.innerHTML=`<button class="mt-btn" id="mt-layers" aria-expanded="false" title="Layers, styles and filters">Layers</button><button class="mt-btn" id="mt-table-btn" title="Data table">Table</button>
   <button class="mt-btn" data-m="line" title="Measure distance">Distance</button><button class="mt-btn" data-m="area" title="Measure area">Area</button><button class="mt-btn" data-m="circle" title="Measure a radius">Radius</button>`;
  map.getContainer().append(tools);
  [bar,tools].forEach(el=>{L.DomEvent.disableClickPropagation(el);L.DomEvent.disableScrollPropagation(el)});
  const old=$('.basebar');if(old)old.hidden=true;
  const saved=store.get('hcm-basemap',H.getMode()==='plan'?'plan':'sat');setBase(BASES.find(b=>b.k===saved)?saved:'sat');
  $('#mt-base').addEventListener('click',e=>toggleMenu('base',e.currentTarget));
  $('#mt-layers').addEventListener('click',e=>toggleMenu('layers',e.currentTarget));
  tools.querySelectorAll('[data-m]').forEach(b=>b.addEventListener('click',()=>measure(b.dataset.m,b)));
  wireSearch();
  // phase 2: layers that can be styled, filtered and tabled
  H.registerLayer=register;
  // filters decide what's in a layer (and in the worklist); "hide the points" under a heatmap or hex bins only makes the dots invisible
  const hidden=id=>{const st=stOf(id).style;return st.mode!=='points'&&st.hidePts};
  H.mtPass=(id,raw)=>{const def=BY[id];const f=def&&RAW.get(raw);if(!f)return true;if(id==='condos'&&hidden(id))return false;return passF(def,f)};
  H.mtStyle=(id,raw)=>{const def=BY[id];const f=def&&RAW.get(raw);if(!f)return null;if(hidden(id))return {r:0,op:0};return def._scale?def._scale(f):null};
  const OWN={H:'Hospital-owned',M:'Independent medical',N:'Independent other'};
  register({id:'condos',label:'Condo projects',color:'#86a35c',isOn:()=>true,apply:()=>H.refresh(),restyle:()=>H.restyle(),open:c=>H.selectCondo(H.D.condos.indexOf(c)),
    features:H.D.condos.map(c=>{const ll=decodeFirst(c.g);return {raw:c,lat:ll[0],lon:ll[1],props:{'Condo Project':H.title(c.p),'Address':c.a,'City':c.city,'Ownership':OWN[c.oc],
      'Structure':c.s,'Primary Use':c.u,'Suites':c.cu,'Medical Suites':c.mu,'Hospital-owned Suites':c.ho,'Independent Medical Suites':c.imu,'Indep. Medical Sold Last 3 Yrs':c.irec,
      'Building SF':c.sf,'Earliest Yr Built':c.y,'Distinct Owners':c.ow,'Largest Owner':c.lo,'DCAD Value':c.val,'Latest Deed':c.deed,'Nearest Hospital':c.near[0]&&c.near[0][0]}}})});
  // shared with map_data.js (uploads, drawing, views)
  H.unregisterLayer=id=>{const d=BY[id];if(!d)return;if(d._ov)map.removeLayer(d._ov);if(d._lab)map.removeLayer(d._lab);REG.splice(REG.indexOf(d),1);delete BY[id];delete ST[id];saveST();renderLegend();
    const t=$('#mt-table');if(t&&t.dataset.id===id)t.remove();const e=$('#mt-edit');if(e&&e.dataset.id===id)e.remove()};
  H.mt={openEditor,openTable,renderLegend,closeMenus,setBase,getBase:()=>base.k,refreshLayer:id=>BY[id]&&applyAll(BY[id],true)};
  window.dispatchEvent(new Event('mt-ready'));
  map.on('moveend',()=>REG.forEach(drawLabels));
  $('#mt-table-btn').addEventListener('click',()=>{if($('#mt-table')){$('#mt-table').remove();return}openTable((BY.cand||BY.condos).id)});
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
  const tag=d=>{const s=stOf(d.id);const bits=[];if(s.style.mode!=='points')bits.push(s.style.mode==='heat'?'heatmap':'hex bins');else if(s.style.color!=='default'||s.style.sizeField||+s.style.opacity!==1)bits.push('styled');if(s.filters.length)bits.push(`${s.filters.length} filter${s.filters.length>1?'s':''}`);if(s.label.field)bits.push('labels');return bits.length?`<small>${bits.join(' · ')}</small>`:''};
  return `<div class="mt-h">Style, filter and table</div>${REG.map(d=>`<div class="mt-sty"><span><i class="mt-dot" style="background:${d.color}"></i>${H.esc(d.label)}${tag(d)}</span><span><button class="mt-link" data-ed="${d.id}" data-t="style">Style</button><button class="mt-link" data-ed="${d.id}" data-t="filter">Filter</button><button class="mt-link" data-tb="${d.id}">Table</button></span></div>`).join('')}
   <div class="mt-h" style="margin-top:8px">Layers</div>
   ${deal.length?`<div class="mt-sub">Deal data</div>${deal.map(i=>{i.id=i.id||'mt-l-'+i.dataset.l;return row(i.id,chipLabel(i),getComputedStyle(i.nextElementSibling).backgroundColor)}).join('')}`:''}
   <div class="mt-sub">Condos and parcels</div>${row('f-oh','Hospital-owned condos','var(--u-hosp)')}${row('f-om','Independent medical condos','var(--green)')}${row('f-on','Independent other condos','var(--tan)')}${row('l-ctx','Parcels by use (zoom in)','var(--u-med)')}
   <div class="mt-sub">Reference</div><label class="mt-row"><input type="checkbox" id="mt-rings"${ringsOn?' checked':''}><i class="mt-dot" style="background:transparent;border:1.5px dashed var(--ink)"></i>1-mile hospital rings</label>${row('l-q','¼-mile rings','transparent')}${row('l-roads','Street lines (plan view)','var(--road-edge)')}
   ${opacityRow()}`}
function wireMenu(pop,kind){
  pop.querySelectorAll('[data-b]').forEach(b=>b.addEventListener('click',()=>{setBase(b.dataset.b);closeMenus()}));
  const op=pop.querySelector('#mt-op');op&&op.addEventListener('input',()=>{baseOpacity=+op.value;store.set('hcm-base-op',baseOpacity);if(tile)tile.setOpacity(baseOpacity);
    document.querySelectorAll('.leaflet-base-pane img').forEach(i=>i.style.opacity=baseOpacity)});
  pop.querySelectorAll('[data-mirror]').forEach(c=>c.addEventListener('change',()=>{const t=document.getElementById(c.dataset.mirror);if(t){t.checked=c.checked;t.dispatchEvent(new Event('change',{bubbles:true}))}
    setTimeout(()=>{REG.forEach(d=>{drawOverlay(d);drawLabels(d)});renderLegend()},50)}));
  pop.querySelectorAll('[data-ed]').forEach(b=>b.addEventListener('click',()=>openEditor(b.dataset.ed,b.dataset.t)));
  pop.querySelectorAll('[data-tb]').forEach(b=>b.addEventListener('click',()=>{closeMenus();openTable(b.dataset.tb)}));
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

// ---------- data layers: style, filter, labels, legend, table (Felt-style phase 2) ----------
// Any layer registers here: deal_layer.js hands over its six layers, and the public condo projects are registered in boot.
// Settings per layer are saved in this browser. The layer owner honors them through HCM.mtStyle / HCM.mtPass.
const REG=[],BY={},RAW=new WeakMap();
let ST=store.get('hcm-mt',{});
const PAL={cat:['#e11d48','#2563eb','#16a34a','#f59e0b','#9333ea','#0891b2','#db2777','#65a30d','#ea580c','#4f46e5','#0d9488'],
  seq:{Sunset:['#fde68a','#fbbf24','#f97316','#dc2626','#7f1d1d'],Ocean:['#cffafe','#67e8f9','#06b6d4','#0e7490','#164e63'],
       Greens:['#dcfce7','#86efac','#22c55e','#15803d','#14532d'],Viridis:['#fde725','#5ec962','#21918c','#3b528b','#440154'],Heat:['#fef9c3','#fde047','#fb923c','#ef4444','#7f1d1d']}};
const OTHER='#94a3b8';
const DEF_STYLE={mode:'points',color:'default',colorField:'',single:'#e11d48',palette:'Sunset',sizeField:'',sizeMin:3,sizeMax:16,opacity:1,
  heatField:'',hexSize:500,hexAgg:'count',hexField:'',hidePts:true};
function stOf(id){const s=ST[id]||(ST[id]={});s.style=Object.assign({},DEF_STYLE,s.style);s.filters=s.filters||[];s.label=s.label||{field:'',minZoom:15};return s}
function saveST(){store.set('hcm-mt',ST)}
const isNum=v=>typeof v==='number'&&isFinite(v);
function fields(def){if(def._fields)return def._fields;const keys=[];const seen=new Set();
  def.features.slice(0,400).forEach(f=>Object.keys(f.props).forEach(k=>{if(!seen.has(k)){seen.add(k);keys.push(k)}}));
  def._fields=keys.map(k=>{const vals=def.features.map(f=>f.props[k]).filter(v=>v!=null&&v!=='');const nums=vals.filter(isNum);
    if(vals.length&&nums.length/vals.length>=.7){const s=nums.slice().sort((a,b)=>a-b);return {key:k,type:'num',min:s[0],max:s[s.length-1],median:s[Math.floor(s.length/2)],n:vals.length}}
    const cnt=new Map();vals.forEach(v=>{const x=String(v);cnt.set(x,(cnt.get(x)||0)+1)});
    const top=[...cnt.entries()].sort((a,b)=>b[1]-a[1]);return {key:k,type:cnt.size<=40?'cat':'text',values:top.map(x=>x[0]),counts:Object.fromEntries(top),n:vals.length,distinct:cnt.size}});
  return def._fields}
const field=(def,k)=>fields(def).find(f=>f.key===k);
function passF(def,f){for(const r of stOf(def.id).filters){const v=f.props[r.field];
  if(r.type==='num'){if(!isNum(v))return false;if(r.min!=null&&r.min!==''&&v<+r.min)return false;if(r.max!=null&&r.max!==''&&v>+r.max)return false}
  else if(r.type==='cat'){if(r.values&&r.values.length&&!r.values.includes(v==null||v===''?'(blank)':String(v)))return false}
  else if(r.q&&!String(v??'').toLowerCase().includes(r.q.toLowerCase()))return false}return true}
function quantiles(vals,n){const s=vals.slice().sort((a,b)=>a-b);const out=[];for(let i=1;i<n;i++)out.push(s[Math.min(s.length-1,Math.floor(i*s.length/n))]);return [...new Set(out)]}
function buildScale(def){const st=stOf(def.id).style;def._legend=[];
  const parts=[];
  if(st.color==='single')parts.push(()=>({fill:st.single}));
  if(st.color==='cat'&&st.colorField){const fl=field(def,st.colorField),top=(fl&&fl.values||[]).slice(0,PAL.cat.length);const cm=Object.fromEntries(top.map((v,i)=>[v,PAL.cat[i]]));
    parts.push(f=>({fill:cm[String(f.props[st.colorField]??'')]||OTHER}));def._legend.push({title:st.colorField,items:top.map(v=>[cm[v],v]).concat(fl&&fl.values.length>top.length?[[OTHER,'Other']]:[])})}
  if(st.color==='num'&&st.colorField){const vals=def.features.map(f=>f.props[st.colorField]).filter(isNum),br=quantiles(vals,5),pal=PAL.seq[st.palette]||PAL.seq.Sunset;
    const cls=v=>{let i=0;while(i<br.length&&v>=br[i])i++;return i};
    parts.push(f=>{const v=f.props[st.colorField];return {fill:isNum(v)?pal[Math.round(cls(v)*(pal.length-1)/Math.max(1,br.length))]:OTHER}});
    const edges=[Math.min(...vals),...br,Math.max(...vals)];def._legend.push({title:st.colorField,items:edges.slice(0,-1).map((e,i)=>[pal[Math.round(i*(pal.length-1)/Math.max(1,br.length))],`${nf(e)} to ${nf(edges[i+1])}`])})}
  if(st.sizeField){const fl=field(def,st.sizeField);if(fl&&fl.type==='num'){
    // scale between the 5th and 95th percentile so one huge outlier doesn't shrink everything else
    const s=def.features.map(f=>f.props[st.sizeField]).filter(isNum).sort((a,b)=>a-b),p5=s[Math.floor(s.length*.05)],p95=s[Math.floor(s.length*.95)];
    const lo=Math.sqrt(Math.max(0,p5)),hi=Math.sqrt(Math.max(0,p95));
    parts.push(f=>{const v=f.props[st.sizeField];const t=isNum(v)?Math.min(1,Math.max(0,(Math.sqrt(Math.max(0,v))-lo)/((hi-lo)||1))):0;return {r:+st.sizeMin+(+st.sizeMax-st.sizeMin)*t}});
    def._legend.push({title:`Size: ${st.sizeField}`,items:[[null,`${nf(p5)} or less (small) to ${nf(p95)} or more (large)`]]})}}
  if(+st.opacity!==1)parts.push(()=>({op:+st.opacity}));
  def._scale=parts.length?f=>Object.assign({},...parts.map(p=>p(f))):null}
const nf=v=>isNum(v)?(Math.abs(v)>=1000?Math.round(v).toLocaleString('en-US'):+v.toFixed(2)+''):String(v);
function register(def){if(BY[def.id]){const i=REG.indexOf(BY[def.id]);REG.splice(i,1)}BY[def.id]=def;REG.push(def);def.features.forEach(f=>RAW.set(f.raw,f));def._fields=null;
  setTimeout(()=>applyAll(def,true),0)}
function applyAll(def,quiet){if(!quiet)saveST();buildScale(def);def.apply();def.restyle();drawOverlay(def);drawLabels(def);renderLegend();
  const ed=$('#mt-edit');if(ed&&ed.dataset.id===def.id){const c=$('#mt-count');if(c)c.textContent=countText(def)}
  if($('#mt-table')&&$('#mt-table').dataset.id===def.id)renderTable()}
function countText(def){const n=def.features.filter(f=>passF(def,f)).length;return `Showing ${n.toLocaleString('en-US')} of ${def.features.length.toLocaleString('en-US')}`}

// heatmap and hex bins
let heatLib=null;
function loadHeat(){return heatLib||(heatLib=new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js';s.onload=res;s.onerror=rej;document.head.append(s)}))}
async function drawOverlay(def){if(def._ov){map.removeLayer(def._ov);def._ov=null}const st=stOf(def.id).style;if(st.mode==='points'||!def.isOn())return;
  const feats=def.features.filter(f=>passF(def,f));
  if(st.mode==='heat'){await loadHeat();const fl=st.heatField&&field(def,st.heatField);const mx=fl&&fl.type==='num'?fl.max||1:1;
    def._ov=L.heatLayer(feats.map(f=>[f.lat,f.lon,fl?Math.max(0,(+f.props[st.heatField]||0)/mx):1]),{radius:28,blur:20,minOpacity:.25,maxZoom:15,max:fl?.6:1,
      gradient:{.2:'#2563eb',.4:'#06b6d4',.6:'#84cc16',.8:'#f59e0b',1:'#dc2626'}}).addTo(map);
    def._legend.push({title:`Heatmap${fl?': '+st.heatField:': density'}`,items:[[null,'Blue = fewer, red = more']]});renderLegend();return}
  if(st.mode==='hex'){const R=+st.hexSize/Math.sqrt(3),cells=new Map(),crs=map.options.crs,S3=Math.sqrt(3);
    feats.forEach(f=>{const p=crs.project(L.latLng(f.lat,f.lon));let q=(S3/3*p.x-p.y/3)/R,r=(2/3*p.y)/R,s=-q-r;let rq=Math.round(q),rr=Math.round(r),rs=Math.round(s);
      const dq=Math.abs(rq-q),dr=Math.abs(rr-r),ds=Math.abs(rs-s);if(dq>dr&&dq>ds)rq=-rr-rs;else if(dr>ds)rr=-rq-rs;
      const k=rq+','+rr;const c=cells.get(k)||{q:rq,r:rr,n:0,sum:0};c.n++;c.sum+=+f.props[st.hexField]||0;cells.set(k,c)});
    const val=c=>st.hexAgg==='sum'?c.sum:st.hexAgg==='avg'?c.sum/c.n:c.n;const vals=[...cells.values()].map(val),br=quantiles(vals,5),pal=PAL.seq[st.palette]||PAL.seq.Sunset;
    const cls=v=>{let i=0;while(i<br.length&&v>=br[i])i++;return Math.round(i*(pal.length-1)/Math.max(1,br.length))};
    if(!map.getPane('mthex')){map.createPane('mthex').style.zIndex=404}
    const rnd=L.svg({pane:'mthex'});def._ov=L.layerGroup();
    cells.forEach(c=>{const cx=R*S3*(c.q+c.r/2),cy=R*1.5*c.r;const pts=[0,1,2,3,4,5].map(i=>{const a=Math.PI/180*(60*i-30);return crs.unproject(L.point(cx+R*Math.cos(a),cy+R*Math.sin(a)))});
      const v=val(c);def._ov.addLayer(L.polygon(pts,{renderer:rnd,pane:'mthex',color:'#fff',weight:.6,fillColor:pal[cls(v)],fillOpacity:.68}).bindTooltip(`${nf(v)} ${st.hexAgg==='count'?'in this cell':(st.hexAgg==='sum'?'total ':'average ')+st.hexField}`,{className:'tip',sticky:true}))});
    def._ov.addTo(map);const edges=[Math.min(...vals),...br,Math.max(...vals)];
    def._legend.push({title:`Hex bins (${st.hexAgg==='count'?'count':st.hexAgg+' of '+st.hexField})`,items:edges.slice(0,-1).map((e,i)=>[pal[Math.round(i*(pal.length-1)/Math.max(1,br.length))],`${nf(e)} to ${nf(edges[i+1])}`])});renderLegend()}}

// labels
function drawLabels(def){if(def._lab){map.removeLayer(def._lab);def._lab=null}const lb=stOf(def.id).label;if(!lb.field||!def.isOn()||map.getZoom()<+lb.minZoom)return;
  const b=map.getBounds();def._lab=L.layerGroup();let n=0;
  for(const f of def.features){if(n>=250)break;if(!b.contains([f.lat,f.lon])||!passF(def,f))continue;const v=f.props[lb.field];if(v==null||v==='')continue;
    def._lab.addLayer(L.tooltip({permanent:true,direction:'top',offset:[0,-8],className:'mt-label',interactive:false}).setLatLng([f.lat,f.lon]).setContent(H.esc(nf(v))));n++}
  def._lab.addTo(map)}

// legend
function renderLegend(){let box=$('#mt-legend');const items=REG.filter(d=>d.isOn()&&d._legend&&d._legend.length);
  if(!items.length){box&&box.remove();return}
  if(!box){box=document.createElement('div');box.id='mt-legend';box.className='mt-legend';map.getContainer().append(box);L.DomEvent.disableClickPropagation(box);L.DomEvent.disableScrollPropagation(box)}
  box.innerHTML=items.map(d=>`<div class="mt-lg"><b>${H.esc(d.label)}</b>${d._legend.map(g=>`<div class="mt-lgt">${H.esc(g.title)}</div>${g.items.map(([c,t])=>`<div class="mt-lgi">${c?`<i class="mt-dot" style="background:${c}"></i>`:''}${H.esc(String(t))}</div>`).join('')}`).join('')}</div>`).join('')}

// editor panel: Style / Filter / Labels
function openEditor(id,tab){const def=BY[id];if(!def)return;closeMenus();let ed=$('#mt-edit');
  if(!ed){ed=document.createElement('div');ed.id='mt-edit';ed.className='mt-edit';map.getContainer().append(ed);L.DomEvent.disableClickPropagation(ed);L.DomEvent.disableScrollPropagation(ed)}
  ed.dataset.id=id;ed.dataset.tab=tab||ed.dataset.tab||'style';renderEditor()}
function opts(list,cur,blank){return (blank?`<option value="">${blank}</option>`:'')+list.map(f=>`<option value="${H.esc(f.key)}"${f.key===cur?' selected':''}>${H.esc(f.key)}</option>`).join('')}
function renderEditor(){const ed=$('#mt-edit');if(!ed)return;const def=BY[ed.dataset.id],tab=ed.dataset.tab,s=stOf(def.id),st=s.style,F=fields(def);
  const nums=F.filter(f=>f.type==='num'),cats=F.filter(f=>f.type==='cat');
  const seg=(name,val,list)=>`<div class="mt-seg">${list.map(([v,t])=>`<button data-set="${name}" data-v="${v}" aria-pressed="${val===v}">${t}</button>`).join('')}</div>`;
  let body='';
  if(tab==='style'){body=`<div class="mt-f"><span>Show as</span>${seg('mode',st.mode,[['points','Points'],['heat','Heatmap'],['hex','Hex bins']])}</div>`;
    if(st.mode==='points'){body+=`<div class="mt-f"><span>Color</span><select data-set="color"><option value="default"${st.color==='default'?' selected':''}>Default colors</option><option value="single"${st.color==='single'?' selected':''}>One color</option><option value="cat"${st.color==='cat'?' selected':''}>By category</option><option value="num"${st.color==='num'?' selected':''}>By number</option></select></div>`;
      if(st.color==='single')body+=`<div class="mt-f"><span>Pick color</span><input type="color" data-set="single" value="${st.single}"></div>`;
      if(st.color==='cat')body+=`<div class="mt-f"><span>Category field</span><select data-set="colorField">${opts(cats,st.colorField,'Choose a field')}</select></div>`;
      if(st.color==='num')body+=`<div class="mt-f"><span>Number field</span><select data-set="colorField">${opts(nums,st.colorField,'Choose a field')}</select></div><div class="mt-f"><span>Palette</span><select data-set="palette">${Object.keys(PAL.seq).map(p=>`<option${p===st.palette?' selected':''}>${p}</option>`).join('')}</select></div>`;
      if(def.id!=='condos')body+=`<div class="mt-f"><span>Size by</span><select data-set="sizeField">${opts(nums,st.sizeField,'Same size')}</select></div>${st.sizeField?`<div class="mt-f"><span>Smallest / largest</span><span><input type="number" data-set="sizeMin" value="${st.sizeMin}" min="1" max="30"> <input type="number" data-set="sizeMax" value="${st.sizeMax}" min="2" max="40"></span></div>`:''}`;
      body+=`<div class="mt-f"><span>Opacity</span><input type="range" data-set="opacity" min="0.1" max="1" step="0.05" value="${st.opacity}"></div>`}
    if(st.mode==='heat')body+=`<div class="mt-f"><span>Weight by</span><select data-set="heatField">${opts(nums,st.heatField,'Density only')}</select></div><label class="mt-row"><input type="checkbox" data-set="hidePts"${st.hidePts?' checked':''}>Hide the points</label>`;
    if(st.mode==='hex')body+=`<div class="mt-f"><span>Cell size</span><select data-set="hexSize">${[[250,'250 m (about 1/6 mi)'],[500,'500 m (about 1/3 mi)'],[1000,'1 km (about 0.6 mi)'],[2000,'2 km (about 1.2 mi)']].map(([v,t])=>`<option value="${v}"${+st.hexSize===v?' selected':''}>${t}</option>`).join('')}</select></div>
      <div class="mt-f"><span>Value</span><select data-set="hexAgg"><option value="count"${st.hexAgg==='count'?' selected':''}>Count</option><option value="sum"${st.hexAgg==='sum'?' selected':''}>Sum of a field</option><option value="avg"${st.hexAgg==='avg'?' selected':''}>Average of a field</option></select></div>
      ${st.hexAgg!=='count'?`<div class="mt-f"><span>Field</span><select data-set="hexField">${opts(nums,st.hexField,'Choose a field')}</select></div>`:''}
      <div class="mt-f"><span>Palette</span><select data-set="palette">${Object.keys(PAL.seq).map(p=>`<option${p===st.palette?' selected':''}>${p}</option>`).join('')}</select></div><label class="mt-row"><input type="checkbox" data-set="hidePts"${st.hidePts?' checked':''}>Hide the points</label>`;
    body+=`<button class="mt-link" data-act="reset-style">Reset style</button>`}
  if(tab==='filter'){body=`<p class="mt-count" id="mt-count">${countText(def)}</p>${s.filters.map((r,i)=>filterRow(def,r,i)).join('')}
    <div class="mt-f"><span>Add a filter</span><select id="mt-addf">${opts(F,'','Choose a field')}</select></div>${s.filters.length?'<button class="mt-link" data-act="clear-filters">Clear all filters</button>':''}`}
  if(tab==='labels'){body=`<div class="mt-f"><span>Label with</span><select data-lab="field">${opts(F,s.label.field,'No labels')}</select></div>
    <div class="mt-f"><span>Show when zoomed in to</span><select data-lab="minZoom">${[[12,'County'],[13,'Area'],[14,'Neighborhood'],[15,'Blocks'],[16,'Street']].map(([v,t])=>`<option value="${v}"${+s.label.minZoom===v?' selected':''}>${t}</option>`).join('')}</select></div><p class="mt-count">Up to 250 labels show at once, for what's on screen.</p>`}
  ed.innerHTML=`<div class="mt-eh"><b>${H.esc(def.label)}</b><button class="mt-x" data-act="close" aria-label="Close">×</button></div>
   <div class="mt-tabs">${[['style','Style'],['filter','Filter'],['labels','Labels']].map(([k,t])=>`<button data-tab="${k}" aria-pressed="${tab===k}">${t}</button>`).join('')}<button data-act="table">Table</button></div><div class="mt-eb">${body}</div>`;
  wireEditor(ed,def)}
function filterRow(def,r,i){const fl=field(def,r.field)||{};const x=`<button class="mt-x" data-rm="${i}" aria-label="Remove filter">×</button>`;
  if(r.type==='num')return `<div class="mt-fr"><div class="mt-frh">${H.esc(r.field)}${x}</div><span class="mt-mm"><input type="number" step="any" data-fi="${i}" data-k="min" placeholder="${nf(fl.min)}" value="${r.min??''}"> to <input type="number" step="any" data-fi="${i}" data-k="max" placeholder="${nf(fl.max)}" value="${r.max??''}"></span><small>Range ${nf(fl.min)} to ${nf(fl.max)}, median ${nf(fl.median)}</small></div>`;
  if(r.type==='cat'){const vals=(fl.values||[]).slice(0,30);return `<div class="mt-fr"><div class="mt-frh">${H.esc(r.field)}${x}</div><div class="mt-cats">${vals.map(v=>`<label class="mt-row"><input type="checkbox" data-fi="${i}" data-cv="${H.esc(v)}"${!r.values.length||r.values.includes(v)?' checked':''}>${H.esc(v)} <small>${fl.counts[v]}</small></label>`).join('')}</div></div>`}
  return `<div class="mt-fr"><div class="mt-frh">${H.esc(r.field)} contains${x}</div><input type="search" data-fi="${i}" data-k="q" value="${H.esc(r.q||'')}" placeholder="Type text"></div>`}
function wireEditor(ed,def){const s=stOf(def.id),st=s.style;
  ed.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{ed.dataset.tab=b.dataset.tab;renderEditor()}));
  ed.querySelectorAll('[data-act]').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.act;
    if(a==='close')ed.remove();if(a==='table')openTable(def.id);
    if(a==='reset-style'){s.style=Object.assign({},DEF_STYLE);applyAll(def);renderEditor()}
    if(a==='clear-filters'){s.filters=[];applyAll(def);renderEditor()}}));
  ed.querySelectorAll('button[data-set]').forEach(b=>b.addEventListener('click',()=>{st[b.dataset.set]=b.dataset.v;applyAll(def);renderEditor()}));
  ed.querySelectorAll('select[data-set],input[data-set]').forEach(el=>{const ev=el.type==='range'||el.type==='color'?'input':'change';el.addEventListener(ev,()=>{
    st[el.dataset.set]=el.type==='checkbox'?el.checked:el.value;applyAll(def);if(el.tagName==='SELECT'||el.type==='checkbox')renderEditor()})});
  ed.querySelectorAll('[data-lab]').forEach(el=>el.addEventListener('change',()=>{s.label[el.dataset.lab]=el.value;saveST();drawLabels(def)}));
  const add=ed.querySelector('#mt-addf');add&&add.addEventListener('change',()=>{const fl=field(def,add.value);if(!fl)return;
    s.filters.push(fl.type==='num'?{field:fl.key,type:'num',min:'',max:''}:fl.type==='cat'?{field:fl.key,type:'cat',values:[]}:{field:fl.key,type:'text',q:''});saveST();renderEditor()});
  ed.querySelectorAll('[data-rm]').forEach(b=>b.addEventListener('click',()=>{s.filters.splice(+b.dataset.rm,1);applyAll(def);renderEditor()}));
  ed.querySelectorAll('input[data-fi][data-k]').forEach(el=>el.addEventListener(el.type==='search'?'input':'change',()=>{s.filters[+el.dataset.fi][el.dataset.k]=el.value;applyAll(def)}));
  ed.querySelectorAll('input[data-cv]').forEach(el=>el.addEventListener('change',()=>{const r=s.filters[+el.dataset.fi];
    r.values=[...ed.querySelectorAll(`input[data-fi="${el.dataset.fi}"][data-cv]`)].filter(c=>c.checked).map(c=>c.dataset.cv);
    if(r.values.length===(field(def,r.field).values||[]).slice(0,30).length)r.values=[];applyAll(def)}))}

// data table (bottom drawer)
let TB={id:null,sort:null,dir:1,q:'',limit:200};
const DEFAULT_COLS={cand:['Rank','Score','Address','City','Use','Bldg SF','DCAD Value','Owner','Nearest Hospital','Why']};
function openTable(id){TB={id,sort:null,dir:1,q:'',limit:200};let t=$('#mt-table');
  if(!t){t=document.createElement('div');t.id='mt-table';t.className='mt-table';map.getContainer().append(t);L.DomEvent.disableClickPropagation(t);L.DomEvent.disableScrollPropagation(t)}
  t.dataset.id=id;renderTable()}
function cols(def){const s=stOf(def.id);if(s.cols&&s.cols.length)return s.cols;return DEFAULT_COLS[def.id]||fields(def).slice(0,10).map(f=>f.key)}
function renderTable(){const t=$('#mt-table');if(!t)return;const def=BY[t.dataset.id];if(!def){t.remove();return}const C=cols(def),q=TB.q.toLowerCase();
  let rows=def.features.filter(f=>passF(def,f)&&(!q||C.some(k=>String(f.props[k]??'').toLowerCase().includes(q))));
  if(TB.sort){const k=TB.sort;rows=rows.slice().sort((a,b)=>{const x=a.props[k],y=b.props[k];if(x==null||x==='')return 1;if(y==null||y==='')return -1;return (isNum(x)&&isNum(y)?x-y:String(x).localeCompare(String(y)))*TB.dir})}
  const stat=k=>{const fl=field(def,k);if(!fl)return '';return fl.type==='num'?`${nf(fl.min)} to ${nf(fl.max)}`:`${fl.distinct} values`};
  const cell=v=>v==null?'':isNum(v)?nf(v):H.esc(String(v));
  t.innerHTML=`<div class="mt-th"><select id="mt-tl">${REG.map(d=>`<option value="${d.id}"${d.id===def.id?' selected':''}>${H.esc(d.label)}</option>`).join('')}</select>
    <input type="search" id="mt-tq" placeholder="Search this table" value="${H.esc(TB.q)}"><span class="mt-count">${rows.length.toLocaleString('en-US')} rows${stOf(def.id).filters.length?' (filtered)':''}</span>
    <button class="mt-link" id="mt-tcols">Columns</button><button class="mt-link" id="mt-tfilt">Filter</button><button class="mt-link" id="mt-tcsv">Export CSV</button><button class="mt-x" id="mt-tx" aria-label="Close table">×</button></div>
   <div class="mt-tw"><table><thead><tr>${C.map(k=>`<th data-k="${H.esc(k)}">${H.esc(k)}${TB.sort===k?(TB.dir>0?' ↑':' ↓'):''}<small>${H.esc(stat(k))}</small></th>`).join('')}</tr></thead>
   <tbody>${rows.slice(0,TB.limit).map((f,i)=>`<tr data-r="${i}">${C.map(k=>`<td${isNum(f.props[k])?' class="n"':''}>${cell(f.props[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>
   ${rows.length>TB.limit?`<button class="mt-link" id="mt-tmore">Show ${Math.min(200,rows.length-TB.limit)} more</button>`:''}</div>`;
  $('#mt-tx').addEventListener('click',()=>t.remove());$('#mt-tl').addEventListener('change',e=>openTable(e.target.value));
  const tq=$('#mt-tq');tq.addEventListener('input',()=>{TB.q=tq.value;const p=tq.selectionStart;renderTable();const n=$('#mt-tq');n.focus();n.setSelectionRange(p,p)});
  t.querySelectorAll('th[data-k]').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.k;TB.dir=TB.sort===k?-TB.dir:1;TB.sort=k;renderTable()}));
  t.querySelectorAll('tr[data-r]').forEach(tr=>tr.addEventListener('click',()=>{const f=rows[+tr.dataset.r];def.open(f.raw)}));
  const more=$('#mt-tmore');more&&more.addEventListener('click',()=>{TB.limit+=200;renderTable()});
  $('#mt-tfilt').addEventListener('click',()=>openEditor(def.id,'filter'));
  $('#mt-tcsv').addEventListener('click',()=>{const qq=v=>`"${String(v??'').replace(/"/g,'""')}"`;const all=fields(def).map(f=>f.key);
    const csv=[all.map(qq).join(',')].concat(rows.map(f=>all.map(k=>qq(f.props[k])).join(','))).join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`${def.label.replace(/\W+/g,'-').toLowerCase()}-${new Date().toISOString().slice(0,10)}.csv`;a.click()});
  $('#mt-tcols').addEventListener('click',e=>{const old=$('.mt-pop.cols');if(old){old.remove();return}const pop=document.createElement('div');pop.className='mt-pop cols';
    const on=new Set(cols(def));pop.innerHTML=`<div class="mt-h">Columns</div>${fields(def).map(f=>`<label class="mt-row"><input type="checkbox" data-c="${H.esc(f.key)}"${on.has(f.key)?' checked':''}>${H.esc(f.key)}</label>`).join('')}<button class="mt-link" id="mt-cdef">Back to default</button>`;
    t.append(pop);pop.style.right='12px';pop.style.bottom='calc(100% + 6px)';L.DomEvent.disableClickPropagation(pop);
    pop.querySelectorAll('[data-c]').forEach(c=>c.addEventListener('change',()=>{stOf(def.id).cols=[...pop.querySelectorAll('[data-c]')].filter(x=>x.checked).map(x=>x.dataset.c);saveST();renderTable()}));
    pop.querySelector('#mt-cdef').addEventListener('click',()=>{delete stOf(def.id).cols;saveST();renderTable()})})}

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
.mt-sty{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 4px;border-bottom:1px solid var(--rule)}
.mt-sty>span:first-child{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.mt-sty small{color:var(--muted);font-size:10.5px}
.mt-link{all:unset;cursor:pointer;font-size:12px;color:var(--ink);text-decoration:underline;text-underline-offset:2px;margin-left:8px}.mt-link:hover{color:var(--focus)}
.mt-x{all:unset;cursor:pointer;font-size:18px;line-height:1;color:var(--muted);padding:0 4px}.mt-x:hover{color:var(--ink)}
.mt-edit{position:absolute;top:56px;right:12px;z-index:575;width:320px;max-width:calc(100% - 24px);max-height:calc(100% - 120px);overflow:auto;background:var(--surface);border:1px solid var(--rule);border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:12.5px}
.mt-eh{display:flex;justify-content:space-between;align-items:center;padding:10px 12px 6px}.mt-eh b{font-family:var(--f-display);font-size:14px}
.mt-tabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--rule)}
.mt-tabs button{all:unset;cursor:pointer;padding:6px 10px;font-size:12.5px;color:var(--muted);border-bottom:2px solid transparent}
.mt-tabs button[aria-pressed="true"]{color:var(--ink);border-bottom-color:var(--ink);font-weight:600}.mt-tabs [data-act="table"]{margin-left:auto}
.mt-eb{padding:10px 12px 12px;display:grid;gap:9px}
.mt-f{display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:center;color:var(--muted)}
.mt-f select,.mt-f input[type=number],.mt-fr input,.mt-th select,.mt-th input{font:inherit;font-size:12.5px;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:3px;padding:4px 6px;min-width:0}
.mt-f select{width:100%}.mt-f input[type=number]{width:56px}.mt-f input[type=color]{width:46px;height:26px;padding:0;border:1px solid var(--rule);background:none}
.mt-seg{display:flex;border:1px solid var(--rule);border-radius:4px;overflow:hidden}
.mt-seg button{all:unset;cursor:pointer;flex:1;text-align:center;padding:5px 4px;font-size:12px;color:var(--muted)}.mt-seg button[aria-pressed="true"]{background:var(--ink);color:var(--canvas)}
.mt-fr{border:1px solid var(--rule);border-radius:4px;padding:7px 8px;display:grid;gap:5px}.mt-fr small{color:var(--muted);font-size:11px}
.mt-frh{display:flex;justify-content:space-between;align-items:center;font-weight:600}
.mt-mm{display:flex;align-items:center;gap:6px;color:var(--muted)}.mt-mm input{width:100%}
.mt-cats{max-height:180px;overflow:auto}.mt-cats .mt-row{padding:2px 0}.mt-cats small{color:var(--muted);margin-left:auto}
.mt-count{margin:0;color:var(--muted);font-size:12px}
.mt-legend{position:absolute;right:12px;bottom:28px;z-index:555;background:var(--surface);border:1px solid var(--rule);border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.2);padding:8px 10px;font-size:11.5px;max-width:260px;max-height:45%;overflow:auto}
.mt-lg+.mt-lg{border-top:1px solid var(--rule);margin-top:6px;padding-top:6px}.mt-lg b{font-family:var(--f-display);font-size:12px}
.mt-lgt{color:var(--muted);margin:4px 0 2px}.mt-lgi{display:flex;align-items:center;gap:6px;padding:1px 0}
.mt-label{background:rgba(17,17,17,.78);color:#fff;border:0;box-shadow:none;font-size:11px;padding:1px 5px;border-radius:3px;white-space:nowrap}.mt-label:before{display:none}
.mt-table{position:absolute;left:0;right:0;bottom:0;z-index:580;height:42%;background:var(--surface);border-top:1px solid var(--ink);display:flex;flex-direction:column;font-size:12px}
.mt-th{display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--rule);flex-wrap:wrap}.mt-th input[type=search]{width:200px}.mt-th .mt-x{margin-left:auto}
.mt-tw{overflow:auto;flex:1}.mt-tw table{border-collapse:collapse;width:max-content;min-width:100%}
.mt-tw th{position:sticky;top:0;background:var(--surface);text-align:left;font-size:11px;font-weight:600;color:var(--ink);padding:6px 10px;border-bottom:1px solid var(--rule);cursor:pointer;white-space:nowrap;vertical-align:bottom}
.mt-tw th small{display:block;font-weight:400;color:var(--muted)}
.mt-tw td{padding:5px 10px;border-bottom:1px solid var(--rule);max-width:340px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mt-tw td.n{text-align:right;font-family:var(--f-mono)}
.mt-tw tbody tr{cursor:pointer}.mt-tw tbody tr:hover td{background:var(--canvas)}
@media (max-width:760px){.mt-bar{max-width:calc(100% - 24px)}.mt-search{width:auto;flex:1}.mt-tools{top:auto;bottom:12px;right:12px}.mt-tools [data-m]{display:none}}`;
})();
