/**
 * Die Lastprobe: 500 Geräte, ein Wahlgang, echte Leitung.
 *
 * ## Warum es diese Datei gibt
 *
 * „Ein Saal mit 500 Stimmberechtigten" steht seit M1 in der Dokumentation —
 * und war bis hierher eine **Behauptung**. Geprüft wurde die Stimmabgabe
 * immer nur einzeln: ein Ausweis, eine Stimme, ein Aufruf. Ob dieselbe Kette
 * standhält, wenn nach dem Satz „Die Wahl ist eröffnet" fünfhundert Telefone
 * gleichzeitig loslegen, wusste niemand.
 *
 * Genau das passiert hier: echter HTTP-Server, echte Datenbank, echte
 * Blindsignaturen, und die Geräte drängen gleichzeitig durch dieselbe Tür.
 *
 * ## Was gemessen wird und was das wert ist
 *
 * Gemessen wird die **Serverseite**: Berechtigung holen, Stimme einlegen. Was
 * hier herauskommt, ist eine Untergrenze für den Ernstfall — das WLAN im Saal,
 * die Telefone selbst und die Entfernung zum Zugangspunkt kommen dort noch
 * hinzu und lassen sich an keinem Schreibtisch nachstellen.
 *
 * **Die Lastprobe ersetzt deshalb keinen Durchlauf auf echter Hardware.** Sie
 * beantwortet nur die Frage, die ohne sie offen blieb: Bricht die Software
 * unter der Gleichzeitigkeit zusammen, verliert sie Stimmen, zählt sie
 * doppelt?
 *
 * ## Warum sie nicht im gewöhnlichen Prüflauf steckt
 *
 * Fünfhundert Abläufe dauern, und ein Prüflauf, der Minuten braucht, wird
 * irgendwann übersprungen. Sie läuft deshalb nur auf Aufforderung:
 *
 *     npm run lastprobe
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  entblenden,
  verblenden,
  zuBase64Url,
  type OeffentlicherSchluessel,
  type Pruefsumme
} from '../src/shared/blindsignatur'
import { defaultTemplateFor } from '../src/shared/election'

/** Wie viele Geräte. Über die Umgebung veränderbar, damit man schärfer messen kann. */
const GERAETE = Number(process.env.LASTPROBE_GERAETE ?? 500)

/**
 * Wie viele gleichzeitig unterwegs sind.
 *
 * In einem Saal drückt niemand auf Kommando: Die Leute holen ihr Telefon
 * heraus, entsperren es, suchen die Seite. Fünfzig gleichzeitig ist für 500
 * Anwesende schon eine pessimistische Annahme — und genau deshalb steht sie
 * hier.
 */
const GLEICHZEITIG = Number(process.env.LASTPROBE_GLEICHZEITIG ?? 50)

const root = mkdtempSync(join(tmpdir(), 'votura-last-'))
const TOKEN = 'lastprobe'
const PORT = 18479

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
const einstellungen = await import('../src/main/services/settings')
const netz = await import('../src/main/network-projection')
const bruecke = await import('../src/main/wahl-bruecke')

const sha256: Pruefsumme = async (daten) => new Uint8Array(createHash('sha256').update(daten).digest())
const zufall = (laenge: number): Uint8Array => new Uint8Array(randomBytes(laenge))

const basis = `http://127.0.0.1:${PORT}`
let roundId = ''
let bewerber: { id: string; displayName: string }[] = []
const paesse: string[] = []

/** Ein Aufruf, wie ihn ein Telefon macht — mit Token, weil das Netz eines hat. */
async function ruf<T>(pfad: string, koerper?: unknown): Promise<T> {
  const antwort = await fetch(`${basis}${pfad}${pfad.includes('?') ? '&' : '?'}t=${TOKEN}`, {
    method: koerper ? 'POST' : 'GET',
    headers: koerper ? { 'Content-Type': 'application/json' } : undefined,
    body: koerper ? JSON.stringify(koerper) : undefined
  })
  const daten = (await antwort.json()) as { fehler?: string } & T
  if (!antwort.ok) throw new Error(daten.fehler ?? `Fehler ${antwort.status}`)
  return daten
}

/** Der Ablauf eines einzelnen Geräts, von der Lage bis zur Stimme in der Urne. */
async function einGeraet(pass: string, geheim: boolean, schluessel?: OeffentlicherSchluessel): Promise<void> {
  await ruf(`/api/stimme/lage?code=${encodeURIComponent(pass)}`)

  if (geheim) {
    const seriennummer = zufall(32)
    const { verblendet, faktor } = await verblenden(seriennummer, schluessel!, sha256, zufall)
    const { signatur } = await ruf<{ signatur?: string }>('/api/stimme/berechtigung', {
      code: pass,
      roundId,
      verblendet
    })
    await ruf('/api/stimme/abgeben', {
      roundId,
      serial: zuBase64Url(seriennummer),
      signatur: entblenden(signatur!, faktor, schluessel!),
      choice: { kandidaten: [bewerber[0].id] }
    })
    return
  }

  const { serial } = await ruf<{ serial: string }>('/api/stimme/berechtigung', { code: pass, roundId })
  await ruf('/api/stimme/abgeben', {
    code: pass,
    roundId,
    serial,
    choice: { kandidaten: [bewerber[0].id] }
  })
}

