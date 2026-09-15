/**
 * Holt die NDI-Bindung für **alle** Zielplattformen.
 *
 * `grandi` liefert seine vorgebaute Bindung je Plattform in einem eigenen
 * Paket aus (`@grandi/win32-x64`, `@grandi/linux-x64`, `@grandi/linux-arm64`).
 * Diese Pakete tragen `os` und `cpu` in ihrer Beschreibung — npm installiert
 * darum auf einem Windows-Rechner nur das für Windows.
 *
 * Gebaut wird hier aber **für alle drei**: `dist:alle` erzeugt aus demselben
 * Arbeitsverzeichnis Windows- und Linux-Pakete. Ohne diesen Schritt enthielte
 * das Linux-Paket keine Bindung, und die Kameraansicht meldete dort „Die
 * NDI-Bibliothek ließ sich nicht laden" — auf einem Rechner, auf dem sie
 * längst laufen könnte.
 *
 * Der Umweg über `npm pack` ist Absicht: `npm install --os=linux` wird von
 * npm 11 nicht mehr beachtet (geprüft: EBADPLATFORM trotz passender Angabe).
 * `npm pack` prüft die Plattform nicht — es lädt nur das Archiv.
 *
 * Aufruf:  node tools/ndi.mjs
 *
 * NDI® ist eine eingetragene Marke der Vizrt NDI AB.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Die Plattformen, für die dieses Projekt Pakete herstellt. */
const PLATTFORMEN = ['win32-x64', 'linux-x64', 'linux-arm64']

const wurzel = process.cwd()
const ziel = join(wurzel, 'node_modules', '@grandi')

function fassung() {
  const eigen = JSON.parse(readFileSync(join(wurzel, 'package.json'), 'utf8'))
  const roh = eigen.dependencies?.grandi ?? eigen.optionalDependencies?.grandi
  if (!roh) throw new Error('In package.json steht keine Abhängigkeit „grandi".')
  /* Aus „^2.0.2" wird „2.0.2": Die Plattformpakete sind auf die Fassung von
     grandi festgenagelt, nicht auf einen Bereich. */
  return roh.replace(/^[^\d]*/, '')
}

const version = fassung()
mkdirSync(ziel, { recursive: true })

let geholt = 0
for (const plattform of PLATTFORMEN) {
  const ordner = join(ziel, plattform)
  if (existsSync(join(ordner, 'package.json'))) {
    console.log(`  ${plattform}: liegt schon da`)
    continue
  }

  const zwischen = mkdtempSync(join(tmpdir(), 'votura-ndi-'))
  try {
    console.log(`  ${plattform}: wird geholt …`)
    execFileSync('npm', ['pack', `@grandi/${plattform}@${version}`, '--silent'], {
      cwd: zwischen,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    })
    const archiv = readdirSync(zwischen).find((name) => name.endsWith('.tgz'))
    if (!archiv) throw new Error('npm pack hat kein Archiv hinterlassen.')
    execFileSync('tar', ['-xzf', archiv], { cwd: zwischen, stdio: 'inherit' })
    /* Im Archiv liegt alles unter `package/` — das ist der Ordner, der
       am Ende `@grandi/<plattform>` heißen soll. */
    renameSync(join(zwischen, 'package'), ordner)
    geholt++
  } finally {
    rmSync(zwischen, { recursive: true, force: true })
  }
}

console.log(
  geholt > 0
    ? `NDI-Bindung vollständig (${geholt} nachgeholt, Fassung ${version}).`
    : `NDI-Bindung vollständig (Fassung ${version}).`
)
