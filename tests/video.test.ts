/**
 * Gleichlauf der Videowiedergabe (Beamer §75/§88).
 *
 * Die Rechnung steckt bewusst in einer reinen Funktion: So lässt sich prüfen,
 * was ein Gerät tun würde, ohne einen Browser zu starten — und alle Geräte
 * rechnen nachweislich gleich.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  berechneGleichlauf,
  videoMimeType,
  videoPath,
  videoUrl,
  GLEICHLAUF_SPRUNG,
  GLEICHLAUF_TEMPO,
  GLEICHLAUF_TOLERANZ,
  VIDEO_SCHEME
} from '../src/shared/video'
import { PROJECTION_MODES, PROJECTION_MODE_LABELS } from '../src/shared/projection'

const wurzel = join(__dirname, '..')
const lies = (pfad: string): string => readFileSync(join(wurzel, pfad), 'utf8')

const JETZT = 1_800_000_000_000

function video(overrides: Partial<Parameters<typeof berechneGleichlauf>[0]> = {}) {
  return {
    playing: true,
    position: 100,
    anchoredAt: JETZT,
    durationSeconds: 600,
    ...overrides
  }
}

describe('Projektionsmodus', () => {
  it('kennt das Video und gibt ihm einen Klartext', () => {
    expect(PROJECTION_MODES).toContain('video')
    expect(PROJECTION_MODE_LABELS.video).toBe('Video')
  })
})

describe('Sollposition aus der Uhr', () => {
  /*
   * Der Kern des Ganzen: Nicht „spiel jetzt ab", sondern „Sekunde 100,
   * gemessen zu diesem Zeitpunkt". Jedes Gerät rechnet daraus dasselbe aus.
   */
  it('schreibt die Position bei laufendem Video fort', () => {
    const lauf = berechneGleichlauf(video(), 105, JETZT + 5000)
    expect(lauf.soll).toBe(105)
    expect(lauf.abweichung).toBe(0)
  })

  it('lässt die Position im Stand unverändert', () => {
    const lauf = berechneGleichlauf(video({ playing: false }), 100, JETZT + 60_000)
    expect(lauf.soll).toBe(100)
  })

  it('läuft nicht über das Ende der Datei hinaus', () => {
    const lauf = berechneGleichlauf(video({ position: 599 }), 599, JETZT + 10_000)
    expect(lauf.soll).toBe(600)
  })

  /*
   * Ein Gerät, das erst in der Mitte dazukommt, hat keine Nachricht verpasst —
   * es rechnet sich seinen Stand aus wie alle anderen und springt einmal hin.
   */
  it('holt einen Nachzügler mit einem Sprung ab', () => {
    const lauf = berechneGleichlauf(video(), 0, JETZT + 120_000)
    expect(lauf.soll).toBe(220)
    expect(lauf.springen).toBe(true)
  })
})

describe('Nachführen statt springen', () => {
  it('lässt ein Gerät innerhalb der Toleranz in Ruhe', () => {
    const lauf = berechneGleichlauf(video(), 100 + GLEICHLAUF_TOLERANZ / 2, JETZT)
    expect(lauf.springen).toBe(false)
    expect(lauf.tempo).toBe(1)
  })

  /* Ein Sprung ruckelt sichtbar und knackt hörbar; zwei Prozent Tempo nicht. */
  it('gleicht kleine Abweichungen über die Geschwindigkeit aus', () => {
    const hinterher = berechneGleichlauf(video(), 100 - 0.3, JETZT)
    expect(hinterher.springen).toBe(false)
    expect(hinterher.tempo).toBeGreaterThan(1)
    expect(hinterher.tempo).toBeLessThanOrEqual(1 + GLEICHLAUF_TEMPO)

    const voraus = berechneGleichlauf(video(), 100 + 0.3, JETZT)
    expect(voraus.tempo).toBeLessThan(1)
    expect(voraus.tempo).toBeGreaterThanOrEqual(1 - GLEICHLAUF_TEMPO)
  })

  it('springt erst oberhalb der Sprunggrenze', () => {
    const knappDarunter = berechneGleichlauf(video(), 100 - (GLEICHLAUF_SPRUNG - 0.01), JETZT)
    expect(knappDarunter.springen).toBe(false)

    const darueber = berechneGleichlauf(video(), 100 - (GLEICHLAUF_SPRUNG + 0.01), JETZT)
    expect(darueber.springen).toBe(true)
    expect(darueber.tempo).toBe(1)
  })

  /* Im Stand gibt es nichts nachzuführen — entweder steht das Bild richtig
     oder es muss gesetzt werden. */
  it('führt im Stand nicht nach, sondern setzt', () => {
    const lauf = berechneGleichlauf(video({ playing: false }), 90, JETZT)
    expect(lauf.springen).toBe(true)
    expect(lauf.tempo).toBe(1)
  })
})

