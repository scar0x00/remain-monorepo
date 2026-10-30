import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { BrowseDecksRoute } from './browse-decks-route';

describe('BrowseDecksRoute', () => {
  let component: BrowseDecksRoute;
  let fixture: ComponentFixture<BrowseDecksRoute>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BrowseDecksRoute],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(BrowseDecksRoute);
    component = fixture.componentInstance;
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/v1/decks').flush([]);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
