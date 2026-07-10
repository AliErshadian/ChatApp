import { useState } from 'react';

interface Props {
  value: string;
  label?: string;
}

export function CopyButton({ value, label = 'Copy' }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <button type="button" className="btn btn-ghost btn-sm copy-btn" onClick={() => void copy()}>
      {copied ? 'Copied' : label}
    </button>
  );
}
