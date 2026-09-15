/**
 * Der Stand des Teleprompters.
 *
 * Bewusst getrennt vom Projektionsdienst: Der Prompter ist keine Bühne. Er
 * zeigt nichts, was das Publikum sieht — im Gegenteil, er zeigt genau das,
 * was es **nicht** sehen soll. Ein eigener Zustand hält auseinander, was
 * auseinandergehört, und schließt aus, dass ein Griff in die Beamersteuerung
 * versehentlich die Rede an die Wand wirft.
 *
 * Der Lauf wird über die Uhr beschrieben (`position` + `anchoredAt` + Tempo),
 * nicht über Befehle: Ein Gerät, das mitten in der Rede dazukommt, rechnet
 * sich seine Stelle selbst aus. Dieselbe Überlegung wie beim Video.
 */
import { randomUUID } from 'node:crypto'
import {
  prompterPosition,
  PROMPTER_VORGABE,
  redeLaenge,
  type Laufart,
  type PrompterAnsicht,
  type PrompterViewState
} from '@shared/speech'
import type { UUID } from '@shared/types'
import { logger } from '../logger'
import { getSpeech, redeFuerBewerber } from './speeches'

type Listener = (state: PrompterViewState) => void

/*
 * Kennung dieses Programmlaufs.
 *
 * Wie beim Projektionszustand: Merkt eine Netzansicht, dass die Kennung
 * gewechselt hat, lädt sie sich einmalig neu — sonst liefe sie nach einer
 * Aktualisierung mit altem Programmstand weiter.
 */
const SERVER_INSTANCE_ID = randomUUID()

let state: PrompterViewState = { ...PROMPTER_VORGABE, serverInstanceId: SERVER_INSTANCE_ID }
const listeners: Listener[] = []

export function onPrompterViewChanged(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    const stelle = listeners.indexOf(listener)
    if (stelle >= 0) listeners.splice(stelle, 1)
  }
}

function melde(): PrompterViewState {
  const schnappschuss = getPrompterView()
  for (const listener of listeners) listener(schnappschuss)
  return schnappschuss
}

export function getPrompterView(): PrompterViewState {
  return { ...state, spiegel: { ...state.spiegel } }
}

/**
 * Setzt den Zustand und verankert ihn in der Gegenwart.
 *
 * Jede Änderung, die den Lauf betrifft, muss die aktuelle Stelle festhalten —
 * sonst springt der Text: Wer das Tempo ändert, ohne vorher zu verankern,
 * lässt alle Geräte die verstrichene Zeit mit dem **neuen** Tempo neu
 * rechnen, und die Rede rutscht um Minuten.
 */
function setze(aenderung: Partial<PrompterViewState>, verankern = true): PrompterViewState {
  const jetzt = Date.now()
  /*
   * Ohne Verankern bleiben Stelle **und** Anker unangetastet.
   *
   * Nur den Anker auf jetzt zu setzen, ohne die Stelle nachzuführen, würfe den
   * Text bei laufendem Lauf zurück an die Stelle, an der er zuletzt verankert
   * wurde — ein Dreh an der Schriftgröße ließe die Rede springen.
   */
  const lauf = verankern
    ? { position: prompterPosition(state, jetzt), anchoredAt: new Date(jetzt).toISOString() }
    : {}
  state = {
    ...state,
    ...lauf,
    ...aenderung,
    updatedAt: new Date(jetzt).toISOString()
  }
  return melde()
}

/** Legt eine Rede auf den Prompter — von vorn, angehalten. */
export function loadSpeech(id: UUID | undefined): PrompterViewState {
  /* Wer von Hand etwas auflegt, folgt nicht mehr dem Aufruf: Die Uhr der
     Bühne gehört dann nicht mehr zu diesem Text. */
  gefolgteRede = undefined
  if (!id) {
    return setze({ speech: undefined, position: 0, laenge: 0, running: false, pausedSecondsLeft: undefined })
  }
  const rede = getSpeech(id)
  if (!rede) throw new Error('Diese Rede gibt es nicht.')
  return setze({
    speech: { id: rede.id, title: rede.title, markdown: rede.markdown },
    laenge: redeLaenge(rede.markdown),
    position: 0,
    running: false,
    pausedSecondsLeft: undefined
  })
}

/**
 * Übernimmt einen geänderten Text, ohne die Stelle zu verlieren.
 *
 * Wird eine laufende Rede nebenan bearbeitet, soll der Prompter den neuen
 * Text zeigen — aber nicht an den Anfang springen. Wer am Pult steht, verliert
 * sonst mitten im Satz die Zeile.
 */
export function refreshSpeech(id: UUID): PrompterViewState {
  if (state.speech?.id !== id) return getPrompterView()
  const rede = getSpeech(id)
  if (!rede) return getPrompterView()
  return setze({
    speech: { id: rede.id, title: rede.title, markdown: rede.markdown },
    laenge: redeLaenge(rede.markdown)
  })
}

