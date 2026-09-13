/**
 * Der Teleprompter.
 *
 * Zwei Bezugswege, dieselbe Ansicht:
 * - im Fenster am Hauptrechner über die Preload-Brücke,
 * - im Browser eines Geräts am Pult über `/prompter` und Server-Sent-Events.
 *
 * ## Warum die Uhr den Lauf bestimmt
 *
 * Die Stelle im Text ergibt sich aus `position + verstrichene Zeit × Tempo`.
 * Jedes Gerät rechnet sie selbst aus — auch eines, das erst mitten in der
 * Rede dazukommt. Ein Zähler, der Befehle verschickt, verlöre genau dort den
 * Anschluss.
 *
 * ## Warum in Zeilenhöhen gemessen wird
 *
 * Ein Telefon am Pult, ein Tablet im Spiegel und der Bildschirm der
 * Wahlleitung haben verschiedene Flächen und verschiedene Schriftgrößen. In
 * Pixeln gemessen stünde jedes woanders. In Zeilenhöhen stehen alle an
 * derselben Stelle im Text.
 */
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ApiMethod, ApiParams, ApiResult } from '@shared/ipc'
import {
  prompterPosition,
  PROMPTER_VORGABE,
  redeBloecke,
  SCHRIFT_MAX,
  SCHRIFT_MIN,
  TEMPO_MAX,
  TEMPO_MIN,
  type PrompterViewState,
  type RedeBlock
} from '@shared/speech'
import './styles/teleprompter.css'

interface TeleprompterBridge {
  invoke<M extends ApiMethod>(method: M, ...args: ApiParams<M>): Promise<ApiResult<M>>
  onViewChange(callback: (state: PrompterViewState) => void): () => void
}

declare global {
  interface Window {
    teleprompter?: TeleprompterBridge
  }
}

