import { DestroyRef, Service, inject, signal } from '@angular/core';

export interface ChartColors {
  bg: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  /** Data colour (bars, lines, filled heatmap cells). */
  accent: string;
}

const FALLBACK: ChartColors = {
  bg: '#130e0b',
  card: '#1f1914',
  border: '#30271f',
  text: '#faf7f2',
  muted: '#c2b6a8',
  accent: '#fbb829',
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
  if (typeof getComputedStyle === 'undefined' || typeof document === 'undefined') return FALLBACK;
  // The tokens are written in HSL. Resolve each through a probe element so ECharts and the
  // hex helpers in format.ts get plain #rrggbb values.
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const read = (name: string, fallback: string) => {
    probe.style.color = '';
    probe.style.color = `var(${name})`;
    return toHex(getComputedStyle(probe).color) ?? fallback;
  };
  const colors = {
    bg: read('--app-bg', FALLBACK.bg),
    card: read('--app-card', FALLBACK.card),
    border: read('--app-border', FALLBACK.border),
    text: read('--app-text', FALLBACK.text),
    muted: read('--app-text-muted', FALLBACK.muted),
    accent: read('--app-action', FALLBACK.accent),
  };
  probe.remove();
  return colors;
}

function toHex(rgb: string): string | null {
  const m = rgb.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  return m ? `#${m.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}` : null;
}

/** Same steps as the colour hints in deck-list: 80% and 50%. */
export function accuracyLevel(accuracy: number | null | undefined): 'good' | 'ok' | 'low' | 'none' {
  if (accuracy == null) return 'none';
  if (accuracy >= 0.8) return 'good';
  if (accuracy >= 0.5) return 'ok';
  return 'low';
}
