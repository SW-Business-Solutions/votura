/**
 * Aus dem Gelesenen den Ausweis machen.
 *
 * Steht hier und nicht bei der Kamera, weil es reine Rechnerei ist: kein
 * Bild, kein Browser, keine Oberfläche — und damit ohne Kamera prüfbar.
 */

/**
 * Den Ausweis aus dem Gelesenen herausholen.
 *
 * Auf Karten, Bändchen und gedruckten Pässen steht der nackte Code. Steht im
 * QR-Code dagegen eine Adresse, zählt der Teil hinter `c=`: Den ganzen Link
 * ins Feld zu schreiben hieße, jeder Prüfung einen Unbekannten vorzulegen.
 *
 * Großgeschrieben wird immer. Das Alphabet der Pässe kennt keine
 * Kleinbuchstaben, und ein Scanner, der welche liefert, soll deshalb nicht
 * scheitern.
 */
export function codeAus(gelesen: string): string {
  const roh = gelesen.trim()
  if (!/^https?:\/\//i.test(roh)) return roh.toUpperCase()
  try {
    return (new URL(roh).searchParams.get('c') ?? roh).toUpperCase()
  } catch {
    return roh.toUpperCase()
  }
}
