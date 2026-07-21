import { useEffect, useState } from 'react';
import { faPlus, faSquarePollVertical, faXmark } from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';

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
        <header className="create-poll-header">
          <div className="create-poll-header-title">
            <span className="create-poll-header-icon" aria-hidden>
              <Icon icon={faSquarePollVertical} />
            </span>
            <div>
              <h3 id="create-poll-title">Create poll</h3>
              <p className="create-poll-subtitle">Ask the group and collect votes</p>
            </div>
          </div>
          <button
            type="button"
            className="create-poll-close"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <Icon icon={faXmark} />
          </button>
        </header>

        <form className="create-poll-form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="create-poll-field">
            <span>Question</span>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What should we decide?"
              maxLength={500}
              autoFocus
              disabled={busy}
            />
          </label>

          <div className="create-poll-options">
            <div className="create-poll-options-head">
              <span className="create-poll-label">Options</span>
              <span className="create-poll-options-count">
                {options.length}/{MAX_OPTIONS}
              </span>
            </div>
            {options.map((option, index) => (
              <div key={index} className="create-poll-option-row">
                <span className="create-poll-option-index" aria-hidden>
                  {index + 1}
                </span>
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
                    className="create-poll-option-remove"
                    onClick={() => removeOption(index)}
                    aria-label={`Remove option ${index + 1}`}
                    title="Remove option"
                    disabled={busy}
                  >
                    <Icon icon={faXmark} />
                  </button>
                )}
              </div>
            ))}
            {options.length < MAX_OPTIONS && (
              <button
                type="button"
                className="create-poll-add-option"
                onClick={addOption}
                disabled={busy}
              >
                <Icon icon={faPlus} />
                Add option
              </button>
            )}
          </div>

          <div className="create-poll-toggles">
            <label className="create-poll-toggle">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
                disabled={busy}
              />
              <span className="create-poll-toggle-copy">
                <strong>Anonymous</strong>
                <small>Hide who voted for each option</small>
              </span>
            </label>

            <label className="create-poll-toggle">
              <input
                type="checkbox"
                checked={allowsMultiple}
                onChange={(e) => setAllowsMultiple(e.target.checked)}
                disabled={busy}
              />
              <span className="create-poll-toggle-copy">
                <strong>Multiple choice</strong>
                <small>Allow selecting more than one option</small>
              </span>
            </label>
          </div>

          {(localError || error) && (
            <p className="create-poll-error">{localError || error}</p>
          )}

          <div className="create-poll-actions">
            <button type="button" className="create-poll-cancel" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="create-poll-submit" disabled={!canSubmit}>
              {busy ? 'Creating…' : 'Create poll'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
