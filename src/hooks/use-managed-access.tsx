'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { useAuth } from './use-auth';
import type { ManagedAccountData } from '@/lib/managed/types';
export { canOpenManagedPath } from '@/lib/managed/navigation';

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
  const { user, accountId, accountRole, profileLoading } = useAuth();
  const sessionKey =
    user && accountId ? `${user.id}:${accountId}:${accountRole}` : null;
  const request = useRef<AbortController | null>(null);
  const [state, setState] = useState<{
    sessionKey: string | null;
    data: ManagedAccountData | null;
    error: string | null;
    errorCode: string | null;
  }>({ sessionKey: null, data: null, error: null, errorCode: null });
  const refresh = useCallback(async () => {
    if (!sessionKey || !user || !accountId) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch('/api/managed/account', {
        cache: 'no-store',
        signal: controller.signal,
      });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setState({
          sessionKey,
          data: null,
          error: body.error || 'Subscription access could not be loaded',
          errorCode: typeof body.code === 'string' ? body.code : null,
        });
        return;
      }
      if (
        body.userId !== user.id ||
        body.account?.id !== accountId ||
        body.role !== accountRole
      )
        throw new Error('Your login changed. Refresh to verify access.');
      setState({ sessionKey, data: body, error: null, errorCode: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        sessionKey,
        data: null,
        error:
          error instanceof Error
            ? error.message
            : 'Could not load subscription',
        errorCode: 'service_unavailable',
      });
    }
  }, [sessionKey, user, accountId, accountRole]);
  useEffect(() => {
    void refresh();
    // Activation, suspension and platform-role changes also reach open tabs.
    const revalidate = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', revalidate);
    const timer = window.setInterval(revalidate, 60_000);
    return () => {
      request.current?.abort();
      window.removeEventListener('focus', revalidate);
      window.clearInterval(timer);
    };
  }, [refresh]);
  // A different user or role in the same workspace must also revalidate.
  const current =
    state.sessionKey === sessionKey && sessionKey !== null
      ? state
      : { data: null, error: null, errorCode: null };
  return (
    <Context.Provider
      value={{
        data: current.data,
        error: current.error,
        errorCode: current.errorCode,
        loading:
          profileLoading || (!!sessionKey && state.sessionKey !== sessionKey),
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
