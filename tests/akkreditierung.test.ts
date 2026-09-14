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
const karten = await import('../src/main/services/cards')
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

describe('Ohne Akkreditierung ändert sich nichts', () => {
  it('hält keinen Stand fest, wo niemand erfasst ist', () => {
    /*
     * Der gefährlichste Fall dieser Erweiterung: Stünde für eine Versammlung
     * ohne Teilnehmerliste eine Null im Stand, sähe sie aus wie eine Messung
     * — und ginge als „null Stimmberechtigte" ins Ergebnis. Das wäre
     * schlimmer als die eingetippte Zahl, die es vorher gab.
     */
    const leeres = events.createEvent({
      title: 'Ohne Liste',
      organization: 'Musterverein',
      orgCode: 'OL',
      date: '2026-09-14',
      location: 'Saal',
      ruleSet: { name: 'Satzung', version: '1', snapshotDate: '2026-09-14' }
    }).id
    expect(teilnehmer.hasAccreditation(leeres)).toBe(false)

    const mitListe = events.createEvent({
      title: 'Mit Liste',
      organization: 'Musterverein',
      orgCode: 'ML',
      date: '2026-09-14',
      location: 'Saal',
      ruleSet: { name: 'Satzung', version: '1', snapshotDate: '2026-09-14' }
    }).id
    teilnehmer.addParticipant({ eventId: mitListe, lastName: 'G', firstName: 'T' })
    expect(teilnehmer.hasAccreditation(mitListe)).toBe(true)
  })
})

