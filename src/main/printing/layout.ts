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
import { formatDateDe, formatDateTimeDe } from '@shared/format'
import { FINAL_DECISION_LABELS } from '@shared/projection'
import { rankCandidates, resultInputKind } from '@shared/result'
import {
  PROCEDURE_LABELS,
  type AppConfig,
  type BallotDocument,
  type BallotPreviewRow,
  type BallotSection,
  type BallotTemplateConfig,
  type ElectionResult,
  type ElectionRound,
  type IsoDateTime,
  type PrinterConfig
} from '@shared/types'
import { centerText, cut, feed, qr, ruler, spacing, text, wrapText, type PrintOp } from './ops'

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
  /*
   * Ein Wahlgang in Vorbereitung hat noch keine Nummer (§7). Ohne die Prüfung
   * auf den Wert stünde in der Vorschau ein blankes "WAHLGANG " — das sieht
   * nach einem Fehler aus, wo nur die Vergabe noch aussteht.
   */
  if (template.showRoundNumber && document.round.label) {
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

  /*
   * Nach welchem Verfahren gewählt wird, entscheidet darüber, wie der Zettel
   * auszufüllen ist. Es gehört deshalb auf das Papier und nicht nur in die
   * Bedienoberfläche — auf dem Zettel in der Hand ist keine Rückfrage möglich.
   */
  if (template.showProcedure) {
    for (const line of wrapText(`Verfahren: ${PROCEDURE_LABELS[document.round.procedure]}`, width)) {
      ops.push(text(line, { align: 'center' }))
    }
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
      case 'qr':
        /*
         * In der Vorschau steht der Inhalt als Text, nicht als Bild.
         *
         * Wer die Vorschau liest, prüft, **was** kodiert wird — ein
         * gezeichneter QR-Code sagte ihm darüber nichts. Beim Voting Pass
         * steht dort ohnehin nur ein Zufallswert, und der gehört sichtbar,
         * damit niemand ihn für eine Mitgliedsnummer hält.
         */
        rows.push({ text: `[QR] ${op.data}`, align: op.align === 'left' ? undefined : op.align })
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
  for (const line of wrapText(input.organization, width))
    ops.push(text(line, { align: 'center', bold: true }))
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

/* ----------------------------------------------------------- Voting Pass */

export interface VotingPassInput {
  organization: string
  eventTitle: string
  date: string
  lastName: string
  firstName: string
  number?: string
  /** Das Geheimnis. Es steht hier genau einmal — und danach nur im QR. */
  token: string
  weight: number
}

/**
 * Der gedruckte Voting Pass.
 *
 * **Kein Stimmzettel**, und das steht ganz oben und umgekehrt gesetzt: Am
 * Einlass liegen beide Sorten Papier nebeneinander auf dem Tisch, und
 * jemand, der sie verwechselt, wirft einen Pass in die Urne.
 *
 * Der Code steht doppelt darauf — als QR für den Scanner und darunter in
 * Zeichen für den Fall, dass die Kamera nicht mag oder das Papier einen Knick
 * hat. Der Zeichenvorrat lässt I, O, 0 und 1 bewusst weg; abgetippt wird er
 * nur im Ausnahmefall, aber dann unter Zeitdruck.
 *
 * Der Name steht dabei: Der Pass ist persönlich, und wer ihn findet, soll ihn
 * zurückgeben können. Er weist die **Stimmberechtigung** nach, nicht die
 * Stimme — was daraus wird, regelt ADR-0006.
 */
export function buildVotingPassOps(input: VotingPassInput, printer: PrinterConfig): PrintOp[] {
  const width = printer.charsPerLine
  const ops: PrintOp[] = []

  ops.push(text(ruler(width, '='), { align: 'center' }))
  ops.push(text('KEIN STIMMZETTEL', { align: 'center', bold: true, invert: true }))
  ops.push(text('VOTING PASS', { align: 'center', bold: true, doubleHeight: true }))
  ops.push(text(ruler(width, '='), { align: 'center' }))
  ops.push(feed(1))

  for (const line of wrapText(input.organization, width))
    ops.push(text(line, { align: 'center', bold: true }))
  for (const line of wrapText(input.eventTitle, width)) ops.push(text(line, { align: 'center' }))
  ops.push(text(formatDateDe(input.date), { align: 'center' }))
  ops.push(feed(1))

  for (const line of wrapText(`${input.lastName}, ${input.firstName}`, width)) {
    ops.push(text(line, { align: 'center', bold: true, doubleHeight: true }))
  }
  if (input.number) ops.push(text(`Nr. ${input.number}`, { align: 'center' }))
  /* Nur erwähnen, wenn es etwas zu erwähnen gibt: In einem Verein trägt
     jeder eine Stimme, und „1 Stimme" auf jedem Pass wäre Rauschen. */
  if (input.weight > 1) {
    ops.push(text(`${input.weight} Stimmen`, { align: 'center', bold: true }))
  }
  ops.push(feed(1))

  ops.push(qr(input.token, 6, 'center'))
  ops.push(feed(1))
  ops.push(text(input.token, { align: 'center', bold: true, doubleWidth: true }))
  ops.push(feed(1))

  /*
   * Drei kurze Zeilen statt eines umbrochenen Absatzes: Auf 42 Zeichen zerreißt
   * ein Umbruch genau die Sätze, auf die es ankommt — und gelesen wird das
   * hier im Vorbeigehen.
   */
  for (const zeile of [
    'Bitte am Einlass vorzeigen.',
    'Nicht in die Urne werfen.',
    'Gilt nur für diese Versammlung.'
  ]) {
    ops.push(text(zeile, { align: 'center' }))
  }
  ops.push(feed(1))
  if (printer.cutEveryBallot) ops.push(cut())
  else ops.push(feed(printer.feedLinesBeforeCut))
  return ops
}

/* ----------------------------------------------------------- Urnenliste */

export interface UrnenlisteInput {
  organization: string
  eventTitle: string
  date: string
  roundLabel: string
  roundCode: string
  /** Der öffentliche Schlüssel des Wahlgangs, damit sich alles nachprüfen lässt. */
  schluessel?: string
  zettel: { serial: string; text: string; weight: number }[]
}

/**
 * Die elektronische Urne, ausgedruckt.
 *
 * **Der Grund, warum es sie gibt:** Ein Ergebnis, das nur der Rechner kennt,
 * ist keines. Diese Liste macht die digitale Wahl genauso nachzählbar wie
 * einen Stapel Zettel — von jedem im Saal, ohne Zugriff auf das Gerät.
 *
 * Jede Zeile trägt eine Seriennummer und die Stimme. Eine Person steht
 * nirgends, und das ist keine Auslassung: Auch bei Papier kann niemand später
 * auf einen Zettel zeigen und sagen „der ist meiner".
 *
 * Die Seriennummer wird gekürzt gedruckt. Vollständig wäre sie 32 Zeichen
 * lang und der Bon dreimal so lang; zum Unterscheiden genügen zwölf, und wer
 * genau nachrechnen will, nimmt ohnehin die Datei.
 */
export function buildUrnenlisteOps(input: UrnenlisteInput, printer: PrinterConfig): PrintOp[] {
  const width = printer.charsPerLine
  const ops: PrintOp[] = []

  ops.push(text(ruler(width, '='), { align: 'center' }))
  ops.push(text('URNENVERZEICHNIS', { align: 'center', bold: true, doubleHeight: true }))
  ops.push(text(ruler(width, '='), { align: 'center' }))
  ops.push(feed(1))
  for (const line of wrapText(input.organization, width))
    ops.push(text(line, { align: 'center', bold: true }))
  for (const line of wrapText(input.eventTitle, width)) ops.push(text(line, { align: 'center' }))
  ops.push(text(formatDateDe(input.date), { align: 'center' }))
  ops.push(text(`Wahlgang ${input.roundLabel} (${input.roundCode})`, { align: 'center' }))
  ops.push(feed(1))

  ops.push(text(`Stimmzettel: ${input.zettel.length}`, { bold: true }))
  const gewicht = input.zettel.reduce((summe, zettel) => summe + zettel.weight, 0)
  if (gewicht !== input.zettel.length) ops.push(text(`Stimmen mit Gewicht: ${gewicht}`, { bold: true }))
  ops.push(text(ruler(width)))

  for (const zettel of input.zettel) {
    ops.push(text(zettel.serial.slice(0, 12)))
    for (const line of wrapText(zettel.text, width - 2, 2)) ops.push(text(`  ${line}`))
    if (zettel.weight > 1) ops.push(text(`  (${zettel.weight} Stimmen)`))
  }

  ops.push(text(ruler(width)))
  if (input.schluessel) {
    ops.push(feed(1))
    ops.push(text('Prüfschlüssel des Wahlgangs:', { bold: true }))
    /* Nur der Anfang: Der vollständige Modulus wären 350 Zeichen. Er steht
       im Protokoll und auf der Leinwand; hier genügt, was zum Abgleichen
       reicht. */
    for (const line of wrapText(input.schluessel.slice(0, 64), width)) ops.push(text(line))
  }
  ops.push(feed(1))
  ops.push(text('Nachgezählt:', {}))
  ops.push(text('_'.repeat(width)))
  ops.push(feed(1))
  if (printer.cutEveryBallot) ops.push(cut())
  else ops.push(feed(printer.feedLinesBeforeCut))
  return ops
}

/* ------------------------------------------------------------- Ergebnisbon */

export interface ResultSlipInput {
  organization: string
  eventTitle: string
  date: string
  round: Pick<ElectionRound, 'roundLabel' | 'roundCode' | 'title' | 'procedure' | 'seats' | 'maxVotes'>
  result: ElectionResult
  /** Namen der als gewählt festgestellten Bewerber, in Ergebnisreihenfolge. */
  electedNames: string[]
  operatorName: string
  printedAt: IsoDateTime
}

/** Zeile mit linksbündigem Text und rechtsbündiger Zahl; kürzt bei Bedarf links. */
function zweiSpalten(links: string, rechts: string, width: number): string {
  const platz = Math.max(1, width - rechts.length - 1)
  const gekuerzt = links.length > platz ? `${links.slice(0, Math.max(1, platz - 1))}.` : links
  return `${gekuerzt.padEnd(platz, ' ')} ${rechts}`
}

/**
 * Ergebnisbeleg zum Weitergeben an die Versammlungsleitung.
 *
 * Ausdrücklich KEIN Stimmzettel und auch kein Ersatz für das Wahlprotokoll:
 * der Bon hält fest, was festgestellt wurde, damit das Ergebnis sofort nach
 * vorne gegeben werden kann. Verbindlich bleibt das unterschriebene Protokoll —
 * deshalb steht die Unterschriftszeile mit darauf.
 */
export function buildResultSlipOps(input: ResultSlipInput, printer: PrinterConfig): PrintOp[] {
  const width = printer.charsPerLine
  const ops: PrintOp[] = []
  const { result, round } = input
  const art = resultInputKind(round)

  ops.push(text(ruler(width, '='), { align: 'center' }))
  ops.push(text('KEIN STIMMZETTEL', { align: 'center', bold: true, invert: true }))
  ops.push(text(ruler(width, '='), { align: 'center' }))
  ops.push(feed(1))

  for (const line of wrapText(input.organization, width))
    ops.push(text(line, { align: 'center', bold: true }))
  for (const line of wrapText(input.eventTitle, width)) ops.push(text(line, { align: 'center' }))
  ops.push(text(formatDateDe(input.date), { align: 'center' }))
  ops.push(feed(1))

  ops.push(text('ERGEBNIS', { align: 'center', bold: true, doubleHeight: true }))
  if (round.roundLabel) ops.push(text(`WAHLGANG ${round.roundLabel}`, { align: 'center', bold: true }))
  for (const line of wrapText(round.title.toUpperCase(), width)) {
    ops.push(text(line, { align: 'center', bold: true }))
  }
  for (const line of wrapText(`Verfahren: ${PROCEDURE_LABELS[round.procedure]}`, width)) {
    ops.push(text(line, { align: 'center' }))
  }
  if (round.seats > 1) ops.push(text(`${round.seats} Positionen zu besetzen.`, { align: 'center' }))
  ops.push(feed(1))

  /* ------------------------------------------------------------- Beteiligung */
  if (result.countingMode === 'counted') {
    ops.push(text(ruler(width), { align: 'center' }))
    if (result.eligibleVoters !== undefined) {
      ops.push(text(zweiSpalten('Stimmberechtigt', String(result.eligibleVoters), width)))
    }
    ops.push(text(zweiSpalten('Abgegebene Stimmzettel', String(result.ballotsCast), width)))
    ops.push(text(zweiSpalten('Gültig', String(result.validBallots), width)))
    ops.push(text(zweiSpalten('Ungültig', String(result.invalidBallots), width)))
    if (result.abstentions !== undefined) {
      ops.push(text(zweiSpalten('Enthaltungen', String(result.abstentions), width)))
    }
    ops.push(text(ruler(width), { align: 'center' }))
    ops.push(feed(1))
  } else {
    ops.push(text('Ohne Auszählung festgestellt:', { align: 'center' }))
    for (const line of wrapText(result.declaration ?? '—', width)) {
      ops.push(text(line, { align: 'center', bold: true }))
    }
    ops.push(feed(1))
  }

  /* ----------------------------------------------------------------- Zahlen */
  if (result.countingMode === 'counted') {
    if (art === 'votes') {
      const rangfolge = rankCandidates(result.resultData.candidates, round.seats, {
        decidedOrder: result.rankOrder
      })
      let grenzeGesetzt = false
      for (const eintrag of rangfolge) {
        if (!eintrag.withinSeats && !grenzeGesetzt && round.seats < rangfolge.length) {
          grenzeGesetzt = true
          ops.push(text(ruler(width, '-'), { align: 'center' }))
          ops.push(text('NICHT GEWÄHLT', { align: 'center' }))
        }
        const zeichen = eintrag.tied ? '=' : eintrag.withinSeats ? '*' : ' '
        const name = `${zeichen}${String(eintrag.rank).padStart(2, '0')} ${eintrag.name}`
        ops.push(text(zweiSpalten(name, String(eintrag.votes ?? 0), width), { bold: eintrag.withinSeats }))
      }
      if (rangfolge.some((eintrag) => eintrag.tied)) {
        ops.push(feed(1))
        for (const line of wrapText(
          '= Rang nicht entschieden: Stimmengleichheit. Die Versammlung muss die Reihenfolge klären.',
          width
        )) {
          ops.push(text(line))
        }
      }
    } else if (art === 'yes_no_abstain') {
      /*
       * In der Rangfolge, nicht in der Eingabereihenfolge.
       *
       * Bei einer Delegiertenwahl ist genau das die Frage, mit der jemand
       * nach vorne geht: Wer ist Delegierter, wer Ersatz — und in welcher
       * Reihenfolge wird nachgerückt.
       */
      const rangfolge = rankCandidates(result.resultData.candidates, round.seats, {
        acceptance: true,
        decidedOrder: result.rankOrder
      })
      let grenzeGesetzt = false
      for (const eintrag of rangfolge) {
        /* Eine Linie zwischen Gewählten und Nichtgewählten — sie trennt zwei
           verschiedene Aussagen, nicht nur zwei Zeilen. */
        if (!eintrag.withinSeats && !grenzeGesetzt) {
          grenzeGesetzt = true
          ops.push(text(ruler(width, '-'), { align: 'center' }))
          ops.push(text('NICHT GEWÄHLT', { align: 'center' }))
        }
        const rang = eintrag.withinSeats ? `${String(eintrag.rank).padStart(2, '0')} ` : '   '
        const zeichen = eintrag.tied ? '=' : eintrag.withinSeats ? '*' : ' '
        for (const line of wrapText(`${zeichen}${rang}${eintrag.name}`, width, 4)) {
          ops.push(text(line, { bold: eintrag.withinSeats }))
        }
        /*
         * Feste Spaltenbreiten statt rechtsbuendig: so stehen die Zahlen
         * untereinander und lassen sich beim Vorlesen Zeile für Zeile
         * abgleichen.
         */
        const spalte = (label: string, wert: number): string => `${label} ${String(wert).padStart(4, ' ')}`
        ops.push(
          text(
            `    ${spalte('Ja  ', eintrag.yes ?? 0)}  ${spalte('Nein', eintrag.no ?? 0)}  ${spalte('Enth', eintrag.abstain ?? 0)}`
          )
        )
      }
      if (rangfolge.some((eintrag) => eintrag.tied)) {
        ops.push(feed(1))
        for (const line of wrapText(
          '= Rang nicht entschieden: gleiche Ja- und Nein-Zahl. Die Versammlung muss die Reihenfolge klären.',
          width
        )) {
          ops.push(text(line))
        }
      }
    }

    const global = result.resultData
    if (global.yes !== undefined || global.no !== undefined || global.abstentions !== undefined) {
      ops.push(feed(1))
      if (global.yes !== undefined) ops.push(text(zweiSpalten('Ja', String(global.yes), width)))
      if (global.no !== undefined) ops.push(text(zweiSpalten('Nein', String(global.no), width)))
      if (global.abstentions !== undefined) {
        ops.push(text(zweiSpalten('Enthaltung', String(global.abstentions), width)))
      }
    }
    ops.push(feed(1))
  }

  /* ----------------------------------------------------------- Feststellung */
  ops.push(text(ruler(width), { align: 'center' }))
  if (result.finalDecision) {
    for (const line of wrapText(FINAL_DECISION_LABELS[result.finalDecision], width)) {
      ops.push(text(line, { align: 'center', bold: true, doubleHeight: true }))
    }
  }
  if (result.determination) {
    for (const line of wrapText(result.determination, width)) ops.push(text(line, { align: 'center' }))
  }
  if (input.electedNames.length) {
    ops.push(feed(1))
    ops.push(text('Gewählt:', { bold: true }))
    for (const name of input.electedNames) {
      for (const line of wrapText(`- ${name}`, width, 2)) ops.push(text(line))
    }
  }
  if (result.lotDecision) {
    ops.push(feed(1))
    for (const line of wrapText(`Losentscheid: ${result.lotDecision}`, width)) ops.push(text(line))
  }
  ops.push(text(ruler(width), { align: 'center' }))

  /* ------------------------------------------------------------------ Fuss */
  ops.push(feed(1))
  ops.push(text('Vorläufiger Beleg. Verbindlich ist das', { align: 'center' }))
  ops.push(text('unterschriebene Wahlprotokoll.', { align: 'center' }))
  ops.push(feed(2))
  ops.push(text('Wahlleitung:'))
  ops.push(text('_'.repeat(width)))
  ops.push(feed(1))
  ops.push(text(`WG: ${round.roundCode}`, { align: 'center' }))
  ops.push(text(`Gedruckt ${formatDateTimeDe(input.printedAt)}`, { align: 'center' }))
  for (const line of wrapText(`durch ${input.operatorName}`, width)) {
    ops.push(text(line, { align: 'center' }))
  }
  ops.push(feed(1))
  if (printer.cutEveryBallot) ops.push(cut())
  else ops.push(feed(printer.feedLinesBeforeCut))
  return ops
}
