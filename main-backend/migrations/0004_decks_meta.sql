-- Deck-level metadata of v2 deck files (#13), copied from the file on every write so listing and
-- search don't have to open R2 objects. `meta` is the file's `meta` object (title, author, tool, ...).
-- NULL for rows written before these columns existed; GET /api/v1/stats/decks fills them in from R2.
ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS meta jsonb;
