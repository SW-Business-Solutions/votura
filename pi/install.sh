#!/usr/bin/env bash
#
# Richtet einen Raspberry Pi als Anzeigegerät für Votura ein.
#
# Nach dem Durchlauf bootet der Pi ohne Anmeldung in Votura Saal — Vollbild,
# kein Desktop, kein Mauszeiger. Stürzt die Anwendung ab, startet sie neu.
#
# Bewusst ein Skript und kein fertiges Abbild als einziger Weg: Ein Skript
# lässt sich lesen, bevor man es ausführt, es läuft auf einem bereits
# eingerichteten Pi, und es ist die Grundlage, aus der das Abbild entsteht.
#
# Aufruf:
#   sudo ./install.sh                        (holt das Paket von getvotura.de)
#   sudo ./install.sh --paket ./votura-saal-1.1.0-arm64.tar.gz
#   sudo ./install.sh --version 1.1.0
set -euo pipefail

QUELLE_BASIS='https://github.com/SW-Business-Solutions/votura/releases'
ZIEL='/opt/votura-saal'
BENUTZER='votura'
DATEN='/var/lib/votura-saal'

paket=''
version='latest'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --paket) paket="$2"; shift 2 ;;
    --version) version="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unbekannte Angabe: $1" >&2; exit 2 ;;
  esac
done

melde() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
fehler() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fehler 'Bitte mit sudo ausführen.'

# ---------------------------------------------------------------- Prüfungen

melde 'Gerät und System prüfen'

architektur="$(dpkg --print-architecture)"
if [[ "$architektur" != 'arm64' && "$architektur" != 'amd64' ]]; then
  fehler "Diese Architektur ($architektur) wird nicht unterstützt.
Votura Saal braucht ein 64-Bit-System — Electron unterstützt kein armv7 mehr.
Bitte Raspberry Pi OS (64-bit) verwenden."
fi

speicher_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
if (( speicher_kb < 1800000 )); then
  echo "Hinweis: Nur $((speicher_kb / 1024)) MB Arbeitsspeicher. Für eine Wand,
die stundenlang läuft, sind 2 GB die untere Grenze — es läuft, kann aber ruckeln."
fi

# ------------------------------------------------------------ Systempakete

melde 'Systempakete einrichten'

# Bewusst knapp: ein X-Server, ein Startprogramm, sonst nichts. Ein
# Fenstermanager brächte Titelleisten und einen Mauszeiger auf die Leinwand.
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
  xserver-xorg xinit x11-xserver-utils \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libpango-1.0-0 libcairo2 libasound2 \
  unclutter avahi-daemon curl ca-certificates >/dev/null

# ------------------------------------------------------------------ Paket

melde 'Votura Saal einspielen'

arbeit="$(mktemp -d)"
trap 'rm -rf "$arbeit"' EXIT

if [[ -n "$paket" ]]; then
  [[ -f "$paket" ]] || fehler "Datei nicht gefunden: $paket"
  cp "$paket" "$arbeit/votura-saal.tar.gz"
else
  if [[ "$version" == 'latest' ]]; then
    adresse="$QUELLE_BASIS/latest/download/Votura-Saal-linux-$architektur.tar.gz"
  else
    adresse="$QUELLE_BASIS/download/v$version/Votura-Saal-linux-$architektur.tar.gz"
  fi
  echo "Lade $adresse"
  curl -fL --progress-bar -o "$arbeit/votura-saal.tar.gz" "$adresse" \
    || fehler "Herunterladen fehlgeschlagen. Mit --paket eine lokale Datei angeben."
fi

rm -rf "$ZIEL"
mkdir -p "$ZIEL"
# Das Archiv bringt einen eigenen Wurzelordner mit; der kommt weg.
tar -xzf "$arbeit/votura-saal.tar.gz" -C "$ZIEL" --strip-components=1
[[ -x "$ZIEL/votura-saal" ]] || fehler 'Im Archiv fehlt die Programmdatei votura-saal.'

# ---------------------------------------------------------------- Benutzer

melde 'Benutzer und Rechte'

if ! id -u "$BENUTZER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$BENUTZER" --shell /usr/sbin/nologin "$BENUTZER"
fi
# `video` und `render` für die Grafikausgabe, `audio` für den Ton eines Films,
# `input` für Tastatur (Strg+Umschalt+E) — mehr braucht dieser Benutzer nicht.
usermod -aG video,render,audio,input,tty "$BENUTZER"

