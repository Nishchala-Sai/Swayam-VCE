// Live suite 4: venues, UPI QR and banner uploads, event schedules, team-competition sessions (teamSize) and
// auto-grouping, and the attendee CSV export.
// Run from backend/: npm run test:live
import fs from 'node:fs/promises'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import { and, eq, inArray, like } from 'drizzle-orm'
import { db, schema, tickets, startServer, makeClient, makeChecker, PROFILE } from './helpers.mjs'
import { UPLOAD_DIR } from '../../src/modules/uploads/uploads.controller.js'

const { users, events, registrations, subEvents, subEventBookings, venues } = schema
const tag = Date.now(), userIds = [], eventIds = [], uploaded = []
const U = {}, E = {}, S = {}
const server = startServer()
const call = makeClient(server.api, U)
const { check, report } = makeChecker()
const mail = (n) => `team+${tag}-${n}@example.invalid`
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex')

const auth = (who) => (who ? { cookie: `token=${jwt.sign({ sub: U[who] }, process.env.JWT_SECRET, { expiresIn: '10m' })}` } : {})

async function upload(who, bytes, filename = 'qr.png', type = 'image/png', kind = 'upi-qr') {
  const form = new FormData()
  if (bytes) form.append('file', new Blob([bytes], { type }), filename)
  const r = await fetch(`${server.api}/uploads/${kind}`, { method: 'POST', headers: auth(who), body: form })
  const body = await r.json()
  if (body.data?.path) uploaded.push(body.data.path)
  return { code: r.status, body }
}
const book = (who, body) => call(who, 'POST', '/registrations/book-sub-event', body)

