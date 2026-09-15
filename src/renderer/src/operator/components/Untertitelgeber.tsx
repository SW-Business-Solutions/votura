/**
 * Der Untertitelgeber — hört zu, solange irgendeine Wand mitliest.
 *
 * ## Warum das im Gerüst hängt und nicht auf einer Seite
 *
 * Gesprochen wird die ganze Versammlung über, und die Bedienung steht dabei
 * mal auf der Tagesordnung, mal beim Wahlgang, mal bei den Kameras. Läge das
 * Zuhören auf einer Seite, brächen die Untertitel bei jedem Seitenwechsel ab —
 * und niemand käme auf die Idee, dass das zusammenhängt.
 *
 * Sichtbar ist hier nichts. Die Komponente zeichnet kein Bild; sie hält eine
 * Verbindung offen.
 *
 * ## Warum am Hauptrechner
 *
 * Ein Mikrofon gibt es nur in einem sicheren Kontext — die Saalgeräte hängen
 * über einfaches HTTP am Netz und bekommen keines. Erkannt wird deshalb hier,
 * und an die Wände geht der fertige Text.
 *
 * ## Aufgezeichnet wird nichts
 *
 * Der Ton geht in die Erkennung und ist danach weg. Der Puffer hier fasst zwei
 * Zeilen — gerade so viel, wie an der Wand steht. Ein Puffer, der die Rede
 * sammelte, wäre nach einer Stunde ein Wortprotokoll, und das soll hier
 * ausdrücklich nicht entstehen.
 */
import { useEffect, type JSX } from 'react'
import {
  UNTERTITEL_STILLE_MS,
  UNTERTITEL_TAKT_MS,
  untertitelBilden,
  untertitelKuerzen,
  type ProjectionUntertitel
} from '@shared/untertitel'
import { starteZuhoeren, type Zuhoeren } from '../../sprache/zuhoeren'
import { api } from '../../lib/api'
import { useApp } from '../state'

export function Untertitelgeber(): JSX.Element | null {
  const app = useApp()
  /* Irgendeine Bühne genügt: Gesprochen wird einmal im Saal. */
  const an = Object.values(app.projektionen).some((zustand) => Boolean(zustand.untertitel))

  const reportError = app.reportError
  const notify = app.notify

  useEffect(() => {
    if (!an) return

    let lebt = true
    let zuhoeren: Zuhoeren | undefined
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
     * Die Erkennung meldet Zwischenstände, sobald sie ein Wort zu hören
     * glaubt — mehrmals je Sekunde. Jede einzelne Meldung durch die
     * SSE-Leitungen an jeden Bildschirm zu schicken hieße, den Beamerzustand
     * im Sprechtempo zu erneuern, für einen Text, den ohnehin niemand so
     * schnell liest.
     */
    const takt = setInterval(() => {
      if (!lebt) return

      /*
       * Nach einer Weile Stille fängt der Puffer neu an.
       *
       * Sonst stünde nach der Pause der halbe Satz des Vorredners vor dem
       * ersten Wort des nächsten — zwei Sätze, die nie zusammengehört haben,
       * in einer Zeile.
       */
      if (Date.now() - zuletztGehoert > UNTERTITEL_STILLE_MS) {
        sicher = ''
        vorlaeufig = ''
      }

      const stand = untertitelBilden(sicher, vorlaeufig)
      if (gleich(stand, offen)) return
      offen = stand
      void api('untertitel.melde', stand).catch(() => {
        /* Ein verlorener Zwischenstand ist kein Fehler, den jemand sehen
           müsste — der nächste kommt in einem Viertel einer Sekunde. */
      })
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
        if (stand.art === 'fehler') reportError(new Error(stand.text))
      }
    })
      .then((laufend) => {
        if (!lebt) {
          laufend.beenden()
          return
        }
        zuhoeren = laufend
        notify('info', 'Untertitel: die Erkennung hört mit.')
      })
      .catch(reportError)

    return () => {
      lebt = false
      clearInterval(takt)
      zuhoeren?.beenden()
      /* Die Wand nicht mit einem halben Satz stehen lassen. */
      void api('untertitel.melde', { zeilen: [] }).catch(() => undefined)
    }
  }, [an, reportError, notify])

  return null
}
