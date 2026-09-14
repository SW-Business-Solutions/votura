/**
 * Akkreditierung: wer da ist und wer mitstimmen darf.
 *
 * Die Zahl der Stimmberechtigten war bisher eine einzeln eingetippte Zahl am
 * Ereignis. Jede Mehrheitsberechnung hängt daran — und in einer Versammlung
 * kommen und gehen Leute. Geprüft wird deshalb vor allem, was still falsch
 * würde: eine Anwesenheit, die den Verlauf verliert; ein Stand, der sich
 * ändert, während schon gewählt wird; ein Pass, der sich nachlesen lässt.
 *
 * Gegen die echte Datenbank, nicht gegen Textstellen.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'votura-akkreditierung-'))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => join(root, name), getVersion: () => '0.0.0-test' },
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
const teilnehmer = await import('../src/main/services/participants')
const audit = await import('../src/main/services/audit')
import type { QuorumRule } from '../src/shared/types'

const OHNE: QuorumRule = { kind: 'none', value: 0 }
const HAELFTE: QuorumRule = { kind: 'share', value: 0.5 }

let eventId = ''

beforeAll(() => {
  initLogger(join(root, 'logs'))
  initDatabase(join(root, 'data', 'test.sqlite'))
  db()
    .prepare(
      `INSERT INTO users (id, username, display_name, password_hash, role, active, created_at)
       VALUES ('user-1', 'wahlleitung', 'Wahlleitung', ?, 'ADMIN', 1, ?)`
    )
    .run(auth.hashSecret('geheim-1234'), new Date().toISOString())
  auth.login('wahlleitung', 'geheim-1234')

  eventId = events.createEvent({
    title: 'Mitgliederversammlung',
    organization: 'Musterverein',
    orgCode: 'MV26',
    date: '2026-09-14',
    location: 'Vereinsheim',
    ruleSet: { name: 'Satzung', version: '1', snapshotDate: '2026-09-14' }
  }).id
})

afterAll(() => {
  closeDatabase()
})

function anlegen(nachname: string, extra: { eligible?: boolean; weight?: number } = {}) {
  return teilnehmer.addParticipant({
    eventId,
    lastName: nachname,
    firstName: 'Test',
    ...extra
  })
}

/**
 * Ein Wahlgang, so knapp wie das Schema es zulässt.
 *
 * Über die Datenbank statt über den Dienst: Geprüft wird hier die
 * Akkreditierung, nicht das Anlegen von Wahlgängen — und ein Fremdschlüssel
 * braucht nun einmal eine echte Zeile.
 */
function wahlgangAnlegen(zuEvent: string): string {
  const id = `runde-${zaehler++}`
  db()
    .prepare(
      `INSERT INTO rounds (id, event_id, sequential_number, round_code, round_label, title,
                           purpose, procedure, seats, status, template_json, created_at)
       VALUES (?, ?, ?, ?, 'Wahlgang', 'Probe', 'election', 'majority', 1, 'draft', '{}', ?)`
    )
    .run(id, zuEvent, zaehler, `R${zaehler}`, new Date().toISOString())
  return id
}
let zaehler = 1

describe('Anwesenheit', () => {
  it('beginnt abwesend', () => {
    const person = anlegen('Abwesend')
    expect(person.present).toBe(false)
    expect(person.eligible).toBe(true)
  })

  it('merkt sich Kommen und Gehen als Verlauf, nicht als Zustand', () => {
    /*
     * Der Grund: Im Protokoll steht nicht „ist anwesend", sondern „war beim
     * dritten Wahlgang im Saal". Ein überschriebenes Feld könnte das nicht
     * beantworten.
     */
    const person = anlegen('Verlauf')
    teilnehmer.setAttendance(person.id, 'in')
    teilnehmer.setAttendance(person.id, 'out')
    teilnehmer.setAttendance(person.id, 'in')

    const verlauf = teilnehmer.attendanceHistory(person.id)
    expect(verlauf.map((eintrag) => eintrag.kind)).toEqual(['in', 'out', 'in'])
    expect(teilnehmer.getParticipant(person.id)?.present).toBe(true)
  })

  it('übergeht einen zweiten Scan stillschweigend', () => {
    /* Am Einlass warten zwanzig Leute — eine Fehlermeldung liest dort
       niemand, und zweimal „gekommen" ist kein Betrug, sondern ein
       Versehen. */
    const person = anlegen('Doppelscan')
    teilnehmer.setAttendance(person.id, 'in')
    teilnehmer.setAttendance(person.id, 'in')
    expect(teilnehmer.attendanceHistory(person.id)).toHaveLength(1)
  })

  it('schreibt Kommen und Gehen ins Audit', () => {
    const person = anlegen('Protokolliert')
    teilnehmer.setAttendance(person.id, 'in')
    const eintraege = audit.listAudit({ eventId }).map((eintrag) => eintrag.action)
    expect(eintraege).toContain('participant.arrived')
  })
})

