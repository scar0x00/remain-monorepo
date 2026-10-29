-- Baseline for public.decks, captured from the Supabase schema.
-- Requires the better-auth "user" table, so apply better-auth_migrations/* first.
CREATE TABLE IF NOT EXISTS public.decks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  description text,
  user_id text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT decks_pkey PRIMARY KEY (id),
  CONSTRAINT fk_decks_user FOREIGN KEY (user_id) REFERENCES "user" (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decks_user_id ON public.decks (user_id);
