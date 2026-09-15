/**
 * Die Überlagerung — Einblendungen ohne Hintergrund, für einen Livestream.
 *
 * ## Wofür
 *
 * Wer die Versammlung überträgt, nimmt das Kamerabild direkt: NDI bedient
 * mehrere Empfänger, die Bildmischung holt sich dieselbe Quelle wie der Saal.
 * Was dabei **fehlt**, sind die Einblendungen — Votura zeichnet Bauchbinde,
 * Rednerreihe und Untertitel auf seine eigene Fläche und nicht in den
 * NDI-Strom hinein.
 *
 * Diese Seite schließt die Lücke: Sie zeigt genau diese drei Dinge auf
 * durchsichtigem Grund. In OBS oder vMix kommt sie als Browser-Quelle über
 * das Kamerabild, und der Stream trägt dieselben Einblendungen wie die Wand —
 * aus derselben Quelle, ohne dass jemand etwas zweimal tippt.
 *
 * ## Warum keine eigene Seite, sondern eine Spielart der Beameransicht
 *
 * Weil sie denselben Zustand braucht und ihn über dieselbe Leitung bekommt.
 * Eine zweite Seite hieße: ein zweiter Weg zum Zustand, der irgendwann anders
 * aussieht als der erste. Der Unterschied ist ein Zusatz in der Adresse, mehr
 * nicht.
 *
 * ## Warum sie **nur** die Einblendungen zeigt
 *
 * Tagesordnung, Ergebnis und Kandidatenliste gibt es im Stream längst: Die
 * gewöhnliche Netzansicht zeigt sie vollständig und lässt sich genauso als
 * Browser-Quelle einbinden. Was ihr fehlt, ist allein das Kamerabild — und
 * das holt die Bildmischung ohnehin direkt.
 */
import type { JSX } from 'react'
import { bauchbinde } from '@shared/kamera'
import type { ProjectionState } from '@shared/projection'
import { Bauchbinde, Naechste } from './KameraBild'
import { Untertitelband } from './Untertitelband'

export function Ueberlagerung({ state }: { state: ProjectionState }): JSX.Element {
  /*
   * Was eingeblendet wird, entscheidet die Bedienung — nicht diese Seite.
   *
   * Sie hält sich an dieselben Schalter wie das Kamerabild an der Wand:
   * Bauchbinde, Nächste, Untertitel. Wer im Saal die Bauchbinde ausschaltet,
   * weil gerade niemand aufgerufen ist, soll sie nicht im Stream stehen
   * haben — sonst behauptet die Übertragung etwas, das der Saal nicht sieht.
   */
  const zeigtBauchbinde = state.camera?.bauchbinde ?? false
  const zeigtNaechste = state.camera?.naechste ?? false
  const inhalt = bauchbinde(state.speaker)

  return (
    <div className="ueberlagerung">
      {zeigtBauchbinde && inhalt && <Bauchbinde inhalt={inhalt} logo={state.theme?.logo} speaker={state.speaker} />}
      {zeigtNaechste && <Naechste speaker={state.speaker} />}
      {state.untertitel && <Untertitelband untertitel={state.untertitel} hoch={zeigtBauchbinde || zeigtNaechste} />}
    </div>
  )
}
