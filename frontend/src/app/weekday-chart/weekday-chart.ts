import { Component, computed, inject, input } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { ChartTheme } from '../stats/chart-theme';
import { CHART_INIT_OPTS } from '../stats/provide-echarts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Bars of cards answered per weekday, Monday first. */
@Component({
  selector: 'app-weekday-chart',
  imports: [NgxEchartsDirective],
  template: `
    <div echarts class="block h-40 w-full" [options]="options()" [initOpts]="initOpts"
      role="img" [attr.aria-label]="summary()"></div>
  `,
})
export class WeekdayChart {
  /** Cards answered per weekday, Monday first. */
  readonly counts = input.required<number[]>();

  private readonly theme = inject(ChartTheme);
  protected readonly initOpts = CHART_INIT_OPTS;

  protected readonly summary = computed(() => {
    const counts = this.counts();
    const parts = WEEKDAYS.map((day, i) => `${day} ${counts[i] ?? 0}`);
    return `Cards answered per weekday: ${parts.join(', ')}.`;
  });

  protected readonly options = computed((): EChartsCoreOption => {
    const c = this.theme.colors();
    return {
      animation: false,
      aria: { enabled: true },
      grid: { top: 8, left: 4, right: 4, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'none' },
        backgroundColor: c.card,
        borderColor: c.border,
        textStyle: { color: c.text },
      },
      xAxis: {
        type: 'category',
        data: WEEKDAYS,
        axisLine: { lineStyle: { color: c.border } },
        axisTick: { show: false },
        axisLabel: { color: c.muted, fontSize: 11, formatter: (day: string) => day.charAt(0) },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitNumber: 3,
        splitLine: { lineStyle: { color: c.border, type: 'dashed' } },
        axisLabel: { color: c.muted, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          name: 'Cards',
          data: this.counts(),
          barMaxWidth: 28,
          itemStyle: { color: c.text, borderRadius: [6, 6, 2, 2] },
        },
      ],
    };
  });
}
