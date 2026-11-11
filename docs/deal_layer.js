// Deal mode. This file holds no data: everything is in deal-data.bin, encrypted by pipeline/07_targets.py.
// Without the key the page stays the plain public map. The key arrives once as #key=... and is kept in this browser only.
// Path: 1 Areas (where to hunt) -> 2 Buildings (what to buy there, graded A/B/C) -> 3 Brief (one printable page).
(function(){
const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
const GCOL={A:'#e11d48',B:'#ff7a1a',C:'#94a3b8'};                 // building grades
const ACOL={A:'#22c55e',B:'#f59e0b',C:'#94a3b8'};                 // area grades
const LAYERS=[
 {k:'cand',label:'Ranked buildings',color:'#ff7a1a',on:true,core:true,name:f=>f['Address'],sub:f=>`Grade ${f['Grade']} · ${f['Use']} · ${num(f['Bldg SF'])} SF`},
 {k:'cprj',label:'Medical condo projects',color:'#34d399',on:true,core:true,name:f=>f['Project'],sub:f=>`${f['Independent Medical Suites']} independent medical of ${f['Suites']} suites${f['Bulk Buy']!=='No'?' · bulk buy':''}`},
 {k:'list',label:'For sale (CoStar)',color:'#a78bfa',on:true,core:true,name:f=>f['Property Name']||f['Property Address'],sub:f=>[f['City'],f['Property Type'],f['RBA']?num(f['RBA'])+' SF':'',f['For Sale Price Per SF']?`asking $${num(f['For Sale Price Per SF'])}/SF`:''].filter(Boolean).join(' · ')},
 {k:'condo',label:'Condo sales (CoStar)',color:'#2dd4bf',on:true,core:true,name:f=>String(f['Address']||'').replace(' (Condo)',''),sub:f=>compSub(f)},
 {k:'buys',label:'SBA suite purchases',color:'#e879f9',on:true,core:true,name:f=>f['Borrower'],sub:f=>`${f['Borrower Address']} · est. $${f['Est. $/SF']}/SF`},
 {k:'bldg',label:'Building sales (CoStar)',color:'#60a5fa',name:f=>f['Address'],sub:f=>compSub(f)},
 {k:'loans',label:'SBA practice loans',color:'#fde047',name:f=>f['Borrower'],sub:f=>`${f['City']} · ${f['Loan Date']} · ${money(f['Est. Project Cost'])} est. project`},
 {k:'review',label:'Other CoStar buildings',color:'#cbd5e1',name:f=>f['CoStar Name']||f['Address'],sub:f=>f['Status vs DCAD']}];
const NOTE={
 cand:'Sources: DCAD 2026 roll, CMS NPI Registry, CoStar (11/3/2026), SBA (9/30/2026). The grade is a research order, not a valuation.',
 cprj:'DCAD 2026 roll. Independent = not owned by a hospital or health system. Bulk buy = one independent owner holds 2+ suites.',
 list:'CoStar, marked for sale in the 11/3/2026 property exports. A CoStar listings export will replace this when it is added.',
 buys:'SBA loan data as of 9/30/2026 matched to a DCAD deed. A likely purchase, not confirmed. The price is estimated from the loan and can run high.',
 condo:'CoStar sale comp, exported 11/3/2026. Most Texas sales have no disclosed price.',
 bldg:'CoStar sale comp, exported 11/3/2026. Building comps cover only the last 12 months.',
 loans:'SBA loan data as of 9/30/2026. A long term usually means real estate, but the data has no loan purpose. The address is the borrower\'s.',
 review:'CoStar property (11/3/2026) that is not on the candidate list. The status says why.'};
const KEY={buys:['Industry','Loan Date','DCAD Deed Date','Est. Price','Suite SF','Est. $/SF','DCAD Owner','Match'],
 condo:['Sale Date','Sale Status','Sale Type','SF','Sale Price','Price / SF','Asking Price','Asking / SF','Secondary Type','Yr Built','Buyer (True)','Seller (True)','Sale Condition','Price Treatment'],
 bldg:['Sale Date','Sale Status','Sale Type','SF','Sale Price','Price / SF','Asking Price','Asking / SF','Secondary Type','Yr Built','Buyer (True)','Seller (True)','Sale Condition','Price Treatment'],
 loans:['Industry','Loan Date','SBA or 7(a) Loan','504 Bank Loan','Est. Project Cost','Term (mo)','Lender','Status'],
 review:['Status vs DCAD','CoStar Type','CoStar Secondary Type','CoStar RBA','DCAD Bldg Class','CoStar True Owner','CoStar Condo'],
 cprj:['Address','City','Suites','Medical Suites','Independent Medical Suites','Hospital-owned Suites','Largest Independent Owner','Suites Held by Largest Owner','Bulk Buy','Latest Deed'],
 list:['Property Address','City','Property Type','Secondary Type','Building Class','RBA','Condo','For Sale Price Per SF','Percent Leased','Year Built','True Owner Name']};
const STATUS=[['','No status',''],['short','Shortlist','#22c55e'],['contact','Contacted','#38bdf8'],['talk','In talks','#a855f7'],['pass','Pass','#64748b']];
const SCOL=Object.fromEntries(STATUS.map(s=>[s[0],s[2]]));
let H,P,R,rPriv,rCtx,sel=null,ctx=null,shown=25,list=[],stats=[],nav=[],cur=null,areaLabels=null,asort='score';
let filt={status:'active',listed:false,med:false,chg:false};
const num=v=>v==null||v===''?'':Number(v).toLocaleString('en-US');
const money=v=>v==null||v===''?'':'$'+Math.round(v).toLocaleString('en-US');
function compSub(f){const p=f['Price / SF']?`$${num(Math.round(f['Price / SF']))}/SF sold`:f['Asking / SF']?`$${num(f['Asking / SF'])}/SF asking`:'no price';return [f['City'],f['Sale Date'],p].filter(Boolean).join(' · ')}
const plural=(n,w,ws)=>`${num(n)} ${n===1?w:(ws||w+'s')}`;

// ---------- your status and notes (this browser, optionally synced through a private GitHub Gist) ----------
const NKEY='hcm-notes';let NOTES={};
function loadN(){try{NOTES=JSON.parse(localStorage.getItem(NKEY)||'{}')}catch(e){NOTES={}}
  Object.values(NOTES).forEach(n=>{if(!n.u)n.u=n.t?Date.parse(n.t):0})}
function saveN(){try{localStorage.setItem(NKEY,JSON.stringify(NOTES))}catch(e){}Sync.later()}
const pid=it=>it.f['GIS Parcel ID'];
const note=it=>{const n=NOTES[pid(it)];return n&&!n.del?n:{}};
const stat=it=>note(it).s||'';
function setNote(it,patch){const k=pid(it);const n=Object.assign({},note(it),patch,{t:new Date().toISOString().slice(0,10),u:Date.now()});
  NOTES[k]=(!n.s&&!n.n)?{del:1,u:n.u}:n;saveN();styleCand(it)}

// ---------- settings you can change (same math as rank_parts() in pipeline/07_targets.py) ----------
const LBL={
 parts:['How much each part counts',{own:'Owner likely to sell',fit:'Building fit',dem:'Demand right around the building'}],
 own:['Owner likely to sell',{sale:'Listed for sale (CoStar)',hold:'Years owned',away:'Owner out of state (outside DFW counts partly)',person:'Owner is a person, trust or estate',single:"This is the owner's only building in the county",occ:'Owner-occupied (mails from the building)',notInst:'Not an institutional owner'}],
 fit:['Building fit',{use:'Building use',multi:'Already holds several practices (NPI)',park:'Parking (CoStar count, else DCAD land estimate)',low:'Low-rise (1 story best)'}],
 dem:['Demand right around the building',{prac:'Practices within ½ mile',sba:'SBA practice loans within 1 mile',comp:'Few competing medical condo suites within 1 mile'}],
 area:['Area grade',{ratio:'Practices per independent medical condo suite',deeds:'Medical suite deeds (DCAD) in the lookback',comps:'Condo sales (CoStar) in the lookback',sba:'SBA suite purchases in the lookback'}],
 opts:['Screens and thresholds',{maxStories:'Leave out buildings taller than (stories)',noRetail:'Leave out retail (1 = yes, 0 = no)',holdFull:'Years owned for full credit',awayLocal:'Credit if owner is in Texas but outside DFW (0 to 100)',parkTarget:'Parking: full credit at (spaces per 1,000 SF)',gradeA:'Building grade A at score',gradeB:'Building grade B at score',top:'Buildings to show per area',areaA:'Area grade A at score',areaB:'Area grade B at score'}],
 useVal:['Building use, credit 0 to 100',null]};
const WGROUPS=['parts','own','fit','dem','area'];
const RKEY='hcm-rank2';
function loadR(){let saved={};try{saved=JSON.parse(localStorage.getItem(RKEY)||'{}')}catch(e){}
  R=JSON.parse(JSON.stringify(P.rank));Object.keys(R).forEach(g=>Object.keys(R[g]).forEach(k=>{const v=saved[g]&&saved[g][k];if(typeof v==='number'&&isFinite(v))R[g][k]=v}))}
function saveR(){try{localStorage.setItem(RKEY,JSON.stringify(R))}catch(e){}}
function norm(g){const t=Object.values(R[g]).reduce((a,b)=>a+Math.max(0,b),0)||1;const o={};Object.entries(R[g]).forEach(([k,v])=>o[k]=Math.max(0,v)/t);return o}
function score(s){const o=R.opts,wo=norm('own'),wf=norm('fit'),wd=norm('dem'),p=norm('parts');
  const away=s.away===2?1:s.away===1?o.awayLocal/100:0;
  const own=wo.sale*s.sale+wo.hold*Math.min(1,Math.max(0,s.yrs/(o.holdFull||1)))+wo.away*away+wo.person*s.person+wo.single*s.single+wo.occ*s.occ+wo.notInst*(1-s.inst);
  const use=(R.useVal[s.use]??R.useVal.Other)/100;
  const multi=s.pl>=2?1:s.pl===1?.5:.3;
  const pk=s.park==null?.5:s.park>=o.parkTarget?1:s.park>=o.parkTarget-1?.5:0;
  const low=!(s.st>0)?.5:s.st<=1?1:s.st<=2?.6:s.st<=3?.3:0;
  const fit=wf.use*use+wf.multi*multi+wf.park*pk+wf.low*low;
  const dem=wd.prac*s.pp+wd.sba*s.ps+wd.comp*(1-s.pc);
  return {own,fit,dem,total:Math.round(100*(p.own*own+p.fit*fit+p.dem*dem))}}
const gradeOf=v=>v>=R.opts.gradeA?'A':v>=R.opts.gradeB?'B':'C';
function rescore(){P.layers.cand.forEach(it=>{const r=score(it.s);it._sc=r.total;it._p=r;it._g=gradeOf(r.total);
  it.f['Score']=r.total;it.f['Grade']=it._g;it.f['Owner Likely to Sell (0-100)']=Math.round(100*r.own);it.f['Building Fit (0-100)']=Math.round(100*r.fit);it.f['Buyer Demand Nearby (0-100)']=Math.round(100*r.dem)})}
let rT=null;function rerank(){clearTimeout(rT);rT=setTimeout(()=>{saveR();refreshAll();pcts()},150)}
function pcts(){WGROUPS.forEach(g=>{const w=norm(g);Object.keys(w).forEach(k=>{const e=document.querySelector(`[data-pct="${g}.${k}"]`);if(e)e.textContent=Math.round(100*w[k])+'%'})})}
function settingsHTML(){const {esc}=H;const inp=(g,k,label,pct)=>`<label class="rk"><span>${esc(label)}</span><input type="number" inputmode="decimal" step="any" data-g="${g}" data-k="${esc(k)}" value="${R[g][k]}">${pct?`<em data-pct="${g}.${esc(k)}"></em>`:'<em></em>'}</label>`;
  const show=(g,k)=>!(g==='opts'&&['sizeMin','sizeMax','radius','lookback'].includes(k));
  return `<details class="more" id="p-rank"><summary>Grading settings</summary><p class="priv-note" style="margin:0 0 6px">Change any number and the grades update. Weights are relative: each group is scaled to 100% (shown on the right). Saved in this browser.</p>
   ${['area','parts','own','fit','dem','opts','useVal'].map(g=>`<div class="rk-g"><b>${esc(LBL[g][0])}</b>${Object.keys(R[g]).filter(k=>show(g,k)).map(k=>inp(g,k,LBL[g][1]?LBL[g][1][k]||k:k,WGROUPS.includes(g))).join('')}</div>`).join('')}
   <button class="back" id="p-reset" style="margin-top:6px">Reset to defaults</button></details>`}

// ---------- unlock ----------
const STORE='hcm-key',store={get(){try{return localStorage.getItem(STORE)}catch(e){return null}},set(v){try{localStorage.setItem(STORE,v)}catch(e){}},del(){try{localStorage.removeItem(STORE)}catch(e){}}};
const b64=u=>btoa(String.fromCharCode(...new Uint8Array(u))),unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function aesKey(secret,salt,rounds,use){const raw=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:rounds,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},false,use)}
async function unlock(key){
  const buf=await (await fetch('deal-data.bin',{cache:'no-cache'})).arrayBuffer();
  const aes=await aesKey(key,buf.slice(0,16),310000,['decrypt']);
  const zip=await crypto.subtle.decrypt({name:'AES-GCM',iv:buf.slice(16,28)},aes,buf.slice(28));
  return JSON.parse(await new Response(new Blob([zip]).stream().pipeThrough(new DecompressionStream('gzip'))).text())}