/**
 * Eine Menge Aufgaben abarbeiten, aber nie mehr als `gleichzeitig` auf einmal.
 *
 * Alle 500 zugleich loszuschicken wäre keine Versammlung, sondern ein
 * Lasttest gegen die Ereignisschleife von Node — und würde eher die Prüfung
 * als den Server messen.
 */
async function inWellen<T>(
  aufgaben: (() => Promise<T>)[],
  gleichzeitig: number
): Promise<{ dauern: number[]; fehler: string[] }> {
  const dauern: number[] = []
  const fehler: string[] = []
  let naechste = 0

  const arbeiter = async (): Promise<void> => {
    while (naechste < aufgaben.length) {
      const meine = aufgaben[naechste++]
      const start = performance.now()
      try {
        await meine()
        dauern.push(performance.now() - start)
      } catch (grund) {
        fehler.push(grund instanceof Error ? grund.message : String(grund))
      }
    }
  }

  await Promise.all(Array.from({ length: gleichzeitig }, arbeiter))
  return { dauern, fehler }
}

function verteilung(dauern: number[]): { mittel: number; p50: number; p95: number; max: number } {
  const sortiert = [...dauern].sort((a, b) => a - b)
  const bei = (anteil: number): number => sortiert[Math.min(sortiert.length - 1, Math.floor(sortiert.length * anteil))]
  return {
    mittel: sortiert.reduce((summe, wert) => summe + wert, 0) / (sortiert.length || 1),
    p50: bei(0.5),
    p95: bei(0.95),
    max: sortiert[sortiert.length - 1] ?? 0
  }
}

beforeAll(async () => {
  initLogger(join(root, 'logs'))
  initDatabase(join(root, 'data', 'last.sqlite'))
  db()
    .prepare(
      `INSERT INTO users (id, username, display_name, password_hash, role, active, created_at)
       VALUES ('user-1', 'wahlleitung', 'Wahlleitung', ?, 'ADMIN', 1, ?)`
    )
    .run(auth.hashSecret('geheim-1234'), new Date().toISOString())
  auth.login('wahlleitung', 'geheim-1234')

  const netzConfig = einstellungen.getNetworkProjection()
  einstellungen.saveNetworkProjection({ ...netzConfig, token: TOKEN })

  const event = events.createEvent({
    title: 'Lastprobe',
    organization: 'Musterverein',
    orgCode: 'MV',
    date: '2026-09-15',
    location: 'Saal',
    ruleSet: { name: 'Satzung', version: '1', snapshotDate: '2026-09-15' }
  })
  events.activateEvent(event.id)

  const runde = rounds.createRound({
    eventId: event.id,
    title: 'Vorstandswahl',
    purpose: 'board_member',
    procedure: 'group_preprinted',
    seats: 2,
    maxVotes: 2,
    template: defaultTemplateFor('group_preprinted', { seats: 2, maxVotes: 2, entryCount: 2 }),
    orderMode: 'manual'
  })
  roundId = runde.id
  candidates.addCandidates(roundId, [
    { firstName: 'Alpha', lastName: 'Beispiel', displayName: 'Alpha Beispiel' },
    { firstName: 'Beta', lastName: 'Beispiel', displayName: 'Beta Beispiel' }
  ])
  bewerber = candidates.listCandidates(roundId)

  /* Alle Teilnehmer aufnehmen, anwesend melden und mit einem Pass versehen —
     das ist der Zustand kurz vor „Die Wahl ist eröffnet". */
  for (let i = 0; i < GERAETE; i++) {
    const person = teilnehmer.addParticipant({
      eventId: event.id,
      lastName: `Teilnehmer-${i}`,
      firstName: 'T'
    })
    teilnehmer.setAttendance(person.id, 'in')
    paesse.push(teilnehmer.issuePass(person.id).token)
  }

  const stand = await netz.startNetworkProjection({
    enabled: true,
    port: PORT,
    bindAddress: '127.0.0.1',
    token: TOKEN,
    tls: false,
    allowRemoteOperator: false,
    allowPrompterControl: false
  })
  if (stand.error) throw new Error(stand.error)
  netz.setWahlDispatcher(bruecke.wahlBruecke)
}, 600_000)

afterAll(async () => {
  await netz.stopNetworkProjection()
  closeDatabase()
})

