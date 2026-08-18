/**
 * Dünner Port über die SQLite-Bindung.
 *
 * Standard ist das in Node/Electron eingebaute `node:sqlite` — damit braucht die
 * Anwendung KEINE nativen Build-Tools und der Windows-Installer bleibt frei von
 * ABI-Abhängigkeiten. Ist `better-sqlite3` im Projekt vorhanden, wird es
 * bevorzugt genutzt. Der übrige Code kennt nur dieses Interface.
 */
import { createRequire } from 'node:module'

export type SqlValue = string | number | bigint | null | Uint8Array

export interface SqlStatement {
  run(...params: SqlValue[]): { changes: number }
  get<T = Record<string, SqlValue>>(...params: SqlValue[]): T | undefined
  all<T = Record<string, SqlValue>>(...params: SqlValue[]): T[]
}

export interface SqlDatabase {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
  transaction<T>(work: () => T): T
  close(): void
  readonly driver: 'node:sqlite' | 'better-sqlite3'
}

const require_ = createRequire(import.meta.url)

interface BetterSqlite3Statement {
  run(...params: unknown[]): { changes: number }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

interface BetterSqlite3Database {
  exec(sql: string): void
  prepare(sql: string): BetterSqlite3Statement
  close(): void
}

export function openDatabase(file: string): SqlDatabase {
  const better = tryOpenBetterSqlite3(file)
  if (better) return better
  return openNodeSqlite(file)
}

function tryOpenBetterSqlite3(file: string): SqlDatabase | null {
  try {
    const BetterSqlite3 = require_('better-sqlite3') as new (path: string) => BetterSqlite3Database
    const db = new BetterSqlite3(file)
    return wrap(db, 'better-sqlite3')
  } catch {
    return null
  }
}

function openNodeSqlite(file: string): SqlDatabase {
  const { DatabaseSync } = require_('node:sqlite') as {
    DatabaseSync: new (path: string) => BetterSqlite3Database
  }
  const db = new DatabaseSync(file)
  return wrap(db, 'node:sqlite')
}

function wrap(db: BetterSqlite3Database, driver: SqlDatabase['driver']): SqlDatabase {
  let depth = 0
  return {
    driver,
    exec(sql) {
      db.exec(sql)
    },
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        run: (...params) => statement.run(...params),
        get: <T>(...params: SqlValue[]) => statement.get(...params) as T | undefined,
        all: <T>(...params: SqlValue[]) => statement.all(...params) as T[]
      }
    },
    transaction<T>(work: () => T): T {
      // Verschachtelte Transaktionen über SAVEPOINT, damit Services sich
      // gefahrlos gegenseitig aufrufen können.
      if (depth > 0) {
        const name = `sp_${depth}`
        depth += 1
        db.exec(`SAVEPOINT ${name}`)
        try {
          const result = work()
          db.exec(`RELEASE ${name}`)
          return result
        } catch (error) {
          db.exec(`ROLLBACK TO ${name}`)
          db.exec(`RELEASE ${name}`)
          throw error
        } finally {
          depth -= 1
        }
      }
      depth = 1
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = work()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      } finally {
        depth = 0
      }
    },
    close() {
      db.close()
    }
  }
}

/** Wandelt JS-Werte in SQLite-taugliche Parameter (Boolean -> 0/1, undefined -> null). */
export function toSql(value: unknown): SqlValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value
  if (value instanceof Uint8Array) return value
  return JSON.stringify(value)
}

export function toSqlArgs(values: unknown[]): SqlValue[] {
  return values.map(toSql)
}

export function fromJson<T>(value: SqlValue | undefined, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function toBool(value: SqlValue | undefined): boolean {
  return value === 1 || value === '1'
}

export function optionalNumber(value: SqlValue | undefined): number | undefined {
  return value === null || value === undefined ? undefined : Number(value)
}

export function optionalString(value: SqlValue | undefined): string | undefined {
  return value === null || value === undefined ? undefined : String(value)
}
