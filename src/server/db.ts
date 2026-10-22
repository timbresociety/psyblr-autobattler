import { readFileSync } from 'node:fs'
import { Pool } from '@neondatabase/serverless'

/** The one database call the store needs; Neon's Pool and PGlite both satisfy it. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

export const SCHEMA_SQL = readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8')

let db: Promise<Db> | undefined

/** Production database: Postgres from the Vercel Marketplace (Neon), schema ensured once per instance. */
export function getDb(): Promise<Db> {
  db ??= (async () => {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    const pool = new Pool({ connectionString: url })
    try {
      await pool.query(SCHEMA_SQL)
    } catch (error) {
      await pool.end().catch(() => undefined)
      throw error
    }
    return pool as unknown as Db
  })().catch((error) => {
    // a failed connect must not stay cached for the instance's lifetime
    db = undefined
    throw error
  })
  return db
}

/** Development server only: serve the API from an in-memory database (scripts/dev-api.ts). */
export function useDevDb(dev: Promise<Db>): void {
  db = dev
}