describe('Adresse des laufenden Videos', () => {
  it('lädt im Beamerfenster über das eigene Schema', () => {
    expect(videoUrl('abc').startsWith(`${VIDEO_SCHEME}://`)).toBe(true)
  })

  /* Dieselbe Falle wie bei den Präsentationen: Wäre die Adresse für alle
     Videos gleich, behielte das Element beim Wechsel die alte Datei. */
  it('unterscheidet die Adresse je Video', () => {
    expect(videoUrl('aaa')).not.toBe(videoUrl('bbb'))
    expect(videoPath('aaa')).not.toBe(videoPath('bbb'))
  })

  /* Die Position darf nicht hinein: Gesprungen wird im geladenen Video. */
  it('hält die Adresse über die Laufzeit hinweg stabil', () => {
    expect(videoUrl('aaa')).toBe(videoUrl('aaa'))
  })
})

describe('Angenommene Formate', () => {
  it('nimmt an, was jedes Chromium ohne Zusatz abspielt', () => {
    expect(videoMimeType('film.mp4')).toBe('video/mp4')
    expect(videoMimeType('film.webm')).toBe('video/webm')
    expect(videoMimeType('FILM.M4V')).toBe('video/mp4')
  })

  /* "Läuft manchmal" ist im Saal wertlos — deshalb ausdrücklich nicht. */
  it('lehnt Formate ab, die je nach Inhalt laufen oder nicht', () => {
    expect(videoMimeType('film.mkv')).toBeUndefined()
    expect(videoMimeType('film.mov')).toBeUndefined()
    expect(videoMimeType('ohne-endung')).toBeUndefined()
  })
})

describe('Auslieferung mit Bereichsanfragen', () => {
  /*
   * Ohne Bereichsanfragen müsste jedes Gerät die ganze Datei laden, bevor es
   * etwas zeigt. Genau darauf beruht sowohl das Vorauspuffern als auch der
   * Sprung eines Nachzüglers mitten in den Film.
   */
  it('kündigt Bereichsanfragen an und beantwortet sie mit 206', () => {
    const server = lies('src/main/network-projection.ts')
    expect(server).toContain("'Accept-Ranges': 'bytes'")
    expect(server).toContain('206')
    expect(server).toContain('Content-Range')

    const fenster = lies('src/main/index.ts')
    expect(fenster).toContain("'Accept-Ranges': 'bytes'")
    expect(fenster).toContain('Content-Range')
  })

  /* Ohne `stream` behandelt Chromium die Antwort als ein Stück und spielt
     erst ab, wenn alles da ist. */
  it('gibt dem Videoschema das Recht zu streamen', () => {
    expect(lies('src/main/index.ts')).toMatch(/VIDEO_SCHEME[\s\S]{0,120}stream: true/)
  })

  it('liefert nur das Video aus, das gerade projiziert wird', () => {
    const server = lies('src/main/network-projection.ts')
    expect(server).toContain('getProjectionState().video')
  })
})

describe('Ton nur an einer Stelle', () => {
  /*
   * Zehn Tablets, die denselben Film im Chor tönen, sind unerträglich — und
   * schon Millisekunden Versatz klingen wie ein Echo.
   */
  it('gibt den Ton ausschließlich im Beamerfenster wieder', () => {
    const ansicht = lies('src/renderer/src/audience-main.tsx')
    expect(ansicht).toContain('videoAudio={imFenster}')

    const rahmen = lies('src/renderer/src/projection/VideoFrame.tsx')
    expect(rahmen).toContain('muted={!audio || video.muted}')
  })
})
