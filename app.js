/*
 * Nonprofit Books — a simple bookkeeping app for small nonprofits.
 *
 * Everything runs in the browser. Data is saved to the browser's localStorage,
 * so use Settings → "Download backup" regularly to keep a copy of your books.
 *
 * Money is stored as whole cents (integers) to avoid rounding errors.
 */
'use strict';

/* =========================================================================
 * Helpers
 * ========================================================================= */
const STORAGE_KEY = 'nonprofit-books-v1';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FUNCTIONS = { program: 'Program services', management: 'Management & general', fundraising: 'Fundraising' };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoDate(new Date());

function money(cents, { sign = false } = {}) {
  const abs = (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (cents < 0) return `-$${abs}`;
  return (sign && cents > 0 ? '+' : '') + '$' + abs;
}
function moneyShort(cents) {
  const v = Math.abs(cents) / 100;
  const s = v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k' : v.toFixed(0);
  return (cents < 0 ? '-$' : '$') + s;
}
function toCents(v) {
  const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
const centsToInput = c => (c / 100).toFixed(2);
function prettyDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/* =========================================================================
 * Data (state) — load, save, defaults
 * ========================================================================= */
function defaultState() {
  const cat = (name, kind, func) => ({ id: uid(), name, kind, func: func || null });
  return {
    version: 1,
    org: { name: 'My Nonprofit', ein: '', address: '', email: '', signer: '', fyStartMonth: 1 },
    accounts: [
      { id: uid(), name: 'Checking', type: 'bank', opening: 0 },
      { id: uid(), name: 'Savings', type: 'bank', opening: 0 },
      { id: uid(), name: 'Petty Cash', type: 'cash', opening: 0 },
    ],
    funds: [
      { id: uid(), name: 'General Operating', restricted: false, opening: 0 },
      { id: uid(), name: 'Restricted Grants', restricted: true, opening: 0 },
    ],
    categories: [
      cat('Individual Donations', 'income'),
      cat('Grants', 'income'),
      cat('Corporate Sponsorships', 'income'),
      cat('Program Service Fees', 'income'),
      cat('Fundraising Events', 'income'),
      cat('In-Kind Contributions', 'income'),
      cat('Interest Income', 'income'),
      cat('Other Income', 'income'),
      cat('Salaries & Wages', 'expense', 'program'),
      cat('Payroll Taxes & Benefits', 'expense', 'program'),
      cat('Program Supplies', 'expense', 'program'),
      cat('Rent & Utilities', 'expense', 'management'),
      cat('Office Supplies', 'expense', 'management'),
      cat('Professional Fees', 'expense', 'management'),
      cat('Insurance', 'expense', 'management'),
      cat('Technology & Software', 'expense', 'management'),
      cat('Travel & Meetings', 'expense', 'program'),
      cat('Fundraising Expenses', 'expense', 'fundraising'),
      cat('Bank & Payment Fees', 'expense', 'management'),
      cat('Other Expenses', 'expense', 'management'),
    ],
    donors: [],
    transactions: [],
    budgets: {}, // { "2026": { categoryId: cents } } keyed by fiscal-year start year
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.error('Could not load saved data', e);
  }
  return defaultState();
}
function normalize(s) {
  const d = defaultState();
  return {
    ...d, ...s,
    org: { ...d.org, ...(s.org || {}) },
    accounts: s.accounts || d.accounts,
    funds: s.funds || d.funds,
    categories: s.categories || d.categories,
    donors: s.donors || [],
    transactions: s.transactions || [],
    budgets: s.budgets || {},
  };
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('Could not save your data in this browser. Please download a backup from Settings.');
  }
}

const byId = (list, id) => list.find(x => x.id === id);
const acctName = id => byId(state.accounts, id)?.name || '—';
const fundName = id => byId(state.funds, id)?.name || '—';
const catName = id => byId(state.categories, id)?.name || 'Uncategorized';
const donorName = id => byId(state.donors, id)?.name || '';
const sortByName = list => [...list].sort((a, b) => a.name.localeCompare(b.name));

/* =========================================================================
 * Fiscal years & periods
 * ========================================================================= */
function fyStartYearFor(iso) {
  const [y, m] = iso.split('-').map(Number);
  return m >= state.org.fyStartMonth ? y : y - 1;
}
function fyRange(startYear) {
  const m = state.org.fyStartMonth;
  const start = new Date(startYear, m - 1, 1);
  const end = new Date(startYear + 1, m - 1, 0);
  return { from: isoDate(start), to: isoDate(end) };
}
function fyLabel(startYear) {
  return state.org.fyStartMonth === 1 ? `FY ${startYear}` : `FY ${startYear}–${String(startYear + 1).slice(-2)}`;
}
function periodPresets() {
  const now = new Date();
  const cy = fyStartYearFor(todayISO());
  const thisMonth = { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  const lastMonth = { from: isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: isoDate(new Date(now.getFullYear(), now.getMonth(), 0)) };
  return {
    thisFY: { label: `This fiscal year (${fyLabel(cy)})`, ...fyRange(cy) },
    lastFY: { label: `Last fiscal year (${fyLabel(cy - 1)})`, ...fyRange(cy - 1) },
    thisMonth: { label: 'This month', ...thisMonth },
    lastMonth: { label: 'Last month', ...lastMonth },
    all: { label: 'All time', from: '0000-01-01', to: '9999-12-31' },
  };
}
const inRange = (t, r) => t.date >= r.from && t.date <= r.to;

/* =========================================================================
 * Calculations
 * ========================================================================= */
function accountBalance(accountId, asOf = '9999-12-31') {
  const a = byId(state.accounts, accountId);
  let bal = a?.opening || 0;
  for (const t of state.transactions) {
    if (t.date > asOf) continue;
    if (t.type === 'income' && t.accountId === accountId) bal += t.amount;
    if (t.type === 'expense' && t.accountId === accountId) bal -= t.amount;
    if (t.type === 'transfer') {
      if (t.accountId === accountId) bal -= t.amount;
      if (t.toAccountId === accountId) bal += t.amount;
    }
  }
  return bal;
}
const totalCash = (asOf) => state.accounts.reduce((s, a) => s + accountBalance(a.id, asOf), 0);

function fundBalance(fundId, asOf = '9999-12-31') {
  const f = byId(state.funds, fundId);
  let bal = f?.opening || 0;
  for (const t of state.transactions) {
    if (t.date > asOf || t.fundId !== fundId) continue;
    if (t.type === 'income') bal += t.amount;
    if (t.type === 'expense') bal -= t.amount;
  }
  return bal;
}
function dayBefore(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d - 1));
}

function summarize(range) {
  let income = 0, expense = 0;
  const byFunc = { program: 0, management: 0, fundraising: 0 };
  for (const t of state.transactions) {
    if (!inRange(t, range)) continue;
    if (t.type === 'income') income += t.amount;
    if (t.type === 'expense') { expense += t.amount; byFunc[t.func || 'management'] += t.amount; }
  }
  return { income, expense, net: income - expense, byFunc };
}

/* =========================================================================
 * Routing & rendering
 * ========================================================================= */
const views = { dashboard: renderDashboard, transactions: renderTransactions, donors: renderDonors, budget: renderBudget, reports: renderReports, settings: renderSettings };
const ui = {
  txFilter: { q: '', type: '', categoryId: '', fundId: '', accountId: '', from: '', to: '' },
  reportTab: 'activities',
  reportPeriod: 'thisFY',
  customRange: { from: '', to: '' },
  budgetYear: null,
  receiptYear: new Date().getFullYear(),
};

function currentView() {
  const v = location.hash.replace('#', '');
  return views[v] ? v : 'dashboard';
}
function render() {
  const v = currentView();
  $('#orgName').textContent = state.org.name || 'My Nonprofit';
  document.title = `${state.org.name || 'Nonprofit'} · Books`;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === v));
  hideTooltip();
  views[v]($('#view'));
}
window.addEventListener('hashchange', () => { render(); $('#view').focus(); window.scrollTo(0, 0); });

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

function options(list, selected, { blank } = {}) {
  let html = blank !== undefined ? `<option value="">${esc(blank)}</option>` : '';
  for (const x of list) html += `<option value="${esc(x.id)}"${x.id === selected ? ' selected' : ''}>${esc(x.name)}</option>`;
  return html;
}

