// --- 設定 ---
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec';
const MY_SECRET_KEY = 'nanndemosoudann_23schop';
const API_ENDPOINT = `${GAS_WEB_APP_URL}?key=${MY_SECRET_KEY}`;
const COL = { TS:0, RNAME:1, Q:2, TEAM:3, SELECTED:4, DONE:5, UID:6 };

// --- 組版/ルビ関連 ---
const PUNCT_R = /[、。，．・：；！？…‥）」』】〉》〕］）]$/;
const PUNCT_L = /^[（「『［｛《〈〔【(]/;
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function renderRuby(text){ return String(text).replace(/\[([^\]]+?)\]\{([^}]+?)\}/g, (_m, a, b)=>`<ruby>${a}<rt>${b}</rt></ruby>`); }
function stripHtml(s){ return String(s).replace(/<[^>]*>/g,''); }
function styleFor(item){
  const uid = String(item[COL.UID]||item[COL.Q]||'');
  let n = 0; for(let i=0;i<uid.length;i++) n = (n*31 + uid.charCodeAt(i))>>>0;
  return ['style-1','style-2','style-3','style-4'][n%4];
}
function wrapPunct(htmlEscaped, rawSeg){
  let out = htmlEscaped;
  if (PUNCT_R.test(rawSeg)) out = out.replace(PUNCT_R, m => `<span class="punct padR">${m}</span>`);
  if (PUNCT_L.test(rawSeg)) out = out.replace(PUNCT_L, m => `<span class="punct padL">${m}</span>`);
  return out;
}
function segmentJa(s){
  try{
    const seg = new Intl.Segmenter('ja',{granularity:'word'});
    return Array.from(seg.segment(s)).map(x=>x.segment);
  }catch(_){
    return String(s).split(/(\s+|[、。！？・：；（）「」『』［］｛｝《》〈〉—–―…‥，．,.!?]+)/).filter(Boolean);
  }
}
function mergeRubyTokens(arr){
  const out=[]; let buf=null;
  for (const t of arr){
    if (t.startsWith('[') || buf){
      if (buf) buf += t; else buf = t;
      if (buf.includes('}')){ out.push(buf); buf=null; }
    } else { out.push(t); }
  }
  if (buf) out.push(buf);
  return out;
}
function mergeParticles(arr){
  const out=[]; const stick=/^(は|が|を|に|で|と|の|へ|や|も|から|まで|より|だ|です|ます|ね|よ|か|ぞ|ぜ|さ|な|ない|たい|った|って|でしょう|でした|だった)$/;
  for (const s of arr){
    if (/^[、。！？・：；（）「」『』［］｛｝《》〈〉—–―…‥？!]+$/.test(s)){ if (out.length) out[out.length-1]+=s; else out.push(s); continue; }
    if (stick.test(s) && out.length){ out[out.length-1]+=s; }
    else out.push(s);
  }
  return out.filter(t=>t!==' ');
}
function getRuler(host){
  let __rulerEl = document.getElementById('ruler');
  if(!__rulerEl){
    __rulerEl = document.createElement('div');
    __rulerEl.id = 'ruler';
    __rulerEl.style.cssText = 'position:absolute;left:-99999px;top:-99999px;visibility:hidden;white-space:nowrap;transform:none;contain:layout style;';
    document.body.appendChild(__rulerEl);
  }
  const cs = getComputedStyle(host);
  ['font-family','font-size','font-weight','letter-spacing','line-height'].forEach(p=>{ __rulerEl.style.setProperty(p, cs.getPropertyValue(p)); });
  __rulerEl.style.setProperty('--hscale','1');
  __rulerEl.innerHTML = '';
  return __rulerEl;
}
function measureSegWidths(host, htmlSegs, rawSegs){
  const r = getRuler(host);
  const cs = getComputedStyle(host);
  const fs = parseFloat(cs.fontSize) || 16;
  const eatL = (parseFloat(cs.getPropertyValue('--punctEatL')) || 0) * fs;
  const eatR = (parseFloat(cs.getPropertyValue('--punctEatR')) || 0) * fs;
  const widths = [];
  htmlSegs.forEach((html, idx)=>{
    const outer = document.createElement('span'); outer.className='bun';
    const inner = document.createElement('span'); inner.className='scaled';
    inner.innerHTML = html;
    outer.appendChild(inner);
    r.appendChild(outer);
    const innerWidth = inner.getBoundingClientRect().width;
    let finalWidth = innerWidth;
    if (rawSegs){
      const t = rawSegs[idx] || '';
      if (PUNCT_L.test(t)) finalWidth = Math.max(0, finalWidth - eatL);
      if (PUNCT_R.test(t)) finalWidth = Math.max(0, finalWidth - eatR);
    }
    widths.push(finalWidth);
    r.removeChild(outer);
  });
  return widths;
}
function getBaseVisibleWidth(host){
  const box = host.closest('.selected-box') || host.parentElement;
  if(!box) return 1600;
  const cs = getComputedStyle(box);
  const pad = (parseFloat(cs.paddingLeft)||0) + (parseFloat(cs.paddingRight)||0);
  const w = box.clientWidth - pad;
  return Math.max(320, Math.floor(w));
}
function getLineHeightPx(host){
  const cs = getComputedStyle(host);
  let lh = cs.lineHeight;
  if (lh === 'normal'){ const fs = parseFloat(cs.fontSize) || 16; return fs * 1.3; }
  return parseFloat(lh) || 32;
}
function getSkewX(host){
  const t = getComputedStyle(host).transform;
  if (t && t !== 'none'){
    const m = t.match(/matrix\(([^)]+)\)/);
    if (m){ const a = m[1].split(',').map(parseFloat); if (a.length>=6 && isFinite(a[2])) return a[2]; }
  }
  return Math.tan(-15*Math.PI/180);
}
function getStageScale(){
  const v = getComputedStyle(document.documentElement).getPropertyValue('--scale');
  const s = parseFloat(v);
  return (isFinite(s) && s>0) ? s : 1;
}
function simulateLinesSkew(widths, scale, baseW, lineHeight, tanAbs, maxLines){
  const base = (baseW / scale);
  const safetyPx = (10 / scale);
  let x = 0, lines = 1, j = 0;
  let limit0 = (base - tanAbs * ((maxLines - 1 - j) * lineHeight));
  let limit  = Math.floor(limit0 * 0.98 - safetyPx);
  limit = Math.max(24, limit);
  for (const w of widths){
    if (x && x + w > limit){
      lines++; j++; x = 0;
      if (lines > maxLines) break;
      limit0 = (base - tanAbs * ((maxLines - 1 - j) * lineHeight));
      limit  = Math.floor(limit0 * 0.98 - safetyPx);
      limit = Math.max(24, limit);
    }
    x += w;
  }
  return { lines };
}
async function postFlowFix(hostSpan, opt2){
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const scope = hostSpan.closest('.selected-box') || document.documentElement;
  let lo = (opt2 && opt2.min) || 0.72;
  let hi = parseFloat(getComputedStyle(scope).getPropertyValue('--hscale')) || (opt2 && opt2.base) || 0.90;
  let best = hi;
  let currentLines = countLines(hostSpan);
  if (currentLines > 1){
    for (let k=0; k<14 && hi - lo > 0.002; k++){
      const mid = (hi + lo) / 2;
      scope.style.setProperty('--hscale', String(mid));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const lines = countLines(hostSpan);
      if (lines <= 1){ lo = mid; best = mid; }
      else { hi = mid; }
    }
  }
  scope.style.setProperty('--hscale', String(best));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  lockLines(hostSpan);
  const box = hostSpan.closest('.selected-box');
  if (box) requestAnimationFrame(()=> applyBoxSkewCenterFix(box));
}
function applyBoxSkewCenterFix(boxEl){
  const tan = getSkewX(boxEl);
  const hScreen = boxEl.getBoundingClientRect().height;
  const hLocal  = hScreen / getStageScale();
  const dx      = tan * hLocal / 2;
  boxEl.style.setProperty('--baseFixX', dx + 'px');
}
function countLines(container){
  const tops = [];
  container.querySelectorAll('.bun').forEach(b=>{
    const t = b.offsetTop;
    if (tops.length===0 || Math.abs(tops[tops.length-1]-t) > 2) tops.push(t);
  });
  return Math.max(1, tops.length);
}
function lockLines(container){
  const buns = Array.from(container.querySelectorAll('.bun'));
  if (!buns.length) return;
  const pos = buns.map(b=>({el:b, top:b.offsetTop}));
  const lines = [];
  pos.forEach(({el, top})=>{
    const last = lines[lines.length-1];
    if (!last || Math.abs(last.top - top) > 2){ lines.push({ top, items:[el] }); }
    else { last.items.push(el); }
  });
  const frag = document.createDocumentFragment();
  lines.forEach(g=>{
    const line = document.createElement('span');
    line.className = 'line';
    g.items.forEach(b=> line.appendChild(b));
    frag.appendChild(line);
  });
  container.innerHTML = '';
  container.appendChild(frag);
}
function typesetAndFit(hostSpan, raw, opt){
  const cssBase = parseFloat(getComputedStyle(hostSpan).getPropertyValue('--hscale')) || 0.90;
  const opt2 = Object.assign({ maxLines:3, base:cssBase, min:0.75 }, opt||{});
  const segs = mergeParticles(segmentJa(stripHtml(raw)));
  const segsRubySafe = mergeRubyTokens(segs);
  const htmlSegs = segsRubySafe.map(s => wrapPunct(renderRuby(escapeHtml(s)), s));
  const widths = measureSegWidths(hostSpan, htmlSegs, segsRubySafe);
  const baseW = getBaseVisibleWidth(hostSpan);
  const lineH = getLineHeightPx(hostSpan);
  const frame = hostSpan.closest('.selected-box') || hostSpan;
  const tanAbs = Math.abs(getSkewX(frame));
  let lo = opt2.min, hi = opt2.base, best = hi;
  let sim = simulateLinesSkew(widths, hi, baseW, lineH, tanAbs, opt2.maxLines);
  if (sim.lines > opt2.maxLines){
    while (hi - lo > 0.003){
      const mid = (hi + lo) / 2;
      const r = simulateLinesSkew(widths, mid, baseW, lineH, tanAbs, opt2.maxLines);
      if (r.lines <= opt2.maxLines){ best = mid; sim = r; hi = mid; }
      else { lo = mid; }
    }
  }
  const scope = hostSpan.closest('.selected-box') || hostSpan.closest('.content-center') || hostSpan.parentElement;
  if (scope) scope.style.setProperty('--hscale', String(best));
  else document.documentElement.style.setProperty('--hscale', String(best));
  hostSpan.style.removeProperty('--hscale');
  hostSpan.innerHTML = '';
  htmlSegs.forEach((html)=>{
    const outer = document.createElement('span'); outer.className='bun';
    const inner = document.createElement('span'); inner.className='scaled';
    inner.innerHTML = html;
    outer.appendChild(inner);
    hostSpan.appendChild(outer);
  });
  postFlowFix(hostSpan, opt2).catch(()=>{});
}

