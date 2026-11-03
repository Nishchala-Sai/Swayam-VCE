import { pgTable, pgEnum, uuid, varchar, text, integer, boolean, timestamp, jsonb, index, uniqueIndex, check, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const userRole = pgEnum('user_role', ['STUDENT', 'ADMIN', 'EVENT_HEAD'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  // Display name, optional: set at signup (PATCH /api/auth/me) or from the Google account
  name: varchar('name', { length: 100 }),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: userRole('role').notNull().default('STUDENT'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// price is in whole rupees; 0 means a free event. upiQrUrl, upiId, upiPayeeName and paymentInstructions are only used
// when the event or its sessions cost money.
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    date: timestamp('date', { withTimezone: true }).notNull(),
    location: varchar('location', { length: 255 }).notNull(),
    capacity: integer('capacity').notNull(),
    price: integer('price').notNull().default(0),
    // Optional group offer (e.g. 5+2): a team of exactly groupSize people pays groupPrice in total instead of
    // price per person. Both set or both null; groupPrice is always below price x groupSize.
    groupSize: integer('group_size'),
    groupPrice: integer('group_price'),
    // Team registration: null = individuals only, unless the event has a group offer (then teams of up to groupSize).
    // Otherwise the most people a team may have, the leader included (2 to 11).
    maxTeamSize: integer('max_team_size'),
    upiQrUrl: varchar('upi_qr_url', { length: 2048 }),
    // Optional: the UPI ID students can pay to (e.g. swayam@okaxis) and the name their UPI app should show for it
    upiId: varchar('upi_id', { length: 100 }),
    upiPayeeName: varchar('upi_payee_name', { length: 100 }),
    paymentInstructions: text('payment_instructions'),
    // Optional wide image shown at the top of the event page: an upload (POST /api/uploads/banner) or an https link
    bannerUrl: varchar('banner_url', { length: 2048 }),
    // Optional day-by-day timetable: [{ date: 'YYYY-MM-DD', slots: [{ start: 'HH:MM', end: 'HH:MM', title, kind }] }],
    // kind 'session' or 'break'. Validated in events.controller.js; date above stays the event's start.
    schedule: jsonb('schedule'),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('events_date_idx').on(t.date),
    check('events_capacity_positive', sql`${t.capacity} > 0`),
    check('events_price_non_negative', sql`${t.price} >= 0`),
    check('events_group_offer', sql`(${t.groupSize} is null) = (${t.groupPrice} is null)`),
  ],
)

export const registrationStatus = pgEnum('registration_status', ['CONFIRMED', 'CANCELLED'])
// REFUND_REQUIRED: the student paid but there was no seat for them (event full when approved, or closed early).
// REFUNDED: staff have sent that money back.
export const paymentStatus = pgEnum('payment_status', ['PENDING', 'VERIFIED', 'REJECTED', 'REFUND_REQUIRED', 'REFUNDED'])

// A CONFIRMED registration holds a seat, whatever its paymentStatus. Free events are inserted as VERIFIED.
// A team is one row per member sharing a teamId. Only the leader's row carries the UTR, screenshot and teammateEmails;
// payment decisions on the leader's row apply to every row in the team.
export const registrations = pgTable(
  'registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    eventId: uuid('event_id').notNull().references(() => events.id),
    status: registrationStatus('status').notNull().default('CONFIRMED'),
    paymentStatus: paymentStatus('payment_status').notNull().default('PENDING'),
    utrNumber: varchar('utr_number', { length: 32 }).unique(), // one UPI transaction can't pay for two seats
    paymentScreenshotUrl: varchar('payment_screenshot_url', { length: 2048 }),
    // Which admin approved or rejected the payment, and when
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    // teamId links the rows; teamName is only for display, since two teams may pick the same name
    teamId: uuid('team_id'),
    teamName: varchar('team_name', { length: 100 }),
    isGroupLeader: boolean('is_group_leader').notNull().default(false),
    teammateEmails: text('teammate_emails'), // comma separated, leader's row only
    // What the student says they paid in total (whole rupees), leader's or solo row only. Staff check it against the
    // screenshot and bank statement; it is never calculated from the price.
    totalAmountPaid: integer('total_amount_paid'),
    refundedBy: uuid('refunded_by').references(() => users.id),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    attendedAt: timestamp('attended_at', { withTimezone: true }), // main-event check-in
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('registrations_user_event_unique').on(t.userId, t.eventId),
    index('registrations_event_status_idx').on(t.eventId, t.status), // seat counting
    index('registrations_team_idx').on(t.teamId),
  ],
)

// A bookable part of an event (workshop, hackathon, auction) with its own seats and prices. Students with a VERIFIED
// main-event registration pay priceForPassHolders; everyone else pays priceForStandalone.
export const subEvents = pgTable(
  'sub_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull().references(() => events.id),
    title: varchar('title', { length: 200 }).notNull(),
    capacity: integer('capacity').notNull(),
    priceForPassHolders: integer('price_for_pass_holders').notNull().default(0),
    priceForStandalone: integer('price_for_standalone').notNull().default(0),
    startTime: timestamp('start_time', { withTimezone: true }),
    // Optional; lets students be warned when two things they book overlap. Needs startTime.
    endTime: timestamp('end_time', { withTimezone: true }),
    // Where the session happens: a name from the venues list or any custom place (a classroom). Required for new
    // sessions; null only on sessions created before venues existed.
    venue: varchar('venue', { length: 255 }),
    // People per competing team. 1 (or null): booked as before, alone or with friends. Above 1: a team competition,
    // where every booking needs a team name, holds at most teamSize people, and staff can auto-group short teams.
    teamSize: integer('team_size').default(1),
    // Only students with a confirmed (paid-up) ticket for the main event can book; there is no standalone price then
    passHoldersOnly: boolean('pass_holders_only').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sub_events_event_idx').on(t.eventId),
    check('sub_events_team_size_positive', sql`${t.teamSize} is null or ${t.teamSize} >= 1`),
    check('sub_events_capacity_positive', sql`${t.capacity} > 0`),
    check('sub_events_prices_non_negative', sql`${t.priceForPassHolders} >= 0 and ${t.priceForStandalone} >= 0`),
  ],
)

