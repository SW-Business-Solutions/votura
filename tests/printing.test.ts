/** ESC/POS-Erzeugung, Epson-ePOS-XML und Bon-Layout (§13, §14, §20, §46). */
import { describe, expect, it } from 'vitest'
import { buildBallotDocument } from '../src/shared/ballot'
import { DEFAULT_CONFIG } from '../src/shared/config'
import { defaultTemplateFor } from '../src/shared/election'
import type { AppConfig, Candidate, ElectionEvent, ElectionRound, PrinterConfig } from '../src/shared/types'
import { encodeDocument, encodeText } from '../src/main/printing/escpos'
import { buildBallotOps, renderPreviewLines } from '../src/main/printing/layout'
import { countLines, wrapText } from '../src/main/printing/ops'
import { opsToEposXml } from '../src/main/printing/drivers/epson-epos'

const printer: PrinterConfig = {
  id: 'test',
  name: 'Test',
  kind: 'escpos_network',
  paperWidthMm: 80,
  charsPerLine: 42,
  dotsPerLine: 576,
  cutEveryBallot: true,
  feedLinesBeforeCut: 3,
  codepage: 'CP858',
  enabled: true
}

const config: AppConfig = DEFAULT_CONFIG

const event: ElectionEvent = {
  id: 'e1',
  title: 'Mitgliederversammlung',
  organization: 'Musterverband Beispielstadt',
  orgCode: 'MV26',
  date: '2026-09-12',
  location: 'Ulmenhof',
  status: 'active',
  ruleSet: { name: 'Wahlordnung', version: '2024', snapshotDate: '2026-08-17' },
  rowVersion: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
}

function round(overrides: Partial<ElectionRound> = {}): ElectionRound {
  const seats = overrides.seats ?? 8
  return {
    id: 'r1',
    eventId: 'e1',
    sequentialNumber: 7,
    agendaOrder: 7,
    roundCode: 'MV26-20260912-WG07',
    roundLabel: '07',
    title: 'Delegiertenwahl',
    purpose: 'delegate',
    procedure: 'group_preprinted',
    seats,
    maxVotes: 8,
    status: 'ready',
    ballotVersion: 1,
    template: defaultTemplateFor('group_preprinted', { seats, maxVotes: 8, entryCount: 3 }),
    orderMode: 'manual',
    positions: [],
    rowVersion: 1,
    createdAt: '2026-09-12T16:31:00.000Z',
    ...overrides
  }
}

const candidates: Candidate[] = ['Max Mustermann', 'Erika Musterfrau', 'Peter Beispiel'].map((name, index) => ({
  id: `c${index}`,
  electionRoundId: 'r1',
  firstName: name.split(' ')[0],
  lastName: name.split(' ')[1],
  displayName: name,
  sortOrder: index,
  withdrawn: false,
  createdAt: '2026-09-12T16:32:00.000Z'
}))

describe('ESC/POS-Kodierung', () => {
  it('kodiert deutsche Umlaute in der Druckerzeichentabelle', () => {
    const bytes = encodeText('Müller', 'CP858')
    expect(Array.from(bytes)).toEqual([0x4d, 0x81, 0x6c, 0x6c, 0x65, 0x72])
  })

  it('ersetzt nicht darstellbare Zeichen durch ein Fragezeichen statt Muell zu drucken', () => {
    const bytes = encodeText('Ω', 'CP858')
    expect(Array.from(bytes)).toEqual([0x3f])
  })

  it('beginnt jeden Auftrag mit Reset und Zeichentabelle', () => {
    const buffer = encodeDocument([], printer)
    expect(Array.from(buffer.subarray(0, 2))).toEqual([0x1b, 0x40])
    expect(Array.from(buffer.subarray(2, 5))).toEqual([0x1b, 0x74, 19])
  })

  it('sendet am Ende einen Schnittbefehl, wenn der Cutter genutzt wird', () => {
    const document = buildBallotDocument(event, round(), candidates)
    const buffer = encodeDocument(buildBallotOps(document, printer, config), printer)
    const tail = Array.from(buffer.subarray(buffer.length - 4))
    expect(tail).toEqual([0x1d, 0x56, 66, 0x00])
  })

  it('setzt ohne Cutter stattdessen eine Schnittmarkierung', () => {
    const document = buildBallotDocument(event, round(), candidates)
    const lines = renderPreviewLines(
      buildBallotOps(document, { ...printer, cutEveryBallot: false }, config),
      printer.charsPerLine
    )
    expect(lines.join('\n')).toContain('SCHNITT')
  })
})

