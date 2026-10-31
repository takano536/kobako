#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const FORMAT_PATTERN =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9-]*\))?!?: \S.*$/;
const JAPANESE_PATTERN = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const FORMAT_ERROR =
  'PR タイトルは Conventional Commits 形式にしてください（例: fix(web): 金額の丸めを直す）。';
const JAPANESE_ERROR = 'subject は日本語で記述してください（例: fix(web): 金額の丸めを直す）。';

export function validatePrTitle(title, { authorType } = {}) {
  const errors = [];
  const isString = typeof title === 'string';
  const hasValidFormat =
    isString && !/[\r\n]/.test(title) && title === title.trim() && FORMAT_PATTERN.test(title);

  if (!hasValidFormat) errors.push(FORMAT_ERROR);
  if (authorType !== 'Bot' && hasValidFormat) {
    const subject = title.slice(title.indexOf(': ') + 2);
    if (!JAPANESE_PATTERN.test(subject)) errors.push(JAPANESE_ERROR);
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const args = process.argv.slice(2);
  let title;
  let authorType;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--author-type') {
      authorType = args[index + 1];
      index += 1;
    } else if (title === undefined) {
      title = args[index];
    }
  }
  title ??= process.env.PR_TITLE;
  authorType ??= process.env.PR_AUTHOR_TYPE;
  const result = validatePrTitle(title, { authorType });

  if (!result.ok) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  console.log(`PR title OK: ${title}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
