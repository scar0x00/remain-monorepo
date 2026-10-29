import { McpServer } from "@modelcontextprotocol/server";
import { Client } from "pg";
import { z } from "zod";
import {
  back,
  type Card,
  type CardRef,
  type Deck,
  type DeckFormat,
  formatOfKey,
  front,
  newCardId,
  parseDeck,
  RefSchema,
} from "./lib/deck-format";
import { deleteDeck, listDecks, saveDeck, type DeckStore } from "./lib/decks";
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

const Refs = z
  .array(RefSchema)
  .describe(
    "Page, equation, theorem, definition, figure or section numbers the source material gives for this card. Never shown on the front of the card",
  );

// Cards as the client sends them. Ids, the deck's tool and timestamps are always set by the server.
const NewCard = z.object({ front, back, refs: Refs.optional() });

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

async function loadDeck(
  bucket: R2Bucket,
  key: string,
): Promise<{ error: string } | { deck: Deck; format: DeckFormat }> {
  const format = formatOfKey(key);
  if (!format) return { error: `'${key}' is not a .json or .yaml deck` };

  const object = await bucket.get(key);
  if (!object) return { error: `Deck '${key}' not found` };

  const deck = parseDeck(await object.text(), format);
  if (!deck) return { error: `Deck '${key}' is not a valid deck` };

  return { deck, format };
}

async function storeDeck(env: Bindings, key: string, format: DeckFormat, deck: Deck) {
  return withStore(env, (store) => saveDeck(store, key, format, deck));
}

/** A stored card from the client's fields, keeping the metadata of the card it replaces. */
function toCard(
  id: string,
  { front, back, refs }: { front: string; back: string; refs?: CardRef[] },
  meta?: Card["meta"],
): Card {
  const merged = { ...meta, ...(refs ? { refs } : {}) };
  if (merged.refs?.length === 0) delete merged.refs;
  return Object.keys(merged).length > 0 ? { id, front, back, meta: merged } : { id, front, back };
}

