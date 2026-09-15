/**
 * Bibliothek der eingespeisten Videos, samt Wiedergabesteuerung.
 *
 * Einspeisen, umbenennen, löschen — und das eine auswählen, das auf den Beamer
 * soll. Anders als bei Präsentationen gehört die Steuerung hierher und nicht
 * in ein eigenes Fenster: Ein Film wird gestartet, angehalten und
 * gelegentlich vorgespult, mehr nicht. Ein zweites Fenster dafür wäre ein
 * Fenster zu viel.
 *
 * ## Was die Zeitanzeige zeigt
 *
 * Nicht den Stand eines einzelnen Geräts, sondern den **Sollstand** aus der
 * Uhr im Zustand. Das ist die Zahl, an der sich alle Bildschirme ausrichten —
 * und damit die einzige, die für die Bedienung etwas aussagt.
 */
import { Fragment, useEffect, useRef, useState, type JSX } from 'react'
import type { VideoInfo } from '@shared/video'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card, RenameDialog } from './ui'

function groesse(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`
}

function zeit(sekunden: number | undefined): string {
  if (sekunden === undefined || !Number.isFinite(sekunden)) return '–:––'
  const gesamt = Math.max(0, Math.floor(sekunden))
  const std = Math.floor(gesamt / 3600)
  const min = Math.floor((gesamt % 3600) / 60)
  const sek = gesamt % 60
  const mm = String(min).padStart(std > 0 ? 2 : 1, '0')
  return `${std > 0 ? `${std}:` : ''}${mm}:${String(sek).padStart(2, '0')}`
}

export function VideoLibrary(): JSX.Element {
  const app = useApp()
  const projection = app.projection
  const [liste, setListe] = useState<VideoInfo[]>([])
  const [laeuft, setLaeuft] = useState(false)
  /* Welcher Eintrag gerade umbenannt wird. */
  const [umbenannt, setUmbenannt] = useState<VideoInfo | null>(null)
  /*
   * Die Sollposition tickt hier mit, statt auf den nächsten Zustand zu warten.
   *
   * Der Zustand wird nur bei Änderungen verschickt — bei laufendem Film wäre
   * die Anzeige sonst eingefroren, obwohl alles richtig läuft.
   */
  const [jetzt, setJetzt] = useState(() => Date.now())
  const schieber = useRef<HTMLInputElement>(null)
  const [ziehtGerade, setZiehtGerade] = useState(false)

  const video = projection.mode === 'video' ? projection.video : undefined

  const laden = (): void => {
    void api('video.list').then(setListe).catch(app.reportError)
  }

  useEffect(laden, [])
  /* Sobald die Laufzeit gemeldet ist, zeigt die Liste sie. */
  useEffect(() => {
    if (projection.mode === 'video') laden()
  }, [projection.video?.durationSeconds])

  useEffect(() => {
    if (!video?.playing) return
    const takt = window.setInterval(() => setJetzt(Date.now()), 250)
    return () => window.clearInterval(takt)
  }, [video?.playing])

  const position = video
    ? Math.min(
        video.durationSeconds ?? Number.POSITIVE_INFINITY,
        video.position + (video.playing ? Math.max(0, (jetzt - video.anchoredAt) / 1000) : 0)
      )
    : 0

  const einspeisen = async (): Promise<void> => {
    setLaeuft(true)
    try {
      const neu = await api('video.import')
      if (neu) laden()
    } catch (fehler) {
      app.reportError(fehler)
    } finally {
      setLaeuft(false)
    }
  }

  const zeigen = async (id: string): Promise<void> => {
    try {
      await api('projection.setMode', { mode: 'video', videoId: id }, app.ziel)
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  const umbenennen = async (eintrag: VideoInfo, name: string): Promise<void> => {
    setUmbenannt(null)
    if (name === eintrag.title) return
    try {
      await api('video.rename', { id: eintrag.id, title: name })
      laden()
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  const entfernen = async (eintrag: VideoInfo): Promise<void> => {
    if (!window.confirm(`„${eintrag.title}" wirklich entfernen?`)) return
    try {
      await api('video.delete', eintrag.id)
      laden()
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  const springen = async (sekunden: number): Promise<void> => {
    try {
      await api('video.seek', sekunden, app.ziel)
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  return (
    <>
      <Card title="Videos">
        <div className="row mb-3">
          <button onClick={einspeisen} disabled={laeuft}>
            {laeuft ? 'Wird eingespeist …' : 'Video einspeisen'}
          </button>
        </div>

        {video && (
          <div className="notice mb-3">
            <div className="row" style={{ alignItems: 'center', gap: 10 }}>
              <button
                className="primary"
                onClick={() => void api('video.setPlaying', !video.playing, app.ziel).catch(app.reportError)}
              >
                {video.playing ? '⏸ Anhalten' : '▶ Abspielen'}
              </button>
              <button onClick={() => void springen(Math.max(0, position - 10))}>− 10 s</button>
              <button onClick={() => void springen(position + 10)}>+ 10 s</button>
              <button
                onClick={() => void api('video.setMuted', !video.muted, app.ziel).catch(app.reportError)}
              >
                {video.muted ? '🔇 Ton aus' : '🔊 Ton an'}
              </button>
              {/*
                Die Dauerschleife für den Willkommensfilm und die Pause. Sie
                wirkt erst am Ende: Wer sie mitten im Film einschaltet, will,
                dass es danach weitergeht — nicht, dass es jetzt von vorn
                beginnt.
              */}
              <button
                className={video.schleife ? 'primary' : ''}
                title={
                  video.schleife ? 'Der Film beginnt am Ende von vorn.' : 'Der Film bleibt am Ende stehen.'
                }
                onClick={() =>
                  void api('video.setSchleife', !video.schleife, app.ziel).catch(app.reportError)
                }
              >
                {video.schleife ? '🔁 Dauerschleife' : '🔁 Einmal'}
              </button>
              <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                {zeit(position)} / {zeit(video.durationSeconds)}
              </span>
            </div>

            <input
              ref={schieber}
              type="range"
              min={0}
              max={video.durationSeconds ?? 0}
              step={0.1}
              value={ziehtGerade ? undefined : Math.min(position, video.durationSeconds ?? position)}
              disabled={video.durationSeconds === undefined}
              className="wide mt-3"
              onMouseDown={() => setZiehtGerade(true)}
              onChange={(event) => {
                /* Während des Ziehens nur die Marke bewegen: Jede Zwischenstufe
                 an alle Geräte zu schicken, ließe das Bild zappeln. */
                if (!ziehtGerade) void springen(Number(event.target.value))
              }}
              onMouseUp={(event) => {
                setZiehtGerade(false)
                void springen(Number(event.currentTarget.value))
              }}
            />

            <div className="hint mt-2">
              <strong>{video.title}</strong> — alle Bildschirme richten sich nach dieser Zeit.
              {video.readyCount > 0 && ` Der Beamer hat genug gepuffert.`}
              {video.durationSeconds === undefined &&
                ' Die Laufzeit steht fest, sobald der Beamer die Datei angefasst hat.'}
            </div>
          </div>
        )}

        {liste.length === 0 ? (
          <div className="hint">Noch kein Video eingespeist.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Video</th>
                <th>Länge</th>
                <th>Größe</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((eintrag) => (
                /* Wie bei den Präsentationen: Die Knöpfe stehen unter dem
                 Eintrag, nicht in einer schmalen Spalte daneben. */
                <Fragment key={eintrag.id}>
                  <tr className={video?.id === eintrag.id ? 'active' : undefined}>
                    <td>
                      <strong>{eintrag.title}</strong>
                      {video?.id === eintrag.id && (
                        <span className="badge accent badge-nach">auf dem Beamer</span>
                      )}
                      <div className="hint">{eintrag.fileName}</div>
                    </td>
                    <td>{zeit(eintrag.durationSeconds)}</td>
                    <td>{groesse(eintrag.size)}</td>
                  </tr>
                  <tr className={`aktionen${video?.id === eintrag.id ? ' active' : ''}`}>
                    <td colSpan={3}>
                      <div className="row">
                        <button onClick={() => void zeigen(eintrag.id)} disabled={video?.id === eintrag.id}>
                          Auf den Beamer
                        </button>
                        <button className="ghost" onClick={() => setUmbenannt(eintrag)}>
                          Umbenennen
                        </button>
                        <button className="ghost danger" onClick={() => void entfernen(eintrag)}>
                          Entfernen
                        </button>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        )}

        <div className="hint mt-3">
          Alle Bildschirme laufen nach derselben Uhr: Der Zustand nennt die Position zu einem Zeitpunkt, jedes
          Gerät rechnet sich daraus seinen Stand aus — auch eines, das erst mitten im Film dazukommt. Kleine
          Abweichungen werden über die Abspielgeschwindigkeit ausgeglichen, größere durch einen Sprung.{' '}
          <strong>Den Ton gibt nur der Beamer aus</strong>; Geräte im Netz laufen stumm mit, sonst entstünde
          ein Echo im Saal.
        </div>
      </Card>

      {umbenannt && (
        <RenameDialog
          title="Video umbenennen"
          label="Name"
          value={umbenannt.title}
          onCancel={() => setUmbenannt(null)}
          onConfirm={(name) => void umbenennen(umbenannt, name)}
        />
      )}
    </>
  )
}
