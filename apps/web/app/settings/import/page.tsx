import importStyles from './import.module.css';
import uiStyles from '../../_components/ui.module.css';
import type { Metadata } from 'next';

import { MONEY_MANAGER_MAX_ROWS, MONEY_MANAGER_XLSX_LIMITS } from '@kobako/db/money-manager';

import { PageHeader } from '../../_components/page-header';
import { PageShell } from '../../_components/ui';
import { MoneyManagerImportForm } from './import-form';

export const metadata: Metadata = {
  title: 'らくな家計簿から引っ越す',
};

export default async function MoneyManagerImportPage() {
  const backHref = '/settings';
  return (
    <PageShell width="import" className={importStyles['import-page']}>
      <PageHeader
        title={
          <>
            <span className={uiStyles['phrase-wrap']}>らくな家計簿</span>
            <span className={uiStyles['phrase-wrap']}>から引っ越す</span>
          </>
        }
        titleAriaLabel="らくな家計簿から引っ越す"
        backLink={{ href: backHref, label: '設定へ戻る' }}
        className={importStyles['import-heading']}
      />
      <p className={importStyles['import-lead']}>
        <span className={uiStyles['phrase-wrap']}>エクスポートした Excel ファイルから、</span>
        <span className={uiStyles['phrase-wrap']}>
          <span className={importStyles['import-lead-chunk']}>取引と振替</span>
          をまとめて取り込みます。
        </span>
      </p>

      <MoneyManagerImportForm
        maxFileBytes={MONEY_MANAGER_XLSX_LIMITS.maxFileBytes}
        maxRows={MONEY_MANAGER_MAX_ROWS}
      />
    </PageShell>
  );
}