try {
  const people = [['admin', 'ADMIN'], ['head1', 'EVENT_HEAD'], ['head2', 'EVENT_HEAD'],
    ...['a1', 'a2', 'b1', 'c1', 'd1', 'd2', 'd3', 'e1', 'e2', 'p1', 'x1', 'x2', 'x3', 'x4'].map((n) => [n, 'STUDENT'])]
  const made = await db.insert(users).values(people.map(([n, role]) => ({ email: mail(n), name: `${n} T`, role, ...PROFILE }))).returning({ id: users.id, email: users.email })
  for (const [n] of people) { U[n] = made.find((u) => u.email === mail(n)).id; userIds.push(U[n]) }

  console.log('\n== Venues')
  const venueName = `Test Hall ${tag}`
  let r = await call('head1', 'POST', '/venues', { name: venueName }); check('event head cannot add a venue -> 403', r.code === 403, r)
  r = await call('admin', 'POST', '/venues', { name: `  ${venueName}  ` }); const venue = r.body.data
  check('admin adds a venue (name trimmed)', r.code === 201 && venue.name === venueName, r)
  r = await call('admin', 'POST', '/venues', { name: venueName.toUpperCase() }); check('same name in other case -> 409', r.code === 409, r)
  r = await call('admin', 'POST', '/venues', { name: '' }); check('empty name -> 400', r.code === 400, r)
  r = await call('head1', 'GET', '/venues'); check('event head can list venues', r.code === 200 && r.body.data.some((v) => v.id === venue.id), r)
  r = await call('a1', 'GET', '/venues'); check('student cannot list venues -> 403', r.code === 403, r)
  r = await call('head1', 'DELETE', `/venues/${venue.id}`); check('event head cannot delete -> 403', r.code === 403, r)
  r = await call('admin', 'DELETE', `/venues/${venue.id}`); check('admin deletes the venue', r.code === 200, r)
  r = await call('admin', 'DELETE', `/venues/${venue.id}`); check('deleting again -> 404', r.code === 404, r)

  console.log('\n== UPI QR upload')
  r = await upload('a1', PNG); check('student cannot upload -> 403', r.code === 403, r)
  r = await upload(null, PNG); check('logged out -> 401', r.code === 401, r)
  r = await upload('head1', null); check('no file -> 400', r.code === 400, r)
  r = await upload('head1', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'qr.png', 'image/png'); check('non-image renamed .png -> 400', r.code === 400, r)
  r = await upload('head1', Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])); check('over 2 MB -> 400', r.code === 400 && /2 MB/.test(r.body.message), r)
  r = await upload('head1', PNG); const qrPath = r.body.data?.path
  if (process.env.CLOUDINARY_URL) {
    check('PNG upload returns a Cloudinary https URL', r.code === 201 && /^https:\/\/res\.cloudinary\.com\/.+\/swayam\/upi-qr\/[0-9a-f-]{36}\.png$/.test(qrPath), r)
  } else {
    check('PNG upload returns a path', r.code === 201 && /^\/api\/uploads\/upi-qr\/[0-9a-f-]{36}\.png$/.test(qrPath), r)
    const served = await fetch(server.api.replace(/\/api$/, '') + qrPath)
    check('uploaded image is served as image/png', served.status === 200 && served.headers.get('content-type') === 'image/png' && Buffer.from(await served.arrayBuffer()).equals(PNG))
    check('served cross-origin for the site', served.headers.get('cross-origin-resource-policy') === 'cross-origin')
    const missing = await fetch(server.api.replace(/\/api$/, '') + '/api/uploads/upi-qr/../../package.json')
    check('no path traversal out of the uploads folder', missing.status === 404)
  }

  console.log('\n== Event schedule')
  const base = { title: `TEAM TEST fest ${tag}`, description: 'Three days.', date: '2026-12-01T10:00:00+05:30', location: 'Main Auditorium', capacity: 100, price: 0 }
  const day = (date) => ({ date, slots: [
    { start: '10:00', end: '12:40', title: 'Talks' }, { start: '12:40', end: '13:20', title: 'Lunch break', kind: 'break' }, { start: '13:20', end: '16:20', title: 'Workshops' }] })
  r = await call('head1', 'POST', '/events', { ...base, schedule: [day('2026-12-01'), { date: '2026-12-01', slots: [{ start: '09:00', end: '10:00', title: 'X' }] }] }); check('same day twice -> 400', r.code === 400, r)
  r = await call('head1', 'POST', '/events', { ...base, schedule: [{ date: '2026-12-01', slots: [{ start: '10:00', end: '12:00', title: 'A' }, { start: '11:30', end: '13:00', title: 'B' }] }] }); check('overlapping slots -> 400', r.code === 400 && /starts before/.test(r.body.message), r)
  r = await call('head1', 'POST', '/events', { ...base, schedule: [{ date: '2026-12-01', slots: [{ start: '16:20', end: '10:00', title: 'A' }] }] }); check('slot ending before it starts -> 400', r.code === 400, r)
  r = await call('head1', 'POST', '/events', { ...base, schedule: [{ date: '2026-12-01', slots: [{ start: '7:5', end: '10:00', title: 'A' }] }] }); check('bad time format -> 400', r.code === 400, r)
  r = await call('head1', 'POST', '/events', { ...base, price: 300, upiQrUrl: '/api/uploads/upi-qr/../../secret.png' }); check('upiQrUrl not an upload or https -> 400', r.code === 400, r)
  r = await call('head1', 'POST', '/events', {
    ...base, price: 300, upiQrUrl: qrPath,
    schedule: [day('2026-12-03'), day('2026-12-01'), { date: '2026-12-02', slots: [{ start: '18:00', end: '23:30', title: 'Night hackathon' }, { start: '09:15', end: '11:05', title: 'Early pitch' }] }],
  })
  E.fest = r.body.data?.id; if (E.fest) eventIds.push(E.fest)
  const sch = r.body.data?.schedule
  check('3-day event with any times and a lunch break is created', r.code === 201 && sch?.length === 3, r)
  check('days and slots are stored sorted', sch?.map((d) => d.date).join() === '2026-12-01,2026-12-02,2026-12-03' && sch[1].slots[0].title === 'Early pitch')
  check('slot kinds default to session, breaks kept', sch?.[0].slots.map((s) => s.kind).join() === 'session,break,session')
  check('uploaded QR stored on the event', r.body.data?.upiQrUrl === qrPath)
  const paidBase = { ...base, title: `TEAM TEST offer ${tag}`, price: 500, upiQrUrl: qrPath }
  r = await call('head1', 'POST', '/events', { ...paidBase, groupSize: 7 }); check('group size without a group price -> 400', r.code === 400, r)
  r = await call('head1', 'POST', '/events', { ...paidBase, groupSize: 7, groupPrice: 3500 }); check('group price equal to the per-person total -> 400', r.code === 400 && /less than 7 x 500/.test(r.body.message), r)
  r = await call('head1', 'POST', '/events', { ...paidBase, groupSize: 12, groupPrice: 2500 }); check('group of 12 (more than a team holds) -> 400', r.code === 400, r)
  r = await call('head1', 'POST', '/events', { ...base, groupSize: 7, groupPrice: 2500 }); check('group offer on a free event -> 400', r.code === 400, r)
  r = await call('head1', 'POST', '/events', { ...paidBase, groupSize: 7, groupPrice: 2500 }); E.offer = r.body.data?.id; if (E.offer) eventIds.push(E.offer)
  check('5+2 offer stored: 7 people for 2500', r.code === 201 && r.body.data.groupSize === 7 && r.body.data.groupPrice === 2500, r)
  r = await call('a1', 'POST', `/registrations/${E.offer}`, { teamName: 'Seven', teammateEmails: ['a2', 'b1', 'c1', 'd1', 'd2', 'd3'].map(mail), totalAmountPaid: 2500 })
  check('a team of 7 registers with the offer total', r.code === 201 && r.body.data.totalAmountPaid === 2500, r)
  r = await call('e1', 'POST', `/registrations/${E.offer}`, { teamName: 'Eight', teammateEmails: ['e2', 'x1', 'x2', 'x3', 'x4', 'p1', 'b1'].map(mail), totalAmountPaid: 4000 })
  check('a team of 8 for a group offer of 7 -> 400', r.code === 400 && /at most 7 people/.test(r.body.message), r)
  r = await call('head1', 'GET', '/payments/pending'); const pend = r.body.data?.find((p) => p.event.id === E.offer)
  check('staff see the offer with the pending payment', pend?.event.groupSize === 7 && pend.event.groupPrice === 2500 && pend.teamSize === 7, r)
  r = await call(null, 'GET', `/events/${E.fest}`); check('schedule is public with the event', r.code === 200 && r.body.data.schedule?.length === 3, r)
  r = await call('head2', 'POST', '/events', { title: `TEAM TEST other ${tag}`, description: 't', date: '2026-12-05T10:00:00+05:30', location: 'x', capacity: 10 })
  E.other = r.body.data.id; eventIds.push(E.other)
  check('event without a schedule still works (schedule null)', r.code === 201 && r.body.data.schedule === null, r)

  console.log('\n== Team registration only where allowed')
  r = await call('a1', 'POST', `/registrations/${E.other}`, { teamName: 'Nope', teammateEmails: [mail('a2')] })
  check('event without teams or a group offer: team registration -> 400', r.code === 400 && /individual registrations only/.test(r.body.message), r)
  r = await call('head2', 'POST', '/events', { ...base, maxTeamSize: 1 }); check('maxTeamSize 1 -> 400', r.code === 400, r)
  r = await call('head2', 'POST', '/events', { ...base, price: 500, upiQrUrl: qrPath, groupSize: 7, groupPrice: 2500, maxTeamSize: 5 }); check('group offer larger than maxTeamSize -> 400', r.code === 400, r)
  r = await call('head2', 'POST', '/events', { ...base, title: `TEAM TEST hack ${tag}`, maxTeamSize: 4 }); E.hack = r.body.data?.id; if (E.hack) eventIds.push(E.hack)
  check('event allowing teams of up to 4', r.code === 201 && r.body.data.maxTeamSize === 4, r)
  r = await call('x1', 'POST', `/registrations/${E.hack}`, { teamName: 'Five', teammateEmails: ['x2', 'x3', 'x4', 'e1'].map(mail) }); check('team of 5 for max 4 -> 400', r.code === 400 && /at most 4/.test(r.body.message), r)
  r = await call('x1', 'POST', `/registrations/${E.hack}`, { teamName: 'Four', teammateEmails: ['x2', 'x3', 'x4'].map(mail) }); check('team of 4 registers', r.code === 201, r)

  console.log('\n== Deleting events and sessions')
  r = await call('head2', 'POST', '/events', { ...base, title: `TEAM TEST empty ${tag}` }); const emptyId = r.body.data.id; eventIds.push(emptyId)
  r = await call('head2', 'POST', `/events/${emptyId}/sub-events`, { title: 'Empty session', venue: 'x', capacity: 5 })
  r = await call('head1', 'DELETE', `/events/${emptyId}`); check("another head can't delete -> 403", r.code === 403, r)
  r = await call('a1', 'DELETE', `/events/${emptyId}`); check('student cannot delete -> 403', r.code === 403, r)
  r = await call('head2', 'DELETE', `/events/${emptyId}`); check('head deletes their empty event with its session', r.code === 200, r)
  r = await call(null, 'GET', `/events/${emptyId}`); check('deleted event is gone', r.code === 404, r)
  r = await call('head2', 'DELETE', `/events/${E.hack}`); check('head cannot delete an event with registrations -> 409', r.code === 409 && /Only an admin/.test(r.body.message), r)
  r = await call('admin', 'DELETE', `/events/${E.hack}`); check('admin without confirmation -> 409', r.code === 409 && /Confirm with the exact event title/.test(r.body.message), r)
  r = await call('admin', 'DELETE', `/events/${E.hack}`, { confirm: 'wrong' }); check('admin with the wrong title -> 409', r.code === 409, r)
  r = await call('admin', 'DELETE', `/events/${E.hack}`, { confirm: `TEAM TEST hack ${tag}` })
  check('admin deletes it with its 4 registrations', r.code === 200 && r.body.data.deleted.registrations === 4, r)
  check('registrations are gone too', (await db.select().from(registrations).where(inArray(registrations.eventId, [E.hack]))).length === 0)

  console.log('\n== Team-competition sessions')
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'X', capacity: 5, teamSize: 0 }); check('teamSize 0 -> 400', r.code === 400, r)
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'X', capacity: 5, teamSize: 2.5 }); check('teamSize 2.5 -> 400', r.code === 400, r)
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'IPL Auction', capacity: 30, teamSize: 3 }); S.ipl = r.body.data?.id
  check('session with teamSize 3', r.code === 201 && r.body.data.teamSize === 3, r)
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'Workshop', capacity: 30 }); S.work = r.body.data?.id
  check('teamSize defaults to 1', r.code === 201 && r.body.data.teamSize === 1, r)
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { title: 'No Venue', capacity: 5 }); check('session without a venue -> 400', r.code === 400 && /venue is required/.test(r.body.message), r)
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { title: 'Blank Venue', capacity: 5, venue: '   ' }); check('blank venue -> 400', r.code === 400, r)
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { title: 'Custom Room', capacity: 5, venue: '  Room 304, R-block ' }); S.custom = r.body.data?.id
  check('custom venue typed by hand is stored (trimmed)', r.code === 201 && r.body.data.venue === 'Room 304, R-block', r)
  r = await call(null, 'GET', `/events/${E.fest}/sub-events`); check('public session list shows the venue', r.body.data?.find((s) => s.id === S.custom)?.venue === 'Room 304, R-block', r)
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { venue: 'Test Room', title: 'Paid Duo', capacity: 10, teamSize: 2, priceForStandalone: 100 }); S.duo = r.body.data?.id
  r = await call(null, 'GET', `/events/${E.fest}/sub-events`); check('public list shows teamSize', r.body.data?.find((s) => s.id === S.ipl)?.teamSize === 3, r)

  r = await book('a1', { subEventId: S.ipl }); check('team session without a team name -> 400', r.code === 400 && /teamName is required/.test(r.body.message), r)
  r = await book('a1', { subEventId: S.ipl, teamName: 'Too Big', teammateEmails: [mail('x1'), mail('x2'), mail('x3')] }); check('4 people for a team of 3 -> 400', r.code === 400 && /at most 3/.test(r.body.message), r)
  r = await book('a1', { subEventId: S.ipl, teamName: 'Team A', teammateEmails: [mail('a2')] }); check('Team A books as 2', r.code === 201 && r.body.data.teammates.length === 1 && r.body.data.paymentStatus === 'VERIFIED', r)
  r = await book('b1', { subEventId: S.ipl, teamName: 'Team B' }); check('Team B books alone (team of one)', r.code === 201 && r.body.data.teamName === 'Team B' && r.body.data.isGroupLeader && r.body.data.teammateEmails === null, r)
  r = await book('c1', { subEventId: S.ipl, teamName: 'Team C', teammateEmails: [] }); check('Team C books alone with an empty list', r.code === 201, r)
  r = await book('d1', { subEventId: S.ipl, teamName: 'Team D', teammateEmails: [mail('d2'), mail('d3')] }); check('Team D books as a full 3', r.code === 201, r)
  r = await book('p1', { subEventId: S.duo, teamName: 'Pending Pair' }); check('priced team session: booking PENDING', r.code === 201 && r.body.data.paymentStatus === 'PENDING', r)
  r = await book('x1', { subEventId: S.work, teamName: 'Friends', teammateEmails: [mail('x2')] }); check('ordinary session: friends still book together as before', r.code === 201 && r.body.data.teammates.length === 1, r)
  r = await book('x3', { subEventId: S.work }); check('ordinary session: solo as before', r.code === 201 && !r.body.data.teamId, r)

  console.log('\n== Auto-grouping')
  const group = (who, sub, ev = E.fest) => call(who, 'POST', `/events/${ev}/sub-events/${sub}/auto-group`)
  r = await group('a1', S.ipl); check('student cannot auto-group -> 403', r.code === 403, r)
  r = await group('head2', S.ipl); check("another event head's event -> 403", r.code === 403, r)
  r = await group('head1', S.work); check('team size 1 -> 400', r.code === 400, r)
  r = await call('admin', 'POST', `/events/${E.other}/sub-events/${S.ipl}/auto-group`); check('session of another event -> 404', r.code === 404, r)
  r = await group('head1', S.ipl)
  const g1 = r.body.data
  const names = (g1?.teamsFormed ?? []).map((t) => t.groupName).sort()
  check('Team A (2) + Team B (1) coupled; Team D kept whole', r.code === 200 && names.join('|') === 'Team A + Team B|Team D', r)
  const ab = g1?.teamsFormed.find((t) => t.groupName === 'Team A + Team B')
  check('coupled team has 3 members and is marked coupled', ab?.members.length === 3 && ab.coupled === true)
  check('Team C left over, with its email and the notice', g1?.leftovers.length === 1 && g1.leftovers[0].teamName === 'Team C' && g1.leftoverEmails.join() === mail('c1') && r.body.message === 'Sorry, not enough teammates to fulfill the team size requirement.', r)
  const rows = await db.select().from(subEventBookings).where(inArray(subEventBookings.subEventId, [S.ipl]))
  const byUser = (n) => rows.find((b) => b.userId === U[n])
  check('A and B share a group id; their own team ids are unchanged', byUser('a1').groupId && byUser('a1').groupId === byUser('b1').groupId && byUser('a1').teamId === byUser('a2').teamId && byUser('a1').teamId !== byUser('b1').teamId)
  check('Team C stays ungrouped', byUser('c1').groupId === null)

  r = await group('head1', S.ipl); check('running again changes nothing already formed', r.code === 200 && r.body.data.teamsFormed.length === 0 && r.body.data.leftovers.length === 1, r)
  r = await book('e1', { subEventId: S.ipl, teamName: 'Team E', teammateEmails: [mail('e2')] }); check('Team E (2) books later', r.code === 201, r)
  r = await call('admin', 'POST', `/events/${E.fest}/sub-events/${S.ipl}/auto-group`)
  check('admin re-run couples Team E with leftover Team C', r.code === 200 && r.body.data.teamsFormed.length === 1 && r.body.data.teamsFormed[0].members.length === 3 && !r.body.message, r)
  r = await group('head1', S.duo); check('pending payments are not grouped, listed as awaiting', r.code === 200 && r.body.data.teamsFormed.length === 0 && r.body.data.awaitingPayment.length === 1, r)

  r = await call('head1', 'GET', `/events/${E.fest}/sub-events/${S.ipl}/teams`)
  check('roster: 3 teams formed, none waiting', r.code === 200 && r.body.data.teams.length === 3 && r.body.data.ungrouped.length === 0 && r.body.data.teams.every((t) => t.members.length === 3), r)
  r = await call('head2', 'GET', `/events/${E.fest}/sub-events/${S.ipl}/teams`); check("roster of another head's event -> 403", r.code === 403, r)
  r = await call('a1', 'GET', '/registrations/bookings/me'); check("student sees their competing team's name", r.body.data?.find((b) => b.subEvent.id === S.ipl)?.groupName === 'Team A + Team B', r)

  r = await call('head1', 'GET', `/events/${E.fest}/analytics`)
  console.log('\n== Editing sessions and ticket-holder-only sessions')
  const sess = { title: 'Founders Dinner', venue: 'Canteen', capacity: 20, priceForPassHolders: 0, priceForStandalone: 0 }
  r = await call('head1', 'POST', `/events/${E.offer}/sub-events`, sess); S.dinner = r.body.data?.id
  check('session created', r.code === 201 && r.body.data.passHoldersOnly === false, r)
  r = await call('head2', 'PATCH', `/events/${E.offer}/sub-events/${S.dinner}`, { ...sess, title: 'Hijack' }); check("another head can't edit -> 403", r.code === 403, r)
  r = await call('head1', 'PATCH', `/events/${E.offer}/sub-events/${S.dinner}`, { ...sess, title: '' }); check('edit with no title -> 400', r.code === 400, r)
  r = await call('head1', 'PATCH', `/events/${E.fest}/sub-events/${S.dinner}`, sess); check('edit through the wrong event -> 404', r.code === 404, r)
  r = await call('head1', 'PATCH', `/events/${E.offer}/sub-events/${S.dinner}`, { ...sess, title: 'Founders Dinner (invite)', venue: 'Incubation Room (JC Bose Block)', capacity: 12, teamSize: 2, passHoldersOnly: true, priceForStandalone: 999, startTime: '2026-12-02T19:00:00+05:30' })
  check('edit saves every field; standalone price cleared for ticket holders only', r.code === 200 && r.body.data.title === 'Founders Dinner (invite)' && r.body.data.capacity === 12 && r.body.data.teamSize === 2 && r.body.data.passHoldersOnly === true && r.body.data.priceForStandalone === 0 && r.body.data.venue === 'Incubation Room (JC Bose Block)', r)
  r = await book('x3', { subEventId: S.dinner, teamName: 'Lone' }); check('no ticket: ticket-holder-only session -> 403', r.code === 403 && /confirmed event ticket/.test(r.body.message), r)
  await db.update(registrations).set({ paymentStatus: 'VERIFIED' }).where(inArray(registrations.eventId, [E.offer]))
  r = await book('a1', { subEventId: S.dinner, teamName: 'Duo', teammateEmails: [mail('x3')] }); check('team with a member lacking a ticket -> 403 naming them', r.code === 403 && r.body.message.includes(mail('x3')), r)
  r = await book('a1', { subEventId: S.dinner, teamName: 'Duo', teammateEmails: [mail('a2')] }); check('ticket holders can book it', r.code === 201, r)
  r = await call('a2', 'GET', '/registrations/bookings/me'); check('teammate sees who booked for the team', r.body.data?.find((b) => b.subEvent.id === S.dinner)?.teamLeader === mail('a1'), r)
  r = await call('a2', 'GET', '/registrations/me'); check('teammate sees who registered the team', r.body.data?.find((x) => x.event.id === E.offer)?.teamLeader === mail('a1'), r)
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { title: 'Timed', venue: 'x', capacity: 5, endTime: '2026-12-02T13:00:00+05:30' }); check('endTime without startTime -> 400', r.code === 400, r)
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { title: 'Timed', venue: 'x', capacity: 5, startTime: '2026-12-02T13:00:00+05:30', endTime: '2026-12-02T12:00:00+05:30' }); check('endTime before startTime -> 400', r.code === 400, r)
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { title: 'Timed', venue: 'x', capacity: 5, startTime: '2026-12-02T10:00:00+05:30', endTime: '2026-12-02T12:40:00+05:30' }); const timed = r.body.data?.id
  check('session with start and end time', r.code === 201 && new Date(r.body.data.endTime).toISOString() === '2026-12-02T07:10:00.000Z', r)
  await book('x4', { subEventId: timed })
  r = await call('x4', 'GET', '/registrations/bookings/me'); const mineTimed = r.body.data?.find((b) => b.subEvent.id === timed)
  check("student's bookings include end time and the event schedule", Boolean(mineTimed?.subEvent.endTime) && mineTimed.event.schedule?.length === 3, r)
  r = await call('a1', 'GET', '/registrations/me'); check("student's registrations include the event schedule", 'schedule' in (r.body.data?.[0]?.event ?? {}), r)
  r = await call('head1', 'POST', `/events/${E.fest}/sub-events`, { title: 'Spare', venue: 'x', capacity: 5 }); const spare = r.body.data.id
  r = await call('head1', 'DELETE', `/events/${E.fest}/sub-events/${spare}`); check('head deletes an empty session', r.code === 200, r)
  r = await call('head1', 'DELETE', `/events/${E.fest}/sub-events/${S.ipl}`); check('head cannot delete a booked session -> 409', r.code === 409, r)
  r = await call('admin', 'DELETE', `/events/${E.offer}/sub-events/${S.dinner}`, { confirm: 'Founders Dinner (invite)' })
  check('admin deletes a booked session with confirmation', r.code === 200 && r.body.data.deleted.bookings === 2, r)
  r = await call('head1', 'GET', `/events/${E.fest}/analytics`)
  check('analytics show team size and grouped count', r.body.data?.subEvents.find((s) => s.id === S.ipl)?.groupedCount === 9 && r.body.data.subEvents.find((s) => s.id === S.ipl).teamSize === 3, r)
  const iplTeams = r.body.data?.subEvents.find((s) => s.id === S.ipl)?.teams
  check('analytics list the 3 formed IPL teams with their members', iplTeams?.length === 3 && iplTeams.every((x) => x.grouped && x.members.length === 3) && iplTeams.some((x) => x.name === 'Team A + Team B'), r)
  check('ordinary sessions have no team list', !('teams' in (r.body.data?.subEvents.find((s) => s.id === S.work) ?? { teams: 1 })), r)

  console.log('\n== Analytics: check-in log')
  const [aReg] = await db.select().from(registrations).where(inArray(registrations.userId, [U.a1])).then((rows) => rows.filter((x) => x.eventId === E.offer))
  r = await call('head1', 'POST', '/registrations/check-in', { qrPayload: tickets.generateTicket(aReg.id), eventId: E.offer }); check('a1 checked in at the main entrance', r.code === 200, r)
  r = await call('head2', 'GET', `/events/${E.offer}/analytics`); check("another head can't see the analytics -> 403", r.code === 403, r)
  r = await call('head1', 'GET', `/events/${E.offer}/analytics`)
  const log = r.body.data?.checkIns
  check('check-in log lists name, email, ticket id and time', log?.length === 1 && log[0].email === mail('a1') && log[0].name === 'a1 T' && log[0].ticketId === aReg.id && !Number.isNaN(new Date(log[0].checkedInAt).getTime()), r)
  check('stats: tickets, seats available, attended', r.body.data.ticketsSold === 7 && r.body.data.mainEventAttended === 1 && r.body.data.seatsAvailable === r.body.data.totalSeats - r.body.data.seatsFilled, r)

  console.log('\n== Refunds')
  const [refundRow] = await db.insert(registrations).values({ userId: U.p1, eventId: E.offer, status: 'CANCELLED', paymentStatus: 'REFUND_REQUIRED', utrNumber: String(tag).slice(-12).padStart(12, '4'), totalAmountPaid: 500, reviewedAt: new Date() }).returning()
  r = await call('a1', 'GET', '/payments/refunds'); check('student cannot list refunds -> 403', r.code === 403, r)
  r = await call('head2', 'GET', '/payments/refunds'); check("another head doesn't see it", r.code === 200 && !r.body.data.some((x) => x.id === refundRow.id), r)
  r = await call('head1', 'GET', '/payments/refunds'); const due = r.body.data?.find((x) => x.id === refundRow.id)
  check('refund due listed with student, amount, UTR and event', due?.kind === 'registration' && due.email === mail('p1') && due.totalAmountPaid === 500 && due.eventTitle.startsWith('TEAM TEST offer') && due.teamSize === 1, r)
  r = await call('head1', 'PATCH', `/payments/${refundRow.id}/refund`); check('marked refunded', r.code === 200 && r.body.data.paymentStatus === 'REFUNDED', r)
  r = await call('admin', 'GET', '/payments/refunds'); check('no longer listed once refunded', r.code === 200 && !r.body.data.some((x) => x.id === refundRow.id), r)

  console.log('\n== Editing an event')
  const edited = { ...base, title: `TEAM TEST fest edited ${tag}`, location: 'QEEE Hall (JC BOSE Block)', capacity: 120, price: 300, upiQrUrl: qrPath, maxTeamSize: 3, schedule: [day('2026-12-01')] }
  r = await call('head2', 'PATCH', `/events/${E.fest}`, edited); check("another head can't edit -> 403", r.code === 403, r)
  r = await call('head1', 'PATCH', `/events/${E.fest}`, { ...edited, title: '' }); check('edit with no title -> 400', r.code === 400, r)
  r = await call('head1', 'PATCH', `/events/${E.fest}`, edited)
  check('edit saves title, venue, capacity, teams and a 1-day schedule', r.code === 200 && r.body.data.title === edited.title && r.body.data.location === edited.location && r.body.data.capacity === 120 && r.body.data.maxTeamSize === 3 && r.body.data.schedule.length === 1, r)
  r = await call('admin', 'PATCH', `/events/${E.fest}`, { ...edited, price: 0, upiQrUrl: null }); check('admin can edit any event (made free)', r.code === 200 && r.body.data.price === 0, r)

  console.log('\n== Event banner')
  const bannerUpload = (who, bytes) => upload(who, bytes, 'banner.png', 'image/png', 'banner')
  r = await bannerUpload('a1', PNG); check('student cannot upload a banner -> 403', r.code === 403, r)
  r = await bannerUpload('head1', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])); check('banner over 5 MB -> 400', r.code === 400 && /5 MB/.test(r.body.message), r)
  r = await bannerUpload('head1', Buffer.from('GIF89a')); check('non-image banner -> 400', r.code === 400 && /banner/i.test(r.body.message), r)
  r = await bannerUpload('head1', PNG); const bannerPath = r.body.data?.path
  check('banner upload returns its path', r.code === 201 && (process.env.CLOUDINARY_URL ? /\/swayam\/banner\/[0-9a-f-]{36}\.png$/ : /^\/api\/uploads\/banner\/[0-9a-f-]{36}\.png$/).test(bannerPath), r)
  const bannerEvent = { ...base, title: `TEAM TEST banner ${tag}`, schedule: undefined }
  r = await call('head1', 'POST', '/events', { ...bannerEvent, bannerUrl: '/api/uploads/banner/../../secret.png' }); check('bannerUrl not an upload or https -> 400', r.code === 400, r)
  r = await call('head1', 'POST', '/events', { ...bannerEvent, bannerUrl: bannerPath }); E.banner = r.body.data?.id; if (E.banner) eventIds.push(E.banner)
  check('event saves bannerUrl', r.code === 201 && r.body.data.bannerUrl === bannerPath, r)
  r = await call(null, 'GET', `/events/${E.banner}`); check('public event page data includes bannerUrl', r.body.data?.bannerUrl === bannerPath, r)
  r = await call(null, 'GET', `/events/${E.fest}`); check('event without a banner has bannerUrl null', r.code === 200 && r.body.data.bannerUrl === null, r)

  console.log('\n== UPI ID and payee name per event')
  r = await call('head1', 'POST', '/events', { ...bannerEvent, upiId: 'not a upi id' }); check('upiId without @bank -> 400', r.code === 400 && /upiId/.test(r.body.message), r)
  r = await call('head1', 'POST', '/events', { ...bannerEvent, upiPayeeName: 'x'.repeat(101) }); check('payee name over 100 characters -> 400', r.code === 400, r)
  r = await call('head1', 'PATCH', `/events/${E.banner}`, { ...bannerEvent, bannerUrl: bannerPath, upiId: ' swayam.ecell@okaxis ', upiPayeeName: ' Swayam E-Cell ' })
  check('edit saves upiId and upiPayeeName, trimmed', r.code === 200 && r.body.data.upiId === 'swayam.ecell@okaxis' && r.body.data.upiPayeeName === 'Swayam E-Cell', r)
  r = await call(null, 'GET', '/events'); const listed = r.body.data?.find((e) => e.id === E.banner)
  check('public event list carries the UPI details', listed?.upiId === 'swayam.ecell@okaxis' && listed.upiPayeeName === 'Swayam E-Cell', r)
  r = await call(null, 'GET', `/events/${E.fest}`); check('events without them have null', r.body.data?.upiId === null && r.body.data.upiPayeeName === null, r)

  console.log('\n== Attendee CSV export')
  await db.insert(registrations).values([
    { userId: U.x1, eventId: E.banner, paymentStatus: 'VERIFIED', attendedAt: new Date('2026-12-01T05:02:00Z') },
    { userId: U.x2, eventId: E.banner, paymentStatus: 'PENDING' },
  ])
  const [regX1] = await db.select({ id: registrations.id }).from(registrations).where(and(eq(registrations.eventId, E.banner), eq(registrations.userId, U.x1)))
  await db.update(users).set({ name: '=HYPERLINK("http://x")' }).where(eq(users.id, U.x2))
  const exportCsv = (who, id = E.banner) => fetch(`${server.api}/events/${id}/export`, { headers: auth(who) })
  let res = await exportCsv(null); check('logged out -> 401', res.status === 401)
  res = await exportCsv('a1'); check('student cannot export -> 403', res.status === 403)
  res = await exportCsv('head2'); check("another event head can't export it -> 403", res.status === 403)
  res = await exportCsv('admin', '00000000-0000-0000-0000-000000000000'); check('unknown event -> 404', res.status === 404)
  res = await exportCsv('admin'); check('admin can export any event', res.status === 200)
  res = await exportCsv('head1')
  check('own event head gets a CSV attachment', res.status === 200 && res.headers.get('content-type').startsWith('text/csv') && /^attachment; filename="TEAM TEST banner \d+ attendees\.csv"/.test(res.headers.get('content-disposition')))
  const bytes = Buffer.from(await res.arrayBuffer()) // res.text() would drop the byte-order mark
  check('starts with a UTF-8 byte-order mark for Excel', bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
  const csv = bytes.subarray(3).toString('utf8')
  const lines = csv.split('\r\n')
  check('header row', lines[0] === '"Student Name","Email","Phone","Roll Number","Branch","Year","Registration Code","Payment Status","Check-in Time (IST)"', { code: 200, body: { message: lines[0] } })
  const details = `"${PROFILE.phone}","${PROFILE.rollNumber}","${PROFILE.branch}","${PROFILE.year}"`
  check('checked-in student: profile, code and IST check-in time', lines.includes(`"x1 T","${mail('x1')}",${details},"${regX1.id.slice(0, 8).toUpperCase()}","VERIFIED","2026-12-01 10:32"`), { code: 200, body: { message: csv } })
  check('not checked in: Not Attended; formula-like name neutralised', lines.some((l) => l.startsWith(`"'=HYPERLINK(""http://x"")","${mail('x2')}"`) && l.endsWith('"PENDING","Not Attended"')), { code: 200, body: { message: csv } })
  check('one row per registration', lines.length === 3)

  console.log('\n== Registrations dashboard data')
  const regsUrl = `/events/${E.banner}/registrations`
  r = await call(null, 'GET', regsUrl); check('logged out -> 401', r.code === 401, r)
  r = await call('a1', 'GET', regsUrl); check('student -> 403', r.code === 403, r)
  r = await call('head2', 'GET', regsUrl); check("another event head can't see it -> 403", r.code === 403, r)
  r = await call('admin', 'GET', regsUrl); check('admin sees any event', r.code === 200, r)
  r = await call('head1', 'GET', regsUrl)
  const rowX1 = r.body.data?.registrations.find((x) => x.email === mail('x1'))
  check('own event head: one row per registration, newest first', r.code === 200 && r.body.data.registrations.length === 2 && r.body.data.registrations[0].email === mail('x2'), r)
  check('rows carry student details, code, payment and check-in', rowX1 && rowX1.phone === PROFILE.phone && rowX1.rollNumber === PROFILE.rollNumber && rowX1.branch === PROFILE.branch && rowX1.year === PROFILE.year
    && rowX1.code === regX1.id.slice(0, 8).toUpperCase() && rowX1.paymentStatus === 'VERIFIED' && rowX1.attendedAt && Array.isArray(rowX1.sessions), r)
  check('includes session bookings and a timestamp', Array.isArray(r.body.data?.bookings) && !Number.isNaN(Date.parse(r.body.data.updatedAt)), r)

  console.log('\n== All students (admin)')
  r = await call('head1', 'GET', '/analytics/students'); check('event head -> 403', r.code === 403, r)
  r = await call('admin', 'GET', '/analytics/students')
  const studentX1 = r.body.data?.find((s) => s.email === mail('x1'))
  check('admin: every account with details and the events it holds a seat for', r.code === 200 && studentX1?.phone === PROFILE.phone && studentX1.events.some((e) => e.eventId === E.banner && e.attended === true), r)

  if (!process.env.CLOUDINARY_URL) {
    const origin = server.api.replace(/\/api$/, '')
    check('banner image is served', (await fetch(origin + bannerPath)).status === 200)
    r = await call('head1', 'PATCH', `/events/${E.banner}`, bannerEvent); check('editing without a banner removes it', r.code === 200 && r.body.data.bannerUrl === null, r)
    check('the removed banner file is deleted', (await fetch(origin + bannerPath)).status === 404)
  }
} catch (err) {
  check(`unexpected error: ${err.message}`, false)
} finally {
  const evs = eventIds.length ? eventIds : ['00000000-0000-0000-0000-000000000000']
  const subs = await db.select({ id: subEvents.id }).from(subEvents).where(inArray(subEvents.eventId, evs))
  if (subs.length) await db.delete(subEventBookings).where(inArray(subEventBookings.subEventId, subs.map((s) => s.id)))
  await db.delete(subEvents).where(inArray(subEvents.eventId, evs))
  await db.delete(registrations).where(inArray(registrations.eventId, evs))
  await db.delete(events).where(inArray(events.id, evs))
  await db.delete(venues).where(like(venues.name, `%${tag}%`))
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
  for (const p of uploaded) await fs.rm(path.join(UPLOAD_DIR, p.replace('/api/uploads/', '')), { force: true })
  server.close()
  report('Temporary users, events, sessions, bookings, venues and uploaded files deleted.')
}
