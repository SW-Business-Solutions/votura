/**
 * Eine Folienvorschau für Vortragssteuerung und Teleprompter.
 *
 * Gemeinsam genutzt, weil beide dasselbe zeigen: die Folie an der Wand und
 * die nächste. Zwei Fassungen desselben Bausteins liefen unweigerlich
 * auseinander — und ausgerechnet die Vorschau muss stimmen.
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import {
  PRESENTATION_CHANNEL,
  isPresentationReport,
  type PresentationCommand,
  type PresentationKind
} from '@shared/presentation'
import { PdfFrame } from '../projection/PdfFrame'
import './FolienVorschau.css'

/**
 * Eine Folienvorschau: derselbe Foliensatz, auf eine feste Folie gestellt.
 *
 * ## Warum beide Vorschauen dieselbe Fläche bekommen
 *
 * Ein Foliensatz richtet sich nach der Größe seines Fensters — er bricht um,
 * verteilt neu, blendet aus. Bekäme die kleinere Vorschau einfach ein
 * schmaleres Fenster, sähe sie nicht aus wie eine verkleinerte Folie, sondern
 * wie eine **andere**: umgebrochene Überschriften, verschobene Kästen,
 * abgeschnittener Text.
 *
 * Beide Rahmen rechnen deshalb mit der Größe des **Beamerfensters** und
 * werden anschließend auf ihre Kachel geschrumpft. Der Maßstab wird gemessen
 * und nicht gerechnet: `transform: scale()` verlangt eine reine Zahl, die sich
 * in CSS nicht aus einer Breite ableiten lässt.
 */
export function FolienVorschau({
  presentationId,
  quelle,
  art,
  slide,
  beamer,
  gross,
  onReport
}: {
  presentationId: string
  /**
   * Woher die Datei kommt.
   *
   * Im Fenster ein eigenes Schema, im Browser eines Geräts im Saal derselbe
   * Server, der auch diese Seite ausgeliefert hat. Die Entscheidung trifft
   * der Aufrufer — dieser Baustein zeigt nur an.
   */
  quelle: string
  art: PresentationKind
  slide: number
  beamer: { width: number; height: number }
  gross?: boolean
  onReport?: (slide: number, slideCount: number) => void
}): JSX.Element {
  const kachel = useRef<HTMLDivElement>(null)
  const rahmen = useRef<HTMLIFrameElement>(null)
  const [bereit, setBereit] = useState(false)
  const [massstab, setMassstab] = useState(0)

  /* Beim Wechsel des Foliensatzes laedt der Rahmen neu und meldet sich erst
     danach wieder als bereit. */
  useEffect(() => setBereit(false), [presentationId])

  /* Der Maßstab folgt der Kachel — auch wenn das Fenster gezogen wird. */
  useEffect(() => {
    const element = kachel.current
    if (!element) return
    const messen = (): void => {
      const breite = element.clientWidth
      const hoehe = element.clientHeight
      if (breite <= 0 || hoehe <= 0) return
      setMassstab(Math.min(breite / beamer.width, hoehe / beamer.height))
    }
    messen()
    const beobachter = new ResizeObserver(messen)
    beobachter.observe(element)
    return () => beobachter.disconnect()
  }, [beamer.width, beamer.height])

  /* Folienwechsel hineinreichen. */
  useEffect(() => {
    if (!bereit) return
    const fenster = rahmen.current?.contentWindow
    if (!fenster) return
    const befehl: PresentationCommand = {
      votura: PRESENTATION_CHANNEL,
      type: 'goto',
      slide
    }
    fenster.postMessage(befehl, '*')
  }, [slide, bereit])

  /*
   * Was der Foliensatz über sich meldet, weiterreichen.
   *
   * Nur die große Vorschau tut das: Die kleine steht eine Folie weiter, ihre
   * Meldung wuerde den Stand vorspulen.
   */
  useEffect(() => {
    if (!onReport) return
    function empfange(event: MessageEvent): void {
      if (event.source !== rahmen.current?.contentWindow) return
      if (!isPresentationReport(event.data)) return
      onReport?.(event.data.slide, event.data.slideCount)
    }
    window.addEventListener('message', empfange)
    return () => window.removeEventListener('message', empfange)
  }, [onReport])

  return (
    <div className={`prompter-vorschau${gross ? ' gross' : ''}`} ref={kachel}>
      <div
        className="prompter-vorschau-flaeche"
        style={{
          width: `${beamer.width * massstab}px`,
          height: `${beamer.height * massstab}px`
        }}
      >
        {art === 'pdf' ? (
          /* Ein PDF steuert sich nicht selbst; die Vorschau zeichnet die Seite
             mit denselben Mitteln wie der Beamer. */
          <div
            style={{
              width: `${beamer.width}px`,
              height: `${beamer.height}px`,
              transform: `scale(${massstab})`,
              transformOrigin: 'top left',
              position: 'absolute',
              top: 0,
              left: 0
            }}
          >
            <PdfFrame
              src={quelle}
              slide={slide}
              /* Nur die große Vorschau meldet: Die kleine steht eine Seite
                 weiter und würde den Stand vorspulen. */
              onReport={onReport}
            />
          </div>
        ) : (
          <iframe
            ref={rahmen}
            src={quelle}
            sandbox="allow-scripts"
            title={gross ? 'Aktuelle Folie' : 'Nächste Folie'}
            tabIndex={-1}
            onLoad={() => setBereit(true)}
            style={{
              width: `${beamer.width}px`,
              height: `${beamer.height}px`,
              transform: `scale(${massstab})`
            }}
          />
        )}
        {/*
          Eine durchsichtige Fläche über dem Rahmen.

          Ohne sie landet ein Klick **im** Foliensatz — der hat eigene
          Schaltflächen, und ein versehentlicher Treffer brächte die Vorschau
          aus dem Tritt, ohne dass der Beamer folgte.
        */}
        <div className="prompter-vorschau-schild" />
      </div>
    </div>
  )
}
