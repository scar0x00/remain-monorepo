import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { AccountSecurityService, type Passkey } from '../auth/account-security.service';
import { type AuthError, PASSKEY_CANCELLED } from '../auth/auth.service';

/** Lists the account's passkeys and adds, renames and removes them. */
@Component({
  selector: 'app-passkey-settings',
  imports: [DatePipe],
  templateUrl: './passkey-settings.html',
})
export class PasskeySettings implements OnInit {
  private readonly security = inject(AccountSecurityService);

  protected readonly supported = browserSupportsWebAuthn();
  protected readonly passkeys = signal<Passkey[] | null>(null);
  protected readonly newName = signal('');
  protected readonly editing = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly removing = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<AuthError | null>(null);

  async ngOnInit() {
    await this.load();
  }

  private async load() {
    const result = await this.security.passkeys();
    if ('error' in result) this.failure.set(result.error);
    else this.passkeys.set(result.ok);
  }

  private async run(action: () => Promise<AuthError | null>) {
    this.busy.set(true);
    const failure = await action();
    this.busy.set(false);
    // Closing the browser's dialog isn't an error worth showing.
    this.failure.set(failure?.code === PASSKEY_CANCELLED || failure?.code === 'ERROR_CEREMONY_ABORTED' ? null : failure);
    if (!failure) await this.load();
    return !failure;
  }

  async add(event: Event) {
    event.preventDefault();
    if (await this.run(() => this.security.addPasskey(this.newName()))) this.newName.set('');
  }

  startRename(passkey: Passkey) {
    this.removing.set(null);
    this.editing.set(passkey.id);
    this.editName.set(passkey.name ?? '');
  }

  async rename(event: Event, id: string) {
    event.preventDefault();
    if (await this.run(() => this.security.renamePasskey(id, this.editName()))) this.editing.set(null);
  }

  async remove(id: string) {
    if (await this.run(() => this.security.deletePasskey(id))) this.removing.set(null);
  }
}
