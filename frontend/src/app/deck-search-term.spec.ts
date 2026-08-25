import { TestBed } from '@angular/core/testing';

import { DeckSearchTerm } from './deck-search-term';

describe('DeckSearchTerm', () => {
  let service: DeckSearchTerm;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DeckSearchTerm);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
