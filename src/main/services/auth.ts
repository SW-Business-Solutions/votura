/**
 * Lokale Benutzer, Sitzungen und Rechte (§55/§56).
 *
 * Passwörter werden mit scrypt (RFC 7914, in node:crypto enthalten) gehasht —
 * speicher-hartes Verfahren, gleichwertig zur Argon2id-Anforderung und ohne
 * native Zusatzmodule, die den Offline-Installer belasten würden.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { ROLE_PERMISSIONS, type Permission, type Role, type Session, type User, type UUID } from '@shared/types'
import { db } from '../db'
import { optionalString, toBool } from '../db/driver'
import { appendAudit } from './audit'
import { getConfig } from './settings'

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 }

interface UserRow {
  id: string
  username: string
  display_name: string
  password_hash: string
  print_pin_hash: string | null
  role: string
  active: number
  created_at: string
  last_login_at: string | null
}

export function hashSecret(secret: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(secret.normalize('NFKC'), salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p
  })
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(hashB64, 'base64')
  const derived = scryptSync(secret.normalize('NFKC'), salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  })
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role as Role,
    active: toBool(row.active),
    hasPrintPin: Boolean(row.print_pin_hash),
    createdAt: row.created_at,
    lastLoginAt: optionalString(row.last_login_at)
  }
}

export function userCount(): number {
  const row = db().prepare(`SELECT COUNT(*) AS count FROM users`).get<{ count: number }>()
  return Number(row?.count ?? 0)
}

export function listUsers(): User[] {
  return db()
    .prepare(`SELECT * FROM users ORDER BY username`)
    .all<UserRow>()
    .map(mapUser)
}

export function createUser(input: {
  username: string
  displayName: string
  password: string
  role: Role
}): User {
  const username = input.username.trim().toLowerCase()
  if (!username) throw new Error('Der Benutzername darf nicht leer sein.')
  if (input.password.length < 8) throw new Error('Das Passwort muss mindestens 8 Zeichen haben.')
  const existing = db().prepare(`SELECT id FROM users WHERE username = ?`).get<{ id: string }>(username)
  if (existing) throw new Error(`Der Benutzername "${username}" ist bereits vergeben.`)

  const id = randomUUID()
  db()
    .prepare(
      `INSERT INTO users (id, username, display_name, password_hash, role, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    )
    .run(id, username, input.displayName.trim() || username, hashSecret(input.password), input.role, new Date().toISOString())

  const user = getUser(id)
  appendAudit({
    action: 'user.created',
    userId: currentSession?.user.id,
    userName: currentSession?.user.displayName,
    newValue: { username: user.username, role: user.role }
  })
  return user
}

export function getUser(id: UUID): User {
  const row = db().prepare(`SELECT * FROM users WHERE id = ?`).get<UserRow>(id)
  if (!row) throw new Error('Benutzer nicht gefunden.')
  return mapUser(row)
}

export function updateUser(input: {
  id: UUID
  displayName?: string
  role?: Role
  active?: boolean
  password?: string
}): User {
  const before = getUser(input.id)
  if (input.displayName !== undefined) {
    db().prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run(input.displayName, input.id)
  }
  if (input.role !== undefined) {
    db().prepare(`UPDATE users SET role = ? WHERE id = ?`).run(input.role, input.id)
  }
  if (input.active !== undefined) {
    db().prepare(`UPDATE users SET active = ? WHERE id = ?`).run(input.active ? 1 : 0, input.id)
  }
  if (input.password !== undefined) {
    if (input.password.length < 8) throw new Error('Das Passwort muss mindestens 8 Zeichen haben.')
    db().prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashSecret(input.password), input.id)
  }
  const after = getUser(input.id)
  appendAudit({
    action: 'user.updated',
    userId: currentSession?.user.id,
    userName: currentSession?.user.displayName,
    previousValue: { role: before.role, active: before.active, displayName: before.displayName },
    newValue: {
      role: after.role,
      active: after.active,
      displayName: after.displayName,
      passwordChanged: input.password !== undefined
    }
  })
  return after
}

export function setPrintPin(userId: UUID, pin: string): void {
  if (!/^\d{4,12}$/.test(pin)) throw new Error('Die PIN muss aus 4 bis 12 Ziffern bestehen.')
  db().prepare(`UPDATE users SET print_pin_hash = ? WHERE id = ?`).run(hashSecret(pin), userId)
  appendAudit({ action: 'user.pin_set', userId, userName: getUser(userId).displayName })
}

export function verifyPrintPin(userId: UUID, pin: string): boolean {
  const row = db().prepare(`SELECT print_pin_hash FROM users WHERE id = ?`).get<{ print_pin_hash: string | null }>(userId)
  if (!row?.print_pin_hash) return false
  return verifySecret(pin, row.print_pin_hash)
}

/* ------------------------------------------------------------------ Session */

let currentSession: Session | null = null
let sessionListeners: ((session: Session | null) => void)[] = []

export function onSessionChanged(listener: (session: Session | null) => void): void {
  sessionListeners.push(listener)
}

function emitSession(): void {
  for (const listener of sessionListeners) listener(currentSession)
}

