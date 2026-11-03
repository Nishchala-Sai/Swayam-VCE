// Applies pending migrations in drizzle/ (npm run db:migrate; Render runs it before every start).
// Used instead of `drizzle-kit migrate`, whose progress spinner hides the actual error and leaves only "exit status 1".
// Prints which database it targets (host and name, never the password) and the full Postgres error on failure.
// Exits through process.exitCode, not process.exit(), which can crash Node on Windows while a request is closing.
import 'dotenv/config'
import path from 'node:path'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { migrate } from 'drizzle-orm/neon-http/migrator'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. On Render: Environment tab. Locally: backend/.env.')
  process.exitCode = 1
} else {
  await run(url)
}

async function run(url) {
  let target
  try {
    const u = new URL(url)
    target = `${u.host}${u.pathname}`
  } catch {
    console.error('DATABASE_URL is not a valid URL. Paste only the postgresql://... string, without quotes or a "psql" prefix.')
    process.exitCode = 1
    return
  }
  console.log(`Migrating ${target}`)

  const sql = neon(url)
  try {
    await migrate(drizzle({ client: sql }), { migrationsFolder: path.join(import.meta.dirname, '../drizzle') })
    const [last] = await sql.query('select count(*)::int as n from drizzle.__drizzle_migrations')
    console.log(`Migrations up to date (${last.n} applied).`)
  } catch (err) {
    const pg = err.cause ?? err
    console.error(`Migration failed: ${pg.message}`)
    if (pg.code) console.error(`Postgres code ${pg.code}${pg.detail ? `: ${pg.detail}` : ''}`)
    // 42P07 relation exists, 42710 type exists: tables made by `drizzle-kit push` with no migration history
    if (pg.code === '42P07' || pg.code === '42710') {
      console.error('The tables already exist but this database has no migration history. Run once: npm run db:baseline')
    }
    process.exitCode = 1
  }
}
