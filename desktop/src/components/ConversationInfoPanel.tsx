import { useEffect, useMemo, useState } from 'react';
import { api, Conversation, User } from '../services/api';
import { Avatar } from './Avatar';
import { ContactInfoPrompt } from './ContactInfoPrompt';
import { ChatDeleteSection } from './ChatDeleteSection';
import { ChannelInviteSection } from './ChannelInviteSection';
import { ChannelLeaveSection } from './ChannelLeaveSection';
import { usePresence } from '../context/PresenceContext';

interface Props {
  conversation: Conversation;
  currentUserId: string;
  onClose: () => void;
  isContact?: boolean;
  contactPromptIgnored?: boolean;
  contactActionBusy?: boolean;
  onAddContact?: () => void;
  onIgnoreContact?: () => void;
  onDeleteChat?: (scope: 'me' | 'everyone') => void;
  onLeaveChannel?: (newOwnerId?: string) => void;
  deleteChatBusy?: boolean;
}

function formatDate(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function ConversationInfoPanel({
  conversation,
  currentUserId,
  onClose,
  isContact = true,
  contactPromptIgnored = false,
  contactActionBusy = false,
  onAddContact,
  onIgnoreContact,
  onDeleteChat,
  onLeaveChannel,
  deleteChatBusy = false,
}: Props) {
  const { getPresence, refreshPresence } = usePresence();
  const isDirect = conversation.type === 'direct';
  const otherMember = conversation.members.find((m) => m.userId !== currentUserId);
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(isDirect);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isDirect || !otherMember) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    api
      .getUser(otherMember.userId)
      .then(setProfile)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load profile'),
      )
      .finally(() => setLoading(false));
  }, [conversation.id, isDirect, otherMember?.userId]);

  const presenceUserIds = useMemo(() => {
    if (isDirect && otherMember) return [otherMember.userId];
    return conversation.members.map((member) => member.userId);
  }, [conversation.members, isDirect, otherMember?.userId]);

  useEffect(() => {
    refreshPresence(presenceUserIds);
  }, [presenceUserIds, refreshPresence]);

  return (
    <div className="conversation-info-panel">
      <header className="conversation-info-header">
        <button className="icon-btn back-btn" onClick={onClose} aria-label="Back to chat">
          ←
        </button>
        <h3>{isDirect ? 'Contact Info' : 'Channel Info'}</h3>
      </header>

      <div className="conversation-info-content">
        {isDirect ? (
          loading ? (
            <div className="profile-loading">Loading profile...</div>
          ) : error ? (
            <div className="profile-error">{error}</div>
          ) : profile ? (
            <>
              <div className="profile-hero">
                <Avatar
                  name={profile.displayName}
                  avatarUrl={profile.avatarUrl}
                  size="lg"
                  presence={otherMember ? getPresence(otherMember.userId) : undefined}
                />
                <h2>{profile.displayName}</h2>
                <p className="profile-username">@{profile.username}</p>
              </div>

              {!isContact && onAddContact && onIgnoreContact && (
                <ContactInfoPrompt
                  displayName={profile.displayName}
                  ignored={contactPromptIgnored}
                  busy={contactActionBusy}
                  onAdd={onAddContact}
                  onIgnore={onIgnoreContact}
                />
              )}

              <section className="profile-section">
                <h4>Details</h4>
                <dl className="profile-details">
                  <div className="profile-detail-row">
                    <dt>Username</dt>
                    <dd>@{profile.username}</dd>
                  </div>
                  <div className="profile-detail-row">
                    <dt>Display Name</dt>
                    <dd>{profile.displayName}</dd>
                  </div>
                  <div className="profile-detail-row">
                    <dt>Member Since</dt>
                    <dd>{formatDate(profile.createdAt)}</dd>
                  </div>
                </dl>
              </section>

              {onDeleteChat && (
                <ChatDeleteSection
                  description={
                    isDirect
                      ? 'Remove this conversation from your list or delete messages you sent for everyone.'
                      : 'Remove this channel from your list or delete messages you sent for everyone.'
                  }
                  busy={deleteChatBusy}
                  onDeleteChat={onDeleteChat}
                />
              )}
            </>
          ) : null
        ) : (
          <>
            <div className="profile-hero">
              <div className="profile-avatar-lg channel-avatar">#</div>
              <h2>{conversation.name}</h2>
              <p className="profile-username">Channel</p>
            </div>

            {conversation.description && (
              <section className="profile-section">
                <h4>Description</h4>
                <p className="channel-description">{conversation.description}</p>
              </section>
            )}

            <ChannelInviteSection conversationId={conversation.id} />

            <section className="profile-section">
              <h4>Members ({conversation.members.length})</h4>
              <ul className="member-list">
                {conversation.members.map((member) => (
                  <li key={member.userId} className="member-list-item">
                    <Avatar
                      name={member.displayName ?? member.username ?? '?'}
                      avatarUrl={member.avatarUrl}
                      size="sm"
                      presence={getPresence(member.userId)}
                    />
                    <div className="member-list-info">
                      <span className="member-list-name">
                        {member.displayName ?? 'Unknown'}
                        {member.userId === currentUserId && ' (You)'}
                      </span>
                      <span className="member-list-username">@{member.username}</span>
                    </div>
                    <span className="member-role">{member.role}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="profile-section">
              <h4>Channel Info</h4>
              <dl className="profile-details">
                <div className="profile-detail-row">
                  <dt>Created</dt>
                  <dd>{formatDate(conversation.createdAt)}</dd>
                </div>
              </dl>
            </section>

            {onLeaveChannel && (
              <ChannelLeaveSection
                conversation={conversation}
                currentUserId={currentUserId}
                busy={deleteChatBusy}
                onLeave={onLeaveChannel}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
