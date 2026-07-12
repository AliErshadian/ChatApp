import { ReactNode, useState } from 'react';

interface Props {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  children,
  className = '',
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`panel collapsible-panel ${className}`.trim()}>
      <button
        type="button"
        className="collapsible-header"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <div className="collapsible-header-text">
          <h2>{title}</h2>
          {summary && <div className="collapsible-summary">{summary}</div>}
        </div>
        <span className="collapsible-chevron" aria-hidden>
          {open ? '−' : '+'}
        </span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </section>
  );
}
