// Deal layers. This file holds no data: everything is in deal-data.bin, encrypted by pipeline/07_targets.py.
// Without the key the page stays the plain public map. The key arrives once as #key=... and is kept in this browser only.
(function(){
const $=s=>document.querySelector(s);
const LAYERS=[
 {k:'cand',label:'Conversion candidates',color:'#ff7a1a',on:true,name:f=>(f['Rank']?`#${f['Rank']} `:'')+(f['Property Name']||f['Address']),sub:f=>`Score ${f['Score']} · ${f['Why']}`},
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
const TCOL=['#94a3b8','#e11d48','#ff7a1a','#fbbf24'];          // over budget, top tier, second tier, in budget
const tierColor=it=>TCOL[it._t||0];
let H,P,R,sel=null,shown=25,filt={size:'all',sale:false,med:false,prov:false,over:false};

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
  C.forEach(it=>{const r=score(it.s);it._sc=r.total;it.f['Score']=r.total;it.f['Owner Likely to Sell (0-100)']=Math.round(100*r.own);
    it.f['Buyer Demand Nearby (0-100)']=Math.round(100*r.dem);it.f['Easy to Convert (0-100)']=Math.round(100*r.easy)});
  const inb=C.filter(it=>it.s.val<=o.budget).sort((a,b)=>b._sc-a._sc);
  C.forEach(it=>{it.f['Rank']=null;it._t=0;it.f['Tier']='Over budget'});
  inb.forEach((it,i)=>{const n=i+1;it.f['Rank']=n;it._t=n<=o.top1?1:n<=o.top2?2:3;it.f['Tier']=n<=o.top1?`Top ${o.top1}`:n<=o.top2?`Top ${o.top2}`:'In budget'});
  LAYERS[0].marks&&LAYERS[0].marks.forEach(m=>m.setStyle({fillColor:tierColor(m._it)}));
  const lg=document.querySelector('#p-legend');if(lg)lg.innerHTML=[[1,`Top ${o.top1}`],[2,`Top ${o.top2}`],[3,'In budget'],[0,`Over $${(o.budget/1e6).toLocaleString('en-US')}M DCAD value`]].map(([t,l])=>`<span><i class="sw" style="background:${TCOL[t]};display:inline-block;vertical-align:-1px"></i> ${l}</span>`).join('')}
let rT=null;function rerank(){clearTimeout(rT);rT=setTimeout(()=>{saveR();rescore();applyFilter();pcts()},150)}
function pcts(){['parts','own','dem','easy'].forEach(g=>{const w=norm(g);Object.keys(w).forEach(k=>{const e=document.querySelector(`[data-pct="${g}.${k}"]`);if(e)e.textContent=Math.round(100*w[k])+'%'})})}
function settingsHTML(){const {esc}=H;const inp=(g,k,label,pct)=>`<label class="rk"><span>${esc(label)}</span><input type="number" inputmode="decimal" step="any" data-g="${g}" data-k="${esc(k)}" value="${R[g][k]}">${pct?`<em data-pct="${g}.${esc(k)}"></em>`:'<em></em>'}</label>`;
  return `<details class="more" id="p-rank"><summary>Ranking settings</summary><p class="priv-note" style="margin:0 0 6px">Change any number and the ranking updates. Weights are relative: each group is scaled to 100% (shown on the right). Saved in this browser.</p>
   ${['parts','own','dem','easy','opts','useVal','condVal'].map(g=>`<div class="rk-g"><b>${esc(LBL[g][0])}</b>${Object.keys(R[g]).map(k=>inp(g,k,LBL[g][1]?LBL[g][1][k]||k:k,['parts','own','dem','easy'].includes(g))).join('')}</div>`).join('')}
   <button class="back" id="p-reset" style="margin-top:6px">Reset to defaults</button></details>`}

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
.priv-tbl{margin-bottom:22px}.priv-tbl h3{margin:14px 0 2px;font-family:var(--f-display);font-size:15px}
.rk-g{margin:8px 0 2px}.rk-g b{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);margin-bottom:2px}
.rk{display:grid;grid-template-columns:1fr 92px 34px;gap:6px;align-items:center;font-size:12px;color:var(--muted);padding:2px 0}
.rk input{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:3px;padding:3px 5px;width:100%;box-sizing:border-box;text-align:right}
.rk em{font-style:normal;font-size:11px;text-align:right}`;
  document.head.append(css);
  loadR();
  const box=document.createElement('div');box.className='controls';
  box.innerHTML=`<div class="priv-box"><b>Deal data</b> · built ${H.esc(P.built)}, CoStar ${H.esc(P.costarAsOf)} · <button class="back" id="p-lock" style="font-size:12px">Lock</button></div>
   <div class="ctl-row" role="group" aria-label="Deal layers">${LAYERS.filter(l=>P.layers[l.k]).map(l=>`<label class="chip"><input type="checkbox" data-l="${l.k}"${l.on?' checked':''}><i class="sw" style="background:${l.color}"></i>${H.esc(l.label)} (${P.layers[l.k].length.toLocaleString('en-US')})</label>`).join('')}</div>
   <div class="priv-row"><span>Candidates:</span><select id="p-size" aria-label="Candidate size"><option value="all">All sizes</option><option value="a">2,500 to 25,000 SF</option><option value="b">25,000 to 75,000 SF</option><option value="c">75,000 to 150,000 SF</option><option value="d">Over 150,000 SF</option></select>
   <label class="chip"><input type="checkbox" id="p-sale">For sale</label><label class="chip"><input type="checkbox" id="p-med">Medical office</label><label class="chip"><input type="checkbox" id="p-prov">Has practices</label><label class="chip"><input type="checkbox" id="p-over">Over budget</label></div>
   <div class="priv-row" id="p-legend"></div>
   ${settingsHTML()}
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
  rescore();pcts();applyFilter();sizeDots();map.on('zoomend',sizeDots);
  box.querySelectorAll('#p-rank input').forEach(inp=>inp.addEventListener('input',()=>{const v=parseFloat(inp.value);if(isFinite(v)){R[inp.dataset.g][inp.dataset.k]=v;rerank()}}));
  $('#p-reset').addEventListener('click',()=>{try{localStorage.removeItem(RKEY)}catch(e){}loadR();box.querySelectorAll('#p-rank input').forEach(inp=>inp.value=R[inp.dataset.g][inp.dataset.k]);rerank()});
  box.querySelectorAll('[data-l]').forEach(c=>c.addEventListener('change',()=>{const l=LAYERS.find(x=>x.k===c.dataset.l);c.checked?l.group.addTo(map):map.removeLayer(l.group)}));
  $('#p-size').addEventListener('change',e=>{filt.size=e.target.value;applyFilter()});
  [['p-sale','sale'],['p-med','med'],['p-prov','prov'],['p-over','over']].forEach(([id,k])=>$('#'+id).addEventListener('change',e=>{filt[k]=e.target.checked;applyFilter()}));
  $('#p-sheet').addEventListener('click',openSheet);
  new MutationObserver(addRing).observe($('#view'),{childList:true});addRing();
}

