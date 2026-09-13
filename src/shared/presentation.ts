/**
 * Präsentationen als eigener Beamer-Inhalt.
 *
 * Zwischen zwei Wahlgängen wird auf einer Mitgliederversammlung geredet —
 * Rechenschaftsbericht, Kandidatenvorstellung, Ausblick. Bisher musste dafür
 * der Beamer umgesteckt oder ein zweites Programm gestartet werden; die
 * Wahlansicht war so lange weg. Eine eingespeiste Präsentation läuft im
 * selben Fenster und derselben Netzwerkansicht, und ein Tastendruck bringt
 * den Wahlgang zurück.
 *
 * ## Was die Audience bekommt — und was nicht
 *
 * Die Beameransicht erhält **niemals** die Datei selbst über den
 * Projektionszustand, sondern nur diese Kennzahlen: welche Präsentation,
 * welche Folie, wie viele. Das Dokument liefert der Server als eigene
 * Ressource aus.
 *
 * Das ist kein Umweg, sondern die Regel aus Beamer §75/§88: Der Zustand
 * bleibt ein schmales DTO, das mehrmals je Sekunde durch SSE-Leitungen
 * passt. Eine eingebettete HTML-Datei von zwei Megabyte täte das nicht.
 *
 * ## Fremder Code, eingesperrt
 *
 * Eine importierte Präsentation bringt **eigenes JavaScript** mit — das ist
 * ihr Wesen, sie animiert und blättert. Ausgeführt wird sie deshalb in einem
 * `<iframe sandbox="allow-scripts">` **ohne** `allow-same-origin`: Der
 * Rahmen bekommt damit eine undurchsichtige Herkunft und kann weder auf das
 * umgebende Fenster noch auf die Preload-Brücke noch auf gespeicherte Daten
 * zugreifen. Die einzige Verbindung ist `postMessage` — eine Zahl in eine
 * Richtung, genau wie beim Projektionszustand selbst.
 */
import type { IsoDateTime, UUID } from './types'

/**
 * Woraus die Präsentation besteht.
 *
 * `html` ist ein Foliensatz, der sich selbst steuert — er bekommt die
 * Foliennummer und blättert eigenständig. `pdf` ist eine Folge fester Seiten,
 * die Votura selbst zeichnet; so kommen PowerPoint-Folien herein, denn
 * PowerPoint exportiert originalgetreu nach PDF.
 *
 * Der Unterschied betrifft nur die Darstellung: Nach außen — Beamer,
 * Netzwerkansicht, Vortragssteuerung, Projektionszustand — verhalten sich
 * beide gleich, nämlich als durchnummerierte Folien.
 */
export type PresentationKind = 'html' | 'pdf'

/** Eine eingespeiste Präsentation in der Bibliothek. */
export interface PresentationInfo {
  id: UUID
  /**
   * Art des Dokuments.
   *
   * Optional, weil Einträge aus einer älteren Fassung das Feld nicht kennen —
   * sie sind ausnahmslos HTML, und genau das gilt, wenn es fehlt.
   */
  kind?: PresentationKind
  /** Anzeigename; beim Import aus dem <title> der Datei oder dem Dateinamen. */
  title: string
  /** Ursprünglicher Dateiname, zur Wiedererkennung beim erneuten Import. */
  fileName: string
  /** Größe der abgelegten Datei in Bytes. */
  size: number
  /**
   * Zahl der Folien, sobald die Präsentation sie gemeldet hat.
   *
   * Beim Import unbekannt: Sie steht nicht im Dokument, sondern ergibt sich
   * erst, wenn dessen Skript gelaufen ist. Erst die laufende Präsentation
   * meldet sie zurück — vorher wäre jede Zahl geraten.
   */
  slideCount?: number
  importedAt: IsoDateTime
}

/** Was die Beameransicht über die laufende Präsentation erfährt. */
export interface ProjectionPresentation {
  id: UUID
  title: string
  /** Wie die Ansicht sie darstellen muss. Fehlt sie, gilt HTML. */
  kind?: PresentationKind
  /** Aktuelle Folie, **1-basiert** wie in der Anzeige. */
  slide: number
  /** Gesamtzahl, sofern schon gemeldet. */
  slideCount?: number
}

