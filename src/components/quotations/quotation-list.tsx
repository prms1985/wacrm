'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Loader2, Plus } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { QUOTATION_STATUSES, type Quotation } from '@/lib/quotations/types';

export const quoteSelectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';
export const quoteMoney = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export function QuotationList() {
  const t = useTranslations('Quotations'),
    { accountId } = useAuth(),
    canCreate = useCan('send-messages');
  const [quotes, setQuotes] = useState<Quotation[]>([]),
    [status, setStatus] = useState('all'),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setError('');
        try {
          const response = await fetch(
            `/api/quotations?${new URLSearchParams({ status, q, page: String(page) })}`,
            { signal: controller.signal }
          );
          const data = await response.json();
          if (!response.ok) throw new Error(data.error);
          if (controller.signal.aborted) return;
          setQuotes(data.quotations);
          setTotal(data.total);
        } catch (err) {
          if (!controller.signal.aborted)
            setError(err instanceof Error ? err.message : t('errors.failed'));
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      q ? 250 : 0
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [accountId, status, q, page, reload, t]);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('description')}
          </p>
        </div>
        {canCreate && (
          <Link
            href="/quotations/new"
            className="bg-primary text-primary-foreground inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm"
          >
            <Plus className="size-4" />
            {t('new')}
          </Link>
        )}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          aria-label={t('search')}
          placeholder={t('search')}
          maxLength={100}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label={t('status')}
          className={`${quoteSelectClass} sm:w-52`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">{t('all')}</option>
          {QUOTATION_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`statuses.${value}`)}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          onClick={() => setReload((value) => value + 1)}
        >
          {t('refresh')}
        </Button>
      </div>
      <div className="bg-card rounded-xl border" aria-busy={loading}>
        {error ? (
          <p role="alert" className="text-destructive p-8 text-center text-sm">
            {error}
          </p>
        ) : loading ? (
          <div className="flex justify-center gap-2 p-12" role="status">
            <Loader2 className="size-4 animate-spin" />
            {t('loading')}
          </div>
        ) : quotes.length === 0 ? (
          <div className="space-y-3 p-12 text-center">
            <FileText className="text-muted-foreground mx-auto size-9" />
            <p>{t('empty')}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {['reference', 'customer', 'status', 'total', 'validUntil'].map(
                  (key) => (
                    <TableHead key={key}>{t(key)}</TableHead>
                  )
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((quote) => (
                <TableRow key={quote.id}>
                  <TableCell>
                    <Link
                      href={`/quotations/${quote.id}`}
                      className="text-primary font-medium hover:underline"
                    >
                      {quote.reference}
                    </Link>
                    {quote.source === 'ai' && (
                      <Badge variant="outline" className="ml-2">
                        {t('aiDraft')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {quote.customer.name || quote.customer.phone || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {t(`statuses.${quote.status}`)}
                    </Badge>
                    {quote.ai_collecting && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t('collecting')}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {quoteMoney(quote.total, quote.currency)}
                  </TableCell>
                  <TableCell>{quote.valid_until}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {!loading && !error && total > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span>{t('count', { count: total })}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((v) => v - 1)}
            >
              {t('previous')}
            </Button>
            <Button
              variant="outline"
              disabled={page * 25 >= total}
              onClick={() => setPage((v) => v + 1)}
            >
              {t('next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
