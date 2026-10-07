import type { Metadata } from 'next';

import { MONEY_MANAGER_MAX_ROWS, MONEY_MANAGER_XLSX_LIMITS } from '@kobako/db/money-manager';

import { withSelectedMonth } from '../../../src/lib/month-navigation';
import { firstQueryValue } from '../../../src/lib/transaction-query';
import { ActionLink, PageHeader, PageShell } from '../../_components/ui';
import { MoneyManagerImportForm } from './import-form';

export const metadata: Metadata = {
  title: 'らくな家計簿から引っ越す',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MoneyManagerImportPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const query = await searchParams;
  const backHref = withSelectedMonth('/transactions', firstQueryValue(query.month));
  return (
    <PageShell width="import" className="import-page">
      <PageHeader
        title={
          <>
            <span className="heading-title-chunk">らくな家計簿</span>
            <span className="heading-title-chunk">から引っ越す</span>
          </>
        }
        titleAriaLabel="らくな家計簿から引っ越す"
        className="import-heading"
        actions={
          <ActionLink href={backHref} variant="back">
            取引一覧へ戻る
          </ActionLink>
        }
      />
      <p className="import-lead">
        <span className="phrase-wrap">エクスポートした Excel ファイルから、</span>
        <span className="phrase-wrap">
          <span className="import-lead-chunk">取引と振替</span>をまとめて取り込みます。
        </span>
      </p>

      <MoneyManagerImportForm
        maxFileBytes={MONEY_MANAGER_XLSX_LIMITS.maxFileBytes}
        maxRows={MONEY_MANAGER_MAX_ROWS}
      />
    </PageShell>
  );
}
