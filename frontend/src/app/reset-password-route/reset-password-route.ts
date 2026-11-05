import { Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthCard } from '../auth-card/auth-card';
import { type AuthError, AuthService } from '../auth/auth.service';

/** Where the reset link lands: better-auth redirects here with `?token=`, or `?error=` if it expired. */
@Component({
  selector: 'app-reset-password-route',
  imports: [AuthCard, RouterLink],
  templateUrl: './reset-password-route.html',
})
export class ResetPasswordRoute {
  private readonly auth = inject(AuthService);

  readonly token = input<string>();
  readonly error = input<string>();

  protected readonly password = signal('');
  protected readonly confirm = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<AuthError | null>(null);
  protected readonly done = signal(false);

  async submit(event: Event) {
    event.preventDefault();
    const token = this.token();
    if (!token) return;
    if (this.password() !== this.confirm()) {
      this.failure.set({ message: 'The passwords don’t match.' });
      return;
    }
    this.busy.set(true);
    const failure = await this.auth.resetPassword(token, this.password());
    this.busy.set(false);
    this.failure.set(failure);
    this.done.set(!failure);
  }
}
