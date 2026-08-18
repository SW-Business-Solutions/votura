# ADR-0001: Electron-Desktopanwendung statt Web-Stack

- **Status:** angenommen
- **Datum:** 2026-08-17
- **Kontext:** Der globale Blueprint sieht als Default einen Web-/SaaS-Stack (Next.js, NestJS,
  PostgreSQL, Redis, BullMQ, S3) vor. Die Technologie-Offenheit erlaubt Abweichungen per ADR.

## Entscheidung

Die Anwendung wird als lokale Electron-Desktopanwendung mit React-Oberfläche gebaut. Der
Web-/Service-Stack entfällt vollständig.

## Begründung

- **Offlinepflicht:** Während der Versammlung darf nichts von Netz, Server oder Browserumgebung
  abhängen. Eine Desktopanwendung mit lokalem Datenbestand ist der kürzeste zuverlässige Weg.
- **Druckerzugriff:** ESC/POS-Rohdaten müssen an USB- und Netzwerkdrucker übergeben werden. Aus dem
  Browser heraus ist das nicht verlässlich möglich, aus dem Electron-Main-Prozess unmittelbar.
- **Zwei Ausgabegeräte:** Operator- und Beamerfenster lassen sich als getrennte, unterschiedlich
  privilegierte Fenster mit Bildschirmauswahl umsetzen.
- **Deployment:** Ein Installer ist vor Ort betriebssicherer als eine Container- oder Serverlösung.

## Verworfene Alternativen

- **Lokale Webanwendung im Browser:** zusätzliche Laufzeit (Node-Dienst + Browser), unsicherer
  Druckweg, Browserabsturz und Tab-Verwechslung als Betriebsrisiko.
- **Tauri:** attraktiv wegen Größe, hätte aber eine Rust-Toolchain als Buildvoraussetzung
  eingeführt; Electron war für die geforderte Bandbreite (Druck, PDF, zwei Fenster) der direktere Weg.

## Abweichungen vom Blueprint (bewusst)

| Prinzip | Abweichung | Grund |
|---|---|---|
| SSR-First / Next.js | entfällt | keine Webanwendung |
| Polyglot-Persistenz, Redis, BullMQ | entfällt, nur SQLite | Einzelplatzbetrieb, keine Nebenläufigkeit über Prozessgrenzen |
| Stateless ×N | entfällt | bewusst zustandsbehaftete lokale Anwendung |
| Tenant-First | entfällt | eine Organisation je Installation; Veranstaltung ist die Klammer |
| i18n-First | reduziert | Oberfläche deutsch; alle **druckwirksamen** Texte (Ja/Nein/Enthaltung, Anweisungen, Hinweise) sind konfigurierbar, weil sie von der Wahlordnung abhängen |

Beibehalten wurden: Ports/Adapter für externe Abhängigkeiten (Druckertreiber, SQLite-Treiber),
lückenloses Audit, Versionierung, Security-by-Default, Testpyramide, Dokumentationspflicht.
