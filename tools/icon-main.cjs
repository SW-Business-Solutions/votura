/**
 * Erzeugt aus docs/icon.svg die Programmsymbole.
 *
 * Es ist kein Bildwerkzeug installiert, deshalb rendert Chromium die Vorlage
 * selbst — in allen Größen, die Windows für Verknüpfungen, Taskleiste und
 * Explorer braucht. Aus den PNG-Daten entsteht anschließend eine ICO-Datei
 * (PNG-Einträge sind seit Windows Vista zulässig).
 *
 * Aufruf:  npx electron tools/icon-main.cjs
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const WURZEL = join(__dirname, '..')
const GROESSEN = [16, 24, 32, 48, 64, 128, 256]

function seite(svg, groesse) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${groesse}px;height:${groesse}px;background:transparent}
    svg{width:${groesse}px;height:${groesse}px;display:block}
  </style></head><body>${svg}</body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

/** ICO-Container mit eingebetteten PNG-Bildern. */
function baueIco(bilder) {
  const kopf = Buffer.alloc(6)
  kopf.writeUInt16LE(0, 0) // reserviert
  kopf.writeUInt16LE(1, 2) // Typ: Symbol
  kopf.writeUInt16LE(bilder.length, 4)

  const eintraege = []
  let offset = 6 + bilder.length * 16
  for (const { groesse, daten } of bilder) {
    const eintrag = Buffer.alloc(16)
    eintrag.writeUInt8(groesse >= 256 ? 0 : groesse, 0) // Breite (0 = 256)
    eintrag.writeUInt8(groesse >= 256 ? 0 : groesse, 1) // Höhe
    eintrag.writeUInt8(0, 2) // Farbpalette: keine
    eintrag.writeUInt8(0, 3) // reserviert
    eintrag.writeUInt16LE(1, 4) // Farbebenen
    eintrag.writeUInt16LE(32, 6) // Bits je Bildpunkt
    eintrag.writeUInt32LE(daten.length, 8)
    eintrag.writeUInt32LE(offset, 12)
    offset += daten.length
    eintraege.push(eintrag)
  }
  return Buffer.concat([kopf, ...eintraege, ...bilder.map((b) => b.daten)])
}

app.whenReady().then(async () => {
  const svg = readFileSync(join(WURZEL, 'docs', 'icon.svg'), 'utf8')
  mkdirSync(join(WURZEL, 'build'), { recursive: true })

  // Einmal groß rendern, dann herunterrechnen: sehr kleine Fenster lassen sich
  // unter Windows nicht zuverlässig erzeugen.
  const KANTE = 512
  const fenster = new BrowserWindow({
    width: KANTE,
    height: KANTE,
    show: false,
    transparent: true,
    // Ohne ausdrücklich durchsichtigen Hintergrund füllt Chromium weiß – das
    // Symbol säße dann als weiße Kachel in der Taskleiste.
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    webPreferences: { backgroundThrottling: false }
  })
  await fenster.loadURL(seite(svg, KANTE))
  await new Promise((fertig) => setTimeout(fertig, 600))
  const gross = await fenster.webContents.capturePage()
  fenster.destroy()

  if (gross.isEmpty()) throw new Error('Die Vorlage konnte nicht gerendert werden.')
  // Kontrolle: die linke obere Ecke muss durchsichtig sein (BGRA, viertes Byte).
  const ecke = gross.getBitmap()[3]
  console.log('  Deckkraft der Ecke:', ecke, ecke === 0 ? '(durchsichtig)' : '(NICHT durchsichtig)')
  writeFileSync(join(WURZEL, 'build', 'icon.png'), gross.toPNG())

  const bilder = GROESSEN.map((groesse) => ({
    groesse,
    daten: gross.resize({ width: groesse, height: groesse, quality: 'best' }).toPNG()
  }))
  for (const bild of bilder) console.log('  ' + bild.groesse + 'px:', bild.daten.length + ' Byte')

  writeFileSync(join(WURZEL, 'build', 'icon.ico'), baueIco(bilder))
  console.log('geschrieben: build/icon.ico und build/icon.png')
  app.quit()
})
