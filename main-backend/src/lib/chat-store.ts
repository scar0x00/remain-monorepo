import { type Client } from "pg";

export const DEFAULT_TITLE = "New deck";
export const MAX_TITLE_LENGTH = 120;
// An assistant message still pending after this long is reported as interrupted.
export const PENDING_TIMEOUT_MS = 5 * 60 * 1000;
export const INTERRUPTED_TEXT =
  "Generation was interrupted before it finished. Send your message again.";

export type MessageState = "pending" | "done" | "error";

export type Attachment = { name: string; size: number };

export type ChatSession = {
  id: string;
  title: string;
  deckName: string | null;
  deckKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  state: MessageState;
  text: string;
  attachments: Attachment[];
  deckName: string | null;
  cardCount: number | null;
  deckEtag: string | null;
  createdAt: Date;
};

export type NewMessage = {
  role: "user" | "assistant";
  state: MessageState;
  text: string;
  attachments: Attachment[];
};

export type Outcome =
  | { ok: true; text: string; deckName: string; deckKey: string; cardCount: number; etag: string }
  | { ok: false; text: string };

type SessionRow = {
  id: string;
  title: string;
  deck_name: string | null;
  deck_key: string | null;
  created_at: Date;
  updated_at: Date;
  cursor?: string;
};

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  state: MessageState;
  text: string;
  attachments: Attachment[];
  deck_name: string | null;
  card_count: number | null;
  deck_etag: string | null;
  created_at: Date;
};

const SESSION_COLUMNS = `id, title, deck_name, deck_key, created_at, updated_at`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string | undefined | null): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

const toSession = (row: SessionRow): ChatSession => ({
  id: row.id,
  title: row.title,
  deckName: row.deck_name,
  deckKey: row.deck_key,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toMessage = (row: MessageRow, now = Date.now()): ChatMessage => {
  const interrupted =
    row.state === "pending" && now - new Date(row.created_at).getTime() > PENDING_TIMEOUT_MS;

  return {
    id: row.id,
    role: row.role,
    state: interrupted ? "error" : row.state,
    text: interrupted ? INTERRUPTED_TEXT : row.text,
    attachments: row.attachments,
    deckName: row.deck_name,
    cardCount: row.card_count,
    deckEtag: row.deck_etag,
    createdAt: row.created_at,
  };
};

export function titleFromMessage(text: string, attachments: Attachment[]): string {
  const source = text.trim() || attachments[0]?.name || "";
  const oneLine = source.replace(/\s+/g, " ");
  if (oneLine === "") return DEFAULT_TITLE;
  return oneLine.length > 60 ? `${oneLine.slice(0, 59).trimEnd()}…` : oneLine;
}

export async function listSessions(
  pg: Client,
  userId: string,
  limit: number,
  before: string | null,
): Promise<{ sessions: ChatSession[]; nextCursor: string | null }> {
  const { rows } = await pg.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS},
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor
     FROM public.chat_sessions
     WHERE user_id = $1 AND ($2::timestamptz IS NULL OR updated_at < $2::timestamptz)
     ORDER BY updated_at DESC, id DESC
     LIMIT $3`,
    [userId, before, limit + 1],
  );

  const page = rows.slice(0, limit);
  return {
    sessions: page.map(toSession),
    nextCursor: rows.length > limit ? (page[page.length - 1].cursor ?? null) : null,
  };
}

export async function createSession(pg: Client, userId: string, title: string) {
  const { rows } = await pg.query<SessionRow>(
    `INSERT INTO public.chat_sessions (user_id, title)
     VALUES ($1, $2)
     RETURNING ${SESSION_COLUMNS}`,
    [userId, title],
  );
  return toSession(rows[0]);
}

export async function getSession(pg: Client, userId: string, id: string) {
  const { rows } = await pg.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS}
     FROM public.chat_sessions
     WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

export async function listMessages(pg: Client, sessionId: string) {
  const { rows } = await pg.query<MessageRow>(
    `SELECT id, role, state, text, attachments, deck_name, card_count, deck_etag, created_at
     FROM public.chat_messages
     WHERE session_id = $1
     ORDER BY created_at, id`,
    [sessionId],
  );
  return rows.map((row) => toMessage(row));
}

export async function renameSession(pg: Client, userId: string, id: string, title: string) {
  const { rows } = await pg.query<SessionRow>(
    `UPDATE public.chat_sessions
     SET title = $3
     WHERE id = $1 AND user_id = $2
     RETURNING ${SESSION_COLUMNS}`,
    [id, userId, title],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

export async function deleteSession(pg: Client, userId: string, id: string) {
  const { rows } = await pg.query<{ id: string }>(
    `DELETE FROM public.chat_sessions
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [id, userId],
  );
  return rows.length > 0;
}

// Appends messages to a session in one transaction. The first user message names a session
// that still has the default title. Returns null when the session isn't the user's.
export async function appendMessages(
  pg: Client,
  userId: string,
  session: ChatSession,
  messages: NewMessage[],
): Promise<ChatMessage[] | null> {
  const firstUser = messages.find((message) => message.role === "user");
  const title =
    session.title === DEFAULT_TITLE && firstUser
      ? titleFromMessage(firstUser.text, firstUser.attachments)
      : session.title;

  await pg.query("BEGIN");
  try {
    const created: ChatMessage[] = [];
    for (const message of messages) {
      const { rows } = await pg.query<MessageRow>(
        `INSERT INTO public.chat_messages (session_id, role, state, text, attachments)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id, role, state, text, attachments, deck_name, card_count, deck_etag, created_at`,
        [session.id, message.role, message.state, message.text, JSON.stringify(message.attachments)],
      );
      created.push(toMessage(rows[0]));
    }

    await pg.query(
      `UPDATE public.chat_sessions
       SET title = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [session.id, userId, title],
    );
    await pg.query("COMMIT");
    return created;
  } catch (error) {
    await pg.query("ROLLBACK");
    throw error;
  }
}

// Settles the pending assistant message of a generate request and, on success, links the
// session to the deck it produced. A no-op when the message isn't a pending assistant message
// of one of the user's sessions.
export async function finalizeAssistantMessage(
  pg: Client,
  userId: string,
  sessionId: string,
  messageId: string,
  outcome: Outcome,
) {
  const { rows } = await pg.query<{ id: string }>(
    `UPDATE public.chat_messages AS m
     SET state = $4, text = $5, deck_name = $6, card_count = $7, deck_etag = $8
     FROM public.chat_sessions AS s
     WHERE m.id = $1 AND m.session_id = s.id AND s.id = $2 AND s.user_id = $3
       AND m.role = 'assistant' AND m.state = 'pending'
     RETURNING m.id`,
    outcome.ok
      ? [messageId, sessionId, userId, "done", outcome.text, outcome.deckName, outcome.cardCount, outcome.etag]
      : [messageId, sessionId, userId, "error", outcome.text, null, null, null],
  );
  if (rows.length === 0) return;

  if (outcome.ok) {
    await pg.query(
      `UPDATE public.chat_sessions
       SET deck_name = $3, deck_key = $4, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [sessionId, userId, outcome.deckName, outcome.deckKey],
    );
  } else {
    await pg.query(
      `UPDATE public.chat_sessions SET updated_at = now() WHERE id = $1 AND user_id = $2`,
      [sessionId, userId],
    );
  }
}

export async function deckExists(pg: Client, userId: string, deckKey: string) {
  const { rows } = await pg.query(
    `SELECT 1 FROM public.decks WHERE name = $1 AND user_id = $2`,
    [deckKey, userId],
  );
  return rows.length > 0;
}
