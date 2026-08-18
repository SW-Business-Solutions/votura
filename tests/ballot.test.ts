import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ballotHashInput, buildBallotDocument, DEFAULT_BALLOT_LABELS } from '../src/shared/ballot'
import { canonicalJson } from '../src/shared/canonical'
import { defaultTemplateFor } from '../src/shared/election'
import type { Candidate, ElectionEvent, ElectionProcedure, ElectionRound } from '../src/shared/types'

const event: ElectionEvent = {
  id: 'event-1',
  title: 'Mitgliederversammlung',
  organization: 'Musterverband Beispielstadt',
  orgCode: 'MV26',
  date: '2026-09-12',
  location: 'Ulmenhof Steinhoefel',
  status: 'active',
  eligibleVoterCount: 121,
  ruleSet: { name: 'Wahlordnung', version: 'Fassung 2024', snapshotDate: '2026-08-17' },
  rowVersion: 1,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z'
}

function round(procedure: ElectionProcedure, overrides: Partial<ElectionRound> = {}): ElectionRound {
  const seats = overrides.seats ?? 8
  const maxVotes = overrides.maxVotes === undefined ? 8 : overrides.maxVotes
  return {
    id: 'round-1',
    eventId: event.id,
    sequentialNumber: 7,
    agendaOrder: 7,
    roundCode: 'MV26-20260912-WG07',
    roundLabel: '07',
    title: 'Delegiertenwahl',
    purpose: 'delegate',
    procedure,
    seats,
    maxVotes,
    status: 'candidate_collection',
    ballotVersion: 1,
    template: defaultTemplateFor(procedure, { seats, maxVotes, entryCount: 3 }),
    orderMode: 'manual',
    positions: [],
    rowVersion: 1,
    createdAt: '2026-09-12T16:31:00.000Z',
    ...overrides
  }
}

function candidates(names: string[]): Candidate[] {
  return names.map((name, index) => ({
    id: `candidate-${index}`,
    electionRoundId: 'round-1',
    firstName: name.split(' ')[0],
    lastName: name.split(' ').slice(1).join(' '),
    displayName: name,
    sortOrder: index,
    withdrawn: false,
    createdAt: '2026-09-12T16:32:00.000Z'
  }))
}

const names = ['Max Mustermann', 'Erika Musterfrau', 'Peter Beispiel']

