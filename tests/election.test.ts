import { describe, expect, it } from 'vitest'
import {
  candidatesEditable,
  canTransition,
  defaultTemplateFor,
  isImmutable,
  parseCandidateBlock,
  parseCandidateLine,
  profileFor,
  sortCandidates,
  validateRoundSetup,
  withTemplateDefaults
} from '../src/shared/election'
import { buildRoundCode, derivedRoundLabel, roundLabelFor, sanitizeForPrint } from '../src/shared/format'
import { istNeuer } from '../src/main/services/updates'
import type { BallotTemplateConfig, Candidate, ElectionRound } from '../src/shared/types'

function template(overrides: Partial<BallotTemplateConfig> = {}): BallotTemplateConfig {
  return { ...defaultTemplateFor('group_preprinted', { seats: 8, maxVotes: 8, entryCount: 14 }), ...overrides }
}

function candidate(name: string, overrides: Partial<Candidate> = {}): Candidate {
  const [first, ...rest] = name.split(' ')
  return {
    id: `id-${name}`,
    electionRoundId: 'round',
    firstName: first,
    lastName: rest.join(' ') || first,
    displayName: name,
    sortOrder: 0,
    withdrawn: false,
    createdAt: '2026-09-12T10:00:00.000Z',
    ...overrides
  }
}

describe('Wahlgangkennung', () => {
  it('erzeugt eine für alle Stimmzettel identische Kennung', () => {
    expect(buildRoundCode('mv26', '2026-09-12', '07')).toBe('MV26-20260912-WG07')
  })

  it('nummeriert Wahlgänge zweistellig', () => {
    expect(roundLabelFor(7)).toBe('07')
    expect(roundLabelFor(13)).toBe('13')
  })

  it('leitet Kennungen für Folgewahlgaenge ab', () => {
    expect(derivedRoundLabel('04', 'S', 1)).toBe('04-S1')
    expect(derivedRoundLabel('03', 'R', 1)).toBe('03-R1')
    expect(derivedRoundLabel('07', 'N', 2)).toBe('07-N2')
    expect(derivedRoundLabel('07', '2', 1)).toBe('07-2')
  })

  it('erzeugt für verschiedene Wahlgänge verschiedene Kennungen', () => {
    const first = buildRoundCode('MV26', '2026-09-12', '07')
    const second = buildRoundCode('MV26', '2026-09-12', '08')
    expect(first).not.toBe(second)
  })
})

describe('Verfahrensprofile', () => {
  it('trennt Wahlzweck und Verfahren: Gruppenwahl bekommt maxVotes aus den Sitzen', () => {
    expect(profileFor('group_preprinted').defaultMaxVotes(8)).toBe(8)
  })

  it('lässt Stufe 1 der Zwei-Stufen-Wahl ohne feste Höchstzahl', () => {
    expect(profileFor('two_stage_stage_1').defaultMaxVotes(10)).toBeNull()
  })

  it('kennzeichnet die offene Abstimmung als Verfahren ohne Stimmzettel', () => {
    expect(profileFor('open_vote').ballotRequired).toBe(false)
  })

  it('erzeugt für Akzeptanzverfahren Voten je Kandidat', () => {
    expect(profileFor('acceptance_group').perCandidateChoice).toBe(true)
  })
})

