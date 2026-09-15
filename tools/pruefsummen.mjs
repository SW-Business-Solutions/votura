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
 * **Und nur die Pakete dieser Veröffentlichung.** Die Ordner `release`,
 * `release-saal` und `release-pi` sammeln an: Nach einem Jahr liegen dort
 * fünf Fassungen nebeneinander. Eine Prüfsummenliste, die alle nennt, ist
 * nicht falsch, aber sie lädt zum Irrtum ein — wer eine Zeile für
 * `Votura-1.3.0-…` findet, hält eine alte Datei für aktuell. Bis 1.5.0 wurde
 * die Liste deshalb von Hand gekürzt; das ist genau die Art Handgriff, die
 * einmal vergessen wird.
 *
 * Format je Zeile:  <sha512 base64>  <dateiname>
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

/**
 * Die Pakete dieses Laufs — erkennbar an der Versionsnummer im Dateinamen.
 *
 * `Votura-1.6.0-x64-Setup.zip` bleibt draußen: Das Archiv entsteht als
 * Nebenprodukt des Installationsprogramms und wird nicht veröffentlicht. Eine
 * Prüfsumme für eine Datei, die niemand laden kann, ist nur Länge.
 */
const paket = new RegExp(`-${version.replace(/\./g, '\\.')}-.*(\\.exe$|\\.tar\\.gz$)`, 'i')

/**
 * Die Pi-Abbilder ziehen nicht jede Fassung mit.
 *
 * Ein Abbild zu bauen dauert Stunden und braucht einen ARM-Rechner; solange
 * sich am Betriebssystem nichts ändert, wird das jüngste weiter ausgeliefert.
 * Es trägt deshalb eine **andere** Nummer als die Anwendung — hier zählt also
 * nicht die laufende Fassung, sondern je Rolle das jüngste Abbild.
 */
function juengsteAbbilder(namen) {
  const nummer = (name) => (name.match(/-(\d+\.\d+\.\d+)-/)?.[1] ?? '0.0.0').split('.').map(Number)
  const juenger = (a, b) => {
    const [x, y] = [nummer(a), nummer(b)]
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
    return false
  }
  const beste = new Map()
  for (const name of namen.filter((datei) => /\.img\.xz$/i.test(datei))) {
    // Die Rolle ist alles vor der Nummer: `votura-` oder `votura-saal-`.
    const rolle = name.slice(0, name.search(/-\d+\.\d+\.\d+-/))
    const bisher = beste.get(rolle)
    if (!bisher || juenger(name, bisher)) beste.set(rolle, name)
  }
  return [...beste.values()].sort()
}

const zeilen = []
const summe = (ordner, name) =>
  createHash('sha512').update(readFileSync(join(ordner, name))).digest('base64')

for (const ordner of ['release', 'release-saal']) {
  if (!existsSync(ordner)) continue
  for (const name of readdirSync(ordner).filter((datei) => paket.test(datei)).sort()) {
    console.log(`  ${name}`)
    zeilen.push(`${summe(ordner, name)}  ${name}`)
  }
}

if (existsSync('release-pi')) {
  for (const name of juengsteAbbilder(readdirSync('release-pi'))) {
    console.log(`  ${name}`)
    zeilen.push(`${summe('release-pi', name)}  ${name}`)
  }
}

if (zeilen.length === 0) {
  console.error(`Keine Pakete zur Fassung ${version} gefunden — wurde schon gebaut?`)
  process.exit(1)
}

writeFileSync(join('release', 'pruefsummen.txt'), zeilen.join('\n') + '\n', 'utf8')
console.log(`geschrieben: release/pruefsummen.txt (${zeilen.length} Dateien, Fassung ${version})`)
