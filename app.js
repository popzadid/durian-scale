/* ===== จดตาชั่งทุเรียน — flow: เลือกเกรด > กรอกน้ำหนัก > ตารางแยกเกรด > ราคา > ค่าใช้จ่าย ===== */

const GROUP_SIZE = 5;            // ครบ 5 แถวต่อเกรด = สรุปย่อย 1 ครั้ง
const DEFAULT_GRADES = ['AB', 'C', 'ตกไซส์', 'อื่นๆ'];
const STORE_KEY = 'durian_records';
const DRAFT_KEY = 'durian_draft';
const APP_VERSION = 'v15';   // fallback ถ้ายังไม่มี service worker ควบคุมหน้า

// ===== แบนเนอร์โฆษณาร้าน =====
// แก้ได้ตรงนี้: img = ลิงก์รูป (ถ้ามี), bg = สีพื้น (ถ้าไม่มีรูป), link = ลิงก์ปลายทางเมื่อคลิก
const ADS = [
  { title: 'ร้านสุรเดชการเกษตร (1999)', subtitle: 'ปุ๋ย ยา อุปกรณ์การเกษตร ครบวงจร', bg: 'linear-gradient(135deg,#2e7d32,#1b5e20)', img: '', link: '' },
  { title: 'โปรโมชั่นปุ๋ยทุเรียน', subtitle: 'ราคาพิเศษช่วงฤดูกาล สอบถามได้เลย', bg: 'linear-gradient(135deg,#f9a825,#ef6c00)', img: '', link: '' },
  { title: 'สนใจสินค้า ทักหาเราได้', subtitle: 'แอดไลน์ / โทรสอบถามราคา', bg: 'linear-gradient(135deg,#00897b,#00695c)', img: '', link: '' }
];

// ===== Cloudflare Web Analytics =====
// วางโทเคนจาก Cloudflare ตรงนี้ (ปล่อยว่าง = ปิดการเก็บสถิติ)
const CF_ANALYTICS_TOKEN = 'de80ab71181148279f77da9fb696d1c7';

let state = {
  orchard: '',
  date: '',
  time: '',
  grades: [...DEFAULT_GRADES],
  activeGrade: 'AB',
  entries: {},                   // { grade: [{ w:number, time:'HH:MM', seq:number }] }
  prices: {},                    // { grade: number }
  expenses: [],                  // [{ name:'', amount:number }]
  seq: 0                         // ลำดับการกรอก (ใช้แสดงรายการล่าสุด)
};

