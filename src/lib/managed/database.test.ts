import { managedSchemaFixture } from './schema.test-helper';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';

const tenant = '10000000-0000-0000-0000-000000000001',
  other = '10000000-0000-0000-0000-000000000002';
const owner = '20000000-0000-0000-0000-000000000001',
  platform = '20000000-0000-0000-0000-000000000002';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(managedSchemaFixture);
  await db.exec(
    readFileSync(
      join(process.cwd(), 'supabase/migrations/067_managed_automation.sql'),
      'utf8'
    )
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(
    `RESET ROLE; SELECT set_config('app.uid','',false); TRUNCATE accounts,auth.users CASCADE; UPDATE managed_platform_settings SET managed_signup=false; UPDATE subscription_plans SET ai_generation_limit=2 WHERE id='launch';`
  );
  await db.query('INSERT INTO auth.users VALUES($1),($2)', [owner, platform]);
  await db.query(
    "INSERT INTO accounts VALUES($1,'Distributor',$2),($3,'Other',$4)",
    [tenant, owner, other, platform]
  );
  await db.query(
    "INSERT INTO profiles(user_id,account_id,account_role) VALUES($1,$2,'owner'),($3,$4,'owner')",
    [owner, tenant, platform, other]
  );
  await db.query('INSERT INTO platform_users(user_id) VALUES($1)', [platform]);
  await db.query(
    "INSERT INTO managed_subscriptions(account_id,plan_id,industry_id,status) VALUES($1,'launch','distributor-sales','active')",
    [tenant]
  );
  await db.query(
    "INSERT INTO whatsapp_config(account_id,phone_number_id,access_token,status) VALUES($1,'111','encrypted-secret','connected')",
    [tenant]
  );
});
async function user(id = owner) {
  await db.query("SELECT set_config('app.uid',$1,false)", [id]);
  await db.exec('SET ROLE authenticated');
}
async function admin() {
  await user(platform);
}

