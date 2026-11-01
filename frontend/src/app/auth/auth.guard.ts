import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { safeReturnTo } from './safe-return-to';

/** Signed-in users only; everyone else goes to the login page and comes back afterwards. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready();
  return auth.isAuthenticated() || router.createUrlTree(['/login'], { queryParams: { returnTo: state.url } });
};

/** The sign-in and sign-up pages: a signed-in user goes where they were heading instead. */
export const guestGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready();
  return !auth.isAuthenticated() || router.parseUrl(safeReturnTo(route.queryParamMap.get('returnTo')));
};
