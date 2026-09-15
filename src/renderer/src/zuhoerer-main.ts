/**
 * Das Zuhörerfenster — ein Fenster, das niemand sieht.
 *
 * ## Warum es überhaupt ein Fenster ist
 *
 * Untertitel brauchen ein Mikrofon und eine Spracherkennung. Beides bekommt in
 * Votura nicht jedes Fenster:
 *
 * - **Das Mikrofon** gibt der Hauptprozess nur Fenstern, die zuhören sollen
 *   (`src/main/medienrechte.ts`). Die Bedienoberfläche gehört ausdrücklich
 *   nicht dazu — dort hätte ein Mikrofon nichts zu suchen.
 * - **Die Erkennung** läuft in einem Web Worker, und den verweigert Chromium
 *   auf Seiten ohne Herkunft. Die Bedienoberfläche kommt aus einer Datei und
 *   hat keine.
 *
 * Der erste Versuch ließ die Erkennung in der Bedienoberfläche laufen und
 * scheiterte an beidem zugleich. Ein eigenes Fenster unter dem Pult-Schema
 * löst beides — und behält nebenbei die Regel, die dahintersteht: **ein
 * Fenster, ein Grund, ein Gerät.** Wer wissen will, wer hier zuhört, findet
 * genau diese Datei.
 *
 * ## Warum es versteckt ist
 *
 * Es gibt nichts zu bedienen. Der Text erscheint an der Wand, der Schalter
 * steht in der Beamer-Ansicht; ein leeres Fenster in der Leiste wäre nur eine
 * Stelle, an der jemand aus Versehen auf „Schließen" klickt.
 *
 * ## Aufgezeichnet wird nichts
 *
 * Der Ton geht in die Erkennung und ist danach weg. Was dieses Fenster nach
 * außen gibt, sind zwei Zeilen Text — mehr fasst der Puffer nicht.
 */
import {
  UNTERTITEL_STILLE_MS,
  UNTERTITEL_TAKT_MS,
  untertitelBilden,
  untertitelKuerzen,
  type ProjectionUntertitel
} from '@shared/untertitel'
import { starteZuhoeren } from './sprache/zuhoeren'

declare global {
  interface Window {
    voturaZuhoerer?: { melde(stand: ProjectionUntertitel): void }
  }
}

const bruecke = window.voturaZuhoerer

/** Was zuletzt gemeldet wurde — um Unverändertes nicht noch einmal zu schicken. */
let offen: ProjectionUntertitel = { zeilen: [] }
let sicher = ''
let vorlaeufig = ''
let zuletztGehoert = Date.now()

const gleich = (a: ProjectionUntertitel, b: ProjectionUntertitel): boolean =>
  a.vorlaeufigAbWort === b.vorlaeufigAbWort &&
  a.zeilen.length === b.zeilen.length &&
  a.zeilen.every((zeile, i) => zeile === b.zeilen[i])

/*
 * Gemeldet wird im Takt, nicht im Silbentakt.
 *
 * Die Erkennung meldet Zwischenstände, sobald sie ein Wort zu hören glaubt —
 * mehrmals je Sekunde. Jede einzelne durch die Leitungen an jeden Bildschirm
 * zu schicken hieße, den Beamerzustand im Sprechtempo zu erneuern, für einen
 * Text, den ohnehin niemand so schnell liest.
 */
setInterval(() => {
  /*
   * Nach einer Weile Stille fängt der Puffer neu an.
   *
   * Sonst stünde nach der Pause der halbe Satz des Vorredners vor dem ersten
   * Wort des nächsten — zwei Sätze, die nie zusammengehört haben, in einer
   * Zeile.
   */
  if (Date.now() - zuletztGehoert > UNTERTITEL_STILLE_MS) {
    sicher = ''
    vorlaeufig = ''
  }

  const stand = untertitelBilden(sicher, vorlaeufig)
  if (gleich(stand, offen)) return
  offen = stand
  bruecke?.melde(stand)
}, UNTERTITEL_TAKT_MS)

void starteZuhoeren({
  aufText: (text, endgueltig) => {
    zuletztGehoert = Date.now()
    if (endgueltig) {
      sicher = untertitelKuerzen(`${sicher} ${text}`)
      vorlaeufig = ''
    } else {
      vorlaeufig = text
    }
  },
  aufStand: (stand) => {
    /*
     * Niemand sieht dieses Fenster, also geht die Meldung in die Konsole des
     * Hauptprozesses — dorthin, wo bei einer Störung ohnehin nachgesehen
     * wird. Der Schalter in der Bedienung bleibt oben; dass die Erkennung
     * nicht anspringt, zeigt sich an der leeren Wand.
     */
    if (stand.art === 'fehler') console.error('[Zuhörer]', stand.text)
    if (stand.art === 'aus') console.info('[Zuhörer] beendet')
  }
})
