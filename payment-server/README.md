# Automatic Premium activation — payment gateway design

## How it works

```
Student (browser)            Payment server (this folder)          Razorpay
      |  1. choose plan               |                                |
      |------ POST /api/orders ------>|  2. create order (price from   |
      |                               |     plans.json, never client)->|
      |<----- orderId, keyId ---------|                                |
      |  3. Razorpay Checkout opens (UPI / cards / net banking) ------>|
      |<---- order_id, payment_id, signature ------------------------- |
      |------ POST /api/verify ------>|  4. HMAC-SHA256 check with     |
      |<----- entitlement ------------|     your secret key            |
      |  5. app records Premium (valid `days`, stacks on renewals)     |
      |                               |<-- 6. webhook payment.captured-|
      |                               |     (backup if browser closed) |
      |-- GET /api/entitlements ----->|  7. Premium page re-checks and |
      |                               |     activates anything missing |
```

* **Prices live on the server** (`plans.json`) so a student can't edit the amount in the browser.
* **Signature check** proves Razorpay (not the student) confirmed the payment.
* **Webhook + entitlement sync** means Premium still activates if the student pays and closes the tab or loses network. It is **idempotent** — the same payment can never add time twice.
* If the payment server is unreachable, the app keeps working; students can still use manual UPI + admin approval (Admin page shows the same requests).

## Set up (about 15 minutes)

1. Create a Razorpay account and copy the **Key ID** and **Key Secret** (Test mode first).
2. On any server with Node 18+ (Render, Railway, a VPS…):
   ```
   cp .env.example .env      # fill in keys, ALLOWED_ORIGINS, webhook secret
   node server.js
   ```
   Serve it over **HTTPS** (Render/Railway do this for you).
3. Razorpay Dashboard → Settings → Webhooks → add `https://YOUR-SERVER/api/webhook`, event **payment.captured** (and `order.paid`), with the same secret as `RAZORPAY_WEBHOOK_SECRET`.
4. Admin page → Premium Subscriptions → paste the server URL into **Payment server URL** → Save. Students now see **"Pay ₹X securely"**.
5. Edit `plans.json` to change plans/prices (restart the server). Test with Razorpay test cards/UPI, then switch to Live keys.

`MOCK_GATEWAY=1 node server.js` runs it without Razorpay for local testing.

## Important limits (please read)

* The app still keeps its data (users, tests, subscriptions) in each browser. Premium activated through the gateway is stored on the student's device, so a student who switches phone/browser would have it restored automatically by the sync in step 7 — but nothing stops a technically skilled user from editing their own browser storage to fake Premium. **Full protection needs moving the whole database (users, tests, subscriptions, access checks) to the server.** The payment server here is built so that migration is straightforward: it already owns prices, verification and the payment record.
* Never put the Razorpay **Key Secret** in the HTML files — only the server holds it.
* `data/orders.json` is a simple file store; use a real database (Postgres/MySQL) if you expect many payments.
* Refunds/cancellations are done in the Razorpay dashboard; they don't automatically remove Premium.
