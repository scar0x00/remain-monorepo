import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideEchartsCore } from 'ngx-echarts';

import { DashboardRoute } from './dashboard-route';
import { StatsService } from '../stats/stats.service';
import { ACTIVITY, DECKS, EMPTY_OVERVIEW, HARDEST, OVERVIEW, stubResizeObserver } from '../../testing/stats-fixtures';

describe('DashboardRoute', () => {
  let fixture: ComponentFixture<DashboardRoute>;
  let http: HttpTestingController;

  beforeEach(async () => {
    stubResizeObserver();
    await TestBed.configureTestingModule({
      imports: [DashboardRoute],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        // Charts never finish loading in tests; the sections around them are what is checked.
        provideEchartsCore({ echarts: () => new Promise(() => {}) }),
        StatsService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardRoute);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const text = () => (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');

  function respond(overview = OVERVIEW) {
    http.expectOne((r) => r.url.startsWith('/api/v1/stats/overview')).flush(overview);
    http.expectOne((r) => r.url.startsWith('/api/v1/stats/activity')).flush(ACTIVITY);
    http.expectOne((r) => r.url.startsWith('/api/v1/stats/decks')).flush(DECKS);
    http.expectOne('/api/v1/stats/hardest-cards?limit=5').flush(HARDEST);
  }

  it('requests the 30-day range in the local time zone', () => {
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    http.expectOne(`/api/v1/stats/overview?days=30&tz=${tz}`);
    http.expectOne(`/api/v1/stats/activity?days=84&tz=${tz}`);
    http.expectOne(`/api/v1/stats/decks?days=30&tz=${tz}`);
    http.expectOne('/api/v1/stats/hardest-cards?limit=5');
  });

  it('shows skeletons while loading', () => {
    expect(fixture.nativeElement.querySelectorAll('app-section-state').length).toBeGreaterThan(0);
    respond();
  });

  it('shows the summary, decks, review list and hardest cards', async () => {
    respond();
    await fixture.whenStable();

    const tiles = [...fixture.nativeElement.querySelectorAll('app-stat-tile')].map((tile: HTMLElement) =>
      [...tile.querySelectorAll('p')].map((p) => p.textContent!.trim()),
    );
    expect(tiles).toContainEqual(['Success rate', '78%', '+4 pts vs previous 30 days']);
    expect(tiles).toContainEqual(['Current streak', '9 days', 'longest: 21 days']);
    expect(text()).toContain('linear-modulation');
    expect(text()).toContain('Success 44% · last studied 18 days ago');
    expect(text()).toContain('What does kube-proxy do?');
    expect(fixture.nativeElement.querySelectorAll('app-section-state').length).toBe(0);
  });

  it('shows the empty state when nothing was ever studied', async () => {
    respond(EMPTY_OVERVIEW);
    await fixture.whenStable();

    expect(text()).toContain('Your stats show up here');
    expect(fixture.nativeElement.querySelector('app-deck-stats-table')).toBeNull();
  });

  it('refetches with the new range', async () => {
    respond();
    await fixture.whenStable();

    const button = [...fixture.nativeElement.querySelectorAll('button')].find(
      (b: HTMLButtonElement) => b.textContent!.trim() === '7 days',
    ) as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    http.expectOne((r) => r.url.startsWith('/api/v1/stats/overview?days=7'));
    http.expectOne((r) => r.url.startsWith('/api/v1/stats/decks?days=7'));
  });

  it('shows an error with a retry for a failed section', async () => {
    http.expectOne((r) => r.url.startsWith('/api/v1/stats/overview')).flush(OVERVIEW);
    http.expectOne((r) => r.url.startsWith('/api/v1/stats/activity')).flush('boom', { status: 500, statusText: 'Server Error' });
    http.expectOne((r) => r.url.startsWith('/api/v1/stats/decks')).flush(DECKS);
    http.expectOne('/api/v1/stats/hardest-cards?limit=5').flush(HARDEST);
    await fixture.whenStable();

    expect(text()).toContain('Could not load your activity');
    const retry = fixture.nativeElement.querySelector('[role="alert"] button') as HTMLButtonElement;
    retry.click();
    fixture.detectChanges();
    http.expectOne((r) => r.url.startsWith('/api/v1/stats/activity')).flush(ACTIVITY);
  });
});
