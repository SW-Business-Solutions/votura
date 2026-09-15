/**
 * Das Antragsbuch einer Versammlung.
 *
 * Die Regeln — Reihenfolge, Übernahme, Beschlusstext — stehen in
 * `@shared/antrag` und sind dort ohne Datenbank geprüft. Hier steht, was
 * gespeichert wird, wer es darf und was in den Prüfpfad geht.
 *
 * ## Warum so viel in den Prüfpfad geht
 *
 * Ein Antrag ist kein Datensatz, sondern ein Vorgang: Er wird gestellt,
 * geändert, übernommen, zurückgezogen, beschlossen. Wer später fragt, was die
 * Versammlung eigentlich beschlossen hat, fragt nach diesem Weg — und nicht
 * nach dem Endstand. Deshalb wird jeder Schritt festgehalten, nicht nur der
 * letzte.
 */
import { randomUUID } from 'node:crypto'
import {
  abstimmungsreihenfolge,
  beschlusstext,
  darfUebernehmen,
  nachNummer,
  type Abstimmungsschritt,
  type Antrag,
  type Antragsart,
  type Antragsstatus
} from '@shared/antrag'
import type { UUID } from '@shared/types'
import { db } from '../db'
import { optionalString } from '../db/driver'
import { logger } from '../logger'
import { appendAudit } from './audit'
import { requirePermission } from './auth'

interface MotionRow {
  id: string
  event_id: string
  kind: string
  number: string
  title: string
  body: string
  proposer: string
  reasoning: string | null
  status: string
  reference_id: string | null
  sort_index: number
  round_id: string | null
  remark: string | null
  created_at: string
}

function mapAntrag(row: MotionRow): Antrag {
  return {
    id: row.id,
    eventId: row.event_id,
    art: row.kind as Antragsart,
    nummer: row.number,
    titel: row.title,
    text: row.body,
    antragsteller: row.proposer,
    begruendung: optionalString(row.reasoning),
    status: row.status as Antragsstatus,
    bezugId: optionalString(row.reference_id),
    reihenfolge: Number(row.sort_index),
    roundId: optionalString(row.round_id),
    vermerk: optionalString(row.remark),
    createdAt: row.created_at
  }
}

export function listAntraege(eventId: UUID): Antrag[] {
  return db()
    .prepare(`SELECT * FROM motions WHERE event_id = ? ORDER BY sort_index, created_at`)
    .all<MotionRow>(eventId)
    .map(mapAntrag)
    .sort((a, b) => {
      /* Hauptanträge nach Nummer; Änderungsanträge bleiben bei ihrem
         Hauptantrag und dort in der gesetzten Reihenfolge. */
      if (a.art !== b.art) return a.art === 'haupt' ? -1 : 1
      return a.art === 'haupt' ? nachNummer(a, b) : a.reihenfolge - b.reihenfolge
    })
}

export function getAntrag(id: UUID): Antrag {
  const row = db().prepare(`SELECT * FROM motions WHERE id = ?`).get<MotionRow>(id)
  if (!row) throw new Error('Diesen Antrag gibt es nicht.')
  return mapAntrag(row)
}

export interface AntragEingabe {
  eventId: UUID
  art: Antragsart
  nummer: string
  titel: string
  text: string
  antragsteller: string
  begruendung?: string
  bezugId?: UUID
}

