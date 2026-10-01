/*
 * Bank feed — bring transactions in from your bank.
 *
 * Banks let you download account activity as a file: CSV, or the OFX / QFX /
 * QBO formats used by Quicken and QuickBooks. This file reads those downloads
 * entirely in the browser (nothing is uploaded anywhere) and puts each bank
 * transaction in a review queue. From there it can be:
 *   - matched to an entry you already recorded,
 *   - added as a new transaction, with a suggested category, or
 *   - excluded.
 *
 * Loaded before app.js. It uses app.js helpers (state, save, money, ...) only
 * inside functions, which run after both files have loaded.
 */
'use strict';

const feedUI = {
  stage: null,   // a parsed file waiting for the person to confirm the import
  edits: {},     // per bank item: the choices made in the review table
  account: '',   // review table filter
};

/* ---------------- Reading bank files ---------------- */
function parseCSVText(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.map(r => r.map(x => x.trim())).filter(r => r.some(Boolean));
}

/* "$1,234.50", "-12.00", "(45.00)" and "12.00 DR" all become signed cents. */
function parseBankAmount(s) {
  let t = String(s ?? '').trim();
  if (!t) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/\s*DR$/i.test(t)) { neg = true; t = t.replace(/\s*DR$/i, ''); }
  t = t.replace(/\s*CR$/i, '');
  const c = toCents(t);
  return Number.isNaN(c) ? NaN : neg ? -Math.abs(c) : c;
}

/* Bank dates come as 2026-10-01, 10/01/2026, 1/10/26, 20261001 or "Oct 1, 2026". */
function parseBankDate(s, fmt = 'mdy') {
  s = String(s ?? '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const [mo, d] = fmt === 'dmy' ? [+m[2], +m[1]] : [+m[1], +m[2]];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return s && !Number.isNaN(d.getTime()) ? isoDate(d) : null;
}

function guessColumns(header) {
  const find = (re, not) => header.findIndex(h => re.test(h) && !(not && not.test(h)));
  const desc = [/description/i, /payee|merchant/i, /name/i, /memo|details|narrative/i].map(re => find(re)).find(i => i >= 0) ?? -1;
  return {
    date: find(/date/i),
    desc,
    amount: find(/amount/i, /balance/i),
    debit: find(/debit|withdraw|money out|paid out/i),
    credit: find(/credit|deposit|money in|paid in/i, /card/i),
    check: find(/check|chk|cheque|slip/i),
  };
}

function csvStage(text, fileName, accountId) {
  const all = parseCSVText(text);
  if (!all.length) return null;
  const h = all.slice(0, 15).findIndex(r => r.some(c => /date/i.test(c)) && r.some(c => /amount|debit|credit|withdraw|deposit|money (in|out)|paid (in|out)/i.test(c)));
  const header = h >= 0 ? all[h] : all[0].map((_, i) => `Column ${i + 1}`);
  const rows = h >= 0 ? all.slice(h + 1) : all;
  const map = h >= 0 ? guessColumns(header) : { date: 0, desc: 1, amount: 2, debit: -1, credit: -1, check: -1 };
  const firsts = rows.map(r => +(String(r[map.date] || '').match(/^(\d{1,2})[-/.]/) || [])[1]).filter(Boolean);
  return {
    kind: 'csv', fileName, accountId, header, rows, map,
    mode: map.amount < 0 && (map.debit >= 0 || map.credit >= 0) ? 'split' : 'single',
    dateFmt: firsts.some(n => n > 12) ? 'dmy' : 'mdy',
    flip: false,
  };
}
function csvItems(st) {
  const items = [];
  let skipped = 0;
  for (const r of st.rows) {
    const date = parseBankDate(r[st.map.date], st.dateFmt);
    let amount;
    if (st.mode === 'split') {
      const out = parseBankAmount(r[st.map.debit]), inn = parseBankAmount(r[st.map.credit]);
      amount = (Number.isNaN(inn) ? 0 : Math.abs(inn)) - (Number.isNaN(out) ? 0 : Math.abs(out));
    } else {
      amount = parseBankAmount(r[st.map.amount]);
      if (st.flip) amount = -amount;
    }
    if (!date || Number.isNaN(amount) || amount === 0) { skipped++; continue; }
    items.push({
      date, amount,
      description: String(r[st.map.desc] ?? '').replace(/\s+/g, ' ').trim() || '(no description)',
      check: st.map.check >= 0 ? String(r[st.map.check] ?? '').trim() : '',
      fitid: '',
    });
  }
  return { items, skipped };
}

const decodeEntities = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&(apos|#39);/g, "'");
function parseOFXText(text) {
  const get = (block, tag) => { const m = block.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, 'i')); return m ? decodeEntities(m[1].trim()) : ''; };
  const items = [];
  for (const part of text.split(/<STMTTRN>/i).slice(1)) {
    const b = part.split(/<\/STMTTRN>/i)[0];
    const date = parseBankDate(get(b, 'DTPOSTED').slice(0, 8));
    const amount = parseBankAmount(get(b, 'TRNAMT'));
    if (!date || Number.isNaN(amount) || amount === 0) continue;
    const name = get(b, 'NAME'), memo = get(b, 'MEMO');
    items.push({
      date, amount,
      description: [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' · ') || get(b, 'TRNTYPE') || '(no description)',
      fitid: get(b, 'FITID'),
      check: get(b, 'CHECKNUM'),
    });
  }
  const lb = (text.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|$)/i) || [])[1] || '';
  const bal = lb ? { amount: parseBankAmount(get(lb, 'BALAMT')), asOf: parseBankDate(get(lb, 'DTASOF').slice(0, 8)) } : null;
  return { items, balance: bal && !Number.isNaN(bal.amount) && bal.asOf ? bal : null, acctId: get(text, 'ACCTID') };
}

