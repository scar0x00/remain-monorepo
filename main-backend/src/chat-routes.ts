import { Hono } from "hono";
import { type Env } from "./types";
import { currentUserMiddleware } from "./lib/current-user";
import { pgDbMiddleware } from "./lib/pg";
import {
  appendMessages,
  type Attachment,
  deckExists,
  deleteSession,
  DEFAULT_TITLE,
  createSession,
  getSession,
  isUuid,
  listMessages,
  listSessions,
  MAX_TITLE_LENGTH,
  type MessageState,
  type NewMessage,
  renameSession,
} from "./lib/chat-store";

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const MAX_MESSAGES_PER_REQUEST = 10;
const MAX_TEXT_LENGTH = 20_000;
const MAX_ATTACHMENTS = 10;

export const chatRoutes = new Hono<Env>();

chatRoutes.use("*", pgDbMiddleware, currentUserMiddleware);

// Newest first. Pass the previous page's `nextCursor` as `before` for the next page.
chatRoutes.get("/", async (c) => {
  const limit = Number(c.req.query("limit") ?? DEFAULT_PAGE_SIZE);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    return c.json({ error: `limit must be between 1 and ${MAX_PAGE_SIZE}` }, 400);
  }

  const before = c.req.query("before") ?? null;
  if (before !== null && Number.isNaN(Date.parse(before))) {
    return c.json({ error: "before must be a timestamp" }, 400);
  }

  return c.json(await listSessions(c.get("pg"), c.get("userId"), limit, before));
});

chatRoutes.post("/", async (c) => {
  const body = await readJson(c.req.raw);
  const title = body?.title === undefined ? DEFAULT_TITLE : parseTitle(body.title);
  if (title === null) {
    return c.json({ error: `title must be 1-${MAX_TITLE_LENGTH} characters` }, 400);
  }

  const session = await createSession(c.get("pg"), c.get("userId"), title);
  return c.json(session, 201);
});

chatRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const pg = c.get("pg");
  const userId = c.get("userId");

  const session = isUuid(id) ? await getSession(pg, userId, id) : null;
  if (!session) {
    return c.json({ error: "Chat not found" }, 404);
  }

  const messages = await listMessages(pg, session.id);
  const exists = session.deckKey ? await deckExists(pg, userId, session.deckKey) : false;

  return c.json({ ...session, deckExists: exists, messages });
});

chatRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJson(c.req.raw);
  const title = parseTitle(body?.title);
  if (title === null) {
    return c.json({ error: `title must be 1-${MAX_TITLE_LENGTH} characters` }, 400);
  }

  const session = isUuid(id) ? await renameSession(c.get("pg"), c.get("userId"), id, title) : null;
  if (!session) {
    return c.json({ error: "Chat not found" }, 404);
  }

  return c.json(session);
});

// Removes the conversation only; the deck it produced stays.
chatRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const deleted = isUuid(id) && (await deleteSession(c.get("pg"), c.get("userId"), id));
  if (!deleted) {
    return c.json({ error: "Chat not found" }, 404);
  }

  return c.body(null, 204);
});

chatRoutes.post("/:id/messages", async (c) => {
  const id = c.req.param("id");
  const pg = c.get("pg");
  const userId = c.get("userId");

  const session = isUuid(id) ? await getSession(pg, userId, id) : null;
  if (!session) {
    return c.json({ error: "Chat not found" }, 404);
  }

  const body = await readJson(c.req.raw);
  const messages = parseMessages(body?.messages);
  if (typeof messages === "string") {
    return c.json({ error: messages }, 400);
  }

  const created = await appendMessages(pg, userId, session, messages);
  return c.json({ messages: created }, 201);
});

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title.length >= 1 && title.length <= MAX_TITLE_LENGTH ? title : null;
}

const STATES: MessageState[] = ["pending", "done", "error"];

// Returns the validated messages, or a message describing what is wrong.
function parseMessages(value: unknown): NewMessage[] | string {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MESSAGES_PER_REQUEST) {
    return `messages must contain 1-${MAX_MESSAGES_PER_REQUEST} items`;
  }

  const messages: NewMessage[] = [];
  for (const item of value as Record<string, unknown>[]) {
    if (typeof item !== "object" || item === null) return "Each message must be an object";
    if (item.role !== "user" && item.role !== "assistant") {
      return "role must be 'user' or 'assistant'";
    }

    const state = item.state ?? "done";
    if (!STATES.includes(state as MessageState)) return "state must be pending, done or error";
    if (state === "pending" && item.role !== "assistant") {
      return "Only assistant messages can be pending";
    }

    const text = item.text ?? "";
    if (typeof text !== "string" || text.length > MAX_TEXT_LENGTH) {
      return `text must be a string of at most ${MAX_TEXT_LENGTH} characters`;
    }

    const attachments = parseAttachments(item.attachments ?? []);
    if (attachments === null) return "attachments must be a list of { name, size }";

    messages.push({
      role: item.role,
      state: state as MessageState,
      text,
      attachments,
    });
  }
  return messages;
}

function parseAttachments(value: unknown): Attachment[] | null {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return null;

  const attachments: Attachment[] = [];
  for (const item of value as Record<string, unknown>[]) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.name !== "string" ||
      item.name.length < 1 ||
      item.name.length > 255 ||
      typeof item.size !== "number" ||
      !Number.isInteger(item.size) ||
      item.size < 0
    ) {
      return null;
    }
    attachments.push({ name: item.name, size: item.size });
  }
  return attachments;
}
