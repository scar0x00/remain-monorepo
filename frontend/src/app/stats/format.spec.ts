import { blend, displayDeckName, formatDuration, percent, relativeDay, studyLink, withAlpha } from './format';

describe('stats format', () => {
  const now = new Date(2026, 9, 24, 12);

  it('describes days relative to today', () => {
    expect(relativeDay(new Date(2026, 9, 24, 1).toISOString(), now)).toBe('Today');
    expect(relativeDay(new Date(2026, 9, 23, 23).toISOString(), now)).toBe('Yesterday');
    expect(relativeDay(new Date(2026, 9, 19).toISOString(), now)).toBe('5 days ago');
    expect(relativeDay(null, now)).toBe('Never');
  });

  it('formats durations', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(14 * 60_000)).toBe('14m');
    expect(formatDuration(6 * 3600_000 + 12 * 60_000)).toBe('6h 12m');
  });

  it('formats percentages and missing values', () => {
    expect(percent(0.784)).toBe('78%');
    expect(percent(null)).toBe('—');
  });

  it('adds alpha to hex colours', () => {
    expect(withAlpha('#ffba08', 0.5)).toBe('rgba(255, 186, 8, 0.5)');
    expect(withAlpha('#fff', 1)).toBe('rgba(255, 255, 255, 1)');
    expect(withAlpha('red', 0.5)).toBe('red');
  });

  it('blends colours', () => {
    expect(blend('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(blend('#370617', '#03071e', 0.4)).toBe('#18071b');
    expect(blend('nope', '#03071e', 0.4)).toBe('#03071e');
  });

  it('links only .json decks to the study page', () => {
    expect(displayDeckName('verbs.json')).toBe('verbs');
    expect(studyLink('verbs.json')).toBe('/deck-study/verbs');
    expect(studyLink('verbs.yaml')).toBeNull();
  });
});
