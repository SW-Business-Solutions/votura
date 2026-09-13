/**
 * Schreibt die Prüfsummen der erzeugten Programmdateien nach
 * release/pruefsummen.txt.
 *
 * Die `latest.yml` des Herstellungslaufs enthält nur die Prüfsumme des
 * Installationsprogramms. Die portable Fassung braucht ebenfalls eine, sonst
 * ließe sich nicht feststellen, ob die geladene Datei unverändert ist.
 *
 * Alle Pakete kommen in **eine** Liste: Begleitanwendung und Pi-Abbild
 * entstehen in eigenen Läufen und liegen deshalb woanders — wer eine Datei
 * prüft, will aber nicht wissen, aus welchem Lauf sie stammt.
 *
 * Format je Zeile:  <sha512 base64>  <dateiname>
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ORDNER = ['release', 'release-saal', 'release-pi']

const zeilen = []
for (const ordner of ORDNER) {
  if (!existsSync(ordner)) continue
  const paket = /\.(exe|zip|deb|AppImage)$|\.tar\.gz$|\.img\.xz$/i
  for (const name of readdirSync(ordner).filter((datei) => paket.test(datei))) {
    const summe = createHash('sha512').update(readFileSync(join(ordner, name))).digest('base64')
    console.log(`  ${name}`)
    zeilen.push(`${summe}  ${name}`)
  }
}

writeFileSync(join('release', 'pruefsummen.txt'), zeilen.join('\n') + '\n', 'utf8')
console.log(`geschrieben: release/pruefsummen.txt (${zeilen.length} Dateien)`)
