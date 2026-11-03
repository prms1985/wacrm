-- Permanent account/invoice reservation prevents parallel print events and
-- uncertain provider outcomes from generating another customer message.
CREATE TABLE public.billing_invoice_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL CHECK (length(invoice_id) BETWEEN 1 AND 120),
  fingerprint TEXT NOT NULL,
  recipient TEXT NOT NULL,
  filename TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'processing' CHECK (state IN ('processing','sending','accepted','failed','unknown')),
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  whatsapp_message_id TEXT,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  media_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, invoice_id)
);
CREATE INDEX billing_invoice_deliveries_account_created ON public.billing_invoice_deliveries(account_id, created_at DESC);
ALTER TABLE public.billing_invoice_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_invoice_deliveries FROM anon, authenticated;
GRANT ALL ON public.billing_invoice_deliveries TO service_role;
