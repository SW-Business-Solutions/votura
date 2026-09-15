/**
 * Das Sprachmodell für das Mitlaufen nach Gehör.
 *
 * ## Zwei Orte, eine Reihenfolge
 *
 * Zuerst wird im Benutzerordner nachgesehen, dann in den Programmressourcen.
 * So schlägt ein selbst hinterlegtes Modell immer das mitgelieferte: Wer für
 * einen halligen Saal oder starken Dialekt ein größeres einspielt, muss dafür
 * nichts austauschen und nichts löschen — und ein Programmwechsel nimmt es
 * ihm auch nicht wieder weg.
 *
 * ## Warum ein Archiv und kein Ordner
 *
 * Die Erkennung läuft im Browserteil und packt das Modell dort selbst aus. Sie
 * bekommt deshalb genau eine Datei ausgeliefert. Das erspart es, tausend
 * kleine Dateien einzeln über ein Protokoll zu reichen — und macht das
 * Hinterlegen zu einem einzigen Handgriff.
 */
import { app } from 'electron'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SprachmodellInfo } from '@shared/sprachmodell'
import {
  BEKANNTE_MODELLE,
  modellAdresse,
  type ModellLadestand
} from '@shared/sprachmodell-angebot'
import { appPaths } from '../paths'
import { logger } from '../logger'
import { appendAudit } from './audit'
import { getSession } from './auth'

/** Erlaubte Archive — mehr kann die Erkennung nicht auspacken. */
const ENDUNGEN = /^\.(zip|gz|tgz)$/i

function eigenerOrdner(): string {
  const ziel = join(appPaths().root, 'sprachmodell')
  if (!existsSync(ziel)) mkdirSync(ziel, { recursive: true })
  return ziel
}

function paketOrdner(): string[] {
  /* Im gepackten Zustand liegen die Ressourcen daneben, in der Entwicklung im
     Projektordner. Beide Orte werden geprüft, damit sich das Modell auch beim
     Entwickeln benutzen lässt. */
  return [
    join(process.resourcesPath ?? '', 'sprachmodell'),
    join(app.getAppPath(), 'resources', 'sprachmodell'),
    join(app.getAppPath(), '..', 'resources', 'sprachmodell')
  ]
}

/**
 * Das Modell, das in diesem Ordner gilt — das **jüngste**.
 *
 * Eigentlich liegt dort immer nur eines. „Eigentlich" ist hier das Problem
 * gewesen: Bis zu einer Fassung wurde alphabetisch sortiert und das erste
 * genommen. Solange das Aufräumen klappt, macht das keinen Unterschied —
 * klappt es einmal nicht, entscheidet der Anfangsbuchstabe, welches Modell
 * die Anwendung benutzt.
 *
 * Genau das ist passiert: Ein altes Archiv ließ sich nicht löschen, weil die
 * Erkennung es noch offen hielt. Übrig blieben zwei Dateien, und
 * `vosk-model-de-…` steht nun einmal vor `vosk-model-small-de-…`. Die
 * Anwendung benutzte hartnäckig das alte, während die Oberfläche das neue
 * meldete.
 *
 * Nach Zeit zu wählen ist die Antwort, die auch dann noch stimmt, wenn das
 * Aufräumen scheitert: Was zuletzt hinterlegt wurde, gilt.
 */
