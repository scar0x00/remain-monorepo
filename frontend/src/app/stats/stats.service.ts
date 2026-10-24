import { httpResource } from '@angular/common/http';
import { Service, computed, signal } from '@angular/core';
import { ActivityDay, DeckStats, HardCard, StatsOverview } from '../../types/Stats';

export const RANGE_OPTIONS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_OPTIONS)[number];
/** The heatmap always shows 12 weeks, whatever range is selected. */
export const ACTIVITY_DAYS = 84;

/**
 * Dashboard data. Provided on the `dashboard` route, so the dashboard and the deck stats page share
 * the selected range. Each endpoint is its own resource, so sections load and fail independently.
 */
@Service({ autoProvided: false })
export class StatsService {
  readonly days = signal<RangeDays>(30);
  readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  /** `days` and `tz` query string for the selected range. */
  readonly rangeQuery = computed(() => `days=${this.days()}&tz=${encodeURIComponent(this.timeZone)}`);

  readonly overview = httpResource<StatsOverview>(() => `/api/v1/stats/overview?${this.rangeQuery()}`);
  readonly activity = httpResource<ActivityDay[]>(
    () => `/api/v1/stats/activity?days=${ACTIVITY_DAYS}&tz=${encodeURIComponent(this.timeZone)}`,
  );
  readonly decks = httpResource<DeckStats[]>(() => `/api/v1/stats/decks?${this.rangeQuery()}`);
  readonly hardestCards = httpResource<HardCard[]>(() => `/api/v1/stats/hardest-cards?limit=5`);
}
