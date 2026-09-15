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
    expect(install).toContain('DATEN="/var/lib/$PROGRAMM"')
    expect(install).toContain('--user-data-dir=$DATEN')
    expect(install).toContain('Die Zuordnung zum Hauptrechner bleibt erhalten')
    expect(install).toContain('Die Daten der Versammlung bleiben erhalten')
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
    for (const [datei, kurz] of [
      ['electron-builder-saal.yml', 'Votura-Saal'],
      ['electron-builder.yml', 'Votura']
    ] as const) {
      const bauplan = linuxAngabe(datei, 'artifactName')
      expect(bauplan).toBe(kurz + '-${version}-linux-${arch}.${ext}')
      /* Das Skript setzt den Kurznamen in eine Variable und den Rest über
         printf zusammen — beide Hälften müssen zum Bauplan passen. */
      expect(install).toContain("ARCHIV='" + kurz + "'")
    }
    expect(install).toContain("'%s/download/v%s/%s-%s-linux-%s.tar.gz'")
  })
})

describe('Die NDI-Laufzeit auf dem Pi', () => {
  it('kommt nicht mit ins Abbild', () => {
    /*
     * Ein fest eingerichtetes Abbild ist kein Allzweckrechner, sondern ein
     * Gerät mit fester Funktion: Es bootet ohne Anmeldung in Votura, es gibt
     * keinen Zugang, und wer etwas ändern will, schreibt die Karte neu.
     *
     * Der Produktbegriff der NDI-SDK-Lizenz schließt genau das aus. Solange
     * ungeklärt ist, ob ein Pi-Abbild darunter fällt, kommt die Laufzeit hier
     * nicht mit — und die Anleitung sagt es auch so.
     */
    expect(install).toContain('app.asar.unpacked/node_modules/@grandi')
    expect(install).toMatch(/rm -rf "\$ndi_weg"/)
  })

  it('betrifft nur das Abbild, nicht die Desktop-Fassungen', () => {
    /* Windows und Linux sind Allzweckrechner und von der Lizenz gedeckt —
       dort bleibt die Kamerafähigkeit. */
    const bau = lies('electron-builder.yml')
    expect(bau).toContain('node_modules/@grandi/**')
  })
})

