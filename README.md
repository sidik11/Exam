# Competitive Exam Master

This version uses:

- Firebase Authentication for student/teacher/admin authentication.
- Firebase Realtime Database for users, admins, modules, exams, questions, attempts, results, subscriptions, purchases and settings.
- Gmail API for subscription/payment emails.
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

Fill `.env` with your Firebase, Gmail and Razorpay values.

If you want the server to create the first admin account automatically, set:

```env
ADMIN_EMAIL=your-admin-email@example.com
ADMIN_PASSWORD=your-strong-password
ADMIN_NAME=Administrator
```

The server creates that Firebase Auth user and gives it the admin role in RTDB.

## Start the main server

```powershell
npm start
```

Open:

- http://localhost:3000/student
- http://localhost:3000/admin

The server also exposes `/api/health`.

## Start Razorpay payment server

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

For local development, the browser verification endpoint can activate a successful test payment immediately.

For webhook testing, Razorpay needs a public HTTPS URL. Configure:

```
https://YOUR-PUBLIC-PAYMENT-SERVER/api/webhook
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

The root backend and payment backend now use Firebase as the source of truth. The old browser-local database is no longer used.
