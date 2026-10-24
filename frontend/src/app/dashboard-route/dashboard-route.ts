import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivityHeatmap } from '../activity-heatmap/activity-heatmap';
import { DeckStatsTable } from '../deck-stats-table/deck-stats-table';
import { HardestCards } from '../hardest-cards/hardest-cards';
import { NeedsReview } from '../needs-review/needs-review';
import { RangeSelector } from '../range-selector/range-selector';
import { SectionState } from '../section-state/section-state';
import { StatTile } from '../stat-tile/stat-tile';
import { formatDuration, percent } from '../stats/format';
import { ACTIVITY_DAYS, StatsService } from '../stats/stats.service';
import { WeekdayChart } from '../weekday-chart/weekday-chart';

// 2 columns on phones (the last tile spans both), 3 + 2 on tablets, 5 in a row on desktops.
const TILE_SPANS = [
  'md:col-span-2 lg:col-span-1',
  'md:col-span-2 lg:col-span-1',
  'md:col-span-2 lg:col-span-1',
  'md:col-span-3 lg:col-span-1',
  'col-span-2 md:col-span-3 lg:col-span-1',
];

@Component({
  selector: 'app-dashboard-route',
  imports: [
    RouterLink,
    ActivityHeatmap,
    DeckStatsTable,
    HardestCards,
    NeedsReview,
    RangeSelector,
    SectionState,
    StatTile,
    WeekdayChart,
  ],
  templateUrl: './dashboard-route.html',
})
export class DashboardRoute {
  protected readonly stats = inject(StatsService);
  protected readonly activityDays = ACTIVITY_DAYS;

  /** No answer was ever recorded (the longest streak covers all time). */
  protected readonly isEmpty = computed(
    () => this.stats.overview.hasValue() && this.stats.overview.value().longestStreak === 0,
  );

  protected readonly tiles = computed(() => {
    if (!this.stats.overview.hasValue()) return [];
    const o = this.stats.overview.value();
    const delta =
      o.accuracy != null && o.previousAccuracy != null
        ? Math.round((o.accuracy - o.previousAccuracy) * 100)
        : null;
    return [
      {
        label: 'Success rate',
        value: percent(o.accuracy),
        detail:
          o.accuracy == null
            ? `No answers in ${o.days} days`
            : delta == null
              ? `${o.correct} of ${o.answered} right`
              : `${delta >= 0 ? '+' : '−'}${Math.abs(delta)} pts vs previous ${o.days} days`,
      },
      { label: 'Cards answered', value: o.answered.toLocaleString(), detail: `in ${o.sessions} sessions` },
      {
        label: 'Time studied',
        value: formatDuration(o.studyMs),
        detail: o.answered ? `about ${Math.round(o.studyMs / o.answered / 1000)} s per card` : '',
      },
      {
        label: 'Current streak',
        value: `${o.currentStreak} ${o.currentStreak === 1 ? 'day' : 'days'}`,
        detail: `longest: ${o.longestStreak} ${o.longestStreak === 1 ? 'day' : 'days'}`,
      },
      {
        label: 'Mastered cards',
        value: o.masteredCards.toLocaleString(),
        detail: `of ${o.studiedCards} studied`,
      },
    ].map((tile, i) => ({ ...tile, span: TILE_SPANS[i] }));
  });

  protected readonly activityTotal = computed(() =>
    this.stats.activity.hasValue() ? this.stats.activity.value().reduce((sum, d) => sum + d.answered, 0) : 0,
  );
}
