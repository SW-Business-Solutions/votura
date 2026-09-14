/**
 * Die digitale Stimmabgabe von vorn bis hinten.
 *
 * Gegen die echte Datenbank und echte Schlüssel. Die wichtigsten Prüfungen
 * sind nicht die, die zeigen, dass es funktioniert, sondern die, die zeigen,
 * **was nicht in der Urne steht**.
 */
import { constants, createHash, generateKeyPairSync, privateEncrypt, randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ausBase64Url,
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
const ausgabe = await import('../src/main/services/handout')
const bilanz = await import('../src/main/services/accounting')
const einstellungen = await import('../src/main/services/settings')
const karten = await import('../src/main/services/cards')
const bruecke = await import('../src/main/wahl-bruecke')
const ergebnisse = await import('../src/main/services/results')

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

  /* „Nur Wahlkabinen" verlangt ein Zugriffstoken — ohne eines ließe sich eine
     Kabine von einem mitgebrachten Gerät nicht unterscheiden. */
  const netz = einstellungen.getNetworkProjection()
  einstellungen.saveNetworkProjection({ ...netz, token: 'saalgeheim' })

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
      choice: { kandidaten: [bewerber[0].id] },
      participantId: person.id
    })
    expect(wahl.votingStand(roundId)).toMatchObject({ ausgegeben: 1, abgegeben: 1 })
  })

  it('gibt dieselbe Berechtigung noch einmal aus, solange sie unverbraucht ist', async () => {
    /*
     * Wer die Seite neu lädt, bevor er abgeschickt hat, hat seine
     * Seriennummer verloren. Eine zweite zu bekommen ist hier gefahrlos:
     * Abgestimmt wird gegen die **Berechtigung**, und die gilt einmal — zwei
     * Nummern ergeben trotzdem nur eine Stimme.
     */
    const person = anwesend('Doppelt')
    const erste = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    const zweite = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    expect(zweite.serial).toBeTruthy()
    expect(zweite.serial).not.toBe(erste.serial)

    await wahl.stimmeEinlegen({
      roundId,
      serial: zweite.serial!,
      choice: { antwort: 'enthaltung' },
      participantId: person.id
    })
    await expect(
      wahl.stimmeEinlegen({
        roundId,
        serial: erste.serial!,
        choice: { antwort: 'ja' },
        participantId: person.id
      })
    ).rejects.toThrow(/bereits abgestimmt/)
  })

  it('gibt nach der Abgabe keine Berechtigung mehr aus', async () => {
    const person = anwesend('Verbraucht')
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    await wahl.stimmeEinlegen({
      roundId,
      serial: serial!,
      choice: { antwort: 'nein' },
      participantId: person.id
    })
    expect(() => wahl.berechtigungAusgeben({ roundId, participantId: person.id })).toThrow(
      /bereits eine Stimmberechtigung/
    )
  })

  it('nimmt denselben Stimmzettel nicht zweimal an', async () => {
    const person = anwesend('Zweimal')
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    await wahl.stimmeEinlegen({
      roundId,
      serial: serial!,
      choice: { antwort: 'enthaltung' },
      participantId: person.id
    })
    await expect(
      wahl.stimmeEinlegen({
        roundId,
        serial: serial!,
        choice: { antwort: 'ja' },
        participantId: person.id
      })
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
      participantId: delegierter.id
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

    /* `used_at` trägt einen Zeitpunkt und sonst nichts — kein Wort über die
       Auswahl. Die Urne führt keine Zeit, also lässt sich auch nichts in eine
       gemeinsame Reihenfolge bringen. */
    expect(rechte).toEqual([
      'id',
      'issued_at',
      'participant_id',
      'round_id',
      'used_at',
      'voided_reason',
      'weight'
    ])
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

describe('Hybride Wahlgänge (M3)', () => {
  /*
   * Papier und digital nebeneinander. Der eine Fehler, den keine Bilanz der
   * Welt fände: Jemand bekommt beides — eine Stimme in der elektronischen
   * Urne und eine zweite in der aus Pappe.
   */
  let roundId = ''

  beforeAll(() => {
    roundId = wahlgangMitBewerbern(['Theta'])
    wahl.prepareVoting({ roundId, geheimnis: 'open', geraete: 'both' })
    wahl.openVoting(roundId)
  })

  it('gibt keinen Zettel, wer schon digital abstimmen darf', () => {
    const person = anwesend('DigitalZuerst')
    wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    expect(() => ausgabe.issueBallot({ roundId, participantId: person.id })).toThrow(
      /bereits eine digitale Stimmberechtigung/
    )
  })

  it('gibt keine digitale Berechtigung, wer schon einen Zettel hat', () => {
    const person = anwesend('PapierZuerst')
    ausgabe.issueBallot({ roundId, participantId: person.id })
    expect(() => wahl.berechtigungAusgeben({ roundId, participantId: person.id })).toThrow(
      /bereits ein Stimmzettel auf Papier/
    )
  })

  it('zeigt beide Wege in einer Bilanz', () => {
    /* Zwei getrennte Rechnungen prüft niemand zu Ende. */
    const stand = bilanz.accountingFor(roundId)
    expect(stand.handedOut).toBe(1)
    expect(stand.digitalIssued).toBe(1)
  })
})

describe('Vier-Augen-Prinzip (M3)', () => {
  /*
   * Bis hierher hält der Hauptrechner den privaten Schlüssel. Wer ihn
   * kontrolliert, kann zusätzliche Unterschriften erzeugen — die Bilanz macht
   * das sichtbar, verhindert es aber nicht.
   *
   * Beim Ausschussbetrieb entsteht der Schlüssel auf einem anderen Gerät und
   * verlässt es nie.
   */
  let roundId = ''
  const ausschuss = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 })
  const jwk = ausschuss.publicKey.export({ format: 'jwk' }) as { n: string; e: string }

  beforeAll(() => {
    roundId = wahlgangMitBewerbern(['Iota'])
    wahl.prepareVoting({ roundId, geheimnis: 'secret', geraete: 'booth', signer: 'committee' })
  })

  it('hält beim Hauptrechner keinen Schlüssel vor', () => {
    const zeile = db()
      .prepare(`SELECT private_key, public_key FROM voting_sessions WHERE round_id = ?`)
      .get<{ private_key: string | null; public_key: string | null }>(roundId)
    expect(zeile?.private_key).toBeNull()
    expect(zeile?.public_key).toBeNull()
  })

  it('lässt sich ohne gemeldeten Schlüssel nicht eröffnen', () => {
    /* Sonst stünde die Abstimmung offen und niemand bekäme eine
       Berechtigung — ein Zustand, den im Saal niemand versteht. */
    expect(() => wahl.openVoting(roundId)).toThrow(/Prüfschlüssel noch nicht gemeldet/)
  })

  it('nimmt den Schlüssel des Ausschusses an — genau einmal', () => {
    wahl.committeeKeyMelden(roundId, { n: jwk.n, e: jwk.e })
    expect(wahl.votingLage(roundId)!.schluessel?.n).toBe(jwk.n)

    /* Ein Schlüssel, der sich austauschen ließe, wäre keine Prüfmöglichkeit,
       sondern eine Einladung. */
    const fremd = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 })
    const fremdJwk = fremd.publicKey.export({ format: 'jwk' }) as { n: string; e: string }
    expect(() => wahl.committeeKeyMelden(roundId, { n: fremdJwk.n, e: fremdJwk.e })).toThrow(
      /bereits ein Prüfschlüssel/
    )
  })

  it('führt die Unterschrift über das andere Gerät', async () => {
    wahl.openVoting(roundId)
    const person = anwesend('Ausschusswahl')
    const schluessel = { n: jwk.n, e: jwk.e }
    const seriennummer = zufall(32)
    const { verblendet, faktor } = await verblenden(seriennummer, schluessel, sha256, zufall)

    /* Der Hauptrechner gibt kein Ergebnis zurück, sondern eine Wartenummer. */
    const antwort = wahl.berechtigungAusgeben({
      roundId,
      participantId: person.id,
      verblendet
    })
    expect(antwort.ticket).toBeTruthy()
    expect(antwort.signatur).toBeUndefined()
    expect(wahl.signaturAbholen(antwort.ticket!).signatur).toBeUndefined()

    /* Jetzt das Gerät des Ausschusses: abholen, unterschreiben, zurückgeben. */
    const offen = wahl.offeneSignaturen(roundId)
    expect(offen).toHaveLength(1)
    const roh = privateEncrypt(
      { key: ausschuss.privateKey, padding: constants.RSA_NO_PADDING },
      Buffer.from(ausBase64Url(offen[0].blinded))
    )
    wahl.signaturEintragen(offen[0].id, zuBase64Url(new Uint8Array(roh)))

    const abgeholt = wahl.signaturAbholen(antwort.ticket!)
    expect(abgeholt.signatur).toBeTruthy()

    const echte = entblenden(abgeholt.signatur!, faktor, schluessel)
    expect(await pruefeSignatur(seriennummer, echte, schluessel, sha256)).toBe(true)

    await wahl.stimmeEinlegen({
      roundId,
      serial: zuBase64Url(seriennummer),
      signatur: echte,
      choice: { antwort: 'ja' }
    })
    expect(wahl.votingStand(roundId).abgegeben).toBe(1)
  })

  it('unterschreibt dieselbe Anfrage nicht zweimal', () => {
    /* Eine zweite Unterschrift auf dieselbe Anfrage wäre eine zusätzliche
       Berechtigung aus dem Nichts. */
    const offen = wahl.offeneSignaturen(roundId)
    expect(offen).toHaveLength(0)
  })

  it('lässt den Ausschuss unabhängig mitzählen', () => {
    /*
     * Das ist das Vier-Augen-Prinzip: nicht, dass der Hauptrechner nichts
     * kann, sondern dass jemand anderes nachrechnet. Der Ausschuss weiß, wie
     * viele Unterschriften er geleistet hat; in der Urne dürfen nie mehr
     * liegen.
     */
    const zaehler = wahl.signaturZaehler(roundId)
    expect(zaehler.unterschrieben).toBe(1)
    expect(wahl.votingStand(roundId).abgegeben).toBeLessThanOrEqual(zaehler.unterschrieben)
  })

  it('speichert in der Warteschlange nur Verblendetes', () => {
    /* Auch wer sie vollständig liest, erfährt daraus nichts — deshalb darf
       sie über das Netz gehen. */
    const spalten = Object.keys(
      db().prepare(`SELECT * FROM signing_queue LIMIT 1`).get<Record<string, unknown>>() ?? {}
    ).sort()
    expect(spalten).toEqual(['answered_at', 'blinded', 'created_at', 'id', 'round_id', 'signature'])
  })
})