mkdir -p "$DATEN"
chown -R "$BENUTZER:$BENUTZER" "$DATEN" "/home/$BENUTZER"

# --------------------------------------------------------------- Startskript

melde 'Kioskstart einrichten'

cat > "$ZIEL/kiosk.sh" <<'SKRIPT'
#!/usr/bin/env bash
#
# Startet Votura Saal in einem X-Server ohne Fensterverwaltung.
#
# `xset` schaltet Bildschirmschoner und Energiesparen ab: Ein Beamer, der nach
# zehn Minuten Vortrag schwarz wird, ist der klassische Saalunfall.
set -euo pipefail

xset s off
xset s noblank
xset -dpms

# Den Mauszeiger nach einer Sekunde ausblenden — er hat auf einer Leinwand
# nichts zu suchen, lässt sich aber durch Bewegen wieder hervorholen.
unclutter -idle 1 -root &

exec /opt/votura-saal/votura-saal \
  --no-sandbox \
  --disable-features=UseChromeOSDirectVideoDecoder \
  --user-data-dir=/var/lib/votura-saal
SKRIPT
chmod +x "$ZIEL/kiosk.sh"

cat > "$ZIEL/aktualisieren.sh" <<SKRIPT
#!/usr/bin/env bash
# Holt die neueste Fassung und startet den Dienst neu.
set -euo pipefail
[[ \$EUID -eq 0 ]] || { echo 'Bitte mit sudo ausführen.' >&2; exit 1; }
systemctl stop votura-saal
curl -fL --progress-bar -o /tmp/votura-saal.tar.gz \\
  '$QUELLE_BASIS/latest/download/Votura-Saal-linux-$architektur.tar.gz'
rm -rf '$ZIEL'/{resources,locales,chrome*,lib*,votura-saal,*.pak,*.bin,*.dat,*.json}
tar -xzf /tmp/votura-saal.tar.gz -C '$ZIEL' --strip-components=1
rm -f /tmp/votura-saal.tar.gz
systemctl start votura-saal
echo 'Fertig. Die Zuordnung zum Hauptrechner bleibt erhalten.'
SKRIPT
chmod +x "$ZIEL/aktualisieren.sh"

# ------------------------------------------------------------------ Dienst

melde 'Dienst einrichten'

cat > /etc/systemd/system/votura-saal.service <<SKRIPT
[Unit]
Description=Votura Saal — Anzeige für eine Versammlung
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
Environment=XDG_RUNTIME_DIR=/run/user/%U
ExecStart=/usr/bin/xinit $ZIEL/kiosk.sh -- :0 vt1 -nolisten tcp -keeptty

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
systemctl enable votura-saal >/dev/null

# ------------------------------------------------------------------- Name

melde 'Netzwerkname setzen'

# Damit sich der Pi aus der Ferne finden lässt, ohne seine Adresse zu kennen.
if [[ "$(hostname)" != 'votura-saal' ]]; then
  # Beim Abbildbau läuft dieses Skript im chroot. Dort gibt es kein systemd,
  # `hostnamectl` findet seinen Bus nicht und riss bisher den ganzen Lauf mit.
  # Die Datei genügt: Gelesen wird sie ohnehin erst beim Start auf dem Pi.
  if [[ -d /run/systemd/system ]]; then
    hostnamectl set-hostname votura-saal
  else
    echo 'votura-saal' > /etc/hostname
  fi
  sed -i "s/127.0.1.1.*/127.0.1.1\tvotura-saal/" /etc/hosts
fi
systemctl enable avahi-daemon >/dev/null 2>&1 || true

# ----------------------------------------------------------------- Fertig

cat <<'ENDE'

  Fertig.

  Nach dem Neustart erscheint die Einrichtung: Hauptrechner suchen, Rolle
  wählen — Bühne oder Prompter —, übernehmen.

    sudo reboot

  Später:
    Strg + Umschalt + E          zurück in die Einrichtung
    ssh votura-saal.local        aus der Ferne ansehen
    journalctl -fu votura-saal   mitlesen, was der Dienst sagt

ENDE
