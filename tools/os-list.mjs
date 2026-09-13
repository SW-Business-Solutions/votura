/**
 * Erzeugt das Verzeichnis für den Raspberry Pi Imager.
 *
 * Damit erscheint Votura Saal dort in der Liste wie ein offizielles Abbild:
 *
 *   rpi-imager --repo https://www.getvotura.de/pi/os-list.json
 *
 * Der Imager braucht Angaben, die erst nach dem Bauen feststehen — die Größe
 * des ausgepackten Abbilds und dessen Prüfsumme. Er benutzt beides, um den
 * Fortschritt anzuzeigen und die geschriebene Karte gegenzuprüfen; falsche
 * Werte fallen erst am Ende eines langen Schreibvorgangs auf.
 *
 * Aufruf:
 *   node tools/os-list.mjs release-pi/votura-saal-1.2.0-arm64.img.xz
 */
import { createHash } from 'node:crypto'
import { statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

const VERWEIS = 'https://github.com/SW-Business-Solutions/votura/releases/download'
const SYMBOL = 'https://www.getvotura.de/marke/icon.png'
const WEBSEITE = 'https://www.getvotura.de'

const datei = process.argv[2]
if (!datei) {
  console.error('Aufruf: node tools/os-list.mjs <abbild.img.xz>')
  process.exit(2)
}

/**
 * Prüfsumme und Größe des **ausgepackten** Abbilds.
 *
 * Beides in einem Durchlauf und ohne die Datei irgendwo abzulegen: Ein
 * ausgepacktes Pi-Abbild wiegt mehrere Gigabyte, und es nur zum Zählen auf
 * die Platte zu schreiben wäre Verschwendung.
 */
function ausgepackt(pfad) {
  return new Promise((fertig, fehler) => {
    const hash = createHash('sha256')
    let bytes = 0
    /* `xz -dc` statt einer Bibliothek: xz gibt es auf jedem System, das
       dieses Abbild überhaupt bauen kann. */
    const xz = spawn('xz', ['-dc', pfad])
    xz.stdout.on('data', (stueck) => {
      bytes += stueck.length
      hash.update(stueck)
    })
    xz.on('error', fehler)
    xz.on('close', (code) => {
      if (code !== 0) fehler(new Error(`xz endete mit ${code}`))
      else fertig({ bytes, sha256: hash.digest('hex') })
    })
  })
}

const name = basename(datei)
const version = /(\d+\.\d+\.\d+)/.exec(name)?.[1] ?? '0.0.0'
const geladen = statSync(datei).size

console.log('Lese das ausgepackte Abbild …')
const roh = await ausgepackt(datei)

const verzeichnis = {
  os_list: [
    {
      name: 'Votura Saal',
      description:
        'Bühne oder Prompter für eine Versammlung mit Votura. Findet den Hauptrechner beim Start selbst im Netz.',
      icon: SYMBOL,
      url: `${VERWEIS}/v${version}/${name}`,
      extract_size: roh.bytes,
      extract_sha256: roh.sha256,
      image_download_size: geladen,
      release_date: new Date().toISOString().slice(0, 10),
      /* Pi 4 und Pi 5. Der Pi 3 fehlt mit Absicht: Electron gibt es nicht
         mehr für armv7, und Chromium auf 1 GB RAM ist für eine Wand, die
         stundenlang läuft, zu knapp. */
      devices: ['pi4-64bit', 'pi5-64bit'],
      website: WEBSEITE,
      architecture: 'arm64',
      /* Keine Erstschritte: Es gibt keinen Desktop, und die Fragen nach
         Sprache und Benutzer beantwortet im Saal niemand. */
      init_format: 'none'
    }
  ]
}

const ziel = join(dirname(datei), 'os-list.json')
writeFileSync(ziel, JSON.stringify(verzeichnis, null, 2) + '\n', 'utf8')

console.log(`geschrieben: ${ziel}`)
console.log(`  ausgepackt:  ${(roh.bytes / 1024 / 1024 / 1024).toFixed(2)} GB`)
console.log(`  SHA-256:     ${roh.sha256}`)
console.log(`  Download:    ${(geladen / 1024 / 1024).toFixed(0)} MB`)
