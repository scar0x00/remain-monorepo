import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { provideMarkdown } from 'ngx-markdown';

import { StudyController } from './study-controller';
import { legacyCardId } from '../deck-format/deck-format';

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

  async function setup(cardIds?: string, createStatus = 201, deck: object = DECK) {
    queryParams = new BehaviorSubject(convertToParamMap(cardIds ? { cardIds } : {}));
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
    expect(createBody).toEqual({ deckName: 'alpha.json', deckEtag: '"e1"', cardTotal: 2 });

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
    // The test DOM has no modal dialogs.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };

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
});
