# Cloudflare Workers deployment

The production Worker uses Wrangler's automatic Next.js configuration. The
`deploy:cloudflare` script in `package.json` supplies these public runtime
variables on every deployment:

| Variable                  | Value              |
| ------------------------- | ------------------ |
| `META_APP_ID`             | `1149900210906534` |
| `META_WHATSAPP_CONFIG_ID` | `1061330360328985` |

The script uses `--keep-vars` to preserve other runtime variables configured in
Cloudflare. Update the script when changing the Meta app or signup configuration.

## Configure Workers Builds once

In **Workers & Pages > wacrm > Settings > Build**, use:

- **Build command:** `npm run build`
- **Deploy command:** `npm run deploy:cloudflare`

Deploy the commit containing this script. Future deployments using this command
will apply both IDs automatically. Wrangler continues to generate the framework
configuration during deployment.

## Runtime secrets

In **Settings > Variables and Secrets > Runtime > Production**, keep the existing
values of these variables as **Secrets**:

- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_KEY`

Build variables alone are unavailable to the deployed Worker. Secrets stay in
Cloudflare and are preserved by Wrangler deployments. Keep the existing
`ENCRYPTION_KEY` so stored credentials remain readable.

After deploying, sign in as an owner/admin and open
`/api/whatsapp/coexistence`. Its `setup` section should contain both IDs and an
empty `missing` array once the required Meta secrets are configured.

References:

- [Wrangler deploy options](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy)
- [Automatic framework configuration](https://developers.cloudflare.com/workers/framework-guides/automatic-configuration/)
- [Build variables and secrets](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
