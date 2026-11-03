import { describe, expect, it } from 'vitest';
import { isCallingNotEnabledError } from './broadcast-errors';

describe('broadcast calling configuration errors', () => {
  it.each([
    '(#138000) Calling API not enabled. Enable calling for this phone number.',
    '138000',
    'Meta returned code: 138000',
    'Calling is not enabled on the business phone number.',
    'Calling APIs are not enabled for this phone number',
  ])('recognizes a failure requiring Meta setup: %s', (message) => {
    expect(isCallingNotEnabledError(message)).toBe(true);
  });
  it.each([undefined, null, '', '(#131030) Recipient is not on the allowed list', '(#130429) Rate limit reached', 'Recipient +919138000123 failed', '(#1380001) Other error'])('does not misclassify other failures: %s', (message) => {
    expect(isCallingNotEnabledError(message)).toBe(false);
  });
});