describe('managed subscriptions database boundaries', () => {
  it('pauses legacy responders only when a workspace is first enrolled', async () => {
    await db.query('DELETE FROM managed_subscriptions WHERE account_id=$1', [
      tenant,
    ]);
    await db.query("INSERT INTO flows(account_id,status) VALUES($1,'active')", [
      tenant,
    ]);
    await db.query(
      'INSERT INTO automations(account_id,is_active) VALUES($1,true),($2,true)',
      [tenant, other]
    );
    await admin();
    await db.query(
      "SELECT managed_subscription_admin($1,'launch','distributor-sales','pending',date_trunc('month',now()),date_trunc('month',now())+interval '1 month')",
      [tenant]
    );
    await db.exec('RESET ROLE');
    const flows = await db.query<{ status: string }>(
      'SELECT status FROM flows WHERE account_id=$1',
      [tenant]
    );
    const responders = await db.query<{
      account_id: string;
      is_active: boolean;
    }>('SELECT account_id,is_active FROM automations');
    expect(flows.rows[0].status).toBe('draft');
    expect(
      responders.rows.find((row) => row.account_id === tenant)?.is_active
    ).toBe(false);
    expect(
      responders.rows.find((row) => row.account_id === other)?.is_active
    ).toBe(true);
  });
  it('protects direct media uploads with the managed capabilities', async () => {
    await user();
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name) VALUES('chat-media','customer-image')"
    );
    await expect(
      db.query(
        "INSERT INTO storage.objects(bucket_id,name) VALUES('flow-media','workflow-image')"
      )
    ).rejects.toThrow(/row-level security/);
    await db.exec('RESET ROLE');
    await db.query(
      "UPDATE managed_subscriptions SET status='suspended' WHERE account_id=$1",
      [tenant]
    );
    await user();
    await expect(
      db.query(
        "INSERT INTO storage.objects(bucket_id,name) VALUES('chat-media','another-image')"
      )
    ).rejects.toThrow(/row-level security/);
  });
  it('requires onboarding readiness before activation', async () => {
    await admin();
    await expect(
      db.query(
        "SELECT managed_subscription_admin($1,'launch','distributor-sales','active',date_trunc('month',now()),date_trunc('month',now())+interval '1 month')",
        [tenant]
      )
    ).rejects.toThrow(/Complete business onboarding/);
  });
  it('checks seat allowances inside membership changes', async () => {
    await db.query(
      "INSERT INTO profiles(user_id,account_id,account_role) VALUES(gen_random_uuid(),$1,'agent'),(gen_random_uuid(),$1,'viewer')",
      [tenant]
    );
    await expect(
      db.query(
        "INSERT INTO profiles(user_id,account_id,account_role) VALUES(gen_random_uuid(),$1,'agent')",
        [tenant]
      )
    ).rejects.toThrow(/seat allowance/);
  });
  it('does not expose the administrative preview allowance bypass to clients', async () => {
    await user();
    await expect(
      db.query("SELECT reserve_managed_usage('ai_generations',$1,NULL,true)", [
        tenant,
      ])
    ).rejects.toThrow(/permission denied/);
  });
  it('does not confuse a tenant owner with a platform administrator', async () => {
    await user();
    const result = await db.query<{ allowed: boolean }>(
      'SELECT is_platform_admin() AS allowed'
    );
    expect(result.rows[0].allowed).toBe(false);
    await expect(
      db.query("SELECT managed_record_payment($1,'PAY-1',10000,'INR')", [
        tenant,
      ])
    ).rejects.toThrow(/Platform administrator/);
  });
  it('protects credential tables even from workspace owners', async () => {
    await user();
    await expect(
      db.query('SELECT access_token FROM whatsapp_config WHERE account_id=$1', [
        tenant,
      ])
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query('SELECT api_key FROM ai_configs WHERE account_id=$1', [tenant])
    ).rejects.toThrow(/permission denied/);
  });
  it('keeps membership and plan restrictions in direct database writes', async () => {
    await user();
    await db.query(
      "INSERT INTO contacts(account_id,name) VALUES($1,'Allowed')",
      [tenant]
    );
    await expect(
      db.query(
        "INSERT INTO contacts(account_id,name) VALUES($1,'Other tenant')",
        [other]
      )
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.query('INSERT INTO flows(account_id) VALUES($1)', [tenant])
    ).rejects.toThrow(/subscription|row-level security/);
    await expect(
      db.query("UPDATE managed_subscriptions SET status='active'")
    ).rejects.toThrow(/permission denied/);
  });
  it('does not grant managed configuration access through an extra capability', async () => {
    await db.query(
      "UPDATE managed_subscriptions SET extra_capabilities=ARRAY['ai.configure','whatsapp.manage'] WHERE account_id=$1",
      [tenant]
    );
    await user();
    const result = await db.query<{ allowed: boolean }>(
      'SELECT managed_user_can($1,$2) AS allowed',
      [tenant, 'ai.configure']
    );
    expect(result.rows[0].allowed).toBe(false);
  });
  it('serializes concurrent requests at the exact allowance', async () => {
    await db.exec('SET ROLE service_role');
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        db.query("SELECT reserve_managed_usage('ai_generations',$1)", [tenant])
      )
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3);
    const used = await db.query<{ used: number }>(
      'SELECT used::integer FROM managed_usage WHERE account_id=$1',
      [tenant]
    );
    expect(used.rows[0].used).toBe(2);
  });
  it('blocks background sends after suspension and preserves incoming data', async () => {
    await db.query(
      "UPDATE managed_subscriptions SET status='suspended' WHERE account_id=$1",
      [tenant]
    );
    await db.exec('SET ROLE service_role');
    await expect(
      db.query("SELECT reserve_managed_usage('outbound_attempts',NULL,'111')")
    ).rejects.toThrow(/inactive/);
    await db.query(
      "INSERT INTO contacts(account_id,name) VALUES($1,'Inbound customer')",
      [tenant]
    );
  });
  it('denies an expired period even when its status is active', async () => {
    await db.query(
      "UPDATE managed_subscriptions SET period_start=now()-interval '2 months',period_end=now()-interval '1 month' WHERE account_id=$1",
      [tenant]
    );
    await db.exec('SET ROLE service_role');
    await expect(
      db.query("SELECT reserve_managed_usage('ai_generations',$1)", [tenant])
    ).rejects.toThrow(/inactive/);
  });
  it('records manual payments idempotently and rejects changed references', async () => {
    await admin();
    const a = await db.query<{ id: string }>(
      "SELECT managed_record_payment($1,'BANK-1',2500000,'INR') AS id",
      [tenant]
    );
    const b = await db.query<{ id: string }>(
      "SELECT managed_record_payment($1,'BANK-1',2500000,'INR') AS id",
      [tenant]
    );
    expect(a.rows[0].id).toBe(b.rows[0].id);
    await expect(
      db.query("SELECT managed_record_payment($1,'BANK-1',100,'INR')", [tenant])
    ).rejects.toThrow(/different details/);
  });
  it('prevents another tenant from reading payments', async () => {
    await admin();
    await db.query("SELECT managed_record_payment($1,'BANK-1',100,'INR')", [
      tenant,
    ]);
    await db.exec('RESET ROLE');
    await db.query('DELETE FROM platform_users WHERE user_id=$1', [platform]);
    await user(platform);
    const rows = await db.query('SELECT * FROM managed_payments');
    expect(rows.rows).toHaveLength(0);
  });
  it('requires explicit managed signup and starts new accounts pending', async () => {
    await db.exec('UPDATE managed_platform_settings SET managed_signup=true');
    const account = '10000000-0000-0000-0000-000000000003';
    await db.query("INSERT INTO accounts VALUES($1,'New client',$2)", [
      account,
      owner,
    ]);
    const result = await db.query<{ status: string }>(
      'SELECT status FROM managed_subscriptions WHERE account_id=$1',
      [account]
    );
    expect(result.rows[0].status).toBe('pending');
  });
  it('keeps draft changes separate and rejects stale publication', async () => {
    await db.query(
      "INSERT INTO ai_configs VALUES($1,'encrypted','Original live prompt',false,false,3)",
      [tenant]
    );
    await admin();
    await db.query(
      "SELECT managed_save_business($1,'Example','Wholesale catalogue','support@example.test','9–5')",
      [tenant]
    );
    await db.query(
      "SELECT managed_save_ai_draft($1,'New instructions',true,5,NULL)",
      [tenant]
    );
    await db.exec('RESET ROLE');
    const before = await db.query<{ system_prompt: string }>(
      'SELECT system_prompt FROM ai_configs WHERE account_id=$1',
      [tenant]
    );
    expect(before.rows[0].system_prompt).toBe('Original live prompt');
    await admin();
    await expect(
      db.query('SELECT managed_publish_ai($1,9)', [tenant])
    ).rejects.toThrow(/Draft changed/);
    await db.query('SELECT managed_publish_ai($1,1)', [tenant]);
    await db.exec('RESET ROLE');
    const after = await db.query<{ system_prompt: string; is_active: boolean }>(
      'SELECT system_prompt,is_active FROM ai_configs WHERE account_id=$1',
      [tenant]
    );
    expect(after.rows[0].system_prompt).toContain('New instructions');
    expect(after.rows[0].system_prompt).toContain('Example');
    expect(after.rows[0].is_active).toBe(true);
  });
});
