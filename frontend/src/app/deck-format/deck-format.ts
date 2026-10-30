import { Card, CardRef, CardRefKind } from '../../types/Card';
import { Deck, DeckToolKind } from '../../types/Deck';

// Frontend copy of the deck format in flashcard-generator-agent/src/schema.ts and
// main-backend/src/lib/deck-format.ts. Keep them in sync: the contract tests in each package read the
// fixtures in test-decks/contract/.

export const REF_KINDS: readonly CardRefKind[] = ['page', 'equation', 'theorem', 'definition', 'figure', 'section', 'other'];
const TOOL_KINDS: readonly DeckToolKind[] = ['agent', 'mcp', 'manual', 'upload'];

/**
 * Deterministic id for a card that has none (FNV-1a over front and back). Study answers recorded
 * before decks stored ids used this, so their stats stay attached to the card.
 */
export function legacyCardId(card: { front: string; back: string }): string {
  let hash = 0x811c9dc5;
  for (const char of `${card.front}\u0000${card.back}`) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** A fresh id for a card created in the editor, like the backend's. Never derived from the card text. */
export function newCardId(): string {
  return `c_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export type DeckFormat = 'json' | 'yaml';

export function formatOfKey(key: string): DeckFormat | null {
  if (/\.json$/i.test(key)) return 'json';
  if (/\.ya?ml$/i.test(key)) return 'yaml';
  return null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

function isRef(value: unknown): value is CardRef {
  return (
    isObject(value) &&
    REF_KINDS.includes(value['kind'] as CardRefKind) &&
    isText(value['label']) &&
    value['label'].length <= 100 &&
    (value['source'] === undefined || isText(value['source']))
  );
}

function isCard(value: unknown): value is Omit<Card, 'id'> & { id?: string } {
  if (!isObject(value) || !isText(value['front']) || !isText(value['back'])) return false;
  if (value['id'] !== undefined && !isText(value['id'])) return false;
  const meta = value['meta'];
  if (meta === undefined) return true;
  return (
    isObject(meta) &&
    (meta['refs'] === undefined || (Array.isArray(meta['refs']) && meta['refs'].every(isRef))) &&
    (meta['tags'] === undefined || isStrings(meta['tags']))
  );
}

function isMeta(value: unknown): value is Deck['meta'] {
  if (!isObject(value)) return false;
  const { title, description, language, author, tool, sources, tags } = value;
  return (
    [title, description, language].every((v) => v === undefined || typeof v === 'string') &&
    (author === undefined || author === null || (isObject(author) && typeof author['id'] === 'string' && typeof author['name'] === 'string')) &&
    (tool === undefined ||
      (isObject(tool) &&
        TOOL_KINDS.includes(tool['kind'] as DeckToolKind) &&
        [tool['model'], tool['generatedAt']].every((v) => v === undefined || typeof v === 'string'))) &&
    (sources === undefined || (Array.isArray(sources) && sources.every((s) => isObject(s) && typeof s['name'] === 'string'))) &&
    (tags === undefined || isStrings(tags))
  );
}

/**
 * Reads a parsed deck file, legacy array or v2, as a v2 deck. Cards without an id get a unique
 * deterministic one, the same the backend gives them when it rewrites the file. Throws when the value
 * is not a deck.
 */
export function normalizeDeck(raw: unknown): Deck {
  let meta: Deck['meta'] = {};
  let cards: unknown;
  if (Array.isArray(raw)) {
    cards = raw;
  } else if (isObject(raw) && raw['version'] === 2) {
    if (raw['meta'] !== undefined && !isMeta(raw['meta'])) throw new Error('Invalid deck metadata');
    meta = (raw['meta'] as Deck['meta'] | undefined) ?? {};
    cards = raw['cards'];
  } else {
    throw new Error('Not a deck');
  }

  if (!Array.isArray(cards) || !cards.every(isCard)) throw new Error('Invalid deck cards');

  const used = new Set(cards.flatMap((card) => (card.id ? [card.id] : [])));
  return {
    version: 2,
    meta,
    cards: cards.map(({ id, front, back, meta }) => {
      if (!id) {
        const base = legacyCardId({ front, back });
        id = base;
        for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
        used.add(id);
      }
      return meta ? { id, front, back, meta } : { id, front, back };
    }),
  };
}
