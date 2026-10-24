-- Number of cards in the deck file, kept up to date on every write.
-- NULL for rows written before this column existed; GET /api/v1/stats/decks fills those in from R2.
ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS card_count integer;
