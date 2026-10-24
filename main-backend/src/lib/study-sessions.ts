import type { Client } from "pg";
import { z } from "zod";

/** Sessions without answers for this long are reported as abandoned. */
export const ABANDONED_AFTER_MS = 30 * 60 * 1000;
const MAX_FRONT_LENGTH = 200;

export const CreateSessionSchema = z.object({
  deckName: z.string().min(1),
  deckEtag: z.string().nullish(),
  cardTotal: z.number().int().min(0),
});

export const AnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        position: z.number().int().min(0),
        cardId: z.string().min(1),
        cardFront: z.string().optional(),
        correct: z.boolean(),
        durationMs: z.number().int().min(0).nullish(),
      }),
    )
    .min(1)
    .max(500),
});

export type SessionStatus = "in_progress" | "completed" | "abandoned";

type SessionRow = {
  id: string;
  deck_name: string;
  deck_etag: string | null;
  card_total: number;
  started_at: Date;
  finished_at: Date | null;
  status: SessionStatus;
  right_count: string;
  wrong_count: string;
  last_activity: Date;
};

export type StudySession = {
  id: string;
  deckName: string;
  deckEtag: string | null;
  cardTotal: number;
  startedAt: Date;
  finishedAt: Date | null;
  status: SessionStatus;
  right: number;
  wrong: number;
  accuracy: number | null;
};

export type StudyAnswer = {
  position: number;
  cardId: string;
  cardFront: string | null;
  correct: boolean;
  durationMs: number | null;
  answeredAt: Date;
};

const SESSION_SELECT = `
  SELECT s.id, s.deck_name, s.deck_etag, s.card_total, s.started_at, s.finished_at, s.status,
    COUNT(a.position) FILTER (WHERE a.correct) AS right_count,
    COUNT(a.position) FILTER (WHERE NOT a.correct) AS wrong_count,
    COALESCE(MAX(a.answered_at), s.started_at) AS last_activity
  FROM public.study_sessions s
  LEFT JOIN public.study_answers a ON a.session_id = s.id`;

function toSession(row: SessionRow, now = Date.now()): StudySession {
  const right = Number(row.right_count);
  const wrong = Number(row.wrong_count);
  const abandoned =
    row.status === "in_progress" &&
    now - new Date(row.last_activity).getTime() > ABANDONED_AFTER_MS;

  return {
    id: row.id,
    deckName: row.deck_name,
    deckEtag: row.deck_etag,
    cardTotal: row.card_total,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: abandoned ? "abandoned" : row.status,
    right,
    wrong,
    accuracy: right + wrong > 0 ? right / (right + wrong) : null,
  };
}

export async function createSession(
  pg: Client,
  userId: string,
  input: z.infer<typeof CreateSessionSchema>,
) {
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO public.study_sessions (user_id, deck_id, deck_name, deck_etag, card_total)
     VALUES ($1, (SELECT id FROM public.decks WHERE name = $2), $2, $3, $4)
     RETURNING id`,
    [userId, input.deckName, input.deckEtag ?? null, input.cardTotal],
  );
  return rows[0].id;
}

/** Returns null when the session does not exist or belongs to someone else. */
export async function getSession(pg: Client, userId: string, id: string) {
  const { rows } = await pg.query<SessionRow>(
    `${SESSION_SELECT} WHERE s.id = $1 AND s.user_id = $2 GROUP BY s.id`,
    [id, userId],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

export async function listSessions(
  pg: Client,
  userId: string,
  opts: { deckName?: string; limit?: number; cursor?: string },
) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const { rows } = await pg.query<SessionRow>(
    `${SESSION_SELECT}
     WHERE s.user_id = $1
       AND ($2::text IS NULL OR s.deck_name = $2)
       AND ($3::timestamptz IS NULL OR s.started_at < $3)
     GROUP BY s.id
     ORDER BY s.started_at DESC
     LIMIT $4`,
    [userId, opts.deckName ?? null, opts.cursor ?? null, limit + 1],
  );

  const page = rows.slice(0, limit).map((row) => toSession(row));
  const nextCursor =
    rows.length > limit ? new Date(page[page.length - 1].startedAt).toISOString() : null;
  return { sessions: page, nextCursor };
}

export async function getAnswers(pg: Client, sessionId: string) {
  const { rows } = await pg.query<{
    position: number;
    card_id: string;
    card_front: string | null;
    correct: boolean;
    duration_ms: number | null;
    answered_at: Date;
  }>(
    `SELECT position, card_id, card_front, correct, duration_ms, answered_at
     FROM public.study_answers
     WHERE session_id = $1
     ORDER BY position`,
    [sessionId],
  );

  return rows.map(
    (r): StudyAnswer => ({
      position: r.position,
      cardId: r.card_id,
      cardFront: r.card_front,
      correct: r.correct,
      durationMs: r.duration_ms,
      answeredAt: r.answered_at,
    }),
  );
}

/** Upserts on (session_id, position) so client retries are safe. */
export async function saveAnswers(
  pg: Client,
  sessionId: string,
  answers: z.infer<typeof AnswersSchema>["answers"],
) {
  await pg.query(
    `INSERT INTO public.study_answers (session_id, position, card_id, card_front, correct, duration_ms)
     SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::boolean[], $6::int[])
     ON CONFLICT (session_id, position) DO UPDATE SET
       card_id = EXCLUDED.card_id,
       card_front = EXCLUDED.card_front,
       correct = EXCLUDED.correct,
       duration_ms = EXCLUDED.duration_ms,
       answered_at = now()`,
    [
      sessionId,
      answers.map((a) => a.position),
      answers.map((a) => a.cardId),
      answers.map((a) => a.cardFront?.slice(0, MAX_FRONT_LENGTH) ?? null),
      answers.map((a) => a.correct),
      answers.map((a) => a.durationMs ?? null),
    ],
  );
}

export async function finishSession(pg: Client, userId: string, id: string) {
  await pg.query(
    `UPDATE public.study_sessions
     SET status = 'completed', finished_at = now()
     WHERE id = $1 AND user_id = $2 AND status = 'in_progress'`,
    [id, userId],
  );
  return getSession(pg, userId, id);
}

export type DeckStudyStats = {
  studyCount: number;
  // Average accuracy (0-1) of the last three completed runs.
  recentAccuracy: number | null;
  lastStudied: Date;
};

/** Per-deck stats over completed runs, keyed by deck name. */
export async function listDeckStats(pg: Client, userId: string) {
  const { rows } = await pg.query<{
    deck_name: string;
    study_count: string;
    recent_accuracy: number | null;
    last_studied: Date;
  }>(
    `WITH done AS (
       SELECT s.deck_name, s.started_at,
         COUNT(a.position) FILTER (WHERE a.correct)::float8 / NULLIF(COUNT(a.position), 0) AS accuracy,
         ROW_NUMBER() OVER (PARTITION BY s.deck_name ORDER BY s.started_at DESC) AS rn
       FROM public.study_sessions s
       LEFT JOIN public.study_answers a ON a.session_id = s.id
       WHERE s.user_id = $1 AND s.status = 'completed'
       GROUP BY s.id
     )
     SELECT deck_name, COUNT(*) AS study_count,
       AVG(accuracy) FILTER (WHERE rn <= 3) AS recent_accuracy,
       MAX(started_at) AS last_studied
     FROM done
     GROUP BY deck_name`,
    [userId],
  );

  return new Map(
    rows.map((r): [string, DeckStudyStats] => [
      r.deck_name,
      {
        studyCount: Number(r.study_count),
        recentAccuracy: r.recent_accuracy,
        lastStudied: r.last_studied,
      },
    ]),
  );
}
