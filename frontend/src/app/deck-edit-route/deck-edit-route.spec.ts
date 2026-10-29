import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideMarkdown } from 'ngx-markdown';

import { DeckEditRoute, cardSummary } from './deck-edit-route';

const DECK = {
  version: 2,
  meta: { title: 'Signals' },
  cards: [
    { id: 'c_1', front: '**Bandwidth** of $x$?', back: '2W' },
    { id: 'c_2', front: 'Define \\mu', back: 'k_a max|m|' },
  ],
};

describe('DeckEditRoute', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let route: DeckEditRoute;

  async function open(url = '/deck-edit/signals', file = 'signals.json') {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [{ path: 'deck-edit/:name', component: DeckEditRoute, canDeactivate: [(r: DeckEditRoute) => r.canLeave()] }, { path: 'deck-browse', children: [] }],
          withComponentInputBinding(),
        ),
        provideMarkdown(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    route = await harness.navigateByUrl(url, DeckEditRoute);
    http.expectOne(`/api/v1/deck/${file}`).flush(file.endsWith('.json') ? JSON.stringify(DECK) : 'version: 2\nmeta: {}\ncards:\n  - id: c_1\n    front: Q\n    back: A\n', { headers: { etag: '"e1"' } });
    await settle();
  }

  // The load and save resolve over a few promise turns before the view updates.
  async function settle() {
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
  }

  const el = () => harness.routeNativeElement as HTMLElement;
  const listItems = () =>
    [...el().querySelectorAll('ol button')].map((b) => [...b.querySelectorAll('span')].map((s) => s.textContent!.trim()).filter(Boolean).join(' '));

  afterEach(() => http.verify());

  it('lists the cards as plain text and opens the first one', async () => {
    await open();

    expect(listItems()).toEqual(['1 Bandwidth of x?', '2 Define mu']);
    expect(el().querySelector<HTMLTextAreaElement>('#front-c_1')!.value).toBe(DECK.cards[0].front);
  });

  it('opens the card named in the url', async () => {
    await open('/deck-edit/signals?card=c_2');

    expect(el().querySelector('#front-c_2')).not.toBeNull();
  });

  it('filters the list by either side', async () => {
    await open();
    const search = el().querySelector<HTMLInputElement>('#card-search')!;

    search.value = 'max';
    search.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();

    expect(listItems()).toEqual(['2 Define mu']);
  });

  it('saves with Ctrl+S', async () => {
    await open();
    const front = el().querySelector<HTMLTextAreaElement>('#front-c_1')!;
    front.value = 'Edited';
    front.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    const req = http.expectOne((r) => r.method === 'PUT');
    expect(req.request.headers.get('if-match')).toBe('"e1"');
    req.flush('ok', { headers: { etag: '"e2"' } });
    await settle();

    expect(el().textContent).toContain('All changes saved');
  });

  it('deletes a card and brings it back with Undo', async () => {
    await open();

    el().querySelector<HTMLButtonElement>('button[aria-label="Delete"]')!.click();
    await harness.fixture.whenStable();
    expect(listItems()).toEqual(['1 Define mu']);

    [...el().querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Undo')!.click();
    await harness.fixture.whenStable();
    expect(listItems()).toEqual(['1 Bandwidth of x?', '2 Define mu']);
  });

  it('asks before leaving with unsaved changes', async () => {
    await open();
    route.updateSelected({ back: 'changed' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await harness.navigateByUrl('/deck-browse');

    expect(confirm).toHaveBeenCalled();
    expect(TestBed.inject(Router).url).toBe('/deck-edit/signals');
    confirm.mockRestore();
  });

  it('opens a YAML deck with ?format=yaml', async () => {
    await open('/deck-edit/notes?format=yaml', 'notes.yaml');

    // The YAML parser is loaded on demand.
    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(listItems()).toEqual(['1 Q']);
    });
  });

  it('summarises markdown and math for the list', () => {
    expect(cardSummary('\n# **Title** with $\\alpha$\nmore')).toBe('Title with alpha');
  });
});
