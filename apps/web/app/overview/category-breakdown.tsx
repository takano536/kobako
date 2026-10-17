import type { CSSProperties } from 'react';
import type { ExpenseCategoryTotal } from '@kobako/db';
import { CategoryDot } from '../../src/lib/category';
import { expenseBarWidth, formatExpenseShare } from '../../src/lib/format';
import { SignedYen } from '../_components/ui';
import styles from './category-breakdown.module.css';

export type ExpenseCategoryTotals = ExpenseCategoryTotal[];

interface CategoryBreakdownProps {
  categories: ExpenseCategoryTotals;
  totalExpense: string;
  month: string;
}

export function CategoryBreakdown({ categories, totalExpense, month }: CategoryBreakdownProps) {
  if (categories.length === 0) {
    return <p className={styles.empty}>この月の支出はありません。</p>;
  }

  return (
    <ul key={month} className={styles.list} data-month={month} aria-label="支出カテゴリ別の一覧">
      {categories.map((category) => {
        const categoryWidth = expenseBarWidth(category.total, totalExpense);
        return (
          <li
            className={styles.item}
            key={category.categoryId}
            style={{ '--category-width': `${categoryWidth}%` } as CSSProperties}
          >
            <div className={styles.row}>
              <div className={styles['name-cell']}>
                <CategoryDot type="expense" name={category.categoryName} className={styles.dot} />
                <span data-slot="category-name" className={styles.name}>
                  {category.categoryName}
                </span>
              </div>
              <span className={styles.bar} aria-hidden="true">
                <span />
              </span>
              <span className={styles.amount}>
                <SignedYen value={category.total} tone="negative" />
              </span>
              <small className={styles.share}>
                {formatExpenseShare(category.total, totalExpense)}
              </small>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
