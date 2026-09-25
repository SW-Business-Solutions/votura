/**
 * Das Programmsymbol erzeugen — aus einem Motiv wird ein sichtbares Icon.
 *
 * ## Warum das Motiv allein nicht reicht
 *
 * `build/symbol-quelle.png` ist die Wahlurne in Voturas Dunkelblau (#0A2A54)
 * auf **durchsichtigem** Grund. Auf einer weißen Fläche sieht das gut aus —
 * auf der Windows-Taskleiste, die seit Jahren dunkel ist, verschwindet es
 * fast. Wer Votura anheftet, sucht dann eine dunkelblaue Form auf dunklem
 * Grund.
 *
 * Das Symbol bekommt deshalb eine **weiße Platte** untergelegt, wie sie
 * Programmsymbole üblicherweise haben. Sie trägt das Motiv auf jedem
 * Untergrund und macht die Form auf 16 Punkten noch erkennbar.
 *
 * ## Warum ein Werkzeug und keine einmalig gemalte Datei
 *
 * Ein Icon, das jemand einmal von Hand zusammengesetzt hat, lässt sich beim
 * nächsten Logowechsel nicht wiederholen — man weiß nicht mehr, wie groß das
 * Motiv war und wie rund die Ecken. Hier steht es als Rechnung: Quelle rein,
 * alle Größen raus, jederzeit gleich.
 *
 * ## Warum Electron malt
 *
 * Weil es ohnehin da ist. Ein Canvas kann abgerundete Rechtecke und skaliert
 * Bilder sauber; die Alternative wären Bildbibliotheken als neue
 * Abhängigkeit — für eine Aufgabe, die dreimal im Leben des Programms
 * anfällt.
 *
 * ## Warum `.cjs`, wo im Repo sonst `.mjs` steht
 *
 * Weil die anderen Werkzeuge mit **node** laufen und dieses mit **electron**.
 * Als ESM-Datei bleibt `app.whenReady()` hier schlicht stehen — kein Fehler,
 * keine Meldung, das Programm wartet bis zum Abbruch. Gemessen: dasselbe
 * Skript als `.cjs` ist nach Millisekunden bereit. Wer das nächste
 * Electron-Werkzeug schreibt, spart sich damit eine halbe Stunde Suche.
 *
 *     npm run symbol
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const { writeFileSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const wurzel = join(__dirname, '..')
const quelle = join(wurzel, 'build', 'symbol-quelle.png')

/** Die Kantenlänge, aus der alles andere verkleinert wird. */
const GROSS = 1024
/**
 * Wie viel Platz das Motiv auf der Platte bekommt.
 *
 * Luft ringsum ist kein Schmuck: Windows schneidet Symbole in Listen und
 * Kacheln gern knapp, und ein Motiv, das die Kante berührt, wirkt dabei
 * beschnitten.
 */
const MOTIV_ANTEIL = 0.76
/** Wie rund die Platte wird — als Anteil der Kantenlänge. */
const RUNDUNG_ANTEIL = 0.2
/** Die Größen, die in die ICO-Datei kommen. */
const GROESSEN = [16, 24, 32, 48, 64, 128, 256]

/**
 * Baut eine ICO-Datei aus fertigen PNG-Bildern.
 *
 * ICO ist ein Verzeichnis mit angehängten Bildern: ein Kopf, je Größe ein
 * Eintrag mit Maßen und Lage, danach die Daten. Dass darin **PNG** stehen
 * darf statt unkomprimierter Bitmaps, gilt seit Windows Vista — deshalb
 * genügen hier die PNG-Puffer, die Electron schon geliefert hat.
 *
 * Die 256 steht als `0` im Eintrag: Das Feld ist ein Byte breit, und 256
 * passt nicht hinein. Diese Verabredung ist Teil des Formats.
 */
