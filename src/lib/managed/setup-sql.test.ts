import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { managedSchemaFixture } from './schema.test-helper';

let db: PGlite;
const sql = readFileSync(
  join(process.cwd(), 'supabase/setup/managed-automation.sql'),
  'utf8'
);
const account = '10000000-0000-0000-0000-000000000001';
beforeAll(async () => {
  db = new PGlite();
  await db.exec(managedSchemaFixture);
  await db.query("INSERT INTO accounts VALUES($1,'Existing business',NULL)", [
    account,
  ]);
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe('downloadable managed setup SQL', () => {
  it('installs 065 through 068 on the older application schema', async () => {
    await db.exec(sql);
    const result = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name='whatsapp_config' AND column_name='connection_mode'"
    );
    expect(result.rows).toHaveLength(1);
    const plans = await db.query('SELECT id FROM subscription_plans');
    expect(plans.rows).toHaveLength(2);
    const standalone = await db.query(
      'SELECT account_id FROM managed_subscriptions'
    );
    expect(standalone.rows).toHaveLength(0);
    const admins = await db.query('SELECT * FROM platform_users');
    expect(admins.rows).toHaveLength(0);
  });
  it('can be rerun without resetting prices or removing payment records', async () => {
    await db.exec(
      "UPDATE subscription_plans SET monthly_price_minor=1234500 WHERE id='launch'"
    );
    await db.query(
      "INSERT INTO managed_subscriptions(account_id,plan_id,industry_id) VALUES($1,'launch','distributor-sales')",
      [account]
    );
    await db.query(
      "INSERT INTO managed_payments(account_id,reference,amount_minor,currency) VALUES($1,'BANK-1',1234500,'INR')",
      [account]
    );
    await db.exec(sql);
    const plans = await db.query<{ price: number }>(
      "SELECT monthly_price_minor::integer AS price FROM subscription_plans WHERE id='launch'"
    );
    expect(plans.rows[0].price).toBe(1234500);
    const payments = await db.query('SELECT reference FROM managed_payments');
    expect(payments.rows).toHaveLength(1);
  });
});
