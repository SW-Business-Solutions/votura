/**
 * Das Zuhörerfenster — ein Fenster, das niemand sieht.
 *
 * ## Warum es überhaupt ein Fenster ist
 *
 * Untertitel brauchen ein Mikrofon und eine Spracherkennung. Beides bekommt in
 * Votura nicht jedes Fenster:
 *
 * - **Das Mikrofon** gibt der Hauptprozess nur Fenstern, die zuhören sollen
 *   (`src/main/medienrechte.ts`). Die Bedienoberfläche gehört ausdrücklich
 *   nicht dazu — dort hätte ein Mikrofon nichts zu suchen.
 * - **Die Erkennung** läuft in einem Web Worker, und den verweigert Chromium
 *   auf Seiten ohne Herkunft. Die Bedienoberfläche kommt aus einer Datei und
 *   hat keine.
 *
 * Der erste Versuch ließ die Erkennung in der Bedienoberfläche laufen und
 * scheiterte an beidem zugleich. Ein eigenes Fenster unter dem Pult-Schema
 * löst beides — und behält nebenbei die Regel, die dahintersteht: **ein
 * Fenster, ein Grund, ein Gerät.** Wer wissen will, wer hier zuhört, findet
 * genau diese Datei.
 *
 * ## Warum es versteckt ist
 *
 * Es gibt nichts zu bedienen. Der Text erscheint an der Wand, der Schalter
 * steht in der Beamer-Ansicht; ein leeres Fenster in der Leiste wäre nur eine
 * Stelle, an der jemand aus Versehen auf „Schließen" klickt.
 *
 * ## Es ist nicht der einzige Ort
 *
 * Steht die Quelle auf **Pult**, öffnet der Hauptprozess dieses Fenster gar
 * nicht erst; dann hört das Prompterfenster zu — das ebenso gut auf einem
 * Saalgerät am Rednerpult laufen kann, dort, wo gesprochen wird. Die Rechnung
 * dahinter ist an beiden Orten dieselbe und steht in
 * `@renderer/sprache/untertitelgeber`.
 *
 * ## Aufgezeichnet wird nichts
 *
 * Der Ton geht in die Erkennung und ist danach weg. Der Puffer fasst zwei
 * Zeilen — gerade so viel, wie an der Wand steht.
 */
import type { ProjectionUntertitel } from '@shared/untertitel'
import { starteUntertitelgeber } from './sprache/untertitelgeber'

declare global {
  interface Window {
    voturaZuhoerer?: { melde(stand: ProjectionUntertitel): void }
  }
}

const bruecke = window.voturaZuhoerer

void starteUntertitelgeber({
  melde: (stand) => bruecke?.melde(stand),
  aufStand: (stand) => {
    /*
     * Niemand sieht dieses Fenster, also geht die Meldung in die Konsole des
     * Hauptprozesses — dorthin, wo bei einer Störung ohnehin nachgesehen
     * wird. Der Schalter in der Bedienung bleibt oben; dass die Erkennung
     * nicht anspringt, zeigt sich an der leeren Wand.
     */
    if (stand.art === 'fehler') console.error('[Zuhörer]', stand.text)
    if (stand.art === 'aus') console.info('[Zuhörer] beendet')
  }
})
