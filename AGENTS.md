## Tooling and package manager

Never use `npm` or `npmx`. Use `bun` or `bunx` instead.

You can check the state of the repo on github using `gh`.

Cloudflare released a new CLI tool named `cf`. Cloudflare’s `cf` is a new, unified command-line tool for the Cloudflare platform. It was announced on September 28, 2026 as an open beta, so commands and configuration may still change before a stable release. Is installed an I have already authenticated to it, so you can use it to interact with Cloudflare for cases where `wrangler` falls short or directly cannot be used to perform some task. `cf` is way more comprehensive.

## Overview

Remain generates and studies flashcard decks. Bun + Cloudflare Workers monorepo; each top-level directory is its own package with its own `package.json` (and `wrangler.jsonc` for Workers). There is no root workspace, so run commands from inside each package.

```
Browser (Angular SPA, :4200)
   │  /api/**  (proxy.conf.json -> :8787)
   ▼
main-backend (Hono Worker, :8787)  ── R2 bucket `remain-decks` (DECKS) ── deck files
   │            └─ Postgres via Hyperdrive (PG) ── `public.decks` metadata
   │  service binding FLASHCARD_AGENT
   ▼
flashcard-generator-agent (Agents SDK Worker, :8788) ── R2 `remain-decks` (DECKS)
   └─ Claude Haiku via OpenRouter + Cloudflare AI gateway
```

Deck files are `<deckName>.json` or `<deckName>.yaml` objects in R2. Postgres only stores listing metadata.

### Deck format (v2)

