#!/usr/bin/env bash
#
# Baut ein fertiges Raspberry-Pi-Abbild, das in Votura Saal bootet.
#
# ## Warum nicht pi-gen
#
# pi-gen baut ein Raspberry Pi OS von Grund auf — Stunden, viele Gigabyte und
# eine eigene Werkzeugkette, nur um am Ende dieselben Pakete zu installieren,
# die auch `install.sh` installiert. Hier wird stattdessen das **fertige**
# Raspberry Pi OS Lite genommen und darin genau ein Skript ausgeführt: das,
# welches auch auf einem laufenden Pi läuft.
#
# Zwei getrennte Einrichtungen liefen bei der ersten Änderung auseinander —
# und gemerkt hätte man es im Saal.
#
# Aufruf:
#   sudo ./pi/abbild-bauen.sh --paket release-saal/Votura-Saal-1.2.0-linux-arm64.tar.gz
#
# Weitere Angaben:
#   --wartung <benutzer>  Legt ein Konto für die Fernwartung an (SSH, sudo).
#                         Das Passwort wird abgefragt — oder aus der Umgebung
#                         VOTURA_WARTUNG_PASSWORT genommen, damit auch ein
#                         unbeaufsichtigter Lauf durchgeht.
#   --behalten            Das Arbeitsverzeichnis nach dem Lauf stehen lassen.
set -euo pipefail

BASIS_URL='https://downloads.raspberrypi.com/raspios_lite_arm64_latest'
AUSGABE='release-pi'
ZUSATZ_MB=2500

paket=''
behalten=0
wartung=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    --paket) paket="$2"; shift 2 ;;
    --wartung) wartung="$2"; shift 2 ;;
    --behalten) behalten=1; shift ;;
    # Den Kopf ausgeben, so weit er reicht — feste Zeilennummern stimmten nach
    # der ersten Ergänzung nicht mehr.
    -h|--help) awk 'NR>1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0"; exit 0 ;;
    *) echo "Unbekannte Angabe: $1" >&2; exit 2 ;;
  esac
done

melde() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
fehler() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fehler 'Bitte mit sudo ausführen.'
[[ -n "$paket" && -f "$paket" ]] || fehler 'Bitte mit --paket das Linux-Paket (arm64) angeben.'

for werkzeug in qemu-aarch64-static xz parted kpartx losetup curl; do
  command -v "$werkzeug" >/dev/null || fehler "Es fehlt: $werkzeug — siehe pi/bauen.md"
done

# ---------------------------------------------------------- Wartungskonto
#
# Ohne Konto kommt niemand an den Pi heran: `pi` und der Dienstbenutzer
# `votura` haben beide `nologin`, root ist gesperrt. Raspberry Pi OS legt beim
# ersten Start eines an, wenn es auf der Bootpartition eine `userconf.txt`
# findet — sonst fragt es auf tty8 danach, wo im Saal niemand antwortet.

passwort=''
if [[ -n "$wartung" ]]; then
  [[ "$wartung" =~ ^[a-z][a-z0-9-]{0,31}$ ]] || fehler \
'Der Name darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten,
muss mit einem Buchstaben beginnen und höchstens 32 Zeichen lang sein.'
  # `votura` gehört dem Dienstbenutzer. Der Erststart benennt `pi` auf den
  # gewünschten Namen um und scheiterte an einem, den es schon gibt.
  [[ "$wartung" != 'votura' ]] || fehler 'Der Name votura ist vergeben — er gehört dem Dienstbenutzer.'
  command -v openssl >/dev/null || fehler 'Es fehlt: openssl — siehe pi/bauen.md'

  if [[ -n "${VOTURA_WARTUNG_PASSWORT:-}" ]]; then
    passwort="$VOTURA_WARTUNG_PASSWORT"
  else
    # Jetzt fragen und nicht in zwanzig Minuten: Danach läuft der Bau allein.
    read -rsp "Passwort für $wartung: " passwort; echo
    read -rsp 'Noch einmal: ' bestaetigung; echo
    [[ "$passwort" == "$bestaetigung" ]] || fehler 'Die beiden Eingaben stimmen nicht überein.'
  fi
  [[ -n "$passwort" ]] || fehler 'Das Passwort darf nicht leer sein.'
