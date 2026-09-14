/**
 * Backup: Ziele, Rhythmus, Wiederherstellung.
 *
 * Die eine Einstellung, die niemand braucht — bis sie alles ist, was noch
 * hilft. Deshalb steht sie für sich und nicht am Ende einer langen Seite.
 */
import { useEffect, useState } from 'react'
import type { AppConfig } from '@shared/types'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card, Field } from '../components/ui'

export function BackupEinstellungen(): React.JSX.Element {
  const app = useApp()
  const [config, setConfig] = useState<AppConfig>(app.settings!.config)
  const [busy, setBusy] = useState(false)

  // Fortschritt des Einspielens; der Hauptprozess meldet jede Stufe.

  /** Änderung übernehmen und sofort festschreiben. */
  useEffect(() => setConfig(app.settings!.config), [app.settings])

  const chooseDirectory = async (key: 'directory' | 'secondaryDirectory'): Promise<void> => {
    const path = await api('system.chooseDirectory', 'Backup-Verzeichnis wählen')
    if (!path) return
    const next = { ...config, backup: { ...config.backup, [key]: path } }
    setConfig(next)
    await api('system.saveConfig', next)
    await app.refreshSettings()
  }

  return (
    <div className="grid cols-2">
      <Card title="Backup-Ziele">
        <Field label="Hauptverzeichnis">
          <div className="row">
            <input value={config.backup.directory} readOnly />
            <button onClick={() => void chooseDirectory('directory')}>Wählen</button>
          </div>
        </Field>
        <Field label="Zweitkopie (z. B. USB-Stick)">
          <div className="row">
            <input value={config.backup.secondaryDirectory ?? ''} readOnly />
            <button onClick={() => void chooseDirectory('secondaryDirectory')}>Wählen</button>
          </div>
        </Field>
        <div className="notice">
          Ein Backup enthält eine konsistente Kopie der Datenbank, die Konfiguration, den Audit-Export und die
          erzeugten Druck-/Exportdateien. Es wird nichts in eine Cloud übertragen.
        </div>
        <button
          className="primary big"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const result = await api('backup.create')
              app.notify('ok', `Backup erstellt: ${result.path} (${Math.round(result.sizeBytes / 1024)} kB)`)
            } catch (error) {
              app.reportError(error)
            } finally {
              setBusy(false)
            }
          }}
        >
          Backup jetzt erstellen
        </button>
      </Card>

      <Card title="Datenbank">
        <p className="hint">Speicherort der Datenbank:</p>
        <div className="mono">{app.setup?.databasePath}</div>
        <div className="notice mt-3">
          Für den Betrieb vor Ort empfiehlt sich ein Ersatzrechner, auf dem ein Backup eingespielt werden
          kann, sowie zwei USB-Sticks für wechselnde Sicherungen.
        </div>
      </Card>
    </div>
  )
}
