INSERT INTO "user" ("id", "name", "email", "emailVerified")
VALUES ('system', 'System', 'system@remain.local', true)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS size bigint,
  ADD COLUMN IF NOT EXISTS etag text;

CREATE UNIQUE INDEX IF NOT EXISTS decks_name_uidx ON public.decks (name);
