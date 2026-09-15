/**
 * Bekannte Sprachmodelle — die Liste, aus der sich eines nachladen lässt.
 *
 * ## Warum überhaupt eine Liste
 *
 * Bisher hieß die einzige Antwort auf „das Modell versteht mich schlecht":
 * Gehen Sie auf alphacephei.com, suchen Sie das richtige Archiv heraus, laden
 * Sie es herunter, kommen Sie zurück und hinterlegen Sie es. Drei davon sind
 * Schritte, die ein Programm selbst tun kann.
 *
 * ## Warum trotzdem kein automatischer Bezug
 *
 * Votura läuft offline. Diese Liste ändert daran nichts: Geladen wird **nur**
 * auf ausdrücklichen Klick, nie beim Start, nie im Hintergrund, und die
 * Adressen stehen hier im Quelltext statt in einem Verzeichnisdienst, den
 * jemand austauschen könnte. Wer den Rechner nie ans Netz hängt, merkt von
 * dieser Datei nichts — das mitgelieferte Modell liegt im Paket.
 *
 * ## Warum Prüfsummen
 *
 * Ein halb geladenes Archiv fällt sonst erst am Pult auf. Größe **und**
 * SHA-256 sind deshalb vorab festgeschrieben — nachgesehen an dem, was der
 * Server heute ausliefert, nicht abgeschrieben.
 *
 * Das Feld bleibt **freiwillig**, und die Oberfläche zeigt an, was geprüft
 * wird. Käme je ein Eintrag ohne Prüfsumme dazu, soll das zu sehen sein statt
 * verborgen: Eine erfundene wäre schlimmer als keine — sie behauptete eine
 * Sicherheit, die es nicht gibt.
 *
 * ## Warum hier kein großes Modell steht
 *
 * Siehe `MODELL_HOECHSTGROESSE`. Kurz: Die Erkennung kann es nicht laden.
 */

export interface Modellangebot {
  /** Dateiname des Archivs — zugleich die Kennung. */
  datei: string
  /** Wie es in der Oberfläche heißt. */
  name: string
  sprache: string
  /** Genaue Größe in Bytes, wie der Server sie meldet. */
  bytes: number
  /**
   * SHA-256 des Archivs, sofern festgeschrieben.
   *
   * Fehlt sie, wird nur die Größe geprüft — und die Oberfläche sagt es.
   */
  sha256?: string
  /** Ein Satz dazu, wofür es taugt. */
  hinweis: string
}

/**
 * Wie groß ein Modell höchstens sein darf.
 *
 * **Das ist keine Sparsamkeit, sondern eine harte Grenze der Erkennung.**
 *
 * Hier stand einmal das große deutsche Modell mit 1,9 GB, empfohlen für
 * Untertitel. Es lädt sauber herunter, es wird geprüft, es wird hinterlegt —
 * und dann bleibt die Wand leer. In der Konsole des Zuhörerfensters steht
 * `RangeError: Array buffer allocation failed`: Die Erkennung läuft in
 * WebAssembly und packt das Archiv in **einen** Puffer aus. So groß wird der
 * dort nicht.
 *
 * Ein Knopf, der zwei Gigabyte lädt und danach zuverlässig nichts tut, ist
 * schlimmer als kein Knopf. Der Eintrag ist deshalb wieder verschwunden.
 *
 * Wo genau die Grenze liegt, ist **nicht gemessen** — 51 MB laufen, 1,9 GB
 * scheitern. Die Schranke hier ist daher bewusst weit unter dem, was
 * nachweislich scheitert, und weit über dem, was nachweislich läuft. Wer sie
 * anhebt, um ein größeres Modell aufzunehmen, muss es vorher ausprobiert
 * haben — nicht überschlagen.
 */
export const MODELL_HOECHSTGROESSE = 400 * 1024 * 1024

/** Woher die Modelle kommen. */
export const MODELL_QUELLE = 'https://alphacephei.com/vosk/models/'

/** Die Adresse eines Angebots. */
export function modellAdresse(angebot: Modellangebot): string {
  return `${MODELL_QUELLE}${angebot.datei}`
}

/**
 * Die Auswahl ist bewusst kurz.
 *
 * Vosk führt Modelle für vier Dutzend Sprachen. Votura führt Versammlungen
 * auf Deutsch; eine vollständige Liste wäre eine Suchaufgabe, keine Hilfe.
 * Hier stehen die beiden kleinen deutschen und ein englisches für Gäste —
 * und nichts Größeres, siehe `MODELL_HOECHSTGROESSE`.
 */
export const BEKANNTE_MODELLE: Modellangebot[] = [
  {
    datei: 'vosk-model-small-de-0.15.zip',
    name: 'Deutsch, klein',
    sprache: 'Deutsch',
    bytes: 46_499_967,
    sha256: 'b7e53c90b1f0a38456f4cd62b366ecd58803cd97cd42b06438e2c131713d5e43',
    hinweis:
      'Das mitgelieferte Modell. Für den Prompter genügt es — der muss nicht diktieren, sondern eine Stelle wiederfinden.'
  },
  {
    datei: 'vosk-model-small-de-zamia-0.3.zip',
    name: 'Deutsch, klein (Zamia)',
    sprache: 'Deutsch',
    bytes: 51_238_078,
    sha256: 'f8b080a69799bfb59402537d981edfcc59e9860e56b507c538d6eb8ac41dd4a6',
    hinweis:
      'Ein zweites kleines deutsches Modell, anders trainiert. Einen Versuch wert, wenn das mitgelieferte an einer Stimme scheitert.'
  },
  {
    datei: 'vosk-model-small-en-us-0.15.zip',
    name: 'Englisch, klein',
    sprache: 'Englisch',
    bytes: 41_205_931,
    sha256: '30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498',
    hinweis: 'Für eine Versammlung, auf der englisch gesprochen wird — oder für ein Grußwort.'
  }
]

/** Stand des Ladens, für die Oberfläche. */
export interface ModellLadestand {
  datei: string
  /** Geladene Bytes. */
  geladen: number
  bytes: number
  /** Fertig, abgebrochen oder gescheitert. */
  fertig?: boolean
  fehler?: string
}
