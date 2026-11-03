'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  Plus,
  RotateCcw,
  Search,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import type { Product } from '@/lib/products/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ProductForm, productSelectClass } from './product-form';
import { ProductImport } from './product-import';

function ProductImage({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="bg-muted flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
      {product.image_url && !failed ? (
        <Image
          src={product.image_url}
          alt=""
          width={40}
          height={40}
          unoptimized
          referrerPolicy="no-referrer"
          className="size-10 object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Package className="text-muted-foreground size-4" />
      )}
    </div>
  );
}

export function ProductCatalogue() {
  const t = useTranslations('Products');
  const { accountId, accountStatus, defaultCurrency } = useAuth();
  const canManage = useCan('edit-settings');
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (accountStatus !== 'ready') return;
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setError('');
        try {
          const params = new URLSearchParams({
            q: search,
            kind,
            status,
            page: String(page),
          });
          const response = await fetch(`/api/products?${params}`, {
            signal: controller.signal,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || t('errors.load'));
          if (controller.signal.aborted) return;
          // An archive can empty the last page; move back to a valid page.
          const lastPage = Math.max(
            1,
            Math.ceil(result.total / result.page_size)
          );
          if (page > lastPage) {
            setPage(lastPage);
            return;
          }
          setProducts(result.products);
          setTotal(result.total);
          setPageSize(result.page_size);
        } catch (err) {
          if (!controller.signal.aborted)
            setError(err instanceof Error ? err.message : t('errors.load'));
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      search ? 250 : 0
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [accountId, accountStatus, search, kind, status, page, refresh, t]);

  async function archive(product: Product) {
    if (!canManage || savingId) return;
    setSavingId(product.id);
    try {
      const response = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !product.is_active }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t('errors.save'));
      toast.success(
        t(product.is_active ? 'archivedSuccess' : 'restoredSuccess')
      );
      setRefresh((value) => value + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errors.save'));
    } finally {
      setSavingId(null);
    }
  }

  function reload() {
    setRefresh((value) => value + 1);
  }
  function filtered() {
    setPage(1);
  }

  if (accountStatus !== 'ready') return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('description')}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Upload className="size-4" />
              {t('import')}
            </Button>
            <Button onClick={() => setEditing(null)}>
              <Plus className="size-4" />
              {t('add')}
            </Button>
          </div>
        )}
      </div>

      {!canManage && (
        <p className="bg-muted/40 text-muted-foreground rounded-lg border px-4 py-3 text-sm">
          {t('readOnly')}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-2.5 left-3 size-4" />
          <Input
            aria-label={t('search')}
            placeholder={t('search')}
            className="h-9 pl-9"
            maxLength={100}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              filtered();
            }}
          />
        </div>
        <select
          aria-label={t('fields.kind')}
          className={`${productSelectClass} sm:w-44`}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            filtered();
          }}
        >
          <option value="all">{t('allKinds')}</option>
          <option value="product">{t('kinds.product')}</option>
          <option value="service">{t('kinds.service')}</option>
        </select>
        <select
          aria-label={t('status')}
          className={`${productSelectClass} sm:w-40`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            filtered();
          }}
        >
          <option value="active">{t('active')}</option>
          <option value="archived">{t('archived')}</option>
          <option value="all">{t('allStatuses')}</option>
        </select>
      </div>

      <div
        className="bg-card overflow-hidden rounded-xl border"
        aria-busy={loading}
      >
        {error ? (
          <div role="alert" className="space-y-3 p-8 text-center">
            <p className="text-destructive text-sm">{error}</p>
            <Button variant="outline" onClick={reload}>
              {t('retry')}
            </Button>
          </div>
        ) : loading ? (
          <div
            className="text-muted-foreground flex items-center justify-center gap-2 p-12 text-sm"
            role="status"
          >
            <Loader2 className="size-4 animate-spin" />
            {t('loading')}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <Package className="text-muted-foreground size-9" />
            <h2 className="font-medium">{t('empty')}</h2>
            <p className="text-muted-foreground max-w-md text-sm">
              {t('emptyDescription')}
            </p>
            {canManage && (
              <Button onClick={() => setEditing(null)}>
                <Plus className="size-4" />
                {t('add')}
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t('fields.name')}</TableHead>
                <TableHead>{t('fields.category')}</TableHead>
                <TableHead>{t('fields.unit_price')}</TableHead>
                <TableHead>{t('fields.availability')}</TableHead>
                <TableHead className="pr-4 text-right">
                  {t('actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="py-4 pl-4">
                    <div className="flex items-center gap-3">
                      <ProductImage
                        key={`${product.id}:${product.image_url}`}
                        product={product}
                      />
                      <div className="min-w-0">
                        <button
                          className="hover:text-primary max-w-64 truncate text-left font-medium hover:underline"
                          onClick={() => setEditing(product)}
                        >
                          {product.name}
                        </button>
                        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <span>{t(`kinds.${product.kind}`)}</span>
                          {product.sku && (
                            <span className="font-mono">{product.sku}</span>
                          )}
                          {!product.is_active && (
                            <Badge variant="secondary">{t('archived')}</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-40 truncate">
                    {product.category || '—'}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium tabular-nums">
                      {new Intl.NumberFormat(undefined, {
                        style: 'currency',
                        currency: product.currency,
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(product.unit_price)}
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {t('perUnit', { unit: product.unit })} ·{' '}
                      {t('taxValue', { rate: product.tax_rate })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        product.availability === 'available'
                          ? 'secondary'
                          : 'outline'
                      }
                    >
                      {t(`availability.${product.availability}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(product)}
                      >
                        {canManage ? t('edit') : t('details')}
                      </Button>
                      {canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={savingId !== null}
                          onClick={() => archive(product)}
                        >
                          {savingId === product.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : product.is_active ? (
                            <Archive className="size-4" />
                          ) : (
                            <RotateCcw className="size-4" />
                          )}
                          {t(product.is_active ? 'archive' : 'restore')}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {!error && !loading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground" aria-live="polite">
            {t('results', {
              from: (page - 1) * pageSize + 1,
              to: Math.min(page * pageSize, total),
              total,
            })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft className="size-4" />
              {t('previous')}
            </Button>
            <Button
              variant="outline"
              disabled={page * pageSize >= total}
              onClick={() => setPage((value) => value + 1)}
            >
              {t('next')}
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
      {editing !== undefined && (
        <ProductForm
          key={editing?.id ?? 'new'}
          product={editing}
          defaultCurrency={defaultCurrency}
          canManage={canManage}
          onClose={() => setEditing(undefined)}
          onSaved={reload}
        />
      )}
      {importing && canManage && (
        <ProductImport
          onClose={() => setImporting(false)}
          onImported={() => {
            setStatus('active');
            setPage(1);
            reload();
          }}
        />
      )}
    </div>
  );
}
