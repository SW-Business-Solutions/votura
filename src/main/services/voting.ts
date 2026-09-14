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
import { fromJson, optionalString } from '../db/driver'
import { appendAudit } from './audit'
import { requirePermission } from './auth'
import { listCandidates } from './candidates'
import { mayVote } from './participants'
import { getEvent } from './events'
import { getRound } from './rounds'
import { getNetworkProjection } from './settings'

/** SHA-256, wie das Rechenwerk es erwartet. */
const sha256: Pruefsumme = async (daten) => new Uint8Array(createHash('sha256').update(daten).digest())

interface SessionRow {
  round_id: string
  secrecy: string
  devices: string
  signer: string
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
  /**
   * Wer unterschreibt.
   *
   * `hub` — der Hauptrechner, wie bisher. Einfach, und die Bilanz macht
   * Missbrauch sichtbar.
   *
   * `committee` — das Gerät des Wahlausschusses. Der Schlüssel entsteht dort
   * und verlässt es nie; der Hauptrechner **kann** dann keine zusätzlichen
   * Unterschriften erzeugen, nicht nur „tut es nicht".
   */
  signer?: 'hub' | 'committee'
}): WahlLage {
  const nutzer = requirePermission('round.manage')
  const round = getRound(input.roundId)
  const vorhanden = session(input.roundId)
  if (vorhanden && vorhanden.status !== 'prepared') {
    throw new Error('Diese Abstimmung läuft bereits oder ist geschlossen.')
  }

  /*
   * „Nur Wahlkabinen" lässt sich nur durchsetzen, wenn es überhaupt etwas
   * gibt, woran eine Kabine zu erkennen ist — und das ist das Zugriffstoken
   * des Netzes. Ohne eingerichtetes Token gälte jedes Gerät als Kabine, und
   * die Einstellung wäre eine Behauptung. Lieber hier abbrechen als im Saal
   * etwas versprechen, das nicht gilt.
   */
  if (input.geraete === 'booth' && !getNetworkProjection().token) {
    throw new Error(
      'Für „nur Wahlkabinen" muss in den Netzwerkeinstellungen ein Zugriffstoken gesetzt sein — ' +
        'nur daran lässt sich eine Kabine von einem mitgebrachten Gerät unterscheiden.'
    )
  }

  const signer = input.signer ?? 'hub'
  let oeffentlich: string | null = null
  let privat: string | null = null
  /* Beim Ausschuss entsteht der Schlüssel dort — hier bleibt beides leer, bis
     das Gerät seinen öffentlichen Teil meldet. */
  if (input.geheimnis === 'secret' && signer === 'hub') {
    const paar = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 })
    const jwk = paar.publicKey.export({ format: 'jwk' }) as { n: string; e: string }
    oeffentlich = JSON.stringify({ n: jwk.n, e: jwk.e })
    privat = paar.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  }

  db()
    .prepare(
      `INSERT INTO voting_sessions (round_id, secrecy, devices, signer, status, public_key, private_key, created_at)
       VALUES (?, ?, ?, ?, 'prepared', ?, ?, ?)
       ON CONFLICT(round_id) DO UPDATE SET
         secrecy = excluded.secrecy, devices = excluded.devices, signer = excluded.signer,
         public_key = excluded.public_key, private_key = excluded.private_key`
    )
    .run(input.roundId, input.geheimnis, input.geraete, signer, oeffentlich, privat, new Date().toISOString())

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
      unterschreibt: signer === 'committee' ? 'Wahlausschuss' : 'Hauptrechner',
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
  /*
   * Ohne Schlüssel keine geheime Wahl. Beim Ausschussbetrieb heißt das: Das
   * Gerät des Wahlausschusses muss seinen öffentlichen Teil gemeldet haben —
   * sonst stünde die Abstimmung offen und niemand könnte eine Berechtigung
   * bekommen.
   */
  if (zeile.secrecy === 'secret' && !zeile.public_key) {
    throw new Error(
      'Der Wahlausschuss hat seinen Prüfschlüssel noch nicht gemeldet. Erst danach lässt sich eröffnen.'
    )
  }

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
    .prepare(
      `SELECT COUNT(*) AS anzahl,
              COALESCE(SUM(CASE WHEN voided_reason IS NOT NULL THEN 1 ELSE 0 END), 0) AS entwertet
       FROM voting_rights WHERE round_id = ?`
    )
    .get<{ anzahl: number; entwertet: number }>(roundId)
  const urne = db()
    .prepare(
      `SELECT COUNT(*) AS anzahl, COALESCE(SUM(weight), 0) AS gewicht FROM cast_ballots WHERE round_id = ?`
    )
    .get<{ anzahl: number; gewicht: number }>(roundId)
  return {
    ausgegeben: Number(rechte?.anzahl ?? 0),
    abgegeben: Number(urne?.anzahl ?? 0),
    gewicht: Number(urne?.gewicht ?? 0),
    /* Entwertete Berechtigungen erklären die Lücke zwischen beidem — ohne sie
       sähe die Bilanz nach verschwundenen Stimmen aus. */
    entwertet: Number(rechte?.entwertet ?? 0)
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

/**
 * Die Urne als lesbare Liste — für den Ausdruck und die Nachzählung.
 *
 * Je Zeile eine Seriennummer und die Stimme im Klartext. Mehr steht nicht
 * darin, und mehr darf nicht darin stehen: Das Verzeichnis ist genauso
 * nachzählbar wie ein Stapel Zettel und genauso wenig einer Person
 * zuzuordnen.
 */
export function urnenListe(roundId: UUID): { serial: string; text: string; weight: number }[] {
  const bewerber = new Map(listCandidates(roundId).map((k) => [k.id, k.displayName]))
  return urne(roundId).map((zettel) => {
    const teile: string[] = []
    if (zettel.choice.antwort) {
      teile.push(
        zettel.choice.antwort === 'ja' ? 'JA' : zettel.choice.antwort === 'nein' ? 'NEIN' : 'ENTHALTUNG'
      )
    }
    for (const id of zettel.choice.kandidaten ?? []) teile.push(bewerber.get(id) ?? id)
    return {
      serial: zettel.serial,
      text: teile.length > 0 ? teile.join(', ') : 'leer',
      weight: zettel.weight
    }
  })
}

/**
 * Die digitale Auszählung zu einem von Hand erfassten Ergebnis hinzurechnen.
 *
 * **Der hybride Fall, und er ist der Grund für diese Funktion.** Läuft ein
 * Wahlgang auf Papier und digital, zählt jemand die Zettel aus und trägt sie
 * ein — die Urne im Rechner kommt dazu. Würde die digitale Übernahme das
 * Ergebnis einfach überschreiben, wäre die Handauszählung weg, und zwar
 * lautlos.
 *
 * Was eingetragen wird, ist deshalb immer der **von Hand gezählte Anteil**.
 * Addiert wird hier, an einer Stelle, deterministisch: Dasselbe Ergebnis
 * zweimal zu speichern ergibt zweimal dasselbe und nicht das Doppelte.
 *
 * Ohne geschlossene digitale Abstimmung ändert sich nichts — für jede
 * bisherige Versammlung bleibt alles, wie es war.
 */
export function mitUrneZusammengefuehrt(
  roundId: UUID,
  handgezaehlt: ResultData & { ballotsCast: number; validBallots: number }
): ResultData & { ballotsCast: number; validBallots: number } {
  const zeile = session(roundId)
  /* Nur eine **geschlossene** Urne wird gezählt. Solange die Abstimmung läuft,
     wäre jede Zwischensumme ein Ergebnis, das noch keines ist. */
  if (!zeile || zeile.status !== 'closed') return handgezaehlt

  const digital = zaehlung(roundId)
  const summe = new Map<string, { candidateId: string; name: string; votes: number }>()
  for (const eintrag of [...(handgezaehlt.candidates ?? []), ...digital.candidates]) {
    const bisher = summe.get(eintrag.candidateId)
    summe.set(eintrag.candidateId, {
      candidateId: eintrag.candidateId,
      name: eintrag.name ?? bisher?.name ?? '',
      votes: (bisher?.votes ?? 0) + (eintrag.votes ?? 0)
    })
  }

  return {
    ...handgezaehlt,
    /* Die Reihenfolge des Stimmzettels bleibt erhalten: erst die Einträge der
       Handauszählung, dann was nur digital vorkam. */
    candidates: [...summe.values()],
    no: (handgezaehlt.no ?? 0) + (digital.no ?? 0),
    abstentions: (handgezaehlt.abstentions ?? 0) + (digital.abstentions ?? 0),
    ballotsCast: handgezaehlt.ballotsCast + digital.ballotsCast,
    /* Eine digitale Stimme ist immer gültig — ungültig entsteht auf Papier,
       durch Durchstreichen, Mehrfachkreuze, Bemerkungen. */
    validBallots: handgezaehlt.validBallots + digital.ballotsCast
  }
}

/* ================================================== Der Wahlausschuss (M3) */

/**
 * Der Wahlgang, auf den das Ausschussgerät gerade wartet.
 *
 * Es bekommt ihn gesagt, statt ihn eingestellt zu bekommen: Am Tisch des
 * Wahlausschusses soll niemand Kennungen abtippen. Gesucht wird die eine
 * geheime Abstimmung dieser Versammlung, die über den Ausschuss unterschreibt
 * und noch nicht geschlossen ist.
 */
export function ausschussWahlgang(eventId: UUID): WahlLage | null {
  const zeile = db()
    .prepare(
      `SELECT s.round_id FROM voting_sessions s
         JOIN rounds r ON r.id = s.round_id
        WHERE r.event_id = ? AND s.signer = 'committee' AND s.secrecy = 'secret'
          AND s.status IN ('prepared', 'open')
        ORDER BY s.created_at DESC LIMIT 1`
    )
    .get<{ round_id: string }>(eventId)
  return zeile ? votingLage(zeile.round_id) : null
}

/**
 * Das Gerät des Wahlausschusses meldet seinen öffentlichen Schlüssel.
 *
 * **Nur einmal.** Steht schon einer da, wird die Meldung abgewiesen — ein
 * Schlüssel, der sich während einer laufenden Abstimmung austauschen ließe,
 * wäre keine Prüfmöglichkeit, sondern eine Einladung. Aus demselben Grund
 * geht es nur vor der Eröffnung.
 */
export function committeeKeyMelden(roundId: UUID, schluessel: OeffentlicherSchluessel): void {
  const zeile = session(roundId)
  if (!zeile) throw new Error('Für diesen Wahlgang ist keine digitale Abstimmung vorbereitet.')
  if (zeile.signer !== 'committee') throw new Error('Dieser Wahlgang unterschreibt nicht über den Ausschuss.')
  if (zeile.status !== 'prepared') throw new Error('Die Abstimmung ist bereits eröffnet.')
  if (zeile.public_key) throw new Error('Für diesen Wahlgang steht bereits ein Prüfschlüssel fest.')
  if (!schluessel?.n || !schluessel?.e) throw new Error('Der gemeldete Schlüssel ist unvollständig.')

  db()
    .prepare(`UPDATE voting_sessions SET public_key = ? WHERE round_id = ?`)
    .run(JSON.stringify({ n: schluessel.n, e: schluessel.e }), roundId)

  appendAudit({
    action: 'voting.committee_key',
    electionRoundId: roundId,
    newValue: { schluessel: schluessel.n.slice(0, 32) }
  })
}

/**
 * Was noch zu unterschreiben ist.
 *
 * Die Liste enthält **nur verblendete Werte**. Auch wer sie vollständig liest,
 * erfährt daraus nichts — das ist der ganze Sinn der Verblendung. Sie darf
 * deshalb über das Netz gehen.
 */
export function offeneSignaturen(roundId: UUID): { id: string; blinded: string }[] {
  return db()
    .prepare(
      `SELECT id, blinded FROM signing_queue
        WHERE round_id = ? AND answered_at IS NULL ORDER BY created_at LIMIT 50`
    )
    .all<{ id: string; blinded: string }>(roundId)
}

/** Der Ausschuss gibt eine Unterschrift zurück. */
export function signaturEintragen(id: string, signatur: string): void {
  const zeile = db()
    .prepare(`SELECT id, answered_at FROM signing_queue WHERE id = ?`)
    .get<{ id: string; answered_at: string | null }>(id)
  if (!zeile) throw new Error('Diese Anfrage gibt es nicht.')
  /* Einmal beantwortet, bleibt beantwortet: Eine zweite Unterschrift auf
     dieselbe Anfrage wäre eine zusätzliche Berechtigung aus dem Nichts. */
  if (zeile.answered_at) return

  db()
    .prepare(`UPDATE signing_queue SET signature = ?, answered_at = ? WHERE id = ?`)
    .run(signatur, new Date().toISOString(), id)
}

/** Das Gerät des Wählers holt seine Unterschrift ab, sobald sie da ist. */
export function signaturAbholen(id: string): { signatur?: string } {
  const zeile = db()
    .prepare(`SELECT signature FROM signing_queue WHERE id = ?`)
    .get<{ signature: string | null }>(id)
  if (!zeile) throw new Error('Diese Anfrage gibt es nicht.')
  return zeile.signature ? { signatur: zeile.signature } : {}
}

/**
 * Wie viele Unterschriften über den Ausschuss gelaufen sind.
 *
 * Die Zahl, die der Ausschuss unabhängig mitzählen kann — und die am Ende
 * zur Urne passen muss. Genau das ist das Vier-Augen-Prinzip: nicht, dass
 * der Hauptrechner nichts kann, sondern dass jemand anderes nachrechnet.
 */
export function signaturZaehler(roundId: UUID): { angefragt: number; unterschrieben: number } {
  const zeile = db()
    .prepare(`SELECT COUNT(*) AS alle, COUNT(answered_at) AS fertig FROM signing_queue WHERE round_id = ?`)
    .get<{ alle: number; fertig: number }>(roundId)
  return { angefragt: Number(zeile?.alle ?? 0), unterschrieben: Number(zeile?.fertig ?? 0) }
}

/**
 * Hat diese Person für diesen Wahlgang schon eine digitale Stimmberechtigung?
 *
 * Gebraucht von der Papierausgabe: In einem hybriden Wahlgang laufen beide
 * Wege nebeneinander, und niemand darf beide gehen.
 */
export function hatStimmrecht(roundId: UUID, participantId: UUID): boolean {
  return (
    db()
      .prepare(
        `SELECT id FROM voting_rights
         WHERE round_id = ? AND participant_id = ? AND voided_reason IS NULL`
      )
      .get<{ id: string }>(roundId, participantId) !== undefined
  )
}

/**
 * Eine ausgegebene Stimmberechtigung entwerten.
 *
 * **Wofür das da ist.** Jemand lädt am Gerät die Seite neu, bevor die Stimme
 * abgeschickt ist. Die Berechtigung ist vergeben, in der Urne liegt nichts —
 * und weil eine digitale Berechtigung die Papierausgabe sperrt, könnte diese
 * Person überhaupt nicht mehr abstimmen. Ohne einen Weg zurück wäre das der
 * Verlust einer Stimme durch einen Fingertipp.
 *
 * **Was dabei nicht passieren darf.** Wer bereits abgestimmt hat, bekommt
 * nichts mehr — sonst stünde eine Stimme in der Urne und eine zweite auf
 * Papier. Bei offener und namentlicher Abstimmung ist das feststellbar, und
 * es wird festgestellt.
 *
 * **Bei geheimer Wahl ist es nicht feststellbar**, denn genau das ist ihr
 * Zweck. Die Entwertung bleibt möglich, verlangt aber eine Begründung und
 * steht im Protokoll: Sie ist eine Entscheidung der Wahlleitung, keine
 * Rechnung des Programms. Die Bilanz zeigt sie als das, was sie ist — eine
 * ausgegebene Berechtigung, die nicht in die Urne gelangt ist.
 */
export function berechtigungEntwerten(input: {
  roundId: UUID
  participantId: UUID
  grund: string
}): void {
  const sitzung = requirePermission('accounting.edit')
  const grund = input.grund.trim()
  if (!grund) throw new Error('Für die Entwertung einer Stimmberechtigung ist eine Begründung nötig.')

  const recht = db()
    .prepare(
      `SELECT id, used_at, voided_reason FROM voting_rights WHERE round_id = ? AND participant_id = ?`
    )
    .get<{ id: string; used_at: string | null; voided_reason: string | null }>(
      input.roundId,
      input.participantId
    )
  if (!recht) throw new Error('Für diesen Wahlgang wurde keine digitale Stimmberechtigung ausgegeben.')
  if (recht.voided_reason) throw new Error('Diese Stimmberechtigung ist bereits entwertet.')
  if (recht.used_at) throw new Error('Mit dieser Stimmberechtigung wurde bereits abgestimmt.')

  db()
    .prepare(`UPDATE voting_rights SET voided_reason = ?, used_at = ? WHERE id = ?`)
    .run(grund, new Date().toISOString(), recht.id)

  const zeile = session(input.roundId)
  const person = db()
    .prepare(`SELECT last_name, first_name FROM participants WHERE id = ?`)
    .get<{ last_name: string; first_name: string }>(input.participantId)
  appendAudit({
    action: 'voting.right.voided',
    userId: sitzung.user.id,
    userName: sitzung.user.displayName,
    electionRoundId: input.roundId,
    reason: grund,
    /* Im Klartext, nicht als Kennung: Wer das Protokoll liest, soll nicht
       raten müssen, was hier geschehen ist. */
    newValue: {
      name: person ? `${person.last_name}, ${person.first_name}` : input.participantId,
      hinweis:
        zeile?.secrecy === 'secret'
          ? 'Geheime Wahl — ob abgestimmt wurde, ist nicht feststellbar'
          : 'Es war keine Stimme abgegeben'
    }
  })
}

/**
 * Hat diese Person für diesen Wahlgang schon einen **Stimmzettel auf Papier**
 * bekommen?
 *
 * Die Abfrage geht bewusst unmittelbar an die Tabelle und nicht über den
 * Ausgabedienst: Der ruft seinerseits hier an, und zwei Dienste, die
 * einander importieren, sind der Anfang einer Schleife.
 */
function hatPapierzettel(roundId: UUID, participantId: UUID): boolean {
  return (
    db()
      .prepare(`SELECT id FROM ballot_issues WHERE round_id = ? AND participant_id = ? AND kind = 'initial'`)
      .get<{ id: string }>(roundId, participantId) !== undefined
  )
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

  const veranstaltung = getEvent(round.eventId)

  return {
    roundId,
    roundLabel: round.roundLabel,
    titel: round.title,
    organisation: veranstaltung?.organization,
    veranstaltung: veranstaltung?.title,
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
}): { signatur?: string; serial?: string; ticket?: string } {
  const zeile = session(input.roundId)
  if (!zeile) throw new Error('Für diesen Wahlgang läuft keine digitale Abstimmung.')
  if (zeile.status !== 'open') throw new Error('Diese Abstimmung ist nicht geöffnet.')

  const urteil = mayVote(input.participantId)
  if (!urteil.ok) throw new Error(urteil.reason ?? 'Keine Stimmberechtigung.')

  const person = db()
    .prepare(`SELECT weight FROM participants WHERE id = ?`)
    .get<{ weight: number }>(input.participantId)
  const gewicht = Number(person?.weight ?? 1)

  const vorhanden = db()
    .prepare(
      `SELECT id, used_at, voided_reason FROM voting_rights WHERE round_id = ? AND participant_id = ?`
    )
    .get<{ id: string; used_at: string | null; voided_reason: string | null }>(
      input.roundId,
      input.participantId
    )
  if (vorhanden) {
    if (vorhanden.voided_reason) {
      throw new Error('Diese Stimmberechtigung wurde entwertet. Bitte beim Wahlvorstand melden.')
    }
    /*
     * **Eine unverbrauchte Berechtigung wird noch einmal ausgeliefert.** Wer
     * die Seite neu lädt, bevor er abgeschickt hat, stünde sonst vor einer
     * vergebenen Berechtigung, die er nicht mehr in der Hand hat.
     *
     * Das ist nur bei offener und namentlicher Abstimmung gefahrlos: Dort
     * entscheidet nicht die Seriennummer, sondern die Berechtigung, und die
     * gilt genau einmal — er mag zwei Nummern haben, abstimmen kann er mit
     * einer. Bei geheimer Wahl wäre es eine zweite Unterschrift und damit
     * eine zweite Stimme; dort bleibt nur die Entwertung durch die
     * Wahlleitung.
     */
    if (zeile.secrecy === 'secret' || vorhanden.used_at) {
      throw new Error('Für diesen Wahlgang wurde bereits eine Stimmberechtigung ausgegeben.')
    }
    return { serial: zuBase64Url(new Uint8Array(randomBytes(24))) }
  }
  /*
   * **Der hybride Fall.** Läuft ein Wahlgang auf Papier *und* digital, darf
   * niemand beide Wege gehen — sonst läge eine Stimme in der Urne und eine
   * zweite in der Wahlurne aus Pappe, und keine Bilanz der Welt fände das.
   */
  if (hatPapierzettel(input.roundId, input.participantId)) {
    throw new Error('Für diesen Wahlgang wurde bereits ein Stimmzettel auf Papier ausgegeben.')
  }

  db()
    .prepare(
      `INSERT INTO voting_rights (id, round_id, participant_id, weight, issued_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(randomUUIDLike(), input.roundId, input.participantId, gewicht, new Date().toISOString())

  if (zeile.secrecy === 'secret') {
    if (!input.verblendet) throw new Error('Bei geheimer Wahl fehlt der verblendete Wert.')

    /*
     * Unterschreibt der Ausschuss, liegt der Schlüssel nicht hier. Die
     * Anfrage kommt in die Warteschlange; das Gerät des Ausschusses holt sie
     * ab, unterschreibt und gibt zurück. Der Wähler wartet Sekunden — dafür
     * kann dieser Rechner nichts erzeugen, was niemand gesehen hat.
     */
    if (zeile.signer === 'committee') {
      const ticket = randomUUIDLike()
      db()
        .prepare(`INSERT INTO signing_queue (id, round_id, blinded, created_at) VALUES (?, ?, ?, ?)`)
        .run(ticket, input.roundId, input.verblendet, new Date().toISOString())
      return { ticket }
    }

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

  /*
   * **Dieselbe Stimme ein zweites Mal.** Reißt die Verbindung ab, nachdem die
   * Urne angenommen hat, sieht der Wähler einen Fehler, obwohl seine Stimme
   * liegt — und schickt sie noch einmal. Sie darf dann weder doppelt gezählt
   * werden noch als Fehler erscheinen: Was gewollt war, ist geschehen.
   *
   * Entschieden wird an der Stimme selbst. Gleiche Seriennummer und gleiche
   * Auswahl heißt: schon da, alles in Ordnung. Gleiche Seriennummer, andere
   * Auswahl heißt: ein zweiter Versuch mit anderem Inhalt — und der wird
   * abgewiesen.
   */
  const doppelt = db()
    .prepare(`SELECT choice_json FROM cast_ballots WHERE round_id = ? AND serial = ?`)
    .get<{ choice_json: string }>(input.roundId, input.serial)
  if (doppelt) {
    if (stimmabdruck(fromJson<Stimmabgabe>(doppelt.choice_json, {})) === stimmabdruck(input.choice)) return
    throw new Error('Für diesen Stimmzettel wurde bereits abgestimmt.')
  }

  /*
   * **Die Berechtigung wird verbraucht.** Bei offener und namentlicher
   * Abstimmung ist sie der Nachweis: Die Seriennummer kommt vom Rechner,
   * steht aber nirgends — wer eine zweite erfände, käme sonst durch. Je Person
   * und Wahlgang gibt es genau eine Berechtigung, und sie gilt einmal.
   *
   * Bei geheimer Wahl ist das weder nötig noch möglich: Dort trägt die
   * Unterschrift den Nachweis, und die Urne darf die Person nicht kennen.
   */
  if (zeile.secrecy !== 'secret') {
    if (!input.participantId) throw new Error('Keine Stimmberechtigung für diesen Wahlgang.')
    const recht = db()
      .prepare(
        `SELECT id, weight, used_at, voided_reason FROM voting_rights
         WHERE round_id = ? AND participant_id = ?`
      )
      .get<{ id: string; weight: number; used_at: string | null; voided_reason: string | null }>(
        input.roundId,
        input.participantId
      )
    if (!recht) throw new Error('Keine Stimmberechtigung für diesen Wahlgang.')
    if (recht.voided_reason) {
      throw new Error('Diese Stimmberechtigung wurde entwertet. Bitte beim Wahlvorstand melden.')
    }
    if (recht.used_at) throw new Error('Für diesen Wahlgang wurde bereits abgestimmt.')

    db()
      .prepare(`UPDATE voting_rights SET used_at = ? WHERE id = ? AND used_at IS NULL`)
      .run(new Date().toISOString(), recht.id)
    /* Das Gewicht steht an der Berechtigung, nicht an der Anfrage — sonst
       entschiede das Gerät, wie schwer seine Stimme wiegt. */
    input = { ...input, gewicht: Number(recht.weight) }
  }

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

/**
 * Der Abdruck einer Stimme — zum Vergleichen, nicht zum Speichern.
 *
 * Die Reihenfolge angekreuzter Bewerber sagt nichts aus; zwei Geräte können
 * dieselbe Auswahl verschieden anordnen. Verglichen wird deshalb sortiert.
 */
function stimmabdruck(choice: Stimmabgabe): string {
  return JSON.stringify({
    antwort: choice.antwort ?? null,
    kandidaten: [...(choice.kandidaten ?? [])].sort()
  })
}

/** Eine Kennung ohne Abhängigkeit von `randomUUID` in älteren Laufzeiten. */
function randomUUIDLike(): string {
  return randomBytes(16).toString('hex')
}
