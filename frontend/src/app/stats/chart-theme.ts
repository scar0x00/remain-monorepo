import { DestroyRef, Service, inject, signal } from '@angular/core';

export interface ChartColors {
  bg: string;
  card: string;
  border: string;
  text: string;
  muted: string;
}

const FALLBACK: ChartColors = {
  bg: '#03071e',
  card: '#370617',
  border: '#6a040f',
  text: '#ffba08',
  muted: '#f48c06',
};

/**
 * The app's `--app-*` colour tokens as plain values for ECharts, which can't read CSS variables.
 * Re-read when the colour scheme flips, so charts follow light and dark mode like the rest of the page.
 */
@Service()
export class ChartTheme {
  readonly colors = signal<ChartColors>(readColors());

  constructor() {
    if (typeof matchMedia === 'undefined') return;
    const query = matchMedia('(prefers-color-scheme: light)');
    const update = () => this.colors.set(readColors());
    query.addEventListener('change', update);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', update));
  }
}

function readColors(): ChartColors {
  if (typeof getComputedStyle === 'undefined') return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    bg: read('--app-bg', FALLBACK.bg),
    card: read('--app-card', FALLBACK.card),
    border: read('--app-border', FALLBACK.border),
    text: read('--app-text', FALLBACK.text),
    muted: read('--app-text-muted', FALLBACK.muted),
  };
}

/** Same steps as the colour hints in deck-list: 80% and 50%. */
export function accuracyLevel(accuracy: number | null | undefined): 'good' | 'ok' | 'low' | 'none' {
  if (accuracy == null) return 'none';
  if (accuracy >= 0.8) return 'good';
  if (accuracy >= 0.5) return 'ok';
  return 'low';
}
