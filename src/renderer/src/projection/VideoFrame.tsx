/**
 * Das laufende Video im Bild — auf jedem Gerät derselbe Stand.
 *
 * ## Warum hier gerechnet und nicht befohlen wird
 *
 * Der Zustand sagt nicht „spiel jetzt ab", sondern „bei Sekunde 42, gemessen
 * um 17:03:11". Diese Komponente rechnet daraus aus, wo sie stehen müsste, und
 * gleicht die Abweichung aus. Ein Gerät, das erst in der Mitte dazukommt,
 * macht dasselbe wie alle anderen — es braucht keinen Sonderweg und keine
 * verpasste Nachricht.
 *
 * ## Warum nachgeführt und nicht gesprungen wird
 *
 * Ein Sprung ist sichtbar: Das Bild ruckelt, der Ton knackt. Kleine
 * Abweichungen werden deshalb über die Abspielgeschwindigkeit ausgeglichen —
 * zwei Prozent hört und sieht niemand, holen aber in wenigen Sekunden eine
 * Zehntelsekunde auf. Erst darüber wird gesprungen.
 *
 * ## Warum der Ton nur an einer Stelle laufen darf
 *
 * Ein Saal mit zehn Tablets, die denselben Film im Chor tönen, ist
 * unerträglich — und selbst Millisekunden Versatz klingen wie ein Echo. Ton
 * gibt es deshalb nur dort, wo die Ansicht ihn ausdrücklich bekommt: im
 * Beamerfenster. Geräte im Netz bleiben stumm.
 */
import { useEffect, useRef, type JSX } from 'react'
import { berechneGleichlauf, type ProjectionVideo } from '@shared/video'

interface Props {
  video: ProjectionVideo
  /** Woher die Datei kommt: eigenes Schema im Fenster, Serverpfad im Netz. */
  src: string
  /**
   * Darf dieses Gerät den Ton wiedergeben?
   *
   * Nur der Beamer bekommt ihn. Die Netzwerkansicht ist ausdrücklich stumm —
   * siehe oben.
   */
  audio?: boolean
  /** Meldet die aus der Datei gelesene Laufzeit zurück. */
  onDuration?: (seconds: number) => void
  /** Meldet, dass genug gepuffert ist, um ohne Stocken zu beginnen. */
  onReady?: () => void
  /** Meldet, dass das Video durchgelaufen ist. */
  onEnded?: () => void
}

/** Wie oft der Stand geprüft wird. Vier Mal je Sekunde reicht und kostet nichts. */
const PRUEFTAKT_MS = 250

export function VideoFrame({ video, src, audio, onDuration, onReady, onEnded }: Props): JSX.Element {
  const element = useRef<HTMLVideoElement>(null)
  const bereitGemeldet = useRef(false)

  /* Ein neues Video heißt: neu puffern, neu melden. */
  useEffect(() => {
    bereitGemeldet.current = false
  }, [video.id])

  /* Laufen oder stehen — dem Element sagen, was der Zustand verlangt. */
  useEffect(() => {
    const v = element.current
    if (!v) return
    if (video.playing && v.paused) {
      /*
       * `play()` kann abgelehnt werden, wenn der Browser die Wiedergabe ohne
       * Zutun eines Menschen nicht erlaubt. Im Beamerfenster passiert das
       * nicht; in einem fremden Browser im Netz schon. Der Fehler wird
       * geschluckt: Der nächste Prüftakt versucht es erneut, und bis dahin
       * steht das Bild still statt zu flackern.
       */
      void v.play().catch(() => undefined)
    } else if (!video.playing && !v.paused) {
      v.pause()
    }
  }, [video.playing, video.id])

  /* Der Gleichlauf: regelmäßig prüfen und ausgleichen. */
  useEffect(() => {
    const v = element.current
    if (!v) return

    const pruefe = (): void => {
      if (!Number.isFinite(v.currentTime)) return
      /*
       * **Weiterlaufen, wenn der Zustand es sagt.**
       *
       * Das Anstoßen hängt sonst am Wechsel von `playing` — und am Ende einer
       * Dauerschleife wechselt der nicht: Der Zustand sagt durchgehend
       * „läuft", das Element ist trotzdem stehengeblieben, weil der Film zu
       * Ende war. Ohne diese Zeile spränge das Bild zurück auf Sekunde null
       * und bliebe dort stehen.
       */
      if (video.playing && v.paused) void v.play().catch(() => undefined)
      const lauf = berechneGleichlauf(video, v.currentTime, Date.now())
      if (lauf.springen) {
        v.currentTime = lauf.soll
        v.playbackRate = 1
        return
      }
      if (v.playbackRate !== lauf.tempo) v.playbackRate = lauf.tempo
    }

    pruefe()
    const takt = window.setInterval(pruefe, PRUEFTAKT_MS)
    return () => {
      window.clearInterval(takt)
      /* Beim Aufräumen die Geschwindigkeit zurücksetzen, sonst bliebe sie am
         Element hängen und das nächste Video liefe minimal schief. */
      v.playbackRate = 1
    }
  }, [video])

  return (
    <video
      ref={element}
      className="projection-video"
      src={src}
      /* Der Beamer hat den Ton, alles andere bleibt stumm. */
      muted={!audio || video.muted}
      playsInline
      /*
       * `auto` statt `metadata`: Es soll vorausgepuffert werden, bevor jemand
       * auf Start drückt. Genau dafür liefert der Server Bereichsanfragen aus.
       */
      preload="auto"
      onLoadedMetadata={(event) => {
        const dauer = event.currentTarget.duration
        if (Number.isFinite(dauer) && dauer > 0) onDuration?.(dauer)
      }}
      onCanPlayThrough={() => {
        /* Nur einmal je Video melden — das Ereignis kommt nach jedem Puffern
           erneut, und der Zähler in der Bedienung soll Geräte zählen, nicht
           Ereignisse. */
        if (bereitGemeldet.current) return
        bereitGemeldet.current = true
        onReady?.()
      }}
      onEnded={() => onEnded?.()}
    />
  )
}
