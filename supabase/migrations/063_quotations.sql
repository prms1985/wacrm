-- Quotation amounts and transitions are controlled by RPCs, never by client totals.
CREATE TABLE public.quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reference text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sending','sent','send_unknown','accepted','rejected','cancelled')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai')),
  source_message_id text,
  ai_collecting boolean NOT NULL DEFAULT false,
  customer jsonb NOT NULL,
  seller jsonb NOT NULL,
  items jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 50),
  currency text NOT NULL DEFAULT 'INR',
  discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  valid_until date NOT NULL,
  requirements text NOT NULL DEFAULT '' CHECK (length(requirements) <= 5000),
  terms text NOT NULL DEFAULT '' CHECK (length(terms) <= 3000),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  sent_at timestamptz,
  send_attempt_id uuid,
  send_error text,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, reference)
);
CREATE INDEX quotations_account_list ON public.quotations(account_id, created_at DESC);
CREATE UNIQUE INDEX quotations_ai_collecting ON public.quotations(account_id, conversation_id)
  WHERE source = 'ai' AND ai_collecting AND status = 'draft';
CREATE UNIQUE INDEX quotations_ai_message ON public.quotations(account_id, source_message_id)
  WHERE source_message_id IS NOT NULL;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quotations FROM anon, authenticated;
