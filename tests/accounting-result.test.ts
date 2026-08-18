import { describe, expect, it } from 'vitest'
import {
  availableBallots,
  checkAccounting,
  checkResultPlausibility,
  emptyAccounting,
  estimatePaperUsage,
  expectedInBox
} from '../src/shared/accounting'
import { rankCandidates, resultInputKind, suggestDecision, validateResult } from '../src/shared/result'
import type { BallotAccounting, ResultData } from '../src/shared/types'

function accounting(overrides: Partial<BallotAccounting> = {}): BallotAccounting {
  return { ...emptyAccounting('round-1'), printed: 126, issued: 121, ...overrides }
}

describe('Stimmzettelbilanz', () => {
  it('rechnet verfügbare Zettel als gedruckt minus Fehldrucke', () => {
    expect(availableBallots(accounting({ printed: 126, printFailures: 2 }))).toBe(124)
  })

  it('rechnet die erwartete Urnenmenge als ausgegeben minus zurückgenommen', () => {
    expect(expectedInBox(accounting({ issued: 121, returnedSpoiled: 2 }))).toBe(119)
  })

  it('markiert mehr ausgegebene als verfügbare Zettel', () => {
    const checks = checkAccounting(accounting({ printed: 100, issued: 120 }))
    expect(checks.some((check) => check.level === 'warning')).toBe(true)
  })

  it('markiert Abweichungen der Urnenzählung, korrigiert sie aber nicht', () => {
    const input = accounting({ issued: 121, returnedSpoiled: 2, ballotsInBox: 115 })
    const checks = checkAccounting(input)
    expect(checks.some((check) => check.message.includes('weicht um -4'))).toBe(true)
    expect(input.ballotsInBox).toBe(115)
  })

  it('meldet mehr ausgegebene Zettel als Stimmberechtigte', () => {
    const checks = checkAccounting(accounting({ issued: 130 }), 121)
    expect(checks.some((check) => check.message.includes('Stimmberechtigte'))).toBe(true)
  })

  it('bestätigt eine schluessige Bilanz', () => {
    const checks = checkAccounting(
      accounting({ printed: 126, issued: 121, replacementsIssued: 2, returnedSpoiled: 2, unused: 5 }),
      121
    )
    expect(checks.every((check) => check.level !== 'warning')).toBe(true)
  })

  it('vergleicht das Ergebnis mit der Bilanz', () => {
    const checks = checkResultPlausibility(accounting({ issued: 121, returnedSpoiled: 2 }), 125, 123, 2)
    expect(checks.some((check) => check.level === 'warning')).toBe(true)
  })

  it('schaetzt den Papierverbrauch', () => {
    const usage = estimatePaperUsage(40, 126)
    expect(usage.millimetersPerBallot).toBeGreaterThan(100)
    expect(usage.totalMeters).toBeCloseTo((40 * 3.5 + 15) * 126 / 1000, 5)
  })
})

describe('Ergebnisvalidierung', () => {
  const base = { procedure: 'group_preprinted' as const, seats: 8, maxVotes: 8, positions: [] }

  it('verlangt, dass gültig + ungültig die abgegebenen ergeben', () => {
    const issues = validateResult(base, { candidates: [] }, {
      ballotsCast: 119,
      validBallots: 100,
      invalidBallots: 2
    })
    expect(issues.some((issue) => issue.level === 'error')).toBe(true)
  })

  it('erkennt mehr Stimmen als möglich', () => {
    const data: ResultData = {
      candidates: [
        { candidateId: 'a', name: 'A', votes: 90 },
        { candidateId: 'b', name: 'B', votes: 90 }
      ]
    }
    const issues = validateResult(
      { ...base, seats: 1, maxVotes: 1 },
      data,
      { ballotsCast: 100, validBallots: 100, invalidBallots: 0 }
    )
    expect(issues.some((issue) => issue.level === 'error')).toBe(true)
  })

  it('akzeptiert eine schluessige Gruppenwahl', () => {
    const data: ResultData = {
      candidates: [
        { candidateId: 'a', name: 'A', votes: 101 },
        { candidateId: 'b', name: 'B', votes: 98 }
      ]
    }
    const issues = validateResult(base, data, { ballotsCast: 119, validBallots: 117, invalidBallots: 2 })
    expect(issues.filter((issue) => issue.level === 'error')).toHaveLength(0)
  })

  it('wählt die Eingabemaske nach Verfahren', () => {
    expect(resultInputKind({ procedure: 'group_preprinted' })).toBe('votes')
    expect(resultInputKind({ procedure: 'acceptance_group' })).toBe('yes_no_abstain')
    expect(resultInputKind({ procedure: 'yes_no_abstain' })).toBe('global_only')
  })
})

