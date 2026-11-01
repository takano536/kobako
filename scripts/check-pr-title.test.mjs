import { describe, expect, it } from 'vitest';
import { validatePrTitle } from './check-pr-title.mjs';

describe('validatePrTitle', () => {
  it.each([
    'refactor(web): サマリーの共通レイアウトを統一',
    'fix: 起動時の例外を握りつぶさない',
    'feat(db)!: 取引テーブルの型を変更する',
  ])('accepts a Japanese Conventional Commit title: %s', (title) => {
    expect(validatePrTitle(title)).toEqual({ ok: true, errors: [] });
  });

  it('accepts an English release title from a bot', () => {
    expect(validatePrTitle('chore(main): release 0.21.0', { authorType: 'Bot' })).toEqual({
      ok: true,
      errors: [],
    });
  });

  it.each([
    'サマリーの共通レイアウトを統一',
    'feat(web):',
    'feat(web): unify summary layout',
    'Feat(web): 統一する',
    'feat(web scope): 統一する',
    'feat:  ',
    'fix: 改行を含む\nタイトル',
  ])('rejects an invalid title: %s', (title) => {
    expect(validatePrTitle(title).ok).toBe(false);
  });

  it('rejects an English title from a human', () => {
    const result = validatePrTitle('chore(main): release 0.21.0', { authorType: 'User' });
    expect(result).toEqual({
      ok: false,
      errors: ['subject は日本語で記述してください（例: fix(web): 金額の丸めを直す）。'],
    });
  });

  it('requires the title to have no surrounding whitespace', () => {
    expect(validatePrTitle(' fix: 起動時の例外を握りつぶさない').ok).toBe(false);
    expect(validatePrTitle('fix: 起動時の例外を握りつぶさない ').ok).toBe(false);
  });
});
