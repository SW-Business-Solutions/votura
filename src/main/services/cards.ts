/**
 * Stimmkarten: wiederverwendbar statt bedrucktes Papier.
 *
 * Ein Papierpass geht im Saal verloren — er bleibt auf einem Stuhl liegen, und
 * niemand bemerkt es, bis jemand abstimmen will. Eine Karte wird beim Betreten
 * **zugewiesen** und beim Verlassen **zurückgegeben**; danach wandert sie an
 * die nächste Person. Das ist der Handgriff, den eine Garderobe seit hundert
 * Jahren beherrscht, und er löst nebenbei die Anwesenheitsführung mit: Wer
 * eine Karte hat, ist im Saal.
 *
 * ## Die Karte ist ein Inhaberpapier
 *
 * Wer sie hat, gilt als die Person, der sie zugewiesen ist — wie eine
 * Garderobenmarke oder eine physische Stimmkarte. Das ist im Saal gängige
 * Praxis, aber es ist etwas anderes als ein Ausweis, und es gehört benannt
 * statt verschwiegen.
 *
 * Drei Dinge begrenzen den Schaden:
 *
 * 1. Im QR steht ein **langes Zufallsgeheimnis**, nicht die aufgedruckte
 *    Nummer. Sonst ließe sich eine Karte mit einem Drucker nachmachen.
 * 2. Eine Karte gilt **nur, solange sie zugewiesen ist**. Ein abfotografierter
 *    Code von vorletzter Versammlung ist wertlos — genau der Unterschied zum
 *    Papierpass, der bis zum Papierkorb weitergilt.
 * 3. Eine verlorene Karte wird **gesperrt** und bleibt es, auch wenn sie
 *    später wieder auftaucht.
 *
 * ## Was hier nie passiert
 *
 * Die Kartennummer berührt die Stimme nicht. Sie weist die Berechtigung nach;
 * was daraus wird, regelt ADR-0006 (Blindsignatur). In der Urne steht keine
 * Karte.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Card, CardAssignment, CardStock, Participant, UUID } from '@shared/types'
import { db } from '../db'
import { optionalString } from '../db/driver'
import { appendAudit } from './audit'
import { requirePermission } from './auth'
import { findByPass, getParticipant, setAttendance } from './participants'

interface CardRow {
  id: string
  serial: string
  code_hash: string
  status: string
  note: string | null
  created_at: string
  updated_at: string
  /* aus der laufenden Zuweisung angefügt */
  held_by?: string | null
  held_since?: string | null
}

/**
 * Die Abfrage hängt an jede Karte ihre laufende Zuweisung.
 *
 * `returned_at IS NULL` ist die Definition von „unterwegs": Eine Karte ist
 * genau dann vergeben, wenn es eine Zuweisung ohne Rückgabe gibt.
 */
const MIT_ZUWEISUNG = `
  SELECT c.*,
         (SELECT participant_id FROM card_assignments a
           WHERE a.card_id = c.id AND a.returned_at IS NULL
           ORDER BY a.assigned_at DESC LIMIT 1) AS held_by,
         (SELECT assigned_at FROM card_assignments a
           WHERE a.card_id = c.id AND a.returned_at IS NULL
           ORDER BY a.assigned_at DESC LIMIT 1) AS held_since
    FROM cards c
`

