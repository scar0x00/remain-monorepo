import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LandingRoute } from './landing-route';

describe('LandingRoute', () => {
  let fixture: ComponentFixture<LandingRoute>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingRoute],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(LandingRoute);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('links the study CTA to deck browsing', () => {
    const link = fixture.nativeElement.querySelector('a[href="/deck-browse"]') as HTMLAnchorElement;
    expect(link.textContent).toContain('Study');
  });

  it('links the create CTA to the flashcard chat', () => {
    const link = fixture.nativeElement.querySelector('a[href="/flashcard-chat"]') as HTMLAnchorElement;
    expect(link.textContent).toContain('Create a deck');
  });
});
