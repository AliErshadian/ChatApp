import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger-ghost' | 'link';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  'danger-ghost': 'btn-danger-ghost',
  link: 'btn-link',
};

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[VARIANT_CLASS[variant], 'ui-btn', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
