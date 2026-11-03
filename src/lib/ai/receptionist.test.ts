import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Product } from '@/lib/products/types'
import type { AiConfig } from './types'
import {
  parseReceptionistResponse,
  buildReceptionistSystemPrompt,
  processAiReceptionist,
} from './receptionist'

const mocks = vi.hoisted(() => ({
  generateReply: vi.fn(),
  prepareAiQuotation: vi.fn(),
  logAiUsage: vi.fn(),
  state: {
    contact: { id: 'contact-1', phone: '+1234567890', name: null, email: null, company: null },
    contactUpdates: [] as Record<string, unknown>[],
    contactNotes: [] as Record<string, unknown>[],
    conversationUpdates: [] as Record<string, unknown>[],
    products: [
      {
        id: 'prod-1',
        name: 'Enterprise CRM Package',
        sku: 'CRM-ENT',
        category: 'Software',
        kind: 'service',
        unit: 'license',
        unit_price: 99.0,
        currency: 'USD',
        description: 'Complete CRM software with automated workflows.',
      },
    ],
  },
}))

vi.mock('./generate', () => ({ generateReply: mocks.generateReply }))
vi.mock('@/lib/quotations/ai', () => ({ prepareAiQuotation: mocks.prepareAiQuotation }))
vi.mock('./usage', () => ({ logAiUsage: mocks.logAiUsage }))

