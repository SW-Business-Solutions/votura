/**
 * Fernzugriff: Anmeldung, Sitzungsbindung und Absicherung.
 *
 * Geprüft wird das, worauf es sicherheitstechnisch ankommt: ohne gültige
 * Sitzung geht nichts, Rechte gelten wie am Hauptrechner, jede Aktion wird dem
 * angemeldeten Benutzer zugeordnet, und Fehlversuche werden gebremst.
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'wahlzettel-remote-'))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => join(root, name), getVersion: () => '0.1.0-test' },
  dialog: { showErrorBox: () => undefined },
  ipcMain: { handle: () => undefined },
  BrowserWindow: class {},
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ id: 0 }) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined },
  shell: { openExternal: () => undefined },
  session: { defaultSession: {} },
  Menu: { setApplicationMenu: () => undefined }
}))

const { initDatabase, db } = await import('../src/main/db')
const { initLogger } = await import('../src/main/logger')
const auth = await import('../src/main/services/auth')
const audit = await import('../src/main/services/audit')
const remote = await import('../src/main/remote-access')

/** Minimale Nachbildung der Node-HTTP-Objekte. */
class FakeRequest extends EventEmitter {
  headers: Record<string, string> = {}
  socket = { remoteAddress: '192.168.1.50' }
  constructor(
    public method: string,
    public url: string,
    private body?: unknown
  ) {
    super()
  }

  send(): void {
    if (this.body !== undefined) this.emit('data', Buffer.from(JSON.stringify(this.body)))
    this.emit('end')
  }
}

class FakeResponse {
  status = 0
  headers: Record<string, string | string[]> = {}
  body = ''
  headersSent = false

  setHeader(name: string, value: string | string[]): void {
    this.headers[name] = value
  }
  writeHead(status: number, headers?: Record<string, string | string[]>): void {
    this.status = status
    this.headersSent = true
    Object.assign(this.headers, headers ?? {})
  }
  end(body?: string): void {
    this.body = body ?? ''
  }
  get json(): { ok: boolean; data?: unknown; error?: string } {
    return JSON.parse(this.body || '{}')
  }
}

type Dispatcher = (method: string, args: unknown[]) => Promise<unknown>

async function call(
  method: string,
  path: string,
  options: { body?: unknown; token?: string; dispatch?: Dispatcher } = {}
): Promise<FakeResponse> {
  const request = new FakeRequest(method, path, options.body)
  if (options.token) request.headers.authorization = `Bearer ${options.token}`
  const response = new FakeResponse()
  const url = new URL(path, 'http://192.168.1.10:8477')

  const handled = remote.handleRemoteRequest(
    request as never,
    response as never,
    url,
    options.dispatch ?? (async () => 'ok')
  )
  request.send()
  await handled
  return response
}

beforeAll(() => {
  initLogger(join(root, 'logs'))
  initDatabase(join(root, 'data', 'remote.sqlite'))
  db()
    .prepare(
      `INSERT INTO users (id, username, display_name, password_hash, role, active, created_at)
       VALUES ('u1', 'kommission', 'Wahlkommission', ?, 'WAHLKOMMISSION', 1, ?)`
    )
    .run(auth.hashSecret('sehr-geheim-123'), new Date().toISOString())
})

describe('Fernzugriff', () => {
  let token = ''

  it('weist Aufrufe ohne Anmeldung ab', async () => {
    const response = await call('POST', '/api/remote/call', { body: { method: 'event.list', args: [] } })
    expect(response.status).toBe(401)
    expect(response.json.ok).toBe(false)
  })

  it('weist falsche Zugangsdaten ab und protokolliert das', async () => {
    const response = await call('POST', '/api/remote/login', {
      body: { username: 'kommission', password: 'falsch' }
    })
    expect(response.status).toBe(401)
    expect(audit.listAudit({ limit: 20 }).some((entry) => entry.action === 'auth.login_failed')).toBe(true)
  })

  it('meldet ein Gerät mit gültigen Zugangsdaten an', async () => {
    const response = await call('POST', '/api/remote/login', {
      body: { username: 'kommission', password: 'sehr-geheim-123' }
    })
    expect(response.status).toBe(200)
    const data = response.json.data as { token: string; session: { user: { role: string } } }
    expect(data.token).toHaveLength(43)
    expect(data.session.user.role).toBe('WAHLKOMMISSION')
    token = data.token

    // Die Anmeldung wird mit Herkunft im Audit festgehalten.
    const login = audit.listAudit({ limit: 20 }).find((entry) => entry.action === 'auth.login')
    expect(login?.reason).toContain('Netzwerk')
  })

  it('führt Aufrufe im Sitzungskontext des angemeldeten Benutzers aus', async () => {
    let seen: string | undefined
    const response = await call('POST', '/api/remote/call', {
      token,
      body: { method: 'irgendwas', args: [] },
      dispatch: async () => {
        // Innerhalb des Aufrufs sieht der Dienst genau diese Sitzung.
        seen = auth.requireSession().user.username
        return { fertig: true }
      }
    })
    expect(response.json.ok).toBe(true)
    expect(seen).toBe('kommission')
  })

  it('setzt die Rechte der Rolle auch aus der Ferne durch', async () => {
    const response = await call('POST', '/api/remote/call', {
      token,
      body: { method: 'system.saveConfig', args: [] },
      dispatch: async () => {
        // Die Wahlkommission darf keine Systemeinstellungen ändern.
        auth.requirePermission('system.manage')
        return null
      }
    })
    expect(response.json.ok).toBe(false)
    expect(response.json.error).toMatch(/darf diese Aktion nicht/i)
  })

  it('lässt Systemdialoge des Hauptrechners nicht aus der Ferne auslösen', async () => {
    for (const method of ['system.chooseDirectory', 'system.chooseImage', 'system.saveCopy']) {
      const response = await call('POST', '/api/remote/call', { token, body: { method, args: [] } })
      expect(response.status).toBe(403)
    }
  })

  it('gibt die eigene Sitzung zurück', async () => {
    const response = await call('GET', '/api/remote/session', { token })
    expect(response.json.ok).toBe(true)
    expect((response.json.data as { user: { username: string } }).user.username).toBe('kommission')
  })

  it('beendet die Sitzung beim Abmelden', async () => {
    expect(remote.remoteSessionCount()).toBe(1)
    await call('POST', '/api/remote/logout', { token })
    expect(remote.remoteSessionCount()).toBe(0)

    const response = await call('POST', '/api/remote/call', { token, body: { method: 'x', args: [] } })
    expect(response.status).toBe(401)
  })

  it('bremst wiederholte Fehlversuche', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await call('POST', '/api/remote/login', { body: { username: 'kommission', password: 'falsch' } })
    }
    const response = await call('POST', '/api/remote/login', {
      body: { username: 'kommission', password: 'sehr-geheim-123' }
    })
    expect(response.status).toBe(429)
    expect(response.json.error).toMatch(/Fehlversuche/i)
  })
})
