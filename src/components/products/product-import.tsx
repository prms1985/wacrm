'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ProductImport({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const t = useTranslations('Products');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || saving) return;
    if (file.size > 1024 * 1024) {
      setError(t('errors.csvSize'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data = new FormData();
      data.set('file', file);
      const response = await fetch('/api/products/import', {
        method: 'POST',
        body: data,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t('errors.save'));
      toast.success(t('imported', { count: result.imported }));
      onImported();
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
      <DialogContent className="sm:max-w-lg" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>{t('import')}</DialogTitle>
          <DialogDescription>{t('importDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={upload} className="space-y-4">
          <a
            href="/samples/products.csv"
            download
            className="text-primary text-sm underline underline-offset-4"
          >
            {t('sample')}
          </a>
          <div className="space-y-2">
            <Label htmlFor="product-csv">{t('csvFile')}</Label>
            <Input
              id="product-csv"
              type="file"
              accept=".csv,text/csv"
              required
              disabled={saving}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError('');
              }}
            />
          </div>
          <p className="text-muted-foreground text-xs">{t('importHelp')}</p>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              {t('close')}
            </Button>
            <Button type="submit" disabled={!file || saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t('import')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
