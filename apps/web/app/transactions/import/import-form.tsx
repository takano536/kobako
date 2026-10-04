'use client';

import Link from 'next/link';
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import {
  formatTransactionAmount,
  formatYen,
  moneyToneClass,
  transactionAmountTone,
  type MoneyTone,
} from '../../../src/lib/format';
import { moneyManagerImportAction } from './actions';
import {
  initialMoneyManagerImportState,
  type MoneyManagerImportPreview,
  type MoneyManagerImportState,
  type MoneyManagerPreviewRow,
} from './state';

interface MoneyManagerImportFormProps {
  maxFileBytes: number;
  maxRows: number;
}

type FormView = MoneyManagerImportState['phase'];

interface SelectedFile {
  name: string;
  size: number;
}

const KIND_LABELS: Record<MoneyManagerPreviewRow['kind'], string> = {
  income: '収入',
  expense: '支出',
  transfer: '振替',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  }
  const mebibytes = bytes / (1024 * 1024);
  const precision = Number.isInteger(mebibytes) || mebibytes >= 10 ? 0 : 1;
  return `${mebibytes.toFixed(precision)} MiB`;
}

function dateParts(value: string): [number, number, number] | undefined {
  const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function formatDate(value: string): string {
  const parts = dateParts(value);
  if (!parts) {
    return value;
  }
  const [year, month, day] = parts;
  return `${year}年${month}月${day}日`;
}

function formatShortDate(value: string): string {
  const parts = dateParts(value);
  if (!parts) {
    return value;
  }
  const [, month, day] = parts;
  return `${month}/${day}`;
}

function periodLabel(period: MoneyManagerImportPreview['period']): string {
  if (!period) {
    return '—';
  }
  const from = formatDate(period.from);
  const to = formatDate(period.to);
  return from === to ? from : `${from}〜${to}`;
}

function previousImportDateLabel(value: string | undefined): string {
  if (!value) {
    return '以前';
  }
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatDate(date) : '以前';
}

function validationMessage(file: File, maxFileBytes: number): string | undefined {
  if (!/\.xlsx$/i.test(file.name)) {
    return 'Excel ファイル（.xlsx）を選んでください。';
  }
  if (file.size === 0) {
    return 'ファイルが空です。内容のある .xlsx を選んでください。';
  }
  if (file.size > maxFileBytes) {
    return `ファイルが大きすぎます。${formatFileSize(maxFileBytes)} 以下の .xlsx を選んでください。`;
  }
  return undefined;
}

function previewAmount(row: MoneyManagerPreviewRow): string {
  return row.kind === 'transfer'
    ? formatYen(row.amount)
    : formatTransactionAmount(row.kind, row.amount);
}

function previewAmountTone(row: MoneyManagerPreviewRow): MoneyTone {
  return row.kind === 'transfer' ? 'neutral' : transactionAmountTone(row.kind, row.amount);
}

function uniqueNames(names: readonly string[]): string[] {
  return [...new Set(names)];
}

function FileSelection({
  maxFileBytes,
  maxRows,
  selectedFile,
  fileMessage,
  fileError,
  fileErrorRef,
  pending,
  dragging,
  inputRef,
  onChange,
  onDrop,
  onDragEnter,
  onDragLeave,
  onOpen,
  onRemove,
}: {
  maxFileBytes: number;
  maxRows: number;
  selectedFile: SelectedFile | null;
  fileMessage?: string;
  fileError?: MoneyManagerImportPreview['fileError'];
  pending: boolean;
  dragging: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onDragEnter: (event: DragEvent<HTMLLabelElement>) => void;
  onDragLeave: (event: DragEvent<HTMLLabelElement>) => void;
  onOpen: () => void;
  onRemove: () => void;
  fileErrorRef: RefObject<HTMLDivElement | null>;
}) {
  const describedBy =
    [
      !selectedFile ? 'import-file-note' : undefined,
      fileError || fileMessage ? 'import-file-error' : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ') || undefined;
  return (
    <section className="import-file-section" aria-labelledby="import-file-title">
      <h2 id="import-file-title" className="sr-only">
        Excel ファイルを選ぶ
      </h2>
      <input
        ref={inputRef}
        className="sr-only import-file-input"
        id="money-manager-file"
        name="file"
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-label="Excel ファイルを選ぶ"
        aria-describedby={describedBy}
        aria-invalid={fileError || fileMessage ? true : undefined}
        onChange={onChange}
      />
      {selectedFile ? (
        <div className={`import-file-card${pending ? ' is-pending' : ''}`}>
          <span
            className={`import-file-card-icon${fileMessage ? ' is-invalid' : ''}`}
            aria-hidden="true"
          >
            {fileMessage ? 'FILE' : 'XLSX'}
          </span>
          <div className="import-file-card-copy">
            <strong className="import-file-name">{selectedFile.name}</strong>
            <span className="import-file-size">{formatFileSize(selectedFile.size)}</span>
            {pending ? <span className="import-file-pending">読み込み中…</span> : null}
          </div>
          <div className="import-file-actions">
            <button
              className="button import-file-change"
              type="button"
              onClick={onOpen}
              disabled={pending}
            >
              ファイルを変える
            </button>
            <button
              className="button import-file-remove"
              type="button"
              onClick={onRemove}
              disabled={pending}
            >
              選択を解除
            </button>
          </div>
        </div>
      ) : (
        <label
          className={`import-dropzone${dragging ? ' is-dragging' : ''}`}
          htmlFor="money-manager-file"
          role="button"
          tabIndex={pending ? -1 : 0}
          aria-label="Excel ファイルを選ぶ"
          aria-describedby="import-file-note"
          aria-disabled={pending || undefined}
          onKeyDown={(event: KeyboardEvent<HTMLLabelElement>) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpen();
            }
          }}
          onDrop={onDrop}
          onDragEnter={onDragEnter}
          onDragOver={onDragEnter}
          onDragLeave={onDragLeave}
          data-state={pending ? 'pending' : undefined}
        >
          <span className="import-dropzone-icon" aria-hidden="true">
            ↑
          </span>
          <span className="import-dropzone-copy">
            <strong className="button button-primary">
              <span className="import-dropzone-label-chunk">Excel</span>{' '}
              <span className="import-dropzone-label-chunk">ファイル</span>
              <wbr />
              <span className="import-dropzone-label-chunk">を選ぶ</span>
            </strong>
            <span className="import-dropzone-help">
              <span className="phrase-wrap phrase-wrap-keep">
                ここにドロップ
                <wbr />
                して
              </span>
              <span className="phrase-wrap phrase-wrap-keep">
                選ぶこと
                <wbr />
                もできます
              </span>
            </span>
          </span>
        </label>
      )}
      {!selectedFile ? (
        <p id="import-file-note" className="import-file-note">
          .xlsx・{formatFileSize(maxFileBytes)} まで・{maxRows.toLocaleString('ja-JP')}件まで
        </p>
      ) : null}
      <p className="import-file-status sr-only" role="status" aria-live="polite">
        {pending
          ? 'ファイルを読み込んでいます。'
          : selectedFile
            ? `${selectedFile.name}を選択しました。`
            : ''}
      </p>
      {fileError ? (
        <div
          id="import-file-error"
          className="import-file-error-card"
          role="alert"
          ref={fileErrorRef}
          tabIndex={-1}
        >
          <strong>{fileError.reason}</strong>
          <span>{fileError.suggestedFix}</span>
        </div>
      ) : fileMessage ? (
        <div
          id="import-file-error"
          className="import-file-error"
          role="alert"
          ref={fileErrorRef}
          tabIndex={-1}
        >
          {fileMessage}
        </div>
      ) : null}
    </section>
  );
}

