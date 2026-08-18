/**
 * Wiederanlauf nach Absturz (§34/§35).
 * Unklare Druckaufträge werden nie automatisch wiederholt — die tatsächlich
 * ausgegebene Menge wird vom Bediener physisch geprüft und eingetragen.
 */
import { useEffect, useState } from 'react'
import type { PrintBatch, RecoveryState } from '@shared/types'
import { formatDateTimeDe } from '@shared/format'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Field, Modal, NumberInput } from '../components/ui'

export function RecoveryDialog(): React.JSX.Element | null {
  const app = useApp()
  const [state, setState] = useState<RecoveryState | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})

  useEffect(() => {
    void api('system.recoveryState')
      .then((result) => {
        setState(result)
        setCounts(Object.fromEntries(result.unclearBatches.map((batch) => [batch.id, batch.submittedCopies])))
      })
      .catch(app.reportError)
  }, [app.reportError])

  if (!state || dismissed || state.unclearBatches.length === 0) return null

  const acknowledge = async (batch: PrintBatch): Promise<void> => {
    try {
      await api('system.acknowledgeBatch', {
        batchId: batch.id,
        confirmedCopies: counts[batch.id] ?? batch.submittedCopies,
        note: notes[batch.id]
      })
      const next = await api('system.recoveryState')
      setState(next)
      await app.refreshRounds()
      app.notify('ok', 'Die geprüfte Menge wurde dokumentiert.')
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <Modal
      title="Druckauftrag mit unklarem Status"
      onClose={() => setDismissed(true)}
      wide
      actions={<button onClick={() => setDismissed(true)}>Später prüfen</button>}
    >
      <div className="notice warn">
        Ein Druckauftrag wurde nicht sauber beendet. Es wird bewusst nichts automatisch nachgedruckt.
        Bitte zählen Sie die tatsächlich ausgegebenen Stimmzettel physisch und tragen Sie die Anzahl ein.
      </div>

      {state.unclearBatches.map((batch) => (
        <div key={batch.id} className="card tight">
          <div className="row">
            <strong>{batch.printerName}</strong>
            <span className="badge warn">{batch.status}</span>
            <span className="spacer" />
            <span className="hint">{formatDateTimeDe(batch.startedAt)}</span>
          </div>
          <table>
            <tbody>
              <tr>
                <th>Angefordert</th>
                <td className="num">{batch.requestedCopies}</td>
              </tr>
              <tr>
                <th>An den Drucker übermittelt</th>
                <td className="num">{batch.submittedCopies}</td>
              </tr>
            </tbody>
          </table>
          {batch.errorMessage && <div className="hint">{batch.errorMessage}</div>}
          <Field label="Physisch gezählte, verwendbare Stimmzettel">
            <NumberInput
              value={counts[batch.id] ?? batch.submittedCopies}
              min={0}
              max={batch.requestedCopies}
              onChange={(value) => setCounts((current) => ({ ...current, [batch.id]: value }))}
            />
          </Field>
          <Field label="Bemerkung (optional)">
            <input
              value={notes[batch.id] ?? ''}
              onChange={(inputEvent) =>
                setNotes((current) => ({ ...current, [batch.id]: inputEvent.target.value }))
              }
            />
          </Field>
          <button className="primary" onClick={() => void acknowledge(batch)}>
            Menge bestätigen
          </button>
        </div>
      ))}
    </Modal>
  )
}
