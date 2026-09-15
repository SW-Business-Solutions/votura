/**
 * Wer Kamera und Mikrofon bekommt.
 *
 * Die Entscheidung stand früher als Verschluss mitten im Hochlauf. Sie gehört
 * hierher, weil sie eine Sicherheitsentscheidung ist und als solche prüfbar
 * sein muss: Ein Fenster, das versehentlich ein Mikrofon bekommt, fällt
 * niemandem auf — ein Fenster, das versehentlich keines bekommt, fällt erst
 * im Saal auf.
 *
 * **Das Mikrofon** bekommen zwei Fenster, und beide tun damit dasselbe:
 * zuhören. Das **Pult** braucht es, damit der Teleprompter mitläuft, wo im
 * Manuskript gerade gesprochen wird. Das **Zuhörerfenster** braucht es für die
 * Untertitel an der Wand; es ist versteckt, hat keine Oberfläche und kann über
 * seine Brücke genau eines — erkannten Text melden.
 *
 * In beiden Fällen gilt dasselbe: aufgenommen wird nichts, der Ton verlässt
 * das Gerät nicht, und die Erkennung läuft an Ort und Stelle.
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
 * Ist das eine Seite, die zuhören darf?
 *
 * Zwei sind es: die **Prompterseite** am Pult und das versteckte
 * **Zuhörerfenster** der Untertitel. Beide laden im fertigen Programm unter
 * eigenem Schema — sie brauchen eine echte Herkunft, sonst verweigert Chromium
 * ihnen den Worker der Spracherkennung.
 *
 * **Beim Entwickeln** kommen sie wie jede andere Seite vom Vite-Server und
 * sind nur am Pfad zu erkennen. Ohne diesen zweiten Zweig hätten sie beim
 * Entwickeln nie ein Mikrofon, und „Nach Stimme" wie Untertitel ließen sich
 * ausgerechnet dort nicht ausprobieren, wo daran gearbeitet wird.
 *
 * Dass das Schema allein genügt, ist Absicht und keine Nachlässigkeit: Unter
 * `PULT_SCHEME` liegen genau diese beiden Seiten, und der Protokollbehandler
 * in `index.ts` liefert nichts aus, was nicht im Oberflächenordner steht.
 */
export function darfZuhoeren(url: string, entwicklung?: string): boolean {
  if (url.startsWith(`${PULT_SCHEME}://`)) return true
  if (!entwicklung) return false
  return (
    url.startsWith(`${entwicklung}/teleprompter.html`) ||
    url.startsWith(`${entwicklung}/zuhoerer.html`)
  )
}

/**
 * Ist das die eigene Bedienoberfläche?
 *
 * Nicht das Pult, nicht eine eingespeiste Präsentation — und im Betrieb nur,
 * was aus dem Paket geladen wurde.
 */
export function istEigeneOberflaeche(url: string, entwicklung?: string): boolean {
  if (url.startsWith(`${PRESENTATION_SCHEME}://`) || darfZuhoeren(url, entwicklung)) return false
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
      ? darfZuhoeren(url, entwicklung)
      : art === 'video'
        ? istEigeneOberflaeche(url, entwicklung)
        : false
  )
}
