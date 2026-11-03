import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Product } from '@/lib/products/types';
import { calculateQuotation } from '@/lib/quotations/calculate';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  validateInteractivePayload,
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import {
  parseReceptionistResponse,
  buildReceptionistSystemPrompt,
  processAiReceptionist,
} from '@/lib/ai/receptionist';
import type { AiConfig } from '@/lib/ai/types';

// Mock dependencies for AI testing
const mocks = vi.hoisted(() => ({
  generateReply: vi.fn(),
  prepareAiQuotation: vi.fn(),
  logAiUsage: vi.fn(),
}));

vi.mock('@/lib/ai/generate', () => ({ generateReply: mocks.generateReply }));
vi.mock('@/lib/quotations/ai', () => ({
  prepareAiQuotation: mocks.prepareAiQuotation,
}));
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: mocks.logAiUsage }));

describe('Supermarket Business: Complete WhatsApp CRM Workflow Mock Test', () => {
  // 1. Supermarket Product Catalogue
  const supermarketCatalog: Product[] = [
    {
      id: 'prod-milk-01',
      account_id: 'acc-supermarket-1',
      name: 'Fresh Farm Whole Milk 1L',
      sku: 'DAIRY-MILK-1L',
      category: 'Dairy',
      kind: 'product',
      unit: 'bottle',
      unit_price: 2.5,
      tax_rate: 0.0,
      currency: 'USD',
      availability: 'available',
      specifications: null,
      image_url: null,
      is_active: true,
      description: 'Pasteurized local whole milk from pasture-raised cows.',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'prod-eggs-01',
      account_id: 'acc-supermarket-1',
      name: 'Organic Brown Eggs 12-pack',
      sku: 'DAIRY-EGGS-12PK',
      category: 'Dairy',
      kind: 'product',
      unit: 'carton',
      unit_price: 4.5,
      tax_rate: 0.0,
      currency: 'USD',
      availability: 'available',
      specifications: null,
      image_url: null,
      is_active: true,
      description: 'Cage-free grade A large brown eggs.',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'prod-bread-01',
      account_id: 'acc-supermarket-1',
      name: 'Artisanal Sourdough Bread',
      sku: 'BAKERY-SOURDOUGH',
      category: 'Bakery',
      kind: 'product',
      unit: 'loaf',
      unit_price: 3.5,
      tax_rate: 0.0,
      currency: 'USD',
      availability: 'available',
      specifications: null,
      image_url: null,
      is_active: true,
      description: 'Slow-fermented crusty sourdough bread baked fresh daily.',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'prod-rice-01',
      account_id: 'acc-supermarket-1',
      name: 'Royal Basmati Rice 5kg',
      sku: 'PANTRY-RICE-5KG',
      category: 'Pantry',
      kind: 'product',
      unit: 'bag',
      unit_price: 12.0,
      tax_rate: 5.0, // 5% tax
      currency: 'USD',
      availability: 'available',
      specifications: null,
      image_url: null,
      is_active: true,
      description: 'Aged long-grain aromatic basmati rice.',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'prod-oil-01',
      account_id: 'acc-supermarket-1',
      name: 'Extra Virgin Olive Oil 500ml',
      sku: 'PANTRY-EVOO-500ML',
      category: 'Pantry',
      kind: 'product',
      unit: 'bottle',
      unit_price: 9.0,
      tax_rate: 5.0, // 5% tax
      currency: 'USD',
      availability: 'available',
      specifications: null,
      image_url: null,
      is_active: true,
      description: 'Cold-pressed extra virgin Mediterranean olive oil.',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const supermarketAiConfig: AiConfig = {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    baseUrl: null,
    apiKey: 'sk-supermarket-test',
    systemPrompt:
      'You are Sara, the digital assistant for FreshMart Supermarket. Assist customers with groceries, stock inquiries, delivery slots, and orders.',
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 10,
    handoffAgentId: 'agent-delivery-lead',
    embeddingsApiKey: null,
    receptionistConfig: {
      enabled: true,
      receptionistName: 'Sara',
      greetingPrompt:
        'Warmly welcome customer to FreshMart Supermarket. Check delivery slots and provide grocery recommendations.',
      collectDetails: true,
      suggestProducts: true,
      prepareQuotations: true,
      transferToStaff: true,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Customer Phone Normalization & WhatsApp Identity
  it('Step 1: Normalizes customer WhatsApp phone number to digits-only Meta format', () => {
    const rawNumber1 = '+1 (555) 234-5678';
    const rawNumber2 = '15552345678';
    const rawNumber3 = ' +1-555-234-5678 ';

    expect(normalizePhone(rawNumber1)).toBe('15552345678');
    expect(normalizePhone(rawNumber2)).toBe('15552345678');
    expect(normalizePhone(rawNumber3)).toBe('15552345678');
  });

  // Test 2: AI Receptionist Customer Inquiry & FAQ Handling
  it('Step 2: Builds Supermarket AI prompt with store hours, delivery policy and catalog', () => {
    const knowledgeBase = [
      'Store hours: Open daily 7:00 AM to 10:00 PM.',
      'Home delivery: Free delivery for orders over $25. Flat $3.50 fee for orders under $25.',
      'Delivery slots: Slot 1 (10 AM - 1 PM), Slot 2 (4 PM - 7 PM). Same-day delivery for orders before 5 PM.',
    ];

    const prompt = buildReceptionistSystemPrompt({
      config: supermarketAiConfig,
      existingContact: {
        name: 'Maria Santos',
        phone: '+15552345678',
        email: 'maria@example.com',
        company: null,
      },
      knowledge: knowledgeBase,
      products: supermarketCatalog,
    });

    expect(prompt).toContain('FreshMart Supermarket');
    expect(prompt).toContain('Store hours: Open daily 7:00 AM to 10:00 PM');
    expect(prompt).toContain('Free delivery for orders over $25');
    expect(prompt).toContain('Fresh Farm Whole Milk 1L');
    expect(prompt).toContain('Organic Brown Eggs 12-pack');
    expect(prompt).toContain('Royal Basmati Rice 5kg');
  });

  // Test 3: AI Customer Inquiry Response Parsing
  it('Step 3: Parses AI response when customer orders groceries via chat', () => {
    const mockModelOutput = JSON.stringify({
      reply:
        'Hello Maria! We have both Fresh Farm Milk and Organic Brown Eggs in stock. Delivery is available today between 4 PM - 7 PM. Would you like me to prepare your grocery order?',
      extracted_contact: {
        name: 'Maria Santos',
        email: 'maria.s@example.com',
      },
      requirements:
        'Wants milk, eggs, and bread delivered this afternoon to 742 Evergreen Terrace.',
      suggested_product_ids: ['prod-milk-01', 'prod-eggs-01', 'prod-bread-01'],
      prepare_quotation: true,
      transfer_to_staff: false,
    });

    const result = parseReceptionistResponse(mockModelOutput);

    expect(result.reply).toContain('Hello Maria!');
    expect(result.extracted_contact?.name).toBe('Maria Santos');
    expect(result.extracted_contact?.email).toBe('maria.s@example.com');
    expect(result.requirements).toContain('742 Evergreen Terrace');
    expect(result.suggested_product_ids).toEqual([
      'prod-milk-01',
      'prod-eggs-01',
      'prod-bread-01',
    ]);
    expect(result.prepare_quotation).toBe(true);
    expect(result.transfer_to_staff).toBe(false);
  });

  // Test 4: Financial Quotation Calculation for Grocery Basket
  it('Step 4: Accurately calculates grocery order subtotal, discounts, and tax using exact decimal scaling', () => {
    // Maria orders:
    // - 2 x Fresh Farm Milk ($2.50 ea = $5.00) [Tax: 0%]
    // - 1 x Organic Eggs ($4.50 ea = $4.50) [Tax: 0%]
    // - 2 x Sourdough Bread ($3.50 ea = $7.00) [Tax: 0%]
    // - 1 x Basmati Rice 5kg ($12.00 ea = $12.00) [Tax: 5%]
    // Subtotal: 5.00 + 4.50 + 7.00 + 12.00 = $28.50
    // Discount: 10% coupon (SUPER10) -> $2.85 discount
    // Rice base after discount: 12.00 - 1.20 = $10.80 -> 5% tax = $0.54
    // Expected Total: (28.50 - 2.85) + 0.54 = $26.19

    const selections = [
      { product_id: 'prod-milk-01', quantity: '2' },
      { product_id: 'prod-eggs-01', quantity: '1' },
      { product_id: 'prod-bread-01', quantity: '2' },
      { product_id: 'prod-rice-01', quantity: '1' },
    ];

    const calculation = calculateQuotation(
      supermarketCatalog,
      selections,
      '10'
    );

    expect(calculation.currency).toBe('USD');
    expect(calculation.subtotal).toBe(28.5);
    expect(calculation.discount_total).toBe(2.85);
    expect(calculation.tax_total).toBe(0.54);
    expect(calculation.total).toBe(26.19);
    expect(calculation.items).toHaveLength(4);
  });

  // Test 5: Interactive WhatsApp Message for Delivery Confirmation
  it('Step 5: Validates and prepares WhatsApp interactive buttons for order confirmation', () => {
    const payload: InteractiveMessagePayload = {
      kind: 'buttons',
      header: '🛒 FreshMart Order #FM-1049',
      body: 'Your grocery basket ($26.19) is scheduled for delivery today between 4 PM - 7 PM.\n\nAddress: 742 Evergreen Terrace.',
      footer: 'FreshMart Supermarket • Free Delivery',
      buttons: [
        {
          id: 'btn_confirm_order',
          title: 'Confirm Order ✅',
        },
        {
          id: 'btn_change_slot',
          title: 'Change Time 🕒',
        },
        {
          id: 'btn_call_store',
          title: 'Call Store 📞',
        },
      ],
    };

    // Must pass WhatsApp interactive payload constraints (<= 3 buttons, character limits, unique IDs)
    const validation = validateInteractivePayload(payload);
    expect(validation.ok).toBe(true);

    const preview = interactivePayloadPreviewText(payload);
    expect(preview).toContain('Your grocery basket ($26.19)');
  });

  // Test 6: Simulating Full End-to-End Receptionist Cycle in Supermarket
  it('Step 6: Executes processAiReceptionist saving customer order notes and contact updates', async () => {
    const contactRecord = {
      id: 'contact-maria-77',
      phone: '+15552345678',
      name: null as string | null,
      email: null as string | null,
      company: null as string | null,
    };
    const contactUpdates: Record<string, unknown>[] = [];
    const contactNotes: {
      contact_id: string;
      user_id: string;
      note_text: string;
    }[] = [];
    const conversationUpdates: Record<string, unknown>[] = [];

    const mockDb = {
      from: (table: string) => {
        if (table === 'contacts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: contactRecord, error: null }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              contactUpdates.push(payload);
              Object.assign(contactRecord, payload);
              return {
                eq: () => ({
                  eq: () => Promise.resolve({ error: null }),
                }),
              };
            },
          };
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  neq: () => ({
                    order: () => ({
                      limit: () =>
                        Promise.resolve({
                          data: supermarketCatalog,
                          error: null,
                        }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'contact_notes') {
          return {
            insert: (payload: {
              contact_id: string;
              user_id: string;
              note_text: string;
            }) => {
              contactNotes.push(payload);
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table === 'conversations') {
          return {
            update: (payload: Record<string, unknown>) => {
              conversationUpdates.push(payload);
              return {
                eq: () => ({
                  is: () => Promise.resolve({ error: null }),
                }),
              };
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    // Mock AI generation returning structured supermarket response
    mocks.generateReply.mockResolvedValueOnce({
      text: JSON.stringify({
        reply:
          'Thank you Maria! I have noted your delivery address. Fresh milk, bread and eggs are packed. Our driver will dispatch by 4 PM.',
        extracted_contact: {
          name: 'Maria Santos',
          email: 'maria@freshmart-shopper.com',
        },
        requirements: 'Delivery to 742 Evergreen Terrace; ring bell twice.',
        suggested_product_ids: [
          'prod-milk-01',
          'prod-bread-01',
          'prod-eggs-01',
        ],
        prepare_quotation: false,
        transfer_to_staff: false,
      }),
      usage: { promptTokens: 350, completionTokens: 90, totalTokens: 440 },
    });

    const outcome = await processAiReceptionist({
      db: mockDb,
      accountId: 'acc-supermarket-1',
      conversationId: 'conv-maria-101',
      contactId: 'contact-maria-77',
      config: supermarketAiConfig,
      messages: [
        {
          role: 'user',
          content:
            'Hi, I need delivery to 742 Evergreen Terrace. Ring bell twice please!',
        },
      ],
      configOwnerUserId: 'user-manager-1',
      knowledge: [],
    });

    // Assertions
    expect(outcome).not.toBeNull();
    if (!outcome) throw new Error('Expected receptionist result');
    expect(outcome.reply).toContain('Thank you Maria!');
    expect(outcome.extractedContact?.name).toBe('Maria Santos');
    expect(contactRecord.name).toBe('Maria Santos');
    expect(contactRecord.email).toBe('maria@freshmart-shopper.com');
    expect(contactNotes).toHaveLength(1);
    expect(contactNotes[0].note_text).toContain('742 Evergreen Terrace');
    expect(mocks.logAiUsage).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        accountId: 'acc-supermarket-1',
        usage: expect.objectContaining({ totalTokens: 440 }),
      })
    );
  });
});
