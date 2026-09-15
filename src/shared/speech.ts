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
 *
 * ## Warum in Wörtern gemessen wird
 *
 * Die Stelle ist ein **Wortindex**, keine Zeile und kein Bildpunkt. Zeilen
 * entstehen erst beim Umbrechen und hängen an Fläche und Schriftgröße: Ein
 * Telefon hochkant bricht denselben Absatz doppelt so oft um wie ein
 * Pultmonitor — in Zeilen gerechnet liefen beide Geräte auseinander. Wörter
 * stehen im Text und sind auf jedem Gerät dieselben.
 *
 * Der zweite Gewinn: Die Länge der Rede ist damit **bekannt**, ohne dass ein
 * Gerät sie melden müsste. Der Lauf kann am Ende halten, statt ins Leere zu
 * scrollen, und „Starten" nach dem Ende beginnt wieder von vorn.
 */
import { wortfolge } from './mitlauf'
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

/**
 * Tempo des Auto-Laufs in **Wörtern je Minute** — dasselbe Maß, in dem
 * Redezeit geschätzt wird. Wer weiß, dass er 110 Wörter je Minute spricht,
 * stellt genau das ein.
 */
export const TEMPO_MIN = 40
export const TEMPO_MAX = 260
export const TEMPO_VORGABE = WOERTER_JE_MINUTE

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
 * `position` ist ein **Wortindex** — siehe Modulkopf. `laenge` ist die Zahl
 * der Wörter der aufgelegten Rede; sie steht im Zustand, damit jede Ansicht
 * dasselbe Ende kennt, ohne den Text noch einmal zu zählen.
 */
/**
 * Was am Pult zu sehen ist.
 *
 * `rede` zeigt den Text, `vortrag` die laufende Präsentation mit der nächsten
 * Folie — dieselbe Ansicht wie die Vortragssteuerung, nur auf dem Gerät vor
 * der vortragenden Person. Wer ohne Manuskript spricht, braucht die Folien;
 * wer abliest, den Text. Beides auf demselben Endpunkt, umschaltbar vom
 * Board.
 */
export type PrompterAnsicht = 'rede' | 'vortrag'

/**
 * Was den Text bewegt.
 *
 * `auto` rollt mit festem Tempo — verlässlich, aber unbeirrbar: Wer einen
 * Einschub macht oder auf eine Zwischenfrage antwortet, findet den Text
 * anderswo wieder. `stimme` hört mit und setzt die Stelle dorthin, wo
 * tatsächlich gesprochen wird. `hand` bewegt nichts von selbst; geblättert
 * wird am Board oder mit den Pfeiltasten.
 */
export type Laufart = 'auto' | 'stimme' | 'hand'

export interface PrompterViewState {
  ansicht: PrompterAnsicht
  laufart: Laufart
  speech?: {
    id: UUID
    title: string
    /** Der Text selbst; er wandert mit, damit ein Gerät nichts nachladen muss. */
    markdown: string
  }
  /** Stelle im Text als Wortindex. */
  position: number
  /** Zeitpunkt, zu dem `position` galt (ISO). */
  anchoredAt: string
  running: boolean
  /** Wörter je Minute. */
  tempo: number
  /** Schriftgröße in Prozent der Höhe. */
  schrift: number
  spiegel: SpiegelUng
  /** Wörter der aufgelegten Rede — das Ende des Laufs. */
  laenge: number
  /** Breite des Textes in Prozent der Fläche — schmaler liest sich ruhiger. */
  breite: number
  /** Markierte Lesezeile: Prozent von oben. */
  leselinie: number
  /** Uhr und Restzeit einblenden. */
  zeigeUhr: boolean
  /**
   * Darf die **Netzansicht** bedienen?
   *
   * Nur sie: Das Prompterfenster am Hauptrechner darf immer. Es steht unter
   * derselben Aufsicht wie die Bedienung selbst — es dafür zu sperren, hieße
   * der Wahlleitung etwas zu verbieten, das sie ohnehin nebenan tun kann.
   *
   * Ein Gerät im Saal ist etwas anderes: Es liegt am Pult, jemand Fremdes hat
   * es in der Hand, und ob es mehr darf als zeigen, ist eine Entscheidung.
   * Der Wert kommt deshalb aus der Netzkonfiguration und lässt sich hier
   * nicht verstellen — sonst gäbe es zwei Schalter für eine Frage.
   */
  netzBedienung: boolean
  /** Ende der zugestandenen Redezeit (ISO) — dieselbe Uhr wie auf dem Beamer. */
  until?: string
  /**
   * Legt der Prompter die Rede des Aufgerufenen von selbst auf — und beginnt?
   *
   * Wird auf dem Beamer ein Bewerber vorgestellt, dem eine Rede zugeordnet
   * ist, kommt sie mitsamt seiner Uhr auf den Prompter, und der Lauf beginnt:
   * Die Redezeit zählt ab dem Aufruf, ein danebenstehender Text wäre schon
   * beim ersten Satz aus dem Tritt. Das ist der Regelfall einer Reihe von
   * Vorstellungen: zwölf Bewerber, zwölf Texte, und niemand sucht
   * zwischendurch in einer Liste oder greift ans Board.
   *
   * Gestartet wird nur bei gleichmäßigem Lauf — „Nach Stimme" und „Von Hand"
   * bleiben unangetastet.
   *
   * Abschaltbar, weil der Prompter auch etwas anderes tragen kann — die
   * Notizen der Versammlungsleitung etwa. Die sollen nicht verschwinden, nur
   * weil vorn jemand aufgerufen wird.
   */
  folgtDemAufruf: boolean
  /** Zuletzt geändert (ISO). */
  updatedAt: string
  /** Kennung dieses Programmlaufs, damit eine Netzansicht einen Neustart merkt. */
  serverInstanceId?: string
}

