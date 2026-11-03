// Never import this module from browser code. The service key is only read by
// the existing server-side factory. Authorize the account before using it.
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { ManagedSetupError } from './errors';

export function credentialStore() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new ManagedSetupError('server_configuration_required');
  }
  try {
    return supabaseAdmin();
  } catch {
    throw new ManagedSetupError('server_configuration_required');
  }
}