/**
 * Startet oder hält an.
 *
 * Ist die Rede durchgelaufen, beginnt „Starten" wieder von vorn. Sonst
 * passierte gar nichts: Die Stelle steht am Ende, der Lauf zählt nicht
 * weiter — und am Pult sähe es aus, als sei der Knopf kaputt.
 */
export function setPrompterRunning(running: boolean): PrompterViewState {
  const amEnde = state.laenge > 0 && prompterPosition(state, Date.now()) >= state.laenge
  if (running && amEnde) return setze({ running: true, position: 0 })
  return setze({ running })
}

/** Springt an eine Stelle (in Zeilenhöhen vom Anfang). */
export function setPrompterPosition(position: number): PrompterViewState {
  return setze({ position: Math.max(0, position) })
}

/** Verschiebt um so viele Zeilen — der Griff für „eine Zeile zurück". */
export function nudgePrompter(zeilen: number): PrompterViewState {
  const jetzt = Date.now()
  return setze({ position: Math.max(0, prompterPosition(state, jetzt) + zeilen) })
}

export function setPrompterTempo(tempo: number): PrompterViewState {
  return setze({ tempo: Math.round(tempo) })
}

/**
 * Die Darstellung — Schrift, Spiegel, Breite, Lesezeile, Uhr.
 *
 * Alles zusammen in einem Aufruf: Diese Werte betreffen den Lauf nicht, und
 * fünf einzelne Wege wären fünf Gelegenheiten, den Zustand zu verankern, ohne
 * dass etwas läuft.
 */
export function setPrompterDarstellung(
  aenderung: Partial<Pick<PrompterViewState, 'schrift' | 'spiegel' | 'breite' | 'leselinie' | 'zeigeUhr'>>
): PrompterViewState {
  return setze(aenderung, false)
}

/**
 * Rede oder Vortragsansicht.
 *
 * Ein Wechsel rührt den Lauf nicht an: Wer zwischendurch die Folien zeigt und
 * zurückschaltet, steht wieder an derselben Stelle im Text.
 */
export function setPrompterAnsicht(ansicht: PrompterAnsicht): PrompterViewState {
  return setze({ ansicht }, false)
}

/**
 * Was den Text bewegt: Uhr, Stimme oder gar nichts.
 *
 * Vorher wird verankert, denn der Wechsel von `auto` auf etwas anderes hält
 * den Lauf an — ohne Verankern stünde der Text plötzlich dort, wo er zuletzt
 * verankert wurde, statt dort, wo er gerade ist.
 */
export function setPrompterLaufart(laufart: Laufart): PrompterViewState {
  return setze({ laufart })
}

/** Die zugestandene Redezeit — dieselbe Uhr, die auch auf dem Beamer läuft. */
export function setPrompterUntil(until?: string): PrompterViewState {
  /* Von Hand geholt heißt: läuft. Eine eingefrorene Restzeit von vorhin
     stünde sonst still, obwohl gerade eine neue Uhr gesetzt wurde. */
  return setze({ until, pausedSecondsLeft: undefined }, false)
}

/**
 * Übernimmt aus der Netzkonfiguration, ob ein Gerät im Saal bedienen darf.
 *
 * Der Prompter führt den Wert nur mit, damit die Netzansicht ihre Leiste
 * zeigen oder weglassen kann. Entschieden wird er in der Netzkonfiguration —
 * und dort durchgesetzt, nicht hier.
 */
export function setPrompterNetzBedienung(erlaubt: boolean): PrompterViewState {
  if (state.netzBedienung === erlaubt) return getPrompterView()
  return setze({ netzBedienung: erlaubt }, false)
}

/**
 * Legt der Prompter die Rede des Aufgerufenen von selbst auf?
 *
 * Der Schalter steht im Prompterzustand und nicht in den Einstellungen: Er
 * wird während der Versammlung umgelegt, nicht davor.
 */
export function setPrompterFolgtDemAufruf(folgt: boolean): PrompterViewState {
  if (state.folgtDemAufruf === folgt) return getPrompterView()
  return setze({ folgtDemAufruf: folgt }, false)
}

/*
 * Wer zuletzt aufgerufen wurde.
 *
 * Ohne dieses Gedächtnis legte jede Änderung am Projektionszustand — eine
 * angehaltene Uhr, eine verlängerte Redezeit — die Rede erneut von vorn auf.
 * Und wer während einer laufenden Vorstellung von Hand einen anderen Text
 * auflegt, bekäme ihn beim nächsten Herzschlag wieder weggenommen.
 */
let zuletztGerufen: string | undefined

/*
 * Welche Rede wir dem Aufruf folgend aufgelegt haben.
 *
 * Nur für sie gilt die Uhr der Bühne. Legt jemand von Hand etwas anderes auf,
 * ist die Verbindung gelöst — sonst hielte ein „Redezeit anhalten" auf dem
 * Beamer plötzlich die Notizen der Versammlungsleitung an.
 */