describe('Lastprobe', () => {
  it(
    `hält ${GERAETE} Geräte bei offener Abstimmung aus`,
    async () => {
      wahl.prepareVoting({ roundId, geheimnis: 'open', geraete: 'both' })
      wahl.openVoting(roundId)

      const beginn = performance.now()
      const { dauern, fehler } = await inWellen(
        paesse.map((pass) => () => einGeraet(pass, false)),
        GLEICHZEITIG
      )
      const gesamt = performance.now() - beginn
      const zeiten = verteilung(dauern)

      const stand = wahl.votingStand(roundId)
      /* eslint-disable no-console */
      console.log(
        [
          '',
          `  Offene Abstimmung — ${GERAETE} Geräte, ${GLEICHZEITIG} gleichzeitig`,
          `  Gesamtdauer:      ${(gesamt / 1000).toFixed(1)} s  (${(GERAETE / (gesamt / 1000)).toFixed(0)} Stimmen/s)`,
          `  Je Gerät:         Mittel ${zeiten.mittel.toFixed(0)} ms · Median ${zeiten.p50.toFixed(0)} ms · p95 ${zeiten.p95.toFixed(0)} ms · längste ${zeiten.max.toFixed(0)} ms`,
          `  Urne:             ${stand.abgegeben} Stimmen bei ${stand.ausgegeben} Berechtigungen`,
          `  Fehler:           ${fehler.length}`,
          ''
        ].join('\n')
      )
      /* eslint-enable no-console */

      /* **Die eigentliche Prüfung ist nicht die Zeit, sondern die Rechnung.**
         Eine Software, die unter Last Stimmen verliert oder doppelt zählt,
         ist unbrauchbar, auch wenn sie schnell ist. */
      expect(fehler).toEqual([])
      expect(stand.abgegeben).toBe(GERAETE)
      expect(stand.ausgegeben).toBe(GERAETE)

      const seriennummern = db()
        .prepare(`SELECT serial FROM cast_ballots WHERE round_id = ?`)
        .all<{ serial: string }>(roundId)
        .map((zeile) => zeile.serial)
      expect(new Set(seriennummern).size).toBe(GERAETE)

      wahl.closeVoting(roundId)
    },
    600_000
  )

  it(
    `hält ${GERAETE} Geräte bei geheimer Wahl aus`,
    async () => {
      /*
       * Der teurere Fall: Jede Berechtigung ist eine RSA-Operation auf dem
       * Server, jedes Gerät rechnet eine Verblendung. Wenn irgendwo eine
       * Schlange entsteht, dann hier.
       */
      const zweite = rounds.createRound({
        eventId: events.activeEvent()!.id,
        title: 'Geheime Wahl',
        purpose: 'board_member',
        procedure: 'group_preprinted',
        seats: 2,
        maxVotes: 2,
        template: defaultTemplateFor('group_preprinted', { seats: 2, maxVotes: 2, entryCount: 2 }),
        orderMode: 'manual'
      })
      roundId = zweite.id
      candidates.addCandidates(roundId, [
        { firstName: 'Gamma', lastName: 'Beispiel', displayName: 'Gamma Beispiel' },
        { firstName: 'Delta', lastName: 'Beispiel', displayName: 'Delta Beispiel' }
      ])
      bewerber = candidates.listCandidates(roundId)

      wahl.prepareVoting({ roundId, geheimnis: 'secret', geraete: 'both' })
      wahl.openVoting(roundId)
      const schluessel = wahl.votingLage(roundId)!.schluessel!

      const beginn = performance.now()
      const { dauern, fehler } = await inWellen(
        paesse.map((pass) => () => einGeraet(pass, true, schluessel)),
        GLEICHZEITIG
      )
      const gesamt = performance.now() - beginn
      const zeiten = verteilung(dauern)
      const stand = wahl.votingStand(roundId)

      /* eslint-disable no-console */
      console.log(
        [
          '',
          `  Geheime Wahl — ${GERAETE} Geräte, ${GLEICHZEITIG} gleichzeitig`,
          `  Gesamtdauer:      ${(gesamt / 1000).toFixed(1)} s  (${(GERAETE / (gesamt / 1000)).toFixed(0)} Stimmen/s)`,
          `  Je Gerät:         Mittel ${zeiten.mittel.toFixed(0)} ms · Median ${zeiten.p50.toFixed(0)} ms · p95 ${zeiten.p95.toFixed(0)} ms · längste ${zeiten.max.toFixed(0)} ms`,
          `  Urne:             ${stand.abgegeben} Stimmen bei ${stand.ausgegeben} Berechtigungen`,
          `  Fehler:           ${fehler.length}`,
          ''
        ].join('\n')
      )
      /* eslint-enable no-console */

      expect(fehler).toEqual([])
      expect(stand.abgegeben).toBe(GERAETE)
      expect(stand.ausgegeben).toBe(GERAETE)

      /* In der Urne darf keine Person stehen — auch nicht unter Last. */
      const mitPerson = db()
        .prepare(`SELECT COUNT(*) AS anzahl FROM cast_ballots WHERE round_id = ? AND participant_id IS NOT NULL`)
        .get<{ anzahl: number }>(roundId)
      expect(Number(mitPerson?.anzahl ?? 0)).toBe(0)

      wahl.closeVoting(roundId)
    },
    900_000
  )
})
