import { newCardId, type Card, type Deck, type DeckMeta, type ModelCard, type RefinedCard } from "./schema";

function toCard({ front, back, refs }: ModelCard, id: string, meta?: Card["meta"]): Card {
  const merged = { ...meta, ...(refs ? { refs } : {}) };
  if (merged.refs?.length === 0) delete merged.refs;
  return Object.keys(merged).length > 0 ? { id, front, back, meta: merged } : { id, front, back };
}

/** Builds a new deck from the model's cards. The agent, not the model, assigns ids and the tool info. */
export function buildDeck(options: {
  cards: ModelCard[];
  title?: string;
  description?: string;
  language?: string;
  model: string;
  sources: string[];
  now?: Date;
}): Deck {
  const meta: DeckMeta = {
    title: options.title,
    description: options.description,
    language: options.language,
    author: null,
    tool: { kind: "agent", model: options.model, generatedAt: (options.now ?? new Date()).toISOString() },
    sources: options.sources.map((name) => ({ name })),
  };

  return {
    version: 2,
    meta: Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined)),
    cards: options.cards.map((card) => toCard(card, newCardId())),
  };
}

/**
 * Applies the model's revised card list to the current deck. A card whose id matches a card of the
 * current deck keeps that id and its metadata (refs are replaced only when the model sends them).
 * Cards with no id, an unknown id or an id already used get a new id. Deck metadata is kept, and
 * the names of new sources are added to it.
 */
export function mergeRefinedDeck(current: Deck, revised: RefinedCard[], newSources: string[] = []): Deck {
  const existing = new Map(current.cards.map((card) => [card.id, card]));
  const used = new Set<string>();

  const cards = revised.map(({ id, ...card }) => {
    const previous = id && !used.has(id) ? existing.get(id) : undefined;
    if (!previous) return toCard(card, newCardId());
    used.add(previous.id);
    return toCard(card, previous.id, previous.meta);
  });

  const known = new Set(current.meta.sources?.map((source) => source.name));
  const added = newSources.filter((name) => !known.has(name)).map((name) => ({ name }));

  return {
    version: 2,
    meta: added.length > 0 ? { ...current.meta, sources: [...(current.meta.sources ?? []), ...added] } : current.meta,
    cards,
  };
}
