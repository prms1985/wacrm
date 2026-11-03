-- Apply after 065. Coexistence imports are transactional and never dispatch
-- live-message responders. Only the service role may enqueue/apply imports.
ALTER TABLE public.whatsapp_config ADD COLUMN IF NOT EXISTS connection_mode text NOT NULL DEFAULT 'cloud_api'
  CHECK (connection_mode IN ('cloud_api', 'coexistence'));
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS whatsapp_source text
  CHECK (whatsapp_source IN ('business_app', 'history'));
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS whatsapp_media_placeholder boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.whatsapp_coexistence (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  config_id uuid NOT NULL UNIQUE REFERENCES public.whatsapp_config(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL UNIQUE,
  display_phone text NOT NULL,
  waba_id text NOT NULL,
  session_id uuid NOT NULL DEFAULT gen_random_uuid(),
  connected_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  history_status text NOT NULL DEFAULT 'pending' CHECK (history_status IN ('pending','requesting','requested','syncing','complete','declined','failed','unknown')),
  contacts_status text NOT NULL DEFAULT 'pending' CHECK (contacts_status IN ('pending','requesting','requested','syncing','complete','failed','unknown')),
  history_request_id text,
  contacts_request_id text,
  history_progress integer NOT NULL DEFAULT 0 CHECK (history_progress BETWEEN 0 AND 100),
  history_error text,
  contacts_error text,
  last_event_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.whatsapp_coexistence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.whatsapp_coexistence(account_id) ON DELETE CASCADE,
  connection_session uuid NOT NULL,
  event_key text NOT NULL,
  field text NOT NULL,
  priority smallint NOT NULL DEFAULT 10,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  processed_items integer NOT NULL DEFAULT 0,
  last_error text,
  UNIQUE(account_id, event_key)
);
CREATE INDEX IF NOT EXISTS idx_coexistence_pending_events ON public.whatsapp_coexistence_events(created_at) WHERE processed_at IS NULL;
CREATE TABLE IF NOT EXISTS public.whatsapp_app_contacts (
  account_id uuid NOT NULL REFERENCES public.whatsapp_coexistence(account_id) ON DELETE CASCADE,
  phone text NOT NULL,
  name text NOT NULL DEFAULT '',
  removed boolean NOT NULL DEFAULT false,
  changed_at timestamptz NOT NULL,
  PRIMARY KEY(account_id, phone)
);
ALTER TABLE public.whatsapp_coexistence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_coexistence_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_app_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_coexistence, public.whatsapp_coexistence_events, public.whatsapp_app_contacts FROM anon, authenticated;
GRANT ALL ON public.whatsapp_coexistence, public.whatsapp_coexistence_events, public.whatsapp_app_contacts TO service_role;

CREATE OR REPLACE FUNCTION public.connect_whatsapp_coexistence(
  p_account_id uuid, p_user_id uuid, p_phone_id text, p_display_phone text,
  p_waba_id text, p_access_token text, p_verify_token text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_config public.whatsapp_config;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = p_user_id AND account_id = p_account_id AND account_role IN ('owner','admin')) THEN
    RAISE EXCEPTION 'Account administrator required' USING ERRCODE = '42501';
  END IF;
  -- Serialize connect/replace operations for the account.
  PERFORM 1 FROM accounts WHERE id = p_account_id FOR UPDATE;
  SELECT * INTO v_config FROM whatsapp_config WHERE account_id = p_account_id FOR UPDATE;
  IF FOUND AND v_config.phone_number_id <> p_phone_id THEN
    RAISE EXCEPTION 'Disconnect the existing WhatsApp number before connecting another' USING ERRCODE = '23505';
  END IF;
  INSERT INTO whatsapp_config(account_id, user_id, phone_number_id, waba_id, access_token, verify_token, status, connection_mode, connected_at, registered_at, subscribed_apps_at, last_registration_error)
  VALUES(p_account_id, p_user_id, p_phone_id, p_waba_id, p_access_token, p_verify_token, 'connected', 'coexistence', now(), now(), now(), null)
  ON CONFLICT(account_id) DO UPDATE SET access_token = EXCLUDED.access_token, waba_id = EXCLUDED.waba_id, user_id = EXCLUDED.user_id,
    verify_token = COALESCE(whatsapp_config.verify_token, EXCLUDED.verify_token), status = 'connected', connection_mode = 'coexistence',
    registered_at = now(), subscribed_apps_at = now(), last_registration_error = null, updated_at = now()
  RETURNING * INTO v_config;
  INSERT INTO whatsapp_coexistence(account_id, config_id, phone_number_id, display_phone, waba_id)
  VALUES(p_account_id, v_config.id, p_phone_id, p_display_phone, p_waba_id)
  ON CONFLICT(account_id) DO UPDATE SET display_phone = EXCLUDED.display_phone, waba_id = EXCLUDED.waba_id,
    session_id = CASE WHEN whatsapp_coexistence.disconnected_at IS NOT NULL THEN gen_random_uuid() ELSE whatsapp_coexistence.session_id END,
    connected_at = CASE WHEN whatsapp_coexistence.disconnected_at IS NOT NULL THEN now() ELSE whatsapp_coexistence.connected_at END,
    history_status = CASE WHEN whatsapp_coexistence.disconnected_at IS NOT NULL THEN 'pending' ELSE whatsapp_coexistence.history_status END,
    contacts_status = CASE WHEN whatsapp_coexistence.disconnected_at IS NOT NULL THEN 'pending' ELSE whatsapp_coexistence.contacts_status END,
    history_request_id = CASE WHEN whatsapp_coexistence.disconnected_at IS NOT NULL THEN null ELSE whatsapp_coexistence.history_request_id END,
    contacts_request_id = CASE WHEN whatsapp_coexistence.disconnected_at IS NOT NULL THEN null ELSE whatsapp_coexistence.contacts_request_id END,
    history_progress = CASE WHEN whatsapp_coexistence.disconnected_at IS NOT NULL THEN 0 ELSE whatsapp_coexistence.history_progress END,
    history_error = null, contacts_error = null, disconnected_at = null;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_coexistence(
  p_waba_id text, p_field text, p_value jsonb, p_event_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account uuid; v_id uuid; v_session uuid;
BEGIN
  SELECT c.account_id, c.session_id INTO v_account, v_session FROM whatsapp_coexistence c
    JOIN whatsapp_config w ON w.id = c.config_id AND w.connection_mode = 'coexistence'
      AND w.phone_number_id = c.phone_number_id AND w.waba_id = c.waba_id
    WHERE c.waba_id = p_waba_id AND c.disconnected_at IS NULL
      AND (c.phone_number_id = p_value #>> '{metadata,phone_number_id}' OR
        (p_field = 'account_update' AND regexp_replace(c.display_phone, '[^0-9]', '', 'g') = regexp_replace(p_value ->> 'phone_number', '[^0-9]', '', 'g')));
  IF v_account IS NULL THEN RETURN null; END IF;
  INSERT INTO whatsapp_coexistence_events(account_id, connection_session, event_key, field, payload, priority)
    VALUES(v_account, v_session, p_event_key || ':' || v_session::text, p_field, p_value,
      CASE p_field WHEN 'account_update' THEN 0 WHEN 'smb_message_echoes' THEN 1 WHEN 'smb_app_state_sync' THEN 5 ELSE 10 END)
    ON CONFLICT(account_id, event_key) DO UPDATE SET event_key = EXCLUDED.event_key
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_whatsapp_coexistence_event(p_event_id uuid, p_batch jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e public.whatsapp_coexistence_events; c public.whatsapp_coexistence; w public.whatsapp_config;
  item jsonb; v_contact uuid; v_conversation uuid; v_message uuid; v_sent timestamptz;
  v_phone text; v_user text; v_name text; v_old_name text; v_changed timestamptz; v_apply boolean;
BEGIN
  SELECT * INTO e FROM whatsapp_coexistence_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR e.processed_at IS NOT NULL THEN RETURN; END IF;
  SELECT * INTO c FROM whatsapp_coexistence WHERE account_id = e.account_id FOR UPDATE;
  SELECT * INTO w FROM whatsapp_config WHERE id = c.config_id AND phone_number_id = c.phone_number_id AND connection_mode = 'coexistence';
  IF NOT FOUND OR c.disconnected_at IS NOT NULL OR e.connection_session <> c.session_id THEN
    UPDATE whatsapp_coexistence_events SET processed_at = now() WHERE id = e.id;
    RETURN;
  END IF;
  IF e.processed_items <> COALESCE((p_batch ->> 'offset')::integer, 0) THEN RETURN; END IF;
  IF COALESCE((p_batch ->> 'disconnected')::boolean, false) THEN
    UPDATE whatsapp_coexistence SET disconnected_at = now(), last_event_at = now() WHERE account_id = e.account_id;
    UPDATE whatsapp_config SET status = 'disconnected', updated_at = now() WHERE id = c.config_id;
  ELSE
    FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_batch -> 'contacts', '[]')) LOOP
      v_phone := item ->> 'phone'; v_name := item ->> 'name'; v_changed := (item ->> 'changed_at')::timestamptz;
      SELECT name INTO v_old_name FROM whatsapp_app_contacts WHERE account_id = e.account_id AND phone = v_phone;
      INSERT INTO whatsapp_app_contacts(account_id, phone, name, removed, changed_at)
        VALUES(e.account_id, v_phone, v_name, (item ->> 'removed')::boolean, v_changed)
        ON CONFLICT(account_id, phone) DO UPDATE SET name = EXCLUDED.name, removed = EXCLUDED.removed, changed_at = EXCLUDED.changed_at
        WHERE whatsapp_app_contacts.changed_at < EXCLUDED.changed_at;
      v_apply := FOUND;
      IF v_apply AND NOT (item ->> 'removed')::boolean THEN
        -- Keep CRM records when a phone contact is removed. A custom CRM name
        -- also survives subsequent changes in the phone's address book.
        INSERT INTO contacts(account_id, user_id, phone, name) VALUES(e.account_id, w.user_id, '+' || v_phone, NULLIF(v_name, ''))
          ON CONFLICT(account_id, phone_normalized) WHERE phone_normalized <> '' DO UPDATE SET
            name = CASE WHEN contacts.name IS NULL OR contacts.name IN ('', contacts.phone, v_old_name) THEN EXCLUDED.name ELSE contacts.name END;
      END IF;
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_batch -> 'messages', '[]')) LOOP
      v_contact := null; v_conversation := null; v_message := null;
      v_phone := item ->> 'phone'; v_user := item ->> 'user_id'; v_name := item ->> 'name';
      v_sent := (item ->> 'created_at')::timestamptz;
      IF v_phone <> '' THEN
        INSERT INTO contacts(account_id, user_id, phone, name) VALUES(e.account_id, w.user_id, '+' || v_phone, NULLIF(v_name, ''))
          ON CONFLICT(account_id, phone_normalized) WHERE phone_normalized <> '' DO NOTHING;
        SELECT id INTO v_contact FROM contacts WHERE account_id = e.account_id AND phone_normalized = v_phone;
      ELSIF v_user <> '' THEN
        INSERT INTO contacts(account_id, user_id, phone, wa_user_id, name) VALUES(e.account_id, w.user_id, '', v_user, NULLIF(v_name, ''))
          ON CONFLICT(account_id, wa_user_id) WHERE wa_user_id IS NOT NULL DO NOTHING;
        SELECT id INTO v_contact FROM contacts WHERE account_id = e.account_id AND wa_user_id = v_user;
      END IF;
      IF v_contact IS NULL THEN CONTINUE; END IF;
      INSERT INTO conversations(account_id, user_id, contact_id) VALUES(e.account_id, w.user_id, v_contact)
        ON CONFLICT(account_id, contact_id) DO NOTHING;
      SELECT id INTO v_conversation FROM conversations WHERE account_id = e.account_id AND contact_id = v_contact;
      INSERT INTO messages(conversation_id, sender_type, content_type, content_text, media_url, media_type,
        message_id, status, created_at, whatsapp_source, whatsapp_media_placeholder)
        VALUES(v_conversation, item ->> 'sender_type', item ->> 'content_type', item ->> 'content_text', item ->> 'media_url', item ->> 'media_type',
          item ->> 'message_id', item ->> 'status', v_sent, item ->> 'source', (item ->> 'placeholder')::boolean)
        ON CONFLICT(conversation_id, message_id) DO NOTHING RETURNING id INTO v_message;
      IF v_message IS NULL THEN
        -- History media arrives in separate notifications. Enrich its
        -- placeholder without duplicating the message or its side effects.
        IF NOT (item ->> 'placeholder')::boolean THEN
          UPDATE messages SET content_type = item ->> 'content_type', content_text = item ->> 'content_text',
            media_url = item ->> 'media_url', media_type = item ->> 'media_type', whatsapp_media_placeholder = false
            WHERE conversation_id = v_conversation AND message_id = item ->> 'message_id' AND whatsapp_media_placeholder;
        END IF;
        CONTINUE;
      END IF;
      UPDATE conversations SET last_message_text = COALESCE(NULLIF(item ->> 'content_text', ''), '[' || (item ->> 'content_type') || ']'),
        last_message_at = v_sent, updated_at = now()
        WHERE id = v_conversation AND (last_message_at IS NULL OR last_message_at <= v_sent);
      IF item ->> 'sender_type' = 'customer' THEN
        UPDATE conversations SET last_inbound_at = GREATEST(last_inbound_at, v_sent),
          first_inbound_at = LEAST(first_inbound_at, v_sent)
          WHERE id = v_conversation;
      ELSE
        UPDATE conversations SET last_reply_at = GREATEST(last_reply_at, v_sent) WHERE id = v_conversation;
      END IF;
      IF item ->> 'source' = 'business_app' THEN
        UPDATE conversations SET ai_autoreply_disabled = true WHERE id = v_conversation;
        UPDATE flow_runs SET status = 'paused_by_agent', ended_at = now(), end_reason = 'agent_replied'
          WHERE account_id = e.account_id AND contact_id = v_contact AND status = 'active';
      END IF;
    END LOOP;
    UPDATE whatsapp_coexistence SET last_event_at = now(),
      history_progress = GREATEST(history_progress, COALESCE((p_batch ->> 'history_progress')::integer, 0)),
      history_status = CASE WHEN history_status IN ('complete','declined') THEN history_status ELSE COALESCE(p_batch ->> 'history_status', history_status) END,
      history_error = COALESCE(p_batch ->> 'error', history_error),
      contacts_status = CASE WHEN e.field = 'smb_app_state_sync' THEN 'syncing' ELSE contacts_status END
      WHERE account_id = e.account_id;
  END IF;
  UPDATE whatsapp_coexistence_events SET
    processed_items = processed_items + jsonb_array_length(COALESCE(p_batch -> 'messages', '[]')) + jsonb_array_length(COALESCE(p_batch -> 'contacts', '[]')),
    processed_at = CASE WHEN COALESCE((p_batch ->> 'done')::boolean, true) THEN now() ELSE null END,
    last_error = null,
    payload = CASE WHEN COALESCE((p_batch ->> 'done')::boolean, true) THEN '{}'::jsonb ELSE payload END WHERE id = e.id;
END;
$$;

REVOKE ALL ON FUNCTION public.connect_whatsapp_coexistence(uuid,uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_coexistence(text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_whatsapp_coexistence_event(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connect_whatsapp_coexistence(uuid,uuid,text,text,text,text,text),
  public.enqueue_whatsapp_coexistence(text,text,jsonb,text), public.apply_whatsapp_coexistence_event(uuid,jsonb) TO service_role;
