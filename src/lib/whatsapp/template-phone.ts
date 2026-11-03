import type { TemplateButton } from '@/types';

// Accept numbers typed with Indian scripts as well as Latin digits.
const DIGIT_ZEROS = [
  0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66,
  0x0ce6, 0x0d66,
];

/** Local numbers default to India. Explicit international numbers retain their country code. */
export function normalizeTemplatePhoneNumber(value: string): string | null {
  const digits = value.replace(/\p{Nd}/gu, (digit) => {
    const point = digit.codePointAt(0)!;
    const zero = DIGIT_ZEROS.find(
      (start) => point >= start && point <= start + 9
    );
    return zero === undefined ? digit : String(point - zero);
  });
  let phone = digits.trim().replace(/[\s().-]/g, '');
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  if (/^0[1-9]\d{9}$/.test(phone)) phone = phone.slice(1);
  if (/^[1-9]\d{9}$/.test(phone)) phone = `+91${phone}`;
  else if (/^91[1-9]\d{9}$/.test(phone)) phone = `+${phone}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null;
  if (phone.startsWith('+91') && !/^\+91[1-9]\d{9}$/.test(phone)) return null;
  return phone;
}

export function normalizeTemplatePhoneButtons(
  buttons: TemplateButton[] | undefined
): TemplateButton[] | undefined {
  if (!Array.isArray(buttons)) return buttons;
  return buttons.map((button) =>
    button.type === 'PHONE_NUMBER'
      ? {
          ...button,
          phone_number:
            normalizeTemplatePhoneNumber(button.phone_number ?? '') ??
            button.phone_number,
        }
      : button
  );
}

export function renderTemplateSample(
  text: string,
  samples: readonly string[]
): string {
  return text.replace(
    /\{\{(\d+)\}\}/g,
    (placeholder, index: string) =>
      samples[Number(index) - 1]?.trim() || placeholder
  );
}
