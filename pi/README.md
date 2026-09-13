# Votura Saal auf einem Raspberry Pi

Ein Pi 4 oder Pi 5 hinter dem Beamer oder unter dem Pult: Er bootet, findet den Hauptrechner und
zeigt seine Bühne. Kein Desktop, keine Maus, kein Anmeldebildschirm. Stürzt die Anwendung ab, ist
sie in drei Sekunden wieder da; fällt der Strom aus, kommt der Pi von selbst zurück.

## Voraussetzungen

| | |
|---|---|
| Gerät | Raspberry Pi 4 (2 GB genügen) oder Pi 5 |
| System | **Raspberry Pi OS Lite (64 Bit)**, Bookworm oder neuer |
| Netz | LAN oder WLAN im selben Netz wie der Hauptrechner |

**64 Bit ist Pflicht.** Electron unterstützt kein armv7 mehr; ein 32-Bit-System scheidet damit aus.
Der Pi 3 fällt aus einem zweiten Grund heraus: Chromium auf 1 GB RAM ist für eine Wand, die
stundenlang laufen soll, zu knapp.

## Einrichten

Auf dem frisch aufgesetzten Pi, angemeldet als der übliche Benutzer:

```bash
curl -fsSL https://www.getvotura.de/pi/install.sh | sudo bash
```

Oder aus dem Projekt heraus, wenn kein Netz zur Website besteht:

```bash
sudo ./pi/install.sh --paket /pfad/zu/votura-saal-1.2.0-arm64.tar.gz
```

Das Skript

- installiert die nötigen Pakete (X-Server ohne Fensterverwaltung, mehr nicht),
- legt Votura Saal nach `/opt/votura-saal`,
- richtet den Benutzer `votura` ein, der nichts weiter darf,
- schaltet Bildschirmschoner und Energiesparen ab,
- startet die Anwendung als Dienst mit Neustart nach Absturz,
- meldet den Pi unter `votura-saal.local` im Netz an.

Danach: `sudo reboot`. Beim ersten Start erscheint die Einrichtung — Hauptrechner suchen, Rolle
wählen, fertig.

## Im Betrieb

| Handgriff | Wie |
|---|---|
| Zurück in die Einrichtung | **Strg + Umschalt + E** (Tastatur anstecken genügt) |
| Aus der Ferne ansehen | `ssh <benutzer>@votura-saal.local journalctl -fu votura-saal` |
| Neu starten | `sudo systemctl restart votura-saal` |
| Anhalten | `sudo systemctl stop votura-saal` |
| Aktualisieren | `sudo /opt/votura-saal/aktualisieren.sh` |

`<benutzer>` ist das eigene Konto des Pi — bei einem fertigen Abbild das, was beim Bauen mit
`--wartung` angelegt wurde. Nicht `votura`: Der Dienstbenutzer hat bewusst keine Anmeldeshell.

## Was das Skript bewusst **nicht** tut

- **Kein Desktop.** Ein Fenstermanager brächte Titelleisten, Kontextmenüs und einen Mauszeiger, den
  im Zweifel jemand über die Leinwand zieht. Es läuft ein X-Server und darin genau ein Fenster.
- **Keine automatischen Systemaktualisierungen.** Ein Pi, der sich mitten in der Versammlung
  aktualisiert und neu startet, ist schlimmer als einer mit alten Paketen. Aktualisiert wird
  zwischen den Versammlungen, von Hand.
- **Kein schreibgeschütztes Dateisystem.** Es wäre robuster gegen Stromausfall, aber die Zuordnung
  zum Hauptrechner muss irgendwo hin. Wer es dennoch will: `raspi-config` → Performance Options →
  Overlay File System, und vorher `/var/lib/votura-saal` auf eine eigene Partition legen.
