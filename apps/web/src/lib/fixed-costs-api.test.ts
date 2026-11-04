import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {},
  getFixedCostSummary: vi.fn(),
  listFixedCosts: vi.fn(),
  authorizeApiRequest: vi.fn(),
}));

vi.mock('@kobako/db', () => ({
  getFixedCostSummary: mocks.getFixedCostSummary,
  listFixedCosts: mocks.listFixedCosts,
  toApiIssues: vi.fn(),
}));

vi.mock('./api-auth', () => ({
  API_TOKEN_ENV: 'KOBAKO_API_TOKEN',
  authorizeApiRequest: mocks.authorizeApiRequest,
}));

vi.mock('./ledger-data', () => ({
  getLedgerDatabase: () => mocks.db,
}));

import { GET as getFixedCosts } from '../../app/api/v1/fixed-costs/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeApiRequest.mockImplementation(async (request: Request) =>
    request.headers.has('authorization')
      ? { status: 'ok', householdId: 'household' }
      : { status: 'unauthorized' },
  );
  mocks.getFixedCostSummary.mockResolvedValue({ monthly: 104300, annual: 1251600 });
  mocks.listFixedCosts.mockResolvedValue([
    {
      id: 1,
      name: '住居',
      amount: 85000,
      day: 27,
      intervalCount: 1,
      intervalUnit: 'month',
      startMonth: '2026-01-01',
      categoryName: '住居',
      accountName: '生活費口座',
    },
    {
      id: 2,
      name: '保険',
      amount: 19300,
      day: 1,
      intervalCount: 1,
      intervalUnit: 'year',
      startMonth: '2026-02-01',
      categoryName: '保険',
      accountName: '生活費口座',
    },
  ]);
});

describe('GET /api/v1/fixed-costs', () => {
  it('returns summary and items in the database order', async () => {
    const response = await getFixedCosts(
      new Request('https://example.test/api/v1/fixed-costs', {
        headers: { Authorization: 'Bearer test-token' },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      monthly: '104300',
      annual: '1251600',
      items: [
        {
          id: 1,
          name: '住居',
          categoryName: '住居',
          accountName: '生活費口座',
          amount: '85000',
          day: 27,
          intervalCount: 1,
          intervalUnit: 'month',
          startMonth: '2026-01-01',
        },
        {
          id: 2,
          name: '保険',
          categoryName: '保険',
          accountName: '生活費口座',
          amount: '19300',
          day: 1,
          intervalCount: 1,
          intervalUnit: 'year',
          startMonth: '2026-02-01',
        },
      ],
    });
    expect(mocks.getFixedCostSummary).toHaveBeenCalledWith(mocks.db, 'household');
    expect(mocks.listFixedCosts).toHaveBeenCalledWith(mocks.db, 'household');
  });

  it('returns 401 when the request is not authenticated', async () => {
    const response = await getFixedCosts(new Request('https://example.test/api/v1/fixed-costs'));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'unauthorized' },
    });
    expect(mocks.getFixedCostSummary).not.toHaveBeenCalled();
    expect(mocks.listFixedCosts).not.toHaveBeenCalled();
  });
});
