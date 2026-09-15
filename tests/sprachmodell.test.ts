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

describe('Wer zuhört, bekommt, was die Erkennung braucht', () => {
  it('lädt unter eigenem Schema statt unter file://', () => {
    /*
     * Ohne echte Herkunft verweigert Chromium Web Worker — und die Erkennung
     * läuft in einem. Das betrifft **beide** Fenster, die zuhören: das Pult
     * und den versteckten Zuhörer der Untertitel.
     */
    expect(lies('src/shared/speech.ts')).toContain("PULT_SCHEME = 'votura-pult'")
    const fenster = lies('src/main/windows.ts')
    expect(fenster).toMatch(/page === 'teleprompter' \|\| page === 'zuhoerer'/)
    expect(fenster).toContain('${PULT_SCHEME}://pult/${page}.html')
    expect(haupt).toContain('registerPultProtocol')
  })

  it('gibt beiden zuhörenden Fenstern ein Mikrofon — und sonst keinem', () => {
    /*
     * Der erste Anlauf der Untertitel ließ die Erkennung in der
     * Bedienoberfläche laufen. Sie scheiterte dort an zwei Sperren zugleich:
     * kein Mikrofon (diese Datei) und keine Herkunft (der Test darüber).
     * Beide Sperren sind gewollt — also bekam das Zuhören ein eigenes
     * Fenster, statt dass eine der beiden gelockert wurde.
     */
    const rechte = lies('src/main/medienrechte.ts')
    expect(rechte).toContain('zuhoerer.html')
    expect(rechte).toMatch(/art === 'audio'\s*\?\s*darfZuhoeren/)
  })

  it('lässt die Erkennung nicht in der Bedienoberfläche laufen', () => {
    /* Sie käme dort nicht an ein Mikrofon — und der Fehler wäre einer, den
       man erst im Saal bemerkt. */
    const bedienung = lies('src/renderer/src/operator/App.tsx')
    expect(bedienung).not.toContain('Untertitelgeber')
    /* Der Zuhörer ruft den gemeinsamen Geber auf, und der das Zuhören —
       die Rechnung dazwischen steht seit den Untertiteln am Pult an einer
       Stelle für beide Orte. */
    expect(lies('src/renderer/src/zuhoerer-main.ts')).toContain('starteUntertitelgeber')
    expect(lies('src/renderer/src/sprache/untertitelgeber.ts')).toContain('starteZuhoeren')
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

  /*
   * Geprüft wird `zuhoeren.ts` und nicht mehr `mithoeren.ts`.
   *
   * Der Aufbau — Mikrofon, Modell, Worklet — steht seit den Untertiteln an
   * einer Stelle für beide Nutzer: Der Prompter sucht damit die Stelle im
   * Manuskript, die Untertitel nehmen den Text. Die Zusagen hier gelten für
   * das Zuhören selbst, also für beide.
   */
  it('lädt das Worklet aus einer Datei, nicht aus einem Blob', () => {
    /* Ein Worklet fällt unter `script-src`; `blob:` dort hieße, beliebig
       erzeugte Skripte zuzulassen. */
    const zuhoeren = lies('src/renderer/src/sprache/zuhoeren.ts')
    expect(zuhoeren).toContain("SAMMLER = 'pult-sammler.js'")
    expect(zuhoeren).not.toContain('new Blob([WORKLET]')
    expect(lies('src/renderer/public/pult-sammler.js')).toContain('votura-sammler')
  })

  it('holt das Modell unter vollständiger Adresse', () => {
    /* Ein Blob-Worker hat keine Basis, gegen die ein relativer Pfad
       aufgelöst werden könnte. */
    const zuhoeren = lies('src/renderer/src/sprache/zuhoeren.ts')
    expect(SPRACHMODELL_PFAD).toBe('/sprachmodell')
    expect(zuhoeren).toContain('location.origin')
  })

  it('sagt es, wenn im Netz kein Mikrofon zu haben ist', () => {
    /* `getUserMedia` gibt es nur in einer sicheren Herkunft; die Netzansicht
       läuft über einfaches HTTP. */
    const zuhoeren = lies('src/renderer/src/sprache/zuhoeren.ts')
    expect(zuhoeren).toContain('navigator.mediaDevices?.getUserMedia')
    expect(zuhoeren).toContain('nur am Hauptrechner')
  })

  it('schreibt den heiklen Aufbau nur einmal', () => {
    /*
     * Prompter und Untertitel brauchen dasselbe: Abtastrate, Worklet statt
     * ScriptProcessor, vollständige Modelladresse, sicherer Kontext. Jede
     * dieser Stellen hat einen Grund — und eine zweite Fassung davon wäre
     * eine, in der einer der Gründe irgendwann fehlt.
     */
    const mithoeren = lies('src/renderer/src/prompter/mithoeren.ts')
    expect(mithoeren).toContain("from '../sprache/zuhoeren'")
    expect(mithoeren).not.toContain('getUserMedia')
    expect(mithoeren).not.toContain('AudioContext')
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
    /*
     * Welches Fenster was bekommt, entscheidet `darfMedium` — und das wird in
     * `medienrechte.test.ts` an seinem Verhalten geprüft, nicht an
     * Textstellen. Hier bleibt nur die Frage, ob der Hauptprozess überhaupt
     * dort nachfragt, statt selbst zu entscheiden.
     */
    expect(haupt).toContain('darfMedium(contents.getURL()')
    expect(haupt).not.toContain('callback(true)')
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