export const PROMPTER_VORGABE: PrompterViewState = {
  ansicht: 'rede',
  laufart: 'auto',
  position: 0,
  anchoredAt: new Date(0).toISOString(),
  running: false,
  tempo: TEMPO_VORGABE,
  schrift: SCHRIFT_VORGABE,
  spiegel: { horizontal: false, vertikal: false },
  laenge: 0,
  breite: 80,
  leselinie: 40,
  zeigeUhr: true,
  netzBedienung: false,
  folgtDemAufruf: true,
  updatedAt: new Date(0).toISOString()
}

/**
 * Wo der Text jetzt stehen müsste — als Wortindex.
 *
 * Reine Funktion: Sie lässt sich prüfen, ohne einen Browser zu starten, und
 * alle Geräte rechnen nachweislich gleich. Steht der Lauf, gilt die
 * gespeicherte Stelle unverändert. Am Ende hält der Lauf an, statt ins Leere
 * weiterzuzählen — sonst stünde nach der letzten Zeile nur noch Schwarz, und
 * niemand fände zurück.
 */
export function prompterPosition(state: PrompterViewState, jetzt: number): number {
  const ende = state.laenge > 0 ? state.laenge : Number.POSITIVE_INFINITY
  const begrenzt = (wert: number): number => Math.min(ende, Math.max(0, wert))
  /*
   * Nur der Auto-Lauf rechnet mit der Uhr.
   *
   * Bei Stimme und Hand steht die Stelle genau da, wo sie zuletzt gesetzt
   * wurde — von der Erkennung oder von einer Taste. Liefe die Uhr nebenher
   * mit, kämpften zwei Quellen um dieselbe Zeile.
   */
  if (state.laufart !== 'auto') return begrenzt(state.position)
  if (!state.running) return begrenzt(state.position)
  const seit = (jetzt - Date.parse(state.anchoredAt)) / 1000
  if (!Number.isFinite(seit) || seit <= 0) return begrenzt(state.position)
  return begrenzt(state.position + (seit * state.tempo) / 60)
}

/** Ist die Rede durchgelaufen? */
export function prompterAmEnde(state: PrompterViewState, jetzt: number): boolean {
  return state.laenge > 0 && prompterPosition(state, jetzt) >= state.laenge
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
  art: 'ueberschrift' | 'absatz' | 'punkt' | 'zitat' | 'pause' | 'hinweis'
  /** Bei Überschriften die Ebene (1–3). */
  ebene?: number
  text: string
}

/**
 * Ein Hinweis an die vortragende Person, kein gesprochener Satz.
 *
 * `[Zum Publikum schauen]` — in eckigen Klammern auf einer eigenen Zeile.
 * Die Klammern sind die Schreibweise, die Drehbücher und Prompter seit jeher
 * für Regieanweisungen benutzen, und sie kommen am Anfang einer Zeile in
 * keiner Rede vor. Runde Klammern wären mehrdeutig: Ein ganzer Satz kann
 * eingeklammert sein und will trotzdem vorgelesen werden.
 *
 * Ein Hinweis wird **nicht mitgezählt** (er kostet keine Redezeit), **nicht
 * mitgehört** (er wird nie gesprochen — die Erkennung suchte sonst nach
 * Wörtern, die niemand sagt) und am Pult deutlich anders dargestellt als der
 * Text. Er behält trotzdem einen Moment im Lauf, sonst huschte er vorbei,
 * bevor ihn jemand liest.
 */