// Same shape and rules as registrations (status, payment, teams, reactivation), one row per student per sub-event.
// registrationId links a pass holder's main registration; it is null for standalone bookings.
export const subEventBookings = pgTable(
  'sub_event_bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    registrationId: uuid('registration_id').references(() => registrations.id),
    subEventId: uuid('sub_event_id').notNull().references(() => subEvents.id),
    status: registrationStatus('status').notNull().default('CONFIRMED'),
    paymentStatus: paymentStatus('payment_status').notNull().default('PENDING'),
    isPassHolder: boolean('is_pass_holder').notNull().default(false),
    utrNumber: varchar('utr_number', { length: 32 }).unique(),
    paymentScreenshotUrl: varchar('payment_screenshot_url', { length: 2048 }),
    totalAmountPaid: integer('total_amount_paid'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    refundedBy: uuid('refunded_by').references(() => users.id),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    teamId: uuid('team_id'),
    teamName: varchar('team_name', { length: 100 }),
    isGroupLeader: boolean('is_group_leader').notNull().default(false),
    teammateEmails: text('teammate_emails'),
    // The competing team after auto-grouping (POST .../auto-group). Kept apart from teamId, which is the booking and
    // payment unit, so grouping never changes who pays or what staff approve.
    groupId: uuid('group_id'),
    groupName: varchar('group_name', { length: 150 }),
    groupedAt: timestamp('grouped_at', { withTimezone: true }),
    attendedAt: timestamp('attended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('sub_event_bookings_user_sub_event_unique').on(t.userId, t.subEventId),
    index('sub_event_bookings_group_idx').on(t.subEventId, t.groupId),
    index('sub_event_bookings_sub_event_status_idx').on(t.subEventId, t.status),
    index('sub_event_bookings_team_idx').on(t.teamId),
    index('sub_event_bookings_registration_idx').on(t.registrationId),
  ],
)

// Venues staff pick from when creating an event. Events store the venue's name, so deleting a venue never changes
// existing events. Names are unique ignoring case.
export const venues = pgTable(
  'venues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('venues_name_lower_unique').on(sql`lower(${t.name})`)],
)

// One row per outstanding password-reset link. Only the SHA-256 of the token is stored, so a database leak can't be
// used to reset passwords. A row is deleted when it is used, and all of a user's rows when a new link is requested.
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('password_reset_tokens_user_idx').on(t.userId)],
)
