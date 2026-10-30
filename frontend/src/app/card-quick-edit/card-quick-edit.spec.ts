import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideMarkdown } from 'ngx-markdown';

import { CardQuickEdit } from './card-quick-edit';
import { Deck } from '../../types/Deck';
import { polyfillDialog } from '../../testing/dialog';

const DECK: Deck = {
  version: 2,
  meta: { title: 'Signals' },
  cards: [
    { id: 'c_1', front: 'Q1', back: 'A1' },
    { id: 'c_2', front: 'Q2', back: 'A2' },
  ],
};

describe('CardQuickEdit', () => {
  let fixture: ComponentFixture<CardQuickEdit>;
  let http: HttpTestingController;
  let saved: { deck: Deck; etag: string | null }[];
  let closed: number;

  beforeEach(async () => {
    polyfillDialog();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideMarkdown(), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CardQuickEdit);
    fixture.componentRef.setInput('deckKey', 'signals.json');
    fixture.componentRef.setInput('deck', DECK);
    fixture.componentRef.setInput('etag', '"e1"');
    fixture.componentRef.setInput('cardId', 'c_2');
    saved = [];
    closed = 0;
    fixture.componentInstance.saved.subscribe((s) => saved.push(s));
    fixture.componentInstance.closed.subscribe(() => closed++);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const dialog = () => el().querySelector('dialog')!;
  const button = (text: string) => [...el().querySelectorAll('button')].find((b) => b.textContent!.trim() === text)!;
  // Saves resolve over a few promise turns before the view updates.
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };

  async function editBack(text: string) {
    const back = el().querySelector<HTMLTextAreaElement>('#back-c_2')!;
    back.value = text;
    back.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  it('opens as a modal with the card and links to it in the full editor', () => {
    expect(dialog().open).toBe(true);
    expect(el().querySelector<HTMLTextAreaElement>('#front-c_2')!.value).toBe('Q2');
    expect(el().querySelector('a')!.getAttribute('href')).toBe('/deck-edit/signals?card=c_2');
  });

  it('saves the whole deck with If-Match and hands it back to the study', async () => {
    await editBack('A2 fixed');

    button('Save card').click();
    const req = http.expectOne({ method: 'PUT', url: '/api/v1/deck/signals.json' });
    expect(req.request.headers.get('if-match')).toBe('"e1"');
    expect(JSON.parse(req.request.body).cards).toEqual([DECK.cards[0], { id: 'c_2', front: 'Q2', back: 'A2 fixed' }]);
    req.flush('ok', { headers: { etag: '"e2"' } });
    await settle();

    expect(saved).toEqual([{ deck: { ...DECK, cards: [DECK.cards[0], { id: 'c_2', front: 'Q2', back: 'A2 fixed' }] }, etag: '"e2"' }]);
    expect(dialog().open).toBe(false);
  });

  it('closes without saving when nothing changed', async () => {
    button('Save card').click();
    await settle();

    expect(saved).toEqual([]);
    expect(dialog().open).toBe(false);
  });

  it('blocks saving an empty side', async () => {
    await editBack('');

    expect(button('Save card').disabled).toBe(true);
    expect(el().textContent).toContain('The back is empty');
  });

  it('on a conflict, overwrites with the current etag', async () => {
    await editBack('Mine');
    button('Save card').click();
    http.expectOne({ method: 'PUT' }).flush('changed', { status: 412, statusText: 'Precondition Failed' });
    await settle();

    expect(el().querySelector('[role="alert"]')!.textContent).toContain('changed somewhere else');
    expect(saved).toEqual([]);

    button('Overwrite with mine').click();
    http.expectOne({ method: 'GET', url: '/api/v1/deck/signals.json' }).flush(JSON.stringify(DECK), { headers: { etag: '"theirs"' } });
    await settle();
    const req = http.expectOne({ method: 'PUT' });
    expect(req.request.headers.get('if-match')).toBe('"theirs"');
    req.flush('ok', { headers: { etag: '"e3"' } });
    await settle();

    expect(saved).toHaveLength(1);
    expect(saved[0].etag).toBe('"e3"');
    expect(saved[0].deck.cards[1].back).toBe('Mine');
  });

  it('on a conflict, discards the edit', async () => {
    await editBack('Mine');
    button('Save card').click();
    http.expectOne({ method: 'PUT' }).flush('changed', { status: 412, statusText: 'Precondition Failed' });
    await settle();

    button('Discard my edit').click();
    await fixture.whenStable();

    expect(saved).toEqual([]);
    expect(dialog().open).toBe(false);
  });

  it('says when a save failed for another reason', async () => {
    await editBack('Mine');
    button('Save card').click();
    http.expectOne({ method: 'PUT' }).flush('boom', { status: 500, statusText: 'err' });
    await settle();

    expect(el().textContent).toContain("Couldn't save");
    expect(dialog().open).toBe(true);
  });
});
