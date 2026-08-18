/**
 * Exporte und Archivpaket (§31, §32, §62, §63).
 *
 * Ausgegeben werden ausschließlich organisatorische Daten: Wahlgang, Kandidaten,
 * Druckmengen, Ergebnis, Audit. Ausgefüllte Papier-Stimmzettel werden NICHT
 * digitalisiert.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkAccounting } from '@shared/accounting'
import { formatDateDe, formatDateTimeDe } from '@shared/format'
import type { ExportResult } from '@shared/ipc'
import { rankCandidates, resultInputKind } from '@shared/result'
import {
  PROCEDURE_LABELS,
  PURPOSE_LABELS,
  ROUND_STATUS_LABELS,
  type AuditEntry,
  type BallotAccounting,
  type BallotDocument,
  type ElectionEvent,
  type ElectionResult,
  type ElectionRound,
  type PrintBatch,
  type UUID
} from '@shared/types'
import { FINAL_DECISION_LABELS } from '@shared/projection'
import { auditActionLabel } from '@shared/audit-labels'
import { auditForExport } from '../services/audit'
import { requirePermission } from '../services/auth'
import { accountingFor } from '../services/accounting'
import { approvedDocument, ballotHash, currentDocument, listVersions } from '../services/ballots'
import { listCandidates } from '../services/candidates'
import { getEvent, markArchived } from '../services/events'
import { getRound, listRounds } from '../services/rounds'
import { getResult } from '../services/results'
import { getConfig, getPrinter, getPrinters } from '../services/settings'
import { listBatches } from '../services/printing'
import { buildBallotOps, renderPreviewLines } from '../printing/layout'
import { appPaths, ensureDirectory } from '../paths'
import { documentShell, escapeHtml, htmlToPdf } from './pdf'
import { ZipWriter } from './zip'

function timeZone(): string {
  return getConfig().timezone
}

function ballotPreviewText(document: BallotDocument): string {
  const config = getConfig()
  const printer = getPrinter(config.printing.defaultPrinterId) ?? getPrinters()[0]
  if (!printer) return ''
  return renderPreviewLines(buildBallotOps(document, printer, config), printer.charsPerLine).join('\n')
}

/* ------------------------------------------------------------------- HTML */

function roundHeaderHtml(event: ElectionEvent, round: ElectionRound): string {
  return `<h1>${escapeHtml(round.title)}</h1>
<div class="meta">
  ${escapeHtml(event.organization)} &middot; ${escapeHtml(event.title)} &middot; ${formatDateDe(event.date)}<br>
  Wahlgang ${escapeHtml(round.roundLabel)} &middot; Kennung <strong>${escapeHtml(round.roundCode)}</strong><br>
  Wahlzweck: ${escapeHtml(PURPOSE_LABELS[round.purpose])} &middot; Verfahren: ${escapeHtml(PROCEDURE_LABELS[round.procedure])}<br>
  Status: ${escapeHtml(ROUND_STATUS_LABELS[round.status])}
</div>`
}

function candidatesTableHtml(round: ElectionRound, result: ElectionResult | null): string {
  const candidates = listCandidates(round.id)
  const kind = resultInputKind(round)
  const resultMap = new Map((result?.resultData.candidates ?? []).map((row) => [row.candidateId, row]))
  const elected = new Set(result?.electedCandidateIds ?? [])

  const rows = candidates
    .map((candidate) => {
      const entry = resultMap.get(candidate.id)
      const votes =
        kind === 'yes_no_abstain'
          ? `<td class="num">${entry?.yes ?? ''}</td><td class="num">${entry?.no ?? ''}</td><td class="num">${entry?.abstain ?? ''}</td>`
          : `<td class="num">${entry?.votes ?? ''}</td>`
      return `<tr>
        <td class="num">${candidate.ballotNumber ?? ''}</td>
        <td>${escapeHtml(candidate.displayName)}${candidate.withdrawn ? ' <em>(zurückgezogen)</em>' : ''}</td>
        ${votes}
        <td>${elected.has(candidate.id) ? 'gewählt' : ''}</td>
      </tr>`
    })
    .join('')

  const header =
    kind === 'yes_no_abstain'
      ? '<th class="num">Ja</th><th class="num">Nein</th><th class="num">Enth.</th>'
      : '<th class="num">Stimmen</th>'

  return `<table><thead><tr><th class="num">Nr.</th><th>Name</th>${header}<th>Feststellung</th></tr></thead><tbody>${rows}</tbody></table>`
}

