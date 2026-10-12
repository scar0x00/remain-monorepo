import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GenerateDeckRequest } from '../../types/FlashcardAgent';
import { FileInput } from '../file-input/file-input';
import {
  ACCEPT_ATTRIBUTE,
  CARD_COUNT,
  formatFileSize,
  reviewAttachments,
  toDeckName,
  validateSubmission,
} from '../flashcard-chat-route/flashcard-chat.utils';

@Component({
  selector: 'app-chat-composer',
  imports: [FormsModule, FileInput],
  templateUrl: './chat-composer.html',
})
export class ChatComposer {
  disabled = input<boolean>(false);
  // The deck the conversation is currently editing. When set, messages refine it instead of creating a deck.
  activeDeck = input<string | null>(null);
  submitted = output<GenerateDeckRequest>();

  protected readonly accept = ACCEPT_ATTRIBUTE;
  protected readonly cardCountRange = CARD_COUNT;
  protected readonly formatFileSize = formatFileSize;

  readonly text = signal('');
  readonly deckName = signal('');
  readonly cardCount = signal<number | null>(CARD_COUNT.default);
  // When false the model chooses the deck length and no card count is sent.
  readonly limitCards = signal(true);
  readonly overwrite = signal(false);
  readonly files = signal<File[]>([]);
  readonly problems = signal<string[]>([]);

  addFiles(incoming: File[]) {
    const review = reviewAttachments(incoming, this.files());
    this.files.update((current) => [...current, ...review.accepted]);
    this.problems.set(review.rejected.map((rejected) => `${rejected.name}: ${rejected.reason}`));

    const [first] = review.accepted;
    if (first && this.deckName().trim() === '') {
      this.deckName.set(toDeckName(first.name));
    }
  }

  removeFile(index: number) {
    this.files.update((current) => current.filter((_, i) => i !== index));
  }

  reset() {
    this.text.set('');
    this.deckName.set('');
    this.cardCount.set(CARD_COUNT.default);
    this.limitCards.set(true);
    this.overwrite.set(false);
    this.files.set([]);
    this.problems.set([]);
  }

  send() {
    if (this.disabled()) return;

    const activeDeck = this.activeDeck();
    const request: GenerateDeckRequest = {
      deckName: activeDeck ?? this.deckName().trim(),
      cardCount: this.limitCards() ? Number(this.cardCount()) : null,
      overwrite: this.overwrite(),
      refine: activeDeck !== null,
      text: this.text(),
      files: this.files(),
    };

    const problem = validateSubmission(request);
    if (problem) {
      this.problems.set([problem]);
      return;
    }

    this.problems.set([]);
    this.submitted.emit(request);
    this.text.set('');
    this.files.set([]);
  }
}
