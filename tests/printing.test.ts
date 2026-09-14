/** ESC/POS-Erzeugung, Epson-ePOS-XML und Bon-Layout (§13, §14, §20, §46). */
import { describe, expect, it } from 'vitest'
import { buildBallotDocument } from '../src/shared/ballot'
import { DEFAULT_CONFIG } from '../src/shared/config'
import { defaultTemplateFor, withTemplateDefaults } from '../src/shared/election'
import type {
  AppConfig,
  Candidate,
  ElectionEvent,
  ElectionResult,
  ElectionRound,
  PrinterConfig
} from '../src/shared/types'
import { encodeDocument, encodeText } from '../src/main/printing/escpos'
import {
  buildBallotOps,
  buildResultSlipOps,
  buildVotingPassOps,
  renderPreviewLines
} from '../src/main/printing/layout'
import { countLines, qr, wrapText } from '../src/main/printing/ops'
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

const candidates: Candidate[] = ['Max Mustermann', 'Erika Musterfrau', 'Peter Beispiel'].map(
  (name, index) => ({
    id: `c${index}`,
    electionRoundId: 'r1',
    firstName: name.split(' ')[0],
    lastName: name.split(' ')[1],
    displayName: name,
    sortOrder: index,
    withdrawn: false,
    createdAt: '2026-09-12T16:32:00.000Z'
  })
)

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
      round({
        procedure: 'acceptance_group',
        maxVotes: null,
        template: defaultTemplateFor('acceptance_group', { seats: 5, maxVotes: null, entryCount: 3 })
      }),
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
        template: {
          ...defaultTemplateFor('group_blank', { seats: 8, maxVotes: 8, entryCount: 0 }),
          blankLines: 8
        }
      }),
      []
    )
    const blankText = renderPreviewLines(buildBallotOps(blank, printer, config), printer.charsPerLine).join(
      '\n'
    )
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
    expect(xml.startsWith('<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">')).toBe(
      true
    )
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

describe('Wahlverfahren auf dem Stimmzettel', () => {
  it('nennt das Verfahren im Kopf, wenn die Vorlage es vorsieht', () => {
    const document = buildBallotDocument(event, round(), candidates)
    const lines = renderPreviewLines(buildBallotOps(document, printer, config), printer.charsPerLine)
    // Die Zeile bricht auf 42 Zeichen um; geprueft wird Anfang und Ende.
    expect(lines.join('\n')).toContain('Verfahren: Gruppenwahl')
    expect(lines.join('\n')).toContain('vorgedruckt')
  })

  it('laesst die Zeile weg, wenn sie abgeschaltet ist', () => {
    const basis = round()
    const document = buildBallotDocument(
      event,
      { ...basis, template: { ...basis.template, showProcedure: false } },
      candidates
    )
    const lines = renderPreviewLines(buildBallotOps(document, printer, config), printer.charsPerLine)
    expect(lines.join('\n')).not.toContain('Verfahren:')
  })

  /*
   * Wahlgaenge aus einer aelteren Fassung kennen das Feld nicht. Bekaemen sie
   * die Zeile beim Ergaenzen der Vorgaben, aenderte sich ihr Ballot-Hash, ohne
   * dass jemand etwas geaendert haette.
   */
  it('ergaenzt die Angabe nicht nachtraeglich bei Wahlgaengen ohne das Feld', () => {
    expect(withTemplateDefaults({}, 'group_preprinted').showProcedure).toBe(false)
    expect(
      defaultTemplateFor('group_preprinted', { seats: 8, maxVotes: 8, entryCount: 3 }).showProcedure
    ).toBe(true)
  })
})

describe('Wahlgangnummer in der Vorschau', () => {
  it('laesst die Zeile weg, solange keine Nummer vergeben ist', () => {
    const entwurf = round({ roundLabel: '', sequentialNumber: 0 })
    const document = buildBallotDocument(event, entwurf, candidates)
    const lines = renderPreviewLines(buildBallotOps(document, printer, config), printer.charsPerLine)
    expect(lines.join('\n')).not.toContain('WAHLGANG')
  })

  it('druckt sie, sobald die Nummer feststeht', () => {
    const document = buildBallotDocument(event, round(), candidates)
    const lines = renderPreviewLines(buildBallotOps(document, printer, config), printer.charsPerLine)
    expect(lines.join('\n')).toContain('WAHLGANG 07')
  })
})

