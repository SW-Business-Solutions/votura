/** Audit-Trail mit Kettenprüfung (§28, §60). */
import { useEffect, useState } from 'react'
import { formatDateTimeDe } from '@shared/format'
import type { AuditChainCheck, AuditEntry } from '@shared/types'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card } from '../components/ui'
import { auditActionLabel } from '@shared/audit-labels'

export function AuditPage(): React.JSX.Element {
  const app = useApp()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [check, setCheck] = useState<AuditChainCheck | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    void api('audit.list', { eventId: app.event?.id, limit: 2000 }).then(setEntries).catch(app.reportError)
  }, [app.event?.id])

  const visible = entries.filter(
    (entry) =>
      !filter ||
      entry.action.toLowerCase().includes(filter.toLowerCase()) ||
      auditActionLabel(entry.action).toLowerCase().includes(filter.toLowerCase()) ||
      (entry.userName ?? '').toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Audit-Trail</h1>
          <div className="subtitle">
            Fortlaufend, unveränderbar und per Hash verkettet. Einträge werden nie gelöscht.
          </div>
        </div>
        <div className="row">
          <input placeholder="Filtern …" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button
            onClick={async () => {
              try {
                setCheck(await api('audit.verify'))
              } catch (error) {
                app.reportError(error)
              }
            }}
          >
            Kette prüfen
          </button>
        </div>
      </div>

      {check && (
        <div className={`notice ${check.ok ? 'ok' : 'error'}`}>
          {check.message}
          {!check.ok && ' Bitte die Wahlleitung informieren und den Vorgang dokumentieren.'}
        </div>
      )}

      <Card title={`${visible.length} Einträge`}>
        <div className="scroll-box" style={{ maxHeight: '62vh' }}>
          <table>
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Zeit</th>
                <th>Aktion</th>
                <th>Benutzer</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.id}>
                  <td className="num">{entry.seq}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTimeDe(entry.timestamp)}</td>
                  <td>
                    {auditActionLabel(entry.action)}
                    {/* Der technische Schlüssel bleibt sichtbar: Er ist die
                        eindeutige Bezeichnung im Export und in Rückfragen. */}
                    <div className="hint mono">{entry.action}</div>
                  </td>
                  <td>{entry.userName ?? 'System'}</td>
                  <td>
                    {entry.reason && <div>{entry.reason}</div>}
                    {entry.newValue !== undefined && entry.newValue !== null && (
                      <details>
                        <summary className="hint">Werte</summary>
                        <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
                          {JSON.stringify(entry.newValue, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
