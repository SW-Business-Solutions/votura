/**
 * Macht aus `NUTZUNGSBEDINGUNGEN.md` den Text, den das
 * Installationsprogramm anzeigt: `build/nutzungsbedingungen.txt`.
 *
 * Warum überhaupt eine zweite Fassung? Das NSIS-Installationsprogramm zeigt
 * eine Lizenzdatei wörtlich an — Markdown erschiene dort mit Sternchen,
 * Rauten und eckigen Klammern. Wer eine Vereinbarung zum Zustimmen vorgelegt
 * bekommt, soll sie lesen können und nicht Auszeichnungssprache entziffern.
 *
 * Die Quelle bleibt die Markdown-Datei — **eine** Stelle, an der der Text
 * gepflegt wird. Zwei getrennt gepflegte Fassungen derselben Bedingungen
 * wären genau die Art Fehler, die niemandem auffällt, bis sie sich
 * widersprechen.
 *
 * Die Umwandlung ist absichtlich stumpf: Auszeichnung weg, Verweise als
 * „Text (Adresse)", Zitatstriche zu Einrückung. Kein Markdown-Paket dafür —
 * die Datei kennt ein halbes Dutzend Formen, und die stehen hier.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const quelle = readFileSync('NUTZUNGSBEDINGUNGEN.md', 'utf8')

const zeilen = []
let inPunkt = false
for (let zeile of quelle.split(/\r?\n/)) {
  // Trennlinien: im Fließtext hilfreich, in einer Textdatei nur Striche.
  if (/^---+$/.test(zeile)) {
    zeilen.push('')
    continue
  }

  // Überschriften ohne Rauten; die erste bleibt als Titel stehen.
  zeile = zeile.replace(/^#{1,6}\s+/, '')

  // Zitatblöcke werden eingerückt statt mit Größerzeichen markiert.
  zeile = zeile.replace(/^>\s?/, '    ')

  // [Text](Adresse) → Text (Adresse), aber nur bei einer Adresse, die
  // jemand eintippen kann. Ein Verweis auf eine andere Stelle derselben
  // Sammlung — `README.md#lizenz` — hilft in einer Textdatei niemandem und
  // bliebe als Klammerwerk stehen.
  zeile = zeile.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)')
  zeile = zeile.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')

  // Fettes, Kursives, Code — die Auszeichner weg, der Text bleibt.
  zeile = zeile.replace(/\*\*([^*]+)\*\*/g, '$1')
  zeile = zeile.replace(/(^|[\s(])\*([^*]+)\*/g, '$1$2')
  zeile = zeile.replace(/`([^`]+)`/g, '$1')

  // Aufzählungsstriche zu Gedankenstrichen mit Einzug. Umgebrochene
  // Folgezeilen rücken mit ein — sonst stünde die zweite Hälfte eines
  // Punktes linksbündig unter dem nächsten und läse sich wie ein eigener.
  if (/^\s*-\s+/.test(zeile)) {
    zeile = zeile.replace(/^(\s*)-\s+/, '$1  - ')
    inPunkt = true
  } else if (zeile.trim() === '' || /^\s*\d+\.\s/.test(zeile)) {
    inPunkt = false
  } else if (inPunkt) {
    zeile = '    ' + zeile.trimStart()
  }

  zeilen.push(zeile)
}

// Windows-Zeilenenden: Die Datei wird in einem Windows-Installationsprogramm
// angezeigt, und dessen Textfeld kennt einzelne Zeilenvorschübe nicht.
const text = zeilen.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'

mkdirSync('build', { recursive: true })
writeFileSync(join('build', 'nutzungsbedingungen.txt'), text.replace(/\n/g, '\r\n'), 'utf8')
console.log(`geschrieben: build/nutzungsbedingungen.txt (${text.split('\n').length} Zeilen)`)
