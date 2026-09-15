/**
 * Datenbankschema.
 *
 * Bewusste Eigenschaften:
 * - Es gibt KEINE Tabelle, die einen Wähler mit einem Stimmzettel verbindet (§4.3).
 * - Produktivdaten werden nie gelöscht, nur mit Status versehen (§57).
 * - Das Audit-Log ist append-only und per Hash-Chain verkettet (§60).
 */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  print_pin_hash TEXT,
  role          TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  organization        TEXT NOT NULL,
  org_code            TEXT NOT NULL,
  date                TEXT NOT NULL,
  location            TEXT NOT NULL,
  status              TEXT NOT NULL,
  eligible_voter_count INTEGER,
  rule_set_json       TEXT NOT NULL,
  row_version         INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  closed_at           TEXT,
  archived_at         TEXT
);

CREATE TABLE IF NOT EXISTS rounds (
  id                 TEXT PRIMARY KEY,
  event_id           TEXT NOT NULL REFERENCES events(id),
  sequential_number  INTEGER NOT NULL,
  round_code         TEXT NOT NULL,
  round_label        TEXT NOT NULL,
  title              TEXT NOT NULL,
  purpose            TEXT NOT NULL,
  procedure          TEXT NOT NULL,
  seats              INTEGER NOT NULL,
  max_votes          INTEGER,
  seat_start         INTEGER,
  seat_end           INTEGER,
  status             TEXT NOT NULL,
  parent_round_id    TEXT REFERENCES rounds(id),
  derived_as         TEXT,
  ballot_version     INTEGER NOT NULL DEFAULT 1,
  approved_version   INTEGER,
  template_json      TEXT NOT NULL,
  positions_json     TEXT NOT NULL DEFAULT '[]',
  order_mode         TEXT NOT NULL DEFAULT 'manual',
  order_seed         INTEGER,
  candidates_locked_at TEXT,
  row_version        INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  locked_at          TEXT,
  completed_at       TEXT,
  cancelled_at       TEXT,
  cancel_reason      TEXT,
  UNIQUE (event_id, round_code)
);

CREATE INDEX IF NOT EXISTS idx_rounds_event ON rounds(event_id, sequential_number);

