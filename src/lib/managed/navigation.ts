import { subscriptionDisplayStatus, type ManagedCapability } from './catalog';
import type { ManagedAccountData } from './types';
import type { SettingsSection } from '@/components/settings/settings-sections';

function within(path: string, prefix: string) {
  return path === prefix || path.startsWith(prefix + '/');
}

export function needsManagedOnboarding(data: ManagedAccountData) {
  return (
    !data.platformAdmin &&
    !!data.subscription &&
    subscriptionDisplayStatus(data.subscription) !== 'active'
  );
}

// Navigation mirrors the server permissions. Missing access data never grants
// entry; API handlers and database policies remain the authorization boundary.
export function canOpenManagedPath(
  path: string,
  data: ManagedAccountData | null
) {
  if (within(path, '/subscription')) return true;
  if (!data) return false;
  if (data.platformAdmin) return true;
  if (within(path, '/admin')) return false;
  if (within(path, '/settings')) return true;
  if (needsManagedOnboarding(data)) return false;
  if (!data.subscription) return true;
  const protectedPaths: Record<string, ManagedCapability> = {
    '/automations': 'automation.manage',
    '/flows': 'automation.manage',
    '/agents': 'ai.configure',
    '/broadcasts': 'broadcast.send',
  };
  const match = Object.entries(protectedPaths).find(([prefix]) =>
    within(path, prefix)
  );
  return !match || data.capabilities?.[match[1]] === true;
}

export function canOpenManagedSettings(
  section: SettingsSection,
  data: ManagedAccountData | null
) {
  if (!data) return false;
  if (data.platformAdmin || !data.subscription) return true;
  if (['profile', 'security', 'appearance'].includes(section)) return true;
  if (needsManagedOnboarding(data)) return false;
  if (section === 'overview') return false;
  const capabilities: Partial<Record<SettingsSection, ManagedCapability>> = {
    whatsapp: 'whatsapp.manage',
    api: 'api.manage',
    members: 'members.manage',
    templates: 'broadcast.send',
    'quick-replies': 'inbox.reply',
    inbox: 'inbox.reply',
    fields: 'contacts.write',
    deals: 'quotation.manage',
  };
  const capability = capabilities[section];
  return capability ? data.capabilities?.[capability] === true : true;
}

export function managedLandingPath(data: ManagedAccountData) {
  if (data.platformAdmin) return '/admin/clients';
  return needsManagedOnboarding(data) ? '/subscription' : '/dashboard';
}

export function managedRedirect(path: string, data: ManagedAccountData | null) {
  if (!data) return null;
  if (path === '/dashboard' || (path === '/admin' && data.platformAdmin)) {
    const target = managedLandingPath(data);
    return path === target ? null : target;
  }
  if (
    needsManagedOnboarding(data) &&
    !within(path, '/admin') &&
    !canOpenManagedPath(path, data)
  )
    return '/subscription';
  return null;
}
