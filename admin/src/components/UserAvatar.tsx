import { useStorageUrl } from '../utils/storageUrl';

interface Props {
  name: string;
  avatarUrl?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function UserAvatar({ name, avatarUrl, size = 'md', className = '' }: Props) {
  const src = useStorageUrl(avatarUrl);
  const sizeClass = size === 'sm' ? 'user-avatar-sm' : '';

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`user-avatar ${sizeClass} ${className}`.trim()}
      />
    );
  }

  return (
    <div className={`user-avatar user-avatar-fallback ${sizeClass} ${className}`.trim()}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
