# Deck format contract fixtures

The deck format is defined three times, once per package (there is no shared workspace):

- `flashcard-generator-agent/src/schema.ts`
- `main-backend/src/lib/deck-format.ts`
- `frontend/src/app/deck-format/deck-format.ts`

Each package's tests read these files, so a change to one copy that the others don't follow fails a test.

- `legacy.json`, `legacy.yaml`: the old format, a bare array of `{ front, back }` (with a duplicate card).
- `legacy.normalized.json`: what both legacy files must parse to. Card ids are the FNV-1a hash of `front\0back`, with `-2`, `-3`, ... for duplicates.
- `v2.json`, `v2.yaml`: the same v2 deck; parsing returns it unchanged.
- `invalid.json`: `{ name, deck }` cases that must be rejected.
