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

Deck files are `<deckName>.json` or `<deckName>.yaml` objects in R2. Postgres stores listing metadata (`decks`) and study history (`study_sessions`, `study_answers`).

### Deck format (v2)

`{ version: 2, meta, cards }`. `meta` has `title`, `description`, `language`, `author` (`null` until accounts exist, #12), `tool` (`{ kind: agent | mcp | manual | upload, model?, generatedAt? }`, how the deck was originally produced; refines and edits never change it), `sources` and `tags`. Each card is `{ id, front, back, meta?: { refs?, tags? } }`; `refs` are `{ kind: page | equation | theorem | definition | figure | section | other, label, source? }` and are only shown on the back, behind a toggle.

- **Ids, `tool` and `generatedAt` are always set by our code, never by an LLM.** New cards get a random `c_<12 hex>` id. The agent never sees ids: refine shows the model cards by position and it returns only changes (`edits`, `remove`, `add`), which `mergeRefinedDeck` applies. The MCP `update_deck` tool lets a client echo an existing id back and rejects ids that aren't in the deck.
- **Legacy files** (a bare array of `{ front, back }`) still work. They're upgraded in memory and on their next write. Cards without an id get the FNV-1a hash of `front\0back`, with `-2`, `-3`, ... for duplicates. This is the id study answers used before decks stored ids.
- The format is copied in three places: `flashcard-generator-agent/src/schema.ts`, `main-backend/src/lib/deck-format.ts` and `frontend/src/app/deck-format/deck-format.ts`. Each package has a contract test over the fixtures in `test-decks/contract/`, so change all three together and update the fixtures.

### Request flows

- **Generate or refine a deck**: the chat route (`FlashcardGenerator` in `frontend/src/app/flashcard-chat-route/flashcard-generator.ts`) sends multipart form data to `POST /api/v1/flashcards/:deckName`. main-backend forwards the request through `FLASHCARD_AGENT` to `/agents/flashcard-agent/:deckName`, and the `FlashcardAgent` writes the deck to R2 and returns `{ key, format, cardCount }`. main-backend then reads the object and upserts the `decks` row with its card count, title and `meta`. The `refine` form field edits an existing deck instead of creating one.
- **Upload a deck**: the upload route does `PUT /api/v1/deck/:key` with the raw file. A `.json`/`.yaml` key must be a valid deck (legacy or v2), otherwise the route returns 400 with the reason. It is stored as v2, with `tool.kind = "upload"` unless the file already has a `tool`. Other files (e.g. `.apkg`) are stored as they are. main-backend upserts the row either way.
- **Save an edited deck** (deck editor, #14): the same `PUT /api/v1/deck/:key` with `If-Match: <etag>` and the whole v2 deck as JSON (`Content-Type: application/json` works for `.yaml` keys too; the file keeps its key's format). The write uses R2 `onlyIf`, so it answers **412** when the deck changed since it was loaded (or no longer exists), for example after an agent refine or an MCP edit. `tool`, `author` and `sources` are copied from the stored deck, whatever the body says, and an edit never stamps `tool.kind = "upload"`. Every successful `PUT` returns the new etag in the `ETag` header.
- **Browse decks**: `GET /api/v1/decks?searchTerm=` does a prefix `ILIKE` on `decks.name` and or `decks.title` and returns `DeckEntry[]` (`deckName`, `size`, `uploaded`, `etag`, and when known `title`, `cardCount`, `author`, `tool`).
- **Study a deck**: `GET /api/v1/deck/:key` streams the object from R2 with etag and range support.
- **Delete**: `DELETE /api/v1/deck/:key` removes the R2 object and the row.
- **Study sessions**: `POST /api/v1/study-sessions` (`deckName`, `cardTotal`; returns the new id with 201), `GET /api/v1/study-sessions` (`deckName?`, `limit?`, `cursor?`), `GET /api/v1/study-sessions/:id` (the session and its answers), `POST /api/v1/study-sessions/:id/answers` (409 once the session is finished) and `POST /api/v1/study-sessions/:id/finish` (finishing twice is a no-op).
- **Study stats**: `GET /api/v1/stats/{overview,activity,decks,decks/:name,hardest-cards}` aggregate `study_sessions`/`study_answers` (`src/lib/stats.ts`). Every answered card counts, whatever the session status; `days` is the window and `tz` the IANA zone days are bucketed in. `decks.card_count`, `title` and `meta` are written on every deck write and backfilled from R2 by `/stats/decks`.
- **MCP client (claude.ai, Claude Code, ...)**: the client calls `POST /mcp` on main-backend, which runs a tool against the same deck store as the REST routes. See "MCP server".

## MCP server

main-backend serves a stateless MCP endpoint at `https://remain.scar0x00.click/mcp` so MCP clients can list, read, create and edit decks. The client LLM writes the cards itself; the flashcard agent is not involved.

- **Code**: `main-backend/src/mcp.ts` (`createServer(env)`, tools registered with `McpServer` from `@modelcontextprotocol/server`), mounted in `src/index.ts` as `app.all("/mcp", accessAuth, ...)` with `createMcpHandler` from `agents/mcp/server`.
- **Shared logic**: deck operations live in `src/lib/decks.ts` (`listDecks`, `putDeck`, `deleteDeck`, `upsertDeckRow`) and are used by both the REST routes and the MCP tools. Card schema and json/yaml (de)serialization are in `src/lib/deck-format.ts`. Add new deck behavior there, not inline in a handler.
- **Tools**: `list_decks` (`searchTerm?`), `read_deck` (`key`; returns `meta`, and cards with a zero-based `index`, their `id` and `refs`), `create_deck` (`name`, `cards: [{ front, back, refs? }]`, `format?`, `title?`, `description?`, `language?`, `tags?`; fails if it exists; `tool.kind = "mcp"`), `update_deck` (`key`, `cards: [{ id?, front, back, refs? }]`; replaces all cards; cards sent with an existing `id` keep it and their metadata, an unknown or repeated id fails), `add_cards` (`key`, `cards`; appends and returns the new `ids`), `edit_cards` (`key`, `edits: [{ index, front?, back?, refs? }]`; all edits or none), `update_deck_meta` (`key`, `title?`, `description?`, `language?`, `tags?`; `null` removes a field; never touches cards, `tool` or `author`), `delete_deck` (`key`). Clients never send card ids for new cards, a `tool` or timestamps. `key` is the file name with extension, as returned by `list_decks`. `add_cards` and `edit_cards` read, modify and write back, so concurrent edits are last-write-wins.
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
  | (empty) | `landing-route/` | Landing page |
  | `flashcard-chat` | `flashcard-chat-route/` | Chat UI. Uses `chat-composer/`, `chat-bubble/`; request building in `flashcard-chat.utils.ts` |
  | `deck-upload` | `deck-upload-route/` | Uses `file-input/` |
  | `deck-browse` | `browse-decks-route/` | Uses `deck-list/`, `search-deck-field/`; search state in `deck-search-term.ts` |
  | `deck-study/:id` | `deck-study-route/` | Uses `flashcard/`, `study-controller/`. The card's pencil opens `card-quick-edit/` |
  | `deck-edit/:name` | `deck-edit-route/` | Lazy. Deck editor (#14): `name` without `.json`, `?format=yaml` for YAML decks, `?card=<id>` selects a card. Uses `card-editor/`, `markdown-editor/`, `deck-meta-editor/` |
  | `dashboard` | `dashboard-route/` | Lazy. Study stats: `stat-tile/`, `activity-heatmap/`, `weekday-chart/`, `deck-stats-table/`, `needs-review/`, `hardest-cards/` |
  | `dashboard/decks/:name` | `deck-stats-route/` | Lazy. One deck's stats; `accuracy-chart/` |

- Dashboard data comes from `stats/stats.service.ts` (one `httpResource` per `/api/v1/stats/*` endpoint), provided on the `dashboard` route together with ECharts. Charts use ngx-echarts with the tree-shaken build in `stats/echarts.ts` (SVG renderer, lazy-loaded); `stats/chart-theme.ts` turns the `--app-*` tokens into colours and follows the colour scheme.
- The nav bar's hamburger opens a native `popover` menu (`nav-bar/`), which is where Dashboard lives.

- Editing: `deck-editor/deck-editor.ts` (`DeckEditor`, provided per editor, never in root) holds `original`, `draft` and the loaded etag, and saves the whole deck with `If-Match`; a 412 sets `status` to `conflict` and the UI offers Reload or Overwrite. New cards get `newCardId()` from `deck-format.ts`. The study quick edit saves through the same service and patches the run's cards by id (`StudyController.cardSaved`) without restarting the run. `markdown-editor/` is the only place that knows the field is a `textarea`, so CodeMirror can replace it later. YAML decks are parsed with `yaml`, imported on demand.
- Analytics: `analytics/analytics.ts` (`Analytics`, root, injected by `App`) loads PostHog lazily and records a page view on every route change. Autocapture, heatmaps, session replay and surveys are off; send named events with `analytics.capture(name, props)` and never put card or deck contents in props. The token is in `src/environments/environment.production.ts` (public `phc_` key), which the production build swaps in; `environment.ts` has no token, so dev, unit tests and e2e send nothing.
- Shared types are in `src/types/` (`Card`, `Deck` (v2), `DeckEntry`, `ChatMessage`, `FlashcardAgent` for the generate request/result).
- `deck-format/deck-format.ts` has `normalizeDeck`, which the study controller passes as the `httpResource` `parse` to read legacy and v2 files. Study answers use `card.id`.
- All HTTP goes to `/api/v1/*`. `proxy.conf.json` forwards `/api/**` to `localhost:8787`.

### `main-backend/` (Hono Worker)
- The REST routes are in `src/index.ts` and listed under "Request flows". All except `GET /deck/:key` go through `pgDbMiddleware`, which opens a `pg` client per request from the `PG` Hyperdrive binding. Deck operations are in `src/lib/decks.ts`; the MCP endpoint is `src/mcp.ts` (see "MCP server").
- Bindings and vars (`src/types.ts`, `wrangler.jsonc`): `DECKS` (R2), `PG` (Hyperdrive), `FLASHCARD_AGENT` (service binding to the agent), `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (verify the Access JWT on `/mcp`). Regenerate worker types with `bun run cf-typegen`.
- Analytics (`src/lib/analytics.ts`): `track(env, ctx, event, props)` sends one PostHog event under `waitUntil`, as the anonymous `system` user until #12. REST routes call it through `trackRequest(c, ...)`; `createServer(env, ctx)` wraps every MCP tool to record `mcp_tool_called` plus the deck event of a successful write. Events: `deck_created` (`source`: upload / agent / mcp), `deck_refined`, `deck_edited` (`via`: app / mcp), `deck_edit_conflict`, `deck_deleted`, `deck_generation_failed`, `study_session_started`, `study_session_finished`. Props are names, counts and enums, never card text. `POSTHOG_HOST` is a var; `POSTHOG_KEY` is a Worker secret in production only, so dev, tests and CI send nothing.
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
  - `schema.ts`: the stored deck format (zod) and the model output schemas (`DeckOutputSchema` for create, `RefineOutputSchema` for refine: only changes, addressed by zero-based position). The model output has no ids, author, tool or timestamps.
  - `deck.ts`: `buildDeck` (assigns ids and `tool`) and `mergeRefinedDeck` (applies the model's changes by position; untouched cards and the ids and metadata of edited ones never pass through the model; a position that doesn't exist makes the request fail with 502).
  - `pdf.ts`: `batchPdfs` splits and groups PDFs (max 100 pages / 20 MB per batch, with `pdf-lib`).
- Large inputs: text is chunked (100k chars per chunk) and PDFs are batched. Each chunk or batch is one model call, capped at 8 (`MAX_JOBS`), otherwise the request fails with 413. Refining only allows a single call. PDFs go to the model as files and are never converted to markdown.
- Tests: `test/unit/` (`bun run test`) and `test/smoke/` (`bun run test:smoke`, which calls the real model).

### `e2e/`
Playwright browser tests that run against the live stack (`bun run test`): `app.e2e.test.ts` (generation, refine, study; needs the agent and a model) and `deck-editor.e2e.test.ts` (editor saves, conflicts, study quick edit; needs only main-backend and the frontend). Both use the system Chrome; set `E2E_BROWSER_PATH` to another Chromium binary.

### Other
- CI: `.github/workflows/tests.yml` runs every suite on pull requests and pushes to `dev`/`main`: unit tests of each package, main-backend e2e (Postgres service container, migrations applied by `scripts/ci-migrate.sh`), the agent smoke test with `SMOKE_LIVE=1`, and the browser e2e against `./dev-server start`. The last two need the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets because the AI binding is remote. `.github/workflows/deploy.yml` deploys on push to `main`.
- `dev-server` (repo root): bash script that starts the whole stack with `./dev-server {start|stop|restart|status|logs}`. Ports: main-backend 8787, agent 8788, frontend 4200. It passes one `--persist-to` dir to both workers.
- `test-decks/`: sample decks for manual testing, plus the contract fixtures in `test-decks/contract/`. `test-pdfs/` is gitignored: put your own PDFs there for manual testing.
- `scripts/`: `ci-migrate.sh` and `ci-require-cloudflare.sh` for CI, and `generate-deck.ts`, which generates a deck locally with the `claude` CLI, reusing the agent's prompts and schemas.
- The app will be deployed on Cloudflare Workers using behind Cloudflare Access

## Git workflow
- `dev` and `main` are protected: changes need a pull request and all six Tests jobs to pass.
- Work on a feature branch and open a PR into `dev`. Merge it with a **squash commit**, then delete the feature branch once it is merged.
- Release by opening a PR from `dev` into `main` and merging it with a **regular merge commit** (never squash), so the two branches don't diverge. Do not delete `dev` or `main`.
- Merge only when the user asks you to.

## Commands
- Frontend: `bun run start`, `bun run build`, `bun run test` (Vitest via `ng test`).
- main-backend: `bun run dev`, `bun run test` (unit), `bun run test:e2e`, `bun run cf-typegen`.
- flashcard-generator-agent: `bun run dev`, `bun run typecheck`, `bun run test`, `bun run test:smoke`, `bun run types`.

## Gotchas
- main-backend and the agent must share local R2 state. Run both with `wrangler dev --persist-to <same dir>` (`./dev-server start` does this), or generation returns 500.
- `frontend/` has `bun.lock`, `package-lock.json` and `pnpm-lock.yaml` (and `packageManager` says pnpm). Use `bun` for installs anyway.
- `main-backend/src/lib/auth.ts` creates its DB client differently on Cloudflare and locally; locally it reads `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG`.

## Browser automation
- Do not use `obscura`. For any browser interaction, use the `playwright-cli` command installed on this system (`/home/oscar/.bun/bin/playwright-cli`).
