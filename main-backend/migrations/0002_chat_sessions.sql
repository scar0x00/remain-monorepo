-- Persisted deck-creation conversations (issue #15).
-- `deck_name` / `deck_key` are snapshots rather than a foreign key to public.decks, so a
-- session and its messages survive deleting the deck.
CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  deck_name text,
  deck_key text,
  title text NOT NULL DEFAULT 'New deck',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.chat_sessions (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  state text NOT NULL DEFAULT 'done' CHECK (state IN ('pending', 'done', 'error')),
  text text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]',
  deck_name text,
  card_count integer,
  deck_etag text,
  -- clock_timestamp() so messages inserted in one transaction keep their order.
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS chat_sessions_user_updated_idx
  ON public.chat_sessions (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_session_created_idx
  ON public.chat_messages (session_id, created_at);