describe('Die Adresse, von der das Paket kommt', () => {
  it('trägt die Versionsnummer im Dateinamen', () => {
    /*
     * GitHubs `latest/download/<name>` braucht den **genauen** Dateinamen.
     * Die Assets heißen `Votura-Saal-1.3.0-linux-arm64.tar.gz`; die Adresse
     * ohne Nummer antwortete mit 404 — und damit lief der in README und auf
     * der Webseite dokumentierte Einzeiler ins Leere.
     */
    expect(install).not.toContain('latest/download/Votura-Saal-linux-')
    expect(install).toContain('%s-%s-linux-%s.tar.gz')
  })

  it('schlägt die neueste Fassung über die Weiterleitung nach', () => {
    /* `.../releases/latest` leitet auf `.../releases/tag/v1.3.0` — daraus
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
    expect(aktualisieren).toContain('$ARCHIV-\\$nummer-linux-')
  })
})

describe('Die beiden Rollen', () => {
  /*
   * Ein Pi kann zweierlei sein: das Anzeigegerät hinter dem Beamer oder der
   * Rechner, an dem die Versammlung geführt wird. Der Unterschied ist nicht
   * kosmetisch — die eine Rolle wird *angesehen*, die andere *bedient*.
   */
  it('kennt Saal und Hauptrechner und sonst nichts', () => {
    expect(install).toContain('saal)')
    expect(install).toContain('hauptrechner)')
    /* Ein Tippfehler in der Rolle darf nicht stillschweigend zur
       Voreinstellung führen — sonst stünde am Ende das Falsche im Saal. */
    expect(install).toContain('Unbekannte Rolle:')
  })

  it('gibt dem Hauptrechner eine Fensterverwaltung', () => {
    /* Ohne sie hätte ein Dateidialog keinen Rahmen, ließe sich nicht
       verschieben und landete womöglich hinter dem Hauptfenster. */
    expect(install).toContain('openbox')
    expect(install).toContain('rc.xml')
  })

  it('lässt den Mauszeiger nur im Saal verschwinden', () => {
    /* Auf einer Leinwand hat er nichts zu suchen; auf einem Rechner, der
       bedient wird, ist er unentbehrlich. */
    const fuerSaal = /besonders=\(unclutter\)/.test(install)
    const fuerHauptrechner = /besonders=\(openbox[^)]*\)/.exec(install)?.[0] ?? ''
    expect(fuerSaal).toBe(true)
    expect(fuerHauptrechner).not.toContain('unclutter')
    /* Und jede Rolle bekommt genau ein Startskript, nicht beide. */
    expect(install.match(/unclutter -idle/g)).toHaveLength(1)
    expect(install.match(/openbox --config-file/g)).toHaveLength(1)
  })

  it('gibt dem Hauptrechner einen Weg an das System heran', () => {
    /* Im Vollbild ohne Anmeldung gäbe es sonst keinen, wenn etwas klemmt. */
    expect(install).toContain('C-A-t')
    expect(install).toContain('xterm')
  })

  it('gibt dem Hauptrechner ein Sicherungsskript', () => {
    /*
     * Dort liegen die Daten der Versammlung, und sie liegen auf einer
     * SD-Karte. Karten sterben ohne Vorwarnung.
     */
    expect(install).toContain('/usr/local/bin/votura-sichern')
    /* Von Hand aufgerufen, nicht heimlich im Hintergrund — und ohne den
       Dienst anzuhalten, denn eine Versammlung hält man dafür nicht an. */
    expect(install).not.toContain('votura-sichern.timer')
  })

  it('nennt Ordner, Dienst und Rechner nach der Rolle', () => {
    /* Ein Abbild, das „votura-saal" heißt, aber den Hauptrechner enthält,
       wäre die Art Verwechslung, die erst im Saal auffällt. */
    expect(install).toContain('ZIEL="/opt/$PROGRAMM"')
    expect(install).toContain('DATEN="/var/lib/$PROGRAMM"')
    expect(abbild).toContain("saal) KURZ='votura-saal'")
    expect(abbild).toContain("hauptrechner) KURZ='votura'")
    expect(abbild).toContain('$KURZ-$version-arm64.img')
  })
})

describe('Die Frage nach der Rolle', () => {
  /*
   * `curl … | sudo bash` wählte stillschweigend den Saal. Wer den
   * Hauptrechner wollte, musste `-s -- --rolle hauptrechner` kennen — eine
   * Angabe, die nirgends steht, wo jemand sie sucht.
   */
  it('fragt, wenn niemand die Rolle angegeben hat', () => {
    expect(install).toContain("rolle=''")
    expect(install).toContain('rolle="$(frage_rolle)"')
  })

  it('fragt über /dev/tty, nicht über die Standardeingabe', () => {
    /*
     * Bei `curl … | sudo bash` **ist** die Standardeingabe das Skript selbst.
     * Ein `read` dort läse die nächste Zeile des Skripts statt der Antwort —
     * und verschluckte sie obendrein.
     */
    expect(install).toContain('exec 3<>/dev/tty')
    expect(install).toMatch(/read -r antwort <&3/)
    expect(install).not.toMatch(/read -r antwort\s*$/m)
  })

  it('wartet nicht, wenn kein Mensch davorsitzt', () => {
    /* Im chroot des Abbildbaus und in jedem unbeaufsichtigten Lauf gibt es
       kein Terminal — dort darf nichts auf eine Antwort warten, die nie
       kommt. */
    expect(install).toMatch(/if ! \{ exec 3<>\/dev\/tty; \} 2>\/dev\/null; then\s*\n\s*printf 'saal'/)
  })

  it('fragt nicht, wenn die Rolle angegeben wurde', () => {
    /* Der Abbildbau gibt sie mit — er darf nie gefragt werden. */
    expect(install).toContain('[[ -n "$rolle" ]] || rolle="$(frage_rolle)"')
    expect(abbild).toContain('/tmp/votura/install.sh --rolle')
  })

  it('prüft die Berechtigung, bevor es fragt', () => {
    /* Erst antworten und dann an `sudo` scheitern wäre die falsche
       Reihenfolge. */
    expect(install.indexOf('[[ $EUID -eq 0 ]]')).toBeLessThan(install.indexOf('frage_rolle()'))
  })

  it('nimmt bei bloßem Enter die häufige Rolle', () => {
    /* Von Bühnen gibt es viele, Hauptrechner genau einen. */
    expect(install).toContain('"${antwort:-1}"')
  })
})

describe('Was Raspberry Pi OS britisch mitbringt', () => {
  /*
   * Zeitzone Europe/London, Tastatur `gb`, Sprache en_GB. Für eine
   * Versammlung in Deutschland ist jede der drei Angaben falsch, und keine
   * meldet sich von selbst. Im gebauten Abbild stand genau das drin, bevor
   * diese Prüfungen entstanden.
   */
  it('stellt die Uhr auf die richtige Zeitzone', () => {
    /* Die Uhr ginge sonst eine Stunde daneben — und Uhrzeiten stehen im
       Protokoll einer Wahl. */
    expect(install).toContain("zeitzone='Europe/Berlin'")
    expect(install).toContain('/etc/timezone')
    expect(install).toContain('/usr/share/zoneinfo/$zeitzone')
  })

  it('legt eine deutsche Tastatur auf', () => {
    /* Auf der britischen sitzen Y und Z vertauscht und Umlaute fehlen ganz
       — bei der Erfassung von Namen ist das keine Kleinigkeit. */
    expect(install).toContain("tastatur='de'")
    expect(install).toContain('/etc/default/keyboard')
    expect(install).toContain('XKBLAYOUT="$tastatur"')
  })

  it('erzeugt die deutsche Sprachumgebung', () => {
    expect(install).toContain('de_DE.UTF-8')
    expect(install).toContain('locale-gen')
    expect(install).toContain('LANG=de_DE.UTF-8')
  })

  it('lässt sich für Österreich und die Schweiz umstellen', () => {
    /* Dieselbe Sprache, andere Zeitzone und Tastatur. */
    expect(install).toContain('--zeitzone')
    expect(install).toContain('--tastatur')
  })

  it('bringt Schriften mit', () => {
    /* Ohne sie zeigt Chromium Kästchen statt Buchstaben, und auf einer
       Leinwand fällt das spät auf. */
    expect(install).toContain('fonts-dejavu')
  })
})

describe('Der Abbildbau', () => {
  it('benutzt dasselbe Einrichtungsskript wie ein laufender Pi', () => {
    /* Zwei getrennte Einrichtungen liefen auseinander, und gemerkt hätte man
       es im Saal. */
    expect(abbild).toContain('/tmp/votura/install.sh --rolle')
    expect(abbild).toContain('--paket /tmp/votura/paket.tar.gz')
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
