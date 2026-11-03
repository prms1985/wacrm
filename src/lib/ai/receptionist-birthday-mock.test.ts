import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig } from './types'
import { processAiReceptionist } from './receptionist'

const mocks = vi.hoisted(() => ({
  generateReply: vi.fn(),
  prepareAiQuotation: vi.fn(),
  logAiUsage: vi.fn(),
  dbState: {
    contact: {
      id: 'contact-david-101',
      phone: '+15558392001',
      name: null as string | null,
      email: null as string | null,
      company: null as string | null,
    },
    contactUpdates: [] as Record<string, unknown>[],
    contactNotes: [] as { contact_id: string; user_id: string; note_text: string }[],
    conversationUpdates: [] as Record<string, unknown>[],
    catalogue: [
      {
        id: 'prod-bday-pkg',
        name: 'Premium Birthday Celebration Package',
        sku: 'EVT-BDAY-PREM',
        category: 'Event Packages',
        kind: 'service',
        unit: 'package',
        unit_price: 850.0,
        currency: 'USD',
        description: 'Full birthday decor, sound & lighting setup, balloon arch, and on-site coordinator.',
      },
      {
        id: 'prod-catering-deluxe',
        name: 'Deluxe Buffet Catering Service',
        sku: 'CAT-BUFFET-DLX',
        category: 'Catering',
        kind: 'service',
        unit: 'guest',
        unit_price: 35.0,
        currency: 'USD',
        description: '3-course gourmet buffet with appetizers, mains, beverages, and dessert station.',
      },
      {
        id: 'prod-photo-pkg',
        name: 'Event Photography & Video Coverage',
        sku: 'MED-PHOTO-4HR',
        category: 'Media',
        kind: 'service',
        unit: 'session',
        unit_price: 300.0,
        currency: 'USD',
        description: '4 hours professional event photography, high-res edited gallery, and highlight reel.',
      },
    ],
  },
}))

vi.mock('./generate', () => ({ generateReply: mocks.generateReply }))
vi.mock('@/lib/quotations/ai', () => ({ prepareAiQuotation: mocks.prepareAiQuotation }))
vi.mock('./usage', () => ({ logAiUsage: mocks.logAiUsage }))