async function readBankFile(file) {
  if (!file) return;
  const accountId = $('#feedAccount')?.value || state.accounts[0]?.id;
  let text;
  try { text = (await file.text()).replace(/^﻿/, ''); }
  catch (e) { return alert('That file could not be read.'); }
  if (/OFXHEADER|<OFX>/i.test(text)) {
    const o = parseOFXText(text);
    if (!o.items.length) return alert('No transactions were found in that file. Try downloading it again, or choose CSV format.');
    const last4 = o.acctId.slice(-4);
    const known = last4 && state.accounts.find(a => a.bankLast4 === last4);
    feedUI.stage = { kind: 'ofx', fileName: file.name, accountId: known ? known.id : accountId, items: o.items, balance: o.balance, last4 };
  } else {
    const st = csvStage(text, file.name, accountId);
    if (!st) return alert('That file looks empty. Download it again from your bank, as CSV, OFX, QFX or QBO.');
    feedUI.stage = st;
  }
  render();
}

/* Put new bank items in the review queue, skipping ones already imported. */
function stageItems(accountId, items, source) {
  const mine = state.bankFeed.filter(f => f.accountId === accountId);
  const keys = new Set(mine.flatMap(f => [f.key, f.altKey]));
  const seen = {};
  let added = 0, dupes = 0;
  for (const it of items) {
    const base = `${it.date}|${it.amount}|${it.description.toUpperCase().replace(/\s+/g, ' ')}`;
    const n = seen[base] = (seen[base] || 0) + 1;
    const altKey = `${base}#${n}`;
    const key = it.fitid ? `fit:${it.fitid}` : altKey;
    if (keys.has(key) || keys.has(altKey)) { dupes++; continue; }
    keys.add(key); keys.add(altKey);
    state.bankFeed.push({ id: uid(), key, altKey, accountId, date: it.date, amount: it.amount, description: it.description, check: it.check || '', status: 'pending', txId: '', importedAt: new Date().toISOString(), source });
    added++;
  }
  return { added, dupes };
}

function commitStage() {
  const st = feedUI.stage;
  const items = st.kind === 'ofx' ? st.items : csvItems(st).items;
  if (!items.length) return alert('No transactions to import. Check the column choices.');
  const { added, dupes } = stageItems(st.accountId, items, st.fileName);
  const acct = byId(state.accounts, st.accountId);
  if (st.balance) acct.bankBalance = st.balance;
  if (st.last4 && !acct.bankLast4) acct.bankLast4 = st.last4;
  logChange('Imported bank file', `${st.fileName} into ${acct.name}: ${added} new, ${dupes} already imported`);
  save();
  feedUI.stage = null;
  feedUI.account = st.accountId;
  render();
  toast(`${plural(added, 'new transaction')} to review${dupes ? ` · ${dupes} already imported, skipped` : ''}`);
}

/* ---------------- Suggestions ---------------- */
const defaultFund = () => state.funds.find(f => !f.restricted)?.id || state.funds[0]?.id || '';
const payeeKey = s => String(s || '').toUpperCase().replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ');
const cleanDesc = s => String(s || '').replace(/\s+/g, ' ').trim();

