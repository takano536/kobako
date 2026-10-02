import type { Metadata } from 'next';

import { MONEY_MANAGER_MAX_ROWS, MONEY_MANAGER_XLSX_LIMITS } from '@kobako/db/money-manager';

import { ActionLink, PageHeader, PageShell } from '../../_components/ui';
import { MoneyManagerImportForm } from './import-form';

export const metadata: Metadata = {
  title: 'らくな家計簿から引っ越す',
};

export default function MoneyManagerImportPage() {
  return (
    <PageShell width="import" className="import-page">
      <PageHeader
        title="らくな家計簿から引っ越す"
        className="import-heading"
        actions={
          <ActionLink href="/transactions" variant="back">
            取引一覧へ戻る
          </ActionLink>
        }
      />
      <p className="import-lead">
        エクスポートしたExcelファイルから、取引と振替をまとめて取り込みます。
      </p>

      <MoneyManagerImportForm
        maxFileBytes={MONEY_MANAGER_XLSX_LIMITS.maxFileBytes}
        maxRows={MONEY_MANAGER_MAX_ROWS}
      />
    </PageShell>
  );
}
