/** Kleine, wiederverwendete Bausteine der Operator-Oberfläche. */
import { useEffect, useState, type ReactNode } from 'react'
import { ROUND_STATUS_LABELS, type RoundStatus } from '@shared/types'
import { istAdresse } from '@shared/netz'

export function Tabs<T extends string>({
  eintraege,
  aktiv,
  aufWahl
}: {
  eintraege: readonly { id: T; label: string }[]
  aktiv: T
  aufWahl: (id: T) => void
}): React.JSX.Element {
  return (
    <div className="tabs">
      {eintraege.map((eintrag) => (
        <button
          key={eintrag.id}
          className={`tab${aktiv === eintrag.id ? ' active' : ''}`}
          onClick={() => aufWahl(eintrag.id)}
        >
          {eintrag.label}
        </button>
      ))}
    </div>
  )
}

export function Card({
  title,
  actions,
  children,
  tight
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  tight?: boolean
}): React.JSX.Element {
  return (
    <section className={`card${tight ? ' tight' : ''}`}>
      {(title || actions) && (
        <div className="card-title">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="field-inline">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(sourceEvent) => onChange(sourceEvent.target.checked)}
      />
      <label onClick={() => !disabled && onChange(!checked)}>{label}</label>
    </div>
  )
}

export function StatusBadge({ status }: { status: RoundStatus }): React.JSX.Element {
  const tone =
    status === 'completed'
      ? 'ok'
      : status === 'cancelled'
        ? 'danger'
        : status === 'open' || status === 'printing'
          ? 'accent'
          : status === 'ready'
            ? 'ok'
            : 'warn'
  return <span className={`badge ${tone}`}>{ROUND_STATUS_LABELS[status]}</span>
}

export function Modal({
  title,
  children,
  onClose,
  actions,
  wide
}: {
  title: string
  children: ReactNode
  onClose: () => void
  actions?: ReactNode
  wide?: boolean
}): React.JSX.Element {
  useEffect(() => {
    const handler = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(clickEvent) => clickEvent.target === clickEvent.currentTarget && onClose()}
    >
      <div
        className="modal"
        style={wide ? { width: 'min(940px, 100%)' } : undefined}
        role="dialog"
        aria-modal="true"
      >
        <h2>{title}</h2>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

/** Bestätigungsdialog mit Pflichtbegruendung, wo die Spezifikation sie verlangt. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  requireReason,
  onConfirm,
  onCancel
}: {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  requireReason?: boolean
  onConfirm: (reason: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [reason, setReason] = useState('')
  return (
    <Modal
      title={title}
      onClose={onCancel}
      actions={
        <>
          <button onClick={onCancel}>Abbrechen</button>
          <button
            className={danger ? 'danger' : 'primary'}
            disabled={requireReason && reason.trim().length < 3}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div>{message}</div>
      {requireReason && (
        <Field label="Begründung (wird im Audit-Trail festgehalten)">
          <textarea value={reason} onChange={(inputEvent) => setReason(inputEvent.target.value)} autoFocus />
        </Field>
      )}
    </Modal>
  )
}

export function EmptyState({ text, action }: { text: string; action?: ReactNode }): React.JSX.Element {
  return (
    <div style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--text-muted)' }}>
      <p>{text}</p>
      {action}
    </div>
  )
}

export function Kpi({
  label,
  value,
  tone
}: {
  label: string
  value: ReactNode
  tone?: string
}): React.JSX.Element {
  return (
    <div className="kpi">
      <span className="value" style={tone ? { color: `var(--${tone})` } : undefined}>
        {value}
      </span>
      <span className="label">{label}</span>
    </div>
  )
}

/** Zahlenfeld, das leere Eingaben zulaesst, ohne den Wert zu verfaelschen. */
/**
 * Ein Zahlenfeld, das keine unmöglichen Zahlen durchlässt.
 *
 * **Was vorher schieflief.** `min` und `max` standen nur als Attribute da —
 * das hält kein Browser bei getippten Eingaben durch. Eine Stückzahl von −5,
 * ein Port 70000 oder eine Sitzungsdauer von 0 Minuten wurden anstandslos
 * angenommen und erst vom Dienst abgewiesen, wenn überhaupt.
 *
 * **Warum nicht beim Tippen begrenzt wird.** Wer bei einem Port mit
 * Mindestwert 1024 die erste Ziffer tippt, hätte sonst sofort 1024 im Feld
 * stehen und käme nie zu 8477. Begrenzt wird deshalb beim Verlassen des
 * Feldes; bis dahin steht da, was getippt wurde, sichtbar als unzulässig.
 *
 * **Und ein leeres Feld bleibt leer.** Vorher sprang es auf 0, sobald man den
 * Inhalt löschte, um eine andere Zahl zu tippen — man musste die 0 erst
 * wieder wegräumen.
 */
/**
 * Ein Feld für eine Netzwerkadresse.
 *
 * **Warum es das braucht.** Diese Felder gingen bisher als freier Text
 * durch — ein Tippfehler wie `192.168.50.` oder `192.168.500.1` wurde
 * gespeichert und fiel erst im Saal auf, wenn ein Dienst nicht startet oder
 * ein Gerät keine Adresse bekommt. Das ist die Sorte Fehler, die man um 19 Uhr
 * nicht sucht.
 *
 * Getippt wird frei — sonst käme man nie über die erste Ziffer hinaus —, aber
 * eine unfertige oder unmögliche Adresse ist sofort als solche zu sehen.
 */
export function AdressFeld({
  value,
  onChange,
  placeholder,
  optional
}: {
  value: string
  onChange: (wert: string) => void
  placeholder?: string
  optional?: boolean
}): React.JSX.Element {
  const leer = value.trim() === ''
  const unzulaessig = leer ? !optional : !istAdresse(value)
  return (
    <input
      value={value}
      placeholder={placeholder}
      inputMode="decimal"
      spellCheck={false}
      aria-invalid={unzulaessig || undefined}
      title={
        unzulaessig
          ? leer
            ? 'Hier fehlt eine Adresse.'
            : 'Das ist keine gültige Adresse — erwartet werden vier Zahlen von 0 bis 255, etwa 192.168.50.1.'
          : undefined
      }
      onChange={(ereignis) => onChange(ereignis.target.value.trim())}
    />
  )
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  disabled
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  disabled?: boolean
}): React.JSX.Element {
  const [text, setText] = useState(String(value))
  const [tippt, setTippt] = useState(false)

  /* Solange niemand tippt, zeigt das Feld, was von außen kommt. */
  useEffect(() => {
    if (!tippt) setText(String(value))
  }, [value, tippt])

  const zahl = Number.parseInt(text, 10)
  const unzulaessig = text.trim() !== '' && (!Number.isFinite(zahl) || zahl < min || (max !== undefined && zahl > max))

  return (
    <input
      type="number"
      inputMode="numeric"
      value={text}
      min={min}
      max={max}
      disabled={disabled}
      aria-invalid={unzulaessig || undefined}
      title={unzulaessig ? `Zulässig ist ${min}${max !== undefined ? ` bis ${max}` : ' oder mehr'}.` : undefined}
      onFocus={() => setTippt(true)}
      onChange={(ereignis) => {
        setText(ereignis.target.value)
        const getippt = Number.parseInt(ereignis.target.value, 10)
        /* Zwischenstände werden weitergereicht, solange sie zulässig sind —
           sonst stünde die Vorschau daneben still. */
        if (Number.isFinite(getippt) && getippt >= min && (max === undefined || getippt <= max)) {
          onChange(getippt)
        }
      }}
      onBlur={() => {
        setTippt(false)
        const getippt = Number.parseInt(text, 10)
        const gueltig = Number.isFinite(getippt)
          ? Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, getippt))
          : value
        setText(String(gueltig))
        if (gueltig !== value) onChange(gueltig)
      }}
    />
  )
}
