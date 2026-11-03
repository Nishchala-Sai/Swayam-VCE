# Swayam-VCE

Website and event platform for **Swayam**, the Entrepreneurship Cell of Vasavi College of Engineering, Hyderabad.
Students sign in with Google, browse the event archive, register for upcoming events, pay by UPI, and get one QR
ticket per event, which they can save to their phone, that staff scan at the door. Black and amber design.

Staff manage live events from role-based dashboards on the site: event heads and admins create and edit events
(with banners and per-event UPI details), approve payments, handle refunds, scan tickets at the door, see analytics,
and follow registrations live in a spreadsheet view with student details that downloads as Excel. The site sends no
email: students see payment decisions on their dashboard, and the club reaches people over WhatsApp. Archive content
(past events, team, wings) is edited in code.

## Tech stack

**PERN**: PostgreSQL, Express, React, Node.js.

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5, React Router 6, plain CSS (one design system file), qrcode.react, write-excel-file |
| Backend | Node.js 20+, a single Express 5 API (ES modules) |
| Database | PostgreSQL on Neon (serverless), accessed with Drizzle ORM |
| Auth | Google only: Firebase verifies the Google account, then our own JWT in an httpOnly cookie. Emergency sign-in links printed on the server (`npm run login-link`) |
| Images | Cloudinary for uploaded UPI QR codes and event banners (local disk in development); multer |
| Payments | Manual UPI: the student pays the event's UPI QR or UPI ID and submits the UTR and amount; staff verify |

## Status

| Part | State |
|---|---|
| `frontend/` | Complete and connected to the API: home, events (upcoming, ongoing, past archive), event pages with banners, registration and UPI payment, about and the 8 wing pages, Google sign-in, first-sign-in profile form, My tickets with payment updates, QR ticket with PNG download, profile, staff dashboards with the live registrations sheet, door scanner, 404 |
| `backend/` | Complete: Google sign-in and emergency login links, required student profiles, events with banners and per-event UPI details, seat availability, solo and team registrations, sub-events with pass-holder pricing, manual UPI payments with refund overflow and refunds, master QR tickets and check-in, analytics, registrations data and attendee CSV export. 321 live end-to-end checks |

### Sign-in and student details

