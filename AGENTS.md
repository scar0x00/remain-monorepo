Never use `npm` or `npmx`. Use `bun` or `bunx` instead.

## Architecture

Bun + Cloudflare Workers monorepo. Each top-level app is its own package with its own `package.json` and `wrangler.jsonc` where relevant.

- `frontend/`: Angular SPA (`remain-frontend`). Routes are in `src/app/app.routes.ts`: `flashcard-chat`, `deck-upload`, `deck-browse`, `deck-study/:id`. Each route and component lives in its own folder under `src/app/`. Shared types are in `src/app/types/`. `proxy.conf.json` forwards `/api/**` to `localhost:8787`.
- `main-backend/`: Hono app on a Worker (`src/index.ts`). It serves the deck API under `/api/v1`: `GET /deck/:key`, `PUT /deck/:key`, `DELETE /deck/:key`, `POST /flashcards/:deckName`, `GET /decks`. Deck JSON is stored in R2 and deck metadata in Postgres (`pgDbMiddleware`). Auth is better-auth (`src/lib/auth.ts`). Schema changes go in `migrations/`, and better-auth tables in `better-auth_migrations/`.
- `flashcard-generator-agent/`: Worker built on the Cloudflare Agents SDK. The `FlashcardAgent` class is a Durable Object. It calls `anthropic/claude-haiku-5.5` through OpenRouter and the AI gateway (`src/agent.ts`). Prompts are in `src/prompts.ts`, output schemas in `src/schema.ts`, and PDF/text input parsing in `src/input.ts`. Local port is 8788.
- `e2e/`: Browser tests (`app.e2e.test.ts`) that run against the live stack.
- `dev-server/dev-server`: shell script that starts the whole stack (`./dev-server start`).

Commands:
- Frontend: `bun run start`, `bun run build`, `bun run test` (Vitest via `ng test`).
- main-backend: `bun run dev`, `bun run test` (unit), `bun run test:e2e`, `bun run cf-typegen`.
- flashcard-generator-agent: `bun run dev`, `bun run typecheck`, `bun run test`, `bun run test:smoke`, `bun run types`.

Gotchas:
- The e2e test expects main-backend and flashcard-generator-agent to share local R2 state. Run both with `wrangler dev --persist-to <same dir>`, or generation returns 500.
- `frontend/` has both `package-lock.json` and `pnpm-lock.yaml`. Use `bun` for installs anyway.
