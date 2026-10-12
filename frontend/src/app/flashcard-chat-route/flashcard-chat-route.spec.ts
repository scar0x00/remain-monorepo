import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { FlashcardChatRoute } from './flashcard-chat-route';
import { FlashcardGenerator } from './flashcard-generator';
import { GenerateDeckRequest } from '../../types/FlashcardAgent';

describe('FlashcardChatRoute', () => {
  let fixture: ComponentFixture<FlashcardChatRoute>;
  let component: FlashcardChatRoute;
  let generate: ReturnType<typeof vi.fn>;

  const request: GenerateDeckRequest = {
    deckName: 'biology',
    cardCount: 5,
    overwrite: false,
    refine: false,
    text: 'Cells are the unit of life.',
    files: [],
  };

  const refinement: GenerateDeckRequest = {
    deckName: 'biology',
    cardCount: 5,
    overwrite: false,
    refine: true,
    text: 'Make the answers shorter',
    files: [],
  };

  const created = { key: 'biology.json', format: 'json' as const, cardCount: 5 };

  beforeEach(async () => {
    generate = vi.fn();

    await TestBed.configureTestingModule({
      imports: [FlashcardChatRoute],
      providers: [provideRouter([]), { provide: FlashcardGenerator, useValue: { generate } }],
    }).compileComponents();

    fixture = TestBed.createComponent(FlashcardChatRoute);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts with an empty conversation and no active deck', () => {
    expect(component.messages()).toEqual([]);
    expect(component.pending()).toBe(false);
    expect(component.activeDeck()).toBeNull();
  });

  it('adds the user message and a pending reply, then completes the reply on success', () => {
    generate.mockReturnValue(of(created));

    component.submit(request);

    expect(generate).toHaveBeenCalledWith(request);
    expect(component.messages()).toEqual([
      { id: 1, role: 'user', text: 'Cells are the unit of life.', attachments: [] },
      {
        id: 2,
        role: 'assistant',
        state: 'done',
        text: 'Created 5 flashcards in biology.',
        deckName: 'biology',
        cardCount: 5,
      },
    ]);
    expect(component.pending()).toBe(false);
  });

  it('makes the created deck the active deck so later messages refine it', () => {
    generate.mockReturnValue(of(created));

    component.submit(request);

    expect(component.activeDeck()).toBe('biology');
  });

  it('does not activate a deck when generation fails', () => {
    generate.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { error: 'exists' } })),
    );

    component.submit(request);

    expect(component.activeDeck()).toBeNull();
  });

  it('reports a refinement with the new card count and keeps the deck active', () => {
    generate.mockReturnValueOnce(of(created));
    generate.mockReturnValueOnce(of({ key: 'biology.json', format: 'json', cardCount: 7 }));
    component.submit(request);

    component.submit(refinement);

    expect(generate).toHaveBeenLastCalledWith(refinement);
    expect(component.messages().map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(component.messages()[3]).toEqual({
      id: 4,
      role: 'assistant',
      state: 'done',
      text: 'Updated biology. It now has 7 flashcards.',
      deckName: 'biology',
      cardCount: 7,
    });
    expect(component.activeDeck()).toBe('biology');
  });

  it('shows a pending refinement reply while the request is in flight', () => {
    generate.mockReturnValueOnce(of(created));
    component.submit(request);
    const response = new Subject<{ key: string; format: 'json'; cardCount: number }>();
    generate.mockReturnValueOnce(response.asObservable());

    component.submit(refinement);

    expect(component.pending()).toBe(true);
    expect(component.messages()[3]).toMatchObject({
      role: 'assistant',
      state: 'pending',
      text: 'Updating biology…',
    });
  });

  it('records attachment names on the user message', () => {
    generate.mockReturnValue(of(created));
    const pdf = new File(['%PDF'], 'book.pdf');

    component.submit({ ...request, text: '', files: [pdf] });

    expect(component.messages()[0]).toEqual({
      id: 1,
      role: 'user',
      text: '',
      attachments: ['book.pdf'],
    });
  });

  it('shows a pending reply while the request is in flight', () => {
    const response = new Subject<{ key: string; format: 'json'; cardCount: number }>();
    generate.mockReturnValue(response.asObservable());

    component.submit(request);

    expect(component.pending()).toBe(true);
    expect(component.messages()[1]).toMatchObject({
      role: 'assistant',
      state: 'pending',
      text: 'Generating 5 flashcards…',
    });

    response.next(created);
    response.complete();

    expect(component.pending()).toBe(false);
    expect(component.messages()[1]).toMatchObject({ state: 'done' });
  });

  it('turns agent errors into an error reply and keeps the conversation going', () => {
    generate.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { error: 'Deck biology.json already exists. Set overwrite to replace it' },
          }),
      ),
    );

    component.submit(request);

    expect(component.messages()[1]).toEqual({
      id: 2,
      role: 'assistant',
      state: 'error',
      text: 'Deck biology.json already exists. Set overwrite to replace it',
    });
    expect(component.pending()).toBe(false);
  });

  it('starts a new deck, clearing the active deck and the composer', () => {
    generate.mockReturnValue(of(created));
    component.submit(request);
    fixture.detectChanges();

    component.startNewDeck();

    expect(component.activeDeck()).toBeNull();
    expect(component.messages().at(-1)).toMatchObject({
      role: 'assistant',
      state: 'done',
      text: 'Started a new deck. Attach files or paste some text to generate it.',
    });
    expect(fixture.nativeElement.querySelector('app-chat-composer textarea').value).toBe('');
  });

  it('does not start a new deck while a request is pending', () => {
    generate.mockReturnValueOnce(of(created));
    component.submit(request);
    generate.mockReturnValueOnce(new Subject().asObservable());
    component.submit(refinement);

    component.startNewDeck();

    expect(component.activeDeck()).toBe('biology');
  });

  it('gives each message a unique id across submissions', () => {
    generate.mockReturnValue(of(created));

    component.submit(request);
    component.submit({ ...request, deckName: 'chemistry', refine: false });

    const ids = component.messages().map((message) => message.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('renders one bubble per message', () => {
    generate.mockReturnValue(of(created));
    component.submit(request);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('app-chat-bubble')).toHaveLength(2);
  });

  it('shows the new deck button only while a deck is active', () => {
    expect(fixture.nativeElement.textContent).not.toContain('New deck');

    generate.mockReturnValue(of(created));
    component.submit(request);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('New deck (currently biology)');
  });

  it('renders the empty state when there are no messages', () => {
    expect(fixture.nativeElement.textContent).toContain('Nothing here yet');
  });
});