export function antragAnlegen(eingabe: AntragEingabe): Antrag {
  const session = requirePermission('round.manage')
  const nummer = eingabe.nummer.trim()
  if (!nummer) throw new Error('Ein Antrag braucht eine Nummer.')
  if (!eingabe.antragsteller.trim()) throw new Error('Ein Antrag braucht einen Antragsteller.')

  if (eingabe.art === 'aenderung') {
    if (!eingabe.bezugId) throw new Error('Ein Änderungsantrag braucht einen Hauptantrag.')
    const bezug = getAntrag(eingabe.bezugId)
    if (bezug.art !== 'haupt') {
      /*
       * Kein Änderungsantrag zum Änderungsantrag.
       *
       * Rechtlich gibt es das; praktisch wäre die Abstimmungsreihenfolge
       * dann ein Baum, und ein Baum lässt sich um zweiundzwanzig Uhr nicht
       * mehr erklären. Wer das braucht, formuliert einen zweiten
       * Änderungsantrag zum Hauptantrag.
       */
      throw new Error('Ein Änderungsantrag bezieht sich auf einen Hauptantrag, nicht auf einen anderen Änderungsantrag.')
    }
  }

  /* Vorgabe ist der Eingang — die Versammlungsleitung ordnet um. */
  const hoechste = db()
    .prepare(`SELECT COALESCE(MAX(sort_index), 0) AS hoch FROM motions WHERE event_id = ?`)
    .get<{ hoch: number }>(eingabe.eventId)
  const id = randomUUID()

  db()
    .prepare(
      `INSERT INTO motions (id, event_id, kind, number, title, body, proposer, reasoning, status,
                            reference_id, sort_index, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'eingereicht', ?, ?, ?)`
    )
    .run(
      id,
      eingabe.eventId,
      eingabe.art,
      nummer,
      eingabe.titel.trim(),
      eingabe.text,
      eingabe.antragsteller.trim(),
      eingabe.begruendung?.trim() || null,
      eingabe.bezugId ?? null,
      Number(hoechste?.hoch ?? 0) + 1,
      new Date().toISOString()
    )

  appendAudit({
    action: 'motion.created',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: eingabe.eventId,
    newValue: { nummer, art: eingabe.art, antragsteller: eingabe.antragsteller.trim() }
  })
  logger.info(`Antrag ${nummer} angelegt (${eingabe.art})`)
  return getAntrag(id)
}

export function antragAendern(
  eingabe: { id: UUID } & Partial<Omit<AntragEingabe, 'eventId' | 'art' | 'bezugId'>>
): Antrag {
  const session = requirePermission('round.manage')
  const vorher = getAntrag(eingabe.id)

  db()
    .prepare(`UPDATE motions SET number = ?, title = ?, body = ?, proposer = ?, reasoning = ? WHERE id = ?`)
    .run(
      eingabe.nummer?.trim() || vorher.nummer,
      eingabe.titel?.trim() ?? vorher.titel,
      eingabe.text ?? vorher.text,
      eingabe.antragsteller?.trim() || vorher.antragsteller,
      eingabe.begruendung === undefined ? (vorher.begruendung ?? null) : eingabe.begruendung.trim() || null,
      eingabe.id
    )

  const nachher = getAntrag(eingabe.id)
  appendAudit({
    action: 'motion.updated',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: vorher.eventId,
    previousValue: { nummer: vorher.nummer, titel: vorher.titel, text: vorher.text },
    newValue: { nummer: nachher.nummer, titel: nachher.titel, text: nachher.text }
  })
  return nachher
}

/**
 * Den Stand ändern — mit Vermerk, wo einer hingehört.
 *
 * Zurückziehen und Erledigen ohne Begründung wären Einträge, die später
 * niemand mehr versteht. „Erledigt" heißt fast immer: Ein weitergehender
 * Änderungsantrag wurde angenommen — und genau das gehört dazugeschrieben.
 */
export function antragStand(eingabe: { id: UUID; status: Antragsstatus; vermerk?: string }): Antrag {
  const session = requirePermission('round.manage')
  const vorher = getAntrag(eingabe.id)
  if ((eingabe.status === 'zurueckgezogen' || eingabe.status === 'erledigt') && !eingabe.vermerk?.trim()) {
    throw new Error('Zurückziehen und Erledigen brauchen einen Vermerk — sonst ist später nicht mehr nachvollziehbar, warum.')
  }

  db()
    .prepare(`UPDATE motions SET status = ?, remark = ? WHERE id = ?`)
    .run(eingabe.status, eingabe.vermerk?.trim() || vorher.vermerk || null, eingabe.id)

  appendAudit({
    action: 'motion.status',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: vorher.eventId,
    previousValue: { nummer: vorher.nummer, status: vorher.status },
    newValue: { nummer: vorher.nummer, status: eingabe.status, vermerk: eingabe.vermerk?.trim() }
  })
  return getAntrag(eingabe.id)
}

