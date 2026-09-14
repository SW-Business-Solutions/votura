/**
 * Was ein Gerät im Saal tatsächlich bekommt.
 *
 * **Der Fehler, für den es diese Datei gibt.** Die Wahlseite wurde mit
 * `?t=…` geholt und kam an — ihre Skripte und Stile aber tragen kein Token,
 * und ohne Keks antwortete der Server darauf mit 401. Auf dem Gerät blieb
 * eine **schwarze Fläche ohne Meldung**: Das Gerüst war da, der Inhalt kam
 * nie. Dasselbe traf Akkreditierung, Ausgabe und den Wahlausschuss.
 *
 * So etwas fällt in einer Prüfung des Quelltextes nicht auf. Hier läuft
 * deshalb der echte Server, und geholt wird wie von einem Telefon: erst die
 * Seite, dann ihre Bausteine — mit nichts als dem, was die erste Antwort
 * mitgegeben hat.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AUSSCHUSS_PFAD, WAHL_PFAD } from '../src/shared/wahl'

const root = mkdtempSync(join(tmpdir(), 'votura-netz-'))

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

const { initLogger } = await import('../src/main/logger')
const netz = await import('../src/main/network-projection')

const TOKEN = 'saalgeheim'
let basis = ''

beforeAll(async () => {
  initLogger(join(root, 'logs'))
  const stand = await netz.startNetworkProjection({
    enabled: true,
    /* Port 0 wäre schöner, die Einstellung kennt ihn aber als feste Zahl —
       eine hohe, die auf keinem Entwicklungsrechner belegt ist. */
    port: 18477,
    bindAddress: '127.0.0.1',
    token: TOKEN,
    tls: false,
    allowRemoteOperator: true,
    allowPrompterControl: false
  })
  if (stand.error) throw new Error(stand.error)
  basis = `http://127.0.0.1:18477`
})

afterAll(async () => {
  await netz.stopNetworkProjection()
})

/**
 * Die Bausteine, die eine Seite nachlädt — genau wie ein Browser es täte.
 *
 * Gesucht wird nach Pfaden auf demselben Rechner; im gebauten Stand heißen
 * sie `assets/…`, im Quellbaum `/src/…`. Fremde Adressen und eingebettete
 * Daten bleiben außen vor, denn die holt der Server nicht.
 */
function bausteine(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="([^":]+)"/g)]
    .map((treffer) => treffer[1].replace(/^\.?\//, ''))
    .filter((pfad) => pfad && !pfad.startsWith('#'))
}

describe.each([
  ['die Wahlseite', WAHL_PFAD],
  ['der Wahlausschuss', AUSSCHUSS_PFAD],
  ['die Bedienung im Netz', '/operator'],
  ['der Prompter', '/prompter']
])('%s', (_name, pfad) => {
  it('lädt mit allem, was dazugehört', async () => {
    const seite = await fetch(`${basis}${pfad}?t=${TOKEN}`)
    expect(seite.status).toBe(200)

    /*
     * Der Keks ist der ganze Punkt: Ohne ihn trägt keine einzige
     * Folgeanfrage ein Token, denn in `<script src="assets/…">` steht keines.
     */
    const keks = seite.headers.get('set-cookie') ?? ''
    expect(keks).toContain(`wz_token=${TOKEN}`)

    const html = await seite.text()
    const dateien = bausteine(html)
    expect(dateien.length).toBeGreaterThan(0)

    for (const datei of dateien) {
      const antwort = await fetch(`${basis}/${datei}`, { headers: { cookie: `wz_token=${TOKEN}` } })
      expect(antwort.status, `${pfad} → ${datei}`).toBe(200)
    }
  })
})

describe('Ohne Token', () => {
  it('kommt niemand an die Bausteine', async () => {
    const antwort = await fetch(`${basis}/assets/gibtsnicht.js`)
    expect(antwort.status).toBe(401)
  })
})
