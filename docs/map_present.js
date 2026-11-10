// Felt-style phase 4: dashboard (stat boxes, bar charts, histograms tied to filters), compare swipe, presentation mode, PNG / PDF export.
// Public file with no data. Charts read the same layers and filters as map_tools.js; clicking a bar sets a filter.
(function(){
const $=s=>document.querySelector(s);
const ls={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const isNum=v=>typeof v==='number'&&isFinite(v);
const nf=v=>!isNum(v)?String(v):Math.abs(v)>=1e6?(v/1e6).toFixed(1)+'M':Math.abs(v)>=1000?Math.round(v).toLocaleString('en-US'):(+v.toFixed(2)).toString();
let H,map;
function boot(){H=window.HCM;map=H.map;
  const css=document.createElement('style');css.textContent=CSS;document.head.append(css);
  $('.mt-tools').insertAdjacentHTML('beforeend',`<button class="mt-btn" id="mp-dash" title="Charts that follow your filters">Dashboard</button><button class="mt-btn" id="mp-cmp" title="Swipe between two basemaps">Compare</button><button class="mt-btn" id="mp-pres" title="Full-screen presentation">Present</button><button class="mt-btn" id="mp-exp" title="Save the map as an image or PDF">Export</button>`);
  $('#mp-dash').addEventListener('click',toggleDash);$('#mp-cmp').addEventListener('click',toggleCompare);$('#mp-pres').addEventListener('click',()=>present(true));$('#mp-exp').addEventListener('click',exportPop);
  toolsMenu();
  window.addEventListener('mt-change',()=>{if($('#mp-dashp'))renderDash()});
  map.on('moveend',()=>{if($('#mp-dashp')&&dash().onScreen)renderDash()});
}
function start(){if(window.HCM&&window.HCM.mt&&window.HCM.mt.list)boot();else window.addEventListener('mt-ready',boot,{once:true})}
if(window.HCM)start();else window.addEventListener('hcm-ready',start,{once:true});
// one "Tools" button keeps the map clear: search and basemap stay up front, everything else opens from here
function toolsMenu(){const t=$('.mt-tools');if(!t||t.querySelector('#mp-tools'))return;
  const menu=document.createElement('div');menu.className='mt-tmenu';[...t.children].forEach(c=>menu.append(c));
  t.innerHTML='<button class="mt-btn" id="mp-tools" aria-haspopup="true" aria-expanded="false">Tools ▾</button>';t.append(menu);
  const set=o=>{t.classList.toggle('open',o);$('#mp-tools').setAttribute('aria-expanded',String(o))};
  $('#mp-tools').addEventListener('click',()=>set(!t.classList.contains('open')));
  menu.addEventListener('click',e=>{if(e.target.closest('.mt-btn'))setTimeout(()=>set(false),0)});
  document.addEventListener('pointerdown',e=>{if(!t.contains(e.target))set(false)});
  new MutationObserver(()=>[...t.children].forEach(c=>{if(c!==menu&&c.id!=='mp-tools')menu.append(c)})).observe(t,{childList:true})}
const panel=(id,cls)=>{let p=$('#'+id);if(!p){p=document.createElement('div');p.id=id;p.className=cls;map.getContainer().append(p);L.DomEvent.disableClickPropagation(p);L.DomEvent.disableScrollPropagation(p)}return p};

// ---------- dashboard ----------
const DKEY='hcm-dash';
function dash(){const d=ls.get(DKEY,{});d.layer=d.layer&&H.mt.list().some(l=>l.id===d.layer)?d.layer:(H.mt.list().find(l=>l.id==='cand')||H.mt.list()[0]).id;d.w=d.w||{};d.onScreen=!!d.onScreen;return d}
function defaults(id){const F=H.mt.fields(id),has=k=>F.some(f=>f.key===k),cat=F.find(f=>f.type==='cat'),num=F.find(f=>f.type==='num');
  if(id==='cand')return [{t:'stat',agg:'count'},{t:'stat',agg:'median',field:'Score'},{t:'stat',agg:'sum',field:'Bldg SF'},{t:'bar',field:'Use'},{t:'hist',field:'Bldg SF'},{t:'bar',field:'Nearest Hospital'}].filter(w=>!w.field||has(w.field));
  if(id==='condos')return [{t:'stat',agg:'count'},{t:'stat',agg:'sum',field:'Suites'},{t:'stat',agg:'sum',field:'Medical Suites'},{t:'bar',field:'Ownership'},{t:'bar',field:'City'},{t:'hist',field:'Building SF'}];
  return [{t:'stat',agg:'count'}].concat(num?[{t:'stat',agg:'median',field:num.key},{t:'hist',field:num.key}]:[]).concat(cat?[{t:'bar',field:cat.key}]:[])}
function widgets(d){return d.w[d.layer]||(d.w[d.layer]=defaults(d.layer))}
function toggleDash(){const p=$('#mp-dashp');if(p){p.remove();$('#mp-dash').setAttribute('aria-pressed','false');return}$('#mp-dash').setAttribute('aria-pressed','true');panel('mp-dashp','mp-dash');renderDash()}
function feats(d){let fs=H.mt.filtered(d.layer);if(d.onScreen){const b=map.getBounds();fs=fs.filter(f=>b.contains([f.lat,f.lon]))}return fs}
const AGG={count:'Count',sum:'Total',avg:'Average',median:'Median',min:'Lowest',max:'Highest'};
function stat(fs,w){if(w.agg==='count')return fs.length;const v=fs.map(f=>f.props[w.field]).filter(isNum).sort((a,b)=>a-b);if(!v.length)return null;
  return {sum:v.reduce((a,b)=>a+b,0),avg:v.reduce((a,b)=>a+b,0)/v.length,median:v[v.length>>1],min:v[0],max:v[v.length-1]}[w.agg]}
function renderDash(){const p=$('#mp-dashp');if(!p)return;const d=dash(),W=widgets(d),fs=feats(d),all=H.mt.list(),esc=H.esc,act=H.mt.filters(d.layer);
  const total=(all.find(l=>l.id===d.layer)||{features:[]}).features.length;
  p.innerHTML=`<div class="mp-dh"><select id="mp-layer">${all.map(l=>`<option value="${l.id}"${l.id===d.layer?' selected':''}>${esc(l.label)}</option>`).join('')}</select><button class="mt-x" id="mp-dx" aria-label="Close dashboard">×</button></div>
   <div class="mp-sub"><span>${fs.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}${act.length?` · ${act.length} filter${act.length>1?'s':''}`:''}</span><label><input type="checkbox" id="mp-screen"${d.onScreen?' checked':''}> Only what's on screen</label></div>
   <div class="mp-grid">${W.map((w,i)=>widget(w,i,fs,act)).join('')}</div>
   <div class="mp-add"><select id="mp-addt"><option value="">+ Add a chart</option><option value="stat">Number box</option><option value="bar">Bar chart (categories)</option><option value="hist">Histogram (numbers)</option></select>
   ${act.length?'<button class="mt-link" id="mp-clr">Clear filters</button>':''}<button class="mt-link" id="mp-reset">Reset charts</button></div>`;
  wireDash(p,d,W)}
function widget(w,i,fs,act){const esc=H.esc,x=`<button class="mt-x mp-wx" data-rm="${i}" aria-label="Remove chart">×</button>`;
  if(w.t==='stat'){const v=stat(fs,w);return `<div class="mp-w mp-stat">${x}<b>${v==null?'–':nf(v)}</b><span>${esc(AGG[w.agg])}${w.field?' '+esc(w.field):''}</span>${w.agg!=='count'?`<select data-agg="${i}">${Object.entries(AGG).filter(([k])=>k!=='count').map(([k,t])=>`<option value="${k}"${k===w.agg?' selected':''}>${t}</option>`).join('')}</select>`:''}</div>`}
  const f=act.find(r=>r.field===w.field);
  if(w.t==='bar'){const cnt=new Map();fs.forEach(ft=>{const v=ft.props[w.field];const k=v==null||v===''?'(blank)':String(v);cnt.set(k,(cnt.get(k)||0)+1)});
    const rows=[...cnt.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10),mx=Math.max(1,...rows.map(r=>r[1]));
    return `<div class="mp-w mp-wide">${x}<div class="mp-wt">${esc(w.field)}</div>${rows.map(([k,n])=>{const on=f&&f.type==='cat'&&f.values.length===1&&f.values[0]===k;
      return `<button class="mp-bar${on?' on':''}" data-cat="${i}" data-v="${esc(k)}" title="Click to show only ${esc(k)}"><span class="mp-bl">${esc(k)}</span><i style="width:${n/mx*100}%"></i><em>${n.toLocaleString('en-US')}</em></button>`}).join('')||'<p class="mp-none">No data</p>'}</div>`}
  if(w.t==='hist'){const v=fs.map(ft=>ft.props[w.field]).filter(isNum).sort((a,b)=>a-b);if(!v.length)return `<div class="mp-w mp-wide">${x}<div class="mp-wt">${esc(w.field)}</div><p class="mp-none">No data</p></div>`;
    const lo=v[0],hi=v[Math.min(v.length-1,Math.floor(v.length*.98))],n=10,step=(hi-lo)/n||1;const bins=Array.from({length:n},(_,k)=>({a:lo+k*step,b:k===n-1?Infinity:lo+(k+1)*step,c:0}));
    v.forEach(x=>{const k=Math.min(n-1,Math.floor((x-lo)/step));bins[k].c++});const mx=Math.max(...bins.map(b=>b.c));
    return `<div class="mp-w mp-wide">${x}<div class="mp-wt">${esc(w.field)}</div><div class="mp-hist">${bins.map((b,k)=>{const on=f&&f.type==='num'&&+f.min===+b.a.toFixed(2)&&(b.b===Infinity?f.max==='':+f.max===+b.b.toFixed(2));
      return `<button class="mp-hb${on?' on':''}" data-hist="${i}" data-a="${b.a.toFixed(2)}" data-b="${b.b===Infinity?'':b.b.toFixed(2)}" title="${nf(b.a)} to ${b.b===Infinity?nf(v[v.length-1]):nf(b.b)}: ${b.c}"><i style="height:${b.c/mx*100}%"></i></button>`}).join('')}</div>
      <div class="mp-ax"><span>${nf(lo)}</span><span>${nf(hi)}+</span></div></div>`}
  return ''}
function wireDash(p,d,W){const save=()=>ls.set(DKEY,d);
  $('#mp-dx').addEventListener('click',toggleDash);
  $('#mp-layer').addEventListener('change',e=>{d.layer=e.target.value;save();renderDash()});
  $('#mp-screen').addEventListener('change',e=>{d.onScreen=e.target.checked;save();renderDash()});
  p.querySelectorAll('[data-rm]').forEach(b=>b.addEventListener('click',()=>{W.splice(+b.dataset.rm,1);save();renderDash()}));
  p.querySelectorAll('[data-agg]').forEach(s=>s.addEventListener('change',()=>{W[+s.dataset.agg].agg=s.value;save();renderDash()}));
  p.querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>{const w=W[+b.dataset.cat],cur=H.mt.filters(d.layer).find(r=>r.field===w.field);
    const same=cur&&cur.type==='cat'&&cur.values.length===1&&cur.values[0]===b.dataset.v;H.mt.setFilter(d.layer,same?{field:w.field}:{field:w.field,type:'cat',values:[b.dataset.v]})}));
  p.querySelectorAll('[data-hist]').forEach(b=>b.addEventListener('click',()=>{const w=W[+b.dataset.hist];const on=b.classList.contains('on');
    H.mt.setFilter(d.layer,on?{field:w.field}:{field:w.field,type:'num',min:b.dataset.a,max:b.dataset.b})}));
  const clr=$('#mp-clr');clr&&clr.addEventListener('click',()=>H.mt.filters(d.layer).slice().forEach(r=>H.mt.setFilter(d.layer,{field:r.field})));
  $('#mp-reset').addEventListener('click',()=>{delete d.w[d.layer];save();renderDash()});
  $('#mp-addt').addEventListener('change',e=>{const t=e.target.value;if(!t)return;const F=H.mt.fields(d.layer).filter(f=>t==='stat'?f.type==='num':t==='bar'?f.type==='cat':f.type==='num');
    if(!F.length){alert('This layer has no fields of that kind.');return}
    const pick=prompt(`Which field?\n${F.map((f,i)=>`${i+1}. ${f.key}`).join('\n')}\n\nType a number:`,'1');const f=F[(+pick||0)-1];if(!f){renderDash();return}
    W.push(t==='stat'?{t,agg:'sum',field:f.key}:{t,field:f.key});save();renderDash()})}

// ---------- compare (swipe) ----------
let cmp=null;
function toggleCompare(){if(cmp){endCompare();return}const btn=$('#mp-cmp');btn.setAttribute('aria-pressed','true');
  const tiles=H.mt.bases.filter(b=>b.url),cur=H.mt.getBase();const left=tiles.find(b=>b.k!==cur&&b.k==='streets')||tiles.find(b=>b.k!==cur)||tiles[0];
  if(!map.getPane('cmp')){map.createPane('cmp').style.zIndex=155}
  cmp={base:left,x:map.getSize().x/2};cmp.layer=L.tileLayer(left.url,{pane:'cmp',maxNativeZoom:left.max,maxZoom:20,crossOrigin:true}).addTo(map);
  const bar=document.createElement('div');bar.className='mp-swipe';bar.innerHTML='<i></i><b title="Drag">⇔</b>';map.getContainer().append(bar);cmp.bar=bar;
  const lab=document.createElement('div');lab.className='mp-cmpl';map.getContainer().append(lab);cmp.lab=lab;L.DomEvent.disableClickPropagation(lab);
  const drag=e=>{const r=map.getContainer().getBoundingClientRect();cmp.x=Math.max(20,Math.min(r.width-20,(e.touches?e.touches[0].clientX:e.clientX)-r.left));clip();e.preventDefault()};
  const up=()=>{document.removeEventListener('pointermove',drag);document.removeEventListener('pointerup',up);map.dragging.enable()};
  bar.addEventListener('pointerdown',e=>{map.dragging.disable();document.addEventListener('pointermove',drag);document.addEventListener('pointerup',up);e.preventDefault()});
  map.on('move zoom resize',clip);label();clip()}
function label(){const tiles=H.mt.bases.filter(b=>b.url),cur=H.mt.bases.find(b=>b.k===H.mt.getBase());
  cmp.lab.innerHTML=`<select id="mp-cmpsel">${tiles.map(b=>`<option value="${b.k}"${b.k===cmp.base.k?' selected':''}>${H.esc(b.label)}</option>`).join('')}</select><span>vs</span><b>${H.esc(cur?cur.label:'')}</b><button class="mt-x" id="mp-cmpx" aria-label="Stop comparing">×</button>`;
  $('#mp-cmpsel').addEventListener('change',e=>{const b=H.mt.bases.find(x=>x.k===e.target.value);map.removeLayer(cmp.layer);cmp.base=b;cmp.layer=L.tileLayer(b.url,{pane:'cmp',maxNativeZoom:b.max,maxZoom:20,crossOrigin:true}).addTo(map);clip()});
  $('#mp-cmpx').addEventListener('click',endCompare)}
function clip(){if(!cmp)return;const s=map.getSize(),nw=map.containerPointToLayerPoint([0,0]);
  map.getPane('cmp').style.clip=`rect(${nw.y}px, ${nw.x+cmp.x}px, ${nw.y+s.y}px, ${nw.x}px)`;cmp.bar.style.left=cmp.x+'px'}
function endCompare(){if(!cmp)return;map.removeLayer(cmp.layer);cmp.bar.remove();cmp.lab.remove();map.getPane('cmp').style.clip='';map.off('move zoom resize',clip);cmp=null;$('#mp-cmp').setAttribute('aria-pressed','false')}

// ---------- presentation mode ----------
const TKEY='hcm-present-title';let slide=-1;
function present(on){const root=document.documentElement;
  if(!on){root.classList.remove('mp-present');$('#mp-pbar')&&$('#mp-pbar').remove();document.removeEventListener('keydown',pkey);if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});setTimeout(()=>map.invalidateSize(),80);return}
  root.classList.add('mp-present');try{root.requestFullscreen&&root.requestFullscreen().catch(()=>{})}catch(e){}
  const views=ls.get('hcm-views',[]);slide=-1;
  const b=document.createElement('div');b.id='mp-pbar';b.className='mp-pbar';
  b.innerHTML=`<div class="mp-ptitle" contenteditable="true" spellcheck="false" title="Click to edit">${H.esc(ls.get(TKEY,'Medical condo opportunities near Dallas County hospitals'))}</div>
   ${views.length?`<div class="mp-pnav"><button class="mt-btn" id="mp-pprev">‹</button><span id="mp-pname">Saved views (${views.length})</span><button class="mt-btn" id="mp-pnext">›</button></div>`:''}
   <button class="mt-btn" id="mp-pexit">Exit (Esc)</button>`;
  map.getContainer().append(b);L.DomEvent.disableClickPropagation(b);
  b.querySelector('.mp-ptitle').addEventListener('input',e=>ls.set(TKEY,e.target.textContent.trim()));
  $('#mp-pexit').addEventListener('click',()=>present(false));
  const go=dlt=>{if(!views.length)return;slide=(slide+dlt+views.length)%views.length;const v=views[slide];if(v.base)H.mt.setBase(v.base);map.flyTo([v.lat,v.lon],v.z,{duration:1});$('#mp-pname').textContent=`${slide+1} of ${views.length}: ${v.name}`};
  $('#mp-pprev')&&$('#mp-pprev').addEventListener('click',()=>go(-1));$('#mp-pnext')&&$('#mp-pnext').addEventListener('click',()=>go(1));present.go=go;
  document.addEventListener('keydown',pkey);setTimeout(()=>map.invalidateSize(),120)}
