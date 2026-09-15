/**
 * Das Antragsbuch — Reihenfolge, Übernahme, Beschlusstext.
 *
 * Gerechnet wird an Anträgen, nicht an einer Datenbank. Geprüft wird das, was
 * eine Versammlung teuer zu stehen käme: eine falsche Abstimmungsreihenfolge
 * und ein Beschlusstext, der nicht das enthält, was beschlossen wurde.
 */
import { describe, expect, it } from 'vitest'
import {
  abstimmungsreihenfolge,
  antragSeiten,
  beschlusstext,
  darfUebernehmen,
  nachNummer,
  type Antrag,
  type Antragsstatus
} from '@shared/antrag'

let laufend = 0
const antrag = (teil: Partial<Antrag> & { nummer: string }): Antrag => ({
  id: teil.id ?? `a${++laufend}`,
  eventId: 'v1',
  art: teil.art ?? 'haupt',
  titel: teil.titel ?? `Antrag ${teil.nummer}`,
  text: teil.text ?? `Text von ${teil.nummer}`,
  antragsteller: teil.antragsteller ?? 'Kreisverband Nord',
  status: teil.status ?? 'zugelassen',
  bezugId: teil.bezugId,
  reihenfolge: teil.reihenfolge ?? 0,
  createdAt: '2026-09-15T10:00:00.000Z',
  ...teil
})

describe('Die Abstimmungsreihenfolge', () => {
  const haupt = antrag({ id: 'h', nummer: 'A 14' })

  it('stimmt Änderungsanträge vor dem Hauptantrag ab', () => {
    /*
     * Keine Geschmacksfrage: Über den Hauptantrag wird in der Fassung
     * abgestimmt, die er nach den Änderungen hat — also müssen die
     * Änderungen vorher entschieden sein.
     */
    const schritte = abstimmungsreihenfolge(haupt, [
      antrag({ nummer: 'Ä 2', art: 'aenderung', bezugId: 'h', reihenfolge: 2 }),
      antrag({ nummer: 'Ä 1', art: 'aenderung', bezugId: 'h', reihenfolge: 1 })
    ])
    expect(schritte.map((s) => s.antrag.nummer)).toEqual(['Ä 1', 'Ä 2', 'A 14'])
    expect(schritte[0].schritt).toBe(1)
  })

  it('folgt der gesetzten Reihenfolge, nicht dem Eingang', () => {
    /*
     * Welcher Änderungsantrag „weitergehend" ist, ist eine Wertung und keine
     * Rechnung. Die Versammlungsleitung setzt sie; Votura hält sich daran.
     */
    const schritte = abstimmungsreihenfolge(haupt, [
      antrag({ nummer: 'Ä 1', art: 'aenderung', bezugId: 'h', reihenfolge: 9 }),
      antrag({ nummer: 'Ä 2', art: 'aenderung', bezugId: 'h', reihenfolge: 1 })
    ])
    expect(schritte.map((s) => s.antrag.nummer)).toEqual(['Ä 2', 'Ä 1', 'A 14'])
  })

  it('lässt aus, worüber nicht mehr abgestimmt wird', () => {
    const erledigt: Antragsstatus[] = ['uebernommen', 'zurueckgezogen', 'erledigt', 'beschlossen', 'abgelehnt']
    const schritte = abstimmungsreihenfolge(haupt, [
      ...erledigt.map((status, i) =>
        antrag({ nummer: `Ä ${i + 1}`, art: 'aenderung', bezugId: 'h', status, reihenfolge: i })
      ),
      antrag({ nummer: 'Ä 9', art: 'aenderung', bezugId: 'h', reihenfolge: 9 })
    ])
    expect(schritte.map((s) => s.antrag.nummer)).toEqual(['Ä 9', 'A 14'])
  })

  it('nimmt keine Änderungsanträge zu anderen Anträgen', () => {
    const schritte = abstimmungsreihenfolge(haupt, [
      antrag({ nummer: 'Ä 1', art: 'aenderung', bezugId: 'ein-anderer', reihenfolge: 1 })
    ])
    expect(schritte.map((s) => s.antrag.nummer)).toEqual(['A 14'])
  })

  it('lässt den Hauptantrag weg, wenn er selbst erledigt ist', () => {
    const zurueck = antrag({ id: 'h2', nummer: 'A 15', status: 'zurueckgezogen' })
    expect(abstimmungsreihenfolge(zurueck, [])).toEqual([])
  })

  it('sagt zu jedem Schritt, warum er dort steht', () => {
    const schritte = abstimmungsreihenfolge(haupt, [
      antrag({ nummer: 'Ä 1', art: 'aenderung', bezugId: 'h', reihenfolge: 1 })
    ])
    expect(schritte[0].grund).toContain('vor dem Hauptantrag')
    expect(schritte[1].grund).toContain('zuletzt')
  })
})