describe('Stimmkarten', () => {
  /*
   * Der Grund für Karten: Ein Papierpass bleibt auf einem Stuhl liegen, und
   * niemand bemerkt es, bis jemand abstimmen will. Eine Karte kommt am Ausgang
   * zurück.
   *
   * Der Preis: Sie ist ein Inhaberpapier. Wer sie hat, gilt als der, dem sie
   * zugewiesen ist. Die Prüfungen halten fest, was den Schaden begrenzt.
   */
  const code = (n: number): string => `KARTE-GEHEIM-${String(n).padStart(6, '0')}`

  it('nimmt Karten in den Bestand auf und überspringt Doppelte', () => {
    const erst = karten.importCards([
      { serial: '001', code: code(1) },
      { serial: '002', code: code(2) }
    ])
    expect(erst).toEqual({ added: 2, skipped: 0 })
    /* Zweimal eingelesene Lieferung darf nicht abbrechen. */
    const nochmal = karten.importCards([
      { serial: '002', code: code(2) },
      { serial: '003', code: code(3) }
    ])
    expect(nochmal).toEqual({ added: 1, skipped: 1 })
  })

  it('speichert den Code nicht im Klartext', () => {
    /* Die Bestandsliste wäre sonst ein Stapel gültiger Karten in Textform. */
    const zeile = db()
      .prepare(`SELECT code_hash FROM cards WHERE serial = '001'`)
      .get<{ code_hash: string }>()
    expect(zeile?.code_hash).not.toBe(code(1))
    expect(zeile?.code_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('weist eine freie Karte niemanden aus', () => {
    /* Eine Karte im Stapel ist kein Ausweis — sie wartet. */
    const treffer = karten.resolveScan(eventId, code(3))
    expect(treffer?.kind).toBe('card')
    expect(treffer && treffer.kind === 'card' ? treffer.participant : undefined).toBeNull()
  })

  it('macht mit der Ausgabe zugleich anwesend', () => {
    /* Ein Handgriff statt zwei — am Einlass wird gescannt, nicht geklickt. */
    const person = anlegen('Kartenträger')
    const { participant } = karten.assignCard(person.id, code(1))
    expect(participant.present).toBe(true)
    expect(karten.cardHeldBy(person.id)?.serial).toBe('001')
  })

  it('weist dieselbe Karte nicht zweimal zu', () => {
    const zweiter = anlegen('Zweiter')
    expect(() => karten.assignCard(zweiter.id, code(1))).toThrow(/bereits vergeben/)
  })

  it('nimmt einer Person die alte Karte ab, wenn sie eine neue bekommt', () => {
    /* Sonst hielte jemand zwei, und der Bestand stimmte nicht mehr. */
    const person = karten.resolveScan(eventId, code(1))
    const id = person && person.kind === 'card' ? person.participant!.id : ''
    karten.assignCard(id, code(2))
    expect(karten.cardHeldBy(id)?.serial).toBe('002')
    expect(karten.findCardByCode(code(1))?.heldBy).toBeUndefined()
  })

  it('macht mit der Rückgabe zugleich abwesend', () => {
    const { participant } = karten.returnCard(code(2))
    expect(participant?.present).toBe(false)
    expect(karten.findCardByCode(code(2))?.heldBy).toBeUndefined()
  })

  it('sperrt eine verlorene Karte und beendet ihre Zuweisung', () => {
    const person = anlegen('Verloren')
    const { card } = karten.assignCard(person.id, code(3))
    karten.setCardStatus(card.id, 'lost', 'im Saal liegengeblieben')

    const danach = karten.findCardByCode(code(3))
    expect(danach?.status).toBe('lost')
    expect(danach?.heldBy).toBeUndefined()
    /* Auch wenn sie wieder auftaucht: nicht mehr ausgebbar. */
    expect(() => karten.assignCard(person.id, code(3))).toThrow(/verloren/)
  })

  it('zählt den Bestand', () => {
    const stand = karten.cardStock()
    expect(stand.total).toBe(3)
    expect(stand.lost).toBe(1)
    expect(stand.available + stand.assigned + stand.lost + stand.retired).toBe(stand.total)
  })

  it('entwertet ausgegebene Karten mit dem Abschluss der Versammlung', () => {
    /*
     * Der Punkt, an dem sich Karte und Papierpass unterscheiden: Der Pass
     * landet im Papierkorb, die Karte kommt wieder. Nimmt jemand sie mit,
     * bliebe ihr Code sonst für immer ein gültiger Ausweis.
     */
    const eigenes = events.createEvent({
      title: 'Abschlussprobe',
      organization: 'Musterverein',
      orgCode: 'AB',
      date: '2026-09-14',
      location: 'Saal',
      ruleSet: { name: 'Satzung', version: '1', snapshotDate: '2026-09-14' }
    }).id
    karten.importCards([{ serial: '900', code: code(900) }])
    const person = teilnehmer.addParticipant({ eventId: eigenes, lastName: 'Mitnehmer', firstName: 'T' })
    karten.assignCard(person.id, code(900))
    expect(karten.findCardByCode(code(900))?.heldBy).toBe(person.id)

    events.closeEvent(eigenes)
    expect(karten.findCardByCode(code(900))?.heldBy).toBeUndefined()

    /* Die Anwesenheit bleibt, wie sie war — wer am Ende im Saal war, war am
       Ende im Saal, und das gehört ins Protokoll. */
    expect(teilnehmer.getParticipant(person.id)?.present).toBe(true)
  })

  it('entwertet mit dem Abschluss auch die gedruckten Pässe', () => {
    /*
     * Dasselbe für Papier: Ein Zettel, den jemand einsteckt und mitnimmt, ist
     * kein Ausweis mehr, sobald die Versammlung vorbei ist — und das soll
     * nicht nur auf dem Zettel stehen, sondern gelten.
     */
    const eigenes = events.createEvent({
      title: 'Passverfall',
      organization: 'Musterverein',
      orgCode: 'PV',
      date: '2026-09-14',
      location: 'Saal',
      ruleSet: { name: 'Satzung', version: '1', snapshotDate: '2026-09-14' }
    }).id
    const person = teilnehmer.addParticipant({ eventId: eigenes, lastName: 'Passträger', firstName: 'T' })
    const { token } = teilnehmer.issuePass(person.id)
    expect(teilnehmer.findByPass(eigenes, token)?.id).toBe(person.id)

    events.closeEvent(eigenes)
    expect(teilnehmer.findByPass(eigenes, token)).toBeNull()
    /* Dass ein Pass ausgegeben war, bleibt im Audit — nur seine Gültigkeit
       endet. */
    expect(audit.listAudit({ eventId: eigenes }).map((e) => e.action)).toContain('participant.passes_expired')
  })
})

describe('Nur wer im Saal ist, darf abstimmen', () => {
  /*
   * Der Grund, warum am Ausgang die Karte abgenommen wird. Bei einer Karte
   * fällt beides zusammen — wer keine hat, ist gegangen. Bei einem gedruckten
   * Pass fällt es *nicht* zusammen: Der Zettel funktionierte sonst auch vom
   * Parkplatz aus.
   */
  it('lässt niemanden abstimmen, der nicht da ist', () => {
    const person = anlegen('Draussen')
    expect(teilnehmer.mayVote(person.id)).toEqual({ ok: false, reason: 'Nicht im Saal.' })
    teilnehmer.setAttendance(person.id, 'in')
    expect(teilnehmer.mayVote(person.id).ok).toBe(true)
    teilnehmer.setAttendance(person.id, 'out')
    expect(teilnehmer.mayVote(person.id).ok).toBe(false)
  })

  it('gilt auch für den gedruckten Pass', () => {
    /* Der Pass bleibt derselbe — die Berechtigung hängt an der Anwesenheit,
       nicht am Zettel. */
    const person = anlegen('Passgänger')
    const { token } = teilnehmer.issuePass(person.id)
    teilnehmer.setAttendance(person.id, 'in')
    expect(teilnehmer.mayVote(teilnehmer.findByPass(eventId, token)!.id).ok).toBe(true)

    teilnehmer.setAttendance(person.id, 'out')
    /* Der Pass wird weiterhin erkannt — aber er berechtigt nicht mehr. */
    expect(teilnehmer.findByPass(eventId, token)?.id).toBe(person.id)
    expect(teilnehmer.mayVote(person.id).ok).toBe(false)
  })

  it('nennt den Grund im Klartext', () => {
    /* Am Einlass muss jemand in zwei Sekunden sagen können, woran es liegt. */
    const gast = anlegen('Zuschauer', { eligible: false })
    teilnehmer.setAttendance(gast.id, 'in')
    expect(teilnehmer.mayVote(gast.id).reason).toMatch(/Gast/)

    const gesperrt = anlegen('Ruhend')
    teilnehmer.setAttendance(gesperrt.id, 'in')
    teilnehmer.blockParticipant(gesperrt.id, 'Beitrag offen')
    expect(teilnehmer.mayVote(gesperrt.id).reason).toMatch(/Beitrag offen/)
  })

  it('bricht ab, wo eine Stimme ausgelöst würde', () => {
    const person = anlegen('Abbruch')
    expect(() => teilnehmer.assertMayVote(person.id)).toThrow(/Nicht im Saal/)
  })
})

describe('Einlassbändchen', () => {
  /*
   * Derselbe Ablauf wie bei der Karte, ein Unterschied: Das Bändchen wird um
   * das Handgelenk geklebt und beim Gehen abgerissen. Es kommt nicht zurück in
   * den Stapel.
   */
  const bandCode = (n: number): string => `BAND-GEHEIM-${String(n).padStart(6, '0')}`

  it('wird mit der Rückgabe verbraucht, nicht frei', () => {
    karten.importCards([{ serial: 'B-001', code: bandCode(1) }], 'band')
    const person = anlegen('Bändchenträger')
    karten.assignCard(person.id, bandCode(1))
    expect(teilnehmer.getParticipant(person.id)?.present).toBe(true)

    karten.returnCard(bandCode(1))
    const danach = karten.findCardByCode(bandCode(1))
    expect(danach?.kind).toBe('band')
    /* Die Karte wäre jetzt „available" — das Bändchen ist verbraucht. */
    expect(danach?.status).toBe('retired')
    expect(danach?.heldBy).toBeUndefined()
  })

  it('lässt sich nicht erneut ausgeben', () => {
    const wiederkommer = anlegen('Wiederkommer')
    expect(() => karten.assignCard(wiederkommer.id, bandCode(1))).toThrow(/verbraucht/)
  })

  it('wer wiederkommt, bekommt ein neues', () => {
    karten.importCards([{ serial: 'B-002', code: bandCode(2) }], 'band')
    const person = anlegen('Zurück')
    karten.assignCard(person.id, bandCode(2))
    expect(teilnehmer.mayVote(person.id).ok).toBe(true)
  })

  it('zählt Bändchen und Karten im selben Bestand', () => {
    const stand = karten.cardStock()
    expect(stand.total).toBeGreaterThan(0)
    expect(stand.available + stand.assigned + stand.lost + stand.retired).toBe(stand.total)
  })
})
