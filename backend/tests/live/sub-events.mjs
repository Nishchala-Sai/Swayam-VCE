// Live suite 2: sub-events and pass-holder pricing, bookings and their payments, the one-pass master ticket, check-in
// at the main gate and sub-events, analytics, refunds, and race conditions. Run from backend/: npm run test:live
import { inArray, eq } from 'drizzle-orm'
import { db, schema, tickets, startServer, makeClient, makeChecker, PROFILE } from './helpers.mjs'

const { users, events, registrations, subEvents, subEventBookings } = schema
const { generateTicket, generateStandaloneTicket } = tickets
const tag = Date.now(), userIds = [], eventIds = []
const U = {}, E = {}, S = {}
const server = startServer()
const call = makeClient(server.api, U)
const { check, report } = makeChecker()
const mail = (n) => `sub+${tag}-${n}@example.invalid`
const scan = (body) => call('head1', 'POST', '/registrations/check-in', body)
let subIds = []
try {
  const people = [['admin', 'ADMIN'], ['head1', 'EVENT_HEAD'], ['head2', 'EVENT_HEAD'],
    ...['p1', 'p2', 's1', 's2', 's3', 's4', 'w1', 'nobody', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'c1', 'c2', 'c3', 'c4', 'c5', 'late'].map((n) => [n, 'STUDENT'])]
  const made = await db.insert(users).values(people.map(([n, role]) => ({ email: mail(n), name: `${n} T`, role, ...PROFILE }))).returning({ id: users.id, email: users.email })
  for (const [n] of people) { U[n] = made.find((u) => u.email === mail(n)).id; userIds.push(U[n]) }
  const evs = await db.insert(events).values([
    { title: `SUB TEST fest ${tag}`, description: 't', date: new Date(Date.now() + 864e5), location: 't', capacity: 50, price: 200, upiQrUrl: 'https://example.invalid/qr.png', createdBy: U.head1 },
    { title: `SUB TEST free ${tag}`, description: 't', date: new Date(Date.now() + 864e5), location: 't', capacity: 50, price: 0, createdBy: U.head2 },
  ]).returning({ id: events.id })
  E.fest = evs[0].id; E.free = evs[1].id; eventIds.push(E.fest, E.free)

  console.log('\n== Sub-event creation')
  let r = await call('head2', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'X', capacity: 5 }); check("head2 adds to head1's event -> 403", r.code === 403, r)
  r = await call('head2', 'POST', `/events/${E.free}/sub-events`, { venue: 'Test Room', title: 'X', capacity: 5, priceForStandalone: 100 }); check('priced sub-event on event without UPI QR -> 400', r.code === 400, r)
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'X', capacity: 0 }); check('capacity 0 -> 400', r.code === 400, r)
  r = await call('s1', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'X', capacity: 5 }); check('student -> 403', r.code === 403, r)
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'Hackathon', capacity: 4, priceForPassHolders: 500, priceForStandalone: 700, startTime: '2026-11-21T09:00:00+05:30' })
  check('create Hackathon (500 pass / 700 standalone)', r.code === 201 && r.body.data.priceForStandalone === 700, r); S.hack = r.body.data.id
  S.work = (await call('head1', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'Workshop', capacity: 10 })).body.data.id
  S.auction = (await call('head1', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'IPL Auction', capacity: 1, priceForPassHolders: 0, priceForStandalone: 300 })).body.data.id
  S.race = (await call('admin', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'Race', capacity: 3 })).body.data.id
  S.mini = (await call('head1', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'Mini', capacity: 2, priceForStandalone: 100 })).body.data.id
  r = await call(null, 'GET', `/events/${E.fest}/sub-events`); check('public list with seatsLeft', r.code === 200 && r.body.data.length === 5 && r.body.data[0].title === 'Hackathon' && r.body.data[0].seatsLeft === 4, r)

  console.log('\n== Main pass with totalAmountPaid')
  r = await call('p1', 'POST', `/registrations/${E.fest}`, { totalAmountPaid: 200 }); const regP1 = r.body.data.id
  check('register with totalAmountPaid stored', r.code === 201 && r.body.data.totalAmountPaid === 200, r)
  r = await call('p1', 'POST', `/payments/${regP1}/proof`, { utrNumber: '611111111101' }); check('proof without amount uses the stored one', r.code === 200 && r.body.data.totalAmountPaid === 200, r)
  r = await call('head1', 'PATCH', `/payments/${regP1}/verify`, { action: 'APPROVE' }); check('approve p1 main pass', r.body.data?.paymentStatus === 'VERIFIED', r)
  r = await call('p2', 'POST', `/registrations/${E.fest}`); const regP2 = r.body.data.id
  r = await call('p2', 'POST', `/payments/${regP2}/proof`, { utrNumber: '611111111102' }); check('proof with no amount anywhere -> 400', r.code === 400 && /totalAmountPaid/.test(r.body.message), r)
  r = await call('p2', 'POST', `/payments/${regP2}/proof`, { utrNumber: '611111111102', totalAmountPaid: 200 }); check('proof with amount', r.code === 200, r)

  console.log('\n== Booking')
  r = await call('p1', 'POST', '/registrations/book-sub-event', { subEventId: S.hack, teamName: 'Byte', teammateEmails: [mail('s1')], totalAmountPaid: 1200 })
  const hb = r.body.data
  check('pass holder books hackathon with standalone teammate: PENDING, priced 500 / 700', r.code === 201 && hb.paymentStatus === 'PENDING' && hb.isPassHolder && hb.registrationId === regP1 && hb.price === 500 && hb.teammates[0].price === 700 && !hb.teammates[0].isPassHolder && hb.totalAmountPaid === 1200 && hb.teammates[0].totalAmountPaid === null, r)
  r = await call('s2', 'POST', '/registrations/book-sub-event', { subEventId: S.work }); const wb = r.body.data
  check('free workshop: VERIFIED, no per-booking ticket', r.code === 201 && wb.paymentStatus === 'VERIFIED' && wb.ticket === undefined, r)
  r = await call('p1', 'POST', '/registrations/book-sub-event', { subEventId: S.auction }); check('auction free for pass holders: VERIFIED', r.code === 201 && r.body.data.paymentStatus === 'VERIFIED' && r.body.data.price === 0, r)
  r = await call('s3', 'POST', '/registrations/book-sub-event', { subEventId: S.auction }); check('auction full (capacity 1) -> 400', r.code === 400 && /full/.test(r.body.message), r)
  r = await call('s1', 'POST', '/registrations/book-sub-event', { subEventId: S.hack }); check('teammate books again -> 409', r.code === 409, r)
  r = await call('s1', 'POST', '/registrations/book-sub-event', { subEventId: 'nope' }); check('bad subEventId -> 400', r.code === 400, r)
  r = await call('s1', 'POST', '/registrations/book-sub-event', { subEventId: crypto.randomUUID() }); check('unknown sub-event -> 404', r.code === 404, r)
  r = await call('s1', 'POST', '/registrations/book-sub-event', { subEventId: S.work, totalAmountPaid: -1 }); check('negative totalAmountPaid -> 400', r.code === 400, r)

  console.log('\n== Booking payment')
  const s1Booking = hb.teammates[0].id
  r = await call('s1', 'POST', `/payments/sub-event-bookings/${s1Booking}/proof`, { utrNumber: '611111111103' }); check('teammate submits booking proof -> 403', r.code === 403, r)
  r = await call('p1', 'POST', `/payments/sub-event-bookings/${hb.id}/proof`, { utrNumber: '611111111101' }); check('UTR already used on a main registration -> 409', r.code === 409, r)
  r = await call('p1', 'POST', `/payments/sub-event-bookings/${hb.id}/proof`, { utrNumber: '611111111104' }); check('leader submits booking proof', r.code === 200, r)
  r = await call('s2', 'POST', `/payments/sub-event-bookings/${wb.id}/proof`, { utrNumber: '611111111105', totalAmountPaid: 0 }); check('proof on free booking -> 400', r.code === 400, r)
  r = await call('head2', 'GET', '/payments/sub-event-bookings/pending'); check("head2 queue excludes head1's bookings", r.code === 200 && !r.body.data.some((x) => x.id === hb.id), r)
  r = await call('head1', 'GET', '/payments/sub-event-bookings/pending'); const qb = r.body.data.find((x) => x.id === hb.id)
  check('head1 queue: team, teamSize 2, totalAmountPaid 1200, sub-event prices', qb && qb.teamSize === 2 && qb.totalAmountPaid === 1200 && qb.subEvent.priceForStandalone === 700 && qb.user.email === mail('p1'), r)
  r = await call('head2', 'PATCH', `/payments/sub-event-bookings/${hb.id}/verify`, { action: 'APPROVE' }); check('head2 verifies -> 403', r.code === 403, r)
  r = await call('head1', 'PATCH', `/payments/sub-event-bookings/${s1Booking}/verify`, { action: 'APPROVE' }); check('verify teammate booking -> 400', r.code === 400, r)
  r = await call('head1', 'PATCH', `/payments/sub-event-bookings/${hb.id}/verify`, { action: 'APPROVE' })
  check('approve team booking -> both VERIFIED', r.code === 200 && r.body.data.paymentStatus === 'VERIFIED' && r.body.data.teammates[0].paymentStatus === 'VERIFIED', r)
  r = await call('s1', 'GET', '/registrations/bookings/me'); check('teammate sees booking in bookings/me', r.code === 200 && r.body.data.some((b) => b.subEvent.title === 'Hackathon' && b.paymentStatus === 'VERIFIED' && b.event.id === E.fest), r)

  console.log('\n== Master ticket (one pass)')
  r = await call('p1', 'GET', `/registrations/events/${E.fest}/ticket`); const p1Ticket = r.body.data?.qrPayload
  check('pass holder: MAIN master ticket = registration ticket', r.code === 200 && r.body.data.kind === 'MAIN' && p1Ticket === generateTicket(regP1), r)
  r = await call('s1', 'GET', `/registrations/events/${E.fest}/ticket`); const s1Ticket = r.body.data?.qrPayload
  check('standalone booker: STANDALONE master ticket', r.code === 200 && r.body.data.kind === 'STANDALONE' && s1Ticket === generateStandaloneTicket(E.fest, U.s1), r)
  r = await call('p2', 'GET', `/registrations/events/${E.fest}/ticket`); check('payment pending -> 409', r.code === 409, r)
  r = await call('nobody', 'GET', `/registrations/events/${E.fest}/ticket`); check('nothing booked -> 404', r.code === 404, r)
  r = await call('s2', 'GET', `/registrations/bookings/${wb.id}/ticket`); check('old per-booking ticket endpoint is gone (404)', r.code === 404, r)

  console.log('\n== Check-in')
  r = await scan({ qrPayload: 'forged.payload' }); check('forged QR -> 400', r.code === 400, r)
  r = await call('s1', 'POST', '/registrations/check-in', { qrPayload: p1Ticket }); check('student scanner -> 403', r.code === 403, r)
  r = await call('head2', 'POST', '/registrations/check-in', { qrPayload: p1Ticket }); check("head2 scans head1's event -> 403", r.code === 403, r)
  r = await scan({ qrPayload: p1Ticket, eventId: E.free }); check('ticket for a different event -> 409', r.code === 409 && /different event/.test(r.body.message), r)
  r = await scan({ qrPayload: p1Ticket, eventId: E.fest.toUpperCase() }); check('main gate: MAIN pass checked in (eventId in any case)', r.code === 200 && r.body.data.pass === 'MAIN' && r.body.data.email === mail('p1'), r)
  r = await scan({ qrPayload: p1Ticket }); check('scan again -> 409 already checked in', r.code === 409 && r.body.data?.attendedAt, r)
  r = await scan({ qrPayload: generateTicket(regP2) }); check('genuine ticket, payment not verified -> 409', r.code === 409 && /not verified/.test(r.body.message), r)
  r = await scan({ qrPayload: s1Ticket }); check('STANDALONE pass at main gate -> 409 sub-event-only', r.code === 409 && /sub-event-only/.test(r.body.message), r)
  r = await scan({ qrPayload: p1Ticket, subEventId: S.hack }); check('same MAIN pass admits to booked hackathon', r.code === 200 && r.body.data.subEventTitle === 'Hackathon', r)
  r = await scan({ qrPayload: s1Ticket, subEventId: S.hack, eventId: E.fest }); check('STANDALONE pass admits to booked hackathon', r.code === 200 && r.body.data.pass === 'STANDALONE', r)
  r = await scan({ qrPayload: s1Ticket, subEventId: S.hack }); check('STANDALONE scanned again -> 409', r.code === 409 && /Already/.test(r.body.message), r)
  r = await scan({ qrPayload: p1Ticket, subEventId: S.work }); check('MAIN pass at a sub-event not booked -> 404', r.code === 404 && /not booked/.test(r.body.message), r)
  r = await scan({ qrPayload: generateStandaloneTicket(E.free, U.s1), subEventId: S.hack }); check('STANDALONE pass for another event -> 409', r.code === 409 && /different event/.test(r.body.message), r)
  r = await scan({ qrPayload: s1Ticket, subEventId: crypto.randomUUID() }); check('unknown sub-event -> 404', r.code === 404, r)
  const s2Ticket = (await call('s2', 'GET', `/registrations/events/${E.fest}/ticket`)).body.data.qrPayload
  const dbl = await Promise.all([1, 2].map(() => scan({ qrPayload: s2Ticket, subEventId: S.work })))
  check(`same ticket scanned at 2 gates at once -> one 200, one 409 (got ${dbl.map((x) => x.code).sort()})`, dbl.map((x) => x.code).sort().join() === '200,409')

  console.log('\n== Analytics')
  r = await call('head2', 'GET', `/events/${E.fest}/analytics`); check('head2 -> 403', r.code === 403, r)
  r = await call('head1', 'GET', `/events/${E.fest}/analytics`); const a = r.body.data
  const hack = a?.subEvents.find((x) => x.title === 'Hackathon'), work = a?.subEvents.find((x) => x.title === 'Workshop')
  check('event analytics numbers', r.code === 200 && a.totalSeats === 50 && a.seatsFilled === 2 && a.ticketsSold === 1 && a.mainEventAttended === 1 && a.mainEventRevenue === 200 && a.subEventRevenue === 1200 && a.totalRevenue === 1400 && hack.bookingsCount === 2 && hack.attendedCount === 2 && hack.revenue === 1200 && work.attendedCount === 1, r)
  r = await call('head1', 'GET', '/analytics/overview'); check('overview: event head -> 403', r.code === 403, r)
  r = await call('admin', 'GET', '/analytics/overview'); const o = r.body.data
  check('overview (whole database, includes these test rows)', r.code === 200 && ['totalEvents', 'totalUsers', 'totalRevenue', 'totalTicketsSold', 'totalSubEventBookings', 'pendingPayments', 'refundsDue'].every((k) => Number.isInteger(o[k])) && o.totalRevenue >= 1400 && o.totalEvents >= 2, r)

  console.log('\n== Booked as standalone, bought the main pass later')
  await call('w1', 'POST', '/registrations/book-sub-event', { subEventId: S.work })
  r = await call('w1', 'GET', `/registrations/events/${E.fest}/ticket`); check('before main pass: STANDALONE', r.body.data?.kind === 'STANDALONE', r)
  const regW1 = (await call('w1', 'POST', `/registrations/${E.fest}`, { totalAmountPaid: 200 })).body.data.id
  await call('w1', 'POST', `/payments/${regW1}/proof`, { utrNumber: '611111111108' })
  await call('head1', 'PATCH', `/payments/${regW1}/verify`, { action: 'APPROVE' })
  r = await call('w1', 'GET', `/registrations/events/${E.fest}/ticket`); const w1Ticket = r.body.data?.qrPayload
  check('after main pass verified: master ticket becomes MAIN', r.body.data?.kind === 'MAIN', r)
  r = await scan({ qrPayload: w1Ticket, subEventId: S.work }); check('MAIN pass admits to workshop booked before the pass existed', r.code === 200, r)

  console.log('\n== Refunds')
  await call('head1', 'PATCH', `/events/${E.fest}/capacity`, { capacity: 1 })
  r = await call('head1', 'PATCH', `/payments/${regP2}/verify`, { action: 'APPROVE' }); check('approve p2 when full -> REFUND_REQUIRED', r.body.data?.paymentStatus === 'REFUND_REQUIRED', r)
  r = await call('head1', 'PATCH', `/payments/${regP1}/refund`); check('refund a VERIFIED payment -> 409', r.code === 409, r)
  r = await call('head2', 'PATCH', `/payments/${regP2}/refund`); check('head2 refunds -> 403', r.code === 403, r)
  r = await call('head1', 'PATCH', `/payments/${regP2}/refund`)
  check('mark refunded: REFUNDED, refundedBy set, reviewedBy kept', r.code === 200 && r.body.data.paymentStatus === 'REFUNDED' && r.body.data.refundedBy === U.head1 && r.body.data.reviewedBy === U.head1 && r.body.data.refundedAt, r)
  r = await call('head1', 'PATCH', `/payments/${regP2}/refund`); check('refund twice -> 409', r.code === 409, r)
  await call('head1', 'PATCH', `/events/${E.fest}/capacity`, { capacity: 50 })
  r = await call('p2', 'POST', `/registrations/${E.fest}`)
  check('refunded student can register again (row reactivated, refund fields cleared)', r.code === 201 && r.body.data.id === regP2 && r.body.data.paymentStatus === 'PENDING' && r.body.data.utrNumber === null && r.body.data.refundedAt === null && r.body.data.refundedBy === null && r.body.data.reviewedBy === null, r)
  r = await scan({ qrPayload: generateTicket(regP2), subEventId: S.hack }); check('MAIN pass not valid (unpaid) at a sub-event -> 409', r.code === 409 && /no longer valid/.test(r.body.message), r)

  console.log('\n== Sub-event reject-remaining')
  S.closing = (await call('head1', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'Closing', capacity: 10, priceForStandalone: 100 })).body.data.id
  const c1 = (await call('c1', 'POST', '/registrations/book-sub-event', { subEventId: S.closing, totalAmountPaid: 100 })).body.data.id
  await call('c1', 'POST', `/payments/sub-event-bookings/${c1}/proof`, { utrNumber: '611111111110' })
  await call('c2', 'POST', '/registrations/book-sub-event', { subEventId: S.closing })
  const c3 = (await call('c3', 'POST', '/registrations/book-sub-event', { subEventId: S.closing, teamName: 'Late Team', teammateEmails: [mail('c4')], totalAmountPaid: 200 })).body.data.id
  await call('c3', 'POST', `/payments/sub-event-bookings/${c3}/proof`, { utrNumber: '611111111111' })
  const c5 = (await call('c5', 'POST', '/registrations/book-sub-event', { subEventId: S.closing, totalAmountPaid: 100 })).body.data.id
  await call('c5', 'POST', `/payments/sub-event-bookings/${c5}/proof`, { utrNumber: '611111111112' })
  await call('head1', 'PATCH', `/payments/sub-event-bookings/${c5}/verify`, { action: 'APPROVE' })
  r = await call('head2', 'POST', `/payments/sub-events/${S.closing}/reject-remaining`); check("head2 closes head1's sub-event -> 403", r.code === 403, r)
  r = await call('s1', 'POST', `/payments/sub-events/${S.closing}/reject-remaining`); check('student -> 403', r.code === 403, r)
  r = await call('head1', 'POST', `/payments/sub-events/${crypto.randomUUID()}/reject-remaining`); check('unknown sub-event -> 404', r.code === 404, r)
  const regsBefore = await db.select({ id: registrations.id, ps: registrations.paymentStatus }).from(registrations).where(eq(registrations.eventId, E.fest))
  r = await call('head1', 'POST', `/payments/sub-events/${S.closing}/reject-remaining`)
  check('closes: c1 + team c3/c4 (UTR) -> REFUND_REQUIRED (3), c2 (no UTR) -> REJECTED (1)', r.code === 200 && r.body.data.refundRequired === 3 && r.body.data.rejected === 1 && r.body.data.bookingIds.length === 4, r)
  const closing = await db.select({ userId: subEventBookings.userId, status: subEventBookings.status, ps: subEventBookings.paymentStatus }).from(subEventBookings).where(eq(subEventBookings.subEventId, S.closing))
  const byUser = (n) => closing.find((b) => b.userId === U[n])
  check('teammate c4 follows the leader: REFUND_REQUIRED + CANCELLED', byUser('c4').ps === 'REFUND_REQUIRED' && byUser('c4').status === 'CANCELLED')
  check('verified booking c5 untouched', byUser('c5').ps === 'VERIFIED' && byUser('c5').status === 'CONFIRMED')
  r = await call(null, 'GET', `/events/${E.fest}/sub-events`); check('seats freed: Closing has 9 left (only c5 holds one)', r.body.data.find((x) => x.id === S.closing)?.seatsLeft === 9, r)
  const regsAfter = await db.select({ id: registrations.id, ps: registrations.paymentStatus }).from(registrations).where(eq(registrations.eventId, E.fest))
  check('main-event registrations untouched', JSON.stringify(regsAfter.sort((x, y) => x.id.localeCompare(y.id))) === JSON.stringify(regsBefore.sort((x, y) => x.id.localeCompare(y.id))))
  r = await call('head1', 'POST', `/payments/sub-events/${S.closing}/reject-remaining`); check('run again: nothing left to close', r.code === 200 && r.body.data.refundRequired === 0 && r.body.data.rejected === 0, r)
  r = await call('c2', 'POST', '/registrations/book-sub-event', { subEventId: S.closing }); check('rejected student (no UTR) can book again', r.code === 201, r)
  r = await call('c1', 'POST', '/registrations/book-sub-event', { subEventId: S.closing }); check('refund-due student cannot book again until refunded (409)', r.code === 409, r)

  console.log('\n== Races')
  const raced = await Promise.all(['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((q) => call(q, 'POST', '/registrations/book-sub-event', { subEventId: S.race })))
  const won = raced.filter((x) => x.code === 201).length
  const rows = await db.select({ id: subEventBookings.id }).from(subEventBookings).where(eq(subEventBookings.subEventId, S.race))
  check(`6 students book 3 seats at once -> exactly 3 (got ${won}, ${rows.length} rows)`, won === 3 && rows.length === 3)

  console.log('\n== Sub-event capacity')
  r = await call('head2', 'PATCH', `/events/${E.fest}/sub-events/${S.race}/capacity`, { capacity: 10 }); check("head2 edits head1's sub-event -> 403", r.code === 403, r)
  r = await call('s1', 'PATCH', `/events/${E.fest}/sub-events/${S.race}/capacity`, { capacity: 10 }); check('student -> 403', r.code === 403, r)
  r = await call('head1', 'PATCH', `/events/${E.fest}/sub-events/${S.race}/capacity`, { capacity: 0 }); check('capacity 0 -> 400', r.code === 400, r)
  r = await call('head1', 'PATCH', `/events/${E.fest}/sub-events/${S.race}/capacity`, { capacity: '5' }); check('capacity as string -> 400', r.code === 400, r)
  r = await call('admin', 'PATCH', `/events/${E.free}/sub-events/${S.race}/capacity`, { capacity: 5 }); check('sub-event of a different event -> 404', r.code === 404, r)
  r = await call('head1', 'PATCH', `/events/${E.fest}/sub-events/${crypto.randomUUID()}/capacity`, { capacity: 5 }); check('unknown sub-event -> 404', r.code === 404, r)
  r = await call('head1', 'PATCH', `/events/${E.fest}/sub-events/${S.race}/capacity`, { capacity: 2 }); check('lower Race to 2 (below 3 booked)', r.code === 200 && r.body.data.capacity === 2, r)
  r = await call(null, 'GET', `/events/${E.fest}/sub-events`); check('nobody lost a booking: 3 booked, seatsLeft -1', r.body.data.find((x) => x.id === S.race)?.seatsLeft === -1, r)
  r = await call('late', 'POST', '/registrations/book-sub-event', { subEventId: S.race }); check('new booking refused while over capacity', r.code === 400 && /full/.test(r.body.message), r)
  r = await call('head1', 'PATCH', `/events/${E.fest}/sub-events/${S.race}/capacity`, { capacity: 4 }); check('raise Race to 4', r.code === 200, r)
  r = await call('late', 'POST', '/registrations/book-sub-event', { subEventId: S.race }); check('booking allowed again after raising capacity', r.code === 201, r)

  console.log('\n== Overflow after lowering sub-event capacity')
  const m3 = (await call('s3', 'POST', '/registrations/book-sub-event', { subEventId: S.mini, totalAmountPaid: 100 })).body.data.id
  const m4 = (await call('s4', 'POST', '/registrations/book-sub-event', { subEventId: S.mini, totalAmountPaid: 100 })).body.data.id
  await call('s3', 'POST', `/payments/sub-event-bookings/${m3}/proof`, { utrNumber: '611111111106' }); await call('s4', 'POST', `/payments/sub-event-bookings/${m4}/proof`, { utrNumber: '611111111107' })
  r = await call('head1', 'PATCH', `/events/${E.fest}/sub-events/${S.mini}/capacity`, { capacity: 1 }); check('lower Mini to 1 via the endpoint', r.code === 200, r)
  const both = await Promise.all([m3, m4].map((id) => call('head1', 'PATCH', `/payments/sub-event-bookings/${id}/verify`, { action: 'APPROVE' })))
  const st = both.map((x) => x.body.data?.paymentStatus).sort().join()
  check(`2 booking approvals at once for 1 seat -> VERIFIED + REFUND_REQUIRED (got ${st})`, st === 'REFUND_REQUIRED,VERIFIED')
  const due = both.find((x) => x.body.data?.paymentStatus === 'REFUND_REQUIRED')?.body.data.id
  r = await call('head1', 'PATCH', `/payments/sub-event-bookings/${due}/refund`); check('booking refund -> REFUNDED', r.code === 200 && r.body.data.paymentStatus === 'REFUNDED', r)
} catch (err) {
  check(`suite crashed: ${err.message}`, false)
  console.error(err)
} finally {
  server.close()
  subIds = eventIds.length ? (await db.select({ id: subEvents.id }).from(subEvents).where(inArray(subEvents.eventId, eventIds))).map((x) => x.id) : []
  if (subIds.length) await db.delete(subEventBookings).where(inArray(subEventBookings.subEventId, subIds))
  if (eventIds.length) await db.delete(subEvents).where(inArray(subEvents.eventId, eventIds))
  if (eventIds.length) await db.delete(registrations).where(inArray(registrations.eventId, eventIds))
  if (eventIds.length) await db.delete(events).where(inArray(events.id, eventIds))
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
  const left = userIds.length ? await db.select({ id: users.id }).from(users).where(inArray(users.id, userIds)) : []
  report(`Cleanup: removed ${userIds.length} test users, ${eventIds.length} test events, ${subIds.length} sub-events and all their rows; leftovers: ${left.length}`)
}
