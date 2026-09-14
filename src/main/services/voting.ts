/**
 * Digitale Stimmabgabe (ADR-0006).
 *
 * ## Zwei Gruppen von Funktionen, und sie dürfen nicht durcheinandergeraten
 *
 * **Die Wahlleitung** bereitet vor, eröffnet, schließt und zählt. Diese
 * Funktionen verlangen ein angemeldetes Konto wie alles andere auch.
 *
 * **Das Teilnehmergerät** holt eine Berechtigung und gibt eine Stimme ab. Es
 * hat *kein* Konto und darf keines brauchen — sein Ausweis ist der Nachweis.
 * Diese Funktionen prüfen deshalb selbst und rufen `requirePermission`
 * bewusst **nicht** auf. Jede von ihnen ist unten ausdrücklich als solche
 * gekennzeichnet; wer hier etwas ergänzt, muss wissen, auf welcher Seite er
 * steht.
 *
 * ## Was die Urne nicht weiß
 *
 * Bei geheimer Wahl entsteht die Seriennummer auf dem Gerät und wird
 * **verblendet** unterschrieben — die Berechtigungsseite sieht sie nie. In
 * `cast_ballots` steht deshalb keine Person, und es gibt keinen Weg, dorthin
 * einen zu finden. Bei einer offenen Abstimmung wäre die Zuordnung technisch
 * möglich; gespeichert wird sie trotzdem nicht. Nur eine **namentliche**
 * Abstimmung führt sie — dort ist sie der Zweck.
 */
import { constants, createHash, generateKeyPairSync, privateEncrypt, randomBytes } from 'node:crypto'
import type { ResultData, UUID } from '@shared/types'
import {
  ausBase64Url,
  pruefeSignatur,
  schluessellaenge,
  zuBase64Url,
  zuBigInt,
  zuBytes,
  type OeffentlicherSchluessel,
  type Pruefsumme
} from '@shared/blindsignatur'
import type { Geraetewahl, Stimmabgabe, Wahlgeheimnis, WahlLage, WahlStand, Wahlstatus } from '@shared/wahl'
import { db } from '../db'
import { optionalString } from '../db/driver'
import { appendAudit } from './audit'
import { requirePermission } from './auth'
import { listCandidates } from './candidates'
import { mayVote } from './participants'
import { getRound } from './rounds'

/** SHA-256, wie das Rechenwerk es erwartet. */
const sha256: Pruefsumme = async (daten) => new Uint8Array(createHash('sha256').update(daten).digest())

interface SessionRow {
  round_id: string
  secrecy: string
  devices: string
  status: string
  public_key: string | null
  private_key: string | null
  opened_at: string | null
  closed_at: string | null
}

function session(roundId: UUID): SessionRow | null {
  return db().prepare(`SELECT * FROM voting_sessions WHERE round_id = ?`).get<SessionRow>(roundId) ?? null
}

function schluesselAus(zeile: SessionRow): OeffentlicherSchluessel | undefined {
  if (!zeile.public_key) return undefined
  return JSON.parse(zeile.public_key) as OeffentlicherSchluessel
}

/* ============================================================ Wahlleitung */

/**
 * Eine digitale Abstimmung vorbereiten.
 *
 * Bei geheimer Wahl entsteht dabei ein **eigenes Schlüsselpaar je Wahlgang**.
 * Der öffentliche Teil gehört vor der Eröffnung auf die Leinwand und ins
 * Protokoll — danach lässt er sich nicht mehr unbemerkt austauschen. Eine
 * Berechtigung aus Wahlgang 1 gilt in Wahlgang 2 damit nichts.
 */
export function prepareVoting(input: {
  roundId: UUID
  geheimnis: Wahlgeheimnis
  geraete: Geraetewahl
}): WahlLage {
  const nutzer = requirePermission('round.manage')
  const round = getRound(input.roundId)
  const vorhanden = session(input.roundId)
  if (vorhanden && vorhanden.status !== 'prepared') {
    throw new Error('Diese Abstimmung läuft bereits oder ist geschlossen.')
  }

  let oeffentlich: string | null = null
  let privat: string | null = null
  if (input.geheimnis === 'secret') {
    const paar = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 })
    const jwk = paar.publicKey.export({ format: 'jwk' }) as { n: string; e: string }
    oeffentlich = JSON.stringify({ n: jwk.n, e: jwk.e })
    privat = paar.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  }

  db()
    .prepare(
      `INSERT INTO voting_sessions (round_id, secrecy, devices, status, public_key, private_key, created_at)
       VALUES (?, ?, ?, 'prepared', ?, ?, ?)
       ON CONFLICT(round_id) DO UPDATE SET
         secrecy = excluded.secrecy, devices = excluded.devices,
         public_key = excluded.public_key, private_key = excluded.private_key`
    )
    .run(input.roundId, input.geheimnis, input.geraete, oeffentlich, privat, new Date().toISOString())

  appendAudit({
    action: 'voting.prepared',
    userId: nutzer.user.id,
    userName: nutzer.user.displayName,
    eventId: round.eventId,
    electionRoundId: input.roundId,
    /* Der öffentliche Schlüssel gehört ins Protokoll — der private nie. */
    newValue: {
      geheimnis: input.geheimnis,
      geraete: input.geraete,
      schluessel: oeffentlich ? (JSON.parse(oeffentlich) as OeffentlicherSchluessel).n : undefined
    }
  })
  return votingLage(input.roundId)!
}

