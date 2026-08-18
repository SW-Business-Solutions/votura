/**
 * Druckdienst (§19, §20, §21, §35, §36, §48, §79).
 *
 * Harte Regeln:
 * - Ein unklarer oder abgebrochener Auftrag wird NIEMALS automatisch wiederholt.
 * - Gezählt wird, was an den Treiber übermittelt wurde. "Physisch gedruckt"
 *   behauptet die Anwendung erst, wenn ein Mensch es bestätigt hat.
 * - Ein identischer Auftrag (Idempotency-Key) wird nicht doppelt ausgeführt.
 */
import { randomUUID } from 'node:crypto'
import type { PrintRequest, PrintStartResult } from '@shared/ipc'
import type {
  PrintBatch,
  PrintBatchKind,
  PrintBatchStatus,
  PrinterTestResult,
  PrintProgress,
  UUID
} from '@shared/types'
import { db } from '../db'
import { optionalNumber, optionalString } from '../db/driver'
import { logger } from '../logger'
import { createDriver, PrinterError } from '../printing/drivers'
import { buildBallotOps, buildProtocolSlipOps } from '../printing/layout'
import { countLines, type PrintOp } from '../printing/ops'
import { appendAudit } from './audit'
import { requirePermission, requirePinIfConfigured } from './auth'
import { approvedDocument } from './ballots'
import { getEvent } from './events'
import { getRound } from './rounds'
import { getConfig, getPrinter } from './settings'

interface BatchRow {
  id: string
  round_id: string
  ballot_version: number
  kind: string
  printer_id: string
  printer_name: string
  requested_copies: number
  submitted_copies: number
  failed_copies: number
  confirmed_copies: number | null
  status: string
  reason: string | null
  idempotency_key: string
  operator_id: string
  operator_name: string
  started_at: string
  completed_at: string | null
  error_message: string | null
}

function mapBatch(row: BatchRow): PrintBatch {
  return {
    id: row.id,
    electionRoundId: row.round_id,
    ballotVersion: Number(row.ballot_version),
    kind: row.kind as PrintBatchKind,
    printerId: row.printer_id,
    printerName: row.printer_name,
    requestedCopies: Number(row.requested_copies),
    submittedCopies: Number(row.submitted_copies),
    failedCopies: Number(row.failed_copies),
    confirmedCopies: optionalNumber(row.confirmed_copies),
    status: row.status as PrintBatchStatus,
    reason: optionalString(row.reason),
    idempotencyKey: row.idempotency_key,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    startedAt: row.started_at,
    completedAt: optionalString(row.completed_at),
    errorMessage: optionalString(row.error_message)
  }
}

export function getBatch(id: UUID): PrintBatch {
  const row = db().prepare(`SELECT * FROM print_batches WHERE id = ?`).get<BatchRow>(id)
  if (!row) throw new Error('Druckauftrag nicht gefunden.')
  return mapBatch(row)
}

export function listBatches(roundId: UUID): PrintBatch[] {
  return db()
    .prepare(`SELECT * FROM print_batches WHERE round_id = ? ORDER BY started_at DESC`)
    .all<BatchRow>(roundId)
    .map(mapBatch)
}

/** Aufträge, die beim letzten Programmende nicht sauber beendet wurden (§34/§35). */
export function unclearBatches(): PrintBatch[] {
  return db()
    .prepare(`SELECT * FROM print_batches WHERE status IN ('running','unknown') ORDER BY started_at DESC`)
    .all<BatchRow>()
    .map(mapBatch)
}

/**
 * Beim Programmstart: alles, was noch "running" ist, kann nur ein Absturz sein.
 * Der Auftrag wird als unklar markiert — nie automatisch fortgesetzt.
 */
