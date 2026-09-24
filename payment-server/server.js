/* Competitive Exam Master — payment gateway server (Razorpay)
   Zero dependencies: only Node 18+ built-ins.  Run:  node server.js   (see README.md) */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ---------- config (from environment or a .env file next to this script) ---------- */
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  });
} catch (_) {}
const CFG = {
  port: +process.env.PORT || 4000,
  keyId: process.env.RAZORPAY_KEY_ID || '',
  keySecret: process.env.RAZORPAY_KEY_SECRET || '',
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()),
  mock: process.env.MOCK_GATEWAY === '1',
  dataFile: process.env.DATA_FILE || path.join(__dirname, 'data', 'orders.json'),
  plansFile: process.env.PLANS_FILE || path.join(__dirname, 'plans.json'),
};
if (!CFG.mock && (!CFG.keyId || !CFG.keySecret)) {
  console.error('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (or MOCK_GATEWAY=1 for local testing).'); process.exit(1);
}

/* ---------- tiny JSON "database" (swap for a real DB in production) ---------- */
fs.mkdirSync(path.dirname(CFG.dataFile), { recursive: true });
let orders = {};
try { orders = JSON.parse(fs.readFileSync(CFG.dataFile, 'utf8')); } catch (_) {}
function save() { const t = CFG.dataFile + '.tmp'; fs.writeFileSync(t, JSON.stringify(orders, null, 2)); fs.renameSync(t, CFG.dataFile); }
const plans = () => JSON.parse(fs.readFileSync(CFG.plansFile, 'utf8'));

/* ---------- helpers ---------- */
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
function cors(req, res) {
  const o = req.headers.origin;
  if (CFG.allowedOrigins.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (o && CFG.allowedOrigins.includes(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > 1e6) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject);
  });
}
function razorpay(method, apiPath, body) {                       // minimal Razorpay REST client
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({ hostname: 'api.razorpay.com', path: '/v1' + apiPath, method,
      auth: CFG.keyId + ':' + CFG.keySecret, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      resp => { let s = ''; resp.on('data', c => s += c); resp.on('end', () => { try { const j = JSON.parse(s); resp.statusCode < 300 ? resolve(j) : reject(new Error(j.error && j.error.description || 'Razorpay error')); } catch (e) { reject(e); } }); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const entitlement = o => ({ orderId: o.orderId, paymentId: o.paymentId, studentId: o.studentId, planId: o.planId, planName: o.planName, days: o.days, amount: o.amount, paidAt: o.paidAt });
function markPaid(orderId, paymentId) {                          // idempotent: safe if verify + webhook both fire
  const o = orders[orderId]; if (!o) return null;
  if (o.status !== 'paid') { o.status = 'paid'; o.paymentId = paymentId; o.paidAt = new Date().toISOString(); save(); }
  return o;
}

/* ---------- routes ---------- */
const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/health') return send(res, 200, { ok: true, mock: CFG.mock });

    // 1) plans — the server is the only authority on prices
    if (url.pathname === '/api/plans' && req.method === 'GET') return send(res, 200, { plans: plans() });

    // 2) create an order for a plan
    if (url.pathname === '/api/orders' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req) || '{}');
      const plan = plans().find(p => p.id === b.planId);
      if (!plan) return send(res, 400, { error: 'Unknown plan.' });
      if (!b.studentId || String(b.studentId).length > 80) return send(res, 400, { error: 'studentId is required.' });
      const receipt = 'cem_' + crypto.randomBytes(6).toString('hex');
      const rz = CFG.mock ? { id: 'order_mock_' + crypto.randomBytes(6).toString('hex') }
        : await razorpay('POST', '/orders', { amount: Math.round(plan.price * 100), currency: 'INR', receipt, notes: { studentId: String(b.studentId), planId: plan.id } });
      orders[rz.id] = { orderId: rz.id, studentId: String(b.studentId), studentEmail: String(b.email || ''), planId: plan.id, planName: plan.name, days: plan.days, amount: plan.price, status: 'created', createdAt: new Date().toISOString() };
      save();
      return send(res, 200, { orderId: rz.id, keyId: CFG.mock ? 'rzp_test_mock' : CFG.keyId, amount: Math.round(plan.price * 100), currency: 'INR', planName: plan.name });
    }

    // 3) browser reports a finished payment — verify the signature Razorpay produced
    if (url.pathname === '/api/verify' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req) || '{}');
      const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = b;
      if (!oid || !pid || !sig || !orders[oid]) return send(res, 400, { error: 'Invalid payment details.' });
      if (!safeEq(hmac(CFG.keySecret || 'mock_secret', oid + '|' + pid), sig)) return send(res, 400, { error: 'Payment signature mismatch.' });
      return send(res, 200, { entitlement: entitlement(markPaid(oid, pid)) });
    }

    // 4) Razorpay webhook — activates the plan even if the student closed the browser
    if (url.pathname === '/api/webhook' && req.method === 'POST') {
      const raw = await readBody(req);
      if (!CFG.webhookSecret || !safeEq(hmac(CFG.webhookSecret, raw), req.headers['x-razorpay-signature'] || '')) return send(res, 400, { error: 'Bad signature.' });
      const ev = JSON.parse(raw);
      if (ev.event === 'payment.captured' || ev.event === 'order.paid') {
        const pay = ev.payload.payment && ev.payload.payment.entity;
        if (pay) markPaid(pay.order_id, pay.id);
      }
      return send(res, 200, { ok: true });
    }

    // 5) the app asks "what has this student paid for?" (picks up webhook-only activations)
    if (url.pathname === '/api/entitlements' && req.method === 'GET') {
      const sid = url.searchParams.get('studentId') || '';
      return send(res, 200, { entitlements: Object.values(orders).filter(o => o.studentId === sid && o.status === 'paid').map(entitlement) });
    }
    send(res, 404, { error: 'Not found.' });
  } catch (e) { console.error(e); send(res, 500, { error: e.message || 'Server error.' }); }
});
server.listen(CFG.port, () => console.log(`Payment server on :${CFG.port}${CFG.mock ? '  (MOCK mode — no real payments)' : ''}`));
