// Live suite 3: profile name, password reset, Google sign-in guards, seat availability. Run from backend/: npm run test:live
//
// Requests come from made-up client IPs (X-Forwarded-For with TRUST_PROXY=1) so each check gets its own rate-limit
// bucket; one check uses a single IP on purpose to prove the limiter works.
process.env.TRUST_PROXY = '1'
const { inArray, eq } = await import('drizzle-orm')
const { db, schema, startServer, makeChecker } = await import('./helpers.mjs')

const { users, events, registrations, passwordResetTokens } = schema
const tag = Date.now(), userIds = [], eventIds = []
const server = startServer()
const { check, report } = makeChecker()
const mail = (n) => `auth+${tag}-${n}@example.invalid`
const TURNSTILE = 'XXXX.DUMMY.TOKEN.XXXX' // accepted by Cloudflare's test secret
let ipCounter = 1
const freshIp = () => `10.99.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`

// Returns { code, body, cookie }; pass { cookie, ip } to reuse a session or a client IP
async function call(method, path, body, { cookie, ip = freshIp() } = {}) {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip }
  if (cookie) headers.cookie = cookie
  const r = await fetch(server.api + path, { method, headers, body: body && JSON.stringify(body) })
  return { code: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }
}

// Without BREVO_SMTP_USER/BREVO_SMTP_PASS the reset email is printed with console.log; capture it while the request runs
async function requestReset(email) {
  const original = console.log
  let link = null
  console.log = (...args) => { const s = args.join(' '); if (s.startsWith('[email not sent') && s.includes('Reset your Swayam password')) link = s; else original(...args) }
  try {
    const r = await call('POST', '/auth/forgot-password', { email, turnstileToken: TURNSTILE })
    return { ...r, token: link?.match(/token=(\S+)/)?.[1] ?? null, link }
  } finally {
    console.log = original
  }
}

