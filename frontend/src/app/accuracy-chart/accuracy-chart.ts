import { Component, computed, inject, input } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { SessionSummary } from '../../types/Stats';
import { ChartTheme } from '../stats/chart-theme';
import { withAlpha } from '../stats/format';
import { CHART_INIT_OPTS } from '../stats/provide-echarts';

/** Accuracy per session over time, for one deck. */
@Component({
  selector: 'app-accuracy-chart',
  imports: [NgxEchartsDirective],
  template: `
    <div echarts class="block h-48 w-full" [options]="options()" [initOpts]="initOpts"
      role="img" [attr.aria-label]="summary()"></div>
  `,
})
export class AccuracyChart {
  /** Newest first, as the API returns them. */
  readonly sessions = input.required<SessionSummary[]>();

  private readonly theme = inject(ChartTheme);
  protected readonly initOpts = CHART_INIT_OPTS;

  private readonly points = computed(() =>
    this.sessions()
      .filter((s) => s.accuracy != null)
      .slice()
      .reverse()
      .map((s) => ({
        label: new Date(s.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        value: Math.round(s.accuracy! * 100),
        detail: `${s.correct} of ${s.answered} right`,
      })),
  );

  protected readonly summary = computed(() => {
    const p = this.points();
    if (!p.length) return 'No sessions yet.';
    return `Success per session over ${p.length} sessions, from ${p[0]!.value}% to ${p[p.length - 1]!.value}%.`;
  });

  protected readonly options = computed((): EChartsCoreOption => {
    const c = this.theme.colors();
    const points = this.points();
    return {
      animation: false,
      aria: { enabled: true },
      grid: { top: 12, left: 4, right: 12, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: c.card,
        borderColor: c.border,
        textStyle: { color: c.text },
        formatter: (params: { dataIndex: number }[]) => {
          const point = points[params[0]!.dataIndex]!;
          return `${point.label}<br/>${point.value}% · ${point.detail}`;
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: points.map((p) => p.label),
        axisLine: { lineStyle: { color: c.border } },
        axisTick: { show: false },
        axisLabel: { color: c.muted, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        interval: 25,
        splitLine: { lineStyle: { color: c.border, type: 'dashed' } },
        axisLabel: { color: c.muted, fontSize: 11, formatter: '{value}%' },
      },
      series: [
        {
          type: 'line',
          name: 'Success',
          data: points.map((p) => p.value),
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: c.text, width: 2.5 },
          itemStyle: { color: c.text },
          areaStyle: { color: withAlpha(c.text, 0.12) },
        },
      ],
    };
  });
}