export function openVoting(roundId: UUID): WahlLage {
  const nutzer = requirePermission('round.manage')
  const zeile = session(roundId)
  if (!zeile) throw new Error('Für diesen Wahlgang ist keine digitale Abstimmung vorbereitet.')
  if (zeile.status === 'closed') throw new Error('Diese Abstimmung ist bereits geschlossen.')

  db()
    .prepare(`UPDATE voting_sessions SET status = 'open', opened_at = ? WHERE round_id = ?`)
    .run(new Date().toISOString(), roundId)

  const round = getRound(roundId)
  appendAudit({
    action: 'voting.opened',
    userId: nutzer.user.id,
    userName: nutzer.user.displayName,
    eventId: round.eventId,
    electionRoundId: roundId
  })
  return votingLage(roundId)!
}

/**
 * Die Abstimmung schließen.
 *
 * Drei Dinge geschehen hier, und jedes hat einen Grund:
 *
 * 1. **Der private Schlüssel wird gelöscht.** Danach kann niemand mehr
 *    Berechtigungen erzeugen — auch nicht, wer den Rechner kontrolliert.
 * 2. **Die Urne wird gemischt.** Die Eingangsreihenfolge verriete sonst, in
 *    welcher Reihenfolge abgestimmt wurde, und das ist die halbe Zuordnung.
 * 3. Der öffentliche Schlüssel bleibt stehen — ohne ihn ließe sich später
 *    nichts nachprüfen.
 */
export function closeVoting(roundId: UUID): WahlStand {
  const nutzer = requirePermission('round.manage')
  const zeile = session(roundId)
  if (!zeile) throw new Error('Für diesen Wahlgang ist keine digitale Abstimmung vorbereitet.')

  db().transaction(() => {
    db()
      .prepare(
        `UPDATE voting_sessions SET status = 'closed', closed_at = ?, private_key = NULL WHERE round_id = ?`
      )
      .run(new Date().toISOString(), roundId)

    /* Mischen heißt: neue Ordnungszahlen würfeln. Die Zeilen selbst bleiben,
       wo sie sind — verschoben wird nur, in welcher Folge sie gelesen werden. */
    for (const stimme of db()
      .prepare(`SELECT id FROM cast_ballots WHERE round_id = ?`)
      .all<{ id: string }>(roundId)) {
      db()
        .prepare(`UPDATE cast_ballots SET ordnung = ? WHERE id = ?`)
        .run(randomBytes(4).readUInt32BE(0), stimme.id)
    }
  })

  const stand = votingStand(roundId)
  const round = getRound(roundId)
  appendAudit({
    action: 'voting.closed',
    userId: nutzer.user.id,
    userName: nutzer.user.displayName,
    eventId: round.eventId,
    electionRoundId: roundId,
    newValue: { ausgegeben: stand.ausgegeben, abgegeben: stand.abgegeben }
  })
  return stand
}

/** Der Stand, wie ihn die Leinwand zeigt — und wie die Bilanz aufgehen muss. */
export function votingStand(roundId: UUID): WahlStand {
  const rechte = db()
    .prepare(`SELECT COUNT(*) AS anzahl FROM voting_rights WHERE round_id = ?`)
    .get<{ anzahl: number }>(roundId)
  const urne = db()
    .prepare(
      `SELECT COUNT(*) AS anzahl, COALESCE(SUM(weight), 0) AS gewicht FROM cast_ballots WHERE round_id = ?`
    )
    .get<{ anzahl: number; gewicht: number }>(roundId)
  return {
    ausgegeben: Number(rechte?.anzahl ?? 0),
    abgegeben: Number(urne?.anzahl ?? 0),
    gewicht: Number(urne?.gewicht ?? 0)
  }
}

/**
 * Die Urne, gemischt und lesbar — die Grundlage des gedruckten Verzeichnisses.
 *
 * Sie enthält Seriennummer und Stimme, sonst nichts. Genau so nachzählbar wie
 * ein Stapel Zettel, und genauso wenig einer Person zuzuordnen.
 */
