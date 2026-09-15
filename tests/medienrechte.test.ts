/**
 * Wer Kamera und Mikrofon bekommt — und wer nicht.
 *
 * Diese Entscheidung stand als Verschluss mitten im Hochlauf des
 * Hauptprozesses und war damit nur im laufenden Programm zu beobachten. Genau
 * dort fällt sie aber nicht auf: Ein Fenster, das versehentlich ein Mikrofon
 * bekommt, meldet sich nicht — und eines, das versehentlich keines bekommt,
 * erst im Saal.
 */
import { describe, expect, it } from 'vitest'
import { darfMedium, darfZuhoeren, istEigeneOberflaeche } from '../src/main/medienrechte'

const PULT = 'votura-pult://pult/teleprompter.html'
const OBERFLAECHE = 'file:///C:/Programme/Votura/resources/app.asar/out/renderer/index.html'
const PRAESENTATION = 'votura-praesentation://folien/index.html'
const DEV = 'http://localhost:5173'

describe('Das Mikrofon bekommt allein das Pult', () => {
  it('gibt es der Prompterseite', () => {
    expect(darfMedium(PULT, ['audio'])).toBe(true)
  })

  it('verweigert es der Bedienoberfläche', () => {
    /* Ein Mikrofon in der Bedienung hätte nichts zu suchen. */
    expect(darfMedium(OBERFLAECHE, ['audio'])).toBe(false)
  })

  it('verweigert es einer eingespeisten Präsentation', () => {
    expect(darfMedium(PRAESENTATION, ['audio'])).toBe(false)
    expect(darfMedium(PRAESENTATION, ['video'])).toBe(false)
  })
})

describe('Die Kamera bekommt allein die Bedienoberfläche', () => {
  it('gibt sie der eigenen Oberfläche — dort werden Ausweise gescannt', () => {
    expect(darfMedium(OBERFLAECHE, ['video'])).toBe(true)
  })

  it('verweigert sie am Pult', () => {
    expect(darfMedium(PULT, ['video'])).toBe(false)
  })
})

describe('In der Entwicklungsfassung kommt alles vom selben Server', () => {
  /*
   * Der Fehler, der diesen Test veranlasst hat: Das Pult bekam beim
   * Entwickeln nie ein Mikrofon, weil es dort nicht unter seinem eigenen
   * Schema lädt, sondern wie jede andere Seite vom Vite-Server. „Nach Stimme"
   * ließ sich ausgerechnet dort nicht ausprobieren, wo daran gearbeitet wird.
   */
  it('erkennt das Pult am Pfad', () => {
    expect(darfZuhoeren(`${DEV}/teleprompter.html`, DEV)).toBe(true)
    expect(darfMedium(`${DEV}/teleprompter.html`, ['audio'], DEV)).toBe(true)
  })

  it('gibt der Bedienoberfläche die Kamera, aber kein Mikrofon', () => {
    expect(darfMedium(`${DEV}/`, ['video'], DEV)).toBe(true)
    expect(darfMedium(`${DEV}/`, ['audio'], DEV)).toBe(false)
  })

  it('gibt dem Pult keine Kamera', () => {
    expect(istEigeneOberflaeche(`${DEV}/teleprompter.html`, DEV)).toBe(false)
    expect(darfMedium(`${DEV}/teleprompter.html`, ['video'], DEV)).toBe(false)
  })

  it('erkennt den Pfad nur, wenn überhaupt entwickelt wird', () => {
    /* Ohne Entwicklungsadresse zählt allein das Schema — sonst wäre eine
       beliebige Seite namens teleprompter.html ein Pult. */
    expect(darfZuhoeren(`${DEV}/teleprompter.html`)).toBe(false)
    expect(darfMedium(`${DEV}/teleprompter.html`, ['audio'])).toBe(false)
  })
})

describe('Alles andere bekommt nichts', () => {
  it('weist eine leere Anfrage ab', () => {
    expect(darfMedium(PULT, [])).toBe(false)
    expect(darfMedium(OBERFLAECHE, [])).toBe(false)
  })

  it('weist unbekannte Arten ab', () => {
    expect(darfMedium(OBERFLAECHE, ['midi'])).toBe(false)
    expect(darfMedium(PULT, ['unknown'])).toBe(false)
  })

  it('gibt nicht die Hälfte, wenn beides verlangt wird', () => {
    /* Eine Seite, die Ton und Bild zusammen anfragt, bekommt entweder beides
       oder nichts — stillschweigend die Hälfte wäre eine Überraschung. */
    expect(darfMedium(PULT, ['audio', 'video'])).toBe(false)
    expect(darfMedium(OBERFLAECHE, ['audio', 'video'])).toBe(false)
  })

  it('gibt einer fremden Adresse nichts', () => {
    expect(darfMedium('https://beispiel.invalid/', ['video'])).toBe(false)
    expect(darfMedium('https://beispiel.invalid/', ['audio'])).toBe(false)
  })
})
