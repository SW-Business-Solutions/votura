/**
 * Das Sprachmodell für das Mitlaufen nach Gehör.
 *
 * Eines liegt bei; wer mehr braucht — starker Dialekt, halliger Saal —, legt
 * ein größeres darüber. Beides steht hier, weil es dieselbe Frage ist: Womit
 * hört der Prompter zu?
 */
import { useEffect, useState } from 'react'
import type { SprachmodellInfo } from '@shared/sprachmodell'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card } from '../components/ui'

function megabyte(bytes?: number): string {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(0)} MB` : '–'
}

export function SprachmodellEinstellungen(): React.JSX.Element {
  const app = useApp()
  const [modell, setModell] = useState<SprachmodellInfo | null>(null)

  useEffect(() => {
    void api('speechmodel.info').then(setModell).catch(app.reportError)
  }, [])

  const rufe = async (tun: () => Promise<SprachmodellInfo>): Promise<void> => {
    try {
      setModell(await tun())
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <Card title="Sprachmodell für den Prompter">
      <p className="hint">
        Auf Wunsch läuft der Redetext am Pult nicht gleichmäßig, sondern hört mit und folgt dem
        Gesprochenen. Dafür braucht es ein Sprachmodell. Es arbeitet vollständig auf dem Gerät:
        Aufgenommen wird nichts, und nichts verlässt den Rechner.
      </p>

      {!modell ? (
        <p className="hint">Wird geladen …</p>
      ) : modell.vorhanden ? (
        <>
          <div className="mono">{modell.name}</div>
          <div className="hint">
            {megabyte(modell.bytes)} ·{' '}
            {modell.herkunft === 'paket' ? 'mit der Anwendung geliefert' : 'selbst hinterlegt'}
          </div>
        </>
      ) : (
        <div className="notice warn">
          Kein Sprachmodell hinterlegt. „Nach Stimme" bleibt am Pult ohne Wirkung; der Text läuft
          dann gleichmäßig oder wird von Hand bewegt.
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={() => void rufe(() => api('speechmodel.install'))}>
          Eigenes Modell hinterlegen …
        </button>
        {modell?.herkunft === 'eigen' && (
          <button className="danger" onClick={() => void rufe(() => api('speechmodel.remove'))}>
            Eigenes Modell entfernen
          </button>
        )}
      </div>
      <div className="hint">
        Erwartet wird ein Modellarchiv (.zip oder .tar.gz), etwa von{' '}
        <span className="mono">alphacephei.com/vosk/models</span>. Ein größeres Modell erkennt
        besser und braucht mehr Zeit zum Laden; für das bloße Mitlaufen im bekannten Text genügt
        das kleine.
      </div>
    </Card>
  )
}
