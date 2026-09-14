/**
 * Was eine Netzwerkadresse ist — reine Rechnerei.
 *
 * Steht hier und nicht bei der Oberfläche, damit es ohne Browser prüfbar ist:
 * Ob `192.168.500.1` eine Adresse ist, entscheidet keine Eingabemaske.
 */

/** Sieht das nach einer IPv4-Adresse aus? Vier Zahlen von 0 bis 255. */
export function istAdresse(wert: string): boolean {
  const teile = wert.trim().split('.')
  return (
    teile.length === 4 &&
    teile.every((teil) => /^\d{1,3}$/.test(teil) && Number(teil) >= 0 && Number(teil) <= 255)
  )
}

/** Eine Adresse als Zahl — zum Vergleichen von Bereichsgrenzen. */
export function adresseAlsZahl(adresse: string): number {
  return adresse.split('.').reduce((summe, teil) => summe * 256 + Number(teil), 0)
}
