import { ActivityDay, DeckStats, HardCard, StatsOverview } from '../types/Stats';

export const daysAgo = (n: number, now = new Date()) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

export const EMPTY_OVERVIEW: StatsOverview = {
  days: 30,
  answered: 0,
  correct: 0,
  accuracy: null,
  previousAccuracy: null,
  sessions: 0,
  studyMs: 0,
  currentStreak: 0,
  longestStreak: 0,
  studiedCards: 0,
  masteredCards: 0,
  weekdays: [0, 0, 0, 0, 0, 0, 0],
};

export const OVERVIEW: StatsOverview = {
  days: 30,
  answered: 1240,
  correct: 967,
  accuracy: 0.78,
  previousAccuracy: 0.74,
  sessions: 42,
  studyMs: 6 * 3600_000 + 12 * 60_000,
  currentStreak: 9,
  longestStreak: 21,
  studiedCards: 517,
  masteredCards: 212,
  weekdays: [180, 210, 160, 240, 120, 90, 240],
};

export function deck(overrides: Partial<DeckStats> & { deckName: string }): DeckStats {
  return {
    exists: true,
    cardCount: 20,
    answered: 10,
    correct: 8,
    accuracy: 0.8,
    sessions: 2,
    totalSessions: 2,
    lastStudied: daysAgo(1),
    lastSessionAccuracy: 0.8,
    trend: [0.7, 0.8],
    studiedCards: 10,
    masteredCards: 4,
    ...overrides,
  };
}

export const DECKS: DeckStats[] = [
  deck({ deckName: 'linear-modulation.json', accuracy: 0.86, lastStudied: daysAgo(0) }),
  deck({ deckName: 'kubernetes-networking.json', accuracy: 0.44, lastStudied: daysAgo(18) }),
  deck({ deckName: 'fresh.json', answered: 0, correct: 0, accuracy: null, sessions: 0, totalSessions: 0, lastStudied: null, lastSessionAccuracy: null, trend: [], studiedCards: 0, masteredCards: 0 }),
];

export const ACTIVITY: ActivityDay[] = [
  { date: '2026-10-20', answered: 20, correct: 15, sessions: 1 },
  { date: '2026-10-21', answered: 40, correct: 36, sessions: 2 },
];

export const HARDEST: HardCard[] = [
  { deckName: 'kubernetes-networking.json', cardId: 'abc', cardFront: 'What does kube-proxy do?', attempts: 5, correct: 1, accuracy: 0.2 },
];

/** jsdom has no ResizeObserver, which ngx-echarts needs to mount a chart. */
export function stubResizeObserver() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