describe('AI Receptionist Mock Test: Birthday Event & Sales Quotation', () => {
  const config: AiConfig = {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    baseUrl: null,
    apiKey: 'sk-test-key',
    systemPrompt: 'Grand Celebrations: Premier event planning and catering services.',
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 10,
    handoffAgentId: 'agent-events-lead',
    embeddingsApiKey: null,
    receptionistConfig: {
      enabled: true,
      receptionistName: 'Sara',
      greetingPrompt: 'Warmly greet the guest, introduce Grand Celebrations, and assist with event planning and quotations.',
      collectDetails: true,
      suggestProducts: true,
      prepareQuotations: true,
      transferToStaff: true,
    },
  }

  function mockDb() {
    return {
      from: (table: string) => {
        if (table === 'contacts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: mocks.dbState.contact, error: null }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              mocks.dbState.contactUpdates.push(payload)
              Object.assign(mocks.dbState.contact, payload)
              return {
                eq: () => ({
                  eq: () => Promise.resolve({ error: null }),
                }),
              }
            },
          }
        }
        if (table === 'products') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  neq: () => ({
                    order: () => ({
                      limit: () => Promise.resolve({ data: mocks.dbState.catalogue, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'contact_notes') {
          return {
            insert: (payload: { contact_id: string; user_id: string; note_text: string }) => {
              mocks.dbState.contactNotes.push(payload)
              return Promise.resolve({ error: null })
            },
          }
        }
        if (table === 'conversations') {
          return {
            update: (payload: Record<string, unknown>) => {
              mocks.dbState.conversationUpdates.push(payload)
              return {
                eq: () => ({
                  is: () => Promise.resolve({ error: null }),
                }),
              }
            },
          }
        }
        throw new Error(`Unexpected table ${table}`)
      },
    } as unknown as SupabaseClient
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dbState.contact = {
      id: 'contact-david-101',
      phone: '+15558392001',
      name: null,
      email: null,
      company: null,
    }
    mocks.dbState.contactUpdates = []
    mocks.dbState.contactNotes = []
    mocks.dbState.conversationUpdates = []
  })

  it('Turn 1: Customer asks about birthday event -> greets, extracts contact details, captures requirements, suggests packages', async () => {
    const db = mockDb()

    // Customer message
    const customerMsg =
      "Hello! I'm David Miller from Apex Corp (david.miller@apex.com). We are planning a 50th milestone birthday party for 40 guests next month. What packages do you have and can you cater food?"

    // Model simulated response:
    mocks.generateReply.mockResolvedValueOnce({
      text: JSON.stringify({
        reply:
          "Hello David! Welcome to Grand Celebrations. I'm Sara, your event concierge. It would be an absolute pleasure to help celebrate this 50th milestone! For 40 guests, our Premium Birthday Celebration Package ($850) includes complete themed decor and audio setup. We can pair that with our Deluxe Buffet Catering ($35/guest) which includes a 3-course gourmet menu. Would you like me to prepare a formal sales quotation for this?",
        extracted_contact: {
          name: 'David Miller',
          email: 'david.miller@apex.com',
          company: 'Apex Corp',
        },
        requirements:
          '50th milestone birthday celebration for 40 guests next month. Interested in birthday package and buffet catering.',
        suggested_product_ids: ['prod-bday-pkg', 'prod-catering-deluxe'],
        prepare_quotation: false,
        transfer_to_staff: false,
      }),
      handoff: false,
      usage: { promptTokens: 320, completionTokens: 140, totalTokens: 460 },
    })

    const turn1Result = await processAiReceptionist({
      db,
      accountId: 'acct-grand-celebrations',
      conversationId: 'conv-david-1',
      contactId: 'contact-david-101',
      configOwnerUserId: 'admin-owner-id',
      inboundMessageId: 'wamid-turn-1',
      config,
      messages: [{ role: 'user', content: customerMsg }],
      knowledge: [
        'Grand Celebrations specializes in milestone birthdays, private dining, and corporate galas.',
      ],
    })

    // 1. Verify Receptionist reply
    expect(turn1Result).not.toBeNull()
    expect(turn1Result?.reply).toContain('Hello David!')
    expect(turn1Result?.reply).toContain('Premium Birthday Celebration Package')
    expect(turn1Result?.reply).toContain('Deluxe Buffet Catering')
    expect(turn1Result?.suggestedProductIds).toEqual(['prod-bday-pkg', 'prod-catering-deluxe'])
    expect(turn1Result?.transfer).toBe(false)

    // 2. Verify contact record auto-updated
    expect(mocks.dbState.contactUpdates.length).toBe(1)
    expect(mocks.dbState.contactUpdates[0]).toEqual({
      name: 'David Miller',
      email: 'david.miller@apex.com',
      company: 'Apex Corp',
    })
    expect(mocks.dbState.contact.name).toBe('David Miller')
    expect(mocks.dbState.contact.email).toBe('david.miller@apex.com')

    // 3. Verify requirements recorded in contact_notes
    expect(mocks.dbState.contactNotes.length).toBe(1)
    expect(mocks.dbState.contactNotes[0].note_text).toContain('50th milestone birthday celebration for 40 guests')
  })

  it('Turn 2: Customer approves proposal -> triggers sales quotation preparation & staff handoff', async () => {
    const db = mockDb()

    // Contact details are already populated from Turn 1
    mocks.dbState.contact.name = 'David Miller'
    mocks.dbState.contact.email = 'david.miller@apex.com'
    mocks.dbState.contact.company = 'Apex Corp'

    const customerMsg =
      'Yes please, please prepare a quotation for the Premium Birthday Package and Deluxe Catering for 40 people.'

    // Model detects quotation intent and bridges to quotation engine
    mocks.generateReply.mockResolvedValueOnce({
      text: JSON.stringify({
        reply: 'Preparing your formal quotation now...',
        extracted_contact: null,
        requirements: 'Premium Birthday Package (qty: 1) + Deluxe Buffet Catering for 40 guests.',
        suggested_product_ids: ['prod-bday-pkg', 'prod-catering-deluxe'],
        prepare_quotation: true,
        transfer_to_staff: false,
      }),
      handoff: false,
      usage: { promptTokens: 280, completionTokens: 60, totalTokens: 340 },
    })

    // prepareAiQuotation simulated output (calculated quotation with DB RPC)
    mocks.prepareAiQuotation.mockResolvedValueOnce({
      quote: {
        id: 'quote-bday-2026',
        reference: 'QT-2026-0089',
        total_amount: 2250.0, // 850 + (35 * 40) = 2250
        status: 'draft',
      },
      ready: true,
      reply:
        'Quotation QT-2026-0089 for your 50th Birthday Party ($2,250.00 for the Premium Package and 40 guests catering) has been created and submitted to our event coordinators for review!',
    })

    const turn2Result = await processAiReceptionist({
      db,
      accountId: 'acct-grand-celebrations',
      conversationId: 'conv-david-1',
      contactId: 'contact-david-101',
      configOwnerUserId: 'admin-owner-id',
      inboundMessageId: 'wamid-turn-2',
      config,
      messages: [
        { role: 'user', content: "Hello! I'm David Miller..." },
        { role: 'assistant', content: 'Hello David! Would you like me to prepare a quotation?' },
        { role: 'user', content: customerMsg },
      ],
      knowledge: [],
    })

    // 1. Verify quotation bridge execution
    expect(mocks.prepareAiQuotation).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-grand-celebrations',
        conversationId: 'conv-david-1',
        contactId: 'contact-david-101',
        inboundMessageId: 'wamid-turn-2',
      })
    )

    // 2. Verify response incorporates official quotation reference
    expect(turn2Result?.quotationHandled).toBe(true)
    expect(turn2Result?.reply).toContain('QT-2026-0089')
    expect(turn2Result?.reply).toContain('$2,250.00')

    // 3. Verify transfer flag is set for staff review
    expect(turn2Result?.transfer).toBe(true)
    expect(turn2Result?.transferReason).toContain('QT-2026-0089 prepared and pending staff review')
  })
})
