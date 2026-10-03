/*
 * Tests for the assistant server, run with `npm test`.
 * Calls to Anthropic are intercepted and answered with canned replies, so
 * these tests cost nothing and need no API key.
 */
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = { ANTHROPIC_API_KEY: 'test-key', APP_ACCESS_CODE: 'open-sesame', ALLOWED_ORIGINS: 'https://books.example.org' };
const ORIGIN = 'https://books.example.org';
let sent = [];
let reply = () => ({ text: 'ok' });

globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  sent.push({ url: String(url), headers: new Headers(init.headers), body });
  const r = reply(body);
  if (r.status) return new Response(JSON.stringify({ type: 'error', error: { type: r.type, message: r.message } }), { status: r.status, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({
    id: 'msg_test', type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'text', text: r.text }], stop_reason: r.stop || 'end_turn', stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const call = (path, { body, method = 'POST', origin = ORIGIN, code = 'open-sesame' } = {}) => worker.fetch(new Request('https://w.example' + path, {
  method,
  headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(code ? { 'X-Access-Code': code } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}), env);

let passed = 0;
async function test(name, fn) {
  sent = []; reply = () => ({ text: 'ok' });
  try { await fn(); passed++; console.log('PASS', name); }
  catch (e) { console.log('FAIL', name, '\n ', e.message); process.exitCode = 1; }
}

await test('rejects other websites', async () => {
  const r = await call('/api/health', { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});
await test('rejects a wrong access code', async () => {
  const r = await call('/api/health', { method: 'GET', code: 'nope' });
  assert.equal(r.status, 401);
});
await test('answers CORS preflight', async () => {
  const r = await call('/api/ask', { method: 'OPTIONS' });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});
await test('health check', async () => {
  const r = await call('/api/health', { method: 'GET' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  assert.equal(sent.length, 0);
});
await test('ask sends the books cached in the system prompt, with fallbacks', async () => {
  reply = () => ({ text: 'Expenses rose because of camp supplies.' });
  const r = await call('/api/ask', { body: { books: 'BOOKS DATA', messages: [{ role: 'user', content: 'Why?' }] } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).answer, 'Expenses rose because of camp supplies.');
  const { url, headers, body } = sent[0];
  assert.match(url, /\/v1\/messages/);
  assert.equal(headers.get('x-api-key'), 'test-key');
  assert.match(headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.output_config.effort, 'medium');
  assert.equal(body.thinking, undefined);
  assert.equal(body.system[1].cache_control.type, 'ephemeral');
  assert.match(body.system[1].text, /BOOKS DATA/);
});
await test('ask rejects a conversation ending with the assistant', async () => {
  const r = await call('/api/ask', { body: { books: 'x', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] } });
  assert.equal(r.status, 400);
  assert.equal(sent.length, 0);
});
await test('refusals become a friendly message', async () => {
  reply = () => ({ text: '', stop: 'refusal' });
  const r = await call('/api/ask', { body: { books: 'x', messages: [{ role: 'user', content: 'a' }] } });
  assert.equal(r.status, 422);
  assert.match((await r.json()).error, /declined/);
});
await test('report uses high effort and names the period', async () => {
  reply = () => ({ text: '## Highlights\n- Good year' });
  const r = await call('/api/report', { body: { books: 'x', period: 'FY 2026' } });
  assert.equal((await r.json()).summary, '## Highlights\n- Good year');
  assert.equal(sent[0].body.output_config.effort, 'high');
  assert.match(sent[0].body.messages[0].content, /FY 2026/);
});
await test('categorize uses a strict schema and drops impossible suggestions', async () => {
  reply = () => ({ text: JSON.stringify({ suggestions: [
    { id: 'b1', type: 'expense', categoryId: 'office', fundId: 'gen', func: 'management', otherAccountId: '', confidence: 'high', reason: 'Office retailer' },
    { id: 'b2', type: 'expense', categoryId: 'office', fundId: 'gen', func: 'management', otherAccountId: '', confidence: 'high', reason: 'wrong direction' },
    { id: 'b3', type: 'transfer', categoryId: '', fundId: 'gen', func: '', otherAccountId: 'sav', confidence: 'high', reason: 'To savings' },
  ] }) });
  const r = await call('/api/categorize', { body: {
    items: [{ id: 'b1', date: '2026-09-30', amount: -64.18, description: 'AMAZON', accountId: 'chk' }, { id: 'b2', date: '2026-09-30', amount: 50, description: 'X', accountId: 'chk' }, { id: 'b3', date: '2026-09-30', amount: -500, description: 'TO SAVINGS', accountId: 'chk' }],
    categories: [{ id: 'office', name: 'Office Supplies', kind: 'expense' }, { id: 'don', name: 'Donations', kind: 'income' }],
    funds: [{ id: 'gen', name: 'General' }], accounts: [{ id: 'chk', name: 'Checking' }, { id: 'sav', name: 'Savings' }],
  } });
  const out = await r.json();
  assert.deepEqual(out.suggestions.map(s => s.id), ['b1', 'b3']);
  const fmt = sent[0].body.output_config.format;
  assert.equal(fmt.type, 'json_schema');
  assert.deepEqual(fmt.schema.properties.suggestions.items.properties.categoryId.enum, ['office', 'don', '']);
  assert.equal(sent[0].body.output_config.effort, 'low');
});
await test('receipt sends a PDF as a document block', async () => {
  reply = () => ({ text: JSON.stringify({ found_receipt: true, date: '2026-09-30', vendor: 'Home Depot', total: '137.42', description: 'Garden hoses', reference: '', categoryId: 'sup', func: 'program', confidence: 'high', notes: '' }) });
  const r = await call('/api/receipt', { body: { data: 'JVBERi0=', mediaType: 'application/pdf', categories: [{ id: 'sup', name: 'Program Supplies', kind: 'expense', func: 'program' }, { id: 'don', name: 'Donations', kind: 'income' }] } });
  const out = await r.json();
  assert.equal(out.receipt.vendor, 'Home Depot');
  const block = sent[0].body.messages[0].content[0];
  assert.equal(block.type, 'document');
  assert.equal(block.source.media_type, 'application/pdf');
  assert.deepEqual(sent[0].body.output_config.format.schema.properties.categoryId.enum, ['sup', '']);
});
await test('receipt rejects other file types', async () => {
  const r = await call('/api/receipt', { body: { data: 'x', mediaType: 'text/html', categories: [] } });
  assert.equal(r.status, 400);
});
await test('a bad API key gives a clear message', async () => {
  reply = () => ({ status: 401, type: 'authentication_error', message: 'invalid x-api-key' });
  const r = await call('/api/ask', { body: { books: 'x', messages: [{ role: 'user', content: 'a' }] } });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /API key/);
});
await test('missing secrets are reported', async () => {
  const r = await worker.fetch(new Request('https://w.example/api/health', { headers: { Origin: ORIGIN } }), { ALLOWED_ORIGINS: ORIGIN });
  assert.equal(r.status, 500);
});
console.log(`${passed} passed`);
