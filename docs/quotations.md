# Quotations and AI intake

Open **Quotations** in the sidebar, or use **New quotation** from the inbox's
customer panel. Select a contact, catalogue products/services, quantities, a
discount, expiry date, requirements and terms. Save the draft, review its
calculated totals, then request owner/admin approval. Approved PDFs can be sent
through WhatsApp from the quotation screen. The customer must have an existing
WhatsApp conversation. Acceptance/rejection records are entered by staff; there
is no public customer acceptance page in this release.

## Activation

Apply migrations `063_quotations.sql` and
`064_quotation_account_data_guard.sql`, in order, using the normal Supabase
migration process. Migration 063 adds quotations, access policies, calculation
and transition RPCs, and notifications for completed AI drafts. It extends
notifications with `quotation_ready` and a quotation reference. Migration 064
preserves quotation history when a user joins another business account.

The server requires a valid **service-role** Supabase key in
`SUPABASE_SERVICE_ROLE_KEY`, plus the existing Meta connection and encryption
key. An anon/publishable key in the service-role setting will not work.
Keep the service-role key server-only. Restart a production Node process after
changing its environment. Self-contained deployments must include public assets;
quotation font files are also explicitly included in Next.js file tracing.

## Prices, access and approval

- Account members can read their account's quotations and private PDFs.
- Agents, admins and owners can create/edit drafts and send approved quotations.
- Only admins/owners can approve or reopen an approved quotation.
- Database RPCs calculate line prices, discounts and taxes from account-scoped,
  active catalogue items. Browser/model totals and model prices are never used.
- Quantities support three decimal places; amounts and percentages support two.
  Each line's subtotal, discount and tax are rounded half-up to two decimals.
  Tax applies after discount. Each quotation has one currency.
- Saving a draft refreshes catalogue prices. Saved draft previews use the
  returned database snapshot. Approved/sent quotations preserve item names,
  prices, taxes, customer and business details as snapshots.
- Approved quotations can be reopened before sending; this removes approval.
  Sent documents are immutable. Prepare a new quotation for a revised offer.
- Expiry dates are calendar dates evaluated in UTC by the server/database.
- Permanent deletion and direct client table writes are unavailable.
- Sending verifies the recipient still matches the approved snapshot. If a
  contact's send identity changes, reopen, save and approve the quotation again.

## WhatsApp delivery

Within 24 hours of the latest customer message, send the generated PDF directly.
Outside that window select a synced, approved document-header template and fill
its body values. The current send form supports positional template values.
Template eligibility/approval remains managed by Meta and the existing Settings
template manager. See the [WhatsApp messaging policy](https://whatsappbusiness.com/policy/).

The PDF uploads privately to Meta; no public quotation/PDF URL is created.
Staff can regenerate a PDF from the quotation's private authenticated endpoint.
Embedded Noto fonts preserve Latin, Tamil and Korean/CJK text; PDFs paginate
long documents. Labels in the PDF are English. Font licenses are bundled under
`public/fonts/`.

Sending first atomically reserves an approved quotation. A pre-send upload
failure restores approval for manual retry. Once the provider-send call starts,
any uncertain result becomes `send_unknown`; it is never automatically retried.
An interrupted process can leave `sending`. Review the inbox and Meta delivery
history before an operator resolves either state. `sent` records provider
acceptance, not customer delivery; delivery/read status remains in the inbox.

## AI receptionist integration

The existing inbound AI auto-reply must be configured and enabled. A quotation
request starts structured collection using the recent conversation and up to
100 active catalogue entries. Product IDs and quantities are validated; the
database supplies prices. Requirements are retained in an AI draft while the
AI asks for missing details. This first version recognises quotation/estimate
terms in English, Spanish, Portuguese, Korean and Tamil. Requests expressed
without these terms may follow the ordinary knowledge-base reply path.

Once the model has enough information, the draft remains **unapproved**. Owners
and admins receive a review notification linking to it. The customer gets an
acknowledgement; the AI pauses and hands the conversation to the configured
agent/shared queue. Staff can complete an unfinished AI draft by editing and
saving it. No model tool can approve a quotation or send its PDF.

Existing AI reply caps and human handoff rules apply. Existing message/keyword
automations still take precedence and can suppress AI auto-replies. A first
message welcome automation does not suppress AI intake. No existing automation
or account AI configuration is enabled automatically by this change.

## Internal API

All endpoints require the normal dashboard session:

- `GET /api/quotations?status=all&q=&page=1`: account-scoped list, 25 per page.
- `POST /api/quotations`: create a draft.
- `GET /api/quotations/:id`: read a quotation.
- `PUT /api/quotations/:id`: edit a draft with its current `version`.
- `PATCH /api/quotations/:id`: action and current version (`approve`, `reopen`,
  `cancel`, `accept`, `reject`).
- `GET /api/quotations/:id/pdf`: private, non-cached PDF.
- `POST /api/quotations/:id/send`: current version and optional template ID/body
  values; only approved quotations can be reserved and sent.
- `GET /api/quotations/options`: bounded, account-scoped customer, product and
  template selections with search.

Postgres permission/calculation/transition tests use an isolated in-memory
PGlite database. Network send tests mock Meta; they do not contact customers.
