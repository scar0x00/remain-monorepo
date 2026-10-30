import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { DeckList } from './deck-list';
import { DeckSearchTerm } from '../deck-search-term';

describe('DeckList', () => {
  let component: DeckList;
  let fixture: ComponentFixture<DeckList>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeckList],
      providers: [DeckSearchTerm, provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DeckList);
    component = fixture.componentInstance;
    // Not whenStable: the pending deck list request keeps the app unstable until it is flushed.
    fixture.detectChanges();
    TestBed.tick();
    http.expectOne('/api/v1/decks').flush([
      { deckName: 'alpha.json', size: 1, uploaded: '2026-10-01T00:00:00Z', etag: 'a' },
      { deckName: 'notes.YAML', size: 1, uploaded: '2026-10-01T00:00:00Z', etag: 'b' },
      { deckName: 'anki.apkg', size: 1, uploaded: '2026-10-01T00:00:00Z', etag: 'c' },
    ]);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const editHref = (name: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`a[aria-label="Edit ${name}"]`)?.getAttribute('href');

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('links .json and .yaml decks to the editor, by name and format', () => {
    expect(editHref('alpha')).toBe('/deck-edit/alpha');
    expect(editHref('notes.YAML')).toBe('/deck-edit/notes?format=yaml');
  });

  it('offers no editor for files that are not decks', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a[aria-label="Study anki.apkg"]')).not.toBeNull();
    expect(el.querySelector('a[aria-label="Edit anki.apkg"]')).toBeNull();
    expect(component.isEditable('anki.apkg')).toBe(false);
  });
});
