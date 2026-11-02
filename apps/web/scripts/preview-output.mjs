#!/usr/bin/env node
// `wrangler preview --json` はアセットのアップロード進捗も stdout に書くため、
// 出力全体を JSON として読めない。末尾にある JSON オブジェクトだけを取り出す。
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const fields = new Set(['preview-url', 'deployment-url', 'dashboard-url', 'preview-name']);
const [file, field] = process.argv.slice(2);

if (!file || !field) {
  console.error(
    `usage: ${basename(process.argv[1])} <wrangler-preview-json> <${[...fields].join('|')}>`,
  );
  process.exit(1);
}
if (!fields.has(field)) {
  console.error(`unknown field: ${field} (expected one of ${[...fields].join(', ')})`);
  process.exit(1);
}

/**
 * 複数行に整形された JSON が末尾に続く前提で、後ろから順に
 * 解析できた最初のオブジェクトを返す。
 */
function parseLastJsonObject(text) {
  const starts = [];
  for (let i = text.length; i > 0; i -= 1) {
    if (text[i - 1] === '{' && (i === 1 || text[i - 2] === '\n')) {
      starts.push(i - 1);
    }
  }
  for (const start of starts) {
    try {
      return JSON.parse(text.slice(start));
    } catch {
      // 途中の `{` を拾っただけなので、さらに手前を試す
    }
  }
  return null;
}

const data = parseLastJsonObject(readFileSync(file, 'utf8'));
if (!data) {
  console.error(`could not find a JSON object in ${file}`);
  process.exit(1);
}

const value = (() => {
  switch (field) {
    case 'preview-url':
      return data.preview?.urls?.[0] ?? data.preview_urls?.[0];
    case 'deployment-url':
      return data.deployment?.urls?.[0] ?? data.deployment_urls?.[0];
    case 'preview-name':
      return data.preview?.name ?? data.preview_name;
    case 'dashboard-url': {
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      const workerName = data.worker_name ?? process.env.PREVIEW_WORKER_NAME ?? 'demo';
      const slug = data.preview?.slug;
      const deploymentId = data.deployment?.id;
      if (!accountId || !slug || !deploymentId) {
        return undefined;
      }
      return `https://dash.cloudflare.com/${accountId}/workers/services/view/${workerName}/production/previews/${encodeURIComponent(slug)}/deployments/${encodeURIComponent(deploymentId)}`;
    }
  }
  return undefined;
})();

if (!value) {
  console.error(`the preview output does not contain ${field}`);
  process.exit(1);
}

console.log(value);
