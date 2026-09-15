/**
 * Wer Kamera und Mikrofon bekommt.
 *
 * Die Entscheidung stand früher als Verschluss mitten im Hochlauf. Sie gehört
 * hierher, weil sie eine Sicherheitsentscheidung ist und als solche prüfbar
 * sein muss: Ein Fenster, das versehentlich ein Mikrofon bekommt, fällt
 * niemandem auf — ein Fenster, das versehentlich keines bekommt, fällt erst
 * im Saal auf.
 *
 * **Das Mikrofon** bekommt allein das Pult. Damit hört der Teleprompter mit,
 * wo im Manuskript gerade gesprochen wird; aufgenommen wird nichts, der Ton
 * verlässt das Gerät nicht, und die Erkennung läuft an Ort und Stelle.
 *
 * **Die Kamera** bekommt allein die eigene Bedienoberfläche, weil dort
 * QR-Codes gescannt werden: am Einlass und an der Ausgabe.
 *
 * Die Trennung ist keine Feinheit: Ein Mikrofon in der Bedienoberfläche hätte
 * nichts zu suchen, eine Kamera am Pult ebenso wenig.
 */
import { PRESENTATION_SCHEME } from '@shared/presentation'
import { PULT_SCHEME } from '@shared/speech'

/**
 * Ist das die Prompterseite?
 *
 * Im fertigen Programm lädt sie unter eigenem Schema — sie braucht eine echte
 * Herkunft, sonst verweigert Chromium ihr den Worker der Spracherkennung.
 * **Beim Entwickeln** kommt sie wie jede andere Seite vom Vite-Server und ist
 * nur am Pfad zu erkennen. Ohne diesen zweiten Zweig hat das Pult beim
 * Entwickeln nie ein Mikrofon, und „Nach Stimme" ließe sich ausgerechnet
 * dort nicht ausprobieren, wo daran gearbeitet wird.
 */
export function istPult(url: string, entwicklung?: string): boolean {
  if (url.startsWith(`${PULT_SCHEME}://`)) return true
  return Boolean(entwicklung) && url.startsWith(`${entwicklung}/teleprompter.html`)
}

/**
 * Ist das die eigene Bedienoberfläche?
 *
 * Nicht das Pult, nicht eine eingespeiste Präsentation — und im Betrieb nur,
 * was aus dem Paket geladen wurde.
 */
export function istEigeneOberflaeche(url: string, entwicklung?: string): boolean {
  if (url.startsWith(`${PRESENTATION_SCHEME}://`) || istPult(url, entwicklung)) return false
  if (entwicklung && url.startsWith(entwicklung)) return true
  return url.startsWith('file://')
}

/**
 * Darf diese Seite diese Geräte benutzen?
 *
 * Gefragt wird nach einer Liste — eine Anfrage kann Kamera **und** Mikrofon
 * zugleich meinen. Dann muss beides erlaubt sein, sonst nichts: Eine Seite,
 * die Ton und Bild zusammen verlangt, bekommt nicht stillschweigend die
 * Hälfte. Eine leere Liste ist keine Erlaubnis.
 */
export function darfMedium(url: string, arten: string[], entwicklung?: string): boolean {
  if (arten.length === 0) return false
  return arten.every((art) =>
    art === 'audio'
      ? istPult(url, entwicklung)
      : art === 'video'
        ? istEigeneOberflaeche(url, entwicklung)
        : false
  )
}
