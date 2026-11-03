import { readFileSync } from 'node:fs';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Quotation } from './types';

const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let db: PGlite;
const details = {
  valid_until: '2099-12-31',
  discount_percent: 0,
  requirements: 'Birthday function',
  terms: '',
};
async function actor(user: number, role = 'authenticated') {
  await db.exec(
    `RESET ROLE; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${user ? id(user) : ''}',true); SELECT set_config('request.jwt.claim.role','${role}',true);`
  );
}
async function save(
  items = [{ product_id: id(200), quantity: '1' }],
  patch: Record<string, unknown> = {},
  quote?: Quotation
) {
  const result = await db.query<{ quote: Quotation }>(
    'SELECT public.save_quotation($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) AS quote',
    [
      id(1),
      quote?.id ?? null,
      id(100),
      null,
      JSON.stringify(items),
      JSON.stringify({ ...details, ...patch }),
      quote?.version ?? null,
      null,
    ]
  );
  return result.rows[0].quote;
}
async function transition(quote: Quotation, action: string) {
  const result = await db.query<{ quote: Quotation }>(
    'SELECT public.transition_quotation($1,$2,$3,$4) AS quote',
    [id(1), quote.id, action, quote.version]
  );
  return result.rows[0].quote;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TYPE account_role_enum AS ENUM ('owner','admin','agent','viewer');
    CREATE TABLE accounts(id uuid PRIMARY KEY,name text NOT NULL,owner_user_id uuid);
    CREATE TABLE profiles(user_id uuid PRIMARY KEY,account_id uuid REFERENCES accounts(id),account_role account_role_enum);
    CREATE TABLE contacts(id uuid PRIMARY KEY,account_id uuid REFERENCES accounts(id),name text,phone text,email text,company text,wa_user_id text);
    CREATE TABLE conversations(id uuid PRIMARY KEY,account_id uuid,contact_id uuid REFERENCES contacts(id),updated_at timestamptz DEFAULT now());
    CREATE TABLE messages(id uuid PRIMARY KEY,conversation_id uuid REFERENCES conversations(id),sender_type text,message_id text,created_at timestamptz DEFAULT now());
    CREATE TABLE notifications(id uuid DEFAULT gen_random_uuid(),account_id uuid,user_id uuid,type text CONSTRAINT notifications_type_check CHECK(type='conversation_assigned'),conversation_id uuid,contact_id uuid,title text,body text);
    CREATE TABLE account_invitations(id uuid DEFAULT gen_random_uuid(),account_id uuid,token_hash text,role account_role_enum,accepted_at timestamptz,accepted_by_user_id uuid,expires_at timestamptz);
    CREATE FUNCTION update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
    CREATE FUNCTION is_account_member(target_account_id uuid,min_role account_role_enum DEFAULT 'viewer') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=auth.uid() AND account_id=target_account_id AND
        array_position(ARRAY['viewer','agent','admin','owner'],account_role::text)>=array_position(ARRAY['viewer','agent','admin','owner'],min_role::text)) $$;
  `);
  await db.exec(
    readFileSync('supabase/migrations/061_product_catalogue.sql', 'utf8')
  );
  await db.exec(readFileSync('supabase/migrations/063_quotations.sql', 'utf8'));
  const guard = readFileSync(
    'supabase/migrations/064_quotation_account_data_guard.sql',
    'utf8'
  );
  const tables = [
    ...guard.matchAll(/FROM (\w+) WHERE account_id = v_old_account_id/g),
  ].map((match) => match[1]);
  for (const table of new Set(tables))
    await db.exec(`CREATE TABLE IF NOT EXISTS ${table}(account_id uuid)`);
  await db.exec(guard);
  await db.exec(`
    INSERT INTO auth.users VALUES('${id(10)}'),('${id(11)}'),('${id(12)}'),('${id(20)}');
    INSERT INTO accounts VALUES('${id(1)}','GET Solution','${id(10)}'),('${id(2)}','Other business','${id(20)}');
    INSERT INTO profiles VALUES('${id(10)}','${id(1)}','owner'),('${id(11)}','${id(1)}','agent'),('${id(12)}','${id(1)}','viewer'),('${id(20)}','${id(2)}','owner');
    INSERT INTO contacts(id,account_id,name,phone,email,company) VALUES('${id(100)}','${id(1)}','Customer','+919999999999',NULL,NULL),('${id(101)}','${id(2)}','Other customer',NULL,NULL,NULL);
    INSERT INTO conversations(id,account_id,contact_id) VALUES('${id(500)}','${id(1)}','${id(100)}');
    INSERT INTO messages(id,conversation_id,sender_type,message_id) VALUES('${id(600)}','${id(500)}','customer','wamid.test');
    INSERT INTO products(id,account_id,created_by,name,unit_price,currency,tax_rate) VALUES
      ('${id(200)}','${id(1)}','${id(10)}','Birthday function - mini',3500,'INR',18),
      ('${id(201)}','${id(1)}','${id(10)}','USD item',10,'USD',0),
      ('${id(202)}','${id(2)}','${id(20)}','Other account item',1,'INR',0),
      ('${id(203)}','${id(1)}','${id(10)}','Rounding example',0.05,'INR',18);
  `);
}, 30000);
beforeEach(async () => {
  await db.exec('BEGIN');
  await actor(10);
});
afterEach(async () => {
  await db.exec('ROLLBACK; RESET ROLE;');
});
afterAll(async () => {
  await db.close();
});

describe('quotation database calculations and access', () => {
  it('calculates the catalogue price and tax instead of accepting supplied totals', async () => {
    const quote = await save(undefined, { total: 1, unit_price: 1 });
    expect(quote).toMatchObject({
      status: 'draft',
      subtotal: 3500,
      tax_total: 630,
      total: 4130,
      discount_total: 0,
    });
    expect(quote.items[0]).toMatchObject({
      unit_price: 3500,
      tax_rate: 18,
      total: 4130,
    });
  });
  it('rounds each line, discount and tax consistently', async () => {
    const quote = await save([{ product_id: id(203), quantity: '3' }], {
      discount_percent: 5,
    });
    expect(quote).toMatchObject({
      subtotal: 0.15,
      discount_total: 0.01,
      tax_total: 0.03,
      total: 0.17,
    });
  });
  it('preserves approved price snapshots when catalogue prices change', async () => {
    const quote = await transition(await save(), 'approve');
    await db.query('UPDATE products SET unit_price=9000 WHERE id=$1', [
      id(200),
    ]);
    const result = await db.query<{ total: string }>(
      'SELECT total FROM quotations WHERE id=$1',
      [quote.id]
    );
    expect(Number(result.rows[0].total)).toBe(4130);
  });
  it('rejects direct table writes even for an owner', async () => {
    await expect(
      db.query("UPDATE quotations SET status='approved' WHERE account_id=$1", [
        id(1),
      ])
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('rejects viewer draft creation', async () => {
    await actor(12);
    await expect(save()).rejects.toMatchObject({ code: '42501' });
  });
  it('allows agents to draft but reserves approval for administrators', async () => {
    await actor(11);
    const quote = await save();
    await expect(transition(quote, 'approve')).rejects.toMatchObject({
      code: '42501',
    });
  });
  it('prevents edits after approval', async () => {
    const quote = await transition(await save(), 'approve');
    await expect(save(undefined, {}, quote)).rejects.toMatchObject({
      code: '40001',
    });
  });
  it('rejects stale draft versions', async () => {
    const quote = await save();
    await save(undefined, {}, quote);
    await expect(save(undefined, {}, quote)).rejects.toMatchObject({
      code: '40001',
    });
  });
  it('rejects products from another account', async () => {
    await expect(
      save([{ product_id: id(202), quantity: '1' }])
    ).rejects.toMatchObject({ code: '22023' });
  });
  it('rejects mixed currencies', async () => {
    await expect(
      save([
        { product_id: id(200), quantity: '1' },
        { product_id: id(201), quantity: '1' },
      ])
    ).rejects.toMatchObject({ code: '22023' });
  });
  it('enforces account-scoped reads', async () => {
    await save();
    await actor(20);
    expect((await db.query('SELECT id FROM quotations')).rows).toHaveLength(0);
  });
  it('does not allow an unapproved draft to be sent', async () => {
    const quote = await save();
    await expect(
      db.query('SELECT claim_quotation_send($1,$2,$3)', [
        id(1),
        quote.id,
        quote.version,
      ])
    ).rejects.toMatchObject({ code: '40001' });
  });
  it('reserves an approved quotation for only one send attempt', async () => {
    const quote = await transition(await save(), 'approve');
    await db.query('SELECT claim_quotation_send($1,$2,$3)', [
      id(1),
      quote.id,
      quote.version,
    ]);
    await expect(
      db.query('SELECT claim_quotation_send($1,$2,$3)', [
        id(1),
        quote.id,
        quote.version,
      ])
    ).rejects.toMatchObject({ code: '40001' });
  });
  it('creates AI drafts and review notifications, with idempotency for the source message', async () => {
    await actor(0, 'service_role');
    const params = [
      id(1),
      null,
      id(100),
      id(500),
      JSON.stringify([{ product_id: id(200), quantity: 1 }]),
      JSON.stringify({ ...details, ai_collecting: false }),
      null,
      'wamid.test',
    ];
    const first = await db.query<{ quote: Quotation }>(
      'SELECT save_quotation($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) AS quote',
      params
    );
    const second = await db.query<{ quote: Quotation }>(
      'SELECT save_quotation($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) AS quote',
      params
    );
    expect(first.rows[0].quote.id).toBe(second.rows[0].quote.id);
    expect(first.rows[0].quote.status).toBe('draft');
    await db.exec('RESET ROLE');
    expect(
      (
        await db.query(
          "SELECT id FROM notifications WHERE type='quotation_ready'"
        )
      ).rows
    ).toHaveLength(1);
  });
  it('prevents AI-created discounts', async () => {
    await actor(0, 'service_role');
    await expect(
      save(undefined, { discount_percent: 10 })
    ).rejects.toMatchObject({ code: '42501' });
  });
});
