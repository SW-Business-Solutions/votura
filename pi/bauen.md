# Ein fertiges Abbild für den Raspberry Pi bauen

Das Ergebnis ist eine `.img.xz`, die sich mit dem Raspberry Pi Imager auf eine SD-Karte schreiben
lässt und beim ersten Start in Votura bootet — je nach Rolle in die Einrichtung von Votura Saal
oder in den Hauptrechner.

Gebaut wird mit **Linux und Root** — in Windows selbst geht es nicht: Das Abbild wird über
Loop-Geräte eingehängt, und die Fremdarchitektur braucht `binfmt_misc`. Beides gibt es dort nicht.
Ein WSL2-Ubuntu genügt aber, siehe unten.

## Was gebraucht wird

|        |                                        |
| ------ | -------------------------------------- |
| System | Debian oder Ubuntu, 64 Bit, mit `sudo` |
| Platz  | rund 12 GB frei                        |
| Dauer  | 20 bis 40 Minuten, je nach Netz        |

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
# Bühne oder Pult — die Voreinstellung
sudo ./pi/abbild-bauen.sh \
  --paket release-saal/Votura-Saal-1.3.0-linux-arm64.tar.gz \
  --wartung votura-admin

# Der Hauptrechner
sudo ./pi/abbild-bauen.sh --rolle hauptrechner \
  --paket release/Votura-1.3.0-linux-arm64.tar.gz \
  --wartung votura-admin
```

**Die Rolle bestimmt alles Weitere:** den Namen des Abbilds, den Rechnernamen, ob es eine
Fensterverwaltung gibt und ob ein Sicherungsskript mitkommt. Ein Abbild, das `votura-saal` heißt,
aber den Hauptrechner enthält, wäre die Art Verwechslung, die erst im Saal auffällt — deshalb
folgt der Dateiname der Rolle und nicht der Laune beim Aufrufen.

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

**Ohne Terminal bricht der Lauf still ab.** Wird `--wartung` ohne
`VOTURA_WARTUNG_PASSWORT` verwendet und läuft das Skript ohne Eingabemöglichkeit — aus einem
Dienst, einer Pipeline oder einer abgesetzten Sitzung heraus —, scheitert die Passwortabfrage,
bevor die erste Zeile Ausgabe entsteht. Zurück bleibt ein leeres Protokoll und ein Fehlerkode: Es
sieht aus, als wäre gar nichts geschehen. Wer unbeaufsichtigt baut, setzt also entweder die
Umgebungsvariable oder lässt `--wartung` weg.

**Für ein Abbild, das veröffentlicht wird, gehört `--wartung` weggelassen.** Ein eingebautes
Passwort ist in jeder heruntergeladenen Kopie dasselbe — wer die Datei kennt, kommt auf jeden Pi,
der damit läuft. Die Abbilder der Veröffentlichungen werden deshalb ohne Wartungskonto gebaut; wer
Fernwartung braucht, baut sich sein eigenes Abbild oder legt das Konto nach dem ersten Start auf
dem Gerät an.

Das Skript

1. lädt **Raspberry Pi OS Lite (64 Bit)** herunter und prüft die Prüfsumme,
2. vergrößert das Abbild um den Platz, den Electron braucht,
3. hängt es ein und wechselt mit `qemu-aarch64-static` hinein,
4. führt darin `pi/install.sh --paket …` aus — dasselbe Skript, das auch von Hand läuft,
5. räumt auf (Paketzwischenspeicher, SSH-Schlüssel, Protokolle) und packt das Ergebnis.

Heraus kommt `release-pi/votura-saal-<version>-arm64.img.xz` bzw.
`release-pi/votura-<version>-arm64.img.xz`, je samt `.sha256`.

**Ein Skript für beide Wege.** Das Abbild führt genau das aus, was auch auf einem laufenden Pi
ausgeführt wird. Zwei getrennte Einrichtungen liefen bei der ersten Änderung auseinander, und
gemerkt hätte man es im Saal.

## Auf die Karte schreiben

Ein Browser kann das nicht — er hat keinen Zugriff auf Blockgeräte. Es gibt zwei Wege:

**Von Hand:** Raspberry Pi Imager → _Eigenes Abbild verwenden_ → die `.img.xz` auswählen.

**Über ein eigenes Verzeichnis** — dann erscheint Votura Saal in der Liste des Imagers wie ein
offizielles Abbild:

```bash
rpi-imager --repo https://www.getvotura.de/pi/os-list.json
```

Das Verzeichnis selbst entsteht aus dem fertigen Abbild und liegt bei der jeweiligen
Veröffentlichung, weil Prüfsumme und Größe darin stehen:

```bash
node tools/os-list.mjs release-pi/votura-saal-1.3.0-arm64.img.xz release-pi/votura-1.3.0-arm64.img.xz
```

Mehrere Abbilder ergeben mehrere Einträge in einer Datei; der Imager zeigt sie untereinander zur
Auswahl.

**Erst die Abbilder hochladen, dann das Verzeichnis.** In `os-list.json` stehen die Adressen der
Abbilder; liegt es vor ihnen in der Veröffentlichung, zeigt der Imager beide Einträge an und der
Download scheitert. Genau so ist es bei 1.3.0 passiert — die Datei ist klein und war in Sekunden
oben, die Abbilder brauchten eine Viertelstunde.

**`gh release upload` taugt für die Abbilder nicht.** Es antwortet mit `HTTP 404: Not Found` vom
Upload-Endpunkt — und gibt trotzdem **0** zurück. Ein Fehlschlag, der sich als Erfolg ausgibt: Bei
1.3.0 galt der Upload dreimal als „läuft noch", bis die Meldung auffiel. Der Weg, der trägt, ist
die Schnittstelle selbst:

```bash
ID=$(gh api repos/SW-Business-Solutions/votura/releases/tags/v1.3.0 -q .id)
curl -sS -X POST   -H "Authorization: Bearer $(gh auth token)"   -H "Content-Type: application/octet-stream"   --data-binary @release-pi/votura-1.3.0-arm64.img.xz   -w '
HTTP %{http_code}, %{size_upload} Bytes
'   "https://uploads.github.com/repos/SW-Business-Solutions/votura/releases/$ID/assets?name=votura-1.3.0-arm64.img.xz"
```

Erwartet wird **HTTP 201**. Rechnen Sie mit zwanzig Minuten je Abbild.

## Prüfen, bevor es in den Saal geht

Ohne echte Hardware lässt sich das Abbild nicht vollständig prüfen — ein Emulator hat keinen
Beamerausgang. Was sich prüfen lässt:

```bash
# Ist alles drin, wo es hingehört?
sudo ./pi/abbild-pruefen.sh release-pi/votura-saal-1.3.0-arm64.img.xz
sudo ./pi/abbild-pruefen.sh release-pi/votura-1.3.0-arm64.img.xz
```

Welche Rolle geprüft wird, liest das Skript aus dem Abbild — angeben muss man es nicht, und wer
sich vertippte, prüfte sonst fröhlich das Falsche als bestanden. Neben den Dateien sieht es nach,
was Raspberry Pi OS britisch mitbringt: Zeitzone, Tastaturbelegung, Sprache und Schriften. Genau
das stand im ersten gebauten Abbild noch falsch drin.

Der erste Start auf einem echten Pi bleibt trotzdem Pflicht.
