# ADR-0007: Ein QR-Scanner im Gerät — und dafür die zweite Abhängigkeit

**Status:** angenommen · **Datum:** 2026-09-14

## Kontext

Die Oberfläche sagt an vier Stellen „scannen": am Einlass, an der Ausgabe, in der Wahlkabine und auf
dem Telefon des Wählers. Gemeint war bisher **ein Handscanner am USB-Anschluss**, der als Tastatur
arbeitet — er tippt den Code ins Feld und drückt Enter. Auf einem Tablet in der Wahlkabine und auf
dem Telefon eines Teilnehmers gibt es so ein Gerät nicht; dort wird abgetippt.

Mit der Zwei-Faktor-Regel (ADR-0006: Karte **und** Pass) wurde daraus ein Problem. Ein Kartencode hat
16 Zeichen, ein Pass ebenso. Zwei davon auf einem Telefon einzutippen, in einer Schlange, ist keine
Stimmabgabe, sondern eine Zumutung — und jeder Tippfehler erzeugt eine Fehlermeldung, die wie eine
Ablehnung aussieht.

Ein naheliegender Ausweg scheidet aus: Den QR des Passes als **Adresse** zu drucken
(`https://…/stimme?t=…&c=…`) hieße, das Zugriffstoken des Saalnetzes auf jeden der 500 Zettel zu
drucken. An genau diesem Token erkennt der Hauptrechner aber die Wahlkabine (ADR-0006). Gedruckt,
fotografiert, weitergereicht — und die Kabinenpflicht wäre aufgehoben. Der Pass bleibt deshalb ein
reiner Code.

## Entscheidung

**Die Seiten bekommen einen eigenen Scanner: Kamerabild, Erkennung im Gerät, kein Netz.**

Erkannt wird in zwei Stufen:

1. **`BarcodeDetector`**, wo der Browser ihn mitbringt. Das ist Chromium — also Votura Saal
   (Wahlkabine, Akkreditierungsgerät) und Android. Kostet nichts und ist schneller als alles, was
   man selbst mitbringt.
2. **`jsqr`** sonst. Damit funktioniert es auch auf iPhones, wo es `BarcodeDetector` bis heute nicht
   gibt — und das sind im Saal keine Ausnahme, sondern die Hälfte der Geräte.

`jsqr` ist damit die **zweite Laufzeitabhängigkeit** des Projekts. Bisher gab es genau eine
(`vosk-browser`), und das war eine bewusste Entscheidung: Jede Abhängigkeit ist Code, der bei einer
Wahl mitläuft und den niemand gelesen hat.

Was für diese hier spricht:

| | |
| --- | --- |
| Lizenz | Apache-2.0 |
| Eigene Abhängigkeiten | **keine** |
| Umfang | 251 KB unkomprimiert, ein Modul |
| Was es tut | rechnet ein Bild in Text um — kein Netz, kein Speicher, kein Zustand |

Der letzte Punkt ist der entscheidende: Ein QR-Decoder ist eine reine Funktion. Er kann nichts
senden, nichts speichern und nichts mitlesen. Von allen Abhängigkeiten, die man in eine Wahlsoftware
lässt, ist das die harmloseste Sorte.

**Geladen wird er erst beim Antippen** (`await import('jsqr')`). Wer nie scannt — der Hauptrechner,
der Beamer, der Prompter — bekommt ihn nie in den Speicher.

## Folgen

**Die Kamera verlangt eine sichere Herkunft.** `getUserMedia` verweigert den Dienst auf gewöhnlichem
HTTP. Für die Wahlkabine ist das keine Hürde: Votura Saal führt die eine eingestellte Adresse als
vertrauenswürdig (ADR-0005, `haerten()`). Für mitgebrachte Telefone heißt es: **ohne die
verschlüsselte Übertragung kein Scanner**. Da die Verschlüsselung für Abstimmungen ohnehin Pflicht
ist (ADR-0006), fällt das zusammen — aber die Oberfläche sagt es, statt eine tote Schaltfläche zu
zeigen.

**Das Tippfeld bleibt.** Es ist der Weg, der immer funktioniert: kein Licht, keine Kamera, keine
Erlaubnis, eine zerkratzte Karte. Der Scanner ist das Angebot, nicht die Bedingung.

**Der Handscanner bleibt ebenfalls.** An Einlass und Ausgabe ist er schneller als jede Kamera, und
die Felder dort arbeiten weiter wie bisher.

## Verworfene Alternativen

**Nur `BarcodeDetector`.** Kostet keine Abhängigkeit — und lässt jedes iPhone stehen. In einem Saal
mit 500 Menschen ist „geht auf der Hälfte der Geräte nicht" keine Lösung, sondern zwei Schlangen.

**ZXing (`@zxing/library`).** Kann mehr Formate und ist dafür um ein Vielfaches größer, mit
entsprechend mehr Code, den niemand liest. Gebraucht wird genau ein Format.

**Selbst schreiben.** Ein QR-Decoder ist Reed-Solomon-Fehlerkorrektur, perspektivische Entzerrung
und Binarisierung. Das ist kein Rad, das man neu erfindet, um eine Abhängigkeit zu sparen — hier
wäre die eigene Umsetzung das größere Risiko.

**Den Pass als Adresse drucken.** Siehe oben: Das Zugriffstoken auf 500 Zettel zu drucken hebt die
Kabinenpflicht auf.

## Verweise

- [ADR-0006](0006-digitale-stimmabgabe.md) — Zwei Faktoren, Kabinenpflicht, Zugriffstoken
- [ADR-0005](0005-fernzugriff-im-veranstaltungsnetz.md) — vertrauenswürdige Herkunft in Votura Saal
- [Bedrohungsmodell](../bedrohungsmodell-digitale-wahl.md) — was ein fotografierter Ausweis anrichtet
