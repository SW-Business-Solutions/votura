/**
 * Quotenprüfung bei Listenwahlen.
 *
 * Gerechnet wird an Zahlen und Reihenfolgen — ohne Datenbank, ohne Wahlgang.
 * Geprüft wird vor allem das, was eine Versammlung teuer zu stehen käme:
 * eine Quote, die als erfüllt gemeldet wird, obwohl sie es nicht ist.
 */
import { describe, expect, it } from 'vitest'
import {
  gefordertePlaetze,
  quoteBeschreibung,
  quotePruefen,
  type Quotenbewerber,
  type Quotenregel
} from '@shared/quote'

const HAELFTE: Quotenregel = {
  art: 'mindestanteil',
  merkmal: 'Geschlecht',
  anspruchsgruppe: 'Frauen',
  mindestanteil: 0.5
}

const REISSVERSCHLUSS: Quotenregel = {
  art: 'reissverschluss',
  merkmal: 'Geschlecht',
  anspruchsgruppe: 'Frauen'
}

const liste = (...gruppen: (string | undefined)[]): Quotenbewerber[] =>
  gruppen.map((gruppe, i) => ({ candidateId: `k${i + 1}`, name: `Platz ${i + 1}`, gruppe }))

describe('Mindestanteil', () => {
  it('rundet zugunsten der Anspruchsgruppe auf', () => {
    /*
     * „Mindestens die Hälfte von fünf" sind **drei**, nicht zweieinhalb und
     * nicht zwei. Das ist die übliche Lesart und die für die Anspruchsgruppe
     * günstigere — und der Punkt, an dem eine Wahl anfechtbar wird, wenn man
     * abrundet.
     */
    expect(gefordertePlaetze(5, 0.5)).toBe(3)
    expect(gefordertePlaetze(4, 0.5)).toBe(2)
    expect(gefordertePlaetze(7, 0.5)).toBe(4)
    expect(gefordertePlaetze(3, 1 / 3)).toBe(1)
  })

  it('erkennt eine erfüllte Quote', () => {
    const befund = quotePruefen(HAELFTE, liste('Frauen', 'Männer', 'Frauen', 'Männer'))
    expect(befund.pruefbar).toBe(true)
    expect(befund.erfuellt).toBe(true)
    expect(befund.erreicht).toBe(2)
    expect(befund.gefordert).toBe(2)
  })

  it('erkennt eine verfehlte Quote', () => {
    const befund = quotePruefen(HAELFTE, liste('Frauen', 'Männer', 'Männer', 'Männer', 'Männer'))
    expect(befund.erfuellt).toBe(false)
    expect(befund.erreicht).toBe(1)
    expect(befund.gefordert).toBe(3)
    expect(befund.text).toContain('Quote verfehlt')
  })

  it('zählt nur die Anspruchsgruppe, nicht alles Zugeordnete', () => {
    const befund = quotePruefen(HAELFTE, liste('divers', 'divers', 'Frauen', 'Männer'))
    expect(befund.erreicht).toBe(1)
    expect(befund.erfuellt).toBe(false)
  })
})

describe('Abwechselnde Besetzung', () => {
  it('bindet nur die ungeraden Plätze', () => {
    /* Die geraden stehen allen offen — auch der Anspruchsgruppe. */
    const befund = quotePruefen(REISSVERSCHLUSS, liste('Frauen', 'Frauen', 'Frauen', 'Männer'))
    expect(befund.erfuellt).toBe(true)
    expect(befund.verstoesse).toHaveLength(0)
  })

  it('nennt jeden falsch besetzten Platz einzeln', () => {
    /*
     * Eine Meldung „Quote verfehlt" hilft niemandem um kurz vor zehn. Wer
     * etwas ändern soll, muss wissen **wo** — Platz 3 und Platz 5, nicht
     * „irgendwo in der Liste".
     */
    const befund = quotePruefen(
      REISSVERSCHLUSS,
      liste('Frauen', 'Männer', 'Männer', 'Frauen', 'Männer')
    )
    expect(befund.erfuellt).toBe(false)
    expect(befund.verstoesse.map((v) => v.platz)).toEqual([3, 5])
    expect(befund.verstoesse[0].grund).toContain('Platz 3')
  })

  it('nennt auch die fehlende Zuordnung als Grund', () => {
    const befund = quotePruefen(REISSVERSCHLUSS, liste('Frauen', 'Männer', undefined))
    expect(befund.verstoesse[0].grund).toContain('fehlt die Zuordnung')
  })
})