describe('Beschlussfähigkeit', () => {
  it('rundet einen Anteil auf', () => {
    /* „Die Hälfte von 15" sind acht, nicht siebeneinhalb — eine abgerundete
       Schwelle machte eine beschlussunfähige Versammlung beschlussfähig. */
    expect(teilnehmer.quorumRequired(HAELFTE, 15)).toBe(8)
    expect(teilnehmer.quorumRequired(HAELFTE, 16)).toBe(8)
  })

  it('verlangt ohne Regel nichts', () => {
    expect(teilnehmer.quorumRequired(OHNE, 100)).toBe(0)
  })

  it('zählt nur anwesende Stimmberechtigte', () => {
    const eigenes = events.createEvent({
      title: 'Zählprobe',
      organization: 'Musterverein',
      orgCode: 'ZP',
      date: '2026-09-14',
      location: 'Saal',
      ruleSet: { name: 'Satzung', version: '1', snapshotDate: '2026-09-14' }
    }).id

    const stimmberechtigt = teilnehmer.addParticipant({ eventId: eigenes, lastName: 'A', firstName: 'T' })
    const gast = teilnehmer.addParticipant({
      eventId: eigenes,
      lastName: 'B',
      firstName: 'T',
      eligible: false
    })
    const zuhause = teilnehmer.addParticipant({ eventId: eigenes, lastName: 'C', firstName: 'T' })

    teilnehmer.setAttendance(stimmberechtigt.id, 'in')
    teilnehmer.setAttendance(gast.id, 'in')

    const stand = teilnehmer.presenceSummary(eigenes, OHNE)
    expect(stand.total).toBe(3)
    expect(stand.present).toBe(2)
    expect(stand.eligibleTotal).toBe(2)
    /* Der Gast ist da, zählt aber nicht; C ist stimmberechtigt, aber nicht da. */
    expect(stand.eligiblePresent).toBe(1)
    expect(zuhause.present).toBe(false)
  })

  it('summiert Stimmgewichte', () => {
    /* Delegiertenversammlung: Ein Delegierter kann mehrere Stimmen führen. */
    const eigenes = events.createEvent({
      title: 'Delegierte',
      organization: 'Landesverband',
      orgCode: 'LV',
      date: '2026-09-14',
      location: 'Saal',
      ruleSet: { name: 'Satzung', version: '1', snapshotDate: '2026-09-14' }
    }).id
    const einer = teilnehmer.addParticipant({ eventId: eigenes, lastName: 'D', firstName: 'T', weight: 3 })
    teilnehmer.setAttendance(einer.id, 'in')

    const stand = teilnehmer.presenceSummary(eigenes, OHNE)
    expect(stand.eligiblePresent).toBe(1)
    expect(stand.weightPresent).toBe(3)
  })

  it('weist ein Stimmgewicht unter 1 ab', () => {
    expect(() => anlegen('Ungültig', { weight: 0 })).toThrow(/Stimmgewicht/)
  })
})

