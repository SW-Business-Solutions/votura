/**
 * Präsentationen: Vertrag, Kapselung und Modus.
 *
 * Geprüft wird das, was ohne Fenster prüfbar ist — die Regeln, an denen der
 * Rest hängt. Ob ein `<iframe>` wirklich abgeschottet ist, entscheidet
 * Chromium; dass wir die dafür nötigen Angaben setzen, entscheidet dieser
 * Test.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUDIT_ACTION_LABELS } from '../src/shared/audit-labels'
import {
  PRESENTATION_CHANNEL,
  PRESENTATION_SCHEME,
  presentationKind,
  presentationUrl,
  isPresentationReport
} from '../src/shared/presentation'
import { PROJECTION_MODES, PROJECTION_MODE_LABELS } from '../src/shared/projection'

const wurzel = join(__dirname, '..')
const lies = (pfad: string): string => readFileSync(join(wurzel, pfad), 'utf8')

describe('Projektionsmodus', () => {
  it('kennt die Präsentation und gibt ihr einen Klartext', () => {
    expect(PROJECTION_MODES).toContain('presentation')
    expect(PROJECTION_MODE_LABELS.presentation).toBe('Präsentation')
  })

  it('führt jede Präsentations-Aktion im Prüfpfad mit Klartext', () => {
    for (const aktion of ['presentation.imported', 'presentation.renamed', 'presentation.deleted']) {
      expect(AUDIT_ACTION_LABELS[aktion], aktion).toBeTruthy()
    }
  })
})

describe('Vertrag mit dem Dokument', () => {
  it('erkennt eine gültige Rückmeldung', () => {
    expect(
      isPresentationReport({ votura: PRESENTATION_CHANNEL, type: 'state', slide: 3, slideCount: 24 })
    ).toBe(true)
  })

  it('weist fremde Nachrichten ab', () => {
    /* In einem Fenster schicken auch andere Quellen Nachrichten. Ohne die
       Absenderkennung würde jede davon als Folienwechsel gelesen. */
    expect(isPresentationReport({ type: 'state', slide: 3, slideCount: 24 })).toBe(false)
    expect(isPresentationReport({ votura: 'fremd', type: 'state', slide: 3, slideCount: 24 })).toBe(false)
    expect(isPresentationReport({ votura: PRESENTATION_CHANNEL, type: 'goto', slide: 3 })).toBe(false)
    expect(isPresentationReport(null)).toBe(false)
    expect(isPresentationReport('state')).toBe(false)
  })

  it('lädt im Beamerfenster über das eigene Schema', () => {
    expect(presentationUrl('abc').startsWith(`${PRESENTATION_SCHEME}://`)).toBe(true)
  })

  /*
   * Der Browser entscheidet an der Adresse, ob er neu laedt. Waere sie fuer
   * alle Praesentationen gleich, behielte der Rahmen beim Wechsel das alte
   * Dokument — waehrend Titel und Foliennummer daneben schon zum neuen
   * gehoeren. Genau das war zu beobachten.
   */
  it('unterscheidet die Adresse je Präsentation', () => {
    expect(presentationUrl('aaa')).not.toBe(presentationUrl('bbb'))
  })

  /* Die Foliennummer darf nicht hinein: sonst laedt das Dokument bei jedem
     Tastendruck neu. */
  it('haelt die Adresse über alle Folien hinweg stabil', () => {
    expect(presentationUrl('aaa')).toBe(presentationUrl('aaa'))
  })
})