/* ---------------- Dashboard ---------------- */
function renderDashboard(root) {
  const cy = fyStartYearFor(todayISO());
  const range = fyRange(cy);
  const s = summarize(range);
  const cash = totalCash();
  const programPct = s.expense ? Math.round((s.byFunc.program / s.expense) * 100) : null;
  const recent = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0)).slice(0, 6);

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Dashboard</h1><div class="muted">${esc(fyLabel(cy))} · ${prettyDate(range.from)} – ${prettyDate(range.to)}</div></div>
      <div class="btn-row">
        <button class="btn" data-action="add-tx" data-type="expense">+ Expense</button>
        <button class="btn primary" data-action="add-tx" data-type="income">+ Income</button>
      </div>
    </div>

    ${state.transactions.length === 0 ? `
      <div class="card callout" style="margin-bottom:16px">
        <h3>Welcome! Let's get your books set up.</h3>
        <ol class="small" style="margin:6px 0 12px;padding-left:18px">
          <li>Go to <a href="#settings">Settings</a> and enter your organization's name, EIN, and fiscal year.</li>
          <li>Enter your bank accounts' starting balances (also in Settings).</li>
          <li>Start recording income and expenses with the buttons above.</li>
        </ol>
        <div class="btn-row"><a class="btn" href="#settings">Open Settings</a><button class="btn" data-action="load-sample">Try it with sample data</button></div>
      </div>` : ''}

    <div class="grid grid-4">
      <div class="card stat"><div class="label">Cash on hand</div><div class="value">${money(cash)}</div><div class="sub">All accounts, today</div></div>
      <div class="card stat"><div class="label">Revenue this year</div><div class="value">${money(s.income)}</div><div class="sub">${esc(fyLabel(cy))}</div></div>
      <div class="card stat"><div class="label">Expenses this year</div><div class="value">${money(s.expense)}</div><div class="sub">${esc(fyLabel(cy))}</div></div>
      <div class="card stat"><div class="label">Change in net assets</div><div class="value ${s.net < 0 ? 'neg' : ''}">${money(s.net, { sign: true })}</div><div class="sub">Revenue minus expenses</div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h2>Revenue vs. expenses by month</h2>
        <div class="legend"><span><i style="background:var(--income)"></i>Revenue</span><span><i style="background:var(--expense)"></i>Expenses</span></div>
        <div class="chart" id="monthlyChart"></div>
      </div>
      <div class="card">
        <h2>Where the money went</h2>
        ${s.expense ? `
          <div class="stackbar" role="img" aria-label="Expenses by function">
            ${Object.keys(FUNCTIONS).map(k => s.byFunc[k] ? `<span style="width:${(s.byFunc[k] / s.expense) * 100}%;background:var(--fn-${k})" title="${esc(FUNCTIONS[k])}: ${money(s.byFunc[k])}"></span>` : '').join('')}
          </div>
          <table style="margin-top:10px"><tbody>
            ${Object.entries(FUNCTIONS).map(([k, label]) => `<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--fn-${k});margin-right:8px"></i>${label}</td><td class="num">${money(s.byFunc[k])}</td><td class="num muted">${Math.round((s.byFunc[k] / s.expense) * 100)}%</td></tr>`).join('')}
          </tbody></table>
          <p class="small muted" style="margin:10px 0 0">${programPct}% of spending went directly to programs. Many donors and watchdogs look for 65% or more.</p>
        ` : `<p class="muted">No expenses recorded yet this year.</p>`}
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h2>Fund balances</h2>
        <table><tbody>
          ${state.funds.map(f => `<tr><td>${esc(f.name)} <span class="pill">${f.restricted ? 'With donor restrictions' : 'Unrestricted'}</span></td><td class="num">${money(fundBalance(f.id))}</td></tr>`).join('')}
        </tbody></table>
        <h2 style="margin-top:18px">Account balances</h2>
        <table><tbody>
          ${state.accounts.map(a => `<tr><td>${esc(a.name)}</td><td class="num">${money(accountBalance(a.id))}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><h2>Recent activity</h2><a href="#transactions" class="small">View all</a></div>
        ${recent.length ? `<table><tbody>${recent.map(txRowCompact).join('')}</tbody></table>` : '<p class="muted">Nothing recorded yet.</p>'}
      </div>
    </div>`;

  drawMonthlyChart($('#monthlyChart'), cy);
}
function txRowCompact(t) {
  const amt = t.type === 'income' ? money(t.amount) : t.type === 'expense' ? money(-t.amount) : money(t.amount);
  const label = t.description || (t.type === 'transfer' ? 'Transfer' : catName(t.categoryId));
  return `<tr class="clickable" data-edit-tx="${t.id}"><td><div>${esc(label)}</div><div class="small muted">${prettyDate(t.date)} · ${esc(t.type === 'transfer' ? `${acctName(t.accountId)} → ${acctName(t.toAccountId)}` : catName(t.categoryId))}</div></td><td class="num ${t.type === 'income' ? 'pos' : ''}">${amt}</td></tr>`;
}

/* Monthly revenue vs expense bar chart (plain SVG, no libraries). */
function drawMonthlyChart(el, fyStart) {
  const m0 = state.org.fyStartMonth - 1;
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(fyStart, m0 + i, 1);
    return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: MONTHS[d.getMonth()], year: d.getFullYear(), income: 0, expense: 0 };
  });
  const idx = Object.fromEntries(months.map((m, i) => [m.key, i]));
  for (const t of state.transactions) {
    const i = idx[t.date.slice(0, 7)];
    if (i === undefined) continue;
    if (t.type === 'income') months[i].income += t.amount;
    if (t.type === 'expense') months[i].expense += t.amount;
  }
  const W = 560, H = 240, L = 48, R = 8, T = 10, B = 26;
  const max = Math.max(1, ...months.map(m => Math.max(m.income, m.expense)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const y = v => T + (H - T - B) * (1 - v / top);
  const slot = (W - L - R) / 12;
  const bw = Math.min(14, slot / 2 - 3);
  const bar = (x, v, cls) => {
    if (v <= 0) return '';
    const yTop = y(v), h = y(0) - yTop, r = Math.min(4, h);
    // rounded top corners, flat base
    return `<path class="${cls}" d="M${x},${y(0)} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + bw - r} Q${x + bw},${yTop} ${x + bw},${yTop + r} V${y(0)} Z"/>`;
  };
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly revenue and expenses">`;
  for (let v = 0; v <= top; v += step) {
    svg += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-label" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${moneyShort(v)}</text>`;
  }
  months.forEach((m, i) => {
    const cx = L + slot * i + slot / 2;
    svg += bar(cx - bw - 1, m.income, 'bar-income') + bar(cx + 1, m.expense, 'bar-expense');
    svg += `<text class="axis-label" x="${cx}" y="${H - 8}" text-anchor="middle">${m.label}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}"/>`;
  });
  svg += '</svg>';
  el.innerHTML = svg;
  $$('.hit', el).forEach(r => {
    r.addEventListener('mousemove', e => {
      const m = months[r.dataset.i];
      showTooltip(e, `<strong>${MONTHS_LONG[MONTHS.indexOf(m.label)]} ${m.year}</strong>
        <div class="row"><span>Revenue</span><span>${money(m.income)}</span></div>
        <div class="row"><span>Expenses</span><span>${money(m.expense)}</span></div>
        <div class="row"><span>Net</span><span>${money(m.income - m.expense, { sign: true })}</span></div>`);
    });
    r.addEventListener('mouseleave', hideTooltip);
  });
}
function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}
function showTooltip(e, html) {
  const tip = $('#tooltip');
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, yy = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (yy + r.height > innerHeight - 8) yy = e.clientY - r.height - 14;
  tip.style.left = x + 'px';
  tip.style.top = yy + 'px';
}
function hideTooltip() { const t = $('#tooltip'); if (t) t.hidden = true; }

