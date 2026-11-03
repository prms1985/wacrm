-- ============================================================
-- 065_ai_receptionist.sql — AI Receptionist configuration
--
-- Adds receptionist_config JSONB column to ai_configs for:
--   - receptionist mode toggle
--   - customizable greeting prompt / persona
--   - automated contact detail collection (name, email, company)
--   - product/service catalogue suggestions
--   - sales quotation preparation toggle
--   - staff transfer triggers and preferences
-- ============================================================

ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS receptionist_config JSONB NOT NULL DEFAULT '{
    "enabled": true,
    "receptionist_name": "Receptionist",
    "greeting_prompt": null,
    "collect_details": true,
    "suggest_products": true,
    "prepare_quotations": true,
    "transfer_to_staff": true
  }'::jsonb;
