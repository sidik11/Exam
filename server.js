const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');
let admin = null;
try {
  admin = require('firebase-admin');
} catch (_) {}

function loadEnv(file = path.join(__dirname, '.env')) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] ??= v.replace(/\\n/g, '\n');
    }
  } catch (_) {}
}
loadEnv();

const CFG = {
  port: Number(process.env.PORT || 3000),
  dbUrl: process.env.FIREBASE_DATABASE_URL || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  web: {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    databaseURL: process.env.FIREBASE_DATABASE_URL || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || ''
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || '',
    redirectUri: process.env.GMAIL_REDIRECT_URI || '',
    sender: process.env.GMAIL_SENDER_EMAIL || ''
  },
  admin: {
    email: 'mjdeveloperodisha@gmail.com',
    name: process.env.ADMIN_NAME || 'Administrator'
  },
  payment: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    mock: process.env.MOCK_GATEWAY === '1' || !String(process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_test_') || !process.env.RAZORPAY_KEY_SECRET
  }
};
CFG.payment.enabled = !CFG.payment.mock;

let db = null;
let auth = null;
let useMemDb = false;

if (admin && CFG.dbUrl && CFG.projectId && CFG.clientEmail && CFG.privateKey) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: CFG.projectId,
        clientEmail: CFG.clientEmail,
        privateKey: CFG.privateKey
      }),
      databaseURL: CFG.dbUrl
    });
    db = admin.database();
    auth = admin.auth();
    console.log('[System] Storage connected successfully.');
  } catch (err) {
    console.warn('[System] Cloud storage connection fallback:', err.message);
    useMemDb = true;
  }
} else {
  console.warn('[System] Running with in-memory demo storage. Data will be lost when the process restarts.');
  useMemDb = true;
}

// In-memory data store for standalone/mock mode
const memStore = {};

function memGet(p) {
  const parts = p.split('/').filter(Boolean);
  let cur = memStore;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[part];
  }
  return cur !== undefined ? JSON.parse(JSON.stringify(cur)) : null;
}

function memSet(p, v) {
  const parts = p.split('/').filter(Boolean);
  let cur = memStore;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!cur[part] || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = v !== undefined ? JSON.parse(JSON.stringify(v)) : null;
}

function memUpdate(p, v) {
  const parts = p.split('/').filter(Boolean);
  let cur = memStore;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!cur[part] || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part];
  }
  const last = parts[parts.length - 1];
  if (cur[last] && typeof cur[last] === 'object' && typeof v === 'object') {
    Object.assign(cur[last], JSON.parse(JSON.stringify(v)));
  } else {
    cur[last] = v !== undefined ? JSON.parse(JSON.stringify(v)) : null;
  }
}

function memRemove(p) {
  const parts = p.split('/').filter(Boolean);
  let cur = memStore;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur || typeof cur !== 'object') return;
    cur = cur[parts[i]];
  }
  if (cur && parts.length > 0) delete cur[parts[parts.length - 1]];
}

async function get(pathName) {
  if (useMemDb || !db) return memGet(pathName);
  try {
    const snap = await db.ref(pathName).once('value');
    return snap.val();
  } catch (err) {
    console.error('[DB Error] Read failed for ' + pathName + ':', err.message);
    throw Object.assign(new Error('Data storage is temporarily unavailable. Please try again.'), { status:503 });
  }
}

async function set(pathName, value) {
  if (!useMemDb && db) {
    try { await db.ref(pathName).set(value); }
    catch (err) {
      console.error('[DB Error] Save failed for ' + pathName + ':', err.message);
      throw Object.assign(new Error('Data storage is temporarily unavailable. No changes were saved.'), { status:503 });
    }
    return;
  }
  memSet(pathName, value);
}

async function update(pathName, value) {
  if (!useMemDb && db) {
    try { await db.ref(pathName).update(value); }
    catch (err) {
      console.error('[DB Error] Update failed for ' + pathName + ':', err.message);
      throw Object.assign(new Error('Data storage is temporarily unavailable. No changes were saved.'), { status:503 });
    }
    return;
  }
  memUpdate(pathName, value);
}

async function remove(pathName) {
  if (!useMemDb && db) {
    try { await db.ref(pathName).remove(); }
    catch (err) {
      console.error('[DB Error] Delete failed for ' + pathName + ':', err.message);
      throw Object.assign(new Error('Data storage is temporarily unavailable. No changes were saved.'), { status:503 });
    }
    return;
  }
  memRemove(pathName);
}

const DEFAULT_MODULES = [
  { name:'SSC', icon:'🏛️', description:'CGL • CHSL • MTS • GD' },
  { name:'Banking', icon:'🏦', description:'IBPS • SBI • RBI' },
  { name:'Railway', icon:'🚆', description:'RRB NTPC • Group D' },
  { name:'CTET / OTET', icon:'🎓', description:'TET preparation' },
  { name:'Odisha Exams', icon:'🌐', description:'OSSC • OSSSC • OPSC • Police • Other exams' },
  { name:'Defence', icon:'🪖', description:'General preparation' }
];
const DEFAULT_PLANS = [
  { id:'plan-1m', name:'Monthly', days:30, price:99 },
  { id:'plan-3m', name:'Quarterly', days:90, price:249 },
  { id:'plan-12m', name:'Yearly', days:365, price:799 }
];
const DEFAULT_SETTINGS = {
  institutionName:'Competitive Exam Master', logoDataUrl:'', address:'', contactEmail:'', contactPhone:'',
  themeMode:'light', backgroundColor:'#f3f5f9', foregroundColor:'#172033', primaryColor:'#2563eb'
};
const DEFAULT_PAYMENT = { upiId:'', payeeName:'', note:'', gatewayUrl: process.env.PAYMENT_GATEWAY_URL || '' };

const nowIso = () => new Date().toISOString();
const uid = (prefix='') => prefix + Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex');
const cleanEmail = v => String(v || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9+\-\s]{7,15}$/;
function hashPassword(value) {
  const password=String(value||''), salt=crypto.randomBytes(16).toString('hex');
  return 'scrypt$'+salt+'$'+crypto.scryptSync(password,salt,64).toString('hex');
}
function passwordMatches(value,user) {
  const password=String(value||'');
  if(user?.passwordHash){
    const [scheme,salt,stored]=String(user.passwordHash).split('$');
    if(scheme!=='scrypt'||!salt||!stored||!/^[a-f0-9]{128}$/i.test(stored))return false;
    const expected=Buffer.from(stored,'hex'),actual=crypto.scryptSync(password,salt,expected.length);
    return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);
  }
  if(typeof user?.password==='string'){
    const expected=Buffer.from(user.password),actual=Buffer.from(password);
    return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);
  }
  return false;
}
function ownsTest(user,test) {
  return !!test && (test.createdById ? test.createdById===user.uid : cleanEmail(test.createdBy)===cleanEmail(user.email));
}
async function migrateLegacyTestOwnership(userId,oldEmail,newEmail) {
  if(cleanEmail(oldEmail)===cleanEmail(newEmail))return;
  const tests=await allMap('tests');
  let changed=false;
  for(const test of Object.values(tests)){
    if(!test.createdById&&cleanEmail(test.createdBy)===cleanEmail(oldEmail)){
      test.createdById=userId;
      test.createdBy=newEmail;
      changed=true;
    }
  }
  if(changed)await set('tests',tests);
}

async function ensureSeeds() {
  if (!(await get('settings'))) await set('settings', DEFAULT_SETTINGS);
  if (!(await get('payment'))) await set('payment', DEFAULT_PAYMENT);
  const modules = await get('modules');
  if (!modules) {
    const obj = {};
    DEFAULT_MODULES.forEach((m, i) => { obj['m-default-'+(i+1)] = { ...m, id:'m-default-'+(i+1), createdBy:'system', createdAt:nowIso() }; });
    await set('modules', obj);
  }
  if (!(await get('plans'))) {
    const obj = {}; DEFAULT_PLANS.forEach(p => { obj[p.id] = p; });
    await set('plans', obj);
  }
  if (!(await get('tests'))) await set('tests', {});
  if (!(await get('submissions'))) await set('submissions', {});
  if (!(await get('subscriptions'))) await set('subscriptions', {});
  if (!(await get('purchases'))) await set('purchases', {});
  if (!(await get('orders'))) await set('orders', {});
}

