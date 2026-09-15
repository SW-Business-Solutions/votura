/**
 * Kameras steuern — eine Stelle für alle Hersteller.
 *
 * Eine Kamera auf eine Position fahren zu lassen ist kein Hexenwerk: Es sind
 * sieben Bytes über das Netz. Schwierig ist, dass **jeder Hersteller ein
 * bisschen anders abweicht** — und genau deshalb liegt hier eine Tabelle und
 * kein Sonderweg je Marke.
 *
 * ## Was sich unterscheidet, und was nicht
 *
 * Fast alle Netzwerk-PTZ-Kameras sprechen **VISCA**, das Protokoll, das Sony
 * für seine Steuerpulte erfunden hat. Der *Inhalt* eines Befehls ist dabei
 * erstaunlich einheitlich — „fahre auf Position 3" heißt überall
 * `81 01 04 3F 02 03 FF`. Verschieden ist das Drumherum:
 *
 * - **Die Rahmung.** Entweder gehen die Bytes roh über die Leitung, oder sie
 *   stecken in einem Umschlag mit Länge und Laufnummer (Sonys Art).
 * - **Der Weg.** UDP oder TCP.
 * - **Der Port.** 52381 und 5678 sind verbreitet, aber sie sagen nichts über
 *   die Rahmung: PTZOptics spricht *rohes* VISCA auf 52381, Sony
 *   *gekapseltes* auf demselben Port.
 * - **Die Grenzen.** Wie schnell geschwenkt werden darf, wie viele Positionen
 *   es gibt.
 * - **Die Eigenheiten.** Die OBSBOT Tail Air etwa nimmt die Schwenk-
 *   geschwindigkeit auch fürs Neigen und antwortet, bevor sie sich bewegt
 *   hat.
 *
 * Alles davon steht in `PTZ_PROFILE`. Eine neue Kamera aufzunehmen heißt
 * deshalb im Regelfall: **eine Zeile ergänzen** — kein neuer Code, keine
 * Verzweigung in der Bedienung, keine zweite Stelle, an der etwas kaputtgehen
 * kann.
 *
 * ## Warum reine Funktionen
 *
 * Die Befehle werden hier als Bytes *gerechnet*, nicht verschickt. Damit lässt
 * sich prüfen, ob `81 01 04 3F 02 03 FF` herauskommt, ohne eine Kamera im
 * Raum zu haben — und wenn eines Tages jemand ohne dieses Gerät am Code
 * arbeitet, merkt er einen Fehler trotzdem sofort.
 *
 * ## Was ausdrücklich fehlt
 *
 * Ein Joystick. Die nützliche Steuerung auf einer Versammlung sind **feste
 * Positionen** — „Pult", „Präsidium", „Saal" —, die einmal eingerichtet und
 * danach abgerufen werden. Wer wirklich live schwenken will, hat ein Pult mit
 * einem Knüppel, und das kann es besser als jede Maus.
 */

/** Wie die Bytes zur Kamera kommen. */
export type PtzTransport = 'udp' | 'tcp'

/**
 * Wie ein VISCA-Paket verpackt wird.
 *
 * `roh` ist die Steuerkabel-Form, unverändert ins Netz gelegt. `gekapselt`
 * ist Sonys Umschlag: acht Bytes davor, mit Art, Länge und Laufnummer.
 */
export type PtzRahmung = 'roh' | 'gekapselt'

/** Was eine Kamera kann — nicht jede kann alles. */
export interface PtzFaehigkeiten {
  /** Gespeicherte Positionen anfahren. */
  presets: boolean
  /** Die aktuelle Position als Preset ablegen. */
  presetsSpeichern: boolean
  schwenken: boolean
  zoom: boolean
  /** Auf die Ausgangsstellung fahren. */
  heim: boolean
  autofokus: boolean
  /**
   * Die Stellung abfragen und wieder genau anfahren.
   *
   * Der Ausweg für Kameras **ohne eigenen Positionsspeicher**: Statt der
   * Kamera zu sagen „merk dir das unter Nummer 2", fragt Votura sie nach
   * ihren Zahlen, legt sie in die eigene Datenbank und schickt sie später
   * genau dorthin zurück. Fast jede VISCA-Kamera kann das, auch wenn sie
   * keine Presets hat.
   */
  absolut: boolean
}