/**
 * Der Vertrag zwischen Votura und dem Dokument.
 *
 * Beide Richtungen laufen über `postMessage`. Das Feld `votura` ist die
 * Absenderkennung: In einem Fenster können mehrere Quellen Nachrichten
 * schicken — Browsererweiterungen, eingebettete Videos, die Präsentation
 * selbst. Ohne Kennung würde jede fremde Nachricht als Folienwechsel gelesen.
 */
export const PRESENTATION_CHANNEL = 'votura' as const

/**
 * Schema, unter dem das Beamerfenster die laufende Präsentation lädt.
 *
 * Im Fenster gibt es keinen Server; ein eigenes Schema liefert genau die
 * eine Datei aus, die gerade projiziert wird — ohne `file://` zu öffnen und
 * damit den Rest des Dateisystems.
 */
export const PRESENTATION_SCHEME = 'votura-presentation' as const

/** Art einer Präsentation, mit Vorgabe für Einträge ohne Angabe. */
export function presentationKind(eintrag: { kind?: PresentationKind; fileName?: string }): PresentationKind {
  if (eintrag.kind) return eintrag.kind
  return /[.]pdf$/i.test(eintrag.fileName ?? '') ? 'pdf' : 'html'
}

/**
 * Adresse der laufenden Präsentation.
 *
 * Die Kennung steht **im Pfad**, obwohl der Server ohnehin nur die gerade
 * projizierte Datei ausliefert und sie deshalb nicht bräuchte. Sie steht dort
 * für den Browser: Bliebe die Adresse über alle Präsentationen hinweg gleich,
 * wäre ein Wechsel für ihn keine Navigation — der Rahmen behielte das alte
 * Dokument, während Titel und Foliennummer daneben längst zum neuen gehören.
 *
 * Die Foliennummer gehört dagegen ausdrücklich **nicht** hinein: Sie ändert
 * sich bei jedem Tastendruck, und das Dokument lüde jedes Mal neu.
 */
export function presentationUrl(id: UUID, art: PresentationKind = 'html'): string {
  /* Die Endung ist für den Server bedeutungslos — er liefert ohnehin nur die
     laufende Datei aus. Sie steht für den Leser in der Fehlermeldung und für
     pdf.js, das aus der Adresse auf den Inhalt schließt. */
  return `${PRESENTATION_SCHEME}://laufend/${id}.${art === 'pdf' ? 'pdf' : 'html'}`
}

/** Dieselbe Datei über den Projektionsserver, für Geräte im Netz. */
export function presentationPath(
  id: UUID,
  art: PresentationKind = 'html',
  buehne = 1
): string {
  return `/presentation.html?p=${encodeURIComponent(id)}&art=${art}&buehne=${buehne}`
}

/** Votura → Dokument: zeige diese Folie (1-basiert). */
export interface PresentationCommand {
  votura: typeof PRESENTATION_CHANNEL
  type: 'goto'
  slide: number
}

/** Dokument → Votura: hier stehe ich (1-basiert), so viele habe ich. */
export interface PresentationReport {
  votura: typeof PRESENTATION_CHANNEL
  type: 'state'
  slide: number
  slideCount: number
  /** Optionale Überschrift der aktuellen Folie, für den Prompter. */
  slideTitle?: string
}

export function isPresentationReport(value: unknown): value is PresentationReport {
  if (typeof value !== 'object' || value === null) return false
  const nachricht = value as Partial<PresentationReport>
  return (
    nachricht.votura === PRESENTATION_CHANNEL &&
    nachricht.type === 'state' &&
    typeof nachricht.slide === 'number' &&
    typeof nachricht.slideCount === 'number'
  )
}

/** Zustand des Prompter-Fensters, wie ihn die Bedienoberfläche anzeigt. */
export interface PrompterWindowState {
  open: boolean
}
