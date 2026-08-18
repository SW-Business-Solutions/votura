import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Alle Daten liegen lokal im Benutzerprofil — kein Cloud-Pfad, keine Netzlaufwerke
 * als Voraussetzung (§2.2).
 */
export interface AppPaths {
  root: string
  database: string
  logs: string
  exports: string
  backups: string
  temp: string
}

let cached: AppPaths | null = null

export function appPaths(): AppPaths {
  if (cached) return cached
  const root = app.getPath('userData')
  const paths: AppPaths = {
    root,
    database: join(root, 'data', 'wahlzettel.sqlite'),
    logs: join(root, 'logs'),
    exports: join(root, 'exports'),
    backups: join(app.getPath('documents'), 'Wahlzettel-Backups'),
    temp: join(root, 'tmp')
  }
  for (const directory of [join(root, 'data'), paths.logs, paths.exports, paths.temp]) {
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
  }
  cached = paths
  return paths
}

export function ensureDirectory(directory: string): string {
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
  return directory
}
