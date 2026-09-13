/**
 * Bibliothek der eingespeisten Präsentationen.
 *
 * Eine HTML-Datei wird beim Import **kopiert**, nicht verknüpft: Der Stick,
 * von dem sie kam, ist im Saal längst wieder in der Tasche, und ein Beamer,
 * der mitten im Vortrag „Datei nicht gefunden" zeigt, ist der schlechteste
 * Zeitpunkt, das zu merken.
 *
 * Abgelegt wird neben der Datenbank — bei der portablen Fassung also
 * ebenfalls auf dem Stick (§2.2). Das Verzeichnis der Bibliothek liegt als
 * JSON daneben; eine eigene Tabelle wäre mehr Aufwand als Nutzen, weil hier
 * weder Fremdschlüssel noch Transaktionen gebraucht werden.
 *
 * ## Warum nur HTML
 *
 * Eine einzelne HTML-Datei bringt alles mit, was sie braucht — Schriften,
 * Bilder und Skript stecken darin. Sie läuft ohne Netz, ohne Zusatzprogramm
 * und ohne Schriftarten, die auf dem Saalrechner fehlen könnten. Genau
 * deshalb wird hier nichts anderes angenommen: Ein PDF bräuchte einen
 * Betrachter, PowerPoint ein fremdes Programm, und beides brächte die
 * Zusagen aus §2 ins Wanken.
 */
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { presentationKind, type PresentationInfo, type PresentationKind } from '@shared/presentation'
import type { UUID } from '@shared/types'
import { appPaths } from '../paths'
import { logger } from '../logger'
import { appendAudit } from './audit'
import { getSession } from './auth'

/**
 * Obergrenze je Datei.
 *
 * Präsentationen mit eingebetteten Bildern werden schnell groß; die des
 * Kreisverbandes liegen bei knapp zwei Megabyte. Fünfzig ist reichlich Luft
 * und verhindert zugleich, dass jemand versehentlich ein Video einspeist und
 * sich wundert, warum der Import minutenlang steht.
 */
const MAX_BYTES = 50 * 1024 * 1024

function ordner(): string {
  const ziel = join(appPaths().root, 'presentations')
  if (!existsSync(ziel)) mkdirSync(ziel, { recursive: true })
  return ziel
}

function verzeichnisDatei(): string {
  return join(ordner(), 'index.json')
}

function lies(): PresentationInfo[] {
  const datei = verzeichnisDatei()
  if (!existsSync(datei)) return []
  try {
    const inhalt = JSON.parse(readFileSync(datei, 'utf8'))
    return Array.isArray(inhalt) ? (inhalt as PresentationInfo[]) : []
  } catch (fehler) {
    logger.warn(`Verzeichnis der Präsentationen unlesbar, beginne leer: ${String(fehler)}`)
    return []
  }
}

function schreibe(liste: PresentationInfo[]): void {
  writeFileSync(verzeichnisDatei(), JSON.stringify(liste, null, 2), 'utf8')
}

/**
 * Pfad der abgelegten Datei. Bewusst kein Aufruferpfad — nur die Kennung zählt.
 *
 * Die Endung bleibt erhalten, damit ein PDF als PDF erkennbar bleibt. Ohne
 * Angabe gilt `.html`: So liegen Dateien aus einer älteren Fassung weiterhin
 * dort, wo sie immer lagen.
 */
export function presentationFile(id: UUID, endung = '.html'): string {
  return join(ordner(), `${id}${endung}`)
}

/** Pfad zu einem Eintrag der Bibliothek. */
export function presentationFileFor(eintrag: PresentationInfo): string {
  return presentationFile(eintrag.id, presentationKind(eintrag) === 'pdf' ? '.pdf' : '.html')
}

export function listPresentations(): PresentationInfo[] {
  /* Was im Verzeichnis steht, aber nicht mehr auf der Platte liegt, wird
     stillschweigend ausgesortiert — etwa nach einem Griff ins Dateisystem. */
  const vorhanden = lies().filter((p) => existsSync(presentationFileFor(p)))
  return [...vorhanden].sort((a, b) => b.importedAt.localeCompare(a.importedAt))
}

/**
 * Holt den Titel aus dem Dokument.
 *
 * Nur die ersten 64 KB werden durchsucht: Der `<title>` steht im Kopf, und
 * eine Zwei-Megabyte-Datei nach einer Zeichenkette abzusuchen, die längst
 * vorbeigezogen ist, kostet nur Zeit.
 */