export function markInterruptedBatches(): number {
  const running = db()
    .prepare(`SELECT * FROM print_batches WHERE status = 'running'`)
    .all<BatchRow>()
  for (const row of running) {
    db()
      .prepare(`UPDATE print_batches SET status = 'unknown', error_message = ? WHERE id = ?`)
      .run(
        'Die Anwendung wurde während des Druckvorgangs beendet. Der Status der restlichen Exemplare ist unbekannt.',
        row.id
      )
    appendAudit({
      action: 'print.batch_interrupted',
      electionRoundId: row.round_id,
      previousValue: { status: 'running', submitted: Number(row.submitted_copies) },
      newValue: { status: 'unknown', requested: Number(row.requested_copies) },
      reason: 'Programmabbruch während des Drucks'
    })
  }
  // Wahlgänge, die im Druckstatus hängen geblieben sind, zurückstellen.
  db().prepare(`UPDATE rounds SET status = 'ready' WHERE status = 'printing'`).run()
  return running.length
}

/* ------------------------------------------------------------- Fortschritt */

type ProgressListener = (progress: PrintProgress) => void
const progressListeners: ProgressListener[] = []
const abortedBatches = new Set<string>()

export function onPrintProgress(listener: ProgressListener): void {
  progressListeners.push(listener)
}

function emitProgress(batch: PrintBatch): void {
  const progress: PrintProgress = {
    batchId: batch.id,
    electionRoundId: batch.electionRoundId,
    requestedCopies: batch.requestedCopies,
    submittedCopies: batch.submittedCopies,
    failedCopies: batch.failedCopies,
    status: batch.status,
    errorMessage: batch.errorMessage
  }
  for (const listener of progressListeners) listener(progress)
}

export function abortBatch(batchId: UUID): PrintBatch {
  const session = requirePermission('print.execute')
  const batch = getBatch(batchId)
  if (batch.status !== 'running') return batch
  abortedBatches.add(batchId)
  appendAudit({
    action: 'print.aborted',
    userId: session.user.id,
    userName: session.user.displayName,
    electionRoundId: batch.electionRoundId,
    previousValue: { submitted: batch.submittedCopies, requested: batch.requestedCopies },
    newValue: { status: 'aborted' }
  })
  return getBatch(batchId)
}

/* ------------------------------------------------------------------ Druck */

function updateBatch(id: UUID, fields: Partial<Record<string, string | number | null>>): void {
  const entries = Object.entries(fields)
  if (entries.length === 0) return
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ')
  db()
    .prepare(`UPDATE print_batches SET ${assignments} WHERE id = ?`)
    .run(...entries.map(([, value]) => value ?? null), id)
}

async function runBatch(batchId: UUID, ops: PrintOp[], label: string, copyDelayMs: number): Promise<PrintBatch> {
  let batch = getBatch(batchId)
  const printer = getPrinter(batch.printerId)
  if (!printer) throw new Error(`Der Drucker "${batch.printerId}" ist nicht konfiguriert.`)
  const driver = createDriver(printer)

  emitProgress(batch)

  for (let copy = 1; copy <= batch.requestedCopies; copy++) {
    if (abortedBatches.has(batchId)) {
      updateBatch(batchId, {
        status: 'aborted',
        completed_at: new Date().toISOString(),
        error_message:
          'Der Druckauftrag wurde abgebrochen. Bitte die tatsächlich ausgegebene Menge physisch prüfen und dokumentieren.'
      })
      abortedBatches.delete(batchId)
      batch = getBatch(batchId)
      emitProgress(batch)
      logger.printer.warn(`Batch ${batchId} abgebrochen nach ${batch.submittedCopies} Exemplaren.`)
      return batch
    }

    try {
      await driver.submit(ops, { label: `${label}-${copy}` })
      db()
        .prepare(`UPDATE print_batches SET submitted_copies = submitted_copies + 1 WHERE id = ?`)
        .run(batchId)
      batch = getBatch(batchId)
      emitProgress(batch)
    } catch (error) {
      const message = error instanceof PrinterError ? error.message : String(error)
      // Keine Wiederholung: der Zustand des laufenden Exemplars ist unbekannt (§35).
      updateBatch(batchId, {
        status: 'unknown',
        failed_copies: 1,
        completed_at: new Date().toISOString(),
        error_message: `${message} Angefordert: ${batch.requestedCopies}, bestätigt übermittelt: ${batch.submittedCopies}. Der Status der restlichen Exemplare ist unbekannt – bitte physisch prüfen und die Anzahl dokumentieren.`
      })
      batch = getBatch(batchId)
      emitProgress(batch)
      logger.printer.error(`Batch ${batchId} fehlgeschlagen bei Exemplar ${copy}: ${message}`)
      appendAudit({
        action: 'print.failed',
        electionRoundId: batch.electionRoundId,
        newValue: {
          submitted: batch.submittedCopies,
          requested: batch.requestedCopies,
          status: 'unknown'
        },
        reason: message
      })
      return batch
    }

    if (copyDelayMs > 0 && copy < batch.requestedCopies) {
      await new Promise((resolve) => setTimeout(resolve, copyDelayMs))
    }
  }

  updateBatch(batchId, { status: 'completed', completed_at: new Date().toISOString() })
  batch = getBatch(batchId)
  emitProgress(batch)
  return batch
}

