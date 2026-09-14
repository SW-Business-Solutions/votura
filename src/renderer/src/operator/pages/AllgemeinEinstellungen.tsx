/**
 * Allgemeine Einstellungen: Organisation, Sicherungsabfragen, Aktualisierung.
 *
 * Eigene Datei aus demselben Grund wie die übrigen — die Einstellungsseite
 * war auf knapp tausend Zeilen angewachsen und enthielt vier Themen, die
 * nichts miteinander zu tun haben.
 */
import { useEffect, useState } from 'react'
import type { AppConfig, UpdateCheckResult, UpdateInstallCheck, UpdateProgress } from '@shared/types'
import { api, bridge } from '../../lib/api'
import { useApp } from '../state'
import { Card, Checkbox, ConfirmDialog, Field, NumberInput } from '../components/ui'

export function AllgemeinEinstellungen(): React.JSX.Element {
  const app = useApp()
  const [config, setConfig] = useState<AppConfig>(app.settings!.config)
  /*
   * Die Programmaktualisierung stand unter *Backup*. Ein Update ist aber
   * keine Datensicherung — wer eines suchte, fand es dort nicht, und wer ein
   * Backup machen wollte, stolperte über einen Knopf, der die Anwendung
   * beendet.
   */
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [installBusy, setInstallBusy] = useState(false)
  const [installCheck, setInstallCheck] = useState<UpdateInstallCheck | null>(null)
  const [showInstall, setShowInstall] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)

  useEffect(() => bridge.onUpdateProgress(setProgress), [])

  /** Sofort speichern — für Schalter, bei denen ein „Speichern" danach albern wäre. */
  const speichern = async (next: AppConfig): Promise<void> => {
    setConfig(next)
    try {
      await api('system.saveConfig', next)
      await app.refreshSettings()
    } catch (error) {
      app.reportError(error)
    }
  }

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
      <Card title="Versammlung">
        {/*
         * Wann eine Versammlung beschlussfähig ist, steht in der Satzung und
         * nicht im Programm. Voreingestellt ist deshalb „keine Regel": Ohne
         * ausdrückliche Angabe behauptet Votura dazu nichts — eine falsch
         * geratene Schwelle wäre schlimmer als gar keine.
         */}
        <Field
          label="Beschlussfähigkeit"
          hint="Gilt für die Zahl der anwesenden Stimmberechtigten aus der Akkreditierung."
        >
          <select
            value={config.assembly.quorum.kind}
            onChange={(e) =>
              setConfig({
                ...config,
                assembly: {
                  quorum: {
                    kind: e.target.value as 'none' | 'count' | 'share',
                    value: e.target.value === 'share' ? 0.5 : config.assembly.quorum.value
                  }
                }
              })
            }
          >
            <option value="none">Keine Regel — Votura sagt dazu nichts</option>
            <option value="count">Mindestens eine feste Anzahl</option>
            <option value="share">Mindestens ein Anteil der Stimmberechtigten</option>
          </select>
        </Field>
        {config.assembly.quorum.kind === 'count' && (
          <Field label="Mindestens … stimmberechtigte Anwesende">
            <NumberInput
              value={config.assembly.quorum.value}
              min={0}
              onChange={(value) => setConfig({ ...config, assembly: { quorum: { kind: 'count', value } } })}
            />
          </Field>
        )}
        {config.assembly.quorum.kind === 'share' && (
          <Field
            label="Anteil in Prozent"
            hint={'Aufgerundet: „Die Hälfte von 15“ sind acht, nicht siebeneinhalb.'}
          >
            <NumberInput
              value={Math.round(config.assembly.quorum.value * 100)}
              min={1}
              max={100}
              onChange={(value) =>
                setConfig({
                  ...config,
                  assembly: { quorum: { kind: 'share', value: Math.min(1, value / 100) } }
                })
              }
            />
          </Field>
        )}
        <Field label="Zeitzone" hint="Zeitpunkte werden intern in UTC gespeichert und lokal angezeigt.">
          <input
            value={config.timezone}
            onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
          />
        </Field>
      </Card>

      {/*
        Vorher „Sicherheit und Zeit" — ein Sammelbecken. Die Zeitzone bestimmt,
        wie Zeitpunkte im Protokoll erscheinen, und gehört zur Versammlung;
        alles Übrige schützt vor Missgriffen und heißt deshalb so.
      */}
      <Card title="Sicherheit">
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
          label="Wahlleiter-PIN für Massendruck und Ergebnisbestätigung verlangen"
        />
        <Checkbox
          checked={config.security.requireFourEyesForResult}
          onChange={(value) =>
            setConfig({ ...config, security: { ...config.security, requireFourEyesForResult: value } })
          }
          label="Vier-Augen-Prinzip: Ergebnis muss von einer anderen Person bestätigt werden"
        />
        <PinSection />
        <div className="row mt-4">
          <button className="primary big" onClick={() => void save()}>
            Einstellungen speichern
          </button>
        </div>
      </Card>
      <Card title="Neue Fassung">
        <div className="notice">
          Votura arbeitet offline. Die Prüfung fragt einmalig die zuletzt veröffentlichte Fassung bei GitHub
          ab und verrät dabei die Adresse dieses Rechners. Es wird nichts geladen und nichts installiert — Sie
          erhalten nur die Auskunft, ob es eine neuere Fassung gibt.
        </div>

        <Checkbox
          checked={config.updates.checkOnStart}
          onChange={(value) =>
            void speichern({ ...config, updates: { ...config.updates, checkOnStart: value } })
          }
          label="Beim Start nachsehen, sofern eine Verbindung besteht"
        />
        <Field label="Projekt auf GitHub" hint="Form: benutzer/projekt">
          <input
            value={config.updates.repository}
            onChange={(e) =>
              setConfig({ ...config, updates: { ...config.updates, repository: e.target.value } })
            }
            onBlur={() => void speichern(config)}
          />
        </Field>

        <div className="row">
          <button
            disabled={updateBusy}
            onClick={async () => {
              setUpdateBusy(true)
              try {
                setUpdate(await api('update.check'))
              } catch (error) {
                app.reportError(error)
              } finally {
                setUpdateBusy(false)
              }
            }}
          >
            {updateBusy ? 'Wird geprüft …' : 'Jetzt auf neue Fassung prüfen'}
          </button>
          <span className="hint">Installiert: Version {app.setup?.version}</span>
        </div>

        {update && (
          <div className={`notice mt-3 ${update.error ? 'warn' : update.updateAvailable ? 'ok' : ''}`}>
            {update.error ? (
              <>Die Prüfung war nicht möglich: {update.error}</>
            ) : update.updateAvailable ? (
              <>
                <strong>Version {update.latestVersion} ist verfügbar</strong> (installiert:{' '}
                {update.installedVersion}).
                <br />
                Ein Wechsel während einer laufenden Versammlung ist nicht ratsam — geprüft und freigegeben
                wurde die Fassung, die gerade läuft.
                <div className="row mt-2">
                  <button
                    className="primary"
                    disabled={installBusy || !app.can('system.manage')}
                    onClick={async () => {
                      try {
                        const pruefung = await api('update.canInstall')
                        setInstallCheck(pruefung)
                        setShowInstall(true)
                      } catch (error) {
                        app.reportError(error)
                      }
                    }}
                  >
                    Jetzt einspielen
                  </button>
                  {update.releaseUrl && (
                    <button
                      onClick={() =>
                        void api('system.openExternal', update.releaseUrl ?? '').catch(app.reportError)
                      }
                    >
                      Veröffentlichungsseite öffnen
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>Version {update.installedVersion} ist die aktuelle Fassung.</>
            )}
          </div>
        )}
      </Card>

      {progress && (
        <Card title="Neue Fassung wird eingespielt">
          <div className="notice">{progress.message ?? 'Bitte warten …'}</div>
          {progress.phase === 'download' && progress.totalBytes ? (
            <>
              <progress
                value={progress.receivedBytes ?? 0}
                max={progress.totalBytes}
                style={{ width: '100%' }}
              />
              <div className="hint">
                {Math.round((progress.receivedBytes ?? 0) / 1_048_576)} von{' '}
                {Math.round(progress.totalBytes / 1_048_576)} MB
              </div>
            </>
          ) : null}
        </Card>
      )}

      {showInstall && (
        <ConfirmDialog
          title="Neue Fassung einspielen?"
          danger
          requireReason={false}
          confirmLabel={installCheck?.possible ? 'Herunterladen und installieren' : 'Nicht möglich'}
          message={
            <>
              {installCheck && !installCheck.possible ? (
                <div className="notice warn">
                  <strong>Jetzt nicht:</strong>
                  <ul>
                    {installCheck.reasons.map((grund) => (
                      <li key={grund}>{grund}</li>
                    ))}
                  </ul>
                  Bitte erst die laufenden Wahlgänge abschließen. Während einer Versammlung darf die Fassung
                  nicht gewechselt werden.
                </div>
              ) : (
                <>
                  <p>
                    Version <strong>{update?.latestVersion}</strong> wird heruntergeladen, gegen die
                    veröffentlichte Prüfsumme geprüft und anschließend installiert.{' '}
                    <strong>Votura beendet sich dabei</strong> — eine laufende Fassung lässt sich nicht
                    ersetzen. Ihre Daten bleiben erhalten.
                  </p>
                  <p className="hint">
                    Der Vorgang wird im Audit-Trail vermerkt. Führen Sie ihn nie unmittelbar vor oder während
                    einer Versammlung durch, sondern prüfen Sie die neue Fassung vorher in Ruhe.
                  </p>
                </>
              )}
            </>
          }
          onCancel={() => setShowInstall(false)}
          onConfirm={async () => {
            if (!installCheck?.possible) {
              setShowInstall(false)
              return
            }
            setShowInstall(false)
            setInstallBusy(true)
            setProgress({ phase: 'start', message: 'Vorbereitung …' })
            try {
              await api('update.install')
            } catch (error) {
              setProgress(null)
              setInstallBusy(false)
              app.reportError(error)
            }
          }}
        />
      )}
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
        <div className="col">
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
