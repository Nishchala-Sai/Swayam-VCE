// One-off, for a database whose tables were created with `drizzle-kit push` before migrations existed:
//   npm run db:baseline
// Records drizzle/0000_init.sql as already applied, without running it, so `npm run db:migrate` skips it instead of
// failing on "relation already exists". Later migrations then run normally.
//
// Refuses unless every enum, table and column in the 0000 snapshot already exists in the database, so it can never
// hide a missing table. Does nothing if the database already has migration history. Safe to run twice.
//
// Drizzle's migrator only compares created_at (the journal's "when") with the newest row in
// drizzle.__drizzle_migrations; the hash is stored the same way it stores it (SHA-256 of the .sql file).
// Exits through process.exitCode, not process.exit(), which can crash Node on Windows while a request is closing.
import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { neon } from '@neondatabase/serverless'

const DIR = path.join(import.meta.dirname, '../drizzle')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (backend/.env)')
const sql = neon(process.env.DATABASE_URL)
console.log(`Database: ${new URL(process.env.DATABASE_URL).host}`)

const journal = JSON.parse(fs.readFileSync(path.join(DIR, 'meta/_journal.json'), 'utf8'))
const first = journal.entries.find((e) => e.idx === 0)
if (!first) throw new Error('drizzle/meta/_journal.json has no first migration. Run npm run db:generate first.')

await sql.query('create schema if not exists drizzle')
await sql.query('create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)')
const [done] = await sql.query('select count(*)::int as n from drizzle.__drizzle_migrations')
if (done.n > 0) console.log(`Nothing to do: the database already has ${done.n} migration(s) recorded.`)
else await baseline()

async function baseline() {
  const snapshot = JSON.parse(fs.readFileSync(path.join(DIR, `meta/${String(first.idx).padStart(4, '0')}_snapshot.json`), 'utf8'))

  // Everything the first migration would create must already be there
  const columns = await sql.query(`select table_name, column_name from information_schema.columns where table_schema = 'public'`)
  const enums = await sql.query(`select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'e'`)
  const have = new Set(columns.map((c) => `${c.table_name}.${c.column_name}`))
  const haveTables = new Set(columns.map((c) => c.table_name))
  const haveEnums = new Set(enums.map((e) => e.typname))
  const missing = [
    ...Object.values(snapshot.enums).filter((e) => !haveEnums.has(e.name)).map((e) => `enum ${e.name}`),
    ...Object.values(snapshot.tables).flatMap((t) =>
      !haveTables.has(t.name) ? [`table ${t.name}`] : Object.keys(t.columns).filter((c) => !have.has(`${t.name}.${c}`)).map((c) => `column ${t.name}.${c}`),
    ),
  ]
  if (missing.length) {
    console.error(`Not baselined. The database is missing:\n  ${missing.join('\n  ')}`)
    console.error('An empty database needs no baseline: run npm run db:migrate. Otherwise bring it up to date first.')
    process.exitCode = 1
    return
  }

  const migrationSql = fs.readFileSync(path.join(DIR, `${first.tag}.sql`)).toString()
  const hash = crypto.createHash('sha256').update(migrationSql).digest('hex')
  await sql.query('insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)', [hash, first.when])
  console.log(`Baselined: ${first.tag} recorded as applied (${Object.keys(snapshot.tables).length} tables checked). Run npm run db:migrate from now on.`)
}