describe('PDF als Foliensatz', () => {
  /*
   * PowerPoint kommt über seinen eigenen PDF-Export herein. Eine .pptx direkt
   * zu zerlegen hieße, Schriften, Diagramme und SmartArt nachzubauen — mit der
   * Treue von "meistens ungefähr". Dieselbe Begründung wie bei MKV und MOV.
   */
  it('unterscheidet HTML und PDF an der Art', () => {
    expect(presentationKind({ kind: 'pdf', fileName: 'egal.html' })).toBe('pdf')
    expect(presentationKind({ kind: 'html', fileName: 'egal.pdf' })).toBe('html')
  })

  /* Einträge aus einer älteren Fassung kennen das Feld nicht — sie sind
     ausnahmslos HTML. */
  it('hält fehlende Angaben für HTML', () => {
    expect(presentationKind({ fileName: 'folien.html' })).toBe('html')
    expect(presentationKind({})).toBe('html')
  })

  /* Für Dateien, die vor dem Feld eingespeist wurden, rettet die Endung. */
  it('erkennt ein PDF notfalls an der Endung', () => {
    expect(presentationKind({ fileName: 'Bericht.PDF' })).toBe('pdf')
  })

  it('zeichnet das PDF selbst, statt es einzubetten', () => {
    /* Kommentare heraus: Sie sprechen über den Rahmen, den es hier gerade
       nicht geben soll. */
    const rahmen = lies('src/renderer/src/projection/PdfFrame.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    /* Ein eingebetteter Betrachter brächte Werkzeug- und Blätterleiste mit,
       die der Saal nicht sehen soll — und keinen verlässlichen Weg, die Seite
       von außen zu setzen. */
    expect(rahmen).not.toMatch(/<iframe[\s/>]/)
    expect(rahmen).toContain('<canvas')
    expect(rahmen).toContain('getDocument')
  })

  it('nimmt PDF-Dateien im Dateidialog an', () => {
    expect(lies('src/main/ipc.ts')).toContain("extensions: ['html', 'htm', 'pdf']")
  })

  it('liefert ein PDF mit dem richtigen Inhaltstyp aus', () => {
    expect(lies('src/main/index.ts')).toContain("'application/pdf'")
  })
})

describe('Kapselung fremder Präsentationen', () => {
  const rahmen = lies('src/renderer/src/projection/PresentationFrame.tsx')

  it('sperrt den Rahmen ein: Skripte ja, gleiche Herkunft nein', () => {
    /*
     * Die entscheidende Zeile des ganzen Vorhabens.
     *
     * `allow-scripts` **mit** `allow-same-origin` höbe die Abschottung auf:
     * Das fremde Dokument käme an `window.parent`, an die Preload-Brücke und
     * damit an die Wahldaten. Beamer §2 gilt auch für fremden Code.
     *
     * Geprüft wird das Attribut, nicht der Dateitext: Im Kopfkommentar der
     * Komponente steht `allow-same-origin` als Warnung, und eine Textsuche
     * schlüge genau daran fehl.
     */
    const attribut = /sandbox="([^"]*)"/.exec(rahmen)?.[1]
    expect(attribut).toBe('allow-scripts')
  })

  it('hängt die Foliennummer nicht an die Adresse', () => {
    /* Stünde sie darin, lüde das Dokument bei jedem Tastendruck neu — zwei
       Megabyte und jede Animation von vorn. */
    expect(rahmen).not.toMatch(/src=\{[^}]*slide/)
  })

  it('gibt der Präsentation eine eigene, engere Richtlinie', () => {
    const start = lies('src/main/index.ts')
    /* Die Regel der Anwendung verbietet Inline-Skripte; eine Präsentation
       besteht daraus. Sie bekommt deshalb eine eigene — ohne `connect-src`,
       damit sie nichts nachladen und nichts melden kann (§2.2). */
    expect(start).toContain('PRESENTATION_SCHEME')
    expect(start).toContain("connect-src 'none'")
  })
})

describe('Netzwerkansicht', () => {
  const server = lies('src/main/network-projection.ts')

  it('liefert nur die laufende Präsentation aus', () => {
    /* Würde jede Datei der Bibliothek über ihre Kennung erreichbar, könnte
       jedes Gerät im Saal eine noch ungezeigte Präsentation abrufen. */
    expect(server).toContain('/presentation.html')
    expect(server).toContain('getProjectionState(buehneAus(url)).presentation')
  })

  it('bleibt rein lesend (§51)', () => {
    /*
     * Der Abschnitt für die Präsentation darf keinen schreibenden Pfad
     * einführen.
     *
     * Die Prüfung schnitt zuerst bis zum Dateiende und erwischte damit jeden
     * später ergänzten Endpunkt — auch die eigens geprüften der digitalen
     * Stimmabgabe. Sie ist jetzt auf ihren Abschnitt begrenzt; wofür sie
     * eigentlich stand, hält die Prüfung darunter fest.
     */
    const anfang = server.indexOf("=== '/presentation.html'") - 400
    const abschnitt = server.slice(anfang, anfang + 2000)
    expect(abschnitt).not.toMatch(/method\s*===\s*'POST'/)
  })

  it('kennt genau diese Schnittstellen', () => {
    /*
     * Der eigentliche Wächter: Jeder Pfad dieses Servers steht hier
     * namentlich, und die schreibenden sind als solche gekennzeichnet. Wer
     * einen ergänzt, muss ihn hier eintragen — und dabei begründen, warum er
     * dort hingehört.
     *
     * Vorher stand an dieser Stelle eine Prüfung, die vom Präsentations-
     * abschnitt bis zum Dateiende schnitt. Sie schlug bei jedem später
     * ergänzten Endpunkt an, ohne etwas über ihn zu sagen — und wäre
     * irgendwann weggeklickt worden.
     */
    const bekannt = [
      /* lesend */
      '/api/projection/state',
      '/api/projection/stream',
      '/api/prompter/state',
      '/api/prompter/stream',
      /* schreibend: Manuskript am Pult bewegen, freischaltbar, kein Wahldatum (§51) */
      '/api/prompter/control',
      /* schreibend: Bedienung aus der Ferne, mit Anmeldung und Rechteprüfung (ADR-0005) */
      '/api/remote/',
      /* schreibend: die Stimmabgabe, ohne Anmeldung — der Ausweis ist der Nachweis,
         und bei geheimer Wahl darf der Rechner gar nicht wissen, wer gerade
         abstimmt (ADR-0006) */
      '/api/stimme/',
      '/api/stimme/lage',
      '/api/stimme/berechtigung',
      '/api/stimme/abgeben',
      '/api/stimme/warten',
      /* schreibend: der Wahlausschuss, mit Zugriffstoken — hier hängt kein
         Ausweis dran, sondern ein Gerät, das den Schlüssel hält */
      '/api/ausschuss/'
    ]
    const gefunden = server
      .split('url.pathname')
      .slice(1)
      .map((teil) => /^(?:\.startsWith\(|\s*===\s*)'([^']+)'/.exec(teil)?.[1])
      .filter((pfad): pfad is string => Boolean(pfad?.startsWith('/api/')))

    expect([...new Set(gefunden)].filter((pfad) => !bekannt.includes(pfad))).toEqual([])
  })
})
