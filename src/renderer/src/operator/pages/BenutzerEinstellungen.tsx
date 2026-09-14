/**
 * Benutzer und Rollen.
 *
 * Wer hier etwas ändert, ändert, wer im Saal was darf — das gehört nicht
 * zwischen Druckertreiber und Backup-Ziel.
 */
import { useEffect, useState } from 'react'
import type { Role, User } from '@shared/types'
import { ROLE_LABELS, ROLES } from '@shared/types'
import { api } from '../../lib/api'
import { useApp } from '../state'
import { Card, Field, Modal } from '../components/ui'

export function BenutzerEinstellungen(): React.JSX.Element {
  const app = useApp()
  const [users, setUsers] = useState<User[]>([])
  const [showCreate, setShowCreate] = useState(false)

  const load = async (): Promise<void> => {
    try {
      setUsers(await api('auth.listUsers'))
    } catch (error) {
      app.reportError(error)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <Card
      title="Benutzer und Rollen"
      actions={
        <button className="primary" onClick={() => setShowCreate(true)}>
          Benutzer anlegen
        </button>
      }
    >
      <table>
        <thead>
          <tr>
            <th>Benutzer</th>
            <th>Rolle</th>
            <th>PIN</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                <strong>{user.displayName}</strong>
                <br />
                <span className="hint">{user.username}</span>
              </td>
              <td>
                <select
                  value={user.role}
                  onChange={async (e) => {
                    try {
                      await api('auth.updateUser', { id: user.id, role: e.target.value as Role })
                      await load()
                    } catch (error) {
                      app.reportError(error)
                    }
                  }}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {user.hasPrintPin ? (
                  <span className="badge ok">gesetzt</span>
                ) : (
                  <span className="badge">–</span>
                )}
              </td>
              <td>
                {user.active ? (
                  <span className="badge ok">aktiv</span>
                ) : (
                  <span className="badge danger">gesperrt</span>
                )}
              </td>
              <td>
                <button
                  onClick={async () => {
                    try {
                      await api('auth.updateUser', { id: user.id, active: !user.active })
                      await load()
                    } catch (error) {
                      app.reportError(error)
                    }
                  }}
                >
                  {user.active ? 'Sperren' : 'Entsperren'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showCreate && (
        <CreateUserDialog
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false)
            await load()
          }}
        />
      )}
    </Card>
  )
}

function CreateUserDialog({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: () => Promise<void>
}): React.JSX.Element {
  const app = useApp()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('WAHLKOMMISSION')

  return (
    <Modal
      title="Benutzer anlegen"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button
            className="primary"
            disabled={!username || password.length < 8}
            onClick={async () => {
              try {
                await api('auth.createUser', { username, displayName, password, role })
                await onCreated()
              } catch (error) {
                app.reportError(error)
              }
            }}
          >
            Anlegen
          </button>
        </>
      }
    >
      <Field label="Benutzername">
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      </Field>
      <Field label="Anzeigename">
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <Field label="Passwort" hint="Mindestens 8 Zeichen.">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Rolle">
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((entry) => (
            <option key={entry} value={entry}>
              {ROLE_LABELS[entry]}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  )
}
