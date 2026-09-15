/**
 * Die Rede folgt dem Aufruf.
 *
 * Eine Zuordnung „diese Rede gehört zu diesem Bewerber" ist nur so viel wert
 * wie das, was daraus folgt: Wird der Bewerber auf dem Beamer vorgestellt,
 * liegt sein Text am Pult. Geprüft wird deshalb nicht die Zuordnung allein,
 * sondern der Weg von der Bühne zum Prompter — und vor allem, wann er
 * **nicht** gegangen werden darf:
 *
 * - nicht, wenn jemand von Hand etwas anderes aufgelegt hat,
 * - nicht bei einem Gast, der in keiner Bewerberliste steht,
 * - nicht bei jedem Herzschlag derselben laufenden Vorstellung,
 * - nicht, wenn der Schalter aus ist.
 *
 * Gegen die echten Dienste, nicht gegen Textstellen.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'votura-redezuordnung-'))

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
const rundenDienst = await import('../src/main/services/rounds')
const bewerberDienst = await import('../src/main/services/candidates')
const reden = await import('../src/main/services/speeches')
const prompter = await import('../src/main/services/prompter')
import { defaultTemplateFor } from '../src/shared/election'

let roundId = ''
let ersterBewerber = ''
let zweiterBewerber = ''
let redeEins = ''
let redeZwei = ''
let zweiterWahlgang = ''
let annaZweiteBewerbung = ''
let redeDrei = ''

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

  const eventId = events.createEvent({
    title: 'Mitgliederversammlung',
    organization: 'Musterverein',
    orgCode: 'MV26',
    date: '2026-09-14',
    location: 'Vereinsheim',
    ruleSet: { name: 'Satzung', version: '1', snapshotDate: '2026-09-14' }
  }).id

  roundId = rundenDienst.createRound({
    eventId,
    title: 'Vorsitz',
    purpose: 'chairperson',
    procedure: 'single_candidate',
    seats: 1,
    maxVotes: 1,
    template: defaultTemplateFor('single_candidate', { seats: 1, maxVotes: 1, entryCount: 2 }),
    orderMode: 'manual'
  }).id

  const angelegt = bewerberDienst.addCandidates(roundId, [
    { firstName: 'Anna', lastName: 'Berg', displayName: 'Anna Berg' },
    { firstName: 'Bernd', lastName: 'Clus', displayName: 'Bernd Clus' }
  ])
  ersterBewerber = angelegt[0].id
  zweiterBewerber = angelegt[1].id

  /*
   * Derselbe Mensch, zwei Bewerbungen: Ein Vorsitzender gibt den
   * Vorstandsbericht und bewirbt sich später um die Wiederwahl.
   */
  zweiterWahlgang = rundenDienst.createRound({
    eventId,
    title: 'Beisitzer',
    purpose: 'board_member',
    procedure: 'single_candidate',
    seats: 1,
    maxVotes: 1,
    template: defaultTemplateFor('single_candidate', { seats: 1, maxVotes: 1, entryCount: 1 }),
    orderMode: 'manual'
  }).id
  annaZweiteBewerbung = bewerberDienst.addCandidates(zweiterWahlgang, [
    { firstName: 'Anna', lastName: 'Berg', displayName: 'Anna Berg' }
  ])[0].id

  redeEins = reden.createSpeech('Bewerbung Anna').id
  reden.saveSpeech(redeEins, '# Bewerbung\n\nGuten Abend.')
  redeDrei = reden.createSpeech('Anna als Beisitzerin').id
  reden.saveSpeech(redeDrei, '# Beisitz')
  redeZwei = reden.createSpeech('Notizen der Leitung').id
  reden.saveSpeech(redeZwei, '# Notizen\n\nTagesordnungspunkt 4.')
})

afterAll(() => {
  closeDatabase()
})

beforeEach(() => {
  prompter.resetPrompter()
})

describe('Welche Rede zu einem Namen gehört', () => {
  it('findet die zugeordnete Rede', () => {
    reden.assignSpeech(redeEins, ersterBewerber, 'Anna Berg')
    expect(reden.redeFuerBewerber('Anna Berg')?.id).toBe(redeEins)
  })

  it('übersieht Groß- und Kleinschreibung und Leerzeichen am Rand', () => {
    expect(reden.redeFuerBewerber('  anna berg ')?.id).toBe(redeEins)
  })

  it('folgt einer Umbenennung des Bewerbers', () => {
    /*
     * Die Zuordnung hängt an der Kennung, verglichen wird mit dem heutigen
     * Namen. Sonst verlöre eine korrigierte Schreibweise still die Rede.
     */
    bewerberDienst.updateCandidate({ id: ersterBewerber, displayName: 'Anna Berg-Hoff' })
    expect(reden.redeFuerBewerber('Anna Berg-Hoff')?.id).toBe(redeEins)
    expect(reden.redeFuerBewerber('Anna Berg')).toBeUndefined()
    bewerberDienst.updateCandidate({ id: ersterBewerber, displayName: 'Anna Berg' })
  })

  it('kennt keinen Gast', () => {
    expect(reden.redeFuerBewerber('Grußwort des Bürgermeisters')).toBeUndefined()
    expect(reden.redeFuerBewerber('   ')).toBeUndefined()
  })

  it('vergisst eine gelöste Zuordnung', () => {
    reden.assignSpeech(redeEins, undefined)
    expect(reden.redeFuerBewerber('Anna Berg')).toBeUndefined()
    reden.assignSpeech(redeEins, ersterBewerber, 'Anna Berg')
  })
})

