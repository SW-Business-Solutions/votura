/**
 * Kamerabilder im Saal (NDI).
 *
 * Geprüft wird, was sich ohne Kamera und ohne Browser prüfen lässt: die
 * Rechnung für die Bauchbinde, die Wahl der Bildqualität, die Aufbereitung
 * der Quellennamen — und die Zusagen, die das Programm über seinen Bau
 * macht. Das Bild selbst kann kein Test ersetzen; die Entscheidungen darum
 * herum schon.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  KAMERA_STILLE_MS,
  bauchbinde,
  kurzerQuellenname,
  qualitaetFuer,
  type ProjectionCamera
} from '../src/shared/kamera'
import { PROJECTION_MODES, PROJECTION_MODE_LABELS, type ProjectionSpeaker } from '../src/shared/projection'

const wurzel = join(__dirname, '..')
const lies = (pfad: string): string => readFileSync(join(wurzel, pfad), 'utf8')

describe('Bauchbinde', () => {
  const jetzt = Date.parse('2026-09-15T10:00:00.000Z')

  it('bleibt aus, solange niemand aufgerufen ist', () => {
    expect(bauchbinde(undefined, jetzt)).toBeUndefined()
  })

  it('bleibt aus, wenn der Name nur aus Leerzeichen besteht', () => {
    expect(bauchbinde({ name: '   ' }, jetzt)).toBeUndefined()
  })

  it('nennt Name und Zusatz', () => {
    const inhalt = bauchbinde({ name: ' Anna Berger ', note: ' Bewerbung um den Vorsitz ' }, jetzt)
    expect(inhalt?.name).toBe('Anna Berger')
    expect(inhalt?.zusatz).toBe('Bewerbung um den Vorsitz')
  })

  it('lässt den Zusatz weg, wenn keiner da ist', () => {
    expect(bauchbinde({ name: 'Anna Berger', note: '  ' }, jetzt)?.zusatz).toBeUndefined()
  })

  it('rechnet die Restzeit aus dem Zeitpunkt, nicht aus einer mitgezählten Zahl', () => {
    const redner: ProjectionSpeaker = {
      name: 'Anna Berger',
      until: new Date(jetzt + 90_000).toISOString(),
      totalSeconds: 180
    }
    expect(bauchbinde(redner, jetzt)?.restSekunden).toBe(90)
    /* Dreißig Sekunden später steht dieselbe Angabe im Zustand — die Ansicht
       rechnet trotzdem richtig. Genau das ist der Grund für die Uhr. */
    expect(bauchbinde(redner, jetzt + 30_000)?.restSekunden).toBe(60)
  })

  it('meldet eine angehaltene Uhr als angehalten', () => {
    const redner: ProjectionSpeaker = {
      name: 'Anna Berger',
      until: new Date(jetzt + 90_000).toISOString(),
      totalSeconds: 180,
      pausedSecondsLeft: 42
    }
    const inhalt = bauchbinde(redner, jetzt)
    expect(inhalt?.angehalten).toBe(true)
    /* Ruht die Uhr, gilt der festgehaltene Rest und nicht der Zeitpunkt. */
    expect(inhalt?.restSekunden).toBe(42)
  })

  it('kommt ohne Redezeit aus — nicht jede Vorstellung ist begrenzt', () => {
    const inhalt = bauchbinde({ name: 'Anna Berger' }, jetzt)
    expect(inhalt?.name).toBe('Anna Berger')
    expect(inhalt?.restSekunden).toBeUndefined()
    expect(inhalt?.angehalten).toBe(false)
  })
})

describe('Quellennamen', () => {
  it('lässt den Rechnernamen in Klammern weg', () => {
    expect(kurzerQuellenname('PULT (OBSBOT Tail Air)')).toBe('PULT')
  })

  it('lässt einen Namen ohne Klammer unangetastet', () => {
    expect(kurzerQuellenname('PULT')).toBe('PULT')
  })

  it('kürzt nicht, wenn die Klammer am Anfang steht', () => {
    expect(kurzerQuellenname('(OBSBOT)')).toBe('(OBSBOT)')
  })
})

describe('Bildqualität', () => {
  /*
   * Die Regel muss in beide Richtungen halten: Ein Gerät am Kabel bekommt das
   * volle Bild, eines im Funknetz den Vorschaustrom. Und wenn der Browser
   * nichts über die Verbindung sagt, gilt Kabel — der Regelfall ist der
   * Beamerrechner, und ein grobes Bild an der Saalwand fiele auf.
   */
  it('gibt dem Funknetz den kleinen Strom', () => {
    expect(qualitaetFuer(true)).toBe('vorschau')
  })

  it('gibt dem Kabel das volle Bild', () => {
    expect(qualitaetFuer(false)).toBe('hoch')
  })

  it('nimmt im Zweifel Kabel an', () => {
    expect(qualitaetFuer(undefined)).toBe('hoch')
  })
})