function pkey(e){if(document.activeElement&&document.activeElement.isContentEditable)return;if(e.key==='Escape')present(false);if(e.key==='ArrowRight'||e.key===' ')present.go&&present.go(1);if(e.key==='ArrowLeft')present.go&&present.go(-1)}
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&document.documentElement.classList.contains('mp-present'))present(false)});

// ---------- export PNG / PDF ----------
function exportPop(){const old=$('#mp-exportp');if(old){old.remove();return}const p=panel('mp-exportp','mp-export');
  p.innerHTML=`<div class="mt-h">Export the map</div>
   <label class="mp-fl">Title<input id="mp-et" value="${H.esc(ls.get(TKEY,'Medical condo opportunities near Dallas County hospitals'))}"></label>
   <label class="mp-fl">Note (optional)<input id="mp-en" placeholder="e.g. Prepared for internal review"></label>
   <label class="mt-row"><input type="checkbox" id="mp-elg" checked>Include the legend</label>
   <div class="md-row"><button class="mt-btn" id="mp-epng">Download PNG</button><button class="mt-btn" id="mp-epdf">Download PDF</button><button class="mt-x" id="mp-ex" aria-label="Close">×</button></div>
   <p class="mp-none">Exports exactly what's on screen. Hide panels first for a cleaner image.</p>`;
  $('#mp-ex').addEventListener('click',()=>p.remove());
  const run=async fmt=>{const btns=p.querySelectorAll('.mt-btn');btns.forEach(b=>b.disabled=true);p.querySelector('.mp-none').textContent='Building the image…';
    try{const c=await compose($('#mp-et').value.trim(),$('#mp-en').value.trim(),$('#mp-elg').checked);const name=`map-${new Date().toISOString().slice(0,10)}`;
      if(fmt==='png'){c.toBlob(b=>{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name+'.png';a.click()},'image/png')}
      else{await lib('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');const {jsPDF}=window.jspdf;const pdf=new jsPDF({orientation:c.width>=c.height?'landscape':'portrait',unit:'pt',format:'letter'});
        const W=pdf.internal.pageSize.getWidth(),Hh=pdf.internal.pageSize.getHeight(),m=24,sc=Math.min((W-2*m)/c.width,(Hh-2*m)/c.height);
        pdf.addImage(c.toDataURL('image/jpeg',.92),'JPEG',(W-c.width*sc)/2,(Hh-c.height*sc)/2,c.width*sc,c.height*sc);pdf.save(name+'.pdf')}
      p.querySelector('.mp-none').textContent=c._skipped?`Saved. ${c._skipped} image tiles couldn't be included (their server doesn't allow it).`:'Saved.'}
    catch(err){console.error(err);p.querySelector('.mp-none').textContent='Export failed: '+err.message}
    btns.forEach(b=>b.disabled=false)};
  $('#mp-epng').addEventListener('click',()=>run('png'));$('#mp-epdf').addEventListener('click',()=>run('pdf'))}
