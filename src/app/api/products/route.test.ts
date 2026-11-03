import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  role: 'admin' as string | null,
  calls: [] as { method: string; args: unknown[] }[],
  result: {
    data: { id: 'item' } as unknown,
    error: null as { code: string } | null,
    count: 1,
  },
}));

vi.mock('@/lib/auth/account', () => {
  function context(min?: string) {
    const rank: Record<string, number> = {
      viewer: 1,
      agent: 2,
      admin: 3,
      owner: 4,
    };
    if (!h.role)
      throw Object.assign(new Error('Unauthorized'), { status: 401 });
    if (min && rank[h.role] < rank[min])
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    const chain: object = new Proxy(
      {},
      {
        get(_target, method) {
          if (method === 'then')
            return (resolve: (value: unknown) => unknown) =>
              Promise.resolve(h.result).then(resolve);
          return (...args: unknown[]) => {
            h.calls.push({ method: String(method), args });
            return chain;
          };
        },
      }
    );
    return {
      accountId: 'my-account',
      userId: 'my-user',
      role: h.role,
      supabase: {
        from: (table: string) => {
          h.calls.push({ method: 'from', args: [table] });
          return chain;
        },
      },
    };
  }
  return {
    getCurrentAccount: async () => context(),
    requireRole: async (min: string) => context(min),
    toErrorResponse: (err: { status?: number; message?: string }) =>
      Response.json({ error: err.message }, { status: err.status ?? 500 }),
  };
});

import { GET, POST } from './route';
import { PUT, PATCH } from './[id]/route';
import { POST as IMPORT } from './import/route';

const valid = { name: 'Chair', unit_price: '100.25', currency: 'INR' };
const id = '00000000-0000-0000-0000-000000000001';
const context = () => ({ params: Promise.resolve({ id }) });
const jsonRequest = (method: string, body: unknown) =>
  new Request('http://local/api/products', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
function csvRequest(csv: string) {
  const form = new FormData();
  form.set('file', new File([csv], 'products.csv', { type: 'text/csv' }));
  return new Request('http://local/api/products/import', {
    method: 'POST',
    body: form,
  });
}

beforeEach(() => {
  h.role = 'admin';
  h.calls = [];
  h.result = { data: { id: 'item' }, error: null, count: 1 };
});

describe('catalogue API authorization and tenancy', () => {
  it('rejects unauthenticated readers', async () => {
    h.role = null;
    expect((await GET(new Request('http://local/api/products'))).status).toBe(
      401
    );
    expect(h.calls).toHaveLength(0);
  });

  it.each(['viewer', 'agent'])(
    'allows %s to browse only the current account with bounded pagination',
    async (role) => {
      h.role = role;
      expect(
        (
          await GET(
            new Request(
              'http://local/api/products?page=2&q=Chair&status=archived&kind=service'
            )
          )
        ).status
      ).toBe(200);
      expect(h.calls).toContainEqual({
        method: 'eq',
        args: ['account_id', 'my-account'],
      });
      expect(h.calls).toContainEqual({
        method: 'eq',
        args: ['is_active', false],
      });
      expect(h.calls).toContainEqual({ method: 'range', args: [25, 49] });
    }
  );

  it.each(['viewer', 'agent', null])(
    'denies every catalogue write for role %s before database access',
    async (role) => {
      h.role = role;
      const expected = role ? 403 : 401;
      expect((await POST(jsonRequest('POST', valid))).status).toBe(expected);
      expect((await PUT(jsonRequest('PUT', valid), context())).status).toBe(
        expected
      );
      expect(
        (await PATCH(jsonRequest('PATCH', { is_active: false }), context()))
          .status
      ).toBe(expected);
      expect(
        (await IMPORT(csvRequest('name,unit_price,currency\nChair,1,USD')))
          .status
      ).toBe(expected);
      expect(h.calls).toHaveLength(0);
    }
  );

  it('creates with server-owned tenancy and creator values', async () => {
    expect(
      (
        await POST(
          jsonRequest('POST', {
            ...valid,
            account_id: 'other',
            created_by: 'other',
            is_active: false,
          })
        )
      ).status
    ).toBe(201);
    const insert = h.calls.find((call) => call.method === 'insert')!.args[0];
    expect(insert).toMatchObject({
      account_id: 'my-account',
      created_by: 'my-user',
      unit_price: '100.25',
    });
    expect(insert).not.toHaveProperty('is_active');
  });

  it('does not reveal or update another account item', async () => {
    h.result.data = null;
    expect((await PUT(jsonRequest('PUT', valid), context())).status).toBe(404);
    expect(h.calls).toContainEqual({
      method: 'eq',
      args: ['account_id', 'my-account'],
    });
    expect(h.calls).toContainEqual({ method: 'eq', args: ['id', id] });
  });

  it('archives without deleting and rejects arbitrary PATCH fields', async () => {
    expect(
      (await PATCH(jsonRequest('PATCH', { is_active: false }), context()))
        .status
    ).toBe(200);
    expect(h.calls).toContainEqual({
      method: 'update',
      args: [{ is_active: false }],
    });
    h.calls = [];
    expect(
      (
        await PATCH(
          jsonRequest('PATCH', { is_active: true, unit_price: 0 }),
          context()
        )
      ).status
    ).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it('returns a conflict for an already reserved SKU', async () => {
    h.result.error = { code: '23505' };
    expect((await POST(jsonRequest('POST', valid))).status).toBe(409);
  });

  it('handles a not-yet-applied migration without exposing database internals', async () => {
    h.result.error = { code: 'PGRST205' };
    const response = await GET(new Request('http://local/api/products'));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('administrator');
  });

  it('rejects invalid prices and invalid pagination before querying', async () => {
    expect(
      (await POST(jsonRequest('POST', { ...valid, unit_price: -1 }))).status
    ).toBe(400);
    expect(
      (await GET(new Request('http://local/api/products?page=0'))).status
    ).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it('inserts an entire valid import in a single account-scoped operation', async () => {
    h.result.data = [{ id: '1' }, { id: '2' }];
    const response = await IMPORT(
      csvRequest('name,unit_price,currency\nOne,1,USD\nTwo,2,INR')
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ imported: 2 });
    const inserts = h.calls.filter((call) => call.method === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toEqual([
      expect.objectContaining({
        name: 'One',
        account_id: 'my-account',
        created_by: 'my-user',
      }),
      expect.objectContaining({
        name: 'Two',
        account_id: 'my-account',
        created_by: 'my-user',
      }),
    ]);
  });

  it('saves no rows when a later import record is invalid', async () => {
    const response = await IMPORT(
      csvRequest('name,unit_price,currency\nGood,1,USD\nBad,-1,USD')
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('record 3');
    expect(h.calls).toHaveLength(0);
  });
});

// The import handler authorizes its account through the managed boundary;
// these resource tests retain the existing role and CSV fixtures.
vi.mock('@/lib/managed/access', async () => {
  const auth = await import('@/lib/auth/account');
  return { configurationContext: () => auth.requireRole('admin') };
});
