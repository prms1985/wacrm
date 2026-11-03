'use client';

import {
  CheckCheck,
  Copy,
  ExternalLink,
  FileText,
  MessageSquare,
  Phone,
  Reply,
  Video,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TemplateButton } from '@/types';
import { renderTemplateSample } from '@/lib/whatsapp/template-phone';
import { templateLanguageLabel } from '@/lib/whatsapp/template-languages';

interface TemplatePreviewProps {
  language: string;
  header_format: string;
  header_content: string;
  header_sample: string;
  header_media_url: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
}

const BUTTON_ICONS = {
  QUICK_REPLY: Reply,
  URL: ExternalLink,
  PHONE_NUMBER: Phone,
  COPY_CODE: Copy,
};

export function TemplatePreview({ form }: { form: TemplatePreviewProps }) {
  const t = useTranslations('Settings.templates');
  const mediaUrl = /^https?:\/\//i.test(form.header_media_url)
    ? form.header_media_url
    : null;
  return (
    <aside
      className="space-y-3 lg:sticky lg:top-2"
      aria-label={t('previewTitle')}
    >
      <div>
        <h3 className="text-foreground font-semibold">{t('previewTitle')}</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          {templateLanguageLabel(form.language)}
        </p>
      </div>
      <div className="border-border rounded-2xl border bg-[#e9e2d9] p-4 dark:bg-[#0b141a]">
        <div className="mb-4 flex items-center gap-2 border-b border-black/10 pb-3 text-xs font-medium text-[#54656f] dark:border-white/10 dark:text-[#aebac1]">
          <MessageSquare className="size-4" /> WhatsApp
        </div>
        <div className="overflow-hidden rounded-lg bg-white text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
          <div className="space-y-2 p-3">
            {form.header_format === 'text' && form.header_content && (
              <p
                dir="auto"
                className="font-semibold break-words whitespace-pre-wrap"
              >
                {renderTemplateSample(form.header_content, [
                  form.header_sample,
                ])}
              </p>
            )}
            {form.header_format === 'image' &&
              (mediaUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl}
                  alt={t('headerSampleAlt')}
                  className="max-h-52 w-full rounded object-contain"
                />
              ) : (
                <div className="flex h-32 items-center justify-center rounded bg-black/5 text-xs text-[#667781] dark:bg-white/5">
                  {t('previewImage')}
                </div>
              ))}
            {(form.header_format === 'video' ||
              form.header_format === 'document') && (
              <div className="flex items-center gap-2 rounded bg-black/5 p-4 text-xs dark:bg-white/5">
                {form.header_format === 'video' ? (
                  <Video className="size-5" />
                ) : (
                  <FileText className="size-5" />
                )}
                {form.header_format === 'video'
                  ? t('headerVideo')
                  : t('headerDocument')}
              </div>
            )}
            <p
              dir="auto"
              className="text-[13px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap"
            >
              {renderTemplateSample(form.body_text, form.body_samples) ||
                t('previewBody')}
            </p>
            {form.footer_text && (
              <p
                dir="auto"
                className="text-[11px] break-words whitespace-pre-wrap text-[#667781] dark:text-[#aebac1]"
              >
                {form.footer_text}
              </p>
            )}
            <div className="flex justify-end gap-1 text-[10px] text-[#667781] dark:text-[#aebac1]">
              12:00 <CheckCheck className="size-3.5 text-[#53bdeb]" />
            </div>
          </div>
          {form.buttons.map((button, index) => {
            const Icon = BUTTON_ICONS[button.type];
            return (
              <div
                key={index}
                className="flex items-center justify-center gap-2 border-t border-black/10 px-3 py-2.5 text-center text-[13px] text-[#0086ea] dark:border-white/10 dark:text-[#53bdeb]"
              >
                <Icon className="size-4 shrink-0" />
                <span dir="auto" className="break-words">
                  {button.text || t('btnLabelPlaceholder')}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">
        {t('previewHint')}
      </p>
    </aside>
  );
}
