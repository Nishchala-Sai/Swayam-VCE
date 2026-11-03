# Swayam-VCE

Website and event platform for **Swayam**, the Entrepreneurship Cell of Vasavi College of Engineering, Hyderabad.
Students browse the event archive, register for upcoming events, pay by UPI, and get one QR ticket per event that
staff scan at the door. Black and amber design.

Staff manage live events from role-based dashboards on the site: event heads and admins create and edit events
(with banners and per-event UPI details), approve payments, handle refunds, scan tickets at the door, see analytics
and download attendee lists as CSV. Archive content (past events, team, wings) is edited in code.

## Tech stack

**PERN**: PostgreSQL, Express, React, Node.js.

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5, React Router 6, plain CSS (one design system file), qrcode.react |
| Backend | Node.js 20+, a single Express 5 API (ES modules) |
| Database | PostgreSQL on Neon (serverless), accessed with Drizzle ORM |
| Auth | Custom JWT in an httpOnly cookie, bcrypt; Sign in with Google (Firebase verifies the Google account); password reset links; Cloudflare Turnstile |
| Images | Cloudinary for uploaded UPI QR codes and event banners (local disk in development); multer |
| Email | Brevo SMTP through nodemailer: password reset links and "ticket ready" emails |
| Payments | Manual UPI: the student pays the event's UPI QR or UPI ID and submits the UTR and amount; staff verify |

## Status

| Part | State |
|---|---|
| `frontend/` | Complete and connected to the API: home, events (upcoming, ongoing, past archive), event pages with banners, registration and UPI payment, about and the 8 wing pages, login and signup (with Google), forgot and reset password, My tickets, QR ticket, profile, staff dashboards, door scanner, 404 |
| `backend/` | Complete: auth (password, Google, emailed password reset), events with banners and per-event UPI details, seat availability, solo and team registrations, sub-events with pass-holder pricing, manual UPI payments with refund overflow and refunds, master QR tickets and check-in, analytics and attendee CSV export. 301 live end-to-end checks |

Password-reset links and "ticket ready" emails are sent through Brevo SMTP; without the Brevo settings they are printed
in the server terminal instead. Before launch: set the Brevo SMTP login and a verified `EMAIL_FROM`, add a real Firebase
project for Google sign-in, use production Turnstile keys, and set `CLOUDINARY_URL`. See `docs/BACKEND.md`.

### Event banners

Staff can upload a banner image (PNG, JPEG or WebP, up to 5 MB, ideally about 3:1) when creating or editing an event.
It is stored in Cloudinary (`POST /api/uploads/banner`) and shown across the top of the event page; events without one
keep the standard layout.

### Attendee CSV export

The **Download CSV** button in an event's Analytics tab (admins, and event heads for their own events) downloads
`GET /api/events/:eventId/export`: one row per registered student with name, email, registration code, payment status
and check-in time (IST), or `Not Attended`.

### UPI details per event

Each event carries its own UPI QR code, UPI ID and payee name, set in the event form. Students see them on the event
page and in the payment step, so different events can collect money into different accounts.

## Repository layout

```
Swayam-VCE/
├── README.md
├── docs/                      documentation (see table below)
│   ├── design/                the reference design mock-up
│   ├── events/                original event reports (PDF, Word) behind the archive
│   └── research/              research notes and the saved official VCE page
├── scripts/content/           Python scripts that built the event archive from the reports
├── backend/                   Express API
│   ├── .env.example           copy to .env; never commit .env
│   ├── drizzle/               SQL migrations (npm run db:generate, db:migrate)
│   ├── src/                   server.js, app.js, db/, middleware/, utils/, modules/
│   ├── scripts/               seed scripts for test accounts and demo data
│   └── tests/live/            end-to-end suites (npm run test:live)
└── frontend/
    ├── .env.example           copy to .env.local (API URL, Turnstile and Firebase web settings)
    ├── vercel.json            Vercel: /api proxied to the Render API, other paths to the single-page app
    ├── index.html             fonts, meta
    ├── vite.config.js         dev proxy: /api -> http://localhost:4000
    ├── scripts/               content and rendering checks (npm run check:data, check:render)
    └── src/
        ├── index.css          design tokens and every style
        ├── api/               API client
        ├── context/           signed-in user
        ├── lib/, hooks/       event model, live events, registrations, Google sign-in
        ├── data/              static content: events.js (archive), site.js (club, team, wings)
        ├── assets/            event and team photos
        ├── components/        Navbar, Footer, EventRow, RegisterModal, QrTicket, Turnstile, ...
        └── pages/             Home, Events, EventDetail, About, DepartmentDetail, Auth, ForgotPassword,
                               ResetPassword, Dashboard, Ticket, Profile, NotFound
```

## Run it

Requires Node.js 20+ and a Neon database. Start the backend first; the site still shows the event archive without it.

