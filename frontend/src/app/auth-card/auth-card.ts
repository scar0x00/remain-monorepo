import { Component, input } from '@angular/core';

/** The frame every sign-in, sign-up and recovery page shares: a heading and a card for the form. */
@Component({
  selector: 'app-auth-card',
  template: `
    <section class="mx-auto flex w-full max-w-sm flex-col gap-6 text-app-text">
      <header class="flex flex-col gap-2 text-center">
        <h1 class="text-3xl font-bold leading-tight tracking-tight">{{ heading() }}</h1>
        @if (subheading()) {
          <p class="text-app-text-muted leading-relaxed">{{ subheading() }}</p>
        }
      </header>
      <div class="flex flex-col gap-5 rounded-xl bg-app-card p-6 shadow-e3">
        <ng-content />
      </div>
      <ng-content select="[footer]" />
    </section>
  `,
})
export class AuthCard {
  readonly heading = input.required<string>();
  readonly subheading = input<string>();
}
