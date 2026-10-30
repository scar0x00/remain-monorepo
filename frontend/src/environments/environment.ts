// Dev, unit tests and e2e. No PostHog token, so analytics stay off.
// `ng build` (production) swaps this file for environment.production.ts.
export const environment = {
  posthogKey: '',
  posthogHost: 'https://us.i.posthog.com',
};
