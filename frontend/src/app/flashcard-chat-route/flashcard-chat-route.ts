import { Component, ElementRef, inject, signal, viewChild, afterRenderEffect } from '@angular/core';
import { finalize } from 'rxjs';
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
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly composer = viewChild.required(ChatComposer);
  private nextId = 1;

  readonly messages = signal<ChatMessage[]>([]);
  readonly pending = signal(false);
  // Set after the first deck is created; later messages refine this deck until the user starts a new one.
  readonly activeDeck = signal<string | null>(null);

  constructor() {
    afterRenderEffect(() => {
      this.messages();
      const element = this.log()?.nativeElement;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  submit(request: GenerateDeckRequest) {
    const userId = this.nextId++;
    const assistantId = this.nextId++;

    this.messages.update((list) => [
      ...list,
      {
        id: userId,
        role: 'user',
        text: request.text.trim(),
        attachments: request.files.map((file) => file.name),
      },
      {
        id: assistantId,
        role: 'assistant',
        state: 'pending',
        text: request.refine
          ? `Updating ${request.deckName}…`
          : request.cardCount === null
            ? 'Generating flashcards…'
            : `Generating ${request.cardCount} flashcards…`,
      },
    ]);

    this.pending.set(true);
    this.generator
      .generate(request)
      .pipe(finalize(() => this.pending.set(false)))
      .subscribe({
        next: (result) => {
          this.activeDeck.set(request.deckName);
          this.updateAssistant(assistantId, {
            state: 'done',
            text: request.refine
              ? `Updated ${request.deckName}. It now has ${result.cardCount} flashcards.`
              : `Created ${result.cardCount} flashcards in ${request.deckName}.`,
            deckName: request.deckName,
            cardCount: result.cardCount,
          });
        },
        error: (error: unknown) =>
          this.updateAssistant(assistantId, {
            state: 'error',
            text: describeAgentError(error),
          }),
      });
  }

  startNewDeck() {
    if (this.pending()) return;

    this.activeDeck.set(null);
    this.composer().reset();
    this.messages.update((list) => [
      ...list,
      {
        id: this.nextId++,
        role: 'assistant',
        state: 'done',
        text: 'Started a new deck. Attach files or paste some text to generate it.',
      },
    ]);
  }

  private updateAssistant(id: number, patch: Partial<Omit<AssistantChatMessage, 'id' | 'role'>>) {
    this.messages.update((list) =>
      list.map((message) =>
        message.id === id && message.role === 'assistant' ? { ...message, ...patch } : message,
      ),
    );
  }
}
