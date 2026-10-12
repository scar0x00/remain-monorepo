import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SearchDeckField, SEARCH_THROTTLE_MS } from './search-deck-field';
import { DeckSearchTerm } from '../deck-search-term';

describe('SearchDeckField', () => {
  let component: SearchDeckField;
  let fixture: ComponentFixture<SearchDeckField>;
  let setTerm: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    setTerm = vi.fn();

    await TestBed.configureTestingModule({
      imports: [SearchDeckField],
      providers: [{ provide: DeckSearchTerm, useValue: { setTerm } }],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchDeckField);
    component = fixture.componentInstance;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function type(value: string) {
    component.searchValue = value;
    component.handleInput(new InputEvent('input'));
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should apply the first keystroke immediately', () => {
    type('a');
    expect(setTerm).toHaveBeenCalledWith('a');
    expect(setTerm).toHaveBeenCalledTimes(1);
  });

  it('should throttle rapid keystrokes and apply the latest value at the end of the window', () => {
    type('a');
    type('ab');
    type('abc');
    expect(setTerm).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(SEARCH_THROTTLE_MS);
    expect(setTerm).toHaveBeenCalledTimes(2);
    expect(setTerm).toHaveBeenLastCalledWith('abc');
  });

  it('should apply a clear over any pending search term', () => {
    type('a');
    type('ab');
    component.handleClear();

    vi.advanceTimersByTime(SEARCH_THROTTLE_MS);
    expect(setTerm).toHaveBeenLastCalledWith('');
    expect(component.searchValue).toBe('');
  });
});