describe('Der Beschlusstext', () => {
  const haupt = antrag({ id: 'h', nummer: 'A 14', text: 'Der Verband möge beschließen: …' })

  it('ist ohne Änderungen der Antragstext', () => {
    expect(beschlusstext(haupt, [])).toBe('Der Verband möge beschließen: …')
  })

  it('nennt übernommene und beschlossene Änderungen einzeln', () => {
    /*
     * **Votura verschmilzt die Texte nicht.** Das ginge nur mit einer
     * Vermutung darüber, welche Stelle gemeint ist — und eine falsch
     * geratene Stelle wäre ein verfälschter Beschluss. Sie stehen deshalb
     * untereinander, benannt und zurückverfolgbar.
     */
    const text = beschlusstext(haupt, [
      antrag({
        nummer: 'Ä 1',
        art: 'aenderung',
        bezugId: 'h',
        status: 'uebernommen',
        antragsteller: 'Ortsverein Süd',
        text: 'In Zeile 4 wird „drei" durch „fünf" ersetzt.',
        reihenfolge: 1
      }),
      antrag({
        nummer: 'Ä 2',
        art: 'aenderung',
        bezugId: 'h',
        status: 'beschlossen',
        text: 'Satz 2 entfällt.',
        reihenfolge: 2
      })
    ])
    expect(text).toContain('Mit folgenden Änderungen:')
    expect(text).toContain('Ä 1 (Ortsverein Süd, übernommen):')
    expect(text).toContain('Ä 2 (Kreisverband Nord, beschlossen):')
    expect(text).toContain('Satz 2 entfällt.')
  })

  it('lässt abgelehnte und zurückgezogene Änderungen weg', () => {
    const text = beschlusstext(haupt, [
      antrag({ nummer: 'Ä 1', art: 'aenderung', bezugId: 'h', status: 'abgelehnt', text: 'Nicht drin.' }),
      antrag({ nummer: 'Ä 2', art: 'aenderung', bezugId: 'h', status: 'zurueckgezogen', text: 'Auch nicht.' })
    ])
    expect(text).toBe('Der Verband möge beschließen: …')
  })

  it('schreibt die Einzahl, wenn es eine Änderung ist', () => {
    const text = beschlusstext(haupt, [
      antrag({ nummer: 'Ä 1', art: 'aenderung', bezugId: 'h', status: 'uebernommen', text: 'Eine.' })
    ])
    expect(text).toContain('Mit folgender Änderung:')
  })
})

