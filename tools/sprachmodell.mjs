/**
 * Holt das kleine deutsche Sprachmodell für den Teleprompter.
 *
 * ## Warum nicht im Repository
 *
 * Das Modell wiegt rund 45 MB und ändert sich nie. In Git läge es für immer
 * in jeder Kopie der Geschichte — auch in der von Leuten, die den Prompter
 * gar nicht benutzen. Es wird deshalb beim Bauen einmal geholt, unter
 * `resources/` abgelegt und von dort ins Paket gelegt.
 *
 * ## Warum ein kleines Modell reicht
 *
 * Der Prompter muss nicht diktieren, sondern **wiederfinden**: Der Text steht
 * bereits da, gesucht wird nur die Stelle. Dafür genügen wenige halbwegs
 * erkannte Wörter. Ein großes Modell brächte bessere Transkripte, aber keine
 * bessere Stelle — und 1,5 GB, die niemand auf einem Stick haben will.
 *
 * Wer mehr braucht (starker Dialekt, halliger Saal), kann in den
 * Einstellungen ein größeres Modell nachlegen.
 *
 * Aufruf:  node tools/sprachmodell.mjs [--erneut]
 */
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const ZIEL = join(WURZEL, 'resources', 'sprachmodell')
const DATEI = join(ZIEL, 'vosk-model-small-de-0.15.zip')

/**
 * Quelle und Prüfsumme.
 *
 * Die Prüfsumme ist keine Förmlichkeit: Ein halb heruntergeladenes Archiv
 * fällt sonst erst am Pult auf, wenn jemand auf „Nach Stimme" schaltet.
 */
const QUELLE = 'https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip'
const BYTES = 46_499_967
const SHA256 = 'b7e53c90b1f0a38456f4cd62b366ecd58803cd97cd42b06438e2c131713d5e43'

function pruefsumme(daten) {
  return createHash('sha256').update(daten).digest('hex')
}

async function main() {
  if (process.argv.includes('--erneut') && existsSync(DATEI)) rmSync(DATEI)

  if (existsSync(DATEI) && statSync(DATEI).size === BYTES) {
    console.log(`Sprachmodell liegt bereits: ${DATEI}`)
    return
  }

  mkdirSync(ZIEL, { recursive: true })
  console.log(`Lade Sprachmodell (${(BYTES / 1024 / 1024).toFixed(0)} MB) …`)

  const antwort = await fetch(QUELLE)
  if (!antwort.ok || !antwort.body) {
    throw new Error(`Herunterladen fehlgeschlagen: ${antwort.status} ${antwort.statusText}`)
  }
  await pipeline(Readable.fromWeb(antwort.body), createWriteStream(DATEI))

  const groesse = statSync(DATEI).size
  if (groesse !== BYTES) {
    rmSync(DATEI)
    throw new Error(`Unerwartete Größe: ${groesse} statt ${BYTES} Bytes.`)
  }

  const gerechnet = pruefsumme(await readFile(DATEI))
  if (gerechnet !== SHA256) {
    rmSync(DATEI)
    throw new Error(`Prüfsumme stimmt nicht: ${gerechnet} statt ${SHA256}.`)
  }
  console.log(`Fertig: ${DATEI} (SHA-256 geprüft)`)
}

main().catch((fehler) => {
  console.error(String(fehler))
  process.exitCode = 1
})
