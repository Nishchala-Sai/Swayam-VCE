# Changelog

## v3.7 (November 2026): Google-only sign-in, no email, live registrations
- Sign-in is Google only. Password registration, login and reset are removed (their endpoints answer 404, old page
  links go to `/login`), along with Cloudflare Turnstile and bcrypt. Accounts that had a password are reached by signing
  in with Google on the same email. The sign-in page warns when it is opened inside Instagram or similar apps.
- Emergency sign-in: `npm run login-link -- <email>` (Render's Shell) prints a 10-minute link (`GET /api/auth/link`).
- No email: the Brevo module, the payment-approved emails and nodemailer are removed. Students see approvals and
  rejections at the top of their dashboard, and the ticket page has Download ticket (a PNG that works offline).
- Student details required: phone, roll number, branch and year (`users.phone`, `roll_number`, `branch`, `year`),
  asked on `/welcome` after the first sign-in and editable on the profile. Registering, booking and being added as a
  teammate need them. The CSV export includes them.
- Live Registrations tab per event (`GET /api/events/:eventId/registrations`): refreshed every 15 seconds, sortable,
  searchable and filterable, with Download Excel (`write-excel-file`, a second sheet of session bookings) and Copy phone
  numbers for WhatsApp. Admins get All students (`GET /api/analytics/students`).
- Migrations `0001_google_only_sign_in` (drops `password_reset_tokens`, clears and relaxes `users.password_hash`) and
  `0002_student_profile`.
- Environment: `TURNSTILE_SECRET`, `BREVO_SMTP_USER`, `BREVO_SMTP_PASS`, `EMAIL_FROM` and `VITE_TURNSTILE_SITE_KEY`
  are no longer used; the server no longer requires `TURNSTILE_SECRET` to start.
- Live tests: 316 checks in 4 suites.

## v3.6 (November 2026): banners, CSV export, per-event UPI, Brevo
- Event banners: optional image uploaded in the event form (`POST /api/uploads/banner`, Cloudinary, up to 5 MB),
  shown at the top of the event page. New column `events.banner_url`.
- Attendee CSV export: `GET /api/events/:eventId/export` (admins, event heads for their own events) and a Download CSV
  button in the Analytics tab. Name, email, registration code, payment status, check-in time or Not Attended.
- UPI ID and payee name per event (`events.upi_id`, `events.upi_payee_name`), set in the event form and shown on the
  event page and in the payment step with a copy button. `UPI_ID` and `UPI_PAYEE_NAME` removed from the environment.
- Email switched from Resend to Brevo SMTP (nodemailer, `smtp-relay.brevo.com:587`): `BREVO_SMTP_USER`,
  `BREVO_SMTP_PASS`, `EMAIL_FROM`. `RESEND_API_KEY` removed.
- The old three-service backend (`backend/services/`) moved out of the repo to `Desktop/swayam-archive/`.
- Live tests: 301 checks in 4 suites. The suites always use Cloudflare's test Turnstile secret.
- Versioned migrations: `drizzle/0000_init.sql`, `npm run db:generate` / `db:migrate` replace `db:push`. The existing
  Neon database is baselined (`npm run db:baseline`). `drizzle-kit` is now a runtime dependency so Render can migrate on start.
- Deployment: `frontend/vercel.json` (proxies `/api` to Render, SPA fallback) and `docs/DEPLOYMENT.md`.

## v3.5 (October 2026): launch fixes and analytics
- Uploaded QR images go to Cloudinary (CLOUDINARY_URL); local disk only in development.
- Emails through Resend: password reset links, and "your ticket is ready" when a payment is approved.
- Edit event (staff dashboards), a Refunds tab to mark refund-due payments as refunded.
- Analytics tab per event: revenue, tickets sold, check-ins, the check-in log (search, CSV export, auto-refresh) and
  booked vs attended per session with team lists.

## v3.4 (October 2026): deleting, and teams only where allowed
- Events and sessions can be deleted (type the name to confirm). Event heads: only while nobody has registered. Admins:
  also with registrations, which are removed with their payment records.
- Team registration only on events that allow it ("Allow team registration, up to N people") or have a group offer.

## v3.3 (October 2026): event setup polish
- Schedule slots move up and down (swapping places in the timeline, keeping their lengths).
- Sessions can be edited, and can be limited to students with a confirmed event ticket.
- Group price always visible in the event form; with a group offer, teams are capped at the group size.
- Team forms make clear the leader is counted and books for everyone; teammates see who registered or booked for them.

## v3.2 (October 2026): event setup and team competitions
- Create-event form: venue dropdown (admin-managed venues), day-by-day schedule builder with breaks and any times, UPI QR
  image upload (multer; replaces the URL field). Event heads can create events too. Live event pages show the schedule.
- Sessions take a team size. Team sessions are booked under a team name with up to that many people; staff see the roster
  and auto-group short teams into full ones, with a notice for students left without enough teammates.
- Backend: `venues` table, `events.schedule`, `sub_events.team_size`, booking `group_id`/`group_name`; new venues,
  uploads, auto-group and teams endpoints. New live suite `teams-venues.mjs` (60 checks).

## v3.1 (October 2026): dashboards
- `/dashboard` is role-based. Students: pending payments, upcoming events with the master QR ticket, session bookings,
  past events attended. Event heads: their events with a pending-payments table (approve or reject UTRs, amount
  mismatches flagged), sessions (add, change capacity) and the scanner. Admins: club-wide analytics, every event with
  its own analytics, and a create-event form.
- Home: upcoming events directly under the hero; Our Vision in Action is a compact right-to-left marquee of event photo
  cards; Voices from the stage only appears once speakers have a photo and LinkedIn link.
- Backend: `npm run db:seed` creates the admin, manager and student test accounts. No API changes.

## v3.0 (October 2026): PERN rebuild
- Project consolidated into one repository with its git history; clutter moved to `Desktop/swayam-archive/`.
- Frontend re-skinned to the black and amber design (Bricolage Grotesque, DM Sans): new home, events with tabs, filters and
  expandable rows, event pages with galleries and prizes, about and wing pages, auth, password reset, My tickets, ticket,
  profile and 404 pages. Logo intro, star background, Framer Motion and Lenis removed.
- Frontend connected to the API: real accounts, live events with seat bars, registration with manual UPI payment, master QR tickets.
- Backend: single Express API on Neon with Drizzle (replacing the three services): auth with Turnstile and rate limits,
  events, solo and team registrations, sub-events, manual UPI payments with refund overflow and refunds, check-in, analytics,
  Sign in with Google (Firebase token verification), password reset, profile name, public seat availability.
- Tests: 3 live backend suites (154 checks), frontend data and rendering checks (56 routes).

## v2.0 (backend)
- auth_service: spec roles (STUDENT, EVENT_HEAD, CLUB_HEAD, SUPER_ADMIN), `is_active` suspension, SUPER_ADMIN bootstrap by
  email, role and active-status endpoints with an append-only audit log, helmet, rate limits, internal user lookup.
- core-service: registrations with row-locked seat counting and 10-minute holds for paid events, signed QR tickets,
  atomic check-in, certificates with public verification, analytics, attendee lists, registration fee on events,
  drafts hidden from the public, Zod validation, security headers, rate limits, internal API for payments.
- payment-service (was empty): Razorpay orders, raw-body signed webhook with idempotency and locking, amount checks,
  failed-payment seat release, automatic refund when a late payment finds no seat, SUPER_ADMIN refunds, mock gateway.
- Fixed the migration runners (silent failures, auth filename column too short).
- Added end-to-end tests (`backend/tests`, 29 tests against PostgreSQL), `.env.example` files, Dockerfiles,
  `backend/docker-compose.yml`, `docs/BACKEND.md`, and the latest `docs/CONTRIBUTING.md` and `docs/GITHUB_ISSUES.md`.

## v1.6
- Removed the "Join the club" button and the scroll hint text from the hero.

## v1.5
- Removed the transparent logo image (wordmark text is used instead) and the favicon.
- Removed galaxy, nebulae and planets. Kept drifting stars, scroll-speed warp streaks, cursor sparks and scroll animation.
- Added faint animated mathematical patterns: hexagonal tessellation with a wave and cursor glow, and two rotating Sierpinski fractals.
- Removed the Dystopian Canticle font everywhere. Added `docs/GITHUB_ISSUES.md`.

## v1.4
- Gentler forward thrust: idle drift reduced, speed now follows scroll velocity.
- Six pixel planets of different types along the scroll journey. Depth and warp readout removed.
- Logo added (navbar, footer, hero, favicon). More font variety across all pages. Docs folder added.
## v1.3
- Dark black theme. Galaxy travel with warp stars, nebulae and spiral galaxy. Fixed a body background that hid the galaxy. Stand-in Google Fonts. Manifesto section and HUD-style cards.
## v1.2
- Quote section removed. Fixed needing a refresh after navigation. Pixel galaxy background, brutalist cards, auto font loader.
## v1.1
- First build: Home, Events, Event detail, About with team, Auth, Student tickets, mock registration and QR tickets. Admin and leaderboard deliberately left out.
