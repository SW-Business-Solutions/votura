/**
 * Beamer-Steuerung (Beamer §23–§26, §33–§36, §81).
 * Die Wahlleitung sieht jederzeit, was öffentlich angezeigt wird.
 */
import { useEffect, useState } from 'react'
import type { NetworkProjectionStatus } from '@shared/ipc'
import { PROJECTION_MODE_LABELS, type ProjectionHistoryEntry, type ProjectionMode } from '@shared/projection'
import { formatTimeDe } from '@shared/format'
import { api } from '../../lib/api'
import { ProjectionScreen } from '../../projection/ProjectionScreen'
import { useApp } from '../state'
import { Card, Checkbox, Field, NumberInput } from '../components/ui'

const MODE_BUTTONS: { mode: ProjectionMode; label: string; needsRound?: boolean }[] = [
  { mode: 'welcome', label: 'Willkommen' },
  { mode: 'upcoming_round', label: 'Nächster Wahlgang', needsRound: true },
  { mode: 'candidate_presentation', label: 'Kandidaten anzeigen', needsRound: true },
  { mode: 'round_ready', label: 'Wahlgang bereit', needsRound: true },
  { mode: 'round_open', label: 'Wahl eröffnet', needsRound: true },
  { mode: 'round_closed', label: 'Wahl beendet', needsRound: true },
  { mode: 'counting', label: 'Auszählung', needsRound: true },
  { mode: 'result', label: 'Ergebnis anzeigen', needsRound: true },
  { mode: 'runoff_announced', label: 'Stichwahl ankuendigen', needsRound: true },
  { mode: 'agenda', label: 'Tagesordnung (gesamt)' },
  { mode: 'break', label: 'Pause' },
  { mode: 'session_finished', label: 'Versammlung beendet' }
]

