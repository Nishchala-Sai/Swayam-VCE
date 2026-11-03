// Shared setup for the live end-to-end suites. They start the real app in-process and call it over HTTP against a real
// Neon database, creating temporary users and events (emails end in @example.invalid) and deleting them afterwards.
//
// Database: TEST_DATABASE_URL if set (recommended: a Neon branch of production), otherwise DATABASE_URL from .env.
// While a suite runs, its rows are briefly visible in that database (e.g. in /api/analytics/overview).
import 'dotenv/config'
import jwt from 'jsonwebtoken'

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
for (const key of ['DATABASE_URL', 'JWT_SECRET', 'QR_SECRET']) {
  if (!process.env[key]) throw new Error(`${key} is not set (backend/.env)`)
}
const host = new URL(process.env.DATABASE_URL).host
console.log(`Live tests against ${host}${process.env.TEST_DATABASE_URL ? ' (TEST_DATABASE_URL)' : ' (DATABASE_URL)'}`)

// Imported after the env is final, because src/db/index.js reads DATABASE_URL when it loads
export const { db } = await import('../../src/db/index.js')
export const schema = await import('../../src/db/schema.js')
export const tickets = await import('../../src/utils/generateTicket.js')
const { app } = await import('../../src/app.js')

export function startServer() {
  const server = app.listen(0)
  return { api: `http://localhost:${server.address().port}/api`, close: () => server.close() }
}

// call('alice', 'POST', '/path', body) signs a 10-minute token for the user id registered under that name
export function makeClient(api, ids) {
  return async (who, method, path, body) => {
    const headers = { 'content-type': 'application/json' }
    if (who) headers.cookie = `token=${jwt.sign({ sub: ids[who] }, process.env.JWT_SECRET, { expiresIn: '10m' })}`
    const r = await fetch(api + path, { method, headers, body: body && JSON.stringify(body) })
    return { code: r.status, body: await r.json() }
  }
}

export function makeChecker() {
  let passed = 0
  let failed = 0
  const check = (label, cond, r) => {
    cond ? passed++ : failed++
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${r ? `  -> ${r.code} ${r.body.message ?? ''}` : ''}`)
    if (!cond && r) console.log('      ', JSON.stringify(r.body).slice(0, 400))
  }
  const report = (cleanupNote) => {
    console.log(`\n${passed} passed, ${failed} failed. ${cleanupNote}`)
    process.exitCode = failed ? 1 : 0
  }
  return { check, report }
}
