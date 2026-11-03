import { describe, it, expect } from 'vitest';
import {
  normalizeCapabilities,
  parseAmountMinor,
  formatPrice,
} from './catalog';
describe('subscription input boundaries', () => {
  it('preserves recorded payment fractions in the displayed amount', () => {
    expect(formatPrice(2500005, 'INR')).toContain('25,000.05');
  });
  it('keeps money in exact minor units', () => {
    expect(parseAmountMinor('25000.05')).toBe(2500005);
    expect(parseAmountMinor('0.10')).toBe(10);
  });
  it.each(['-1', '1e6', '12.001', 'NaN', '1,000', 'Infinity'])(
    'rejects invalid amount %s',
    (value) => {
      expect(() => parseAmountMinor(value)).toThrow();
    }
  );
  it('never grants platform-managed features to a client', () => {
    expect(
      normalizeCapabilities([
        'ai.configure',
        'whatsapp.manage',
        'broadcast.send',
        'broadcast.send',
      ])
    ).toEqual(['broadcast.send']);
  });
  it('rejects unknown capabilities', () => {
    expect(() => normalizeCapabilities(['platform.admin'])).toThrow();
  });
});
