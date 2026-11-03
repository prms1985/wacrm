import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig, ChatMessage, GenerateResult } from './types'
import { generateReply } from './generate'
import { logAiUsage } from './usage'
import { DEFAULT_RECEPTIONIST_CONFIG } from './config'
import { prepareAiQuotation } from '@/lib/quotations/ai'
import type { Product } from '@/lib/products/types'

export interface ExtractedContactDetails {
  name?: string | null
  email?: string | null
  company?: string | null
}

export interface ReceptionistExtraction {
  reply: string
  extracted_contact?: ExtractedContactDetails | null
  requirements?: string | null
  suggested_product_ids?: string[] | null
  prepare_quotation?: boolean
  transfer_to_staff?: boolean
  transfer_reason?: string | null
}

export interface ReceptionistResult {
  reply: string
  transfer: boolean
  transferReason?: string
  extractedContact?: ExtractedContactDetails
  requirements?: string
  suggestedProductIds?: string[]
  quotationHandled?: boolean
  usage?: GenerateResult['usage']
}

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/

export function parseReceptionistResponse(text: string): ReceptionistExtraction {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')

  try {
    const parsed = JSON.parse(cleaned)
    if (parsed && typeof parsed === 'object') {
      const reply =
        typeof parsed.reply === 'string' && parsed.reply.trim()
          ? parsed.reply.trim()
          : text.trim()

      const contact: ExtractedContactDetails = {}
      if (parsed.extracted_contact && typeof parsed.extracted_contact === 'object') {
        const rawName = parsed.extracted_contact.name
        const rawEmail = parsed.extracted_contact.email
        const rawCompany = parsed.extracted_contact.company

        if (typeof rawName === 'string' && rawName.trim().length >= 2 && rawName.trim().length <= 100) {
          contact.name = rawName.trim()
        }
        if (typeof rawEmail === 'string' && EMAIL_REGEX.test(rawEmail.trim())) {
          contact.email = rawEmail.trim().toLowerCase()
        }
        if (typeof rawCompany === 'string' && rawCompany.trim().length >= 2 && rawCompany.trim().length <= 100) {
          contact.company = rawCompany.trim()
        }
      }

      return {
        reply,
        extracted_contact: Object.keys(contact).length > 0 ? contact : null,
        requirements:
          typeof parsed.requirements === 'string' && parsed.requirements.trim()
            ? parsed.requirements.trim()
            : null,
        suggested_product_ids: Array.isArray(parsed.suggested_product_ids)
          ? parsed.suggested_product_ids.filter(
              (id: unknown): id is string => typeof id === 'string'
            )
          : null,
        prepare_quotation: Boolean(parsed.prepare_quotation),
        transfer_to_staff: Boolean(parsed.transfer_to_staff),
        transfer_reason:
          typeof parsed.transfer_reason === 'string' && parsed.transfer_reason.trim()
            ? parsed.transfer_reason.trim()
            : null,
      }
    }
  } catch {
    // If JSON parsing fails, treat the plain text as the message reply
  }

  const isHandoff = text.includes('[[HANDOFF]]')
  const reply = text.replace(/\[\[HANDOFF\]\]/g, '').trim()

  return {
    reply: reply || 'Hello! How can I assist you today?',
    transfer_to_staff: isHandoff,
    transfer_reason: isHandoff ? 'Model requested handoff' : null,
  }
}