describe('Die Übernahme', () => {
  const haupt = antrag({ id: 'h', nummer: 'A 14', antragsteller: 'Kreisverband Nord' })

  it('ist erlaubt, solange über beide noch nicht entschieden ist', () => {
    const ae = antrag({ nummer: 'Ä 1', art: 'aenderung', bezugId: 'h' })
    const befund = darfUebernehmen(ae, haupt)
    expect(befund.erlaubt).toBe(true)
    expect(befund.grund).toContain('Kreisverband Nord')
  })

  it('ist nach der Abstimmung keine Übernahme mehr', () => {
    /* Danach wäre es eine Änderung des Ergebnisses. */
    const ae = antrag({ nummer: 'Ä 1', art: 'aenderung', bezugId: 'h', status: 'abgelehnt' })
    expect(darfUebernehmen(ae, haupt).erlaubt).toBe(false)
  })

  it('geht nicht über Antragsgrenzen hinweg', () => {
    const ae = antrag({ nummer: 'Ä 1', art: 'aenderung', bezugId: 'fremd' })
    expect(darfUebernehmen(ae, haupt).grund).toContain('anderen Antrag')
  })

  it('gilt nicht für Hauptanträge', () => {
    const zweiter = antrag({ nummer: 'A 15' })
    expect(darfUebernehmen(zweiter, haupt).erlaubt).toBe(false)
  })
})

describe('Der Antrag auf dem Beamer', () => {
  it('bündelt Absätze auf einer Seite, solange sie passen — und zerreißt keinen', () => {
    /*
     * Ein Antragstext ist gegliedert: Absätze, Aufzählungen, Spiegelstriche.
     * Ein Umbruch mitten in einer Aufzählung liest sich wie ein anderer
     * Antrag. Solange ein Absatz ganz auf die laufende Seite passt, kommt er
     * dorthin; sonst beginnt eine neue.
     *
     * Bei drei Zeilen je Seite heißt das: zwei einzeilige Absätze mit der
     * Leerzeile dazwischen füllen die Seite, der dritte beginnt die nächste.
     */
    const text = ['Erster Absatz.', 'Zweiter Absatz.', 'Dritter Absatz.'].join('\n\n')
    expect(antragSeiten(text, 3, 64)).toEqual([
      'Erster Absatz.\n\nZweiter Absatz.',
      'Dritter Absatz.'
    ])
  })

  it('teilt einen Absatz, der für sich zu groß ist', () => {
    /* Daran führt kein Weg vorbei — aber es bleibt die Ausnahme. */
    const lang = Array.from({ length: 8 }, (_, i) => `Zeile ${i + 1}`).join('\n')
    const seiten = antragSeiten(lang, 3, 64)
    expect(seiten).toHaveLength(3)
    expect(seiten[0].split('\n')).toHaveLength(3)
  })

  it('bricht lange Zeilen an Wortgrenzen', () => {
    const seiten = antragSeiten('ein ziemlich langer satz der umbrechen muss', 5, 12)
    expect(seiten[0].split('\n').every((zeile) => zeile.length <= 12)).toBe(true)
  })

  it('gibt bei leerem Text eine leere Seite zurück, nicht null Seiten', () => {
    /* Sonst stünde „Seite 1 von 0" an der Wand. */
    expect(antragSeiten('')).toEqual([''])
  })

  it('verliert kein Wort', () => {
    const text =
      'Der Verband möge beschließen:\n\nDer Beitrag beträgt fünf Euro.\n\nDie Änderung gilt ab 2027.'
    const zurueck = antragSeiten(text, 2, 30).join(' ').replace(/\s+/g, ' ')
    for (const wort of ['Verband', 'beschließen:', 'Beitrag', 'fünf', 'Euro.', '2027.']) {
      expect(zurueck).toContain(wort)
    }
  })
})

describe('Die Sortierung der Nummern', () => {
  it('stellt A 10 hinter A 9', () => {
    /* Die gewöhnliche Zeichenkettensortierung stellt es davor — auf einem
       Antragsbuch mit dreißig Nummern fällt das sofort auf. */
    const nummern = ['A 10', 'A 2', 'A 1', 'A 9']
      .map((nummer) => antrag({ nummer }))
      .sort(nachNummer)
      .map((a) => a.nummer)
    expect(nummern).toEqual(['A 1', 'A 2', 'A 9', 'A 10'])
  })
})

