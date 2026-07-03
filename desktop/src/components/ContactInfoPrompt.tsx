interface Props {
  displayName: string;
  ignored: boolean;
  busy?: boolean;
  onAdd: () => void;
  onIgnore: () => void;
}

export function ContactInfoPrompt({
  displayName,
  ignored,
  busy = false,
  onAdd,
  onIgnore,
}: Props) {
  return (
    <section className="contact-info-prompt">
      <div className="contact-info-prompt-card">
        <div className="contact-info-prompt-icon" aria-hidden>
          👤
        </div>
        <div className="contact-info-prompt-body">
          <p className="contact-info-prompt-title">
            {ignored ? 'Add to contacts' : 'Not in your contacts'}
          </p>
          <p className="contact-info-prompt-desc">
            {ignored
              ? `You can still add ${displayName} to your contacts.`
              : `Add ${displayName} to find and message them easily.`}
          </p>
          <div className="contact-info-prompt-actions">
            {!ignored && (
              <button
                type="button"
                className="contact-action-btn"
                onClick={onIgnore}
                disabled={busy}
              >
                Ignore
              </button>
            )}
            <button
              type="button"
              className="contact-action-btn primary"
              onClick={onAdd}
              disabled={busy}
            >
              {busy ? 'Adding...' : 'Add contact'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