/**
 * Ein Änderungsantrag wird vom Antragsteller übernommen.
 *
 * Danach wird über ihn nicht abgestimmt; sein Text gehört zum Hauptantrag.
 * Ob das zulässig ist, entscheidet `darfUebernehmen` — und der Grund für ein
 * Nein wird mitgegeben, nicht verschluckt.
 */
export function antragUebernehmen(id: UUID): Antrag {
  const session = requirePermission('round.manage')
  const aenderung = getAntrag(id)
  if (!aenderung.bezugId) throw new Error('Dieser Antrag bezieht sich auf keinen Hauptantrag.')
  const haupt = getAntrag(aenderung.bezugId)

  const befund = darfUebernehmen(aenderung, haupt)
  if (!befund.erlaubt) throw new Error(befund.grund)

  db().prepare(`UPDATE motions SET status = 'uebernommen' WHERE id = ?`).run(id)
  appendAudit({
    action: 'motion.adopted',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: aenderung.eventId,
    newValue: {
      nummer: aenderung.nummer,
      hauptantrag: haupt.nummer,
      durch: haupt.antragsteller
    }
  })
  logger.info(`Änderungsantrag ${aenderung.nummer} in ${haupt.nummer} übernommen`)
  return getAntrag(id)
}

export function antragLoeschen(id: UUID): void {
  const session = requirePermission('round.manage')
  const antrag = getAntrag(id)
  if (antrag.roundId) {
    throw new Error('Über diesen Antrag wurde bereits abgestimmt — er lässt sich nicht mehr löschen. Zurückziehen ist der richtige Weg.')
  }
  db().prepare(`DELETE FROM motions WHERE id = ?`).run(id)
  appendAudit({
    action: 'motion.deleted',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: antrag.eventId,
    previousValue: { nummer: antrag.nummer, titel: antrag.titel }
  })
}

/** Die Abstimmungsreihenfolge neu setzen — kleiner heißt früher. */
export function antraegeSortieren(eingabe: { bezugId: UUID; reihenfolge: UUID[] }): Antrag[] {
  const session = requirePermission('round.manage')
  const haupt = getAntrag(eingabe.bezugId)
  eingabe.reihenfolge.forEach((id, index) => {
    db().prepare(`UPDATE motions SET sort_index = ? WHERE id = ? AND reference_id = ?`).run(index + 1, id, eingabe.bezugId)
  })
  appendAudit({
    action: 'motion.reordered',
    userId: session.user.id,
    userName: session.user.displayName,
    eventId: haupt.eventId,
    newValue: { hauptantrag: haupt.nummer, reihenfolge: eingabe.reihenfolge.length }
  })
  return listAntraege(haupt.eventId)
}

/** Was in welcher Reihenfolge abzustimmen ist — samt Begründung je Schritt. */
export function antragReihenfolge(hauptId: UUID): Abstimmungsschritt[] {
  const haupt = getAntrag(hauptId)
  return abstimmungsreihenfolge(haupt, listAntraege(haupt.eventId))
}

/** Der Text, über den abgestimmt wird — samt übernommener Änderungen. */
export function antragBeschlusstext(hauptId: UUID): string {
  const haupt = getAntrag(hauptId)
  return beschlusstext(haupt, listAntraege(haupt.eventId))
}

/** Verknüpft einen Antrag mit dem Wahlgang, in dem abgestimmt wurde. */
export function antragAnWahlgang(eingabe: { id: UUID; roundId: UUID }): Antrag {
  requirePermission('round.manage')
  db().prepare(`UPDATE motions SET round_id = ? WHERE id = ?`).run(eingabe.roundId, eingabe.id)
  return getAntrag(eingabe.id)
}
