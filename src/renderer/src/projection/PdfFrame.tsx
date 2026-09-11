/**
 * Ein PDF als Foliensatz im Bild.
 *
 * ## Warum PDF und nicht PowerPoint
 *
 * Eine `.pptx` ist ein Archiv voller XML mit Verweisen auf Schriften, Layouts,
 * Diagramme und SmartArt. Es gibt Bibliotheken, die das im Browser nachbauen —
 * mit der Treue von „meistens ungefähr". Dieselbe Begründung, mit der MKV und
 * MOV bei den Videos ausgeschlossen sind: *läuft manchmal* ist im Saal
 * wertlos.
 *
 * PowerPoints eigener Export erzeugt dagegen ein originalgetreues PDF mit
 * eingebetteten Schriften — eine Datei, die alles mitbringt, genau wie ein
 * HTML-Foliensatz. Verloren gehen Animationen und Folienübergänge; die
 * überstehen keine Umwandlung, gleich welche.
 *
 * ## Warum gezeichnet und nicht eingebettet
 *
 * Ein `<iframe>` mit PDF überließe die Anzeige dem eingebauten Betrachter —
 * samt Werkzeugleiste, Blättern und Zoom, die der Saal nicht sehen soll, und
 * ohne verlässlichen Weg, die Seite von außen zu setzen. Hier wird die Seite
 * deshalb selbst auf eine Leinwand gezeichnet: nichts als die Folie, und die
 * Foliennummer kommt aus demselben Zustand wie bei allem anderen.
 *
 * ## Warum in Gerätepunkten gezeichnet wird
 *
 * Die Leinwand bekommt die Punktdichte des Bildschirms als Faktor, nicht nur
 * die Größe in CSS-Pixeln. Ein PDF in Bildschirmauflösung auf einen Beamer
 * geworfen wirkt matschig; der Faktor ist auf zwei begrenzt, weil darüber nur
 * noch Speicher verbraucht wird, ohne dass jemand einen Unterschied sieht.
 */
import { useEffect, useRef, useState, type JSX } from 'react'

interface Props {
  /** Adresse des Dokuments — eigenes Schema im Fenster, Serverpfad im Netz. */
  src: string
  /** Anzuzeigende Seite, **1-basiert**. */
  slide: number
  /** Meldet die Seitenzahl, sobald das Dokument geöffnet ist. */
  onReport?: (slide: number, slideCount: number) => void
}