/*
 * Ab hier der Weg durch den Hauptprozess.
 *
 * Geprüft wird, was eine Versammlung merkt: dass ein übernommener
 * Änderungsantrag aus der Abstimmungsreihenfolge verschwindet und trotzdem im
 * Beschlusstext steht, dass ein Vermerk erzwungen wird, wo später niemand
 * mehr raten soll — und dass jeder Schritt im Prüfpfad landet.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'wahlzettel-antrag-'))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => join(root, name), getVersion: () => '0.1.0-test' },
  dialog: { showErrorBox: () => undefined },
  ipcMain: { handle: () => undefined },
  BrowserWindow: class {},
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ id: 0 }) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined },
  shell: { openExternal: () => undefined },
  session: { defaultSession: {} },
  Menu: { setApplicationMenu: () => undefined }
}))

const { initDatabase, db } = await import('../src/main/db')
const { initLogger } = await import('../src/main/logger')
const auth = await import('../src/main/services/auth')
const events = await import('../src/main/services/events')
const dienst = await import('../src/main/services/antraege')
const audit = await import('../src/main/services/audit')
const rounds = await import('../src/main/services/rounds')

let eventId = ''
let hauptId = ''

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

  const veranstaltung = events.createEvent({
    title: 'Testversammlung',
    organization: 'Testverband',
    orgCode: 'TV',
    date: '2026-09-15',
    location: 'Testsaal',
    eligibleVoterCount: 20,
    ruleSet: { name: 'Satzung', version: 'Fassung 2024', snapshotDate: '2026-09-01' }
  })
  events.activateEvent(veranstaltung.id)
  eventId = veranstaltung.id
})

describe('Das Antragsbuch im Betrieb', () => {
  it('nimmt einen Hauptantrag auf', () => {
    const angelegt = dienst.antragAnlegen({
      eventId,
      art: 'haupt',
      nummer: 'A 14',
      titel: 'Beitragsordnung',
      text: 'Der Verband möge beschließen: Der Beitrag beträgt drei Euro.',
      antragsteller: 'Kreisverband Nord'
    })
    hauptId = angelegt.id
    expect(angelegt.status).toBe('eingereicht')
  })

  it('verlangt Nummer und Antragsteller', () => {
    expect(() =>
      dienst.antragAnlegen({ eventId, art: 'haupt', nummer: '  ', titel: 'X', text: 'Y', antragsteller: 'Z' })
    ).toThrow(/Nummer/)
    expect(() =>
      dienst.antragAnlegen({ eventId, art: 'haupt', nummer: 'A 99', titel: 'X', text: 'Y', antragsteller: ' ' })
    ).toThrow(/Antragsteller/)
  })

  it('lässt keinen Änderungsantrag zum Änderungsantrag zu', () => {
    /*
     * Rechtlich gibt es das; praktisch wäre die Abstimmungsreihenfolge dann
     * ein Baum, und ein Baum lässt sich um zweiundzwanzig Uhr nicht mehr
     * erklären.
     */
    const ae = dienst.antragAnlegen({
      eventId,
      art: 'aenderung',
      nummer: 'Ä 1',
      titel: 'Fünf statt drei',
      text: 'In Satz 1 wird die Zahl geändert.',
      antragsteller: 'Ortsverein Süd',
      bezugId: hauptId
    })
    expect(() =>
      dienst.antragAnlegen({
        eventId,
        art: 'aenderung',
        nummer: 'Ä 1a',
        titel: 'Zu Ä 1',
        text: '…',
        antragsteller: 'X',
        bezugId: ae.id
      })
    ).toThrow(/Hauptantrag/)
  })
})

