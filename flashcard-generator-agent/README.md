# flashcard-generator-agent

The deck generator of [Remain](../README.md): a Cloudflare [Agents SDK](https://developers.cloudflare.com/agents/) Worker that turns text and files into flashcard decks with an LLM (`anthropic/claude-haiku-5.5` through OpenRouter and a Cloudflare AI gateway). It is not public: [`main-backend`](../main-backend) calls it through a service binding on `POST /api/v1/flashcards/:deckName`.

## Run it

```bash
bun install
bun run dev            # http://localhost:8788 when started by ../dev-server
```

The `AI` binding always runs remotely, so you need to be signed in to Cloudflare with `wrangler`. To let `main-backend` read the decks this Worker writes, both must share local R2 state. Use `../dev-server start` from the repo root, which does that for you.

## What it does

`POST /agents/flashcard-agent/:deckName` takes multipart form data (or JSON) with `text`, `files`, `format` (`json` or `yaml`), `cardCount`, `instructions`, `overwrite` and `refine`. It writes `<deckName>.<format>` to the `remain-decks` R2 bucket and answers `{ key, format, cardCount }`. With `refine`, the model returns only the changes (edits, removals, additions) to an existing deck, which are merged by card position.

- The model never sees or sets card ids, `tool` or timestamps. The code does.
- Large inputs are split: text in 100k character chunks and PDFs in batches of at most 100 pages or 20 MB. Each one is a model call, up to 8 per request, otherwise the request fails with 413. Refining allows a single call.
- PDFs go to the model as files. Other non-text files are converted with Workers AI `toMarkdown`.

## Layout

- `src/index.ts`: routing. `src/agent.ts`: the `FlashcardAgent` Durable Object.
- `src/input.ts`: request parsing and deck (de)serialization. `src/prompts.ts`: prompts. `src/schema.ts`: the stored deck format and the model output schemas. `src/deck.ts`: building and merging decks. `src/pdf.ts`: PDF batching.

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | `wrangler dev` |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | Unit tests (`test/unit`) |
| `bun run test:smoke` | Smoke tests (`test/smoke`). They start `wrangler dev`, and with `SMOKE_LIVE=1` they call the real model |
| `bun run types` | Regenerates the Worker types |
| `bun run deploy` | Deploys the Worker. CI does this on pushes to `main` |

The deck format is copied in three packages (this one, `main-backend` and the frontend). If you change it, change all three together and update the fixtures in `../test-decks/contract/`.

See the [root README](../README.md) for the whole project and [`AGENTS.md`](../AGENTS.md) for the details.
