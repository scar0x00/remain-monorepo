import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { DeckSearchTerm } from './deck-search-term';
import { DeckEntry } from '../types/DeckEntry';

const entry = (deckName: string): DeckEntry => ({ deckName, size: 1, uploaded: '2026-10-01T00:00:00Z', etag: deckName });

describe('DeckSearchTerm', () => {
  let service: DeckSearchTerm;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), DeckSearchTerm],
    });
    service = TestBed.inject(DeckSearchTerm);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // A flushed response reaches the resource asynchronously.
  const settle = () => TestBed.inject(ApplicationRef).whenStable();

  it('lists every deck without a term', () => {
    TestBed.tick();
    http.expectOne('/api/v1/decks').flush([]);
  });

  it('sends the term trimmed, lowercased and URL-encoded', () => {
    TestBed.tick();
    http.expectOne('/api/v1/decks').flush([]);

    service.setTerm('  Q&A #1 ');
    TestBed.tick();
    const req = http.expectOne((r) => r.url === '/api/v1/decks');
    expect(req.request.params.get('searchTerm')).toBe('q&a #1');
    expect(req.request.urlWithParams).toBe('/api/v1/decks?searchTerm=q%26a%20%231');
    req.flush([]);
  });

  it('does not refetch when only surrounding spaces change', () => {
    service.setTerm('bio');
    TestBed.tick();
    http.expectOne('/api/v1/decks?searchTerm=bio').flush([]);

    service.setTerm('bio ');
    TestBed.tick();
    http.expectNone(() => true);
  });

  it('keeps the previous results while the next search loads', async () => {
    TestBed.tick();
    http.expectOne('/api/v1/decks').flush([entry('biology.json'), entry('history.json')]);
    await settle();
    expect(service.decks()?.map((d) => d.deckName)).toEqual(['biology.json', 'history.json']);

    service.setTerm('bio');
    TestBed.tick();
    const req = http.expectOne('/api/v1/decks?searchTerm=bio');
    expect(service.deck.isLoading()).toBe(true);
    expect(service.decks()?.map((d) => d.deckName)).toEqual(['biology.json', 'history.json']);

    req.flush([entry('biology.json')]);
    await settle();
    expect(service.decks()?.map((d) => d.deckName)).toEqual(['biology.json']);
  });

  it('drops the results after an error', async () => {
    TestBed.tick();
    http.expectOne('/api/v1/decks').flush([entry('biology.json')]);
    await settle();
    expect(service.decks()).toHaveLength(1);

    service.setTerm('bio');
    TestBed.tick();
    http.expectOne('/api/v1/decks?searchTerm=bio').flush('nope', { status: 500, statusText: 'Server Error' });
    await settle();
    expect(service.decks()).toBeUndefined();
  });
});
