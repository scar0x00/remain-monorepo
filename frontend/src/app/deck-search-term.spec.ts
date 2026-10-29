import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { DeckSearchTerm } from './deck-search-term';

describe('DeckSearchTerm', () => {
  let service: DeckSearchTerm;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), DeckSearchTerm],
    });
    service = TestBed.inject(DeckSearchTerm);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
