/** Systemcheck vor Veranstaltungsbeginn (§65). */
import { useEffect, useState } from 'react'
import type { PreflightItem } from '@shared/types'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card } from '../components/ui'

export function PreflightPage(): React.JSX.Element {
  const app = useApp()
  const [items, setItems] = useState<PreflightItem[]>([])
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      setItems(await api('system.preflight'))
    } catch (error) {
      app.reportError(error)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void run()
  }, [])

  const failures = items.filter((item) => item.status === 'fail').length
  const warnings = items.filter((item) => item.status === 'warn').length

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Systemcheck</h1>
          <div className="subtitle">Vor Veranstaltungsbeginn durchführen.</div>
        </div>
        <button className="primary" disabled={busy} onClick={() => void run()}>
          {busy ? 'Wird geprüft …' : 'Erneut prüfen'}
        </button>
      </div>

      <div
        className={`notice ${failures > 0 ? 'error' : warnings > 0 ? 'warn' : 'ok'}`}
      >
        {failures > 0
          ? `${failures} Punkt(e) müssen behoben werden.`
          : warnings > 0
            ? `${warnings} Hinweis(e) – bitte prüfen.`
            : 'Alle Prüfpunkte in Ordnung.'}
      </div>

      <Card>
        <table>
          <tbody>
            {items.map((item) => (
              <tr key={item.key}>
                <td style={{ width: 120 }}>
                  <span
                    className={`badge ${item.status === 'ok' ? 'ok' : item.status === 'warn' ? 'warn' : item.status === 'fail' ? 'danger' : ''}`}
                  >
                    {item.status === 'ok' ? 'in Ordnung' : item.status === 'warn' ? 'Hinweis' : item.status === 'fail' ? 'Fehler' : 'unbekannt'}
                  </span>
                </td>
                <td>
                  <strong>{item.label}</strong>
                  <div className="hint">{item.detail}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Organisatorische Checkliste">
        <ul>
          <li>Papierrollen in ausreichender Menge bereitlegen, Cutter testen.</li>
          <li>Ersatzdrucker und Ersatzrechner betriebsbereit halten.</li>
          <li>Zwei USB-Sticks für wechselnde Backups bereitlegen.</li>
          <li>Stromversorgung sichern (USV oder Akkubetrieb).</li>
          <li>Geltende Wahlordnung der Gliederung prüfen und in der Veranstaltung hinterlegen.</li>
          <li>Testdruck durchführen und sichtbar als ungültig entsorgen.</li>
        </ul>
      </Card>
    </>
  )
}
