import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DeckStats } from '../../types/Stats';
import { daysSince, displayDeckName, percent, relativeDay, studyLink } from '../stats/format';

/** Decks not studied for this many days need review. */
export const STALE_AFTER_DAYS = 14;
/** Decks under this success rate need review. */
export const LOW_ACCURACY = 0.6;
const MAX_ITEMS = 5;

/** Studied decks that are going stale or have a low success rate, worst first. */
export function decksNeedingReview(decks: DeckStats[], now = new Date()) {
  return decks
    .filter((d) => d.exists && d.totalSessions > 0)
    .map((d) => {
      const idle = daysSince(d.lastStudied, now);
      const stale = idle >= STALE_AFTER_DAYS;
      const low = d.accuracy != null && d.accuracy < LOW_ACCURACY;
      const reasons = [
        ...(low ? [`Success ${percent(d.accuracy)}`] : []),
        ...(stale ? [`last studied ${relativeDay(d.lastStudied, now).toLowerCase()}`] : []),
      ];
      return { deck: d, stale, low, idle, reason: capitalize(reasons.join(' · ')) };
    })
    .filter((r) => r.stale || r.low)
    // Both problems first, then lowest success, then longest idle.
    .sort(
      (a, b) =>
        Number(b.stale && b.low) - Number(a.stale && a.low) ||
        (a.deck.accuracy ?? 1) - (b.deck.accuracy ?? 1) ||
        b.idle - a.idle,
    )
    .slice(0, MAX_ITEMS)
    .map((r) => ({
      deckName: r.deck.deckName,
      title: displayDeckName(r.deck.deckName),
      reason: r.reason,
      study: studyLink(r.deck.deckName),
    }));
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

@Component({
  selector: 'app-needs-review',
  imports: [RouterLink],
  template: `
    <h2 class="text-lg font-semibold text-app-text">Needs review</h2>
    <p class="text-sm text-app-text-muted">Not studied for {{ staleDays }}+ days, or success under {{ lowPercent }}%.</p>
    @if (items().length) {
      <ul class="flex flex-col gap-2 mt-1">
        @for (item of items(); track item.deckName) {
          <li class="flex items-center justify-between gap-3 rounded-xl border border-app-border px-3 py-2.5">
            <a class="min-w-0" [routerLink]="['/dashboard/decks', item.deckName]">
              <span class="block font-semibold text-sm text-app-text truncate">{{ item.title }}</span>
              <span class="block text-xs text-app-text-muted">{{ item.reason }}</span>
            </a>
            @if (item.study) {
              <a class="shrink-0 inline-flex items-center rounded-full bg-app-text-muted text-app-bg px-4 py-2 text-sm font-bold"
                [routerLink]="item.study" [attr.aria-label]="'Review ' + item.title">Review</a>
            }
          </li>
        }
      </ul>
    } @else {
      <p class="text-sm text-app-text mt-1">All caught up. Every deck you study is fresh and above {{ lowPercent }}%.</p>
    }
  `,
  host: { class: 'flex flex-col gap-2 rounded-xl border border-app-border bg-app-card/40 p-4 sm:p-5 min-w-0' },
})
export class NeedsReview {
  readonly decks = input.required<DeckStats[]>();
  protected readonly items = computed(() => decksNeedingReview(this.decks()));
  protected readonly staleDays = STALE_AFTER_DAYS;
  protected readonly lowPercent = LOW_ACCURACY * 100;
}