function accountingTableHtml(accounting: BallotAccounting, event: ElectionEvent): string {
  const checks = checkAccounting(accounting, event.eligibleVoterCount)
  return `<table>
    <tr><th>Gedruckt (bestätigt bzw. übermittelt)</th><td class="num">${accounting.printed}</td></tr>
    <tr><th>Fehl-/unklare Drucke</th><td class="num">${accounting.printFailures}</td></tr>
    <tr><th>Testdrucke (ungültig)</th><td class="num">${accounting.testPrints}</td></tr>
    <tr><th>Ausgegeben</th><td class="num">${accounting.issued}</td></tr>
    <tr><th>Ersatzstimmzettel ausgegeben</th><td class="num">${accounting.replacementsIssued}</td></tr>
    <tr><th>Zurückgenommen / vernichtet</th><td class="num">${accounting.returnedSpoiled}</td></tr>
    <tr><th>Unbenutzt</th><td class="num">${accounting.unused}</td></tr>
    <tr><th>In der Urne gezählt</th><td class="num">${accounting.ballotsInBox ?? '–'}</td></tr>
  </table>
  <ul>${checks.map((check) => `<li>${escapeHtml(check.message)}</li>`).join('')}</ul>`
}

function batchesTableHtml(batches: PrintBatch[]): string {
  if (batches.length === 0) return '<p>Keine Druckaufträge erfasst.</p>'
  const rows = batches
    .map(
      (batch) => `<tr>
        <td>${formatDateTimeDe(batch.startedAt, timeZone())}</td>
        <td>${escapeHtml(batch.kind)}</td>
        <td>v${batch.ballotVersion}</td>
        <td>${escapeHtml(batch.printerName)}</td>
        <td class="num">${batch.requestedCopies}</td>
        <td class="num">${batch.submittedCopies}</td>
        <td class="num">${batch.confirmedCopies ?? '–'}</td>
        <td>${escapeHtml(batch.status)}</td>
        <td>${escapeHtml(batch.operatorName)}</td>
        <td>${escapeHtml(batch.reason ?? '')}</td>
      </tr>`
    )
    .join('')
  return `<table><thead><tr>
    <th>Zeitpunkt</th><th>Art</th><th>Version</th><th>Drucker</th>
    <th class="num">Angef.</th><th class="num">Übermittelt</th><th class="num">Bestätigt</th>
    <th>Status</th><th>Bediener</th><th>Grund</th>
  </tr></thead><tbody>${rows}</tbody></table>`
}

