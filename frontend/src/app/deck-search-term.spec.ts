import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';

import { DeckSearchTerm } from './deck-search-term';
import { DeckEntry, DeckPage } from '../types/DeckEntry';

@Component({ template: '' })
class Blank {}

const entry = (deckName: string): DeckEntry => ({ deckName, size: 1, uploaded: '2026-10-01T00:00:00Z', etag: deckName });
const names = (page: DeckPage | undefined) => page?.decks.map((d) => d.deckName);

const page = (over: Partial<DeckPage> = {}): DeckPage => ({
  decks: [],
  total: 0,
  page: 1,
  pageSize: 10,
  sort: 'name',
  order: 'asc',
  ...over,
});

describe('DeckSearchTerm', () => {
  let service: DeckSearchTerm;
  let http: HttpTestingController;
  let router: Router;

  async function open(url: string) {
    await router.navigateByUrl(url);
    service = TestBed.inject(DeckSearchTerm);
    TestBed.tick();
  }

  // Lets a flushed response reach the resource and its effects run, the router navigate, and the
  // resource send its next request.
  async function settle() {
    for (let i = 0; i < 2; i++) {
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve));
    }
    TestBed.tick();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'deck-browse', component: Blank }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        DeckSearchTerm,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  it('asks for the first page by name without params', async () => {
    await open('/deck-browse');
    http.expectOne('/api/v1/decks').flush(page());
    expect(service.page()).toBe(1);
    expect(service.sort()).toBe('name');
    expect(service.order()).toBe('asc');
  });

  it('reads the search, sort and page from the URL', async () => {
    await open('/deck-browse?q=bio&sort=created&order=asc&page=2');
    http.expectOne('/api/v1/decks?searchTerm=bio&sort=created&order=asc&page=2').flush(page({ page: 2 }));
  });

  it('leaves out the default order of a sort', async () => {
    await open('/deck-browse?sort=success');
    expect(service.order()).toBe('desc');
    http.expectOne('/api/v1/decks?sort=success').flush(page());
  });

  it('goes back to the first page on a new search or sort', async () => {
    await open('/deck-browse?page=3');
    http.expectOne('/api/v1/decks?page=3').flush(page({ page: 3, total: 30, decks: [{} as never] }));

    service.setSort({ sort: 'created', order: 'desc' });
    await settle();
    expect(router.url).toBe('/deck-browse?sort=created');
    http.expectOne('/api/v1/decks?sort=created').flush(page({ sort: 'created', order: 'desc' }));

    await router.navigateByUrl('/deck-browse?sort=created&page=2');
    TestBed.tick();
    http.expectOne('/api/v1/decks?sort=created&page=2').flush(page({ page: 2, total: 12, decks: [{} as never] }));

    service.setTerm('Bio');
    await settle();
    expect(router.url).toBe('/deck-browse?sort=created&q=bio');
    http.expectOne('/api/v1/decks?searchTerm=bio&sort=created').flush(page());
  });

  it('moves to the last page when the page asked for is past the end', async () => {
    await open('/deck-browse?page=7');
    http.expectOne('/api/v1/decks?page=7').flush(page({ page: 7, total: 23 }));
    await settle();
    expect(router.url).toBe('/deck-browse?page=3');
    http.expectOne('/api/v1/decks?page=3').flush(page({ page: 3, total: 23, decks: [{} as never] }));
  });

  it('does not count the first load as searching', async () => {
    await open('/deck-browse');
    expect(service.deck.isLoading()).toBe(true);
    expect(service.searching()).toBe(false);
    http.expectOne('/api/v1/decks').flush(page());
  });

  it('sends the term trimmed, lowercased and URL-encoded', async () => {
    await open('/deck-browse');
    http.expectOne('/api/v1/decks').flush(page());

    service.setTerm('  Q&A #1 ');
    await settle();
    const req = http.expectOne((r) => r.url === '/api/v1/decks');
    expect(req.request.params.get('searchTerm')).toBe('q&a #1');
    expect(req.request.urlWithParams).toBe('/api/v1/decks?searchTerm=q%26a%20%231');
    req.flush(page());
  });

  it('does not refetch when only surrounding spaces change', async () => {
    await open('/deck-browse?q=bio');
    http.expectOne('/api/v1/decks?searchTerm=bio').flush(page());

    service.setTerm('bio ');
    await settle();
    http.expectNone(() => true);
  });

  it('keeps the previous page on screen while the next search loads', async () => {
    await open('/deck-browse');
    http.expectOne('/api/v1/decks').flush(page({ decks: [entry('biology.json'), entry('history.json')], total: 2 }));
    await settle();
    expect(names(service.current())).toEqual(['biology.json', 'history.json']);

    service.setTerm('bio');
    await settle();
    const req = http.expectOne('/api/v1/decks?searchTerm=bio');
    expect(service.searching()).toBe(true);
    expect(names(service.current())).toEqual(['biology.json', 'history.json']);

    req.flush(page({ decks: [entry('biology.json')], total: 1 }));
    await settle();
    expect(service.searching()).toBe(false);
    expect(names(service.current())).toEqual(['biology.json']);
  });

  it('drops the page after an error', async () => {
    await open('/deck-browse');
    http.expectOne('/api/v1/decks').flush(page({ decks: [entry('biology.json')], total: 1 }));
    await settle();
    expect(service.current()).toBeDefined();

    service.setTerm('bio');
    await settle();
    http.expectOne('/api/v1/decks?searchTerm=bio').flush('nope', { status: 500, statusText: 'Server Error' });
    await settle();
    expect(service.current()).toBeUndefined();
  });
});
