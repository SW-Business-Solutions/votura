/**
 * Die digitale Stimmabgabe von vorn bis hinten.
 *
 * Gegen die echte Datenbank und echte Schlüssel. Die wichtigsten Prüfungen
 * sind nicht die, die zeigen, dass es funktioniert, sondern die, die zeigen,
 * **was nicht in der Urne steht**.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  entblenden,
  pruefeSignatur,
  verblenden,
  zuBase64Url,
  type Pruefsumme
} from '../src/shared/blindsignatur'
import { defaultTemplateFor } from '../src/shared/election'

const root = mkdtempSync(join(tmpdir(), 'votura-wahl-'))

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
const rounds = await import('../src/main/services/rounds')
const candidates = await import('../src/main/services/candidates')
const teilnehmer = await import('../src/main/services/participants')
const wahl = await import('../src/main/services/voting')

const sha256: Pruefsumme = async (daten) => new Uint8Array(createHash('sha256').update(daten).digest())
const zufall = (laenge: number): Uint8Array => new Uint8Array(randomBytes(laenge))

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
    orgCode: 'MV',
    date: '2026-09-14',
    location: 'Saal',
    ruleSet: { name: 'Satzung', version: '1', snapshotDate: '2026-09-14' }
  }).id
})

afterAll(() => closeDatabase())

function wahlgangMitBewerbern(namen: string[]): string {
  const round = rounds.createRound({
    eventId,
    title: 'Vorstandswahl',
    purpose: 'board_member',
    procedure: 'group_preprinted',
    seats: namen.length,
    maxVotes: namen.length,
    template: defaultTemplateFor('group_preprinted', {
      seats: namen.length,
      maxVotes: namen.length,
      entryCount: namen.length
    }),
    orderMode: 'manual'
  })
  candidates.addCandidates(
    round.id,
    namen.map((name) => ({ firstName: name, lastName: 'Beispiel', displayName: `${name} Beispiel` }))
  )
  return round.id
}

function anwesend(nachname: string, gewicht = 1): { id: string } {
  const person = teilnehmer.addParticipant({
    eventId,
    lastName: nachname,
    firstName: 'T',
    weight: gewicht
  })
  teilnehmer.setAttendance(person.id, 'in')
  return person
}

describe('Offene Abstimmung (M1)', () => {
  let roundId = ''
  let bewerber: { id: string; displayName: string }[] = []

  beforeAll(() => {
    roundId = wahlgangMitBewerbern(['Alpha', 'Beta'])
    bewerber = candidates.listCandidates(roundId)
    wahl.prepareVoting({ roundId, geheimnis: 'open', geraete: 'both' })
    wahl.openVoting(roundId)
  })

  it('gibt eine Berechtigung nur an Anwesende', async () => {
    const draussen = teilnehmer.addParticipant({ eventId, lastName: 'Draussen', firstName: 'T' })
    expect(() => wahl.berechtigungAusgeben({ roundId, participantId: draussen.id })).toThrow(/Nicht im Saal/)
  })

  it('führt vom Ausweis bis in die Urne', async () => {
    const person = anwesend('Waehler')
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    expect(serial).toBeTruthy()

    await wahl.stimmeEinlegen({
      roundId,
      serial: serial!,
      choice: { kandidaten: [bewerber[0].id] }
    })
    expect(wahl.votingStand(roundId)).toMatchObject({ ausgegeben: 1, abgegeben: 1 })
  })

  it('gibt je Wahlgang nur eine Berechtigung', () => {
    const person = anwesend('Doppelt')
    wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    expect(() => wahl.berechtigungAusgeben({ roundId, participantId: person.id })).toThrow(
      /bereits eine Stimmberechtigung/
    )
  })

  it('nimmt denselben Stimmzettel nicht zweimal an', async () => {
    const person = anwesend('Zweimal')
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    await wahl.stimmeEinlegen({ roundId, serial: serial!, choice: { antwort: 'enthaltung' } })
    await expect(
      wahl.stimmeEinlegen({ roundId, serial: serial!, choice: { antwort: 'ja' } })
    ).rejects.toThrow(/bereits abgestimmt/)
  })

  it('speichert auch bei offener Abstimmung keine Person in der Urne', () => {
    /*
     * Technisch möglich wäre es — der Rechner sieht beides. Gespeichert wird
     * es trotzdem nicht: „offen" heißt, dass im Saal jeder sehen kann, wie
     * abgestimmt wird, nicht dass es nachher in einer Tabelle steht.
     */
    const zeilen = db()
      .prepare(`SELECT participant_id FROM cast_ballots WHERE round_id = ?`)
      .all<{ participant_id: string | null }>(roundId)
    expect(zeilen.length).toBeGreaterThan(0)
    expect(zeilen.every((zeile) => zeile.participant_id === null)).toBe(true)
  })

  it('zählt nach Stimmgewichten', async () => {
    const delegierter = anwesend('Delegierter', 3)
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: delegierter.id })
    await wahl.stimmeEinlegen({
      roundId,
      serial: serial!,
      choice: { kandidaten: [bewerber[1].id] },
      gewicht: 3
    })

    const zaehlung = wahl.zaehlung(roundId)
    const beta = zaehlung.candidates.find((k) => k.candidateId === bewerber[1].id)
    expect(beta?.votes).toBe(3)
  })
})

