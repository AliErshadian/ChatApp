import { useEffect, useMemo, useRef, useState } from 'react';
import { api, Conversation, User } from '../services/api';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { ContactInfoPrompt } from './ContactInfoPrompt';
import { ChatDeleteSection } from './ChatDeleteSection';
import { ChannelInviteSection } from './ChannelInviteSection';
import { ChannelLeaveSection } from './ChannelLeaveSection';
import { AddParticipantsModal } from './AddParticipantsModal';
import { ConfirmModal } from './ConfirmModal';
import { usePresence } from '../context/PresenceContext';
import { canManageParticipants, getChannelOwner, isChannelOwner, sortChannelMembers } from '../utils/conversation';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';

interface Props {
  conversation: Conversation;
  currentUserId: string;
  onClose: () => void;
  onOpenFiles?: () => void;
  isContact?: boolean;
  contactPromptIgnored?: boolean;
  contactActionBusy?: boolean;
  onAddContact?: () => void;
  onIgnoreContact?: () => void;
  onDeleteChat?: (scope: 'me' | 'everyone') => void;
  onLeaveChannel?: (newOwnerId?: string) => void;
  onChannelAvatarUpdated?: (avatarUrl: string) => void;
  onMessageUser?: (user: User) => void;
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
  onOpenFiles,
  isContact = true,
  contactPromptIgnored = false,
  contactActionBusy = false,
  onAddContact,
  onIgnoreContact,
  onDeleteChat,
  onLeaveChannel,
  onChannelAvatarUpdated,
  onMessageUser,
  deleteChatBusy = false,
}: Props) {
  const { getPresence, refreshPresence } = usePresence();
  const isDirect = conversation.type === 'direct';
  const isChannel = conversation.type === 'channel';
  const isGroup = conversation.type === 'group';
  const isMultiMember = isChannel || isGroup;
  const channelOwner = isMultiMember ? getChannelOwner(conversation) : undefined;
  const canEditChannelAvatar = isMultiMember && isChannelOwner(conversation, currentUserId);
  const canAddParticipants = isGroup && canManageParticipants(conversation, currentUserId);
  const canRemoveMembers = isGroup && isChannelOwner(conversation, currentUserId);
  const channelMembers = useMemo(
    () => (isMultiMember ? sortChannelMembers(conversation) : conversation.members),
    [conversation, isMultiMember],
  );
  const otherMember = conversation.members.find((m) => m.userId !== currentUserId);
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(isDirect);
  const [error, setError] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [showAddParticipants, setShowAddParticipants] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [removeMemberBusy, setRemoveMemberBusy] = useState(false);
  const [memberActionError, setMemberActionError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleChannelAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canEditChannelAvatar) return;

    setUploadingAvatar(true);
    setAvatarError('');
    try {
      const result = await api.uploadChannelAvatar(conversation.id, file);
      onChannelAvatarUpdated?.(result.avatarUrl);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Failed to upload photo');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removingMember = removingMemberId
    ? channelMembers.find((m) => m.userId === removingMemberId)
    : undefined;

  const handleRemoveMemberConfirm = async () => {
    if (!removingMemberId) return;
    setRemoveMemberBusy(true);
    setMemberActionError('');
    try {
      await api.removeConversationMember(conversation.id, removingMemberId);
      setRemovingMemberId(null);
    } catch (err) {
      setMemberActionError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setRemoveMemberBusy(false);
    }
  };

  const openDirectChat = (member: (typeof channelMembers)[number]) => {
    if (!onMessageUser || member.userId === currentUserId) return;
    onMessageUser({
      id: member.userId,
      email: '',
      username: member.username ?? '',
      displayName: member.displayName ?? 'Unknown',
      avatarUrl: member.avatarUrl,
    });
  };

  return (
    <div className="conversation-info-panel">
      <header className="conversation-info-header">
        <button className="icon-btn back-btn" onClick={onClose} aria-label="Back to chat">
          <Icon icon={faArrowLeft} />
        </button>
        <h3>{isDirect ? 'Contact Info' : isGroup ? 'Group Info' : 'Channel Info'}</h3>
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

              {onOpenFiles && (
                <section className="profile-section">
                  <h4>Files</h4>
                  <p className="channel-invite-hint">
                    Browse photos, videos, documents, and other files shared in this chat.
                  </p>
                  <button type="button" className="btn-secondary files-section-btn" onClick={onOpenFiles}>
                    Open shared files
                  </button>
                </section>
              )}

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
              <div className="profile-avatar-wrap">
                <Avatar name={conversation.name} avatarUrl={conversation.avatarUrl} size="lg" />
                {canEditChannelAvatar && (
                  <>
                    <button
                      type="button"
                      className="avatar-upload-btn"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingAvatar}
                    >
                      {uploadingAvatar ? 'Uploading...' : 'Change photo'}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="avatar-file-input"
                      onChange={handleChannelAvatarChange}
                    />
                  </>
                )}
              </div>
              <h2>{conversation.name}</h2>
              <p className="profile-username">
                {isGroup
                  ? conversation.isPublic
                    ? 'Public group'
                    : 'Private group'
                  : 'Channel'}
              </p>
              {avatarError && <p className="profile-error-inline">{avatarError}</p>}
            </div>

            {conversation.description && (
              <section className="profile-section">
                <h4>Description</h4>
                <p className="channel-description">{conversation.description}</p>
              </section>
            )}

            {(isChannel || (isGroup && conversation.isPublic)) && (
              <ChannelInviteSection conversationId={conversation.id} />
            )}

            {onOpenFiles && (
              <section className="profile-section">
                <h4>Files</h4>
                <p className="channel-invite-hint">
                  Browse photos, videos, documents, and other files shared in this conversation.
                </p>
                <button type="button" className="btn-secondary files-section-btn" onClick={onOpenFiles}>
                  Open shared files
                </button>
              </section>
            )}

            <section className="profile-section">
              <div className="profile-section-header">
                <h4>Members ({conversation.members.length})</h4>
                {canAddParticipants && (
                  <button
                    type="button"
                    className="btn-link profile-section-action"
                    onClick={() => setShowAddParticipants(true)}
                  >
                    Add participants
                  </button>
                )}
              </div>
              <ul className="member-list">
                {channelMembers.map((member) => {
                  const canOpenDm =
                    isGroup && onMessageUser && member.userId !== currentUserId;
                  const memberInfo = (
                    <>
                      <span className="member-list-name">
                        {member.displayName ?? 'Unknown'}
                        {member.userId === currentUserId && ' (You)'}
                      </span>
                      <span className="member-list-username">@{member.username}</span>
                    </>
                  );

                  return (
                  <li key={member.userId} className="member-list-item">
                    <Avatar
                      name={member.displayName ?? member.username ?? '?'}
                      avatarUrl={member.avatarUrl}
                      size="sm"
                      presence={getPresence(member.userId)}
                    />
                    {canOpenDm ? (
                      <button
                        type="button"
                        className="member-list-info member-list-info--clickable"
                        onClick={() => openDirectChat(member)}
                        title={`Message ${member.displayName ?? member.username ?? 'member'}`}
                      >
                        {memberInfo}
                      </button>
                    ) : (
                      <div className="member-list-info">{memberInfo}</div>
                    )}
                    <div className="member-list-actions">
                      <span className={`member-role${member.role === 'owner' ? ' member-role--owner' : ''}`}>
                        {member.role}
                      </span>
                      {canRemoveMembers &&
                        member.userId !== currentUserId &&
                        member.role !== 'owner' && (
                          <button
                            type="button"
                            className="member-remove-btn"
                            onClick={() => {
                              setMemberActionError('');
                              setRemovingMemberId(member.userId);
                            }}
                            aria-label={`Remove ${member.displayName ?? 'member'}`}
                          >
                            Remove
                          </button>
                        )}
                    </div>
                  </li>
                  );
                })}
              </ul>
              {memberActionError && <p className="profile-error-inline">{memberActionError}</p>}
            </section>

            <section className="profile-section">
              <h4>{isGroup ? 'Group Info' : 'Channel Info'}</h4>
              <dl className="profile-details">
                <div className="profile-detail-row">
                  <dt>Owner</dt>
                  <dd>
                    {channelOwner
                      ? `${channelOwner.displayName ?? 'Unknown'}${channelOwner.userId === currentUserId ? ' (You)' : ''}`
                      : 'None'}
                  </dd>
                </div>
                {isGroup && (
                  <div className="profile-detail-row">
                    <dt>Visibility</dt>
                    <dd>{conversation.isPublic ? 'Public' : 'Private'}</dd>
                  </div>
                )}
                <div className="profile-detail-row">
                  <dt>Created</dt>
                  <dd>{formatDate(conversation.createdAt)}</dd>
                </div>
              </dl>
            </section>

            {isGroup && canManageParticipants(conversation, currentUserId) && (
              <GroupScreenSettingsSection conversation={conversation} />
            )}

            {onLeaveChannel && (
              <ChannelLeaveSection
                conversation={conversation}
                currentUserId={currentUserId}
                busy={deleteChatBusy}
                onLeave={onLeaveChannel}
              />
            )}

            <AddParticipantsModal
              open={showAddParticipants}
              conversationId={conversation.id}
              existingMemberIds={conversation.members.map((m) => m.userId)}
              onClose={() => setShowAddParticipants(false)}
            />

            <ConfirmModal
              open={!!removingMemberId}
              title="Remove member"
              message={
                removingMember
                  ? `Remove ${removingMember.displayName ?? 'this member'} from the group? They will no longer see group messages.`
                  : 'Remove this member from the group?'
              }
              confirmLabel="Remove"
              danger
              busy={removeMemberBusy}
              onConfirm={() => void handleRemoveMemberConfirm()}
              onCancel={() => {
                if (!removeMemberBusy) setRemovingMemberId(null);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function GroupScreenSettingsSection({ conversation }: { conversation: Conversation }) {
  const [allowed, setAllowed] = useState(conversation.screenSharingAllowed ?? true);
  const [multi, setMulti] = useState(conversation.screenAllowMultiplePresenters ?? false);
  const [maxShares, setMaxShares] = useState(conversation.screenMaxConcurrentShares ?? 1);
  const [maxParticipants, setMaxParticipants] = useState(conversation.screenMaxParticipants ?? 8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setAllowed(conversation.screenSharingAllowed ?? true);
    setMulti(conversation.screenAllowMultiplePresenters ?? false);
    setMaxShares(conversation.screenMaxConcurrentShares ?? 1);
    setMaxParticipants(conversation.screenMaxParticipants ?? 8);
  }, [conversation]);

  const save = async () => {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api.updateScreenSettings(conversation.id, {
        screenSharingAllowed: allowed,
        screenAllowMultiplePresenters: multi,
        screenMaxConcurrentShares: maxShares,
        screenMaxParticipants: maxParticipants,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="profile-section">
      <h4>Screen sharing</h4>
      <label className="toggle-row">
        <input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />
        <span>Allow screen sharing</span>
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
        <span>Allow multiple presenters</span>
      </label>
      <label className="field">
        <span>Max concurrent shares</span>
        <input
          type="number"
          min={1}
          max={10}
          value={maxShares}
          onChange={(e) => setMaxShares(Number(e.target.value))}
        />
      </label>
      <label className="field">
        <span>Max participants</span>
        <input
          type="number"
          min={2}
          max={32}
          value={maxParticipants}
          onChange={(e) => setMaxParticipants(Number(e.target.value))}
        />
      </label>
      {error && <p className="profile-error-inline">{error}</p>}
      {saved && <p className="muted">Saved.</p>}
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save screen settings'}
      </button>
    </section>
  );
}
