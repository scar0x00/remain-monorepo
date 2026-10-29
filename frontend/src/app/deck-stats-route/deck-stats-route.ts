import { httpResource } from '@angular/common/http';
import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DeckStatsDetail } from '../../types/Stats';
import { AccuracyChart } from '../accuracy-chart/accuracy-chart';
import { HardestCards } from '../hardest-cards/hardest-cards';
import { RangeSelector } from '../range-selector/range-selector';
import { SectionState } from '../section-state/section-state';
import { StatTile } from '../stat-tile/stat-tile';
import { displayDeckName, formatDuration, percent, relativeDay, studyLink } from '../stats/format';
import { StatsService } from '../stats/stats.service';

/** Stats for one deck: success over time, hardest cards and recent sessions. */
@Component({
  selector: 'app-deck-stats-route',
  imports: [RouterLink, AccuracyChart, HardestCards, RangeSelector, SectionState, StatTile],
  templateUrl: './deck-stats-route.html',
})
export class DeckStatsRoute {
  /** Deck file name, from the route. */
  readonly name = input.required<string>();

  protected readonly stats = inject(StatsService);
  protected readonly deck = httpResource<DeckStatsDetail>(
    () => `/api/v1/stats/decks/${encodeURIComponent(this.name())}?${this.stats.rangeQuery()}`,
  );

  /** The loaded deck, or undefined while loading or after an error (value() throws then). */
  protected readonly detail = computed(() => (this.deck.hasValue() ? this.deck.value() : undefined));

  protected readonly title = computed(() => displayDeckName(this.name()));
  protected readonly study = computed(() => studyLink(this.name()));
  protected readonly lastStudied = computed(() => relativeDay(this.detail()?.lastStudied ?? null).toLowerCase());
  protected readonly notFound = computed(() => {
    const error = this.deck.error() as { status?: number } | undefined;
    return error?.status === 404;
  });

  /** All hardest cards of this deck as one practice run. */
  protected readonly practiceIds = computed(() =>
    (this.detail()?.hardestCards ?? []).map((c) => c.cardId).join(','),
  );

  protected readonly tiles = computed(() => {
    const d = this.detail();
    if (!d) return [];
    return [
      { label: `Success, ${this.stats.days()} days`, value: percent(d.accuracy), detail: `${d.correct} of ${d.answered} right` },
      { label: 'Last session', value: percent(d.lastSessionAccuracy), detail: relativeDay(d.lastStudied) },
      {
        label: 'Mastered',
        value: d.cardCount ? `${d.masteredCards} / ${d.cardCount}` : String(d.masteredCards),
        detail: d.cardCount ? `${percent(d.masteredCards / d.cardCount)} of the deck` : `of ${d.studiedCards} studied`,
      },
      { label: 'Sessions', value: String(d.totalSessions), detail: `${d.sessions} in ${this.stats.days()} days` },
    ];
  });

  protected readonly sessionRows = computed(() =>
    (this.detail()?.recentSessions ?? []).slice(0, 10).map((s) => ({
      id: s.id,
      when: new Date(s.startedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      detail: `${s.correct} of ${s.answered} right · ${formatDuration(s.studyMs)}`,
      accuracy: percent(s.accuracy),
      status: s.status === 'completed' ? '' : s.status === 'abandoned' ? 'Stopped early' : 'In progress',
    })),
  );
}
