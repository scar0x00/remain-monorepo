import {
  Component,
  ElementRef,
  afterRenderEffect,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subscription, finalize, map, of, switchMap, tap } from 'rxjs';
import { ChatHistory } from '../chat-history/chat-history';
import { ChatBubble } from '../chat-bubble/chat-bubble';
import { ChatComposer } from '../chat-composer/chat-composer';
import { AssistantChatMessage, ChatMessage } from '../../types/ChatMessage';
import { GenerateDeckRequest } from '../../types/FlashcardAgent';
import { describeAgentError } from './flashcard-chat.utils';
import { FlashcardGenerator } from './flashcard-generator';

@Component({
  selector: 'app-flashcard-chat-route',
  imports: [ChatBubble, ChatComposer],
  templateUrl: './flashcard-chat-route.html',
})
export class FlashcardChatRoute {
  private readonly generator = inject(FlashcardGenerator);
  private readonly history = inject(ChatHistory);
  private readonly router = inject(Router);
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly composer = viewChild(ChatComposer);
  private loading?: Subscription;
  // The conversation the page is showing or loading; undefined for a new one.
  private shownId?: string;
  // Bumped whenever the conversation on screen is replaced, so late responses for the old one are ignored.
  private epoch = 0;

  // Bound from the `flashcard-chat/:sessionId` route; absent for a new conversation.
  readonly sessionId = input<string>();

  // The saved conversation on screen. Created when the first message is sent.
  readonly currentSessionId = signal<string | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly pending = signal(false);
  readonly loadingSession = signal(false);
  readonly problem = signal<string | null>(null);
  // Set after the first deck is created; later messages refine this deck. A conversation produces one deck,
  // so a new deck starts a new conversation.
  readonly activeDeck = signal<string | null>(null);
  // The deck this conversation produced was deleted afterwards.
  readonly deckMissing = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.sessionId();
      untracked(() => this.show(id));
    });

    afterRenderEffect(() => {
      this.messages();
      const element = this.log()?.nativeElement;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  submit(request: GenerateDeckRequest) {
    const epoch = this.epoch;
    this.problem.set(null);
    this.pending.set(true);

    this.ensureSession()
      .pipe(
        switchMap((sessionId) =>
          this.history
            .addMessages(sessionId, [
              {
                role: 'user',
                text: request.text.trim(),
                attachments: request.files.map((file) => ({ name: file.name, size: file.size })),
              },
              { role: 'assistant', state: 'pending', text: pendingText(request) },
            ])
            .pipe(map((saved) => ({ sessionId, saved }))),
        ),
      )
      .subscribe({
        next: ({ sessionId, saved }) => {
          if (epoch !== this.epoch) return;

          const [, assistant] = saved;
          this.messages.update((list) => [...list, ...saved]);
          this.generate(request, { sessionId, messageId: assistant.id }, epoch);
        },
        error: () => {
          if (epoch !== this.epoch) return;

          this.pending.set(false);
          this.problem.set('Could not save your message. Check your connection and try again.');
        },
      });
  }

  startNewDeck() {
    if (this.pending()) return;

    void this.router.navigate(['/flashcard-chat']);
  }

  private generate(
    request: GenerateDeckRequest,
    turn: { sessionId: string; messageId: string },
    epoch: number,
  ) {
    this.generator
      .generate(request, turn)
      .pipe(
        finalize(() => {
          if (epoch === this.epoch) this.pending.set(false);
          this.history.refresh();
        }),
      )
      .subscribe({
        next: (result) => {
          if (epoch !== this.epoch) return;

          this.activeDeck.set(request.deckName);
          this.deckMissing.set(null);
          this.updateAssistant(turn.messageId, {
            state: 'done',
            text: request.refine
              ? `Updated ${request.deckName}. It now has ${result.cardCount} flashcards.`
              : `Created ${result.cardCount} flashcards in ${request.deckName}.`,
            deckName: request.deckName,
            cardCount: result.cardCount,
          });
        },
        error: (error: unknown) => {
          if (epoch !== this.epoch) return;

          this.updateAssistant(turn.messageId, { state: 'error', text: describeAgentError(error) });
        },
      });
  }

  // Creates the saved conversation on the first message and moves the URL to it, without
  // recreating this component.
  private ensureSession(): Observable<string> {
    const existing = this.currentSessionId();
    if (existing) return of(existing);

    return this.history.create().pipe(
      tap((session) => {
        this.currentSessionId.set(session.id);
        this.shownId = session.id;
        void this.router.navigate(['/flashcard-chat', session.id], { replaceUrl: true });
      }),
      map((session) => session.id),
    );
  }

  // Shows the new conversation (no id) or loads a saved one, unless it is the one already on screen.
  private show(id: string | undefined) {
    if (id === this.shownId) return;

    this.shownId = id;
    this.loading?.unsubscribe();
    this.epoch++;
    this.currentSessionId.set(null);
    this.messages.set([]);
    this.activeDeck.set(null);
    this.deckMissing.set(null);
    this.problem.set(null);
    this.pending.set(false);
    this.loadingSession.set(false);
    this.composer()?.reset();
    if (id === undefined) return;

    const epoch = this.epoch;
    this.loadingSession.set(true);
    this.loading = this.history.detail(id).subscribe({
      next: (session) => {
        if (epoch !== this.epoch) return;

        this.currentSessionId.set(session.id);
        this.messages.set(session.messages);
        if (session.deckName && session.deckExists) {
          this.activeDeck.set(session.deckName);
        } else if (session.deckName) {
          this.deckMissing.set(session.deckName);
        }
        this.loadingSession.set(false);
      },
      error: () => {
        if (epoch !== this.epoch) return;

        this.loadingSession.set(false);
        this.problem.set('Could not open this conversation. It may have been deleted.');
      },
    });
  }

  private updateAssistant(id: string, patch: Partial<Omit<AssistantChatMessage, 'id' | 'role'>>) {
    this.messages.update((list) =>
      list.map((message) =>
        message.id === id && message.role === 'assistant' ? { ...message, ...patch } : message,
      ),
    );
  }
}

function pendingText(request: GenerateDeckRequest): string {
  if (request.refine) return `Updating ${request.deckName}…`;
  return request.cardCount === null
    ? 'Generating flashcards…'
    : `Generating ${request.cardCount} flashcards…`;
}
