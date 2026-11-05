import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AUTH_CLIENT } from './auth-client';
import { type AuthError, toAuthError } from './auth.service';

/** main-backend's GET /api/v1/account/security. */
export type SecurityStatus = {
  twoFactorEnabled: boolean;
  /** A confirmed authenticator app, which also means backup codes exist. */
  authenticatorApp: boolean;
  /** Turning 2FA on or off and new backup codes then need the password. */
  hasPassword: boolean;
};

export type Passkey = { id: string; name?: string | null; createdAt: string | Date; backedUp: boolean; deviceType: string };

/** What setting up an authenticator app returns: shown once, never stored by the app. */
export type AuthenticatorSetup = { totpURI: string; backupCodes: string[] };

type Result<T> = { ok: T } | { error: AuthError };

const failed = (error: Parameters<typeof toAuthError>[0]) => ({ error: toAuthError(error) });

/**
 * The security settings: two-step verification and passkeys. Calls resolve to `{ ok }` or
 * `{ error }` (or `AuthError | null` when there's nothing to return), never throw.
 */
@Injectable({ providedIn: 'root' })
export class AccountSecurityService {
  private readonly client = inject(AUTH_CLIENT);
  private readonly http = inject(HttpClient);

  async status(): Promise<Result<SecurityStatus>> {
    try {
      return { ok: await firstValueFrom(this.http.get<SecurityStatus>('/api/v1/account/security')) };
    } catch {
      return { error: { message: 'Couldn’t load your security settings. Try again.' } };
    }
  }

  /** Starts the authenticator app setup. 2FA isn't on until `confirmAuthenticator` succeeds. */
  async startAuthenticator(password?: string): Promise<Result<AuthenticatorSetup>> {
    const { data, error } = await this.client.twoFactor.enable({ ...(password && { password }) });
    if (error || !data || !('totpURI' in data) || !data.totpURI) return failed(error);
    return { ok: { totpURI: data.totpURI, backupCodes: data.backupCodes ?? [] } };
  }

  /** The first code from the app proves it is set up; it turns 2FA on. */
  async confirmAuthenticator(code: string): Promise<AuthError | null> {
    const { error } = await this.client.twoFactor.verifyTotp({ code: code.trim() });
    return error ? toAuthError(error) : null;
  }

  async sendEmailCode(): Promise<AuthError | null> {
    const { error } = await this.client.twoFactor.sendOtp();
    return error ? toAuthError(error) : null;
  }

  /** Entering a code that reached the inbox proves email works; it turns 2FA on with email codes. */
  async confirmEmailCodes(code: string): Promise<AuthError | null> {
    const { error } = await this.client.twoFactor.verifyOtp({ code: code.trim() });
    return error ? toAuthError(error) : null;
  }

  /** Turns every second factor off: the authenticator app, email codes and backup codes. */
  async disableTwoFactor(password?: string): Promise<AuthError | null> {
    const { error } = await this.client.twoFactor.disable({ ...(password && { password }) });
    return error ? toAuthError(error) : null;
  }

  /** Replaces every backup code. */
  async regenerateBackupCodes(password?: string): Promise<Result<string[]>> {
    const { data, error } = await this.client.twoFactor.generateBackupCodes({ ...(password && { password }) });
    if (error || !data) return failed(error);
    return { ok: data.backupCodes };
  }

  async passkeys(): Promise<Result<Passkey[]>> {
    const { data, error } = await this.client.passkey.listUserPasskeys();
    if (error || !data) return failed(error);
    return { ok: data as Passkey[] };
  }

  async addPasskey(name: string): Promise<AuthError | null> {
    const result = await this.client.passkey.addPasskey({ name: name.trim() || undefined });
    return result?.error ? toAuthError(result.error) : null;
  }

  async renamePasskey(id: string, name: string): Promise<AuthError | null> {
    const { error } = await this.client.passkey.updatePasskey({ id, name: name.trim() });
    return error ? toAuthError(error) : null;
  }

  async deletePasskey(id: string): Promise<AuthError | null> {
    const { error } = await this.client.passkey.deletePasskey({ id });
    return error ? toAuthError(error) : null;
  }
}