CREATE TABLE IF NOT EXISTS candidates (
  id            TEXT PRIMARY KEY,
  round_id      TEXT NOT NULL REFERENCES rounds(id),
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  display_name  TEXT NOT NULL,
  ballot_number INTEGER,
  sort_order    INTEGER NOT NULL,
  withdrawn     INTEGER NOT NULL DEFAULT 0,
  position_id   TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candidates_round ON candidates(round_id, sort_order);

CREATE TABLE IF NOT EXISTS ballot_versions (
  id             TEXT PRIMARY KEY,
  round_id       TEXT NOT NULL REFERENCES rounds(id),
  version        INTEGER NOT NULL,
  ballot_hash    TEXT NOT NULL,
  document_json  TEXT NOT NULL,
  approved_by    TEXT REFERENCES users(id),
  approved_by_name TEXT,
  approved_at    TEXT,
  superseded_at  TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE (round_id, version)
);

CREATE TABLE IF NOT EXISTS print_batches (
  id               TEXT PRIMARY KEY,
  round_id         TEXT NOT NULL REFERENCES rounds(id),
  ballot_version   INTEGER NOT NULL,
  kind             TEXT NOT NULL,
  printer_id       TEXT NOT NULL,
  printer_name     TEXT NOT NULL,
  requested_copies INTEGER NOT NULL,
  submitted_copies INTEGER NOT NULL DEFAULT 0,
  failed_copies    INTEGER NOT NULL DEFAULT 0,
  confirmed_copies INTEGER,
  status           TEXT NOT NULL,
  reason           TEXT,
  idempotency_key  TEXT NOT NULL UNIQUE,
  operator_id      TEXT NOT NULL REFERENCES users(id),
  operator_name    TEXT NOT NULL,
  started_at       TEXT NOT NULL,
  completed_at     TEXT,
  error_message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_batches_round ON print_batches(round_id, started_at);

CREATE TABLE IF NOT EXISTS accounting (
  round_id            TEXT PRIMARY KEY REFERENCES rounds(id),
  issued              INTEGER NOT NULL DEFAULT 0,
  replacements_issued INTEGER NOT NULL DEFAULT 0,
  returned_spoiled    INTEGER NOT NULL DEFAULT 0,
  unused              INTEGER NOT NULL DEFAULT 0,
  ballots_in_box      INTEGER,
  updated_at          TEXT
);

CREATE TABLE IF NOT EXISTS results (
  id                 TEXT PRIMARY KEY,
  round_id           TEXT NOT NULL UNIQUE REFERENCES rounds(id),
  eligible_voters    INTEGER,
  ballots_cast       INTEGER NOT NULL,
  valid_ballots      INTEGER NOT NULL,
  invalid_ballots    INTEGER NOT NULL,
  abstentions        INTEGER,
  result_json        TEXT NOT NULL,
  entered_by         TEXT NOT NULL REFERENCES users(id),
  entered_by_name    TEXT NOT NULL,
  verified_by        TEXT REFERENCES users(id),
  verified_by_name   TEXT,
  note               TEXT,
  determination      TEXT,
  final_decision     TEXT,
  elected_ids_json   TEXT,
  lot_decision       TEXT,
  created_at         TEXT NOT NULL,
  confirmed_at       TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  id              TEXT NOT NULL UNIQUE,
  timestamp       TEXT NOT NULL,
  user_id         TEXT,
  user_name       TEXT,
  event_id        TEXT,
  round_id        TEXT,
  action          TEXT NOT NULL,
  previous_json   TEXT,
  new_json        TEXT,
  reason          TEXT,
  previous_hash   TEXT,
  entry_hash      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_round ON audit(round_id, seq);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit(event_id, seq);

CREATE TABLE IF NOT EXISTS projection_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projection_history (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  TEXT NOT NULL,
  mode       TEXT NOT NULL,
  label      TEXT NOT NULL,
  round_label TEXT
);
`
  },
  {
    // Tagesordnung: Wahlgänge können vorbereitet und frei umsortiert werden.
    // Die laufende Nummer und damit die Wahlgangkennung entsteht erst beim Start
    // des Wahlgangs — sonst würde sie beim Verschieben wandern.
    version: 2,
    sql: `
ALTER TABLE rounds ADD COLUMN agenda_order INTEGER NOT NULL DEFAULT 0;
UPDATE rounds SET agenda_order = sequential_number;
CREATE INDEX IF NOT EXISTS idx_rounds_agenda ON rounds(event_id, agenda_order);
`
  },
  {
    // Tagesordnung: vorab pflegbar, jederzeit korrigierbar. Ein Punkt ist
    // entweder ein reiner Tagesordnungspunkt oder mit einem Wahlgang verknüpft.
    version: 3,
    sql: `
CREATE TABLE IF NOT EXISTS agenda_items (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id),
  position   INTEGER NOT NULL,
  label      TEXT,
  title      TEXT NOT NULL,
  note       TEXT,
  kind       TEXT NOT NULL DEFAULT 'topic',
  round_id   TEXT REFERENCES rounds(id),
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agenda_event ON agenda_items(event_id, position);
`
  },
  {
    /*
     * Nicht jede Abstimmung wird ausgezählt: bei Handzeichen stellt die
     * Versammlungsleitung häufig nur ein offenkundiges Ergebnis fest
     * ("einstimmig", "deutliche Mehrheit"). Ob gezählt wurde, ist für das
     * Protokoll wesentlich und wird deshalb ausdrücklich festgehalten.
     */
    version: 4,
    sql: `
ALTER TABLE results ADD COLUMN counting_mode TEXT NOT NULL DEFAULT 'counted';
ALTER TABLE results ADD COLUMN declaration TEXT;
`
  },
  {
    /*
     * Wo die Zahlen nicht mehr trennen, entscheidet die Versammlung.
     *
     * Bei gleicher Ja- und Nein-Zahl steht offen, wer Delegierter und wer
     * Ersatz wird. Die Auflösung — Verzicht auf den höheren Platz, Stichwahl,
     * Losentscheid — ist eine Feststellung und gehört ins Ergebnis, nicht in
     * eine stille Sortierung nach dem Namen.
     */
    version: 5,
    sql: `
ALTER TABLE results ADD COLUMN rank_order_json TEXT;
`
  },
  {
    /*
     * Akkreditierung: wer da ist, und wie viele davon stimmberechtigt sind.
     *
     * Bisher war die Zahl der Stimmberechtigten **eine Zahl am Ereignis**,
     * einmal eingetippt. In einer Versammlung kommen und gehen aber Leute:
     * Beim vierten Wahlgang sitzen andere im Saal als beim ersten, und damit
     * ändert sich die nötige Mehrheit. Wer das von Hand nachhält, rechnet
     * irgendwann mit einer veralteten Zahl.
     *
     * `attendance_log` ist **fortschreibend**, nicht überschreibend: Kommen
     * und Gehen stehen je als eigene Zeile. Der aktuelle Zustand ist der
     * jeweils letzte Eintrag. Nur so lässt sich später sagen, wer zum
     * Zeitpunkt eines Wahlgangs im Saal war — ein Feld „anwesend ja/nein"
     * könnte das nicht.
     *
     * `round_presence` hält den Stand **je Wahlgang** fest, sobald er
     * eröffnet wird. Danach darf sich die Anwesenheit ändern, ohne das
     * laufende Verfahren zu verschieben.
     */
    version: 6,
    sql: `
CREATE TABLE IF NOT EXISTS participants (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id),
  number         TEXT,
  last_name      TEXT NOT NULL,
  first_name     TEXT NOT NULL,
  note           TEXT,
  weight         INTEGER NOT NULL DEFAULT 1,
  eligible       INTEGER NOT NULL DEFAULT 1,
  pass_hash      TEXT UNIQUE,
  pass_issued_at TEXT,
  blocked_at     TEXT,
  blocked_reason TEXT,
  row_version    INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id, last_name, first_name);

CREATE TABLE IF NOT EXISTS attendance_log (
  id             TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  kind           TEXT NOT NULL,
  at             TEXT NOT NULL,
  by_user        TEXT,
  note           TEXT
);

CREATE INDEX IF NOT EXISTS idx_attendance_teilnehmer ON attendance_log(participant_id, at);

CREATE TABLE IF NOT EXISTS round_presence (
  round_id   TEXT PRIMARY KEY REFERENCES rounds(id),
  present    INTEGER NOT NULL,
  eligible   INTEGER NOT NULL,
  weight_sum INTEGER NOT NULL,
  taken_at   TEXT NOT NULL
);
`
  },
  {
    /*
     * Stimmkarten: wiederverwendbar statt bedrucktes Papier.
     *
     * Ein Papierpass geht im Saal verloren — er bleibt auf einem Stuhl liegen,
     * und niemand bemerkt es. Eine Karte wird beim Betreten **zugewiesen** und
     * beim Verlassen **zurückgegeben**; sie wandert danach an die nächste
     * Person. Das ist der Handgriff, den eine Garderobe seit hundert Jahren
     * beherrscht.
     *
     * `cards` ist **Bestand** und gehört deshalb nicht zu einer Versammlung:
     * Dieselben Karten werden nächstes Jahr wieder benutzt.
     *
     * `serial` steht sichtbar auf der Karte und ist für Menschen — „Karte 42
     * ist weg". `code_hash` ist die Prüfsumme dessen, was im QR steht, und das
     * ist ein langes Zufallsgeheimnis: Stünde dort die Nummer, ließe sich eine
     * Karte nachdrucken.
     *
     * `card_assignments` ist fortschreibend wie der Anwesenheitsverlauf. Eine
     * Zuweisung ohne `returned_at` ist die laufende — und nur eine laufende
     * Zuweisung macht eine Karte gültig. Ein abfotografierter Code von
     * vorletzter Versammlung ist damit wertlos.
     */
    version: 7,
    sql: `
CREATE TABLE IF NOT EXISTS cards (
  id         TEXT PRIMARY KEY,
  serial     TEXT NOT NULL UNIQUE,
  code_hash  TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'available',
  note       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_assignments (
  id             TEXT PRIMARY KEY,
  card_id        TEXT NOT NULL REFERENCES cards(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  event_id       TEXT NOT NULL REFERENCES events(id),
  assigned_at    TEXT NOT NULL,
  returned_at    TEXT,
  by_user        TEXT
);

CREATE INDEX IF NOT EXISTS idx_karte_zuweisung ON card_assignments(card_id, assigned_at);
CREATE INDEX IF NOT EXISTS idx_karte_teilnehmer ON card_assignments(participant_id, assigned_at);
`
  },
  {
    /*
     * Bändchen neben Karten.
     *
     * Ein Einlassbändchen aus Papier wird um das Handgelenk geklebt und beim
     * Gehen abgerissen. Der Ablauf ist derselbe wie bei der Karte — scannen,
     * ausgeben, scannen, zurücknehmen —, nur kommt es nicht in den Bestand
     * zurück: Es ist verbraucht.
     *
     * Deshalb eine Sorte und keine zweite Tabelle. Alles andere ist gleich,
     * und zwei fast gleiche Tabellen liefen bei der ersten Änderung
     * auseinander.
     */
    version: 8,
    sql: `
ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'card';
`
  },
  {
    /*
     * Wer für welchen Wahlgang einen Stimmzettel bekommen hat.
     *
     * Das Papieräquivalent zur einmaligen Stimmberechtigung: Je Wahlgang
     * bekommt jeder genau einen Zettel. Bisher stand die ausgegebene Menge als
     * **eine getippte Zahl** in der Bilanz — wer doppelt austeilte, merkte es
     * beim Nachzählen oder gar nicht.
     *
     * Die Tabelle sagt **nicht**, wie jemand gestimmt hat. Sie sagt, dass er
     * einen leeren Zettel bekommen hat; danach ist der Zettel anonym wie jeder
     * andere. Genau diese Grenze trennt die Ausgabe von der Urne.
     */
    version: 9,
    sql: `
CREATE TABLE IF NOT EXISTS ballot_issues (
  id             TEXT PRIMARY KEY,
  round_id       TEXT NOT NULL REFERENCES rounds(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  issued_at      TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'initial',
  by_user        TEXT,
  UNIQUE (round_id, participant_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_ausgabe_wahlgang ON ballot_issues(round_id);
`
  },
  {
    /*
     * Digitale Stimmabgabe (ADR-0006).
     *
     * Drei Tabellen, und ihre Trennung ist der ganze Entwurf:
     *
     * `voting_sessions` — die Abstimmung selbst. Bei geheimer Wahl entsteht
     * hier je Wahlgang ein eigenes Schlüsselpaar; der private Teil wird beim
     * Schließen gelöscht, der öffentliche bleibt für die Nachprüfung stehen.
     *
     * `voting_rights` — wer eine Stimmberechtigung bekommen hat. **Nicht**,
     * welche. Bei geheimer Wahl steht hier nichts über das Token: Die
     * Berechtigungsseite hat es nie gesehen (Blindsignatur).
     *
     * `cast_ballots` — die Urne. Sie kennt Seriennummer und Stimme. Die Spalte
     * `participant_id` bleibt bei geheimer und bei einfacher offener Wahl
     * **leer**; gefüllt wird sie nur bei einer namentlichen Abstimmung, und
     * dort ist die Zuordnung der ausdrückliche Zweck.
     *
     * Zwischen `voting_rights` und `cast_ballots` gibt es keinen
     * Fremdschlüssel und keine gemeinsame Kennung. Das ist keine
     * Nachlässigkeit, sondern die Aussage.
     */
    version: 10,
    sql: `
CREATE TABLE IF NOT EXISTS voting_sessions (
  round_id    TEXT PRIMARY KEY REFERENCES rounds(id),
  secrecy     TEXT NOT NULL,
  devices     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'prepared',
  public_key  TEXT,
  private_key TEXT,
  opened_at   TEXT,
  closed_at   TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voting_rights (
  id             TEXT PRIMARY KEY,
  round_id       TEXT NOT NULL REFERENCES rounds(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  weight         INTEGER NOT NULL DEFAULT 1,
  issued_at      TEXT NOT NULL,
  UNIQUE (round_id, participant_id)
);

CREATE TABLE IF NOT EXISTS cast_ballots (
  id             TEXT PRIMARY KEY,
  round_id       TEXT NOT NULL REFERENCES rounds(id),
  serial         TEXT NOT NULL,
  choice_json    TEXT NOT NULL,
  weight         INTEGER NOT NULL DEFAULT 1,
  participant_id TEXT REFERENCES participants(id),
  ordnung        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (round_id, serial)
);

CREATE INDEX IF NOT EXISTS idx_urne_wahlgang ON cast_ballots(round_id, ordnung);
`
  },
  {
    /*
     * Vier-Augen-Prinzip: der Schlüssel liegt woanders.
     *
     * Bis hierher hält der Hauptrechner den privaten Schlüssel. Wer ihn
     * vollständig kontrolliert, kann zusätzliche Unterschriften erzeugen; die
     * Bilanz macht das sichtbar, verhindert es aber nicht — und die Zahl der
     * ausgegebenen Berechtigungen stammt vom selben Rechner.
     *
     * `signer = 'committee'` verschiebt das: Der Schlüssel entsteht auf dem
     * Gerät des Wahlausschusses und verlässt es nie. Der Hauptrechner sammelt
     * die verblendeten Werte in `signing_queue`, das andere Gerät holt sie ab,
     * unterschreibt und gibt zurück. Er kann dann nichts erzeugen, was der
     * Ausschuss nicht gesehen hat — und der zählt mit.
     *
     * Die Warteschlange enthält **nur verblendete Werte**. Auch wer sie
     * vollständig liest, erfährt daraus nichts: Das ist der ganze Sinn der
     * Verblendung.
     */
    version: 11,
    sql: `
ALTER TABLE voting_sessions ADD COLUMN signer TEXT NOT NULL DEFAULT 'hub';

CREATE TABLE IF NOT EXISTS signing_queue (
  id          TEXT PRIMARY KEY,
  round_id    TEXT NOT NULL REFERENCES rounds(id),
  blinded     TEXT NOT NULL,
  signature   TEXT,
  created_at  TEXT NOT NULL,
  answered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_signatur_offen ON signing_queue(round_id, answered_at);
`
  },
  {
    /**
     * Die Stimmberechtigung merkt sich, dass sie verbraucht ist.
     *
     * Zwei Lücken schließt diese eine Spalte.
     *
     * **Die erste: mehrfach abstimmen.** Bei offener und namentlicher
     * Abstimmung erzeugt das Gerät seine Seriennummer nicht selbst — es
     * bekommt sie. Nachprüfbar war sie bisher trotzdem nicht: Gespeichert
     * wurde sie nirgends, und die Urne wies nur dieselbe Nummer zweimal ab.
     * Wer eine zweite Nummer erfand, kam durch. Jetzt entscheidet die
     * Berechtigung, und die gibt es je Person und Wahlgang genau einmal.
     *
     * **Die zweite: eine abgerissene Verbindung.** Kommt die Antwort nicht
     * an, schickt das Gerät dieselbe Stimme noch einmal. Sie liegt dann schon
     * in der Urne — die Wiederholung darf deshalb weder eine zweite Stimme
     * erzeugen noch als Fehler erscheinen.
     *
     * **Warum hier kein Wort über die Stimme steht.** Die Spalte trägt einen
     * Zeitpunkt, sonst nichts. Ein Abdruck der Auswahl neben der Person wäre
     * bei einer Handvoll möglicher Kreuze dasselbe wie die Auswahl im
     * Klartext. Die Wiederholung wird deshalb an der Seriennummer in der Urne
     * erkannt, nicht hier.
     *
     * Bei geheimer Wahl bleibt die Spalte leer: Dort ist die Unterschrift der
     * Nachweis, und die Urne kennt die Berechtigung nicht.
     *
     * **`voided_reason` ist der Ausweg für den Fall, den kein Verfahren
     * verhindert.** Jemand lädt die Seite neu, bevor die Stimme abgeschickt
     * ist. Die Berechtigung ist vergeben, die Stimme liegt nicht in der Urne,
     * und weil eine digitale Berechtigung die Papierausgabe sperrt, könnte
     * diese Person gar nicht mehr abstimmen. Die Wahlleitung entwertet sie
     * deshalb mit Begründung; danach — und nur danach — gibt es einen Zettel.
     * Eine entwertete Berechtigung nimmt keine Stimme mehr an.
     */
    version: 12,
    sql: `
ALTER TABLE voting_rights ADD COLUMN used_at TEXT;
ALTER TABLE voting_rights ADD COLUMN voided_reason TEXT;
`
  },
  {
    /**
     * Quotenprüfung bei Listenwahlen.
     *
     * **`candidates.quota_group` ist ein freier Text, kein Geschlecht.**
     *
     * Die häufigste Quote ist die nach Geschlecht, aber es gibt auch Quoten
     * nach Gliederung, nach Alter, nach Zugehörigkeit zu einer
     * Arbeitsgemeinschaft. Eine feste Spalte „Geschlecht" hätte diese Fälle
     * ausgeschlossen — und nebenbei eine Angabe erzwungen, die nicht jede
     * Versammlung erheben will. Leer bleiben darf sie immer; dann wird nicht
     * geprüft, statt etwas Falsches zu behaupten.
     *
     * **`election_rounds.quota_json` hält die Regel** — Art, Merkmal,
     * Anspruchsgruppe, Mindestanteil. Sie gehört zum Wahlgang und nicht zur
     * Veranstaltung: Der Vorstand kann quotiert sein und die Kassenprüfung
     * nicht.
     */
    version: 13,
    sql: `
ALTER TABLE candidates ADD COLUMN quota_group TEXT;
ALTER TABLE rounds ADD COLUMN quota_json TEXT;
`
  },
  {
    /**
     * Das Antragsbuch.
     *
     * Bis hierher war „Antrag" eine **Abstimmungsart**: ein Wahlgang mit
     * einem Beschlusstext. Das genügt für eine einzelne Sachfrage und für
     * nichts darüber hinaus — Anträge haben Nummern, Antragsteller,
     * Änderungsanträge und eine Reihenfolge, in der über sie abgestimmt wird.
     *
     * **`sort_index` hält die Abstimmungsreihenfolge der Änderungsanträge.**
     * Sie wird gesetzt, nicht gerechnet: Welcher Änderungsantrag
     * „weitergehend" ist, ist eine Wertung der Versammlungsleitung. Ein
     * Programm, das hier selbst sortierte, träfe unsichtbar eine anfechtbare
     * Entscheidung.
     *
     * **`round_id` ist die Brücke zur Abstimmung** und bleibt leer, solange
     * noch keine stattgefunden hat. Ein Antrag kann zurückgezogen oder
     * übernommen werden, ohne dass je ein Wahlgang entstand.
     */
    version: 14,
    sql: `
CREATE TABLE IF NOT EXISTS motions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  number TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  proposer TEXT NOT NULL,
  reasoning TEXT,
  status TEXT NOT NULL,
  reference_id TEXT REFERENCES motions(id) ON DELETE CASCADE,
  sort_index INTEGER NOT NULL DEFAULT 0,
  round_id TEXT REFERENCES rounds(id) ON DELETE SET NULL,
  remark TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_motions_event ON motions(event_id, kind, sort_index);
CREATE INDEX IF NOT EXISTS idx_motions_reference ON motions(reference_id, sort_index);
`
  },
  {
    /**
     * Die geltende Fassung — für die Synopse.
     *
     * Bei Anträgen, die einen bestehenden Text ändern (Satzung,
     * Beitragsordnung, Geschäftsordnung), gehört der bisherige Wortlaut
     * daneben. Eine Satzungsänderung ohne ihn ist für die Versammlung nur die
     * halbe Auskunft: Man liest, was künftig gelten soll, und weiß nicht,
     * was sich ändert.
     *
     * Freiwillig und leer erlaubt. Fehlt sie, gibt es keine Synopse — eine
     * Gegenüberstellung mit einer leeren Spalte wäre schlechter als keine.
     */
    version: 15,
    sql: `
ALTER TABLE motions ADD COLUMN previous_body TEXT;
`
  }
]

/**
 * Höchste Schemaversion, die diese Programmfassung versteht.
 *
 * Abgeleitet und **nicht** von Hand gepflegt: Als feste Zahl lief sie
 * auseinander, sobald jemand eine Migration ergänzte und die Zahl vergaß. Die
 * Folge war heimtückisch — der erste Start wanderte auf die neue Version, und
 * erst der zweite verweigerte den Dienst, weil die Prüfung den beim Start
 * gelesenen Stand verwendet. Da standen die Daten schon in der neuen Fassung.
 */
export const SCHEMA_VERSION = MIGRATIONS.reduce(
  (hoechste, migration) => Math.max(hoechste, migration.version),
  0
)
