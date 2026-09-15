#!/usr/bin/env bash
#
# Richtet einen Raspberry Pi für Votura ein — in einer von zwei Rollen.
#
#   saal          Anzeigegerät hinter dem Beamer oder unter dem Pult.
#                 Vollbild, kein Desktop, kein Mauszeiger.
#   hauptrechner  Der Rechner, an dem die Versammlung geführt wird.
#                 Mit Fensterverwaltung und Mauszeiger — er wird bedient.
#
# In beiden Fällen bootet der Pi ohne Anmeldung in die Anwendung, und was
# abstürzt, kommt zurück.
#
# Bewusst ein Skript und kein fertiges Abbild als einziger Weg: Ein Skript
# lässt sich lesen, bevor man es ausführt, es läuft auf einem bereits
# eingerichteten Pi, und es ist die Grundlage, aus der die Abbilder entstehen.
#
# Aufruf:
#   sudo ./install.sh                              (fragt nach der Rolle)
#   sudo ./install.sh --rolle saal
#   sudo ./install.sh --rolle hauptrechner
#   sudo ./install.sh --paket ./Votura-Saal-1.3.0-linux-arm64.tar.gz
#   sudo ./install.sh --version 1.3.0
#   sudo ./install.sh --zeitzone Europe/Vienna --tastatur ch
set -euo pipefail

QUELLE_BASIS='https://github.com/SW-Business-Solutions/votura/releases'
BENUTZER='votura'

rolle=''
paket=''
version='latest'
zeitzone='Europe/Berlin'
tastatur='de'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rolle) rolle="$2"; shift 2 ;;
    --paket) paket="$2"; shift 2 ;;
    --version) version="$2"; shift 2 ;;
    --zeitzone) zeitzone="$2"; shift 2 ;;
    --tastatur) tastatur="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unbekannte Angabe: $1" >&2; exit 2 ;;
  esac
done

melde() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
fehler() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Zuerst, noch vor jeder Frage: Wer nicht darf, soll nicht erst antworten
# müssen.
[[ $EUID -eq 0 ]] || fehler 'Bitte mit sudo ausführen.'

# Welche Rolle soll es sein?
#
# Gefragt wird nur, wenn niemand `--rolle` angegeben hat und ein Mensch
# davorsitzt. Der Abbildbau gibt die Rolle mit und wird nie gefragt.
#
# **Gefragt wird über `/dev/tty`, nicht über die Standardeingabe.** Der Aufruf
# aus der Anleitung lautet `curl … | sudo bash` — dort *ist* die
# Standardeingabe das Skript selbst. Ein `read` läse die nächste Zeile des
# Skripts, nicht die Antwort, und verschluckte sie obendrein.
#
# Lässt sich kein Terminal öffnen, bleibt es bei `saal`: Das ist die Rolle,
# die es vielfach gibt, und ein unbeaufsichtigter Lauf darf nicht auf eine
# Antwort warten, die nie kommt.
frage_rolle() {
  local antwort
  if ! { exec 3<>/dev/tty; } 2>/dev/null; then
    printf 'saal'
    return
  fi

  {
    printf '\n  \033[1mWelche Rolle soll dieser Pi bekommen?\033[0m\n\n'
    printf '    1) Bühne oder Pult\n'
    printf '       Zeigt, was der Hauptrechner sagt — hinter dem Beamer oder unter dem\n'
    printf '       Rednerpult. So viele, wie Bildschirme da sind.\n\n'
    printf '    2) Hauptrechner\n'
    printf '       Hier wird die Versammlung geführt: Wahlgänge, Stimmzettel, Ergebnisse.\n'
    printf '       Genau einer. Die Daten liegen dann auf der SD-Karte.\n\n'
  } >&3

  while true; do
    printf '  Auswahl [1]: ' >&3
    if ! read -r antwort <&3; then
      # Kein Gegenüber mehr — lieber die häufige Rolle als ein Abbruch.
      printf '\n' >&3
      exec 3>&-
      printf 'saal'
      return
    fi
    case "${antwort:-1}" in
      1 | saal | Saal | s | S)
        exec 3>&-
        printf 'saal'
        return ;;
      2 | hauptrechner | Hauptrechner | h | H)
        exec 3>&-
        printf 'hauptrechner'
        return ;;
      *)
        printf '  Bitte 1 oder 2 eingeben.\n' >&3 ;;
    esac
  done
}

