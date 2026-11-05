/**
 * The in-app path to go back to after signing in. Only same-origin paths are allowed, so a crafted
 * `?returnTo=` link can't send the user to another site.
 */
export function safeReturnTo(value: string | null | undefined, fallback = '/deck-browse'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (value.startsWith('/api/')) return fallback;
  return value;
}
