/** Einstellungen: Drucker, Konfiguration, Benutzer, Backup (§12, §55, §56, §81). */
import { useEffect, useState } from 'react'
import type { AppConfig, PrinterConfig, Role, User } from '@shared/types'
import { PRINTER_KIND_LABELS, PRINTER_KINDS, ROLE_LABELS, ROLES } from '@shared/types'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card, Checkbox, Field, Modal, NumberInput } from '../components/ui'
import { ProjectionDesign } from './ProjectionDesign'

export function SettingsPage(): React.JSX.Element {
  const app = useApp()
  const [tab, setTab] = useState<'printers' | 'general' | 'beamer' | 'users' | 'backup'>('printers')

  if (!app.settings) return <Card>Einstellungen werden geladen …</Card>

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Einstellungen</h1>
          <div className="subtitle">Alle Angaben werden lokal gespeichert.</div>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab${tab === 'printers' ? ' active' : ''}`} onClick={() => setTab('printers')}>
          Drucker
        </button>
        <button className={`tab${tab === 'general' ? ' active' : ''}`} onClick={() => setTab('general')}>
          Allgemein
        </button>
        <button className={`tab${tab === 'beamer' ? ' active' : ''}`} onClick={() => setTab('beamer')}>
          Beamer-Design
        </button>
        <button className={`tab${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')}>
          Benutzer
        </button>
        <button className={`tab${tab === 'backup' ? ' active' : ''}`} onClick={() => setTab('backup')}>
          Backup
        </button>
      </div>

      {tab === 'printers' && <PrinterSettings />}
      {tab === 'general' && <GeneralSettings />}
      {tab === 'beamer' && <ProjectionDesign />}
      {tab === 'users' && <UserSettings />}
      {tab === 'backup' && <BackupSettings />}
    </>
  )
}