/* ---------- helpers ---------- */
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const fmt = (n) => !n ? '0' : Number(n.toFixed(2)).toLocaleString('th-TH');
const baht = (n) => fmt(n) + ' ฿';
function nowTime(){ const d=new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function nowDate(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(t._t); t._t=setTimeout(()=>t.hidden=true,2200); }

/* ---------- ensure structures exist ---------- */
function ensureGrade(g){
  if (!state.entries[g]) state.entries[g] = [];
  if (!(g in state.prices)) state.prices[g] = '';
}
function gradeWeight(g){ return (state.entries[g]||[]).reduce((a,e)=>a+num(e.w),0); }
function gradeMoney(g){ return gradeWeight(g) * num(state.prices[g]); }
function revenue(){ return state.grades.reduce((a,g)=>a+gradeMoney(g),0); }
function expenseTotal(){ return state.expenses.reduce((a,e)=>a+num(e.amount),0); }
function netTotal(){ return revenue() - expenseTotal(); }

/* ===================== RENDER ===================== */
function renderAll(){
  renderGradePicker();
  renderActiveGrade();
  renderGradeTables();
  renderRecent();
  renderPrices();
  renderExpenses();
  renderSummary();
}

// รวมรายการที่กรอกล่าสุด (ทุกเกรด) เรียงใหม่ไปเก่า
function recentEntries(n){
  const all = [];
  state.grades.forEach(g => (state.entries[g]||[]).forEach(e => all.push({ grade:g, w:e.w, time:e.time, seq:e.seq||0 })));
  all.sort((a,b) => (b.seq||0) - (a.seq||0));
  return all.slice(0, n||6);
}

function renderRecent(){
  const card = $('#recentCard'), list = $('#recentList');
  const items = recentEntries(6);
  if (!items.length){ card.hidden = true; list.innerHTML = ''; return; }
  card.hidden = false;
  list.innerHTML = items.map((e,i) => `<div class="recent-item ${i===0?'latest':''}">
    <span class="ri-grade">${escapeHtml(e.grade)}</span>
    <span class="ri-w">${fmt(num(e.w))} กก.</span>
    ${i===0 ? '<span class="ri-badge">ล่าสุด</span>' : ''}
    <span class="ri-time">${e.time||''}</span>
    <button class="del-row" data-del-seq="${e.seq}" title="ลบรายการนี้">✕</button>
  </div>`).join('');
}

function deleteEntryBySeq(seq){
  for (const g of state.grades){
    const arr = state.entries[g] || [];
    const idx = arr.findIndex(e => (e.seq||0) === seq);
    if (idx > -1){ arr.splice(idx,1); break; }
  }
  renderGradePicker(); renderGradeTables(); renderRecent(); renderPrices(); renderSummary();
  saveDraft();
}

// จำกัดไม่เกิน 3 หลัก (ทศนิยมได้ไม่เกิน 2 ตำแหน่ง)
function sanitizeWeight(v){
  v = String(v).replace(/[^\d.]/g, '');
  const dot = v.indexOf('.');
  if (dot > -1) v = v.slice(0, dot+1) + v.slice(dot+1).replace(/\./g, '');
  const parts = v.split('.');
  const intp = parts[0].slice(0, 3);
  const dec = parts.length > 1 ? '.' + parts[1].slice(0, 2) : '';
  return intp + dec;
}

function renderGradePicker(){
  const wrap = $('#gradePicker');
  wrap.innerHTML = state.grades.map(g => {
    const cnt = (state.entries[g]||[]).length;
    const w = gradeWeight(g);
    return `<button class="grade-btn ${g===state.activeGrade?'active':''}" data-grade="${escapeHtml(g)}">
      ${state.grades.length>1?`<span class="rm-grade" data-rmgrade="${escapeHtml(g)}" title="ลบเกรด">✕</span>`:''}
      ${escapeHtml(g)}
      <span class="count">${cnt? `${cnt} ครั้ง · ${fmt(w)} กก.` : 'ยังไม่มี'}</span>
    </button>`;
  }).join('');
}

function renderActiveGrade(){ $('#activeGradeName').textContent = state.activeGrade || '-'; }

function renderGradeTables(){
  const wrap = $('#gradeTables');
  const gradesWithData = state.grades.filter(g => (state.entries[g]||[]).length > 0);
  if (gradesWithData.length === 0){
    wrap.innerHTML = `<div class="empty-block">ยังไม่มีรายการ — เลือกเกรดแล้วกรอกน้ำหนักด้านบน</div>`;
    return;
  }
  wrap.innerHTML = gradesWithData.map(g => {
    const list = state.entries[g];
    let rows = '';
    let block = [];
    list.forEach((e,i) => {
      rows += `<tr>
        <td class="idx">${i+1}</td>
        <td class="w">${fmt(num(e.w))}</td>
        <td class="tm">${e.time||''}</td>
        <td class="act"><button class="del-row" data-del-grade="${escapeHtml(g)}" data-del-idx="${i}">✕</button></td>
      </tr>`;
      block.push(e);
      if ((i+1)%GROUP_SIZE===0){
        const sub = block.reduce((a,x)=>a+num(x.w),0);
        rows += `<tr class="sub"><td class="idx">ชุด ${(i+1)/GROUP_SIZE}</td><td colspan="3">${fmt(sub)} กก.</td></tr>`;
        block = [];
      }
    });
    return `<div class="grade-block">
      <div class="grade-block-head"><span>${escapeHtml(g)}</span><span class="gb-total">รวม ${fmt(gradeWeight(g))} กก.</span></div>
      <table class="gb-table">
        <thead><tr><th class="idx">#</th><th>น้ำหนัก (กก.)</th><th class="tm">เวลา</th><th class="act"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');
}

function renderPrices(){
  const body = $('#priceBody');
  const gradesWithData = state.grades.filter(g => gradeWeight(g) > 0);
  if (gradesWithData.length === 0){
    body.innerHTML = `<tr><td colspan="4" class="empty-block">ยังไม่มีน้ำหนัก</td></tr>`;
  } else {
    body.innerHTML = gradesWithData.map(g => `<tr>
      <td class="gname">${escapeHtml(g)}</td>
      <td>${fmt(gradeWeight(g))}</td>
      <td><input class="price" inputmode="decimal" data-price="${escapeHtml(g)}" value="${state.prices[g] ?? ''}" placeholder="0" /></td>
      <td class="money">${baht(gradeMoney(g))}</td>
    </tr>`).join('');
  }
  $('#revenueTotal').textContent = baht(revenue());
}

function renderExpenses(){
  const wrap = $('#expenseList');
  if (state.expenses.length === 0){
    wrap.innerHTML = `<div class="empty-block">ยังไม่มีค่าใช้จ่าย</div>`;
    return;
  }
  wrap.innerHTML = state.expenses.map((e,i) => `<div class="expense-row">
    <input type="text" class="exp-name" data-exp-name="${i}" value="${escapeHtml(e.name||'')}" placeholder="เช่น ค่าแรง, ค่ารถ, ค่าตัด" autocomplete="off" />
    <div class="exp-amt-wrap">
      <input type="text" class="exp-amt" inputmode="decimal" data-exp-amt="${i}" value="${e.amount ?? ''}" placeholder="0" />
      <span class="exp-unit">฿</span>
    </div>
    <button class="del-row" data-del-exp="${i}">✕</button>
  </div>`).join('');
}

function renderSummary(){
  $('#sumRevenue').textContent = baht(revenue());
  $('#sumExpense').textContent = '- ' + baht(expenseTotal());
  $('#sumNet').textContent = baht(netTotal());
}

/* ===================== ACTIONS ===================== */
function selectGrade(g){
  state.activeGrade = g;
  ensureGrade(g);
  renderGradePicker();
  renderActiveGrade();
  $('#weightInput').focus();
}

function addWeight(){
  const inp = $('#weightInput');
  const w = num(inp.value);
  if (w <= 0){ toast('กรอกน้ำหนักก่อน'); inp.focus(); return; }
  const g = state.activeGrade;
  ensureGrade(g);
  state.seq = (state.seq || 0) + 1;
  state.entries[g].push({ w, time: nowTime(), seq: state.seq });
  inp.value = '';
  inp.focus();
  renderGradePicker();
  renderGradeTables();
  renderRecent();
  renderPrices();
  renderSummary();
  saveDraft();
}

function deleteEntry(g, idx){
  if (state.entries[g]) state.entries[g].splice(idx,1);
  renderGradePicker();
  renderGradeTables();
  renderRecent();
  renderPrices();
  renderSummary();
  saveDraft();
}

function openAddGrade(){
  $('#addGradeBtn').hidden = true;
  $('#addGradeForm').hidden = false;
  const i = $('#newGradeInput'); i.value = ''; i.focus();
}
function cancelAddGrade(){
  $('#addGradeForm').hidden = true;
  $('#addGradeBtn').hidden = false;
}
function confirmAddGrade(){
  const i = $('#newGradeInput');
  const g = i.value.trim();
  if (!g){ i.focus(); return; }
  if (state.grades.includes(g)){ toast('มีเกรดนี้แล้ว'); i.select(); return; }
  state.grades.push(g);
  ensureGrade(g);
  state.activeGrade = g;
  cancelAddGrade();
  renderAll();
  saveDraft();
  toast('เพิ่มเกรด "' + g + '" แล้ว');
}

function removeGrade(g){
  const has = (state.entries[g]||[]).length;
  if (!confirm(`ลบเกรด "${g}"${has?` (มี ${has} รายการ)`:''} ?`)) return;
  state.grades = state.grades.filter(x => x !== g);
  delete state.entries[g];
  delete state.prices[g];
  if (state.activeGrade === g) state.activeGrade = state.grades[0] || '';
  renderAll();
  saveDraft();
}

function addExpense(){
  state.expenses.push({ name:'', amount:'' });
  renderExpenses();
  saveDraft();
  const inputs = $$('input.exp-name');
  if (inputs.length) inputs[inputs.length-1].focus();
}

function clearSession(silent){
  if (!silent && !confirm('ล้างข้อมูลทั้งหมด?')) return;
  state.entries = {};
  state.prices = {};
  state.expenses = [];
  state.grades.forEach(ensureGrade);
  renderAll();
  saveDraft();
  if (!silent) toast('ล้างแล้ว');
}

function saveSession(){
  syncInputs();
  const hasData = state.grades.some(g => (state.entries[g]||[]).length>0);
  if (!hasData){ toast('ยังไม่มีรายการให้บันทึก'); return; }
  if (!state.orchard && !confirm('ยังไม่ได้กรอกสวนที่ตัด บันทึกต่อหรือไม่?')) return;

  const totals = {}; state.grades.forEach(g => totals[g] = gradeWeight(g));
  const moneyByGrade = {}; state.grades.forEach(g => moneyByGrade[g] = gradeMoney(g));
  const rec = {
    id: Date.now(),
    savedAt: new Date().toISOString(),
    orchard: state.orchard || '(ไม่ระบุสวน)',
    date: state.date, time: state.time,
    grades: [...state.grades],
    entries: JSON.parse(JSON.stringify(state.entries)),
    prices: { ...state.prices },
    totals, moneyByGrade,
    expenses: state.expenses.map(e => ({ name:e.name, amount:num(e.amount) })),
    revenue: revenue(), expenseTotal: expenseTotal(), net: netTotal()
  };
  const all = loadRecords();
  all.unshift(rec);
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
  toast('บันทึกเรียบร้อย ✓');

  // เริ่มรอบใหม่
  state.orchard=''; $('#orchard').value='';
  resetDateTime();
  clearSession(true);
  renderHistory();
}

/* ---------- input sync ---------- */
function syncInputs(){
  state.orchard = $('#orchard').value.trim();
  state.date = $('#sessionDate').value;
  state.time = $('#sessionTime').value;
}

/* ---------- draft ---------- */
function saveDraft(){ syncInputs(); localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); }
function loadDraft(){
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (d && Array.isArray(d.grades)){
      state = { ...state, ...d };
      if (!state.grades.length) state.grades = [...DEFAULT_GRADES];
      if (!state.entries) state.entries = {};
      if (!state.prices) state.prices = {};
      if (!state.expenses) state.expenses = [];
      if (!state.activeGrade) state.activeGrade = state.grades[0];
    }
  } catch(e){}
  state.grades.forEach(ensureGrade);
}

/* ---------- records ---------- */
function loadRecords(){ try { return JSON.parse(localStorage.getItem(STORE_KEY))||[]; } catch(e){ return []; } }
function deleteRecord(id){
  if (!confirm('ลบรายการนี้?')) return;
  localStorage.setItem(STORE_KEY, JSON.stringify(loadRecords().filter(r=>r.id!==id)));
  renderHistory(); toast('ลบแล้ว');
}

let historyMode = 'list';   // 'list' | 'day' | 'orchard'

function recWeight(r){ return Object.values(r.totals||{}).reduce((a,b)=>a+b,0); }
function fmtThaiDate(d){
  if (!d) return 'ไม่ระบุวันที่';
  const [y,m,day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function renderHistory(){
  const all = loadRecords();
  $('#historyCount').textContent = all.length || '';
  const list = $('#historyList');
  const banner = $('#grandSummary');

  if (!all.length){
    banner.innerHTML = '';
    list.innerHTML = `<div class="empty">ยังไม่มีประวัติการชั่ง<br>บันทึกครั้งแรกได้เลย 🌿</div>`;
    return;
  }

  // แถบสรุปยอดรวมทั้งหมด (ทุกรายการ)
  const gWeight = all.reduce((a,r)=>a+recWeight(r),0);
  const gRevenue = all.reduce((a,r)=>a+(r.revenue||0),0);
  const gExpense = all.reduce((a,r)=>a+(r.expenseTotal||0),0);
  const gNet = all.reduce((a,r)=>a+(r.net||0),0);
  banner.innerHTML = `<div class="gs-banner">
    <div>
      <div class="gs-label">ยอดรวมทั้งหมด (${all.length} รายการ)</div>
      <div class="gs-sub">รวม ${fmt(gWeight)} กก. · ขาย ${baht(gRevenue)} · ค่าใช้จ่าย ${baht(gExpense)}</div>
    </div>
    <div class="gs-net">${baht(gNet)}</div>
  </div>`;

  if (historyMode === 'list') renderHistoryList(all, list);
  else renderGroupSummary(all, list, historyMode);
}

function renderHistoryList(all, list){
  list.innerHTML = all.map(r => {
    const dt = [r.date, r.time].filter(Boolean).join(' ');
    const tags = r.grades.filter(g=>(r.totals[g]||0)>0).map(g=>`<span class="tag">${escapeHtml(g)}: ${fmt(r.totals[g]||0)} กก.</span>`).join('');
    return `<div class="history-item">
      <div class="hi-top">
        <div><div class="hi-orchard">${escapeHtml(r.orchard)}</div>
        <div class="hi-time">${dt||'—'} · รวม ${fmt(recWeight(r))} กก.</div></div>
        <span class="tag net">สุทธิ ${baht(r.net||0)}</span>
      </div>
      <div class="hi-totals">${tags}</div>
      <div class="hi-actions">
        <button class="hi-view" data-view="${r.id}">ดูรายละเอียด</button>
        <button class="hi-del" data-rmrec="${r.id}">ลบ</button>
      </div>
    </div>`;
  }).join('');
}

function renderGroupSummary(all, list, mode){
  // จัดกลุ่มตามวัน หรือ ตามสวน
  const groups = {};
  all.forEach(r => {
    const key = mode === 'day' ? (r.date || '') : (r.orchard || '(ไม่ระบุสวน)');
    if (!groups[key]) groups[key] = { key, count:0, weight:0, revenue:0, expense:0, net:0, grades:{} };
    const g = groups[key];
    g.count++; g.weight += recWeight(r);
    g.revenue += r.revenue||0; g.expense += r.expenseTotal||0; g.net += r.net||0;
    (r.grades||[]).forEach(gr => { g.grades[gr] = (g.grades[gr]||0) + (r.totals[gr]||0); });
  });

  // เรียง: รายวัน = วันที่ล่าสุดก่อน, รายสวน = น้ำหนักมากก่อน
  let arr = Object.values(groups);
  if (mode === 'day') arr.sort((a,b)=> (b.key||'').localeCompare(a.key||''));
  else arr.sort((a,b)=> b.weight - a.weight);

  list.innerHTML = arr.map(g => {
    const title = mode === 'day' ? fmtThaiDate(g.key) : escapeHtml(g.key);
    const tags = Object.keys(g.grades).filter(k=>g.grades[k]>0)
      .map(k=>`<span class="tag">${escapeHtml(k)}: ${fmt(g.grades[k])} กก.</span>`).join('');
    return `<div class="sum-group">
      <div class="sg-head">
        <span class="sg-title">${title}</span>
        <span class="tag net">สุทธิ ${baht(g.net)}</span>
      </div>
      <div class="sg-sub">${g.count} รายการ · รวม ${fmt(g.weight)} กก.</div>
      <div class="sg-money">
        <span>ขาย <b>${baht(g.revenue)}</b></span>
        <span>ค่าใช้จ่าย <b class="neg">- ${baht(g.expense)}</b></span>
      </div>
      <div class="hi-totals" style="margin-top:8px">${tags}</div>
    </div>`;
  }).join('');
}

function viewRecord(id){
  const r = loadRecords().find(x=>x.id===id);
  if (!r) return;
  const priceRows = r.grades.filter(g=>(r.totals[g]||0)>0).map(g=>`<tr>
    <td class="gname">${escapeHtml(g)}</td><td>${fmt(r.totals[g]||0)}</td>
    <td>${fmt(num(r.prices[g]))}</td><td class="money">${baht(r.moneyByGrade[g]||0)}</td></tr>`).join('');
  const expRows = (r.expenses||[]).map(e=>`<div class="sum-line minus"><span>${escapeHtml(e.name||'ค่าใช้จ่าย')}</span><span>- ${baht(num(e.amount))}</span></div>`).join('');
  const backdrop = document.createElement('div');
  backdrop.className='modal-backdrop';
  backdrop.innerHTML = `<div class="modal">
    <h3>${escapeHtml(r.orchard)}</h3>
    <div class="hi-time">${[r.date,r.time].filter(Boolean).join(' ')||'—'}</div>
    <div class="table-wrap" style="margin-top:12px">
      <table class="price-table">
        <thead><tr><th>เกรด</th><th>กก.</th><th>ราคา/กก.</th><th>เป็นเงิน</th></tr></thead>
        <tbody>${priceRows}</tbody>
        <tfoot><tr><td colspan="3" class="r">รวมเป็นเงิน</td><td>${baht(r.revenue||0)}</td></tr></tfoot>
      </table>
    </div>
    <div class="m-sum">
      ${expRows || ''}
      <div class="sum-line net"><span>คงเหลือสุทธิ</span><span>${baht(r.net||0)}</span></div>
    </div>
    <button class="close-modal">ปิด</button>
  </div>`;
  backdrop.addEventListener('click', e=>{ if (e.target===backdrop||e.target.classList.contains('close-modal')) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

/* ---------- export CSV ---------- */
function exportCSV(){
  const all = loadRecords();
  if (!all.length){ toast('ไม่มีข้อมูลให้ส่งออก'); return; }
  const lines = [['สวนที่ตัด','วันที่','เวลา','เกรด','น้ำหนัก(กก.)','ราคา/กก.','เป็นเงิน'].join(',')];
  all.forEach(r=>{
    r.grades.forEach(g=>{
      if ((r.totals[g]||0)>0)
        lines.push([csv(r.orchard),csv(r.date),csv(r.time),csv(g),r.totals[g],num(r.prices[g])||'',r.moneyByGrade[g]||0].join(','));
    });
    (r.expenses||[]).forEach(e=> lines.push([csv(r.orchard),'','','ค่าใช้จ่าย: '+csv(e.name),'','',-num(e.amount)].join(',')));
    lines.push([csv(r.orchard),'','','สุทธิ','','',r.net||0].join(','));
    lines.push('');
  });
  const blob = new Blob(['﻿'+lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=`ตาชั่งทุเรียน_${nowDate()}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('ส่งออก CSV แล้ว');
}
function csv(s){ s=String(s??''); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }

/* ---------- date/time ---------- */
function resetDateTime(){ $('#sessionDate').value=nowDate(); $('#sessionTime').value=nowTime(); }

function activateTab(name){
  $$('.tab').forEach(x=>x.classList.toggle('active', x.dataset.tab===name));
  $$('.tab-panel').forEach(x=>x.classList.remove('active'));
  const panel = $('#tab-'+name);
  if (panel) panel.classList.add('active');
  if (name==='history') renderHistory();
}

/* ===================== INIT ===================== */
function init(){
  loadDraft();
  $('#orchard').value = state.orchard || '';
  $('#sessionDate').value = state.date || nowDate();
  $('#sessionTime').value = state.time || nowTime();
  if (!state.activeGrade) state.activeGrade = state.grades[0];

  renderAll();
  renderHistory();

  // tabs (+ SPA virtual pageview สำหรับ analytics)
  $$('.tab').forEach(t=>t.addEventListener('click',()=>{
    activateTab(t.dataset.tab);
    if (history.pushState) history.pushState(null, '', '#' + t.dataset.tab);
  }));
  window.addEventListener('popstate', ()=>{
    const name = (location.hash || '#record').slice(1);
    if ($('#tab-'+name)) activateTab(name);
  });

  // grade picker (select / remove)
  $('#gradePicker').addEventListener('click', e=>{
    const rm = e.target.closest('[data-rmgrade]');
    if (rm){ e.stopPropagation(); removeGrade(rm.dataset.rmgrade); return; }
    const btn = e.target.closest('[data-grade]');
    if (btn) selectGrade(btn.dataset.grade);
  });
  $('#addGradeBtn').addEventListener('click', openAddGrade);
  $('#confirmGradeBtn').addEventListener('click', confirmAddGrade);
  $('#cancelGradeBtn').addEventListener('click', cancelAddGrade);
  $('#newGradeInput').addEventListener('keydown', e=>{
    if (e.key==='Enter'){ e.preventDefault(); confirmAddGrade(); }
    if (e.key==='Escape') cancelAddGrade();
  });

  // weight
  $('#addWeightBtn').addEventListener('click', addWeight);
  $('#weightInput').addEventListener('keydown', e=>{ if (e.key==='Enter') addWeight(); });
  $('#weightInput').addEventListener('input', e=>{
    const s = sanitizeWeight(e.target.value);
    if (s !== e.target.value) e.target.value = s;   // จำกัด 3 หลัก
  });

  // ลบรายการจากช่องแสดงผลล่าสุด
  $('#recentList').addEventListener('click', e=>{
    const d = e.target.closest('[data-del-seq]');
    if (d) deleteEntryBySeq(+d.dataset.delSeq);
  });

  // grade tables delete
  $('#gradeTables').addEventListener('click', e=>{
    const d = e.target.closest('[data-del-grade]');
    if (d) deleteEntry(d.dataset.delGrade, +d.dataset.delIdx);
  });

  // prices
  $('#priceBody').addEventListener('input', e=>{
    const p = e.target.closest('[data-price]');
    if (p){ state.prices[p.dataset.price] = p.value; renderPriceMoneyLive(); saveDraft(); }
  });

  // expenses
  $('#addExpenseBtn').addEventListener('click', addExpense);
  $('#expenseList').addEventListener('input', e=>{
    const n = e.target.closest('[data-exp-name]');
    const a = e.target.closest('[data-exp-amt]');
    if (n){ state.expenses[+n.dataset.expName].name = n.value; saveDraft(); }
    if (a){ state.expenses[+a.dataset.expAmt].amount = a.value; renderSummary(); saveDraft(); }
  });
  $('#expenseList').addEventListener('click', e=>{
    const d = e.target.closest('[data-del-exp]');
    if (d){ state.expenses.splice(+d.dataset.delExp,1); renderExpenses(); renderSummary(); saveDraft(); }
  });

  // history view toggle (รายการ / รายวัน / รายสวน)
  $('#historyView').addEventListener('click', e=>{
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    historyMode = b.dataset.view;
    $$('#historyView .seg-btn').forEach(x=>x.classList.toggle('active', x===b));
    renderHistory();
  });

  // history actions (ดูรายละเอียด / ลบ)
  $('#historyList').addEventListener('click', e=>{
    const v = e.target.closest('[data-view]');
    const d = e.target.closest('[data-rmrec]');
    if (v) viewRecord(+v.dataset.view);
    if (d) deleteRecord(+d.dataset.rmrec);
  });

  // session fields
  ['#orchard','#sessionDate','#sessionTime'].forEach(s=>$(s).addEventListener('change', saveDraft));

  // actions
  $('#clearBtn').addEventListener('click', ()=>clearSession(false));
  $('#saveBtn').addEventListener('click', saveSession);
  $('#exportBtn').addEventListener('click', exportCSV);

  setupTheme();
  renderAds();
  setupAdCarousel();
  registerSW();
  setupInstall();
  setupAnalytics();
  showVersion();
}

// อัปเดตเงินในตารางราคา + สรุป โดยไม่หลุดโฟกัสช่องราคา
function renderPriceMoneyLive(){
  const gradesWithData = state.grades.filter(g => gradeWeight(g) > 0);
  const moneyCells = $$('#priceBody td.money');
  gradesWithData.forEach((g,i)=>{ if (moneyCells[i]) moneyCells[i].textContent = baht(gradeMoney(g)); });
  $('#revenueTotal').textContent = baht(revenue());
  renderSummary();
}

/* ---------- แบนเนอร์โฆษณา (carousel) ---------- */
function renderAds(){
  const banner = $('#adBanner'), track = $('#adTrack'), dots = $('#adDots');
  if (!track) return;
  if (!ADS.length){ banner.hidden = true; return; }
  banner.hidden = false;
  track.innerHTML = ADS.map(a => {
    const style = a.img ? `background-image:url('${a.img}')` : `background:${a.bg||'var(--green)'}`;
    const inner = `<span class="ad-tag">โฆษณา</span>
      <div class="ad-content"><div class="ad-title">${escapeHtml(a.title||'')}</div><div class="ad-sub">${escapeHtml(a.subtitle||'')}</div></div>`;
    return a.link
      ? `<a class="ad-slide" href="${a.link}" target="_blank" rel="noopener" style="${style}">${inner}</a>`
      : `<div class="ad-slide" style="${style}">${inner}</div>`;
  }).join('');
  dots.innerHTML = ADS.map((_,i) => `<span class="ad-dot ${i===0?'active':''}" data-i="${i}"></span>`).join('');
}

let adTimer = null;
function setupAdCarousel(){
  const track = $('#adTrack');
  if (!track || ADS.length < 2) return;          // มีสไลด์เดียวไม่ต้องเลื่อน
  const dots = $$('#adDots .ad-dot');
  let idx = 0;

  const syncDots = i => dots.forEach((d,di)=>d.classList.toggle('active', di===i));
  const goTo = i => { idx = (i+ADS.length)%ADS.length; track.scrollTo({ left: idx*track.clientWidth, behavior:'smooth' }); syncDots(idx); };

  let st;
  track.addEventListener('scroll', ()=>{
    clearTimeout(st);
    st = setTimeout(()=>{ idx = Math.round(track.scrollLeft/track.clientWidth); syncDots(idx); }, 80);
  });
  $('#adDots').addEventListener('click', e=>{ const d=e.target.closest('.ad-dot'); if (d){ goTo(+d.dataset.i); restart(); } });

  const restart = ()=>{ clearInterval(adTimer); adTimer = setInterval(()=>goTo(idx+1), 4000); };
  ['touchstart','mousedown'].forEach(ev=>track.addEventListener(ev, ()=>clearInterval(adTimer)));
  ['touchend','mouseleave'].forEach(ev=>track.addEventListener(ev, restart));
  restart();
}

/* ---------- ธีม สว่าง/มืด ---------- */
const THEME_KEY = 'durian_theme';
let themePref = 'auto';   // 'auto' | 'light' | 'dark'

function resolvedTheme(){
  if (themePref === 'auto') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return themePref;
}
function applyTheme(){
  const t = resolvedTheme();
  document.documentElement.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#14391a' : '#2e7d32');
  const tg = $('#themeToggle');
  if (tg) tg.checked = (t === 'dark');   // slider เลื่อนตามธีมปัจจุบัน
}
function setupTheme(){
  try { themePref = localStorage.getItem(THEME_KEY) || 'auto'; } catch(e){}
  applyTheme();
  // ตามระบบเมื่อยังเป็นโหมด auto (ยังไม่เคยเลื่อนสไลเดอร์เอง)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ()=>{ if (themePref === 'auto') applyTheme(); });
  const tg = $('#themeToggle');
  if (tg) tg.addEventListener('change', ()=>{
    themePref = tg.checked ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, themePref); } catch(e){}
    applyTheme();
    toast(themePref === 'dark' ? 'ธีม: มืด 🌙' : 'ธีม: สว่าง ☀️');
  });
}

/* ---------- Cloudflare Web Analytics ---------- */
function setupAnalytics(){
  if (!CF_ANALYTICS_TOKEN) return;   // ไม่มีโทเคน = ไม่เก็บสถิติ
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_ANALYTICS_TOKEN, spa: true }));
  document.head.appendChild(s);
}

