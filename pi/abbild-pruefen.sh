#!/usr/bin/env bash
#
# Sieht in ein gebautes Abbild hinein, ohne es zu starten.
#
# Ein Emulator hat keinen Beamerausgang — vollständig prüfen lässt sich das
# Abbild nur auf echter Hardware. Was sich prüfen lässt, ist, ob überhaupt
# alles drin ist, wo es hingehört: Wer das vorher merkt, spart sich den Weg
# zur Karte und zurück.
set -euo pipefail

abbild="${1:-}"
[[ -n "$abbild" && -f "$abbild" ]] || { echo 'Aufruf: sudo ./pi/abbild-pruefen.sh <abbild.img.xz>' >&2; exit 2; }
[[ $EUID -eq 0 ]] || { echo 'Bitte mit sudo ausführen.' >&2; exit 1; }

arbeit="$(mktemp -d)"
schleife=''
aufraeumen() {
  set +e
  mountpoint -q "$arbeit/wurzel" && umount "$arbeit/wurzel"
  [[ -n "$schleife" ]] && { kpartx -d "$schleife" >/dev/null 2>&1; losetup -d "$schleife" >/dev/null 2>&1; }
  rm -rf "$arbeit"
  set -e
}
trap aufraeumen EXIT

if [[ "$abbild" == *.xz ]]; then
  echo 'Packe aus …'
  xz -dc "$abbild" > "$arbeit/abbild.img"
else
  cp "$abbild" "$arbeit/abbild.img"
fi

schleife="$(losetup --find --show "$arbeit/abbild.img")"
kpartx -as "$schleife" >/dev/null
sleep 1
mkdir -p "$arbeit/wurzel"
mount "/dev/mapper/$(basename "$schleife")p2" "$arbeit/wurzel"

fehler=0
pruefe() {
  if [[ -e "$arbeit/wurzel/$1" ]]; then
    printf '  \033[32m✓\033[0m %s\n' "$2"
  else
    printf '  \033[31m✗\033[0m %s (fehlt: %s)\n' "$2" "$1"
    fehler=1
  fi
}

echo
echo 'Im Abbild:'
pruefe 'opt/votura-saal/votura-saal' 'Programmdatei'
pruefe 'opt/votura-saal/kiosk.sh' 'Kioskstart'
pruefe 'opt/votura-saal/aktualisieren.sh' 'Aktualisierungsskript'
pruefe 'opt/votura-saal/resources/app.asar' 'Anwendungspaket'
pruefe 'etc/systemd/system/votura-saal.service' 'Dienst'
pruefe 'etc/systemd/system/multi-user.target.wants/votura-saal.service' 'Dienst ist eingeschaltet'
pruefe 'usr/bin/xinit' 'X-Server-Start'
pruefe 'var/lib/votura-saal' 'Datenordner'

echo
if grep -q 'Restart=always' "$arbeit/wurzel/etc/systemd/system/votura-saal.service" 2>/dev/null; then
  printf '  \033[32m✓\033[0m Neustart nach Absturz ist eingerichtet\n'
else
  printf '  \033[31m✗\033[0m Neustart nach Absturz fehlt\n'
  fehler=1
fi

if [[ -f "$arbeit/wurzel/etc/ssh/ssh_host_rsa_key" ]]; then
  printf '  \033[31m✗\033[0m Wirtsschlüssel sind noch drin — jede Karte hätte dieselben\n'
  fehler=1
else
  printf '  \033[32m✓\033[0m Keine Wirtsschlüssel im Abbild\n'
fi

echo
if [[ $fehler -eq 0 ]]; then
  echo 'Sieht vollständig aus. Der erste Start auf echter Hardware bleibt Pflicht.'
else
  echo 'Es fehlt etwas — bitte den Baulauf ansehen.' >&2
fi
exit $fehler
