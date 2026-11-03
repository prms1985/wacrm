-- Step 1 of business automation: an account-owned product/service catalogue.
-- Additive: existing messaging, automation, and billing tables are unchanged.
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  sku TEXT CHECK (sku IS NULL OR length(btrim(sku)) BETWEEN 1 AND 80),
  kind TEXT NOT NULL DEFAULT 'product' CHECK (kind IN ('product', 'service')),
  category TEXT CHECK (category IS NULL OR length(category) <= 100),
  description TEXT CHECK (description IS NULL OR length(description) <= 5000),
  specifications TEXT CHECK (specifications IS NULL OR length(specifications) <= 5000),
  image_url TEXT CHECK (image_url IS NULL OR (length(image_url) <= 2048 AND image_url ~ '^https://')),
  unit TEXT NOT NULL DEFAULT 'pcs' CHECK (length(btrim(unit)) BETWEEN 1 AND 40),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD','EUR','GBP','INR','AUD','CAD','BRL','JPY','CNY','AED','ZAR','NGN','SGD','MXN','COP')),
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','on_request','unavailable')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  search_text TEXT GENERATED ALWAYS AS (name || ' ' || coalesce(sku, '') || ' ' || coalesce(category, '')) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_account_list_idx ON public.products (account_id, is_active, name, id);
-- Archived codes remain reserved so restoring a product is always possible.
CREATE UNIQUE INDEX IF NOT EXISTS products_account_sku_idx ON public.products (account_id, lower(btrim(sku))) WHERE sku IS NOT NULL;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.products FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;

DROP POLICY IF EXISTS products_read ON public.products;
CREATE POLICY products_read ON public.products FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS products_create ON public.products;
CREATE POLICY products_create ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin') AND created_by = auth.uid());
DROP POLICY IF EXISTS products_edit ON public.products;
CREATE POLICY products_edit ON public.products FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON public.products;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
