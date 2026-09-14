/**
 * Blindsignaturen — das Rechenwerk hinter der geheimen digitalen Wahl.
 *
 * ## Wozu
 *
 * Zwei getrennte Tabellen auf einem Rechner sind **keine** Trennung. Schreibt
 * die eine „Pass 001 → Berechtigung ausgegeben, 19:43:12" und die andere
 * „Stimme eingegangen, 19:43:20", ist die Zuordnung trivial — bei Leuten, die
 * nacheinander an die Kabine treten, genügt die Reihenfolge, ganz ohne
 * Datenbank.
 *
 * Deshalb erzeugt **das Endgerät** die Seriennummer seines Stimmzettels selbst
 * und lässt sie sich *verblendet* unterschreiben. Die Berechtigungsseite sieht
 * dabei nur eine Zufallszahl. Der Unterschied zu „wir speichern die Verbindung
 * nicht" ist der entscheidende: Sie **kann** sie nicht herstellen.
 *
 * ```
 *   Gerät         s zufällig wählen, m = H(s), verblenden: m · rᵉ mod n
 *      ↓ verblendeter Wert
 *   Server        signiert roh:      (m · rᵉ)ᵈ = mᵈ · r  mod n
 *      ↓ Blindsignatur
 *   Gerät         durch r teilen  →  mᵈ = Signatur über s
 *      ↓ s, Signatur, Stimme
 *   Urne          prüft sigᵉ = H(s)
 * ```
 *
 * ## Warum hier BigInt und nicht die Krypto-Schnittstelle
 *
 * Das Verblenden läuft auf dem Telefon eines Teilnehmers, das Signieren im
 * Hauptprozess. Beide brauchen dieselbe Rechnung, und `crypto.subtle` kennt
 * keine Blindsignatur — sie ist keine der standardisierten Operationen. Übrig
 * bleibt Modulararithmetik, und die ist mit BigInt in beiden Welten gleich.
 *
 * Gehasht wird dagegen **nicht** selbst: Die Prüfsumme kommt von außen herein
 * (`node:crypto` im Hauptprozess, `crypto.subtle` im Browser). Eine eigene
 * SHA-256-Implementierung wäre die Art Rad, die man nicht neu erfindet.
 *
 * ## Grenze
 *
 * Das Verfahren ist bekannt und nachrechenbar (Chaum 1982; RFC 9474
 * beschreibt die heutige Fassung mit PSS-Kodierung). **Diese Umsetzung ist
 * nicht extern geprüft.** Dass ein Verfahren richtig ist, heißt nicht, dass
 * seine Umsetzung es ist — und das muss jemand anderes feststellen als der,
 * der sie gebaut hat. Siehe `docs/bedrohungsmodell-digitale-wahl.md`.
 */

/** Ein öffentlicher Schlüssel, wie er auf der Leinwand steht: Modulus und Exponent. */
export interface OeffentlicherSchluessel {
  /** Modulus n, base64url, große Zahl zuerst. */
  n: string
  /** Öffentlicher Exponent e, base64url. */
  e: string
}

/** Eine Prüfsummenfunktion von außen — Node oder Browser liefern sie. */
export type Pruefsumme = (daten: Uint8Array) => Promise<Uint8Array>

/* --------------------------------------------------------------- Umrechnen */

export function zuBigInt(bytes: Uint8Array): bigint {
  let wert = 0n
  for (const byte of bytes) wert = (wert << 8n) | BigInt(byte)
  return wert
}

export function zuBytes(wert: bigint, laenge: number): Uint8Array {
  const bytes = new Uint8Array(laenge)
  let rest = wert
  for (let stelle = laenge - 1; stelle >= 0; stelle--) {
    bytes[stelle] = Number(rest & 0xffn)
    rest >>= 8n
  }
  return bytes
}

