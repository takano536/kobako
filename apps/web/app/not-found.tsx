import { ActionLink, PageHeader, PageShell } from './_components/ui';

export default function NotFound() {
  return (
    <PageShell width="narrow">
      <PageHeader title="取引が見つかりません" />
      <section className="panel not-found-state" aria-label="ページが見つかりません">
        <p className="not-found-code">404</p>
        <p>指定された取引は存在しないか、すでに削除されています。</p>
        <ActionLink href="/transactions" variant="back">
          取引一覧へ戻る
        </ActionLink>
      </section>
    </PageShell>
  );
}
