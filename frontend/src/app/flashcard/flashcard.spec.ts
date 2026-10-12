import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Flashcard } from './flashcard';

describe('Flashcard', () => {
  let component: Flashcard;
  let fixture: ComponentFixture<Flashcard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Flashcard],
    }).compileComponents();

    fixture = TestBed.createComponent(Flashcard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
