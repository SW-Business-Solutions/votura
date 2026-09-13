# Ein fertiges Abbild für den Raspberry Pi bauen

Das Ergebnis ist eine `.img.xz`, die sich mit dem Raspberry Pi Imager auf eine SD-Karte schreiben
lässt und beim ersten Start in die Einrichtung von Votura Saal bootet.

Gebaut wird mit **Linux und Root** — in Windows selbst geht es nicht: Das Abbild wird über
Loop-Geräte eingehängt, und die Fremdarchitektur braucht `binfmt_misc`. Beides gibt es dort nicht.
Ein WSL2-Ubuntu genügt aber, siehe unten.

## Was gebraucht wird

| | |
|---|---|
| System | Debian oder Ubuntu, 64 Bit, mit `sudo` |
| Platz | rund 12 GB frei |
| Dauer | 20 bis 40 Minuten, je nach Netz |

```bash
sudo apt-get update
sudo apt-get install -y \
  qemu-user-static binfmt-support xz-utils zip parted kpartx \
  dosfstools e2fsprogs curl ca-certificates openssl
```

## Im WSL

Loop-Geräte und device-mapper bringt WSL2 mit. Eine Stelle fehlt dort:

```bash
sudo /usr/lib/systemd/systemd-binfmt
```

Ohne das läuft zwar die emulierte Shell im Abbild an, aber jedes Programm, das sie startet, endet
mit `Exec format error`. Der Grund: qemu reicht `execve` an den Kernel weiter, und der braucht dafür
den registrierten Handler. Sonst richtet ihn `systemd-binfmt` beim Hochfahren ein — was in WSL
niemand tut. Die Registrierung hält, bis die Distribution beendet wird.

Node gehört ebenfalls in die Distribution: Das Linux-Paket muss dort gebaut werden, nicht nebenan
unter Windows.

## Bauen

```bash
# Im Projektverzeichnis, mit dem fertigen Linux-Paket in release-saal/
sudo ./pi/abbild-bauen.sh \
  --paket release-saal/Votura-Saal-1.2.0-linux-arm64.tar.gz \
  --wartung votura-admin
```

**Das Linux-Paket muss aus `npm run dist:linux` stammen** — nicht aus einem blanken
`electron-builder`-Aufruf. Unter Windows hergestellte Archive tragen kein Ausführungsrecht, weil NTFS
keines kennt; die Einrichtung bricht dann ab mit „Im Archiv fehlt die Programmdatei". Der Lauf hängt
darum `tools/linux-rechte.mjs` an, das die Rechte im fertigen Archiv nachträgt. Ob eines richtig
liegt, sagt ein Blick:

```bash
tar -tvzf release-saal/Votura-Saal-*-linux-arm64.tar.gz | grep '/votura-saal$'
# -rwxr-xr-x  … richtig      -rw-r--r--  … unbrauchbar
```

## Das Wartungskonto

`--wartung <benutzer>` fragt nach einem Passwort und legt das Konto auf der Bootpartition ab; beim
ersten Start richtet Raspberry Pi OS es ein, mit Anmeldeshell und `sudo`, und löscht die Datei
wieder. Ohne diese Angabe hat das Abbild **keinen einzigen Login**: `pi` und der Dienstbenutzer
`votura` haben beide `nologin`, root ist gesperrt. Der Pi läuft dann zwar, aber erreichbar ist er
nur mit einer Tastatur am Gerät.

Der Name `votura` scheidet aus — den trägt schon der Dienstbenutzer.

Für einen unbeaufsichtigten Lauf nimmt das Skript das Passwort aus `VOTURA_WARTUNG_PASSWORT`:

```bash
sudo VOTURA_WARTUNG_PASSWORT='…' ./pi/abbild-bauen.sh --paket … --wartung votura-admin
```

Jede Karte sollte ihr eigenes Passwort bekommen: Bis zum ersten Start liegt der Hash offen auf
einer FAT-Partition, die jeder Kartenleser lesen kann.

Das Skript

1. lädt **Raspberry Pi OS Lite (64 Bit)** herunter und prüft die Prüfsumme,
2. vergrößert das Abbild um den Platz, den Electron braucht,
3. hängt es ein und wechselt mit `qemu-aarch64-static` hinein,
4. führt darin `pi/install.sh --paket …` aus — dasselbe Skript, das auch von Hand läuft,
5. räumt auf (Paketzwischenspeicher, SSH-Schlüssel, Protokolle) und packt das Ergebnis.

Heraus kommt `release-pi/votura-saal-<version>-arm64.img.xz` samt `.sha256`.

**Ein Skript für beide Wege.** Das Abbild führt genau das aus, was auch auf einem laufenden Pi
ausgeführt wird. Zwei getrennte Einrichtungen liefen bei der ersten Änderung auseinander, und
gemerkt hätte man es im Saal.

## Auf die Karte schreiben

Ein Browser kann das nicht — er hat keinen Zugriff auf Blockgeräte. Es gibt zwei Wege:

**Von Hand:** Raspberry Pi Imager → *Eigenes Abbild verwenden* → die `.img.xz` auswählen.

**Über ein eigenes Verzeichnis** — dann erscheint Votura Saal in der Liste des Imagers wie ein
offizielles Abbild:

```bash
rpi-imager --repo https://www.getvotura.de/pi/os-list.json
```

> Diese Adresse gibt es noch nicht. Sie wird eingerichtet, sobald das erste Abbild veröffentlicht
> ist — vorher hätte sie nichts zu zeigen.

## Prüfen, bevor es in den Saal geht

Ohne echte Hardware lässt sich das Abbild nicht vollständig prüfen — ein Emulator hat keinen
Beamerausgang. Was sich prüfen lässt:

```bash
# Ist alles drin, wo es hingehört?
sudo ./pi/abbild-pruefen.sh release-pi/votura-saal-1.2.0-arm64.img.xz
```

Der erste Start auf einem echten Pi bleibt trotzdem Pflicht.
