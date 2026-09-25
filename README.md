# Competitive Exam Master

This version uses:

- Firebase Authentication for student/teacher/admin authentication.
- Firebase Realtime Database for users, admins, modules, exams, questions, attempts, results, subscriptions, purchases and settings.
- Gmail API for Admin OTP and subscription/payment emails.
- Razorpay Test Mode for online Premium payments.
- Node.js backend for authorization and all protected database operations.
- No Firebase Storage is used.

## Requirements

- Node.js 22+
- Firebase project with Email/Password Authentication and Realtime Database enabled.
- Firebase Admin service-account credentials.
- Gmail API OAuth credentials with a refresh token and `gmail.send` scope.
- Razorpay Test Mode keys for online payment testing.

## First local setup

From the repository root:

```powershell
git pull origin main
npm install
Copy-Item .env.example .env
```

Fill `.env` with your Firebase and Gmail values, plus Razorpay **Test Mode** credentials. The Razorpay Key ID must begin with `rzp_test_`; live keys are intentionally not accepted by this trial checkout. Keep the Key Secret server-side in `.env`.

Admin login uses a fixed Gmail address:

```text
mjdeveloperodisha@gmail.com
```

The Admin panel asks for this email and sends a 6-digit OTP through the configured Gmail API. The OTP expires after 10 minutes and is limited to five verification attempts. No Admin password is entered in the Admin panel.

The backend still ensures the Firebase Auth/RTDB admin profile exists so the authenticated Admin session can use protected Admin APIs.

## Start the main server

```powershell
npm start
```

Open:

- http://localhost:3000/student
- http://localhost:3000/admin

The server also exposes `/api/health`.

## Premium payment setup

The main app includes the Razorpay order and verification endpoints. After adding the Razorpay Test Mode Key ID and Key Secret to `.env`, restart the main server. In Admin → Premium Subscriptions, leave **Separate payment server URL** blank to use the built-in checkout. Students can then select a plan, complete the Razorpay test checkout, and receive Premium access after the server confirms the captured payment.

If you deploy `payment-server` separately, start it with the same Firebase and Razorpay Test Mode credentials, then enter its public base URL in Admin → Premium Subscriptions. Keep the UPI fields configured if you want manual UPI with Admin approval as a fallback.

## Optional separate Razorpay payment server

Open a second PowerShell window:

```powershell
cd payment-server
npm install
node server.js
```

Payment server:

- http://localhost:4000/health
- Webhook path: `POST /api/webhook`

Set the same shared Firebase/Gmail credentials in the root `.env`. The payment server reads the root `.env`.

## Firebase password reset

Forgot-password uses Firebase Authentication's built-in reset email. No separate password-reset API or Gmail API is required for this flow.

## Gmail API

Gmail is used by the backend for application emails such as:

- Premium payment successful
- Premium payment failed
- Manual subscription approved/rejected
- Teacher approval
- Test access approval/rejection

Keep the Gmail refresh token and client secret only in `.env`.

## Razorpay webhook

For local development, the browser verification endpoint checks the Checkout signature and confirms the payment and amount with Razorpay before activating Premium.

For webhook testing, Razorpay needs a public HTTPS URL. Configure:

```
https://YOUR-PUBLIC-SERVER/api/webhook
```

with the same `RAZORPAY_WEBHOOK_SECRET` stored in `.env`.

Recommended events:

- `payment.captured`
- `payment.failed`
- Do not rely on `order.paid` for activation; `payment.captured` is the activation event

## RTDB security

The repository contains `database.rules.json`. Because the Node backend uses the Firebase Admin SDK, direct browser access can remain locked down. Deploy the rules with Firebase CLI when you are ready:

```powershell
firebase deploy --only database
```

Do not put service-account credentials, Razorpay secrets, Gmail refresh tokens or `.env` into Git.

## Important

The root backend and optional payment server use Firebase as the source of truth. The old browser-local database is no longer used. `MOCK_GATEWAY=1` does not create fake successful payments; actual Razorpay Test Mode credentials are required for online checkout.
