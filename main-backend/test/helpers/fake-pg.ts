type DeckRecord = {
  name: string;
  userId: string;
  size: number;
  etag: string;
  createdAt: Date;
};

export const decks = new Map<string, DeckRecord>();

export type SessionRecord = {
  id: string;
  user_id: string;
  title: string;
  deck_name: string | null;
  deck_key: string | null;
  created_at: Date;
  updated_at: Date;
};

export type MessageRecord = {
  id: string;
  session_id: string;
  role: string;
  state: string;
  text: string;
  attachments: unknown;
  deck_name: string | null;
  card_count: number | null;
  deck_etag: string | null;
  created_at: Date;
};

export const chatSessions = new Map<string, SessionRecord>();
export const chatMessages: MessageRecord[] = [];

// Strictly increasing, like Postgres timestamps for statements that run one after another.
let tick = 0;
const now = () => new Date(Date.now() + tick++);

export function resetDecks() {
  decks.clear();
  chatSessions.clear();
  chatMessages.length = 0;
}

// Minimal stand-in for `pg.Client` that understands only the SQL statements
// used by src/index.ts. Installed with `mock.module("pg", ...)` in tests.
export class FakeClient {
  constructor(_config?: unknown) {}

  async connect() {}

  async end() {}

  async query(sql: string, params: unknown[] = []): Promise<{ rows: any[] }> {
    const normalized = sql.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("INSERT INTO public.decks")) {
      const [name, userId, size, etag] = params as [string, string, number, string];
      const existing = decks.get(name);
      decks.set(name, {
        name,
        userId,
        size: Number(size),
        etag,
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

    const chatResult = this.chatQuery(normalized, params);
    if (chatResult) return chatResult;

    throw new Error(`FakeClient: unsupported query: ${normalized}`);
  }

  // The statements of src/lib/chat-store.ts, emulated just far enough for the route tests.
  private chatQuery(sql: string, params: unknown[]): { rows: any[] } | null {
    const [a, b, c, d, e, f, g, h] = params as any[];

    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };

    if (sql.startsWith("INSERT INTO public.chat_sessions")) {
      const record: SessionRecord = {
        id: crypto.randomUUID(),
        user_id: a,
        title: b,
        deck_name: null,
        deck_key: null,
        created_at: now(),
        updated_at: now(),
      };
      chatSessions.set(record.id, record);
      return { rows: [{ ...record }] };
    }

    if (sql.startsWith("SELECT id, title, deck_name, deck_key, created_at, updated_at, to_char(")) {
      const [userId, before, limit] = params as [string, string | null, number];
      const rows = [...chatSessions.values()]
        .filter((s) => s.user_id === userId)
        .filter((s) => before === null || s.updated_at.getTime() < new Date(before).getTime())
        .sort((x, y) => y.updated_at.getTime() - x.updated_at.getTime())
        .slice(0, limit)
        .map((s) => ({ ...s, cursor: s.updated_at.toISOString() }));
      return { rows };
    }

    if (sql.startsWith("SELECT id, title, deck_name, deck_key, created_at, updated_at FROM")) {
      const session = chatSessions.get(a);
      return { rows: session && session.user_id === b ? [{ ...session }] : [] };
    }

    if (sql.startsWith("SELECT id, role, state, text, attachments")) {
      const rows = chatMessages
        .filter((m) => m.session_id === a)
        .sort((x, y) => x.created_at.getTime() - y.created_at.getTime())
        .map((m) => ({ ...m }));
      return { rows };
    }

    if (sql.startsWith("UPDATE public.chat_sessions SET title = $3 WHERE")) {
      const session = chatSessions.get(a);
      if (!session || session.user_id !== b) return { rows: [] };
      session.title = c;
      return { rows: [{ ...session }] };
    }

    if (sql.startsWith("DELETE FROM public.chat_sessions")) {
      const session = chatSessions.get(a);
      if (!session || session.user_id !== b) return { rows: [] };
      chatSessions.delete(a);
      for (let i = chatMessages.length - 1; i >= 0; i--) {
        if (chatMessages[i].session_id === a) chatMessages.splice(i, 1);
      }
      return { rows: [{ id: a }] };
    }

    if (sql.startsWith("INSERT INTO public.chat_messages")) {
      const record: MessageRecord = {
        id: crypto.randomUUID(),
        session_id: a,
        role: b,
        state: c,
        text: d,
        attachments: JSON.parse(e),
        deck_name: null,
        card_count: null,
        deck_etag: null,
        created_at: now(),
      };
      chatMessages.push(record);
      return { rows: [{ ...record }] };
    }

    if (sql.startsWith("UPDATE public.chat_sessions SET title = $3, updated_at = now()")) {
      const session = chatSessions.get(a);
      if (session && session.user_id === b) {
        session.title = c;
        session.updated_at = now();
      }
      return { rows: [] };
    }

    if (sql.startsWith("UPDATE public.chat_messages AS m")) {
      const message = chatMessages.find((m) => m.id === a);
      const session = chatSessions.get(b);
      if (
        !message ||
        !session ||
        message.session_id !== b ||
        session.user_id !== c ||
        message.role !== "assistant" ||
        message.state !== "pending"
      ) {
        return { rows: [] };
      }
      Object.assign(message, { state: d, text: e, deck_name: f, card_count: g, deck_etag: h });
      return { rows: [{ id: message.id }] };
    }

    if (sql.startsWith("UPDATE public.chat_sessions SET deck_name = $3")) {
      const session = chatSessions.get(a);
      if (session && session.user_id === b) {
        Object.assign(session, { deck_name: c, deck_key: d, updated_at: now() });
      }
      return { rows: [] };
    }

    if (sql.startsWith("UPDATE public.chat_sessions SET updated_at = now()")) {
      const session = chatSessions.get(a);
      if (session && session.user_id === b) session.updated_at = now();
      return { rows: [] };
    }

    if (sql.startsWith("SELECT 1 FROM public.decks")) {
      const deck = decks.get(a);
      return { rows: deck && deck.userId === b ? [{ "?column?": 1 }] : [] };
    }

    return null;
  }
}