function offerUnlock(msg){const a=document.createElement('button');a.className='back';a.style.marginTop='8px';a.textContent=msg||'Unlock';
  a.addEventListener('click',()=>{const k=prompt('Map key');if(k){store.set(k.trim());location.reload()}});$('.src').append(document.createElement('br'),a)}
function boot(){H=window.HCM;
  const m=location.hash.match(/key=([\w-]+)/);if(m){store.set(m[1]);history.replaceState(null,'',location.pathname+location.search)}
  const key=store.get();if(!key)return offerUnlock();
  unlock(key).then(start).catch(err=>{console.error(err);store.del();offerUnlock('Key did not work. Try again')})}
if(window.HCM)boot();else window.addEventListener('hcm-ready',boot,{once:true});

// ---------- notes sync: encrypted with the map key, stored in a private (secret) GitHub Gist you own ----------
const Sync={file:'hcm-notes.enc',t:null,busy:false,last:0,msg:'',
  tok(){try{return localStorage.getItem('hcm-gh')||''}catch(e){return ''}},gid(){try{return localStorage.getItem('hcm-gist')||''}catch(e){return ''}},
  setGid(v){try{localStorage.setItem('hcm-gist',v)}catch(e){}},
  api(path,opt){return fetch('https://api.github.com'+path,Object.assign({},opt,{headers:{Authorization:'Bearer '+this.tok(),Accept:'application/vnd.github+json','Content-Type':'application/json'}})).then(r=>{if(!r.ok)throw new Error('GitHub said '+r.status);return r.json()})},
  async enc(obj){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
    const k=await aesKey(store.get(),salt,100000,['encrypt']);const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode(JSON.stringify(obj)));
    return b64(salt)+'.'+b64(iv)+'.'+b64(ct)},
  async dec(txt){const [s,i,c]=txt.trim().split('.').map(unb64);const k=await aesKey(store.get(),s,100000,['decrypt']);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:i},k,c)))},
  async find(){if(this.gid())return this.gid();
    for(let page=1;page<=5;page++){const gs=await this.api(`/gists?per_page=100&page=${page}`);const g=gs.find(x=>x.files&&x.files[this.file]);if(g){this.setGid(g.id);return g.id}if(gs.length<100)break}
    const g=await this.api('/gists',{method:'POST',body:JSON.stringify({public:false,description:'Hospital condo map notes (encrypted)',files:{[this.file]:{content:await this.enc(NOTES)}}})});this.setGid(g.id);return g.id},
  merge(remote){let changed=false;Object.entries(remote||{}).forEach(([k,v])=>{const l=NOTES[k];if(!l||(v.u||0)>(l.u||0)){NOTES[k]=v;changed=true}});return changed},
  async run(push){if(!this.tok()||this.busy)return;this.busy=true;this.show('Syncing…');
    try{const id=await this.find();const g=await this.api('/gists/'+id);const f=g.files[this.file];
      let txt=f?f.content:'';if(f&&f.truncated)txt=await (await fetch(f.raw_url)).text();
      const changed=txt?this.merge(await this.dec(txt)):false;
      if(changed){try{localStorage.setItem(NKEY,JSON.stringify(NOTES))}catch(e){}P.layers.cand.forEach(styleCand);if(cur&&cur._l.k==='cand'&&H.state.view==='priv')openCard(cur,{keep:true,quiet:true});else if(changed)rerender()}
      if(push||!txt||changed){await this.api('/gists/'+id,{method:'PATCH',body:JSON.stringify({files:{[this.file]:{content:await this.enc(NOTES)}}})})}
      this.last=Date.now();this.show('Synced '+new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))}
    catch(e){console.error(e);this.show('Sync failed: '+e.message+'. Check the token (it needs the gist scope).')}
    this.busy=false},
  later(){if(!this.tok())return;clearTimeout(this.t);this.t=setTimeout(()=>this.run(true),2000)},
  show(m){this.msg=m;const e=$('#p-sync-msg');if(e)e.textContent=m}};

