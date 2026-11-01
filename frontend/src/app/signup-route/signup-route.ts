import { Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthCard } from '../auth-card/auth-card';
import { type AuthError, AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-signup-route',
  imports: [AuthCard, RouterLink],
  templateUrl: './signup-route.html',
})
export class SignupRoute {
  private readonly auth = inject(AuthService);

  readonly returnTo = input<string>();

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<AuthError | null>(null);
  /** The address the verification email went to, once sign-up worked. */
  protected readonly sentTo = signal<string | null>(null);
  protected readonly resent = signal(false);

  async submit(event: Event) {
    event.preventDefault();
    this.busy.set(true);
    const email = this.email().trim();
    const failure = await this.auth.signUp({ name: this.name().trim(), email, password: this.password() });
    this.busy.set(false);
    this.failure.set(failure);
    if (!failure) this.sentTo.set(email);
  }

  async resend() {
    const email = this.sentTo();
    if (!email) return;
    this.busy.set(true);
    const failure = await this.auth.resendVerification(email);
    this.busy.set(false);
    this.failure.set(failure);
    this.resent.set(!failure);
  }
}
