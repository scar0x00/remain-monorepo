import type { Client } from "pg";
import { ABANDONED_AFTER_MS, type SessionStatus } from "./study-sessions";

/** Per-answer cap for study time, so a card left open in an idle tab doesn't inflate it. */
export const MAX_ANSWER_MS = 60 * 1000;
/** A card is mastered when its last MASTERED_STREAK answers are all correct. */
export const MASTERED_STREAK = 3;
/** Cards need this many attempts before they can show up as hardest. */
export const HARDEST_MIN_ATTEMPTS = 3;
const TREND_SESSIONS = 10;

export type StatsRange = {
  /** Number of local days in the window, today included. */
  days: number;
  /** IANA time zone the day buckets are computed in. */
  tz: string;
};

/** Returns `tz` when the runtime knows it, otherwise UTC (Postgres would reject an unknown name). */
export function parseTimeZone(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function parseDays(value: string | undefined, fallback: number, max = 366): number {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 ? Math.min(days, max) : fallback;
}

// Start of the window: local midnight `days - 1` days ago, as a timestamptz. $2 = tz, $3 = days.
const WINDOW_START = `((date_trunc('day', now() AT TIME ZONE $2) - make_interval(days => $3 - 1)) AT TIME ZONE $2)`;
const LOCAL_DAY = `(a.answered_at AT TIME ZONE $2)::date`;
const USER_ANSWERS = `
  FROM public.study_answers a
  JOIN public.study_sessions s ON s.id = a.session_id
  WHERE s.user_id = $1`;

const ratio = (correct: number, answered: number) => (answered > 0 ? correct / answered : null);

export type Overview = {
  days: number;
  answered: number;
  correct: number;
  accuracy: number | null;
  /** Accuracy over the window of the same length just before this one. */
  previousAccuracy: number | null;
  sessions: number;
  studyMs: number;
  /** Streaks are all-time, independent of the window. */
  currentStreak: number;
  longestStreak: number;
  studiedCards: number;
  masteredCards: number;
  /** Cards answered per ISO weekday in the window, Monday first. */
  weekdays: number[];
};

export async function getOverview(pg: Client, userId: string, { days, tz }: StatsRange): Promise<Overview> {
  const totals = await pg.query<{
    answered: string;
    correct: string;
    prev_answered: string;
    prev_correct: string;
    sessions: string;
    study_ms: string;
  }>(
    `WITH w AS (SELECT ${WINDOW_START} AS start)
     SELECT
       COUNT(*) FILTER (WHERE a.answered_at >= w.start) AS answered,
       COUNT(*) FILTER (WHERE a.answered_at >= w.start AND a.correct) AS correct,
       COUNT(*) FILTER (WHERE a.answered_at < w.start) AS prev_answered,
       COUNT(*) FILTER (WHERE a.answered_at < w.start AND a.correct) AS prev_correct,
       COUNT(DISTINCT a.session_id) FILTER (WHERE a.answered_at >= w.start) AS sessions,
       COALESCE(SUM(LEAST(COALESCE(a.duration_ms, 0), $4)) FILTER (WHERE a.answered_at >= w.start), 0) AS study_ms
     FROM public.study_answers a
     JOIN public.study_sessions s ON s.id = a.session_id
     CROSS JOIN w
     WHERE s.user_id = $1 AND a.answered_at >= w.start - make_interval(days => $3)`,
    [userId, tz, days, MAX_ANSWER_MS],
  );

  const weekdayRows = await pg.query<{ dow: number; answered: string }>(
    `SELECT EXTRACT(ISODOW FROM a.answered_at AT TIME ZONE $2)::int AS dow, COUNT(*) AS answered
     ${USER_ANSWERS} AND a.answered_at >= ${WINDOW_START}
     GROUP BY dow`,
    [userId, tz, days],
  );

  const dayRows = await pg.query<{ day: string; today: string }>(
    `SELECT DISTINCT to_char(${LOCAL_DAY}, 'YYYY-MM-DD') AS day,
       to_char((now() AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS today
     ${USER_ANSWERS}
     ORDER BY day`,
    [userId, tz],
  );

  const mastery = await masteryByDeck(pg, userId);
  const t = totals.rows[0]!;
  const weekdays = Array.from({ length: 7 }, () => 0);
  for (const row of weekdayRows.rows) weekdays[row.dow - 1] = Number(row.answered);

  const answered = Number(t.answered);
  const correct = Number(t.correct);
  const today = dayRows.rows[0]?.today;

  return {
    days,
    answered,
    correct,
    accuracy: ratio(correct, answered),
    previousAccuracy: ratio(Number(t.prev_correct), Number(t.prev_answered)),
    sessions: Number(t.sessions),
    studyMs: Number(t.study_ms),
    ...streaks(dayRows.rows.map((r) => r.day), today),
    studiedCards: [...mastery.values()].reduce((sum, m) => sum + m.studied, 0),
    masteredCards: [...mastery.values()].reduce((sum, m) => sum + m.mastered, 0),
    weekdays,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

/**
 * Current and longest run of consecutive days with at least one answer. `days` are sorted local
 * dates (YYYY-MM-DD). The current streak survives until today is over, so it counts from today or
 * yesterday.
 */
export function streaks(days: string[], today: string | undefined) {
  let longest = 0;
  let run = 0;
  let prev: number | null = null;

  for (const day of days) {
    const n = dayNumber(day);
    run = prev !== null && n === prev + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = n;
  }

  const current = prev !== null && today !== undefined && dayNumber(today) - prev <= 1 ? run : 0;
  return { currentStreak: current, longestStreak: longest };
}

export type ActivityDay = { date: string; answered: number; correct: number; sessions: number };

/** Days in the window with at least one answer, oldest first. Days without answers are omitted. */
export async function getActivity(pg: Client, userId: string, { days, tz }: StatsRange): Promise<ActivityDay[]> {
  const { rows } = await pg.query<{ date: string; answered: string; correct: string; sessions: string }>(
    `SELECT to_char(${LOCAL_DAY}, 'YYYY-MM-DD') AS date,
       COUNT(*) AS answered,
       COUNT(*) FILTER (WHERE a.correct) AS correct,
       COUNT(DISTINCT a.session_id) AS sessions
     ${USER_ANSWERS} AND a.answered_at >= ${WINDOW_START}
     GROUP BY date
     ORDER BY date`,
    [userId, tz, days],
  );

  return rows.map((r) => ({
    date: r.date,
    answered: Number(r.answered),
    correct: Number(r.correct),
    sessions: Number(r.sessions),
  }));
}

/** Studied and mastered card counts per deck, over all answers ever given. */
async function masteryByDeck(pg: Client, userId: string, deckName?: string) {
  const { rows } = await pg.query<{ deck_name: string; studied: string; mastered: string }>(
    `WITH ranked AS (
       SELECT s.deck_name, a.card_id, a.correct,
         ROW_NUMBER() OVER (PARTITION BY s.deck_name, a.card_id ORDER BY a.answered_at DESC, a.position DESC) AS rn
       ${USER_ANSWERS} AND ($2::text IS NULL OR s.deck_name = $2)
     ),
     cards AS (
       SELECT deck_name, COUNT(*) FILTER (WHERE rn <= $3 AND correct) = $3 AS mastered
       FROM ranked
       GROUP BY deck_name, card_id
     )
     SELECT deck_name, COUNT(*) AS studied, COUNT(*) FILTER (WHERE mastered) AS mastered
     FROM cards
     GROUP BY deck_name`,
    [userId, deckName ?? null, MASTERED_STREAK],
  );

  return new Map(
    rows.map((r) => [r.deck_name, { studied: Number(r.studied), mastered: Number(r.mastered) }]),
  );
}

export type DeckStats = {
  deckName: string;
  /** False when the deck file was deleted but its study history remains. */
  exists: boolean;
  cardCount: number | null;
  /** Answers and accuracy inside the window. */
  answered: number;
  correct: number;
  accuracy: number | null;
  sessions: number;
  /** All-time figures. */
  totalSessions: number;
  lastStudied: Date | null;
  lastSessionAccuracy: number | null;
  /** Accuracy of the last 10 sessions, oldest first. */
  trend: number[];
  studiedCards: number;
  masteredCards: number;
};

/** Stats for every deck the user has, plus deleted decks they studied. Studied decks first, by last studied. */
export async function listDeckStats(
  pg: Client,
  userId: string,
  { days, tz }: StatsRange,
  deckName?: string,
): Promise<DeckStats[]> {
  const deckRows = await pg.query<{ name: string; card_count: number | null }>(
    `SELECT name, card_count FROM public.decks
     WHERE user_id = $1 AND ($2::text IS NULL OR name = $2)`,
    [userId, deckName ?? null],
  );

  const history = await pg.query<{
    deck_name: string;
    total_sessions: string;
    last_studied: Date;
    trend: number[];
    last_session_accuracy: number;
  }>(
    `WITH ses AS (
       SELECT s.id, s.deck_name, s.started_at,
         COUNT(*) FILTER (WHERE a.correct)::float8 / COUNT(*) AS accuracy,
         MAX(a.answered_at) AS last_answer
       ${USER_ANSWERS} AND ($2::text IS NULL OR s.deck_name = $2)
       GROUP BY s.id
     ),
     ranked AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY deck_name ORDER BY started_at DESC) AS rn FROM ses
     )
     SELECT deck_name,
       COUNT(*) AS total_sessions,
       MAX(last_answer) AS last_studied,
       ARRAY_AGG(accuracy ORDER BY started_at) FILTER (WHERE rn <= $3) AS trend,
       MAX(accuracy) FILTER (WHERE rn = 1) AS last_session_accuracy
     FROM ranked
     GROUP BY deck_name`,
    [userId, deckName ?? null, TREND_SESSIONS],
  );

  const inWindow = await pg.query<{ deck_name: string; answered: string; correct: string; sessions: string }>(
    `SELECT s.deck_name,
       COUNT(*) AS answered,
       COUNT(*) FILTER (WHERE a.correct) AS correct,
       COUNT(DISTINCT a.session_id) AS sessions
     ${USER_ANSWERS} AND ($4::text IS NULL OR s.deck_name = $4) AND a.answered_at >= ${WINDOW_START}
     GROUP BY s.deck_name`,
    [userId, tz, days, deckName ?? null],
  );

  const mastery = await masteryByDeck(pg, userId, deckName);
  const decks = new Map(deckRows.rows.map((r) => [r.name, r.card_count]));
  const historyByDeck = new Map(history.rows.map((r) => [r.deck_name, r]));
  const windowByDeck = new Map(inWindow.rows.map((r) => [r.deck_name, r]));
  const names = new Set([...decks.keys(), ...historyByDeck.keys()]);

  return [...names]
    .map((name): DeckStats => {
      const h = historyByDeck.get(name);
      const w = windowByDeck.get(name);
      const m = mastery.get(name);
      const answered = Number(w?.answered ?? 0);
      const correct = Number(w?.correct ?? 0);
      return {
        deckName: name,
        exists: decks.has(name),
        cardCount: decks.get(name) ?? null,
        answered,
        correct,
        accuracy: ratio(correct, answered),
        sessions: Number(w?.sessions ?? 0),
        totalSessions: Number(h?.total_sessions ?? 0),
        lastStudied: h?.last_studied ?? null,
        lastSessionAccuracy: h?.last_session_accuracy ?? null,
        trend: h?.trend ?? [],
        studiedCards: m?.studied ?? 0,
        masteredCards: m?.mastered ?? 0,
      };
    })
    .sort(
      (a, b) =>
        (b.lastStudied?.getTime() ?? -Infinity) - (a.lastStudied?.getTime() ?? -Infinity) ||
        a.deckName.localeCompare(b.deckName),
    );
}

export type HardCard = {
  deckName: string;
  cardId: string;
  cardFront: string | null;
  attempts: number;
  correct: number;
  accuracy: number;
};

/** Cards with the lowest all-time accuracy among those with enough attempts. Fully correct cards are left out. */
export async function listHardestCards(
  pg: Client,
  userId: string,
  { deckName, limit = 10 }: { deckName?: string; limit?: number } = {},
): Promise<HardCard[]> {
  const { rows } = await pg.query<{
    deck_name: string;
    card_id: string;
    card_front: string | null;
    attempts: string;
    correct: string;
  }>(
    `SELECT s.deck_name, a.card_id,
       (ARRAY_AGG(a.card_front ORDER BY a.answered_at DESC))[1] AS card_front,
       COUNT(*) AS attempts,
       COUNT(*) FILTER (WHERE a.correct) AS correct
     ${USER_ANSWERS} AND ($2::text IS NULL OR s.deck_name = $2)
     GROUP BY s.deck_name, a.card_id
     HAVING COUNT(*) >= $3 AND COUNT(*) FILTER (WHERE a.correct) < COUNT(*)
     ORDER BY COUNT(*) FILTER (WHERE a.correct)::float8 / COUNT(*), COUNT(*) DESC, a.card_id
     LIMIT $4`,
    [userId, deckName ?? null, HARDEST_MIN_ATTEMPTS, limit],
  );

  return rows.map((r) => {
    const attempts = Number(r.attempts);
    const correct = Number(r.correct);
    return {
      deckName: r.deck_name,
      cardId: r.card_id,
      cardFront: r.card_front,
      attempts,
      correct,
      accuracy: correct / attempts,
    };
  });
}

export type SessionSummary = {
  id: string;
  startedAt: Date;
  status: SessionStatus;
  answered: number;
  correct: number;
  accuracy: number | null;
  studyMs: number;
};

/** The deck's most recent sessions that have at least one answer, newest first. */
export async function listDeckSessions(
  pg: Client,
  userId: string,
  deckName: string,
  limit = 30,
): Promise<SessionSummary[]> {
  const { rows } = await pg.query<{
    id: string;
    started_at: Date;
    status: SessionStatus;
    answered: string;
    correct: string;
    study_ms: string;
    last_answer: Date;
  }>(
    `SELECT s.id, s.started_at, s.status,
       COUNT(*) AS answered,
       COUNT(*) FILTER (WHERE a.correct) AS correct,
       SUM(LEAST(COALESCE(a.duration_ms, 0), $3)) AS study_ms,
       MAX(a.answered_at) AS last_answer
     ${USER_ANSWERS} AND s.deck_name = $2
     GROUP BY s.id
     ORDER BY s.started_at DESC
     LIMIT $4`,
    [userId, deckName, MAX_ANSWER_MS, limit],
  );

  const now = Date.now();
  return rows.map((r) => {
    const answered = Number(r.answered);
    const correct = Number(r.correct);
    const stale = now - new Date(r.last_answer).getTime() > ABANDONED_AFTER_MS;
    return {
      id: r.id,
      startedAt: r.started_at,
      status: r.status === "in_progress" && stale ? "abandoned" : r.status,
      answered,
      correct,
      accuracy: ratio(correct, answered),
      studyMs: Number(r.study_ms),
    };
  });
}
