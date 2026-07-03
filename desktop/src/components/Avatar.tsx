import { resolveAvatarUrl, getInitials } from '../utils/avatar';
import type { AvatarPresence } from '../services/realtime';

interface Props {
  name: string;
  avatarUrl?: string;
  size?: 'sm' | 'lg';
  className?: string;
  presence?: AvatarPresence;
}

export function Avatar({ name, avatarUrl, size = 'sm', className = '', presence }: Props) {
  const src = resolveAvatarUrl(avatarUrl);
  const sizeClass = size === 'lg' ? 'profile-avatar-lg' : 'profile-avatar-sm';

  const avatar = src ? (
    <img src={src} alt="" className={`profile-avatar-img ${sizeClass} ${className}`.trim()} />
  ) : (
    <div className={`${sizeClass} ${className}`.trim()}>{getInitials(name)}</div>
  );

  if (presence === undefined) return avatar;

  return (
    <span className={`avatar-with-presence avatar-with-presence--${size}`}>
      {avatar}
      <span
        className={`avatar-presence-dot avatar-presence-dot--${presence}`}
        aria-label={presence === 'online' ? 'Online' : 'Offline'}
      />
    </span>
  );
}
