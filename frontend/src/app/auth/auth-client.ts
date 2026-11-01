import { InjectionToken } from '@angular/core';
import { createAuthClient } from 'better-auth/client';

/** Matches main-backend's AUTH_BASE_PATH. */
export const AUTH_BASE_PATH = '/api/v1/auth';

export function createRemainAuthClient() {
  return createAuthClient({ baseURL: location.origin, basePath: AUTH_BASE_PATH });
}

export type RemainAuthClient = ReturnType<typeof createRemainAuthClient>;

/** The better-auth client. A token so specs can provide a fake. */
export const AUTH_CLIENT = new InjectionToken<RemainAuthClient>('AUTH_CLIENT', {
  providedIn: 'root',
  factory: createRemainAuthClient,
});
