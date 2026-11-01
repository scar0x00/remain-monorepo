import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter, type ActivatedRouteSnapshot, type RouterStateSnapshot } from '@angular/router';
import { AUTH_CLIENT } from './auth-client';
import { authGuard, guestGuard } from './auth.guard';
import { ADA, createFakeAuthClient } from './fake-auth-client';
import { safeReturnTo } from './safe-return-to';

describe('auth guards', () => {
  const setup = (session: { user: typeof ADA } | null) => {
    const fake = createFakeAuthClient(session);
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AUTH_CLIENT, useValue: fake.client }] });
  };
  const run = (guard: typeof authGuard, route: Partial<ActivatedRouteSnapshot>, url = '/deck-browse') =>
    TestBed.runInInjectionContext(() => guard(route as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));
  const serialize = (result: unknown) => TestBed.inject(Router).serializeUrl(result as UrlTree);

  it('lets a signed-in user through', async () => {
    setup({ user: ADA });
    expect(await run(authGuard, {})).toBe(true);
  });

  it('sends a signed-out user to the login page, remembering where they were going', async () => {
    setup(null);
    expect(serialize(await run(authGuard, {}, '/deck-study/abc?x=1'))).toBe('/login?returnTo=%2Fdeck-study%2Fabc%3Fx%3D1');
  });

  it('sends a signed-in user away from the login page', async () => {
    setup({ user: ADA });
    const route = { queryParamMap: new Map([['returnTo', '/dashboard']]) } as unknown as ActivatedRouteSnapshot;
    expect(serialize(await run(guestGuard, route))).toBe('/dashboard');
  });
});

describe('safeReturnTo', () => {
  it('keeps in-app paths and rejects everything else', () => {
    expect(safeReturnTo('/deck-study/x?y=1')).toBe('/deck-study/x?y=1');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/api/v1/auth/sign-out', '', null, undefined]) {
      expect(safeReturnTo(bad)).toBe('/deck-browse');
    }
  });
});
