/**
 * Wahlgang-Assistent (§9, Wahlformen §47).
 *
 * Wichtig: Aus dem Wahlzweck folgt KEIN Verfahren. Das Verfahren beschliesst die
 * Versammlung und wird hier ausdrücklich abgefragt (Wahlformen §46).
 */
import { useMemo, useState } from 'react'
import { defaultTemplateFor, parseCandidateBlock, profileFor, validateRoundSetup } from '@shared/election'
import { buildRoundCode, roundLabelFor } from '@shared/format'
import {
  PROCEDURE_LABELS,
  PROCEDURES,
  PURPOSE_LABELS,
  PURPOSES,
  type BallotTemplateConfig,
  type CandidateOrderMode,
  type ElectionProcedure,
  type ElectionPurpose
} from '@shared/types'
import { CANDIDATE_ORDER_LABELS, CANDIDATE_ORDER_MODES } from '@shared/types'
import { api } from '../../lib/api'
import { navigate } from '../App'
import { useApp } from '../state'
import { Card, Checkbox, Field, NumberInput } from '../components/ui'

const STEPS = ['Wahlzweck', 'Verfahren', 'Parameter', 'Kandidaten', 'Prüfung'] as const

export function RoundWizardPage(): React.JSX.Element {
  const app = useApp()
  const event = app.event

  const [step, setStep] = useState(0)
  const [purpose, setPurpose] = useState<ElectionPurpose>('delegate')
  const [procedure, setProcedure] = useState<ElectionProcedure>('group_preprinted')
  const [title, setTitle] = useState('')
  // Solange die Bezeichnung nicht von Hand geändert wurde, folgt sie dem
  // gewählten Wahlzweck – sonst bliebe eine zuvor gesetzte stehen.
  const [titleTouched, setTitleTouched] = useState(false)
  const [seats, setSeats] = useState(1)
  const [maxVotes, setMaxVotes] = useState<number | null>(1)
  const [unlimitedVotes, setUnlimitedVotes] = useState(false)
  const [seatStart, setSeatStart] = useState<number | undefined>(undefined)
  const [seatEnd, setSeatEnd] = useState<number | undefined>(undefined)
  const [orderMode, setOrderMode] = useState<CandidateOrderMode>('manual')
  const [candidateText, setCandidateText] = useState('')
  const [positionText, setPositionText] = useState('')
  const [motionText, setMotionText] = useState('')
  const [instructions, setInstructions] = useState('')
  const [roundLabel, setRoundLabel] = useState('')
  const [showNumbers, setShowNumbers] = useState(false)
  const [busy, setBusy] = useState(false)

  const profile = profileFor(procedure)
  const parsedCandidates = useMemo(() => parseCandidateBlock(candidateText), [candidateText])
  const parsedPositions = useMemo(
    () =>
      positionText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [positionText]
  )

  const nextSequential = (app.rounds.at(-1)?.sequentialNumber ?? 0) + 1
  const effectiveLabel = roundLabel.trim() || roundLabelFor(nextSequential)
  const roundCode = event ? buildRoundCode(event.orgCode, event.date, effectiveLabel) : ''

  const template: BallotTemplateConfig = useMemo(() => {
    const base = defaultTemplateFor(procedure, {
      seats,
      maxVotes: unlimitedVotes ? null : maxVotes,
      entryCount: parsedCandidates.length
    })
    return {
      ...base,
      showCandidateNumbers: showNumbers || base.showCandidateNumbers,
      instructionText: instructions.trim() || base.instructionText,
      motionText: motionText.trim() || undefined
    }
  }, [procedure, seats, maxVotes, unlimitedVotes, parsedCandidates.length, showNumbers, instructions, motionText])

  const issues = useMemo(
    () =>
      validateRoundSetup(
        {
          procedure,
          seats,
          maxVotes: unlimitedVotes ? null : maxVotes,
          title: title || PURPOSE_LABELS[purpose],
          template,
          positions: parsedPositions.map((positionTitle, index) => ({
            id: `tmp-${index}`,
            title: positionTitle,
            candidateIds: []
          })),
          seatStart,
          seatEnd
        },
        profile.entryKind === 'positions'
          ? parsedCandidates.map((candidate, index) => ({
              displayName: candidate.displayName,
              withdrawn: false,
              positionId: `tmp-${index}`
            }))
          : parsedCandidates.map((candidate) => ({ displayName: candidate.displayName, withdrawn: false }))
      ),
    [
      procedure,
      seats,
      maxVotes,
      unlimitedVotes,
      title,
      purpose,
      template,
      parsedPositions,
      parsedCandidates,
      profile.entryKind,
      seatStart,
      seatEnd
    ]
  )

  if (!event) {
    return (
      <Card title="Keine aktive Veranstaltung">
        <p>Bitte zuerst eine Veranstaltung anlegen und aktivieren.</p>
        <button className="primary" onClick={() => navigate('event')}>
          Zur Veranstaltung
        </button>
      </Card>
    )
  }

  const applyProcedure = (next: ElectionProcedure): void => {
    setProcedure(next)
    const nextProfile = profileFor(next)
    const nextSeats = nextProfile.multiSeat ? seats : 1
    setSeats(nextSeats)
    const suggested = nextProfile.defaultMaxVotes(nextSeats)
    setUnlimitedVotes(suggested === null)
    setMaxVotes(suggested)
  }

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const round = await api('round.create', {
        eventId: event.id,
        title: title.trim() || PURPOSE_LABELS[purpose],
        purpose,
        procedure,
        seats,
        maxVotes: unlimitedVotes ? null : maxVotes,
        seatStart,
        seatEnd,
        roundLabel: effectiveLabel,
        template,
        orderMode,
        positions: profile.entryKind === 'positions' ? parsedPositions.map((t) => ({ title: t })) : undefined
      })

      if (parsedCandidates.length > 0) {
        await api('candidate.add', {
          roundId: round.id,
          candidates: parsedCandidates.map((candidate, index) => ({
            firstName: candidate.firstName,
            lastName: candidate.lastName,
            displayName: candidate.displayName,
            ballotNumber: template.showCandidateNumbers ? index + 1 : undefined
          }))
        })
      }

      await app.refreshRounds()
      app.notify('ok', `Wahlgang ${round.roundLabel} angelegt (${round.roundCode}).`)
      navigate(`round/${round.id}/candidates`)
    } catch (error) {
      app.reportError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Neuer Wahlgang</h1>
          <div className="subtitle">
            {event.title} &middot; {event.organization}
          </div>
        </div>
        <span className="badge accent">Kennung {roundCode}</span>
      </div>

      <div className="steps">
        {STEPS.map((label, index) => (
          <span key={label} className={`step${index === step ? ' active' : index < step ? ' done' : ''}`}>
            {index + 1}. {label}
          </span>
        ))}
      </div>

      {step === 0 && (
        <Card title="Wahlzweck">
          <p className="hint">
            Der Zweck beschreibt, worum es fachlich geht. Er legt das Wahlverfahren ausdrücklich nicht fest.
          </p>
          <div className="grid cols-3">
            {PURPOSES.map((value) => (
              <button
                key={value}
                className={purpose === value ? 'primary' : ''}
                onClick={() => {
                  setPurpose(value)
                  if (!titleTouched) setTitle(PURPOSE_LABELS[value])
                }}
              >
                {PURPOSE_LABELS[value]}
              </button>
            ))}
          </div>
          <Field
            label="Bezeichnung des Wahlgangs"
            hint="Erscheint auf dem Stimmzettel und im Protokoll. Folgt dem Wahlzweck, bis Sie sie selbst anpassen."
          >
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setTitleTouched(true)
              }}
              placeholder={PURPOSE_LABELS[purpose]}
            />
          </Field>
        </Card>
      )}

      {step === 1 && (
        <Card title="Wahlverfahren">
          <div className="notice warn">
            Welche Wahlform hat die Versammlung beschlossen? Die Software leitet aus der Zahl der Positionen
            bewusst kein Verfahren ab.
          </div>
          <div className="grid cols-2">
            {PROCEDURES.map((value) => (
              <button
                key={value}
                className={procedure === value ? 'primary' : ''}
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => applyProcedure(value)}
              >
                {PROCEDURE_LABELS[value]}
              </button>
            ))}
          </div>
          {!profile.ballotRequired && (
            <div className="notice" style={{ marginTop: 12 }}>
              Für eine offene Abstimmung wird kein Stimmzettel erzeugt. Es wird lediglich das Ergebnis
              dokumentiert.
            </div>
          )}
        </Card>
      )}

      {step === 2 && (
        <Card title="Parameter">
          <div className="row">
            <div style={{ flex: 1 }}>
              <Field
                label="Zu besetzende Positionen"
                hint={profile.multiSeat ? undefined : 'Dieses Verfahren sieht genau eine Position vor.'}
              >
                <NumberInput
                  value={seats}
                  min={1}
                  disabled={!profile.multiSeat}
                  onChange={(value) => {
                    setSeats(value)
                    if (!unlimitedVotes) setMaxVotes(profile.defaultMaxVotes(value) ?? value)
                  }}
                />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Maximale Stimmenzahl">
                <NumberInput
                  value={maxVotes ?? 0}
                  min={1}
                  disabled={unlimitedVotes}
                  onChange={(value) => setMaxVotes(value)}
                />
              </Field>
              <Checkbox
                checked={unlimitedVotes}
                onChange={setUnlimitedVotes}
                label="Keine feste Höchstzahl (z. B. Zwei-Stufen-Wahl, Stufe 1)"
              />
            </div>
          </div>

          {(procedure === 'two_stage_stage_2_block' || procedure === 'two_stage_stage_2_single') && (
            <div className="row">
              <div style={{ flex: 1 }}>
                <Field label="Erster Listenplatz">
                  <NumberInput value={seatStart ?? 0} onChange={(value) => setSeatStart(value || undefined)} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Letzter Listenplatz">
                  <NumberInput value={seatEnd ?? 0} onChange={(value) => setSeatEnd(value || undefined)} />
                </Field>
              </div>
            </div>
          )}

          {profile.entryKind === 'positions' && (
            <Field
              label="Positionen (eine je Zeile)"
              hint="Jede Position ist logisch eine eigenständige Einzelwahl auf demselben Stimmzettel."
            >
              <textarea
                value={positionText}
                onChange={(e) => setPositionText(e.target.value)}
                placeholder={'Schatzmeister\nSchriftfuehrer\nBeisitzer 1'}
              />
            </Field>
          )}

          {(purpose === 'motion' || procedure === 'yes_no_abstain' || procedure === 'alternative_choice') && (
            <Field label="Antrags-/Beschlusstext (optional)">
              <textarea value={motionText} onChange={(e) => setMotionText(e.target.value)} />
            </Field>
          )}

          <Field label="Wahlanweisung" hint="Wird automatisch erzeugt und kann angepasst werden.">
            <input
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={template.instructionText}
            />
          </Field>

          <div className="row">
            <div style={{ flex: 1 }}>
              <Field label="Kandidatenreihenfolge">
                <select value={orderMode} onChange={(e) => setOrderMode(e.target.value as CandidateOrderMode)}>
                  {CANDIDATE_ORDER_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {CANDIDATE_ORDER_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Wahlgangnummer" hint={`Vorschlag: ${roundLabelFor(nextSequential)}`}>
                <input
                  value={roundLabel}
                  onChange={(e) => setRoundLabel(e.target.value.toUpperCase())}
                  placeholder={roundLabelFor(nextSequential)}
                />
              </Field>
            </div>
          </div>
          <Checkbox
            checked={showNumbers || template.showCandidateNumbers}
            onChange={setShowNumbers}
            label="Kandidatennummern auf dem Stimmzettel drucken"
          />
        </Card>
      )}

      {step === 3 && (
        <Card title={profile.entryKind === 'options' ? 'Wahloptionen' : 'Kandidaten'}>
          {profile.entryKind === 'none' && !profile.blankLines ? (
            <p>Dieses Verfahren benötigt keine Kandidatenliste.</p>
          ) : (
            <Field
              label="Schnellerfassung – ein Eintrag je Zeile"
              hint={'Unterstützt "Max Mustermann" und "Mustermann, Max". Mehrere Namen können eingefügt werden.'}
            >
              <textarea
                value={candidateText}
                onChange={(e) => setCandidateText(e.target.value)}
                placeholder={'Max Mustermann\nErika Musterfrau\nPeter Beispiel'}
                style={{ minHeight: 220 }}
                autoFocus
              />
            </Field>
          )}
          <div className="row">
            <span className="badge">{parsedCandidates.length} Einträge erkannt</span>
            {parsedCandidates.slice(0, 6).map((candidate, index) => (
              <span key={index} className="badge">
                {candidate.displayName}
              </span>
            ))}
            {parsedCandidates.length > 6 && <span className="badge">…</span>}
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card title="Prüfung">
          <table>
            <tbody>
              <tr>
                <th>Bezeichnung</th>
                <td>{title || PURPOSE_LABELS[purpose]}</td>
              </tr>
              <tr>
                <th>Wahlzweck</th>
                <td>{PURPOSE_LABELS[purpose]}</td>
              </tr>
              <tr>
                <th>Verfahren</th>
                <td>{PROCEDURE_LABELS[procedure]}</td>
              </tr>
              <tr>
                <th>Positionen</th>
                <td>{seats}</td>
              </tr>
              <tr>
                <th>Maximale Stimmen</th>
                <td>{unlimitedVotes ? 'keine feste Höchstzahl' : maxVotes}</td>
              </tr>
              <tr>
                <th>Kandidaten / Optionen</th>
                <td>{parsedCandidates.length}</td>
              </tr>
              <tr>
                <th>Wahlgangkennung</th>
                <td className="mono">{roundCode}</td>
              </tr>
              <tr>
                <th>Wahlordnung</th>
                <td>
                  {event.ruleSet.name} – {event.ruleSet.version}
                </td>
              </tr>
            </tbody>
          </table>

          {issues.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {issues.map((issue, index) => (
                <div key={index} className={`notice ${issue.level === 'error' ? 'error' : 'warn'}`}>
                  {issue.message}
                </div>
              ))}
            </div>
          )}

          <div className="notice">
            Nach dem Anlegen können Kandidaten weiter bearbeitet werden. Erst das Schließen der Liste und die
            anschliessende Freigabe machen den Stimmzettel druckbar.
          </div>
        </Card>
      )}

      <div className="row">
        <button disabled={step === 0} onClick={() => setStep((current) => current - 1)}>
          Zurück
        </button>
        {step < STEPS.length - 1 ? (
          <button className="primary big" onClick={() => setStep((current) => current + 1)}>
            Weiter
          </button>
        ) : (
          <button
            className="primary big"
            disabled={busy || issues.some((issue) => issue.level === 'error')}
            onClick={() => void create()}
          >
            Wahlgang anlegen
          </button>
        )}
        <span className="spacer" />
        <button className="ghost" onClick={() => navigate('dashboard')}>
          Abbrechen
        </button>
      </div>
    </>
  )
}