function ersteDateiIn(ordner: string): string | undefined {
  if (!existsSync(ordner)) return undefined
  const treffer = readdirSync(ordner)
    .filter((name) => ENDUNGEN.test(extname(name)))
    .map((name) => join(ordner, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (treffer.length > 1) {
    logger.warn(
      `Im Sprachmodellordner liegen ${treffer.length} Archive; es gilt das jüngste: ${basename(treffer[0])}`
    )
  }
  return treffer[0]
}

/** Der Pfad des Modells, das gelten soll — eigenes vor mitgeliefertem. */
export function sprachmodellDatei(): { pfad: string; herkunft: 'paket' | 'eigen' } | undefined {
  const eigen = ersteDateiIn(eigenerOrdner())
  if (eigen) return { pfad: eigen, herkunft: 'eigen' }
  for (const ordner of paketOrdner()) {
    const paket = ersteDateiIn(ordner)
    if (paket) return { pfad: paket, herkunft: 'paket' }
  }
  return undefined
}

export function sprachmodellInfo(): SprachmodellInfo {
  const gefunden = sprachmodellDatei()
  if (!gefunden) return { vorhanden: false }
  return {
    vorhanden: true,
    name: basename(gefunden.pfad),
    bytes: statSync(gefunden.pfad).size,
    herkunft: gefunden.herkunft
  }
}

/**
 * Legt ein eigenes Modell ab.
 *
 * Es wird **kopiert**, nicht verknüpft: Der Stick, von dem es kam, ist im Saal
 * längst wieder in der Tasche — dieselbe Überlegung wie bei Präsentationen.
 */
export function sprachmodellEinlegen(quelle: string): SprachmodellInfo {
  if (!existsSync(quelle)) throw new Error('Die Datei gibt es nicht mehr.')
  if (!ENDUNGEN.test(extname(quelle))) {
    throw new Error('Erwartet wird ein Modellarchiv (.zip, .tar.gz oder .tgz).')
  }
  const ordner = eigenerOrdner()
  /* Nur eines gleichzeitig: Zwei Modelle nebeneinander wären eine Frage, die
     niemand am Pult beantworten will. */
  for (const alt of readdirSync(ordner)) rmSync(join(ordner, alt), { force: true })
  copyFileSync(quelle, join(ordner, basename(quelle)))

  const session = getSession()
  appendAudit({
    action: 'speechmodel.installed',
    userId: session?.user.id,
    userName: session?.user.displayName,
    newValue: { datei: basename(quelle), bytes: statSync(quelle).size }
  })
  logger.info(`Sprachmodell hinterlegt: ${basename(quelle)}`)
  return sprachmodellInfo()
}

/** Nimmt das eigene Modell wieder weg — das mitgelieferte bleibt. */
export function sprachmodellEntfernen(): SprachmodellInfo {
  const ordner = eigenerOrdner()
  for (const alt of readdirSync(ordner)) rmSync(join(ordner, alt), { force: true })

  const session = getSession()
  appendAudit({
    action: 'speechmodel.removed',
    userId: session?.user.id,
    userName: session?.user.displayName
  })
  return sprachmodellInfo()
}

/**
 * Ein bekanntes Modell aus dem Netz nachladen.
 *
 * ## Der einzige Weg nach draußen in dieser Datei
 *
 * Votura läuft offline; diese Funktion ist die Ausnahme, und sie ist eng
 * gefasst. Geladen wird **nur** auf ausdrücklichen Klick, **nur** ein Eintrag
 * aus `BEKANNTE_MODELLE`, und die Adresse wird aus dem Dateinamen gebaut
 * statt entgegengenommen. Eine Adresse als Argument wäre eine offene Tür:
 * Wer sie aufrufen kann, ließe das Programm sonst beliebige Dateien holen.
 *
 * ## Erst prüfen, dann tauschen
 *
 * Geschrieben wird unter einem Arbeitsnamen. Erst wenn Größe und — soweit
 * hinterlegt — Prüfsumme stimmen, tritt das neue Modell an die Stelle des
 * alten. Bricht die Leitung nach vierzig von fünfzig Megabyte ab, bleibt das
 * vorhandene Modell unangetastet; ein halbes Archiv fiele sonst erst am Pult
 * auf, wenn jemand auf „Nach Stimme" schaltet.
 */
/**
 * Sagt, was wirklich schiefging.
 *
 * `fetch` wirft bei jeder Störung der Leitung dieselben zwei Wörter: „fetch
 * failed". Der eigentliche Grund — Namensauflösung, Zeitablauf, abgewiesene
 * Verbindung, ein Zertifikat — steckt in `cause`, und zwar mitunter zwei
 * Ebenen tief.
 *
 * Das ist kein Schönheitsfehler: Eine Meldung, die nichts sagt, macht aus
 * einem Netzproblem eine Suche im Dunkeln — erlebt an genau dieser Stelle.
 */
function grund(fehler: unknown): string {
  const teile: string[] = []
  let aktuell: unknown = fehler
  for (let tiefe = 0; aktuell instanceof Error && tiefe < 4; tiefe++) {
    const code = (aktuell as NodeJS.ErrnoException).code
    const text = aktuell.message || aktuell.name
    teile.push(code && !text.includes(code) ? `${text} (${code})` : text)
    aktuell = (aktuell as { cause?: unknown }).cause
  }
  if (teile.length === 0) return String(fehler)
  return teile.join(' — ')
}

/**
 * Holt die Antwort — und versucht es bei einer gestörten Leitung ein zweites
 * Mal.
 *
 * Nicht aus Hartnäckigkeit: Eine Verbindung, die zwischen zwei Abrufen
 * offengehalten und vom Gegenüber inzwischen geschlossen wurde, scheitert
 * beim ersten Schreiben und beim zweiten nicht mehr. Ein einzelner erneuter
 * Versuch fängt genau das ab. Antwortet der Server dagegen mit einem Fehler,
 * wird nichts wiederholt — dann liegt es nicht an der Leitung.
 */
async function holeMitZweitemVersuch(adresse: string): Promise<Response> {
  try {
    return await fetch(adresse)
  } catch (erster) {
    logger.warn(`Sprachmodell: erster Versuch gescheitert (${grund(erster)}) — noch einmal`)
    await new Promise((weiter) => setTimeout(weiter, 500))
    return fetch(adresse)
  }
}

export async function sprachmodellLaden(
  datei: string,
  aufFortschritt?: (stand: ModellLadestand) => void
): Promise<SprachmodellInfo> {
  const angebot = BEKANNTE_MODELLE.find((eintrag) => eintrag.datei === datei)
  if (!angebot) throw new Error(`Unbekanntes Sprachmodell: ${datei}`)

  const ordner = eigenerOrdner()
  const arbeitsdatei = join(ordner, `${angebot.datei}.teil`)
  rmSync(arbeitsdatei, { force: true })

  const melde = (geladen: number, rest?: Partial<ModellLadestand>): void =>
    aufFortschritt?.({ datei: angebot.datei, geladen, bytes: angebot.bytes, ...rest })

  melde(0)
  logger.info(`Sprachmodell wird geladen: ${angebot.datei} (${angebot.bytes} Bytes)`)

  try {
    const antwort = await holeMitZweitemVersuch(modellAdresse(angebot))
    if (!antwort.ok || !antwort.body) {
      throw new Error(`Der Server antwortete mit ${antwort.status} ${antwort.statusText}.`)
    }

    const hash = createHash('sha256')
    let geladen = 0
    let zuletztGemeldet = 0
    const ziel = createWriteStream(arbeitsdatei)

    await pipeline(
      Readable.fromWeb(antwort.body as Parameters<typeof Readable.fromWeb>[0]),
      async function* (quelle) {
        for await (const stueck of quelle) {
          const block = stueck as Buffer
          hash.update(block)
          geladen += block.length
          /* Nicht bei jedem Block melden: Bei 64 KB je Block wären das
             achthundert Meldungen für ein kleines Modell. */
          if (geladen - zuletztGemeldet > 1_000_000) {
            zuletztGemeldet = geladen
            melde(geladen)
          }
          yield block
        }
      },
      ziel
    )

    if (geladen !== angebot.bytes) {
      throw new Error(`Unerwartete Größe: ${geladen} statt ${angebot.bytes} Bytes.`)
    }

    const gerechnet = hash.digest('hex')
    if (angebot.sha256 && gerechnet !== angebot.sha256) {
      throw new Error(`Die Prüfsumme stimmt nicht: ${gerechnet} statt ${angebot.sha256}.`)
    }
    if (!angebot.sha256) {
      /* Ohne hinterlegte Prüfsumme wenigstens festhalten, was angekommen ist —
         wer sie beim Anbieter vergleichen will, findet sie im Protokoll. */
      logger.info(`Sprachmodell ${angebot.datei}: SHA-256 der geladenen Datei ${gerechnet}`)
    }

    /*
     * Erst jetzt das alte weg — und ein Scheitern dabei nicht verschweigen.
     *
     * Unter Windows lässt sich eine Datei nicht löschen, die noch jemand
     * offen hält, und die Erkennung hält das laufende Modell offen. Das
     * schlug hier still fehl: Zwei Archive blieben liegen, und die Anwendung
     * benutzte weiter das alte, während die Oberfläche das neue meldete.
     *
     * Bleiben kann es trotzdem — `ersteDateiIn` wählt nach Zeit, das neue
     * gewinnt also. Aber im Protokoll soll stehen, dass aufgeräumt werden
     * muss.
     */
    renameSync(arbeitsdatei, join(ordner, angebot.datei))
    for (const alt of readdirSync(ordner)) {
      if (alt === angebot.datei) continue
      try {
        rmSync(join(ordner, alt), { force: true })
      } catch (nichtLoeschbar) {
        logger.warn(
          `Altes Sprachmodell ${alt} ließ sich nicht entfernen (${grund(nichtLoeschbar)}) — es gilt trotzdem das neue.`
        )
      }
    }

    const session = getSession()
    appendAudit({
      action: 'speechmodel.installed',
      userId: session?.user.id,
      userName: session?.user.displayName,
      newValue: {
        datei: angebot.datei,
        bytes: angebot.bytes,
        herkunft: modellAdresse(angebot),
        sha256: gerechnet,
        geprueft: angebot.sha256 ? 'Größe und Prüfsumme' : 'nur Größe'
      }
    })
    logger.info(`Sprachmodell geladen und geprüft: ${angebot.datei}`)
    melde(angebot.bytes, { fertig: true })
    return sprachmodellInfo()
  } catch (fehler) {
    rmSync(arbeitsdatei, { force: true })
    const text = grund(fehler)
    logger.warn(`Sprachmodell ${angebot.datei} nicht geladen: ${text}`)
    melde(0, { fehler: text })
    throw new Error(`${angebot.name} konnte nicht geladen werden: ${text}`)
  }
}
