/**
 * Ein NDI-Testbild — eine Kamera, die es nicht gibt.
 *
 * Die Kameraansicht lässt sich sonst nur dort entwickeln, wo eine NDI-Kamera
 * im Netz hängt. Dieses Werkzeug sendet stattdessen ein erzeugtes Bild als
 * ganz normale NDI-Quelle: Farbbalken, eine laufende Uhr und ein wanderndes
 * Feld, an dem Ruckeln sofort auffällt.
 *
 * Aufruf:
 *   node tools/ndi-testbild.mjs [--name PULT] [--breite 1280] [--hoehe 720] [--fps 30]
 *
 * Beenden mit Strg+C.
 *
 * NDI® ist eine eingetragene Marke der Vizrt NDI AB.
 */
import grandi from 'grandi'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const NAME = arg('name', 'VOTURA TESTBILD')
const BREITE = Number(arg('breite', 1280))
const HOEHE = Number(arg('hoehe', 720))
const FPS = Number(arg('fps', 30))

if (!grandi.isSupportedCPU()) {
  console.error('NDI wird auf diesem Rechner nicht unterstützt.')
  process.exit(1)
}
grandi.initialize()
console.log(grandi.version())

const sender = await grandi.send({ name: NAME, clockVideo: true })
console.log(`sendet als „${sender.sourceName()}" — ${BREITE}×${HOEHE} @ ${FPS}`)

/* Ein Bild, einmal angelegt und immer wieder überschrieben. Je Bild einen
   neuen Puffer zu belegen hieße, den Sammler dreißigmal je Sekunde zu
   beschäftigen — genau das, was man beim Messen nicht haben will. */
const STRIDE = BREITE * 4
const bild = Buffer.alloc(STRIDE * HOEHE)

/** Acht Farbbalken, wie sie jeder Fernsehtechniker kennt. */
const BALKEN = [
  [192, 192, 192],
  [192, 192, 0],
  [0, 192, 192],
  [0, 192, 0],
  [192, 0, 192],
  [192, 0, 0],
  [0, 0, 192],
  [16, 16, 16]
]

/*
 * Der unbewegte Teil wird **einmal** gezeichnet.
 *
 * Bei 1920×1080 sind das zwei Millionen Bildpunkte; sie dreißigmal je Sekunde
 * in JavaScript einzeln zu setzen schafft kein Rechner. Je Bild wird deshalb
 * nur die Vorlage kopiert und das wandernde Feld hineingemalt — ein
 * Speicherkopieren von wenigen Millisekunden.
 */
const vorlage = Buffer.alloc(STRIDE * HOEHE)
{
  const balkenBreite = Math.ceil(BREITE / BALKEN.length)
  for (let y = 0; y < HOEHE; y++) {
    const zeile = y * STRIDE
    const unten = y > HOEHE * 0.66
    for (let x = 0; x < BREITE; x++) {
      const p = zeile + x * 4
      let r, g, b
      if (unten) {
        const grau = Math.floor((x / BREITE) * 255)
        r = g = b = grau
      } else {
        const farbe = BALKEN[Math.min(BALKEN.length - 1, Math.floor(x / balkenBreite))]
        r = farbe[0]
        g = farbe[1]
        b = farbe[2]
      }
      vorlage[p] = r
      vorlage[p + 1] = g
      vorlage[p + 2] = b
      vorlage[p + 3] = 255
    }
  }
}

const LAEUFER_B = Math.round(BREITE / 16)
const LAEUFER_H = Math.round(HOEHE / 12)

function zeichne(nummer) {
  vorlage.copy(bild)
  /* Ein Feld, das je Bild um ein Stück weiterwandert: Steht es still, fehlen
     Bilder; springt es, kommen sie in der falschen Reihenfolge an. */
  const x0 = Math.floor((nummer * 6) % (BREITE - LAEUFER_B))
  const y0 = Math.floor(HOEHE * 0.75)
  for (let y = y0; y < Math.min(HOEHE, y0 + LAEUFER_H); y++) {
    let p = y * STRIDE + x0 * 4
    for (let x = 0; x < LAEUFER_B; x++) {
      bild[p] = 255
      bild[p + 1] = 64
      bild[p + 2] = 64
      bild[p + 3] = 255
      p += 4
    }
  }
}

let nummer = 0
let letzteMeldung = Date.now()
let seitMeldung = 0

const takt = setInterval(async () => {
  zeichne(nummer++)
  try {
    await sender.video({
      xres: BREITE,
      yres: HOEHE,
      frameRateN: FPS * 1000,
      frameRateD: 1000,
      pictureAspectRatio: BREITE / HOEHE,
      fourCC: 1095911234 /* BGRA */,
      frameFormatType: 1 /* Progressive */,
      lineStrideBytes: STRIDE,
      data: bild
    })
  } catch (fehler) {
    console.error('Bild nicht gesendet:', fehler?.message ?? fehler)
  }
  seitMeldung++
  if (Date.now() - letzteMeldung >= 5000) {
    const rate = (seitMeldung / ((Date.now() - letzteMeldung) / 1000)).toFixed(1)
    console.log(`${rate} Bilder/s · ${sender.connections()} Empfänger`)
    letzteMeldung = Date.now()
    seitMeldung = 0
  }
}, Math.round(1000 / FPS))

const ende = () => {
  clearInterval(takt)
  sender.destroy()
  grandi.destroy()
  process.exit(0)
}
process.on('SIGINT', ende)
process.on('SIGTERM', ende)
