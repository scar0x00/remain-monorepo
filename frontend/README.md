# frontend

The web app of [Remain](../README.md): an [Angular](https://angular.dev) single-page app for generating, uploading, browsing, studying and editing flashcard decks, and for viewing study stats. It talks only to [`main-backend`](../main-backend) under `/api/v1/*`. In production it is deployed as a Worker that serves the built files.

## Run it

```bash
bun install
bun run start          # http://localhost:4200
```

`proxy.conf.json` forwards `/api/**` to `http://localhost:8787`, so `main-backend` has to be running too. `../dev-server start` from the repo root starts the whole stack. Angular CLI commands run on Node.js (CI uses 24).

## Layout

Everything is under `src/app/`, one folder per route or component. The routes are in `app.routes.ts`:

| Path | Folder |
|---|---|
| `/` | `landing-route/` |
| `/flashcard-chat` | `flashcard-chat-route/`: generate or refine a deck in a chat |
| `/deck-upload` | `deck-upload-route/` |
| `/deck-browse` | `browse-decks-route/` |
| `/deck-study/:id` | `deck-study-route/`, with `study-controller/` and `card-quick-edit/` |
| `/deck-edit/:name` | `deck-edit-route/` (lazy): the deck editor, built on `deck-editor/`, `card-editor/` and `deck-meta-editor/` |
| `/dashboard`, `/dashboard/decks/:name` | `dashboard-route/` and `deck-stats-route/` (lazy): charts with ECharts, data from `stats/` |

Shared types are in `src/types/`. `src/app/deck-format/` is the frontend copy of the deck format, which also exists in `main-backend` and the agent. If you change it, change all three together and update `../test-decks/contract/`.

Usage analytics (PostHog) are loaded only in production builds, which carry the token from `src/environments/environment.production.ts`. Dev, tests and e2e send nothing.

## Scripts

| Command | What it does |
|---|---|
| `bun run start` | `ng serve` on port 4200 |
| `bun run dev-host` | Same, reachable from other devices on the network |
| `bun run build` | Production build into `dist/frontend/browser` |
| `bun run watch` | Development build that rebuilds on change |
| `bun run test` | Unit tests (Vitest, through `ng test`) |

There are lockfiles for bun, npm and pnpm. Use `bun`, as the rest of the repo does. Browser tests that drive the whole stack are in [`../e2e`](../e2e).

See the [root README](../README.md) for the whole project and [`AGENTS.md`](../AGENTS.md) for the details.
