import type { Client } from "pg";
import { formatOfKey, parseDeck, serializeDeck, type Deck, type DeckFormat, type DeckMeta } from "./deck-format";
import { DECK_STUDY_STATS_SQL, type DeckStudyStats } from "./study-sessions";
import { type DeckBucket } from "./user-bucket";

/**
 * One user's decks: `bucket` is scoped to the user (see `userBucket`) and every query filters on
 * `userId`, so nothing here can read or change another user's deck.
 */
export type DeckStore = { bucket: DeckBucket; pg: Client; userId: string };

const CONTENT_TYPES: Record<DeckFormat, string> = {
  json: "application/json",
  yaml: "application/yaml",
};

type DeckRow = {
  name: string;
  size: string;
  createdAt: Date;
  etag: string;
  card_count: number | null;
  title: string | null;
  meta: DeckMeta | null;
};

export type DeckEntry = {
  deckName: string;
  size: number;
  uploaded: Date;
  etag: string;
  // From the deck file; absent for files that are not .json/.yaml decks.
  title?: string;
  cardCount?: number;
  author?: NonNullable<DeckMeta["author"]>;
  tool?: NonNullable<DeckMeta["tool"]>;
};

/** What the decks row keeps from a deck file. */
export type DeckSummary = { cardCount: number; title: string | null; meta: DeckMeta };

export async function listDecks(
  { pg, userId }: DeckStore,
  searchTerm = "",
): Promise<DeckEntry[]> {
  const { rows } = await pg.query<DeckRow>(
    `SELECT name, size, "createdAt", etag, card_count, title, meta
     FROM public.decks
     WHERE user_id = $2 AND (name ILIKE $1 OR title ILIKE $1)
     ORDER BY name`,
    [`${searchTerm}%`, userId],
  );

  return rows.map(toDeckEntry);
}

function toDeckEntry(row: DeckRow): DeckEntry {
  return {
    deckName: row.name,
    size: Number(row.size),
    uploaded: row.createdAt,
    etag: row.etag,
    ...(row.title ? { title: row.title } : {}),
    ...(row.card_count !== null ? { cardCount: row.card_count } : {}),
    ...(row.meta?.author ? { author: row.meta.author } : {}),
    ...(row.meta?.tool ? { tool: row.meta.tool } : {}),
  };
}

export const DECK_SORTS = ["name", "created", "success"] as const;
export type DeckSort = (typeof DECK_SORTS)[number];
export type SortOrder = "asc" | "desc";

/** The order each sort uses when the request doesn't say: A to Z, newest first, best first. */
export const DEFAULT_ORDER: Record<DeckSort, SortOrder> = { name: "asc", created: "desc", success: "desc" };
export const DECK_PAGE_SIZE = 10;
export const MAX_DECK_PAGE_SIZE = 50;

export type DeckPageQuery = {
  searchTerm?: string;
  sort?: DeckSort;
  order?: SortOrder;
  /** One-based. */
  page?: number;
  pageSize?: number;
};

/** A deck in the browse list: its entry plus its study stats, which are absent until a completed run. */
export type BrowsedDeck = DeckEntry & Partial<DeckStudyStats>;

export type DeckPage = {
  decks: BrowsedDeck[];
  /** Decks that match the search, over all pages. */
  total: number;
  page: number;
  pageSize: number;
  sort: DeckSort;
  order: SortOrder;
};

// Column per sort. Only these strings ever reach the SQL; the request picks a key.
const SORT_SQL: Record<DeckSort, string> = {
  name: "lower(d.name)",
  created: `d."createdAt"`,
  // Recent accuracy, as shown on the deck card. Decks never studied have none.
  success: "st.recent_accuracy",
};

/**
 * One page of the user's decks matching `searchTerm` (a prefix of the name or title), with their
 * study stats. Decks without a value for the sort (never studied, for `success`) always come last,
 * and ties go by name.
 */
export async function listDeckPage({ pg, userId }: DeckStore, query: DeckPageQuery = {}): Promise<DeckPage> {
  const sort = query.sort ?? "name";
  const order = query.order ?? DEFAULT_ORDER[sort];
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(MAX_DECK_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize ?? DECK_PAGE_SIZE)));
  const direction = order === "asc" ? "ASC" : "DESC";
  const pattern = `${query.searchTerm ?? ""}%`;

  const { rows } = await pg.query<
    DeckRow & { study_count: string | null; recent_accuracy: number | null; last_studied: Date | null; total: string }
  >(
    `SELECT d.name, d.size, d."createdAt", d.etag, d.card_count, d.title, d.meta,
       st.study_count, st.recent_accuracy, st.last_studied,
       COUNT(*) OVER () AS total
     FROM public.decks d
     LEFT JOIN (${DECK_STUDY_STATS_SQL}) st ON st.deck_name = d.name
     WHERE d.user_id = $1 AND (d.name ILIKE $2 OR d.title ILIKE $2)
     ORDER BY ${SORT_SQL[sort]} ${direction} NULLS LAST, lower(d.name), d.name
     LIMIT $3 OFFSET $4`,
    [userId, pattern, pageSize, (page - 1) * pageSize],
  );

  // A page past the end has no rows to carry the total, so count separately.
  const total = rows.length
    ? Number(rows[0].total)
    : page > 1
      ? await countDecks(pg, userId, pattern)
      : 0;

  return {
    decks: rows.map((row) => ({
      ...toDeckEntry(row),
      ...(row.study_count !== null
        ? { studyCount: Number(row.study_count), recentAccuracy: row.recent_accuracy, lastStudied: row.last_studied! }
        : {}),
    })),
    total,
    page,
    pageSize,
    sort,
    order,
  };
}

