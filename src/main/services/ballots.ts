/**
 * Stimmzettel: Vorschau, Freigabe, Versionierung (§10, §16, §17, §30, §42, §58).
 *
 * Kernregel: Sobald eine Version freigegeben wurde, kann sie nicht mehr still
 * verändert werden. Jede Änderung führt zu einer neuen Version, die alte
 * bleibt vollständig archiviert.
 */
import { createHash, randomUUID } from 'node:crypto'
import { ballotHashInput, buildBallotDocument } from '@shared/ballot'
import { canonicalJson } from '@shared/canonical'
import { profileFor, validateRoundSetup } from '@shared/election'
import type { BallotDocument, BallotVersionRecord, UUID } from '@shared/types'
import { db } from '../db'
import { fromJson, optionalString } from '../db/driver'
import {
  buildBallotOps,
  renderPreviewLines,
  renderPreviewRows,
  type PreviewRow
} from '../printing/layout'
import { appendAudit } from './audit'
import { requirePermission } from './auth'
import { listCandidates } from './candidates'
import { getEvent } from './events'
import { ensureRoundIdentity, getRound } from './rounds'
import { getConfig, getPrinter, getPrinters } from './settings'

interface VersionRow {
  id: string
  round_id: string
  version: number
  ballot_hash: string
  document_json: string
  approved_by: string | null
  approved_by_name: string | null
  approved_at: string | null
  superseded_at: string | null
  created_at: string
}

function mapVersion(row: VersionRow): BallotVersionRecord {
  return {
    id: row.id,
    electionRoundId: row.round_id,
    version: Number(row.version),
    ballotHash: row.ballot_hash,
    document: fromJson<BallotDocument>(row.document_json, {} as BallotDocument),
    approvedBy: optionalString(row.approved_by),
    approvedByName: optionalString(row.approved_by_name),
    approvedAt: optionalString(row.approved_at),
    supersededAt: optionalString(row.superseded_at),
    createdAt: row.created_at
  }
}

export function ballotHash(document: BallotDocument): string {
  return createHash('sha256').update(canonicalJson(ballotHashInput(document))).digest('hex')
}

/** Aktuelle (ggf. noch nicht freigegebene) Vorlage aus dem Live-Datenbestand. */
export function currentDocument(roundId: UUID): BallotDocument {
  const round = getRound(roundId)
  const event = getEvent(round.eventId)
  const candidates = listCandidates(roundId)
  return buildBallotDocument(event, round, candidates, getConfig().ballots.labels)
}

/**
 * Vorlage für Druck und Projektion. Nach der Freigabe kommt sie IMMER aus dem
 * gespeicherten Snapshot, nie aus der veränderlichen Kandidatentabelle
 * (Beamer §47, §11).
 */
export function approvedDocument(roundId: UUID): { document: BallotDocument; version: number; hash: string } | null {
  const round = getRound(roundId)
  if (round.approvedVersion === undefined) return null
  const row = db()
    .prepare(`SELECT * FROM ballot_versions WHERE round_id = ? AND version = ?`)
    .get<VersionRow>(roundId, round.approvedVersion)
  if (!row) return null
  const record = mapVersion(row)
  return { document: record.document, version: record.version, hash: record.ballotHash }
}

function previewPrinter(): ReturnType<typeof getPrinter> {
  const config = getConfig()
  return getPrinter(config.printing.defaultPrinterId) ?? getPrinters()[0]
}

export function previewBallot(roundId: UUID): {
  document: BallotDocument
  lines: string[]
  rows: PreviewRow[]
  hash: string
} {
  const document = currentDocument(roundId)
  const printer = previewPrinter()
  const config = getConfig()
  const ops = printer ? buildBallotOps(document, printer, config) : []
  const width = printer?.charsPerLine ?? 42
  return {
    document,
    lines: renderPreviewLines(ops, width),
    rows: renderPreviewRows(ops, width),
    hash: ballotHash(document)
  }
}

export function listVersions(roundId: UUID): BallotVersionRecord[] {
  return db()
    .prepare(`SELECT * FROM ballot_versions WHERE round_id = ? ORDER BY version`)
    .all<VersionRow>(roundId)
    .map(mapVersion)
}

/** Prueflistenpunkte, die vor der Freigabe bestätigt sein müssen (§42). */
export const APPROVAL_CHECKLIST = [
  'round',
  'candidates',
  'seats',
  'maxVotes',
  'options',
  'roundCode'
] as const

