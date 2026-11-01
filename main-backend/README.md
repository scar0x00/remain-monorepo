# main-backend

Hono Worker behind `remain.scar0x00.click/api/v1/*` and `/mcp`. See `AGENTS.md` at the repo root for
how it fits together.

```sh
bun install
bun run dev        # wrangler dev on :8787 (or ./dev-server start from the repo root)
bun run test       # unit tests
bun run test:e2e   # starts its own wrangler dev against a local Postgres
bun run cf-typegen # after changing bindings in wrangler.jsonc
```

## Local setup

Create `main-backend/.env` (git-ignored):

```sh
# Local Postgres standing in for Hyperdrive. Apply the migrations with ../scripts/ci-migrate.sh.
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG=postgres://postgres:postgres@localhost:5432/postgres

# better-auth. The URL is the one the browser sees: the Angular dev server, which proxies /api.
BETTER_AUTH_URL=http://localhost:4200
BETTER_AUTH_SECRET=   # openssl rand -base64 32

# Print verification and reset links in the wrangler log instead of sending email.
DEV_LOG_EMAILS=true

# Optional: a GitHub OAuth app for dev, with the callback
# http://localhost:4200/api/v1/auth/callback/github
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Optional: Upstash. Without these, sessions are checked against Postgres.
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# MCP without Cloudflare Access: act as this (verified) local account.
DEV_SKIP_ACCESS_AUTH=true
DEV_ACCESS_EMAIL=you@example.com
```

Open the app at `http://localhost:4200`, not a LAN IP: cookies and the GitHub callback are bound to
`localhost`. Sign up, then open the verification link printed in the main-backend log
(`./dev-server logs`).

## Production setup

1. **Migrations**: apply `better-auth_migrations/2026-11-01T00-00-00.000Z.sql` (makes
   `account.issuer` nullable; without it every sign-up fails on better-auth 1.7.3+) and
   `migrations/0005_decks_per_user.sql` to Neon.
2. **Upstash**: create a Redis database (global, with a read region near your users) and set
   `wrangler secret put UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. **Secrets**: `wrangler secret put BETTER_AUTH_SECRET` (`openssl rand -base64 32`). For GitHub,
   create an OAuth app with the callback `https://remain.scar0x00.click/api/v1/auth/callback/github`
   and set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
4. **Email**: onboard the zone `scar0x00.click` under Compute > Email Service > Email Sending. If it
   doesn't accept `no-reply@remain.scar0x00.click` as a sender, change `EMAIL_SENDER` in
   `src/lib/email.ts` and `allowed_sender_addresses` in `wrangler.jsonc`.
5. **Deploy**, sign up with your email, verify it, then give yourself the decks and study history
   from before accounts:
   ```sh
   DATABASE_URL=<neon url> bun scripts/claim-system-data.ts --email you@example.com          # dry run
   DATABASE_URL=<neon url> bun scripts/claim-system-data.ts --email you@example.com --apply
   ```
