/**
 * Teleprompter: Reden und der Stand ihres Laufs.
 *
 * ## Warum Markdown
 *
 * Eine Rede ist Text mit Gliederung, nicht Gestaltung. Markdown lässt sich in
 * jedem Editor schreiben, per E-Mail schicken und noch am Abend vorher im
 * Zug ändern — und es ist lesbar, auch wenn Votura einmal nicht zur Hand ist.
 * Was der Prompter daraus macht, entscheidet die Ansicht: Überschriften
 * werden zu Marken zum Anspringen, Fettes bleibt fett, alles andere ist
 * Fließtext in der eingestellten Größe.
 *
 * ## Warum die Uhr und nicht ein Zähler
 *
 * Der Lauf wird wie beim Video über die **Uhr** beschrieben und nicht über
 * fortlaufende Befehle: gespeichert sind die Stelle (`position`), der
 * Zeitpunkt, zu dem sie galt (`anchoredAt`), und das Tempo. Jedes Gerät
 * rechnet sich daraus selbst aus, wo es gerade stehen müsste — auch eines,
 * das erst mitten in der Rede dazukommt. Ein Zähler, der Befehle verschickt,
 * verliert genau dort den Anschluss, wo es darauf ankommt.
 */
import type { UUID } from './types'

/** Ein Eintrag der Redenbibliothek. */
export interface SpeechInfo {
  id: UUID
  title: string
  fileName: string
  size: number
  /** Wörter — daraus schätzt die Bibliothek die Redezeit. */
  words: number
  importedAt: string
  /** Zugehöriger Bewerber, falls die Rede zu einer Vorstellung gehört. */
  candidateId?: UUID
  candidateName?: string
}

/** Eine Rede samt Inhalt — nur beim Öffnen gebraucht, nicht in der Liste. */
export interface SpeechContent extends SpeechInfo {
  markdown: string
}

/**
 * Wie schnell im Mittel gesprochen wird.
 *
 * 110 Wörter je Minute ist das übliche Maß für freies Reden vor Publikum —
 * langsamer als beim Vorlesen, weil Pausen und Blickkontakt dazugehören. Die
 * Schätzung in der Bibliothek dient nur der Einordnung („etwa 4 Minuten");
 * das Tempo des Laufs stellt die vortragende Person selbst ein.
 */
export const WOERTER_JE_MINUTE = 110

/** Geschätzte Redezeit in Sekunden. */
export function redeDauer(words: number): number {
  return Math.round((words / WOERTER_JE_MINUTE) * 60)
}

/** Tempo des Auto-Laufs in Zeilen je Minute. */
export const TEMPO_MIN = 20
export const TEMPO_MAX = 400
export const TEMPO_VORGABE = 120

/** Schriftgröße der Prompteransicht, gemessen an der Höhe der Fläche. */
export const SCHRIFT_MIN = 2
export const SCHRIFT_MAX = 12
export const SCHRIFT_VORGABE = 5

/**
 * Wie die Ansicht gespiegelt wird.
 *
 * Ein Prompterspiegel wirft das Bild seitenverkehrt zurück; steht das Gerät
 * über Kopf unter der Glasscheibe, kommt die senkrechte Spiegelung dazu.
 * Beides einzeln schaltbar, weil beide Aufbauten vorkommen.
 */
export interface SpiegelUng {
  horizontal: boolean
  vertikal: boolean
}

/**
 * Der Stand des Prompters — dasselbe für alle Geräte, die ihn zeigen.
 *
 * `position` ist der Abstand vom Anfang in **Zeilenhöhen**, nicht in Pixeln:
 * Ein Telefon, ein Tablet und ein Notebook haben verschiedene Flächen, aber
 * dieselbe Rede. In Zeilen gemessen stehen alle an derselben Stelle im Text.
 */
export interface PrompterViewState {
  speech?: {
    id: UUID
    title: string
    /** Der Text selbst; er wandert mit, damit ein Gerät nichts nachladen muss. */
    markdown: string
  }
  /** Abstand vom Anfang in Zeilenhöhen. */
  position: number
  /** Zeitpunkt, zu dem `position` galt (ISO). */
  anchoredAt: string
  running: boolean
  /** Zeilen je Minute. */
  tempo: number
  /** Schriftgröße in Prozent der Höhe. */
  schrift: number
  spiegel: SpiegelUng
  /** Breite des Textes in Prozent der Fläche — schmaler liest sich ruhiger. */
  breite: number
  /** Markierte Lesezeile: Prozent von oben. */
  leselinie: number
  /** Uhr und Restzeit einblenden. */
  zeigeUhr: boolean
  /** Ende der zugestandenen Redezeit (ISO) — dieselbe Uhr wie auf dem Beamer. */
  until?: string
  /** Zuletzt geändert (ISO). */
  updatedAt: string
  /** Kennung dieses Programmlaufs, damit eine Netzansicht einen Neustart merkt. */
  serverInstanceId?: string
}

