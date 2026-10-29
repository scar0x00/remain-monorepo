// Mirrors main-backend/src/lib/stats.ts. Accuracies are 0-1, null when nothing was answered.

export interface StatsOverview {
  days: number;
  answered: number;
  correct: number;
  accuracy: number | null;
  // Accuracy over the window of the same length just before this one.
  previousAccuracy: number | null;
  sessions: number;
  studyMs: number;
  // Streaks are all-time, independent of the window.
  currentStreak: number;
  longestStreak: number;
  studiedCards: number;
  masteredCards: number;
  // Cards answered per weekday, Monday first.
  weekdays: number[];
}

export interface ActivityDay {
  date: string; // YYYY-MM-DD, local to the requested time zone
  answered: number;
  correct: number;
  sessions: number;
}

export interface DeckStats {
  deckName: string;
  // False when the deck file was deleted but its study history remains.
  exists: boolean;
  cardCount: number | null;
  // Inside the selected window.
  answered: number;
  correct: number;
  accuracy: number | null;
  sessions: number;
  // All-time.
  totalSessions: number;
  lastStudied: string | null;
  lastSessionAccuracy: number | null;
  // Accuracy of the last 10 sessions, oldest first.
  trend: number[];
  studiedCards: number;
  masteredCards: number;
}

export interface HardCard {
  deckName: string;
  cardId: string;
  cardFront: string | null;
  attempts: number;
  correct: number;
  accuracy: number;
}

export interface SessionSummary {
  id: string;
  startedAt: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  answered: number;
  correct: number;
  accuracy: number | null;
  studyMs: number;
}

export interface DeckStatsDetail extends DeckStats {
  // Newest first.
  recentSessions: SessionSummary[];
  hardestCards: HardCard[];
}
