import type { HTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';

import styles from './field.module.css';

export function Field({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.field!, className].filter(Boolean).join(' ')} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={[styles.input!, className].filter(Boolean).join(' ')} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={[styles.select!, className].filter(Boolean).join(' ')} {...props} />;
}
