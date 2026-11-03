# Deployment

The API runs on **Render** (a Node web service), the site on **Vercel**, the database on **Neon**, images on
**Cloudinary**, and sign-in through **Firebase** (Google only). The site sends no email.

```
browser ──> https://<site>.vercel.app ──┬── static site (frontend/dist)
                                        └── /api/*  ──rewrite──> https://swayam-vce.onrender.com/api/*  ──> Neon
```

Vercel forwards every `/api/...` request to Render (`frontend/vercel.json`). The browser only ever talks to the Vercel
domain, so the login cookie is first-party there, and `VITE_API_URL` stays empty.

## 1. Before you start

- **Neon:** the production database. The current one has already been baselined for migrations. For a new, empty
  database nothing is needed: the first deploy creates every table.
- **Cloudinary:** an account. Copy the `CLOUDINARY_URL` (Dashboard > API environment variable). Render's disk is wiped
  on every deploy, so uploads must go to Cloudinary in production.
- **Firebase** (Google sign-in, **required**: it is the only way to sign in): a project with Google enabled under
  Authentication > Sign-in method. Add the Vercel domain (and any custom domain) under Authentication > Settings >
  Authorized domains.

## 2. Backend on Render

1. Render dashboard > **New > Web Service** > connect the GitHub repo `Swayam-VCE`.
2. Settings:

   | Setting | Value |
   |---|---|
   | Name | `Swayam-VCE` (gives `https://swayam-vce.onrender.com`; if the name is taken, update `frontend/vercel.json`) |
   | Branch | `main` |
   | Root Directory | `backend` |
   | Runtime | Node |
   | Build Command | `npm ci` |
   | Start Command | `npm run db:migrate && npm start` |
   | Health Check Path | `/health` (Advanced) |
   | Instance type | Starter or above for launch. Free instances sleep after 15 idle minutes and take up to a minute to wake, which can time out the first request through Vercel |

   The start command applies any pending migrations (`scripts/migrate.js`, a no-op when there are none), then starts
   the API. If a migration fails the server does not start and the previous deploy keeps serving.
3. **Environment variables** (Environment tab):

   | Key | Value |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `NODE_ENV` | `production` (turns on `secure` cookies) |
   | `DATABASE_URL` | Neon pooled connection string |
   | `JWT_SECRET` | 48+ random bytes: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
   | `JWT_EXPIRES_IN` | `7d` |
   | `QR_SECRET` | Different random value. **If you keep the current database, reuse the current `QR_SECRET`**, or every ticket already issued stops scanning |
   | `FIREBASE_PROJECT_ID` | Firebase project id, exactly as `VITE_FIREBASE_PROJECT_ID` on Vercel, without quotes |
   | `CLOUDINARY_URL` | `cloudinary://<key>:<secret>@<cloud>` |
   | `FRONTEND_URL` | `https://<site>.vercel.app` (or the custom domain), no trailing slash. Used in login links |
   | `CORS_ORIGIN` | Same as `FRONTEND_URL` (comma separate several) |
   | `TRUST_PROXY` | `2`: requests pass through Vercel's proxy and then Render's. Rate limits key on the client IP and are wrong with any other value |

   Don't set `PORT` (Render sets it) or `UPLOAD_DIR` (Cloudinary is used). Paste values without quotes: Render keeps
   them as part of the value. `TURNSTILE_SECRET`, `BREVO_SMTP_USER`, `BREVO_SMTP_PASS` and `EMAIL_FROM` are no longer
   used; delete them if they are set.
4. **Create Web Service**. When the deploy is live, open `https://swayam-vce.onrender.com/health`: it must answer
   `{"success":true,"data":{"status":"ok"}}`. The log shows `Migrations up to date (N applied).` before the server starts.

**If Google sign-in is down** (or `FIREBASE_PROJECT_ID` is wrong) and you need to get in: Render > the service >
**Shell**, run `npm run login-link -- your@gmail.com`, and open the printed link within 10 minutes.

## 3. Frontend on Vercel

