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
  redeWoerter,
  type Laufart,
  type PrompterAnsicht,
  type PrompterViewState
} from '@shared/speech'
import type { UUID } from '@shared/types'
import { getSpeech } from './speeches'

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
  if (!id) return setze({ speech: undefined, position: 0, laenge: 0, running: false })
  const rede = getSpeech(id)
  if (!rede) throw new Error('Diese Rede gibt es nicht.')
  return setze({
    speech: { id: rede.id, title: rede.title, markdown: rede.markdown },
    laenge: redeWoerter(rede.markdown),
    position: 0,
    running: false
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
    laenge: redeWoerter(rede.markdown)
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
  aenderung: Partial<
    Pick<
      PrompterViewState,
      'schrift' | 'spiegel' | 'breite' | 'leselinie' | 'zeigeUhr' | 'bedienbar'
    >
  >
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
  return setze({ until }, false)
}

/** Setzt alles zurück — nach der Versammlung und beim Start. */
export function resetPrompter(): PrompterViewState {
  state = { ...PROMPTER_VORGABE, serverInstanceId: state.serverInstanceId, updatedAt: new Date().toISOString() }
  return melde()
}
