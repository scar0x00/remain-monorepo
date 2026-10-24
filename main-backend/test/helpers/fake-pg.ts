type DeckRecord = {
  name: string;
  size: number;
  etag: string;
  cardCount: number | null;
  createdAt: Date;
};

export const decks = new Map<string, DeckRecord>();

export type SessionRecord = {
  id: string;
  user_id: string;
  deck_name: string;
  deck_etag: string | null;
  card_total: number;
  started_at: Date;
  finished_at: Date | null;
  status: string;
};

export type AnswerRecord = {
  session_id: string;
  position: number;
  card_id: string;
  card_front: string | null;
  correct: boolean;
  duration_ms: number | null;
  answered_at: Date;
};

export const sessions = new Map<string, SessionRecord>();
export const answers: AnswerRecord[] = [];
let sessionSeq = 0;

export function resetDecks() {
  decks.clear();
  sessions.clear();
  answers.length = 0;
  sessionSeq = 0;
}

function sessionRow(s: SessionRecord) {
  const mine = answers.filter((a) => a.session_id === s.id);
  return {
    ...s,
    right_count: String(mine.filter((a) => a.correct).length),
    wrong_count: String(mine.filter((a) => !a.correct).length),
    last_activity: mine.reduce((max, a) => (a.answered_at > max ? a.answered_at : max), s.started_at),
  };
}

// Minimal stand-in for `pg.Client` that understands only the SQL statements
// used by src/index.ts and src/lib/decks.ts. Installed with `mock.module("pg", ...)` in tests.
export class FakeClient {
  constructor(_config?: unknown) {}

  async connect() {}

  async end() {}

  async query(sql: string, params: unknown[] = []): Promise<{ rows: any[] }> {
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("INSERT INTO public.decks")) {
      const [name, , size, etag, cardCount] = params as [string, string, number, string, number | null];
      const existing = decks.get(name);
      decks.set(name, {
        name,
        size: Number(size),
        etag,
        cardCount: cardCount ?? null,
        createdAt: existing?.createdAt ?? new Date(),
      });
      return { rows: [] };
    }

    if (normalized.startsWith("SELECT name, size")) {
      const pattern = String(params[0] ?? "%");
      const prefix = pattern.endsWith("%") ? pattern.slice(0, -1) : pattern;
      const rows = [...decks.values()]
        .filter((d) => d.name.toLowerCase().startsWith(prefix.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => ({
          name: d.name,
          size: String(d.size),
          createdAt: d.createdAt,
          etag: d.etag,
        }));
      return { rows };
    }

    if (normalized.startsWith("DELETE FROM public.decks")) {
      decks.delete(String(params[0]));
      return { rows: [] };
    }

    if (normalized.startsWith("INSERT INTO public.study_sessions")) {
      const [user_id, deck_name, deck_etag, card_total] = params as [string, string, string | null, number];
      const id = `00000000-0000-0000-0000-${String(++sessionSeq).padStart(12, "0")}`;
      sessions.set(id, {
        id,
        user_id,
        deck_name,
        deck_etag,
        card_total,
        started_at: new Date(),
        finished_at: null,
        status: "in_progress",
      });
      return { rows: [{ id }] };
    }

    if (normalized.startsWith("INSERT INTO public.study_answers")) {
      const [session_id, positions, cardIds, fronts, corrects, durations] = params as [
        string, number[], string[], (string | null)[], boolean[], (number | null)[],
      ];
      positions.forEach((position, i) => {
        const record: AnswerRecord = {
          session_id,
          position,
          card_id: cardIds[i],
          card_front: fronts[i],
          correct: corrects[i],
          duration_ms: durations[i],
          answered_at: new Date(),
        };
        const at = answers.findIndex((a) => a.session_id === session_id && a.position === position);
        if (at >= 0) answers[at] = record;
        else answers.push(record);
      });
      return { rows: [] };
    }

    if (normalized.startsWith("UPDATE public.study_sessions")) {
      const [id, userId] = params as [string, string];
      const s = sessions.get(id);
      if (s && s.user_id === userId && s.status === "in_progress") {
        s.status = "completed";
        s.finished_at = new Date();
      }
      return { rows: [] };
    }

    if (normalized.startsWith("WITH done AS")) {
      const byDeck = new Map<string, { started: Date; accuracy: number | null }[]>();
      for (const s of sessions.values()) {
        if (s.user_id !== params[0] || s.status !== "completed") continue;
        const mine = answers.filter((a) => a.session_id === s.id);
        const accuracy = mine.length ? mine.filter((a) => a.correct).length / mine.length : null;
        byDeck.set(s.deck_name, [...(byDeck.get(s.deck_name) ?? []), { started: s.started_at, accuracy }]);
      }
      const rows = [...byDeck].map(([deck_name, runs]) => {
        runs.sort((a, b) => b.started.getTime() - a.started.getTime());
        const recent = runs.slice(0, 3).map((r) => r.accuracy).filter((a): a is number => a !== null);
        return {
          deck_name,
          study_count: String(runs.length),
          recent_accuracy: recent.length ? recent.reduce((x, y) => x + y) / recent.length : null,
          last_studied: runs[0].started,
        };
      });
      return { rows };
    }

    if (normalized.includes("FROM public.study_sessions s") && normalized.includes("s.id = $1")) {
      const [id, userId] = params as [string, string];
      const s = sessions.get(id);
      return { rows: s && s.user_id === userId ? [sessionRow(s)] : [] };
    }

    if (normalized.includes("FROM public.study_sessions s")) {
      const [userId, deckName, cursor, limit] = params as [string, string | null, string | null, number];
      const rows = [...sessions.values()]
        .filter((s) => s.user_id === userId)
        .filter((s) => !deckName || s.deck_name === deckName)
        .filter((s) => !cursor || s.started_at < new Date(cursor))
        .sort((a, b) => b.started_at.getTime() - a.started_at.getTime())
        .slice(0, limit)
        .map(sessionRow);
      return { rows };
    }

    if (normalized.startsWith("SELECT position, card_id")) {
      const rows = answers
        .filter((a) => a.session_id === params[0])
        .sort((a, b) => a.position - b.position);
      return { rows };
    }

    throw new Error(`FakeClient: unsupported query: ${normalized}`);
  }
}