describe('Rangfolge und Feststellungsvorschlag', () => {
  it('sortiert nach Stimmen und markiert die Sitzgrenze', () => {
    const ranked = rankCandidates(
      [
        { candidateId: 'a', name: 'A', votes: 80 },
        { candidateId: 'b', name: 'B', votes: 95 },
        { candidateId: 'c', name: 'C', votes: 60 }
      ],
      2
    )
    expect(ranked.map((entry) => entry.name)).toEqual(['B', 'A', 'C'])
    expect(ranked[0].withinSeats).toBe(true)
    expect(ranked[2].withinSeats).toBe(false)
  })

  it('markiert Stimmengleichheit am Blockende, ohne selbst zu entscheiden', () => {
    const ranked = rankCandidates(
      [
        { candidateId: 'a', name: 'A', votes: 90 },
        { candidateId: 'b', name: 'B', votes: 51 },
        { candidateId: 'c', name: 'C', votes: 51 }
      ],
      2
    )
    expect(ranked.filter((entry) => entry.tiedAtCutoff)).toHaveLength(2)
  })

  it('schlaegt bei Stimmengleichheit keine automatische Wahl vor', () => {
    const suggestion = suggestDecision(
      { procedure: 'group_preprinted', seats: 2 },
      {
        candidates: [
          { candidateId: 'a', name: 'A', votes: 90 },
          { candidateId: 'b', name: 'B', votes: 51 },
          { candidateId: 'c', name: 'C', votes: 51 }
        ]
      },
      { validBallots: 100 }
    )
    expect(suggestion.decision).toBe('tie')
    expect(suggestion.suggestedElectedIds).toHaveLength(0)
    expect(suggestion.requiresLeaderDecision).toBe(true)
  })

  it('schlaegt eine Stichwahl vor, wenn niemand die Mehrheit erreicht', () => {
    const suggestion = suggestDecision(
      { procedure: 'single_multiple_candidates', seats: 1 },
      {
        candidates: [
          { candidateId: 'a', name: 'A', votes: 40 },
          { candidateId: 'b', name: 'B', votes: 35 }
        ]
      },
      { validBallots: 100 }
    )
    expect(suggestion.decision).toBe('runoff')
  })

  it('bewertet das Akzeptanzverfahren nach Ja gegen Nein', () => {
    const suggestion = suggestDecision(
      { procedure: 'acceptance_group', seats: 2 },
      {
        candidates: [
          { candidateId: 'a', name: 'A', yes: 60, no: 30 },
          { candidateId: 'b', name: 'B', yes: 20, no: 70 },
          { candidateId: 'c', name: 'C', yes: 55, no: 40 }
        ]
      },
      { validBallots: 100 }
    )
    expect(suggestion.suggestedElectedIds).toEqual(['a', 'c'])
  })

  it('rangiert Akzeptanzverfahren nach Ja-Stimmen, nicht nach einer leeren Stimmenzahl', () => {
    // Beim Akzeptanzverfahren gibt es keine Stimmenzahl. Wäre "votes" mit 0
    // belegt, stünde in der Feststellung bei jedem Bewerber eine 0.
    const ranked = rankCandidates(
      [
        { candidateId: 'a', name: 'Maria Musterfrau', yes: 40, no: 90, abstain: 6 },
        { candidateId: 'b', name: 'Max Mustermann', yes: 90, no: 5, abstain: 4 }
      ],
      2
    )
    expect(ranked.map((entry) => entry.name)).toEqual(['Max Mustermann', 'Maria Musterfrau'])
    expect(ranked[0].votes).toBeUndefined()
    expect(ranked[0].yes).toBe(90)
  })

  it('schlaegt niemanden ohne eine einzige Stimme als gewählt vor', () => {
    // 3 Plätze, aber nur zwei Personen haben überhaupt Stimmen erhalten.
    const suggestion = suggestDecision(
      { procedure: 'group_preprinted', seats: 3 },
      {
        candidates: [
          { candidateId: 'a', name: 'A', votes: 52 },
          { candidateId: 'b', name: 'B', votes: 42 },
          { candidateId: 'c', name: 'C', votes: 0 }
        ]
      },
      { validBallots: 130 }
    )
    expect(suggestion.suggestedElectedIds).toEqual(['a', 'b'])
    expect(suggestion.reason).toContain('ohne eine einzige Stimme')
  })

  it('trifft bei der Sachabstimmung keine automatische Feststellung', () => {
    const suggestion = suggestDecision(
      { procedure: 'yes_no_abstain', seats: 1 },
      { candidates: [], yes: 83, no: 21, abstentions: 10 },
      { validBallots: 114 }
    )
    expect(suggestion.decision).toBe('accepted')
    expect(suggestion.requiresLeaderDecision).toBe(true)
  })
})