export function buildReceptionistSystemPrompt(args: {
  config: AiConfig
  existingContact: { name?: string | null; email?: string | null; company?: string | null; phone: string }
  knowledge: string[]
  products: Product[]
}): string {
  const { config, existingContact, knowledge, products } = args
  const rConfig = config.receptionistConfig ?? DEFAULT_RECEPTIONIST_CONFIG
  const businessContext = config.systemPrompt ? config.systemPrompt.trim() : ''

  const parts: string[] = [
    `You are the professional AI Front-Desk Receptionist for this business on WhatsApp. Your name is ${rConfig.receptionistName}.`,
    'Your responsibilities:\n' +
      '1. Greet customers warmly and politely, introducing yourself or the company when starting a conversation.\n' +
      '2. Answer business questions accurately using the knowledge base provided below. Never invent policies, hours, or facts.\n' +
      '3. Actively listen to understand what the customer needs (products, services, project requirements).\n' +
      (rConfig.collectDetails
        ? '4. Collect customer details: Notice if the customer provides their name, email, or company. If they have not provided their name or contact info, politely ask for it when appropriate so the business can follow up.\n'
        : '') +
      (rConfig.suggestProducts
        ? '5. Suggest relevant products/services: When the customer asks about products or describes their requirements, match and recommend suitable items from the catalogue below with name, price, and benefits.\n'
        : '') +
      (rConfig.prepareQuotations
        ? '6. Prepare sales quotations: If the customer asks for a quote/pricing/estimate or is interested in specific products/services, offer or initiate a formal quotation.\n'
        : '') +
      (rConfig.transferToStaff
        ? '7. Transfer to human staff: If the customer explicitly asks to talk to human staff ("talk to human", "agent", "manager", "support"), or when customer requirements/details have been fully collected and need human follow-up, or if you cannot answer safely, trigger a transfer to staff.\n'
        : '') +
      'Keep your tone polite, welcoming, professional, and concise for WhatsApp messaging. Output in the same language the customer uses.',
  ]

  if (rConfig.greetingPrompt && rConfig.greetingPrompt.trim()) {
    parts.push(`Greeting & Receptionist Instructions:\n${rConfig.greetingPrompt.trim()}`)
  }

  if (businessContext) {
    parts.push(`Business Context:\n${businessContext}`)
  }

  parts.push(
    `Current Contact Profile:\n` +
      `- Phone: ${existingContact.phone}\n` +
      `- Name: ${existingContact.name || 'Not provided yet'}\n` +
      `- Email: ${existingContact.email || 'Not provided yet'}\n` +
      `- Company: ${existingContact.company || 'Not provided yet'}`
  )

  if (knowledge && knowledge.length > 0) {
    parts.push(
      'Knowledge Base (FAQs, operating hours, policies, services):\n' +
        knowledge.map((k, i) => `[${i + 1}] ${k}`).join('\n\n---\n\n')
    )
  }

  if (rConfig.suggestProducts && products.length > 0) {
    const productSummaries = products.slice(0, 30).map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      kind: p.kind,
      price: `${p.currency} ${p.unit_price} / ${p.unit}`,
      description: p.description?.slice(0, 200) || '',
    }))
    parts.push(
      `Product & Service Catalogue:\n${JSON.stringify(productSummaries, null, 2)}`
    )
  }

  parts.push(
    'IMPORTANT OUTPUT FORMAT:\n' +
      'You MUST reply with a single valid JSON object strictly matching this schema:\n' +
      '{\n' +
      '  "reply": "Your WhatsApp response message to the customer",\n' +
      '  "extracted_contact": {\n' +
      '    "name": "Customer full name if given in conversation, else null",\n' +
      '    "email": "Customer email if given in conversation, else null",\n' +
      '    "company": "Customer company name if given in conversation, else null"\n' +
      '  },\n' +
      '  "requirements": "Summary of customer stated requirements or needs, else null",\n' +
      '  "suggested_product_ids": ["array of matching product UUIDs from catalogue, or empty"],\n' +
      '  "prepare_quotation": true or false (true if customer requested or agreed to a quote),\n' +
      '  "transfer_to_staff": true or false (true if customer requested human or requirements ready for staff),\n' +
      '  "transfer_reason": "Reason for transferring to staff, or null"\n' +
      '}\n' +
      'Do not include any text outside the JSON object.'
  )

  return parts.join('\n\n')
}