/**
 * Ein Kameraprofil — alles, was dieses Modell von der Regel unterscheidet.
 *
 * Die Felder sind bewusst flach und ohne Verhalten: Ein Profil ist eine
 * Angabe, keine Implementierung. Wer eine Kamera ergänzt, muss nichts
 * verstehen außer seinem Handbuch.
 */
export interface PtzProfil {
  kennung: string
  name: string
  hersteller: string
  /** Modelle, für die dieses Profil gedacht ist — nur zur Orientierung. */
  modelle: string[]
  transport: PtzTransport
  rahmung: PtzRahmung
  port: number
  /**
   * Die VISCA-Geräteadresse.
   *
   * Am seriellen Bus hingen bis zu sieben Kameras an einem Kabel und brauchten
   * Nummern. Über das Netz hat jede ihre eigene Adresse, und die Nummer ist
   * fast immer 1 — gebraucht wird sie trotzdem, denn sie steht im ersten Byte.
   */
  geraet: number
  /** Größte erlaubte Geschwindigkeit je Richtung. */
  tempoMax: { schwenk: number; neigen: number; zoom: number }
  /** Welche Positionsnummern es gibt. */
  presets: { erste: number; letzte: number }
  kann: PtzFaehigkeiten
  /**
   * Was an diesem Modell anders ist, in Worten.
   *
   * Steht in der Bedienung unter dem Profil. Wer sich wundert, warum das
   * Neigen langsamer läuft als eingestellt, findet die Antwort dort statt im
   * Quelltext.
   */
  eigenheiten?: string[]
}

const ALLES: PtzFaehigkeiten = {
  presets: true,
  presetsSpeichern: true,
  schwenken: true,
  zoom: true,
  heim: true,
  autofokus: true,
  absolut: true
}

/**
 * Die bekannten Kameras.
 *
 * Die ersten drei Einträge sind **keine Marken**, sondern die drei Spielarten,
 * in denen VISCA über das Netz vorkommt. Damit lässt sich eine Kamera
 * betreiben, die hier gar nicht steht — und das ist der Regelfall, denn es
 * gibt hunderte Modelle und ein Dutzend Hersteller, die dieselbe Elektronik
 * verbauen.
 *
 * Die Einträge darunter sind gemessene Abweichungen einzelner Modelle.
 */
export const PTZ_PROFILE: PtzProfil[] = [
  {
    kennung: 'visca-roh-udp',
    name: 'VISCA over IP — roh, UDP',
    hersteller: 'Allgemein',
    modelle: ['PTZOptics', 'Avonic', 'Minrray', 'Lumens', 'die meisten Baugleichen'],
    transport: 'udp',
    rahmung: 'roh',
    port: 52381,
    geraet: 1,
    tempoMax: { schwenk: 24, neigen: 20, zoom: 7 },
    presets: { erste: 0, letzte: 254 },
    kann: ALLES
  },
  {
    kennung: 'visca-roh-tcp',
    name: 'VISCA over IP — roh, TCP',
    hersteller: 'Allgemein',
    modelle: ['PTZOptics', 'viele Kameras mit Weboberfläche'],
    transport: 'tcp',
    rahmung: 'roh',
    port: 5678,
    geraet: 1,
    tempoMax: { schwenk: 24, neigen: 20, zoom: 7 },
    presets: { erste: 0, letzte: 254 },
    kann: ALLES
  },
  {
    kennung: 'visca-gekapselt',
    name: 'VISCA over IP — gekapselt (Sony-Art)',
    hersteller: 'Allgemein',
    modelle: ['Sony SRG', 'Panasonic mit VISCA-Zusatz', 'AVer'],
    transport: 'udp',
    rahmung: 'gekapselt',
    port: 52381,
    geraet: 1,
    tempoMax: { schwenk: 24, neigen: 20, zoom: 7 },
    presets: { erste: 0, letzte: 254 },
    kann: ALLES
  },
  {
    kennung: 'obsbot-tail',
    name: 'OBSBOT Tail Air / Tail 2',
    hersteller: 'OBSBOT',
    modelle: ['Tail Air', 'Tail 2'],
    transport: 'udp',
    rahmung: 'roh',
    port: 52381,
    geraet: 1,
    /*
     * Gemessene Abweichungen (Jon Skeet, „Variations in the VISCA protocol",
     * November 2023) gegen PTZOptics. Sie sind der Grund, warum hier ein
     * eigener Eintrag steht und keine Verzweigung im Code.
     */
    tempoMax: { schwenk: 24, neigen: 20, zoom: 7 },
    presets: { erste: 0, letzte: 254 },
    kann: { ...ALLES, presetsSpeichern: true },
    eigenheiten: [
      'Nimmt die Schwenkgeschwindigkeit auch fürs Neigen — eine getrennte Angabe wird verworfen.',
      'Meldet einen Schwenk als erledigt, bevor sie sich bewegt hat.',
      'Ein- und Ausschalten über VISCA ignoriert sie.',
      'Andere Grenzen für Schwenken, Neigen und Zoom als vergleichbare Kameras.'
    ]
  }
]