// ---------- setup ----------
function start(data){P=data;
  const {map,esc}=H;
  map.createPane('priv').style.zIndex=425;map.createPane('ctx').style.zIndex=424;
  rPriv=L.svg({pane:'priv',padding:.3});          // SVG, not canvas: shapes take clicks without blocking the layers underneath
  rCtx=L.svg({pane:'ctx',padding:.3});
  const css=document.createElement('style');css.textContent=CSS;document.head.append(css);
  document.body.classList.add('deal-on');
  loadR();loadN();
  const o=R.opts;
  const box=document.createElement('div');box.className='controls priv';
  box.innerHTML=`<div class="priv-box"><b>Deal mode</b><span>Data ${esc(P.built)} · <button class="back" id="p-sync-b">Sync</button> · <button class="back" id="p-lock">Lock</button></span></div>
   <div class="psync" id="p-sync" hidden><p class="priv-note" style="margin:0 0 6px">Your status and notes can follow you between computers and your phone. They are locked with your map key and saved to a private Gist in your GitHub account. On github.com, create a fine-grained or classic token with only the <b>gist</b> permission, then paste it here once on each device.</p>
     <div class="priv-row"><input type="password" id="p-tok" placeholder="GitHub token (gist only)" autocomplete="off" style="flex:1"><button class="back" id="p-tok-save">Save and sync</button><button class="back" id="p-tok-del">Forget</button></div><p class="priv-note" id="p-sync-msg"></p></div>
   <nav class="psteps" aria-label="Steps"><button data-step="areas">1 · Areas</button><button data-step="bldgs">2 · Buildings</button><button data-step="card" disabled>3 · Brief</button></nav>
   <div class="pctl">
    <label>Radius <input type="range" id="p-rad" min="0.5" max="${P.maxMi||3}" step="0.25" value="${o.radius}"><b id="p-rad-v"></b></label>
    <label>Sales lookback <input type="range" id="p-look" min="1" max="10" step="1" value="${o.lookback}"><b id="p-look-v"></b></label>
    <label class="psize">Size <input type="number" id="p-smin" step="500" value="${o.sizeMin}"> to <input type="number" id="p-smax" step="500" value="${o.sizeMax}"> SF</label>
    <div class="pbuy" role="group" aria-label="Buyers">Buyers <label class="chip"><input type="checkbox" data-b="ph"${R.buyers.ph?' checked':''}>Physicians</label><label class="chip"><input type="checkbox" data-b="dn"${R.buyers.dn?' checked':''}>Dentists</label><label class="chip"><input type="checkbox" data-b="ot"${R.buyers.ot?' checked':''}>Therapy and other</label></div>
   </div>
   <div class="ctl-row" role="group" aria-label="Show on map">${LAYERS.filter(l=>l.core&&P.layers[l.k]).map(chip).join('')}</div>
   ${settingsHTML()}
   <details class="more" id="p-moredata"><summary>More data</summary><div class="ctl-row" role="group" aria-label="More layers">${LAYERS.filter(l=>!l.core&&P.layers[l.k]).map(chip).join('')}</div>
    <div class="priv-row" style="margin-top:6px"><button class="back" id="p-sheet">Ring and comp tables</button><button class="back" id="p-csv">Export my marked buildings (CSV)</button></div></details>`;
  function chip(l){return `<label class="chip"><input type="checkbox" data-l="${l.k}"${l.on?' checked':''}><i class="dot" style="background:${l.color}"></i>${esc(l.label)}</label>`}
  const pub=$('.controls');pub.before(box);
  const md=box.querySelector('#p-moredata'),disp=document.createElement('details');disp.className='more';disp.innerHTML='<summary>Map display options (public condo layer, parcels, streets)</summary>';
  md.append(disp);disp.append(pub);
  $('#p-lock').addEventListener('click',()=>{store.del();location.reload()});
  $('#p-sync-b').addEventListener('click',()=>{const s=$('#p-sync');s.hidden=!s.hidden;if(!s.hidden){$('#p-tok').value=Sync.tok()?'••••••••':'';Sync.show(Sync.msg||(Sync.tok()?'Connected.':'Not connected.'))}});
  $('#p-tok-save').addEventListener('click',()=>{const v=$('#p-tok').value.trim();if(v&&!/^•+$/.test(v)){try{localStorage.setItem('hcm-gh',v)}catch(e){}}Sync.run(true)});
  $('#p-tok-del').addEventListener('click',()=>{try{localStorage.removeItem('hcm-gh');localStorage.removeItem('hcm-gist')}catch(e){}$('#p-tok').value='';Sync.show('Token removed from this browser. Your notes stay here and in the Gist.')});
  LAYERS.forEach(l=>{const rows=P.layers[l.k];if(!rows)return;
    l.group=L.layerGroup();
    l.marks=rows.map(it=>{const r=l.k==='cand'?Math.max(4,Math.min(11,3+Math.sqrt((it.f['Bldg SF']||0)/1500))):l.k==='cprj'?7:5;
      const m=L.circleMarker([it.lat,it.lon],{renderer:rPriv,pane:'priv',radius:r,color:'#fff',weight:1.2,fillColor:l.color,fillOpacity:.92});
      m._it=it;m._l=l;m._r=r;it._m=m;it._l=l;
      m.bindTooltip(()=>tip(l,it),{className:'tip',direction:'top',offset:[0,-6]});
      m.on('click',ev=>{L.DomEvent.stop(ev);open(it,{from:'map'})});return m});
    if(l.on)l.group.addTo(map)});
  // hand each layer to map_tools.js so it can be styled, filtered and shown in the data table
  const reg=()=>LAYERS.forEach(l=>{if(!P.layers[l.k])return;H.registerLayer({id:l.k,label:l.label,color:l.color,
    features:P.layers[l.k].map(it=>({raw:it,props:it.f,lat:it.lat,lon:it.lon})),
    isOn:()=>map.hasLayer(l.group),
    apply:()=>refreshAll(true),restyle:sizeDots,open:it=>open(it,{fly:true})})});
  if(H.registerLayer)reg();else window.addEventListener('mt-ready',reg,{once:true});
  box.querySelectorAll('#p-rank input').forEach(inp=>inp.addEventListener('input',()=>{const v=parseFloat(inp.value);if(isFinite(v)){R[inp.dataset.g][inp.dataset.k]=v;rerank()}}));
  $('#p-reset').addEventListener('click',()=>{try{localStorage.removeItem(RKEY)}catch(e){}loadR();box.querySelectorAll('#p-rank input').forEach(inp=>inp.value=R[inp.dataset.g][inp.dataset.k]);syncCtl();rerank()});
  box.querySelectorAll('[data-l]').forEach(c=>c.addEventListener('change',()=>{const l=LAYERS.find(x=>x.k===c.dataset.l);c.checked?l.group.addTo(map):map.removeLayer(l.group)}));
  const rad=$('#p-rad'),look=$('#p-look');
  rad.addEventListener('input',()=>{R.opts.radius=+rad.value;syncCtl();rerank()});
  look.addEventListener('input',()=>{R.opts.lookback=+look.value;syncCtl();rerank()});
  [['p-smin','sizeMin'],['p-smax','sizeMax']].forEach(([id,k])=>$('#'+id).addEventListener('change',e=>{const v=parseFloat(e.target.value);if(isFinite(v)){R.opts[k]=v;rerank()}}));
  box.querySelectorAll('[data-b]').forEach(c=>c.addEventListener('change',()=>{R.buyers[c.dataset.b]=c.checked?1:0;rerank()}));
  box.querySelectorAll('[data-step]').forEach(b=>b.addEventListener('click',()=>{const s=b.dataset.step;if(s==='areas')renderAreas();else if(s==='bldgs')renderBldgs(nav.area??-1)}));
  $('#p-sheet').addEventListener('click',openSheet);$('#p-csv').addEventListener('click',exportCSV);
  document.addEventListener('keydown',onKey);
  H.searchProviders=H.searchProviders||[];
  H.searchProviders.push(q=>{const n=q.toUpperCase().trim();if(n.length<3)return [];const out=[];
    for(const l of LAYERS)for(const it of P.layers[l.k]||[]){if(out.length>=8)break;const f=it.f;
      const hay=[f['Address'],f['Owner'],f['Owner 2'],f['Property Name'],f['CoStar True Owner'],f['CoStar Name'],f['Borrower'],f['Borrower Address'],f['Project'],f['Property Address'],f['Largest Independent Owner']].filter(Boolean).join(' ').toUpperCase();
      if(hay.includes(n))out.push({kind:l.label+(l.k==='cand'?` · grade ${it._g}`:''),label:l.name(f),sub:l.sub(f),lat:it.lat,lon:it.lon,go:()=>open(it,{fly:true})})}
    P.areas.forEach((a,i)=>{if(out.length<8&&(a.n+' '+a.short).toUpperCase().includes(n))out.unshift({kind:'Area',label:a.n,sub:a.short,lat:a.pts[0][0],lon:a.pts[0][1],go:()=>renderBldgs(i,true)})});
    return out});
  // the public page renders its own panels into #view; in deal mode those become the matching deal step
  new MutationObserver(onPublicView).observe($('#view'),{childList:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-Sync.last>60000)Sync.run(false)});
  syncCtl();rescore();computeStats();drawAreas();renderAreas();sizeDots();map.on('zoomend',sizeDots);
  Sync.run(false);
}
function syncCtl(){const o=R.opts;$('#p-rad').value=o.radius;$('#p-look').value=o.lookback;$('#p-smin').value=o.sizeMin;$('#p-smax').value=o.sizeMax;
  $('#p-rad-v').textContent=`${o.radius} mi`;$('#p-look-v').textContent=`${o.lookback} yr${o.lookback>1?'s':''}`;
  document.querySelectorAll('[data-b]').forEach(c=>c.checked=!!R.buyers[c.dataset.b])}
function onPublicView(){const st=H.state;if(!P||st.view==='priv')return;
  if(st.view==='overview'){renderAreas();return}
  if(st.view==='hosp'){const hn=H.D.hospitals[st.hosp].n;const a=P.areas.findIndex(x=>x.hosp.includes(hn));renderBldgs(a,false)}}
function refreshAll(){rescore();computeStats();drawAreas();rerender()}
function rerender(){if(!P)return;if(nav.v==='areas')renderAreas(true);else if(nav.v==='bldgs')renderBldgs(nav.area,false,true);else{applyScope();if(cur&&H.state.view==='priv')openCard(cur,{keep:true,quiet:true})}}

