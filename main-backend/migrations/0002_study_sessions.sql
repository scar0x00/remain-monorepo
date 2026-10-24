CREATE TABLE IF NOT EXISTS public.study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  deck_id uuid REFERENCES public.decks (id) ON DELETE SET NULL,
  -- Snapshot so history survives deck deletion.
  deck_name text NOT NULL,
  -- Which version of the deck was studied.
  deck_etag text,
  -- Cards in this run (may be a subset of the deck).
  card_total integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned'))
);

CREATE TABLE IF NOT EXISTS public.study_answers (
  session_id uuid NOT NULL REFERENCES public.study_sessions (id) ON DELETE CASCADE,
  -- Order within the run; makes client retries idempotent.
  position integer NOT NULL,
  card_id text NOT NULL,
  -- Truncated snapshot so "missed cards" does not need to read R2.
  card_front text,
  correct boolean NOT NULL,
  -- Time from the card being shown to the answer.
  duration_ms integer,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, position)
);

CREATE INDEX IF NOT EXISTS idx_study_sessions_user_started ON public.study_sessions (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_sessions_user_deck ON public.study_sessions (user_id, deck_name);
CREATE INDEX IF NOT EXISTS idx_study_answers_card_id ON public.study_answers (card_id);