function resultHtml(round: ElectionRound, result: ElectionResult | null): string {
  if (!result) return '<p>Es wurde kein Ergebnis erfasst.</p>'

  // Ohne Auszählung trägt der Wortlaut der Feststellung das Ergebnis.
  if (result.countingMode === 'declared') {
    return `<div class="hint">
        <strong>Ohne Auszählung festgestellt.</strong><br>
        Die Versammlungsleitung hat das offenkundige Ergebnis festgestellt; eine zahlenmäßige Auszählung
        fand nicht statt.
      </div>
      <table>
        <tr><th>Feststellung</th><td><strong>${escapeHtml(result.declaration ?? '')}</strong></td></tr>
        ${result.determination ? `<tr><th>Erläuterung</th><td>${escapeHtml(result.determination)}</td></tr>` : ''}
      </table>
      <div class="meta">Erfasst von ${escapeHtml(result.enteredByName)} am ${formatDateTimeDe(result.createdAt, timeZone())}${
        result.confirmedAt
          ? ` &middot; bestätigt von ${escapeHtml(result.verifiedByName ?? '')} am ${formatDateTimeDe(result.confirmedAt, timeZone())}`
          : ' &middot; noch nicht bestätigt'
      }</div>`
  }
  const ranked = rankCandidates(result.resultData.candidates, round.seats)
  const decision = result.finalDecision ? FINAL_DECISION_LABELS[result.finalDecision] : ''

  return `<table>
    <tr><th>Stimmberechtigte</th><td class="num">${result.eligibleVoters ?? '–'}</td></tr>
    <tr><th>Abgegebene Stimmzettel</th><td class="num">${result.ballotsCast}</td></tr>
    <tr><th>Gültig</th><td class="num">${result.validBallots}</td></tr>
    <tr><th>Ungültig</th><td class="num">${result.invalidBallots}</td></tr>
    ${result.resultData.yes !== undefined ? `<tr><th>Ja</th><td class="num">${result.resultData.yes}</td></tr>` : ''}
    ${result.resultData.no !== undefined ? `<tr><th>Nein</th><td class="num">${result.resultData.no}</td></tr>` : ''}
    ${result.resultData.abstentions !== undefined ? `<tr><th>Enthaltung</th><td class="num">${result.resultData.abstentions}</td></tr>` : ''}
  </table>
  ${ranked.length > 0 ? `<h3>Reihenfolge nach Stimmen</h3><table><thead><tr><th class="num">Rang</th><th>Name</th><th class="num">Stimmen</th></tr></thead><tbody>${ranked
    .map(
      (candidate) =>
        `<tr><td class="num">${candidate.rank}</td><td>${escapeHtml(candidate.name)}</td><td class="num">${candidate.votes ?? candidate.yes ?? 0}</td></tr>`
    )
    .join('')}</tbody></table>` : ''}
  ${decision ? `<div class="hint"><strong>Feststellung der Wahlleitung:</strong> ${escapeHtml(decision)}${result.determination ? ` – ${escapeHtml(result.determination)}` : ''}</div>` : ''}
  ${result.lotDecision ? `<div class="hint"><strong>Losentscheid:</strong> ${escapeHtml(result.lotDecision)}</div>` : ''}
  <div class="meta">Erfasst von ${escapeHtml(result.enteredByName)} am ${formatDateTimeDe(result.createdAt, timeZone())}${
    result.confirmedAt
      ? ` &middot; bestätigt von ${escapeHtml(result.verifiedByName ?? '')} am ${formatDateTimeDe(result.confirmedAt, timeZone())}`
      : ' &middot; noch nicht bestätigt'
  }</div>`
}

function auditHtml(entries: AuditEntry[]): string {
  if (entries.length === 0) return '<p>Keine Audit-Einträge.</p>'
  const rows = entries
    .map(
      (entry) => `<tr>
        <td>${formatDateTimeDe(entry.timestamp, timeZone())}</td>
        <td>${escapeHtml(entry.userName ?? 'System')}</td>
        <td>${escapeHtml(auditActionLabel(entry.action))}<br /><span class="mono klein">${escapeHtml(entry.action)}</span></td>
        <td>${escapeHtml(entry.reason ?? '')}</td>
      </tr>`
    )
    .join('')
  return `<table><thead><tr><th>Zeit</th><th>Benutzer</th><th>Aktion</th><th>Begründung</th></tr></thead><tbody>${rows}</tbody></table>`
}

