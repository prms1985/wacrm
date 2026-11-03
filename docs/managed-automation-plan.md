# Industry-focused AI automation subscriptions

## Product and delivery model

Start with distributor and wholesale sales: enquiry intake, catalogue answers,
quotation preparation, staff approval, and human follow-up. Sell a scoped setup
service plus a recurring subscription with explicit AI generation, outbound
message attempt and seat allowances. External provider charges are separate.
Prices in the seeded plans are editable launch hypotheses, not market rates.

## Implementation sequence

Implemented locally. Operational activation requires migrations 067 and 068,
platform-administrator bootstrap and a staging onboarding test.

1. Add protected platform administrators, industry packages, subscription plans,
   managed client subscriptions, business profiles, audit and payment records.
2. Enforce account capabilities in database policies, session APIs, public APIs
   and background sending/generation. Preserve existing standalone accounts.
3. Remove direct browser access to credential-bearing configuration. Expose
   sanitized metadata; read encrypted credentials with server clients only.
4. Add an administrator console to approve client onboarding, assign plans,
   configure industry instructions/AI/WhatsApp, record payments and suspend use.
5. Add a client subscription/onboarding portal with business details, package,
   allowances, connection status and human-contact information.
6. Publish industry bot instructions explicitly after testing; keep drafts
   separate from live AI configuration. AI never approves or sends quotations.
7. Validate authorization, tenant isolation, quotas, payment idempotency and
   migrations; run typecheck, tests and production build.

## Deployment and pilot

Apply new migrations 067 and 068 after 066 in a staging Supabase project first. Bootstrap
the first platform administrator with the SQL described in managed-automation.md.
Existing subscriptions are not inferred from account roles. Enable managed
signup in the protected platform settings only after a pilot succeeds. Existing
accounts remain standalone until an administrator explicitly enrolls them.

Pilot with two test tenants before onboarding 3–5 paying clients in one segment.
Measure response times, quotation activity, support hours, retention and direct
usage costs. Review allowances against actual provider invoices before scaling.

## External dependencies and follow-on work

Meta approval, supported onboarding, DNS, secrets and database deployment must
be configured by the operator. The first billing adapter records manual payments;
it does not charge cards. Add a signed, idempotent payment-provider webhook before
enabling automatic collection. Provider charges and taxes are not inferred.

Existing flow templates and the quotation/receptionist engine are reused. General
durable AI dispatch, automatic payment collection, calendar/ERP integrations,
reseller access and multiple workspace memberships are separately scoped work;
do not advertise these as included in this release.
