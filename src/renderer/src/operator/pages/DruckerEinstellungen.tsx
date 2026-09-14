/**
 * Drucker einrichten — Anschluss, Papier, Übermittlung.
 *
 * Steht in einer eigenen Datei, seit die Einstellungsseite auf knapp tausend
 * Zeilen angewachsen war: Wer am Bondrucker etwas ändern will, soll nicht an
 * Benutzerkonten und Backup vorbeiscrollen.
 */
import { useEffect, useState } from 'react'
import type { AppConfig, PrinterConfig } from '@shared/types'
import { PRINTER_KIND_LABELS, PRINTER_KINDS } from '@shared/types'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card, Checkbox, Field, NumberInput } from '../components/ui'

export function DruckerEinstellungen(): React.JSX.Element {
  const app = useApp()
  const [printers, setPrinters] = useState<PrinterConfig[]>(app.settings?.printers ?? [])
  const [status, setStatus] = useState<Record<string, string>>({})
  /*
   * Das Druckverhalten — Stückzahl, Pause, Übermittlung — stand bisher unter
   * *Allgemein*, während hier die Geräte standen. Wer wissen wollte, wie
   * gedruckt wird, suchte an beiden Orten. Es gehört zum Drucken, also
   * hierher; gespeichert wird es weiterhin als Teil der Konfiguration.
   */
  const [config, setConfig] = useState<AppConfig>(app.settings!.config)

  useEffect(() => setPrinters(app.settings?.printers ?? []), [app.settings])
  useEffect(() => setConfig(app.settings!.config), [app.settings])

  const verhaltenSpeichern = async (): Promise<void> => {
    try {
      await api('system.saveConfig', config)
      await app.refreshSettings()
      app.notify('ok', 'Druckverhalten gespeichert.')
    } catch (error) {
      app.reportError(error)
    }
  }

  const update = (id: string, patch: Partial<PrinterConfig>): void => {
    setPrinters((current) =>
      current.map((printer) => (printer.id === id ? { ...printer, ...patch } : printer))
    )
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
                <div className="col">
                  <Field label="Standard-Zusatzreserve">
                    <NumberInput
                      value={config.printing.reserveCopies}
                      onChange={(value) =>
                        setConfig({ ...config, printing: { ...config.printing, reserveCopies: value } })
                      }
                    />
                  </Field>
                </div>
                <div className="col">
                  <Field label="Pause zwischen Exemplaren (ms)" hint="Schont den Druckerpuffer bei großen Stapeln.">
                    <NumberInput
                      value={config.printing.copyDelayMs}
                      onChange={(value) =>
                        setConfig({ ...config, printing: { ...config.printing, copyDelayMs: value } })
                      }
                    />
                  </Field>
                </div>
              </div>
              {/* Geschwindigkeit gegen Zählgenauigkeit — die Abwägung gehört offen
                  hingeschrieben, nicht in eine Zahl versteckt. */}
              <Field label="Übermittlung an den Drucker">
                <div className="segmented">
                  <button
                    className={config.printing.copiesPerRequest <= 1 ? 'active' : ''}
                    onClick={() => setConfig({ ...config, printing: { ...config.printing, copiesPerRequest: 1 } })}
                  >
                    Jeder Zettel einzeln
                  </button>
                  <button
                    className={config.printing.copiesPerRequest > 1 ? 'active' : ''}
                    onClick={() =>
                      setConfig({
                        ...config,
                        printing: {
                          ...config.printing,
                          copiesPerRequest:
                            config.printing.copiesPerRequest > 1 ? config.printing.copiesPerRequest : 10
                        }
                      })
                    }
                  >
                    Gebündelt
                  </button>
                </div>
              </Field>

              {config.printing.copiesPerRequest <= 1 ? (
                <div className="notice">
                  <strong>Jeder Zettel einzeln.</strong> Der Drucker bestätigt jeden Stimmzettel einzeln — die
                  übermittelte Menge ist damit auf den Zettel genau bekannt. Bei Netzwerkdruckern (Epson ePOS)
                  antwortet das Gerät erst, wenn der Zettel durchgelaufen, geschnitten und der Status ermittelt ist;{' '}
                  <strong>gemessen sind das rund zwei Sekunden je Zettel</strong> — für 150 Zettel also etwa fünf
                  Minuten. Gebündelt halbiert sich das ungefähr.
                </div>
              ) : (
                <div className="notice warn">
                  <strong>Gebündelt.</strong> Mehrere Zettel gehen in einem Auftrag an den Drucker und laufen ohne
                  Pause durch — <strong>deutlich schneller</strong>. Dafür ist bei einem Abbruch (Papierende,
                  Netzwerkstörung) nur bekannt, dass es innerhalb des laufenden Bündels geschah: Bis zu{' '}
                  {config.printing.copiesPerRequest} Zettel müssen dann von Hand nachgezählt werden statt einem.
                </div>
              )}

              {config.printing.copiesPerRequest > 1 && (
                <Field
                  label="Zettel je Auftrag"
                  hint="Größere Bündel sind schneller, vergrößern aber die Menge, die bei einem Abbruch nachzuzählen ist."
                >
                  <NumberInput
                    value={config.printing.copiesPerRequest}
                    onChange={(value) =>
                      setConfig({
                        ...config,
                        printing: { ...config.printing, copiesPerRequest: Math.max(2, Math.min(50, value)) }
                      })
                    }
                  />
                </Field>
              )}

              <Checkbox
                checked={config.ballots.printRoundCode}
                onChange={(value) =>
                  setConfig({ ...config, ballots: { ...config.ballots, printRoundCode: value } })
                }
                label="Wahlgangkennung auf den Stimmzettel drucken"
              />
              <Checkbox
                checked={config.ballots.printBallotVersion}
                onChange={(value) =>
                  setConfig({ ...config, ballots: { ...config.ballots, printBallotVersion: value } })
                }
                label="Zettelversion aufdrucken"
              />

              <h3>Beschriftungen</h3>
              <div className="row">
                {(['yes', 'no', 'abstention', 'abstentionShort'] as const).map((key) => (
                  <div key={key} className="col">
                    <Field label={key}>
                      <input
                        value={config.ballots.labels[key]}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            ballots: {
                              ...config.ballots,
                              labels: { ...config.ballots.labels, [key]: e.target.value }
                            }
                          })
                        }
                      />
                    </Field>
                  </div>
                ))}
              </div>
              <div className="row mt-3">
          <button className="primary" onClick={() => void verhaltenSpeichern()}>
            Druckverhalten speichern
          </button>
        </div>
      </Card>

      <div className="notice">
        Zielklasse sind 80-mm-ESC/POS-Thermodrucker mit 203 dpi und Auto-Cutter. Für Epson-Geräte mit
        Netzwerkschnittstelle ist „Epson ePOS-Print“ die beste Wahl: nur dieser Weg liefert einen echten
        Gerätestatus (Papier, Abdeckung).
      </div>

      {printers.map((printer) => (
        <Card key={printer.id} title={printer.name}>
          <div className="row">
            <div className="col">
              <Field label="Bezeichnung">
                <input value={printer.name} onChange={(e) => update(printer.id, { name: e.target.value })} />
              </Field>
            </div>
            <div className="col">
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
              <div className="col-2">
                <Field label="IP-Adresse / Hostname">
                  <input
                    value={printer.host ?? ''}
                    onChange={(e) => update(printer.id, { host: e.target.value })}
                    placeholder="192.168.1.50"
                  />
                </Field>
              </div>
              <div className="col-mittel">
                <Field label="Port">
                  <NumberInput
                    value={printer.port ?? (printer.kind === 'epson_epos' ? 80 : 9100)}
                    onChange={(value) => update(printer.id, { port: value })}
                  />
                </Field>
              </div>
              {printer.kind === 'epson_epos' && (
                <div className="col">
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
            <div className="col-mittel">
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
            <div className="col-mittel">
              <Field label="Zeichen je Zeile">
                <NumberInput
                  value={printer.charsPerLine}
                  onChange={(value) => update(printer.id, { charsPerLine: value })}
                />
              </Field>
            </div>
            <div className="col-mittel">
              <Field label="Punkte je Zeile">
                <NumberInput
                  value={printer.dotsPerLine}
                  onChange={(value) => update(printer.id, { dotsPerLine: value })}
                />
              </Field>
            </div>
            <div className="col-mittel">
              <Field label="Zeichentabelle">
                <select
                  value={printer.codepage}
                  onChange={(e) =>
                    update(printer.id, { codepage: e.target.value as PrinterConfig['codepage'] })
                  }
                >
                  <option value="CP858">CP858</option>
                  <option value="CP437">CP437</option>
                  <option value="CP1252">CP1252</option>
                </select>
              </Field>
            </div>
            <div className="col-mittel">
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