```bash
# Backend (terminal 1)
cd backend
cp .env.example .env    # set DATABASE_URL, JWT_SECRET, QR_SECRET (TURNSTILE_SECRET test key is pre-filled)
npm install
npm run db:migrate      # create or update the tables in Neon (versioned migrations in backend/drizzle/)
npm run db:seed         # optional: test logins admin@, manager@, student@swayam.com (password Password123!)
npm run dev             # http://localhost:4000/health

# Frontend (terminal 2)
cd frontend
npm install
npm run dev             # http://localhost:5173
```

Optional: copy `frontend/.env.example` to `frontend/.env.local` and add the Firebase web settings to turn on
"Sign in with Google" (also set `FIREBASE_PROJECT_ID` in `backend/.env`).

## Database migrations

The schema is in `backend/src/db/schema.js` and changes ship as SQL migrations in `backend/drizzle/`:

```bash
cd backend
npm run db:generate -- --name what_changed   # after editing schema.js: writes drizzle/NNNN_what_changed.sql
npm run db:migrate                           # applies pending migrations (npx drizzle-kit migrate)
```

Production runs `npm run db:migrate` on every start (see `docs/DEPLOYMENT.md`). The current Neon database was created
with `db:push` and has already been baselined (`npm run db:baseline`), so `0000_init` is recorded as applied there.
Don't use `drizzle-kit push` on production.

## Deployment

Backend on Render, frontend on Vercel (which proxies `/api` to Render). Step-by-step guide, environment variables and
the go-live checklist: `docs/DEPLOYMENT.md`.

## Checks

```bash
cd backend && npm run test:live      # 4 end-to-end suites (301 checks) against Neon; run before every deployment
cd frontend && npm run check:data    # event archive integrity and search
cd frontend && npm run check:render  # every page renders with its content
cd frontend && npm run build         # production build in frontend/dist
```

## Pages

| Page | Route | Purpose |
|---|---|---|
| Home | `/` | Hero, Our Vision in Action (8 stages linked to the events behind them), event strip, what we do, speakers, partner with us |
| Events | `/events`, `/events/upcoming`, `/events/ongoing`, `/events/past` | Tabs, search, category and price filters, expandable rows with seat bars |
| Event | `/events/:id` | Archive: about, schedule, activities, prizes and winners, gallery, report links. Live: details, seats, solo or team registration, UPI payment proof, and bookable sessions |
| About | `/about` | Story, vision and mission, journey by year, faculty, leadership, the 8 wings |
| Wing | `/teams/:id` | Heads, responsibilities, selected work |
| Log in, Sign up | `/login`, `/signup` | Email and password with CAPTCHA, or Google |
| Password reset | `/forgot-password`, `/reset-password?token=…` | Request a link, set a new password |
| Dashboard | `/dashboard` | By role. Student: pending payments, upcoming events with master QR ticket, sessions, past events attended. Event head: their events with pending-payment approval, sessions and scanner. Admin: club-wide analytics, every event, create and edit events, venues. Both staff roles: per-event analytics with the attendee CSV download, refunds |
| Ticket | `/tickets/:eventId` | The master QR code for an event (signed in) |
| Profile | `/profile` | Name, email, role; upcoming events with QR codes; past events attended (signed in) |
| Door scanner | `/admin/scan` | Staff only (ADMIN, EVENT_HEAD): camera QR check-in at the main entrance or a session, with a full-screen green or red result |

## Editing content

Club details and contact, team, wings and the Vision in Action stages are in `frontend/src/data/site.js`; the event archive is in
`frontend/src/data/events.js`. Live events are created through the API. Full guide: `docs/CONTENT_GUIDE.md`.

## Documentation

| File | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | How the pieces fit: frontend structure and routes, auth flow, UPI flow, tickets and check-in |
| `docs/BACKEND.md` | Backend setup, environment variables, database and migrations, every API endpoint, Google sign-in, password reset, tests |
| `docs/DEPLOYMENT.md` | Deploying to Render and Vercel, production environment variables, go-live checklist |
| `docs/DESIGN_SYSTEM.md` | Colours, typography, layout, components, motion, accessibility |
| `docs/FONTS.md` | The two Google Fonts |
| `docs/CONTENT_GUIDE.md` | How to edit the archive, team, wings and home page content |
| `docs/EVENT_SOURCE_INTEGRITY_AUDIT.md` | Which archive facts come from which official source |
| `docs/TROUBLESHOOTING.md` | Common problems and fixes |
| `docs/CONTRIBUTING.md` | Branches, commits, pull requests, style |
| `docs/GITHUB_ISSUES.md` | Ready-to-paste issues with labels |
| `docs/PROJECT_PLAN.md` | **Historical.** The original Next.js + NestJS plan; not the current design |
| `docs/CHANGELOG.md` | Version history |

## Contributing

Read `docs/CONTRIBUTING.md` before you start. In short: pick an issue, branch from `main`, open a pull request that
closes the issue, and get a review before merging.