const CardEdit = z
  .object({
    index: z.number().int().min(0).describe("Zero-based position of the card, as shown by read_deck"),
    front: front.optional(),
    back: back.optional(),
    refs: Refs.optional().describe("Replaces the card's references; [] removes them"),
  })
  .refine((edit) => edit.front !== undefined || edit.back !== undefined || edit.refs !== undefined, {
    message: "provide front, back, refs or a combination",
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
      description:
        "Read a deck: its metadata and every card. Each card includes its zero-based index, used by edit_cards, and its id, used by update_deck.",
      inputSchema: z.object({ key: DeckKey }),
      annotations: { readOnlyHint: true },
    },
    async ({ key }) => {
      const loaded = await loadDeck(env.DECKS, key);
      if (!("deck" in loaded)) return failure(loaded.error);
      const { meta, cards } = loaded.deck;
      return text({
        key,
        meta,
        cardCount: cards.length,
        cards: cards.map(({ id, front, back, meta }, index) => ({
          index,
          id,
          front,
          back,
          ...(meta?.refs ? { refs: meta.refs } : {}),
        })),
      });
    },
  );

  server.registerTool(
    "create_deck",
    {
      description:
        "Create a new flashcard deck. Fails if a deck with that name and format already exists; use update_deck to change an existing one. Card ids are assigned by Remain.",
      inputSchema: z.object({
        name: DeckName,
        cards: z.array(NewCard).min(1),
        format: z.enum(["json", "yaml"]).default("json"),
        title: z.string().optional().describe("Human readable deck title"),
        description: z.string().optional().describe("One sentence on what the deck covers"),
        language: z.string().optional().describe("BCP 47 language code of the cards, e.g. 'es'"),
        tags: z.array(z.string()).optional(),
      }),
    },
    async ({ name, cards, format, title, description, language, tags }) => {
      const key = `${name}.${format}`;
      if (await env.DECKS.head(key)) return failure(`Deck '${key}' already exists`);

      const deck: Deck = {
        version: 2,
        meta: {
          ...(title ? { title } : {}),
          ...(description ? { description } : {}),
          ...(language ? { language } : {}),
          author: null,
          tool: { kind: "mcp", generatedAt: new Date().toISOString() },
          ...(tags?.length ? { tags } : {}),
        },
        cards: cards.map((card) => toCard(newCardId(), card)),
      };
      if (!(await storeDeck(env, key, format, deck))) return failure("Upload failed");
      return text({ key, format, cardCount: cards.length });
    },
  );

  server.registerTool(
    "update_deck",
    {
      description:
        "Replace all cards of an existing deck. Read the deck first, then send the complete new card list. Send each card you keep or change with its id from read_deck, so its study history is kept; leave id out for new cards and never make one up. Cards you leave out are removed.",
      inputSchema: z.object({
        key: DeckKey,
        cards: z
          .array(
            NewCard.extend({
              id: z.string().min(1).optional().describe("Id of the existing card, from read_deck. Omit for new cards"),
            }),
          )
          .min(1),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ key, cards }) => {
      const loaded = await loadDeck(env.DECKS, key);
      if (!("deck" in loaded)) return failure(loaded.error);

      const existing = new Map(loaded.deck.cards.map((card) => [card.id, card]));
      const seen = new Set<string>();
      for (const { id } of cards) {
        if (id === undefined) continue;
        if (!existing.has(id)) return failure(`Card id '${id}' is not in '${key}'. Omit the id for new cards`);
        if (seen.has(id)) return failure(`Card id '${id}' appears more than once`);
        seen.add(id);
      }

      const deck: Deck = {
        ...loaded.deck,
        cards: cards.map(({ id, ...card }) =>
          id ? toCard(id, card, existing.get(id)!.meta) : toCard(newCardId(), card),
        ),
      };
      if (!(await storeDeck(env, key, loaded.format, deck))) return failure("Upload failed");
      return text({ key, format: loaded.format, cardCount: cards.length });
    },
  );

  server.registerTool(
    "add_cards",
    {
      description: "Append cards to the end of an existing deck, keeping the cards already in it. Card ids are assigned by Remain.",
      inputSchema: z.object({ key: DeckKey, cards: z.array(NewCard).min(1) }),
    },
    async ({ key, cards }) => {
      const loaded = await loadDeck(env.DECKS, key);
      if (!("deck" in loaded)) return failure(loaded.error);

      const added = cards.map((card) => toCard(newCardId(), card));
      const deck: Deck = { ...loaded.deck, cards: [...loaded.deck.cards, ...added] };
      if (!(await storeDeck(env, key, loaded.format, deck))) return failure("Upload failed");
      return text({
        key,
        added: added.length,
        cardCount: deck.cards.length,
        firstNewIndex: loaded.deck.cards.length,
        ids: added.map((card) => card.id),
      });
    },
  );

  server.registerTool(
    "edit_cards",
    {
      description:
        "Change the front, back and/or references of one or more cards, addressed by the index from read_deck. Fields you omit stay as they are. All edits are applied together or none are.",
      inputSchema: z.object({ key: DeckKey, edits: z.array(CardEdit).min(1) }),
      annotations: { idempotentHint: true },
    },
    async ({ key, edits }) => {
      const loaded = await loadDeck(env.DECKS, key);
      if (!("deck" in loaded)) return failure(loaded.error);
      const current = loaded.deck.cards;

      const seen = new Set<number>();
      for (const { index } of edits) {
        if (index >= current.length) {
          return failure(`Card index ${index} is out of range: '${key}' has ${current.length} cards`);
        }
        if (seen.has(index)) return failure(`Card index ${index} appears more than once`);
        seen.add(index);
      }

      const cards = current.map((card, index) => {
        const edit = edits.find((e) => e.index === index);
        if (!edit) return card;
        return toCard(card.id, { front: edit.front ?? card.front, back: edit.back ?? card.back, refs: edit.refs }, card.meta);
      });

      if (!(await storeDeck(env, key, loaded.format, { ...loaded.deck, cards }))) return failure("Upload failed");
      return text({ key, edited: edits.length, cardCount: cards.length });
    },
  );

  server.registerTool(
    "update_deck_meta",
    {
      description:
        "Change a deck's title, description, language and/or tags. Fields you omit stay as they are; send null to remove a title, description or language, and a list to replace the tags. How the deck was made (tool, author, timestamps) and its cards cannot be changed here.",
      inputSchema: z
        .object({
          key: DeckKey,
          title: z.string().min(1).nullable().optional(),
          description: z.string().min(1).nullable().optional(),
          language: z.string().min(1).nullable().optional().describe("BCP 47 language code of the cards, e.g. 'es'"),
          tags: z.array(z.string()).optional(),
        })
        .refine((edit) => [edit.title, edit.description, edit.language, edit.tags].some((value) => value !== undefined), {
          message: "provide title, description, language, tags or a combination",
        }),
      annotations: { idempotentHint: true },
    },
    async ({ key, title, description, language, tags }) => {
      const loaded = await loadDeck(env.DECKS, key);
      if (!("deck" in loaded)) return failure(loaded.error);

      const { title: oldTitle, description: oldDescription, language: oldLanguage, tags: oldTags, ...rest } = loaded.deck.meta;
      // undefined keeps the current value, null removes it.
      const pick = <T>(next: T | null | undefined, old: T | undefined) => (next === undefined ? old : (next ?? undefined));
      const newTags = tags === undefined ? oldTags : tags.length > 0 ? tags : undefined;
      const meta = Object.fromEntries(
        Object.entries({
          title: pick(title, oldTitle),
          description: pick(description, oldDescription),
          language: pick(language, oldLanguage),
          ...rest,
          tags: newTags,
        }).filter(([, value]) => value !== undefined),
      );

      if (!(await storeDeck(env, key, loaded.format, { ...loaded.deck, meta }))) return failure("Upload failed");
      return text({ key, meta });
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