async function countDecks(pg: Client, userId: string, pattern: string) {
  const { rows } = await pg.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM public.decks WHERE user_id = $1 AND (name ILIKE $2 OR title ILIKE $2)`,
    [userId, pattern],
  );
  return Number(rows[0].count);
}

export function summarizeDeck(deck: Deck): DeckSummary {
  return { cardCount: deck.cards.length, title: deck.meta.title ?? null, meta: deck.meta };
}

/** Summary of a deck file, or null when it is not a valid .json/.yaml deck. */
export function summarizeDeckFile(key: string, body: ArrayBuffer | string): DeckSummary | null {
  const format = formatOfKey(key);
  if (!format) return null;

  const text = typeof body === "string" ? body : new TextDecoder().decode(body);
  const deck = parseDeck(text, format);
  return deck ? summarizeDeck(deck) : null;
}

export async function upsertDeckRow(
  pg: Client,
  userId: string,
  key: string,
  object: Pick<R2Object, "size" | "httpEtag">,
  summary: DeckSummary | null,
) {
  await pg.query(
    `INSERT INTO public.decks (name, user_id, size, etag, card_count, title, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, name) DO UPDATE SET size = EXCLUDED.size, etag = EXCLUDED.etag,
       card_count = EXCLUDED.card_count, title = EXCLUDED.title, meta = EXCLUDED.meta`,
    [
      key,
      userId,
      object.size,
      object.httpEtag,
      summary?.cardCount ?? null,
      summary?.title ?? null,
      summary ? JSON.stringify(summary.meta) : null,
    ],
  );
}

/** Only write when the stored object still matches, e.g. the request's `If-Match` header. */
export type WriteCondition = { onlyIf?: R2Conditional | Headers };

/**
 * Writes a file to R2 as is and records it in Postgres. Returns null when R2 rejects the write,
 * which includes a failed `onlyIf` condition.
 */
export async function putDeck(
  { bucket, pg, userId }: DeckStore,
  key: string,
  body: ArrayBuffer | string,
  contentType?: string,
  { onlyIf }: WriteCondition = {},
) {
  const object = await bucket.put(key, body, {
    httpMetadata: { contentType },
    onlyIf,
  });

  if (!object) return null;

  await upsertDeckRow(pg, userId, key, object, summarizeDeckFile(key, body));
  return object;
}

/**
 * Writes a deck in the v2 format of its key's extension. Returns null when R2 rejects the write,
 * which includes a failed `onlyIf` condition.
 */
export async function saveDeck(
  { bucket, pg, userId }: DeckStore,
  key: string,
  format: DeckFormat,
  deck: Deck,
  { onlyIf }: WriteCondition = {},
) {
  const object = await bucket.put(key, serializeDeck(deck, format), {
    httpMetadata: { contentType: CONTENT_TYPES[format] },
    onlyIf,
  });

  if (!object) return null;

  await upsertDeckRow(pg, userId, key, object, summarizeDeck(deck));
  return object;
}

/** Returns false when the deck does not exist. */
export async function deleteDeck({ bucket, pg, userId }: DeckStore, key: string) {
  const existing = await bucket.head(key);
  if (!existing) return false;

  await bucket.delete(key);
  await pg.query(`DELETE FROM public.decks WHERE user_id = $2 AND name = $1`, [key, userId]);
  return true;
}

/**
 * Fills in `card_count`, `title` and `meta` for decks stored before the columns existed, by reading
 * their files from R2. Bounded per call so a request never reads many files; the rest are filled on
 * later calls.
 */
export async function backfillDeckRows({ bucket, pg, userId }: DeckStore, limit = 10) {
  const { rows } = await pg.query<{ name: string }>(
    `SELECT name FROM public.decks
     WHERE user_id = $2 AND (card_count IS NULL OR meta IS NULL) AND name ~* '\\.(json|ya?ml)$' LIMIT $1`,
    [limit, userId],
  );

  for (const { name } of rows) {
    const object = await bucket.get(name);
    if (!object) continue;
    const summary = summarizeDeckFile(name, await object.text());
    if (summary) {
      await pg.query(`UPDATE public.decks SET card_count = $2, title = $3, meta = $4 WHERE user_id = $5 AND name = $1`, [
        name,
        summary.cardCount,
        summary.title,
        JSON.stringify(summary.meta),
        userId,
      ]);
    }
  }
}