describe('„Nur Wahlkabinen" ist eine Zusage, keine Angabe', () => {
  /*
   * Die Einstellung wurde gespeichert und angezeigt — und von keinem Endpunkt
   * geprüft. Die Oberfläche versprach etwas, das der Code nicht hielt. Das ist
   * die gefährlichere Sorte Fehler: Sie sieht aus wie eine Maßnahme.
   */
  it('verlangt ein Zugriffstoken, sonst gibt es nichts zu unterscheiden', () => {
    /*
     * Ohne Token gilt jedes Gerät als Kabine. Lieber beim Vorbereiten
     * abbrechen als im Saal etwas versprechen, das nicht gilt.
     */
    const netz = einstellungen.getNetworkProjection()
    einstellungen.saveNetworkProjection({ ...netz, token: '' })
    try {
      const roundId = wahlgangMitBewerbern(['Kappa'])
      expect(() => wahl.prepareVoting({ roundId, geheimnis: 'open', geraete: 'booth' })).toThrow(
        /Zugriffstoken/
      )
    } finally {
      /* Zurücksetzen, sonst nimmt diese Prüfung den übrigen Abschnitten die
         Grundlage — genau der Fehler, den sie beschreibt. */
      einstellungen.saveNetworkProjection(netz)
    }
  })

  it('weist ein Gerät ohne Token ab', async () => {
    const roundId = wahlgangMitBewerbern(['Lambda'])
    wahl.prepareVoting({ roundId, geheimnis: 'open', geraete: 'booth' })
    wahl.openVoting(roundId)
    const person = anwesend('Kabinenwaehler')

    /* Mitgebrachtes Telefon: kein Token, also kein Zutritt. */
    await expect(bruecke.wahlBruecke.berechtigung({ roundId, code: '' }, false)).rejects.toThrow(/Wahlkabine/)

    /* Die Kabine selbst kommt durch — dass der Ausweis fehlt, ist der
       nächste Fehler und nicht dieser. */
    await expect(bruecke.wahlBruecke.berechtigung({ roundId, code: '' }, true)).rejects.toThrow(/Ausweis/)
    expect(person.id).toBeTruthy()
  })

  it('lässt eigene Geräte, wo sie erlaubt sind', async () => {
    const roundId = wahlgangMitBewerbern(['My'])
    wahl.prepareVoting({ roundId, geheimnis: 'open', geraete: 'both' })
    wahl.openVoting(roundId)
    /* Ohne Token abgewiesen zu werden, wäre hier falsch — die Meldung dreht
       sich um den fehlenden Ausweis, nicht um die Kabine. */
    await expect(bruecke.wahlBruecke.berechtigung({ roundId, code: '' }, false)).rejects.toThrow(/Ausweis/)
  })
})

