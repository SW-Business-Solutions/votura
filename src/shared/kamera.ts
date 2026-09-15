/**
 * Kamerabilder im Saal — über NDI.
 *
 * Eine Kamera vor dem Pult, ihr Bild auf den Bildschirmen im Saal: Das ist
 * Saalregie, nicht Wahlorganisation. Votura macht es trotzdem, aus einem
 * Grund, den kein Bildmischer hat — es **weiß, wer da vorne steht**: Name,
 * Bewerbung, verbleibende Redezeit. Erst dadurch wird aus dem Bild eine
 * Bauchbinde, die stimmt, ohne dass jemand sie tippt.
 *
 * ## Warum NDI und nicht der Browser
 *
 * Der naheliegende Weg wäre, ein Gerät im Saal filmen zu lassen und das Bild
 * über WebRTC zu verteilen. Das setzt aber voraus, dass Votura das Aufnehmen
 * löst — Erlaubnisse, Kameraauswahl, Verbindungsaufbau zwischen Geräten. NDI
 * dreht das um: Die Kamera ist schon eine Quelle im Netz, Votura muss sie nur
 * finden und empfangen. Wer NDI-Kameras hat, steckt sie ein und ist fertig.
 *
 * ## Warum jedes Gerät selbst empfängt
 *
 * Im Zustand steht **der Name der Quelle**, nicht ihr Bild. Jeder Bildschirm,
 * der diese Bühne zeigt, baut seine eigene Verbindung zur Kamera auf — das
 * Beamerfenster am Hauptrechner genauso wie ein Pi hinter dem zweiten Beamer.
 *
 * Der andere Weg — der Hauptrechner empfängt einmal und verteilt weiter —
 * klingt sparsamer und ist es nicht: Er müsste jedes Bild neu kodieren, und
 * die Versammlung hinge mit ihren Bildschirmen an einem Rechner, der
 * gleichzeitig die Wahl führt. Hier ist es dieselbe Entscheidung wie beim
 * Video und bei der Redezeit: **Zustand verschicken, nicht Bilder.**
 *
 * ## Bandbreite — die Grenze, die man nicht verhandeln kann
 *
 * NDI in voller Qualität braucht je Bild 100–150 Mbit/s. Über dasselbe WLAN,
 * über das Handzettel und die digitale Abstimmung laufen, geht das nicht —
 * und zwar nicht „schlecht", sondern auf Kosten der Wahl. Kameras gehören
 * deshalb ans Kabel, und Geräte im Funknetz bekommen den Vorschaustrom
 * (`'vorschau'`), den NDI ohnehin nebenher anbietet: kleiner, gröber, für
 * einen Nebenbildschirm völlig ausreichend.
 *
 * NDI® ist eine eingetragene Marke der Vizrt NDI AB.
 */
import type { ProjectionSpeaker } from './projection'
import { redezeitRest } from './projection'

/** Eine im Netz gefundene NDI-Quelle. */
export interface KameraQuelle {
  /**
   * Der volle NDI-Name, etwa `PULTKAMERA (OBSBOT Tail Air)`.
   *
   * Er ist zugleich die Kennung: NDI adressiert Quellen über den Namen, nicht
   * über eine Adresse. Ein Gerät, das seine Adresse wechselt, bleibt damit
   * dieselbe Quelle — genau das, was ein Saal mit DHCP braucht.
   */
  name: string
  /** Adresse, unter der die Quelle gefunden wurde — nur zur Anzeige. */
  adresse?: string
}

/**
 * Wie viel Bild ein Gerät anfordert.
 *
 * `hoch` ist der volle Strom, `vorschau` der Nebenstrom, den jede NDI-Quelle
 * zusätzlich sendet. Die Wahl trifft **das empfangende Gerät**, nicht die
 * Bedienung: Ob ein Bildschirm am Kabel hängt oder im Funknetz, weiß nur er.
 */
export type KameraQualitaet = 'hoch' | 'vorschau'

/** Was die Beameransicht über die laufende Kamera erfährt. */
export interface ProjectionCamera {
  /** Name der NDI-Quelle, die dieses Bild liefert. */
  quelle: string
  /** Eigener Name für die Bedienung, etwa „Pult" — sonst der NDI-Name. */
  label?: string
  /**
   * Bauchbinde einblenden, sobald jemand aufgerufen ist.
   *
   * Abschaltbar, weil nicht jedes Kamerabild eine ist: Ein Blick in den Saal
   * während der Auszählung braucht keinen Namen darunter.
   */
  bauchbinde: boolean
  /**
   * Bild spiegeln.
   *
   * Für den Rückblickschirm, den die vortragende Person selbst sieht — ein
   * Bild, das seitenverkehrt ist, verwirrt dort jeden.
   */
  spiegeln: boolean
}

