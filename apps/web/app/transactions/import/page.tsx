import Link from 'next/link';
import type { Metadata } from 'next';

import { MONEY_MANAGER_MAX_ROWS, MONEY_MANAGER_XLSX_LIMITS } from '@kobako/db/money-manager';

import { MoneyManagerImportForm } from './import-form';

export const metadata: Metadata = {
  title: 'らくな家計簿から引っ越す',
};

export default function MoneyManagerImportPage() {
  return (
    <div className="content-stack import-page">
      <Link className="import-back-link" href="/transactions">
        取引一覧へ戻る
      </Link>
      <header className="import-heading" aria-labelledby="import-title">
        <h1 id="import-title">らくな家計簿から引っ越す</h1>
        <p className="import-lead">
          エクスポートしたExcelファイルから、取引と振替をまとめて取り込みます。
        </p>
      </header>

      <MoneyManagerImportForm
        maxFileBytes={MONEY_MANAGER_XLSX_LIMITS.maxFileBytes}
        maxRows={MONEY_MANAGER_MAX_ROWS}
      />
    </div>
  );
}
