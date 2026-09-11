/**
 * Bibliothek der eingespeisten Videos.
 *
 * Wie bei den Präsentationen wird die Datei **kopiert**, nicht verknüpft: Der
 * Stick, von dem sie kam, ist im Saal längst wieder in der Tasche.
 *
 * ## Warum kopiert wird, obwohl Videos groß sind
 *
 * Ein Film von 300 MB zu kopieren kostet Zeit und Platz — trotzdem ist es
 * richtig. Ein Video, das mitten im Abspielen abbricht, weil jemand den Stick
 * gezogen hat, ist auf einer Versammlung nicht zu reparieren. Der Import sagt
 * deshalb offen, dass er dauert, statt später zu überraschen.
 *
 * ## Warum nur MP4 und WebM
 *
 * Was hier steht, spielt jedes Chromium ohne Zusatzpaket. MKV und MOV fehlen
 * nicht aus Nachlässigkeit: Sie laufen je nach Inhalt oder eben nicht, und
 * „läuft manchmal" ist im Saal wertlos.
 */
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { UUID } from '@shared/types'
import { videoMimeType, VIDEO_TYPEN, type VideoInfo } from '@shared/video'
import { appPaths } from '../paths'
import { logger } from '../logger'
import { appendAudit } from './audit'
import { getSession } from './auth'

/**
 * Obergrenze je Datei.
 *
 * Vier Gigabyte sind für einen Versammlungsfilm reichlich und halten zugleich
 * die Grenze, an der einfache Dateisysteme aussteigen.
 */
const MAX_BYTES = 4 * 1024 * 1024 * 1024

function ordner(): string {
  const ziel = join(appPaths().root, 'videos')
  if (!existsSync(ziel)) mkdirSync(ziel, { recursive: true })
  return ziel
}

function verzeichnisDatei(): string {
  return join(ordner(), 'index.json')
}

function lies(): VideoInfo[] {
  const datei = verzeichnisDatei()
  if (!existsSync(datei)) return []
  try {
    const inhalt = JSON.parse(readFileSync(datei, 'utf8'))
    return Array.isArray(inhalt) ? (inhalt as VideoInfo[]) : []
  } catch (fehler) {
    logger.warn(`Verzeichnis der Videos unlesbar, beginne leer: ${String(fehler)}`)
    return []
  }
}

function schreibe(liste: VideoInfo[]): void {
  writeFileSync(verzeichnisDatei(), JSON.stringify(liste, null, 2), 'utf8')
}

/** Pfad der abgelegten Datei. Die Endung bleibt erhalten, der Name nicht. */
export function videoFile(id: UUID, endung: string): string {
  return join(ordner(), `${id}${endung}`)
}

/** Findet die abgelegte Datei zu einer Kennung, unabhängig von der Endung. */
export function videoFileFor(eintrag: VideoInfo): string {
  return videoFile(eintrag.id, extname(eintrag.fileName).toLowerCase())
}

export function listVideos(): VideoInfo[] {
  /* Was im Verzeichnis steht, aber nicht mehr auf der Platte liegt, wird
     stillschweigend ausgesortiert — etwa nach einem Griff ins Dateisystem. */
  const vorhanden = lies().filter((v) => existsSync(videoFileFor(v)))
  return [...vorhanden].sort((a, b) => b.importedAt.localeCompare(a.importedAt))
}

export function importVideo(sourcePath: string): VideoInfo {
  if (!existsSync(sourcePath)) {
    throw new Error('Die Datei gibt es nicht mehr.')
  }
  const endung = extname(sourcePath).toLowerCase()
  const mimeType = videoMimeType(sourcePath)
  if (!mimeType) {
    throw new Error(
      `Dieses Format wird nicht abgespielt. Möglich sind: ${Object.keys(VIDEO_TYPEN).join(', ')}.`
    )
  }
  const groesse = statSync(sourcePath).size
  if (groesse > MAX_BYTES) {
    throw new Error(
      `Die Datei ist ${(groesse / 1024 / 1024 / 1024).toFixed(1)} GB groß; erlaubt sind ${MAX_BYTES / 1024 / 1024 / 1024} GB.`
    )
  }

  const id = randomUUID()
  copyFileSync(sourcePath, videoFile(id, endung))

  const dateiname = basename(sourcePath)
  const eintrag: VideoInfo = {
    id,
    title: dateiname.replace(/\.[^.]+$/, ''),
    fileName: dateiname,
    size: groesse,
    mimeType,
    importedAt: new Date().toISOString()
  }

  schreibe([...lies().filter((v) => existsSync(videoFileFor(v))), eintrag])

  const session = getSession()
  appendAudit({
    action: 'video.imported',
    userId: session?.user.id,
    userName: session?.user.displayName,
    newValue: { titel: eintrag.title, datei: dateiname, bytes: groesse }
  })
  logger.info(`Video eingespeist: ${eintrag.title} (${id}, ${groesse} Bytes)`)
  return eintrag
}

export function renameVideo(id: UUID, title: string): VideoInfo {
  const sauber = title.trim()
  if (!sauber) throw new Error('Das Video braucht eine Bezeichnung.')
  const liste = lies()
  const eintrag = liste.find((v) => v.id === id)
  if (!eintrag) throw new Error('Dieses Video gibt es nicht mehr.')
  const vorher = eintrag.title
  eintrag.title = sauber
  schreibe(liste)

  const session = getSession()
  appendAudit({
    action: 'video.renamed',
    userId: session?.user.id,
    userName: session?.user.displayName,
    previousValue: { titel: vorher },
    newValue: { titel: sauber }
  })
  return eintrag
}

export function deleteVideo(id: UUID): void {
  const liste = lies()
  const eintrag = liste.find((v) => v.id === id)
  if (eintrag) rmSync(videoFileFor(eintrag), { force: true })
  schreibe(liste.filter((v) => v.id !== id))

  const session = getSession()
  appendAudit({
    action: 'video.deleted',
    userId: session?.user.id,
    userName: session?.user.displayName,
    previousValue: { titel: eintrag?.title ?? '(unbekannt)' }
  })
  logger.info(`Video entfernt: ${id}`)
}

/**
 * Hält die gemeldete Laufzeit fest.
 *
 * Sie steckt im Containerformat; ihn zu zerlegen hieße, einen Videodecoder
 * nachzubauen. Der Browser weiß es ohnehin, sobald er die Datei angefasst hat.
 * Gespeichert **ohne Prüfeintrag**: Das ist eine Messung, keine Handlung.
 */
export function rememberDuration(id: UUID, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return
  const liste = lies()
  const eintrag = liste.find((v) => v.id === id)
  if (!eintrag) return
  const gerundet = Math.round(seconds * 100) / 100
  if (eintrag.durationSeconds === gerundet) return
  eintrag.durationSeconds = gerundet
  schreibe(liste)
}

export function getVideo(id: UUID): VideoInfo | undefined {
  return lies().find((v) => v.id === id && existsSync(videoFileFor(v)))
}
