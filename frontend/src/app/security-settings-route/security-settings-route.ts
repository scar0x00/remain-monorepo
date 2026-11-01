import { Component, OnInit, inject, signal } from '@angular/core';
import { AccountSecurityService, type SecurityStatus } from '../auth/account-security.service';
import { AuthService } from '../auth/auth.service';
import { PasskeySettings } from '../passkey-settings/passkey-settings';
import { TwoFactorSettings } from '../two-factor-settings/two-factor-settings';

/** Settings › Security: two-step verification and passkeys. */
@Component({
  selector: 'app-security-settings-route',
  imports: [PasskeySettings, TwoFactorSettings],
  template: `
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-6 text-app-text">
      <header class="flex flex-col gap-1">
        <h1 class="text-2xl font-bold leading-tight tracking-tight">Security</h1>
        <p class="text-app-text-muted">How you sign in to Remain as {{ auth.user()?.email }}.</p>
      </header>

      @if (status(); as status) {
        <app-two-factor-settings [status]="status" (changed)="load()" />
      } @else if (failed()) {
        <p role="alert" class="text-accent">{{ failed() }}</p>
      } @else {
        <p class="text-app-text-subtle">Loading…</p>
      }

      <app-passkey-settings />
    </div>
  `,
})
export class SecuritySettingsRoute implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly security = inject(AccountSecurityService);

  protected readonly status = signal<SecurityStatus | null>(null);
  protected readonly failed = signal<string | null>(null);

  async ngOnInit() {
    await this.load();
  }

  async load() {
    const result = await this.security.status();
    if ('error' in result) this.failed.set(result.error.message);
    else this.status.set(result.ok);
  }
}
