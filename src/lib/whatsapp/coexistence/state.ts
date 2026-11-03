import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ONBOARDING_COOKIE = 'aiba_whatsapp_onboarding';
export const ONBOARDING_TTL = 10 * 60;
const sign = (value: string) =>
  createHmac('sha256', process.env.ENCRYPTION_KEY!)
    .update(value)
    .digest('base64url');

export function createOnboardingState(accountId: string, userId: string) {
  const state = randomBytes(32).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      accountId,
      userId,
      state,
      expires: Date.now() + ONBOARDING_TTL * 1000,
    })
  ).toString('base64url');
  return { state, cookie: `${payload}.${sign(payload)}` };
}

export function verifyOnboardingState(
  cookie: string | undefined,
  state: unknown,
  accountId: string,
  userId: string
): boolean {
  if (!cookie || typeof state !== 'string' || state.length !== 43) return false;
  const [payload, signature, extra] = cookie.split('.');
  if (!payload || !signature || extra) return false;
  const expected = Buffer.from(sign(payload)),
    received = Buffer.from(signature);
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return (
      data.accountId === accountId &&
      data.userId === userId &&
      data.expires > Date.now() &&
      data.state === state
    );
  } catch {
    return false;
  }
}
