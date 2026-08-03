import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DeckUploadRoute } from './deck-upload-route';

describe('DeckUploadRoute', () => {
  let component: DeckUploadRoute;
  let fixture: ComponentFixture<DeckUploadRoute>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeckUploadRoute],
    }).compileComponents();

    fixture = TestBed.createComponent(DeckUploadRoute);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