describe('Validierung der Wahlgangparameter', () => {
  const base = {
    procedure: 'group_preprinted' as const,
    seats: 8,
    maxVotes: 8,
    title: 'Delegiertenwahl',
    template: template(),
    positions: []
  }

  it('akzeptiert eine schluessige Gruppenwahl', () => {
    const issues = validateRoundSetup(
      base,
      Array.from({ length: 14 }, (_, index) => candidate(`Kandidat ${index}`))
    )
    expect(issues.filter((issue) => issue.level === 'error')).toHaveLength(0)
  })

  it('meldet mehr Stimmen als Kandidaten als Warnung', () => {
    const issues = validateRoundSetup({ ...base, maxVotes: 20 }, [candidate('Max Mustermann')])
    expect(issues.some((issue) => issue.field === 'maxVotes' && issue.level === 'warning')).toBe(true)
  })

  it('verhindert mehrere Positionen bei Einzelwahl', () => {
    const issues = validateRoundSetup(
      { ...base, procedure: 'single_candidate', seats: 3, maxVotes: 1 },
      [candidate('Max Mustermann')]
    )
    expect(issues.some((issue) => issue.field === 'seats' && issue.level === 'error')).toBe(true)
  })

  it('erkennt doppelte Namen, die auf dem Zettel nicht unterscheidbar wären', () => {
    const issues = validateRoundSetup(base, [candidate('Max Mustermann'), candidate('max mustermann')])
    expect(issues.some((issue) => issue.message.includes('kommt 2-mal vor'))).toBe(true)
  })

  it('verlangt eindeutige Kandidatennummern, wenn sie gedruckt werden', () => {
    const issues = validateRoundSetup({ ...base, template: template({ showCandidateNumbers: true }) }, [
      candidate('A B', { ballotNumber: 1 }),
      candidate('C D', { ballotNumber: 1 })
    ])
    expect(issues.some((issue) => issue.message.includes('nicht eindeutig'))).toBe(true)
  })

  it('prüft den Listenplatzbereich gegen die Sitzzahl', () => {
    const issues = validateRoundSetup(
      { ...base, procedure: 'two_stage_stage_2_block', seats: 5, seatStart: 4, seatEnd: 9 },
      [candidate('Max Mustermann')]
    )
    expect(issues.some((issue) => issue.level === 'error' && issue.field === 'seats')).toBe(true)
  })
})

describe('Statusmaschine', () => {
  it('erlaubt den regulären Ablauf', () => {
    expect(canTransition('candidate_collection', 'ready')).toBe(true)
    expect(canTransition('ready', 'open')).toBe(true)
    expect(canTransition('open', 'counting')).toBe(true)
    expect(canTransition('counting', 'completed')).toBe(true)
  })

  it('lässt abgeschlossene Wahlgänge unverändert', () => {
    expect(isImmutable('completed')).toBe(true)
    expect(isImmutable('cancelled')).toBe(true)
    expect(canTransition('completed', 'open')).toBe(false)
  })

  it('sperrt Kandidatenaenderungen ab der Freigabe', () => {
    expect(candidatesEditable('candidate_collection')).toBe(true)
    expect(candidatesEditable('ready')).toBe(false)
    expect(candidatesEditable('open')).toBe(false)
  })
})

describe('Kandidatenerfassung', () => {
  it('erkennt "Vorname Nachname"', () => {
    expect(parseCandidateLine('Max Mustermann')).toEqual({
      firstName: 'Max',
      lastName: 'Mustermann',
      displayName: 'Max Mustermann'
    })
  })

  it('erkennt "Nachname, Vorname"', () => {
    expect(parseCandidateLine('Mustermann, Max')).toEqual({
      firstName: 'Max',
      lastName: 'Mustermann',
      displayName: 'Max Mustermann'
    })
  })

  it('verarbeitet eingefuegte Listen und ignoriert Leerzeilen', () => {
    const parsed = parseCandidateBlock('Max Mustermann\n\n  Erika Musterfrau  \nPeter Beispiel')
    expect(parsed.map((entry) => entry.displayName)).toEqual([
      'Max Mustermann',
      'Erika Musterfrau',
      'Peter Beispiel'
    ])
  })
})

describe('Kandidatenreihenfolge', () => {
  const list = [
    candidate('Zoe Adler', { sortOrder: 2 }),
    candidate('Anton Bauer', { sortOrder: 0 }),
    candidate('Berta Adler', { sortOrder: 1 })
  ]

  it('sortiert manuell nach der festgelegten Reihenfolge', () => {
    expect(sortCandidates(list, 'manual').map((entry) => entry.displayName)).toEqual([
      'Anton Bauer',
      'Berta Adler',
      'Zoe Adler'
    ])
  })

  it('sortiert alphabetisch nach Nachname, dann Vorname', () => {
    expect(sortCandidates(list, 'alphabetical').map((entry) => entry.displayName)).toEqual([
      'Berta Adler',
      'Zoe Adler',
      'Anton Bauer'
    ])
  })

  it('erzeugt bei gleichem Startwert dieselbe Zufallsreihenfolge (reproduzierbar im Audit)', () => {
    const first = sortCandidates(list, 'random', 4711).map((entry) => entry.displayName)
    const second = sortCandidates(list, 'random', 4711).map((entry) => entry.displayName)
    expect(first).toEqual(second)
  })
})