export function ptzProfil(kennung: string): PtzProfil | undefined {
  return PTZ_PROFILE.find((profil) => profil.kennung === kennung)
}

/**
 * Eine eingerichtete Kamera.
 *
 * `quelle` verbindet sie mit dem Bild: Es ist der NDI-Name. Steht er hier,
 * weiß Votura, dass die Kamera, die es gerade zeigt, auch die ist, die es
 * steuern darf — und fährt sie auf die richtige Position, wenn jemand
 * aufgerufen wird.
 */
export interface PtzKamera {
  id: string
  name: string
  /** Hostname oder Adresse der Kamera. */
  host: string
  /** Abweichender Port; sonst gilt der des Profils. */
  port?: number
  profil: string
  /** Der NDI-Name des Bildes dieser Kamera, sofern bekannt. */
  quelle?: string
  /**
   * Wer die Positionen führt.
   *
   * `kamera` ist der Regelfall und der bessere Weg: Die Kamera fährt selbst
   * an, das geht schneller und überlebt einen Wechsel des Rechners. `votura`
   * ist für Geräte **ohne eigenen Positionsspeicher** — dann stehen die
   * Zahlen in der Datenbank, und Votura schickt die Kamera hin.
   *
   * Fehlt die Angabe, gilt `kamera`.
   */
  ablage?: 'kamera' | 'votura'
  /** Benannte Positionen — „Pult", „Präsidium", „Saal". */
  positionen: PtzPosition[]
  /**
   * Auf diese Position fahren, sobald ein Redner aufgerufen wird.
   *
   * Der eigentliche Zweck der ganzen Steuerung: Bei zwölf Bewerbern
   * hintereinander soll niemand zwischendurch eine Kamera nachführen. Fehlt
   * die Angabe, bewegt sich nichts von selbst — und das ist die Vorgabe,
   * denn eine Kamera, die unaufgefordert losfährt, erschrickt einen Saal.
   */
  beiAufruf?: number
  enabled: boolean
}

export interface PtzPosition {
  /** Die Nummer im Speicher der Kamera. */
  nummer: number
  name: string
  /**
   * Die Stellung in Zahlen — nur bei Ablage in Votura.
   *
   * Siehe `PtzKamera.ablage`: Kameras ohne eigenen Positionsspeicher merken
   * sich nichts. Dann merkt Votura es sich, und zwar so, wie die Kamera
   * selbst es ausdrückt: Schwenk, Neigung, Zoom als die Zahlen, die sie auf
   * Nachfrage nennt.
   */
  koordinaten?: PtzStellung
}

/** Wo eine Kamera hinschaut, in ihren eigenen Zahlen. */
export interface PtzStellung {
  /** Schwenk — vorzeichenbehaftet, Mitte ist 0. */
  pan: number
  /** Neigung — vorzeichenbehaftet, Mitte ist 0. */
  tilt: number
  zoom: number
}

/** Vorgeschlagene Positionen für eine Versammlung. */
export const PTZ_POSITIONEN_VORSCHLAG: PtzPosition[] = [
  { nummer: 0, name: 'Pult' },
  { nummer: 1, name: 'Präsidium' },
  { nummer: 2, name: 'Saal' }
]

export interface PtzFund {
  erreichbar: boolean
  /** Die Kennung des Profils, das geantwortet hat. */
  profil?: string
  port?: number
  /** Was zu tun ist, wenn nichts antwortet. */
  hinweis?: string
}