function mapCard(row: CardRow): Card {
  return {
    id: row.id,
    serial: row.serial,
    status: row.status === 'lost' ? 'lost' : row.status === 'retired' ? 'retired' : 'available',
    note: optionalString(row.note),
    heldBy: optionalString(row.held_by ?? null),
    heldSince: optionalString(row.held_since ?? null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function codeHash(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

export function listCards(): Card[] {
  return db().prepare(`${MIT_ZUWEISUNG} ORDER BY c.serial`).all<CardRow>().map(mapCard)
}

/**
 * Der Bestand auf einen Blick — die Zahl, die am Einlass zählt.
 *
 * „Noch 12 freie Karten" entscheidet darüber, ob jemand losläuft und welche
 * holt, bevor die Schlange steht.
 */
export function cardStock(): CardStock {
  const karten = listCards()
  return {
    total: karten.length,
    available: karten.filter((karte) => karte.status === 'available' && !karte.heldBy).length,
    assigned: karten.filter((karte) => karte.heldBy).length,
    lost: karten.filter((karte) => karte.status === 'lost').length,
    retired: karten.filter((karte) => karte.status === 'retired').length
  }
}

/**
 * Karten in den Bestand aufnehmen.
 *
 * Die Codes kommen vom Hersteller als Liste — sie stehen auf den Karten und
 * lassen sich nicht erzeugen. Gespeichert wird nur ihre Prüfsumme; die Liste
 * gehört danach vernichtet, denn sie ist ein Stapel gültiger Karten in
 * Textform.
 *
 * Bereits vorhandene Nummern werden übersprungen, nicht als Fehler gemeldet:
 * Wer eine Lieferung zweimal einliest, soll nicht abbrechen, sondern die neuen
 * dazubekommen.
 */
export function importCards(entries: { serial: string; code: string }[]): {
  added: number
  skipped: number
} {
  const session = requirePermission('participant.manage')
  let added = 0
  let skipped = 0
  const jetzt = new Date().toISOString()

  db().transaction(() => {
    for (const eintrag of entries) {
      const serial = eintrag.serial.trim()
      const code = eintrag.code.trim()
      if (!serial || code.length < 12) {
        skipped++
        continue
      }
      const vorhanden = db()
        .prepare(`SELECT id FROM cards WHERE serial = ? OR code_hash = ?`)
        .get<{ id: string }>(serial, codeHash(code))
      if (vorhanden) {
        skipped++
        continue
      }
      db()
        .prepare(
          `INSERT INTO cards (id, serial, code_hash, status, created_at, updated_at)
           VALUES (?, ?, ?, 'available', ?, ?)`
        )
        .run(randomUUID(), serial, codeHash(code), jetzt, jetzt)
      added++
    }
  })

  appendAudit({
    action: 'card.imported',
    userId: session.user.id,
    userName: session.user.displayName,
    newValue: { aufgenommen: added, uebersprungen: skipped }
  })
  return { added, skipped }
}

/**
 * Die Karte zu einem gescannten Code — unabhängig davon, ob sie gerade
 * vergeben ist.
 *
 * Der Vergleich läuft zeitkonstant über die Prüfsumme. Ein messbarer
 * Zeitunterschied zwischen „unbekannt" und „fast richtig" verriete, wie weit
 * jemand beim Raten ist.
 */
export function findCardByCode(code: string): Card | null {
  const gesucht = Buffer.from(codeHash(code), 'hex')
  let treffer: CardRow | null = null
  for (const zeile of db().prepare(MIT_ZUWEISUNG).all<CardRow>()) {
    const kandidat = Buffer.from(zeile.code_hash, 'hex')
    if (kandidat.length === gesucht.length && timingSafeEqual(kandidat, gesucht)) treffer = zeile
  }
  return treffer ? mapCard(treffer) : null
}

/**
 * Karte ausgeben: Der Teilnehmer bekommt sie und gilt damit als anwesend.
 *
 * Ein Handgriff statt zwei. Am Einlass wird gescannt, nicht geklickt.
 */
export function assignCard(participantId: UUID, code: string): { card: Card; participant: Participant } {
  const session = requirePermission('participant.manage')
  const person = getParticipant(participantId)
  if (!person) throw new Error('Unbekannter Teilnehmer.')

  const karte = findCardByCode(code)
  if (!karte) throw new Error('Diese Karte gehört nicht zum Bestand.')
  if (karte.status === 'lost') throw new Error(`Karte ${karte.serial} ist als verloren gemeldet.`)
  if (karte.status === 'retired') throw new Error(`Karte ${karte.serial} ist ausgemustert.`)
  if (karte.heldBy && karte.heldBy !== participantId) {
    const andere = getParticipant(karte.heldBy)
    throw new Error(
      `Karte ${karte.serial} ist bereits vergeben` +
        (andere ? ` an ${andere.firstName} ${andere.lastName}.` : '.')
    )
  }
  if (karte.heldBy === participantId) return { card: karte, participant: person }

  /* Wer schon eine Karte hat, gibt sie ab — sonst hielte eine Person zwei,
     und der Bestand stimmte nicht mehr. */
  const bisherige = cardHeldBy(participantId)
  if (bisherige) zurueckgeben(bisherige.id, session.user.username)

  db()
    .prepare(
      `INSERT INTO card_assignments (id, card_id, participant_id, event_id, assigned_at, by_user)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      karte.id,
      participantId,
      person.eventId,
      new Date().toISOString(),
      session.user.username
    )

  appendAudit({
    action: 'card.assigned',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: person.eventId,
    newValue: { karte: karte.serial, name: `${person.lastName}, ${person.firstName}` }
  })

  const anwesend = setAttendance(participantId, 'in')
  return { card: findCardByCode(code)!, participant: anwesend }
}

function zurueckgeben(cardId: UUID, byUser: string): void {
  db()
    .prepare(
      `UPDATE card_assignments SET returned_at = ?
        WHERE card_id = ? AND returned_at IS NULL`
    )
    .run(new Date().toISOString(), cardId)
  void byUser
}

/** Welche Karte hält dieser Teilnehmer gerade? */
export function cardHeldBy(participantId: UUID): Card | null {
  const row = db()
    .prepare(
      `${MIT_ZUWEISUNG} WHERE EXISTS (
         SELECT 1 FROM card_assignments a
          WHERE a.card_id = c.id AND a.participant_id = ? AND a.returned_at IS NULL)`
    )
    .get<CardRow>(participantId)
  return row ? mapCard(row) : null
}

/**
 * Karte zurücknehmen: Sie geht in den Bestand, die Person gilt als gegangen.
 *
 * Derselbe Scan wie beim Ausgeben — am Ausgang muss niemand entscheiden, was
 * er anklickt.
 */
export function returnCard(code: string): { card: Card; participant: Participant | null } {
  const session = requirePermission('participant.manage')
  const karte = findCardByCode(code)
  if (!karte) throw new Error('Diese Karte gehört nicht zum Bestand.')
  if (!karte.heldBy) return { card: karte, participant: null }

  const person = getParticipant(karte.heldBy)
  zurueckgeben(karte.id, session.user.username)

  appendAudit({
    action: 'card.returned',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: person?.eventId,
    newValue: {
      karte: karte.serial,
      name: person ? `${person.lastName}, ${person.firstName}` : undefined
    }
  })

  const gegangen = person ? setAttendance(person.id, 'out') : null
  return { card: findCardByCode(code)!, participant: gegangen }
}

/**
 * Karte sperren — verloren, beschädigt, ausgemustert.
 *
 * Eine laufende Zuweisung endet dabei. Wer die Karte findet, kann damit nichts
 * mehr anfangen; die Person bekommt eine neue.
 */
export function setCardStatus(cardId: UUID, status: Card['status'], note?: string): Card {
  const session = requirePermission('participant.manage')
  if (status !== 'available') zurueckgeben(cardId, session.user.username)

  db()
    .prepare(`UPDATE cards SET status = ?, note = ?, updated_at = ? WHERE id = ?`)
    .run(status, note?.trim() || null, new Date().toISOString(), cardId)

  const karte = db().prepare(`${MIT_ZUWEISUNG} WHERE c.id = ?`).get<CardRow>(cardId)
  if (!karte) throw new Error('Unbekannte Karte.')

  appendAudit({
    action: status === 'lost' ? 'card.lost' : status === 'retired' ? 'card.retired' : 'card.released',
    userId: session.user.id,
    userName: session.user.displayName,
    newValue: { karte: karte.serial, notiz: note?.trim() }
  })
  return mapCard(karte)
}

/**
 * Beim Abschluss der Versammlung verfallen alle ausgegebenen Karten.
 *
 * Ohne das bliebe eine Karte, die jemand mitgenommen hat, für immer
 * „vergeben" — und ihr aufgedruckter Code damit für immer ein gültiger
 * Ausweis. Genau das ist der Unterschied zwischen einer Karte und einem
 * Papierpass: Der Pass landet im Papierkorb, die Karte kommt wieder.
 *
 * Die Anwesenheit wird dabei **nicht** angefasst. Wer am Ende im Saal war, war
 * am Ende im Saal; das gehört ins Protokoll und nicht zurückdatiert.
 */
export function closeOpenAssignments(eventId: UUID): number {
  const offen = db()
    .prepare(`SELECT COUNT(*) AS anzahl FROM card_assignments WHERE event_id = ? AND returned_at IS NULL`)
    .get<{ anzahl: number }>(eventId)
  const anzahl = Number(offen?.anzahl ?? 0)
  if (anzahl === 0) return 0

  db()
    .prepare(`UPDATE card_assignments SET returned_at = ? WHERE event_id = ? AND returned_at IS NULL`)
    .run(new Date().toISOString(), eventId)

  appendAudit({
    action: 'card.assignments_closed',
    eventId,
    newValue: { entwertet: anzahl }
  })
  return anzahl
}

export function cardHistory(cardId: UUID): CardAssignment[] {
  return db()
    .prepare(`SELECT * FROM card_assignments WHERE card_id = ? ORDER BY assigned_at DESC`)
    .all<{
      id: string
      card_id: string
      participant_id: string
      event_id: string
      assigned_at: string
      returned_at: string | null
      by_user: string | null
    }>(cardId)
    .map((row) => ({
      id: row.id,
      cardId: row.card_id,
      participantId: row.participant_id,
      eventId: row.event_id,
      assignedAt: row.assigned_at,
      returnedAt: optionalString(row.returned_at),
      byUser: optionalString(row.by_user)
    }))
}

/**
 * Ein Scan am Einlass — was auch immer da gescannt wurde.
 *
 * Am Einlass hält jemand ein Gerät und zieht Codes darüber. Ob das eine Karte
 * oder ein gedruckter Papierpass ist, soll er nicht vorher entscheiden müssen.
 *
 * **Eine Karte gilt nur mit laufender Zuweisung.** Eine freie Karte weist
 * niemanden aus — sie liegt im Stapel und wartet.
 */
export function resolveScan(
  eventId: UUID,
  code: string
):
  | { kind: 'card'; card: Card; participant: Participant | null }
  | { kind: 'pass'; participant: Participant }
  | null {
  const karte = findCardByCode(code)
  if (karte) {
    const person = karte.heldBy ? getParticipant(karte.heldBy) : null
    return { kind: 'card', card: karte, participant: person }
  }
  const person = findByPass(eventId, code)
  return person ? { kind: 'pass', participant: person } : null
}
