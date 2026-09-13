# Votura auf einem Raspberry Pi

Ein Pi kann in einer Versammlung zweierlei sein, und der Unterschied ist nicht kosmetisch: Die eine
Rolle wird **angesehen**, die andere **bedient**.

| Rolle          | Wofür                                                                                                                       | Wie viele                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `saal`         | Hinter dem Beamer oder unter dem Pult. Bootet, findet den Hauptrechner, zeigt seine Bühne. Kein Desktop, keine Maus.        | so viele wie Bildschirme |
| `hauptrechner` | Der Rechner, an dem die Versammlung geführt wird: Wahlgänge, Stimmzettel, Ergebnisse. Mit Fensterverwaltung und Mauszeiger. | genau einer              |

In beiden Fällen bootet der Pi ohne Anmeldung in die Anwendung. Stürzt sie ab, ist sie in drei
Sekunden wieder da; fällt der Strom aus, kommt der Pi von selbst zurück.

## Voraussetzungen

|        | `saal`                                                 | `hauptrechner`                             |
| ------ | ------------------------------------------------------ | ------------------------------------------ |
| Gerät  | Pi 4 (2 GB genügen) oder Pi 5                          | Pi 4 oder 5, **4 GB empfohlen**            |
| System | **Raspberry Pi OS Lite (64 Bit)**, Bookworm oder neuer | dito                                       |
| Netz   | im selben Netz wie der Hauptrechner                    | im selben Netz wie die Bühnen              |
| Sonst  | —                                                      | Karte mit Reserve; die Daten liegen darauf |

**64 Bit ist Pflicht.** Electron unterstützt kein armv7 mehr; ein 32-Bit-System scheidet damit aus.
Der Pi 3 fällt aus einem zweiten Grund heraus: Chromium auf 1 GB RAM ist für eine Wand, die
stundenlang laufen soll, zu knapp.

## Einrichten

Auf dem frisch aufgesetzten Pi, angemeldet als der übliche Benutzer:

```bash
# Bühne oder Pult (Voreinstellung)
curl -fsSL https://www.getvotura.de/pi/install.sh | sudo bash

# Der Hauptrechner
curl -fsSL https://www.getvotura.de/pi/install.sh | sudo bash -s -- --rolle hauptrechner
```

Oder aus dem Projekt heraus, wenn kein Netz zur Website besteht:

```bash
sudo ./pi/install.sh --paket /pfad/zu/Votura-Saal-1.3.0-linux-arm64.tar.gz
```

Das Skript

- installiert die nötigen Pakete — für den Saal einen X-Server **ohne** Fensterverwaltung, für den
  Hauptrechner einen **mit** (dazu Drucksystem und Wechseldatenträger),
- stellt Zeitzone, Tastatur und Sprache auf Deutsch (siehe unten),
- legt die Anwendung nach `/opt/votura` bzw. `/opt/votura-saal`,
- richtet den Benutzer `votura` ein, der nichts weiter darf,
- schaltet den Bildschirmschoner ab,
- startet die Anwendung als Dienst mit Neustart nach Absturz,
- meldet den Pi unter `votura.local` bzw. `votura-saal.local` im Netz an.

Danach: `sudo reboot`.

### Deutsch statt britisch

Raspberry Pi OS kommt mit Zeitzone `Europe/London`, Tastatur `gb` und Sprache `en_GB` — für eine
Versammlung in Deutschland ist jede der drei Angaben falsch, und keine meldet sich von selbst:

- Die **Uhr** ginge eine Stunde daneben, und Uhrzeiten stehen im Protokoll einer Wahl.
- Auf der **Tastatur** sitzen Y und Z vertauscht, Umlaute fehlen ganz — bei der Erfassung von
  Namen ist das keine Kleinigkeit.
- **Zahlen und Datumsangaben** des Systems kämen englisch heraus.

Das Skript setzt deshalb `Europe/Berlin`, `de` und `de_DE.UTF-8`. Für Österreich oder die Schweiz:

```bash
sudo ./pi/install.sh --zeitzone Europe/Vienna --tastatur at
sudo ./pi/install.sh --zeitzone Europe/Zurich --tastatur ch
```

## Im Betrieb

| Handgriff                 | `saal`                                                        | `hauptrechner`                              |
| ------------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| Zurück in die Einrichtung | **Strg + Umschalt + E**                                       | entfällt                                    |
| An das System heran       | —                                                             | **Strg + Alt + T** öffnet eine Eingabezeile |
| Aus der Ferne ansehen     | `ssh <benutzer>@votura-saal.local journalctl -fu votura-saal` | `… @votura.local journalctl -fu votura`     |
| Neu starten               | `sudo systemctl restart votura-saal`                          | `sudo systemctl restart votura`             |
| Aktualisieren             | `sudo /opt/votura-saal/aktualisieren.sh`                      | `sudo /opt/votura/aktualisieren.sh`         |
| Daten sichern             | entfällt — es liegen keine dort                               | `sudo votura-sichern /media/…`              |

`<benutzer>` ist das eigene Konto des Pi — bei einem fertigen Abbild das, was beim Bauen mit
`--wartung` angelegt wurde. Nicht `votura`: Der Dienstbenutzer hat bewusst keine Anmeldeshell.

### Die Daten liegen auf einer SD-Karte

Das gilt nur für den Hauptrechner, und es ist der ernsteste Punkt an dieser Betriebsart. Auf der
Karte liegt die Versammlung: Wahlgänge, Stimmzettel, Ergebnisse. SD-Karten sterben ohne Vorwarnung,
und sie tun es bevorzugt beim Schreiben.

**Vor jeder Versammlung eine Sicherung, danach noch eine:**

```bash
sudo votura-sichern /media/usb
```

Das Skript hält den Dienst dabei nicht an — SQLite im WAL-Verfahren verträgt eine Kopie im Betrieb,
und eine laufende Versammlung anzuhalten, um sie zu sichern, wäre verkehrt herum.

Wer ganz sichergehen will, nimmt für den Hauptrechner keinen Pi, sondern einen Rechner mit
richtiger Platte. Der Pi ist die Lösung für den Fall, dass ohnehin nichts anderes da ist — und
dafür ist er gut.

## Was das Skript bewusst **nicht** tut

- **Kein Desktop im Saal.** Ein Fenstermanager brächte Titelleisten, Kontextmenüs und einen
  Mauszeiger, den im Zweifel jemand über die Leinwand zieht. Dort läuft ein X-Server und darin
  genau ein Fenster. Der Hauptrechner bekommt eine Fensterverwaltung, weil ein Dateidialog ohne
  sie keinen Rahmen hätte und sich nicht verschieben ließe — aber auch dort keinen Desktop, keine
  Leiste, kein Startmenü.
- **Keine automatischen Systemaktualisierungen.** Ein Pi, der sich mitten in der Versammlung
  aktualisiert und neu startet, ist schlimmer als einer mit alten Paketen. Aktualisiert wird
  zwischen den Versammlungen, von Hand.
- **Kein schreibgeschütztes Dateisystem.** Es wäre robuster gegen Stromausfall, aber die Zuordnung
  zum Hauptrechner muss irgendwo hin — und beim Hauptrechner die Versammlung selbst. Wer es für
  eine Saal-Rolle dennoch will: `raspi-config` → Performance Options → Overlay File System, und
  vorher `/var/lib/votura-saal` auf eine eigene Partition legen.
- **Keine Sicherung im Hintergrund.** `votura-sichern` läuft, wenn jemand es aufruft. Eine
  Sicherung, die heimlich mitläuft, schreibt genau dann auf die Karte, wenn ohnehin viel los ist.