/* An entry already in the books with the same amount, in the same account, within 10 days. */
function feedMatch(item) {
  const claimed = new Set(state.bankFeed.filter(f => f.txId && f.status !== 'pending').map(f => `${f.txId}|${f.accountId}`));
  let best = null, bestScore = Infinity;
  for (const t of state.transactions) {
    if (claimed.has(`${t.id}|${item.accountId}`) || !touches(t, item.accountId) || signedFor(t, item.accountId) !== item.amount) continue;
    const days = Math.abs(Date.parse(t.date) - Date.parse(item.date)) / 864e5;
    if (days > 10) continue;
    const score = days - (item.check && t.reference === item.check ? 100 : 0);
    if (score < bestScore) { best = t; bestScore = score; }
  }
  return best;
}

/* Category suggestion: your bank rules first, then how similar entries were recorded before. */
function feedSuggest(item) {
  const desc = item.description.toUpperCase();
  for (const r of state.bankRules) {
    if (!r.contains || !desc.includes(r.contains.toUpperCase())) continue;
    if (r.target.startsWith('transfer:')) return { type: 'transfer', otherAccountId: r.target.slice(9), via: `your rule “${r.contains}”` };
    const c = byId(state.categories, r.target);
    if (!c || (c.kind === 'income') !== (item.amount > 0)) continue;
    return { type: c.kind, categoryId: c.id, fundId: r.fundId || defaultFund(), via: `your rule “${r.contains}”` };
  }
  const key = payeeKey(item.description);
  if (key) {
    const past = state.transactions
      .filter(t => t.type !== 'transfer' && t.categoryId && (t.type === 'income') === (item.amount > 0)
        && [t.bankDescription, t.payee, t.description].some(s => s && payeeKey(s) === key))
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (past) return { type: past.type, categoryId: past.categoryId, fundId: past.fundId, via: 'similar past entries' };
  }
  return { type: item.amount > 0 ? 'income' : 'expense', categoryId: '', fundId: defaultFund(), via: '' };
}
function feedEdit(item) {
  if (!feedUI.edits[item.id]) {
    const s = feedSuggest(item);
    feedUI.edits[item.id] = {
      mode: 'auto', type: s.type, categoryId: s.categoryId || '', fundId: s.fundId || defaultFund(), via: s.via,
      otherAccountId: s.otherAccountId || sortByCode(state.accounts).find(a => a.id !== item.accountId)?.id || '',
    };
  }
  return feedUI.edits[item.id];
}

/* ---------------- Actions ---------------- */
function feedAdd(item) {
  const e = feedEdit(item);
  if (isLocked(item.date)) { toast(`The books are closed through ${prettyDate(state.org.lockDate)}.`); return false; }
  const desc = cleanDesc(item.description);
  const base = {
    id: uid(), created: Date.now(), date: item.date, amount: Math.abs(item.amount), description: desc, reference: item.check, notes: '',
    docOnFile: false, donorId: '', payee: '', func: '', source: 'bank', bankDescription: item.description, cleared: { [item.accountId]: true },
  };
  let t;
  if (e.type === 'transfer') {
    if (!e.otherAccountId || e.otherAccountId === item.accountId) { toast('Choose the other account for this transfer.'); return false; }
    const out = item.amount < 0;
    t = { ...base, type: 'transfer', categoryId: '', fundId: '', accountId: out ? item.accountId : e.otherAccountId, toAccountId: out ? e.otherAccountId : item.accountId };
  } else {
    const c = byId(state.categories, e.categoryId);
    if (!c) { toast('Choose a category first.'); return false; }
    t = { ...base, type: e.type, categoryId: c.id, fundId: e.fundId || defaultFund(), accountId: item.accountId, toAccountId: '', func: e.type === 'expense' ? (c.func || 'management') : '', payee: e.type === 'expense' ? desc : '' };
  }
  state.transactions.push(t);
  item.status = 'added';
  item.txId = t.id;
  logChange('Added from bank', txLabel(t));
  return true;
}
function feedAcceptMatch(item, t) {
  t.cleared ||= {};
  item.prevCleared = !!t.cleared[item.accountId];
  t.cleared[item.accountId] = true;
  item.status = 'matched';
  item.txId = t.id;
  logChange('Matched bank transaction', `${cleanDesc(item.description)} (${prettyDate(item.date)}, ${money(item.amount)}) → ${txLabel(t)}`);
}
function feedUndo(item) {
  const t = byId(state.transactions, item.txId);
  if (item.status === 'added' && t) {
    if (isReconciled(t)) return alert('That transaction has been reconciled. Undo the reconciliation first (Reconcile page).');
    if (isLocked(t.date)) return alert(`That transaction is in a closed period (through ${prettyDate(state.org.lockDate)}).`);
    state.transactions = state.transactions.filter(x => x !== t);
    logChange('Deleted', `${txLabel(t)} (undid bank import)`);
  }
  if (item.status === 'matched' && t && !t.reconciled?.[item.accountId] && !item.prevCleared) delete t.cleared[item.accountId];
  item.status = 'pending';
  item.txId = '';
  delete feedUI.edits[item.id];
  save(); render(); toast('Moved back to review');
}
function feedPending() {
  return state.bankFeed
    .filter(f => f.status === 'pending' && (!feedUI.account || f.accountId === feedUI.account))
    .sort((a, b) => a.date.localeCompare(b.date));
}
/* What "Accept all suggestions" would do: matches, plus additions with a category suggestion. */
function feedAutoPlan() {
  const plan = [];
  for (const item of feedPending()) {
    if (isLocked(item.date)) continue;
    const e = feedEdit(item);
    const m = e.mode !== 'add' ? feedMatch(item) : null;
    if (m) plan.push({ item, match: m });
    else if (e.via && (e.type === 'transfer' ? e.otherAccountId : e.categoryId)) plan.push({ item });
  }
  return plan;
}
function feedAcceptAll() {
  let n = 0;
  for (const p of feedAutoPlan()) {
    // re-check the match: an earlier item in this loop may have claimed it
    const m = p.match ? feedMatch(p.item) : null;
    if (m) { feedAcceptMatch(p.item, m); n++; }
    else if (!p.match && feedAdd(p.item)) n++;
  }
  save(); render(); toast(`${plural(n, 'bank transaction')} recorded`);
}

