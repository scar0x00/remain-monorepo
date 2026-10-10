export interface GenerateDeckRequest {
  deckName: string;
  cardCount: number;
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
