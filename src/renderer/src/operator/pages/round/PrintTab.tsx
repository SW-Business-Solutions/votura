/**
 * Druck: Testdruck, Massendruck, Nachdruck (§18–§21, §35, §36, §47–§49, §79).
 *
 * Der Massendruck läuft nur über diesen Dialog — kein Tastenkürzel löst ihn
 * aus, und ein doppelter Klick kann durch den Idempotency-Key keinen zweiten
 * Stapel erzeugen.
 */
import { useEffect, useMemo, useState } from 'react'
import { estimatePaperUsage } from '@shared/accounting'
import { formatDateTimeDe } from '@shared/format'
import {
  PRINT_BATCH_KIND_LABELS,
  PRINT_BATCH_STATUS_LABELS,
  type PrintBatch,
  type PrinterConfig
} from '@shared/types'
import { api } from '../../../lib/api'
import { useApp } from '../../state'
import { Card, Field, Modal, NumberInput } from '../../components/ui'
import type { TabProps } from '../RoundDetailPage'

const REPRINT_REASONS = [
  'Beschaedigter Stimmzettel',
  'Fehlerhafter Druck',
  'Weiterer Stimmberechtigter',
  'Ersatzstimmzettel',
  'Von der Wahlleitung angeordnet'
]

export function PrintTab({ detail, reload }: TabProps): React.JSX.Element {
  const app = useApp()
  const round = detail.round
  const settings = app.settings
  const printers = (settings?.printers ?? []).filter((printer) => printer.enabled)

  const [printerId, setPrinterId] = useState(settings?.config.printing.defaultPrinterId ?? printers[0]?.id ?? '')
  const [copies, setCopies] = useState(0)
  const [reserve, setReserve] = useState(settings?.config.printing.reserveCopies ?? 5)
  const [pin, setPin] = useState('')
  const [dialog, setDialog] = useState<'mass' | 'reprint' | null>(null)
  const [reprintCount, setReprintCount] = useState(1)
  const [reprintReason, setReprintReason] = useState(REPRINT_REASONS[0])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [resumeBatch, setResumeBatch] = useState<PrintBatch | null>(null)
  const [resumeCount, setResumeCount] = useState(0)

  const eligible = app.event?.eligibleVoterCount ?? 0
  useEffect(() => {
    setCopies(eligible + reserve)
  }, [eligible, reserve])

  const approved = round.approvedVersion === round.ballotVersion
  const printer = printers.find((entry) => entry.id === printerId)
  const progress = app.printProgress?.electionRoundId === round.id ? app.printProgress : null

  const paper = useMemo(() => {
    const lines = Math.max(24, detail.candidates.length * 2 + 24)
    return estimatePaperUsage(lines, copies)
  }, [detail.candidates.length, copies])

  const requirePin = settings?.config.security.requirePinForMassPrint ?? true

  const runPrint = async (kind: 'initial' | 'reprint' | 'test', count: number, reason?: string): Promise<void> => {
    setBusy(true)
    try {
      const key =
        kind === 'test'
          ? `test-${round.roundCode}-v${round.ballotVersion}-${Date.now()}`
          : `${kind}-${round.roundCode}-v${round.ballotVersion}-${count}-${new Date().toISOString().slice(0, 19)}`
      const result = await api('print.start', {
        electionRoundId: round.id,
        printerId,
        copies: count,
        ballotVersion: round.ballotVersion,
        kind,
        reason,
        idempotencyKey: key,
        pin: kind === 'test' ? undefined : pin
      })
      if (result.deduplicated) {
        app.notify('warning', 'Ein identischer Druckauftrag lief bereits — es wurde bewusst nicht erneut gedruckt.')
      } else {
        app.notify(
          result.submittedCopies === result.requestedCopies ? 'ok' : 'warning',
          `${result.submittedCopies} von ${result.requestedCopies} Exemplaren an den Drucker übermittelt.`
        )
      }
      setDialog(null)
      setPin('')
      await reload()
    } catch (error) {
      app.reportError(error)
    } finally {
      setBusy(false)
    }
  }

  const checkPrinter = async (): Promise<void> => {
    try {
      const result = await api('print.testPrinter', printerId)
      setStatus(result.message)
      app.notify(result.ok ? 'ok' : 'warning', result.message)
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <div className="grid cols-2">
      <div>
        <Card title="Druckauftrag">
          {!approved && (
            <div className="notice error">
              Der aktuelle Stimmzettel (v{round.ballotVersion}) ist nicht freigegeben. Der Druck ist gesperrt.
            </div>
          )}

          <Field label="Drucker">
            <select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
              {printers.map((entry: PrinterConfig) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.paperWidthMm} mm)
                </option>
              ))}
            </select>
          </Field>
          <div className="row">
            <button onClick={() => void checkPrinter()}>Druckerstatus prüfen</button>
            <button
              disabled={!approved || busy}
              onClick={() => void runPrint('test', 1)}
              title="Der Testdruck ist oben und unten unübersehbar als ungültig gekennzeichnet."
            >
              Testdruck (ungültig)
            </button>
          </div>
          {status && <div className="hint">{status}</div>}

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '16px 0' }} />

          <div className="row">
            <div style={{ flex: 1 }}>
              <Field label="Stimmberechtigte">
                <input value={eligible} readOnly />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Zusatzreserve">
                <NumberInput value={reserve} onChange={setReserve} />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Zu drucken">
                <NumberInput value={copies} min={1} onChange={setCopies} />
              </Field>
            </div>
          </div>
          <div className="hint">
            Geschätzter Papierbedarf: {paper.totalMeters.toFixed(1)} m (ca.{' '}
            {Math.round(paper.millimetersPerBallot)} mm je Stimmzettel).
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <button
              className="primary big"
              disabled={!approved || busy || copies < 1 || !app.can('print.execute')}
              onClick={() => setDialog('mass')}
            >
              {copies} Exemplare drucken
            </button>
            <button
              className="big"
              disabled={!approved || busy || !app.can('print.reprint')}
              onClick={() => setDialog('reprint')}
            >
              Nachdruck
            </button>
          </div>
        </Card>

        {progress && (
          <Card title={`Druckauftrag läuft – ${PRINT_BATCH_STATUS_LABELS[progress.status]}`}>
            <div className="progress" style={{ marginBottom: 10 }}>
              <span
                style={{
                  width: `${Math.round((progress.submittedCopies / Math.max(1, progress.requestedCopies)) * 100)}%`
                }}
              />
            </div>
            <div className="row">
              <span className="badge">Gesamt {progress.requestedCopies}</span>
              <span className="badge accent">Übermittelt {progress.submittedCopies}</span>
              <span className="badge">Fehler {progress.failedCopies}</span>
              <span className="spacer" />
              {progress.status === 'running' && (
                <button
                  className="danger"
                  onClick={async () => {
                    try {
                      await api('print.abort', progress.batchId)
                      app.notify('warning', 'Abbruch angefordert. Bitte anschließend physisch prüfen.')
                    } catch (error) {
                      app.reportError(error)
                    }
                  }}
                >
                  Abbrechen
                </button>
              )}
            </div>
            {progress.errorMessage && <div className="notice warn">{progress.errorMessage}</div>}
            <div className="hint">
              Gezählt wird, was an den Drucker übermittelt wurde. Ob jedes Blatt physisch ausgegeben wurde,
              bestätigt die Wahlkommission nach Sichtprüfung.
            </div>
          </Card>
        )}
      </div>

      {resumeBatch && (
        <Modal
          title="Druckauftrag fortsetzen"
          onClose={() => setResumeBatch(null)}
          actions={
            <>
              <button onClick={() => setResumeBatch(null)}>Abbrechen</button>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const result = await api('print.resume', {
                      batchId: resumeBatch.id,
                      confirmedCopies: resumeCount,
                      printerId,
                      pin: pin || undefined
                    })
                    app.notify(
                      'ok',
                      result.remaining === 0
                        ? 'Es fehlten keine Exemplare. Die geprüfte Menge wurde dokumentiert.'
                        : `${result.submittedCopies} von ${result.remaining} fehlenden Exemplaren nachgedruckt.`
                    )
                    setResumeBatch(null)
                    setPin('')
                    await reload()
                  } catch (error) {
                    app.reportError(error)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {Math.max(0, resumeBatch.requestedCopies - resumeCount)} fehlende Exemplare drucken
              </button>
            </>
          }
        >
          <p>
            Nach einem Papierwechsel oder einer Störung wird nur die Differenz gedruckt — mit derselben
            freigegebenen Version {`v${resumeBatch.ballotVersion}`}.
          </p>
          <table>
            <tbody>
              <tr>
                <th>Ursprünglich angefordert</th>
                <td className="num">{resumeBatch.requestedCopies}</td>
              </tr>
              <tr>
                <th>An den Drucker übermittelt</th>
                <td className="num">{resumeBatch.submittedCopies}</td>
              </tr>
            </tbody>
          </table>
          <Field
            label="Physisch geprüfte, verwendbare Stimmzettel"
            hint="Bitte den Stapel zählen: ein angefangener oder unsauberer Zettel zählt nicht mit."
          >
            <NumberInput
              value={resumeCount}
              min={0}
              max={resumeBatch.requestedCopies}
              onChange={setResumeCount}
            />
          </Field>
          {requirePin && (
            <Field label="Wahlleiter-PIN">
              <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
            </Field>
          )}
          <div className="notice warn">
            Es wird nichts automatisch wiederholt: Gedruckt wird genau die Differenz zu der Menge, die Sie
            soeben gezählt haben.
          </div>
        </Modal>
      )}

      <Card title="Druckaufträge">
        {detail.batches.length === 0 ? (
          <p className="hint">Es wurde noch nichts gedruckt.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Art</th>
                <th className="num">Angef.</th>
                <th className="num">Übermittelt</th>
                <th>Status</th>
                <th>Bediener</th>
              </tr>
            </thead>
            <tbody>
              {detail.batches.map((batch) => (
                <tr key={batch.id}>
                  <td>{formatDateTimeDe(batch.startedAt)}</td>
                  <td>
                    {PRINT_BATCH_KIND_LABELS[batch.kind]}
                    <br />
                    <span className="hint">v{batch.ballotVersion}</span>
                    {batch.reason && <div className="hint">{batch.reason}</div>}
                  </td>
                  <td className="num">{batch.requestedCopies}</td>
                  <td className="num">
                    {batch.submittedCopies}
                    {batch.confirmedCopies !== undefined && (
                      <>
                        <br />
                        <span className="hint">bestätigt {batch.confirmedCopies}</span>
                      </>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        batch.status === 'completed' ? 'ok' : batch.status === 'unknown' ? 'warn' : batch.status === 'failed' ? 'danger' : ''
                      }`}
                    >
                      {PRINT_BATCH_STATUS_LABELS[batch.status]}
                    </span>
                  </td>
                  <td>
                    {batch.operatorName}
                    {(batch.status === 'unknown' || batch.status === 'aborted') && (
                      <div style={{ marginTop: 6 }}>
                        <button
                          onClick={() => {
                            setResumeBatch(batch)
                            setResumeCount(batch.confirmedCopies ?? batch.submittedCopies)
                          }}
                        >
                          Fortsetzen
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {dialog === 'mass' && (
        <Modal
          title="Massendruck bestätigen"
          onClose={() => setDialog(null)}
          actions={
            <>
              <button onClick={() => setDialog(null)}>Abbrechen</button>
              <button className="primary" disabled={busy} onClick={() => void runPrint('initial', copies)}>
                {copies} Stimmzettel drucken
              </button>
            </>
          }
        >
          <table>
            <tbody>
              <tr>
                <th>Wahlgang</th>
                <td>
                  {round.roundLabel} – {round.title}
                </td>
              </tr>
              <tr>
                <th>Kennung</th>
                <td className="mono">{round.roundCode}</td>
              </tr>
              <tr>
                <th>Version</th>
                <td>v{round.ballotVersion} (freigegeben)</td>
              </tr>
              <tr>
                <th>Drucker</th>
                <td>{printer?.name}</td>
              </tr>
              <tr>
                <th>Exemplare</th>
                <td>
                  <strong>{copies}</strong> ({eligible} Stimmberechtigte + {reserve} Reserve)
                </td>
              </tr>
            </tbody>
          </table>
          {requirePin && (
            <Field label="Wahlleiter-PIN" hint="Für den Massendruck ist die PIN erforderlich (Einstellungen).">
              <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus />
            </Field>
          )}
          <div className="notice warn">
            Der Auftrag wird nicht automatisch wiederholt, falls er abbricht. Sie werden dann aufgefordert, die
            tatsächlich ausgegebene Menge physisch zu prüfen.
          </div>
        </Modal>
      )}

      {dialog === 'reprint' && (
        <Modal
          title="Nachdruck / zusätzliche Stimmzettel"
          onClose={() => setDialog(null)}
          actions={
            <>
              <button onClick={() => setDialog(null)}>Abbrechen</button>
              <button
                className="primary"
                disabled={busy || reprintCount < 1}
                onClick={() => void runPrint('reprint', reprintCount, reprintReason)}
              >
                Nachdrucken
              </button>
            </>
          }
        >
          <Field label="Anzahl">
            <NumberInput value={reprintCount} min={1} onChange={setReprintCount} />
          </Field>
          <Field label="Grund" hint="Der Grund wird im Audit-Trail festgehalten.">
            <select value={reprintReason} onChange={(e) => setReprintReason(e.target.value)}>
              {REPRINT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ergänzung (optional)">
            <input
              value={reprintReason}
              onChange={(e) => setReprintReason(e.target.value)}
              placeholder="Freitext zur Präzisierung"
            />
          </Field>
          {requirePin && (
            <Field label="Wahlleiter-PIN">
              <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} />
            </Field>
          )}
          <div className="notice">
            Ersatzstimmzettel bitte anschließend im Reiter „Stimmzettelbilanz“ als Menge dokumentieren — ohne
            Zuordnung zu einer Person.
          </div>
          <div className="hint">
            <strong>Wann ist der Nachdruck der richtige Weg?</strong>
            <br />
            Es fehlen Zettel, einzelne wurden beschädigt oder es erscheint ein weiterer Stimmberechtigter:
            Nachdruck derselben Version {round.approvedVersion !== undefined ? `(v${round.approvedVersion})` : ''} —
            alle Zettel bleiben gleich und tragen dieselbe Kennung.
            <br />
            Ist dagegen der <em>Inhalt</em> falsch (Name, Anzahl, Optionen), muss der Wahlgang entsperrt werden;
            dabei entsteht eine neue Version, und die Stapel dürfen nicht vermischt werden.
            <br />
            Wird die Wahl selbst wiederholt, ist es ein eigener Wahlgang mit eigener Kennung — im Reiter
            „Ergebnis“ über „Folgewahlgang erzeugen“.
          </div>
        </Modal>
      )}
    </div>
  )
}