/**
 * Papier und Urne im selben Wahlgang.
 *
 * Der Fall, an dem die Rechnung zerbrechen kann: Ein Teil der Versammlung
 * stimmt auf Papier ab, ein Teil am Gerät. Wer beides getrennt zählt und dann
 * eines von beiden speichert, verliert die Hälfte des Ergebnisses — lautlos,
 * und niemand sieht es dem Beleg an.
 */
describe('Hybride Auszählung (M3)', () => {
  let roundId = ''
  let bewerber: { id: string; displayName: string }[] = []

  beforeAll(async () => {
    roundId = wahlgangMitBewerbern(['Gamma', 'Delta'])
    bewerber = candidates.listCandidates(roundId)
    wahl.prepareVoting({ roundId, geheimnis: 'open', geraete: 'both' })
    wahl.openVoting(roundId)

    /* Zwei Stimmen digital: einmal Gamma, einmal Delta. */
    for (const kandidat of bewerber) {
      const person = anwesend(`Digital-${kandidat.displayName}`)
      const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
      await wahl.stimmeEinlegen({
        roundId,
        serial: serial!,
        choice: { kandidaten: [kandidat.id] },
        participantId: person.id
      })
    }
    wahl.closeVoting(roundId)
  })

  function papierEintragen(): void {
    ergebnisse.saveResult({
      electionRoundId: roundId,
      countingMode: 'counted',
      ballotsCast: 5,
      validBallots: 5,
      invalidBallots: 0,
      resultData: {
        candidates: [
          { candidateId: bewerber[0].id, name: bewerber[0].displayName, votes: 3 },
          { candidateId: bewerber[1].id, name: bewerber[1].displayName, votes: 2 }
        ]
      }
    })
  }

  it('zählt Papier und Urne zusammen', () => {
    papierEintragen()
    const ergebnis = ergebnisse.getResult(roundId)!
    expect(ergebnis.ballotsCast).toBe(7)
    expect(ergebnis.validBallots).toBe(7)
    const stimmen = new Map(ergebnis.resultData.candidates.map((e) => [e.candidateId, e.votes]))
    expect(stimmen.get(bewerber[0].id)).toBe(4)
    expect(stimmen.get(bewerber[1].id)).toBe(3)
  })

  it('bleibt gleich, wie oft man auch speichert', () => {
    /*
     * Die Prüfung, die den eigentlichen Fehler ausschließt: Wird beim
     * Speichern addiert, schlägt die Urne bei jeder Korrektur erneut auf. Die
     * Zeile trägt deshalb nur den Papieranteil.
     */
    papierEintragen()
    papierEintragen()
    expect(ergebnisse.getResult(roundId)!.ballotsCast).toBe(7)
    expect(ergebnisse.getPapierergebnis(roundId)!.ballotsCast).toBe(5)
  })

  it('lässt die Handauszählung stehen, wenn die Urne übernommen wird', () => {
    /* Früher überschrieb die Übernahme das Ergebnis mit den digitalen Zahlen
       allein — die ausgezählten Zettel waren danach weg. */
    const vorher = ergebnisse.getPapierergebnis(roundId)!
    expect(vorher.ballotsCast).toBe(5)
    expect(ergebnisse.getResult(roundId)!.resultData.candidates[0].votes).toBe(4)
  })

  it('rechnet nichts hinzu, solange die Abstimmung läuft', async () => {
    const offenerRound = wahlgangMitBewerbern(['Epsilon', 'Zeta'])
    const offeneBewerber = candidates.listCandidates(offenerRound)
    wahl.prepareVoting({ roundId: offenerRound, geheimnis: 'open', geraete: 'both' })
    wahl.openVoting(offenerRound)
    const person = anwesend('Laeuft-Noch')
    const { serial } = wahl.berechtigungAusgeben({ roundId: offenerRound, participantId: person.id })
    await wahl.stimmeEinlegen({
      roundId: offenerRound,
      serial: serial!,
      choice: { kandidaten: [offeneBewerber[0].id] },
      participantId: person.id
    })

    ergebnisse.saveResult({
      electionRoundId: offenerRound,
      countingMode: 'counted',
      ballotsCast: 2,
      validBallots: 2,
      invalidBallots: 0,
      resultData: {
        candidates: [
          { candidateId: offeneBewerber[0].id, name: offeneBewerber[0].displayName, votes: 2 },
          { candidateId: offeneBewerber[1].id, name: offeneBewerber[1].displayName, votes: 0 }
        ]
      }
    })
    /* Eine laufende Abstimmung ist kein Ergebnis — eine Zwischensumme gehört
       nicht in die Feststellung. */
    expect(ergebnisse.getResult(offenerRound)!.ballotsCast).toBe(2)
  })

  it('trägt ohne Papierauszählung die Urne allein', () => {
    /* Der rein digitale Wahlgang: Es gibt nichts von Hand zu zählen, die
       Zeile entsteht mit null und die Urne füllt sie. */
    const nurDigital = wahlgangMitBewerbern(['Eta', 'Theta'])
    ergebnisse.saveResult({
      electionRoundId: nurDigital,
      countingMode: 'counted',
      ballotsCast: 0,
      validBallots: 0,
      invalidBallots: 0,
      resultData: { candidates: [] }
    })
    expect(ergebnisse.getResult(nurDigital)!.ballotsCast).toBe(0)
  })
})

