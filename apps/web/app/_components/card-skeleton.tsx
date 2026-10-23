import styles from './card-skeleton.module.css';

const FIELD_ROWS = 4;

/**
 * カードの中身が届くまでの骨組みです。カードの枠は先に描画されるため、ここでは入力欄と
 * 同じ高さの行だけを置き、本文が届いたときの高さの移動を抑えます。
 */
export function CardSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.skeleton} role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: FIELD_ROWS }, (_, index) => (
        <span className={styles.row} key={index}>
          <span className={styles.label} aria-hidden="true" />
          <span className={styles.control} aria-hidden="true" />
        </span>
      ))}
      <span className={styles.actions}>
        <span className={styles.button} aria-hidden="true" />
      </span>
    </div>
  );
}
