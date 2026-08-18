/**
 * Layout des Thermobons (§13, §14, Wahlformen §2/§35/§39).
 *
 * Regeln, die hier zwingend eingehalten werden:
 * - Alle Stimmzettel eines Wahlgangs sind identisch; es gibt KEINE Einzelnummer.
 * - Die Wahlgangkennung steht auf jedem Zettel.
 * - Kandidatenzeilen werden nie über zwei Stimmzettel getrennt (jeder Bon ist
 *   ein zusammenhängender Druckauftrag mit abschliessendem Schnitt).
 * - Testdrucke sind oben UND unten unübersehbar als ungültig markiert.
 */
import { formatDateDe } from '@shared/format'
import type {
  AppConfig,
  BallotDocument,
  BallotPreviewRow,
  BallotSection,
  BallotTemplateConfig,
  PrinterConfig
} from '@shared/types'
import { centerText, cut, feed, ruler, spacing, text, wrapText, type PrintOp } from './ops'

const CHECKBOX = '[   ]'
/**
 * Zeilenabstand für Ankreuzzeilen in Dots (203 dpi ≈ 8 Dots/mm).
 * Normale Schrift: ca. 7 mm, doppelt hohe Schrift: ca. 10 mm — so bleibt der
 * Markierungsbereich in beiden Fällen groß genug (§14).
 */
const CHECKBOX_LINE_SPACING = 56
const CHECKBOX_LINE_SPACING_LARGE = 82

export interface LayoutOptions {
  testPrint?: boolean
  /** Versionsnummer aufdrucken (§16, konfigurierbar). */
  printBallotVersion?: boolean
  printRoundCode?: boolean
}

export function buildBallotOps(
  document: BallotDocument,
  printer: PrinterConfig,
  config: AppConfig,
  options: LayoutOptions = {}
): PrintOp[] {
  const width = printer.charsPerLine
  const labels = config.ballots.labels
  const ops: PrintOp[] = []
  const template = document.template

  const testPrint = options.testPrint === true
  /*
   * Ab der zweiten Fassung wird die Version IMMER aufgedruckt, unabhängig von
   * der Einstellung: Sobald zwei Fassungen desselben Wahlgangs existieren,
   * müssen die Stapel am Papier unterscheidbar sein — sonst ließe sich die
   * Vorgabe „v1 und v2 nicht vermischen" (§58) gar nicht einhalten.
   */
  const printVersion =
    document.version > 1 || (options.printBallotVersion ?? config.ballots.printBallotVersion)
  const printCode = options.printRoundCode ?? config.ballots.printRoundCode

  if (testPrint) {
    ops.push(text(ruler(width, '*'), { align: 'center', bold: true }))
    ops.push(text(labels.testPrintMarker, { align: 'center', bold: true, doubleHeight: true, invert: true }))
    ops.push(text('KEIN GÜLTIGER STIMMZETTEL', { align: 'center', bold: true }))
    ops.push(text(ruler(width, '*'), { align: 'center', bold: true }))
    ops.push(feed(1))
  }

  /* ----------------------------------------------------------------- Kopf */
  if (template.showOrganization) {
    for (const line of wrapText(document.event.organization, width)) {
      ops.push(text(line, { align: 'center', bold: true }))
    }
  }
  if (template.showEventTitle) {
    for (const line of wrapText(document.event.title, width)) {
      ops.push(text(line, { align: 'center' }))
    }
  }
  if (template.showDate) {
    ops.push(text(formatDateDe(document.event.date), { align: 'center' }))
  }
  if (template.showLocation && document.event.location) {
    for (const line of wrapText(document.event.location, width)) {
      ops.push(text(line, { align: 'center' }))
    }
  }

  ops.push(feed(1))

  if (document.round.banner) {
    for (const line of wrapText(document.round.banner, width)) {
      ops.push(text(line, { align: 'center', bold: true }))
    }
  }
  if (template.showRoundNumber) {
    ops.push(text(`WAHLGANG ${document.round.label}`, { align: 'center', bold: true, doubleHeight: true }))
  }

  for (const line of wrapText(document.round.title.toUpperCase(), width)) {
    ops.push(text(line, { align: 'center', bold: true }))
  }

  if (document.round.seatStart !== undefined && document.round.seatEnd !== undefined) {
    ops.push(
      text(`LISTENPLÄTZE ${document.round.seatStart} BIS ${document.round.seatEnd}`, {
        align: 'center',
        bold: true
      })
    )
  }

  ops.push(feed(1))

  /* ------------------------------------------------- Antragstext / Angaben */
  if (document.round.motionText) {
    for (const line of wrapText(document.round.motionText, width)) {
      ops.push(text(line, { align: 'center' }))
    }
    ops.push(feed(1))
  }

  if (document.round.seats > 1) {
    ops.push(text(`${document.round.seats} Positionen zu besetzen.`, { align: 'center' }))
  }
  if (document.round.maxVotes !== null) {
    ops.push(
      text(`Maximal ${document.round.maxVotes} ${document.round.maxVotes === 1 ? 'Stimme' : 'Stimmen'}.`, {
        align: 'center',
        bold: true
      })
    )
  }

  if (document.round.instructions) {
    ops.push(feed(1))
    for (const line of wrapText(document.round.instructions, width)) {
      ops.push(text(line, { align: 'center' }))
    }
  }

  ops.push(feed(1))
  ops.push(text(ruler(width), { align: 'center' }))
  ops.push(feed(1))

  /* ------------------------------------------------------------- Sektionen */
  for (const section of document.sections) {
    ops.push(...sectionOps(section, width, template))
  }

  /* ------------------------------------------------------------------ Fuss */
  if (document.round.notice) {
    ops.push(feed(1))
    for (const line of wrapText(document.round.notice, width)) {
      ops.push(text(line, { align: 'center' }))
    }
  }

  ops.push(feed(1))
  if (printCode) {
    ops.push(text(`WG: ${document.round.code}`, { align: 'center', bold: true }))
  }
  if (printVersion) {
    // Ab v2 hervorgehoben: die Fassung muss beim Sortieren der Stapel sofort
    // ins Auge fallen.
    ops.push(
      text(`Zettelversion v${document.version}`, {
        align: 'center',
        bold: document.version > 1,
        invert: document.version > 1
      })
    )
  }

  if (testPrint) {
    ops.push(feed(1))
    ops.push(text(ruler(width, '*'), { align: 'center', bold: true }))
    ops.push(text(labels.testPrintMarker, { align: 'center', bold: true, invert: true }))
    ops.push(text(ruler(width, '*'), { align: 'center', bold: true }))
  }

  ops.push(feed(1))
  ops.push(text(markerLine(labels.endMarker, width, '='), { align: 'center', bold: true }))

  if (printer.cutEveryBallot) {
    ops.push(cut())
  } else {
    // Ohne Cutter eine deutliche Schnittmarkierung setzen (§46).
    ops.push(feed(1))
    ops.push(text(markerLine(labels.cutMarker, width, '-'), { align: 'center' }))
    ops.push(feed(printer.feedLinesBeforeCut))
  }

  return ops
}

