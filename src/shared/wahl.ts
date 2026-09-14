/**
 * Die digitale Stimmabgabe — was Hauptrechner und Endgerät voneinander wissen.
 *
 * Die Begriffe stehen hier und nicht im Dienst, weil beide Seiten sie
 * brauchen: der Hauptrechner, der signiert und einsammelt, und die Seite auf
 * dem Telefon, die verblendet und abgibt.
 */
import type { OeffentlicherSchluessel } from './blindsignatur'
import type { IsoDateTime, UUID } from './types'

/** Pfad der Wahlseite auf dem Projektionsserver. */
export const WAHL_PFAD = '/stimme'

/** Pfad der Seite des Wahlausschusses — sie hält den Schlüssel. */
export const AUSSCHUSS_PFAD = '/ausschuss'

/**
 * Wie geheim die Abstimmung ist.
 *
 * - `open` — offene Abstimmung, etwa an Stelle von Handzeichen. Der Rechner
 *   **könnte** zuordnen, tut es aber nicht: In der Urne steht keine Person.
 * - `namentlich` — die Zuordnung ist ausdrücklich gewollt und gehört ins
 *   Protokoll. Nur auf Beschluss der Versammlung.
 * - `secret` — geheime Wahl. Die Zuordnung ist nicht nur ungespeichert,
 *   sondern unmöglich (Blindsignatur).
 */
export type Wahlgeheimnis = 'open' | 'namentlich' | 'secret'

export const GEHEIMNIS_LABELS: Record<Wahlgeheimnis, string> = {
  open: 'Offene Abstimmung',
  namentlich: 'Namentliche Abstimmung',
  secret: 'Geheime Wahl'
}

/** Womit abgestimmt werden darf. */
export type Geraetewahl = 'own' | 'booth' | 'both'

export const GERAETE_LABELS: Record<Geraetewahl, string> = {
  own: 'Eigene Geräte',
  booth: 'Nur Wahlkabinen',
  both: 'Eigene Geräte und Wahlkabinen'
}

export type Wahlstatus = 'prepared' | 'open' | 'closed'

/** Eine Stimme, wie sie das Gerät abschickt. */
export interface Stimmabgabe {
  /** Angekreuzte Bewerber. */
  kandidaten?: UUID[]
  /** Sachabstimmung. */
  antwort?: 'ja' | 'nein' | 'enthaltung'
}

/** Was der Hauptrechner über eine laufende Abstimmung sagt. */
export interface WahlLage {
  roundId: UUID
  roundLabel: string
  titel: string
  geheimnis: Wahlgeheimnis
  geraete: Geraetewahl
  status: Wahlstatus
  /** Höchstens so viele Bewerber dürfen angekreuzt werden. */
  maxStimmen: number
  /** Zur Auswahl stehende Bewerber, in der Reihenfolge des Stimmzettels. */
  kandidaten: { id: UUID; name: string }[]
  /** Bei Sachabstimmungen gibt es keine Bewerber, sondern Ja/Nein/Enthaltung. */
  sachabstimmung: boolean
  /** Nur bei geheimer Wahl: der öffentliche Schlüssel dieses Wahlgangs. */
  schluessel?: OeffentlicherSchluessel
  openedAt?: IsoDateTime
}

/** Was ein Gerät über seinen eigenen Stand erfährt. */
export interface WahlAuskunft {
  lage: WahlLage | null
  /** Klartext, warum gerade nicht abgestimmt werden kann. */
  hindernis?: string
  /** Der Ausweis ist gültig und die Person darf abstimmen. */
  berechtigt: boolean
  /**
   * Für diesen Wahlgang wurde bereits eine Berechtigung ausgegeben.
   *
   * Das Gerät erfährt es **vorher**. Es erst beim Absenden zu sagen, hieße
   * jemanden erst auswählen zu lassen und ihm dann das Papier wegzunehmen.
   */
  bereitsAusgegeben: boolean
  /** Name der Person — damit am Gerät niemand für einen anderen abstimmt. */
  name?: string
  /** Stimmgewicht, falls größer als eins. */
  gewicht?: number
}

/** Der Stand der Urne, wie ihn die Leinwand zeigt. */
export interface WahlStand {
  ausgegeben: number
  abgegeben: number
  /** Summe der Stimmgewichte in der Urne. */
  gewicht: number
  /**
   * Ausgegebene Berechtigungen, die entwertet wurden.
   *
   * Sie erklären die Lücke zwischen ausgegeben und abgegeben. Ohne sie sähe
   * die Bilanz nach verschwundenen Stimmen aus — und jede unerklärte Lücke
   * ist bei einer Wahl ein Vorwurf, auch wenn sie harmlos ist.
   */
  entwertet: number
}
