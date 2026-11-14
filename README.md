# Email-to-RSS

Convert email newsletters into a private RSS feed using Cloudflare Workers + ForwardEmail.

This project is self-hosted, uses your own domain, and keeps your data in your own Cloudflare account.

## Why this exists

Many newsletters only support email delivery. RSS readers offer a better reading experience, but getting email-only newsletters into RSS usually means relying on shared third-party infrastructure.

Email-to-RSS keeps the same workflow while avoiding shared domains and shared data stores.

## Features

- One-click feed creation from an admin dashboard
- Bulk feed/email deletion from the admin dashboard (safe checkbox-based flow)
- Inline double-confirm delete interactions with toast feedback in the admin dashboard
- Resizable + sortable table columns in the admin dashboard (Table view)
- Unique newsletter addresses per feed (for example `apple.mountain.42@yourdomain.com`)
- ForwardEmail webhook ingestion with source-IP verification
- Optional per-feed sender allowlist (`email@domain.com` or `domain.com`)
- RSS generation on demand (`/rss/:feedId`)
- Cloudflare KV storage for feed config + email metadata/content
- Password-protected admin UI
- Fully self-hosted on your Cloudflare account

## Architecture

1. ForwardEmail forwards inbound messages to `https://yourdomain.com/api/inbound`.
2. The Worker validates the request source against ForwardEmail MX IP ranges.
3. The Worker parses and stores incoming content in KV.
4. `https://yourdomain.com/rss/:feedId` renders RSS from stored items.
5. `/admin` provides feed management and email deletion.

Main routes:

- `src/routes/inbound.ts`: webhook ingestion
- `src/routes/rss.ts`: RSS rendering
- `src/routes/admin.ts`: admin UI + feed CRUD

## Requirements

- Node.js 20+
- A Cloudflare account
- A domain managed in Cloudflare DNS
- A ForwardEmail account

## Setup

1. Clone this repository.
2. Authenticate Wrangler:
   ```bash
   npx wrangler login
   ```
3. Run setup:
   ```bash
   bash setup.sh
   ```

`setup.sh` will:

- install npm dependencies
- verify Cloudflare auth (`wrangler whoami`)
- create KV namespaces (`EMAIL_STORAGE` + preview)
- set the `ADMIN_PASSWORD` secret in `production`
- generate `wrangler.toml` from `wrangler-example.toml`
- stamp `compatibility_date` to the current date

4. Configure ForwardEmail DNS records in Cloudflare:

| Type | Name | Content                                              | Notes                   |
| ---- | ---- | ---------------------------------------------------- | ----------------------- |
| MX   | @    | `mx1.forwardemail.net`                               | Priority `10`, DNS only |
| MX   | @    | `mx2.forwardemail.net`                               | Priority `10`, DNS only |
| TXT  | @    | `"forward-email=https://yourdomain.com/api/inbound"` | webhook target          |
| TXT  | @    | `"v=spf1 include:spf.forwardemail.net -all"`         | SPF                     |

5. Deploy:

   ```bash
   npm run deploy
   ```

   After the first deploy, CI deploys every push to `main` (see [Continuous deployment](#continuous-deployment)).

6. Open `https://yourdomain.com/admin` and sign in.

## Development

```bash
npm ci
npm run dev
npm test
npm run build
```

## Configuration notes

- `wrangler-example.toml` is the template; `wrangler.toml` is generated locally.
- Keep `compatibility_date` fresh when doing runtime upgrades.
- `ADMIN_PASSWORD` is a Cloudflare Worker secret, not a plain env var in config.

## Security notes

- Inbound webhook access is IP-restricted to ForwardEmail MX sources.
- Admin auth uses a signed, `HttpOnly`, `Secure`, `SameSite=Strict` cookie.
- Admin responses are `no-store` to avoid cache leakage.
- For high-value feeds, set `Allowed senders` so only known sender addresses/domains are accepted.
- You should use a strong admin password and rotate periodically.

## Continuous deployment

`.github/workflows/ci.yml` runs the tests and a dry-run bundle on every pull request and push. A push to `main` then deploys the Worker with `wrangler deploy --env production` and checks that `/admin/login` answers. To redeploy without a code change, run the workflow from the Actions tab (`workflow_dispatch`).

The deploy job reads three repository secrets:

| Secret                  | Holds                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `WRANGLER_TOML`         | The whole generated `wrangler.toml`, which stays out of the repo                                              |
| `CLOUDFLARE_API_TOKEN`  | An account-owned token: Workers `Editor` on this Worker, and Zone `Workers Routes Write` on the domain's zone |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID                                                                                     |

`ADMIN_PASSWORD` stays a Worker secret in Cloudflare; a deploy keeps it. To change it, run `npx wrangler secret put ADMIN_PASSWORD --env production` from a local clone.

## Upgrading dependencies

Renovate (`renovate.json`) keeps dependencies current. Minor and patch updates share one PR and merge themselves once CI is green and the release is 7 days old, which deploys them. Major updates open their own PRs and wait for review.

To refresh dependencies by hand:

```bash
npm outdated
npm install
npm test
npm run build
```

Then update `compatibility_date` in the `WRANGLER_TOML` secret and merge to `main`.

## License

MIT