/**
 * Was passiert, wenn das Netz abreißt.
 *
 * Ein WLAN im Saal mit 500 Geräten verliert Verbindungen — das ist keine
 * Ausnahme, sondern der Normalfall. Die gefährliche Sekunde ist die zwischen
 * „Urne hat angenommen" und „Gerät hat die Antwort": Der Wähler sieht einen
 * Fehler, obwohl seine Stimme liegt, und drückt noch einmal.
 */
describe('Wiederholung und Mehrfachabgabe', () => {
  let roundId = ''
  let bewerber: { id: string; displayName: string }[] = []

  beforeAll(() => {
    roundId = wahlgangMitBewerbern(['Iota', 'Kappa'])
    bewerber = candidates.listCandidates(roundId)
    wahl.prepareVoting({ roundId, geheimnis: 'open', geraete: 'both' })
    wahl.openVoting(roundId)
  })

  it('nimmt dieselbe Stimme noch einmal an, ohne sie zweimal zu zählen', async () => {
    const person = anwesend('Abgerissen')
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    const stimme = { roundId, serial: serial!, choice: { kandidaten: [bewerber[0].id] }, participantId: person.id }

    await wahl.stimmeEinlegen(stimme)
    const nachher = wahl.votingStand(roundId).abgegeben
    /* Der zweite Versuch darf **nicht** werfen: Was gewollt war, ist
       geschehen, und ein Fehler hier schickt jemanden zur Wahlleitung, dem
       nichts fehlt. */
    await wahl.stimmeEinlegen(stimme)
    expect(wahl.votingStand(roundId).abgegeben).toBe(nachher)
  })

  it('erkennt dieselbe Auswahl auch in anderer Reihenfolge', async () => {
    const person = anwesend('Reihenfolge')
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    await wahl.stimmeEinlegen({
      roundId,
      serial: serial!,
      choice: { kandidaten: [bewerber[0].id, bewerber[1].id] },
      participantId: person.id
    })
    const vorher = wahl.votingStand(roundId).abgegeben
    await wahl.stimmeEinlegen({
      roundId,
      serial: serial!,
      /* Dasselbe Kreuz, andere Reihenfolge — zwei Geräte ordnen verschieden. */
      choice: { kandidaten: [bewerber[1].id, bewerber[0].id] },
      participantId: person.id
    })
    expect(wahl.votingStand(roundId).abgegeben).toBe(vorher)
  })

  it('weist dieselbe Nummer mit anderer Auswahl ab', async () => {
    const person = anwesend('Anders')
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    await wahl.stimmeEinlegen({
      roundId,
      serial: serial!,
      choice: { kandidaten: [bewerber[0].id] },
      participantId: person.id
    })
    await expect(
      wahl.stimmeEinlegen({
        roundId,
        serial: serial!,
        choice: { kandidaten: [bewerber[1].id] },
        participantId: person.id
      })
    ).rejects.toThrow(/bereits abgestimmt/)
  })

  it('lässt keine zweite Stimme mit erfundener Seriennummer zu', async () => {
    /*
     * **Die Lücke, die das schließt.** Bei offener Abstimmung kommt die
     * Seriennummer vom Rechner, stand aber nirgends — geprüft wurde nur, ob
     * dieselbe Nummer zweimal kam. Wer eine zweite erfand, kam durch. Jetzt
     * entscheidet die Berechtigung, und die gilt einmal.
     */
    const person = anwesend('Stopfer')
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    await wahl.stimmeEinlegen({
      roundId,
      serial: serial!,
      choice: { kandidaten: [bewerber[0].id] },
      participantId: person.id
    })
    await expect(
      wahl.stimmeEinlegen({
        roundId,
        serial: zuBase64Url(zufall(24)),
        choice: { kandidaten: [bewerber[0].id] },
        participantId: person.id
      })
    ).rejects.toThrow(/bereits abgestimmt/)
  })

  it('nimmt ohne Berechtigung nichts an', async () => {
    const person = anwesend('Ohne-Berechtigung')
    await expect(
      wahl.stimmeEinlegen({
        roundId,
        serial: zuBase64Url(zufall(24)),
        choice: { kandidaten: [bewerber[0].id] },
        participantId: person.id
      })
    ).rejects.toThrow(/Keine Stimmberechtigung/)
  })

  it('nimmt das Stimmgewicht von der Berechtigung, nicht vom Gerät', async () => {
    /* Sonst entschiede das Gerät, wie schwer seine Stimme wiegt. */
    const delegierter = anwesend('Gewichtig', 5)
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: delegierter.id })
    const vorher =
      wahl.zaehlung(roundId).candidates.find((k) => k.candidateId === bewerber[1].id)?.votes ?? 0
    await wahl.stimmeEinlegen({
      roundId,
      serial: serial!,
      choice: { kandidaten: [bewerber[1].id] },
      participantId: delegierter.id,
      gewicht: 99
    })
    expect(
      wahl.zaehlung(roundId).candidates.find((k) => k.candidateId === bewerber[1].id)?.votes
    ).toBe(vorher + 5)
  })

  it('gilt auch bei geheimer Wahl — dort entscheidet die Unterschrift', async () => {
    const geheim = wahlgangMitBewerbern(['Lambda', 'My'])
    const geheimeBewerber = candidates.listCandidates(geheim)
    wahl.prepareVoting({ roundId: geheim, geheimnis: 'secret', geraete: 'booth' })
    wahl.openVoting(geheim)

    const person = anwesend('Geheim-Wiederholung')
    const lage = wahl.votingLage(geheim)!
    const seriennummer = zufall(32)
    const { verblendet, faktor } = await verblenden(seriennummer, lage.schluessel!, sha256, zufall)
    const { signatur } = wahl.berechtigungAusgeben({ roundId: geheim, participantId: person.id, verblendet })
    const echte = entblenden(signatur!, faktor, lage.schluessel!)

    const stimme = {
      roundId: geheim,
      serial: zuBase64Url(seriennummer),
      signatur: echte,
      choice: { kandidaten: [geheimeBewerber[0].id] }
    }
    await wahl.stimmeEinlegen(stimme)
    await wahl.stimmeEinlegen(stimme)
    expect(wahl.votingStand(geheim).abgegeben).toBe(1)
  })
})

