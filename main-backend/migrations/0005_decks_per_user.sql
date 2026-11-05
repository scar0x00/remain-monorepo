-- Accounts (#12): deck names are unique per user, not globally. Two users can both have
-- `spanish.json`; their files live under different R2 prefixes (`<userId>/spanish.json`).
CREATE UNIQUE INDEX IF NOT EXISTS decks_user_name_uidx ON public.decks (user_id, name);
DROP INDEX IF EXISTS decks_name_uidx;

-- Superseded by the (user_id, name) index above.
DROP INDEX IF EXISTS idx_decks_user_id;