/**
 * Der Inhalt einer Bauchbinde — gerechnet, nicht gestaltet.
 *
 * Die Trennung ist Absicht: Was drinsteht, ist prüfbar, ohne einen Browser zu
 * starten; wie es aussieht, entscheidet die Ansicht.
 */
export interface Bauchbinde {
  name: string
  /** Zusatz unter dem Namen, etwa „Bewerbung um den Vorsitz". */
  zusatz?: string
  /** Verbleibende Redezeit in Sekunden — fehlt, wenn keine gesetzt ist. */
  restSekunden?: number
  /** Zugestandene Redezeit in Sekunden, für den Balken. */
  gesamtSekunden?: number
  /** Die Uhr ruht — etwa während einer Zwischenfrage. */
  angehalten: boolean
}

/**
 * Was unter dem Kamerabild stehen soll.
 *
 * `undefined` heißt: nichts einblenden. Das ist der Normalfall, solange
 * niemand aufgerufen ist — ein leerer Balken über dem Bild wäre schlimmer als
 * gar keiner.
 */
export function bauchbinde(
  speaker: ProjectionSpeaker | undefined,
  jetzt = Date.now()
): Bauchbinde | undefined {
  if (!speaker?.name.trim()) return undefined
  return {
    name: speaker.name.trim(),
    zusatz: speaker.note?.trim() || undefined,
    restSekunden: redezeitRest(speaker, jetzt),
    gesamtSekunden: speaker.totalSeconds,
    angehalten: speaker.pausedSecondsLeft !== undefined
  }
}

/**
 * Wie eine Quelle in der Bedienung heißt.
 *
 * NDI-Namen tragen den Rechnernamen in Klammern mit — `PULT (OBSBOT Tail
 * Air)`. In einer Liste von vier Kameras ist der Teil davor das, was zählt.
 */
export function kurzerQuellenname(name: string): string {
  const klammer = name.indexOf(' (')
  return klammer > 0 ? name.slice(0, klammer) : name
}

/**
 * Wie das empfangende Gerät seine Bildqualität wählt.
 *
 * Kabel bekommt das volle Bild, Funk den Vorschaustrom. Die Auskunft kommt
 * vom Browser (`navigator.connection`) und ist nicht überall zu haben —
 * fehlt sie, gilt Kabel: Der Regelfall ist der Beamerrechner, und ein
 * unnötig grobes Bild an der Saalwand fiele auf.
 */
export function qualitaetFuer(ueberFunk: boolean | undefined): KameraQualitaet {
  return ueberFunk === true ? 'vorschau' : 'hoch'
}

/**
 * Was der Rechner über Kameras weiß.
 *
 * `untauglich` und eine leere Liste sind ausdrücklich zweierlei: „auf diesem
 * Rechner nicht zu haben“ ist eine Eigenschaft der Maschine, „keine Kamera
 * gefunden“ eine des Saals. Wer beides gleich anzeigte, schickte jemanden
 * Kabel prüfen, wo nichts zu prüfen ist.
 */
export interface KameraStand {
  /** Läuft der Empfängerprozess? */
  bereit: boolean
  /** Fassung des NDI-SDK, sobald bekannt. */
  sdk?: string
  /** Warum es hier keine Kameras gibt — fehlende Bibliothek, fremder Prozessor. */
  untauglich?: string
  quellen: KameraQuelle[]
  /** Letzte Störung, zur Anzeige in der Bedienung. */
  fehler?: string
}

/** Schema, unter dem das Beamerfenster seine Kameraverbindung anmeldet. */
export const KAMERA_SCHEME = 'votura-kamera' as const

/**
 * Wie lange ohne Bild vergehen darf, bevor die Ansicht es sagt.
 *
 * Eine Kamera, die vier Sekunden nichts liefert, ist aus oder abgesteckt.
 * Kürzer wäre falscher Alarm — NDI-Verbindungen brauchen beim Aufbau ihre
 * Zeit.
 */
export const KAMERA_STILLE_MS = 4000