function createBatchRow(input: {
  roundId: UUID
  ballotVersion: number
  kind: PrintBatchKind
  printerId: string
  printerName: string
  copies: number
  reason?: string
  idempotencyKey: string
  operatorId: UUID
  operatorName: string
}): UUID {
  const id = randomUUID()
  db()
    .prepare(
      `INSERT INTO print_batches (id, round_id, ballot_version, kind, printer_id, printer_name,
                                  requested_copies, submitted_copies, failed_copies, status, reason,
                                  idempotency_key, operator_id, operator_name, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'running', ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.roundId,
      input.ballotVersion,
      input.kind,
      input.printerId,
      input.printerName,
      input.copies,
      input.reason ?? null,
      input.idempotencyKey,
      input.operatorId,
      input.operatorName,
      new Date().toISOString()
    )
  return id
}

export async function startPrint(request: PrintRequest): Promise<PrintStartResult> {
  const session = requirePermission(request.kind === 'reprint' ? 'print.reprint' : 'print.execute')
  const round = getRound(request.electionRoundId)
  const config = getConfig()

  if (request.copies < 1) throw new Error('Die Anzahl muss mindestens 1 betragen.')
  if (request.copies > 2000) throw new Error('Mehr als 2000 Exemplare pro Auftrag sind nicht vorgesehen.')
  if (request.kind === 'reprint' && !request.reason?.trim()) {
    throw new Error('Für einen Nachdruck ist ein Grund erforderlich.')
  }

  // Idempotenz: identischer Auftrag wird nicht erneut ausgeführt (§79).
  const existing = db()
    .prepare(`SELECT * FROM print_batches WHERE idempotency_key = ?`)
    .get<BatchRow>(request.idempotencyKey)
  if (existing) {
    const batch = mapBatch(existing)
    return {
      batchId: batch.id,
      requestedCopies: batch.requestedCopies,
      submittedCopies: batch.submittedCopies,
      failedCopies: batch.failedCopies,
      deduplicated: true
    }
  }

  const approved = approvedDocument(request.electionRoundId)
  if (!approved) {
    throw new Error('Es ist kein freigegebener Stimmzettel vorhanden. Bitte zuerst die Freigabe erteilen.')
  }
  if (approved.version !== request.ballotVersion) {
    throw new Error(
      `Es wurde Version v${request.ballotVersion} angefordert, freigegeben ist aber v${approved.version}. Bitte die Ansicht neu laden.`
    )
  }
  if (round.ballotVersion !== approved.version) {
    throw new Error(
      `Der Wahlgang wurde nach der Freigabe geändert (jetzt v${round.ballotVersion}). Bitte die neue Version freigeben, bevor gedruckt wird.`
    )
  }

  const printer = getPrinter(request.printerId)
  if (!printer) throw new Error(`Der Drucker "${request.printerId}" ist nicht konfiguriert.`)
  if (!printer.enabled) throw new Error(`Der Drucker "${printer.name}" ist deaktiviert.`)

  if (request.kind !== 'test') {
    requirePinIfConfigured(request.pin)
  }

  const ops = buildBallotOps(approved.document, printer, config, {
    testPrint: request.kind === 'test'
  })

  const batchId = createBatchRow({
    roundId: request.electionRoundId,
    ballotVersion: approved.version,
    kind: request.kind,
    printerId: printer.id,
    printerName: printer.name,
    copies: request.copies,
    reason: request.reason,
    idempotencyKey: request.idempotencyKey,
    operatorId: session.user.id,
    operatorName: session.user.displayName
  })

  appendAudit({
    action:
      request.kind === 'test'
        ? 'print.test_started'
        : request.kind === 'reprint'
          ? 'print.reprint_started'
          : 'print.started',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: round.id,
    newValue: {
      batchId,
      copies: request.copies,
      printer: printer.name,
      ballotVersion: approved.version,
      ballotHash: approved.hash,
      geschaetzteZeilen: countLines(ops)
    },
    reason: request.reason
  })

  const previousStatus = round.status
  if (request.kind !== 'test' && previousStatus === 'ready') {
    db().prepare(`UPDATE rounds SET status = 'printing', row_version = row_version + 1 WHERE id = ?`).run(round.id)
  }

  const batch = await runBatch(batchId, ops, `${round.roundCode}-v${approved.version}`, config.printing.copyDelayMs)

  if (request.kind !== 'test' && previousStatus === 'ready') {
    db().prepare(`UPDATE rounds SET status = 'ready', row_version = row_version + 1 WHERE id = ?`).run(round.id)
  }

  appendAudit({
    action: 'print.finished',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: round.id,
    newValue: {
      batchId,
      status: batch.status,
      übermittelt: batch.submittedCopies,
      angefordert: batch.requestedCopies
    }
  })

  return {
    batchId: batch.id,
    requestedCopies: batch.requestedCopies,
    submittedCopies: batch.submittedCopies,
    failedCopies: batch.failedCopies,
    deduplicated: false
  }
}

/** Protokollbeleg (z. B. Losentscheid) – ausdrücklich kein Stimmzettel. */
export async function printProtocolSlip(input: {
  roundId: UUID
  printerId: string
  kind: 'lot_decision' | 'result'
  text: string
}): Promise<PrintStartResult> {
  const session = requirePermission('print.execute')
  const round = getRound(input.roundId)
  const event = getEvent(round.eventId)
  const printer = getPrinter(input.printerId)
  if (!printer) throw new Error(`Der Drucker "${input.printerId}" ist nicht konfiguriert.`)

  const ops = buildProtocolSlipOps(
    {
      organization: event.organization,
      eventTitle: event.title,
      date: event.date,
      roundLabel: round.roundLabel,
      roundCode: round.roundCode,
      heading: input.kind === 'lot_decision' ? 'Losentscheid' : 'Ergebnisbeleg',
      body: input.text
    },
    printer
  )

  const batchId = createBatchRow({
    roundId: round.id,
    ballotVersion: round.ballotVersion,
    kind: 'protocol',
    printerId: printer.id,
    printerName: printer.name,
    copies: 1,
    idempotencyKey: `protocol-${randomUUID()}`,
    operatorId: session.user.id,
    operatorName: session.user.displayName,
    reason: input.kind
  })

  const batch = await runBatch(batchId, ops, `${round.roundCode}-protokoll`, 0)
  appendAudit({
    action: 'print.protocol_slip',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: round.id,
    newValue: { kind: input.kind, status: batch.status }
  })

  return {
    batchId: batch.id,
    requestedCopies: batch.requestedCopies,
    submittedCopies: batch.submittedCopies,
    failedCopies: batch.failedCopies,
    deduplicated: false
  }
}

/** Physische Bestätigung eines unklaren Auftrags durch den Bediener (§35). */
export function acknowledgeBatch(batchId: UUID, confirmedCopies: number, note?: string): PrintBatch {
  const session = requirePermission('print.execute')
  const batch = getBatch(batchId)
  if (confirmedCopies < 0 || confirmedCopies > batch.requestedCopies) {
    throw new Error(`Bitte eine Zahl zwischen 0 und ${batch.requestedCopies} angeben.`)
  }
  updateBatch(batchId, {
    confirmed_copies: confirmedCopies,
    status: 'completed',
    completed_at: batch.completedAt ?? new Date().toISOString()
  })
  appendAudit({
    action: 'print.batch_acknowledged',
    userId: session.user.id,
    userName: session.user.displayName,
    electionRoundId: batch.electionRoundId,
    previousValue: { status: batch.status, übermittelt: batch.submittedCopies },
    newValue: { status: 'completed', physischBestaetigt: confirmedCopies },
    reason: note
  })
  return getBatch(batchId)
}

/**
 * Unterbrochenen Auftrag fortsetzen (§35).
 *
 * Typischer Fall: Mitten im Stapel geht das Papier aus. Der Bediener wechselt
 * die Rolle, zählt die brauchbaren Zettel und setzt fort — gedruckt wird genau
 * die Differenz zur angeforderten Menge, mit derselben Zettelversion.
 *
 * Ausdrücklich KEINE automatische Wiederholung: Menge und Auslösung kommen vom
 * Menschen, der zuvor physisch geprüft hat.
 */
export async function resumePrint(input: {
  batchId: UUID
  confirmedCopies: number
  printerId?: string
  pin?: string
}): Promise<PrintStartResult & { remaining: number }> {
  const session = requirePermission('print.reprint')
  const batch = getBatch(input.batchId)

  if (batch.kind === 'test' || batch.kind === 'protocol') {
    throw new Error('Nur Stimmzettel-Druckaufträge können fortgesetzt werden.')
  }
  if (batch.status === 'running') {
    throw new Error('Dieser Druckauftrag läuft noch. Bitte zuerst abwarten oder abbrechen.')
  }

  // Die physisch geprüfte Menge festschreiben, bevor nachgedruckt wird.
  acknowledgeBatch(input.batchId, input.confirmedCopies, 'Vor Fortsetzung physisch geprüft')

  const remaining = batch.requestedCopies - input.confirmedCopies
  if (remaining <= 0) {
    appendAudit({
      action: 'print.resume_not_needed',
      userId: session.user.id,
      userName: session.user.displayName,
      electionRoundId: batch.electionRoundId,
      newValue: { batchId: batch.id, bestaetigt: input.confirmedCopies, angefordert: batch.requestedCopies }
    })
    return {
      batchId: batch.id,
      requestedCopies: batch.requestedCopies,
      submittedCopies: input.confirmedCopies,
      failedCopies: 0,
      deduplicated: false,
      remaining: 0
    }
  }

  const result = await startPrint({
    electionRoundId: batch.electionRoundId,
    printerId: input.printerId ?? batch.printerId,
    copies: remaining,
    ballotVersion: batch.ballotVersion,
    kind: 'reprint',
    reason: `Fortsetzung nach Unterbrechung (Auftrag vom ${new Date(batch.startedAt).toLocaleString('de-DE')}, ${input.confirmedCopies} von ${batch.requestedCopies} bestätigt)`,
    // Dieselbe Fortsetzung wird nicht zweimal ausgeführt.
    idempotencyKey: `resume-${batch.id}-${input.confirmedCopies}`,
    pin: input.pin
  })

  return { ...result, remaining }
}

export async function testPrinter(printerId: string): Promise<PrinterTestResult> {
  requirePermission('print.execute')
  const printer = getPrinter(printerId)
  if (!printer) throw new Error(`Der Drucker "${printerId}" ist nicht konfiguriert.`)
  const driver = createDriver(printer)
  const result = await driver.status()
  appendAudit({
    action: 'printer.status_checked',
    newValue: { printer: printer.name, ok: result.ok, message: result.message }
  })
  return result
}
