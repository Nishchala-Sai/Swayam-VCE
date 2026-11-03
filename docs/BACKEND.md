# Backend

One Express 5 API (Node.js 20+, ES modules) in `backend/`, using **Neon** serverless PostgreSQL through **Drizzle ORM**.
Authentication is a JWT in an httpOnly cookie (email and password, or Google via Firebase). Paid events use manual UPI payments verified by an admin.
For the overall picture and folder structure see `docs/ARCHITECTURE.md`.

**Status:** built: database connection, `users`, `events` and `registrations` tables, `requireAuth`, `requireRole`, the auth module (register, login, logout, me, Sign in with Google, password reset, profile name)
with rate limiting and Cloudflare Turnstile, the events module (create, list, get), the registrations module (solo and team registration, my registrations, QR tickets), the manual UPI payments module (submit proof, staff queue, approve or reject with refund overflow, refunds, reject remaining), sub-events with pass-holder pricing and bookings, QR check-in for events and sub-events, and analytics.

## 1. Set up locally

Requires Node.js 20+ and a free Neon account (https://neon.tech). Nothing runs in Docker; the database is Neon.

1. **Create the database.** In the Neon console create a project (region close to India, e.g. Singapore). Open
   *Connection details*, choose the **pooled** connection string, and copy it.
2. **Configure.**
   ```bash
   cd backend
   cp .env.example .env      # then paste DATABASE_URL and generate JWT_SECRET (section 2)
   ```
3. **Install.**
   ```bash
   npm install
   ```
   For reference, these are the commands that created the dependency list:
   ```bash
   npm install express drizzle-orm @neondatabase/serverless jsonwebtoken cookie-parser cors helmet bcryptjs dotenv express-rate-limit
   npm install -D drizzle-kit
   ```
4. **Create the tables.**
   ```bash
   npm run db:push           # applies src/db/schema.js to the Neon database
   ```
5. **Run.**
   ```bash
   npm run dev               # http://localhost:4000, restarts on file changes
   ```
   Check `GET http://localhost:4000/health` → `{ "success": true, "data": { "status": "ok" } }`.

Each developer should use their own Neon **branch** (Neon console → Branches) so schema experiments don't touch the
shared database. A branch has its own connection string; put it in your `.env`.

### Scripts
| Script | What it does |
|---|---|
| `npm run dev` | Start with auto-restart (`node --watch`) |
| `npm start` | Start for production |
| `npm run db:push` | Make the database match `src/db/schema.js`. Review the changes it prints before confirming, especially when it wants to drop columns |
| `npm run db:studio` | Open Drizzle Studio, a browser UI for viewing and editing rows |
| `npm run db:seed` | Create or reset the three test accounts (see `users` below) |

### Changing the schema
Edit `src/db/schema.js`, then run `npm run db:push`. Column names in the database are `snake_case`
(`password_hash`); in JavaScript they are `camelCase` (`passwordHash`). Before launch, switch from `db:push` to
versioned migrations (`drizzle-kit generate` + `drizzle-kit migrate`) so production changes are reviewed in pull requests.

### Neon HTTP driver notes
`drizzle-orm/neon-http` sends each query as one HTTPS request. It does **not** support interactive transactions
(`db.transaction`). For several writes that must succeed or fail together, use `db.batch([...])`, or a single SQL
statement with conditions (for example a conditional `UPDATE ... WHERE` for seat counting).

## 2. Environment variables

Never commit `.env` (it is git-ignored). Never paste PRIVATE values into chat, issues or screenshots.

| Variable | Private? | Notes |
|---|---|---|
| `DATABASE_URL` | **PRIVATE** | Neon pooled connection string, includes the password. Required |
| `JWT_SECRET` | **PRIVATE** | At least 32 random characters. Required. Changing it logs everyone out. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | not secret | Login lifetime, e.g. `7d`. Default `7d` |
| `QR_SECRET` | **PRIVATE** | Signs QR tickets. Required. At least 32 random characters, different from `JWT_SECRET`. Changing it invalidates every ticket already issued |
| `TURNSTILE_SECRET` | **PRIVATE** | Cloudflare Turnstile secret key. Required. Locally use the test secret `1x0000000000000000000000000000000AA` (always passes) or `2x0000000000000000000000000000000AA` (always fails) |
| `TRUST_PROXY` | not secret | Number of proxies in front of the API: `0` locally, usually `1` on Render or Railway. Rate limiting is wrong without it (section 4) |
| `FIREBASE_PROJECT_ID` | not secret | Firebase project id for "Sign in with Google". Optional: without it `/api/auth/google-login` answers 503 |
| `FRONTEND_URL` | not secret | Public URL of the website, used in password-reset links. Default: the first `CORS_ORIGIN` |
| `PORT` | not secret | Default `4000` |
| `NODE_ENV` | not secret | `production` turns on `secure` cookies |
| `CORS_ORIGIN` | not secret | Frontend URL(s), comma separated. Default `http://localhost:5173` |
| `CLOUDINARY_URL` | **PRIVATE** | `cloudinary://<key>:<secret>@<cloud>`. Uploaded QR and banner images go to Cloudinary; without it they are saved in `UPLOAD_DIR` (development) |
| `UPLOAD_DIR` | not secret | Local upload folder when `CLOUDINARY_URL` is unset. Default `backend/uploads` |
| `BREVO_SMTP_USER` | not secret | Brevo SMTP login (Brevo > SMTP & API > SMTP). With either Brevo value unset, emails are printed in the terminal |
| `BREVO_SMTP_PASS` | **PRIVATE** | A Brevo SMTP key |
| `EMAIL_FROM` | not secret | Sender, e.g. `Swayam E-Cell <noreply@your-domain>`. Must be a sender or domain verified in Brevo |

The UPI ID and payee name are stored per event (`events.upi_id`, `events.upi_payee_name`), not in the environment.

The server refuses to start if `DATABASE_URL`, `JWT_SECRET`, `TURNSTILE_SECRET` or `QR_SECRET` is missing.

## 3. Database

### `users` (built)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | `gen_random_uuid()` |
| `email` | varchar(255), unique | Store lowercased |
| `name` | varchar(100), nullable | Display name. Set at signup (`PATCH /api/auth/me`), on the profile page, or from Google |
| `password_hash` | varchar(255) | bcrypt hash. Google-created accounts get the hash of a random password until they set one |
| `role` | enum `user_role` | `STUDENT` (default), `EVENT_HEAD`, `ADMIN` |
| `is_active` | boolean | Default `true`. `false` blocks the user everywhere |
| `created_at` | timestamptz | Default `now()` |

The first `ADMIN`: sign up normally, then change that user's `role` to `ADMIN` in `npm run db:studio`.

Test accounts: `npm run db:seed` (`scripts/seed-users.js`) creates or resets `admin@swayam.com` (ADMIN),
`manager@swayam.com` (EVENT_HEAD) and `student@swayam.com` (STUDENT), all with the password `Password123!`, hashed
with the same bcrypt cost as signup. It is safe to re-run, and refuses to run with `NODE_ENV=production` unless given
`--force`, because the password is public. Delete or deactivate these accounts before launch.

### `password_reset_tokens` (built)
`id`, `user_id` → `users.id`, `token_hash` (SHA-256 hex of the emailed token, unique), `expires_at` (30 minutes after
the request), `created_at`. The token itself is never stored. A row is deleted when it is used; requesting a new link
deletes the user's older rows.

### `events` (built)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | `gen_random_uuid()` |
| `title` | varchar(200) | |
| `description` | text | |
| `date` | timestamptz | Start date and time. Indexed (lists are sorted by it) |
| `location` | varchar(255) | |
| `capacity` | integer | Must be > 0 (database check) |
| `price` | integer | Whole rupees, default `0` (free). Must be ≥ 0 (database check) |
| `upi_qr_url` | varchar(2048), nullable | https link to the club's UPI QR image. Required by the API when `price > 0` |
| `upi_id` | varchar(100), nullable | UPI ID students can pay to (e.g. `swayam@okaxis`), shown under the QR code |
| `upi_payee_name` | varchar(100), nullable | The name students should see in their UPI app for that ID |
| `banner_url` | varchar(2048), nullable | Optional wide image shown at the top of the event page: an uploaded banner or an https link |
| `payment_instructions` | text, nullable | Shown on the payment screen, e.g. "write your roll number in the UPI note" |
| `created_by` | uuid → `users.id` | Set from the signed-in user, never from the request body |
| `created_at` | timestamptz | Default `now()` |

### `registrations` (built)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | `gen_random_uuid()` |
| `user_id` | uuid → `users.id` | |
| `event_id` | uuid → `events.id` | |
| `status` | enum `registration_status` | `CONFIRMED` (default, holds a seat) or `CANCELLED` |
| `payment_status` | enum `payment_status` | `PENDING` (default), `VERIFIED`, `REJECTED`, `REFUND_REQUIRED` (paid but no seat: refund them), `REFUNDED`. Free events are inserted as `VERIFIED` |
| `utr_number` | varchar(32), nullable, unique | UPI transaction reference. Leader's row only for teams |
| `payment_screenshot_url` | varchar(2048), nullable | https link to the payment screenshot. Leader's row only for teams |
| `reviewed_by` | uuid → `users.id`, nullable | Admin or event head who approved or rejected the payment |
| `reviewed_at` | timestamptz, nullable | When they did it |
| `team_id` | uuid, nullable | Shared by every row of one team. Null for solo registrations |
| `team_name` | varchar(100), nullable | Display name; not unique, so `team_id` is what links rows |
| `is_group_leader` | boolean | Default `false`. `true` on the row of the student who registered the team |
| `teammate_emails` | text, nullable | Comma separated, leader's row only |
| `total_amount_paid` | integer, nullable | Whole rupees the student says they paid. Solo or leader row only. Never calculated |
| `refunded_by`, `refunded_at` | uuid → `users.id`, timestamptz, nullable | Who marked the refund as sent, and when |
| `attended_at` | timestamptz, nullable | Main-event check-in time |
| `created_at` | timestamptz | Default `now()`. Reset when a cancelled registration is reactivated |

Unique `(user_id, event_id)`: one registration per student per event. Indexes `(event_id, status)` for seat counting and
`team_id` for team lookups.

### `sub_events` (built)
`id`, `event_id` → `events.id`, `title` varchar(200), `capacity` integer > 0, `price_for_pass_holders` and
`price_for_standalone` integers ≥ 0 (default 0), `start_time` timestamptz nullable, `created_at`.

### `sub_event_bookings` (built)
The same columns and meaning as `registrations` (`status`, `payment_status`, `utr_number` unique, screenshot,
`total_amount_paid`, review and refund columns, team columns, `attended_at`, `created_at`), with `sub_event_id` →
`sub_events.id` instead of `event_id`, plus `registration_id` → `registrations.id` (nullable: the pass holder's main
registration) and `is_pass_holder` boolean. Unique `(user_id, sub_event_id)`. Indexes on `(sub_event_id, status)`,
`team_id`, `registration_id`.

## 4. API

All responses: `{ "success": true, "data": ... }` or `{ "success": false, "message": "..." }`.
Protected routes need the `token` cookie. The frontend must send requests with `credentials: 'include'`.
"Signed in" means `requireAuth` passes; role checks run after it.

### Auth (`src/modules/auth`, built)
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | anyone | `{ email, password, turnstileToken }`. Creates a `STUDENT`, sets the cookie, returns the user (201) |
| POST | `/api/auth/login` | anyone | `{ email, password, turnstileToken }`. Sets the cookie, returns the user |
| POST | `/api/auth/logout` | anyone | Clears the cookie |
| GET | `/api/auth/me` | signed in | The current user (`id, email, name, role, isActive, createdAt`). The frontend calls this on load to restore the session |
| PATCH | `/api/auth/me` | signed in | `{ name }` (1 to 100 characters). Sets the display name; returns the updated user |
| POST | `/api/auth/google-login` | anyone | `{ idToken }`: a Firebase ID token from "Sign in with Google". Finds or creates the user, sets the cookie (see below) |
| POST | `/api/auth/forgot-password` | anyone | `{ email, turnstileToken }`. Always answers 200 with the same message; sends (for now: logs) a reset link if the account exists |
| POST | `/api/auth/reset-password` | anyone | `{ token, password }`. Sets a new password from a reset link (see below) |

| Status | When |
|---|---|
| 400 | Invalid email, or password not 8 to 72 characters (register) |
| 403 | `turnstileToken` missing or rejected by Cloudflare: `CAPTCHA verification failed. Are you a bot?` |
| 409 | Register with an email that already has an account |
| 401 | Login with an unknown email, wrong password or deactivated account. Always the same `Invalid email or password.` so attackers can't tell which emails are registered |
| 429 | Rate limit reached (see below) |

**Register** lowercases the email, hashes the password with bcrypt (cost 12) and inserts the user.
**Login** compares against a dummy hash when the email is unknown, so the response time doesn't reveal whether an
account exists. The JWT `{ sub: <user id> }` is signed with HS256 and put in the `token` cookie (`httpOnly`, `secure` in
production, `sameSite: 'lax'`), which expires at the same moment as the token. Passwords over 72 bytes are rejected
because bcrypt ignores everything after byte 72.

### Bot and brute-force protection
Two layers, both on register and login only.

**1. Rate limit** (`src/middleware/rateLimiter.js`, `express-rate-limit`). `authLimiter` allows **10 requests per 15
minutes per IP**, counted across register and login together. Request 11 gets 429
`Too many requests, please try again after 15 minutes.` Responses carry `RateLimit` and `RateLimit-Policy` headers.
- Counts are kept in memory: they reset when the server restarts and are not shared if you run more than one instance.
  For several instances, give the limiter a shared store (e.g. `rate-limit-redis`).
- Behind a hosting proxy set `TRUST_PROXY=1`. With `0` there, every student shares the proxy's IP, so 10 logins from
  the whole college lock everyone out. Never set it higher than the real number of proxies, or clients can fake their IP.
- Students on the same college Wi-Fi share one public IP. If that blocks real users at event launches, raise `limit`.

**2. CAPTCHA** (`src/utils/verifyTurnstile.js`, Cloudflare Turnstile, free). The controller checks the body first, then
sends `turnstileToken` (plus the client IP) to Cloudflare's `siteverify` API with `TURNSTILE_SECRET`. A missing token,
a rejection, a network error or a 5-second timeout all count as failed (403). Tokens are single-use and expire after
5 minutes, so the frontend must get a new one (`turnstile.reset()`) after every failed attempt.

**Frontend side** (`pages/Auth.jsx`): add the widget script
`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`, render
`<div class="cf-turnstile" data-sitekey="...">` in the login and signup forms (or use the `@marsidev/react-turnstile`
package), and send its token as `turnstileToken`. The **site key** is public and goes in `frontend/.env` as
`VITE_TURNSTILE_SITE_KEY`. For local development use Cloudflare's test site key `1x00000000000000000000AA`.

**Cloudflare setup:** Cloudflare dashboard → Turnstile → Add widget → add your domains (and `localhost`) → copy the
site key (frontend) and secret key (`TURNSTILE_SECRET`, backend).

### Sign in with Google (`google.controller.js`, built)
Firebase Authentication is used **only** to prove who the user is. The website signs in with Google through Firebase
(popup), takes the Firebase **ID token**, and posts it to `POST /api/auth/google-login`. The backend verifies the token
with the Firebase Admin SDK (`firebase-admin`), then works exactly like `/login`: it finds or creates the user in Neon
and sets our own JWT cookie. Roles, sessions and data stay in our API.

- Accepted only if the token is valid for `FIREBASE_PROJECT_ID`, was issued by the **Google** provider, and has a
  **verified** email. Otherwise 401 `Google sign-in failed`.
- Accounts are matched by email, so a student who signed up with a password and later uses Google with the same
  address gets the same account. New Google users are `STUDENT`s, named from their Google profile, with a random
  password nobody knows (they can set one with "Forgot password").
- Deactivated accounts get 401. The route shares `authLimiter` (10 per 15 minutes per IP) with login and register.
- No Turnstile here: the Google popup is the bot check.
- **Setup:** create a Firebase project (console.firebase.google.com) → Authentication → Sign-in method → enable
  Google → add your domains (and `localhost`) under Authorized domains. Put the project id in `FIREBASE_PROJECT_ID`
  (backend) and the web-app config in `frontend/.env.local` (`VITE_FIREBASE_*`). Verifying ID tokens needs only the
  project id, not a service-account key. Without `FIREBASE_PROJECT_ID` the endpoint answers **503** and the rest of
  the API is unaffected.

### Password reset (`passwordReset.controller.js`, built)
1. `POST /api/auth/forgot-password { email, turnstileToken }`: if an active account has that email, creates a random
   32-byte token, stores only its SHA-256 with a 30-minute expiry (replacing older links), and **emails the link** through Brevo
   (`<FRONTEND_URL>/reset-password?token=...`). Without the Brevo SMTP settings the email is printed in the server
   terminal instead. The answer is always the
   same 200 message, so the endpoint can't be used to find out which emails have accounts.
2. The student opens the link; the website's Reset password page posts `POST /api/auth/reset-password { token, password }`.
   The token is deleted and the new bcrypt hash saved **in one SQL statement**, so a link works exactly once, even with
   two clicks at the same moment. Expired, used and replaced links get 400 `This reset link is invalid or has expired`.
   Same password rules as signup (8 to 72 bytes).

Both routes have their own `passwordResetLimiter` (5 requests per 15 minutes per IP), separate from login.

Set `BREVO_SMTP_USER`, `BREVO_SMTP_PASS` and `EMAIL_FROM` in production: without them the links are only printed in the
server logs, where anyone who can read the logs could use them. Existing sessions stay valid after a reset (JWTs are stateless); they end when
they expire (`JWT_EXPIRES_IN`).

### Using `requireAuth`
```js
import { requireAuth } from '../../middleware/requireAuth.js'
router.get('/me', requireAuth, (req, res) => res.json({ success: true, data: req.user }))
```
It returns 401 when the cookie is missing, the token is invalid or expired, or the user doesn't exist or is deactivated.
A database failure is passed to the error handler as a 500, so a database problem does not log users out.

### Using `requireRole`
Put it after `requireAuth`. Users whose role isn't in the list get 403 `You do not have permission to do this.`
```js
import { requireRole } from '../../middleware/requireRole.js'
router.post('/', requireAuth, requireRole(['ADMIN', 'EVENT_HEAD']), createEvent)
```

### Events (`src/modules/events`, built)
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/events` | ADMIN, EVENT_HEAD | Create an event. Returns it with 201 |
| GET | `/api/events` | anyone | All events, soonest first |
| GET | `/api/events/:id` | anyone | One event. 404 if the id is unknown or not a valid uuid |
| GET | `/api/events/availability` | anyone | `[{ eventId, capacity, seatsTaken, seatsLeft }]` for every event, for the website's seat bars. Counts `CONFIRMED` registrations, the same rule registration uses |
| PATCH | `/api/events/:id/capacity` | ADMIN, EVENT_HEAD (own events) | `{ "capacity": 80 }`. Any time, even below the seats already taken |

**Lowering capacity below the seats taken** doesn't cancel anyone. New registrations are refused, and approvals that would
go past the new limit become `REFUND_REQUIRED` (see payments). An `EVENT_HEAD` changing someone else's event gets 403.

`POST /api/events` body (JSON):
```json
{
  "title": "Startup Pitch Night",
  "description": "Pitch your idea to investors.",
  "date": "2026-11-20T18:00:00+05:30",
  "location": "Seminar Hall, Block A",
  "capacity": 120,
  "price": 199,
  "upiQrUrl": "https://.../swayam-upi-qr.png",
  "upiId": "swayam@okaxis",
  "upiPayeeName": "Swayam E-Cell",
  "bannerUrl": "https://.../pitch-night-banner.jpg",
  "paymentInstructions": "Write your roll number in the UPI note."
}
```
`price` (whole rupees) defaults to `0`. `upiQrUrl` must be https and is required when `price > 0`. `bannerUrl` is optional
(an uploaded banner path or an https link). `upiId` (`handle@bank`) and `upiPayeeName` (up to 100 characters) are optional. `capacity` and
`price` must be JSON numbers, not strings. Invalid input returns 400 with a message naming the field. Any other fields
(such as `id` or `createdBy`) are ignored.

### Registrations (`src/modules/registrations`, built)
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/registrations/:eventId` | signed in | Register yourself (no body), or a team (body below). 201 |
| GET | `/api/registrations/me` | signed in | Your registrations, newest first, with team fields and `event: { id, title, date, location, price }` |
| GET | `/api/registrations/:registrationId/ticket` | owner | `{ registrationId, qrPayload }` once `status` is `CONFIRMED` and `paymentStatus` is `VERIFIED` |

**Team registration.** The signed-in student is the leader:
```json
{ "teamName": "Rocket", "teammateEmails": ["a@vce.ac.in", "b@vce.ac.in"] }
```
- `teammateEmails`, if sent, must be a non-empty list (at most 10) of valid, different emails, not including the
  leader's. `teamName` (up to 100 characters) is required with it, and not allowed without it.
- **Every teammate needs a Swayam account** (each row belongs to a user). Unknown emails get 400 naming them.
- One row is created per member, all sharing a `team_id`. The team takes `1 + teammateEmails.length` seats.
- Only the leader's row carries the UTR, screenshot and `teammate_emails`; only the leader can submit payment proof.
- All or nothing: if any member is already registered, or there aren't enough seats for the whole team, no rows are created.
- The response is the leader's registration with a `teammates` array. For free events every row also has its `ticket`.

| Status | When |
|---|---|
| 201 | Registered. `status` `CONFIRMED`; `paymentStatus` `VERIFIED` for free events, `PENDING` for paid ones |
| 400 | Invalid team body, a teammate without an account, or `Event is full` (for teams: `not enough seats for a team of N`) |
| 404 | Unknown event, or the id is not a valid uuid |
| 409 | You (`You are already registered for this event.`) or a teammate (`One or more emails are already registered for this event.`) already holds a seat, or a refund for this event is still open for one of you |

**Registering again after a rejection.** A student whose registration was cancelled with payment `REJECTED` (by staff, or by
reject-remaining for students who never sent a UTR) can register again. Their existing row is reactivated: `CONFIRMED`, `PENDING` (or
`VERIFIED` if free), with the old UTR, screenshot and review cleared. Students with a `REFUND_REQUIRED` registration can't
re-register until the refund is sorted out, so the UTR the club needs for the refund isn't wiped.

**No overselling.** The checks and the insert run in one transaction (`db.batch`). The first statement locks the event row
(`SELECT ... FOR UPDATE`), so registrations, approvals and closures for the same event run one after another. The second is
one `INSERT ... SELECT ... ON CONFLICT DO UPDATE` that adds (or reactivates) every member's row only if `CONFIRMED` seats +
team size ≤ `capacity` and no member already holds a seat. Tested against Neon: 12 students at once for 3 seats gave
exactly 3 registrations; 4 teams of 2 at once for 5 seats gave exactly 2 teams. Don't split this into a count query
followed by inserts: that version oversells under load.

**Tickets: one master pass per student per event.** `qrPayload` is
`base64url(subject) + "." + base64url(HMAC-SHA256(that, QR_SECRET))` (`src/utils/generateTicket.js`), where the subject is:
- **MAIN pass:** the registration id. For students with a `CONFIRMED` + `VERIFIED` registration. Admits to the main
  event and to every sub-event they booked.
- **STANDALONE pass:** `standalone:<eventId>:<userId>`. For students with a verified sub-event booking but no main pass.
  Admits only to the sub-events of that event they booked; refused at the main gate.

There are no per-booking tickets. Nothing is stored: the same subject always gives the same payload, and what a pass
admits to is decided at scan time from the database. Each team member gets their own pass from their own account.
Render `qrPayload` as a QR code exactly as returned.

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/registrations/events/:eventId/ticket` | signed in | **The master ticket** for that event: `{ eventId, kind: 'MAIN' \| 'STANDALONE', qrPayload, registrationId? }`. MAIN if you have a verified registration, otherwise STANDALONE if you have a verified booking. 409 while payment is pending, 404 if you have neither |

`GET /api/registrations/:registrationId/ticket` still returns the same MAIN pass for a known registration.

**totalAmountPaid** (optional, whole rupees) can be sent with the registration body; see payments.

**Registering again after a refund.** Same as after a rejection, once staff have marked the refund `REFUNDED`.

### Sub-events and bookings (built)
A sub-event is a bookable part of an event (workshop, hackathon, IPL auction) with its own seats and two prices. Students
RSVP in advance. A booking is priced per member: a member with a `CONFIRMED` + `VERIFIED` registration for the parent
event is a **pass holder** and pays `priceForPassHolders`; anyone else is **standalone** and pays `priceForStandalone`.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/events/:eventId/sub-events` | ADMIN, EVENT_HEAD (own events) | `{ title, capacity, priceForPassHolders?, priceForStandalone?, startTime? }`. Prices default to 0. A priced sub-event needs the parent event to have a `upiQrUrl` (payments go there) |
| GET | `/api/events/:eventId/sub-events` | anyone | The event's sub-events with `seatsLeft`, by `startTime` |
| PATCH | `/api/events/:eventId/sub-events/:subEventId/capacity` | ADMIN, EVENT_HEAD (own events) | `{ "capacity": 30 }`. Any time, even below the seats already booked. 404 if the sub-event isn't part of that event |
| POST | `/api/registrations/book-sub-event` | signed in | `{ subEventId, teamName?, teammateEmails?, totalAmountPaid? }`. Same team rules as registration. 201 |
| GET | `/api/registrations/bookings/me` | signed in | Your bookings with `subEvent { id, title, startTime }` and `event { ... }` |
| GET | `/api/payments/sub-event-bookings/pending` | ADMIN, EVENT_HEAD (own events) | Like `/api/payments/pending`, plus `subEvent { title, priceForPassHolders, priceForStandalone }` |
| POST | `/api/payments/sub-event-bookings/:bookingId/proof` | owner (solo or leader) | Same body and rules as registration proof |
| PATCH | `/api/payments/sub-event-bookings/:bookingId/verify` | ADMIN, EVENT_HEAD (own events) | Same as registrations; overflow is measured against the sub-event's capacity |
| PATCH | `/api/payments/sub-event-bookings/:bookingId/refund` | ADMIN, EVENT_HEAD (own events) | Same as registrations |
| POST | `/api/payments/sub-events/:subEventId/reject-remaining` | ADMIN, EVENT_HEAD (own events) | Close payments for one sub-event: cancel every booking still `PENDING`, freeing their seats. Returns `{ refundRequired, rejected, bookingIds }` |

- If every member's price is 0 the booking is `VERIFIED` at once; otherwise it is `PENDING`. Either way, members get in
  with their master ticket.
- The response shows each member's `price` and `isPassHolder` so the frontend can say what applies; the price is not stored
  and the server never adds it up. A pass holder's booking also stores their main `registrationId`.
- Seat checks, duplicate checks, team all-or-nothing, reactivation after rejection or refund, and the race safety are the
  same as for registrations (tested on Neon: 6 students at once for 3 seats gave exactly 3 bookings).
- **Capacity** works like event capacity: lowering it below the seats booked cancels nobody, but new bookings are refused
  (400 `Sub-event is full`) and approvals past the new limit become `REFUND_REQUIRED`. Raising it reopens bookings.
- **Reject remaining** works like the main-event version, on one sub-event's bookings only. Bookings with a UTR (for a
  team, the leader's) become `REFUND_REQUIRED`; bookings that never sent one become `REJECTED`, since nothing was paid.
  All become `CANCELLED`, which frees their seats; `VERIFIED` bookings and main-event registrations are not touched.
  Running it twice is harmless. As with registrations, `REJECTED` students can book again; `REFUND_REQUIRED` students can
  once the refund is marked `REFUNDED`.

### Check-in (built)
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/registrations/check-in` | ADMIN, EVENT_HEAD (own events) | `{ qrPayload, subEventId?, eventId? }`. Scan the master ticket and admit in one call |

> **The scanner must be logged in as staff.** `POST /api/registrations/check-in` only works with the `token` cookie of
> a logged-in `ADMIN` or `EVENT_HEAD` account. Without a session it returns **401**; a `STUDENT` session gets **403**;
> an `EVENT_HEAD` scanning a ticket for an event they did not create gets **403**. So whatever device scans at the door
> (a phone browser or a scanner page) must first log in through `POST /api/auth/login` with a staff account, and send
> its requests with `credentials: 'include'`, like the rest of the frontend. Students' tickets alone grant nothing: a
> QR code is only admitted when a staff session scans it.
>
> Practical notes: give each door volunteer their own `EVENT_HEAD` account (made by an `ADMIN` setting the role in
> `npm run db:studio`) rather than sharing the admin login. The session lasts `JWT_EXPIRES_IN` (default 7 days), so log
> scanners in before the event, and log them out (`POST /api/auth/logout`) afterwards. Deactivating an account
> (`is_active = false`) stops its scanner immediately.

- **Without `subEventId` (main gate):** only a MAIN pass admits; sets the registration's `attendedAt`. A STANDALONE pass
  gets 409 (`sub-event-only pass`).
- **With `subEventId`:** finds the pass holder's booking for that sub-event and sets its `attendedAt`. A MAIN pass must
  still be a valid registration (a cancelled or unpaid main pass is refused even with a booking). A student who booked
  as standalone and later bought the main pass gets in on the main pass.
- **`eventId` (optional):** the scanner's event. A genuine ticket for any other event is refused (409).
- Sub-event attendance is the booking's `attended_at`: one booking per student per sub-event, so it records who
  attended which sub-event and when.
- Only `CONFIRMED` + `VERIFIED` tickets get in. Each check-in is one `UPDATE ... WHERE attended_at IS NULL`, so the same
  ticket scanned at two gates at once is admitted once (tested).

| Status | Scanner should show |
|---|---|
| 200 | `Checked in.` with `pass` (`MAIN` or `STANDALONE`), `name`, `email`, team name and event (or sub-event) title |
| 400 | `Invalid ticket`: forged or damaged QR |
| 403 | An `EVENT_HEAD` scanning for someone else's event |
| 404 | Ticket or sub-event not found, or `This student has not booked this sub-event.` |
| 409 | `Already checked in.` (with `name`, `email` and the time), payment not verified, main pass no longer valid, cancelled, a STANDALONE pass at the main gate, or a different event |

### Analytics (built)
| Method | Path | Who | Returns |
|---|---|---|---|
| GET | `/api/events/:id/analytics` | ADMIN, EVENT_HEAD (own events) | `totalSeats, seatsFilled, ticketsSold, awaitingPayment, mainEventAttended, mainEventRevenue, subEventRevenue, totalRevenue, refundRequiredCount, refundedCount, subEvents[]` with each sub-event's `capacity, bookingsCount, verifiedCount, attendedCount, revenue, refundRequiredCount` |
| GET | `/api/events/:eventId/export` | ADMIN, EVENT_HEAD (own events) | CSV attachment of every registration (one row per person, cancelled ones included): `Student Name, Email, Registration Code, Payment Status, Check-in Time (IST)`. The code is the first 8 characters of the registration id (the dashboard's Ticket ID); the time is `YYYY-MM-DD HH:MM` or `Not Attended`. UTF-8 with a byte-order mark for Excel; cells starting with `= + - @` get a leading `'` |
| GET | `/api/analytics/overview` | ADMIN | `totalEvents, totalUsers, totalRevenue, totalTicketsSold, totalSubEventBookings, pendingPayments, refundsDue` |

Revenue is the sum of `totalAmountPaid` on `VERIFIED` payments (refund-due and refunded money is excluded). Payments
approved before `totalAmountPaid` existed have no amount and count as 0. `seatsFilled` includes unpaid `PENDING`
registrations, which hold seats; `ticketsSold` counts only `VERIFIED` people. Refund counts are per payment (a team counts once).

### Manual UPI payments (`src/modules/payments`, built)
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/payments/:registrationId/proof` | owner (solo or team leader) | `{ "utrNumber": "412345678901", "totalAmountPaid": 300, "paymentScreenshotUrl": "https://..." }`. Screenshot optional; `totalAmountPaid` optional only if it was sent when registering. `paymentStatus` stays `PENDING`. Can be resent to fix a typo until someone decides |
| GET | `/api/payments/pending` | ADMIN, EVENT_HEAD (own events) | One entry per solo registration or team still `PENDING`, with `teamSize`, `totalAmountPaid`, `user { id, email }` and `event { id, title, date, price }`. Ones with a UTR first, oldest first |
| PATCH | `/api/payments/:registrationId/verify` | ADMIN, EVENT_HEAD (own events) | `{ "action": "APPROVE" }` or `{ "action": "REJECT" }` on a solo or leader registration. Applies to the whole team |
| PATCH | `/api/payments/:registrationId/refund` | ADMIN, EVENT_HEAD (own events) | Mark a `REFUND_REQUIRED` payment as `REFUNDED` once the money is sent back (whole team). Sets `refundedBy`, `refundedAt` |
| POST | `/api/payments/:eventId/reject-remaining` | ADMIN, EVENT_HEAD (own events) | Close payments for the event: cancel every registration still `PENDING`. Returns `{ refundRequired, rejected, registrationIds }` |
| | `/api/payments/sub-event-bookings/...`, `/api/payments/sub-events/:subEventId/reject-remaining` | | The same `pending`, `proof`, `verify`, `refund` and `reject-remaining` for sub-event bookings (see below) |

**The amount is never calculated by the server.** The student enters `totalAmountPaid` (whole rupees) when registering or
with the proof; it is stored on the solo or leader row. Staff check it against the screenshot and bank statement, so a team
can pay whatever the organisers agreed. `APPROVE` needs both a UTR and `totalAmountPaid`.

**Approve.** If verified seats + team size ≤ capacity, every row in the team becomes `VERIFIED` and tickets are
available. Otherwise (the event filled up, or capacity was lowered) every row becomes `REFUND_REQUIRED` and `CANCELLED`,
and the response includes a `message` telling the staff member to refund. Only `VERIFIED` registrations count as taken
seats here, because unpaid `PENDING` ones also hold seats and would make almost every approval look "full".
**Reject:** every row becomes `REJECTED` and `CANCELLED`; the students can register again.

**Reject remaining.** Registrations whose UTR was submitted (for teams, by the leader) may have paid, so they become
`REFUND_REQUIRED`. Ones that never submitted a UTR become `REJECTED`, so the refund list contains only real payments.
All are `CANCELLED`.

`POST .../proof` responses: 200 saved; 400 UTR not 12 digits, screenshot URL not https, `totalAmountPaid` missing or
invalid, or event is free; 403 a teammate (only the leader can submit); 404 not your registration (another student's
registration looks the same as a missing one); 409 UTR already used, payment already decided, or registration cancelled.

`PATCH .../verify` responses: 200 decided; 400 bad `action`, free event, a teammate's row (use the leader's), or `APPROVE`
before a UTR and `totalAmountPaid` were submitted; 403 an `EVENT_HEAD` on someone else's event; 404 unknown registration;
409 already decided.

`PATCH .../refund` responses: 200 refunded; 400 a teammate's row (use the leader's); 403 someone else's event;
404 unknown; 409 already refunded, or no refund is due.

How it stays correct:
- `utr_number` is unique in each table, and the proof endpoint also refuses a UTR already used in the other table, so one
  UPI payment can't be claimed twice (→ 409).
- Verify and reject-remaining lock the event row first and keep every condition in the `UPDATE ... WHERE` (`PENDING`,
  paid event, leader row, caller manages the event). Tested on Neon: two staff approving the same payment at once → one
  200, one 409. Two approvals at once for the last seat → one `VERIFIED`, one `REFUND_REQUIRED`.
- Each decision stores `reviewed_by` and `reviewed_at`.
- `EVENT_HEAD`s get past `requireRole`, and the controller then limits them to events whose `createdBy` is their id.

**Refunds.** The club sends the money back by UPI using the stored UTR, then calls `.../refund`. `REFUND_REQUIRED` students
can't register again (so the UTR isn't wiped before the refund); once `REFUNDED`, they can, and the row is reactivated.

**Screenshots:** the API stores a link, not the file. The frontend must upload the image somewhere first
(e.g. Cloudinary or S3-compatible storage) and send the resulting https URL. Anyone with the link can see the image, so
use unguessable URLs. Where to host them is still to decide.

### Venues, uploads, schedules and team sessions (built)

| Method | Path | Who | What |
| --- | --- | --- | --- |
| GET | `/api/venues` | ADMIN, EVENT_HEAD | Venue list for the event form's dropdown |
| POST | `/api/venues` | ADMIN | `{ name }`; unique ignoring case (409) |
| DELETE | `/api/venues/:id` | ADMIN | Removes it from the list; events keep their venue text |
| POST | `/api/uploads/upi-qr` | ADMIN, EVENT_HEAD | multipart field `file`: PNG, JPEG or WebP (checked by content), up to 2 MB. Returns `{ path }` to send as `upiQrUrl` |
| POST | `/api/uploads/banner` | ADMIN, EVENT_HEAD | Same as `upi-qr`, up to 5 MB. Returns `{ path }` to send as `bannerUrl` |
| GET | `/api/uploads/upi-qr/<file>`, `/api/uploads/banner/<file>` | public | The uploaded image (files live in `UPLOAD_DIR`) |
| POST | `/api/events/:eventId/sub-events/:subEventId/auto-group` | ADMIN, EVENT_HEAD (own events) | Couples short teams into full ones |
| GET | `/api/events/:eventId/sub-events/:subEventId/teams` | ADMIN, EVENT_HEAD (own events) | Roster: formed teams and bookings not grouped yet |

- **Event schedule:** `POST /api/events` takes an optional `schedule`: `[{ date: 'YYYY-MM-DD', slots: [{ start: 'HH:MM', end:
  'HH:MM', title, kind: 'session' | 'break' }] }]`, up to 14 days and 30 slots a day, any times, no overlaps. Stored sorted
  in `events.schedule` (jsonb). `upiQrUrl` may be an uploaded path or an https link.
- **Uploads:** with `CLOUDINARY_URL` set, `POST /api/uploads/upi-qr` and `/banner` store the image in Cloudinary
  (`swayam/upi-qr/<uuid>`, `swayam/banner/<uuid>`) and returns its https URL; otherwise it saves to `UPLOAD_DIR` as before. A replaced or
  deleted event's image is removed once no event uses it.
- **Emails (Brevo SMTP):** `smtp-relay.brevo.com:587` (STARTTLS) through nodemailer, with `BREVO_SMTP_USER`,
  `BREVO_SMTP_PASS` and `EMAIL_FROM`. Password reset links, and a "ticket ready" email to every member when staff approve
  a payment (registrations and session bookings). Without the Brevo login, emails are printed in the terminal. Sending never delays or fails the request. Test addresses (`.invalid`, `.test`, `.example`) are skipped.
- **Editing events:** `PATCH /api/events/:id`, the same body as creating (ADMIN, or the EVENT_HEAD who created it).
- **Refunds:** `GET /api/payments/refunds` lists REFUND_REQUIRED payments (solo or team leader) for registrations and
  bookings, scoped like the pending list. Mark one done with the existing `PATCH .../refund` endpoints.
- **Analytics:** `GET /api/events/:id/analytics` also returns `seatsAvailable`, `checkIns` (name, email, ticketId,
  teamName, checkedInAt; latest first) and, for team sessions, `teams` (name, grouped, members with attended).
- **Overlaps:** events and sessions may run at the same time. Sessions take an optional `endTime` (needs `startTime`,
  must be after it). `/api/registrations/me` includes `event.schedule` and `/api/registrations/bookings/me` includes
  `subEvent.endTime` and `event.schedule`, so the site can warn a student (never block) when something they book
  overlaps, or falls on the same day as, something they already hold (`frontend/src/lib/clashes.js`).
- **Team registration:** `events.max_team_size` (2 to 11, or null). Null means individual registration only, unless the
  event has a group offer, which allows teams of up to `groupSize`. A team registration on any other event is a 400.
- **Deleting:** `DELETE /api/events/:id` and `DELETE /api/events/:eventId/sub-events/:subEventId` (ADMIN, EVENT_HEAD for
  own events). Event heads may delete only while nobody has registered or booked (cancelled and refunded rows count, as
  payment records). Admins may delete one with registrations by sending `{ confirm: "<exact title>" }`, which removes its
  sessions, registrations, bookings and payment records in one transaction. An uploaded QR image is deleted once no event
  uses it.
- **Editing sessions:** `PATCH /api/events/:eventId/sub-events/:subEventId` (ADMIN, EVENT_HEAD for own events) takes the
  same body as creating. Changes apply to new bookings; existing bookings keep their price and team.
- **Ticket holders only:** `sub_events.pass_holders_only`. Booking needs a CONFIRMED + VERIFIED main-event registration
  for every member (403 naming who lacks one); the standalone price is stored as 0.
- **Team caps:** a team registration for an event with a group offer holds at most `groupSize` people (otherwise 11).
  `/api/registrations/me` and `/api/registrations/bookings/me` include `teamLeader` (the leader's email) so teammates see
  who registered or booked for them.
- **Group price:** events take optional `groupSize` (2 to 11) and `groupPrice` (total, whole rupees), both or neither,
  paid events only, and `groupPrice < price x groupSize`. A team of exactly `groupSize` pays `groupPrice`; everyone else pays
  `price` per person. The site fills in the team total; staff still approve what was actually paid. `GET /api/payments/pending`
  includes `event.groupSize` and `event.groupPrice`.
- **Session venue:** `POST /api/events/:eventId/sub-events` requires `venue` (any text up to 255: a name from the venues
  list or a custom place such as a classroom), stored in `sub_events.venue`. Events' `location` is likewise free text, so
  the forms offer the venue list plus "Other" to type one.
- **Team size:** `sub_events.team_size` (default 1). 1 behaves exactly as before (book alone or with friends). Above 1 makes
  a team competition: `teamName` is required, a booking holds at most `teamSize` people, and a student may book alone
  under a team name (a team of one).
- **Auto-grouping:** takes CONFIRMED + VERIFIED bookings not grouped yet, keeps full teams whole, and couples short ones
  into exact full teams (subset sum, largest short teams first). Example: Team A (2) + Team B (1) = one team of 3. The result
  goes in `sub_event_bookings.group_id` / `group_name`; `team_id` (the booking and payment unit) never changes. Leftovers
  stay booked and ungrouped; the response lists them with `leftoverEmails` and the message "Sorry, not enough teammates
  to fulfill the team size requirement." Pending payments are listed as `awaitingPayment`. Re-running only places
  newcomers and leftovers. Rebooking after a cancellation clears the row's group.

## 5. Live tests

Four end-to-end suites (301 checks) in `backend/tests/live/` start the real app and call it over HTTP against a real Neon database.
Run them before every deployment:
```bash
cd backend
npm run test:live
```
- `registrations-payments.mjs`: team registration, payment proof, event-head scope, capacity and refund overflow,
  main tickets, re-registering, reject-remaining, and race conditions.
- `sub-events.mjs`: sub-events and pass-holder pricing, bookings and their payments, master tickets, check-in at the
  main gate and sub-events, analytics, refunds, sub-event reject-remaining and capacity editing, and race conditions.
- `auth-extras.mjs`: signup name, forgot and reset password (single use, expiry, replaced links, rate limit, no
  account enumeration), Google sign-in guards (not configured, missing and forged tokens), and seat availability.
  The real Google popup can only be tested by hand with a Firebase project.
- `teams-venues.mjs`: venues, UPI QR and banner uploads, event schedules, UPI ID and payee name, team registration
  rules, deleting events and sessions, team-competition sessions and auto-grouping, the check-in log, refunds, editing
  events, and the attendee CSV export.

Each prints PASS/FAIL per check and exits with code 1 if anything fails. They create temporary users and events (emails
ending in `@example.invalid`, titles starting `FINAL TEST`, `SUB TEST` or `AUTH TEST`) and delete them at the end, even when a check
fails. If a run is killed midway, delete those rows by hand.

**Which database:** `TEST_DATABASE_URL` if set, otherwise `DATABASE_URL`; the first line printed shows the host. Prefer a
Neon branch of production (Neon console → Branches → create, copy its connection string) so test rows never appear in
the real database, even briefly. Needs `JWT_SECRET` and `QR_SECRET` from `.env`. `auth-extras.mjs` calls Cloudflare Turnstile; the suites always use the test secret (`1x0000000000000000000000000000000AA`), whatever `.env` holds.

## 6. Security checklist
helmet headers, CORS allow-list with `credentials: true`, JSON body limit 100 kB, httpOnly + `secure` +
`sameSite` cookie, JWT pinned to HS256, user re-checked in the database on every request, bcrypt cost 12, parameterised
queries (Drizzle never concatenates values into SQL), 500 errors never reveal internals, rate limit and Turnstile CAPTCHA on register and login. Still to add:
request validation library (e.g. Zod) for the other modules, and a CSRF token if the frontend and API are served from different sites.
