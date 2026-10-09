'use client';

import type { Category, TransactionType } from '@kobako/db';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createCategoryAction,
  deleteCategoryAction,
  reorderCategoryAction,
  updateCategoryAction,
  type CategoryActionState,
} from './actions';

function PendingButton({
  label,
  pendingLabel,
  className = 'button button-secondary',
  disabled = false,
  describedBy,
}: {
  label: string;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;
  return (
    <button
      className={className}
      type="submit"
      disabled={isDisabled}
      aria-busy={pending}
      aria-describedby={describedBy}
    >
      {pending ? (pendingLabel ?? '処理中…') : label}
    </button>
  );
}

function ActionError({ id, message }: { id?: string; message?: string }) {
  return message ? (
    <p className="settings-inline-error" id={id} role="alert">
      {message}
    </p>
  ) : null;
}

function OrderForm({
  type,
  index,
  categories,
  direction,
  action,
  describedBy,
}: {
  type: TransactionType;
  index: number;
  categories: readonly Category[];
  direction: 'up' | 'down';
  action: (formData: FormData) => void;
  describedBy?: string;
}) {
  const boundary = direction === 'up' ? index === 0 : index === categories.length - 1;
  return (
    <form action={action}>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="index" value={index} />
      <input type="hidden" name="direction" value={direction} />
      {categories.map((item) => (
        <input type="hidden" name="categoryIds" value={item.id} key={item.id} />
      ))}
      <PendingButton
        label={direction === 'up' ? '上へ' : '下へ'}
        pendingLabel="…"
        className="button button-quiet settings-category-action"
        disabled={boundary}
        describedBy={describedBy}
      />
    </form>
  );
}

function CategoryRow({
  category,
  type,
  index,
  categories,
}: {
  category: Category;
  type: TransactionType;
  index: number;
  categories: readonly Category[];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [updateState, updateAction] = useActionState<CategoryActionState, FormData>(
    updateCategoryAction,
    {},
  );
  const [upState, upAction] = useActionState<CategoryActionState, FormData>(
    reorderCategoryAction,
    {},
  );
  const [downState, downAction] = useActionState<CategoryActionState, FormData>(
    reorderCategoryAction,
    {},
  );
  const [deleteState, deleteAction] = useActionState<CategoryActionState, FormData>(
    deleteCategoryAction,
    {},
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (wasEditing.current) {
      renameRef.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);

  const errorId = `category-error-${category.id}`;
  const error = editing
    ? updateState.error
    : (deleteState.error ?? upState.error ?? downState.error);

  function cancel() {
    setName(category.name);
    setEditing(false);
  }

  return (
    <li className="settings-category-row">
      {editing ? (
        <form className="settings-category-editform" action={updateAction}>
          <input type="hidden" name="categoryId" value={category.id} />
          <input type="hidden" name="type" value={type} />
          <label className="sr-only" htmlFor={`category-name-${category.id}`}>
            {category.name} の新しい名前
          </label>
          <input
            id={`category-name-${category.id}`}
            ref={inputRef}
            name="name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
              }
            }}
            maxLength={80}
            required
            aria-invalid={updateState.error ? true : undefined}
            aria-describedby={updateState.error ? errorId : undefined}
          />
          <PendingButton label="保存" pendingLabel="保存中…" className="button button-secondary" />
          <button className="button button-quiet" type="button" onClick={cancel}>
            キャンセル
          </button>
        </form>
      ) : (
        <>
          <span className="settings-category-name">{category.name}</span>
          <div className="settings-category-actions">
            <button
              ref={renameRef}
              className="button button-quiet settings-category-action"
              type="button"
              onClick={() => {
                setName(category.name);
                setEditing(true);
              }}
            >
              名前を変更
            </button>
            <OrderForm
              type={type}
              index={index}
              categories={categories}
              direction="up"
              action={upAction}
              describedBy={upState.error ? errorId : undefined}
            />
            <OrderForm
              type={type}
              index={index}
              categories={categories}
              direction="down"
              action={downAction}
              describedBy={downState.error ? errorId : undefined}
            />
            <form action={deleteAction}>
              <input type="hidden" name="categoryId" value={category.id} />
              <input type="hidden" name="type" value={type} />
              <PendingButton
                label="削除"
                pendingLabel="削除中…"
                className="button button-danger-quiet settings-category-action"
                describedBy={deleteState.error ? errorId : undefined}
              />
            </form>
          </div>
        </>
      )}
      <ActionError id={errorId} message={error} />
    </li>
  );
}

function CategoryAddForm({ type }: { type: TransactionType }) {
  const [state, formAction] = useActionState<CategoryActionState, FormData>(
    createCategoryAction,
    {},
  );
  const [name, setName] = useState('');
  useEffect(() => {
    if (state.values?.name !== undefined) setName(state.values.name);
  }, [state.values?.name]);
  return (
    <form className="settings-category-add" action={formAction}>
      <input type="hidden" name="type" value={type} />
      <label htmlFor={`${type}-category-new`}>新しいカテゴリ</label>
      <input
        id={`${type}-category-new`}
        name="name"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        maxLength={80}
        required
        placeholder="カテゴリ名"
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? `${type}-category-new-error` : undefined}
      />
      <PendingButton label="追加" pendingLabel="追加中…" className="button button-primary" />
      <ActionError id={`${type}-category-new-error`} message={state.error} />
    </form>
  );
}

export function SingleCategoryManager({
  type,
  title,
  categories,
}: {
  type: TransactionType;
  title: string;
  categories: readonly Category[];
}) {
  return (
    <div className="settings-category-manager">
      <ul className="settings-category-list" aria-label={`${title}の一覧`}>
        {categories.map((category, index) => (
          <CategoryRow
            key={category.id}
            category={category}
            type={type}
            index={index}
            categories={categories}
          />
        ))}
      </ul>
      <CategoryAddForm type={type} />
    </div>
  );
}