export function BeamerPage(): React.JSX.Element {
  const app = useApp()
  const projection = app.projection
  const audience = app.audience

  const [roundId, setRoundId] = useState<string>(projection.round?.id ?? '')
  const [messageTitle, setMessageTitle] = useState('')
  const [messageBody, setMessageBody] = useState('')
  const [agenda, setAgenda] = useState({ top: '', current: '', next: '' })
  const [history, setHistory] = useState<ProjectionHistoryEntry[]>([])
  const [network, setNetwork] = useState<NetworkProjectionStatus | null>(null)
  // Vorgabe: vollständiges Ergebnis inklusive der nicht gewählten Bewerber.
  const [showAll, setShowAll] = useState(true)
  const [showRoundContext, setShowRoundContext] = useState(false)
  const [breakMinutes, setBreakMinutes] = useState(10)
  const [breakNote, setBreakNote] = useState('')

  useEffect(() => {
    void api('projection.history').then(setHistory).catch(app.reportError)
    void api('projection.network').then(setNetwork).catch(app.reportError)
  }, [projection.updatedAt])

  useEffect(() => {
    if (projection.round?.id) setRoundId(projection.round.id)
  }, [projection.round?.id])

  const setMode = async (mode: ProjectionMode, extra?: Record<string, unknown>): Promise<void> => {
    try {
      await api('projection.setMode', {
        mode,
        roundId: roundId || undefined,
        showAll,
        ...(extra ?? {})
      })
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Beamer</h1>
          <div className="subtitle">
            Öffentliche Anzeige – read-only. Ergebnisse erscheinen erst nach ausdrücklicher Bestätigung.
          </div>
        </div>
        <div className="row">
          <span className={`badge ${audience?.open ? 'ok' : 'warn'}`}>
            {audience?.open ? 'Beamerfenster aktiv' : 'Beamerfenster nicht aktiv'}
          </span>
          <span className="badge accent">{PROJECTION_MODE_LABELS[projection.mode]}</span>
        </div>
      </div>

      <div className="grid cols-2">
        <div>
          <Card title="Aktuelle Anzeige">
            <div className="preview-frame">
              <ProjectionScreen state={projection} preview />
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <Checkbox
                checked={projection.locked}
                onChange={(value) => void api('projection.setLocked', value).catch(app.reportError)}
                label="Beamer sperren (kein automatisches Umschalten während laufender Wahl)"
              />
            </div>
            {projection.candidatePageCount > 1 && (
              <div className="row">
                <span className="hint">
                  Seite {projection.candidatePage + 1} von {projection.candidatePageCount}
                </span>
                <button
                  onClick={() =>
                    void api('projection.setCandidatePage', Math.max(0, projection.candidatePage - 1)).catch(
                      app.reportError
                    )
                  }
                >
                  Zurück
                </button>
                <button
                  onClick={() =>
                    void api('projection.setCandidatePage', projection.candidatePage + 1).catch(app.reportError)
                  }
                >
                  Weiter
                </button>
              </div>
            )}
          </Card>

          <Card title="Anzeige steuern">
            <Field label="Bezugswahlgang">
              <select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
                <option value="">– keiner –</option>
                {app.rounds.map((round) => (
                  <option key={round.id} value={round.id}>
                    {round.roundLabel} – {round.title}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid cols-2">
              {MODE_BUTTONS.map((entry) => (
                <button
                  key={entry.mode}
                  className={
                    projection.mode === entry.mode &&
                    (entry.mode !== 'agenda' || projection.agenda?.view === 'full')
                      ? 'primary'
                      : ''
                  }
                  disabled={entry.needsRound && !roundId}
                  onClick={() =>
                    void setMode(entry.mode, entry.mode === 'agenda' ? { agendaView: 'full' } : undefined)
                  }
                >
                  {entry.label}
                </button>
              ))}
              <button
                className={
                  projection.mode === 'agenda' && projection.agenda?.view === 'focus' ? 'primary' : ''
                }
                onClick={() => void setMode('agenda', { agendaView: 'focus' })}
              >
                Tagesordnung (aktueller Punkt)
              </button>
            </div>
            <Checkbox
              checked={showAll}
              onChange={(value) => {
                setShowAll(value)
                if (projection.mode === 'result') void setMode('result', { showAll: value })
              }}
              label="Vollständiges Ergebnis anzeigen – auch nicht gewählte Bewerber mit Stimmenzahl"
            />
          </Card>
        </div>

        <div>
          <Card title="Ausgabegerät">
            {audience?.singleDisplay && (
              <div className="notice warn">
                Es ist nur ein Bildschirm erkannt. Das Beamerfenster oeffnet dann im Fenstermodus, damit Sie
                weiterarbeiten können.
              </div>
            )}
            <div className="row">
              {(audience?.displays ?? []).map((display) => (
                <button
                  key={display.id}
                  className={display.current ? 'primary' : ''}
                  onClick={() => void api('projection.openAudience', display.id).catch(app.reportError)}
                >
                  {display.label}
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" onClick={() => void api('projection.openAudience').catch(app.reportError)}>
                Beamerfenster öffnen
              </button>
              <button onClick={() => void api('projection.closeAudience').catch(app.reportError)}>
                Schließen
              </button>
              <button
                onClick={async () => {
                  await api('projection.demo', true).catch(app.reportError)
                  app.notify('info', 'Demomodus aktiv – Testdaten für die Beamerpruefung.')
                }}
              >
                Demomodus
              </button>
            </div>
          </Card>

          <Card title="Freie Mitteilung">
            <Field label="Titel">
              <input value={messageTitle} onChange={(e) => setMessageTitle(e.target.value)} />
            </Field>
            <Field label="Text (optional)">
              <input value={messageBody} onChange={(e) => setMessageBody(e.target.value)} />
            </Field>
            <Checkbox
              checked={showRoundContext}
              onChange={setShowRoundContext}
              label="Wahlgang und Kennung in der Fußzeile anzeigen"
            />
            <button
              disabled={!messageTitle.trim()}
              onClick={() =>
                void setMode('custom_message', {
                  message: { title: messageTitle, body: messageBody || undefined, showRoundContext }
                })
              }
            >
              Anzeigen
            </button>
          </Card>

          <Card title="Pause">
            <div className="row">
              <div style={{ width: 170 }}>
                <Field label="Dauer (Minuten)" hint="0 = ohne Countdown">
                  <NumberInput value={breakMinutes} min={0} max={240} onChange={setBreakMinutes} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Hinweistext (optional)">
                  <input
                    value={breakNote}
                    onChange={(e) => setBreakNote(e.target.value)}
                    placeholder="Die Versammlung wird in Kürze fortgesetzt."
                  />
                </Field>
              </div>
            </div>
            <button
              className="primary"
              onClick={() =>
                void setMode('break', {
                  breakMinutes: breakMinutes > 0 ? breakMinutes : undefined,
                  message: {
                    title: 'KURZE PAUSE',
                    body: breakNote || undefined,
                    showRoundContext
                  }
                })
              }
            >
              Pause anzeigen
            </button>
            <div className="hint">
              Der Countdown ist nur für Pausen gedacht. Für die Stimmabgabe wird bewusst keine Uhr angezeigt,
              solange die Wahlleitung kein Ende beschlossen hat.
            </div>
          </Card>

          <Card title="Tagesordnung">
            <Field label="Tagesordnungspunkt">
              <input value={agenda.top} onChange={(e) => setAgenda({ ...agenda, top: e.target.value })} />
            </Field>
            <div className="row">
              <div style={{ flex: 1 }}>
                <Field label="Aktuell">
                  <input value={agenda.current} onChange={(e) => setAgenda({ ...agenda, current: e.target.value })} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Danach">
                  <input value={agenda.next} onChange={(e) => setAgenda({ ...agenda, next: e.target.value })} />
                </Field>
              </div>
            </div>
            <button onClick={() => void setMode('agenda', { agenda })}>Tagesordnung anzeigen</button>
          </Card>

          <Card title="Beamer im Netzwerk">
            {network ? (
              <NetworkSection status={network} onChange={setNetwork} />
            ) : (
              <p className="hint">Wird geladen …</p>
            )}
          </Card>

          <Card title="Verlauf">
            <div className="scroll-box" style={{ maxHeight: 220 }}>
              <table>
                <tbody>
                  {history.map((entry, index) => (
                    <tr key={index}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatTimeDe(entry.timestamp)}</td>
                      <td>{entry.label}</td>
                      <td>{entry.roundLabel ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
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

  const save = async (): Promise<void> => {
    try {
      const next = await api('projection.setNetwork', {
        enabled,
        port,
        bindAddress: lanWide ? '0.0.0.0' : '127.0.0.1',
        token,
        allowRemoteOperator
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
