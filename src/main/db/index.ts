import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { openDatabase, type SqlDatabase } from './driver'
import { MIGRATIONS, SCHEMA_VERSION } from './schema'
import { logger } from '../logger'

let database: SqlDatabase | null = null

export function initDatabase(file: string): SqlDatabase {
  const directory = dirname(file)
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })

  const db = openDatabase(file)
  // WAL: robust gegen Absturz mitten im Schreibvorgang (§34).
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA synchronous = FULL')
  db.exec('PRAGMA busy_timeout = 5000')

  migrate(db)
  database = db
  logger.info(`Datenbank geöffnet (${db.driver}): ${file}`)
  return db
}

function migrate(db: SqlDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  const row = db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get<{ value: string }>('version')
  const current = row ? Number(row.value) : 0

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    db.transaction(() => {
      db.exec(migration.sql)
      db.prepare(
        `INSERT INTO schema_meta (key, value) VALUES ('version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(String(migration.version))
    })
    logger.info(`Migration auf Version ${migration.version} angewendet`)
  }

  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Die Datenbank hat Schemaversion ${current}, diese Anwendung unterstützt maximal ${SCHEMA_VERSION}. Bitte aktuellere Programmversion verwenden.`
    )
  }
}

export function db(): SqlDatabase {
  if (!database) throw new Error('Datenbank ist nicht initialisiert.')
  return database
}

export function closeDatabase(): void {
  if (database) {
    try {
      database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      // Checkpoint ist best effort.
    }
    database.close()
    database = null
  }
}

/** Konsistente Kopie der laufenden Datenbank (für Backup/Archiv). */
export function backupDatabaseTo(target: string): void {
  const escaped = target.replace(/'/g, "''")
  db().exec(`VACUUM INTO '${escaped}'`)
}

export type { SqlDatabase } from './driver'