function openRuleForm(item) {
  const e = item ? feedEdit(item) : null;
  const target = e ? (e.type === 'transfer' ? `transfer:${e.otherAccountId}` : e.categoryId) : '';
  const catOpts = kind => sortByName(state.categories.filter(c => c.kind === kind)).map(c => `<option value="${c.id}"${c.id === target ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  openModal({
    title: 'New bank rule',
    body: `<p class="small muted" style="margin-top:0">When a bank description contains these words, the rule suggests a category for it.</p>
      <div class="form-grid">
        <label class="field full">Description contains<input name="contains" value="${esc(item ? payeeKey(item.description) : '')}" placeholder="e.g. AMAZON"></label>
        <label class="field">Suggest<select name="target">
          <option value="">Choose…</option>
          <optgroup label="Expense categories">${catOpts('expense')}</optgroup>
          <optgroup label="Income categories">${catOpts('income')}</optgroup>
          <optgroup label="Transfer to or from">${sortByCode(state.accounts).map(a => `<option value="transfer:${a.id}"${`transfer:${a.id}` === target ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>
        </select></label>
        <label class="field">Fund<select name="fundId">${state.funds.map(f => `<option value="${f.id}"${f.id === (e?.fundId || defaultFund()) ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      </div><div class="error-msg" id="formError"></div>`,
    onSubmit() {
      const fd = Object.fromEntries(new FormData($('#modalForm')));
      if (!fd.contains.trim()) { $('#formError').textContent = 'Enter the words to look for.'; return false; }
      if (!fd.target) { $('#formError').textContent = 'Choose what the rule should suggest.'; return false; }
      state.bankRules.push({ id: uid(), contains: fd.contains.trim(), target: fd.target, fundId: fd.target.startsWith('transfer:') ? '' : fd.fundId });
      // re-run suggestions for items the person hasn't changed by hand
      Object.keys(feedUI.edits).forEach(id => { if (feedUI.edits[id].mode === 'auto') delete feedUI.edits[id]; });
      save(); render(); toast('Rule saved');
      return true;
    },
  });
}
const ruleTarget = r => r.target.startsWith('transfer:') ? `Transfer with ${esc(acctName(r.target.slice(9)))}` : esc(catName(r.target));

/* ---------------- Page ---------------- */
function renderBankFeed(root) {
  if (!feedUI.account && state.accounts.length === 1) feedUI.account = state.accounts[0].id;
  const pendingAll = state.bankFeed.filter(f => f.status === 'pending');
  const pending = feedPending();
  const plan = feedAutoPlan();
  const done = state.bankFeed.filter(f => f.status !== 'pending').sort((a, b) => b.importedAt.localeCompare(a.importedAt) || b.date.localeCompare(a.date)).slice(0, 40);
  const balances = state.accounts.filter(a => a.bankBalance);
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Bank feed</h1><div class="muted">Bring in transactions from your bank, then review each one before it goes into your books.</div></div>
    </div>
    ${feedUI.stage ? renderStage(feedUI.stage) : `
    <div class="grid grid-2">
      <div class="card">
        <h2>Import from your bank</h2>
        <div class="form-grid">
          <label class="field full">Bank account<select id="feedAccount">${options(sortByCode(state.accounts), feedUI.account || state.accounts[0]?.id)}</select></label>
        </div>
        <label class="dropzone" id="dropzone">
          <input type="file" id="bankFile" accept=".csv,.ofx,.qfx,.qbo,.txt" hidden>
          <strong>Choose a bank file</strong> or drop it here
          <span class="small muted">CSV, OFX, QFX or QBO</span>
        </label>
        <p class="small muted" style="margin-bottom:0">The file is read on this device and is not uploaded anywhere. Transactions you've already imported are skipped automatically. <button class="linkbtn" data-feed="sample-file">Try a sample bank file</button></p>
      </div>
      <div class="card">
        <h2>How to get the file</h2>
        <ol class="small steps">
          <li>Sign in to your bank's website.</li>
          <li>Open the account's activity or statements page and look for <strong>Download</strong> or <strong>Export</strong>.</li>
          <li>Pick <strong>QuickBooks (QBO)</strong>, <strong>Quicken (QFX)</strong> or <strong>OFX</strong> if offered, or <strong>CSV</strong>.</li>
          <li>Choose the dates since your last import, save the file, and choose it here.</li>
        </ol>
        <p class="small muted">QBO, QFX and OFX files work best: they include the bank's own ID for each transaction and your current bank balance.</p>
      </div>
    </div>`}

    ${balances.length ? `<div class="card" style="margin-top:16px">
      <h2>Bank balance check</h2>
      <div class="table-wrap"><table><tbody>${balances.map(a => {
        const books = accountBalance(a.id, a.bankBalance.asOf);
        const waiting = state.bankFeed.filter(f => f.accountId === a.id && f.status === 'pending' && f.date <= a.bankBalance.asOf).length;
        return `<tr><td>${esc(a.name)}<div class="small muted">From your last bank file, ${prettyDate(a.bankBalance.asOf)}</div></td>
          <td class="num">Bank ${money(a.bankBalance.amount)}<div class="small muted">Books ${money(books)}</div></td>
          <td class="num">${books === a.bankBalance.amount ? statusPill('ok', 'Agree') : statusPill('warn', waiting ? `${plural(waiting, 'item')} to review` : `Differ by ${money(a.bankBalance.amount - books)}`)}</td></tr>`;
      }).join('')}</tbody></table></div>
    </div>` : ''}

    <div class="card" style="margin-top:16px" id="feedReview">
      <div class="feed-head">
        <h2>To review <span class="muted">(${pending.length})</span></h2>
        <div class="btn-row" style="align-items:flex-end">
          <label class="field">Show<select data-feed-filter>${`<option value="">All accounts (${pendingAll.length})</option>` + sortByCode(state.accounts).map(a => `<option value="${a.id}"${feedUI.account === a.id ? ' selected' : ''}>${esc(a.name)} (${pendingAll.filter(f => f.accountId === a.id).length})</option>`).join('')}</select></label>
          <button class="btn primary" data-feed="accept-all"${plan.length ? '' : ' disabled'}>Accept ${plan.length ? plan.length + ' ' : ''}suggested</button>
        </div>
      </div>
      ${pending.length ? `<p class="small muted" style="margin-top:0"><b>Match</b> links a bank transaction to an entry you already recorded. <b>Add</b> records it as new. Everything recorded here is marked as cleared for reconciliation.</p>` : ''}
      <div class="table-wrap"><table class="feed-table">
        <thead><tr><th>Date</th><th>Bank description</th><th class="num">Amount</th><th>What to do</th></tr></thead>
        <tbody>${pending.length ? pending.map(feedRow).join('') : `<tr><td colspan="4" class="empty">${state.bankFeed.length ? 'All caught up. Import a new bank file when you have one.' : 'Nothing to review yet. Import a file from your bank to get started.'}</td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h2>Bank rules</h2><button class="btn small" data-feed="new-rule">+ Rule</button></div>
        <p class="small muted" style="margin-top:0">Rules suggest a category from words in the bank description. Without a rule, the app copies how you recorded similar entries before.</p>
        <div class="table-wrap"><table><tbody>${state.bankRules.map(r => `<tr><td>Contains “${esc(r.contains)}”<div class="small muted">→ ${ruleTarget(r)}${r.fundId ? ` · ${esc(fundName(r.fundId))}` : ''}</div></td><td class="num"><button class="btn small danger" data-feed="delete-rule" data-id="${r.id}">Delete</button></td></tr>`).join('') || '<tr><td class="empty">No rules yet.</td></tr>'}</tbody></table></div>
      </div>
      <div class="card">
        <h2>Recently processed</h2>
        <div class="log-wrap"><table><tbody>${done.map(f => {
          const t = byId(state.transactions, f.txId);
          const label = f.status === 'excluded' ? statusPill('info', 'Excluded') : f.status === 'matched' ? statusPill('ok', 'Matched') : statusPill('ok', 'Added');
          return `<tr><td class="small">${prettyDate(f.date)}</td><td class="small">${esc(cleanDesc(f.description))}<div>${label}${t ? ` <a href="#" class="small" data-edit-tx="${t.id}">${esc(t.type === 'transfer' ? 'Transfer' : catName(t.categoryId))}</a>` : ''}</div></td><td class="num small">${money(f.amount)}</td><td class="num"><button class="btn small" data-feed="undo" data-id="${f.id}">Undo</button></td></tr>`;
        }).join('') || '<tr><td class="empty">Nothing yet.</td></tr>'}</tbody></table></div>
      </div>
    </div>`;

  const file = $('#bankFile');
  if (file) {
    file.addEventListener('change', e => { readBankFile(e.target.files[0]); e.target.value = ''; });
    $('#feedAccount').addEventListener('change', e => { feedUI.account = e.target.value; });
    const dz = $('#dropzone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); readBankFile(e.dataTransfer.files[0]); });
  }
  $('#feedReview').addEventListener('change', e => {
    if (e.target.matches('[data-feed-filter]')) { feedUI.account = e.target.value; return render(); }
    const field = e.target.dataset.feedField;
    if (!field) return;
    const ed = feedUI.edits[e.target.dataset.id];
    ed[field] = e.target.value;
    ed.mode = ed.mode === 'auto' ? 'edited' : ed.mode;
    ed.via = '';
    if (field === 'type') { ed.categoryId = ''; render(); }
  });
  const stageForm = $('#stageForm');
  if (stageForm) stageForm.addEventListener('change', e => {
    const st = feedUI.stage, n = e.target.name;
    if (n === 'accountId') st.accountId = e.target.value;
    else if (n === 'mode') st.mode = e.target.value;
    else if (n === 'dateFmt') st.dateFmt = e.target.value;
    else if (n === 'flip') st.flip = e.target.checked;
    else if (n in (st.map || {})) st.map[n] = Number(e.target.value);
    render();
  });
}

function feedRow(item) {
  const e = feedEdit(item);
  const m = e.mode !== 'add' ? feedMatch(item) : null;
  const amt = `<td class="num ${item.amount > 0 ? 'pos' : ''}">${money(item.amount)}</td>`;
  const head = `<td style="white-space:nowrap">${prettyDate(item.date)}</td><td>${esc(cleanDesc(item.description))}<div class="small muted">${esc(acctName(item.accountId))}${item.check ? ` · Check #${esc(item.check)}` : ''}</div></td>${amt}`;
  const exclude = `<button class="btn small" data-feed="exclude" data-id="${item.id}" title="Not a transaction for the books, or a duplicate">Exclude</button>`;
  if (isLocked(item.date)) return `<tr>${head}<td>${statusPill('info', 'Closed period')} <span class="small muted">Dated on or before ${prettyDate(state.org.lockDate)}.</span><div class="btn-row" style="margin-top:6px">${exclude}</div></td></tr>`;
  if (m) {
    return `<tr>${head}<td>
      <div>${statusPill('ok', 'Match found')} <span class="small">${esc(m.description || catName(m.categoryId))} · ${prettyDate(m.date)}</span></div>
      <div class="btn-row" style="margin-top:6px"><button class="btn small primary" data-feed="match" data-id="${item.id}">Match</button><button class="btn small" data-feed="add-mode" data-id="${item.id}">Add as new instead</button>${exclude}</div>
    </td></tr>`;
  }
  const types = item.amount > 0 ? [['income', 'Income'], ['transfer', 'Transfer in']] : [['expense', 'Expense'], ['transfer', 'Transfer out']];
  const sel = (field, opts, label) => `<select data-feed-field="${field}" data-id="${item.id}" aria-label="${label}">${opts}</select>`;
  const typeSel = sel('type', types.map(([v, l]) => `<option value="${v}"${e.type === v ? ' selected' : ''}>${l}</option>`).join(''), 'Type');
  const detail = e.type === 'transfer'
    ? sel('otherAccountId', sortByCode(state.accounts.filter(a => a.id !== item.accountId)).map(a => `<option value="${a.id}"${a.id === e.otherAccountId ? ' selected' : ''}>${item.amount > 0 ? 'From' : 'To'} ${esc(a.name)}</option>`).join(''), 'Other account')
    : sel('categoryId', `<option value="">Choose category…</option>` + sortByName(state.categories.filter(c => c.kind === e.type)).map(c => `<option value="${c.id}"${c.id === e.categoryId ? ' selected' : ''}>${esc(c.name)}</option>`).join(''), 'Category')
      + sel('fundId', state.funds.map(f => `<option value="${f.id}"${f.id === e.fundId ? ' selected' : ''}>${esc(f.name)}</option>`).join(''), 'Fund');
  return `<tr>${head}<td>
    <div class="feed-controls">${typeSel}${detail}</div>
    ${e.via ? `<div class="small muted" style="margin-top:4px">Suggested from ${esc(e.via)}</div>` : ''}
    <div class="btn-row" style="margin-top:6px"><button class="btn small primary" data-feed="add" data-id="${item.id}">Add</button><button class="btn small" data-feed="rule" data-id="${item.id}">Make a rule</button>${exclude}</div>
  </td></tr>`;
}

function renderStage(st) {
  const acctSel = `<label class="field">Import into<select name="accountId">${options(sortByCode(state.accounts), st.accountId)}</select></label>`;
  let body, count;
  if (st.kind === 'ofx') {
    const dates = st.items.map(i => i.date).sort();
    count = st.items.length;
    body = `<p>${plural(count, 'transaction')} from ${prettyDate(dates[0])} to ${prettyDate(dates[dates.length - 1])}${st.balance ? `. Bank balance ${money(st.balance.amount)} on ${prettyDate(st.balance.asOf)}` : ''}.${st.last4 ? ` Bank account ending ${esc(st.last4)}.` : ''}</p>
      <div class="filters">${acctSel}</div>`;
  } else {
    const { items, skipped } = csvItems(st);
    count = items.length;
    const colSel = (name, label) => `<label class="field">${label}<select name="${name}"><option value="-1">—</option>${st.header.map((h, i) => `<option value="${i}"${st.map[name] === i ? ' selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('')}</select></label>`;
    body = `
      <p class="small muted" style="margin-top:0">Check that each column is matched correctly. The preview below updates as you change them.</p>
      <div class="filters">
        ${acctSel}
        ${colSel('date', 'Date column')}
        ${colSel('desc', 'Description column')}
        <label class="field">Amounts are in<select name="mode"><option value="single"${st.mode === 'single' ? ' selected' : ''}>One column</option><option value="split"${st.mode === 'split' ? ' selected' : ''}>Separate in/out columns</option></select></label>
        ${st.mode === 'single' ? colSel('amount', 'Amount column') : colSel('debit', 'Money out column') + colSel('credit', 'Money in column')}
        ${colSel('check', 'Check # column')}
        <label class="field">Date format<select name="dateFmt"><option value="mdy"${st.dateFmt === 'mdy' ? ' selected' : ''}>MM/DD/YYYY</option><option value="dmy"${st.dateFmt === 'dmy' ? ' selected' : ''}>DD/MM/YYYY</option></select></label>
        ${st.mode === 'single' ? `<label class="check" style="padding-bottom:8px"><input type="checkbox" name="flip"${st.flip ? ' checked' : ''}> My bank shows spending as positive numbers</label>` : ''}
      </div>
      <h3>Preview</h3>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>
        ${items.slice(0, 6).map(i => `<tr><td>${prettyDate(i.date)}</td><td>${esc(i.description)}</td><td class="num ${i.amount > 0 ? 'pos' : ''}">${money(i.amount)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No rows could be read with these settings.</td></tr>'}
      </tbody></table></div>
      <p class="small muted">${plural(count, 'transaction')} ready${skipped ? `, ${skipped} row${skipped === 1 ? '' : 's'} skipped (blank, zero, or unreadable date or amount)` : ''}. Money coming in should show as positive and spending as negative.</p>`;
  }
  return `<form class="card" id="stageForm" onsubmit="return false">
    <h2>Import ${esc(st.fileName)}</h2>
    ${body}
    <div class="btn-row"><button type="button" class="btn primary" data-feed="commit"${count ? '' : ' disabled'}>Import ${plural(count, 'transaction')}</button><button type="button" class="btn" data-feed="cancel-stage">Cancel</button></div>
  </form>`;
}

/* ---------------- Sample data ---------------- */
/* A bank download in the style many US banks use, built from the sample books
 * so that some lines match entries already recorded and some are new. */
function sampleBankCSV() {
  const checking = sortByCode(state.accounts)[0];
  const today = new Date();
  const floor = state.org.lockDate ? isoDate(new Date(Date.parse(state.org.lockDate + 'T00:00:00') + 864e5)) : '';
  const day = k => { const d = isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - k)); return d < floor ? floor : d; };
  const us = iso => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; };
  const recorded = state.transactions.filter(t => touches(t, checking.id) && t.type !== 'transfer').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const lines = [
    ...recorded.map(t => [t.date, (t.payee || t.description).toUpperCase(), signedFor(t, checking.id) / 100, /^\d+$/.test(t.reference) ? t.reference : '']),
    [day(1), 'AMAZON MKTPL*2K4L19 AMZN.COM/BILL WA', -64.18, ''],
    [day(2), 'STRIPE TRANSFER ST-R8K2Q RIVERSIDE COMM', 482.5, ''],
    [day(3), 'MONTHLY SERVICE FEE', -12, ''],
    [day(4), 'MOBILE DEPOSIT REF 4471', 250, ''],
    [day(5), 'THE HOME DEPOT #0478 SPRINGFIELD', -137.42, ''],
    [day(6), 'ONLINE TRANSFER TO SAVINGS XXXX4471', -500, ''],
    [day(7), 'SAAS CO SUBSCRIPTION', -49, ''],
  ];
  return ['Posting Date,Description,Amount,Type,Check or Slip #',
    ...lines.map(([d, desc, amt, chk]) => `${us(d)},"${desc}",${amt.toFixed(2)},${amt < 0 ? 'DEBIT' : 'CREDIT'},${chk}`)].join('\n');
}
/* Called by loadSample() in app.js after the sample books exist. */
function loadSampleBankFeed() {
  const [checking, savings] = sortByCode(state.accounts);
  const cat = n => state.categories.find(c => c.name === n)?.id;
  state.bankRules = [
    { id: uid(), contains: 'AMAZON', target: cat('Office Supplies'), fundId: defaultFund() },
    { id: uid(), contains: 'SERVICE FEE', target: cat('Bank & Payment Fees'), fundId: defaultFund() },
    { id: uid(), contains: 'TRANSFER TO SAVINGS', target: `transfer:${savings.id}`, fundId: '' },
  ];
  const st = csvStage(sampleBankCSV(), 'sample-bank-activity.csv', checking.id);
  stageItems(checking.id, csvItems(st).items, st.fileName);
  feedUI.stage = null;
  feedUI.edits = {};
}

/* ---------------- Clicks ---------------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-feed]');
  if (!el) return;
  const item = el.dataset.id ? byId(state.bankFeed, el.dataset.id) : null;
  switch (el.dataset.feed) {
    case 'sample-file': {
      feedUI.stage = csvStage(sampleBankCSV(), 'sample-bank-activity.csv', $('#feedAccount')?.value || sortByCode(state.accounts)[0].id);
      return render();
    }
    case 'commit': return commitStage();
    case 'cancel-stage': feedUI.stage = null; return render();
    case 'match': {
      const m = feedMatch(item);
      if (m) { feedAcceptMatch(item, m); save(); render(); toast('Matched'); }
      return;
    }
    case 'add-mode': feedEdit(item).mode = 'add'; return render();
    case 'add': if (feedAdd(item)) { save(); render(); toast('Added to your books'); } return;
    case 'exclude':
      item.status = 'excluded';
      logChange('Excluded bank transaction', `${cleanDesc(item.description)} (${prettyDate(item.date)}, ${money(item.amount)})`);
      save(); render(); return toast('Excluded');
    case 'undo': return feedUndo(item);
    case 'accept-all': {
      const n = feedAutoPlan().length;
      if (n && confirm(`Record ${plural(n, 'suggested bank transaction')}?`)) feedAcceptAll();
      return;
    }
    case 'rule': return openRuleForm(item);
    case 'new-rule': return openRuleForm(null);
    case 'delete-rule':
      state.bankRules = state.bankRules.filter(r => r.id !== el.dataset.id);
      save(); render(); return toast('Rule deleted');
  }
});
