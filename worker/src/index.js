/*
 * Nonprofit Books — Claude assistant server (a Cloudflare Worker).
 *
 * The bookkeeping app runs in the browser, where a secret API key can't be
 * kept safe. This small server holds the Anthropic API key and does exactly
 * four jobs for the app — nothing else — so the key can't be reused for
 * anything else:
 *
 *   POST /api/ask         answer a question about the books
 *   POST /api/categorize  suggest how to record bank transactions
 *   POST /api/report      draft the narrative summary for a board packet
 *   POST /api/receipt     read a receipt (photo or PDF) into an expense
 *   GET  /api/health      check that the app can reach this server
 *
 * Every request must come from a website listed in ALLOWED_ORIGINS and carry
 * the access code (APP_ACCESS_CODE) that the treasurer enters in the app's
 * Settings. Secrets are set with `npx wrangler secret put ...`.
 */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';
// If Claude's safety checks decline a request, the API retries it on another model automatically.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const LIMITS = {
  body: 12 * 1024 * 1024,      // whole request, bytes
  books: 1_500_000,            // characters of bookkeeping data
  question: 8_000,             // characters per chat message
  turns: 40,                   // chat messages per conversation
  bankItems: 100,              // bank transactions per categorize request
  receipt: 10 * 1024 * 1024,   // base64 characters of one receipt file
};
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

/* ---------------- Plumbing ---------------- */
class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return {}; // not a browser request; the access code still applies
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes('*') && !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
/* Compare without leaking how many characters matched. */
function sameSecret(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const str = (v, max, name) => {
  if (typeof v !== 'string') throw new UserError(`Missing ${name}.`);
  if (v.length > max) throw new UserError(`The ${name} is too long.`, 413);
  return v;
};
const list = (v, max, name) => {
  if (!Array.isArray(v)) throw new UserError(`Missing ${name}.`);
  if (v.length > max) throw new UserError(`Too many ${name} in one request (limit ${max}).`, 413);
  return v;
};

/* One call to Claude. Returns the text of the reply. */
async function callClaude(client, { system, messages, effort, schema, maxTokens = 16000 }) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
    system,
    messages,
  });
  if (response.stop_reason === 'refusal') {
    throw new UserError('Claude declined this request. Try rewording it.', 422);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new UserError('The answer was too long and got cut off. Try a narrower question or a shorter period.', 422);
  }
  return response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}
function parseJSON(text) {
  try { return JSON.parse(text); }
  catch { throw new UserError('Claude returned an unreadable answer. Please try again.', 502); }
}

/* The books go in the system prompt, marked for caching, so follow-up questions are cheaper. */
const booksSystem = (instructions, books) => [
  { type: 'text', text: instructions },
  { type: 'text', text: `<books>\n${books}\n</books>`, cache_control: { type: 'ephemeral' } },
];

/* ---------------- Prompts ---------------- */
const ASK_PROMPT = `You are the assistant built into Nonprofit Books, a bookkeeping app for a small US nonprofit. The person asking is usually a volunteer treasurer or executive director without accounting training.

Answer questions about the organization's finances using the books provided below. Prefer the precomputed totals; when you add up individual transactions yourself, say which ones you used. If the books don't contain what's needed to answer, say so plainly rather than estimating.

Write short, plain-English answers. Explain any accounting term you use. Show money with a dollar sign and two decimals. Use short paragraphs, bullet lists, or a small table when it helps.

You can read the books but not change them. If asked to record, edit, or delete something, explain where in the app to do it (Transactions, Bank Feed, Reconcile, Budget, Reports, or Settings). For tax or legal questions, give general information and suggest confirming with their accountant.`;

const REPORT_PROMPT = `You are drafting the narrative summary that goes in a nonprofit board packet alongside the financial statements. The books are below; the user message names the period.

Write for board members who are not accountants. Cover, using these Markdown headings in this order:
## Highlights (3 to 5 bullets)
## Revenue
## Expenses
## Budget vs. actual
## Cash and restricted funds
## Items for the board's attention

Use the figures from the books exactly, compare with the prior year where the data allows, and explain the main reasons behind changes when the transactions show them. Note any bookkeeping gaps the data reveals (unreconciled accounts, expenses without receipts, overspent restricted funds) under the last heading. Keep it under 600 words. Use only ## headings, short paragraphs, and "- " bullets. These are cash-basis, unaudited books; don't present the summary as audited.`;

