# WhatsApp Business app and AiBA on the same number

AiBA supports Meta's Coexistence onboarding. A business can keep its number in
the WhatsApp Business mobile app and connect it to AiBA's Cloud API inbox.
Availability depends on Meta app permissions, onboarding configuration, and
the business number's eligibility. Installing this code does not grant Meta access.

## Deployment setup

1. Apply `supabase/migrations/066_whatsapp_coexistence.sql` after migrations
   001–065. It adds connection/import metadata and a durable event queue.
2. Configure a live Meta app for Facebook Login for Business / WhatsApp Embedded
   Signup, with Business app onboarding enabled. Obtain the required access to
   `whatsapp_business_management` and `whatsapp_business_messaging` through Meta's
   review/onboarding process for your provider configuration. Confirm current
   requirements in Meta's documentation before onboarding customers.
3. Set these server-side environment variables and restart AiBA:

   ```dotenv
   META_APP_ID=your-app-id
   META_APP_SECRET=your-app-secret
   META_WHATSAPP_CONFIG_ID=your-embedded-signup-configuration-id
   META_WEBHOOK_VERIFY_TOKEN=a-long-random-token
   META_GRAPH_API_VERSION=v24.0
   ```

   The graph version is configurable. Use a supported version for your Meta
   configuration. If `META_APP_SECRET` contains several app secrets, set
   `META_COEXISTENCE_APP_SECRET` to the single secret matching `META_APP_ID`.
   That secret must also be present in `META_APP_SECRET` for webhook signatures.
   Existing Supabase credentials and `ENCRYPTION_KEY` are still required.

4. In Meta, allow the public HTTPS AiBA domain for JavaScript SDK / Embedded
   Signup. Configure the callback as
   `https://your-aiba-domain/api/whatsapp/webhook` using
   `META_WEBHOOK_VERIFY_TOKEN`. This token works before a customer connects.
5. Subscribe the Meta app to `messages`, `history`, `smb_app_state_sync`,
   `smb_message_echoes`, and `account_update`. Subscribing a WABA through the
   API does not replace these app-level field subscriptions.
6. Schedule `GET /api/whatsapp/coexistence/cron` every minute with the header
   `x-cron-secret: <AUTOMATION_CRON_SECRET>`. Successful webhook requests persist
   imports before acknowledgement and try processing immediately. The cron
   retries work interrupted by a server restart or database failure. Admins can
   also use **Process queued updates** in Settings.

## Connecting a business

An account owner/admin opens **Settings → WhatsApp → Connect WhatsApp Business**.
Meta opens its signup flow and requests approval on the phone. The customer
decides whether to share supported history. AiBA receives an authorization code,
exchanges it on the server, verifies the app token and the number's
`is_on_biz_app=true` / `platform_type=CLOUD_API` state, and encrypts the token.
It never calls `/register` for a Coexistence number.

Only one phone number is supported per AiBA account. AiBA refuses to replace an
existing different number or take a number belonging to another AiBA account.
The signup event may omit the phone ID; AiBA discovers a single eligible number
under the returned WhatsApp account. If there are several, the customer must
select a number explicitly. Both `waba_id` and a single
`messaging_account_ids` entry are accepted from Meta's session event.

AiBA requests contacts and history immediately after connecting. Meta's initial
sync window is 24 hours and each request is one-shot. Request IDs are retained.
If a request times out, AiBA shows **Awaiting confirmation** and does not blindly
repeat it. Keep the Business app open and refresh Settings. A reconnection may
be needed if Meta did not complete the request. A reconnection keeps already
started imports; it does not pretend to reset Meta's one-shot sync state.

## Inbox behavior

- New customer messages use the existing incoming-message path.
- Phone-sent messages appear as outgoing messages with a **Phone** label. They
  pause AI and active flows for that conversation, just like a human handoff.
  The account admin can re-enable AI through the existing inbox controls.
- History imports never run AI, flows, automations, or incoming-message alerts,
  and do not increase unread counts. Historical timestamps are preserved and
  older messages do not replace the preview of a newer live message.
- Repeated events/messages are deduplicated. Media delivered after a history
  placeholder fills the existing message. Available attachments use the
  authenticated media proxy; older attachments may no longer be available from
  Meta and stay as placeholders. This is not a full backup of phone media.
- Contact updates preserve names customized in the CRM. Removing a contact
  from the phone records the address-book change without deleting CRM records
  or chat history. Out-of-order contact updates cannot restore an older name.
- A matching `PARTNER_REMOVED` event marks the connection disconnected.
- Large imports run in batches with a transactionally saved cursor. An
  interrupted batch resumes without repeating completed work. Phone replies
  take priority over history in the queue. After five failures, an event waits
  for an admin to use **Process queued updates**, so it cannot block new replies.
- Group chats, calls, status updates, and every phone-app feature are not
  mirrored into AiBA. Unsupported message types appear with a placeholder.

The setup card shows missing environment configuration or migration requirements
instead of offering a connection that cannot complete. Existing manual Cloud API
connections remain supported.

## Verification

The repository tests exercise OAuth state/origin checks, token/phone validation,
sync requests, live/history separation, deduplication, contact ordering,
tenant isolation, transactional import rollback, and human takeover. They use
mock Graph responses and a local Postgres-compatible test database. A live test
with an eligible Business app number and a configured Meta app is still required
to verify Meta approval, popup onboarding, and actual message delivery.

References:

- [Meta: onboarding WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- [Meta: Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/)
- [Meta: message echoes](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_message_echoes/)
- [Meta: history](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/history/)
- [Meta: contact synchronization](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/smb_app_state_sync/)