GRANT SELECT ON public.quotations TO authenticated;
GRANT ALL ON public.quotations TO service_role;
CREATE POLICY quotations_read ON public.quotations FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.save_quotation(
  p_account_id uuid, p_id uuid, p_contact_id uuid, p_conversation_id uuid,
  p_items jsonb, p_details jsonb, p_expected_version integer DEFAULT NULL,
  p_source_message_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_quote quotations%ROWTYPE;
  v_product products%ROWTYPE;
  v_contact contacts%ROWTYPE;
  v_item jsonb;
  v_items jsonb := '[]';
  v_currency text;
  v_quantity numeric;
  v_discount numeric := coalesce((p_details->>'discount_percent')::numeric, 0);
  v_base numeric; v_off numeric; v_tax numeric;
  v_subtotal numeric := 0; v_discounts numeric := 0; v_taxes numeric := 0;
  v_service boolean := coalesce(auth.role() = 'service_role', false);
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_until date := (p_details->>'valid_until')::date;
  v_seller text;
BEGIN
  IF NOT v_service AND NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) > 50
     OR v_discount < 0 OR v_discount > 100 OR v_discount <> round(v_discount, 2)
     OR v_until IS NULL OR v_until < CURRENT_DATE
     OR length(coalesce(p_details->>'requirements','')) > 5000
     OR length(coalesce(p_details->>'terms','')) > 3000
     OR length(coalesce(p_details->>'seller_address','')) > 1000
     OR length(coalesce(p_details->>'seller_tax_id','')) > 100 THEN
    RAISE EXCEPTION 'Invalid quotation details' USING ERRCODE = '22023';
  END IF;
  IF v_service AND v_discount <> 0 THEN
    RAISE EXCEPTION 'AI cannot grant discounts' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_contact FROM contacts WHERE id = p_contact_id AND account_id = p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contact not found' USING ERRCODE = '22023'; END IF;
  IF p_conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM conversations WHERE id = p_conversation_id AND account_id = p_account_id AND contact_id = p_contact_id
  ) THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE = '22023'; END IF;
  -- Serialise concurrent inbound AI requests before resolving their pending draft.
  IF v_service THEN
    IF p_conversation_id IS NULL OR p_source_message_id IS NULL THEN
      RAISE EXCEPTION 'AI source is required' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text || p_conversation_id::text, 0));
    IF NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id = p_conversation_id
      AND sender_type = 'customer' AND message_id = p_source_message_id) THEN
      RAISE EXCEPTION 'Inbound message not found' USING ERRCODE = '22023';
    END IF;
    IF p_id IS NULL THEN
      SELECT * INTO v_quote FROM quotations WHERE account_id = p_account_id AND source_message_id = p_source_message_id;
      IF FOUND THEN RETURN to_jsonb(v_quote); END IF;
      IF EXISTS (SELECT 1 FROM quotations WHERE account_id = p_account_id AND conversation_id = p_conversation_id
        AND source = 'ai' AND ai_collecting AND status = 'draft') THEN
        RAISE EXCEPTION 'A request is already being collected' USING ERRCODE = '40001';
      END IF;
    END IF;
  END IF;
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_quote FROM quotations WHERE id = p_id AND account_id = p_account_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Quotation not found' USING ERRCODE = '22023'; END IF;
    IF v_quote.status <> 'draft' OR p_expected_version IS DISTINCT FROM v_quote.version
       OR (v_service AND (v_quote.source <> 'ai' OR NOT v_quote.ai_collecting)) THEN
      RAISE EXCEPTION 'Quotation changed; reload it' USING ERRCODE = '40001';
    END IF;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_quantity := (v_item->>'quantity')::numeric;
    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > 1000000 OR v_quantity <> round(v_quantity,3) THEN
      RAISE EXCEPTION 'Invalid quantity' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::uuid AND account_id = p_account_id AND is_active FOR SHARE;
    IF NOT FOUND OR v_product.availability = 'unavailable' THEN
      RAISE EXCEPTION 'Product is unavailable' USING ERRCODE = '22023';
    END IF;
    IF v_currency IS NULL THEN v_currency := v_product.currency; END IF;
    IF v_currency <> v_product.currency THEN RAISE EXCEPTION 'Mixed currencies are not allowed' USING ERRCODE = '22023'; END IF;
    v_base := round(v_product.unit_price * v_quantity, 2);
    v_off := round(v_base * v_discount / 100, 2);
    v_tax := round((v_base - v_off) * v_product.tax_rate / 100, 2);
    v_subtotal := v_subtotal + v_base; v_discounts := v_discounts + v_off; v_taxes := v_taxes + v_tax;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id',v_product.id,'name',v_product.name,'sku',v_product.sku,'unit',v_product.unit,
      'quantity',v_quantity,'unit_price',v_product.unit_price,'tax_rate',v_product.tax_rate,
      'subtotal',v_base,'discount',v_off,'tax',v_tax,'total',v_base-v_off+v_tax));
  END LOOP;
  IF greatest(v_subtotal,v_taxes,v_subtotal-v_discounts+v_taxes) > 999999999999.99 THEN
    RAISE EXCEPTION 'Quotation amount is too large' USING ERRCODE = '22023';
  END IF;
  SELECT name INTO v_seller FROM accounts WHERE id = p_account_id;
  INSERT INTO quotations(id,account_id,contact_id,conversation_id,created_by,reference,source,source_message_id,
    ai_collecting,customer,seller,items,currency,discount_percent,subtotal,discount_total,tax_total,total,valid_until,requirements,terms)
  VALUES (v_id,p_account_id,p_contact_id,p_conversation_id,CASE WHEN v_service THEN NULL ELSE auth.uid() END,
    'Q-' || upper(substr(replace(v_id::text,'-',''),1,12)),CASE WHEN v_service THEN 'ai' ELSE 'manual' END,p_source_message_id,
    v_service AND coalesce((p_details->>'ai_collecting')::boolean,false),
    jsonb_build_object('name',v_contact.name,'phone',v_contact.phone,'wa_user_id',v_contact.wa_user_id,'email',v_contact.email,'company',v_contact.company),
    jsonb_build_object('name',v_seller,'address',coalesce(p_details->>'seller_address',''),'tax_id',coalesce(p_details->>'seller_tax_id','')),
    v_items,coalesce(v_currency,'INR'),v_discount,v_subtotal,v_discounts,v_taxes,v_subtotal-v_discounts+v_taxes,v_until,
    coalesce(p_details->>'requirements',''),coalesce(p_details->>'terms',''))
  ON CONFLICT(id) DO UPDATE SET
    contact_id=EXCLUDED.contact_id,conversation_id=EXCLUDED.conversation_id,customer=EXCLUDED.customer,seller=EXCLUDED.seller,
    items=EXCLUDED.items,currency=EXCLUDED.currency,discount_percent=EXCLUDED.discount_percent,subtotal=EXCLUDED.subtotal,
    discount_total=EXCLUDED.discount_total,tax_total=EXCLUDED.tax_total,total=EXCLUDED.total,valid_until=EXCLUDED.valid_until,
    requirements=EXCLUDED.requirements,terms=EXCLUDED.terms,ai_collecting=EXCLUDED.ai_collecting,version=quotations.version+1
  RETURNING * INTO v_quote;
  RETURN to_jsonb(v_quote);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_quotation(p_account_id uuid,p_id uuid,p_action text,p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_quote quotations%ROWTYPE; v_status text;
BEGIN
  IF NOT is_account_member(p_account_id,'agent') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_quote FROM quotations WHERE id=p_id AND account_id=p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation not found' USING ERRCODE='22023'; END IF;
  IF v_quote.version <> p_version THEN RAISE EXCEPTION 'Quotation changed; reload it' USING ERRCODE='40001'; END IF;
  IF p_action='approve' AND v_quote.status='draft' THEN
    IF NOT is_account_member(p_account_id,'admin') THEN RAISE EXCEPTION 'Approval requires admin' USING ERRCODE='42501'; END IF;
    IF jsonb_array_length(v_quote.items)=0 OR v_quote.ai_collecting OR v_quote.valid_until<CURRENT_DATE THEN
      RAISE EXCEPTION 'Complete the quotation before approval' USING ERRCODE='22023'; END IF;
    v_status := 'approved';
  ELSIF p_action='reopen' AND v_quote.status='approved' AND is_account_member(p_account_id,'admin') THEN v_status:='draft';
  ELSIF p_action='cancel' AND v_quote.status IN ('draft','approved') THEN v_status:='cancelled';
  ELSIF p_action='accept' AND v_quote.status='sent' THEN v_status:='accepted';
  ELSIF p_action='reject' AND v_quote.status='sent' THEN v_status:='rejected';
  ELSE RAISE EXCEPTION 'Invalid quotation transition' USING ERRCODE='22023'; END IF;
  UPDATE quotations SET status=v_status,version=version+1,ai_collecting=false,
    approved_by=CASE WHEN v_status='approved' THEN auth.uid() WHEN v_status='draft' THEN NULL ELSE approved_by END,
    approved_at=CASE WHEN v_status='approved' THEN now() WHEN v_status='draft' THEN NULL ELSE approved_at END
  WHERE id=p_id RETURNING * INTO v_quote;
  RETURN to_jsonb(v_quote);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_quotation_send(p_account_id uuid,p_id uuid,p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_quote quotations%ROWTYPE;
BEGIN
  IF NOT is_account_member(p_account_id,'agent') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  UPDATE quotations SET status='sending',send_attempt_id=gen_random_uuid(),send_error=NULL,version=version+1
  WHERE id=p_id AND account_id=p_account_id AND status='approved' AND version=p_version
    AND approved_at IS NOT NULL AND valid_until>=CURRENT_DATE
  RETURNING * INTO v_quote;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation is not approved or has changed' USING ERRCODE='40001'; END IF;
  RETURN to_jsonb(v_quote);
END;
$$;

-- Service-only finalisation cannot turn a draft into an approved quotation.
CREATE OR REPLACE FUNCTION public.finish_quotation_send(p_account_id uuid,p_id uuid,p_attempt uuid,p_outcome text,p_message_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  IF p_outcome NOT IN ('sent','send_unknown','approved') THEN RAISE EXCEPTION 'Invalid outcome' USING ERRCODE='22023'; END IF;
  IF p_message_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id
    WHERE m.id=p_message_id AND c.account_id=p_account_id) THEN RAISE EXCEPTION 'Message not found' USING ERRCODE='22023'; END IF;
  UPDATE quotations SET status=p_outcome,message_id=p_message_id,
    sent_at=CASE WHEN p_outcome='sent' THEN now() ELSE sent_at END,
    send_error=CASE WHEN p_outcome='send_unknown' THEN 'Check the inbox and delivery history before any further send.' ELSE NULL END,
    version=version+1
  WHERE id=p_id AND account_id=p_account_id AND status='sending' AND send_attempt_id=p_attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'Send attempt changed' USING ERRCODE='40001'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_quotation(uuid,uuid,uuid,uuid,jsonb,jsonb,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_quotation(uuid,uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_quotation_send(uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_quotation_send(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_quotation(uuid,uuid,uuid,uuid,jsonb,jsonb,integer,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.transition_quotation(uuid,uuid,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_quotation_send(uuid,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_quotation_send(uuid,uuid,uuid,text,uuid) TO service_role;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned','quotation_ready'));
ALTER TABLE public.notifications ADD COLUMN quotation_id uuid REFERENCES public.quotations(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.notify_quotation_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.source <> 'ai' OR NEW.ai_collecting OR NEW.status <> 'draft' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF NOT OLD.ai_collecting THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO notifications(account_id,user_id,type,conversation_id,contact_id,quotation_id,title,body)
  SELECT NEW.account_id,p.user_id,'quotation_ready',NEW.conversation_id,NEW.contact_id,NEW.id,
    'Quotation ready for approval',NEW.reference || ' - ' || coalesce(NEW.customer->>'name',NEW.customer->>'phone','Customer')
  FROM profiles p WHERE p.account_id=NEW.account_id AND p.account_role IN ('owner','admin');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_quotation_review() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER quotation_ready_for_review AFTER INSERT OR UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.notify_quotation_review();