const CATEGORIZE_PROMPT = `You help a small US nonprofit record bank transactions in its books. For each bank line, decide:
- type: "income" for money coming in, "expense" for money going out, or "transfer" when money moves between the organization's own bank accounts. Money in can only be income or transfer; money out can only be expense or transfer.
- categoryId: the best category of that type from the chart of accounts (empty for transfers).
- fundId: the general unrestricted fund unless the description clearly ties the money to a restricted purpose.
- func: for expenses, "program", "management", or "fundraising"; empty otherwise. Use the category's usual function unless the description suggests otherwise.
- otherAccountId: for transfers, the organization's other account involved; empty otherwise.
- confidence: "high", "medium", or "low".
- reason: a few words a treasurer would understand, e.g. "Office supplies retailer".

Follow how similar entries were recorded in the examples. Bank descriptions are often cryptic; use common knowledge of merchants and payment processors (e.g. Stripe or PayPal deposits at a nonprofit are usually donations). When you can't tell, give your best guess with low confidence.`;

const RECEIPT_PROMPT = `Read this receipt or invoice for a small US nonprofit and extract what's needed to record it as an expense.
- found_receipt: false if the file isn't a receipt or invoice or can't be read; then leave the other fields empty.
- date: the purchase or invoice date as YYYY-MM-DD, or empty if not shown.
- vendor: the business name as a person would write it (e.g. "Home Depot", not "THE HOME DEPOT #0478").
- total: the total actually paid, including tax and tip, as digits with two decimals (e.g. "137.42").
- description: a short description of what was bought.
- reference: the invoice, receipt, or check number, or empty.
- categoryId: the best expense category from the list, or empty if none fits.
- func: "program", "management", or "fundraising" for what the purchase most likely supported.
- confidence: "high", "medium", or "low", and notes: anything the treasurer should double-check (e.g. "Total is handwritten", "Includes a personal item").`;

/* ---------------- Jobs ---------------- */
async function ask(client, body) {
  const books = str(body.books, LIMITS.books, 'books data');
  const turns = list(body.messages, LIMITS.turns, 'messages').map((m, i) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) throw new UserError(`Message ${i + 1} has an unknown role.`);
    return { role: m.role, content: str(m.content, LIMITS.question, 'message') };
  });
  if (!turns.length || turns[0].role !== 'user' || turns[turns.length - 1].role !== 'user') throw new UserError('The conversation must start and end with a question.');
  const answer = await callClaude(client, { system: booksSystem(ASK_PROMPT, books), messages: turns, effort: 'medium' });
  return { answer };
}

async function report(client, body) {
  const books = str(body.books, LIMITS.books, 'books data');
  const period = str(body.period, 200, 'period');
  const focus = body.focus ? str(body.focus, 1000, 'focus note') : '';
  const text = `Write the board summary for ${period}.${focus ? `\nThe treasurer also asked you to address: ${focus}` : ''}`;
  const summary = await callClaude(client, { system: booksSystem(REPORT_PROMPT, books), messages: [{ role: 'user', content: text }], effort: 'high' });
  return { summary };
}

async function categorize(client, body) {
  const items = list(body.items, LIMITS.bankItems, 'bank transactions');
  const categories = list(body.categories, 500, 'categories');
  const funds = list(body.funds, 100, 'funds');
  const accounts = list(body.accounts, 100, 'accounts');
  const examples = list(body.examples || [], 200, 'examples');
  if (!items.length) return { suggestions: [] };
  const ids = arr => arr.map(x => String(x.id));
  const schema = {
    type: 'object', additionalProperties: false, required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['id', 'type', 'categoryId', 'fundId', 'func', 'otherAccountId', 'confidence', 'reason'],
          properties: {
            id: { type: 'string', enum: ids(items) },
            type: { type: 'string', enum: ['income', 'expense', 'transfer'] },
            categoryId: { type: 'string', enum: [...ids(categories), ''] },
            fundId: { type: 'string', enum: ids(funds) },
            func: { type: 'string', enum: ['program', 'management', 'fundraising', ''] },
            otherAccountId: { type: 'string', enum: [...ids(accounts), ''] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            reason: { type: 'string' },
          },
        },
      },
    },
  };
  const line = o => JSON.stringify(o);
  const content = [
    'Chart of accounts (categories):', ...categories.map(line),
    '', 'Funds:', ...funds.map(line),
    '', 'Bank accounts:', ...accounts.map(line),
    '', 'How similar entries were recorded before:', ...(examples.length ? examples.map(line) : ['(none yet)']),
    '', 'Bank transactions to categorize (amount is positive for money in, negative for money out; account is the bank account it appeared in):',
    ...items.map(line),
  ].join('\n');
  if (content.length > LIMITS.books) throw new UserError('Too much data in one request.', 413);
  const result = parseJSON(await callClaude(client, { system: CATEGORIZE_PROMPT, messages: [{ role: 'user', content }], effort: 'low', schema }));
  // Keep only suggestions that fit the money direction and refer to real things.
  const byId = Object.fromEntries(items.map(i => [String(i.id), i]));
  const kinds = Object.fromEntries(categories.map(c => [String(c.id), c.kind]));
  const suggestions = (result.suggestions || []).filter(s => {
    const item = byId[s.id];
    if (!item) return false;
    const moneyIn = Number(item.amount) > 0;
    if (s.type === 'transfer') return !!s.otherAccountId && s.otherAccountId !== String(item.accountId);
    return (s.type === 'income') === moneyIn && kinds[s.categoryId] === s.type;
  });
  return { suggestions };
}

