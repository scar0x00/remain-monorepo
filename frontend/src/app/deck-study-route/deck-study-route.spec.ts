import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DeckStudyRouteRoute } from './deck-study-route';

describe('DeckStudyRoute', () => {
  let component: DeckStudyRoute;
  let fixture: ComponentFixture<DeckStudyRoute>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeckStudyRoute],
    }).compileComponents();

    fixture = TestBed.createComponent(DeckStudyRoute);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