/** Im Netz gibt es keine Brücke — dann läuft alles über den Server. */
async function rufeUeberNetz<M extends ApiMethod>(
  method: M,
  ...args: ApiParams<M>
): Promise<ApiResult<M>> {
  const antwort = await fetch('/api/remote/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  })
  const body = (await antwort.json()) as { ok: boolean; data?: unknown; error?: string }
  if (!body.ok) throw new Error(body.error ?? 'Der Aufruf ist fehlgeschlagen.')
  return body.data as ApiResult<M>
}

function useView(): { view: PrompterViewState; getrennt: boolean; imFenster: boolean } {
  const [view, setView] = useState<PrompterViewState>(PROMPTER_VORGABE)
  const [getrennt, setGetrennt] = useState(false)
  const imFenster = Boolean(window.teleprompter)

  useEffect(() => {
    const bridge = window.teleprompter
    if (bridge) {
      void bridge.invoke('prompter.view').then(setView)
      return bridge.onViewChange(setView)
    }

    let quelle: EventSource | null = null
    let erneut: number | undefined
    let bekannteKennung: string | null = null

    const verbinde = (): void => {
      quelle = new EventSource('/api/prompter/stream')
      quelle.onmessage = (nachricht) => {
        setGetrennt(false)
        const naechster = JSON.parse(nachricht.data) as PrompterViewState
        /* Nach einem Neustart der Anwendung läuft diese Seite womöglich mit
           altem Programmstand — dann lädt sie sich einmalig selbst neu. */
        if (naechster.serverInstanceId) {
          if (bekannteKennung && bekannteKennung !== naechster.serverInstanceId) {
            window.location.reload()
            return
          }
          bekannteKennung = naechster.serverInstanceId
        }
        setView(naechster)
      }
      quelle.onerror = () => {
        setGetrennt(true)
        quelle?.close()
        erneut = window.setTimeout(verbinde, 3000)
      }
    }
    verbinde()

    return () => {
      if (erneut) window.clearTimeout(erneut)
      quelle?.close()
    }
  }, [])

  return { view, getrennt, imFenster }
}

/** Restzeit als m:ss — dieselbe Darstellung wie auf dem Beamer. */
function restzeit(until: string | undefined, jetzt: number): string | undefined {
  if (!until) return undefined
  const sekunden = Math.max(0, Math.round((Date.parse(until) - jetzt) / 1000))
  return `${Math.floor(sekunden / 60)}:${String(sekunden % 60).padStart(2, '0')}`
}

function Block({ block }: { block: RedeBlock }): React.JSX.Element {
  switch (block.art) {
    case 'ueberschrift':
      return <p className={`tp-ueberschrift ebene-${block.ebene ?? 1}`}>{block.text}</p>
    case 'punkt':
      return (
        <p className="tp-punkt">
          <span aria-hidden="true">•</span> {block.text}
        </p>
      )
    case 'zitat':
      return <p className="tp-zitat">{block.text}</p>
    case 'pause':
      return <p className="tp-pause" aria-hidden="true" />
    default:
      return <p className="tp-absatz">{block.text}</p>
  }
}

function TeleprompterApp(): React.JSX.Element {
  const { view, getrennt, imFenster } = useView()
  const [jetzt, setJetzt] = useState(() => Date.now())
  const flaeche = useRef<HTMLDivElement>(null)
  /* Die gemessene Zeilenhöhe: Alles Rechnen geschieht in Zeilen, gerollt wird
     in Bildpunkten — hier wird umgerechnet, und nur hier. */
  const [zeilenhoehe, setZeilenhoehe] = useState(48)

  /* 20 Bilder je Sekunde reichen für ruhiges Rollen und lassen den Rechner in
     Frieden; der Text bewegt sich langsamer, als das Auge folgt. */
  useEffect(() => {
    const timer = window.setInterval(() => setJetzt(Date.now()), 50)
    return () => window.clearInterval(timer)
  }, [])

  const bloecke = useMemo(() => redeBloecke(view.speech?.markdown ?? ''), [view.speech?.markdown])

  const rufe = useCallback(
    async <M extends ApiMethod,>(method: M, ...args: ApiParams<M>): Promise<void> => {
      try {
        if (window.teleprompter) await window.teleprompter.invoke(method, ...args)
        else await rufeUeberNetz(method, ...args)
      } catch {
        /* Ein Gerät im Netz ohne freigeschaltete Bedienung darf nur zusehen —
           das ist kein Fehler, den jemand am Pult lesen müsste. */
      }
    },
    []
  )

  /* Die Schriftgröße hängt an der Höhe der Fläche, nicht an einer festen
     Punktzahl: Derselbe Text soll auf dem Telefon und auf dem Pultmonitor
     gleich viele Zeilen haben. */
  const schriftGroesse = `${view.schrift}vh`

  useEffect(() => {
    const messen = (): void => {
      const erste = flaeche.current?.querySelector('p')
      if (!erste) return
      const hoehe = Number.parseFloat(getComputedStyle(erste).lineHeight)
      if (Number.isFinite(hoehe) && hoehe > 0) setZeilenhoehe(hoehe)
    }
    messen()
    window.addEventListener('resize', messen)
    return () => window.removeEventListener('resize', messen)
  }, [view.schrift, bloecke.length])

  const stelle = prompterPosition(view, jetzt)
  const versatz = stelle * zeilenhoehe

  useEffect(() => {
    function taste(event: KeyboardEvent): void {
      switch (event.key) {
        case ' ':
        case 'Enter':
          event.preventDefault()
          void rufe('prompter.setRunning', !view.running)
          break
        case 'ArrowDown':
        case 'PageDown':
          event.preventDefault()
          void rufe('prompter.nudge', event.key === 'PageDown' ? 8 : 1)
          break
        case 'ArrowUp':
        case 'PageUp':
          event.preventDefault()
          void rufe('prompter.nudge', event.key === 'PageUp' ? -8 : -1)
          break
        case 'Home':
          event.preventDefault()
          void rufe('prompter.setPosition', 0)
          break
        case '+':
          event.preventDefault()
          void rufe('prompter.setTempo', Math.min(TEMPO_MAX, view.tempo + 10))
          break
        case '-':
          event.preventDefault()
          void rufe('prompter.setTempo', Math.max(TEMPO_MIN, view.tempo - 10))
          break
        case 'm':
        case 'M':
          event.preventDefault()
          void rufe('prompter.setDarstellung', {
            spiegel: { ...view.spiegel, horizontal: !view.spiegel.horizontal }
          })
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [rufe, view.running, view.tempo, view.spiegel])

  const rest = restzeit(view.until, jetzt)

  if (!view.speech) {
    return (
      <div className="tp-leer">
        <h1>Keine Rede auf dem Prompter</h1>
        <p>
          Im Hauptfenster unter <strong>Prompter</strong> eine Rede auswählen und auf
          <strong> Auf den Prompter</strong> schalten. Dieses Fenster folgt dann von selbst.
        </p>
        {getrennt && <p className="tp-getrennt">Verbindung unterbrochen</p>}
      </div>
    )
  }

  const spiegelung = [
    view.spiegel.horizontal ? 'scaleX(-1)' : '',
    view.spiegel.vertikal ? 'scaleY(-1)' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="tp">
      <div
        className="tp-spiegel"
        style={{ transform: spiegelung || undefined, fontSize: schriftGroesse }}
      >
        {/* Die Lesezeile: Wer den Blick hebt, findet die Stelle daran wieder. */}
        <div className="tp-leselinie" style={{ top: `${view.leselinie}%` }} aria-hidden="true" />
        <div
          className="tp-lauf"
          ref={flaeche}
          style={{
            width: `${view.breite}%`,
            /* Waagerecht über die Verschiebung mitten setzen — ein fester
               Rand aus dem Stylesheet passte nur zu einer Breite. */
            transform: `translate(-50%, calc(${view.leselinie}vh - ${versatz}px))`
          }}
        >
          {bloecke.map((block, index) => (
            <Block key={index} block={block} />
          ))}
          {/* Am Ende Luft, damit der letzte Satz die Lesezeile erreicht. */}
          <div style={{ height: '60vh' }} aria-hidden="true" />
        </div>
      </div>

      <div className="tp-leiste">
        <button
          type="button"
          className={view.running ? 'tp-halt' : 'tp-los'}
          onClick={() => void rufe('prompter.setRunning', !view.running)}
        >
          {view.running ? 'Anhalten' : 'Starten'}
        </button>
        <button type="button" onClick={() => void rufe('prompter.nudge', -4)} aria-label="Zurück">
          ▲
        </button>
        <button type="button" onClick={() => void rufe('prompter.nudge', 4)} aria-label="Vor">
          ▼
        </button>
        <label>
          Tempo
          <input
            type="range"
            min={TEMPO_MIN}
            max={TEMPO_MAX}
            step={5}
            value={view.tempo}
            onChange={(event) => void rufe('prompter.setTempo', Number(event.target.value))}
          />
          <span className="tp-wert">{view.tempo}</span>
        </label>
        <label>
          Schrift
          <input
            type="range"
            min={SCHRIFT_MIN}
            max={SCHRIFT_MAX}
            step={0.5}
            value={view.schrift}
            onChange={(event) =>
              void rufe('prompter.setDarstellung', { schrift: Number(event.target.value) })
            }
          />
        </label>
        <button
          type="button"
          className={view.spiegel.horizontal ? 'aktiv' : ''}
          title="Für den Prompterspiegel seitenverkehrt"
          onClick={() =>
            void rufe('prompter.setDarstellung', {
              spiegel: { ...view.spiegel, horizontal: !view.spiegel.horizontal }
            })
          }
        >
          Spiegel
        </button>
        <button
          type="button"
          className={view.spiegel.vertikal ? 'aktiv' : ''}
          title="Wenn das Gerät über Kopf hängt"
          onClick={() =>
            void rufe('prompter.setDarstellung', {
              spiegel: { ...view.spiegel, vertikal: !view.spiegel.vertikal }
            })
          }
        >
          Über Kopf
        </button>
        {view.zeigeUhr && rest && <span className="tp-uhr">{rest}</span>}
        {getrennt && <span className="tp-getrennt">Verbindung unterbrochen</span>}
        {!imFenster && !getrennt && <span className="tp-netz">Netzansicht</span>}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <TeleprompterApp />
  </StrictMode>
)
