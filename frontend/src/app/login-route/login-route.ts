import { Component, DestroyRef, afterNextRender, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { WebAuthnAbortService, browserSupportsWebAuthn, browserSupportsWebAuthnAutofill } from '@simplewebauthn/browser';
import { AuthCard } from '../auth-card/auth-card';
import { type AuthError, AuthService, PASSKEY_CANCELLED, isTwoFactorChallenge } from '../auth/auth.service';
import { safeReturnTo } from '../auth/safe-return-to';

@Component({
  selector: 'app-login-route',
  imports: [AuthCard, RouterLink],
  templateUrl: './login-route.html',
})
export class LoginRoute {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Query params: where to go after signing in, and an error from a failed GitHub sign-in. */
  readonly returnTo = input<string>();
  readonly error = input<string>();

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<AuthError | null>(null);
  protected readonly resent = signal(false);
  protected readonly passkeys = browserSupportsWebAuthn();

  constructor() {
    // Passkey autofill: the browser offers saved passkeys in the email field's suggestions. The
    // request waits until one is picked, so it is cancelled when the page goes away.
    afterNextRender(async () => {
      if (!(await browserSupportsWebAuthnAutofill())) return;
      const failure = await this.auth.signInWithPasskey(true);
      if (!failure) await this.router.navigateByUrl(this.target());
      else if (failure.code !== PASSKEY_CANCELLED && failure.code !== 'ERROR_CEREMONY_ABORTED') this.failure.set(failure);
    });
    inject(DestroyRef).onDestroy(() => WebAuthnAbortService.cancelCeremony());
  }

  protected target() {
    return safeReturnTo(this.returnTo());
  }

  async submit(event: Event) {
    event.preventDefault();
    this.busy.set(true);
    this.resent.set(false);
    const result = await this.auth.signIn({ email: this.email().trim(), password: this.password() });
    this.busy.set(false);
    if (isTwoFactorChallenge(result)) {
      await this.router.navigate(['/login/two-factor'], {
        queryParams: { returnTo: this.target(), methods: result.twoFactor.join(',') },
      });
      return;
    }
    this.failure.set(result);
    if (!result) await this.router.navigateByUrl(this.target());
  }

  async passkey() {
    this.busy.set(true);
    this.failure.set(null);
    const failure = await this.auth.signInWithPasskey();
    this.busy.set(false);
    if (!failure) await this.router.navigateByUrl(this.target());
    else if (failure.code !== PASSKEY_CANCELLED) this.failure.set(failure);
  }

  async github() {
    this.busy.set(true);
    const failure = await this.auth.signInWithGithub(this.target());
    // On success the browser is already leaving for GitHub.
    if (failure) {
      this.busy.set(false);
      this.failure.set(failure);
    }
  }

  async resend() {
    this.busy.set(true);
    const failure = await this.auth.resendVerification(this.email().trim());
    this.busy.set(false);
    if (failure) this.failure.set(failure);
    else this.resent.set(true);
  }
}
