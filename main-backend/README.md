# main-backend

The API of [Remain](../README.md): a [Hono](https://hono.dev) Worker that serves the REST API (`/api/v1/*`) and the [MCP](https://modelcontextprotocol.io) endpoint (`/mcp`). It stores deck files in R2 (`DECKS`), keeps deck metadata and study history in Postgres through Hyperdrive (`PG`), and calls [`flashcard-generator-agent`](../flashcard-generator-agent) through the `FLASHCARD_AGENT` service binding to generate decks.

## Run it

```bash
bun install
bun run dev            # http://localhost:8787
```

You need a local Postgres with the migrations applied (see below). Put these in `.dev.vars` or `.env` (both are gitignored):

| Variable | Purpose |
|---|---|
| `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG` | Connection string of the local Postgres (it needs a password) |
| `DEV_SKIP_ACCESS_AUTH=true` | Skips the Cloudflare Access check on `/mcp`. Never set it in production |

To generate decks locally the agent has to share this Worker's local R2 state, so use `../dev-server start` from the repo root rather than starting the two Workers by hand.

## Layout

- `src/index.ts`: the REST routes. `src/mcp.ts`: the MCP tools.
- `src/lib/`: shared logic. Put deck behavior in `decks.ts` and the deck format in `deck-format.ts`, not in a handler. Also `stats.ts`, `study-sessions.ts`, `access-auth.ts` and `analytics.ts`.
- `migrations/`: SQL for the `decks`, `study_sessions` and `study_answers` tables, applied in order. `better-auth_migrations/`: tables for better-auth, which are applied first. `../scripts/ci-migrate.sh` applies both sets to the database in `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG`.
- `wrangler.jsonc`: bindings, routes and public vars. Run `bun run cf-typegen` after changing it.

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | `wrangler dev` |
| `bun run test` | Unit tests (`test/unit`) |
| `bun run test:e2e` | API tests against a `wrangler dev` the test starts itself (needs the Postgres above) |
| `bun run cf-typegen` | Regenerates the Worker types |
| `bun run deploy` | Deploys the Worker. CI does this on pushes to `main` |

The deck format is copied in three packages (this one, the agent and the frontend). If you change it, change all three together and update the fixtures in `../test-decks/contract/`.

See the [root README](../README.md) for the whole project and [`AGENTS.md`](../AGENTS.md) for the request flows, the MCP tools and their auth.
