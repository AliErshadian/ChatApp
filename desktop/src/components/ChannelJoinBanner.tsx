interface Props {
  channelName: string;
  busy?: boolean;
  onJoin: () => void;
  onDecline: () => void;
}

export function ChannelJoinBanner({
  channelName,
  busy = false,
  onJoin,
  onDecline,
}: Props) {
  return (
    <div className="channel-join-banner">
      <div className="channel-join-banner-body">
        <p className="channel-join-banner-title">
          Join <strong>#{channelName}</strong>?
        </p>
        <p className="channel-join-banner-desc">
          You were invited to this channel. Join to see messages and participate.
        </p>
        <div className="channel-join-banner-actions">
          <button
            type="button"
            className="contact-action-btn"
            onClick={onDecline}
            disabled={busy}
          >
            Not now
          </button>
          <button
            type="button"
            className="contact-action-btn primary"
            onClick={onJoin}
            disabled={busy}
          >
            {busy ? 'Joining...' : 'Join channel'}
          </button>
        </div>
      </div>
    </div>
  );
}
