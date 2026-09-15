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
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as warte } from 'node:timers/promises'

/*
 * Der Debug-Port lässt sich setzen — und muss es, wenn nebenher schon eine
 * Votura-Instanz läuft.
 *
 * Sonst geschieht etwas Tückisches: Der Port ist belegt, die eigene Instanz
 * öffnet ihn nicht, und das Werkzeug verbindet sich mit der **fremden**
 * Anwendung. Es baut dann seinen Demo-Bestand in einem echten Profil auf und
 * fotografiert fremde Daten.
 */
const PORT = Number(process.env.VOTURA_SCREENSHOT_PORT || 9333)
const ZIEL = 'docs/screenshots'
/* Eigenes Benutzerprofil: die Aufnahmen entstehen an einem sauberen Demo-Bestand
   und rühren die Daten einer echten Versammlung nicht an. */
const PROFIL = process.env.VOTURA_SCREENSHOT_PROFIL || join(tmpdir(), 'votura-screenshots')
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
      ['TOP 1', 'Begrüßung und Eröffnung der Versammlung'],
      ['TOP 2', 'Feststellung der ordnungsgemäßen Einladung und der Beschlussfähigkeit'],
      ['TOP 3', 'Wahl der Versammlungsleitung'],
      ['TOP 4', 'Wahl eines Schriftführers'],
      ['TOP 5', 'Beratung und Beschlussfassung über die Tagesordnung'],
      ['TOP 6', 'Wahl der Mandatsprüfungskommission'],
      ['TOP 7', 'Wahl eines Wahlleiters'],
      ['TOP 8', 'Wahl der Zählkommission'],
      ['TOP 9', 'Bericht des Vorstands'],
      ['TOP 10', 'Vorstellung der Bewerberinnen und Bewerber'],
      ['TOP 11', 'Wahl der Delegierten für den Landesparteitag']
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
    /* Plaetze 3 und 4 bewusst gleichauf: Genau dieser Fall — gleiche Ja- und
       Nein-Zahl — ist der interessante, und die Aufnahmen sollen ihn zeigen. */
    const voten = [
      { yes: 96, no: 14, abstain: 7 },
      { yes: 88, no: 21, abstain: 8 },
      { yes: 81, no: 29, abstain: 7 },
      { yes: 81, no: 29, abstain: 7 },
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
      determination: 'Vier Bewerber mit mehr Ja- als Nein-Stimmen; Rang 3 und 4 stimmengleich',
      finalDecision: 'elected',
      electedCandidateIds: feld.slice(0, 4).map((b) => b.id)
    })
    await ruf('result.confirm', { roundId: akzeptanz.id, pin: '246810' })

    /*
     * **Der Einlass braucht Menschen, nicht nur Wahlgänge.**
     *
     * Eine Akkreditierungsseite ohne Teilnehmer zeigt eine leere Liste und
     * ein Scanfeld — und erklärt damit nichts. Deshalb ein kleiner Bestand
     * mit Anwesenden, Gästen und ausgegebenen Karten: genau das Bild, das am
     * Einlass auf dem Schirm steht.
     */
    const namen = [
      ['Beckmann', 'Anna'], ['Ehlers', 'Tobias'], ['Fenske', 'Clara'], ['Kröger', 'Jonas'],
      ['Lorenz', 'Nina'], ['Marquardt', 'Paul'], ['Ohlsen', 'David'], ['Sander', 'Miriam'],
      ['Thiele', 'Ruben'], ['Vogt', 'Sophie'], ['Wendt', 'Lennart'], ['Ziegler', 'Katharina']
    ]
    const leute = []
    for (const [nachname, vorname] of namen) {
      leute.push(await ruf('participant.add', {
        eventId: veranstaltung.id,
        lastName: nachname,
        firstName: vorname,
        number: String(100 + leute.length + 1),
        weight: 1
      }))
    }
    /* Zwei Gäste ohne Stimmrecht — der Unterschied soll sichtbar sein. */
    for (const [nachname, vorname] of [['Petersen', 'Hanna'], ['Roth', 'Gregor']]) {
      leute.push(await ruf('participant.add', {
        eventId: veranstaltung.id, lastName: nachname, firstName: vorname, eligible: false
      }))
    }

    /* Karten und Bändchen: die Nummern stehen aufgedruckt, der Code darunter. */
    await ruf('card.import', {
      kind: 'card',
      entries: Array.from({ length: 40 }, (_, i) => ({
        serial: 'K-' + String(i + 1).padStart(3, '0'),
        code: 'DEMO-KARTE-' + String(i + 1).padStart(3, '0')
      }))
    })

    /* Neun sind da, einer davon mit Karte in der Hand. */
    for (const person of leute.slice(0, 9)) await ruf('participant.attendance', { id: person.id, kind: 'in' })
    for (let i = 0; i < 6; i++) {
      await ruf('card.assign', { participantId: leute[i].id, code: 'DEMO-KARTE-' + String(i + 1).padStart(3, '0') })
    }

    /*
     * **Ein eigener Wahlgang, der gerade läuft.**
     *
     * Nicht der Delegiertenwahlgang: Der steht auf den Aufnahmen von
     * Kandidatenliste, Stimmzettel, Druck und Ergebnis, und ein eröffneter
     * Wahlgang zeigte dort überall etwas anderes. Der Schriftführer passt
     * ohnehin zur Tagesordnung.
     */
    const schriftfuehrer = await anlegen(
      { title: 'Wahl des Schriftführers', purpose: 'secretary', procedure: 'single_multiple_candidates', seats: 1, maxVotes: 1 },
      ['Nina Lorenz', 'Ruben Thiele'],
      'freigegeben'
    )
    await ruf('round.start', schriftfuehrer.id)
    await ruf('round.setStatus', { roundId: schriftfuehrer.id, status: 'open' })
    /* Erst die Zettel, dann die digitale Wahl: Wer eine digitale Berechtigung
       hat, bekommt keinen Zettel mehr — und genau so soll es sein. */
    for (const person of leute.slice(0, 4)) {
      await ruf('handout.issue', { roundId: schriftfuehrer.id, participantId: person.id })
    }
    await ruf('voting.prepare', {
      roundId: schriftfuehrer.id, geheimnis: 'secret', geraete: 'both', signer: 'hub'
    })
    await ruf('voting.open', schriftfuehrer.id)

    /* Eine Rede, einem Bewerber zugeordnet — dafür ist der Prompter da. */
    const rede = await ruf('speech.create', 'Bewerbung um den Vorsitz')
    await ruf('speech.save', {
      id: rede.id,
      markdown: [
        '# Bewerbung um den Vorsitz',
        '',
        '[Zum Publikum schauen und kurz warten]',
        '',
        'Liebe Mitglieder, ich danke Ihnen für das Vertrauen der vergangenen Jahre.',
        '',
        '---',
        '',
        'Drei Dinge nehme ich mir für die kommende Wahlperiode vor.',
        '',
        '- die Mitgliederwerbung in den Ortsverbänden',
        '- verlässliche Termine für die Vorstandssitzungen',
        '- ein offenes Ohr für die Arbeitsgemeinschaften',
        '',
        '[Langsamer sprechen]',
        '',
        'Deshalb bitte ich Sie um Ihre Stimme.'
      ].join('\\n')
    })
    const vorsitzBewerber = (await ruf('round.detail', vorsitz.id)).candidates[0]
    await ruf('speech.assign', {
      id: rede.id, candidateId: vorsitzBewerber.id, candidateName: vorsitzBewerber.displayName
    })
    await ruf('prompter.load', rede.id)

    await ruf('projection.setMode', { mode: 'result', roundId: akzeptanz.id, showAll: true })
    await ruf('projection.openAudience')

    return {
      zusammenfassung:
        'Veranstaltung, 11 Tagesordnungspunkte, 4 Wahlgänge, 2 bestätigte Ergebnisse, ' +
        leute.length + ' Teilnehmer, 40 Karten, 1 Rede',
      wahlgangDelegierte: delegierte.id,
      wahlgangAkzeptanz: akzeptanz.id,
      wahlgangVorsitz: vorsitz.id,
      wahlgangLaufend: schriftfuehrer.id
    }
  } catch (fehler) {
    return { fehler: String(fehler && fehler.message ? fehler.message : fehler) }
  }
})()`
}

/**
 * Einen Knopf über seine Beschriftung anklicken.
 *
 * Seiten, die mehrere Wahlgänge zur Auswahl stellen, zeigen ohne Klick nur
 * diese Auswahl — ein Bildschirmfoto davon erklärt nichts. Hier wird also
 * genau das getan, was auch ein Mensch täte: den richtigen anklicken.
 */
async function klickeKnopf(sitzung, beschriftung) {
  /*
   * **Nur im Inhaltsbereich.** Dieselbe Beschriftung steht auch in der
   * Navigation links — und der erste Versuch traf genau die: Statt den
   * Wahlgang auf der Seite auszuwählen, sprang das Werkzeug auf dessen
   * Detailseite und fotografierte die Kandidatenliste.
   */
  const ergebnis = await sitzung.auswerten(`(() => {
    const bereich = document.querySelector('main') || document
    const b = Array.from(bereich.querySelectorAll('button')).find((x) =>
      (x.textContent || '').includes(${JSON.stringify(beschriftung)})
    )
    if (!b) return 'nicht gefunden'
    b.click()
    return 'ok'
  })()`)
  if (ergebnis !== 'ok') console.log(`  Hinweis: Knopf "${beschriftung}" nicht gefunden.`)
}

/** Nach oben — sonst zeigt die Aufnahme die Mitte einer Seite. */
async function nachOben(sitzung) {
  await sitzung.auswerten('window.scrollTo(0, 0); true')
  await warte(400)
}

/**
 * Einen Reiter der Beamerseite öffnen.
 *
 * Seit die Seite gegliedert ist, liegen Präsentationen und Videos hinter einem
 * Reiter — ohne Klick fotografierte das Werkzeug den falschen Bereich.
 */
async function reiterOeffnen(sitzung, beschriftung) {
  const ergebnis = await sitzung.auswerten(`(() => {
    const b = Array.from(document.querySelectorAll('.tabs .tab')).find((x) =>
      (x.textContent || '').includes(${JSON.stringify(beschriftung)})
    )
    if (!b) return 'nicht gefunden'
    b.click()
    return 'ok'
  })()`)
  if (ergebnis !== 'ok') console.log(`  Hinweis: Reiter "${beschriftung}" nicht gefunden.`)
}

mkdirSync(ZIEL, { recursive: true })

const umgebung = { ...process.env }
delete umgebung.ELECTRON_RUN_AS_NODE

/* Belegter Port: lieber abbrechen als fremde Daten fotografieren. */
try {
  const antwort = await fetch(`http://127.0.0.1:${PORT}/json/version`)
  if (antwort.ok) {
    throw new Error(
      `Auf Port ${PORT} antwortet bereits eine Anwendung. Bitte sie beenden oder ` +
        'VOTURA_SCREENSHOT_PORT auf einen freien Port setzen — sonst würde dieses ' +
        'Werkzeug die fremde Instanz fernsteuern und deren Daten fotografieren.'
    )
  }
} catch (fehler) {
  if (fehler instanceof Error && fehler.message.startsWith('Auf Port')) throw fehler
  /* Keine Antwort heißt: frei. Genau so soll es sein. */
}

