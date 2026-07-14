import { useState } from 'react';
import { Message, MessagePoll as PollData } from '../services/api';
import { api } from '../services/api';

interface Props {
  message: Message;
  isOwn: boolean;
  canInteract: boolean;
  onUpdated: (message: Message) => void;
}

export function MessagePoll({ message, isOwn, canInteract, onUpdated }: Props) {
  const poll = message.poll;
  const [busyOptionId, setBusyOptionId] = useState<string | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [error, setError] = useState('');

  if (!poll) {
    return <div className="message-content">{message.content}</div>;
  }

  const totalForBars = Math.max(poll.totalVotes, 1);
  const showResults = poll.resultsVisible;

  const handleVote = async (optionId: string) => {
    if (!canInteract || poll.closed || busyOptionId) return;
    setBusyOptionId(optionId);
    setError('');
    try {
      const updated = await api.votePoll(message.conversationId, poll.id, optionId);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to vote');
    } finally {
      setBusyOptionId(null);
    }
  };

  const handleClose = async () => {
    if (!poll.canClose || closeBusy) return;
    setCloseBusy(true);
    setError('');
    try {
      const updated = await api.closePoll(message.conversationId, poll.id);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close poll');
    } finally {
      setCloseBusy(false);
    }
  };

  return (
    <div className={`message-poll${isOwn ? ' own' : ''}`}>
      <div className="message-poll-question">{poll.question}</div>
      <ul className="message-poll-options">
        {poll.options.map((option) => {
          const pct = showResults
            ? Math.round((option.voteCount / totalForBars) * 100)
            : 0;
          return (
            <li key={option.id}>
              <button
                type="button"
                className={[
                  'message-poll-option',
                  option.votedByMe ? 'selected' : '',
                  showResults ? 'with-results' : '',
                  poll.closed ? 'closed' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!canInteract || poll.closed || Boolean(busyOptionId)}
                onClick={() => void handleVote(option.id)}
                aria-pressed={option.votedByMe}
              >
                {showResults && (
                  <span
                    className="message-poll-option-bar"
                    style={{ width: `${pct}%` }}
                    aria-hidden
                  />
                )}
                <span className="message-poll-option-mark" aria-hidden>
                  {poll.allowsMultiple ? (
                    <span className={`poll-check${option.votedByMe ? ' on' : ''}`} />
                  ) : (
                    <span className={`poll-radio${option.votedByMe ? ' on' : ''}`} />
                  )}
                </span>
                <span className="message-poll-option-text">{option.text}</span>
                {showResults && (
                  <span className="message-poll-option-pct">{pct}%</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="message-poll-meta">
        <span>
          {poll.totalVoters === 1 ? '1 vote' : `${poll.totalVoters} votes`}
          {poll.anonymous ? ' · Anonymous' : ''}
          {poll.allowsMultiple ? ' · Multiple choice' : ''}
          {poll.closed ? ' · Closed' : ''}
        </span>
        {poll.canClose && (
          <button
            type="button"
            className="message-poll-close"
            onClick={() => void handleClose()}
            disabled={closeBusy}
          >
            {closeBusy ? 'Closing…' : 'Close Poll'}
          </button>
        )}
      </div>
      {error && <p className="message-poll-error">{error}</p>}
    </div>
  );
}

export type { PollData };
