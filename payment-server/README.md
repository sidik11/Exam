# Razorpay payment server

This server is the payment boundary for Competitive Exam Master.

## Responsibilities

- Creates Razorpay orders using server-side prices from Firebase RTDB.
- Verifies Checkout signatures.
- Receives and validates Razorpay webhooks.
- Stores orders/subscriptions in Firebase Realtime Database.
- Activates Premium after a captured payment.
- Sends subscription success/failure emails through Gmail API.
- Never exposes the Razorpay secret to the browser.

## Run locally

From the repository root:

```powershell
npm install
cd payment-server
npm install
node server.js
```

The main app runs on port 3000 and this server normally runs on port 4000.

## Environment

The payment server reads the shared root `.env` file. Required values include:

```env
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

FIREBASE_DATABASE_URL=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_REDIRECT_URI=
GMAIL_SENDER_EMAIL=
```

## API

- `GET /health`
- `GET /api/plans`
- `POST /api/orders`
- `POST /api/verify`
- `GET /api/entitlements`
- `POST /api/webhook`

Authenticated endpoints require:

```
Authorization: Bearer <Firebase ID token>
```

## Webhook

Configure Razorpay to call:

```
https://YOUR-PUBLIC-PAYMENT-SERVER/api/webhook
```

Use the same `RAZORPAY_WEBHOOK_SECRET` value in Razorpay and `.env`.

For activation, the server processes `payment.captured` and `payment.failed`. Webhook event IDs are stored for duplicate protection.

For local browser testing, the Checkout success callback can also call `/api/verify`. A public HTTPS endpoint is still required if you want to test Razorpay webhooks locally.

## Test mode

Use Razorpay Test Mode keys while developing. The Key ID must begin with `rzp_test_`. The Razorpay Key Secret and webhook secret must stay server-side. Fake/mock orders cannot activate Premium; configure Test Mode keys to use the trial checkout.
