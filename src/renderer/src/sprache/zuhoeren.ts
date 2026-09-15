/**
 * Zuhören: Mikrofon, Sprachmodell, erkannter Text. Sonst nichts.
 *
 * ## Warum das hier für sich steht
 *
 * Zwei Dinge in Votura hören zu: Der Prompter sucht damit die **Stelle** im
 * Manuskript, an der gerade gesprochen wird; die Untertitel nehmen den
 * **Text** selbst. Der Weg dorthin ist bis zum erkannten Wort derselbe —
 * Mikrofon holen, Modell laden, Blöcke im Audiofaden einsammeln, Kaldi
 * füttern.
 *
 * Das zweimal zu schreiben hieße, zwei Fassungen desselben heiklen Aufbaus zu
 * pflegen. Und heikel ist er: Abtastrate, Worklet statt ScriptProcessor,
 * vollständige Modelladresse, sicherer Kontext. Jede dieser Stellen hat einen
 * Grund, und der steht hier einmal.
 *
 * ## Aufgezeichnet wird nichts
 *
 * Der Ton geht in die Erkennung und ist danach weg: kein Puffer, keine Datei,
 * kein Weg nach draußen. Was dieses Modul nach außen gibt, sind Wörter — und
 * was damit geschieht, entscheidet, wer es aufruft.
 *
 * ## Warum 16 kHz und ein AudioWorklet
 *
 * Kaldi-Modelle erwarten 16 kHz Mono. Die Umrechnung erledigt der
 * AudioContext, indem er gleich mit dieser Abtastrate geöffnet wird. Die
 * Blöcke holt ein AudioWorklet ab: Es läuft im Audiofaden und liefert
 * gleichmäßig, während der Hauptfaden den Text rollt. Der ältere
 * ScriptProcessor täte dasselbe im Hauptfaden — und würde genau dann stocken,
 * wenn es darauf ankommt.
 */
import { SPRACHMODELL_PFAD } from '@shared/sprachmodell'

export type ZuhoerenStand =
  | { art: 'aus' }
  | { art: 'startet' }
  | { art: 'hoert'; zuletzt: string }
  | { art: 'fehler'; text: string }

export interface ZuhoerenOptionen {
  /**
   * Erkannter Text.
   *
   * `endgueltig` unterscheidet den Zwischenstand vom berichtigten Satz: Kaldi
   * meldet erst mit, was es zu hören glaubt, und später, worauf es sich
   * festlegt. Wer nur auf das Endgültige wartet, bekommt satzweise Sprünge;
   * wer den Unterschied ignoriert, behauptet eine Sicherheit, die es noch
   * nicht gibt.
   */
  aufText: (text: string, endgueltig: boolean) => void
  /** Meldet, wie es dem Zuhören geht. */
  aufStand: (stand: ZuhoerenStand) => void
}

/**
 * Der Sammler liegt als ausgelieferte Datei bereit.
 *
 * Ein AudioWorklet-Modul fällt unter `script-src`; aus einem Blob geladen
 * bräuchte es dort ein `blob:`, und das hieße, beliebig erzeugte Skripte
 * zuzulassen. Als Datei bleibt die Richtlinie eng.
 */
const SAMMLER = 'pult-sammler.js'

/** Läuft, bis `beenden()` gerufen wird. */
export interface Zuhoeren {
  beenden(): void
}

