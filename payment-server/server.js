/* Competitive Exam Master — Razorpay + Firebase RTDB + Gmail */
const http=require('http'),https=require('https'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const admin=require('firebase-admin');
const {google}=require('googleapis');

function loadEnv(){try{for(const line of fs.readFileSync(path.join(__dirname,'..','.env'),'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(!m)continue;let v=m[2].trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);process.env[m[1]]??=v.replace(/\\n/g,'\n');}}catch(_){}}
loadEnv();

const CFG={
 port:Number(process.env.PAYMENT_PORT||process.env.PORT||4000),
 keyId:process.env.RAZORPAY_KEY_ID||'',keySecret:process.env.RAZORPAY_KEY_SECRET||'',
 webhookSecret:process.env.RAZORPAY_WEBHOOK_SECRET||'',
 mock:process.env.MOCK_GATEWAY==='1'||!String(process.env.RAZORPAY_KEY_ID||'').startsWith('rzp_test_')||!process.env.RAZORPAY_KEY_SECRET,
 allowedOrigins:(process.env.ALLOWED_ORIGINS||'*').split(',').map(s=>s.trim()),
 dbUrl:process.env.FIREBASE_DATABASE_URL||'',projectId:process.env.FIREBASE_PROJECT_ID||'',
 clientEmail:process.env.FIREBASE_CLIENT_EMAIL||'',privateKey:(process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n'),
 gmail:{clientId:process.env.GMAIL_CLIENT_ID||'',clientSecret:process.env.GMAIL_CLIENT_SECRET||'',refreshToken:process.env.GMAIL_REFRESH_TOKEN||'',redirectUri:process.env.GMAIL_REDIRECT_URI||'',sender:process.env.GMAIL_SENDER_EMAIL||''}
};
CFG.paymentsEnabled=!CFG.mock;
if(!CFG.dbUrl||!CFG.projectId||!CFG.clientEmail||!CFG.privateKey){console.error('Firebase Admin credentials are required for payment-server.');process.exit(1);}
admin.initializeApp({credential:admin.credential.cert({projectId:CFG.projectId,clientEmail:CFG.clientEmail,privateKey:CFG.privateKey}),databaseURL:CFG.dbUrl});
const db=admin.database(),auth=admin.auth();

const DEFAULT_PLANS=[{id:'plan-1m',name:'Monthly',days:30,price:99},{id:'plan-3m',name:'Quarterly',days:90,price:249},{id:'plan-12m',name:'Yearly',days:365,price:799}];
const uid=p=>p+Date.now().toString(36)+'-'+crypto.randomBytes(5).toString('hex');
async function get(p){return (await db.ref(p).once('value')).val();}
async function set(p,v){return db.ref(p).set(v);}
const hmac=(secret,data)=>crypto.createHmac('sha256',secret).update(data).digest('hex');
const safeEq=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};

async function currentUser(req){
 const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))throw Object.assign(new Error('Please log in.'),{status:401});
 let d;try{d=await auth.verifyIdToken(h.slice(7));}catch(_){throw Object.assign(new Error('Invalid or expired login.'),{status:401});}
 const u=await get('users/'+d.uid);if(!u)throw Object.assign(new Error('Account profile not found.'),{status:403});
 if(u.blocked)throw Object.assign(new Error('Your account has been blocked.'),{status:403});
 if(u.role!=='student')throw Object.assign(new Error('Only student accounts can buy Premium.'),{status:403});
 return {uid:d.uid,user:u};
}
async function sendEmail(to,subject,html){
 if(!CFG.gmail.clientId||!CFG.gmail.clientSecret||!CFG.gmail.refreshToken||!CFG.gmail.sender||!to)return false;
 try{
  const oauth=new google.auth.OAuth2(CFG.gmail.clientId,CFG.gmail.clientSecret,CFG.gmail.redirectUri||undefined);
  oauth.setCredentials({refresh_token:CFG.gmail.refreshToken});
  const gmail=google.gmail({version:'v1',auth:oauth});
  const mime=['From: '+CFG.gmail.sender,'To: '+to,'Subject: '+subject,'MIME-Version: 1.0','Content-Type: text/html; charset=UTF-8','','<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:24px"><h2>'+subject+'</h2>'+html+'<hr><p style="color:#64748b;font-size:12px">Competitive Exam Master</p></div>'].join('\r\n');
  await gmail.users.messages.send({userId:'me',requestBody:{raw:Buffer.from(mime).toString('base64url')}});
  return true;
 }catch(e){console.error('Gmail error:',e.message);return false;}
}
function cors(req,res){const o=req.headers.origin;if(CFG.allowedOrigins.includes('*'))res.setHeader('Access-Control-Allow-Origin','*');else if(o&&CFG.allowedOrigins.includes(o)){res.setHeader('Access-Control-Allow-Origin',o);res.setHeader('Vary','Origin');}res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');}
function send(res,code,obj){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
function readBody(req){return new Promise((resolve,reject)=>{const a=[];let n=0;req.on('data',c=>{n+=c.length;if(n>1e6){reject(new Error('Body too large'));req.destroy();}else a.push(c);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(a).toString('utf8')||'{}'));}catch(e){reject(new Error('Invalid JSON.'));}});req.on('error',reject);});}
function razorpay(method,apiPath,body){
 return new Promise((resolve,reject)=>{const data=body?JSON.stringify(body):null;const r=https.request({hostname:'api.razorpay.com',path:'/v1'+apiPath,method,auth:CFG.keyId+':'+CFG.keySecret,headers:{'Content-Type':'application/json',...(data?{'Content-Length':Buffer.byteLength(data)}:{})}},resp=>{let s='';resp.on('data',c=>s+=c);resp.on('end',()=>{try{const j=JSON.parse(s);resp.statusCode<300?resolve(j):reject(new Error(j.error?.description||'Razorpay error'));}catch(e){reject(e);}})});r.on('error',reject);if(data)r.write(data);r.end();});
}
async function plans(){
 const p=await get('plans');return p?Object.values(p):DEFAULT_PLANS;
}
async function activeSub(uidValue){
 const p=await get('subscriptions')||{};return Object.values(p).filter(s=>s.studentId===uidValue&&s.status==='approved'&&new Date(s.expiresAt).getTime()>Date.now()).sort((a,b)=>new Date(b.expiresAt)-new Date(a.expiresAt))[0]||null;
}
async function activate(order,paymentId,paidAt){
 if(!order||!order.orderId||!order.studentId||!paymentId)throw new Error('Invalid payment order.');
 const days=Number(order.days),amount=Number(order.amount);
 if(!Number.isInteger(days)||days<1||!Number.isFinite(amount)||amount<=0)throw new Error('The saved plan details are invalid.');
 const subId=uid('sub-'),requestedAt=paidAt||new Date().toISOString();
 const result=await db.ref('subscriptions').transaction(current=>{
  const subs=current&&typeof current==='object'?current:{};
  const existing=Object.values(subs).find(s=>s.gatewayOrderId===order.orderId||s.txnId===paymentId);
  if(existing)return;
  const active=Object.values(subs).filter(s=>s.studentId===order.studentId&&s.status==='approved'&&new Date(s.expiresAt).getTime()>Date.now()).sort((a,b)=>new Date(b.expiresAt)-new Date(a.expiresAt))[0];
  const start=active?new Date(active.expiresAt):new Date(requestedAt);
  const sub={id:subId,studentId:order.studentId,studentName:order.studentName,studentEmail:order.studentEmail,planId:order.planId,planName:order.planName,days,amount,txnId:paymentId,method:'Razorpay Test Mode',status:'approved',requestedAt,decidedAt:new Date().toISOString(),startsAt:start.toISOString(),expiresAt:new Date(start.getTime()+days*86400000).toISOString(),gatewayOrderId:order.orderId};
  subs[sub.id]=sub;return subs;
 },undefined,false);
 const saved=result.snapshot.val()||{};
 const sub=Object.values(saved).find(s=>s.gatewayOrderId===order.orderId||s.txnId===paymentId);
 if(!sub)throw new Error('Could not activate this subscription. Please retry or contact support.');
 if(sub.gatewayOrderId!==order.orderId||sub.studentId!==order.studentId)throw new Error('This payment is already linked to another order.');
 order.status='paid';order.paymentId=paymentId;order.paidAt=requestedAt;await db.ref('orders/'+order.orderId).update(order);
 if(sub.id===subId)await sendEmail(order.studentEmail,'Subscription payment successful','<p>Hello '+String(order.studentName||'Student').replace(/[<>]/g,'')+',</p><p>Your <b>'+String(order.planName||'Premium').replace(/[<>]/g,'')+'</b> Premium subscription payment was successful.</p><p>Amount: <b>₹'+amount+'</b><br>Payment ID: <b>'+paymentId+'</b><br>Valid until: <b>'+new Date(sub.expiresAt).toLocaleString()+'</b></p>');
 return sub;
}
async function markFailed(order,paymentId,reason){
 if(!order||order.status==='paid')return;
 order.status='failed';order.paymentId=paymentId||order.paymentId;order.failureReason=reason||'Payment failed';order.failedAt=new Date().toISOString();await set('orders/'+order.orderId,order);
 await sendEmail(order.studentEmail,'Subscription payment failed','<p>Hello '+String(order.studentName||'Student').replace(/[<>]/g,'')+',</p><p>Your payment attempt for <b>'+String(order.planName||'Premium')+'</b> was not successful.</p><p>Please try again. If your bank account was debited, wait for the payment provider/bank to reconcile the transaction.</p>');
}

async function route(req,res){
 cors(req,res);if(req.method==='OPTIONS')return send(res,204,{});
 const u=new URL(req.url,'http://localhost'),p=u.pathname;
 if(p==='/health'&&req.method==='GET')return send(res,200,{ok:true,mock:CFG.mock,paymentsEnabled:CFG.paymentsEnabled,paymentMode:CFG.paymentsEnabled?'test':null,firebase:true});
 if(p==='/api/plans'&&req.method==='GET')return send(res,200,{plans:await plans(),paymentsEnabled:CFG.paymentsEnabled,paymentMode:CFG.paymentsEnabled?'test':null});
 if(p==='/api/orders'&&req.method==='POST'){
  const {uid:userId,user}=await currentUser(req);
  if(!CFG.paymentsEnabled)throw Object.assign(new Error('Razorpay Test Mode is not configured. Add a Razorpay Test Mode Key ID beginning with rzp_test_ and its Key Secret to the server environment.'),{status:503});
  const b=await readBody(req);const ps=await plans(),plan=ps.find(x=>x.id===b.planId);
  if(!plan||!Number.isInteger(Number(plan.days))||Number(plan.days)<1||!Number.isFinite(Number(plan.price))||Number(plan.price)<=0)throw new Error('This plan is not available for online payment.');
  const amountPaise=Math.round(Number(plan.price)*100);if(amountPaise<1||Math.abs(amountPaise-Number(plan.price)*100)>0.000001)throw new Error('Plan price must be a valid amount in rupees.');
  const receipt='cem_'+crypto.randomBytes(6).toString('hex');
  const rz=await razorpay('POST','/orders',{amount:amountPaise,currency:'INR',receipt,notes:{studentId:userId,planId:plan.id}});
  const order={orderId:rz.id,studentId:userId,studentName:user.name,studentEmail:user.email,planId:plan.id,planName:plan.name,days:Number(plan.days),amount:amountPaise/100,amountPaise,currency:'INR',status:'created',createdAt:new Date().toISOString()};
  await set('orders/'+rz.id,order);
  return send(res,200,{orderId:rz.id,keyId:CFG.keyId,amount:amountPaise,currency:'INR',planName:plan.name,mode:'test'});
 }
 if(p==='/api/verify'&&req.method==='POST'){
  const {uid:userId}=await currentUser(req);
  if(!CFG.paymentsEnabled)throw Object.assign(new Error('Razorpay Test Mode is not configured on the server.'),{status:503});
  const b=await readBody(req),oid=String(b.razorpay_order_id||''),pid=String(b.razorpay_payment_id||''),sig=String(b.razorpay_signature||'');
  const order=await get('orders/'+oid);if(!oid||!pid||!sig||!order)throw Object.assign(new Error('Invalid payment details.'),{status:400});
  if(order.studentId!==userId)throw Object.assign(new Error('This payment order belongs to another student.'),{status:403});
  if(order.status==='paid'&&order.paymentId&&order.paymentId!==pid)throw Object.assign(new Error('This order has already been paid with a different payment.'),{status:409});
  if(!safeEq(hmac(CFG.keySecret,oid+'|'+pid),sig))throw Object.assign(new Error('Payment signature mismatch.'),{status:400});
  let paid=await razorpay('GET','/payments/'+encodeURIComponent(pid));const expectedAmount=Number(order.amountPaise)||Math.round(Number(order.amount)*100);
  if(paid.order_id!==oid||Number(paid.amount)!==expectedAmount||paid.currency!=='INR')throw Object.assign(new Error('The Razorpay payment does not match this order.'),{status:400});
  if(paid.status==='authorized')paid=await razorpay('POST','/payments/'+encodeURIComponent(pid)+'/capture',{amount:expectedAmount,currency:'INR'});
  if(paid.status!=='captured')throw Object.assign(new Error('Razorpay has not captured this payment yet. Please wait a moment and retry.'),{status:409});
  const paidAt=paid.created_at?new Date(Number(paid.created_at)*1000).toISOString():new Date().toISOString();
  const sub=await activate(order,pid,paidAt);return send(res,200,{entitlement:{orderId:order.orderId,paymentId:pid,studentId:order.studentId,planId:sub.planId,planName:sub.planName,days:sub.days,amount:sub.amount,paidAt:sub.requestedAt}});
 }
 if(p==='/api/entitlements'&&req.method==='GET'){
  const {uid:userId}=await currentUser(req);const subs=await get('subscriptions')||{};const list=Object.values(subs).filter(s=>s.studentId===userId&&s.status==='approved'&&new Date(s.expiresAt).getTime()>Date.now());
  return send(res,200,{entitlements:list.map(s=>({orderId:s.gatewayOrderId,paymentId:s.txnId,studentId:s.studentId,planId:s.planId,planName:s.planName,days:s.days,amount:s.amount,paidAt:s.requestedAt}))});
 }
 if(p==='/api/webhook'&&req.method==='POST'){
  const raw=await new Promise((resolve,reject)=>{const a=[];let n=0;req.on('data',c=>{n+=c.length;if(n>1000000){reject(new Error('Webhook body too large'));req.destroy();return;}a.push(c);});req.on('end',()=>resolve(Buffer.concat(a).toString('utf8')));req.on('error',reject);});
  if(!CFG.webhookSecret||!safeEq(hmac(CFG.webhookSecret,raw),req.headers['x-razorpay-signature']||''))return send(res,400,{error:'Bad signature.'});
  let ev;try{ev=JSON.parse(raw);}catch(_){return send(res,400,{error:'Invalid webhook payload.'});}
  const eventId=ev.id||crypto.createHash('sha256').update(raw).digest('hex'),seen=await get('webhookEvents/'+eventId);if(seen)return send(res,200,{ok:true,duplicate:true});
  const entity=ev.payload?.payment?.entity||ev.payload?.order?.entity;const oid=entity?.order_id||entity?.id,order=await get('orders/'+oid);
  if(ev.event==='payment.captured'&&order){const expectedAmount=Number(order.amountPaise)||Math.round(Number(order.amount)*100);if(Number(entity.amount)!==expectedAmount||entity.currency!=='INR')throw Object.assign(new Error('Captured payment does not match the saved order.'),{status:400});const paidAt=entity.created_at?new Date(Number(entity.created_at)*1000).toISOString():new Date().toISOString();await activate(order,entity.id,paidAt);}
  else if(ev.event==='payment.failed'){if(order)await markFailed(order,entity.id,entity.error_description||entity.error_reason);}
  await set('webhookEvents/'+eventId,{event:ev.event,receivedAt:new Date().toISOString()});
  return send(res,200,{ok:true});
 }
 return send(res,404,{error:'Not found.'});
}
const server=http.createServer(async(req,res)=>{try{await route(req,res);}catch(e){console.error(e);send(res,Number(e.status)||500,{error:e.message||'Server error.'});}});
server.listen(CFG.port,()=>console.log('Payment server on http://localhost:'+CFG.port+(CFG.mock?' (MOCK mode)':'')));