export function zuBase64Url(bytes: Uint8Array): string {
  let roh = ''
  for (const byte of bytes) roh += String.fromCharCode(byte)
  const b64 = typeof btoa === 'function' ? btoa(roh) : Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function ausBase64Url(wert: string): Uint8Array {
  const b64 = wert.replace(/-/g, '+').replace(/_/g, '/')
  if (typeof atob === 'function') {
    const roh = atob(b64)
    const bytes = new Uint8Array(roh.length)
    for (let stelle = 0; stelle < roh.length; stelle++) bytes[stelle] = roh.charCodeAt(stelle)
    return bytes
  }
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

/* ------------------------------------------------------------ Rechenwerk */

/** Modulare Potenz nach dem Verfahren Quadrieren-und-Multiplizieren. */
export function modPot(basis: bigint, exponent: bigint, modulus: bigint): bigint {
  let ergebnis = 1n
  let b = basis % modulus
  let e = exponent
  while (e > 0n) {
    if (e & 1n) ergebnis = (ergebnis * b) % modulus
    b = (b * b) % modulus
    e >>= 1n
  }
  return ergebnis
}

/**
 * Das multiplikative Inverse — mit dem erweiterten euklidischen Verfahren.
 *
 * Gebraucht beim Entblenden: Aus `mᵈ · r` wird `mᵈ`, indem durch r geteilt
 * wird, und Teilen heißt im Restklassenring Multiplizieren mit dem Inversen.
 */
export function modInvers(wert: bigint, modulus: bigint): bigint {
  let [alt, neu] = [modulus, wert % modulus]
  let [altK, neuK] = [0n, 1n]
  while (neu !== 0n) {
    const quotient = alt / neu
    ;[alt, neu] = [neu, alt - quotient * neu]
    ;[altK, neuK] = [neuK, altK - quotient * neuK]
  }
  if (alt !== 1n) throw new Error('Zu diesem Wert gibt es kein Inverses.')
  return ((altK % modulus) + modulus) % modulus
}

/** Größter gemeinsamer Teiler — prüft, ob ein Zufallsfaktor überhaupt taugt. */
function ggT(a: bigint, b: bigint): bigint {
  let [x, y] = [a, b]
  while (y !== 0n) [x, y] = [y, x % y]
  return x
}

/**
 * MGF1 — die Maskenfunktion aus PKCS#1.
 *
 * Sie dehnt eine Prüfsumme auf beliebige Länge, indem sie fortlaufend
 * `H(seed ‖ zähler)` aneinanderhängt. Hier bildet sie die Seriennummer auf
 * eine Zahl ab, die fast den ganzen Zahlenraum ausfüllt.
 *
 * **Warum nicht einfach SHA-256?** Weil die Signatur sonst über 32 Byte in
 * einem 256-Byte-Raum liefe. Ein Angreifer könnte dann Signaturen aus anderen
 * Signaturen zusammensetzen — RSA ist multiplikativ, und kleine strukturierte
 * Werte machen das leicht. Eine Abbildung über den ganzen Bereich verhindert
 * es; man nennt das einen Full-Domain-Hash.
 */
export async function mgf1(seed: Uint8Array, laenge: number, pruefsumme: Pruefsumme): Promise<Uint8Array> {
  const teile: Uint8Array[] = []
  let gesammelt = 0
  for (let zaehler = 0; gesammelt < laenge; zaehler++) {
    const eingabe = new Uint8Array(seed.length + 4)
    eingabe.set(seed, 0)
    eingabe[seed.length] = (zaehler >>> 24) & 0xff
    eingabe[seed.length + 1] = (zaehler >>> 16) & 0xff
    eingabe[seed.length + 2] = (zaehler >>> 8) & 0xff
    eingabe[seed.length + 3] = zaehler & 0xff
    const block = await pruefsumme(eingabe)
    teile.push(block)
    gesammelt += block.length
  }
  const alles = new Uint8Array(gesammelt)
  let stelle = 0
  for (const teil of teile) {
    alles.set(teil, stelle)
    stelle += teil.length
  }
  return alles.slice(0, laenge)
}

/** Die Länge des Modulus in Bytes. */
export function schluessellaenge(schluessel: OeffentlicherSchluessel): number {
  return ausBase64Url(schluessel.n).length
}

/**
 * Die Seriennummer auf eine Zahl im Zahlenraum abbilden.
 *
 * **Ein Byte kürzer als der Modulus.** Damit ist das Ergebnis immer kleiner
 * als n, ohne dass gerechnet werden muss — n hat sein oberstes Bit gesetzt.
 * Eine Restbildung `mod n` wäre der naheliegende Weg und verzerrte die
 * Verteilung an genau einer Stelle; kürzen tut das nicht.
 */
export async function seriennummerAufZahl(
  seriennummer: Uint8Array,
  schluessel: OeffentlicherSchluessel,
  pruefsumme: Pruefsumme
): Promise<bigint> {
  const laenge = schluessellaenge(schluessel)
  return zuBigInt(await mgf1(seriennummer, laenge - 1, pruefsumme))
}

/* -------------------------------------------------------------- Verblenden */

export interface Verblendung {
  /** Was der Server zu sehen bekommt: eine Zufallszahl. */
  verblendet: string
  /** Der Faktor, der das Entblenden erlaubt. Verlässt das Gerät nie. */
  faktor: string
}

/**
 * Die Seriennummer verblenden.
 *
 * `zufall` liefert Zufallsbytes — im Browser `crypto.getRandomValues`, im
 * Hauptprozess `randomBytes`. Hereingereicht statt selbst geholt, damit die
 * Prüfungen einen festen Faktor vorgeben können; nur so lässt sich die
 * Rechnung überhaupt nachrechnen.
 */
export async function verblenden(
  seriennummer: Uint8Array,
  schluessel: OeffentlicherSchluessel,
  pruefsumme: Pruefsumme,
  zufall: (laenge: number) => Uint8Array
): Promise<Verblendung> {
  const n = zuBigInt(ausBase64Url(schluessel.n))
  const e = zuBigInt(ausBase64Url(schluessel.e))
  const laenge = schluessellaenge(schluessel)
  const m = await seriennummerAufZahl(seriennummer, schluessel, pruefsumme)

  /* Ein Faktor, der nicht teilerfremd zu n ist, wäre ein Treffer auf einen
     Primfaktor — astronomisch unwahrscheinlich, aber dann wäre das Entblenden
     unmöglich. Also nachsehen und notfalls neu würfeln. */
  let r = 0n
  for (let versuch = 0; versuch < 64; versuch++) {
    const kandidat = zuBigInt(zufall(laenge)) % n
    if (kandidat > 1n && ggT(kandidat, n) === 1n) {
      r = kandidat
      break
    }
  }
  if (r === 0n) throw new Error('Es ließ sich kein brauchbarer Zufallsfaktor finden.')

  const verblendet = (m * modPot(r, e, n)) % n
  return {
    verblendet: zuBase64Url(zuBytes(verblendet, laenge)),
    faktor: zuBase64Url(zuBytes(r, laenge))
  }
}

/**
 * Die Verblendung aufheben.
 *
 * Aus `mᵈ · r` wird `mᵈ` — die Signatur über die Seriennummer, die der Server
 * nie gesehen hat.
 */
export function entblenden(
  blindsignatur: string,
  faktor: string,
  schluessel: OeffentlicherSchluessel
): string {
  const n = zuBigInt(ausBase64Url(schluessel.n))
  const laenge = schluessellaenge(schluessel)
  const roh = zuBigInt(ausBase64Url(blindsignatur))
  const r = zuBigInt(ausBase64Url(faktor))
  const signatur = (roh * modInvers(r, n)) % n
  return zuBase64Url(zuBytes(signatur, laenge))
}

/**
 * Prüfen, ob eine Signatur zu einer Seriennummer gehört.
 *
 * Das ist, was die Urne tut, und mehr weiß sie nicht: Eine gültige Signatur
 * heißt „diese Seriennummer wurde einmal unterschrieben" — nicht, für wen.
 */
export async function pruefeSignatur(
  seriennummer: Uint8Array,
  signatur: string,
  schluessel: OeffentlicherSchluessel,
  pruefsumme: Pruefsumme
): Promise<boolean> {
  try {
    const n = zuBigInt(ausBase64Url(schluessel.n))
    const e = zuBigInt(ausBase64Url(schluessel.e))
    const s = zuBigInt(ausBase64Url(signatur))
    if (s <= 1n || s >= n) return false
    const erwartet = await seriennummerAufZahl(seriennummer, schluessel, pruefsumme)
    return modPot(s, e, n) === erwartet
  } catch {
    return false
  }
}