function bauIco(bilder) {
  const kopf = Buffer.alloc(6)
  kopf.writeUInt16LE(0, 0) // reserviert
  kopf.writeUInt16LE(1, 2) // 1 = Symbol
  kopf.writeUInt16LE(bilder.length, 4)

  const eintraege = []
  let versatz = 6 + bilder.length * 16
  for (const { groesse, daten } of bilder) {
    const eintrag = Buffer.alloc(16)
    eintrag.writeUInt8(groesse >= 256 ? 0 : groesse, 0)
    eintrag.writeUInt8(groesse >= 256 ? 0 : groesse, 1)
    eintrag.writeUInt8(0, 2) // Farben in der Palette: keine
    eintrag.writeUInt8(0, 3) // reserviert
    eintrag.writeUInt16LE(1, 4) // Farbebenen
    eintrag.writeUInt16LE(32, 6) // Bits je Punkt
    eintrag.writeUInt32LE(daten.length, 8)
    eintrag.writeUInt32LE(versatz, 12)
    eintraege.push(eintrag)
    versatz += daten.length
  }
  return Buffer.concat([kopf, ...eintraege, ...bilder.map((b) => b.daten)])
}

async function erzeuge() {
  const fenster = new BrowserWindow({ width: GROSS, height: GROSS, show: false })

  const motiv = readFileSync(quelle).toString('base64')

  /*
   * Gemalt wird im Fenster, nicht hier: Nur dort gibt es ein Canvas.
   *
   * **Die Seite kommt aus einer Datei, nicht aus einer `data:`-URL.** Mit dem
   * eingebetteten Motiv wird die URL mehrere zehntausend Zeichen lang, und
   * Chromium nimmt sie dann schlicht nicht mehr an — der Aufruf kehrt nie
   * zurück, ohne einen Fehler zu nennen. Eine Datei im Temp kostet zwei
   * Zeilen und hat dieses Verhalten nicht.
   */
  const seite = `
  <!doctype html><meta charset="utf-8">
  <body style="margin:0">
  <canvas id="c" width="${GROSS}" height="${GROSS}"></canvas>
  <script>
  window.male = () => new Promise((fertig) => {
    const c = document.getElementById('c')
    const p = c.getContext('2d')
    const r = ${GROSS} * ${RUNDUNG_ANTEIL}
    p.clearRect(0, 0, ${GROSS}, ${GROSS})
    p.fillStyle = '#ffffff'
    p.beginPath()
    p.roundRect(0, 0, ${GROSS}, ${GROSS}, r)
    p.fill()
    const bild = new Image()
    bild.onload = () => {
      const kante = ${GROSS} * ${MOTIV_ANTEIL}
      // Seitenverhältnis wahren, auch wenn die Quelle einmal nicht quadratisch ist
      const faktor = Math.min(kante / bild.width, kante / bild.height)
      const b = bild.width * faktor
      const h = bild.height * faktor
      p.drawImage(bild, (${GROSS} - b) / 2, (${GROSS} - h) / 2, b, h)
      fertig(c.toDataURL('image/png'))
    }
    bild.src = 'data:image/png;base64,${motiv}'
  })
  </script>
  </body>`

  const seitePfad = join(tmpdir(), `votura-symbol-${process.pid}.html`)
  writeFileSync(seitePfad, seite, 'utf8')
  await fenster.loadFile(seitePfad)
  const datenUrl = await fenster.webContents.executeJavaScript('window.male()')
  rmSync(seitePfad, { force: true })

  const gross = nativeImage.createFromDataURL(datenUrl)
  writeFileSync(join(wurzel, 'build', 'icon.png'), gross.toPNG())

  const bilder = GROESSEN.map((groesse) => ({
  groesse,
  daten: gross.resize({ width: groesse, height: groesse, quality: 'best' }).toPNG()
  }))
  writeFileSync(join(wurzel, 'build', 'icon.ico'), bauIco(bilder))

  /* Electron gibt unter Windows nichts auf die Konsole zurück, wenn es aus
     einem Skript heraus läuft — gemeldet wird deshalb in eine Datei neben dem
     Ergebnis, sonst steht man vor einem stummen Lauf. */
  return `build/icon.png ${GROSS}×${GROSS}, build/icon.ico ${GROESSEN.join(', ')}`
}

app
  .whenReady()
  .then(erzeuge)
  .then((was) => {
    writeFileSync(join(wurzel, 'build', 'symbol-lauf.txt'), `${was}\n`, 'utf8')
    console.log(was)
    app.quit()
  })
  .catch((fehler) => {
    writeFileSync(
      join(wurzel, 'build', 'symbol-lauf.txt'),
      `Fehlgeschlagen: ${fehler?.stack ?? fehler}\n`,
      'utf8'
    )
    app.exit(1)
  })
