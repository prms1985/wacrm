import { object } from './payload';

export function isFacebookOrigin(origin: string): boolean {
  return [
    'https://www.facebook.com',
    'https://web.facebook.com',
    'https://business.facebook.com',
  ].includes(origin);
}

export function signupEvent(origin: string, raw: unknown) {
  if (!isFacebookOrigin(origin)) return null;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > 16000) return null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const event = object(parsed),
    data = object(event.data);
  if (event.type !== 'WA_EMBEDDED_SIGNUP') return null;
  if (['CANCEL', 'ERROR'].includes(String(event.event)))
    return { cancelled: true as const };
  if (
    !['FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', 'FINISH'].includes(
      String(event.event)
    )
  )
    return null;
  const ids = Array.isArray(data.messaging_account_ids)
    ? data.messaging_account_ids
    : [];
  const wabaId = data.waba_id || (ids.length === 1 ? ids[0] : null);
  if (typeof wabaId !== 'string' || !/^\d+$/.test(wabaId)) return null;
  const phoneId =
    typeof data.phone_number_id === 'string' &&
    /^\d+$/.test(data.phone_number_id)
      ? data.phone_number_id
      : undefined;
  return {
    cancelled: false as const,
    waba_id: wabaId,
    phone_number_id: phoneId,
  };
}
