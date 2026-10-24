import { Component, computed, inject, input } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { ChartTheme } from '../stats/chart-theme';
import { CHART_INIT_OPTS } from '../stats/provide-echarts';

/** Tiny line of accuracies (0-1), oldest first, with no axes. */
@Component({
  selector: 'app-sparkline',
  imports: [NgxEchartsDirective],
  host: { class: 'inline-block' },
  template: `
    @if (values().length > 1) {
      <div echarts class="block h-7 w-24" [options]="options()" [initOpts]="initOpts"
        role="img" [attr.aria-label]="summary()"></div>
    } @else {
      <span class="text-xs text-app-text-muted">—</span>
    }
  `,
})
export class Sparkline {
  readonly values = input.required<number[]>();

  private readonly theme = inject(ChartTheme);
  protected readonly initOpts = CHART_INIT_OPTS;

  protected readonly summary = computed(() => {
    const v = this.values();
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    return `Last ${v.length} sessions, from ${pct(v[0]!)} to ${pct(v[v.length - 1]!)}`;
  });

  protected readonly options = computed((): EChartsCoreOption => {
    const c = this.theme.colors();
    const values = this.values().map((v) => Math.round(v * 100));
    return {
      animation: false,
      grid: { top: 3, bottom: 3, left: 3, right: 5 },
      xAxis: { type: 'category', show: false, boundaryGap: false, data: values.map((_, i) => i) },
      yAxis: { type: 'value', show: false, scale: true },
      series: [
        {
          type: 'line',
          data: values,
          silent: true,
          symbol: 'none',
          lineStyle: { color: c.text, width: 2 },
        },
        {
          // Dot on the latest session.
          type: 'line',
          data: values.map((v, i) => (i === values.length - 1 ? v : null)),
          silent: true,
          symbol: 'circle',
          symbolSize: 5,
          itemStyle: { color: c.text },
          lineStyle: { opacity: 0 },
        },
      ],
    };
  });
}