function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]]
}

function expiryFromNow(): string {
  const minutes = getConfig().security.sessionTimeoutMinutes
  return new Date(Date.now() + Math.max(minutes, 1) * 60_000).toISOString()
}

/**
 * Prüft Zugangsdaten und erzeugt eine Sitzung — ohne sie irgendwo zu setzen.
 * Genutzt von der lokalen Anmeldung und vom Fernzugriff.
 */
export function authenticate(username: string, password: string, origin: string): Session {
  const row = db()
    .prepare(`SELECT * FROM users WHERE username = ?`)
    .get<UserRow>(username.trim().toLowerCase())
  // Auch bei unbekanntem Benutzer rechnen, damit die Antwortzeit nichts verrät.
  const stored = row?.password_hash ?? hashSecret(randomUUID())
  const valid = verifySecret(password, stored)
  if (!row || !valid) {
    appendAudit({
      action: 'auth.login_failed',
      userName: username,
      reason: `Ungültige Zugangsdaten (${origin})`
    })
    throw new Error('Benutzername oder Passwort ist falsch.')
  }
  if (!toBool(row.active)) {
    throw new Error('Dieses Benutzerkonto ist deaktiviert.')
  }

  db().prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id)
  const user = mapUser(row)
  appendAudit({ action: 'auth.login', userId: user.id, userName: user.displayName, reason: origin })
  return { user, permissions: permissionsFor(user.role), expiresAt: expiryFromNow() }
}

export function login(username: string, password: string): Session {
  currentSession = authenticate(username, password, 'lokal')
  emitSession()
  return currentSession
}

export function logout(): void {
  if (currentSession) {
    appendAudit({
      action: 'auth.logout',
      userId: currentSession.user.id,
      userName: currentSession.user.displayName
    })
  }
  currentSession = null
  emitSession()
}

/**
 * Sitzungskontext je Aufruf.
 *
 * Der Operator am Hauptrechner arbeitet mit der lokalen Sitzung; ein Gerät im
 * Netz bringt seine eigene mit. Damit Rechteprüfungen und Audit-Einträge immer
 * dem richtigen Benutzer zugeordnet werden, läuft jeder Fernaufruf in einem
 * eigenen Kontext (er bleibt auch über `await` hinweg erhalten).
 */
interface RequestContext {
  session: Session
  onRefresh?: (session: Session) => void
}

const requestContext = new AsyncLocalStorage<RequestContext>()

export function runWithSession<T>(
  session: Session,
  onRefresh: ((session: Session) => void) | undefined,
  work: () => T
): T {
  return requestContext.run({ session, onRefresh }, work)
}

export function getSession(): Session | null {
  const remote = requestContext.getStore()
  if (remote) {
    return new Date(remote.session.expiresAt).getTime() < Date.now() ? null : remote.session
  }

  if (!currentSession) return null
  if (new Date(currentSession.expiresAt).getTime() < Date.now()) {
    appendAudit({
      action: 'auth.session_timeout',
      userId: currentSession.user.id,
      userName: currentSession.user.displayName
    })
    currentSession = null
    emitSession()
    return null
  }
  return currentSession
}

/** Verlängert die Sitzung bei Aktivität. */
export function touchSession(): Session | null {
  const session = getSession()
  if (!session) return null

  const remote = requestContext.getStore()
  if (remote) {
    const refreshed = { ...session, expiresAt: expiryFromNow() }
    remote.session = refreshed
    remote.onRefresh?.(refreshed)
    return refreshed
  }

  currentSession = { ...session, expiresAt: expiryFromNow() }
  return currentSession
}

export function requireSession(): Session {
  const session = getSession()
  if (!session) throw new Error('Die Sitzung ist abgelaufen. Bitte erneut anmelden.')
  return session
}

export function requirePermission(permission: Permission): Session {
  const session = requireSession()
  if (!session.permissions.includes(permission)) {
    throw new Error(
      `Die Rolle "${session.user.role}" darf diese Aktion nicht ausführen (erforderlich: ${permission}).`
    )
  }
  touchSession()
  return session
}

/** Prüft die Wahlleiter-PIN, sofern sie für Massendruck/Freigabe verlangt wird (§56). */
export function requirePinIfConfigured(pin: string | undefined): void {
  const config = getConfig()
  if (!config.security.requirePinForMassPrint) return
  const session = requireSession()
  const row = db()
    .prepare(`SELECT print_pin_hash FROM users WHERE id = ?`)
    .get<{ print_pin_hash: string | null }>(session.user.id)
  if (!row?.print_pin_hash) {
    throw new Error(
      'Für diesen Vorgang ist eine Wahlleiter-PIN erforderlich. Bitte zuerst in den Einstellungen eine PIN hinterlegen.'
    )
  }
  if (!pin || !verifySecret(pin, row.print_pin_hash)) {
    appendAudit({
      action: 'auth.pin_failed',
      userId: session.user.id,
      userName: session.user.displayName
    })
    throw new Error('Die eingegebene PIN ist falsch.')
  }
}

export function resetSessionForTests(): void {
  currentSession = null
  sessionListeners = []
}