const HINWEIS = /^\[\s*(.+?)\s*\]$/

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
    const hinweis = HINWEIS.exec(roh)
    if (hinweis) {
      absatzAbschliessen()
      bloecke.push({ art: 'hinweis', text: hinweis[1] })
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

/** Zählt die Wörter eines Textstücks. */
export function zaehleWoerter(text: string): number {
  return text.split(/\s+/).filter((wort) => /[\p{L}\p{N}]/u.test(wort)).length
}

/**
 * Zählt die gesprochenen Wörter einer Rede — für die Schätzung der Redezeit.
 *
 * Hinweise zählen nicht mit: Sie werden gelesen, nicht gesagt, und eine Rede
 * würde sonst länger geschätzt, als sie dauert.
 */
export function redeWoerter(markdown: string): number {
  return redeBloecke(markdown)
    .filter((block) => block.art !== 'hinweis')
    .reduce((summe, block) => summe + zaehleWoerter(block.text), 0)
}

/**
 * Wie weit der Lauf reicht.
 *
 * **Nicht dasselbe wie die Wortzahl.** Atempausen und Hinweise haben kein
 * gesprochenes Wort, brauchen im Lauf aber ihren Moment — und die Ansicht
 * rechnet mit genau diesen Gewichten, wenn sie den Wortindex in Bildpunkte
 * umsetzt. Nähme das Ende die bloße Wortzahl, hielte der Lauf um so viele
 * Schritte zu früh an, wie die Rede Pausen und Hinweise hat: Der letzte Satz
 * käme nie bis zur Lesezeile.
 */
export function redeLaenge(markdown: string): number {
  return redeBloecke(markdown).reduce((summe, block) => summe + blockGewicht(block), 0)
}

/**
 * Ein Platzhalter für alles, was dasteht, ohne gesprochen zu werden.
 *
 * Er zählt im Lauf mit — eine Pause und ein Hinweis brauchen ihren Moment —,
 * kann aber von keinem gehörten Wort getroffen werden: Die Vergleichsform
 * eines Wortes besteht nur aus Buchstaben und Ziffern.
 */
const NICHT_GESPROCHEN = '\u0000'

/**
 * Die Rede als Folge vergleichbarer Wörter — in **derselben Zählung**, in der
 * auch der Lauf rechnet.
 *
 * Für das Mitlaufen nach Gehör. Zwei Dinge müssen dafür zusammenpassen, und
 * vorher taten sie es nicht ganz: Die Erkennung darf nicht nach Wörtern
 * suchen, die niemand spricht (ein Hinweis in eckigen Klammern), und die
 * Stelle, die sie meldet, muss dieselbe sein, die die Ansicht in Bildpunkte
 * umsetzt. Jeder ungesprochene Block bekommt deshalb genau einen Platz —
 * nicht null, sonst liefen beide Zählungen um eins je Pause auseinander.
 */
export function redeWortfolge(markdown: string): string[] {
  const folge: string[] = []
  for (const block of redeBloecke(markdown)) {
    const woerter = block.art === 'hinweis' || block.art === 'pause' ? [] : wortfolge(block.text)
    if (woerter.length === 0) folge.push(NICHT_GESPROCHEN)
    else folge.push(...woerter)
  }
  return folge
}

/**
 * Das Gewicht eines Blocks im Lauf.
 *
 * Wörter, mindestens aber eines: Eine Atempause hat keinen Text, soll aber
 * trotzdem einen Moment dauern — sonst überspringt der Lauf sie, und genau
 * dort wollte jemand Luft holen.
 */
export function blockGewicht(block: RedeBlock): number {
  /* Ein Hinweis wird gelesen, nicht gesprochen: ein Moment wie bei der Pause,
     nicht die Zeit seiner Wörter. */
  if (block.art === 'hinweis') return 1
  return Math.max(1, zaehleWoerter(block.text))
}

/**
 * Eigenes Schema für die Prompterseite am Hauptrechner.
 *
 * Nicht Bequemlichkeit, sondern Notwendigkeit: Unter `file://` hat eine Seite
 * keine Herkunft, und Chromium verweigert dort **Web Worker**. Die
 * Spracherkennung läuft aber in einem Worker — im Hauptfaden würde sie das
 * Rollen des Textes ruckeln lassen. Ein eigenes, als `standard` und `secure`
 * angemeldetes Schema gibt der Seite eine echte Herkunft; damit laufen Worker
 * und WebAssembly wie auf jeder Webseite, ohne dass ein Server nötig wäre.
 *
 * Ausgeliefert wird ausschließlich der gebaute Oberflächenordner — das
 * Dateisystem bleibt zu.
 */
export const PULT_SCHEME = 'votura-pult'

/** Endpunkt der Prompteransicht im Veranstaltungsnetz. */
export const PROMPTER_PFAD = '/prompter'
