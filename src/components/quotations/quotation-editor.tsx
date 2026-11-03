'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import type { Product } from '@/lib/products/types';
import type { Quotation } from '@/lib/quotations/types';
import { calculateQuotation } from '@/lib/quotations/calculate';
import { QuotationError } from '@/lib/quotations/validation';
import { quoteSelectClass, quoteMoney } from './quotation-list';
import { QuotationSend } from './quotation-send';

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
}
function initialForm(quote: Quotation | null, contact = '') {
  return {
    contact_id: quote?.contact_id ?? contact,
    conversation_id: quote?.conversation_id ?? null,
    items:
      quote?.items.map((item) => ({
        product_id: item.product_id,
        quantity: String(item.quantity),
      })) ?? [],
    discount_percent: String(quote?.discount_percent ?? 0),
    valid_until:
      quote?.valid_until ??
      new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    requirements: quote?.requirements ?? '',
    terms: quote?.terms ?? '',
    seller_address: quote?.seller.address ?? '',
    seller_tax_id: quote?.seller.tax_id ?? '',
  };
}
export function QuotationEditor({
  id,
  initialContact,
}: {
  id?: string;
  initialContact?: string;
}) {
  const t = useTranslations('Quotations'),
    router = useRouter(),
    { accountId, account } = useAuth(),
    canWrite = useCan('send-messages'),
    canApprove = useCan('edit-settings');
  const [quote, setQuote] = useState<Quotation | null>(null),
    [form, setForm] = useState(() => initialForm(null, initialContact)),
    [loaded, setLoaded] = useState(!id),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [sending, setSending] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]),
    [contactSearch, setContactSearch] = useState(''),
    [products, setProducts] = useState<Product[]>([]),
    [productOptions, setProductOptions] = useState<Product[]>([]),
    [productSearch, setProductSearch] = useState(''),
    [selectedProduct, setSelectedProduct] = useState('');
  const editable = canWrite && (!quote || quote.status === 'draft');
  const dirty = quote
    ? JSON.stringify(form) !== JSON.stringify(initialForm(quote))
    : true;
  useEffect(() => {
    if (!accountId || !id) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/quotations/${id}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (controller.signal.aborted) return;
        setQuote(data.quotation);
        setForm(initialForm(data.quotation));
        setLoaded(true);
        const ids = data.quotation.items
          .map((item: { product_id: string }) => item.product_id)
          .join(',');
        if (ids) {
          const selected = await fetch(
            `/api/quotations/options?kind=products&ids=${ids}`,
            { signal: controller.signal }
          ).then((r) => r.json());
          if (!controller.signal.aborted && selected.products)
            setProducts((previous) => [
              ...previous.filter(
                (item) =>
                  !selected.products.some((p: Product) => p.id === item.id)
              ),
              ...selected.products,
            ]);
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : t('errors.failed'));
      }
    })();
    return () => controller.abort();
  }, [accountId, id, t]);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/quotations/options?kind=contacts&q=${encodeURIComponent(contactSearch)}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted)
          setContacts((previous) => [
            ...previous.filter(
              (item) =>
                !data.contacts.some(
                  (contact: Contact) => contact.id === item.id
                )
            ),
            ...data.contacts,
          ]);
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : t('errors.failed'));
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [accountId, contactSearch, t]);
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/quotations/options?kind=products&q=${encodeURIComponent(productSearch)}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) {
          setProductOptions(data.products);
          setProducts((previous) => [
            ...previous.filter(
              (item) => !data.products.some((p: Product) => p.id === item.id)
            ),
            ...data.products,
          ]);
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : t('errors.failed'));
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [accountId, productSearch, t]);
  useEffect(() => {
    if (!accountId || !initialContact) return;
    const controller = new AbortController();
    fetch(
      `/api/quotations/options?kind=contacts&id=${encodeURIComponent(initialContact)}`,
      { signal: controller.signal }
    )
      .then((r) => r.json())
      .then((data) => {
        if (!controller.signal.aborted && data.contacts)
          setContacts((previous) => [
            ...previous.filter((item) => item.id !== initialContact),
            ...data.contacts,
          ]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [accountId, initialContact]);
  let totals = quote
      ? {
          items: quote.items,
          currency: quote.currency,
          subtotal: quote.subtotal,
          discount_total: quote.discount_total,
          tax_total: quote.tax_total,
          total: quote.total,
        }
      : null,
    calculationError = '';
  const previewCurrentPrices = !quote || (quote.status === 'draft' && dirty);
  if (previewCurrentPrices) {
    try {
      totals = calculateQuotation(products, form.items, form.discount_percent);
    } catch (err) {
      calculationError =
        err instanceof QuotationError
          ? t(`errors.${err.code}`)
          : t('errors.failed');
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editable || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(
        id ? `/api/quotations/${id}` : '/api/quotations',
        {
          method: id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, version: quote?.version }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setQuote(data.quotation);
      setForm(initialForm(data.quotation));
      if (!id) router.replace(`/quotations/${data.quotation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.failed'));
    } finally {
      setSaving(false);
    }
  }
  async function action(value: string) {
    if (!quote || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/quotations/${quote.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: value, version: quote.version }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setQuote(data.quotation);
      setForm(initialForm(data.quotation));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.failed'));
    } finally {
      setSaving(false);
    }
  }
  async function refreshQuote() {
    if (!id) return;
    const response = await fetch(`/api/quotations/${id}`);
    const data = await response.json();
    if (response.ok) {
      setQuote(data.quotation);
      setForm(initialForm(data.quotation));
    }
  }
  if (!loaded && !error)
    return (
      <div className="flex items-center justify-center gap-2 p-12">
        <Loader2 className="size-4 animate-spin" />
        {t('loading')}
      </div>
    );
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        href="/quotations"
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← {t('title')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {quote?.reference ?? t('new')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('editorHelp')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {quote && (
            <>
              <Badge variant="secondary">{t(`statuses.${quote.status}`)}</Badge>
              <a
                href={`/api/quotations/${quote.id}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border px-3 py-1.5 text-sm"
              >
                {t('pdf')}
              </a>
            </>
          )}
          {quote?.status === 'approved' && canWrite && (
            <Button
              type="button"
              disabled={saving}
              onClick={() => setSending(true)}
            >
              {t('send')}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm"
        >
          {error}
        </p>
      )}
      {quote?.ai_collecting && (
        <p className="bg-muted/40 rounded-lg border p-3 text-sm">
          {t('collectingHelp')}
        </p>
      )}
      {(quote?.status === 'sending' || quote?.status === 'send_unknown') && (
        <p className="bg-muted/40 rounded-lg border p-3 text-sm">
          {t('sendReview')}
        </p>
      )}
      <form onSubmit={save} className="space-y-6">
        <fieldset disabled={!editable || saving} className="min-w-0 space-y-6">
          <div className="bg-card grid gap-4 rounded-xl border p-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="quote-customer">{t('customer')}</Label>
              {editable && (
                <Input
                  aria-label={t('findCustomer')}
                  placeholder={t('findCustomer')}
                  value={contactSearch}
                  maxLength={100}
                  onChange={(e) => setContactSearch(e.target.value)}
                />
              )}
              <select
                id="quote-customer"
                required
                className={quoteSelectClass}
                value={form.contact_id}
                onChange={(e) =>
                  setForm((previous) => ({
                    ...previous,
                    contact_id: e.target.value,
                    conversation_id: null,
                  }))
                }
              >
                <option value="">{t('selectCustomer')}</option>
                {form.contact_id &&
                  !contacts.some(
                    (contact) => contact.id === form.contact_id
                  ) && (
                    <option value={form.contact_id}>
                      {quote?.customer.name ||
                        quote?.customer.phone ||
                        form.contact_id}
                    </option>
                  )}
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name || contact.phone}{' '}
                    {contact.company ? `· ${contact.company}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-valid">{t('validUntil')}</Label>
              <Input
                id="quote-valid"
                type="date"
                required
                value={form.valid_until}
                onChange={(e) =>
                  setForm((previous) => ({
                    ...previous,
                    valid_until: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-address">{t('sellerAddress')}</Label>
              <Textarea
                id="quote-address"
                maxLength={1000}
                value={form.seller_address}
                onChange={(e) =>
                  setForm((previous) => ({
                    ...previous,
                    seller_address: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-tax-id">{t('sellerTaxId')}</Label>
              <Input
                id="quote-tax-id"
                maxLength={100}
                value={form.seller_tax_id}
                onChange={(e) =>
                  setForm((previous) => ({
                    ...previous,
                    seller_tax_id: e.target.value,
                  }))
                }
              />
              <p className="text-muted-foreground text-xs">{account?.name}</p>
            </div>
          </div>
          <div className="bg-card space-y-4 rounded-xl border p-5">
            <h2 className="font-medium">{t('items')}</h2>
            {editable && (
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  aria-label={t('findProduct')}
                  placeholder={t('findProduct')}
                  maxLength={100}
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
                <select
                  aria-label={t('selectProduct')}
                  className={quoteSelectClass}
                  value={selectedProduct}
                  onChange={(e) => setSelectedProduct(e.target.value)}
                >
                  <option value="">{t('selectProduct')}</option>
                  {productOptions
                    .filter(
                      (product) =>
                        !form.items.some(
                          (item) => item.product_id === product.id
                        )
                    )
                    .map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} ·{' '}
                        {quoteMoney(product.unit_price, product.currency)}
                      </option>
                    ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedProduct || form.items.length >= 50}
                  onClick={() => {
                    setForm((previous) => ({
                      ...previous,
                      items: [
                        ...previous.items,
                        { product_id: selectedProduct, quantity: '1' },
                      ],
                    }));
                    setSelectedProduct('');
                  }}
                >
                  <Plus className="size-4" />
                  {t('addItem')}
                </Button>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  {['product', 'quantity', 'unitPrice', 'taxRate', 'total'].map(
                    (key) => (
                      <TableHead key={key}>{t(key)}</TableHead>
                    )
                  )}
                  {editable && (
                    <TableHead>
                      <span className="sr-only">{t('remove')}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {form.items.map((item, index) => {
                  const product = products.find(
                      (product) => product.id === item.product_id
                    ),
                    saved = quote?.items.find(
                      (line) => line.product_id === item.product_id
                    ),
                    line = totals?.items[index];
                  return (
                    <TableRow key={item.product_id}>
                      <TableCell className="min-w-40">
                        {(previewCurrentPrices ? product?.name : saved?.name) ??
                          saved?.name ??
                          t('unavailableItem')}
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <Input
                            aria-label={t('quantity')}
                            type="number"
                            min="0.001"
                            max="1000000"
                            step="0.001"
                            required
                            className="w-24"
                            value={item.quantity}
                            onChange={(e) =>
                              setForm((previous) => ({
                                ...previous,
                                items: previous.items.map((value, i) =>
                                  i === index
                                    ? { ...value, quantity: e.target.value }
                                    : value
                                ),
                              }))
                            }
                          />
                        ) : (
                          item.quantity
                        )}
                      </TableCell>
                      <TableCell>
                        {quoteMoney(
                          (previewCurrentPrices
                            ? product?.unit_price
                            : saved?.unit_price) ?? 0,
                          totals?.currency || quote?.currency || 'INR'
                        )}
                      </TableCell>
                      <TableCell>
                        {(previewCurrentPrices
                          ? product?.tax_rate
                          : saved?.tax_rate) ?? 0}
                        %
                      </TableCell>
                      <TableCell>
                        {line
                          ? quoteMoney(line.total, totals?.currency || 'INR')
                          : '—'}
                      </TableCell>
                      {editable && (
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('remove')}
                            onClick={() =>
                              setForm((previous) => ({
                                ...previous,
                                items: previous.items.filter(
                                  (_, i) => i !== index
                                ),
                              }))
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {!form.items.length && (
              <p className="text-muted-foreground py-4 text-sm">
                {t('noItems')}
              </p>
            )}
            <div className="ml-auto max-w-sm space-y-3">
              <div className="space-y-2">
                <Label htmlFor="quote-discount">{t('discountPercent')}</Label>
                <Input
                  id="quote-discount"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  value={form.discount_percent}
                  onChange={(e) =>
                    setForm((previous) => ({
                      ...previous,
                      discount_percent: e.target.value,
                    }))
                  }
                />
              </div>
              {calculationError ? (
                <p role="alert" className="text-destructive text-sm">
                  {calculationError}
                </p>
              ) : (
                totals && (
                  <dl className="space-y-2 text-sm">
                    {(
                      [
                        ['subtotal', totals.subtotal],
                        ['discount', totals.discount_total],
                        ['tax', totals.tax_total],
                        ['total', totals.total],
                      ] as const
                    ).map(([key, value]) => (
                      <div
                        key={key}
                        className={`flex justify-between gap-4 ${key === 'total' ? 'border-t pt-3 text-lg font-semibold' : ''}`}
                      >
                        <dt>{t(key)}</dt>
                        <dd className="tabular-nums">
                          {quoteMoney(value, totals.currency || 'INR')}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )
              )}
            </div>
            <p className="text-muted-foreground text-xs">{t('priceHelp')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="quote-requirements">{t('requirements')}</Label>
              <Textarea
                id="quote-requirements"
                rows={5}
                maxLength={5000}
                value={form.requirements}
                onChange={(e) =>
                  setForm((previous) => ({
                    ...previous,
                    requirements: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-terms">{t('terms')}</Label>
              <Textarea
                id="quote-terms"
                rows={5}
                maxLength={3000}
                value={form.terms}
                onChange={(e) =>
                  setForm((previous) => ({
                    ...previous,
                    terms: e.target.value,
                  }))
                }
              />
            </div>
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button
              type="submit"
              disabled={
                saving ||
                !form.items.length ||
                !form.contact_id ||
                Boolean(calculationError)
              }
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t('saveDraft')}
            </Button>
          )}
          {quote?.status === 'draft' && canApprove && (
            <Button
              type="button"
              variant="outline"
              disabled={
                saving || dirty || !quote.items.length || quote.ai_collecting
              }
              onClick={() => action('approve')}
            >
              {t('approve')}
            </Button>
          )}
          {quote?.status === 'approved' && canApprove && (
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => action('reopen')}
            >
              {t('reopen')}
            </Button>
          )}
          {quote &&
            ['draft', 'approved'].includes(quote.status) &&
            canWrite && (
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => action('cancel')}
              >
                {t('cancel')}
              </Button>
            )}
          {quote?.status === 'sent' && canWrite && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => action('accept')}
              >
                {t('accept')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => action('reject')}
              >
                {t('reject')}
              </Button>
            </>
          )}
        </div>
        {quote?.status === 'draft' && dirty && (
          <p className="text-muted-foreground text-xs">
            {t('saveBeforeApprove')}
          </p>
        )}
      </form>
      {sending && quote && (
        <QuotationSend
          quote={quote}
          onClose={() => setSending(false)}
          onSent={() => {
            void refreshQuote();
          }}
        />
      )}
    </div>
  );
}
