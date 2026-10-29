import { Component, model } from '@angular/core';
import { RANGE_OPTIONS, RangeDays } from '../stats/stats.service';

/** Segmented control for the 7 / 30 / 90 day window. */
@Component({
  selector: 'app-range-selector',
  template: `
    <div role="group" aria-label="Date range" class="flex w-full sm:w-auto">
      @for (option of options; track option; let first = $first; let last = $last) {
        <button type="button"
          class="flex-1 sm:flex-none min-h-11 px-4 text-sm border border-app-border -ml-px first:ml-0 cursor-pointer"
          [class.rounded-l-full]="first" [class.rounded-r-full]="last"
          [class]="days() === option ? 'bg-action text-app-bg border-action font-semibold' : 'text-app-text-muted hover:bg-app-card'"
          [attr.aria-pressed]="days() === option"
          (click)="days.set(option)">
          {{ option }} days
        </button>
      }
    </div>
  `,
})
export class RangeSelector {
  readonly days = model.required<RangeDays>();
  protected readonly options = RANGE_OPTIONS;
}
