import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { ChatComposer } from '../chat-composer/chat-composer';
import { ChatHistory } from '../chat-history/chat-history';
import { FlashcardChatRoute } from './flashcard-chat-route';
import { FlashcardGenerator } from './flashcard-generator';
import { ChatMessage } from '../../types/ChatMessage';
import { ChatSessionDetail } from '../../types/ChatSession';
import { GenerateDeckRequest } from '../../types/FlashcardAgent';

describe('FlashcardChatRoute', () => {
  let fixture: ComponentFixture<FlashcardChatRoute>;
  let component: FlashcardChatRoute;
  let generate: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let addMessages: ReturnType<typeof vi.fn>;
  let detail: ReturnType<typeof vi.fn>;
  let refresh: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let nextMessage: number;

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

  // Echoes the messages back with server ids, like main-backend does.
  const echoMessages = (_id: string, messages: { role: string; text: string; state?: string }[]) =>
    of(
      messages.map((message): ChatMessage => {
        const id = `msg-${nextMessage++}`;
        const attachments = (message as { attachments?: { name: string; size: number }[] })
          .attachments;
        return message.role === 'user'
          ? { id, role: 'user', text: message.text, attachments: attachments ?? [] }
          : {
              id,
              role: 'assistant',
              state: (message.state ?? 'done') as 'pending',
              text: message.text,
            };
      }),
    );

  const detailOf = (overrides: Partial<ChatSessionDetail> = {}): ChatSessionDetail => ({
    id: 'chat-1',
    title: 'Cells',
    deckName: 'biology',
    deckKey: 'biology.json',
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
    deckExists: true,
    messages: [
      { id: 'u1', role: 'user', text: 'Cells', attachments: [{ name: 'cells.pdf', size: 10 }] },
      {
        id: 'a1',
        role: 'assistant',
        state: 'done',
        text: 'Created 5 flashcards in biology.',
        deckName: 'biology',
        cardCount: 5,
      },
    ],
    ...overrides,
  });

  beforeEach(async () => {
    nextMessage = 1;
    generate = vi.fn();
    create = vi.fn().mockReturnValue(of({ id: 'chat-1', title: 'New deck' }));
    addMessages = vi.fn().mockImplementation(echoMessages);
    detail = vi.fn();
    refresh = vi.fn();

    await TestBed.configureTestingModule({
      imports: [FlashcardChatRoute],
      providers: [
        provideRouter([]),
        { provide: FlashcardGenerator, useValue: { generate } },
        { provide: ChatHistory, useValue: { create, addMessages, detail, refresh } },
      ],
    }).compileComponents();

    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(FlashcardChatRoute);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts with an empty conversation and no active deck', () => {
    expect(component.messages()).toEqual([]);
    expect(component.pending()).toBe(false);
    expect(component.activeDeck()).toBeNull();
    expect(component.currentSessionId()).toBeNull();
    expect(detail).not.toHaveBeenCalled();
  });

  describe('sending messages', () => {
    it('saves the conversation on the first message and moves the URL to it', () => {
      generate.mockReturnValue(of(created));

      component.submit(request);

      expect(create).toHaveBeenCalledTimes(1);
      expect(component.currentSessionId()).toBe('chat-1');
      expect(navigate).toHaveBeenCalledWith(['/flashcard-chat', 'chat-1'], { replaceUrl: true });
    });

    it('saves a user message and a pending assistant message, then settles the reply', () => {
      generate.mockReturnValue(of(created));

      component.submit(request);

      expect(addMessages).toHaveBeenCalledWith('chat-1', [
        { role: 'user', text: 'Cells are the unit of life.', attachments: [] },
        { role: 'assistant', state: 'pending', text: 'Generating 5 flashcards…' },
      ]);
      expect(generate).toHaveBeenCalledWith(request, {
        sessionId: 'chat-1',
        messageId: 'msg-2',
      });
      expect(component.messages()).toEqual([
        { id: 'msg-1', role: 'user', text: 'Cells are the unit of life.', attachments: [] },
        {
          id: 'msg-2',
          role: 'assistant',
          state: 'done',
          text: 'Created 5 flashcards in biology.',
          deckName: 'biology',
          cardCount: 5,
        },
      ]);
      expect(component.pending()).toBe(false);
      expect(refresh).toHaveBeenCalled();
    });

    it('creates the conversation once and reuses it for later messages', () => {
      generate.mockReturnValue(of(created));

      component.submit(request);
      component.submit(refinement);

      expect(create).toHaveBeenCalledTimes(1);
      expect(addMessages).toHaveBeenLastCalledWith('chat-1', expect.any(Array));
      expect(navigate).toHaveBeenCalledTimes(1);
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

      expect(generate).toHaveBeenLastCalledWith(refinement, {
        sessionId: 'chat-1',
        messageId: 'msg-4',
      });
      expect(component.messages().map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
      expect(component.messages()[3]).toEqual({
        id: 'msg-4',
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
      generate.mockReturnValueOnce(new Subject().asObservable());

      component.submit(refinement);

      expect(component.pending()).toBe(true);
      expect(component.messages()[3]).toMatchObject({
        role: 'assistant',
        state: 'pending',
        text: 'Updating biology…',
      });
    });

    it('saves attachment names and sizes with the user message', () => {
      generate.mockReturnValue(of(created));
      const pdf = new File(['%PDF'], 'book.pdf');

      component.submit({ ...request, text: '', files: [pdf] });

      expect(addMessages.mock.calls[0][1][0]).toEqual({
        role: 'user',
        text: '',
        attachments: [{ name: 'book.pdf', size: 4 }],
      });
      expect(component.messages()[0]).toMatchObject({ attachments: [{ name: 'book.pdf', size: 4 }] });
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
        id: 'msg-2',
        role: 'assistant',
        state: 'error',
        text: 'Deck biology.json already exists. Set overwrite to replace it',
      });
      expect(component.pending()).toBe(false);
    });

    it('does not generate when the message cannot be saved', () => {
      addMessages.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      component.submit(request);

      expect(generate).not.toHaveBeenCalled();
      expect(component.messages()).toEqual([]);
      expect(component.pending()).toBe(false);
      expect(component.problem()).toContain('Could not save your message');
    });

    it('does not generate when the conversation cannot be created', () => {
      create.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      component.submit(request);

      expect(generate).not.toHaveBeenCalled();
      expect(component.problem()).toContain('Could not save your message');
    });

    it('gives each message a unique id across submissions', () => {
      generate.mockReturnValue(of(created));

      component.submit(request);
      component.submit({ ...request, deckName: 'chemistry', refine: false });

      const ids = component.messages().map((message) => message.id);
      expect(new Set(ids).size).toBe(4);
    });
  });

  describe('opening a saved conversation', () => {
    beforeEach(() => {
      detail.mockReturnValue(of(detailOf()));
      fixture.componentRef.setInput('sessionId', 'chat-1');
      fixture.detectChanges();
    });

    it('loads its messages and makes its deck the active deck', () => {
      expect(detail).toHaveBeenCalledWith('chat-1');
      expect(component.currentSessionId()).toBe('chat-1');
      expect(component.messages().map((message) => message.id)).toEqual(['u1', 'a1']);
      expect(component.activeDeck()).toBe('biology');
      expect(fixture.nativeElement.querySelectorAll('app-chat-bubble')).toHaveLength(2);
      expect(fixture.nativeElement.textContent).toContain('cells.pdf');
    });

    it('sends the next message to the same conversation as a refinement', () => {
      generate.mockReturnValue(of(created));

      component.submit(refinement);

      expect(create).not.toHaveBeenCalled();
      expect(addMessages.mock.calls[0][0]).toBe('chat-1');
      expect(generate).toHaveBeenCalledWith(refinement, {
        sessionId: 'chat-1',
        messageId: 'msg-2',
      });
      expect(component.messages().map((message) => message.id)).toEqual([
        'u1',
        'a1',
        'msg-1',
        'msg-2',
      ]);
    });

    it('does not load the conversation again after the URL catches up with a new one', () => {
      detail.mockClear();
      generate.mockReturnValue(of(created));
      fixture.componentRef.setInput('sessionId', undefined);
      fixture.detectChanges();
      create.mockReturnValue(of({ id: 'chat-2', title: 'New deck' }));
      component.submit(request);

      fixture.componentRef.setInput('sessionId', 'chat-2');
      fixture.detectChanges();

      expect(detail).not.toHaveBeenCalled();
      expect(component.messages()).toHaveLength(2);
    });

    it('clears the conversation when the URL goes back to a new chat', () => {
      fixture.componentRef.setInput('sessionId', undefined);
      fixture.detectChanges();

      expect(component.currentSessionId()).toBeNull();
      expect(component.messages()).toEqual([]);
      expect(component.activeDeck()).toBeNull();
    });

    it('loads another conversation when the URL changes', () => {
      detail.mockReturnValue(
        of(detailOf({ id: 'chat-2', deckName: 'chemistry', messages: [] })),
      );

      fixture.componentRef.setInput('sessionId', 'chat-2');
      fixture.detectChanges();

      expect(detail).toHaveBeenLastCalledWith('chat-2');
      expect(component.messages()).toEqual([]);
      expect(component.activeDeck()).toBe('chemistry');
    });

    it('ignores a response that arrives after the user moved on', () => {
      const slow = new Subject<ChatSessionDetail>();
      detail.mockReturnValueOnce(slow.asObservable());
      fixture.componentRef.setInput('sessionId', 'chat-3');
      fixture.detectChanges();
      fixture.componentRef.setInput('sessionId', undefined);
      fixture.detectChanges();

      slow.next(detailOf({ id: 'chat-3' }));

      expect(component.currentSessionId()).toBeNull();
      expect(component.messages()).toEqual([]);
    });
  });

  it('keeps a deleted deck out of refinement and says so', () => {
    detail.mockReturnValue(of(detailOf({ deckExists: false })));
    fixture.componentRef.setInput('sessionId', 'chat-1');
    fixture.detectChanges();

    expect(component.activeDeck()).toBeNull();
    expect(component.messages()).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('The deck biology was deleted');
  });

  it('shows a problem when the conversation cannot be opened', () => {
    detail.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    fixture.componentRef.setInput('sessionId', 'missing');
    fixture.detectChanges();

    expect(component.problem()).toContain('Could not open this conversation');
    expect(component.loadingSession()).toBe(false);
  });

  it('starts a new deck by moving to a new conversation', () => {
    generate.mockReturnValue(of(created));
    component.submit(request);
    fixture.detectChanges();
    navigate.mockClear();

    component.startNewDeck();

    expect(navigate).toHaveBeenCalledWith(['/flashcard-chat']);
  });

  it('clears the composer when a new conversation replaces the current one', () => {
    detail.mockReturnValue(of(detailOf()));
    fixture.componentRef.setInput('sessionId', 'chat-1');
    fixture.detectChanges();
    const textarea = fixture.nativeElement.querySelector('app-chat-composer textarea');
    textarea.value = 'draft';
    textarea.dispatchEvent(new Event('input'));
    const composer: ChatComposer = fixture.debugElement.query(
      By.directive(ChatComposer),
    ).componentInstance;
    expect(composer.text()).toBe('draft');

    fixture.componentRef.setInput('sessionId', undefined);
    fixture.detectChanges();

    expect(composer.text()).toBe('');
  });

  it('does not start a new deck while a request is pending', () => {
    generate.mockReturnValueOnce(of(created));
    component.submit(request);
    generate.mockReturnValueOnce(new Subject().asObservable());
    component.submit(refinement);
    navigate.mockClear();

    component.startNewDeck();

    expect(navigate).not.toHaveBeenCalled();
    expect(component.activeDeck()).toBe('biology');
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
