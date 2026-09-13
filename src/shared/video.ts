/**
 * Video als eigener Beamer-Inhalt — gleichzeitig auf allen Geräten.
 *
 * Auf einer Versammlung läuft zwischen zwei Wahlgängen auch mal ein Film:
 * Grußwort, Rückblick, Vorstellung. Läuft er auf dem Beamer und zusätzlich auf
 * Tablets im Saal, müssen alle **denselben Stand** zeigen — ein Bild, das drei
 * Sekunden hinterherhinkt, während vorne schon geklatscht wird, ist schlimmer
 * als gar kein zweiter Bildschirm.
 *
 * ## Warum eine Uhr und keine Befehle
 *
 * Naheliegend wäre, „jetzt abspielen" an alle zu schicken. Das geht schief:
 * Die Nachricht braucht auf jedem Weg unterschiedlich lange, und ein Gerät,
 * das später dazukommt, hat sie nie gesehen.
 *
 * Stattdessen trägt der Zustand eine **Uhr**: die Position zu einem genannten
 * Zeitpunkt. Jedes Gerät rechnet sich daraus aus, wo es stehen müsste —
 * Nachzügler genauso wie alle anderen. Wer zu spät kommt, springt einmal hin
 * und läuft dann mit.
 *
 * ## Warum nachgeführt und nicht gesprungen wird
 *
 * Ein Sprung ist sichtbar: Das Bild ruckelt, der Ton knackt. Kleine
 * Abweichungen werden deshalb über die Abspielgeschwindigkeit ausgeglichen —
 * ein Prozent schneller oder langsamer fällt niemandem auf, holt aber in
 * wenigen Sekunden eine Zehntelsekunde auf. Erst darüber wird gesprungen.
 */
import type { IsoDateTime, UUID } from './types'

/** Ein eingespeistes Video in der Bibliothek. */
export interface VideoInfo {
  id: UUID
  /** Anzeigename; beim Einspeisen aus dem Dateinamen. */
  title: string
  /** Ursprünglicher Dateiname, zur Wiedererkennung. */
  fileName: string
  /** Größe der abgelegten Datei in Bytes. */
  size: number
  /** MIME-Typ, aus der Endung abgeleitet. */
  mimeType: string
  /**
   * Laufzeit in Sekunden, sobald sie gemeldet wurde.
   *
   * Beim Einspeisen unbekannt: Sie steckt im Containerformat, und den zu
   * zerlegen hieße, einen Videodecoder nachzubauen. Der Browser weiß es
   * ohnehin, sobald er die Datei angefasst hat — er meldet es zurück.
   */
  durationSeconds?: number
  importedAt: IsoDateTime
}

/** Was die Beameransicht über das laufende Video erfährt. */
export interface ProjectionVideo {
  id: UUID
  title: string
  /** Läuft es gerade, oder steht es? */
  playing: boolean
  /**
   * Position in Sekunden — gültig zum Zeitpunkt `anchoredAt`.
   *
   * Läuft das Video, ist die Sollposition `position + (jetzt - anchoredAt)`.
   * Steht es, gilt `position` unverändert.
   */
  position: number
  /** Zeitpunkt, auf den sich `position` bezieht (Millisekunden seit Epoche). */
  anchoredAt: number
  /** Laufzeit in Sekunden, sofern schon gemeldet. */
  durationSeconds?: number
  /** Ton an? Der Beamer hat ihn an, Nebenbildschirme im Saal in der Regel nicht. */
  muted: boolean
  /**
   * Wie viele Geräte gemeldet haben, dass sie genug gepuffert haben.
   *
   * Nur zur Anzeige in der Bedienung — der Start wartet darauf, damit nicht
   * der Beamer läuft, während das Tablet in der dritten Reihe noch lädt.
   */
  readyCount: number
}

/**
 * Grenzen der Nachführung.
 *
 * Unterhalb von `GLEICHLAUF_TOLERANZ` gilt ein Gerät als synchron und wird in
 * Ruhe gelassen — jede Korrektur kostet Bildruhe. Zwischen Toleranz und
 * `GLEICHLAUF_SPRUNG` wird die Geschwindigkeit angepasst. Darüber hilft nur
 * ein Sprung.
 */
