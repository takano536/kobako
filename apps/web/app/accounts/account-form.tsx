'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

export interface AccountFormValues {
  name: string;
  kind: string;
  groupId: string;
  status: string;
  expectedKind: string;
  confirmKindChange: boolean;
}

export interface AccountFormState {
  values?: AccountFormValues;
  fieldErrors?: Record<string, string[]>;
  message?: string;
  requiresKindConfirmation?: boolean;
}

export interface AccountFormProps {
  action: (previousState: AccountFormState, formData: FormData) => Promise<AccountFormState>;
  initialValues: AccountFormValues;
  groups: readonly { id: number; name: string; defaultKind: string | null }[];
  existingNames?: readonly string[];
  submitLabel: string;
  editing: boolean;
  returnTo?: string;
}

const KINDS = [
  ['cash', '現金'],
  ['bank', '銀行'],
  ['electronic_money', '電子マネー'],
  ['credit_card', 'クレジットカード'],
  ['other', 'その他'],
] as const;

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="button button-primary save-button"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? '保存中…' : label}
    </button>
  );
}

function FieldError({ id, messages }: { id: string; messages?: readonly string[] }) {
  return messages?.length ? (
    <span id={id} className="field-error" role="alert">
      {messages[0]}
    </span>
  ) : null;
}

export function AccountForm({
  action,
  initialValues,
  groups,
  existingNames = [],
  submitLabel,
  editing,
  returnTo,
}: AccountFormProps) {
  const [state, formAction] = useActionState(action, {});
  const values = state.values ?? initialValues;
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(values.name);
  const [selectedKind, setSelectedKind] = useState(values.kind);
  const [selectedGroupId, setSelectedGroupId] = useState(values.groupId);
  const [groupTouched, setGroupTouched] = useState(() => {
    const group = groups.find((candidate) => String(candidate.id) === values.groupId);
    return group !== undefined && group.defaultKind !== values.kind;
  });
  const nameError = state.fieldErrors?.name;
  const kindError = state.fieldErrors?.kind;
  const groupError = state.fieldErrors?.groupId;
  const statusError = state.fieldErrors?.status;
  const sameNameWarning = name.trim().length > 0 && existingNames.includes(name.trim());

  useEffect(() => {
    if (!state.fieldErrors || Object.keys(state.fieldErrors).length === 0) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.fieldErrors]);

  function handleKindChange(nextKind: string): void {
    const currentGroup = groups.find((group) => String(group.id) === selectedGroupId);
    const automaticGroup = selectedGroupId === '' || selectedGroupId === 'auto';
    if (!groupTouched && (automaticGroup || currentGroup?.defaultKind === selectedKind)) {
      const defaultGroup = groups.find((group) => group.defaultKind === nextKind);
      setSelectedGroupId(defaultGroup ? String(defaultGroup.id) : 'auto');
    }
    setSelectedKind(nextKind);
  }
  function handleGroupChange(nextGroupId: string): void {
    setGroupTouched(true);
    setSelectedGroupId(nextGroupId);
  }
  const nameDescribedBy =
    [
      nameError?.length ? 'account-name-error' : '',
      sameNameWarning ? 'account-name-duplicate-warning' : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <form
      ref={formRef}
      key={`${values.name}|${values.kind}|${values.groupId}|${values.status}|${state.requiresKindConfirmation ? 'confirm' : 'normal'}`}
      className="form-stack account-form"
      action={formAction}
      noValidate
    >
      {returnTo ? <input type="hidden" name="return" value={returnTo} /> : null}
      <div className="form-field">
        <label htmlFor="account-name">口座名</label>
        <input
          id="account-name"
          name="name"
          required
          maxLength={120}
          defaultValue={values.name}
          onChange={(event) => setName(event.currentTarget.value)}
          aria-invalid={nameError?.length ? true : undefined}
          aria-describedby={nameDescribedBy}
        />
        <FieldError id="account-name-error" messages={nameError} />
        {sameNameWarning ? (
          <span
            id="account-name-duplicate-warning"
            className="form-message"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            同じ名前の口座があります。別の口座として登録できます。
          </span>
        ) : null}
      </div>
      <div className="form-field">
        <label htmlFor="account-kind">種類</label>
        <select
          id="account-kind"
          name="kind"
          required
          value={selectedKind}
          onChange={(event) => handleKindChange(event.currentTarget.value)}
          aria-invalid={kindError?.length ? true : undefined}
          aria-describedby={kindError?.length ? 'account-kind-error' : undefined}
        >
          {KINDS.map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <FieldError id="account-kind-error" messages={kindError} />
      </div>
      <div className="form-field">
        <label htmlFor="account-group">グループ</label>
        <select
          id="account-group"
          name="groupId"
          required
          value={selectedGroupId}
          onChange={(event) => handleGroupChange(event.currentTarget.value)}
          aria-invalid={groupError?.length ? true : undefined}
          aria-describedby={groupError?.length ? 'account-group-error' : undefined}
        >
          {!editing ? <option value="auto">種別に合わせる（自動）</option> : null}
          {groups.map((group) => (
            <option value={group.id} key={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        <FieldError id="account-group-error" messages={groupError} />
      </div>
      {editing ? (
        <div className="form-field">
          <label htmlFor="account-status">状態</label>
          <select
            id="account-status"
            name="status"
            defaultValue={values.status}
            aria-invalid={statusError?.length ? true : undefined}
            aria-describedby={statusError?.length ? 'account-status-error' : undefined}
          >
            <option value="active">利用中</option>
            <option value="closed">利用終了</option>
          </select>
          <FieldError id="account-status-error" messages={statusError} />
          <input type="hidden" name="expectedKind" value={values.expectedKind} />
        </div>
      ) : null}
      {state.requiresKindConfirmation ? (
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="confirmKindChange"
            defaultChecked={values.confirmKindChange}
          />
          残高の集計上の意味が変わることを確認しました
        </label>
      ) : null}
      {state.message ? (
        <p className="form-message" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="form-actions">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