let gefolgteRede: UUID | undefined

/** Ob die Redezeit beim letzten Blick ruhte — sonst spiegelten wir sie ständig neu. */
let zuletztAngehalten = false

/** Der Aufruf, wie ihn die Bühne meldet. */
export interface Sprecheraufruf {
  name: string
  /** Ende der Redezeit (ISO). */
  until?: string
  /** Bezugswahlgang — er entscheidet bei mehreren Bewerbungen einer Person. */
  roundId?: UUID
  /** Gesetzt, solange die Redezeit ruht. */
  pausedSecondsLeft?: number
}

/**
 * Auf dem Beamer wurde jemand aufgerufen — oder seine Uhr hat sich geändert.
 *
 * Zwei Aufgaben, weil es zwei Dinge sind, die aus derselben Quelle kommen:
 *
 * 1. **Ein neuer Name.** Liegt für ihn eine Rede bereit, kommt sie auf den
 *    Prompter, mit der Uhr, die der Saal sieht, und der Lauf beginnt. Ist
 *    keine Rede zugeordnet, bleibt alles, wie es ist: Ein Gast, ein Bericht,
 *    ein Grußwort räumen den Prompter nicht leer.
 * 2. **Derselbe Name, andere Uhr.** Wird die Redezeit angehalten, ruht auch
 *    der Lauf am Pult; läuft sie weiter, läuft er weiter. Alles andere wäre
 *    ein Widerspruch vor den Augen der vortragenden Person: vorn eine
 *    stehende Uhr, hier ein Text, der weiterrollt.
 */
export function sprecherAufgerufen(sprecher?: Sprecheraufruf): void {
  const name = sprecher?.name?.trim()
  if (!sprecher || !name) return
  if (name === zuletztGerufen) {
    uhrSpiegeln(sprecher)
    return
  }
  zuletztGerufen = name
  zuletztAngehalten = sprecher.pausedSecondsLeft !== undefined
  if (!state.folgtDemAufruf) return

  const rede = redeFuerBewerber(name, sprecher.roundId)
  if (!rede || rede.id === state.speech?.id) return

  loadSpeech(rede.id)
  gefolgteRede = rede.id
  /*
   * **Und der Lauf beginnt.**
   *
   * Die zugestandene Redezeit läuft ab dem Aufruf — der Saal sieht sie
   * zählen. Ein Text, der daneben stillsteht, bis jemand „Starten" drückt,
   * wäre schon beim ersten Satz aus dem Tritt: Wer vorn steht, hat die Hände
   * am Manuskript und nicht am Board.
   *
   * Nur bei gleichmäßigem Lauf. „Nach Stimme" bewegt das Sprechen selbst,
   * und „Von Hand" ist die ausdrückliche Ansage, dass sich nichts von allein
   * bewegen soll — die beiden umzustoßen hieße, eine Einstellung zu
   * überfahren.
   */
  const laeuftLos = state.laufart === 'auto' && !zuletztAngehalten
  setze(
    {
      until: sprecher.until,
      pausedSecondsLeft: sprecher.pausedSecondsLeft,
      running: laeuftLos
    },
    false
  )
  logger.info(`Prompter: „${rede.title}" für ${name} aufgelegt${laeuftLos ? ' — der Lauf beginnt' : ''}.`)
}

/**
 * Die Uhr der Bühne auf das Pult spiegeln.
 *
 * Nur für die Rede, die wir dem Aufruf folgend aufgelegt haben: Was jemand
 * von Hand darauflegt, gehört ihm und nicht der Bühne.
 *
 * Beim Anhalten wird **verankert** — die Stelle im Text muss festgehalten
 * werden, bevor der Lauf stehenbleibt, sonst spränge der Text beim
 * Weiterlaufen dorthin zurück, wo er zuletzt verankert wurde.
 */
function uhrSpiegeln(sprecher: Sprecheraufruf): void {
  const angehalten = sprecher.pausedSecondsLeft !== undefined
  if (angehalten === zuletztAngehalten) return
  zuletztAngehalten = angehalten
  if (!state.folgtDemAufruf || !gefolgteRede || gefolgteRede !== state.speech?.id) return

  if (angehalten) {
    setze({ running: false, pausedSecondsLeft: sprecher.pausedSecondsLeft })
    logger.info('Prompter: Redezeit angehalten — der Lauf ruht.')
  } else {
    setze({
      running: state.laufart === 'auto',
      until: sprecher.until,
      pausedSecondsLeft: undefined
    })
    logger.info('Prompter: Redezeit läuft weiter — der Lauf auch.')
  }
}

/** Setzt alles zurück — nach der Versammlung und beim Start. */
export function resetPrompter(): PrompterViewState {
  zuletztGerufen = undefined
  gefolgteRede = undefined
  zuletztAngehalten = false
  state = {
    ...PROMPTER_VORGABE,
    serverInstanceId: state.serverInstanceId,
    updatedAt: new Date().toISOString()
  }
  return melde()
}
