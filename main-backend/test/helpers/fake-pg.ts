type DeckRecord = {
  name: string;
  size: number;
  etag: string;
  createdAt: Date;
};

export const decks = new Map<string, DeckRecord>();

export function resetDecks() {
  decks.clear();
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
      const [name, , size, etag] = params as [string, string, number, string];
      const existing = decks.get(name);
      decks.set(name, {
        name,
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

    throw new Error(`FakeClient: unsupported query: ${normalized}`);
  }
}
