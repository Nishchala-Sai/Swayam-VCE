# Architecture

## Overview
Swayam runs on a **PERN** stack: **P**ostgreSQL (hosted on Neon), **E**xpress, **R**eact, **N**ode.js.

```
Browser (React + Vite SPA)
   │  fetch(..., { credentials: 'include' })       httpOnly cookie "token" (JWT) sent automatically
   ▼
Express API (backend/, one Node.js process)
   │  Drizzle ORM over HTTPS (drizzle-orm/neon-http)
   ▼
Neon serverless PostgreSQL
```

- **Frontend** (`frontend/`): a single-page React app built with Vite. Documented past events, the team and club
  content are static data in the app (`src/data/`); live events, registrations, payments, tickets and accounts come
  from the API.
- **Backend** (`backend/`): **one** Express API. No microservices and no payment gateway. Firebase is used only to
  verify "Sign in with Google" tokens; sessions and data stay in our API.
- **Database**: Neon serverless PostgreSQL, accessed only through Drizzle ORM. The schema is defined in code
  (`backend/src/db/schema.js`) and applied with versioned migrations in `backend/drizzle/` (`npm run db:migrate`).

Paths starting with `src/` in the frontend sections below refer to `frontend/src/`.

## Frontend

### Stack
React 18, Vite 5, React Router 6, qrcode.react (ticket QR codes), html5-qrcode (door-scanner camera), Firebase Web SDK (Google sign-in only, loaded on
click), Cloudflare Turnstile (CAPTCHA on login, signup and forgot password). Plain CSS, no framework: one
`src/index.css` with design tokens and component classes, and no inline styles apart from computed values (seat-bar
width). Design: `docs/DESIGN_SYSTEM.md`; the reference mock-up is `docs/design/swayam-ecell-design.html`.

### Two kinds of events
| | Archive events | Live events |
|---|---|---|
| Source | `src/data/events.js` (28 documented events with photos, reports, winners) | `GET /api/events` and `GET /api/events/availability` |
| URL | `/events/<slug>` | `/events/<uuid>` |
| Registration | No (they have ended) | Yes: free, or manual UPI payment |

`src/lib/events.js` turns both into one shape (name, date, venue, fee, seats, phase), so lists, filters and the
Upcoming / Ongoing / Past tabs treat them the same. A live event counts as "ongoing" for 12 hours after it starts.