/* ------------------------------------------------------------- Die Bytes */

/**
 * Das erste Byte jedes VISCA-Befehls.
 *
 * Es trägt die Zieladresse: Gerät 1 wird zu `0x81`. Historisch steckt darin
 * auch die Absenderadresse (die Steuerung ist immer 0), deshalb die 8 oben.
 */
function kopf(geraet: number): number {
  const nummer = Math.min(7, Math.max(1, Math.round(geraet)))
  return 0x80 | nummer
}

/** Abschluss jedes VISCA-Befehls. */
const ENDE = 0xff

function begrenze(wert: number, klein: number, gross: number): number {
  return Math.min(gross, Math.max(klein, Math.round(wert)))
}

/** Eine gespeicherte Position anfahren. */
export function viscaPresetAbrufen(nummer: number, geraet = 1): Uint8Array {
  return new Uint8Array([kopf(geraet), 0x01, 0x04, 0x3f, 0x02, begrenze(nummer, 0, 254), ENDE])
}

/** Die aktuelle Stellung als Position ablegen. */
export function viscaPresetSpeichern(nummer: number, geraet = 1): Uint8Array {
  return new Uint8Array([kopf(geraet), 0x01, 0x04, 0x3f, 0x01, begrenze(nummer, 0, 254), ENDE])
}

/** Richtungen beim Schwenken: −1, 0 oder 1. */
export type PtzRichtung = -1 | 0 | 1

/*
 * VISCA nennt Richtungen nicht als Vorzeichen, sondern als Kennziffern:
 * 1 = links bzw. oben, 2 = rechts bzw. unten, 3 = halt.
 */
function richtungsbyte(richtung: PtzRichtung, negativ: number, positiv: number): number {
  if (richtung < 0) return negativ
  if (richtung > 0) return positiv
  return 0x03
}

/**
 * Schwenken und Neigen.
 *
 * `x` ist links/rechts, `y` ist oben/unten, jeweils −1, 0 oder 1. Die Kamera
 * fährt danach **weiter**, bis sie einen Halt bekommt — deshalb gehört zu
 * jedem Schwenk ein `viscaSchwenkStopp`, und die Bedienung schickt ihn beim
 * Loslassen der Taste.
 */
export function viscaSchwenken(
  x: PtzRichtung,
  y: PtzRichtung,
  tempoSchwenk: number,
  tempoNeigen: number,
  geraet = 1
): Uint8Array {
  return new Uint8Array([
    kopf(geraet),
    0x01,
    0x06,
    0x01,
    begrenze(tempoSchwenk, 1, 24),
    begrenze(tempoNeigen, 1, 20),
    richtungsbyte(x, 0x01, 0x02),
    richtungsbyte(y, 0x01, 0x02),
    ENDE
  ])
}

/** Halt für Schwenken und Neigen. */
export function viscaSchwenkStopp(geraet = 1): Uint8Array {
  return viscaSchwenken(0, 0, 1, 1, geraet)
}

/**
 * Zoom.
 *
 * `1` fährt hinein (tele), `-1` heraus (weit), `0` hält an. Das Tempo steckt
 * in den unteren vier Bit desselben Bytes — daher die Verodrung.
 */
export function viscaZoom(richtung: PtzRichtung, tempo: number, geraet = 1): Uint8Array {
  const stufe = begrenze(tempo, 0, 7)
  const wert = richtung > 0 ? 0x20 | stufe : richtung < 0 ? 0x30 | stufe : 0x00
  return new Uint8Array([kopf(geraet), 0x01, 0x04, 0x07, wert, ENDE])
}

/** Auf die Ausgangsstellung fahren. */
export function viscaHeim(geraet = 1): Uint8Array {
  return new Uint8Array([kopf(geraet), 0x01, 0x06, 0x04, ENDE])
}

/** Einmal scharfstellen. */
export function viscaAutofokus(geraet = 1): Uint8Array {
  return new Uint8Array([kopf(geraet), 0x01, 0x04, 0x18, 0x01, ENDE])
}

