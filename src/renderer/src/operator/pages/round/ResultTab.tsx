/**
 * Ergebniserfassung, Feststellung und Folgewahlgang (§24–§27, Beamer §14/§74).
 *
 * Die Software rechnet und schlaegt vor — die Feststellung trifft ausschließlich
 * die Wahlleitung und wird ausdrücklich bestätigt.
 */
import { useEffect, useMemo, useState } from 'react'
import { checkResultPlausibility } from '@shared/accounting'
import { profileFor } from '@shared/election'
import { FINAL_DECISION_LABELS, type FinalDecision } from '@shared/projection'
import {
  acceptanceQualified,
  availableDecisions,
  isMotionProcedure,
  rankCandidates,
  resultInputKind,
  suggestDecision,
  validateResult,
  type ResultInputKind
} from '@shared/result'
import {
  DECLARATION_SUGGESTIONS,
  type CandidateResult,
  type CountingMode,
  type ElectionResult,
  type ResultData
} from '@shared/types'
import { api } from '../../../lib/api'
import { navigate } from '../../App'
import { useApp } from '../../state'
import { Card, Checkbox, ConfirmDialog, Field, Modal, NumberInput } from '../../components/ui'
import type { TabProps } from '../RoundDetailPage'

export function ResultTab({ detail, reload }: TabProps): React.JSX.Element {
  const app = useApp()
  const round = detail.round
  const kind = resultInputKind(round)
  const profile = profileFor(round.procedure)
  const existing = detail.result

  const activeCandidates = detail.candidates.filter((candidate) => !candidate.withdrawn)

  const [ballotsCast, setBallotsCast] = useState(existing?.ballotsCast ?? 0)
  const [invalidBallots, setInvalidBallots] = useState(existing?.invalidBallots ?? 0)
  const [rows, setRows] = useState<CandidateResult[]>(() => initialRows(existing, activeCandidates, kind))
  const [globalYes, setGlobalYes] = useState(existing?.resultData.yes ?? 0)
  const [globalNo, setGlobalNo] = useState(existing?.resultData.no ?? 0)
  const [globalAbstentions, setGlobalAbstentions] = useState(existing?.resultData.abstentions ?? 0)
  const [determination, setDetermination] = useState(existing?.determination ?? '')
  const [decision, setDecision] = useState<FinalDecision | ''>(existing?.finalDecision ?? '')
  const [elected, setElected] = useState<string[]>(existing?.electedCandidateIds ?? [])
  const [lotDecision, setLotDecision] = useState(existing?.lotDecision ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [countingMode, setCountingMode] = useState<CountingMode>(existing?.countingMode ?? 'counted')
  const [declaration, setDeclaration] = useState(existing?.declaration ?? '')
  const [pin, setPin] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [showReopen, setShowReopen] = useState(false)
  const [showEmergency, setShowEmergency] = useState(false)
  const [showFollowUp, setShowFollowUp] = useState(false)

  useEffect(() => {
    setRows(initialRows(detail.result, activeCandidates, kind))
    setBallotsCast(detail.result?.ballotsCast ?? 0)
    setInvalidBallots(detail.result?.invalidBallots ?? 0)
    setGlobalYes(detail.result?.resultData.yes ?? 0)
    setGlobalNo(detail.result?.resultData.no ?? 0)
    setGlobalAbstentions(detail.result?.resultData.abstentions ?? 0)
    setCountingMode(detail.result?.countingMode ?? 'counted')
    setDeclaration(detail.result?.declaration ?? '')
    setDetermination(detail.result?.determination ?? '')
    setDecision(detail.result?.finalDecision ?? '')
    setElected(detail.result?.electedCandidateIds ?? [])
    setLotDecision(detail.result?.lotDecision ?? '')
  }, [detail.result, detail.candidates, kind])

  /*
   * Bei einer offenen Abstimmung (Handzeichen, Stimmkarte) gibt es keine
   * Stimmzettel: dort werden ausschließlich Stimmen gezählt, und die Summen
   * ergeben sich daraus. Nur bei geheimer Abstimmung mit Stimmzettel sind
   * abgegebene und ungültige Zettel zu erfassen.
   */
  const withoutBallots = !profile.ballotRequired
  const openVoteTotal = globalYes + globalNo + globalAbstentions
  const effectiveBallotsCast = withoutBallots ? openVoteTotal : ballotsCast
  const effectiveInvalid = withoutBallots ? 0 : invalidBallots
  const validBallots = Math.max(0, effectiveBallotsCast - effectiveInvalid)

  const resultData: ResultData = useMemo(
    () => ({
      candidates: rows,
      yes: kind === 'global_only' || round.procedure === 'single_candidate' ? globalYes : undefined,
      no: kind !== 'yes_no_abstain' ? globalNo : undefined,
      // Beim Akzeptanzverfahren gibt es Enthaltungen nur je Bewerber. Eine
      // globale Null erschien sonst als einsame Kachel auf dem Beamer.
      abstentions: kind === 'yes_no_abstain' ? undefined : globalAbstentions
    }),
    [rows, globalYes, globalNo, globalAbstentions, kind, round.procedure]
  )

  const issues = validateResult(round, resultData, {
    ballotsCast: effectiveBallotsCast,
    validBallots,
    invalidBallots: effectiveInvalid
  })
  // Ohne Stimmzettel gibt es auch keine Stimmzettelbilanz, mit der zu
  // vergleichen wäre.
  const plausibility = withoutBallots
    ? []
    : checkResultPlausibility(detail.accounting, ballotsCast, validBallots, invalidBallots)
  const suggestion = useMemo(
    () => suggestDecision(round, resultData, { validBallots }),
    [round, resultData, validBallots]
  )
  const ranked = useMemo(() => rankCandidates(rows, round.seats), [rows, round.seats])
  const electedWithoutVotes = ranked.filter(
    (candidate) => elected.includes(candidate.candidateId) && (candidate.votes ?? candidate.yes ?? 0) === 0
  )
  // Akzeptanzverfahren: als gewählt markiert, obwohl Nein überwiegt.
  const electedWithoutMajority = profile.perCandidateChoice
    ? ranked.filter(
        (candidate) =>
          elected.includes(candidate.candidateId) &&
          (candidate.yes ?? 0) > 0 &&
          !acceptanceQualified(candidate)
      )
    : []

  const confirmed = Boolean(existing?.confirmedAt)
  const roundClosed = round.status === 'completed' || round.status === 'cancelled'

  const setRow = (candidateId: string, patch: Partial<CandidateResult>): void => {
    setRows((current) =>
      current.map((row) => (row.candidateId === candidateId ? { ...row, ...patch } : row))
    )
  }

  /*
   * Weicht das Formular vom gespeicherten Stand ab? Die Feststellung (wer ist
   * gewählt) steht in einer anderen Karte als der Speichern-Knopf — ohne diese
   * Prüfung ließe sich der alte Stand veröffentlichen, während auf dem
   * Bildschirm die Korrektur steht.
   */
  const dirty = useMemo(() => {
    if (!existing) return true
    const gespeicherteGewaehlte = existing.electedCandidateIds ?? []
    const gleicheGewaehlte =
      gespeicherteGewaehlte.length === elected.length &&
      gespeicherteGewaehlte.every((id) => elected.includes(id))
    return (
      !gleicheGewaehlte ||
      (existing.finalDecision ?? '') !== decision ||
      (existing.determination ?? '') !== determination ||
      (existing.lotDecision ?? '') !== lotDecision ||
      (existing.note ?? '') !== note ||
      (existing.declaration ?? '') !== declaration ||
      (existing.countingMode ?? 'counted') !== countingMode ||
      existing.ballotsCast !== effectiveBallotsCast ||
      existing.invalidBallots !== effectiveInvalid ||
      JSON.stringify(existing.resultData) !== JSON.stringify(resultData)
    )
  }, [
    existing,
    elected,
    decision,
    determination,
    lotDecision,
    note,
    declaration,
    countingMode,
    effectiveBallotsCast,
    effectiveInvalid,
    resultData
  ])

  const save = async (): Promise<boolean> => {
    try {
      await api('result.save', {
        electionRoundId: round.id,
        countingMode,
        declaration: countingMode === 'declared' ? declaration : undefined,
        eligibleVoters: app.event?.eligibleVoterCount,
        ballotsCast: effectiveBallotsCast,
        validBallots,
        invalidBallots: effectiveInvalid,
        resultData,
        note,
        determination,
        finalDecision: decision || undefined,
        electedCandidateIds: elected,
        lotDecision: lotDecision || undefined
      })
      app.notify('ok', 'Ergebnis gespeichert. Es ist noch nicht öffentlich.')
      await reload()
      return true
    } catch (error) {
      app.reportError(error)
      return false
    }
  }

  return (
    <div className="grid cols-2">
      <div>
        <Card title="Auszählung erfassen">
          {confirmed && (
            <div className="notice ok">
              Das Ergebnis ist bestätigt und wird auf dem Beamer angezeigt. Eine Korrektur ist nur über{' '}
              {roundClosed ? '„Notfallkorrektur“' : '„Ergebnis zur Überprüfung öffnen“'} möglich – der Knopf
              steht rechts unter „Feststellung der Wahlleitung“.
            </div>
          )}

          {withoutBallots && (
            <Field label="Wie wurde das Ergebnis ermittelt?">
              <div className="segmented">
                <button
                  className={countingMode === 'counted' ? 'active' : ''}
                  disabled={confirmed}
                  onClick={() => setCountingMode('counted')}
                >
                  Ausgezählt
                </button>
                <button
                  className={countingMode === 'declared' ? 'active' : ''}
                  disabled={confirmed}
                  onClick={() => setCountingMode('declared')}
                >
                  Ohne Auszählung
                </button>
              </div>
            </Field>
          )}

          {countingMode === 'declared' ? (
            <>
              <Field
                label="Feststellung der Versammlungsleitung"
                hint="Wird wörtlich ins Protokoll und auf den Beamer übernommen. Zahlen werden nicht erfasst."
              >
                <input
                  value={declaration}
                  disabled={confirmed}
                  onChange={(e) => setDeclaration(e.target.value)}
                  placeholder="z. B. Einstimmig angenommen"
                  list="declaration-suggestions"
                />
                <datalist id="declaration-suggestions">
                  {DECLARATION_SUGGESTIONS.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
              </Field>
              <Field label="Übliche Formulierungen">
                <select
                  value={
                    DECLARATION_SUGGESTIONS.includes(declaration as (typeof DECLARATION_SUGGESTIONS)[number])
                      ? declaration
                      : ''
                  }
                  disabled={confirmed}
                  onChange={(e) => e.target.value && setDeclaration(e.target.value)}
                >
                  <option value="">– eigener Wortlaut –</option>
                  {DECLARATION_SUGGESTIONS.map((suggestion) => (
                    <option key={suggestion} value={suggestion}>
                      {suggestion}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : withoutBallots ? (
            <div className="notice">
              Offene Abstimmung ohne Stimmzettel: Es werden ausschließlich die abgegebenen Stimmen gezählt.
              Angaben zu Stimmzetteln entfallen.
            </div>
          ) : (
            <div className="row">
              <div style={{ flex: 1 }}>
                <Field label="Abgegebene Stimmzettel">
                  <NumberInput value={ballotsCast} disabled={confirmed} onChange={setBallotsCast} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Ungültige Stimmzettel">
                  <NumberInput value={invalidBallots} disabled={confirmed} onChange={setInvalidBallots} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Gültig (berechnet)">
                  <input value={validBallots} readOnly />
                </Field>
              </div>
            </div>
          )}

          {kind === 'global_only' && countingMode === 'counted' && (
            <>
              <div className="row">
                <div style={{ flex: 1 }}>
                  <Field label="Ja">
                    <NumberInput value={globalYes} disabled={confirmed} onChange={setGlobalYes} />
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Nein">
                    <NumberInput value={globalNo} disabled={confirmed} onChange={setGlobalNo} />
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Enthaltung">
                    <NumberInput value={globalAbstentions} disabled={confirmed} onChange={setGlobalAbstentions} />
                  </Field>
                </div>
              </div>
              {withoutBallots && (
                <div className="hint">
                  Abgegebene Stimmen insgesamt: <strong>{openVoteTotal}</strong>
                </div>
              )}
            </>
          )}

          {kind !== 'global_only' && rows.length > 0 && countingMode === 'counted' && (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  {kind === 'votes' ? (
                    <th className="num">Stimmen</th>
                  ) : (
                    <>
                      <th className="num">Ja</th>
                      <th className="num">Nein</th>
                      <th className="num">Enthaltung</th>
                      <th className="num">ungültiges Votum</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.candidateId}>
                    <td>{row.name}</td>
                    {kind === 'votes' ? (
                      <td className="num" style={{ width: 130 }}>
                        <NumberInput
                          value={row.votes ?? 0}
                          disabled={confirmed}
                          onChange={(value) => setRow(row.candidateId, { votes: value })}
                        />
                      </td>
                    ) : (
                      <>
                        <td style={{ width: 110 }}>
                          <NumberInput
                            value={row.yes ?? 0}
                            disabled={confirmed}
                            onChange={(value) => setRow(row.candidateId, { yes: value })}
                          />
                        </td>
                        <td style={{ width: 110 }}>
                          <NumberInput
                            value={row.no ?? 0}
                            disabled={confirmed}
                            onChange={(value) => setRow(row.candidateId, { no: value })}
                          />
                        </td>
                        <td style={{ width: 110 }}>
                          <NumberInput
                            value={row.abstain ?? 0}
                            disabled={confirmed}
                            onChange={(value) => setRow(row.candidateId, { abstain: value })}
                          />
                        </td>
                        <td style={{ width: 110 }}>
                          <NumberInput
                            value={row.invalidVotes ?? 0}
                            disabled={confirmed}
                            onChange={(value) => setRow(row.candidateId, { invalidVotes: value })}
                          />
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {kind === 'votes' && countingMode === 'counted' && (
            <div className="row" style={{ marginTop: 12 }}>
              <div style={{ flex: 1 }}>
                <Field label="Nein (gesamt)">
                  <NumberInput value={globalNo} disabled={confirmed} onChange={setGlobalNo} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Enthaltung (gesamt)">
                  <NumberInput value={globalAbstentions} disabled={confirmed} onChange={setGlobalAbstentions} />
                </Field>
              </div>
            </div>
          )}

          <Field label="Bemerkung (optional)">
            <input value={note} disabled={confirmed} onChange={(e) => setNote(e.target.value)} />
          </Field>

          <button
            className="primary big"
            disabled={
              confirmed ||
              !app.can('result.enter') ||
              (countingMode === 'declared' && !declaration.trim())
            }
            onClick={() => void save()}
          >
            Ergebnis speichern
          </button>
        </Card>

        <Card title="Prüfung">
          {countingMode === 'declared' ? (
            <div className="notice">
              Ohne Auszählung gibt es keine Zahlen zu prüfen. Im Protokoll wird ausdrücklich vermerkt, dass das
              Ergebnis ohne Auszählung festgestellt wurde.
            </div>
          ) : issues.length === 0 && plausibility.every((check) => check.level === 'ok') ? (
            <div className="notice ok">Ergebnis und Stimmzettelbilanz sind schlüssig.</div>
          ) : (
            <>
              {issues.map((issue, index) => (
                <div key={`i${index}`} className={`notice ${issue.level === 'error' ? 'error' : 'warn'}`}>
                  {issue.message}
                </div>
              ))}
              {plausibility
                .filter((check) => check.level !== 'ok')
                .map((check, index) => (
                  <div key={`p${index}`} className="notice warn">
                    {check.message}
                  </div>
                ))}
            </>
          )}
        </Card>
      </div>

      <div>
        <Card title="Feststellung der Wahlleitung">
          {countingMode === 'declared' ? (
            <div className="notice">
              Das Ergebnis wurde ohne Auszählung festgestellt. Bitte unten nur noch die öffentliche
              Feststellung wählen — einen rechnerischen Vorschlag gibt es hier naturgemäß nicht.
            </div>
          ) : (
            <div className="notice">
              Rechnerischer Vorschlag:{' '}
              <strong>{FINAL_DECISION_LABELS[suggestion.decision] || suggestion.decision}</strong>
              <br />
              {suggestion.reason}
              <br />
              Die formelle Feststellung, wer gewählt ist, trifft ausschließlich die Wahlleitung.
            </div>
          )}

          <Field label="Öffentliche Feststellung">
            <select
              value={decision}
              disabled={confirmed}
              onChange={(e) => setDecision(e.target.value as FinalDecision | '')}
            >
              <option value="">– bitte wählen –</option>
              {availableDecisions(round.procedure).map((value) => (
                <option key={value} value={value}>
                  {FINAL_DECISION_LABELS[value] || 'Freitext'}
                </option>
              ))}
            </select>
          </Field>
          {countingMode === 'counted' && (
            <div className="row">
              <button
                disabled={confirmed}
                onClick={() => {
                  setDecision(suggestion.decision)
                  setElected(suggestion.suggestedElectedIds)
                }}
              >
                Vorschlag übernehmen
              </button>
            </div>
          )}

          <Field label="Erläuterung (erscheint im Protokoll und auf dem Beamer)">
            <input
              value={determination}
              disabled={confirmed}
              onChange={(e) => setDetermination(e.target.value)}
              placeholder="z. B. Erforderliche Mehrheit erreicht"
            />
          </Field>

          {profile.entryKind !== 'none' && rows.length > 0 && (
            <>
              <label>
                {isMotionProcedure(round.procedure)
                  ? 'Als angenommen festgestellt'
                  : 'Als gewählt festgestellt'}
              </label>
              <div className="scroll-box" style={{ padding: 8, marginBottom: 12 }}>
                {ranked.map((candidate) => (
                  <Checkbox
                    key={candidate.candidateId}
                    checked={elected.includes(candidate.candidateId)}
                    disabled={confirmed}
                    onChange={(value) =>
                      setElected((current) =>
                        value
                          ? [...current, candidate.candidateId]
                          : current.filter((id) => id !== candidate.candidateId)
                      )
                    }
                    label={
                      <>
                        {candidate.rank}. {candidate.name} —{' '}
                        {/* Beim Akzeptanzverfahren entscheidet Ja gegen Nein –
                            eine Zahl allein sagt dort nichts aus. */}
                        {profile.perCandidateChoice
                          ? `${candidate.yes ?? 0} Ja / ${candidate.no ?? 0} Nein`
                          : (candidate.votes ?? candidate.yes ?? 0)}
                        {profile.perCandidateChoice && !acceptanceQualified(candidate) && (
                          <span className="badge warn" style={{ marginLeft: 8 }}>
                            nicht mehr Ja als Nein
                          </span>
                        )}
                        {candidate.tiedAtCutoff && (
                          <span className="badge warn" style={{ marginLeft: 8 }}>
                            Stimmengleichheit an der Grenze
                          </span>
                        )}
                      </>
                    }
                  />
                ))}
              </div>
              {/* Niemand ist mit null Stimmen gewählt – das fällt in einer
                  langen Liste sonst niemandem auf. */}
              {electedWithoutVotes.length > 0 && (
                <div className="notice warn" style={{ marginBottom: 12 }}>
                  {electedWithoutVotes.length === 1
                    ? '1 als gewählt markierte Person hat keine einzige Stimme erhalten.'
                    : `${electedWithoutVotes.length} als gewählt markierte Personen haben keine einzige Stimme erhalten.`}{' '}
                  Bitte prüfen, bevor das Ergebnis bestätigt wird.
                </div>
              )}
              {/* Akzeptanzverfahren: gewählt ist, wer mehr Ja- als Nein-Stimmen
                  hat (Wahlformen §12). Eine Feststellung darüber hinaus ist
                  möglich, muss der Wahlleitung aber auffallen. */}
              {electedWithoutMajority.length > 0 && (
                <div className="notice warn" style={{ marginBottom: 12 }}>
                  {electedWithoutMajority.length === 1
                    ? `„${electedWithoutMajority[0].name}“ ist als gewählt markiert, hat aber nicht mehr Ja- als Nein-Stimmen (${electedWithoutMajority[0].yes ?? 0} zu ${electedWithoutMajority[0].no ?? 0}).`
                    : `${electedWithoutMajority.length} als gewählt markierte Personen haben nicht mehr Ja- als Nein-Stimmen.`}{' '}
                  Bitte prüfen, bevor das Ergebnis bestätigt wird.
                </div>
              )}
            </>
          )}

          <Field label="Losentscheid dokumentieren (optional)" hint="Ein Losentscheid ist kein Wahlgang mit Stimmzettel.">
            <input value={lotDecision} disabled={confirmed} onChange={(e) => setLotDecision(e.target.value)} />
          </Field>

          {/* Die Feststellung wird hier geändert, gespeichert wird sie mit den
              Zahlen zusammen — deshalb steht der Knopf auch in dieser Karte. */}
          {!confirmed && dirty && (
            <div className="notice warn" style={{ marginBottom: 12 }}>
              Diese Feststellung ist noch nicht gespeichert. Ohne Speichern wird beim Veröffentlichen der
              zuletzt gespeicherte Stand angezeigt.
            </div>
          )}

          <div className="row">
            {!confirmed && (
              <button
                disabled={!app.can('result.enter') || !dirty}
                onClick={() => void save()}
              >
                Feststellung speichern
              </button>
            )}
          </div>

          <div className="row">
            {!confirmed ? (
              <button
                className="primary big"
                disabled={!detail.result || !app.can('result.confirm') || issues.some((i) => i.level === 'error')}
                onClick={() => setShowConfirm(true)}
              >
                Ergebnis bestätigen und veröffentlichen
              </button>
            ) : roundClosed ? (
              /* Ein abgeschlossener Wahlgang lässt sich auf dem normalen Weg
                 nicht mehr öffnen — dafür gibt es die Notfallkorrektur. */
              <button
                className="big danger"
                disabled={!app.can('system.manage')}
                title={
                  app.can('system.manage')
                    ? undefined
                    : 'Nur die Administration darf einen abgeschlossenen Wahlgang öffnen.'
                }
                onClick={() => setShowEmergency(true)}
              >
                Notfallkorrektur: abgeschlossenen Wahlgang öffnen
              </button>
            ) : (
              <button className="big" onClick={() => setShowReopen(true)}>
                Ergebnis zur Überprüfung öffnen
              </button>
            )}
          </div>
          {confirmed && roundClosed && (
            <div className="notice warn" style={{ marginTop: 12 }}>
              Der Wahlgang ist abgeschlossen. Eine Berichtigung ist nur noch als Notfallkorrektur möglich:
              Status und Bestätigung werden mit Begründung zurückgenommen, der bisherige Stand bleibt im
              Audit-Trail erhalten.
            </div>
          )}
        </Card>

        <Card title="Weiteres Vorgehen">
          <div className="row">
            <button onClick={() => setShowFollowUp(true)}>Folgewahlgang erzeugen</button>
            <button
              onClick={async () => {
                try {
                  const result = await api('export.protocol', round.id)
                  app.notify('ok', `Protokoll erstellt: ${result.files[0]}`)
                } catch (error) {
                  app.reportError(error)
                }
              }}
            >
              Wahlprotokoll (PDF)
            </button>
            <button
              onClick={async () => {
                try {
                  const result = await api('export.round', {
                    roundId: round.id,
                    formats: ['pdf', 'csv', 'json']
                  })
                  app.notify('ok', `Export erstellt: ${result.path}`)
                } catch (error) {
                  app.reportError(error)
                }
              }}
            >
              Vollstaendiger Export
            </button>
          </div>
        </Card>
      </div>

      {showConfirm && (
        <Modal
          title="Ergebnis veröffentlichen?"
          onClose={() => setShowConfirm(false)}
          actions={
            <>
              <button onClick={() => setShowConfirm(false)}>Abbrechen</button>
              <button
                className="primary"
                onClick={async () => {
                  try {
                    // Offene Änderungen zuerst festschreiben: sonst würde der
                    // zuletzt gespeicherte Stand veröffentlicht, während auf
                    // dem Bildschirm die Korrektur steht.
                    if (dirty && !(await save())) return
                    await api('result.confirm', { roundId: round.id, pin: pin || undefined })
                    app.notify('ok', 'Ergebnis bestätigt und auf dem Beamer veröffentlicht.')
                    setShowConfirm(false)
                    setPin('')
                    await reload()
                  } catch (error) {
                    app.reportError(error)
                  }
                }}
              >
                Ergebnis veröffentlichen
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
                <th>Abgegebene Stimmzettel</th>
                <td>{ballotsCast}</td>
              </tr>
              <tr>
                <th>Ungültig</th>
                <td>{invalidBallots}</td>
              </tr>
              <tr>
                <th>Feststellung</th>
                <td>{decision ? FINAL_DECISION_LABELS[decision] || determination : '– nicht gesetzt –'}</td>
              </tr>
              <tr>
                <th>Als gewählt</th>
                <td>{elected.length}</td>
              </tr>
            </tbody>
          </table>
          {app.settings?.config.security.requirePinForMassPrint && (
            <Field label="Wahlleiter-PIN">
              <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus />
            </Field>
          )}
          <div className="notice">Nach der Veröffentlichung wird das Ergebnis auf dem Beamer angezeigt.</div>
        </Modal>
      )}

      {showEmergency && (
        <ConfirmDialog
          title="Notfallkorrektur"
          message={
            <p>
              Der Wahlgang <strong>{round.roundLabel}</strong> ist abgeschlossen. Die Notfallkorrektur setzt
              ihn auf „Auszählung" zurück und hebt die Bestätigung des Ergebnisses auf, damit es berichtigt
              und erneut bestätigt werden kann. Es wird nichts gelöscht — der bisherige Stand bleibt im
              Audit-Trail. Bitte den Beamer währenddessen auf eine neutrale Anzeige schalten.
            </p>
          }
          confirmLabel="Wahlgang öffnen"
          danger
          requireReason
          onCancel={() => setShowEmergency(false)}
          onConfirm={async (reason) => {
            try {
              await api('result.emergencyReopen', { roundId: round.id, reason })
              app.notify('warning', 'Wahlgang zur Notfallkorrektur geöffnet und im Audit-Trail vermerkt.')
              setShowEmergency(false)
              await reload()
              await app.refreshRounds()
            } catch (error) {
              app.reportError(error)
            }
          }}
        />
      )}

      {showReopen && (
        <ConfirmDialog
          title="Ergebnis zur Überprüfung öffnen"
          message={
            <p>
              Das bestätigte Ergebnis wird zur Korrektur freigegeben. Der bisherige Stand bleibt im Audit-Trail
              erhalten. Bitte den Beamer waehrenddessen auf eine neutrale Anzeige schalten.
            </p>
          }
          confirmLabel="Öffnen"
          danger
          requireReason
          onCancel={() => setShowReopen(false)}
          onConfirm={async (reason) => {
            try {
              await api('result.reopen', { roundId: round.id, reason })
              app.notify('warning', 'Ergebnis geöffnet. Es ist nicht mehr als bestätigt markiert.')
              setShowReopen(false)
              await reload()
            } catch (error) {
              app.reportError(error)
            }
          }}
        />
      )}

      {showFollowUp && (
        <FollowUpDialog detail={detail} onClose={() => setShowFollowUp(false)} />
      )}
    </div>
  )
}

/*
 * Eine Ergebniszeile enthält nur die Felder, die das Verfahren kennt.
 *
 * Wichtig: Beim Akzeptanzverfahren darf "votes" nicht mit 0 vorbelegt werden.
 * Die Rangfolge liest "votes ?? yes" — eine gesetzte Null hätte dort Vorrang
 * vor den Ja-Stimmen, und in der Feststellung stünde bei jedem Bewerber 0.
 */
function initialRows(
  result: ElectionResult | undefined,
  candidates: { id: string; displayName: string }[],
  kind: ResultInputKind
): CandidateResult[] {
  return candidates.map((candidate) => {
    const existing = result?.resultData.candidates.find((row) => row.candidateId === candidate.id)
    const row: CandidateResult = { candidateId: candidate.id, name: candidate.displayName }
    if (kind === 'votes') {
      row.votes = existing?.votes ?? 0
    } else {
      row.yes = existing?.yes ?? 0
      row.no = existing?.no ?? 0
      row.abstain = existing?.abstain ?? 0
      row.invalidVotes = existing?.invalidVotes ?? 0
    }
    return row
  })
}

/** Stichwahl-, Wiederholungs- oder Nachwahl-Assistent (§27, Wahlformen §5/§19/§20). */
function FollowUpDialog({ detail, onClose }: { detail: TabProps['detail']; onClose: () => void }): React.JSX.Element {
  const app = useApp()
  const round = detail.round
  const result = detail.result
  const ranked = rankCandidates(result?.resultData.candidates ?? [], round.seats)

  const [kind, setKind] = useState<'runoff' | 'repeat' | 'byelection' | 'second_round'>('runoff')
  const [selected, setSelected] = useState<string[]>(
    ranked.slice(0, 2).map((candidate) => candidate.candidateId)
  )
  const [seats, setSeats] = useState(1)
  const [title, setTitle] = useState('')

  return (
    <Modal
      title="Folgewahlgang erzeugen"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="primary"
            disabled={selected.length === 0}
            onClick={async () => {
              try {
                const created = await api('round.createFollowUp', {
                  parentRoundId: round.id,
                  kind,
                  title: title.trim() || undefined,
                  seats,
                  candidateIds: selected
                })
                app.notify('ok', `Folgewahlgang ${created.roundLabel} angelegt (${created.roundCode}).`)
                onClose()
                await app.refreshRounds()
                navigate(`round/${created.id}/candidates`)
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
      <Field label="Art">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="runoff">Stichwahl</option>
          <option value="repeat">Neu eroeffnete Wahl / Wiederholung</option>
          <option value="byelection">Nachwahl für offene Position</option>
          <option value="second_round">Zweiter Wahlgang</option>
        </select>
      </Field>
      <div className="row">
        <div style={{ flex: 1 }}>
          <Field label="Zu besetzende Positionen">
            <NumberInput value={seats} min={1} onChange={setSeats} />
          </Field>
        </div>
        <div style={{ flex: 2 }}>
          <Field label="Bezeichnung (optional)">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${round.title} – Folgewahlgang`} />
          </Field>
        </div>
      </div>

      <label>Teilnehmende Kandidaten</label>
      <div className="scroll-box" style={{ padding: 8 }}>
        {detail.candidates
          .filter((candidate) => !candidate.withdrawn)
          .map((candidate) => {
            const rank = ranked.find((entry) => entry.candidateId === candidate.id)
            return (
              <Checkbox
                key={candidate.id}
                checked={selected.includes(candidate.id)}
                onChange={(value) =>
                  setSelected((current) =>
                    value ? [...current, candidate.id] : current.filter((id) => id !== candidate.id)
                  )
                }
                label={
                  <>
                    {candidate.displayName}
                    {rank && <span className="hint"> ({rank.votes ?? rank.yes ?? 0} Stimmen)</span>}
                  </>
                }
              />
            )
          })}
      </div>
      <div className="notice">
        Der Folgewahlgang erhält eine eigene Kennung und eine neue Zettelversion. Der urspruengliche Wahlgang
        bleibt unverändert erhalten.
      </div>
    </Modal>
  )
}
