'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, RefreshCw, Smartphone } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { signupEvent } from '@/lib/whatsapp/coexistence/client';

type Status = {
  ready: boolean;
  migrationRequired: boolean;
  setup: {
    appId: string;
    configId: string;
    version: string;
    missing: string[];
  };
  pendingEvents: number;
  connection: null | {
    display_phone: string;
    disconnected_at: string | null;
    history_status: string;
    contacts_status: string;
    history_progress: number;
    history_error: string | null;
    contacts_error: string | null;
  };
};
type Facebook = {
  init: (options: {
    appId: string;
    version: string;
    xfbml: boolean;
    cookie: boolean;
  }) => void;
  login: (
    callback: (result: { authResponse?: { code?: string } }) => void,
    options: Record<string, unknown>
  ) => void;
};
type Attempt = {
  id: number;
  state: string;
  code?: string;
  event?: { waba_id: string; phone_number_id?: string };
  submitted?: boolean;
};
const endpoint = '/api/whatsapp/coexistence';
const facebook = () => (window as Window & { FB?: Facebook }).FB;

async function post(body: Record<string, unknown>) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error || 'WhatsApp connection could not be completed.'
    );
  return data;
}

export function WhatsAppCoexistence({
  onConnected,
}: {
  onConnected: () => Promise<void>;
}) {
  const t = useTranslations('Settings.whatsappCoexistence');
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [state, setState] = useState('');
  const attempt = useRef<Attempt | null>(null);
  const mounted = useRef(true);
  const hasConnection = !!status?.connection;
  const disconnectedAt = status?.connection?.disconnected_at;

  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t('failed'));
    if (mounted.current) setStatus(data);
    return data as Status;
  }, [t]);

  useEffect(() => {
    mounted.current = true;
    void refresh().catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
      attempt.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (!status?.ready || busy) return;
    let active = true;
    const prepare = () =>
      post({ action: 'start' })
        .then((data) => {
          if (active) setState(data.state);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void prepare();
    const timer = setInterval(() => void prepare(), 8 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [status?.ready, busy]);

  useEffect(() => {
    if (!sdkLoaded || !status?.ready || !facebook()) return;
    facebook()!.init({
      appId: status.setup.appId,
      version: status.setup.version,
      xfbml: false,
      cookie: false,
    });
    setSdkReady(true);
  }, [sdkLoaded, status?.ready, status?.setup.appId, status?.setup.version]);

  useEffect(() => {
    if (!hasConnection || disconnectedAt) return;
    const timer = setInterval(() => void refresh().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, [hasConnection, disconnectedAt, refresh]);

  const complete = useCallback(async () => {
    const current = attempt.current;
    if (!current?.code || !current.event || current.submitted) return;
    current.submitted = true;
    try {
      await post({
        action: 'connect',
        state: current.state,
        code: current.code,
        ...current.event,
      });
      if (!mounted.current) return;
      await refresh();
      await onConnected();
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : t('failed'));
    } finally {
      if (mounted.current) {
        attempt.current = null;
        setState('');
        setBusy(false);
      }
    }
  }, [onConnected, refresh, t]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const current = attempt.current;
      if (!current || current.submitted) return;
      const data = signupEvent(event.origin, event.data);
      if (!data) return;
      if (data.cancelled) {
        attempt.current = null;
        setBusy(false);
        setError(t('cancelled'));
        return;
      }
      current.event = {
        waba_id: data.waba_id,
        phone_number_id: data.phone_number_id,
      };
      void complete();
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [complete, t]);

  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(
      () => {
        if (attempt.current?.submitted) return;
        attempt.current = null;
        setBusy(false);
        setError(t('expired'));
      },
      5 * 60 * 1000
    );
    return () => clearTimeout(timer);
  }, [busy, t]);

  function connect() {
    if (!sdkReady || !state || !status || !facebook()) return;
    setError('');
    setBusy(true);
    const current: Attempt = { id: Date.now(), state };
    attempt.current = current;
    // FB.login runs directly in the click handler so browsers allow its popup.
    try {
      facebook()!.login(
        (result) => {
          if (attempt.current !== current) return;
          const code = result.authResponse?.code;
          if (!code) {
            attempt.current = null;
            setBusy(false);
            setError(t('cancelled'));
            return;
          }
          current.code = code;
          void complete();
        },
        {
          config_id: status.setup.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: 'whatsapp_business_app_onboarding',
            sessionInfoVersion: '3',
          },
        }
      );
    } catch {
      attempt.current = null;
      setBusy(false);
      setError(t('failed'));
    }
  }

  async function synchronize(action: 'sync' | 'process') {
    setBusy(true);
    setError('');
    try {
      await post({ action });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  const connected = status?.connection && !status.connection.disconnected_at;
  return (
    <Card className="border-border bg-card">
      {status?.ready && (
        <Script
          id="meta-whatsapp-sdk"
          src="https://connect.facebook.net/en_US/sdk.js"
          strategy="afterInteractive"
          onReady={() => setSdkLoaded(true)}
          onError={() => setError(t('sdkFailed'))}
        />
      )}
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="text-primary size-5" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {!status && !error && (
          <p className="text-muted-foreground text-sm">{t('loading')}</p>
        )}
        {status && !status.ready && (
          <div className="border-border bg-muted/40 space-y-2 rounded-lg border p-3 text-sm">
            <p>
              {status.migrationRequired
                ? t('migrationRequired')
                : t('setupRequired')}
            </p>
            {!!status.setup.missing.length && (
              <p className="text-muted-foreground font-mono text-xs break-words">
                {status.setup.missing.join(', ')}
              </p>
            )}
            <a
              className="text-primary underline underline-offset-4"
              href="https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('setupGuide')}
            </a>
          </div>
        )}
        {connected && status.connection && (
          <div
            className="border-primary/20 bg-primary/5 space-y-2 rounded-lg border p-3 text-sm"
            aria-live="polite"
          >
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="text-primary size-4" />
              {t('connected', { phone: status.connection.display_phone })}
            </p>
            <p>
              {t('contacts')}:{' '}
              {t(`states.${status.connection.contacts_status}`)}
            </p>
            <p>
              {t('history')}: {t(`states.${status.connection.history_status}`)}
              {status.connection.history_progress > 0
                ? ` (${status.connection.history_progress}%)`
                : ''}
            </p>
            {status.connection.contacts_error && (
              <p className="text-destructive">
                {status.connection.contacts_error}
              </p>
            )}
            {status.connection.history_error && (
              <p className="text-destructive">
                {status.connection.history_error}
              </p>
            )}
            <p className="text-muted-foreground">{t('keepOpen')}</p>
          </div>
        )}
        {status?.connection?.disconnected_at && (
          <p className="text-muted-foreground text-sm">{t('disconnected')}</p>
        )}
        <p className="text-muted-foreground text-sm">{t('sharing')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!status?.ready || !sdkReady || !state || busy}
            onClick={connect}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Smartphone className="size-4" />
            )}
            {busy ? t('connecting') : connected ? t('reconnect') : t('connect')}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void refresh().catch((e) => setError(e.message))}
          >
            <RefreshCw className="size-4" />
            {t('refresh')}
          </Button>
          {connected &&
            status.connection &&
            [
              status.connection.history_status,
              status.connection.contacts_status,
            ].some((s) => ['pending', 'failed'].includes(s)) && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void synchronize('sync')}
              >
                {t('sync')}
              </Button>
            )}
          {!!status?.pendingEvents && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void synchronize('process')}
            >
              {t('process', { count: status.pendingEvents })}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
