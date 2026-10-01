/*
 * Nonprofit Books — a simple bookkeeping app for small nonprofits.
 *
 * Everything runs in the browser. Data is saved to the browser's localStorage,
 * so use Settings → "Download backup" regularly to keep a copy of your books.
 *
 * Money is stored as whole cents (integers) to avoid rounding errors.
 * The books are kept on the cash basis: income is recorded when received and
 * expenses when paid.
 */
'use strict';

/* =========================================================================
 * Helpers
 * ========================================================================= */
const STORAGE_KEY = 'nonprofit-books-v1';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FUNCTIONS = { program: 'Program services', management: 'Management & general', fundraising: 'Fundraising' };
const ALL_TIME_FROM = '0000-01-01';
const ALL_TIME_TO = '9999-12-31';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoDate(new Date());
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
function dayBefore(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d - 1));
}
/* Same date n years later/earlier (Feb 29 becomes Feb 28). */
function shiftYear(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dim = new Date(y + n, m, 0).getDate();
  return `${y + n}-${pad(m)}-${pad(Math.min(d, dim))}`;
}

/* =========================================================================
 * Chart of accounts defaults & IRS Form 990 lines
 * ========================================================================= */
const F990_LINES = [
  ['VIII-1b', '1b', 'Membership dues'],
  ['VIII-1c', '1c', 'Fundraising events (contribution portion)'],
  ['VIII-1e', '1e', 'Government grants (contributions)'],
  ['VIII-1f', '1f', 'All other contributions, gifts, grants'],
  ['VIII-2', '2', 'Program service revenue'],
  ['VIII-3', '3', 'Investment income (interest, dividends)'],
  ['VIII-8a', '8a', 'Fundraising events, gross income'],
  ['VIII-11', '11', 'Other revenue'],
  ['IX-1', '1', 'Grants to domestic organizations and governments'],
  ['IX-2', '2', 'Grants and other assistance to domestic individuals'],
  ['IX-5', '5', 'Compensation of officers, directors, key employees'],
  ['IX-7', '7', 'Other salaries and wages'],
  ['IX-8', '8', 'Pension plan contributions'],
  ['IX-9', '9', 'Other employee benefits'],
  ['IX-10', '10', 'Payroll taxes'],
  ['IX-11b', '11b', 'Legal fees'],
  ['IX-11c', '11c', 'Accounting fees'],
  ['IX-11e', '11e', 'Professional fundraising services'],
  ['IX-11g', '11g', 'Other fees for services'],
  ['IX-12', '12', 'Advertising and promotion'],
  ['IX-13', '13', 'Office expenses'],
  ['IX-14', '14', 'Information technology'],
  ['IX-16', '16', 'Occupancy'],
  ['IX-17', '17', 'Travel'],
  ['IX-19', '19', 'Conferences, conventions, and meetings'],
  ['IX-20', '20', 'Interest'],
  ['IX-22', '22', 'Depreciation'],
  ['IX-23', '23', 'Insurance'],
  ['IX-24', '24', 'Other expenses'],
];
const F990 = Object.fromEntries(F990_LINES.map(([k, line, label]) => [k, { line, label }]));

// [name, kind, usual function, account number, Form 990 line]
const CATEGORY_DEFAULTS = [
  ['Individual Donations', 'income', null, '4010', 'VIII-1f'],
  ['Grants', 'income', null, '4020', 'VIII-1f'],
  ['Corporate Sponsorships', 'income', null, '4030', 'VIII-1f'],
  ['Program Service Fees', 'income', null, '4100', 'VIII-2'],
  ['Fundraising Events', 'income', null, '4200', 'VIII-8a'],
  ['In-Kind Contributions', 'income', null, '4300', 'VIII-1f'],
  ['Interest Income', 'income', null, '4400', 'VIII-3'],
  ['Other Income', 'income', null, '4900', 'VIII-11'],
  ['Salaries & Wages', 'expense', 'program', '5010', 'IX-7'],
  ['Payroll Taxes & Benefits', 'expense', 'program', '5020', 'IX-10'],
  ['Program Supplies', 'expense', 'program', '5100', 'IX-24'],
  ['Travel & Meetings', 'expense', 'program', '5200', 'IX-17'],
  ['Rent & Utilities', 'expense', 'management', '6010', 'IX-16'],
  ['Office Supplies', 'expense', 'management', '6020', 'IX-13'],
  ['Professional Fees', 'expense', 'management', '6030', 'IX-11g'],
  ['Insurance', 'expense', 'management', '6040', 'IX-23'],
  ['Technology & Software', 'expense', 'management', '6050', 'IX-14'],
  ['Bank & Payment Fees', 'expense', 'management', '6060', 'IX-24'],
  ['Other Expenses', 'expense', 'management', '6900', 'IX-24'],
  ['Fundraising Expenses', 'expense', 'fundraising', '7010', 'IX-24'],
];
const CATEGORY_META = Object.fromEntries(CATEGORY_DEFAULTS.map(([name, , , code, line]) => [name, { code, line }]));

/* =========================================================================
 * Data (state) — load, save, defaults
 * ========================================================================= */
function defaultState() {
  return {
    version: 2,
    org: { name: 'My Nonprofit', ein: '', address: '', email: '', signer: '', mission: '', fyStartMonth: 1, lockDate: '' },
    accounts: [
      { id: uid(), code: '1010', name: 'Checking', type: 'bank', opening: 0 },
      { id: uid(), code: '1020', name: 'Savings', type: 'bank', opening: 0 },
      { id: uid(), code: '1030', name: 'Petty Cash', type: 'cash', opening: 0 },
    ],
    funds: [
      { id: uid(), code: '3010', name: 'General Operating', restricted: false, opening: 0 },
      { id: uid(), code: '3110', name: 'Restricted Grants', restricted: true, opening: 0 },
    ],
    categories: CATEGORY_DEFAULTS.map(([name, kind, func, code, line990]) => ({ id: uid(), name, kind, func, code, line990 })),
    donors: [],
    transactions: [],
    budgets: {}, // { "2026": { categoryId: cents } } keyed by fiscal-year start year
    reconciliations: [],
    log: [],
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
/* Fill in anything missing, so older saved books and backups keep working. */
function normalize(s) {
  const d = defaultState();
  const out = {
    ...d, ...s,
    org: { ...d.org, ...(s.org || {}) },
    accounts: s.accounts || d.accounts,
    funds: s.funds || d.funds,
    categories: s.categories || d.categories,
    donors: s.donors || [],
    transactions: s.transactions || [],
    budgets: s.budgets || {},
    reconciliations: s.reconciliations || [],
    log: s.log || [],
  };
  const fill = (list, baseFor) => {
    const used = new Set(list.map(x => x.code).filter(Boolean));
    list.forEach(x => {
      if (x.code) return;
      let n = Number(baseFor(x));
      while (used.has(String(n))) n += 10;
      x.code = String(n);
      used.add(x.code);
    });
  };
  fill(out.accounts, () => 1010);
  fill(out.funds, f => f.restricted ? 3110 : 3010);
  fill(out.categories, c => CATEGORY_META[c.name]?.code ?? (c.kind === 'income' ? 4010 : 6010));
  out.categories.forEach(c => { if (!c.line990) c.line990 = CATEGORY_META[c.name]?.line || (c.kind === 'income' ? 'VIII-11' : 'IX-24'); });
  out.version = 2;
  return out;
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('Could not save your data in this browser. Please download a backup from Settings.');
  }
}

/* Change history (audit trail) */
function logChange(action, what) {
  state.log.unshift({ at: new Date().toISOString(), action, what });
  if (state.log.length > 2000) state.log.length = 2000;
}

const byId = (list, id) => list.find(x => x.id === id);
const acctName = id => byId(state.accounts, id)?.name || '—';
const fundName = id => byId(state.funds, id)?.name || '—';
const catName = id => byId(state.categories, id)?.name || 'Uncategorized';
const donorName = id => byId(state.donors, id)?.name || '';
const sortByName = list => [...list].sort((a, b) => a.name.localeCompare(b.name));
const sortByCode = list => [...list].sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true }) || a.name.localeCompare(b.name));
const coded = x => `<span class="code">${esc(x.code || '')}</span>${esc(x.name)}`;
const restrictedIds = () => new Set(state.funds.filter(f => f.restricted).map(f => f.id));
const isLocked = date => !!state.org.lockDate && !!date && date <= state.org.lockDate;
const isReconciled = t => !!t.reconciled && Object.keys(t.reconciled).length > 0;
const touches = (t, acct) => t.accountId === acct || t.toAccountId === acct;
/* Effect of a transaction on one bank account: + money in, − money out. */
function signedFor(t, acct) {
  if (t.type === 'income') return t.accountId === acct ? t.amount : 0;
  if (t.type === 'expense') return t.accountId === acct ? -t.amount : 0;
  if (t.type === 'transfer') return (t.toAccountId === acct ? t.amount : 0) - (t.accountId === acct ? t.amount : 0);
  return 0;
}
const txLabel = t => `${cap(t.type)} “${t.description || (t.type === 'transfer' ? 'Transfer' : catName(t.categoryId))}” (${prettyDate(t.date)}, ${money(t.amount)})`;

/* =========================================================================
 * Fiscal years & periods
 * ========================================================================= */
function fyStartYearFor(iso) {
  const [y, m] = iso.split('-').map(Number);
  return m >= state.org.fyStartMonth ? y : y - 1;
}
function fyRange(startYear) {
  const m = state.org.fyStartMonth;
  return { from: isoDate(new Date(startYear, m - 1, 1)), to: isoDate(new Date(startYear + 1, m - 1, 0)) };
}
function fyLabel(startYear) {
  return state.org.fyStartMonth === 1 ? `FY ${startYear}` : `FY ${startYear}–${String(startYear + 1).slice(-2)}`;
}
function periodPresets() {
  const now = new Date();
  const cy = fyStartYearFor(todayISO());
  return {
    thisFY: { label: `This fiscal year (${fyLabel(cy)})`, ...fyRange(cy) },
    lastFY: { label: `Last fiscal year (${fyLabel(cy - 1)})`, ...fyRange(cy - 1) },
    thisMonth: { label: 'This month', from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) },
    lastMonth: { label: 'Last month', from: isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: isoDate(new Date(now.getFullYear(), now.getMonth(), 0)) },
    all: { label: 'All time', from: ALL_TIME_FROM, to: ALL_TIME_TO },
  };
}
const inRange = (t, r) => t.date >= r.from && t.date <= r.to;
const endDate = r => r.to === ALL_TIME_TO ? todayISO() : r.to;
const beforeStart = r => r.from === ALL_TIME_FROM ? null : dayBefore(r.from);
/* The same period one year earlier, for comparative statements. */
function priorOf(r) {
  if (r.from === ALL_TIME_FROM) return null;
  return { from: shiftYear(r.from, -1), to: shiftYear(endDate(r), -1) };
}
function periodLabel(r) {
  if (r.from === ALL_TIME_FROM) return r.to === ALL_TIME_TO ? 'All time' : `Through ${prettyDate(r.to)}`;
  const fy = fyRange(fyStartYearFor(r.from));
  if (fy.from === r.from && fy.to === r.to) return fyLabel(fyStartYearFor(r.from));
  return `${prettyDate(r.from)} – ${prettyDate(endDate(r))}`;
}

/* =========================================================================
 * Calculations
 * ========================================================================= */
function accountBalance(accountId, asOf = ALL_TIME_TO) {
  let bal = byId(state.accounts, accountId)?.opening || 0;
  for (const t of state.transactions) if (t.date <= asOf) bal += signedFor(t, accountId);
  return bal;
}
const totalCash = (asOf) => state.accounts.reduce((s, a) => s + accountBalance(a.id, asOf), 0);
const openingCash = () => state.accounts.reduce((s, a) => s + (a.opening || 0), 0);

