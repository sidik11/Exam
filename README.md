# Competitive Exam Master

Production-oriented online competitive-exam platform.

Architecture
- Node.js backend in server.js
- Firebase Realtime Database is the server-side data store.
- Firebase Authentication is not used.
- Student/teacher/admin authentication is handled by the application.
- Passwords are stored only as salted scrypt hashes.
- Sessions use secure HttpOnly cookies.
- Gmail API sends Admin OTP, password-reset OTP and application emails.
- Razorpay Test Mode is integrated directly into the main app server.
- Manual UPI payment supports UPI ID + uploaded QR code + Admin verification.
- Exam submissions use per-attempt records and atomic one-attempt locks.
- Student post-exam ratings and feedback are stored server-side.
- RTDB rules are locked down because the backend uses the Firebase Admin SDK.

Requirements
- Node.js 22+
- Firebase project with Realtime Database enabled
- Firebase Admin service-account credentials
- Gmail API OAuth credentials with a refresh token and send permission
- Razorpay Test Mode credentials for online payment testing

Firebase Authentication does not need to be enabled for this application.

Setup
npm install
Copy-Item .env.example .env
npm start

Open http://localhost:3000/student and http://localhost:3000/admin.

For production, configure a strong AUTH_SESSION_SECRET (32+ random characters) and keep all service-account, Gmail and Razorpay secrets outside Git.

Authentication
Student and teacher registration is handled by the backend and stored in RTDB. Login checks the password hash and creates an HttpOnly session cookie. Teachers remain pending until an Admin approves them.
Admin login uses a 6-digit OTP delivered through Gmail API. OTPs expire and are rate-limited.
Forgot-password uses a Gmail OTP. The reset code is short-lived and rate-limited.

Payments
Razorpay is integrated into the main server.js; the separate payment-server directory has been removed.
Online flow: server creates the order using the server-side plan price, Razorpay Checkout handles payment, the server verifies the signature and then checks order ID, amount, currency and capture status before activating Premium.
Razorpay webhook processing provides server-to-server confirmation and duplicate-event protection.
Use Razorpay Test Mode while developing. The Key ID must start with rzp_test_. Configure the webhook at https://YOUR-PUBLIC-SERVER/api/webhook.
Razorpay supports QR-based UPI payment flows; this project also supports an Admin-uploaded static UPI QR for manual payment: https://razorpay.com/qr-code/.

Manual UPI
Admin → Premium Subscriptions supports UPI ID, payee name, payment note and UPI QR upload/preview/remove.
Students can scan the QR, open a UPI app using the UPI URI, then submit the UTR/transaction ID. Admin approval activates the subscription. A submitted UTR never automatically grants Premium.

Exam submission reliability
Submissions are stored as individual records at submissions/<attempt-id> instead of reading and rewriting the complete submissions collection.
For one-attempt tests, an atomic lock is maintained at attemptLocks/<test-id>/<user-id>. This prevents concurrent duplicate submissions while allowing a failed network request to safely retry the same attempt.
Firebase Realtime Database transactions are designed for concurrent writes that could otherwise overwrite each other.

Ratings
After completing a test, students can submit one 1–5 star rating and optional feedback. A student can update their own rating but cannot create multiple ratings for the same test.
Admins can review ratings and feedback from the Admin panel.

Security
- Firebase RTDB is not exposed directly to the browser.
- database.rules.json denies direct reads and writes.
- Passwords are never stored in plaintext.
- Auth sessions use HttpOnly, Secure and SameSite cookies.
- Login and OTP endpoints are rate-limited.
- Razorpay secrets remain server-side.
- Razorpay signatures are verified with HMAC.
- Payment amounts are checked against the saved server-side order.
- Webhook events are deduplicated.
- Protected APIs enforce user roles server-side.
- User-supplied HTML is escaped before being rendered into the UI.
- Security response headers are added by the backend.

Important production note
No web application can honestly be called unhackable. Production deployment still requires HTTPS, a strong unique AUTH_SESSION_SECRET, protection of Firebase/Gmail/Razorpay credentials, a reverse proxy/WAF such as Cloudflare, dependency updates, monitoring and backups.
Never commit .env, service-account JSON, OAuth refresh tokens, or payment secrets.