/**
 * Wahlzettel freigeben (§17). Danach ist der Druck erlaubt.
 * Die Freigabe schreibt einen unveraenderlichen Snapshot samt SHA-256-Hash.
 */
export function approveBallot(roundId: UUID, checklist: string[]): BallotVersionRecord {
  const session = requirePermission('ballot.approve')
  const round = getRound(roundId)
  const profile = profileFor(round.procedure)

  if (!profile.ballotRequired) {
    throw new Error('Für eine offene Abstimmung wird kein Stimmzettel erzeugt.')
  }
  if (round.status === 'completed' || round.status === 'cancelled') {
    throw new Error('Der Wahlgang ist abgeschlossen.')
  }
  if (!round.candidatesLockedAt) {
    throw new Error('Die Kandidatenliste muss vor der Freigabe geschlossen werden.')
  }
  // Ohne Kennung dürfen keine Stimmzettel entstehen: sie steht auf jedem Zettel
  // und ordnet ihn dem Wahlgang zu.
  ensureRoundIdentity(roundId)

  const missing = APPROVAL_CHECKLIST.filter((item) => !checklist.includes(item))
  if (missing.length > 0) {
    throw new Error('Bitte alle Punkte der Prüfliste bestätigen, bevor der Stimmzettel freigegeben wird.')
  }

  const candidates = listCandidates(roundId)
  const issues = validateRoundSetup(round, candidates)
  const errors = issues.filter((issue) => issue.level === 'error')
  if (errors.length > 0) {
    throw new Error(`Der Wahlgang ist noch nicht freigabefaehig:\n- ${errors.map((e) => e.message).join('\n- ')}`)
  }

  const document = currentDocument(roundId)
  const hash = ballotHash(document)
  const now = new Date().toISOString()

  const existing = db()
    .prepare(`SELECT * FROM ballot_versions WHERE round_id = ? AND version = ?`)
    .get<VersionRow>(roundId, round.ballotVersion)

  db().transaction(() => {
    // Aeltere Versionen als abgelöst markieren – sie bleiben erhalten.
    db()
      .prepare(
        `UPDATE ballot_versions SET superseded_at = ?
         WHERE round_id = ? AND version < ? AND superseded_at IS NULL`
      )
      .run(now, roundId, round.ballotVersion)

    if (existing) {
      db()
        .prepare(
          `UPDATE ballot_versions SET ballot_hash = ?, document_json = ?, approved_by = ?, approved_by_name = ?, approved_at = ?
           WHERE id = ?`
        )
        .run(hash, JSON.stringify(document), session.user.id, session.user.displayName, now, existing.id)
    } else {
      db()
        .prepare(
          `INSERT INTO ballot_versions (id, round_id, version, ballot_hash, document_json,
                                        approved_by, approved_by_name, approved_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          randomUUID(),
          roundId,
          round.ballotVersion,
          hash,
          JSON.stringify(document),
          session.user.id,
          session.user.displayName,
          now,
          now
        )
    }

    db()
      .prepare(
        `UPDATE rounds SET approved_version = ?, status = CASE WHEN status IN ('draft','candidate_collection') THEN 'ready' ELSE status END,
                           row_version = row_version + 1
         WHERE id = ?`
      )
      .run(round.ballotVersion, roundId)
  })

  appendAudit({
    action: 'ballot.approved',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: round.eventId,
    electionRoundId: roundId,
    newValue: {
      version: round.ballotVersion,
      hash,
      roundCode: round.roundCode,
      candidates: document.sections.flatMap((section) => section.candidates.map((c) => c.name)),
      seats: round.seats,
      maxVotes: round.maxVotes
    }
  })

  const record = db()
    .prepare(`SELECT * FROM ballot_versions WHERE round_id = ? AND version = ?`)
    .get<VersionRow>(roundId, round.ballotVersion)
  return mapVersion(record as VersionRow)
}

/** Wurde von dieser Version bereits gedruckt? Dann darf sie nicht still ersetzt werden. */
export function versionWasPrinted(roundId: UUID, version: number): boolean {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS count FROM print_batches
       WHERE round_id = ? AND ballot_version = ? AND kind IN ('initial','reprint') AND submitted_copies > 0`
    )
    .get<{ count: number }>(roundId, version)
  return Number(row?.count ?? 0) > 0
}
