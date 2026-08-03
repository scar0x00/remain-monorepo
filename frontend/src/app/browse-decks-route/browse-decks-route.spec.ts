import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BrowseDecksRoute } from './browse-decks-route';

describe('BrowseDecksRoute', () => {
  let component: BrowseDecksRoute;
  let fixture: ComponentFixture<BrowseDecksRoute>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BrowseDecksRoute],
    }).compileComponents();

    fixture = TestBed.createComponent(BrowseDecksRoute);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
