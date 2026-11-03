import { object } from './payload';

export class CoexistenceError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export function coexistenceSetup() {
  const appId = process.env.META_APP_ID?.trim() ?? '';
  const configId = process.env.META_WHATSAPP_CONFIG_ID?.trim() ?? '';
  const secret =
    process.env.META_COEXISTENCE_APP_SECRET?.trim() ||
    process.env.META_APP_SECRET?.trim() ||
    '';
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ?? '';
  const version = process.env.META_GRAPH_API_VERSION?.trim() || 'v24.0';
  const missing = [
    !/^\d+$/.test(appId) && 'META_APP_ID',
    !/^\d+$/.test(configId) && 'META_WHATSAPP_CONFIG_ID',
    (!secret || secret.includes(',')) && 'META_COEXISTENCE_APP_SECRET',
    !verifyToken && 'META_WEBHOOK_VERIFY_TOKEN',
    !/^v\d+\.0$/.test(version) && 'META_GRAPH_API_VERSION',
  ].filter((s): s is string => typeof s === 'string');
  return {
    appId,
    configId,
    secret,
    verifyToken,
    version,
    missing,
    ready: missing.length === 0,
  };
}

async function graph(
  path: string,
  token: string | null,
  body?: Record<string, unknown>
) {
  const setup = coexistenceSetup();
  const response = await fetch(
    `https://graph.facebook.com/${setup.version}/${path}`,
    {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }
  );
  const data = object(await response.json());
  if (!response.ok || data.error) {
    const error = object(data.error);
    // Do not log Graph URLs, authorization codes, access tokens, or raw errors.
    const code =
      typeof error.code === 'number' ? ` (Meta code ${error.code})` : '';
    throw new CoexistenceError(
      `WhatsApp could not complete this step${code}. Check your Meta app permissions and number eligibility.`,
      502
    );
  }
  return data;
}

export async function exchangeCoexistenceCode(code: string): Promise<string> {
  const { appId, secret } = coexistenceSetup();
  // Meta documents code exchange as a server-side GET. Never log this URL:
  // the app secret and short-lived authorization code are query parameters.
  const query = new URLSearchParams({
    client_id: appId,
    client_secret: secret,
    code,
  });
  const data = await graph(`oauth/access_token?${query}`, null);
  if (typeof data.access_token !== 'string' || !data.access_token)
    throw new CoexistenceError('Meta did not return an access token.', 502);
  const token = data.access_token;
  const debug = object(
    (
      await graph(
        `debug_token?input_token=${encodeURIComponent(token)}`,
        `${appId}|${secret}`
      )
    ).data
  );
  if (debug.is_valid !== true || debug.app_id !== appId)
    throw new CoexistenceError(
      'Meta returned a token for a different app or an expired connection.',
      403
    );
  return token;
}

export async function findCoexistencePhone(
  token: string,
  wabaId: string,
  phoneNumberId?: string
) {
  const data = await graph(
    `${wabaId}/phone_numbers?fields=id,display_phone_number,is_on_biz_app,platform_type&limit=100`,
    token
  );
  const phones = Array.isArray(data.data) ? data.data.map(object) : [];
  const eligible = phones.filter(
    (p) =>
      p.is_on_biz_app === true &&
      p.platform_type === 'CLOUD_API' &&
      (!phoneNumberId || p.id === phoneNumberId)
  );
  if (eligible.length !== 1 || typeof eligible[0].id !== 'string')
    throw new CoexistenceError(
      'Choose one existing WhatsApp Business app number in Meta signup. The selected number must support both the Business app and Cloud API.'
    );
  return {
    id: eligible[0].id,
    display: String(eligible[0].display_phone_number || ''),
  };
}

export async function subscribeCoexistenceWaba(token: string, wabaId: string) {
  await graph(`${wabaId}/subscribed_apps`, token, {});
}

export async function requestCoexistenceSync(
  token: string,
  phoneId: string,
  type: 'history' | 'smb_app_state_sync'
) {
  const result = await graph(`${phoneId}/smb_app_data`, token, {
    messaging_product: 'whatsapp',
    sync_type: type,
  });
  if (typeof result.request_id !== 'string')
    throw new CoexistenceError(
      'Meta accepted the request without a sync reference. Check synchronization status before reconnecting.',
      502
    );
  return result.request_id;
}
