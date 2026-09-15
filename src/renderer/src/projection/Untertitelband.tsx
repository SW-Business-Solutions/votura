/**
 * Das Untertitelband — was gesprochen wird, mitlesbar an der Wand.
 *
 * ## Warum unten und mittig
 *
 * Weil es dort seit sechzig Jahren steht. Untertitel sind das eine Element,
 * bei dem Gewohnheit schwerer wiegt als Gestaltung: Das Auge sucht sie unten
 * in der Mitte, und wer sie woandershin setzt, kostet jeden Leser eine
 * Sekunde — bei jedem Satz.
 *
 * Über dem Kamerabild rückt das Band nach oben, weil dort unten links die
 * Bauchbinde und unten rechts die Rednerreihe stehen. Dazwischen bleibt ein
 * Streifen frei, und genau der ist gemeint.
 *
 * ## Warum zwei Zeilen und nicht mehr
 *
 * Drei Zeilen verdecken Bild, vier liest im Vorbeisehen niemand mehr. Der
 * Umbruch selbst passiert nicht hier, sondern in `@shared/untertitel` — sonst
 * bräche jede Wand nach ihrer eigenen Breite um, und der Saal läse auf zwei
 * Flächen zwei verschiedene Bilder desselben Satzes.
 *
 * ## Warum das Vorläufige blasser ist
 *
 * Die Erkennung meldet erst, was sie zu hören glaubt, und berichtigt sich
 * danach. Beides gleich auszuzeichnen hieße, eine Sicherheit zu behaupten, die
 * noch nicht da ist. Ein blasserer Halbsatz sagt: *daran arbeite ich noch.*
 */
import type { JSX } from 'react'
import type { ProjectionUntertitel } from '@shared/untertitel'

export function Untertitelband({
  untertitel,
  hoch
}: {
  untertitel: ProjectionUntertitel
  /** Über einem Kamerabild mit Bauchbinde — dann sitzt das Band höher. */
  hoch?: boolean
}): JSX.Element | null {
  if (untertitel.zeilen.length === 0) return null

  /*
   * Die Grenze zum Vorläufigen zählt über alle Zeilen hinweg.
   *
   * Sie steht als **Wortnummer** im Zustand, nicht als Zeilennummer: Ein
   * Zwischenstand beginnt selten am Zeilenanfang. Beim Zeichnen wird deshalb
   * mitgezählt, wie viele Wörter schon hinter uns liegen.
   */
  const ab = untertitel.vorlaeufigAbWort ?? Number.POSITIVE_INFINITY
  let gezaehlt = 0

  return (
    <div className={`projection-untertitel${hoch ? ' hoch' : ''}`} aria-live="polite">
      {untertitel.zeilen.map((zeile, nummer) => {
        const woerter = zeile.split(' ')
        const gezeichnet = woerter.map((wort, i) => {
          const eigen = gezaehlt + i
          return (
            <span key={`${nummer}-${i}`} className={eigen >= ab ? 'vorlaeufig' : undefined}>
              {wort}
              {i < woerter.length - 1 ? ' ' : ''}
            </span>
          )
        })
        gezaehlt += woerter.length
        return (
          <p className="projection-untertitel-zeile" key={nummer}>
            {gezeichnet}
          </p>
        )
      })}
    </div>
  )
}
