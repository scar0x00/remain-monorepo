export interface DeckEntry {
  deckName: string,
  size: number,
  uploaded: string,
  etag: string,
  // Study stats, absent until the deck has a completed run.
  studyCount?: number,
  // Average accuracy (0-1) of the last three completed runs.
  recentAccuracy?: number | null,
  lastStudied?: string
}
