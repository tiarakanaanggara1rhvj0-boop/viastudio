import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const webhookKey = process.env.SAWERIA_STREAMING_KEY || '';
const sociabuzzToken = process.env.SOCIABUZZ_WEBHOOK_TOKEN || '';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const clients = new Set();
const seen = new Set();

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  if (Buffer.isBuffer(body)) return res.end(body);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function broadcast(event) {
  const chunk = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.write(chunk);
}
function safeEqual(a, b) {
  const left = Buffer.from(a, 'hex'), right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
function safeTextEqual(a, b) {
  const normalized = String(a).trim().replace(/^(Bearer|Token)\s+/i, '').trim();
  const left = Buffer.from(normalized);
  const right = Buffer.from(String(b));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
function containsToken(value, secret, depth = 0) {
  if (depth > 6 || value == null) return false;
  if (typeof value === 'string' || typeof value === 'number') return safeTextEqual(secret, value);
  if (Array.isArray(value)) return value.some(item => containsToken(item, secret, depth + 1));
  if (typeof value === 'object') return Object.values(value).some(item => containsToken(item, secret, depth + 1));
  return false;
}
async function readJson(req) {
  let raw = ''; req.setEncoding('utf8');
  for await (const part of req) { raw += part; if (raw.length > 65536) throw new Error('too_large'); }
  try { return JSON.parse(raw); } catch { throw new Error('invalid_json'); }
}
function firstValue(obj, keys) {
  for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null && String(obj[key]).trim() !== '') return obj[key];
  return undefined;
}
function normalizeSociabuzz(p) {
  // Accept documented-by-user integration variants; require a recognizable amount.
  const nested = [p?.data, p?.payload, p?.donation, p?.support].find(v => v && typeof v === 'object') || {};
  const container = { ...(p && typeof p === 'object' ? p : {}), ...nested };
  const amountValue = firstValue(container, ['amount_settled', 'amount_raw', 'support_amount', 'amount', 'nominal', 'total', 'price']);
  const amount = Number(String(amountValue ?? '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    id: String(firstValue(container, ['id', 'transaction_id', 'support_id', 'invoice_id']) || `sociabuzz-${Date.now()}-${Math.random()}`),
    amount: Math.round(amount),
    name: String(firstValue(container, ['name', 'donator_name', 'supporter_name', 'sender_name', 'username', 'gifterName', 'supporter']) || 'Anonim').slice(0, 48),
    message: String(firstValue(container, ['message', 'note', 'message_text', 'support_message']) || '').slice(0, 180),
    source: 'sociabuzz'
  };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write(': connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, saweriaEnabled: Boolean(webhookKey), sociabuzzEnabled: Boolean(sociabuzzToken), connectedGamePages: clients.size });
  if (req.method === 'GET' && url.pathname === '/sociabuzz') return send(res, 200, 'OK', 'text/plain; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/overlay') {
    try { return send(res, 200, await readFile(join(root, 'overlay.html')), 'text/html; charset=utf-8'); }
    catch { return send(res, 404, 'Not found', 'text/plain'); }
  }
  if (req.method === 'POST' && url.pathname === '/saweria') {
    if (!webhookKey) { console.warn('Saweria callback rejected: SAWERIA_STREAMING_KEY is not configured'); return send(res, 503, { error: 'Saweria webhook belum diaktifkan. Set SAWERIA_STREAMING_KEY pada server.' }); }
    let raw = ''; req.setEncoding('utf8');
    for await (const part of req) { raw += part; if (raw.length > 65536) { console.warn('Saweria callback rejected: payload too large'); return send(res, 413, { error: 'Payload terlalu besar' }); } }
    let p;
    try { p = JSON.parse(raw); } catch { console.warn('Saweria callback rejected: invalid JSON'); return send(res, 400, { error: 'JSON tidak valid' }); }
    const parts = ['version', 'id', 'amount_raw', 'donator_name', 'donator_email'];
    if (parts.some(k => p[k] === undefined || p[k] === null)) { console.warn('Saweria callback rejected: required fields missing'); return send(res, 400, { error: 'Field wajib webhook belum lengkap' }); }
    const message = parts.map(k => String(p[k])).join('');
    const expected = createHmac('sha256', webhookKey).update(message).digest('hex');
    const received = req.headers['saweria-callback-signature'] || '';
    if (!safeEqual(expected, received)) { console.warn('Saweria callback rejected: signature mismatch'); return send(res, 401, { error: 'Signature Saweria tidak valid' }); }
    if (seen.has(String(p.id))) return send(res, 200, { ok: true, duplicate: true });
    seen.add(String(p.id)); if (seen.size > 5000) seen.delete(seen.values().next().value);
    broadcast({ type: 'donation', donation: { id: String(p.id), amount: Number(p.amount_raw), name: String(p.donator_name || 'Anonim').slice(0, 48), message: String(p.message || '').slice(0, 180), source: 'saweria' } });
    console.log('Saweria callback accepted');
    return send(res, 200, { ok: true });
  }
  // SociaBuzz receiver accepts both the dedicated URL and POST / used by the sample integration.
  if (req.method === 'POST' && (url.pathname === '/sociabuzz' || url.pathname === '/')) {
    if (!sociabuzzToken) { console.warn('SociaBuzz callback rejected: SOCIABUZZ_WEBHOOK_TOKEN is not configured'); return send(res, 503, { error: 'Webhook SociaBuzz belum dikonfigurasi di Railway.' }); }
    let p;
    try { p = await readJson(req); }
    catch (e) { const tooLarge = e.message === 'too_large'; console.warn(`SociaBuzz callback rejected: ${tooLarge ? 'payload too large' : 'invalid JSON'}`); return send(res, tooLarge ? 413 : 400, { error: tooLarge ? 'Payload terlalu besar' : 'JSON tidak valid' }); }
    // The public SociaBuzz guide does not specify the token's transport. Auto-detect
    // its location by matching the configured secret against scalar header/body/query values.
    const tokenInHeaders = Object.values(req.headers).some(v => containsToken(v, sociabuzzToken));
    const tokenInBody = containsToken(p, sociabuzzToken);
    const tokenInQuery = [...url.searchParams.values()].some(v => safeTextEqual(sociabuzzToken, v));
    if (!tokenInHeaders && !tokenInBody && !tokenInQuery) {
      const bodyKeys = p && typeof p === 'object' ? Object.keys(p).slice(0, 30).join(',') : 'non-object';
      const headerNames = Object.keys(req.headers).filter(k => !['host','connection','content-length','accept-encoding'].includes(k)).join(',');
      console.warn(`SociaBuzz callback rejected: configured token not found; bodyKeys=${bodyKeys}; headerNames=${headerNames}`);
      return send(res, 401, { error: 'Token tidak ditemukan pada request SociaBuzz. Periksa Railway Logs untuk nama field/header (nilai rahasia tidak dicatat).' });
    }
    const donation = normalizeSociabuzz(p);
    if (!donation) { console.warn('SociaBuzz callback rejected: donation amount missing'); return send(res, 400, { error: 'Nominal donasi tidak ditemukan pada payload' }); }
    if (seen.has(donation.id)) return send(res, 200, { ok: true, duplicate: true });
    seen.add(donation.id); if (seen.size > 5000) seen.delete(seen.values().next().value);
    broadcast({ type: 'donation', donation });
    console.log('SociaBuzz callback accepted');
    return send(res, 200, { ok: true, message: 'Webhook received' });
  }
  if (req.method === 'GET') {
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) return send(res, 403, 'Forbidden', 'text/plain');
    try { return send(res, 200, await readFile(file), mime[extname(file)] || 'application/octet-stream'); }
    catch { return send(res, 404, 'Not found', 'text/plain'); }
  }
  if (req.method === 'POST') console.warn(`Webhook POST received at unexpected path: ${url.pathname}`);
  send(res, 404, { error: 'Not found' });
}).listen(port, '0.0.0.0', () => console.log(`Zombie Apocalypse ready at http://localhost:${port}`));
