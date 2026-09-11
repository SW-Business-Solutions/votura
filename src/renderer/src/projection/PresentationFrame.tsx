/**
 * Die laufende Präsentation im Bild.
 *
 * ## Warum ein `<iframe>` und keine Einbettung
 *
 * Eine eingespeiste Präsentation bringt **eigenes JavaScript** mit — das ist
 * ihr Wesen, sie blättert und animiert. Dieses fremde Skript im selben
 * Dokument laufen zu lassen wie die Beameransicht, hieße ihm alles zu öffnen,
 * was diese Ansicht sieht: den Projektionszustand, die Preload-Brücke, jeden
 * gespeicherten Wert.
 *
 * Der Rahmen bekommt deshalb `sandbox="allow-scripts"` — und ausdrücklich
 * **nicht** `allow-same-origin`. Diese Kombination gibt ihm eine
 * undurchsichtige Herkunft: Skripte laufen, aber `window.parent` ist
 * unerreichbar, `localStorage` wirft, und von `window.projection` weiß er
 * nichts. Damit gilt Beamer §2 auch für fremden Code, nicht nur für unseren.
 *
 * Die einzige Verbindung ist `postMessage` — eine Zahl hinein, eine Zahl
 * heraus.
 *
 * ## Warum der Rahmen nicht bei jeder Folie neu lädt
 *
 * `src` bleibt konstant und hängt nur an der Kennung der Präsentation. Stünde
 * die Foliennummer darin, lüde das Dokument bei jedem Tastendruck neu: zwei
 * Megabyte, ein weißes Aufblitzen und jede Animation von vorn. Geblättert
 * wird im laufenden Dokument.
 */
import { useEffect, useRef, type JSX } from 'react'
import {
  PRESENTATION_CHANNEL,
  isPresentationReport,
  type PresentationCommand,
  type ProjectionPresentation
} from '@shared/presentation'

interface Props {
  presentation: ProjectionPresentation
  /**
   * Woher das Dokument kommt.
   *
   * Zwei Wege, dieselbe Datei: im Beamerfenster ein eigenes Schema, in der
   * Netzwerkansicht ein Pfad auf demselben Server. Die Komponente muss
   * beides können, ohne zu wissen, wo sie läuft.
   */
  src: string
  /**
   * Wohin das Dokument meldet, was es über sich weiß.
   *
   * Im Electron-Fenster geht das an den Hauptprozess; in der Netzwerkansicht
   * bleibt es leer — dort ist die Ansicht rein lesend (§51), und die
   * Folienzahl kommt ohnehin über den Zustand.
   */
  onReport?: (slide: number, slideCount: number) => void
}

export function PresentationFrame({ presentation, src, onReport }: Props): JSX.Element {
  const rahmen = useRef<HTMLIFrameElement>(null)

  /* Was das Dokument über sich meldet. */
  useEffect(() => {
    function empfange(event: MessageEvent): void {
      /* Die Herkunft ist undurchsichtig ('null'), es kann also nicht über sie
         gefiltert werden. Stattdessen zählt der Absender im Inhalt — und dass
         die Nachricht aus genau unserem Rahmen kommt. */
      if (event.source !== rahmen.current?.contentWindow) return
      if (!isPresentationReport(event.data)) return
      onReport?.(event.data.slide, event.data.slideCount)
    }
    window.addEventListener('message', empfange)
    return () => window.removeEventListener('message', empfange)
  }, [onReport])

  /* Folienwechsel hineinreichen. */
  useEffect(() => {
    const fenster = rahmen.current?.contentWindow
    if (!fenster) return
    const befehl: PresentationCommand = {
      votura: PRESENTATION_CHANNEL,
      type: 'goto',
      slide: presentation.slide
    }
    /*
     * Ziel '*': Der Rahmen hat eine undurchsichtige Herkunft, eine genauere
     * Angabe gäbe es also gar nicht. Unbedenklich, weil die Nachricht nichts
     * Schützenswertes enthält — nur eine Foliennummer.
     */
    fenster.postMessage(befehl, '*')
  }, [presentation.slide, presentation.id])

  return (
    <iframe
      ref={rahmen}
      className="projection-presentation"
      /* Beide Wege liefern immer die gerade projizierte Präsentation aus. */
      src={src}
      sandbox="allow-scripts"
      title={presentation.title}
      /* Beim Wechsel der Präsentation ein neues Element erzwingen — sonst
         behielte der Rahmen den Zustand des vorigen Dokuments. */
      key={presentation.id}
    />
  )
}
