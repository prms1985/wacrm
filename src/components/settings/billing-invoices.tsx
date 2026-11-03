'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Template = { name: string; language: string; body_text: string };
type Delivery = { invoice_id: string; recipient: string; state: string; delivery_status: string | null };
export function BillingInvoices() {
  const t = useTranslations('Settings.billingInvoices');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [history, setHistory] = useState<Delivery[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invoice, setInvoice] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [params, setParams] = useState('[]');
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/billing/invoices'); const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || t('error'));
      setTemplates(result.data.templates); setHistory(result.data.history); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : t('error')); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  const template = templates.find(row => JSON.stringify([row.name, row.language]) === selected);
  const send = async () => {
    if (!template || !file || !consent || !invoice.trim() || !phone.trim()) { toast.error(t('required')); return; }
    const data = new FormData();
    for (const [key, value] of Object.entries({ invoice_id: invoice, to: phone, name, template_name: template.name, template_language: template.language, body_params: params, consent: 'true' })) data.set(key, value);
    data.set('file', file); setBusy(true);
    try {
      const response = await fetch('/api/billing/invoices', { method: 'POST', body: data }); const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || t('error'));
      toast.success(t('accepted'));
    } catch (err) { toast.error(err instanceof Error ? err.message : t('error')); }
    finally { setBusy(false); await load(); }
  };
  return <Card>
    <CardHeader><CardTitle>{t('title')}</CardTitle><p className="text-sm text-muted-foreground">{t('description')}</p></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('setup')}</p>
      <p className="text-sm">{t('endpoint')}: <code>POST /api/v1/invoices</code></p>
      <p className="text-xs text-muted-foreground">{t('connector')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="bill-ref">{t('invoice')}</Label><Input id="bill-ref" value={invoice} onChange={e => setInvoice(e.target.value)} maxLength={120} disabled={busy} placeholder="STORE1-2026-INV-001" /></div>
        <div className="space-y-2"><Label htmlFor="bill-phone">{t('phone')}</Label><Input id="bill-phone" value={phone} onChange={e => setPhone(e.target.value)} disabled={busy} placeholder="+91 98765 43210" /></div>
        <div className="space-y-2"><Label htmlFor="bill-name">{t('name')}</Label><Input id="bill-name" value={name} onChange={e => setName(e.target.value)} disabled={busy} /></div>
        <div className="space-y-2"><Label htmlFor="bill-template">{t('template')}</Label><select id="bill-template" className="w-full rounded-md border border-input bg-background p-2 text-sm" value={selected} onChange={e => setSelected(e.target.value)} disabled={busy}><option value="">{t('choose')}</option>{templates.map(row => <option key={JSON.stringify([row.name,row.language])} value={JSON.stringify([row.name,row.language])}>{row.name} ({row.language})</option>)}</select></div>
      </div>
      {!templates.length && !error && <p className="text-sm text-muted-foreground">{t('templateEmpty')}</p>}
      {template && <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{template.body_text}</p>}
      <div className="space-y-2"><Label htmlFor="bill-params">{t('params')}</Label><Textarea id="bill-params" value={params} onChange={e => setParams(e.target.value)} disabled={busy} placeholder={'["Customer", "INV-001"]'} /></div>
      <div className="space-y-2"><Label htmlFor="bill-pdf">{t('pdf')}</Label><Input id="bill-pdf" type="file" accept="application/pdf,.pdf" onChange={e => setFile(e.target.files?.[0] || null)} disabled={busy} /></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} />{t('consent')}</label>
      <p className="text-xs text-muted-foreground">{t('review')}</p>
      <div className="flex gap-2"><Button disabled={busy || !!error || !template || !file || !consent} onClick={send}>{t(busy ? 'sending' : 'send')}</Button><Button variant="outline" disabled={busy} onClick={() => void load()}>{t('refresh')}</Button></div>
      <p className="text-sm font-medium">{t('history')}</p>
      <p className="text-xs text-muted-foreground">{t('outcome')}</p>
      {!history.length ? <p className="text-sm text-muted-foreground">{t('empty')}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">{t('invoice')}</th><th className="p-2">{t('phone')}</th><th className="p-2">{t('status')}</th></tr></thead><tbody>{history.map(row => <tr key={row.invoice_id} className="border-t"><td className="p-2">{row.invoice_id}</td><td className="p-2">{row.recipient}</td><td className="p-2">{row.state} / {row.delivery_status || '—'}</td></tr>)}</tbody></table></div>}
    </CardContent>
  </Card>;
}
