/**
 * 画面遷移の RSC 取得が一時的なサーバーエラー（Workers の Error 1102 は 503）を返したとき、
 * Next.js に渡す前に取り直します。Next.js は RSC 以外の応答や `!res.ok` を受けると
 * 何も出力せずに文書の読み込みへ切り替えるため、1 回の 503 で画面全体が再読み込みに
 * なっていました。取り直しても失敗したときは、その応答をそのまま渡します（従来どおり
 * 文書の読み込みで遷移します）。
 *
 * 対象は遷移の RSC 取得（`RSC: 1` の GET）だけです。先読み（`Next-Router-Prefetch`）は
 * 失敗しても遷移に影響しないため、Server Action（POST）は副作用があるため取り直しません。
 */
const RETRY_DELAYS_MS = [150, 450] as const;

function isRscNavigation(input: RequestInfo | URL, init: RequestInit | undefined): boolean {
  if (input instanceof Request) return false;
  if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return false;
  const headers = new Headers(init?.headers);
  return headers.get('rsc') === '1' && !headers.has('next-router-prefetch');
}

let installed = false;

export function installRscNavigationRetry(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    if (!isRscNavigation(input, init)) return originalFetch(input, init);
    let response = await originalFetch(input, init);
    for (const delay of RETRY_DELAYS_MS) {
      if (response.status !== 503 || init?.signal?.aborted) break;
      // `Promise.withResolvers` は Safari 17.4 未満に無いため、executor の形で待ちます。
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (init?.signal?.aborted) break;
      await response.body?.cancel().catch(() => undefined);
      response = await originalFetch(input, init);
    }
    return response;
  };
}
