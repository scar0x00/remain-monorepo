import { deckTags, hasAnyTag, parseQuickParam, parseTagsParam } from './quick-session';

describe('quick session params', () => {
  it('reads ?quick as a card count or as a request for the setup screen', () => {
    expect(parseQuickParam(null)).toBeUndefined();
    expect(parseQuickParam(undefined)).toBeUndefined();
    expect(parseQuickParam('')).toBe('setup');
    expect(parseQuickParam('abc')).toBe('setup');
    expect(parseQuickParam('0')).toBe('setup');
    expect(parseQuickParam('2.5')).toBe('setup');
    expect(parseQuickParam('20')).toBe(20);
  });

  it('reads ?tags as a list without blanks or repeats', () => {
    expect(parseTagsParam(null)).toEqual([]);
    expect(parseTagsParam('a, b,,a')).toEqual(['a', 'b']);
  });
});

describe('deckTags', () => {
  it('counts each tag once per card, most used first', () => {
    const cards = [
      { id: '1', front: '', back: '', meta: { tags: ['b', 'a', 'a'] } },
      { id: '2', front: '', back: '', meta: { tags: ['b'] } },
      { id: '3', front: '', back: '' },
    ];
    expect(deckTags(cards)).toEqual([
      { tag: 'b', count: 2 },
      { tag: 'a', count: 1 },
    ]);
  });

  it('matches cards with any of the tags, and every card when there are none', () => {
    const card = { id: '1', front: '', back: '', meta: { tags: ['a'] } };
    expect(hasAnyTag(card, new Set())).toBe(true);
    expect(hasAnyTag(card, new Set(['b', 'a']))).toBe(true);
    expect(hasAnyTag(card, new Set(['b']))).toBe(false);
    expect(hasAnyTag({ id: '2', front: '', back: '' }, new Set(['a']))).toBe(false);
  });
});
