import type { ReactNode } from 'react';

import formsStyles from '../forms.module.css';
import buttonStyles from './button.module.css';
import actionStyles from './form-actions.module.css';
import styles from './card-skeleton.module.css';
import skeletonStyles from './skeleton.module.css';

const DEFAULT_FIELD_ROWS = 4;

type CardFormFieldRow = {
  kind: 'field';
  label: string;
};

type CardFormAmountRow = {
  kind: 'amount';
};

type CardFormChoiceRow = {
  kind: 'choice';
  choices: readonly string[];
};

export type CardFormRow = CardFormFieldRow | CardFormAmountRow | CardFormChoiceRow;

export type CardFormActions = {
  kind: 'create' | 'edit';
  saveLabel: string;
};

type CardFormRecipe = {
  rows: readonly CardFormRow[];
  actions: CardFormActions;
};

const transactionChoice: CardFormChoiceRow = {
  kind: 'choice',
  choices: ['支出', '収入', '振替'],
};

/** カードフォームごとの実フォームの行レシピです。 */
export const CARD_FORM_RECIPES: {
  transactionNew: CardFormRecipe;
  transactionEdit: CardFormRecipe;
  transferEdit: CardFormRecipe;
  fixedCostNew: CardFormRecipe;
  fixedCostEdit: CardFormRecipe;
  accountNew: CardFormRecipe;
  accountEdit: CardFormRecipe;
} = {
  transactionNew: {
    rows: [
      transactionChoice,
      { kind: 'amount' },
      { kind: 'field', label: 'カテゴリ' },
      { kind: 'field', label: '資産' },
      { kind: 'field', label: '日付' },
      { kind: 'field', label: 'メモ（任意）' },
    ],
    actions: { kind: 'create', saveLabel: '登録する' },
  },
  transactionEdit: {
    rows: [
      transactionChoice,
      { kind: 'amount' },
      { kind: 'field', label: 'カテゴリ' },
      { kind: 'field', label: '資産' },
      { kind: 'field', label: '日付' },
      { kind: 'field', label: 'メモ（任意）' },
    ],
    actions: { kind: 'edit', saveLabel: '変更を保存' },
  },
  transferEdit: {
    rows: [
      transactionChoice,
      { kind: 'amount' },
      { kind: 'field', label: '振替元' },
      { kind: 'field', label: '振替先' },
      { kind: 'field', label: '日付' },
      { kind: 'field', label: 'メモ（任意）' },
    ],
    actions: { kind: 'edit', saveLabel: '変更を保存' },
  },
  fixedCostNew: {
    rows: [
      { kind: 'field', label: '名称' },
      { kind: 'amount' },
      { kind: 'field', label: 'カテゴリ' },
      { kind: 'field', label: '資産' },
      { kind: 'field', label: '頻度' },
      { kind: 'field', label: '日付' },
    ],
    actions: { kind: 'create', saveLabel: '登録する' },
  },
  fixedCostEdit: {
    rows: [
      { kind: 'field', label: '名称' },
      { kind: 'amount' },
      { kind: 'field', label: 'カテゴリ' },
      { kind: 'field', label: '資産' },
      { kind: 'field', label: '頻度' },
      { kind: 'field', label: '日付' },
    ],
    actions: { kind: 'edit', saveLabel: '変更を保存' },
  },
  accountNew: {
    rows: [
      { kind: 'field', label: '名前' },
      { kind: 'field', label: '資産カテゴリ' },
    ],
    actions: { kind: 'create', saveLabel: '登録する' },
  },
  accountEdit: {
    rows: [
      { kind: 'field', label: '名前' },
      { kind: 'field', label: '資産カテゴリ' },
    ],
    actions: { kind: 'edit', saveLabel: '変更を保存' },
  },
};

function LabelBone({ children }: { children: ReactNode }) {
  return <span className={skeletonStyles.text}>{children}</span>;
}

function ValueBone() {
  return <input className={skeletonStyles.bone} disabled aria-hidden tabIndex={-1} />;
}

function ChoiceRow({ choices }: { choices: readonly string[] }) {
  return (
    <fieldset className={formsStyles['type-field']}>
      <legend>
        <LabelBone>種別</LabelBone>
      </legend>
      <div className={formsStyles['type-options']}>
        {choices.map((choice) => (
          <span className={formsStyles['type-choice']} key={choice} aria-hidden="true">
            <LabelBone>{choice}</LabelBone>
          </span>
        ))}
      </div>
    </fieldset>
  );
}

function AmountRow() {
  return (
    <div className={formsStyles['amount-field']}>
      <label>
        <LabelBone>金額</LabelBone>
      </label>
      <div className={formsStyles['amount-line']}>
        <span aria-hidden="true">¥</span>
        <ValueBone />
      </div>
    </div>
  );
}

function FieldRow({ label }: CardFormFieldRow) {
  return (
    <div className={formsStyles.field}>
      <label>
        <LabelBone>{label}</LabelBone>
      </label>
      <div className={formsStyles['field-value']}>
        <ValueBone />
      </div>
    </div>
  );
}

function ActionBone({ label, kind }: { label: string; kind: 'save' | 'cancel' | 'delete' }) {
  const variant =
    kind === 'save'
      ? undefined
      : kind === 'cancel'
        ? buttonStyles.buttonSecondary
        : buttonStyles.buttonDangerQuiet;
  return (
    <span
      className={[buttonStyles.button, variant, skeletonStyles.ghost].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      <LabelBone>{label}</LabelBone>
    </span>
  );
}

/** 実フォームの既存クラスで組み立てるカードフォーム用スケルトンです。 */
export function CardFormSkeleton({
  label,
  rows,
  actions,
}: {
  label: string;
  rows: readonly CardFormRow[];
  actions: CardFormActions;
}) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className={formsStyles['ledger-form']} aria-hidden="true">
        {rows.map((row, index) => {
          if (row.kind === 'choice') return <ChoiceRow {...row} key={`choice-${index}`} />;
          if (row.kind === 'amount') return <AmountRow key={`amount-${index}`} />;
          return (
            <div className={formsStyles['entry-detail-grid']} key={`${row.label}-${index}`}>
              <FieldRow {...row} />
            </div>
          );
        })}
        <div className={actionStyles.actions} data-with-cancel="true">
          {actions.kind === 'create' ? (
            <ActionBone kind="cancel" label="キャンセル" />
          ) : (
            <ActionBone kind="delete" label="削除する" />
          )}
          <ActionBone kind="save" label={actions.saveLabel} />
        </div>
      </div>
    </div>
  );
}

/** 設定などページ用フォームの既存スケルトンです。 */
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
