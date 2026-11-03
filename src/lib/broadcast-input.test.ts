import { describe, expect, it } from 'vitest';
import {
  normalizeBroadcastPhone,
  parseBroadcastNumbers,
} from './broadcast-input';

describe('pasted broadcast numbers', () => {
  it('accepts numbers alone, normalizes Indian formats, and removes duplicates', () => {
    expect(
      parseBroadcastNumbers(
        '9884488178\n+91 98844 88178,9876543210;919876543210\ninvalid'
      )
    ).toEqual({
      contacts: [{ phone: '+919884488178' }, { phone: '+919876543210' }],
      duplicates: 2,
      invalid: 1,
      invalidEntries: ['invalid'],
    });
  });
  it('supports formatting spaces, tabs, CRLF, international numbers and Indian-script digits', () => {
    expect(
      parseBroadcastNumbers('98844 88178\r\n\t+1 (555) 123-4567;९८७६५४३२१०')
        .contacts
    ).toEqual([
      { phone: '+919884488178' },
      { phone: '+15551234567' },
      { phone: '+919876543210' },
    ]);
  });
  it('supports space-separated complete numbers without splitting a formatted number', () => {
    expect(
      parseBroadcastNumbers('9884488178 9876543210').contacts
    ).toHaveLength(2);
    expect(parseBroadcastNumbers('+91 98844 88178').contacts).toEqual([
      { phone: '+919884488178' },
    ]);
  });
  it('requires explicit country codes in international mode', () => {
    expect(
      parseBroadcastNumbers(
        '9884488178\n+919884488178\n+442079460958',
        'international'
      )
    ).toMatchObject({
      contacts: [{ phone: '+919884488178' }, { phone: '+442079460958' }],
      invalid: 1,
    });
    expect(normalizeBroadcastPhone('4155551212', 'international')).toBeNull();
  });
  it('returns no recipients for an empty input or invalid numbers', () => {
    expect(parseBroadcastNumbers(' \n ,;\t').contacts).toEqual([]);
    expect(parseBroadcastNumbers('988448817\n1.23E+12\ncall me').invalid).toBe(
      3
    );
  });
  it('limits invalid examples while retaining the full invalid count', () => {
    const result = parseBroadcastNumbers(
      Array.from({ length: 20 }, (_, index) => `invalid-${index}`).join('\n')
    );
    expect(result.invalid).toBe(20);
    expect(result.invalidEntries).toHaveLength(5);
  });
});
