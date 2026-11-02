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

### Claiming pre-accounts decks locally

`../scripts/claim-system-data.ts` (see step 5 of the production setup) gives the decks and study
history of the placeholder user `system` to a real account. To try it against your dev database and
the local dev R2 instead of production:

1. **Have an account.** Sign up locally and open the verification link from the log (`./dev-server logs`).
   The script only accepts an account whose email is verified.
2. **Have something to claim.** There must be `system` rows in the database you point it at (a dev
   database that predates accounts has them), and the same files at the top level of the *local* R2
   bucket (`<name>`, not `<userId>/<name>`). A fresh local R2 is empty, so seed it from `test-decks/`:
   ```sh
   cd main-backend
   STATE="${TMPDIR:-/tmp/opencode}/dev-server/wrangler-state"   # the dir ./dev-server passes to wrangler
   for f in ../test-decks/*.json; do
     bunx wrangler r2 object put "remain-decks/$(basename "$f")" --local --persist-to "$STATE" \
       --file "$f" --content-type application/json
   done
   ```
   The sizes recorded in the `decks` rows may differ from these files; they are refreshed on the next
   write.
3. **Run it with `--local`**, from the repo root, with the dev connection string
   (`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG`, not Hyperdrive) and the same persist dir:
   ```sh
   STATE="${TMPDIR:-/tmp/opencode}/dev-server/wrangler-state"
   DATABASE_URL=<dev db url> bun scripts/claim-system-data.ts --email you@example.com --local --persist-to "$STATE"           # dry run
   DATABASE_URL=<dev db url> bun scripts/claim-system-data.ts --email you@example.com --local --persist-to "$STATE" --apply
   ```
4. **Check the app** (`http://localhost:4200/deck-browse`, open a deck), then delete the old top-level
   objects with the `wrangler r2 object delete ... --local --persist-to ...` commands the script prints.

Without `--local` the script reads and writes the **production** R2 bucket (`--remote`) whatever
`DATABASE_URL` is, so never combine a dev database with a run that omits it. `--persist-to` is only
valid together with `--local`; leave it out to use wrangler's default state in `main-backend/.wrangler/`.

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
   This copies files in the real R2 bucket. To rehearse against local dev, see "Claiming pre-accounts
   decks locally" above.
