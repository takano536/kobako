'use client';

import type { AssetCategory } from '@kobako/db';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createAssetCategoryAction,
  deleteAssetCategoryAction,
  updateAssetCategoryAction,
  type AssetCategoryActionState,
} from './actions';

function PendingButton({
  label,
  pendingLabel,
  className = 'button button-secondary',
  describedBy,
}: {
  label: string;
  pendingLabel?: string;
  className?: string;
  describedBy?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      type="submit"
      disabled={pending}
      aria-busy={pending}
      aria-describedby={describedBy}
    >
      {pending ? (pendingLabel ?? '処理中…') : label}
    </button>
  );
}

function ErrorMessage({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p className="settings-inline-error" id={id} role="alert">
      {message}
    </p>
  ) : null;
}

function CategoryRow({ category }: { category: AssetCategory }) {
  const isDefault = category.systemKey !== null;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [updateState, updateAction] = useActionState<AssetCategoryActionState, FormData>(
    updateAssetCategoryAction,
    {},
  );
  const [deleteState, deleteAction] = useActionState<AssetCategoryActionState, FormData>(
    deleteAssetCategoryAction,
    {},
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = `asset-category-error-${category.id}`;
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  function cancel() {
    setName(category.name);
    setEditing(false);
  }
  if (isDefault) {
    return (
      <li className="settings-category-row">
        <span className="settings-category-name">{category.name}</span>
        <span className="button button-quiet settings-category-action settings-category-unavailable">
          変更・削除不可
        </span>
      </li>
    );
  }
  return (
    <li className="settings-category-row">
      {editing ? (
        <form className="settings-category-editform" action={updateAction}>
          <input type="hidden" name="assetCategoryId" value={category.id} />
          <label className="sr-only" htmlFor={`asset-category-name-${category.id}`}>
            {category.name} の新しい名前
          </label>
          <input
            ref={inputRef}
            id={`asset-category-name-${category.id}`}
            name="name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={80}
            required
            aria-invalid={updateState.error ? true : undefined}
            aria-describedby={updateState.error ? errorId : undefined}
          />
          <PendingButton
            label="保存"
            pendingLabel="保存中…"
            describedBy={updateState.error ? errorId : undefined}
          />
          <button className="button button-quiet" type="button" onClick={cancel}>
            キャンセル
          </button>
        </form>
      ) : (
        <>
          <span className="settings-category-name">{category.name}</span>
          <div className="settings-category-actions">
            <button
              className="button button-quiet settings-category-action"
              type="button"
              onClick={() => setEditing(true)}
            >
              名前を変更
            </button>
            <form
              action={deleteAction}
              onSubmit={(event) => {
                if (
                  !window.confirm(
                    'このカテゴリの資産は「その他」に移動して削除されます。削除しますか？',
                  )
                )
                  event.preventDefault();
              }}
            >
              <input type="hidden" name="assetCategoryId" value={category.id} />
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
      <ErrorMessage
        id={errorId}
        message={editing ? updateState.error : (deleteState.error ?? updateState.error)}
      />
    </li>
  );
}

function AddForm() {
  const [state, action] = useActionState<AssetCategoryActionState, FormData>(
    createAssetCategoryAction,
    {},
  );
  const [name, setName] = useState('');
  useEffect(() => {
    if (state.values?.name !== undefined) setName(state.values.name);
  }, [state.values?.name]);
  return (
    <form className="settings-category-add" action={action}>
      <label htmlFor="asset-category-new">新しいカテゴリ</label>
      <input
        id="asset-category-new"
        name="name"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        maxLength={80}
        required
        placeholder="カテゴリ名"
      />
      <PendingButton label="追加" pendingLabel="追加中…" className="button button-primary" />
      <ErrorMessage id="asset-category-new-error" message={state.error} />
    </form>
  );
}

export function AssetCategoryManager({ categories }: { categories: readonly AssetCategory[] }) {
  return (
    <div className="settings-category-manager">
      <ul className="settings-category-list" aria-label="資産カテゴリの一覧">
        {categories.map((category) => (
          <CategoryRow category={category} key={category.id} />
        ))}
      </ul>
      <AddForm />
    </div>
  );
}
