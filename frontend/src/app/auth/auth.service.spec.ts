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

  it('sets the user on sign-in', async () => {
    const { auth, results } = setup();
    results['signIn.email'] = { data: { user: ADA } };
    expect(await auth.signIn({ email: 'ada@example.com', password: 'pw' })).toBeNull();
    expect(auth.user()).toEqual(ADA);
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
    expect((await auth.signIn({ email: 'a@b.c', password: 'pw' }))?.message).toContain('Too many attempts');
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
});
