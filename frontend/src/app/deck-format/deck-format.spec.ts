import legacy from '../../../../test-decks/contract/legacy.json';
import legacyNormalized from '../../../../test-decks/contract/legacy.normalized.json';
import v2 from '../../../../test-decks/contract/v2.json';
import invalid from '../../../../test-decks/contract/invalid.json';
import { legacyCardId, normalizeDeck } from './deck-format';

// Shared fixtures, also read by the agent and main-backend tests. See test-decks/contract/README.md.
describe('normalizeDeck (deck format contract)', () => {
  it('upgrades the legacy fixture to the expected v2 deck', () => {
    expect(normalizeDeck(legacy)).toEqual(legacyNormalized);
  });

  it('reads the v2 fixture unchanged', () => {
    expect(normalizeDeck(v2)).toEqual(v2);
  });

  it('rejects every invalid fixture', () => {
    for (const { name, deck } of invalid as { name: string; deck: unknown }[]) {
      expect({ name, threw: (() => { try { normalizeDeck(deck); return false; } catch { return true; } })() })
        .toEqual({ name, threw: true });
    }
  });

  it('gives legacy cards the id study answers used before decks stored ids', () => {
    // The FNV-1a hash the study controller used to compute for each card.
    expect(legacyCardId({ front: 'What is a closure?', back: 'A function that captures its lexical scope.' })).toBe('e8c3e327');
  });
});