describe('Bon-Layout', () => {
  const document = buildBallotDocument(event, round(), candidates)
  const lines = renderPreviewLines(buildBallotOps(document, printer, config), printer.charsPerLine)
  const text = lines.join('\n')

  it('enthält Organisation, Wahlgang, Anweisung und Kennung', () => {
    expect(text).toContain('Musterverband Beispielstadt')
    expect(text).toContain('WAHLGANG 07')
    expect(text).toContain('DELEGIERTENWAHL')
    expect(text).toContain('Maximal 8 Stimmen.')
    expect(text).toContain('WG: MV26-20260912-WG07')
  })

  it('setzt vor jeden Kandidaten ein großzügiges Ankreuzfeld', () => {
    for (const candidate of candidates) {
      expect(text).toContain(`[   ] ${candidate.displayName}`)
    }
  })

  it('haelt jede Zeile innerhalb der Druckbreite', () => {
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(printer.charsPerLine)
  })

  it('bricht lange Namen um und lässt die Checkbox in der ersten Zeile', () => {
    const langerName: Candidate = {
      ...candidates[0],
      id: 'lang',
      displayName: 'Dr. Maximilian Alexander von Mustermann-Beispiel'
    }
    const langesDokument = buildBallotDocument(event, round(), [langerName])
    const zeilen = renderPreviewLines(buildBallotOps(langesDokument, printer, config), printer.charsPerLine)

    const erste = zeilen.findIndex((zeile) => zeile.includes('[   ] Dr. Maximilian'))
    expect(erste).toBeGreaterThan(-1)
    // Fortsetzungszeile steht eingerückt unter dem Namen, nicht unter der Box.
    expect(zeilen[erste + 1]).toMatch(/^ {6}\S/)
    expect(zeilen[erste + 1]).toContain('Mustermann-Beispiel')
    expect(zeilen.every((zeile) => zeile.length <= printer.charsPerLine)).toBe(true)
  })

  it('erhält den Innenraum der Checkbox als Markierungsflaeche', () => {
    // Der Umbruch darf "[   ]" niemals zu "[ ]" zusammenziehen.
    expect(text).not.toContain('[ ] Max Mustermann')
    expect(wrapText('Ein sehr langer Text zum Umbrechen', 12).length).toBeGreaterThan(1)
  })

  it('kennzeichnet Testdrucke oben und unten als ungültig', () => {
    const testLines = renderPreviewLines(
      buildBallotOps(document, printer, config, { testPrint: true }),
      printer.charsPerLine
    )
    const marker = testLines.filter((line) => line.includes('TESTDRUCK'))
    expect(marker.length).toBe(2)
    expect(testLines.join('\n')).toContain('KEIN GÜLTIGER STIMMZETTEL')
  })

  it('druckt die Zettelversion nur, wenn es konfiguriert ist', () => {
    expect(text).not.toContain('Zettelversion')
    const withVersion = renderPreviewLines(
      buildBallotOps(document, printer, config, { printBallotVersion: true }),
      printer.charsPerLine
    )
    expect(withVersion.join('\n')).toContain('Zettelversion v1')
  })

  it('druckt ab der zweiten Fassung immer die Version', () => {
    // Sobald zwei Fassungen existieren, müssen die Stapel am Papier
    // unterscheidbar sein – unabhängig von der Einstellung.
    const zweiteFassung = buildBallotDocument(event, round({ ballotVersion: 2 }), candidates)
    const zeilen = renderPreviewLines(buildBallotOps(zweiteFassung, printer, config), printer.charsPerLine)
    expect(zeilen.join('\n')).toContain('Zettelversion v2')
  })

  it('stellt beim Akzeptanzverfahren die Voten kompakt hinter jeden Kandidaten', () => {
    const acceptance = buildBallotDocument(
      event,
      round({ procedure: 'acceptance_group', maxVotes: null, template: defaultTemplateFor('acceptance_group', { seats: 5, maxVotes: null, entryCount: 3 }) }),
      candidates
    )
    const acceptanceText = renderPreviewLines(
      buildBallotOps(acceptance, printer, config),
      printer.charsPerLine
    ).join('\n')
    expect(acceptanceText).toContain('JA [ ]')
    expect(acceptanceText).toContain('NEIN [ ]')
    expect(acceptanceText).toContain('ENTH [ ]')
  })

  it('druckt beim Kumulieren mehrere Ankreuzfelder je Bewerber', () => {
    const kumuliert = buildBallotDocument(
      event,
      round({
        seats: 3,
        maxVotes: 3,
        template: {
          ...defaultTemplateFor('group_preprinted', { seats: 3, maxVotes: 3, entryCount: 3 }),
          votesPerCandidate: 3
        }
      }),
      candidates
    )
    const zeilen = renderPreviewLines(buildBallotOps(kumuliert, printer, config), printer.charsPerLine)
    const zeile = zeilen.find((line) => line.includes('Max Mustermann')) ?? ''

    // Drei volle Ankreuzfelder vor dem Namen – der Innenraum bleibt erhalten.
    expect(zeile).toContain('[   ] [   ] [   ] Max Mustermann')
    expect(zeilen.every((line) => line.length <= printer.charsPerLine)).toBe(true)
  })

  it('erzeugt für Blanko-Gruppenwahl nummerierte Schreiblinien', () => {
    const blank = buildBallotDocument(
      event,
      round({
        procedure: 'group_blank',
        template: { ...defaultTemplateFor('group_blank', { seats: 8, maxVotes: 8, entryCount: 0 }), blankLines: 8 }
      }),
      []
    )
    const blankText = renderPreviewLines(buildBallotOps(blank, printer, config), printer.charsPerLine).join('\n')
    expect(blankText).toContain(' 1. ____')
    expect(blankText).toContain(' 8. ____')
  })

  it('schaetzt die Zeilenzahl für den Papierverbrauch', () => {
    expect(countLines(buildBallotOps(document, printer, config))).toBeGreaterThan(20)
  })
})

describe('Epson ePOS-XML', () => {
  const document = buildBallotDocument(event, round(), candidates)
  const xml = opsToEposXml(buildBallotOps(document, printer, config), printer)

  it('nutzt das Epson-Schema', () => {
    expect(xml.startsWith('<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">')).toBe(true)
  })

  it('uebertraegt Kandidaten und Kennung', () => {
    expect(xml).toContain('Max Mustermann')
    expect(xml).toContain('WG: MV26-20260912-WG07')
  })

  it('maskiert Sonderzeichen XML-sicher', () => {
    const risky = opsToEposXml([{ type: 'text', text: 'A & B <script>' }], printer)
    expect(risky).toContain('A &amp; B &lt;script&gt;')
    expect(risky).not.toContain('<script>')
  })

  it('schließt mit Vorschub und Schnitt ab', () => {
    expect(xml).toContain('<cut type="feed"/>')
  })
})

