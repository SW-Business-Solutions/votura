# Ein fertiges Abbild für den Raspberry Pi bauen

Das Ergebnis ist eine `.img.xz`, die sich mit dem Raspberry Pi Imager auf eine SD-Karte schreiben
lässt und beim ersten Start in die Einrichtung von Votura Saal bootet.

Gebaut wird auf einem **Linux-Rechner mit Root** — unter Windows geht es nicht: Das Abbild wird
über Loop-Geräte eingehängt, und die Fremdarchitektur braucht `binfmt_misc`. Beides gibt es dort
nicht.

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
  dosfstools e2fsprogs curl ca-certificates
```

## Bauen

```bash
# Im Projektverzeichnis, mit dem fertigen Linux-Paket in release-saal/
sudo ./pi/abbild-bauen.sh --paket release-saal/Votura-Saal-1.1.0-linux-arm64.tar.gz
```

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
sudo ./pi/abbild-pruefen.sh release-pi/votura-saal-1.1.0-arm64.img.xz
```

Der erste Start auf einem echten Pi bleibt trotzdem Pflicht.
