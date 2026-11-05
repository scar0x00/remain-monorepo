import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthCard } from '../auth-card/auth-card';
import { type AuthError, AuthService } from '../auth/auth.service';

/**
 * Where the verification link lands. better-auth has already verified the email and signed the
 * user in, or redirected here with `?error=` when the link was invalid or expired.
 */
@Component({
  selector: 'app-verify-email-route',
  imports: [AuthCard, RouterLink],
  templateUrl: './verify-email-route.html',
})
export class VerifyEmailRoute implements OnInit {
  protected readonly auth = inject(AuthService);

  readonly error = input<string>();

  protected readonly checking = signal(true);
  protected readonly email = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<AuthError | null>(null);
  protected readonly resent = signal(false);

  async ngOnInit() {
    // The session cookie was set by the redirect, after the app read the session on start.
    await this.auth.refresh();
    this.checking.set(false);
  }

  async resend(event: Event) {
    event.preventDefault();
    this.busy.set(true);
    const failure = await this.auth.resendVerification(this.email().trim());
    this.busy.set(false);
    this.failure.set(failure);
    this.resent.set(!failure);
  }
}