describe('Übernahme und Reihenfolge', () => {
  it('nimmt den übernommenen Antrag aus der Reihenfolge — und in den Beschluss', () => {
    /*
     * **Der Kern der ganzen Verwaltung.**
     *
     * Ein übernommener Änderungsantrag wird nicht abgestimmt — er ist Teil
     * des Hauptantrags geworden. Stünde er weiter in der Reihenfolge, würde
     * über etwas abgestimmt, das niemand mehr zur Abstimmung gestellt hat;
     * fehlte er im Beschlusstext, beschlösse die Versammlung etwas anderes,
     * als sie wollte.
     */
    const zweiter = dienst.antragAnlegen({
      eventId,
      art: 'aenderung',
      nummer: 'Ä 2',
      titel: 'Satz 2 streichen',
      text: 'Satz 2 entfällt.',
      antragsteller: 'Ortsverein West',
      bezugId: hauptId
    })

    const vorher = dienst.antragReihenfolge(hauptId)
    expect(vorher.map((s) => s.antrag.nummer)).toEqual(['Ä 1', 'Ä 2', 'A 14'])

    dienst.antragUebernehmen(zweiter.id)

    const nachher = dienst.antragReihenfolge(hauptId)
    expect(nachher.map((s) => s.antrag.nummer)).toEqual(['Ä 1', 'A 14'])
    expect(dienst.antragBeschlusstext(hauptId)).toContain('Satz 2 entfällt.')
    expect(dienst.antragBeschlusstext(hauptId)).toContain('Ortsverein West, übernommen')
  })

  it('lässt sich nicht zweimal übernehmen', () => {
    const uebernommen = dienst.listAntraege(eventId).find((antrag) => antrag.status === 'uebernommen')
    expect(uebernommen).toBeDefined()
    expect(() => dienst.antragUebernehmen(uebernommen!.id)).toThrow(/bereits entschieden/)
  })

  it('folgt der gesetzten Reihenfolge', () => {
    const dritter = dienst.antragAnlegen({
      eventId,
      art: 'aenderung',
      nummer: 'Ä 3',
      titel: 'Weitergehend',
      text: 'Der Beitrag entfällt ganz.',
      antragsteller: 'Ortsverein Ost',
      bezugId: hauptId
    })
    const erster = dienst.listAntraege(eventId).find((a) => a.nummer === 'Ä 1')!
    dienst.antraegeSortieren({ bezugId: hauptId, reihenfolge: [dritter.id, erster.id] })
    expect(dienst.antragReihenfolge(hauptId).map((s) => s.antrag.nummer)).toEqual(['Ä 3', 'Ä 1', 'A 14'])
  })
})

describe('Was festgehalten wird', () => {
  it('verlangt einen Vermerk beim Erledigen', () => {
    /*
     * „Erledigt" heißt fast immer: Ein weitergehender Änderungsantrag wurde
     * angenommen. Ohne diesen Satz steht im Protokoll ein Antrag, über den
     * nie abgestimmt wurde, und niemand weiß mehr, warum.
     */
    const erster = dienst.listAntraege(eventId).find((a) => a.nummer === 'Ä 1')!
    expect(() => dienst.antragStand({ id: erster.id, status: 'erledigt' })).toThrow(/Vermerk/)
    const mitVermerk = dienst.antragStand({
      id: erster.id,
      status: 'erledigt',
      vermerk: 'Durch Annahme von Ä 3 gegenstandslos.'
    })
    expect(mitVermerk.vermerk).toContain('Ä 3')
  })

  it('schreibt jeden Schritt in den Prüfpfad', () => {
    const eintraege = audit.listAudit({ eventId, limit: 200 }).map((e) => e.action)
    expect(eintraege).toContain('motion.created')
    expect(eintraege).toContain('motion.adopted')
    expect(eintraege).toContain('motion.reordered')
    expect(eintraege).toContain('motion.status')
  })
})

