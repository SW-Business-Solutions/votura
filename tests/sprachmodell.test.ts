/**
 * Was die Spracherkennung braucht, um überhaupt anzulaufen.
 *
 * Auf dem Weg dorthin lagen vier Sperren, und jede davon war **still**: kein
 * Fehler in der Konsole, keine Meldung — am Pult stand nur für immer „wird
 * geladen". Diese Prüfungen halten die Erlaubnisse fest, damit sie nicht bei
 * der nächsten Aufräumaktion wieder verschwinden.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SPRACHMODELL_PFAD } from '../src/shared/sprachmodell'

const lies = (pfad: string): string => readFileSync(join(__dirname, '..', pfad), 'utf8')
const haupt = lies('src/main/index.ts')

describe('Die Prompterseite bekommt, was die Erkennung braucht', () => {
  it('läuft unter eigenem Schema statt unter file://', () => {
    /* Ohne echte Herkunft verweigert Chromium Web Worker. */
    expect(lies('src/shared/speech.ts')).toContain("PULT_SCHEME = 'votura-pult'")
    expect(lies('src/main/windows.ts')).toContain('teleprompter.html')
    expect(haupt).toContain('registerPultProtocol')
  })

  it('darf Worker aus Blobs starten', () => {
    /* Die Erkennung bringt ihren Worker eingebettet mit. */
    expect(haupt).toContain("worker-src 'self' blob:")
  })

  it('darf WebAssembly übersetzen und Funktionen erzeugen', () => {
    /* Der Rechenteil kommt als Daten-URI, die Anbindung erzeugt Funktionen. */
    expect(haupt).toContain("script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'")
  })

  it('hält `unsafe-eval` von der übrigen Anwendung fern', () => {
    /* Nur die Pultseite darf das — die Bedienoberfläche nicht. */
    const anwendung = haupt.slice(haupt.indexOf('function hardenSecurity'))
    const zeile = /"default-src 'self'; script-src '[^"]*"/.exec(anwendung)?.[0] ?? ''
    /* Mit Anführungszeichen geprüft: `'wasm-unsafe-eval'` enthält die
       Zeichenfolge sonst als Teilstück und der Test ginge immer durch. */
    expect(zeile).not.toContain("'unsafe-eval'")
    expect(zeile).toContain("'wasm-unsafe-eval'")
  })

  it('lädt das Worklet aus einer Datei, nicht aus einem Blob', () => {
    /* Ein Worklet fällt unter `script-src`; `blob:` dort hieße, beliebig
       erzeugte Skripte zuzulassen. */
    const mithoeren = lies('src/renderer/src/prompter/mithoeren.ts')
    expect(mithoeren).toContain("SAMMLER = 'pult-sammler.js'")
    expect(mithoeren).not.toContain('new Blob([WORKLET]')
    expect(lies('src/renderer/public/pult-sammler.js')).toContain('votura-sammler')
  })

  it('holt das Modell unter vollständiger Adresse', () => {
    /* Ein Blob-Worker hat keine Basis, gegen die ein relativer Pfad
       aufgelöst werden könnte. */
    const mithoeren = lies('src/renderer/src/prompter/mithoeren.ts')
    expect(SPRACHMODELL_PFAD).toBe('/sprachmodell')
    expect(mithoeren).toContain('location.origin')
  })

  it('sagt es, wenn im Netz kein Mikrofon zu haben ist', () => {
    /* `getUserMedia` gibt es nur in einer sicheren Herkunft; die Netzansicht
       läuft über einfaches HTTP. */
    const mithoeren = lies('src/renderer/src/prompter/mithoeren.ts')
    expect(mithoeren).toContain('navigator.mediaDevices?.getUserMedia')
    expect(mithoeren).toContain('Prompterfenster am Hauptrechner')
  })

  it('gibt das Mikrofon nur der Prompterseite — die Kamera niemals', () => {
    /*
     * **Die Trennung ist keine Feinheit.** Chromium fasst Kamera und Mikrofon
     * unter „media" zusammen. Seit die Bedienoberfläche QR-Codes scannt,
     * braucht sie die Kamera — das Mikrofon darf sie deshalb nicht
     * gleich mitbekommen, und der Prompter umgekehrt keine Kamera.
     */
    expect(haupt).toContain('setPermissionRequestHandler')
    expect(haupt).toContain("permission !== 'media'")
    /* Ton nur vom Pult, Bild nur aus der eigenen Oberfläche. */
    expect(haupt).toContain("art === 'audio'")
    expect(haupt).toContain('istEigeneOberflaeche')
    /* Eine eingebettete Präsentation bekommt beides nicht. */
    expect(haupt).toContain('PRESENTATION_SCHEME')
  })
})

describe('Das Modell liegt außerhalb des Repositories', () => {
  it('wird beim Bauen geholt und ins Paket gelegt', () => {
    expect(lies('.gitignore')).toContain('resources/sprachmodell/')
    expect(lies('electron-builder.yml')).toContain('resources/sprachmodell')
    expect(lies('package.json')).toContain('tools/sprachmodell.mjs')
  })

  it('wird gegen eine Prüfsumme abgeglichen', () => {
    /* Ein halb heruntergeladenes Archiv fiele sonst erst am Pult auf. */
    const werkzeug = lies('tools/sprachmodell.mjs')
    expect(werkzeug).toContain('SHA256')
    expect(werkzeug).toContain('Prüfsumme stimmt nicht')
  })
})

describe('Der zurückhaltende Warnknopf bleibt lesbar', () => {
  it('setzt die Warnfarbe in Schrift und Rand, nicht in die Fläche', () => {
    /*
     * `ghost` nimmt den Grund weg, `danger` hatte die weiße Schrift gesetzt —
     * im hellen Design stand damit Weiß auf Weiß. Der Fall braucht eine
     * eigene Regel, weil beide Klassen zusammen vorkommen.
     */
    const stile = lies('src/renderer/src/styles/app.css')
    expect(stile).toContain('button.ghost.danger')
    const regel = stile.slice(stile.indexOf('button.ghost.danger {'))
    expect(regel.slice(0, regel.indexOf('}'))).toContain('color: var(--danger)')
  })
})
