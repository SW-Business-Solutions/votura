/**
 * Setzt in einem fertigen Linux-Archiv die Ausführungsrechte richtig.
 *
 * Hergestellt wird unter Windows, und NTFS kennt kein Ausführungsrecht. Was
 * electron-builder dort in ein `tar.gz` schreibt, trägt darum durchgehend
 * `rw-r--r--` — auch die Programmdatei. Wer das Archiv unter Linux auspackt,
 * bekommt `Permission denied`, und am Raspberry Pi bricht die Einrichtung ab
 * mit „Im Archiv fehlt die Programmdatei".
 *
 * Statt die Archive nachzubauen wird nur das **Rechtefeld** jedes Eintrags
 * überschrieben und die Kopfprüfsumme neu gerechnet; jedes Byte Inhalt bleibt,
 * wo es war. Das kann nichts verlieren — ein Neubau könnte es.
 *
 * Woran erkannt wird, was ausführbar sein muss: an der **ELF-Kennung** am
 * Dateianfang. Programme und Bibliotheken tragen sie, Daten nicht. Eine Liste
 * von Dateinamen wäre bei der nächsten Electron-Fassung still veraltet.
 *
 * Aufruf:
 *   node tools/linux-rechte.mjs        # alle Archive der Herstellungsordner
 *   node tools/linux-rechte.mjs pfad/zum/archiv.tar.gz
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const BLOCK = 512

/** Ordner mit Herstellungsergebnissen — der Hauptrechner und die Begleitanwendung. */
const ORDNER = ['release', 'release-saal']

/**
 * `chrome-sandbox` bekommt zusätzlich das setuid-Bit.
 *
 * Ubuntu 24.04 verbietet unprivilegierte User-Namespaces für nicht
 * eingeschränkte Programme; ohne diesen Helfer startet Chromium dort nicht.
 * Beim Auspacken als gewöhnlicher Benutzer fällt das Bit ohnehin weg, es
 * schadet also niemandem — und wer nach `/opt` als root auspackt, hat eine
 * funktionierende Sandbox. Der Pi umgeht sie mit `--no-sandbox`.
 */
const SANDBOX = 0o4755
const AUSFUEHRBAR = 0o755
const LESBAR = 0o644

const octal = (wert, stellen) => wert.toString(8).padStart(stellen - 1, '0') + '\0'

/** Ist der Block ausschließlich mit Nullen gefüllt? Dann ist das Archiv zu Ende. */
function leer(kopf) {
  for (const byte of kopf) if (byte !== 0) return false
  return true
}

/**
 * Die Kopfprüfsumme, wie tar sie erwartet: Summe aller Kopfbytes, wobei das
 * Prüfsummenfeld selbst als acht Leerzeichen zählt.
 */
function pruefsumme(kopf) {
  let summe = 0
  for (let i = 0; i < BLOCK; i++) summe += i >= 148 && i < 156 ? 0x20 : kopf[i]
  return summe
}

/**
 * Geht ein ausgepacktes tar durch und setzt die Rechte neu.
 *
 * Gibt die geänderten Bytes samt einer Liste der angefassten Einträge zurück.
 * Die Länge bleibt gleich — es wird nichts eingefügt und nichts entfernt.
 */
export function richteRechte(tar) {
  const daten = Buffer.from(tar)
  const geaendert = []
  let stelle = 0

  while (stelle + BLOCK <= daten.length) {
    const kopf = daten.subarray(stelle, stelle + BLOCK)
    if (leer(kopf)) break

    const name = kopf.subarray(0, 100).toString('binary').replace(/\0.*$/, '')
    const groesse = parseInt(kopf.subarray(124, 136).toString('binary').replace(/[\0 ]/g, ''), 8) || 0
    const art = String.fromCharCode(kopf[156])
    const inhalt = stelle + BLOCK

    let recht = null
    if (art === '5') {
      recht = AUSFUEHRBAR
    } else if (art === '0' || art === '\0') {
      const elf =
        groesse >= 4 &&
        daten[inhalt] === 0x7f &&
        daten[inhalt + 1] === 0x45 &&
        daten[inhalt + 2] === 0x4c &&
        daten[inhalt + 3] === 0x46
      if (name.endsWith('/chrome-sandbox')) recht = SANDBOX
      else recht = elf || name.endsWith('.sh') ? AUSFUEHRBAR : LESBAR
    }

    if (recht !== null) {
      const alt = parseInt(kopf.subarray(100, 108).toString('binary').replace(/[\0 ]/g, ''), 8) || 0
      if ((alt & 0o7777) !== recht) {
        kopf.write(octal(recht, 8), 100, 8, 'binary')
        kopf.write(octal(pruefsumme(kopf), 7), 148, 7, 'binary')
        kopf.write(' ', 155, 1, 'binary')
        geaendert.push({ name, von: alt & 0o7777, auf: recht })
      }
    }

    stelle = inhalt + Math.ceil(groesse / BLOCK) * BLOCK
  }

  return { daten, geaendert }
}

/** Ein Archiv an Ort und Stelle richtigstellen. */
export function behandleArchiv(pfad) {
  const { daten, geaendert } = richteRechte(gunzipSync(readFileSync(pfad)))
  if (geaendert.length > 0) writeFileSync(pfad, gzipSync(daten, { level: 9 }))
  return geaendert
}

/* Nur beim direkten Aufruf laufen — die Prüfungen holen sich die Funktionen. */
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const angegeben = process.argv.slice(2)
  const archive = angegeben.length
    ? angegeben
    : ORDNER.filter((ordner) => existsSync(ordner)).flatMap((ordner) =>
        readdirSync(ordner)
          .filter((datei) => datei.endsWith('.tar.gz'))
          .map((datei) => join(ordner, datei))
      )

  if (archive.length === 0) {
    console.log('Keine Linux-Archive gefunden — nichts zu tun.')
  }

  for (const pfad of archive) {
    const geaendert = behandleArchiv(pfad)
    if (geaendert.length === 0) {
      console.log(`${pfad}: Rechte waren schon richtig`)
      continue
    }
    const programme = geaendert.filter((eintrag) => eintrag.auf !== LESBAR)
    console.log(`${pfad}: ${geaendert.length} Einträge, davon ${programme.length} ausführbar`)
    for (const eintrag of programme.slice(0, 6)) {
      console.log(`    ${eintrag.auf.toString(8)}  ${eintrag.name}`)
    }
    if (programme.length > 6) console.log(`    … und ${programme.length - 6} weitere`)
  }
}