function NamesSummary({ title, names }: { title: string; names: readonly string[] }) {
  const unique = uniqueNames(names);
  if (unique.length === 0) {
    return null;
  }
  const text = unique.join('、');
  if (unique.length <= 8) {
    return (
      <p className="import-new-names">
        <strong>{title}</strong>
        <span>{text}</span>
      </p>
    );
  }
  return (
    <details className="import-new-names">
      <summary>
        <strong>{title}</strong>
        <span>{unique.length.toLocaleString('ja-JP')}件</span>
      </summary>
      <p>{text}</p>
    </details>
  );
}

function SummarySection({ preview }: { preview: MoneyManagerImportPreview }) {
  const categories = preview.newCategories.map((category) => category.name);
  const sourceAccounts = preview.newAccounts.map((account) => account.name);
  return (
    <section
      className="import-preview-section import-summary-section"
      aria-labelledby="import-summary-title"
    >
      <div className="import-section-heading">
        <h2 id="import-summary-title">取り込み内容</h2>
      </div>
      <p className="import-period">
        <span>対象期間</span>
        <strong>{periodLabel(preview.period)}</strong>
      </p>
      <dl className="import-kind-summary">
        <div className="is-income">
          <dt>
            <span>収入</span>
            <small>{preview.counts.income.count.toLocaleString('ja-JP')}件</small>
          </dt>
          <dd
            className={moneyToneClass(transactionAmountTone('income', preview.counts.income.total))}
          >
            {formatTransactionAmount('income', preview.counts.income.total)}
          </dd>
        </div>
        <div className="is-expense">
          <dt>
            <span>支出</span>
            <small>{preview.counts.expense.count.toLocaleString('ja-JP')}件</small>
          </dt>
          <dd
            className={moneyToneClass(
              transactionAmountTone('expense', preview.counts.expense.total),
            )}
          >
            {formatTransactionAmount('expense', preview.counts.expense.total)}
          </dd>
        </div>
        <div className="is-transfer">
          <dt>
            <span>振替</span>
            <small>{preview.counts.transfer.count.toLocaleString('ja-JP')}件</small>
          </dt>
          <dd className={moneyToneClass('neutral')}>{formatYen(preview.counts.transfer.total)}</dd>
        </div>
      </dl>
      <div className="import-new-names-list">
        <NamesSummary title="新しいカテゴリ" names={categories} />
        <NamesSummary title="取り込み元の口座" names={sourceAccounts} />
      </div>
    </section>
  );
}
function AccountChoices({ preview }: { preview: MoneyManagerImportPreview }) {
  const choices = preview.accountChoices ?? [];
  if (choices.length === 0) return null;
  return (
    <section
      className="import-preview-section account-choice-section"
      aria-labelledby="account-choice-title"
    >
      <div className="import-section-heading">
        <h2 id="account-choice-title">取り込み元の口座を確認</h2>
      </div>
      <p>一致する名前でも自動で統合しません。各口座の取り込み先を選んでください。</p>
      <div className="account-choice-list">
        {choices.map((choice, index) => (
          <div className="account-choice-row" key={choice.sourceKey ?? choice.name}>
            <label htmlFor={`account-target-${index}`}>
              <strong>{choice.name}</strong>
              <select id={`account-target-${index}`} name="accountTarget" defaultValue="create">
                <option value="create">新しい口座を作成</option>
                {(choice.candidates ?? []).map((candidate) => (
                  <option value={`existing:${candidate.id}`} key={candidate.id}>
                    既存の口座を再利用: {candidate.name}
                    {candidate.status === 'closed' ? '（利用終了）' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}

function ErrorItem({ error }: { error: MoneyManagerImportPreview['rowErrors'][number] }) {
  return (
    <li className="import-row-error-item">
      <div className="import-row-error-heading">
        <strong>{error.row}行目</strong>
        <span>{error.excerpt}</span>
      </div>
      <p>{error.reason}</p>
      <small>{error.suggestedFix}</small>
    </li>
  );
}

function AttentionSection({ preview }: { preview: MoneyManagerImportPreview }) {
  if (preview.errorCount === 0 || preview.fileError || preview.rowErrors.length === 0) {
    return null;
  }
  const visibleErrors = preview.rowErrors.slice(0, 5);
  const remainingErrors = preview.rowErrors.slice(5);
  return (
    <section
      className="import-preview-section import-attention"
      aria-labelledby="import-attention-title"
    >
      <div className="import-section-heading">
        <h2 id="import-attention-title">確認が必要なところ</h2>
        <span>{preview.errorCount.toLocaleString('ja-JP')}件</span>
      </div>
      <p className="import-attention-lead">
        {preview.errorCount.toLocaleString('ja-JP')}
        行に問題があるため、まだ取り込めません。らくな家計簿で直してから、もう一度書き出してください。
      </p>
      <ol className="import-row-errors-list">
        {visibleErrors.map((error) => (
          <ErrorItem error={error} key={`${error.row}-${error.excerpt}`} />
        ))}
      </ol>
      {remainingErrors.length > 0 ? (
        <details className="import-more-errors">
          <summary>残り{remainingErrors.length.toLocaleString('ja-JP')}件を表示</summary>
          <ol className="import-row-errors-list" start={6}>
            {remainingErrors.map((error) => (
              <ErrorItem error={error} key={`${error.row}-${error.excerpt}`} />
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

function PreviewRows({ preview }: { preview: MoneyManagerImportPreview }) {
  return (
    <section className="import-preview-section" aria-labelledby="import-rows-title">
      <div className="import-section-heading">
        <h2 id="import-rows-title">取り込む取引の一部</h2>
        <span>
          全{preview.importableCount.toLocaleString('ja-JP')}件のうち
          {preview.sampleRows.length.toLocaleString('ja-JP')}件を表示
        </span>
      </div>
      {preview.sampleRows.length > 0 ? (
        <ol className="import-transaction-list">
          {preview.sampleRows.map((row) => {
            const content = row.content.trim();
            const category = row.category?.trim() ?? '';
            const from = row.from?.trim() || '（空欄）';
            const to = row.to?.trim() || '（空欄）';
            const route = (
              <>
                {from}
                <span className="sr-only">から </span>
                <span aria-hidden="true"> → </span>
                {to}
                <span className="sr-only"> へ</span>
              </>
            );
            const main = content || (row.kind === 'transfer' ? route : category) || '—';
            const sub =
              row.kind === 'transfer'
                ? content
                  ? route
                  : undefined
                : [content ? category : undefined, row.account]
                    .filter((value): value is string => Boolean(value) && value !== main)
                    .join('・') || undefined;
            return (
              <li
                className={`import-transaction-row kind-${row.kind}`}
                key={`${row.sourceRow}-${row.kind}`}
              >
                <div className="import-transaction-link">
                  <span className="import-kind-badge">{KIND_LABELS[row.kind]}</span>
                  <time className="import-transaction-date" dateTime={row.date}>
                    {formatShortDate(row.date)}
                  </time>
                  <span className="import-transaction-main">
                    <strong>{main}</strong>
                    {sub ? <span>{sub}</span> : null}
                  </span>
                  <span className={`record-amount ${moneyToneClass(previewAmountTone(row))}`}>
                    {previewAmount(row)}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="import-empty-preview">表示できる取引がありません。</p>
      )}
    </section>
  );
}

function DuplicateNotice({
  preview,
  onReset,
}: {
  preview: MoneyManagerImportPreview;
  onReset: () => void;
}) {
  return (
    <section className="import-duplicate" role="status" aria-labelledby="import-duplicate-title">
      <h2 id="import-duplicate-title">
        このファイルは{previousImportDateLabel(preview.previousImportDate)}に取り込み済みです
      </h2>
      <p>同じファイルは重複して取り込めません。</p>
      <div className="import-confirm-actions">
        <Link className="button button-primary" href="/transactions">
          取引一覧で確認する
        </Link>
        <button className="button import-secondary-action" type="button" onClick={onReset}>
          別のファイルを選ぶ
        </button>
      </div>
    </section>
  );
}

function ConfirmActions({
  preview,
  pending,
  onReset,
}: {
  preview: MoneyManagerImportPreview;
  pending: boolean;
  onReset: () => void;
}) {
  const confirmDisabled =
    pending ||
    preview.errorCount > 0 ||
    preview.importableCount === 0 ||
    Boolean(preview.accountResolutionError);
  return (
    <section className="import-confirm" aria-label="取り込みを確定">
      <div className="import-confirm-actions">
        <button
          className="button button-primary"
          type="submit"
          name="intent"
          value="confirm"
          disabled={confirmDisabled}
        >
          {pending
            ? '取り込み中…'
            : `${preview.importableCount.toLocaleString('ja-JP')}件を取り込む`}
        </button>
        {preview.errorCount > 0 ? (
          <span className="import-confirm-note">エラーを直してから取り込んでください</span>
        ) : null}
        <button
          className="button import-secondary-action"
          type="button"
          onClick={onReset}
          disabled={pending}
        >
          ファイルを選び直す
        </button>
      </div>
    </section>
  );
}

function PreviewView({
  preview,
  pending,
  onReset,
  headingRef,
}: {
  preview: MoneyManagerImportPreview;
  pending: boolean;
  onReset: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <div className="import-preview" aria-labelledby="import-preview-title">
      <h2 id="import-preview-title" className="sr-only" ref={headingRef} tabIndex={-1}>
        取り込み内容を確認
      </h2>
      {preview.fileError || preview.alreadyImported ? null : (
        <>
          <AttentionSection preview={preview} />
          <SummarySection preview={preview} />
          <AccountChoices preview={preview} />
          <PreviewRows preview={preview} />
          <ConfirmActions preview={preview} pending={pending} onReset={onReset} />
        </>
      )}
      {preview.alreadyImported ? <DuplicateNotice preview={preview} onReset={onReset} /> : null}
    </div>
  );
}

function SuccessView({
  success,
  onReset,
  headingRef,
}: {
  success: NonNullable<MoneyManagerImportState['success']>;
  onReset: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const targetMonth = success.months[success.months.length - 1];
  const monthQuery = targetMonth ? `?month=${encodeURIComponent(targetMonth)}` : '';
  const kinds = [
    {
      label: '収入',
      count: success.counts.income.count,
      amount: formatTransactionAmount('income', success.counts.income.total),
      tone: transactionAmountTone('income', success.counts.income.total),
    },
    {
      label: '支出',
      count: success.counts.expense.count,
      amount: formatTransactionAmount('expense', success.counts.expense.total),
      tone: transactionAmountTone('expense', success.counts.expense.total),
    },
    {
      label: '振替',
      count: success.counts.transfer.count,
      amount: formatYen(success.counts.transfer.total),
      tone: 'neutral',
    },
  ] as const;
  const created =
    success.createdCategories === 0 && success.createdAccounts === 0
      ? '新しいカテゴリ・口座はありません。'
      : `カテゴリを${success.createdCategories.toLocaleString('ja-JP')}件、口座を${success.createdAccounts.toLocaleString('ja-JP')}件作成しました。`;
  return (
    <section className="import-success" aria-labelledby="import-success-title">
      <p className="import-success-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </p>
      <h2 id="import-success-title" ref={headingRef} tabIndex={-1}>
        取り込みました
      </h2>
      <p className="import-success-period" role="status">
        {periodLabel(success.period)}
      </p>
      <dl className="import-success-counts">
        {kinds.map((kind) => (
          <div key={kind.label} className={`is-${kind.tone}`}>
            <dt>
              <span>{kind.label}</span>
              <small>{kind.count.toLocaleString('ja-JP')}件</small>
            </dt>
            <dd className={moneyToneClass(kind.tone)}>{kind.amount}</dd>
          </div>
        ))}
      </dl>
      <p className="import-success-created">{created}</p>
      <div className="import-success-actions">
        <Link className="button button-primary" href={`/transactions${monthQuery}`}>
          取引一覧へ
        </Link>
        <button className="button import-secondary-action" type="button" onClick={onReset}>
          別のファイルを取り込む
        </button>
      </div>
    </section>
  );
}

export function MoneyManagerImportForm({ maxFileBytes, maxRows }: MoneyManagerImportFormProps) {
  const [state, formAction, pending] = useActionState(
    moneyManagerImportAction,
    initialMoneyManagerImportState,
  );
  const [view, setView] = useState<FormView>('select');
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [dragging, setDragging] = useState(false);
  const [clientMessage, setClientMessage] = useState<string>();
  const [showServerMessage, setShowServerMessage] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  const fileErrorRef = useRef<HTMLDivElement>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    setView(state.phase);
    setShowServerMessage(Boolean(state.message));
  }, [state.phase, state.message]);

  useEffect(() => {
    if (view !== 'preview' && view !== 'success') {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (view === 'preview') {
        previewHeadingRef.current?.focus();
      } else {
        successHeadingRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view]);
  useEffect(() => {
    if (view !== 'select' || !state.message) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      fileErrorRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.message, view]);

  function requestPreview(): void {
    if (pending) {
      return;
    }
    const form = formRef.current;
    if (!form) {
      return;
    }
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  function applyFile(file: File, assignInput: boolean): void {
    if (pending) {
      return;
    }
    if (assignInput) {
      const input = fileInputRef.current;
      if (input && typeof DataTransfer !== 'undefined') {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
      }
    }
    const message = validationMessage(file, maxFileBytes);
    setSelectedFile({ name: file.name, size: file.size });
    setClientMessage(message);
    setShowServerMessage(false);
    if (!message) {
      window.requestAnimationFrame(requestPreview);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0];
    if (file) {
      applyFile(file, false);
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      applyFile(file, true);
    }
  }

  function handleDragEnter(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    setDragging(false);
  }

  function handleOpen(): void {
    if (!pending) {
      fileInputRef.current?.click();
    }
  }

  function resetSelection(): void {
    if (pending) {
      return;
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setSelectedFile(null);
    setClientMessage(undefined);
    setShowServerMessage(false);
    setDragging(false);
    setView('select');
    window.requestAnimationFrame(() => fileInputRef.current?.focus());
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending) {
      return;
    }
    const formData = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    formData.set(
      'intent',
      submitter instanceof HTMLButtonElement && submitter.name === 'intent'
        ? submitter.value
        : 'preview',
    );
    startTransition(() => {
      formAction(formData);
    });
  }

  const displayedView = hydrated ? view : state.phase;
  const fileMessage =
    clientMessage ??
    (displayedView === 'select' && (showServerMessage || !hydrated) ? state.message : undefined);
  const previewFileError = displayedView === 'preview' ? state.preview?.fileError : undefined;

  if (displayedView === 'success' && state.success) {
    return (
      <SuccessView
        success={state.success}
        onReset={resetSelection}
        headingRef={successHeadingRef}
      />
    );
  }

  return (
    <form
      ref={formRef}
      className="import-form"
      action={formAction}
      onSubmit={handleSubmit}
      noValidate
    >
      <FileSelection
        maxFileBytes={maxFileBytes}
        maxRows={maxRows}
        selectedFile={selectedFile}
        fileMessage={fileMessage}
        fileError={previewFileError}
        fileErrorRef={fileErrorRef}
        pending={pending}
        dragging={dragging}
        inputRef={fileInputRef}
        onChange={handleFileChange}
        onDrop={handleDrop}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onOpen={handleOpen}
        onRemove={resetSelection}
      />
      {displayedView === 'select' ? (
        <>
          {!hydrated || fileMessage ? (
            <button
              className="import-fallback-submit"
              type="submit"
              name="intent"
              value="preview"
              data-import-preview
              disabled={pending || Boolean(selectedFile && !fileMessage)}
            >
              {fileMessage ? 'もう一度読み込む' : 'ファイルを読み込む'}
            </button>
          ) : null}
          <details className="import-details">
            <summary>取り込まれる内容を確認</summary>
            <div className="import-details-content">
              <p>
                <span className="phrase-wrap">らくな家計簿 Android 日本語版から</span>
                <span className="phrase-wrap">出力した Excel（.xlsx）に対応しています。</span>
              </p>
              <ul>
                <li>収入・支出・振替を取り込みます。</li>
                <li>
                  <span className="phrase-wrap">日付・金額・カテゴリ・小分類・</span>
                  <span className="phrase-wrap">内容・メモ・資産を使います。</span>
                </li>
                <li>ファイルそのものは保存しません。</li>
                <li>確認するまで、家計簿は変わりません。</li>
              </ul>
            </div>
          </details>
        </>
      ) : null}
      {displayedView === 'preview' && state.message ? (
        <p className="form-message" role="alert">
          {state.message}
        </p>
      ) : null}
      {displayedView === 'preview' && state.preview ? (
        <PreviewView
          preview={state.preview}
          pending={pending}
          onReset={resetSelection}
          headingRef={previewHeadingRef}
        />
      ) : null}
      {displayedView === 'preview' && state.preview ? (
        <input type="hidden" name="expectedHash" value={state.preview.hash} />
      ) : null}
    </form>
  );
}