describe('AI Receptionist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.contact = {
      id: 'contact-1',
      phone: '+1234567890',
      name: null,
      email: null,
      company: null,
    }
    mocks.state.contactUpdates = []
    mocks.state.contactNotes = []
    mocks.state.conversationUpdates = []
  })

  const baseConfig: AiConfig = {
    provider: 'openai',
    model: 'gpt-5.4-mini',
    baseUrl: null,
    apiKey: 'test-key',
    systemPrompt: 'We are Acme Solutions.',
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 5,
    handoffAgentId: 'agent-123',
    embeddingsApiKey: null,
    receptionistConfig: {
      enabled: true,
      receptionistName: 'Sara',
      greetingPrompt: 'Welcome to Acme Solutions!',
      collectDetails: true,
      suggestProducts: true,
      prepareQuotations: true,
      transferToStaff: true,
    },
  }

  function createMockDb() {
    return {
      from: (table: string) => {
        if (table === 'contacts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: mocks.state.contact, error: null }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              mocks.state.contactUpdates.push(payload)
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
                      limit: () => Promise.resolve({ data: mocks.state.products, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'contact_notes') {
          return {
            insert: (payload: Record<string, unknown>) => {
              mocks.state.contactNotes.push(payload)
              return Promise.resolve({ error: null })
            },
          }
        }
        if (table === 'conversations') {
          return {
            update: (payload: Record<string, unknown>) => {
              mocks.state.conversationUpdates.push(payload)
              return {
                eq: () => ({
                  is: () => Promise.resolve({ error: null }),
                }),
              }
            },
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    } as unknown as SupabaseClient
  }

  describe('parseReceptionistResponse', () => {
    it('parses structured JSON with contact details, requirements, and products', () => {
      const json = JSON.stringify({
        reply: 'Hello Jane, glad to help you with your inquiry!',
        extracted_contact: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          company: 'Acme Corp',
        },
        requirements: 'Needs 10 CRM licenses for sales team.',
        suggested_product_ids: ['prod-1'],
        prepare_quotation: true,
        transfer_to_staff: false,
      })

      const result = parseReceptionistResponse(json)
      expect(result.reply).toBe('Hello Jane, glad to help you with your inquiry!')
      expect(result.extracted_contact).toEqual({
        name: 'Jane Doe',
        email: 'jane@example.com',
        company: 'Acme Corp',
      })
      expect(result.requirements).toBe('Needs 10 CRM licenses for sales team.')
      expect(result.suggested_product_ids).toEqual(['prod-1'])
      expect(result.prepare_quotation).toBe(true)
      expect(result.transfer_to_staff).toBe(false)
    })

    it('sanitizes invalid email and keeps valid fields', () => {
      const json = JSON.stringify({
        reply: 'Nice to meet you!',
        extracted_contact: {
          name: 'Bob',
          email: 'not-an-email',
          company: '',
        },
      })

      const result = parseReceptionistResponse(json)
      expect(result.extracted_contact).toEqual({
        name: 'Bob',
      })
    })

    it('falls back gracefully to plain text and detects [[HANDOFF]]', () => {
      const raw = 'Let me connect you with a representative. [[HANDOFF]]'
      const result = parseReceptionistResponse(raw)
      expect(result.reply).toBe('Let me connect you with a representative.')
      expect(result.transfer_to_staff).toBe(true)
      expect(result.transfer_reason).toBe('Model requested handoff')
    })
  })

  describe('buildReceptionistSystemPrompt', () => {
    it('includes receptionist persona, contact context, knowledge and products', () => {
      const prompt = buildReceptionistSystemPrompt({
        config: baseConfig,
        existingContact: {
          phone: '+1234567890',
          name: 'Alice',
          email: null,
          company: null,
        },
        knowledge: ['Office hours are 9am to 6pm Monday to Friday.'],
        products: mocks.state.products as unknown as Product[],
      })

      expect(prompt).toContain('Sara')
      expect(prompt).toContain('Welcome to Acme Solutions!')
      expect(prompt).toContain('We are Acme Solutions.')
      expect(prompt).toContain('Office hours are 9am to 6pm')
      expect(prompt).toContain('Enterprise CRM Package')
      expect(prompt).toContain('Alice')
    })
  })

  describe('processAiReceptionist', () => {
    it('returns null when receptionist is disabled', async () => {
      const db = createMockDb()
      const disabledConfig: AiConfig = {
        ...baseConfig,
        receptionistConfig: {
          ...baseConfig.receptionistConfig!,
          enabled: false,
        },
      }

      const result = await processAiReceptionist({
        db,
        accountId: 'acct-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        configOwnerUserId: 'user-admin',
        inboundMessageId: 'wamid-1',
        config: disabledConfig,
        messages: [{ role: 'user', content: 'Hello!' }],
        knowledge: [],
      })

      expect(result).toBeNull()
      expect(mocks.generateReply).not.toHaveBeenCalled()
    })

    it('greets customer and auto-updates contact details and requirements', async () => {
      const db = createMockDb()
      mocks.generateReply.mockResolvedValueOnce({
        text: JSON.stringify({
          reply: 'Welcome to Acme! Great to meet you, John from Initech.',
          extracted_contact: {
            name: 'John Smith',
            email: 'john@initech.com',
            company: 'Initech',
          },
          requirements: 'Looking for 5 software licenses with training.',
          suggested_product_ids: ['prod-1'],
          prepare_quotation: false,
          transfer_to_staff: false,
        }),
        handoff: false,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      })

      const result = await processAiReceptionist({
        db,
        accountId: 'acct-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        configOwnerUserId: 'user-admin',
        inboundMessageId: 'wamid-1',
        config: baseConfig,
        messages: [{ role: 'user', content: "Hi, I'm John Smith from Initech (john@initech.com)" }],
        knowledge: [],
      })

      expect(result).not.toBeNull()
      expect(result?.reply).toContain('Welcome to Acme!')
      expect(result?.transfer).toBe(false)

      // Verified contact was updated in database
      expect(mocks.state.contactUpdates.length).toBe(1)
      expect(mocks.state.contactUpdates[0]).toEqual({
        name: 'John Smith',
        email: 'john@initech.com',
        company: 'Initech',
      })

      // Verified requirement note was added
      expect(mocks.state.contactNotes.length).toBe(1)
      expect(mocks.state.contactNotes[0].note_text).toContain('5 software licenses')
    })

    it('transfers conversation to staff when requested by customer', async () => {
      const db = createMockDb()
      mocks.generateReply.mockResolvedValueOnce({
        text: JSON.stringify({
          reply: 'I will transfer you to our sales manager right away!',
          extracted_contact: null,
          requirements: 'Custom quote request for large team',
          suggested_product_ids: [],
          prepare_quotation: false,
          transfer_to_staff: true,
          transfer_reason: 'Customer requested human agent',
        }),
        handoff: false,
        usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
      })

      const result = await processAiReceptionist({
        db,
        accountId: 'acct-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        configOwnerUserId: 'user-admin',
        inboundMessageId: 'wamid-2',
        config: baseConfig,
        messages: [{ role: 'user', content: 'Can I speak to someone from your team?' }],
        knowledge: [],
      })

      expect(result?.transfer).toBe(true)
      expect(result?.transferReason).toBe('Customer requested human agent')

      // Verified conversation assignment and auto-reply disabled
      expect(mocks.state.conversationUpdates.length).toBe(1)
      expect(mocks.state.conversationUpdates[0].ai_autoreply_disabled).toBe(true)
      expect(mocks.state.conversationUpdates[0].assigned_agent_id).toBe('agent-123')
      expect(mocks.state.conversationUpdates[0].ai_handoff_summary).toContain('Customer requested human agent')

      // Verified handoff note in contact_notes
      const handoffNote = mocks.state.contactNotes.find((n) =>
        (n.note_text as string).includes('Staff Handoff')
      )
      expect(handoffNote).toBeDefined()
    })

    it('bridges seamlessly to prepareAiQuotation when quotation is requested', async () => {
      const db = createMockDb()
      mocks.generateReply.mockResolvedValueOnce({
        text: JSON.stringify({
          reply: 'I am preparing your quotation now.',
          extracted_contact: null,
          requirements: '2 CRM packages',
          suggested_product_ids: ['prod-1'],
          prepare_quotation: true,
          transfer_to_staff: false,
        }),
        handoff: false,
        usage: null,
      })

      mocks.prepareAiQuotation.mockResolvedValueOnce({
        quote: { id: 'quote-123', reference: 'QT-2026-001' },
        ready: true,
        reply: 'Quotation QT-2026-001 has been prepared and submitted for review!',
      })

      const result = await processAiReceptionist({
        db,
        accountId: 'acct-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        configOwnerUserId: 'user-admin',
        inboundMessageId: 'wamid-3',
        config: baseConfig,
        messages: [{ role: 'user', content: 'Please give me a quote for 2 CRM packages.' }],
        knowledge: [],
      })

      expect(mocks.prepareAiQuotation).toHaveBeenCalled()
      expect(result?.quotationHandled).toBe(true)
      expect(result?.reply).toContain('QT-2026-001')
      expect(result?.transfer).toBe(true)
    })
  })
})