export const GLEICHLAUF_TOLERANZ = 0.08
export const GLEICHLAUF_SPRUNG = 0.75
/** Größte Abweichung der Abspielgeschwindigkeit beim Nachführen (±2 %). */
export const GLEICHLAUF_TEMPO = 0.02

/**
 * Was ein Gerät jetzt tun soll, um zum Sollstand aufzuschließen.
 *
 * Reine Rechnung ohne Zustand — dadurch prüfbar, ohne einen Browser zu
 * starten, und an jeder Stelle gleich.
 */
export interface Gleichlauf {
  /** Sollposition in Sekunden. */
  soll: number
  /** Abweichung in Sekunden (positiv: Gerät ist hinterher). */
  abweichung: number
  /** Springen statt nachführen? */
  springen: boolean
  /** Abspielgeschwindigkeit, mit der die Abweichung aufgeholt wird. */
  tempo: number
}

export function berechneGleichlauf(
  video: Pick<ProjectionVideo, 'playing' | 'position' | 'anchoredAt' | 'durationSeconds'>,
  istPosition: number,
  jetzt: number
): Gleichlauf {
  const gelaufen = video.playing ? Math.max(0, (jetzt - video.anchoredAt) / 1000) : 0
  const roh = video.position + gelaufen
  const soll =
    video.durationSeconds !== undefined ? Math.min(roh, video.durationSeconds) : roh
  const abweichung = soll - istPosition

  if (!video.playing) {
    /* Im Stand gibt es nichts nachzuführen: Entweder steht das Bild richtig
       oder es muss gesetzt werden. */
    return {
      soll,
      abweichung,
      springen: Math.abs(abweichung) > GLEICHLAUF_TOLERANZ,
      tempo: 1
    }
  }

  if (Math.abs(abweichung) > GLEICHLAUF_SPRUNG) {
    return { soll, abweichung, springen: true, tempo: 1 }
  }
  if (Math.abs(abweichung) <= GLEICHLAUF_TOLERANZ) {
    return { soll, abweichung, springen: false, tempo: 1 }
  }
  /*
   * Zwischen Toleranz und Sprunggrenze wird die Geschwindigkeit angepasst.
   * Der Faktor wächst mit der Abweichung, bleibt aber innerhalb von ±2 % —
   * darüber hört man die Tonhöhe wandern.
   */
  const anteil = Math.min(1, Math.abs(abweichung) / GLEICHLAUF_SPRUNG)
  const tempo = 1 + Math.sign(abweichung) * GLEICHLAUF_TEMPO * anteil
  return { soll, abweichung, springen: false, tempo }
}

/** Schema, unter dem das Beamerfenster das laufende Video lädt. */
export const VIDEO_SCHEME = 'votura-video' as const

/**
 * Adresse des laufenden Videos.
 *
 * Die Kennung steht im Pfad, damit ein Wechsel für den Browser eine echte
 * Navigation ist — sonst behielte das Element die alte Datei. Die Position
 * gehört ausdrücklich **nicht** hinein: Gesprungen wird im geladenen Video,
 * nicht durch Neuladen.
 */
export function videoUrl(id: UUID): string {
  return `${VIDEO_SCHEME}://laufend/${id}`
}

/** Dasselbe Video über den Projektionsserver, für Geräte im Netz. */
export function videoPath(id: UUID, buehne = 1): string {
  return `/video?v=${encodeURIComponent(id)}&buehne=${buehne}`
}

/**
 * Welche Dateien angenommen werden.
 *
 * Bewusst knapp: Was hier steht, spielt jedes Chromium ohne Zusatzpaket ab.
 * MKV und MOV fehlen nicht aus Nachlässigkeit — sie laufen je nach Inhalt
 * oder eben nicht, und „läuft manchmal" ist im Saal wertlos.
 */
export const VIDEO_TYPEN: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm'
}

export function videoMimeType(dateiname: string): string | undefined {
  const punkt = dateiname.lastIndexOf('.')
  if (punkt < 0) return undefined
  return VIDEO_TYPEN[dateiname.slice(punkt).toLowerCase()]
}