function fundBalance(fundId, asOf = ALL_TIME_TO) {
  let bal = byId(state.funds, fundId)?.opening || 0;
  for (const t of state.transactions) {
    if (t.date > asOf || t.fundId !== fundId) continue;
    if (t.type === 'income') bal += t.amount;
    if (t.type === 'expense') bal -= t.amount;
  }
  return bal;
}
/* Net assets split by restriction, at a date (null = opening balances). */
function netAssetsAt(asOf) {
  let u = 0, r = 0;
  for (const f of state.funds) {
    const b = asOf ? fundBalance(f.id, asOf) : (f.opening || 0);
    if (f.restricted) r += b; else u += b;
  }
  return { u, r };
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

/* Everything the Statement of Activities needs for one period. */
function activityData(r) {
  const R = restrictedIds();
  const inc = {}, exp = {};
  let incU = 0, incR = 0, expT = 0, released = 0;
  for (const t of state.transactions) {
    if (!inRange(t, r) || t.type === 'transfer') continue;
    if (t.type === 'income') {
      const x = inc[t.categoryId] ||= { u: 0, r: 0 };
      if (R.has(t.fundId)) { x.r += t.amount; incR += t.amount; } else { x.u += t.amount; incU += t.amount; }
    } else {
      exp[t.categoryId] = (exp[t.categoryId] || 0) + t.amount;
      expT += t.amount;
      // Spending restricted money for its purpose releases it from restriction.
      if (R.has(t.fundId)) released += t.amount;
    }
  }
  const start = netAssetsAt(beforeStart(r));
  return { inc, exp, incU, incR, expT, released, startU: start.u, startR: start.r };
}

function lastRecon(accountId) {
  return state.reconciliations
    .filter(r => r.accountId === accountId)
    .sort((a, b) => b.statementDate.localeCompare(a.statementDate) || b.completedAt.localeCompare(a.completedAt))[0];
}

/* =========================================================================
 * Routing & rendering
 * ========================================================================= */
const views = { dashboard: renderDashboard, transactions: renderTransactions, reconcile: renderReconcile, donors: renderDonors, budget: renderBudget, reports: renderReports, settings: renderSettings };
const emptyTxFilter = () => ({ q: '', type: '', categoryId: '', fundId: '', accountId: '', from: '', to: '', doc: '', status: '' });
const ui = {
  txFilter: emptyTxFilter(),
  reportTab: 'activities',
  reportPeriod: 'thisFY',
  customRange: { from: '', to: '' },
  compare: false,
  budgetYear: null,
  recon: null,      // reconciliation in progress: { accountId, statementDate, endingBalance }
  viewRecon: null,  // id of a completed reconciliation being viewed
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
window.addEventListener('hashchange', () => { ui.viewRecon = null; render(); $('#view').focus(); window.scrollTo(0, 0); });

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

function options(list, selected, { blank } = {}) {
  let html = blank !== undefined ? `<option value="">${esc(blank)}</option>` : '';
  for (const x of list) html += `<option value="${esc(x.id)}"${x.id === selected ? ' selected' : ''}>${esc(x.name)}</option>`;
  return html;
}
/* A status chip with an icon and a word, so meaning never depends on color alone. */
function statusPill(status, label) {
  const icon = status === 'ok' ? '✓' : status === 'warn' ? '!' : 'i';
  return `<span class="pill ${status}"><b aria-hidden="true">${icon}</b> ${label}</span>`;
}

/* ---------------- Dashboard ---------------- */
function checklistItems() {
  const range = fyRange(fyStartYearFor(todayISO()));
  const items = [];
  const missing = state.transactions.filter(t => t.type === 'expense' && !t.docOnFile && inRange(t, range)).length;
  items.push(missing
    ? { status: 'warn', text: `${plural(missing, 'expense')} this year without a receipt on file`, action: '<button class="btn small" data-action="show-missing-docs">Review</button>' }
    : { status: 'ok', text: 'Every expense this year has a receipt on file' });
  for (const a of sortByCode(state.accounts)) {
    const last = lastRecon(a.id);
    const used = state.transactions.some(t => touches(t, a.id));
    if (!used && !last) continue;
    const age = last ? (Date.now() - new Date(last.statementDate + 'T00:00:00')) / 864e5 : Infinity;
    items.push(age <= 45
      ? { status: 'ok', text: `${esc(a.name)} reconciled through ${prettyDate(last.statementDate)}` }
      : { status: 'warn', text: last ? `${esc(a.name)} last reconciled ${prettyDate(last.statementDate)}` : `${esc(a.name)} has never been reconciled`, action: '<a class="btn small" href="#reconcile">Reconcile</a>' });
  }
  state.funds.filter(f => f.restricted && fundBalance(f.id) < 0).forEach(f =>
    items.push({ status: 'warn', text: `${esc(f.name)} is overspent by ${money(-fundBalance(f.id))}` }));
  items.push(state.org.lockDate
    ? { status: 'ok', text: `Books closed through ${prettyDate(state.org.lockDate)}` }
    : { status: 'info', text: 'No closed period yet. Close each month or year once it is final.', action: '<a class="btn small" href="#settings">Settings</a>' });
  return items;
}

function renderDashboard(root) {
  const cy = fyStartYearFor(todayISO());
  const range = fyRange(cy);
  const s = summarize(range);
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
      <div class="card stat"><div class="label">Cash on hand</div><div class="value">${money(totalCash())}</div><div class="sub">All accounts, today</div></div>
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
        <h2>Bookkeeping checklist</h2>
        <p class="small muted" style="margin-top:0">What your accountant will check first.</p>
        <ul class="checklist">
          ${checklistItems().map(i => `<li>${statusPill(i.status, i.status === 'ok' ? 'Done' : i.status === 'warn' ? 'To do' : 'Tip')}<span class="grow">${i.text}</span>${i.action || ''}</li>`).join('')}
        </ul>
      </div>
      <div class="card">
        <h2>Fund balances</h2>
        <table><tbody>
          ${sortByCode(state.funds).map(f => `<tr><td>${esc(f.name)} <span class="pill">${f.restricted ? 'With donor restrictions' : 'Unrestricted'}</span></td><td class="num">${money(fundBalance(f.id))}</td></tr>`).join('')}
        </tbody></table>
        <h2 style="margin-top:18px">Account balances</h2>
        <table><tbody>
          ${sortByCode(state.accounts).map(a => `<tr><td>${esc(a.name)}</td><td class="num">${money(accountBalance(a.id))}</td></tr>`).join('')}
        </tbody></table>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline"><h2>Recent activity</h2><a href="#transactions" class="small">View all</a></div>
      ${recent.length ? `<table><tbody>${recent.map(txRowCompact).join('')}</tbody></table>` : '<p class="muted">Nothing recorded yet.</p>'}
    </div>`;

  drawMonthlyChart($('#monthlyChart'), cy);
}
function txRowCompact(t) {
  const amt = t.type === 'expense' ? money(-t.amount) : money(t.amount);
  const label = t.description || (t.type === 'transfer' ? 'Transfer' : catName(t.categoryId));
  return `<tr class="clickable" data-edit-tx="${t.id}"><td><div>${esc(label)}</div><div class="small muted">${prettyDate(t.date)} · ${esc(t.type === 'transfer' ? `${acctName(t.accountId)} → ${acctName(t.toAccountId)}` : catName(t.categoryId))}</div></td><td class="num ${t.type === 'income' ? 'pos' : ''}">${amt}</td></tr>`;
}

/* Monthly revenue vs expense bar chart (plain SVG, no libraries). */
function drawMonthlyChart(el, fyStart) {
  const m0 = state.org.fyStartMonth - 1;
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(fyStart, m0 + i, 1);
    return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, month: d.getMonth(), year: d.getFullYear(), income: 0, expense: 0 };
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
    const yTop = y(v), r = Math.min(4, y(0) - yTop);
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
    svg += `<text class="axis-label" x="${cx}" y="${H - 8}" text-anchor="middle">${MONTHS[m.month]}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}"/>`;
  });
  el.innerHTML = svg + '</svg>';
  $$('.hit', el).forEach(r => {
    r.addEventListener('mousemove', e => {
      const m = months[r.dataset.i];
      showTooltip(e, `<strong>${MONTHS_LONG[m.month]} ${m.year}</strong>
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
    if (f.accountId && !touches(t, f.accountId)) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.doc === 'missing' && (t.type === 'transfer' || t.docOnFile)) return false;
    if (f.doc === 'onfile' && !t.docOnFile) return false;
    if (f.status === 'uncleared' && t.cleared?.[t.accountId]) return false;
    if (f.status === 'cleared' && !t.cleared?.[t.accountId]) return false;
    if (f.status === 'reconciled' && !t.reconciled?.[t.accountId]) return false;
    if (q) {
      const hay = [t.description, t.reference, t.notes, t.payee, donorName(t.donorId), catName(t.categoryId)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
}

function renderTransactions(root) {
  const f = ui.txFilter;
  const sel = (name, opts) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}"${f[name] === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
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
        <label class="field">Type${sel('type', [['', 'All'], ['income', 'Income'], ['expense', 'Expense'], ['transfer', 'Transfer']])}</label>
        <label class="field">Category<select name="categoryId">${options(sortByName(state.categories), f.categoryId, { blank: 'All' })}</select></label>
        <label class="field">Fund<select name="fundId">${options(state.funds, f.fundId, { blank: 'All' })}</select></label>
        <label class="field">Account<select name="accountId">${options(sortByCode(state.accounts), f.accountId, { blank: 'All' })}</select></label>
        <label class="field">Receipts${sel('doc', [['', 'All'], ['missing', 'Missing receipt'], ['onfile', 'Receipt on file']])}</label>
        <label class="field">Bank status${sel('status', [['', 'All'], ['uncleared', 'Not cleared'], ['cleared', 'Cleared'], ['reconciled', 'Reconciled']])}</label>
        <label class="field">From<input type="date" name="from" value="${esc(f.from)}"></label>
        <label class="field">To<input type="date" name="to" value="${esc(f.to)}"></label>
        <button class="btn small" data-action="clear-filters" style="margin-bottom:4px">Clear</button>
      </div>
      <div id="txTable"></div>
    </div>`;

  $('#txFilters').addEventListener('input', e => {
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
    <div class="small muted" style="margin-bottom:8px">${plural(list.length, 'transaction')} · Revenue ${money(inc)} · Expenses ${money(exp)} · Net ${money(inc - exp, { sign: true })}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Description</th><th class="hide-sm">Category</th><th class="hide-sm">Fund</th><th class="hide-sm">Account</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${list.length ? list.map(t => {
          const badges = [
            t.reconciled?.[t.accountId] ? '<span class="pill ok">✓ Reconciled</span>' : t.cleared?.[t.accountId] ? '<span class="pill">Cleared</span>' : '',
            t.type === 'expense' && !t.docOnFile ? '<span class="pill warn">! No receipt</span>' : '',
            isLocked(t.date) ? '<span class="pill">Closed period</span>' : '',
          ].filter(Boolean).join(' ');
          return `
          <tr class="clickable" data-edit-tx="${t.id}">
            <td style="white-space:nowrap">${prettyDate(t.date)}</td>
            <td>${esc(t.description || '—')}${t.donorId ? `<div class="small muted">From ${esc(donorName(t.donorId))}</div>` : ''}${t.payee ? `<div class="small muted">Paid to ${esc(t.payee)}</div>` : ''}${t.reference ? `<div class="small muted">Ref #${esc(t.reference)}</div>` : ''}${badges ? `<div class="badges">${badges}</div>` : ''}</td>
            <td class="hide-sm">${t.type === 'transfer' ? '<span class="pill">Transfer</span>' : `<span class="pill ${t.type}">${esc(catName(t.categoryId))}</span>`}</td>
            <td class="hide-sm">${t.type === 'transfer' ? '' : esc(fundName(t.fundId))}</td>
            <td class="hide-sm">${esc(acctName(t.accountId))}${t.type === 'transfer' ? ` → ${esc(acctName(t.toAccountId))}` : ''}</td>
            <td class="num ${t.type === 'income' ? 'pos' : ''}">${t.type === 'expense' ? money(-t.amount) : money(t.amount)}</td>
          </tr>`;
        }).join('') : `<tr><td colspan="6" class="empty">No transactions match. Use the buttons above to add one.</td></tr>`}
      </tbody>
    </table></div>`;
}

function diffTx(a, b) {
  const out = [];
  const f = (label, x, y, fmt = v => v || '—') => { if ((x ?? '') !== (y ?? '')) out.push(`${label} ${fmt(x)} → ${fmt(y)}`); };
  f('type', a.type, b.type);
  f('date', a.date, b.date, prettyDate);
  f('amount', a.amount, b.amount, money);
  f('description', a.description, b.description);
  f('category', a.categoryId, b.categoryId, catName);
  f('fund', a.fundId, b.fundId, fundName);
  f('account', a.accountId, b.accountId, acctName);
  f('to account', a.toAccountId, b.toAccountId, acctName);
  f('function', a.func, b.func, v => FUNCTIONS[v] || '—');
  f('receipt on file', !!a.docOnFile, !!b.docOnFile, v => v ? 'yes' : 'no');
  return out;
}

/* ---------------- Transaction form (modal) ---------------- */
function openTxForm(existing, type = 'income') {
  const orig = existing ? { ...existing } : null;
  const t = existing ? { ...existing } : {
    id: null, type, date: todayISO(), amount: 0, description: '', categoryId: '', fundId: state.funds.find(f => !f.restricted)?.id || state.funds[0]?.id,
    accountId: state.accounts[0]?.id, toAccountId: state.accounts[1]?.id || '', donorId: '', payee: '', reference: '', func: '', notes: '', docOnFile: false,
  };
  const locked = orig && isLocked(orig.date);
  const reconciled = orig && isReconciled(orig);

  const body = () => {
    const cats = sortByName(state.categories.filter(c => c.kind === t.type));
    return `
      ${locked ? `<p class="callout small" style="margin-top:0">This transaction is in a closed period (books closed through ${prettyDate(state.org.lockDate)}), so it can't be changed. To change it, reopen the period in Settings.</p>` : ''}
      ${!locked && reconciled ? `<p class="callout small" style="margin-top:0">This transaction has been reconciled to a bank statement. You can change its description, category, fund and notes, but not its date, amount, type, or accounts.</p>` : ''}
      <div style="margin-bottom:14px" class="seg" role="radiogroup" aria-label="Transaction type">
        ${['income', 'expense', 'transfer'].map(x => `<label><input type="radio" name="type" value="${x}"${t.type === x ? ' checked' : ''}>${cap(x)}</label>`).join('')}
      </div>
      <div class="form-grid">
        <label class="field">Date<input type="date" name="date" value="${esc(t.date)}" required></label>
        <label class="field">Amount ($)<input name="amount" inputmode="decimal" value="${t.amount ? centsToInput(t.amount) : ''}" placeholder="0.00" required></label>
        <label class="field full">Description<input name="description" value="${esc(t.description)}" placeholder="${t.type === 'income' ? 'e.g. Spring appeal donation' : t.type === 'expense' ? 'e.g. Office rent — May' : 'e.g. Move funds to savings'}"></label>
        ${t.type === 'transfer' ? `
          <label class="field">From account<select name="accountId">${options(sortByCode(state.accounts), t.accountId)}</select></label>
          <label class="field">To account<select name="toAccountId">${options(sortByCode(state.accounts), t.toAccountId)}</select></label>
        ` : `
          <label class="field">Category<select name="categoryId">${options(cats, t.categoryId, { blank: 'Choose…' })}</select></label>
          <label class="field">Fund<select name="fundId">${state.funds.map(f => `<option value="${f.id}"${f.id === t.fundId ? ' selected' : ''}>${esc(f.name)}${f.restricted ? ' (restricted)' : ''}</option>`).join('')}</select></label>
          <label class="field">${t.type === 'income' ? 'Deposited to' : 'Paid from'}<select name="accountId">${options(sortByCode(state.accounts), t.accountId)}</select></label>
          ${t.type === 'income' ? `
            <label class="field">Donor / source (optional)<input name="donor" list="donorList" value="${esc(t._donor ?? donorName(t.donorId))}" placeholder="Type a name"><datalist id="donorList">${sortByName(state.donors).map(d => `<option value="${esc(d.name)}">`).join('')}</datalist></label>
          ` : `
            <label class="field">Paid to (vendor/payee)<input name="payee" value="${esc(t.payee)}"></label>
            <label class="field">Function<select name="func">${Object.entries(FUNCTIONS).map(([k, v]) => `<option value="${k}"${(t.func || byId(state.categories, t.categoryId)?.func) === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
          `}
        `}
        <label class="field">Check # / reference<input name="reference" value="${esc(t.reference)}"></label>
        ${t.type === 'transfer' ? '' : `<label class="check" style="align-self:end;padding-bottom:8px"><input type="checkbox" name="docOnFile"${t.docOnFile ? ' checked' : ''}> ${t.type === 'expense' ? 'Receipt or invoice on file' : 'Supporting document on file'}</label>`}
        <label class="field full">Notes<textarea name="notes" rows="2">${esc(t.notes)}</textarea></label>
      </div>
      ${t.type === 'expense' ? '<p class="small muted" style="margin:10px 0 0">“Function” says what the expense supported. Program = your mission work; Management & general = admin/overhead; Fundraising = costs of raising money.</p>' : ''}
      <div class="error-msg" id="formError"></div>`;
  };

  // capture current values before re-rendering (e.g. switching type)
  const readForm = () => {
    const form = $('#modalForm');
    for (const [k, v] of new FormData(form).entries()) {
      if (k === 'amount') { const c = toCents(v); t.amount = Number.isNaN(c) ? 0 : c; }
      else if (k === 'donor') t._donor = v;
      else if (k !== 'docOnFile') t[k] = v;
    }
    if (form.docOnFile) t.docOnFile = form.docOnFile.checked;
  };

  openModal({
    title: existing ? 'Edit transaction' : 'New transaction',
    body: body(),
    foot: locked
      ? `<div></div><div class="btn-row"><button type="button" class="btn" data-close>Close</button></div>`
      : `<div>${existing ? '<button type="button" class="btn danger" data-modal="delete">Delete</button>' : ''}</div>
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
      if (reconciled) { alert('This transaction has been reconciled, so it can’t be deleted. Undo the reconciliation first (Reconcile page).'); return false; }
      if (!confirm('Delete this transaction? This cannot be undone.')) return false;
      state.transactions = state.transactions.filter(x => x.id !== existing.id);
      logChange('Deleted', txLabel(orig));
      save(); render(); toast('Transaction deleted');
      return true;
    },
    onSubmit() {
      if (locked) return true;
      readForm();
      const err = msg => { $('#formError').textContent = msg; return false; };
      if (!t.date) return err('Please enter a date.');
      if (!(t.amount > 0)) return err('Please enter an amount greater than zero.');
      if (isLocked(t.date)) return err(`The books are closed through ${prettyDate(state.org.lockDate)}. Choose a later date, or reopen the period in Settings.`);
      if (reconciled && ['date', 'amount', 'type', 'accountId', 'toAccountId'].some(k => (orig[k] || '') !== (t[k] || ''))) {
        return err('This transaction is reconciled, so its date, amount, type and accounts can’t change. Undo the reconciliation first if they are wrong.');
      }
      if (t.type === 'transfer') {
        if (t.accountId === t.toAccountId) return err('Choose two different accounts for a transfer.');
        Object.assign(t, { categoryId: '', fundId: '', donorId: '', func: '', payee: '', docOnFile: false });
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
        const changes = diffTx(orig, t);
        Object.assign(byId(state.transactions, existing.id), t);
        if (changes.length) logChange('Edited', `${txLabel(orig)}: ${changes.join('; ')}`);
      } else {
        t.id = uid(); t.created = Date.now();
        state.transactions.push(t);
        logChange('Added', txLabel(t));
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
  $('#modalBody input:not([type=radio]):not([type=checkbox]), #modalBody select, #modalBody textarea')?.focus();
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

/* ---------------- Bank reconciliation ---------------- */
function renderReconcile(root) {
  if (ui.viewRecon) return renderReconReport(root, ui.viewRecon);
  if (ui.recon) return renderReconWork(root);
  const now = new Date();
  const lastMonthEnd = isoDate(new Date(now.getFullYear(), now.getMonth(), 0));
  const recs = [...state.reconciliations].sort((a, b) => b.statementDate.localeCompare(a.statementDate) || b.completedAt.localeCompare(a.completedAt));
  const latestIds = new Set(state.accounts.map(a => lastRecon(a.id)?.id).filter(Boolean));
  root.innerHTML = `
    <div class="page-head"><div><h1>Bank reconciliation</h1><div class="muted">Match your records to each bank statement, usually once a month.</div></div></div>
    <div class="grid grid-2">
      <form class="card" id="reconStart" novalidate>
        <h2>Start a reconciliation</h2>
        <div class="form-grid">
          <label class="field full">Account<select name="accountId">${options(sortByCode(state.accounts), state.accounts[0]?.id)}</select></label>
          <label class="field">Statement ending date<input type="date" name="statementDate" value="${lastMonthEnd}"></label>
          <label class="field">Statement ending balance ($)<input name="endingBalance" inputmode="decimal" placeholder="0.00"></label>
        </div>
        <p class="small muted" id="rcBegin"></p>
        <div class="error-msg" id="rcError"></div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary" type="submit">Start reconciling</button></div>
      </form>
      <div class="card">
        <h2>How it works</h2>
        <ol class="small steps">
          <li>Have your bank statement in front of you, paper or PDF.</li>
          <li>Enter the statement's ending date and ending balance.</li>
          <li>Tick each transaction that appears on the statement.</li>
          <li>When the difference reaches $0.00, click Finish. The app saves a reconciliation report for your accountant.</li>
        </ol>
        <p class="small muted">If the difference won't reach zero, look for a missing transaction, such as a bank fee or interest, or an amount typed wrong.</p>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Completed reconciliations</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Account</th><th>Statement date</th><th class="num">Ending balance</th><th class="num hide-sm">Items cleared</th><th class="hide-sm">Completed</th><th></th></tr></thead>
        <tbody>
          ${recs.length ? recs.map(r => `<tr>
            <td>${esc(acctName(r.accountId))}</td>
            <td>${prettyDate(r.statementDate)}</td>
            <td class="num">${money(r.endingBalance)}</td>
            <td class="num hide-sm">${r.clearedIds.length}</td>
            <td class="hide-sm">${new Date(r.completedAt).toLocaleDateString()}</td>
            <td class="num"><div class="btn-row" style="justify-content:flex-end"><button class="btn small" data-view-recon="${r.id}">Report</button>${latestIds.has(r.id) ? `<button class="btn small danger" data-undo-recon="${r.id}">Undo</button>` : ''}</div></td>
          </tr>`).join('') : '<tr><td colspan="6" class="empty">No reconciliations yet.</td></tr>'}
        </tbody>
      </table></div>
    </div>`;

  const form = $('#reconStart');
  const showBegin = () => {
    const a = form.accountId.value;
    const last = lastRecon(a);
    $('#rcBegin').textContent = last
      ? `Beginning balance ${money(last.endingBalance)}, from the statement dated ${prettyDate(last.statementDate)}.`
      : `First reconciliation for this account. Beginning balance is the starting balance from Settings: ${money(byId(state.accounts, a)?.opening || 0)}.`;
  };
  form.accountId.addEventListener('change', showBegin);
  showBegin();
  form.addEventListener('submit', e => {
    e.preventDefault();
    const accountId = form.accountId.value, statementDate = form.statementDate.value, endingBalance = toCents(form.endingBalance.value);
    const err = m => { $('#rcError').textContent = m; };
    if (!statementDate) return err('Enter the statement ending date.');
    if (Number.isNaN(endingBalance)) return err('Enter the ending balance shown on the statement.');
    const last = lastRecon(accountId);
    if (last && statementDate <= last.statementDate) return err(`This account is already reconciled through ${prettyDate(last.statementDate)}. Choose a later statement date.`);
    ui.recon = { accountId, statementDate, endingBalance };
    render();
  });
}

function reconItems() {
  const { accountId, statementDate } = ui.recon;
  return state.transactions
    .filter(t => touches(t, accountId) && !t.reconciled?.[accountId] && t.date <= statementDate)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));
}
function reconMath() {
  const { accountId, endingBalance } = ui.recon;
  const last = lastRecon(accountId);
  const begin = last ? last.endingBalance : (byId(state.accounts, accountId)?.opening || 0);
  let dep = 0, pay = 0, nd = 0, np = 0;
  for (const t of reconItems()) {
    if (!t.cleared?.[accountId]) continue;
    const s = signedFor(t, accountId);
    if (s >= 0) { dep += s; nd++; } else { pay -= s; np++; }
  }
  const clearedBal = begin + dep - pay;
  return { begin, dep, pay, nd, np, clearedBal, diff: endingBalance - clearedBal };
}
function renderReconWork(root) {
  const { accountId, statementDate, endingBalance } = ui.recon;
  const items = reconItems();
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Reconcile ${esc(acctName(accountId))}</h1><div class="muted">Statement ending ${prettyDate(statementDate)} · Ending balance ${money(endingBalance)}</div></div>
      <div class="btn-row">
        <button class="btn" data-action="recon-later">Save &amp; finish later</button>
        <button class="btn danger" data-action="recon-cancel">Cancel</button>
      </div>
    </div>
    <div class="card" id="reconSummary"></div>
    <div class="card" style="margin-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
        <h2>Tick the items on your statement</h2>
        <div class="btn-row"><button class="btn small" data-action="recon-all">Tick all</button><button class="btn small" data-action="recon-none">Untick all</button></div>
      </div>
      <div class="table-wrap"><table id="reconTable">
        <thead><tr><th style="width:40px">On statement</th><th>Date</th><th>Description</th><th class="hide-sm">Ref</th><th class="num">Deposit</th><th class="num">Payment</th></tr></thead>
        <tbody>
          ${items.length ? items.map(t => {
            const s = signedFor(t, accountId);
            return `<tr>
              <td><input type="checkbox" class="tick" data-clear="${t.id}" aria-label="On statement"${t.cleared?.[accountId] ? ' checked' : ''}></td>
              <td style="white-space:nowrap">${prettyDate(t.date)}</td>
              <td>${esc(t.description || (t.type === 'transfer' ? 'Transfer' : catName(t.categoryId)))}${t.payee ? `<div class="small muted">${esc(t.payee)}</div>` : ''}</td>
              <td class="hide-sm">${esc(t.reference)}</td>
              <td class="num">${s > 0 ? money(s) : ''}</td>
              <td class="num">${s < 0 ? money(-s) : ''}</td>
            </tr>`;
          }).join('') : '<tr><td colspan="6" class="empty">No unreconciled transactions on or before this date. If the statement shows items, add them on the Transactions page first.</td></tr>'}
        </tbody>
      </table></div>
    </div>`;
  $('#reconTable').addEventListener('change', e => {
    const id = e.target.dataset.clear;
    if (!id) return;
    const t = byId(state.transactions, id);
    t.cleared ||= {};
    if (e.target.checked) t.cleared[accountId] = true; else delete t.cleared[accountId];
    save();
    drawReconSummary();
  });
  drawReconSummary();
}
function drawReconSummary() {
  const m = reconMath();
  $('#reconSummary').innerHTML = `
    <div class="recon-grid">
      <div><div class="label">Beginning balance</div><div class="value">${money(m.begin)}</div></div>
      <div><div class="label">+ Deposits ticked (${m.nd})</div><div class="value">${money(m.dep)}</div></div>
      <div><div class="label">− Payments ticked (${m.np})</div><div class="value">${money(m.pay)}</div></div>
      <div><div class="label">= Cleared balance</div><div class="value">${money(m.clearedBal)}</div></div>
      <div><div class="label">Statement ending balance</div><div class="value">${money(ui.recon.endingBalance)}</div></div>
      <div><div class="label">Difference</div><div class="value ${m.diff ? 'neg' : 'pos'}">${money(m.diff)}</div></div>
    </div>
    <div class="btn-row" style="margin-top:14px;align-items:center">
      <button class="btn primary" data-action="recon-finish"${m.diff ? ' disabled' : ''}>Finish reconciliation</button>
      <span class="small muted">${m.diff ? statusPill('warn', 'Not balanced') + ' The difference must be $0.00 before you can finish.' : statusPill('ok', 'Balanced') + ' You can finish now.'}</span>
    </div>`;
}
function finishRecon() {
  const m = reconMath();
  if (m.diff !== 0) return;
  const { accountId, statementDate, endingBalance } = ui.recon;
  const items = reconItems();
  const rec = {
    id: uid(), accountId, statementDate, endingBalance, beginningBalance: m.begin, completedAt: new Date().toISOString(),
    clearedIds: items.filter(t => t.cleared?.[accountId]).map(t => t.id),
    outstandingIds: items.filter(t => !t.cleared?.[accountId]).map(t => t.id),
  };
  items.forEach(t => { if (t.cleared?.[accountId]) { t.reconciled ||= {}; t.reconciled[accountId] = rec.id; } });
  state.reconciliations.push(rec);
  logChange('Reconciled', `${acctName(accountId)} through ${prettyDate(statementDate)}, ending balance ${money(endingBalance)}`);
  save();
  ui.recon = null;
  ui.viewRecon = rec.id;
  render();
  toast('Reconciliation complete');
}
function undoRecon(id) {
  const rec = byId(state.reconciliations, id);
  if (!rec || !confirm(`Undo the ${acctName(rec.accountId)} reconciliation for ${prettyDate(rec.statementDate)}? The ticks are kept so you can redo it.`)) return;
  state.transactions.forEach(t => { if (t.reconciled?.[rec.accountId] === rec.id) delete t.reconciled[rec.accountId]; });
  state.reconciliations = state.reconciliations.filter(r => r.id !== id);
  logChange('Undid reconciliation', `${acctName(rec.accountId)} through ${prettyDate(rec.statementDate)}`);
  save(); render(); toast('Reconciliation undone');
}
function renderReconReport(root, id) {
  const rec = byId(state.reconciliations, id);
  if (!rec) { ui.viewRecon = null; return render(); }
  const a = rec.accountId;
  const get = ids => ids.map(i => byId(state.transactions, i)).filter(Boolean);
  const cleared = get(rec.clearedIds), outstanding = get(rec.outstandingIds);
  const sum = (list, sign) => list.reduce((s, t) => { const v = signedFor(t, a); return s + (sign > 0 ? Math.max(v, 0) : Math.max(-v, 0)); }, 0);
  const outDep = sum(outstanding, 1), outPay = sum(outstanding, -1);
  const adjusted = rec.endingBalance + outDep - outPay;
  const book = accountBalance(a, rec.statementDate);
  const list = (items, sign) => items.filter(t => sign > 0 ? signedFor(t, a) > 0 : signedFor(t, a) < 0)
    .map(t => `<tr><td class="indent">${prettyDate(t.date)}</td><td>${esc(t.description || t.payee || catName(t.categoryId))}${t.reference ? ` · #${esc(t.reference)}` : ''}</td><td class="num">${money(Math.abs(signedFor(t, a)))}</td></tr>`).join('')
    || '<tr><td class="indent muted" colspan="3">None</td></tr>';
  root.innerHTML = `
    <div class="page-head no-print">
      <div><a href="#reconcile" data-action="recon-back">← Back to reconciliations</a></div>
      <button class="btn primary" onclick="window.print()">Print / Save PDF</button>
    </div>
    <div class="card">
      <div class="report-title"><div class="muted">${esc(state.org.name)}</div><h2>Bank Reconciliation: ${esc(acctName(a))}</h2><div class="muted small">Statement dated ${prettyDate(rec.statementDate)} · Completed ${new Date(rec.completedAt).toLocaleString()}</div></div>
      <div class="table-wrap"><table>
        <tbody>
          <tr class="section"><td colspan="3">Bank statement</td></tr>
          <tr><td colspan="2">Beginning balance</td><td class="num">${money(rec.beginningBalance)}</td></tr>
          <tr><td colspan="2">Plus deposits cleared (${cleared.filter(t => signedFor(t, a) > 0).length})</td><td class="num">${money(sum(cleared, 1))}</td></tr>
          <tr><td colspan="2">Less payments cleared (${cleared.filter(t => signedFor(t, a) < 0).length})</td><td class="num">${money(-sum(cleared, -1))}</td></tr>
          <tr class="total"><td colspan="2">Statement ending balance</td><td class="num">${money(rec.endingBalance)}</td></tr>
          <tr class="section"><td colspan="3">Outstanding deposits (recorded, not yet on statement)</td></tr>
          ${list(outstanding, 1)}
          <tr class="subtotal"><td colspan="2">Total outstanding deposits</td><td class="num">${money(outDep)}</td></tr>
          <tr class="section"><td colspan="3">Outstanding checks &amp; payments</td></tr>
          ${list(outstanding, -1)}
          <tr class="subtotal"><td colspan="2">Total outstanding payments</td><td class="num">${money(-outPay)}</td></tr>
          <tr class="total"><td colspan="2">Adjusted bank balance</td><td class="num">${money(adjusted)}</td></tr>
          <tr><td colspan="2">Book balance on ${prettyDate(rec.statementDate)} (from your records)</td><td class="num">${money(book)}</td></tr>
          <tr class="subtotal"><td colspan="2">Difference</td><td class="num ${adjusted - book ? 'neg' : ''}">${money(adjusted - book)}</td></tr>
        </tbody>
      </table></div>
      <p style="margin-top:12px">${adjusted === book ? statusPill('ok', 'Bank and books agree') : statusPill('warn', 'Bank and books differ')}</p>
      ${adjusted !== book ? `<p class="callout small"><strong>Heads up:</strong> the book balance has changed since this reconciliation was completed. This usually means a transaction dated on or before ${prettyDate(rec.statementDate)} was added or changed afterwards. Review it, or undo and redo the reconciliation.</p>` : ''}
      <details style="margin-top:16px"><summary>Cleared items (${cleared.length})</summary>
        <table style="margin-top:8px"><tbody>${list(cleared, 1)}${list(cleared, -1)}</tbody></table>
      </details>
    </div>`;
}

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
              <td><a href="#" data-edit-donor="${d.id}">${esc(d.name)}</a><div class="small muted">${plural(s.count, 'gift')}</div></td>
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
      logChange('Deleted', `Donor “${d.name}”`);
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
    let tb = 0, ta = 0;
    const rows = sortByCode(state.categories.filter(c => c.kind === kind)).map(c => {
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

/* =========================================================================
 * Reports
 * ========================================================================= */
const REPORTS = {
  activities: 'Statement of Activities',
  position: 'Statement of Financial Position',
  cashflows: 'Statement of Cash Flows',
  functional: 'Statement of Functional Expenses',
  funds: 'Fund Activity',
  notes: 'Notes to Financial Statements',
  trial: 'Trial Balance',
  ledger: 'General Ledger',
  f990: 'Form 990 Worksheet',
  donors: 'Donor Giving',
};
const STATEMENTS = ['activities', 'position', 'cashflows', 'functional', 'funds', 'notes'];
const WORKPAPERS = ['trial', 'ledger', 'f990', 'donors'];
const COMPARABLE = new Set(['activities', 'position', 'cashflows', 'functional']);

function reportRange() {
  if (ui.reportPeriod === 'custom') return { from: ui.customRange.from || ALL_TIME_FROM, to: ui.customRange.to || ALL_TIME_TO };
  return periodPresets()[ui.reportPeriod];
}

/* A table with a label column and number columns. Row shapes:
 *   { section: 'Heading' }                    full-width section heading
 *   { label, vals: [...], cls, indent }       numbers are cents; strings are shown as-is; null is blank
 *   { note: 'text' }                          full-width small note */
const cell = v => v === null || v === undefined ? '' : typeof v === 'number' ? money(v) : v;
function simpleTable(headers, rows) {
  const n = headers.length;
  const th = headers.map((h, i) => `<th class="${i ? 'num' : ''}">${h}</th>`).join('');
  const body = rows.map(r => {
    if (r.section) return `<tr class="section"><td colspan="${n}">${r.section}</td></tr>`;
    if (r.note) return `<tr><td colspan="${n}" class="small muted ${r.indent ? 'indent' : ''}">${r.note}</td></tr>`;
    const ind = r.indent === 2 ? 'indent2' : r.indent ? 'indent' : '';
    return `<tr class="${r.cls || ''}"><td class="${ind}">${r.label}</td>${r.vals.map(v => `<td class="num">${cell(v)}</td>`).join('')}</tr>`;
  }).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderReports(root) {
  const presets = periodPresets();
  const r = reportRange();
  const tab = ui.reportTab;
  const prior = ui.compare && COMPARABLE.has(tab) ? priorOf(r) : null;
  const tabs = keys => keys.map(k => `<button data-report="${k}" class="${tab === k ? 'active' : ''}">${REPORTS[k]}</button>`).join('');
  root.innerHTML = `
    <div class="page-head no-print">
      <div><h1>Reports</h1><div class="muted">Draft financial statements and the working papers your accountant will ask for.</div></div>
      <div class="btn-row">
        <button class="btn" data-action="export-report">Export to Excel (CSV)</button>
        <button class="btn primary" onclick="window.print()">Print / Save PDF</button>
      </div>
    </div>
    <div class="subtabs"><span class="subtabs-label">Financial statements</span>${tabs(STATEMENTS)}</div>
    <div class="subtabs"><span class="subtabs-label">Working papers</span>${tabs(WORKPAPERS)}</div>
    <div class="filters" id="periodFilters">
      <label class="field">Period<select name="period">
        ${Object.entries(presets).map(([k, p]) => `<option value="${k}"${ui.reportPeriod === k ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}
        <option value="custom"${ui.reportPeriod === 'custom' ? ' selected' : ''}>Custom dates…</option>
      </select></label>
      ${ui.reportPeriod === 'custom' ? `
        <label class="field">From<input type="date" name="from" value="${esc(ui.customRange.from)}"></label>
        <label class="field">To<input type="date" name="to" value="${esc(ui.customRange.to)}"></label>` : ''}
      ${COMPARABLE.has(tab) ? `<label class="check" style="padding-bottom:8px"><input type="checkbox" name="compare"${ui.compare ? ' checked' : ''}${r.from === ALL_TIME_FROM ? ' disabled' : ''}> Compare to prior year</label>` : ''}
    </div>
    <div class="card" id="reportBody"></div>`;

  $('#periodFilters').addEventListener('change', e => {
    if (e.target.name === 'period') ui.reportPeriod = e.target.value;
    else if (e.target.name === 'compare') ui.compare = e.target.checked;
    else ui.customRange[e.target.name] = e.target.value;
    render();
  });

  const pl = periodLabel(r);
  const sub = tab === 'position'
    ? `As of ${prettyDate(endDate(r))}${prior ? ` and ${prettyDate(endDate(prior))}` : ''}`
    : `${pl}${pl.startsWith('FY') ? ` (${prettyDate(r.from)} – ${prettyDate(r.to)})` : ''}${prior ? `, with comparative totals for ${periodLabel(prior)}` : ''}`;
  const basis = STATEMENTS.includes(tab) ? '<div class="muted small">Cash basis · Draft, unaudited</div>' : '';
  const fn = { activities: reportActivities, position: reportPosition, cashflows: reportCashFlows, functional: reportFunctional, funds: reportFunds, trial: reportTrial, ledger: reportLedger, f990: report990, notes: reportNotes, donors: reportDonors }[tab];
  $('#reportBody').innerHTML = `<div class="report-title"><div class="muted">${esc(state.org.name)}</div><h2>${REPORTS[tab]}</h2><div class="muted small">${sub}</div>${basis}</div><div class="table-wrap">${fn(r, prior)}</div>`;
}

/* ---- Statement of Activities (with releases from restriction) ---- */
function reportActivities(r, prior) {
  const c = activityData(r), p = prior ? activityData(prior) : null;
  const pv = fn => p ? fn(p) : 0;
  const mk = (label, u, rs, pu, o = {}) => {
    const tot = (u || 0) + (rs || 0);
    return { label, vals: [u, rs, tot, ...(p ? [pu, tot - pu] : [])], ...o };
  };
  const headers = ['', 'Without donor restrictions', 'With donor restrictions', p ? `Total ${esc(periodLabel(r))}` : 'Total', ...(p ? [`Total ${esc(periodLabel(prior))}`, 'Change'] : [])];
  const rows = [{ section: 'Revenue, support &amp; reclassifications' }];
  const incCats = sortByCode(state.categories.filter(x => x.kind === 'income' && (c.inc[x.id] || p?.inc[x.id])));
  incCats.forEach(x => {
    const a = c.inc[x.id] || { u: 0, r: 0 }, b = p?.inc[x.id];
    rows.push(mk(esc(x.name), a.u, a.r, b ? b.u + b.r : 0, { indent: 1 }));
  });
  if (!incCats.length) rows.push({ note: 'No revenue in this period.', indent: 1 });
  if (c.released || p?.released) rows.push(mk('Net assets released from restrictions', c.released, -c.released, 0, { indent: 1 }));
  rows.push(mk('Total revenue, support &amp; reclassifications', c.incU + c.released, c.incR - c.released, pv(x => x.incU + x.incR), { cls: 'subtotal' }));

  rows.push({ section: 'Expenses' });
  const expCats = sortByCode(state.categories.filter(x => x.kind === 'expense' && (c.exp[x.id] || p?.exp[x.id])));
  expCats.forEach(x => rows.push(mk(esc(x.name), c.exp[x.id] || 0, null, p?.exp[x.id] || 0, { indent: 1 })));
  if (!expCats.length) rows.push({ note: 'No expenses in this period.', indent: 1 });
  rows.push(mk('Total expenses', c.expT, null, pv(x => x.expT), { cls: 'subtotal' }));

  const chU = c.incU + c.released - c.expT, chR = c.incR - c.released;
  const pCh = pv(x => x.incU + x.incR - x.expT), pStart = pv(x => x.startU + x.startR);
  rows.push(mk('Change in net assets', chU, chR, pCh, { cls: 'total' }));
  rows.push(mk('Net assets, beginning of period', c.startU, c.startR, pStart));
  rows.push(mk('Net assets, end of period', c.startU + chU, c.startR + chR, pStart + pCh, { cls: 'total' }));

  return simpleTable(headers, rows) + `
    <p class="small muted">All expenses are reported as decreases in net assets without donor restrictions. When money with donor restrictions is spent for its purpose, the amount appears on the “net assets released from restrictions” line, moving it from the restricted column to the unrestricted column.</p>`;
}

/* ---- Statement of Financial Position ---- */
function reportPosition(r, prior) {
  const asOf = endDate(r), pAsOf = prior ? endDate(prior) : null;
  const v = fn => pAsOf ? [fn(asOf), fn(pAsOf)] : [fn(asOf)];
  const fundsSum = (restricted, d) => state.funds.filter(f => !!f.restricted === restricted).reduce((s, f) => s + fundBalance(f.id, d), 0);
  const rows = [{ section: 'Assets' }];
  sortByCode(state.accounts).forEach(a => rows.push({ label: esc(a.name), vals: v(d => accountBalance(a.id, d)), indent: 1 }));
  rows.push({ label: 'Total assets', vals: v(d => totalCash(d)), cls: 'total' });
  rows.push({ section: 'Liabilities' });
  rows.push({ label: 'None recorded (cash basis)', vals: v(() => 0), indent: 1 });
  rows.push({ label: 'Total liabilities', vals: v(() => 0), cls: 'subtotal' });
  rows.push({ section: 'Net assets' });
  for (const restricted of [false, true]) {
    rows.push({ label: restricted ? 'With donor restrictions' : 'Without donor restrictions', vals: v(d => fundsSum(restricted, d)), indent: 1 });
    sortByCode(state.funds.filter(f => !!f.restricted === restricted)).forEach(f =>
      rows.push({ label: `<span class="small muted">${esc(f.name)}</span>`, vals: v(d => fundBalance(f.id, d)).map(x => `<span class="small muted">${money(x)}</span>`), indent: 2 }));
  }
  rows.push({ label: 'Total net assets', vals: v(d => fundsSum(false, d) + fundsSum(true, d)), cls: 'subtotal' });
  rows.push({ label: 'Total liabilities and net assets', vals: v(d => fundsSum(false, d) + fundsSum(true, d)), cls: 'total' });
  const diff = totalCash(asOf) - (fundsSum(false, asOf) + fundsSum(true, asOf));
  return simpleTable(['', prettyDate(asOf), ...(pAsOf ? [prettyDate(pAsOf)] : [])], rows) + `
    ${diff !== 0 ? `<p class="callout small" style="margin-top:12px"><strong>Heads up:</strong> total assets and total net assets differ by ${money(diff)}. This usually means the starting balances of your accounts and funds (in Settings) don’t add up to the same total. Adjust them so they match.</p>` : ''}
    <p class="small muted">This app tracks cash accounts only. If you have receivables, pledges, payables, or equipment, ask your accountant to add those at year-end.</p>`;
}

/* ---- Statement of Cash Flows (direct method, with reconciliation) ---- */
function cashFlowData(r) {
  const inc = {}, exp = {};
  let ti = 0, te = 0;
  for (const t of state.transactions) {
    if (!inRange(t, r)) continue;
    if (t.type === 'income') { inc[t.categoryId] = (inc[t.categoryId] || 0) + t.amount; ti += t.amount; }
    if (t.type === 'expense') { exp[t.categoryId] = (exp[t.categoryId] || 0) + t.amount; te += t.amount; }
  }
  const before = beforeStart(r);
  const begin = before ? totalCash(before) : openingCash();
  return { inc, exp, ti, te, begin, end: totalCash(endDate(r)) };
}
function reportCashFlows(r, prior) {
  const c = cashFlowData(r), p = prior ? cashFlowData(prior) : null;
  const v = fn => p ? [fn(c), fn(p)] : [fn(c)];
  const blank = p ? [null, null] : [null];
  const rows = [{ section: 'Cash flows from operating activities' }, { label: 'Cash received from:', vals: blank, indent: 1 }];
  sortByCode(state.categories.filter(x => x.kind === 'income' && (c.inc[x.id] || p?.inc[x.id])))
    .forEach(x => rows.push({ label: esc(x.name), vals: v(d => d.inc[x.id] || 0), indent: 2 }));
  rows.push({ label: 'Cash paid for:', vals: blank, indent: 1 });
  sortByCode(state.categories.filter(x => x.kind === 'expense' && (c.exp[x.id] || p?.exp[x.id])))
    .forEach(x => rows.push({ label: esc(x.name), vals: v(d => -(d.exp[x.id] || 0)), indent: 2 }));
  rows.push({ label: 'Net cash provided by (used in) operating activities', vals: v(d => d.ti - d.te), cls: 'subtotal' });
  rows.push({ section: 'Cash flows from investing activities' }, { label: 'None', vals: v(() => 0), indent: 1 });
  rows.push({ section: 'Cash flows from financing activities' }, { label: 'None', vals: v(() => 0), indent: 1 });
  rows.push({ label: 'Net increase (decrease) in cash', vals: v(d => d.ti - d.te), cls: 'total' });
  rows.push({ label: 'Cash, beginning of period', vals: v(d => d.begin) });
  rows.push({ label: 'Cash, end of period', vals: v(d => d.end), cls: 'total' });
  rows.push({ section: 'Reconciliation of change in net assets to net cash from operating activities' });
  rows.push({ label: 'Change in net assets', vals: v(d => d.ti - d.te), indent: 1 });
  rows.push({ label: 'Adjustments (none needed on the cash basis)', vals: v(() => 0), indent: 1 });
  rows.push({ label: 'Net cash provided by (used in) operating activities', vals: v(d => d.ti - d.te), cls: 'subtotal' });
  rows.push({ section: 'Cash at end of period consists of' });
  const asOf = endDate(r), pAsOf = prior ? endDate(prior) : null;
  sortByCode(state.accounts).forEach(a => rows.push({ label: esc(a.name), vals: pAsOf ? [accountBalance(a.id, asOf), accountBalance(a.id, pAsOf)] : [accountBalance(a.id, asOf)], indent: 1 }));
  return simpleTable(['', esc(periodLabel(r)), ...(p ? [esc(periodLabel(prior))] : [])], rows) + `
    <p class="small muted">Transfers between your own bank accounts are not cash flows and are left out. If you take out a loan or buy equipment, ask your accountant how to present it, because those belong in the financing or investing sections.</p>`;
}

/* ---- Statement of Functional Expenses ---- */
function functionalData(r) {
  const rows = {};
  const tot = { program: 0, management: 0, fundraising: 0 };
  for (const t of state.transactions) {
    if (t.type !== 'expense' || !inRange(t, r)) continue;
    const f = t.func || 'management';
    const row = rows[t.categoryId] ||= { program: 0, management: 0, fundraising: 0 };
    row[f] += t.amount; tot[f] += t.amount;
  }
  return { rows, tot, all: tot.program + tot.management + tot.fundraising };
}
function reportFunctional(r, prior) {
  const c = functionalData(r), p = prior ? functionalData(prior) : null;
  const sumRow = x => x ? x.program + x.management + x.fundraising : 0;
  const pctOf = (x, all) => `<span class="muted">${all ? ((x / all) * 100).toFixed(1) : '0.0'}%</span>`;
  const cats = sortByCode(state.categories.filter(x => x.kind === 'expense' && (c.rows[x.id] || p?.rows[x.id])));
  const zero = { program: 0, management: 0, fundraising: 0 };
  const rows = cats.map(x => {
    const v = c.rows[x.id] || zero;
    return { label: esc(x.name), vals: [v.program, v.management, v.fundraising, sumRow(v), ...(p ? [sumRow(p.rows[x.id])] : [])] };
  });
  if (!cats.length) rows.push({ note: 'No expenses in this period.' });
  rows.push({ label: 'Total expenses', vals: [c.tot.program, c.tot.management, c.tot.fundraising, c.all, ...(p ? [p.all] : [])], cls: 'total' });
  rows.push({ label: '<span class="muted">Percent of total</span>', vals: [pctOf(c.tot.program, c.all), pctOf(c.tot.management, c.all), pctOf(c.tot.fundraising, c.all), pctOf(c.all, c.all), ...(p ? [''] : [])] });
  if (p) rows.push({ label: `<span class="muted">${esc(periodLabel(prior))} split</span>`, vals: [pctOf(p.tot.program, p.all), pctOf(p.tot.management, p.all), pctOf(p.tot.fundraising, p.all), '', ''] });
  return simpleTable(['Expense', 'Program services', 'Management &amp; general', 'Fundraising', p ? `Total ${esc(periodLabel(r))}` : 'Total', ...(p ? [`Total ${esc(periodLabel(prior))}`] : [])], rows) +
    '<p class="small muted">This matches the layout of Part IX of IRS Form 990 (Statement of Functional Expenses). Each expense is assigned to the function chosen when it was recorded.</p>';
}

/* ---- Fund activity ---- */
function fundActivity(r) {
  const before = beforeStart(r);
  return sortByCode(state.funds).map(f => {
    let inc = 0, exp = 0;
    state.transactions.forEach(t => { if (t.fundId === f.id && inRange(t, r)) { if (t.type === 'income') inc += t.amount; if (t.type === 'expense') exp += t.amount; } });
    const start = before ? fundBalance(f.id, before) : (f.opening || 0);
    return { f, start, inc, exp, end: start + inc - exp };
  });
}
function reportFunds(r) {
  const data = fundActivity(r);
  const sum = k => data.reduce((s, x) => s + x[k], 0);
  const rows = data.map(x => ({ label: `${esc(x.f.name)}<div class="small muted">${x.f.restricted ? 'With donor restrictions' : 'Without donor restrictions'}</div>`, vals: [x.start, x.inc, -x.exp, x.end] }));
  rows.push({ label: 'Total', vals: [sum('start'), sum('inc'), -sum('exp'), sum('end')], cls: 'total' });
  return simpleTable(['Fund', 'Beginning', 'Revenue', 'Expenses / released', 'Ending'], rows) +
    (data.some(x => x.f.restricted && x.end < 0) ? '<p class="callout small" style="margin-top:12px"><strong>Heads up:</strong> a restricted fund has a negative balance, meaning more was spent from it than was given for that purpose. Check that those expenses were coded to the right fund.</p>' : '');
}

/* ---- Trial balance ---- */
function reportTrial(r) {
  const asOf = endDate(r), before = beforeStart(r);
  const lines = [];
  const add = (item, label, amount, normal) => {
    // normal side is 'debit' or 'credit'; a negative balance moves to the other side
    const debit = normal === 'debit' ? amount : -amount;
    lines.push({ code: item.code || '', label, debit: debit > 0 ? debit : null, credit: debit < 0 ? -debit : null });
  };
  state.accounts.forEach(a => add(a, esc(a.name), accountBalance(a.id, asOf), 'debit'));
  state.funds.forEach(f => add(f, `${esc(f.name)}: net assets at start of period`, before ? fundBalance(f.id, before) : (f.opening || 0), 'credit'));
  const totals = {};
  state.transactions.forEach(t => { if (t.categoryId && inRange(t, r)) totals[t.categoryId] = (totals[t.categoryId] || 0) + t.amount; });
  state.categories.forEach(c => { if (totals[c.id]) add(c, esc(c.name), totals[c.id], c.kind === 'income' ? 'credit' : 'debit'); });
  lines.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const dr = lines.reduce((s, l) => s + (l.debit || 0), 0), cr = lines.reduce((s, l) => s + (l.credit || 0), 0);
  const rows = lines.map(l => ({ label: `<span class="code">${esc(l.code)}</span>${l.label}`, vals: [l.debit, l.credit] }));
  rows.push({ label: 'Totals', vals: [dr, cr], cls: 'total' });
  return simpleTable(['Account', 'Debit', 'Credit'], rows) + `
    <p style="margin-top:12px">${dr === cr ? statusPill('ok', 'In balance') : statusPill('warn', `Out of balance by ${money(Math.abs(dr - cr))}`)}</p>
    ${dr !== cr ? '<p class="small muted">Debits and credits differ because the starting balances of your bank accounts and your funds (Settings) don’t add up to the same total.</p>' : ''}
    <p class="small muted">Bank balances are as of ${prettyDate(asOf)}. Net assets are shown at the start of the period, and revenue and expenses for the period are listed separately, as in a pre-closing trial balance.</p>`;
}

/* ---- General ledger ---- */
function reportLedger(r) {
  const before = beforeStart(r);
  const txs = state.transactions.filter(t => inRange(t, r)).sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));
  const descOf = t => esc(t.description || t.payee || (t.type === 'transfer' ? 'Transfer' : catName(t.categoryId)));
  const line = (t, dr, cr, bal, extra) => `<tr><td style="white-space:nowrap">${prettyDate(t.date)}</td><td>${descOf(t)}<div class="small muted">${extra}</div></td><td class="hide-sm">${esc(t.reference)}</td><td class="num">${dr ? money(dr) : ''}</td><td class="num">${cr ? money(cr) : ''}</td><td class="num">${money(bal)}</td></tr>`;
  let html = '<table><thead><tr><th>Date</th><th>Description</th><th class="hide-sm">Ref</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead><tbody>';
  for (const a of sortByCode(state.accounts)) {
    let bal = before ? accountBalance(a.id, before) : (a.opening || 0);
    const lines = txs.filter(t => touches(t, a.id));
    if (!lines.length && !bal) continue;
    let dr = 0, cr = 0;
    html += `<tr class="section"><td colspan="6">${coded(a)}</td></tr><tr><td></td><td>Beginning balance</td><td class="hide-sm"></td><td></td><td></td><td class="num">${money(bal)}</td></tr>`;
    for (const t of lines) {
      const s = signedFor(t, a.id);
      bal += s;
      if (s >= 0) dr += s; else cr -= s;
      html += line(t, s > 0 ? s : 0, s < 0 ? -s : 0, bal, t.type === 'transfer' ? `${esc(acctName(t.accountId))} → ${esc(acctName(t.toAccountId))}` : esc(catName(t.categoryId)));
    }
    html += `<tr class="subtotal"><td></td><td>Totals and ending balance</td><td class="hide-sm"></td><td class="num">${money(dr)}</td><td class="num">${money(cr)}</td><td class="num">${money(bal)}</td></tr>`;
  }
  for (const c of sortByCode(state.categories)) {
    const lines = txs.filter(t => t.categoryId === c.id);
    if (!lines.length) continue;
    let run = 0;
    html += `<tr class="section"><td colspan="6">${coded(c)}</td></tr>`;
    for (const t of lines) {
      run += t.amount;
      html += line(t, c.kind === 'expense' ? t.amount : 0, c.kind === 'income' ? t.amount : 0, run, `${esc(fundName(t.fundId))}${t.func ? ' · ' + FUNCTIONS[t.func] : ''}`);
    }
    html += `<tr class="subtotal"><td></td><td>Total ${esc(c.name)}</td><td class="hide-sm"></td><td class="num">${c.kind === 'expense' ? money(run) : ''}</td><td class="num">${c.kind === 'income' ? money(run) : ''}</td><td class="num">${money(run)}</td></tr>`;
  }
  return html + '</tbody></table>' + (txs.length ? '' : '<p class="empty">No transactions in this period.</p>');
}

/* ---- Form 990 worksheet ---- */
function report990(r) {
  const rev = {}, exp = {};
  for (const t of state.transactions) {
    if (!inRange(t, r) || t.type === 'transfer') continue;
    const c = byId(state.categories, t.categoryId);
    const key = c?.line990 || (t.type === 'income' ? 'VIII-11' : 'IX-24');
    if (t.type === 'income') rev[key] = (rev[key] || 0) + t.amount;
    else { const x = exp[key] ||= { program: 0, management: 0, fundraising: 0 }; x[t.func || 'management'] += t.amount; }
  }
  const lineLabel = k => `<span class="code">${F990[k].line}</span>${esc(F990[k].label)}`;
  const revKeys = F990_LINES.map(l => l[0]).filter(k => rev[k] !== undefined);
  const isContrib = k => /^VIII-1[a-g]$/.test(k);
  const contributions = revKeys.filter(isContrib).reduce((s, k) => s + rev[k], 0);
  const totalRev = revKeys.reduce((s, k) => s + rev[k], 0);
  const revRows = revKeys.filter(isContrib).map(k => ({ label: lineLabel(k), vals: [rev[k]], indent: 1 }));
  revRows.push({ label: '<span class="code">1h</span>Total contributions (lines 1a–1f)', vals: [contributions], cls: 'subtotal' });
  revKeys.filter(k => !isContrib(k)).forEach(k => revRows.push({ label: lineLabel(k), vals: [rev[k]] }));
  revRows.push({ label: '<span class="code">12</span>Total revenue', vals: [totalRev], cls: 'total' });

  const tot = { program: 0, management: 0, fundraising: 0 };
  const expRows = F990_LINES.map(l => l[0]).filter(k => exp[k]).map(k => {
    const x = exp[k];
    Object.keys(tot).forEach(f => { tot[f] += x[f]; });
    return { label: lineLabel(k), vals: [x.program + x.management + x.fundraising, x.program, x.management, x.fundraising] };
  });
  expRows.push({ label: '<span class="code">25</span>Total functional expenses', vals: [tot.program + tot.management + tot.fundraising, tot.program, tot.management, tot.fundraising], cls: 'total' });

  return `<h3>Part VIII · Statement of Revenue</h3>` + simpleTable(['Line', 'Amount'], revRows) +
    `<h3 style="margin-top:24px">Part IX · Statement of Functional Expenses</h3>` + simpleTable(['Line', '(A) Total', '(B) Program service', '(C) Management &amp; general', '(D) Fundraising'], expRows) + `
    <p class="small muted">A worksheet for your tax preparer, not a tax return. Each category is mapped to a Form 990 line in Settings. Which form you file depends on your size: generally Form 990-N if gross receipts are normally $50,000 or less; Form 990-EZ if gross receipts are under $200,000 and total assets under $500,000; otherwise the full Form 990. Gross receipts for this period: <strong>${money(totalRev)}</strong>.</p>`;
}

/* ---- Notes to the financial statements (auto-filled draft) ---- */
function monthsIn(r) {
  const from = r.from === ALL_TIME_FROM ? (state.transactions.map(t => t.date).sort()[0] || todayISO()) : r.from;
  const to = endDate(r) > todayISO() ? todayISO() : endDate(r);
  const [y1, m1] = from.split('-').map(Number), [y2, m2] = to.split('-').map(Number);
  return Math.max(1, (y2 - y1) * 12 + (m2 - m1) + 1);
}
function reportNotes(r) {
  const o = state.org;
  const asOf = endDate(r);
  const a = activityData(r);
  const revenue = a.incU + a.incR;
  const fa = functionalData(r);
  const restricted = fundActivity(r).filter(x => x.f.restricted);
  const restrictedEnd = restricted.reduce((s, x) => s + x.end, 0);
  const cash = totalCash(asOf);
  const monthly = fa.all / monthsIn(r);
  const pct = k => fa.all ? ((fa.tot[k] / fa.all) * 100).toFixed(1) + '%' : '0%';
  const donors = {};
  state.transactions.forEach(t => { if (t.type === 'income' && t.donorId && inRange(t, r)) donors[t.donorId] = (donors[t.donorId] || 0) + t.amount; });
  const big = Object.entries(donors).filter(([, v]) => revenue && v / revenue >= 0.1).sort((x, y) => y[1] - x[1]);
  const inKind = state.transactions.filter(t => t.type === 'income' && inRange(t, r) && /in-kind|non-?cash/i.test(catName(t.categoryId))).reduce((s, t) => s + t.amount, 0);
  let n = 0;
  const note = (title, body) => `<section class="note"><h3>Note ${++n}. ${title}</h3>${body}</section>`;
  const sumOf = k => restricted.reduce((s, x) => s + x[k], 0);
  return `<div class="notes">
    ${note('Nature of activities', `<p>${o.mission ? esc(o.mission) : `<span class="placeholder">[Describe ${esc(o.name)}'s mission and main programs. You can add this in Settings.]</span>`}</p>`)}
    ${note('Summary of significant accounting policies', `
      <p><strong>Basis of accounting.</strong> The financial statements are prepared on the cash basis of accounting. Revenue is recognized when received and expenses when paid. This is a basis of accounting other than generally accepted accounting principles (GAAP). Under GAAP, pledges receivable, accounts payable, and similar items would be recorded.</p>
      <p><strong>Net assets.</strong> Net assets without donor restrictions are available for general operations. Net assets with donor restrictions are limited by donors to a specific purpose or time period. When a restriction is met, the amount is reclassified to net assets without donor restrictions and reported as “net assets released from restrictions.”</p>
      <p><strong>Functional allocation of expenses.</strong> Costs are charged to program services, management and general, or fundraising based on the activity each expense supports. For ${esc(periodLabel(r))}, program services were ${pct('program')}, management and general ${pct('management')}, and fundraising ${pct('fundraising')} of total expenses of ${money(fa.all)}.</p>
      <p><strong>Income taxes.</strong> ${esc(o.name)} is exempt from federal income tax under Section 501(c)(3) of the Internal Revenue Code${o.ein ? ` (EIN ${esc(o.ein)})` : ''}. Accordingly, no provision for income taxes has been made.</p>`)}
    ${note('Liquidity and availability of resources', `
      <table><tbody>
        <tr><td>Cash and cash equivalents, ${prettyDate(asOf)}</td><td class="num">${money(cash)}</td></tr>
        <tr><td>Less: net assets with donor restrictions</td><td class="num">${money(-restrictedEnd)}</td></tr>
        <tr class="total"><td>Financial assets available for general expenditure within one year</td><td class="num">${money(cash - restrictedEnd)}</td></tr>
      </tbody></table>
      <p>Average monthly spending in this period was ${money(Math.round(monthly))}.${monthly > 0 ? ` Available cash covers about ${((cash - restrictedEnd) / monthly).toFixed(1)} months of operations.` : ''}</p>`)}
    ${note('Net assets with donor restrictions', restricted.length ? simpleTable(['Fund / purpose', 'Beginning', 'Contributions', 'Released', 'Ending'], [
      ...restricted.map(x => ({ label: esc(x.f.name), vals: [x.start, x.inc, -x.exp, x.end] })),
      { label: 'Total', vals: [sumOf('start'), sumOf('inc'), -sumOf('exp'), restrictedEnd], cls: 'total' },
    ]) : '<p>There were no net assets with donor restrictions.</p>')}
    ${note('Concentrations', big.length
      ? `<p>The following sources each provided 10% or more of total revenue of ${money(revenue)}:</p><ul>${big.map(([id, v]) => `<li>${esc(donorName(id))}: ${money(v)} (${((v / revenue) * 100).toFixed(0)}%)</li>`).join('')}</ul>`
      : '<p>No single donor or funder provided 10% or more of total revenue.</p>')}
    ${inKind ? note('Contributed nonfinancial assets', `<p>Contributed goods and services recognized in this period totaled ${money(inKind)}, recorded at estimated fair value when received.</p>`) : ''}
    ${note('Subsequent events', `<p>Management has evaluated subsequent events through <span class="placeholder">[date the statements are issued]</span>, the date the financial statements were available to be issued.</p>`)}
  </div>
  <p class="small muted no-print">These notes are filled in from your books. Review the wording with your accountant, and replace anything in [brackets].</p>`;
}

/* ---- Donor giving ---- */
function reportDonors(r) {
  const totals = {};
  state.transactions.forEach(t => {
    if (t.type !== 'income' || !inRange(t, r) || !t.donorId) return;
    const x = totals[t.donorId] ||= { amt: 0, n: 0 };
    x.amt += t.amount; x.n++;
  });
  const rows = Object.entries(totals).map(([id, x]) => ({ name: donorName(id), ...x })).sort((a, b) => b.amt - a.amt);
  const tableRows = rows.map(x => ({ label: esc(x.name), vals: [String(x.n), x.amt] }));
  if (!rows.length) tableRows.push({ note: 'No donor gifts in this period.' });
  tableRows.push({ label: 'Total from named donors', vals: [String(rows.reduce((s, x) => s + x.n, 0)), rows.reduce((s, x) => s + x.amt, 0)], cls: 'total' });
  return simpleTable(['Donor', 'Gifts', 'Total given'], tableRows) + '<p class="small muted">Gifts recorded without a donor name are not listed here.</p>';
}

/* Export the report on screen as a CSV file that Excel can open. */
function exportReportCSV() {
  const body = $('#reportBody');
  if (!body) return;
  const q = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  // "$1,234.50" → 1234.50 and "-$75.00" → -75.00 so spreadsheets treat them as numbers
  const num = s => /^[+-]?-?\$[\d,]+\.\d\d$/.test(s) ? (s.includes('-') ? '-' : '') + s.replace(/[^\d.]/g, '') : s;
  const lines = [];
  $$('.report-title > *', body).forEach(el => lines.push(q(el.textContent.trim())));
  $$('h3, table', body).forEach(el => {
    lines.push('');
    if (el.tagName === 'H3') { lines.push(q(el.textContent.trim())); return; }
    $$('tr', el).forEach(tr => lines.push($$('th,td', tr).map(c => q(num((c.tagName === 'TH' ? c.textContent : c.innerText).replace(/\s+/g, ' ').trim()))).join(',')));
  });
  download(`${REPORTS[ui.reportTab].toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${todayISO()}.csv`, lines.join('\n'), 'text/csv');
}

/* =========================================================================
 * Settings
 * ========================================================================= */
function renderSettings(root) {
  const o = state.org;
  const listSection = (title, key, rows, help) => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h2>${title}</h2><button class="btn small" data-add="${key}">+ Add</button></div>
      ${help ? `<p class="small muted" style="margin-top:0">${help}</p>` : ''}
      <div class="table-wrap"><table><tbody>${rows.join('')}</tbody></table></div>
    </div>`;
  root.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><div class="muted">Your organization, chart of accounts, and data.</div></div></div>
    <div class="stack">
      <form class="card" id="orgForm">
        <h2>Organization</h2>
        <div class="form-grid">
          <label class="field">Organization name<input name="name" value="${esc(o.name)}"></label>
          <label class="field">EIN (tax ID)<input name="ein" value="${esc(o.ein)}" placeholder="12-3456789"></label>
          <label class="field">Email<input name="email" value="${esc(o.email)}"></label>
          <label class="field">Fiscal year starts in<select name="fyStartMonth">${MONTHS_LONG.map((m, i) => `<option value="${i + 1}"${o.fyStartMonth === i + 1 ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
          <label class="field full">Mailing address<textarea name="address" rows="2">${esc(o.address)}</textarea></label>
          <label class="field full">Mission and programs (used in the notes to the financial statements)<textarea name="mission" rows="3" placeholder="e.g. We provide garden plots, youth education, and fresh produce to families in Springfield.">${esc(o.mission)}</textarea></label>
          <label class="field">Name that signs donor receipts<input name="signer" value="${esc(o.signer)}" placeholder="e.g. Jane Doe, Treasurer"></label>
        </div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary" type="submit">Save organization</button></div>
      </form>

      <form class="card" id="lockForm">
        <h2>Close the books</h2>
        <p class="small muted" style="margin-top:0">Once a month or year is final (reconciled and reviewed), close it so nobody changes it by accident. Transactions on or before this date can't be added, edited, or deleted.</p>
        <div class="btn-row" style="align-items:flex-end">
          <label class="field">Books closed through<input type="date" name="lockDate" value="${esc(o.lockDate)}"></label>
          <button class="btn primary" type="submit">Save</button>
          ${o.lockDate ? '<button class="btn" type="button" data-action="unlock">Reopen all periods</button>' : ''}
        </div>
      </form>

      <div class="grid grid-2">
        ${listSection('Bank & cash accounts', 'accounts', sortByCode(state.accounts).map(a => `<tr class="clickable" data-edit="accounts:${a.id}"><td>${coded(a)}<div class="small muted">Starting balance ${money(a.opening || 0)}</div></td><td class="num">${money(accountBalance(a.id))}</td></tr>`), 'Where your money is kept. Enter the balance on the day you start using this app.')}
        ${listSection('Funds', 'funds', sortByCode(state.funds).map(f => `<tr class="clickable" data-edit="funds:${f.id}"><td>${coded(f)}<div class="small muted">${f.restricted ? 'With donor restrictions' : 'Without donor restrictions'} · Starting ${money(f.opening || 0)}</div></td><td class="num">${money(fundBalance(f.id))}</td></tr>`), 'Separate money that donors restricted to a specific purpose (e.g. a grant for a youth program) from your general money. The starting balances of your funds should add up to the starting balances of your accounts.')}
      </div>

      <div class="grid grid-2">
        ${listSection('Income categories', 'income', sortByCode(state.categories.filter(c => c.kind === 'income')).map(c => `<tr class="clickable" data-edit="categories:${c.id}"><td>${coded(c)}</td><td class="small muted num">990 line ${F990[c.line990]?.line || '—'}</td></tr>`))}
        ${listSection('Expense categories', 'expense', sortByCode(state.categories.filter(c => c.kind === 'expense')).map(c => `<tr class="clickable" data-edit="categories:${c.id}"><td>${coded(c)}<div class="small muted">${FUNCTIONS[c.func] || ''}</div></td><td class="small muted num">990 line ${F990[c.line990]?.line || '—'}</td></tr>`))}
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

      <div class="card">
        <h2>Change history</h2>
        <p class="small muted" style="margin-top:0">Every transaction added, edited, or deleted, plus reconciliations and closed periods. Accountants call this an audit trail.</p>
        <div class="log-wrap"><table>
          <thead><tr><th>When</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>${state.log.slice(0, 300).map(l => `<tr><td style="white-space:nowrap" class="small">${new Date(l.at).toLocaleString()}</td><td class="small">${esc(l.action)}</td><td class="small">${esc(l.what)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No changes recorded yet.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;

  $('#orgForm').addEventListener('submit', e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    Object.assign(state.org, { ...fd, name: fd.name.trim() || 'My Nonprofit', fyStartMonth: Number(fd.fyStartMonth) });
    save(); render(); toast('Organization saved');
  });
  $('#lockForm').addEventListener('submit', e => {
    e.preventDefault();
    const d = e.target.lockDate.value;
    if (d === state.org.lockDate) return;
    state.org.lockDate = d;
    logChange(d ? 'Closed period' : 'Reopened periods', d ? `Books closed through ${prettyDate(d)}` : 'All periods reopened');
    save(); render(); toast(d ? `Books closed through ${prettyDate(d)}` : 'All periods reopened');
  });
  $('#restoreFile').addEventListener('change', e => { restoreBackup(e.target.files[0]); e.target.value = ''; });
}

function suggestCode(list) {
  const codes = list.map(x => parseInt(x.code, 10)).filter(Number.isFinite);
  return codes.length ? String(Math.max(...codes) + 10) : '';
}
function openListItemForm(listKey, item, kind) {
  const isCat = listKey === 'categories';
  const k = item?.kind || kind;
  const siblings = isCat ? state.categories.filter(c => c.kind === k) : state[listKey];
  const x = item ? { ...item } : {
    name: '', opening: 0, restricted: false, type: 'bank', kind: k, func: k === 'expense' ? 'program' : null,
    code: suggestCode(siblings) || (isCat ? (k === 'income' ? '4010' : '6010') : listKey === 'funds' ? '3010' : '1010'),
    line990: k === 'income' ? 'VIII-1f' : 'IX-24',
  };
  const label = { accounts: 'account', funds: 'fund', categories: `${x.kind} category` }[listKey];
  const lineOpts = F990_LINES.filter(([key]) => key.startsWith(x.kind === 'income' ? 'VIII' : 'IX'))
    .map(([key, line, text]) => `<option value="${key}"${x.line990 === key ? ' selected' : ''}>Line ${line}: ${esc(text)}</option>`).join('');
  openModal({
    title: `${item ? 'Edit' : 'New'} ${label}`,
    body: `<div class="form-grid">
      <label class="field full">Name<input name="name" value="${esc(x.name)}" required></label>
      <label class="field">Account number<input name="code" value="${esc(x.code)}" inputmode="numeric" placeholder="e.g. 6070"></label>
      ${!isCat ? `<label class="field">Starting balance ($)<input name="opening" inputmode="decimal" value="${centsToInput(x.opening || 0)}"></label>` : ''}
      ${listKey === 'funds' ? `<label class="check full"><input type="checkbox" name="restricted"${x.restricted ? ' checked' : ''}> Donor-restricted (can only be used for a specific purpose or time)</label>` : ''}
      ${isCat && x.kind === 'expense' ? `<label class="field">Usual function<select name="func">${Object.entries(FUNCTIONS).map(([fk, v]) => `<option value="${fk}"${x.func === fk ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
      ${isCat ? `<label class="field full">IRS Form 990 line (Part ${x.kind === 'income' ? 'VIII' : 'IX'})<select name="line990">${lineOpts}</select></label>` : ''}
    </div><div class="error-msg" id="formError"></div>`,
    foot: `<div>${item ? '<button type="button" class="btn danger" data-modal="delete">Delete</button>' : ''}</div>
      <div class="btn-row"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save</button></div>`,
    onDelete() {
      const field = { accounts: 'accountId', funds: 'fundId', categories: 'categoryId' }[listKey];
      const used = state.transactions.some(t => t[field] === item.id || (listKey === 'accounts' && t.toAccountId === item.id));
      if (used) { alert(`This ${label} is used by existing transactions, so it can't be deleted. You can rename it instead, or move those transactions first.`); return false; }
      if (!isCat && state[listKey].length <= 1) { alert(`You need at least one ${label}.`); return false; }
      if (!confirm(`Delete “${item.name}”?`)) return false;
      state[listKey] = state[listKey].filter(y => y.id !== item.id);
      logChange('Deleted', `${cap(label)} “${item.name}”`);
      save(); render(); toast('Deleted');
      return true;
    },
    onSubmit() {
      const form = $('#modalForm');
      const fd = Object.fromEntries(new FormData(form));
      const err = m => { $('#formError').textContent = m; return false; };
      if (!fd.name?.trim()) return err('Name is required.');
      const code = (fd.code || '').trim();
      if (code && [...state.accounts, ...state.funds, ...state.categories].some(y => y.code === code && y.id !== item?.id)) return err(`Account number ${code} is already used.`);
      const vals = { name: fd.name.trim(), code };
      if (!isCat) {
        const c = toCents(fd.opening || 0);
        if (Number.isNaN(c)) return err('Starting balance must be a number.');
        vals.opening = c;
      }
      if (listKey === 'funds') vals.restricted = !!form.restricted.checked;
      if (isCat) { vals.kind = x.kind; vals.func = x.kind === 'expense' ? fd.func : null; vals.line990 = fd.line990; }
      if (item) {
        const target = byId(state[listKey], item.id);
        if (!isCat && (target.opening || 0) !== vals.opening) logChange('Edited', `${cap(label)} “${vals.name}” starting balance ${money(target.opening || 0)} → ${money(vals.opening)}`);
        Object.assign(target, vals);
      } else {
        state[listKey].push({ id: uid(), ...vals });
        logChange('Added', `${cap(label)} “${vals.name}”`);
      }
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
  const header = ['Date', 'Type', 'Amount', 'Description', 'Account #', 'Category', 'Function', 'Fund', 'Bank account', 'To account', 'Donor', 'Payee', 'Reference', 'Receipt on file', 'Cleared', 'Notes'];
  const rows = [...list].sort((a, b) => a.date.localeCompare(b.date)).map(t => [
    t.date, t.type, (t.type === 'expense' ? -t.amount : t.amount) / 100, t.description,
    byId(state.categories, t.categoryId)?.code || '', t.type === 'transfer' ? '' : catName(t.categoryId), t.func ? FUNCTIONS[t.func] : '', t.fundId ? fundName(t.fundId) : '',
    acctName(t.accountId), t.toAccountId ? acctName(t.toAccountId) : '', donorName(t.donorId), t.payee, t.reference,
    t.type === 'transfer' ? '' : t.docOnFile ? 'Yes' : 'No', t.cleared?.[t.accountId] ? 'Yes' : 'No', t.notes,
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
      logChange('Restored backup', file.name);
      save(); render(); toast('Backup restored');
    } catch (e) {
      alert('That file could not be read as a Nonprofit Books backup.');
    }
  };
  reader.readAsText(file);
}

/* Sample data so people can explore the app: two fiscal years of activity. */
function loadSample() {
  const s = defaultState();
  s.org = {
    ...s.org, name: 'Riverside Community Garden', ein: '12-3456789', address: '100 River Rd\nSpringfield, ST 00000', email: 'hello@example.org', signer: 'Alex Rivera, Treasurer',
    mission: 'Riverside Community Garden provides affordable garden plots, hands-on youth education, and fresh produce to families in Springfield. Its main programs are community plot rentals and the Youth Garden summer program.',
  };
  const [checking, savings] = s.accounts;
  checking.opening = 1100000; savings.opening = 500000;
  const [general, grants] = s.funds;
  general.opening = 1600000;
  grants.name = 'Youth Garden Grant';
  const cat = n => s.categories.find(c => c.name === n);
  const donors = ['Maria Lopez', 'James Chen', 'Priya Patel', 'The Okafor Family', 'Sam Nguyen', 'Green Valley Bank'].map(name => ({ id: uid(), name, email: '', phone: '', address: '', notes: '' }));
  s.donors = donors;
  const now = new Date();
  const cy = now.getFullYear();
  const tx = [];
  const add = (year, m, d, type, amt, desc, c, extra = {}) => {
    const date = new Date(year, m, d);
    if (date > now) return;
    const category = c ? cat(c) : null;
    tx.push({
      id: uid(), created: Date.now() + tx.length, type, date: isoDate(date), amount: Math.round(amt * 100), description: desc, categoryId: category?.id || '',
      fundId: type === 'transfer' ? '' : general.id, accountId: checking.id, toAccountId: '', donorId: '', payee: '', reference: '',
      func: type === 'expense' ? category.func : '', notes: '', docOnFile: type !== 'transfer', ...extra,
    });
  };
  const year = (y, k) => {
    const A = (m, d, type, amt, ...rest) => add(y, m, d, type, Math.round(amt * k * 100) / 100, ...rest);
    for (let m = 0; m < 12; m++) {
      A(m, 1, 'expense', 900, `Garden plot lease — ${MONTHS_LONG[m]}`, 'Rent & Utilities', { payee: 'City Parks Dept.', reference: String(1000 + m * 3 + (y - cy + 1) * 40) });
      A(m, 15, 'expense', 1800, `Coordinator wages — ${MONTHS_LONG[m]}`, 'Salaries & Wages', { payee: 'Payroll' });
      A(m, 15, 'expense', 240, 'Payroll taxes', 'Payroll Taxes & Benefits', { func: 'management', payee: 'IRS' });
      A(m, 5, 'income', 150 + (m % 4) * 60, 'Monthly donation', 'Individual Donations', { donorId: donors[0].id });
      A(m, 20, 'income', 100, 'Monthly donation', 'Individual Donations', { donorId: donors[1].id });
      A(m, 10, 'expense', 49, 'Accounting software', 'Technology & Software', { payee: 'SaaS Co.', docOnFile: !(y === cy && m % 4 === 1) });
      A(m, 22, 'income', 300 + (m * 37) % 400, 'Plot rental fees', 'Program Service Fees');
      A(m, 25, 'expense', 12.5, 'Card processing fees', 'Bank & Payment Fees');
    }
    A(0, 20, 'income', 10000, 'General operating support grant', 'Grants', { reference: `CF-${y}` });
    A(1, 3, 'income', 15000, 'Youth garden program grant', 'Grants', { fundId: grants.id, donorId: donors[5].id, reference: `GR-${y}` });
    A(2, 12, 'expense', 2350, 'Seeds, soil, and tools for youth program', 'Program Supplies', { fundId: grants.id, payee: 'Farm Supply Co.' });
    A(4, 18, 'income', 6400, 'Spring plant sale', 'Fundraising Events');
    A(4, 10, 'expense', 850, 'Plant sale flyers and supplies', 'Fundraising Expenses', { payee: 'PrintShop', docOnFile: y !== cy });
    A(5, 2, 'expense', 1200, 'Liability insurance (annual)', 'Insurance', { payee: 'Mutual Insurance' });
    A(5, 20, 'income', 2500, 'Major gift', 'Individual Donations', { donorId: donors[2].id, reference: '1042' });
    A(6, 8, 'expense', 3100, 'Youth summer camp supplies & field trips', 'Program Supplies', { fundId: grants.id, payee: 'Various' });
    A(7, 14, 'income', 750, 'Gift in honor of Grandma Okafor', 'Individual Donations', { donorId: donors[3].id });
    A(7, 30, 'income', 400, 'Donation', 'Individual Donations', { donorId: donors[4].id });
    A(8, 5, 'expense', 900, 'Annual financial review', 'Professional Fees', { payee: 'Smith CPA' });
    A(8, 28, 'transfer', 3000, 'Move reserves to savings', null, { toAccountId: savings.id });
    A(9, 15, 'income', 5000, 'Harvest dinner sponsorship', 'Corporate Sponsorships', { donorId: donors[5].id });
    A(10, 28, 'income', 1200, 'Giving Tuesday campaign', 'Individual Donations');
    A(11, 15, 'income', 1000, 'Year-end gift', 'Individual Donations', { donorId: donors[2].id });
    A(11, 31, 'income', 18, 'Savings account interest', 'Interest Income', { accountId: savings.id });
  };
  year(cy - 1, 0.9);
  year(cy, 1);
  s.transactions = tx;

  // Checking reconciled through the end of last month, with two checks still outstanding.
  const stmt = isoDate(new Date(now.getFullYear(), now.getMonth(), 0));
  const recId = uid();
  const items = tx.filter(t => t.date <= stmt && touches(t, checking.id)).sort((a, b) => a.date.localeCompare(b.date));
  const outstanding = new Set(items.filter(t => t.type === 'expense').slice(-2).map(t => t.id));
  let ending = checking.opening;
  items.forEach(t => {
    if (outstanding.has(t.id)) return;
    t.cleared = { [checking.id]: true };
    t.reconciled = { [checking.id]: recId };
    ending += signedFor(t, checking.id);
  });
  s.reconciliations = [{
    id: recId, accountId: checking.id, statementDate: stmt, endingBalance: ending, beginningBalance: checking.opening, completedAt: new Date().toISOString(),
    clearedIds: items.filter(t => !outstanding.has(t.id)).map(t => t.id), outstandingIds: [...outstanding],
  }];
  s.org.lockDate = `${cy - 1}-12-31`;

  const b = {};
  [['Individual Donations', 12000], ['Grants', 25000], ['Program Service Fees', 6000], ['Fundraising Events', 5000], ['Corporate Sponsorships', 4000],
   ['Salaries & Wages', 21600], ['Rent & Utilities', 10800], ['Program Supplies', 6000], ['Payroll Taxes & Benefits', 2880], ['Fundraising Expenses', 1000], ['Insurance', 1200], ['Professional Fees', 1000]]
    .forEach(([n, v]) => { b[cat(n).id] = v * 100; });
  s.budgets = { [cy]: b, [cy - 1]: Object.fromEntries(Object.entries(b).map(([id, v]) => [id, Math.round(v * 0.9)])) };
  s.log = [{ at: new Date().toISOString(), action: 'Loaded sample data', what: 'Riverside Community Garden sample books' }];
  state = s;
  save();
}

/* =========================================================================
 * Global click handling (event delegation)
 * ========================================================================= */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action],[data-edit-tx],[data-edit-donor],[data-receipt],[data-report],[data-add],[data-edit],[data-view-recon],[data-undo-recon]');
  if (!el) return;

  if (el.dataset.editTx) return openTxForm(byId(state.transactions, el.dataset.editTx));
  if (el.dataset.editDonor) { e.preventDefault(); return openDonorForm(byId(state.donors, el.dataset.editDonor)); }
  if (el.dataset.receipt) return renderReceipt(el.dataset.receipt, new Date().getFullYear() - (new Date().getMonth() < 2 ? 1 : 0));
  if (el.dataset.report) { ui.reportTab = el.dataset.report; return render(); }
  if (el.dataset.viewRecon) { ui.viewRecon = el.dataset.viewRecon; return render(); }
  if (el.dataset.undoRecon) return undoRecon(el.dataset.undoRecon);
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
    case 'add-donor': return openDonorForm(null);
    case 'export-csv': return exportCSV(filteredTransactions());
    case 'export-csv-all': return exportCSV(state.transactions);
    case 'export-report': return exportReportCSV();
    case 'clear-filters': ui.txFilter = emptyTxFilter(); return render();
    case 'show-missing-docs': {
      const fy = fyRange(fyStartYearFor(todayISO()));
      ui.txFilter = { ...emptyTxFilter(), type: 'expense', doc: 'missing', from: fy.from, to: fy.to };
      if (location.hash === '#transactions') return render();
      location.hash = '#transactions';
      return;
    }
    case 'recon-all': case 'recon-none': {
      const acct = ui.recon.accountId;
      reconItems().forEach(t => { t.cleared ||= {}; if (el.dataset.action === 'recon-all') t.cleared[acct] = true; else delete t.cleared[acct]; });
      save(); return render();
    }
    case 'recon-later': ui.recon = null; render(); return toast('Progress saved. Start again with the same statement to continue.');
    case 'recon-cancel': {
      if (!confirm('Cancel this reconciliation and clear the ticks you made?')) return;
      const acct = ui.recon.accountId;
      reconItems().forEach(t => { if (t.cleared) delete t.cleared[acct]; });
      ui.recon = null; save(); return render();
    }
    case 'recon-finish': return finishRecon();
    case 'recon-back': e.preventDefault(); ui.viewRecon = null; return render();
    case 'unlock':
      state.org.lockDate = '';
      logChange('Reopened periods', 'All periods reopened');
      save(); render(); return toast('All periods reopened');
    case 'backup':
      return download(`nonprofit-books-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
    case 'load-sample':
      if (state.transactions.length && !confirm('This replaces your current data with sample data. Download a backup first if you want to keep it. Continue?')) return;
      loadSample(); ui.recon = null; ui.viewRecon = null; location.hash = '#dashboard'; render(); return toast('Sample data loaded');
    case 'reset':
      if (!confirm('Erase ALL data in this browser? Download a backup first if you want to keep it.')) return;
      if (!confirm('Are you absolutely sure? This cannot be undone.')) return;
      state = defaultState(); ui.recon = null; ui.viewRecon = null; save(); render(); return toast('All data erased');
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
