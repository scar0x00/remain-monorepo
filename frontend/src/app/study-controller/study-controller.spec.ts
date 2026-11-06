import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Params, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { provideMarkdown } from 'ngx-markdown';

import { StudyController } from './study-controller';
import { legacyCardId } from '../deck-format/deck-format';
import { polyfillDialog } from '../../testing/dialog';

const DECK = {
  version: 2,
  meta: { title: 'Alpha' },
  cards: [
    { id: 'c_one', front: 'one', back: '1' },
    { id: 'c_two', front: 'two', back: '2', meta: { refs: [{ kind: 'page', label: '4' }] } },
  ],
};

describe('StudyController', () => {
  let fixture: ComponentFixture<StudyController>;
  let component: StudyController;
  let http: HttpTestingController;
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  let createBody: unknown;

  async function setup(cardIds?: string, createStatus = 201, deck: object = DECK, params: Params = {}) {
    queryParams = new BehaviorSubject(convertToParamMap(cardIds ? { cardIds, ...params } : params));
    await TestBed.configureTestingModule({
      imports: [StudyController],
      providers: [
        provideRouter([]),
        provideMarkdown(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(convertToParamMap({ id: 'alpha' })),
            queryParamMap: queryParams,
          },
        },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StudyController);
    component = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne('/api/v1/deck/alpha.json').flush(deck, { headers: { etag: '"e1"' } });
    await fixture.whenStable();
    if (createStatus === 0) return;

    const create = http.expectOne('/api/v1/study-sessions');
    createBody = create.request.body;
    if (createStatus === 201) create.flush({ id: 's1' }, { status: 201, statusText: 'Created' });
    else create.flush('boom', { status: createStatus, statusText: 'err' });
    await fixture.whenStable();
  }

  afterEach(() => http?.verify());

  it('should create', async () => {
    await setup();
    expect(component).toBeTruthy();
  });

  it('starts a session and sends one answer per click with the card id', async () => {
    await setup();
    expect(createBody).toEqual({ deckName: 'alpha.json', deckEtag: '"e1"', cardTotal: 2, mode: 'full' });

    const first = component.currentMd()!;
    component.flipCard();
    component.rightAnswer();
    await fixture.whenStable();

    const req = http.expectOne('/api/v1/study-sessions/s1/answers');
    expect(req.request.body.answers).toEqual([
      expect.objectContaining({ position: 0, cardId: first.id, correct: true }),
    ]);
    req.flush(null);
  });

  it('keeps studying when saving fails', async () => {
    await setup(undefined, 500);

    component.rightAnswer();
    component.wrongAnswer();

    expect(component.finished()).toBe(true);
    expect(component.missed()).toHaveLength(1);
    expect(component['sessions'].saveFailed()).toBe(true);
  });

  it('only studies the requested cards in missed-cards mode', async () => {
    await setup('c_two');

    expect(component.shuffledIndexes()).toEqual([1]);
    expect(component.currentMd()).toEqual(DECK.cards[1]);
  });

  it('keeps the run going after a quick edit, with the fixed text', async () => {
    await setup();
    const order = component.shuffledIndexes();
    component.flipCard();
    component.rightAnswer();
    await fixture.whenStable();
    http.expectOne('/api/v1/study-sessions/s1/answers').flush(null);
    const current = component.currentMd()!;

    const deck = component.currentDeck()!;
    component.cardSaved({
      deck: { ...deck, cards: deck.cards.map((c) => (c.id === current.id ? { ...c, back: 'fixed' } : c)) },
      etag: '"e2"',
    });
    await fixture.whenStable();

    expect(component.shuffledIndexes()).toBe(order);
    expect(component['answers']()).toHaveLength(1);
    expect(component.currentMd()).toEqual({ ...current, back: 'fixed' });
    expect(component.deckEtag()).toBe('"e2"');
  });

  it('opens the quick edit for the current card', async () => {
    await setup();
    polyfillDialog();

    fixture.nativeElement.querySelector('button[aria-label="Edit card"]').click();
    await fixture.whenStable();

    const dialog = fixture.nativeElement.querySelector('app-card-quick-edit dialog') as HTMLDialogElement;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector<HTMLTextAreaElement>(`#front-${component.currentMd()!.id}`)!.value).toBe(component.currentMd()!.front);
  });

  it('studies a legacy deck, using the ids answers had before decks stored them', async () => {
    const legacy = [{ front: 'one', back: '1' }];
    await setup(legacyCardId(legacy[0]), 201, legacy);

    expect(component.shuffledIndexes()).toEqual([0]);
    expect(component.currentMd()).toEqual({ id: legacyCardId(legacy[0]), ...legacy[0] });
  });

  describe('quick session', () => {
    const TAGGED = {
      version: 2,
      meta: { title: 'Tagged' },
      cards: Array.from({ length: 12 }, (_, i) => ({
        id: `c_${i}`,
        front: `q${i}`,
        back: `a${i}`,
        meta: { tags: i < 4 ? ['verbs'] : i < 6 ? ['nouns', 'verbs'] : ['nouns'] },
      })),
    };

    it('shows the setup screen and starts no session for ?quick', async () => {
      await setup(undefined, 0, TAGGED, { quick: '' });
      fixture.detectChanges();

      expect(component.showQuickSetup()).toBe(true);
      expect(component.shuffledIndexes()).toBeUndefined();
      expect(fixture.nativeElement.querySelector('app-quick-session-setup')).not.toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('Show back');
      http.expectNone('/api/v1/study-sessions');
    });

    it('studies the requested number of distinct random cards', async () => {
      await setup(undefined, 201, TAGGED, { quick: '5' });

      const order = component.shuffledIndexes()!;
      expect(order).toHaveLength(5);
      expect(new Set(order).size).toBe(5);
      expect(createBody).toEqual({ deckName: 'alpha.json', deckEtag: '"e1"', cardTotal: 5, mode: 'quick' });
    });

    it('studies the whole deck when asked for more cards than it has', async () => {
      await setup(undefined, 201, TAGGED, { quick: '50' });
      expect(component.shuffledIndexes()).toHaveLength(12);
    });

    it('only picks cards with one of the selected tags', async () => {
      await setup(undefined, 201, TAGGED, { quick: '50', tags: 'verbs' });

      const order = component.shuffledIndexes()!;
      expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('goes back to the setup screen when no card has the tags', async () => {
      await setup(undefined, 0, TAGGED, { quick: '5', tags: 'gone' });
      expect(component.showQuickSetup()).toBe(true);
      http.expectNone('/api/v1/study-sessions');
    });

    it('puts the chosen options in the URL', async () => {
      await setup(undefined, 0, TAGGED, { quick: '' });
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      component.startQuick({ count: 7, tags: ['nouns', 'verbs'] });
      expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { quick: 7, tags: 'nouns,verbs' } }));

      component.startQuick({ count: 3, tags: [] });
      expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { quick: 3, tags: null } }));
    });

    it('draws another set of cards for "Another quick session" and skips the "last time" comparison', async () => {
      await setup(undefined, 201, TAGGED, { quick: '2' });
      for (let i = 0; i < 2; i++) {
        component.flipCard();
        component.rightAnswer();
      }
      const tick = () => new Promise((resolve) => setTimeout(resolve));
      // Answers go out in batches while the run finishes; answer them until the finish call shows up.
      let finish = http.match('/api/v1/study-sessions/s1/finish');
      for (let i = 0; i < 10 && !finish.length; i++) {
        http.match('/api/v1/study-sessions/s1/answers').forEach((r) => r.flush(null));
        await tick();
        finish = http.match('/api/v1/study-sessions/s1/finish');
      }
      expect(finish).toHaveLength(1);
      finish[0].flush({ id: 's1', deckName: 'alpha.json', status: 'completed' });
      expect(component.finished()).toBe(true);
      await tick();
      // A full run would now fetch the previous runs to compare against.
      http.expectNone((r) => r.url === '/api/v1/study-sessions' && r.method === 'GET');

      const before = component.shuffledIndexes();
      component.anotherQuickSession();
      await fixture.whenStable();

      expect(component.shuffledIndexes()).not.toBe(before);
      expect(component.shuffledIndexes()).toHaveLength(2);
      expect(component.finished()).toBe(false);
      const again = http.expectOne('/api/v1/study-sessions');
      expect(again.request.body).toEqual(expect.objectContaining({ cardTotal: 2, mode: 'quick' }));
      again.flush({ id: 's2' }, { status: 201, statusText: 'Created' });
    });
  });
});