Sign-in is **Google only**; there are no passwords. After the first sign-in, students fill in their phone (WhatsApp)
number, roll number, branch and year on `/welcome`; the site asks again until they have, and registering needs them.
If Google sign-in is ever unavailable, an admin can still get in: run `npm run login-link -- you@gmail.com` on the
server (Render's Shell tab) and open the printed link within 10 minutes.

### No email

The site sends no email. Payment approvals and rejections show at the top of the student's dashboard, and the ticket
page has a **Download ticket** button that saves a PNG with the QR code, which works at the gate without internet.

### Live registrations and Excel

Every event has a **Registrations** tab: everyone registered, with phone, roll number, branch, year, payment status,
UTR, team, sessions and check-in time, refreshed every 15 seconds. Sort, search and filter it, then **Download Excel**
(that exact view, plus a sheet of session bookings) or **Copy phone numbers** for WhatsApp. Admins also have **All
students** (every account and the events it registered for).

### Event banners

Staff can upload a banner image (PNG, JPEG or WebP, up to 5 MB, ideally about 3:1) when creating or editing an event.
It is stored in Cloudinary (`POST /api/uploads/banner`) and shown across the top of the event page; events without one
keep the standard layout.

### Attendee CSV export

The **Download CSV** button in an event's Analytics tab (admins, and event heads for their own events) downloads
`GET /api/events/:eventId/export`: one row per registered student with name, email, phone, roll number, branch, year,
registration code, payment status and check-in time (IST), or `Not Attended`.

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
│   ├── scripts/               migrations, emergency login links, seed scripts for test accounts and demo data
│   └── tests/live/            end-to-end suites (npm run test:live)
└── frontend/
    ├── .env.example           copy to .env.local (API URL and Firebase web settings)
    ├── vercel.json            Vercel: /api proxied to the Render API, other paths to the single-page app
    ├── index.html             fonts, meta
    ├── vite.config.js         dev proxy: /api -> http://localhost:4000
    ├── scripts/               content and rendering checks (npm run check:data, check:render)
    └── src/
        ├── index.css          design tokens and every style
        ├── api/               API client
        ├── context/           signed-in user
        ├── lib/, hooks/       event model, live events, registrations, Google sign-in, profile rules,
        │                      ticket image, spreadsheet and Excel helpers
        ├── data/              static content: events.js (archive), site.js (club, team, wings)
        ├── assets/            event and team photos
        ├── components/        Navbar, Footer, EventRow, RegisterModal, QrTicket, ProfileForm, ...
        └── pages/             Home, Events, EventDetail, About, DepartmentDetail, Auth (sign in), Welcome,
                               Dashboard (incl. Registrations, Students), Ticket, Profile, NotFound
```

## Run it

Requires Node.js 20+ and a Neon database. Start the backend first; the site still shows the event archive without it.

```bash
# Backend (terminal 1)
cd backend
cp .env.example .env    # set DATABASE_URL, JWT_SECRET, QR_SECRET, FIREBASE_PROJECT_ID
npm install
npm run db:migrate      # create or update the tables in Neon (versioned migrations in backend/drizzle/)
npm run db:seed         # optional: test accounts admin@, manager@, student@swayam.com
npm run login-link -- admin@swayam.com   # prints a 10-minute sign-in link (no Google needed locally)
npm run dev             # http://localhost:4000/health

# Frontend (terminal 2)
cd frontend
npm install
npm run dev             # http://localhost:5173
```

Copy `frontend/.env.example` to `frontend/.env.local` and add the Firebase web settings for "Sign in with Google"
(the same project as `FIREBASE_PROJECT_ID` in `backend/.env`). Without them, sign in locally with `npm run login-link`.

## Database migrations

The schema is in `backend/src/db/schema.js` and changes ship as SQL migrations in `backend/drizzle/`:

```bash
cd backend
npm run db:generate -- --name what_changed   # after editing schema.js: writes drizzle/NNNN_what_changed.sql
npm run db:migrate                           # applies pending migrations (scripts/migrate.js)
```

Production runs `npm run db:migrate` on every start (see `docs/DEPLOYMENT.md`). The current Neon database was created
with `db:push` and has already been baselined (`npm run db:baseline`), so `0000_init` is recorded as applied there.
Don't use `drizzle-kit push` on production.

## Deployment

Backend on Render, frontend on Vercel (which proxies `/api` to Render). Step-by-step guide, environment variables and
the go-live checklist: `docs/DEPLOYMENT.md`.

## Checks

```bash
cd backend && npm run test:live      # 4 end-to-end suites (321 checks; 315 when Cloudinary is set) against Neon; run before every deployment
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
| Sign in | `/login` | Sign in with Google (also creates the account). Warns when opened inside Instagram or similar apps, where Google blocks sign-in. Old `/signup`, `/forgot-password` and `/reset-password` links land here |
| Welcome | `/welcome` | After the first sign-in: name, phone, roll number, branch and year. Required before anything else |
| Dashboard | `/dashboard` | By role. Student: payment updates, pending payments, upcoming events with master QR ticket, sessions, past events attended. Event head: their events with the live Registrations sheet, pending-payment approval, sessions and scanner. Admin: club-wide analytics, All students, every event, create and edit events, venues. Both staff roles: per-event analytics, Excel and CSV downloads, refunds |
| Ticket | `/tickets/:eventId` | The master QR code for an event, with Download ticket (PNG) and Print (signed in) |
| Profile | `/profile` | Student details (editable), email, role; upcoming events with QR codes; past events attended (signed in) |
| Door scanner | `/admin/scan` | Staff only (ADMIN, EVENT_HEAD): camera QR check-in at the main entrance or a session, with a full-screen green or red result |

## Editing content

Club details and contact, team, wings and the Vision in Action stages are in `frontend/src/data/site.js`; the event archive is in
`frontend/src/data/events.js`. Live events are created through the API. Full guide: `docs/CONTENT_GUIDE.md`.

## Documentation

| File | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | How the pieces fit: frontend structure and routes, auth flow, UPI flow, tickets and check-in |
| `docs/BACKEND.md` | Backend setup, environment variables, database and migrations, every API endpoint, Google sign-in and login links, tests |
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
