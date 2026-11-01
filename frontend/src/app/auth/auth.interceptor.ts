import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AUTH_BASE_PATH } from './auth-client';
import { AuthService } from './auth.service';

/** A 401 from the API means the session ended (signed out elsewhere, expired): go to the login page. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      const url = new URL(req.url, location.origin).pathname;
      if (error instanceof HttpErrorResponse && error.status === 401 && url.startsWith('/api/') && !url.startsWith(AUTH_BASE_PATH)) {
        auth.clear();
        void router.navigate(['/login'], { queryParams: { returnTo: router.url } });
      }
      return throwError(() => error);
    }),
  );
};
