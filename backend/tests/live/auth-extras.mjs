// Live suite 3: profile name, Google-only sign-in (removed password endpoints, Google guards, emergency login links),
// seat availability. Run from backend/: npm run test:live
//
// Requests come from made-up client IPs (X-Forwarded-For with TRUST_PROXY=1) so each check gets its own rate-limit
// bucket; one check uses a single IP on purpose to prove the limiter works.
process.env.TRUST_PROXY = '1'
const { inArray } = await import('drizzle-orm')
const jwt = (await import('jsonwebtoken')).default
const { db, schema, startServer, makeChecker } = await import('./helpers.mjs')
const { createLoginLink } = await import('../../src/modules/auth/loginLink.controller.js')

const { users, events, registrations } = schema
const tag = Date.now(), userIds = [], eventIds = []
const server = startServer()
const { check, report } = makeChecker()
const mail = (n) => `auth+${tag}-${n}@example.invalid`
let ipCounter = 1
const freshIp = () => `10.99.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`
const session = (id) => `token=${jwt.sign({ sub: id }, process.env.JWT_SECRET, { expiresIn: '10m' })}`

// Returns { code, body, cookie, location }; pass { cookie, ip } to reuse a session or a client IP
async function call(method, path, body, { cookie, ip = freshIp() } = {}) {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip }
  if (cookie) headers.cookie = cookie
  const r = await fetch(server.api + path, { method, headers, body: body && JSON.stringify(body), redirect: 'manual' })
  const text = await r.text()
  let json = {}
  try { json = JSON.parse(text) } catch { /* redirects have no JSON body */ }
  return { code: r.status, body: json, cookie: r.headers.get('set-cookie')?.split(';')[0], location: r.headers.get('location') }
}
// The path part of a login link, to call on the test server
const linkPath = (link) => link.slice(link.indexOf('/api/') + 4)

try {
  const [a, inactive] = await db.insert(users).values([{ email: mail('a') }, { email: mail('inactive'), isActive: false }]).returning({ id: users.id })
  userIds.push(a.id, inactive.id)
  const cookieA = session(a.id)

  console.log('\n== Profile name (PATCH /api/auth/me)')
  let r = await call('PATCH', '/auth/me', { name: 'Anika Rao' }); check('set name without a session -> 401', r.code === 401, r)
  r = await call('PATCH', '/auth/me', { name: '   ' }, { cookie: cookieA }); check('blank name -> 400', r.code === 400, r)
  r = await call('PATCH', '/auth/me', { name: 'x'.repeat(101) }, { cookie: cookieA }); check('name over 100 characters -> 400', r.code === 400, r)
  r = await call('PATCH', '/auth/me', { name: '  Anika Rao ' }, { cookie: cookieA }); check('set name (trimmed)', r.code === 200 && r.body.data.name === 'Anika Rao', r)
  r = await call('GET', '/auth/me', null, { cookie: cookieA }); check('GET /me includes name, never a password hash', r.code === 200 && r.body.data.name === 'Anika Rao' && !('passwordHash' in r.body.data), r)

  console.log('\n== Password sign-in is gone')
  for (const path of ['/auth/register', '/auth/login', '/auth/forgot-password', '/auth/reset-password']) {
    r = await call('POST', path, { email: mail('a'), password: 'whatever-123' })
    check(`POST ${path} -> 404`, r.code === 404, r)
  }

  console.log('\n== Emergency login links (npm run login-link)')
  const link = createLoginLink(a.id)
  check('link points at the site\'s /api/auth/link', /\/api\/auth\/link\?token=[\w-]+\.[\w-]+\.[\w-]+$/.test(link))
  r = await call('GET', linkPath(link))
  check('valid link -> session cookie, redirect to /dashboard', r.code === 302 && r.location.endsWith('/dashboard') && r.cookie?.startsWith('token='), r)
  const fromLink = await call('GET', '/auth/me', null, { cookie: r.cookie })
  check('the cookie it sets is a working session', fromLink.code === 200 && fromLink.body.data.id === a.id, fromLink)
  const linkToken = new URL(link).searchParams.get('token')
  r = await call('GET', '/auth/me', null, { cookie: `token=${linkToken}` }); check('a link token is not accepted as a session cookie', r.code === 401, r)
  const expired = jwt.sign({ sub: a.id, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET, { audience: 'login-link' })
  r = await call('GET', `/auth/link?token=${expired}`); check('expired link -> back to /login?link=invalid, no cookie', r.code === 302 && r.location.endsWith('/login?link=invalid') && !r.cookie, r)
  r = await call('GET', `/auth/link?token=${session(a.id).slice(6)}`); check('a session token is not a login link', r.code === 302 && r.location.endsWith('/login?link=invalid') && !r.cookie, r)
  const forged = jwt.sign({ sub: a.id }, 'not-the-secret', { audience: 'login-link', expiresIn: '10m' })
  r = await call('GET', `/auth/link?token=${forged}`); check('forged link -> invalid', r.code === 302 && r.location.endsWith('/login?link=invalid') && !r.cookie, r)
  r = await call('GET', linkPath(createLoginLink(inactive.id))); check('deactivated account -> invalid', r.code === 302 && r.location.endsWith('/login?link=invalid') && !r.cookie, r)
  r = await call('GET', '/auth/link'); check('no token -> invalid', r.code === 302 && r.location.endsWith('/login?link=invalid'), r)
  const sameIp = freshIp(), burst = []
  for (let i = 0; i < 11; i++) burst.push((await call('GET', `/auth/link?token=${expired}`, null, { ip: sameIp })).code)
  check(`rate limit: 11th link request from one IP -> 429 (got ${burst.join(',')})`, burst.slice(0, 10).every((c) => c === 302) && burst[10] === 429)

  console.log('\n== Google sign-in guards')
  const savedProject = process.env.FIREBASE_PROJECT_ID
  delete process.env.FIREBASE_PROJECT_ID
  r = await call('POST', '/auth/google-login', { idToken: 'anything' }); check('not configured -> 503', r.code === 503, r)
  process.env.FIREBASE_PROJECT_ID = 'swayam-live-test'
  r = await call('POST', '/auth/google-login', {}); check('missing idToken -> 400', r.code === 400, r)
  const quiet = console.warn
  console.warn = () => {} // the rejection is logged on purpose; not useful here
  r = await call('POST', '/auth/google-login', { idToken: 'not.a.real-token' }); check('forged token -> 401', r.code === 401, r)
  console.warn = quiet
  if (savedProject === undefined) delete process.env.FIREBASE_PROJECT_ID
  else process.env.FIREBASE_PROJECT_ID = savedProject

  console.log('\n== Seat availability')
  const [ev] = await db.insert(events).values({ title: `AUTH TEST ${tag}`, description: 't', date: new Date(Date.now() + 864e5), location: 't', capacity: 5, price: 0, createdBy: a.id }).returning({ id: events.id })
  eventIds.push(ev.id)
  const [u2, u3] = await db.insert(users).values([{ email: mail('b') }, { email: mail('c') }]).returning({ id: users.id })
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
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
  const left = userIds.length ? await db.select({ id: users.id }).from(users).where(inArray(users.id, userIds)) : []
  report(`Cleanup: removed ${userIds.length} test users, ${eventIds.length} test event and their rows; leftovers: ${left.length}`)
}
