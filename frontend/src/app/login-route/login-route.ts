import { Component, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthCard } from '../auth-card/auth-card';
import { type AuthError, AuthService } from '../auth/auth.service';
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

  protected target() {
    return safeReturnTo(this.returnTo());
  }

  async submit(event: Event) {
    event.preventDefault();
    this.busy.set(true);
    this.resent.set(false);
    const failure = await this.auth.signIn({ email: this.email().trim(), password: this.password() });
    this.busy.set(false);
    this.failure.set(failure);
    if (!failure) await this.router.navigateByUrl(this.target());
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
