# ADR-0004: Wahlzweck und Wahlverfahren strikt getrennt

- **Status:** angenommen
- **Datum:** 2026-08-17

## Kontext

Die fachliche Spezifikation verlangt ausdrücklich, dass die Software aus einer Bezeichnung wie
„Delegiertenwahl" oder aus der Zahl der Positionen **nicht** ableitet, wie gewählt wird. Nach der
zugrunde gelegten Wahlordnung kann dieselbe Wahl als herkömmliche Einzel-/Gruppenwahl, im
Akzeptanzverfahren oder im Zwei-Stufen-Verfahren durchgeführt werden — das beschließt die
Versammlung.

## Entscheidung

Der Wahlgang trägt zwei unabhängige Felder:

- `purpose` — fachlicher Zweck (Vorsitz, Delegierte, Sachabstimmung …), rein beschreibend
- `procedure` — technisches Verfahren, das Stimmzettelaufbau, Eingabemaske und Auswertung bestimmt

Unterstützt sind 16 Verfahren; jedes besitzt ein Profil (`ProcedureProfile`) mit Angaben zu
Stimmzettelpflicht, Art der Einträge, Mehrfachsitzen, Voten je Kandidat, Blankozeilen,
Standard-Stimmenzahl und automatisch erzeugter Wahlanweisung.

Der Assistent fragt Zweck und Verfahren in getrennten Schritten ab und weist beim Verfahren
ausdrücklich darauf hin, dass der Beschluss der Versammlung maßgeblich ist.

## Konsequenzen

- Der Stimmzettel entsteht generisch aus Verfahren + Positionen + Kandidaten + Wahlgangdaten;
  es gibt keinen Sonderpfad „Delegiertenwahl".
- Nein/Enthaltung erscheinen bei Gruppenwahlen ausschließlich als globale Optionen am Ende, nie
  hinter einzelnen Kandidaten — beim Akzeptanzverfahren umgekehrt ausschließlich je Kandidat.
- Die Ergebniserfassung wählt ihre Maske aus dem Verfahren (`votes`, `yes_no_abstain`,
  `global_only`), ebenso die Plausibilitätsprüfung.
- Feststellungen (gewählt, nicht gewählt, Stichwahl, angenommen, abgelehnt, Stimmengleichheit)
  werden vorgeschlagen, aber niemals automatisch gesetzt; die Wahlleitung entscheidet und bestätigt.
