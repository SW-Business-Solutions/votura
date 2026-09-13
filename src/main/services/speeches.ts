/**
 * Bibliothek der Reden.
 *
 * Wie bei den Präsentationen wird die Datei beim Einspeisen **kopiert** und
 * neben der Datenbank abgelegt — bei der portablen Fassung also auf dem Stick.
 * Anders als dort darf hier auch geschrieben werden: Eine Rede ändert sich
 * noch auf dem Weg zum Pult, und dafür soll niemand die Anwendung verlassen.
 *
 * Angenommen wird ausschließlich Markdown (und einfacher Text). Ein Format
 * mit Gestaltung brächte nichts: Der Prompter zeigt große Buchstaben auf
 * dunklem Grund, nicht das Layout eines Textprogramms.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { redeWoerter, type SpeechContent, type SpeechInfo } from '@shared/speech'
import type { UUID } from '@shared/types'
import { appPaths } from '../paths'
import { logger } from '../logger'
import { appendAudit } from './audit'
import { getSession } from './auth'

/**
 * Obergrenze je Rede.
 *
 * Zwei Megabyte reines Markdown wären etwa 300 000 Wörter — rund 45 Stunden
 * Redezeit. Wer mehr einspeist, hat sich in der Datei geirrt.
 */
const MAX_BYTES = 2 * 1024 * 1024

function ordner(): string {
  const ziel = join(appPaths().root, 'speeches')
  if (!existsSync(ziel)) mkdirSync(ziel, { recursive: true })
  return ziel
}

function verzeichnisDatei(): string {
  return join(ordner(), 'index.json')
}

function lies(): SpeechInfo[] {
  const datei = verzeichnisDatei()
  if (!existsSync(datei)) return []
  try {
    const inhalt = JSON.parse(readFileSync(datei, 'utf8'))
    return Array.isArray(inhalt) ? (inhalt as SpeechInfo[]) : []
  } catch (fehler) {
    logger.warn(`Verzeichnis der Reden unlesbar, beginne leer: ${String(fehler)}`)
    return []
  }
}

function schreibe(liste: SpeechInfo[]): void {
  writeFileSync(verzeichnisDatei(), JSON.stringify(liste, null, 2), 'utf8')
}

export function speechFile(id: UUID): string {
  return join(ordner(), `${id}.md`)
}

export function listSpeeches(): SpeechInfo[] {
  const vorhanden = lies().filter((rede) => existsSync(speechFile(rede.id)))
  return [...vorhanden].sort((a, b) => b.importedAt.localeCompare(a.importedAt))
}

export function getSpeech(id: UUID): SpeechContent | undefined {
  const eintrag = lies().find((rede) => rede.id === id)
  if (!eintrag || !existsSync(speechFile(id))) return undefined
  return { ...eintrag, markdown: readFileSync(speechFile(id), 'utf8') }
}

/**
 * Erste Überschrift als Titel.
 *
 * Eine Rede beginnt fast immer mit einer — und der Dateiname ist meistens
 * „rede_final_v3.md". Steht keine Überschrift da, bleibt der Dateiname.
 */
function titelAus(markdown: string, ersatz: string): string {
  const treffer = /^#{1,3}\s+(.{1,200})$/m.exec(markdown)
  const titel = treffer?.[1]?.trim()
  return titel && titel.length > 0 ? titel : ersatz
}

function eintragen(id: UUID, markdown: string, dateiname: string, vorhanden?: SpeechInfo): SpeechInfo {
  writeFileSync(speechFile(id), markdown, 'utf8')
  const eintrag: SpeechInfo = {
    ...vorhanden,
    id,
    title: vorhanden?.title ?? titelAus(markdown, dateiname.replace(/\.(md|markdown|txt)$/i, '')),
    fileName: dateiname,
    size: Buffer.byteLength(markdown, 'utf8'),
    words: redeWoerter(markdown),
    importedAt: vorhanden?.importedAt ?? new Date().toISOString()
  }
  const liste = lies().filter((rede) => rede.id !== id && existsSync(speechFile(rede.id)))
  schreibe([...liste, eintrag])
  return eintrag
}

