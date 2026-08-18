import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

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

/**
 * Übernahme aus der Zeit vor der Umbenennung in Votura.
 *
 * Der Datenordner heißt nach dem Produktnamen. Ohne diesen Schritt stünde nach
 * einem Programmwechsel eine leere Datenbank da, während die alten Daten
 * unbemerkt daneben lägen. Kopiert wird nur einmal und nur, solange der neue
 * Ordner noch leer ist; der alte Bestand bleibt unangetastet.
 */
function uebernehmeAltenBestand(root: string): void {
  const alt = join(dirname(root), 'Wahlzettel')
  if (alt === root || !existsSync(alt)) return
  if (existsSync(join(root, 'data')) && readdirSync(join(root, 'data')).length > 0) return
  try {
    cpSync(alt, root, { recursive: true, force: false, errorOnExist: false })
  } catch {
    // Eine fehlgeschlagene Übernahme darf den Start nicht verhindern — die
    // Anwendung beginnt dann mit einer leeren Datenbank.
  }
}

export function appPaths(): AppPaths {
  if (cached) return cached
  const root = app.getPath('userData')
  uebernehmeAltenBestand(root)
  const paths: AppPaths = {
    root,
    database: join(root, 'data', 'wahlzettel.sqlite'),
    logs: join(root, 'logs'),
    exports: join(root, 'exports'),
    backups: join(app.getPath('documents'), 'Votura-Backups'),
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
