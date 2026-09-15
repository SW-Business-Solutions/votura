/**
 * Einstieg der Beameransicht.
 *
 * Zwei Bezugswege, dieselbe Darstellung:
 * - im Electron-Fenster über die rein lesende Preload-Brücke,
 * - im Browser eines anderen Geräts über Server-Sent-Events des lokalen
 *   Projektionsservers.
 * In beiden Fällen kann diese Ansicht ausschließlich lesen.
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { presentationKind, presentationPath, presentationUrl } from '@shared/presentation'
import { videoPath, videoUrl } from '@shared/video'
import { EMPTY_PROJECTION_STATE, HAUPTBUEHNE, type ProjectionState } from '@shared/projection'
import { ProjectionScreen } from './projection/ProjectionScreen'
import './styles/projection.css'

interface AudienceBridge {
  /** Die Bühne dieses Fensters; der Hauptprozess hat sie beim Öffnen gesetzt. */
  buehne: number
  getInitialState(): Promise<ProjectionState>
  onStateChange(callback: (state: ProjectionState) => void): () => void
  /**
   * Die einzige Nachricht, die aus diesem Fenster hinausgeht.
   *
   * Sie sagt etwas über das Fenster aus — Laufzeit, Pufferstand, Ende
   * erreicht —, nicht über die Wahl. In der Netzwerkansicht fehlt die Brücke
   * ganz, deshalb optional.
   */
  reportVideo?(meldung: { durationSeconds?: number; ready?: boolean; ended?: boolean }): void
  /**
   * Dieses Fenster braucht ein Kamerabild — oder keines mehr.
   *
   * Wie `reportVideo` eine Aussage über das Fenster, nicht über die Wahl.
   * In der Netzwerkansicht fehlt die Brücke; dort gibt es kein NDI, und
   * die Kameraansicht sagt das.
   */
  kameraAn?(quelle: string, qualitaet: 'hoch' | 'vorschau'): void
  kameraAus?(): void
}

declare global {
  interface Window {
    projection?: AudienceBridge
  }
}

/**
 * Welche Bühne diese Ansicht zeigt.
 *
 * Im Fenster steht sie in der Adresse, die der Hauptprozess gesetzt hat; im
 * Browser wählt sie das Gerät selbst über `/b/2`. Beide Wege enden in
 * derselben Suchzeile — es gibt nur eine Stelle, an der sie gelesen wird.
 */
function eigeneBuehne(): number {
  const roh = Number(new URLSearchParams(window.location.search).get('buehne'))
  return Number.isInteger(roh) && roh > 0 ? roh : HAUPTBUEHNE
}

function useProjectionState(buehne: number): { state: ProjectionState; disconnected: boolean } {
  const [state, setState] = useState<ProjectionState>(EMPTY_PROJECTION_STATE)
  const [disconnected, setDisconnected] = useState(false)

  useEffect(() => {
    const bridge = window.projection
    if (bridge) {
      void bridge.getInitialState().then(setState)
      return bridge.onStateChange(setState)
    }

    // Netzwerkansicht im Browser.
    const token = new URLSearchParams(window.location.search).get('t')
    const query = `?buehne=${buehne}${token ? `&t=${encodeURIComponent(token)}` : ''}`
    let source: EventSource | null = null
    let retry: number | undefined
    let knownInstance: string | null = null

    const connect = (): void => {
      source = new EventSource(`/api/projection/stream${query}`)
      source.onmessage = (message) => {
        setDisconnected(false)
        const next = JSON.parse(message.data) as ProjectionState
        // Wurde die Anwendung neu gestartet, läuft diese Seite womöglich mit
        // altem Programmstand – dann lädt sie sich einmalig selbst neu.
        if (next.serverInstanceId) {
          if (knownInstance && knownInstance !== next.serverInstanceId) {
            window.location.reload()
            return
          }
          knownInstance = next.serverInstanceId
        }
        setState(next)
      }
      source.onerror = () => {
        setDisconnected(true)
        source?.close()
        // Ruhig und langsam erneut versuchen – der Beamer darf nicht flackern.
        retry = window.setTimeout(connect, 3000)
      }
    }
    connect()

    return () => {
      if (retry) window.clearTimeout(retry)
      source?.close()
    }
  }, [buehne])

  return { state, disconnected }
}