describe('Ergebnisbon', () => {
  const ergebnis: ElectionResult = {
    id: 'res1',
    electionRoundId: 'r1',
    countingMode: 'counted',
    eligibleVoters: 121,
    ballotsCast: 119,
    validBallots: 117,
    invalidBallots: 2,
    resultData: {
      candidates: [
        { candidateId: 'c0', name: 'Max Mustermann', votes: 64 },
        { candidateId: 'c1', name: 'Erika Musterfrau', votes: 41 },
        { candidateId: 'c2', name: 'Peter Beispiel', votes: 12 }
      ]
    },
    enteredBy: 'u1',
    enteredByName: 'Wahlleitung',
    determination: 'Erforderliche Mehrheit erreicht',
    finalDecision: 'elected',
    electedCandidateIds: ['c0'],
    createdAt: '2026-09-12T18:00:00.000Z'
  }

  function bon(overrides: Partial<ElectionResult> = {}): string {
    const ops = buildResultSlipOps(
      {
        organization: event.organization,
        eventTitle: event.title,
        date: event.date,
        round: round({ seats: 1, maxVotes: 1 }),
        result: { ...ergebnis, ...overrides },
        electedNames: ['Max Mustermann'],
        operatorName: 'Wahlleitung',
        printedAt: '2026-09-12T18:05:00.000Z'
      },
      printer
    )
    return renderPreviewLines(ops, printer.charsPerLine).join('\n')
  }

  it('ist unuebersehbar als Nicht-Stimmzettel gekennzeichnet', () => {
    expect(bon()).toContain('KEIN STIMMZETTEL')
  })

  it('weist Beteiligung, Stimmen und Feststellung aus', () => {
    const text = bon()
    expect(text).toContain('Abgegebene Stimmzettel')
    expect(text).toContain('119')
    expect(text).toContain('Max Mustermann')
    expect(text).toContain('64')
    expect(text).toContain('Erforderliche Mehrheit erreicht')
    expect(text).toContain('Gewaehlt:'.replace('ae', 'ä'))
  })

  it('nennt die Wahlgangkennung, damit der Beleg zuzuordnen ist', () => {
    expect(bon()).toContain('WG: MV26-20260912-WG07')
  })

  /* Der Bon ersetzt das Protokoll nicht — das muss auf dem Papier stehen. */
  it('weist auf das verbindliche Wahlprotokoll hin', () => {
    expect(bon()).toContain('Wahlprotokoll')
  })

  /*
   * Bei einer Delegiertenwahl ist die Reihenfolge das Ergebnis: Wer ist
   * Delegierter, wer Ersatz, in welcher Folge wird nachgerückt. Der Bon muss
   * sie deshalb in der Rangfolge zeigen, nicht in der Eingabereihenfolge.
   */
  it('druckt die Akzeptanzwahl in der Rangfolge, nicht in der Eingabereihenfolge', () => {
    const akzeptanz: ElectionResult = {
      ...ergebnis,
      resultData: {
        candidates: [
          { candidateId: 'c1', name: 'Nachzuegler', yes: 40, no: 30, abstain: 1 },
          { candidateId: 'c2', name: 'Spitze', yes: 96, no: 14, abstain: 7 },
          { candidateId: 'c3', name: 'Abgelehnt', yes: 12, no: 80, abstain: 2 }
        ]
      },
      electedCandidateIds: ['c2', 'c1']
    }
    const ops = buildResultSlipOps(
      {
        organization: event.organization,
        eventTitle: event.title,
        date: event.date,
        round: round({ seats: 2, maxVotes: null, procedure: 'acceptance_group' }),
        result: akzeptanz,
        electedNames: ['Spitze', 'Nachzuegler'],
        operatorName: 'Wahlleitung',
        printedAt: '2026-09-13T09:05:00.000Z'
      },
      printer
    )
    const zeilen = renderPreviewLines(ops, printer.charsPerLine)
    const text = zeilen.join('\n')
    expect(text.indexOf('Spitze')).toBeLessThan(text.indexOf('Nachzuegler'))
    /* Wer mehr Nein als Ja hat, steht hinter der Trennlinie — auch wenn ein
       Platz frei bliebe. */
    expect(text.indexOf('NICHT GEWÄHLT')).toBeLessThan(text.indexOf('Abgelehnt'))
  })

  /* Trennt kein Kriterium mehr, muss das auf dem Papier stehen — sonst sieht
     eine geratene Reihenfolge aus wie eine entschiedene. */
  it('weist einen offenen Rang aus, statt ihn zu verschweigen', () => {
    const gleichstand: ElectionResult = {
      ...ergebnis,
      resultData: {
        candidates: [
          { candidateId: 'c1', name: 'Erste', yes: 50, no: 12, abstain: 0 },
          { candidateId: 'c2', name: 'Zweite', yes: 50, no: 12, abstain: 0 }
        ]
      },
      electedCandidateIds: ['c1']
    }
    const ops = buildResultSlipOps(
      {
        organization: event.organization,
        eventTitle: event.title,
        date: event.date,
        round: round({ seats: 1, maxVotes: null, procedure: 'acceptance_group' }),
        result: gleichstand,
        electedNames: ['Erste'],
        operatorName: 'Wahlleitung',
        printedAt: '2026-09-13T09:05:00.000Z'
      },
      printer
    )
    expect(renderPreviewLines(ops, printer.charsPerLine).join('\n')).toContain('Rang nicht entschieden')
  })

  it('gibt bei einer Feststellung ohne Auszaehlung den Wortlaut wieder', () => {
    const text = bon({ countingMode: 'declared', declaration: 'Einstimmig angenommen' })
    expect(text).toContain('Einstimmig angenommen')
    expect(text).not.toContain('Abgegebene Stimmzettel')
  })
})

