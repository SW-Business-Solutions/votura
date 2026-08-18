/** Kleine, wiederverwendete Bausteine der Operator-Oberfläche. */
import { useEffect, useState, type ReactNode } from 'react'
import { ROUND_STATUS_LABELS, type RoundStatus } from '@shared/types'

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
    <div className="modal-backdrop" onMouseDown={(clickEvent) => clickEvent.target === clickEvent.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(940px, 100%)' } : undefined} role="dialog" aria-modal="true">
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

export function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone?: string }): React.JSX.Element {
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
  return (
    <input
      type="number"
      inputMode="numeric"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(inputEvent) => {
        const parsed = Number.parseInt(inputEvent.target.value, 10)
        onChange(Number.isNaN(parsed) ? 0 : parsed)
      }}
    />
  )
}