`{ version: 2, meta, cards }`. `meta` has `title`, `description`, `language`, `author` (`null` until accounts exist, #12), `tool` (`{ kind: agent | mcp | manual | upload, model?, generatedAt? }`, how the deck was originally produced; refines and edits never change it), `sources` and `tags`. Each card is `{ id, front, back, meta?: { refs?, tags? } }`; `refs` are `{ kind: page | equation | theorem | definition | figure | section | other, label, source? }` and are only shown on the back, behind a toggle.

- **Ids, `tool` and `generatedAt` are always set by our code, never by an LLM.** New cards get a random `c_<12 hex>` id. The agent and the MCP `update_deck` tool let the model echo an existing id back, and drop or reject ids that aren't in the deck.
- **Legacy files** (a bare array of `{ front, back }`) still work. They're upgraded in memory and on their next write. Cards without an id get the FNV-1a hash of `front\0back`, with `-2`, `-3`, ... for duplicates. This is the id study answers used before decks stored ids.
- The format is copied in three places: `flashcard-generator-agent/src/schema.ts`, `main-backend/src/lib/deck-format.ts` and `frontend/src/app/deck-format/deck-format.ts`. Each package has a contract test over the fixtures in `test-decks/contract/`, so change all three together and update the fixtures.

### Request flows

- **Generate or refine a deck**: the chat route (`FlashcardGenerator` in `frontend/src/app/flashcard-chat-route/flashcard-generator.ts`) sends multipart form data to `POST /api/v1/flashcards/:deckName`. main-backend forwards the request through `FLASHCARD_AGENT` to `/agents/flashcard-agent/:deckName`, and the `FlashcardAgent` writes the deck to R2 and returns `{ key, format, cardCount }`. main-backend then reads the object and upserts the `decks` row with its card count, title and `meta`. The `refine` form field edits an existing deck instead of creating one.
- **Upload a deck**: the upload route does `PUT /api/v1/deck/:key` with the raw file. A `.json`/`.yaml` key must be a valid deck (legacy or v2), otherwise the route returns 400 with the reason. It is stored as v2, with `tool.kind = "upload"` unless the file already has a `tool`. Other files (e.g. `.apkg`) are stored as they are. main-backend upserts the row either way.
- **Browse decks**: `GET /api/v1/decks?searchTerm=` does a prefix `ILIKE` on `decks.name` and or `decks.title` and returns `DeckEntry[]` (`deckName`, `size`, `uploaded`, `etag`, and when known `title`, `cardCount`, `author`, `tool`).
- **Study a deck**: `GET /api/v1/deck/:key` streams the object from R2 with etag and range support.
- **Delete**: `DELETE /api/v1/deck/:key` removes the R2 object and the row.
- **Study stats**: `GET /api/v1/stats/{overview,activity,decks,decks/:name,hardest-cards}` aggregate `study_sessions`/`study_answers` (`src/lib/stats.ts`). Every answered card counts, whatever the session status; `days` is the window and `tz` the IANA zone days are bucketed in. `decks.card_count`, `title` and `meta` are written on every deck write and backfilled from R2 by `/stats/decks`.
- **MCP client (claude.ai, Claude Code, ...)**: the client calls `POST /mcp` on main-backend, which runs a tool against the same deck store as the REST routes. See "MCP server".

## MCP server

main-backend serves a stateless MCP endpoint at `https://remain.scar0x00.click/mcp` so MCP clients can list, read, create and edit decks. The client LLM writes the cards itself; the flashcard agent is not involved.

- **Code**: `main-backend/src/mcp.ts` (`createServer(env)`, tools registered with `McpServer` from `@modelcontextprotocol/server`), mounted in `src/index.ts` as `app.all("/mcp", accessAuth, ...)` with `createMcpHandler` from `agents/mcp/server`.
- **Shared logic**: deck operations live in `src/lib/decks.ts` (`listDecks`, `putDeck`, `deleteDeck`, `upsertDeckRow`) and are used by both the REST routes and the MCP tools. Card schema and json/yaml (de)serialization are in `src/lib/deck-format.ts`. Add new deck behavior there, not inline in a handler.
- **Tools**: `list_decks` (`searchTerm?`), `read_deck` (`key`; returns `meta`, and cards with a zero-based `index`, their `id` and `refs`), `create_deck` (`name`, `cards: [{ front, back, refs? }]`, `format?`, `title?`, `description?`, `language?`, `tags?`; fails if it exists; `tool.kind = "mcp"`), `update_deck` (`key`, `cards: [{ id?, front, back, refs? }]`; replaces all cards; cards sent with an existing `id` keep it and their metadata, an unknown or repeated id fails), `add_cards` (`key`, `cards`; appends and returns the new `ids`), `edit_cards` (`key`, `edits: [{ index, front?, back?, refs? }]`; all edits or none), `delete_deck` (`key`). Clients never send card ids for new cards, a `tool` or timestamps. `key` is the file name with extension, as returned by `list_decks`. `add_cards` and `edit_cards` read, modify and write back, so concurrent edits are last-write-wins.
- **Auth**: Cloudflare Access Managed OAuth. A separate Access application ("Remain MCP") covers `remain.scar0x00.click/mcp` and acts as the OAuth 2.0 server: the client gets a `401` pointing at Access's discovery metadata, registers itself with dynamic client registration (DCR), and the user logs in through Access. Access then forwards a signed `Cf-Access-Jwt-Assertion` JWT. `src/lib/access-auth.ts` verifies its signature, issuer (`ACCESS_TEAM_DOMAIN`) and audience (`ACCESS_AUD`) and fails closed with 401 if either variable is empty.
- **Access app settings** (Zero Trust > Access controls > Applications > Remain MCP): Managed OAuth and DCR enabled, same owner-only policy as the main app, session duration 2 weeks (the grant follows it; access tokens use the 15 minute default). DCR only accepts clients whose redirect URI is on the app's allow-list: `https://claude.ai/api/mcp/*` and `https://claude.com/api/mcp/*`, plus localhost and loopback. Exact callback URLs without `/*` are rejected. Add a URI there to connect another MCP client; otherwise registration fails with `redirect_uri is not allowed by the account configuration`.
- **Config**: `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are `vars` in `wrangler.jsonc` (public identifiers, not secrets), plus the `remain.scar0x00.click/mcp` route.
- **Local dev**: there is no Access in front of `wrangler dev`, so set `DEV_SKIP_ACCESS_AUTH=true` in `main-backend/.env` to skip JWT verification. Never set it in production.
- **Connecting**: claude.ai > Settings > Connectors > Add custom connector > the `/mcp` URL (keep "Sign in now" and "Register automatically"). Claude Code: `claude mcp add --transport http remain https://remain.scar0x00.click/mcp`, then `/mcp` to authenticate.
- **Limits**: every deck is still owned by the placeholder `system` user, so there is no per-user scoping. There is no tool for uploading arbitrary files such as `.apkg`.

## Packages

### `frontend/` (Angular SPA, `remain-frontend`)
- Routes are in `src/app/app.routes.ts`. Each route and component lives in its own folder under `src/app/`.

  | Path | Route component | Notes |
  |---|---|---|
  | `flashcard-chat` | `flashcard-chat-route/` | Chat UI. Uses `chat-composer/`, `chat-bubble/`; request building in `flashcard-chat.utils.ts` |
  | `deck-upload` | `deck-upload-route/` | Uses `file-input/` |
  | `deck-browse` | `browse-decks-route/` | Uses `deck-list/`, `search-deck-field/`; search state in `deck-search-term.ts` |
  | `deck-study/:id` | `deck-study-route/` | Uses `flashcard/`, `study-controller/` |
  | `dashboard` | `dashboard-route/` | Lazy. Study stats: `stat-tile/`, `activity-heatmap/`, `weekday-chart/`, `deck-stats-table/`, `needs-review/`, `hardest-cards/` |
  | `dashboard/decks/:name` | `deck-stats-route/` | Lazy. One deck's stats; `accuracy-chart/` |

- Dashboard data comes from `stats/stats.service.ts` (one `httpResource` per `/api/v1/stats/*` endpoint), provided on the `dashboard` route together with ECharts. Charts use ngx-echarts with the tree-shaken build in `stats/echarts.ts` (SVG renderer, lazy-loaded); `stats/chart-theme.ts` turns the `--app-*` tokens into colours and follows the colour scheme.
- The nav bar's hamburger opens a native `popover` menu (`nav-bar/`), which is where Dashboard lives.

- Shared types are in `src/types/` (`Card`, `Deck` (v2), `DeckEntry`, `ChatMessage`, `FlashcardAgent` for the generate request/result).
- `deck-format/deck-format.ts` has `normalizeDeck`, which the study controller passes as the `httpResource` `parse` to read legacy and v2 files. Study answers use `card.id`.
- All HTTP goes to `/api/v1/*`. `proxy.conf.json` forwards `/api/**` to `localhost:8787`.

### `main-backend/` (Hono Worker)
- The REST routes are in `src/index.ts` and listed under "Request flows". All except `GET /deck/:key` go through `pgDbMiddleware`, which opens a `pg` client per request from the `PG` Hyperdrive binding. Deck operations are in `src/lib/decks.ts`; the MCP endpoint is `src/mcp.ts` (see "MCP server").
- Bindings and vars (`src/types.ts`, `wrangler.jsonc`): `DECKS` (R2), `PG` (Hyperdrive), `FLASHCARD_AGENT` (service binding to the agent), `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (verify the Access JWT on `/mcp`). Regenerate worker types with `bun run cf-typegen`.
- Auth: better-auth is configured in `src/lib/auth.ts` (email and password, Postgres), but no auth routes are mounted in `index.ts` yet. Every deck row is owned by the placeholder user `system` (`SYSTEM_USER_ID`), created in `migrations/0001_decks_metadata.sql`.
- Schema changes go in `migrations/` (the `decks` table: `name` unique, `user_id`, `size`, `etag`, `createdAt`, `card_count`, `title`, `meta` jsonb). better-auth tables go in `better-auth_migrations/`.
- Tests: `test/unit/deck-api.test.ts` (REST) and `test/unit/mcp.test.ts` (MCP auth and tools) use fakes from `test/helpers/` (`fake-pg.ts`, `fake-r2.ts`). `test/e2e/dev-server.test.ts` starts its own `wrangler dev`.

### `flashcard-generator-agent/` (Cloudflare Agents SDK Worker)
- `src/index.ts` routes requests with `routeAgentRequest`. `src/agent.ts` holds the `FlashcardAgent` Durable Object. `onRequest` accepts only `POST`, then calls `createDeck` or `refineDeck`.
- Bindings: `DECKS` (R2), `AI` (Workers AI, used for `toMarkdown` on non-PDF, non-text files), `FlashcardAgent` (Durable Object).
- Model: `anthropic/claude-haiku-5.5` through OpenRouter and the AI gateway (`GATEWAY_ID`, `MODEL` in `agent.ts`).
- Files:
  - `input.ts`: request form schema (`RequestSchema`), `parseRequest`, file type checks, deck (de)serialization for json/yaml.
  - `prompts.ts`: system prompt, `buildCreatePrompt`, `buildRefinePrompt`, `formatSources`, `chunkSources`.
  - `schema.ts`: the stored deck format (zod) and the model output schemas (`DeckOutputSchema` for create, `RefineOutputSchema` for refine, which may echo existing ids). The model output has no ids, author, tool or timestamps.
  - `deck.ts`: `buildDeck` (assigns ids and `tool`) and `mergeRefinedDeck` (keeps the ids and metadata of cards the model sent back with their id).
  - `pdf.ts`: `batchPdfs` splits and groups PDFs (max 100 pages / 20 MB per batch, with `pdf-lib`).
- Large inputs: text is chunked (100k chars per chunk) and PDFs are batched. Each chunk or batch is one model call, capped at 8 (`MAX_JOBS`), otherwise the request fails with 413. Refining only allows a single call. PDFs go to the model as files and are never converted to markdown.
- Tests: `test/unit/` (`bun run test`) and `test/smoke/` (`bun run test:smoke`, which calls the real model).

### `e2e/`
Playwright browser tests (`app.e2e.test.ts`) that run against the live stack (`bun run test`).

### Other
- `dev-server` (repo root): bash script that starts the whole stack with `./dev-server {start|stop|restart|status|logs}`. Ports: main-backend 8787, agent 8788, frontend 4200. It passes one `--persist-to` dir to both workers.
- `test-decks/`, `test-pdfs/`: sample inputs for manual testing.
- `db/`: only `connect-psql-command.sh`.
- `spec.md`, `TODO.md`: old notes, not kept up to date.
- The app will be deployed on Cloudflare Workers using behind Cloudflare Access

## Commands
- Frontend: `bun run start`, `bun run build`, `bun run test` (Vitest via `ng test`).
- main-backend: `bun run dev`, `bun run test` (unit), `bun run test:e2e`, `bun run cf-typegen`.
- flashcard-generator-agent: `bun run dev`, `bun run typecheck`, `bun run test`, `bun run test:smoke`, `bun run types`.

## Gotchas
- main-backend and the agent must share local R2 state. Run both with `wrangler dev --persist-to <same dir>` (`./dev-server start` does this), or generation returns 500.
- `frontend/` has both `package-lock.json` and `pnpm-lock.yaml`. Use `bun` for installs anyway.
- `main-backend/src/lib/auth.ts` creates its DB client differently on Cloudflare and locally; locally it reads `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG`.

## Browser automation
- Do not use `obscura`. For any browser interaction, use the `playwright-cli` command installed on this system (`/home/oscar/.bun/bin/playwright-cli`).
