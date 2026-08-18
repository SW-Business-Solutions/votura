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
import { EMPTY_PROJECTION_STATE, type ProjectionState } from '@shared/projection'
import { ProjectionScreen } from './projection/ProjectionScreen'
import './styles/projection.css'

interface AudienceBridge {
  getInitialState(): Promise<ProjectionState>
  onStateChange(callback: (state: ProjectionState) => void): () => void
}

declare global {
  interface Window {
    projection?: AudienceBridge
  }
}

function useProjectionState(): { state: ProjectionState; disconnected: boolean } {
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
    const query = token ? `?t=${encodeURIComponent(token)}` : ''
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
  }, [])

  return { state, disconnected }
}

function AudienceApp(): React.JSX.Element {
  const { state, disconnected } = useProjectionState()

  // Automatischer Seitenwechsel bei langen Kandidatenlisten (Beamer §8).
  const [page, setPage] = useState(0)
  useEffect(() => setPage(state.candidatePage), [state.candidatePage, state.round?.id, state.mode])
  useEffect(() => {
    if (state.candidatePageCount <= 1 || state.candidatePageIntervalSeconds <= 0) return
    const timer = window.setInterval(
      () => setPage((current) => (current + 1) % state.candidatePageCount),
      state.candidatePageIntervalSeconds * 1000
    )
    return () => window.clearInterval(timer)
  }, [state.candidatePageCount, state.candidatePageIntervalSeconds])

  return <ProjectionScreen state={{ ...state, candidatePage: page }} disconnected={disconnected} />
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AudienceApp />
  </StrictMode>
)