describe('Was ohne Angaben geschieht', () => {
  it('meldet keine erfüllte Quote, wenn niemand zugeordnet ist', () => {
    /*
     * **Der gefährlichste Fall, und der Grund für dieses Feld.**
     *
     * Ohne Zuordnung zählt die Anspruchsgruppe null — und ein naives
     * „null ≥ null" bei null Plätzen oder eine übersehene Rückgabe machte
     * daraus ein grünes Häkchen. Das sähe aus wie eine Prüfung und wäre
     * keine. Eine Versammlung, die sich darauf verlässt, wählt eine
     * anfechtbare Liste im Vertrauen auf ein Programm.
     */
    const befund = quotePruefen(HAELFTE, liste(undefined, undefined, undefined))
    expect(befund.pruefbar).toBe(false)
    expect(befund.text).toContain('lässt sich nicht prüfen')
  })

  it('prüft weiter, wenn nur einzelne Zuordnungen fehlen', () => {
    /* Eine Lücke macht die Prüfung nicht wertlos — sie wird nur benannt. */
    const befund = quotePruefen(HAELFTE, liste('Frauen', undefined, 'Frauen', 'Männer'))
    expect(befund.pruefbar).toBe(true)
    expect(befund.ohneZuordnung).toEqual(['Platz 2'])
    expect(befund.erreicht).toBe(2)
    expect(befund.erfuellt).toBe(true)
  })

  it('sagt bei leerer Liste nichts Falsches', () => {
    const befund = quotePruefen(HAELFTE, [])
    expect(befund.pruefbar).toBe(false)
    expect(befund.text).toContain('Noch niemand gewählt')
  })
})

describe('Die Regel in einem Satz', () => {
  it('nennt Anteil und Gruppe', () => {
    expect(quoteBeschreibung(HAELFTE)).toBe('Mindestens 50 % Frauen (Geschlecht)')
  })

  it('nennt die abwechselnde Besetzung als solche', () => {
    expect(quoteBeschreibung(REISSVERSCHLUSS)).toContain('Abwechselnd')
  })
})

/*
 * Ab hier der Weg durch den Hauptprozess.
 *
 * Geprüft wird, dass die Regel den Neustart überlebt, dass der Befund an den
 * gewählten Plätzen hängt und nicht an allen Bewerbern — und dass er beim
 * Bestätigen im Prüfpfad landet. Das Letzte ist der eigentliche Punkt: Eine
 * Warnung, die weggeklickt wurde, ist hinterher nicht mehr auffindbar.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'wahlzettel-quote-'))

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
const rounds = await import('../src/main/services/rounds')
const candidates = await import('../src/main/services/candidates')
const results = await import('../src/main/services/results')
const audit = await import('../src/main/services/audit')
const settings = await import('../src/main/services/settings')
const { defaultTemplateFor } = await import('../src/shared/election')

let roundId = ''

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
  /* Ohne PIN und ohne Vier-Augen-Prinzip: Beides ist hier nicht der
     Gegenstand, und beides hat eigene Tests. */
  auth.setPrintPin('user-1', '135790')
  const config = settings.getConfig()
  settings.saveConfig({
    ...config,
    security: { ...config.security, requireFourEyesForResult: false }
  })

  const veranstaltung = events.createEvent({
    title: 'Testversammlung',
    organization: 'Testverband',
    orgCode: 'TV',
    date: '2026-09-15',
    location: 'Testsaal',
    eligibleVoterCount: 20,
    ruleSet: { name: 'Wahlordnung', version: 'Fassung 2024', snapshotDate: '2026-09-01' }
  })
  events.activateEvent(veranstaltung.id)

  const runde = rounds.createRound({
    eventId: veranstaltung.id,
    title: 'Wahl der Delegierten',
    purpose: 'delegate',
    procedure: 'group_preprinted',
    seats: 4,
    maxVotes: 4,
    template: defaultTemplateFor('group_preprinted', { seats: 4, maxVotes: 4, entryCount: 5 }),
    orderMode: 'manual'
  })
  roundId = runde.id

  rounds.updateRound({
    id: runde.id,
    rowVersion: rounds.getRound(runde.id).rowVersion,
    quote: { art: 'mindestanteil', merkmal: 'Geschlecht', anspruchsgruppe: 'Frauen', mindestanteil: 0.5 }
  })

  candidates.addCandidates(roundId, [
    { firstName: 'Anna', lastName: 'Alt', displayName: 'Anna Alt', quotengruppe: 'Frauen' },
    { firstName: 'Bernd', lastName: 'Berg', displayName: 'Bernd Berg', quotengruppe: 'Männer' },
    { firstName: 'Carl', lastName: 'Cord', displayName: 'Carl Cord', quotengruppe: 'Männer' },
    { firstName: 'Dora', lastName: 'Dey', displayName: 'Dora Dey', quotengruppe: 'Frauen' },
    { firstName: 'Emil', lastName: 'Erb', displayName: 'Emil Erb', quotengruppe: 'Männer' }
  ])
})

