/** Stimmzettelbilanz (§22, §23). Nur Mengen – niemals Personenbezug. */
import { useEffect, useState } from 'react'
import { availableBallots, checkAccounting, expectedInBox } from '@shared/accounting'
import { api } from '../../../lib/api'
import { useApp } from '../../state'
import { Card, Field, Kpi, NumberInput } from '../../components/ui'
import type { TabProps } from '../RoundDetailPage'

export function AccountingTab({ detail, reload }: TabProps): React.JSX.Element {
  const app = useApp()
  const accounting = detail.accounting

  const [issued, setIssued] = useState(accounting.issued)
  const [replacements, setReplacements] = useState(accounting.replacementsIssued)
  const [returned, setReturned] = useState(accounting.returnedSpoiled)
  const [unused, setUnused] = useState(accounting.unused)
  const [inBox, setInBox] = useState(accounting.ballotsInBox ?? 0)
  const [trackBox, setTrackBox] = useState(accounting.ballotsInBox !== undefined)

  useEffect(() => {
    setIssued(accounting.issued)
    setReplacements(accounting.replacementsIssued)
    setReturned(accounting.returnedSpoiled)
    setUnused(accounting.unused)
    setInBox(accounting.ballotsInBox ?? 0)
    setTrackBox(accounting.ballotsInBox !== undefined)
  }, [accounting])

  const preview = {
    ...accounting,
    issued,
    replacementsIssued: replacements,
    returnedSpoiled: returned,
    unused,
    ballotsInBox: trackBox ? inBox : undefined
  }
  const checks = checkAccounting(preview, app.event?.eligibleVoterCount)

  const save = async (): Promise<void> => {
    try {
      await api('accounting.save', {
        electionRoundId: detail.round.id,
        issued,
        replacementsIssued: replacements,
        returnedSpoiled: returned,
        unused,
        ballotsInBox: trackBox ? inBox : undefined
      })
      app.notify('ok', 'Stimmzettelbilanz gespeichert.')
      await reload()
    } catch (error) {
      app.reportError(error)
    }
  }

  return (
    <div className="grid cols-2">
      <Card title="Erfassung">
        <div className="notice">
          Es werden ausschließlich Mengen dokumentiert. Eine Zuordnung, welche Person welchen Stimmzettel
          erhalten hat, existiert im System nicht und darf nicht erfasst werden.
        </div>
        <Field label="Ausgegebene Stimmzettel">
          <NumberInput value={issued} onChange={setIssued} />
        </Field>
        <div className="row">
          <div style={{ flex: 1 }}>
            <Field label="Ersatzstimmzettel ausgegeben">
              <NumberInput value={replacements} onChange={setReplacements} />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Zurückgenommen / vernichtet">
              <NumberInput value={returned} onChange={setReturned} />
            </Field>
          </div>
        </div>
        <div className="row">
          <div style={{ flex: 1 }}>
            <Field label="Unbenutzte Stimmzettel">
              <NumberInput value={unused} onChange={setUnused} />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="In der Urne gezählt">
              <NumberInput value={inBox} disabled={!trackBox} onChange={setInBox} />
            </Field>
            <div className="field-inline">
              <input type="checkbox" checked={trackBox} onChange={(e) => setTrackBox(e.target.checked)} />
              <label>Urnenzählung dokumentieren</label>
            </div>
          </div>
        </div>
        <button className="primary big" disabled={!app.can('accounting.edit')} onClick={() => void save()}>
          Bilanz speichern
        </button>
      </Card>

      <div>
        <Card title="Rechnerischer Stand">
          <div className="grid cols-3">
            <Kpi label="Gedruckt" value={accounting.printed} />
            <Kpi label="Fehl-/unklar" value={accounting.printFailures} tone={accounting.printFailures ? 'warn' : undefined} />
            <Kpi label="Testdrucke" value={accounting.testPrints} />
            <Kpi label="Verfuegbar" value={availableBallots(preview)} />
            <Kpi label="Erwartet in Urne" value={expectedInBox(preview)} />
            <Kpi label="Ausgegeben" value={issued} />
          </div>
        </Card>

        <Card title="Plausibilität">
          {checks.map((check, index) => (
            <div
              key={index}
              className={`notice ${check.level === 'warning' ? 'warn' : check.level === 'ok' ? 'ok' : ''}`}
            >
              {check.message}
            </div>
          ))}
          <div className="hint">
            Abweichungen werden nur markiert. Die Bewertung und etwaige Maßnahmen obliegen der Wahlleitung.
          </div>
        </Card>
      </div>
    </div>
  )
}
