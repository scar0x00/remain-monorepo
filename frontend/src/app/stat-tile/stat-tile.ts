import { Component, input } from '@angular/core';

/** One headline number with a label and a short line of context. */
@Component({
  selector: 'app-stat-tile',
  host: { class: 'flex flex-col gap-1 rounded-xl border border-app-border bg-app-card/40 px-4 py-3 sm:px-5 sm:py-4 min-w-0' },
  template: `
    <p class="text-sm text-app-text-muted">{{ label() }}</p>
    <p class="text-2xl sm:text-3xl font-bold leading-tight tracking-tight tabular-nums text-app-text">{{ value() }}</p>
    @if (detail()) {
      <p class="text-xs text-app-text-subtle">{{ detail() }}</p>
    }
  `,
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly detail = input<string>();
}
