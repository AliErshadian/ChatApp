interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  radius?: 'sm' | 'md' | 'lg' | 'pill' | 'circle';
  style?: React.CSSProperties;
}

function toCssSize(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
}

export function Skeleton({ className, width, height, radius = 'md', style }: SkeletonProps) {
  return (
    <span
      className={['skeleton', `skeleton--${radius}`, className].filter(Boolean).join(' ')}
      style={{ width: toCssSize(width), height: toCssSize(height), ...style }}
      aria-hidden="true"
    />
  );
}

export function SkeletonListRows({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-list" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-list-row">
          <Skeleton radius="circle" width={36} height={36} />
          <div className="skeleton-list-row-text">
            <Skeleton width={`${58 + ((i * 11) % 28)}%`} height={12} />
            <Skeleton width={`${42 + ((i * 7) % 30)}%`} height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonProfile() {
  return (
    <div className="skeleton-profile" role="status" aria-label="Loading profile">
      <Skeleton radius="circle" width={88} height={88} className="skeleton-profile-avatar" />
      <Skeleton width="42%" height={18} />
      <Skeleton width="28%" height={12} />
      <div className="skeleton-profile-block">
        <Skeleton width="100%" height={44} radius="md" />
        <Skeleton width="100%" height={120} radius="md" />
      </div>
    </div>
  );
}

export function SkeletonAppBoot() {
  return (
    <div className="loading loading--skeleton" role="status" aria-label="Loading">
      <div className="skeleton-boot">
        <Skeleton radius="circle" width={48} height={48} />
        <Skeleton width={160} height={14} />
        <Skeleton width={110} height={10} />
      </div>
    </div>
  );
}
