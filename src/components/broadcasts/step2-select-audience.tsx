'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  countAudience,
  type AudienceConfig,
  type AudienceType,
  type CustomFieldFilter,
  type CustomFieldOperator,
} from '@/lib/broadcast-audience';
import {
  parseBroadcastNumbers,
  type BroadcastDefaultCountry,
} from '@/lib/broadcast-input';
import { Textarea } from '@/components/ui/textarea';
import { parseBroadcastCsv } from '@/lib/broadcast-csv';
import { CustomField, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Users,
  Tags,
  Filter,
  Upload,
  FileText,
  ClipboardPaste,
  Download,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const t = useTranslations('Broadcasts.wizard');

  const OPERATOR_OPTIONS = useMemo<
    { value: CustomFieldOperator; label: string }[]
  >(
    () => [
      { value: 'is', label: t('selectAudience.operatorIs') },
      { value: 'is_not', label: t('selectAudience.operatorIsNot') },
      { value: 'contains', label: t('selectAudience.operatorContains') },
    ],
    [t]
  );

  const audienceOptions = useMemo<
    {
      type: AudienceType;
      label: string;
      description: string;
      icon: typeof Users;
    }[]
  >(
    () => [
      {
        type: 'all',
        label: t('selectAudience.method.all'),
        description: t('selectAudience.allDescLoading'),
        icon: Users,
      },
      {
        type: 'tags',
        label: t('selectAudience.method.tags'),
        description: t('selectAudience.tagDesc'),
        icon: Tags,
      },
      {
        type: 'custom_field',
        label: t('selectAudience.method.customField'),
        description: t('selectAudience.customFieldDesc'),
        icon: Filter,
      },
      {
        type: 'csv',
        label: t('selectAudience.method.csv'),
        description: t('selectAudience.csvDesc'),
        icon: Upload,
      },
      {
        type: 'paste',
        label: t('selectAudience.method.paste'),
        description: t('selectAudience.pasteDesc'),
        icon: ClipboardPaste,
      },
    ],
    [t]
  );
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  // The picked file's name, shown back to the user. The parsed rows
  // themselves live on `audience.csvContacts` (owned by the wizard) so
  // they survive stepping forward and back.
  const [pickedCsvName, setPickedCsvName] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const readVersion = useRef(0);
  const [loadingCsv, setLoadingCsv] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const defaultCountry = audience.defaultCountry ?? 'IN';
  const pasted = useMemo(
    () => parseBroadcastNumbers(audience.rawNumbers ?? '', defaultCountry),
    [audience.rawNumbers, defaultCountry]
  );
  const importStats =
    audience.type === 'paste'
      ? pasted
      : (audience.importStats ?? { duplicates: 0, invalid: 0 });
  useEffect(
    () => () => {
      readVersion.current++;
    },
    []
  );

  const csvCount = audience.csvContacts?.length ?? 0;
  // Only meaningful while the rows it produced are still in play —
  // picking another audience type wipes `csvContacts`.
  const csvFileName = csvCount > 0 ? pickedCsvName : null;

  // Tags are used both by the primary "Filter by Tags" audience type
  // AND by the exclude-list below — so always load once on mount.
  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        setTags(data ?? []);
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  // Lazy-load custom fields only when that audience type is active.
  useEffect(() => {
    if (audience.type !== 'custom_field') return;
    async function fetchFields() {
      setLoadingFields(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('custom_fields')
          .select('*')
          .order('field_name');
        setCustomFields(data ?? []);
      } finally {
        setLoadingFields(false);
      }
    }
    fetchFields();
  }, [audience.type]);

  const estimateSeq = useRef(0);
  const fetchEstimatedCount = useCallback(async () => {
    const seq = ++estimateSeq.current;
    setLoadingCount(true);
    let count: number | null;
    try {
      count = await countAudience(createClient(), {
        type: audience.type,
        tagIds: audience.tagIds,
        customField: audience.customField,
        csvContacts: audience.csvContacts,
        excludeTagIds: audience.excludeTagIds,
      });
    } catch {
      count = null;
    }
    if (seq !== estimateSeq.current) return;
    setEstimatedCount(count);
    setLoadingCount(false);
  }, [
    audience.type,
    audience.tagIds,
    audience.customField,
    audience.csvContacts,
    audience.excludeTagIds,
  ]);

  useEffect(() => {
    fetchEstimatedCount();
  }, [fetchEstimatedCount]);

  async function handleCsvChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const selected = input.files?.[0];
    if (!selected) return;
    const version = ++readVersion.current;
    setLoadingCsv(true);
    setCsvError(null);
    onUpdate({ ...audience, csvContacts: undefined, importStats: undefined });
    try {
      const result = parseBroadcastCsv(await selected.text(), {
        defaultCountry,
      });
      if (version !== readVersion.current) return;
      if (!result.ok) {
        const message =
          result.error === 'missing_phone_column'
            ? t('selectAudience.errorCsvMissingPhone')
            : t('selectAudience.errorCsvParse');
        setCsvError(message);
        setPickedCsvName(null);
        toast.error(message);
        return;
      }
      setPickedCsvName(selected.name);
      onUpdate({
        ...audience,
        csvContacts: result.contacts,
        importStats: { duplicates: result.duplicates, invalid: result.invalid },
      });
    } catch {
      if (version === readVersion.current) {
        setCsvError(t('selectAudience.csvReadError'));
        setPickedCsvName(null);
      }
    } finally {
      input.value = '';
      if (version === readVersion.current) setLoadingCsv(false);
    }
  }

  function updateRawNumbers(text: string, country = defaultCountry) {
    const parsed = parseBroadcastNumbers(text, country);
    onUpdate({
      ...audience,
      rawNumbers: text,
      defaultCountry: country,
      csvContacts: parsed.contacts,
      importStats: { duplicates: parsed.duplicates, invalid: parsed.invalid },
    });
  }

  function changeDefaultCountry(country: BroadcastDefaultCountry) {
    setCsvError(null);
    if (audience.type === 'paste')
      updateRawNumbers(audience.rawNumbers ?? '', country);
    else {
      setPickedCsvName(null);
      if (csvInputRef.current) csvInputRef.current.value = '';
      onUpdate({
        ...audience,
        defaultCountry: country,
        csvContacts: undefined,
        importStats: undefined,
      });
    }
  }

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, excludeTagIds: updated });
  }

  function updateCustomField(patch: Partial<CustomFieldFilter>) {
    const prev = audience.customField ?? {
      fieldId: '',
      operator: 'is' as CustomFieldOperator,
      value: '',
    };
    onUpdate({ ...audience, customField: { ...prev, ...patch } });
  }

  const isValid =
    audience.type === 'all' ||
    (audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0) ||
    (audience.type === 'custom_field' &&
      !!audience.customField?.fieldId &&
      audience.customField.value.length > 0) ||
    ((audience.type === 'csv' || audience.type === 'paste') &&
      audience.csvContacts &&
      audience.csvContacts.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t('selectAudience.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('selectAudience.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {audienceOptions.map(
          (option: {
            type: AudienceType;
            label: string;
            description: string;
            icon: typeof Users;
          }) => {
            const isSelected = audience.type === option.type;
            const Icon = option.icon;
            return (
              <button
                key={option.type}
                type="button"
                disabled={loadingCsv}
                aria-pressed={isSelected}
                onClick={() =>
                  onUpdate({
                    ...audience,
                    type: option.type,
                    // Wipe shape fields from other types to avoid stale
                    // config leaking across selections.
                    tagIds:
                      option.type === 'tags' ? audience.tagIds : undefined,
                    customField:
                      option.type === 'custom_field'
                        ? audience.customField
                        : undefined,
                    csvContacts:
                      option.type === audience.type &&
                      (option.type === 'csv' || option.type === 'paste')
                        ? audience.csvContacts
                        : undefined,
                    rawNumbers:
                      option.type === 'paste' ? audience.rawNumbers : undefined,
                    importStats:
                      option.type === audience.type
                        ? audience.importStats
                        : undefined,
                  })
                }
                className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                    : 'border-border bg-card/50 hover:border-border'
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    isSelected
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-foreground text-sm font-medium">
                    {option.label}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {option.description}
                  </p>
                </div>
              </button>
            );
          }
        )}
      </div>

      {audience.type === 'tags' && (
        <div className="border-border bg-card/50 rounded-xl border p-4">
          <p className="text-foreground mb-3 text-sm font-medium">
            {t('selectAudience.selectTags')}
          </p>
          {loadingTags ? (
            <Loader2 className="text-primary h-5 w-5 animate-spin" />
          ) : tags.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.noTagsFound')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = audience.tagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border bg-muted text-muted-foreground hover:border-border'
                    }`}
                  >
                    <span
                      className="mr-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {audience.type === 'custom_field' && (
        <div className="border-border bg-card/50 space-y-3 rounded-xl border p-4">
          <p className="text-foreground text-sm font-medium">
            {t('selectAudience.method.customField')}
          </p>
          {loadingFields ? (
            <Loader2 className="text-primary h-5 w-5 animate-spin" />
          ) : customFields.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.errorLoadFields')}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
              <select
                value={audience.customField?.fieldId ?? ''}
                onChange={(e) => updateCustomField({ fieldId: e.target.value })}
                className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
              >
                <option value="">{t('selectAudience.selectField')}</option>
                {customFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.field_name}
                  </option>
                ))}
              </select>
              <select
                value={audience.customField?.operator ?? 'is'}
                onChange={(e) =>
                  updateCustomField({
                    operator: e.target.value as CustomFieldOperator,
                  })
                }
                className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
              >
                {OPERATOR_OPTIONS.map(
                  (op: { value: CustomFieldOperator; label: string }) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  )
                )}
              </select>
              <input
                type="text"
                value={audience.customField?.value ?? ''}
                onChange={(e) => updateCustomField({ value: e.target.value })}
                placeholder={t('selectAudience.valuePlaceholder')}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
              />
            </div>
          )}
        </div>
      )}

      {(audience.type === 'csv' || audience.type === 'paste') && (
        <div className="border-border bg-card/50 space-y-2 rounded-xl border p-4">
          <label
            htmlFor="audience-default-country"
            className="text-foreground text-sm font-medium"
          >
            {t('selectAudience.defaultCountry')}
          </label>
          <select
            id="audience-default-country"
            value={defaultCountry}
            disabled={loadingCsv}
            onChange={(event) =>
              changeDefaultCountry(
                event.target.value as BroadcastDefaultCountry
              )
            }
            className="border-border bg-muted text-foreground h-10 w-full rounded-lg border px-3 text-sm"
          >
            <option value="IN">{t('selectAudience.countryIndia')}</option>
            <option value="international">
              {t('selectAudience.countryInternational')}
            </option>
          </select>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t('selectAudience.countryHint')}
          </p>
        </div>
      )}

      {audience.type === 'paste' && (
        <div className="border-border bg-card/50 space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="broadcast-raw-numbers"
              className="text-foreground text-sm font-medium"
            >
              {t('selectAudience.pasteLabel')}
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!audience.rawNumbers}
              onClick={() => updateRawNumbers('')}
            >
              {t('selectAudience.clearList')}
            </Button>
          </div>
          <Textarea
            id="broadcast-raw-numbers"
            dir="ltr"
            rows={7}
            value={audience.rawNumbers ?? ''}
            onChange={(event) => updateRawNumbers(event.target.value)}
            placeholder={'9884488178\n9876543210\n+91 91234 56789'}
            className="bg-muted max-h-80 min-h-44 resize-y overflow-y-auto font-mono text-sm"
            aria-describedby="broadcast-raw-numbers-hint"
          />
          <p
            id="broadcast-raw-numbers-hint"
            className="text-muted-foreground text-xs leading-relaxed"
          >
            {t('selectAudience.pasteHint')}
          </p>
          {pasted.invalidEntries.length > 0 && (
            <p className="text-xs break-words text-amber-500">
              {t('selectAudience.invalidExamples', {
                values: pasted.invalidEntries.join(', '),
              })}
            </p>
          )}
        </div>
      )}

      {audience.type === 'csv' && (
        <div className="border-border bg-card/50 space-y-3 rounded-xl border p-4">
          <div>
            <p className="text-foreground text-sm font-medium">
              {t('selectAudience.uploadCsv')}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t('selectAudience.csvFormatDesc')}
            </p>
          </div>

          <a
            href="/samples/broadcast-audience.csv"
            download="broadcast-audience.csv"
            className="border-border text-primary inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
          >
            <Download className="size-4" />
            {t('selectAudience.downloadCsv')}
          </a>
          <div className="bg-muted/40 space-y-2 rounded-lg p-3">
            <p className="text-foreground text-xs font-medium">
              {t('selectAudience.csvSampleTitle')}
            </p>
            <pre
              dir="ltr"
              className="text-muted-foreground overflow-x-auto text-xs"
            >
              {'phone,name\n+919876543210,Customer 1\n+919876543211,Customer 2'}
            </pre>
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.csvSampleHint')}
            </p>
          </div>
          <button
            type="button"
            disabled={loadingCsv}
            onClick={() => csvInputRef.current?.click()}
            className="group border-border bg-muted/40 hover:border-primary/40 hover:bg-muted/70 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors"
          >
            <div className="bg-muted text-muted-foreground group-hover:text-foreground flex h-10 w-10 items-center justify-center rounded-lg">
              {csvFileName ? (
                <FileText className="h-5 w-5" />
              ) : (
                <Upload className="h-5 w-5" />
              )}
            </div>
            <p className="text-foreground text-sm">
              {loadingCsv
                ? t('selectAudience.calculating')
                : (csvFileName ?? t('selectAudience.uploadCsv'))}
            </p>
            {csvCount > 0 && (
              <p className="text-primary text-xs">
                {t('selectAudience.csvContactsFound', { count: csvCount })}
              </p>
            )}
          </button>

          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvChange}
            aria-label={t('selectAudience.uploadCsv')}
            disabled={loadingCsv}
            className="hidden"
          />
          {csvError && (
            <p role="alert" className="text-xs text-red-500">
              {csvError}
            </p>
          )}
        </div>
      )}

      {(audience.type === 'csv' || audience.type === 'paste') && (
        <section
          className="border-border bg-card/50 space-y-3 rounded-xl border p-4"
          aria-label={t('selectAudience.previewTitle')}
        >
          <h3 className="text-foreground text-sm font-medium">
            {t('selectAudience.previewTitle')}
          </h3>
          <p role="status" aria-live="polite" className="text-primary text-sm">
            {t('selectAudience.importSummary', {
              valid: csvCount,
              duplicates: importStats.duplicates,
              invalid: importStats.invalid,
            })}
          </p>
          {csvCount > 0 && (
            <ul className="divide-border border-border bg-muted/30 divide-y rounded-lg border">
              {audience.csvContacts?.slice(0, 5).map((contact) => (
                <li
                  key={contact.phone}
                  className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span className="font-mono" dir="ltr">
                    {contact.phone}
                  </span>
                  {contact.name && (
                    <span className="text-muted-foreground">
                      {contact.name}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t('selectAudience.previewHint')}
          </p>
        </section>
      )}

      {/* Exclude list — applies regardless of audience type */}
      <div className="border-border bg-card/50 rounded-xl border p-4">
        <div className="mb-3 flex items-center gap-2">
          <X className="h-4 w-4 text-red-400" />
          <p className="text-foreground text-sm font-medium">
            {t('selectAudience.excludeTags')}
          </p>
        </div>
        {tags.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t('selectAudience.noTagsFound')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isExcluded = audience.excludeTagIds?.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleExcludeTag(tag.id)}
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                    isExcluded
                      ? 'border-red-500/30 bg-red-500/10 text-red-300'
                      : 'border-border bg-muted text-muted-foreground hover:border-border'
                  }`}
                >
                  <span
                    className="mr-1.5 h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Audience Summary */}
      <div className="border-border bg-card/50 rounded-xl border p-4">
        <p className="text-foreground mb-2 text-sm font-medium">
          {t('selectAudience.audienceSummary')}
        </p>
        {loadingCount ? (
          <div className="flex items-center gap-2">
            <Loader2 className="text-primary h-4 w-4 animate-spin" />
            <span className="text-muted-foreground text-xs">
              {t('selectAudience.calculating')}
            </span>
          </div>
        ) : estimatedCount !== null ? (
          <div className="flex items-center gap-2">
            <Users className="text-primary h-4 w-4" />
            <span className="text-foreground text-sm">
              {estimatedCount.toLocaleString()}
            </span>
            <span className="text-muted-foreground text-xs">
              {t('selectAudience.estimatedRecipients')}
            </span>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {t('selectAudience.selectTypeForEstimate')}
          </p>
        )}
      </div>

      <div className="border-border flex items-center justify-between border-t pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid || loadingCsv}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