export const PROMPTER_VORGABE: PrompterViewState = {
  position: 0,
  anchoredAt: new Date(0).toISOString(),
  running: false,
  tempo: TEMPO_VORGABE,
  schrift: SCHRIFT_VORGABE,
  spiegel: { horizontal: false, vertikal: false },
  breite: 80,
  leselinie: 40,
  zeigeUhr: true,
  updatedAt: new Date(0).toISOString()
}

/**
 * Wo der Text jetzt stehen müsste.
 *
 * Reine Funktion: Sie lässt sich prüfen, ohne einen Browser zu starten, und
 * alle Geräte rechnen nachweislich gleich. Steht der Lauf, gilt die
 * gespeicherte Stelle unverändert.
 */
export function prompterPosition(state: PrompterViewState, jetzt: number): number {
  if (!state.running) return Math.max(0, state.position)
  const seit = (jetzt - Date.parse(state.anchoredAt)) / 1000
  if (!Number.isFinite(seit) || seit <= 0) return Math.max(0, state.position)
  return Math.max(0, state.position + (seit * state.tempo) / 60)
}

/**
 * Trennt die Rede in Absätze.
 *
 * Der Prompter zeigt keinen Fließtext am Stück: Wer den Blick hebt und wieder
 * senkt, muss die Stelle wiederfinden. Absätze, Überschriften und
 * Aufzählungen sind die Anker dafür — deshalb bleiben sie beim Umbrechen
 * erhalten und werden nicht zu einer Textwand verschmolzen.
 */
export interface RedeBlock {
  art: 'ueberschrift' | 'absatz' | 'punkt' | 'zitat' | 'pause'
  /** Bei Überschriften die Ebene (1–3). */
  ebene?: number
  text: string
}

/**
 * Markdown in Blöcke zerlegen — bewusst nur das, was in einer Rede vorkommt.
 *
 * Eine vollständige Markdown-Bibliothek brächte Tabellen, Bilder, Links und
 * HTML mit; nichts davon liest jemand am Pult vor. Was hier fehlt, fehlt
 * absichtlich: Der Prompter soll Text groß und ruhig zeigen, nicht ein
 * Dokument setzen.
 */
export function redeBloecke(markdown: string): RedeBlock[] {
  const bloecke: RedeBlock[] = []
  const zeilen = markdown.replace(/\r\n?/g, '\n').split('\n')
  let absatz: string[] = []

  const absatzAbschliessen = (): void => {
    if (absatz.length === 0) return
    bloecke.push({ art: 'absatz', text: absatz.join(' ').trim() })
    absatz = []
  }

  for (const zeile of zeilen) {
    const roh = zeile.trim()
    if (roh === '') {
      absatzAbschliessen()
      continue
    }
    /* Drei Striche oder mehr: eine Stelle zum Durchatmen. */
    if (/^-{3,}$|^\*{3,}$/.test(roh)) {
      absatzAbschliessen()
      bloecke.push({ art: 'pause', text: '' })
      continue
    }
    const ueberschrift = /^(#{1,3})\s+(.*)$/.exec(roh)
    if (ueberschrift) {
      absatzAbschliessen()
      bloecke.push({ art: 'ueberschrift', ebene: ueberschrift[1].length, text: ueberschrift[2].trim() })
      continue
    }
    const punkt = /^[-*+]\s+(.*)$/.exec(roh)
    if (punkt) {
      absatzAbschliessen()
      bloecke.push({ art: 'punkt', text: punkt[1].trim() })
      continue
    }
    const zitat = /^>\s?(.*)$/.exec(roh)
    if (zitat) {
      absatzAbschliessen()
      bloecke.push({ art: 'zitat', text: zitat[1].trim() })
      continue
    }
    absatz.push(roh)
  }
  absatzAbschliessen()
  return bloecke
}

/** Zählt die Wörter einer Rede — für die Schätzung der Redezeit. */
export function redeWoerter(markdown: string): number {
  return redeBloecke(markdown)
    .map((block) => block.text)
    .join(' ')
    .split(/\s+/)
    .filter((wort) => /[\p{L}\p{N}]/u.test(wort)).length
}

/** Endpunkt der Prompteransicht im Veranstaltungsnetz. */
export const PROMPTER_PFAD = '/prompter'
