import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthCard } from '../auth-card/auth-card';
import { type AuthError, AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-forgot-password-route',
  imports: [AuthCard, RouterLink],
  templateUrl: './forgot-password-route.html',
})
export class ForgotPasswordRoute {
  private readonly auth = inject(AuthService);

  protected readonly email = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<AuthError | null>(null);
  protected readonly sent = signal(false);

  async submit(event: Event) {
    event.preventDefault();
    this.busy.set(true);
    const failure = await this.auth.requestPasswordReset(this.email().trim());
    this.busy.set(false);
    this.failure.set(failure);
    this.sent.set(!failure);
  }
}
