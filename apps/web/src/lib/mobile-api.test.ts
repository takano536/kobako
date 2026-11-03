import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getSummary } from '../../app/api/v1/summary/route';
import { GET as getBalances } from '../../app/api/v1/balances/route';
import { GET as getRoot } from '../../app/api/v1/route';

const mocks = vi.hoisted(() => ({
  db: {},
  getMonthlyTotals: vi.fn(),
  getExpenseCategoryTotals: vi.fn(),
  getManagedAccountBalances: vi.fn(),
  getCardBillingSummaries: vi.fn(),
  aggregateBankPaymentSchedules: vi.fn(),
  deriveCardBalancePaymentSchedule: vi.fn(),
}));
const {
  db,
  getMonthlyTotals,
  getExpenseCategoryTotals,
  getManagedAccountBalances,
  getCardBillingSummaries,
  aggregateBankPaymentSchedules,
  deriveCardBalancePaymentSchedule,
} = mocks;

vi.mock('@kobako/db', () => ({
  aggregateBankPaymentSchedules: mocks.aggregateBankPaymentSchedules,
  currentTokyoDate: vi.fn(() => '2026-11-03'),
  currentTokyoMonth: vi.fn(() => '2026-11'),
  deriveCardBalancePaymentSchedule: mocks.deriveCardBalancePaymentSchedule,
  getCardBillingSummaries: mocks.getCardBillingSummaries,
  getExpenseCategoryTotals: mocks.getExpenseCategoryTotals,
  getManagedAccountBalances: mocks.getManagedAccountBalances,
  getMonthlyTotals: mocks.getMonthlyTotals,
  isValidMonth: (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value),
}));

vi.mock('./api-contract', () => ({
  apiError: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  handleApi: async (
    request: Request,
    handler: (context: { householdId: string; url: URL }) => Promise<Response>,
  ) => handler({ householdId: 'household', url: new URL(request.url) }),
  ledgerDatabase: () => mocks.db,
  noStore: (body: unknown, status = 200) => Response.json(body, { status }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getMonthlyTotals.mockResolvedValue({ income: '0', expense: '0', difference: '0' });
  getExpenseCategoryTotals.mockResolvedValue([]);
  getManagedAccountBalances.mockResolvedValue([]);
  getCardBillingSummaries.mockResolvedValue([]);
  aggregateBankPaymentSchedules.mockReturnValue(new Map());
  deriveCardBalancePaymentSchedule.mockReturnValue({
    scheduledAmount: '0',
    scheduledDueOn: null,
    unbilledAmount: '0',
  });
});

describe('GET /api/v1', () => {
  it('advertises mobile summary and balances features without removing resources', async () => {
    const response = await getRoot(new Request('https://example.test/api/v1'));
    expect(await response.json()).toMatchObject({
      name: 'kobako',
      apiVersion: 1,
      features: { summary: true, balances: true },
      resources: {
        accounts: '/api/v1/accounts',
        categories: '/api/v1/categories',
        transactions: '/api/v1/transactions',
        transfers: '/api/v1/transfers',
      },
    });
  });
});

describe('GET /api/v1/summary', () => {
  it('uses the Tokyo current month when month is omitted', async () => {
    const response = await getSummary(new Request('https://example.test/api/v1/summary'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      month: '2026-11',
      income: '0',
      expense: '0',
      difference: '0',
      expenseCategories: [],
    });
    expect(getMonthlyTotals).toHaveBeenCalledWith(db, 'household', '2026-11');
  });

  it('returns totals and preserves category ordering from the database helper', async () => {
    getMonthlyTotals.mockResolvedValue({
      income: '350000',
      expense: '210000',
      difference: '140000',
    });
    getExpenseCategoryTotals.mockResolvedValue([
      { categoryId: 2, categoryName: '食費', total: '45000' },
      { categoryId: 1, categoryName: 'その他', total: '1000' },
    ]);
    const response = await getSummary(
      new Request('https://example.test/api/v1/summary?month=2026-11'),
    );
    expect(await response.json()).toMatchObject({
      month: '2026-11',
      income: '350000',
      expense: '210000',
      difference: '140000',
      expenseCategories: [
        { categoryId: 2, categoryName: '食費', total: '45000' },
        { categoryId: 1, categoryName: 'その他', total: '1000' },
      ],
    });
  });

  it('rejects malformed months with the API error shape', async () => {
    const response = await getSummary(
      new Request('https://example.test/api/v1/summary?month=2026-13'),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'invalid_month', message: '月の形式が正しくありません。' },
    });
    expect(getMonthlyTotals).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/balances', () => {
  it('returns zero summaries and no groups for an empty ledger', async () => {
    const response = await getBalances(new Request('https://example.test/api/v1/balances'));
    expect(await response.json()).toEqual({
      summary: { assets: '0', liabilities: '0', net: '0' },
      groups: [],
    });
  });

  it('groups active accounts and includes bank and card payment schedules', async () => {
    getManagedAccountBalances.mockResolvedValue([
      {
        accountId: 1,
        accountName: '銀行',
        kind: 'bank',
        balance: '800000',
        deletedAt: null,
        assetCategoryId: 1,
        assetCategoryName: '銀行',
        assetCategorySystemKey: 'bank',
      },
      {
        accountId: 2,
        accountName: 'カード',
        kind: 'credit_card',
        balance: '-85000',
        deletedAt: null,
        assetCategoryId: 2,
        assetCategoryName: 'クレジットカード',
        assetCategorySystemKey: 'credit_card',
      },
      {
        accountId: 3,
        accountName: '削除済み',
        kind: 'bank',
        balance: '999999',
        deletedAt: '2026-01-01',
        assetCategoryId: 1,
        assetCategoryName: '銀行',
        assetCategorySystemKey: 'bank',
      },
    ]);
    const billing = {
      accountId: 2,
      nextPayment: { dueOn: '2026-11-27', amount: '85000' },
      periods: [],
    };
    getCardBillingSummaries.mockResolvedValue([billing]);
    aggregateBankPaymentSchedules.mockReturnValue(new Map([[1, 85000n]]));
    deriveCardBalancePaymentSchedule.mockReturnValue({
      scheduledAmount: '85000',
      scheduledDueOn: '2026-11-27',
      unbilledAmount: '12000',
    });

    const response = await getBalances(new Request('https://example.test/api/v1/balances'));
    expect(await response.json()).toEqual({
      summary: { assets: '800000', liabilities: '85000', net: '715000' },
      groups: [
        {
          name: '銀行',
          systemKey: 'bank',
          accounts: [
            {
              id: 1,
              name: '銀行',
              kind: 'bank',
              balance: '800000',
              scheduledAmount: '85000',
              scheduledDueOn: null,
              unbilledAmount: null,
              nextPayment: null,
            },
          ],
        },
        {
          name: 'クレジットカード',
          systemKey: 'credit_card',
          accounts: [
            {
              id: 2,
              name: 'カード',
              kind: 'credit_card',
              balance: '-85000',
              scheduledAmount: '85000',
              scheduledDueOn: '2026-11-27',
              unbilledAmount: '12000',
              nextPayment: { dueOn: '2026-11-27', amount: '85000' },
            },
          ],
        },
      ],
    });
    expect(getCardBillingSummaries).toHaveBeenCalledWith(db, 'household', [2], '2026-11-03');
    expect(aggregateBankPaymentSchedules).toHaveBeenCalledWith([billing], '2026-11');
  });
});
