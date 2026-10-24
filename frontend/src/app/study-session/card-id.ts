import { Card } from '../../types/Card';

/**
 * Deterministic id for a card (FNV-1a over front and back), so answers can be attributed to a card
 * across runs. Replace with the stored card id once decks carry them (#13).
 */
export function cardId(card: Card): string {
  let hash = 0x811c9dc5;
  for (const char of `${card.front}\u0000${card.back}`) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