describe('Beamerzustand', () => {
  it('kennt den Kameramodus mit Beschriftung', () => {
    expect(PROJECTION_MODES).toContain('kamera')
    expect(PROJECTION_MODE_LABELS.kamera).toBe('Kamera')
  })

  it('trägt im Zustand nur den Namen der Quelle, niemals Bilddaten', () => {
    const kamera: ProjectionCamera = {
      quelle: 'PULT (OBSBOT)',
      bauchbinde: true,
      naechste: true,
      spiegeln: false
    }
    /*
     * Das ist keine Förmlichkeit: Der Zustand geht mehrmals je Sekunde durch
     * die SSE-Leitungen an jedes Gerät im Saal. Läge dort ein Bild, wäre die
     * Netzwerkansicht mit dem ersten Kamerabild erledigt.
     */
    expect(Object.keys(kamera).sort()).toEqual(['bauchbinde', 'naechste', 'quelle', 'spiegeln'])
    expect(JSON.stringify(kamera).length).toBeLessThan(120)
  })
})

describe('Bau und Auslieferung', () => {
  it('lässt die NDI-Bindung in einem eigenen Prozess laufen', () => {
    /*
     * Die wichtigste Zusage dieser Fähigkeit: fremder nativer Code läuft
     * nicht in dem Prozess, der die Wahl führt. Fiele diese Zeile weg,
     * risse ein Absturz der Bibliothek die Versammlung mit.
     */
    const dienst = lies('src/main/services/kamera.ts')
    expect(dienst).toContain('utilityProcess.fork')
    const bau = lies('electron.vite.config.ts')
    expect(bau).toContain("'kamera-empfaenger'")
  })

  it('lädt die Bindung erst, wenn jemand eine Kamera sucht', () => {
    const dienst = lies('src/main/services/kamera.ts')
    /* Kein Start beim Programmstart: Eine Versammlung ohne Kameras soll weder
       fremden Code im Speicher noch eine NDI-Anmeldung im Netz haben. Der
       Prozess entsteht erst mit der ersten Suche. */
    const beginn = dienst.indexOf('export function sucheKameras')
    const ende = dienst.indexOf('\n}', beginn)
    expect(dienst.slice(beginn, ende)).toContain('starte()')
  })

  it('schaltet die Suche nicht sofort ab, wenn niemand hinsieht', () => {
    /*
     * Sie sofort abzuschalten war ein Fehlgriff: Wer zwischen den Karten
     * blätterte, fing jedes Mal von vorn an und sah eine leere Liste. Die
     * Sorge dahinter galt dem Videostrom, nicht der Suche.
     */
    const dienst = lies('src/main/services/kamera.ts')
    expect(dienst).toContain('SUCHE_NACHLAUF_MS')
    /* Und einmal Gefundenes wird nicht weggeworfen. */
    expect(dienst).not.toContain('gesehen.clear()')
  })

  it('gibt dem Empfänger die Adresse mit, die die Suche gefunden hat', () => {
    /*
     * Gemessen, im Wechsel und zweimal wiederholt: Ohne die Adresse braucht
     * NDI **4017 ms** bis zum ersten Bild, mit ihr **14 ms**. Wir kennen sie
     * aus der Suche; sie nicht weiterzureichen hieße, die Kamera ein zweites
     * Mal suchen zu lassen — während der Saal auf ein schwarzes Bild sieht.
     */
    const dienst = lies('src/main/services/kamera.ts')
    expect(dienst).toContain('gesehen.get(quelle)?.quelle.adresse')
    const empfaenger = lies('src/ndi/empfaenger.ts')
    expect(empfaenger).toContain('urlAddress: adresse')
    /* Der Name bleibt maßgeblich — die Adresse ist ein Hinweis, kein Ersatz. */
    expect(empfaenger).toContain('{ name: quelle, urlAddress: adresse }')
  })

  it('unterscheidet „noch kein Bild“ von „Bild abgerissen“', () => {
    /* Zwei Sekunden „kein Bild“ beim Aufbau schicken jemanden zur Kamera,
       wo nichts zu suchen ist. */
    const ansicht = lies('src/renderer/src/projection/KameraBild.tsx')
    expect(ansicht).toContain('verbindet')
    expect(ansicht).toContain('jeGesehen')
  })

  it('reicht keine Bilder durch den Hauptprozess', () => {
    const dienst = lies('src/main/services/kamera.ts')
    /* Der Hauptprozess legt einen Kanal und ist danach außen vor. Stünde hier
       ein Weiterreichen von Bilddaten, wären es bei 1080p rund 240 MB je
       Sekunde durch den Prozess, der die Stimmen zählt. */
    expect(dienst).toContain('MessageChannelMain')
    /* Kein Bildpuffer und kein Bildtyp: Was der Dienst nicht kennt, kann er
       auch nicht weiterreichen. Geprüft wird die Importzeile — das Wort
       „Kamerabild“ darf in einer Meldung durchaus vorkommen. */
    expect(dienst).not.toContain('ArrayBuffer')
    const importzeile = dienst
      .split('\n')
      .find((zeile) => zeile.includes("from '../../ndi/empfaenger'"))
    const eingefuehrt = importzeile ?? ''
    expect(eingefuehrt).toContain('VomEmpfaenger')
    expect(eingefuehrt).not.toContain('Kamerabild')
  })

  it('liefert die NDI-Bindung für alle Plattformen mit, die gebaut werden', () => {
    const werkzeug = lies('tools/ndi.mjs')
    for (const plattform of ['win32-x64', 'linux-x64', 'linux-arm64']) {
      expect(werkzeug).toContain(plattform)
    }
    /* Ohne diesen Schritt entstünde von einem Windows-Rechner aus ein
       Linux-Paket ohne Bindung — und niemand merkte es vor dem Saal. */
    const paket = JSON.parse(lies('package.json')) as { scripts: Record<string, string> }
    expect(paket.scripts['dist:alle']).toContain('tools/ndi.mjs')
    expect(paket.scripts['dist:linux']).toContain('tools/ndi.mjs')
  })

  it('packt die Bindung aus dem Archiv aus', () => {
    /* Nativer Code lässt sich aus einer asar-Datei heraus nicht laden. */
    for (const datei of ['electron-builder.yml', 'electron-builder-saal.yml']) {
      expect(lies(datei)).toContain('asarUnpack')
      expect(lies(datei)).toContain('node_modules/@grandi/**')
    }
  })

  it('lässt ein Gerät im Saal selbst empfangen, statt Bilder weiterzureichen', () => {
    /*
     * Der Kern der Entscheidung: Ein Pi hinter dem zweiten Beamer hängt im
     * selben Netz wie die Kamera. Ihm das Bild über den Hauptrechner zu
     * schicken hieße, es dort neu zu kodieren — auf dem Rechner, der die Wahl
     * führt. Er bekommt stattdessen nur den Namen der Quelle.
     */
    const saal = lies('src/saal/index.ts')
    expect(saal).toContain('saal-kamera.js')
    expect(saal).toContain('IPC.kameraAn')
    const bruecke = lies('src/preload/saal-kamera.ts')
    expect(bruecke).toContain('voturaKamera')
    /* Die Brücke kann genau zweierlei und nichts sonst. */
    expect(bruecke).not.toContain('invoke')
    const bau = lies('electron.vite.config.ts')
    expect(bau).toContain("'saal-kamera'")
  })

  it('nennt die Marke, wie es die Lizenz des SDK verlangt', () => {
    for (const datei of [
      'src/shared/kamera.ts',
      'src/ndi/empfaenger.ts',
      'src/main/services/kamera.ts',
      'src/preload/saal-kamera.ts'
    ]) {
      expect(lies(datei)).toContain('NDI® ist eine eingetragene Marke der Vizrt NDI AB.')
    }
  })
})

