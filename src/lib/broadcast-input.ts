import { parseInternationalPhone } from '@/lib/whatsapp/phone-utils';
import { normalizeTemplatePhoneNumber } from '@/lib/whatsapp/template-phone';
import type { BroadcastCsvContact } from './broadcast-csv';

export type BroadcastDefaultCountry = 'IN' | 'international';

/** National input is interpreted only when the user explicitly selects India. */
export function normalizeBroadcastPhone(
  raw: string,
  country: BroadcastDefaultCountry
): string | null {
  if (country === 'IN') return normalizeTemplatePhoneNumber(raw);
  const digits = parseInternationalPhone(raw);
  return digits ? `+${digits}` : null;
}

export interface ParsedBroadcastNumbers {
  contacts: BroadcastCsvContact[];
  duplicates: number;
  invalid: number;
  invalidEntries: string[];
}

/** Parse plain numbers without a CSV header. Formatting spaces inside a number are retained. */
export function parseBroadcastNumbers(
  text: string,
  country: BroadcastDefaultCountry = 'IN'
): ParsedBroadcastNumbers {
  const result: ParsedBroadcastNumbers = {
    contacts: [],
    duplicates: 0,
    invalid: 0,
    invalidEntries: [],
  };
  const seen = new Set<string>();
  const entries = text.split(/[\r\n,;\t|]+/).flatMap((part) => {
    const value = part.trim();
    if (!value) return [];
    if (normalizeBroadcastPhone(value, country)) return [value];
    // Also accept space-separated lists of complete, unformatted numbers.
    const tokens = value.split(/\s+/);
    return tokens.length > 1 &&
      tokens.every((token) => /^\+?\d{8,15}$/.test(token))
      ? tokens
      : [value];
  });
  for (const entry of entries) {
    const phone = normalizeBroadcastPhone(entry, country);
    if (!phone) {
      result.invalid++;
      if (result.invalidEntries.length < 5) result.invalidEntries.push(entry);
    } else if (seen.has(phone)) {
      result.duplicates++;
    } else {
      seen.add(phone);
      result.contacts.push({ phone });
    }
  }
  return result;
}
