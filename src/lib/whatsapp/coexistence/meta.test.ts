import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exchangeCoexistenceCode,
  findCoexistencePhone,
  requestCoexistenceSync,
} from './meta';

const fetchMock = vi.fn();
const response = (data: unknown) => new Response(JSON.stringify(data));
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('META_APP_ID', '1234');
  vi.stubEnv('META_APP_SECRET', 'secret');
  vi.stubEnv('META_GRAPH_API_VERSION', 'v24.0');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Coexistence Graph requests', () => {
  it('exchanges the code server-side and verifies the issued token belongs to this app', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ access_token: 'token' }))
      .mockResolvedValueOnce(
        response({ data: { is_valid: true, app_id: '1234' } })
      );
    expect(await exchangeCoexistenceCode('code')).toBe('token');
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/v24.0/oauth/access_token');
    expect(new URL(url).searchParams.get('code')).toBe('code');
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer 1234|secret'
    );
  });
  it('rejects tokens from a different app', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ access_token: 'token' }))
      .mockResolvedValueOnce(
        response({ data: { is_valid: true, app_id: '5678' } })
      );
    await expect(exchangeCoexistenceCode('code')).rejects.toThrow(
      'different app'
    );
  });
  it('discovers a number only when both Business app and Cloud API are active', async () => {
    fetchMock.mockImplementation(async () =>
      response({
        data: [
          { id: '111', is_on_biz_app: true, platform_type: 'CLOUD_API' },
          { id: '222', is_on_biz_app: false, platform_type: 'CLOUD_API' },
        ],
      })
    );
    expect(await findCoexistencePhone('token', '333')).toMatchObject({
      id: '111',
    });
    await expect(findCoexistencePhone('token', '333', '222')).rejects.toThrow(
      'Choose one'
    );
  });
  it('does not choose a random phone when several numbers are eligible', async () => {
    fetchMock.mockImplementation(async () =>
      response({
        data: ['111', '222'].map((id) => ({
          id,
          is_on_biz_app: true,
          platform_type: 'CLOUD_API',
        })),
      })
    );
    await expect(findCoexistencePhone('token', '333')).rejects.toThrow(
      'Choose one'
    );
    expect(await findCoexistencePhone('token', '333', '222')).toMatchObject({
      id: '222',
    });
  });
  it('initiates the one-shot history request without registering the number', async () => {
    fetchMock.mockResolvedValue(response({ request_id: 'sync-1' }));
    expect(await requestCoexistenceSync('token', '111', 'history')).toBe(
      'sync-1'
    );
    expect(fetchMock.mock.calls[0][0]).toContain('/111/smb_app_data');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      messaging_product: 'whatsapp',
      sync_type: 'history',
    });
  });
});
