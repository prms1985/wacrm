'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { CURRENCIES } from '@/lib/currency';
import {
  PRODUCT_AVAILABILITIES,
  PRODUCT_KINDS,
  type Product,
} from '@/lib/products/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export const productSelectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

interface Props {
  product: Product | null;
  defaultCurrency: string;
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function ProductForm({
  product,
  defaultCurrency,
  canManage,
  onClose,
  onSaved,
}: Props) {
  const t = useTranslations('Products');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    kind: product?.kind ?? 'product',
    category: product?.category ?? '',
    description: product?.description ?? '',
    specifications: product?.specifications ?? '',
    image_url: product?.image_url ?? '',
    unit: product?.unit ?? 'pcs',
    unit_price: product ? String(product.unit_price) : '',
    currency: product?.currency ?? defaultCurrency,
    tax_rate: product ? String(product.tax_rate) : '0',
    availability: product?.availability ?? 'available',
  });

  function field(name: keyof typeof form, value: string) {
    setForm((previous) => ({ ...previous, [name]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(
        product ? `/api/products/${product.id}` : '/api/products',
        {
          method: product ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t('errors.save'));
      toast.success(t('saved'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.save'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!saving}
      >
        <DialogHeader>
          <DialogTitle>
            {!canManage ? t('details') : product ? t('edit') : t('add')}
          </DialogTitle>
          <DialogDescription>{t('formDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-5">
          <fieldset
            disabled={saving || !canManage}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="product-name">{t('fields.name')} *</Label>
              <Input
                id="product-name"
                value={form.name}
                onChange={(e) => field('name', e.target.value)}
                maxLength={200}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-sku">{t('fields.sku')}</Label>
              <Input
                id="product-sku"
                value={form.sku}
                onChange={(e) => field('sku', e.target.value)}
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-kind">{t('fields.kind')}</Label>
              <select
                id="product-kind"
                className={productSelectClass}
                value={form.kind}
                onChange={(e) => {
                  const kind = e.target.value;
                  setForm((previous) => ({
                    ...previous,
                    kind: kind as Product['kind'],
                    unit:
                      !product && ['pcs', 'hour'].includes(previous.unit)
                        ? kind === 'service'
                          ? 'hour'
                          : 'pcs'
                        : previous.unit,
                  }));
                }}
              >
                {PRODUCT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`kinds.${kind}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-category">{t('fields.category')}</Label>
              <Input
                id="product-category"
                value={form.category}
                onChange={(e) => field('category', e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-unit">{t('fields.unit')} *</Label>
              <Input
                id="product-unit"
                value={form.unit}
                onChange={(e) => field('unit', e.target.value)}
                maxLength={40}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-price">{t('fields.unit_price')} *</Label>
              <Input
                id="product-price"
                type="number"
                inputMode="decimal"
                min="0"
                max="999999999999.99"
                step="0.01"
                value={form.unit_price}
                onChange={(e) => field('unit_price', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-currency">{t('fields.currency')}</Label>
              <select
                id="product-currency"
                className={productSelectClass}
                value={form.currency}
                onChange={(e) => field('currency', e.target.value)}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} — {currency.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-tax">{t('fields.tax_rate')}</Label>
              <Input
                id="product-tax"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                value={form.tax_rate}
                onChange={(e) => field('tax_rate', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-availability">
                {t('fields.availability')}
              </Label>
              <select
                id="product-availability"
                className={productSelectClass}
                value={form.availability}
                onChange={(e) => field('availability', e.target.value)}
              >
                {PRODUCT_AVAILABILITIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`availability.${value}`)}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-muted-foreground text-xs sm:col-span-2">
              {t('pricingHelp')}
            </p>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="product-description">
                {t('fields.description')}
              </Label>
              <Textarea
                id="product-description"
                value={form.description}
                onChange={(e) => field('description', e.target.value)}
                maxLength={5000}
                rows={3}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="product-specifications">
                {t('fields.specifications')}
              </Label>
              <Textarea
                id="product-specifications"
                value={form.specifications}
                onChange={(e) => field('specifications', e.target.value)}
                maxLength={5000}
                rows={3}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="product-image">{t('fields.image_url')}</Label>
              <Input
                id="product-image"
                type="url"
                value={form.image_url}
                onChange={(e) => field('image_url', e.target.value)}
                maxLength={2048}
                placeholder="https://"
              />
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
            >
              {t('close')}
            </Button>
            {canManage && (
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t('save')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
