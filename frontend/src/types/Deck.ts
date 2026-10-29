import { Card } from "./Card";

export type DeckToolKind = 'agent' | 'mcp' | 'manual' | 'upload';

export interface DeckAuthor {
  id: string;
  name: string;
}

// How the deck was originally produced.
export interface DeckTool {
  kind: DeckToolKind;
  model?: string;
  generatedAt?: string;
}

export interface DeckMeta {
  title?: string;
  description?: string;
  language?: string;
  author?: DeckAuthor | null;
  tool?: DeckTool;
  sources?: { name: string }[];
  tags?: string[];
}

// Deck file format v2. Legacy files (a bare array of cards) are upgraded by `normalizeDeck`.
export interface Deck {
  version: 2;
  meta: DeckMeta;
  cards: Card[];
}