/**
 * Eine Zahl in vier Halbbytes zerlegen.
 *
 * VISCA überträgt 16-Bit-Werte als vier Bytes, die je vier Bit tragen. Der
 * Grund ist alt: Das oberste Bit bleibt frei, damit kein Nutzbyte wie ein
 * Abschluss (`0xFF`) aussieht. Wer das übersieht, schickt ein Paket, das die
 * Kamera mitten im Wort für beendet hält.
 */
function halbbytes(wert: number): number[] {
  const w = wert & 0xffff
  return [(w >> 12) & 0x0f, (w >> 8) & 0x0f, (w >> 4) & 0x0f, w & 0x0f]
}

/** Und zurück — die vier Halbbytes zu einer vorzeichenbehafteten Zahl. */
function ausHalbbytes(bytes: Uint8Array, ab: number, vorzeichen = true): number {
  const roh =
    ((bytes[ab] & 0x0f) << 12) |
    ((bytes[ab + 1] & 0x0f) << 8) |
    ((bytes[ab + 2] & 0x0f) << 4) |
    (bytes[ab + 3] & 0x0f)
  /* Schwenk und Neigung zählen in beide Richtungen; der Zoom nicht. */
  return vorzeichen && roh > 0x7fff ? roh - 0x10000 : roh
}

/**
 * Genau dorthin fahren.
 *
 * Der Weg für Kameras ohne eigenen Positionsspeicher: Statt „fahre auf
 * Position 2" wird die Stellung selbst geschickt.
 */
export function viscaPositionAbsolut(
  stellung: Pick<PtzStellung, 'pan' | 'tilt'>,
  tempoSchwenk: number,
  tempoNeigen: number,
  geraet = 1
): Uint8Array {
  return new Uint8Array([
    kopf(geraet),
    0x01,
    0x06,
    0x02,
    begrenze(tempoSchwenk, 1, 24),
    begrenze(tempoNeigen, 1, 20),
    ...halbbytes(stellung.pan),
    ...halbbytes(stellung.tilt),
    ENDE
  ])
}

/** Den Zoom auf einen genauen Wert setzen. */
export function viscaZoomAbsolut(zoom: number, geraet = 1): Uint8Array {
  return new Uint8Array([kopf(geraet), 0x01, 0x04, 0x47, ...halbbytes(zoom), ENDE])
}

/** Die Frage nach Schwenk und Neigung. */
export function viscaFragePosition(geraet = 1): Uint8Array {
  return new Uint8Array([kopf(geraet), 0x09, 0x06, 0x12, ENDE])
}

/**
 * Schwenk und Neigung aus der Antwort lesen.
 *
 * Erwartet wird `90 50 0p 0p 0p 0p 0t 0t 0t 0t FF`. Kommt etwas anderes,
 * gibt es `undefined` — eine geratene Stellung wäre schlimmer als keine:
 * Sie führte die Kamera später zuverlässig an den falschen Ort.
 */
export function pantiltAusAntwort(bytes: Uint8Array): { pan: number; tilt: number } | undefined {
  if (!istViscaAntwort(bytes) || bytes.length < 11) return undefined
  if ((bytes[1] & 0xf0) !== 0x50) return undefined
  return { pan: ausHalbbytes(bytes, 2), tilt: ausHalbbytes(bytes, 6) }
}

/** Der Zoomstand aus der Antwort `90 50 0z 0z 0z 0z FF`. */
export function zoomAusAntwort(bytes: Uint8Array): number | undefined {
  if (!istViscaAntwort(bytes) || bytes.length < 7) return undefined
  if ((bytes[1] & 0xf0) !== 0x50) return undefined
  return ausHalbbytes(bytes, 2, false)
}

/**
 * Eine harmlose Frage an die Kamera.
 *
 * Sie verändert nichts und wird von jeder VISCA-Kamera beantwortet — genau
 * das Richtige, um herauszufinden, ob unter einer Adresse überhaupt jemand
 * zuhört und in welcher Spielart.
 */
export function viscaFrageZoom(geraet = 1): Uint8Array {
  return new Uint8Array([kopf(geraet), 0x09, 0x04, 0x47, ENDE])
}

/* ---------------------------------------------------------- Die Rahmung */

/** Was für eine Art Nachricht im Umschlag steckt. */
export type PtzNachrichtenart = 'befehl' | 'frage' | 'steuerung'

