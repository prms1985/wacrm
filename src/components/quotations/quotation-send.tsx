'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import type { Quotation } from '@/lib/quotations/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { quoteSelectClass, quoteMoney } from './quotation-list';

interface Template {
  id: string;
  name: string;
  language: string;
  body_text: string;
}
export function QuotationSend({
  quote,
  onClose,
  onSent,
}: {
  quote: Quotation;
  onClose: () => void;
  onSent: () => void;
}) {
  const t = useTranslations('Quotations');
  const [templates, setTemplates] = useState<Template[]>([]),
    [templateId, setTemplateId] = useState(''),
    [values, setValues] = useState<string[]>([]),
    [reviewed, setReviewed] = useState(false),
    [sending, setSending] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/quotations/options?kind=templates', {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) setTemplates(data.templates);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : t('errors.failed'));
      });
    return () => controller.abort();
  }, [t]);
  const selected = templates.find((template) => template.id === templateId);
  const count = selected
    ? Math.max(
        0,
        ...Array.from(
          selected.body_text?.matchAll(/\{\{(\d+)\}\}/g) ?? [],
          (match) => Number(match[1])
        )
      )
    : 0;
  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending || !reviewed) return;
    setSending(true);
    setError('');
    try {
      const response = await fetch(`/api/quotations/${quote.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: quote.version,
          template_id: templateId || undefined,
          body_params: values,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onSent();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.failed'));
      onSent();
    } finally {
      setSending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !sending) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        showCloseButton={!sending}
      >
        <DialogHeader>
          <DialogTitle>{t('send')}</DialogTitle>
          <DialogDescription>{t('sendDescription')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={send}>
          <div className="bg-muted/30 rounded-lg border p-3 text-sm">
            <p className="font-medium">
              {quote.customer.name} · {quote.customer.phone}
            </p>
            <p>
              {quote.reference} · {quoteMoney(quote.total, quote.currency)}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="quote-template">{t('template')}</Label>
            <select
              id="quote-template"
              className={quoteSelectClass}
              value={templateId}
              disabled={sending}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setValues([]);
              }}
            >
              <option value="">{t('directDocument')}</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.language})
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">{t('templateHelp')}</p>
          </div>
          {selected && (
            <p className="rounded-lg border p-3 text-sm whitespace-pre-wrap">
              {selected.body_text}
            </p>
          )}
          {Array.from({ length: Math.min(count, 20) }, (_, index) => (
            <div key={index} className="space-y-2">
              <Label htmlFor={`quote-value-${index}`}>
                {t('templateValue', { number: index + 1 })}
              </Label>
              <Input
                id={`quote-value-${index}`}
                required
                maxLength={1000}
                disabled={sending}
                value={values[index] ?? ''}
                onChange={(e) =>
                  setValues((previous) => {
                    const next = [...previous];
                    next[index] = e.target.value;
                    return next;
                  })
                }
              />
            </div>
          ))}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={reviewed}
              disabled={sending}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            {t('confirmSend')}
          </label>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={onClose}
            >
              {t('close')}
            </Button>
            <Button
              type="submit"
              disabled={!reviewed || sending || quote.status !== 'approved'}
            >
              {sending && <Loader2 className="size-4 animate-spin" />}
              {t('send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