async function receipt(client, body) {
  const data = str(body.data, LIMITS.receipt, 'receipt file');
  const mediaType = String(body.mediaType || '');
  if (!RECEIPT_TYPES.includes(mediaType)) throw new UserError('Use a JPEG, PNG, WebP, or GIF photo, or a PDF.');
  const categories = list(body.categories, 500, 'categories').filter(c => c.kind === 'expense');
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['found_receipt', 'date', 'vendor', 'total', 'description', 'reference', 'categoryId', 'func', 'confidence', 'notes'],
    properties: {
      found_receipt: { type: 'boolean' },
      date: { type: 'string' },
      vendor: { type: 'string' },
      total: { type: 'string' },
      description: { type: 'string' },
      reference: { type: 'string' },
      categoryId: { type: 'string', enum: [...categories.map(c => String(c.id)), ''] },
      func: { type: 'string', enum: ['program', 'management', 'fundraising'] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      notes: { type: 'string' },
    },
  };
  const file = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  const text = `Expense categories:\n${categories.map(c => JSON.stringify({ id: c.id, name: c.name, func: c.func })).join('\n')}`;
  const result = parseJSON(await callClaude(client, {
    system: RECEIPT_PROMPT, messages: [{ role: 'user', content: [file, { type: 'text', text }] }], effort: 'medium', schema,
  }));
  return { receipt: result };
}

const ROUTES = { '/api/ask': ask, '/api/report': report, '/api/categorize': categorize, '/api/receipt': receipt };

/* ---------------- Entry point ---------------- */
export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (!cors) return json({ error: 'This website is not allowed to use this assistant. Add its address to ALLOWED_ORIGINS in wrangler.toml.' }, 403, {});
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!env.ANTHROPIC_API_KEY || !env.APP_ACCESS_CODE) {
      return json({ error: 'The assistant server is not set up yet: the ANTHROPIC_API_KEY and APP_ACCESS_CODE secrets are missing.' }, 500, cors);
    }
    if (!sameSecret(request.headers.get('X-Access-Code') || '', env.APP_ACCESS_CODE)) {
      return json({ error: 'Wrong access code. Check it in Settings → Claude AI assistant.' }, 401, cors);
    }
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && pathname === '/api/health') return json({ ok: true, model: MODEL }, 200, cors);
    const job = ROUTES[pathname];
    if (!job) return json({ error: 'Not found.' }, 404, cors);
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, cors);
    if (Number(request.headers.get('Content-Length') || 0) > LIMITS.body) return json({ error: 'That request is too large.' }, 413, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'The request was not valid JSON.' }, 400, cors); }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      return json(await job(client, body || {}), 200, cors);
    } catch (e) {
      if (e instanceof UserError) return json({ error: e.message }, e.status, cors);
      if (e instanceof Anthropic.AuthenticationError) return json({ error: 'The Anthropic API key on the server is invalid. Set it again with `npx wrangler secret put ANTHROPIC_API_KEY`.' }, 502, cors);
      if (e instanceof Anthropic.PermissionDeniedError) return json({ error: 'The Anthropic account does not have access to this model. Check the account at console.anthropic.com.' }, 502, cors);
      if (e instanceof Anthropic.RateLimitError) return json({ error: 'Claude is busy or the account hit its usage limit. Wait a minute and try again.' }, 429, cors);
      if (e instanceof Anthropic.BadRequestError) {
        console.error('Bad request to Claude:', e.message);
        return json({ error: 'Claude could not process that request. If this keeps happening, check that the Anthropic account has credit at console.anthropic.com.' }, 502, cors);
      }
      if (e instanceof Anthropic.APIConnectionError) return json({ error: 'Could not reach Claude. Try again in a moment.' }, 503, cors);
      if (e instanceof Anthropic.APIError) {
        console.error('Claude API error:', e.status, e.message);
        return json({ error: 'Claude had a problem answering. Try again in a moment.' }, 502, cors);
      }
      console.error(e);
      return json({ error: 'Something went wrong on the assistant server.' }, 500, cors);
    }
  },
};
