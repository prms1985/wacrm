import { describe, expect, it } from 'vitest';
import {
  normalizeTemplatePhoneNumber,
  normalizeTemplatePhoneButtons,
  renderTemplateSample,
} from './template-phone';

describe('Indian template call buttons', () => {
  it.each([
    ['9884488178', '+919884488178'],
    ['98844 88178', '+919884488178'],
    ['+91 98844 88178', '+919884488178'],
    ['919884488178', '+919884488178'],
    ['09884488178', '+919884488178'],
    ['0091-98844-88178', '+919884488178'],
    ['+91 (44) 2345 6789', '+914423456789'],
    ['९८८४४८८१७८', '+919884488178'],
    ['௯௮௮௪௪௮௮௧௭௮', '+919884488178'],
    ['৯৮৮৪৪৮৮১৭৮', '+919884488178'],
    ['+1 (555) 123-4567', '+15551234567'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('normalizes %s to a Meta-compatible number', (input, expected) => {
    expect(normalizeTemplatePhoneNumber(input)).toBe(expected);
  });

  it.each([
    '',
    '+91',
    '988448817',
    '+91 98844881789',
    '+91 09884488178',
    'call9884488178',
    '+91+9884488178',
    '+1234567890123456',
    '123 ext 44',
  ])('rejects malformed number %s', (input) => {
    expect(normalizeTemplatePhoneNumber(input)).toBeNull();
  });

  it('normalizes call buttons without mutating the original or changing other button types', () => {
    const buttons = [
      {
        type: 'PHONE_NUMBER' as const,
        text: 'அழைக்கவும்',
        phone_number: '98844 88178',
      },
      { type: 'QUICK_REPLY' as const, text: 'நன்றி' },
    ];
    expect(normalizeTemplatePhoneButtons(buttons)).toEqual([
      { ...buttons[0], phone_number: '+919884488178' },
      buttons[1],
    ]);
    expect(buttons[0].phone_number).toBe('98844 88178');
  });
});

describe('template preview sample substitution', () => {
  it('renders actual review samples, retaining Indian language content', () => {
    expect(
      renderTemplateSample('வணக்கம் {{1}}, உங்கள் நேரம் {{2}}.', [
        'பரமேஸ்',
        '10:30',
      ])
    ).toBe('வணக்கம் பரமேஸ், உங்கள் நேரம் 10:30.');
  });
  it('retains missing sample placeholders and replaces repeated variables', () => {
    expect(renderTemplateSample('{{1}} / {{2}} / {{1}}', ['Parames'])).toBe(
      'Parames / {{2}} / Parames'
    );
  });
});
