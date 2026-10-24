import { daysAgo, deck } from '../../testing/stats-fixtures';
import { decksNeedingReview } from './needs-review';

describe('decksNeedingReview', () => {
  const now = new Date();

  it('picks stale and low-accuracy decks, worst first', () => {
    const items = decksNeedingReview(
      [
        deck({ deckName: 'fine.json', accuracy: 0.9, lastStudied: daysAgo(1, now) }),
        deck({ deckName: 'stale.json', accuracy: 0.9, lastStudied: daysAgo(20, now) }),
        deck({ deckName: 'low.json', accuracy: 0.4, lastStudied: daysAgo(1, now) }),
        deck({ deckName: 'both.json', accuracy: 0.5, lastStudied: daysAgo(30, now) }),
      ],
      now,
    );

    expect(items.map((i) => i.deckName)).toEqual(['both.json', 'low.json', 'stale.json']);
    expect(items[0]!.reason).toBe('Success 50% · last studied 30 days ago');
    expect(items[1]!.reason).toBe('Success 40%');
  });

  it('skips decks never studied and deleted decks', () => {
    const items = decksNeedingReview(
      [
        deck({ deckName: 'new.json', totalSessions: 0, accuracy: null, lastStudied: null }),
        deck({ deckName: 'gone.json', exists: false, accuracy: 0.1 }),
      ],
      now,
    );
    expect(items).toEqual([]);
  });
});
