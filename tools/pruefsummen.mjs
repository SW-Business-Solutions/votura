/**
 * Schreibt die Prüfsummen der erzeugten Programmdateien nach
 * release/pruefsummen.txt.
 *
 * Die `latest.yml` des Herstellungslaufs enthält nur die Prüfsumme des
 * Installationsprogramms. Die portable Fassung braucht ebenfalls eine, sonst
 * ließe sich nicht feststellen, ob die geladene Datei unverändert ist.
 *
 * Format je Zeile:  <sha512 base64>  <dateiname>
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ORDNER = 'release'
const dateien = readdirSync(ORDNER).filter((name) => /\.(exe|zip)$/i.test(name))

const zeilen = dateien.map((name) => {
  const summe = createHash('sha512').update(readFileSync(join(ORDNER, name))).digest('base64')
  console.log(`  ${name}`)
  return `${summe}  ${name}`
})

writeFileSync(join(ORDNER, 'pruefsummen.txt'), zeilen.join('\n') + '\n', 'utf8')
console.log(`geschrieben: ${ORDNER}/pruefsummen.txt (${zeilen.length} Dateien)`)
