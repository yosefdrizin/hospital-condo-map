// Deal layers. This file holds no data: everything is in deal-data.bin, encrypted by pipeline/07_targets.py.
// Without the key the page stays the plain public map. The key arrives once as #key=... and is kept in this browser only.
(function(){
const $=s=>document.querySelector(s);
const LAYERS=[
 {k:'cand',label:'Conversion candidates',color:'#ff7a1a',on:true,name:f=>f['Property Name']||f['Address'],sub:f=>[f['Address'],f['City'],f['Use']].filter(Boolean).join(' · ')},
 {k:'buys',label:'SBA suite purchases',color:'#e879f9',on:true,name:f=>f['Borrower'],sub:f=>`${f['Borrower Address']} · est. $${f['Est. $/SF']}/SF, loan-based estimate`},
 {k:'condo',label:'Condo sale comps',color:'#2dd4bf',name:f=>f['Address'],sub:f=>[f['City'],f['Segment'],f['Sale Date']].filter(Boolean).join(' · ')},
 {k:'bldg',label:'Building sale comps',color:'#60a5fa',name:f=>f['Address'],sub:f=>[f['City'],f['Segment'],f['Sale Date']].filter(Boolean).join(' · ')},
 {k:'loans',label:'SBA loans',color:'#fde047',name:f=>f['Borrower'],sub:f=>`${f['Borrower Address']}, ${f['City']} · ${f['Loan Date']}`},
 {k:'review',label:'Other CoStar properties',color:'#cbd5e1',name:f=>f['CoStar Name']||f['Address'],sub:f=>f['Status vs DCAD']}];
const NOTE={
 cand:'DCAD 2026 roll, NPI Registry, CoStar 11/3/2026. A list to research, not a ranking.',
 buys:'SBA loan data as of 9/30/2026 matched to DCAD deeds. Likely purchases, not confirmed. Price is estimated from the loan and can run high.',
 condo:'CoStar sale comp, exported 11/3/2026. Most Texas sales have no disclosed price.',
 bldg:'CoStar sale comp, exported 11/3/2026. Building comps cover only the last 12 months.',
 loans:'SBA loan data as of 9/30/2026. A long term usually means real estate, but the data has no loan purpose. The address is the borrower\'s.',
 review:'CoStar property, 11/3/2026, that is not a candidate. Status explains why.'};
const SIZE={all:[0,1e12],a:[2500,25000],b:[25000,75000],c:[75000,150000],d:[150000,1e12]};
let H,P,sel=null,filt={size:'all',sale:false,med:false,prov:false};

const STORE='hcm-key',store={get(){try{return localStorage.getItem(STORE)}catch(e){return null}},set(v){try{localStorage.setItem(STORE,v)}catch(e){}},del(){try{localStorage.removeItem(STORE)}catch(e){}}};
async function unlock(key){
  const buf=await (await fetch('deal-data.bin',{cache:'no-cache'})).arrayBuffer();
  const raw=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),'PBKDF2',false,['deriveKey']);
  const aes=await crypto.subtle.deriveKey({name:'PBKDF2',salt:buf.slice(0,16),iterations:310000,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},false,['decrypt']);
  const zip=await crypto.subtle.decrypt({name:'AES-GCM',iv:buf.slice(16,28)},aes,buf.slice(28));
  return JSON.parse(await new Response(new Blob([zip]).stream().pipeThrough(new DecompressionStream('gzip'))).text())}
function offerUnlock(msg){const a=document.createElement('button');a.className='back';a.style.marginTop='8px';a.textContent=msg||'Unlock';
  a.addEventListener('click',()=>{const k=prompt('Map key');if(k){store.set(k.trim());location.reload()}});$('.src').append(document.createElement('br'),a)}
function boot(){H=window.HCM;
  const m=location.hash.match(/key=([\w-]+)/);if(m){store.set(m[1]);history.replaceState(null,'',location.pathname+location.search)}
  const key=store.get();if(!key)return offerUnlock();
  unlock(key).then(start).catch(err=>{console.error(err);store.del();offerUnlock('Key did not work. Try again')})}
if(window.HCM)boot();else window.addEventListener('hcm-ready',boot,{once:true});

