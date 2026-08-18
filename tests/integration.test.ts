/**
 * Integrationstest des vollständigen Ablaufs gegen die echten Services
 * (§77 Integration, §85 Abnahmekriterien):
 * Veranstaltung -> Wahlgang -> Kandidaten -> Freigabe -> Druck -> Nachdruck ->
 * Bilanz -> Ergebnis -> Bestätigung -> Abschluss -> Audit -> Neustart.
 *
 * Electron wird ersetzt, damit der Test ohne Fensterumgebung läuft. Datenbank,
 * ESC/POS-Erzeugung, Hash-Chain und Dateiausgabe sind echt.
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'wahlzettel-test-'))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => join(root, name),
    getVersion: () => '0.1.0-test'
  },
  dialog: { showErrorBox: () => undefined },
  ipcMain: { handle: () => undefined },
  BrowserWindow: class {},
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ id: 0 }) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined },
  shell: { openExternal: () => undefined },
  session: { defaultSession: {} },
  Menu: { setApplicationMenu: () => undefined }
}))

const { initDatabase, closeDatabase, db } = await import('../src/main/db')
const { initLogger } = await import('../src/main/logger')
const auth = await import('../src/main/services/auth')
const events = await import('../src/main/services/events')
const rounds = await import('../src/main/services/rounds')
const candidates = await import('../src/main/services/candidates')
const ballots = await import('../src/main/services/ballots')
const printing = await import('../src/main/services/printing')
const accounting = await import('../src/main/services/accounting')
const results = await import('../src/main/services/results')
const audit = await import('../src/main/services/audit')
const settings = await import('../src/main/services/settings')

const CHECKLIST = ['round', 'candidates', 'seats', 'maxVotes', 'options', 'roundCode']
const NAMES = [
  'Max Mustermann',
  'Erika Musterfrau',
  'Peter Beispiel',
  'Anna Beispiel',
  'Thomas Muster',
  'Julia Mustermann',
  'Stefan Beispiel',
  'Petra Mustermann',
  'Klaus Beispiel',
  'Maria Muster',
  'Frank Beispiel',
  'Laura Mustermann',
  'Sven Beispiel',
  'Jana Musterfrau',
  'Nina Beispiel'
]

let eventId = ''
let roundId = ''

beforeAll(() => {
  initLogger(join(root, 'logs'))
  initDatabase(join(root, 'data', 'test.sqlite'))

  // Erstes Konto anlegen und anmelden.
  db()
    .prepare(
      `INSERT INTO users (id, username, display_name, password_hash, role, active, created_at)
       VALUES ('user-1', 'wahlleitung', 'Wahlleitung', ?, 'ADMIN', 1, ?)`
    )
    .run(auth.hashSecret('geheim-1234'), new Date().toISOString())
  auth.login('wahlleitung', 'geheim-1234')

  // Für den Test ohne echten Drucker die Dateiausgabe verwenden.
  const printers = settings.getPrinters().map((printer) => ({ ...printer, enabled: printer.id === 'file-preview' }))
  settings.savePrinters(printers)
  const config = settings.getConfig()
  settings.saveConfig({
    ...config,
    printing: { ...config.printing, defaultPrinterId: 'file-preview', copyDelayMs: 0 },
    security: { ...config.security, requirePinForMassPrint: false }
  })
})

afterAll(() => {
  closeDatabase()
})

describe('Vollständige Mitgliederversammlung (Abnahmeszenario)', () => {
  it('legt Veranstaltung mit 120 Stimmberechtigten an', () => {
    const created = events.createEvent({
      title: 'Mitgliederversammlung',
      organization: 'Musterverband Beispielstadt',
      orgCode: 'MV26',
      date: '2026-09-12',
      location: 'Ulmenhof Steinhoefel',
      eligibleVoterCount: 120,
      ruleSet: { name: 'Wahlordnung', version: 'Fassung 2024', snapshotDate: '2026-08-17' }
    })
    eventId = created.id
    events.activateEvent(eventId)
    expect(events.activeEvent()?.eligibleVoterCount).toBe(120)
  })

  it('legt eine Gruppenwahl mit 15 Kandidaten und 8 Positionen an', async () => {
    const { defaultTemplateFor } = await import('../src/shared/election')
    const round = rounds.createRound({
      eventId,
      title: 'Delegiertenwahl',
      purpose: 'delegate',
      procedure: 'group_preprinted',
      seats: 8,
      maxVotes: 8,
      template: defaultTemplateFor('group_preprinted', { seats: 8, maxVotes: 8, entryCount: 15 }),
      orderMode: 'manual'
    })
    roundId = round.id
    candidates.addCandidates(
      roundId,
      NAMES.map((name) => {
        const parts = name.split(' ')
        return { firstName: parts[0], lastName: parts[1], displayName: name }
      })
    )
    expect(candidates.listCandidates(roundId)).toHaveLength(15)

    // Ein neu angelegter Punkt ist zunächst nur vorbereitet: keine Nummer,
    // keine Kennung — damit die Tagesordnung frei umsortierbar bleibt.
    expect(round.status).toBe('draft')
    expect(round.sequentialNumber).toBe(0)
    expect(round.roundCode).toBe('')

    const gestartet = rounds.startRound(roundId)
    expect(gestartet.status).toBe('candidate_collection')
    expect(gestartet.sequentialNumber).toBe(1)
    expect(gestartet.roundCode).toBe(`MV26-20260912-WG${gestartet.roundLabel}`)
  })

  it('verweigert den Druck, solange nichts freigegeben ist', async () => {
    await expect(
      printing.startPrint({
        electionRoundId: roundId,
        printerId: 'file-preview',
        copies: 5,
        ballotVersion: 1,
        kind: 'initial',
        idempotencyKey: 'zu-frueh'
      })
    ).rejects.toThrow(/freigegeben/i)
  })

  it('schließt die Kandidatenliste und gibt den Stimmzettel frei', () => {
    rounds.lockCandidates(roundId)
    expect(() => candidates.addCandidates(roundId, [{ firstName: 'X', lastName: 'Y', displayName: 'X Y' }])).toThrow(
      /geschlossen/i
    )

    const version = ballots.approveBallot(roundId, CHECKLIST)
    expect(version.version).toBe(1)
    expect(version.ballotHash).toMatch(/^[0-9a-f]{64}$/)
    expect(rounds.getRound(roundId).status).toBe('ready')
  })

  it('erzeugt eine 80-mm-Vorschau mit Kennung und allen Kandidaten', () => {
    const preview = ballots.previewBallot(roundId)
    const text = preview.lines.join('\n')
    expect(text).toContain('Musterverband Beispielstadt')
    expect(text).toContain('WAHLGANG')
    expect(text).toContain('Maximal 8 Stimmen.')
    for (const name of NAMES) expect(text).toContain(name)
    expect(text).toContain(rounds.getRound(roundId).roundCode)
    // Keine Zeile laenger als die Druckbreite.
    expect(Math.max(...preview.lines.map((line) => line.length))).toBeLessThanOrEqual(42)
  })

  it('druckt 125 Exemplare und protokolliert sie', async () => {
    const result = await printing.startPrint({
      electionRoundId: roundId,
      printerId: 'file-preview',
      copies: 125,
      ballotVersion: 1,
      kind: 'initial',
      idempotencyKey: 'druck-1'
    })
    expect(result.submittedCopies).toBe(125)
    expect(result.failedCopies).toBe(0)
    expect(result.deduplicated).toBe(false)

    const batch = printing.getBatch(result.batchId)
    expect(batch.status).toBe('completed')
    expect(accounting.accountingFor(roundId).printed).toBe(125)
  })

  it('führt denselben Auftrag kein zweites Mal aus (Idempotenz)', async () => {
    const again = await printing.startPrint({
      electionRoundId: roundId,
      printerId: 'file-preview',
      copies: 125,
      ballotVersion: 1,
      kind: 'initial',
      idempotencyKey: 'druck-1'
    })
    expect(again.deduplicated).toBe(true)
    expect(accounting.accountingFor(roundId).printed).toBe(125)
  })

  it('kennzeichnet Testdrucke als ungültig und zählt sie getrennt', async () => {
    await printing.startPrint({
      electionRoundId: roundId,
      printerId: 'file-preview',
      copies: 1,
      ballotVersion: 1,
      kind: 'test',
      idempotencyKey: 'test-1'
    })
    const bilanz = accounting.accountingFor(roundId)
    expect(bilanz.testPrints).toBe(1)
    expect(bilanz.printed).toBe(125)

    const directory = join(root, 'userData', 'exports', 'druckausgabe')
    const dateien = readdirSync(directory)
      .filter((file) => file.endsWith('.txt'))
      .map((file) => readFileSync(join(directory, file), 'utf8'))
    const testdrucke = dateien.filter((inhalt) => inhalt.includes('TESTDRUCK'))

    // Genau ein Testdruck, und der ist oben wie unten unübersehbar entwertet.
    expect(testdrucke).toHaveLength(1)
    expect(testdrucke[0]).toContain('KEIN GÜLTIGER STIMMZETTEL')
    expect(testdrucke[0].match(/TESTDRUCK/g)).toHaveLength(2)
    // Die regulären Stimmzettel tragen keinerlei Testkennzeichnung.
    expect(dateien.filter((inhalt) => !inhalt.includes('TESTDRUCK'))).toHaveLength(125)
  })

  it('verlangt für den Nachdruck einen Grund und dokumentiert ihn', async () => {
    await expect(
      printing.startPrint({
        electionRoundId: roundId,
        printerId: 'file-preview',
        copies: 2,
        ballotVersion: 1,
        kind: 'reprint',
        idempotencyKey: 'nachdruck-ohne-grund'
      })
    ).rejects.toThrow(/Grund/i)

    const result = await printing.startPrint({
      electionRoundId: roundId,
      printerId: 'file-preview',
      copies: 2,
      ballotVersion: 1,
      kind: 'reprint',
      reason: 'Ersatzstimmzettel',
      idempotencyKey: 'nachdruck-1'
    })
    expect(result.submittedCopies).toBe(2)
    expect(accounting.accountingFor(roundId).printed).toBe(127)
  })

  it('erzwingt nach einer Änderung eine neue Wahlzettelversion', () => {
    const before = rounds.getRound(roundId)
    rounds.unlockRound(roundId, 'Kandidat falsch geschrieben')
    const after = rounds.getRound(roundId)
    expect(after.ballotVersion).toBe(before.ballotVersion + 1)
    expect(after.approvedVersion).toBe(1)
    expect(after.status).toBe('candidate_collection')
  })

  it('sperrt den Druck der alten Version nach der Änderung', async () => {
    await expect(
      printing.startPrint({
        electionRoundId: roundId,
        printerId: 'file-preview',
        copies: 3,
        ballotVersion: 1,
        kind: 'reprint',
        reason: 'Weiterer Stimmberechtigter',
        idempotencyKey: 'nachdruck-2'
      })
    ).rejects.toThrow(/geändert|Version/i)
  })

  it('gibt die neue Version frei und archiviert die alte', () => {
    candidates.updateCandidate({ id: candidates.listCandidates(roundId)[0].id, displayName: 'Max Mustermann jun.' })
    rounds.lockCandidates(roundId)
    const version = ballots.approveBallot(roundId, CHECKLIST)
    expect(version.version).toBe(2)

    const alle = ballots.listVersions(roundId)
    expect(alle).toHaveLength(2)
    expect(alle[0].supersededAt).toBeDefined()
    expect(alle[0].ballotHash).not.toBe(alle[1].ballotHash)
    // Die alte Fassung bleibt vollständig erhalten.
    expect(alle[0].document.sections[0].candidates[0].name).toBe('Max Mustermann')
  })

  it('dokumentiert die Stimmzettelbilanz', () => {
    const saved = accounting.saveAccounting({
      electionRoundId: roundId,
      issued: 119,
      replacementsIssued: 2,
      returnedSpoiled: 2,
      unused: 6,
      ballotsInBox: 117
    })
    expect(saved.issued).toBe(119)
    expect(saved.printed).toBe(127)
  })

  it('erfasst und bestätigt das Ergebnis', () => {
    rounds.setRoundStatus(roundId, 'open')
    rounds.setRoundStatus(roundId, 'counting')

    const liste = candidates.listCandidates(roundId)
    // 115 gültige Stimmzettel x 8 Stimmen = höchstens 920 Stimmen insgesamt.
    const stimmen = [101, 98, 93, 88, 84, 81, 77, 74, 30, 28, 25, 22, 20, 15, 12]
    const resultData = {
      candidates: liste.map((candidate, index) => ({
        candidateId: candidate.id,
        name: candidate.displayName,
        votes: stimmen[index] ?? 0
      })),
      no: 4,
      abstentions: 3
    }
    expect(stimmen.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(115 * 8)

    results.saveResult({
      electionRoundId: roundId,
      ballotsCast: 117,
      validBallots: 115,
      invalidBallots: 2,
      resultData,
      finalDecision: 'elected',
      electedCandidateIds: liste.slice(0, 8).map((candidate) => candidate.id),
      determination: 'Erforderliche Mehrheit erreicht'
    })

    const confirmed = results.confirmResult(roundId)
    expect(confirmed.confirmedAt).toBeDefined()
    expect(confirmed.electedCandidateIds).toHaveLength(8)
  })

  it('weist unplausible Ergebnisse zurück', () => {
    expect(() =>
      results.saveResult({
        electionRoundId: roundId,
        ballotsCast: 100,
        validBallots: 90,
        invalidBallots: 5,
        resultData: { candidates: [] }
      })
    ).toThrow(/bestätigt|plausibel/i)
  })

  it('schließt den Wahlgang ab und macht ihn unveränderbar', () => {
    const abgeschlossen = rounds.completeRound(roundId)
    expect(abgeschlossen.status).toBe('completed')
    expect(() => rounds.unlockRound(roundId, 'Nachträglich')).toThrow(/abgeschlossen/i)
    expect(() => candidates.addCandidates(roundId, [{ firstName: 'A', lastName: 'B', displayName: 'A B' }])).toThrow()
  })

  it('führt einen lücken- und manipulationsfreien Audit-Trail', () => {
    const check = audit.verifyAuditChain()
    expect(check.ok).toBe(true)
    expect(check.entries).toBeGreaterThan(20)

    const eintraege = audit.listAudit({ roundId, limit: 1000 }).map((entry) => entry.action)
    expect(eintraege).toContain('round.created')
    expect(eintraege).toContain('candidate.added')
    expect(eintraege).toContain('round.candidates_locked')
    expect(eintraege).toContain('ballot.approved')
    expect(eintraege).toContain('print.started')
    expect(eintraege).toContain('print.reprint_started')
    expect(eintraege).toContain('round.unlocked')
    expect(eintraege).toContain('result.entered')
    expect(eintraege).toContain('result.confirmed')
    expect(eintraege).toContain('round.completed')
  })

  it('erkennt nachträgliche Manipulation der Audit-Kette', async () => {
    const { db } = await import('../src/main/db')
    db().prepare(`UPDATE audit SET action = 'manipuliert' WHERE seq = (SELECT MIN(seq) FROM audit)`).run()
    const check = audit.verifyAuditChain()
    expect(check.ok).toBe(false)
    expect(check.brokenAtSeq).toBeDefined()
  })
})

describe('Kandidatennummern', () => {
  let nummernRoundId = ''

  it('nummeriert nachträglich erfasste Kandidaten weiter', async () => {
    const { defaultTemplateFor } = await import('../src/shared/election')
    const round = rounds.createRound({
      eventId,
      title: 'Beisitzer',
      purpose: 'board_member',
      procedure: 'group_preprinted',
      seats: 3,
      maxVotes: 3,
      template: {
        ...defaultTemplateFor('group_preprinted', { seats: 3, maxVotes: 3, entryCount: 3 }),
        showCandidateNumbers: true
      },
      orderMode: 'manual'
    })
    nummernRoundId = round.id
    rounds.startRound(nummernRoundId)

    candidates.addCandidates(nummernRoundId, [
      { firstName: 'Anna', lastName: 'Erste', displayName: 'Anna Erste', ballotNumber: 1 },
      { firstName: 'Bernd', lastName: 'Zweiter', displayName: 'Bernd Zweiter', ballotNumber: 2 }
    ])

    // Nachzügler ohne eigene Nummer – die Reihe wird fortgesetzt.
    candidates.addCandidates(nummernRoundId, [
      { firstName: 'Clara', lastName: 'Dritte', displayName: 'Clara Dritte' },
      { firstName: 'Dieter', lastName: 'Vierter', displayName: 'Dieter Vierter' }
    ])

    expect(candidates.listCandidates(nummernRoundId).map((c) => c.ballotNumber)).toEqual([1, 2, 3, 4])
  })

  it('schließt die Lücke, wenn ein Kandidat zurückzieht', () => {
    const zweiter = candidates.listCandidates(nummernRoundId)[1]
    candidates.withdrawCandidate(zweiter.id, 'Rückzug vor der Freigabe')

    const verbleibend = candidates
      .listCandidates(nummernRoundId)
      .filter((candidate) => !candidate.withdrawn)
      .map((candidate) => candidate.ballotNumber)
    expect(verbleibend).toEqual([1, 2, 3])
    // Der zurückgezogene Eintrag bleibt erhalten, trägt aber keine Nummer mehr.
    expect(candidates.listCandidates(nummernRoundId).find((c) => c.withdrawn)?.ballotNumber).toBeUndefined()
  })
})

describe('Abstimmung ohne Auszählung', () => {
  let offenerRoundId = ''

  it('legt eine offene Abstimmung an', async () => {
    const { defaultTemplateFor } = await import('../src/shared/election')
    const round = rounds.createRound({
      eventId,
      title: 'Änderungsantrag zur Satzung',
      purpose: 'motion',
      procedure: 'open_vote',
      seats: 1,
      maxVotes: null,
      template: defaultTemplateFor('open_vote', { seats: 1, maxVotes: null, entryCount: 0 }),
      orderMode: 'manual'
    })
    offenerRoundId = round.id
    rounds.startRound(offenerRoundId)
    expect(rounds.getRound(offenerRoundId).status).toBe('candidate_collection')
  })

  it('verlangt ohne Auszählung eine ausdrückliche Feststellung', () => {
    expect(() =>
      results.saveResult({
        electionRoundId: offenerRoundId,
        countingMode: 'declared',
        ballotsCast: 0,
        validBallots: 0,
        invalidBallots: 0,
        resultData: { candidates: [] }
      })
    ).toThrow(/festgestellt/i)
  })

  it('speichert ein festgestelltes Ergebnis ohne Zahlen', () => {
    const gespeichert = results.saveResult({
      electionRoundId: offenerRoundId,
      countingMode: 'declared',
      declaration: 'Einstimmig angenommen',
      ballotsCast: 0,
      validBallots: 0,
      invalidBallots: 0,
      resultData: { candidates: [] },
      finalDecision: 'accepted'
    })
    expect(gespeichert.countingMode).toBe('declared')
    expect(gespeichert.declaration).toBe('Einstimmig angenommen')

    const bestaetigt = results.confirmResult(offenerRoundId)
    expect(bestaetigt.confirmedAt).toBeDefined()
  })

  it('hält im Audit fest, dass nicht ausgezählt wurde', () => {
    const eintrag = audit
      .listAudit({ roundId: offenerRoundId, limit: 50 })
      .find((entry) => entry.action === 'result.entered')
    expect(JSON.stringify(eintrag?.newValue)).toContain('ohne Auszählung festgestellt')
  })
})

describe('Wiederanlauf nach Absturz', () => {
  it('markiert einen unterbrochenen Druckauftrag als unklar und wiederholt ihn nicht', async () => {
    const { db } = await import('../src/main/db')
    db()
      .prepare(
        `INSERT INTO print_batches (id, round_id, ballot_version, kind, printer_id, printer_name,
                                    requested_copies, submitted_copies, failed_copies, status,
                                    idempotency_key, operator_id, operator_name, started_at)
         VALUES ('batch-crash', ?, 2, 'initial', 'file-preview', 'Datei', 126, 84, 0, 'running',
                 'crash-key', 'user-1', 'Wahlleitung', ?)`
      )
      .run(roundId, new Date().toISOString())

    const betroffen = printing.markInterruptedBatches()
    expect(betroffen).toBe(1)

    const batch = printing.getBatch('batch-crash')
    expect(batch.status).toBe('unknown')
    expect(batch.submittedCopies).toBe(84)
    expect(batch.errorMessage).toMatch(/unbekannt/i)

    // Erst die physische Bestätigung setzt den Auftrag auf abgeschlossen.
    const bestaetigt = printing.acknowledgeBatch('batch-crash', 84, 'Physisch gezählt')
    expect(bestaetigt.status).toBe('completed')
    expect(bestaetigt.confirmedCopies).toBe(84)
  })

  it('druckt beim Fortsetzen nur die fehlende Menge', async () => {
    db()
      .prepare(
        `INSERT INTO print_batches (id, round_id, ballot_version, kind, printer_id, printer_name,
                                    requested_copies, submitted_copies, failed_copies, status,
                                    idempotency_key, operator_id, operator_name, started_at)
         VALUES ('batch-papier', ?, 2, 'initial', 'file-preview', 'Datei', 100, 60, 1, 'unknown',
                 'papier-key', 'user-1', 'Wahlleitung', ?)`
      )
      .run(roundId, new Date().toISOString())

    // Nach dem Papierwechsel wurden 58 brauchbare Zettel gezählt.
    const fortsetzung = await printing.resumePrint({ batchId: 'batch-papier', confirmedCopies: 58 })
    expect(fortsetzung.remaining).toBe(42)
    expect(fortsetzung.submittedCopies).toBe(42)

    // Der unterbrochene Auftrag ist mit der geprüften Menge abgeschlossen.
    const geprueft = printing.getBatch('batch-papier')
    expect(geprueft.status).toBe('completed')
    expect(geprueft.confirmedCopies).toBe(58)

    const nachdruck = printing
      .listBatches(roundId)
      .find((batch) => batch.idempotencyKey === 'resume-batch-papier-58')
    expect(nachdruck?.kind).toBe('reprint')
    expect(nachdruck?.reason).toMatch(/Fortsetzung nach Unterbrechung/)
  })

  it('führt dieselbe Fortsetzung kein zweites Mal aus', async () => {
    const erneut = await printing.resumePrint({ batchId: 'batch-papier', confirmedCopies: 58 })
    expect(erneut.deduplicated).toBe(true)
  })
})
