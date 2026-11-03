import { describe, expect, it } from 'vitest';
import {
  hasHistoryContext,
  parseCoexistenceChange,
  timestamp,
} from './payload';
import { signupEvent, isFacebookOrigin } from './client';
import { createOnboardingState, verifyOnboardingState } from './state';

const sent = {
  id: 'wamid.phone',
  from: '919999999999',
  to: '918888888888',
  timestamp: '1760000000',
  type: 'text',
  text: { body: 'I will help you' },
};

describe('Coexistence payload boundaries', () => {
  it('stores a phone echo as outgoing to the customer, never the business', () => {
    expect(
      parseCoexistenceChange('smb_message_echoes', { message_echoes: [sent] })
        .messages[0]
    ).toMatchObject({
      phone: sent.to,
      sender_type: 'agent',
      source: 'business_app',
      content_text: 'I will help you',
    });
  });
  it('preserves history direction and thread identity when from/to are absent', () => {
    const result = parseCoexistenceChange('history', {
      history: [
        {
          metadata: { progress: 100 },
          threads: [
            {
              id: sent.to,
              messages: [
                {
                  ...sent,
                  to: undefined,
                  from: undefined,
                  history_context: { from_me: true, status: 'read' },
                },
                {
                  ...sent,
                  id: 'wamid.inbound',
                  to: undefined,
                  from: undefined,
                  history_context: { from_me: false },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.history_status).toBe('complete');
    expect(
      result.messages.map((m) => [m.phone, m.sender_type, m.source])
    ).toEqual([
      [sent.to, 'agent', 'history'],
      [sent.to, 'customer', 'history'],
    ]);
    expect(result.messages[0].status).toBe('read');
  });
  it('keeps historical media separate from live message responders', () => {
    const raw = {
      ...sent,
      history_context: { from_me: true },
      type: 'image',
      image: { id: '1234', mime_type: 'image/jpeg', caption: 'Photo' },
    };
    expect(hasHistoryContext(raw)).toBe(true);
    expect(
      parseCoexistenceChange('history', { messages: [raw] }).messages[0]
    ).toMatchObject({
      source: 'history',
      media_url: '/api/whatsapp/media/1234',
      media_type: 'image/jpeg',
      content_text: 'Photo',
    });
  });
  it('treats denied history as a customer choice', () => {
    expect(
      parseCoexistenceChange('history', {
        history: [{ errors: [{ code: 2593109 }] }],
      })
    ).toMatchObject({ history_status: 'declined', error: null, messages: [] });
  });
  it('supports seconds and milliseconds and rejects invalid timestamps', () => {
    expect(timestamp('1760000000')).toBe(timestamp('1760000000000'));
    for (const invalid of ['', 'NaN', '-10', '99999999999999999', null])
      expect(timestamp(invalid)).toBeNull();
  });
  it('imports address-book additions and removals with their timestamps', () => {
    const result = parseCoexistenceChange('smb_app_state_sync', {
      state_sync: [
        {
          type: 'contact',
          action: 'add',
          contact: { phone_number: sent.to, full_name: 'Customer' },
          metadata: { timestamp: '1760000000000' },
        },
        {
          type: 'contact',
          action: 'remove',
          contact: { phone_number: sent.to },
          metadata: { timestamp: '1760000001000' },
        },
      ],
    });
    expect(result.contacts.map((c) => c.removed)).toEqual([false, true]);
    expect(result.contacts[1].changed_at).toBe('2025-10-09T08:53:21.000Z');
  });
  it('rejects invalid identities and timestamps without creating CRM records', () => {
    expect(
      parseCoexistenceChange('smb_message_echoes', {
        message_echoes: [
          { ...sent, to: 'bad' },
          { ...sent, timestamp: 'bad' },
        ],
      }).messages
    ).toEqual([]);
  });
  it('supports business-scoped identities in phone echoes', () => {
    expect(
      parseCoexistenceChange('smb_message_echoes', {
        message_echoes: [
          { ...sent, to: undefined, to_user_id: 'US.ENT.123456789' },
        ],
      }).messages[0]
    ).toMatchObject({ phone: '', user_id: 'US.ENT.123456789' });
  });
});

describe('Embedded Signup security', () => {
  it('accepts only exact Meta origins and supported finish events', () => {
    const raw = {
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
      data: { waba_id: '1234' },
    };
    expect(
      signupEvent('https://www.facebook.com', JSON.stringify(raw))
    ).toMatchObject({ waba_id: '1234', cancelled: false });
    for (const origin of [
      'https://facebook.com.attacker.test',
      'https://attacker.facebook.com',
      'http://www.facebook.com',
      'null',
    ]) {
      expect(isFacebookOrigin(origin)).toBe(false);
      expect(signupEvent(origin, raw)).toBeNull();
    }
  });
  it('accepts one messaging account ID and refuses an ambiguous selection', () => {
    const raw = {
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { messaging_account_ids: ['1234'] },
    };
    expect(signupEvent('https://www.facebook.com', raw)).toMatchObject({
      waba_id: '1234',
    });
    raw.data.messaging_account_ids.push('5678');
    expect(signupEvent('https://www.facebook.com', raw)).toBeNull();
  });
  it('binds a signed onboarding session to the account, user and nonce', () => {
    const session = createOnboardingState('account-1', 'user-1');
    expect(
      verifyOnboardingState(
        session.cookie,
        session.state,
        'account-1',
        'user-1'
      )
    ).toBe(true);
    expect(
      verifyOnboardingState(
        session.cookie,
        session.state,
        'account-2',
        'user-1'
      )
    ).toBe(false);
    expect(
      verifyOnboardingState(
        session.cookie,
        session.state,
        'account-1',
        'user-2'
      )
    ).toBe(false);
    expect(
      verifyOnboardingState(
        session.cookie,
        'x'.repeat(43),
        'account-1',
        'user-1'
      )
    ).toBe(false);
    expect(
      verifyOnboardingState(
        `x${session.cookie}`,
        session.state,
        'account-1',
        'user-1'
      )
    ).toBe(false);
  });
});