try {
  console.log('\n== Signup name (PATCH /api/auth/me)')
  let r = await call('POST', '/auth/register', { email: mail('a'), password: 'first-pass-1', turnstileToken: TURNSTILE })
  check('register', r.code === 201, r)
  const userA = r.body.data.id; userIds.push(userA)
  const cookieA = r.cookie
  r = await call('PATCH', '/auth/me', { name: 'Anika Rao' }); check('set name without a session -> 401', r.code === 401, r)
  r = await call('PATCH', '/auth/me', { name: '   ' }, { cookie: cookieA }); check('blank name -> 400', r.code === 400, r)
  r = await call('PATCH', '/auth/me', { name: 'x'.repeat(101) }, { cookie: cookieA }); check('name over 100 characters -> 400', r.code === 400, r)
  r = await call('PATCH', '/auth/me', { name: '  Anika Rao ' }, { cookie: cookieA }); check('set name (trimmed)', r.code === 200 && r.body.data.name === 'Anika Rao', r)
  r = await call('GET', '/auth/me', null, { cookie: cookieA }); check('GET /me includes name, never the password hash', r.code === 200 && r.body.data.name === 'Anika Rao' && !('passwordHash' in r.body.data), r)

  console.log('\n== Forgot password')
  r = await call('POST', '/auth/forgot-password', { email: 'not-an-email', turnstileToken: TURNSTILE }); check('invalid email -> 400', r.code === 400, r)
  r = await call('POST', '/auth/forgot-password', { email: mail('a') }); check('missing CAPTCHA -> 403', r.code === 403, r)
  const unknown = await requestReset(mail('nobody'))
  check('unknown email -> same 200 answer, no link', unknown.code === 200 && unknown.token === null, unknown)
  const first = await requestReset(mail('a'))
  check('known email -> same 200 answer, link printed', first.code === 200 && first.body.message === unknown.body.message && first.token && first.link.includes('/reset-password?token='), first)
  const stored = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, userA))
  check('only the SHA-256 of the token is stored, expiring in ~30 minutes', stored.length === 1 && stored[0].tokenHash !== first.token && stored[0].tokenHash.length === 64 && Math.abs(new Date(stored[0].expiresAt) - Date.now() - 30 * 60e3) < 60e3)
  const second = await requestReset(mail('a'))
  const afterSecond = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, userA))
  check('a new request replaces the old link', afterSecond.length === 1 && second.token !== first.token)

  console.log('\n== Reset password')
  r = await call('POST', '/auth/reset-password', { token: first.token, password: 'second-pass-2' }); check('superseded link -> 400', r.code === 400, r)
  r = await call('POST', '/auth/reset-password', { token: 'short', password: 'second-pass-2' }); check('malformed token -> 400', r.code === 400, r)
  r = await call('POST', '/auth/reset-password', { token: second.token, password: 'short' }); check('password under 8 characters -> 400', r.code === 400, r)
  r = await call('POST', '/auth/reset-password', { token: second.token, password: 'é'.repeat(40) }); check('password over 72 bytes -> 400', r.code === 400, r)
  r = await call('POST', '/auth/reset-password', { token: second.token, password: 'second-pass-2' }); check('valid link -> password changed', r.code === 200, r)
  r = await call('POST', '/auth/reset-password', { token: second.token, password: 'third-pass-3' }); check('same link again -> 400 (single use)', r.code === 400, r)
  r = await call('POST', '/auth/login', { email: mail('a'), password: 'first-pass-1', turnstileToken: TURNSTILE }); check('old password no longer works', r.code === 401, r)
  r = await call('POST', '/auth/login', { email: mail('a'), password: 'second-pass-2', turnstileToken: TURNSTILE }); check('new password works', r.code === 200, r)
  const third = await requestReset(mail('a'))
  await db.update(passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResetTokens.userId, userA))
  r = await call('POST', '/auth/reset-password', { token: third.token, password: 'fourth-pass-4' }); check('expired link -> 400', r.code === 400, r)
  const [inactive] = await db.insert(users).values({ email: mail('inactive'), passwordHash: 'x', isActive: false }).returning({ id: users.id })
  userIds.push(inactive.id)
  const inactiveReset = await requestReset(mail('inactive'))
  check('deactivated account -> same answer, no link', inactiveReset.code === 200 && inactiveReset.token === null, inactiveReset)
  const sameIp = freshIp()
  const burst = [], quiet = console.log
  console.log = () => {} // the burst prints five real reset links; not useful here
  for (let i = 0; i < 6; i++) burst.push((await call('POST', '/auth/forgot-password', { email: mail('a'), turnstileToken: TURNSTILE }, { ip: sameIp })).code)
  console.log = quiet
  check(`rate limit: 6th request from one IP -> 429 (got ${burst.join(',')})`, burst.slice(0, 5).every((c) => c === 200) && burst[5] === 429)

  console.log('\n== Google sign-in guards')
  const savedProject = process.env.FIREBASE_PROJECT_ID
  delete process.env.FIREBASE_PROJECT_ID
  r = await call('POST', '/auth/google-login', { idToken: 'anything' }); check('not configured -> 503', r.code === 503, r)
  process.env.FIREBASE_PROJECT_ID = 'swayam-live-test'
  r = await call('POST', '/auth/google-login', {}); check('missing idToken -> 400', r.code === 400, r)
  r = await call('POST', '/auth/google-login', { idToken: 'not.a.real-token' }); check('forged token -> 401', r.code === 401, r)
  if (savedProject === undefined) delete process.env.FIREBASE_PROJECT_ID
  else process.env.FIREBASE_PROJECT_ID = savedProject

  console.log('\n== Seat availability')
  const [ev] = await db.insert(events).values({ title: `AUTH TEST ${tag}`, description: 't', date: new Date(Date.now() + 864e5), location: 't', capacity: 5, price: 0, createdBy: userA }).returning({ id: events.id })
  eventIds.push(ev.id)
  const [u2, u3] = await db.insert(users).values([{ email: mail('b'), passwordHash: 'x' }, { email: mail('c'), passwordHash: 'x' }]).returning({ id: users.id })
  userIds.push(u2.id, u3.id)
  await db.insert(registrations).values([
    { userId: u2.id, eventId: ev.id, paymentStatus: 'VERIFIED' },
    { userId: u3.id, eventId: ev.id, status: 'CANCELLED', paymentStatus: 'REJECTED' },
  ])
  r = await call('GET', '/events/availability')
  const mine = r.body.data?.find((x) => x.eventId === ev.id)
  check('public, counts only CONFIRMED seats', r.code === 200 && mine?.capacity === 5 && mine.seatsTaken === 1 && mine.seatsLeft === 4, r)
  r = await call('GET', `/events/${ev.id}`); check('GET /events/:id still works next to /availability', r.code === 200 && r.body.data.id === ev.id, r)
} catch (err) {
  check(`suite crashed: ${err.message}`, false)
  console.error(err)
} finally {
  server.close()
  if (eventIds.length) await db.delete(registrations).where(inArray(registrations.eventId, eventIds))
  if (eventIds.length) await db.delete(events).where(inArray(events.id, eventIds))
  if (userIds.length) await db.delete(passwordResetTokens).where(inArray(passwordResetTokens.userId, userIds))
  // Users created through /register in this run are found by their test email
  const created = await db.select({ id: users.id }).from(users).where(inArray(users.email, ['a', 'nobody'].map(mail)))
  const allIds = [...new Set([...userIds, ...created.map((u) => u.id)])]
  if (allIds.length) await db.delete(passwordResetTokens).where(inArray(passwordResetTokens.userId, allIds))
  if (allIds.length) await db.delete(users).where(inArray(users.id, allIds))
  const left = allIds.length ? await db.select({ id: users.id }).from(users).where(inArray(users.id, allIds)) : []
  report(`Cleanup: removed ${allIds.length} test users, ${eventIds.length} test event and their rows; leftovers: ${left.length}`)
}