/* ---------- PWA ---------- */
function registerSW(){ if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{}); }

// แสดงเวอร์ชัน service worker ที่กำลังทำงานจริง
function showVersion(){
  const el = $('#appFooter');
  if (!el) return;
  const set = v => el.textContent = 'เวอร์ชัน ' + v;
  set(APP_VERSION);                                    // แสดง fallback ไปก่อน
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    const sw = navigator.serviceWorker.controller || reg.active;
    if (!sw) return;
    const ch = new MessageChannel();
    ch.port1.onmessage = e => { if (e.data && e.data.version) set(e.data.version); };
    sw.postMessage('GET_VERSION', [ch.port2]);
  }).catch(()=>{});
}
let deferredPrompt=null;
function isIos(){ return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1); }
function isStandalone(){ return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }

function setupInstall(){
  const btn = $('#installBtn');

  // Android / Chrome — มี prompt ในตัว
  window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredPrompt=e; btn.hidden=false; });

  btn.addEventListener('click', async ()=>{
    if (deferredPrompt){
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt=null; btn.hidden=true;
      return;
    }
    // iOS หรือเบราว์เซอร์ที่ไม่มี prompt → แสดงวิธีติดตั้งเอง
    showInstallHelp();
  });

  // iOS ไม่ยิง beforeinstallprompt → โชว์ปุ่มเองถ้ายังไม่ได้ติดตั้ง
  if (isIos() && !isStandalone()) btn.hidden=false;
}