function start(data){P=data;
  const {map}=H;
  map.createPane('priv').style.zIndex=425;
  const css=document.createElement('style');css.textContent=`
.priv-box{border:1px solid #ff7a1a;border-radius:3px;padding:8px 10px;font-size:12px}
.priv-box b{font-family:var(--f-display);letter-spacing:.06em;text-transform:uppercase;font-size:11px}
.priv-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;color:var(--muted)}
.priv-row select{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:3px;padding:3px 4px}
.facts div.full{grid-column:1/-1}.priv-note{font-size:12px;color:var(--muted);margin:8px 0 0}
.more summary{cursor:pointer;font-size:12.5px;color:var(--muted);padding:2px 0}.more[open] summary{margin-bottom:8px}
.priv-tbl{margin-bottom:22px}.priv-tbl h3{margin:14px 0 2px;font-family:var(--f-display);font-size:15px}`;
  document.head.append(css);
  const box=document.createElement('div');box.className='controls';
  box.innerHTML=`<div class="priv-box"><b>Deal data</b> · built ${H.esc(P.built)}, CoStar ${H.esc(P.costarAsOf)} · <button class="back" id="p-lock" style="font-size:12px">Lock</button></div>
   <div class="ctl-row" role="group" aria-label="Deal layers">${LAYERS.filter(l=>P.layers[l.k]).map(l=>`<label class="chip"><input type="checkbox" data-l="${l.k}"${l.on?' checked':''}><i class="sw" style="background:${l.color}"></i>${H.esc(l.label)} (${P.layers[l.k].length.toLocaleString('en-US')})</label>`).join('')}</div>
   <div class="priv-row"><span>Candidates:</span><select id="p-size" aria-label="Candidate size"><option value="all">All sizes</option><option value="a">2,500 to 25,000 SF</option><option value="b">25,000 to 75,000 SF</option><option value="c">75,000 to 150,000 SF</option><option value="d">Over 150,000 SF</option></select>
   <label class="chip"><input type="checkbox" id="p-sale">For sale</label><label class="chip"><input type="checkbox" id="p-med">Medical office</label><label class="chip"><input type="checkbox" id="p-prov">Has practices</label></div>
   <button class="btn-num" id="p-sheet">Deal tables<small>Rings and sale comps →</small></button>`;
  // deal layers first; condo display options fold away under one line
  const pub=$('.controls'),more=document.createElement('details');more.className='more';more.innerHTML='<summary>Condo and map display options</summary>';
  pub.before(box,more);more.append(pub);
  $('#p-lock').addEventListener('click',()=>{store.del();location.reload()});
  LAYERS.forEach(l=>{const rows=P.layers[l.k];if(!rows)return;
    l.group=L.layerGroup();
    l.marks=rows.map(it=>{const r=l.k==='cand'?Math.max(3.5,Math.min(11,2.5+Math.sqrt((it.f['Bldg SF']||0)/1500))):5;
      const m=L.circleMarker([it.lat,it.lon],{pane:'priv',radius:r,color:'#fff',weight:1,fillColor:l.color,fillOpacity:.92});
      m._it=it;m._r=r;m.bindTooltip(()=>`<b>${H.esc(l.name(it.f))}</b><br>${H.esc(l.sub(it.f))}`,{className:'tip',direction:'top',offset:[0,-6]});
      m.on('click',ev=>{L.DomEvent.stop(ev);show(l,it)});return m});
    if(l.k!=='cand')l.marks.forEach(m=>l.group.addLayer(m));
    if(l.on)l.group.addTo(map)});
  applyFilter();sizeDots();map.on('zoomend',sizeDots);
  box.querySelectorAll('[data-l]').forEach(c=>c.addEventListener('change',()=>{const l=LAYERS.find(x=>x.k===c.dataset.l);c.checked?l.group.addTo(map):map.removeLayer(l.group)}));
  $('#p-size').addEventListener('change',e=>{filt.size=e.target.value;applyFilter()});
  [['p-sale','sale'],['p-med','med'],['p-prov','prov']].forEach(([id,k])=>$('#'+id).addEventListener('change',e=>{filt[k]=e.target.checked;applyFilter()}));
  $('#p-sheet').addEventListener('click',openSheet);
  new MutationObserver(addRing).observe($('#view'),{childList:true});addRing();
}

// Small when zoomed out so the dots don't hide the rings
function sizeDots(){const z=H.map.getZoom(),s=z<12?.4:z<13.5?.65:1;LAYERS.forEach(l=>(l.marks||[]).forEach(m=>{m.setRadius(Math.max(1.8,m._r*s));m.setStyle({weight:z<12?.5:1})}))}
function passes(it){const f=it.f,[lo,hi]=SIZE[filt.size];
  return f['Bldg SF']>=lo&&f['Bldg SF']<hi&&(!filt.sale||f['CoStar For Sale']==='Y')&&(!filt.med||it.code==='M')&&(!filt.prov||f['Practice Locations in Bldg']>0)}
function applyFilter(){const l=LAYERS[0];l.group.clearLayers();l.marks.filter(m=>passes(m._it)).forEach(m=>l.group.addLayer(m));addRing(true)}