const ARTEN: Record<PtzNachrichtenart, [number, number]> = {
  befehl: [0x01, 0x00],
  frage: [0x01, 0x10],
  steuerung: [0x02, 0x00]
}

/**
 * Sonys Umschlag: acht Bytes vor die Nutzlast.
 *
 * Zwei Bytes Art, zwei Bytes Länge, vier Bytes Laufnummer — alle mit dem
 * höchstwertigen Byte zuerst. Die Länge steht drin, obwohl die Nutzlast nie
 * über sechzehn Bytes hinausgeht; das ist nicht sparsam, aber es ist die
 * Festlegung.
 */
export function rahmeGekapselt(
  nutzlast: Uint8Array,
  folge: number,
  art: PtzNachrichtenart = 'befehl'
): Uint8Array {
  const [a, b] = ARTEN[art]
  const nummer = folge >>> 0
  const paket = new Uint8Array(8 + nutzlast.length)
  paket[0] = a
  paket[1] = b
  paket[2] = (nutzlast.length >> 8) & 0xff
  paket[3] = nutzlast.length & 0xff
  paket[4] = (nummer >>> 24) & 0xff
  paket[5] = (nummer >>> 16) & 0xff
  paket[6] = (nummer >>> 8) & 0xff
  paket[7] = nummer & 0xff
  paket.set(nutzlast, 8)
  return paket
}

/**
 * Die Laufnummer zurücksetzen.
 *
 * Die Kamera merkt sich, welche Nummer zuletzt kam. Startet Votura neu und
 * beginnt wieder bei null, hält sie die neuen Pakete für alte und schweigt.
 * Diese eine Steuernachricht räumt das aus — sie gehört an den Anfang jeder
 * gekapselten Verbindung.
 */
export function rahmeFolgeZuruecksetzen(): Uint8Array {
  return rahmeGekapselt(new Uint8Array([0x01]), 0, 'steuerung')
}

/**
 * Ein fertiges Paket für ein Profil.
 *
 * Die einzige Stelle, an der Rahmung überhaupt entschieden wird — alles
 * andere in diesem Modul weiß davon nichts.
 */
export function ptzPaket(
  profil: Pick<PtzProfil, 'rahmung'>,
  nutzlast: Uint8Array,
  folge: number,
  art: PtzNachrichtenart = 'befehl'
): Uint8Array {
  return profil.rahmung === 'gekapselt' ? rahmeGekapselt(nutzlast, folge, art) : nutzlast
}

/**
 * Die Antwort aus einem Paket schälen.
 *
 * Bei roher Rahmung ist das Paket die Antwort; bei gekapselter liegen acht
 * Bytes davor. Wer das verwechselt, liest die Laufnummer als Statusbyte.
 */
export function ptzAntwort(profil: Pick<PtzProfil, 'rahmung'>, paket: Uint8Array): Uint8Array {
  if (profil.rahmung !== 'gekapselt') return paket
  return paket.length > 8 ? paket.subarray(8) : new Uint8Array()
}

/**
 * Klingt das nach einer VISCA-Antwort?
 *
 * Eine Antwort beginnt mit `0x90` (von Gerät 1 an die Steuerung) und endet
 * auf `0xFF`. Mehr wird hier nicht verlangt: Zum Erkennen, *ob* jemand
 * zuhört, genügt die Form — was genau geantwortet wurde, ist eine andere
 * Frage.
 */
export function istViscaAntwort(bytes: Uint8Array): boolean {
  if (bytes.length < 3) return false
  if (bytes[bytes.length - 1] !== ENDE) return false
  return (bytes[0] & 0xf0) === 0x90
}

/**
 * Die Reihenfolge, in der eine unbekannte Kamera abgeklopft wird.
 *
 * Der Port verrät die Spielart nicht, und Handbücher schweigen dazu oft. Statt
 * die Wahl der Wahlleitung aufzubürden, probiert Votura die drei Formen durch
 * und nimmt die, die antwortet. Das ist eine Frage von Sekunden und erspart
 * eine Fehlersuche, die sonst am Abend vor der Versammlung stattfindet.
 */
export const PTZ_ERKENNUNG: string[] = ['visca-roh-udp', 'visca-gekapselt', 'visca-roh-tcp']
