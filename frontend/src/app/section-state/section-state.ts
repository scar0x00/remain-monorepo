import { Component, input, output } from '@angular/core';

/** Skeleton while a section loads, or an error with a retry button. */
@Component({
  selector: 'app-section-state',
  template: `
    @if (error()) {
      <div class="flex flex-col items-start gap-2 rounded-xl border border-app-border bg-app-card shadow-e1 p-4 sm:p-5" role="alert">
        <p class="font-semibold text-app-text">Could not load {{ what() }}</p>
        <p class="text-sm text-app-text-muted">The rest of the dashboard still works.</p>
        <button type="button" class="min-h-11 rounded-full border-2 border-app-border px-4 font-bold hover:bg-app-card text-app-text cursor-pointer"
          (click)="retry.emit()">Try again</button>
      </div>
    } @else {
      <div class="animate-pulse rounded-xl bg-app-text/10" [style.height]="height()" aria-hidden="true"></div>
    }
  `,
})
export class SectionState {
  readonly error = input(false);
  /** What failed to load, e.g. "your activity". */
  readonly what = input('this section');
  /** Skeleton height, roughly the section's real height so nothing jumps. */
  readonly height = input('10rem');
  readonly retry = output();
}
