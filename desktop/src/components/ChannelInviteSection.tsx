import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { buildChannelInviteLink } from '../utils/channelInvite';
import { copyTextToClipboard } from '../utils/clipboard';

interface Props {
  conversationId: string;
}

export function ChannelInviteSection({ conversationId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inviteLink, setInviteLink] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [copyError, setCopyError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');

    api
      .getChannelInvite(conversationId)
      .then(({ token }) => {
        if (!cancelled) setInviteLink(buildChannelInviteLink(token));
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load invite link');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const handleCopy = async () => {
    if (!inviteLink) return;
    setCopyError('');
    try {
      await copyTextToClipboard(inviteLink, inputRef.current);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError('Could not copy link');
    }
  };

  return (
    <section className="profile-section">
      <h4>Invite Link</h4>
      <p className="channel-invite-hint">
        Share this RELAY link. Others can paste it or open it to join the channel.
      </p>
      {loading ? (
        <p className="contacts-hint">Loading invite link...</p>
      ) : loadError ? (
        <p className="profile-error-inline">{loadError}</p>
      ) : (
        <>
          <div className="channel-invite-row">
            <input
              ref={inputRef}
              className="channel-invite-input"
              value={inviteLink}
              readOnly
              onFocus={(e) => e.target.select()}
              aria-label="Channel invite link"
            />
            <button type="button" className="contact-action-btn primary" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {copyError && <p className="profile-error-inline">{copyError}</p>}
        </>
      )}
    </section>
  );
}
