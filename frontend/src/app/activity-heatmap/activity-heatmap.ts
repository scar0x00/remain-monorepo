import { Component, computed, inject, input } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { ActivityDay } from '../../types/Stats';
import { ChartTheme } from '../stats/chart-theme';
import { blend, isoDay, withAlpha } from '../stats/format';
import { CHART_INIT_OPTS } from '../stats/provide-echarts';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Calendar heatmap of cards answered per day, ending today. */
@Component({
  selector: 'app-activity-heatmap',
  imports: [NgxEchartsDirective],
  template: `
    <div echarts class="block h-36 w-full" [options]="options()" [initOpts]="initOpts"
      role="img" [attr.aria-label]="summary()"></div>
  `,
})
export class ActivityHeatmap {
  readonly days = input.required<ActivityDay[]>();
  /** Number of days shown, today included. */
  readonly span = input(84);

  private readonly theme = inject(ChartTheme);
  protected readonly initOpts = CHART_INIT_OPTS;

  protected readonly summary = computed(() => {
    const days = this.days();
    const total = days.reduce((sum, d) => sum + d.answered, 0);
    return `Activity heatmap: ${total} cards answered on ${days.length} of the last ${this.span()} days.`;
  });

  protected readonly options = computed((): EChartsCoreOption => {
    const c = this.theme.colors();
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (this.span() - 1));
    const days = this.days();
    const max = Math.max(1, ...days.map((d) => d.answered));

    return {
      animation: false,
      aria: { enabled: true },
      tooltip: {
        backgroundColor: c.card,
        borderColor: c.border,
        textStyle: { color: c.text },
        formatter: (p: { value: [string, number, number] }) => {
          const [date, answered, correct] = p.value;
          const label = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
          return `${label}<br/>${answered} cards, ${Math.round((correct / answered) * 100)}% right`;
        },
      },
      visualMap: {
        show: false,
        min: 0,
        max,
        dimension: 1,
        inRange: { color: [withAlpha(c.text, 0.3), c.text] },
      },
      calendar: {
        range: [isoDay(start), isoDay(end)],
        cellSize: ['auto', 'auto'],
        top: 22,
        left: 34,
        right: 2,
        bottom: 2,
        splitLine: { show: false },
        // Borders in the card's own colour (bg-app-card/40 over the page) read as gaps between cells.
        itemStyle: { color: withAlpha(c.text, 0.08), borderColor: blend(c.card, c.bg, 0.4), borderWidth: 3 },
        dayLabel: { firstDay: 1, nameMap: DAY_NAMES, color: c.muted, fontSize: 11 },
        monthLabel: { color: c.muted, fontSize: 11 },
        yearLabel: { show: false },
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data: days.map((d) => [d.date, d.answered, d.correct]),
          itemStyle: { borderColor: blend(c.card, c.bg, 0.4), borderWidth: 3 },
        },
      ],
    };
  });
}