function PrinterSettings(): React.JSX.Element {
  const app = useApp()
  const [printers, setPrinters] = useState<PrinterConfig[]>(app.settings?.printers ?? [])
  const [status, setStatus] = useState<Record<string, string>>({})

  useEffect(() => setPrinters(app.settings?.printers ?? []), [app.settings])

  const update = (id: string, patch: Partial<PrinterConfig>): void => {
    setPrinters((current) => current.map((printer) => (printer.id === id ? { ...printer, ...patch } : printer)))
  }

  const save = async (): Promise<void> => {
    try {
      await api('system.savePrinters', printers)
      await app.refreshSettings()
      app.notify('ok', 'Druckereinstellungen gespeichert.')
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <>
      <div className="notice">
        Zielklasse sind 80-mm-ESC/POS-Thermodrucker mit 203 dpi und Auto-Cutter. Für Epson-Geräte mit
        Netzwerkschnittstelle ist „Epson ePOS-Print“ die beste Wahl: nur dieser Weg liefert einen echten
        Gerätestatus (Papier, Abdeckung).
      </div>

      {printers.map((printer) => (
        <Card key={printer.id} title={printer.name}>
          <div className="row">
            <div style={{ flex: 1 }}>
              <Field label="Bezeichnung">
                <input value={printer.name} onChange={(e) => update(printer.id, { name: e.target.value })} />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Anbindung">
                <select
                  value={printer.kind}
                  onChange={(e) => update(printer.id, { kind: e.target.value as PrinterConfig['kind'] })}
                >
                  {PRINTER_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {PRINTER_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          {(printer.kind === 'epson_epos' || printer.kind === 'escpos_network') && (
            <div className="row">
              <div style={{ flex: 2 }}>
                <Field label="IP-Adresse / Hostname">
                  <input
                    value={printer.host ?? ''}
                    onChange={(e) => update(printer.id, { host: e.target.value })}
                    placeholder="192.168.1.50"
                  />
                </Field>
              </div>
              <div style={{ width: 140 }}>
                <Field label="Port">
                  <NumberInput
                    value={printer.port ?? (printer.kind === 'epson_epos' ? 80 : 9100)}
                    onChange={(value) => update(printer.id, { port: value })}
                  />
                </Field>
              </div>
              {printer.kind === 'epson_epos' && (
                <div style={{ flex: 1 }}>
                  <Field label="Gerätename (ePOS)">
                    <input
                      value={printer.deviceId ?? 'local_printer'}
                      onChange={(e) => update(printer.id, { deviceId: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </div>
          )}

          {printer.kind === 'escpos_windows' && (
            <Field
              label="Windows-Druckername"
              hint="Exakt wie in den Windows-Einstellungen, z. B. „EPSON TM-T88VII Receipt“."
            >
              <input
                value={printer.windowsPrinterName ?? ''}
                onChange={(e) => update(printer.id, { windowsPrinterName: e.target.value })}
              />
            </Field>
          )}

          <div className="row">
            <div style={{ width: 150 }}>
              <Field label="Papierbreite (mm)">
                <select
                  value={printer.paperWidthMm}
                  onChange={(e) => {
                    const width = Number(e.target.value) as PrinterConfig['paperWidthMm']
                    update(printer.id, {
                      paperWidthMm: width,
                      charsPerLine: width === 58 ? 32 : width === 112 ? 60 : 42,
                      dotsPerLine: width === 58 ? 384 : width === 112 ? 832 : 576
                    })
                  }}
                >
                  <option value={58}>58</option>
                  <option value={80}>80</option>
                  <option value={112}>112</option>
                </select>
              </Field>
            </div>
            <div style={{ width: 150 }}>
              <Field label="Zeichen je Zeile">
                <NumberInput
                  value={printer.charsPerLine}
                  onChange={(value) => update(printer.id, { charsPerLine: value })}
                />
              </Field>
            </div>
            <div style={{ width: 150 }}>
              <Field label="Punkte je Zeile">
                <NumberInput
                  value={printer.dotsPerLine}
                  onChange={(value) => update(printer.id, { dotsPerLine: value })}
                />
              </Field>
            </div>
            <div style={{ width: 170 }}>
              <Field label="Zeichentabelle">
                <select
                  value={printer.codepage}
                  onChange={(e) => update(printer.id, { codepage: e.target.value as PrinterConfig['codepage'] })}
                >
                  <option value="CP858">CP858</option>
                  <option value="CP437">CP437</option>
                  <option value="CP1252">CP1252</option>
                </select>
              </Field>
            </div>
            <div style={{ width: 170 }}>
              <Field label="Leerzeilen vor Schnitt">
                <NumberInput
                  value={printer.feedLinesBeforeCut}
                  onChange={(value) => update(printer.id, { feedLinesBeforeCut: value })}
                />
              </Field>
            </div>
          </div>

          <div className="row">
            <Checkbox
              checked={printer.cutEveryBallot}
              onChange={(value) => update(printer.id, { cutEveryBallot: value })}
              label="Nach jedem Stimmzettel schneiden"
            />
            <Checkbox
              checked={printer.enabled}
              onChange={(value) => update(printer.id, { enabled: value })}
              label="Drucker aktiv"
            />
            <span className="spacer" />
            <button
              onClick={async () => {
                try {
                  const result = await api('print.testPrinter', printer.id)
                  setStatus((current) => ({ ...current, [printer.id]: result.message }))
                  app.notify(result.ok ? 'ok' : 'warning', result.message)
                } catch (error) {
                  app.reportError(error)
                }
              }}
            >
              Verbindung prüfen
            </button>
          </div>
          {status[printer.id] && <div className="hint">{status[printer.id]}</div>}
        </Card>
      ))}

      <div className="row">
        <button className="primary big" onClick={() => void save()}>
          Druckereinstellungen speichern
        </button>
        <button
          onClick={() =>
            setPrinters((current) => [
              ...current,
              {
                id: `printer-${current.length + 1}-${Date.now().toString(36)}`,
                name: 'Weiterer Drucker',
                kind: 'escpos_network',
                host: '',
                port: 9100,
                paperWidthMm: 80,
                charsPerLine: 42,
                dotsPerLine: 576,
                cutEveryBallot: true,
                feedLinesBeforeCut: 3,
                codepage: 'CP858',
                enabled: true
              }
            ])
          }
        >
          Drucker hinzufügen
        </button>
      </div>
    </>
  )
}

function GeneralSettings(): React.JSX.Element {
  const app = useApp()
  const [config, setConfig] = useState<AppConfig>(app.settings!.config)

  useEffect(() => setConfig(app.settings!.config), [app.settings])

  const save = async (): Promise<void> => {
    try {
      await api('system.saveConfig', config)
      await app.refreshSettings()
      app.notify('ok', 'Einstellungen gespeichert.')
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <div className="grid cols-2">
      <Card title="Druck und Stimmzettel">
        <Field label="Standarddrucker">
          <select
            value={config.printing.defaultPrinterId}
            onChange={(e) =>
              setConfig({ ...config, printing: { ...config.printing, defaultPrinterId: e.target.value } })
            }
          >
            {app.settings!.printers.map((printer) => (
              <option key={printer.id} value={printer.id}>
                {printer.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="row">
          <div style={{ flex: 1 }}>
            <Field label="Standard-Zusatzreserve">
              <NumberInput
                value={config.printing.reserveCopies}
                onChange={(value) =>
                  setConfig({ ...config, printing: { ...config.printing, reserveCopies: value } })
                }
              />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Pause zwischen Exemplaren (ms)" hint="Schont den Druckerpuffer bei großen Stapeln.">
              <NumberInput
                value={config.printing.copyDelayMs}
                onChange={(value) => setConfig({ ...config, printing: { ...config.printing, copyDelayMs: value } })}
              />
            </Field>
          </div>
        </div>
        <Checkbox
          checked={config.ballots.printRoundCode}
          onChange={(value) => setConfig({ ...config, ballots: { ...config.ballots, printRoundCode: value } })}
          label="Wahlgangkennung auf den Stimmzettel drucken"
        />
        <Checkbox
          checked={config.ballots.printBallotVersion}
          onChange={(value) => setConfig({ ...config, ballots: { ...config.ballots, printBallotVersion: value } })}
          label="Zettelversion aufdrucken"
        />

        <h3>Beschriftungen</h3>
        <div className="row">
          {(['yes', 'no', 'abstention', 'abstentionShort'] as const).map((key) => (
            <div key={key} style={{ flex: 1 }}>
              <Field label={key}>
                <input
                  value={config.ballots.labels[key]}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      ballots: { ...config.ballots, labels: { ...config.ballots.labels, [key]: e.target.value } }
                    })
                  }
                />
              </Field>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Sicherheit und Zeit">
        <Field label="Zeitzone" hint="Zeitpunkte werden intern in UTC gespeichert und lokal angezeigt.">
          <input value={config.timezone} onChange={(e) => setConfig({ ...config, timezone: e.target.value })} />
        </Field>
        <Field label="Sitzungszeitlimit (Minuten)">
          <NumberInput
            value={config.security.sessionTimeoutMinutes}
            min={1}
            onChange={(value) =>
              setConfig({ ...config, security: { ...config.security, sessionTimeoutMinutes: value } })
            }
          />
        </Field>
        <Checkbox
          checked={config.security.requirePinForMassPrint}
          onChange={(value) =>
            setConfig({ ...config, security: { ...config.security, requirePinForMassPrint: value } })
          }
          label="Wahlleiter-PIN für Massendruck und Ergebnisbestaetigung verlangen"
        />
        <Checkbox
          checked={config.security.requireFourEyesForResult}
          onChange={(value) =>
            setConfig({ ...config, security: { ...config.security, requireFourEyesForResult: value } })
          }
          label="Vier-Augen-Prinzip: Ergebnis muss von einer anderen Person bestätigt werden"
        />
        <PinSection />
        <div className="row" style={{ marginTop: 16 }}>
          <button className="primary big" onClick={() => void save()}>
            Einstellungen speichern
          </button>
        </div>
      </Card>
    </div>
  )
}

function PinSection(): React.JSX.Element {
  const app = useApp()
  const [pin, setPin] = useState('')
  return (
    <>
      <h3>Eigene Wahlleiter-PIN</h3>
      <div className="row">
        <div style={{ flex: 1 }}>
          <Field label="Neue PIN (4–12 Ziffern)">
            <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
          </Field>
        </div>
        <button
          disabled={!/^\d{4,12}$/.test(pin)}
          onClick={async () => {
            try {
              await api('auth.setPrintPin', { pin })
              setPin('')
              app.notify('ok', 'PIN gespeichert.')
            } catch (error) {
              app.reportError(error)
            }
          }}
        >
          PIN setzen
        </button>
      </div>
    </>
  )
}

function UserSettings(): React.JSX.Element {
  const app = useApp()
  const [users, setUsers] = useState<User[]>([])
  const [showCreate, setShowCreate] = useState(false)

  const load = async (): Promise<void> => {
    try {
      setUsers(await api('auth.listUsers'))
    } catch (error) {
      app.reportError(error)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <Card
      title="Benutzer und Rollen"
      actions={
        <button className="primary" onClick={() => setShowCreate(true)}>
          Benutzer anlegen
        </button>
      }
    >
      <table>
        <thead>
          <tr>
            <th>Benutzer</th>
            <th>Rolle</th>
            <th>PIN</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                <strong>{user.displayName}</strong>
                <br />
                <span className="hint">{user.username}</span>
              </td>
              <td>
                <select
                  value={user.role}
                  onChange={async (e) => {
                    try {
                      await api('auth.updateUser', { id: user.id, role: e.target.value as Role })
                      await load()
                    } catch (error) {
                      app.reportError(error)
                    }
                  }}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </td>
              <td>{user.hasPrintPin ? <span className="badge ok">gesetzt</span> : <span className="badge">–</span>}</td>
              <td>
                {user.active ? <span className="badge ok">aktiv</span> : <span className="badge danger">gesperrt</span>}
              </td>
              <td>
                <button
                  onClick={async () => {
                    try {
                      await api('auth.updateUser', { id: user.id, active: !user.active })
                      await load()
                    } catch (error) {
                      app.reportError(error)
                    }
                  }}
                >
                  {user.active ? 'Sperren' : 'Entsperren'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showCreate && (
        <CreateUserDialog
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false)
            await load()
          }}
        />
      )}
    </Card>
  )
}

function CreateUserDialog({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: () => Promise<void>
}): React.JSX.Element {
  const app = useApp()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('WAHLKOMMISSION')

  return (
    <Modal
      title="Benutzer anlegen"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="primary"
            disabled={!username || password.length < 8}
            onClick={async () => {
              try {
                await api('auth.createUser', { username, displayName, password, role })
                await onCreated()
              } catch (error) {
                app.reportError(error)
              }
            }}
          >
            Anlegen
          </button>
        </>
      }
    >
      <Field label="Benutzername">
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      </Field>
      <Field label="Anzeigename">
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <Field label="Passwort" hint="Mindestens 8 Zeichen.">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Rolle">
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((entry) => (
            <option key={entry} value={entry}>
              {ROLE_LABELS[entry]}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  )
}

function BackupSettings(): React.JSX.Element {
  const app = useApp()
  const [config, setConfig] = useState<AppConfig>(app.settings!.config)
  const [busy, setBusy] = useState(false)

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
        <div className="notice" style={{ marginTop: 12 }}>
          Für den Betrieb vor Ort empfiehlt sich ein Ersatzrechner, auf dem ein Backup eingespielt werden kann,
          sowie zwei USB-Sticks für wechselnde Sicherungen.
        </div>
      </Card>
    </div>
  )
}
