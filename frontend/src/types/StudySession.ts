export type StudySessionStatus = 'in_progress' | 'completed' | 'abandoned';

export interface StudySession {
  id: string;
  deckName: string;
  deckEtag: string | null;
  cardTotal: number;
  startedAt: string;
  finishedAt: string | null;
  status: StudySessionStatus;
  right: number;
  wrong: number;
  // null until at least one answer exists.
  accuracy: number | null;
}

export interface StudyAnswer {
  position: number;
  cardId: string;
  cardFront: string;
  correct: boolean;
  durationMs: number;
}