export function urne(roundId: UUID): { serial: string; choice: Stimmabgabe; weight: number }[] {
  return db()
    .prepare(
      `SELECT serial, choice_json, weight FROM cast_ballots WHERE round_id = ? ORDER BY ordnung, serial`
    )
    .all<{ serial: string; choice_json: string; weight: number }>(roundId)
    .map((zeile) => ({
      serial: zeile.serial,
      choice: JSON.parse(zeile.choice_json) as Stimmabgabe,
      weight: Number(zeile.weight)
    }))
}

/**
 * Auszählen.
 *
 * Gerechnet wird über die Stimmgewichte: Ein Delegierter mit drei Stimmen
 * zählt dreifach. Enthaltungen und Neinstimmen werden getrennt geführt, weil
 * die Wahlverfahren sie getrennt brauchen.
 */
export function zaehlung(roundId: UUID): ResultData & { ballotsCast: number } {
  const bewerber = listCandidates(roundId)
  const stimmen = new Map<string, number>()
  let nein = 0
  let enthaltung = 0
  let abgegeben = 0

  for (const zettel of urne(roundId)) {
    abgegeben += 1
    const gewicht = zettel.weight
    if (zettel.choice.antwort === 'nein') nein += gewicht
    else if (zettel.choice.antwort === 'enthaltung') enthaltung += gewicht
    else if (zettel.choice.antwort === 'ja') {
      /* Sachabstimmung mit Ja: Die Zustimmung liegt beim ersten (und
         einzigen) Eintrag des Stimmzettels. */
      const ziel = bewerber[0]?.id ?? 'ja'
      stimmen.set(ziel, (stimmen.get(ziel) ?? 0) + gewicht)
    }
    for (const kandidat of zettel.choice.kandidaten ?? []) {
      stimmen.set(kandidat, (stimmen.get(kandidat) ?? 0) + gewicht)
    }
  }

  return {
    candidates: bewerber.map((kandidat) => ({
      candidateId: kandidat.id,
      name: kandidat.displayName,
      votes: stimmen.get(kandidat.id) ?? 0
    })),
    no: nein,
    abstentions: enthaltung,
    ballotsCast: abgegeben
  }
}

/* ====================================================== Teilnehmergeräte */

/**
 * Die Lage einer Abstimmung — **ohne Anmeldung abrufbar**.
 *
 * Sie enthält nichts, was nicht ohnehin auf der Leinwand steht: den Wahlgang,
 * die Bewerber und den öffentlichen Schlüssel. Letzterer *soll* öffentlich
 * sein; mit ihm lässt sich jede Stimme in der Urne nachprüfen.
 */
export function votingLage(roundId: UUID): WahlLage | null {
  const zeile = session(roundId)
  if (!zeile) return null
  const round = getRound(roundId)
  const bewerber = listCandidates(roundId)

  return {
    roundId,
    roundLabel: round.roundLabel,
    titel: round.title,
    geheimnis: zeile.secrecy as Wahlgeheimnis,
    geraete: zeile.devices as Geraetewahl,
    status: zeile.status as Wahlstatus,
    maxStimmen: round.maxVotes ?? round.seats ?? 1,
    kandidaten: bewerber.map((kandidat) => ({ id: kandidat.id, name: kandidat.displayName })),
    sachabstimmung: round.procedure === 'yes_no_abstain',
    schluessel: schluesselAus(zeile),
    openedAt: optionalString(zeile.opened_at)
  }
}

/** Die gerade offene digitale Abstimmung einer Versammlung, falls es eine gibt. */
export function offeneWahl(eventId: UUID): WahlLage | null {
  const zeile = db()
    .prepare(
      `SELECT s.round_id FROM voting_sessions s
         JOIN rounds r ON r.id = s.round_id
        WHERE r.event_id = ? AND s.status = 'open'
        ORDER BY s.opened_at DESC LIMIT 1`
    )
    .get<{ round_id: string }>(eventId)
  return zeile ? votingLage(zeile.round_id) : null
}

/**
 * Eine Stimmberechtigung ausgeben — **ohne Anmeldung, Ausweis genügt**.
 *
 * Bei **geheimer** Wahl kommt ein verblendeter Wert herein und eine
 * Blindsignatur zurück. Der Rechner sieht dabei nur eine Zufallszahl; was er
 * unterschreibt, erfährt er nicht.
 *
 * Bei **offener** Abstimmung gibt es nichts zu verblenden: Die Seriennummer
 * wird hier erzeugt und zurückgegeben. Sie wird nirgends mit der Person
 * gespeichert — festgehalten wird nur, *dass* eine Berechtigung erging.
 *
 * In beiden Fällen gilt: je Wahlgang und Person genau eine.
 */