/** Beschriftete Trennlinie, z. B. "========== ENDE ==========". */
function markerLine(label: string, width: number, char: string): string {
  const middle = ` ${label} `
  const fill = Math.max(0, width - middle.length)
  const left = Math.floor(fill / 2)
  return char.repeat(left) + middle + char.repeat(fill - left)
}

function sectionOps(section: BallotSection, width: number, template: BallotTemplateConfig): PrintOp[] {
  const ops: PrintOp[] = []
  const large = template.largeCandidates
  const gap = Math.max(0, template.candidateSpacingLines)
  const lineSpacing = large ? CHECKBOX_LINE_SPACING_LARGE : CHECKBOX_LINE_SPACING
  // Doppelt breite Zeichen halbieren die Zeichen je Zeile; die Höhe nicht.
  const style = { bold: true, doubleHeight: large }

  if (section.title) {
    for (const line of wrapText(section.title, width)) {
      ops.push(text(line, { bold: true }))
    }
    ops.push(feed(1))
  }

  switch (section.kind) {
    case 'choice_list': {
      ops.push(spacing(lineSpacing))
      // Beim Kumulieren bekommt jeder Bewerber mehrere Ankreuzfelder.
      const boxCount = Math.max(1, template.votesPerCandidate)
      const boxes = Array.from({ length: boxCount }, () => CHECKBOX).join(' ')
      for (const candidate of section.candidates) {
        const prefix = candidate.number !== undefined ? `${String(candidate.number).padStart(2, '0')} ` : ''
        const indent = boxes.length + 1
        // Die Checkbox wird bewusst NICHT durch den Zeilenumbruch geschickt:
        // sonst würde ihr Innenraum zusammengezogen und der Markierungsbereich
        // zu klein (§14). Fortsetzungszeilen langer Namen stehen eingerückt
        // unter dem Namen, die Checkbox bleibt in der ersten Zeile.
        const [first, ...rest] = wrapText(`${prefix}${candidate.name}`, width - indent)
        ops.push(text(`${boxes} ${first}`, style))
        for (const line of rest) ops.push(text(' '.repeat(indent) + line, style))
        if (gap > 0) {
          ops.push(spacing('default'))
          ops.push(feed(gap))
          ops.push(spacing(lineSpacing))
        }
      }
      ops.push(spacing('default'))
      ops.push(feed(1))
      break
    }

    case 'per_candidate_choice': {
      for (const candidate of section.candidates) {
        const prefix = candidate.number !== undefined ? `${String(candidate.number).padStart(2, '0')} ` : ''
        for (const line of wrapText(`${prefix}${candidate.name}`, width)) {
          ops.push(text(line, style))
        }
        const compact = section.options.join('  ').length + section.options.length * 6 <= width
        ops.push(spacing(lineSpacing))
        if (compact) {
          ops.push(text(section.options.map((option) => `${option} [ ]`).join('  ')))
        } else {
          for (const option of section.options) {
            ops.push(text(`${CHECKBOX} ${option}`))
          }
        }
        ops.push(spacing('default'))
        ops.push(feed(Math.max(1, gap)))
      }
      break
    }

    case 'blank_lines': {
      const count = section.blankLines ?? 0
      for (let index = 1; index <= count; index++) {
        const label = `${String(index).padStart(2, ' ')}. `
        ops.push(text(label + '_'.repeat(Math.max(0, width - label.length))))
        ops.push(feed(Math.max(1, gap)))
      }
      break
    }

    case 'global_options': {
      if (section.candidates.length > 0) {
        // Einzelwahl mit einem Bewerber: Name als Betreff, Optionen darunter.
        ops.push(text('Kandidat:', { align: 'center' }))
        for (const candidate of section.candidates) {
          for (const line of wrapText(candidate.name.toUpperCase(), width)) {
            ops.push(text(line, { align: 'center', bold: true, doubleHeight: true }))
          }
        }
        ops.push(feed(1))
      }
      ops.push(spacing(lineSpacing))
      for (const option of section.options) {
        ops.push(text(`${CHECKBOX} ${option}`, style))
        if (gap > 0) {
          ops.push(spacing('default'))
          ops.push(feed(gap))
          ops.push(spacing(lineSpacing))
        }
      }
      ops.push(spacing('default'))
      ops.push(feed(1))
      break
    }
  }

  return ops
}

