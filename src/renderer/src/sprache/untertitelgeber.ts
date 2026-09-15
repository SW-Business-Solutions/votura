/**
 * Zuhören und Untertitel daraus machen — unabhängig davon, wo das läuft.
 *
 * ## Zwei Orte, eine Rechnung
 *
 * Untertitel entstehen an einem von zwei Plätzen: im versteckten
 * Zuhörerfenster am Hauptrechner, oder am **Pult** — im Prompterfenster, das
 * ebenso gut auf einem Saalgerät am Rednerpult laufen kann.
 *
 * Der zweite Weg ist der bessere, wo es ihn gibt: Der Hauptrechner steht oft
 * hinten im Saal oder im Nebenraum und hört von dort nur Hall. Am Pult steht
 * das Mikrofon, wo gesprochen wird.
 *
 * Was dazwischen liegt — Puffer, Takt, Stille — ist an beiden Orten dasselbe
 * und steht deshalb hier. Zwei Fassungen derselben Rechnung wären zwei, die
 * irgendwann verschiedene Untertitel schreiben.
 *
 * ## Aufgezeichnet wird nichts
 *
 * Der Ton geht in die Erkennung und ist danach weg — auch am Pult. Was das
 * Gerät weitergibt, sind zwei Zeilen Text; mehr fasst der Puffer nicht.
 */
import {
  UNTERTITEL_STILLE_MS,
  UNTERTITEL_TAKT_MS,
  untertitelBilden,
  untertitelKuerzen,
  type ProjectionUntertitel
} from '@shared/untertitel'
import { starteZuhoeren, type ZuhoerenStand } from './zuhoeren'

export interface Untertitelgeber {
  beenden(): void
}

export interface UntertitelgeberOptionen {
  /** Wohin der fertige Stand geht — Brücke, Netzaufruf, was auch immer. */
  melde: (stand: ProjectionUntertitel) => void
  /** Meldet Störungen; ohne Angabe bleiben sie in der Konsole. */
  aufStand?: (stand: ZuhoerenStand) => void
}

export async function starteUntertitelgeber(
  optionen: UntertitelgeberOptionen
): Promise<Untertitelgeber> {
  let lebt = true
  let sicher = ''
  let vorlaeufig = ''
  let zuletztGehoert = Date.now()
  let offen: ProjectionUntertitel = { zeilen: [] }

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
  const takt = setInterval(() => {
    if (!lebt) return

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
    optionen.melde(stand)
  }, UNTERTITEL_TAKT_MS)

  const zuhoeren = await starteZuhoeren({
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
      if (optionen.aufStand) optionen.aufStand(stand)
      else if (stand.art === 'fehler') console.error('[Untertitel]', stand.text)
    }
  })

  return {
    beenden(): void {
      lebt = false
      clearInterval(takt)
      zuhoeren.beenden()
      /* Die Wand nicht mit einem halben Satz stehen lassen. */
      optionen.melde({ zeilen: [] })
    }
  }
}
