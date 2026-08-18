/**
 * Datenbankschema.
 *
 * Bewusste Eigenschaften:
 * - Es gibt KEINE Tabelle, die einen Wähler mit einem Stimmzettel verbindet (§4.3).
 * - Produktivdaten werden nie gelöscht, nur mit Status versehen (§57).
 * - Das Audit-Log ist append-only und per Hash-Chain verkettet (§60).
 */
export const SCHEMA_VERSION = 4

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
  }
]