export async function starteZuhoeren(optionen: ZuhoerenOptionen): Promise<Zuhoeren> {
  optionen.aufStand({ art: 'startet' })

  let beendet = false
  let strom: MediaStream | undefined
  let kontext: AudioContext | undefined
  let modell: { terminate(): void } | undefined

  const aufraeumen = (): void => {
    beendet = true
    strom?.getTracks().forEach((spur) => spur.stop())
    void kontext?.close()
    modell?.terminate()
    optionen.aufStand({ art: 'aus' })
  }

  /*
   * Ohne sichere Herkunft kein Mikrofon.
   *
   * Das ist keine Einstellung, sondern eine Regel des Browsers:
   * `getUserMedia` gibt es nur in einem sicheren Kontext. Die Netzansicht
   * läuft über einfaches HTTP im Saalnetz — dort fehlt `navigator.mediaDevices`
   * schlicht. Zugehört wird deshalb nur in einem Fenster am Hauptrechner, das
   * unter eigenem, als sicher angemeldetem Schema läuft.
   */
  if (!navigator.mediaDevices?.getUserMedia) {
    optionen.aufStand({
      art: 'fehler',
      text: 'Zuhören geht nur am Hauptrechner — eine Ansicht über das Netz bekommt kein Mikrofon.'
    })
    return { beenden: () => undefined }
  }

  try {
    /* Erst das Mikrofon, dann das Modell: Ein abgelehntes Mikrofon soll nicht
       45 MB Ladezeit nach sich ziehen, bevor es auffällt. */
    strom = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    })
    if (beendet) throw new Error('abgebrochen')

    /*
     * Die Erkennung wird erst hier geladen.
     *
     * Sie wiegt mehrere Megabyte. Wer weder Prompter noch Untertitel benutzt —
     * der Regelfall —, soll sie nie anfassen müssen.
     */
    const { createModel } = await import('vosk-browser')
    /*
     * Die Adresse muss vollständig sein.
     *
     * Die Erkennung holt das Modell aus ihrem eigenen Worker, und der stammt
     * aus einem Blob — er hat keine Basisadresse, gegen die sich ein relativer
     * Pfad auflösen ließe. `/sprachmodell` scheitert dort mit „Failed to parse
     * URL"; mit der Herkunft davor geht es.
     */
    modell = await createModel(`${location.origin}${SPRACHMODELL_PFAD}`)
    if (beendet) throw new Error('abgebrochen')

    kontext = new AudioContext({ sampleRate: 16000 })
    const erkenner = new (
      modell as unknown as {
        KaldiRecognizer: new (rate: number) => {
          on(ereignis: string, hoerer: (nachricht: unknown) => void): void
          acceptWaveformFloat(daten: Float32Array, rate: number): void
          remove(): void
        }
      }
    ).KaldiRecognizer(kontext.sampleRate)

    erkenner.on('partialresult', (nachricht) => {
      const teil = (nachricht as { result?: { partial?: string } }).result?.partial
      if (teil) {
        optionen.aufStand({ art: 'hoert', zuletzt: teil })
        optionen.aufText(teil, false)
      }
    })
    erkenner.on('result', (nachricht) => {
      const fertig = (nachricht as { result?: { text?: string } }).result?.text
      if (fertig) {
        optionen.aufStand({ art: 'hoert', zuletzt: fertig })
        optionen.aufText(fertig, true)
      }
    })

    await kontext.audioWorklet.addModule(SAMMLER)
    const quelle = kontext.createMediaStreamSource(strom)
    const sammler = new AudioWorkletNode(kontext, 'votura-sammler')
    sammler.port.onmessage = (nachricht) => {
      if (beendet) return
      erkenner.acceptWaveformFloat(nachricht.data as Float32Array, kontext!.sampleRate)
    }
    quelle.connect(sammler)
    /* Ohne Ziel läuft der Graph nicht; Verstärkung null hält ihn still —
       sonst hörte sich der Saal selbst über die Lautsprecher. */
    const stumm = kontext.createGain()
    stumm.gain.value = 0
    sammler.connect(stumm).connect(kontext.destination)

    optionen.aufStand({ art: 'hoert', zuletzt: '' })
  } catch (fehler) {
    const text = fehler instanceof Error ? fehler.message : String(fehler)
    aufraeumen()
    optionen.aufStand({
      art: 'fehler',
      text:
        text.includes('Permission') || text.includes('NotAllowed')
          ? 'Kein Zugriff auf das Mikrofon.'
          : text.includes('404')
            ? 'Kein Sprachmodell hinterlegt.'
            : `Zuhören nicht möglich: ${text}`
    })
    return { beenden: () => undefined }
  }

  return { beenden: aufraeumen }
}
