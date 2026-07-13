import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { FontAwesomeIconProps } from '@fortawesome/react-fontawesome';

type IconProps = {
  icon: IconDefinition;
  className?: string;
  title?: string;
} & Omit<FontAwesomeIconProps, 'icon' | 'className' | 'title'>;

/** Thin wrapper so all UI icons share Font Awesome consistently. */
export function Icon({ icon, className, title, ...rest }: IconProps) {
  return (
    <FontAwesomeIcon
      icon={icon}
      className={['fa-icon', className].filter(Boolean).join(' ')}
      title={title}
      aria-hidden={title ? undefined : true}
      {...rest}
    />
  );
}
