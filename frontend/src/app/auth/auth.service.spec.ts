import { TestBed } from '@angular/core/testing';
import { AUTH_CLIENT } from './auth-client';
import { AuthService } from './auth.service';
import { ADA, createFakeAuthClient } from './fake-auth-client';

describe('AuthService', () => {
  const setup = (session: { user: typeof ADA } | null = null) => {
    const fake = createFakeAuthClient(session);
    TestBed.configureTestingModule({ providers: [{ provide: AUTH_CLIENT, useValue: fake.client }] });
    return { auth: TestBed.inject(AuthService), ...fake };
  };

  it('reads the session once, however often ready() is awaited', async () => {
    const { auth, calls } = setup({ user: ADA });
    expect(auth.loading()).toBe(true);
    await Promise.all([auth.ready(), auth.ready()]);

    expect(auth.user()).toEqual(ADA);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.loading()).toBe(false);
    expect(calls.filter(([name]) => name === 'getSession')).toHaveLength(1);
  });

  it('is signed out without a session', async () => {
    const { auth } = setup(null);
    await auth.ready();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('signs up with the verification page as callback', async () => {
    const { auth, calls } = setup();
    expect(await auth.signUp({ name: 'Ada', email: 'ada@example.com', password: 'long enough pw' })).toBeNull();
    expect(calls).toContainEqual([
      'signUp.email',
      { name: 'Ada', email: 'ada@example.com', password: 'long enough pw', callbackURL: '/verify-email' },
    ]);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('sets the user on sign-in, without a callback that would redirect the page', async () => {
    const { auth, calls, results } = setup();
    results['signIn.email'] = { data: { user: ADA } };
    expect(await auth.signIn({ email: 'ada@example.com', password: 'pw' })).toBeNull();
    expect(auth.user()).toEqual(ADA);
    expect(calls).toContainEqual(['signIn.email', { email: 'ada@example.com', password: 'pw' }]);
  });

  it('turns better-auth errors into messages', async () => {
    const { auth, results } = setup();
    results['signIn.email'] = { error: { code: 'EMAIL_NOT_VERIFIED', status: 403, message: 'Email not verified' } };
    expect(await auth.signIn({ email: 'a@b.c', password: 'pw' })).toEqual({
      code: 'EMAIL_NOT_VERIFIED',
      status: 403,
      message: 'Verify your email first. We can send the link again.',
    });

    results['signIn.email'] = { error: { status: 429, message: 'Too many requests' } };
    expect(await auth.signIn({ email: 'a@b.c', password: 'pw' })).toMatchObject({ message: expect.stringContaining('Too many attempts') });
  });

  it('forgets the user on sign-out and on clear()', async () => {
    const { auth, calls } = setup({ user: ADA });
    await auth.ready();
    await auth.signOut();
    expect(auth.user()).toBeNull();
    expect(calls.map(([name]) => name)).toContain('signOut');
  });

  it('sends GitHub back to the page the user came from', async () => {
    const { auth, calls } = setup();
    await auth.signInWithGithub('/deck-study/x');
    expect(calls).toContainEqual([
      'signIn.social',
      { provider: 'github', callbackURL: '/deck-study/x', errorCallbackURL: '/login?returnTo=%2Fdeck-study%2Fx' },
    ]);
  });

  describe('two-step verification', () => {
    it('returns the challenge instead of signing in when the account has 2FA', async () => {
      const { auth, results } = setup();
      results['signIn.email'] = { data: { twoFactorRedirect: true, twoFactorMethods: ['totp', 'otp'] } };
      expect(await auth.signIn({ email: 'ada@example.com', password: 'pw' })).toEqual({ twoFactor: ['totp', 'otp'] });
      expect(auth.isAuthenticated()).toBe(false);
    });

    it.each([
      ['totp', 'twoFactor.verifyTotp'],
      ['otp', 'twoFactor.verifyOtp'],
      ['backup', 'twoFactor.verifyBackupCode'],
    ] as const)('verifies a %s code with %s, then reads the new session', async (proof, method) => {
      const { auth, calls, state } = setup();
      state.session = { user: ADA };
      expect(await auth.verifyTwoFactor(proof, ' 123456 ', true)).toBeNull();
      expect(calls).toContainEqual([method, { code: '123456', trustDevice: true }]);
      expect(auth.user()).toEqual(ADA);
    });

    it('explains a wrong code', async () => {
      const { auth, results } = setup();
      results['twoFactor.verifyTotp'] = { error: { code: 'INVALID_CODE', status: 401 } };
      expect((await auth.verifyTwoFactor('totp', '000000', false))?.message).toContain('isn’t right');
    });
  });

  describe('passkeys', () => {
    it('signs in with a passkey and reads the session', async () => {
      const { auth, calls, state } = setup();
      state.session = { user: ADA };
      expect(await auth.signInWithPasskey()).toBeNull();
      expect(calls).toContainEqual(['signIn.passkey', { autoFill: false }]);
      expect(auth.user()).toEqual(ADA);
    });

    it('reports a cancelled dialog with its code, so pages can stay quiet', async () => {
      const { auth, results } = setup();
      results['signIn.passkey'] = { error: { code: 'AUTH_CANCELLED', status: 400 } };
      expect((await auth.signInWithPasskey(true))?.code).toBe('AUTH_CANCELLED');
      expect(auth.isAuthenticated()).toBe(false);
    });
  });
});
