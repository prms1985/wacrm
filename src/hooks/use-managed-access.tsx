'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { useAuth } from './use-auth';
import type { ManagedAccountData } from '@/lib/managed/types';
import type { ManagedCapability } from '@/lib/managed/catalog';

const Context = createContext<{
  data: ManagedAccountData | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  refresh: () => Promise<void>;
}>({
  data: null,
  loading: true,
  error: null,
  errorCode: null,
  refresh: async () => {},
});
export function ManagedAccessProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { accountId } = useAuth();
  const [state, setState] = useState<{
    accountId: string | null;
    data: ManagedAccountData | null;
    error: string | null;
    errorCode: string | null;
  }>({ accountId: null, data: null, error: null, errorCode: null });
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!accountId) return;
    try {
      const response = await fetch('/api/managed/account', {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) {
        setState({
          accountId,
          data: null,
          error: body.error || 'Subscription access could not be loaded',
          errorCode: typeof body.code === 'string' ? body.code : null,
        });
        return;
      }
      setState({ accountId, data: body, error: null, errorCode: null });
    } catch (error) {
      setState({
        accountId,
        data: null,
        error:
          error instanceof Error
            ? error.message
            : 'Could not load subscription',
        errorCode: 'service_unavailable',
      });
    } finally {
      setLoading(false);
    }
  }, [accountId]);
  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);
  // Old account data is never exposed during an invitation/account switch.
  const current =
    state.accountId === accountId
      ? state
      : { data: null, error: null, errorCode: null };
  return (
    <Context.Provider
      value={{
        data: current.data,
        error: current.error,
        errorCode: current.errorCode,
        loading: loading || state.accountId !== accountId,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useManagedAccess() {
  return useContext(Context);
}
export function canOpenManagedPath(
  path: string,
  data: ManagedAccountData | null
) {
  if (path.startsWith('/admin')) return data?.platformAdmin === true;
  if (!data?.subscription) return true;
  if (data.platformAdmin) return true;
  const protectedPaths: Record<string, ManagedCapability> = {
    '/automations': 'automation.manage',
    '/flows': 'automation.manage',
    '/agents': 'ai.configure',
    '/broadcasts': 'broadcast.send',
  };
  const match = Object.entries(protectedPaths).find(
    ([prefix]) => path === prefix || path.startsWith(prefix + '/')
  );
  return !match || data.capabilities?.[match[1]] === true;
}