describe('Aus dem Antrag eine Abstimmung machen', () => {
  /*
   * Der Fall, für den es gebaut ist: Das Handzeichen im Saal ist nicht
   * eindeutig auszuzählen. Dann muss es schnell gehen — und der Wahlgang
   * muss ohne Abtippen dastehen.
   */
  it('legt einen Wahlgang als Sachabstimmung an', () => {
    const haupt = dienst.listAntraege(eventId).find((a) => a.nummer === 'A 14')!
    const runde = dienst.antragZurAbstimmung({ id: haupt.id })

    expect(runde.purpose).toBe('motion')
    expect(runde.procedure).toBe('yes_no_abstain')
    expect(runde.title).toBe('A 14 — Beitragsordnung')
    /* Der Wortlaut ist da — niemand muss ihn abtippen. */
    expect(runde.template.motionText).toContain('Der Beitrag beträgt drei Euro.')
  })

  it('nimmt beim Hauptantrag den Beschlusstext, nicht die eingereichte Fassung', () => {
    /*
     * **Der Unterschied, auf den es ankommt.** Über den Hauptantrag wird in
     * der Fassung abgestimmt, die er nach den übernommenen Änderungen hat.
     * Stünde die eingereichte Fassung auf dem Stimmzettel, beschlösse die
     * Versammlung etwas anderes, als sie gerade beraten hat.
     */
    const haupt = dienst.listAntraege(eventId).find((a) => a.nummer === 'A 14')!
    const runde = rounds.getRound(haupt.roundId!)
    expect(runde.template.motionText).toContain('Satz 2 entfällt.')
    expect(runde.template.motionText).toContain('übernommen')
  })

  it('verknüpft Antrag und Wahlgang in beide Richtungen', () => {
    const haupt = dienst.listAntraege(eventId).find((a) => a.nummer === 'A 14')!
    expect(haupt.roundId).toBeTruthy()
    expect(rounds.getRound(haupt.roundId!).title).toContain('A 14')
  })

  it('legt keinen zweiten Wahlgang zum selben Antrag an', () => {
    /*
     * Zwei Abstimmungen über denselben Antrag sind fast immer ein Versehen —
     * und wenn nicht, ist es eine Wiederholung, die ausdrücklich als solche
     * angelegt gehört.
     */
    const haupt = dienst.listAntraege(eventId).find((a) => a.nummer === 'A 14')!
    expect(() => dienst.antragZurAbstimmung({ id: haupt.id })).toThrow(/bereits einen Wahlgang/)
  })

  it('stimmt nicht über einen übernommenen Änderungsantrag ab', () => {
    /* Er ist Teil des Hauptantrags geworden; eine eigene Abstimmung wäre
       dieselbe Frage zweimal. */
    const uebernommen = dienst.listAntraege(eventId).find((a) => a.status === 'uebernommen')!
    expect(() => dienst.antragZurAbstimmung({ id: uebernommen.id })).toThrow(/übernommen/)
  })

  it('stimmt nicht über einen erledigten Antrag ab', () => {
    const erledigt = dienst.listAntraege(eventId).find((a) => a.status === 'erledigt')!
    expect(() => dienst.antragZurAbstimmung({ id: erledigt.id })).toThrow(/erledigt/)
  })

  it('hält im Prüfpfad fest, über welchen Wortlaut abgestimmt wird', () => {
    /*
     * Der Antragstext lässt sich danach noch ändern, der Beschluss nicht
     * mehr. Wer später fragt, worüber abgestimmt wurde, findet es hier — und
     * nicht im vielleicht inzwischen geänderten Antrag.
     */
    const eintrag = audit
      .listAudit({ eventId, limit: 200 })
      .find((e) => e.action === 'motion.round_created')
    expect(eintrag).toBeDefined()
    const wert = eintrag!.newValue as { nummer: string; wortlaut: string; verfahren: string }
    expect(wert.nummer).toBe('A 14')
    expect(wert.verfahren).toBe('yes_no_abstain')
    expect(wert.wortlaut).toContain('Satz 2 entfällt.')
  })
})