describe('Die Quotenregel am Wahlgang', () => {
  it('überlebt das Speichern', () => {
    const runde = rounds.getRound(roundId)
    expect(runde.quote?.anspruchsgruppe).toBe('Frauen')
    expect(runde.quote?.mindestanteil).toBe(0.5)
  })

  it('lässt sich wieder aufheben', () => {
    /*
     * `null` hebt auf, `undefined` lässt stehen. Ohne diesen Unterschied
     * ließe sich eine Quote anlegen, aber nie wieder loswerden — und das
     * fiele erst auf, wenn jemand sie loswerden will.
     */
    rounds.updateRound({ id: roundId, rowVersion: rounds.getRound(roundId).rowVersion, quote: null })
    expect(rounds.getRound(roundId).quote).toBeUndefined()

    rounds.updateRound({
      id: roundId,
      rowVersion: rounds.getRound(roundId).rowVersion,
      quote: { art: 'mindestanteil', merkmal: 'Geschlecht', anspruchsgruppe: 'Frauen', mindestanteil: 0.5 }
    })
    expect(rounds.getRound(roundId).quote?.anspruchsgruppe).toBe('Frauen')
  })
})

describe('Der Befund am Ergebnis', () => {
  it('zählt nur die gewählten Plätze, nicht alle Bewerber', () => {
    /*
     * Fünf Bewerber, vier Plätze, zwei Frauen — aber die zweite Frau landet
     * auf Platz fünf. Wer alle Bewerber zählte, käme auf „erfüllt"; wer die
     * gewählten zählt, auf „verfehlt". Das ist der ganze Unterschied.
     */
    const liste = candidates.listCandidates(roundId)
    const stimmen = new Map([
      ['Anna Alt', 18],
      ['Bernd Berg', 17],
      ['Carl Cord', 16],
      ['Emil Erb', 15],
      ['Dora Dey', 3]
    ])
    results.saveResult({
      electionRoundId: roundId,
      ballotsCast: 20,
      validBallots: 20,
      invalidBallots: 0,
      countingMode: 'counted',
      resultData: {
        candidates: liste.map((kandidat) => ({
          candidateId: kandidat.id,
          name: kandidat.displayName,
          votes: stimmen.get(kandidat.displayName) ?? 0
        }))
      }
    })

    const befund = results.quotenbefund(roundId)
    expect(befund?.pruefbar).toBe(true)
    expect(befund?.erfuellt).toBe(false)
    expect(befund?.erreicht).toBe(1)
    expect(befund?.gefordert).toBe(2)
  })

  it('gibt nichts zurück, wenn der Wahlgang keine Quote hat', () => {
    rounds.updateRound({ id: roundId, rowVersion: rounds.getRound(roundId).rowVersion, quote: null })
    expect(results.quotenbefund(roundId)).toBeNull()

    rounds.updateRound({
      id: roundId,
      rowVersion: rounds.getRound(roundId).rowVersion,
      quote: { art: 'mindestanteil', merkmal: 'Geschlecht', anspruchsgruppe: 'Frauen', mindestanteil: 0.5 }
    })
  })
})

describe('Was beim Bestätigen festgehalten wird', () => {
  it('schreibt den Befund in den Prüfpfad — auch den verfehlten', () => {
    /*
     * **Der eigentliche Zweck der ganzen Prüfung.**
     *
     * Votura hält die Feststellung nicht auf: Was eine verfehlte Quote
     * bedeutet, steht in der Satzung. Aber dass gewarnt wurde und dass
     * trotzdem bestätigt wurde, muss hinterher belegbar sein — hinterher ist
     * genau der Zeitpunkt, an dem jemand fragt.
     */
    results.confirmResult(roundId, '135790')

    const eintrag = audit
      .listAudit({ roundId })
      .find((e) => e.action === 'result.confirmed')
    expect(eintrag).toBeDefined()
    const quote = (eintrag!.newValue as { quote?: { erfuellt: boolean; befund: string } }).quote
    expect(quote).toBeDefined()
    expect(quote!.erfuellt).toBe(false)
    expect(quote!.befund).toContain('Quote verfehlt')
  })
})