const libs={};function lib(src){return libs[src]||(libs[src]=new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('could not load the PDF library'));document.head.append(s)}))}
function opacityOf(el,stop){let o=1;for(let e=el;e&&e!==stop;e=e.parentElement){const v=parseFloat(getComputedStyle(e).opacity);if(!isNaN(v))o*=v}return o}
const okSrc=img=>img.crossOrigin!=null||img.src.startsWith(location.origin)||img.src.startsWith('data:')||img.src.startsWith('blob:');
async function compose(title,note,withLegend){const mc=map.getContainer(),R=mc.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1)*1.5;
  const head=title||note?64:0,c=document.createElement('canvas');c.width=Math.round(R.width*dpr);c.height=Math.round((R.height+head)*dpr);const ctx=c.getContext('2d');ctx.scale(dpr,dpr);
  ctx.fillStyle=getComputedStyle(mc).backgroundColor||'#eee';ctx.fillRect(0,head,R.width,R.height);c._skipped=0;
  const panes=[...mc.querySelectorAll('.leaflet-pane')].filter(p=>!p.classList.contains('leaflet-map-pane')&&!/tooltip|popup|shadow/.test(p.className))
    .map(p=>({p,z:+getComputedStyle(p).zIndex||0})).sort((a,b)=>a.z-b.z);
  for(const {p} of panes){const clipTxt=p.style.clip;ctx.save();ctx.beginPath();ctx.rect(0,head,R.width,R.height);ctx.clip();
    if(clipTxt&&cmp){ctx.beginPath();ctx.rect(0,head,cmp.x,R.height);ctx.clip()}
    for(const el of p.querySelectorAll('img,canvas,svg')){if(el.closest('svg')&&el.tagName.toLowerCase()!=='svg')continue;const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
      if(r.right<R.left||r.left>R.right||r.bottom<R.top||r.top>R.bottom)continue;
      ctx.globalAlpha=opacityOf(el,mc);const x=r.left-R.left,y=r.top-R.top+head;
      try{if(el.tagName==='IMG'){if(!el.complete||!el.naturalWidth)continue;if(!okSrc(el)){c._skipped++;continue}ctx.drawImage(el,x,y,r.width,r.height)}
        else if(el.tagName==='CANVAS')ctx.drawImage(el,x,y,r.width,r.height);
        else{const img=await svgImage(el,r);ctx.drawImage(img,x,y,r.width,r.height)}}catch(e){c._skipped++}}
    ctx.restore()}
  ctx.globalAlpha=1;
  // labels: hospital names, road labels, measurement and map labels, text notes
  ctx.textBaseline='middle';
  mc.querySelectorAll('.leaflet-tooltip.perm,.leaflet-tooltip.mt-label,.leaflet-tooltip.mt-tip,.road-label,.md-text span').forEach(el=>{const r=el.getBoundingClientRect();if(!r.width||r.right<R.left||r.left>R.right||r.bottom<R.top||r.top>R.bottom)return;
    const cs=getComputedStyle(el);const x=r.left-R.left,y=r.top-R.top+head;ctx.font=`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if(cs.backgroundColor&&!/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)){ctx.fillStyle=cs.backgroundColor;ctx.fillRect(x,y,r.width,r.height)}
    ctx.fillStyle=cs.color;ctx.fillText(el.textContent.trim(),x+parseFloat(cs.paddingLeft||0),y+r.height/2)});
  // header
  if(head){ctx.fillStyle='#ffffff';ctx.fillRect(0,0,R.width,head);ctx.fillStyle='#16170f';ctx.font='600 20px system-ui,sans-serif';ctx.fillText(title||'',16,24);
    ctx.font='12px system-ui,sans-serif';ctx.fillStyle='#555';ctx.fillText([note,new Date().toLocaleDateString('en-US',{dateStyle:'long'})].filter(Boolean).join(' · '),16,48)}
  // legend from the styled layers
  if(withLegend){const lg=$('#mt-legend');if(lg){const rows=[];lg.querySelectorAll('.mt-lg').forEach(g=>{rows.push(['h',g.querySelector('b').textContent]);g.querySelectorAll('.mt-lgt,.mt-lgi').forEach(e=>{const i=e.querySelector('i');rows.push([e.classList.contains('mt-lgt')?'t':'i',e.textContent.trim(),i&&getComputedStyle(i).backgroundColor])})});
    const lh=17,w=240,hgt=rows.length*lh+14,x0=12,y0=head+R.height-hgt-12;ctx.fillStyle='rgba(255,255,255,.94)';ctx.fillRect(x0,y0,w,hgt);ctx.strokeStyle='#ccc';ctx.strokeRect(x0,y0,w,hgt);
    rows.forEach(([k,t,col],i)=>{const y=y0+10+i*lh+lh/2;ctx.font=k==='h'?'600 12px system-ui,sans-serif':'11.5px system-ui,sans-serif';ctx.fillStyle=k==='t'?'#666':'#16170f';
      if(col){ctx.fillStyle=col;ctx.beginPath();ctx.arc(x0+14,y,5,0,7);ctx.fill();ctx.fillStyle='#16170f';ctx.fillText(t.slice(0,34),x0+26,y)}else ctx.fillText(t.slice(0,38),x0+8,y)})}}
  // scale bar and credit
  const mpp=map.distance(map.containerPointToLatLng([0,R.height/2]),map.containerPointToLatLng([100,R.height/2]))/100;const steps=[50,100,250,500,1000,2500,5280,10560,26400,52800];
  const ftpp=mpp*3.28084;const ft=steps.find(s=>s/ftpp>=60)||52800,px=ft/ftpp,label=ft>=5280?`${ft/5280} mi`:`${ft} ft`;
  const sx=R.width-px-18,sy=head+R.height-34;ctx.fillStyle='rgba(255,255,255,.9)';ctx.fillRect(sx-6,sy-14,px+12,30);ctx.fillStyle='#16170f';ctx.fillRect(sx,sy+6,px,3);ctx.font='11px system-ui,sans-serif';ctx.fillText(label,sx,sy-3);
  const cr=($('#credit')&&$('#credit').textContent)||'';ctx.font='10px system-ui,sans-serif';ctx.fillStyle='rgba(255,255,255,.85)';const cw=ctx.measureText(cr).width;ctx.fillRect(R.width-cw-14,head+R.height-14,cw+10,13);ctx.fillStyle='#333';ctx.fillText(cr,R.width-cw-9,head+R.height-7);
  return c}
function svgImage(svg,r){return new Promise((res,rej)=>{const cl=svg.cloneNode(true);cl.setAttribute('xmlns','http://www.w3.org/2000/svg');cl.setAttribute('width',r.width);cl.setAttribute('height',r.height);cl.style.transform='';
  const img=new Image();img.onload=()=>res(img);img.onerror=rej;img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(cl))})}

const CSS=`
.mt-tools{flex-direction:column;align-items:flex-end;gap:4px}
.mt-tmenu{display:none;flex-direction:column;align-items:stretch;gap:4px;min-width:130px}.mt-tools.open .mt-tmenu{display:flex}
.mt-tmenu .mt-btn{text-align:left}
@media (max-width:760px){.mt-tools .mt-tmenu{position:absolute;bottom:100%;right:0;margin-bottom:4px}.mt-tools [data-m]{display:inline-block}}
.mp-dash{position:absolute;left:12px;top:56px;z-index:572;width:330px;max-width:calc(100% - 24px);max-height:calc(100% - 120px);overflow:auto;background:var(--surface);border:1px solid var(--rule);border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:12.5px;padding:10px}
.mp-dh{display:flex;gap:8px;align-items:center}.mp-dh select{flex:1;font:inherit;font-weight:600;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:3px;padding:4px 6px}
.mp-sub{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:8px 0;color:var(--muted);font-size:12px}.mp-sub label{display:flex;gap:4px;align-items:center;cursor:pointer}
.mp-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.mp-w{position:relative;border:1px solid var(--rule);border-radius:5px;padding:8px}.mp-wide{grid-column:1/-1}
.mp-wx{position:absolute;top:2px;right:2px;font-size:14px}
.mp-stat b{display:block;font-family:var(--f-mono);font-size:19px;line-height:1.2}.mp-stat span{display:block;font-size:11px;color:var(--muted)}
.mp-stat select{margin-top:4px;font:inherit;font-size:11px;border:1px solid var(--rule);border-radius:3px;background:var(--surface);color:var(--ink);max-width:100%}
.mp-wt{font-family:var(--f-display);font-weight:600;font-size:12px;margin-bottom:6px}
.mp-bar{all:unset;box-sizing:border-box;cursor:pointer;display:grid;grid-template-columns:110px 1fr 44px;gap:6px;align-items:center;width:100%;padding:2px 0;font-size:11.5px}
.mp-bar .mp-bl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mp-bar i{display:block;height:10px;background:#60a5fa;border-radius:2px;min-width:2px}
.mp-bar em{font-style:normal;text-align:right;font-family:var(--f-mono);color:var(--muted)}.mp-bar:hover i{background:#3b82f6}.mp-bar.on i{background:#f97316}.mp-bar.on{font-weight:600}
.mp-hist{display:flex;align-items:flex-end;gap:2px;height:70px}.mp-hb{all:unset;cursor:pointer;flex:1;height:100%;display:flex;align-items:flex-end}
.mp-hb i{display:block;width:100%;background:#60a5fa;border-radius:2px 2px 0 0;min-height:1px}.mp-hb:hover i{background:#3b82f6}.mp-hb.on i{background:#f97316}
.mp-ax{display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);margin-top:3px;font-family:var(--f-mono)}
.mp-add{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}.mp-add select{font:inherit;font-size:12px;border:1px solid var(--rule);border-radius:3px;background:var(--surface);color:var(--ink);padding:3px 5px}
.mp-none{margin:4px 0 0;color:var(--muted);font-size:11.5px}
.mp-swipe{position:absolute;top:0;bottom:0;z-index:565;width:0;cursor:ew-resize}.mp-swipe i{position:absolute;top:0;bottom:0;left:-1.5px;width:3px;background:#fff;box-shadow:0 0 4px rgba(0,0,0,.6)}
.mp-swipe b{position:absolute;top:50%;left:-18px;width:36px;height:36px;margin-top:-18px;border-radius:50%;background:#fff;color:#111;display:grid;place-items:center;box-shadow:0 1px 6px rgba(0,0,0,.5);font-size:16px;touch-action:none}
.mp-cmpl{position:absolute;bottom:42px;left:50%;transform:translateX(-50%);z-index:566;display:flex;gap:8px;align-items:center;background:var(--surface);border:1px solid var(--rule);border-radius:5px;padding:5px 8px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.mp-cmpl select{font:inherit;font-size:12px;border:1px solid var(--rule);border-radius:3px;background:var(--surface);color:var(--ink)}.mp-cmpl span{color:var(--muted)}
.mp-export{position:absolute;right:12px;top:56px;z-index:574;width:300px;background:var(--surface);border:1px solid var(--rule);border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.25);padding:10px;font-size:12.5px;display:grid;gap:8px}
.mp-fl{display:grid;gap:3px;color:var(--muted);font-size:12px}.mp-fl input{font:inherit;font-size:12.5px;color:var(--ink);background:var(--surface);border:1px solid var(--rule);border-radius:3px;padding:5px 7px}
.mt-btn[disabled]{opacity:.5;cursor:wait}
.mp-present aside.panel,.mp-present .mt-bar,.mp-present .mt-tools,.mp-present #mt-edit,.mp-present .mt-table,.mp-present .md-pop,.mp-present .mp-dash,.mp-present .mp-export{display:none!important}
.mp-present .app{display:block!important}.mp-present #map{position:fixed!important;inset:0;height:100vh!important;width:100vw!important}
.mp-pbar{position:absolute;top:12px;left:12px;right:60px;z-index:590;display:flex;gap:10px;align-items:center}
.mp-ptitle{flex:1;background:rgba(17,17,17,.78);color:#fff;font-family:var(--f-display);font-weight:600;font-size:20px;padding:8px 14px;border-radius:5px;outline:none}
.mp-pnav{display:flex;gap:6px;align-items:center;background:var(--surface);border-radius:5px;padding:3px 6px;font-size:12.5px}`;
})();