export function PdfFrame({ src, slide, onReport }: Props): JSX.Element {
  const leinwand = useRef<HTMLCanvasElement>(null)
  const kasten = useRef<HTMLDivElement>(null)
  const dokument = useRef<{ numPages: number; getPage: (n: number) => Promise<unknown> } | null>(null)
  /*
   * Der laufende Zeichenvorgang.
   *
   * Auf dieselbe Leinwand darf immer nur einer schreiben. Beim Ändern der
   * Fenstergröße kommen die Anstöße dicht hintereinander — ohne Abbruch
   * beschwert sich pdf.js („Cannot use the same canvas…"), und die Vorschau
   * bleibt leer.
   */
  const laufenderLauf = useRef<{ cancel: () => void } | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [bereit, setBereit] = useState(false)

  /* Dokument laden. */
  useEffect(() => {
    let verworfen = false
    setBereit(false)
    setFehler(null)

    void (async () => {
      try {
        /*
         * pdf.js wird erst hier geladen, nicht beim Start der Anwendung. Der
         * Beamer zeigt meistens Wahlgänge; ein Foliensatz aus PDF ist die
         * Ausnahme, und ein Paket dieser Größe soll den Start nicht aufhalten.
         */
        const pdfjs = await import('pdfjs-dist')
        /*
         * pdf.js läuft hier ohne eigenen Arbeiterprozess.
         *
         * Die Anwendung wird aus `file://` geladen; ein Worker von dort hat
         * eine undurchsichtige Herkunft und wird von Chromium abgewiesen. Der
         * Arbeiter-Bau von pdf.js bringt für genau diesen Fall seinen
         * Nachrichtenbehandler auch als gewöhnliches Modul mit: Liegt er unter
         * `globalThis.pdfjsWorker`, rechnet pdf.js im Hauptstrang weiter.
         *
         * Das kostet Nebenläufigkeit — bei Folien, die nur beim Blättern neu
         * gezeichnet werden, fällt das nicht ins Gewicht. Ein hängender
         * Beamer wäre schlimmer als eine Zehntelsekunde Rechenzeit.
         */
        if (!(globalThis as Record<string, unknown>).pdfjsWorker) {
          const arbeiter = await import('pdfjs-dist/build/pdf.worker.mjs')
          ;(globalThis as Record<string, unknown>).pdfjsWorker = arbeiter
        }
        /* Eingebettete Schriften ja, Nachladen nein — die Richtlinie der
           Anwendung lässt ohnehin keine fremde Quelle zu. */
        const aufgabe = pdfjs.getDocument({ url: src, disableFontFace: false })
        const geladen = await aufgabe.promise
        if (verworfen) return
        dokument.current = geladen as unknown as typeof dokument.current
        setBereit(true)
        onReport?.(1, geladen.numPages)
      } catch (ursache) {
        if (verworfen) return
        setFehler(ursache instanceof Error ? ursache.message : 'Das PDF ließ sich nicht öffnen.')
      }
    })()

    return () => {
      verworfen = true
      dokument.current = null
    }
  }, [src])

  /* Seite zeichnen — bei jedem Wechsel und bei jeder Größenänderung. */
  useEffect(() => {
    if (!bereit) return
    let verworfen = false

    const zeichne = async (): Promise<void> => {
      const doc = dokument.current
      const ziel = leinwand.current
      const rahmen = kasten.current
      if (!doc || !ziel || !rahmen) return
      const nummer = Math.max(1, Math.min(Math.round(slide), doc.numPages))
      try {
        const seite = (await doc.getPage(nummer)) as {
          getViewport: (o: { scale: number }) => { width: number; height: number }
          render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => {
            promise: Promise<void>
            cancel: () => void
          }
        }
        if (verworfen) return

        const eins = seite.getViewport({ scale: 1 })
        /*
         * `clientWidth` statt `getBoundingClientRect()`: In der
         * Vortragssteuerung sitzt dieser Rahmen in einem Kasten, der per
         * `transform` verkleinert wird. Die Maße aus dem Rechteck wären die
         * bereits geschrumpften — die Folie käme als briefmarkengroßes Bild
         * heraus, das anschließend noch einmal verkleinert wird.
         */
        const platz = { width: rahmen.clientWidth, height: rahmen.clientHeight }
        if (platz.width <= 0 || platz.height <= 0) return
        /* Ganz hineinpassen, nicht beschneiden: Auf einer Folie steht im
           Zweifel am Rand etwas Wichtiges. */
        const massstab = Math.min(platz.width / eins.width, platz.height / eins.height)
        const dichte = Math.min(window.devicePixelRatio || 1, 2)
        const sicht = seite.getViewport({ scale: massstab * dichte })

        ziel.width = Math.floor(sicht.width)
        ziel.height = Math.floor(sicht.height)
        ziel.style.width = `${Math.floor(eins.width * massstab)}px`
        ziel.style.height = `${Math.floor(eins.height * massstab)}px`

        const kontext = ziel.getContext('2d')
        if (!kontext) return
        laufenderLauf.current?.cancel()
        kontext.clearRect(0, 0, ziel.width, ziel.height)
        const lauf = seite.render({ canvasContext: kontext, viewport: sicht })
        laufenderLauf.current = lauf
        await lauf.promise
        if (laufenderLauf.current === lauf) laufenderLauf.current = null
      } catch (ursache) {
        /* Ein abgebrochener Lauf ist kein Fehler, sondern der Normalfall beim
           schnellen Ändern der Größe. */
        const abgebrochen =
          ursache instanceof Error && /RenderingCancelled|cancel/i.test(ursache.name + ursache.message)
        if (!verworfen && !abgebrochen) {
          setFehler(ursache instanceof Error ? ursache.message : 'Die Seite ließ sich nicht zeichnen.')
        }
      }
    }

    void zeichne()
    const beobachter = new ResizeObserver(() => void zeichne())
    if (kasten.current) beobachter.observe(kasten.current)
    return () => {
      verworfen = true
      beobachter.disconnect()
      laufenderLauf.current?.cancel()
      laufenderLauf.current = null
    }
  }, [bereit, slide])

  return (
    <div className="projection-pdf" ref={kasten}>
      {fehler ? (
        <div className="projection-presentation-empty">
          <div className="projection-status">PDF</div>
          <div className="projection-note">{fehler}</div>
        </div>
      ) : (
        <canvas ref={leinwand} />
      )}
    </div>
  )
}
