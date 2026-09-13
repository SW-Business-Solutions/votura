/**
 * Sammelt die Tonblöcke für die Spracherkennung am Pult.
 *
 * Eine eigene Datei und kein Blob: Ein AudioWorklet-Modul fällt unter
 * `script-src`, und ein `blob:` dort zuzulassen hieße, der Prompterseite das
 * Ausführen beliebig erzeugter Skripte zu erlauben. Als ausgelieferte Datei
 * bleibt die Richtlinie eng — und die zwölf Zeilen sind hier so gut lesbar
 * wie sonst wo.
 *
 * Der Prozessor tut nur eines: Er reicht jeden Block, den der Audiofaden ihm
 * gibt, an den Hauptfaden weiter. Gerechnet wird woanders; hier darf nichts
 * hängenbleiben, sonst knackst der Ton.
 */
class SammlerProzessor extends AudioWorkletProcessor {
  process(eingang) {
    const kanal = eingang[0] && eingang[0][0]
    if (kanal) this.port.postMessage(new Float32Array(kanal))
    return true
  }
}

registerProcessor('votura-sammler', SammlerProzessor)
