/**
 * Mithören am Pult: Mikrofon, Erkennung, Abgleich mit dem Manuskript.
 *
 * ## Was hier passiert — und was nicht
 *
 * Aufgenommen wird nichts. Der Ton geht in die Erkennung und ist danach weg;
 * es gibt keinen Puffer, keine Datei, keinen Weg nach draußen. Nach außen
 * wandert allein eine Zahl: die Stelle im Manuskript.
 *
 * ## Warum ein kleines Modell genügt
 *
 * Die Erkennung muss nicht diktieren, sondern **wiederfinden**. Der Text
 * steht bereits da; gesucht wird nur, wo darin gerade gesprochen wird. Ein
 * paar halbwegs erkannte Wörter reichen dafür — siehe `@shared/mitlauf`.
 *
 * ## Warum 16 kHz und ein AudioWorklet
 *
 * Kaldi-Modelle erwarten 16 kHz Mono. Die Umrechnung erledigt der
 * AudioContext, indem er gleich mit dieser Abtastrate geöffnet wird. Die
 * Blöcke holt ein AudioWorklet ab: Es läuft im Audiofaden und liefert
 * gleichmäßig, während der Hauptfaden den Text rollt. Der ältere
 * ScriptProcessor täte dasselbe im Hauptfaden — und würde genau dann
 * stocken, wenn es darauf ankommt.
 */
import { mitlaufStelle, wortfolge } from '@shared/mitlauf'
import { SPRACHMODELL_PFAD } from '@shared/sprachmodell'

/** Wie viele zuletzt gehörte Wörter für den Abgleich herangezogen werden. */
const GEDAECHTNIS = 12

export type MithoerenStand =
  { art: 'aus' } | { art: 'startet' } | { art: 'hoert'; zuletzt: string } | { art: 'fehler'; text: string }

export interface MithoerenOptionen {
  /** Das Manuskript, in dem gesucht wird. */
  manuskript: string
  /** Wo der Prompter gerade steht (Wortindex) — wird laufend nachgereicht. */
  stand: () => number
  /** Meldet eine neue Stelle. */
  aufStelle: (position: number) => void
  /** Meldet, wie es dem Mithören geht. */
  aufStand: (stand: MithoerenStand) => void
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
export interface Mithoeren {
  beenden(): void
}

export async function starteMithoeren(optionen: MithoerenOptionen): Promise<Mithoeren> {
  optionen.aufStand({ art: 'startet' })

  const manuskript = wortfolge(optionen.manuskript)
  /* Die zuletzt gehörten Wörter — mehr braucht der Abgleich nicht, und mehr
     machte ihn nur träge. */
  let gehoert: string[] = []

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
   * Das ist keine Einstellung, sondern eine Regel des Browsers: `getUserMedia`
   * gibt es nur in einem sicheren Kontext. Die Netzansicht läuft über
   * einfaches HTTP im Saalnetz — dort fehlt `navigator.mediaDevices`
   * schlicht. Mithören ist deshalb dem Fenster am Hauptrechner vorbehalten,
   * das unter eigenem, als sicher angemeldetem Schema läuft.
   */
  if (!navigator.mediaDevices?.getUserMedia) {
    optionen.aufStand({
      art: 'fehler',
      text: 'Mithören geht nur im Prompterfenster am Hauptrechner — eine Ansicht über das Netz bekommt kein Mikrofon.'
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
     * Sie wiegt mehrere Megabyte. Wer den Prompter ohne Mithören benutzt —
     * der Regelfall —, soll sie nie anfassen müssen.
     */
    const { createModel } = await import('vosk-browser')
    /*
     * Die Adresse muss vollständig sein.
     *
     * Die Erkennung holt das Modell aus ihrem eigenen Worker, und der stammt
     * aus einem Blob — er hat keine Basisadresse, gegen die sich ein
     * relativer Pfad auflösen ließe. `/sprachmodell` scheitert dort mit
     * „Failed to parse URL"; mit der Herkunft davor geht es.
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

    const verarbeite = (text: string): void => {
      const neu = wortfolge(text)
      if (neu.length === 0) return
      gehoert = [...gehoert, ...neu].slice(-GEDAECHTNIS)
      optionen.aufStand({ art: 'hoert', zuletzt: neu.join(' ') })
      const stelle = mitlaufStelle(manuskript, gehoert, optionen.stand())
      optionen.aufStelle(stelle)
    }

    /*
     * Beide Meldungen zählen.
     *
     * `partialresult` kommt schon während des Sprechens und hält den Text in
     * Bewegung; `result` kommt am Satzende und ist genauer. Nur auf das Ende
     * zu warten, ließe den Prompter satzweise ruckeln.
     */
    erkenner.on('partialresult', (nachricht) => {
      const teil = (nachricht as { result?: { partial?: string } }).result?.partial
      if (teil) verarbeite(teil)
    })
    erkenner.on('result', (nachricht) => {
      const fertig = (nachricht as { result?: { text?: string } }).result?.text
      if (fertig) verarbeite(fertig)
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
            : `Mithören nicht möglich: ${text}`
    })
    return { beenden: () => undefined }
  }

  return { beenden: aufraeumen }
}
