import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SearchDeckField } from './search-deck-field';

describe('SearchDeckField', () => {
  let component: SearchDeckField;
  let fixture: ComponentFixture<SearchDeckField>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchDeckField],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchDeckField);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
