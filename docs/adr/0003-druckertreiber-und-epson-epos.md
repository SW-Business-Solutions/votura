# ADR-0003: Vier Druckwege mit Epson ePOS als bevorzugter Anbindung

- **Status:** angenommen
- **Datum:** 2026-08-17

## Kontext

Zielhardware sind Epson-Thermodrucker (80 mm, 203 dpi, Auto-Cutter), zugleich soll die Anwendung
mit beliebigen ESC/POS-Geräten funktionieren. Entscheidend ist, wie ehrlich die Anwendung über den
Druckstatus berichten kann: Sie darf nie behaupten, ein Blatt sei physisch ausgegeben, wenn nur ein
Auftrag übermittelt wurde.

## Entscheidung

Ein gemeinsames Befehlsmodell (`PrintOp[]`) wird in drei Ausgaben übersetzt und über vier
austauschbare Treiber hinter einem Port (`PrinterDriver`) ausgegeben:

1. **Epson ePOS-Print** — Epsons eigene XML-Schnittstelle über HTTP (`/cgi-bin/epos/service.cgi`).
   Bevorzugt, weil die Antwort einen echten Gerätestatus liefert (Papierende, Abdeckung, offline).
2. **ESC/POS RAW** über TCP 9100, Statusabfrage per `DLE EOT`, sofern das Gerät antwortet.
3. **Windows-Spooler RAW** über `winspool.drv` (OpenPrinter/StartDocPrinter/WritePrinter,
   Datentyp `RAW`) für USB-Geräte mit installiertem Epson-Treiber. Umgesetzt über ein
   PowerShell-Skript mit P/Invoke, damit kein natives Zusatzmodul nötig ist.
4. **Dateiausgabe** — Textfassung plus ESC/POS-Rohdaten als Ersatzweg und für Layouttests.

Der ESC/POS-Encoder ist eigener Code (kein Fremdpaket): der benötigte Befehlssatz ist klein und
muss offline zuverlässig und nachvollziehbar bleiben.

## Konsequenzen

- Die Statusqualität unterscheidet sich je Treiber; die Oberfläche benennt das ausdrücklich
  („Der Drucker liefert keinen Statusrückkanal — Papier bitte visuell prüfen").
- Gezählt wird stets die **übermittelte** Menge; die physisch bestätigte Menge ist ein getrenntes,
  vom Menschen gesetztes Feld und hat in der Bilanz Vorrang.
- Deutsche Umlaute werden explizit in die Druckerzeichentabelle (CP858/CP437) übersetzt; nicht
  darstellbare Zeichen werden zu `?`, damit auf dem Bon nie unleserlicher Zeichensalat erscheint.
- Zeilenabstand für Ankreuzzeilen wird per `ESC 3` auf ca. 7 mm gesetzt, damit der Markierungs-
  bereich der Vorgabe entspricht, ohne die Schrift zu vergrößern.