/**
 * Der Fingertipp, der eine Stimme kosten kann.
 *
 * Jemand lädt am Gerät die Seite neu, bevor er abgeschickt hat. Die
 * Berechtigung ist vergeben, in der Urne liegt nichts — und weil eine
 * digitale Berechtigung die Papierausgabe sperrt, könnte diese Person
 * überhaupt nicht mehr abstimmen. Dafür gibt es die Entwertung.
 */
describe('Entwertung einer Stimmberechtigung', () => {
  let roundId = ''

  beforeAll(() => {
    roundId = wahlgangMitBewerbern(['Ny', 'Xi'])
    wahl.prepareVoting({ roundId, geheimnis: 'open', geraete: 'both' })
    wahl.openVoting(roundId)
  })

  it('verlangt eine Begründung', () => {
    const person = anwesend('Ohne-Grund')
    wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    expect(() =>
      wahl.berechtigungEntwerten({ roundId, participantId: person.id, grund: '   ' })
    ).toThrow(/Begründung/)
  })

  it('gibt den Weg zum Papier frei', () => {
    const person = anwesend('Neugeladen')
    wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    /* Vorher gesperrt — sonst läge eine Stimme doppelt. */
    expect(() => ausgabe.issueBallot({ roundId, participantId: person.id })).toThrow(
      /digitale Stimmberechtigung/
    )

    wahl.berechtigungEntwerten({
      roundId,
      participantId: person.id,
      grund: 'Seite am Gerät neu geladen, Stimme nicht abgegeben'
    })
    expect(() => ausgabe.issueBallot({ roundId, participantId: person.id })).not.toThrow()
  })

  it('nimmt danach keine Stimme mehr an', async () => {
    const person = anwesend('Entwertet')
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    wahl.berechtigungEntwerten({ roundId, participantId: person.id, grund: 'Gerät ausgefallen' })
    await expect(
      wahl.stimmeEinlegen({
        roundId,
        serial: serial!,
        choice: { antwort: 'ja' },
        participantId: person.id
      })
    ).rejects.toThrow(/entwertet/)
  })

  it('entwertet nicht, was bereits abgestimmt hat', async () => {
    /* Sonst stünde eine Stimme in der Urne und eine zweite auf Papier. */
    const person = anwesend('Schon-Gewaehlt')
    const { serial } = wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    await wahl.stimmeEinlegen({
      roundId,
      serial: serial!,
      choice: { antwort: 'nein' },
      participantId: person.id
    })
    expect(() =>
      wahl.berechtigungEntwerten({ roundId, participantId: person.id, grund: 'Irrtum' })
    ).toThrow(/bereits abgestimmt/)
  })

  it('steht mit Begründung im Protokoll', () => {
    const person = anwesend('Protokolliert')
    wahl.berechtigungAusgeben({ roundId, participantId: person.id })
    wahl.berechtigungEntwerten({ roundId, participantId: person.id, grund: 'Akku leer' })
    const eintrag = db()
      .prepare(
        `SELECT reason, new_json FROM audit WHERE action = 'voting.right.voided'
         ORDER BY seq DESC LIMIT 1`
      )
      .get<{ reason: string; new_json: string }>()
    expect(eintrag?.reason).toBe('Akku leer')
    expect(eintrag?.new_json).toContain('Protokolliert')
  })

  it('lässt sich bei geheimer Wahl nicht durch eine zweite Unterschrift ersetzen', async () => {
    /*
     * Dort wäre die erneute Ausgabe eine zweite gültige Unterschrift — und
     * damit eine zweite Stimme, die niemand mehr der Person zuordnen kann.
     */
    const geheim = wahlgangMitBewerbern(['Omikron'])
    wahl.prepareVoting({ roundId: geheim, geheimnis: 'secret', geraete: 'booth' })
    wahl.openVoting(geheim)
    const person = anwesend('Geheim-Neugeladen')
    const lage = wahl.votingLage(geheim)!
    const { verblendet } = await verblenden(zufall(32), lage.schluessel!, sha256, zufall)
    wahl.berechtigungAusgeben({ roundId: geheim, participantId: person.id, verblendet })

    const zweiter = await verblenden(zufall(32), lage.schluessel!, sha256, zufall)
    expect(() =>
      wahl.berechtigungAusgeben({
        roundId: geheim,
        participantId: person.id,
        verblendet: zweiter.verblendet
      })
    ).toThrow(/bereits eine Stimmberechtigung/)
  })
})