export function importSpeech(sourcePath: string): SpeechInfo {
  if (!existsSync(sourcePath)) throw new Error('Die Datei gibt es nicht mehr.')
  if (!/^\.(md|markdown|txt)$/i.test(extname(sourcePath))) {
    throw new Error('Eingespeist werden Markdown-Dateien (.md) und einfacher Text (.txt).')
  }
  const groesse = statSync(sourcePath).size
  if (groesse > MAX_BYTES) {
    throw new Error(
      `Die Datei ist ${(groesse / 1024 / 1024).toFixed(1)} MB groß; erlaubt sind ${MAX_BYTES / 1024 / 1024} MB.`
    )
  }

  const id = randomUUID()
  const eintrag = eintragen(id, readFileSync(sourcePath, 'utf8'), basename(sourcePath))

  const session = getSession()
  appendAudit({
    action: 'speech.imported',
    userId: session?.user.id,
    userName: session?.user.displayName,
    newValue: { titel: eintrag.title, datei: eintrag.fileName, woerter: eintrag.words }
  })
  logger.info(`Rede eingespeist: ${eintrag.title} (${id}, ${eintrag.words} Wörter)`)
  return eintrag
}

/** Legt eine leere Rede an — für alles, was erst vor Ort entsteht. */
export function createSpeech(title: string): SpeechInfo {
  const sauber = title.trim() || 'Neue Rede'
  const id = randomUUID()
  const eintrag = eintragen(id, `# ${sauber}\n\n`, `${sauber}.md`)
  eintrag.title = sauber
  schreibe(lies().map((rede) => (rede.id === id ? eintrag : rede)))

  const session = getSession()
  appendAudit({
    action: 'speech.created',
    userId: session?.user.id,
    userName: session?.user.displayName,
    newValue: { titel: sauber }
  })
  return eintrag
}

export function saveSpeech(id: UUID, markdown: string): SpeechInfo {
  const vorhanden = lies().find((rede) => rede.id === id)
  if (!vorhanden) throw new Error('Diese Rede gibt es nicht.')
  if (Buffer.byteLength(markdown, 'utf8') > MAX_BYTES) {
    throw new Error('Der Text ist zu lang.')
  }
  const eintrag = eintragen(id, markdown, vorhanden.fileName, vorhanden)

  const session = getSession()
  appendAudit({
    action: 'speech.edited',
    userId: session?.user.id,
    userName: session?.user.displayName,
    newValue: { titel: eintrag.title, woerter: eintrag.words }
  })
  return eintrag
}

export function renameSpeech(id: UUID, title: string): SpeechInfo {
  const sauber = title.trim()
  if (!sauber) throw new Error('Der Name darf nicht leer sein.')
  const liste = lies()
  const eintrag = liste.find((rede) => rede.id === id)
  if (!eintrag) throw new Error('Diese Rede gibt es nicht.')

  const vorher = eintrag.title
  eintrag.title = sauber.slice(0, 200)
  schreibe(liste)

  const session = getSession()
  appendAudit({
    action: 'speech.renamed',
    userId: session?.user.id,
    userName: session?.user.displayName,
    previousValue: { titel: vorher },
    newValue: { titel: eintrag.title }
  })
  return eintrag
}

/**
 * Ordnet eine Rede einem Bewerber zu.
 *
 * Wird dieser Bewerber später als Sprecher aufgerufen, liegt sein Text
 * bereit — niemand sucht ihn dann noch in einer Liste. `undefined` löst die
 * Zuordnung wieder.
 */
export function assignSpeech(id: UUID, candidateId?: UUID, candidateName?: string): SpeechInfo {
  const liste = lies()
  const eintrag = liste.find((rede) => rede.id === id)
  if (!eintrag) throw new Error('Diese Rede gibt es nicht.')
  eintrag.candidateId = candidateId
  eintrag.candidateName = candidateId ? candidateName : undefined
  schreibe(liste)
  return eintrag
}

export function deleteSpeech(id: UUID): void {
  const liste = lies()
  const eintrag = liste.find((rede) => rede.id === id)
  rmSync(speechFile(id), { force: true })
  schreibe(liste.filter((rede) => rede.id !== id))

  const session = getSession()
  appendAudit({
    action: 'speech.deleted',
    userId: session?.user.id,
    userName: session?.user.displayName,
    previousValue: { titel: eintrag?.title ?? '(unbekannt)' }
  })
  logger.info(`Rede entfernt: ${id}`)
}
