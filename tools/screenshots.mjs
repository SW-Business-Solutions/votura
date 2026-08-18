/**
 * Bildschirmfotos für die Dokumentation aufnehmen.
 *
 * Das Werkzeug steuert die laufende Anwendung über das DevTools-Protokoll und
 * greift nicht in den Produktivcode ein: die Anwendung wird ganz normal
 * gestartet, lediglich mit offenem Debug-Port. Aufgenommen werden die
 * Bedienoberfläche (über die Hash-Navigation) und die Beameransicht.
 *
 * Aufruf:  node tools/screenshots.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as warte } from 'node:timers/promises'

const PORT = 9333
const ZIEL = 'docs/screenshots'
/* Eigenes Benutzerprofil: die Aufnahmen entstehen an einem sauberen Demo-Bestand
   und rühren die Daten einer echten Versammlung nicht an. */
const PROFIL = join(tmpdir(), 'votura-screenshots')
const KONTO = { username: 'wahlleitung', displayName: 'Wahlleitung', password: 'Demo-Versammlung-2026' }
const BREITE = 1600
const HOEHE = 1000

/** Eine CDP-Sitzung auf einem Ziel (Fenster). */
class Sitzung {
  #socket
  #id = 0
  #offen = new Map()

  static async verbinde(url) {
    const sitzung = new Sitzung()
    sitzung.#socket = new WebSocket(url)
    sitzung.#socket.addEventListener('message', (nachricht) => {
      const antwort = JSON.parse(nachricht.data)
      const warteschlange = sitzung.#offen.get(antwort.id)
      if (!warteschlange) return
      sitzung.#offen.delete(antwort.id)
      antwort.error ? warteschlange.reject(new Error(antwort.error.message)) : warteschlange.resolve(antwort.result)
    })
    await new Promise((fertig, fehler) => {
      sitzung.#socket.addEventListener('open', fertig, { once: true })
      sitzung.#socket.addEventListener('error', () => fehler(new Error('Verbindung fehlgeschlagen')), { once: true })
    })
    return sitzung
  }

  sende(methode, params = {}) {
    const id = ++this.#id
    return new Promise((resolve, reject) => {
      this.#offen.set(id, { resolve, reject })
      this.#socket.send(JSON.stringify({ id, method: methode, params }))
    })
  }

  async auswerten(ausdruck) {
    const antwort = await this.sende('Runtime.evaluate', {
      expression: ausdruck,
      awaitPromise: true,
      returnByValue: true
    })
    if (antwort.exceptionDetails) {
      const text = antwort.exceptionDetails.exception?.description ?? antwort.exceptionDetails.text
      throw new Error('Im Renderer: ' + text)
    }
    return antwort.result?.value
  }

  async aufnehmen(datei) {
    const { data } = await this.sende('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(`${ZIEL}/${datei}.png`, Buffer.from(data, 'base64'))
    console.log('  aufgenommen:', `${ZIEL}/${datei}.png`)
  }

  schliessen() {
    this.#socket.close()
  }
}

async function ziele() {
  const antwort = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  return antwort.json()
}

async function wartenAufZiele(versuche = 40) {
  for (let i = 0; i < versuche; i++) {
    try {
      const liste = await ziele()
      if (liste.some((z) => z.type === 'page')) return liste
    } catch {
      /* noch nicht bereit */
    }
    await warte(500)
  }
  throw new Error('Die Anwendung hat den Debug-Port nicht geöffnet.')
}


/**
 * Baut im frischen Profil einen vorzeigbaren Bestand auf: Konto, Veranstaltung,
 * Tagesordnung und drei Wahlgänge in unterschiedlichen Stadien. Alles läuft
 * über die regulären Dienste der Anwendung — es wird nichts an der Datenbank
 * vorbei geschrieben.
 */
