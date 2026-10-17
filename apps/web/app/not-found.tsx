import uiStyles from './_components/ui.module.css';
import { PageHeader } from './_components/page-header';
import { PageShell } from './_components/ui';

export default function NotFound() {
  return (
    <PageShell width="narrow">
      <PageHeader
        title="取引が見つかりません"
        titleAriaLabel="取引が見つかりません"
        backLink={{ href: '/transactions', label: '取引一覧へ戻る' }}
      />
      <section
        className={[uiStyles.panel, uiStyles['not-found-state']].join(' ')}
        aria-label="ページが見つかりません"
      >
        <p className={uiStyles['not-found-code']}>404</p>
        <p>指定された取引は存在しないか、すでに削除されています。</p>
      </section>
    </PageShell>
  );
}