// ---------- areas: where to hunt ----------
const dIn=(it,a)=>{if(!it.ad)return null;for(const x of it.ad)if(x[0]===a)return x[1];return null};
function inArea(it,a){const r=R.opts.radius;if(!it.ad)return true;if(a<0)return it.ad.some(x=>x[1]<=r);const d=dIn(it,a);return d!=null&&d<=r}
function cutoff(){const d=new Date();d.setFullYear(d.getFullYear()-R.opts.lookback);return d.toISOString().slice(0,10)}
function bmask(){return (R.buyers.ph?1:0)|(R.buyers.dn?2:0)|(R.buyers.ot?4:0)}
function computeStats(){const r=R.opts.radius,cut=cutoff(),mask=bmask(),A=P.areas.length;
  stats=P.areas.map((a,i)=>({i,prac:0,sup:0,deeds:0,comps:0,sba:0,list:0,proj:0,bulk:0,g:{A:0,B:0,C:0},n:0}));
  P.pl.forEach(([m,ad])=>{if(!(m&mask))return;ad.forEach(([a,d])=>{if(d<=r)stats[a].prac++})});
  (P.layers.cprj||[]).forEach(c=>c.ad.forEach(([a,d])=>{if(d>r)return;const s=stats[a];s.sup+=c.f['Independent Medical Suites']||0;s.proj++;if(c.f['Bulk Buy']!=='No')s.bulk++;s.deeds+=c.dd.filter(x=>x>=cut).length}));
  (P.layers.condo||[]).forEach(c=>{if(c.f['Sale Status']!=='Sold'||!(c.f['Sale Date']>=cut))return;c.ad.forEach(([a,d])=>{if(d<=r)stats[a].comps++})});
  (P.layers.buys||[]).forEach(c=>{if(!((c.f['DCAD Deed Date']||c.f['Loan Date'])>=cut))return;c.ad.forEach(([a,d])=>{if(d<=r)stats[a].sba++})});
  (P.layers.list||[]).forEach(c=>c.ad.forEach(([a,d])=>{if(d<=r)stats[a].list++}));
  P.layers.cand.forEach(it=>{if(!passes(it,true))return;it.ad.forEach(([a,d])=>{if(d<=r){stats[a].n++;stats[a].g[it._g]++}})});
  stats.forEach(s=>s.ratio=s.prac/Math.max(1,s.sup));
  const w=norm('area'),pr=(k,v)=>{const xs=stats.map(s=>s[k]);const lt=xs.filter(x=>x<v).length,eq=xs.filter(x=>x===v).length;return A>1?(lt+(eq-1)/2)/(A-1):1};
  stats.forEach(s=>{s.score=Math.round(100*(w.ratio*pr('ratio',s.ratio)+w.deeds*pr('deeds',s.deeds)+w.comps*pr('comps',s.comps)+w.sba*pr('sba',s.sba)));
    s.grade=s.score>=R.opts.areaA?'A':s.score>=R.opts.areaB?'B':'C'})}
function drawAreas(){const {map,ringLayers,D,esc,MI}=H;const r=R.opts.radius;
  ringLayers.forEach(c=>c.setRadius(r*MI));
  if(areaLabels)map.removeLayer(areaLabels);areaLabels=L.layerGroup().addTo(map);
  P.areas.forEach((a,i)=>{const s=stats[i],lat=Math.max(...a.pts.map(p=>p[0]));
    // the hospital names are already on the map; merged areas also get their area name
    const m=L.marker([lat,a.pts[0][1]],{pane:'priv',icon:L.divIcon({className:'alab',html:`<span class="ag" style="background:${ACOL[s.grade]}" title="Area grade">${s.grade}</span>${a.hosp.length>1?esc(a.n):''}`,iconSize:null}),keyboard:false});
    m.on('click',()=>renderBldgs(i,true));areaLabels.addLayer(m)})}
function goStep(s){$$('.psteps [data-step]').forEach(b=>{b.classList.toggle('on',b.dataset.step===s);if(b.dataset.step==='card')b.disabled=!cur})}
function areaWhy(s){return `${plural(s.prac,'practice location')} · ${plural(s.sup,'independent medical suite')} (${s.sup?num(Math.round(s.ratio))+' practices per suite':'no independent medical suites'})`}
function salesWhy(s){return `Last ${plural(R.opts.lookback,'year')}: ${plural(s.deeds,'suite deed')} (DCAD), ${plural(s.comps,'condo sale')} (CoStar), ${plural(s.sba,'SBA suite purchase')}`}
function renderAreas(keepMap){const {esc}=H;nav={v:'areas'};cur=null;clearCard();H.state.view='priv';
  const order=stats.slice().sort((a,b)=>asort==='prac'?b.prac-a.prac:asort==='ratio'?b.ratio-a.ratio:asort==='sales'?(b.deeds+b.comps+b.sba)-(a.deeds+a.comps+a.sba):asort==='bldg'?(b.g.A*1000+b.g.B)-(a.g.A*1000+a.g.B):b.score-a.score);
  $('#view').innerHTML=`<div class="phead2"><div class="eyebrow">Step 1 of 3</div><h2>Where to hunt</h2>
    <p class="sub">${P.areas.length} hospital areas within ${R.opts.radius} mi. Graded on practices per independent medical condo suite and proof that suites sell. Overlapping hospitals are merged into one area.</p></div>
   <div class="priv-row" style="margin-top:8px"><span>Sort</span><select id="p-asort"><option value="score">Area grade</option><option value="ratio">Practices per suite</option><option value="prac">Practices</option><option value="sales">Sales proof</option><option value="bldg">A and B buildings</option></select>
    <button class="back" id="p-board">Full scoreboard</button><button class="back" id="p-allb">Best buildings in all areas</button></div>
   <div class="alist">${order.map(s=>{const a=P.areas[s.i];return `<button class="arow" data-a="${s.i}"><span class="ag big" style="background:${ACOL[s.grade]}">${s.grade}</span>
     <span class="atx"><b>${esc(a.n)}</b>${a.hosp.length>1?`<small>${esc(a.short)}</small>`:''}<span>${areaWhy(s)}</span><span>${salesWhy(s)}</span>
     <span>Buildings that pass your screens: <b class="gA">${s.g.A} A</b> · <b class="gB">${s.g.B} B</b> · ${s.g.C} C${s.list?` · ${plural(s.list,'property','properties')} for sale`:''}${s.bulk?` · ${plural(s.bulk,'condo project')} with a bulk-buy owner`:''}</span></span><em>${s.score}</em></button>`}).join('')}</div>
   <p class="note" style="margin-top:12px">Practice locations = separate doctor, dentist or therapy offices (building + suite) in buildings not owned by a hospital, CMS NPI Registry ${esc(P.npiAsOf||'')}. Suites and deeds: DCAD 2026 roll. Condo sales: CoStar 11/3/2026. SBA: 9/30/2026. Area score = percentile among the ${P.areas.length} areas, weighted in Grading settings. Medical-adjacent buyers (labs, imaging, med spas) are not in the NPI data yet.</p>`;
  $('#p-asort').value=asort;$('#p-asort').addEventListener('change',e=>{asort=e.target.value;renderAreas(true)});
  $('#p-board').addEventListener('click',openBoard);$('#p-allb').addEventListener('click',()=>renderBldgs(-1,true));
  $$('.arow').forEach(b=>b.addEventListener('click',()=>renderBldgs(+b.dataset.a,true)));
  applyScope();goStep('areas');
  if(!keepMap)fitAreas(-1)}
function fitAreas(a){const {map,MI}=H;const pts=(a<0?P.areas:[P.areas[a]]).flatMap(x=>x.pts);
  const b=L.latLngBounds(pts.map(p=>L.latLng(p[0],p[1]).toBounds(2*R.opts.radius*MI)).flatMap(x=>[x.getSouthWest(),x.getNorthEast()]));
  map.flyToBounds(b,{duration:.6,padding:[10,10]})}
