import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { DeckSearchTerm } from '../deck-search-term';

import { DeckList } from './deck-list';

describe('DeckList', () => {
  let component: DeckList;
  let fixture: ComponentFixture<DeckList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeckList],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), DeckSearchTerm],
    }).compileComponents();

    fixture = TestBed.createComponent(DeckList);
    component = fixture.componentInstance;
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/v1/decks').flush([]);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