function roundPdfHtml(eventId: UUID, roundId: UUID): string {
  const event = getEvent(eventId)
  const round = getRound(roundId)
  const result = getResult(roundId)
  const accounting = accountingFor(roundId)
  const approved = approvedDocument(roundId)
  const document = approved?.document ?? currentDocument(roundId)
  const hash = approved?.hash ?? ballotHash(document)
  const versions = listVersions(roundId)

  return documentShell(
    `${round.roundCode} – ${round.title}`,
    `${roundHeaderHtml(event, round)}
    <h2>Wahlgangdaten</h2>
    <table>
      <tr><th>Zu besetzende Positionen</th><td class="num">${round.seats}</td></tr>
      <tr><th>Maximale Stimmenzahl</th><td class="num">${round.maxVotes ?? 'keine feste Höchstzahl'}</td></tr>
      ${round.seatStart !== undefined ? `<tr><th>Listenplätze</th><td>${round.seatStart}–${round.seatEnd}</td></tr>` : ''}
      <tr><th>Kandidatenreihenfolge</th><td>${escapeHtml(round.orderMode)}${round.orderSeed !== undefined ? ` (Seed ${round.orderSeed})` : ''}</td></tr>
      <tr><th>Wahlzettelversion</th><td>v${round.ballotVersion}${round.approvedVersion !== undefined ? ` (freigegeben: v${round.approvedVersion})` : ' (nicht freigegeben)'}</td></tr>
      <tr><th>Ballot-Hash (SHA-256)</th><td class="mono">${escapeHtml(hash)}</td></tr>
      <tr><th>Wahlordnung</th><td>${escapeHtml(event.ruleSet.name)} – ${escapeHtml(event.ruleSet.version)}</td></tr>
    </table>

    <h2>Kandidaten / Wahloptionen</h2>
    ${candidatesTableHtml(round, result)}

    <h2>Stimmzettel (Druckvorschau)</h2>
    <div class="ballot">${escapeHtml(ballotPreviewText(document))}</div>
    ${
      versions.length > 1
        ? `<h3>Versionen</h3><ul>${versions
            .map(
              (version) =>
                `<li>v${version.version} – Hash ${escapeHtml(version.ballotHash.slice(0, 16))}… ${
                  version.approvedAt
                    ? `freigegeben am ${formatDateTimeDe(version.approvedAt, timeZone())} durch ${escapeHtml(version.approvedByName ?? '')}`
                    : 'nicht freigegeben'
                }</li>`
            )
            .join('')}</ul>`
        : ''
    }

    <h2>Druckmengen</h2>
    ${batchesTableHtml(listBatches(roundId))}
    <h3>Stimmzettelbilanz</h3>
    ${accountingTableHtml(accounting, event)}

    <h2>Ergebnis</h2>
    ${resultHtml(round, result)}

    <h2>Audit-Ereignisse</h2>
    ${auditHtml(auditForExport({ roundId }))}

    <div class="footer">
      Erzeugt am ${formatDateTimeDe(new Date().toISOString(), timeZone())} &middot; Votura.
      Dieses Dokument dokumentiert die organisatorische Durchführung. Die Stimmabgabe erfolgte
      ausschließlich auf Papier; ausgefüllte Stimmzettel werden nicht digitalisiert.
    </div>`
  )
}