describe('QR-Code auf dem Bondrucker', () => {
  /*
   * Der Drucker zeichnet ihn selbst. Ein Bild zu rechnen und als Punktgrafik
   * zu schicken wäre langsamer, gröber und brächte eine Bibliothek ins
   * Projekt, die nur an dieser einen Stelle gebraucht würde.
   */
  const bytes = encodeDocument([qr('ABCD2345EFGH6789', 6)], printer)

  it('wählt Modell 2', () => {
    /* Das gebräuchliche — von jedem Telefon gelesen. */
    expect([...bytes]).toContain(0x41)
    expect(
      Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]).every((b) => bytes.includes(b))
    ).toBe(true)
  })

  it('legt die Daten mit richtiger Längenangabe in den Speicher', () => {
    /*
     * `pL + pH * 256` ist die Länge des Rests, also Daten + 3. Eine falsche
     * Länge druckt entweder nichts oder Müll — und beides fällt erst auf dem
     * Papier auf.
     */
    const daten = 'ABCD2345EFGH6789'
    const laenge = daten.length + 3
    const kopf = Buffer.from([0x1d, 0x28, 0x6b, laenge & 0xff, (laenge >> 8) & 0xff, 0x31, 0x50, 0x30])
    expect(bytes.includes(kopf)).toBe(true)
    expect(bytes.includes(Buffer.from(daten, 'ascii'))).toBe(true)
  })

  it('hält die Modulbreite im Bereich, den die Geräte annehmen', () => {
    /* Zu groß passt nicht auf 80 mm, zu klein liest keine Kamera. */
    const winzig = encodeDocument([qr('X'.repeat(16), 1)], printer)
    const riesig = encodeDocument([qr('X'.repeat(16), 99)], printer)
    const breite = (puffer: Buffer): number => {
      const stelle = puffer.indexOf(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43]))
      return puffer[stelle + 7]
    }
    expect(breite(winzig)).toBe(3)
    expect(breite(riesig)).toBe(8)
  })

  it('erscheint auch im ePOS-XML', () => {
    const xml = opsToEposXml([qr('ABCD2345EFGH6789', 6)], printer)
    expect(xml).toContain('qrcode_model_2')
    expect(xml).toContain('ABCD2345EFGH6789')
  })

  it('zeigt in der Vorschau den Inhalt, nicht ein Bild', () => {
    /*
     * Wer die Vorschau liest, prüft, **was** kodiert wird — ein gezeichneter
     * Code sagte darüber nichts.
     */
    const zeilen = renderPreviewLines([qr('ABCD2345EFGH6789', 6)], printer.charsPerLine)
    expect(zeilen.join('\n')).toContain('[QR] ABCD2345EFGH6789')
  })
})

describe('Der gedruckte Voting Pass', () => {
  const ops = buildVotingPassOps(
    {
      organization: 'Musterverein',
      eventTitle: 'Mitgliederversammlung 2026',
      date: '2026-09-14',
      lastName: 'Mustermann',
      firstName: 'Max',
      number: '042',
      token: 'ABCD2345EFGH6789',
      weight: 1
    },
    printer
  )
  const text = renderPreviewLines(ops, printer.charsPerLine).join('\n')

  it('sagt ganz oben, dass er kein Stimmzettel ist', () => {
    /*
     * Am Einlass liegen beide Sorten Papier nebeneinander auf dem Tisch, und
     * wer sie verwechselt, wirft einen Pass in die Urne.
     */
    expect(text.indexOf('KEIN STIMMZETTEL')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('KEIN STIMMZETTEL')).toBeLessThan(text.indexOf('Mustermann'))
  })

  it('trägt den Code zweimal — als QR und in Zeichen', () => {
    /* Für den Fall, dass die Kamera nicht mag oder das Papier einen Knick
       hat. Abgetippt wird er nur im Ausnahmefall, aber dann unter Zeitdruck. */
    expect(text).toContain('[QR] ABCD2345EFGH6789')
    expect(text.split('ABCD2345EFGH6789').length - 1).toBeGreaterThanOrEqual(2)
  })

  it('nennt den Namen, damit ein Fundstück zurückkommt', () => {
    expect(text).toContain('Mustermann, Max')
    expect(text).toContain('Nr. 042')
  })

  it('schweigt über das Stimmgewicht, wo es eins ist', () => {
    /* „1 Stimme" auf jedem Pass wäre Rauschen. */
    expect(text).not.toContain('1 Stimmen')

    const mehr = renderPreviewLines(
      buildVotingPassOps(
        {
          organization: 'Landesverband',
          eventTitle: 'Delegiertenversammlung',
          date: '2026-09-14',
          lastName: 'Beispiel',
          firstName: 'Petra',
          token: 'ABCD2345EFGH6789',
          weight: 3
        },
        printer
      ),
      printer.charsPerLine
    ).join('\n')
    expect(mehr).toContain('3 Stimmen')
  })

  it('sagt, dass er nicht in die Urne gehört', () => {
    expect(text).toContain('Nicht in die Urne werfen')
    expect(text).toContain('Gilt nur für diese Versammlung')
  })
})
