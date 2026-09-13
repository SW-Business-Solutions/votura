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
     *
     * Genau das ist passiert, und diese Prüfung hat es durchgelassen: Sie
     * verglich die beiden Namen nicht, sie sah nur nach, dass jeder für sich
     * vorkommt. Jetzt wird der Name des Bauplans in die Form des Skripts
     * übersetzt und muss dort wörtlich stehen.
     */
    const bauplan = linuxAngabe('electron-builder-saal.yml', 'artifactName')
    expect(bauplan).toBe('Votura-Saal-${version}-linux-${arch}.${ext}')

    const gesucht = bauplan.replace('${version}', '%s').replace('${arch}', '%s').replace('${ext}', 'tar.gz')
    expect(install).toContain(gesucht)
  })
})

describe('Die Adresse, von der das Paket kommt', () => {
  it('trägt die Versionsnummer im Dateinamen', () => {
    /*
     * GitHubs `latest/download/<name>` braucht den **genauen** Dateinamen.
     * Die Assets heißen `Votura-Saal-1.2.0-linux-arm64.tar.gz`; die Adresse
     * ohne Nummer antwortete mit 404 — und damit lief der in README und auf
     * der Webseite dokumentierte Einzeiler ins Leere.
     */
    expect(install).not.toContain('latest/download/Votura-Saal-linux-')
    expect(install).toContain('Votura-Saal-%s-linux-%s.tar.gz')
  })

  it('schlägt die neueste Fassung über die Weiterleitung nach', () => {
    /* `.../releases/latest` leitet auf `.../releases/tag/v1.2.0` — daraus
       kommt die Nummer, ohne dass jq auf dem Pi liegen müsste. */
    expect(install).toContain('url_effective')
    expect(install).toContain('${ziel##*/v}')
  })

  it('nimmt nur eine Nummer an, die wie eine aussieht', () => {
    /* Sonst stünde bei einer unerwarteten Antwort halbes HTML im Dateinamen
       und der Fehler käme erst beim Auspacken. */
    expect(install).toMatch(/\[\[ "\$nummer" =~ \^\[0-9\]\+/)
  })
})

describe('Die Aktualisierung auf dem Pi', () => {
  const aktualisieren = install.slice(
    install.indexOf('aktualisieren.sh" <<SKRIPT'),
    install.indexOf('chmod +x "$ZIEL/aktualisieren.sh"')
  )

  it('lädt und prüft, bevor sie den Dienst anhält', () => {
    /*
     * Bricht das Netz mittendrin weg, läuft die alte Fassung weiter.
     * Andersherum bliebe die Leinwand schwarz, bis jemand hingeht — und im
     * Saal steht niemand daneben.
     */
    const geladen = aktualisieren.indexOf('curl -fL')
    const geprueft = aktualisieren.indexOf('tar -tzf')
    const angehalten = aktualisieren.indexOf('systemctl stop')
    expect(geladen).toBeGreaterThan(-1)
    expect(geladen).toBeLessThan(geprueft)
    expect(geprueft).toBeLessThan(angehalten)
  })

  it('schlägt die Fassung bei jedem Lauf neu nach', () => {
    /* Die Nummer darf nicht aus der Einrichtung eingebrannt sein, sonst holt
       der Pi für immer dieselbe Fassung. */
    expect(aktualisieren).toContain('url_effective')
    expect(aktualisieren).toContain('Votura-Saal-\\$nummer-linux-')
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

describe('Das Verzeichnis für den Raspberry Pi Imager', () => {
  const erzeuger = lies('tools/os-list.mjs')

  it('nennt nur Geräte, die es auch tragen', () => {
    /* Pi 3 fehlt mit Absicht: kein Electron für armv7, und Chromium auf 1 GB
       RAM ist für eine Wand, die stundenlang läuft, zu knapp. */
    expect(erzeuger).toContain("'pi4-64bit'")
    expect(erzeuger).toContain("'pi5-64bit'")
    expect(erzeuger).not.toContain('pi3')
  })

  it('rechnet Größe und Prüfsumme des ausgepackten Abbilds', () => {
    /*
     * Der Imager prüft die geschriebene Karte damit gegen. Falsche Werte
     * fallen erst am Ende eines langen Schreibvorgangs auf — und dann steht
     * jemand mit einer halben Stunde Wartezeit und einer unbrauchbaren Karte
     * da.
     */
    expect(erzeuger).toContain('extract_size')
    expect(erzeuger).toContain('extract_sha256')
    expect(erzeuger).toContain('image_download_size')
  })

  it('überspringt die Erstschritte beim ersten Start', () => {
    /* Es gibt keinen Desktop, und die Fragen nach Sprache und Benutzer
       beantwortet im Saal niemand. */
    expect(erzeuger).toContain("init_format: 'none'")
  })
})
