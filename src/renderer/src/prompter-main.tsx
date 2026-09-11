/**
 * Vortragssteuerung — was die vortragende Person vor sich hat.
 *
 * Links die Folie, die das Publikum gerade sieht; rechts die, die als
 * Nächstes kommt. Darunter Position, Uhrzeit und die Zeit seit Beginn des
 * Vortrags.
 *
 * ## Warum zwei Rahmen dieselbe Datei laden
 *
 * Beide Vorschauen sind eigene `<iframe>` auf dasselbe Dokument — der eine
 * steht auf der aktuellen Folie, der andere eine weiter. Das kostet ein
 * zweites Mal Ladezeit, dafür ist die Vorschau **echt**: Sie zeigt genau das,
 * was gleich an der Wand steht, samt Schriften, Bildern und Umbrüchen. Ein
 * nachgebautes Miniaturbild wäre schneller und gelegentlich falsch — und
 * falsch ist hier schlimmer als langsam.
 *
 * ## Warum dieses Fenster die Tastatur bekommt
 *
 * Es ist ein eigenes Fenster und keine Seite im Hauptfenster. Dort sind die
 * Pfeiltasten längst vergeben — sie bewegen sich durch Kandidatenlisten. Hier
 * gehören sie dem Vortrag, und das Fenster nimmt sie, sobald es vorn liegt.
 */
import { StrictMode, useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import {
  PRESENTATION_CHANNEL,
  isPresentationReport,
  presentationUrl,
  type PresentationCommand
} from '@shared/presentation'
import { EMPTY_PROJECTION_STATE, type ProjectionState } from '@shared/projection'
import './styles/prompter.css'

interface PrompterBridge {
  getInitialState(): Promise<ProjectionState>
  onStateChange(callback: (state: ProjectionState) => void): () => void
  goto(slide: number): void
  report(slide: number, slideCount: number): void
  onBeamerSize(callback: (size: { width: number; height: number }) => void): () => void
}

declare global {
  interface Window {
    prompter?: PrompterBridge
  }
}

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
function Vorschau({
  presentationId,
  slide,
  beamer,
  gross,
  onReport
}: {
  presentationId: string
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
        <iframe
          ref={rahmen}
          src={presentationUrl(presentationId)}
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

function Uhr(): JSX.Element {
  const [jetzt, setJetzt] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setJetzt(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return <span>{jetzt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
}

/** Zeit seit dem Aufruf der Präsentation — nicht seit dem Programmstart. */
function Stoppuhr({ seit }: { seit: number }): JSX.Element {
  const [jetzt, setJetzt] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setJetzt(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const sekunden = Math.max(0, Math.floor((jetzt - seit) / 1000))
  const min = Math.floor(sekunden / 60)
  const sek = sekunden % 60
  return (
    <span>
      {String(min).padStart(2, '0')}:{String(sek).padStart(2, '0')}
    </span>
  )
}

function PrompterApp(): JSX.Element {
  const [state, setState] = useState<ProjectionState>(EMPTY_PROJECTION_STATE)
  const [seit, setSeit] = useState(() => Date.now())
  /* Bis der Hauptprozess die wirkliche Größe meldet, gilt das gängige
     Beamerformat — so steht nie ein leerer Kasten da. */
  const [beamer, setBeamer] = useState({ width: 1920, height: 1080 })

  useEffect(() => {
    const bridge = window.prompter
    if (!bridge) return
    void bridge.getInitialState().then(setState)
    const abState = bridge.onStateChange(setState)
    const abGroesse = bridge.onBeamerSize(setBeamer)
    return () => {
      abState()
      abGroesse()
    }
  }, [])

  /*
   * Was der Foliensatz über sich meldet, an den Hauptprozess geben.
   *
   * Ohne diesen Weg bliebe die Gesamtzahl unbekannt, und die Steuerung zählte
   * über das Ende des Vortrags hinaus weiter.
   */
  const melde = useCallback((folie: number, anzahl: number) => {
    window.prompter?.report(folie, anzahl)
  }, [])

  const praesentation = state.presentation
  const folie = praesentation?.slide ?? 1
  const anzahl = praesentation?.slideCount
  const laeuft = state.mode === 'presentation' && Boolean(praesentation)

  /* Die Stoppuhr beginnt, wenn eine andere Präsentation aufgerufen wird. */
  useEffect(() => {
    if (praesentation?.id) setSeit(Date.now())
  }, [praesentation?.id])

  const springe = useCallback(
    (ziel: number) => {
      if (!laeuft) return
      const grenze = anzahl ?? Number.MAX_SAFE_INTEGER
      window.prompter?.goto(Math.max(1, Math.min(ziel, grenze)))
    },
    [laeuft, anzahl]
  )

  const weiter = useCallback(() => springe(folie + 1), [springe, folie])
  const zurueck = useCallback(() => springe(folie - 1), [springe, folie])

  useEffect(() => {
    function taste(event: KeyboardEvent): void {
      /* In einem Eingabefeld gehören die Tasten dem Feld. */
      const ziel = event.target as HTMLElement | null
      if (ziel && /^(INPUT|TEXTAREA|SELECT)$/.test(ziel.tagName)) return

      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
          event.preventDefault()
          weiter()
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          event.preventDefault()
          zurueck()
          break
        case 'Home':
          event.preventDefault()
          springe(1)
          break
        case 'End':
          event.preventDefault()
          if (anzahl) springe(anzahl)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [weiter, zurueck, springe, anzahl])

  if (!laeuft) {
    return (
      <div className="prompter-leer">
        <h1>Keine Präsentation auf dem Beamer</h1>
        <p>
          Im Hauptfenster unter <strong>Beamer</strong> eine Präsentation auswählen und auf
          <strong> Präsentation</strong> umschalten. Dieses Fenster folgt dann von selbst.
        </p>
      </div>
    )
  }

  const letzte = anzahl ? folie >= anzahl : false

  return (
    <div className="prompter">
      <div className="prompter-buehne">
        <section className="prompter-jetzt">
          <h2>Auf dem Beamer</h2>
          <Vorschau
            presentationId={praesentation!.id}
            slide={folie}
            beamer={beamer}
            onReport={melde}
            gross
          />
        </section>
        <section className="prompter-naechste">
          <h2>Als Nächstes</h2>
          {letzte ? (
            <div className="prompter-ende">Letzte Folie</div>
          ) : (
            <Vorschau presentationId={praesentation!.id} slide={folie + 1} beamer={beamer} />
          )}
        </section>
      </div>

      <footer className="prompter-leiste">
        <div className="prompter-stand">
          <strong>{folie}</strong>
          <span> / {anzahl ?? '?'}</span>
          <em>{praesentation?.title}</em>
        </div>

        <div className="prompter-zeiten">
          <span title="Uhrzeit">
            <Uhr />
          </span>
          <span title="Seit Beginn der Präsentation">
            ⏱ <Stoppuhr seit={seit} />
          </span>
        </div>

        <div className="prompter-knoepfe">
          <button type="button" onClick={zurueck} disabled={folie <= 1} aria-label="Vorige Folie">
            ←
          </button>
          <button type="button" onClick={weiter} disabled={letzte} aria-label="Nächste Folie">
            →
          </button>
        </div>
      </footer>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <PrompterApp />
  </StrictMode>
)
