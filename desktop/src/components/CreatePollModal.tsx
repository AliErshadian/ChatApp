import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (input: {
    question: string;
    options: string[];
    anonymous: boolean;
    allowsMultiple: boolean;
  }) => void | Promise<void>;
}

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

export function CreatePollModal({ open, busy = false, error = '', onClose, onSubmit }: Props) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [anonymous, setAnonymous] = useState(false);
  const [allowsMultiple, setAllowsMultiple] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuestion('');
    setOptions(['', '']);
    setAnonymous(false);
    setAllowsMultiple(false);
    setLocalError('');
  }, [open]);

  if (!open) return null;

  const trimmedOptions = options.map((o) => o.trim()).filter(Boolean);
  const canSubmit =
    question.trim().length > 0 &&
    trimmedOptions.length >= MIN_OPTIONS &&
    !busy;

  const updateOption = (index: number, value: string) => {
    setOptions((prev) => prev.map((item, i) => (i === index ? value : item)));
  };

  const addOption = () => {
    setOptions((prev) => (prev.length >= MAX_OPTIONS ? prev : [...prev, '']));
  };

  const removeOption = (index: number) => {
    setOptions((prev) => (prev.length <= MIN_OPTIONS ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) {
      setLocalError('Enter a question');
      return;
    }
    if (trimmedOptions.length < MIN_OPTIONS) {
      setLocalError('Add at least two options');
      return;
    }
    setLocalError('');
    await onSubmit({
      question: question.trim(),
      options: trimmedOptions,
      anonymous,
      allowsMultiple,
    });
  };

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal create-poll-modal"
        role="dialog"
        aria-labelledby="create-poll-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem',
          }}
        >
          <h3 id="create-poll-title">Create poll</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className="create-poll-form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="create-poll-field">
            <span>Question</span>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Which framework?"
              maxLength={500}
              autoFocus
              disabled={busy}
            />
          </label>

          <div className="create-poll-options">
            <span className="create-poll-label">Options</span>
            {options.map((option, index) => (
              <div key={index} className="create-poll-option-row">
                <input
                  value={option}
                  onChange={(e) => updateOption(index, e.target.value)}
                  placeholder={`Option ${index + 1}`}
                  maxLength={200}
                  disabled={busy}
                />
                {options.length > MIN_OPTIONS && (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => removeOption(index)}
                    aria-label={`Remove option ${index + 1}`}
                    disabled={busy}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {options.length < MAX_OPTIONS && (
              <button type="button" className="link-btn" onClick={addOption} disabled={busy}>
                Add option
              </button>
            )}
          </div>

          <label className="create-poll-toggle">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
              disabled={busy}
            />
            <span>Anonymous</span>
          </label>

          <label className="create-poll-toggle">
            <input
              type="checkbox"
              checked={allowsMultiple}
              onChange={(e) => setAllowsMultiple(e.target.checked)}
              disabled={busy}
            />
            <span>Multiple choice</span>
          </label>

          {(localError || error) && (
            <p className="composer-error">{localError || error}</p>
          )}

          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!canSubmit}>
              {busy ? 'Creating…' : 'Create poll'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
