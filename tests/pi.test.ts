/**
 * Der Raspberry Pi als Anzeigegerät.
 *
 * Die Skripte laufen auf einem Gerät, das im Saal hinter dem Beamer steht —
 * dort schaut niemand nach, warum etwas nicht kommt. Geprüft wird deshalb
 * vor allem, was still schiefginge: falsche Dateinamen, ein fehlender
 * Neustart, ein Bildschirmschoner, der mitten im Vortrag zuschlägt.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const lies = (pfad: string): string => readFileSync(join(__dirname, '..', pfad), 'utf8')

/*
 * Zwei Angaben aus dem Bauplan, ohne YAML-Bibliothek.
 *
 * `js-yaml` liegt nur als Unterabhängigkeit von electron-builder herum — sich
 * darauf zu stützen hieße, von etwas abzuhängen, das beim nächsten
 * Aktualisieren verschwinden kann. Für zwei Zeilen genügt Lesen.
 */
/** Der Abschnitt `linux:` eines Bauplans — davor stehen die Windows-Angaben. */
function linuxTeil(datei: string): string {
  const inhalt = lies(datei)
  return inhalt.slice(inhalt.indexOf('\nlinux:'))
}

function linuxAngabe(datei: string, feld: string): string {
  return new RegExp(`^\\s+${feld}:\\s*(.+)$`, 'm').exec(linuxTeil(datei))?.[1]?.trim() ?? ''
}

function linuxArchitekturen(datei: string): string[] {
  const zeile = /arch:\s*\[([^\]]*)\]/.exec(linuxTeil(datei))?.[1] ?? ''
  return zeile.split(',').map((eintrag) => eintrag.trim())
}
const install = lies('pi/install.sh')
const abbild = lies('pi/abbild-bauen.sh')

describe('Das Einrichtungsskript', () => {
  it('startet die Anwendung nach einem Absturz neu', () => {
    /* Der eigentliche Zweck des Dienstes. */
    expect(install).toContain('Restart=always')
    expect(install).toContain('RestartSec=3')
  })

  it('schaltet Bildschirmschoner und Energiesparen ab', () => {
    /* Ein Beamer, der nach zehn Minuten Vortrag schwarz wird, ist der
       klassische Saalunfall. */
    expect(install).toContain('xset s off')
    expect(install).toContain('xset -dpms')
  })

  it('weist 32-Bit-Systeme mit einer brauchbaren Begründung ab', () => {
    expect(install).toContain("!= 'arm64'")
    expect(install).toContain('64-Bit')
    expect(install).toContain('armv7')
  })

  it('legt die Daten außerhalb des Programmordners ab', () => {
    /* Sonst wäre die Zuordnung zum Hauptrechner nach jeder Aktualisierung
       weg — und jemand müsste im Saal neu einrichten. */
    expect(install).toContain('/var/lib/votura-saal')
    expect(install).toContain('--user-data-dir=/var/lib/votura-saal')
    expect(lies('pi/install.sh')).toContain('Die Zuordnung zum Hauptrechner bleibt erhalten')
  })

  it('läuft nicht als root', () => {
    expect(install).toContain('useradd --system')
    expect(install).toMatch(/User=\$BENUTZER/)
  })

  it('lädt genau den Dateinamen, den der Bauplan erzeugt', () => {
    /*
     * Die häufigste stille Panne: Das Paket heißt anders, als das Skript es
     * sucht — und der Pi zeigt beim Aufbauen einen 404.
     */
    expect(linuxAngabe('electron-builder-saal.yml', 'artifactName')).toBe(
      'Votura-Saal-${version}-linux-${arch}.${ext}'
    )
    /* Im Skript steht derselbe Name, nur mit eingesetzter Architektur. */
    expect(install).toContain('Votura-Saal-linux-$architektur.tar.gz')
  })
})

describe('Der Abbildbau', () => {
  it('benutzt dasselbe Einrichtungsskript wie ein laufender Pi', () => {
    /* Zwei getrennte Einrichtungen liefen auseinander, und gemerkt hätte man
       es im Saal. */
    expect(abbild).toContain('/tmp/votura/install.sh --paket')
    expect(abbild).toContain('cp "$hier/pi/install.sh"')
  })

  it('entfernt die Wirtsschlüssel aus dem Abbild', () => {
    /* Sonst hätten zwei Pis aus derselben Karte dieselbe Kennung. */
    expect(abbild).toContain('rm -f /etc/ssh/ssh_host_*')
    expect(abbild).toContain('/etc/machine-id')
  })

  it('vergrößert das Abbild, bevor es einhängt', () => {
    /* Ein Lite-Abbild hat keinen Platz für Electron. */
    expect(abbild).toContain('truncate -s')
    expect(abbild).toContain('resizepart 2 100%')
    expect(abbild).toContain('resize2fs')
  })

  it('gibt eine Prüfsumme aus', () => {
    expect(abbild).toContain('sha256sum')
  })
})

describe('Die Linux-Pakete', () => {
  it('sind für x64 und arm64 vorgesehen', () => {
    for (const datei of ['electron-builder.yml', 'electron-builder-saal.yml']) {
      const architekturen = linuxArchitekturen(datei)
      expect(architekturen).toContain('x64')
      expect(architekturen).toContain('arm64')
    }
  })

  it('tragen Plattform und Architektur im Namen', () => {
    /* Auf der Veröffentlichungsseite liegen Windows- und Linux-Dateien
       nebeneinander; `votura-1.1.0.tar.gz` sagt nicht, wofür es ist. */
    for (const datei of ['electron-builder.yml', 'electron-builder-saal.yml']) {
      expect(linuxAngabe(datei, 'artifactName')).toContain('linux-${arch}')
    }
  })
})
