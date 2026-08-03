import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DeckList } from './deck-list';

describe('DeckList', () => {
  let component: DeckList;
  let fixture: ComponentFixture<DeckList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeckList],
    }).compileComponents();

    fixture = TestBed.createComponent(DeckList);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
