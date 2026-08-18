/** Druckvorschau, Prüfliste und Freigabe des Stimmzettels (§10, §16, §17, §30, §42). */
import { useCallback, useEffect, useState } from 'react'
import { formatDateTimeDe } from '@shared/format'
import type { BallotDocument, BallotPreviewRow } from '@shared/types'
import { api } from '../../../lib/api'
import { useApp } from '../../state'
import { Card, Checkbox, Field, Modal, NumberInput } from '../../components/ui'
import type { TabProps } from '../RoundDetailPage'

/**
 * Darstellung des Stimmzettels je Wahlgang. Änderungen sind druckwirksam:
 * nach einer Freigabe entsteht dadurch zwingend eine neue Version (§58).
 */
function LayoutCard({
  detail,
  reload,
  onChanged
}: TabProps & { onChanged: () => void }): React.JSX.Element {
  const app = useApp()
  const round = detail.round
  const [template, setTemplate] = useState(round.template)
  const [busy, setBusy] = useState(false)
  const locked = round.status === 'completed' || round.status === 'cancelled'

  useEffect(() => setTemplate(round.template), [round.rowVersion])

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await api('round.update', { id: round.id, template, rowVersion: round.rowVersion })
      app.notify(
        round.approvedVersion === round.ballotVersion ? 'warning' : 'ok',
        round.approvedVersion === round.ballotVersion
          ? 'Darstellung geändert – es wurde eine neue Wahlzettelversion erzeugt. Bitte erneut freigeben.'
          : 'Darstellung übernommen.'
      )
      await reload()
      onChanged()
    } catch (error) {
      app.reportError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Darstellung">
      <Checkbox
        checked={template.largeCandidates}
        disabled={locked}
        onChange={(value) => setTemplate({ ...template, largeCandidates: value })}
        label="Große Namen und Ankreuzfelder (doppelte Zeilenhoehe)"
      />
      <Checkbox
        checked={template.showCandidateNumbers}
        disabled={locked}
        onChange={(value) => setTemplate({ ...template, showCandidateNumbers: value })}
        label="Kandidatennummern drucken"
      />
      <Checkbox
        checked={template.compactMode}
        disabled={locked}
        onChange={(value) => setTemplate({ ...template, compactMode: value })}
        label="Kompakte Optionszeile (Akzeptanzverfahren)"
      />

      <h3>Optionen auf dem Stimmzettel</h3>
      <div className="hint" style={{ marginBottom: 8 }}>
        Ob „Nein" und „Enthaltung" aufgedruckt werden, richtet sich nach der geltenden Wahlordnung — die
        Anwendung erzwingt hier nichts. Bei Gruppenwahlen beziehen sich beide Angaben auf alle Bewerber
        gemeinsam und stehen deshalb am Ende des Zettels, nie hinter einzelnen Namen.
      </div>
      <Checkbox
        checked={template.allowYes}
        disabled={locked}
        onChange={(value) => setTemplate({ ...template, allowYes: value })}
        label="JA aufdrucken"
      />
      <Checkbox
        checked={template.allowNo}
        disabled={locked}
        onChange={(value) => setTemplate({ ...template, allowNo: value })}
        label="NEIN aufdrucken"
      />
      <Checkbox
        checked={template.allowAbstention}
        disabled={locked}
        onChange={(value) => setTemplate({ ...template, allowAbstention: value })}
        label="ENTHALTUNG aufdrucken"
      />
      <div className="row">
        <div style={{ width: 240 }}>
          <Field
            label="Stimmen je Bewerber (Kumulieren)"
            hint="1 = eine Stimme je Bewerber. Höhere Werte drucken entsprechend viele Ankreuzfelder."
          >
            <NumberInput
              value={template.votesPerCandidate}
              min={1}
              max={Math.max(1, round.maxVotes ?? 1)}
              disabled={locked}
              onChange={(value) => setTemplate({ ...template, votesPerCandidate: Math.max(1, value) })}
            />
          </Field>
        </div>
        <div style={{ width: 200 }}>
          <Field label="Leerzeilen zwischen Personen">
            <NumberInput
              value={template.candidateSpacingLines}
              min={0}
              max={4}
              disabled={locked}
              onChange={(value) => setTemplate({ ...template, candidateSpacingLines: value })}
            />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Wahlanweisung">
            <input
              value={template.instructionText}
              disabled={locked}
              onChange={(e) => setTemplate({ ...template, instructionText: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <div className="row">
        <button className="primary" disabled={busy || locked} onClick={() => void save()}>
          Darstellung übernehmen
        </button>
        <span className="hint">Mehr Abstand und größere Schrift verbrauchen mehr Papier.</span>
      </div>
    </Card>
  )
}

const CHECKLIST: { key: string; label: string }[] = [
  { key: 'round', label: 'Wahlgang und Bezeichnung sind korrekt' },
  { key: 'candidates', label: 'Alle Kandidatennamen sind richtig geschrieben' },
  { key: 'seats', label: 'Anzahl der zu besetzenden Positionen stimmt' },
  { key: 'maxVotes', label: 'Maximale Stimmenzahl stimmt' },
  { key: 'options', label: 'Nein-/Enthaltungs-/Ja-Optionen entsprechen der Wahlordnung' },
  { key: 'roundCode', label: 'Wahlgangkennung ist korrekt' }
]

export function BallotTab({ detail, reload }: TabProps): React.JSX.Element {
  const app = useApp()
  const round = detail.round
  const [preview, setPreview] = useState<{
    document: BallotDocument
    lines: string[]
    rows: BallotPreviewRow[]
    hash: string
  } | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [showApprove, setShowApprove] = useState(false)

  const load = useCallback(async () => {
    try {
      setPreview(await api('ballot.preview', round.id))
    } catch (error) {
      app.reportError(error)
    }
  }, [round.id, round.ballotVersion, round.rowVersion])

  useEffect(() => {
    void load()
  }, [load])

  const approved = round.approvedVersion === round.ballotVersion
  const printed = detail.batches.some(
    (batch) => batch.ballotVersion === round.ballotVersion && batch.kind !== 'test' && batch.submittedCopies > 0
  )

  return (
    <div className="grid cols-2">
      <Card
        title="Druckvorschau (80 mm)"
        actions={<button onClick={() => void load()}>Aktualisieren</button>}
      >
        <div className="ballot-frame">
          <div className="ballot-preview">
            {preview
              ? preview.rows.map((row, index) =>
                  row.cut ? (
                    <div key={index} className="ballot-cut">
                      {row.text}
                    </div>
                  ) : (
                    <div
                      key={index}
                      className={`ballot-line${row.large ? ' large' : ''}${row.bold ? ' bold' : ''}${
                        row.invert ? ' invert' : ''
                      }`}
                      style={row.align ? { textAlign: row.align } : undefined}
                    >
                      {row.text === '' ? ' ' : row.text}
                    </div>
                  )
                )
              : 'Vorschau wird erzeugt …'}
          </div>
        </div>
        <div className="hint" style={{ marginTop: 10 }}>
          Die Vorschau entsteht aus derselben Vorlage, die auch gedruckt wird. Alle Stimmzettel dieses Wahlgangs
          sind identisch und tragen dieselbe Kennung – es gibt keine Einzelnummerierung.
        </div>
        {round.ballotVersion > 1 && (
          <div className="notice warn">
            Dies ist Fassung v{round.ballotVersion}. Ab der zweiten Fassung wird die Versionsnummer immer auf den
            Stimmzettel gedruckt, damit sich die Stapel unterscheiden lassen. Zettel früherer Fassungen dürfen
            nicht mehr ausgegeben werden.
          </div>
        )}
      </Card>

      <div>
        <Card title="Freigabe">
          {!round.candidatesLockedAt && (
            <div className="notice warn">
              Die Kandidatenliste ist noch offen. Bitte zuerst im Reiter „Kandidaten“ schließen.
            </div>
          )}
          {approved ? (
            <div className="notice ok">
              Version v{round.ballotVersion} ist freigegeben. Der Druck ist möglich.
            </div>
          ) : (
            <div className="notice warn">
              Version v{round.ballotVersion} ist nicht freigegeben. Vor dem Druck ist die Freigabe zwingend.
            </div>
          )}

          {CHECKLIST.map((item) => (
            <Checkbox
              key={item.key}
              checked={checked.includes(item.key)}
              disabled={approved || !round.candidatesLockedAt}
              onChange={(value) =>
                setChecked((current) =>
                  value ? [...current, item.key] : current.filter((entry) => entry !== item.key)
                )
              }
              label={item.label}
            />
          ))}

          <div className="row" style={{ marginTop: 14 }}>
            <button
              className="primary big"
              disabled={
                approved ||
                !round.candidatesLockedAt ||
                checked.length < CHECKLIST.length ||
                !app.can('ballot.approve')
              }
              onClick={() => setShowApprove(true)}
            >
              Wahlzettel freigeben
            </button>
          </div>

          {preview && (
            <div className="hint" style={{ marginTop: 12 }}>
              Aktueller Hash (SHA-256) der Vorlage:
              <div className="mono">{preview.hash}</div>
            </div>
          )}
        </Card>

        <LayoutCard detail={detail} reload={reload} onChanged={() => void load()} />

        <Card title="Versionen">
          {detail.versions.length === 0 ? (
            <p className="hint">Noch keine Version freigegeben.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Freigabe</th>
                  <th>Hash</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {detail.versions.map((version) => (
                  <tr key={version.id}>
                    <td>v{version.version}</td>
                    <td>
                      {version.approvedAt ? (
                        <>
                          {formatDateTimeDe(version.approvedAt)}
                          <br />
                          <span className="hint">{version.approvedByName}</span>
                        </>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="mono">{version.ballotHash.slice(0, 12)}…</td>
                    <td>
                      {version.supersededAt ? (
                        <span className="badge warn">abgelöst</span>
                      ) : (
                        <span className="badge ok">aktuell</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {printed && (
            <div className="notice">
              Von dieser Version wurden bereits Stimmzettel gedruckt. Eine Änderung erzeugt zwingend eine neue
              Version; die Stapel dürfen nicht vermischt werden.
            </div>
          )}
        </Card>
      </div>

      {showApprove && preview && (
        <Modal
          title="Wahlzettel freigeben"
          onClose={() => setShowApprove(false)}
          actions={
            <>
              <button onClick={() => setShowApprove(false)}>Abbrechen</button>
              <button
                className="primary"
                onClick={async () => {
                  try {
                    const version = await api('ballot.approve', { roundId: round.id, checklist: checked })
                    app.notify('ok', `Wahlzettel v${version.version} freigegeben.`)
                    setShowApprove(false)
                    setChecked([])
                    await reload()
                  } catch (error) {
                    app.reportError(error)
                  }
                }}
              >
                Freigeben
              </button>
            </>
          }
        >
          <table>
            <tbody>
              <tr>
                <th>Wahlgang</th>
                <td>{round.title}</td>
              </tr>
              <tr>
                <th>Kandidaten / Optionen</th>
                <td>{preview.document.sections.reduce((sum, section) => sum + section.candidates.length, 0)}</td>
              </tr>
              <tr>
                <th>Positionen</th>
                <td>{round.seats}</td>
              </tr>
              <tr>
                <th>Maximale Stimmen</th>
                <td>{round.maxVotes === null ? 'keine feste Höchstzahl' : round.maxVotes}</td>
              </tr>
              <tr>
                <th>Wahlgangkennung</th>
                <td className="mono">{round.roundCode}</td>
              </tr>
              <tr>
                <th>Version</th>
                <td>v{round.ballotVersion}</td>
              </tr>
            </tbody>
          </table>
          <div className="notice">
            Nach der Freigabe führt jede Änderung zu einer neuen Version. Die freigegebene Fassung wird mit
            Hash archiviert.
          </div>
        </Modal>
      )}
    </div>
  )
}