fi

hier="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
paket="$(readlink -f "$paket")"
version="$(grep -oP '"version":\s*"\K[^"]+' "$hier/package.json" | head -1)"
mkdir -p "$hier/$AUSGABE"
arbeit="$(mktemp -d)"

# Aushängen und Wegwerfen sind getrennt: Das fertige Abbild liegt im
# Arbeitsverzeichnis und muss ausgehängt, aber noch nicht gelöscht sein, wenn
# es gepackt wird. Beides in einem Schritt hat das Ergebnis mitgenommen.
aufraeumen() {
  set +e
  if mountpoint -q "$arbeit/wurzel/boot/firmware" 2>/dev/null; then umount "$arbeit/wurzel/boot/firmware"; fi
  for eingehaengt in proc sys dev/pts dev; do
    if mountpoint -q "$arbeit/wurzel/$eingehaengt" 2>/dev/null; then umount -l "$arbeit/wurzel/$eingehaengt"; fi
  done
  if mountpoint -q "$arbeit/wurzel" 2>/dev/null; then umount "$arbeit/wurzel"; fi
  if [[ -n "${schleife:-}" ]]; then kpartx -d "$schleife" >/dev/null 2>&1; losetup -d "$schleife" >/dev/null 2>&1; fi
  set -e
}
verwerfen() { [[ $behalten -eq 1 ]] || rm -rf "$arbeit"; }
trap 'aufraeumen; verwerfen' EXIT

# ------------------------------------------------------- Grundabbild holen

melde 'Raspberry Pi OS Lite (64 Bit) holen'

zwischenlager="$hier/$AUSGABE/.zwischenlager"
mkdir -p "$zwischenlager"
grundabbild="$zwischenlager/raspios-lite-arm64.img.xz"

if [[ ! -f "$grundabbild" ]]; then
  curl -fL --progress-bar -o "$grundabbild" "$BASIS_URL"
else
  echo 'Bereits geladen — wird weiterverwendet.'
fi

melde 'Abbild auspacken und vergrößern'
abbild="$arbeit/votura-saal.img"
xz -dc "$grundabbild" > "$abbild"

# Electron braucht Platz, den ein Lite-Abbild nicht vorsieht.
truncate -s "+${ZUSATZ_MB}M" "$abbild"
parted -s "$abbild" resizepart 2 100%

# ------------------------------------------------------------- Einhängen

melde 'Abbild einhängen'
schleife="$(losetup --find --show "$abbild")"
kpartx -as "$schleife" >/dev/null
sleep 1
name="$(basename "$schleife")"
boot="/dev/mapper/${name}p1"
wurzel="/dev/mapper/${name}p2"

e2fsck -pf "$wurzel" >/dev/null || true
resize2fs "$wurzel" >/dev/null

mkdir -p "$arbeit/wurzel"
mount "$wurzel" "$arbeit/wurzel"
mount "$boot" "$arbeit/wurzel/boot/firmware"

# ------------------------------------------------------ Fremdarchitektur

melde 'Einrichtung im Abbild ausführen'

cp /usr/bin/qemu-aarch64-static "$arbeit/wurzel/usr/bin/"
mount --bind /dev "$arbeit/wurzel/dev"
mount --bind /dev/pts "$arbeit/wurzel/dev/pts"
mount -t proc proc "$arbeit/wurzel/proc"
mount -t sysfs sys "$arbeit/wurzel/sys"

# Namensauflösung im Abbild — sonst kommt `apt` nicht ins Netz.
cp "$arbeit/wurzel/etc/resolv.conf" "$arbeit/wurzel/etc/resolv.conf.votura-sicherung" 2>/dev/null || true
echo 'nameserver 1.1.1.1' > "$arbeit/wurzel/etc/resolv.conf"

mkdir -p "$arbeit/wurzel/tmp/votura"
cp "$hier/pi/install.sh" "$arbeit/wurzel/tmp/votura/"
cp "$paket" "$arbeit/wurzel/tmp/votura/paket.tar.gz"
chmod +x "$arbeit/wurzel/tmp/votura/install.sh"

chroot "$arbeit/wurzel" /usr/bin/qemu-aarch64-static /bin/bash -c '
  set -euo pipefail
  /tmp/votura/install.sh --paket /tmp/votura/paket.tar.gz
'

# --------------------------------------------------------------- Aufräumen

melde 'Aufräumen'

chroot "$arbeit/wurzel" /usr/bin/qemu-aarch64-static /bin/bash -c '
  apt-get clean
  rm -rf /var/lib/apt/lists/* /tmp/votura
  # Wirtsschlüssel entfernen: Jede Karte soll eigene bekommen, sonst haben
  # zwei Pis im selben Saal dieselbe Kennung.
  rm -f /etc/ssh/ssh_host_*
  : > /etc/machine-id
  find /var/log -type f -delete
'
mv "$arbeit/wurzel/etc/resolv.conf.votura-sicherung" "$arbeit/wurzel/etc/resolv.conf" 2>/dev/null || true
rm -f "$arbeit/wurzel/usr/bin/qemu-aarch64-static"

# Der erste Start soll die Erstschritte überspringen: Es gibt keinen Desktop,
# und die Fragen nach Sprache und Benutzer beantwortet niemand im Saal.
touch "$arbeit/wurzel/boot/firmware/ssh"
rm -f "$arbeit/wurzel/etc/xdg/autostart/piwiz.desktop" 2>/dev/null || true

if [[ -n "$wartung" ]]; then
  # Der Erststart benennt `pi` auf diesen Namen um, gibt ihm eine Anmeldeshell
  # und übernimmt dessen Gruppen — darunter `sudo`. Erwartet wird der Hash,
  # nicht das Passwort (`chpasswd -e`). Danach löscht er die Datei selbst.
  # Bis dahin liegt der Hash offen auf einer FAT-Partition; Rechte kennt die
  # keine. Deshalb gehört dorthin ein eigenes Passwort und kein geteiltes.
  printf '%s:%s\n' "$wartung" "$(openssl passwd -6 -stdin <<<"$passwort")" \
    > "$arbeit/wurzel/boot/firmware/userconf.txt"
else
  # Ohne Konto hat der Erststart-Dialog niemanden, der ihm antwortet. Er läuft
  # auf tty8 gegen eine leere Eingabe und startet sich per `Restart=on-failure`
  # immer wieder neu. Dann lieber ganz aus.
  rm -f "$arbeit/wurzel/etc/systemd/system/multi-user.target.wants/userconfig.service"
fi

sync
aufraeumen
trap - EXIT

# ------------------------------------------------------------------ Packen

melde 'Packen'
ziel="$hier/$AUSGABE/votura-saal-$version-arm64.img"
mv "$abbild" "$ziel" 2>/dev/null || cp "$abbild" "$ziel"
verwerfen
xz -T0 -9 -f "$ziel"
sha256sum "$ziel.xz" | awk '{print $1}' > "$ziel.xz.sha256"

groesse="$(du -h "$ziel.xz" | cut -f1)"
if [[ -n "$wartung" ]]; then
  zugang="  Wartung:   ssh $wartung@votura-saal.local (ab dem ersten Start)"
else
  zugang='  Wartung:   kein Konto — nur mit Tastatur am Gerät erreichbar'
fi
cat <<ENDE

  Fertig: $ziel.xz ($groesse)
  Prüfsumme: $(cat "$ziel.xz.sha256")
$zugang

  Auf eine Karte schreiben:
    Raspberry Pi Imager öffnen, „Eigenes Abbild verwenden", diese Datei wählen.

  Der erste Start auf echter Hardware bleibt Pflicht — ein Emulator hat
  keinen Beamerausgang.

ENDE
