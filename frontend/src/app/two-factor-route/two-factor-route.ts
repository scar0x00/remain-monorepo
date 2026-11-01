import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthCard } from '../auth-card/auth-card';
import { type AuthError, AuthService, type TwoFactorMethod, type TwoFactorProof } from '../auth/auth.service';
import { safeReturnTo } from '../auth/safe-return-to';

/**
 * The second step of an email + password sign-in on an account with 2FA. The password was right
 * and the server holds a short-lived pending sign-in (10 minutes); a code finishes it.
 */
@Component({
  selector: 'app-two-factor-route',
  imports: [AuthCard, RouterLink],
  templateUrl: './two-factor-route.html',
})
export class TwoFactorRoute {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Query params from the login page: where to go next, and the methods the server offered. */
  readonly returnTo = input<string>();
  readonly methods = input<string>();

  private readonly offered = computed(() =>
    (this.methods() ?? '').split(',').filter((m): m is TwoFactorMethod => m === 'totp' || m === 'otp'),
  );
  protected readonly hasApp = computed(() => this.offered().includes('totp'));
  protected readonly hasEmail = computed(() => this.offered().includes('otp'));

  /** The method in use: the authenticator app first when there is one. */
  private readonly chosen = signal<TwoFactorProof | null>(null);
  protected readonly proof = computed<TwoFactorProof>(() => this.chosen() ?? (this.hasApp() ? 'totp' : 'otp'));

  protected readonly code = signal('');
  protected readonly trustDevice = signal(false);
  protected readonly busy = signal(false);
  protected readonly failure = signal<AuthError | null>(null);
  protected readonly emailSent = signal(false);

  protected readonly subheading = computed(() => {
    switch (this.proof()) {
      case 'totp':
        return 'Enter the code from your authenticator app.';
      case 'otp':
        return 'Enter the code we emailed you.';
      default:
        return 'Enter one of the backup codes you saved. Each works once.';
    }
  });

  protected readonly loginLink = computed(() => ({ returnTo: safeReturnTo(this.returnTo()) }));

  use(proof: TwoFactorProof) {
    this.chosen.set(proof);
    this.code.set('');
    this.failure.set(null);
  }

  async sendEmail() {
    this.busy.set(true);
    const failure = await this.auth.sendTwoFactorCode();
    this.busy.set(false);
    this.failure.set(failure);
    this.emailSent.set(!failure);
  }

  async submit(event: Event) {
    event.preventDefault();
    this.busy.set(true);
    const failure = await this.auth.verifyTwoFactor(this.proof(), this.code(), this.trustDevice());
    this.busy.set(false);
    this.failure.set(failure);
    if (!failure) await this.router.navigateByUrl(safeReturnTo(this.returnTo()));
  }
}
