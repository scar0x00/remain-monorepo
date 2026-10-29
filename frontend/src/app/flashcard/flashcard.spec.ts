import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';

import { Flashcard } from './flashcard';

describe('Flashcard', () => {
  let component: Flashcard;
  let fixture: ComponentFixture<Flashcard>;
  const el = () => fixture.nativeElement as HTMLElement;
  const toggle = () => el().querySelector<HTMLButtonElement>('button[aria-controls="card-refs"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Flashcard],
      providers: [provideMarkdown()],
    }).compileComponents();

    fixture = TestBed.createComponent(Flashcard);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('front', 'Q');
    fixture.componentRef.setInput('back', 'A');
    fixture.componentRef.setInput('refs', [
      { kind: 'page', label: '112', source: 'ch3.pdf' },
      { kind: 'equation', label: '3.14' },
    ]);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('never shows references while the back is hidden', () => {
    expect(toggle()).toBeNull();
    expect(el().textContent).not.toContain('3.14');
  });

  it('shows references on the back only after the toggle is clicked', async () => {
    fixture.componentRef.setInput('hideBack', false);
    await fixture.whenStable();
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(el().querySelector('#card-refs')).toBeNull();

    toggle()!.click();
    await fixture.whenStable();

    const chips = [...el().querySelectorAll('#card-refs li')].map((li) => li.textContent?.trim());
    expect(chips).toEqual(['p. 112 · ch3.pdf', 'eq. 3.14']);
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses the references again for the next card', async () => {
    fixture.componentRef.setInput('hideBack', false);
    await fixture.whenStable();
    toggle()!.click();
    await fixture.whenStable();

    fixture.componentRef.setInput('front', 'Next');
    await fixture.whenStable();

    expect(el().querySelector('#card-refs')).toBeNull();
  });

  it('has no references button when the card has none', async () => {
    fixture.componentRef.setInput('refs', undefined);
    fixture.componentRef.setInput('hideBack', false);
    await fixture.whenStable();

    expect(toggle()).toBeNull();
  });
});
