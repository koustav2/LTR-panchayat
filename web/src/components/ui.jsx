import { Children, cloneElement, isValidElement, useEffect, useId, useRef } from 'react';

export function Field({ label, required, hint, error, children, className = '' }) {
  const autoId = useId();
  const describedBy = `${autoId}-desc`;
  const hasMessage = Boolean(error || hint);

  // Wire the label to the control with htmlFor/id so screen readers announce it
  // and tapping the label focuses the input. The id is injected into the single
  // child rather than demanded from every call site.
  let control = children;
  const only = Children.count(children) === 1 ? Children.only(children) : null;
  if (only && isValidElement(only) && typeof only.type === 'string') {
    control = cloneElement(only, {
      id: only.props.id || autoId,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': hasMessage ? describedBy : undefined,
    });
  }

  return (
    <div className={`field ${error ? 'invalid' : ''} ${className}`}>
      {label && (
        <label htmlFor={autoId}>
          {label} {required && <span className="req">*</span>}
        </label>
      )}
      {control}
      {error ? (
        <div className="err" id={describedBy}>{error}</div>
      ) : hint ? (
        <div className="hint" id={describedBy}>{hint}</div>
      ) : null}
    </div>
  );
}

export function YesNo({ value, onChange, name }) {
  return (
    <div className="yesno" role="group" aria-label={name}>
      <button type="button" className="yes" aria-pressed={value === 'yes'} onClick={() => onChange('yes')}>
        Yes
      </button>
      <button type="button" className="no" aria-pressed={value === 'no'} onClick={() => onChange('no')}>
        No
      </button>
    </div>
  );
}

export function StatusBadge({ status }) {
  const label = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected' }[status] || status;
  return <span className={`badge ${status}`}>{label}</span>;
}

export function Banner({ kind = 'info', icon, children }) {
  const defaultIcon = { info: 'i', success: '✓', warn: '!', error: '!' }[kind];
  return (
    <div className={`banner ${kind}`}>
      <span className="ico" aria-hidden="true">{icon || defaultIcon}</span>
      <div>{children}</div>
    </div>
  );
}

export function Empty({ icon = '□', title, children }) {
  return (
    <div className="empty">
      <div className="big" aria-hidden="true">{icon}</div>
      <div style={{ fontWeight: 600, color: '#334155', marginBottom: 4 }}>{title}</div>
      {children && <div style={{ fontSize: 14 }}>{children}</div>}
    </div>
  );
}

export function Skeletons({ count = 4 }) {
  return (
    <div className="rows">
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}

export function Modal({ title, description, children, onClose, actions }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Formats a date the way people in the field read it: 25 August 2026. */
export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  if (!withTime) return date;
  return `${date}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * Desktop-only page heading. Hidden below 1024px, where the mobile top bar
 * carries the title instead. Lives here rather than in App.jsx so that pages
 * can import it without creating a cycle (App imports every page).
 */
export function DeskHead({ crumb, title, children }) {
  return (
    <div className="desk-head">
      <div>
        {crumb && <div className="crumb">{crumb}</div>}
        <h2>{title}</h2>
      </div>
      <div className="spacer" />
      {children}
    </div>
  );
}

/**
 * Rupees in Indian digit grouping — 12,50,000 rather than 1,250,000.
 * `compact` drops the paise, which is what totals and list rows want.
 */
export function formatMoney(value, { compact = true } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
  }).format(n);
}