function showInstallHelp(){
  const backdrop = document.createElement('div');
  backdrop.className='modal-backdrop';
  const ios = isIos();
  backdrop.innerHTML = `<div class="modal">
    <h3>📲 ติดตั้งแอปลงเครื่อง</h3>
    ${ios ? `
      <ol class="ios-steps">
        <li>ต้องเปิดด้วย <b>Safari</b> เท่านั้น (Chrome บน iPhone ติดตั้งไม่ได้)</li>
        <li>กดปุ่ม <b>แชร์</b> <span class="share-ico">⬆️</span> ที่แถบล่าง (หรือมุมขวาบน) ของ Safari</li>
        <li>เลื่อนลงเลือก <b>“เพิ่มลงในหน้าจอโฮม” (Add to Home Screen)</b></li>
        <li>กด <b>เพิ่ม / Add</b> มุมขวาบน — จะมีไอคอนแอปบนหน้าจอโฮม</li>
      </ol>` : `
      <ol class="ios-steps">
        <li>กดเมนู <b>⋮</b> ของเบราว์เซอร์</li>
        <li>เลือก <b>“ติดตั้งแอป” / “Add to Home screen”</b></li>
      </ol>`}
    <p class="hint">เมื่อติดตั้งแล้ว เปิดใช้งานได้แบบออฟไลน์ ไม่ต้องเข้าเว็บทุกครั้ง</p>
    <button class="close-modal">เข้าใจแล้ว</button>
  </div>`;
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop||e.target.classList.contains('close-modal')) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

document.addEventListener('DOMContentLoaded', init);
