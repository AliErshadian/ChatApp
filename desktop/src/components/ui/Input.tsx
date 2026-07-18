import type { InputHTMLAttributes, ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export function Input({ label, hint, error, className, id, ...rest }: InputProps) {
  const inputId = id ?? (typeof label === 'string' ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

  return (
    <label className={['ui-field', className].filter(Boolean).join(' ')}>
      {label != null && <span className="ui-field-label">{label}</span>}
      <input id={inputId} className="ui-input" {...rest} />
      {error != null && <span className="ui-field-error">{error}</span>}
      {error == null && hint != null && <span className="ui-field-hint">{hint}</span>}
    </label>
  );
}
