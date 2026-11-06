import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';

/** `system` follows the OS colour scheme; `light` and `dark` override it on this device. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** localStorage key. The inline script in index.html reads it too, so keep the two in step. */
export const THEME_STORAGE_KEY = 'remain-theme';

/**
 * The user's theme choice, kept per device in localStorage (nothing on the server).
 * It is applied as `data-theme` on <html>, which styles.css keys the light tokens, `color-scheme`
 * and Tailwind's `dark:` variant on; no attribute means "follow the OS".
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly root = inject(DOCUMENT).documentElement;
  readonly preference = signal<ThemePreference>(readStored());

  constructor() {
    this.apply(this.preference());
    // Another tab changed it: follow along.
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      const pref = parse(e.newValue);
      this.apply(pref);
      this.preference.set(pref);
    };
    window.addEventListener('storage', onStorage);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('storage', onStorage));
  }

  set(pref: ThemePreference): void {
    this.apply(pref);
    try {
      if (pref === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // Storage blocked (private mode, site data off): the choice lasts for this page load.
    }
    this.preference.set(pref);
  }

  private apply(pref: ThemePreference): void {
    if (pref === 'system') this.root.removeAttribute('data-theme');
    else this.root.setAttribute('data-theme', pref);
  }
}

function readStored(): ThemePreference {
  try {
    return parse(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function parse(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
