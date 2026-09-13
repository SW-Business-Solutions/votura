/**
 * Bibliothek der eingespeisten Präsentationen.
 *
 * Einspeisen, umbenennen, löschen — und die eine auswählen, die auf den
 * Beamer soll. Der Aufruf schaltet die Projektion um; zurück zum Wahlgang
 * geht es mit jeder anderen Schaltfläche auf dieser Seite.
 */
import { useEffect, useState, type JSX } from 'react'
import { presentationKind, type PresentationInfo, type PrompterWindowState } from '@shared/presentation'
import { api, bridge } from '../../lib/api'
import { useApp } from '../state'
import { Card } from './ui'

function groesse(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function PresentationLibrary(): JSX.Element {
  const app = useApp()
  const projection = app.projection
  const [liste, setListe] = useState<PresentationInfo[]>([])
  const [prompter, setPrompter] = useState<PrompterWindowState>({ open: false })
  const [laeuft, setLaeuft] = useState(false)

  const laden = (): void => {
    void api('presentation.list').then(setListe).catch(app.reportError)
    void api('presentation.prompterState').then(setPrompter).catch(app.reportError)
  }

  useEffect(laden, [])

  /*
   * Das Fenster der Vortragssteuerung lässt sich auch über sein eigenes Kreuz
   * schließen. Ohne dieses Abonnement behielte die Bedienung ihren alten Stand
   * und böte „schließen" für ein Fenster an, das längst zu ist — man musste
   * erst schließen, um wieder öffnen zu können.
   */
  useEffect(() => bridge.onPrompterState(setPrompter), [])
  /* Nach jedem Folienwechsel steht die Folienzahl fest — die Liste zeigt sie. */
  useEffect(() => {
    if (projection.mode === 'presentation') laden()
  }, [projection.presentation?.slideCount])

  const einspeisen = async (): Promise<void> => {
    setLaeuft(true)
    try {
      const neu = await api('presentation.import')
      if (neu) laden()
    } catch (fehler) {
      app.reportError(fehler)
    } finally {
      setLaeuft(false)
    }
  }

  const zeigen = async (id: string): Promise<void> => {
    try {
      await api('projection.setMode', { mode: 'presentation', presentationId: id }, app.buehne)
      /*
       * Die Vortragssteuerung öffnet sich mit.
       *
       * Wer eine Präsentation auf den Beamer holt, will sie durchblättern —
       * und das Fenster dafür von Hand zu suchen, während der Saal schon auf
       * die erste Folie schaut, ist eine Handbewegung zu viel.
       */
      if (!prompter.open) setPrompter(await api('presentation.openPrompter'))
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  const umbenennen = async (eintrag: PresentationInfo): Promise<void> => {
    const name = window.prompt('Neuer Name der Präsentation', eintrag.title)
    if (name === null || name.trim() === eintrag.title) return
    try {
      await api('presentation.rename', { id: eintrag.id, title: name })
      laden()
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  const entfernen = async (eintrag: PresentationInfo): Promise<void> => {
    if (!window.confirm(`„${eintrag.title}" entfernen? Die Datei wird gelöscht.`)) return
    try {
      await api('presentation.delete', eintrag.id)
      laden()
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  const prompterUmschalten = async (): Promise<void> => {
    try {
      setPrompter(
        prompter.open
          ? await api('presentation.closePrompter')
          : await api('presentation.openPrompter')
      )
    } catch (fehler) {
      app.reportError(fehler)
    }
  }

  const laufendeId = projection.presentation?.id

  return (
    <Card title="Präsentationen">
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button onClick={() => void einspeisen()} disabled={laeuft}>
          {laeuft ? 'Wird eingespeist …' : 'Präsentation einspeisen (HTML oder PDF)'}
        </button>
        <button onClick={() => void prompterUmschalten()}>
          {prompter.open ? 'Vortragssteuerung schließen' : 'Vortragssteuerung öffnen'}
        </button>
      </div>

      {liste.length === 0 ? (
        <p className="muted">
          Noch nichts eingespeist. Erwartet wird eine <strong>einzelne HTML-Datei</strong>, die alles
          mitbringt — Schriften, Bilder und Steuerung darin. Sie läuft dann ohne Netz und ohne
          zweites Programm.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Präsentation</th>
              <th>Art</th>
              <th>Folien</th>
              <th>Größe</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {liste.map((eintrag) => {
              const laufend = eintrag.id === laufendeId && projection.mode === 'presentation'
              return (
                <tr key={eintrag.id} className={laufend ? 'active' : undefined}>
                  <td>
                    <strong>{eintrag.title}</strong>
                    {laufend && <span className="badge accent" style={{ marginLeft: 8 }}>auf dem Beamer</span>}
                    <div className="muted small">{eintrag.fileName}</div>
                  </td>
                  <td>{presentationKind(eintrag) === 'pdf' ? 'PDF' : 'HTML'}</td>
                  <td>{eintrag.slideCount ?? '–'}</td>
                  <td>{groesse(eintrag.size)}</td>
                  <td className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => void zeigen(eintrag.id)} disabled={laufend}>
                      Auf den Beamer
                    </button>
                    <button className="ghost" onClick={() => void umbenennen(eintrag)}>
                      Umbenennen
                    </button>
                    <button className="ghost danger" onClick={() => void entfernen(eintrag)}>
                      Entfernen
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <p className="muted small" style={{ marginTop: 10 }}>
        Ein <strong>HTML-Foliensatz</strong> läuft in einem abgeschotteten Rahmen: Er sieht weder
        Wahldaten noch die Oberfläche und kann nichts nachladen. Ein <strong>PDF</strong> zeichnet
        Votura selbst — ohne Werkzeugleiste, ohne Blätterleiste. Auf dem Beamer und in der
        Netzwerkansicht erscheint in beiden Fällen dieselbe Folie.
      </p>
      <p className="hint">
        <strong>PowerPoint:</strong> dort über <em>Datei → Exportieren → PDF/XPS erstellen</em>
        speichern und die PDF-Datei hier einspeisen. Schriften und Layout bleiben originalgetreu;
        Animationen und Folienübergänge gehen verloren — die überstehen keine Umwandlung.
      </p>
    </Card>
  )
}