describe('Dieselbe Person, mehrere Reden', () => {
  /*
   * Der Fall aus dem Saal: Ein Vorsitzender hält den Vorstandsbericht und
   * bewirbt sich danach um die Wiederwahl. Die Zuordnung hängt deshalb nicht
   * an der Person, sondern an der Bewerbung — und die gehört zu genau einem
   * Wahlgang.
   */
  beforeAll(() => {
    reden.assignSpeech(redeEins, ersterBewerber, 'Anna Berg')
    reden.assignSpeech(redeDrei, annaZweiteBewerbung, 'Anna Berg')
  })

  afterAll(() => {
    reden.assignSpeech(redeDrei, undefined)
  })

  it('wählt die Rede des aufgerufenen Wahlgangs', () => {
    expect(reden.redeFuerBewerber('Anna Berg', roundId)?.id).toBe(redeEins)
    expect(reden.redeFuerBewerber('Anna Berg', zweiterWahlgang)?.id).toBe(redeDrei)
  })

  it('rät nicht, wenn der Aufruf keinen Wahlgang nennt', () => {
    /* Eine geratene Rede am Pult ist schlimmer als gar keine: Wer vorn steht,
       liest den falschen Text vor. */
    expect(reden.redeFuerBewerber('Anna Berg')).toBeUndefined()
  })

  it('rät auch dann nicht, wenn der Wahlgang keine Rede hat', () => {
    expect(reden.redeFuerBewerber('Anna Berg', 'ein-fremder-wahlgang')).toBeUndefined()
  })

  it('legt am Pult nichts auf, solange es mehrdeutig ist', () => {
    prompter.loadSpeech(redeZwei)
    prompter.sprecherAufgerufen({ name: 'Anna Berg' })
    expect(prompter.getPrompterView().speech?.id).toBe(redeZwei)
  })

  it('legt die richtige auf, sobald der Wahlgang mitkommt', () => {
    prompter.sprecherAufgerufen({ name: 'Anna Berg', roundId: zweiterWahlgang })
    expect(prompter.getPrompterView().speech?.id).toBe(redeDrei)
  })
})

describe('Der Prompter folgt dem Aufruf', () => {
  it('legt die Rede des Aufgerufenen mitsamt seiner Uhr auf', () => {
    const bis = new Date(Date.now() + 300_000).toISOString()
    prompter.sprecherAufgerufen({ name: 'Anna Berg', until: bis })
    const stand = prompter.getPrompterView()
    expect(stand.speech?.id).toBe(redeEins)
    expect(stand.until).toBe(bis)
    /* Von vorn und angehalten — niemand soll in einen laufenden Text fallen. */
    expect(stand.position).toBe(0)
    expect(stand.running).toBe(false)
  })

  it('räumt den Prompter nicht leer, wenn ein Gast spricht', () => {
    prompter.loadSpeech(redeZwei)
    prompter.sprecherAufgerufen({ name: 'Grußwort des Bürgermeisters' })
    expect(prompter.getPrompterView().speech?.id).toBe(redeZwei)
  })

  it('nimmt eine von Hand aufgelegte Rede nicht wieder weg', () => {
    /*
     * Derselbe Sprecher steht oft minutenlang vorn, und jede angehaltene Uhr
     * meldet den Zustand erneut. Ohne Gedächtnis läge nach dem ersten
     * Handgriff sofort wieder der alte Text da.
     */
    prompter.sprecherAufgerufen({ name: 'Anna Berg' })
    prompter.loadSpeech(redeZwei)
    prompter.sprecherAufgerufen({ name: 'Anna Berg' })
    expect(prompter.getPrompterView().speech?.id).toBe(redeZwei)
  })

  it('greift wieder, sobald ein anderer aufgerufen wird', () => {
    reden.assignSpeech(redeZwei, zweiterBewerber, 'Bernd Clus')
    prompter.sprecherAufgerufen({ name: 'Anna Berg' })
    prompter.sprecherAufgerufen({ name: 'Bernd Clus' })
    expect(prompter.getPrompterView().speech?.id).toBe(redeZwei)
    reden.assignSpeech(redeZwei, undefined)
  })

  it('bleibt aus, solange der Schalter aus ist', () => {
    prompter.setPrompterFolgtDemAufruf(false)
    prompter.sprecherAufgerufen({ name: 'Anna Berg' })
    expect(prompter.getPrompterView().speech).toBeUndefined()
    prompter.setPrompterFolgtDemAufruf(true)
  })

  it('rührt sich nicht ohne Namen', () => {
    prompter.loadSpeech(redeZwei)
    prompter.sprecherAufgerufen(undefined)
    prompter.sprecherAufgerufen({ name: '   ' })
    expect(prompter.getPrompterView().speech?.id).toBe(redeZwei)
  })
})
