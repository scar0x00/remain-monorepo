import { Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DeckStats } from '../../types/Stats';
import { Sparkline } from '../sparkline/sparkline';
import { accuracyLevel } from '../stats/chart-theme';
import { displayDeckName, percent, relativeDay, studyLink } from '../stats/format';

type SortKey = 'accuracy' | 'lastStudied' | 'mastered';

/** Per-deck stats: a sortable table from `md` up, stacked cards below. */
@Component({
  selector: 'app-deck-stats-table',
  imports: [RouterLink, Sparkline],
  templateUrl: './deck-stats-table.html',
})
export class DeckStatsTable {
  readonly decks = input.required<DeckStats[]>();
  /** Days in the selected window, for the column header. */
  readonly days = input.required<number>();

  protected readonly sortKey = signal<SortKey>('lastStudied');

  protected readonly rows = computed(() => {
    const key = this.sortKey();
    const value = (d: DeckStats): number => {
      if (key === 'accuracy') return d.accuracy ?? -1;
      if (key === 'mastered') return masteredShare(d) ?? -1;
      return d.lastStudied ? Date.parse(d.lastStudied) : -Infinity;
    };
    return this.decks()
      .filter((d) => d.exists || d.totalSessions > 0)
      .slice()
      .sort((a, b) => value(b) - value(a) || a.deckName.localeCompare(b.deckName))
      .map((d) => ({
        ...d,
        title: displayDeckName(d.deckName),
        study: studyLink(d.deckName),
        level: accuracyLevel(d.accuracy),
        mastered: masteredLabel(d),
        last: relativeDay(d.lastStudied),
        accuracyLabel: percent(d.accuracy),
        barWidth: `${Math.round((d.accuracy ?? 0) * 100)}%`,
      }));
  });

  protected setSort(value: string) {
    this.sortKey.set(value as SortKey);
  }

  // Same colours as the score hints in deck-list.
  protected barClass(level: string) {
    if (level === 'good') return 'bg-green-900 dark:bg-green-500';
    if (level === 'ok') return 'bg-amber-900 dark:bg-amber-500';
    return 'bg-red-900 dark:bg-red-500';
  }

  protected textClass(level: string) {
    if (level === 'good') return 'text-green-900 dark:text-green-400';
    if (level === 'ok') return 'text-amber-900 dark:text-amber-400';
    if (level === 'low') return 'text-red-900 dark:text-red-400';
    return 'text-app-text-muted';
  }
}

/** Mastered cards as a share of the deck, or of the cards studied when the deck size is unknown. */
function masteredShare(d: DeckStats): number | null {
  const total = d.cardCount ?? d.studiedCards;
  return total ? d.masteredCards / total : null;
}

function masteredLabel(d: DeckStats): string {
  if (d.cardCount) return `${d.masteredCards} / ${d.cardCount}`;
  return d.studiedCards ? `${d.masteredCards} of ${d.studiedCards} studied` : '—';
}