function makeSelectedBoxSkeleton(item){
  const tpl = document.getElementById('tpl-selected');
  const li  = tpl.content.firstElementChild.cloneNode(true);
  li.setAttribute('data-uid', item[COL.UID] || '');
  const isFAQ = (item[COL.RNAME] === 'Pick Up Question');
  li.querySelector('.faq-tag').hidden      = !isFAQ;
  li.querySelector('.rname-prefix').hidden =  isFAQ;
  li.querySelector('.rname').hidden        =  isFAQ;
  if (!isFAQ) li.querySelector('.rname').textContent = item[COL.RNAME] || '';
  const span = li.querySelector('.content');
  span.classList.add(styleFor(item));
  span.dataset.raw = String(item[COL.Q]||'');
  return li;
}
function fillSelectedBox(li,item){
  const isFAQ = (item[COL.RNAME] === 'Pick Up Question');
  li.querySelector('.faq-tag').hidden      = !isFAQ;
  li.querySelector('.rname-prefix').hidden =  isFAQ;
  li.querySelector('.rname').hidden        =  isFAQ;
  if (!isFAQ) li.querySelector('.rname').textContent = item[COL.RNAME] || '';
  const span = li.querySelector('.content');
  span.classList.remove('style-1','style-2','style-3','style-4');
  span.classList.add(styleFor(item));
  span.dataset.raw = String(item[COL.Q]||'');
}
async function addOrUpdateBox(list, item, doAnimate){
  let li = list.querySelector(`.selected-box[data-uid="${item[COL.UID]||''}"]`);
  let isNew = false;
  if (!li){ li = makeSelectedBoxSkeleton(item); list.appendChild(li); isNew = true; }
  else { fillSelectedBox(li, item); }
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const span = li.querySelector('.content');
  typesetAndFit(span, String(item[COL.Q]||''), { maxLines: 3, min:0.75 });
  if (doAnimate && isNew){ requestAnimationFrame(()=> li.classList.add('slide-in')); }
  return li;
}

