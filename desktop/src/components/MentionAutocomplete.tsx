import { useEffect, useMemo, useState } from 'react';
import { Avatar } from './Avatar';
import { filterMentionCandidates } from '../utils/mentions';

interface MentionMember {
  userId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

interface Props {
  open: boolean;
  members: MentionMember[];
  currentUserId: string;
  query: string;
  onSelect: (member: MentionMember) => void;
  onClose: () => void;
}

export function MentionAutocomplete({
  open,
  members,
  currentUserId,
  query,
  onSelect,
  onClose,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);

  const candidates = useMemo(
    () => filterMentionCandidates(members, currentUserId, query),
    [members, currentUserId, query],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (candidates.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % candidates.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        onSelect(candidates[activeIndex]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, candidates, activeIndex, onClose, onSelect]);

  if (!open || candidates.length === 0) return null;

  return (
    <div className="mention-autocomplete" role="listbox" aria-label="Mention suggestions">
      {candidates.map((member, index) => (
        <button
          key={member.userId}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={['mention-autocomplete-item', index === activeIndex && 'active']
            .filter(Boolean)
            .join(' ')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(member)}
        >
          <Avatar
            name={member.displayName ?? member.username ?? 'User'}
            avatarUrl={member.avatarUrl}
            size="sm"
          />
          <span className="mention-autocomplete-text">
            <strong>{member.displayName ?? member.username}</strong>
            {member.username && member.displayName ? (
              <span className="mention-autocomplete-username">@{member.username}</span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}