function inRing(l,it,h){return l.k==='cand'?it.rings.includes(h.n):H.map.distance([it.lat,it.lon],[h.lat,h.lon])<=H.MI}
function addRing(force){const {state,D}=H;const old=document.querySelector('.priv-ring');
  if(state.view!=='hosp'||!P)return;if(old){if(force!==true)return;old.remove()}
  const facts=document.querySelector('#view .facts');if(!facts)return;const h=D.hospitals[state.hosp];
  const cands=P.layers.cand.filter(it=>inRing(LAYERS[0],it,h));
  const cnt=k=>{const l=LAYERS.find(x=>x.k===k);return P.layers[k]?P.layers[k].filter(it=>inRing(l,it,h)).length:0};
  const sf=cands.reduce((a,it)=>a+(it.f['Bldg SF']||0),0);
  const row=(a,b)=>`<div><dt>${a}</dt><dd>${H.fmt(b)==='–'?'0':H.fmt(b)}</dd></div>`;
  const dl=document.createElement('dl');dl.className='facts priv-ring';dl.style.marginTop='14px';
  dl.innerHTML=`<h5>Deal data · this ring</h5><p class="fnote">Counts inside this 1-mile ring. Sales and loans are placed by map pin. Filters above don't change these.</p>
   ${row('Candidate buildings',cands.length)}${row('Candidate SF',sf)}${row('Candidates, medical office',cands.filter(i=>i.code==='M').length)}${row('Candidates for sale (CoStar)',cands.filter(i=>i.f['CoStar For Sale']==='Y').length)}
   ${row('Candidates with practices',cands.filter(i=>i.f['Practice Locations in Bldg']>0).length)}${row('Condo sale comps',cnt('condo'))}${row('Building sale comps',cnt('bldg'))}${row('SBA suite purchases',cnt('buys'))}${row('SBA loans',cnt('loans'))}`;
  facts.after(dl)}

function show(l,it){const {state,esc,map,selectHosp,renderOverview}=H;const f=it.f,from=state.hosp;
  H.clearSel();if(sel){map.removeLayer(sel);sel=null}
  if(it.g){sel=L.polygon(it.g.map(H.decode),{pane:'priv',color:'#ff7a1a',weight:3,fill:false,interactive:false}).addTo(map)}
  state.view='priv';
  const fmtv=(k,v)=>{if(typeof v!=='number')return String(v);return /\$|Price|Value|Loan|Cost/.test(k)&&!/Rent/.test(k)?'$'+Math.round(v).toLocaleString('en-US'):/Yr|Year/.test(k)?String(v):v.toLocaleString('en-US')};
  const cell=(k,v)=>{const s=fmtv(k,v);return `<div${s.length>22?' class="full"':''}><dt>${esc(k)}</dt><dd class="txt">${esc(s)}</dd></div>`};
  const has=([k,v])=>v!==null&&v!==''&&v!==undefined;
  const base=Object.entries(f).filter(([k])=>!k.startsWith('CoStar ')||l.k==='review').filter(has);
  const cs=l.k==='review'?[]:Object.entries(f).filter(([k])=>k.startsWith('CoStar ')).filter(has);
  $('#view').innerHTML=`<button class="back" id="bk">← Back</button><div style="margin-top:10px"><div class="eyebrow">${esc(l.label)}</div><h2>${esc(l.name(f))}</h2><p class="sub">${esc(l.sub(f))}</p></div>
   <p class="note" style="margin-top:10px">${esc(NOTE[l.k])}</p>
   <dl class="facts" style="margin-top:14px">${base.map(([k,v])=>cell(k,v)).join('')}${cs.length?`<h5>CoStar</h5>${cs.map(([k,v])=>cell(k,v)).join('')}`:''}</dl>`;
  $('#bk').addEventListener('click',()=>{if(sel){map.removeLayer(sel);sel=null}from!=null?selectHosp(from,true):renderOverview()});
  $('#view').scrollIntoView({block:'nearest'})}

function openSheet(){const {esc,fmt}=H;const s=$('#sheet');
  const num=(h,v)=>v==null?'':typeof v==='number'?(/\$/.test(h)?'$':'')+Number(v).toLocaleString('en-US'):esc(v);
  $('#sheetIn').innerHTML=`<div class="sheet-head"><div><div class="eyebrow">Unlocked with your key</div><h2 id="sheetTitle">Deal tables</h2><p class="sub">Most Texas sales have no disclosed price, so read each median with its count.</p></div><button class="x" id="closeSheet">Close</button></div>
   ${P.sheets.map(t=>`<div class="priv-tbl"><h3>${esc(t.title)}</h3><p class="sub">${esc(t.note)}</p><div class="tbl-wrap"><table class="ntbl"><thead><tr>${t.head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r=>`<tr>${r.map((v,i)=>`<td${typeof v==='number'?' class="n"':''}>${num(t.head[i],v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`).join('')}`;
  s.hidden=false;$('#closeSheet').addEventListener('click',()=>{s.hidden=true})}
})();
