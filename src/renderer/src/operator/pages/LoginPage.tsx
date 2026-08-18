/** Anmeldung. Lokale Konten, keine Netzwerkanmeldung (§55). */
import { useState } from 'react'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card, Field } from '../components/ui'
import logo from '../../assets/logo.svg'
import logoHell from '../../assets/logo-dunkelmodus.svg'

export function LoginPage(): React.JSX.Element {
  const app = useApp()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await api('auth.login', { username, password })
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
      <Card title="Anmeldung">
        {app.notices.map((notice) => (
          <div key={notice.id} className={`notice ${notice.level === 'error' ? 'error' : ''}`}>
            {notice.message}
          </div>
        ))}
        <Field label="Benutzername">
          <input
            value={username}
            onChange={(inputEvent) => setUsername(inputEvent.target.value)}
            autoFocus
            autoComplete="off"
          />
        </Field>
        <Field label="Passwort">
          <input
            type="password"
            value={password}
            onChange={(inputEvent) => setPassword(inputEvent.target.value)}
            onKeyDown={(keyEvent) => keyEvent.key === 'Enter' && void submit()}
          />
        </Field>
        <button className="primary wide big" disabled={busy || !username || !password} onClick={() => void submit()}>
          Anmelden
        </button>
      </Card>
    </div>
  )
}
