import type { Client } from "pg";

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

export async function upsertDeckRow(
  pg: Client,
  key: string,
  object: Pick<R2Object, "size" | "httpEtag">,
) {
  await pg.query(
    `INSERT INTO public.decks (name, user_id, size, etag)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET size = EXCLUDED.size, etag = EXCLUDED.etag`,
    [key, SYSTEM_USER_ID, object.size, object.httpEtag],
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

  await upsertDeckRow(pg, key, object);
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