describe('Ausdauer', () => {
  it('wartet nicht ewig auf ein Bild, bevor es die Ansicht sagt', () => {
    /* Vier Sekunden: kürzer wäre Fehlalarm — NDI-Verbindungen brauchen beim
       Aufbau ihre Zeit —, länger stünde ein totes Standbild an der Wand. */
    expect(KAMERA_STILLE_MS).toBeGreaterThanOrEqual(3000)
    expect(KAMERA_STILLE_MS).toBeLessThanOrEqual(10_000)
  })

  it('sucht den Empfängerprozess, statt seinen Ort anzunehmen', () => {
    /*
     * Gelernt auf die harte Tour: Der Bündler zieht diesen Dienst in einen
     * gemeinsamen Baustein, sobald ihn Hauptrechner **und** Votura Saal
     * benutzen — und der liegt in `chunks/`, einen Ordner tiefer. Ein
     * schlichtes `join(__dirname, ...)` zeigte ins Leere, der Prozess starb
     * viermal und blieb dann unten. In der Entwicklungsfassung fällt das nicht
     * auf; im gebauten Programm sofort.
     */
    const dienst = lies('src/main/services/kamera.ts')
    expect(dienst).toContain('existsSync')
    expect(dienst).toContain("app.getAppPath()")
    /* Und wenn nichts gefunden wird, gibt es eine Auskunft statt vier
       Fehlstarts. */
    expect(dienst).toContain('Der Kameraempfänger fehlt in dieser Installation.')
  })

  it('startet einen abgestürzten Empfänger nicht endlos neu', () => {
    const dienst = lies('src/main/services/kamera.ts')
    expect(dienst).toContain('NEUSTARTS_MAX')
  })

  it('bremst, wenn ein Gerät nicht mitkommt', () => {
    /* Ohne Quittung liefe die Warteschlange im Port bis zum Speicherende —
       auf einem Pi bei 1080p in wenigen Sekunden. */
    const empfaenger = lies('src/ndi/empfaenger.ts')
    expect(empfaenger).toContain('AUSSTEHEND_MAX')
    expect(lies('src/renderer/src/projection/KameraBild.tsx')).toContain('port?.postMessage(1)')
  })
})