function demoSkript() {
  const konto = JSON.stringify(KONTO)
  return `(async () => {
  const ruf = (m, ...a) => window.votura.invoke(m, ...a)
  try {
    const konto = ${konto}
    const zustand = await ruf('system.setupState')
    if (zustand.needsFirstAdmin ?? zustand.needsSetup ?? true) {
      await ruf('system.createFirstAdmin', {
        username: konto.username, displayName: konto.displayName, password: konto.password
      })
    }
    await ruf('auth.login', { username: konto.username, password: konto.password })
    // Für die Bestätigung des Ergebnisses ist eine Wahlleiter-PIN nötig.
    await ruf('auth.setPrintPin', { pin: '246810' })

    const veranstaltung = await ruf('event.create', {
      title: 'Mitgliederversammlung 2026',
      organization: 'Musterverband Beispielstadt',
      orgCode: 'MV26',
      date: '2026-09-12',
      location: 'Bürgerhaus, Großer Saal',
      eligibleVoterCount: 121,
      ruleSet: { name: 'Wahlordnung des Verbandes', version: 'Fassung 2024', snapshotDate: '2026-09-01' }
    })
    await ruf('event.activate', veranstaltung.id)

    for (const [nummer, titel] of [
      ['1', 'Begrüßung und Feststellung der Beschlussfähigkeit'],
      ['2', 'Wahl der Versammlungsleitung'],
      ['3', 'Bericht des Vorstands'],
      ['4', 'Wahl des Vorsitzes'],
      ['5', 'Wahl der Delegierten'],
      ['6', 'Satzungsänderung § 7'],
      ['7', 'Verschiedenes']
    ]) {
      await ruf('agenda.add', { eventId: veranstaltung.id, label: nummer, title: titel })
    }

    const anlegen = async (daten, namen, stadium) => {
      const wg = await ruf('round.create', { eventId: veranstaltung.id, template: {}, orderMode: 'manual', ...daten })
      if (namen.length) {
        await ruf('candidate.add', {
          roundId: wg.id,
          candidates: namen.map((n) => {
            const teile = n.split(' ')
            return { firstName: teile[0], lastName: teile.slice(1).join(' '), displayName: n }
          })
        })
      }
      if (stadium === 'entwurf') return wg
      await ruf('round.lockCandidates', wg.id)
      await ruf('ballot.approve', { roundId: wg.id, checklist: ['round', 'candidates', 'seats', 'maxVotes', 'options', 'roundCode'] })
      return wg
    }

    const vorsitz = await anlegen(
      { title: 'Wahl des Vorsitzes', purpose: 'chairperson', procedure: 'single_multiple_candidates', seats: 1, maxVotes: 1 },
      ['Anna Beckmann', 'Jonas Kröger', 'Miriam Sander'],
      'freigegeben'
    )

    const delegierte = await anlegen(
      { title: 'Wahl der Delegierten', purpose: 'delegate', procedure: 'group_preprinted', seats: 8, maxVotes: 8 },
      ['Anna Beckmann', 'Tobias Ehlers', 'Clara Fenske', 'Jonas Kröger', 'Nina Lorenz',
       'Paul Marquardt', 'Miriam Sander', 'Ruben Thiele', 'Sophie Vogt', 'Lennart Wendt',
       'Katharina Ziegler', 'David Ohlsen'],
      'freigegeben'
    )

    // Dieselbe Delegiertenwahl im Akzeptanzverfahren: hier wird jeder Bewerber
    // einzeln mit Ja/Nein/Enthaltung beurteilt statt angekreuzt.
    const akzeptanz = await anlegen(
      {
        title: 'Wahl der Delegierten (Akzeptanzverfahren)',
        purpose: 'delegate',
        procedure: 'acceptance_group',
        seats: 5,
        maxVotes: null
      },
      ['Clara Fenske', 'Paul Marquardt', 'Nina Lorenz', 'Ruben Thiele', 'Sophie Vogt', 'David Ohlsen'],
      'freigegeben'
    )

    await anlegen(
      { title: 'Satzungsänderung § 7', purpose: 'motion', procedure: 'yes_no_abstain', seats: 1, maxVotes: 1 },
      [],
      'entwurf'
    )

    // Ein abgeschlossenes Ergebnis, damit Ergebnis- und Beameransicht Inhalt zeigen.
    await ruf('round.start', vorsitz.id)
    await ruf('round.setStatus', { roundId: vorsitz.id, status: 'open' })
    await ruf('round.setStatus', { roundId: vorsitz.id, status: 'counting' })
    const bewerber = (await ruf('round.detail', vorsitz.id)).candidates
    const stimmen = [64, 41, 12]
    await ruf('result.save', {
      electionRoundId: vorsitz.id,
      countingMode: 'counted',
      ballotsCast: 119,
      validBallots: 117,
      invalidBallots: 2,
      resultData: { candidates: bewerber.map((b, i) => ({ candidateId: b.id, name: b.displayName, votes: stimmen[i] ?? 0 })) },
      determination: 'Erforderliche Mehrheit im ersten Wahlgang erreicht',
      finalDecision: 'elected',
      electedCandidateIds: [bewerber[0].id]
    })
    await ruf('result.confirm', { roundId: vorsitz.id, pin: '246810' })
    // Ergebnis der Akzeptanzwahl: Ja/Nein/Enthaltung je Bewerber. Gewählt ist,
    // wer mehr Ja- als Nein-Stimmen hat – hier vier von sechs.
    await ruf('round.start', akzeptanz.id)
    await ruf('round.setStatus', { roundId: akzeptanz.id, status: 'open' })
    await ruf('round.setStatus', { roundId: akzeptanz.id, status: 'counting' })
    const feld = (await ruf('round.detail', akzeptanz.id)).candidates
    const voten = [
      { yes: 96, no: 14, abstain: 7 },
      { yes: 88, no: 21, abstain: 8 },
      { yes: 81, no: 29, abstain: 7 },
      { yes: 74, no: 33, abstain: 10 },
      { yes: 44, no: 62, abstain: 11 },
      { yes: 39, no: 68, abstain: 10 }
    ]
    await ruf('result.save', {
      electionRoundId: akzeptanz.id,
      countingMode: 'counted',
      ballotsCast: 119,
      validBallots: 117,
      invalidBallots: 2,
      resultData: {
        candidates: feld.map((b, i) => ({
          candidateId: b.id,
          name: b.displayName,
          yes: voten[i]?.yes ?? 0,
          no: voten[i]?.no ?? 0,
          abstain: voten[i]?.abstain ?? 0,
          invalidVotes: 0
        }))
      },
      determination: 'Vier Bewerber mit mehr Ja- als Nein-Stimmen; fünfter Platz bleibt unbesetzt',
      finalDecision: 'elected',
      electedCandidateIds: feld.slice(0, 4).map((b) => b.id)
    })
    await ruf('result.confirm', { roundId: akzeptanz.id, pin: '246810' })

    await ruf('projection.setMode', { mode: 'result', roundId: akzeptanz.id, showAll: true })
    await ruf('projection.openAudience')

    return {
      zusammenfassung: 'Veranstaltung, 7 Tagesordnungspunkte, 4 Wahlgänge, 2 bestätigte Ergebnisse',
      wahlgangDelegierte: delegierte.id,
      wahlgangAkzeptanz: akzeptanz.id
    }
  } catch (fehler) {
    return { fehler: String(fehler && fehler.message ? fehler.message : fehler) }
  }
})()`
}

