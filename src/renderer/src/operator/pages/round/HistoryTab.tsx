/** Verlauf des Wahlgangs: Statussteuerung und Audit-Einträge (§28, §73). */
import { useEffect, useState } from 'react'
import { canTransition } from '@shared/election'
import { formatDateTimeDe } from '@shared/format'
import { ROUND_STATUS_LABELS, type AuditEntry, type RoundStatus } from '@shared/types'
import { api } from '../../../lib/api'
import { useApp } from '../../state'
import { Card } from '../../components/ui'
import type { TabProps } from '../RoundDetailPage'

const FLOW: { status: RoundStatus; label: string; hint: string }[] = [
  { status: 'open', label: 'Wahlgang eröffnen', hint: 'Stimmabgabe beginnt; der Beamer zeigt „Wahl läuft“.' },
  { status: 'counting', label: 'Stimmabgabe beenden / auszählen', hint: 'Der Beamer zeigt die Auszählung.' }
]

export function HistoryTab({ detail }: Pick<TabProps, 'detail'>): React.JSX.Element {
  const app = useApp()
  const round = detail.round
  const [entries, setEntries] = useState<AuditEntry[]>([])

  useEffect(() => {
    void api('audit.list', { roundId: round.id, limit: 500 }).then(setEntries).catch(app.reportError)
  }, [round.id, round.status])

  const setStatus = async (status: RoundStatus): Promise<void> => {
    try {
      await api('round.setStatus', { roundId: round.id, status })
      app.notify('ok', `Status: ${ROUND_STATUS_LABELS[status]}`)
      await app.refreshRounds()
      setEntries(await api('audit.list', { roundId: round.id, limit: 500 }))
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <div className="grid cols-2">
      <div>
        <Card title="Ablaufsteuerung">
          <p className="hint">
            Aktueller Status: <strong>{ROUND_STATUS_LABELS[round.status]}</strong>
          </p>
          {FLOW.map((step) => (
            <div key={step.status} className="row" style={{ marginBottom: 10 }}>
              <button
                className="big"
                disabled={!canTransition(round.status, step.status)}
                onClick={() => void setStatus(step.status)}
              >
                {step.label}
              </button>
              <span className="hint">{step.hint}</span>
            </div>
          ))}
          <div className="notice">
            Die Beameransicht folgt diesen Schritten automatisch. Ergebnisse erscheinen dort erst nach
            ausdrücklicher Bestätigung.
          </div>
        </Card>

        <Card title="Kenndaten">
          <table>
            <tbody>
              <tr>
                <th>Angelegt</th>
                <td>{formatDateTimeDe(round.createdAt)}</td>
              </tr>
              <tr>
                <th>Kandidatenliste geschlossen</th>
                <td>{round.candidatesLockedAt ? formatDateTimeDe(round.candidatesLockedAt) : '–'}</td>
              </tr>
              <tr>
                <th>Abgeschlossen</th>
                <td>{round.completedAt ? formatDateTimeDe(round.completedAt) : '–'}</td>
              </tr>
              <tr>
                <th>Wahlzettelversion</th>
                <td>
                  v{round.ballotVersion}
                  {round.approvedVersion !== undefined ? ` (freigegeben: v${round.approvedVersion})` : ''}
                </td>
              </tr>
              {round.parentRoundId && (
                <tr>
                  <th>Abgeleitet aus</th>
                  <td>{round.derivedAs}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title={`Audit-Trail (${entries.length})`}>
        <div className="scroll-box" style={{ maxHeight: 620 }}>
          <table>
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Aktion</th>
                <th>Benutzer</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTimeDe(entry.timestamp)}</td>
                  <td>
                    {entry.action}
                    {entry.reason && <div className="hint">{entry.reason}</div>}
                  </td>
                  <td>{entry.userName ?? 'System'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
