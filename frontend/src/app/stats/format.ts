const DAY_MS = 24 * 60 * 60 * 1000;

/** "Today", "Yesterday", "5 days ago", or a date for anything older than a month. */
export function relativeDay(iso: string | null, now = new Date()): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 31) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whole days between `iso` and now, or Infinity when never. */
export function daysSince(iso: string | null, now = new Date()): number {
  return iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS) : Infinity;
}

/** "6h 12m", "14m", "45s". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes === 0) return `${Math.round(ms / 1000)}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** "78%", or an em dash when there is nothing to show. */
export function percent(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

/** `#rrggbb` (or `#rgb`) with an alpha, as `rgba()`. Anything else is returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  let hex = color.trim().replace(/^#/, '');
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return color;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Deck name as shown to people: the file name without a .json extension. */
export function displayDeckName(deckName: string): string {
  return deckName.replace(/\.json$/i, '');
}

/** Router path of the study page, or null for decks the study page can't open (only .json decks). */
export function studyLink(deckName: string): string | null {
  return /\.json$/i.test(deckName) ? `/deck-study/${displayDeckName(deckName)}` : null;
}

/** YYYY-MM-DD of a local date. */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