function AudienceApp(): React.JSX.Element {
  const buehne = eigeneBuehne()

  /* Zwei gleich benannte Fenster in der Taskleiste sind nicht zu
     unterscheiden — der Fenstertitel der Anwendung wird vom Titel dieser
     Seite überschrieben, also steht die Bühne hier. */
  useEffect(() => {
    if (buehne !== HAUPTBUEHNE) document.title = `Votura – Beameransicht ${buehne}`
  }, [buehne])

  const { state, disconnected } = useProjectionState(buehne)

  // Automatischer Seitenwechsel bei langen Kandidatenlisten (Beamer §8).
  const [page, setPage] = useState(0)
  useEffect(() => setPage(state.candidatePage), [state.candidatePage, state.round?.id, state.mode])
  useEffect(() => {
    /*
     * Die Sperre hält auch das Blättern an.
     *
     * Sie heißt „kein automatisches Umschalten" — und für den Saal ist es
     * dasselbe, ob die Ansicht wechselt oder die Seite darin. Wer während der
     * Auszählung auf eine bestimmte Seite zeigt, will nicht, dass sie nach
     * acht Sekunden weiterspringt.
     */
    if (state.locked) return
    if (state.candidatePageCount <= 1 || state.candidatePageIntervalSeconds <= 0) return
    const timer = window.setInterval(
      () => setPage((current) => (current + 1) % state.candidatePageCount),
      state.candidatePageIntervalSeconds * 1000
    )
    return () => window.clearInterval(timer)
  }, [state.candidatePageCount, state.candidatePageIntervalSeconds, state.locked])

  /*
   * Zwei Wege zur selben Datei.
   *
   * Im Fenster gibt es keinen Server, also liefert ein eigenes Schema sie
   * aus; im Browser eines anderen Geräts derselbe Server, der auch diese
   * Seite ausgeliefert hat. Erkennbar ist der Weg an der Preload-Brücke: Wo
   * sie fehlt, läuft die Ansicht im Netz.
   */
  const imFenster = Boolean(window.projection)
  const presentationSrc = state.presentation
    ? imFenster
      ? presentationUrl(state.presentation.id, presentationKind(state.presentation))
      : presentationPath(state.presentation.id, presentationKind(state.presentation), buehne)
    : undefined

  const videoSrc = state.video
    ? imFenster
      ? videoUrl(state.video.id)
      : videoPath(state.video.id, buehne)
    : undefined

  /*
   * Den Ton hat nur das Beamerfenster.
   *
   * Ein Saal, in dem zehn Tablets denselben Film im Chor tönen, ist
   * unerträglich — und schon Millisekunden Versatz klingen wie ein Echo. Die
   * Netzwerkansicht läuft deshalb stumm mit, unabhängig davon, was in der
   * Bedienung eingestellt ist.
   */
  const melde = (meldung: { durationSeconds?: number; ready?: boolean; ended?: boolean }): void => {
    window.projection?.reportVideo?.(meldung)
  }

  return (
    <ProjectionScreen
      state={{ ...state, candidatePage: page }}
      disconnected={disconnected}
      presentationSrc={presentationSrc}
      videoSrc={videoSrc}
      videoAudio={imFenster}
      onVideoDuration={(sekunden) => melde({ durationSeconds: sekunden })}
      onVideoReady={() => melde({ ready: true })}
      onVideoEnded={() => melde({ ended: true })}
    />
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AudienceApp />
  </StrictMode>
)
