/*
 * Claude AI assistant — four features that use Claude:
 *   - Ask Claude: plain-English questions about the books (its own page)
 *   - Board summary: a narrative write-up for the period on the Reports page
 *   - Smart categorizing: category suggestions for bank transactions (Bank Feed)
 *   - Scan a receipt: fill in an expense from a photo or PDF (Transactions)
 *
 * The app never holds the Anthropic API key. It talks to the organization's
 * own small assistant server (the Cloudflare Worker in /worker), which holds
 * the key. The server address and access code are saved in this browser only
 * and are left out of backups.
 *
 * Loaded before app.js. It uses app.js helpers only inside functions.
 */
'use strict';

const AI_STORAGE_KEY = 'nonprofit-books-ai';
const aiUI = {
  chat: [],           // [{role, content}] for the Ask page
  busy: '',           // which feature is waiting on Claude: 'ask' | 'report' | 'categorize' | 'receipt'
  controller: null,   // lets the person stop a long request
  error: '',
  reportError: '',
};

/* ---------------- Connection ---------------- */
function aiConfig() {
  try { return JSON.parse(localStorage.getItem(AI_STORAGE_KEY)) || {}; } catch (e) { return {}; }
}
function aiSaveConfig(cfg) {
  try { localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(cfg)); return true; } catch (e) { return false; }
}
const aiReady = () => { const c = aiConfig(); return !!(c.url && c.code); };

/* Sends one request to the assistant server. Replaced on the test page, which
 * reaches Claude another way. Resolves with the server's JSON reply. */