export async function processAiReceptionist(args: {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  inboundMessageId?: string
  config: AiConfig
  messages: ChatMessage[]
  knowledge: string[]
}): Promise<ReceptionistResult | null> {
  const {
    db,
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundMessageId,
    config,
    messages,
    knowledge,
  } = args

  const rConfig = config.receptionistConfig ?? DEFAULT_RECEPTIONIST_CONFIG
  if (!rConfig.enabled) {
    return null
  }

  // 1. Fetch contact record
  const { data: contact } = await db
    .from('contacts')
    .select('id, phone, name, email, company')
    .eq('id', contactId)
    .maybeSingle()

  const existingContact = {
    phone: contact?.phone ?? '',
    name: contact?.name ?? null,
    email: contact?.email ?? null,
    company: contact?.company ?? null,
  }

  // 2. Fetch products catalogue if enabled
  let products: Product[] = []
  if (rConfig.suggestProducts) {
    const { data: prodData } = await db
      .from('products')
      .select('id, name, sku, kind, category, unit, unit_price, currency, description, specifications, availability')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .neq('availability', 'unavailable')
      .order('name')
      .limit(60)
    products = (prodData as Product[]) || []
  }

  // 3. Generate receptionist response
  const systemPrompt = buildReceptionistSystemPrompt({
    config,
    existingContact,
    knowledge,
    products,
  })

  const generation = await generateReply({
    config,
    systemPrompt,
    messages,
  })

  void logAiUsage(db, {
    accountId,
    conversationId,
    mode: 'auto_reply',
    provider: config.provider,
    model: config.model,
    usage: generation.usage,
  })

  const parsed = parseReceptionistResponse(generation.text)

  // 4. Update contact details in DB if newly extracted
  if (rConfig.collectDetails && parsed.extracted_contact) {
    const updates: Record<string, string> = {}
    if (parsed.extracted_contact.name && (!contact?.name || contact.name === contact.phone)) {
      updates.name = parsed.extracted_contact.name
    }
    if (parsed.extracted_contact.email && !contact?.email) {
      updates.email = parsed.extracted_contact.email
    }
    if (parsed.extracted_contact.company && !contact?.company) {
      updates.company = parsed.extracted_contact.company
    }

    if (Object.keys(updates).length > 0) {
      await db
        .from('contacts')
        .update(updates)
        .eq('id', contactId)
        .eq('account_id', accountId)
    }
  }

  // 5. If customer requirements are captured, record in contact_notes
  if (parsed.requirements) {
    await db.from('contact_notes').insert({
      contact_id: contactId,
      user_id: configOwnerUserId,
      note_text: `📋 AI Receptionist - Customer Requirements:\n${parsed.requirements}`,
    })
  }

  // 6. If prepare_quotation is triggered or requested, bridge to prepareAiQuotation
  if (rConfig.prepareQuotations && parsed.prepare_quotation && inboundMessageId) {
    const quotationOutcome = await prepareAiQuotation({
      db,
      accountId,
      conversationId,
      contactId,
      inboundMessageId,
      config,
      messages,
    })
    if (quotationOutcome) {
      return {
        reply: quotationOutcome.reply,
        transfer: quotationOutcome.ready,
        transferReason: quotationOutcome.ready
          ? `Quotation ${quotationOutcome.quote.reference} prepared and pending staff review`
          : undefined,
        requirements: parsed.requirements ?? undefined,
        suggestedProductIds: parsed.suggested_product_ids ?? undefined,
        quotationHandled: true,
        usage: generation.usage,
      }
    }
  }

  // 7. Handle transfer to staff
  if (rConfig.transferToStaff && parsed.transfer_to_staff) {
    const reason = parsed.transfer_reason || 'Customer requested human assistance'
    const handoffSummary = `🤖 AI Receptionist handed off: ${reason}.${parsed.requirements ? ` Requirements: "${parsed.requirements}"` : ''}`

    const update: Record<string, unknown> = {
      ai_autoreply_disabled: true,
      ai_handoff_summary: handoffSummary,
    }
    if (config.handoffAgentId) {
      update.assigned_agent_id = config.handoffAgentId
    }

    await db
      .from('conversations')
      .update(update)
      .eq('id', conversationId)
      .is('assigned_agent_id', null)

    // Log handoff note in contact_notes for the team
    await db.from('contact_notes').insert({
      contact_id: contactId,
      user_id: configOwnerUserId,
      note_text: `🔔 AI Receptionist - Staff Handoff:\nReason: ${reason}\nRequirements: ${parsed.requirements || 'N/A'}`,
    })

    return {
      reply: parsed.reply,
      transfer: true,
      transferReason: reason,
      extractedContact: parsed.extracted_contact ?? undefined,
      requirements: parsed.requirements ?? undefined,
      suggestedProductIds: parsed.suggested_product_ids ?? undefined,
      quotationHandled: false,
      usage: generation.usage,
    }
  }

  return {
    reply: parsed.reply,
    transfer: false,
    extractedContact: parsed.extracted_contact ?? undefined,
    requirements: parsed.requirements ?? undefined,
    suggestedProductIds: parsed.suggested_product_ids ?? undefined,
    quotationHandled: false,
    usage: generation.usage,
  }
}