console.log('Anwendung starten …')
try {
  rmSync(PROFIL, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
} catch {
  // Ein noch geöffnetes Profil aus einem früheren Lauf blockiert das Löschen –
  // dann wird darauf aufgebaut statt abzubrechen.
}
/*
 * Die Beispiel-Präsentation vorab in die Ablage legen.
 *
 * Das Einspeisen läuft sonst über einen Dateidialog des Betriebssystems, der
 * sich nicht fernsteuern lässt. Die Ablage ist ein Ordner mit Verzeichnisdatei
 * — hier wird genau das geschrieben, was der Import auch schriebe.
 */
const BEISPIEL_ID = '11111111-2222-3333-4444-555555555555'
const beispielQuelle = 'docs/beispiel-praesentation.html'
const praesentationen = join(PROFIL, 'presentations')
mkdirSync(praesentationen, { recursive: true })
copyFileSync(beispielQuelle, join(praesentationen, `${BEISPIEL_ID}.html`))
writeFileSync(
  join(praesentationen, 'index.json'),
  JSON.stringify(
    [
      {
        id: BEISPIEL_ID,
        title: 'Rechenschaftsbericht des Vorstands',
        fileName: 'beispiel-praesentation.html',
        size: statSync(beispielQuelle).size,
        importedAt: new Date().toISOString()
      }
    ],
    null,
    2
  ),
  'utf8'
)

/* Denselben Weg für das Beispielvideo. */
const VIDEO_ID = '22222222-3333-4444-5555-666666666666'
const videoQuelle = 'docs/beispiel-video.mp4'
const videos = join(PROFIL, 'videos')
mkdirSync(videos, { recursive: true })
copyFileSync(videoQuelle, join(videos, `${VIDEO_ID}.mp4`))
writeFileSync(
  join(videos, 'index.json'),
  JSON.stringify(
    [
      {
        id: VIDEO_ID,
        title: 'Rückblick auf das Jahr 2026',
        fileName: 'beispiel-video.mp4',
        size: statSync(videoQuelle).size,
        mimeType: 'video/mp4',
        importedAt: new Date().toISOString()
      }
    ],
    null,
    2
  ),
  'utf8'
)

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
    await nachOben(sitzung)
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

  // Beamer-Tagesordnung: lange Titel dürfen nicht abgeschnitten werden.
  await sitzung.auswerten(
    "window.votura.invoke('projection.setMode', { mode: 'agenda', agendaView: 'full' })"
  )
  await warte(1500)
  const beamerTafel = (await ziele()).find((z) => z.url.includes('audience'))
  if (beamerTafel) {
    const tafel = await Sitzung.verbinde(beamerTafel.webSocketDebuggerUrl)
    await tafel.sende('Page.enable')
    await tafel.sende('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 720, deviceScaleFactor: 1, mobile: false
    })
    await warte(1500)
    await tafel.aufnehmen('15-beamer-tagesordnung')
    tafel.schliessen()
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

    /* Die Rangliste — bei einer Delegiertenwahl das eigentliche Ergebnis. */
    await sitzung.auswerten(
      "(() => { const k = Array.from(document.querySelectorAll('h2, h3')).find((x) => x.textContent.trim() === 'Rangliste'); if (k) k.scrollIntoView({ block: 'start' }); return true })()"
    )
    await warte(900)
    await sitzung.aufnehmen('21-rangliste')
  }

  /* ---------------------------------------------------- Vorstellung */
  console.log('Vorstellung mit Redezeit …')
  await sitzung.auswerten(`(async () => {
    await window.votura.invoke('projection.setMode', {
      mode: 'speaker',
      speaker: {
        name: 'Clara Fenske',
        note: 'Bewerbung um den Vorsitz',
        seconds: 180,
        /* Die Reihe entsteht sonst aus der Kandidatenliste; hier wird sie
           genannt, damit die Aufnahme sie zeigt. */
        upcoming: ['Paul Marquardt', 'Nina Lorenz', 'Ruben Thiele', 'Sophie Vogt', 'David Ohlsen'],
        upcomingShown: 4
      }
    })
    return true
  })()`)
  await warte(2000)
  const redepult = (await ziele()).find((z) => z.url.includes('audience'))
  if (redepult) {
    const wand = await Sitzung.verbinde(redepult.webSocketDebuggerUrl)
    await wand.sende('Page.enable')
    await wand.sende('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false
    })
    await warte(1500)
    await wand.aufnehmen('22-redezeit')
    wand.schliessen()
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

  /* ------------------------------------------------------ Präsentation */
  console.log('Präsentation …')
  await sitzung.auswerten(`(async () => {
    const ruf = (m, ...a) => window.votura.invoke(m, ...a)
    await ruf('projection.setMode', { mode: 'presentation', presentationId: '${BEISPIEL_ID}' })
    await new Promise((f) => setTimeout(f, 2000))
    await ruf('presentation.setSlide', 2)
    await ruf('presentation.openPrompter')
    return true
  })()`)
  await warte(3500)

  const beamerPraesentation = (await ziele()).find((z) => z.url.includes('audience'))
  if (beamerPraesentation) {
    const wand = await Sitzung.verbinde(beamerPraesentation.webSocketDebuggerUrl)
    await wand.sende('Page.enable')
    await wand.sende('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false
    })
    await warte(1500)
    await wand.aufnehmen('16-beamer-praesentation')
    wand.schliessen()
  }

  const steuerung = (await ziele()).find((z) => z.url.includes('prompter'))
  if (steuerung) {
    const vortrag = await Sitzung.verbinde(steuerung.webSocketDebuggerUrl)
    await vortrag.sende('Page.enable')
    await vortrag.sende('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 810, deviceScaleFactor: 1, mobile: false
    })
    await warte(2000)
    await vortrag.aufnehmen('17-vortragssteuerung')
    vortrag.schliessen()
  } else {
    console.log('  Hinweis: Vortragssteuerung nicht geöffnet – Ansicht übersprungen.')
  }

  /* Die Bibliothek in der Bedienoberfläche. */
  await sitzung.auswerten("window.location.hash = '#/beamer'")
  await warte(1500)
  await reiterOeffnen(sitzung, 'Präsentation & Video')
  await warte(1200)
  await sitzung.aufnehmen('18-praesentationen')

  /* ------------------------------------------------------------- Video */
  console.log('Video …')
  await sitzung.auswerten(`(async () => {
    const ruf = (m, ...a) => window.votura.invoke(m, ...a)
    await ruf('projection.setMode', { mode: 'video', videoId: '${VIDEO_ID}' })
    await new Promise((f) => setTimeout(f, 2500))
    await ruf('video.setPlaying', true)
    await new Promise((f) => setTimeout(f, 2500))
    await ruf('video.setPlaying', false)
    return true
  })()`)
  await warte(1500)

  const beamerVideo = (await ziele()).find((z) => z.url.includes('audience'))
  if (beamerVideo) {
    const wand = await Sitzung.verbinde(beamerVideo.webSocketDebuggerUrl)
    await wand.sende('Page.enable')
    await wand.sende('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false
    })
    await warte(1500)
    await wand.aufnehmen('19-beamer-video')
    wand.schliessen()
  }

  await sitzung.auswerten("window.location.hash = '#/beamer'")
  await warte(1500)
  await reiterOeffnen(sitzung, 'Präsentation & Video')
  await warte(1200)
  await sitzung.auswerten(
    "(() => { const k = Array.from(document.querySelectorAll('h2, h3')).find((x) => (x.textContent || '').trim() === 'Videos'); if (k) k.scrollIntoView({ block: 'start' }); return true })()"
  )
  await warte(900)
  await sitzung.aufnehmen('20-videosteuerung')

  /*
   * **Der Einlass, die Ausgabe und die digitale Wahl.**
   *
   * Drei Seiten, die es bei den ersten Aufnahmen noch nicht gab — und genau
   * die drei, nach denen jemand sucht, der wissen will, ob Votura auch die
   * Anwesenheit führt. Ein Bildschirmfoto, das eine Fassung zurückliegt, ist
   * schlimmer als keines: Es zeigt eine Anwendung, die es nicht mehr gibt.
   */
  console.log('Einlass und Ausgabe …')
  await sitzung.auswerten("window.location.hash = '#/akkreditierung'")
  await warte(1800)
  await nachOben(sitzung)
  await sitzung.aufnehmen('26-akkreditierung')

  /* Ausgabe und digitale Wahl stellen erst den Wahlgang zur Wahl. Ohne Klick
     fotografierte das Werkzeug eine leere Seite mit vier Knöpfen. */
  for (const [pfad, datei] of [
    ['ausgabe', '27-ausgabe'],
    ['digitalewahl', '28-digitale-wahl']
  ]) {
    await sitzung.auswerten(`window.location.hash = '#/${pfad}'`)
    await warte(1600)
    await klickeKnopf(sitzung, 'Wahl des Schriftführers')
    await warte(1600)
    await nachOben(sitzung)
    await sitzung.aufnehmen(datei)
  }

  /*
   * Der Wahlgang-Assistent.
   *
   * Der erste Schritt, den jemand tut, der einen Wahlgang anlegt — und auf
   * der Anleitungsseite der einzige Schritt ohne Bild. Eine halb leere Seite
   * neben dem Text sieht aus, als fehle etwas. Es fehlte auch.
   */
  await sitzung.auswerten("window.location.hash = '#/round/new'")
  await warte(1800)
  await nachOben(sitzung)
  await sitzung.aufnehmen('30-wahlgang-anlegen')

  /* Das Saalnetz: Namensdienst, Adressvergabe, Zertifikat. */
  await sitzung.auswerten("window.location.hash = '#/settings'")
  await warte(1000)
  await reiterOeffnen(sitzung, 'Saalnetz')
  await warte(1200)
  await sitzung.aufnehmen('29-saalnetz')

  /* Die Bühnen — mehr als eine Leinwand ist der Grund für diese Ansicht. */
  console.log('Bühnen und Prompter …')
  await sitzung.auswerten("window.location.hash = '#/beamer'")
  await warte(1400)
  await reiterOeffnen(sitzung, 'Ausgabe & Netz')
  await warte(1200)
  await sitzung.aufnehmen('23-buehnen')

  /* Die Bedienung des Prompters — mit aufgelegter Rede und Zuordnung. */
  await sitzung.auswerten("window.location.hash = '#/prompter'")
  await warte(1600)
  await sitzung.aufnehmen('25-prompter-bedienung')

  /*
   * Das Pult selbst.
   *
   * Es ist ein eigenes Fenster; geöffnet wird es über denselben Weg wie in
   * der Bedienung. Der Lauf wird dabei angehalten — ein Text, der während der
   * Aufnahme weiterrollt, steht auf jedem Foto woanders.
   */
  await sitzung.auswerten("window.votura.invoke('prompter.openWindow')")
  await warte(2500)
  await sitzung.auswerten("window.votura.invoke('prompter.setRunning', false)")
  const pultZiel = (await ziele()).find((z) => z.url.includes('teleprompter'))
  if (pultZiel) {
    const pult = await Sitzung.verbinde(pultZiel.webSocketDebuggerUrl)
    await pult.sende('Page.enable')
    await pult.sende('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 720, deviceScaleFactor: 1, mobile: false
    })
    await warte(1500)
    await pult.aufnehmen('24-teleprompter')
    pult.schliessen()
  } else {
    console.log('  Hinweis: Prompterfenster nicht gefunden – 24-teleprompter übersprungen.')
  }

  sitzung.schliessen()
  console.log('Fertig.')
} finally {
  app.kill()
}
