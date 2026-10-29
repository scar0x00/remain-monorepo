import { DeckAuthor, DeckTool } from "./Deck";

export interface DeckEntry {
  deckName: string,
  size: number,
  uploaded: string,
  etag: string,
  // From the deck file; absent for files that are not .json/.yaml decks or have no title.
  title?: string,
  cardCount?: number,
  author?: DeckAuthor,
  tool?: DeckTool,
  // Study stats, absent until the deck has a completed run.
  studyCount?: number,
  // Average accuracy (0-1) of the last three completed runs.
  recentAccuracy?: number | null,
  lastStudied?: string
}
