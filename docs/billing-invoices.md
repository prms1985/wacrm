# Billing PDF invoices → official WhatsApp API

This integration accepts an existing PDF invoice. It does not generate a bill,
intercept Windows printing or read a pharmacy database. To make Print trigger
delivery, the billing vendor must export a PDF plus the customer's phone and
invoice reference, or call the API from its print/invoice event.

## Server setup

1. Apply `supabase/migrations/060_billing_invoice_deliveries.sql` to your
   Supabase database using your normal migration process. This table is
   service-role-only; never expose the service-role secret to a billing PC.
2. Configure a valid server `SUPABASE_SERVICE_ROLE_KEY` and official WhatsApp
   connection. An anon key is insufficient. No new environment secrets needed.
3. Create and sync an approved **Utility** template with a **Document** header.
   Example body: `Hello {{1}}, your invoice {{2}} is attached. Thank you.`
   Use an appropriate non-sensitive sample PDF for Meta review. Avoid dynamic
   buttons. Each real send supplies its own PDF, not the review sample.
4. Open **Settings → API keys → Billing invoices** for manual upload/test and
   the latest 30 invoice submissions. Admin/owner access is required.
5. For an external connector create an account API key with `messages:send`.
   Add `messages:read` only if the integration needs status lookup.

Meta must permit the business and document content. Pharmacy eligibility and
documents containing medicine or health information require particular care;
this integration does not establish that Meta permits every pharmacy invoice.
Use verified recipient numbers and recorded customer permission. The connector
must not infer permission from the existence of a phone number.

## Public API

`POST /api/v1/invoices`, Authorization: `Bearer <account API key>`.
Multipart fields:

| Field | Value |
|---|---|
| invoice_id | Permanent unique reference; include store/year if numbers reset |
| to | Explicit +country-code number; 10-digit Indian numbers also accepted |
| name | Optional customer name |
| consent | Literal string `true`, backed by your permission record |
| template_name / template_language | Exact synced approved document Utility template |
| body_params | JSON array, in template variable order |
| file | PDF bytes, `application/pdf`, maximum 5 MB |

Response: `{ "data": { "invoice_id": "...", "state": "accepted",
"message_id": "...", "whatsapp_message_id": "...", "duplicate": false } }`.
Accepted means Meta accepted the message, not that the customer received it.
Existing WhatsApp status webhooks populate delivery/read/failed status.

`GET /api/v1/invoices?invoice_id=STORE1-2026-INV-001` returns account-scoped
submission and delivery status (requires `messages:read`). Omit invoice_id
for the latest 30. API errors use `{ "error": { "code", "message" } }`.

The same account/invoice reference and PDF/recipient/template details replay an
accepted result without another send. Changed data returns `invoice_conflict`.
Concurrent, failed or uncertain submissions return `invoice_reserved`.
No automatic resend or expiry of invoice reservations. A timeout or database
failure after sending may mean the customer already received the bill: inspect
the inbox and provider history. Correcting/reissuing an invoice requires staff
review and an explicit new business reference; do not automatically append a
random ID to bypass duplicate protection. Failed delivery does not auto-resend.
Delivery history rows marked processing/sending after a server interruption
must also be reviewed; they are deliberately not reclaimed automatically.

PDFs upload directly to Meta using media IDs; no public PDF links or invoice
storage bucket are created. Meta's media retention applies. WACRM stores
metadata, a payload fingerprint and message references, not PDF bytes.

## Local PDF export connector (Node.js 22+)

The billing software must write a PDF and a matching `*.invoice.json` file to
an export directory. Write JSON last using a temporary file + atomic rename.
The customer phone must come from the bill, not be guessed from PDF contents.

Example `INV-001.invoice.json`:

```json
{
  "invoice_id": "STORE1-2026-INV-001",
  "file": "INV-001.pdf",
  "to": "+919876543210",
  "name": "Customer",
  "consent": true,
  "template_name": "invoice_ready",
  "template_language": "en",
  "body_params": ["Customer", "STORE1-2026-INV-001"]
}
```

PowerShell (enter your actual URL/folder and securely provision the API key):

```powershell
$env:WACRM_URL = 'https://your-wacrm.example'
$env:WACRM_EXPORT_FOLDER = 'C:\BillingExports'
# Provision WACRM_API_KEY through your local secret/environment configuration.
node scripts/billing-connector.mjs --once
# Remove --once to keep checking every five seconds.
```

The connector waits for a stable export, sends sequentially, and keeps local
submission receipts in `.wacrm-state`. It never deletes original bills and never
automatically retries uncertain sends. Keep the folder and API key accessible
only to authorized billing staff. Run only one connector per folder. A process
crash leaves `connector.lock`; confirm no connector is running and review
receipts/WACRM history before removing that lock and restarting. Configure
startup with your organization's service/task runner after vendor testing.

This is an export connector, not an installed printer driver. The exact
software-specific Print hook remains to be connected once its name/version and
export options are known. Normal paper printing is not modified.

References: [Meta media upload](https://whatsappbusiness.com/blog/media-messages-via-app/),
[WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy).
