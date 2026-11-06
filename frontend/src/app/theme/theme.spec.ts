import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY, Theme } from './theme';

describe('Theme', () => {
  const root = document.documentElement;

  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
  });

  it('follows the system by default', () => {
    const theme = TestBed.inject(Theme);
    expect(theme.preference()).toBe('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('applies and remembers a picked theme', () => {
    const theme = TestBed.inject(Theme);
    theme.set('light');
    expect(theme.preference()).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    theme.set('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('goes back to the system theme', () => {
    const theme = TestBed.inject(Theme);
    theme.set('dark');
    theme.set('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('reads the stored choice and ignores unknown values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(TestBed.inject(Theme).preference()).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');

    TestBed.resetTestingModule();
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(TestBed.inject(Theme).preference()).toBe('system');
  });

  it('follows a change made in another tab', () => {
    const theme = TestBed.inject(Theme);
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'light' }));
    expect(theme.preference()).toBe('light');
    expect(root.getAttribute('data-theme')).toBe('light');
  });
});
