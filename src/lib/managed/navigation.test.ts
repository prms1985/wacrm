import { describe, it, expect } from 'vitest';
import {
  canOpenManagedPath,
  canOpenManagedSettings,
  managedLandingPath,
  managedRedirect,
} from './navigation';
import type { ManagedAccountData } from './types';
import type { SubscriptionStatus } from './catalog';

const standalone: ManagedAccountData = {
  account: { id: 'workspace', name: 'Example' },
  platformAdmin: false,
  subscription: null,
  plan: null,
  industry: null,
  business: null,
  usage: [],
  seats: 1,
  quotations: 0,
  whatsapp: null,
  ai: null,
  draft: null,
  payments: [],
  audit: [],
};
function client(status: SubscriptionStatus = 'active'): ManagedAccountData {
  return {
    ...standalone,
    subscription: {
      account_id: 'workspace',
      plan_id: 'launch',
      industry_id: 'distributor-sales',
      status,
      period_start: '2020-01-01T00:00:00Z',
      period_end: '2099-01-01T00:00:00Z',
      extra_capabilities: [],
    },
    capabilities: {
      'inbox.reply': true,
      'contacts.write': true,
      'quotation.manage': true,
    },
  };
}

describe('managed navigation and landing', () => {
  it('keeps features closed until permissions resolve', () => {
    for (const path of [
      '/dashboard',
      '/agents',
      '/contacts',
      '/admin/clients',
      '/settings',
    ])
      expect(canOpenManagedPath(path, null)).toBe(false);
    expect(canOpenManagedPath('/subscription', null)).toBe(true);
    expect(canOpenManagedSettings('whatsapp', null)).toBe(false);
  });
  it('takes the explicit platform administrator to client administration', () => {
    const admin = { ...standalone, platformAdmin: true };
    expect(managedLandingPath(admin)).toBe('/admin/clients');
    expect(managedRedirect('/dashboard', admin)).toBe('/admin/clients');
    expect(canOpenManagedPath('/admin/clients/another-workspace', admin)).toBe(
      true
    );
    expect(canOpenManagedSettings('api', admin)).toBe(true);
  });
  it('never treats a workspace owner as a platform administrator', () => {
    expect(
      canOpenManagedPath('/admin/clients', { ...standalone, role: 'owner' })
    ).toBe(false);
    expect(managedLandingPath(standalone)).toBe('/dashboard');
    expect(managedRedirect('/admin/clients', client('pending'))).toBeNull();
  });
  it.each<SubscriptionStatus>([
    'pending',
    'past_due',
    'suspended',
    'cancelled',
  ])('limits %s clients to onboarding and personal settings', (status) => {
    const data = client(status);
    for (const path of [
      '/dashboard',
      '/inbox',
      '/contacts',
      '/products',
      '/agents',
      '/broadcasts',
    ]) {
      expect(canOpenManagedPath(path, data)).toBe(false);
      expect(managedRedirect(path, data)).toBe('/subscription');
    }
    expect(managedLandingPath(data)).toBe('/subscription');
    expect(canOpenManagedPath('/subscription', data)).toBe(true);
    expect(canOpenManagedPath('/settings', data)).toBe(true);
    expect(canOpenManagedSettings('profile', data)).toBe(true);
    expect(canOpenManagedSettings('security', data)).toBe(true);
    expect(canOpenManagedSettings('whatsapp', data)).toBe(false);
    expect(canOpenManagedSettings('members', data)).toBe(false);
  });
  it('blocks expired and future service periods', () => {
    const expired = client();
    expired.subscription!.period_end = '2021-01-01T00:00:00Z';
    const future = client();
    future.subscription!.period_start = '2090-01-01T00:00:00Z';
    expect(managedLandingPath(expired)).toBe('/subscription');
    expect(managedLandingPath(future)).toBe('/subscription');
  });
  it('shows active clients only their permitted controls', () => {
    const data = client();
    expect(canOpenManagedPath('/inbox', data)).toBe(true);
    expect(canOpenManagedPath('/agents', data)).toBe(false);
    expect(canOpenManagedPath('/flows/create', data)).toBe(false);
    expect(canOpenManagedPath('/broadcasts/new', data)).toBe(false);
    expect(canOpenManagedSettings('whatsapp', data)).toBe(false);
    expect(canOpenManagedSettings('api', data)).toBe(false);
    expect(canOpenManagedSettings('members', data)).toBe(false);
    expect(canOpenManagedSettings('fields', data)).toBe(true);
    data.capabilities!['broadcast.send'] = true;
    expect(canOpenManagedPath('/broadcasts/new', data)).toBe(true);
    expect(canOpenManagedSettings('templates', data)).toBe(true);
  });
  it('preserves explicitly independent workspaces', () => {
    expect(canOpenManagedPath('/agents', standalone)).toBe(true);
    expect(canOpenManagedSettings('whatsapp', standalone)).toBe(true);
  });
});
