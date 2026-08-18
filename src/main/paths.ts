import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Alle Daten liegen lokal — kein Cloud-Pfad, keine Netzlaufwerke als
 * Voraussetzung (§2.2).
 *
 * Bei der **portablen Fassung** liegen sie neben der Programmdatei, damit
 * Programm und Daten zusammen auf einem USB-Stick bleiben und der Rechner, an
 * dem gearbeitet wurde, nichts zurückbehält. Bei der installierten Fassung
 * liegen sie wie gewohnt im Benutzerprofil.
 */
export interface AppPaths {
  root: string
  /** true, wenn neben der Programmdatei gearbeitet wird (portable Fassung). */
  portable: boolean
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

/** Lässt sich in diesem Ordner wirklich schreiben? (Schreibgeschützter Stick, fremder Rechner.) */
function beschreibbar(ordner: string): boolean {
  try {
    mkdirSync(ordner, { recursive: true })
    const probe = join(ordner, '.schreibprobe')
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * Wo liegen die Daten?
 *
 * Die portable Fassung setzt PORTABLE_EXECUTABLE_DIR auf den Ordner, aus dem
 * sie gestartet wurde. Dorthin gehören dann auch Datenbank, Protokolle und
 * Exporte. Ist der Ort nicht beschreibbar — etwa ein schreibgeschützter Stick
 * oder ein Netzlaufwerk ohne Rechte —, wird auf das Benutzerprofil
 * zurückgefallen, statt den Start zu verweigern.
 */
function datenwurzel(): { root: string; portable: boolean } {
  const neben = process.env.PORTABLE_EXECUTABLE_DIR
  if (neben) {
    const ziel = join(neben, 'Votura-Daten')
    if (beschreibbar(ziel)) return { root: ziel, portable: true }
  }
  return { root: app.getPath('userData'), portable: false }
}

export function appPaths(): AppPaths {
  if (cached) return cached
  const { root, portable } = datenwurzel()
  // Die Übernahme aus der Zeit vor der Umbenennung betrifft nur das
  // Benutzerprofil; neben der Programmdatei gab es sie nie.
  if (!portable) uebernehmeAltenBestand(root)
  const paths: AppPaths = {
    root,
    portable,
    database: join(root, 'data', 'wahlzettel.sqlite'),
    logs: join(root, 'logs'),
    exports: join(root, 'exports'),
    // Portabel bleiben auch die Sicherungen beim Programm – ein Stick soll
    // vollständig sein und nichts auf dem Rechner zurücklassen.
    backups: portable ? join(root, 'backups') : join(app.getPath('documents'), 'Votura-Backups'),
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
