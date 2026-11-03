import { beforeEach, describe, it, expect, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('./credentials', () => ({ credentialStore: () => ({ rpc }) }));
import {
  assertRuntimeCapability,
  reserveAiGeneration,
  reserveOutboundAttempt,
  ManagedAccessError,
} from './runtime';
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: true, error: null });
});
describe('background subscription checks', () => {
  it('checks the API key account rather than an untrusted target', async () => {
    await assertRuntimeCapability('account-a', 'api.access');
    expect(rpc).toHaveBeenCalledWith('managed_runtime_allows', {
      p_account_id: 'account-a',
      p_capability: 'api.access',
    });
  });
  it('refuses an inactive feature', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(
      assertRuntimeCapability('account-a', 'api.access')
    ).rejects.toBeInstanceOf(ManagedAccessError);
  });
  it('reserves a generation before provider work', async () => {
    await reserveAiGeneration('account-a');
    expect(rpc).toHaveBeenCalledWith('reserve_managed_usage', {
      p_account_id: 'account-a',
      p_metric: 'ai_generations',
    });
  });
  it('resolves outbound usage by the server-owned number', async () => {
    await reserveOutboundAttempt('111');
    expect(rpc).toHaveBeenCalledWith('reserve_managed_usage', {
      p_phone_number_id: '111',
      p_metric: 'outbound_attempts',
    });
  });
  it('does not continue when metering is unavailable', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '08000', message: 'database unavailable' },
    });
    await expect(reserveOutboundAttempt('111')).rejects.toThrow(
      /could not be verified/
    );
  });
});
