import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="content-stack content-narrow">
      <section className="panel empty-state" aria-labelledby="not-found-title">
        <p className="eyebrow">404</p>
        <h1 id="not-found-title">取引が見つかりません</h1>
        <p>指定された取引は存在しないか、すでに削除されています。</p>
        <Link className="button button-primary" href="/transactions">
          取引一覧へ戻る
        </Link>
      </section>
    </div>
  );
}
