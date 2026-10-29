import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideEchartsCore } from 'ngx-echarts';

import { DeckStatsRoute } from './deck-stats-route';
import { StatsService } from '../stats/stats.service';
import { HARDEST, daysAgo, deck, stubResizeObserver } from '../../testing/stats-fixtures';
import { DeckStatsDetail } from '../../types/Stats';

const DETAIL: DeckStatsDetail = {
  ...deck({ deckName: 'kubernetes-networking.json', accuracy: 0.44, cardCount: 40, masteredCards: 10 }),
  recentSessions: [
    { id: 's2', startedAt: daysAgo(1), status: 'abandoned', answered: 10, correct: 4, accuracy: 0.4, studyMs: 120_000 },
    { id: 's1', startedAt: daysAgo(3), status: 'completed', answered: 10, correct: 5, accuracy: 0.5, studyMs: 180_000 },
  ],
  hardestCards: HARDEST,
};

describe('DeckStatsRoute', () => {
  let fixture: ComponentFixture<DeckStatsRoute>;
  let http: HttpTestingController;

  beforeEach(async () => {
    stubResizeObserver();
    await TestBed.configureTestingModule({
      imports: [DeckStatsRoute],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideEchartsCore({ echarts: () => new Promise(() => {}) }),
        StatsService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DeckStatsRoute);
    fixture.componentRef.setInput('name', 'kubernetes-networking.json');
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };
  const text = () => (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
  const request = () =>
    http.expectOne((r) => r.url.startsWith('/api/v1/stats/decks/kubernetes-networking.json?days=30'));

  it('shows the deck summary, hardest cards and sessions', async () => {
    request().flush(DETAIL);
    await settle();

    expect(text()).toContain('kubernetes-networking');
    expect(text()).toContain('10 / 40');
    expect(text()).toContain('What does kube-proxy do?');
    expect(text()).toContain('4 of 10 right · 2m · Stopped early');
    const practice = fixture.nativeElement.querySelector('a[href*="cardIds=abc"]') as HTMLAnchorElement;
    expect(practice.getAttribute('href')).toContain('/deck-study/kubernetes-networking');
  });

  it('says so when the deck has no stats', async () => {
    request().flush('Deck Not Found', { status: 404, statusText: 'Not Found' });
    await settle();

    expect(text()).toContain('No deck or study history called “kubernetes-networking”');
  });
});
