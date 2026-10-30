import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { DeckStudyRoute } from './deck-study-route';

describe('DeckStudyRoute', () => {
  let component: DeckStudyRoute;
  let fixture: ComponentFixture<DeckStudyRoute>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeckStudyRoute],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(DeckStudyRoute);
    fixture.componentRef.setInput('id', 'sample.json');
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