const ADMIN_OTP_SECRET = process.env.ADMIN_OTP_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_OTP_TTL_MS = 10 * 60 * 1000;
const adminOtpState = { hash:'', expiresAt:0, attempts:0, sentAt:0 };

function hashAdminOtp(otp) {
  return crypto.createHmac('sha256', ADMIN_OTP_SECRET).update(String(otp)).digest('hex');
}

function createAdminSession(uidValue) {
  const payload = Buffer.from(JSON.stringify({ uid:uidValue, email:CFG.admin.email, exp:Date.now()+12*60*60*1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_OTP_SECRET).update(payload).digest('base64url');
  return 'ADM1.' + payload + '.' + sig;
}

function verifyAdminSession(token) {
  if (!String(token||'').startsWith('ADM1.')) return null;
  const parts = String(token).split('.'); if (parts.length!==3) return null;
  const expected = crypto.createHmac('sha256', ADMIN_OTP_SECRET).update(parts[1]).digest('base64url');
  if (parts[2].length!==expected.length || !crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
    if (p.email!==CFG.admin.email || Number(p.exp)<Date.now()) return null;
    return p;
  } catch(_) { return null; }
}

function createUserSession(uidValue, emailValue, roleValue, nameValue) {
  const payload = Buffer.from(JSON.stringify({ uid:uidValue, email:emailValue, role:roleValue, name:nameValue||'User', exp:Date.now()+12*60*60*1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_OTP_SECRET).update(payload).digest('base64url');
  return 'USR1.' + payload + '.' + sig;
}

function verifyUserSession(token) {
  if (!String(token||'').startsWith('USR1.')) return null;
  const parts = String(token).split('.'); if (parts.length!==3) return null;
  const expected = crypto.createHmac('sha256', ADMIN_OTP_SECRET).update(parts[1]).digest('base64url');
  if (parts[2].length!==expected.length || !crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
    if (Number(p.exp)<Date.now()) return null;
    return p;
  } catch(_) { return null; }
}

async function bootstrapAdmin() {
  let adminUid = 'admin-cem-master';
  if (auth) {
    try {
      let u;
      try { u = await auth.getUserByEmail(CFG.admin.email); }
      catch (e) {
        if (e.code === 'auth/user-not-found') {
          u = await auth.createUser({
            email: CFG.admin.email,
            password: crypto.randomBytes(24).toString('base64url') + 'A1!',
            displayName: CFG.admin.name,
            emailVerified: true
          });
        }
      }
      if (u) {
        adminUid = u.uid;
        await auth.setCustomUserClaims(u.uid, { role:'admin' });
      }
    } catch (err) {
      console.warn('[Admin Bootstrap] Auth warning:', err.message);
    }
  }
  await update('users/'+adminUid, {
    uid: adminUid,
    name: CFG.admin.name,
    email: CFG.admin.email,
    role: 'admin',
    status: 'approved',
    blocked: false,
    createdAt: (await get('users/'+adminUid+'/createdAt')) || nowIso()
  });
  console.log('Admin account ready:', CFG.admin.email);
}

async function ensureProfile(uidValue, decoded = {}) {
  const p = await get('users/'+uidValue);
  if (p) return p;
  const profile = {
    uid:uidValue, name:decoded.name || decoded.email?.split('@')[0] || 'User',
    email:cleanEmail(decoded.email), role:decoded.role || 'student', status:'approved', blocked:false, createdAt:nowIso()
  };
  await set('users/'+uidValue, profile);
  return profile;
}

function publicUser(u) {
  if (!u) return null;
  const copy = { ...u };
  delete copy.password; delete copy.passwordHash; delete copy.resetToken; delete copy.resetTokenExpiry;
  return copy;
}

async function currentUser(req, roles) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw Object.assign(new Error('Please log in.'), { status:401 });
  const bearer = header.slice(7);
  const adminSession = verifyAdminSession(bearer);
  const userSession = verifyUserSession(bearer);
  let decoded;
  if (adminSession) {
    decoded = { uid:adminSession.uid, email:CFG.admin.email, name:CFG.admin.name, adminSession:true, role:'admin' };
  } else if (userSession) {
    decoded = { uid:userSession.uid, email:userSession.email, name:userSession.name, role:userSession.role };
  } else if (auth) {
    try { decoded = await auth.verifyIdToken(bearer); }
    catch (_) { throw Object.assign(new Error('Your login session has expired. Please log in again.'), { status:401 }); }
  } else {
    throw Object.assign(new Error('Your login session has expired. Please log in again.'), { status:401 });
  }
  const user = await ensureProfile(decoded.uid, decoded);
  if (userSession) {
    decoded.email=user.email;
    decoded.name=user.name;
    decoded.role=user.role;
  }
  if (user.blocked) throw Object.assign(new Error('Your account has been blocked. Contact the administrator.'), { status:403 });
  if (roles && !roles.includes(user.role)) throw Object.assign(new Error('Not authorized.'), { status:403 });
  if (user.role === 'teacher' && user.status !== 'approved' && (!roles || roles.includes('teacher'))) {
    throw Object.assign(new Error('Teacher account is pending Admin approval.'), { status:403 });
  }
  return { uid:decoded.uid, decoded, user };
}

function requireRole(req, role) { return currentUser(req, [role]); }

async function sendEmail(to, subject, html, text='') {
  if (!CFG.gmail.clientId || !CFG.gmail.clientSecret || !CFG.gmail.refreshToken || !CFG.gmail.sender || !to) {
    console.warn('[Email] Gmail API not fully configured — email skipped for:', to, subject);
    return false;
  }
  try {
    const oauth2 = new google.auth.OAuth2(CFG.gmail.clientId, CFG.gmail.clientSecret, CFG.gmail.redirectUri || undefined);
    oauth2.setCredentials({ refresh_token: CFG.gmail.refreshToken });
    const gmail = google.gmail({ version:'v1', auth:oauth2 });
    const mime = [
      'From: '+CFG.gmail.sender,
      'To: '+to,
      'Subject: '+subject,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html
    ].join('\r\n');
    const raw = Buffer.from(mime).toString('base64url');
    await gmail.users.messages.send({ userId:'me', requestBody:{ raw } });
    return true;
  } catch (e) {
    console.error('Gmail send failed:', e.message);
    return false;
  }
}

const emailShell = (title, body) => '<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:24px"><h2>'+title+'</h2>'+body+'<hr><p style="color:#64748b;font-size:12px">Competitive Exam Master</p></div>';

function summarizeTest(t) {
  return {
    id:t.id,title:t.title,exam:t.exam,category:t.category,subjects:t.subjects||['General'],
    languages:t.languages?.length?t.languages:['English'],type:t.type,attemptPolicy:t.attemptPolicy==='once'?'once':'reattempt',
    price:t.price||0,duration:t.duration,questionCount:t.questionCount,createdAt:t.createdAt,published:t.published
  };
}

async function allMap(name) { return (await get(name)) || {}; }

async function activeSubscription(uidValue) {
  const subs = Object.values(await allMap('subscriptions')).filter(s => s.studentId===uidValue && s.status==='approved' && new Date(s.expiresAt).getTime()>Date.now());
  return subs.sort((a,b)=>new Date(b.expiresAt)-new Date(a.expiresAt))[0] || null;
}

async function paidAccessBlocked(test, user) {
  if (test.type !== 'paid' || user.role !== 'student') return false;
  if (await activeSubscription(user.uid)) return false;
  const purchases = Object.values(await allMap('purchases'));
  return !purchases.some(p=>p.testId===test.id && p.studentId===user.uid && p.status==='approved');
}

async function attemptBlocked(test, user) {
  if (test.attemptPolicy !== 'once' || user.role !== 'student') return false;
  const submissions = Object.values(await allMap('submissions'));
  return submissions.some(s=>s.testId===test.id && s.userId===user.uid);
}

async function body(req) {
  return new Promise((resolve,reject)=>{
    const chunks=[]; let size=0;
    req.on('data', c=>{ size+=c.length; if(size>5e6){ reject(new Error('Request too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end',()=>{ try{ resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')); }catch(e){ reject(new Error('Invalid JSON body.')); }});
    req.on('error',reject);
  });
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function errorStatus(e){ return Number(e.status)||500; }

function razorpayApi(method, apiPath, payload) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : null;
    const r = https.request({
      hostname: 'api.razorpay.com',
      path: '/v1' + apiPath,
      method,
      auth: CFG.payment.keyId + ':' + CFG.payment.keySecret,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    }, resp => {
      let s = '';
      resp.on('data', c => s += c);
      resp.on('end', () => {
        try {
          const j = JSON.parse(s);
          resp.statusCode < 300 ? resolve(j) : reject(new Error(j.error?.description || 'Razorpay error'));
        } catch (e) { reject(e); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function activateOrder(order, paymentId, paidAt) {
  if (!order || !order.orderId || !order.studentId || !paymentId) throw new Error('Invalid payment order.');
  const days = Number(order.days), amount = Number(order.amount);
  if (!Number.isInteger(days) || days < 1 || !Number.isFinite(amount) || amount <= 0) throw new Error('The saved plan details are invalid.');
  const subId = uid('sub-'), requestedAt = paidAt || nowIso();
  const makeSubscription = (subs) => {
    const existing = Object.values(subs).find(s => s.gatewayOrderId === order.orderId || s.txnId === paymentId);
    if (existing) {
      if (existing.gatewayOrderId !== order.orderId || existing.studentId !== order.studentId) throw new Error('This payment is already linked to another order.');
      return existing;
    }
    const active = Object.values(subs).filter(s => s.studentId === order.studentId && s.status === 'approved' && new Date(s.expiresAt).getTime() > Date.now()).sort((a,b) => new Date(b.expiresAt)-new Date(a.expiresAt))[0];
    const start = active ? new Date(active.expiresAt) : new Date(requestedAt);
    return {
      id: subId, studentId: order.studentId, studentName: order.studentName, studentEmail: order.studentEmail,
      planId: order.planId, planName: order.planName, days, amount, txnId: paymentId,
      method: 'Razorpay Test Mode', status: 'approved', requestedAt, decidedAt: nowIso(),
      startsAt: start.toISOString(), expiresAt: new Date(start.getTime() + days * 86400000).toISOString(),
      gatewayOrderId: order.orderId
    };
  };

  let subscription;
  if (db && !useMemDb) {
    const result = await db.ref('subscriptions').transaction(current => {
      const subs = current && typeof current === 'object' ? current : {};
      const existing = Object.values(subs).find(s => s.gatewayOrderId === order.orderId || s.txnId === paymentId);
      if (existing) return;
      const sub = makeSubscription(subs);
      subs[sub.id] = sub;
      return subs;
    }, undefined, false);
    const saved = result.snapshot.val() || {};
    subscription = Object.values(saved).find(s => s.gatewayOrderId === order.orderId || s.txnId === paymentId);
    if (!subscription) throw new Error('Could not activate this subscription. Please retry or contact support.');
    if (subscription.gatewayOrderId !== order.orderId || subscription.studentId !== order.studentId) throw new Error('This payment is already linked to another order.');
  } else {
    const subs = await allMap('subscriptions');
    subscription = makeSubscription(subs);
    if (!Object.values(subs).some(s => s.id === subscription.id)) await set('subscriptions/' + subscription.id, subscription);
  }

  order.status = 'paid';
  order.paymentId = paymentId;
  order.paidAt = requestedAt;
  await update('orders/' + order.orderId, order);
  if (subscription.id === subId) {
    await sendEmail(order.studentEmail, 'Subscription payment successful', emailShell('Premium is active', '<p>Your <b>'+String(order.planName||'Premium')+'</b> subscription payment was successful.</p><p>Amount: <b>₹'+amount+'</b><br>Payment ID: <b>'+paymentId+'</b><br>Valid until: <b>'+new Date(subscription.expiresAt).toLocaleString()+'</b></p>'));
  }
  return subscription;
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;
  if (method==='OPTIONS') return send(res,204,{});

  if (url.pathname==='/api/config' && method==='GET') {
    return send(res,200,{ firebase:CFG.web, paymentGatewayUrl: process.env.PAYMENT_GATEWAY_URL || '', paymentEnabled:CFG.payment.enabled, paymentMode:CFG.payment.enabled?'test':null });
  }
  if (url.pathname==='/api/health' && method==='GET') {
    return send(res,200,{ok:true, status:'online'});
  }

  if (url.pathname==='/api/admin/request-otp' && method==='POST') {
    const b=await body(req), email=cleanEmail(b.email);
    if(email!==CFG.admin.email) throw Object.assign(new Error('This email is not authorized for Admin access.'),{status:403});
    if(Date.now()-adminOtpState.sentAt < 60*1000) throw Object.assign(new Error('Please wait 60 seconds before requesting another OTP.'),{status:429});
    const otp=String(crypto.randomInt(100000,1000000));
    adminOtpState.hash=hashAdminOtp(otp);
    adminOtpState.expiresAt=Date.now()+ADMIN_OTP_TTL_MS;
    adminOtpState.attempts=0;
    adminOtpState.sentAt=Date.now();
    const sent=await sendEmail(
      CFG.admin.email,
      'Competitive Exam Master Admin OTP',
      emailShell('Admin login verification','<p>Your one-time Admin login OTP is:</p><div style="font-size:32px;font-weight:800;letter-spacing:8px;padding:14px 0">'+otp+'</div><p>This OTP expires in 10 minutes. If you did not request this, ignore this email.</p>')
    );
    if (!sent) {
      adminOtpState.hash='';
      adminOtpState.expiresAt=0;
      adminOtpState.attempts=0;
      adminOtpState.sentAt=0;
      throw Object.assign(new Error('Admin email delivery is unavailable. Configure Gmail API credentials before requesting an OTP.'),{status:503});
    }
    return send(res,200,{message:'OTP sent to the authorized Admin Gmail address.'});
  }

  if (url.pathname==='/api/admin/verify-otp' && method==='POST') {
    const b=await body(req), email=cleanEmail(b.email), otp=String(b.otp||'').trim();
    if(email!==CFG.admin.email) throw Object.assign(new Error('This email is not authorized for Admin access.'),{status:403});
    if(!/^\d{6}$/.test(otp) || !adminOtpState.hash || Date.now()>adminOtpState.expiresAt) throw Object.assign(new Error('OTP is invalid or expired. Request a new OTP.'),{status:401});
    adminOtpState.attempts++;
    if(adminOtpState.attempts>5){ adminOtpState.hash=''; throw Object.assign(new Error('Too many OTP attempts. Request a new OTP.'),{status:429}); }
    if(!crypto.timingSafeEqual(Buffer.from(hashAdminOtp(otp)),Buffer.from(adminOtpState.hash))) throw Object.assign(new Error('Incorrect OTP.'),{status:401});
    let adminUid = 'admin-cem-master';
    if (auth) {
      try { const u=await auth.getUserByEmail(CFG.admin.email); adminUid = u.uid; } catch(_) {}
    }
    adminOtpState.hash=''; adminOtpState.expiresAt=0; adminOtpState.attempts=0;
    return send(res,200,{
      message:'Admin login successful.',
      sessionToken:createAdminSession(adminUid),
      user:{uid:adminUid,name:CFG.admin.name,email:CFG.admin.email,role:'admin',status:'approved',blocked:false}
    });
  }

  if (url.pathname==='/api/auth/me' && method==='GET') {
    try { const {user}=await currentUser(req); return send(res,200,{user:publicUser(user)}); }
    catch(e){ if(errorStatus(e)===401) return send(res,200,{user:null}); throw e; }
  }

  if (url.pathname==='/api/auth/register/student' && method==='POST') {
    const b=await body(req);
    const header = req.headers.authorization || '';
    let uidVal, emailVal;
    if (header.startsWith('Bearer ')) {
      const {uid: decodedUid, decoded} = await currentUser(req);
      uidVal = decodedUid;
      emailVal = cleanEmail(decoded.email);
    } else {
      uidVal = uid('std-');
      emailVal = cleanEmail(b.email);
    }
    const name=String(b.name||'').trim(), mobile=String(b.mobile||'').trim();
    if(!name || !EMAIL_RE.test(emailVal) || !mobile || !MOBILE_RE.test(mobile)) throw new Error('Please provide a valid name, email and mobile number.');
    const users=Object.values(await allMap('users'));
    if(users.some(u=>cleanEmail(u.email)===emailVal && u.uid!==uidVal)) throw new Error('This email is already registered.');
    const existing=await get('users/'+uidVal);
    if(existing && existing.registrationComplete) throw new Error('This account is already registered.');
    if(!header.startsWith('Bearer ')&&String(b.password||'').length<6) throw new Error('Password must contain at least 6 characters.');
    const credential=header.startsWith('Bearer ')?{}:{passwordHash:hashPassword(b.password)};
    const profile={uid:uidVal,name,email:emailVal,mobile,...credential,role:'student',status:'approved',blocked:false,registrationComplete:true,createdAt:existing?.createdAt||nowIso()};
    await set('users/'+uidVal,profile);
    return send(res,200,{message:'Student account created. Please sign in to continue.',user:publicUser(profile)});
  }

  if (url.pathname==='/api/auth/register/teacher' && method==='POST') {
    const b=await body(req);
    const header = req.headers.authorization || '';
    let uidVal, emailVal;
    if (header.startsWith('Bearer ')) {
      const {uid: decodedUid, decoded} = await currentUser(req);
      uidVal = decodedUid;
      emailVal = cleanEmail(decoded.email);
    } else {
      uidVal = uid('tch-');
      emailVal = cleanEmail(b.email);
    }
    const name=String(b.name||'').trim(), mobile=String(b.mobile||'').trim(), subject=String(b.subject||'').trim();
    if(!name || !EMAIL_RE.test(emailVal) || !mobile || !subject || !MOBILE_RE.test(mobile)) throw new Error('Please fill all fields with a valid mobile number.');
    const users=Object.values(await allMap('users'));
    if(users.some(u=>cleanEmail(u.email)===emailVal && u.uid!==uidVal)) throw new Error('This email is already registered.');
    const existing=await get('users/'+uidVal);
    if(existing && existing.registrationComplete) throw new Error('This account is already registered.');
    if(!header.startsWith('Bearer ')&&String(b.password||'').length<6) throw new Error('Password must contain at least 6 characters.');
    const credential=header.startsWith('Bearer ')?{}:{passwordHash:hashPassword(b.password)};
    const profile={uid:uidVal,name,email:emailVal,mobile,subject,...credential,role:'teacher',status:'pending',blocked:false,registrationComplete:true,createdAt:existing?.createdAt||nowIso()};
    await set('users/'+uidVal,profile);
    return send(res,200,{message:'Registration submitted. Wait for Admin approval before logging in.',user:publicUser(profile)});
  }

  if (url.pathname==='/api/auth/login' && method==='POST') {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      const {user}=await currentUser(req);
      if(user.role==='teacher' && user.status!=='approved') throw Object.assign(new Error('Teacher account is pending Admin approval.'),{status:403});
      return send(res,200,{message:'Login successful.',user:publicUser(user)});
    }
    const b=await body(req);
    const email=cleanEmail(b.email);
    const password=String(b.password||'');
    const users=Object.values(await allMap('users'));
    const user=users.find(u=>cleanEmail(u.email)===email);
    if(!user) throw Object.assign(new Error('Invalid email or password.'),{status:401});
    if(!passwordMatches(password,user)) throw Object.assign(new Error('Invalid email or password.'),{status:401});
    if(user.blocked) throw Object.assign(new Error('Your account has been blocked. Contact the administrator.'),{status:403});
    if(user.role==='teacher' && user.status!=='approved') throw Object.assign(new Error('Teacher account is pending Admin approval.'),{status:403});
    if(Object.prototype.hasOwnProperty.call(user,'password')){user.passwordHash=hashPassword(password);delete user.password;await set('users/'+user.uid,user);}
    const sessionToken = createUserSession(user.uid, user.email, user.role, user.name);
    return send(res,200,{message:'Login successful.',sessionToken,user:publicUser(user)});
  }

  if (url.pathname==='/api/auth/logout' && method==='POST') return send(res,200,{message:'Logged out.'});

  if (url.pathname==='/api/account/me' && method==='GET') {
    const {user}=await currentUser(req);
    return send(res,200,{user:publicUser(user)});
  }
  if (url.pathname==='/api/account/me' && method==='PUT') {
    const {uid,user,decoded}=await currentUser(req);
    const b=await body(req);
    const name=b.name!==undefined?String(b.name).trim():user.name, mobile=b.mobile!==undefined?String(b.mobile).trim():user.mobile, subject=b.subject!==undefined?String(b.subject).trim():user.subject;
    if(!name) throw new Error("Name can't be empty.");
    if(mobile && !MOBILE_RE.test(mobile)) throw new Error('Please enter a valid mobile number.');
    const priorEmail=cleanEmail(user.email), email=cleanEmail(decoded.email || user.email);
    const updated={...user,name,mobile,email,updatedAt:nowIso()}; if(user.role==='teacher') updated.subject=subject||'';
    await set('users/'+uid,updated);
    if(user.role==='teacher')await migrateLegacyTestOwnership(uid,priorEmail,email);
    return send(res,200,{message:'Account updated.',user:publicUser(updated)});
  }
  if(url.pathname==='/api/account/email'&&method==='PUT'){
    const {uid,user,decoded}=await currentUser(req),b=await body(req);
    if(decoded.firebase) throw Object.assign(new Error('Change your email through your Firebase account settings.'),{status:400});
    const email=cleanEmail(b.email),currentPassword=String(b.currentPassword||'');
    if(!EMAIL_RE.test(email))throw new Error('Enter a valid new email address.');
    if(!passwordMatches(currentPassword,user))throw Object.assign(new Error('Current password is incorrect.'),{status:401});
    const users=Object.values(await allMap('users'));
    if(users.some(u=>u.uid!==uid&&cleanEmail(u.email)===email))throw new Error('This email is already registered.');
    const updated={...user,email,updatedAt:nowIso(),passwordHash:hashPassword(currentPassword)};delete updated.password;
    await set('users/'+uid,updated);
    if(user.role==='teacher')await migrateLegacyTestOwnership(uid,user.email,email);
    return send(res,200,{message:'Login email changed successfully.',sessionToken:createUserSession(uid,email,user.role,user.name),user:publicUser(updated)});
  }
  if(url.pathname==='/api/account/password'&&method==='PUT'){
    const {uid,user,decoded}=await currentUser(req),b=await body(req);
    if(decoded.firebase)throw Object.assign(new Error('Change your password through your Firebase account settings.'),{status:400});
    const currentPassword=String(b.currentPassword||''),newPassword=String(b.newPassword||'');
    if(!passwordMatches(currentPassword,user))throw Object.assign(new Error('Current password is incorrect.'),{status:401});
    if(newPassword.length<6)throw new Error('New password must contain at least 6 characters.');
    const updated={...user,passwordHash:hashPassword(newPassword),updatedAt:nowIso()};delete updated.password;
    await set('users/'+uid,updated);
    return send(res,200,{message:'Password changed successfully.'});
  }

  if (url.pathname==='/api/admin/users' && method==='GET') {
    const {user}=await requireRole(req,'admin'); void user;
    const users=Object.entries(await allMap('users')).filter(([,u])=>u&&typeof u==='object').map(([key,u])=>({...publicUser(u),id:u.uid||u.id||key}));
    const teachers=users.filter(u=>u.role==='teacher'), students=users.filter(u=>u.role==='student');
    return send(res,200,{teachers,students,counts:{students:students.length,approvedTeachers:teachers.filter(t=>t.status==='approved').length,pendingTeachers:teachers.filter(t=>t.status==='pending').length}});
  }

  if (url.pathname==='/api/admin/system-status' && method==='GET') {
    await requireRole(req,'admin');
    return send(res,200,{storagePersistent:!!db&&!useMemDb,paymentEnabled:CFG.payment.enabled});
  }

  const mTeacher=url.pathname.match(/^\/api\/admin\/teachers\/([^/]+)\/(approve|module-access)$/);
  if(mTeacher && method==='POST'){
    await requireRole(req,'admin');
    const id=decodeURIComponent(mTeacher[1]), action=mTeacher[2], b=await body(req);
    const u=await get('users/'+id); if(!u || u.role!=='teacher') throw new Error('Teacher not found.');
    if(action==='approve'){
      u.status=!!b.approved?'approved':'rejected';
      await set('users/'+id,u);
      if(u.status==='approved') await sendEmail(u.email,'Teacher account approved',emailShell('Teacher account approved','<p>Your teacher account has been approved. You can now log in and publish test series.</p>'));
    } else {
      if(u.status!=='approved') throw new Error('Approve this teacher before giving module access.');
      u.canManageModules=!!b.allowed;
      await set('users/'+id,u);
    }
    return send(res,200,{message:action==='approve'?('Teacher '+(u.status==='approved'?'approved':'rejected')+'.'):(u.canManageModules?'Module access granted.':'Module access removed.'),user:publicUser(u)});
  }

  const mBlock=url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/block$/);
  if(mBlock && method==='POST'){
    await requireRole(req,'admin');
    const id=decodeURIComponent(mBlock[1]), b=await body(req), u=await get('users/'+id);
    if(!u) throw new Error('User not found.');
    if(u.role==='admin') throw new Error("Admin accounts can't be blocked.");
    u.blocked=!!b.blocked;
    await set('users/'+id,u);
    return send(res,200,{message:u.blocked?'User blocked.':'User unblocked.',user:publicUser(u)});
  }

  const mDeleteUser=url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if(mDeleteUser && method==='DELETE'){
    await requireRole(req,'admin');
    const id=decodeURIComponent(mDeleteUser[1]), u=await get('users/'+id);
    if(!u) throw new Error('User not found.');
    if(u.role==='admin') throw new Error("Admin accounts can't be deleted.");
    await remove('users/'+id);
    if (auth) { try{ await auth.deleteUser(id); }catch(_){} }
    return send(res,200,{message:'User deleted.'});
  }

  if(url.pathname==='/api/settings' && method==='GET') return send(res,200,{settings:(await get('settings'))||DEFAULT_SETTINGS});
  if(url.pathname==='/api/settings' && method==='PUT'){
    await requireRole(req,'admin');
    const b=await body(req), s={...(await get('settings')||DEFAULT_SETTINGS)};
    for(const k of ['backgroundColor','foregroundColor','primaryColor']) if(b[k]!==undefined && !/^#[0-9a-f]{6}$/i.test(String(b[k]))) throw new Error(k+' must be a 6-digit hex color.');
    for(const k of ['institutionName','address','contactEmail','contactPhone']) if(b[k]!==undefined) s[k]=String(b[k]).trim();
    if(b.logoDataUrl!==undefined){
      if(b.logoDataUrl && !String(b.logoDataUrl).startsWith('data:image/')) throw new Error('Logo must be an image file.');
      if(String(b.logoDataUrl).length>2800000) throw new Error('Logo image is too large.');
      s.logoDataUrl=String(b.logoDataUrl);
    }
    if(b.themeMode!==undefined) s.themeMode=b.themeMode==='dark'?'dark':'light';
    for(const k of ['backgroundColor','foregroundColor','primaryColor']) if(b[k]!==undefined) s[k]=String(b[k]);
    await set('settings',s);
    return send(res,200,{message:'Institution settings updated.',settings:s});
  }

  if(url.pathname==='/api/modules' && method==='GET'){
    const mods=Object.values(await allMap('modules')), tests=Object.values(await allMap('tests'));
    return send(res,200,{modules:mods.map(m=>({...m,testCount:tests.filter(t=>t.category===m.name).length}))});
  }
  if(url.pathname==='/api/modules' && method==='POST'){
    const {user}=await currentUser(req);
    if(!(user.role==='admin'||(user.role==='teacher'&&user.status==='approved'&&user.canManageModules))) throw new Error('You do not have permission to manage exam modules.');
    const b=await body(req), name=String(b.name||'').replace(/\s+/g,' ').trim();
    if(!name||name.length>40) throw new Error('Module name is required and must be 40 characters or less.');
    const mods=await allMap('modules');
    if(Object.values(mods).some(m=>m.name.toLowerCase()===name.toLowerCase())) throw new Error('That module already exists.');
    const mod={id:uid('m-'),name,icon:Array.from(String(b.icon||'📘').trim()).slice(0,2).join('')||'📘',description:String(b.description||'').trim().slice(0,80),createdBy:user.email||user.name,createdAt:nowIso()};
    mods[mod.id]=mod;
    await set('modules',mods);
    return send(res,200,{message:'Module "'+name+'" added.',module:mod});
  }

  const mDelMod=url.pathname.match(/^\/api\/modules\/([^/]+)$/);
  if(mDelMod && method==='DELETE'){
    const {user}=await currentUser(req);
    if(!(user.role==='admin'||(user.role==='teacher'&&user.status==='approved'&&user.canManageModules))) throw new Error('Not authorized.');
    const id=decodeURIComponent(mDelMod[1]), mods=await allMap('modules'), mod=mods[id];
    if(!mod) throw new Error('Module not found.');
    const tests=await allMap('tests'), affected=Object.values(tests).filter(t=>t.category===mod.name);
    if(affected.length&&user.role!=='admin') throw new Error('Module still has test series.');
    for(const t of affected) delete tests[t.id];
    delete mods[id];
    await set('modules',mods);
    await set('tests',tests);
    return send(res,200,{message:affected.length?'Module and its test series were deleted.':'Module deleted.'});
  }

  if(url.pathname==='/api/tests' && method==='GET'){
    const {user}=await currentUser(req);
    let tests=Object.values(await allMap('tests')).filter(t=>t.published);
    if(url.searchParams.get('category')) tests=tests.filter(t=>t.category===url.searchParams.get('category'));
    const submissions=Object.values(await allMap('submissions'));
    const attemptedIds=[...new Set(submissions.filter(s=>s.userId===user.uid).map(s=>s.testId))];
    const modules=Object.values(await allMap('modules'));
    return send(res,200,{tests:tests.map(summarizeTest),attemptedIds,categories:modules.map(m=>m.name)});
  }
  if(url.pathname==='/api/tests/mine' && method==='GET'){
    const {user}=await requireRole(req,'teacher');
    const tests=Object.values(await allMap('tests')).filter(t=>ownsTest(user,t));
    return send(res,200,{tests:tests.map(summarizeTest)});
  }
  if(url.pathname==='/api/tests/all' && method==='GET'){
    await requireRole(req,'admin');
    const tests=Object.values(await allMap('tests'));
    const submissions=Object.values(await allMap('submissions'));
    const counts={}; submissions.forEach(s=>counts[s.testId]=(counts[s.testId]||0)+1);
    return send(res,200,{tests:tests.map(t=>({...summarizeTest(t),createdBy:t.createdBy,attempts:counts[t.id]||0}))});
  }

  const mAttempt=url.pathname.match(/^\/api\/tests\/([^/]+)\/attempts$/);
  if(mAttempt&&method==='POST'){
    const {user}=await currentUser(req);
    const tests=await allMap('tests'), t=tests[decodeURIComponent(mAttempt[1])];
    if(!t) throw new Error('Test series not found.');
    if(!['teacher','admin'].includes(user.role)) throw new Error('Not authorized.');
    if(user.role==='teacher'&&!ownsTest(user,t)) throw new Error('You can only change your own test series.');
    t.attemptPolicy=(await body(req)).attemptPolicy==='once'?'once':'reattempt';
    tests[t.id]=t;
    await set('tests',tests);
    return send(res,200,{message:t.attemptPolicy==='once'?'Students can attempt this test only once.':'Students can reattempt this test.',test:summarizeTest(t)});
  }

  const mTest=url.pathname.match(/^\/api\/tests\/([^/]+)(?:\/(solution|submit))?$/);
  if(mTest && method==='GET' && !mTest[2]) {
    const {user}=await currentUser(req), tests=await allMap('tests'), t=tests[decodeURIComponent(mTest[1])];
    if(!t||!t.published) throw new Error('Test not found.');
    if(await paidAccessBlocked(t,user)) throw new Error('This is a Premium test series. Subscribe to Premium to access all paid test series.');
    if(await attemptBlocked(t,user)) throw new Error('You have already attempted this test. Only one attempt is allowed for this test series.');
    return send(res,200,{...summarizeTest(t),questions:t.questions.map((q,i)=>({index:i,question:q.question,options:q.options,subject:q.subject||'General',marks:q.marks,negative:q.negative,translations:q.translations||{}}))});
  }
  if(mTest && method==='GET' && mTest[2]==='solution'){
    const {user}=await currentUser(req), tests=await allMap('tests'), t=tests[decodeURIComponent(mTest[1])];
    if(!t) throw new Error('Test not found.');
    const submissions=Object.values(await allMap('submissions')).filter(s=>s.testId===t.id&&s.userId===user.uid);
    const saved=submissions.at(-1);
    if(!saved) throw new Error('Attempt this test first to view its solution.');
    return send(res,200,await calculateResult(t,saved.answers||{},saved.timeBySubject||{},false,user,true));
  }
  if(mTest && method==='POST' && mTest[2]==='submit'){
    const {user}=await currentUser(req), tests=await allMap('tests'), t=tests[decodeURIComponent(mTest[1])];
    if(!t) throw new Error('Test not found.');
    if(await paidAccessBlocked(t,user)) throw new Error('This is a Premium test series. Subscribe to Premium to access all paid test series.');
    if(await attemptBlocked(t,user)) throw new Error('You have already attempted this test. Only one attempt is allowed for this test series.');
    const b=await body(req);
    const result=await calculateResult(t,b.answers||{},b.timeBySubject||{},true,user,false);
    return send(res,200,result);
  }

  if(url.pathname==='/api/tests' && method==='POST'){
    const {user}=await requireRole(req,'teacher');
    const b=await body(req);
    const mods=await allMap('modules');
    if(!mods || !Object.values(mods).some(m=>m.name===b.category)) throw new Error('Please choose a valid exam module.');
    if(!b.title || !Array.isArray(b.questions) || !b.questions.length) throw new Error('Test title and at least one question are required.');
    let subjects=Array.isArray(b.subjects)?b.subjects.map(String).map(s=>s.trim()).filter(Boolean):['General']; subjects=[...new Set(subjects)];
    let languages=Array.isArray(b.languages)?b.languages.map(String).map(s=>s.trim()).filter(Boolean):['English']; languages=[...new Set(languages.length?languages:['English'])];
    const secondary=languages.slice(1), qs=[];
    b.questions.forEach((q,i)=>{
      const question=String(q.question||'').trim(), options=Array.isArray(q.options)?q.options.map(x=>String(x).trim()):[], answer=String(q.answer||'').toUpperCase();
      if(!question||options.length!==4||options.some(x=>!x)||!['A','B','C','D'].includes(answer)) throw new Error('Question '+(i+1)+' is invalid.');
      let translations={};
      for(const lang of secondary){
        const tr=q.translations?.[lang];
        if(tr && (tr.question||tr.options?.some(Boolean))) translations[lang]={question:String(tr.question||''),options:[0,1,2,3].map(k=>String(tr.options?.[k]||''))};
      }
      qs.push({question,options,answer,subject:String(q.subject||'General').trim()||'General',marks:Number.isFinite(Number(q.marks))?Number(q.marks):1,negative:Number.isFinite(Number(q.negative))?Number(q.negative):0,explanation:String(q.explanation||''),translations});
    });
    const t={id:uid('T'),title:String(b.title).trim(),exam:String(b.exam||'Competitive Exam').trim(),category:b.category,subjects,languages,type:String(b.type||'FREE').toUpperCase()==='PAID'?'paid':'free',price:0,duration:Number.parseInt(b.duration,10)||30,questions:qs,questionCount:qs.length,createdBy:user.email,createdById:user.uid,createdAt:nowIso(),published:true,attemptPolicy:b.attemptPolicy==='once'?'once':'reattempt'};
    const tests=await allMap('tests'); tests[t.id]=t; await set('tests',tests);
    return send(res,200,{message:'Test Series added successfully and published.',test:summarizeTest(t)});
  }

  const mDeleteTest=url.pathname.match(/^\/api\/tests\/([^/]+)$/);
  if(mDeleteTest&&method==='DELETE'){
    const {user}=await currentUser(req), tests=await allMap('tests'), id=decodeURIComponent(mDeleteTest[1]), t=tests[id];
    if(!t) throw new Error('Test series not found.');
    if(!['teacher','admin'].includes(user.role)||user.role==='teacher'&&!ownsTest(user,t)) throw new Error('Not authorized.');
    delete tests[id];
    await set('tests',tests);
    return send(res,200,{message:'Test series deleted.'});
  }

  if(url.pathname==='/api/plans'&&method==='GET'){
    await currentUser(req);
    const plans=Object.values(await allMap('plans'));
    const savedPayment=(await get('payment'))||DEFAULT_PAYMENT;
    const payment={...savedPayment,gatewayUrl:savedPayment.gatewayUrl||process.env.PAYMENT_GATEWAY_URL||'',gatewayEnabled:CFG.payment.enabled,gatewayMode:CFG.payment.enabled?'test':null};
    return send(res,200,{plans,payment});
  }
  if(url.pathname==='/api/plans'&&method==='POST'){
    await requireRole(req,'admin');
    const b=await body(req), name=String(b.name||'').trim(), days=parseInt(b.days,10), price=parseFloat(b.price);
    if(!name||!Number.isFinite(days)||days<1||!Number.isFinite(price)||price<=0||Math.round(price*100)<1||Math.abs(Math.round(price*100)-price*100)>0.000001) throw new Error('Enter a valid plan with a price greater than ₹0 and at most two decimal places.');
    const p={id:uid('plan-'),name,days,price};
    const plans=await allMap('plans'); plans[p.id]=p; await set('plans',plans);
    return send(res,200,{message:'Plan added.',plans:Object.values(plans)});
  }

  const mPlan=url.pathname.match(/^\/api\/plans\/([^/]+)$/);
  if(mPlan&&method==='DELETE'){
    await requireRole(req,'admin');
    const plans=await allMap('plans');
    delete plans[decodeURIComponent(mPlan[1])];
    await set('plans',plans);
    return send(res,200,{message:'Plan removed.',plans:Object.values(plans)});
  }

  if(url.pathname==='/api/payment-settings'&&method==='PUT'){
    await requireRole(req,'admin');
    const b=await body(req);
    const gatewayInput=b.gatewayUrl===undefined?process.env.PAYMENT_GATEWAY_URL||'':b.gatewayUrl;
    const payment={upiId:String(b.upiId||'').trim(),payeeName:String(b.payeeName||'').trim(),note:String(b.note||'').trim(),gatewayUrl:String(gatewayInput).trim().replace(/\/+$/,'')};
    await set('payment',payment);
    return send(res,200,{message:'Payment details saved.',payment});
  }

  if(url.pathname==='/api/subscription/mine'&&method==='GET'){
    const {user}=await requireRole(req,'student');
    const subs=Object.values(await allMap('subscriptions')).filter(s=>s.studentId===user.uid).sort((a,b)=>new Date(b.requestedAt)-new Date(a.requestedAt));
    const act=await activeSubscription(user.uid);
    return send(res,200,{active:!!act,expiresAt:act?.expiresAt||null,planName:act?.planName||null,requests:subs});
  }
  if(url.pathname==='/api/subscription/request'&&method==='POST'){
    const {user}=await requireRole(req,'student'), b=await body(req), plans=await allMap('plans'), p=plans[b.planId];
    if(!p) throw new Error('Please choose a plan.');
    const txn=String(b.txnId||'').trim();
    if(txn.length<6) throw new Error('Enter the transaction / UTR ID.');
    const subs=await allMap('subscriptions');
    if(Object.values(subs).some(s=>s.studentId===user.uid&&s.status==='pending')) throw new Error('You already have a payment waiting for verification.');
    if(Object.values(subs).some(s=>String(s.txnId).toLowerCase()===txn.toLowerCase())) throw new Error('This transaction ID has already been submitted.');
    const sub={id:uid('sub-'),studentId:user.uid,studentName:user.name,studentEmail:user.email,planId:p.id,planName:p.name,days:p.days,amount:p.price,txnId:txn,method:'UPI',status:'pending',requestedAt:nowIso(),decidedAt:null,startsAt:null,expiresAt:null};
    subs[sub.id]=sub;
    await set('subscriptions',subs);
    return send(res,200,{message:'Payment submitted. Premium starts after Admin verifies it.',subscription:sub});
  }
  if(url.pathname==='/api/subscription'&&method==='GET'){
    await requireRole(req,'admin');
    const subs=Object.values(await allMap('subscriptions')).sort((a,b)=>new Date(b.requestedAt)-new Date(a.requestedAt));
    return send(res,200,{subscriptions:subs});
  }

  const mSub=url.pathname.match(/^\/api\/subscription\/([^/]+)\/decide$/);
  if(mSub&&method==='POST'){
    await requireRole(req,'admin');
    const b=await body(req), subs=await allMap('subscriptions'), sub=subs[decodeURIComponent(mSub[1])];
    if(!sub) throw new Error('Request not found.');
    if(sub.status!=='pending') throw new Error('This request was already '+sub.status+'.');
    if(b.approved){
      const act=await activeSubscription(sub.studentId);
      const start=act?new Date(act.expiresAt):new Date();
      sub.status='approved';
      sub.startsAt=start.toISOString();
      sub.expiresAt=new Date(start.getTime()+sub.days*86400000).toISOString();
    } else sub.status='rejected';
    sub.decidedAt=nowIso();
    subs[sub.id]=sub;
    await set('subscriptions',subs);
    await sendEmail(sub.studentEmail,'Premium subscription '+sub.status,emailShell('Premium subscription '+sub.status,'<p>Your '+sub.planName+' subscription request is <b>'+sub.status+'</b>.</p>'+ (sub.expiresAt?'<p>Valid until: <b>'+new Date(sub.expiresAt).toLocaleString()+'</b></p>':'')));
    return send(res,200,{message:'Payment '+sub.status+'.',subscription:sub});
  }

  if(url.pathname==='/api/purchases'&&method==='GET'){
    await requireRole(req,'admin');
    let list=Object.values(await allMap('purchases'));
    const st=url.searchParams.get('status');
    if(st) list=list.filter(p=>p.status===st);
    return send(res,200,{purchases:list.sort((a,b)=>new Date(b.requestedAt)-new Date(a.requestedAt))});
  }
  if(url.pathname==='/api/purchases/mine'&&method==='GET'){
    const {user}=await requireRole(req,'student');
    return send(res,200,{purchases:Object.values(await allMap('purchases')).filter(p=>p.studentId===user.uid)});
  }
  if(url.pathname==='/api/purchases/request'&&method==='POST'){
    const {user}=await requireRole(req,'student'), b=await body(req), tests=await allMap('tests'), t=tests[b.testId];
    if(!t||!t.published) throw new Error('Test not found.');
    if(t.type!=='paid') throw new Error('That test is free.');
    const ps=await allMap('purchases');
    const existing=Object.values(ps).find(p=>p.testId===t.id&&p.studentId===user.uid);
    if(existing) return send(res,200,{message:'You already have a '+existing.status+' request for this test.',purchase:existing});
    const p={id:uid('pur-'),testId:t.id,testTitle:t.title,price:t.price,studentId:user.uid,studentName:user.name,studentEmail:user.email,status:'pending',requestedAt:nowIso(),decidedAt:null};
    ps[p.id]=p;
    await set('purchases',ps);
    return send(res,200,{message:'Access request submitted. Waiting for Admin approval.',purchase:p});
  }

  const mPur=url.pathname.match(/^\/api\/purchases\/([^/]+)\/decide$/);
  if(mPur&&method==='POST'){
    await requireRole(req,'admin');
    const b=await body(req), ps=await allMap('purchases'), p=ps[decodeURIComponent(mPur[1])];
    if(!p) throw new Error('Request not found.');
    p.status=b.approved?'approved':'rejected';
    p.decidedAt=nowIso();
    ps[p.id]=p;
    await set('purchases',ps);
    await sendEmail(p.studentEmail,'Test access request '+p.status,emailShell('Test access '+p.status,'<p>Your access request for <b>'+p.testTitle+'</b> has been '+p.status+'.</p>'));
    return send(res,200,{message:'Request '+p.status+'.',purchase:p});
  }

  // Integrated Razorpay / Orders API
  if (url.pathname === '/api/orders' && method === 'POST') {
    const { uid: userId, user } = await requireRole(req,'student');
    if (!CFG.payment.enabled) throw Object.assign(new Error('Razorpay Test Mode is not configured. Add a Razorpay Test Mode Key ID beginning with rzp_test_ and its Key Secret to the server environment.'),{status:503});
    const b = await body(req);
    const plansObj = await allMap('plans');
    const plan = plansObj[b.planId] || Object.values(plansObj).find(x => x.id === b.planId);
    if (!plan || !Number.isInteger(Number(plan.days)) || Number(plan.days)<1 || !Number.isFinite(Number(plan.price)) || Number(plan.price)<=0) throw new Error('This plan is not available for online payment.');
    const amountPaise = Math.round(Number(plan.price) * 100);
    if (amountPaise < 1 || Math.abs(amountPaise - Number(plan.price) * 100) > 0.000001) throw new Error('Plan price must be a valid amount in rupees.');
    const receipt = 'cem_' + crypto.randomBytes(6).toString('hex');
    const rz = await razorpayApi('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt, notes: { studentId: userId, planId: plan.id } });
    const order = { orderId: rz.id, studentId: userId, studentName: user.name, studentEmail: user.email, planId: plan.id, planName: plan.name, days: Number(plan.days), amount: amountPaise/100, amountPaise, currency:'INR', status: 'created', createdAt: nowIso() };
    await set('orders/' + rz.id, order);
    return send(res, 200, { orderId: rz.id, keyId: CFG.payment.keyId, amount: amountPaise, currency: 'INR', planName: plan.name, mode:'test' });
  }

  if (url.pathname === '/api/verify' && method === 'POST') {
    const {uid:userId}=await requireRole(req,'student');
    if (!CFG.payment.enabled) throw Object.assign(new Error('Razorpay Test Mode is not configured on the server.'),{status:503});
    const b = await body(req), oid = String(b.razorpay_order_id||''), pid = String(b.razorpay_payment_id||''), sig = String(b.razorpay_signature||'');
    const order = await get('orders/' + oid);
    if (!oid || !order) throw Object.assign(new Error('Invalid payment details.'), { status: 400 });
    if (order.studentId !== userId) throw Object.assign(new Error('This payment order belongs to another student.'),{status:403});
    if (!pid || !sig) throw Object.assign(new Error('Razorpay did not return complete payment details.'),{status:400});
    if (order.status==='paid' && order.paymentId && order.paymentId!==pid) throw Object.assign(new Error('This order has already been paid with a different payment.'),{status:409});
    const safeEq = (a, c) => { const x = Buffer.from(String(a)), y = Buffer.from(String(c)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
    const signature = crypto.createHmac('sha256', CFG.payment.keySecret).update(oid + '|' + pid).digest('hex');
    if (!safeEq(signature, sig)) throw Object.assign(new Error('Payment signature mismatch.'), { status: 400 });
    let paid = await razorpayApi('GET','/payments/'+encodeURIComponent(pid));
    const expectedAmount = Number(order.amountPaise)||Math.round(Number(order.amount)*100);
    if (paid.order_id !== oid || Number(paid.amount) !== expectedAmount || paid.currency !== 'INR') throw Object.assign(new Error('The Razorpay payment does not match this order.'),{status:400});
    if (paid.status === 'authorized') paid = await razorpayApi('POST','/payments/'+encodeURIComponent(pid)+'/capture',{amount:expectedAmount,currency:'INR'});
    if (paid.status !== 'captured') throw Object.assign(new Error('Razorpay has not captured this payment yet. Please wait a moment and retry.'),{status:409});
    const paidAt = paid.created_at ? new Date(Number(paid.created_at)*1000).toISOString() : nowIso();
    const sub = await activateOrder(order, pid, paidAt);
    return send(res, 200, { entitlement: { orderId: order.orderId, paymentId: pid, studentId: order.studentId, planId: sub.planId, planName: sub.planName, days: sub.days, amount: sub.amount, paidAt: sub.requestedAt } });
  }

  if (url.pathname === '/api/entitlements' && method === 'GET') {
    const { uid: userId } = await requireRole(req,'student');
    const subs = await allMap('subscriptions');
    const list = Object.values(subs).filter(s => s.studentId === userId && s.status === 'approved' && new Date(s.expiresAt).getTime() > Date.now());
    return send(res, 200, { entitlements: list.map(s => ({ orderId: s.gatewayOrderId, paymentId: s.txnId, studentId: s.studentId, planId: s.planId, planName: s.planName, days: s.days, amount: s.amount, paidAt: s.requestedAt })) });
  }

  if (url.pathname === '/api/webhook' && method === 'POST') {
    const raw = await new Promise((resolve,reject) => {
      const chunks=[]; let size=0;
      req.on('data',chunk=>{ size+=chunk.length; if(size>1e6){reject(Object.assign(new Error('Webhook body too large.'),{status:413}));req.destroy();return;} chunks.push(chunk); });
      req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error',reject);
    });
    const signature=String(req.headers['x-razorpay-signature']||'');
    const expected=CFG.payment.webhookSecret?crypto.createHmac('sha256',CFG.payment.webhookSecret).update(raw).digest('hex'):'';
    const x=Buffer.from(expected),y=Buffer.from(signature);
    if(!expected||x.length!==y.length||!crypto.timingSafeEqual(x,y)) return send(res,400,{error:'Bad signature.'});
    let event; try{event=JSON.parse(raw);}catch(_){return send(res,400,{error:'Invalid webhook payload.'});}
    const eventId=String(event.id||crypto.createHash('sha256').update(raw).digest('hex'));
    if(await get('webhookEvents/'+eventId)) return send(res,200,{ok:true,duplicate:true});
    const entity=event.payload?.payment?.entity, order=entity?.order_id?await get('orders/'+entity.order_id):null;
    if(event.event==='payment.captured'&&order){
      const amount=Number(order.amountPaise)||Math.round(Number(order.amount)*100);
      if(Number(entity.amount)!==amount||entity.currency!=='INR') throw Object.assign(new Error('Captured payment does not match the saved order.'),{status:400});
      const paidAt=entity.created_at?new Date(Number(entity.created_at)*1000).toISOString():nowIso();
      await activateOrder(order,entity.id,paidAt);
    } else if(event.event==='payment.failed'&&order&&order.status!=='paid') {
      order.status='failed'; order.paymentId=entity.id||''; order.failureReason=entity.error_description||entity.error_reason||'Payment failed'; order.failedAt=nowIso();
      await update('orders/'+order.orderId,order);
      await sendEmail(order.studentEmail,'Subscription payment failed',emailShell('Premium payment failed','<p>Your payment attempt for <b>'+String(order.planName||'Premium')+'</b> was not successful. Please try again.</p>'));
    }
    await set('webhookEvents/'+eventId,{event:event.event,receivedAt:nowIso()});
    return send(res,200,{ok:true});
  }

  if(url.pathname==='/api/admin/backup'&&method==='GET'){
    await requireRole(req,'admin');
    const names=['users','tests','purchases','subscriptions','plans','payment','modules','settings','submissions'];
    const out={}; for(const n of names) out[n]=await get(n);
    return send(res,200,out);
  }
  if(url.pathname==='/api/admin/restore'&&method==='POST'){
    await requireRole(req,'admin');
    const b=await body(req);
    if(!b.users||!b.tests) throw new Error('Backup is missing users/tests.');
    for(const n of ['users','tests','purchases','subscriptions','plans','payment','modules','settings','submissions']) if(b[n]!==undefined) await set(n,b[n]);
    return send(res,200,{message:'Restore complete.'});
  }

  throw Object.assign(new Error('Not found.'),{status:404});
}

async function calculateResult(t, answers, timeBySubject, saveAttempt, user, solutionMode) {
  let score=0,correct=0,incorrect=0,unattempted=0; const sectionMap={};
  const review=t.questions.map((q,i)=>{
    const given=answers[i]!==undefined?String(answers[i]).trim().toUpperCase():null; const subj=q.subject||'General';
    const sec=sectionMap[subj] ||= {section:subj,score:0,correct:0,incorrect:0,attempted:0,total:0,maxScore:0};
    sec.total++; sec.maxScore+=Number(q.marks)||0;
    let outcome='unattempted';
    if(given){
      sec.attempted++;
      if(given===q.answer){score+=Number(q.marks)||0;correct++;sec.correct++;outcome='correct';}
      else{score-=Number(q.negative)||0;incorrect++;sec.incorrect++;outcome='incorrect';}
    } else unattempted++;
    return {index:i,question:q.question,options:q.options,correctAnswer:q.answer,givenAnswer:given,outcome,explanation:q.explanation||''};
  });
  score=Math.round(score*100)/100; const maxScore=Math.round(t.questions.reduce((s,q)=>s+(Number(q.marks)||0),0)*100)/100; const attempted=correct+incorrect; const accuracy=attempted?Math.round(correct/attempted*1000)/10:0;
  const sections=Object.values(sectionMap).map(s=>({...s,score:Math.round(s.score*100)/100,maxScore:Math.round(s.maxScore*100)/100,accuracy:s.attempted?Math.round(s.correct/s.attempted*1000)/10:0,timeSeconds:Math.round(Number(timeBySubject[s.section]||0))}));
  if(saveAttempt){
    const subs=await allMap('submissions');
    const s={id:uid('att-'),testId:t.id,userId:user.uid,score,answers,timeBySubject,submittedAt:nowIso()};
    subs[s.id]=s;
    await set('submissions',subs);
  }
  const allScores=Object.values(await allMap('submissions')).filter(s=>s.testId===t.id).map(s=>Number(s.score)||0);
  const totalAttempts=allScores.length;
  const rank=allScores.filter(s=>s>score).length+1;
  const below=allScores.filter(s=>s<score).length;
  const percentile=totalAttempts>1?Math.round(below/(totalAttempts-1)*1000)/10:100;
  return {testId:t.id,title:t.title,score,maxScore,correct,incorrect,unattempted,attempted,total:t.questions.length,accuracy,rank,totalAttempts,percentile,sections,review};
}

function mimeFile(filePath) {
  const ext=path.extname(filePath).toLowerCase();
  return ({
    '.html':'text/html; charset=utf-8',
    '.js':'application/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8',
    '.json':'application/json; charset=utf-8',
    '.png':'image/png',
    '.jpg':'image/jpeg',
    '.jpeg':'image/jpeg',
    '.svg':'image/svg+xml'
  })[ext]||'application/octet-stream';
}

function serveStatic(req,res) {
  const url=new URL(req.url,'http://localhost');
  let p;
  if(url.pathname==='/' || url.pathname==='/student') p=path.join(__dirname,'frontend','CompetitiveExamMaster-student.html');
  else if(url.pathname==='/admin') p=path.join(__dirname,'frontend','CompetitiveExamMaster-admin.html');
  else if(url.pathname.startsWith('/frontend/')) p=path.join(__dirname,url.pathname);
  else return false;
  if(!fs.existsSync(p)) return false;
  const realRoot=path.join(__dirname,'frontend');
  const real=path.resolve(p);
  if(real!==path.resolve(realRoot, path.basename(real)) && !real.startsWith(realRoot+path.sep)) return false;
  res.writeHead(200,{'Content-Type':mimeFile(p),'Cache-Control':'no-store'});
  fs.createReadStream(p).pipe(res);
  return true;
}

const server=http.createServer(async(req,res)=>{
  try {
    if(req.url.startsWith('/api/')) return await route(req,res);
    if(serveStatic(req,res)) return;
    send(res,404,{error:'Not found.'});
  } catch(e) {
    console.error(e);
    send(res,errorStatus(e),{error:e.message||'Server error.'});
  }
});

(async()=>{
  await ensureSeeds();
  await bootstrapAdmin();
  server.listen(CFG.port, '0.0.0.0', () => {
    console.log('Competitive Exam Master server running on port ' + CFG.port + ' (0.0.0.0)');
    console.log('Student Portal: http://localhost:' + CFG.port + '/student');
    console.log('Admin Portal:   http://localhost:' + CFG.port + '/admin');
  });
})();