describe('Geheime Wahl (M2)', () => {
  let roundId = ''
  let bewerber: { id: string; displayName: string }[] = []

  beforeAll(() => {
    roundId = wahlgangMitBewerbern(['Gamma', 'Delta'])
    bewerber = candidates.listCandidates(roundId)
    wahl.prepareVoting({ roundId, geheimnis: 'secret', geraete: 'booth' })
    wahl.openVoting(roundId)
  })

  it('erzeugt je Wahlgang ein eigenes Schlüsselpaar', () => {
    const lage = wahl.votingLage(roundId)!
    expect(lage.schluessel?.n).toBeTruthy()

    const anderer = wahlgangMitBewerbern(['Epsilon'])
    wahl.prepareVoting({ roundId: anderer, geheimnis: 'secret', geraete: 'booth' })
    expect(wahl.votingLage(anderer)!.schluessel?.n).not.toBe(lage.schluessel?.n)
  })

  it('unterschreibt, ohne zu sehen, was', async () => {
    const person = anwesend('Geheim')
    const lage = wahl.votingLage(roundId)!
    const seriennummer = zufall(32)

    const { verblendet, faktor } = await verblenden(seriennummer, lage.schluessel!, sha256, zufall)
    const { signatur } = wahl.berechtigungAusgeben({
      roundId,
      participantId: person.id,
      verblendet
    })
    const echte = entblenden(signatur!, faktor, lage.schluessel!)

    expect(await pruefeSignatur(seriennummer, echte, lage.schluessel!, sha256)).toBe(true)

    await wahl.stimmeEinlegen({
      roundId,
      serial: zuBase64Url(seriennummer),
      signatur: echte,
      choice: { kandidaten: [bewerber[0].id] }
    })
    expect(wahl.votingStand(roundId).abgegeben).toBe(1)
  })

  it('nimmt keine Stimme ohne gültige Unterschrift an', async () => {
    /* Der eigentliche Schutz: Ohne Unterschrift hilft es nichts, eine
       Seriennummer zu erfinden. */
    await expect(
      wahl.stimmeEinlegen({
        roundId,
        serial: zuBase64Url(zufall(32)),
        signatur: zuBase64Url(zufall(256)),
        choice: { kandidaten: [bewerber[0].id] }
      })
    ).rejects.toThrow(/gültige Unterschrift/)

    await expect(
      wahl.stimmeEinlegen({
        roundId,
        serial: zuBase64Url(zufall(32)),
        choice: { kandidaten: [bewerber[0].id] }
      })
    ).rejects.toThrow(/gültige Unterschrift/)
  })

  it('speichert von der Berechtigung nichts über den Stimmzettel', () => {
    /*
     * **Die Prüfung, um die es geht.** Die Berechtigungsseite kennt die Person
     * — sie muss, sonst könnte jemand zweimal. Sie kennt aber keine
     * Seriennummer, und die Urne kennt keine Person. Zwischen beiden Tabellen
     * gibt es keine gemeinsame Spalte.
     */
    const rechte = Object.keys(
      db()
        .prepare(`SELECT * FROM voting_rights WHERE round_id = ? LIMIT 1`)
        .get<Record<string, unknown>>(roundId) ?? {}
    ).sort()
    const urne = Object.keys(
      db()
        .prepare(`SELECT * FROM cast_ballots WHERE round_id = ? LIMIT 1`)
        .get<Record<string, unknown>>(roundId) ?? {}
    ).sort()

    expect(rechte).toEqual(['id', 'issued_at', 'participant_id', 'round_id', 'weight'])
    expect(urne).toEqual(['choice_json', 'id', 'ordnung', 'participant_id', 'round_id', 'serial', 'weight'])
    /* Die einzige gemeinsame Spalte ist der Wahlgang. */
    expect(rechte.filter((spalte) => urne.includes(spalte))).toEqual([
      'id',
      'participant_id',
      'round_id',
      'weight'
    ])
    /* …und `participant_id` bleibt in der Urne leer. */
    const zeilen = db()
      .prepare(`SELECT participant_id FROM cast_ballots WHERE round_id = ?`)
      .all<{ participant_id: string | null }>(roundId)
    expect(zeilen.every((zeile) => zeile.participant_id === null)).toBe(true)
  })

  it('löscht beim Schließen den privaten Schlüssel', () => {
    /* Danach kann niemand mehr Berechtigungen erzeugen — auch nicht, wer den
       Rechner kontrolliert. */
    wahl.closeVoting(roundId)
    const zeile = db()
      .prepare(`SELECT private_key, public_key FROM voting_sessions WHERE round_id = ?`)
      .get<{ private_key: string | null; public_key: string | null }>(roundId)
    expect(zeile?.private_key).toBeNull()
    /* Der öffentliche bleibt — ohne ihn ließe sich nichts nachprüfen. */
    expect(zeile?.public_key).toBeTruthy()
  })

  it('nimmt nach dem Schließen nichts mehr an', async () => {
    const person = anwesend('ZuSpaet')
    expect(() => wahl.berechtigungAusgeben({ roundId, participantId: person.id })).toThrow(/nicht geöffnet/)
  })
})

