// Live suite 1: team registration, payment proof, EVENT_HEAD scope, capacity and refund overflow, main tickets,
// re-registering, reject-remaining, and race conditions. Run from backend/: npm run test:live
import { inArray } from 'drizzle-orm'
import { db, schema, tickets, startServer, makeClient, makeChecker, PROFILE } from './helpers.mjs'

const { users, events, registrations } = schema
const { verifyTicket } = tickets
const tag = Date.now(), userIds = [], eventIds = []
const U = {}, E = {}
const server = startServer()
const call = makeClient(server.api, U)
const { check, report } = makeChecker()
const mail = (n) => `final+${tag}-${n}@example.invalid`
const ev = async (key, by, capacity, price) => {
  const [e] = await db.insert(events).values({ title: `FINAL TEST ${key} ${tag}`, description: 't', date: new Date(Date.now() + 864e5), location: 't', capacity, price, upiQrUrl: price ? 'https://example.invalid/qr.png' : null, maxTeamSize: 11, createdBy: U[by] }).returning({ id: events.id })
  E[key] = e.id; eventIds.push(e.id)
}
try {
  const people = [['admin', 'ADMIN'], ['head1', 'EVENT_HEAD'], ['head2', 'EVENT_HEAD'], ...Array.from({ length: 8 }, (_, i) => [`s${i + 1}`, 'STUDENT']), ...Array.from({ length: 8 }, (_, i) => [`r${i + 1}`, 'STUDENT'])]
  const made = await db.insert(users).values(people.map(([n, role]) => ({ email: mail(n), name: `${n} T`, role, ...PROFILE }))).returning({ id: users.id, email: users.email })
  for (const [n] of people) { U[n] = made.find((u) => u.email === mail(n)).id; userIds.push(U[n]) }
  await ev('paidA', 'head1', 4, 100); await ev('free', 'admin', 10, 0); await ev('paidB', 'head2', 5, 100); await ev('race', 'admin', 5, 0); await ev('raceApprove', 'admin', 2, 50)

  console.log('\n== Team registration')
  let r = await call('s1', 'POST', `/registrations/${E.paidA}`)
  check('solo registration', r.code === 201 && r.body.data.teammates.length === 0 && r.body.data.paymentStatus === 'PENDING', r)
  const regS1 = r.body.data.id
  const bad = [
    ['empty teammateEmails', { teamName: 'X', teammateEmails: [] }],
    ['own email as teammate', { teamName: 'X', teammateEmails: [mail('s2')] }],
    ['duplicate teammate', { teamName: 'X', teammateEmails: [mail('s3'), mail('s3')] }],
    ['teammate without account', { teamName: 'X', teammateEmails: ['ghost@example.invalid'] }],
    ['team without teamName', { teammateEmails: [mail('s3')] }],
    ['teamName without teammates', { teamName: 'X' }],
  ]
  for (const [label, body] of bad) { r = await call('s2', 'POST', `/registrations/${E.paidA}`, body); check(label + ' -> 400', r.code === 400, r) }
  r = await call('s2', 'POST', `/registrations/${E.paidA}`, { teamName: 'Rocket', teammateEmails: [mail('s3'), mail('s4').toUpperCase()] })
  const team = r.body.data
  check('team of 3 (fills 4/4), linked by teamId, emails only on leader', r.code === 201 && team.teammates.length === 2 && team.isGroupLeader && team.teammates.every((t) => t.teamId === team.teamId && !t.isGroupLeader && t.teammateEmails === null) && team.teammateEmails.includes(mail('s4')), r)
  r = await call('s5', 'POST', `/registrations/${E.paidA}`, { teamName: 'Late', teammateEmails: [mail('s6')] })
  check('team of 2 when 0 seats left -> 400', r.code === 400 && /team of 2/.test(r.body.message), r)
  await call('s1', 'POST', `/registrations/${E.free}`)
  r = await call('s5', 'POST', `/registrations/${E.free}`, { teamName: 'Clash', teammateEmails: [mail('s6'), mail('s1')] })
  check('team containing an already-registered email -> 409', r.code === 409 && /One or more emails/.test(r.body.message), r)
  const partial = await db.select({ id: registrations.id }).from(registrations).where(inArray(registrations.userId, [U.s5, U.s6]))
  check('...and no rows were created for the rest of that team', partial.length === 0)
  r = await call('s6', 'POST', `/registrations/${E.free}`, { teamName: 'Freebies', teammateEmails: [mail('s8')] })
  check('free team: all VERIFIED, tickets for every member', r.code === 201 && r.body.data.ticket && r.body.data.teammates[0].ticket && r.body.data.teammates[0].paymentStatus === 'VERIFIED', r)

  console.log('\n== Payment proof (team)')
  const s3Reg = team.teammates.find((t) => t.userId === U.s3).id
  r = await call('s3', 'POST', `/payments/${s3Reg}/proof`, { utrNumber: '511111111111', totalAmountPaid: 300 }); check('teammate submits proof -> 403', r.code === 403, r)
  r = await call('s2', 'POST', `/payments/${team.id}/proof`, { utrNumber: '511111111112', totalAmountPaid: 300 }); check('leader submits proof', r.code === 200, r)

  console.log('\n== EVENT_HEAD scope')
  r = await call('head2', 'GET', '/payments/pending'); check('head2 queue excludes head1 event', r.code === 200 && !r.body.data.some((x) => x.event.id === E.paidA), r)
  r = await call('head1', 'GET', '/payments/pending')
  const q = r.body.data.filter((x) => x.event.id === E.paidA)
  check('head1 queue: team once (teamSize 3, totalAmountPaid 300) + solo', q.length === 2 && q[0].id === team.id && q[0].teamSize === 3 && q[0].totalAmountPaid === 300 && q[1].teamSize === 1, r)
  r = await call('s1', 'GET', '/payments/pending'); check('student -> 403', r.code === 403, r)
  r = await call('head2', 'PATCH', `/payments/${team.id}/verify`, { action: 'APPROVE' }); check('head2 verifies head1 event -> 403', r.code === 403, r)
  r = await call('head1', 'PATCH', `/payments/${s3Reg}/verify`, { action: 'APPROVE' }); check('verify a teammate row -> 400', r.code === 400, r)

  console.log('\n== Capacity + refund overflow')
  r = await call('head2', 'PATCH', `/events/${E.paidA}/capacity`, { capacity: 10 }); check('head2 changes head1 capacity -> 403', r.code === 403, r)
  r = await call('head1', 'PATCH', `/events/${E.paidA}/capacity`, { capacity: 0 }); check('capacity 0 -> 400', r.code === 400, r)
  r = await call('head1', 'PATCH', `/events/${E.paidA}/capacity`, { capacity: 3 }); check('head1 lowers capacity to 3 (below 4 taken)', r.code === 200 && r.body.data.capacity === 3, r)
  r = await call('head1', 'PATCH', `/payments/${team.id}/verify`, { action: 'APPROVE' })
  check('approve team of 3 (0 verified + 3 <= 3) -> whole team VERIFIED', r.code === 200 && r.body.data.paymentStatus === 'VERIFIED' && r.body.data.teammates.length === 2 && r.body.data.teammates.every((t) => t.paymentStatus === 'VERIFIED'), r)
  await call('s1', 'POST', `/payments/${regS1}/proof`, { utrNumber: '511111111113', totalAmountPaid: 300 })
  r = await call('head1', 'PATCH', `/payments/${regS1}/verify`, { action: 'APPROVE' })
  check('approve solo when 3/3 verified -> REFUND_REQUIRED + CANCELLED', r.code === 200 && r.body.data.paymentStatus === 'REFUND_REQUIRED' && r.body.data.status === 'CANCELLED' && /REFUND_REQUIRED/.test(r.body.message), r)

  console.log('\n== Tickets')
  r = await call('s3', 'GET', `/registrations/${s3Reg}/ticket`)
  check('teammate gets own ticket after leader approved', r.code === 200 && verifyTicket(r.body.data.qrPayload)?.registrationId === s3Reg, r)
  const p = r.body.data.qrPayload
  check('tampered signature rejected', verifyTicket(p.slice(0, -2) + (p.endsWith('AA') ? 'BB' : 'AA')) === null)
  check('signature moved onto another registration id rejected', verifyTicket(Buffer.from(regS1).toString('base64url') + '.' + p.split('.')[1]) === null)
  r = await call('s2', 'GET', `/registrations/${s3Reg}/ticket`); check('someone else ticket -> 404', r.code === 404, r)
  r = await call('s1', 'GET', `/registrations/${regS1}/ticket`); check('cancelled (refund) registration -> 409', r.code === 409, r)

  console.log('\n== Re-registering')
  r = await call('s1', 'POST', `/registrations/${E.paidA}`); check('refund pending -> cannot re-register (409)', r.code === 409 && /refund/i.test(r.body.message), r)
  r = await call('s7', 'POST', `/registrations/${E.paidB}`); const s7First = r.body.data.id
  await call('s7', 'POST', `/payments/${s7First}/proof`, { utrNumber: '511111111114', totalAmountPaid: 300 })
  r = await call('head2', 'PATCH', `/payments/${s7First}/verify`, { action: 'REJECT' }); check('head2 rejects s7 (own event)', r.code === 200 && r.body.data.status === 'CANCELLED', r)
  r = await call('s7', 'POST', `/registrations/${E.paidB}`)
  check('rejected student re-registers: same row reactivated, PENDING, UTR cleared', r.code === 201 && r.body.data.id === s7First && r.body.data.paymentStatus === 'PENDING' && r.body.data.utrNumber === null && r.body.data.reviewedBy === null, r)
  r = await call('s7', 'POST', `/registrations/${E.paidB}`); check('registering again while active -> 409', r.code === 409, r)

  console.log('\n== Reject remaining')
  r = await call('s8', 'POST', `/registrations/${E.paidB}`); await call('s8', 'POST', `/payments/${r.body.data.id}/proof`, { utrNumber: '511111111115', totalAmountPaid: 300 })
  r = await call('head1', 'POST', `/payments/${E.paidB}/reject-remaining`); check('head1 closes head2 event -> 403', r.code === 403, r)
  r = await call('head2', 'POST', `/payments/${E.paidB}/reject-remaining`)
  check('closes: s8 (UTR) -> REFUND_REQUIRED, s7 (no UTR) -> REJECTED', r.code === 200 && r.body.data.refundRequired === 1 && r.body.data.rejected === 1, r)

  console.log('\n== Races (simultaneous requests)')
  const teams = [['r1', 'r2'], ['r3', 'r4'], ['r5', 'r6'], ['r7', 'r8']]
  const raced = await Promise.all(teams.map(([lead, mate], i) => call(lead, 'POST', `/registrations/${E.race}`, { teamName: `T${i}`, teammateEmails: [mail(mate)] })))
  const rows = await db.select({ id: registrations.id }).from(registrations).where(inArray(registrations.eventId, [E.race]))
  const won = raced.filter((x) => x.code === 201).length
  check(`4 teams of 2 at once for 5 seats -> exactly 2 teams, 4 rows (got ${won} teams, ${rows.length} rows)`, won === 2 && rows.length === 4)
  const a = (await call('r1', 'POST', `/registrations/${E.raceApprove}`)).body.data.id
  const b = (await call('r3', 'POST', `/registrations/${E.raceApprove}`)).body.data.id
  await call('r1', 'POST', `/payments/${a}/proof`, { utrNumber: '511111111116', totalAmountPaid: 300 }); await call('r3', 'POST', `/payments/${b}/proof`, { utrNumber: '511111111117', totalAmountPaid: 300 })
  await call('admin', 'PATCH', `/events/${E.raceApprove}/capacity`, { capacity: 1 })
  const both = await Promise.all([a, b].map((id) => call('admin', 'PATCH', `/payments/${id}/verify`, { action: 'APPROVE' })))
  const st = both.map((x) => x.body.data?.paymentStatus).sort().join(',')
  check(`2 approvals at once for 1 seat -> one VERIFIED, one REFUND_REQUIRED (got ${st})`, st === 'REFUND_REQUIRED,VERIFIED')
} catch (err) {
  check(`suite crashed: ${err.message}`, false)
  console.error(err)
} finally {
  server.close()
  if (eventIds.length) await db.delete(registrations).where(inArray(registrations.eventId, eventIds))
  if (eventIds.length) await db.delete(events).where(inArray(events.id, eventIds))
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
  const left = userIds.length ? await db.select({ id: users.id }).from(users).where(inArray(users.id, userIds)) : []
  report(`Cleanup: removed ${userIds.length} test users, ${eventIds.length} test events and their registrations; leftovers: ${left.length}`)
}