function openBoard(){const {esc}=H;const s=$('#sheet');
  const cols=[['Area',s=>esc(P.areas[s.i].n)],['Grade',s=>s.grade],['Score',s=>s.score],['Practices',s=>num(s.prac)],['Indep. medical suites',s=>num(s.sup)],['Practices per suite',s=>s.sup?num(Math.round(s.ratio)):'no suites'],
    ['Suite deeds',s=>s.deeds],['Condo sales (CoStar)',s=>s.comps],['SBA suite purchases',s=>s.sba],['For sale (CoStar)',s=>s.list],['A buildings',s=>s.g.A],['B buildings',s=>s.g.B],['C buildings',s=>s.g.C],['Hospitals',s=>esc(P.areas[s.i].short)]];
  $('#sheetIn').innerHTML=`<div class="sheet-head"><div><div class="eyebrow">Deal mode · ${R.opts.radius} mi radius · ${R.opts.lookback}-year lookback</div><h2 id="sheetTitle">Area scoreboard</h2><p class="sub">One row per hospital area. Click a row to open its buildings.</p></div><button class="x" id="closeSheet">Close</button></div>
   <div class="tbl-wrap"><table class="ntbl"><thead><tr>${cols.map(c=>`<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${stats.slice().sort((a,b)=>b.score-a.score).map(x=>`<tr data-a="${x.i}">${cols.map((c,j)=>`<td${j?' class="n"':''}>${c[1](x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
   <p class="sub" style="margin-top:10px">Sources: CMS NPI Registry ${esc(P.npiAsOf||'')}; DCAD 2026 roll; CoStar 11/3/2026; SBA FOIA 9/30/2026. Areas overlap at larger radii, so columns do not add up.</p>`;
  s.hidden=false;$('#closeSheet').addEventListener('click',()=>{s.hidden=true});
  $$('#sheetIn tr[data-a]').forEach(tr=>tr.addEventListener('click',()=>{s.hidden=true;renderBldgs(+tr.dataset.a,true)}))}

// ---------- buildings: what to buy there ----------
function screens(it){const o=R.opts,s=it.s;return s.sf>=o.sizeMin&&s.sf<=o.sizeMax&&(!(s.st>0)||s.st<=o.maxStories)&&!(o.noRetail&&s.use==='Retail')}
function passes(it,ignoreChips){const st=stat(it);
  if(!screens(it))return false;
  if(!ignoreChips){if(filt.status==='active'&&st==='pass')return false;if(filt.status==='short'&&st!=='short')return false;if(filt.status==='any'&&!st&&!note(it).n)return false;
    if(filt.listed&&!it.s.sale)return false;if(filt.med&&it.s.use!=='Medical office')return false;if(filt.chg&&!(it.fl&&it.fl.length))return false}
  return mtp('cand',it)}
function renderBldgs(a,fly,keep){const {esc}=H;nav={v:'bldgs',area:a};cur=null;clearCard();H.state.view='priv';
  list=P.layers.cand.filter(it=>inArea(it,a)&&passes(it)).sort((x,y)=>y._sc-x._sc||(dIn(x,a)??9)-(dIn(y,a)??9));
  if(!keep)shown=R.opts.top;
  const s=a>=0?stats[a]:null,ar=a>=0?P.areas[a]:null,cnt={A:0,B:0,C:0};list.forEach(it=>cnt[it._g]++);
  $('#view').innerHTML=`<div class="pnav"><button class="back" id="bk">← All areas</button></div>
   <div class="phead2"><div class="eyebrow">Step 2 of 3 · within ${R.opts.radius} mi</div>
    <h2>${s?`<span class="ag big" style="background:${ACOL[s.grade]}">${s.grade}</span> `:''}${esc(ar?ar.n:'All areas')}</h2>${ar&&ar.hosp.length>1?`<p class="sub">${esc(ar.short)}</p>`:''}
    ${s?`<p class="sub">${areaWhy(s)}.<br>${salesWhy(s)}.</p>`:''}</div>
   <div class="priv-row" style="margin-top:8px"><select id="p-status" aria-label="Status"><option value="active">Hide passed</option><option value="all">All statuses</option><option value="short">Shortlist only</option><option value="any">Anything I've marked</option></select>
    <label class="chip"><input type="checkbox" id="p-listed"${filt.listed?' checked':''}>Listed for sale</label><label class="chip"><input type="checkbox" id="p-med"${filt.med?' checked':''}>Medical office</label><label class="chip"><input type="checkbox" id="p-chg"${filt.chg?' checked':''}>Changed since last refresh</label></div>
   <div class="priv-row legend2">${['A','B','C'].map(g=>`<span><i class="dot" style="background:${GCOL[g]}"></i>${g} · ${cnt[g]}</span>`).join('')}${STATUS.slice(1,4).map(x=>`<span><i class="dot" style="background:transparent;border:2px solid ${x[2]}"></i>${x[1]}</span>`).join('')}</div>
   <div class="list priv-rank"><div class="list-head"><span>Best ${Math.min(shown,list.length)} of ${num(list.length)} buildings</span><span>Grade</span></div>
   ${list.length?'':'<p class="priv-note">No buildings pass your screens here. Try a wider radius or size range.</p>'}
   ${list.slice(0,shown).map((it,i)=>{const x=STATUS.find(y=>y[0]===stat(it));const d=a>=0?dIn(it,a):Math.min(...it.ad.map(z=>z[1]));
     return `<button class="row prow" data-r="${i}"><span class="row-name">${esc(it.f['Address'])}<small> ${esc(it.f['City'])} · ${d.toFixed(2)} mi</small>${x&&x[0]?`<em class="spill" style="border-color:${x[2]};color:${x[2]}">${x[1]}</em>`:''}${(it.fl||[]).map(fl=>`<em class="spill chg">${esc(fl)}</em>`).join('')}</span><span class="row-num"><span class="gbadge" style="background:${GCOL[it._g]}">${it._g}</span><small>${it._sc}</small></span><span class="row-meta">${chips(it.f,4)}</span></button>`}).join('')}
   ${list.length>shown?`<button class="back" id="p-more" style="margin:8px 0">Show ${R.opts.top} more</button>`:''}</div>`;
  $('#bk').addEventListener('click',()=>renderAreas());
  $('#p-status').value=filt.status;$('#p-status').addEventListener('change',e=>{filt.status=e.target.value;renderBldgs(a,false)});
  [['p-listed','listed'],['p-med','med'],['p-chg','chg']].forEach(([id,k])=>$('#'+id).addEventListener('change',e=>{filt[k]=e.target.checked;renderBldgs(a,false)}));
  $$('[data-r]').forEach(bt=>bt.addEventListener('click',()=>open(list[+bt.dataset.r],{fly:true})));
  const more=$('#p-more');if(more)more.addEventListener('click',()=>{shown+=R.opts.top;renderBldgs(a,false,true)});
  applyScope();goStep('bldgs');if(fly)fitAreas(a)}
function chips(f,n){return String(f['Why']||'').split(' · ').slice(0,n).map(c=>`<span class="pchip">${H.esc(c)}</span>`).join('')}

// ---------- map: what is drawn follows the step you are on ----------
const mt=(k,it)=>H.mtStyle?H.mtStyle(k,it):null;
const mtp=(k,it)=>!H.mtPass||H.mtPass(k,it);
function applyScope(){const a=nav.v==='bldgs'?nav.area:nav.v==='card'&&nav.area!=null?nav.area:-1;
  LAYERS.forEach(l=>{if(!l.group)return;l.group.clearLayers();
    const keep=l.k==='cand'?(nav.v==='bldgs'||nav.v==='card'?list:P.layers.cand.filter(it=>inArea(it,-1)&&passes(it))):P.layers[l.k].filter(it=>inArea(it,a)&&mtp(l.k,it));
    keep.forEach(it=>it._m&&l.group.addLayer(it._m))});
  sizeDots()}
function tip(l,it){const {esc}=H,f=it.f;
  if(l.k!=='cand')return `<b>${esc(l.name(f))}</b><br>${esc(l.sub(f))}`;
  const s=STATUS.find(x=>x[0]===stat(it));
  return `<b>Grade ${it._g} · ${esc(f['Address'])}</b><br>Score ${it._sc} · ${esc(f['Use'])} · ${num(f['Bldg SF'])} SF${s&&s[0]?` · <span style="color:${s[2]}">${s[1]}</span>`:''}`}
function styleCand(it){const m=it._m;if(!m)return;const s=stat(it),z=H.map.getZoom(),o=mt('cand',it)||{};
  m.setStyle({fillColor:o.fill||GCOL[it._g]||'#94a3b8',color:s?SCOL[s]:'#fff',weight:s?(z<12?2:3):(z<12?.6:1.2),fillOpacity:(s==='pass'?.3:.92)*(o.op??1),opacity:o.op??1})}
function sizeDots(){const z=H.map.getZoom();LAYERS.forEach(l=>(l.marks||[]).forEach(m=>{
  const it=m._it,lo=z<12,mid=z<13.5,o=mt(l.k,it)||{};
  const r=l.k!=='cand'?(lo?3:mid?4:m._r):lo?(it._g==='A'?5:it._g==='B'?3.5:2.2):mid?Math.max(3.5,m._r*.7):m._r;
  m.setRadius(o.r!=null?o.r*(lo?.6:mid?.8:1):r);
  if(l.k==='cprj'){const bulk=it.f['Bulk Buy']!=='No';m.setStyle({fillColor:o.fill||l.color,fillOpacity:.92*(o.op??1),opacity:o.op??1,color:bulk?'#111':'#fff',weight:bulk?3:1.2,dashArray:bulk?'3 2':null})}
  else if(l.k!=='cand')m.setStyle({fillColor:o.fill||l.color,fillOpacity:.92*(o.op??1),opacity:o.op??1})}));P.layers.cand.forEach(styleCand)}

// ---------- the building card ----------
function clearCard(){const {map}=H;if(sel){map.removeLayer(sel);sel=null}if(ctx){map.removeLayer(ctx);ctx=null}}
function open(it,o){if(it._l.k==='cand')openCard(it,o);else openOther(it,o)}
function prep(it,o){const {map}=H;o=o||{};
  if(!o.keep){if(nav.v!=='card')nav={v:'card',back:nav,area:nav.v==='bldgs'?nav.area:nav.area??null};}
  cur=it;H.clearSel();clearCard();H.state.view='priv';
  if(it.g)sel=L.polygon(it.g.map(H.decode),{renderer:rPriv,pane:'priv',color:'#fff',weight:3,dashArray:'4 3',fill:false,interactive:false}).addTo(map);
  ctx=L.layerGroup().addTo(map);
  ctx.addLayer(L.circleMarker([it.lat,it.lon],{renderer:rCtx,pane:'ctx',radius:16,color:'#fff',weight:2,fill:false,interactive:false}));
  if(o.fly)map.flyTo([it.lat,it.lon],Math.max(map.getZoom(),16.5),{duration:.6});
  else if(!o.quiet&&!map.getBounds().pad(-.15).contains([it.lat,it.lon]))map.panTo([it.lat,it.lon])}
function openCard(it,o){prep(it,o);$('#view').innerHTML=candCard(it);wire(it);goStep('card');if(!(o&&o.quiet)){$('#view').scrollIntoView({block:'start'})}}
function openOther(it,o){prep(it,o);$('#view').innerHTML=otherCard(it);wire(it);goStep('card')}
function back(){const b=nav.back;clearCard();cur=null;if(!b||b.v==='areas')renderAreas(true);else renderBldgs(b.area,false,true)}
function step(d){if(!cur||cur._l.k!=='cand')return;const i=list.indexOf(cur);if(i<0)return;const n=list[i+d];if(n)openCard(n,{fly:true,keep:true})}
function onKey(e){if(H.state.view!=='priv'||nav.v!=='card'||/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))return;
  if(e.key==='ArrowRight'||e.key==='j'){step(1);e.preventDefault()}else if(e.key==='ArrowLeft'||e.key==='k'){step(-1);e.preventDefault()}else if(e.key==='Escape')back()}

const link=(href,txt)=>`<a class="plink" href="${href}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
function links(it){const f=it.f,a=encodeURIComponent(`${f['Address']||f['Borrower Address']||f['Property Address']||''}, ${f['City']||''}, TX`);
  return `<div class="plinks">${it._l.k==='cand'?'<button class="plink brief" id="p-brief">One-page brief</button>':''}${link(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${it.lat},${it.lon}`,'Street View')}${link(`https://www.google.com/maps/search/?api=1&query=${a}`,'Google Maps')}${f['DCAD Account']?link(`https://www.dallascad.org/AcctDetailCom.aspx?ID=${encodeURIComponent(f['DCAD Account'])}`,'DCAD record'):''}${f['CoStar ID']||f['PropertyID']?link(`https://product.costar.com/detail/all-properties/${encodeURIComponent(f['CoStar ID']||f['PropertyID'])}/summary`,'CoStar'):''}<button class="plink" data-copy="${H.esc(decodeURIComponent(a))}">Copy address</button></div>`}
function kv(rows){const {esc}=H;return rows.filter(r=>r[1]!==''&&r[1]!=null&&r[1]!=='$0').map(([k,v,full])=>`<div${full||String(v).length>24?' class="full"':''}><dt>${esc(k)}</dt><dd class="txt">${esc(v)}</dd></div>`).join('')}
function bar(label,v,col){return `<div class="pbar"><span>${label}</span><i><b style="width:${v}%;background:${col}"></b></i><em>${v}</em></div>`}
const near=(a,b)=>H.map.distance([a.lat,a.lon],[b.lat,b.lon]);
function nearby(it,k,maxMi,n,pred){const l=LAYERS.find(x=>x.k===k);if(!P.layers[k])return [];
  return P.layers[k].filter(x=>x!==it&&(!pred||pred(x))).map(x=>({x,d:near(it,x)/H.MI})).filter(o=>o.d<=maxMi).sort((a,b)=>a.d-b.d).slice(0,n).map(o=>Object.assign(o,{l}))}
function nearList(title,rows,empty){const {esc}=H;
  return `<h5>${title}</h5>${rows.length?rows.map(o=>`<button class="nrow" data-n="${o.l.k}:${P.layers[o.l.k].indexOf(o.x)}"><i class="dot" style="background:${o.l.k==='cand'?GCOL[o.x._g]:o.l.color}"></i><span><b>${esc(o.l.name(o.x.f))}</b><small>${esc(o.l.sub(o.x.f))}</small></span><em>${o.d.toFixed(2)} mi</em></button>`).join(''):`<p class="priv-note">${empty}</p>`}`}
function evidence(it){const cut=cutoff();return {
  sales:nearby(it,'condo',1.5,5),buys:nearby(it,'buys',3,3),list:nearby(it,'list',1,4),proj:nearby(it,'cprj',1.5,4),
  loans:nearby(it,'loans',1,4),bldg:nearby(it,'bldg',1,3),cands:nearby(it,'cand',.5,4,x=>passes(x,true)),cut}}
function areaOf(it){const r=R.opts.radius;const x=(it.ad||[]).filter(z=>z[1]<=r).sort((a,b)=>a[1]-b[1])[0];return x?{a:x[0],d:x[1]}:null}
function taxTxt(f){const t=f['DCAD Value Change vs Prior Yr (%)'];return t==null?'':`${t>0?'+':''}${t}% vs prior year (${money(f['DCAD Prior Yr Market Value'])} to ${money(f['DCAD Value'])})`}
function candCard(it){const {esc}=H,f=it.f,p=it._p,i=list.indexOf(it),s=stat(it),nt=note(it),ao=areaOf(it),ev=evidence(it),ws=norm('parts');
  [...ev.sales,...ev.buys,...ev.list,...ev.proj].forEach(o=>ctx.addLayer(L.circleMarker([o.x.lat,o.x.lon],{renderer:rCtx,pane:'ctx',radius:9,color:o.l.color,weight:2,fill:false,interactive:false})));
  ctx.addLayer(L.circle([it.lat,it.lon],{renderer:rCtx,pane:'ctx',radius:H.MI/2,color:'#fff',weight:1,dashArray:'3 5',fill:false,interactive:false}));
  const leased=f['CoStar % Leased'],cs=f['CoStar vs DCAD Size']==='OK',as=ao?stats[ao.a]:null;
  const flags=[it.s.sale?'Listed for sale':'',...(it.fl||[])].filter(Boolean);
  return `<div class="pnav"><button class="back" id="bk">← Back</button>${i>=0?`<span><button class="back" id="p-prev" ${i<1?'disabled':''}>‹ Prev</button> ${i+1} of ${list.length} <button class="back" id="p-next" ${i>=list.length-1?'disabled':''}>Next ›</button></span>`:''}</div>
   <div class="phead"><div><div class="eyebrow">Step 3 of 3 · ${ao?`${esc(P.areas[ao.a].n)} · ${ao.d.toFixed(2)} mi`:esc(f['Nearest Hospital'])}</div>
    <h2>${esc(f['Address'])}</h2><p class="sub">${esc([f['Property Name'],f['City']].filter(Boolean).join(' · '))}</p></div>
    <div class="pscore" style="border-color:${GCOL[it._g]}"><b>${it._g}</b><span>score ${it._sc}</span></div></div>
   ${flags.length?`<div class="pflags">${flags.map(x=>`<span class="pflag">${esc(x)}</span>`).join('')}</div>`:''}
   <div class="pbars">${bar('Owner likely to sell',Math.round(100*p.own),'#f472b6')}${bar('Building fit',Math.round(100*p.fit),'#a3e635')}${ws.dem>0?bar('Demand around it',Math.round(100*p.dem),'#38bdf8'):''}</div>
   <div class="pchips">${chips(f,14)}</div>
   <div class="pstat" role="group" aria-label="Status">${STATUS.map(x=>`<button data-s="${x[0]}" aria-pressed="${s===x[0]}" style="${s===x[0]&&x[0]?`background:${x[2]};border-color:${x[2]};color:#111`:''}">${x[1]}</button>`).join('')}</div>
   <textarea id="p-note" rows="2" placeholder="Notes (saved in this browser${Sync.tok()?' and synced':''})">${esc(nt.n||'')}</textarea>${nt.t?`<p class="priv-note" style="margin:2px 0 0">Last updated ${esc(nt.t)}</p>`:''}
   ${links(it)}
   <dl class="facts"><h5>Fit for conversion</h5>${kv([['Size',`${num(f['Bldg SF'])} SF${f['Net Leasable SF']?` (${num(f['Net Leasable SF'])} leasable)`:''}`],['Use',f['Use']],['Stories',f['Stories']],
     ['Practices already inside',f['Practice Locations in Bldg']?`${f['Practice Locations in Bldg']} (${f['Physicians in Bldg']} physicians, ${f['Dentists in Bldg']} dentists, ${f['Other Outpatient in Bldg']} other)`:'none found in NPI'],
     ['Parking',[cs&&f['CoStar Parking Ratio']?`${f['CoStar Parking Ratio']}/1,000 SF per CoStar${f['CoStar Parking Spaces']?` (${f['CoStar Parking Spaces']} spaces)`:''}`:'',
       f['Est. Parking/1,000 (land)']!=null&&f['Est. Parking/1,000 (land)']!==''?`about ${f['Est. Parking/1,000 (land)']}/1,000 SF by DCAD land (${num(f['Open Land per 1,000 SF Bldg'])} SF of open land per 1,000 SF of building)`:''].filter(Boolean).join('; ')||'unknown'],
     ['Zoning (DCAD)',f['Zoning (DCAD)']],
     ['Built',[f['Yr Built'],f['Remodel Yr']?`remodeled ${f['Remodel Yr']}`:''].filter(Boolean).join(', ')],['Leased (CoStar)',cs&&leased!=null&&leased!==''?`${leased}%${f['CoStar Available SF']?`, ${num(f['CoStar Available SF'])} SF available`:''}`:''],
     ['Class',cs?f['CoStar Class']:''],['DCAD condition',[f['DCAD Condition'],f['DCAD Quality']].filter(Boolean).join(' / ')]])}
   <h5>Owner</h5>${kv([['Owner',[f['Owner'],f['Owner 2']].filter(Boolean).join(' / '),1],['Mailing address',f['Owner Mailing Address'],1],['Held',f['Latest Deed']?`${f['Years Held']} years (since ${f['Latest Deed']}, latest DCAD deed or CoStar sale)`:''],
     ['Parcels this owner holds in Dallas County',f["Owner's Parcels in County"]],['Owner-occupied',f['Owner-occupied']],['True owner (CoStar)',cs?f['CoStar True Owner']:'',1],['Owner type',f['Owner Type']]])}
   <h5>Value trend (shown, not scored)</h5>${kv([['DCAD value',taxTxt(f)||money(f['DCAD Value']),1],['For sale (CoStar)',it.s.sale?`Yes${cs&&f['CoStar For Sale $/SF']?`, asking $${num(f['CoStar For Sale $/SF'])}/SF`:''}`:''],['Last sale (CoStar)',cs&&f['CoStar Last Sale Date']?`${f['CoStar Last Sale Date']}${f['CoStar Last Sale Price']?`, ${money(f['CoStar Last Sale Price'])}`:''}`:'']])}
   ${as?`<h5>Area demand · ${esc(P.areas[ao.a].n)} (grade ${as.grade})</h5>${kv([['Within '+R.opts.radius+' mi',areaWhy(as),1],['Sales proof',salesWhy(as),1],['Practices within ½ mile of this building',f['Practices within 1/2 mi']]])}`:''}</dl>
   <div class="pnear">${nearList('Medical condo projects within 1½ miles',ev.proj,'None nearby.')}${nearList('Condo sales within 1½ miles (CoStar)',ev.sales,'None in the CoStar export.')}${nearList('For sale within 1 mile (CoStar)',ev.list,'None marked for sale.')}${nearList('SBA suite purchases within 3 miles',ev.buys,'None found.')}${ev.cands.length?nearList('Other graded buildings within ½ mile',ev.cands,''):''}</div>
   <details class="more pall"><summary>All details</summary><dl class="facts">${allFields(f)}</dl></details>
   <p class="note" style="margin-top:12px">${esc(NOTE.cand)}</p>`}
function otherCard(it){const {esc}=H,l=it._l,f=it.f;
  const nearCand=nearby(it,'cand',1,6,x=>passes(x,true)).sort((a,b)=>b.x._sc-a.x._sc);
  nearCand.forEach(o=>ctx.addLayer(L.circleMarker([o.x.lat,o.x.lon],{renderer:rCtx,pane:'ctx',radius:9,color:'#fff',weight:2,fill:false,interactive:false})));
  const fv=k=>{const v=f[k];if(v==null||v==='')return '';return typeof v==='number'&&/\$|Price|Loan|Cost/.test(k)?money(v):typeof v==='number'&&!/Year|Yr/.test(k)?num(v):String(v)};
  const extra=l.k==='cprj'&&it.dd?`<p class="priv-note">Independent medical suite deeds in the last ${plural(R.opts.lookback,'year')}: ${it.dd.filter(x=>x>=cutoff()).length} of ${it.dd.length}.</p>`:'';
  return `<div class="pnav"><button class="back" id="bk">← Back</button></div>
   <div class="phead"><div><div class="eyebrow">${esc(l.label)}</div><h2>${esc(l.name(f))}</h2><p class="sub">${esc(l.sub(f))}</p></div></div>
   ${links(it)}
   <dl class="facts">${kv((KEY[l.k]||[]).map(k=>[k,fv(k)]))}</dl>${extra}
   <div class="pnear">${nearList('Graded buildings within 1 mile',nearCand,'No graded buildings within a mile.')}</div>
   <details class="more pall"><summary>All details</summary><dl class="facts">${allFields(f)}</dl></details>
   <p class="note" style="margin-top:12px">${esc(NOTE[l.k]||'')}</p>`}
function allFields(f){const fv=(k,v)=>typeof v!=='number'?String(v):/\$|Price|Value|Loan|Cost/.test(k)&&!/Rent|%/.test(k)?money(v):/Yr|Year|ID/.test(k)?String(v):num(v);
  return kv(Object.entries(f).filter(([k,v])=>v!==null&&v!==''&&v!==undefined).map(([k,v])=>[k,fv(k,v)]))}
function wire(it){$('#bk').addEventListener('click',back);
  const pv=$('#p-prev'),nx=$('#p-next');pv&&pv.addEventListener('click',()=>step(-1));nx&&nx.addEventListener('click',()=>step(1));
  $$('.pstat [data-s]').forEach(b=>b.addEventListener('click',()=>{setNote(it,{s:b.dataset.s});openCard(it,{keep:true,quiet:true})}));
  const ta=$('#p-note');let t;ta&&ta.addEventListener('input',()=>{clearTimeout(t);t=setTimeout(()=>setNote(it,{n:ta.value.trim()}),400)});
  $$('.nrow').forEach(b=>b.addEventListener('click',()=>{const [k,i]=b.dataset.n.split(':');const x=P.layers[k][+i];nav.back=nav.back||{v:'areas'};open(x,{keep:true})}));
  $$('[data-copy]').forEach(b=>b.addEventListener('click',()=>{navigator.clipboard&&navigator.clipboard.writeText(b.dataset.copy);b.textContent='Copied'}));
  const br=$('#p-brief');br&&br.addEventListener('click',()=>brief(it))}

// ---------- the one-page brief (Holiner colors; print or save as PDF) ----------
function brief(it){const {esc}=H,f=it.f,p=it._p,ao=areaOf(it),as=ao?stats[ao.a]:null,ev=evidence(it),nt=note(it),st=STATUS.find(x=>x[0]===stat(it));
  const W=900,Hh=380,pr=L.CRS.EPSG3857;const ring=(it.g||[]).map(H.decode);
  const pts=ring.flat().map(ll=>pr.project(L.latLng(ll[0],ll[1])));const c=pr.project(L.latLng(it.lat,it.lon));
  let half=120;pts.forEach(q=>{half=Math.max(half,Math.abs(q.x-c.x)*1.5,Math.abs(q.y-c.y)*1.5*W/Hh)});
  const hy=half*Hh/W,bb=[c.x-half,c.y-hy,c.x+half,c.y+hy];
  const img=`https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export?bbox=${bb.join(',')}&bboxSR=3857&imageSR=3857&size=${W},${Hh}&format=jpg&f=image`;
  const sx=x=>((x-bb[0])/(bb[2]-bb[0])*W).toFixed(1),sy=y=>((bb[3]-y)/(bb[3]-bb[1])*Hh).toFixed(1);
  const poly=ring.map(r=>`<polygon points="${r.map(ll=>{const q=pr.project(L.latLng(ll[0],ll[1]));return sx(q.x)+','+sy(q.y)}).join(' ')}"/>`).join('');
  const row=(k,v)=>v==null||v===''?'':`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  const ul=(rows,empty)=>rows.length?`<ul>${rows.map(o=>`<li><b>${esc(o.l.name(o.x.f))}</b> · ${esc(o.l.sub(o.x.f))} · ${o.d.toFixed(2)} mi</li>`).join('')}</ul>`:`<p class="mut">${empty}</p>`;
  const cs=f['CoStar vs DCAD Size']==='OK';
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>Brief · ${esc(f['Address'])}</title><style>
  @page{size:letter;margin:.45in}*{box-sizing:border-box}body{margin:0;font:11px/1.4 Helvetica,Arial,sans-serif;color:#111;background:#EDECE2}
  .pg{max-width:8in;margin:0 auto;background:#fff;padding:18px 22px}
  .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:4px solid #78A167;padding-bottom:8px}
  .brand{font-weight:700;letter-spacing:.28em;font-size:13px;color:#46683A}.brand small{display:block;letter-spacing:.08em;font-weight:400;color:#7a776c;font-size:9.5px}
  h1{margin:6px 0 0;font-size:20px}.sub{color:#555;margin:2px 0 0}
  .gr{width:62px;height:62px;border-radius:50%;border:4px solid ${GCOL[it._g]};display:grid;place-content:center;text-align:center}
  .gr b{font-size:26px;line-height:1}.gr span{font-size:9px;color:#666}
  .img{position:relative;margin-top:10px;border:1px solid #C9C2B0}.img img{display:block;width:100%}.img svg{position:absolute;inset:0;width:100%;height:100%}
  .img polygon{fill:none;stroke:#fff;stroke-width:3;stroke-dasharray:6 4}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px}
  h3{margin:10px 0 4px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#46683A;border-bottom:1px solid #AFA183;padding-bottom:2px}
  table{width:100%;border-collapse:collapse}th{text-align:left;font-weight:400;color:#666;width:44%;padding:2px 6px 2px 0;vertical-align:top}td{padding:2px 0;vertical-align:top}
  .bars div{display:grid;grid-template-columns:120px 1fr 26px;gap:6px;align-items:center;margin:2px 0}.bars i{height:7px;background:#eee;border-radius:4px;overflow:hidden}.bars i b{display:block;height:100%;background:#78A167}
  .chips span{display:inline-block;border:1px solid #AFA183;border-radius:3px;padding:0 5px;margin:2px 3px 0 0;font-size:10px}
  ul{margin:2px 0 0;padding-left:14px}li{margin:1px 0}.mut{color:#777;margin:2px 0}
  .ft{margin-top:12px;border-top:1px solid #C9C2B0;padding-top:6px;color:#666;font-size:9px}
  .bar{position:sticky;top:0;background:#46683A;color:#fff;padding:8px 14px;display:flex;gap:10px;align-items:center;font-size:12px}
  .bar button{font:inherit;background:#fff;color:#46683A;border:0;border-radius:3px;padding:4px 10px;cursor:pointer}
  @media print{body{background:#fff}.bar{display:none}.pg{padding:0}}</style></head><body>
  <div class="bar"><button onclick="print()">Print or save as PDF</button><span>Choose "Save as PDF" as the printer to keep a file.</span></div>
  <div class="pg"><div class="top"><div><div class="brand">HOLINER<small>Internal deal brief · ${new Date().toLocaleDateString('en-US')}</small></div>
   <h1>${esc(f['Address'])}</h1><p class="sub">${esc([f['Property Name'],f['City'],ao?P.areas[ao.a].n+' · '+ao.d.toFixed(2)+' mi':''].filter(Boolean).join(' · '))}</p></div>
   <div class="gr"><b>${it._g}</b><span>score ${it._sc}</span></div></div>
  <div class="img"><img src="${img}" alt="Aerial" crossorigin="anonymous"><svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none">${poly}</svg></div>
  <div class="cols"><div>
   <h3>Why it grades ${it._g}</h3><div class="bars"><div><span>Owner likely to sell</span><i><b style="width:${Math.round(100*p.own)}%"></b></i><em>${Math.round(100*p.own)}</em></div><div><span>Building fit</span><i><b style="width:${Math.round(100*p.fit)}%;background:#AFA183"></b></i><em>${Math.round(100*p.fit)}</em></div></div>
   <div class="chips">${[it.s.sale?'Listed for sale':'',...(it.fl||[]),...String(f['Why']||'').split(' · ')].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join('')}</div>
   <h3>Building</h3><table>${row('Size',`${num(f['Bldg SF'])} SF`)}${row('Use',f['Use'])}${row('Stories',f['Stories'])}${row('Built',f['Yr Built'])}${row('Practices inside',f['Practice Locations in Bldg']||'none found')}${row('Parking',cs&&f['CoStar Parking Ratio']?f['CoStar Parking Ratio']+'/1,000 SF (CoStar)':f['Est. Parking/1,000 (land)']!=null&&f['Est. Parking/1,000 (land)']!==''?'about '+f['Est. Parking/1,000 (land)']+'/1,000 SF (DCAD land estimate)':'')}${row('Zoning',f['Zoning (DCAD)'])}${row('Leased (CoStar)',cs&&f['CoStar % Leased']!=null?f['CoStar % Leased']+'%':'')}${row('DCAD value',taxTxt(f)||money(f['DCAD Value']))}</table>
   <h3>Owner</h3><table>${row('Owner',[f['Owner'],f['Owner 2']].filter(Boolean).join(' / '))}${row('Mailing address',f['Owner Mailing Address'])}${row('Held',f['Latest Deed']?`${f['Years Held']} years (deed ${f['Latest Deed']})`:'')}${row('Parcels in county',f["Owner's Parcels in County"])}${row('Owner-occupied',f['Owner-occupied'])}${row('True owner (CoStar)',cs?f['CoStar True Owner']:'')}</table>
  </div><div>
   ${as?`<h3>Area demand · ${esc(P.areas[ao.a].n)} (grade ${as.grade})</h3><table>${row('Within '+R.opts.radius+' mi',areaWhy(as))}${row('Sales proof',salesWhy(as))}${row('Practices within ½ mi',f['Practices within 1/2 mi'])}</table>`:''}
   <h3>Medical condo projects within 1½ mi</h3>${ul(ev.proj,'None nearby.')}
   <h3>Condo sales within 1½ mi (CoStar)</h3>${ul(ev.sales,'None in the CoStar export.')}
   <h3>For sale within 1 mi (CoStar)</h3>${ul(ev.list,'None marked for sale.')}
   <h3>SBA suite purchases within 3 mi</h3>${ul(ev.buys,'None found.')}
   ${st&&st[0]||nt.n?`<h3>My status and notes</h3><p>${st&&st[0]?`<b>${esc(st[1])}</b> `:''}${esc(nt.n||'')}</p>`:''}
  </div></div>
  <div class="ft">Internal, not for distribution. Sources: DCAD 2026 roll (posted 10/12/2026); CMS NPI Registry ${esc(P.npiAsOf||'')}; CoStar property exports and sale comps 11/3/2026 (licensed); SBA 7(a)/504 FOIA 9/30/2026; aerial USGS The National Map. Grade is a research order, not a valuation. Texas does not disclose most sale prices; counts are shown, not medians.</div></div></body></html>`;
  const w=window.open('','_blank');if(!w){alert('Allow pop-ups for this site to open the brief.');return}
  w.document.open();w.document.write(html);w.document.close()}

// ---------- tables and export ----------
function openSheet(){const {esc}=H;const s=$('#sheet');
  const cell=(h,v)=>v==null?'':typeof v==='number'?(/\$/.test(h)?'$':'')+Number(v).toLocaleString('en-US'):esc(v);
  $('#sheetIn').innerHTML=`<div class="sheet-head"><div><div class="eyebrow">Deal mode</div><h2 id="sheetTitle">Ring and comp tables</h2><p class="sub">Most Texas sales have no disclosed price, so read each median with its count.</p></div><button class="x" id="closeSheet">Close</button></div>
   ${P.sheets.map(t=>`<div class="priv-tbl"><h3>${esc(t.title)}</h3><p class="sub">${esc(t.note)}</p><div class="tbl-wrap"><table class="ntbl"><thead><tr>${t.head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r=>`<tr>${r.map((v,i)=>`<td${typeof v==='number'?' class="n"':''}>${cell(t.head[i],v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`).join('')}`;
  s.hidden=false;$('#closeSheet').addEventListener('click',()=>{s.hidden=true})}
function exportCSV(){const rows=P.layers.cand.filter(it=>note(it).s||note(it).n).sort((a,b)=>b._sc-a._sc);
  const head=['Grade','Score','Status','Notes','Updated','Address','City','Use','Bldg SF','Owner','Owner Mailing Address','Area','Why'];
  const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  if(!rows.length){alert('Mark a building first (Shortlist, Contacted, In talks or Pass), then export.');return}
  const csv=[head.join(',')].concat(rows.map(it=>{const n=note(it),s=STATUS.find(x=>x[0]===(n.s||'')),ao=areaOf(it);return [it._g,it._sc,s?s[1]:'',n.n,n.t,it.f['Address'],it.f['City'],it.f['Use'],it.f['Bldg SF'],it.f['Owner'],it.f['Owner Mailing Address'],ao?P.areas[ao.a].n:it.f['Nearest Hospital'],it.f['Why']].map(q).join(',')})).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`my-buildings-${new Date().toISOString().slice(0,10)}.csv`;a.click()}

const CSS=`
.deal-on .panel-inner>div:first-child,.deal-on #totals{display:none}
.priv-box{display:flex;justify-content:space-between;align-items:center;border:1px solid #ff7a1a;border-radius:3px;padding:6px 10px;font-size:12px;color:var(--muted)}
.priv-box b{font-family:var(--f-display);letter-spacing:.06em;text-transform:uppercase;font-size:11px;color:var(--ink)}
.priv-box .back{font-size:12px}
.psync{border:1px solid var(--rule);border-radius:3px;padding:8px}
.psync input{font:inherit;font-size:12px;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:3px;padding:3px 6px}
.psteps{display:flex;gap:4px}.psteps button{all:unset;cursor:pointer;flex:1;text-align:center;font-size:12px;padding:5px 4px;border:1px solid var(--rule);border-radius:3px;color:var(--muted)}
.psteps button.on{border-color:var(--ink);color:var(--ink);font-weight:600}.psteps button[disabled]{opacity:.4;cursor:default}
.pctl{display:grid;gap:6px;font-size:12px;color:var(--muted)}
.pctl>label{display:grid;grid-template-columns:96px 1fr 50px;gap:8px;align-items:center}.pctl b{color:var(--ink);font-family:var(--f-mono);font-weight:500;text-align:right}
.pctl input[type=range]{width:100%}
.pctl .psize{grid-template-columns:96px 1fr auto 1fr auto}.psize input{font:inherit;width:100%;box-sizing:border-box;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:3px;padding:2px 4px;text-align:right}
.pbuy{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
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
.phead2 h2{margin:2px 0 0;display:flex;align-items:center;gap:8px}
.ag{display:inline-grid;place-content:center;width:18px;height:18px;border-radius:3px;color:#111;font-weight:700;font-size:11px;font-family:var(--f-mono)}
.ag.big{width:26px;height:26px;font-size:15px;flex:none}
.alist{margin-top:10px;display:grid;gap:6px}
.arow{all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:30px 1fr auto;gap:10px;align-items:start;padding:8px;border:1px solid var(--rule);border-radius:4px}
.arow:hover{border-color:var(--ink)}.atx{display:grid;gap:2px;font-size:12px;color:var(--muted)}.atx b{color:var(--ink);font-size:13.5px}.atx small{font-size:11.5px}
.atx .gA{color:${GCOL.A};font-size:12px}.atx .gB{color:${GCOL.B};font-size:12px}.arow>em{font-style:normal;font-family:var(--f-mono);font-size:12px;color:var(--muted)}
.alab{background:none;border:0}.alab{white-space:nowrap;font:600 11.5px/1 var(--f-display,system-ui);color:#fff;text-shadow:0 1px 3px #000,0 0 2px #000;display:flex!important;align-items:center;gap:5px;transform:translate(-100%,-150%);cursor:pointer}
.alab .ag{text-shadow:none;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.gbadge{display:inline-grid;place-content:center;width:20px;height:20px;border-radius:3px;color:#111;font-weight:700;font-family:var(--f-mono);font-size:12px}
.prow .row-num{display:flex;align-items:center;gap:5px}.prow .row-num small{font-size:11px;color:var(--muted)}
.prow .row-name{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.prow .row-name small{color:var(--muted);font-weight:400}
.spill{font-style:normal;font-size:10.5px;border:1px solid;border-radius:9px;padding:0 6px}.spill.chg{border-color:#f59e0b;color:#f59e0b}
.pchip{display:inline-block;font-size:11px;line-height:1.3;border:1px solid var(--rule);border-radius:3px;padding:1px 5px;margin:2px 4px 0 0;color:var(--ink)}
.row-meta .pchip{color:var(--muted)}
.pflags{margin-top:8px}.pflag{display:inline-block;font-size:11.5px;font-weight:600;background:#f59e0b;color:#111;border-radius:3px;padding:1px 7px;margin:0 4px 0 0}
.pnav{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted)}.pnav .back[disabled]{opacity:.35;cursor:default}
.phead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-top:10px}.phead h2{margin:2px 0 0}
.pscore{flex:none;border:3px solid;border-radius:50%;width:58px;height:58px;display:grid;place-content:center;text-align:center}
.pscore b{font-family:var(--f-mono);font-size:24px;line-height:1}.pscore span{font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
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
.plink.brief{background:#78A167;border-color:#78A167;color:#111;font-weight:600}
.plink:hover,.pstat button:hover,.nrow:hover{border-color:var(--ink)}
.pnear h5,.facts h5{margin-top:6px}
.pnear h5{grid-column:1/-1;margin:14px 0 4px;padding:6px 0 4px;font-family:var(--f-display);font-weight:600;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--rule)}
.nrow{all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:12px 1fr auto;gap:8px;align-items:start;width:100%;padding:6px 4px;border-bottom:1px solid var(--rule);border-left:2px solid transparent}
.nrow span b{display:block;font-size:12.5px;font-weight:600}.nrow span small{display:block;font-size:11.5px;color:var(--muted)}
.nrow em{font-style:normal;font-size:11.5px;color:var(--muted);font-family:var(--f-mono)}.nrow .dot{margin-top:4px}
.pall{margin-top:14px}`;
})();