/* ---------------- Transactions ---------------- */
function filteredTransactions() {
  const f = ui.txFilter;
  const q = f.q.trim().toLowerCase();
  return state.transactions.filter(t => {
    if (f.type && t.type !== f.type) return false;
    if (f.categoryId && t.categoryId !== f.categoryId) return false;
    if (f.fundId && t.fundId !== f.fundId) return false;
    if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (q) {
      const hay = [t.description, t.reference, t.notes, t.payee, donorName(t.donorId), catName(t.categoryId)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
}

function renderTransactions(root) {
  const f = ui.txFilter;
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Transactions</h1><div class="muted">Every dollar in and out of your organization.</div></div>
      <div class="btn-row">
        <button class="btn" data-action="export-csv">Export CSV</button>
        <button class="btn" data-action="add-tx" data-type="transfer">Transfer</button>
        <button class="btn" data-action="add-tx" data-type="expense">+ Expense</button>
        <button class="btn primary" data-action="add-tx" data-type="income">+ Income</button>
      </div>
    </div>
    <div class="card">
      <div class="filters" id="txFilters">
        <label class="field grow">Search<input type="search" name="q" value="${esc(f.q)}" placeholder="Description, payee, donor, check #…"></label>
        <label class="field">Type<select name="type"><option value="">All</option>${['income', 'expense', 'transfer'].map(x => `<option value="${x}"${f.type === x ? ' selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select></label>
        <label class="field">Category<select name="categoryId">${options(sortByName(state.categories), f.categoryId, { blank: 'All' })}</select></label>
        <label class="field">Fund<select name="fundId">${options(state.funds, f.fundId, { blank: 'All' })}</select></label>
        <label class="field">Account<select name="accountId">${options(state.accounts, f.accountId, { blank: 'All' })}</select></label>
        <label class="field">From<input type="date" name="from" value="${esc(f.from)}"></label>
        <label class="field">To<input type="date" name="to" value="${esc(f.to)}"></label>
        <button class="btn small" data-action="clear-filters" style="margin-bottom:4px">Clear</button>
      </div>
      <div id="txTable"></div>
    </div>`;

  const form = $('#txFilters');
  form.addEventListener('input', e => {
    if (!e.target.name) return;
    ui.txFilter[e.target.name] = e.target.value;
    drawTxTable();
  });
  drawTxTable();
}
function drawTxTable() {
  const list = filteredTransactions();
  let inc = 0, exp = 0;
  list.forEach(t => { if (t.type === 'income') inc += t.amount; if (t.type === 'expense') exp += t.amount; });
  $('#txTable').innerHTML = `
    <div class="small muted" style="margin-bottom:8px">${list.length} transaction${list.length === 1 ? '' : 's'} · Revenue ${money(inc)} · Expenses ${money(exp)} · Net ${money(inc - exp, { sign: true })}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Description</th><th class="hide-sm">Category</th><th class="hide-sm">Fund</th><th class="hide-sm">Account</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${list.length ? list.map(t => `
          <tr class="clickable" data-edit-tx="${t.id}">
            <td style="white-space:nowrap">${prettyDate(t.date)}</td>
            <td>${esc(t.description || '—')}${t.donorId ? `<div class="small muted">From ${esc(donorName(t.donorId))}</div>` : ''}${t.payee ? `<div class="small muted">Paid to ${esc(t.payee)}</div>` : ''}${t.reference ? `<div class="small muted">Ref #${esc(t.reference)}</div>` : ''}</td>
            <td class="hide-sm">${t.type === 'transfer' ? '<span class="pill">Transfer</span>' : `<span class="pill ${t.type}">${esc(catName(t.categoryId))}</span>`}</td>
            <td class="hide-sm">${t.type === 'transfer' ? '' : esc(fundName(t.fundId))}</td>
            <td class="hide-sm">${esc(acctName(t.accountId))}${t.type === 'transfer' ? ` → ${esc(acctName(t.toAccountId))}` : ''}</td>
            <td class="num ${t.type === 'income' ? 'pos' : ''}">${t.type === 'expense' ? money(-t.amount) : money(t.amount)}</td>
          </tr>`).join('') : `<tr><td colspan="6" class="empty">No transactions match. Use the buttons above to add one.</td></tr>`}
      </tbody>
    </table></div>`;
}

/* ---------------- Transaction form (modal) ---------------- */
function openTxForm(existing, type = 'income') {
  const t = existing ? { ...existing } : {
    id: null, type, date: todayISO(), amount: 0, description: '', categoryId: '', fundId: state.funds.find(f => !f.restricted)?.id || state.funds[0]?.id,
    accountId: state.accounts[0]?.id, toAccountId: state.accounts[1]?.id || '', donorId: '', payee: '', reference: '', func: '', notes: '',
  };

  const body = () => {
    const cats = sortByName(state.categories.filter(c => c.kind === t.type));
    return `
      <div style="margin-bottom:14px" class="seg" role="radiogroup" aria-label="Transaction type">
        ${['income', 'expense', 'transfer'].map(x => `<label><input type="radio" name="type" value="${x}"${t.type === x ? ' checked' : ''}>${x === 'income' ? 'Income' : x === 'expense' ? 'Expense' : 'Transfer'}</label>`).join('')}
      </div>
      <div class="form-grid">
        <label class="field">Date<input type="date" name="date" value="${esc(t.date)}" required></label>
        <label class="field">Amount ($)<input name="amount" inputmode="decimal" value="${t.amount ? centsToInput(t.amount) : ''}" placeholder="0.00" required></label>
        <label class="field full">Description<input name="description" value="${esc(t.description)}" placeholder="${t.type === 'income' ? 'e.g. Spring appeal donation' : t.type === 'expense' ? 'e.g. Office rent — May' : 'e.g. Move funds to savings'}"></label>
        ${t.type === 'transfer' ? `
          <label class="field">From account<select name="accountId">${options(state.accounts, t.accountId)}</select></label>
          <label class="field">To account<select name="toAccountId">${options(state.accounts, t.toAccountId)}</select></label>
        ` : `
          <label class="field">Category<select name="categoryId">${options(cats, t.categoryId, { blank: 'Choose…' })}</select></label>
          <label class="field">Fund<select name="fundId">${state.funds.map(f => `<option value="${f.id}"${f.id === t.fundId ? ' selected' : ''}>${esc(f.name)}${f.restricted ? ' (restricted)' : ''}</option>`).join('')}</select></label>
          <label class="field">${t.type === 'income' ? 'Deposited to' : 'Paid from'}<select name="accountId">${options(state.accounts, t.accountId)}</select></label>
          ${t.type === 'income' ? `
            <label class="field">Donor / source (optional)<input name="donor" list="donorList" value="${esc(donorName(t.donorId))}" placeholder="Type a name"><datalist id="donorList">${sortByName(state.donors).map(d => `<option value="${esc(d.name)}">`).join('')}</datalist></label>
          ` : `
            <label class="field">Paid to (vendor/payee)<input name="payee" value="${esc(t.payee)}"></label>
            <label class="field">Function<select name="func">${Object.entries(FUNCTIONS).map(([k, v]) => `<option value="${k}"${(t.func || byId(state.categories, t.categoryId)?.func) === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
          `}
        `}
        <label class="field">Check # / reference<input name="reference" value="${esc(t.reference)}"></label>
        <label class="field full">Notes<textarea name="notes" rows="2">${esc(t.notes)}</textarea></label>
      </div>
      ${t.type === 'expense' ? '<p class="small muted" style="margin:10px 0 0">“Function” says what the expense supported. Program = your mission work; Management & general = admin/overhead; Fundraising = costs of raising money.</p>' : ''}
      <div class="error-msg" id="formError"></div>`;
  };

  // capture current values before re-rendering (e.g. switching type)
  const readForm = () => {
    const fd = new FormData($('#modalForm'));
    for (const [k, v] of fd.entries()) {
      if (k === 'amount') { const c = toCents(v); t.amount = Number.isNaN(c) ? 0 : c; }
      else if (k === 'donor') t._donor = v;
      else t[k] = v;
    }
  };

  openModal({
    title: existing ? 'Edit transaction' : 'New transaction',
    body: body(),
    foot: `<div>${existing ? '<button type="button" class="btn danger" data-modal="delete">Delete</button>' : ''}</div>
           <div class="btn-row"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary" value="save">Save</button></div>`,
    onChange(e) {
      if (e.target.name === 'type') {
        readForm();
        t.type = e.target.value;
        t.categoryId = '';
        $('#modalBody').innerHTML = body();
      } else if (e.target.name === 'categoryId' && t.type === 'expense') {
        const c = byId(state.categories, e.target.value);
        const sel = $('#modalForm [name=func]');
        if (c?.func && sel) sel.value = c.func;
      }
    },
    onDelete() {
      if (!confirm('Delete this transaction? This cannot be undone.')) return false;
      state.transactions = state.transactions.filter(x => x.id !== existing.id);
      save(); render(); toast('Transaction deleted');
      return true;
    },
    onSubmit() {
      readForm();
      const err = msg => { $('#formError').textContent = msg; return false; };
      if (!t.date) return err('Please enter a date.');
      if (!(t.amount > 0)) return err('Please enter an amount greater than zero.');
      if (t.type === 'transfer') {
        if (t.accountId === t.toAccountId) return err('Choose two different accounts for a transfer.');
        t.categoryId = ''; t.fundId = ''; t.donorId = ''; t.func = ''; t.payee = '';
      } else {
        if (!t.categoryId) return err('Please choose a category.');
        t.toAccountId = '';
        if (t.type === 'income') {
          t.func = ''; t.payee = '';
          const name = (t._donor || '').trim();
          if (name) {
            let d = state.donors.find(x => x.name.toLowerCase() === name.toLowerCase());
            if (!d) { d = { id: uid(), name, email: '', address: '', phone: '', notes: '' }; state.donors.push(d); }
            t.donorId = d.id;
          } else t.donorId = '';
        } else {
          t.donorId = '';
          t.func = t.func || byId(state.categories, t.categoryId)?.func || 'management';
        }
      }
      delete t._donor;
      if (existing) {
        Object.assign(byId(state.transactions, existing.id), t);
      } else {
        t.id = uid(); t.created = Date.now();
        state.transactions.push(t);
      }
      save(); render(); toast('Saved');
      return true;
    },
  });
}

/* ---------------- Generic modal ---------------- */
let modalHandlers = {};
function openModal({ title, body, foot, onSubmit, onChange, onDelete }) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  $('#modalFoot').innerHTML = foot || `<div></div><div class="btn-row"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save</button></div>`;
  modalHandlers = { onSubmit, onChange, onDelete };
  const dlg = $('#modal');
  if (!dlg.open) dlg.showModal();
  const first = $('#modalBody input:not([type=radio]), #modalBody select, #modalBody textarea');
  first?.focus();
}
function closeModal() { const d = $('#modal'); if (d.open) d.close(); }
$('#modalForm').addEventListener('submit', e => {
  e.preventDefault();
  if (!modalHandlers.onSubmit || modalHandlers.onSubmit() !== false) closeModal();
});
$('#modalForm').addEventListener('change', e => modalHandlers.onChange?.(e));
$('#modalForm').addEventListener('click', e => {
  if (e.target.closest('[data-close]')) closeModal();
  if (e.target.closest('[data-modal=delete]') && modalHandlers.onDelete?.()) closeModal();
});

/* ---------------- Donors ---------------- */
function donorStats(range) {
  const stats = {};
  for (const t of state.transactions) {
    if (t.type !== 'income' || !t.donorId) continue;
    const s = stats[t.donorId] ||= { total: 0, count: 0, last: '', rangeTotal: 0 };
    s.total += t.amount; s.count++;
    if (t.date > s.last) s.last = t.date;
    if (inRange(t, range)) s.rangeTotal += t.amount;
  }
  return stats;
}
function renderDonors(root) {
  const cy = fyStartYearFor(todayISO());
  const stats = donorStats(fyRange(cy));
  const list = sortByName(state.donors);
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Donors</h1><div class="muted">Donors are added automatically when you record income with a donor name.</div></div>
      <div class="btn-row"><button class="btn primary" data-action="add-donor">+ Donor</button></div>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th class="hide-sm">Email</th><th class="num">${esc(fyLabel(cy))}</th><th class="num hide-sm">Lifetime</th><th class="hide-sm">Last gift</th><th></th></tr></thead>
        <tbody>
          ${list.length ? list.map(d => {
            const s = stats[d.id] || { total: 0, count: 0, last: '', rangeTotal: 0 };
            return `<tr>
              <td><a href="#" data-edit-donor="${d.id}">${esc(d.name)}</a><div class="small muted">${s.count} gift${s.count === 1 ? '' : 's'}</div></td>
              <td class="hide-sm">${esc(d.email)}</td>
              <td class="num">${money(s.rangeTotal)}</td>
              <td class="num hide-sm">${money(s.total)}</td>
              <td class="hide-sm">${prettyDate(s.last) || '—'}</td>
              <td class="num"><button class="btn small" data-receipt="${d.id}">Receipt</button></td>
            </tr>`;
          }).join('') : '<tr><td colspan="6" class="empty">No donors yet.</td></tr>'}
        </tbody>
      </table></div>
    </div>`;
}
function openDonorForm(d) {
  const donor = d ? { ...d } : { name: '', email: '', phone: '', address: '', notes: '' };
  openModal({
    title: d ? 'Edit donor' : 'New donor',
    body: `<div class="form-grid">
      <label class="field full">Name<input name="name" value="${esc(donor.name)}" required></label>
      <label class="field">Email<input type="email" name="email" value="${esc(donor.email)}"></label>
      <label class="field">Phone<input name="phone" value="${esc(donor.phone)}"></label>
      <label class="field full">Mailing address<textarea name="address" rows="2">${esc(donor.address)}</textarea></label>
      <label class="field full">Notes<textarea name="notes" rows="2">${esc(donor.notes)}</textarea></label>
    </div><div class="error-msg" id="formError"></div>`,
    foot: `<div>${d ? '<button type="button" class="btn danger" data-modal="delete">Delete</button>' : ''}</div>
      <div class="btn-row"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save</button></div>`,
    onDelete() {
      const used = state.transactions.some(t => t.donorId === d.id);
      if (!confirm(used ? 'This donor has gifts recorded. Deleting will keep the gifts but remove the donor name from them. Continue?' : 'Delete this donor?')) return false;
      state.transactions.forEach(t => { if (t.donorId === d.id) t.donorId = ''; });
      state.donors = state.donors.filter(x => x.id !== d.id);
      save(); render(); toast('Donor deleted');
      return true;
    },
    onSubmit() {
      const fd = Object.fromEntries(new FormData($('#modalForm')));
      if (!fd.name.trim()) { $('#formError').textContent = 'Name is required.'; return false; }
      const vals = { name: fd.name.trim(), email: fd.email, phone: fd.phone, address: fd.address, notes: fd.notes };
      if (d) Object.assign(byId(state.donors, d.id), vals);
      else state.donors.push({ id: uid(), ...vals });
      save(); render(); toast('Saved');
      return true;
    },
  });
}

/* Year-end giving receipt (printable letter) */
function renderReceipt(donorId, year) {
  const d = byId(state.donors, donorId);
  const range = { from: `${year}-01-01`, to: `${year}-12-31` };
  const gifts = state.transactions.filter(t => t.type === 'income' && t.donorId === donorId && inRange(t, range)).sort((a, b) => a.date.localeCompare(b.date));
  const total = gifts.reduce((s, t) => s + t.amount, 0);
  const o = state.org;
  const years = [...new Set(state.transactions.filter(t => t.donorId === donorId).map(t => Number(t.date.slice(0, 4))))].sort((a, b) => b - a);
  if (!years.includes(year)) years.unshift(year);
  $('#view').innerHTML = `
    <div class="page-head no-print">
      <div><a href="#donors" data-action="back">← Back to donors</a><h1 style="margin-top:6px">Giving receipt</h1></div>
      <div class="btn-row">
        <label class="field">Calendar year<select id="receiptYear">${years.map(y => `<option${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
        <button class="btn primary" onclick="window.print()" style="align-self:flex-end">Print / Save PDF</button>
      </div>
    </div>
    <div class="card"><div class="letter">
      <p><strong>${esc(o.name)}</strong><br>${esc(o.address).replace(/\n/g, '<br>')}${o.ein ? `<br>EIN: ${esc(o.ein)}` : ''}</p>
      <p>${prettyDate(todayISO())}</p>
      <p>${esc(d.name)}<br>${esc(d.address).replace(/\n/g, '<br>')}</p>
      <p>Dear ${esc(d.name)},</p>
      <p>Thank you for your generous support of ${esc(o.name)}. This letter summarizes the contributions we received from you during calendar year ${year}.</p>
      <table>
        <thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${gifts.map(g => `<tr><td>${prettyDate(g.date)}</td><td>${esc(g.description || catName(g.categoryId))}</td><td class="num">${money(g.amount)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No gifts recorded this year.</td></tr>'}
          <tr class="total"><td colspan="2">Total</td><td class="num">${money(total)}</td></tr>
        </tbody>
      </table>
      <p>${esc(o.name)} is a tax-exempt organization under Section 501(c)(3) of the Internal Revenue Code. No goods or services were provided in exchange for these contributions, other than intangible religious benefits, if any.</p>
      <p>Please keep this letter for your tax records.</p>
      <p>With gratitude,<br><br>${esc(o.signer || '')}<br>${esc(o.name)}</p>
    </div></div>`;
  $('#receiptYear').addEventListener('change', e => renderReceipt(donorId, Number(e.target.value)));
}

/* ---------------- Budget ---------------- */
function renderBudget(root) {
  const cy = fyStartYearFor(todayISO());
  const year = ui.budgetYear ?? cy;
  const range = fyRange(year);
  const budget = state.budgets[year] || {};
  const actual = {};
  state.transactions.forEach(t => { if (t.categoryId && inRange(t, range)) actual[t.categoryId] = (actual[t.categoryId] || 0) + t.amount; });

  const section = (kind, title) => {
    const cats = state.categories.filter(c => c.kind === kind);
    let tb = 0, ta = 0;
    const rows = cats.map(c => {
      const b = budget[c.id] || 0, a = actual[c.id] || 0;
      tb += b; ta += a;
      const pct = b ? Math.round((a / b) * 100) : null;
      const over = kind === 'expense' && b && a > b;
      const variance = kind === 'income' ? a - b : b - a;
      return `<tr>
        <td>${esc(c.name)}</td>
        <td class="num"><input class="budget-input" data-cat="${c.id}" inputmode="decimal" value="${b ? centsToInput(b) : ''}" placeholder="0.00" style="width:110px;text-align:right" aria-label="Budget for ${esc(c.name)}"></td>
        <td class="num">${money(a)}</td>
        <td class="num ${b ? (variance < 0 ? 'neg' : 'pos') : 'muted'}">${b ? money(variance, { sign: true }) : '—'}</td>
        <td class="hide-sm" style="width:140px">${b ? `<div class="progress" title="${pct}% of budget"><span class="${over ? 'over' : ''}" style="width:${Math.min(100, pct)}%"></span></div><div class="small muted">${pct}%</div>` : ''}</td>
      </tr>`;
    }).join('');
    return { html: `<tr class="section"><td colspan="5">${title}</td></tr>${rows}<tr class="subtotal"><td>Total ${title.toLowerCase()}</td><td class="num">${money(tb)}</td><td class="num">${money(ta)}</td><td class="num">${money(kind === 'income' ? ta - tb : tb - ta, { sign: true })}</td><td class="hide-sm"></td></tr>`, tb, ta };
  };
  const inc = section('income', 'Revenue'), exp = section('expense', 'Expenses');
  const yearOpts = [cy - 2, cy - 1, cy, cy + 1];

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Budget vs. actual</h1><div class="muted">Enter your annual budget for each category. Positive variance = good news.</div></div>
      <div class="btn-row">
        <label class="field">Fiscal year<select id="budgetYear">${yearOpts.map(y => `<option value="${y}"${y === year ? ' selected' : ''}>${fyLabel(y)}</option>`).join('')}</select></label>
        <button class="btn no-print" data-action="copy-budget" style="align-self:flex-end">Copy from prior year</button>
        <button class="btn no-print" onclick="window.print()" style="align-self:flex-end">Print</button>
      </div>
    </div>
    <div class="card"><div class="table-wrap"><table class="budget-table">
      <thead><tr><th>Category</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Variance</th><th class="hide-sm">Used</th></tr></thead>
      <tbody>${inc.html}${exp.html}
        <tr class="total"><td>Net (revenue − expenses)</td><td class="num">${money(inc.tb - exp.tb, { sign: true })}</td><td class="num">${money(inc.ta - exp.ta, { sign: true })}</td><td class="num">${money((inc.ta - exp.ta) - (inc.tb - exp.tb), { sign: true })}</td><td class="hide-sm"></td></tr>
      </tbody>
    </table></div></div>`;

  $('#budgetYear').addEventListener('change', e => { ui.budgetYear = Number(e.target.value); render(); });
  $$('.budget-input').forEach(inp => inp.addEventListener('change', () => {
    const c = toCents(inp.value);
    state.budgets[year] ||= {};
    if (!inp.value.trim() || Number.isNaN(c)) delete state.budgets[year][inp.dataset.cat];
    else state.budgets[year][inp.dataset.cat] = c;
    save(); render(); toast('Budget updated');
  }));
}

/* ---------------- Reports ---------------- */
const REPORTS = {
  activities: 'Statement of Activities',
  position: 'Statement of Financial Position',
  functional: 'Functional Expenses',
  funds: 'Fund Activity',
  donors: 'Donor Giving',
};
function reportRange() {
  if (ui.reportPeriod === 'custom') return { from: ui.customRange.from || '0000-01-01', to: ui.customRange.to || '9999-12-31' };
  return periodPresets()[ui.reportPeriod];
}
function rangeText(r) {
  if (r.from === '0000-01-01' && r.to === '9999-12-31') return 'All time';
  if (r.from === '0000-01-01') return `Through ${prettyDate(r.to)}`;
  if (r.to === '9999-12-31') return `From ${prettyDate(r.from)}`;
  return `${prettyDate(r.from)} – ${prettyDate(r.to)}`;
}
function renderReports(root) {
  const presets = periodPresets();
  const r = reportRange();
  root.innerHTML = `
    <div class="page-head no-print">
      <div><h1>Reports</h1><div class="muted">Standard nonprofit financial statements. Print or save as PDF for your board.</div></div>
      <button class="btn primary" onclick="window.print()">Print / Save PDF</button>
    </div>
    <div class="subtabs">${Object.entries(REPORTS).map(([k, v]) => `<button data-report="${k}" class="${ui.reportTab === k ? 'active' : ''}">${v}</button>`).join('')}</div>
    <div class="filters" id="periodFilters">
      <label class="field">Period<select name="period">
        ${Object.entries(presets).map(([k, p]) => `<option value="${k}"${ui.reportPeriod === k ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}
        <option value="custom"${ui.reportPeriod === 'custom' ? ' selected' : ''}>Custom dates…</option>
      </select></label>
      ${ui.reportPeriod === 'custom' ? `
        <label class="field">From<input type="date" name="from" value="${esc(ui.customRange.from)}"></label>
        <label class="field">To<input type="date" name="to" value="${esc(ui.customRange.to)}"></label>` : ''}
    </div>
    <div class="card" id="reportBody"></div>`;

  $('#periodFilters').addEventListener('change', e => {
    if (e.target.name === 'period') ui.reportPeriod = e.target.value;
    else ui.customRange[e.target.name] = e.target.value;
    render();
  });
  const head = title => `<div class="report-title"><div class="muted">${esc(state.org.name)}</div><h2>${title}</h2><div class="muted small">${ui.reportTab === 'position' ? `As of ${prettyDate(r.to === '9999-12-31' ? todayISO() : r.to)}` : rangeText(r)}</div></div>`;
  const body = { activities: reportActivities, position: reportPosition, functional: reportFunctional, funds: reportFunds, donors: reportDonors }[ui.reportTab](r);
  $('#reportBody').innerHTML = head(REPORTS[ui.reportTab]) + `<div class="table-wrap">${body}</div>`;
}

function reportActivities(r) {
  const restricted = new Set(state.funds.filter(f => f.restricted).map(f => f.id));
  const rows = {};
  for (const t of state.transactions) {
    if (!inRange(t, r) || t.type === 'transfer') continue;
    const row = rows[t.categoryId] ||= { u: 0, rs: 0 };
    if (restricted.has(t.fundId)) row.rs += t.amount; else row.u += t.amount;
  }
  const block = (kind) => {
    let u = 0, rs = 0;
    const html = sortByName(state.categories.filter(c => c.kind === kind)).filter(c => rows[c.id]).map(c => {
      u += rows[c.id].u; rs += rows[c.id].rs;
      return `<tr><td class="indent">${esc(c.name)}</td><td class="num">${money(rows[c.id].u)}</td><td class="num">${money(rows[c.id].rs)}</td><td class="num">${money(rows[c.id].u + rows[c.id].rs)}</td></tr>`;
    }).join('') || '<tr><td class="indent muted" colspan="4">None</td></tr>';
    return { html, u, rs };
  };
  const inc = block('income'), exp = block('expense');
  const before = r.from === '0000-01-01' ? null : dayBefore(r.from);
  const netStart = f => before ? state.funds.filter(f).reduce((s, x) => s + fundBalance(x.id, before), 0) : state.funds.filter(f).reduce((s, x) => s + (x.opening || 0), 0);
  const startU = netStart(f => !f.restricted), startR = netStart(f => f.restricted);
  const chgU = inc.u - exp.u, chgR = inc.rs - exp.rs;
  return `<table>
    <thead><tr><th></th><th class="num">Without donor restrictions</th><th class="num">With donor restrictions</th><th class="num">Total</th></tr></thead>
    <tbody>
      <tr class="section"><td colspan="4">Revenue &amp; support</td></tr>${inc.html}
      <tr class="subtotal"><td>Total revenue &amp; support</td><td class="num">${money(inc.u)}</td><td class="num">${money(inc.rs)}</td><td class="num">${money(inc.u + inc.rs)}</td></tr>
      <tr class="section"><td colspan="4">Expenses</td></tr>${exp.html}
      <tr class="subtotal"><td>Total expenses</td><td class="num">${money(exp.u)}</td><td class="num">${money(exp.rs)}</td><td class="num">${money(exp.u + exp.rs)}</td></tr>
      <tr class="total"><td>Change in net assets</td><td class="num">${money(chgU)}</td><td class="num">${money(chgR)}</td><td class="num">${money(chgU + chgR)}</td></tr>
      <tr><td>Net assets, beginning of period</td><td class="num">${money(startU)}</td><td class="num">${money(startR)}</td><td class="num">${money(startU + startR)}</td></tr>
      <tr class="total"><td>Net assets, end of period</td><td class="num">${money(startU + chgU)}</td><td class="num">${money(startR + chgR)}</td><td class="num">${money(startU + chgU + startR + chgR)}</td></tr>
    </tbody></table>
    <p class="small muted">Expenses paid from a restricted fund are shown in the “With donor restrictions” column, which reflects the restriction being used up.</p>`;
}

function reportPosition(r) {
  const asOf = r.to === '9999-12-31' ? todayISO() : r.to;
  const cash = state.accounts.map(a => ({ a, bal: accountBalance(a.id, asOf) }));
  const totalAssets = cash.reduce((s, x) => s + x.bal, 0);
  const funds = state.funds.map(f => ({ f, bal: fundBalance(f.id, asOf) }));
  const u = funds.filter(x => !x.f.restricted).reduce((s, x) => s + x.bal, 0);
  const rs = funds.filter(x => x.f.restricted).reduce((s, x) => s + x.bal, 0);
  const diff = totalAssets - (u + rs);
  return `<table><tbody>
    <tr class="section"><td colspan="2">Assets</td></tr>
    ${cash.map(x => `<tr><td class="indent">${esc(x.a.name)}</td><td class="num">${money(x.bal)}</td></tr>`).join('')}
    <tr class="total"><td>Total assets</td><td class="num">${money(totalAssets)}</td></tr>
    <tr class="section"><td colspan="2">Net assets</td></tr>
    <tr><td class="indent">Without donor restrictions</td><td class="num">${money(u)}</td></tr>
    ${funds.filter(x => !x.f.restricted).map(x => `<tr><td class="indent small muted" style="padding-left:44px">${esc(x.f.name)}</td><td class="num small muted">${money(x.bal)}</td></tr>`).join('')}
    <tr><td class="indent">With donor restrictions</td><td class="num">${money(rs)}</td></tr>
    ${funds.filter(x => x.f.restricted).map(x => `<tr><td class="indent small muted" style="padding-left:44px">${esc(x.f.name)}</td><td class="num small muted">${money(x.bal)}</td></tr>`).join('')}
    <tr class="total"><td>Total net assets</td><td class="num">${money(u + rs)}</td></tr>
  </tbody></table>
  ${diff !== 0 ? `<p class="callout small" style="margin-top:12px"><strong>Heads up:</strong> total assets and total net assets differ by ${money(diff)}. This usually means the starting balances of your accounts and funds (in Settings) don’t add up to the same total. Adjust them so they match.</p>` : ''}
  <p class="small muted">This app tracks cash accounts only. If you have receivables, payables, or equipment, ask your accountant to add those at year-end.</p>`;
}

function reportFunctional(r) {
  const rows = {};
  const tot = { program: 0, management: 0, fundraising: 0 };
  for (const t of state.transactions) {
    if (t.type !== 'expense' || !inRange(t, r)) continue;
    const f = t.func || 'management';
    const row = rows[t.categoryId] ||= { program: 0, management: 0, fundraising: 0 };
    row[f] += t.amount; tot[f] += t.amount;
  }
  const all = tot.program + tot.management + tot.fundraising;
  const cats = sortByName(state.categories.filter(c => c.kind === 'expense' && rows[c.id]));
  return `<table>
    <thead><tr><th>Expense</th><th class="num">Program services</th><th class="num">Management &amp; general</th><th class="num">Fundraising</th><th class="num">Total</th></tr></thead>
    <tbody>
      ${cats.map(c => { const x = rows[c.id]; return `<tr><td>${esc(c.name)}</td><td class="num">${money(x.program)}</td><td class="num">${money(x.management)}</td><td class="num">${money(x.fundraising)}</td><td class="num">${money(x.program + x.management + x.fundraising)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">No expenses in this period.</td></tr>'}
      <tr class="total"><td>Total expenses</td><td class="num">${money(tot.program)}</td><td class="num">${money(tot.management)}</td><td class="num">${money(tot.fundraising)}</td><td class="num">${money(all)}</td></tr>
      ${all ? `<tr><td class="muted">Percent of total</td>${['program', 'management', 'fundraising'].map(k => `<td class="num muted">${((tot[k] / all) * 100).toFixed(1)}%</td>`).join('')}<td class="num muted">100%</td></tr>` : ''}
    </tbody></table>
    <p class="small muted">This matches the layout of Part IX of IRS Form 990 (Statement of Functional Expenses).</p>`;
}

function reportFunds(r) {
  const before = r.from === '0000-01-01' ? null : dayBefore(r.from);
  const rows = state.funds.map(f => {
    let inc = 0, exp = 0;
    state.transactions.forEach(t => { if (t.fundId === f.id && inRange(t, r)) { if (t.type === 'income') inc += t.amount; if (t.type === 'expense') exp += t.amount; } });
    const start = before ? fundBalance(f.id, before) : (f.opening || 0);
    return { f, start, inc, exp, end: start + inc - exp };
  });
  const sum = k => rows.reduce((s, x) => s + x[k], 0);
  return `<table>
    <thead><tr><th>Fund</th><th class="num">Beginning</th><th class="num">Revenue</th><th class="num">Expenses</th><th class="num">Ending</th></tr></thead>
    <tbody>
      ${rows.map(x => `<tr><td>${esc(x.f.name)}<div class="small muted">${x.f.restricted ? 'With donor restrictions' : 'Without donor restrictions'}</div></td><td class="num">${money(x.start)}</td><td class="num">${money(x.inc)}</td><td class="num">${money(x.exp)}</td><td class="num ${x.end < 0 ? 'neg' : ''}">${money(x.end)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="num">${money(sum('start'))}</td><td class="num">${money(sum('inc'))}</td><td class="num">${money(sum('exp'))}</td><td class="num">${money(sum('end'))}</td></tr>
    </tbody></table>
    ${rows.some(x => x.f.restricted && x.end < 0) ? '<p class="callout small" style="margin-top:12px"><strong>Heads up:</strong> a restricted fund has a negative balance, meaning more was spent from it than was given for that purpose. Check that those expenses were coded to the right fund.</p>' : ''}`;
}

function reportDonors(r) {
  const totals = {};
  state.transactions.forEach(t => {
    if (t.type !== 'income' || !inRange(t, r)) return;
    if (t.donorId) { const x = totals[t.donorId] ||= { amt: 0, n: 0 }; x.amt += t.amount; x.n++; }
  });
  const rows = Object.entries(totals).map(([id, x]) => ({ name: donorName(id), ...x })).sort((a, b) => b.amt - a.amt);
  const total = rows.reduce((s, x) => s + x.amt, 0);
  return `<table>
    <thead><tr><th>Donor</th><th class="num">Gifts</th><th class="num">Total given</th></tr></thead>
    <tbody>
      ${rows.map(x => `<tr><td>${esc(x.name)}</td><td class="num">${x.n}</td><td class="num">${money(x.amt)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No donor gifts in this period.</td></tr>'}
      <tr class="total"><td>Total from named donors</td><td class="num">${rows.reduce((s, x) => s + x.n, 0)}</td><td class="num">${money(total)}</td></tr>
    </tbody></table>
    <p class="small muted">Gifts recorded without a donor name are not listed here.</p>`;
}

/* ---------------- Settings ---------------- */
function renderSettings(root) {
  const o = state.org;
  const listSection = (title, key, cols, help) => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h2>${title}</h2><button class="btn small" data-add="${key}">+ Add</button></div>
      ${help ? `<p class="small muted" style="margin-top:0">${help}</p>` : ''}
      <div class="table-wrap"><table><tbody>
        ${cols().join('')}
      </tbody></table></div>
    </div>`;
  root.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><div class="muted">Your organization, accounts, funds, and categories.</div></div></div>
    <div class="stack">
      <form class="card" id="orgForm">
        <h2>Organization</h2>
        <div class="form-grid">
          <label class="field">Organization name<input name="name" value="${esc(o.name)}"></label>
          <label class="field">EIN (tax ID)<input name="ein" value="${esc(o.ein)}" placeholder="12-3456789"></label>
          <label class="field">Email<input name="email" value="${esc(o.email)}"></label>
          <label class="field">Fiscal year starts in<select name="fyStartMonth">${MONTHS_LONG.map((m, i) => `<option value="${i + 1}"${o.fyStartMonth === i + 1 ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
          <label class="field full">Mailing address<textarea name="address" rows="2">${esc(o.address)}</textarea></label>
          <label class="field">Name that signs donor receipts<input name="signer" value="${esc(o.signer)}" placeholder="e.g. Jane Doe, Treasurer"></label>
        </div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary" type="submit">Save organization</button></div>
      </form>

      <div class="grid grid-2">
        ${listSection('Bank & cash accounts', 'accounts', () => state.accounts.map(a => `<tr class="clickable" data-edit="accounts:${a.id}"><td>${esc(a.name)}<div class="small muted">Starting balance ${money(a.opening || 0)}</div></td><td class="num">${money(accountBalance(a.id))}</td></tr>`), 'Where your money is kept. Enter the balance on the day you start using this app.')}
        ${listSection('Funds', 'funds', () => state.funds.map(f => `<tr class="clickable" data-edit="funds:${f.id}"><td>${esc(f.name)}<div class="small muted">${f.restricted ? 'With donor restrictions' : 'Without donor restrictions'} · Starting ${money(f.opening || 0)}</div></td><td class="num">${money(fundBalance(f.id))}</td></tr>`), 'Separate money that donors restricted to a specific purpose (e.g. a grant for a youth program) from your general money.')}
      </div>

      <div class="grid grid-2">
        ${listSection('Income categories', 'income', () => sortByName(state.categories.filter(c => c.kind === 'income')).map(c => `<tr class="clickable" data-edit="categories:${c.id}"><td>${esc(c.name)}</td></tr>`))}
        ${listSection('Expense categories', 'expense', () => sortByName(state.categories.filter(c => c.kind === 'expense')).map(c => `<tr class="clickable" data-edit="categories:${c.id}"><td>${esc(c.name)}</td><td class="small muted num">${FUNCTIONS[c.func] || ''}</td></tr>`))}
      </div>

      <div class="card">
        <h2>Your data</h2>
        <p class="small muted" style="margin-top:0">Your books are saved <strong>only in this web browser on this device</strong>. Download a backup regularly (for example, monthly) and keep it somewhere safe, like Google Drive. You can restore it on any computer.</p>
        <div class="btn-row">
          <button class="btn primary" data-action="backup">Download backup</button>
          <label class="btn">Restore from backup<input type="file" accept=".json,application/json" id="restoreFile" hidden></label>
          <button class="btn" data-action="export-csv-all">Export all transactions (CSV)</button>
          <button class="btn" data-action="load-sample">Load sample data</button>
          <button class="btn danger" data-action="reset">Erase everything</button>
        </div>
      </div>
    </div>`;

  $('#orgForm').addEventListener('submit', e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    Object.assign(state.org, { ...fd, name: fd.name.trim() || 'My Nonprofit', fyStartMonth: Number(fd.fyStartMonth) });
    save(); render(); toast('Organization saved');
  });
  $('#restoreFile').addEventListener('change', e => { restoreBackup(e.target.files[0]); e.target.value = ''; });
}

function openListItemForm(listKey, item, kind) {
  const isCat = listKey === 'categories';
  const x = item ? { ...item } : { name: '', opening: 0, restricted: false, type: 'bank', kind, func: kind === 'expense' ? 'program' : null };
  const label = { accounts: 'account', funds: 'fund', categories: `${x.kind} category` }[listKey];
  openModal({
    title: `${item ? 'Edit' : 'New'} ${label}`,
    body: `<div class="form-grid">
      <label class="field full">Name<input name="name" value="${esc(x.name)}" required></label>
      ${listKey !== 'categories' ? `<label class="field">Starting balance ($)<input name="opening" inputmode="decimal" value="${centsToInput(x.opening || 0)}"></label>` : ''}
      ${listKey === 'funds' ? `<label class="check full"><input type="checkbox" name="restricted"${x.restricted ? ' checked' : ''}> Donor-restricted (can only be used for a specific purpose or time)</label>` : ''}
      ${isCat && x.kind === 'expense' ? `<label class="field">Usual function<select name="func">${Object.entries(FUNCTIONS).map(([k, v]) => `<option value="${k}"${x.func === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
    </div><div class="error-msg" id="formError"></div>`,
    foot: `<div>${item ? '<button type="button" class="btn danger" data-modal="delete">Delete</button>' : ''}</div>
      <div class="btn-row"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save</button></div>`,
    onDelete() {
      const field = { accounts: 'accountId', funds: 'fundId', categories: 'categoryId' }[listKey];
      const used = state.transactions.some(t => t[field] === item.id || (listKey === 'accounts' && t.toAccountId === item.id));
      if (used) { alert(`This ${label} is used by existing transactions, so it can't be deleted. You can rename it instead, or move those transactions first.`); return false; }
      if (listKey !== 'categories' && state[listKey].length <= 1) { alert(`You need at least one ${label}.`); return false; }
      if (!confirm(`Delete “${item.name}”?`)) return false;
      state[listKey] = state[listKey].filter(y => y.id !== item.id);
      save(); render(); toast('Deleted');
      return true;
    },
    onSubmit() {
      const form = $('#modalForm');
      const fd = Object.fromEntries(new FormData(form));
      if (!fd.name?.trim()) { $('#formError').textContent = 'Name is required.'; return false; }
      const vals = { name: fd.name.trim() };
      if (listKey !== 'categories') {
        const c = toCents(fd.opening || 0);
        if (Number.isNaN(c)) { $('#formError').textContent = 'Starting balance must be a number.'; return false; }
        vals.opening = c;
      }
      if (listKey === 'funds') vals.restricted = !!form.restricted.checked;
      if (isCat) { vals.kind = x.kind; vals.func = x.kind === 'expense' ? fd.func : null; }
      if (item) Object.assign(byId(state[listKey], item.id), vals);
      else state[listKey].push({ id: uid(), ...vals });
      save(); render(); toast('Saved');
      return true;
    },
  });
}

/* ---------------- Import / export ---------------- */
function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
function exportCSV(list) {
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = ['Date', 'Type', 'Amount', 'Description', 'Category', 'Function', 'Fund', 'Account', 'To Account', 'Donor', 'Payee', 'Reference', 'Notes'];
  const rows = [...list].sort((a, b) => a.date.localeCompare(b.date)).map(t => [
    t.date, t.type, (t.type === 'expense' ? -t.amount : t.amount) / 100, t.description,
    t.type === 'transfer' ? '' : catName(t.categoryId), t.func ? FUNCTIONS[t.func] : '', t.fundId ? fundName(t.fundId) : '',
    acctName(t.accountId), t.toAccountId ? acctName(t.toAccountId) : '', donorName(t.donorId), t.payee, t.reference, t.notes,
  ]);
  download(`transactions-${todayISO()}.csv`, [header, ...rows].map(r => r.map(q).join(',')).join('\n'), 'text/csv');
}
function restoreBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.transactions) || !data.org) throw new Error('Not a backup file');
      if (!confirm('Replace ALL current data with this backup?')) return;
      state = normalize(data);
      save(); render(); toast('Backup restored');
    } catch (e) {
      alert('That file could not be read as a Nonprofit Books backup.');
    }
  };
  reader.readAsText(file);
}

/* Sample data so people can explore the app */
function loadSample() {
  const s = defaultState();
  s.org = { ...s.org, name: 'Riverside Community Garden', ein: '12-3456789', address: '100 River Rd\nSpringfield, ST 00000', email: 'hello@example.org', signer: 'Alex Rivera, Treasurer' };
  const [checking, savings] = s.accounts;
  checking.opening = 1250000; savings.opening = 500000;
  const [general, grants] = s.funds;
  general.opening = 1750000;
  grants.name = 'Youth Garden Grant';
  const cat = n => s.categories.find(c => c.name === n);
  const donors = ['Maria Lopez', 'James Chen', 'Priya Patel', 'The Okafor Family', 'Sam Nguyen', 'Green Valley Bank'].map(name => ({ id: uid(), name, email: '', phone: '', address: '', notes: '' }));
  s.donors = donors;
  const cy = (() => { const t = new Date(); return t.getFullYear(); })();
  const tx = [];
  const add = (m, d, type, amt, desc, c, extra = {}) => {
    const date = new Date(cy, m, d);
    if (date > new Date()) return;
    const category = c ? cat(c) : null;
    tx.push({ id: uid(), created: Date.now() + tx.length, type, date: isoDate(date), amount: Math.round(amt * 100), description: desc, categoryId: category?.id || '',
      fundId: general.id, accountId: checking.id, toAccountId: '', donorId: '', payee: '', reference: '', func: type === 'expense' ? category.func : '', notes: '', ...extra });
  };
  for (let m = 0; m < 12; m++) {
    add(m, 1, 'expense', 900, `Garden plot lease — ${MONTHS_LONG[m]}`, 'Rent & Utilities', { payee: 'City Parks Dept.' });
    add(m, 15, 'expense', 1800, `Coordinator wages — ${MONTHS_LONG[m]}`, 'Salaries & Wages', { payee: 'Payroll' });
    add(m, 15, 'expense', 240, 'Payroll taxes', 'Payroll Taxes & Benefits', { func: 'management', payee: 'IRS' });
    add(m, 5, 'income', 150 + (m % 4) * 60, 'Monthly donation', 'Individual Donations', { donorId: donors[0].id });
    add(m, 20, 'income', 100, 'Monthly donation', 'Individual Donations', { donorId: donors[1].id });
    add(m, 10, 'expense', 49, 'Accounting software', 'Technology & Software', { payee: 'SaaS Co.' });
    add(m, 22, 'income', 300 + (m * 37) % 400, 'Plot rental fees', 'Program Service Fees');
    add(m, 25, 'expense', 12.5, 'Card processing fees', 'Bank & Payment Fees');
  }
  add(0, 20, 'income', 10000, 'General operating support grant', 'Grants', { reference: 'CF-118' });
  add(1, 3, 'income', 15000, 'Youth garden program grant', 'Grants', { fundId: grants.id, donorId: donors[5].id, reference: 'GR-2201' });
  add(2, 12, 'expense', 2350, 'Seeds, soil, and tools for youth program', 'Program Supplies', { fundId: grants.id, payee: 'Farm Supply Co.' });
  add(4, 18, 'income', 6400, 'Spring plant sale', 'Fundraising Events');
  add(4, 10, 'expense', 850, 'Plant sale flyers and supplies', 'Fundraising Expenses', { payee: 'PrintShop' });
  add(5, 2, 'expense', 1200, 'Liability insurance (annual)', 'Insurance', { payee: 'Mutual Insurance' });
  add(5, 20, 'income', 2500, 'Major gift', 'Individual Donations', { donorId: donors[2].id, reference: '1042' });
  add(6, 8, 'expense', 3100, 'Youth summer camp supplies & field trips', 'Program Supplies', { fundId: grants.id, payee: 'Various' });
  add(7, 14, 'income', 750, 'Gift in honor of Grandma Okafor', 'Individual Donations', { donorId: donors[3].id });
  add(7, 30, 'income', 400, 'Donation', 'Individual Donations', { donorId: donors[4].id });
  add(8, 5, 'expense', 900, 'Annual financial review', 'Professional Fees', { payee: 'Smith CPA' });
  add(8, 28, 'transfer', 3000, 'Move reserves to savings', null, { accountId: checking.id, toAccountId: savings.id, fundId: '', func: '' });
  add(9, 15, 'income', 5000, 'Harvest dinner sponsorship', 'Corporate Sponsorships', { donorId: donors[5].id });
  add(10, 28, 'income', 1200, 'Giving Tuesday campaign', 'Individual Donations');
  add(11, 15, 'income', 1000, 'Year-end gift', 'Individual Donations', { donorId: donors[2].id });
  s.transactions = tx;
  const b = {};
  const fy = new Date().getFullYear();
  [['Individual Donations', 12000], ['Grants', 25000], ['Program Service Fees', 6000], ['Fundraising Events', 5000], ['Corporate Sponsorships', 4000],
   ['Salaries & Wages', 21600], ['Rent & Utilities', 10800], ['Program Supplies', 6000], ['Payroll Taxes & Benefits', 2880], ['Fundraising Expenses', 1000], ['Insurance', 1200], ['Professional Fees', 1000]]
    .forEach(([n, v]) => { b[cat(n).id] = v * 100; });
  s.budgets = { [fy]: b };
  state = s;
  save();
}

/* =========================================================================
 * Global click handling (event delegation)
 * ========================================================================= */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action],[data-edit-tx],[data-edit-donor],[data-receipt],[data-report],[data-add],[data-edit]');
  if (!el) return;

  if (el.dataset.editTx) return openTxForm(byId(state.transactions, el.dataset.editTx));
  if (el.dataset.editDonor) { e.preventDefault(); return openDonorForm(byId(state.donors, el.dataset.editDonor)); }
  if (el.dataset.receipt) return renderReceipt(el.dataset.receipt, new Date().getFullYear() - (new Date().getMonth() < 2 ? 1 : 0));
  if (el.dataset.report) { ui.reportTab = el.dataset.report; return render(); }
  if (el.dataset.add) {
    const k = el.dataset.add;
    return k === 'income' || k === 'expense' ? openListItemForm('categories', null, k) : openListItemForm(k, null);
  }
  if (el.dataset.edit) {
    const [list, id] = el.dataset.edit.split(':');
    return openListItemForm(list, byId(state[list], id));
  }

  switch (el.dataset.action) {
    case 'back': e.preventDefault(); return render();
    case 'add-tx': return openTxForm(null, el.dataset.type);
    case 'export-csv': return exportCSV(filteredTransactions());
    case 'export-csv-all': return exportCSV(state.transactions);
    case 'clear-filters':
      ui.txFilter = { q: '', type: '', categoryId: '', fundId: '', accountId: '', from: '', to: '' };
      return render();
    case 'backup':
      return download(`nonprofit-books-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
    case 'load-sample':
      if (state.transactions.length && !confirm('This replaces your current data with sample data. Download a backup first if you want to keep it. Continue?')) return;
      loadSample(); location.hash = '#dashboard'; render(); return toast('Sample data loaded');
    case 'reset':
      if (!confirm('Erase ALL data in this browser? Download a backup first if you want to keep it.')) return;
      if (!confirm('Are you absolutely sure? This cannot be undone.')) return;
      state = defaultState(); save(); render(); return toast('All data erased');
    case 'copy-budget': {
      const y = ui.budgetYear ?? fyStartYearFor(todayISO());
      const prev = state.budgets[y - 1];
      if (!prev) return alert('There is no budget for the prior year to copy.');
      if (state.budgets[y] && Object.keys(state.budgets[y]).length && !confirm('Replace this year’s budget with last year’s?')) return;
      state.budgets[y] = { ...prev }; save(); render(); return toast('Budget copied');
    }
  }
});

render();
