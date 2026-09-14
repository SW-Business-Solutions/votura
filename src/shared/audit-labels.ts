/**
 * Klartext für die Einträge des Audit-Trails.
 *
 * Gespeichert wird weiterhin der technische Schlüssel (`round.completed`) —
 * er ist eindeutig, sortierbar und bleibt über Programmfassungen hinweg
 * stabil. Gelesen wird der Trail aber von Menschen: von der Wahlleitung im
 * Zweifelsfall, vom Protokoll beim Nachvollziehen, von der Versammlung bei
 * einer Anfechtung. Deshalb steht in der Anzeige und im Export der Klartext.
 *
 * Unbekannte Schlüssel — etwa aus einer neueren Fassung — werden nicht
 * verschluckt, sondern lesbar aufbereitet (siehe `auditActionLabel`).
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  /* -------------------------------------------------------------- Anmeldung */
  'auth.login': 'Angemeldet',
  'auth.login_failed': 'Anmeldung fehlgeschlagen',
  'auth.logout': 'Abgemeldet',
  'auth.pin_failed': 'PIN falsch eingegeben',
  'auth.session_timeout': 'Sitzung abgelaufen',

  /* ---------------------------------------------------------------- Konten */
  'user.created': 'Benutzer angelegt',
  'user.updated': 'Benutzer geändert',
  'user.pin_set': 'Wahlleiter-PIN gesetzt',

  /* --------------------------------------------------------- Veranstaltung */
  'event.created': 'Veranstaltung angelegt',
  'event.updated': 'Veranstaltung geändert',
  'event.activated': 'Veranstaltung aktiviert',
  'event.closed': 'Veranstaltung geschlossen',
  'event.archived': 'Veranstaltung archiviert',

  /* ------------------------------------------------------------ Wahlgänge */
  'round.created': 'Wahlgang angelegt',
  'round.updated': 'Wahlgang geändert',
  'round.started': 'Wahlgang eröffnet',
  'round.candidates_locked': 'Bewerberliste geschlossen',
  'round.completed': 'Wahlgang abgeschlossen',
  'round.cancelled': 'Wahlgang abgebrochen',
  'round.unlocked': 'Wahlgang zur Änderung entsperrt',
  'round.follow_up_created': 'Folgewahlgang angelegt',
  'round.agenda_reordered': 'Reihenfolge der Wahlgänge geändert',

  /* ------------------------------------------------------------- Bewerber */
  'candidate.added': 'Bewerber hinzugefügt',
  'candidate.updated': 'Bewerber geändert',
  'candidate.withdrawn': 'Bewerbung zurückgezogen',
  'candidate.reordered': 'Bewerber umsortiert',
  'candidate.order_mode_applied': 'Reihenfolge neu bestimmt',
  'candidate.numbers_assigned': 'Bewerbernummern vergeben',

  /* --------------------------------------------------------- Tagesordnung */
  'card.imported': 'Stimmkarten in den Bestand aufgenommen',
  'card.assigned': 'Stimmkarte ausgegeben',
  'card.returned': 'Stimmkarte zurückgenommen',
  'card.lost': 'Stimmkarte als verloren gemeldet',
  'card.retired': 'Stimmkarte ausgemustert',
  'card.released': 'Stimmkarte wieder freigegeben',
  'card.assignments_closed': 'Ausgegebene Stimmkarten verfallen',
  'ballot.issued': 'Stimmzettel ausgegeben',
  'ballot.replacement_issued': 'Ersatzstimmzettel ausgegeben',
  'ballot.issue_revoked': 'Ausgabe zurückgenommen',
  'participant.added': 'Teilnehmer aufgenommen',
  'participant.updated': 'Teilnehmer geändert',
  'participant.arrived': 'Teilnehmer eingetroffen',
  'participant.left': 'Teilnehmer hat den Saal verlassen',
  'participant.pass_issued': 'Voting Pass ausgegeben',
  'participant.pass_reissued': 'Voting Pass neu ausgegeben',
  'participant.blocked': 'Teilnehmer gesperrt',
  'participant.unblocked': 'Sperre aufgehoben',
  'participant.passes_expired': 'Voting Pässe verfallen',
  'participant.pass_printed': 'Voting Pass gedruckt',
  'round.presence_taken': 'Anwesenheit für den Wahlgang festgehalten',
  'agenda.item_added': 'Tagesordnungspunkt hinzugefügt',
  'agenda.item_updated': 'Tagesordnungspunkt geändert',
  'agenda.item_removed': 'Tagesordnungspunkt entfernt',
  'agenda.reordered': 'Tagesordnung umsortiert',

  'presentation.imported': 'Präsentation eingespeist',
  'presentation.renamed': 'Präsentation umbenannt',
  'presentation.deleted': 'Präsentation entfernt',

  /* ----------------------------------------------------------- Stimmzettel */
  'ballot.approved': 'Stimmzettel freigegeben',

  /* ----------------------------------------------------------------- Druck */
  'print.finished': 'Druck abgeschlossen',
  'print.failed': 'Druck fehlgeschlagen',
  'print.aborted': 'Druck abgebrochen',
  'print.batch_interrupted': 'Druckauftrag unterbrochen',
  'print.batch_acknowledged': 'Druckmenge bestätigt',
  'print.resume_not_needed': 'Fortsetzung nicht nötig',
  'print.protocol_slip': 'Protokollbon gedruckt',
  'print.result_slip': 'Ergebnisbon gedruckt',
  'video.imported': 'Video eingespeist',
  'video.renamed': 'Video umbenannt',
  'video.deleted': 'Video entfernt',
  'printer.status_checked': 'Druckerstatus geprüft',

  /* ------------------------------------------------------------- Ergebnis */
  'accounting.updated': 'Stimmzettelbilanz geändert',
  'result.entered': 'Ergebnis erfasst',
  'result.updated': 'Ergebnis geändert',
  'result.confirmed': 'Ergebnis bestätigt',
  'result.reopened': 'Ergebnis zur Überprüfung geöffnet',
  'result.emergency_reopened': 'Notfallkorrektur: Wahlgang geöffnet',
  'result.emergency_correction': 'Notfallkorrektur am Ergebnis',

  /* ------------------------------------------------------------- Anzeige */
  'projection.mode_set': 'Anzeige umgeschaltet',
  'projection.theme_changed': 'Erscheinungsbild der Anzeige geändert',
  'projection.stages_saved': 'Bühnen geändert',
  'speech.imported': 'Rede eingespeist',
  'speech.created': 'Rede angelegt',
  'speech.edited': 'Rede bearbeitet',
  'speech.renamed': 'Rede umbenannt',
  'speech.deleted': 'Rede entfernt',
  'speechmodel.installed': 'Sprachmodell hinterlegt',
  'speechmodel.removed': 'Sprachmodell entfernt',

  /* ------------------------------------------------------- Zweites Gerät */
  'remote.session_started': 'Fernzugriff angemeldet',
  'remote.session_ended': 'Fernzugriff beendet',
  'remote.session_expired': 'Fernzugriff abgelaufen',

  /* -------------------------------------------------------------- System */
  'system.first_admin_created': 'Erstes Verwaltungskonto angelegt',
  'system.config_saved': 'Einstellungen gespeichert',
  'system.printers_saved': 'Drucker gespeichert',
  'system.update_started': 'Neue Fassung eingespielt',
  'backup.created': 'Backup erstellt',
  'export.copied': 'Export kopiert'
}

/**
 * Klartext zu einem Schlüssel. Fehlt einer — etwa weil die Datenbank aus einer
 * neueren Fassung stammt —, wird der Schlüssel lesbar gemacht, statt ihn roh
 * oder gar nicht anzuzeigen.
 */
export function auditActionLabel(action: string): string {
  const bekannt = AUDIT_ACTION_LABELS[action]
  if (bekannt) return bekannt

  const [bereich, rest] = action.split('.')
  if (!rest) return action
  const worte = rest.replace(/_/g, ' ')
  return `${worte.charAt(0).toUpperCase()}${worte.slice(1)} (${bereich})`
}