function titelAusDatei(pfad: string, ersatz: string): string {
  try {
    const kopf = readFileSync(pfad)
      .subarray(0, 64 * 1024)
      .toString('utf8')
    const treffer = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(kopf)
    const titel = treffer?.[1]?.trim()
    return titel && titel.length > 0 ? titel : ersatz
  } catch {
    return ersatz
  }
}

export function importPresentation(sourcePath: string): PresentationInfo {
  if (!existsSync(sourcePath)) {
    throw new Error('Die Datei gibt es nicht mehr.')
  }
  const endung = extname(sourcePath).toLowerCase()
  if (!/^\.(html?|pdf)$/i.test(endung)) {
    throw new Error('Eingespeist werden einzelne HTML-Dateien und PDF-Dokumente.')
  }
  const art: PresentationKind = endung === '.pdf' ? 'pdf' : 'html'
  const groesse = statSync(sourcePath).size
  if (groesse > MAX_BYTES) {
    throw new Error(
      `Die Datei ist ${(groesse / 1024 / 1024).toFixed(0)} MB groß; erlaubt sind ${MAX_BYTES / 1024 / 1024} MB.`
    )
  }

  const id = randomUUID()
  const ziel = presentationFile(id, art === 'pdf' ? '.pdf' : '.html')
  copyFileSync(sourcePath, ziel)

  const dateiname = basename(sourcePath)
  const eintrag: PresentationInfo = {
    id,
    kind: art,
    /* Der <title> steht nur in HTML; bei einem PDF bleibt der Dateiname. */
    title:
      art === 'html'
        ? titelAusDatei(ziel, dateiname.replace(/\.html?$/i, ''))
        : dateiname.replace(/\.pdf$/i, ''),
    fileName: dateiname,
    size: groesse,
    importedAt: new Date().toISOString()
  }

  schreibe([...lies().filter((p) => existsSync(presentationFileFor(p))), eintrag])

  const session = getSession()
  appendAudit({
    action: 'presentation.imported',
    userId: session?.user.id,
    userName: session?.user.displayName,
    newValue: { titel: eintrag.title, datei: dateiname, bytes: groesse }
  })
  logger.info(`Präsentation eingespeist: ${eintrag.title} (${id}, ${groesse} Bytes)`)
  return eintrag
}

export function renamePresentation(id: UUID, title: string): PresentationInfo {
  const sauber = title.trim()
  if (!sauber) throw new Error('Der Name darf nicht leer sein.')

  const liste = lies()
  const eintrag = liste.find((p) => p.id === id)
  if (!eintrag) throw new Error('Diese Präsentation gibt es nicht.')

  const vorher = eintrag.title
  eintrag.title = sauber.slice(0, 200)
  schreibe(liste)

  const session = getSession()
  appendAudit({
    action: 'presentation.renamed',
    userId: session?.user.id,
    userName: session?.user.displayName,
    previousValue: { titel: vorher },
    newValue: { titel: eintrag.title }
  })
  return eintrag
}

export function deletePresentation(id: UUID): void {
  const liste = lies()
  const eintrag = liste.find((p) => p.id === id)
  if (eintrag) rmSync(presentationFileFor(eintrag), { force: true })
  schreibe(liste.filter((p) => p.id !== id))

  const session = getSession()
  appendAudit({
    action: 'presentation.deleted',
    userId: session?.user.id,
    userName: session?.user.displayName,
    previousValue: { titel: eintrag?.title ?? '(unbekannt)' }
  })
  logger.info(`Präsentation entfernt: ${id}`)
}

/**
 * Hält die gemeldete Folienzahl fest.
 *
 * Sie kommt aus dem Dokument selbst, sobald dessen Skript gelaufen ist.
 * Gespeichert wird sie, damit die Bibliothek sie auch dann zeigt, wenn die
 * Präsentation gerade nicht läuft — **ohne Prüfeintrag**: Das ist eine
 * Messung, keine Handlung eines Benutzers.
 */
export function rememberSlideCount(id: UUID, slideCount: number): void {
  if (!Number.isFinite(slideCount) || slideCount < 1) return
  const liste = lies()
  const eintrag = liste.find((p) => p.id === id)
  if (!eintrag || eintrag.slideCount === slideCount) return
  eintrag.slideCount = Math.round(slideCount)
  schreibe(liste)
}

export function getPresentation(id: UUID): PresentationInfo | undefined {
  return lies().find((p) => p.id === id && existsSync(presentationFileFor(p)))
}
