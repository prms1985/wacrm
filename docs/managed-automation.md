# Managed industry automation: deployment and operation

Implementation plan: [managed-automation-plan.md](managed-automation-plan.md).

## Deploy

If Plan & onboarding reports **Database setup required**, use its **Download
setup SQL** action or open [the combined setup SQL](../supabase/setup/managed-automation.sql).
Run that file in your project's Supabase SQL Editor as the database administrator.
It installs migrations 065–068 in order, refreshes PostgREST's schema cache, and
preserves existing plan/payment records when rerun. Run `npm run
managed:prepare-setup` to regenerate the bundle after changing its source
migrations. Database SQL access is required; the application's REST service-role
key does not provide a general SQL execution endpoint.

The download does not run migrations or grant a platform role automatically.
Bootstrap the intended administrator using the statement below, then use
**Check setup again** on the page. Missing schema, invalid server credentials,
and database outages are reported separately; arbitrary database error details
are kept out of browser responses.

1. Back up the database and test on a staging project. Apply migrations 067 and
   068 after all existing migrations through 066. Deploy the application changes
   together: 067 removes browser grants on WhatsApp/AI configuration tables.
2. Keep the existing Supabase service-role key, encryption key, Meta app secrets
   and webhook settings on the server. This release does not replace them or
   move customer assets into your business portfolio.
3. Create your normal login, verify your email, then bootstrap the first platform
   administrator in the Supabase SQL editor as the database administrator:

   ```sql
   INSERT INTO public.platform_users(user_id)
   SELECT id FROM auth.users WHERE email = 'your-administrator-email@example.com'
   ON CONFLICT(user_id) DO UPDATE SET enabled = true;
   ```

   Use your actual administrator email. Confirm that exactly one intended user
   matched. Workspace ownership does not grant platform administration.

4. Sign in and open `/admin/clients`. Existing accounts remain standalone. Enroll
   a test workspace or enable **Require approval for new clients**. New accounts
   created after that setting is enabled receive a pending subscription.
5. Review the seeded Launch/Growth prices and allowances before selling them.
   They are editable examples in INR, not provider rates or a payment request.

## Onboard a client

The client registers with their own email and opens **Plan & onboarding** at
`/subscription`. They submit business information and a human support contact.
The owner/admin can authorize their first eligible WhatsApp Business app number
through the existing Meta Coexistence signup while the subscription is pending.
That limited authorization does not permit later connection changes.

Standard Cloud API numbers can be configured by the platform administrator in
the client's administration screen. Meta Embedded Signup approval and eligibility
are external requirements; this code does not grant them.

In `/admin/clients/<account-id>`:

1. Enroll the workspace in the distributor sales package with status **pending**.
   Enrollment pauses existing automations and active flows so legacy responders
   cannot suppress or duplicate the managed receptionist. Review that transition
   with existing clients before enrolling their live workspace.
2. Review business information and WhatsApp status. Configure and verify AI
   credentials. Credential updates pause the AI until it is published again.
3. Add approved business knowledge. Import the client catalogue from the administration screen using the product CSV sample. Clients can maintain their own catalogue when you enable that capability.
4. Save the receptionist instructions, test the saved draft, then publish it.
   Tests use saved instructions and business details, count toward the generation
   allowance, and do not send WhatsApp messages. Publication includes the current
   business details; later business edits require republishing.
5. Review the service period and set status **active**. The database requires
   submitted business information, a connected WhatsApp configuration and a
   published receptionist. Period end is exclusive and dates are stored in UTC.
6. Record verified payments with a stable reference. Recording a payment never
   activates an account or silently extends a service period. Renewals are an
   explicit subscription update after payment reconciliation.

The package uses existing knowledge search, AI receptionist and quotation intake.
AI collects requirements and drafts quotations; staff approve/send documents and
record follow-up. There is no inventory reservation, accounting invoice generator,
automatic debt collection, autonomous quote approval or automatic payment charge.

## Permissions and limits

Managed clients inherit plan capabilities plus administrator-selected additions.
AI configuration, WhatsApp connection changes, API-key management and workflow
editing remain platform-managed even for workspace owners. Existing role checks
still apply: a viewer does not receive write access just because a feature is in
the plan. Public API access is disabled unless explicitly granted; previously
issued keys are subject to the current subscription policy on every request.

Manual invoice delivery is distinct from subscription billing. External clients
can use existing scoped API keys only after the operator enables `api.access`.
Client integration credentials should be provisioned by the operator, kept on the
integration server and revoked through trusted administration when no longer used.

Seat limits are checked in the database on membership changes. AI generations
and outbound attempts reserve allowance atomically before external calls. AI
extraction can use more than one generation per customer message. Message phone
variant retries each count as an attempt. Failed/uncertain attempts remain counted;
no automatic refund permits retry loops. These are service units, not a claim
that provider billing uses the same metric.

Changing a plan's allowances affects all subscriptions using it. Suspension,
expiry, cancellation and unavailable metering block outbound generation/sending;
incoming webhook persistence and delivery updates continue. Quotas are scoped to
the exact service period and do not reset on an application restart.

Keep `ENCRYPTION_KEY` stable. Tokens/keys remain encrypted in their original
tables, which are now server-only; no credential migration or plaintext export is
needed. Browser metadata endpoints return configured flags and sanitized status.

## Validation and launch

Tests under `src/lib/managed` execute migration 067 against a local
Postgres-compatible database and exercise platform/tenant separation, direct
credential access, plan restrictions, exact allowances, payment references,
pending registration and draft publication. Resource tests use mocks for the new
server boundaries. Run the full suite, typecheck and production build.

Before launch, use a staging Supabase project and eligible Meta number for a real
client onboarding, quotation review/send, operator handoff and suspension test.
No tests in this repository establish Meta approval or production delivery.

Start with 3–5 clients in one industry. Track actual onboarding/support effort,
provider costs, response times, quotation outcomes and retention. Automated
payment collection requires a separately configured gateway and signed,
idempotent webhook. Durable general-purpose AI dispatch, reseller access,
multi-workspace client membership, and ERP/calendar connectors remain future
work; the existing webhook `after()` dispatcher is still best-effort.

## Local verification for this implementation

- Full regression suite passed: 1,973 tests at the full-suite checkpoint.
- Subsequent focused checks passed for exact payment display, configuration
  routes, media permissions and enrollment transitions.
- TypeScript and the production Next.js build passed.
- ESLint completed with zero errors; 40 existing warnings remain.
- Local production HTTP checks returned redirects to login for `/admin/clients`
  and `/subscription`, and 401 for the new private APIs. The owned smoke-test
  server was stopped afterward.
- No production database migrations or Meta sends were executed. Authenticated
  visual verification and live Meta onboarding remain staging checks.
