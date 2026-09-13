/**
 * Mehrere Bühnen (Beamer §23, §33).
 *
 * Eine Versammlung hat selten nur eine Wand. Auf der einen steht die
 * Rednerliste, auf der anderen läuft ein Film — beides zugleich, beides aus
 * derselben Bedienung. Geprüft wird deshalb vor allem das, was schiefgehen
 * würde, wenn die Bühnen sich doch etwas teilten: gemeinsame Zustände,
 * automatische Wechsel auf der falschen Wand, Reste abgebauter Bühnen.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'wahlzettel-buehnen-'))

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

const { initDatabase } = await import('../src/main/db')
const { initLogger } = await import('../src/main/logger')
const projection = await import('../src/main/services/projection')
const { BUEHNEN_MAX, HAUPTBUEHNE } = await import('../src/shared/projection')

const lies = (pfad: string): string => readFileSync(join(__dirname, '..', pfad), 'utf8')

beforeAll(() => {
  initLogger(join(root, 'logs'))
  initDatabase(join(root, 'data', 'test.sqlite'))
})

describe('Bühnen anlegen und abbauen', () => {
  it('beginnt mit genau einer Bühne', () => {
    const buehnen = projection.listBuehnen()
    expect(buehnen).toHaveLength(1)
    expect(buehnen[0].id).toBe(HAUPTBUEHNE)
    expect(buehnen[0].followsRound).toBe(true)
  })

  it('legt eine zweite an und lässt die Hauptbühne stehen', () => {
    const buehnen = projection.saveBuehnen([
      { id: HAUPTBUEHNE, name: 'Große Wand', followsRound: true },
      { id: 2, name: 'Seitenleinwand', followsRound: false }
    ])
    expect(buehnen.map((buehne) => buehne.id)).toEqual([1, 2])
    expect(buehnen[1].followsRound).toBe(false)
  })

  it('lässt sich die Hauptbühne nicht wegnehmen', () => {
    const buehnen = projection.saveBuehnen([{ id: 2, name: 'Seitenleinwand', followsRound: false }])
    expect(buehnen.some((buehne) => buehne.id === HAUPTBUEHNE)).toBe(true)
  })

  it('weist Nummern ausserhalb des erlaubten Bereichs ab', () => {
    const buehnen = projection.saveBuehnen([
      { id: HAUPTBUEHNE, name: 'Beamer', followsRound: true },
      { id: BUEHNEN_MAX + 1, name: 'Zu viel', followsRound: false },
      { id: 0, name: 'Zu wenig', followsRound: false }
    ])
    expect(buehnen.map((buehne) => buehne.id)).toEqual([HAUPTBUEHNE])
  })
})

describe('Jede Bühne zeigt ihr Eigenes', () => {
  beforeAll(() => {
    projection.saveBuehnen([
      { id: HAUPTBUEHNE, name: 'Beamer', followsRound: true },
      { id: 2, name: 'Seitenleinwand', followsRound: false }
    ])
  })

  it('hält die Zustände auseinander', () => {
    projection.setProjection(HAUPTBUEHNE, { mode: 'welcome' })
    projection.setProjection(2, { mode: 'break', breakMinutes: 10 })

    expect(projection.getProjectionState(HAUPTBUEHNE).mode).toBe('welcome')
    expect(projection.getProjectionState(2).mode).toBe('break')
  })

  it('sperrt nur die Bühne, die gesperrt wurde', () => {
    projection.setLocked(2, true)
    expect(projection.getProjectionState(2).locked).toBe(true)
    expect(projection.getProjectionState(HAUPTBUEHNE).locked).toBe(false)
    projection.setLocked(2, false)
  })

  it('meldet den Wechsel mit der Bühne, zu der er gehört', () => {
    const gemeldet: number[] = []
    const ab = projection.onProjectionChanged((buehne) => gemeldet.push(buehne))
    projection.setProjection(2, { mode: 'session_finished' })
    ab()
    expect(gemeldet).toContain(2)
    expect(gemeldet).not.toContain(HAUPTBUEHNE)
  })

  it('vergisst den Zustand einer abgebauten Bühne', () => {
    projection.setProjection(2, { mode: 'session_finished' })
    projection.saveBuehnen([{ id: HAUPTBUEHNE, name: 'Beamer', followsRound: true }])
    projection.saveBuehnen([
      { id: HAUPTBUEHNE, name: 'Beamer', followsRound: true },
      { id: 2, name: 'Seitenleinwand', followsRound: false }
    ])
    /* Wieder aufgebaut heisst leer, nicht „wie vorher“. */
    expect(projection.getProjectionState(2).mode).toBe('welcome')
  })
})

describe('Der Wahlgang zieht nur die Bühnen mit, die ihm folgen', () => {
  it('lässt eine Bühne ohne Haken stehen', () => {
    projection.saveBuehnen([
      { id: HAUPTBUEHNE, name: 'Beamer', followsRound: true },
      { id: 2, name: 'Rednerliste', followsRound: false }
    ])
    projection.setProjection(2, { mode: 'custom_message', message: { title: 'Rednerliste' } })
    projection.setProjection(HAUPTBUEHNE, { mode: 'welcome' })

    projection.projectDomainEvent('RoundOpened', projection.getProjectionState(HAUPTBUEHNE).round?.id ?? 'x')

    expect(projection.getProjectionState(HAUPTBUEHNE).mode).toBe('round_open')
    expect(projection.getProjectionState(2).mode).toBe('custom_message')
  })
})

describe('Adressen im Netz', () => {
  const server = lies('src/main/network-projection.ts')

  it('kennt eine Kurzadresse je Bühne', () => {
    expect(server).toContain('/b/')
    expect(server).toContain('buehne=')
  })

  it('schickt einen Wechsel nur an die Geräte dieser Bühne', () => {
    expect(server).toContain('broadcastProjection(buehne: number, state: ProjectionState)')
    expect(server).toContain('if (abonniert !== buehne) continue')
  })
})

describe('Die Preloads bleiben sandboxfähig', () => {
  /*
   * Ein Preload in der Sandbox kann nichts nachladen.
   *
   * Ein Wert aus einem gemeinsamen Modul wird beim Bauen zu einem zweiten
   * Baustein — `require('./chunks/…')` —, den die Sandbox nicht auflöst. Das
   * Preload lädt dann gar nicht, `window.projection` fehlt, und die
   * Beameransicht meldet für immer „Verbindung unterbrochen". Reine
   * Typimporte verschwinden beim Übersetzen und sind deshalb erlaubt.
   */
  for (const datei of ['src/preload/audience.ts', 'src/preload/prompter.ts']) {
    it(`${datei} holt keine Werte aus gemeinsamen Modulen`, () => {
      const quelle = lies(datei)
      const einfuhren = [...quelle.matchAll(/^import (.+?) from '(@shared\/[^']+)'/gm)]
      const mitWert = einfuhren.filter((treffer) => !treffer[1].trimStart().startsWith('type'))
      expect(mitWert.map((treffer) => treffer[2])).toEqual([])
    })
  }
})