// Small when zoomed out so the dots don't hide the rings
function sizeDots(){const z=H.map.getZoom(),s=z<12?.4:z<13.5?.65:1;LAYERS.forEach(l=>(l.marks||[]).forEach(m=>{m.setRadius(Math.max(1.8,m._r*s));m.setStyle({weight:z<12?.5:1})}))}
function passes(it){const f=it.f,[lo,hi]=SIZE[filt.size];
  return f['Bldg SF']>=lo&&f['Bldg SF']<hi&&(!filt.sale||f['CoStar For Sale']==='Y')&&(!filt.med||f['Use']==='Medical office')&&(!filt.prov||f['Practice Locations in Bldg']>0)&&(filt.over||!!f['Rank'])}
function applyFilter(){const l=LAYERS[0];l.group.clearLayers();l.marks.filter(m=>passes(m._it)).forEach(m=>l.group.addLayer(m));shown=25;addRing(true)}

// Ranked list on the overview: candidates passing the filters, best first
function addRanked(){const {state,esc}=H;const old=document.querySelector('.priv-rank');if(old)old.remove();
  if(state.view!=='overview'||!P)return;const anchor=document.querySelector('#view .list');if(!anchor)return;
  const list=P.layers.cand.filter(passes).sort((a,b)=>(a.f['Rank']||1e9)-(b.f['Rank']||1e9)||b._sc-a._sc);const box=document.createElement('div');box.className='list priv-rank';box.style.marginTop='16px';
  box.innerHTML=`<div class="list-head"><span>Ranked opportunities (${list.length.toLocaleString('en-US')})</span><span>Score</span></div>
   ${list.slice(0,shown).map((it,i)=>`<button class="row" data-r="${i}"><span class="row-name"><i class="sw" style="background:${tierColor(it)};display:inline-block;margin-right:6px;vertical-align:-1px"></i>${it.f['Rank']?'#'+it.f['Rank']+' ':''}${esc(it.f['Address'])}, ${esc(it.f['City'])}</span><span class="row-num">${it.f['Score']}</span><span class="row-meta">${esc(it.f['Why'])}</span></button>`).join('')}
   ${list.length>shown?'<button class="back" id="p-more" style="margin:8px 0">Show 25 more</button>':''}`;
  anchor.before(box);
  box.querySelectorAll('[data-r]').forEach(bt=>bt.addEventListener('click',()=>{const it=list[+bt.dataset.r];H.map.flyTo([it.lat,it.lon],17,{duration:.6});show(LAYERS[0],it)}));
  const more=box.querySelector('#p-more');if(more)more.addEventListener('click',()=>{shown+=25;addRanked()})}

function inRing(l,it,h){return l.k==='cand'?it.rings.includes(h.n):H.map.distance([it.lat,it.lon],[h.lat,h.lon])<=H.MI}
function addRing(force){const {state,D}=H;const old=document.querySelector('.priv-ring');
  if(state.view==='overview'&&(force===true||!document.querySelector('.priv-rank')))addRanked();
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