1. Check `frontend/vercel.json` points at your Render URL (`https://swayam-vce.onrender.com` by default). It sends
   `/api/*` to Render and every other path to `index.html`, so links like `/events/upcoming` work on refresh.
2. Vercel dashboard > **Add New > Project** > import `Swayam-VCE`.
3. Settings:

   | Setting | Value |
   |---|---|
   | Root Directory | `frontend` |
   | Framework Preset | Vite |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |
   | Production Branch | `main` |
4. **Environment variables** (they are built into the site, so all public by design):

   | Key | Value |
   |---|---|
   | `VITE_API_URL` | Leave unset: the site calls `/api` on its own domain and Vercel proxies it |
   | `VITE_FIREBASE_API_KEY` | Firebase web app config (Project settings > Your apps). Required: Google is the only way to sign in |
   | `VITE_FIREBASE_AUTH_DOMAIN` | `<project>.firebaseapp.com` |
   | `VITE_FIREBASE_PROJECT_ID` | Same project as the backend's `FIREBASE_PROJECT_ID` |
   | `VITE_FIREBASE_APP_ID` | From the same config |
5. **Deploy**. Changing a `VITE_` variable later needs a redeploy, because it is baked in at build time. Delete
   `VITE_TURNSTILE_SITE_KEY` if it is set; it is no longer used.
6. With a custom domain: add it in Vercel > Domains, then update `FRONTEND_URL` and `CORS_ORIGIN` on Render and the
   Firebase authorized domains.

## 4. Go-live checklist

Accounts and data:
- [ ] Sign in with Google as the real admin on the live site, then set its `role` to `ADMIN` (`npm run db:studio` with
      production's `DATABASE_URL`, or the Neon SQL editor).
- [ ] Deactivate every seeded test account:
      `update users set is_active = false where email like '%@swayam.com';`
      (deactivate rather than delete: their rows are referenced by events and registrations). Done on the current
      database.
- [ ] Delete or edit the test events, and give each real paid event its UPI QR, UPI ID and payee name.

Smoke test on the live URL (use a phone for the scanner and payment steps):
- [ ] `/health` on Render answers ok; the home page, events, an archive event and a wing page load; refreshing a deep
      link such as `/events/upcoming` works.
- [ ] Sign in with Google with a new Gmail: you land on `/welcome`, and after saving the details, on the dashboard.
      Sign out and in again: no `/welcome` this time. The `token` cookie is on the Vercel domain, `Secure`, `HttpOnly`.
- [ ] Open the site from an Instagram or LinkedIn message: the sign-in page asks you to open it in Chrome or Safari.
- [ ] As an event head: create a paid event with a banner, UPI QR, UPI ID and payee name. The banner and QR URLs start
      with `https://res.cloudinary.com/`. The event page shows the banner and the UPI ID.
- [ ] As a student: register, pay a small real amount (₹1 event) to the event's UPI ID, submit the UTR.
- [ ] As the event head: the registration appears in the event's **Registrations** tab within 15 seconds, with the
      student's phone, roll number, branch and year. Approve the payment.
- [ ] As the student: the dashboard shows "Payment approved", the ticket opens, and **Download ticket** saves a PNG.
- [ ] Door scanner (`/admin/scan`) on a phone: scan the saved PNG with the phone offline; it checks in once, and a
      second scan says already checked in.
- [ ] Registrations tab: **Download Excel** opens in Excel with phone numbers intact and India times; **Copy phone
      numbers** pastes a list of `+91...` numbers. Analytics shows revenue and the check-in.
- [ ] Admin: **All students** lists the student with the event.
- [ ] A free event: register and get the ticket straight away.
- [ ] A session (sub-event) booking and its payment, if you use them.
- [ ] Emergency access: on Render's Shell run `npm run login-link -- <admin email>` and open the link in a private
      window: it signs you in.
- [ ] Redeploy once on Render and confirm uploaded images and data are still there.

Afterwards:
- [ ] Render and Vercel deploy from `main` automatically. Run `npm run test:live` against a Neon branch before merging.
- [ ] Neon: confirm point-in-time restore covers the period you need (Project settings > Storage / history retention).
