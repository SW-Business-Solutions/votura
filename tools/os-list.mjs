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
 *   node tools/os-list.mjs release-pi/*.img.xz
 *
 * Mehrere Abbilder ergeben mehrere Einträge in einer Datei — der Imager
 * zeigt sie dann untereinander zur Auswahl.
 */
import { createHash } from 'node:crypto'
import { statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

const VERWEIS = 'https://github.com/SW-Business-Solutions/votura/releases/download'
const SYMBOL = 'https://www.getvotura.de/marke/icon.png'
const WEBSEITE = 'https://www.getvotura.de'

const dateien = process.argv.slice(2)
if (dateien.length === 0) {
  console.error('Aufruf: node tools/os-list.mjs <abbild.img.xz> [weitere …]')
  process.exit(2)
}

/*
 * Was in welchem Abbild steckt, sagt sein Dateiname.
 *
 * Die beiden Rollen sind grundverschieden, und wer im Imager das falsche
 * wählt, merkt es erst, wenn die Karte im Gerät steckt. Der Beschreibungstext
 * muss den Unterschied also auf einen Blick klarmachen.
 */
const ROLLEN = [
  {
    passt: (name) => /^votura-saal-/.test(name),
    titel: 'Votura Saal — Bühne oder Pult',
    text: 'Für ein Gerät hinter dem Beamer oder unter dem Rednerpult. Findet den Hauptrechner beim Start selbst im Netz. Nicht der Rechner, an dem die Versammlung geführt wird.'
  },
  {
    passt: (name) => /^votura-\d/.test(name),
    titel: 'Votura — der Hauptrechner',
    text: 'Der Rechner, an dem die Versammlung geführt wird: Wahlgänge, Stimmzettel, Ergebnisse. Genau einer je Versammlung. Die Daten liegen auf der Karte — vorher und nachher sichern.'
  }
]

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

const eintraege = []
for (const datei of dateien) {
  const name = basename(datei)
  const rolle = ROLLEN.find((eintrag) => eintrag.passt(name))
  if (!rolle) {
    console.error(`Unbekanntes Abbild: ${name}`)
    process.exit(2)
  }
  const version = /(\d+\.\d+\.\d+)/.exec(name)?.[1] ?? '0.0.0'
  const geladen = statSync(datei).size

  console.log(`Lese ${name} …`)
  const roh = await ausgepackt(datei)

  eintraege.push({
    name: rolle.titel,
    description: rolle.text,
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
  })

  console.log(`  ausgepackt:  ${(roh.bytes / 1024 / 1024 / 1024).toFixed(2)} GB`)
  console.log(`  SHA-256:     ${roh.sha256}`)
  console.log(`  Download:    ${(geladen / 1024 / 1024).toFixed(0)} MB`)
}

const verzeichnis = { os_list: eintraege }

const ziel = join(dirname(dateien[0]), 'os-list.json')
writeFileSync(ziel, JSON.stringify(verzeichnis, null, 2) + '\n', 'utf8')

console.log(`geschrieben: ${ziel} (${eintraege.length} Abbilder)`)
