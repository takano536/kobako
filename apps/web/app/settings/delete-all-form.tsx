'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { deleteAllDataAction, type DeleteAllActionState } from './actions';

function DeleteSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button button-danger" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? '削除中…' : 'すべてのデータを削除する'}
    </button>
  );
}

export function DeleteAllForm() {
  const [state, formAction] = useActionState<DeleteAllActionState, FormData>(
    deleteAllDataAction,
    {},
  );
  const [confirmation, setConfirmation] = useState('');
  useEffect(() => {
    if (state.confirmation !== undefined) setConfirmation(state.confirmation);
  }, [state.confirmation]);
  return (
    <form className="delete-all-form" action={formAction}>
      <div className="field">
        <label htmlFor="delete-confirmation">確認のため「削除」と入力してください</label>
        <input
          id="delete-confirmation"
          name="confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.currentTarget.value)}
          required
          autoComplete="off"
          spellCheck={false}
          aria-describedby={
            state.error
              ? 'delete-confirmation-error delete-confirmation-help'
              : 'delete-confirmation-help'
          }
          aria-invalid={state.error ? true : undefined}
        />
        {state.error ? (
          <p id="delete-confirmation-error" className="settings-inline-error" role="alert">
            {state.error}
          </p>
        ) : null}
        <p id="delete-confirmation-help" className="settings-help">
          入力内容が一致しない場合は実行されません。
        </p>
      </div>
      <DeleteSubmitButton />
    </form>
  );
}
