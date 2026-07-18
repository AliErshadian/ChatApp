import type { ReactNode } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { Icon } from '../Icon';

interface EmptyStateProps {
  icon?: IconDefinition;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={['empty-state', className].filter(Boolean).join(' ')}>
      {icon && (
        <div className="empty-state-icon">
          <Icon icon={icon} />
        </div>
      )}
      <h3>{title}</h3>
      {description != null && <p>{description}</p>}
      {action}
    </div>
  );
}