// PGMテロップのレンダリング
async function renderSelectedNames(names) {
  const list = document.getElementById("selectedList");
  const data = names.filter(item => item[COL.SELECTED] === '✔');
  const nowIds = data.map(d=>String(d[COL.UID]||''));
  list.querySelectorAll(".selected-box").forEach(el=>{
    const uid = el.getAttribute("data-uid") || '';
    if (!nowIds.includes(uid)) { 
      el.classList.add("slide-out"); 
      setTimeout(()=> el.remove(), 500); 
    }
  });
  list.innerHTML = '';
  for (const item of data){
    await addOrUpdateBox(list, item, true);
  }
}

// PGMデータ取得
async function loadSelectedNames() {
  try {
    const response = await fetch(API_ENDPOINT);
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const rawData = await response.json();
    const names = rawData.slice(1);
    await renderSelectedNames(names);
  } catch (error) {
    console.error("loadSelectedNames failed:", error);
  }
}

// 更新トークン監視
async function checkForUpdates(){
  try {
    const res = await fetch(`${GAS_WEB_APP_URL}?key=${MY_SECRET_KEY}&flag=1`);
    if (res.ok) {
      await loadSelectedNames();
    }
  } catch (error) {
    console.error("Check for updates failed:", error);
  }
  setTimeout(checkForUpdates, 1500);
}

// 初期化
window.onload = function(){
  function fitStage(){
    const ww = window.innerWidth, wh = window.innerHeight;
    const scale = Math.min(ww/1920, wh/1080);
    document.documentElement.style.setProperty('--scale', String(scale));
  }
  fitStage();
  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', fitStage);
  // インジケータ
  document.getElementById('hb').style.display = 'block';
  loadSelectedNames();
  setTimeout(checkForUpdates, 1000);
};