/** Wahlprotokoll eines Wahlgangs (§62). */
function protocolHtml(roundId: UUID): string {
  const round = getRound(roundId)
  const event = getEvent(round.eventId)
  const result = getResult(roundId)
  const accounting = accountingFor(roundId)
  const entries = auditForExport({ roundId })
  const start = entries.find((entry) => entry.action === 'round.created')?.timestamp ?? round.createdAt
  const end = round.completedAt ?? result?.confirmedAt ?? ''

  return documentShell(
    `Wahlprotokoll ${round.roundCode}`,
    `<h1>Wahlprotokoll</h1>
    ${roundHeaderHtml(event, round)}
    <h2>Ablauf</h2>
    <table>
      <tr><th>Beginn</th><td>${formatDateTimeDe(start, timeZone())}</td></tr>
      <tr><th>Ende</th><td>${end ? formatDateTimeDe(end, timeZone()) : '–'}</td></tr>
      <tr><th>Stimmberechtigte</th><td class="num">${event.eligibleVoterCount ?? '–'}</td></tr>
      <tr><th>Abgegebene Stimmzettel</th><td class="num">${result?.ballotsCast ?? '–'}</td></tr>
      <tr><th>Ungültig</th><td class="num">${result?.invalidBallots ?? '–'}</td></tr>
    </table>
    <h2>Ergebnis</h2>
    ${resultHtml(round, result)}
    <h2>Stimmzettelbilanz</h2>
    ${accountingTableHtml(accounting, event)}
    <h2>Verlauf</h2>
    ${auditHtml(entries)}
    <div class="footer">
      Wahlgangkennung ${escapeHtml(round.roundCode)} &middot; erstellt am
      ${formatDateTimeDe(new Date().toISOString(), timeZone())}.<br>
      Unterschrift Wahlleitung: ______________________________
    </div>`
  )
}

/* ------------------------------------------------------------------- CSV */

function csvEscape(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value)
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function candidatesCsv(roundId: UUID): string {
  const round = getRound(roundId)
  const result = getResult(roundId)
  const map = new Map((result?.resultData.candidates ?? []).map((row) => [row.candidateId, row]))
  const lines = ['Nummer;Name;Zurückgezogen;Stimmen;Ja;Nein;Enthaltung']
  for (const candidate of listCandidates(roundId)) {
    const entry = map.get(candidate.id)
    lines.push(
      [
        csvEscape(candidate.ballotNumber),
        csvEscape(candidate.displayName),
        candidate.withdrawn ? 'ja' : 'nein',
        csvEscape(entry?.votes),
        csvEscape(entry?.yes),
        csvEscape(entry?.no),
        csvEscape(entry?.abstain)
      ].join(';')
    )
  }
  void round
  return `﻿${lines.join('\r\n')}\r\n`
}

function resultCsv(roundId: UUID): string {
  const round = getRound(roundId)
  const result = getResult(roundId)
  const accounting = accountingFor(roundId)
  const lines = ['Feld;Wert']
  const push = (label: string, value: string | number | undefined): void =>
    void lines.push(`${csvEscape(label)};${csvEscape(value)}`)

  push('Wahlgangkennung', round.roundCode)
  push('Titel', round.title)
  push('Verfahren', PROCEDURE_LABELS[round.procedure])
  push('Positionen', round.seats)
  push('Maximale Stimmen', round.maxVotes ?? 'keine feste Höchstzahl')
  push('Abgegebene Stimmzettel', result?.ballotsCast)
  push('Gültig', result?.validBallots)
  push('Ungültig', result?.invalidBallots)
  push('Gedruckt', accounting.printed)
  push('Ausgegeben', accounting.issued)
  push('Ersatz', accounting.replacementsIssued)
  push('Zurückgenommen', accounting.returnedSpoiled)
  push('In Urne', accounting.ballotsInBox)
  return `﻿${lines.join('\r\n')}\r\n`
}

/* ------------------------------------------------------------------ JSON */

function roundJson(roundId: UUID): unknown {
  const round = getRound(roundId)
  const approved = approvedDocument(roundId)
  return {
    round,
    candidates: listCandidates(roundId),
    ballot: approved
      ? { version: approved.version, hash: approved.hash, document: approved.document }
      : { version: round.ballotVersion, document: currentDocument(roundId), approved: false },
    versions: listVersions(roundId),
    printBatches: listBatches(roundId),
    accounting: accountingFor(roundId),
    result: getResult(roundId),
    audit: auditForExport({ roundId })
  }
}

/* --------------------------------------------------------------- Exporte */

function exportDirectory(name: string): string {
  return ensureDirectory(join(appPaths().exports, name))
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_')
}

