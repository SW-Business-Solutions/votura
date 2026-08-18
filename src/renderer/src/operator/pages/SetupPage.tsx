/** Ersteinrichtung: erstes Administratorkonto anlegen (§55). */
import { useState } from 'react'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card, Field } from '../components/ui'
import logo from '../../assets/logo.svg'
import logoHell from '../../assets/logo-dunkelmodus.svg'

export function SetupPage(): React.JSX.Element {
  const app = useApp()
  const [username, setUsername] = useState('wahlleitung')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (password !== repeat) {
      app.notify('error', 'Die beiden Passwörter stimmen nicht überein.')
      return
    }
    setBusy(true)
    try {
      await api('system.createFirstAdmin', { username, displayName, password })
      app.notify('ok', 'Administratorkonto angelegt. Bitte melden Sie sich jetzt an.')
      await app.refreshAll()
    } catch (error) {
      app.reportError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center-screen">
      <img className="brand-logo hell start" src={logoHell} alt="Votura" />
      <img className="brand-logo dunkel start" src={logo} alt="Votura" />
      <Card title="Ersteinrichtung">
        <p>
          Die Anwendung arbeitet vollständig lokal und offline. Legen Sie zuerst ein Konto für die
          Administration an; weitere Konten für Wahlleitung, Wahlkommission und Protokoll können
          anschließend in den Einstellungen ergänzt werden.
        </p>
        <Field label="Benutzername">
          <input value={username} onChange={(inputEvent) => setUsername(inputEvent.target.value)} autoFocus />
        </Field>
        <Field label="Anzeigename" hint="Erscheint im Audit-Trail und auf Protokollen.">
          <input value={displayName} onChange={(inputEvent) => setDisplayName(inputEvent.target.value)} />
        </Field>
        <Field label="Passwort" hint="Mindestens 8 Zeichen.">
          <input
            type="password"
            value={password}
            onChange={(inputEvent) => setPassword(inputEvent.target.value)}
          />
        </Field>
        <Field label="Passwort wiederholen">
          <input
            type="password"
            value={repeat}
            onChange={(inputEvent) => setRepeat(inputEvent.target.value)}
            onKeyDown={(keyEvent) => keyEvent.key === 'Enter' && void submit()}
          />
        </Field>
        <button className="primary wide big" disabled={busy || password.length < 8} onClick={() => void submit()}>
          Konto anlegen
        </button>
      </Card>
    </div>
  )
}
