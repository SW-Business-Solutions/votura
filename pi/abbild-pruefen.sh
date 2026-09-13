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
  mountpoint -q "$arbeit/boot"   && umount "$arbeit/boot"
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
mkdir -p "$arbeit/wurzel" "$arbeit/boot"
mount "/dev/mapper/$(basename "$schleife")p2" "$arbeit/wurzel"
# Die Bootpartition trägt das, was den ersten Start bestimmt.
mount "/dev/mapper/$(basename "$schleife")p1" "$arbeit/boot"

fehler=0
pruefe() {
  # Auch `-L`: Ein eingeschalteter Dienst ist ein Symlink auf einen absoluten
  # Pfad im Abbild. Von außen betrachtet zeigt der ins Leere — `-e` folgt ihm
  # und meldete den Dienst als fehlend, obwohl er eingeschaltet war.
  if [[ -e "$arbeit/wurzel/$1" || -L "$arbeit/wurzel/$1" ]]; then
    printf '  \033[32m✓\033[0m %s\n' "$2"
  else
    printf '  \033[31m✗\033[0m %s (fehlt: %s)\n' "$2" "$1"
    fehler=1
  fi
}

echo
# Welche Rolle steckt drin? Das sagt das Abbild selbst, statt dass es
# jemand beim Aufruf angeben müsste — und wer sich vertippt, prüft sonst
# fröhlich das Falsche als bestanden.
if [[ -d "$arbeit/wurzel/opt/votura-saal" ]]; then
  PROGRAMM='votura-saal'; TITEL='Votura Saal'
elif [[ -d "$arbeit/wurzel/opt/votura" ]]; then
  PROGRAMM='votura'; TITEL='Votura (Hauptrechner)'
else
  printf '  \033[31m✗\033[0m In diesem Abbild steckt weder Votura noch Votura Saal.\n'
  exit 1
fi

echo "Im Abbild: $TITEL"
pruefe "opt/$PROGRAMM/$PROGRAMM" 'Programmdatei'
pruefe "opt/$PROGRAMM/start.sh" 'Startskript'
pruefe "opt/$PROGRAMM/aktualisieren.sh" 'Aktualisierungsskript'
pruefe "opt/$PROGRAMM/resources/app.asar" 'Anwendungspaket'
pruefe "etc/systemd/system/$PROGRAMM.service" 'Dienst'
pruefe "etc/systemd/system/multi-user.target.wants/$PROGRAMM.service" 'Dienst ist eingeschaltet'
pruefe 'usr/bin/xinit' 'X-Server-Start'
pruefe "var/lib/$PROGRAMM" 'Datenordner'

if [[ "$PROGRAMM" == 'votura' ]]; then
  # Der Hauptrechner wird bedient: Ohne Fensterverwaltung hätte ein
  # Dateidialog keinen Rahmen, und ohne Sicherungsskript läge die
  # Versammlung allein auf einer SD-Karte.
  pruefe 'usr/bin/openbox' 'Fensterverwaltung'
  pruefe "opt/$PROGRAMM/openbox/rc.xml" 'Tastenkombination für die Eingabezeile'
  pruefe 'usr/local/bin/votura-sichern' 'Sicherungsskript'
  pruefe 'usr/sbin/cupsd' 'Drucksystem'
else
  pruefe 'usr/bin/unclutter' 'Mauszeiger wird ausgeblendet'
fi

echo
# Raspberry Pi OS kommt britisch. Jede der drei Angaben ist für eine
# Versammlung in Deutschland falsch, und keine davon meldet sich: Die Uhr
# ginge eine Stunde daneben, und Uhrzeiten stehen im Protokoll.
zeitzone="$(cat "$arbeit/wurzel/etc/timezone" 2>/dev/null || echo '?')"
if [[ "$zeitzone" == Europe/* ]]; then
  printf '  \033[32m✓\033[0m Zeitzone: %s\n' "$zeitzone"
else
  printf '  \033[31m✗\033[0m Zeitzone steht auf %s\n' "$zeitzone"
  fehler=1
fi

belegung="$(sed -n 's/^XKBLAYOUT="\(.*\)"/\1/p' "$arbeit/wurzel/etc/default/keyboard" 2>/dev/null)"
if [[ -n "$belegung" && "$belegung" != 'gb' && "$belegung" != 'us' ]]; then
  printf '  \033[32m✓\033[0m Tastatur: %s\n' "$belegung"
else
  printf '  \033[31m✗\033[0m Tastatur steht auf %s — Umlaute fehlen, Y und Z sind vertauscht\n' "${belegung:-?}"
  fehler=1
fi

if grep -q '^LANG=de' "$arbeit/wurzel/etc/default/locale" 2>/dev/null; then
  printf '  \033[32m✓\033[0m Sprache: %s\n' "$(sed -n 's/^LANG=//p' "$arbeit/wurzel/etc/default/locale")"
else
  printf '  \033[31m✗\033[0m Sprache steht nicht auf Deutsch\n'
  fehler=1
fi

# Ohne Schriften zeigt Chromium Kästchen statt Buchstaben.
if [[ -n "$(find "$arbeit/wurzel/usr/share/fonts" -name '*.ttf' -print -quit 2>/dev/null)" ]]; then
  printf '  \033[32m✓\033[0m Schriften sind vorhanden\n'
else
  printf '  \033[31m✗\033[0m Keine Schriften — Chromium zeigte Kästchen\n'
  fehler=1
fi

echo
if grep -q 'Restart=always' "$arbeit/wurzel/etc/systemd/system/$PROGRAMM.service" 2>/dev/null; then
  printf '  \033[32m✓\033[0m Neustart nach Absturz ist eingerichtet\n'
else
  printf '  \033[31m✗\033[0m Neustart nach Absturz fehlt\n'
  fehler=1
fi

# Wer kommt später an das Gerät heran? Ein Abbild, in das sich niemand
# anmelden kann, fällt erst auf, wenn es hinter dem Beamer steht.
erststart="$arbeit/wurzel/etc/systemd/system/multi-user.target.wants/userconfig.service"
if [[ -f "$arbeit/boot/userconf.txt" ]]; then
  printf '  \033[32m✓\033[0m Wartungskonto: %s\n' "$(cut -d: -f1 "$arbeit/boot/userconf.txt")"
elif [[ -e "$erststart" || -L "$erststart" ]]; then
  printf '  \033[31m✗\033[0m Kein Wartungskonto, aber der Erststart-Dialog ist an — er fragt ins Leere\n'
  fehler=1
else
  printf '  \033[33m•\033[0m Kein Wartungskonto — Wartung nur mit Tastatur am Gerät\n'
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