export async function exportRound(roundId: UUID, formats: ('pdf' | 'csv' | 'json')[]): Promise<ExportResult> {
  requirePermission('export.read')
  const round = getRound(roundId)
  const directory = exportDirectory(safeName(round.roundCode))
  const files: string[] = []

  if (formats.includes('pdf')) {
    const file = join(directory, `${safeName(round.roundCode)}-wahlgang.pdf`)
    await htmlToPdf(roundPdfHtml(round.eventId, roundId), file)
    files.push(file)
  }
  if (formats.includes('csv')) {
    const candidatesFile = join(directory, `${safeName(round.roundCode)}-kandidaten.csv`)
    writeFileSync(candidatesFile, candidatesCsv(roundId), 'utf8')
    const resultFile = join(directory, `${safeName(round.roundCode)}-ergebnis.csv`)
    writeFileSync(resultFile, resultCsv(roundId), 'utf8')
    files.push(candidatesFile, resultFile)
  }
  if (formats.includes('json')) {
    const file = join(directory, `${safeName(round.roundCode)}.json`)
    writeFileSync(file, JSON.stringify(roundJson(roundId), null, 2), 'utf8')
    files.push(file)
  }

  return { path: directory, files }
}

export async function exportProtocol(roundId: UUID): Promise<ExportResult> {
  requirePermission('export.read')
  const round = getRound(roundId)
  const directory = exportDirectory(safeName(round.roundCode))
  const file = join(directory, `${safeName(round.roundCode)}-protokoll.pdf`)
  await htmlToPdf(protocolHtml(roundId), file)
  return { path: directory, files: [file] }
}

/** Archivpaket der gesamten Veranstaltung (§32) inklusive ZIP. */
export async function exportEventArchive(eventId: UUID): Promise<ExportResult> {
  requirePermission('export.read')
  const event = getEvent(eventId)
  const rounds = listRounds(eventId)
  const stamp = event.date
  const baseName = `${safeName(event.organization)}-${stamp}`
  const directory = exportDirectory(baseName)
  const zip = new ZipWriter()
  const files: string[] = []

  const eventJson = JSON.stringify({ event, rounds }, null, 2)
  const eventFile = join(directory, 'event.json')
  writeFileSync(eventFile, eventJson, 'utf8')
  zip.add('archive/event.json', eventJson)
  files.push(eventFile)

  const auditJson = JSON.stringify(auditForExport({ eventId }), null, 2)
  const auditFile = join(directory, 'audit.json')
  writeFileSync(auditFile, auditJson, 'utf8')
  zip.add('archive/audit.json', auditJson)
  files.push(auditFile)

  for (const round of rounds) {
    const folder = ensureDirectory(join(directory, 'election-rounds', safeName(round.roundLabel)))
    const configuration = JSON.stringify(roundJson(round.id), null, 2)
    const configurationFile = join(folder, 'configuration.json')
    writeFileSync(configurationFile, configuration, 'utf8')
    zip.add(`archive/election-rounds/${safeName(round.roundLabel)}/configuration.json`, configuration)
    files.push(configurationFile)

    const ballotPdf = join(folder, `ballot-v${round.approvedVersion ?? round.ballotVersion}.pdf`)
    await htmlToPdf(roundPdfHtml(eventId, round.id), ballotPdf)
    zip.add(
      `archive/election-rounds/${safeName(round.roundLabel)}/ballot-v${round.approvedVersion ?? round.ballotVersion}.pdf`,
      readFileSync(ballotPdf)
    )
    files.push(ballotPdf)

    const resultPdf = join(folder, 'result.pdf')
    await htmlToPdf(protocolHtml(round.id), resultPdf)
    zip.add(`archive/election-rounds/${safeName(round.roundLabel)}/result.pdf`, readFileSync(resultPdf))
    files.push(resultPdf)
  }

  const zipFile = join(directory, `${baseName}.zip`)
  zip.writeTo(zipFile)
  files.push(zipFile)

  markArchived(eventId)
  return { path: directory, files }
}
