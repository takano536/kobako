import { PrefetchLink } from './prefetch-link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import styles from './button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

const variantClasses: Record<ButtonVariant, string> = {
  primary: styles.button!,
  secondary: `${styles.button!} ${styles.buttonSecondary!}`,
  quiet: `${styles.button!} ${styles.buttonQuiet!}`,
  danger: `${styles.button!} ${styles.buttonDanger!}`,
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      data-slot="button"
      data-variant={variant}
      className={[variantClasses[variant], className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}

export function LinkButton({
  href,
  variant = 'primary',
  className,
  children,
  icon,
  scroll,
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
  icon?: ReactNode;
  scroll?: boolean;
}) {
  const variantClass = variantClasses[variant]
    .replaceAll(styles.button!, styles.linkButton!)
    .replace(styles.buttonDanger!, styles.linkButtonDanger!)
    .replace(styles.buttonSecondary!, styles.linkButtonSecondary!)
    .replace(styles.buttonQuiet!, styles.linkButtonQuiet!);
  return (
    <PrefetchLink
      data-slot="button-link"
      className={[variantClass, className].filter(Boolean).join(' ')}
      href={href}
      scroll={scroll}
      data-variant={variant}
    >
      {icon ? (
        <span className={styles.linkIcon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </PrefetchLink>
  );
}