let aiTransport = async (path, body, signal) => {
  const cfg = aiConfig();
  if (!cfg.url || !cfg.code) throw new Error('setup');
  let res;
  try {
    res = await fetch(cfg.url.replace(/\/+$/, '') + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Access-Code': cfg.code },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Could not reach the assistant server. Check the address in Settings → Claude AI assistant, and your internet connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The assistant server answered with an error (${res.status}).`);
  return data;
};
let aiAvailable = aiReady;

async function aiCall(path, body, feature) {
  if (!aiAvailable()) { aiNeedsSetup(); throw new Error('setup'); }
  aiUI.busy = feature;
  aiUI.error = '';
  aiUI.controller = new AbortController();
  try {
    return await aiTransport(path, body, aiUI.controller.signal);
  } finally {
    aiUI.busy = '';
    aiUI.controller = null;
  }
}
function aiNeedsSetup() {
  toast('Set up the Claude assistant first, in Settings.');
  if (location.hash !== '#settings') location.hash = '#settings';
  setTimeout(() => $('#aiForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}
const aiStopped = e => e && (e.name === 'AbortError' || e.message === 'setup' || e.code === 'cancelled');

/* ---------------- What Claude reads about the books ---------------- */
/* A plain-text snapshot of the books: summaries first, then transactions.
 * Ordered the same way every time so the server can reuse it between questions. */
function aiBooksContext({ maxTransactions = 3000 } = {}) {
  const o = state.org;
  const today = todayISO();
  const cy = fyStartYearFor(today);
  const thisFY = fyRange(cy), lastFY = fyRange(cy - 1);
  const n = c => (c / 100).toFixed(2);
  const out = [];
  const section = title => out.push('', `## ${title}`);

  out.push(`Organization: ${o.name}${o.ein ? ` (EIN ${o.ein})` : ''}`);
  if (o.mission) out.push(`Mission: ${o.mission}`);
  out.push(`Today: ${today}. Fiscal year starts in ${MONTHS_LONG[o.fyStartMonth - 1]}. Current fiscal year ${fyLabel(cy)} runs ${thisFY.from} to ${thisFY.to}; prior year ${fyLabel(cy - 1)} ran ${lastFY.from} to ${lastFY.to}.`);
  out.push('Books are kept on the cash basis (income when received, expenses when paid). Amounts are US dollars.');
  out.push(`Books closed through: ${o.lockDate || 'not set'}.`);

  section('Bank and cash accounts (balance today; last bank reconciliation)');
  sortByCode(state.accounts).forEach(a => {
    const r = lastRecon(a.id);
    out.push(`${a.code} ${a.name}: ${n(accountBalance(a.id))}; reconciled through ${r ? r.statementDate : 'never'}`);
  });
  out.push(`Total cash: ${n(totalCash())}`);

  section('Funds (balance today)');
  sortByCode(state.funds).forEach(f => out.push(`${f.code} ${f.name} (${f.restricted ? 'with donor restrictions' : 'without donor restrictions'}): ${n(fundBalance(f.id))}`));

  section('Chart of accounts: categories');
  sortByCode(state.categories).forEach(c => out.push(`${c.code} ${c.name} | ${c.kind}${c.func ? ` | usual function ${c.func}` : ''} | Form 990 ${F990[c.line990] ? `Part ${c.line990.startsWith('VIII') ? 'VIII' : 'IX'} line ${F990[c.line990].line}` : '—'}`));

  const yearBlock = (r, label) => {
    const a = activityData(r), f = functionalData(r);
    section(`Statement of activities, ${label} (${r.from} to ${r.to}${r.to > today ? ', year to date' : ''})`);
    out.push('Revenue by category (without donor restrictions / with donor restrictions):');
    sortByCode(state.categories.filter(c => c.kind === 'income' && a.inc[c.id])).forEach(c => out.push(`- ${c.name}: ${n(a.inc[c.id].u)} / ${n(a.inc[c.id].r)}`));
    out.push(`Total revenue: ${n(a.incU + a.incR)}. Net assets released from restrictions: ${n(a.released)}.`);
    out.push('Expenses by category (program / management & general / fundraising):');
    sortByCode(state.categories.filter(c => c.kind === 'expense' && f.rows[c.id])).forEach(c => {
      const x = f.rows[c.id];
      out.push(`- ${c.name}: ${n(x.program + x.management + x.fundraising)} (${n(x.program)} / ${n(x.management)} / ${n(x.fundraising)})`);
    });
    out.push(`Total expenses: ${n(a.expT)} (program ${n(f.tot.program)}, management & general ${n(f.tot.management)}, fundraising ${n(f.tot.fundraising)}).`);
    out.push(`Change in net assets: ${n(a.incU + a.incR - a.expT)}. Net assets at start: ${n(a.startU + a.startR)}; at end: ${n(a.startU + a.startR + a.incU + a.incR - a.expT)}.`);
  };
  yearBlock(thisFY, fyLabel(cy));
  yearBlock(lastFY, fyLabel(cy - 1));

  const budget = state.budgets[cy];
  if (budget && Object.keys(budget).length) {
    section(`Budget vs. actual, ${fyLabel(cy)} (annual budget / actual to date)`);
    const actual = {};
    state.transactions.forEach(t => { if (t.categoryId && inRange(t, thisFY)) actual[t.categoryId] = (actual[t.categoryId] || 0) + t.amount; });
    sortByCode(state.categories.filter(c => budget[c.id] || actual[c.id])).forEach(c => out.push(`- ${c.name} (${c.kind}): ${n(budget[c.id] || 0)} / ${n(actual[c.id] || 0)}`));
  }

  section('Revenue and expenses by month (last 24 months)');
  const months = {};
  state.transactions.forEach(t => {
    if (t.type === 'transfer') return;
    const m = months[t.date.slice(0, 7)] ||= { inc: 0, exp: 0 };
    m[t.type === 'income' ? 'inc' : 'exp'] += t.amount;
  });
  Object.keys(months).sort().slice(-24).forEach(k => out.push(`${k}: revenue ${n(months[k].inc)}, expenses ${n(months[k].exp)}`));

  section(`Donors (gifts in ${fyLabel(cy)} / ${fyLabel(cy - 1)} / lifetime)`);
  const giving = {};
  state.transactions.forEach(t => {
    if (t.type !== 'income' || !t.donorId) return;
    const g = giving[t.donorId] ||= { cur: 0, prior: 0, all: 0 };
    g.all += t.amount;
    if (inRange(t, thisFY)) g.cur += t.amount;
    if (inRange(t, lastFY)) g.prior += t.amount;
  });
  Object.entries(giving).sort((a, b) => b[1].all - a[1].all).slice(0, 200)
    .forEach(([id, g]) => out.push(`${donorName(id)}: ${n(g.cur)} / ${n(g.prior)} / ${n(g.all)}`));

  section('Bookkeeping status');
  out.push(`Bank transactions waiting for review: ${state.bankFeed.filter(f => f.status === 'pending').length}`);
  out.push(`Expenses this fiscal year without a receipt on file: ${state.transactions.filter(t => t.type === 'expense' && !t.docOnFile && inRange(t, thisFY)).length}`);

  const txs = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
  section(`Transactions (newest first${txs.length > maxTransactions ? `; the ${maxTransactions} most recent of ${txs.length}` : ''})`);
  out.push('date | type | amount | category | fund | function | bank account | donor or payee | description | reference | receipt on file');
  txs.slice(0, maxTransactions).forEach(t => out.push([
    t.date, t.type, n(t.amount),
    t.type === 'transfer' ? `transfer to ${acctName(t.toAccountId)}` : catName(t.categoryId),
    t.fundId ? fundName(t.fundId) : '', t.func || '', acctName(t.accountId),
    donorName(t.donorId) || t.payee || '', (t.description || '').replace(/\s+/g, ' '), t.reference || '',
    t.type === 'transfer' ? '' : t.docOnFile ? 'yes' : 'no',
  ].join(' | ')));
  return out.join('\n');
}

/* ---------------- Showing Claude's writing ---------------- */
/* A small, safe Markdown renderer: headings, bold, inline code, lists, tables, paragraphs. */
function mdToHtml(md) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  let html = '', para = [], list = null, table = [];
  const flushPara = () => { if (para.length) html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; };
  const flushList = () => { if (list) html += `</${list}>`; list = null; };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter(r => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r)).map(r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
    const isNum = c => /^[-+(]?\$?[\d,]+(\.\d+)?%?\)?$/.test(c);
    html += `<div class="table-wrap"><table><thead><tr>${rows[0].map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(r => `<tr>${r.map(c => `<td class="${isNum(c) ? 'num' : ''}">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    table = [];
  };
  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); flushList(); table.push(line); continue; }
    flushTable();
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flushPara(); flushList(); html += m[1].length <= 2 ? `<h3>${inline(m[2])}</h3>` : `<h4>${inline(m[2])}</h4>`; }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flushPara(); if (list !== 'ul') { flushList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (list !== 'ol') { flushList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushTable(); flushPara(); flushList();
  return html;
}

/* ---------------- Ask Claude page ---------------- */
const ASK_STARTERS = [
  'How are we doing against the budget this year?',
  'What were our biggest expenses this year, and how do they compare with last year?',
  'How many months of expenses could we cover with unrestricted cash?',
  'Which donors gave more this year than last year?',
  'Is there anything in the books our accountant is likely to question?',
];
function renderAsk(root) {
  const ready = aiAvailable();
  const busy = aiUI.busy === 'ask';
  root.innerHTML = `
    <div class="page-head">
      <div><h1>Ask Claude</h1><div class="muted">Ask questions about your books in plain English.</div></div>
      ${aiUI.chat.length ? '<button class="btn" data-ai="new-chat">New conversation</button>' : ''}
    </div>
    ${ready ? '' : `<div class="card callout" style="margin-bottom:16px"><h3>Connect Claude first</h3><p class="small" style="margin:6px 0 10px">Claude features need your organization's assistant server. The setup steps are in the README; then enter the server address and access code in Settings.</p><a class="btn" href="#settings">Open Settings</a></div>`}
    <div class="card chat">
      <div class="chat-log" id="chatLog" aria-live="polite">
        ${aiUI.chat.length ? aiUI.chat.map(m => m.role === 'user'
          ? `<div class="msg user"><div class="bubble">${esc(m.content)}</div></div>`
          : `<div class="msg claude"><div class="who">Claude</div><div class="bubble md">${mdToHtml(m.content)}</div></div>`).join('')
          : `<div class="chat-empty"><p class="muted">Try one of these, or ask your own question:</p><div class="chips">${ASK_STARTERS.map(q => `<button class="chip" data-ai="starter" data-q="${esc(q)}"${ready ? '' : ' disabled'}>${esc(q)}</button>`).join('')}</div></div>`}
        ${busy ? '<div class="msg claude"><div class="who">Claude</div><div class="bubble thinking">Reading your books and thinking… this can take up to a minute. <button class="linkbtn" data-ai="stop">Stop</button></div></div>' : ''}
        ${aiUI.error ? `<p class="error-msg">${esc(aiUI.error)}</p>` : ''}
      </div>
      <form class="chat-form" id="chatForm">
        <label class="sr-only" for="chatInput">Your question</label>
        <textarea id="chatInput" rows="2" placeholder="e.g. Why were expenses higher in July?"${ready && !busy ? '' : ' disabled'}></textarea>
        <button class="btn primary" type="submit"${ready && !busy ? '' : ' disabled'}>Ask</button>
      </form>
      <p class="small muted" style="margin:8px 0 0">Claude reads a copy of your books each time you ask. It can make mistakes, so check important figures against Reports before relying on them.</p>
    </div>`;
  const log = $('#chatLog');
  log.scrollTop = log.scrollHeight;
  const input = $('#chatInput');
  $('#chatForm').addEventListener('submit', e => { e.preventDefault(); aiAsk(input.value); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiAsk(input.value); } });
  if (ready && !busy) input.focus();
}
async function aiAsk(question) {
  question = String(question || '').trim();
  if (!question || aiUI.busy) return;
  aiUI.chat.push({ role: 'user', content: question });
  const turns = aiUI.chat.slice(-20);
  if (turns[0].role !== 'user') turns.shift();
  const pending = aiCall('/api/ask', { books: aiBooksContext(), messages: turns }, 'ask');
  render();
  try {
    const { answer } = await pending;
    aiUI.chat.push({ role: 'assistant', content: answer });
  } catch (e) {
    aiUI.chat.pop();
    if (!aiStopped(e)) aiUI.error = e.message;
  }
  if (currentView() === 'ask') render();
}

/* ---------------- Board summary (Reports page) ---------------- */
function aiSummaryKey(r) { return `${r.from}|${r.to}`; }
function aiSummaryCard(r) {
  const saved = state.aiSummaries?.[aiSummaryKey(r)];
  const busy = aiUI.busy === 'report';
  if (!saved && !busy && !aiUI.reportError) return '';
  return `<div class="card" id="aiSummary" style="margin-top:16px">
    <div class="feed-head"><h2>Board summary <span class="pill">Draft by Claude</span></h2>
      ${saved && !busy ? `<div class="btn-row no-print"><button class="btn small" data-ai="copy-summary">Copy text</button><button class="btn small" data-ai="report">Write again</button><button class="btn small danger" data-ai="delete-summary">Remove</button></div>` : ''}
    </div>
    ${busy ? '<p class="muted">Claude is reading the books and writing the summary. This usually takes one to two minutes. <button class="linkbtn" data-ai="stop">Stop</button></p>' : ''}
    ${aiUI.reportError ? `<p class="error-msg">${esc(aiUI.reportError)}</p>` : ''}
    ${saved && !busy ? `<div class="md summary">${mdToHtml(saved.text)}</div><p class="small muted">Written ${new Date(saved.at).toLocaleString()} for ${esc(saved.period)}. Check the figures against the statements above before sending it to the board.</p>` : ''}
  </div>`;
}
async function aiWriteSummary() {
  if (aiUI.busy) return;
  const r = reportRange();
  const period = r.from === ALL_TIME_FROM ? 'all recorded activity' : `${periodLabel(r)} (${r.from} to ${endDate(r)})`;
  aiUI.reportError = '';
  const pending = aiCall('/api/report', { books: aiBooksContext(), period }, 'report');
  render();
  try {
    const { summary } = await pending;
    state.aiSummaries ||= {};
    state.aiSummaries[aiSummaryKey(r)] = { text: summary, at: new Date().toISOString(), period: periodLabel(r) };
    logChange('Claude wrote board summary', periodLabel(r));
    save();
  } catch (e) {
    if (!aiStopped(e)) aiUI.reportError = e.message;
  }
  if (currentView() === 'reports') render();
}

/* ---------------- Smart categorizing (Bank Feed) ---------------- */
function aiFeedCandidates() {
  return feedPending().filter(f => {
    if (isLocked(f.date)) return false;
    const e = feedEdit(f);
    return e.mode !== 'edited' && !e.via && !e.claude && !(e.mode !== 'add' && feedMatch(f));
  }).slice(0, 100);
}
async function aiCategorize() {
  if (aiUI.busy) return;
  const items = aiFeedCandidates();
  if (!items.length) return toast('Every bank transaction already has a match or a suggestion.');
  const examples = [...state.transactions].filter(t => t.type !== 'transfer' && t.categoryId)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80)
    .map(t => ({ description: t.bankDescription || t.payee || t.description, amount: (t.type === 'expense' ? -t.amount : t.amount) / 100, type: t.type, categoryId: t.categoryId, fundId: t.fundId, func: t.func || '' }));
  const pending = aiCall('/api/categorize', {
    items: items.map(f => ({ id: f.id, date: f.date, amount: f.amount / 100, description: f.description, accountId: f.accountId })),
    categories: state.categories.map(c => ({ id: c.id, code: c.code, name: c.name, kind: c.kind, func: c.func || '' })),
    funds: state.funds.map(f => ({ id: f.id, name: f.name, restricted: !!f.restricted })),
    accounts: state.accounts.map(a => ({ id: a.id, name: a.name })),
    examples,
  }, 'categorize');
  render();
  let count = 0;
  try {
    const { suggestions } = await pending;
    for (const s of suggestions || []) {
      const item = byId(state.bankFeed, s.id);
      if (!item || item.status !== 'pending') continue;
      const moneyIn = item.amount > 0;
      if (s.type === 'transfer' ? !byId(state.accounts, s.otherAccountId) : (s.type === 'income') !== moneyIn || byId(state.categories, s.categoryId)?.kind !== s.type) continue;
      const e = feedEdit(item);
      Object.assign(e, {
        mode: 'auto', type: s.type, categoryId: s.type === 'transfer' ? '' : s.categoryId,
        fundId: byId(state.funds, s.fundId) ? s.fundId : e.fundId, func: s.type === 'expense' ? s.func : '',
        otherAccountId: s.type === 'transfer' ? s.otherAccountId : e.otherAccountId, claude: true,
      });
      // Only confident suggestions are included in "Accept suggested"; low-confidence ones are pre-filled for review.
      if (s.confidence === 'low') { e.via = ''; e.hint = `Claude's guess, low confidence: ${s.reason}`; }
      else { e.via = `Claude: ${s.reason}`; e.hint = ''; }
      count++;
    }
    toast(count ? `Claude suggested how to record ${plural(count, 'transaction')}. Review them before adding.` : 'Claude had no confident suggestions.');
  } catch (e) {
    if (!aiStopped(e)) toast(e.message);
  }
  if (currentView() === 'bankfeed') render();
}

/* ---------------- Scan a receipt (Transactions) ---------------- */
const blobToBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('That file could not be read.'));
  r.readAsDataURL(blob);
});
/* Phone photos are large; shrink them before sending. PDFs go as they are. */
async function aiPrepareReceipt(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 7 * 1024 * 1024) throw new Error('That PDF is over 7 MB. Try a smaller scan or a photo.');
    return { data: await blobToBase64(file), mediaType: 'application/pdf' };
  }
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Use a JPEG or PNG photo, or a PDF. (On an iPhone, a screenshot of the photo works.)');
  let blob = file;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85)) || file;
  } catch (e) { /* send the original if the browser can't resize it */ }
  if (blob.size > 5 * 1024 * 1024) throw new Error('That photo is too large. Try a smaller one.');
  return { data: await blobToBase64(blob), mediaType: blob.type || file.type, blob };
}
async function aiScanReceipt(file) {
  if (!file || aiUI.busy) return;
  if (!aiAvailable()) return aiNeedsSetup();
  let prepared;
  try { prepared = await aiPrepareReceipt(file); } catch (e) { return alert(e.message); }
  openModal({
    title: 'Reading the receipt',
    body: '<p class="thinking">Claude is reading the receipt. This takes a few seconds.</p>',
    foot: '<div></div><div class="btn-row"><button type="button" class="btn" data-ai="stop" data-close>Cancel</button></div>',
  });
  try {
    const { receipt: r } = await aiCall('/api/receipt', {
      data: prepared.data, mediaType: prepared.mediaType, blob: prepared.blob,
      categories: state.categories.map(c => ({ id: c.id, name: c.name, kind: c.kind, func: c.func || '' })),
    }, 'receipt');
    if (!r?.found_receipt) { closeModal(); return alert('Claude could not find a receipt or invoice in that file. Try a clearer photo.'); }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : todayISO();
    const amount = toCents(r.total);
    const cat = byId(state.categories, r.categoryId);
    const draft = {
      date, amount: Number.isNaN(amount) || amount < 0 ? 0 : amount,
      description: r.description || r.vendor || '', payee: r.vendor || '', reference: r.reference || '',
      categoryId: cat?.kind === 'expense' ? cat.id : '', func: ['program', 'management', 'fundraising'].includes(r.func) ? r.func : '',
      docOnFile: true, notes: r.notes ? `Receipt note from Claude: ${r.notes}` : '',
      _aiNote: `Filled in by Claude from ${file.name || 'your receipt'}${r.confidence === 'low' ? ' with low confidence' : ''}. Check every field before saving.${r.date ? '' : ' No date was found, so today is used.'}`,
    };
    openTxForm(null, 'expense', draft);
  } catch (e) {
    closeModal();
    if (!aiStopped(e)) alert(e.message);
  }
}

