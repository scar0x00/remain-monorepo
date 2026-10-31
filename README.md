# Remain

Remain is a web app for studying and memorizing flashcards. You can write decks by hand, upload them, or have an LLM generate them from your own notes, PDFs and other files, then study them in the browser and track your progress on a dashboard. Decks are also exposed over [MCP](https://modelcontextprotocol.io), so assistants such as claude.ai and Claude Code can read and edit them.

## Features

- **Generate decks with an LLM.** Describe a topic or attach files (PDFs, text, and other documents) in a chat, and an agent builds the deck. Ask it to refine an existing deck and it returns only the changes.
- **Upload decks** as `.json` or `.yaml` files, or other files such as `.apkg`, which are stored as they are.
- **Browse and search** your decks.
- **Study** a deck card by card, with optional references (page, equation, theorem, ...) behind a toggle on the back of each card.
- **Edit decks** in a full deck editor, or quick-edit a card without leaving a study session. Saves are checked against the stored version, so an edit that would overwrite a newer change shows a conflict instead.
- **Track progress** on a dashboard: activity heatmap, weekday chart, per-deck accuracy, decks that need review and your hardest cards.
- **Use it from an MCP client** to list, read, create and edit decks (see [MCP server](#mcp-server)).

## Architecture

Remain is a Bun + Cloudflare Workers monorepo. Each top-level directory is its own package with its own `package.json` and README; there is no root workspace, so run commands from inside the package.

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

| Directory | What it is |
|---|---|
| [`frontend/`](frontend) | Angular single-page app: chat, upload, browse, study, deck editor and dashboard |
| [`main-backend/`](main-backend) | Hono Worker with the REST API (`/api/v1/*`) and the MCP endpoint (`/mcp`). Stores deck files in R2 and listing metadata and study stats in Postgres |
| [`flashcard-generator-agent/`](flashcard-generator-agent) | Cloudflare Agents SDK Worker that turns prompts and files into decks with an LLM |
| [`e2e/`](e2e) | Playwright browser tests that run against the whole local stack |
| [`scripts/`](scripts) | CI helpers and a deck generation script |
| [`test-decks/`](test-decks) | Sample decks and the contract fixtures shared by the three packages |

Decks are `<deckName>.json` or `<deckName>.yaml` files in R2. Postgres only stores what is needed for listing, searching and statistics. The deck format (v2) is described in [`AGENTS.md`](AGENTS.md#deck-format-v2).

The app is deployed on Cloudflare Workers behind Cloudflare Access. User accounts are not wired up yet, so every deck belongs to a placeholder `system` user.

## Getting started

### Prerequisites

- [Bun](https://bun.com). Use `bun` and `bunx` in this repo, not `npm`.
- Node.js for the Angular CLI (CI uses 24).
- A local Postgres, for main-backend. Point `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PG` at it (the connection string needs a password) and apply the SQL files in `main-backend/better-auth_migrations/` and then `main-backend/migrations/`. `scripts/ci-migrate.sh` does this.
- A Cloudflare account, authenticated with `wrangler`. The agent's Workers AI binding is remote even in local development.
- In `main-backend/.dev.vars` (or `.env`), set `DEV_SKIP_ACCESS_AUTH=true` so `/mcp` works without Cloudflare Access. Never set it in production.

### Install

Install dependencies in each package:

```bash
for dir in frontend main-backend flashcard-generator-agent e2e; do (cd "$dir" && bun install); done
```

### Run the whole stack

```bash
./dev-server start     # also: stop | restart | status | logs
```

This starts the frontend on <http://localhost:4200>, main-backend on port 8787 and the agent on port 8788. Both workers share one local R2 state directory, which generation needs to work.

To run a single package instead, use the scripts below from inside its directory. If you run the two workers by hand, give them the same `--persist-to` directory.

| Package | Dev server |
|---|---|
| `frontend` | `bun run start` |
| `main-backend` | `bun run dev` |
| `flashcard-generator-agent` | `bun run dev` |

## Testing

| Where | Command | What it runs |
|---|---|---|
| `frontend` | `bun run test` | Vitest, through `ng test` |
| `main-backend` | `bun run test` | Unit tests against in-memory fakes of Postgres and R2 |
| `main-backend` | `bun run test:e2e` | API e2e against a `wrangler dev` it starts itself |
| `flashcard-generator-agent` | `bun run typecheck` and `bun run test` | Type check and unit tests |
| `flashcard-generator-agent` | `bun run test:smoke` | Smoke test that calls the real model |
| `e2e` | `bun run test` | Browser tests; start the stack with `./dev-server start` first |

The browser tests use the system Chrome; set `E2E_BROWSER_PATH` to use another Chromium binary.

## MCP server

main-backend serves a stateless MCP endpoint at `https://remain.scar0x00.click/mcp`. The client's own LLM writes the cards; the generator agent is not involved. Tools: `list_decks`, `read_deck`, `create_deck`, `update_deck`, `add_cards`, `edit_cards`, `update_deck_meta` and `delete_deck`.

- **Claude Code:** `claude mcp add --transport http remain https://remain.scar0x00.click/mcp`, then run `/mcp` to authenticate.
- **claude.ai:** Settings > Connectors > Add custom connector, and paste the `/mcp` URL.

Authentication uses Cloudflare Access Managed OAuth. See [`AGENTS.md`](AGENTS.md#mcp-server) for the tool details and the Access setup.

## Continuous integration and deployment

- **Tests** (`.github/workflows/tests.yml`) run every suite above on pull requests and pushes to `dev` and `main`. The agent smoke test and the browser e2e need the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.
- **Deploy** (`.github/workflows/deploy.yml`) deploys the Workers whose package changed on every push to `main`. It can also be run by hand to deploy all three.

Changes go through a pull request into `dev`, and `dev` is merged into `main` to release. Both branches are protected and require the Tests jobs to pass.

## More documentation

[`AGENTS.md`](AGENTS.md) is the detailed technical reference: deck format, request flows, the MCP server, analytics, per-package layout and gotchas. It is written for coding agents but is the best place for contributors to start.

## License

Remain is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You can read, run, modify and share the code for any noncommercial purpose, such as personal use, study, research and hobby projects. Commercial use is not permitted. This is not an OSI-approved open source license.