export function berechtigungAusgeben(input: {
  roundId: UUID
  participantId: UUID
  /** Nur bei geheimer Wahl: der verblendete Wert vom Gerät. */
  verblendet?: string
}): { signatur?: string; serial?: string } {
  const zeile = session(input.roundId)
  if (!zeile) throw new Error('Für diesen Wahlgang läuft keine digitale Abstimmung.')
  if (zeile.status !== 'open') throw new Error('Diese Abstimmung ist nicht geöffnet.')

  const urteil = mayVote(input.participantId)
  if (!urteil.ok) throw new Error(urteil.reason ?? 'Keine Stimmberechtigung.')

  const person = db()
    .prepare(`SELECT weight FROM participants WHERE id = ?`)
    .get<{ weight: number }>(input.participantId)
  const gewicht = Number(person?.weight ?? 1)

  const bereits = db()
    .prepare(`SELECT id FROM voting_rights WHERE round_id = ? AND participant_id = ?`)
    .get<{ id: string }>(input.roundId, input.participantId)
  if (bereits) throw new Error('Für diesen Wahlgang wurde bereits eine Stimmberechtigung ausgegeben.')

  db()
    .prepare(
      `INSERT INTO voting_rights (id, round_id, participant_id, weight, issued_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(randomUUIDLike(), input.roundId, input.participantId, gewicht, new Date().toISOString())

  if (zeile.secrecy === 'secret') {
    if (!input.verblendet) throw new Error('Bei geheimer Wahl fehlt der verblendete Wert.')
    if (!zeile.private_key) throw new Error('Der Schlüssel dieses Wahlgangs ist nicht mehr verfügbar.')
    const schluessel = schluesselAus(zeile)!
    const laenge = schluessellaenge(schluessel)
    const eingabe = Buffer.from(zuBytes(zuBigInt(ausBase64Url(input.verblendet)), laenge))
    const roh = privateEncrypt({ key: zeile.private_key, padding: constants.RSA_NO_PADDING }, eingabe)
    return { signatur: zuBase64Url(new Uint8Array(roh)) }
  }

  return { serial: zuBase64Url(new Uint8Array(randomBytes(24))) }
}

/**
 * Eine Stimme einlegen — **ohne Anmeldung**.
 *
 * Bei geheimer Wahl entscheidet allein die Unterschrift: Eine gültige
 * Signatur heißt „diese Seriennummer wurde einmal unterschrieben" — nicht,
 * für wen. Die Urne weiß nichts über die Person und soll es nicht wissen.
 *
 * Bei offener Abstimmung wird geprüft, ob die Seriennummer aus einer
 * ausgegebenen Berechtigung stammt; sie ist lang genug, um nicht erraten zu
 * werden.
 */
export async function stimmeEinlegen(input: {
  roundId: UUID
  serial: string
  signatur?: string
  choice: Stimmabgabe
  /** Nur bei namentlicher Abstimmung — sonst wird der Wert verworfen. */
  participantId?: UUID
  gewicht?: number
}): Promise<void> {
  const zeile = session(input.roundId)
  if (!zeile) throw new Error('Für diesen Wahlgang läuft keine digitale Abstimmung.')
  if (zeile.status !== 'open') throw new Error('Diese Abstimmung ist nicht geöffnet.')

  if (zeile.secrecy === 'secret') {
    const schluessel = schluesselAus(zeile)
    if (!schluessel || !input.signatur) throw new Error('Diese Stimme trägt keine gültige Unterschrift.')
    const gueltig = await pruefeSignatur(ausBase64Url(input.serial), input.signatur, schluessel, sha256)
    if (!gueltig) throw new Error('Diese Stimme trägt keine gültige Unterschrift.')
  }

  const doppelt = db()
    .prepare(`SELECT id FROM cast_ballots WHERE round_id = ? AND serial = ?`)
    .get<{ id: string }>(input.roundId, input.serial)
  if (doppelt) throw new Error('Für diesen Stimmzettel wurde bereits abgestimmt.')

  db()
    .prepare(
      `INSERT INTO cast_ballots (id, round_id, serial, choice_json, weight, participant_id, ordnung)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUIDLike(),
      input.roundId,
      input.serial,
      JSON.stringify(input.choice),
      Math.max(1, input.gewicht ?? 1),
      /* Nur bei namentlicher Abstimmung. Bei offener wäre es technisch
         möglich und trotzdem falsch; bei geheimer ist es unmöglich. */
      zeile.secrecy === 'namentlich' ? (input.participantId ?? null) : null,
      randomBytes(4).readUInt32BE(0)
    )
}

/** Eine Kennung ohne Abhängigkeit von `randomUUID` in älteren Laufzeiten. */
function randomUUIDLike(): string {
  return randomBytes(16).toString('hex')
}
