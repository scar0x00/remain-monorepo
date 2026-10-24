import type { Client } from "pg";
import { formatOfKey, parseDeck } from "./deck-format";

export const SYSTEM_USER_ID = "system";

export type DeckStore = { bucket: R2Bucket; pg: Client };

type DeckRow = {
  name: string;
  size: string;
  createdAt: Date;
  etag: string;
};

export type DeckEntry = {
  deckName: string;
  size: number;
  uploaded: Date;
  etag: string;
};

export async function listDecks(
  { pg }: DeckStore,
  searchTerm = "",
): Promise<DeckEntry[]> {
  const { rows } = await pg.query<DeckRow>(
    `SELECT name, size, "createdAt", etag
     FROM public.decks
     WHERE name ILIKE $1
     ORDER BY name`,
    [`${searchTerm}%`],
  );

  return rows.map((row) => ({
    deckName: row.name,
    size: Number(row.size),
    uploaded: row.createdAt,
    etag: row.etag,
  }));
}

/** Number of cards in a deck file, or null when it is not a valid .json/.yaml deck. */
export function countCards(key: string, body: ArrayBuffer | string): number | null {
  const format = formatOfKey(key);
  if (!format) return null;

  const text = typeof body === "string" ? body : new TextDecoder().decode(body);
  return parseDeck(text, format)?.length ?? null;
}

export async function upsertDeckRow(
  pg: Client,
  key: string,
  object: Pick<R2Object, "size" | "httpEtag">,
  cardCount: number | null,
) {
  await pg.query(
    `INSERT INTO public.decks (name, user_id, size, etag, card_count)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (name) DO UPDATE SET size = EXCLUDED.size, etag = EXCLUDED.etag, card_count = EXCLUDED.card_count`,
    [key, SYSTEM_USER_ID, object.size, object.httpEtag, cardCount],
  );
}

/** Writes the deck file to R2 and records it in Postgres. Returns null when R2 rejects the write. */
export async function putDeck(
  { bucket, pg }: DeckStore,
  key: string,
  body: ArrayBuffer | string,
  contentType?: string,
) {
  const object = await bucket.put(key, body, {
    httpMetadata: { contentType },
  });

  if (!object) return null;

  await upsertDeckRow(pg, key, object, countCards(key, body));
  return object;
}

/** Returns false when the deck does not exist. */
export async function deleteDeck({ bucket, pg }: DeckStore, key: string) {
  const existing = await bucket.head(key);
  if (!existing) return false;

  await bucket.delete(key);
  await pg.query(`DELETE FROM public.decks WHERE name = $1`, [key]);
  return true;
}

/**
 * Fills in `card_count` for decks stored before the column existed, by reading their files from R2.
 * Bounded per call so a request never reads many files; the rest are filled on later calls.
 */
export async function backfillCardCounts({ bucket, pg }: DeckStore, limit = 10) {
  const { rows } = await pg.query<{ name: string }>(
    `SELECT name FROM public.decks WHERE card_count IS NULL AND name ~* '\\.(json|ya?ml)$' LIMIT $1`,
    [limit],
  );

  for (const { name } of rows) {
    const object = await bucket.get(name);
    if (!object) continue;
    const cardCount = countCards(name, await object.text());
    if (cardCount !== null) {
      await pg.query(`UPDATE public.decks SET card_count = $2 WHERE name = $1`, [name, cardCount]);
    }
  }
}
