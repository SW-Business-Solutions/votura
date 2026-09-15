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
 * Für das große deutsche Modell stand hier zunächst keine — zwei Gigabyte
 * einmal zu laden, nur um eine Zeile zu schreiben, schien zu viel. Sie wurde
 * nachgetragen, als das Modell ohnehin einmal durch die Leitung ging.
 *
 * Das Feld bleibt trotzdem **freiwillig**, und die Oberfläche zeigt weiter
 * an, was geprüft wird. Käme je ein Eintrag ohne Prüfsumme dazu, soll das zu
 * sehen sein statt verborgen: Eine erfundene wäre schlimmer als keine — sie
 * behauptete eine Sicherheit, die es nicht gibt.
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
 * Hier stehen die drei deutschen Stufen und ein englisches für Gäste.
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
    datei: 'vosk-model-de-0.21.zip',
    name: 'Deutsch, groß',
    sprache: 'Deutsch',
    bytes: 2_031_717_803,
    sha256: '245060756f8d8394fc5b13639cf220b7620205795f30f37b6823878d4f603b2a',
    hinweis:
      'Das große deutsche Modell — die eigentliche Verbesserung für Untertitel. Zwei Gigabyte, und es braucht beim ersten Start spürbar länger.'
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
