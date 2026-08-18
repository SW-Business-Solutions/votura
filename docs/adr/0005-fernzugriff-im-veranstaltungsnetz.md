# ADR-0005: Fernzugriff auf die Bedienung im Veranstaltungsnetz

- **Status:** angenommen
- **Datum:** 2026-08-17

## Kontext

Die Spezifikation sieht in Phase 3 einen LAN-Mehrplatzbetrieb vor (§70): ein zweiter Operator-PC,
eine Auszählstation, ein Lesezugriff für die Versammlungsleitung. Praktisch soll sich ein zweites
Gerät mit einem lokalen Konto am Hauptrechner anmelden können.

## Entscheidung

Der bereits vorhandene lokale HTTP-Server (bisher nur für die Beameransicht) bekommt einen zweiten,
getrennt schaltbaren Bereich:

| Pfad | Zweck | Schutz |
|---|---|---|
| `/` , `/api/projection/*` | Beameransicht | rein lesend, optionales Token |
| `/operator` , `/api/remote/*` | vollständige Bedienung | Anmeldung mit lokalem Konto |

**Sitzungskontext statt globaler Sitzung.** Die Dienste kannten bisher genau eine angemeldete
Person. Für den Mehrplatzbetrieb läuft jeder Fernaufruf in einem eigenen Kontext
(`AsyncLocalStorage`), der auch über `await` erhalten bleibt. `getSession()` liefert damit die
Sitzung des jeweiligen Aufrufers; der Operator am Hauptrechner arbeitet unverändert mit seiner
lokalen Sitzung. Rechteprüfung und Audit-Zuordnung sind dadurch für beide Wege identisch — es gibt
keinen zweiten, schwächeren Prüfpfad.

**Gleiche API, ein Ausführungspunkt.** Fern- und IPC-Aufrufe laufen durch dieselbe Funktion
(`callApi`). Eine Methode, die lokal geschützt ist, ist es aus der Ferne automatisch auch.

## Absicherung

- Standardmäßig **abgeschaltet**; getrennt vom Beamer-Zugang einschaltbar.
- Anmeldung mit Benutzername/Passwort (scrypt), Sitzungstoken mit 256 Bit Zufall.
- Sitzungsablauf nach dem konfigurierten Zeitlimit; Verlängerung nur bei Aktivität.
- Nach fünf Fehlversuchen je Gerät eine Minute Sperre; jeder Fehlversuch mit Herkunft im Audit.
- Systemdialoge des Hauptrechners (Ordnerwahl, Bilddatei, Explorer, Speichern unter) sind aus der
  Ferne gesperrt — sie beziehen sich auf das Gerät vor Ort.
- Anfragen sind auf 4 MB begrenzt; nur die definierten Endpunkte antworten.

## Bewusste Grenzen

- **Unverschlüsselt (HTTP).** Zulässig ausschließlich in einem abgeschotteten Veranstaltungsnetz;
  die Oberfläche weist beim Einschalten darauf hin. HTTPS mit eigenem Zertifikat wäre der nächste
  Schritt, wenn ein Betrieb in fremden Netzen gefordert wird.
- **Keine Push-Kanäle.** Das Zweitgerät fragt Projektions- und Sitzungszustand alle zwei Sekunden
  ab, statt Ereignisse zu empfangen. Der Druckfortschritt wird deshalb nur am Hauptrechner live
  angezeigt; das Ergebnis eines Druckauftrags kommt am Zweitgerät mit dem Abschluss des Aufrufs.
- **Optimistic Locking** schützt bereits vor gegenseitigem Überschreiben (`rowVersion`): Wer auf
  einem veralteten Stand speichert, bekommt die Aufforderung, neu zu laden.
- Die Ersteinrichtung (erstes Administratorkonto) bleibt dem Hauptrechner vorbehalten.
