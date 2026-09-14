# ADR-0008: Ein echtes Zertifikat — und die Netzdienste, die es dafür braucht

**Status:** angenommen · **Datum:** 2026-09-14

## Kontext

Für digitale Abstimmungen ist die verschlüsselte Übertragung Pflicht (ADR-0006): Ohne sie reist die
Stimme im Klartext durch ein WLAN, in dem bei gemeinsamem Passwort jeder Teilnehmer den Verkehr jedes
anderen entschlüsseln kann. Bisher stellt Votura das Zertifikat selbst aus.

**Damit warnt jedes mitgebrachte Telefon.** Und die Warnung ist nicht wegzudiskutieren: Ein
Zertifikat gilt, weil eine öffentliche Stelle für einen **Namen** bürgt. Für `192.168.1.5` bürgt
niemand und kann niemand bürgen — private Adressen gehören niemandem.

Der Schaden ist doppelt. Praktisch: Die Kamera für den QR-Scanner bleibt gesperrt, solange die Seite
nicht als sichere Herkunft gilt (ADR-0007). Und pädagogisch: Man bringt einer Versammlung bei,
Zertifikatswarnungen wegzuklicken — ausgerechnet bei einer Wahl.

## Entscheidung

**Votura holt sich ein echtes Zertifikat von Let's Encrypt, und zwar selbst.**

### Über das Domain-Namensystem, nicht über eine offene Tür

Die üblichen Verfahren verlangen, dass der Rechner aus dem Internet erreichbar ist. Ein Notebook im
Vereinsheim ist das nicht und soll es nie sein. Genommen wird deshalb `dns-01`: Die Prüfstelle fragt
nicht den Rechner, sondern das Namensystem. Votura rechnet den Wert aus, ein Mensch trägt ihn bei
seinem Anbieter ein, die Prüfstelle sieht ihn dort.

Der Rechner muss dafür **hinaus** telefonieren können, nicht erreichbar sein. Und er muss es nur
einmal: **Zertifikat vorher holen, im Saal offline arbeiten.** Am Versammlungstag liest Votura eine
Datei.

**Den DNS-Eintrag setzt kein Programm.** Eine Schnittstelle zu einem DNS-Dienstleister wäre ein
weiterer Zugang mit weiteren Zugangsdaten auf einem Rechner, der Wahlen durchführt. Der Wert wird
angezeigt; eintragen muss ihn ein Mensch.

### Ohne neue Abhängigkeit