describe('Der Voting Pass', () => {
  it('lässt sich nicht nachlesen', () => {
    /*
     * Gespeichert wird nur der Hash. Ein nachlesbarer Pass wäre eine Stimme
     * zum Mitnehmen — wer Zugriff auf die Datenbank hat, könnte für jeden
     * abstimmen.
     */
    const person = anlegen('Pass')
    const { token } = teilnehmer.issuePass(person.id)
    const gespeichert = db()
      .prepare(`SELECT pass_hash FROM participants WHERE id = ?`)
      .get<{ pass_hash: string }>(person.id)

    expect(token).toHaveLength(16)
    expect(gespeichert?.pass_hash).not.toBe(token)
    expect(gespeichert?.pass_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('meidet verwechselbare Zeichen', () => {
    /* Der Pass wird gedruckt und im Zweifel abgetippt. I, O, 0 und 1 kosten
       dann genau die Minute, die am Einlass niemand hat. */
    const person = anlegen('Zeichen')
    const { token } = teilnehmer.issuePass(person.id)
    expect(token).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/)
  })

  it('findet den Teilnehmer wieder', () => {
    const person = anlegen('Scan')
    const { token } = teilnehmer.issuePass(person.id)
    expect(teilnehmer.findByPass(eventId, token)?.id).toBe(person.id)
    expect(teilnehmer.findByPass(eventId, 'XXXXXXXXXXXXXXXX')).toBeNull()
  })

  it('verrät nie zwei gleiche Pässe', () => {
    const a = teilnehmer.issuePass(anlegen('Einzig-A').id).token
    const b = teilnehmer.issuePass(anlegen('Einzig-B').id).token
    expect(a).not.toBe(b)
  })

  it('entwertet den alten Pass beim Neuausgeben', () => {
    /* Der Ausdruck ist weg, ein neuer wird gedruckt — der alte darf dann
       nicht weitergelten, sonst gäbe es zwei gültige Pässe für eine Stimme. */
    const person = anlegen('Neuausgabe')
    const alt = teilnehmer.issuePass(person.id).token
    const neu = teilnehmer.issuePass(person.id).token
    expect(teilnehmer.findByPass(eventId, alt)).toBeNull()
    expect(teilnehmer.findByPass(eventId, neu)?.id).toBe(person.id)
  })

  it('gibt Gästen keinen', () => {
    const gast = anlegen('Gast', { eligible: false })
    expect(() => teilnehmer.issuePass(gast.id)).toThrow(/Gäste/)
  })

  it('gibt Gesperrten keinen', () => {
    const person = anlegen('Gesperrt')
    teilnehmer.blockParticipant(person.id, 'Mitgliedschaft ruht')
    expect(() => teilnehmer.issuePass(person.id)).toThrow(/gesperrt/)
  })

  it('steht nicht im Audit', () => {
    /* Protokolliert wird, *dass* ein Pass ausgegeben wurde — nicht welcher.
       Sonst stünde die Stimmberechtigung im Klartext im Protokoll. */
    const person = anlegen('Auditpass')
    const { token } = teilnehmer.issuePass(person.id)
    const alles = JSON.stringify(audit.listAudit({ eventId }))
    expect(alles).not.toContain(token)
    expect(alles).toContain('participant.pass_issued')
  })
})

describe('Der Stand je Wahlgang', () => {
  it('bleibt stehen, wenn danach jemand geht', () => {
    /*
     * Der entscheidende Punkt: Ändert sich die Zahl der Stimmberechtigten
     * während eines laufenden Wahlgangs, änderte sich die nötige Mehrheit
     * mitten im Verfahren.
     */
    const eigenes = events.createEvent({
      title: 'Momentaufnahme',
      organization: 'Musterverein',
      orgCode: 'MA',
      date: '2026-09-14',
      location: 'Saal',
      ruleSet: { name: 'Satzung', version: '1', snapshotDate: '2026-09-14' }
    }).id
    const a = teilnehmer.addParticipant({ eventId: eigenes, lastName: 'E', firstName: 'T' })
    const b = teilnehmer.addParticipant({ eventId: eigenes, lastName: 'F', firstName: 'T' })
    teilnehmer.setAttendance(a.id, 'in')
    teilnehmer.setAttendance(b.id, 'in')

    const rundeId = wahlgangAnlegen(eigenes)
    const fest = teilnehmer.takeRoundPresence(rundeId, eigenes, OHNE)
    expect(fest.eligible).toBe(2)

    teilnehmer.setAttendance(b.id, 'out')
    expect(teilnehmer.presenceSummary(eigenes, OHNE).eligiblePresent).toBe(1)
    /* Der festgehaltene Stand rührt sich nicht. */
    expect(teilnehmer.roundPresence(rundeId)?.eligible).toBe(2)
    expect(teilnehmer.eligibleForRound(rundeId)).toBe(2)
  })

  it('fällt ohne Akkreditierung auf die Zahl am Ereignis zurück', () => {
    /* Bestehende Versammlungen führen keine Teilnehmerliste — für sie darf
       sich nichts ändern. */
    expect(teilnehmer.eligibleForRound('runde-ohne-stand', 42)).toBe(42)
    expect(teilnehmer.eligibleForRound('runde-ohne-stand')).toBeUndefined()
  })
})
