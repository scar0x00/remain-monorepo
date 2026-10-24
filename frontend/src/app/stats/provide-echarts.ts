import { provideEchartsCore } from 'ngx-echarts';

/** Route-level provider for charts. ECharts is fetched the first time a chart renders. */
export const provideEcharts = () => provideEchartsCore({ echarts: () => import('./echarts').then((m) => m.default) });

/** Renderer options shared by every chart. */
export const CHART_INIT_OPTS = { renderer: 'svg' } as const;
