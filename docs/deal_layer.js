// Deal layers. This file holds no data: everything is in deal-data.bin, encrypted by pipeline/07_targets.py.
// Without the key the page stays the plain public map. The key arrives once as #key=... and is kept in this browser only.
// Flow: the ranked list is the worklist; a building opens as one card (score, why, status + notes, facts, owner, nearby evidence).
(function(){
const $=s=>document.querySelector(s);
const LAYERS=[
 {k:'cand',label:'Buildings to convert',color:'#ff7a1a',on:true,name:f=>f['Address'],sub:f=>`Score ${f['Score']} · ${f['Use']} · ${num(f['Bldg SF'])} SF`},
 {k:'buys',label:'SBA suite purchases',color:'#e879f9',on:true,name:f=>f['Borrower'],sub:f=>`${f['Borrower Address']} · est. $${f['Est. $/SF']}/SF`},
 {k:'condo',label:'Condo sales',color:'#2dd4bf',name:f=>f['Address'].replace(' (Condo)',''),sub:f=>compSub(f)},
 {k:'bldg',label:'Building sales',color:'#60a5fa',name:f=>f['Address'],sub:f=>compSub(f)},
 {k:'loans',label:'SBA practice loans',color:'#fde047',name:f=>f['Borrower'],sub:f=>`${f['City']} · ${f['Loan Date']} · ${money(f['Est. Project Cost'])} est. project`},
 {k:'review',label:'Other CoStar buildings',color:'#cbd5e1',name:f=>f['CoStar Name']||f['Address'],sub:f=>f['Status vs DCAD']}];
const NOTE={
 cand:'Sources: DCAD 2026 roll, CMS NPI Registry (11/2/2026), CoStar (11/3/2026), SBA (9/30/2026). The score is a research order, not a valuation.',
 buys:'SBA loan data as of 9/30/2026 matched to a DCAD deed. A likely purchase, not confirmed. The price is estimated from the loan and can run high.',
 condo:'CoStar sale comp, exported 11/3/2026. Most Texas sales have no disclosed price.',
 bldg:'CoStar sale comp, exported 11/3/2026. Building comps cover only the last 12 months.',
 loans:'SBA loan data as of 9/30/2026. A long term usually means real estate, but the data has no loan purpose. The address is the borrower\'s.',
 review:'CoStar property (11/3/2026) that is not on the candidate list. The status says why.'};
// key facts per layer for the card; everything else sits under "All details"
const KEY={buys:['Industry','Loan Date','DCAD Deed Date','Est. Price','Suite SF','Est. $/SF','DCAD Owner','Match'],
 condo:['Sale Date','Sale Status','Sale Type','SF','Sale Price','Price / SF','Asking Price','Asking / SF','Secondary Type','Yr Built','Buyer (True)','Seller (True)','Sale Condition','Price Treatment'],
 bldg:['Sale Date','Sale Status','Sale Type','SF','Sale Price','Price / SF','Asking Price','Asking / SF','Secondary Type','Yr Built','Buyer (True)','Seller (True)','Sale Condition','Price Treatment'],
 loans:['Industry','Loan Date','SBA or 7(a) Loan','504 Bank Loan','Est. Project Cost','Term (mo)','Lender','Status'],
 review:['Status vs DCAD','CoStar Type','CoStar Secondary Type','CoStar RBA','DCAD Bldg Class','CoStar True Owner','CoStar Condo']};
const SIZE={all:[0,1e12],a:[2500,10000],b:[10000,25000],c:[25000,75000],d:[75000,1e12]};
const TCOL=['#94a3b8','#e11d48','#ff7a1a','#fbbf24'];          // over budget, top tier, second tier, in budget
const STATUS=[['','No status',''],['short','Shortlist','#22c55e'],['contact','Contacted','#38bdf8'],['talk','In talks','#a855f7'],['pass','Pass','#64748b']];
const SCOL=Object.fromEntries(STATUS.map(s=>[s[0],s[2]]));
const tierColor=it=>TCOL[it._t||0];
let H,P,R,rPriv,rCtx,sel=null,ctx=null,shown=30,list=[],trail=[],cur=null;
let filt={size:'all',sale:false,med:false,prov:false,over:false,status:'active'};
const num=v=>v==null||v===''?'':Number(v).toLocaleString('en-US');
const money=v=>v==null||v===''?'':'$'+Math.round(v).toLocaleString('en-US');
function compSub(f){const p=f['Price / SF']?`$${num(Math.round(f['Price / SF']))}/SF sold`:f['Asking / SF']?`$${num(f['Asking / SF'])}/SF asking`:'no price';return [f['City'],f['Sale Date'],p].filter(Boolean).join(' · ')}

// ---------- your status and notes (this browser only) ----------
const NKEY='hcm-notes';let NOTES={};
function loadN(){try{NOTES=JSON.parse(localStorage.getItem(NKEY)||'{}')}catch(e){NOTES={}}}
function saveN(){try{localStorage.setItem(NKEY,JSON.stringify(NOTES))}catch(e){}}
const pid=it=>it.f['GIS Parcel ID'];
const stat=it=>(NOTES[pid(it)]||{}).s||'';
function setNote(it,patch){const k=pid(it);NOTES[k]=Object.assign({},NOTES[k],patch,{t:new Date().toISOString().slice(0,10)});
  if(!NOTES[k].s&&!NOTES[k].n)delete NOTES[k];saveN();styleCand(it)}

// ---------- ranking you can change ----------
// Same math as rank_parts() in pipeline/07_targets.py; P.rank holds the defaults, R the owner's current settings.
const LBL={
 parts:['How much each part counts',{own:'Owner likely to sell',dem:'Buyer demand nearby',easy:'Easy to convert'}],
 own:['Owner likely to sell',{sale:'Listed for sale (CoStar)',hold:'Years owned',away:'Owner lives out of town',person:'Owner is a person, trust or estate (not a company)',vac:'Vacancy (CoStar)',old:'Older building'}],
 dem:['Buyer demand nearby',{prac:'Practices within ½ mile',sba:'SBA practice real estate loans within 1 mile',comp:'Few competing medical condo suites within 1 mile'}],
 easy:['Easy to convert',{size:'Size fits',use:'Building use',park:'Parking (CoStar)',stor:'Low-rise',cond:'DCAD condition'}],
 opts:['Thresholds',{budget:'Budget: max DCAD value ($)',holdFull:'Years owned for full credit',awayLocal:'Credit if owner is in Texas but outside the Dallas area (0 to 100)',oldBefore:'Older building means built before (year)',sizeBest:'Size: full credit up to (SF)',sizeOk:'Size: partial credit up to (SF)',parkTarget:'Parking: full credit at (spaces per 1,000 SF)',maxStories:'Low-rise: full credit up to (stories)',top1:'Top tier: how many buildings',top2:'Second tier: how many buildings'}],
 useVal:['Building use, credit 0 to 100',null],condVal:['DCAD condition, credit 0 to 100',null]};
const RKEY='hcm-rank';
function loadR(){let saved={};try{saved=JSON.parse(localStorage.getItem(RKEY)||'{}')}catch(e){}
  R=JSON.parse(JSON.stringify(P.rank));Object.keys(R).forEach(g=>Object.keys(R[g]).forEach(k=>{const v=saved[g]&&saved[g][k];if(typeof v==='number'&&isFinite(v))R[g][k]=v}))}
function saveR(){try{localStorage.setItem(RKEY,JSON.stringify(R))}catch(e){}}
function norm(g){const t=Object.values(R[g]).reduce((a,b)=>a+Math.max(0,b),0)||1;const o={};Object.entries(R[g]).forEach(([k,v])=>o[k]=Math.max(0,v)/t);return o}
function score(s){const o=R.opts,wo=norm('own'),wd=norm('dem'),we=norm('easy'),p=norm('parts');
  const away=s.away===2?1:s.away===1?o.awayLocal/100:0;
  const own=wo.sale*s.sale+wo.hold*Math.min(1,Math.max(0,s.yrs/(o.holdFull||1)))+wo.away*away+wo.person*s.person+wo.vac*(s.vac??0)+wo.old*(s.yr>0&&s.yr<o.oldBefore?1:0);
  const dem=wd.prac*s.pp+wd.sba*s.ps+wd.comp*(1-s.pc);
  const size=s.sf<=o.sizeBest?1:s.sf<=o.sizeOk?.6:.2;
  const use=(R.useVal[s.use]??R.useVal.Other)/100;
  const pk=s.park==null?.5:s.park>=o.parkTarget?1:s.park>=o.parkTarget-1?.5:0;
  const st=!(s.st>0)?.6:s.st<=o.maxStories?1:s.st<=o.maxStories+1?.5:.2;
  const easy=we.size*size+we.use*use+we.park*pk+we.stor*st+we.cond*(R.condVal[s.cond]??60)/100;
  return {own,dem,easy,total:Math.round(100*(p.own*own+p.dem*dem+p.easy*easy))}}
function rescore(){const C=P.layers.cand,o=R.opts;
  C.forEach(it=>{const r=score(it.s);it._sc=r.total;it._p=r;it.f['Score']=r.total;it.f['Owner Likely to Sell (0-100)']=Math.round(100*r.own);
    it.f['Buyer Demand Nearby (0-100)']=Math.round(100*r.dem);it.f['Easy to Convert (0-100)']=Math.round(100*r.easy)});
  const inb=C.filter(it=>it.s.val<=o.budget).sort((a,b)=>b._sc-a._sc);
  C.forEach(it=>{it.f['Rank']=null;it._t=0;it.f['Tier']='Over budget'});
  inb.forEach((it,i)=>{const n=i+1;it.f['Rank']=n;it._t=n<=o.top1?1:n<=o.top2?2:3;it.f['Tier']=n<=o.top1?`Top ${o.top1}`:n<=o.top2?`Top ${o.top2}`:'In budget'});
  C.forEach(styleCand);
  const lg=$('#p-legend');if(lg)lg.innerHTML=[[1,`Top ${o.top1}`],[2,`Top ${o.top2}`],[3,'Rest in budget'],[0,`Over $${(o.budget/1e6).toLocaleString('en-US')}M`]].map(([t,l])=>`<span><i class="dot" style="background:${TCOL[t]}"></i>${l}</span>`).join('')+
    STATUS.slice(1,4).map(s=>`<span><i class="dot" style="background:transparent;border:2px solid ${s[2]}"></i>${s[1]}</span>`).join('')}
let rT=null;function rerank(){clearTimeout(rT);rT=setTimeout(()=>{saveR();rescore();applyFilter();pcts()},150)}
function pcts(){['parts','own','dem','easy'].forEach(g=>{const w=norm(g);Object.keys(w).forEach(k=>{const e=document.querySelector(`[data-pct="${g}.${k}"]`);if(e)e.textContent=Math.round(100*w[k])+'%'})})}
function settingsHTML(){const {esc}=H;const inp=(g,k,label,pct)=>`<label class="rk"><span>${esc(label)}</span><input type="number" inputmode="decimal" step="any" data-g="${g}" data-k="${esc(k)}" value="${R[g][k]}">${pct?`<em data-pct="${g}.${esc(k)}"></em>`:'<em></em>'}</label>`;
  return `<details class="more" id="p-rank"><summary>Ranking settings</summary><p class="priv-note" style="margin:0 0 6px">Change any number and the ranking updates. Weights are relative: each group is scaled to 100% (shown on the right). Saved in this browser.</p>
   ${['parts','own','dem','easy','opts','useVal','condVal'].map(g=>`<div class="rk-g"><b>${esc(LBL[g][0])}</b>${Object.keys(R[g]).map(k=>inp(g,k,LBL[g][1]?LBL[g][1][k]||k:k,['parts','own','dem','easy'].includes(g))).join('')}</div>`).join('')}
   <button class="back" id="p-reset" style="margin-top:6px">Reset to defaults</button></details>`}

// ---------- unlock ----------
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

// ---------- setup ----------
function start(data){P=data;
  const {map,esc}=H;
  map.createPane('priv').style.zIndex=425;map.createPane('ctx').style.zIndex=424;
  rPriv=L.svg({pane:'priv',padding:.3});          // SVG, not canvas: shapes take clicks without blocking the layers underneath
  rCtx=L.svg({pane:'ctx',padding:.3});
  const css=document.createElement('style');css.textContent=CSS;document.head.append(css);
  loadR();loadN();
  const box=document.createElement('div');box.className='controls priv';
  box.innerHTML=`<div class="priv-box"><b>Deal mode</b><span>Data ${esc(P.built)} · <button class="back" id="p-lock">Lock</button></span></div>
   <div class="ctl-row" role="group" aria-label="Show on map">${LAYERS.filter(l=>P.layers[l.k]).map(l=>`<label class="chip"><input type="checkbox" data-l="${l.k}"${l.on?' checked':''}><i class="dot" style="background:${l.color}"></i>${esc(l.label)}</label>`).join('')}</div>
   <div class="priv-row"><select id="p-status" aria-label="Status"><option value="active">Hide passed</option><option value="all">All statuses</option><option value="short">Shortlist only</option><option value="any">Anything I've marked</option></select>
    <select id="p-size" aria-label="Size"><option value="all">Any size</option><option value="a">2,500 to 10,000 SF</option><option value="b">10,000 to 25,000 SF</option><option value="c">25,000 to 75,000 SF</option><option value="d">Over 75,000 SF</option></select>
    <label class="chip"><input type="checkbox" id="p-sale">For sale</label><label class="chip"><input type="checkbox" id="p-med">Medical office</label><label class="chip"><input type="checkbox" id="p-prov">Has practices</label><label class="chip"><input type="checkbox" id="p-over">Over budget</label></div>
   <div class="priv-row legend2" id="p-legend"></div>
   ${settingsHTML()}
   <div class="priv-row"><button class="back" id="p-sheet">Ring and comp tables</button><button class="back" id="p-csv">Export my marked buildings (CSV)</button></div>`;
  const pub=$('.controls'),more=document.createElement('details');more.className='more';more.innerHTML='<summary>Condo and map display options</summary>';
  pub.before(box,more);more.append(pub);
  $('#p-lock').addEventListener('click',()=>{store.del();location.reload()});
  LAYERS.forEach(l=>{const rows=P.layers[l.k];if(!rows)return;
    l.group=L.layerGroup();
    l.marks=rows.map(it=>{const r=l.k==='cand'?Math.max(4,Math.min(11,3+Math.sqrt((it.f['Bldg SF']||0)/1500))):5;
      const m=L.circleMarker([it.lat,it.lon],{renderer:rPriv,pane:'priv',radius:r,color:'#fff',weight:1.2,fillColor:l.color,fillOpacity:.92});
      m._it=it;m._l=l;m._r=r;it._m=m;it._l=l;
      m.bindTooltip(()=>tip(l,it),{className:'tip',direction:'top',offset:[0,-6]});
      m.on('click',ev=>{L.DomEvent.stop(ev);open(it,{from:'map'})});return m});
    if(l.k!=='cand')l.marks.forEach(m=>l.group.addLayer(m));
    if(l.on)l.group.addTo(map)});
  rescore();pcts();applyFilter();sizeDots();map.on('zoomend',sizeDots);
  box.querySelectorAll('#p-rank input').forEach(inp=>inp.addEventListener('input',()=>{const v=parseFloat(inp.value);if(isFinite(v)){R[inp.dataset.g][inp.dataset.k]=v;rerank()}}));
  $('#p-reset').addEventListener('click',()=>{try{localStorage.removeItem(RKEY)}catch(e){}loadR();box.querySelectorAll('#p-rank input').forEach(inp=>inp.value=R[inp.dataset.g][inp.dataset.k]);rerank()});
  box.querySelectorAll('[data-l]').forEach(c=>c.addEventListener('change',()=>{const l=LAYERS.find(x=>x.k===c.dataset.l);c.checked?l.group.addTo(map):map.removeLayer(l.group)}));
  $('#p-size').addEventListener('change',e=>{filt.size=e.target.value;applyFilter()});
  $('#p-status').addEventListener('change',e=>{filt.status=e.target.value;applyFilter()});
  [['p-sale','sale'],['p-med','med'],['p-prov','prov'],['p-over','over']].forEach(([id,k])=>$('#'+id).addEventListener('change',e=>{filt[k]=e.target.checked;applyFilter()}));
  $('#p-sheet').addEventListener('click',openSheet);$('#p-csv').addEventListener('click',exportCSV);
  document.addEventListener('keydown',onKey);
  new MutationObserver(onView).observe($('#view'),{childList:true});onView();
}
function tip(l,it){const {esc}=H,f=it.f;
  if(l.k!=='cand')return `<b>${esc(l.name(f))}</b><br>${esc(l.sub(f))}`;
  const s=STATUS.find(x=>x[0]===stat(it));
  return `<b>${f['Rank']?'#'+f['Rank']+' · ':''}${esc(f['Address'])}</b><br>Score ${f['Score']} · ${esc(f['Use'])} · ${num(f['Bldg SF'])} SF${s&&s[0]?` · <span style="color:${s[2]}">${s[1]}</span>`:''}`}
function styleCand(it){const m=it._m;if(!m)return;const s=stat(it),z=H.map.getZoom();
  m.setStyle({fillColor:tierColor(it),color:s?SCOL[s]:'#fff',weight:s?(z<12?2:3):(z<12?.6:1.2),fillOpacity:s==='pass'?.3:.92})}
// readable at every zoom: top tiers stay visible when zoomed out, the rest shrink
function sizeDots(){const z=H.map.getZoom();LAYERS.forEach(l=>(l.marks||[]).forEach(m=>{
  const t=m._it._t,lo=z<12,mid=z<13.5;
  const r=l.k!=='cand'?(lo?3:mid?4:m._r):lo?(t===1?5:t===2?3.5:2.2):mid?Math.max(3.5,m._r*.7):m._r;
  m.setRadius(r)}));P.layers.cand.forEach(styleCand)}

// ---------- filters and the ranked worklist ----------
function passes(it){const f=it.f,[lo,hi]=SIZE[filt.size],s=stat(it);
  if(filt.status==='active'&&s==='pass')return false;if(filt.status==='short'&&s!=='short')return false;if(filt.status==='any'&&!s&&!(NOTES[pid(it)]||{}).n)return false;
  return f['Bldg SF']>=lo&&f['Bldg SF']<hi&&(!filt.sale||f['CoStar For Sale']==='Y')&&(!filt.med||f['Use']==='Medical office')&&(!filt.prov||f['Practice Locations in Bldg']>0)&&(filt.over||!!f['Rank'])}
function applyFilter(){const l=LAYERS[0];l.group.clearLayers();
  list=P.layers.cand.filter(passes).sort((a,b)=>(a.f['Rank']||1e9)-(b.f['Rank']||1e9)||b._sc-a._sc);
  list.forEach(it=>l.group.addLayer(it._m));shown=30;onView(true)}
function onView(force){const {state}=H;if(!P)return;
  if(state.view==='overview'&&(force===true||!$('.priv-rank')))addRanked();
  if(state.view==='hosp'&&(force===true||!$('.priv-ring')))addRing();
  if(state.view!=='priv'){clearCtx();if(sel){H.map.removeLayer(sel);sel=null}cur=null}}
function chips(f,n){return String(f['Why']||'').split(' · ').slice(0,n).map(c=>`<span class="pchip">${H.esc(c)}</span>`).join('')}
function addRanked(){const {esc}=H;const old=$('.priv-rank');if(old)old.remove();const v=$('#view');if(!v||H.state.view!=='overview')return;
  const box=document.createElement('div');box.className='list priv-rank';
  box.innerHTML=`<div class="list-head"><span>Your worklist · ${list.length.toLocaleString('en-US')} buildings</span><span>Score</span></div>
   ${list.length?'':'<p class="priv-note">Nothing matches these filters.</p>'}
   ${list.slice(0,shown).map((it,i)=>{const s=STATUS.find(x=>x[0]===stat(it));return `<button class="row prow" data-r="${i}"><span class="row-name"><i class="dot" style="background:${tierColor(it)}"></i>${it.f['Rank']?'<b>#'+it.f['Rank']+'</b> ':''}${esc(it.f['Address'])}<small> ${esc(it.f['City'])}</small>${s&&s[0]?`<em class="spill" style="border-color:${s[2]};color:${s[2]}">${s[1]}</em>`:''}</span><span class="row-num">${it.f['Score']}</span><span class="row-meta">${chips(it.f,3)}</span></button>`}).join('')}
   ${list.length>shown?`<button class="back" id="p-more" style="margin:8px 0">Show 30 more</button>`:''}`;
  v.prepend(box);
  box.querySelectorAll('[data-r]').forEach(bt=>bt.addEventListener('click',()=>open(list[+bt.dataset.r],{fly:true,from:'list'})));
  const more=box.querySelector('#p-more');if(more)more.addEventListener('click',()=>{shown+=30;addRanked()})}

// ---------- ring summary inside a hospital panel ----------
const near=(a,b)=>H.map.distance([a.lat,a.lon],[b.lat,b.lon]);
function inRing(l,it,h){return l.k==='cand'?it.rings.includes(h.n):near(it,h)<=H.MI}
function addRing(){const {D}=H;const old=$('.priv-ring');if(old)old.remove();
  const facts=$('#view .facts');if(!facts)return;const h=D.hospitals[H.state.hosp];
  const cands=list.filter(it=>it.rings.includes(h.n));
  const cnt=k=>{const l=LAYERS.find(x=>x.k===k);return P.layers[k]?P.layers[k].filter(it=>inRing(l,it,h)).length:0};
  const box=document.createElement('div');box.className='list priv-ring';box.style.marginTop='14px';
  box.innerHTML=`<div class="list-head"><span>Worklist in this ring · ${cands.length}</span><span>Score</span></div>
   <p class="priv-note" style="margin:2px 0 6px">${cnt('condo')} condo sales · ${cnt('bldg')} building sales · ${cnt('buys')} SBA suite purchases · ${cnt('loans')} SBA practice loans within 1 mile</p>
   ${cands.slice(0,15).map((it,i)=>`<button class="row prow" data-c="${i}"><span class="row-name"><i class="dot" style="background:${tierColor(it)}"></i>${it.f['Rank']?'<b>#'+it.f['Rank']+'</b> ':''}${H.esc(it.f['Address'])}</span><span class="row-num">${it.f['Score']}</span><span class="row-meta">${chips(it.f,3)}</span></button>`).join('')}`;
  facts.before(box);
  box.querySelectorAll('[data-c]').forEach(bt=>bt.addEventListener('click',()=>open(cands[+bt.dataset.c],{fly:true,from:'ring'})))}

// ---------- the card ----------
function clearCtx(){if(ctx){H.map.removeLayer(ctx);ctx=null}}
function open(it,o){o=o||{};const {map,state}=H;
  if(o.push&&cur)trail.push(cur);else if(!o.keepTrail)trail=[];
  if(state.view!=='priv')open.back={view:state.view,hosp:state.hosp};       // where Back returns to
  cur=it;H.clearSel();if(sel){map.removeLayer(sel);sel=null}clearCtx();
  state.view='priv';
  if(it.g)sel=L.polygon(it.g.map(H.decode),{renderer:rPriv,pane:'priv',color:'#fff',weight:3,dashArray:'4 3',fill:false,interactive:false}).addTo(map);
  ctx=L.layerGroup().addTo(map);
  ctx.addLayer(L.circleMarker([it.lat,it.lon],{renderer:rCtx,pane:'ctx',radius:16,color:'#fff',weight:2,fill:false,interactive:false}));
  if(o.fly)map.flyTo([it.lat,it.lon],Math.max(map.getZoom(),16.5),{duration:.6});
  else if(!map.getBounds().pad(-.15).contains([it.lat,it.lon]))map.panTo([it.lat,it.lon]);
  $('#view').innerHTML=it._l.k==='cand'?candCard(it):otherCard(it);
  wire(it);$('#view').scrollIntoView({block:'start'});$('.panel-inner')&&($('.panel').scrollTop=0)}
function back(){const {map,selectHosp,renderOverview}=H;if(trail.length){open(trail.pop(),{keepTrail:true});return}
  if(sel){map.removeLayer(sel);sel=null}clearCtx();cur=null;const b=open.back||{};b.view==='hosp'&&b.hosp!=null?selectHosp(b.hosp,true):renderOverview()}
function step(d){if(!cur||cur._l.k!=='cand')return;const i=list.indexOf(cur);if(i<0)return;const n=list[i+d];if(n)open(n,{fly:true,keepTrail:false})}
function onKey(e){if(H.state.view!=='priv'||/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))return;
  if(e.key==='ArrowRight'||e.key==='j'){step(1);e.preventDefault()}else if(e.key==='ArrowLeft'||e.key==='k'){step(-1);e.preventDefault()}else if(e.key==='Escape')back()}

const link=(href,txt)=>`<a class="plink" href="${href}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
function links(it){const f=it.f,a=encodeURIComponent(`${f['Address']||f['Borrower Address']||''}, ${f['City']||''}, TX`);
  return `<div class="plinks">${link(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${it.lat},${it.lon}`,'Street View')}${link(`https://www.google.com/maps/search/?api=1&query=${a}`,'Google Maps')}${f['DCAD Account']?link(`https://www.dallascad.org/AcctDetailCom.aspx?ID=${encodeURIComponent(f['DCAD Account'])}`,'DCAD record'):''}${f['CoStar ID']||f['CoStar ID']===0?link(`https://product.costar.com/detail/all-properties/${encodeURIComponent(f['CoStar ID'])}/summary`,'CoStar'):''}<button class="plink" data-copy="${H.esc(decodeURIComponent(a))}">Copy address</button></div>`}
function kv(rows){const {esc}=H;return rows.filter(r=>r[1]!==''&&r[1]!=null&&r[1]!=='$0').map(([k,v,full])=>`<div${full||String(v).length>24?' class="full"':''}><dt>${esc(k)}</dt><dd class="txt">${esc(v)}</dd></div>`).join('')}
function bar(label,v,col){return `<div class="pbar"><span>${label}</span><i><b style="width:${v}%;background:${col}"></b></i><em>${v}</em></div>`}
function nearby(it,k,maxMi,n){const l=LAYERS.find(x=>x.k===k);if(!P.layers[k])return [];
  return P.layers[k].map(x=>({x,d:near(it,x)/H.MI})).filter(o=>o.d<=maxMi&&o.x!==it).sort((a,b)=>a.d-b.d).slice(0,n).map(o=>Object.assign(o,{l}))}
function nearList(title,rows,empty){const {esc}=H;
  return `<h5>${title}</h5>${rows.length?rows.map((o,i)=>`<button class="nrow" data-n="${o.l.k}:${P.layers[o.l.k].indexOf(o.x)}"><i class="dot" style="background:${o.l.k==='cand'?tierColor(o.x):o.l.color}"></i><span><b>${esc(o.l.name(o.x.f))}</b><small>${esc(o.l.sub(o.x.f))}</small></span><em>${o.d.toFixed(2)} mi</em></button>`).join(''):`<p class="priv-note">${empty}</p>`}`}
function candCard(it){const {esc}=H,f=it.f,p=it._p,i=list.indexOf(it),s=stat(it),nt=NOTES[pid(it)]||{};
  const nearC=nearby(it,'condo',1.5,5),nearB=nearby(it,'bldg',1,3),nearS=nearby(it,'buys',3,3),nearL=nearby(it,'loans',1,4),nearCand=nearby(it,'cand',.5,4).filter(o=>o.x.f['Rank']);
  nearC.concat(nearB,nearS,nearL).forEach(o=>ctx.addLayer(L.circleMarker([o.x.lat,o.x.lon],{renderer:rCtx,pane:'ctx',radius:9,color:o.l.color,weight:2,fill:false,interactive:false})));
  ctx.addLayer(L.circle([it.lat,it.lon],{renderer:rCtx,pane:'ctx',radius:H.MI/2,color:'#fff',weight:1,dashArray:'3 5',fill:false,interactive:false}));
  const leased=f['CoStar % Leased'],cs=f['CoStar vs DCAD Size']==='OK';
  return `<div class="pnav"><button class="back" id="bk">← Back</button>${i>=0?`<span><button class="back" id="p-prev" ${i<1?'disabled':''}>‹ Prev</button> ${i+1} of ${list.length} <button class="back" id="p-next" ${i>=list.length-1?'disabled':''}>Next ›</button></span>`:''}</div>
   <div class="phead"><div><div class="eyebrow">${esc(f['Tier'])} · ${esc(f['Nearest Hospital'])} · ${f['Distance (mi)']} mi</div>
    <h2>${f['Rank']?'#'+f['Rank']+' ':''}${esc(f['Address'])}</h2><p class="sub">${esc([f['Property Name'],f['City']].filter(Boolean).join(' · '))}</p></div>
    <div class="pscore" style="border-color:${tierColor(it)}"><b>${f['Score']}</b><span>score</span></div></div>
   <div class="pbars">${bar('Owner likely to sell',Math.round(100*p.own),'#f472b6')}${bar('Buyer demand nearby',Math.round(100*p.dem),'#38bdf8')}${bar('Easy to convert',Math.round(100*p.easy),'#a3e635')}</div>
   <div class="pchips">${chips(f,12)}</div>
   <div class="pstat" role="group" aria-label="Status">${STATUS.map(x=>`<button data-s="${x[0]}" aria-pressed="${s===x[0]}" style="${s===x[0]&&x[0]?`background:${x[2]};border-color:${x[2]};color:#111`:''}">${x[1]}</button>`).join('')}</div>
   <textarea id="p-note" rows="2" placeholder="Notes (saved in this browser)">${esc(nt.n||'')}</textarea>${nt.t?`<p class="priv-note" style="margin:2px 0 0">Last updated ${esc(nt.t)}</p>`:''}
   ${links(it)}
   <dl class="facts"><h5>The building</h5>${kv([['Size',`${num(f['Bldg SF'])} SF${f['Net Leasable SF']?` (${num(f['Net Leasable SF'])} leasable)`:''}`],['Use',f['Use']],['Built',[f['Yr Built'],f['Remodel Yr']?`remodeled ${f['Remodel Yr']}`:''].filter(Boolean).join(', ')],['Stories',f['Stories']],['DCAD condition',[f['DCAD Condition'],f['DCAD Quality']].filter(Boolean).join(' / ')],
     ['Parking',cs&&f['CoStar Parking Ratio']?`${f['CoStar Parking Ratio']}/1,000 SF${f['CoStar Parking Spaces']?` (${f['CoStar Parking Spaces']} spaces)`:''}`:''],['Leased',cs&&leased!=null&&leased!==''?`${leased}%${f['CoStar Available SF']?`, ${num(f['CoStar Available SF'])} SF available`:''}`:''],['Asking rent',cs?f['CoStar Rent/SF/Yr']:''],['Class',cs?f['CoStar Class']:''],['Practices in the building',f['Practice Locations in Bldg']?`${f['Practice Locations in Bldg']} (${f['Physicians in Bldg']} physicians, ${f['Dentists in Bldg']} dentists, ${f['Other Outpatient in Bldg']} other)`:'']])}
   <h5>Price signals</h5>${kv([['DCAD value',f['DCAD Value']?`${money(f['DCAD Value'])} (${money(f['Value / SF'])}/SF)`:''],['For sale (CoStar)',cs&&f['CoStar For Sale']==='Y'?`Yes${f['CoStar For Sale $/SF']?`, asking $${num(f['CoStar For Sale $/SF'])}/SF`:''}`:''],['Last sale (CoStar)',cs&&f['CoStar Last Sale Date']?`${f['CoStar Last Sale Date']}${f['CoStar Last Sale Price']?`, ${money(f['CoStar Last Sale Price'])}`:''}`:''],['Last deed (DCAD)',f['Latest Deed']?`${f['Latest Deed']} (${f['Years Held']} yrs held)`:'']])}
   <h5>Owner</h5>${kv([['Owner',[f['Owner'],f['Owner 2']].filter(Boolean).join(' / '),1],['Mailing address',f['Owner Mailing Address'],1],['True owner (CoStar)',cs?f['CoStar True Owner']:'',1],['Owner type',f['Owner Type']]])}
   <h5>Demand around it</h5>${kv([['Practices within ½ mile',f['Practices within 1/2 mi']],['SBA practice loans within 1 mile',f['SBA Loans within 1 mi']],['Competing independent medical condo suites within 1 mile',f['Indep. Medical Condo Suites within 1 mi'],1]])}</dl>
   <div class="pnear">${nearList('Condo sales within 1½ miles',nearC,'None in the CoStar export.')}${nearList('SBA suite purchases within 3 miles',nearS,'None found.')}${nearList('Building sales within 1 mile (last 12 months)',nearB,'None in the CoStar export.')}${nearList('SBA practice loans within 1 mile',nearL,'None found.')}${nearCand.length?nearList('Other ranked buildings within ½ mile',nearCand,''):''}</div>
   <details class="more pall"><summary>All details</summary><dl class="facts">${allFields(f)}</dl></details>
   <p class="note" style="margin-top:12px">${esc(NOTE.cand)}</p>`}
function otherCard(it){const {esc}=H,l=it._l,f=it.f;
  const nearCand=nearby(it,'cand',1,6).filter(o=>o.x.f['Rank']);
  nearCand.forEach(o=>ctx.addLayer(L.circleMarker([o.x.lat,o.x.lon],{renderer:rCtx,pane:'ctx',radius:9,color:'#fff',weight:2,fill:false,interactive:false})));
  const fv=k=>{const v=f[k];if(v==null||v==='')return '';return typeof v==='number'&&/\$|Price|Loan|Cost/.test(k)?money(v):typeof v==='number'?num(v):String(v)};
  return `<div class="pnav"><button class="back" id="bk">← Back</button></div>
   <div class="phead"><div><div class="eyebrow">${esc(l.label)}</div><h2>${esc(l.name(f))}</h2><p class="sub">${esc(l.sub(f))}</p></div></div>
   ${links(it)}
   <dl class="facts">${kv((KEY[l.k]||[]).map(k=>[k,fv(k)]))}</dl>
   <div class="pnear">${nearList('Ranked buildings within 1 mile',nearCand,'No ranked buildings within a mile.')}</div>
   <details class="more pall"><summary>All details</summary><dl class="facts">${allFields(f)}</dl></details>
   <p class="note" style="margin-top:12px">${esc(NOTE[l.k])}</p>`}
function allFields(f){const fv=(k,v)=>typeof v!=='number'?String(v):/\$|Price|Value|Loan|Cost/.test(k)&&!/Rent/.test(k)?money(v):/Yr|Year|ID/.test(k)?String(v):num(v);
  return kv(Object.entries(f).filter(([k,v])=>v!==null&&v!==''&&v!==undefined).map(([k,v])=>[k,fv(k,v)]))}
function wire(it){$('#bk').addEventListener('click',back);
  const pv=$('#p-prev'),nx=$('#p-next');pv&&pv.addEventListener('click',()=>step(-1));nx&&nx.addEventListener('click',()=>step(1));
  document.querySelectorAll('.pstat [data-s]').forEach(b=>b.addEventListener('click',()=>{setNote(it,{s:b.dataset.s});open(it,{keepTrail:true})}));
  const ta=$('#p-note');let t;ta&&ta.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(()=>setNote(it,{n:ta.value.trim()}),400)});
  document.querySelectorAll('.nrow').forEach(b=>b.addEventListener('click',()=>{const [k,i]=b.dataset.n.split(':');open(P.layers[k][+i],{push:true})}));
  document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',()=>{navigator.clipboard&&navigator.clipboard.writeText(b.dataset.copy);b.textContent='Copied'}))}

// ---------- tables and export ----------
function openSheet(){const {esc}=H;const s=$('#sheet');
  const cell=(h,v)=>v==null?'':typeof v==='number'?(/\$/.test(h)?'$':'')+Number(v).toLocaleString('en-US'):esc(v);
  $('#sheetIn').innerHTML=`<div class="sheet-head"><div><div class="eyebrow">Deal mode</div><h2 id="sheetTitle">Ring and comp tables</h2><p class="sub">Most Texas sales have no disclosed price, so read each median with its count.</p></div><button class="x" id="closeSheet">Close</button></div>
   ${P.sheets.map(t=>`<div class="priv-tbl"><h3>${esc(t.title)}</h3><p class="sub">${esc(t.note)}</p><div class="tbl-wrap"><table class="ntbl"><thead><tr>${t.head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r=>`<tr>${r.map((v,i)=>`<td${typeof v==='number'?' class="n"':''}>${cell(t.head[i],v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`).join('')}`;
  s.hidden=false;$('#closeSheet').addEventListener('click',()=>{s.hidden=true})}
function exportCSV(){const rows=P.layers.cand.filter(it=>NOTES[pid(it)]).sort((a,b)=>(a.f['Rank']||1e9)-(b.f['Rank']||1e9));
  const head=['Rank','Score','Status','Notes','Updated','Address','City','Use','Bldg SF','DCAD Value','Owner','Owner Mailing Address','Nearest Hospital','Why'];
  const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const csv=[head.join(',')].concat(rows.map(it=>{const n=NOTES[pid(it)],s=STATUS.find(x=>x[0]===(n.s||''));return [it.f['Rank'],it.f['Score'],s?s[1]:'',n.n,n.t,it.f['Address'],it.f['City'],it.f['Use'],it.f['Bldg SF'],it.f['DCAD Value'],it.f['Owner'],it.f['Owner Mailing Address'],it.f['Nearest Hospital'],it.f['Why']].map(q).join(',')})).join('\n');
  if(!rows.length){alert('Mark a building first (Shortlist, Contacted, In talks or Pass), then export.');return}
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`my-buildings-${new Date().toISOString().slice(0,10)}.csv`;a.click()}

const CSS=`
.priv-box{display:flex;justify-content:space-between;align-items:center;border:1px solid #ff7a1a;border-radius:3px;padding:6px 10px;font-size:12px;color:var(--muted)}
.priv-box b{font-family:var(--f-display);letter-spacing:.06em;text-transform:uppercase;font-size:11px;color:var(--ink)}
.priv-box .back{font-size:12px}
.priv-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;color:var(--muted)}
.priv-row select{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:3px;padding:3px 4px}
.legend2 span{display:inline-flex;align-items:center;gap:4px;margin-right:6px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;flex:none;box-sizing:border-box}
.facts div.full{grid-column:1/-1}.priv-note{font-size:12px;color:var(--muted);margin:8px 0 0}
.more summary{cursor:pointer;font-size:12.5px;color:var(--muted);padding:2px 0}.more[open] summary{margin-bottom:8px}
.priv-tbl{margin-bottom:22px}.priv-tbl h3{margin:14px 0 2px;font-family:var(--f-display);font-size:15px}
.rk-g{margin:8px 0 2px}.rk-g b{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);margin-bottom:2px}
.rk{display:grid;grid-template-columns:1fr 92px 34px;gap:6px;align-items:center;font-size:12px;color:var(--muted);padding:2px 0}
.rk input{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:3px;padding:3px 5px;width:100%;box-sizing:border-box;text-align:right}
.rk em{font-style:normal;font-size:11px;text-align:right}
.prow .row-name{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.prow .row-name small{color:var(--muted);font-weight:400}
.spill{font-style:normal;font-size:10.5px;border:1px solid;border-radius:9px;padding:0 6px}
.pchip{display:inline-block;font-size:11px;line-height:1.3;border:1px solid var(--rule);border-radius:3px;padding:1px 5px;margin:2px 4px 0 0;color:var(--ink)}
.row-meta .pchip{color:var(--muted)}
.pnav{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted)}.pnav .back[disabled]{opacity:.35;cursor:default}
.phead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-top:10px}.phead h2{margin:2px 0 0}
.pscore{flex:none;border:2px solid;border-radius:50%;width:58px;height:58px;display:grid;place-content:center;text-align:center}
.pscore b{font-family:var(--f-mono);font-size:20px;line-height:1}.pscore span{font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.pbars{margin-top:10px;display:grid;gap:4px}
.pbar{display:grid;grid-template-columns:150px 1fr 28px;gap:8px;align-items:center;font-size:12px;color:var(--muted)}
.pbar i{height:7px;background:var(--rule);border-radius:4px;overflow:hidden}.pbar i b{display:block;height:100%}
.pbar em{font-style:normal;font-family:var(--f-mono);text-align:right;color:var(--ink)}
.pchips{margin-top:8px}
.pstat{display:flex;flex-wrap:wrap;gap:4px;margin-top:12px}
.pstat button{all:unset;cursor:pointer;font-size:12px;border:1px solid var(--rule);border-radius:3px;padding:3px 9px;color:var(--ink)}
.pstat button[aria-pressed="true"]:not([style*="background"]){border-color:var(--ink)}
#p-note{display:block;width:100%;box-sizing:border-box;margin-top:6px;font:inherit;font-size:12.5px;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:3px;padding:6px 8px;resize:vertical}
.plinks{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.plink{all:unset;cursor:pointer;font-size:12px;color:var(--ink);border:1px solid var(--rule);border-radius:3px;padding:3px 8px}
.plink:hover,.pstat button:hover,.nrow:hover{border-color:var(--ink)}
.pnear h5,.facts h5{margin-top:6px}
.pnear h5{grid-column:1/-1;margin:14px 0 4px;padding:6px 0 4px;font-family:var(--f-display);font-weight:600;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--rule)}
.nrow{all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:12px 1fr auto;gap:8px;align-items:start;width:100%;padding:6px 4px;border-bottom:1px solid var(--rule);border-left:2px solid transparent}
.nrow span b{display:block;font-size:12.5px;font-weight:600}.nrow span small{display:block;font-size:11.5px;color:var(--muted)}
.nrow em{font-style:normal;font-size:11.5px;color:var(--muted);font-family:var(--f-mono)}.nrow .dot{margin-top:4px}
.pall{margin-top:14px}`;
})();