### Folder map
| Path | Responsibility |
|---|---|
| `src/main.jsx`, `src/App.jsx` | Entry; routes, protected routes, scroll handling, site shell |
| `src/index.css` | Design tokens and every style, in numbered sections |
| `src/api/client.js` | `api()`: every backend call (cookie included; errors become `ApiError` with the server's message) |
| `src/context/auth.jsx` | Signed-in user from `GET /api/auth/me`; login, signup, Google, logout, name update |
| `src/lib/events.js` | Archive + live event model, phases, filters, date and price formatting |
| `src/lib/firebase.js` | Google popup → Firebase ID token |
| `src/hooks/` | `useLiveEvents` (shared, cached live events with seats), `useMyRegistrations` (plus plain-language status) |
| `src/data/` | Static content: `events.js` (archive) and `site.js` (club and contact, team, wings, Vision in Action stages, voices; `sponsors` and `faq` stay hidden while empty) |
| `src/components/` | Navbar, Footer, Spotlight (cursor light), EventRow, EventFrame, RegisterModal (solo or team registration), PaymentForm (manual UPI proof, shared by registrations and bookings), SubEvents (session list and booking), QrTicket, Turnstile, GoogleButton, and `ui.jsx` (Modal, Pill, SeatBar, Alert, Empty, Crumbs) |
| `src/pages/` | Home, Events, EventDetail, About, DepartmentDetail, Auth (Login, Signup), ForgotPassword, ResetPassword, Dashboard (picks the student, event-head or admin dashboard from `pages/dashboard/`), Ticket, Profile, Scanner (door scanner, loaded only when opened), NotFound |
| `scripts/` | Checks: `npm run check:data` (event data integrity, search) and `npm run check:render` (renders every route) |

### Routes
`/`, `/events` (shows upcoming), `/events/upcoming`, `/events/ongoing`, `/events/past`, `/events/:id`, `/about`,
`/teams/:departmentId`, `/login`, `/signup`, `/forgot-password`, `/reset-password?token=…`, and for signed-in users:
`/dashboard` (role-based dashboard; staff open one event with `?event=<id>&tab=overview|payments|sessions`, and their own tickets with `?view=tickets`), `/tickets/:eventId` (master QR code), `/profile`, and for `ADMIN` / `EVENT_HEAD` only:
`/admin/scan` (door scanner; other roles see a "no access" page). Anything else shows the 404 page.
Protected pages wait for the session check, then send logged-out visitors to `/login` and back afterwards.

### Development setup
Run `npm run dev` in `frontend/` with the backend running on port 4000. Vite proxies `/api` to it, so the site and
the API share an origin and the httpOnly cookie works without CORS. Settings go in `frontend/.env.local` (see
`frontend/.env.example`): `VITE_API_URL` for production, the Turnstile site key, and the Firebase web config.
In production, serve the site and the API from the same site (for example `swayam.example` and
`api.swayam.example`, which works with `sameSite: 'lax'`), or add a CSRF token if they are on different sites.

## Backend

### Folder structure
```
backend/
├── package.json            scripts: dev, start, db:generate, db:migrate, db:baseline, db:studio, db:seed, test:live
├── drizzle/                SQL migrations (0000_init.sql, ...) and their snapshots
├── drizzle.config.js       points drizzle-kit at src/db/schema.js and DATABASE_URL
├── .env.example            copy to .env (never commit .env)
└── src/
    ├── server.js           loads .env, checks required variables, starts the server
    ├── app.js              Express app: helmet, CORS (with credentials), JSON body, cookie-parser, routers, error handler
    ├── db/
    │   ├── index.js        Neon client + Drizzle `db` instance
    │   ├── schema.js       all tables and enums
    │   └── fragments.js    helpers for raw SQL: "can this user manage this event", snake_case → camelCase rows
    ├── utils/
    │   ├── verifyTurnstile.js  Cloudflare Turnstile CAPTCHA check
    │   ├── generateTicket.js   signed QR ticket payloads (generateTicket, verifyTicket)
    │   └── isUuid.js, isHttpsUrl.js  input checks
    ├── middleware/
    │   ├── requireAuth.js  JWT cookie → req.user (built)
    │   ├── rateLimiter.js  authLimiter: 10 requests / 15 min / IP on register and login (built)
    │   └── requireRole.js  role checks, e.g. requireRole(['ADMIN']) (built)
    └── modules/            one folder per feature
        ├── auth/           register, login, logout, me
        ├── events/         events (create, list, get, capacity) and subEvents.controller.js (sub-events, analytics)
        ├── registrations/  registrations, bookings.controller.js (sub-event bookings), checkin.controller.js
        │                   (QR scanning), team.js (team and amount input shared by registrations and bookings)
        ├── payments/       UPI proof, staff queue, approve/reject with refund overflow, refunds, reject remaining,
        │                   written once for both registrations and sub-event bookings
        └── analytics/      club-wide overview for admins
```
Each module has `<name>.routes.js` (Express router) and one or more controllers (validation, queries, response).
A module's router is mounted in `app.js`, for example `app.use('/api/auth', authRoutes)`. All routes live under `/api`.

Everything in the tree is built. Endpoints, bodies and error codes: `docs/BACKEND.md`.

### Roles
`STUDENT` (default for every signup), `EVENT_HEAD` (creates events; manages capacity, sub-events, payments, refunds,
check-in and analytics only for events they created), `ADMIN` (everything, plus the club-wide overview). The role is stored in the `users` table and read from the database on every request,
never from the token, so a role change or suspension takes effect immediately.

## Authentication: JWT in an httpOnly cookie
The API issues and checks its own tokens. "Sign in with Google" uses Firebase only to verify the Google account; the API then issues the same cookie (see `docs/BACKEND.md`).

1. **Signup** `POST /api/auth/register { email, password, turnstileToken }`: the password is hashed with bcrypt (`bcryptjs`) and stored as
   `users.password_hash`. The plain password is never stored or logged.
2. **Login** `POST /api/auth/login { email, password, turnstileToken }`: the API compares the password with the hash. On success it signs a JWT
   `{ sub: <user id> }` with `JWT_SECRET` (HS256, lifetime `JWT_EXPIRES_IN`) and sets it as a cookie:
   `token`, `httpOnly`, `secure` in production, `sameSite: 'lax'` (or `'none'` if frontend and API are on different
   sites), `path: '/'`. The token is never in the response body, so frontend JavaScript cannot read or leak it.
3. **Every request** the browser sends the cookie automatically (the frontend must use `credentials: 'include'`).
   `requireAuth` verifies the signature and expiry, loads the user from the database, rejects missing or deactivated
   users with 401, and sets `req.user` (`id, email, role, isActive, createdAt`, never the hash).
4. **Logout** `POST /api/auth/logout`: clears the cookie.

Because the browser sends cookies on its own, state-changing routes rely on `sameSite` plus the CORS allow-list
(`CORS_ORIGIN`) to stop cross-site request forgery. If the frontend and API end up on different sites
(`sameSite: 'none'`), add a CSRF token before launch.

## Payments: manual UPI
There is no payment gateway. Students pay the club directly by UPI and a person confirms each payment.

A registration has two separate fields: `status` (`CONFIRMED` or `CANCELLED`: does it hold a seat?) and
`paymentStatus` (`PENDING`, `VERIFIED`, `REJECTED`, `REFUND_REQUIRED` or `REFUNDED`: what happened to the money?).
Sub-event bookings follow exactly the same flow, against the sub-event's seats and prices.

1. A student registers for a paid event, alone or as the leader of a team (every teammate needs an account). Each
   member gets a row: `CONFIRMED` (the seat is held), `paymentStatus` `PENDING`.
2. The frontend shows the event's UPI QR image (`upiQrUrl`), `paymentInstructions` and the price.
3. The student (for a team, the leader) pays in any UPI app, then submits the 12-digit **UTR**, the **total amount they
   paid** (`totalAmountPaid`, never calculated by the server) and, optionally, a screenshot link. They can correct it
   while the payment is still `PENDING`.
4. An `ADMIN`, or the `EVENT_HEAD` who created the event, checks the UTR and amount against the club's bank statement:
   - **Approve:** if there is room among the verified seats, the whole team becomes `VERIFIED` and every member can get
     their QR ticket. If the event is already full of verified students (it sold out, or capacity was lowered), the team
     becomes `REFUND_REQUIRED` + `CANCELLED` instead, and the club refunds them.
   - **Reject:** `REJECTED` + `CANCELLED`. The seat is freed and the students may register again.
5. When registration closes, **reject remaining** cancels everything still `PENDING`: those who sent a UTR become
   `REFUND_REQUIRED`, those who never did become `REJECTED`.
6. Staff send refunds by UPI and mark them `REFUNDED`. After that the student may register again.

Rules: each UTR can be used once (across registrations and bookings), a payment can't be approved before a UTR and
`totalAmountPaid` are submitted, free events are `VERIFIED` straight away, and every decision and refund records who made
it and when. Seat checks and payment decisions lock the event (or sub-event) row, so simultaneous requests can't oversell
(tested against Neon).

## Sub-events, tickets and check-in
- **Sub-events** (workshops, hackathon, IPL auction) belong to an event and have their own capacity and two prices:
  `priceForPassHolders` for students with a verified main registration, `priceForStandalone` for everyone else.
  Students book them in advance, alone or as a team.
- **One master ticket per student per event**, a QR code signed with `QR_SECRET`. Students with a verified main
  registration get a MAIN pass (main event + every sub-event they booked). Students who only booked sub-events get a
  STANDALONE pass (only those sub-events). There are no separate sub-event tickets.
- **Check-in** is one scanner call: the staff app posts the QR content (plus the sub-event, if scanning at one) and the
  server verifies the signature, finds the student's registration or booking, checks payment, and records attendance.
  The scanner must be logged in as an `ADMIN` or `EVENT_HEAD` (the event's creator); see `docs/BACKEND.md`, Check-in.
- **Capacity and closing payments** work the same for events and sub-events: capacity can be changed any time, and
  reject-remaining cancels everything still `PENDING` (refund due if a UTR was sent, rejected otherwise).

**Still open:** a student who registers and never pays keeps the seat until staff reject it or run reject-remaining.

## Deliberate omissions
No admin pages in the public website, no leaderboard, no contact form. Content is edited in `src/data/site.js`. Admin
actions (event management, payment verification, roles) are API endpoints, used by the team's internal tools.
