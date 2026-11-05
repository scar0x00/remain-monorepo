import { Injectable, computed, inject, signal } from '@angular/core';
import { AUTH_CLIENT } from './auth-client';

export type AuthUser = { id: string; name: string; email: string; image?: string | null; emailVerified: boolean };

/** What a failed auth call tells the UI: a message to show and better-auth's code, if any. */
export type AuthError = { message: string; code?: string; status?: number };

/** Second factors the server offers after a password sign-in. Backup codes come with `totp`. */
export type TwoFactorMethod = 'totp' | 'otp';

/** The password was right, but the account has 2FA: no session until a code is verified. */
export type TwoFactorChallenge = { twoFactor: TwoFactorMethod[] };

/** How a second factor is proven: an authenticator app code, an emailed code or a backup code. */
export type TwoFactorProof = 'totp' | 'otp' | 'backup';

/** The user closed or cancelled the browser's passkey dialog: not worth a message. */
export const PASSKEY_CANCELLED = 'AUTH_CANCELLED';

export const isTwoFactorChallenge = (value: unknown): value is TwoFactorChallenge =>
  typeof value === 'object' && value !== null && 'twoFactor' in value;

type ClientError = { message?: string; code?: string; status?: number; statusText?: string } | null | undefined;

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'That email and password don’t match an account.',
  EMAIL_NOT_VERIFIED: 'Verify your email first. We can send the link again.',
  USER_ALREADY_EXISTS: 'There is already an account with that email. Sign in instead.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'There is already an account with that email. Sign in instead.',
  PASSWORD_TOO_SHORT: 'Use at least 10 characters for your password.',
  INVALID_TOKEN: 'This link is invalid or has expired. Ask for a new one.',
  INVALID_PASSWORD: 'That password isn’t right.',
  INVALID_CODE: 'That code isn’t right. Check it and try again.',
  INVALID_BACKUP_CODE: 'That backup code isn’t right, or it was already used.',
  OTP_HAS_EXPIRED: 'That code has expired. Send a new one.',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'Too many wrong codes. Send a new one.',
  ACCOUNT_TEMPORARILY_LOCKED: 'Too many wrong codes. Wait 15 minutes, then sign in again.',
  INVALID_TWO_FACTOR_COOKIE: 'This sign-in has expired. Sign in again.',
  PASSKEY_NOT_FOUND: 'That passkey isn’t registered with Remain. Sign in another way, then add it under Security.',
  AUTHENTICATION_FAILED: 'That passkey didn’t work. Try again or sign in another way.',
  PREVIOUSLY_REGISTERED: 'This passkey is already registered.',
  ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED: 'This passkey is already registered.',
};

export function toAuthError(error: ClientError): AuthError {
  const code = error?.code;
  if (error?.status === 429) return { message: 'Too many attempts. Wait a minute and try again.', code, status: 429 };
  return {
    message: (code && MESSAGES[code]) || error?.message || error?.statusText || 'Something went wrong. Try again.',
    code,
    status: error?.status,
  };
}

/**
 * The signed-in user, from better-auth. The session is read once on start; sign-in and sign-out
 * update it. Calls resolve to an `AuthError` on failure and `null` on success, so components never
 * deal with thrown errors.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly client = inject(AUTH_CLIENT);

  private readonly current = signal<AuthUser | null>(null);
  private readonly pending = signal(true);
  private loaded: Promise<void> | undefined;

  readonly user = this.current.asReadonly();
  readonly loading = this.pending.asReadonly();
  readonly isAuthenticated = computed(() => this.current() !== null);

  /** Resolves once the session has been read at least once. */
  ready(): Promise<void> {
    return (this.loaded ??= this.refresh());
  }

  /** Reads the session from the server again. */
  async refresh(): Promise<void> {
    this.pending.set(true);
    try {
      const { data } = await this.client.getSession();
      this.current.set((data?.user as AuthUser | undefined) ?? null);
    } catch {
      this.current.set(null);
    } finally {
      this.pending.set(false);
    }
  }

  /** The session ended on the server (a 401 from the API). */
  clear() {
    this.current.set(null);
  }

  /** Creates the account and sends the verification email. The user is signed in once they verify. */
  async signUp(input: { name: string; email: string; password: string }): Promise<AuthError | null> {
    const { error } = await this.client.signUp.email({ ...input, callbackURL: '/verify-email' });
    return error ? toAuthError(error) : null;
  }

  /**
   * Signs in without a `callbackURL`: with one, better-auth's client answers success by setting
   * `window.location` to it, which would race the caller's own navigation to `returnTo`.
   */
  async signIn(input: {
    email: string;
    password: string;
    rememberMe?: boolean;
  }): Promise<AuthError | TwoFactorChallenge | null> {
    const { data, error } = await this.client.signIn.email(input);
    if (error) return toAuthError(error);
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      const methods = (data as { twoFactorMethods?: TwoFactorMethod[] }).twoFactorMethods ?? [];
      return { twoFactor: methods };
    }
    this.current.set(((data as { user?: AuthUser } | null)?.user) ?? null);
    return null;
  }

  /**
   * Finishes a sign-in that asked for a second factor. `trustDevice` skips the code on this browser
   * for 30 days.
   */
  async verifyTwoFactor(proof: TwoFactorProof, code: string, trustDevice: boolean): Promise<AuthError | null> {
    const input = { code: code.trim(), trustDevice };
    const { error } =
      proof === 'totp'
        ? await this.client.twoFactor.verifyTotp(input)
        : proof === 'otp'
          ? await this.client.twoFactor.verifyOtp(input)
          : await this.client.twoFactor.verifyBackupCode(input);
    if (error) return toAuthError(error);
    await this.refresh();
    return null;
  }

  /** Emails a code: during a sign-in challenge, or from the settings page with a session. */
  async sendTwoFactorCode(): Promise<AuthError | null> {
    const { error } = await this.client.twoFactor.sendOtp();
    return error ? toAuthError(error) : null;
  }

  /**
   * Signs in with a passkey. With `autoFill`, waits for the user to pick one from the email field's
   * autofill (conditional UI) instead of opening the browser's dialog. A cancelled dialog resolves to
   * an error with code `PASSKEY_CANCELLED`.
   */
  async signInWithPasskey(autoFill = false): Promise<AuthError | null> {
    const { error } = await this.client.signIn.passkey({ autoFill });
    if (error) return toAuthError(error);
    await this.refresh();
    return null;
  }

  /** Leaves the app for GitHub; it comes back to `returnTo`. */
  async signInWithGithub(returnTo: string): Promise<AuthError | null> {
    const { error } = await this.client.signIn.social({
      provider: 'github',
      callbackURL: returnTo,
      errorCallbackURL: `/login?returnTo=${encodeURIComponent(returnTo)}`,
    });
    return error ? toAuthError(error) : null;
  }

  async signOut(): Promise<void> {
    await this.client.signOut();
    this.current.set(null);
  }

  async resendVerification(email: string): Promise<AuthError | null> {
    const { error } = await this.client.sendVerificationEmail({ email, callbackURL: '/verify-email' });
    return error ? toAuthError(error) : null;
  }

  /** Always succeeds for unknown emails too, so the page can't be used to find accounts. */
  async requestPasswordReset(email: string): Promise<AuthError | null> {
    const { error } = await this.client.requestPasswordReset({ email, redirectTo: '/reset-password' });
    return error ? toAuthError(error) : null;
  }

  async resetPassword(token: string, newPassword: string): Promise<AuthError | null> {
    const { error } = await this.client.resetPassword({ token, newPassword });
    return error ? toAuthError(error) : null;
  }
}