describe('Druckaufbereitung von Text', () => {
  it('behaelt deutsche Umlaute', () => {
    expect(sanitizeForPrint('Müller Öztürk Weiß')).toBe('Müller Öztürk Weiß')
  })

  it('ersetzt typografische Sonderzeichen', () => {
    expect(sanitizeForPrint('„Test“ – Ende…')).toBe('"Test" - Ende...')
  })
})

describe('Standardvorlagen', () => {
  it('setzt für die Gruppenwahl Nein und Enthaltung als globale Optionen', () => {
    const config = defaultTemplateFor('group_preprinted', { seats: 8, maxVotes: 8, entryCount: 14 })
    expect(config.allowNo).toBe(true)
    expect(config.allowAbstention).toBe(true)
    expect(config.allowYes).toBe(false)
  })

  it('blendet bei Stufe 1 der Zwei-Stufen-Wahl Nein/Enthaltung aus', () => {
    const config = defaultTemplateFor('two_stage_stage_1', { seats: 10, maxVotes: null, entryCount: 12 })
    expect(config.allowNo).toBe(false)
    expect(config.allowAbstention).toBe(false)
  })

  it('aktiviert Kandidatennummern erst ab zehn Eintraegen', () => {
    expect(defaultTemplateFor('group_preprinted', { seats: 2, maxVotes: 2, entryCount: 5 }).showCandidateNumbers).toBe(
      false
    )
    expect(
      defaultTemplateFor('group_preprinted', { seats: 8, maxVotes: 8, entryCount: 14 }).showCandidateNumbers
    ).toBe(true)
  })
})

describe('Wahlgang-Typ', () => {
  it('haelt die vollständige Verfahrensliste bereit', () => {
    const round: Pick<ElectionRound, 'procedure'> = { procedure: 'connected_single_election' }
    expect(profileFor(round.procedure).entryKind).toBe('positions')
  })
})

describe('Stimmzettelvorlage je Verfahren', () => {
  it('übernimmt beim Akzeptanzverfahren das JA aus dem Verfahren', () => {
    // Ohne Verfahrensbezug greifen die allgemeinen Vorgaben (kein JA) — auf
    // einem Akzeptanz-Stimmzettel ließe sich dann nur ablehnen oder enthalten.
    expect(withTemplateDefaults({}).allowYes).toBe(false)
    expect(withTemplateDefaults({}, 'acceptance_group').allowYes).toBe(true)
    expect(withTemplateDefaults({}, 'connected_single_election').allowYes).toBe(true)
    // Eine ausdrückliche Angabe hat weiterhin Vorrang.
    expect(withTemplateDefaults({ allowYes: false }, 'acceptance_group').allowYes).toBe(false)
  })

  it('meldet einen Akzeptanz-Stimmzettel ohne JA als Fehler', () => {
    const issues = validateRoundSetup(
      {
        procedure: 'acceptance_group',
        seats: 5,
        maxVotes: null,
        title: 'Delegierte',
        template: template({ allowYes: false }),
        positions: []
      },
      [candidate('Clara Fenske'), candidate('Paul Marquardt')]
    )
    expect(issues.some((issue) => issue.field === 'template' && issue.level === 'error')).toBe(true)
  })
})

describe('Versionsvergleich für den Aktualisierungshinweis', () => {
  it('erkennt neuere Fassungen', () => {
    expect(istNeuer('0.3.0', '0.2.2')).toBe(true)
    expect(istNeuer('1.0.0', '0.9.9')).toBe(true)
    expect(istNeuer('0.2.10', '0.2.9')).toBe(true)
    expect(istNeuer('v0.2.3', '0.2.2')).toBe(true)
  })

  it('meldet gleiche oder aeltere Fassungen nicht als Aktualisierung', () => {
    expect(istNeuer('0.2.2', '0.2.2')).toBe(false)
    expect(istNeuer('0.2.1', '0.2.2')).toBe(false)
    expect(istNeuer('0.9.9', '1.0.0')).toBe(false)
    // Vorabfassungen zaehlen nicht als neuer als die fertige Fassung.
    expect(istNeuer('0.2.2-rc.1', '0.2.2')).toBe(false)
  })
})
