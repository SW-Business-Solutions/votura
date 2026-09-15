/** Einstellungen: Drucker, Konfiguration, Benutzer, Backup (§12, §55, §56, §81). */
import { useState } from 'react'
import { useApp } from '../state'
import { Card, Tabs } from '../components/ui'
import { AllgemeinEinstellungen } from './AllgemeinEinstellungen'
import { BackupEinstellungen } from './BackupEinstellungen'
import { BenutzerEinstellungen } from './BenutzerEinstellungen'
import { DruckerEinstellungen } from './DruckerEinstellungen'
import { KameraEinstellungen } from './KameraEinstellungen'
import { ProjectionDesign } from './ProjectionDesign'
import { NetzwerkEinstellungen } from './NetzwerkEinstellungen'
import { SaalnetzEinstellungen } from './SaalnetzEinstellungen'
import { SprachmodellEinstellungen } from './SprachmodellEinstellungen'

/** Die Reiter der Einstellungen — einmal beschrieben, nicht fünfmal getippt. */
/**
 * Die Reiter der Einstellungen.
 *
 * **Die Reihenfolge ist keine Laune.** Sie geht vom Allgemeinen zum
 * Besonderen und endet bei der Wartung: erst wer wir sind und wie wir
 * arbeiten, dann die Geräte in der Reihenfolge, in der man sie im Saal
 * aufbaut (Drucker, Beamer, Pult), dann das Netz, zuletzt Konten und
 * Sicherung.
 *
 * Vorher stand „Drucker" an erster Stelle und „Allgemein" dahinter — als
 * wäre ein Bondrucker das Erste, was man an einer Versammlungssoftware
 * einstellt.
 */
const EINSTELLUNGS_REITER = [
  { id: 'general', label: 'Allgemein' },
  { id: 'printers', label: 'Drucker' },
  { id: 'beamer', label: 'Beamer' },
  { id: 'prompter', label: 'Prompter' },
  { id: 'kameras', label: 'Kameras' },
  { id: 'netzwerk', label: 'Netzwerk' },
  { id: 'saalnetz', label: 'Saalnetz' },
  { id: 'users', label: 'Benutzer' },
  { id: 'backup', label: 'Backup' }
] as const

export function SettingsPage(): React.JSX.Element {
  const app = useApp()
  const [tab, setTab] = useState<(typeof EINSTELLUNGS_REITER)[number]['id']>('general')

  if (!app.settings) return <Card>Einstellungen werden geladen …</Card>

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Einstellungen</h1>
          <div className="subtitle">Alle Angaben werden lokal gespeichert.</div>
        </div>
      </div>

      <Tabs eintraege={EINSTELLUNGS_REITER} aktiv={tab} aufWahl={setTab} />

      {tab === 'printers' && <DruckerEinstellungen />}
      {tab === 'general' && <AllgemeinEinstellungen />}
      {tab === 'beamer' && <ProjectionDesign />}
      {tab === 'netzwerk' && <NetzwerkEinstellungen />}
      {tab === 'saalnetz' && <SaalnetzEinstellungen />}
      {tab === 'prompter' && <SprachmodellEinstellungen />}
      {tab === 'kameras' && <KameraEinstellungen />}
      {tab === 'users' && <BenutzerEinstellungen />}
      {tab === 'backup' && <BackupEinstellungen />}
    </>
  )
}
