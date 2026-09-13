/**
 * Die Netzwerkansicht einrichten.
 *
 * Bewusst in den Einstellungen und nicht in der Beamersteuerung: Port, Token
 * und Freigaben stellt man einmal ein, bevor die Versammlung beginnt. Während
 * der Versammlung braucht man die Adresse zum Ablesen — die steht weiterhin
 * unter Beamer → Ausgabe & Netz.
 */
import { useEffect, useState } from 'react'
import type { NetworkProjectionStatus } from '@shared/ipc'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card, Checkbox, Field, NumberInput } from '../components/ui'

export function NetzwerkEinstellungen(): React.JSX.Element {
  const app = useApp()
  const [status, setStatus] = useState<NetworkProjectionStatus | null>(null)

  useEffect(() => {
    void api('projection.network').then(setStatus).catch(app.reportError)
  }, [])

  if (!status) return <Card title="Beamer im Netzwerk">Wird geladen …</Card>
  return (
    <Card title="Beamer im Netzwerk">
      <NetworkSection status={status} onChange={setStatus} />
    </Card>
  )
}

function NetworkSection({
  status,
  onChange
}: {
  status: NetworkProjectionStatus
  onChange: (status: NetworkProjectionStatus) => void
}): React.JSX.Element {
  const app = useApp()
  const [enabled, setEnabled] = useState(status.enabled)
  const [port, setPort] = useState(status.port)
  const [token, setToken] = useState(status.token)
  const [lanWide, setLanWide] = useState(status.bindAddress !== '127.0.0.1')
  const [allowRemoteOperator, setAllowRemoteOperator] = useState(status.allowRemoteOperator)
  const [allowPrompterControl, setAllowPrompterControl] = useState(status.allowPrompterControl)

  const save = async (): Promise<void> => {
    try {
      const next = await api('projection.setNetwork', {
        enabled,
        port,
        bindAddress: lanWide ? '0.0.0.0' : '127.0.0.1',
        token,
        allowRemoteOperator,
        allowPrompterControl
      })
      onChange(next)
      app.notify(next.running ? 'ok' : 'info', next.running ? 'Netzwerkansicht läuft.' : 'Netzwerkansicht deaktiviert.')
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <>
      <p className="hint">
        Zeigt dieselbe Beameransicht im Browser eines anderen Geräts im Veranstaltungsnetz an – ausschließlich
        lesend, ohne Bedienelemente. Standardmäßig deaktiviert; nur in einem abgeschotteten lokalen Netz
        verwenden.
      </p>
      <Checkbox checked={enabled} onChange={setEnabled} label="Netzwerkansicht aktivieren" />
      <div className="row">
        <div style={{ width: 140 }}>
          <Field label="Port">
            <NumberInput value={port} min={1024} max={65535} onChange={setPort} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Zugriffstoken" hint="Leer = ohne Token (nur in vollständig abgeschotteten Netzen).">
            <input value={token} onChange={(e) => setToken(e.target.value)} />
          </Field>
        </div>
      </div>
      <Checkbox
        checked={lanWide}
        onChange={setLanWide}
        label="Im gesamten lokalen Netz erreichbar (sonst nur auf diesem Rechner)"
      />

      <h3>Bedienung von einem zweiten Gerät</h3>
      <p className="hint">
        Zusätzlich zur Beameransicht kann die vollständige Bedienoberfläche im Browser eines anderen Geräts
        geöffnet werden — unter der Adresse mit dem Zusatz <span className="mono">/operator</span>. Dort ist eine
        Anmeldung mit einem lokalen Konto nötig; es gelten dieselben Rollen und Rechte, und jede Aktion landet
        mit dem jeweiligen Benutzer im Audit-Trail. Systemdialoge (Ordnerwahl, Backup-Ziel) bleiben dem
        Hauptrechner vorbehalten.
      </p>
      <Checkbox
        checked={allowRemoteOperator}
        onChange={setAllowRemoteOperator}
        label="Anmeldung und Bedienung über das Netz erlauben"
      />
      {allowRemoteOperator && (
        <div className="notice warn">
          Nur in einem abgeschotteten Veranstaltungsnetz verwenden. Die Verbindung ist unverschlüsselt (HTTP);
          über ein fremdes oder offenes WLAN darf sie nicht laufen.
        </div>
      )}

      <h3>Bedienung der Prompteransicht</h3>
      <p className="hint">
        Die Prompteransicht (<span className="mono">/prompter</span>) zeigt normalerweise nur an. Wer am
        Pult steht, hat aber oft ein Tablet vor sich und niemanden am Board — dann muss eine
        Verhaspelung dort zu beheben sein. Freigegeben wird ausschließlich das eigene Manuskript:
        anhalten, weiterlaufen, eine Stelle zurück, Tempo, Schriftgröße, Umschalten auf die Folien.
        An Wahldaten kommt diese Freigabe nicht heran.
      </p>
      <Checkbox
        checked={allowPrompterControl}
        onChange={setAllowPrompterControl}
        label="Bedienung am Pult über das Netz erlauben"
      />

      <h3>Bedienung der Prompteransicht</h3>
      <p className="hint">
        Die Prompteransicht (<span className="mono">/prompter</span>) zeigt normalerweise nur an. Wer am
        Pult steht, hat aber oft ein Tablet vor sich und niemanden am Board — dann muss eine Verhaspelung
        dort zu beheben sein. Freigegeben wird ausschließlich das eigene Manuskript: anhalten,
        weiterlaufen, eine Stelle zurück, Tempo, Schriftgröße, Umschalten auf die Folien. An Wahldaten
        kommt diese Freigabe nicht heran; eine Anmeldung braucht sie deshalb auch nicht.
      </p>
      <Checkbox
        checked={allowPrompterControl}
        onChange={setAllowPrompterControl}
        label="Bedienung am Pult über das Netz erlauben"
      />

      <div className="row">
        <button className="primary" onClick={() => void save()}>
          Übernehmen
        </button>
        <button
          onClick={() => setToken(Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6))}
        >
          Token erzeugen
        </button>
      </div>
      {status.running && status.urls.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <label>Beameransicht</label>
          {status.urls.map((url) => (
            <div key={url} className="mono">
              {url}
            </div>
          ))}
          {/*
            * Eine Adresse je Bühne.
            *
            * Ein Gerät im Saal wählt seine Bühne über die Adresse — `/b/2`
            * neben dem zweiten Beamer, und es zeigt bis zum Schluss genau
            * das, was dort hingehört.
            */}
          {app.buehnen.length > 1 && (
            <>
              <label style={{ marginTop: 10 }}>Einzelne Bühnen</label>
              {app.buehnen.map((stage) => (
                <div key={`b-${stage.id}`} className="mono">
                  {status.urls[0].split('?')[0].replace(/\/$/, '')}/b/{stage.id}
                  {status.token ? `?t=${status.token}` : ''} — {stage.name}
                </div>
              ))}
            </>
          )}
          {status.allowRemoteOperator && (
            <>
              <label style={{ marginTop: 10 }}>Bedienung (Anmeldung erforderlich)</label>
              {status.urls.map((url) => (
                <div key={`op-${url}`} className="mono">
                  {url.split('?')[0].replace(/\/$/, '')}/operator
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {status.error && <div className="notice error">{status.error}</div>}
    </>
  )
}
