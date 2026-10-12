export interface GenerateDeckRequest {
  deckName: string;
  // null lets the model decide how many cards the deck needs.
  cardCount: number | null;
  overwrite: boolean;
  // True when the message changes the existing deck `deckName` instead of creating a new one.
  refine: boolean;
  text: string;
  files: File[];
}

export interface GenerateDeckResult {
  key: string;
  format: 'json' | 'yaml';
  cardCount: number;
}
