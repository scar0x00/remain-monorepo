import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HardCard } from '../../types/Stats';
import { displayDeckName, percent, studyLink } from '../stats/format';

/** Cards with the lowest success rate, each linking to a run of just that card. */
@Component({
  selector: 'app-hardest-cards',
  imports: [RouterLink],
  template: `
    <h2 class="text-base font-semibold text-app-text">{{ title() }}</h2>
    <p class="text-sm text-app-text-muted">Lowest success, at least 3 attempts.</p>
    @if (cards().length) {
      <ol class="flex flex-col gap-2 mt-4">
        @for (card of cards(); track card.deckName + card.cardId) {
          <li class="flex items-center gap-3 rounded-xl border border-app-border px-3 py-2.5">
            <span class="shrink-0 min-w-11 text-center rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300">
              {{ pct(card.accuracy) }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm text-app-text truncate">{{ card.cardFront || 'Card ' + card.cardId }}</span>
              <span class="block text-xs text-app-text-subtle">
                @if (showDeck()) { {{ deckTitle(card.deckName) }} · }
                {{ card.correct }} of {{ card.attempts }} right
              </span>
            </span>
            @if (study(card.deckName); as link) {
              <a class="shrink-0 text-sm font-semibold text-app-text-muted hover:text-app-text hover:underline" [routerLink]="link" [queryParams]="{ cardIds: card.cardId }"
                [attr.aria-label]="'Practice this card: ' + (card.cardFront || card.cardId)">Practice</a>
            }
          </li>
        }
      </ol>
    } @else {
      <p class="text-sm text-app-text mt-4">Nothing yet. A card shows up here after 3 attempts with a miss.</p>
    }
  `,
  host: { class: 'flex flex-col gap-1 rounded-xl border border-app-border bg-app-card shadow-e1 p-4 sm:p-5 min-w-0' },
})
export class HardestCards {
  readonly cards = input.required<HardCard[]>();
  readonly title = input('Cards you keep missing');
  /** Show each card's deck; off on a single deck's page. */
  readonly showDeck = input(true);

  protected readonly pct = percent;
  protected readonly deckTitle = displayDeckName;
  protected readonly study = studyLink;
}