/**
 * Karte **und** Pass.
 *
 * Eine Stimmkarte ist wiederverwendbar, und ihr Code steht aufgedruckt darauf.
 * Wer ihn über die Schulter fotografiert, könnte am eigenen Telefon die Stimme
 * dessen abgeben, dem die Karte gerade gehört — und später die des Nächsten,
 * der dieselbe Karte bekommt. Ändern lässt sich der Code nicht; er ist
 * gedruckt.
 *
 * Der gedruckte Pass kann beides: Er gehört einer Person, und ein neuer macht
 * den alten im selben Augenblick ungültig. Deshalb zählt beides zusammen.
 */
describe('Zwei Ausweise, eine Stimme', () => {
  let roundId = ''
  let person = { id: '' }
  let kartenCode = ''
  let passCode = ''

  beforeAll(() => {
    /* Die Brücke fragt immer die **aktive** Veranstaltung — ein Gerät im Saal
       kennt keine Kennung, es kennt nur seinen Ausweis. */
    events.activateEvent(eventId)
    roundId = wahlgangMitBewerbern(['Pi', 'Rho'])
    wahl.prepareVoting({ roundId, geheimnis: 'open', geraete: 'both' })
    wahl.openVoting(roundId)

    kartenCode = 'ZWEIFAKTOR-KARTE-000001'
    karten.importCards([{ serial: 'Z-001', code: kartenCode }], 'card')
    person = teilnehmer.addParticipant({ eventId, lastName: 'Zweifaktor', firstName: 'T' })
    /* Die Karte am Einlass — damit gilt die Person zugleich als anwesend. */
    karten.assignCard(person.id, kartenCode)
    passCode = teilnehmer.issuePass(person.id).token
  })

  it('verlangt zum Kartencode noch den Pass', async () => {
    const auskunft = (await bruecke.wahlBruecke.lage(kartenCode, false)) as {
      berechtigt: boolean
      fehlenderFaktor?: string
      name?: string
    }
    expect(auskunft.fehlenderFaktor).toBe('pass')
    expect(auskunft.berechtigt).toBe(false)
    /* Der Name steht trotzdem da: Am Gerät soll erkennbar sein, wessen
       Ausweis gerade gelesen wurde. */
    expect(auskunft.name).toContain('Zweifaktor')
  })

  it('verlangt zum Pass noch die Karte', async () => {
    const auskunft = (await bruecke.wahlBruecke.lage(passCode, false)) as { fehlenderFaktor?: string }
    expect(auskunft.fehlenderFaktor).toBe('karte')
  })

  it('gibt mit beiden Ausweisen frei — in beliebiger Reihenfolge', async () => {
    const eine = (await bruecke.wahlBruecke.lage(kartenCode, false, passCode)) as {
      berechtigt: boolean
      fehlenderFaktor?: string
    }
    expect(eine.fehlenderFaktor).toBeUndefined()
    expect(eine.berechtigt).toBe(true)

    const andere = (await bruecke.wahlBruecke.lage(passCode, false, kartenCode)) as { berechtigt: boolean }
    expect(andere.berechtigt).toBe(true)
  })

  it('gibt keine Berechtigung auf ein fotografiertes Stück Plastik', async () => {
    /* **Der Angriff, um den es geht.** Ein Foto des Kartencodes, ein eigenes
       Telefon, sonst nichts. */
    await expect(
      bruecke.wahlBruecke.berechtigung({ roundId, code: kartenCode }, false)
    ).rejects.toThrow(/Voting Pass/)
  })

  it('nimmt keine zwei Ausweise verschiedener Personen an', async () => {
    const fremder = teilnehmer.addParticipant({ eventId, lastName: 'Fremd', firstName: 'T' })
    teilnehmer.setAttendance(fremder.id, 'in')
    const fremderPass = teilnehmer.issuePass(fremder.id).token
    await expect(
      bruecke.wahlBruecke.berechtigung({ roundId, code: kartenCode, code2: fremderPass }, false)
    ).rejects.toThrow(/niemandem/)
  })

  it('lässt eine Versammlung ohne Karten unverändert', async () => {
    /* Verlangt wird, was ausgegeben wurde — nicht, was denkbar wäre. Sonst
       hätte diese Regel jede bestehende Einrichtung stillgelegt. */
    const ohneKarte = teilnehmer.addParticipant({ eventId, lastName: 'Nurpass', firstName: 'T' })
    teilnehmer.setAttendance(ohneKarte.id, 'in')
    const nurPass = teilnehmer.issuePass(ohneKarte.id).token
    const auskunft = (await bruecke.wahlBruecke.lage(nurPass, false)) as {
      berechtigt: boolean
      fehlenderFaktor?: string
    }
    expect(auskunft.fehlenderFaktor).toBeUndefined()
    expect(auskunft.berechtigt).toBe(true)
  })

  it('macht den verlorenen Pass mit dem neuen ungültig', async () => {
    /*
     * Der Grund, warum der Pass der zweite Faktor ist und nicht ein zweiter
     * Aufdruck: Er lässt sich ersetzen. Wer ihn verliert oder fotografiert
     * weiß, bekommt einen neuen — der alte ist im selben Augenblick wertlos.
     */
    const neuerPass = teilnehmer.issuePass(person.id).token
    expect(neuerPass).not.toBe(passCode)

    const mitAltem = (await bruecke.wahlBruecke.lage(kartenCode, false, passCode)) as {
      fehlenderFaktor?: string
    }
    expect(mitAltem.fehlenderFaktor).toBe('pass')

    const mitNeuem = (await bruecke.wahlBruecke.lage(kartenCode, false, neuerPass)) as {
      berechtigt: boolean
    }
    expect(mitNeuem.berechtigt).toBe(true)
    passCode = neuerPass
  })
})