/** Eine Zeile der Vorschau samt Auszeichnung, damit die Anzeige dem Druck entspricht. */
export type PreviewRow = BallotPreviewRow

/** Vorschau derselben Operationen (§17 Druckvorschau). */
export function renderPreviewRows(ops: PrintOp[], _width: number): PreviewRow[] {
  const rows: PreviewRow[] = []
  for (const op of ops) {
    switch (op.type) {
      case 'text': {
        // Die Ausrichtung wird als Angabe weitergereicht, nicht durch
        // Leerzeichen erzeugt: sonst verschöben sich Zeilen mit größerer
        // Schrift, weil deren Leerzeichen breiter sind.
        rows.push({
          text: op.text,
          ...(op.align && op.align !== 'left' ? { align: op.align } : {}),
          ...(op.bold ? { bold: true } : {}),
          ...(op.doubleHeight ? { large: true } : {}),
          ...(op.invert ? { invert: true } : {})
        })
        break
      }
      case 'feed':
        for (let index = 0; index < op.lines; index++) rows.push({ text: '' })
        break
      case 'cut':
        rows.push({ text: '' })
        rows.push({ text: 'Abschnitt durch Cutter', cut: true })
        break
      case 'spacing':
        break
    }
  }
  return rows
}

/**
 * Reine Textfassung (Datei-Ausgabe, Protokoll-PDF, Tests): hier wird die
 * Ausrichtung mit Leerzeichen nachgebildet, weil es keine Auszeichnung gibt.
 */
export function renderPreviewLines(ops: PrintOp[], width: number): string[] {
  return renderPreviewRows(ops, width).map((row) => {
    if (row.cut) return '- - - - - - - - -  SCHNITT  - - - - - - - '.slice(0, width)
    if (row.align === 'center') return centerText(row.text, width)
    if (row.align === 'right') return row.text.padStart(width)
    return row.text
  })
}

/** Protokollbeleg – ausdrücklich KEIN Stimmzettel (Wahlformen §32). */
export function buildProtocolSlipOps(
  input: {
    organization: string
    eventTitle: string
    date: string
    roundLabel: string
    roundCode: string
    heading: string
    body: string
  },
  printer: PrinterConfig
): PrintOp[] {
  const width = printer.charsPerLine
  const ops: PrintOp[] = []
  ops.push(text(ruler(width, '='), { align: 'center' }))
  ops.push(text('KEIN STIMMZETTEL', { align: 'center', bold: true, invert: true }))
  ops.push(text(ruler(width, '='), { align: 'center' }))
  ops.push(feed(1))
  for (const line of wrapText(input.organization, width)) ops.push(text(line, { align: 'center', bold: true }))
  for (const line of wrapText(input.eventTitle, width)) ops.push(text(line, { align: 'center' }))
  ops.push(text(formatDateDe(input.date), { align: 'center' }))
  ops.push(feed(1))
  for (const line of wrapText(input.heading.toUpperCase(), width)) {
    ops.push(text(line, { align: 'center', bold: true, doubleHeight: true }))
  }
  ops.push(text(`WAHLGANG ${input.roundLabel}`, { align: 'center' }))
  ops.push(feed(1))
  for (const line of wrapText(input.body, width)) ops.push(text(line))
  ops.push(feed(2))
  ops.push(text('Wahlleitung:', {}))
  ops.push(text('_'.repeat(width)))
  ops.push(feed(1))
  ops.push(text(`WG: ${input.roundCode}`, { align: 'center' }))
  ops.push(feed(1))
  if (printer.cutEveryBallot) ops.push(cut())
  else ops.push(feed(printer.feedLinesBeforeCut))
  return ops
}
