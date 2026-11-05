import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { type AuthenticatorSetup, AccountSecurityService, type SecurityStatus } from '../auth/account-security.service';
import { type AuthError } from '../auth/auth.service';
import { BackupCodes } from '../backup-codes/backup-codes';
import { QrCode } from '../qr-code/qr-code';

/**
 * Where the section is. Setting up the app is password (if the account has one) → scan → confirm a
 * code → save backup codes. Email codes are send → confirm. Turning off and new backup codes are
 * confirmed first, with the password when the account has one.
 */
type Step =
  | 'idle'
  | 'app-password'
  | 'app-scan'
  | 'app-saved-codes'
  | 'email-code'
  | 'disable'
  | 'regenerate'
  | 'regenerated-codes';

@Component({
  selector: 'app-two-factor-settings',
  imports: [BackupCodes, NgTemplateOutlet, QrCode],
  templateUrl: './two-factor-settings.html',
})
export class TwoFactorSettings {
  private readonly security = inject(AccountSecurityService);

  readonly status = input.required<SecurityStatus>();
  /** 2FA changed: the page reloads the status. */
  readonly changed = output<void>();

  protected readonly step = signal<Step>('idle');
  protected readonly password = signal('');
  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<AuthError | null>(null);
  protected readonly setup = signal<AuthenticatorSetup | null>(null);
  protected readonly codes = signal<string[]>([]);

  /** The secret for typing into an app that can't scan, in groups of four. */
  protected readonly setupKey = computed(() => {
    const uri = this.setup()?.totpURI;
    const secret = uri ? new URL(uri).searchParams.get('secret') ?? '' : '';
    return secret.match(/.{1,4}/g)?.join(' ') ?? '';
  });

  private go(step: Step) {
    this.step.set(step);
    this.password.set('');
    this.code.set('');
    this.failure.set(null);
  }

  cancel() {
    this.setup.set(null);
    this.codes.set([]);
    this.go('idle');
  }

  private async run(action: () => Promise<AuthError | null>, next?: Step) {
    this.busy.set(true);
    const failure = await action();
    this.busy.set(false);
    this.failure.set(failure);
    if (!failure && next) this.go(next);
    return !failure;
  }

  // Authenticator app

  async startApp() {
    if (this.status().hasPassword) this.go('app-password');
    else await this.requestSetup();
  }

  async requestSetup(event?: Event) {
    event?.preventDefault();
    await this.run(async () => {
      const result = await this.security.startAuthenticator(this.password());
      if ('error' in result) return result.error;
      this.setup.set(result.ok);
      return null;
    }, 'app-scan');
  }

  async confirmApp(event: Event) {
    event.preventDefault();
    const codes = this.setup()?.backupCodes ?? [];
    if (await this.run(() => this.security.confirmAuthenticator(this.code()), 'app-saved-codes')) {
      this.codes.set(codes);
      this.setup.set(null);
      this.changed.emit();
    }
  }

  // Email codes

  async startEmail() {
    await this.run(() => this.security.sendEmailCode(), 'email-code');
  }

  async resendEmail() {
    await this.run(() => this.security.sendEmailCode());
  }

  async confirmEmail(event: Event) {
    event.preventDefault();
    if (await this.run(() => this.security.confirmEmailCodes(this.code()), 'idle')) this.changed.emit();
  }

  // Turning off and backup codes

  askDisable() {
    this.go('disable');
  }

  async disable(event: Event) {
    event.preventDefault();
    if (await this.run(() => this.security.disableTwoFactor(this.password()), 'idle')) this.changed.emit();
  }

  askRegenerate() {
    this.go('regenerate');
  }

  async regenerate(event: Event) {
    event.preventDefault();
    await this.run(async () => {
      const result = await this.security.regenerateBackupCodes(this.password());
      if ('error' in result) return result.error;
      this.codes.set(result.ok);
      return null;
    }, 'regenerated-codes');
  }
}
