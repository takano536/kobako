import styles from './card-skeleton.module.css';
import skeletonStyles from './skeleton.module.css';

const DEFAULT_FIELD_ROWS = 4;

/**
 * カードの中身が届くまでの骨組みです。カードの枠は先に描画されるため、ここでは入力欄と
 * 同じ高さの行だけを置き、本文が届いたときの高さの移動を抑えます。
 */
export function CardSkeleton({ label }: { label: string }) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <CardSkeletonFields />
    </div>
  );
}

/** 入力欄の行と送信ボタンの骨組みです。読み上げは呼び出し側の `role="status"` が担います。 */
export function CardSkeletonFields({ fields = DEFAULT_FIELD_ROWS }: { fields?: number }) {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: fields }, (_, index) => (
        <span className={styles.row} key={index}>
          <span className={`${skeletonStyles.bone} ${styles.label}`} />
          <span className={`${skeletonStyles.bone} ${styles.control}`} />
        </span>
      ))}
      <span className={styles.actions}>
        <span className={`${skeletonStyles.bone} ${styles.button}`} />
      </span>
    </div>
  );
}