describe('Stimmzettel-Erzeugung', () => {
  it('enthält Wahlgangkennung, Titel und Veranstaltung', () => {
    const document = buildBallotDocument(event, round('group_preprinted'), candidates(names))
    expect(document.round.code).toBe('MV26-20260912-WG07')
    expect(document.event.organization).toBe('Musterverband Beispielstadt')
    expect(document.round.maxVotes).toBe(8)
  })

  it('setzt bei der Gruppenwahl Nein/Enthaltung als globale Optionen ans Ende', () => {
    const document = buildBallotDocument(event, round('group_preprinted'), candidates(names))
    expect(document.sections[0].kind).toBe('choice_list')
    expect(document.sections[0].candidates).toHaveLength(3)
    const globalSection = document.sections[1]
    expect(globalSection.kind).toBe('global_options')
    expect(globalSection.options).toEqual([DEFAULT_BALLOT_LABELS.no, DEFAULT_BALLOT_LABELS.abstention])
    // Nein/Enthaltung dürfen nicht hinter einzelnen Kandidaten stehen.
    expect(globalSection.candidates).toHaveLength(0)
  })

  it('stellt bei der Einzelwahl mit einem Bewerber Ja/Nein/Enthaltung global', () => {
    const document = buildBallotDocument(
      event,
      round('single_candidate', { seats: 1, maxVotes: 1 }),
      candidates([names[0]])
    )
    expect(document.sections).toHaveLength(1)
    expect(document.sections[0].kind).toBe('global_options')
    expect(document.sections[0].options).toEqual([
      DEFAULT_BALLOT_LABELS.yes,
      DEFAULT_BALLOT_LABELS.no,
      DEFAULT_BALLOT_LABELS.abstention
    ])
    expect(document.sections[0].candidates[0].name).toBe('Max Mustermann')
  })

  it('erzeugt beim Akzeptanzverfahren Voten je Kandidat', () => {
    const document = buildBallotDocument(event, round('acceptance_group', { seats: 5, maxVotes: null }), candidates(names))
    expect(document.sections[0].kind).toBe('per_candidate_choice')
    expect(document.sections[0].candidates).toHaveLength(3)
    expect(document.sections[0].options).toHaveLength(3)
    // Keine zusätzliche globale Options-Sektion.
    expect(document.sections).toHaveLength(1)
  })

  it('erzeugt für die verbundene Einzelwahl je Position eine Sektion', () => {
    const positions = [
      { id: 'p1', title: 'Schatzmeister', candidateIds: [] },
      { id: 'p2', title: 'Schriftführer', candidateIds: [] }
    ]
    const list = candidates(names.slice(0, 2))
    list[0].positionId = 'p1'
    list[1].positionId = 'p2'
    const document = buildBallotDocument(
      event,
      round('connected_single_election', { seats: 2, maxVotes: null, positions }),
      list
    )
    expect(document.sections).toHaveLength(2)
    expect(document.sections[0].title).toBe('Schatzmeister')
    expect(document.sections[1].candidates[0].name).toBe('Erika Musterfrau')
  })

  it('erzeugt Blanko-Namenszeilen bei der Gruppenwahl mit leerem Stimmzettel', () => {
    const base = round('group_blank', { seats: 8, maxVotes: 8 })
    const document = buildBallotDocument(event, base, [])
    expect(document.sections[0].kind).toBe('blank_lines')
    expect(document.sections[0].blankLines).toBe(8)
  })

  it('lässt zurueckgezogene Kandidaten weg', () => {
    const list = candidates(names)
    list[1].withdrawn = true
    const document = buildBallotDocument(event, round('group_preprinted'), list)
    expect(document.sections[0].candidates.map((entry) => entry.name)).toEqual([
      'Max Mustermann',
      'Peter Beispiel'
    ])
  })

  it('enthält keinerlei Einzelkennung je Stimmzettel', () => {
    const document = buildBallotDocument(event, round('group_preprinted'), candidates(names))
    const serialized = JSON.stringify(document)
    expect(serialized).not.toMatch(/serial/i)
    expect(serialized).not.toMatch(/ballotId/i)
    // Kandidaten-IDs dienen nur der internen Zuordnung und sind nicht Teil des Drucks.
    expect(ballotHashInput(document)).not.toHaveProperty('candidates')
  })
})

describe('Ballot-Hash', () => {
  const hash = (document: ReturnType<typeof buildBallotDocument>): string =>
    createHash('sha256').update(canonicalJson(ballotHashInput(document))).digest('hex')

  it('ist für identische Vorlagen gleich', () => {
    const first = buildBallotDocument(event, round('group_preprinted'), candidates(names))
    const second = buildBallotDocument(event, round('group_preprinted'), candidates(names))
    expect(hash(first)).toBe(hash(second))
  })

  it('aendert sich, sobald ein Kandidat hinzukommt', () => {
    const before = buildBallotDocument(event, round('group_preprinted'), candidates(names))
    const after = buildBallotDocument(event, round('group_preprinted'), candidates([...names, 'Anna Beispiel']))
    expect(hash(before)).not.toBe(hash(after))
  })

  it('aendert sich bei geaenderter Stimmenzahl', () => {
    const before = buildBallotDocument(event, round('group_preprinted'), candidates(names))
    const after = buildBallotDocument(event, round('group_preprinted', { maxVotes: 5 }), candidates(names))
    expect(hash(before)).not.toBe(hash(after))
  })

  it('ist unabhängig von der Schluesselreihenfolge im JSON', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
  })
})

