#!/usr/bin/env node
// `wrangler deploy` has no machine-readable output, and the workers.dev URL
// depends on the account subdomain, which only the Cloudflare API knows.
const workerName = process.argv[2];
if (!workerName) {
  console.error('usage: workers-dev-url.mjs <worker-name>');
  process.exit(1);
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !token) {
  console.error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required');
  process.exit(1);
}

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
  { headers: { authorization: `Bearer ${token}` } },
);
const body = await response.json().catch(() => null);
const subdomain = body?.result?.subdomain;
if (!response.ok || !subdomain) {
  console.error(`could not read the workers.dev subdomain (HTTP ${response.status})`);
  console.error('workers.dev がアカウントで無効になっていないか確認してください。');
  console.error(JSON.stringify(body));
  process.exit(1);
}

console.log(`https://${workerName}.${subdomain}.workers.dev`);
