import { McpServer } from "@modelcontextprotocol/server";
import { Client } from "pg";
import { z } from "zod";
import {
  CardSchema,
  type Card,
  formatOfKey,
  parseDeck,
  serializeDeck,
  type DeckFormat,
} from "./lib/deck-format";
import { deleteDeck, listDecks, putDeck, type DeckStore } from "./lib/decks";
import { type Bindings } from "./types";

const DeckName = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^/\\]+$/, "must not contain slashes")
  .describe("Deck name without extension, e.g. 'spanish-verbs'");

const DeckKey = z
  .string()
  .min(1)
  .describe("Deck file name including extension, as returned by list_decks, e.g. 'spanish-verbs.json'");

const CONTENT_TYPES: Record<DeckFormat, string> = {
  json: "application/json",
  yaml: "application/yaml",
};

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
});

const failure = (message: string) => ({ ...text(message), isError: true });

// Opens a Postgres client for the duration of one tool call, like pgDbMiddleware does for REST routes.
async function withStore<T>(env: Bindings, run: (store: DeckStore) => Promise<T>): Promise<T> {
  const pg = new Client({ connectionString: env.PG.connectionString });
  await pg.connect();
  try {
    return await run({ bucket: env.DECKS, pg });
  } finally {
    await pg.end();
  }
}

async function loadCards(
  bucket: R2Bucket,
  key: string,
): Promise<{ error: string } | { cards: Card[]; format: DeckFormat }> {
  const format = formatOfKey(key);
  if (!format) return { error: `'${key}' is not a .json or .yaml deck` };

  const object = await bucket.get(key);
  if (!object) return { error: `Deck '${key}' not found` };

  const cards = parseDeck(await object.text(), format);
  if (!cards) return { error: `Deck '${key}' is not a valid list of {front, back} cards` };

  return { cards, format };
}

async function saveCards(env: Bindings, key: string, format: DeckFormat, cards: Card[]) {
  return withStore(env, (store) =>
    putDeck(store, key, serializeDeck(cards, format), CONTENT_TYPES[format]),
  );
}

const CardEdit = z
  .object({
    index: z.number().int().min(0).describe("Zero-based position of the card, as shown by read_deck"),
    front: CardSchema.shape.front.optional(),
    back: CardSchema.shape.back.optional(),
  })
  .refine((edit) => edit.front !== undefined || edit.back !== undefined, {
    message: "provide front, back or both",
  });

export function createServer(env: Bindings) {
  const server = new McpServer({ name: "remain", version: "1.0.0" });

  server.registerTool(
    "list_decks",
    {
      description: "List the flashcard decks in Remain, optionally filtered by a name prefix.",
      inputSchema: z.object({
        searchTerm: z.string().optional().describe("Case-insensitive name prefix"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ searchTerm }) => text(await withStore(env, (store) => listDecks(store, searchTerm))),
  );

  server.registerTool(
    "read_deck",
    {
      description: "Read every card of a deck. Each card includes its zero-based index, used by edit_cards.",
      inputSchema: z.object({ key: DeckKey }),
      annotations: { readOnlyHint: true },
    },
    async ({ key }) => {
      const loaded = await loadCards(env.DECKS, key);
      if (!("cards" in loaded)) return failure(loaded.error);
      return text({
        key,
        cardCount: loaded.cards.length,
        cards: loaded.cards.map((card, index) => ({ index, ...card })),
      });
    },
  );

  server.registerTool(
    "create_deck",
    {
      description:
        "Create a new flashcard deck. Fails if a deck with that name and format already exists; use update_deck to change an existing one.",
      inputSchema: z.object({
        name: DeckName,
        cards: z.array(CardSchema).min(1),
        format: z.enum(["json", "yaml"]).default("json"),
      }),
    },
    async ({ name, cards, format }) => {
      const key = `${name}.${format}`;
      if (await env.DECKS.head(key)) return failure(`Deck '${key}' already exists`);

      if (!(await saveCards(env, key, format, cards))) return failure("Upload failed");
      return text({ key, format, cardCount: cards.length });
    },
  );

  server.registerTool(
    "update_deck",
    {
      description:
        "Replace all cards of an existing deck. Read the deck first, then send the complete new card list.",
      inputSchema: z.object({ key: DeckKey, cards: z.array(CardSchema).min(1) }),
      annotations: { idempotentHint: true },
    },
    async ({ key, cards }) => {
      const format = formatOfKey(key);
      if (!format) return failure(`'${key}' is not a .json or .yaml deck`);
      if (!(await env.DECKS.head(key))) return failure(`Deck '${key}' not found`);

      if (!(await saveCards(env, key, format, cards))) return failure("Upload failed");
      return text({ key, format, cardCount: cards.length });
    },
  );

  server.registerTool(
    "add_cards",
    {
      description: "Append cards to the end of an existing deck, keeping the cards already in it.",
      inputSchema: z.object({ key: DeckKey, cards: z.array(CardSchema).min(1) }),
    },
    async ({ key, cards }) => {
      const loaded = await loadCards(env.DECKS, key);
      if (!("cards" in loaded)) return failure(loaded.error);

      const all = [...loaded.cards, ...cards];
      if (!(await saveCards(env, key, loaded.format, all))) return failure("Upload failed");
      return text({
        key,
        added: cards.length,
        cardCount: all.length,
        firstNewIndex: loaded.cards.length,
      });
    },
  );

  server.registerTool(
    "edit_cards",
    {
      description:
        "Change the front and/or back of one or more cards, addressed by the index from read_deck. Fields you omit stay as they are. All edits are applied together or none are.",
      inputSchema: z.object({ key: DeckKey, edits: z.array(CardEdit).min(1) }),
      annotations: { idempotentHint: true },
    },
    async ({ key, edits }) => {
      const loaded = await loadCards(env.DECKS, key);
      if (!("cards" in loaded)) return failure(loaded.error);

      const seen = new Set<number>();
      for (const { index } of edits) {
        if (index >= loaded.cards.length) {
          return failure(`Card index ${index} is out of range: '${key}' has ${loaded.cards.length} cards`);
        }
        if (seen.has(index)) return failure(`Card index ${index} appears more than once`);
        seen.add(index);
      }

      const cards = loaded.cards.map((card, index) => {
        const edit = edits.find((e) => e.index === index);
        return edit ? { front: edit.front ?? card.front, back: edit.back ?? card.back } : card;
      });

      if (!(await saveCards(env, key, loaded.format, cards))) return failure("Upload failed");
      return text({ key, edited: edits.length, cardCount: cards.length });
    },
  );

  server.registerTool(
    "delete_deck",
    {
      description: "Permanently delete a deck.",
      inputSchema: z.object({ key: DeckKey }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ key }) => {
      const deleted = await withStore(env, (store) => deleteDeck(store, key));
      return deleted ? text(`Deleted ${key}`) : failure(`Deck '${key}' not found`);
    },
  );

  return server;
}