ACME (RFC 8555) ist HTTPS mit JSON und unterschriebenen Nachrichten. Alles dafür ist da: `node:https`,
`node:crypto` zum Unterschreiben und die DER-Bausteine aus `tls.ts`, mit denen schon das selbst
ausgestellte Zertifikat gebaut wird. Der Zertifikatsantrag (PKCS#10) ist einfacher als das
Zertifikat, das dort bereits von Hand entsteht.

Eine ACME-Bibliothek wäre die dritte Laufzeitabhängigkeit gewesen — und anders als ein QR-Decoder
(ADR-0007) eine, die im entscheidenden Moment **Schlüssel in der Hand hält**.

Geprüft wird der Antrag nicht „auf plausibel", sondern auseinandergenommen: Die Unterschrift muss
über genau den Teil gelten, den die Prüfstelle prüfen wird.

### Der Namensdienst, ohne den alles nichts nützt

Ein Zertifikat auf `saal.mein-verband.de` hilft nur, wenn im Saal jemand diesen Namen auflösen kann.
Ein öffentlicher Eintrag hilft nur bei Internetzugang — den ein abgeschottetes Veranstaltungsnetz
gerade nicht hat. Ohne Antwort vor Ort bricht die ganze Kette.

Votura beantwortet deshalb auf Wunsch **genau einen Namen** mit seiner eigenen Adresse. Es löst
nichts rekursiv auf und speichert nichts zwischen; Anfragen von außerhalb der privaten
Adressbereiche werden abgewiesen. Ein Namensserver, der jede Frage beantwortet, ist ein offener
Resolver und taugt als Verstärker für Angriffe auf Dritte.

**Die Weiterleitung ist die unangenehme Hälfte.** Bekommen die Geräte Votura als Namensserver, ist
für sie alles andere tot — ein Abend im Funkloch, und manche Telefone verlassen ein WLAN von selbst,
in dem nichts geht. Wer das nicht will, stellt eine Weiterleitung auf den Router ein; dann geht der
gewöhnliche Namensverkehr der Gäste durch diesen Rechner. Aufgezeichnet wird nichts — kein
Protokoll, keine Datei, nichts in der Datenbank —, aber er sieht es. Das steht in der Oberfläche und
nicht im Kleingedruckten, und die Entscheidung trifft die Versammlungsleitung.

### Die Adressvergabe, und warum sie gefährlich ist

Woher ein Gerät seinen Namensserver erfährt, entscheidet DHCP. Wo ein Router der Location steht,
trägt man es dort ein. Wo Votura das Netz selbst aufspannt — der Raspberry Pi mit eigenem
Zugangspunkt —, gibt es niemanden sonst.

**Ein zweiter Adressverteiler in einem fremden Netz ist ein Störfall.** Er verteilt Adressen, die
dort nicht gelten, und legt im Zweifel das Netz der Location lahm, mitten in der Versammlung.
Dagegen stehen zwei Vorkehrungen:

1. **Aus, solange es niemand einschaltet.**
2. **Vorher hinhören.** Beim Start fragt Votura selbst nach einer Adresse. Antwortet jemand, läuft
   hier bereits ein Verteiler — dann startet dieser nicht und sagt, wen er gehört hat. Das ist die
   Prüfung, die ein Mensch im Saal nicht leisten kann.

Mitgegeben wird auch die **Adresse des Routers**. Ohne Wegweiser nach draußen sitzen die Gäste den
Abend im Funkloch; das ist keine Sicherheitsmaßnahme, sondern eine Unannehmlichkeit, die niemandem
nützt.

## Folgen

**Die Kette ist nur so stark wie ihr schwächstes Glied, und das ist ein Kalendereintrag.** Ein
Zertifikat von Let's Encrypt gilt 90 Tage. Wer einmal im Jahr tagt, hat am Versammlungstag ein
abgelaufenes. Die Oberfläche zeigt deshalb das Ablaufdatum und warnt in den letzten 14 Tagen — mehr
kann ein Programm ohne Internet nicht tun.

**Die Übungsumgebung ist Pflichtprogramm für den ersten Versuch.** Die echte Prüfstelle erlaubt nur
wenige Fehlversuche je Stunde. Wer den Ablauf zum ersten Mal geht, probt ihn dort, sonst steht er
womöglich am Versammlungstag vor einer Sperre.

**Ohne eigene Domain bleibt alles beim Alten**: selbst ausgestelltes Zertifikat, Warnung auf
mitgebrachten Geräten, Wahlkabinen für geheime Wahlen. Diese Entscheidung nimmt nichts weg, sie
fügt einen Weg hinzu.

## Verworfene Alternativen

**Das eigene Zertifikat auf jedem Gerät installieren.** Für die Geräte der Veranstaltung richtig und
üblich. Für 500 Gäste undurchführbar — auf iOS ist es ein Profil samt zusätzlichem Schalter in den
Vertrauenseinstellungen.

**Eine Schnittstelle zum DNS-Anbieter.** Bequemer, und dafür liegen die Zugangsdaten zur Domain auf
dem Rechner, der die Wahl durchführt. Der Wert wird angezeigt, eingetragen wird er von Hand.

**Nur eigene Zertifikatsdateien laden, ohne ACME.** Dann bräuchte es für jede Erneuerung einen
zweiten Rechner mit passenden Werkzeugen und jemanden, der sie bedienen kann. Der Weg bleibt
trotzdem offen und ist gebaut — er ist der Notausgang, nicht der Hauptweg.

**Votura als vollständiger Router mit eigener Internetleitung.** Eine dauerhafte Verbindung nach
draußen neben dem Wahlnetz ist genau die Eigenschaft, mit der dieses Programm nicht werben will —
und der erste Kritiker im Saal würde zuerst danach fragen. Das Zertifikat wird vorher geholt.

## Verweise

- [ADR-0006](0006-digitale-stimmabgabe.md) — warum Verschlüsselung für Abstimmungen Pflicht ist
- [ADR-0007](0007-qr-scanner-im-geraet.md) — warum die Kamera eine sichere Herkunft verlangt
- [ADR-0005](0005-fernzugriff-im-veranstaltungsnetz.md) — die vertrauenswürdige Herkunft in Votura Saal
- RFC 8555 (ACME), RFC 7638 (Schlüsselfingerabdruck), RFC 7515 (unterschriebene Nachrichten)
