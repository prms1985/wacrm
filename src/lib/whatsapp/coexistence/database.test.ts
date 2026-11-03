import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseCoexistenceChange } from './payload';

const account = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const user = '20000000-0000-0000-0000-000000000001';
const otherUser = '20000000-0000-0000-0000-000000000002';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  // Minimal existing schema, using the same partial identity indexes and
  // constraints as migrations 022, 036, 037, and 040. Run 066 verbatim.
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE accounts(id uuid PRIMARY KEY);
    CREATE TABLE profiles(user_id uuid PRIMARY KEY, account_id uuid, account_role text);
    CREATE TABLE whatsapp_config(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid UNIQUE REFERENCES accounts(id), user_id uuid UNIQUE,
      phone_number_id text UNIQUE, waba_id text, access_token text, verify_token text, status text, connected_at timestamptz, registered_at timestamptz,
      subscribed_apps_at timestamptz, last_registration_error text, updated_at timestamptz DEFAULT now());
    CREATE TABLE contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid, user_id uuid, phone text NOT NULL,
      phone_normalized text GENERATED ALWAYS AS (regexp_replace(phone, '[^0-9]', '', 'g')) STORED, wa_user_id text, name text);
    CREATE UNIQUE INDEX contact_phone ON contacts(account_id, phone_normalized) WHERE phone_normalized <> '';
    CREATE UNIQUE INDEX contact_user ON contacts(account_id, wa_user_id) WHERE wa_user_id IS NOT NULL;
    CREATE TABLE conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid, user_id uuid, contact_id uuid REFERENCES contacts(id),
      last_message_text text, last_message_at timestamptz, last_inbound_at timestamptz, first_inbound_at timestamptz, last_reply_at timestamptz, updated_at timestamptz,
      unread_count integer DEFAULT 0, ai_autoreply_disabled boolean DEFAULT false, UNIQUE(account_id, contact_id));
    CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid REFERENCES conversations(id), sender_type text,
      content_type text CHECK(content_type IN ('text','image','video','audio','document','location','interactive','template')), content_text text,
      media_url text, media_type text, message_id text, status text, created_at timestamptz, UNIQUE(conversation_id,message_id));
    CREATE TABLE flow_runs(account_id uuid, contact_id uuid, status text, ended_at timestamptz, end_reason text);
  `);
  await db.exec(
    readFileSync(
      join(process.cwd(), 'supabase/migrations/066_whatsapp_coexistence.sql'),
      'utf8'
    )
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(
    `TRUNCATE whatsapp_coexistence_events,whatsapp_app_contacts,whatsapp_coexistence,messages,conversations,contacts,flow_runs,whatsapp_config,profiles,accounts CASCADE`
  );
  await db.query('INSERT INTO accounts VALUES($1),($2)', [account, other]);
  await db.query("INSERT INTO profiles VALUES($1,$2,'owner'),($3,$4,'owner')", [
    user,
    account,
    otherUser,
    other,
  ]);
  await connect();
});

async function connect(accountId = account, userId = user, phoneId = '111') {
  await db.query(
    "SELECT connect_whatsapp_coexistence($1,$2,$3,'+91 99999 99999','333','encrypted-token','encrypted-verify')",
    [accountId, userId, phoneId]
  );
}
async function enqueue(
  field: string,
  value: unknown,
  key = crypto.randomUUID(),
  waba = '333'
) {
  const result = await db.query<{ id: string | null }>(
    'SELECT enqueue_whatsapp_coexistence($1,$2,$3::jsonb,$4) AS id',
    [
      waba,
      field,
      JSON.stringify({
        metadata: { phone_number_id: '111' },
        ...(value as object),
      }),
      key,
    ]
  );
  return result.rows[0].id;
}
async function apply(field: string, value: unknown, key?: string) {
  const id = await enqueue(field, value, key);
  const batch = parseCoexistenceChange(field, value);
  await db.query('SELECT apply_whatsapp_coexistence_event($1,$2::jsonb)', [
    id,
    JSON.stringify(batch),
  ]);
  return id;
}
const echo = (
  id = 'wamid.phone',
  body = 'Phone reply',
  time = '1760000000'
) => ({
  message_echoes: [
    {
      id,
      from: '919999999999',
      to: '918888888888',
      timestamp: time,
      type: 'text',
      text: { body },
    },
  ],
});
const history = (
  id = 'wamid.history',
  body = 'Old message',
  time = '1750000000'
) => ({
  history: [
    {
      metadata: { progress: 100 },
      threads: [
        {
          id: '918888888888',
          messages: [
            {
              id,
              timestamp: time,
              type: 'text',
              text: { body },
              history_context: { from_me: false },
            },
          ],
        },
      ],
    },
  ],
});

describe('Coexistence transactional imports', () => {
  it('deduplicates replayed events and replayed messages with different event envelopes', async () => {
    await apply('smb_message_echoes', echo(), 'same');
    await apply('smb_message_echoes', echo(), 'same');
    await apply('smb_message_echoes', echo(), 'different-envelope');
    expect((await db.query('SELECT * FROM messages')).rows).toHaveLength(1);
    expect((await db.query('SELECT * FROM contacts')).rows).toHaveLength(1);
    const conversation = (await db.query('SELECT * FROM conversations'))
      .rows[0];
    expect(conversation).toMatchObject({
      unread_count: 0,
      ai_autoreply_disabled: true,
    });
  });
  it('pauses active flows when a human replies from the phone', async () => {
    await apply('history', history());
    await db.exec(
      "INSERT INTO flow_runs SELECT account_id,contact_id,'active',null,null FROM conversations"
    );
    await apply('smb_message_echoes', echo());
    expect(
      (await db.query('SELECT status,end_reason FROM flow_runs')).rows[0]
    ).toEqual({ status: 'paused_by_agent', end_reason: 'agent_replied' });
  });
  it('keeps an older import from changing the live preview or unread count', async () => {
    await apply('smb_message_echoes', echo());
    await db.exec(
      'UPDATE conversations SET unread_count=3,ai_autoreply_disabled=false'
    );
    await apply('history', history());
    expect(
      (
        await db.query(
          'SELECT last_message_text,unread_count,ai_autoreply_disabled FROM conversations'
        )
      ).rows[0]
    ).toEqual({
      last_message_text: 'Phone reply',
      unread_count: 3,
      ai_autoreply_disabled: false,
    });
    expect(
      (
        await db.query(
          'SELECT history_status,history_progress FROM whatsapp_coexistence'
        )
      ).rows[0]
    ).toEqual({ history_status: 'complete', history_progress: 100 });
  });
  it('enriches historical media placeholders without duplicating messages or pausing AI', async () => {
    await apply('history', {
      history: [
        {
          threads: [
            {
              id: '918888888888',
              messages: [
                {
                  id: 'wamid.media',
                  timestamp: '1760000000',
                  type: 'media_placeholder',
                  history_context: { from_me: true },
                },
              ],
            },
          ],
        },
      ],
    });
    await apply('history', {
      messages: [
        {
          id: 'wamid.media',
          to: '918888888888',
          timestamp: '1760000000',
          type: 'image',
          image: { id: 'media-1', caption: 'Photo' },
          history_context: { from_me: true },
        },
      ],
    });
    expect(
      (
        await db.query(
          'SELECT content_type,content_text,media_url,whatsapp_media_placeholder FROM messages'
        )
      ).rows
    ).toEqual([
      {
        content_type: 'image',
        content_text: 'Photo',
        media_url: '/api/whatsapp/media/media-1',
        whatsapp_media_placeholder: false,
      },
    ]);
    expect(
      (
        await db.query<{ ai_autoreply_disabled: boolean }>(
          'SELECT ai_autoreply_disabled FROM conversations'
        )
      ).rows[0].ai_autoreply_disabled
    ).toBe(false);
  });
  it('preserves custom CRM names and records removals without deleting customer data', async () => {
    const change = (action: string, name: string, time: string) => ({
      state_sync: [
        {
          type: 'contact',
          action,
          contact: { phone_number: '918888888888', full_name: name },
          metadata: { timestamp: time },
        },
      ],
    });
    await apply(
      'smb_app_state_sync',
      change('add', 'Phone name', '1760000000')
    );
    await db.exec("UPDATE contacts SET name='CRM name'");
    await apply(
      'smb_app_state_sync',
      change('add', 'Changed phone name', '1760000001')
    );
    await apply(
      'smb_app_state_sync',
      change('add', 'Out of order', '1750000000')
    );
    await apply('smb_app_state_sync', change('remove', '', '1760000002'));
    expect((await db.query('SELECT name FROM contacts')).rows).toEqual([
      { name: 'CRM name' },
    ]);
    expect(
      (
        await db.query<{ removed: boolean }>(
          'SELECT removed FROM whatsapp_app_contacts'
        )
      ).rows[0].removed
    ).toBe(true);
  });
  it('accepts business-scoped customers without a phone number', async () => {
    await apply('smb_message_echoes', {
      message_echoes: [
        {
          id: 'wamid.bsuid',
          to_user_id: 'US.ENT.123456789',
          timestamp: '1760000000',
          type: 'text',
          text: { body: 'Hello' },
        },
      ],
    });
    expect(
      (await db.query('SELECT phone,wa_user_id FROM contacts')).rows
    ).toEqual([{ phone: '', wa_user_id: 'US.ENT.123456789' }]);
  });
  it('rolls back every write and keeps the queue item pending on a failed import', async () => {
    const id = await enqueue('smb_message_echoes', echo());
    const batch = parseCoexistenceChange('smb_message_echoes', echo());
    batch.messages[0].content_type = 'invalid-database-type';
    await expect(
      db.query('SELECT apply_whatsapp_coexistence_event($1,$2::jsonb)', [
        id,
        JSON.stringify(batch),
      ])
    ).rejects.toThrow();
    expect((await db.query('SELECT * FROM contacts')).rows).toHaveLength(0);
    expect(
      (
        await db.query<{ processed_at: string | null }>(
          'SELECT processed_at FROM whatsapp_coexistence_events'
        )
      ).rows[0].processed_at
    ).toBeNull();
  });
  it('does not let an event for another account or phone enter this import queue', async () => {
    expect(
      await enqueue('smb_message_echoes', echo(), 'other-waba', '999')
    ).toBeNull();
    expect(
      await enqueue('smb_message_echoes', {
        metadata: { phone_number_id: '222' },
        ...echo(),
      })
    ).toBeNull();
    expect(
      (await db.query('SELECT * FROM whatsapp_coexistence_events')).rows
    ).toHaveLength(0);
  });
  it('refuses another tenant taking this phone and rolls back its config', async () => {
    await expect(connect(other, otherUser)).rejects.toThrow();
    expect(
      (await db.query('SELECT account_id FROM whatsapp_config')).rows
    ).toEqual([{ account_id: account }]);
  });
  it('enforces administrator membership in the connection transaction', async () => {
    await db.query(
      "UPDATE profiles SET account_role='agent' WHERE user_id=$1",
      [otherUser]
    );
    await expect(connect(other, otherUser, '222')).rejects.toThrow(
      'administrator required'
    );
  });
  it('does not expose privileged import functions to browser database roles', async () => {
    const result = await db.query<{ permitted: boolean }>(
      "SELECT has_function_privilege('authenticated','public.apply_whatsapp_coexistence_event(uuid,jsonb)','execute') AS permitted"
    );
    expect(result.rows[0].permitted).toBe(false);
  });
  it('resumes a large event from its saved cursor and ignores an older batch replay', async () => {
    const raw = {
      message_echoes: [
        ...echo('wamid.first').message_echoes,
        ...echo('wamid.second').message_echoes,
      ],
    };
    const id = await enqueue('smb_message_echoes', raw);
    const batch = parseCoexistenceChange('smb_message_echoes', raw);
    const first = {
      ...batch,
      offset: 0,
      done: false,
      messages: batch.messages.slice(0, 1),
    };
    await db.query('SELECT apply_whatsapp_coexistence_event($1,$2::jsonb)', [
      id,
      JSON.stringify(first),
    ]);
    await db.query('SELECT apply_whatsapp_coexistence_event($1,$2::jsonb)', [
      id,
      JSON.stringify(first),
    ]);
    expect(
      (
        await db.query(
          'SELECT processed_items,processed_at FROM whatsapp_coexistence_events'
        )
      ).rows
    ).toEqual([{ processed_items: 1, processed_at: null }]);
    await db.query('SELECT apply_whatsapp_coexistence_event($1,$2::jsonb)', [
      id,
      JSON.stringify({
        ...batch,
        offset: 1,
        done: true,
        messages: batch.messages.slice(1),
      }),
    ]);
    expect((await db.query('SELECT * FROM messages')).rows).toHaveLength(2);
    expect(
      (
        await db.query<{ processed_at: string | null }>(
          'SELECT processed_at FROM whatsapp_coexistence_events'
        )
      ).rows[0].processed_at
    ).not.toBeNull();
  });
  it('does not apply queued events belonging to a previous connection session', async () => {
    const raw = echo();
    const staleId = await enqueue('smb_message_echoes', raw);
    await apply('account_update', {
      event: 'PARTNER_REMOVED',
      phone_number: '919999999999',
    });
    await connect();
    await db.query('SELECT apply_whatsapp_coexistence_event($1,$2::jsonb)', [
      staleId,
      JSON.stringify(parseCoexistenceChange('smb_message_echoes', raw)),
    ]);
    expect((await db.query('SELECT * FROM messages')).rows).toHaveLength(0);
  });
  it('prioritizes phone replies ahead of historical imports', async () => {
    await enqueue('history', history());
    await enqueue('smb_message_echoes', echo());
    expect(
      (
        await db.query(
          'SELECT field FROM whatsapp_coexistence_events ORDER BY priority,created_at'
        )
      ).rows[0]
    ).toEqual({ field: 'smb_message_echoes' });
  });
  it('marks only the matching phone disconnected when the partner is removed', async () => {
    await apply('account_update', {
      event: 'PARTNER_REMOVED',
      phone_number: '919999999999',
    });
    expect(
      (await db.query<{ status: string }>('SELECT status FROM whatsapp_config'))
        .rows[0].status
    ).toBe('disconnected');
    expect(await enqueue('smb_message_echoes', echo())).toBeNull();
  });
});