/* ---------------- Settings card ---------------- */
function aiSettingsCard() {
  const c = aiConfig();
  return `<form class="card" id="aiForm">
    <h2>Claude AI assistant</h2>
    <p class="small muted" style="margin-top:0">Lets you ask questions about your books, draft board summaries, get category suggestions in the bank feed, and fill in expenses from receipts. Claude is reached through your organization's own assistant server, which keeps the Anthropic API key secret. The README explains how to set it up.</p>
    <div class="form-grid">
      <label class="field">Assistant server address<input name="url" type="url" value="${esc(c.url || '')}" placeholder="https://nonprofit-books-claude.your-name.workers.dev" autocomplete="off"></label>
      <label class="field">Access code<input name="code" type="password" value="${esc(c.code || '')}" autocomplete="off"></label>
    </div>
    <div class="btn-row" style="margin-top:12px;align-items:center">
      <button class="btn primary" type="submit">Save</button>
      <button class="btn" type="button" data-ai="test">Test connection</button>
      ${c.url ? '<button class="btn danger" type="button" data-ai="forget">Disconnect</button>' : ''}
      <span id="aiStatus" class="small"></span>
    </div>
    <p class="small muted">When you use a Claude feature, a copy of the books data it needs (or the receipt you choose) goes to Anthropic through your server to produce the answer. Each use is billed to your organization's Anthropic account, usually a few cents. The address and access code are saved only in this browser and are not included in backups.</p>
  </form>`;
}
function aiBindSettings() {
  const form = $('#aiForm');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const url = form.url.value.trim(), code = form.code.value;
    if (url && !/^https:\/\//.test(url)) { $('#aiStatus').textContent = 'The address must start with https://'; return; }
    aiSaveConfig({ url, code });
    toast('Claude settings saved');
    render();
  });
}
async function aiTestConnection() {
  const status = $('#aiStatus');
  const form = $('#aiForm');
  if (form) aiSaveConfig({ url: form.url.value.trim(), code: form.code.value });
  if (!aiReady()) { status.innerHTML = statusPill('warn', 'Enter the address and access code first'); return; }
  status.textContent = 'Checking…';
  try {
    const r = await aiTransport('/api/health', null);
    status.innerHTML = statusPill('ok', `Connected (${esc(r.model || 'Claude')})`);
  } catch (e) {
    status.innerHTML = statusPill('warn', esc(e.message));
  }
}

/* ---------------- Clicks ---------------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-ai]');
  if (!el) return;
  switch (el.dataset.ai) {
    case 'starter': return aiAsk(el.dataset.q);
    case 'new-chat': aiUI.chat = []; aiUI.error = ''; return render();
    case 'stop': return aiUI.controller?.abort();
    case 'report': return aiWriteSummary();
    case 'copy-summary': {
      const saved = state.aiSummaries?.[aiSummaryKey(reportRange())];
      if (!saved) return;
      return navigator.clipboard.writeText(saved.text).then(() => toast('Copied'), () => toast('Copy did not work here. Select the text and copy it instead.'));
    }
    case 'delete-summary':
      delete state.aiSummaries?.[aiSummaryKey(reportRange())];
      save(); return render();
    case 'categorize': return aiCategorize();
    case 'receipt': {
      if (!aiAvailable()) return aiNeedsSetup();
      return $('#receiptFile')?.click();
    }
    case 'test': return aiTestConnection();
    case 'forget':
      aiSaveConfig({});
      return render();
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'receiptFile') { aiScanReceipt(e.target.files[0]); e.target.value = ''; }
});