# --------------------------------------------------------------- Die Rolle
#
# Die beiden Rollen unterscheiden sich in einem Punkt grundsätzlich: Die eine
# wird *angesehen*, die andere *bedient*. Daran hängt alles Weitere — ob es
# eine Fensterverwaltung gibt, ob ein Mauszeiger zu sehen ist, ob Drucker und
# Wechseldatenträger gebraucht werden.

[[ -n "$rolle" ]] || rolle="$(frage_rolle)"

case "$rolle" in
  saal)
    ANWENDUNG='Votura Saal'
    PROGRAMM='votura-saal'
    ARCHIV='Votura-Saal'
    RECHNERNAME='votura-saal'
    ;;
  hauptrechner)
    ANWENDUNG='Votura'
    PROGRAMM='votura'
    ARCHIV='Votura'
    RECHNERNAME='votura'
    ;;
  *)
    fehler "Unbekannte Rolle: $rolle (erlaubt sind 'saal' und 'hauptrechner')"
    ;;
esac

ZIEL="/opt/$PROGRAMM"
DATEN="/var/lib/$PROGRAMM"
DIENST="$PROGRAMM"

# Die Adresse des Pakets zu einer Fassung.
#
# Die Dateien tragen die Versionsnummer im Namen, GitHubs `latest/download`
# braucht aber den genauen Dateinamen — ohne Nummer antwortet es mit 404. Bei
# `latest` wird die Nummer deshalb zuerst nachgeschlagen: Die Weiterleitung
# von `.../releases/latest` endet auf dem Etikett der neuesten Fassung.
paketadresse() {
  local wunsch="$1" bogen="$2" nummer="$1" ziel
  if [[ "$wunsch" == 'latest' ]]; then
    ziel="$(curl -fsSL -o /dev/null -w '%{url_effective}' "$QUELLE_BASIS/latest")" \
      || fehler 'Die neueste Fassung ließ sich nicht ermitteln. Steht das Netz?'
    nummer="${ziel##*/v}"
    [[ "$nummer" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fehler "Unerwartetes Etikett: $ziel"
  fi
  printf '%s/download/v%s/%s-%s-linux-%s.tar.gz' \
    "$QUELLE_BASIS" "$nummer" "$ARCHIV" "$nummer" "$bogen"
}

# ---------------------------------------------------------------- Prüfungen

melde 'Gerät und System prüfen'

architektur="$(dpkg --print-architecture)"
if [[ "$architektur" != 'arm64' && "$architektur" != 'amd64' ]]; then
  fehler "Diese Architektur ($architektur) wird nicht unterstützt.
$ANWENDUNG braucht ein 64-Bit-System — Electron unterstützt kein armv7 mehr.
Bitte Raspberry Pi OS (64-bit) verwenden."
fi

speicher_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
if [[ "$rolle" == 'hauptrechner' ]]; then
  # Der Hauptrechner rechnet: Foliensätze umwandeln, Ergebnisse setzen,
  # drucken. Mit 2 GB läuft er, aber 4 GB sind hier keine Zierde.
  if (( speicher_kb < 3600000 )); then
    echo "Hinweis: Nur $((speicher_kb / 1024)) MB Arbeitsspeicher. Der Hauptrechner
wandelt Foliensätze um und setzt Ergebnisse — 4 GB sind hier die empfohlene Größe."
  fi
elif (( speicher_kb < 1800000 )); then
  echo "Hinweis: Nur $((speicher_kb / 1024)) MB Arbeitsspeicher. Für eine Wand,
die stundenlang läuft, sind 2 GB die untere Grenze — es läuft, kann aber ruckeln."
fi

# ------------------------------------------------------------ Systempakete

melde 'Systempakete einrichten'

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# Was beide Rollen brauchen: ein X-Server, ein Startprogramm, die
# Bibliotheken von Chromium — und Schriften. Ohne Schriften zeigt Chromium
# Kästchen statt Buchstaben, und auf einer Leinwand fällt das spät auf.
gemeinsam=(
  xserver-xorg xinit x11-xserver-utils
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2
  libpango-1.0-0 libcairo2 libasound2
  fonts-dejavu fonts-liberation
  locales tzdata keyboard-configuration console-setup
  avahi-daemon curl ca-certificates
)

if [[ "$rolle" == 'hauptrechner' ]]; then
  # Eine Fensterverwaltung, weil dieser Rechner bedient wird: Ohne sie hat
  # ein Dateidialog keinen Rahmen, lässt sich nicht verschieben und landet
  # womöglich hinter dem Hauptfenster.
  #
  # CUPS für einen per USB angeschlossenen Bondrucker — der Netzwerkdruck
  # über Port 9100 braucht es nicht, aber welchen Drucker jemand mitbringt,
  # weiß man vorher nicht.
  #
  # gvfs und udisks2, damit im Dateidialog ein USB-Stick auftaucht: Das
  # Ergebnis will mitgenommen, der Foliensatz mitgebracht werden.
  besonders=(openbox xterm cups printer-driver-escpr gvfs gvfs-backends udisks2 xdg-utils)
else
  # Den Mauszeiger blendet `unclutter` aus — er hat auf einer Leinwand nichts
  # zu suchen.
  besonders=(unclutter)
fi

apt-get install -y --no-install-recommends "${gemeinsam[@]}" "${besonders[@]}" >/dev/null

# -------------------------------------------------- Deutsche Voreinstellung
#
# Raspberry Pi OS kommt britisch: Zeitzone Europe/London, Tastatur `gb`,
# Sprache en_GB. Für eine Versammlung in Deutschland ist jede der drei
# Angaben falsch, und zwar still:
#
#   Die Uhr geht eine Stunde daneben — und Uhrzeiten stehen im Protokoll.
#   Auf der Tastatur sitzen Y und Z vertauscht, Umlaute fehlen ganz.
#   Zahlen und Datumsangaben des Systems kommen englisch heraus.

melde 'Sprache, Zeit und Tastatur'

ln -sf "/usr/share/zoneinfo/$zeitzone" /etc/localtime
echo "$zeitzone" > /etc/timezone

sed -i 's/^# *\(de_DE.UTF-8 UTF-8\)/\1/' /etc/locale.gen
grep -q '^de_DE.UTF-8' /etc/locale.gen || echo 'de_DE.UTF-8 UTF-8' >> /etc/locale.gen
locale-gen >/dev/null
echo 'LANG=de_DE.UTF-8' > /etc/default/locale

cat > /etc/default/keyboard <<TASTATUR
XKBMODEL="pc105"
XKBLAYOUT="$tastatur"
XKBVARIANT=""
XKBOPTIONS=""
BACKSPACE="guess"
TASTATUR

# ------------------------------------------------------------------ Paket

melde "$ANWENDUNG einspielen"

arbeit="$(mktemp -d)"
trap 'rm -rf "$arbeit"' EXIT

if [[ -n "$paket" ]]; then
  [[ -f "$paket" ]] || fehler "Datei nicht gefunden: $paket"
  cp "$paket" "$arbeit/paket.tar.gz"
else
  adresse="$(paketadresse "$version" "$architektur")"
  echo "Lade $adresse"
  curl -fL --progress-bar -o "$arbeit/paket.tar.gz" "$adresse" \
    || fehler "Herunterladen fehlgeschlagen. Mit --paket eine lokale Datei angeben."
fi

rm -rf "$ZIEL"
mkdir -p "$ZIEL"
# Das Archiv bringt einen eigenen Wurzelordner mit; der kommt weg.
tar -xzf "$arbeit/paket.tar.gz" -C "$ZIEL" --strip-components=1
[[ -x "$ZIEL/$PROGRAMM" ]] || fehler "Im Archiv fehlt die Programmdatei $PROGRAMM."

# ------------------------------------------------------------------ NDI weg
#
# Ein fest eingerichtetes Abbild ist kein Allzweckrechner, sondern ein Gerät
# mit fester Funktion: Es bootet ohne Anmeldung in Votura, es gibt keinen
# Zugang, und wer daran etwas ändern will, muss die Karte neu schreiben.
#
# Der Produktbegriff der NDI-SDK-Lizenz schließt genau das aus (§1b: keine
# „appliances", keine eingebetteten Geräte). Ob ein Pi-Abbild darunter fällt,
# ist ungeklärt — und solange es das ist, kommt die NDI-Laufzeit hier nicht
# mit. Die Kameraansicht meldet auf dem Pi dann schlicht, dass sie auf diesem
# Rechner nicht zu haben ist; alles andere läuft.
#
# Für die Desktop-Fassungen (Windows, Linux) gilt das nicht: Die sind
# Allzweckrechner und von der Lizenz gedeckt.
ndi_weg="$ZIEL/resources/app.asar.unpacked/node_modules/@grandi"
if [[ -d "$ndi_weg" ]]; then
  rm -rf "$ndi_weg"
  melde 'NDI-Laufzeit aus dem Abbild entfernt (siehe Lizenzhinweis im Quelltext)'
fi

# ---------------------------------------------------------------- Benutzer

melde 'Benutzer und Rechte'

if ! id -u "$BENUTZER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$BENUTZER" --shell /usr/sbin/nologin "$BENUTZER"
fi
# `video` und `render` für die Grafikausgabe, `audio` für den Ton eines Films,
# `input` für die Tastatur — mehr braucht dieser Benutzer in der Saal-Rolle
# nicht. Der Hauptrechner kommt in `lp` und `plugdev` dazu: drucken und einen
# USB-Stick einhängen.
usermod -aG video,render,audio,input,tty "$BENUTZER"
if [[ "$rolle" == 'hauptrechner' ]]; then
  usermod -aG lp,lpadmin,plugdev "$BENUTZER" 2>/dev/null || true
fi

mkdir -p "$DATEN"
chown -R "$BENUTZER:$BENUTZER" "$DATEN" "/home/$BENUTZER"

# --------------------------------------------------------------- Startskript

melde 'Start einrichten'

if [[ "$rolle" == 'hauptrechner' ]]; then
  # Eine Fensterverwaltung mit genau einer eigenen Tastenkombination: Strg +
  # Alt + T öffnet ein Fenster mit einer Eingabezeile. Im Vollbild ohne
  # Anmeldung ist das der einzige Weg an das System heran, wenn etwas klemmt.
  mkdir -p "$ZIEL/openbox"
  cat > "$ZIEL/openbox/rc.xml" <<'FENSTER'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <keyboard>
    <keybind key="C-A-t">
      <action name="Execute"><command>xterm</command></action>
    </keybind>
    <keybind key="A-F4">
      <action name="Close"/>
    </keybind>
  </keyboard>
</openbox_config>
FENSTER

  cat > "$ZIEL/start.sh" <<SKRIPT
#!/usr/bin/env bash
#
# Startet Votura in einem X-Server mit Fensterverwaltung.
#
# Anders als im Saal bleibt hier der Mauszeiger sichtbar — dieser Rechner
# wird bedient, nicht angesehen. Der Bildschirmschoner bleibt trotzdem aus:
# Wer vorn spricht, wartet nicht, bis jemand eine Taste drückt.
set -euo pipefail

xset s off
xset s noblank
xset -dpms

# Ohne Fensterverwaltung hätte ein Dateidialog keinen Rahmen und ließe sich
# nicht verschieben. Strg + Alt + T öffnet eine Eingabezeile.
openbox --config-file $ZIEL/openbox/rc.xml &

exec $ZIEL/$PROGRAMM \\
  --no-sandbox \\
  --disable-features=UseChromeOSDirectVideoDecoder \\
  --user-data-dir=$DATEN
SKRIPT
else
  cat > "$ZIEL/start.sh" <<SKRIPT
#!/usr/bin/env bash
#
# Startet $ANWENDUNG in einem X-Server ohne Fensterverwaltung.
#
# \`xset\` schaltet Bildschirmschoner und Energiesparen ab: Ein Beamer, der
# nach zehn Minuten Vortrag schwarz wird, ist der klassische Saalunfall.
set -euo pipefail

xset s off
xset s noblank
xset -dpms

# Den Mauszeiger nach einer Sekunde ausblenden — er hat auf einer Leinwand
# nichts zu suchen, lässt sich aber durch Bewegen wieder hervorholen.
unclutter -idle 1 -root &

exec $ZIEL/$PROGRAMM \\
  --no-sandbox \\
  --disable-features=UseChromeOSDirectVideoDecoder \\
  --user-data-dir=$DATEN
SKRIPT
fi
chmod +x "$ZIEL/start.sh"

# Bis Fassung 1.3.0 hieß das Startskript `kiosk.sh`. Der Name bleibt als
# Verweis, damit ein selbstgeschriebener Dienst nicht ins Leere zeigt.
ln -sf "$ZIEL/start.sh" "$ZIEL/kiosk.sh"

if [[ "$rolle" == 'hauptrechner' ]]; then
  bleibt='Die Daten der Versammlung bleiben erhalten.'
else
  bleibt='Die Zuordnung zum Hauptrechner bleibt erhalten.'
fi

cat > "$ZIEL/aktualisieren.sh" <<SKRIPT
#!/usr/bin/env bash
# Holt die neueste Fassung und startet den Dienst neu.
set -euo pipefail
[[ \$EUID -eq 0 ]] || { echo 'Bitte mit sudo ausführen.' >&2; exit 1; }

# Erst holen, dann tauschen: Bricht das Netz weg, läuft die alte Fassung
# weiter. Andersherum bliebe der Bildschirm schwarz, bis jemand kommt.
#
# Die Dateien tragen die Versionsnummer im Namen, GitHubs \`latest/download\`
# braucht aber den genauen Dateinamen. Die Weiterleitung von
# \`.../releases/latest\` verrät das Etikett der neuesten Fassung.
etikett="\$(curl -fsSL -o /dev/null -w '%{url_effective}' '$QUELLE_BASIS/latest')"
nummer="\${etikett##*/v}"
[[ "\$nummer" =~ ^[0-9]+\.[0-9]+\.[0-9]+\$ ]] \\
  || { echo "Unerwartetes Etikett: \$etikett" >&2; exit 1; }

curl -fL --progress-bar -o /tmp/votura-paket.tar.gz \\
  "$QUELLE_BASIS/download/v\$nummer/$ARCHIV-\$nummer-linux-$architektur.tar.gz"
tar -tzf /tmp/votura-paket.tar.gz >/dev/null \\
  || { echo 'Die geladene Datei ist unvollständig.' >&2; exit 1; }

systemctl stop $DIENST
rm -rf '$ZIEL'/{resources,locales,chrome*,lib*,$PROGRAMM,*.pak,*.bin,*.dat,*.json}
tar -xzf /tmp/votura-paket.tar.gz -C '$ZIEL' --strip-components=1
rm -f /tmp/votura-paket.tar.gz
systemctl start $DIENST
echo "Fertig, jetzt \$nummer. $bleibt"
SKRIPT
chmod +x "$ZIEL/aktualisieren.sh"

# ------------------------------------------------------------------ Dienst

melde 'Dienst einrichten'

cat > "/etc/systemd/system/$DIENST.service" <<SKRIPT
[Unit]
Description=$ANWENDUNG
After=network-online.target
Wants=network-online.target

[Service]
# Der eigentliche Grund für den Dienst: Was abstürzt, kommt zurück. Im Saal
# steht niemand daneben, der etwas neu startet.
Restart=always
RestartSec=3
User=$BENUTZER
PAMName=login
TTYPath=/dev/tty1
StandardInput=tty
StandardOutput=journal
StandardError=journal
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
Environment=HOME=/home/$BENUTZER
Environment=LANG=de_DE.UTF-8
Environment=XDG_RUNTIME_DIR=/run/user/%U
ExecStart=/usr/bin/xinit $ZIEL/start.sh -- :0 vt1 -nolisten tcp -keeptty

[Install]
WantedBy=multi-user.target
SKRIPT

# Ohne diese Erlaubnis startet ein X-Server nur für root.
if [[ -f /etc/X11/Xwrapper.config ]]; then
  sed -i 's/^allowed_users=.*/allowed_users=anybody/' /etc/X11/Xwrapper.config
else
  echo 'allowed_users=anybody' > /etc/X11/Xwrapper.config
fi
grep -q '^needs_root_rights' /etc/X11/Xwrapper.config || echo 'needs_root_rights=yes' >> /etc/X11/Xwrapper.config

systemctl daemon-reload
systemctl enable "$DIENST" >/dev/null

# --------------------------------------------------------------- Sicherung
#
# Nur für den Hauptrechner, und nur er braucht es: Dort liegen die Daten der
# Versammlung, und sie liegen auf einer SD-Karte. Karten sterben ohne
# Vorwarnung. Das Skript schreibt eine Kopie auf einen eingehängten
# Datenträger — von Hand aufgerufen, nicht heimlich im Hintergrund.

if [[ "$rolle" == 'hauptrechner' ]]; then
  cat > /usr/local/bin/votura-sichern <<SKRIPT
#!/usr/bin/env bash
# Schreibt eine Kopie der Daten auf einen Datenträger.
#
#   sudo votura-sichern /media/usb
set -euo pipefail
[[ \$EUID -eq 0 ]] || { echo 'Bitte mit sudo ausführen.' >&2; exit 1; }
ziel="\${1:-}"
[[ -d "\$ziel" ]] || { echo "Kein Ordner: \$ziel" >&2; exit 2; }

name="votura-\$(date +%Y-%m-%d-%H%M).tar.gz"
# Angehalten wird nicht: SQLite im WAL-Verfahren verträgt eine Kopie im
# Betrieb, und eine Versammlung anzuhalten, um sie zu sichern, wäre verkehrt.
tar -czf "\$ziel/\$name" -C '$DATEN' .
sync
echo "Geschrieben: \$ziel/\$name (\$(du -h "\$ziel/\$name" | cut -f1))"
SKRIPT
  chmod +x /usr/local/bin/votura-sichern
fi

# ------------------------------------------------------------------- Name

melde 'Netzwerkname setzen'

# Damit sich der Pi aus der Ferne finden lässt, ohne seine Adresse zu kennen.
if [[ "$(hostname)" != "$RECHNERNAME" ]]; then
  # Beim Abbildbau läuft dieses Skript im chroot. Dort gibt es kein systemd,
  # `hostnamectl` findet seinen Bus nicht und riss bisher den ganzen Lauf mit.
  # Die Datei genügt: Gelesen wird sie ohnehin erst beim Start auf dem Pi.
  if [[ -d /run/systemd/system ]]; then
    hostnamectl set-hostname "$RECHNERNAME"
  else
    echo "$RECHNERNAME" > /etc/hostname
  fi
  sed -i "s/127.0.1.1.*/127.0.1.1\t$RECHNERNAME/" /etc/hosts
fi
systemctl enable avahi-daemon >/dev/null 2>&1 || true

# ----------------------------------------------------------------- Fertig

if [[ "$rolle" == 'hauptrechner' ]]; then
  cat <<ENDE

  Fertig — der Pi ist jetzt der Hauptrechner.

    sudo reboot

  Später:
    Strg + Alt + T                  Eingabezeile, wenn etwas klemmt
    sudo votura-sichern /media/…    Daten auf einen Datenträger kopieren
    ssh $RECHNERNAME.local                aus der Ferne ansehen
    journalctl -fu $DIENST          mitlesen, was der Dienst sagt

  Die Daten der Versammlung liegen unter $DATEN — auf der SD-Karte.
  Vor jeder Versammlung eine Sicherung, danach noch eine.

ENDE
else
  cat <<ENDE

  Fertig.

  Nach dem Neustart erscheint die Einrichtung: Hauptrechner suchen, Rolle
  wählen — Bühne oder Prompter —, übernehmen.

    sudo reboot

  Später:
    Strg + Umschalt + E             zurück in die Einrichtung
    ssh $RECHNERNAME.local           aus der Ferne ansehen
    journalctl -fu $DIENST     mitlesen, was der Dienst sagt

ENDE
fi
