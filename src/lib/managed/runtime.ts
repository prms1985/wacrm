import { credentialStore } from './credentials';
import type { ManagedCapability } from './catalog';
import { ManagedAccessError } from './errors';
export { ManagedAccessError } from './errors';

export async function runtimeCapabilityAllowed(
  accountId: string,
  capability: ManagedCapability
): Promise<boolean> {
  try {
    await assertRuntimeCapability(accountId, capability);
    return true;
  } catch {
    return false;
  }
}

export async function assertRuntimeCapability(
  accountId: string,
  capability: ManagedCapability
) {
  const { data, error } = await credentialStore().rpc(
    'managed_runtime_allows',
    { p_account_id: accountId, p_capability: capability }
  );
  if (error)
    throw new ManagedAccessError('Subscription access could not be verified');
  if (data !== true)
    throw new ManagedAccessError(
      'Subscription is inactive or this feature is unavailable'
    );
}

export async function reserveAiGeneration(accountId: string) {
  const { error } = await credentialStore().rpc('reserve_managed_usage', {
    p_account_id: accountId,
    p_metric: 'ai_generations',
  });
  if (error)
    throw new ManagedAccessError(
      error.code === '42501'
        ? error.message
        : 'AI allowance could not be verified'
    );
}

export async function reserveOutboundAttempt(phoneNumberId: string) {
  const { error } = await credentialStore().rpc('reserve_managed_usage', {
    p_phone_number_id: phoneNumberId,
    p_metric: 'outbound_attempts',
  });
  if (error)
    throw new ManagedAccessError(
      error.code === '42501'
        ? error.message
        : 'Message allowance could not be verified'
    );
}
