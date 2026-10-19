import { useEffect, type ReactNode } from 'react'
import { money } from '../format'

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-header">
          <h3>{title}</h3>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

/** Formats cents in `currency`, or in the home currency when omitted. */
export function Money({ cents, colored, sign, whole, currency }: { cents: number; colored?: boolean; sign?: boolean; whole?: boolean; currency?: string }) {
  const cls = colored ? (cents > 0 ? 'pos' : cents < 0 ? 'neg' : '') : ''
  return <span className={`money ${cls}`}>{money(cents, { sign, whole, currency })}</span>
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

export function Progress({ value, max, color }: { value: number; max: number; color?: string }) {
  const ratio = max > 0 ? value / max : 0
  return (
    <div className="progress">
      <div className={`progress-fill ${ratio > 1 ? 'over' : ''}`} style={{ width: `${Math.min(ratio, 1) * 100}%`, background: ratio > 1 ? undefined : color }} />
    </div>
  )
}

export function ErrorBanner({ error }: { error: string | null }) {
  return error ? <div className="banner error">{error}</div> : null
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