describe('Namentliche Abstimmung', () => {
  it('führt die Zuordnung — dort ist sie der Zweck', async () => {
    const roundId = wahlgangMitBewerbern(['Zeta'])
    wahl.prepareVoting({ roundId, geheimnis: 'namentlich', geraete: 'own' })
    wahl.openVoting(roundId)

    const person = anwesend('Namentlich')
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    await wahl.stimmeEinlegen({
      roundId,
      serial: serial!,
      choice: { antwort: 'ja' },
      participantId: person.id
    })

    const zeile = db()
      .prepare(`SELECT participant_id FROM cast_ballots WHERE round_id = ?`)
      .get<{ participant_id: string | null }>(roundId)
    expect(zeile?.participant_id).toBe(person.id)
  })

  it('verwirft die Zuordnung, wo sie nicht hingehört', async () => {
    /*
     * Auch wenn ein Gerät sie mitschickt: Bei offener und geheimer Abstimmung
     * wird sie verworfen. Die Betriebsart entscheidet, nicht der Absender.
     */
    const roundId = wahlgangMitBewerbern(['Eta'])
    wahl.prepareVoting({ roundId, geheimnis: 'open', geraete: 'own' })
    wahl.openVoting(roundId)

    const person = anwesend('Untergeschoben')
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    await wahl.stimmeEinlegen({
      roundId,
      serial: serial!,
      choice: { antwort: 'ja' },
      participantId: person.id
    })

    const zeile = db()
      .prepare(`SELECT participant_id FROM cast_ballots WHERE round_id = ?`)
      .get<{ participant_id: string | null }>(roundId)
    expect(zeile?.participant_id).toBeNull()
  })
})