mkdirSync(ZIEL, { recursive: true })

const umgebung = { ...process.env }
delete umgebung.ELECTRON_RUN_AS_NODE

console.log('Anwendung starten …')
try {
  rmSync(PROFIL, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
} catch {
  // Ein noch geöffnetes Profil aus einem früheren Lauf blockiert das Löschen –
  // dann wird darauf aufgebaut statt abzubrechen.
}
const app = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron', '.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFIL}`],
  { env: umgebung, stdio: 'ignore', shell: process.platform === 'win32' }
)

try {
  const liste = await wartenAufZiele()
  const bediener = liste.find((z) => z.type === 'page' && !z.url.includes('audience'))
  if (!bediener) throw new Error('Bedienoberfläche nicht gefunden.')

  const sitzung = await Sitzung.verbinde(bediener.webSocketDebuggerUrl)
  await sitzung.sende('Page.enable')
  await sitzung.sende('Runtime.enable')
  await sitzung.sende('Emulation.setDeviceMetricsOverride', {
    width: BREITE,
    height: HOEHE,
    deviceScaleFactor: 2,
    mobile: false
  })
  await warte(1500)

  await sitzung.aufnehmen('00-anmeldung')

  console.log('Demo-Bestand anlegen …')
  const bericht = await sitzung.auswerten(demoSkript())
  if (bericht?.fehler) throw new Error('Demo-Bestand: ' + bericht.fehler)
  console.log('  ' + bericht.zusammenfassung)

  // Neu laden über das Protokoll: ein reload() aus dem Skript heraus bricht die
  // laufende Auswertung ab und wurde nicht zuverlässig ausgeführt.
  await sitzung.auswerten('window.location.hash = "#/dashboard"')
  await sitzung.sende('Page.reload', { ignoreCache: true })
  await warte(3500)

  const seiten = [
    ['dashboard', '01-uebersicht'],
    ['agenda', '02-tagesordnung'],
    ['beamer', '03-beamersteuerung'],
    ['audit', '04-audit-trail'],
    ['preflight', '05-systemcheck'],
    ['settings', '06-einstellungen']
  ]

  for (const [pfad, datei] of seiten) {
    await sitzung.auswerten(`window.location.hash = '#/${pfad}'`)
    await warte(1200)
    await sitzung.aufnehmen(datei)
  }

  // Wahlgang-Ansichten: der Demo-Wahlgang ist aus dem Aufbau bekannt.
  if (bericht.wahlgangDelegierte) {
    for (const [reiter, datei] of [
      ['candidates', '07-kandidaten'],
      ['ballot', '08-wahlzettel-vorschau'],
      ['print', '09-druck'],
      ['result', '10-ergebnis']
    ]) {
      await sitzung.auswerten(`window.location.hash = '#/round/${bericht.wahlgangDelegierte}/${reiter}'`)
      await warte(1500)
      await sitzung.aufnehmen(datei)
    }
  } else {
    console.log('  Hinweis: Kein Wahlgang bekannt – Wahlgang-Ansichten übersprungen.')
  }

  // Einstellungen: Bereich für den Hinweis auf neue Fassungen.
  await sitzung.auswerten("window.location.hash = '#/settings'")
  await warte(1000)
  await sitzung.auswerten(
    "(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Backup|Sicherung/.test(x.textContent || '')); if (b) b.click(); return true })()"
  )
  await warte(1200)
  await sitzung.aufnehmen('14-aktualisierung')

  // Akzeptanzverfahren: eigener Stimmzettel (Ja/Nein/Enthaltung je Bewerber)
  // und eigene Ergebnisdarstellung.
  if (bericht.wahlgangAkzeptanz) {
    for (const [reiter, datei] of [
      ['ballot', '12-akzeptanzwahl-stimmzettel'],
      ['result', '13-akzeptanzwahl-ergebnis']
    ]) {
      await sitzung.auswerten(`window.location.hash = '#/round/${bericht.wahlgangAkzeptanz}/${reiter}'`)
      await warte(1500)
      await sitzung.aufnehmen(datei)
    }
  }

  // Beamerfenster, falls geöffnet.
  const beamer = (await ziele()).find((z) => z.url.includes('audience'))
  if (beamer) {
    const zweite = await Sitzung.verbinde(beamer.webSocketDebuggerUrl)
    await zweite.sende('Page.enable')
    await zweite.sende('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    })
    await warte(1200)
    await zweite.aufnehmen('11-beameransicht')
    zweite.schliessen()
  } else {
    console.log('  Hinweis: Beamerfenster nicht geöffnet – Ansicht übersprungen.')
  }

  sitzung.schliessen()
  console.log('Fertig.')
} finally {
  app.kill()
}
