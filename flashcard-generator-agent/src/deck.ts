import { newCardId, type Card, type Deck, type DeckMeta, type ModelCard, type RefineOutput } from "./schema";

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

/** The model's changes do not fit the deck, e.g. a position that does not exist. */
export class RefineError extends Error {}

/**
 * Applies the model's changes to the current deck. Edits and removals address cards by position in
 * `current`. Untouched cards, and the id and metadata of edited ones, never pass through the model.
 * Refs are replaced only when the edit sends them. Deck metadata is kept, and the names of new
 * sources are added to it. Throws `RefineError` when a position is out of range or used twice.
 */
export function mergeRefinedDeck(current: Deck, changes: RefineOutput, newSources: string[] = []): Deck {
  const touched = new Set<number>();
  for (const index of [...changes.edits.map((edit) => edit.index), ...changes.remove]) {
    if (index >= current.cards.length) {
      throw new RefineError(`Card ${index} does not exist: the deck has ${current.cards.length} cards`);
    }
    if (touched.has(index)) throw new RefineError(`Card ${index} is changed more than once`);
    touched.add(index);
  }

  const edits = new Map(changes.edits.map((edit) => [edit.index, edit]));
  const removed = new Set(changes.remove);
  const cards = current.cards.flatMap((card, index) => {
    if (removed.has(index)) return [];
    const edit = edits.get(index);
    if (!edit) return [card];
    return [toCard({ front: edit.front ?? card.front, back: edit.back ?? card.back, refs: edit.refs }, card.id, card.meta)];
  });
  cards.push(...changes.add.map((card) => toCard(card, newCardId())));

  const known = new Set(current.meta.sources?.map((source) => source.name));
  const added = newSources.filter((name) => !known.has(name)).map((name) => ({ name }));

  return {
    version: 2,
    meta: added.length > 0 ? { ...current.meta, sources: [...(current.meta.sources ?? []), ...added] } : current.meta,
    cards,
  };
}
